/**
 * Tasks Analytics — data readers.
 *
 * Self-contained access to the Tasks data sources: window globals, localStorage
 * and a read-only Firestore fallback (tasksState doc). Extracted verbatim from
 * tasks-analytics.js. Also owns the low-level shared primitives (LOG, TABS,
 * KINDS, clean, safeArr) used across the tasks-analytics modules. No DOM,
 * no Firestore writes.
 */

import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";

export const LOG = "[TasksAnalytics]";
export const TABS = ["opening", "closing", "weekly", "monthly", "yearly"];
export const KINDS = ["active", "pending", "done"];

export function clean(value) {
  return value == null ? "" : String(value).trim();
}

export function safeArr(value) {
  return Array.isArray(value) ? value : [];
}

export function getActiveLocationId() {
  try {
    if (typeof window.ffGetActiveLocationId === "function") {
      const id = clean(window.ffGetActiveLocationId());
      if (id) return id;
    }
  } catch (_) {}
  try {
    return clean(window.__ff_active_location_id || window.activeLocationId || window.currentLocationId);
  } catch (_) {
    return "";
  }
}

export function getLocationLabel() {
  const id = getActiveLocationId();
  let name = "";
  try {
    const lists = [
      typeof window.ffGetActiveLocations === "function" ? window.ffGetActiveLocations() : null,
      typeof window.ffGetLocations === "function" ? window.ffGetLocations() : null,
      window.ffLocationsState?.locations,
    ];
    for (const list of lists) {
      const match = safeArr(list).find((loc) => clean(loc?.id || loc?.locationId) === id);
      if (match) {
        name = clean(match.name || match.label || match.title || id);
        break;
      }
    }
  } catch (_) {}
  return id ? `${name || id}` : "Select location";
}

async function getSalonId() {
  try {
    if (window.currentSalonId) return clean(window.currentSalonId);
  } catch (_) {}
  try {
    const cached = localStorage.getItem("ff_salonId_v1");
    if (cached) return clean(cached);
  } catch (_) {}
  try {
    const uid = auth?.currentUser?.uid;
    if (!uid) return "";
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? clean(snap.data()?.salonId) : "";
  } catch (err) {
    console.warn(LOG, "salon lookup failed", err);
    return "";
  }
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function stateFromLocalStorage() {
  const state = { catalog: readJson("ff_tasks_catalog_v1", {}) || {} };
  TABS.forEach((tab) => {
    state[tab] = {};
    KINDS.forEach((kind) => {
      state[tab][kind] = readJson(`ff_tasks_${tab}_${kind}_v1`, []);
    });
  });
  return state;
}

function stateHasRows(state) {
  return TABS.some((tab) => KINDS.some((kind) => safeArr(state?.[tab]?.[kind]).length));
}

export async function readTasksState() {
  const candidates = [];
  try {
    if (window.tasksCache && typeof window.tasksCache === "object") {
      candidates.push({ source: "window.tasksCache", state: window.tasksCache });
    }
  } catch (_) {}

  candidates.push({ source: "localStorage", state: stateFromLocalStorage() });

  const cached = candidates.find((item) => stateHasRows(item.state));
  if (cached) {
    console.log(LOG, "data source detected", cached.source);
    return cached;
  }

  const salonId = await getSalonId();
  const locationId = getActiveLocationId();
  if (salonId) {
    try {
      const snap = await getDoc(doc(db, `salons/${salonId}/tasksState`, locationId || "default"));
      if (snap.exists()) {
        const state = snap.data() || {};
        console.log(LOG, "data source detected", "Firestore tasksState");
        return { source: "Firestore tasksState", state };
      }
    } catch (err) {
      console.warn(LOG, "tasksState fallback failed", err);
    }
  }

  console.log(LOG, "no task data source found");
  return { source: "none", state: {} };
}
