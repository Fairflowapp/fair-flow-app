/**
 * Queue Cloud – sync QUEUE (Available + In service + History log) to Firestore.
 * Replaces localStorage for queue/service/log when user is signed in and has salonId.
 *
 * Firestore path (location-aware):
 *   - salons/{salonId}/queueState/{locationId}  when the user has picked an
 *     active location in the header switcher. Each branch gets its own
 *     queue, its own "in service" cards, and its own history log — just like
 *     two different businesses.
 *   - salons/{salonId}/queueState/default       fallback for single-location
 *     salons (no locations configured yet). Preserves all pre-multi-location
 *     data without any migration.
 */

import { doc, getDoc, getDocFromServer, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth } from "/app.js?v=20260510_firestore_lp";

const QUEUE_STATE_DEFAULT = "default";
const RECENT_LOCAL_WRITE_GRACE_MS = 10000;
let _salonId = null;
let _locationId = null;
let _unsubscribe = null;
let _applyState = null;
let _getState = null;
let _onLogChange = null;

async function getSalonId() {
  // Multi-salon: when the user has chosen a salon (single membership auto-
  // selected, or one explicitly picked from Choose Salon), that selection is
  // the source of truth. Reading users/{uid}.salonId first would leak data
  // from the legacy primary salon into whichever salon the user picked.
  if (typeof window !== "undefined") {
    if (window.currentSalonId) {
      return String(window.currentSalonId).trim() || null;
    }
    if (window.__ff_waiting_for_salon_choice !== false) {
      return null;
    }
  }
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) {
      const data = userDoc.data();
      return data.salonId || null;
    }
  } catch (e) {
    console.warn("[QueueCloud] getSalonId failed", e);
  }
  return null;
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
  if (raw) return raw;
  // Mobile boot: active location may not be in memory yet but is persisted from
  // the last session. Subscribing to the wrong queueState doc (default) and
  // applying its empty snapshot caused a visible empty-queue flash on phone.
  try {
    const stored = localStorage.getItem("ff_active_location_id");
    if (typeof stored === "string" && stored.trim()) return stored.trim();
  } catch (_) {}
  return "";
}

/** doc id for the queueState document — locationId per branch, otherwise "default". */
function queueStateDocIdFor(locationId) {
  const v = typeof locationId === "string" ? locationId.trim() : "";
  return v || QUEUE_STATE_DEFAULT;
}

function queueStateRef(salonId, locationId) {
  return doc(db, `salons/${salonId}/queueState`, queueStateDocIdFor(locationId));
}

let _firstSnapshot = true;
let _subscribedDocId = null;

function storedActiveLocationIdForQueue() {
  const fromRead = readActiveLocationId();
  if (fromRead) return fromRead;
  return "";
}

/** Skip applying an empty cloud snapshot while we are still subscribed to a
 *  different branch doc than the user's persisted active location. */
function shouldSkipEmptyCloudSnapshot(subscribedLocationId, cloudHasData, localHasAnyData) {
  if (cloudHasData || !localHasAnyData) return false;
  const stored = storedActiveLocationIdForQueue();
  if (!stored) return false;
  return queueStateDocIdFor(subscribedLocationId) !== queueStateDocIdFor(stored);
}

function hasRecentLocalQueueWrite() {
  if (typeof window === "undefined") return false;
  const lastSave = Number(window.__ff_lastSaveTime || 0);
  return lastSave > 0 && (Date.now() - lastSave) < RECENT_LOCAL_WRITE_GRACE_MS;
}

function queueStateHasData(state) {
  return !!state &&
    ((state.queue?.length || 0) + (state.service?.length || 0) + (state.log?.length || 0)) > 0;
}

function stateCounts(state) {
  return {
    queue: Array.isArray(state?.queue) ? state.queue.length : 0,
    service: Array.isArray(state?.service) ? state.service.length : 0,
    log: Array.isArray(state?.log) ? state.log.length : 0,
  };
}

function hasExplicitEmptyOverwriteIntent() {
  if (typeof window === "undefined") return false;
  return Number(window.__ff_allow_empty_queue_cloud_write_until || 0) > Date.now();
}

function snapshotFromCache(snap) {
  return !!(snap && snap.metadata && snap.metadata.fromCache);
}

