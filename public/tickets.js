/**
 * Tickets Module
 * Internal documentation of services performed + prices for POS reconciliation.
 * SEPARATE from appointments – never modifies schedule/duration/order.
 *
 * Firestore: salons/{salonId}/services (Service Catalog)
 *            salons/{salonId}/tickets
 */

import {
  collection, query, where, orderBy, limit, startAfter, documentId,
  addDoc, updateDoc, setDoc, doc, getDoc, getDocFromServer, getDocs, deleteDoc, onSnapshot,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth } from "./app.js?v=20260411_chat_reminder_attrfix";

// =====================
// State
// =====================
let currentUserProfile = null;
let salonServices = [];
let serviceCategories = [];
let currentTickets = [];
/** Real-time first page (newest). Older pages appended via Load more (not live-updated). */
const TICKETS_PAGE_SIZE = 200;
let _ticketsFirstPageTickets = [];
let _ticketsExtraTickets = [];
let _ticketsNextPageCursor = null;
let _ticketsHasMoreOlder = false;
let _ticketsLoadingMore = false;
let ticketsUnsubscribe = null;
let _ticketsDataReady = false; // cache flag — skip Firestore re-fetch on repeat visits
let currentTicketsTab = 'ready';
let editingTicketId = null;
let ticketFormAsIsMode = false;
/** When set, opening this ticket (e.g. from list) must not show Ticket Details – we just closed it. */
let _justClosedTicketId = null;
/** Cache for member avatars (uid/staffId -> { avatarUrl, avatarUpdatedAtMs }) for ticket list. */
let _ticketsMembersAvatarCache = null;
/** Secondary lookup by normalized display name (when older tickets lack technicianStaffId). */
let _ticketsMembersAvatarByName = null;

function normalizeTicketTechName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}
/** Ticket IDs opened this session (so badge count drops immediately without waiting for Firestore). */
let _ticketsOpenedThisSession = new Set();
/** After subscribeTickets, hide list until first Firestore snapshot (avoids empty→full flicker). */
let _ticketsListSnapshotReady = false;

// =====================
// User Profile
// =====================
async function loadCurrentUserProfile() {
  const user = auth.currentUser;
  if (!user) return null;
  _frontDeskCache = null; // reset on profile load
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (userDoc.exists()) {
      const data = userDoc.data();
      currentUserProfile = { uid: user.uid, ...data };
      if (!currentUserProfile.salonId && typeof window !== 'undefined' && window.currentSalonId) {
        currentUserProfile.salonId = window.currentSalonId;
        console.log('[Tickets] Using window.currentSalonId fallback:', window.currentSalonId);
      }
      return currentUserProfile;
    }
  } catch (err) {
    console.error('[Tickets] Failed to load user profile', err);
  }
  return null;
}

/** If users/{uid} lacks staffId, copy from salons/{salonId}/members/{uid} so staff-store permission match works. */
async function enrichTicketsProfileFromMemberDoc() {
  if (!currentUserProfile?.uid) return;
  const salonId = currentUserProfile.salonId || (typeof window !== 'undefined' && window.currentSalonId);
  if (!salonId) return;
  if (currentUserProfile.staffId != null && String(currentUserProfile.staffId).trim() !== '') return;
  try {
    const ms = await getDoc(doc(db, `salons/${salonId}/members`, currentUserProfile.uid));
    if (!ms.exists()) return;
    const sid = (ms.data() || {}).staffId;
    if (sid != null && String(sid).trim() !== '') {
      currentUserProfile.staffId = String(sid).trim();
    }
  } catch (_) {}
}

/** Load members with avatarUrl for ticket list avatars. */
async function loadTicketsMembersForAvatars() {
  const salonId = currentUserProfile?.salonId || (typeof window !== 'undefined' && window.currentSalonId);
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
    _ticketsMembersAvatarCache = byKey;
    _ticketsMembersAvatarByName = byName;
  } catch (e) {
    console.warn('[Tickets] loadTicketsMembersForAvatars failed', e);
    _ticketsMembersAvatarCache = {};
    _ticketsMembersAvatarByName = {};
  }
}

/** Refresh avatar cache and re-render — call when returning to Tickets or when avatars may have changed. */
window.ticketsRefreshAvatars = async function() {
  await loadTicketsMembersForAvatars();
  if (typeof renderTicketsList === 'function') renderTicketsList();
};

/** Return avatar URL for the technician of ticket t (current user or from members cache). */
function getTicketTechnicianAvatarUrl(t) {
  if (!currentUserProfile) return null;
  const isCreator = t.createdByUid === currentUserProfile.uid ||
    t.technicianStaffId === currentUserProfile.staffId ||
    t.technicianStaffId === currentUserProfile.uid ||
    t.finalizedByUid === currentUserProfile.uid ||
    (t.technicianName && (
      (currentUserProfile.email && String(t.technicianName).toLowerCase().includes(String(currentUserProfile.email).toLowerCase())) ||
      (currentUserProfile.name && String(t.technicianName).toLowerCase().includes(String(currentUserProfile.name).toLowerCase()))
    ));
  if (isCreator && typeof window.ffGetCurrentUserAvatarUrl === 'function') {
    const mine = window.ffGetCurrentUserAvatarUrl();
    if (mine) return mine;
  }
  if (!_ticketsMembersAvatarCache) return null;
  let entry = null;
  if (t.technicianStaffId) {
    entry = _ticketsMembersAvatarCache[t.technicianStaffId];
  }
  if ((!entry || !entry.avatarUrl) && _ticketsMembersAvatarByName) {
    const nk = normalizeTicketTechName(t.technicianName || '');
    if (nk) entry = _ticketsMembersAvatarByName[nk] || entry;
  }
  if (!entry || !entry.avatarUrl) return null;
  const v = entry.avatarUpdatedAtMs != null ? String(entry.avatarUpdatedAtMs) : '';
  const sep = entry.avatarUrl.includes('?') ? '&' : '?';
  return `${entry.avatarUrl}${sep}v=${encodeURIComponent(v)}`;
}

// =====================
// Service Catalog
// =====================
async function loadServices() {
  if (!currentUserProfile?.salonId) return [];
  try {
    const snap = await getDocs(collection(db, `salons/${currentUserProfile.salonId}/services`));
    salonServices = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
    return salonServices;
  } catch (err) {
    console.warn('[Tickets] Failed to load services', err);
    salonServices = [];
    return [];
  }
}

async function saveService(service) {
  if (!currentUserProfile?.salonId) throw new Error('No salon');
  const payload = {
    name: String(service.name || '').trim(),
    defaultPrice: Number(service.defaultPrice) || 0,
    categoryId: service.categoryId || null,
    sortOrder: Number(service.sortOrder) || 0,
    updatedAt: serverTimestamp()
  };
  if (service.id) {
    await updateDoc(doc(db, `salons/${currentUserProfile.salonId}/services`, service.id), payload);
    return service.id;
  } else {
    const ref = await addDoc(collection(db, `salons/${currentUserProfile.salonId}/services`), {
      ...payload,
      createdAt: serverTimestamp()
    });
    return ref.id;
  }
}

async function deleteService(serviceId) {
  if (!currentUserProfile?.salonId || !serviceId) return;
  await deleteDoc(doc(db, `salons/${currentUserProfile.salonId}/services`, serviceId));
}

// =====================
// Service Categories (managed objects)
// =====================
async function loadServiceCategories() {
  if (!currentUserProfile?.salonId) return [];
  try {
    const snap = await getDocs(collection(db, `salons/${currentUserProfile.salonId}/serviceCategories`));
    serviceCategories = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
    return serviceCategories;
  } catch (err) {
    console.warn('[Tickets] Failed to load service categories', err);
    serviceCategories = [];
    return [];
  }
}

async function saveServiceCategory(cat) {
  if (!currentUserProfile?.salonId) throw new Error('No salon');
  const payload = {
    name: String(cat.name || '').trim(),
    sortOrder: Number(cat.sortOrder) || 0,
    updatedAt: serverTimestamp()
  };
  if (cat.id) {
    await updateDoc(doc(db, `salons/${currentUserProfile.salonId}/serviceCategories`, cat.id), payload);
    return cat.id;
  } else {
    const ref = await addDoc(collection(db, `salons/${currentUserProfile.salonId}/serviceCategories`), {
      ...payload,
      createdAt: serverTimestamp()
    });
    return ref.id;
  }
}

async function deleteServiceCategory(categoryId) {
  if (!currentUserProfile?.salonId || !categoryId) return;
  const count = salonServices.filter(s => s.categoryId === categoryId).length;
  if (count > 0) throw new Error(`Cannot delete: ${count} service(s) use this category. Move them first.`);
  await deleteDoc(doc(db, `salons/${currentUserProfile.salonId}/serviceCategories`, categoryId));
}

/** Group services by category for MangoMint-style picker. Uses managed categories; Other for uncategorized. */
function getServicesGroupedByCategory() {
  const grouped = {};
  if (serviceCategories.length > 0) {
    serviceCategories.forEach((c) => { grouped[c.id] = { label: c.name, services: [] }; });
    grouped['__other__'] = { label: 'Other', services: [] };
  } else {
    grouped['__other__'] = { label: 'Other', services: [] };
  }
  salonServices.forEach((s) => {
    const catId = s.categoryId || null;
    const key = (catId && grouped[catId]) ? catId : '__other__';
    grouped[key].services.push(s);
  });
  const ordered = {};
  if (serviceCategories.length > 0) {
    serviceCategories.forEach((c) => { ordered[c.id] = grouped[c.id] || { label: c.name, services: [] }; });
    ordered['__other__'] = grouped['__other__'];
  } else {
    ordered['__other__'] = grouped['__other__'];
  }
  return ordered;
}

// =====================
// Front Desk Recipients (Send To)
// =====================
let _frontDeskCache = null;

async function loadFrontDeskRecipients() {
  if (!currentUserProfile?.salonId) return [];
  if (_frontDeskCache) return _frontDeskCache;
  try {
    const snap = await getDocs(collection(db, `salons/${currentUserProfile.salonId}/members`));
    const store = typeof window.ffGetStaffStore === 'function' ? window.ffGetStaffStore() : null;
    const staffList = store?.staff || [];
    _frontDeskCache = snap.docs
      .filter(d => d.id !== currentUserProfile.uid)
      .map(d => {
        const u = d.data() || {};
        const role = (u.role || '').toLowerCase();
        const staffId = u.staffId || '';
        const memberEmail = (u.email || '').toLowerCase();
        const staff = staffList.find(s => s.id === staffId) || staffList.find(s => memberEmail && (s.email || '').toLowerCase() === memberEmail);
        const isFrontDesk = ['admin', 'owner', 'manager'].includes(role);
        if (!isFrontDesk) return null;
        return {
          uid: d.id,
          staffId,
          name: (u.name || '').trim() || 'Front Desk'
        };
      })
      .filter(Boolean);
  } catch (e) {
    console.warn('[Tickets] loadFrontDeskRecipients failed', e);
    _frontDeskCache = [];
  }
  return _frontDeskCache;
}

/** Auto recipients: creator + all Staff with Receives Tickets ON + Owner/Admin/Manager. No manual selection. */
async function getAutoFrontDeskRecipients() {
  const salonId = currentUserProfile?.salonId || (typeof window !== 'undefined' && window.currentSalonId);
  if (!salonId) return { uids: [], names: [] };
  const seen = new Set();
  const uids = []; const names = [];
  const add = (uid, name) => {
    if (!uid || seen.has(uid)) return;
    seen.add(uid);
    uids.push(uid);
    names.push((name || '').trim() || 'Front Desk');
  };
  add(currentUserProfile.uid, currentUserProfile.name || currentUserProfile.email);
  try {
    const membersSnap = await getDocs(collection(db, `salons/${salonId}/members`));
    const store = typeof window.ffGetStaffStore === 'function' ? window.ffGetStaffStore() : null;
    const staffList = store?.staff || [];
    membersSnap.docs.forEach(d => {
      const u = d.data() || {};
      const role = (u.role || '').toLowerCase();
      const staffId = u.staffId || '';
      const memberEmail = (u.email || '').toLowerCase();
      const staff = staffList.find(s => s.id === staffId) || staffList.find(s => memberEmail && (s.email || '').toLowerCase() === memberEmail);
      const isManagerOrAbove = ['owner', 'admin', 'manager'].includes(role);
      const isRecipient = isManagerOrAbove;
      if (isRecipient) add(d.id, (u.name || '').trim());
    });
  } catch (_) {}
  return { uids, names };
}

/** Returns { isPrimaryAdmin } for current user (PIN actor — who entered PIN). */
function getTicketVisibility() {
  const actorRole = window.__ff_actorRole
    || window.lastActorRole
    || (typeof getCurrentActorRole === 'function' ? getCurrentActorRole() : null)
    || 'Tech';

  const isPrimaryAdmin = actorRole === 'Admin' || actorRole === 'Manager';

  return { isPrimaryAdmin };
}

