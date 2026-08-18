/**
 * Tickets Module
 * Internal documentation of services performed + prices for POS reconciliation.
 * SEPARATE from appointments – never modifies schedule/duration/order.
 *
 * Firestore: salons/{salonId}/services (Service Catalog)
 *            salons/{salonId}/tickets
 */

import {
  collection, query, where, orderBy, limit, startAfter,
  addDoc, updateDoc, setDoc, doc, getDoc, getDocFromServer, getDocs, deleteDoc, deleteField, onSnapshot,
  serverTimestamp, Timestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import "./format-utils.js?v=20260806_sched_12h_picker";
import { ticketsState, TICKETS_PAGE_SIZE, _ticketSummaryPageSize } from "./tickets-state.js?v=20260630_tickets_state_split";
import { initTicketsPermissions, getAutoFrontDeskRecipients, getTicketVisibility, _ticketsCurrentStaffRow, canViewTicketsSummaryTab, canViewTicketsArchivedTab, canCurrentUserCloseTickets, updateTicketsTabsVisibility, ffTicketsSetTimePeriodFiltersVisible, isStaffRecordManagerOrAdmin, isTicketsTechnicianRestrictedRole, ffTicketsHideFrontDeskFiltersOnThisView, getTicketsSelfEmployeeFilterId, ticketBelongsToTicketsTechnician, updateTicketsEmployeeFilterVisibility, getActiveLocationIdForTickets, canSeeTicket } from "./tickets-permissions.js?v=20260630_tickets_permissions_split";
import { getTicketTaxConfig, isTicketProductLine, computeTicketTotalsFromLines } from "./tickets-pricing.js?v=20260630_tickets_pricing_split";
import { initTicketsCatalogData, ffCanViewServices, ffCanManageServices, getTicketsAccountId, normalizeSharedCategoryName, sharedCategoryId, sharedServiceCatalogItemsRef, loadSharedServiceOverrides, getSharedServicesForCatalogManager, getLocationServicesForCatalogManager, loadSharedCatalogForManager, loadLocationCatalogForManager, saveSharedService, saveSharedServiceCategory, deleteSharedServiceCategory, deleteSharedService, saveSharedServiceOverride, removeSharedServiceOverride, loadSharedServiceLocationOverridesForService, saveSharedServiceLocationOverride, seedSharedServiceCatalogFromLocationCatalogIfEmpty, _applyCatalogFilter, subscribeProductsCatalog, loadServices, saveService, deleteService, loadServiceCategories, saveServiceCategory, deleteServiceCategory } from "./tickets-catalog-data.js?v=20260818_staff_duration";
import { initTicketsCrud, _rebuildCurrentTicketsMerged, ffTicketsPatchLocalTicket, updateTicketsLoadMoreUi, loadMoreTicketsOlder, subscribeTickets, updateTicketsNavBadge, getTicketCustomerPriceApprovedFromForm, createTicket, updateTicket, finalizeTicket, closeTicket, reopenTicket, archiveTicket, setTicketServiceUpgrade, awardTicketUpgradePoints, deleteTicketPermanently, markTicketSeenByFrontDesk } from "./tickets-crud.js?v=20260721_ticket_soft_delete";
import { initTicketsHelpers, formatTicketDisplayDateTime, formatDate, ticketSubmittedAtDate, passesTicketsDateFilter, fetchClosedTicketsForSummary, _fmtYmdLocal, computeRangeForPreset, _ticketsFmtMonthDay, _ticketsRangeLabelMd, ticketMatchesEmployeeFilter, formatSummaryMoney, ffTicketMoney, ffTicketCurSym, formatSummaryInt, getSummaryFilterDateRangeFromDom, summaryDocMatchesLocation, buildSummaryRowsFromClosedTicketList, buildSummaryRowsFromLiveClosedTickets } from "./tickets-helpers.js?v=20260721_ticket_soft_delete";
import { initTicketsList, ffTicketsBulkInit, renderTicketsList, escapeHtml } from "./tickets-list.js?v=20260721_ticket_soft_delete";
import { initTicketsModal, openTicketModal, ffFormatReviewedAt, closeTicketModal, closeTicketDetailsModal, addServiceToTicket, addProductToTicket, saveTicket } from "./tickets-modal.js?v=20260818_staff_duration";
import { initTicketsCatalogUI, _ffEnsureCatalogEditorPortal, _ffServicesMobileShowList, openServicesModal, closeServicesModal, renderServicesCatalogV2, ffServiceStaffPermissionTrue, canStaffSendNewTicket, getStaffDefaultServiceCommission, getStaffDefaultSupplyDeduction, _ffCatalogEditorClose, addServiceCategoryV2, addSharedServiceV2 } from "./tickets-catalog-ui.js?v=20260818_staff_duration";
import { initTicketsNav, goToTickets, goToServices } from "./tickets-nav.js?v=20260818_staff_duration";
import { loadAndRenderTicketsSummary, populateTicketsEmployeeSelect, syncTicketsTimePeriodSelectOptions, ensureTicketsSummaryDefaultTimePeriod, setupTicketsDateFilters } from "./tickets-summary.js?v=20260818_staff_duration";
import { initTicketsPicker, setupTicketsUI, ffTicketServiceSearchClear, ffTicketServiceSearchSetVisible, updateNewTicketButtonVisibility, ensureTicketsBackgroundSubscription } from "./tickets-picker.js?v=20260818_staff_duration";

initTicketsPermissions({ normalizeTicketTechName });
initTicketsCrud({ getActiveTicketsSalonId, notifyTicketsAnalyticsDataChanged, ticketSubmittedAtDate, _fmtYmdLocal, showToast, renderTicketsList, closeTicketModal });
initTicketsHelpers({ normalizeTicketTechName, getServiceStaffOverrides, getProductStaffOverrides, getStaffDefaultServiceCommission, getStaffDefaultSupplyDeduction });
initTicketsList({ getTicketTechnicianAvatarUrl, ticketHasRealPostSendEdit, ffFormatReviewedAt, openTicketModal, showToast, ticketConfirm, getActiveTicketsSalonId, loadAndRenderTicketsSummary, populateTicketsEmployeeSelect, syncTicketsTimePeriodSelectOptions, ensureTicketsSummaryDefaultTimePeriod });
initTicketsModal({ showToast, ticketConfirm, computeDiff, ffTicketLinesChanged, ffRenderFrontDeskChangesHtml, ffTicketServiceSearchClear, ffTicketServiceSearchSetVisible, setupTicketsUI, getTicketPriceForServiceAndCurrentStaff, getTicketPriceForProductAndActiveLocation });
initTicketsCatalogUI({ showToast, ticketConfirm, setupTicketsUI, getServiceStaffOverrides, controlledStaffCanProvideService });
initTicketsNav({ showToast, loadCurrentUserProfile, enrichTicketsProfileFromMemberDoc, loadTicketsMembersForAvatars, setupTicketsUI, updateNewTicketButtonVisibility });
initTicketsPicker({ doServiceSelect, getActiveTicketsSalonId, getProductsGroupedByCategory, getServicesGroupedByCategory, getTicketPriceForProductAndActiveLocation, isTicketPickerServiceAvailableForActiveLocation });
initTicketsCatalogData({ renderServicesCatalogV2, setupTicketsUI });

// =====================
// State
// =====================
// Retail products (salon-wide, with per-location + per-staff overrides) shown in the ticket picker.
/** Real-time first page (newest). Older pages appended via Load more (not live-updated). */
/** Page size for Summary: paginated fetch of CLOSED tickets. */
/** When true, the ticket service/product picker shows the FULL catalog (used when a
 * manager / front-desk receiver edits a ticket) instead of filtering by the current
 * staff member's allowed services. Reset to false for the technician new-ticket flow. */
/** When set, opening this ticket (e.g. from list) must not show Ticket Details – we just closed it. */
/** Cache for member avatars (uid/staffId -> { avatarUrl, avatarUpdatedAtMs }) for ticket list. */
/** Secondary lookup by normalized display name (when older tickets lack technicianStaffId). */

function getActiveTicketsSalonId() {
  return (typeof window !== 'undefined' && window.currentSalonId)
    || ticketsState.currentUserProfile?.salonId
    || null;
}

function resetTicketsRuntimeCache() {
  ticketsState.currentTickets = [];
  ticketsState._ticketsFirstPageTickets = [];
  ticketsState._ticketsExtraTickets = [];
  ticketsState._ticketsNextPageCursor = null;
  ticketsState._ticketsHasMoreOlder = false;
  ticketsState._ticketsLoadingMore = false;
  ticketsState._ticketsListSnapshotReady = false;
  ticketsState._ticketsDataReady = false;
  ticketsState._frontDeskCache = null;
}

window.ffGetCurrentTickets = function() {
  return Array.isArray(ticketsState.currentTickets) ? ticketsState.currentTickets.slice() : [];
};

// Live Desk (and other surfaces) open a ticket's details by id.
window.ffOpenTicketModal = function(ticketId, appointmentData = null) {
  return openTicketModal(ticketId, appointmentData);
};

// Currency formatter exposed so the Live Desk shows the same money format as tickets.
window.ffTicketMoney = function(n, decimals) {
  return ffTicketMoney(n, decimals);
};

window.ffLoadTicketsForAnalytics = async function() {
  const salonId = getActiveTicketsSalonId();
  if (!ticketsState.currentUserProfile) {
    try { await loadCurrentUserProfile(); } catch (_) {}
  }
  const resolvedSalonId = getActiveTicketsSalonId() || salonId;
  if (!resolvedSalonId) return [];
  const qAnalytics = query(
    collection(db, `salons/${resolvedSalonId}/tickets`),
    orderBy('createdAt', 'desc'),
    limit(500)
  );
  const snap = await getDocs(qAnalytics);
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return rows.filter((ticket) => {
    if (ticket && ticket.deleted === true) return false;
    try { return canSeeTicket(ticket); } catch (_) { return true; }
  });
};

function notifyTicketsAnalyticsDataChanged() {
  try {
    document.dispatchEvent(new CustomEvent('ff-tickets-data-changed', {
      detail: { count: Array.isArray(ticketsState.currentTickets) ? ticketsState.currentTickets.length : 0 }
    }));
  } catch (_) {}
}

function normalizeTicketTechName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}
/** Ticket IDs opened this session (so badge count drops immediately without waiting for Firestore). */
/** After subscribeTickets, hide list until first Firestore snapshot (avoids empty→full flicker). */

