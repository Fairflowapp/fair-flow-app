/**
 * Tasks Cloud – sync TASKS (catalog, active/pending/done per tab, tombstone, alertWindows, enforceSelect) to Firestore.
 * When user is signed in and has salonId, tasks state is read/written from salons/{salonId}/tasksState/default.
 * Firestore doc: { catalog, opening, closing, weekly, monthly, yearly, tombstone, alertWindows, enforceSelectSettings, updatedAt }
 */

import { doc, getDoc, getDocFromServer, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { db, auth } from "./app.js";

const TASKS_STATE_DOC = "default";
const TABS = ["opening", "closing", "weekly", "monthly", "yearly"];
const KINDS = ["active", "pending", "done"];

let _salonId = null;
let _unsubscribe = null;
let _applyState = null;
let _getState = null;
let _onRefresh = null;
let _writeTimeout = null;

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
    console.warn("[TasksCloud] getSalonId failed", e);
  }
  return typeof window !== "undefined" ? window.currentSalonId : null;
}

function tasksStateRef(salonId) {
  return doc(db, `salons/${salonId}/tasksState`, TASKS_STATE_DOC);
}

function subscribe(salonId) {
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }
  const ref = tasksStateRef(salonId);
  _unsubscribe = onSnapshot(ref, (snap) => {
    if (!_applyState) return;
    if (!snap.exists()) {
      const state = _getState ? _getState() : null;
      if (state) {
        setDoc(ref, buildFirestoreState(state)).catch((e) => console.warn("[TasksCloud] Initial write failed", e));
      }
      return;
    }
    const data = snap.data();
    _applyState(data);
    if (typeof _onRefresh === "function") _onRefresh();
  }, (err) => console.error("[TasksCloud] subscribe error", err));
}

function buildFirestoreState(state) {
  const out = {
    catalog: state.catalog || {},
    tombstone: state.tombstone || {},
    alertWindows: state.alertWindows || {},
    enforceSelectSettings: state.enforceSelectSettings || {},
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
  return setDoc(tasksStateRef(_salonId), buildFirestoreState(state)).catch((e) => {
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
      if (sid && sid !== _salonId) {
        _salonId = sid;
        subscribe(sid);
        console.log("[TasksCloud] Subscribed to salon", sid);
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
  onAuthStateChanged(auth, () => {
    tryConnect();
  });
}

export function tasksCloudWrite() {
  return writeState();
}

export function tasksCloudReconnect() {
  getSalonId().then((sid) => {
    if (sid === _salonId) return;
    _salonId = sid;
    if (sid) subscribe(sid);
  });
}

/** Force fetch current state from server (bypass cache) and apply so other computer sees updates. */
export function tasksCloudRefresh() {
  if (!_salonId || !_applyState) return Promise.resolve();
  if (typeof window !== "undefined" && window.__ffTasksLastLocalWrite != null && (Date.now() - window.__ffTasksLastLocalWrite) < 12000) return Promise.resolve();
  const ref = tasksStateRef(_salonId);
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

if (typeof window !== "undefined") {
  window.initTasksCloud = initTasksCloud;
  window.tasksCloudWrite = tasksCloudWrite;
  window.tasksCloudReconnect = tasksCloudReconnect;
  window.tasksCloudRefresh = tasksCloudRefresh;
  if (typeof window.__ffTasksCloudInit === "function") {
    window.__ffTasksCloudInit();
  }
}
