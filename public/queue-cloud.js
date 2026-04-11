/**
 * Queue Cloud – sync QUEUE (Available + In service + History log) to Firestore.
 * Replaces localStorage for queue/service/log when user is signed in and has salonId.
 * Firestore: salons/{salonId}/queueState/default  →  { queue, service, log, updatedAt }
 */

import { doc, getDoc, getDocFromServer, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth } from "./app.js?v=20260412_imports_first";

const QUEUE_STATE_DOC = "default";
let _salonId = null;
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

function queueStateRef(salonId) {
  return doc(db, `salons/${salonId}/queueState`, QUEUE_STATE_DOC);
}

let _firstSnapshot = true;

function subscribe(salonId) {
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }
  _firstSnapshot = true;
  const ref = queueStateRef(salonId);
  _unsubscribe = onSnapshot(ref, (snap) => {
    if (!_applyState) return;
    const localState = _getState ? _getState() : null;
    const localHasData = localState &&
      ((localState.queue?.length || 0) + (localState.service?.length || 0) + (localState.log?.length || 0)) > 0;

    if (!snap.exists()) {
      if (localHasData) {
        console.log("[QueueCloud] No cloud doc, pushing local state");
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

    // On first snapshot: if cloud is empty but local has data, push local to cloud
    if (_firstSnapshot && !cloudHasData && localHasData) {
      console.log("[QueueCloud] Cloud empty but local has data, pushing local");
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
    // Apply queue settings (ff_queues_v1) from cloud
    if (data.queueSettings && typeof data.queueSettings === 'object') {
      try {
        localStorage.setItem('ff_queues_v1', JSON.stringify(data.queueSettings));
        console.log("[QueueCloud] Applied queueSettings from cloud");
      } catch (_) {}
    }
  }, (err) => console.error("[QueueCloud] subscribe error", err));
}

function writeState() {
  if (!_salonId || !_getState) return Promise.resolve();
  const state = _getState();
  if (!state) return Promise.resolve();
  const ref = queueStateRef(_salonId);
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
      if (sid && sid !== _salonId) {
        _salonId = sid;
        subscribe(sid);
        console.log("[QueueCloud] Subscribed to salon", sid);
      } else if (!sid) {
        _salonId = null;
        if (_unsubscribe) {
          _unsubscribe();
          _unsubscribe = null;
        }
      }
    });
  }
  tryConnect();
  onAuthStateChanged(auth, () => { tryConnect(); });
}

/**
 * Write current queue state to Firestore. Call from save() in index.html.
 */
export function queueCloudWrite() {
  return writeState();
}

/**
 * Reconnect after salonId might have changed (e.g. after login or profile load).
 */
export function queueCloudReconnect() {
  getSalonId().then((sid) => {
    if (sid === _salonId) return;
    _salonId = sid;
    if (sid) subscribe(sid);
  });
}

/** Fetch current state from server (bypass cache) and apply so other computer sees updates. */
export function queueCloudRefresh() {
  if (!_salonId || !_applyState) return Promise.resolve();
  // Respect cooldown from local writes
  if (typeof window !== "undefined" && (Date.now() - (window.__ff_lastSaveTime || 0)) < 5000) return Promise.resolve();
  const ref = queueStateRef(_salonId);
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
