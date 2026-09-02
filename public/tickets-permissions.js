/**
 * Tickets — permissions, front-desk recipients & ticket visibility (Phase 1 extraction).
 *
 * Verbatim move of the permission / front-desk / visibility cluster from tickets.js.
 * No behavior change. `normalizeTicketTechName` stays in tickets.js (used widely there)
 * and is injected via initTicketsPermissions to avoid a circular import.
 */
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";

let normalizeTicketTechName;
export function initTicketsPermissions(deps) {
  normalizeTicketTechName = deps.normalizeTicketTechName;
}

// =====================
// Front Desk Recipients (Send To)
// =====================

async function loadFrontDeskRecipients() {
  if (!ticketsState.currentUserProfile?.salonId) return [];
  if (ticketsState._frontDeskCache) return ticketsState._frontDeskCache;
  try {
    const snap = await getDocs(collection(db, `salons/${ticketsState.currentUserProfile.salonId}/members`));
    const store = typeof window.ffGetStaffStore === 'function' ? window.ffGetStaffStore() : null;
    const staffList = store?.staff || [];
    ticketsState._frontDeskCache = snap.docs
      .filter(d => d.id !== ticketsState.currentUserProfile.uid)
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
    ticketsState._frontDeskCache = [];
  }
  return ticketsState._frontDeskCache;
}

/** Auto recipients: creator + all Staff with Receives Tickets ON + Owner/Admin/Manager. No manual selection. */
async function getAutoFrontDeskRecipients() {
  const salonId = ticketsState.currentUserProfile?.salonId || (typeof window !== 'undefined' && window.currentSalonId);
  if (!salonId) return { uids: [], names: [] };
  const seen = new Set();
  const uids = []; const names = [];
  const add = (uid, name) => {
    if (!uid || seen.has(uid)) return;
    seen.add(uid);
    uids.push(uid);
    names.push((name || '').trim() || 'Front Desk');
  };
  add(ticketsState.currentUserProfile.uid, ticketsState.currentUserProfile.name || ticketsState.currentUserProfile.email);
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
    const uid = ticketsState.currentUserProfile?.uid ? String(ticketsState.currentUserProfile.uid).trim() : '';
    const sid = ticketsState.currentUserProfile?.staffId != null ? String(ticketsState.currentUserProfile.staffId).trim() : '';
    const email = ticketsState.currentUserProfile?.email ? String(ticketsState.currentUserProfile.email).toLowerCase().trim() : '';
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
  const p = ticketsState.currentUserProfile?.permissions;
  if (p && typeof p === 'object') return p;
  return {};
}

/** Owner / Admin (Firestore role) always see the tab; Manager and others use staff permissions. */
function canViewTicketsSummaryTab() {
  if (!ticketsState.currentUserProfile) return false;
  if (typeof window.ffIsOwner === 'function' && window.ffIsOwner()) return true;
  const role = (ticketsState.currentUserProfile.role || '').toLowerCase();
  if (role === 'owner' || role === 'admin') return true;
  return getTicketsStaffPermissions().tickets_summary === true;
}

/** Owner / Admin (Firestore role) always see the tab; Manager and others use staff permissions (tickets_archived). */
function canViewTicketsArchivedTab() {
  if (!ticketsState.currentUserProfile) return false;
  if (typeof window.ffIsOwner === 'function' && window.ffIsOwner()) return true;
  const role = (ticketsState.currentUserProfile.role || '').toLowerCase();
  if (role === 'owner' || role === 'admin') return true;
  return getTicketsStaffPermissions().tickets_archived === true;
}

function canCurrentUserCloseTickets() {
  if (!ticketsState.currentUserProfile) return false;
  const role = (ticketsState.currentUserProfile.role || '').toLowerCase();
  if (['owner', 'admin', 'manager'].includes(role)) return true;
  try {
    const staff = _ticketsCurrentStaffRow();
    return !!(staff && (staff.isManager === true || staff.isAdmin === true));
  } catch (_) {
    return false;
  }
}

function updateTicketsTabsVisibility() {
  const archivedTab = document.getElementById('ticketsArchivedTab');
  const summaryTab = document.getElementById('ticketsSummaryTab');
  const showArchived = canViewTicketsArchivedTab();
  const showSummary = canViewTicketsSummaryTab();
  /* Let stylesheet control tab layout (flex on .tickets-tab). inline-block overrides mobile flex and can clip labels. */
  if (archivedTab) archivedTab.style.display = showArchived ? '' : 'none';
  if (summaryTab) {
    // Always set label in JS so cached HTML (old "SUM" shortcut) still shows full "Summary".
    summaryTab.textContent = 'Summary';
    summaryTab.style.display = showSummary ? '' : 'none';
  }
}

/** Show or hide the full-width filters strip below tabs (Summary / Closed date filters). */
function ffTicketsSetTimePeriodFiltersVisible(want) {
  const row = document.getElementById('ticketsFiltersRow');
  const wrap = document.getElementById('ticketsTimePeriodWrap');
  if (row) row.style.display = want ? 'flex' : 'none';
  if (wrap) wrap.style.display = want ? 'flex' : 'none';
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
  const r = (ticketsState.currentUserProfile?.role || '').toLowerCase().trim();
  return (
    r === 'technician' ||
    r === 'tech' ||
    r === 'staff' ||
    r === 'service_provider' ||
    r === 'service provider'
  );
}

