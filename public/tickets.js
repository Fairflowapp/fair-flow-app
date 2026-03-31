/**
 * Tickets Module
 * Internal documentation of services performed + prices for POS reconciliation.
 * SEPARATE from appointments – never modifies schedule/duration/order.
 *
 * Firestore: salons/{salonId}/services (Service Catalog)
 *            salons/{salonId}/tickets
 */

import {
  collection, query, where, orderBy, limit,
  addDoc, updateDoc, setDoc, doc, getDoc, getDocFromServer, getDocs, deleteDoc, onSnapshot,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth } from "./app.js?v=20260329_training_fix1";

// =====================
// State
// =====================
let currentUserProfile = null;
let salonServices = [];
let serviceCategories = [];
let currentTickets = [];
let ticketsUnsubscribe = null;
let currentTicketsTab = 'ready';
let editingTicketId = null;
let ticketFormAsIsMode = false;
/** When set, opening this ticket (e.g. from list) must not show Ticket Details – we just closed it. */
let _justClosedTicketId = null;
/** Cache for member avatars (uid/staffId -> { avatarUrl, avatarUpdatedAtMs }) for ticket list. */
let _ticketsMembersAvatarCache = null;
/** Ticket IDs opened this session (so badge count drops immediately without waiting for Firestore). */
let _ticketsOpenedThisSession = new Set();

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

/** Load members with avatarUrl for ticket list avatars. */
async function loadTicketsMembersForAvatars() {
  const salonId = currentUserProfile?.salonId || (typeof window !== 'undefined' && window.currentSalonId);
  if (!salonId) return;
  try {
    const snap = await getDocs(collection(db, `salons/${salonId}/members`));
    const byKey = {};
    snap.docs.forEach(d => {
      const u = d.data() || {};
      const uid = d.id;
      const staffId = u.staffId || '';
      const avatarUrl = u.photoURL || u.avatarUrl || null;
      const avatarUpdatedAtMs = u.avatarUpdatedAtMs != null ? u.avatarUpdatedAtMs : null;
      if (avatarUrl) {
        byKey[uid] = { avatarUrl, avatarUpdatedAtMs };
        if (staffId) byKey[staffId] = { avatarUrl, avatarUpdatedAtMs };
      }
    });
    _ticketsMembersAvatarCache = byKey;
    if (typeof window.ffPrimeAvatarDirectory === 'function') {
      window.ffPrimeAvatarDirectory(snap.docs.map(d => ({ uid: d.id, ...d.data() })));
    }
  } catch (e) {
    console.warn('[Tickets] loadTicketsMembersForAvatars failed', e);
    _ticketsMembersAvatarCache = {};
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
    return window.ffGetCurrentUserAvatarUrl();
  }
  if (typeof window.ffGetAvatarUrlForUser === 'function') {
    return window.ffGetAvatarUrlForUser({
      uid: t.createdByUid || t.finalizedByUid || '',
      staffId: t.technicianStaffId || '',
      name: t.technicianName || '',
      photoURL: '',
      avatarUpdatedAtMs: null
    });
  }
  if (!_ticketsMembersAvatarCache || !t.technicianStaffId) return null;
  const entry = _ticketsMembersAvatarCache[t.technicianStaffId];
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
        const hasReceivesTickets = staff?.permissions?.tickets_receives === true;
        const isFrontDesk = ['admin', 'owner', 'manager'].includes(role) || hasReceivesTickets;
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
      const hasReceivesTickets = staff?.permissions?.tickets_receives === true;
      const isManagerOrAbove = ['owner', 'admin', 'manager'].includes(role);
      const isRecipient = isManagerOrAbove || hasReceivesTickets;
      if (isRecipient) add(d.id, (u.name || '').trim());
    });
  } catch (_) {}
  return { uids, names };
}

/** Returns { isPrimaryAdmin, hasReceivesTickets } for current user.
 *  ONLY uses PIN Actor system — whoever entered their PIN right now.
 *  Never falls back to Firebase Auth owner role. */