// =====================
// User Profile
// =====================
async function loadCurrentUserProfile() {
  const user = auth.currentUser;
  if (!user) return null;
  ticketsState._frontDeskCache = null; // reset on profile load
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (userDoc.exists()) {
      const data = userDoc.data() || {};
      // Multi-salon: prefer the salon picked from Choose Salon (or the single
      // auto-selected membership) over users/{uid}.salonId. Previously this
      // only fell back when salonId was missing, which still leaked legacy
      // primary-salon tickets into the picked salon.
      // staffId + role also need to follow the chosen membership so ticket
      // permission checks (canViewTickets etc.) evaluate against the right
      // salon's role rather than the legacy primary-salon role.
      const w = (typeof window !== 'undefined') ? window : {};
      const activeSalonId = w.currentSalonId ? String(w.currentSalonId).trim() : '';
      const activeStaffId = w.__ff_authedStaffId ? String(w.__ff_authedStaffId).trim() : '';
      const activeRole = w.__ff_user_role ? String(w.__ff_user_role).trim() : '';
      const resolvedSalonId = activeSalonId || data.salonId || null;
      const resolvedStaffId = activeStaffId || data.staffId || null;
      ticketsState.currentUserProfile = {
        uid: user.uid,
        ...data,
        salonId: resolvedSalonId,
        staffId: resolvedStaffId,
        role: activeRole || data.role || '',
      };
      // Multi-salon: pull the technician name from the staff doc in the chosen
      // salon. Otherwise tickets created from test_salon_001 are stored with
      // technicianName = legacy primary-salon name instead of the salon-scoped
      // staff name, and the wrong technician is credited / the ticket is hidden
      // from the actual servicer's "my tickets" view (which filters by name).
      if (resolvedSalonId && resolvedStaffId) {
        try {
          const staffSnap = await getDoc(doc(db, `salons/${resolvedSalonId}/staff`, resolvedStaffId));
          if (staffSnap.exists()) {
            const st = staffSnap.data() || {};
            const staffName = String(st.name || '').trim();
            if (staffName) ticketsState.currentUserProfile.name = staffName;
            ticketsState.currentUserProfile.permissions = { ...(ticketsState.currentUserProfile.permissions || {}), ...(st.permissions || {}) };
            if (st.managerType) ticketsState.currentUserProfile.managerType = st.managerType;
          }
        } catch (mergeErr) {
          console.warn('[Tickets] Failed to merge staff doc into profile', mergeErr);
        }
      }
      return ticketsState.currentUserProfile;
    }
  } catch (err) {
    console.error('[Tickets] Failed to load user profile', err);
  }
  return null;
}

