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
import "./format-utils.js";
import { ticketsState, TICKETS_PAGE_SIZE, _ticketSummaryPageSize } from "./tickets-state.js?v=20260630_tickets_state_split";
import { initTicketsPermissions, getAutoFrontDeskRecipients, getTicketVisibility, _ticketsCurrentStaffRow, canViewTicketsSummaryTab, canViewTicketsArchivedTab, canCurrentUserCloseTickets, updateTicketsTabsVisibility, ffTicketsSetTimePeriodFiltersVisible, isStaffRecordManagerOrAdmin, isTicketsTechnicianRestrictedRole, ffTicketsHideFrontDeskFiltersOnThisView, getTicketsSelfEmployeeFilterId, ticketBelongsToTicketsTechnician, updateTicketsEmployeeFilterVisibility, getActiveLocationIdForTickets, canSeeTicket } from "./tickets-permissions.js?v=20260630_tickets_permissions_split";
import { getTicketTaxConfig, isTicketProductLine, computeTicketTotalsFromLines } from "./tickets-pricing.js?v=20260630_tickets_pricing_split";
import { initTicketsCatalogData, ffCanViewServices, ffCanManageServices, getTicketsAccountId, normalizeSharedCategoryName, sharedCategoryId, sharedServiceCatalogItemsRef, loadSharedServiceOverrides, getSharedServicesForCatalogManager, getLocationServicesForCatalogManager, loadSharedCatalogForManager, loadLocationCatalogForManager, saveSharedService, saveSharedServiceCategory, deleteSharedServiceCategory, deleteSharedService, saveSharedServiceOverride, removeSharedServiceOverride, loadSharedServiceLocationOverridesForService, saveSharedServiceLocationOverride, seedSharedServiceCatalogFromLocationCatalogIfEmpty, _applyCatalogFilter, subscribeProductsCatalog, loadServices, saveService, deleteService, loadServiceCategories, saveServiceCategory, deleteServiceCategory } from "./tickets-catalog-data.js?v=20260630_tickets_catalog_data_split";
initTicketsCatalogData({ renderServicesCatalogV2, setupTicketsUI });
initTicketsPermissions({ normalizeTicketTechName });
import { initTicketsCrud, _rebuildCurrentTicketsMerged, ffTicketsPatchLocalTicket, updateTicketsLoadMoreUi, loadMoreTicketsOlder, subscribeTickets, updateTicketsNavBadge, getTicketCustomerPriceApprovedFromForm, createTicket, updateTicket, finalizeTicket, closeTicket, reopenTicket, archiveTicket, setTicketServiceUpgrade, awardTicketUpgradePoints, deleteTicketPermanently, markTicketSeenByFrontDesk } from "./tickets-crud.js?v=20260630_tickets_crud_split";
initTicketsCrud({ getActiveTicketsSalonId, notifyTicketsAnalyticsDataChanged, ticketSubmittedAtDate, _fmtYmdLocal, showToast, renderTicketsList, closeTicketModal });
import { initTicketsHelpers, formatTicketDisplayDateTime, formatDate, ticketSubmittedAtDate, passesTicketsDateFilter, fetchClosedTicketsForSummary, _fmtYmdLocal, computeRangeForPreset, _ticketsFmtMonthDay, _ticketsRangeLabelMd, ticketMatchesEmployeeFilter, formatSummaryMoney, ffTicketMoney, ffTicketCurSym, formatSummaryInt, getSummaryFilterDateRangeFromDom, summaryDocMatchesLocation, buildSummaryRowsFromClosedTicketList, buildSummaryRowsFromLiveClosedTickets } from "./tickets-helpers.js?v=20260630_tickets_helpers_split";
initTicketsHelpers({ normalizeTicketTechName, getServiceStaffOverrides, getProductStaffOverrides, getStaffDefaultServiceCommission, getStaffDefaultSupplyDeduction });

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
function paintTicketsSummaryTable(wrap, tbody, tfoot, emptyMsg, summaryRows, totals) {
  // Mobile drill-down: tapping a summary row toggles its detail breakdown.
  // Bound once at document level so it survives every repaint of the table.
  if (typeof document !== 'undefined' && !document.__ffSummaryRowDelegated) {
    document.__ffSummaryRowDelegated = true;
    document.addEventListener('click', function (event) {
      const row = event.target && event.target.closest
        ? event.target.closest('#ticketsScreen .tickets-summary-table tr.tickets-summary-row')
        : null;
      if (!row) return;
      // Only act as an accordion on mobile widths; desktop keeps the full table.
      if (window.matchMedia && !window.matchMedia('(max-width: 640px)').matches) return;
      row.classList.toggle('ff-summary-row-open');
    });
  }
  // Each tax column shows only when its own toggle is active (enabled + rate > 0).
  if (wrap && wrap.classList) {
    const cfg = getTicketTaxConfig();
    const productActive = cfg.product.enabled && cfg.product.rate > 0;
    const serviceActive = cfg.service.enabled && cfg.service.rate > 0;
    wrap.classList.toggle('ff-hide-product-tax-col', !productActive);
    wrap.classList.toggle('ff-hide-service-tax-col', !serviceActive);
  }
  if (!summaryRows || summaryRows.length === 0) {
    wrap.style.display = 'none';
    if (emptyMsg) {
      emptyMsg.style.display = 'block';
      emptyMsg.className = 'tickets-summary-state tickets-summary-state--empty';
      emptyMsg.textContent = 'No summary data found for the selected filters.';
    }
    return false;
  }
  tbody.innerHTML = summaryRows
    .map(
      (r) => `<tr class="tickets-summary-row">
      <td class="ff-sum-name" data-label="Name">${escapeHtml(r.name)}</td>
      <td class="tickets-summary-col-num" data-label="Tickets">${formatSummaryInt(r.tickets)}</td>
      <td class="tickets-summary-col-num" data-label="Services">${formatSummaryInt(r.services)}</td>
      <td class="tickets-summary-col-num" data-label="Service Sales">${formatSummaryMoney(r.serviceSales)}</td>
      <td class="tickets-summary-col-num" data-label="Supply Deductions">${formatSummaryMoney(r.supplyDeductions)}</td>
      <td class="tickets-summary-col-num" data-label="Service Commission">${formatSummaryMoney(r.serviceCommission)}</td>
      <td class="tickets-summary-col-num" data-label="Product Sales">${formatSummaryMoney(r.productSales)}</td>
      <td class="tickets-summary-col-num" data-label="Product Commission">${formatSummaryMoney(r.productCommission)}</td>
      <td class="tickets-summary-col-num tickets-summary-col-product-tax" data-label="Product Tax">${formatSummaryMoney(r.productTax)}</td>
      <td class="tickets-summary-col-num tickets-summary-col-service-tax" data-label="Service Tax">${formatSummaryMoney(r.serviceTax)}</td>
      <td class="tickets-summary-col-num ff-sum-total" data-label="Total Earned">${formatSummaryMoney(r.totalEarned)}</td>
    </tr>`
    )
    .join('');
  tfoot.innerHTML = `<tr class="tickets-summary-total-row tickets-summary-row">
      <td class="ff-sum-name" data-label="Name">Total</td>
      <td class="tickets-summary-col-num" data-label="Tickets">${formatSummaryInt(totals?.tickets)}</td>
      <td class="tickets-summary-col-num" data-label="Services">${formatSummaryInt(totals?.services)}</td>
      <td class="tickets-summary-col-num" data-label="Service Sales">${formatSummaryMoney(totals?.serviceSales)}</td>
      <td class="tickets-summary-col-num" data-label="Supply Deductions">${formatSummaryMoney(totals?.supplyDeductions)}</td>
      <td class="tickets-summary-col-num" data-label="Service Commission">${formatSummaryMoney(totals?.serviceCommission)}</td>
      <td class="tickets-summary-col-num" data-label="Product Sales">${formatSummaryMoney(totals?.productSales)}</td>
      <td class="tickets-summary-col-num" data-label="Product Commission">${formatSummaryMoney(totals?.productCommission)}</td>
      <td class="tickets-summary-col-num tickets-summary-col-product-tax" data-label="Product Tax">${formatSummaryMoney(totals?.productTax)}</td>
      <td class="tickets-summary-col-num tickets-summary-col-service-tax" data-label="Service Tax">${formatSummaryMoney(totals?.serviceTax)}</td>
      <td class="tickets-summary-col-num ff-sum-total" data-label="Total Earned">${formatSummaryMoney(totals?.totalEarned)}</td>
    </tr>`;
  if (emptyMsg) {
    emptyMsg.style.display = 'none';
    emptyMsg.className = 'tickets-summary-state';
  }
  wrap.style.display = '';
  return true;
}


/**
 * Summary tab: aggregate from all CLOSED tickets in Firestore (same date rules as Closed tab: createdAt).
 * Rows in ticketSummaries are still written on close for optional analytics; the UI does not depend on them.
 */
async function loadAndRenderTicketsSummary() {
  const seq = ++ticketsState._ticketsSummaryFetchSeq;
  if (ticketsState.currentTicketsTab === 'summary') {
    syncTicketsTimePeriodSelectOptions();
    ensureTicketsSummaryDefaultTimePeriod();
  }
  const panel = document.getElementById('ticketsSummaryPanel');
  const wrap = panel?.querySelector('.tickets-summary-table-wrap');
  const emptyMsg = document.getElementById('ticketsSummaryEmpty');
  const tbody = document.getElementById('ticketsSummaryTableBody');
  const tfoot = document.getElementById('ticketsSummaryTableFoot');
  if (!panel || !wrap || !tbody || !tfoot) return;

  wrap.style.display = 'none';
  if (emptyMsg) {
    emptyMsg.style.display = 'block';
    emptyMsg.className = 'tickets-summary-state tickets-summary-state--loading';
    emptyMsg.textContent = 'Loading summary...';
  }
  tbody.innerHTML = '';
  tfoot.innerHTML = '';

  const salonId = ticketsState.currentUserProfile?.salonId || (typeof window !== 'undefined' && window.currentSalonId);
  if (!salonId) {
    if (seq !== ticketsState._ticketsSummaryFetchSeq) return;
    if (emptyMsg) {
      emptyMsg.className = 'tickets-summary-state tickets-summary-state--empty';
      emptyMsg.textContent = 'No summary data found for the selected filters.';
    }
    return;
  }

  const { fromStr, toStr } = getSummaryFilterDateRangeFromDom();
  const empEl = document.getElementById('ticketsEmployeeSelect');
  let employeeId = empEl ? (empEl.value || 'all') : 'all';
  if (isTicketsTechnicianRestrictedRole() && !isStaffRecordManagerOrAdmin()) {
    employeeId = getTicketsSelfEmployeeFilterId();
  }

  console.log('[Tickets Summary DEBUG] loadAndRenderTicketsSummary: start', {
    salonId,
    fromStr: fromStr || '(empty)',
    toStr: toStr || '(empty)',
    employeeId,
    profileRole: ticketsState.currentUserProfile?.role ?? '(no profile)',
    techRestricted: isTicketsTechnicianRestrictedRole() && !isStaffRecordManagerOrAdmin()
  });

  try {
    if (!ticketsState.salonServices.length) {
      try { await loadServices(); } catch (catalogErr) { console.warn('[Tickets] Summary catalog load failed', catalogErr); }
    }
    if (!ticketsState.salonProducts.length) {
      try {
        subscribeProductsCatalog();
        const prodSnap = await getDocs(collection(db, `salons/${salonId}/products`));
        ticketsState.salonProducts = prodSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
      } catch (catalogErr) {
        console.warn('[Tickets] Summary products catalog load failed', catalogErr);
      }
    }
    const closedTickets = await fetchClosedTicketsForSummary(salonId, fromStr, toStr);
    if (seq !== ticketsState._ticketsSummaryFetchSeq) return;

    console.log('[Tickets Summary DEBUG] loadAndRenderTicketsSummary: fetched CLOSED ticket docs', closedTickets.length);

    const fb = buildSummaryRowsFromClosedTicketList(closedTickets, fromStr, toStr, employeeId);

    if (seq !== ticketsState._ticketsSummaryFetchSeq) return;

    paintTicketsSummaryTable(
      wrap,
      tbody,
      tfoot,
      emptyMsg,
      fb.summaryRows,
      fb.totals
    );
  } catch (e) {
    console.error('[Tickets Summary DEBUG] loadAndRenderTicketsSummary: catch', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack,
      salonId,
      profileRole: ticketsState.currentUserProfile?.role ?? '(no profile)'
    });
    console.warn('[Tickets] Summary load failed', e);
    if (seq !== ticketsState._ticketsSummaryFetchSeq) return;
    if (ticketsState._ticketsListSnapshotReady) {
      const fb = buildSummaryRowsFromLiveClosedTickets(fromStr, toStr, employeeId);
      if (
        paintTicketsSummaryTable(
          wrap,
          tbody,
          tfoot,
          emptyMsg,
          fb.summaryRows,
          fb.totals
        )
      ) {
        return;
      }
    }
    wrap.style.display = 'none';
    if (emptyMsg) {
      emptyMsg.style.display = 'block';
      emptyMsg.className = 'tickets-summary-state tickets-summary-state--empty';
      emptyMsg.textContent = 'No summary data found for the selected filters.';
    }
  }
}

function populateTicketsEmployeeSelect() {
  const sel = document.getElementById('ticketsEmployeeSelect');
  if (!sel) return;
  const prev = sel.value;
  const store = typeof window.ffGetStaffStore === 'function' ? window.ffGetStaffStore() : null;
  const staffList = Array.isArray(store?.staff) ? [...store.staff] : [];
  staffList.sort((a, b) => String(a.name || a.email || '').localeCompare(String(b.name || b.email || ''), undefined, { sensitivity: 'base' }));
  sel.innerHTML = '';
  const optAll = document.createElement('option');
  optAll.value = 'all';
  optAll.textContent = 'ALL EMPLOYEES';
  sel.appendChild(optAll);
  for (const s of staffList) {
    if (!s || s.id == null || s.id === '') continue;
    const o = document.createElement('option');
    o.value = String(s.id);
    o.textContent = (s.name || s.email || 'Staff').trim();
    sel.appendChild(o);
  }
  const ok = [...sel.options].some(o => o.value === prev);
  sel.value = ok ? prev : 'all';
}

function syncTicketsTimePeriodSelectOptions() {
  const sel = document.getElementById('ticketsTimePeriodSelect');
  if (!sel) return;
  const setLabel = (val, text) => {
    const o = sel.querySelector(`option[value="${val}"]`);
    if (o) o.textContent = text;
  };
  const now = new Date();
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dY = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  setLabel('all', 'ALL DATES');
  setLabel('today', `Today (${_ticketsFmtMonthDay(d0)})`);
  setLabel('yesterday', `Yesterday (${_ticketsFmtMonthDay(dY)})`);
  const tw = computeRangeForPreset('this_week');
  setLabel('this_week', `This Week (${_ticketsRangeLabelMd(tw.from, tw.to)})`);
  const lw = computeRangeForPreset('last_week');
  setLabel('last_week', `Last Week (${_ticketsRangeLabelMd(lw.from, lw.to)})`);
  const l2 = computeRangeForPreset('last_two_weeks');
  setLabel('last_two_weeks', `Last Two Weeks (${_ticketsRangeLabelMd(l2.from, l2.to)})`);
  setLabel('custom', 'Custom time period');
}

/** Summary tab: sync custom date row visibility; default to Today only when selection is missing (invalid). Respect ALL DATES — do not force it back to Today. */
function ensureTicketsSummaryDefaultTimePeriod() {
  const periodSel = document.getElementById('ticketsTimePeriodSelect');
  const customWrap = document.getElementById('ticketsTimePeriodCustomWrap');
  const fromEl = document.getElementById('ticketsFilterDateFrom');
  const toEl = document.getElementById('ticketsFilterDateTo');
  if (!periodSel) return;
  const v = String(periodSel.value || '').trim();
  if (v === '') {
    const todayOpt = periodSel.querySelector('option[value="today"]');
    if (todayOpt) {
      todayOpt.selected = true;
      periodSel.value = 'today';
    }
    if (customWrap) customWrap.style.display = 'none';
    const r = computeRangeForPreset('today');
    if (fromEl) fromEl.value = r.from;
    if (toEl) toEl.value = r.to;
    return;
  }
  if (v === 'all') {
    if (customWrap) customWrap.style.display = 'none';
    if (fromEl) fromEl.value = '';
    if (toEl) toEl.value = '';
    return;
  }
  if (v === 'custom') {
    if (customWrap) customWrap.style.display = 'inline-flex';
    return;
  }
  if (customWrap) customWrap.style.display = 'none';
}

function applyTicketsTimePeriodFromSelect() {
  const sel = document.getElementById('ticketsTimePeriodSelect');
  const customWrap = document.getElementById('ticketsTimePeriodCustomWrap');
  const fromEl = document.getElementById('ticketsFilterDateFrom');
  const toEl = document.getElementById('ticketsFilterDateTo');
  if (!sel || !fromEl || !toEl) return;
  const v = sel.value;
  if (v === 'custom') {
    if (customWrap) customWrap.style.display = 'inline-flex';
    if (!fromEl.value && !toEl.value) {
      const d = computeRangeForPreset('last_week');
      fromEl.value = d.from;
      toEl.value = d.to;
    }
    renderTicketsList();
    return;
  }
  if (customWrap) customWrap.style.display = 'none';
  const r = computeRangeForPreset(v);
  fromEl.value = r.from;
  toEl.value = r.to;
  renderTicketsList();
}

function setupTicketsDateFilters() {
  if (ticketsState._ticketsDateFiltersWired) return;
  ticketsState._ticketsDateFiltersWired = true;
  const sel = document.getElementById('ticketsTimePeriodSelect');
  const fromEl = document.getElementById('ticketsFilterDateFrom');
  const toEl = document.getElementById('ticketsFilterDateTo');
  const onDatesChange = () => renderTicketsList();
  if (sel) sel.addEventListener('change', () => applyTicketsTimePeriodFromSelect());
  if (fromEl) {
    fromEl.addEventListener('change', onDatesChange);
    fromEl.addEventListener('input', onDatesChange);
  }
  if (toEl) {
    toEl.addEventListener('change', onDatesChange);
    toEl.addEventListener('input', onDatesChange);
  }
  const empSel = document.getElementById('ticketsEmployeeSelect');
  if (empSel) empSel.addEventListener('change', onDatesChange);
}

/**
 * Legacy no-op: the gear used to live on the right toolbar and had to be
 * re-aligned under the user avatar. It now sits inline right after the
 * "Summary" tab, so no explicit alignment is needed anymore. Function
 * kept to satisfy existing call sites.
 */
function _alignGearToAvatar() { /* no-op — see note above */ }

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
// UI: List
// =====================
function formatLineForList(l) {
  const name = escapeHtml(l.serviceName || '');
  const base = Number(l.catalogPrice) || 0;
  const adj = Number(l.ticketPrice) || 0;
  if (l.isOverride && base !== adj) {
    return `${name} <span style="font-size:11px;color:#d97706;" title="Price adjusted">(base ${ffTicketMoney(base, 0)} → ${ffTicketMoney(adj, 0)})</span>`;
  }
  return `${name} ${ffTicketMoney(adj, 0)}`;
}

function getInitial(name) {
  if (!name || typeof name !== 'string') return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0][0] || '?').toUpperCase();
}

// =====================
// Bulk select — archive (Closed tab) / permanent delete (Archived tab)
// =====================

/** Bulk archive/delete is restricted to owner/admin — same gate as the single-ticket actions. */
function ffTicketsCanBulkArchive() {
  return !!(ticketsState.currentUserProfile && ['owner', 'admin'].includes((ticketsState.currentUserProfile.role || '').toLowerCase()));
}

/** Tabs where bulk selection is available: Closed (archive) and Archived (permanent delete). */
function ffTicketsBulkTabHere() {
  if (!ffTicketsCanBulkArchive()) return false;
  return ticketsState.currentTicketsTab === 'closed' || ticketsState.currentTicketsTab === 'archived';
}

function ffTicketsExitSelectionMode() {
  ticketsState.ticketsSelectionMode = false;
  ticketsState.ticketsSelectionTab = null;
  ticketsState.ticketsSelected.clear();
}

function ffTicketsToggleSelect(id, cardEl) {
  if (ticketsState.ticketsSelected.has(id)) ticketsState.ticketsSelected.delete(id);
  else ticketsState.ticketsSelected.add(id);
  if (cardEl) {
    const on = ticketsState.ticketsSelected.has(id);
    cardEl.classList.toggle('ticket-selected', on);
    const cb = cardEl.querySelector('.ticket-select-cb');
    if (cb) cb.textContent = on ? '\u2713' : '';
  }
  ffTicketsUpdateBulkBar();
}

function ffTicketsUpdateBulkBar() {
  const bar = document.getElementById('ticketsBulkBar');
  if (!bar) return;
  const onBulkTab = ffTicketsBulkTabHere();
  bar.style.display = onBulkTab ? 'flex' : 'none';
  // Mobile CSS pins the bar to the bottom of the screen while selecting.
  const screenEl = document.getElementById('ticketsScreen');
  if (screenEl) screenEl.classList.toggle('ff-tickets-selecting', onBulkTab && ticketsState.ticketsSelectionMode);
  if (!onBulkTab) return;
  const onArchived = ticketsState.currentTicketsTab === 'archived';
  const toggleBtn = document.getElementById('ticketsSelectToggleBtn');
  const selectAllBtn = document.getElementById('ticketsSelectAllBtn');
  const info = document.getElementById('ticketsBulkInfo');
  const archiveBtn = document.getElementById('ticketsBulkArchiveBtn');
  const cancelBtn = document.getElementById('ticketsBulkCancelBtn');
  const n = ticketsState.ticketsSelected.size;
  const total = ticketsState.ticketsClosedShownIds.length;
  if (toggleBtn) toggleBtn.style.display = ticketsState.ticketsSelectionMode ? 'none' : '';
  if (selectAllBtn) {
    selectAllBtn.style.display = ticketsState.ticketsSelectionMode ? '' : 'none';
    const allSelected = total > 0 && n >= total;
    selectAllBtn.textContent = allSelected ? 'Clear all' : 'Select all';
  }
  if (info) {
    info.style.display = ticketsState.ticketsSelectionMode ? '' : 'none';
    info.textContent = n > 0 ? `${n} selected` : 'Tap tickets to select';
  }
  if (archiveBtn) {
    archiveBtn.style.display = ticketsState.ticketsSelectionMode ? '' : 'none';
    archiveBtn.disabled = n === 0;
    archiveBtn.style.opacity = n === 0 ? '0.5' : '1';
    archiveBtn.style.background = onArchived ? '#ef4444' : '#7c3aed';
    archiveBtn.textContent = onArchived
      ? (n > 0 ? `Delete selected (${n})` : 'Delete selected')
      : (n > 0 ? `Archive selected (${n})` : 'Archive selected');
  }
  if (cancelBtn) cancelBtn.style.display = ticketsState.ticketsSelectionMode ? '' : 'none';
}

function ffTicketsBulkInit() {
  const toggleBtn = document.getElementById('ticketsSelectToggleBtn');
  const selectAllBtn = document.getElementById('ticketsSelectAllBtn');
  const archiveBtn = document.getElementById('ticketsBulkArchiveBtn');
  const cancelBtn = document.getElementById('ticketsBulkCancelBtn');
  if (toggleBtn && !toggleBtn._ffWired) {
    toggleBtn._ffWired = true;
    toggleBtn.onclick = () => {
      ticketsState.ticketsSelectionMode = true;
      ticketsState.ticketsSelectionTab = ticketsState.currentTicketsTab;
      ticketsState.ticketsSelected.clear();
      renderTicketsList();
    };
  }
  if (selectAllBtn && !selectAllBtn._ffWired) {
    selectAllBtn._ffWired = true;
    selectAllBtn.onclick = () => {
      const allSelected = ticketsState.ticketsClosedShownIds.length > 0 && ticketsState.ticketsSelected.size >= ticketsState.ticketsClosedShownIds.length;
      ticketsState.ticketsSelected.clear();
      if (!allSelected) ticketsState.ticketsClosedShownIds.forEach((id) => ticketsState.ticketsSelected.add(id));
      renderTicketsList();
    };
  }
  if (cancelBtn && !cancelBtn._ffWired) {
    cancelBtn._ffWired = true;
    cancelBtn.onclick = () => { ffTicketsExitSelectionMode(); renderTicketsList(); };
  }
  if (archiveBtn && !archiveBtn._ffWired) {
    archiveBtn._ffWired = true;
    archiveBtn.onclick = () => {
      if (ticketsState.currentTicketsTab === 'archived') void ffTicketsDeleteSelected();
      else void ffTicketsArchiveSelected();
    };
  }
}

/** Archive every selected CLOSED/VOID ticket in chunked Firestore batches (handles hundreds at once). */
async function ffTicketsArchiveSelected() {
  if (!ffTicketsCanBulkArchive()) { showToast('Not allowed', 'error'); return; }
  const ids = Array.from(ticketsState.ticketsSelected);
  if (ids.length === 0) return;
  const ok = await ticketConfirm(`Move ${ids.length} ticket${ids.length > 1 ? 's' : ''} to Archived?`, 'Archive tickets');
  if (!ok) return;
  const salonId = getActiveTicketsSalonId();
  if (!salonId) { showToast('No salon selected', 'error'); return; }
  const archiveBtn = document.getElementById('ticketsBulkArchiveBtn');
  if (archiveBtn) { archiveBtn.disabled = true; archiveBtn.textContent = 'Archiving\u2026'; }
  try {
    let done = 0;
    const CHUNK = 400; // Firestore batch limit is 500; stay safely below.
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      const batchPatches = [];
      slice.forEach((id) => {
        const t = ticketsState.currentTickets.find((x) => x.id === id);
        // Defensive: only ever archive CLOSED/VOID tickets.
        if (!t || !(t.status === 'CLOSED' || t.status === 'VOID')) return;
        const ref = doc(db, `salons/${salonId}/tickets`, id);
        const existingHist = Array.isArray(t.history) ? t.history : [];
        const hist = [...existingHist, {
          at: Timestamp.now(),
          by: ticketsState.currentUserProfile.uid,
          byName: ticketsState.currentUserProfile.name || '',
          action: 'archived',
          details: 'bulk'
        }];
        const fields = {
          status: 'ARCHIVED',
          archivedByUid: ticketsState.currentUserProfile.uid,
          history: hist
        };
        batch.update(ref, { ...fields, updatedAt: serverTimestamp() });
        batchPatches.push({ id, fields });
      });
      if (batchPatches.length > 0) {
        await batch.commit();
        done += batchPatches.length;
        // Keep the local pagination cache in sync — tickets loaded via "Load more"
        // are not covered by the live snapshot and would otherwise reappear as CLOSED.
        batchPatches.forEach((p) => ffTicketsPatchLocalTicket(p.id, p.fields));
      }
    }
    _rebuildCurrentTicketsMerged();
    ffTicketsExitSelectionMode();
    showToast(`${done} ticket${done !== 1 ? 's' : ''} archived`, 'success');
    renderTicketsList();
  } catch (e) {
    console.warn('[Tickets] bulk archive failed', e);
    showToast(e?.message || 'Failed to archive', 'error');
    // Earlier batches may have committed — reflect them locally.
    _rebuildCurrentTicketsMerged();
    renderTicketsList();
    if (archiveBtn) archiveBtn.disabled = false;
    ffTicketsUpdateBulkBar();
  }
}

/**
 * Permanently delete every selected ARCHIVED ticket in chunked Firestore batches
 * (handles hundreds at once). Mirrors deleteTicketPermanently: matching
 * ticketSummaries rows are marked source-deleted before the tickets are removed.
 */
