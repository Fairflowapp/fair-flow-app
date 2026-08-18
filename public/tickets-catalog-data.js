/**
 * Tickets — service catalog DATA layer (Phase 3 extraction).
 *
 * Verbatim move of the per-location + shared service catalog data system from
 * tickets.js: account/refs helpers, shared-catalog load/apply/save, location
 * catalog, live onSnapshot subscriptions, services & serviceCategories CRUD.
 *
 * Depends on ticketsState (state) and getActiveLocationIdForTickets (permissions).
 * The two UI refresh callbacks it triggers (renderServicesCatalogV2, setupTicketsUI)
 * live in tickets.js and are injected via initTicketsCatalogData to avoid a cycle.
 */
import { collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, deleteField, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { getActiveLocationIdForTickets } from "./tickets-permissions.js?v=20260630_tickets_permissions_split";

let renderServicesCatalogV2, setupTicketsUI;
export function initTicketsCatalogData(deps) {
  renderServicesCatalogV2 = deps.renderServicesCatalogV2;
  setupTicketsUI = deps.setupTicketsUI;
}

// =====================
// Service Catalog (PER-LOCATION, real-time)
// =====================
// Each branch has its own catalog. Services and categories are stamped with
// `locationId`. Documents without a `locationId` are LEGACY (pre-multi-
// location) — they're hidden from the UI and auto-deleted once on the first
// load after this version ships, because the user explicitly chose "fresh
// start" when we redesigned the catalog. Auto-wipe is best-effort: a
// permission error simply leaves the legacy docs in Firestore (still
// hidden) so the UI never breaks.
//
// Two `onSnapshot` subscriptions keep `_rawServices` / `_rawCategories`
// live. Whenever either changes, or the active branch changes, we re-apply
// the location filter into `salonServices` / `serviceCategories` and
// re-render the UI. This is why a technician sees new services the moment
// an owner adds them — no refresh needed.

// Permission gates for the Services catalog. Default to allow when the helper
// isn't available yet (e.g. very early load) so we never hard-block the owner.
function ffCanViewServices() {
  try {
    if (typeof window.ffCurrentUserHasServicesViewPermission === 'function') {
      return window.ffCurrentUserHasServicesViewPermission();
    }
  } catch (_) {}
  return true;
}
function ffCanManageServices() {
  try {
    if (typeof window.ffCurrentUserHasServicesManagePermission === 'function') {
      return window.ffCurrentUserHasServicesManagePermission();
    }
  } catch (_) {}
  return true;
}

function getTicketsAccountId() {
  const candidates = [
    (typeof window !== 'undefined' ? window.currentSalonId : null),
    ticketsState.currentUserProfile?.accountId,
    ticketsState.currentUserProfile?.accountID,
    ticketsState.currentUserProfile?.account_id,
    ticketsState.currentUserProfile?.salonId,
    (typeof window !== 'undefined' ? window.currentAccountId : null),
    (typeof window !== 'undefined' ? window.accountId : null)
  ];
  for (const v of candidates) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function normalizeSharedCategoryName(category) {
  const s = String(category || '').trim();
  return s || 'Other';
}

function sharedCategoryId(category) {
  return `shared:${normalizeSharedCategoryName(category).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'other'}`;
}

function serviceCatalogStableKey(name, category) {
  return `${normalizeSharedCategoryName(category).toLowerCase()}::${String(name || '').trim().toLowerCase()}`;
}

function serviceCategoryDisplayId(categoryName) {
  return sharedCategoryId(normalizeSharedCategoryName(categoryName));
}

const DEFAULT_SERVICE_DURATION_MINUTES = 30;
const MAX_SERVICE_DURATION_MINUTES = 1440;

function isValidServiceDurationMinutes(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && Number.isInteger(n) && n >= 1 && n <= MAX_SERVICE_DURATION_MINUTES;
}

function resolveServiceDurationMinutes(service) {
  const raw = service?.durationMinutes ?? service?.duration ?? service?.defaultDuration ?? service?.minutes;
  if (raw == null || raw === '') return DEFAULT_SERVICE_DURATION_MINUTES;
  const n = Number(raw);
  return isValidServiceDurationMinutes(n) ? n : DEFAULT_SERVICE_DURATION_MINUTES;
}

/** Empty input → 30. Invalid → null so the caller can flash the field. */
function parseServiceDurationMinutesInput(raw) {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '') return DEFAULT_SERVICE_DURATION_MINUTES;
  const n = Number(trimmed);
  return isValidServiceDurationMinutes(n) ? n : null;
}

function applyDurationMinutesToServicePayload(payload, service, isCreate) {
  if (isCreate) {
    payload.durationMinutes = isValidServiceDurationMinutes(Number(service?.durationMinutes))
      ? Number(service.durationMinutes)
      : DEFAULT_SERVICE_DURATION_MINUTES;
    return;
  }
  if (!service || !Object.prototype.hasOwnProperty.call(service, 'durationMinutes')) return;
  payload.durationMinutes = isValidServiceDurationMinutes(Number(service.durationMinutes))
    ? Number(service.durationMinutes)
    : DEFAULT_SERVICE_DURATION_MINUTES;
}

function sharedServiceCatalogDocRef(accountId) {
  return doc(db, `accounts/${accountId}/shared/serviceCatalog`);
}

function sharedServiceCatalogItemsRef(accountId) {
  return collection(db, `accounts/${accountId}/shared/serviceCatalog/items`);
}

function sharedServiceCategoriesDocRef(accountId) {
  return doc(db, `accounts/${accountId}/shared/serviceCategories`);
}

function sharedServiceCategoryItemsRef(accountId) {
  return collection(db, `accounts/${accountId}/shared/serviceCategories/items`);
}

async function ensureSharedServiceCatalogDoc(accountId) {
  if (!accountId) return;
  await setDoc(sharedServiceCatalogDocRef(accountId), {}, { merge: true });
}

async function ensureSharedServiceCategoriesDoc(accountId) {
  if (!accountId) return;
  await setDoc(sharedServiceCategoriesDocRef(accountId), {}, { merge: true });
}

async function loadSharedServiceOverrides(accountId, locationId) {
  ticketsState._rawServiceOverrides = {};
  if (!accountId || !locationId) return {};
  try {
    const snap = await getDocs(collection(db, `accounts/${accountId}/locations/${locationId}/serviceOverrides`));
    snap.docs.forEach((d) => {
      const data = d.data() || {};
      const price = Number(data.price);
      const override = {};
      if (Number.isFinite(price)) override.price = price;
      if (typeof data.enabled === 'boolean') override.enabled = data.enabled;
      if (Object.keys(override).length) ticketsState._rawServiceOverrides[d.id] = override;
    });
  } catch (e) {
    console.warn('[SharedServices] overrides load failed', e);
  }
  return ticketsState._rawServiceOverrides;
}

function applySharedServiceCatalog() {
  const categoryMap = new Map();
  ticketsState._rawSharedCategories.forEach((c, idx) => {
    const name = normalizeSharedCategoryName(c?.name);
    const categoryId = sharedCategoryId(name);
    if (!categoryMap.has(categoryId)) {
      categoryMap.set(categoryId, {
        id: categoryId,
        name,
        sortOrder: Number.isFinite(Number(c?.sortOrder)) ? Number(c.sortOrder) : idx,
        isSharedCategory: true
      });
    }
  });
  const sharedServices = ticketsState._rawSharedServices
    .filter((s) => s && s.active !== false)
    .map((s, idx) => {
      const categoryName = normalizeSharedCategoryName(s.category);
      const categoryId = sharedCategoryId(categoryName);
      if (!categoryMap.has(categoryId)) {
        categoryMap.set(categoryId, { id: categoryId, name: categoryName, sortOrder: categoryMap.size, isSharedCategory: true });
      }
      const override = ticketsState._rawServiceOverrides[s.id];
      if (override && override.enabled === false) return null;
      const defaultPrice = Number(s.defaultPrice) || 0;
      const finalPrice = override && Number.isFinite(Number(override.price))
        ? Number(override.price)
        : defaultPrice;
      if (override) console.log('[SharedServices] override applied', { serviceId: s.id, locationId: getActiveLocationIdForTickets(), price: finalPrice });
      return {
        id: s.id,
        name: String(s.name || '').trim(),
        defaultPrice: finalPrice,
        sharedDefaultPrice: defaultPrice,
        category: categoryName,
        categoryId,
        active: s.active !== false,
        sortOrder: Number.isFinite(Number(s.sortOrder)) ? Number(s.sortOrder) : idx,
        isSharedService: true,
        durationMinutes: s.durationMinutes,
        duration: s.duration,
        defaultDuration: s.defaultDuration,
        minutes: s.minutes,
        staffOverrides: s.staffOverrides && typeof s.staffOverrides === 'object' ? s.staffOverrides : {}
      };
    })
    .filter((s) => s && s.name)
    .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));

  const localCategories = ticketsState._rawCategories
    .filter(_ffServiceMatchesActiveLocation)
    .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
  localCategories.forEach((c) => {
    const name = normalizeSharedCategoryName(c?.name);
    const id = serviceCategoryDisplayId(name);
    if (!categoryMap.has(id)) {
      categoryMap.set(id, {
        ...c,
        id,
        sourceCategoryId: c?.id || id,
        name,
        sortOrder: Number.isFinite(Number(c?.sortOrder)) ? Number(c.sortOrder) : categoryMap.size
      });
    }
  });

  const sharedKeys = new Set(sharedServices.map((s) => serviceCatalogStableKey(s.name, s.category)));
  const localServices = ticketsState._rawServices
    .filter(_ffServiceMatchesActiveLocation)
    .map((s) => {
      const cat = localCategories.find((c) => c.id === s.categoryId);
      const categoryName = normalizeSharedCategoryName(cat?.name || s.category || 'Other');
      return {
        ...s,
        category: categoryName,
        categoryId: serviceCategoryDisplayId(categoryName),
        sourceCategoryId: s.categoryId,
        isSharedService: false
      };
    })
    .filter((s) => {
      if (ticketsState._rawSharedServices.length === 0) return true;
      return !sharedKeys.has(serviceCatalogStableKey(s.name, s.category || 'Other'));
    })
    .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));

  const mergedServices = [];
  const seenServices = new Set();
  [...sharedServices, ...localServices].forEach((svc) => {
    const key = serviceCatalogStableKey(svc.name, svc.category || 'Other');
    if (seenServices.has(key)) return;
    seenServices.add(key);
    mergedServices.push(svc);
  });

  ticketsState.salonServices = mergedServices;
  ticketsState.serviceCategories = Array.from(categoryMap.values()).sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
  console.log('[SharedServices] merged catalog for picker', {
    sharedServices: sharedServices.length,
    localServices: localServices.length,
    categories: ticketsState.serviceCategories.length
  });
}