/** Current signed-in user’s row in ff staff store (for permissions.tickets_*). */
function _ticketsCurrentStaffRow() {
  try {
    const store = typeof window.ffGetStaffStore === 'function' ? window.ffGetStaffStore() : null;
    const staffList = store?.staff || [];
    const uid = currentUserProfile?.uid ? String(currentUserProfile.uid).trim() : '';
    const sid = currentUserProfile?.staffId != null ? String(currentUserProfile.staffId).trim() : '';
    const email = currentUserProfile?.email ? String(currentUserProfile.email).toLowerCase().trim() : '';
    return (
      staffList.find((s) => {
        if (sid && String(s.id || '').trim() === sid) return true;
        if (uid && s.uid != null && String(s.uid).trim() === uid) return true;
        if (email && s.email && String(s.email).toLowerCase().trim() === email) return true;
        return false;
      }) || null
    );
  } catch (_) {
    return null;
  }
}

function getTicketsStaffPermissions() {
  const row = _ticketsCurrentStaffRow();
  if (row?.permissions && typeof row.permissions === 'object') return row.permissions;
  const p = currentUserProfile?.permissions;
  if (p && typeof p === 'object') return p;
  return {};
}

/** Owner / Admin (Firestore role) always see the tab; Manager and others use staff permissions. */
function canViewTicketsSummaryTab() {
  if (!currentUserProfile) return false;
  const role = (currentUserProfile.role || '').toLowerCase();
  if (role === 'owner' || role === 'admin') return true;
  return getTicketsStaffPermissions().tickets_summary === true;
}

/** Owner / Admin (Firestore role) always see the tab; Manager and others use staff permissions (tickets_archived). */
function canViewTicketsArchivedTab() {
  if (!currentUserProfile) return false;
  const role = (currentUserProfile.role || '').toLowerCase();
  if (role === 'owner' || role === 'admin') return true;
  return getTicketsStaffPermissions().tickets_archived === true;
}

function updateTicketsTabsVisibility() {
  const archivedTab = document.getElementById('ticketsArchivedTab');
  const summaryTab = document.getElementById('ticketsSummaryTab');
  const showArchived = canViewTicketsArchivedTab();
  const showSummary = canViewTicketsSummaryTab();
  if (archivedTab) archivedTab.style.display = showArchived ? 'inline-block' : 'none';
  if (summaryTab) summaryTab.style.display = showSummary ? 'inline-block' : 'none';
}

/** Staff row flags manager/admin even when Firestore profile role is still technician-like. */
function isStaffRecordManagerOrAdmin() {
  try {
    const staff = _ticketsCurrentStaffRow();
    return !!(staff && (staff.isManager === true || staff.isAdmin === true));
  } catch (_) {
    return false;
  }
}

/** Firestore salon profile: technician-like roles see only their own tickets in this module. */
function isTicketsTechnicianRestrictedRole() {
  const r = (currentUserProfile?.role || '').toLowerCase().trim();
  return r === 'technician' || r === 'tech' || r === 'staff';
}

/** Matches ticket.technicianStaffId to staff doc id, falling back to auth uid (same as new tickets). */
function getTicketsSelfEmployeeFilterId() {
  if (!currentUserProfile) return 'all';
  if (currentUserProfile.staffId != null && String(currentUserProfile.staffId).trim() !== '') {
    return String(currentUserProfile.staffId).trim();
  }
  return String(currentUserProfile.uid);
}

/** Only tickets assigned to this technician: technicianStaffId === staffId or auth uid; if missing id, exact name/email vs their staff row (no substring match). */
function ticketBelongsToTicketsTechnician(ticket) {
  if (!currentUserProfile || !ticket) return false;
  const techRaw = ticket.technicianStaffId;
  const techId =
    techRaw != null && String(techRaw).trim() !== '' ? String(techRaw).trim() : '';
  if (techId) {
    const uid = String(currentUserProfile.uid || '').trim();
    const sid =
      currentUserProfile.staffId != null && String(currentUserProfile.staffId).trim() !== ''
        ? String(currentUserProfile.staffId).trim()
        : '';
    if (sid && techId === sid) return true;
    if (uid && techId === uid) return true;
    return false;
  }
  const staff = _ticketsCurrentStaffRow();
  if (!staff) return false;
  const tn = normalizeTicketTechName(ticket.technicianName || '');
  if (!tn) return false;
  const n1 = normalizeTicketTechName(staff.name || '');
  const n2 = normalizeTicketTechName(staff.email || '');
  if (n1 && tn === n1) return true;
  if (n2 && tn === n2) return true;
  return false;
}

function updateTicketsEmployeeFilterVisibility() {
  const sel = document.getElementById('ticketsEmployeeSelect');
  if (!sel) return;
  const show = !(isTicketsTechnicianRestrictedRole() && !isStaffRecordManagerOrAdmin());
  const disp = show ? '' : 'none';
  sel.style.display = disp;
  const label = sel.previousElementSibling;
  const sep = label?.previousElementSibling;
  if (label && label.classList.contains('tickets-time-period-label')) label.style.display = disp;
  if (sep && sep.classList.contains('tickets-filters-sep')) sep.style.display = disp;
}

/** Returns true if current user can see this ticket.
 *  Uses FIRESTORE profile role for admin/manager check — not PIN actor.
 *  This ensures admin always sees all tickets regardless of PIN state. */
function canSeeTicket(ticket) {
  if (!currentUserProfile) return false;
  // Firestore role: admin/owner/manager always see all tickets
  const profileRole = (currentUserProfile.role || '').toLowerCase();
  if (['owner', 'admin', 'manager'].includes(profileRole)) return true;
  if (isStaffRecordManagerOrAdmin()) return true;
  if (isTicketsTechnicianRestrictedRole()) {
    return ticketBelongsToTicketsTechnician(ticket);
  }
  if (ticket.createdByUid === currentUserProfile.uid) return true;
  return false;
}

// =====================
// Tickets CRUD
// =====================
function _rebuildCurrentTicketsMerged() {
  const byId = new Map();
  for (const t of _ticketsExtraTickets) {
    if (t && t.id) byId.set(t.id, t);
  }
  for (const t of _ticketsFirstPageTickets) {
    if (t && t.id) byId.set(t.id, t);
  }
  currentTickets = Array.from(byId.values()).sort((a, b) => {
    const da = ticketSubmittedAtDate(a);
    const db = ticketSubmittedAtDate(b);
    const ma = da ? da.getTime() : 0;
    const mb = db ? db.getTime() : 0;
    return mb - ma;
  });
}

function updateTicketsLoadMoreUi() {
  const wrap = document.getElementById('ticketsLoadMoreWrap');
  const btn = document.getElementById('ticketsLoadMoreBtn');
  if (!wrap || !btn) return;
  const onListTab = currentTicketsTab !== 'summary';
  const show = onListTab && _ticketsHasMoreOlder;
  wrap.style.display = show ? 'block' : 'none';
  btn.disabled = _ticketsLoadingMore;
  btn.textContent = _ticketsLoadingMore ? 'Loading…' : 'Load more';
}

async function loadMoreTicketsOlder() {
  if (_ticketsLoadingMore || !_ticketsHasMoreOlder || !_ticketsNextPageCursor) return;
  const salonId = currentUserProfile?.salonId || (typeof window !== 'undefined' && window.currentSalonId);
  if (!salonId) return;
  _ticketsLoadingMore = true;
  updateTicketsLoadMoreUi();
  try {
    const qMore = query(
      collection(db, `salons/${salonId}/tickets`),
      orderBy('createdAt', 'desc'),
      startAfter(_ticketsNextPageCursor),
      limit(TICKETS_PAGE_SIZE)
    );
    const batch = await getDocs(qMore);
    const newRows = batch.docs.map((d) => ({ id: d.id, ...d.data() }));
    _ticketsExtraTickets.push(...newRows);
    if (batch.docs.length < TICKETS_PAGE_SIZE) {
      _ticketsHasMoreOlder = false;
      _ticketsNextPageCursor = null;
    } else {
      _ticketsHasMoreOlder = true;
      _ticketsNextPageCursor = batch.docs[batch.docs.length - 1];
    }
    _rebuildCurrentTicketsMerged();
    renderTicketsList();
    updateTicketsNavBadge();
  } catch (e) {
    console.error('[Tickets] load more failed', e);
    showToast(e?.message || 'Could not load more tickets', 'error');
  } finally {
    _ticketsLoadingMore = false;
    updateTicketsLoadMoreUi();
  }
}

function subscribeTickets(options) {
  const resetLoading = !!(options && options.resetLoading);
  const salonId = currentUserProfile?.salonId
    || (typeof window !== 'undefined' && window.currentSalonId)
    || null;
  if (!salonId) {
    console.warn('[Tickets] No salonId. Retrying in 1s...');
    setTimeout(() => subscribeTickets(options), 1000);
    renderTicketsList();
    return;
  }
  if (ticketsUnsubscribe) ticketsUnsubscribe();
  if (resetLoading) {
    _ticketsListSnapshotReady = false;
    _ticketsFirstPageTickets = [];
    _ticketsExtraTickets = [];
    _ticketsNextPageCursor = null;
    _ticketsHasMoreOlder = false;
    _ticketsLoadingMore = false;
    _rebuildCurrentTicketsMerged();
    const loadEl = document.getElementById('ticketsLoading');
    const listEl = document.getElementById('ticketsList');
    const emptyEl = document.getElementById('ticketsEmpty');
    if (loadEl) loadEl.style.display = 'block';
    if (emptyEl) emptyEl.style.display = 'none';
    if (listEl) listEl.innerHTML = '';
  }
  const q = query(
    collection(db, `salons/${salonId}/tickets`),
    orderBy('createdAt', 'desc'),
    limit(TICKETS_PAGE_SIZE)
  );
  ticketsUnsubscribe = onSnapshot(q, (snap) => {
    _ticketsFirstPageTickets = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (_ticketsExtraTickets.length === 0) {
      _ticketsNextPageCursor =
        snap.docs.length >= TICKETS_PAGE_SIZE ? snap.docs[snap.docs.length - 1] : null;
      _ticketsHasMoreOlder = snap.docs.length === TICKETS_PAGE_SIZE;
    }
    _rebuildCurrentTicketsMerged();
    _ticketsListSnapshotReady = true;
    if (editingTicketId) {
      const t = currentTickets.find((x) => x.id === editingTicketId);
      const s = t ? (t.status || '').toUpperCase() : '';
      if (t && (s === 'CLOSED' || s === 'VOID' || s === 'ARCHIVED')) {
        const ticketModal = document.getElementById('ticketModal');
        if (ticketModal && ticketModal.style.display === 'flex') {
          closeTicketModal();
          // Don't open Ticket Details after closing – user stays on the list. Details only when they click a closed ticket.
        }
      }
    }
    renderTicketsList();
    updateTicketsNavBadge();
  }, (err) => {
    console.error('[Tickets] subscribe error', err);
    _ticketsListSnapshotReady = true;
    renderTicketsList();
  });
}

/** Red dot + number on TICKETS nav for manager/admin. Counts Ready tickets not yet opened (Firestore seenByFrontDeskAt OR opened this session). */
function updateTicketsNavBadge() {
  const badge = document.getElementById('ticketsNavBadge');
  if (!badge) return;
  // Badge only for admin/owner/manager by FIRESTORE role
  const profileRole = (currentUserProfile?.role || '').toLowerCase();
  const isFirebaseAdmin = ['owner', 'admin', 'manager'].includes(profileRole);
  if (!isFirebaseAdmin) {
    badge.textContent = '';
    badge.style.display = 'none';
    return;
  }
  badge.style.display = '';
  const readyUnread = (currentTickets || []).filter(t => {
    if ((String(t.status || '').toUpperCase() !== 'READY_FOR_CHECKOUT') || !canSeeTicket(t)) return false;
    if (_ticketsOpenedThisSession.has(t.id)) return false;
    if (t.seenByFrontDeskAt) return false;
    return true;
  });
  badge.textContent = readyUnread.length > 0 ? String(readyUnread.length) : '';
}

function getTicketCustomerPriceApprovedFromForm() {
  const wrap = document.getElementById('ticketCustomerPriceApprovedWrap');
  const el = document.getElementById('ticketCustomerPriceApproved');
  if (!el || !wrap || wrap.style.display === 'none') return false;
  return !!el.checked;
}

async function createTicket(payload) {
  const salonId = currentUserProfile?.salonId || (typeof window !== 'undefined' && window.currentSalonId);
  if (!salonId) throw new Error('No salon - ensure your account has salonId');
  const status = payload.status === 'READY_FOR_CHECKOUT' ? 'READY_FOR_CHECKOUT' : 'OPEN';
  const doc = {
    status,
    asIs: payload.asIs === true,
    asIsMessage: payload.asIs === true ? (payload.asIsMessage || 'Service matches system billing') : null,
    customerApprovedPrice: payload.customerApprovedPrice === true,
    customerName: String(payload.customerName || '').trim(),
    appointmentId: payload.appointmentId || null,
    appointmentData: payload.appointmentData || null,
    technicianStaffId: currentUserProfile.staffId || currentUserProfile.uid,
    technicianName: currentUserProfile.name || currentUserProfile.email || 'Technician',
    performedLines: Array.isArray(payload.performedLines) ? payload.performedLines : [],
    total: Number(payload.total) || 0,
    forUids: Array.isArray(payload.forUids) ? payload.forUids : [],
    forNames: Array.isArray(payload.forNames) ? payload.forNames : [],
    ...(status === 'READY_FOR_CHECKOUT' && { finalizedByUid: currentUserProfile.uid }),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdByUid: currentUserProfile.uid,
    history: [{ at: Timestamp.now(), by: currentUserProfile.uid, byName: currentUserProfile.name || '', action: 'created', details: null }]
  };
  const ref = await addDoc(collection(db, `salons/${salonId}/tickets`), doc);
  return ref.id;
}