/** If users/{uid} lacks staffId, copy from salons/{salonId}/members/{uid} so staff-store permission match works. */
async function enrichTicketsProfileFromMemberDoc() {
  if (!ticketsState.currentUserProfile?.uid) return;
  const salonId = (typeof window !== 'undefined' && window.currentSalonId) || ticketsState.currentUserProfile.salonId;
  if (!salonId) return;
  if (ticketsState.currentUserProfile.staffId != null && String(ticketsState.currentUserProfile.staffId).trim() !== '') return;
  try {
    const ms = await getDoc(doc(db, `salons/${salonId}/members`, ticketsState.currentUserProfile.uid));
    if (!ms.exists()) return;
    const sid = (ms.data() || {}).staffId;
    if (sid != null && String(sid).trim() !== '') {
      ticketsState.currentUserProfile.staffId = String(sid).trim();
    }
  } catch (_) {}
}

/** Load members with avatarUrl for ticket list avatars. */
async function loadTicketsMembersForAvatars() {
  const salonId = (typeof window !== 'undefined' && window.currentSalonId) || ticketsState.currentUserProfile?.salonId;
  if (!salonId) return;
  try {
    const snap = await getDocs(collection(db, `salons/${salonId}/members`));
    const byKey = {};
    const byName = {};
    snap.docs.forEach(d => {
      const u = d.data() || {};
      const uid = d.id;
      const staffId = u.staffId || '';
      const avatarUrl = u.avatarUrl || null;
      const avatarUpdatedAtMs = u.avatarUpdatedAtMs != null ? u.avatarUpdatedAtMs : null;
      if (avatarUrl) {
        const entry = { avatarUrl, avatarUpdatedAtMs };
        byKey[uid] = entry;
        if (staffId) byKey[staffId] = entry;
        const nk = normalizeTicketTechName(u.name || '');
        if (nk && !byName[nk]) byName[nk] = entry;
      }
    });
    ticketsState._ticketsMembersAvatarCache = byKey;
    ticketsState._ticketsMembersAvatarByName = byName;
  } catch (e) {
    console.warn('[Tickets] loadTicketsMembersForAvatars failed', e);
    ticketsState._ticketsMembersAvatarCache = {};
    ticketsState._ticketsMembersAvatarByName = {};
  }
}

/** Refresh avatar cache and re-render — call when returning to Tickets or when avatars may have changed. */
window.ticketsRefreshAvatars = async function() {
  await loadTicketsMembersForAvatars();
  if (typeof renderTicketsList === 'function') renderTicketsList();
};