function getSharedServicesForCatalogManager() {
  const categoryMap = new Map();
  ticketsState._rawSharedCategories.forEach((c, idx) => {
    const name = normalizeSharedCategoryName(c?.name);
    const id = sharedCategoryId(name);
    categoryMap.set(id, {
      id,
      docId: c?.id || id,
      name,
      sortOrder: Number.isFinite(Number(c?.sortOrder)) ? Number(c.sortOrder) : idx,
      isSharedCategory: true
    });
  });
  const services = ticketsState._rawSharedServices
    .map((s, idx) => {
      const categoryName = normalizeSharedCategoryName(s.category);
      const categoryId = sharedCategoryId(categoryName);
      if (!categoryMap.has(categoryId)) {
        categoryMap.set(categoryId, { id: categoryId, name: categoryName, sortOrder: categoryMap.size, isSharedCategory: true });
      }
      const override = ticketsState._rawServiceOverrides[s.id];
      const defaultPrice = Number(s.defaultPrice) || 0;
      const hasOverride = override && Number.isFinite(Number(override.price));
      const locationEnabled = !(override && override.enabled === false);
      return {
        id: s.id,
        name: String(s.name || '').trim(),
        defaultPrice: hasOverride ? Number(override.price) : defaultPrice,
        sharedDefaultPrice: defaultPrice,
        category: categoryName,
        categoryId,
        active: s.active !== false,
        locationEnabled,
        sortOrder: Number.isFinite(Number(s.sortOrder)) ? Number(s.sortOrder) : idx,
        isSharedService: true,
        hasOverride,
        overridePrice: hasOverride ? Number(override.price) : null,
        durationMinutes: s.durationMinutes,
        duration: s.duration,
        defaultDuration: s.defaultDuration,
        minutes: s.minutes,
        staffOverrides: s.staffOverrides && typeof s.staffOverrides === 'object' ? s.staffOverrides : {}
      };
    })
    .filter((s) => s.name)
    .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
  const sharedKeys = new Set(services.map((s) => serviceCatalogStableKey(s.name, s.category)));
  const localCategories = ticketsState._rawCategories
    .filter(_ffServiceMatchesActiveLocation)
    .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
  localCategories.forEach((c) => {
    const name = normalizeSharedCategoryName(c?.name);
    const id = serviceCategoryDisplayId(name);
    if (!categoryMap.has(id)) {
      categoryMap.set(id, {
        ...c,
        id,
        sourceCategoryId: c?.id || id,
        name,
        sortOrder: Number.isFinite(Number(c?.sortOrder)) ? Number(c.sortOrder) : categoryMap.size
      });
    }
  });
  const localServices = ticketsState._rawServices
    .filter(_ffServiceMatchesActiveLocation)
    .map((s) => {
      const cat = localCategories.find((c) => c.id === s.categoryId);
      const categoryName = normalizeSharedCategoryName(cat?.name || s.category || 'Other');
      return {
        ...s,
        category: categoryName,
        categoryId: serviceCategoryDisplayId(categoryName),
        sourceCategoryId: s.categoryId,
        isSharedService: false
      };
    })
    .filter((s) => !sharedKeys.has(serviceCatalogStableKey(s.name, s.category || 'Other')))
    .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
  const mergedServices = [];
  const seenServices = new Set();
  [...services, ...localServices].forEach((svc) => {
    const key = serviceCatalogStableKey(svc.name, svc.category || 'Other');
    if (seenServices.has(key)) return;
    seenServices.add(key);
    mergedServices.push(svc);
  });
  return {
    services: mergedServices,
    categories: Array.from(categoryMap.values()).sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99))
  };
}

