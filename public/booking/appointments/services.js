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

async function loadLocationCatalog() {
  const sid = salonId();
  const loc = locationId();
  if (!sid) return { services: [], categories: [] };
  const [svcSnap, catSnap] = await Promise.all([
    getDocs(collection(db, `salons/${sid}/services`)),
    getDocs(collection(db, `salons/${sid}/serviceCategories`)).catch(() => ({ docs: [] }))
  ]);
  const categories = catSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  const catById = {};
  categories.forEach((cat) => { catById[cat.id] = cat; });
  const services = svcSnap.docs.map((docSnap) => {
    const row = { id: docSnap.id, ...docSnap.data() };
    const rawLoc = typeof row.locationId === "string" ? row.locationId.trim() : "";
    if (loc && rawLoc && rawLoc !== loc) return null;
    const cat = row.categoryId ? catById[row.categoryId] : null;
    if (cat && cat.name && !String(row.category || "").trim()) row.category = cat.name;
    return row;
  }).filter(Boolean);
  return { services, categories };
}

async function loadCatalog() {
  const shared = await loadSharedCatalogForManager();
  const sharedRows = Array.isArray(shared && shared.services) ? shared.services : [];
  const sharedCats = Array.isArray(shared && shared.categories) ? shared.categories : [];
  if (sharedRows.length) return { services: sharedRows, categories: sharedCats };
  return loadLocationCatalog();
}

function categoryKey(name) {
  return String(name || "").trim().toLowerCase();
}

function categoryRanks(categories) {
  const ranks = {};
  (categories || []).forEach((cat, index) => {
    const key = categoryKey(cat && cat.name);
    if (!key || ranks[key] != null) return;
    ranks[key] = Number.isFinite(Number(cat.sortOrder)) ? Number(cat.sortOrder) : index;
  });
  return ranks;
}

function toPickerRow(service, providerId, ranks) {
  const category = String(service.category || "").trim();
  const key = categoryKey(category);
  return {
    id: service.id,
    name: String(service.name || "").trim(),
    durationMinutes: providerId ? effectiveDuration(service, providerId) : resolveServiceDurationMinutes(service),
    defaultDurationMinutes: resolveServiceDurationMinutes(service),
    price: effectivePrice(service),
    category,
    categoryKey: key,
    categorySortOrder: ranks && ranks[key] != null ? ranks[key] : 999,
    sortOrder: Number.isFinite(Number(service.sortOrder)) ? Number(service.sortOrder) : 999,
    staffOverrides: service.staffOverrides || {},
    raw: service,
  };
}

function sortPickerRows(rows) {
  return (rows || []).slice().sort((a, b) => {
    if (a.categorySortOrder !== b.categorySortOrder) return a.categorySortOrder - b.categorySortOrder;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name);
  });
}

function pickerRowsFromCatalog(catalog, providerId) {
  const ranks = categoryRanks(catalog && catalog.categories);
  return sortPickerRows(
    ((catalog && catalog.services) || [])
      .filter((service) => isActive(service) && (!providerId || isCapable(service, providerId)))
      .map((service) => toPickerRow(service, providerId, ranks))
  );
}

async function listAll() {
  return pickerRowsFromCatalog(await loadCatalog());
}

async function listForProvider(providerId) {
  return pickerRowsFromCatalog(await loadCatalog(), providerId);
}

function getById(list, serviceId) {
  const id = String(serviceId || "").trim();
  return (list || []).find((row) => row.id === id) || null;
}

const api = {
  listAll,
  listForProvider,
  getById,
  isCapable,
  isActive,
  effectivePrice,
  effectiveDuration,
};

window.ffBookingAppointmentServices = api;
export {
  listAll,
  listForProvider,
  getById,
  isCapable,
  isActive,
  effectivePrice,
  effectiveDuration,
};