async function updateTicket(ticketId, updates) {
  const salonId = currentUserProfile?.salonId || (typeof window !== 'undefined' && window.currentSalonId);
  if (!salonId || !ticketId) return;
  const ticketRef = doc(db, `salons/${salonId}/tickets`, ticketId);
  let snap;
  try {
    snap = await getDocFromServer(ticketRef);
  } catch (_) {
    snap = await getDoc(ticketRef);
  }
  const data = snap.data() || {};
  const existingHist = Array.isArray(data.history) ? data.history : [];
  const hist = [...existingHist, {
    at: Timestamp.now(),
    by: currentUserProfile.uid,
    byName: currentUserProfile.name || '',
    action: updates._action || 'updated',
    details: updates._details || null
  }];
  delete updates._action;
  delete updates._details;
  delete updates.history;
  const isOnlyMarkingSeen = Object.keys(updates).length === 1 && updates.seenByFrontDeskAt !== undefined;
  const statusNow = (String(data.status || '')).toUpperCase();
  if (!isOnlyMarkingSeen && statusNow === 'READY_FOR_CHECKOUT') {
    updates.editedAfterFinalize = true;
    updates.editedAt = serverTimestamp();
  }
  await updateDoc(ticketRef, {
    ...updates,
    history: hist,
    updatedAt: serverTimestamp()
  });
}

async function finalizeTicket(ticketId, forUids, forNames) {
  const updates = { status: 'READY_FOR_CHECKOUT', finalizedByUid: currentUserProfile.uid, _action: 'finalized' };
  if (Array.isArray(forUids) && forUids.length > 0) {
    updates.forUids = forUids;
    updates.forNames = Array.isArray(forNames) ? forNames : [];
  }
  await updateTicket(ticketId, updates);
}

/** Append-only history for Tickets Summary (not read by UI yet). */
async function appendTicketSummaryOnClose(salonId, ticketId) {
  console.log('[Tickets Summary DEBUG] appendTicketSummaryOnClose: enter', {
    salonId: salonId || '(missing)',
    ticketId: ticketId || '(missing)',
    profileRole: currentUserProfile?.role ?? '(no profile)'
  });
  if (!salonId || !ticketId) {
    console.log('[Tickets Summary DEBUG] appendTicketSummaryOnClose: abort — missing salonId or ticketId');
    return;
  }
  try {
    const ticketRef = doc(db, `salons/${salonId}/tickets`, ticketId);
    let snap;
    try {
      snap = await getDocFromServer(ticketRef);
    } catch (e) {
      console.log('[Tickets Summary DEBUG] appendTicketSummaryOnClose: getDocFromServer failed, fallback getDoc', e);
      snap = await getDoc(ticketRef);
    }
    console.log('[Tickets Summary DEBUG] appendTicketSummaryOnClose: after ticket read', {
      exists: snap.exists(),
      status: snap.exists() ? String((snap.data() || {}).status || '') : '(n/a)'
    });
    if (!snap.exists()) {
      console.log('[Tickets Summary DEBUG] appendTicketSummaryOnClose: abort — ticket doc missing');
      return;
    }
    const t = snap.data() || {};
    if (String(t.status || '').toUpperCase() !== 'CLOSED') {
      console.log('[Tickets Summary DEBUG] appendTicketSummaryOnClose: abort — status not CLOSED', {
        status: t.status ?? '(empty)'
      });
      return;
    }

    const performedLines = Array.isArray(t.performedLines) ? t.performedLines : [];
    const servicesCount = performedLines.length;
    const rawTotal = Number(t.total);
    const totalAmount = Number.isFinite(rawTotal) ? rawTotal : null;

    const tsid = t.technicianStaffId;
    const employeeId = tsid != null && String(tsid).trim() !== '' ? String(tsid).trim() : null;
    const tn = t.technicianName;
    const employeeName = tn != null && String(tn).trim() !== '' ? String(tn).trim() : null;

    const dupQ = query(
      collection(db, `salons/${salonId}/ticketSummaries`),
      where('ticketId', '==', ticketId),
      limit(1)
    );
    const dupSnap = await getDocs(dupQ);
    if (!dupSnap.empty) {
      console.log('[Tickets Summary DEBUG] appendTicketSummaryOnClose: abort — duplicate summary exists for ticketId');
      return;
    }

    const now = new Date();
    const closedDateKey = _fmtYmdLocal(now);

    const payload = {
      ticketId,
      salonId,
      employeeId,
      employeeName,
      closedAt: serverTimestamp(),
      closedDateKey,
      ticketsCount: 1,
      servicesCount,
      totalAmount,
      status: 'closed',
      source: 'ticket_close'
    };
    console.log('[Tickets Summary DEBUG] appendTicketSummaryOnClose: before addDoc ticketSummaries', {
      path: `salons/${salonId}/ticketSummaries`,
      closedDateKey,
      payloadPreview: {
        ticketId,
        salonId,
        employeeId,
        employeeName,
        servicesCount,
        totalAmount
      }
    });
    const ref = await addDoc(collection(db, `salons/${salonId}/ticketSummaries`), payload);
    console.log('[Tickets Summary DEBUG] appendTicketSummaryOnClose: addDoc OK', { newDocId: ref.id });
  } catch (e) {
    console.error('[Tickets Summary DEBUG] appendTicketSummaryOnClose: catch', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack,
      profileRole: currentUserProfile?.role ?? '(no profile)',
      salonId,
      ticketId
    });
    console.warn('[Tickets] ticketSummaries write failed', e);
  }
}

async function closeTicket(ticketId) {
  const salonId = currentUserProfile?.salonId || (typeof window !== 'undefined' && window.currentSalonId);
  const closedByName = currentUserProfile?.name || currentUserProfile?.email || 'Manager';
  console.log('[Tickets Summary DEBUG] closeTicket: before update + append', {
    salonId: salonId || '(missing)',
    ticketId: ticketId || '(missing)',
    profileRole: currentUserProfile?.role ?? '(no profile)',
    uid: currentUserProfile?.uid ?? '(no uid)'
  });
  await updateTicket(ticketId, {
    status: 'CLOSED',
    closedByUid: currentUserProfile.uid,
    closedByName,
    _action: 'closed'
  });
  await appendTicketSummaryOnClose(salonId, ticketId);
}

async function voidTicket(ticketId) {
  await updateTicket(ticketId, { status: 'VOID', _action: 'voided' });
}

async function archiveTicket(ticketId) {
  await updateTicket(ticketId, { status: 'ARCHIVED', archivedByUid: currentUserProfile.uid, _action: 'archived' });
}

/** Does not remove ticketSummaries; marks matching rows when the live ticket is permanently deleted. */
async function markTicketSummariesSourceDeleted(salonId, ticketId) {
  if (!salonId || !ticketId) return;
  const uid = currentUserProfile?.uid ?? null;
  const byName =
    currentUserProfile?.name || currentUserProfile?.email || null;
  try {
    const q = query(
      collection(db, `salons/${salonId}/ticketSummaries`),
      where('ticketId', '==', ticketId)
    );
    const snap = await getDocs(q);
    await Promise.all(
      snap.docs.map((d) =>
        updateDoc(d.ref, {
          sourceTicketDeleted: true,
          sourceTicketDeletedAt: serverTimestamp(),
          sourceTicketDeletedByUid: uid,
          sourceTicketDeletedByName: byName
        })
      )
    );
  } catch (e) {
    console.warn('[Tickets] ticketSummaries source-deleted markers failed', e);
  }
}

async function deleteTicketPermanently(ticketId) {
  const salonId = currentUserProfile?.salonId || (typeof window !== 'undefined' && window.currentSalonId);
  if (!salonId || !ticketId) return;
  await markTicketSummariesSourceDeleted(salonId, ticketId);
  const ticketRef = doc(db, `salons/${salonId}/tickets`, ticketId);
  await deleteDoc(ticketRef);
  _ticketsExtraTickets = _ticketsExtraTickets.filter((t) => t.id !== ticketId);
  _ticketsFirstPageTickets = _ticketsFirstPageTickets.filter((t) => t.id !== ticketId);
  _rebuildCurrentTicketsMerged();
}

/** Mark ticket as seen/acknowledged by Front Desk (removes "Edited" indicator). Call when FD opens the ticket. */
async function markTicketSeenByFrontDesk(ticketId) {
  const salonId = currentUserProfile?.salonId || (typeof window !== 'undefined' && window.currentSalonId);
  if (!salonId || !ticketId) return;
  const ticketRef = doc(db, `salons/${salonId}/tickets`, ticketId);
  const snap = await getDoc(ticketRef);
  if (!snap.exists() || snap.data().seenByFrontDeskAt) return;
  await updateTicket(ticketId, { seenByFrontDeskAt: serverTimestamp() });
}