function getLocationServicesForCatalogManager() {
  return {
    services: ticketsState._rawServices
      .filter(_ffServiceMatchesActiveLocation)
      .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99)),
    categories: ticketsState._rawCategories
      .filter(_ffServiceMatchesActiveLocation)
      .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99))
  };
}

async function loadSharedCatalogForManager() {
  const accountId = getTicketsAccountId();
  if (!accountId) return { services: [], categories: [] };
  const [serviceSnap, categorySnap] = await Promise.all([
    getDocs(sharedServiceCatalogItemsRef(accountId)),
    getDocs(sharedServiceCategoryItemsRef(accountId)).catch(() => ({ docs: [] }))
  ]);
  ticketsState._rawSharedServices = serviceSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  ticketsState._rawSharedCategories = categorySnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  await loadSharedServiceOverrides(accountId, getActiveLocationIdForTickets());
  return getSharedServicesForCatalogManager();
}

async function loadLocationCatalogForManager() {
  if (!ticketsState.currentUserProfile?.salonId) return { services: [], categories: [] };
  await _ffWipeLegacyCatalogOnce();
  const [svcSnap, catSnap] = await Promise.all([
    getDocs(collection(db, `salons/${ticketsState.currentUserProfile.salonId}/services`)),
    getDocs(collection(db, `salons/${ticketsState.currentUserProfile.salonId}/serviceCategories`))
  ]);
  ticketsState._rawServices = svcSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  ticketsState._rawCategories = catSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  _applyCatalogFilter();
  return getLocationServicesForCatalogManager();
}