async function ffTicketsDeleteSelected() {
  if (!ffTicketsCanBulkArchive()) { showToast('Not allowed', 'error'); return; }
  const ids = Array.from(ticketsState.ticketsSelected);
  if (ids.length === 0) return;
  const ok = await ticketConfirm(
    `Permanently delete ${ids.length} ticket${ids.length > 1 ? 's' : ''}? This cannot be undone.`,
    'Delete tickets'
  );
  if (!ok) return;
  const salonId = getActiveTicketsSalonId();
  if (!salonId) { showToast('No salon selected', 'error'); return; }
  const actionBtn = document.getElementById('ticketsBulkArchiveBtn');
  if (actionBtn) { actionBtn.disabled = true; actionBtn.textContent = 'Deleting\u2026'; }
  // Defensive: only ever bulk-delete ARCHIVED tickets.
  const delIds = ids.filter((id) => {
    const t = ticketsState.currentTickets.find((x) => x.id === id);
    return !!t && t.status === 'ARCHIVED';
  });
  try {
    // 1) Mark matching Summary rows as source-deleted (same as single permanent delete).
    //    Failure here must not block the delete itself — same tolerance as the single flow.
    try {
      const uid = ticketsState.currentUserProfile?.uid ?? null;
      const byName = ticketsState.currentUserProfile?.name || ticketsState.currentUserProfile?.email || null;
      const IN_CHUNK = 10; // conservative 'in' filter size
      for (let i = 0; i < delIds.length; i += IN_CHUNK) {
        const slice = delIds.slice(i, i + IN_CHUNK);
        const snap = await getDocs(query(
          collection(db, `salons/${salonId}/ticketSummaries`),
          where('ticketId', 'in', slice)
        ));
        for (let j = 0; j < snap.docs.length; j += 400) {
          const markBatch = writeBatch(db);
          snap.docs.slice(j, j + 400).forEach((d) => {
            markBatch.update(d.ref, {
              sourceTicketDeleted: true,
              sourceTicketDeletedAt: serverTimestamp(),
              sourceTicketDeletedByUid: uid,
              sourceTicketDeletedByName: byName
            });
          });
          await markBatch.commit();
        }
      }
    } catch (e) {
      console.warn('[Tickets] bulk delete: ticketSummaries markers failed', e);
    }

    // 2) Delete the tickets themselves in chunked batches.
    let done = 0;
    const CHUNK = 400; // Firestore batch limit is 500; stay safely below.
    for (let i = 0; i < delIds.length; i += CHUNK) {
      const slice = delIds.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      slice.forEach((id) => batch.delete(doc(db, `salons/${salonId}/tickets`, id)));
      await batch.commit();
      done += slice.length;
      // Remove from the local pagination caches — "Load more" rows are not in the
      // live snapshot and would otherwise keep rendering until a full reload.
      const gone = new Set(slice);
      ticketsState._ticketsExtraTickets = ticketsState._ticketsExtraTickets.filter((t) => !gone.has(t.id));
      ticketsState._ticketsFirstPageTickets = ticketsState._ticketsFirstPageTickets.filter((t) => !gone.has(t.id));
      if (actionBtn) actionBtn.textContent = `Deleting\u2026 (${done}/${delIds.length})`;
    }
    _rebuildCurrentTicketsMerged();
    ffTicketsExitSelectionMode();
    showToast(`${done} ticket${done !== 1 ? 's' : ''} deleted`, 'success');
    renderTicketsList();
  } catch (e) {
    console.warn('[Tickets] bulk delete failed', e);
    showToast(e?.message || 'Failed to delete', 'error');
    // Earlier batches may have committed — reflect them locally.
    _rebuildCurrentTicketsMerged();
    renderTicketsList();
    if (actionBtn) actionBtn.disabled = false;
    ffTicketsUpdateBulkBar();
  }
}

// Build a single ticket card with the EXACT same look as the Tickets list cards.
// Used by the Tickets list and by the Live Desk so both look identical.
function ffBuildTicketCardHTML(t) {
  const statusKey = (s) => {
    s = String(s || '').toUpperCase();
    if (s === 'READY_FOR_CHECKOUT') return 'ready';
    if (s === 'CLOSED') return 'closed';
    if (s === 'VOID') return 'void';
    if (s === 'ARCHIVED') return 'archived';
    return 'open';
  };
  const submittedAt = formatDate(t.createdAt);
  const allLines = t.performedLines || [];
  const lines = allLines.slice(0, 4);
  const more = allLines.length > 4 ? allLines.length - 4 : 0;
  const techName = escapeHtml(t.technicianName || '\u2014');
  const customerName = (t.customerName || '').trim();
  const initial = getInitial(t.technicianName);
  const sk = statusKey(t.status);
  const statusLabel = { ready: 'READY', closed: 'CLOSED', open: 'OPEN', void: 'VOID', archived: 'ARCHIVED' }[sk] || sk.toUpperCase();
  const isAdminOrManager = ticketsState.currentUserProfile && ['owner', 'admin', 'manager'].includes((ticketsState.currentUserProfile.role || '').toLowerCase());
  const isReady = sk === 'ready';
  const showEdited = isAdminOrManager && isReady && t.serviceUpgrade !== true && ticketHasRealPostSendEdit(t);
  const editedBadgeHtml = showEdited ? '<span class="ticket-edited-badge">Edited</span>' : '';
  const customerApprovedBadgeHtml = (t.customerApprovedPrice === true)
    ? '<span class="ticket-customer-approved-badge" title="Customer approved the price">Approved</span>'
    : '';
  const serviceUpgradeBadgeHtml = (t.serviceUpgrade === true)
    ? '<span class="ticket-customer-approved-badge" title="Service upgrade marked" style="background:#7c3aed;">Upgrade</span>'
    : '';
  const reviewedWhenStr = ffFormatReviewedAt(t.reviewedAt);
  const reviewedBadgeHtml = (t.reviewedByFrontDesk === true)
    ? `<span class="ticket-customer-approved-badge" title="Reviewed by front desk${t.reviewedByName ? ' \u00b7 ' + escapeHtml(t.reviewedByName) : ''}${reviewedWhenStr ? ' \u00b7 ' + escapeHtml(reviewedWhenStr) : ''}" style="background:#2563eb;">Reviewed</span>`
    : '';
  const technicianAvatarUrl = getTicketTechnicianAvatarUrl(t);
  const initialEsc = escapeHtml(initial);
  const avatarLoadedAttr = technicianAvatarUrl ? '0' : '1';
  const imgTag = technicianAvatarUrl
    ? `<img class="ticket-card-avatar-img" src="${String(technicianAvatarUrl).replace(/"/g, '&quot;')}" alt="" loading="lazy" decoding="async" onload="var w=this.closest('.ticket-card-avatar-wrap');if(w)w.setAttribute('data-avatar-loaded','1');" onerror="var w=this.closest('.ticket-card-avatar-wrap');if(w)w.setAttribute('data-avatar-loaded','error');" />`
    : '';
  const avatarHtml = `<div class="ticket-card-avatar-wrap" data-avatar-loaded="${avatarLoadedAttr}"><span class="ticket-card-avatar-fallback">${initialEsc}</span>${imgTag}</div>`;
  const linesHtml = lines.map(l => `<div style="font-size:13px;color:#374151;padding:2px 0;">${formatLineForList(l)}</div>`).join('');
  const moreHtml = more > 0 ? `<div style="font-size:11px;color:#9ca3af;margin-top:2px;">+ ${more} more\u2026</div>` : '';
  const asIsHtml = t.asIs && t.asIsMessage
    ? `<div style="font-size:12px;color:#059669;background:#d1fae5;padding:6px 8px;border-radius:6px;margin-top:6px;"><strong>AS IS:</strong> ${escapeHtml(t.asIsMessage)}</div>`
    : '';
  const closedByHtml = (sk === 'closed' && t.closedByName)
    ? `<div style="font-size:11px;color:#059669;margin-top:2px;">\u2713 Closed by ${escapeHtml(t.closedByName)}</div>`
    : '';
  return `
    <div class="ticket-card" data-ticket-id="${t.id}">
      <div class="ticket-card-header-row" style="display:flex;align-items:center;gap:10px;margin-bottom:10px;min-height:44px;">
        ${avatarHtml}
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:14px;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${techName}</div>
          ${customerName ? `<div style="font-size:11px;color:#6b7280;margin-top:1px;">\uD83D\uDC64 ${escapeHtml(customerName)}</div>` : ''}
          <div style="font-size:11px;color:#9ca3af;margin-top:1px;">${submittedAt}</div>
          ${closedByHtml}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
          <span class="ticket-status-badge ${sk}">${statusLabel}</span>
          ${serviceUpgradeBadgeHtml}
          ${customerApprovedBadgeHtml}
          ${reviewedBadgeHtml}
          ${editedBadgeHtml}
        </div>
      </div>
      <div style="border-top:1px dashed #e5e7eb;padding-top:10px;">
        ${linesHtml || '<div style="font-size:12px;color:#9ca3af;">No services</div>'}
        ${moreHtml}
      </div>
      ${asIsHtml}
    </div>
  `;
}
window.ffRenderTicketCardHTML = function (t) {
  try { return t ? ffBuildTicketCardHTML(t) : ''; } catch (_) { return ''; }
};

function renderTicketsList() {
  // Keep the Live Desk tickets card in sync in real time (it reads from ffGetCurrentTickets).
  if (typeof window.ffLiveRefreshTicketsCard === 'function') {
    try { window.ffLiveRefreshTicketsCard(); } catch (_eLive) {}
  }
  const listEl = document.getElementById('ticketsList');
  const loadingEl = document.getElementById('ticketsLoading');
  const emptyEl = document.getElementById('ticketsEmpty');
  const summaryPanel = document.getElementById('ticketsSummaryPanel');
  if (!listEl) return;

  updateTicketsTabsVisibility();
  if (ticketsState.currentTicketsTab === 'summary' && !canViewTicketsSummaryTab()) {
    ticketsState.currentTicketsTab = 'ready';
    document.querySelectorAll('.tickets-tab').forEach(b => b.classList.remove('active'));
    const rb = document.querySelector('.tickets-tab[data-tab="ready"]');
    if (rb) rb.classList.add('active');
  } else if (ticketsState.currentTicketsTab === 'archived' && !canViewTicketsArchivedTab()) {
    ticketsState.currentTicketsTab = 'ready';
    document.querySelectorAll('.tickets-tab').forEach(b => b.classList.remove('active'));
    const rb = document.querySelector('.tickets-tab[data-tab="ready"]');
    if (rb) rb.classList.add('active');
  }

  if (ticketsState.ticketsSelectionMode && ticketsState.currentTicketsTab !== ticketsState.ticketsSelectionTab) ffTicketsExitSelectionMode();
  ffTicketsUpdateBulkBar();

  if (ticketsState.currentTicketsTab === 'summary') {
    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'none';
    if (summaryPanel) summaryPanel.style.display = 'block';
    listEl.innerHTML = '';
    listEl.classList.remove('tickets-list--closed', 'tickets-list--archived');
    ffTicketsSetTimePeriodFiltersVisible(true);
    syncTicketsTimePeriodSelectOptions();
    ensureTicketsSummaryDefaultTimePeriod();
    populateTicketsEmployeeSelect();
    updateTicketsEmployeeFilterVisibility();
    void loadAndRenderTicketsSummary();
    updateTicketsLoadMoreUi();
    return;
  }
  if (summaryPanel) summaryPanel.style.display = 'none';

  if (!ticketsState._ticketsListSnapshotReady) {
    if (loadingEl) loadingEl.style.display = 'block';
    if (emptyEl) emptyEl.style.display = 'none';
    listEl.innerHTML = '';
    updateTicketsLoadMoreUi();
    return;
  }

  const statusFilter = { ready: 'READY_FOR_CHECKOUT', closed: 'CLOSED', archived: 'ARCHIVED' }[ticketsState.currentTicketsTab] || 'READY_FOR_CHECKOUT';
  let toShow = ticketsState.currentTicketsTab === 'archived'
    ? ticketsState.currentTickets.filter(t => t.status === 'ARCHIVED')
    : ticketsState.currentTicketsTab === 'closed'
    ? ticketsState.currentTickets.filter(t => t.status === 'CLOSED' || t.status === 'VOID')
    : ticketsState.currentTickets.filter(t => t.status === statusFilter);
  toShow = toShow.filter(t => canSeeTicket(t));

  const showDateFilters = ticketsState.currentTicketsTab === 'closed' || ticketsState.currentTicketsTab === 'archived';
  const hideDeskFiltersHere = showDateFilters && ffTicketsHideFrontDeskFiltersOnThisView();
  const filtersOn = showDateFilters && !hideDeskFiltersHere;
  ffTicketsSetTimePeriodFiltersVisible(filtersOn);
  if (showDateFilters && !hideDeskFiltersHere) syncTicketsTimePeriodSelectOptions();
  const periodSel = document.getElementById('ticketsTimePeriodSelect');
  const customWrap = document.getElementById('ticketsTimePeriodCustomWrap');
  if (showDateFilters && !hideDeskFiltersHere && periodSel && customWrap) {
    customWrap.style.display = periodSel.value === 'custom' ? 'inline-flex' : 'none';
  }

  const fromEl = document.getElementById('ticketsFilterDateFrom');
  const toEl = document.getElementById('ticketsFilterDateTo');
  const fromStr = showDateFilters && fromEl ? (fromEl.value || '').trim() : '';
  const toStr = showDateFilters && toEl ? (toEl.value || '').trim() : '';
  const hasDateFilter = showDateFilters && !hideDeskFiltersHere && (fromStr || toStr);
  const countAfterStatus = toShow.length;
  if (hasDateFilter) {
    toShow = toShow.filter(t => passesTicketsDateFilter(t, fromStr, toStr));
  }
  if (showDateFilters && !hideDeskFiltersHere) populateTicketsEmployeeSelect();
  updateTicketsEmployeeFilterVisibility();
  const empEl = document.getElementById('ticketsEmployeeSelect');
  let employeeId = showDateFilters && empEl ? (empEl.value || 'all') : 'all';
  if (showDateFilters && isTicketsTechnicianRestrictedRole() && !isStaffRecordManagerOrAdmin()) {
    employeeId = getTicketsSelfEmployeeFilterId();
  }
  const hasEmployeeFilter = showDateFilters && employeeId !== 'all';
  if (hasEmployeeFilter) {
    const techSelfOnly =
      isTicketsTechnicianRestrictedRole() && !isStaffRecordManagerOrAdmin();
    toShow = toShow.filter((t) =>
      techSelfOnly ? ticketBelongsToTicketsTechnician(t) : ticketMatchesEmployeeFilter(t, employeeId)
    );
  }

  if (loadingEl) loadingEl.style.display = 'none';
  if (emptyEl) {
    emptyEl.style.display = toShow.length === 0 ? 'block' : 'none';
    if (toShow.length === 0) {
      if (countAfterStatus > 0 && (hasDateFilter || hasEmployeeFilter)) {
        emptyEl.textContent = 'No tickets match this filter.';
      } else {
        emptyEl.textContent = 'No tickets here yet.';
      }
    }
  }

  listEl.classList.toggle('tickets-list--closed', ticketsState.currentTicketsTab === 'closed');
  listEl.classList.toggle('tickets-list--archived', ticketsState.currentTicketsTab === 'archived');

  // Track which tickets are currently shown (for "Select all"), and drop
  // any selected ids that are no longer visible (e.g. archived/deleted elsewhere).
  if (ffTicketsBulkTabHere()) {
    ticketsState.ticketsClosedShownIds = toShow.map((t) => t.id);
    if (ticketsState.ticketsSelected.size) {
      const shown = new Set(ticketsState.ticketsClosedShownIds);
      Array.from(ticketsState.ticketsSelected).forEach((id) => { if (!shown.has(id)) ticketsState.ticketsSelected.delete(id); });
    }
  } else {
    ticketsState.ticketsClosedShownIds = [];
  }
  const inBulkSelect = ticketsState.ticketsSelectionMode && ffTicketsBulkTabHere();

  // Helper: status css key
  const statusKey = (s) => {
    if (s === 'READY_FOR_CHECKOUT') return 'ready';
    if (s === 'CLOSED') return 'closed';
    if (s === 'OPEN') return 'open';
    if (s === 'VOID') return 'void';
    if (s === 'ARCHIVED') return 'archived';
    return 'open';
  };

  listEl.innerHTML = toShow.map(t => {
    const submittedAt = formatDate(t.createdAt);
    const allLines = t.performedLines || [];
    const lines = allLines.slice(0, 4);
    const more = allLines.length > 4 ? allLines.length - 4 : 0;
    const techName = escapeHtml(t.technicianName || '—');
    const customerName = (t.customerName || '').trim();
    const initial = getInitial(t.technicianName);
    const sk = statusKey(t.status);
    const statusLabel = { ready:'READY', closed:'CLOSED', open:'OPEN', void:'VOID', archived:'ARCHIVED' }[sk] || sk.toUpperCase();
    const isAdminOrOwner = ticketsState.currentUserProfile && ['owner', 'admin'].includes((ticketsState.currentUserProfile.role || '').toLowerCase());
    const showDeleteBtn = ticketsState.currentTicketsTab === 'archived' && isAdminOrOwner && !inBulkSelect;
    const isCreator = ticketsState.currentUserProfile && (
      t.createdByUid === ticketsState.currentUserProfile.uid ||
      t.technicianStaffId === ticketsState.currentUserProfile.staffId ||
      t.technicianStaffId === ticketsState.currentUserProfile.uid ||
      t.finalizedByUid === ticketsState.currentUserProfile.uid ||
      (t.technicianName && (
        (ticketsState.currentUserProfile.email && String(t.technicianName).toLowerCase().includes(String(ticketsState.currentUserProfile.email).toLowerCase())) ||
        (ticketsState.currentUserProfile.name && String(t.technicianName).toLowerCase().includes(String(ticketsState.currentUserProfile.name).toLowerCase()))
      ))
    );
    const canEdit = isCreator && t.status !== 'CLOSED' && t.status !== 'ARCHIVED' && t.status !== 'VOID';
    const editBtnHtml = canEdit
      ? `<button type="button" class="ticket-edit-btn" data-ticket-id="${t.id}" title="Edit ticket" style="padding:6px;background:none;border:none;cursor:pointer;flex-shrink:0;color:#9ca3af;line-height:0;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`
      : '';
    const isAdminOrManager = ticketsState.currentUserProfile && ['owner', 'admin', 'manager'].includes((ticketsState.currentUserProfile.role || '').toLowerCase());
    const canSeeEditedFlag = isAdminOrManager;
    const isReady = sk === 'ready';
    const showEdited = canSeeEditedFlag && isReady && t.serviceUpgrade !== true && ticketHasRealPostSendEdit(t);
    const editedBadgeHtml = showEdited ? '<span class="ticket-edited-badge">Edited</span>' : '';
    const customerApprovedBadgeHtml = (t.customerApprovedPrice === true)
      ? '<span class="ticket-customer-approved-badge" title="Customer approved the price">Approved</span>'
      : '';
    const serviceUpgradeBadgeHtml = (t.serviceUpgrade === true)
      ? '<span class="ticket-customer-approved-badge" title="Service upgrade marked" style="background:#7c3aed;">Upgrade</span>'
      : '';
    const reviewedWhenStr = ffFormatReviewedAt(t.reviewedAt);
    const reviewedBadgeHtml = (t.reviewedByFrontDesk === true)
      ? `<span class="ticket-customer-approved-badge" title="Reviewed by front desk${t.reviewedByName ? ' \u00b7 ' + escapeHtml(t.reviewedByName) : ''}${reviewedWhenStr ? ' \u00b7 ' + escapeHtml(reviewedWhenStr) : ''}" style="background:#2563eb;">Reviewed</span>`
      : '';
    const technicianAvatarUrl = getTicketTechnicianAvatarUrl(t);
    const initialEsc = escapeHtml(initial);
    const avatarLoadedAttr = technicianAvatarUrl ? '0' : '1';
    const imgTag = technicianAvatarUrl
      ? `<img class="ticket-card-avatar-img" src="${String(technicianAvatarUrl).replace(/"/g, '&quot;')}" alt="" loading="lazy" decoding="async" onload="var w=this.closest('.ticket-card-avatar-wrap');if(w)w.setAttribute('data-avatar-loaded','1');" onerror="var w=this.closest('.ticket-card-avatar-wrap');if(w)w.setAttribute('data-avatar-loaded','error');" />`
      : '';
    const avatarHtml = `<div class="ticket-card-avatar-wrap" data-avatar-loaded="${avatarLoadedAttr}"><span class="ticket-card-avatar-fallback">${initialEsc}</span>${imgTag}</div>`;

    // Service lines — bullet style matching screenshot
    const linesHtml = lines.map(l => `<div style="font-size:13px;color:#374151;padding:2px 0;">${formatLineForList(l)}</div>`).join('');
    const moreHtml = more > 0 ? `<div style="font-size:11px;color:#9ca3af;margin-top:2px;">+ ${more} more…</div>` : '';
    const asIsHtml = t.asIs && t.asIsMessage
      ? `<div style="font-size:12px;color:#059669;background:#d1fae5;padding:6px 8px;border-radius:6px;margin-top:6px;"><strong>AS IS:</strong> ${escapeHtml(t.asIsMessage)}</div>`
      : '';
    const deleteBtnHtml = showDeleteBtn
      ? `<div style="margin-top:10px;"><button type="button" class="ticket-delete-btn" data-ticket-id="${t.id}" style="padding:5px 12px;background:#ef4444;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;">Delete permanently</button></div>`
      : '';

    const closedByHtml = (sk === 'closed' && t.closedByName)
      ? `<div style="font-size:11px;color:#059669;margin-top:2px;">✓ Closed by ${escapeHtml(t.closedByName)}</div>`
      : '';

    const isSel = inBulkSelect && ticketsState.ticketsSelected.has(t.id);
    const selCbHtml = inBulkSelect ? `<div class="ticket-select-cb">${isSel ? '\u2713' : ''}</div>` : '';
    const cardClass = `ticket-card${inBulkSelect ? ' ticket-selectable' : ''}${isSel ? ' ticket-selected' : ''}`;

    return `
    <div class="${cardClass}" data-ticket-id="${t.id}">
      <!-- Header row: fixed min-height + center alignment avoids row jump when avatar/text resolves -->
      <div class="ticket-card-header-row" style="display:flex;align-items:center;gap:10px;margin-bottom:10px;min-height:44px;">
        ${selCbHtml}
        ${editBtnHtml}
        ${avatarHtml}
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:14px;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${techName}</div>
          ${customerName ? `<div style="font-size:11px;color:#6b7280;margin-top:1px;">👤 ${escapeHtml(customerName)}</div>` : ''}
          <div style="font-size:11px;color:#9ca3af;margin-top:1px;">${submittedAt}</div>
          ${closedByHtml}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
          <span class="ticket-status-badge ${sk}">${statusLabel}</span>
          ${serviceUpgradeBadgeHtml}
          ${customerApprovedBadgeHtml}
          ${reviewedBadgeHtml}
          ${editedBadgeHtml}
        </div>
      </div>
      <!-- Dashed separator + services -->
      <div style="border-top:1px dashed #e5e7eb;padding-top:10px;">
        ${linesHtml || '<div style="font-size:12px;color:#9ca3af;">No services</div>'}
        ${moreHtml}
      </div>
      ${asIsHtml}
      ${deleteBtnHtml}
    </div>
  `  }).join('');

  listEl.querySelectorAll('.ticket-card-avatar-wrap img.ticket-card-avatar-img').forEach((img) => {
    try {
      if (img.complete && img.naturalHeight > 0) {
        img.closest('.ticket-card-avatar-wrap')?.setAttribute('data-avatar-loaded', '1');
      }
    } catch (e) {}
  });

  listEl.querySelectorAll('.ticket-card').forEach(card => {
    const ticketId = card.getAttribute('data-ticket-id');
    card.onclick = (e) => {
      if (e.target.closest('.ticket-delete-btn')) return;
      if (ticketsState.ticketsSelectionMode && ffTicketsBulkTabHere()) {
        e.preventDefault();
        ffTicketsToggleSelect(ticketId, card);
        return;
      }
      openTicketModal(ticketId);
    };
  });
  listEl.querySelectorAll('.ticket-delete-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-ticket-id');
      const ok = await ticketConfirm('Permanently delete this ticket? This cannot be undone.', 'Delete ticket');
      if (!id || !ok) return;
      try {
        await deleteTicketPermanently(id);
        showToast('Ticket deleted', 'success');
      } catch (err) {
        showToast(err?.message || 'Failed to delete', 'error');
      }
    };
  });

  updateTicketsLoadMoreUi();
  ffTicketsUpdateBulkBar();
}

function statusBg(s) {
  if (s === 'OPEN') return '#fef3c7';
  if (s === 'READY_FOR_CHECKOUT') return '#dbeafe';
  if (s === 'CLOSED') return '#d1fae5';
  if (s === 'ARCHIVED') return '#e5e7eb';
  return '#f3f4f6';
}
function statusColor(s) {
  if (s === 'OPEN') return '#92400e';
  if (s === 'READY_FOR_CHECKOUT') return '#1e40af';
  if (s === 'CLOSED') return '#065f46';
  if (s === 'ARCHIVED') return '#4b5563';
  return '#6b7280';
}

