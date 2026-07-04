/**
 * tickets-catalog-data-local.js
 * Per-location catalog runtime — init wiring, subscriptions, local CRUD, seed.
 * Extracted verbatim from tickets-catalog-data.js (catalog-data split T2).
 */
import { collection, doc, getDocs, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { getActiveLocationIdForTickets } from "./tickets-permissions.js?v=20260630_tickets_permissions_split";
import {
  applySharedServiceCatalog,
  ffCanManageServices,
  getLocationServicesForCatalogManager,
  getTicketsAccountId,
  loadSharedCatalogForManager,
  normalizeSharedCategoryName,
  saveSharedService,
  saveSharedServiceCategory,
  saveSharedServiceLocationOverride,
  serviceCatalogStableKey,
  tryLoadSharedServiceCatalog,
} from "./tickets-catalog-data-shared.js?v=20260704_tickets_catalog_data_split";

let renderServicesCatalogV2, setupTicketsUI;
export function initTicketsCatalogData(deps) {
  renderServicesCatalogV2 = deps.renderServicesCatalogV2;
  setupTicketsUI = deps.setupTicketsUI;
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
  initTicketsCatalogData,
  loadLocationCatalogForManager,
  seedSharedServiceCatalogFromLocationCatalogIfEmpty,
  _ffWipeLegacyCatalogOnce,
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