async function saveSharedService(service) {
  if (!ffCanManageServices()) throw new Error('You do not have permission to manage services.');
  const accountId = getTicketsAccountId();
  if (!accountId) throw new Error('No account');
  const payload = {
    name: String(service.name || '').trim(),
    category: normalizeSharedCategoryName(service.category),
    defaultPrice: Number(service.defaultPrice) || 0,
    active: service.active !== false,
    updatedAt: serverTimestamp()
  };
  if (Number.isFinite(Number(service.sortOrder))) payload.sortOrder = Number(service.sortOrder);
  // "Charge Tax" — only write when explicitly provided (merge-safe).
  if (typeof service.taxable === 'boolean') payload.taxable = service.taxable;
  applyDurationMinutesToServicePayload(payload, service, !service.id);
  if (service.id) {
    await ensureSharedServiceCatalogDoc(accountId);
    await setDoc(doc(sharedServiceCatalogItemsRef(accountId), service.id), payload, { merge: true });
    console.log('[SharedServicesUI] saved shared service', { serviceId: service.id });
    return service.id;
  }
  await ensureSharedServiceCatalogDoc(accountId);
  const ref = await addDoc(sharedServiceCatalogItemsRef(accountId), {
    ...payload,
    createdAt: serverTimestamp()
  });
  console.log('[SharedServicesUI] saved shared service', { serviceId: ref.id });
  return ref.id;
}

async function saveSharedServiceCategory(cat) {
  if (!ffCanManageServices()) throw new Error('You do not have permission to manage services.');
  const accountId = getTicketsAccountId();
  if (!accountId) throw new Error('No account');
  const payload = {
    name: normalizeSharedCategoryName(cat.name),
    sortOrder: Number(cat.sortOrder) || 0,
    updatedAt: serverTimestamp()
  };
  await ensureSharedServiceCategoriesDoc(accountId);
  if (cat.id) {
    await setDoc(doc(sharedServiceCategoryItemsRef(accountId), cat.id), payload, { merge: true });
    return cat.id;
  }
  const categoryId = sharedCategoryId(payload.name);
  await setDoc(doc(sharedServiceCategoryItemsRef(accountId), categoryId), {
    ...payload,
    createdAt: serverTimestamp()
  });
  return categoryId;
}

async function deleteSharedServiceCategory(categoryId) {
  if (!ffCanManageServices()) throw new Error('You do not have permission to manage services.');
  const accountId = getTicketsAccountId();
  if (!accountId || !categoryId) return;
  await deleteDoc(doc(sharedServiceCategoryItemsRef(accountId), categoryId));
}

async function deleteSharedService(serviceId) {
  if (!ffCanManageServices()) throw new Error('You do not have permission to manage services.');
  const accountId = getTicketsAccountId();
  if (!accountId || !serviceId) return;
  await deleteDoc(doc(sharedServiceCatalogItemsRef(accountId), serviceId));
  console.log('[SharedServicesUI] deleted shared service', { serviceId });
}

async function saveSharedServiceOverride(serviceId, price) {
  const accountId = getTicketsAccountId();
  const locationId = getActiveLocationIdForTickets();
  if (!accountId || !locationId || !serviceId) throw new Error('No location');
  await setDoc(doc(db, `accounts/${accountId}/locations/${locationId}/serviceOverrides`, serviceId), {
    price: Number(price) || 0,
    updatedAt: serverTimestamp()
  }, { merge: true });
  console.log('[SharedServicesUI] saved override', { serviceId, locationId, price: Number(price) || 0 });
}

async function removeSharedServiceOverride(serviceId) {
  const accountId = getTicketsAccountId();
  const locationId = getActiveLocationIdForTickets();
  if (!accountId || !locationId || !serviceId) return;
  await deleteDoc(doc(db, `accounts/${accountId}/locations/${locationId}/serviceOverrides`, serviceId));
  console.log('[SharedServicesUI] removed override', { serviceId, locationId });
}

async function loadSharedServiceLocationOverridesForService(serviceId) {
  const accountId = getTicketsAccountId();
  const locations = (typeof window !== 'undefined' && typeof window.ffGetActiveLocations === 'function')
    ? (window.ffGetActiveLocations() || [])
    : [];
  const result = {};
  if (!accountId || !serviceId || locations.length === 0) return result;
  await Promise.all(locations.map(async (loc) => {
    if (!loc || !loc.id) return;
    try {
      const snap = await getDoc(doc(db, `accounts/${accountId}/locations/${loc.id}/serviceOverrides`, serviceId));
      if (!snap.exists()) return;
      const data = snap.data() || {};
      const price = Number(data.price);
      const override = {};
      if (Number.isFinite(price)) override.price = price;
      if (typeof data.enabled === 'boolean') override.enabled = data.enabled;
      if (Object.keys(override).length) result[loc.id] = override;
    } catch (e) {
      console.warn('[SharedServicesUI] location override load failed', loc.id, e);
    }
  }));
  ticketsState._ffServicesLocationOverridesByService[serviceId] = result;
  return result;
}