// =====================
// Helpers
// =====================
function formatDate(ts) {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Submitted time for list + date filter (uses createdAt). */
function ticketSubmittedAtDate(t) {
  const ts = t?.createdAt;
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

function passesTicketsDateFilter(t, fromStr, toStr) {
  if (!fromStr && !toStr) return true;
  const d = ticketSubmittedAtDate(t);
  if (!d) return false;
  const tMs = d.getTime();
  if (fromStr) {
    const p = fromStr.split('-').map(Number);
    if (p.length === 3) {
      const from = new Date(p[0], p[1] - 1, p[2], 0, 0, 0, 0);
      if (tMs < from.getTime()) return false;
    }
  }
  if (toStr) {
    const p = toStr.split('-').map(Number);
    if (p.length === 3) {
      const toEnd = new Date(p[0], p[1] - 1, p[2], 23, 59, 59, 999);
      if (tMs > toEnd.getTime()) return false;
    }
  }
  return true;
}

function _fmtYmdLocal(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Week starts Sunday (matches common US calendar UI). */
function _ticketsStartOfWeekSunday(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function computeRangeForPreset(preset) {
  const now = new Date();
  const fmt = _fmtYmdLocal;
  if (preset === 'all') return { from: '', to: '' };
  if (preset === 'today') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { from: fmt(d), to: fmt(d) };
  }
  if (preset === 'yesterday') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return { from: fmt(d), to: fmt(d) };
  }
  if (preset === 'this_week') {
    const start = _ticketsStartOfWeekSunday(now);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { from: fmt(start), to: fmt(end) };
  }
  if (preset === 'last_week') {
    const thisStart = _ticketsStartOfWeekSunday(now);
    const end = new Date(thisStart);
    end.setDate(end.getDate() - 1);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    return { from: fmt(start), to: fmt(end) };
  }
  if (preset === 'last_two_weeks') {
    const thisStart = _ticketsStartOfWeekSunday(now);
    const end = new Date(thisStart);
    end.setDate(end.getDate() - 1);
    const start = new Date(end);
    start.setDate(start.getDate() - 13);
    return { from: fmt(start), to: fmt(end) };
  }
  return { from: '', to: '' };
}

function _ticketsFmtMonthDay(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function _ticketsRangeLabelMd(fromStr, toStr) {
  if (!fromStr || !toStr) return '';
  const a = new Date(fromStr + 'T12:00:00');
  const b = new Date(toStr + 'T12:00:00');
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return '';
  return `${_ticketsFmtMonthDay(a)} - ${_ticketsFmtMonthDay(b)}`;
}

function ticketMatchesEmployeeFilter(t, staffId) {
  if (!staffId || staffId === 'all') return true;
  if (t.technicianStaffId && String(t.technicianStaffId) === String(staffId)) return true;
  const store = typeof window.ffGetStaffStore === 'function' ? window.ffGetStaffStore() : null;
  const staff = store?.staff?.find(s => String(s.id) === String(staffId));
  if (!staff) return false;
  const tn = normalizeTicketTechName(t.technicianName || '');
  const n1 = normalizeTicketTechName(staff.name || '');
  const n2 = normalizeTicketTechName(staff.email || '');
  if (tn && n1 && tn === n1) return true;
  if (tn && n2 && tn === n2) return true;
  if (tn && n1 && (tn.includes(n1) || n1.includes(tn))) return true;
  return false;
}

function formatSummaryMoney(n) {
  const x = n == null || n === '' ? NaN : Number(n);
  const v = Number.isFinite(x) ? x : 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(v);
  } catch (_) {
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
}

function formatSummaryInt(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return '0';
  return String(Math.round(x));
}

function getSummaryFilterDateRangeFromDom() {
  const periodSel = document.getElementById('ticketsTimePeriodSelect');
  if (periodSel && periodSel.value === 'all') {
    return { fromStr: '', toStr: '' };
  }
  const fromEl = document.getElementById('ticketsFilterDateFrom');
  const toEl = document.getElementById('ticketsFilterDateTo');
  return {
    fromStr: fromEl ? (fromEl.value || '').trim() : '',
    toStr: toEl ? (toEl.value || '').trim() : ''
  };
}

function summaryDocMatchesEmployee(d, staffId) {
  const techSelfOnly =
    isTicketsTechnicianRestrictedRole() && !isStaffRecordManagerOrAdmin();
  if (techSelfOnly) {
    return ticketBelongsToTicketsTechnician({
      technicianStaffId: d.employeeId,
      technicianName: d.employeeName || ''
    });
  }
  return ticketMatchesEmployeeFilter(
    { technicianStaffId: d.employeeId, technicianName: d.employeeName || '' },
    staffId
  );
}

function summaryDocClosedDateKeyString(d) {
  const k = d.closedDateKey;
  if (k == null) return null;
  if (typeof k === 'object' && typeof k.toDate === 'function') {
    const dt = k.toDate();
    if (isNaN(dt.getTime())) return null;
    return _fmtYmdLocal(dt);
  }
  const s = String(k).trim();
  return s !== '' ? s : null;
}

/** Date filter for ticketSummaries: closedDateKey (string) or closedAt timestamp. */
function passesSummaryDocDateFilter(d, fromStr, toStr) {
  if (!fromStr && !toStr) return true;
  const ks = summaryDocClosedDateKeyString(d);
  if (ks != null) {
    if (fromStr && ks < fromStr) return false;
    if (toStr && ks > toStr) return false;
    return true;
  }
  const ca = d.closedAt;
  if (ca && typeof ca.toDate === 'function') {
    const dt = ca.toDate();
    if (isNaN(dt.getTime())) return false;
    const tMs = dt.getTime();
    if (fromStr) {
      const p = fromStr.split('-').map(Number);
      if (p.length === 3) {
        const from = new Date(p[0], p[1] - 1, p[2], 0, 0, 0, 0);
        if (tMs < from.getTime()) return false;
      }
    }
    if (toStr) {
      const p = toStr.split('-').map(Number);
      if (p.length === 3) {
        const toEnd = new Date(p[0], p[1] - 1, p[2], 23, 59, 59, 999);
        if (tMs > toEnd.getTime()) return false;
      }
    }
    return true;
  }
  return false;
}

function buildSummaryRowsFromLiveClosedTickets(fromStr, toStr, employeeId) {
  const techSelfOnly =
    isTicketsTechnicianRestrictedRole() && !isStaffRecordManagerOrAdmin();
  const filtered = (currentTickets || []).filter((t) => {
    if (!canSeeTicket(t)) return false;
    if (String(t.status || '').toUpperCase() !== 'CLOSED') return false;
    if (!passesTicketsDateFilter(t, fromStr, toStr)) return false;
    if (techSelfOnly) return ticketBelongsToTicketsTechnician(t);
    return ticketMatchesEmployeeFilter(t, employeeId);
  });
  const groups = new Map();
  for (const t of filtered) {
    const idPart =
      t.technicianStaffId != null && String(t.technicianStaffId).trim() !== ''
        ? String(t.technicianStaffId).trim()
        : '';
    const nk = normalizeTicketTechName(t.technicianName || '');
    const gkey = idPart ? `id:${idPart}` : `name:${nk || 'unknown'}`;
    if (!groups.has(gkey)) {
      groups.set(gkey, { name: 'Unknown', tickets: 0, services: 0, total: 0 });
    }
    const g = groups.get(gkey);
    const nm =
      t.technicianName != null && String(t.technicianName).trim() !== ''
        ? String(t.technicianName).trim()
        : '';
    if (nm && g.name === 'Unknown') g.name = nm;
    g.tickets += 1;
    const lines = Array.isArray(t.performedLines) ? t.performedLines : [];
    g.services += lines.length;
    const raw = Number(t.total);
    g.total += Number.isFinite(raw)
      ? raw
      : lines.reduce((s, l) => s + (Number(l?.ticketPrice) || 0), 0);
  }
  const sorted = [...groups.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
  let totalTickets = 0;
  let totalServices = 0;
  let totalRevenue = 0;
  sorted.forEach((r) => {
    totalTickets += r.tickets;
    totalServices += r.services;
    totalRevenue += r.total;
  });
  const summaryRows = sorted.map((r) => ({
    name: !r.name || !String(r.name).trim() ? 'Unknown' : r.name.trim(),
    tickets: r.tickets,
    services: r.services,
    total: r.total
  }));
  return { summaryRows, totalTickets, totalServices, totalRevenue };
}

function paintTicketsSummaryTable(wrap, tbody, tfoot, emptyMsg, summaryRows, totalTickets, totalServices, totalRevenue) {
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
      (r) => `<tr>
      <td>${escapeHtml(r.name)}</td>
      <td class="tickets-summary-col-num">${formatSummaryInt(r.tickets)}</td>
      <td class="tickets-summary-col-num">${formatSummaryInt(r.services)}</td>
      <td class="tickets-summary-col-num">${formatSummaryMoney(r.total)}</td>
    </tr>`
    )
    .join('');
  tfoot.innerHTML = `<tr class="tickets-summary-total-row">
      <td>Total</td>
      <td class="tickets-summary-col-num">${formatSummaryInt(totalTickets)}</td>
      <td class="tickets-summary-col-num">${formatSummaryInt(totalServices)}</td>
      <td class="tickets-summary-col-num">${formatSummaryMoney(totalRevenue)}</td>
    </tr>`;
  if (emptyMsg) {
    emptyMsg.style.display = 'none';
    emptyMsg.className = 'tickets-summary-state';
  }
  wrap.style.display = '';
  return true;
}

let _ticketsSummaryFetchSeq = 0;

const _ticketSummaryPageSize = 500;

/** Load every ticketSummaries doc for the query (no arbitrary cap like limit(5000)). */
async function fetchAllTicketSummaryDocs(colRef, fromStr, toStr) {
  const out = [];
  const PAGE = _ticketSummaryPageSize;
  if (!fromStr && !toStr) {
    let lastDoc = null;
    for (;;) {
      const q = lastDoc
        ? query(colRef, orderBy(documentId()), startAfter(lastDoc), limit(PAGE))
        : query(colRef, orderBy(documentId()), limit(PAGE));
      const snap = await getDocs(q);
      if (snap.empty) break;
      out.push(...snap.docs);
      if (snap.size < PAGE) break;
      lastDoc = snap.docs[snap.docs.length - 1];
    }
    return out;
  }
  if (fromStr && toStr) {
    let lastDoc = null;
    for (;;) {
      const q = lastDoc
        ? query(
            colRef,
            where('closedDateKey', '>=', fromStr),
            where('closedDateKey', '<=', toStr),
            orderBy('closedDateKey'),
            startAfter(lastDoc),
            limit(PAGE)
          )
        : query(
            colRef,
            where('closedDateKey', '>=', fromStr),
            where('closedDateKey', '<=', toStr),
            orderBy('closedDateKey'),
            limit(PAGE)
          );
      const snap = await getDocs(q);
      if (snap.empty) break;
      out.push(...snap.docs);
      if (snap.size < PAGE) break;
      lastDoc = snap.docs[snap.docs.length - 1];
    }
    return out;
  }
  if (fromStr) {
    let lastDoc = null;
    for (;;) {
      const q = lastDoc
        ? query(
            colRef,
            where('closedDateKey', '>=', fromStr),
            orderBy('closedDateKey'),
            startAfter(lastDoc),
            limit(PAGE)
          )
        : query(colRef, where('closedDateKey', '>=', fromStr), orderBy('closedDateKey'), limit(PAGE));
      const snap = await getDocs(q);
      if (snap.empty) break;
      out.push(...snap.docs);
      if (snap.size < PAGE) break;
      lastDoc = snap.docs[snap.docs.length - 1];
    }
    return out;
  }
  let lastDoc = null;
  for (;;) {
    const q = lastDoc
      ? query(
          colRef,
          where('closedDateKey', '<=', toStr),
          orderBy('closedDateKey', 'desc'),
          startAfter(lastDoc),
          limit(PAGE)
        )
      : query(colRef, where('closedDateKey', '<=', toStr), orderBy('closedDateKey', 'desc'), limit(PAGE));
    const snap = await getDocs(q);
    if (snap.empty) break;
    out.push(...snap.docs);
    if (snap.size < PAGE) break;
    lastDoc = snap.docs[snap.docs.length - 1];
  }
  return out;
}

/**
 * Summary tab: aggregate from salons/{salonId}/ticketSummaries (not live tickets).
 * summaryRows: [{ name, tickets, services, total }, ...]
 */
async function loadAndRenderTicketsSummary() {
  const seq = ++_ticketsSummaryFetchSeq;
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

  const salonId = currentUserProfile?.salonId || (typeof window !== 'undefined' && window.currentSalonId);
  if (!salonId) {
    if (seq !== _ticketsSummaryFetchSeq) return;
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
    profileRole: currentUserProfile?.role ?? '(no profile)',
    techRestricted: isTicketsTechnicianRestrictedRole() && !isStaffRecordManagerOrAdmin()
  });

  try {
    const col = collection(db, `salons/${salonId}/ticketSummaries`);
    const rawDocs = await fetchAllTicketSummaryDocs(col, fromStr, toStr);

    if (seq !== _ticketsSummaryFetchSeq) return;

    console.log('[Tickets Summary DEBUG] loadAndRenderTicketsSummary: fetched summary docs (all pages)', rawDocs.length);

    let rows = rawDocs.map((x) => ({ id: x.id, ...x.data() }));
    const nMapped = rows.length;
    const rowsAfterDate = rows.filter((d) => passesSummaryDocDateFilter(d, fromStr, toStr));
    const nAfterDate = rowsAfterDate.length;
    rows = rowsAfterDate.filter((d) => summaryDocMatchesEmployee(d, employeeId));
    const nAfterEmployee = rows.length;
    console.log('[Tickets Summary DEBUG] loadAndRenderTicketsSummary: after filters', {
      mappedRows: nMapped,
      afterDateFilter: nAfterDate,
      afterEmployeeFilter: nAfterEmployee
    });

    const groups = new Map();
    for (const d of rows) {
      const idPart =
        d.employeeId != null && String(d.employeeId).trim() !== '' ? String(d.employeeId).trim() : '';
      const nk = normalizeTicketTechName(d.employeeName || '');
      const gkey = idPart ? `id:${idPart}` : `name:${nk || 'unknown'}`;
      if (!groups.has(gkey)) {
        groups.set(gkey, { name: 'Unknown', tickets: 0, services: 0, total: 0 });
      }
      const g = groups.get(gkey);
      const nm =
        d.employeeName != null && String(d.employeeName).trim() !== ''
          ? String(d.employeeName).trim()
          : '';
      if (nm && g.name === 'Unknown') g.name = nm;
      const tc = Number(d.ticketsCount);
      g.tickets += Number.isFinite(tc) ? tc : 0;
      const sc = Number(d.servicesCount);
      g.services += Number.isFinite(sc) ? sc : 0;
      const ta = Number(d.totalAmount);
      g.total += Number.isFinite(ta) ? ta : 0;
    }

    const sorted = [...groups.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );

    let totalTickets = 0;
    let totalServices = 0;
    let totalRevenue = 0;
    sorted.forEach((r) => {
      totalTickets += r.tickets;
      totalServices += r.services;
      totalRevenue += r.total;
    });

    const summaryRows = sorted.map((r) => ({
      name: !r.name || !String(r.name).trim() ? 'Unknown' : r.name.trim(),
      tickets: r.tickets,
      services: r.services,
      total: r.total
    }));

    console.log('[Tickets Summary DEBUG] loadAndRenderTicketsSummary: grouped summaryRows', summaryRows.length);

    if (seq !== _ticketsSummaryFetchSeq) return;

    const noDateFilter = !fromStr && !toStr;
    if (
      summaryRows.length === 0 &&
      noDateFilter &&
      rawDocs.length === 0 &&
      _ticketsListSnapshotReady
    ) {
      const fb = buildSummaryRowsFromLiveClosedTickets(fromStr, toStr, employeeId);
      if (
        paintTicketsSummaryTable(
          wrap,
          tbody,
          tfoot,
          emptyMsg,
          fb.summaryRows,
          fb.totalTickets,
          fb.totalServices,
          fb.totalRevenue
        )
      ) {
        return;
      }
    }

    paintTicketsSummaryTable(wrap, tbody, tfoot, emptyMsg, summaryRows, totalTickets, totalServices, totalRevenue);
  } catch (e) {
    console.error('[Tickets Summary DEBUG] loadAndRenderTicketsSummary: catch', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack,
      salonId,
      profileRole: currentUserProfile?.role ?? '(no profile)'
    });
    console.warn('[Tickets] Summary load failed', e);
    if (seq !== _ticketsSummaryFetchSeq) return;
    if (_ticketsListSnapshotReady) {
      const fb = buildSummaryRowsFromLiveClosedTickets(fromStr, toStr, employeeId);
      if (
        paintTicketsSummaryTable(
          wrap,
          tbody,
          tfoot,
          emptyMsg,
          fb.summaryRows,
          fb.totalTickets,
          fb.totalServices,
          fb.totalRevenue
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

let _ticketsDateFiltersWired = false;
function setupTicketsDateFilters() {
  if (_ticketsDateFiltersWired) return;
  _ticketsDateFiltersWired = true;
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

/** Align the gear icon precisely under the user avatar circle — works on any screen/DPI */
function _alignGearToAvatar() {
  const gear = document.getElementById('ticketsManageServicesBtn');
  // Target the circle itself, not the full button (which includes the ▼ arrow)
  const avatarCircle = document.querySelector('.user-avatar-circle') || document.getElementById('userAvatarBtn');
  if (!gear || !avatarCircle || gear.style.display === 'none') return;
  const circleRect = avatarCircle.getBoundingClientRect();
  const tabsRow = gear.closest('.tickets-tabs');
  if (!tabsRow) return;
  const tabsRect = tabsRow.getBoundingClientRect();
  // Center gear under the circle center
  const circleCenterX = circleRect.left + circleRect.width / 2;
  const gearHalfWidth = 18; // 36px / 2
  const rightFromRow = tabsRect.right - (circleCenterX + gearHalfWidth);
  gear.style.marginRight = Math.max(4, Math.round(rightFromRow - 20)) + 'px';
}

// Re-align on resize
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    const gear = document.getElementById('ticketsManageServicesBtn');
    if (gear && gear.style.display !== 'none') _alignGearToAvatar();
  });
}

function showToast(msg, type = 'info') {
  // Remove existing toast
  const existing = document.getElementById('ff-tickets-toast');
  if (existing) existing.remove();

  const colors = { success: '#059669', error: '#dc2626', info: '#2563eb', warning: '#d97706' };
  const icons  = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
  const bg = colors[type] || colors.info;
  const icon = icons[type] || icons.info;

  const toast = document.createElement('div');
  toast.id = 'ff-tickets-toast';
  toast.style.cssText = [
    'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
    `background:${bg}`, 'color:#fff', 'padding:12px 22px',
    'border-radius:999px', 'font-size:14px', 'font-weight:600',
    'z-index:999999', 'box-shadow:0 4px 20px rgba(0,0,0,0.25)',
    'display:flex', 'align-items:center', 'gap:8px',
    'white-space:nowrap', 'pointer-events:none',
    'animation:ffToastIn .2s ease'
  ].join(';');
  toast.innerHTML = `<span style="font-size:16px;">${icon}</span><span>${String(msg).replace(/</g,'&lt;')}</span>`;

  // Add animation
  if (!document.getElementById('ff-toast-style')) {
    const s = document.createElement('style');
    s.id = 'ff-toast-style';
    s.textContent = '@keyframes ffToastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
    document.head.appendChild(s);
  }

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity .3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/** Custom confirm for tickets: always use in-app modal, never browser confirm. */
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

// =====================
// UI: List
// =====================
function formatLineForList(l) {
  const name = escapeHtml(l.serviceName || '');
  const base = Number(l.catalogPrice) || 0;
  const adj = Number(l.ticketPrice) || 0;
  if (l.isOverride && base !== adj) {
    return `${name} <span style="font-size:11px;color:#d97706;" title="Price adjusted">(base $${base.toFixed(0)} → $${adj.toFixed(0)})</span>`;
  }
  return `${name} $${adj.toFixed(0)}`;
}

function getInitial(name) {
  if (!name || typeof name !== 'string') return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0][0] || '?').toUpperCase();
}

function renderTicketsList() {
  const listEl = document.getElementById('ticketsList');
  const loadingEl = document.getElementById('ticketsLoading');
  const emptyEl = document.getElementById('ticketsEmpty');
  const summaryPanel = document.getElementById('ticketsSummaryPanel');
  if (!listEl) return;

  updateTicketsTabsVisibility();
  if (currentTicketsTab === 'summary' && !canViewTicketsSummaryTab()) {
    currentTicketsTab = 'ready';
    document.querySelectorAll('.tickets-tab').forEach(b => b.classList.remove('active'));
    const rb = document.querySelector('.tickets-tab[data-tab="ready"]');
    if (rb) rb.classList.add('active');
  } else if (currentTicketsTab === 'archived' && !canViewTicketsArchivedTab()) {
    currentTicketsTab = 'ready';
    document.querySelectorAll('.tickets-tab').forEach(b => b.classList.remove('active'));
    const rb = document.querySelector('.tickets-tab[data-tab="ready"]');
    if (rb) rb.classList.add('active');
  }

  if (currentTicketsTab === 'summary') {
    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'none';
    if (summaryPanel) summaryPanel.style.display = 'block';
    listEl.innerHTML = '';
    listEl.classList.remove('tickets-list--closed', 'tickets-list--archived');
    const timePeriodWrap = document.getElementById('ticketsTimePeriodWrap');
    if (timePeriodWrap) timePeriodWrap.style.display = 'flex';
    syncTicketsTimePeriodSelectOptions();
    const periodSel = document.getElementById('ticketsTimePeriodSelect');
    const customWrap = document.getElementById('ticketsTimePeriodCustomWrap');
    if (periodSel && customWrap) {
      customWrap.style.display = periodSel.value === 'custom' ? 'inline-flex' : 'none';
    }
    populateTicketsEmployeeSelect();
    updateTicketsEmployeeFilterVisibility();
    void loadAndRenderTicketsSummary();
    updateTicketsLoadMoreUi();
    return;
  }
  if (summaryPanel) summaryPanel.style.display = 'none';

  if (!_ticketsListSnapshotReady) {
    if (loadingEl) loadingEl.style.display = 'block';
    if (emptyEl) emptyEl.style.display = 'none';
    listEl.innerHTML = '';
    updateTicketsLoadMoreUi();
    return;
  }

  const statusFilter = { ready: 'READY_FOR_CHECKOUT', closed: 'CLOSED', archived: 'ARCHIVED' }[currentTicketsTab] || 'READY_FOR_CHECKOUT';
  let toShow = currentTicketsTab === 'archived'
    ? currentTickets.filter(t => t.status === 'ARCHIVED')
    : currentTicketsTab === 'closed'
    ? currentTickets.filter(t => t.status === 'CLOSED' || t.status === 'VOID')
    : currentTickets.filter(t => t.status === statusFilter);
  toShow = toShow.filter(t => canSeeTicket(t));

  const timePeriodWrap = document.getElementById('ticketsTimePeriodWrap');
  const showDateFilters = currentTicketsTab === 'closed' || currentTicketsTab === 'archived';
  if (timePeriodWrap) timePeriodWrap.style.display = showDateFilters ? 'flex' : 'none';
  if (showDateFilters) syncTicketsTimePeriodSelectOptions();
  const periodSel = document.getElementById('ticketsTimePeriodSelect');
  const customWrap = document.getElementById('ticketsTimePeriodCustomWrap');
  if (showDateFilters && periodSel && customWrap) {
    customWrap.style.display = periodSel.value === 'custom' ? 'inline-flex' : 'none';
  }

  const fromEl = document.getElementById('ticketsFilterDateFrom');
  const toEl = document.getElementById('ticketsFilterDateTo');
  const fromStr = showDateFilters && fromEl ? (fromEl.value || '').trim() : '';
  const toStr = showDateFilters && toEl ? (toEl.value || '').trim() : '';
  const hasDateFilter = showDateFilters && (fromStr || toStr);
  const countAfterStatus = toShow.length;
  if (hasDateFilter) {
    toShow = toShow.filter(t => passesTicketsDateFilter(t, fromStr, toStr));
  }
  if (showDateFilters) populateTicketsEmployeeSelect();
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

  listEl.classList.toggle('tickets-list--closed', currentTicketsTab === 'closed');
  listEl.classList.toggle('tickets-list--archived', currentTicketsTab === 'archived');

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
    const isAdminOrOwner = currentUserProfile && ['owner', 'admin'].includes((currentUserProfile.role || '').toLowerCase());
    const showDeleteBtn = currentTicketsTab === 'archived' && isAdminOrOwner;
    const isCreator = currentUserProfile && (
      t.createdByUid === currentUserProfile.uid ||
      t.technicianStaffId === currentUserProfile.staffId ||
      t.technicianStaffId === currentUserProfile.uid ||
      t.finalizedByUid === currentUserProfile.uid ||
      (t.technicianName && (
        (currentUserProfile.email && String(t.technicianName).toLowerCase().includes(String(currentUserProfile.email).toLowerCase())) ||
        (currentUserProfile.name && String(t.technicianName).toLowerCase().includes(String(currentUserProfile.name).toLowerCase()))
      ))
    );
    const canEdit = isCreator && t.status !== 'CLOSED' && t.status !== 'ARCHIVED' && t.status !== 'VOID';
    const editBtnHtml = canEdit
      ? `<button type="button" class="ticket-edit-btn" data-ticket-id="${t.id}" title="Edit ticket" style="padding:6px;background:none;border:none;cursor:pointer;flex-shrink:0;color:#9ca3af;line-height:0;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`
      : '';
    const isAdminOrManager = currentUserProfile && ['owner', 'admin', 'manager'].includes((currentUserProfile.role || '').toLowerCase());
    const canSeeEditedFlag = isAdminOrManager;
    const isReady = sk === 'ready';
    const showEdited = canSeeEditedFlag && isReady && !!t.editedAfterFinalize;
    const editedBadgeHtml = showEdited ? '<span class="ticket-edited-badge">Edited</span>' : '';
    const customerApprovedBadgeHtml = (t.customerApprovedPrice === true)
      ? '<span class="ticket-customer-approved-badge" title="Customer approved the price">Approved</span>'
      : '';
    const technicianAvatarUrl = getTicketTechnicianAvatarUrl(t);
    const avatarHtml = technicianAvatarUrl
      ? `<div style="width:40px;height:40px;border-radius:50%;overflow:hidden;flex-shrink:0;"><img src="${String(technicianAvatarUrl).replace(/"/g,'&quot;')}" alt="" style="width:100%;height:100%;object-fit:cover;"></div>`
      : `<div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#9d68b9,#ff9580);color:#fff;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${initial}</div>`;

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

    return `
    <div class="ticket-card" data-ticket-id="${t.id}">
      <!-- Header row -->
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;">
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
          ${customerApprovedBadgeHtml}
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
  `}).join('');

  listEl.querySelectorAll('.ticket-card').forEach(card => {
    const ticketId = card.getAttribute('data-ticket-id');
    card.onclick = (e) => {
      if (e.target.closest('.ticket-delete-btn')) return;
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
  currentTicketsTab = t;
  document.querySelectorAll('.tickets-tab').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.tickets-tab[data-tab="${t}"]`);
  if (btn) btn.classList.add('active');
  renderTicketsList();
}

// =====================
// UI: Ticket Modal (create/edit)
// =====================
function openTicketModal(ticketId, appointmentData = null) {
  editingTicketId = ticketId || null;
  window._ticketModalAppointmentData = appointmentData || null;
  const modal = document.getElementById('ticketModal');
  const title = document.getElementById('ticketModalTitle');
  if (!modal || !title) return;

  if (editingTicketId) {
    const t = currentTickets.find(x => x.id === editingTicketId);
    if (!t) return;
    if (!canSeeTicket(t)) {
      showToast('You cannot view this ticket.', 'error');
      return;
    }
    const s = (t.status || '').toUpperCase();
    if (s === 'CLOSED' || s === 'VOID' || s === 'ARCHIVED') {
      if (_justClosedTicketId === editingTicketId) {
        _justClosedTicketId = null;
        return;
      }
      openTicketDetailsModal(t);
      return;
    }

    // Admin/manager/owner viewing a READY ticket → simplified view with Close Ticket only
    const profileRole = (currentUserProfile?.role || '').toLowerCase();
    const isAdminOrManager = ['owner', 'admin', 'manager'].includes(profileRole);
    if (isAdminOrManager && s === 'READY_FOR_CHECKOUT') {
      if (!t.seenByFrontDeskAt) {
        _ticketsOpenedThisSession.add(t.id);
        t.seenByFrontDeskAt = true;
        updateTicketsNavBadge();
        markTicketSeenByFrontDesk(t.id).catch(() => {});
      }
      openAdminTicketView(t);
      return;
    }

    if (s === 'READY_FOR_CHECKOUT' && !t.seenByFrontDeskAt) {
      _ticketsOpenedThisSession.add(t.id);
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
        content.innerHTML = booked.map(s => `<div style="font-size:13px;">${escapeHtml(s.name || s.serviceName)} — $${(s.price || 0).toFixed(2)}</div>`).join('');
        content.style.display = 'none';
      }
    }
  }
  modal.style.display = 'flex';
}

/** Admin/manager view: read-only ticket with ONLY Close Ticket button.
 *  Uses existing modal elements — does NOT replace innerHTML. */
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
        <span style="font-weight:700;color:${adjusted ? '#d97706' : '#111'};">$${price.toFixed(2)}${adjusted ? ` <small style="color:#9ca3af;">(base $${base.toFixed(2)})</small>` : ''}</span>
      </div>`;
    }).join('') || '<div style="color:#9ca3af;font-size:14px;padding:8px 0;">No services</div>';
  }

  // Hide lines data and service picker
  const linesData = document.getElementById('ticketLinesData');
  if (linesData) linesData.value = JSON.stringify(lines);

  const picker = document.getElementById('ticketServicePickerContainer');
  if (picker) picker.style.display = 'none';

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

  // AS IS message
  const asIsMsgBlock = document.getElementById('ticketAsIsMessageBlock');
  const asIsMsgText  = document.getElementById('ticketAsIsMessageText');
  if (asIsMsgBlock && asIsMsgText) {
    if (t.asIs && t.asIsMessage) {
      asIsMsgText.textContent = t.asIsMessage;
      asIsMsgBlock.style.display = 'block';
    } else {
      asIsMsgBlock.style.display = 'none';
    }
  }
  const asIsClearBtn = document.getElementById('ticketAsIsClearBtn');
  if (asIsClearBtn) asIsClearBtn.style.display = 'none';

  // Show total
  const totalBlock = document.getElementById('ticketTotalBlock');
  const totalAmt   = document.getElementById('ticketTotalAmount');
  if (totalBlock) totalBlock.style.display = lines.length > 0 ? 'block' : 'none';
  if (totalAmt)   totalAmt.textContent = '$' + total.toFixed(2);

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

  // Hide all action buttons except Close
  ['ticketSendNewBtn','ticketSaveBtn','ticketFinalizeBtn','ticketArchiveBtn',
   'ticketDeleteBtn','ticketAsIsBtn'].forEach(id => {
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
    }
  }
  editingTicketId = null;
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
    const priceText = hasOverride ? `base $${basePrice.toFixed(2)} → $${tickPrice.toFixed(2)}` : `$${tickPrice.toFixed(2)}`;
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
        <span>$${ticketTotalAmount.toFixed(2)}</span>
      </div>`
    : '';
  let diffHtml = '';
  if (hasDiff) {
    const parts = [];
    (diff.removed || []).forEach(r => parts.push(`<div style="color:#dc2626;font-size:13px;">Removed: ${escapeHtml(r.name)}</div>`));
    (diff.added || []).forEach(a => parts.push(`<div style="color:#059669;font-size:13px;">Added: ${escapeHtml(a.name)} ($${(a.price || 0).toFixed(2)})</div>`));
    (diff.changed || []).forEach(c => parts.push(`<div style="color:#d97706;font-size:13px;">Changed: ${escapeHtml(c.name)} → $${(c.to || 0).toFixed(2)}</div>`));
    diffHtml = `<div style="margin-top:16px;"><h3 style="font-size:14px;font-weight:600;margin-bottom:8px;color:#374151;">Changes vs booked</h3><div style="background:#f9fafb;border-radius:8px;padding:12px;">${parts.join('')}</div></div>`;
  }
  const asIsHtml = (t.asIs && t.asIsMessage) ? `<div style="margin-top:16px;font-size:13px;color:#059669;background:#d1fae5;padding:10px 12px;border-radius:8px;"><strong>AS IS:</strong> ${escapeHtml(t.asIsMessage)}</div>` : '';
  contentEl.innerHTML = `
    <div style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:16px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px;">
        <div><div style="color:#6b7280;margin-bottom:4px;">Submitted time</div><div style="font-weight:500;">${createdDate.toLocaleDateString()} ${createdDate.toLocaleTimeString()}</div></div>
        <div><div style="color:#6b7280;margin-bottom:4px;">Submitted by</div><div style="font-weight:500;">${escapeHtml(t.technicianName || '—')}</div></div>
        <div><div style="color:#6b7280;margin-bottom:4px;">Status</div><div style="font-weight:500;">${escapeHtml(statusLabel)}</div></div>
        <div><div style="color:#6b7280;margin-bottom:4px;">Customer</div><div style="font-weight:500;">${escapeHtml(t.customerName || '—')}</div></div>
      </div>
    </div>
    <div style="margin-bottom:16px;"><h3 style="font-size:14px;font-weight:600;margin-bottom:8px;color:#374151;">Performed services</h3>${performedHtml || '<div style="color:#9ca3af;font-size:13px;">None</div>'}${totalHtml}</div>
    ${diffHtml}
    ${asIsHtml}
  `;
  const isAdminOrOwner = currentUserProfile && ['owner', 'admin'].includes((currentUserProfile.role || '').toLowerCase());
  let actionsHtml = '';
  if ((t.status === 'CLOSED' || t.status === 'VOID') && isAdminOrOwner) {
    actionsHtml += `<button type="button" id="ticketDetailsArchiveBtn" style="padding:8px 16px;border:1px solid #9ca3af;border-radius:6px;background:#fff;cursor:pointer;font-size:14px;">Archive</button>`;
  }
  if (t.status === 'ARCHIVED' && isAdminOrOwner) {
    actionsHtml += `<button type="button" id="ticketDetailsDeleteBtn" style="padding:8px 16px;border:1px solid #ef4444;border-radius:6px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:14px;">Delete</button>`;
  }
  actionsHtml += `<button type="button" id="ticketDetailsCloseBtn" style="padding:8px 16px;border:none;border-radius:6px;background:#7c3aed;color:#fff;cursor:pointer;font-size:14px;font-weight:600;">Close</button>`;
  actionsEl.innerHTML = actionsHtml;
  const archiveBtn = document.getElementById('ticketDetailsArchiveBtn');
  const deleteBtn = document.getElementById('ticketDetailsDeleteBtn');
  const closeBtn = document.getElementById('ticketDetailsCloseBtn');
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

function resetTicketForm() {
  const set = (id, fn) => { const el = document.getElementById(id); if (el) fn(el); };
  set('ticketCustomerName', el => { el.value = ''; });
  set('ticketCustomerWrap', el => { el.style.display = 'none'; });
  set('ticketCustomerToggle', el => { el.textContent = '+ Optional: Customer / Client'; });
  set('ticketPerformedList', el => { el.innerHTML = ''; });
  set('ticketLinesData', el => { el.value = '[]'; });
  set('ticketAsBookedBlock', el => { el.style.display = 'none'; });
  set('ticketAsBookedNone', el => { el.style.display = 'block'; });
  const asIsMsgBlock = document.getElementById('ticketAsIsMessageBlock');
  const asIsClearBtn = document.getElementById('ticketAsIsClearBtn');
  if (asIsMsgBlock) asIsMsgBlock.style.display = 'none';
  if (asIsClearBtn) asIsClearBtn.style.display = 'none';
  set('ticketCustomerPriceApproved', el => { el.checked = false; });
  set('ticketAdminPriceApprovalBlock', el => { el.style.display = 'none'; el.innerHTML = ''; });
  const finalizeBtn = document.getElementById('ticketFinalizeBtn');
  const closeBtn = document.getElementById('ticketCloseBtn');
  const sendNewBtn = document.getElementById('ticketSendNewBtn');
  const asIsBtn = document.getElementById('ticketAsIsBtn');
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
  if (asIsBtn) asIsBtn.style.display = 'none';
  // Collapse all service category sections when opening a new ticket
  const picker = document.getElementById('ticketServicePickerContainer');
  if (picker) {
    picker.querySelectorAll('.ticket-category-body').forEach((body) => { body.style.display = 'none'; });
    picker.querySelectorAll('.ticket-cat-arrow').forEach((arrow) => { arrow.textContent = '▶'; });
  }
  updateTicketDiff();
  setupTicketFormToggles();
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
    el.innerHTML = booked.map(s => `<div style="font-size:13px;">${escapeHtml(s.name || s.serviceName)} — $${(s.price || 0).toFixed(2)}</div>`).join('');
    el.style.display = 'none';
  });
  set('ticketAsBookedToggle', el => { el.textContent = 'Show As Booked'; });
  const lines = t.performedLines || [];
  set('ticketLinesData', el => { el.value = JSON.stringify(lines); });
  const isReadOnly = ['CLOSED', 'VOID', 'ARCHIVED'].includes((t.status || '').toUpperCase());
  renderPerformedLines(lines, isReadOnly);
  const servicePickerContainer = document.getElementById('ticketServicePickerContainer');
  const customerToggle = document.getElementById('ticketCustomerToggle');
  const customerInput = document.getElementById('ticketCustomerName');
  if (servicePickerContainer) servicePickerContainer.style.display = isReadOnly ? 'none' : 'block';
  if (customerToggle) customerToggle.style.display = isReadOnly ? 'none' : '';
  if (customerInput) customerInput.readOnly = isReadOnly;
  updateTicketTotal(lines);
  const asIsMsgBlock = document.getElementById('ticketAsIsMessageBlock');
  const asIsMsgText = document.getElementById('ticketAsIsMessageText');
  if (asIsMsgBlock && asIsMsgText) {
    if (t.asIs && t.asIsMessage) {
      asIsMsgText.textContent = t.asIsMessage;
      asIsMsgBlock.style.display = 'block';
    } else {
      asIsMsgBlock.style.display = 'none';
    }
  }
  const asIsClearBtn = document.getElementById('ticketAsIsClearBtn');
  if (asIsClearBtn) asIsClearBtn.style.display = 'none';

  const isCreator = currentUserProfile && (
    t.createdByUid === currentUserProfile.uid ||
    t.technicianStaffId === currentUserProfile.staffId ||
    t.technicianStaffId === currentUserProfile.uid ||
    t.finalizedByUid === currentUserProfile.uid ||
    (t.technicianName && (
      (currentUserProfile.email && String(t.technicianName).toLowerCase().includes(String(currentUserProfile.email).toLowerCase())) ||
      (currentUserProfile.name && String(t.technicianName).toLowerCase().includes(String(currentUserProfile.name).toLowerCase()))
    ))
  );
  const canViewTicket = canSeeTicket(t);
  const canSaveEdits = (isCreator || canViewTicket) && (t.status === 'OPEN' || t.status === 'READY_FOR_CHECKOUT');
  const isAdminOrOwner = currentUserProfile && ['owner', 'admin'].includes((currentUserProfile.role || '').toLowerCase());
  // Only manager/admin/owner can close ticket; technicians must not see Close button (use role + staff isManager/isAdmin)
  let canCloseTicket = false;
  if (currentUserProfile) {
    const role = (currentUserProfile.role || '').toLowerCase();
    if (['owner', 'admin', 'manager'].includes(role)) canCloseTicket = true;
    if (!canCloseTicket) {
      try {
        const store = typeof window.ffGetStaffStore === 'function' ? window.ffGetStaffStore() : null;
        const staffList = store?.staff || [];
        const staff = staffList.find(s =>
          (currentUserProfile.staffId && s.id === currentUserProfile.staffId) ||
          (currentUserProfile.email && s.email && String(s.email).toLowerCase() === String(currentUserProfile.email).toLowerCase())
        );
        if (staff && (staff.isManager === true || staff.isAdmin === true)) canCloseTicket = true;
      } catch (_) {}
    }
  }
  const finalizeBtn = document.getElementById('ticketFinalizeBtn');
  const closeBtn = document.getElementById('ticketCloseBtn');
  const archiveBtn = document.getElementById('ticketArchiveBtn');
  const deleteBtn = document.getElementById('ticketDeleteBtn');
  const sendNewBtn = document.getElementById('ticketSendNewBtn');
  const asIsBtn = document.getElementById('ticketAsIsBtn');
  const saveBtn = document.getElementById('ticketSaveBtn');
  if (finalizeBtn) finalizeBtn.style.display = (t.status === 'OPEN') ? 'inline-block' : 'none';
  if (closeBtn) closeBtn.style.display = (t.status === 'READY_FOR_CHECKOUT' && canCloseTicket) ? 'inline-block' : 'none';
  if (archiveBtn) archiveBtn.style.display = (t.status === 'CLOSED' || t.status === 'VOID') && isAdminOrOwner ? 'inline-block' : 'none';
  if (deleteBtn) deleteBtn.style.display = t.status === 'ARCHIVED' && isAdminOrOwner ? 'inline-block' : 'none';
  if (sendNewBtn) sendNewBtn.style.display = 'none';
  if (asIsBtn) asIsBtn.style.display = 'none';
  if (saveBtn) {
    saveBtn.style.display = canSaveEdits ? 'inline-block' : 'none';
    saveBtn.textContent = t.status === 'READY_FOR_CHECKOUT' ? 'Save changes' : 'Save';
  }
  if (finalizeBtn) finalizeBtn.onclick = () => doFinalizeTicket(t.id);
  if (closeBtn) closeBtn.onclick = () => doCloseTicket(t.id);
  if (archiveBtn) archiveBtn.onclick = async () => { try { await archiveTicket(t.id); showToast('Ticket archived', 'success'); closeTicketModal(); } catch (e) { showToast(e?.message || 'Failed', 'error'); } };
  if (deleteBtn) deleteBtn.onclick = async () => { const ok = await ticketConfirm('Permanently delete this ticket? This cannot be undone.', 'Delete ticket'); if (!ok) return; try { await deleteTicketPermanently(t.id); showToast('Ticket deleted', 'success'); closeTicketModal(); } catch (e) { showToast(e?.message || 'Failed', 'error'); } };
  setupTicketFormToggles();
}

function renderPerformedLines(lines, readOnly = false) {
  const cont = document.getElementById('ticketPerformedList');
  if (!cont) return;
  if (readOnly) {
    cont.innerHTML = lines.map((l) => {
      const tickPrice = Number(l.ticketPrice) || 0;
      const basePrice = Number(l.catalogPrice) || 0;
      const hasOverride = basePrice > 0 && basePrice !== tickPrice;
      const priceText = hasOverride ? `base $${basePrice.toFixed(2)} → $${tickPrice.toFixed(2)}` : `$${tickPrice.toFixed(2)}`;
      const notePart = l.note ? ` <span style="color:#6b7280;font-size:11px;">— ${escapeHtml(l.note)}</span>` : '';
      return `<div style="padding:6px 10px;background:#f9fafb;border-radius:6px;margin-bottom:4px;font-size:12px;">${escapeHtml(l.serviceName)} — ${priceText}${notePart}</div>`;
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
      <span style="flex:1;min-width:100px;font-size:12px;font-weight:500;">${escapeHtml(l.serviceName)}</span>
      <span style="font-size:10px;color:#9ca3af;">base $${catPrice.toFixed(2)}</span>
      <label style="display:flex;align-items:center;gap:4px;font-size:12px;">
        <span style="color:#6b7280;">$</span>
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
  (diff.added || []).forEach(a => parts.push(`<div style="color:#059669;font-size:13px;">Added: ${escapeHtml(a.name)} ($${(a.price || 0).toFixed(2)})</div>`));
  (diff.changed || []).forEach(c => parts.push(`<div style="color:#d97706;font-size:13px;">Changed: ${escapeHtml(c.name)} → $${(c.to || 0).toFixed(2)}</div>`));
  if (hasLines && typeof total === 'number') {
    parts.push(`<div style="margin-top:10px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:15px;font-weight:700;color:#166534;">Total: $${total.toFixed(2)}</div>`);
  }
  cont.innerHTML = parts.length ? parts.join('') : '<div style="color:#9ca3af;font-size:13px;">No changes</div>';
}

function addServiceToTicket(service) {
  const lines = JSON.parse(document.getElementById('ticketLinesData').value || '[]');
  const price = Number(service.defaultPrice) || 0;
  lines.push({
    serviceId: service.id,
    serviceName: service.name,
    catalogPrice: price,
    ticketPrice: price,
    isOverride: false,
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
  const total = arr.reduce((sum, l) => sum + (Number(l.ticketPrice) || 0), 0);
  const block = document.getElementById('ticketTotalBlock');
  const amountEl = document.getElementById('ticketTotalAmount');
  if (block) block.style.display = arr.length > 0 ? 'block' : 'none';
  if (amountEl) amountEl.textContent = '$' + total.toFixed(2);
  const sendNewBtn = document.getElementById('ticketSendNewBtn');
  const priceWrap = document.getElementById('ticketCustomerPriceApprovedWrap');
  if (priceWrap && sendNewBtn) {
    const isNewTicketFlow = sendNewBtn.style.display !== 'none';
    const showApproval = isNewTicketFlow && (arr.length > 0 || ticketFormAsIsMode);
    priceWrap.style.display = showApproval ? 'block' : 'none';
    if (!showApproval) {
      const cb = document.getElementById('ticketCustomerPriceApproved');
      if (cb) cb.checked = false;
    }
  }
}

async function saveTicket() {
  const customerNameEl = document.getElementById('ticketCustomerName');
  const customerName = customerNameEl ? customerNameEl.value.trim() : '';
  const { uids: forUids, names: forNames } = await getAutoFrontDeskRecipients();
  const linesEl = document.getElementById('ticketLinesData');
  const lines = linesEl ? JSON.parse(linesEl.value || '[]') : [];
  const total = lines.reduce((sum, l) => sum + (Number(l.ticketPrice) || 0), 0);

  try {
    if (editingTicketId) {
      await updateTicket(editingTicketId, {
        customerName,
        performedLines: lines,
        total,
        forUids,
        forNames
      });
      const t = currentTickets.find(x => x.id === editingTicketId);
      if (t && (String(t.status || '').toUpperCase() === 'READY_FOR_CHECKOUT') && !t.seenByFrontDeskAt) {
        _ticketsOpenedThisSession.add(editingTicketId);
        t.seenByFrontDeskAt = true;
        updateTicketsNavBadge();
        const { isPrimaryAdmin } = getTicketVisibility();
        if (isPrimaryAdmin) markTicketSeenByFrontDesk(editingTicketId).catch(() => {});
      }
      showToast('Ticket updated', 'success');
    } else {
      await createTicket({
        customerName,
        performedLines: lines,
        total,
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

/** Called from modal AS IS button. Uses stored appointment if opened with one, else null. */
async function doSendAsIsFromModal() {
  if (!currentUserProfile?.salonId) {
    showToast('Please wait – user profile loading…', 'error');
    return;
  }
  const appointmentData = window._ticketModalAppointmentData || null;
  const customerEl = document.getElementById('ticketCustomerName');
  const customerName = customerEl ? customerEl.value.trim() : '';
  const ok = await doSendAsIsTicket(appointmentData, customerName);
  if (ok) closeTicketModal();
}

/** Quick AS IS: no manual entry. With appointment: copy As Booked to Performed. Without: empty performed. */
async function doSendAsIsTicket(appointmentData = null, customerName = '') {
  const { uids: forUids, names: forNames } = await getAutoFrontDeskRecipients();
  let performedLines = [];
  let appointmentId = null;
  const cust = (customerName || appointmentData?.customerName || '').trim();
  if (appointmentData && Array.isArray(appointmentData.services) && appointmentData.services.length > 0) {
    appointmentId = appointmentData.id || null;
    performedLines = (appointmentData.services || []).map(s => ({
      serviceId: s.id || null,
      serviceName: s.name || s.serviceName,
      catalogPrice: Number(s.price) || 0,
      ticketPrice: Number(s.price) || 0,
      isOverride: false,
      note: null
    }));
  }
  const total = performedLines.reduce((sum, l) => sum + (Number(l.ticketPrice) || 0), 0);
  try {
    await createTicket({
      customerName: cust,
      performedLines,
      total,
      forUids,
      forNames,
      status: 'READY_FOR_CHECKOUT',
      asIs: true,
      appointmentId,
      appointmentData: appointmentData || null,
      customerApprovedPrice: getTicketCustomerPriceApprovedFromForm()
    });
    showToast('AS IS ticket sent to Front Desk', 'success');
    return true;
  } catch (err) {
    showToast(err?.message || 'Failed', 'error');
    return false;
  }
}

async function doSendNewTicket() {
  const customerNameEl = document.getElementById('ticketCustomerName');
  const customerName = customerNameEl ? customerNameEl.value.trim() : '';
  if (ticketFormAsIsMode) {
    const ok = await doSendAsIsFromModal();
    if (ok) closeTicketModal();
    return;
  }
  const { uids: forUids, names: forNames } = await getAutoFrontDeskRecipients();
  const linesEl = document.getElementById('ticketLinesData');
  const lines = linesEl ? JSON.parse(linesEl.value || '[]') : [];
  if (lines.length === 0) {
    showToast('Add at least one service or select "Services stay exactly as booked"', 'error');
    return;
  }
  const total = lines.reduce((sum, l) => sum + (Number(l.ticketPrice) || 0), 0);
  try {
    await createTicket({
      customerName,
      performedLines: lines,
      total,
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
  const { uids: forUids, names: forNames } = await getAutoFrontDeskRecipients();
  const ok = await ticketConfirm('Send this ticket to Front Desk?', 'Send to Front Desk');
  if (!ok) return;
  try {
    await finalizeTicket(ticketId, forUids, forNames);
    showToast('Ticket sent to Front Desk', 'success');
    closeTicketModal();
  } catch (err) {
    showToast(err?.message || 'Failed', 'error');
  }
}

async function doCloseTicket(ticketId) {
  const ok = await ticketConfirm('Mark this ticket as Closed? (Checkout done)', 'Close ticket');
  if (!ok) return;
  _justClosedTicketId = ticketId;
  closeTicketModal();
  editingTicketId = null;
  try {
    await closeTicket(ticketId);
    showToast('Ticket closed', 'success');
  } catch (err) {
    showToast(err?.message || 'Failed', 'error');
    _justClosedTicketId = null;
  }
  setTimeout(() => { _justClosedTicketId = null; }, 1500);
}

// =====================
// UI: Service Catalog Modal
// =====================
let editingServiceId = null;

async function openServicesModal() {
  const modal = document.getElementById('servicesModal');
  if (!modal) return;
  editingServiceId = null;
  await loadServiceCategories();
  showServicesCatalogPanel();
  const nameEl = document.getElementById('serviceFormName');
  const priceEl = document.getElementById('serviceFormPrice');
  if (nameEl) nameEl.value = '';
  if (priceEl) priceEl.value = '';
  populateServiceCategoryDropdown(null);
  renderServicesList();
  modal.style.display = 'flex';
  const catTab = document.getElementById('servicesCategoriesTab');
  const svcTab = document.getElementById('servicesCatalogTab');
  if (svcTab) svcTab.onclick = showServicesCatalogPanel;
  if (catTab) catTab.onclick = () => { showCategoriesPanel(); };
}

function showServicesCatalogPanel() {
  const panel = document.getElementById('servicesCatalogPanel');
  const catPanel = document.getElementById('servicesCategoriesPanel');
  const tabBtn = document.getElementById('servicesCatalogTab');
  const catTabBtn = document.getElementById('servicesCategoriesTab');
  if (panel) { panel.style.display = 'block'; panel.style.flex = '1'; }
  if (catPanel) catPanel.style.display = 'none';
  if (tabBtn) { tabBtn.style.borderBottom = '2px solid #111'; tabBtn.style.fontWeight = '600'; tabBtn.style.color = '#111'; }
  if (catTabBtn) { catTabBtn.style.borderBottom = '2px solid transparent'; catTabBtn.style.fontWeight = '500'; catTabBtn.style.color = '#6b7280'; }
}

function showCategoriesPanel() {
  const panel = document.getElementById('servicesCatalogPanel');
  const catPanel = document.getElementById('servicesCategoriesPanel');
  const tabBtn = document.getElementById('servicesCatalogTab');
  const catTabBtn = document.getElementById('servicesCategoriesTab');
  if (panel) panel.style.display = 'none';
  if (catPanel) { catPanel.style.display = 'block'; catPanel.style.flex = '1'; }
  if (tabBtn) { tabBtn.style.borderBottom = '2px solid transparent'; tabBtn.style.fontWeight = '500'; tabBtn.style.color = '#6b7280'; }
  if (catTabBtn) { catTabBtn.style.borderBottom = '2px solid #111'; catTabBtn.style.fontWeight = '600'; catTabBtn.style.color = '#111'; }
  renderCategoriesList();
}

function populateServiceCategoryDropdown(selectedId) {
  const sel = document.getElementById('serviceFormCategory');
  if (!sel) return;
  const ADD_NEW = '__add_new__';
  let opts = '<option value="">Other</option>';
  serviceCategories.forEach((c) => { opts += `<option value="${c.id}">${escapeHtml(c.name)}</option>`; });
  opts += `<option value="${ADD_NEW}">+ Add new category</option>`;
  sel.innerHTML = opts;
  sel.value = selectedId || '';
  sel.onchange = () => {
    if (sel.value === ADD_NEW) {
      const name = prompt('Category name:');
      if (name && name.trim()) {
        saveServiceCategory({ name: name.trim(), sortOrder: serviceCategories.length }).then(async (id) => {
          await loadServiceCategories();
          populateServiceCategoryDropdown(id);
          renderServicesList();
          setupTicketsUI();
          showToast('Category added', 'success');
        }).catch((e) => showToast(e?.message || 'Failed', 'error'));
      }
      sel.value = '';
    }
  };
}

async function addServiceCategory() {
  const inp = document.getElementById('newCategoryName');
  const name = inp?.value?.trim();
  if (!name) { showToast('Enter category name', 'error'); return; }
  try {
    await saveServiceCategory({ name, sortOrder: serviceCategories.length });
    await loadServiceCategories();
    if (inp) inp.value = '';
    renderCategoriesList();
    populateServiceCategoryDropdown(null);
    setupTicketsUI();
    showToast('Category added', 'success');
  } catch (e) { showToast(e?.message || 'Failed', 'error'); }
}

function renderCategoriesList() {
  const list = document.getElementById('categoriesList');
  if (!list) return;
  if (serviceCategories.length === 0) {
    list.innerHTML = '<div style="padding:16px;color:#9ca3af;">No categories. Add one above.</div>';
  } else {
    list.innerHTML = serviceCategories.map((c) => {
      const count = salonServices.filter(s => s.categoryId === c.id).length;
      const pencilSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" style="display:block;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
      const trashSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" style="display:block;"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px;border-bottom:1px solid #eee;"><div><strong style="font-size:13px !important;">${escapeHtml(c.name)}</strong><span style="color:#9ca3af;font-size:13px;margin-left:8px;">${count} service(s)</span></div><div style="display:flex;gap:8px;"><button type="button" class="cat-edit-btn" data-id="${c.id}" title="Edit" style="padding:6px;border:none;background:none;cursor:pointer;line-height:0;">${pencilSvg}</button><button type="button" class="cat-delete-btn" data-id="${c.id}" title="Delete" style="padding:6px;border:none;background:none;cursor:pointer;line-height:0;">${trashSvg}</button></div></div>`;
    }).join('');
    list.querySelectorAll('.cat-edit-btn').forEach((btn) => {
      btn.onclick = () => {
        const c = serviceCategories.find(x => x.id === btn.getAttribute('data-id'));
        if (!c) return;
        const name = prompt('Category name:', c.name);
        if (name != null && name.trim()) {
          saveServiceCategory({ id: c.id, name: name.trim(), sortOrder: c.sortOrder }).then(async () => {
            await loadServiceCategories();
            renderCategoriesList();
            populateServiceCategoryDropdown(null);
            renderServicesList();
            setupTicketsUI();
            showToast('Updated', 'success');
          }).catch((e) => showToast(e?.message || 'Failed', 'error'));
        }
      };
    });
    list.querySelectorAll('.cat-delete-btn').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute('data-id');
        try {
          await deleteServiceCategory(id);
          await loadServiceCategories();
          renderCategoriesList();
          populateServiceCategoryDropdown(null);
          renderServicesList();
          setupTicketsUI();
          showToast('Category deleted', 'success');
        } catch (e) { showToast(e?.message || 'Failed', 'error'); }
      };
    });
  }
}

