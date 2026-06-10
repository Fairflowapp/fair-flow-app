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

import { collection, doc, getDoc, getDocFromServer, getDocs, setDoc, deleteDoc, onSnapshot, serverTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth } from "/app.js?v=20260510_firestore_lp";

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
  "ff_tasks_auto_reset_state_v1",
  "ff_tasks_reset_stamps_v1"
];

let _salonId = null;
let _locationId = null;
let _unsubscribe = null;
let _applyState = null;
let _getState = null;
let _onRefresh = null;
let _writeTimeout = null;

// Monotonic revision of the active branch's tasksState doc — same optimistic
// concurrency model as the Queue. Every full-state write stamps rev = base + 1
// inside a transaction, and the security rules reject any update whose rev is
// not exactly previous + 1. Snapshots whose rev we have already seen (echoes of
// our own writes, or stale reads) are skipped instead of re-applied.
let _lastCloudRev = 0;

const SALON_ID_CACHE_KEY = "ff_salonId_v1";

async function getSalonId() {
  const user = auth.currentUser;
  let salonId = null;

  // Multi-salon: when the user has chosen a salon (single membership auto-
  // selected, or one explicitly picked from Choose Salon), that selection is
  // the source of truth. Reading users/{uid}.salonId first would leak data
  // from the legacy primary salon into whichever salon the user picked.
  if (typeof window !== "undefined" && window.currentSalonId) {
    return String(window.currentSalonId).trim() || null;
  }

  // 1) From Firebase auth user doc (legacy fallback for users with no membership yet)
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

function sharedTaskTemplatesRef(accountId) {
  return collection(db, `accounts/${accountId}/shared/taskTemplates/items`);
}

function mapSharedTaskTemplateToCatalogTask(template) {
  if (!template || template.active === false) return null;
  const tab = TABS.includes(template.tab) ? template.tab : "opening";
  const id = `shared:${template.id}`;
  const task = {
    id,
    taskId: id,
    title: String(template.title || "").trim(),
    instructions: String(template.instructions || "").trim(),
    assignTo: template.assignTo || "all",
    technicianTypes: Array.isArray(template.technicianTypes) ? template.technicianTypes : [],
    sharedTemplateId: template.id,
    isSharedTemplate: true
  };
  const schedule = template.schedule && typeof template.schedule === "object" ? template.schedule : null;
  if (tab === "weekly") {
    task.scheduleWeekdays = schedule?.weekday ? [schedule.weekday] : "any";
  } else if (tab === "monthly") {
    task.scheduleDayOfMonth = schedule?.day || "any";
  } else if (tab === "yearly") {
    task.scheduleMonth = Number(schedule?.month) || null;
    task.scheduleDay = Number(schedule?.day) || null;
  }
  if (!task.title) return null;
  return { tab, task };
}

async function loadSharedTaskCatalog(accountId) {
  if (!accountId) return {};
  try {
    const snap = await getDocs(sharedTaskTemplatesRef(accountId));
    const catalog = {};
    TABS.forEach((tab) => { catalog[tab] = []; });
    snap.docs.forEach((d) => {
      const mapped = mapSharedTaskTemplateToCatalogTask({ id: d.id, ...d.data() });
      if (!mapped) return;
      catalog[mapped.tab].push(mapped.task);
    });
    TABS.forEach((tab) => {
      catalog[tab].sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
    });
    return catalog;
  } catch (e) {
    console.warn("[SharedTasks] load templates failed", e);
    return {};
  }
}

async function mergeSharedTaskTemplatesIntoState(state, accountId) {
  const base = state || emptyCloudState();
  const sharedCatalog = await loadSharedTaskCatalog(accountId);
  const mergedCatalog = { ...(base.catalog || {}) };
  TABS.forEach((tab) => {
    const localList = Array.isArray(mergedCatalog[tab]) ? mergedCatalog[tab] : [];
    const byId = new Map();
    localList.forEach((task) => {
      const key = String(task?.taskId || task?.id || "").trim();
      if (key) byId.set(key, task);
    });
    (sharedCatalog[tab] || []).forEach((task) => {
      const key = String(task.taskId || task.id || "").trim();
      if (key) byId.set(key, { ...(byId.get(key) || {}), ...task });
    });
    mergedCatalog[tab] = Array.from(byId.values());
  });
  return { ...base, catalog: mergedCatalog };
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
    autoResetState: {},
    resetStamps: {}
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
  _lastCloudRev = 0;

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
  _unsubscribe = onSnapshot(ref, async (snap) => {
    if (!_applyState) return;
    if (
      typeof window !== "undefined" &&
      Number(window.__ffTasksReturnLocalWriteUntil || 0) > Date.now()
    ) {
      return;
    }

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
        _applyState(await mergeSharedTaskTemplatesIntoState(emptyCloudState(), salonId));
        if (typeof _onRefresh === "function") _onRefresh();
      } catch (e) {
        console.warn("[TasksCloud] clear-local-on-empty-cloud failed", e, logTag);
      }
      _firstSnapshot = false;
      return;
    }
    const data = snap.data();
    _firstSnapshot = false;

    // Revision gate: a snapshot whose rev we have already seen is either the
    // echo of our own transaction or a stale read — never re-apply it (this is
    // what allows "the newest write is authoritative" without flapping).
    const snapRev = (typeof data.rev === "number" && data.rev >= 0) ? data.rev : 0;
    if (snapRev > 0 && snapRev <= _lastCloudRev) return;
    if (snapRev > _lastCloudRev) _lastCloudRev = snapRev;

    if (typeof window !== "undefined") window.__ffTasksApplyingRemote = true;
    try {
      _applyState(await mergeSharedTaskTemplatesIntoState(data, salonId));
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
    resetStamps: state.resetStamps || {},
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

function taskRowTime(row) {
  const v = row && (row.completedAt || row.updatedAt || row.createdAt);
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (v && typeof v.toMillis === "function") return v.toMillis();
  if (v && typeof v.seconds === "number") return v.seconds * 1000;
  const p = Date.parse(v);
  return Number.isFinite(p) ? p : 0;
}

/** Union of done rows by task id — the row with the newest timestamp wins. */
function unionDoneNewestWins(localRows, serverRows) {
  const byId = new Map();
  const put = (row) => {
    const id = String((row && (row.taskId || row.id)) || "").trim();
    if (!id) return;
    const normalized = { ...row, id, taskId: id, status: "done" };
    const existing = byId.get(id);
    if (!existing || taskRowTime(normalized) >= taskRowTime(existing)) byId.set(id, normalized);
  };
  (Array.isArray(serverRows) ? serverRows : []).forEach(put);
  (Array.isArray(localRows) ? localRows : []).forEach(put);
  return Array.from(byId.values());
}

/**
 * Push local state → cloud inside a TRANSACTION (queue-style protection):
 *
 *   1. rev compare-and-swap — the write lands at rev = server rev + 1 and the
 *      security rules reject anything else, so concurrent writers from any
 *      device are serialized by the server. The transaction retries on
 *      contention automatically; nobody blind-overwrites the document.
 *   2. Reset stamps — a tab whose server resetStamp is NEWER than this
 *      device's is stale here: the server's clean lists are kept (a stale
 *      device can never resurrect pre-reset tasks). A tab whose LOCAL stamp
 *      is newer means WE just reset it — local lists win wholesale.
 *   3. Newest-wins done merge — when stamps are equal (normal work), done
 *      rows are unioned per task id with the newest timestamp winning, so
 *      two staff marking tasks at the same moment never erase each other.
 */
function writeState(reason) {
  const isManualReset = reason === "manual-reset";
  const toast = (msg, kind) => {
    if (typeof window !== "undefined" && typeof window.showToast === "function") {
      try { window.showToast(msg, kind || "error"); } catch (_) {}
    }
  };
  if (!_salonId || !_getState) {
    console.warn("[TasksCloud] writeState skipped — no salonId or getState", { salonId: _salonId });
    if (isManualReset) toast("Reset NOT saved: no cloud connection (salon not linked)", "error");
    return Promise.resolve();
  }
  let state = null;
  try {
    state = _getState();
  } catch (e) {
    console.error("[TasksCloud] getState threw — local tasks data unreadable", e);
    if (typeof window !== "undefined" && typeof window.showToast === "function") {
      window.showToast("Tasks save failed: local data unreadable", "error");
    }
    return Promise.resolve();
  }
  if (!state) return Promise.resolve();
  const ref = tasksStateRef(_salonId, _locationId);
  console.log("[TasksCloud] write attempt", { loc: _locationId || "default", reason: reason || "task-update" });
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const out = buildFirestoreState(state);
    let baseRev = 0;
    if (snap.exists()) {
      const server = snap.data() || {};
      baseRev = (typeof server.rev === "number" && server.rev >= 0) ? server.rev : 0;
      const serverStamps = (server.resetStamps && typeof server.resetStamps === "object") ? server.resetStamps : {};
      const localStamps = (state.resetStamps && typeof state.resetStamps === "object") ? state.resetStamps : {};
      const mergedStamps = { ...localStamps };
      TABS.forEach((tab) => {
        const sv = Number(serverStamps[tab] || 0);
        const lv = Number(localStamps[tab] || 0);
        if (sv > lv) {
          // Server tab was reset after our local copy — server lists win.
          out[tab] = {
            active: Array.isArray(server[tab]?.active) ? server[tab].active : [],
            pending: Array.isArray(server[tab]?.pending) ? server[tab].pending : [],
            done: Array.isArray(server[tab]?.done) ? server[tab].done : []
          };
          mergedStamps[tab] = sv;
        } else if (sv === lv) {
          // Same reset generation — merge done rows so concurrent marks from
          // other devices are never dropped by our full-state write.
          out[tab] = {
            active: out[tab].active,
            pending: out[tab].pending,
            done: unionDoneNewestWins(out[tab].done, server[tab]?.done)
          };
        }
        // lv > sv: we just reset this tab — our clean lists win wholesale.
      });
      out.resetStamps = mergedStamps;
    }
    out.rev = baseRev + 1;
    out.lastUpdateReason = typeof reason === "string" && reason ? reason : "task-update";
    out.lastUpdatedByUid = (auth.currentUser && auth.currentUser.uid) || null;
    tx.set(ref, out);
    return out.rev;
  }).then((rev) => {
    if (typeof rev === "number" && rev > _lastCloudRev) _lastCloudRev = rev;
    console.log("[TasksCloud] write OK at rev", rev);
    if (isManualReset) toast("Reset saved to cloud (rev " + rev + ")", "success");
  }).catch((e) => {
    console.error("[TasksCloud] write FAILED", e && (e.code || e.name), e && e.message, e);
    toast("Tasks save FAILED: " + ((e && (e.code || e.message)) || "unknown error"), "error");
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
    if (typeof window !== "undefined" && window.__ff_waiting_for_salon_choice === true) {
      if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
      _salonId = null;
      _locationId = null;
      return;
    }
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

export function tasksCloudWrite(reason) {
  return writeState(reason);
}

export function tasksCloudReconnect() {
  if (typeof window !== "undefined" && window.__ff_waiting_for_salon_choice === true) return Promise.resolve();
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
  if (typeof window !== "undefined" && window.__ff_waiting_for_salon_choice === true) return Promise.resolve();
  if (!_salonId || !_applyState) return Promise.resolve();
  if (typeof window !== "undefined" && window.__ffTasksLastLocalWrite != null && (Date.now() - window.__ffTasksLastLocalWrite) < 12000) return Promise.resolve();
  const ref = tasksStateRef(_salonId, _locationId);
  return getDocFromServer(ref).then(async (snap) => {
    if (snap.exists()) {
      if (typeof window !== "undefined" && window.__ffTasksLastLocalWrite != null && (Date.now() - window.__ffTasksLastLocalWrite) < 12000) return;
      const data = snap.data();
      const r = (typeof data.rev === "number" && data.rev >= 0) ? data.rev : 0;
      if (r > _lastCloudRev) _lastCloudRev = r;
      window.__ffTasksApplyingRemote = true;
      try {
        _applyState(await mergeSharedTaskTemplatesIntoState(data, _salonId));
        if (typeof _onRefresh === "function") _onRefresh();
      } finally {
        window.__ffTasksApplyingRemote = false;
      }
    } else {
      window.__ffTasksApplyingRemote = true;
      try {
        _applyState(await mergeSharedTaskTemplatesIntoState(emptyCloudState(), _salonId));
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