async function saveSharedServiceLocationOverride(serviceId, locationId, patch) {
  const accountId = getTicketsAccountId();
  if (!accountId || !locationId || !serviceId) throw new Error('No location');
  const existingByService = ticketsState._ffServicesLocationOverridesByService[serviceId] || {};
  const existing = existingByService[locationId] || {};
  const next = { ...existing, ...(patch || {}) };
  if (next.price == null || next.price === '') delete next.price;
  if (next.enabled === true) delete next.enabled;
  const ref = doc(db, `accounts/${accountId}/locations/${locationId}/serviceOverrides`, serviceId);
  if (!Object.keys(next).length) {
    await deleteDoc(ref);
    delete existingByService[locationId];
  } else {
    const write = {
      ...next,
      updatedAt: serverTimestamp()
    };
    if ('price' in existing && !('price' in next)) write.price = deleteField();
    if ('enabled' in existing && !('enabled' in next)) write.enabled = deleteField();
    await setDoc(ref, write, { merge: true });
    existingByService[locationId] = next;
  }
  ticketsState._ffServicesLocationOverridesByService[serviceId] = existingByService;
  const activeLocationId = getActiveLocationIdForTickets();
  if (String(activeLocationId || '') === String(locationId || '')) {
    if (!Object.keys(next).length) delete ticketsState._rawServiceOverrides[serviceId];
    else ticketsState._rawServiceOverrides[serviceId] = { ...next };
    applySharedServiceCatalog();
  }
}

async function seedSharedServiceCatalogFromLocationCatalogIfEmpty() {
  const accountId = getTicketsAccountId();
  if (!accountId) return { seeded: false, reason: 'no-account' };
  if (ticketsState._ffServicesSharedBackfillChecked) return { seeded: false, reason: 'already-checked' };
  ticketsState._ffServicesSharedBackfillChecked = true;
  await loadLocationCatalogForManager();
  const localServices = Array.isArray(ticketsState._rawServices) ? ticketsState._rawServices.filter((s) => s && String(s.name || '').trim()) : [];
  if (localServices.length === 0) return { seeded: false, reason: 'no-local-services' };
  const existingSharedKeys = new Set(
    (ticketsState._rawSharedServices || []).map((s) => serviceCatalogStableKey(s.name, s.category || 'Other'))
  );
  const existingCategoryNames = new Set(
    (ticketsState._rawSharedCategories || []).map((c) => normalizeSharedCategoryName(c?.name).toLowerCase())
  );

  const locations = (typeof window !== 'undefined' && typeof window.ffGetActiveLocations === 'function')
    ? (window.ffGetActiveLocations() || [])
    : [];
  const categoryById = new Map((ticketsState._rawCategories || []).map((cat) => [cat.id, cat]));
  const categorySeed = new Map();
  localServices.forEach((svc) => {
    const cat = categoryById.get(svc.categoryId);
    const categoryName = normalizeSharedCategoryName(cat?.name || svc.category || 'Other');
    if (existingCategoryNames.has(categoryName.toLowerCase())) return;
    if (!categorySeed.has(categoryName)) {
      categorySeed.set(categoryName, {
        name: categoryName,
        sortOrder: Number.isFinite(Number(cat?.sortOrder)) ? Number(cat.sortOrder) : categorySeed.size
      });
    }
  });
  await Promise.all(Array.from(categorySeed.values()).map((cat) => saveSharedServiceCategory(cat)));

  const groups = new Map();
  localServices
    .slice()
    .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99))
    .forEach((svc) => {
      const cat = categoryById.get(svc.categoryId);
      const categoryName = normalizeSharedCategoryName(cat?.name || svc.category || 'Other');
      const key = serviceCatalogStableKey(svc.name, categoryName);
      if (existingSharedKeys.has(key)) return;
      if (!groups.has(key)) {
        groups.set(key, {
          name: String(svc.name || '').trim(),
          category: categoryName,
          defaultPrice: Number(svc.defaultPrice) || 0,
          active: svc.active !== false,
          sortOrder: Number.isFinite(Number(svc.sortOrder)) ? Number(svc.sortOrder) : groups.size,
          durationMinutes: resolveServiceDurationMinutes(svc),
          localByLocation: new Map()
        });
      }
      const group = groups.get(key);
      const locId = typeof svc.locationId === 'string' && svc.locationId.trim() ? svc.locationId.trim() : getActiveLocationIdForTickets();
      if (locId && !group.localByLocation.has(locId)) group.localByLocation.set(locId, svc);
    });
  if (groups.size === 0) return { seeded: false, reason: 'no-missing-local-services' };

  for (const group of groups.values()) {
    const serviceId = await saveSharedService(group);
    if (Array.isArray(locations) && locations.length > 0) {
      for (const loc of locations) {
        if (!loc || !loc.id) continue;
        const localSvc = group.localByLocation.get(loc.id);
        if (!localSvc) {
          await saveSharedServiceLocationOverride(serviceId, loc.id, { enabled: false, price: null });
          continue;
        }
        const localPrice = Number(localSvc.defaultPrice) || 0;
        if (localSvc.active === false || localPrice !== group.defaultPrice) {
          await saveSharedServiceLocationOverride(serviceId, loc.id, {
            enabled: localSvc.active !== false,
            price: localPrice !== group.defaultPrice ? localPrice : null
          });
        }
      }
    }
  }
  await loadSharedCatalogForManager();
  return { seeded: true, count: groups.size };
}