function closeServicesModal() {
  const modal = document.getElementById('servicesModal');
  if (modal) modal.style.display = 'none';
}

function renderServicesList() {
  const list = document.getElementById('servicesList');
  if (!list) return;
  const grouped = getServicesGroupedByCategory();
  if (Object.keys(grouped).length === 0) {
    list.innerHTML = '<div style="padding:16px;color:#9ca3af;">No services yet. Add one below.</div>';
  } else {
    let html = '';
    Object.entries(grouped).forEach(([key, data], idx) => {
      const label = escapeHtml(data.label || 'Other');
      const services = data.services || [];
      html += `<div class="services-category-section" data-cat-idx="${idx}" style="margin-bottom:6px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">`;
      html += `<div class="services-category-header" style="display:flex;align-items:center;gap:4px;padding:3px 6px;font-size:10px !important;font-weight:600;color:#374151;background:#f9fafb;">${label}</div>`;
      html += '<div style="padding:2px 6px 4px;display:flex;flex-direction:column;gap:2px;">';
      const pencilSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" style="display:block;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
      const trashSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" style="display:block;"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
      services.forEach((s) => {
        html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 4px;border-bottom:1px solid #f3f4f6;font-size:11px;"><div><strong style="font-size:11px !important;font-weight:600;">${escapeHtml(s.name)}</strong><span style="color:#6b7280;font-size:8px !important;margin-left:5px;">$${(s.defaultPrice || 0).toFixed(2)}</span></div><div style="display:flex;gap:9px;"><button type="button" class="services-edit-btn" data-id="${s.id}" title="Edit" style="padding:2px;border:none;background:none;cursor:pointer;line-height:0;">${pencilSvg}</button><button type="button" class="services-delete-btn" data-id="${s.id}" title="Delete" style="padding:2px;border:none;background:none;cursor:pointer;line-height:0;">${trashSvg}</button></div></div>`;
      });
      html += '</div></div>';
    });
    list.innerHTML = html;
  }
  list.querySelectorAll('.services-edit-btn').forEach(btn => {
    btn.onclick = () => {
      const s = salonServices.find(x => x.id === btn.getAttribute('data-id'));
      if (s) {
        editingServiceId = s.id;
        const nameEl = document.getElementById('serviceFormName');
        const catEl = document.getElementById('serviceFormCategory');
        const priceEl = document.getElementById('serviceFormPrice');
        if (nameEl) nameEl.value = s.name || '';
        populateServiceCategoryDropdown(s.categoryId || '');
        if (priceEl) priceEl.value = (s.defaultPrice || 0).toString();
      }
    };
  });
  list.querySelectorAll('.services-delete-btn').forEach(btn => {
    btn.onclick = async () => {
      const ok = await ticketConfirm('Delete this service?', 'Delete service');
      if (!ok) return;
      const id = btn.getAttribute('data-id');
      try {
        await deleteService(id);
        await loadServices();
        renderServicesList();
        showToast('Service deleted', 'success');
      } catch (e) {
        showToast(e?.message || 'Failed', 'error');
      }
    };
  });
}