function escapeHtml(s) {
  if (s == null) return '';
  const str = String(s);
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

// =====================
// UI: Ticket Modal (create/edit)
// =====================
function openTicketModal(ticketId, appointmentData = null) {
  ticketsState.editingTicketId = ticketId || null;
  window._ticketModalAppointmentData = appointmentData || null;
  const modal = document.getElementById('ticketModal');
  const title = document.getElementById('ticketModalTitle');
  if (!modal || !title) return;

  if (ticketsState.editingTicketId) {
    const t = ticketsState.currentTickets.find(x => x.id === ticketsState.editingTicketId);
    if (!t) return;
    if (!canSeeTicket(t)) {
      showToast('You cannot view this ticket.', 'error');
      return;
    }
    const s = (t.status || '').toUpperCase();
    if (s === 'CLOSED' || s === 'VOID' || s === 'ARCHIVED') {
      if (ticketsState._justClosedTicketId === ticketsState.editingTicketId) {
        ticketsState._justClosedTicketId = null;
        return;
      }
      openTicketDetailsModal(t);
      return;
    }

    // Admin/manager/owner viewing a READY ticket → simplified view with Close Ticket only
    if (canCurrentUserCloseTickets() && s === 'READY_FOR_CHECKOUT') {
      if (!t.seenByFrontDeskAt) {
        ticketsState._ticketsOpenedThisSession.add(t.id);
        t.seenByFrontDeskAt = true;
        updateTicketsNavBadge();
        markTicketSeenByFrontDesk(t.id).catch(() => {});
      }
      openAdminTicketView(t);
      return;
    }

    // Admin/manager/owner viewing an OPEN ticket → manager (read-only) view, NOT the
    // technician edit form. They can review / upgrade / close, but not edit prices
    // like a technician. Technicians (cannot close) still get the edit form below.
    if (canCurrentUserCloseTickets() && s === 'OPEN') {
      openAdminTicketView(t);
      return;
    }

    if (s === 'READY_FOR_CHECKOUT' && !t.seenByFrontDeskAt) {
      ticketsState._ticketsOpenedThisSession.add(t.id);
      t.seenByFrontDeskAt = true;
      updateTicketsNavBadge();
      const { isPrimaryAdmin, hasReceivesTickets } = getTicketVisibility();
      if (isPrimaryAdmin || hasReceivesTickets) markTicketSeenByFrontDesk(t.id).catch(() => {});
    }
    title.textContent = 'Edit Ticket';
    populateTicketForm(t);
  } else {
    title.textContent = 'New Ticket';
    resetTicketForm();
    if (appointmentData && appointmentData.services && appointmentData.services.length > 0) {
      const block = document.getElementById('ticketAsBookedBlock');
      const none = document.getElementById('ticketAsBookedNone');
      const content = document.getElementById('ticketAsBookedContent');
      if (block) block.style.display = 'block';
      if (none) none.style.display = 'none';
      if (content) {
        const booked = appointmentData.services;
        content.innerHTML = booked.map(s => `<div style="font-size:13px;">${escapeHtml(s.name || s.serviceName)} — ${ffTicketMoney(s.price || 0)}</div>`).join('');
        content.style.display = 'none';
      }
    }
  }
  modal.style.display = 'flex';
}

/** Admin/manager view: read-only ticket with ONLY Close Ticket button.
 *  Uses existing modal elements — does NOT replace innerHTML. */
function ffFormatReviewedAt(v) {
  try {
    if (!v) return '';
    let d = null;
    if (v instanceof Date) d = v;
    else if (typeof v.toDate === 'function') d = v.toDate();
    else if (v.seconds) d = new Date(v.seconds * 1000);
    if (!d || isNaN(d.getTime())) return '';
    return formatTicketDisplayDateTime(d);
  } catch (_) { return ''; }
}

async function toggleTicketReviewed(ticketId) {
  const t = (ticketsState.currentTickets || []).find(x => x.id === ticketId);
  if (!t) return;
  if (!canCurrentUserCloseTickets()) { showToast('Not allowed', 'error'); return; }
  const makeReviewed = !(t.reviewedByFrontDesk === true);
  try {
    if (makeReviewed) {
      await updateTicket(ticketId, {
        reviewedByFrontDesk: true,
        reviewedByUid: (ticketsState.currentUserProfile && ticketsState.currentUserProfile.uid) || null,
        reviewedByName: (ticketsState.currentUserProfile && (ticketsState.currentUserProfile.name || ticketsState.currentUserProfile.email)) || '',
        reviewedAt: serverTimestamp(),
        _action: 'reviewed_marked'
      });
      t.reviewedByFrontDesk = true;
      t.reviewedByName = (ticketsState.currentUserProfile && (ticketsState.currentUserProfile.name || ticketsState.currentUserProfile.email)) || '';
      t.reviewedAt = new Date();
    } else {
      await updateTicket(ticketId, {
        reviewedByFrontDesk: false,
        reviewedByUid: null,
        reviewedByName: null,
        reviewedAt: null,
        _action: 'reviewed_cleared'
      });
      t.reviewedByFrontDesk = false;
      t.reviewedByName = null;
      t.reviewedAt = null;
    }
    showToast(makeReviewed ? 'Marked as reviewed' : 'Review cleared', 'success');
    const modal = document.getElementById('ticketModal');
    if (modal && modal.dataset.adminView === '1') openAdminTicketView(t);
    if (typeof renderTicketsList === 'function') renderTicketsList();
  } catch (e) {
    showToast((e && e.message) || 'Failed to update', 'error');
  }
}

function openAdminTicketView(t) {
  const modal = document.getElementById('ticketModal');
  const title = document.getElementById('ticketModalTitle');
  if (!modal || !title) return;

  title.textContent = 'Ticket from ' + escapeHtml(t.technicianName || 'Technician');

  const lines = t.performedLines || [];
  const total = lines.reduce((s, l) => s + (Number(l.ticketPrice) || 0), 0);

  // Build read-only service list in existing performed list area
  const cont = document.getElementById('ticketPerformedList');
  if (cont) {
    cont.innerHTML = lines.map(l => {
      const price = Number(l.ticketPrice) || 0;
      const base = Number(l.catalogPrice) || 0;
      const adjusted = base > 0 && price !== base;
      return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;">
        <span style="color:#374151;">${escapeHtml(l.serviceName || '')}</span>
        <span style="font-weight:700;color:${adjusted ? '#d97706' : '#111'};">${ffTicketMoney(price)}${adjusted ? ` <small style="color:#9ca3af;">(base ${ffTicketMoney(base)})</small>` : ''}</span>
      </div>`;
    }).join('') || '<div style="color:#9ca3af;font-size:14px;padding:8px 0;">No services</div>';
    cont.innerHTML += ffRenderFrontDeskChangesHtml(t);
  }

  // Hide lines data and service picker
  const linesData = document.getElementById('ticketLinesData');
  if (linesData) linesData.value = JSON.stringify(lines);

  const picker = document.getElementById('ticketServicePickerContainer');
  if (picker) picker.style.display = 'none';
  ffTicketServiceSearchSetVisible(false);

  // Customer name (read-only)
  const custToggle = document.getElementById('ticketCustomerToggle');
  if (custToggle) custToggle.style.display = 'none';
  const custWrap = document.getElementById('ticketCustomerWrap');
  const custInput = document.getElementById('ticketCustomerName');
  if ((t.customerName || '').trim()) {
    if (custWrap) custWrap.style.display = 'block';
    if (custInput) { custInput.value = t.customerName; custInput.readOnly = true; }
  } else {
    if (custWrap) custWrap.style.display = 'none';
  }

  // Show total
  const totalBlock = document.getElementById('ticketTotalBlock');
  const totalAmt   = document.getElementById('ticketTotalAmount');
  if (totalBlock) totalBlock.style.display = lines.length > 0 ? 'block' : 'none';
  if (totalAmt)   totalAmt.textContent = ffTicketMoney(total);

  const priceApprovedWrap = document.getElementById('ticketCustomerPriceApprovedWrap');
  if (priceApprovedWrap) priceApprovedWrap.style.display = 'none';

  const adminAprBlock = document.getElementById('ticketAdminPriceApprovalBlock');
  if (adminAprBlock) {
    if (t.customerApprovedPrice === true) {
      adminAprBlock.innerHTML = '<strong>Customer approved the price</strong> ✓';
      adminAprBlock.style.display = 'block';
      adminAprBlock.style.padding = '12px 14px';
      adminAprBlock.style.borderRadius = '8px';
      adminAprBlock.style.fontSize = '14px';
      adminAprBlock.style.color = '#5b21b6';
      adminAprBlock.style.background = '#f5f3ff';
      adminAprBlock.style.border = '1px solid #e9d5ff';
    } else {
      adminAprBlock.innerHTML = 'Technician did <strong>not</strong> confirm that the customer approved the final price.';
      adminAprBlock.style.display = 'block';
      adminAprBlock.style.padding = '12px 14px';
      adminAprBlock.style.borderRadius = '8px';
      adminAprBlock.style.fontSize = '14px';
      adminAprBlock.style.color = '#92400e';
      adminAprBlock.style.background = '#fffbeb';
      adminAprBlock.style.border = '1px solid #fde68a';
    }
  }

  setupTicketServiceUpgradeControl(t, canCurrentUserCloseTickets());

  // Hide all action buttons except Close
  ['ticketSendNewBtn','ticketSaveBtn','ticketFinalizeBtn','ticketArchiveBtn',
   'ticketDeleteBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Show only Close Ticket button
  const closeBtn = document.getElementById('ticketCloseBtn');
  if (closeBtn) {
    closeBtn.style.display = 'inline-block';
    closeBtn.style.width = '100%';
    closeBtn.style.padding = '14px';
    closeBtn.style.fontSize = '16px';
    closeBtn.style.fontWeight = '700';
    closeBtn.style.borderRadius = '10px';
    closeBtn.style.background = '#7c3aed';
    closeBtn.style.color = '#fff';
    closeBtn.onclick = () => doCloseTicket(t.id);
  }

  // Edit Services button — lets whoever received the ticket modify the services
  // (add / remove / change price). Only for staff allowed to close tickets.
  let editBtn = document.getElementById('ticketEditServicesBtn');
  if (!editBtn && closeBtn && closeBtn.parentNode) {
    editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.id = 'ticketEditServicesBtn';
    closeBtn.parentNode.insertBefore(editBtn, closeBtn);
  }
  if (editBtn) {
    if (canCurrentUserCloseTickets()) {
      editBtn.style.display = 'inline-block';
      editBtn.style.width = '100%';
      editBtn.style.padding = '12px';
      editBtn.style.fontSize = '15px';
      editBtn.style.fontWeight = '700';
      editBtn.style.borderRadius = '10px';
      editBtn.style.marginBottom = '8px';
      editBtn.style.background = '#fff';
      editBtn.style.color = '#6d28d9';
      editBtn.style.border = '1px solid #c4b5fd';
      editBtn.style.cursor = 'pointer';
      editBtn.textContent = 'Edit Services';
      editBtn.onclick = () => {
        delete modal.dataset.adminView;
        ticketsState.editingTicketId = t.id;
        // Reset the admin-view button styling so the edit form looks normal.
        if (closeBtn) {
          closeBtn.style.width = '';
          closeBtn.style.padding = '';
          closeBtn.style.fontSize = '';
          closeBtn.style.fontWeight = '';
          closeBtn.style.borderRadius = '';
        }
        const titleEl = document.getElementById('ticketModalTitle');
        if (titleEl) titleEl.textContent = 'Edit Ticket';
        populateTicketForm(t);
      };
    } else {
      editBtn.style.display = 'none';
    }
  }

  // Reviewed toggle button (front desk / managers / owners only)
  const reviewedBtn = document.getElementById('ticketReviewedBtn');
  if (reviewedBtn) {
    if (canCurrentUserCloseTickets()) {
      const isReviewed = t.reviewedByFrontDesk === true;
      reviewedBtn.style.display = 'inline-block';
      reviewedBtn.style.width = '100%';
      reviewedBtn.style.padding = '12px';
      reviewedBtn.style.fontSize = '15px';
      reviewedBtn.style.fontWeight = '700';
      reviewedBtn.style.borderRadius = '10px';
      reviewedBtn.style.marginBottom = '8px';
      if (isReviewed) {
        const whenStr = ffFormatReviewedAt(t.reviewedAt);
        reviewedBtn.textContent = 'Reviewed \u2713' + (t.reviewedByName ? ' \u00b7 ' + t.reviewedByName : '') + (whenStr ? ' \u00b7 ' + whenStr : '');
        reviewedBtn.style.background = '#dbeafe';
        reviewedBtn.style.color = '#1e40af';
        reviewedBtn.style.border = '1px solid #93c5fd';
      } else {
        reviewedBtn.textContent = 'Mark as Reviewed';
        reviewedBtn.style.background = '#2563eb';
        reviewedBtn.style.color = '#fff';
        reviewedBtn.style.border = 'none';
      }
      reviewedBtn.onclick = () => toggleTicketReviewed(t.id);
    } else {
      reviewedBtn.style.display = 'none';
    }
  }

  // Hide as-booked block
  const asBookedBlock = document.getElementById('ticketAsBookedBlock');
  if (asBookedBlock) asBookedBlock.style.display = 'none';
  const asBookedNone = document.getElementById('ticketAsBookedNone');
  if (asBookedNone) asBookedNone.style.display = 'none';

  modal.style.display = 'flex';
  // Mark as admin view so closeTicketModal knows to reset
  modal.dataset.adminView = '1';
}

function closeTicketModal() {
  const modal = document.getElementById('ticketModal');
  if (modal) {
    modal.style.display = 'none';
    // If we were in admin view, reset form so next open works correctly
    if (modal.dataset.adminView === '1') {
      delete modal.dataset.adminView;
      resetTicketForm();
      // Restore customer toggle visibility
      const custToggle = document.getElementById('ticketCustomerToggle');
      if (custToggle) custToggle.style.display = '';
      // Restore customer input
      const custInput = document.getElementById('ticketCustomerName');
      if (custInput) custInput.readOnly = false;
      // Restore close button style
      const closeBtn = document.getElementById('ticketCloseBtn');
      if (closeBtn) {
        closeBtn.style.width = '';
        closeBtn.style.padding = '';
        closeBtn.style.fontSize = '';
        closeBtn.style.fontWeight = '';
        closeBtn.style.borderRadius = '';
      }
      // Hide reviewed button
      const reviewedBtn = document.getElementById('ticketReviewedBtn');
      if (reviewedBtn) {
        reviewedBtn.style.display = 'none';
        reviewedBtn.style.marginBottom = '';
      }
    }
  }
  ticketsState.editingTicketId = null;
  requestAnimationFrame(() => updateTicketsNavBadge());
}

function openTicketDetailsModal(t) {
  if (!t || !canSeeTicket(t)) {
    if (t) showToast('You cannot view this ticket.', 'error');
    return;
  }
  const modal = document.getElementById('ticketDetailsModal');
  const contentEl = document.getElementById('ticketDetailsContent');
  const actionsEl = document.getElementById('ticketDetailsActions');
  const titleEl = document.getElementById('ticketDetailsTitle');
  if (!modal || !contentEl || !actionsEl) {
    console.warn('[Tickets] ticketDetailsModal elements missing');
    return;
  }
  const lines = t.performedLines || [];
  const diff = computeDiff(t.appointmentData, lines);
  const hasDiff = (diff.removed?.length || 0) + (diff.added?.length || 0) + (diff.changed?.length || 0) > 0;
  const createdDate = t.createdAt?.toDate ? t.createdAt.toDate() : (t.createdAt ? new Date(t.createdAt) : new Date());
  const statusLabel = (t.status || '').replace(/_/g, ' ');
  const performedHtml = lines.map((l) => {
    const tickPrice = Number(l.ticketPrice) || 0;
    const basePrice = Number(l.catalogPrice) || 0;
    const hasOverride = basePrice > 0 && basePrice !== tickPrice;
    const priceText = hasOverride ? `base ${ffTicketMoney(basePrice)} → ${ffTicketMoney(tickPrice)}` : ffTicketMoney(tickPrice);
    const notePart = l.note ? ` <span style="color:#6b7280;font-size:12px;">— ${escapeHtml(l.note)}</span>` : '';
    return `<div style="padding:10px;background:#f9fafb;border-radius:8px;margin-bottom:8px;font-size:14px;">${escapeHtml(l.serviceName)} — ${priceText}${notePart}</div>`;
  }).join('');
  const sumFromLines = lines.reduce((s, l) => s + (Number(l.ticketPrice) || 0), 0);
  const storedTotal = Number(t.total);
  const ticketTotalAmount =
    lines.length > 0 ? sumFromLines : Number.isFinite(storedTotal) ? storedTotal : sumFromLines;
  const showTicketTotal = lines.length > 0 || Number.isFinite(storedTotal);
  const totalHtml = showTicketTotal
    ? `<div style="margin-top:12px;padding:12px 14px;background:#f3f4f6;border-radius:8px;display:flex;justify-content:space-between;align-items:center;font-size:15px;font-weight:600;color:#111827;border:1px solid #e5e7eb;">
        <span>Total</span>
        <span>${ffTicketMoney(ticketTotalAmount)}</span>
      </div>`
    : '';
  let diffHtml = '';
  if (hasDiff) {
    const parts = [];
    (diff.removed || []).forEach(r => parts.push(`<div style="color:#dc2626;font-size:13px;">Removed: ${escapeHtml(r.name)}</div>`));
    (diff.added || []).forEach(a => parts.push(`<div style="color:#059669;font-size:13px;">Added: ${escapeHtml(a.name)} (${ffTicketMoney(a.price || 0)})</div>`));
    (diff.changed || []).forEach(c => parts.push(`<div style="color:#d97706;font-size:13px;">Changed: ${escapeHtml(c.name)} → ${ffTicketMoney(c.to || 0)}</div>`));
    diffHtml = `<div style="margin-top:16px;"><h3 style="font-size:14px;font-weight:600;margin-bottom:8px;color:#374151;">Changes vs booked</h3><div style="background:#f9fafb;border-radius:8px;padding:12px;">${parts.join('')}</div></div>`;
  }
  const asIsHtml = (t.asIs && t.asIsMessage) ? `<div style="margin-top:16px;font-size:13px;color:#059669;background:#d1fae5;padding:10px 12px;border-radius:8px;"><strong>AS IS:</strong> ${escapeHtml(t.asIsMessage)}</div>` : '';
  const serviceUpgradeHtml = t.serviceUpgrade === true
    ? `<div style="margin-top:16px;font-size:13px;color:#5b21b6;background:#f3e8ff;border:1px solid #e9d5ff;padding:10px 12px;border-radius:8px;font-weight:700;">Service Upgrade marked</div>`
    : '';
  contentEl.innerHTML = `
    <div style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:16px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px;">
        <div><div style="color:#6b7280;margin-bottom:4px;">Submitted time</div><div style="font-weight:500;">${formatTicketDisplayDateTime(createdDate)}</div></div>
        <div><div style="color:#6b7280;margin-bottom:4px;">Submitted by</div><div style="font-weight:500;">${escapeHtml(t.technicianName || '—')}</div></div>
        <div><div style="color:#6b7280;margin-bottom:4px;">Status</div><div style="font-weight:500;">${escapeHtml(statusLabel)}</div></div>
        <div><div style="color:#6b7280;margin-bottom:4px;">Customer</div><div style="font-weight:500;">${escapeHtml(t.customerName || '—')}</div></div>
      </div>
    </div>
    <div style="margin-bottom:16px;"><h3 style="font-size:14px;font-weight:600;margin-bottom:8px;color:#374151;">Performed services</h3>${performedHtml || '<div style="color:#9ca3af;font-size:13px;">None</div>'}${totalHtml}</div>
    ${ffRenderFrontDeskChangesHtml(t)}
    ${diffHtml}
    ${asIsHtml}
    ${serviceUpgradeHtml}
  `;
  const isAdminOrOwner = ticketsState.currentUserProfile && ['owner', 'admin'].includes((ticketsState.currentUserProfile.role || '').toLowerCase());
  const canReopenTicket = typeof canCurrentUserCloseTickets === 'function' && canCurrentUserCloseTickets();
  let actionsHtml = '';
  if (t.status === 'CLOSED' && canReopenTicket) {
    actionsHtml += `<button type="button" id="ticketDetailsReopenBtn" style="padding:8px 16px;border:1px solid #c4b5fd;border-radius:6px;background:#f5f3ff;color:#6d28d9;cursor:pointer;font-size:14px;font-weight:600;">Reopen Ticket</button>`;
  }
  if ((t.status === 'CLOSED' || t.status === 'VOID') && isAdminOrOwner) {
    actionsHtml += `<button type="button" id="ticketDetailsArchiveBtn" style="padding:8px 16px;border:1px solid #9ca3af;border-radius:6px;background:#fff;cursor:pointer;font-size:14px;">Archive</button>`;
  }
  if (t.status === 'ARCHIVED' && isAdminOrOwner) {
    actionsHtml += `<button type="button" id="ticketDetailsDeleteBtn" style="padding:8px 16px;border:1px solid #ef4444;border-radius:6px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:14px;">Delete</button>`;
  }
  actionsHtml += `<button type="button" id="ticketDetailsCloseBtn" style="padding:8px 16px;border:none;border-radius:6px;background:#7c3aed;color:#fff;cursor:pointer;font-size:14px;font-weight:600;">Close</button>`;
  actionsEl.innerHTML = actionsHtml;
  const reopenBtn = document.getElementById('ticketDetailsReopenBtn');
  const archiveBtn = document.getElementById('ticketDetailsArchiveBtn');
  const deleteBtn = document.getElementById('ticketDetailsDeleteBtn');
  const closeBtn = document.getElementById('ticketDetailsCloseBtn');
  if (reopenBtn) reopenBtn.onclick = async () => {
    const ok = await ticketConfirm('Reopen this ticket? It will return to Ready for checkout (no longer marked as Paid).', 'Reopen ticket');
    if (!ok) return;
    try { await reopenTicket(t.id); showToast('Ticket reopened', 'success'); closeTicketDetailsModal(); }
    catch (e) { showToast(e?.message || 'Failed', 'error'); }
  };
  if (archiveBtn) archiveBtn.onclick = async () => { try { await archiveTicket(t.id); showToast('Ticket archived', 'success'); closeTicketDetailsModal(); } catch (e) { showToast(e?.message || 'Failed', 'error'); } };
  if (deleteBtn) deleteBtn.onclick = async () => { const ok = await ticketConfirm('Permanently delete this ticket? This cannot be undone.', 'Delete ticket'); if (!ok) return; try { await deleteTicketPermanently(t.id); showToast('Ticket deleted', 'success'); closeTicketDetailsModal(); } catch (e) { showToast(e?.message || 'Failed', 'error'); } };
  if (closeBtn) closeBtn.onclick = () => closeTicketDetailsModal();
  if (titleEl) titleEl.textContent = 'Ticket Details';
  modal.style.display = 'flex';
  modal.onclick = (e) => { if (e.target === modal) closeTicketDetailsModal(); };
}

function closeTicketDetailsModal() {
  const modal = document.getElementById('ticketDetailsModal');
  if (modal) {
    modal.style.display = 'none';
    modal.onclick = null;
  }
}

/** Salon setting: when true, staff must enter a customer name before sending. */
function ffTicketRequiresCustomerName() {
  try {
    if (typeof window !== 'undefined' && typeof window.ffGetRequireCustomerNameOnTicket === 'function') {
      return window.ffGetRequireCustomerNameOnTicket() === true;
    }
    return !!(window.settings && window.settings.preferences && window.settings.preferences.requireCustomerNameOnTicket === true);
  } catch (_) { return false; }
}

/**
 * When the salon requires a customer name, reveal the customer field, lock the
 * Optional toggle (so it can't be collapsed) and mark it required. Returns
 * whether the requirement is active.
 */
function ffApplyTicketCustomerRequiredUI() {
  const required = ffTicketRequiresCustomerName();
  const wrap = document.getElementById('ticketCustomerWrap');
  const toggle = document.getElementById('ticketCustomerToggle');
  const input = document.getElementById('ticketCustomerName');
  if (required) {
    if (wrap) wrap.style.display = 'block';
    if (toggle) {
      toggle.textContent = 'Customer / Client (required)';
      toggle.style.pointerEvents = 'none';
      toggle.style.cursor = 'default';
      toggle.style.color = '#374151';
    }
    if (input) input.placeholder = 'Customer / Client name (required)';
  } else {
    if (toggle) {
      toggle.style.pointerEvents = '';
      toggle.style.cursor = '';
      toggle.style.color = '';
    }
    if (input) input.placeholder = 'Customer / Client name';
  }
  return required;
}

function resetTicketForm() {
  // New-ticket flow (technicians) keeps the staff-filtered catalog.
  ticketsState._ticketPickerShowAllCatalog = false;
  // Rebuild the picker so it reflects the (filtered) catalog for this flow.
  try { if (typeof setupTicketsUI === 'function') setupTicketsUI(); } catch (_) {}
  const set = (id, fn) => { const el = document.getElementById(id); if (el) fn(el); };
  set('ticketCustomerName', el => { el.value = ''; });
  set('ticketCustomerWrap', el => { el.style.display = 'none'; });
  set('ticketCustomerToggle', el => { el.textContent = '+ Optional: Customer / Client'; });
  set('ticketPerformedList', el => { el.innerHTML = ''; });
  set('ticketLinesData', el => { el.value = '[]'; });
  set('ticketAsBookedBlock', el => { el.style.display = 'none'; });
  set('ticketAsBookedNone', el => { el.style.display = 'block'; });
  set('ticketCustomerPriceApproved', el => { el.checked = false; });
  set('ticketAdminPriceApprovalBlock', el => { el.style.display = 'none'; el.innerHTML = ''; });
  const finalizeBtn = document.getElementById('ticketFinalizeBtn');
  const closeBtn = document.getElementById('ticketCloseBtn');
  const sendNewBtn = document.getElementById('ticketSendNewBtn');
  const saveBtn = document.getElementById('ticketSaveBtn');
  const archiveBtn = document.getElementById('ticketArchiveBtn');
  const deleteBtn = document.getElementById('ticketDeleteBtn');
  if (finalizeBtn) finalizeBtn.style.display = 'none';
  if (closeBtn) closeBtn.style.display = 'none';
  if (archiveBtn) archiveBtn.style.display = 'none';
  if (deleteBtn) deleteBtn.style.display = 'none';
  if (saveBtn) saveBtn.style.display = 'none';
  if (sendNewBtn) {
    sendNewBtn.style.display = 'inline-block';
    sendNewBtn.onclick = () => doSendNewTicket();
  }
  const upgradeWrap = document.getElementById('ticketServiceUpgradeWrap');
  const upgradeBtn = document.getElementById('ticketServiceUpgradeBtn');
  if (upgradeWrap) upgradeWrap.style.display = 'none';
  if (upgradeBtn) upgradeBtn.onclick = null;
  paintTicketServiceUpgradeButton(false);
  // Collapse all service category sections when opening a new ticket
  const picker = document.getElementById('ticketServicePickerContainer');
  if (picker) {
    picker.querySelectorAll('.ticket-category-body').forEach((body) => { body.style.display = 'none'; });
    picker.querySelectorAll('.ticket-cat-arrow').forEach((arrow) => { arrow.textContent = '▶'; });
  }
  // Search field always mirrors the picker: cleared on every open, visible
  // exactly when the picker is visible.
  ffTicketServiceSearchClear();
  ffTicketServiceSearchSetVisible(!(picker && picker.style.display === 'none'));
  updateTicketDiff();
  setupTicketFormToggles();
  ffApplyTicketCustomerRequiredUI();
}

function populateTicketForm(t) {
  if (!canSeeTicket(t)) {
    showToast('You cannot view this ticket.', 'error');
    return;
  }
  const s = (t.status || '').toUpperCase();
  if (s === 'CLOSED' || s === 'VOID' || s === 'ARCHIVED') {
    closeTicketModal();
    openTicketDetailsModal(t);
    return;
  }
  const sendNewBtnEarly = document.getElementById('ticketSendNewBtn');
  if (sendNewBtnEarly) sendNewBtnEarly.style.display = 'none';
  const priceWrapEarly = document.getElementById('ticketCustomerPriceApprovedWrap');
  if (priceWrapEarly) priceWrapEarly.style.display = 'none';
  const adminAprEarly = document.getElementById('ticketAdminPriceApprovalBlock');
  if (adminAprEarly) {
    adminAprEarly.style.display = 'none';
    adminAprEarly.innerHTML = '';
  }
  const set = (id, fn) => { const el = document.getElementById(id); if (el) fn(el); };
  set('ticketCustomerName', el => { el.value = t.customerName || ''; });
  const hasCustomer = !!(t.customerName || '').trim();
  set('ticketCustomerWrap', el => { el.style.display = hasCustomer ? 'block' : 'none'; });
  set('ticketCustomerToggle', el => { el.textContent = hasCustomer ? '− Hide Customer' : '+ Optional: Customer / Client'; });
  const booked = t.appointmentData?.services || [];
  const hasAppointment = !!(t.appointmentId || t.appointmentData) && booked.length > 0;
  set('ticketAsBookedBlock', el => { el.style.display = hasAppointment ? 'block' : 'none'; });
  set('ticketAsBookedNone', el => { el.style.display = hasAppointment ? 'none' : 'block'; });
  set('ticketAsBookedContent', el => {
    el.innerHTML = booked.map(s => `<div style="font-size:13px;">${escapeHtml(s.name || s.serviceName)} — ${ffTicketMoney(s.price || 0)}</div>`).join('');
    el.style.display = 'none';
  });
  set('ticketAsBookedToggle', el => { el.textContent = 'Show As Booked'; });
  const lines = t.performedLines || [];
  set('ticketLinesData', el => { el.value = JSON.stringify(lines); });
  const isReadOnly = ['CLOSED', 'VOID', 'ARCHIVED'].includes((t.status || '').toUpperCase());
  // Managers / front-desk receivers editing a ticket see the FULL service + product
  // catalog (not just their own assigned services). Technicians keep the filtered view.
  ticketsState._ticketPickerShowAllCatalog = (typeof canCurrentUserCloseTickets === 'function')
    ? !!canCurrentUserCloseTickets()
    : false;
  renderPerformedLines(lines, isReadOnly);
  const servicePickerContainer = document.getElementById('ticketServicePickerContainer');
  const customerToggle = document.getElementById('ticketCustomerToggle');
  const customerInput = document.getElementById('ticketCustomerName');
  if (servicePickerContainer) servicePickerContainer.style.display = isReadOnly ? 'none' : 'block';
  ffTicketServiceSearchSetVisible(!isReadOnly);
  if (!isReadOnly) ffTicketServiceSearchClear();
  // When a manager / front-desk user opens a ticket for editing they may not
  // have visited the "new ticket" flow yet, so the service catalog (salonServices)
  // can be empty even though products are streaming in. Ensure the catalog is
  // loaded and re-render the picker so they see all services + products.
  if (!isReadOnly) {
    (async () => {
      try {
        if (!Array.isArray(ticketsState.salonServices) || ticketsState.salonServices.length === 0) {
          try { await loadServiceCategories(); } catch (_) {}
          try { await loadServices(); } catch (_) {}
        }
        if (typeof setupTicketsUI === 'function') await setupTicketsUI();
      } catch (err) {
        console.warn('[Tickets] ensure catalog for edit failed', err);
      }
    })();
  }
  if (customerToggle) customerToggle.style.display = isReadOnly ? 'none' : '';
  if (customerInput) customerInput.readOnly = isReadOnly;
  updateTicketTotal(lines);
  const isCreator = ticketsState.currentUserProfile && (
    t.createdByUid === ticketsState.currentUserProfile.uid ||
    t.technicianStaffId === ticketsState.currentUserProfile.staffId ||
    t.technicianStaffId === ticketsState.currentUserProfile.uid ||
    t.finalizedByUid === ticketsState.currentUserProfile.uid ||
    (t.technicianName && (
      (ticketsState.currentUserProfile.email && String(t.technicianName).toLowerCase().includes(String(ticketsState.currentUserProfile.email).toLowerCase())) ||
      (ticketsState.currentUserProfile.name && String(t.technicianName).toLowerCase().includes(String(ticketsState.currentUserProfile.name).toLowerCase()))
    ))
  );
  const canViewTicket = canSeeTicket(t);
  const canSaveEdits = (isCreator || canViewTicket) && (t.status === 'OPEN' || t.status === 'READY_FOR_CHECKOUT');
  const isAdminOrOwner = ticketsState.currentUserProfile && ['owner', 'admin'].includes((ticketsState.currentUserProfile.role || '').toLowerCase());
  // Only manager/admin/owner can close ticket; technicians must not see Close button.
  const canCloseTicket = canCurrentUserCloseTickets();
  const finalizeBtn = document.getElementById('ticketFinalizeBtn');
  const closeBtn = document.getElementById('ticketCloseBtn');
  const archiveBtn = document.getElementById('ticketArchiveBtn');
  const deleteBtn = document.getElementById('ticketDeleteBtn');
  const sendNewBtn = document.getElementById('ticketSendNewBtn');
  const saveBtn = document.getElementById('ticketSaveBtn');
  const reviewedBtnEdit = document.getElementById('ticketReviewedBtn');
  if (reviewedBtnEdit) reviewedBtnEdit.style.display = 'none';
  const editServicesBtnEdit = document.getElementById('ticketEditServicesBtn');
  if (editServicesBtnEdit) editServicesBtnEdit.style.display = 'none';
  if (finalizeBtn) finalizeBtn.style.display = (t.status === 'OPEN') ? 'inline-block' : 'none';
  if (closeBtn) closeBtn.style.display = (t.status === 'READY_FOR_CHECKOUT' && canCloseTicket) ? 'inline-block' : 'none';
  if (archiveBtn) archiveBtn.style.display = (t.status === 'CLOSED' || t.status === 'VOID') && isAdminOrOwner ? 'inline-block' : 'none';
  if (deleteBtn) deleteBtn.style.display = t.status === 'ARCHIVED' && isAdminOrOwner ? 'inline-block' : 'none';
  if (sendNewBtn) sendNewBtn.style.display = 'none';
  if (saveBtn) {
    saveBtn.style.display = canSaveEdits ? 'inline-block' : 'none';
    saveBtn.textContent = t.status === 'READY_FOR_CHECKOUT' ? 'Save changes' : 'Save';
  }
  if (finalizeBtn) finalizeBtn.onclick = () => doFinalizeTicket(t.id);
  if (closeBtn) closeBtn.onclick = () => doCloseTicket(t.id);
  if (archiveBtn) archiveBtn.onclick = async () => { try { await archiveTicket(t.id); showToast('Ticket archived', 'success'); closeTicketModal(); } catch (e) { showToast(e?.message || 'Failed', 'error'); } };
  if (deleteBtn) deleteBtn.onclick = async () => { const ok = await ticketConfirm('Permanently delete this ticket? This cannot be undone.', 'Delete ticket'); if (!ok) return; try { await deleteTicketPermanently(t.id); showToast('Ticket deleted', 'success'); closeTicketModal(); } catch (e) { showToast(e?.message || 'Failed', 'error'); } };
  setupTicketServiceUpgradeControl(t, canCloseTicket);
  setupTicketFormToggles();
  if (!isReadOnly) ffApplyTicketCustomerRequiredUI();
}

/** Push current price/note inputs into #ticketLinesData so Close/Save sees latest edits (e.g. before blur). */
function syncTicketFormLinesFromDom() {
  const linesEl = document.getElementById('ticketLinesData');
  if (!linesEl) return;
  let lines;
  try {
    lines = JSON.parse(linesEl.value || '[]');
  } catch (_) {
    return;
  }
  if (!Array.isArray(lines) || lines.length === 0) return;
  const cont = document.getElementById('ticketPerformedList');
  if (!cont) return;
  const priceInputs = cont.querySelectorAll('.ticket-price-input');
  const noteInputs = cont.querySelectorAll('.ticket-note-input');
  if (priceInputs.length === 0 && noteInputs.length === 0) return;
  priceInputs.forEach((inp) => {
    const idx = parseInt(inp.getAttribute('data-idx'), 10);
    if (!Number.isFinite(idx) || !lines[idx]) return;
    const num = parseFloat(inp.value) || 0;
    lines[idx].ticketPrice = num;
    lines[idx].isOverride = num !== (Number(lines[idx].catalogPrice) || 0);
  });
  noteInputs.forEach((inp) => {
    const idx = parseInt(inp.getAttribute('data-idx'), 10);
    if (!Number.isFinite(idx) || !lines[idx]) return;
    lines[idx].note = (inp.value || '').trim() || null;
  });
  linesEl.value = JSON.stringify(lines);
}

function renderPerformedLines(lines, readOnly = false) {
  const cont = document.getElementById('ticketPerformedList');
  if (!cont) return;
  if (readOnly) {
    cont.innerHTML = lines.map((l) => {
      const tickPrice = Number(l.ticketPrice) || 0;
      const basePrice = Number(l.catalogPrice) || 0;
      const hasOverride = basePrice > 0 && basePrice !== tickPrice;
      const priceText = hasOverride ? `base ${ffTicketMoney(basePrice)} → ${ffTicketMoney(tickPrice)}` : ffTicketMoney(tickPrice);
      const notePart = l.note ? ` <span style="color:#6b7280;font-size:11px;">— ${escapeHtml(l.note)}</span>` : '';
      const prodTag = l.lineType === 'product' ? ' <span style="font-size:9px;color:#7c3aed;background:#ede9fe;padding:1px 5px;border-radius:4px;vertical-align:middle;">Product</span>' : '';
      return `<div style="padding:6px 10px;background:#f9fafb;border-radius:6px;margin-bottom:4px;font-size:12px;">${escapeHtml(l.serviceName)}${prodTag} — ${priceText}${notePart}</div>`;
    }).join('');
    return;
  }
  const total = lines.reduce((sum, l) => sum + (Number(l.ticketPrice) || 0), 0);
  cont.innerHTML = lines.map((l, i) => {
    const catPrice = Number(l.catalogPrice) || 0;
    const tickPrice = Number(l.ticketPrice) || 0;
    const isOverride = tickPrice !== catPrice;
    return `
    <div class="ticket-line" data-idx="${i}" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 8px;background:#f9fafb;border-radius:6px;margin-bottom:4px;">
      <span style="flex:1;min-width:100px;font-size:12px;font-weight:500;">${escapeHtml(l.serviceName)}${l.lineType === 'product' ? ' <span style="font-size:9px;color:#7c3aed;background:#ede9fe;padding:1px 5px;border-radius:4px;vertical-align:middle;">Product</span>' : ''}</span>
      <span style="font-size:10px;color:#9ca3af;">base ${ffTicketMoney(catPrice)}</span>
      <label style="display:flex;align-items:center;gap:4px;font-size:12px;">
        <span style="color:#6b7280;">${ffTicketCurSym()}</span>
        <input type="number" min="0" step="0.01" value="${tickPrice.toFixed(2)}" class="ticket-price-input" data-idx="${i}" style="width:60px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px;">
        ${isOverride ? '<span style="font-size:10px;color:#d97706;background:#fef3c7;padding:2px 6px;border-radius:4px;">Adjusted</span>' : ''}
      </label>
      <input type="text" placeholder="Note (optional)" class="ticket-note-input" data-idx="${i}" value="${escapeHtml(l.note || '')}" style="width:80px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:11px;">
      <button type="button" class="ticket-remove-line" data-idx="${i}" style="padding:3px 6px;border:1px solid #e5e7eb;border-radius:4px;background:#fff;cursor:pointer;font-size:11px;">Remove</button>
    </div>
  `;
  }).join('');

  cont.querySelectorAll('.ticket-remove-line').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      const lines = JSON.parse(document.getElementById('ticketLinesData').value || '[]');
      lines.splice(idx, 1);
      document.getElementById('ticketLinesData').value = JSON.stringify(lines);
      renderPerformedLines(lines);
      updateTicketDiff();
    };
  });

  cont.querySelectorAll('.ticket-price-input').forEach(inp => {
    inp.onchange = inp.onblur = () => {
      const idx = parseInt(inp.getAttribute('data-idx'), 10);
      const lines = JSON.parse(document.getElementById('ticketLinesData').value || '[]');
      const line = lines[idx];
      if (!line) return;
      const num = parseFloat(inp.value) || 0;
      line.ticketPrice = num;
      line.isOverride = num !== (Number(line.catalogPrice) || 0);
      document.getElementById('ticketLinesData').value = JSON.stringify(lines);
      renderPerformedLines(lines);
      updateTicketDiff();
    };
  });

  cont.querySelectorAll('.ticket-note-input').forEach(inp => {
    inp.onchange = inp.onblur = () => {
      const idx = parseInt(inp.getAttribute('data-idx'), 10);
      const lines = JSON.parse(document.getElementById('ticketLinesData').value || '[]');
      const line = lines[idx];
      if (!line) return;
      line.note = (inp.value || '').trim() || null;
      document.getElementById('ticketLinesData').value = JSON.stringify(lines);
    };
  });

  updateTicketTotal(lines);
}

function renderDiff(diff, total, hasLines) {
  const cont = document.getElementById('ticketDiff');
  if (!cont) return;
  const parts = [];
  (diff.removed || []).forEach(r => parts.push(`<div style="color:#dc2626;font-size:13px;">Removed: ${escapeHtml(r.name)}</div>`));
  (diff.added || []).forEach(a => parts.push(`<div style="color:#059669;font-size:13px;">Added: ${escapeHtml(a.name)} (${ffTicketMoney(a.price || 0)})</div>`));
  (diff.changed || []).forEach(c => parts.push(`<div style="color:#d97706;font-size:13px;">Changed: ${escapeHtml(c.name)} → ${ffTicketMoney(c.to || 0)}</div>`));
  if (hasLines && typeof total === 'number') {
    parts.push(`<div style="margin-top:10px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:15px;font-weight:700;color:#166534;">Total: ${ffTicketMoney(total)}</div>`);
  }
  cont.innerHTML = parts.length ? parts.join('') : '<div style="color:#9ca3af;font-size:13px;">No changes</div>';
}

function addServiceToTicket(service) {
  const lines = JSON.parse(document.getElementById('ticketLinesData').value || '[]');
  const price = getTicketPriceForServiceAndCurrentStaff(service);
  const catalogPrice = Number(service.defaultPrice) || price;
  lines.push({
    serviceId: service.id,
    serviceName: service.name,
    catalogPrice,
    ticketPrice: price,
    isOverride: price !== catalogPrice,
    taxable: service.taxable === true,
    note: null
  });
  document.getElementById('ticketLinesData').value = JSON.stringify(lines);
  renderPerformedLines(lines);
  updateTicketDiff();
  updateTicketTotal(lines);
}

function addProductToTicket(product) {
  const lines = JSON.parse(document.getElementById('ticketLinesData').value || '[]');
  const price = getTicketPriceForProductAndActiveLocation(product);
  const catalogPrice = Number(product.retailPrice) || price;
  lines.push({
    lineType: 'product',
    productId: product.id,
    serviceName: product.name,
    catalogPrice,
    ticketPrice: price,
    isOverride: price !== catalogPrice,
    taxable: product.taxable === true,
    note: null
  });
  document.getElementById('ticketLinesData').value = JSON.stringify(lines);
  renderPerformedLines(lines);
  updateTicketDiff();
  updateTicketTotal(lines);
}

function setupTicketFormToggles() {
  const custToggle = document.getElementById('ticketCustomerToggle');
  const custWrap = document.getElementById('ticketCustomerWrap');
  if (custToggle && custWrap) {
    custToggle.onclick = () => {
      const show = custWrap.style.display !== 'block';
      custWrap.style.display = show ? 'block' : 'none';
      custToggle.textContent = show ? '− Hide Customer' : '+ Optional: Customer / Client';
    };
  }
  const asBookedToggle = document.getElementById('ticketAsBookedToggle');
  const asBookedContent = document.getElementById('ticketAsBookedContent');
  if (asBookedToggle && asBookedContent) {
    asBookedToggle.onclick = () => {
      const show = asBookedContent.style.display !== 'block';
      asBookedContent.style.display = show ? 'block' : 'none';
      asBookedToggle.textContent = show ? 'Hide As Booked' : 'Show As Booked';
    };
  }
}

function updateTicketDiff() {
  const lines = JSON.parse(document.getElementById('ticketLinesData').value || '[]');
  updateTicketTotal(lines);
}

function updateTicketTotal(lines) {
  const el = Array.isArray(lines) ? null : document.getElementById('ticketLinesData');
  const arr = Array.isArray(lines) ? lines : (el ? JSON.parse(el.value || '[]') : []);
  const { subtotal, salesTax, total, taxRate } = computeTicketTotalsFromLines(arr);
  const block = document.getElementById('ticketTotalBlock');
  const amountEl = document.getElementById('ticketTotalAmount');
  const subRow = document.getElementById('ticketSubtotalRow');
  const subEl = document.getElementById('ticketSubtotalAmount');
  const taxRow = document.getElementById('ticketSalesTaxRow');
  const taxEl = document.getElementById('ticketSalesTaxAmount');
  if (block) block.style.display = arr.length > 0 ? 'block' : 'none';
  const showTax = salesTax > 0;
  if (subRow) subRow.style.display = showTax ? 'block' : 'none';
  if (taxRow) taxRow.style.display = showTax ? 'block' : 'none';
  if (subEl) subEl.textContent = ffTicketMoney(subtotal);
  if (taxEl) {
    const pctLabel = taxRate > 0 ? ` (${taxRate}%)` : '';
    taxEl.textContent = ffTicketMoney(salesTax) + pctLabel;
  }
  if (amountEl) amountEl.textContent = ffTicketMoney(total);
  const sendNewBtn = document.getElementById('ticketSendNewBtn');
  const priceWrap = document.getElementById('ticketCustomerPriceApprovedWrap');
  if (priceWrap && sendNewBtn) {
    const isNewTicketFlow = sendNewBtn.style.display !== 'none';
    const showApproval = isNewTicketFlow && arr.length > 0;
    priceWrap.style.display = showApproval ? 'block' : 'none';
    if (!showApproval) {
      const cb = document.getElementById('ticketCustomerPriceApproved');
      if (cb) cb.checked = false;
    }
  }
}

function paintTicketServiceUpgradeButton(enabled) {
  const btn = document.getElementById('ticketServiceUpgradeBtn');
  const val = document.getElementById('ticketServiceUpgradeValue');
  if (val) val.value = enabled ? 'true' : 'false';
  if (!btn) return;
  btn.textContent = enabled ? 'Service Upgrade ✓' : 'Upgrade Service';
  btn.style.background = enabled ? '#f3e8ff' : '#fff';
  btn.style.borderColor = enabled ? '#7c3aed' : '#e9d5ff';
  btn.style.color = enabled ? '#5b21b6' : '#7c3aed';
}

function setupTicketServiceUpgradeControl(ticket, canUse) {
  const wrap = document.getElementById('ticketServiceUpgradeWrap');
  const btn = document.getElementById('ticketServiceUpgradeBtn');
  if (!wrap || !btn) return;
  const show = !!(canUse && ticket && String(ticket.status || '').toUpperCase() === 'READY_FOR_CHECKOUT');
  wrap.style.display = show ? 'block' : 'none';
  paintTicketServiceUpgradeButton(ticket && ticket.serviceUpgrade === true);
  btn.onclick = null;
  if (!show) return;
  btn.onclick = async () => {
    const next = !(document.getElementById('ticketServiceUpgradeValue')?.value === 'true');
    btn.disabled = true;
    try {
      paintTicketServiceUpgradeButton(next);
      await setTicketServiceUpgrade(ticket.id, next);
      ticket.serviceUpgrade = next;
      ticket.editedAfterFinalize = false;
      ticket.editedAt = null;
      renderTicketsList();
      if (next) {
        void awardTicketUpgradePoints(ticket);
      }
      showToast(next ? 'Service upgrade marked' : 'Service upgrade removed', 'success');
    } catch (e) {
      paintTicketServiceUpgradeButton(!next);
      showToast(e?.message || 'Could not update service upgrade', 'error');
    } finally {
      btn.disabled = false;
    }
  };
}

async function saveTicket() {
  const customerNameEl = document.getElementById('ticketCustomerName');
  const customerName = customerNameEl ? customerNameEl.value.trim() : '';
  const { uids: forUids, names: forNames } = await getAutoFrontDeskRecipients();
  const linesEl = document.getElementById('ticketLinesData');
  const lines = linesEl ? JSON.parse(linesEl.value || '[]') : [];
  const totals = computeTicketTotalsFromLines(lines);

  try {
    if (ticketsState.editingTicketId) {
      // If someone who received the ticket (front desk / manager) changes the
      // services, preserve the technician's original lines once and tag the edit
      // so we can show what changed and by whom.
      const fdUpdate = {};
      try {
        const existingT = (ticketsState.currentTickets || []).find(x => x.id === ticketsState.editingTicketId);
        const isCloser = typeof canCurrentUserCloseTickets === 'function' && canCurrentUserCloseTickets();
        if (isCloser && existingT) {
          const beforeLines = Array.isArray(existingT.performedLines) ? existingT.performedLines : [];
          if (ffTicketLinesChanged(beforeLines, lines)) {
            if (!Array.isArray(existingT.frontDeskOriginalLines)) {
              fdUpdate.frontDeskOriginalLines = beforeLines;
            }
            fdUpdate.frontDeskEdited = true;
            fdUpdate.frontDeskEditedByUid = (ticketsState.currentUserProfile && ticketsState.currentUserProfile.uid) || null;
            fdUpdate.frontDeskEditedByName =
              (ticketsState.currentUserProfile && (ticketsState.currentUserProfile.name || ticketsState.currentUserProfile.email)) || null;
            fdUpdate.frontDeskEditedAt = serverTimestamp();
          }
        }
      } catch (_) {}
      await updateTicket(ticketsState.editingTicketId, {
        customerName,
        performedLines: lines,
        subtotal: totals.subtotal,
        salesTax: totals.salesTax,
        productTax: totals.productTax,
        serviceTax: totals.serviceTax,
        total: totals.total,
        forUids,
        forNames,
        ...fdUpdate,
        _action: 'edited_after_send'
      });
      const t = ticketsState.currentTickets.find(x => x.id === ticketsState.editingTicketId);
      if (t && (String(t.status || '').toUpperCase() === 'READY_FOR_CHECKOUT') && !t.seenByFrontDeskAt) {
        ticketsState._ticketsOpenedThisSession.add(ticketsState.editingTicketId);
        t.seenByFrontDeskAt = true;
        updateTicketsNavBadge();
        const { isPrimaryAdmin } = getTicketVisibility();
        if (isPrimaryAdmin) markTicketSeenByFrontDesk(ticketsState.editingTicketId).catch(() => {});
      }
      showToast('Ticket updated', 'success');
    } else {
      await createTicket({
        customerName,
        performedLines: lines,
        subtotal: totals.subtotal,
        salesTax: totals.salesTax,
        productTax: totals.productTax,
        serviceTax: totals.serviceTax,
        total: totals.total,
        forUids,
        forNames
      });
      showToast('Ticket created', 'success');
    }
    closeTicketModal();
  } catch (err) {
    showToast(err?.message || 'Failed to save', 'error');
  }
}

async function doSendNewTicket() {
  const customerNameEl = document.getElementById('ticketCustomerName');
  const customerName = customerNameEl ? customerNameEl.value.trim() : '';
  if (ffTicketRequiresCustomerName() && !customerName) {
    ffApplyTicketCustomerRequiredUI();
    showToast('Customer name is required to send this ticket.', 'error');
    if (customerNameEl) customerNameEl.focus();
    return;
  }
  const { uids: forUids, names: forNames } = await getAutoFrontDeskRecipients();
  const linesEl = document.getElementById('ticketLinesData');
  const lines = linesEl ? JSON.parse(linesEl.value || '[]') : [];
  if (lines.length === 0) {
    showToast('Add at least one service or product to send a ticket.', 'error');
    return;
  }
  const total = computeTicketTotalsFromLines(lines);
  try {
    await createTicket({
      customerName,
      performedLines: lines,
      subtotal: total.subtotal,
      salesTax: total.salesTax,
      productTax: total.productTax,
      serviceTax: total.serviceTax,
      total: total.total,
      forUids,
      forNames,
      status: 'READY_FOR_CHECKOUT',
      customerApprovedPrice: getTicketCustomerPriceApprovedFromForm()
    });
    showToast('Ticket sent to Front Desk', 'success');
    closeTicketModal();
  } catch (err) {
    showToast(err?.message || 'Failed to send', 'error');
  }
}

async function doFinalizeTicket(ticketId) {
  const customerNameEl = document.getElementById('ticketCustomerName');
  const customerName = customerNameEl ? customerNameEl.value.trim() : '';
  if (ffTicketRequiresCustomerName() && !customerName) {
    ffApplyTicketCustomerRequiredUI();
    showToast('Customer name is required to send this ticket.', 'error');
    if (customerNameEl) customerNameEl.focus();
    return;
  }
  const { uids: forUids, names: forNames } = await getAutoFrontDeskRecipients();
  const ok = await ticketConfirm('Send this ticket to Front Desk?', 'Send to Front Desk');
  if (!ok) return;
  try {
    await finalizeTicket(ticketId, forUids, forNames, { customerName });
    showToast('Ticket sent to Front Desk', 'success');
    closeTicketModal();
  } catch (err) {
    showToast(err?.message || 'Failed', 'error');
  }
}

async function doCloseTicket(ticketId) {
  const ok = await ticketConfirm('Mark this ticket as Paid? (Checkout done)', 'Paid ticket');
  if (!ok) return;
  ticketsState._justClosedTicketId = ticketId;
  try {
    syncTicketFormLinesFromDom();
    const customerNameEl = document.getElementById('ticketCustomerName');
    const customerName = customerNameEl ? customerNameEl.value.trim() : '';
    const { uids: forUids, names: forNames } = await getAutoFrontDeskRecipients();
    const linesEl = document.getElementById('ticketLinesData');
    const lines = linesEl ? JSON.parse(linesEl.value || '[]') : [];
    const totals = computeTicketTotalsFromLines(lines);
    // Capture front-desk edits made right before paying (vs technician original).
    const fdUpdate = {};
    try {
      const existingT = (ticketsState.currentTickets || []).find(x => x.id === ticketId);
      if (existingT) {
        const beforeLines = Array.isArray(existingT.performedLines) ? existingT.performedLines : [];
        if (ffTicketLinesChanged(beforeLines, lines)) {
          if (!Array.isArray(existingT.frontDeskOriginalLines)) {
            fdUpdate.frontDeskOriginalLines = beforeLines;
          }
          fdUpdate.frontDeskEdited = true;
          fdUpdate.frontDeskEditedByUid = (ticketsState.currentUserProfile && ticketsState.currentUserProfile.uid) || null;
          fdUpdate.frontDeskEditedByName =
            (ticketsState.currentUserProfile && (ticketsState.currentUserProfile.name || ticketsState.currentUserProfile.email)) || null;
          fdUpdate.frontDeskEditedAt = serverTimestamp();
        }
      }
    } catch (_) {}
    await closeTicket(ticketId, {
      customerName,
      performedLines: lines,
      subtotal: totals.subtotal,
      salesTax: totals.salesTax,
      productTax: totals.productTax,
      serviceTax: totals.serviceTax,
      total: totals.total,
      forUids,
      forNames,
      ...fdUpdate
    });
    showToast('Ticket marked as paid', 'success');
    closeTicketModal();
  } catch (err) {
    showToast(err?.message || 'Failed', 'error');
    ticketsState._justClosedTicketId = null;
  }
  setTimeout(() => { ticketsState._justClosedTicketId = null; }, 1500);
}

// =====================
// UI: Service Catalog Modal
// =====================
// =====================
// Service Catalog V2 — unified collapsible UI (per-location)
// =====================
// One screen. Each category is a header with ▸/▾ toggle; expanding reveals
// its services (name + price) and a "+ Add service" link. A top "+ Add
// Category" button and a small shared "Add/Edit" mini modal do all CRUD.
// Legacy two-tab view + subcategory concept are removed.

/** Which categories are open (in-memory; reset when the modal closes). */
/** True after the first render of the modal in the current opening. Used to
 *  auto-expand the first category so the user sees services immediately. */

function _ffCatalogRenderRoot() {
  return document.getElementById(ticketsState._ffCatalogRenderRootId || 'servicesModal') || document;
}

function _ffCatalogEl(id) {
  const root = _ffCatalogRenderRoot();
  return (root && root.querySelector ? root.querySelector('#' + id) : null) || document.getElementById(id);
}

function _ffEnsureCatalogEditorPortal() {
  const editor = document.getElementById('servicesCatalogEditorModal');
  if (editor && editor.parentElement && editor.parentElement.id === 'servicesModalInner') {
    document.body.appendChild(editor);
  }
}

function _ffIsServicesScreenRoot() {
  return ticketsState._ffCatalogRenderRootId === 'servicesScreen';
}

// ===== Services screen mobile drill-down (list -> service menu -> section) =====
// Mirrors the proven Staff Members modal pattern. On phones (<=640px) the
// two-pane desktop layout is shown one level at a time, driven by classes on
// the #servicesScreen root. No effect on desktop.
function _ffServicesScreenIsMobile() {
  try {
    return !!(window.matchMedia && window.matchMedia('(max-width: 640px)').matches);
  } catch (_) {
    return false;
  }
}

function _ffServicesMobileShowList() {
  const el = document.getElementById('servicesScreen');
  if (!el) return;
  el.classList.remove('ff-services-mobile-detail');
  el.classList.remove('ff-services-mobile-tab');
}

// mode: 'detail' (service selected -> show the Details/Locations/Staff menu)
//       'tab'    (a section was chosen -> show that section's content)
function _ffServicesMobileShowDetail(mode) {
  if (!_ffServicesScreenIsMobile()) return;
  const el = document.getElementById('servicesScreen');
  if (!el) return;
  el.classList.remove('ff-services-mobile-detail');
  el.classList.remove('ff-services-mobile-tab');
  el.classList.add(mode === 'tab' ? 'ff-services-mobile-tab' : 'ff-services-mobile-detail');
  try {
    const content = el.querySelector('.staff-content-area');
    if (content) content.scrollTop = 0;
  } catch (_) {}
}

// Back button: section -> menu, menu -> list. Delegated once.
if (typeof document !== 'undefined' && !document.__ffServicesMobileBackDelegated) {
  document.__ffServicesMobileBackDelegated = true;
  document.addEventListener('click', function (event) {
    const target = event.target && event.target.closest
      ? event.target.closest('#servicesScreen .ff-services-mobile-back')
      : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const el = document.getElementById('servicesScreen');
    if (el && el.classList.contains('ff-services-mobile-tab')) {
      el.classList.remove('ff-services-mobile-tab');
      el.classList.add('ff-services-mobile-detail');
      try {
        const content = el.querySelector('.staff-content-area');
        if (content) content.scrollTop = 0;
      } catch (_) {}
      return;
    }
    _ffServicesMobileShowList();
  }, true);
}

async function openServicesModal(opts = {}) {
  const modal = document.getElementById('servicesModal');
  if (!modal) return;
  _ffEnsureCatalogEditorPortal();
  ticketsState._ffCatalogRenderRootId = 'servicesModal';
  ticketsState._ffCatalogModalMode = opts && opts.mode === 'shared' ? 'shared' : 'location';
  ticketsState._ffOpenCats.clear();
  ticketsState._ffCatalogRenderedOnce = false;
  if (ticketsState._ffCatalogModalMode === 'shared') {
    await loadSharedCatalogForManager();
  } else {
    await loadLocationCatalogForManager();
  }
  renderServicesCatalogV2();
  modal.style.display = 'flex';
}

function closeServicesModal() {
  const modal = document.getElementById('servicesModal');
  if (modal) modal.style.display = 'none';
  _ffCatalogEditorClose();
}

/** Render the unified catalog. Keeps currently-open categories open. */
function renderServicesCatalogV2() {
  const list = _ffCatalogEl('servicesCatalogV2List');
  if (!list) return;
  const sourceBadge = _ffCatalogEl('servicesCatalogSourceBadge');
  const sourceHelp = _ffCatalogEl('servicesCatalogSourceHelp');
  const addSharedBtn = _ffCatalogEl('servicesCatalogAddSharedBtn');
  const addCategoryBtn = _ffCatalogEl('servicesCatalogAddCategoryBtn');
  const isSharedCatalog = ticketsState._ffCatalogModalMode === 'shared';
  const catalogData = isSharedCatalog
    ? getSharedServicesForCatalogManager()
    : getLocationServicesForCatalogManager();
  const catalogServices = catalogData.services || [];
  const catalogCategories = catalogData.categories || [];

  if (sourceBadge) {
    sourceBadge.textContent = isSharedCatalog ? 'Service Catalog' : 'Location Service Catalog';
    sourceBadge.style.background = isSharedCatalog ? '#ede9fe' : '#eef2ff';
    sourceBadge.style.color = isSharedCatalog ? '#5b21b6' : '#3730a3';
  }
  if (sourceHelp) {
    sourceHelp.textContent = isSharedCatalog
      ? 'Services can be managed with availability and pricing by location.'
      : 'Categories and services are saved for the active location only.';
  }
  const canManageServices = ffCanManageServices();
  if (addSharedBtn) {
    addSharedBtn.style.display = 'none';
    addSharedBtn.textContent = '+ Add Service';
  }
  if (addCategoryBtn) {
    addCategoryBtn.style.display = canManageServices ? 'inline-block' : 'none';
    addCategoryBtn.textContent = '+ Add Category';
  }

  if (!ticketsState._ffCatalogRenderedOnce && ticketsState._ffOpenCats.size === 0 && catalogCategories.length > 0) {
    if (_ffIsServicesScreenRoot()) {
      catalogCategories.forEach((cat) => ticketsState._ffOpenCats.add(cat.id));
    } else {
      ticketsState._ffOpenCats.add(catalogCategories[0].id);
    }
  }
  ticketsState._ffCatalogRenderedOnce = true;

  // Group services under each category. Services with no categoryId (or a
  // category id that no longer exists) land in a virtual "Other" bucket,
  // shown only when it actually has services.
  const grouped = new Map();
  catalogCategories.forEach((c) => grouped.set(c.id, { id: c.id, name: c.name, services: [], isSharedCategory: !!c.isSharedCategory }));
  const orphans = [];
  catalogServices.forEach((s) => {
    const bucket = s.categoryId && grouped.has(s.categoryId) ? grouped.get(s.categoryId) : null;
    if (bucket) bucket.services.push(s);
    else orphans.push(s);
  });
  if (orphans.length) grouped.set('__other__', { id: '__other__', name: 'Other', services: orphans });

  if (_ffIsServicesScreenRoot()) {
    renderServicesScreenCatalogList(list, grouped, isSharedCatalog);
    renderServicesScreenDetail(catalogServices, catalogCategories);
    return;
  }

  if (grouped.size === 0) {
    const emptyTitle = 'No categories yet';
    const emptyBody = isSharedCatalog
      ? 'Start by adding a category, then add services under it.'
      : 'Start by adding a category (e.g. <em>Manicure</em>, <em>Pedicure</em>, <em>Massage</em>), then add services under it with their prices.';
    list.innerHTML = `
      <div style="padding:36px 20px;color:#6b7280;text-align:center;font-size:14px;line-height:1.5;">
        <div style="font-size:15px;color:#111;font-weight:600;margin-bottom:6px;">${emptyTitle}</div>
        <div>${emptyBody}</div>
      </div>`;
    return;
  }

  const dotsSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="#9ca3af" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

  let html = '';
  for (const cat of grouped.values()) {
    const isOpen = ticketsState._ffOpenCats.has(cat.id);
    const arrow = isOpen ? '▾' : '▸';
    const count = cat.services.length;
    const isOther = cat.id === '__other__';
    html += `<div class="ffcat-row" data-cat-id="${escapeHtml(cat.id)}" style="margin-bottom:6px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;background:#fff;">`;
    // The HEADER itself is draggable for categories (so services inside
    // don't accidentally pick up the category drag). Services have their
    // own draggable row below.
    const canEditCategory = !isOther;
    const canDragCategory = canEditCategory && !isSharedCatalog;
    const headDraggable = canDragCategory ? `draggable="true" data-drag-kind="category" data-cat-id="${escapeHtml(cat.id)}"` : '';
    html += `<div class="ffcat-head" ${headDraggable} role="button" tabindex="0" title="${canDragCategory ? 'Drag to reorder' : ''}" style="display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:${canDragCategory ? 'grab' : 'pointer'};background:#f9fafb;user-select:none;">`;
    html += `<span class="ffcat-arrow" style="font-size:12px;color:#6b7280;width:10px;display:inline-block;">${arrow}</span>`;
    html += `<span style="font-weight:600;color:#111;font-size:13px;flex:1;line-height:1.25;">${escapeHtml(cat.name)}</span>`;
    html += `<span style="color:#9ca3af;font-size:11px;">${count}</span>`;
    if (canEditCategory) {
      html += `<button type="button" class="ffcat-menu-btn" data-cat-id="${escapeHtml(cat.id)}" title="Category actions" style="border:none;background:none;padding:2px 4px;cursor:pointer;line-height:0;border-radius:4px;">${dotsSvg}</button>`;
    }
    html += `</div>`;
    html += `<div class="ffcat-body" style="display:${isOpen ? 'block' : 'none'};padding:2px 6px 6px;">`;
    if (cat.services.length === 0) {
      html += `<div style="padding:6px 10px;color:#9ca3af;font-size:12px;">No services yet.</div>`;
    } else {
      cat.services.forEach((s) => {
        // Services that landed in the virtual "Other" bucket have no real
        // parent category — drag them only to re-home into a real one.
        const canDragService = !isSharedCatalog;
        const serviceDragAttrs = canDragService ? `draggable="true" data-drag-kind="service"` : '';
        const serviceOpacity = s.active === false ? 'opacity:0.62;' : '';
        const priceBadge = isSharedCatalog && s.hasOverride
          ? `<span style="padding:2px 6px;border-radius:999px;background:#dbeafe;color:#1d4ed8;font-size:10px;font-weight:700;white-space:nowrap;">Override: ${ffTicketMoney(s.overridePrice || 0)}</span>`
          : (isSharedCatalog ? `<span style="padding:2px 6px;border-radius:999px;background:#f3f4f6;color:#4b5563;font-size:10px;font-weight:700;white-space:nowrap;">Default</span>` : '');
        const inactiveBadge = isSharedCatalog && s.active === false
          ? `<span style="padding:2px 6px;border-radius:999px;background:#fee2e2;color:#b91c1c;font-size:10px;font-weight:700;white-space:nowrap;">Inactive</span>`
          : '';
        html += `<div class="ffsvc-row" ${serviceDragAttrs} data-svc-id="${escapeHtml(s.id)}" data-cat-id="${escapeHtml(cat.id)}" title="${canDragService ? 'Drag to reorder / move' : ''}" style="display:flex;align-items:center;gap:8px;padding:5px 10px 5px 18px;border-bottom:1px solid #f3f4f6;cursor:${canDragService ? 'grab' : 'default'};${serviceOpacity}">`;
        html += `<span style="font-weight:500;color:#111;font-size:12px;flex:1;line-height:1.25;">${escapeHtml(s.name)}</span>`;
        html += priceBadge;
        html += inactiveBadge;
        html += `<span style="color:#374151;font-size:12px;font-variant-numeric:tabular-nums;">${ffTicketMoney(s.defaultPrice || 0)}</span>`;
        html += `<button type="button" class="ffsvc-menu-btn" data-svc-id="${escapeHtml(s.id)}" title="Service actions" style="border:none;background:none;padding:2px 4px;cursor:pointer;line-height:0;border-radius:4px;">${dotsSvg}</button>`;
        html += `</div>`;
      });
    }
    if (!isOther) {
      const addMode = isSharedCatalog ? 'shared' : 'location';
      const addLabel = isSharedCatalog ? '+ Add Service' : '+ Add service';
      html += `<div style="padding:4px 6px;"><button type="button" class="ffcat-addsvc-btn" data-cat-id="${escapeHtml(cat.id)}" data-add-mode="${addMode}" style="background:none;border:none;color:#7c3aed;font-weight:600;font-size:12px;padding:4px 6px;cursor:pointer;text-align:left;">${addLabel}</button></div>`;
    }
    html += `</div></div>`;
  }
  list.innerHTML = html;
  if (!ffCanManageServices()) {
    list.querySelectorAll('.ffcat-addsvc-btn, .ffcat-menu-btn, .ffsvc-menu-btn').forEach((el) => { el.style.display = 'none'; });
    list.querySelectorAll('[data-drag-kind], .ff-services-drag-handle, .ff-catalog-drag-handle').forEach((el) => { el.style.display = 'none'; el.removeAttribute('draggable'); });
  }
  _ffWireCatalogDragDrop(list);

  // Wire: expand/collapse on header click (but not when clicking the menu).
  list.querySelectorAll('.ffcat-head').forEach((head) => {
    head.addEventListener('click', (e) => {
      if (e.target.closest('.ffcat-menu-btn')) return;
      const row = head.closest('.ffcat-row');
      const catId = row?.getAttribute('data-cat-id');
      if (!catId) return;
      if (ticketsState._ffOpenCats.has(catId)) ticketsState._ffOpenCats.delete(catId); else ticketsState._ffOpenCats.add(catId);
      renderServicesCatalogV2();
    });
  });
  // Wire: category action menu
  list.querySelectorAll('.ffcat-menu-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const catId = btn.getAttribute('data-cat-id');
      _ffShowCategoryMenu(btn, catId);
    });
  });
  // Wire: add service inside a category
  list.querySelectorAll('.ffcat-addsvc-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const catId = btn.getAttribute('data-cat-id');
      ticketsState._ffOpenCats.add(catId);
      if (btn.getAttribute('data-add-mode') === 'shared') {
        const cat = getSharedServicesForCatalogManager().categories.find((c) => c.id === catId);
        _ffCatalogEditorOpen({ mode: 'shared-service-add', categoryName: cat?.name || '' });
      } else {
        _ffCatalogEditorOpen({ mode: 'service-add', categoryId: catId });
      }
    });
  });
  // Wire: service action menu
  list.querySelectorAll('.ffsvc-menu-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const svcId = btn.getAttribute('data-svc-id');
      _ffShowServiceMenu(btn, svcId);
    });
  });
}

function renderServicesScreenCatalogList(list, grouped, isSharedCatalog) {
  if (!grouped || grouped.size === 0) {
    list.innerHTML = '<div style="padding:0 20px 20px;color:#6b7280;font-size:12px;line-height:1.5;">No categories yet. Use + Add Category above.</div>';
    return;
  }

  let html = '';
  for (const cat of grouped.values()) {
    const isOther = cat.id === '__other__';
    const canEditCategory = !isOther;
    const isOpen = ticketsState._ffOpenCats.has(cat.id);
    const arrow = isOpen ? '▾' : '▸';
    const isCategorySelected = String(cat.id) === String(ticketsState._ffSelectedCategoryId || '');
    html += `<div class="staff-sidebar-section" style="padding:0 16px 12px 16px;border-top:1px solid var(--border);padding-top:12px;">`;
    html += `<div style="display:flex;align-items:center;gap:6px;margin:0 0 6px 0;">`;
    html += `<button type="button" class="ff-services-cat-toggle" data-cat-id="${escapeHtml(cat.id)}" aria-expanded="${isOpen ? 'true' : 'false'}" style="border:none;background:none;color:#6b7280;cursor:pointer;font-size:14px;line-height:1;padding:2px;width:16px;flex-shrink:0;">${arrow}</button>`;
    html += `<button type="button" class="ff-services-category-title${isCategorySelected ? ' is-selected' : ''}" data-cat-id="${escapeHtml(cat.id)}" ${canEditCategory ? '' : 'disabled'} style="margin:0;font-size:11px;font-weight:500;color:#6b7280;text-transform:none;letter-spacing:0;flex:1;text-align:left;border:none;background:${isCategorySelected ? '#ede9fe' : 'transparent'};border-radius:6px;padding:4px 6px;cursor:${canEditCategory ? 'pointer' : 'default'};">${escapeHtml(cat.name)}</button>`;
    html += `</div>`;
    html += `<div class="ff-services-cat-services" data-cat-id="${escapeHtml(cat.id)}" style="display:${isOpen ? 'flex' : 'none'};flex-direction:column;gap:4px;">`;
    if (cat.services.length === 0) {
      html += `<div style="padding:6px 8px;color:#9ca3af;font-size:12px;">No services yet.</div>`;
    } else {
      cat.services.forEach((s) => {
        const isSelected = String(s.id) === String(ticketsState._ffSelectedServiceId || '');
        const serviceOpacity = s.active === false ? 'opacity:0.62;' : '';
        html += `<div class="staff-sidebar-item ff-services-sidebar-service${isSelected ? ' is-selected' : ''}" data-svc-id="${escapeHtml(s.id)}" data-cat-id="${escapeHtml(cat.id)}" style="width:100%;display:flex;align-items:center;gap:6px;padding:8px 8px;border:none;border-radius:6px;background:${isSelected ? '#ede9fe' : 'transparent'};cursor:pointer;text-align:left;${serviceOpacity}">`;
        html += `<span class="ff-services-drag-handle" draggable="true" data-drag-kind="service" data-svc-id="${escapeHtml(s.id)}" data-cat-id="${escapeHtml(cat.id)}" title="Drag to reorder" style="color:#9ca3af;font-size:12px;line-height:1;cursor:grab;user-select:none;flex-shrink:0;">⋮⋮</span>`;
        html += `<span style="font-size:12px;color:#111827;line-height:1.25;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(s.name || '')}</span>`;
        html += `</div>`;
      });
    }
    if (!isOther) {
      const addMode = isSharedCatalog ? 'shared' : 'location';
      const addLabel = '+ Add Service';
      html += `<button type="button" class="ffcat-addsvc-btn" data-cat-id="${escapeHtml(cat.id)}" data-add-mode="${addMode}" style="width:100%;background:none;border:none;color:#7c3aed;font-weight:600;font-size:12px;padding:6px 8px;cursor:pointer;text-align:left;border-radius:6px;">${addLabel}</button>`;
    }
    html += `</div></div>`;
  }

  list.innerHTML = html;
  if (!ffCanManageServices()) {
    list.querySelectorAll('.ffcat-addsvc-btn, .ffcat-menu-btn, .ffsvc-menu-btn').forEach((el) => { el.style.display = 'none'; });
    list.querySelectorAll('[data-drag-kind], .ff-services-drag-handle, .ff-catalog-drag-handle').forEach((el) => { el.style.display = 'none'; el.removeAttribute('draggable'); });
  }

  list.querySelectorAll('.ff-services-cat-toggle').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const catId = btn.getAttribute('data-cat-id');
      if (!catId) return;
      if (ticketsState._ffOpenCats.has(catId)) ticketsState._ffOpenCats.delete(catId); else ticketsState._ffOpenCats.add(catId);
      renderServicesCatalogV2();
    });
  });
  list.querySelectorAll('.ff-services-category-title').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const catId = btn.getAttribute('data-cat-id');
      if (!catId) return;
      ticketsState._ffSelectedCategoryId = catId;
      ticketsState._ffSelectedServiceId = null;
      ticketsState._ffServicesInlineEditServiceId = null;
      renderServicesCatalogV2();
      // Mobile: open the category detail full-screen.
      _ffServicesMobileShowDetail('detail');
    });
  });
  list.querySelectorAll('.ffcat-addsvc-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const catId = btn.getAttribute('data-cat-id');
      ticketsState._ffOpenCats.add(catId);
      if (btn.getAttribute('data-add-mode') === 'shared') {
        const cat = getSharedServicesForCatalogManager().categories.find((c) => c.id === catId);
        _ffCatalogEditorOpen({ mode: 'shared-service-add', categoryName: cat?.name || '' });
      } else {
        _ffCatalogEditorOpen({ mode: 'service-add', categoryId: catId });
      }
    });
  });
  list.querySelectorAll('.ff-services-sidebar-service').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.ffsvc-menu-btn')) return;
      ticketsState._ffSelectedServiceId = btn.getAttribute('data-svc-id');
      ticketsState._ffSelectedCategoryId = null;
      if (String(ticketsState._ffServicesInlineEditServiceId || '') !== String(ticketsState._ffSelectedServiceId || '')) {
        ticketsState._ffServicesInlineEditServiceId = null;
      }
      renderServicesCatalogV2();
      // Mobile: open the service menu (Details/Locations/Staff) full-screen.
      _ffServicesMobileShowDetail('detail');
    });
  });
  _ffWireServicesScreenDragDrop(list);
}