async function tryLoadSharedServiceCatalog() {
  const accountId = getTicketsAccountId();
  if (!accountId) return false;
  try {
    const [serviceSnap, categorySnap] = await Promise.all([
      getDocs(sharedServiceCatalogItemsRef(accountId)),
      getDocs(sharedServiceCategoryItemsRef(accountId)).catch(() => ({ docs: [] }))
    ]);
    const rows = serviceSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!rows.length) {
      console.log('[SharedServices] fallback to location');
      return false;
    }
    ticketsState._catalogSource = 'shared';
    ticketsState._rawSharedServices = rows;
    ticketsState._rawSharedCategories = categorySnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    await loadSharedServiceOverrides(accountId, getActiveLocationIdForTickets());
    applySharedServiceCatalog();
    console.log('[SharedServices] loaded from shared');
    return true;
  } catch (e) {
    console.warn('[SharedServices] shared load failed', e);
    console.log('[SharedServices] fallback to location');
    return false;
  }
}

async function _ffWipeLegacyCatalogOnce() {
  if (ticketsState._ffCatalogLegacyWiped) return;
  ticketsState._ffCatalogLegacyWiped = true; // never retry within this session
  if (!ticketsState.currentUserProfile?.salonId) return;
  try {
    const isOwnerOrAdmin = (() => {
      try {
        if (typeof window !== 'undefined' && typeof window.ffIsOwner === 'function' && window.ffIsOwner()) return true;
      } catch (_) {}
      const r = String(ticketsState.currentUserProfile?.role || '').toLowerCase();
      return r === 'owner' || r === 'admin' || r === 'manager';
    })();
    if (!isOwnerOrAdmin) return;
    const [svcSnap, catSnap] = await Promise.all([
      getDocs(collection(db, `salons/${ticketsState.currentUserProfile.salonId}/services`)),
      getDocs(collection(db, `salons/${ticketsState.currentUserProfile.salonId}/serviceCategories`)),
    ]);
    const orphans = [];
    svcSnap.docs.forEach((d) => {
      const v = d.data() || {};
      const loc = typeof v.locationId === 'string' ? v.locationId.trim() : '';
      if (!loc) orphans.push(deleteDoc(doc(db, `salons/${ticketsState.currentUserProfile.salonId}/services`, d.id)));
    });
    catSnap.docs.forEach((d) => {
      const v = d.data() || {};
      const loc = typeof v.locationId === 'string' ? v.locationId.trim() : '';
      if (!loc) orphans.push(deleteDoc(doc(db, `salons/${ticketsState.currentUserProfile.salonId}/serviceCategories`, d.id)));
    });
    if (orphans.length) {
      console.log(`[Tickets] Wiping ${orphans.length} legacy catalog docs (no locationId).`);
      await Promise.allSettled(orphans);
    }
  } catch (e) {
    console.warn('[Tickets] Legacy catalog wipe failed (non-fatal):', e);
  }
}

function _ffServiceMatchesActiveLocation(s) {
  const activeLoc = getActiveLocationIdForTickets();
  if (!activeLoc) return true;
  const raw = s && typeof s.locationId === 'string' ? s.locationId.trim() : '';
  return raw === activeLoc;
}

/** Recompute `salonServices` + `serviceCategories` from raw caches using the
 *  current active branch. Safe to call from any event (snapshot arrival,
 *  location change, manual refresh). */
function _applyCatalogFilter() {
  if (ticketsState._catalogSource === 'shared') {
    applySharedServiceCatalog();
    return;
  }
  ticketsState.salonServices = ticketsState._rawServices
    .filter(_ffServiceMatchesActiveLocation)
    .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
  ticketsState.serviceCategories = ticketsState._rawCategories
    .filter(_ffServiceMatchesActiveLocation)
    .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
}

/** Single handler for both snapshot sources. Applies filter then refreshes
 *  anything currently on screen that depends on the catalog. */
function _onCatalogSnapshot() {
  _applyCatalogFilter();
  try {
    const modal = document.getElementById('servicesModal');
    if (modal && modal.style.display !== 'none' && modal.style.display !== '') {
      renderServicesCatalogV2();
    }
  } catch (_) {}
  try { setupTicketsUI(); } catch (_) {}
}

/** Live subscribe to services + serviceCategories for the current salon.
 *  Idempotent; switching salon auto-rebinds. */