async function saveServiceFromForm() {
  const name = document.getElementById('serviceFormName').value.trim();
  if (!name) { showToast('Enter service name', 'error'); return; }
  const catSel = document.getElementById('serviceFormCategory');
  const categoryId = (catSel?.value || '').trim() || null;
  const defaultPrice = parseFloat(document.getElementById('serviceFormPrice').value) || 0;
  const isEdit = !!editingServiceId;
  try {
    await saveService(editingServiceId ? { id: editingServiceId, name, categoryId, defaultPrice } : { name, categoryId, defaultPrice });
    await loadServices();
    renderServicesList();
    const nameEl = document.getElementById('serviceFormName');
    const catEl = document.getElementById('serviceFormCategory');
    const priceEl = document.getElementById('serviceFormPrice');
    if (nameEl) nameEl.value = '';
    populateServiceCategoryDropdown(null);
    if (priceEl) priceEl.value = '';
    editingServiceId = null;
    showToast(isEdit ? 'Updated' : 'Service added', 'success');
    setupTicketsUI(); // refresh dropdown in ticket form
  } catch (e) {
    showToast(e?.message || 'Failed', 'error');
  }
}

// =====================
// Navigation
// =====================
export function goToTickets() {
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
  const ticketsScreen = document.getElementById('ticketsScreen');

  const manageQueueScreen = document.getElementById('manageQueueScreen');
  [tasksScreen, ownerView, joinBar, queueControls, userProfileScreen, inboxScreen, chatScreen, mediaScreen, trainingScreen, scheduleScreen, manageQueueScreen].forEach(el => {
    if (el) el.style.display = 'none';
  });
  if (wrap) wrap.style.display = 'none';

  const headerEl = document.querySelector('.header');
  if (headerEl) {
    document.documentElement.style.setProperty('--header-h', `${headerEl.offsetHeight}px`);
  }

  if (ticketsScreen) {
    ticketsScreen.style.display = 'flex';
    ticketsScreen.style.setProperty('pointer-events', 'auto', 'important');
  }

  // When any other nav button is clicked:
  // 1. Hide tickets screen
  // 2. Unsubscribe from tickets if NOT admin (badge not needed)
  const NAV_IDS = ['queueBtn','tasksBtn','chatBtn','inboxBtn','logBtn','appsBtn'];
  NAV_IDS.forEach(id => {
    const btn = document.getElementById(id);
    if (btn && !btn._ffTicketsHideHandler) {
      btn._ffTicketsHideHandler = () => {
        if (ticketsScreen) ticketsScreen.style.display = 'none';
        // For non-admins: unsubscribe so the nav badge doesn't update
        const { isPrimaryAdmin } = getTicketVisibility();
        if (!isPrimaryAdmin && typeof ticketsUnsubscribe === 'function') {
          ticketsUnsubscribe();
          ticketsUnsubscribe = null;
          currentTickets = [];
        }
        // Always enforce badge state
        updateTicketsNavBadge();
      };
      btn.addEventListener('click', btn._ffTicketsHideHandler, { capture: true });
    }
  });

  document.querySelectorAll('.btn-pill').forEach(b => b.classList.remove('active'));
  const ticketsBtn = document.getElementById('ticketsBtn');
  if (ticketsBtn) ticketsBtn.classList.add('active');

  if (_ticketsDataReady && currentUserProfile) {
    enrichTicketsProfileFromMemberDoc()
      .then(() => setupTicketsUI())
      .then(() => {
        subscribeTickets({ resetLoading: true });
        renderTicketsList();
        updateTicketsNavBadge();
      })
      .catch((err) => {
        console.error('[Tickets] setupTicketsUI failed', err);
      });
  } else {
    loadCurrentUserProfile().then(async () => {
      await enrichTicketsProfileFromMemberDoc();
      await loadServiceCategories();
      await loadServices();
      await setupTicketsUI();
      _ticketsDataReady = true;
      subscribeTickets({ resetLoading: true });
      renderTicketsList();
      loadTicketsMembersForAvatars().then(() => renderTicketsList());
      updateTicketsNavBadge();
    }).catch((err) => {
      console.error('[Tickets] goToTickets init failed', err);
    });
  }
}