function _ffWireServicesScreenDragDrop(listEl) {
  listEl.addEventListener('dragstart', (e) => {
    const handle = e.target.closest('.ff-services-drag-handle[data-drag-kind="service"]');
    if (!handle) return;
    const row = handle.closest('.ff-services-sidebar-service');
    ticketsState._ffDragSrc = {
      kind: 'service',
      catId: handle.getAttribute('data-cat-id') || null,
      svcId: handle.getAttribute('data-svc-id') || null,
    };
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', ticketsState._ffDragSrc.svcId || '');
    } catch (_) {}
    if (row) row.style.opacity = '0.4';
  });

  listEl.addEventListener('dragend', (e) => {
    const row = e.target.closest('.ff-services-sidebar-service');
    if (row) row.style.opacity = '';
    _ffClearDragHover();
    ticketsState._ffDragSrc = null;
  });

  listEl.addEventListener('dragover', (e) => {
    if (!ticketsState._ffDragSrc || ticketsState._ffDragSrc.kind !== 'service') return;
    const targetSvc = e.target.closest('.ff-services-sidebar-service');
    if (
      !targetSvc ||
      targetSvc.getAttribute('data-svc-id') === ticketsState._ffDragSrc.svcId ||
      targetSvc.getAttribute('data-cat-id') !== ticketsState._ffDragSrc.catId
    ) {
      if (ticketsState._ffDragHoverEl) _ffClearDragHover();
      return;
    }
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
    if (targetSvc !== ticketsState._ffDragHoverEl) {
      _ffClearDragHover();
      ticketsState._ffDragHoverEl = targetSvc;
    }
    const rect = targetSvc.getBoundingClientRect();
    const placeAfter = e.clientY > rect.top + rect.height / 2;
    targetSvc.dataset.dropPosition = placeAfter ? 'after' : 'before';
    targetSvc.style.boxShadow = placeAfter
      ? 'inset 0 -2px 0 0 #7c3aed'
      : 'inset 0 2px 0 0 #7c3aed';
  });

  listEl.addEventListener('drop', async (e) => {
    if (!ticketsState._ffDragSrc || ticketsState._ffDragSrc.kind !== 'service') return;
    const targetSvc = e.target.closest('.ff-services-sidebar-service');
    const src = ticketsState._ffDragSrc;
    _ffClearDragHover();
    ticketsState._ffDragSrc = null;
    if (
      !targetSvc ||
      targetSvc.getAttribute('data-svc-id') === src.svcId ||
      targetSvc.getAttribute('data-cat-id') !== src.catId
    ) {
      return;
    }
    e.preventDefault();
    try {
      await _ffReorderServiceWithinCategory(
        src.svcId,
        targetSvc.getAttribute('data-svc-id'),
        src.catId,
        targetSvc.dataset.dropPosition === 'after'
      );
      await loadServices();
      renderServicesCatalogV2();
    } catch (err) {
      console.error('[Services] Reorder failed', err);
      showToast(err?.message || 'Reorder failed', 'error');
    }
  });
}