function getTicketVisibility() {
  // Use PIN Actor role exclusively
  const actorRole = window.__ff_actorRole
    || window.lastActorRole
    || (typeof getCurrentActorRole === 'function' ? getCurrentActorRole() : null)
    || 'Tech';

  const isPrimaryAdmin = actorRole === 'Admin' || actorRole === 'Manager';

  let hasReceivesTickets = false;
  try {
    const store = typeof window.ffGetStaffStore === 'function' ? window.ffGetStaffStore() : null;
    const staffList = store?.staff || [];
    const staff = staffList.find(s =>
      (currentUserProfile?.staffId && s.id === currentUserProfile.staffId) ||
      (currentUserProfile?.email && s.email && String(s.email).toLowerCase() === String(currentUserProfile.email).toLowerCase())
    );
    hasReceivesTickets = staff?.permissions?.tickets_receives === true;
  } catch (_) {}

  return { isPrimaryAdmin, hasReceivesTickets };
}

/** Returns true if current user can see this ticket.
 *  Uses FIRESTORE profile role for admin/manager check — not PIN actor.
 *  This ensures admin always sees all tickets regardless of PIN state. */
function canSeeTicket(ticket) {
  if (!currentUserProfile) return false;
  // Firestore role: admin/owner/manager always see all tickets
  const profileRole = (currentUserProfile.role || '').toLowerCase();
  if (['owner', 'admin', 'manager'].includes(profileRole)) return true;
  // Technician: can see their own tickets
  if (ticket.createdByUid === currentUserProfile.uid) return true;
  // Staff with receives-tickets permission
  const { hasReceivesTickets } = getTicketVisibility();
  if (hasReceivesTickets) return true;
  return false;
}