/** Return avatar URL for the technician of ticket t (current user or from members cache). */
function getTicketTechnicianAvatarUrl(t) {
  if (!ticketsState.currentUserProfile) return null;
  const isCreator = t.createdByUid === ticketsState.currentUserProfile.uid ||
    t.technicianStaffId === ticketsState.currentUserProfile.staffId ||
    t.technicianStaffId === ticketsState.currentUserProfile.uid ||
    t.finalizedByUid === ticketsState.currentUserProfile.uid ||
    (t.technicianName && (
      (ticketsState.currentUserProfile.email && String(t.technicianName).toLowerCase().includes(String(ticketsState.currentUserProfile.email).toLowerCase())) ||
      (ticketsState.currentUserProfile.name && String(t.technicianName).toLowerCase().includes(String(ticketsState.currentUserProfile.name).toLowerCase()))
    ));
  if (isCreator && typeof window.ffGetCurrentUserAvatarUrl === 'function') {
    const mine = window.ffGetCurrentUserAvatarUrl();
    if (mine) return mine;
  }
  if (!ticketsState._ticketsMembersAvatarCache) return null;
  let entry = null;
  if (t.technicianStaffId) {
    entry = ticketsState._ticketsMembersAvatarCache[t.technicianStaffId];
  }
  if ((!entry || !entry.avatarUrl) && ticketsState._ticketsMembersAvatarByName) {
    const nk = normalizeTicketTechName(t.technicianName || '');
    if (nk) entry = ticketsState._ticketsMembersAvatarByName[nk] || entry;
  }
  if (!entry || !entry.avatarUrl) return null;
  const v = entry.avatarUpdatedAtMs != null ? String(entry.avatarUpdatedAtMs) : '';
  const sep = entry.avatarUrl.includes('?') ? '&' : '?';
  return `${entry.avatarUrl}${sep}v=${encodeURIComponent(v)}`;
}

function normalizeServiceProviderTypeText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/s$/, '');
}

function getStaffQueueProviderTypeIdsForTickets(staff) {
  try {
    if (typeof window !== 'undefined' && typeof window.ffGetStaffQueueProviderTypeIds === 'function') {
      return window.ffGetStaffQueueProviderTypeIds(staff);
    }
  } catch (_) {}
  const role = String(staff?.role || '').toLowerCase().trim();
  const controlledRole = role === 'manager' || role === 'admin' || role === 'owner' || staff?.isManager === true || staff?.isAdmin === true;
  const source = controlledRole ? staff?.queueJoinAsTechnicianTypes : staff?.technicianTypes;
  return (Array.isArray(source) ? source : []).map((typeId) => String(typeId || '').trim()).filter(Boolean);
}

function staffUsesQueueJoinAsProviderTypes(staff) {
  try {
    if (typeof window !== 'undefined' && typeof window.ffStaffRoleCanJoinQueueAsProviderType === 'function') {
      return window.ffStaffRoleCanJoinQueueAsProviderType(staff);
    }
  } catch (_) {}
  const role = String(staff?.role || '').toLowerCase().trim();
  return role === 'manager' || role === 'admin' || role === 'owner' || staff?.isManager === true || staff?.isAdmin === true;
}

function getServiceCategoryLabel(service) {
  const categoryId = String(service?.categoryId || '').trim();
  const cat = categoryId ? ticketsState.serviceCategories.find((c) => String(c.id || '').trim() === categoryId) : null;
  return String(cat?.name || service?.category || '').trim();
}

function serviceMatchesProviderTypeIds(service, typeIds) {
  const ids = Array.isArray(typeIds) ? typeIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
  if (!ids.length) return false;
  const serviceTokens = [
    normalizeServiceProviderTypeText(getServiceCategoryLabel(service)),
    normalizeServiceProviderTypeText(service?.name)
  ].filter(Boolean);
  if (!serviceTokens.length) return true;
  const cachedTypes = (typeof window !== 'undefined' && Array.isArray(window.__ff_technician_types_cache))
    ? window.__ff_technician_types_cache
    : [];
  return ids.some((typeId) => {
    const type = cachedTypes.find((t) => t && String(t.id || '').trim() === typeId);
    const typeTokens = [
      normalizeServiceProviderTypeText(typeId),
      normalizeServiceProviderTypeText(type?.name)
    ].filter(Boolean);
    return typeTokens.some((typeToken) => serviceTokens.some((serviceToken) => (
      typeToken === serviceToken || typeToken.indexOf(serviceToken) !== -1 || serviceToken.indexOf(typeToken) !== -1
    )));
  });
}

function controlledStaffCanProvideService(staff, service) {
  if (!staffUsesQueueJoinAsProviderTypes(staff)) return true;
  const permissions = staff?.permissions && typeof staff.permissions === 'object' ? staff.permissions : {};
  if (ffServiceStaffPermissionTrue(permissions.tickets_create)) return true;
  const joinOn = typeof window !== 'undefined' && typeof window.ffStaffHasQueueJoinPermission === 'function'
    ? window.ffStaffHasQueueJoinPermission(staff)
    : ffServiceStaffPermissionTrue(permissions.queue_join);
  if (!joinOn) return false;
  return serviceMatchesProviderTypeIds(service, getStaffQueueProviderTypeIdsForTickets(staff));
}