/** Narrow screens: hide front-desk date/employee row for restricted roles (Closed/Archived). */
function ffTicketsIsMobileViewport() {
  try {
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia('(max-width: 639px)').matches;
    }
  } catch (_) {}
  return typeof window !== 'undefined' && Number(window.innerWidth || 0) <= 639;
}

function ffTicketsHideFrontDeskFiltersOnThisView() {
  return (
    ffTicketsIsMobileViewport() &&
    isTicketsTechnicianRestrictedRole() &&
    !isStaffRecordManagerOrAdmin() &&
    (ticketsState.currentTicketsTab === 'closed' || ticketsState.currentTicketsTab === 'archived')
  );
}

/** Matches ticket.technicianStaffId to staff doc id, falling back to auth uid (same as new tickets). */
function getTicketsSelfEmployeeFilterId() {
  if (!ticketsState.currentUserProfile) return 'all';
  if (ticketsState.currentUserProfile.staffId != null && String(ticketsState.currentUserProfile.staffId).trim() !== '') {
    return String(ticketsState.currentUserProfile.staffId).trim();
  }
  return String(ticketsState.currentUserProfile.uid);
}

/** Only tickets assigned to this technician: technicianStaffId === staffId or auth uid; if missing id, exact name/email vs their staff row (no substring match). */
function ticketBelongsToTicketsTechnician(ticket) {
  if (!ticketsState.currentUserProfile || !ticket) return false;
  const techRaw = ticket.technicianStaffId;
  const techId =
    techRaw != null && String(techRaw).trim() !== '' ? String(techRaw).trim() : '';
  if (techId) {
    const uid = String(ticketsState.currentUserProfile.uid || '').trim();
    const sid =
      ticketsState.currentUserProfile.staffId != null && String(ticketsState.currentUserProfile.staffId).trim() !== ''
        ? String(ticketsState.currentUserProfile.staffId).trim()
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

/** Current active branch. Tickets with a locationId that doesn't match are
 *  hidden; legacy tickets without a locationId are shown in every branch so
 *  older data doesn't disappear from the UI. */
function getActiveLocationIdForTickets() {
  try {
    if (typeof window === 'undefined') return null;
    if (typeof window.ffGetActiveLocationId === 'function') {
      const v = window.ffGetActiveLocationId();
      if (typeof v === 'string' && v) return v;
    }
    if (typeof window.__ff_active_location_id === 'string' && window.__ff_active_location_id) {
      return window.__ff_active_location_id;
    }
  } catch (_) {}
  return null;
}

/** Returns true if current user can see this ticket.
 *  Uses FIRESTORE profile role for admin/manager check — not PIN actor.
 *  This ensures admin always sees all tickets regardless of PIN state. */
function canSeeTicket(ticket) {
  if (!ticketsState.currentUserProfile) return false;
  // Location scope gate:
  //  • Stamped tickets must match the active branch (if any).
  //  • Legacy tickets without a locationId are visible in single-branch
  //    mode but hidden from multi-branch users (matches Inventory policy
  //    so cross-branch revenue/bills don't leak into the wrong branch).
  const activeLoc = getActiveLocationIdForTickets();
  if (!activeLoc && ticket) {
    let viewerIsMultiBranch = false;
    try {
      if (typeof window !== 'undefined' && typeof window.ffUserHasMultipleLocations === 'function') {
        viewerIsMultiBranch = !!window.ffUserHasMultipleLocations();
      }
    } catch (_) {}
    if (viewerIsMultiBranch) return false;
  }
  if (activeLoc && ticket) {
    const ticketLoc = typeof ticket.locationId === 'string' ? ticket.locationId : '';
    if (ticketLoc && ticketLoc !== activeLoc) {
      return false;
    }
    if (!ticketLoc) {
      let viewerIsMultiBranch = false;
      try {
        if (typeof window !== 'undefined' && typeof window.ffUserHasMultipleLocations === 'function') {
          viewerIsMultiBranch = !!window.ffUserHasMultipleLocations();
        }
      } catch (_) {}
      if (viewerIsMultiBranch) return false;
    }
  }
  // Firestore role: admin/owner/manager always see all tickets
  const profileRole = (ticketsState.currentUserProfile.role || '').toLowerCase();
  if (['owner', 'admin', 'manager'].includes(profileRole)) return true;
  if (isStaffRecordManagerOrAdmin()) return true;
  if (isTicketsTechnicianRestrictedRole()) {
    return ticketBelongsToTicketsTechnician(ticket);
  }
  if (ticket.createdByUid === ticketsState.currentUserProfile.uid) return true;
  return false;
}

export {
  loadFrontDeskRecipients,
  getAutoFrontDeskRecipients,
  getTicketVisibility,
  _ticketsCurrentStaffRow,
  getTicketsStaffPermissions,
  canViewTicketsSummaryTab,
  canViewTicketsArchivedTab,
  canCurrentUserCloseTickets,
  updateTicketsTabsVisibility,
  ffTicketsSetTimePeriodFiltersVisible,
  isStaffRecordManagerOrAdmin,
  isTicketsTechnicianRestrictedRole,
  ffTicketsIsMobileViewport,
  ffTicketsHideFrontDeskFiltersOnThisView,
  getTicketsSelfEmployeeFilterId,
  ticketBelongsToTicketsTechnician,
  updateTicketsEmployeeFilterVisibility,
  getActiveLocationIdForTickets,
  canSeeTicket,
};