// =====================
// Tickets CRUD
// =====================
function subscribeTickets() {
  const salonId = currentUserProfile?.salonId
    || (typeof window !== 'undefined' && window.currentSalonId)
    || null;
  if (!salonId) {
    console.warn('[Tickets] No salonId. Retrying in 1s...');
    setTimeout(subscribeTickets, 1000);
    return;
  }
  if (ticketsUnsubscribe) ticketsUnsubscribe();
  const q = query(
    collection(db, `salons/${salonId}/tickets`),
    orderBy('createdAt', 'desc'),
    limit(200)
  );
  ticketsUnsubscribe = onSnapshot(q, (snap) => {
    currentTickets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (editingTicketId) {
      const t = currentTickets.find(x => x.id === editingTicketId);
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
  }, (err) => console.error('[Tickets] subscribe error', err));
}

/** Red dot + number on TICKETS nav for manager/admin. Counts Ready tickets not yet opened (Firestore seenByFrontDeskAt OR opened this session). */
function updateTicketsNavBadge() {
  const badge = document.getElementById('ticketsNavBadge');
  if (!badge) return;
  // Badge only for admin/manager by Firestore role, regardless of active tab.
  const profileRole = (currentUserProfile?.role || '').toLowerCase();
  const shouldShowBadge = ['admin', 'manager'].includes(profileRole);
  if (!shouldShowBadge) {
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

async function createTicket(payload) {
  const salonId = currentUserProfile?.salonId || (typeof window !== 'undefined' && window.currentSalonId);
  if (!salonId) throw new Error('No salon - ensure your account has salonId');
  const status = payload.status === 'READY_FOR_CHECKOUT' ? 'READY_FOR_CHECKOUT' : 'OPEN';
  const doc = {
    status,
    asIs: payload.asIs === true,
    asIsMessage: payload.asIs === true ? (payload.asIsMessage || 'Service matches system billing') : null,
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

async function closeTicket(ticketId) {
  const closedByName = currentUserProfile?.name || currentUserProfile?.email || 'Manager';
  await updateTicket(ticketId, {
    status: 'CLOSED',
    closedByUid: currentUserProfile.uid,
    closedByName,
    _action: 'closed'
  });
}

async function voidTicket(ticketId) {
  await updateTicket(ticketId, { status: 'VOID', _action: 'voided' });
}

async function archiveTicket(ticketId) {
  await updateTicket(ticketId, { status: 'ARCHIVED', archivedByUid: currentUserProfile.uid, _action: 'archived' });
}

async function deleteTicketPermanently(ticketId) {
  const salonId = currentUserProfile?.salonId || (typeof window !== 'undefined' && window.currentSalonId);
  if (!salonId || !ticketId) return;
  const ticketRef = doc(db, `salons/${salonId}/tickets`, ticketId);
  await deleteDoc(ticketRef);
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

/** Align the gear icon precisely under the user avatar circle — works on any screen/DPI */
function _alignGearToAvatar() {
  const gear = document.getElementById('ticketsManageServicesBtn');
  // Target the circle itself, not the full button (which includes the ▼ arrow)
  const avatarCircle = document.querySelector('.user-avatar-circle') || document.getElementById('userAvatarBtn');
  if (!gear || !avatarCircle || gear.style.display === 'none') return;
  const circleRect = avatarCircle.getBoundingClientRect();
  const tabsRow = gear.parentElement;
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
    _fitTicketsScreenToHeader();
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
      card.innerHTML = '<h3 id="ff-confirm-title" style="margin:0 0 12px;font-size:18px;font-weight:600;color:#111;"></h3><p id="ff-confirm-msg" style="margin:0 0 24px;font-size:14px;color:#374151;line-height:1.5;"></p><div style="display:flex;justify-content:flex-end;gap:10px;"><button type="button" id="ff-confirm-cancel" style="padding:10px 20px;border:1px solid #d1d5db;background:#fff;border-radius:8px;cursor:pointer;font-size:14px;color:#374151;">Cancel</button><button type="button" id="ff-confirm-ok" style="padding:10px 20px;background:#111;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:500;">OK</button></div>';
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
  if (!listEl) return;

  const statusFilter = { ready: 'READY_FOR_CHECKOUT', closed: 'CLOSED', archived: 'ARCHIVED' }[currentTicketsTab] || 'READY_FOR_CHECKOUT';
  let toShow = currentTicketsTab === 'archived'
    ? currentTickets.filter(t => t.status === 'ARCHIVED')
    : currentTicketsTab === 'closed'
    ? currentTickets.filter(t => t.status === 'CLOSED' || t.status === 'VOID')
    : currentTickets.filter(t => t.status === statusFilter);
  toShow = toShow.filter(t => canSeeTicket(t));

  if (loadingEl) loadingEl.style.display = 'none';
  if (emptyEl) emptyEl.style.display = toShow.length === 0 ? 'block' : 'none';

  const archivedTab = document.getElementById('ticketsArchivedTab');
  if (archivedTab) {
    const role = (currentUserProfile?.role || '').toLowerCase();
    archivedTab.style.display = (role === 'owner' || role === 'admin') ? 'inline-block' : 'none';
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
    const { hasReceivesTickets } = getTicketVisibility();
    const isAdminOrManager = currentUserProfile && ['owner', 'admin', 'manager'].includes((currentUserProfile.role || '').toLowerCase());
    const canSeeEditedFlag = isAdminOrManager || hasReceivesTickets;
    const isReady = sk === 'ready';
    const showEdited = canSeeEditedFlag && isReady && !!t.editedAfterFinalize;
    const editedBadgeHtml = showEdited ? '<span class="ticket-edited-badge">Edited</span>' : '';
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
  currentTicketsTab = tab;
  document.querySelectorAll('.tickets-tab').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.tickets-tab[data-tab="${tab}"]`);
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
    <div style="margin-bottom:16px;"><h3 style="font-size:14px;font-weight:600;margin-bottom:8px;color:#374151;">Performed services</h3>${performedHtml || '<div style="color:#9ca3af;font-size:13px;">None</div>'}</div>
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
  actionsHtml += `<button type="button" id="ticketDetailsCloseBtn" style="padding:8px 16px;border:none;border-radius:6px;background:#111;color:#fff;cursor:pointer;font-size:14px;">Close</button>`;
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
  setupTicketFormToggles();
}

function populateTicketForm(t) {
  const s = (t.status || '').toUpperCase();
  if (s === 'CLOSED' || s === 'VOID' || s === 'ARCHIVED') {
    closeTicketModal();
    openTicketDetailsModal(t);
    return;
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
        const { isPrimaryAdmin, hasReceivesTickets } = getTicketVisibility();
        if (isPrimaryAdmin || hasReceivesTickets) markTicketSeenByFrontDesk(editingTicketId).catch(() => {});
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
      appointmentData: appointmentData || null
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
      status: 'READY_FOR_CHECKOUT'
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
/** Set ticketsScreen top = actual header height (works on Mac Retina + Windows) */
function _fitTicketsScreenToHeader() {
  const screen = document.getElementById('ticketsScreen');
  if (!screen || screen.dataset.dynamicTop !== 'true') return;
  const header = document.querySelector('.header');
  if (header) {
    const h = Math.ceil(header.getBoundingClientRect().height);
    screen.style.top = h + 'px';
  }
}

export function goToTickets() {
  const tasksScreen = document.getElementById('tasksScreen');
  const ownerView = document.getElementById('owner-view');
  const joinBar = document.querySelector('.joinBar');
  const queueControls = document.getElementById('queueControls');
  const userProfileScreen = document.getElementById('userProfileScreen');
  const wrap = document.querySelector('.wrap');
  const inboxScreen = document.getElementById('inboxScreen');
  const chatScreen = document.getElementById('chatScreen');
  const mediaScreen = document.getElementById('mediaScreen');
  const ticketsScreen = document.getElementById('ticketsScreen');

  [tasksScreen, ownerView, joinBar, queueControls, userProfileScreen, inboxScreen, chatScreen, mediaScreen].forEach(el => {
    if (el) el.style.display = 'none';
  });
  if (wrap) wrap.style.display = 'none';

  if (ticketsScreen) {
    ticketsScreen.style.display = 'flex';
    _fitTicketsScreenToHeader(); // adjust top to actual header height on any screen
  }

  // When any other nav button is clicked:
  // 1. Hide tickets screen
  // 2. Unsubscribe from tickets if NOT admin (badge not needed)
  const NAV_IDS = ['queueBtn','tasksBtn','chatBtn','inboxBtn','mediaBtn','logBtn','appsBtn'];
  NAV_IDS.forEach(id => {
    const btn = document.getElementById(id);
    if (btn && !btn._ffTicketsHideHandler) {
      btn._ffTicketsHideHandler = () => {
        if (ticketsScreen) ticketsScreen.style.display = 'none';
        // Keep subscription alive for admin/manager so the nav badge stays visible on other tabs.
        const profileRole = (currentUserProfile?.role || '').toLowerCase();
        const shouldKeepBadgeSubscription = ['admin', 'manager'].includes(profileRole);
        if (!shouldKeepBadgeSubscription && typeof ticketsUnsubscribe === 'function') {
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

  loadCurrentUserProfile().then(async () => {
    await loadServiceCategories();
    await loadServices();
    await setupTicketsUI();
    subscribeTickets(); // subscribe for all (needed to show ticket list)
    await loadTicketsMembersForAvatars();
    renderTicketsList();
    // After profile loads, enforce badge visibility
    updateTicketsNavBadge();
  });
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
      };
    }
  }
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
  const archivedTab = document.getElementById('ticketsArchivedTab');
  if (archivedTab) {
    const role = (currentUserProfile?.role || '').toLowerCase();
    const isAdminOrOwner = currentUserProfile && (role === 'owner' || role === 'admin');
    archivedTab.style.display = isAdminOrOwner ? 'inline-block' : 'none';
  }
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