/** Group services by category for MangoMint-style picker. Uses managed categories; Other for uncategorized. */
function isTicketPickerServiceAvailableForActiveLocation(service) {
  if (!service || !String(service.name || '').trim()) return false;
  if (service.active === false || service.locationEnabled === false) return false;
  // A manager / front-desk receiver editing a ticket should see the FULL catalog,
  // so skip the per-staff override + controlled-staff provider filtering.
  if (!ticketsState._ticketPickerShowAllCatalog) {
    const staffOverride = getServiceStaffOverrideForCurrentTicketUser(service);
    if (staffOverride && staffOverride.enabled === false) return false;
    try {
      const currentStaff = typeof window !== 'undefined' && typeof window.ffResolveCurrentStaffRowFromFfStaffV1 === 'function'
        ? window.ffResolveCurrentStaffRowFromFfStaffV1()
        : null;
      if (currentStaff && !controlledStaffCanProvideService(currentStaff, service)) return false;
    } catch (_) {}
  }
  const activeLoc = getActiveLocationIdForTickets();
  if (!activeLoc) return true;
  const serviceLoc = typeof service.locationId === 'string' ? service.locationId.trim() : '';
  if (serviceLoc && serviceLoc !== activeLoc) return false;
  return true;
}

function getServiceStaffOverrides(service) {
  return service && service.staffOverrides && typeof service.staffOverrides === 'object'
    ? service.staffOverrides
    : {};
}

function getCurrentTicketStaffIdCandidates() {
  const out = [];
  const add = (v) => {
    const s = v == null ? '' : String(v).trim();
    if (s && out.indexOf(s) === -1) out.push(s);
  };
  try { add(window.__ff_authedStaffId); } catch (_) {}
  add(ticketsState.currentUserProfile?.staffId);
  add(ticketsState.currentUserProfile?.uid);
  try {
    const staff = typeof window.ffResolveCurrentStaffRowFromFfStaffV1 === 'function'
      ? window.ffResolveCurrentStaffRowFromFfStaffV1()
      : null;
    add(staff?.id);
    add(staff?.staffId);
    add(staff?.uid);
    add(staff?.firebaseUid);
  } catch (_) {}
  return out;
}

function getServiceStaffOverrideForCurrentTicketUser(service) {
  const overrides = getServiceStaffOverrides(service);
  const ids = getCurrentTicketStaffIdCandidates();
  for (const id of ids) {
    if (overrides[id] && typeof overrides[id] === 'object') return overrides[id];
  }
  return null;
}

function getTicketPriceForServiceAndCurrentStaff(service) {
  const base = Number(service?.defaultPrice) || 0;
  const override = getServiceStaffOverrideForCurrentTicketUser(service);
  const price = override && Number.isFinite(Number(override.price)) ? Number(override.price) : base;
  return Number.isFinite(price) ? price : base;
}

function getServicesGroupedByCategory() {
  const grouped = {};
  if (ticketsState.serviceCategories.length > 0) {
    ticketsState.serviceCategories.forEach((c) => { grouped[c.id] = { label: c.name, services: [] }; });
    grouped['__other__'] = { label: 'Other', services: [] };
  } else {
    grouped['__other__'] = { label: 'Other', services: [] };
  }
  ticketsState.salonServices.filter(isTicketPickerServiceAvailableForActiveLocation).forEach((s) => {
    const catId = s.categoryId || null;
    const key = (catId && grouped[catId]) ? catId : '__other__';
    grouped[key].services.push(s);
  });
  const ordered = {};
  if (ticketsState.serviceCategories.length > 0) {
    ticketsState.serviceCategories.forEach((c) => {
      const bucket = grouped[c.id] || { label: c.name, services: [] };
      if ((bucket.services || []).length > 0) ordered[c.id] = bucket;
    });
    if ((grouped['__other__']?.services || []).length > 0) ordered['__other__'] = grouped['__other__'];
  } else {
    if ((grouped['__other__']?.services || []).length > 0) ordered['__other__'] = grouped['__other__'];
  }
  return ordered;
}

// =====================
// Products in the ticket picker
// A product appears only when (a) it is active, (b) it is enabled for the active
// location, and (c) the current staff member is allowed to sell it (per-product
// Staff "Available" override). Price is pulled from the product (per-location
// override if present, otherwise retailPrice).
// =====================
function getProductStaffOverrides(product) {
  return product && product.staffOverrides && typeof product.staffOverrides === 'object'
    ? product.staffOverrides
    : {};
}

function getProductStaffOverrideForCurrentTicketUser(product) {
  const overrides = getProductStaffOverrides(product);
  const ids = getCurrentTicketStaffIdCandidates();
  for (const id of ids) {
    if (overrides[id] && typeof overrides[id] === 'object') return overrides[id];
  }
  return null;
}

function getProductLocationOverrideForActiveLocation(product) {
  const activeLoc = getActiveLocationIdForTickets();
  if (!activeLoc) return null;
  const lo = product && product.locationOverrides && typeof product.locationOverrides === 'object'
    ? product.locationOverrides
    : {};
  const o = lo[activeLoc];
  return (o && typeof o === 'object') ? o : null;
}

function isTicketPickerProductAvailableForActiveLocation(product) {
  if (!product || !String(product.name || '').trim()) return false;
  if (product.active === false) return false;
  const locOverride = getProductLocationOverrideForActiveLocation(product);
  if (locOverride && locOverride.enabled === false) return false;
  if (!ticketsState._ticketPickerShowAllCatalog) {
    const staffOverride = getProductStaffOverrideForCurrentTicketUser(product);
    if (staffOverride && staffOverride.enabled === false) return false;
  }
  return true;
}