const AS_IS_OPTION_VALUE = '__as_is__';
const AS_IS_OPTION_LABEL = 'Services stay exactly as booked — no changes';

function doAsIsSelect() {
  ticketFormAsIsMode = true;
  document.getElementById('ticketLinesData').value = '[]';
  document.getElementById('ticketPerformedList').innerHTML = '';
  const asIsMsgBlock = document.getElementById('ticketAsIsMessageBlock');
  const asIsMsgText = document.getElementById('ticketAsIsMessageText');
  const asIsClearBtn = document.getElementById('ticketAsIsClearBtn');
  if (asIsMsgBlock && asIsMsgText) {
    asIsMsgText.textContent = 'Service matches system billing';
    asIsMsgBlock.style.display = 'block';
    if (asIsClearBtn) {
      asIsClearBtn.style.display = 'inline-block';
      asIsClearBtn.onclick = () => {
        ticketFormAsIsMode = false;
        asIsMsgBlock.style.display = 'none';
        asIsClearBtn.style.display = 'none';
        updateTicketDiff();
      };
    }
  }
  updateTicketDiff();
}

function doServiceSelect(svc) {
  ticketFormAsIsMode = false;
  const asIsMsgBlock = document.getElementById('ticketAsIsMessageBlock');
  const asIsClearBtn = document.getElementById('ticketAsIsClearBtn');
  if (asIsMsgBlock) asIsMsgBlock.style.display = 'none';
  if (asIsClearBtn) asIsClearBtn.style.display = 'none';
  if (svc) addServiceToTicket(svc);
}

