/**
 * Booking consumer of the existing Operations Services catalog.
 * Does not own a Booking catalog. Duration comes from resolveServiceDurationForStaff.
 */
import {
  loadSharedCatalogForManager,
  resolveServiceDurationForStaff,
  resolveServiceDurationMinutes,
} from "/tickets-catalog-data.js?v=20260818_staff_dur_ui";
import {
  collection,
  getDocs,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";

function salonId() {
  return String(window.currentSalonId || "").trim();
}

function locationId() {
  try {
    if (typeof window.ffGetActiveLocationId === "function") {
      const value = String(window.ffGetActiveLocationId() || "").trim();
      if (value) return value;
    }
  } catch (_) {}
  return String(window.__ff_active_location_id || "").trim();
}

function isCapable(service, providerId) {
  const id = String(providerId || "").trim();
  const overrides = service && service.staffOverrides && typeof service.staffOverrides === "object"
    ? service.staffOverrides
    : {};
  const override = id && overrides[id] && typeof overrides[id] === "object" ? overrides[id] : null;
  return !(override && override.enabled === false);
}

function isActive(service) {
  if (!service) return false;
  if (service.active === false) return false;
  if (service.locationEnabled === false) return false;
  return !!String(service.name || "").trim();
}

function effectivePrice(service) {
  const n = Number(service && service.defaultPrice);
  return Number.isFinite(n) ? n : 0;
}

function effectiveDuration(service, providerId) {
  return resolveServiceDurationForStaff(service, providerId);
}

async function loadLocationServices() {
  const sid = salonId();
  const loc = locationId();
  if (!sid) return [];
  const snap = await getDocs(collection(db, `salons/${sid}/services`));
  return snap.docs.map((docSnap) => {
    const row = { id: docSnap.id, ...docSnap.data() };
    const rawLoc = typeof row.locationId === "string" ? row.locationId.trim() : "";
    if (loc && rawLoc && rawLoc !== loc) return null;
    return row;
  }).filter(Boolean);
}

async function loadCatalog() {
  const shared = await loadSharedCatalogForManager();
  const sharedRows = Array.isArray(shared && shared.services) ? shared.services : [];
  if (sharedRows.length) return sharedRows;
  return loadLocationServices();
}

async function listForProvider(providerId) {
  const rows = await loadCatalog();
  return rows
    .filter((service) => isActive(service) && isCapable(service, providerId))
    .map((service) => ({
      id: service.id,
      name: String(service.name || "").trim(),
      durationMinutes: effectiveDuration(service, providerId),
      defaultDurationMinutes: resolveServiceDurationMinutes(service),
      price: effectivePrice(service),
      staffOverrides: service.staffOverrides || {},
      raw: service,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getById(list, serviceId) {
  const id = String(serviceId || "").trim();
  return (list || []).find((row) => row.id === id) || null;
}

const api = {
  listForProvider,
  getById,
  isCapable,
  isActive,
  effectivePrice,
  effectiveDuration,
};

window.ffBookingAppointmentServices = api;
export {
  listForProvider,
  getById,
  isCapable,
  isActive,
  effectivePrice,
  effectiveDuration,
};