function getTicketPriceForProductAndActiveLocation(product) {
  const base = Number(product?.retailPrice) || 0;
  const locOverride = getProductLocationOverrideForActiveLocation(product);
  const price = locOverride && Number.isFinite(Number(locOverride.price)) ? Number(locOverride.price) : base;
  return Number.isFinite(price) ? price : base;
}

function getProductsGroupedByCategory() {
  const grouped = {};
  if (ticketsState.productCategories.length > 0) {
    ticketsState.productCategories.forEach((c) => { grouped[c.id] = { label: c.name, products: [] }; });
  }
  grouped['__other__'] = { label: 'Other', products: [] };
  ticketsState.salonProducts.filter(isTicketPickerProductAvailableForActiveLocation).forEach((p) => {
    const catId = p.categoryId || null;
    const key = (catId && grouped[catId]) ? catId : '__other__';
    grouped[key].products.push(p);
  });
  const ordered = {};
  if (ticketsState.productCategories.length > 0) {
    ticketsState.productCategories.forEach((c) => {
      const bucket = grouped[c.id];
      if (bucket && (bucket.products || []).length > 0) ordered[c.id] = bucket;
    });
  }
  if ((grouped['__other__']?.products || []).length > 0) ordered['__other__'] = grouped['__other__'];
  return ordered;
}

function ticketHasRealPostSendEdit(ticket) {
  if (!ticket || ticket.editedAfterFinalize !== true) return false;
  const history = Array.isArray(ticket.history) ? ticket.history : [];
  return history.some((entry) => {
    const action = String(entry?.action || '').toLowerCase();
    return action === 'edited_after_send';
  });
}

// =====================
// Helpers
// =====================
function showToast(msg, type = 'info') {
  if (typeof window !== 'undefined' && window.ffToast && typeof window.ffToast.show === 'function') {
    const v =
      type === 'success' ? 'success' : type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info';
    window.ffToast.show(String(msg), { variant: v, durationMs: type === 'error' ? 6000 : 4000 });
    return;
  }
  console.warn('[Tickets]', msg, type);
}

/** Custom confirm for tickets: always use in-app modal, never browser confirm. */
/** Styled text-input prompt that matches the app theme (purple buttons).
 *  Resolves to the trimmed string, or null if cancelled. */
function ticketPrompt(message, title = 'Enter value', defaultValue = '') {
  if (typeof window.ffPrompt === 'function') return window.ffPrompt(message, title, defaultValue);
  return new Promise((resolve) => {
    let overlay = document.getElementById('ff-prompt-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'ff-prompt-overlay';
      overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:300000;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
      const card = document.createElement('div');
      card.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.2);max-width:400px;width:100%;padding:24px;';
      card.innerHTML = '<h3 id="ff-prompt-title" style="margin:0 0 10px;font-size:17px;font-weight:700;color:#111;"></h3><p id="ff-prompt-msg" style="margin:0 0 14px;font-size:13px;color:#6b7280;line-height:1.5;"></p><input id="ff-prompt-input" type="text" style="width:100%;box-sizing:border-box;padding:11px 13px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;margin-bottom:18px;outline:none;"><div style="display:flex;justify-content:flex-end;gap:10px;"><button type="button" id="ff-prompt-cancel" style="padding:10px 18px;border:1px solid #d1d5db;background:#fff;border-radius:8px;cursor:pointer;font-size:14px;color:#374151;">Cancel</button><button type="button" id="ff-prompt-ok" style="padding:10px 20px;background:#7c3aed;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;">Save</button></div>';
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      const inputEl = card.querySelector('#ff-prompt-input');
      const closeWith = (v) => {
        overlay.style.display = 'none';
        if (window._ffPromptResolve) { window._ffPromptResolve(v); window._ffPromptResolve = null; }
      };
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closeWith(null); });
      card.querySelector('#ff-prompt-cancel').addEventListener('click', () => closeWith(null));
      card.querySelector('#ff-prompt-ok').addEventListener('click', () => {
        const v = (inputEl.value || '').trim();
        closeWith(v || null);
      });
      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); card.querySelector('#ff-prompt-ok').click(); }
        if (e.key === 'Escape') { e.preventDefault(); closeWith(null); }
      });
    }
    window._ffPromptResolve = resolve;
    const titleEl = overlay.querySelector('#ff-prompt-title');
    const msgEl = overlay.querySelector('#ff-prompt-msg');
    const inputEl = overlay.querySelector('#ff-prompt-input');
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (inputEl) { inputEl.value = defaultValue || ''; inputEl.placeholder = title; }
    overlay.style.display = 'flex';
    setTimeout(() => { try { inputEl.focus(); inputEl.select(); } catch (_) {} }, 30);
  });
}