async function setupTicketsUI() {
  const container = document.getElementById('ticketServicePickerContainer');
  if (!container) return;
  const grouped = getServicesGroupedByCategory();
  let html = `<div style="padding:6px 8px;background:#f0fdf4;border-bottom:1px solid #e5e7eb;font-size:11px;font-weight:600;color:#166534;cursor:pointer;" onclick="window.ffDoAsIsSelect && window.ffDoAsIsSelect()">✓ ${AS_IS_OPTION_LABEL}</div>`;
  Object.entries(grouped).forEach(([key, data], idx) => {
    const label = escapeHtml(data.label || 'Other');
    html += `<div class="ticket-category-section" data-cat-idx="${idx}" style="border-bottom:1px solid #e5e7eb;">`;
    html += `<div class="ticket-category-header" role="button" tabindex="0" style="display:flex;align-items:center;gap:4px;padding:6px 8px;cursor:pointer;user-select:none;font-size:11px;font-weight:600;color:#374151;background:#f9fafb;"><span class="ticket-cat-arrow" style="font-size:9px;color:#6b7280;">▶</span><span>${label}</span></div>`;
    html += `<div class="ticket-category-body" style="display:none;padding:4px 8px 8px 16px;background:#fff;">`;
    (data.services || []).forEach((s) => {
      html += `<button type="button" class="ticket-service-btn" data-id="${s.id}" style="display:block;width:100%;text-align:left;padding:5px 8px;margin-bottom:3px;border:1px solid #e5e7eb;border-radius:4px;background:#fff;cursor:pointer;font-size:12px;transition:background 0.15s;">${escapeHtml(s.name)} <span style="color:#6b7280;font-size:11px;">$${(s.defaultPrice || 0).toFixed(2)}</span></button>`;
    });
    html += '</div></div>';
  });
  container.innerHTML = html;
  container.querySelectorAll('.ticket-service-btn').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      const svc = salonServices.find((x) => x.id === id);
      doServiceSelect(svc);
    };
  });
  window.ffDoAsIsSelect = doAsIsSelect;
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
    const profileRole = (currentUserProfile?.role || '').toLowerCase();
    const canManage = ['admin', 'owner', 'manager'].includes(profileRole);
    manageServicesBtn.style.display = canManage ? 'flex' : 'none';
    manageServicesBtn.onclick = openServicesModal;
    if (canManage) {
      // Align gear precisely under user avatar on any screen/DPI
      requestAnimationFrame(() => _alignGearToAvatar());
    }
  }
  updateTicketsTabsVisibility();
  const newTicketBtn = document.getElementById('ticketsNewBtn');
  if (newTicketBtn) {
    // Hide for admin/manager/owner based on FIRESTORE profile role
    // (not PIN actor — the logged-in Firebase user determines this)
    const profileRole = (currentUserProfile?.role || '').toLowerCase();
    const isFirebaseAdmin = ['owner', 'admin', 'manager'].includes(profileRole);
    newTicketBtn.style.display = isFirebaseAdmin ? 'none' : 'inline-block';
  }
}

// =====================
// Init
// =====================
export function initTickets() {
  setupTicketsDateFilters();
  document.querySelectorAll('.tickets-tab').forEach(btn => {
    btn.onclick = () => setTicketsTab(btn.getAttribute('data-tab'));
  });
  const newBtn = document.getElementById('ticketsNewBtn');
  if (newBtn) newBtn.onclick = () => openTicketModal();
  window.goToTickets = goToTickets;
  window.doSendAsIsTicket = doSendAsIsTicket;
  window.doSendAsIsFromModal = doSendAsIsFromModal;
  window.closeTicketModal = closeTicketModal;
  window.closeTicketDetailsModal = closeTicketDetailsModal;
  window.saveTicket = saveTicket;
  window.closeServicesModal = closeServicesModal;
  window.saveServiceFromForm = saveServiceFromForm;
  window.addServiceCategory = addServiceCategory;
  window.updateTicketsNavBadge = updateTicketsNavBadge;
  window.ffRefreshTicketsTabVisibility = () => {
    updateTicketsTabsVisibility();
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

  // Background subscription for badge — ONLY for admin/manager/owner (Firestore role)
  // This shows the badge in real-time even when not on the Tickets screen
  onAuthStateChanged(auth, (user) => {
    if (!user) return;
    setTimeout(() => {
      loadCurrentUserProfile().then(() => {
        const profileRole = (currentUserProfile?.role || '').toLowerCase();
        const isFirebaseAdmin = ['owner', 'admin', 'manager'].includes(profileRole);
        if (isFirebaseAdmin) {
          subscribeTickets(); // real-time badge for admin/manager
        }
      }).catch(() => {});
    }, 1000);
  });

  console.log('[Tickets] Initialized');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTickets);
} else {
  initTickets();
}