/** During boot, never paint an empty cloud snapshot over a good local cache. */
function shouldDeferBootSnapshot(snap, subscribedLocationId, cloudHasData, localHasAnyData) {
  if (!_firstSnapshot || !localHasAnyData || cloudHasData) return false;
  if (snapshotFromCache(snap)) return true;
  return shouldSkipEmptyCloudSnapshot(subscribedLocationId, cloudHasData, localHasAnyData);
}

function queueCloudWriteReason() {
  if (typeof window === "undefined") return "unknown";
  return String(window.__ff_queue_cloud_write_reason || "").trim() || "app-save";
}

function subscribe(salonId, locationId, opts = {}) {
  const nextDocId = queueStateDocIdFor(locationId);
  // Already listening to this branch doc — avoid tearing down the listener and
  // replaying cached snapshots (mobile hard refresh showed list → blank → list).
  if (_salonId === salonId && _subscribedDocId === nextDocId && _unsubscribe) {
    return;
  }
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }
  _firstSnapshot = true;
  const locationDocChanged = _subscribedDocId !== null && _subscribedDocId !== nextDocId;
  // Switching to a different branch — require a fresh server snapshot before we
  // trust an empty queue again.
  if (locationDocChanged && typeof window !== "undefined") {
    window.__ff_queueCloudServerConfirmed = false;
  }
  const preserveRecentLocalWrite =
    opts.reason !== "manual" &&
    hasRecentLocalQueueWrite() &&
    queueStateHasData(_getState ? _getState() : null);
  // Clear in-memory queue/service/log only when switching to a DIFFERENT branch
  // doc. Re-subscribing to the same branch (staff/location recompute on boot)
  // must not wipe the locally cached queue — that caused empty flashes on phone.
  if (locationDocChanged && !preserveRecentLocalWrite && typeof _applyState === "function") {
    try { _applyState([], [], [], null, { force: true, reason: "queue-cloud-resubscribe" }); } catch (_) {}
    if (typeof _onLogChange === "function") {
      try { _onLogChange(); } catch (_) {}
    }
  }
  _subscribedDocId = nextDocId;
  // Clear ff_queues_v1 (Queue Auto Reset + GeoFence settings) on a real
  // location switch so the previous branch's settings don't leak into the new
  // branch. We deliberately DO NOT clear on initial connect/reconnect: clearing
  // there made the Auto Reset toggle flash OFF for a moment on every app load
  // (until the cloud snapshot repopulated it). On a normal load the locally
  // cached settings are for this same device/branch, and the snapshot below
  // still reconciles (it repopulates when the cloud has queueSettings, and
  // removes them when it doesn't), so correctness is preserved without flicker.
  const isLocationSwitch = opts.reason !== 'connect' && opts.reason !== 'reconnect';
  if (isLocationSwitch) {
    try {
      localStorage.removeItem('ff_queues_v1');
      if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
        document.dispatchEvent(new CustomEvent('ff-queue-settings-changed', { detail: { reason: 'location-switch' } }));
      }
    } catch (_) {}
  }
  const ref = queueStateRef(salonId, locationId);
  const logTag = locationId ? `loc=${locationId}` : "default";
  _unsubscribe = onSnapshot(ref, (snap) => {
    if (!_applyState) return;
    const localState = _getState ? _getState() : null;
    // We only treat localStorage as a seed for the "default" (no-location)
    // doc. For per-location docs the cloud is the only source of truth,
    // otherwise switching between locations would copy one branch's queue
    // into another branch's empty cloud doc.
    const isDefaultDoc = queueStateDocIdFor(locationId) === QUEUE_STATE_DEFAULT;
    const localHasAnyData = queueStateHasData(localState);
    const canSeedFromLocal = (isDefaultDoc || preserveRecentLocalWrite) && localHasAnyData;

    if (!snap.exists()) {
      if (shouldDeferBootSnapshot(snap, locationId, false, localHasAnyData)) {
        console.log("[QueueCloud] Defer cached missing-doc snapshot during boot", logTag);
        return;
      }
      if (canSeedFromLocal) {
        console.log("[QueueCloud] No cloud doc, pushing local state", logTag);
        setDoc(ref, {
          queue: localState.queue || [],
          service: localState.service || [],
          log: localState.log || [],
          updatedAt: serverTimestamp()
        }).catch((e) => console.warn("[QueueCloud] Initial write failed", e));
      } else {
        if (!snapshotFromCache(snap) && typeof window !== "undefined") {
          window.__ff_queueCloudServerConfirmed = true;
        }
        _applyState([], [], [], null, { force: true, reason: "queue-cloud-missing-doc" });
        if (typeof _onLogChange === "function") _onLogChange();
      }
      _firstSnapshot = false;
      return;
    }
    const data = snap.data();
    const queue = Array.isArray(data.queue) ? data.queue : [];
    const service = Array.isArray(data.service) ? data.service : [];
    const log = Array.isArray(data.log) ? data.log : [];
    const cloudHasData = (queue.length + service.length + log.length) > 0;

    if (shouldDeferBootSnapshot(snap, locationId, cloudHasData, localHasAnyData)) {
      console.log("[QueueCloud] Defer empty boot snapshot until server data", logTag, {
        fromCache: snapshotFromCache(snap),
      });
      return;
    }

    // On first snapshot for an existing but empty cloud doc, do not seed from
    // localStorage unless this tab just performed a local queue write. Otherwise
    // an old mobile cache can resurrect an employee after the 4 AM cloud reset.
    if (_firstSnapshot && !cloudHasData && preserveRecentLocalWrite && localHasAnyData) {
      console.log("[QueueCloud] Cloud empty but local has data, pushing local", logTag);
      setDoc(ref, {
        queue: localState.queue || [],
        service: localState.service || [],
        log: localState.log || [],
        updatedAt: serverTimestamp()
      }).catch((e) => console.warn("[QueueCloud] Push local failed", e));
      _firstSnapshot = false;
      return;
    }

    _firstSnapshot = false;
    // Mark that an authoritative (non-cache) snapshot has been seen so the app
    // may now accept an empty cloud state as real (e.g. a genuine reset).
    if (!snapshotFromCache(snap) && typeof window !== "undefined") {
      window.__ff_queueCloudServerConfirmed = true;
    }
    // Expose when the cloud queue was last modified so the morning auto-reset
    // can tell "yesterday's leftover queue" (safe to clear on fresh open) from
    // "a queue already used today" (must never be wiped).
    if (typeof window !== "undefined") {
      try {
        const ms = data.updatedAt && typeof data.updatedAt.toMillis === "function"
          ? data.updatedAt.toMillis()
          : (typeof data.updatedAt === "number" ? data.updatedAt : 0);
        if (ms) window.__ff_queueLastCloudUpdateMs = ms;
      } catch (_) {}
    }
    _applyState(queue, service, log);
    if (typeof _onLogChange === "function") _onLogChange();
    // Apply queue settings (ff_queues_v1) from cloud — each location has its
    // own queueState doc, so these settings are already per-location server-side.
    if (data.queueSettings && typeof data.queueSettings === 'object') {
      try {
        localStorage.setItem('ff_queues_v1', JSON.stringify(data.queueSettings));
        console.log("[QueueCloud] Applied queueSettings from cloud", logTag);
      } catch (_) {}
    } else {
      // Cloud doc has no queueSettings for this location — make sure we don't
      // keep the previous location's settings in localStorage.
      try { localStorage.removeItem('ff_queues_v1'); } catch (_) {}
    }
    if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
      try {
        document.dispatchEvent(new CustomEvent('ff-queue-settings-changed', { detail: { reason: 'snapshot-applied', locationId: locationId || null } }));
      } catch (_) {}
    }
  }, (err) => console.error("[QueueCloud] subscribe error", logTag, err));
}