function ticketConfirm(message, title = 'Confirm') {
  if (typeof window.ffConfirm === 'function') return window.ffConfirm(message, title);
  return new Promise((resolve) => {
    let overlay = document.getElementById('ff-confirm-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'ff-confirm-overlay';
      overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:300000;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
      const card = document.createElement('div');
      card.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.2);max-width:400px;width:100%;padding:24px;';
      card.innerHTML = '<h3 id="ff-confirm-title" style="margin:0 0 12px;font-size:18px;font-weight:600;color:#111;"></h3><p id="ff-confirm-msg" style="margin:0 0 24px;font-size:14px;color:#374151;line-height:1.5;"></p><div style="display:flex;justify-content:flex-end;gap:10px;"><button type="button" id="ff-confirm-cancel" style="padding:10px 20px;border:1px solid #d1d5db;background:#fff;border-radius:8px;cursor:pointer;font-size:14px;color:#374151;">Cancel</button><button type="button" id="ff-confirm-ok" style="padding:10px 20px;background:#7c3aed;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;">OK</button></div>';
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.style.display = 'none'; if (window._ffConfirmResolve) { window._ffConfirmResolve(false); window._ffConfirmResolve = null; } } });
      card.querySelector('#ff-confirm-ok').addEventListener('click', () => { overlay.style.display = 'none'; if (window._ffConfirmResolve) { window._ffConfirmResolve(true); window._ffConfirmResolve = null; } });
      card.querySelector('#ff-confirm-cancel').addEventListener('click', () => { overlay.style.display = 'none'; if (window._ffConfirmResolve) { window._ffConfirmResolve(false); window._ffConfirmResolve = null; } });
    }
    window._ffConfirmResolve = resolve;
    const titleEl = overlay.querySelector('#ff-confirm-title');
    const msgEl = overlay.querySelector('#ff-confirm-msg');
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    overlay.style.display = 'flex';
  });
}

// Compute diff between booked and performed
function computeDiff(appointmentData, performedLines) {
  const booked = (appointmentData?.services || []).map(s => ({ name: s.name || s.serviceName, price: s.price || 0 }));
  const performed = (performedLines || []).map(p => ({ name: p.serviceName, price: p.ticketPrice }));
  const removed = booked.filter(b => !performed.some(p => p.name === b.name));
  const added = performed.filter(p => !booked.some(b => b.name === p.name));
  const changed = [];
  booked.forEach(b => {
    const p = performed.find(x => x.name === b.name);
    if (p && p.price !== b.price) changed.push({ name: b.name, from: b.price, to: p.price });
  });
  return { removed, added, changed };
}

// Diff between two sets of performed lines (used to show what the front desk
// changed on a ticket vs the technician's original submission).
function ffNormalizeLineForCompare(l) {
  return {
    name: String((l && l.serviceName) || '').trim(),
    price: Number(l && l.ticketPrice) || 0,
    note: String((l && l.note) || '').trim()
  };
}
function computeLinesDiff(originalLines, currentLines) {
  const orig = (Array.isArray(originalLines) ? originalLines : []).map(ffNormalizeLineForCompare);
  const curr = (Array.isArray(currentLines) ? currentLines : []).map(ffNormalizeLineForCompare);
  const removed = orig.filter(o => !curr.some(c => c.name === o.name));
  const added = curr.filter(c => !orig.some(o => o.name === c.name));
  const changed = [];
  orig.forEach(o => {
    const c = curr.find(x => x.name === o.name);
    if (c && (c.price !== o.price || c.note !== o.note)) {
      changed.push({ name: o.name, from: o.price, to: c.price });
    }
  });
  return { removed, added, changed };
}
function ffTicketLinesChanged(beforeLines, afterLines) {
  const d = computeLinesDiff(beforeLines, afterLines);
  return !!(d.removed.length || d.added.length || d.changed.length);
}
// Renders the "Edited by front desk" change summary (vs the technician's original).
function ffRenderFrontDeskChangesHtml(t) {
  if (!t || t.frontDeskEdited !== true || !Array.isArray(t.frontDeskOriginalLines)) return '';
  const d = computeLinesDiff(t.frontDeskOriginalLines, t.performedLines || []);
  if (!d.removed.length && !d.added.length && !d.changed.length) return '';
  const who = escapeHtml(t.frontDeskEditedByName || 'Front desk');
  const when = ffFormatReviewedAt(t.frontDeskEditedAt);
  const parts = [];
  d.removed.forEach(r => parts.push(`<div style="color:#dc2626;font-size:13px;">Removed: ${escapeHtml(r.name)} (${ffTicketMoney(r.price || 0)})</div>`));
  d.added.forEach(a => parts.push(`<div style="color:#059669;font-size:13px;">Added: ${escapeHtml(a.name)} (${ffTicketMoney(a.price || 0)})</div>`));
  d.changed.forEach(c => parts.push(`<div style="color:#d97706;font-size:13px;">Changed: ${escapeHtml(c.name)} — ${ffTicketMoney(c.from || 0)} → ${ffTicketMoney(c.to || 0)}</div>`));
  return `<div style="margin-top:14px;padding:12px;border:1px solid #fde68a;background:#fffbeb;border-radius:8px;">
    <div style="font-size:13px;font-weight:700;color:#92400e;margin-bottom:6px;">Edited by front desk${who ? ' · ' + who : ''}${when ? ' · ' + when : ''} <span style="font-weight:500;color:#b45309;">(vs technician)</span></div>
    ${parts.join('')}
  </div>`;
}