async function _ffReorderServiceWithinCategory(srcId, targetSvcId, categoryId, placeAfter) {
  if (!categoryId || categoryId === '__other__') return;
  const src = ticketsState.salonServices.find(s => s.id === srcId);
  if (!src || src.categoryId !== categoryId) return;
  const siblings = ticketsState.salonServices
    .filter(s => s.categoryId === categoryId && s.id !== srcId)
    .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
  const targetIdx = siblings.findIndex(s => s.id === targetSvcId);
  if (targetIdx < 0) return;
  siblings.splice(targetIdx + (placeAfter ? 1 : 0), 0, src);
  await Promise.all(siblings.map((s, idx) => saveService({
    id: s.id,
    name: s.name,
    categoryId,
    defaultPrice: s.defaultPrice || 0,
    sortOrder: idx,
  })));
}

function renderServicesScreenDetail(catalogServices, catalogCategories) {
  const root = document.getElementById('servicesScreen');
  if (!root) return;
  const placeholder = root.querySelector('#servicesDetailPlaceholder');
  const container = root.querySelector('#servicesDetailContainer');
  const header = root.querySelector('#servicesDetailHeader');
  const nav = root.querySelector('#servicesDetailNav');
  const content = root.querySelector('#servicesDetailTabContent');
  if (!placeholder || !container || !header || !nav || !content) return;

  const services = Array.isArray(catalogServices) ? catalogServices : [];
  const categories = Array.isArray(catalogCategories) ? catalogCategories : [];
  let selectedService = services.find((s) => String(s.id) === String(ticketsState._ffSelectedServiceId || ''));
  if (!selectedService && ticketsState._ffSelectedServiceId) ticketsState._ffSelectedServiceId = null;
  let selectedCategory = categories.find((c) => String(c.id) === String(ticketsState._ffSelectedCategoryId || ''));
  if (!selectedCategory && ticketsState._ffSelectedCategoryId) ticketsState._ffSelectedCategoryId = null;
  if (!selectedService && !selectedCategory) {
    placeholder.style.display = 'flex';
    container.style.display = 'none';
    return;
  }

  placeholder.style.display = 'none';
  container.style.display = 'block';

  if (selectedCategory && !selectedService) {
    const categoryMode = ticketsState._ffCatalogModalMode === 'shared' ? 'shared-category-edit' : 'category-edit';
    nav.innerHTML = `
      <button type="button" class="staff-nav-item is-active" style="width:100%;padding:8px 10px;min-height:36px;border:none;border-radius:6px;font-size:12px;cursor:pointer;text-align:left;">Details</button>
    `;
    header.innerHTML = `
      <div style="padding:8px 0 4px;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;">
        <div style="min-width:0;">
          <div style="font-size:22px;font-weight:800;color:#111827;line-height:1.2;">${escapeHtml(selectedCategory.name || 'Category')}</div>
        </div>
        <button type="button" id="servicesCategoryActionsBtn" title="Category actions" style="width:32px;height:32px;border:1px solid var(--border);background:#fff;border-radius:999px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#6b7280;font-weight:800;line-height:1;flex-shrink:0;">...</button>
      </div>
    `;
    content.innerHTML = `
      <div style="padding:14px;background:#fff;border:1px solid var(--border);border-radius:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;">
          <div style="font-size:14px;font-weight:700;color:#111827;">Details</div>
          <button type="button" id="servicesCategoryEditBtn" style="padding:7px 12px;background:#fff;color:#7c3aed;border:1px solid #e9d5ff;border-radius:999px;cursor:pointer;font-size:12px;font-weight:700;">Edit</button>
        </div>
        <div style="display:flex;flex-direction:column;border-top:1px solid #f3f4f6;">
          <div style="display:grid;grid-template-columns:160px 1fr;gap:12px;padding:8px 0;border-bottom:1px solid #f3f4f6;">
            <div style="font-size:12px;color:#6b7280;">Category name</div>
            <div style="font-size:13px;color:#111827;font-weight:600;">${escapeHtml(selectedCategory.name || '')}</div>
          </div>
        </div>
      </div>
    `;
    const categoryActionsBtn = root.querySelector('#servicesCategoryActionsBtn');
    if (categoryActionsBtn) {
      categoryActionsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        _ffShowServicesCategoryDetailMenu(categoryActionsBtn, String(selectedCategory.id));
      });
    }
    const categoryEditBtn = root.querySelector('#servicesCategoryEditBtn');
    if (categoryEditBtn) {
      categoryEditBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        _ffCatalogEditorOpen({ mode: categoryMode, categoryId: selectedCategory.id });
      });
    }
    return;
  }

  const selected = selectedService;
  const rawDuration = selected.durationMinutes ?? selected.duration ?? selected.defaultDuration ?? selected.minutes;
  const durationText = rawDuration == null || rawDuration === ''
    ? ''
    : (Number.isFinite(Number(rawDuration)) ? `${Number(rawDuration)} min` : String(rawDuration));
  const isInlineEditingService = String(ticketsState._ffServicesInlineEditServiceId || '') === String(selected.id || '');
  const activeServiceTab = ticketsState._ffServicesDetailTab || 'details';
  const basePrice = Number(selected.sharedDefaultPrice ?? selected.defaultPrice) || 0;
  const categoryOptions = categories
    .filter((cat) => cat.id !== '__other__')
    .map((cat) => `<option value="${escapeHtml(cat.name || cat.id)}" ${String(cat.id) === String(selected.categoryId || '') ? 'selected' : ''}>${escapeHtml(cat.name || '')}</option>`)
    .join('');
  nav.innerHTML = `
    <button type="button" class="staff-nav-item${activeServiceTab === 'details' ? ' is-active' : ''}" data-services-tab="details" style="width:100%;padding:8px 10px;min-height:36px;border:none;border-radius:6px;font-size:12px;cursor:pointer;text-align:left;">Details</button>
    <button type="button" class="staff-nav-item${activeServiceTab === 'locations' ? ' is-active' : ''}" data-services-tab="locations" style="width:100%;padding:8px 10px;min-height:36px;border:none;border-radius:6px;font-size:12px;cursor:pointer;text-align:left;">Locations</button>
    <button type="button" class="staff-nav-item${activeServiceTab === 'staff' ? ' is-active' : ''}" data-services-tab="staff" style="width:100%;padding:8px 10px;min-height:36px;border:none;border-radius:6px;font-size:12px;cursor:pointer;text-align:left;">Staff</button>
  `;
  header.innerHTML = `
    <div style="padding:8px 0 4px;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;">
      <div style="min-width:0;">
        <div style="font-size:22px;font-weight:800;color:#111827;line-height:1.2;">${escapeHtml(selected.name || 'Service')}</div>
        <div style="margin-top:6px;font-size:14px;color:#6b7280;font-weight:600;">${ffTicketMoney(basePrice)}</div>
      </div>
      <button type="button" id="servicesDetailActionsBtn" title="Service actions" style="width:32px;height:32px;border:1px solid var(--border);background:#fff;border-radius:999px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#6b7280;font-weight:800;line-height:1;flex-shrink:0;">...</button>
    </div>
  `;
  if (activeServiceTab === 'locations') {
    content.innerHTML = renderServicesLocationsTabHtml(selected);
    wireServicesLocationsTab(root, selected);
  } else if (activeServiceTab === 'staff') {
    content.innerHTML = renderServicesStaffTabHtml(selected);
    wireServicesStaffTab(root, selected);
  } else {
    content.innerHTML = isInlineEditingService ? `
    <div style="padding:14px;background:#fff;border:1px solid var(--border);border-radius:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;">
        <div style="font-size:14px;font-weight:700;color:#111827;">Details</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button type="button" id="servicesInlineEditCancelBtn" style="padding:7px 12px;background:#fff;color:#374151;border:1px solid #e5e7eb;border-radius:999px;cursor:pointer;font-size:12px;font-weight:700;">Cancel</button>
          <button type="button" id="servicesInlineEditSaveBtn" style="padding:7px 12px;background:#7c3aed;color:#fff;border:1px solid #7c3aed;border-radius:999px;cursor:pointer;font-size:12px;font-weight:700;">Save</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;border-top:1px solid #f3f4f6;">
        <label style="display:grid;grid-template-columns:160px 1fr;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid #f3f4f6;">
          <span style="font-size:12px;color:#6b7280;">Service Name</span>
          <input id="servicesInlineEditName" type="text" value="${escapeHtml(selected.name || '')}" style="width:100%;max-width:420px;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;box-sizing:border-box;">
        </label>
        <label style="display:grid;grid-template-columns:160px 1fr;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid #f3f4f6;">
          <span style="font-size:12px;color:#6b7280;">Category</span>
          <select id="servicesInlineEditCategory" style="width:100%;max-width:420px;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;background:#fff;box-sizing:border-box;">
            <option value="">No category</option>
            ${categoryOptions}
          </select>
        </label>
        <label style="display:grid;grid-template-columns:160px 1fr;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid #f3f4f6;">
          <span style="font-size:12px;color:#6b7280;">Price</span>
          <input id="servicesInlineEditPrice" type="number" min="0" step="0.01" value="${escapeHtml(String(basePrice))}" style="width:100%;max-width:180px;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;box-sizing:border-box;">
        </label>
        <label style="display:grid;grid-template-columns:160px 1fr;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid #f3f4f6;">
          <span style="font-size:12px;color:#6b7280;">Charge Tax</span>
          <span style="display:flex;align-items:center;gap:8px;">
            <span class="ff-toggle-switch"><input id="servicesInlineEditTaxable" type="checkbox" ${selected.taxable === true ? 'checked' : ''}><span class="ff-toggle-slider"></span></span>
            <span style="font-size:11px;color:#9ca3af;line-height:1.35;">Apply Service Tax to this service (only when Service Tax is enabled in Settings).</span>
          </span>
        </label>
      </div>
    </div>
  ` : `
    <div style="padding:14px;background:#fff;border:1px solid var(--border);border-radius:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;">
        <div style="font-size:14px;font-weight:700;color:#111827;">Details</div>
        <button type="button" id="servicesDetailEditBtn" style="padding:7px 12px;background:#fff;color:#7c3aed;border:1px solid #e9d5ff;border-radius:999px;cursor:pointer;font-size:12px;font-weight:700;">Edit</button>
      </div>
      <div style="display:flex;flex-direction:column;border-top:1px solid #f3f4f6;">
        <div style="display:grid;grid-template-columns:160px 1fr;gap:12px;padding:8px 0;border-bottom:1px solid #f3f4f6;">
          <div style="font-size:12px;color:#6b7280;">Service name</div>
          <div style="font-size:13px;color:#111827;font-weight:600;">${escapeHtml(selected.name || '')}</div>
        </div>
        <div style="display:grid;grid-template-columns:160px 1fr;gap:12px;padding:8px 0;border-bottom:1px solid #f3f4f6;">
          <div style="font-size:12px;color:#6b7280;">Price</div>
          <div style="font-size:13px;color:#111827;font-weight:600;">${ffTicketMoney(basePrice)}</div>
        </div>
        <div style="display:grid;grid-template-columns:160px 1fr;gap:12px;padding:8px 0;border-bottom:1px solid #f3f4f6;">
          <div style="font-size:12px;color:#6b7280;">Charge Tax</div>
          <div style="font-size:13px;color:#111827;font-weight:600;">${selected.taxable === true ? 'On' : 'Off'}</div>
        </div>
        ${durationText ? `
        <div style="display:grid;grid-template-columns:160px 1fr;gap:12px;padding:8px 0;border-bottom:1px solid #f3f4f6;">
          <div style="font-size:12px;color:#6b7280;">Duration</div>
          <div style="font-size:13px;color:#111827;font-weight:600;">${escapeHtml(durationText)}</div>
        </div>` : ''}
      </div>
    </div>
  `;
  }
  root.querySelectorAll('#servicesDetailNav [data-services-tab]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      ticketsState._ffServicesDetailTab = btn.getAttribute('data-services-tab') || 'details';
      ticketsState._ffServicesInlineEditServiceId = null;
      renderServicesCatalogV2();
      // Mobile: drill into the chosen section (Details/Locations/Staff).
      _ffServicesMobileShowDetail('tab');
    });
  });
  const canManageServicesDetail = ffCanManageServices();
  const actionsBtn = root.querySelector('#servicesDetailActionsBtn');
  if (actionsBtn) {
    if (!canManageServicesDetail) {
      actionsBtn.style.display = 'none';
    } else {
      actionsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        _ffShowServiceMenu(actionsBtn, String(selected.id));
      });
    }
  }
  const editBtn = root.querySelector('#servicesDetailEditBtn');
  if (editBtn) {
    if (!canManageServicesDetail) {
      editBtn.style.display = 'none';
    } else {
      editBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        ticketsState._ffServicesInlineEditServiceId = selected.id;
        renderServicesCatalogV2();
      });
    }
  }
  const cancelBtn = root.querySelector('#servicesInlineEditCancelBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      ticketsState._ffServicesInlineEditServiceId = null;
      renderServicesCatalogV2();
    });
  }
  const saveBtn = root.querySelector('#servicesInlineEditSaveBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const nameInput = root.querySelector('#servicesInlineEditName');
      const categoryInput = root.querySelector('#servicesInlineEditCategory');
      const priceInput = root.querySelector('#servicesInlineEditPrice');
      const name = String(nameInput?.value || '').trim();
      if (!name) {
        if (nameInput) nameInput.focus();
        showToast('Service name is required', 'error');
        return;
      }
      const categoryId = categoryInput?.value || null;
      const defaultPrice = parseFloat(priceInput?.value) || 0;
      const taxableInput = root.querySelector('#servicesInlineEditTaxable');
      const taxable = !!(taxableInput && taxableInput.checked);
      saveBtn.disabled = true;
      saveBtn.style.opacity = '0.7';
      try {
        if (selected.isSharedService || ticketsState._ffCatalogModalMode === 'shared') {
          await saveSharedService({
            id: selected.id,
            name,
            category: categoryId || selected.category || '',
            defaultPrice,
            active: selected.active !== false,
          sortOrder: selected.sortOrder,
            taxable,
          });
          await loadSharedCatalogForManager();
        } else {
          await saveService({
            id: selected.id,
            name,
            categoryId,
            defaultPrice,
          sortOrder: Number.isFinite(Number(selected.sortOrder)) ? Number(selected.sortOrder) : 0,
            taxable,
          });
          await Promise.all([loadServiceCategories(), loadServices()]);
        }
        selected.name = name;
        selected.categoryId = categoryId;
        selected.defaultPrice = defaultPrice;
        selected.taxable = taxable;
        ticketsState._ffServicesInlineEditServiceId = null;
        if (categoryId) ticketsState._ffOpenCats.add(categoryId);
        renderServicesCatalogV2();
        if (typeof setupTicketsUI === 'function') setupTicketsUI();
        showToast('Updated', 'success');
      } catch (err) {
        showToast(err?.message || 'Failed', 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.style.opacity = '1';
      }
    });
  }
}