function writeState() {
  if (!_salonId || !_getState) return Promise.resolve();
  const state = _getState();
  if (!state) return Promise.resolve();
  const ref = queueStateRef(_salonId, _locationId);
  const localCounts = stateCounts(state);
  const localEmpty = localCounts.queue + localCounts.service + localCounts.log === 0;
  const reason = queueCloudWriteReason();
  const payload = {
    queue: state.queue || [],
    service: state.service || [],
    log: state.log || [],
    updatedAt: serverTimestamp(),
    lastUpdateReason: reason,
    lastUpdatedByUid: auth.currentUser?.uid || null,
  };
  // Also sync ff_queues_v1 (auto-reset settings + runtime)
  try {
    const raw = localStorage.getItem('ff_queues_v1');
    if (raw) payload.queueSettings = JSON.parse(raw);
  } catch (_) {}
  const commit = () => setDoc(ref, payload).catch((e) => {
    console.warn("[QueueCloud] write failed", e);
  });

  // Stale-device guard (pre-sync): until this device has applied the FIRST cloud
  // snapshot for the active branch, its local queue may be stale — e.g. a device
  // that just opened is still holding an older localStorage cache. Letting it
  // write would overwrite a live cloud queue with stale data (this is how a
  // freshly-opened phone wiped a branch's real queue). While we have not yet
  // reconciled with the cloud, never overwrite a non-empty cloud queue: pull the
  // cloud state instead. Legitimate reset/seed flows set the explicit-empty
  // intent flag and are allowed through unchanged.
  if (_firstSnapshot && !hasExplicitEmptyOverwriteIntent()) {
    return getDocFromServer(ref).then((snap) => {
      if (!snap.exists()) return commit();
      const cloudCounts = stateCounts(snap.data() || {});
      const cloudHasData =
        cloudCounts.queue + cloudCounts.service + cloudCounts.log > 0;
      if (!cloudHasData) return commit();
      console.warn("[QueueCloud] blocked pre-sync overwrite of non-empty cloud state", {
        salonId: _salonId,
        locationId: _locationId || QUEUE_STATE_DEFAULT,
        reason,
        localCounts,
        cloudCounts,
      });
      if (typeof _applyState === "function") {
        const data = snap.data() || {};
        _applyState(
          Array.isArray(data.queue) ? data.queue : [],
          Array.isArray(data.service) ? data.service : [],
          Array.isArray(data.log) ? data.log : []
        );
        if (typeof _onLogChange === "function") _onLogChange();
      }
      return Promise.resolve();
    }).catch((e) => {
      console.warn("[QueueCloud] pre-sync write guard failed; skipping risky write", e);
    });
  }

  if (!localEmpty || hasExplicitEmptyOverwriteIntent()) return commit();

  // Guard against stale tabs/kiosks overwriting a live queue with an all-empty
  // local cache. Legitimate reset flows set __ff_allow_empty_queue_cloud_write_until.
  return getDocFromServer(ref).then((snap) => {
    if (!snap.exists()) return commit();
    const cloudCounts = stateCounts(snap.data() || {});
    const cloudHasData =
      cloudCounts.queue + cloudCounts.service + cloudCounts.log > 0;
    if (!cloudHasData) return commit();

    console.warn("[QueueCloud] blocked empty overwrite of non-empty cloud state", {
      salonId: _salonId,
      locationId: _locationId || QUEUE_STATE_DEFAULT,
      reason,
      localCounts,
      cloudCounts,
    });
    if (typeof _applyState === "function") {
      const data = snap.data() || {};
      _applyState(
        Array.isArray(data.queue) ? data.queue : [],
        Array.isArray(data.service) ? data.service : [],
        Array.isArray(data.log) ? data.log : []
      );
      if (typeof _onLogChange === "function") _onLogChange();
    }
    return Promise.resolve();
  }).catch((e) => {
    console.warn("[QueueCloud] empty write guard failed; skipping risky write", e);
  });
}