function subscribeServiceCatalog() {
  const salonId = ticketsState.currentUserProfile?.salonId;
  if (!salonId) return;
  if (ticketsState._catalogSubSalonId === salonId && (ticketsState._servicesUnsub || ticketsState._serviceCatsUnsub)) return;
  // Different salon than what we were subscribed to — tear down first.
  if (ticketsState._servicesUnsub) { try { ticketsState._servicesUnsub(); } catch (_) {} ticketsState._servicesUnsub = null; }
  if (ticketsState._serviceCatsUnsub) { try { ticketsState._serviceCatsUnsub(); } catch (_) {} ticketsState._serviceCatsUnsub = null; }
  ticketsState._catalogSubSalonId = salonId;

  // One-time legacy cleanup BEFORE we start listening — so the first snapshot
  // doesn't include the orphans we're about to delete.
  _ffWipeLegacyCatalogOnce().finally(() => {
    try {
      ticketsState._servicesUnsub = onSnapshot(
        collection(db, `salons/${salonId}/services`),
        (snap) => { ticketsState._rawServices = snap.docs.map(d => ({ id: d.id, ...d.data() })); _onCatalogSnapshot(); },
        (err) => console.warn('[Tickets] services subscription error', err)
      );
    } catch (e) { console.warn('[Tickets] services subscription failed', e); }
    try {
      ticketsState._serviceCatsUnsub = onSnapshot(
        collection(db, `salons/${salonId}/serviceCategories`),
        (snap) => { ticketsState._rawCategories = snap.docs.map(d => ({ id: d.id, ...d.data() })); _onCatalogSnapshot(); },
        (err) => console.warn('[Tickets] categories subscription error', err)
      );
    } catch (e) { console.warn('[Tickets] categories subscription failed', e); }
  });
}

/** Live subscribe to products + productCategories for the current salon so the
 *  ticket picker can offer retail products. Products are salon-wide; per-location
 *  availability/price and per-staff availability are resolved at render time.
 *  Idempotent; switching salon auto-rebinds. */
function subscribeProductsCatalog() {
  const salonId = ticketsState.currentUserProfile?.salonId;
  if (!salonId) return;
  if (ticketsState._productsSubSalonId === salonId && (ticketsState._productsUnsub || ticketsState._productCatsUnsub)) return;
  if (ticketsState._productsUnsub) { try { ticketsState._productsUnsub(); } catch (_) {} ticketsState._productsUnsub = null; }
  if (ticketsState._productCatsUnsub) { try { ticketsState._productCatsUnsub(); } catch (_) {} ticketsState._productCatsUnsub = null; }
  ticketsState._productsSubSalonId = salonId;
  try {
    ticketsState._productsUnsub = onSnapshot(
      collection(db, `salons/${salonId}/products`),
      (snap) => {
        ticketsState.salonProducts = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
        try { setupTicketsUI(); } catch (_) {}
      },
      (err) => console.warn('[Tickets] products subscription error', err)
    );
  } catch (e) { console.warn('[Tickets] products subscription failed', e); }
  try {
    ticketsState._productCatsUnsub = onSnapshot(
      collection(db, `salons/${salonId}/productCategories`),
      (snap) => {
        ticketsState.productCategories = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
        try { setupTicketsUI(); } catch (_) {}
      },
      (err) => console.warn('[Tickets] product categories subscription error', err)
    );
  } catch (e) { console.warn('[Tickets] product categories subscription failed', e); }
}

