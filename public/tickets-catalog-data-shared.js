/**
 * tickets-catalog-data-shared.js
 * Shared/account service catalog — helpers, merge, shared Firestore CRUD, tryLoad.
 * Extracted verbatim from tickets-catalog-data.js (catalog-data split T1).
 */
import { collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, deleteField, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { getActiveLocationIdForTickets } from "./tickets-permissions.js?v=20260630_tickets_permissions_split";

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

function _ffServiceMatchesActiveLocation(s) {
  const activeLoc = getActiveLocationIdForTickets();
  if (!activeLoc) return true;
  const raw = s && typeof s.locationId === 'string' ? s.locationId.trim() : '';
  return raw === activeLoc;
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

export {
  ffCanViewServices,
  ffCanManageServices,
  getTicketsAccountId,
  normalizeSharedCategoryName,
  sharedCategoryId,
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
  saveSharedService,
  saveSharedServiceCategory,
  deleteSharedServiceCategory,
  deleteSharedService,
  saveSharedServiceOverride,
  removeSharedServiceOverride,
  loadSharedServiceLocationOverridesForService,
  saveSharedServiceLocationOverride,
  tryLoadSharedServiceCatalog,
  _ffServiceMatchesActiveLocation,
};