function renderServicesLocationsTabHtml(service) {
  const locations = (typeof window !== 'undefined' && typeof window.ffGetActiveLocations === 'function')
    ? (window.ffGetActiveLocations() || [])
    : [];
  if (!service || !service.id) return '';
  if (ticketsState._ffCatalogModalMode !== 'shared' && !service.isSharedService) {
    return `
      <div style="padding:14px;background:#fff;border:1px solid var(--border);border-radius:12px;">
        <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:6px;">Locations</div>
        <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">This service is still using the older location catalog. Open Services after the catalog migration completes to manage locations here.</p>
      </div>
    `;
  }
  if (!Array.isArray(locations) || locations.length === 0) {
    return `
      <div style="padding:14px;background:#fff;border:1px solid var(--border);border-radius:12px;">
        <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:6px;">Locations</div>
        <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">No active locations found.</p>
      </div>
    `;
  }
  if (!ticketsState._ffServicesLocationOverridesByService[service.id] && !ticketsState._ffServicesLocationOverridesLoading[service.id]) {
    ticketsState._ffServicesLocationOverridesLoading[service.id] = true;
    loadSharedServiceLocationOverridesForService(service.id)
      .catch((e) => console.warn('[Services] failed loading location overrides', e))
      .finally(() => {
        ticketsState._ffServicesLocationOverridesLoading[service.id] = false;
        if (ticketsState._ffSelectedServiceId === service.id && ticketsState._ffServicesDetailTab === 'locations') renderServicesCatalogV2();
      });
  }
  const overrides = ticketsState._ffServicesLocationOverridesByService[service.id] || {};
  const basePrice = Number(service.sharedDefaultPrice ?? service.defaultPrice) || 0;
  const loading = ticketsState._ffServicesLocationOverridesLoading[service.id] === true;
  const cards = locations.map((loc) => {
    const override = overrides[loc.id] || {};
    const enabled = override.enabled !== false;
    const hasPriceOverride = Number.isFinite(Number(override.price));
    const shownPrice = hasPriceOverride ? Number(override.price) : basePrice;
    return `
      <div class="ff-services-location-card" data-location-id="${escapeHtml(loc.id)}" style="padding:10px 12px;background:#fff;border:1px solid var(--border);border-radius:12px;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px;">
          <div>
            <div style="font-size:13px;font-weight:700;color:#111827;line-height:1.25;">${escapeHtml(loc.name || loc.label || 'Location')}</div>
            <div style="margin-top:2px;font-size:11px;color:#6b7280;">${enabled ? 'Available at this location' : 'Not available at this location'}</div>
          </div>
          <label class="staff-permission-toggle" style="flex:0 0 auto;">
            <input type="checkbox" class="ff-services-location-enabled" ${enabled ? 'checked' : ''}>
            <span class="staff-permission-toggle-slider"></span>
          </label>
        </div>
        <div style="display:grid;grid-template-columns:100px minmax(110px,170px) auto;gap:8px;align-items:center;">
          <div style="font-size:12px;color:#6b7280;">Price</div>
          <input type="number" min="0" step="0.01" class="ff-services-location-price" value="${escapeHtml(String(shownPrice))}" style="width:100%;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;box-sizing:border-box;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <button type="button" class="ff-services-location-save" style="padding:7px 12px;background:#7c3aed;color:#fff;border:1px solid #7c3aed;border-radius:999px;cursor:pointer;font-size:12px;font-weight:700;">Save</button>
            ${hasPriceOverride ? `<button type="button" class="ff-services-location-reset" style="padding:7px 12px;background:#fff;color:#6b7280;border:1px solid #e5e7eb;border-radius:999px;cursor:pointer;font-size:12px;font-weight:700;">Reset to default</button>` : ''}
            <span style="font-size:11px;color:${hasPriceOverride ? '#7c3aed' : '#9ca3af'};">${hasPriceOverride ? 'Override' : `Default ${ffTicketMoney(basePrice)}`}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
  return `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <div style="padding:12px;background:#fff;border:1px solid var(--border);border-radius:12px;">
        <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:3px;">Locations</div>
        <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.4;">Manage availability and location-specific pricing for this service.</p>
        ${loading ? '<div style="margin-top:8px;font-size:12px;color:#9ca3af;">Loading location overrides...</div>' : ''}
      </div>
      ${cards}
    </div>
  `;
}

function wireServicesLocationsTab(root, service) {
  if (!root || !service || !service.id) return;
  const basePrice = Number(service.sharedDefaultPrice ?? service.defaultPrice) || 0;
  root.querySelectorAll('.ff-services-location-card').forEach((card) => {
    const locationId = card.getAttribute('data-location-id');
    const enabledInput = card.querySelector('.ff-services-location-enabled');
    const priceInput = card.querySelector('.ff-services-location-price');
    const saveBtn = card.querySelector('.ff-services-location-save');
    const resetBtn = card.querySelector('.ff-services-location-reset');
    const saveLocation = async (priceMode) => {
      if (!locationId) return;
      const enabled = enabledInput ? enabledInput.checked : true;
      const rawPrice = parseFloat(priceInput?.value);
      const patch = { enabled };
      if (priceMode === 'reset') {
        patch.price = null;
        if (priceInput) priceInput.value = String(basePrice);
      } else if (Number.isFinite(rawPrice) && rawPrice !== basePrice) {
        patch.price = rawPrice;
      } else {
        patch.price = null;
      }
      if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '0.7'; }
      try {
        await saveSharedServiceLocationOverride(service.id, locationId, patch);
        const catalogData = ticketsState._ffCatalogModalMode === 'shared'
          ? getSharedServicesForCatalogManager()
          : getLocationServicesForCatalogManager();
        renderServicesScreenDetail(catalogData.services || [], catalogData.categories || []);
        if (typeof setupTicketsUI === 'function') setupTicketsUI();
        showToast(priceMode === 'reset' ? 'Price reset to default' : 'Location updated', 'success');
      } catch (e) {
        showToast(e?.message || 'Failed', 'error');
      } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.style.opacity = '1'; }
      }
    };
    if (enabledInput) {
      enabledInput.addEventListener('change', () => { saveLocation('save'); });
    }
    if (saveBtn) {
      saveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        saveLocation('save');
      });
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        saveLocation('reset');
      });
    }
  });
}

function ffServiceStaffPermissionTrue(value) {
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'yes' || value === 'on';
}

function isServiceProviderStaffForServices(staff, service) {
  if (!staff || typeof staff !== 'object' || staff.isArchived === true || staff.archived === true) return false;
  if (service && !controlledStaffCanProvideService(staff, service)) return false;
  const role = String(staff.role || staff.type || '').toLowerCase().trim();
  const permissions = staff.permissions && typeof staff.permissions === 'object' ? staff.permissions : {};
  const hasTicketsPermission =
    ffServiceStaffPermissionTrue(permissions.tickets_view) ||
    ffServiceStaffPermissionTrue(permissions.tickets_use) ||
    ffServiceStaffPermissionTrue(permissions.tickets_create);
  const hasProviderRole = [
    'technician',
    'tech',
    'service_provider',
    'service provider',
    'provider',
    'staff'
  ].indexOf(role) !== -1;
  const hasProviderTypes = Array.isArray(staff.technicianTypes) && staff.technicianTypes.length > 0;
  return hasProviderRole || hasProviderTypes || hasTicketsPermission;
}

function canStaffSendNewTicket(staff) {
  if (!staff || typeof staff !== 'object' || staff.isArchived === true || staff.archived === true) return false;
  const permissions = staff.permissions && typeof staff.permissions === 'object' ? staff.permissions : {};
  // The "Can send new ticket" toggle is authoritative in BOTH directions once an
  // owner has set it explicitly: ON always shows the + New button, OFF always
  // hides it (even for service providers). This matches what owners expect when
  // they flip the switch on a staff member.
  if (Object.prototype.hasOwnProperty.call(permissions, 'tickets_create')) {
    return ffServiceStaffPermissionTrue(permissions.tickets_create);
  }
  // Legacy staff whose toggle was never set: service providers keep the button
  // by role / provider types so existing technicians are unaffected.
  const role = String(staff.role || staff.type || '').toLowerCase().trim();
  if (['owner', 'admin', 'manager', 'front_desk', 'front desk', 'assistant_manager'].includes(role)) return false;
  const hasProviderRole = [
    'technician',
    'tech',
    'service_provider',
    'service provider',
    'provider',
    'staff'
  ].indexOf(role) !== -1;
  const hasProviderTypes = Array.isArray(staff.technicianTypes) && staff.technicianTypes.length > 0;
  return hasProviderRole || hasProviderTypes;
}

function getServicesEligibleStaffRows(service) {
  try {
    const store = typeof window !== 'undefined' && typeof window.ffGetStaffStore === 'function'
      ? window.ffGetStaffStore()
      : null;
    const staff = Array.isArray(store?.staff) ? store.staff : [];
    return staff
      .filter((row) => isServiceProviderStaffForServices(row, service))
      .sort((a, b) => String(a.name || a.displayName || '').localeCompare(String(b.name || b.displayName || '')));
  } catch (_) {
    return [];
  }
}

function getServiceStaffId(staff) {
  return String(staff?.id || staff?.staffId || staff?.uid || staff?.firebaseUid || '').trim();
}

function getServiceStaffName(staff) {
  return String(staff?.name || staff?.displayName || staff?.fullName || staff?.email || 'Staff').trim();
}

function getStaffDefaultServiceCommission(staff, staffId) {
  try {
    if (typeof window !== 'undefined' && typeof window.ffGetStaffServiceCommissionPct === 'function') {
      const pct = Number(window.ffGetStaffServiceCommissionPct(staffId));
      if (Number.isFinite(pct) && pct > 0) return { type: 'percentage', value: pct };
    }
  } catch (_) {}
  const rules = staff && staff.earningsRules && typeof staff.earningsRules === 'object' ? staff.earningsRules : {};
  const serviceCommission = rules.serviceCommission && typeof rules.serviceCommission === 'object' ? rules.serviceCommission : {};
  const pct = Number(serviceCommission.basicPercent);
  if (serviceCommission.enabled === true && Number.isFinite(pct) && pct > 0) {
    return { type: 'percentage', value: pct };
  }
  return null;
}

function formatServiceStaffDefaultCommission(defaultCommission) {
  if (!defaultCommission || !Number.isFinite(Number(defaultCommission.value))) return 'Default';
  const value = Number(defaultCommission.value);
  return defaultCommission.type === 'fixed'
    ? `Default ${ffTicketMoney(value)}`
    : `Default ${value}%`;
}

function getStaffDefaultSupplyDeduction(staff) {
  const rules = staff && staff.earningsRules && typeof staff.earningsRules === 'object' ? staff.earningsRules : {};
  const serviceCommission = rules.serviceCommission && typeof rules.serviceCommission === 'object' ? rules.serviceCommission : {};
  const supply = serviceCommission.supplyDeduction && typeof serviceCommission.supplyDeduction === 'object'
    ? serviceCommission.supplyDeduction
    : {};
  const value = Number(supply.value);
  if (supply.enabled === true && Number.isFinite(value) && value > 0) {
    return {
      type: supply.type === 'percentage' ? 'percentage' : 'fixed',
      value
    };
  }
  return null;
}

function formatServiceStaffSupplyDeductionLabel(deduction) {
  if (!deduction || !Number.isFinite(Number(deduction.value))) return 'Default OFF';
  const value = Number(deduction.value);
  return deduction.type === 'percentage' ? `Default ${value}%` : `Default ${ffTicketMoney(value)}`;
}

function renderServicesStaffTabHtml(service) {
  const staffRows = getServicesEligibleStaffRows(service);
  if (!service || !service.id) return '';
  if (!staffRows.length) {
    return `
      <div style="padding:14px;background:#fff;border:1px solid var(--border);border-radius:12px;">
        <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:6px;">Staff</div>
        <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">No eligible service providers found.</p>
      </div>
    `;
  }
  const overrides = getServiceStaffOverrides(service);
  const basePrice = Number(service.sharedDefaultPrice ?? service.defaultPrice) || 0;
  const cards = staffRows.map((staff) => {
    const staffId = getServiceStaffId(staff);
    if (!staffId) return '';
    const override = overrides[staffId] && typeof overrides[staffId] === 'object' ? overrides[staffId] : {};
    const enabled = override.enabled !== false;
    const price = Number.isFinite(Number(override.price)) ? Number(override.price) : basePrice;
    const commission = override.commission && typeof override.commission === 'object' ? override.commission : {};
    const defaultCommission = getStaffDefaultServiceCommission(staff, staffId);
    const hasCommissionOverride = Number.isFinite(Number(commission.value));
    const commissionType = hasCommissionOverride
      ? (commission.type === 'fixed' ? 'fixed' : 'percentage')
      : (defaultCommission?.type === 'fixed' ? 'fixed' : 'percentage');
    const commissionValue = hasCommissionOverride ? String(Number(commission.value)) : '';
    const commissionDefaultLabel = formatServiceStaffDefaultCommission(defaultCommission);
    const defaultSupplyDeduction = getStaffDefaultSupplyDeduction(staff);
    const supplyDeduction = override.supplyDeduction && typeof override.supplyDeduction === 'object' ? override.supplyDeduction : {};
    const hasSupplyDeductionOverride = Object.prototype.hasOwnProperty.call(override, 'supplyDeduction');
    const hasSupplyDeductionValueOverride = supplyDeduction.enabled === true && Number.isFinite(Number(supplyDeduction.value));
    const effectiveSupplyDeduction = hasSupplyDeductionOverride
      ? (hasSupplyDeductionValueOverride ? supplyDeduction : null)
      : defaultSupplyDeduction;
    const supplyDeductionEnabled = !!effectiveSupplyDeduction;
    const supplyDeductionType = effectiveSupplyDeduction?.type === 'percentage' ? 'percentage' : 'fixed';
    const supplyDeductionValue = hasSupplyDeductionValueOverride ? String(Number(supplyDeduction.value)) : '';
    const supplyDeductionDefaultLabel = formatServiceStaffSupplyDeductionLabel(defaultSupplyDeduction);
    const supplyDeductionStatusLabel = hasSupplyDeductionOverride
      ? (hasSupplyDeductionValueOverride ? 'Override' : 'Override OFF')
      : supplyDeductionDefaultLabel;
    return `
      <div class="ff-services-staff-card" data-staff-id="${escapeHtml(staffId)}" style="padding:10px 12px;background:#fff;border:1px solid var(--border);border-radius:12px;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px;">
          <div>
            <div style="font-size:13px;font-weight:700;color:#111827;line-height:1.25;">${escapeHtml(getServiceStaffName(staff))}</div>
            <div style="margin-top:2px;font-size:11px;color:#6b7280;">${enabled ? 'Available for this service' : 'Not available for this service'}</div>
          </div>
          <label class="staff-permission-toggle" style="flex:0 0 auto;">
            <input type="checkbox" class="ff-services-staff-enabled" ${enabled ? 'checked' : ''}>
            <span class="staff-permission-toggle-slider"></span>
          </label>
        </div>
        <div style="display:grid;grid-template-columns:100px minmax(110px,170px) auto;gap:8px;align-items:center;margin-bottom:8px;">
          <div style="font-size:12px;color:#6b7280;">Price</div>
          <input type="number" min="0" step="0.01" class="ff-services-staff-price" value="${escapeHtml(String(price))}" style="width:100%;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;box-sizing:border-box;">
          <span style="font-size:11px;color:#9ca3af;">Default ${ffTicketMoney(basePrice)}</span>
        </div>
        <div style="margin-bottom:8px;padding:8px 0;border-top:1px solid #f3f4f6;border-bottom:1px solid #f3f4f6;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;">
            <div>
              <div style="font-size:12px;font-weight:700;color:#374151;">Supply Deduction</div>
              <div style="font-size:11px;color:#9ca3af;margin-top:2px;">Deduct supplies before commission. No payroll calculation is applied yet.</div>
            </div>
            <label class="staff-permission-toggle" style="flex:0 0 auto;">
              <input type="checkbox" class="ff-services-staff-supply-enabled" ${supplyDeductionEnabled ? 'checked' : ''}>
              <span class="staff-permission-toggle-slider"></span>
            </label>
          </div>
          <div class="ff-services-staff-supply-fields" style="display:${supplyDeductionEnabled ? 'grid' : 'none'};grid-template-columns:100px minmax(110px,170px) minmax(110px,170px) auto;gap:8px;align-items:center;">
            <div style="font-size:12px;color:#6b7280;">Deduction</div>
            <select class="ff-services-staff-supply-type" style="width:100%;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;background:#fff;box-sizing:border-box;">
              <option value="fixed" ${supplyDeductionType === 'fixed' ? 'selected' : ''}>Fixed Amount ($)</option>
              <option value="percentage" ${supplyDeductionType === 'percentage' ? 'selected' : ''}>Percentage (%)</option>
            </select>
            <input type="number" min="0" step="0.01" class="ff-services-staff-supply-value" value="${escapeHtml(supplyDeductionValue)}" placeholder="${hasSupplyDeductionValueOverride ? '' : escapeHtml(supplyDeductionDefaultLabel)}" style="width:100%;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;box-sizing:border-box;">
            <span style="font-size:11px;color:${hasSupplyDeductionOverride ? '#7c3aed' : '#9ca3af'};">${escapeHtml(supplyDeductionStatusLabel)}</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:100px minmax(110px,170px) minmax(70px,100px) auto;gap:8px;align-items:center;">
          <div style="font-size:12px;color:#6b7280;">Commission</div>
          <input type="number" min="0" step="0.01" class="ff-services-staff-commission-value" value="${escapeHtml(commissionValue)}" placeholder="${escapeHtml(commissionDefaultLabel)}" style="width:100%;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;box-sizing:border-box;">
          <select class="ff-services-staff-commission-type" style="width:100%;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;background:#fff;box-sizing:border-box;">
            <option value="percentage" ${commissionType === 'percentage' ? 'selected' : ''}>%</option>
            <option value="fixed" ${commissionType === 'fixed' ? 'selected' : ''}>$</option>
          </select>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <button type="button" class="ff-services-staff-save" style="width:auto;min-width:0;justify-self:start;padding:5px 10px;background:#7c3aed;color:#fff;border:1px solid #7c3aed;border-radius:999px;cursor:pointer;font-size:11px;font-weight:700;line-height:1.2;">Save</button>
            <span style="font-size:11px;color:${hasCommissionOverride ? '#7c3aed' : '#9ca3af'};">${hasCommissionOverride ? 'Override' : escapeHtml(commissionDefaultLabel)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
  return `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <div style="padding:12px;background:#fff;border:1px solid var(--border);border-radius:12px;">
        <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:3px;">Staff</div>
        <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.4;">Manage staff availability, staff-specific price, and commission for this service.</p>
      </div>
      ${cards}
    </div>
  `;
}

async function saveServiceStaffOverride(service, staffId, patch) {
  if (!service || !service.id || !staffId) throw new Error('Missing service or staff');
  const current = getServiceStaffOverrides(service);
  const existing = current[staffId] && typeof current[staffId] === 'object' ? current[staffId] : {};
  const next = { ...existing, ...(patch || {}) };
  const basePrice = Number(service.sharedDefaultPrice ?? service.defaultPrice) || 0;
  if (next.enabled === true) delete next.enabled;
  if (next.price == null || next.price === '' || Number(next.price) === basePrice) delete next.price;
  if (!next.commission || !Number.isFinite(Number(next.commission.value))) delete next.commission;
  if (
    !next.supplyDeduction ||
    (next.supplyDeduction.enabled !== true && next.supplyDeduction.enabled !== false)
  ) {
    delete next.supplyDeduction;
  } else if (next.supplyDeduction.enabled === false) {
    next.supplyDeduction = { enabled: false };
  } else if (!Number.isFinite(Number(next.supplyDeduction.value))) {
    delete next.supplyDeduction;
  } else {
    next.supplyDeduction = {
      enabled: true,
      type: next.supplyDeduction.type === 'percentage' ? 'percentage' : 'fixed',
      value: Number(next.supplyDeduction.value)
    };
  }
  const nextOverrides = { ...current };
  if (Object.keys(next).length) nextOverrides[staffId] = next;
  else delete nextOverrides[staffId];

  // IMPORTANT: updateDoc (not setDoc+merge). "Enabled" is represented by the
  // ABSENCE of `enabled:false` in the per-staff map, and setDoc with
  // { merge:true } merges nested maps recursively — it never deletes the stale
  // `enabled:false` key on the server. Result: disabling stuck, re-enabling
  // silently didn't persist (toggle reverted on reload, and the staff member's
  // ticket picker stayed empty). updateDoc REPLACES the whole staffOverrides
  // field with exactly what we computed.
  if (service.isSharedService || ticketsState._ffCatalogModalMode === 'shared') {
    const accountId = getTicketsAccountId();
    if (!accountId) throw new Error('No account');
    await updateDoc(doc(sharedServiceCatalogItemsRef(accountId), service.id), {
      staffOverrides: nextOverrides,
      updatedAt: serverTimestamp()
    });
    const raw = ticketsState._rawSharedServices.find((s) => String(s.id) === String(service.id));
    if (raw) raw.staffOverrides = nextOverrides;
  } else {
    if (!ticketsState.currentUserProfile?.salonId) throw new Error('No salon');
    await updateDoc(doc(db, `salons/${ticketsState.currentUserProfile.salonId}/services`, service.id), {
      staffOverrides: nextOverrides,
      updatedAt: serverTimestamp()
    });
    const raw = ticketsState._rawServices.find((s) => String(s.id) === String(service.id));
    if (raw) raw.staffOverrides = nextOverrides;
  }
  service.staffOverrides = nextOverrides;
  const live = ticketsState.salonServices.find((s) => String(s.id) === String(service.id));
  if (live) live.staffOverrides = nextOverrides;
}

async function ffStaffServicesLoadForStaffMember() {
  await loadServices();
  _applyCatalogFilter();
  return {
    services: ticketsState.salonServices.slice(),
    categories: ticketsState.serviceCategories.slice()
  };
}

async function ffStaffServicesSaveOverrideForStaffMember(serviceId, staffId, patch) {
  await loadServices();
  const service = ticketsState.salonServices.find((s) => String(s.id) === String(serviceId));
  if (!service) throw new Error('Service not found');
  await saveServiceStaffOverride(service, staffId, patch);
  return service;
}

function ffStaffServicesGetOverrideForStaffMember(service, staffId) {
  const overrides = getServiceStaffOverrides(service);
  return overrides && overrides[staffId] && typeof overrides[staffId] === 'object'
    ? overrides[staffId]
    : {};
}

function ffStaffServicesDefaultsForStaffMember(staff, service) {
  return {
    price: Number(service?.sharedDefaultPrice ?? service?.defaultPrice) || 0,
    commission: getStaffDefaultServiceCommission(staff, getServiceStaffId(staff)),
    supplyDeduction: getStaffDefaultSupplyDeduction(staff)
  };
}

if (typeof window !== 'undefined') {
  window.ffStaffServicesLoadForStaffMember = ffStaffServicesLoadForStaffMember;
  window.ffStaffServicesSaveOverrideForStaffMember = ffStaffServicesSaveOverrideForStaffMember;
  window.ffStaffServicesGetOverrideForStaffMember = ffStaffServicesGetOverrideForStaffMember;
  window.ffStaffServicesDefaultsForStaffMember = ffStaffServicesDefaultsForStaffMember;
  window.ffStaffServicesMoney = ffTicketMoney;
  window.ffStaffServicesEscapeHtml = escapeHtml;
}

function wireServicesStaffTab(root, service) {
  if (!root || !service || !service.id) return;
  const basePrice = Number(service.sharedDefaultPrice ?? service.defaultPrice) || 0;
  root.querySelectorAll('.ff-services-staff-card').forEach((card) => {
    const staffId = card.getAttribute('data-staff-id');
    const enabledInput = card.querySelector('.ff-services-staff-enabled');
    const priceInput = card.querySelector('.ff-services-staff-price');
    const commissionValueInput = card.querySelector('.ff-services-staff-commission-value');
    const commissionTypeInput = card.querySelector('.ff-services-staff-commission-type');
    const supplyEnabledInput = card.querySelector('.ff-services-staff-supply-enabled');
    const supplyFields = card.querySelector('.ff-services-staff-supply-fields');
    const supplyTypeInput = card.querySelector('.ff-services-staff-supply-type');
    const supplyValueInput = card.querySelector('.ff-services-staff-supply-value');
    const saveBtn = card.querySelector('.ff-services-staff-save');
    const staff = getServicesEligibleStaffRows(service).find((row) => getServiceStaffId(row) === staffId);
    const defaultCommission = getStaffDefaultServiceCommission(staff, staffId);
    const defaultSupplyDeduction = getStaffDefaultSupplyDeduction(staff);
    const saveStaff = async () => {
      if (!staffId) return;
      const enabled = enabledInput ? enabledInput.checked : true;
      const rawPrice = parseFloat(priceInput?.value);
      const commissionValue = parseFloat(commissionValueInput?.value);
      const supplyEnabled = supplyEnabledInput ? supplyEnabledInput.checked : false;
      const supplyValue = parseFloat(supplyValueInput?.value);
      const patch = {
        enabled,
        price: Number.isFinite(rawPrice) ? rawPrice : basePrice
      };
      if (Number.isFinite(commissionValue)) {
        const commissionType = commissionTypeInput?.value === 'fixed' ? 'fixed' : 'percentage';
        patch.commission = {
          type: commissionType,
          value: commissionValue
        };
        if (
          defaultCommission &&
          defaultCommission.type === commissionType &&
          Number(defaultCommission.value) === commissionValue
        ) {
          patch.commission = null;
        }
      } else {
        patch.commission = null;
      }
      if (supplyEnabled && Number.isFinite(supplyValue)) {
        const supplyType = supplyTypeInput?.value === 'percentage' ? 'percentage' : 'fixed';
        patch.supplyDeduction = {
          enabled: true,
          type: supplyType,
          value: supplyValue
        };
        if (
          defaultSupplyDeduction &&
          defaultSupplyDeduction.type === supplyType &&
          Number(defaultSupplyDeduction.value) === supplyValue
        ) {
          patch.supplyDeduction = null;
        }
      } else {
        patch.supplyDeduction = defaultSupplyDeduction ? { enabled: false } : null;
      }
      if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '0.7'; }
      try {
        await saveServiceStaffOverride(service, staffId, patch);
        const catalogData = ticketsState._ffCatalogModalMode === 'shared'
          ? getSharedServicesForCatalogManager()
          : getLocationServicesForCatalogManager();
        renderServicesScreenDetail(catalogData.services || [], catalogData.categories || []);
        if (typeof setupTicketsUI === 'function') setupTicketsUI();
        showToast('Staff settings updated', 'success');
      } catch (e) {
        showToast(e?.message || 'Failed', 'error');
      } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.style.opacity = '1'; }
      }
    };
    if (supplyEnabledInput) {
      supplyEnabledInput.addEventListener('change', () => {
        if (supplyFields) supplyFields.style.display = supplyEnabledInput.checked ? 'grid' : 'none';
      });
    }
    if (supplyTypeInput && supplyValueInput) {
      supplyTypeInput.addEventListener('change', () => {
        supplyValueInput.placeholder = supplyTypeInput.value === 'percentage' ? '15' : '30';
      });
    }
    if (enabledInput) enabledInput.addEventListener('change', saveStaff);
    if (saveBtn) {
      saveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        saveStaff();
      });
    }
  });
}

