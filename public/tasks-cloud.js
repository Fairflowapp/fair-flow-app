/**
 * Tasks Cloud – sync TASKS per-location to Firestore.
 *
 * Firestore path (location-aware):
 *   - salons/{salonId}/tasksState/{locationId}  when the user has picked an
 *     active location in the header switcher. Each branch gets its own
 *     Tasks catalog, per-tab active/pending/done state, alert windows,
 *     enforce-select, auto-reset state and tombstone — like two different
 *     businesses.
 *   - salons/{salonId}/tasksState/default       fallback for single-location
 *     salons (no locations configured yet). Preserves all pre-multi-location
 *     data without any migration.
 *
 * Firestore doc shape (per branch):
 *   { catalog, opening, closing, weekly, monthly, yearly,
 *     tombstone, alertWindows, enforceSelectSettings, autoResetState, updatedAt }
 */

import { doc, getDoc, getDocFromServer, setDoc, deleteDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth } from "./app.js?v=20260411_chat_reminder_attrfix";

const TASKS_STATE_DEFAULT = "default";
const TABS = ["opening", "closing", "weekly", "monthly", "yearly"];
const KINDS = ["active", "pending", "done"];

// Per-location localStorage keys that mirror the cloud doc. When the user
// switches locations we flush these so the previous branch's tasks don't
// leak into the new branch's UI for a split second.
const LS_KEYS_STATIC = [
  "ff_tasks_catalog_v1",
  "ff_tasks_active_deleted_v1",
  "ff_tasks_alert_windows_v1",
  "ff_tasks_enforce_select_v1",
  "ff_tasks_auto_reset_state_v1"
];

let _salonId = null;
let _locationId = null;
let _unsubscribe = null;
let _applyState = null;
let _getState = null;
let _onRefresh = null;
let _writeTimeout = null;

const SALON_ID_CACHE_KEY = "ff_salonId_v1";

async function getSalonId() {
  const user = auth.currentUser;
  let salonId = null;

  // 1) From Firebase auth user doc (primary for logged-in users)
  if (user) {
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        salonId = data.salonId || null;
      }
    } catch (e) {
      console.warn("[TasksCloud] getSalonId from user doc failed", e);
    }
  }

  // 2) Fallback: window.currentSalonId (set by app.js auth listener – helps shared device / PIN flow)
  if (!salonId && typeof window !== "undefined" && window.currentSalonId) {
    salonId = window.currentSalonId;
  }

  // 3) Fallback: cached from previous session (helps when auth loads slowly)
  if (!salonId && typeof localStorage !== "undefined") {
    try {
      const cached = localStorage.getItem(SALON_ID_CACHE_KEY);
      if (cached && cached.trim()) salonId = cached.trim();
    } catch (e) {}
  }

  // Persist for next load (when auth may be slow)
  if (salonId && typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(SALON_ID_CACHE_KEY, salonId);
    } catch (e) {}
  }

  return salonId || null;
}

/**
 * Resolve the active location id from the header switcher. When nothing is
 * active (single-location salon, or locations not loaded yet), returns "".
 */