/**
 * Call from index.html after queue, service, log and renderQueue, renderService exist.
 * @param {Object} opts
 * @param {function(number[], number[], any[])} opts.applyState - (queue, service, log) => mutate app state and re-render
 * @param {function(): { queue: any[], service: any[], log: any[] }} opts.getState - return current queue, service, log
 * @param {function()} [opts.onLogChange] - optional; called after applying state to refresh log UI
 */
export function initQueueCloud(opts) {
  if (!opts || typeof opts.applyState !== "function" || typeof opts.getState !== "function") {
    console.warn("[QueueCloud] initQueueCloud: applyState and getState required");
    return;
  }
  _applyState = opts.applyState;
  _getState = opts.getState;
  _onLogChange = opts.onLogChange || null;
  function tryConnect() {
    getSalonId().then((sid) => {
      const loc = readActiveLocationId();
      if (sid && (sid !== _salonId || loc !== _locationId)) {
        _salonId = sid;
        _locationId = loc;
        subscribe(sid, loc, { reason: "connect" });
        console.log("[QueueCloud] Subscribed to salon", sid, "location", loc || "(default)");
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
  onAuthStateChanged(auth, () => { tryConnect(); });
  // When the header switcher changes the active branch, swap the Firestore
  // subscription to that branch's queueState doc. The subscribe() helper
  // also clears in-memory queue/service/log so the previous branch's cards
  // don't flash on screen.
  if (typeof document !== "undefined" && !window.__ffQueueCloudLocListenerBound) {
    window.__ffQueueCloudLocListenerBound = true;
    document.addEventListener("ff-active-location-changed", (event) => {
      const loc = readActiveLocationId();
      if (!_salonId) return;
      if (loc === _locationId) return;
      _locationId = loc;
      const reason = event?.detail?.reason || "location-changed";
      subscribe(_salonId, loc, { reason });
      console.log("[QueueCloud] Re-subscribed after location switch →", loc || "(default)");
    });
  }
}

/**
 * Write current queue state to Firestore. Call from save() in index.html.
 */
export function queueCloudWrite() {
  return writeState();
}

/**
 * Persist ONLY the queue settings (ff_queues_v1: Auto Reset, location
 * restriction, runtime) to the per-location queueState doc using merge.
 *
 * This is decoupled from writeState() on purpose: writeState() can be blocked
 * by the empty-queue overwrite guard (when the local queue is empty but the
 * cloud has data), which would silently drop the settings and make the Auto
 * Reset toggle revert to OFF on the next load. A dedicated merge write always
 * lands, regardless of queue contents.
 */
export function queueCloudWriteSettings() {
  if (!_salonId) return Promise.resolve();
  let settings = null;
  try {
    const raw = localStorage.getItem('ff_queues_v1');
    if (raw) settings = JSON.parse(raw);
  } catch (_) {}
  if (!settings || typeof settings !== 'object') return Promise.resolve();
  const ref = queueStateRef(_salonId, _locationId);
  return setDoc(ref, {
    queueSettings: settings,
    updatedAt: serverTimestamp()
  }, { merge: true }).catch((e) => console.warn("[QueueCloud] settings write failed", e));
}

/**
 * Reconnect after salonId or active location might have changed.
 */
export function queueCloudReconnect() {
  getSalonId().then((sid) => {
    const loc = readActiveLocationId();
    if (sid === _salonId && loc === _locationId) return;
    _salonId = sid;
    _locationId = loc;
    if (sid) subscribe(sid, loc, { reason: "reconnect" });
  });
}

/** Fetch current state from server (bypass cache) and apply so other computer sees updates. */
export function queueCloudRefresh() {
  if (!_salonId || !_applyState) return Promise.resolve();
  // Respect cooldown from local writes
  if (typeof window !== "undefined" && (Date.now() - (window.__ff_lastSaveTime || 0)) < 6000) return Promise.resolve();
  const ref = queueStateRef(_salonId, _locationId);
  return getDocFromServer(ref).then((snap) => {
    if (snap.exists()) {
      const data = snap.data();
      const queue = Array.isArray(data.queue) ? data.queue : [];
      const service = Array.isArray(data.service) ? data.service : [];
      const log = Array.isArray(data.log) ? data.log : [];
      _applyState(queue, service, log);
      if (typeof _onLogChange === "function") _onLogChange();
      // Apply queue settings from cloud
      if (data.queueSettings && typeof data.queueSettings === 'object') {
        try { localStorage.setItem('ff_queues_v1', JSON.stringify(data.queueSettings)); } catch (_) {}
      }
    }
  }).catch((e) => console.warn("[QueueCloud] refresh failed", e));
}

if (typeof window !== "undefined") {
  window.initQueueCloud = initQueueCloud;
  window.queueCloudWrite = queueCloudWrite;
  window.queueCloudWriteSettings = queueCloudWriteSettings;
  window.queueCloudReconnect = queueCloudReconnect;
  window.queueCloudRefresh = queueCloudRefresh;
  if (typeof window.__ffQueueCloudInit === "function") {
    window.__ffQueueCloudInit();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (typeof window.queueCloudReconnect === "function") window.queueCloudReconnect();
    if (typeof window.tasksCloudReconnect === "function") window.tasksCloudReconnect();
    setTimeout(() => {
      if (typeof window.queueCloudRefresh === "function") window.queueCloudRefresh();
      if (typeof window.tasksCloudRefresh === "function") window.tasksCloudRefresh();
      if (typeof window.ticketsRefreshAvatars === "function") window.ticketsRefreshAvatars();
    }, 300);
  });

  // Poll every 2s: reconnect then fetch from server so both computers stay in sync
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (typeof window.queueCloudReconnect === "function") window.queueCloudReconnect();
    setTimeout(() => {
      if (typeof window.queueCloudRefresh === "function") window.queueCloudRefresh();
    }, 100);
  }, 2000);
}