function _ffShowServicesCategoryDetailMenu(anchorBtn, catId) {
  _ffCloseAllPopovers();
  const isSharedCatalog = ticketsState._ffCatalogModalMode === 'shared';
  const catalogData = isSharedCatalog ? getSharedServicesForCatalogManager() : getLocationServicesForCatalogManager();
  const cat = catalogData.categories.find((c) => String(c.id) === String(catId));
  if (!cat) return;
  const pop = _ffBuildPopover(anchorBtn, [
    { label: 'Delete Category', danger: true, onClick: async () => {
      const count = (catalogData.services || []).filter((s) => String(s.categoryId) === String(catId)).length;
      if (count > 0) {
        showToast(`Cannot delete: ${count} service(s) use this category.`, 'error');
        return;
      }
      const ok = await ticketConfirm(`Delete "${cat.name}"?`, 'Delete category');
      if (!ok) return;
      try {
        if (isSharedCatalog) {
          await deleteSharedServiceCategory(cat.docId || catId);
          await loadSharedCatalogForManager();
        } else {
          await deleteServiceCategory(catId);
          await Promise.all([loadServiceCategories(), loadServices()]);
        }
        ticketsState._ffSelectedCategoryId = null;
        ticketsState._ffOpenCats.delete(catId);
        renderServicesCatalogV2();
        showToast('Category deleted', 'success');
      } catch (e) {
        showToast(e?.message || 'Failed', 'error');
      }
    }},
  ]);
  document.body.appendChild(pop);
}

/** Small popover menu for a category row. */
function _ffShowCategoryMenu(anchorBtn, catId) {
  _ffCloseAllPopovers();
  if (!ffCanManageServices()) return;
  const isSharedCatalog = ticketsState._ffCatalogModalMode === 'shared';
  const catalogData = isSharedCatalog ? getSharedServicesForCatalogManager() : getLocationServicesForCatalogManager();
  const cat = catalogData.categories.find((c) => c.id === catId);
  if (!cat) return;
  if (isSharedCatalog) {
    const pop = _ffBuildPopover(anchorBtn, [
      { label: 'Rename category', onClick: () => _ffCatalogEditorOpen({ mode: 'shared-category-edit', categoryId: catId }) },
      { label: 'Delete category', danger: true, onClick: async () => {
        const count = catalogData.services.filter((s) => s.categoryId === catId).length;
        if (count > 0) {
          showToast(`Cannot delete: ${count} service(s) use this category.`, 'error');
          return;
        }
        const ok = await ticketConfirm(`Delete "${cat.name}"?`, 'Delete category');
        if (!ok) return;
        try {
          await deleteSharedServiceCategory(cat.docId || catId);
          await loadSharedCatalogForManager();
          ticketsState._ffOpenCats.delete(catId);
          renderServicesCatalogV2();
          showToast('Category deleted', 'success');
        } catch (e) { showToast(e?.message || 'Failed', 'error'); }
      }},
    ]);
    document.body.appendChild(pop);
    return;
  }
  const pop = _ffBuildPopover(anchorBtn, [
    { label: 'Rename category', onClick: () => _ffCatalogEditorOpen({ mode: 'category-edit', categoryId: catId }) },
    { label: 'Delete category', danger: true, onClick: async () => {
      const ok = await ticketConfirm(`Delete "${cat.name}"? Services inside must be moved first.`, 'Delete category');
      if (!ok) return;
      try {
        await deleteServiceCategory(catId);
        await Promise.all([loadServiceCategories(), loadServices()]);
        ticketsState._ffOpenCats.delete(catId);
        renderServicesCatalogV2();
    setupTicketsUI();
        showToast('Category deleted', 'success');
  } catch (e) { showToast(e?.message || 'Failed', 'error'); }
    }},
  ]);
  document.body.appendChild(pop);
}

/** Small popover menu for a service row. */
function _ffShowServiceMenu(anchorBtn, svcId) {
  _ffCloseAllPopovers();
  if (!ffCanManageServices()) return;
  const isSharedCatalog = ticketsState._ffCatalogModalMode === 'shared';
  const svc = isSharedCatalog
    ? getSharedServicesForCatalogManager().services.find((s) => s.id === svcId)
    : ticketsState.salonServices.find((s) => s.id === svcId);
  if (!svc) return;
  const items = [
    { label: 'Edit service', onClick: () => {
      if (_ffIsServicesScreenRoot()) {
        ticketsState._ffSelectedServiceId = svcId;
        ticketsState._ffSelectedCategoryId = null;
        ticketsState._ffServicesInlineEditServiceId = svcId;
        renderServicesCatalogV2();
      } else {
        _ffCatalogEditorOpen({ mode: isSharedCatalog ? 'shared-service-edit' : 'service-edit', serviceId: svcId });
      }
    } },
  ];
  if (isSharedCatalog) {
    items.push({ label: 'Delete service', danger: true, onClick: async () => {
      const ok = await ticketConfirm('Are you sure you want to delete this service?', 'Delete service');
      if (!ok) return;
      try {
        await deleteSharedService(svcId);
        if (ticketsState._ffSelectedServiceId === svcId) ticketsState._ffSelectedServiceId = null;
        await loadSharedCatalogForManager();
        renderServicesCatalogV2();
        setupTicketsUI();
        showToast('Service deleted', 'success');
      } catch (e) { showToast(e?.message || 'Failed', 'error'); }
    }});
    const pop = _ffBuildPopover(anchorBtn, items);
    document.body.appendChild(pop);
    return;
  }
  // Offer a "Move to…" shortcut for keyboards / touch devices where HTML5
  // drag-and-drop isn't available. Only appears when there's somewhere
  // meaningful to move to (another real category).
  const otherCats = ticketsState.serviceCategories.filter((c) => c.id !== svc.categoryId);
  if (otherCats.length > 0) {
    items.push({ label: 'Move to category…', onClick: () => _ffShowMoveServicePicker(anchorBtn, svcId) });
  }
  items.push({ label: 'Delete service', danger: true, onClick: async () => {
    const ok = await ticketConfirm('Are you sure you want to delete this service?', 'Delete service');
    if (!ok) return;
    try {
      await deleteService(svcId);
      await loadServices();
      renderServicesCatalogV2();
          setupTicketsUI();
      showToast('Service deleted', 'success');
        } catch (e) { showToast(e?.message || 'Failed', 'error'); }
  }});
  const pop = _ffBuildPopover(anchorBtn, items);
  document.body.appendChild(pop);
}

/** Secondary popover: list of categories to move the service into. */
function _ffShowMoveServicePicker(anchorBtn, svcId) {
  _ffCloseAllPopovers();
  const svc = ticketsState.salonServices.find((s) => s.id === svcId);
  if (!svc) return;
  const items = ticketsState.serviceCategories
    .filter((c) => c.id !== svc.categoryId)
    .map((c) => ({
      label: c.name,
      onClick: async () => {
        try {
          await _ffMoveServiceToCategoryEnd(svcId, c.id);
          showToast(`Moved to "${c.name}"`, 'success');
        } catch (e) { showToast(e?.message || 'Failed', 'error'); }
      },
    }));
  if (items.length === 0) return;
  const pop = _ffBuildPopover(anchorBtn, items);
  document.body.appendChild(pop);
}

function _ffCloseAllPopovers() {
  document.querySelectorAll('.ffcat-popover').forEach((el) => el.remove());
}

/** Creates a small floating popover anchored near `anchorBtn`. */
function _ffBuildPopover(anchorBtn, items) {
  const pop = document.createElement('div');
  pop.className = 'ffcat-popover';
  const rect = anchorBtn.getBoundingClientRect();
  pop.style.cssText = `position:fixed;top:${rect.bottom + 4}px;left:${Math.max(8, rect.right - 160)}px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,0.12);padding:4px;min-width:160px;z-index:2147483500;`;
  items.forEach(({ label, danger, onClick }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = `display:block;width:100%;text-align:left;padding:8px 12px;border:none;background:none;cursor:pointer;font-size:13px;color:${danger ? '#ef4444' : '#111'};border-radius:6px;`;
    b.addEventListener('mouseenter', () => { b.style.background = danger ? '#fef2f2' : '#f3f4f6'; });
    b.addEventListener('mouseleave', () => { b.style.background = 'none'; });
    b.addEventListener('click', () => { _ffCloseAllPopovers(); onClick?.(); });
    pop.appendChild(b);
  });
  // Auto-close on outside click (pop may be removed earlier — ignore stale listeners so nested menus work)
  setTimeout(() => {
    const off = (e) => {
      if (!pop.isConnected) {
        document.removeEventListener('mousedown', off, true);
        return;
      }
      if (!pop.contains(e.target)) {
        _ffCloseAllPopovers();
        document.removeEventListener('mousedown', off, true);
      }
    };
    document.addEventListener('mousedown', off, true);
  }, 0);
  return pop;
}

// ---------- Drag-and-drop reordering ----------
// Categories are reordered by dragging their header onto another header.
// Services are reordered within a category by dragging one row onto another,
// or moved across categories by dropping on another category's services or
// directly on a category header (which appends the service to the end of
// that category). Firestore writes update `sortOrder` for every sibling
// affected; the onSnapshot subscription re-renders the UI.

/** @type {{kind:'category'|'service', catId:string|null, svcId:string|null}|null} */

function _ffClearDragHover() {
  if (ticketsState._ffDragHoverEl) {
    ticketsState._ffDragHoverEl.style.boxShadow = '';
    ticketsState._ffDragHoverEl.style.background = ticketsState._ffDragHoverEl._ffPrevBg || '';
    ticketsState._ffDragHoverEl._ffPrevBg = undefined;
    ticketsState._ffDragHoverEl = null;
  }
}

function _ffWireCatalogDragDrop(listEl) {
  // The list is re-rendered on every snapshot, so wire once per render by
  // attaching to the fresh listEl. No need for idempotence.
  listEl.addEventListener('dragstart', (e) => {
    const row = e.target.closest('[data-drag-kind]');
    if (!row) return;
    ticketsState._ffDragSrc = {
      kind: row.getAttribute('data-drag-kind'),
      catId: row.getAttribute('data-cat-id') || null,
      svcId: row.getAttribute('data-svc-id') || null,
    };
    try {
      e.dataTransfer.effectAllowed = 'move';
      // Firefox needs data set for dragstart to actually begin.
      e.dataTransfer.setData('text/plain', ticketsState._ffDragSrc.svcId || ticketsState._ffDragSrc.catId || '');
    } catch (_) {}
    row.style.opacity = '0.4';
  });

  listEl.addEventListener('dragend', (e) => {
    const row = e.target.closest('[data-drag-kind]');
    if (row) row.style.opacity = '';
    _ffClearDragHover();
    ticketsState._ffDragSrc = null;
  });

  listEl.addEventListener('dragover', (e) => {
    if (!ticketsState._ffDragSrc) return;
    let hl = null;
    if (ticketsState._ffDragSrc.kind === 'category') {
      const targetHead = e.target.closest('.ffcat-head[data-drag-kind="category"]');
      if (targetHead && targetHead.getAttribute('data-cat-id') !== ticketsState._ffDragSrc.catId) {
        hl = targetHead;
      }
    } else if (ticketsState._ffDragSrc.kind === 'service') {
      const targetSvc = e.target.closest('.ffsvc-row');
      const targetHead = e.target.closest('.ffcat-head[data-drag-kind="category"]');
      if (targetSvc && targetSvc.getAttribute('data-svc-id') !== ticketsState._ffDragSrc.svcId) {
        hl = targetSvc;
      } else if (targetHead) {
        hl = targetHead;
      }
    }
    if (hl) {
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
      if (hl !== ticketsState._ffDragHoverEl) {
        _ffClearDragHover();
        ticketsState._ffDragHoverEl = hl;
        if (hl.classList.contains('ffcat-head')) {
          hl._ffPrevBg = hl.style.background;
          hl.style.background = '#ede9fe';
        } else {
          // inset box-shadow avoids the layout jitter a real border would cause.
          hl.style.boxShadow = 'inset 0 2px 0 0 #7c3aed';
        }
      }
    } else if (ticketsState._ffDragHoverEl) {
      _ffClearDragHover();
    }
  });

  listEl.addEventListener('drop', async (e) => {
    if (!ticketsState._ffDragSrc) return;
    e.preventDefault();
    const src = ticketsState._ffDragSrc;
    _ffClearDragHover();
    ticketsState._ffDragSrc = null;
    try {
      if (src.kind === 'category') {
        const targetHead = e.target.closest('.ffcat-head[data-drag-kind="category"]');
        const dstId = targetHead?.getAttribute('data-cat-id');
        if (dstId && dstId !== src.catId) {
          await _ffReorderCategoriesBefore(src.catId, dstId);
        }
      } else if (src.kind === 'service') {
        const targetSvc = e.target.closest('.ffsvc-row');
        const targetHead = e.target.closest('.ffcat-head[data-drag-kind="category"]');
        if (targetSvc && targetSvc.getAttribute('data-svc-id') !== src.svcId) {
          const beforeSvcId = targetSvc.getAttribute('data-svc-id');
          const targetCatId = targetSvc.getAttribute('data-cat-id');
          await _ffReorderServiceBefore(src.svcId, beforeSvcId, targetCatId);
        } else if (targetHead) {
          const targetCatId = targetHead.getAttribute('data-cat-id');
          await _ffMoveServiceToCategoryEnd(src.svcId, targetCatId);
        }
      }
    } catch (err) {
      console.error('[Tickets] Reorder failed', err);
      showToast(err?.message || 'Reorder failed', 'error');
    }
  });
}

/** Move `srcId` so it lands immediately before `beforeId` in the category
 *  order, then persist a fresh sortOrder (0,1,2,…) to every category. */
async function _ffReorderCategoriesBefore(srcId, beforeId) {
  const arr = [...ticketsState.serviceCategories];
  const srcIdx = arr.findIndex(c => c.id === srcId);
  if (srcIdx < 0) return;
  const [moved] = arr.splice(srcIdx, 1);
  const dstIdx = arr.findIndex(c => c.id === beforeId);
  arr.splice(dstIdx >= 0 ? dstIdx : arr.length, 0, moved);
  await Promise.all(arr.map((c, idx) => saveServiceCategory({ id: c.id, name: c.name, sortOrder: idx })));
}

/** Service reorder: insert `srcId` before `beforeSvcId` inside `targetCatId`
 *  (same or different category from source). Rewrites sortOrder for every
 *  service in the target bucket. If `targetCatId` is the virtual "Other"
 *  bucket, bail out — it isn't a real category. */
async function _ffReorderServiceBefore(srcId, beforeSvcId, targetCatId) {
  if (!targetCatId || targetCatId === '__other__') return;
  const src = ticketsState.salonServices.find(s => s.id === srcId);
  if (!src) return;
  const siblings = ticketsState.salonServices
    .filter(s => s.categoryId === targetCatId && s.id !== srcId)
    .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
  const beforeIdx = siblings.findIndex(s => s.id === beforeSvcId);
  siblings.splice(beforeIdx >= 0 ? beforeIdx : siblings.length, 0, src);
  await Promise.all(siblings.map((s, idx) => saveService({
    id: s.id,
    name: s.name,
    categoryId: targetCatId,
    defaultPrice: s.defaultPrice || 0,
    sortOrder: idx,
  })));
}

/** Drop on a category header = move the service to the END of that category. */
async function _ffMoveServiceToCategoryEnd(srcId, targetCatId) {
  if (!targetCatId || targetCatId === '__other__') return;
  const src = ticketsState.salonServices.find(s => s.id === srcId);
  if (!src) return;
  if (src.categoryId === targetCatId) return;
  const siblings = ticketsState.salonServices
    .filter(s => s.categoryId === targetCatId)
    .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
  const lastOrder = siblings.length > 0 ? (siblings[siblings.length - 1].sortOrder ?? siblings.length - 1) : -1;
  await saveService({
    id: src.id,
    name: src.name,
    categoryId: targetCatId,
    defaultPrice: src.defaultPrice || 0,
    sortOrder: lastOrder + 1,
  });
  ticketsState._ffOpenCats.add(targetCatId);
}

// ---------- Shared mini editor modal (Add/Edit category or service) ----------

