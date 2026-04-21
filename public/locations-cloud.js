/**
 * Locations Cloud Sync — lightweight read-side listener.
 *
 * Collection: salons/{salonId}/locations/{locationId}
 *
 * Mirrors the architecture of staff-cloud.js:
 *  - onSnapshot() maintains an in-memory list in window.ffLocationsState
 *  - localStorage is used as display cache only
 *  - Fires "ff-locations-updated" so UI can re-render
 *
 * Public API:
 *  - window.ffGetLocations()        → array of location docs (active + inactive, sorted by name)
 *  - window.ffGetActiveLocations()  → array filtered by isActive !== false
 *  - window.ffLocationsById()       → map keyed by doc id
 */

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth } from "./app.js?v=20260411_chat_reminder_attrfix";

const LOCATIONS_STORAGE_KEY = "ff_locations_v1";
const LOCATIONS_DEBUG = false;

let _salonId = null;
let _unsub = null;

function dlog(...args) {
  if (LOCATIONS_DEBUG) console.log("[LocationsCloud]", ...args);
}

function _readCache() {
  try {
    const raw = localStorage.getItem(LOCATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.locations) ? parsed.locations : [];
  } catch (e) {
    return [];
  }
}

function _writeCache(list) {
  try {
    localStorage.setItem(
      LOCATIONS_STORAGE_KEY,
      JSON.stringify({ locations: Array.isArray(list) ? list : [] }),
    );
  } catch (e) {}
}

function _sortLocations(list) {
  return (Array.isArray(list) ? list.slice() : []).sort((a, b) => {
    const an = String(a?.name || "").toLowerCase();
    const bn = String(b?.name || "").toLowerCase();
    if (an < bn) return -1;
    if (an > bn) return 1;
    return 0;
  });
}

// State
window.ffLocationsState = {
  locations: _readCache(),
  loaded: false,
  salonId: null,
};

function _dispatch() {
  try {
    document.dispatchEvent(new CustomEvent("ff-locations-updated"));
  } catch (e) {}
}

function _startListener() {
  if (!_salonId) return;
  const path = `salons/${_salonId}/locations`;
  dlog("onSnapshot →", path);

  _unsub = onSnapshot(
    collection(db, path),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const sorted = _sortLocations(list);
      window.ffLocationsState.locations = sorted;
      window.ffLocationsState.loaded = true;
      window.ffLocationsState.salonId = _salonId;
      _writeCache(sorted);
      dlog("updated", sorted.length);
      _dispatch();
    },
    (err) => {
      console.warn("[LocationsCloud] onSnapshot error:", err?.code, err?.message);
    },
  );
}

onAuthStateChanged(auth, async (user) => {
  if (_unsub) {
    _unsub();
    _unsub = null;
  }
  if (!user) {
    _salonId = null;
    window.ffLocationsState.loaded = false;
    window.ffLocationsState.salonId = null;
    return;
  }

  for (let i = 0; i < 40; i++) {
    if (window.currentSalonId) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  _salonId = window.currentSalonId;
  if (!_salonId) {
    console.warn("[LocationsCloud] No salonId — aborting");
    return;
  }

  _startListener();
});

window.ffGetLocations = function () {
  const list = Array.isArray(window.ffLocationsState?.locations)
    ? window.ffLocationsState.locations
    : [];
  return _sortLocations(list);
};

window.ffGetActiveLocations = function () {
  return window.ffGetLocations().filter((loc) => loc && loc.isActive !== false);
};

window.ffLocationsById = function () {
  const map = {};
  window.ffGetLocations().forEach((loc) => {
    if (loc && loc.id) map[loc.id] = loc;
  });
  return map;
};

/**
 * Force a fresh read from Firestore (used e.g. before opening Staff Member modal
 * if the snapshot hasn't landed yet).
 */
window.ffLocationsForceLoad = async function () {
  if (!_salonId) return;
  try {
    const snap = await getDocs(collection(db, `salons/${_salonId}/locations`));
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const sorted = _sortLocations(list);
    window.ffLocationsState.locations = sorted;
    window.ffLocationsState.loaded = true;
    window.ffLocationsState.salonId = _salonId;
    _writeCache(sorted);
    _dispatch();
  } catch (e) {
    console.warn("[LocationsCloud] ForceLoad error:", e?.code, e?.message);
  }
};