// =====================
// UI: Tabs
// =====================
function setTicketsTab(tab) {
  let t = tab;
  if (t === 'summary' && !canViewTicketsSummaryTab()) t = 'ready';
  if (t === 'archived' && !canViewTicketsArchivedTab()) t = 'ready';
  ticketsState.currentTicketsTab = t;
  document.querySelectorAll('.tickets-tab').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.tickets-tab[data-tab="${t}"]`);
  if (btn) btn.classList.add('active');
  renderTicketsList();
}

function doServiceSelect(svc) {
  if (svc) addServiceToTicket(svc);
}

// =====================
// Init
// =====================
export function initTickets() {
  setupTicketsDateFilters();
  document.querySelectorAll('.tickets-tab').forEach(btn => {
    btn.onclick = () => setTicketsTab(btn.getAttribute('data-tab'));
  });
  ffTicketsBulkInit();
  const newBtn = document.getElementById('ticketsNewBtn');
  if (newBtn) newBtn.onclick = () => openTicketModal();
  window.goToTickets = goToTickets;
  window.goToServices = goToServices;
  window.closeTicketModal = closeTicketModal;
  window.closeTicketDetailsModal = closeTicketDetailsModal;
  window.saveTicket = saveTicket;
  window.closeServicesModal = closeServicesModal;
  window.openServicesModal = openServicesModal;
  window.renderServicesCatalogV2 = renderServicesCatalogV2;
  window.addServiceCategoryV2 = addServiceCategoryV2;
  window.addSharedServiceV2 = addSharedServiceV2;
  window.ffCloseCatalogEditor = _ffCatalogEditorClose;
  window.updateTicketsNavBadge = updateTicketsNavBadge;
  window.ffRefreshTicketsTabVisibility = () => {
    updateTicketsTabsVisibility();
    ensureTicketsBackgroundSubscription();
    const ts = document.getElementById('ticketsScreen');
    if (ts && ts.style.display !== 'none' && ts.style.display !== '') {
      renderTicketsList();
    }
  };

  const loadMoreBtn = document.getElementById('ticketsLoadMoreBtn');
  if (loadMoreBtn && !loadMoreBtn._ffTicketsLoadMoreWired) {
    loadMoreBtn._ffTicketsLoadMoreWired = true;
    loadMoreBtn.onclick = () => void loadMoreTicketsOlder();
  }

  // Re-render Tickets list, summary and badge whenever the active branch
  // switches. The underlying Firestore subscription stays the same (we
  // don't want to rebuild/refetch), only the client-side visibility gate
  // (canSeeTicket + summaryDocMatchesLocation) changes.
  if (typeof document !== 'undefined' && !window.__ffTicketsLocationListenerBound) {
    window.__ffTicketsLocationListenerBound = true;
    document.addEventListener('ff-active-location-changed', function () {
      if (ticketsState.ticketsUnsubscribe) { try { ticketsState.ticketsUnsubscribe(); } catch (_) {} ticketsState.ticketsUnsubscribe = null; }
      resetTicketsRuntimeCache();
      if (typeof subscribeTickets === 'function') subscribeTickets({ resetLoading: true });
      try { renderTicketsList(); } catch (_) {}
      try { updateTicketsNavBadge(); } catch (_) {}
      try {
        if (ticketsState.currentTicketsTab === 'summary' && typeof loadAndRenderTicketsSummary === 'function') {
          loadAndRenderTicketsSummary();
        }
      } catch (_) {}
      // Service Catalog is per-branch. The raw caches already hold every
      // doc for the salon — re-apply the filter against the new active
      // branch (no Firestore roundtrip), then refresh anything on screen.
      try {
        const refreshCatalogForLocation = async () => {
          if (ticketsState._catalogSource === 'shared') {
            await loadSharedServiceOverrides(getTicketsAccountId(), getActiveLocationIdForTickets());
          }
          _applyCatalogFilter();
          setupTicketsUI();
          if (ticketsState._ffCatalogModalMode === 'shared') {
            await loadSharedCatalogForManager();
          }
          const modal = document.getElementById('servicesModal');
          const servicesScreen = document.getElementById('servicesScreen');
          if ((modal && modal.style.display !== 'none' && modal.style.display !== '') ||
              (servicesScreen && servicesScreen.style.display !== 'none' && servicesScreen.style.display !== '')) {
            ticketsState._ffOpenCats.clear();
            ticketsState._ffCatalogRenderedOnce = false;
            renderServicesCatalogV2();
          }
        };
        refreshCatalogForLocation().catch((e) => console.warn('[SharedServices] location refresh failed', e));
      } catch (_) {}
    });
  }

  // Staff permissions hydrate asynchronously: the staff store can finish loading
  // (or change) AFTER the Tickets screen is already visible. Without this, the
  // + New button stays stuck on the role-only fallback and ignores the
  // "Can send new ticket" toggle. Re-evaluate it (and tab visibility) on every
  // staff-store update so the permission-driven state is always correct.
  if (typeof document !== 'undefined' && !window.__ffTicketsStaffListenerBound) {
    window.__ffTicketsStaffListenerBound = true;
    document.addEventListener('ff-staff-cloud-updated', function () {
      try { updateNewTicketButtonVisibility(); } catch (_) {}
      try { updateTicketsTabsVisibility(); } catch (_) {}
    });
  }

  // Background subscription for badge: start as soon as the user can access Tickets,
  // so new READY tickets show on the nav even before opening the Tickets module.
  onAuthStateChanged(auth, (user) => {
    if (!user) return;
    setTimeout(() => {
      loadCurrentUserProfile().then(() => {
        ensureTicketsBackgroundSubscription();
      }).catch(() => {});
    }, 1000);
  });

  try {
    updateTicketsTabsVisibility();
  } catch (_) {}

  console.log('[Tickets] Initialized');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTickets);
} else {
  initTickets();
}