/** Shape: { mode: 'category-add'|'category-edit'|'service-add'|'service-edit', categoryId?, serviceId? } */
function _ffCatalogEditorOpen(opts) {
  const mod = document.getElementById('servicesCatalogEditorModal');
  if (!mod) return;
  const title = document.getElementById('servicesCatalogEditorTitle');
  const wrapCat = document.getElementById('servicesCatalogEditorCatWrap');
  const wrapPrice = document.getElementById('servicesCatalogEditorPriceWrap');
  const nameInp = document.getElementById('servicesCatalogEditorName');
  const catSel = document.getElementById('servicesCatalogEditorCategory');
  const catTextInp = document.getElementById('servicesCatalogEditorCategoryText');
  const priceInp = document.getElementById('servicesCatalogEditorPrice');
  const activeWrap = document.getElementById('servicesCatalogEditorActiveWrap');
  const activeInp = document.getElementById('servicesCatalogEditorActive');
  const overrideWrap = document.getElementById('servicesCatalogOverrideWrap');
  const overrideDefault = document.getElementById('servicesCatalogOverrideDefault');
  const overrideCustom = document.getElementById('servicesCatalogOverrideCustom');
  const overridePriceInp = document.getElementById('servicesCatalogOverridePrice');
  const saveBtn = document.getElementById('servicesCatalogEditorSave');
  if (!title || !nameInp || !saveBtn) return;

  // Reset visibility + fields
  wrapCat.style.display = 'none';
  wrapPrice.style.display = 'none';
  nameInp.value = '';
  nameInp.placeholder = '';
  priceInp.value = '';
  catSel.innerHTML = '';
  if (catSel) catSel.style.display = 'block';
  if (catTextInp) { catTextInp.style.display = 'none'; catTextInp.value = ''; }
  if (activeWrap) activeWrap.style.display = 'none';
  if (activeInp) activeInp.checked = true;
  if (overrideWrap) overrideWrap.style.display = 'none';
  if (overrideDefault) overrideDefault.checked = true;
  if (overrideCustom) overrideCustom.checked = false;
  if (overridePriceInp) { overridePriceInp.style.display = 'none'; overridePriceInp.value = ''; }
  saveBtn.disabled = false;
  saveBtn.style.opacity = '1';

  const ctx = { ...opts };

  if (opts.mode === 'category-add' || opts.mode === 'shared-category-add') {
    title.textContent = 'New category';
    nameInp.placeholder = 'Category name (e.g. Manicure)';
  } else if (opts.mode === 'category-edit' || opts.mode === 'shared-category-edit') {
    const c = opts.mode === 'shared-category-edit'
      ? getSharedServicesForCatalogManager().categories.find((x) => x.id === opts.categoryId)
      : ticketsState.serviceCategories.find((x) => x.id === opts.categoryId);
    if (!c) return;
    title.textContent = 'Rename category';
    nameInp.placeholder = 'Category name';
    nameInp.value = c.name || '';
    ctx.existing = c;
  } else if (opts.mode === 'service-add' || opts.mode === 'service-edit' || opts.mode === 'shared-service-add' || opts.mode === 'shared-service-edit') {
    const isSharedServiceMode = opts.mode === 'shared-service-add' || opts.mode === 'shared-service-edit';
    title.textContent = opts.mode === 'service-add' || opts.mode === 'shared-service-add' ? 'New service' : 'Edit service';
    nameInp.placeholder = 'Service name (e.g. Gel Full Set)';
    wrapCat.style.display = 'block';
    wrapPrice.style.display = 'block';
    priceInp.placeholder = isSharedServiceMode ? `Default price (${ffTicketCurSym()})` : `Default price (${ffTicketCurSym()})`;
    if (isSharedServiceMode) {
      if (catSel) catSel.style.display = 'none';
      if (catTextInp) {
        catTextInp.style.display = 'block';
        catTextInp.placeholder = 'Category (e.g. Manicure)';
        catTextInp.value = opts.categoryName || '';
      }
      if (activeWrap) activeWrap.style.display = 'flex';
      if (overrideWrap && opts.mode === 'shared-service-edit') overrideWrap.style.display = 'block';
      const syncOverrideInput = () => {
        if (!overridePriceInp) return;
        overridePriceInp.style.display = overrideCustom?.checked ? 'block' : 'none';
      };
      if (overrideDefault) overrideDefault.onchange = syncOverrideInput;
      if (overrideCustom) overrideCustom.onchange = syncOverrideInput;
    } else {
      // Populate category dropdown for the existing location fallback catalog.
      let optsHtml = '';
      ticketsState.serviceCategories.forEach((c) => { optsHtml += `<option value="${c.id}">${escapeHtml(c.name)}</option>`; });
      catSel.innerHTML = optsHtml;
    }
    if (opts.mode === 'service-edit' || opts.mode === 'shared-service-edit') {
      const s = isSharedServiceMode
        ? getSharedServicesForCatalogManager().services.find((x) => x.id === opts.serviceId)
        : ticketsState.salonServices.find((x) => x.id === opts.serviceId);
      if (!s) return;
      if (isSharedServiceMode) console.log('[SharedServicesUI] editing shared service', { serviceId: s.id });
      nameInp.value = s.name || '';
      priceInp.value = isSharedServiceMode
        ? (s.sharedDefaultPrice != null ? String(s.sharedDefaultPrice) : '')
        : (s.defaultPrice != null ? String(s.defaultPrice) : '');
      if (isSharedServiceMode) {
        if (catTextInp) catTextInp.value = s.category || '';
        if (activeInp) activeInp.checked = s.active !== false;
        if (s.hasOverride) {
          if (overrideCustom) overrideCustom.checked = true;
          if (overrideDefault) overrideDefault.checked = false;
          if (overridePriceInp) {
            overridePriceInp.value = String(s.overridePrice ?? '');
            overridePriceInp.style.display = 'block';
          }
        }
      } else if (s.categoryId && ticketsState.serviceCategories.some((c) => c.id === s.categoryId)) {
        catSel.value = s.categoryId;
      }
      ctx.existing = s;
    } else if (!isSharedServiceMode) {
      if (opts.categoryId && ticketsState.serviceCategories.some((c) => c.id === opts.categoryId)) {
        catSel.value = opts.categoryId;
      }
    }
  }

  saveBtn.onclick = () => _ffCatalogEditorSubmit(ctx);
  nameInp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); _ffCatalogEditorSubmit(ctx); } };
  mod.style.display = 'flex';
  setTimeout(() => { try { nameInp.focus(); nameInp.select(); } catch (_) {} }, 50);
}

function _ffCatalogEditorClose() {
  const mod = document.getElementById('servicesCatalogEditorModal');
  if (mod) mod.style.display = 'none';
}

async function _ffCatalogEditorSubmit(ctx) {
  const nameInp = document.getElementById('servicesCatalogEditorName');
  const catSel = document.getElementById('servicesCatalogEditorCategory');
  const catTextInp = document.getElementById('servicesCatalogEditorCategoryText');
  const priceInp = document.getElementById('servicesCatalogEditorPrice');
  const activeInp = document.getElementById('servicesCatalogEditorActive');
  const overrideCustom = document.getElementById('servicesCatalogOverrideCustom');
  const overridePriceInp = document.getElementById('servicesCatalogOverridePrice');
  const saveBtn = document.getElementById('servicesCatalogEditorSave');
  const name = String(nameInp?.value || '').trim();
  const flashErr = (el) => {
    try {
      const prev = el.style.borderColor;
      el.style.borderColor = '#ef4444';
      el.focus();
      setTimeout(() => { el.style.borderColor = prev || '#e5e7eb'; }, 1400);
    } catch (_) {}
  };
  if (!name) { flashErr(nameInp); return; }

  if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '0.6'; }
  try {
    if (ctx.mode === 'category-add') {
      await saveServiceCategory({ name, sortOrder: ticketsState.serviceCategories.length });
      await Promise.all([loadServiceCategories(), loadServices()]);
      showToast('Category added', 'success');
    } else if (ctx.mode === 'category-edit') {
      const c = ctx.existing;
      await saveServiceCategory({ id: c.id, name, sortOrder: c.sortOrder });
      await Promise.all([loadServiceCategories(), loadServices()]);
      showToast('Updated', 'success');
    } else if (ctx.mode === 'shared-category-add') {
      const data = getSharedServicesForCatalogManager();
      const categoryId = await saveSharedServiceCategory({ name, sortOrder: data.categories.length });
      await loadSharedCatalogForManager();
      ticketsState._ffOpenCats.add(categoryId);
      showToast('Category added', 'success');
    } else if (ctx.mode === 'shared-category-edit') {
      const c = ctx.existing;
      const oldName = normalizeSharedCategoryName(c.name);
      const newName = normalizeSharedCategoryName(name);
      await saveSharedServiceCategory({ id: c.docId || c.id, name: newName, sortOrder: c.sortOrder });
      if (oldName !== newName) {
        const affected = ticketsState._rawSharedServices.filter((s) => normalizeSharedCategoryName(s.category) === oldName);
        await Promise.all(affected.map((s) => saveSharedService({
          id: s.id,
          name: s.name,
          category: newName,
          defaultPrice: s.defaultPrice,
          active: s.active !== false,
          sortOrder: s.sortOrder
        })));
      }
      await loadSharedCatalogForManager();
      ticketsState._ffOpenCats.add(sharedCategoryId(newName));
      showToast('Category updated', 'success');
    } else if (ctx.mode === 'service-add') {
      const categoryId = catSel?.value || null;
      const defaultPrice = parseFloat(priceInp?.value) || 0;
      await saveService({ name, categoryId, defaultPrice });
      await Promise.all([loadServiceCategories(), loadServices()]);
      if (categoryId) ticketsState._ffOpenCats.add(categoryId);
      showToast('Service added', 'success');
    } else if (ctx.mode === 'service-edit') {
      const s = ctx.existing;
      const categoryId = catSel?.value || null;
      const defaultPrice = parseFloat(priceInp?.value) || 0;
      await saveService({ id: s.id, name, categoryId, defaultPrice, sortOrder: s.sortOrder });
      await Promise.all([loadServiceCategories(), loadServices()]);
      if (categoryId) ticketsState._ffOpenCats.add(categoryId);
      showToast('Updated', 'success');
    } else if (ctx.mode === 'shared-service-add' || ctx.mode === 'shared-service-edit') {
      const s = ctx.existing || {};
      const category = normalizeSharedCategoryName(catTextInp?.value || s.category || '');
      const defaultPrice = parseFloat(priceInp?.value) || 0;
      const overridePrice = parseFloat(overridePriceInp?.value);
      if (ctx.mode === 'shared-service-edit' && overrideCustom?.checked && !Number.isFinite(overridePrice)) {
        flashErr(overridePriceInp);
        return;
      }
      const serviceId = await saveSharedService({
        id: s.id,
        name,
        category,
        defaultPrice,
        active: activeInp ? activeInp.checked : true,
        sortOrder: s.sortOrder
      });
      if (ctx.mode === 'shared-service-edit') {
        if (overrideCustom?.checked) {
          await saveSharedServiceOverride(serviceId, overridePrice);
        } else {
          await removeSharedServiceOverride(serviceId);
        }
      }
      await loadSharedCatalogForManager();
      ticketsState._ffOpenCats.add(sharedCategoryId(category));
      showToast(ctx.mode === 'shared-service-add' ? 'Service added' : 'Service updated', 'success');
    }
    _ffCatalogEditorClose();
    renderServicesCatalogV2();
    setupTicketsUI();
  } catch (e) {
    showToast(e?.message || 'Failed', 'error');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.style.opacity = '1'; }
  }
}

/** Entry from header "+ Add Category" button. */
function addServiceCategoryV2() {
  if (!ffCanManageServices()) { if (typeof showToast === 'function') showToast('You do not have permission to manage services.', 'error'); return; }
  _ffCatalogEditorOpen({ mode: ticketsState._ffCatalogModalMode === 'shared' ? 'shared-category-add' : 'category-add' });
}

/** Entry from header "+ Add Service" button. */
function addSharedServiceV2() {
  if (!ffCanManageServices()) { if (typeof showToast === 'function') showToast('You do not have permission to manage services.', 'error'); return; }
  _ffCatalogEditorOpen({ mode: 'shared-service-add' });
}

// =====================
// Navigation
// =====================
export function goToTickets() {
  const _ticketsLoadState =
    typeof window.ffStaffPermissionLoadState === 'function' ? window.ffStaffPermissionLoadState() : 'ready';
  const _ticketsTrustPerm =
    _ticketsLoadState === 'staff_loading' || _ticketsLoadState === 'staff_unresolved';
  const _ticketsPermOk =
    _ticketsTrustPerm ||
    (typeof window.ffCurrentUserHasTicketsViewPermission === 'function' &&
      window.ffCurrentUserHasTicketsViewPermission());
  if (!_ticketsPermOk) {
    if (typeof window.ffUpdateMainNavTabVisibility === 'function') window.ffUpdateMainNavTabVisibility();
    return;
  }
  if (typeof window.ffCloseGlobalBlockingOverlays === 'function') {
    try {
      window.ffCloseGlobalBlockingOverlays();
    } catch (e) {}
  }
  if (typeof window.closeStaffMembersModal === 'function') {
    window.closeStaffMembersModal();
  }
  const tasksScreen = document.getElementById('tasksScreen');
  const ownerView = document.getElementById('owner-view');
  const joinBar = document.querySelector('.joinBar');
  const queueControls = document.getElementById('queueControls');
  const userProfileScreen = document.getElementById('userProfileScreen');
  const wrap = document.querySelector('.wrap');
  const inboxScreen = document.getElementById('inboxScreen');
  const chatScreen = document.getElementById('chatScreen');
  const mediaScreen = document.getElementById('mediaScreen');
  const trainingScreen = document.getElementById('trainingScreen');
  const scheduleScreen = document.getElementById('scheduleScreen');
  const timeClockScreenTk = document.getElementById('timeClockScreen');
  const ticketsScreen = document.getElementById('ticketsScreen');
  const servicesScreen = document.getElementById('servicesScreen');

  const manageQueueScreen = document.getElementById('manageQueueScreen');
  [tasksScreen, ownerView, joinBar, queueControls, userProfileScreen, inboxScreen, chatScreen, mediaScreen, trainingScreen, scheduleScreen, timeClockScreenTk, servicesScreen, manageQueueScreen].forEach(el => {
    if (el) el.style.display = 'none';
  });
  if (wrap) wrap.style.display = 'none';

  try {
    if (typeof window.ffSyncShellHeaderInset === 'function') {
      window.ffSyncShellHeaderInset();
    } else {
      const headerEl = document.querySelector('.header');
      if (headerEl) {
        document.documentElement.style.setProperty('--header-h', `${headerEl.offsetHeight}px`);
      }
    }
  } catch (e) {}

  if (ticketsScreen) {
    ticketsScreen.style.display = 'flex';
    ticketsScreen.style.setProperty('pointer-events', 'auto', 'important');
  }

  // When any other nav button is clicked, hide the screen but keep subscription alive
  // so the red Tickets badge updates even while the user is in Queue/Tasks/Chat.
  const NAV_IDS = ['queueBtn','tasksBtn','chatBtn','inboxBtn','logBtn','appsBtn'];
  NAV_IDS.forEach(id => {
    const btn = document.getElementById(id);
    if (btn && !btn._ffTicketsHideHandler) {
      btn._ffTicketsHideHandler = () => {
        if (ticketsScreen) ticketsScreen.style.display = 'none';
        updateTicketsNavBadge();
      };
      btn.addEventListener('click', btn._ffTicketsHideHandler, { capture: true });
    }
  });

  document.querySelectorAll('.btn-pill').forEach(b => b.classList.remove('active'));
  const ticketsBtn = document.getElementById('ticketsBtn');
  if (ticketsBtn && _ticketsPermOk) {
    ticketsBtn.classList.add('active');
  }
  if (typeof window.ffUpdateMainNavTabVisibility === 'function') window.ffUpdateMainNavTabVisibility();
  updateNewTicketButtonVisibility();
  try {
    if (typeof window.ffSyncShellHeaderInset === 'function') window.ffSyncShellHeaderInset();
  } catch (e) {}

  if (ticketsState._ticketsDataReady && ticketsState.currentUserProfile) {
    enrichTicketsProfileFromMemberDoc()
      .then(() => {
        subscribeTickets({ resetLoading: true });
        renderTicketsList();
        updateTicketsNavBadge();
        return setupTicketsUI();
      })
      .then(() => loadTicketsMembersForAvatars())
      .then(() => {
        renderTicketsList();
        updateTicketsNavBadge();
      })
      .catch((err) => {
        console.error('[Tickets] setupTicketsUI failed', err);
      });
  } else {
    loadCurrentUserProfile()
      .then(async () => {
        await enrichTicketsProfileFromMemberDoc();
        subscribeTickets({ resetLoading: true });
        renderTicketsList();
        updateTicketsNavBadge();
        await loadServiceCategories();
        await loadServices();
        await setupTicketsUI();
        ticketsState._ticketsDataReady = true;
        await loadTicketsMembersForAvatars();
        renderTicketsList();
        updateTicketsNavBadge();
      })
      .catch((err) => {
        console.error('[Tickets] goToTickets init failed', err);
      });
  }
}

export async function goToServices() {
  if (!ffCanViewServices()) {
    if (typeof showToast === 'function') showToast('You do not have permission to view Services.', 'error');
    return;
  }
  if (typeof window.ffCloseGlobalBlockingOverlays === 'function') {
    try { window.ffCloseGlobalBlockingOverlays(); } catch (e) {}
  }
  if (typeof window.closeStaffMembersModal === 'function') {
    try { window.closeStaffMembersModal(); } catch (e) {}
  }

  const servicesScreen = document.getElementById('servicesScreen');
  if (!servicesScreen) return;

  [
    'owner-view',
    'ticketsScreen',
    'tasksScreen',
    'chatScreen',
    'inboxScreen',
    'mediaScreen',
    'inventoryScreen',
    'trainingScreen',
    'scheduleScreen',
    'timeClockScreen',
    'pointsAppScreen',
    'userProfileScreen',
    'myProfileScreen',
    'manageQueueScreen',
    'dashboardScreen',
    'queueAnalyticsScreen',
    'ticketsAnalyticsScreen',
    'timeAnalyticsScreen',
    'tasksAnalyticsScreen',
    'historyScreen'
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = 'none';
      el.style.pointerEvents = 'none';
    }
  });
  const joinBar = document.querySelector('.joinBar');
  const wrap = document.querySelector('.wrap');
  const queueControls = document.getElementById('queueControls');
  [joinBar, wrap, queueControls].forEach((el) => {
    if (el) el.style.display = 'none';
  });

  document.querySelectorAll('.btn-pill').forEach((b) => b.classList.remove('active'));
  servicesScreen.style.display = 'block';
  servicesScreen.style.pointerEvents = 'auto';
  _ffEnsureCatalogEditorPortal();
  ticketsState._ffCatalogRenderRootId = 'servicesScreen';
  ticketsState._ffCatalogModalMode = 'shared';
  ticketsState._ffOpenCats.clear();
  ticketsState._ffCatalogRenderedOnce = false;
  // Mobile: always open at the top level (the services list).
  ticketsState._ffSelectedServiceId = null;
  ticketsState._ffSelectedCategoryId = null;
  _ffServicesMobileShowList();

  try {
    if (typeof window.ffSyncShellHeaderInset === 'function') window.ffSyncShellHeaderInset();
  } catch (e) {}

  try {
    await loadCurrentUserProfile();
    await enrichTicketsProfileFromMemberDoc();
    let sharedCatalog = await loadSharedCatalogForManager();
    const backfillResult = await seedSharedServiceCatalogFromLocationCatalogIfEmpty();
    if (backfillResult && backfillResult.seeded) {
      sharedCatalog = await loadSharedCatalogForManager();
      ticketsState._ffCatalogModalMode = 'shared';
    }
    if (!sharedCatalog || ((sharedCatalog.services || []).length === 0 && (sharedCatalog.categories || []).length === 0)) {
      ticketsState._ffCatalogModalMode = 'location';
      await loadLocationCatalogForManager();
    }
    renderServicesCatalogV2();
  } catch (err) {
    console.error('[Services] Failed opening Services screen', err);
    if (typeof showToast === 'function') showToast('Service Catalog is still loading. Try again in a moment.', 'error');
  }
}

try {
  window.__ffGoToTicketsReal = goToTickets;
} catch (e) {}

function doServiceSelect(svc) {
  if (svc) addServiceToTicket(svc);
}

// =====================
// Ticket service search (UI-only filter over the already-loaded catalog)
// =====================
// Filters the SAME salonServices / serviceCategories arrays the picker renders
// from — no separate list, no duplication. Selecting a result goes through the
// exact same doServiceSelect(svc) path as the normal category list, so pricing,
// location overrides, taxes, fees and supply deductions are untouched.

function ffTicketServiceSearchClear() {
  const input = document.getElementById('ticketServiceSearchInput');
  if (input) input.value = '';
  ffRenderTicketServiceSearch();
}

function ffTicketServiceSearchSetVisible(show) {
  const wrap = document.getElementById('ticketServiceSearchWrap');
  if (wrap) wrap.style.display = show ? 'block' : 'none';
}

function ffRenderTicketServiceSearch() {
  const catalog = document.getElementById('ticketServiceCatalogList');
  const results = document.getElementById('ticketServiceSearchResults');
  if (!catalog || !results) return;

  const input = document.getElementById('ticketServiceSearchInput');
  const query = input ? String(input.value || '').trim() : '';

  // Empty query → restore the normal categories view exactly as-is.
  if (!query) {
    results.style.display = 'none';
    results.innerHTML = '';
    catalog.style.display = '';
    return;
  }

  // Multi-word partial match, case-insensitive, against service name + category
  // name ("gel mani" matches "Gel Manicure").
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const catNameById = new Map(ticketsState.serviceCategories.map((c) => [c.id, c.name]));
  const matches = ticketsState.salonServices
    .filter(isTicketPickerServiceAvailableForActiveLocation)
    .filter((s) => {
      const catLabel = catNameById.get(s.categoryId) || s.category || 'Other';
      const hay = `${String(s.name || '')} ${String(catLabel)}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });

  catalog.style.display = 'none';
  results.style.display = 'block';

  if (!matches.length) {
    results.innerHTML = '<div style="padding:10px 8px;color:#6b7280;font-size:12px;">No services found</div>';
    return;
  }

  results.innerHTML = matches.map((s) => {
    const catLabel = catNameById.get(s.categoryId) || s.category || 'Other';
    return `<button type="button" class="ticket-service-btn" data-id="${s.id}" style="display:block;width:100%;text-align:left;padding:5px 8px;margin-bottom:3px;border:1px solid #e5e7eb;border-radius:4px;background:#fff;cursor:pointer;font-size:12px;transition:background 0.15s;">${escapeHtml(s.name)} <span style="color:#6b7280;font-size:11px;">${ffTicketMoney(s.defaultPrice || 0)}</span><span style="display:block;font-size:10px;color:#9ca3af;">${escapeHtml(catLabel)}</span></button>`;
  }).join('');

  results.querySelectorAll('.ticket-service-btn').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      const svc = ticketsState.salonServices.find((x) => x.id === id);
      doServiceSelect(svc);
    };
  });
}

function ffTicketServiceSearchWire() {
  const input = document.getElementById('ticketServiceSearchInput');
  if (!input || input._ffSearchWired) return;
  input._ffSearchWired = true;
  input.addEventListener('input', ffRenderTicketServiceSearch);
}

function updateNewTicketButtonVisibility() {
  const newTicketBtn = document.getElementById('ticketsNewBtn');
  if (!newTicketBtn) return;
  if (!ticketsState.currentUserProfile) {
    newTicketBtn.style.display = 'none';
    return;
  }
  const staff = _ticketsCurrentStaffRow();
  if (staff) {
    newTicketBtn.style.display = canStaffSendNewTicket(staff) ? 'inline-flex' : 'none';
    return;
  }
  // Fallback only when the salon staff row is not hydrated yet.
  const profileRole = (ticketsState.currentUserProfile?.role || '').toLowerCase();
  newTicketBtn.style.display = ['owner', 'admin', 'manager'].includes(profileRole) ? 'none' : 'inline-flex';
}

function ensureTicketsBackgroundSubscription(attempt = 0) {
  if (!ticketsState.currentUserProfile) return;
  if (getActiveTicketsSalonId()) {
    subscribeTickets();
    return;
  }
  const loadState =
    typeof window.ffStaffPermissionLoadState === 'function' ? window.ffStaffPermissionLoadState() : 'ready';
  if (loadState === 'staff_loading' && attempt < 10) {
    setTimeout(() => ensureTicketsBackgroundSubscription(attempt + 1), 1000);
  }
}

async function setupTicketsUI() {
  const container = document.getElementById('ticketServicePickerContainer');
  if (!container) return;
  try { subscribeProductsCatalog(); } catch (_) {}
  const grouped = getServicesGroupedByCategory();
  const groupedProducts = getProductsGroupedByCategory();
  const hasServices = Object.keys(grouped).length > 0;
  const hasProducts = Object.keys(groupedProducts).length > 0;
  let html = '';
  if (!hasServices && !hasProducts) {
    container.innerHTML = '<div style="padding:10px 8px;color:#6b7280;font-size:12px;">No services or products available for this location.</div>';
    ffTicketServiceSearchSetVisible(false);
    return;
  }
  // Mirror the picker: if a catalog snapshot rebuilds the list while the modal
  // shows a read-only ticket (picker hidden), keep the search hidden too.
  ffTicketServiceSearchSetVisible(container.style.display !== 'none');
  Object.entries(grouped).forEach(([key, data], idx) => {
    const label = escapeHtml(data.label || 'Other');
    html += `<div class="ticket-category-section" data-cat-idx="${idx}" style="border-bottom:1px solid #e5e7eb;">`;
    html += `<div class="ticket-category-header" role="button" tabindex="0" style="display:flex;align-items:center;gap:4px;padding:6px 8px;cursor:pointer;user-select:none;font-size:11px;font-weight:600;color:#374151;background:#f9fafb;"><span class="ticket-cat-arrow" style="font-size:9px;color:#6b7280;">▶</span><span>${label}</span></div>`;
    html += `<div class="ticket-category-body" style="display:none;padding:4px 8px 8px 16px;background:#fff;">`;
    (data.services || []).forEach((s) => {
      html += `<button type="button" class="ticket-service-btn" data-id="${s.id}" style="display:block;width:100%;text-align:left;padding:5px 8px;margin-bottom:3px;border:1px solid #e5e7eb;border-radius:4px;background:#fff;cursor:pointer;font-size:12px;transition:background 0.15s;">${escapeHtml(s.name)} <span style="color:#6b7280;font-size:11px;">${ffTicketMoney(s.defaultPrice || 0)}</span></button>`;
    });
    html += '</div></div>';
  });
  if (hasProducts) {
    html += `<div style="padding:6px 8px;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#9ca3af;background:#f3f4f6;border-bottom:1px solid #e5e7eb;">Products</div>`;
    Object.entries(groupedProducts).forEach(([key, data], idx) => {
      const label = escapeHtml(data.label || 'Other');
      html += `<div class="ticket-category-section" data-prod-cat-idx="${idx}" style="border-bottom:1px solid #e5e7eb;">`;
      html += `<div class="ticket-category-header" role="button" tabindex="0" style="display:flex;align-items:center;gap:4px;padding:6px 8px;cursor:pointer;user-select:none;font-size:11px;font-weight:600;color:#374151;background:#f9fafb;"><span class="ticket-cat-arrow" style="font-size:9px;color:#6b7280;">▶</span><span>${label}</span></div>`;
      html += `<div class="ticket-category-body" style="display:none;padding:4px 8px 8px 16px;background:#fff;">`;
      (data.products || []).forEach((p) => {
        html += `<button type="button" class="ticket-product-btn" data-id="${p.id}" style="display:block;width:100%;text-align:left;padding:5px 8px;margin-bottom:3px;border:1px solid #e5e7eb;border-radius:4px;background:#fff;cursor:pointer;font-size:12px;transition:background 0.15s;">${escapeHtml(p.name)} <span style="color:#6b7280;font-size:11px;">${ffTicketMoney(getTicketPriceForProductAndActiveLocation(p))}</span></button>`;
      });
      html += '</div></div>';
    });
  }
  // Wrap the normal categories view so the search can toggle it without
  // touching its content; results render into a sibling div inside the same
  // scrollable container.
  container.innerHTML = `<div id="ticketServiceCatalogList">${html}</div><div id="ticketServiceSearchResults" style="display:none;padding:4px 8px;background:#fff;"></div>`;
  ffTicketServiceSearchWire();
  ffRenderTicketServiceSearch();
  container.querySelectorAll('.ticket-service-btn').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      const svc = ticketsState.salonServices.find((x) => x.id === id);
      doServiceSelect(svc);
    };
  });
  container.querySelectorAll('.ticket-product-btn').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      const prod = ticketsState.salonProducts.find((x) => x.id === id);
      if (prod) addProductToTicket(prod);
    };
  });
  container.querySelectorAll('.ticket-category-header').forEach((header) => {
    header.onclick = () => {
      const section = header.closest('.ticket-category-section');
      const body = section?.querySelector('.ticket-category-body');
      const arrow = section?.querySelector('.ticket-cat-arrow');
      if (!body || !arrow) return;
      const isOpen = body.style.display === 'block';
      body.style.display = isOpen ? 'none' : 'block';
      arrow.textContent = isOpen ? '▶' : '▼';
    };
  });
  const manageServicesBtn = document.getElementById('ticketsManageServicesBtn');
  if (manageServicesBtn) {
    // Services are now managed from the dedicated Services module (Apps → Services).
    // Hide the legacy gear shortcut on the Tickets screen to avoid two entry points.
    manageServicesBtn.style.display = 'none';
    manageServicesBtn.onclick = null;
  }
  updateTicketsTabsVisibility();
  updateNewTicketButtonVisibility();
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