async function loadServices() {
  if (!ticketsState.currentUserProfile?.salonId) return [];
  if (ticketsState._catalogSource !== 'location') {
    const sharedLoaded = await tryLoadSharedServiceCatalog();
    if (sharedLoaded) {
      subscribeServiceCatalog();
      try {
        if (ticketsState._rawServices.length === 0 || ticketsState._rawCategories.length === 0) {
          await _ffWipeLegacyCatalogOnce();
          const [svcSnap, catSnap] = await Promise.all([
            getDocs(collection(db, `salons/${ticketsState.currentUserProfile.salonId}/services`)),
            getDocs(collection(db, `salons/${ticketsState.currentUserProfile.salonId}/serviceCategories`))
          ]);
          ticketsState._rawServices = svcSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          ticketsState._rawCategories = catSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          _applyCatalogFilter();
        }
      } catch (err) {
        console.warn('[Tickets] location catalog merge load failed', err);
      }
      return ticketsState.salonServices;
    }
    ticketsState._catalogSource = 'location';
  }
  // Make sure live subscriptions are running; they will refresh the UI the
  // moment new data arrives.
  subscribeServiceCatalog();
  try {
    // First visit (before a snapshot has arrived) — do a one-shot getDocs
    // so the caller has data to render immediately.
    if (ticketsState._rawServices.length === 0) {
      await _ffWipeLegacyCatalogOnce();
    const snap = await getDocs(collection(db, `salons/${ticketsState.currentUserProfile.salonId}/services`));
      ticketsState._rawServices = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    _applyCatalogFilter();
    return ticketsState.salonServices;
  } catch (err) {
    console.warn('[Tickets] Failed to load services', err);
    return ticketsState.salonServices;
  }
}

async function saveService(service) {
  if (!ffCanManageServices()) throw new Error('You do not have permission to manage services.');
  if (!ticketsState.currentUserProfile?.salonId) throw new Error('No salon');
  const payload = {
    name: String(service.name || '').trim(),
    defaultPrice: Number(service.defaultPrice) || 0,
    categoryId: service.categoryId || null,
    sortOrder: Number(service.sortOrder) || 0,
    updatedAt: serverTimestamp()
  };
  // "Charge Tax" — only write when explicitly provided so reorder/other saves
  // (which omit it) preserve the existing value.
  if (typeof service.taxable === 'boolean') payload.taxable = service.taxable;
  applyDurationMinutesToServicePayload(payload, service, !service.id);
  if (service.id) {
    await updateDoc(doc(db, `salons/${ticketsState.currentUserProfile.salonId}/services`, service.id), payload);
    return service.id;
  } else {
    // New doc — stamp the active branch so this service only appears there.
    const activeLoc = getActiveLocationIdForTickets();
    const ref = await addDoc(collection(db, `salons/${ticketsState.currentUserProfile.salonId}/services`), {
      ...payload,
      locationId: activeLoc || null,
      createdAt: serverTimestamp()
    });
    return ref.id;
  }
}

async function deleteService(serviceId) {
  if (!ffCanManageServices()) throw new Error('You do not have permission to manage services.');
  if (!ticketsState.currentUserProfile?.salonId || !serviceId) return;
  await deleteDoc(doc(db, `salons/${ticketsState.currentUserProfile.salonId}/services`, serviceId));
}

// =====================
// Service Categories (managed objects, PER-LOCATION)
// =====================
async function loadServiceCategories() {
  if (!ticketsState.currentUserProfile?.salonId) return [];
  if (ticketsState._catalogSource === 'unknown') {
    await loadServices();
    return ticketsState.serviceCategories;
  }
  if (ticketsState._catalogSource === 'shared') {
    applySharedServiceCatalog();
    return ticketsState.serviceCategories;
  }
  subscribeServiceCatalog();
  try {
    if (ticketsState._rawCategories.length === 0) {
      await _ffWipeLegacyCatalogOnce();
    const snap = await getDocs(collection(db, `salons/${ticketsState.currentUserProfile.salonId}/serviceCategories`));
      ticketsState._rawCategories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    _applyCatalogFilter();
    return ticketsState.serviceCategories;
  } catch (err) {
    console.warn('[Tickets] Failed to load service categories', err);
    return ticketsState.serviceCategories;
  }
}

async function saveServiceCategory(cat) {
  if (!ffCanManageServices()) throw new Error('You do not have permission to manage services.');
  if (!ticketsState.currentUserProfile?.salonId) throw new Error('No salon');
  const payload = {
    name: String(cat.name || '').trim(),
    sortOrder: Number(cat.sortOrder) || 0,
    updatedAt: serverTimestamp()
  };
  if (cat.id) {
    await updateDoc(doc(db, `salons/${ticketsState.currentUserProfile.salonId}/serviceCategories`, cat.id), payload);
    return cat.id;
  } else {
    const activeLoc = getActiveLocationIdForTickets();
    const ref = await addDoc(collection(db, `salons/${ticketsState.currentUserProfile.salonId}/serviceCategories`), {
      ...payload,
      locationId: activeLoc || null,
      createdAt: serverTimestamp()
    });
    return ref.id;
  }
}

async function deleteServiceCategory(categoryId) {
  if (!ffCanManageServices()) throw new Error('You do not have permission to manage services.');
  if (!ticketsState.currentUserProfile?.salonId || !categoryId) return;
  const count = ticketsState.salonServices.filter(s => s.categoryId === categoryId).length;
  if (count > 0) throw new Error(`Cannot delete: ${count} service(s) use this category. Move them first.`);
  await deleteDoc(doc(db, `salons/${ticketsState.currentUserProfile.salonId}/serviceCategories`, categoryId));
}

export {
  ffCanViewServices,
  ffCanManageServices,
  getTicketsAccountId,
  normalizeSharedCategoryName,
  sharedCategoryId,
  resolveServiceDurationMinutes,
  parseServiceDurationMinutesInput,
  serviceCatalogStableKey,
  serviceCategoryDisplayId,
  sharedServiceCatalogDocRef,
  sharedServiceCatalogItemsRef,
  sharedServiceCategoriesDocRef,
  sharedServiceCategoryItemsRef,
  ensureSharedServiceCatalogDoc,
  ensureSharedServiceCategoriesDoc,
  loadSharedServiceOverrides,
  applySharedServiceCatalog,
  getSharedServicesForCatalogManager,
  getLocationServicesForCatalogManager,
  loadSharedCatalogForManager,
  loadLocationCatalogForManager,
  saveSharedService,
  saveSharedServiceCategory,
  deleteSharedServiceCategory,
  deleteSharedService,
  saveSharedServiceOverride,
  removeSharedServiceOverride,
  loadSharedServiceLocationOverridesForService,
  saveSharedServiceLocationOverride,
  seedSharedServiceCatalogFromLocationCatalogIfEmpty,
  tryLoadSharedServiceCatalog,
  _ffWipeLegacyCatalogOnce,
  _ffServiceMatchesActiveLocation,
  _applyCatalogFilter,
  _onCatalogSnapshot,
  subscribeServiceCatalog,
  subscribeProductsCatalog,
  loadServices,
  saveService,
  deleteService,
  loadServiceCategories,
  saveServiceCategory,
  deleteServiceCategory,
};
