/**
 * Booking availability request store.
 * One salon-level observer for approved Operations schedule exceptions.
 * Calendar cells do not subscribe to Firestore.
 */
import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { isApprovedRequest } from "/schedule-availability.js?v=20260615_default_schedule_source";

const SCHEDULE_TYPES = new Set([
  "vacation",
  "late_start",
  "early_leave",
  "schedule_change",
  "day_off",
  "time_off",
]);

let salonId = "";
let items = [];
let loaded = false;
let loading = null;
let unsub = null;

function currentSalonId() {
  return String(window.currentSalonId || "").trim();
}

function isManager() {
  const role = String(window.__ff_user_role || "").toLowerCase();
  return role === "owner" || role === "admin" || role === "manager";
}

function currentUid() {
  try {
    const auth = window.ffAuth || window.auth || null;
    return auth && auth.currentUser && auth.currentUser.uid
      ? String(auth.currentUser.uid).trim()
      : "";
  } catch (_) {
    return "";
  }
}

function mapDoc(docSnap) {
  return { id: docSnap.id, ...docSnap.data() };
}

function keepScheduleType(item) {
  return SCHEDULE_TYPES.has(String(item && item.type || "").trim());
}

function keepLocation(item, locationId) {
  const loc = String(locationId || "").trim();
  if (!loc) return true;
  const raw = item && typeof item.locationId === "string" ? item.locationId.trim() : "";
  const effective = raw || "default";
  return effective === loc;
}

function emitChanged() {
  try {
    document.dispatchEvent(new CustomEvent("ff-booking-availability-changed"));
  } catch (_) {}
}

function setItems(next) {
  const filtered = (Array.isArray(next) ? next : []).filter(keepScheduleType).filter(isApprovedRequest);
  const prev = JSON.stringify(items.map((item) => item.id).sort());
  items = filtered;
  loaded = true;
  const after = JSON.stringify(items.map((item) => item.id).sort());
  if (prev !== after) emitChanged();
}

function inboxRef(id) {
  return collection(db, `salons/${id}/inboxItems`);
}

async function loadOnce(id) {
  const statusApproved = ["approved", "done", "archived"];
  const ref = inboxRef(id);
  if (isManager()) {
    const snap = await getDocs(query(ref, where("status", "in", statusApproved)));
    setItems(snap.docs.map(mapDoc));
    return;
  }
  const uid = currentUid();
  if (!uid) {
    setItems([]);
    return;
  }
  const [snapFor, snapBy] = await Promise.all([
    getDocs(query(ref, where("forUid", "==", uid))),
    getDocs(query(ref, where("createdByUid", "==", uid))),
  ]);
  const byId = new Map();
  snapFor.docs.forEach((docSnap) => byId.set(docSnap.id, docSnap));
  snapBy.docs.forEach((docSnap) => byId.set(docSnap.id, docSnap));
  setItems([...byId.values()].map(mapDoc).filter((item) => statusApproved.includes(String(item.status || "").trim())));
}

function startListener(id) {
  if (unsub) {
    try { unsub(); } catch (_) {}
    unsub = null;
  }
  const statusApproved = ["approved", "done", "archived"];
  const ref = inboxRef(id);
  try {
    if (isManager()) {
      unsub = onSnapshot(
        query(ref, where("status", "in", statusApproved)),
        (snap) => setItems(snap.docs.map(mapDoc)),
        (error) => {
          console.warn("[BookingAvailability] inbox listener failed; using last snapshot", error);
        }
      );
      return;
    }
    const uid = currentUid();
    if (!uid) return;
    const byId = new Map();
    const apply = () => setItems([...byId.values()]);
    const unsubFor = onSnapshot(query(ref, where("forUid", "==", uid)), (snap) => {
      snap.docs.forEach((docSnap) => byId.set(docSnap.id, mapDoc(docSnap)));
      apply();
    });
    const unsubBy = onSnapshot(query(ref, where("createdByUid", "==", uid)), (snap) => {
      snap.docs.forEach((docSnap) => byId.set(docSnap.id, mapDoc(docSnap)));
      apply();
    });
    unsub = () => {
      try { unsubFor(); } catch (_) {}
      try { unsubBy(); } catch (_) {}
    };
  } catch (error) {
    console.warn("[BookingAvailability] could not attach inbox listener", error);
  }
}

async function ensureLoaded() {
  const id = currentSalonId();
  if (!id) return [];
  if (salonId === id && loaded) return items;
  if (loading && salonId === id) return loading;
  salonId = id;
  loading = loadOnce(id)
    .catch((error) => {
      console.warn("[BookingAvailability] failed to load approved schedule requests", error);
      setItems([]);
    })
    .then(() => {
      startListener(id);
      loading = null;
      return items;
    });
  return loading;
}

function getApprovedRequests(locationId) {
  return items.filter((item) => keepLocation(item, locationId));
}

window.ffBookingAvailabilityStore = {
  ensureLoaded,
  getApprovedRequests,
  isLoaded: function () { return loaded && salonId === currentSalonId(); },
};

ensureLoaded();
