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
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";

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
/**
 * Persist salon GPS fence onto the location doc (cloud source of truth).
 * Queue localStorage is not authoritative — punches read this from the server.
 */
window.ffSaveLocationGeoFence = async function (locationId, fence) {
  const locId = String(locationId || "").trim();
  const sid = _salonId || (typeof window.currentSalonId === "string" ? window.currentSalonId : "");
  if (!sid || !locId || locId === "default") {
    return { ok: false, reason: "no-location" };
  }
  const lat = Number(fence && fence.lat);
  const lng = Number(fence && fence.lng);
  const radius = Math.round(Number(fence && fence.allowedRadiusMeters));
  try {
    await updateDoc(doc(db, `salons/${sid}/locations`, locId), {
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      allowedRadiusMeters: Number.isFinite(radius) && radius > 0 ? radius : 100,
      enforceQueue: !!(fence && fence.enforceQueue === true),
      enforceTimeClock: !!(fence && fence.enforceTimeClock === true),
      geoAccuracy: Number.isFinite(Number(fence && fence.accuracy))
        ? Math.round(Number(fence.accuracy))
        : null,
      geoUpdatedAt: Number.isFinite(Number(fence && fence.updatedAt))
        ? Number(fence.updatedAt)
        : Date.now(),
      updatedAt: serverTimestamp(),
    });
    return { ok: true };
  } catch (e) {
    console.warn("[LocationsCloud] ffSaveLocationGeoFence failed", e);
    return { ok: false, reason: "write-error", error: String((e && e.message) || e) };
  }
};

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
