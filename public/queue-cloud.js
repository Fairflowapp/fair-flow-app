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
import { db, auth } from "./app.js?v=20260411_chat_reminder_attrfix";

const QUEUE_STATE_DEFAULT = "default";
let _salonId = null;
let _locationId = null;
let _unsubscribe = null;
let _applyState = null;
let _getState = null;
let _onLogChange = null;

async function getSalonId() {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) {
      const data = userDoc.data();
      return data.salonId || (typeof window !== "undefined" ? window.currentSalonId : null) || null;
    }
  } catch (e) {
    console.warn("[QueueCloud] getSalonId failed", e);
  }
  return typeof window !== "undefined" ? window.currentSalonId : null;
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

/** doc id for the queueState document — locationId per branch, otherwise "default". */
function queueStateDocIdFor(locationId) {
  const v = typeof locationId === "string" ? locationId.trim() : "";
  return v || QUEUE_STATE_DEFAULT;
}

function queueStateRef(salonId, locationId) {
  return doc(db, `salons/${salonId}/queueState`, queueStateDocIdFor(locationId));
}

let _firstSnapshot = true;

function subscribe(salonId, locationId) {
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }
  _firstSnapshot = true;
  // CRITICAL: clear the in-memory queue/service/log so the old location's
  // data doesn't flash on screen while we wait for the new snapshot.
  // Without this, switching branches shows the previous branch's queue for
  // a fraction of a second until Firestore responds.
  if (typeof _applyState === "function") {
    try { _applyState([], [], []); } catch (_) {}
    if (typeof _onLogChange === "function") {
      try { _onLogChange(); } catch (_) {}
    }
  }
  // Clear ff_queues_v1 (Queue Auto Reset + GeoFence settings) on location
  // switch so the previous branch's settings don't leak into the new branch.
  // The cloud snapshot below will repopulate it if the new location has its
  // own queueSettings; otherwise defaults take effect for this location.
  try {
    localStorage.removeItem('ff_queues_v1');
    if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
      document.dispatchEvent(new CustomEvent('ff-queue-settings-changed', { detail: { reason: 'location-switch' } }));
    }
  } catch (_) {}
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
    const localHasData = isDefaultDoc && localState &&
      ((localState.queue?.length || 0) + (localState.service?.length || 0) + (localState.log?.length || 0)) > 0;

    if (!snap.exists()) {
      if (localHasData) {
        console.log("[QueueCloud] No cloud doc, pushing local state", logTag);
        setDoc(ref, {
          queue: localState.queue || [],
          service: localState.service || [],
          log: localState.log || [],
          updatedAt: serverTimestamp()
        }).catch((e) => console.warn("[QueueCloud] Initial write failed", e));
      }
      _firstSnapshot = false;
      return;
    }
    const data = snap.data();
    const queue = Array.isArray(data.queue) ? data.queue : [];
    const service = Array.isArray(data.service) ? data.service : [];
    const log = Array.isArray(data.log) ? data.log : [];
    const cloudHasData = (queue.length + service.length + log.length) > 0;

    // On first snapshot: if cloud is empty but local has data, push local to
    // cloud. Only allowed for the "default" doc — see comment above.
    if (_firstSnapshot && !cloudHasData && localHasData) {
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
  const payload = {
    queue: state.queue || [],
    service: state.service || [],
    log: state.log || [],
    updatedAt: serverTimestamp()
  };
  // Also sync ff_queues_v1 (auto-reset settings + runtime)
  try {
    const raw = localStorage.getItem('ff_queues_v1');
    if (raw) payload.queueSettings = JSON.parse(raw);
  } catch (_) {}
  return setDoc(ref, payload).catch((e) => {
    console.warn("[QueueCloud] write failed", e);
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
        subscribe(sid, loc);
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
    document.addEventListener("ff-active-location-changed", () => {
      const loc = readActiveLocationId();
      if (!_salonId) return;
      if (loc === _locationId) return;
      _locationId = loc;
      subscribe(_salonId, loc);
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
 * Reconnect after salonId or active location might have changed.
 */
export function queueCloudReconnect() {
  getSalonId().then((sid) => {
    const loc = readActiveLocationId();
    if (sid === _salonId && loc === _locationId) return;
    _salonId = sid;
    _locationId = loc;
    if (sid) subscribe(sid, loc);
  });
}

/** Fetch current state from server (bypass cache) and apply so other computer sees updates. */
export function queueCloudRefresh() {
  if (!_salonId || !_applyState) return Promise.resolve();
  // Respect cooldown from local writes
  if (typeof window !== "undefined" && (Date.now() - (window.__ff_lastSaveTime || 0)) < 5000) return Promise.resolve();
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
    if (typeof window.tasksCloudReconnect === "function") window.tasksCloudReconnect();
    setTimeout(() => {
      if (typeof window.queueCloudRefresh === "function") window.queueCloudRefresh();
      if (typeof window.tasksCloudRefresh === "function") window.tasksCloudRefresh();
    }, 100);
  }, 2000);
}