function readActiveLocationId() {
  if (typeof window === "undefined") return "";
  try {
    if (typeof window.ffGetActiveLocationId === "function") {
      const v = window.ffGetActiveLocationId();
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  } catch (_) {}
  const raw = typeof window.__ff_active_location_id === "string" ? window.__ff_active_location_id.trim() : "";
  return raw || "";
}

/** doc id for the tasksState document — locationId per branch, otherwise "default". */
function tasksStateDocIdFor(locationId) {
  const v = typeof locationId === "string" ? locationId.trim() : "";
  return v || TASKS_STATE_DEFAULT;
}

function tasksStateRef(salonId, locationId) {
  return doc(db, `salons/${salonId}/tasksState`, tasksStateDocIdFor(locationId));
}

let _firstSnapshot = true;

function stateHasData(state) {
  if (!state) return false;
  if (Object.keys(state.catalog || {}).length > 0) return true;
  return TABS.some((tab) => {
    const t = state[tab];
    if (!t) return false;
    return (t.active?.length || 0) + (t.pending?.length || 0) + (t.done?.length || 0) > 0;
  });
}

/**
 * Flush every Tasks localStorage key that is tied to a specific location so
 * the previous branch's tasks don't remain visible while we wait for the
 * new location's snapshot. The cloud listener will repopulate whatever
 * exists for the newly active branch.
 */
function flushLocalTasksState() {
  if (typeof localStorage === "undefined") return;
  const _wasHook = typeof window !== "undefined" ? window.__ffTasksApplyingRemote : false;
  if (typeof window !== "undefined") window.__ffTasksApplyingRemote = true;
  try {
    LS_KEYS_STATIC.forEach((k) => { try { localStorage.removeItem(k); } catch (_) {} });
    TABS.forEach((tab) => {
      KINDS.forEach((kind) => {
        try { localStorage.removeItem(`ff_tasks_${tab}_${kind}_v1`); } catch (_) {}
      });
    });
    if (typeof window !== "undefined") window.ff_tasks_catalog_v1 = {};
  } finally {
    if (typeof window !== "undefined") window.__ffTasksApplyingRemote = _wasHook;
  }
}

function emptyCloudState() {
  return {
    catalog: {},
    opening: { active: [], pending: [], done: [] },
    closing: { active: [], pending: [], done: [] },
    weekly:  { active: [], pending: [], done: [] },
    monthly: { active: [], pending: [], done: [] },
    yearly:  { active: [], pending: [], done: [] },
    tombstone: {},
    alertWindows: {},
    enforceSelectSettings: {},
    autoResetState: {}
  };
}

let _hasSubscribedOnce = false;

function subscribe(salonId, locationId) {
  const isLocationSwitch = _hasSubscribedOnce;
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }
  _firstSnapshot = true;

  // CRITICAL: when switching between locations (not on the very first
  // subscribe after app startup), wipe in-memory / local state before the
  // new snapshot arrives so the previous branch's tasks don't flash on
  // screen. On the initial subscribe we keep localStorage intact so the
  // UI paints instantly from cache while Firestore catches up.
  if (isLocationSwitch) {
    flushLocalTasksState();
    // Reset the "just wrote locally" cooldown so the incoming apply (empty
    // + then the new branch's snapshot) is NOT suppressed as an echo.
    if (typeof window !== "undefined") window.__ffTasksLastLocalWrite = 0;
    if (typeof _applyState === "function") {
      try {
        if (typeof window !== "undefined") window.__ffTasksApplyingRemote = true;
        _applyState(emptyCloudState());
      } finally {
        if (typeof window !== "undefined") window.__ffTasksApplyingRemote = false;
      }
      if (typeof _onRefresh === "function") {
        try { _onRefresh(); } catch (_) {}
      }
    }
  }
  _hasSubscribedOnce = true;

  const ref = tasksStateRef(salonId, locationId);
  const logTag = locationId ? `loc=${locationId}` : "default";
  _unsubscribe = onSnapshot(ref, (snap) => {
    if (!_applyState) return;

    // NOTE: We deliberately do NOT push local state → cloud when the salon is empty.
    // For a brand-new owner account the cloud is legitimately empty, and copying up
    // localStorage tasks from the previous account leaks data across tenants.
    // Instead, when the cloud is empty we clear the local applied state so stale
    // tasks from a previous account cannot leak into the UI.
    //
    // Additionally: when we just switched to a different LOCATION whose cloud doc
    // does not exist yet, we must NOT migrate the default/other-location data.
    // Each branch is "its own business" and starts fresh.
    if (!snap.exists()) {
      try {
        _applyState(emptyCloudState());
        if (typeof _onRefresh === "function") _onRefresh();
      } catch (e) {
        console.warn("[TasksCloud] clear-local-on-empty-cloud failed", e, logTag);
      }
      _firstSnapshot = false;
      return;
    }
    const data = snap.data();
    _firstSnapshot = false;

    if (typeof window !== "undefined") window.__ffTasksApplyingRemote = true;
    try {
      _applyState(data);
      if (typeof _onRefresh === "function") _onRefresh();
    } finally {
      if (typeof window !== "undefined") window.__ffTasksApplyingRemote = false;
    }
  }, (err) => console.error("[TasksCloud] subscribe error", logTag, err));
}

function buildFirestoreState(state) {
  const out = {
    catalog: state.catalog || {},
    tombstone: state.tombstone || {},
    alertWindows: state.alertWindows || {},
    enforceSelectSettings: state.enforceSelectSettings || {},
    autoResetState: state.autoResetState || {},
    updatedAt: serverTimestamp()
  };
  TABS.forEach((tab) => {
    out[tab] = {
      active: Array.isArray(state[tab]?.active) ? state[tab].active : [],
      pending: Array.isArray(state[tab]?.pending) ? state[tab].pending : [],
      done: Array.isArray(state[tab]?.done) ? state[tab].done : []
    };
  });
  return out;
}

function writeState() {
  if (!_salonId || !_getState) return Promise.resolve();
  const state = _getState();
  if (!state) return Promise.resolve();
  return setDoc(tasksStateRef(_salonId, _locationId), buildFirestoreState(state)).catch((e) => {
    console.warn("[TasksCloud] write failed", e);
  });
}

function scheduleWrite() {
  if (!_salonId) return;
  if (typeof window !== "undefined" && window.__ffTasksApplyingRemote) return;
  if (typeof window !== "undefined") window.__ffTasksLastLocalWrite = Date.now();
  if (_writeTimeout) clearTimeout(_writeTimeout);
  _writeTimeout = setTimeout(() => {
    _writeTimeout = null;
    writeState();
  }, 600);
}

function installStorageHook() {
  if (typeof localStorage === "undefined" || window.__ffTasksCloudStorageHook) return;
  window.__ffTasksCloudStorageHook = true;
  const originalSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function (key, value) {
    originalSetItem(key, value);
    if (String(key || "").startsWith("ff_tasks_")) scheduleWrite();
  };
}

/**
 * getState must return: { catalog, tombstone, alertWindows, enforceSelectSettings, opening, closing, weekly, monthly, yearly }
 * each tab: { active: [], pending: [], done: [] }
 */
export function initTasksCloud(opts) {
  if (!opts || typeof opts.applyState !== "function" || typeof opts.getState !== "function") {
    console.warn("[TasksCloud] initTasksCloud: applyState and getState required");
    return;
  }
  _applyState = opts.applyState;
  _getState = opts.getState;
  _onRefresh = opts.onRefresh || null;
  installStorageHook();
  function tryConnect() {
    getSalonId().then((sid) => {
      const loc = readActiveLocationId();
      if (sid && (sid !== _salonId || loc !== _locationId)) {
        _salonId = sid;
        _locationId = loc;
        subscribe(sid, loc);
        console.log("[TasksCloud] Subscribed to salon", sid, "location", loc || "(default)");
      } else if (!sid) {
        _salonId = null;
        _locationId = null;
        if (_unsubscribe) {
          _unsubscribe();
          _unsubscribe = null;
        }
      }
    });
  }
  tryConnect();
  onAuthStateChanged(auth, () => {
    tryConnect();
  });

  // When the header switcher changes the active branch, swap the Firestore
  // subscription to that branch's tasksState doc. The subscribe() helper
  // also clears in-memory state so the previous branch's tasks don't flash
  // on screen.
  if (typeof document !== "undefined" && !window.__ffTasksCloudLocListenerBound) {
    window.__ffTasksCloudLocListenerBound = true;
    document.addEventListener("ff-active-location-changed", () => {
      const loc = readActiveLocationId();
      if (!_salonId) return;
      if (loc === _locationId) return;
      _locationId = loc;
      subscribe(_salonId, loc);
      console.log("[TasksCloud] Re-subscribed after location switch →", loc || "(default)");
    });
  }
}

export function tasksCloudWrite() {
  return writeState();
}

export function tasksCloudReconnect() {
  getSalonId().then((sid) => {
    const loc = readActiveLocationId();
    if (sid === _salonId && loc === _locationId) return;
    _salonId = sid;
    _locationId = loc;
    if (sid) subscribe(sid, loc);
  });
}

/** Force fetch current state from server (bypass cache) and apply so other computer sees updates. */
export function tasksCloudRefresh() {
  if (!_salonId || !_applyState) return Promise.resolve();
  if (typeof window !== "undefined" && window.__ffTasksLastLocalWrite != null && (Date.now() - window.__ffTasksLastLocalWrite) < 12000) return Promise.resolve();
  const ref = tasksStateRef(_salonId, _locationId);
  return getDocFromServer(ref).then((snap) => {
    if (snap.exists()) {
      if (typeof window !== "undefined" && window.__ffTasksLastLocalWrite != null && (Date.now() - window.__ffTasksLastLocalWrite) < 12000) return;
      window.__ffTasksApplyingRemote = true;
      try {
        _applyState(snap.data());
        if (typeof _onRefresh === "function") _onRefresh();
      } finally {
        window.__ffTasksApplyingRemote = false;
      }
    }
  }).catch((e) => console.warn("[TasksCloud] refresh failed", e));
}

// ─── Public: one-click purge of tasks doc for the current salon+location ──────
// Recovery helper — wipes ONLY the active location's Tasks document. Use via
// browser console:
//   await window.ffClearAllTasksFromCloud();
async function ffClearAllTasksFromCloud() {
  const sid = _salonId || (await getSalonId());
  if (!sid) {
    console.warn("[TasksCloud] Cannot clear — no salonId.");
    return { cleared: false };
  }
  const loc = _locationId || readActiveLocationId();
  try {
    await deleteDoc(tasksStateRef(sid, loc));
    // Also wipe local tasks caches so the UI re-applies an empty state.
    flushLocalTasksState();
    if (_applyState) {
      try {
        window.__ffTasksApplyingRemote = true;
        _applyState(emptyCloudState());
        if (typeof _onRefresh === "function") _onRefresh();
      } finally {
        window.__ffTasksApplyingRemote = false;
      }
    }
    console.log("[TasksCloud] Cleared tasks for salon", sid, "location", loc || "(default)");
    return { cleared: true };
  } catch (e) {
    console.error("[TasksCloud] ffClearAllTasksFromCloud error:", e);
    throw e;
  }
}

if (typeof window !== "undefined") {
  window.initTasksCloud = initTasksCloud;
  window.tasksCloudWrite = tasksCloudWrite;
  window.tasksCloudReconnect = tasksCloudReconnect;
  window.tasksCloudRefresh = tasksCloudRefresh;
  window.ffClearAllTasksFromCloud = ffClearAllTasksFromCloud;
  if (typeof window.__ffTasksCloudInit === "function") {
    window.__ffTasksCloudInit();
  }
}
