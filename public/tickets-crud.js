/**
 * Tickets — CRUD + live listener layer (Phase 4 extraction).
 *
 * Verbatim move from tickets.js of the ticket write/lifecycle system: local
 * pagination merge + patch, "Load more" paging, the live onSnapshot listener,
 * nav badge, create/update/finalize, close + summary append, reopen/void/archive,
 * service-upgrade flag + upgrade-points award, permanent delete + summary markers,
 * and front-desk "seen".
 *
 * Depends on ticketsState + TICKETS_PAGE_SIZE (state) and canSeeTicket +
 * getActiveLocationIdForTickets (permissions). Seven helpers that live in
 * tickets.js are injected via initTicketsCrud to avoid a cycle:
 *   getActiveTicketsSalonId, notifyTicketsAnalyticsDataChanged,
 *   ticketSubmittedAtDate, _fmtYmdLocal, showToast, renderTicketsList,
 *   closeTicketModal.
 */
import {
  collection, query, where, orderBy, limit, startAfter,
  doc, getDoc, getDocFromServer, getDocs, addDoc, updateDoc, deleteField, onSnapshot,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { ticketsState, TICKETS_PAGE_SIZE } from "./tickets-state.js?v=20260630_tickets_state_split";
import { canSeeTicket, getActiveLocationIdForTickets } from "./tickets-permissions.js?v=20260901_loc_isolate";

let getActiveTicketsSalonId, notifyTicketsAnalyticsDataChanged, ticketSubmittedAtDate, _fmtYmdLocal, showToast, renderTicketsList, closeTicketModal;
export function initTicketsCrud(deps) {
  getActiveTicketsSalonId = deps.getActiveTicketsSalonId;
  notifyTicketsAnalyticsDataChanged = deps.notifyTicketsAnalyticsDataChanged;
  ticketSubmittedAtDate = deps.ticketSubmittedAtDate;
  _fmtYmdLocal = deps._fmtYmdLocal;
  showToast = deps.showToast;
  renderTicketsList = deps.renderTicketsList;
  closeTicketModal = deps.closeTicketModal;
}

// =====================
// Tickets CRUD
// =====================
function _rebuildCurrentTicketsMerged() {
  const byId = new Map();
  for (const t of ticketsState._ticketsExtraTickets) {
    if (t && t.id) byId.set(t.id, t);
  }
  for (const t of ticketsState._ticketsFirstPageTickets) {
    if (t && t.id) byId.set(t.id, t);
  }
  ticketsState.currentTickets = Array.from(byId.values()).sort((a, b) => {
    const da = ticketSubmittedAtDate(a);
    const db = ticketSubmittedAtDate(b);
    const ma = da ? da.getTime() : 0;
    const mb = db ? db.getTime() : 0;
    return mb - ma;
  });
  notifyTicketsAnalyticsDataChanged();
}

/**
 * Patch a ticket in the local pagination caches after a successful server write.
 * The live snapshot only covers the newest TICKETS_PAGE_SIZE tickets; older rows
 * loaded via "Load more" (_ticketsExtraTickets) are a static copy and never
 * refresh, so without this an archived old ticket keeps its stale CLOSED status
 * locally and "comes back" until a full reload.
 */
function ffTicketsPatchLocalTicket(ticketId, patch) {
  if (!ticketId || !patch) return false;
  // Skip FieldValue sentinels (e.g. serverTimestamp()) — they are not renderable values.
  const safe = {};
  Object.keys(patch).forEach((k) => {
    const v = patch[k];
    if (v && typeof v === 'object' && typeof v._methodName === 'string') return;
    safe[k] = v;
  });
  let touched = false;
  const apply = (arr) => {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].id === ticketId) {
        arr[i] = { ...arr[i], ...safe };
        touched = true;
      }
    }
  };
  apply(ticketsState._ticketsExtraTickets);
  apply(ticketsState._ticketsFirstPageTickets);
  return touched;
}

function ticketsActiveLocationQueryParts() {
  let loc = "";
  try { loc = String(getActiveLocationIdForTickets() || "").trim(); } catch (_) {}
  let multi = false;
  try {
    multi = typeof window !== "undefined"
      && typeof window.ffUserHasMultipleLocations === "function"
      && !!window.ffUserHasMultipleLocations();
  } catch (_) {}
  return { loc, scoped: !!(multi && loc) };
}

function ticketsListQueryConstraints() {
  const { loc, scoped } = ticketsActiveLocationQueryParts();
  return scoped
    ? [where("locationId", "==", loc), orderBy("createdAt", "desc")]
    : [orderBy("createdAt", "desc")];
}

function updateTicketsLoadMoreUi() {
  const wrap = document.getElementById('ticketsLoadMoreWrap');
  const btn = document.getElementById('ticketsLoadMoreBtn');
  if (!wrap || !btn) return;
  const onListTab = ticketsState.currentTicketsTab !== 'summary';
  const show = onListTab && ticketsState._ticketsHasMoreOlder;
  wrap.style.display = show ? 'block' : 'none';
  btn.disabled = ticketsState._ticketsLoadingMore;
  btn.textContent = ticketsState._ticketsLoadingMore ? 'Loading…' : 'Load more';
}

async function loadMoreTicketsOlder() {
  if (ticketsState._ticketsLoadingMore || !ticketsState._ticketsHasMoreOlder || !ticketsState._ticketsNextPageCursor) return;
  const salonId = ticketsState.currentUserProfile?.salonId || (typeof window !== 'undefined' && window.currentSalonId);
  if (!salonId) return;
  ticketsState._ticketsLoadingMore = true;
  updateTicketsLoadMoreUi();
  try {
    const qMore = query(
      collection(db, `salons/${salonId}/tickets`),
      ...ticketsListQueryConstraints(),
      startAfter(ticketsState._ticketsNextPageCursor),
      limit(TICKETS_PAGE_SIZE)
    );
    const batch = await getDocs(qMore);
    const newRows = batch.docs.map((d) => ({ id: d.id, ...d.data() }));
    ticketsState._ticketsExtraTickets.push(...newRows);
    if (batch.docs.length < TICKETS_PAGE_SIZE) {
      ticketsState._ticketsHasMoreOlder = false;
      ticketsState._ticketsNextPageCursor = null;
    } else {
      ticketsState._ticketsHasMoreOlder = true;
      ticketsState._ticketsNextPageCursor = batch.docs[batch.docs.length - 1];
    }
    _rebuildCurrentTicketsMerged();
    renderTicketsList();
    updateTicketsNavBadge();
  } catch (e) {
    console.error('[Tickets] load more failed', e);
    showToast(e?.message || 'Could not load more tickets', 'error');
  } finally {
    ticketsState._ticketsLoadingMore = false;
    updateTicketsLoadMoreUi();
  }
}

function subscribeTickets(options) {
  const resetLoading = !!(options && options.resetLoading);
  const salonId = getActiveTicketsSalonId();
  if (!salonId) {
    console.warn('[Tickets] No salonId. Retrying in 1s...');
    setTimeout(() => subscribeTickets(options), 1000);
    renderTicketsList();
    return;
  }
  if (ticketsState.ticketsUnsubscribe) ticketsState.ticketsUnsubscribe();
  if (resetLoading) {
    ticketsState._ticketsListSnapshotReady = false;
    ticketsState._ticketsFirstPageTickets = [];
    ticketsState._ticketsExtraTickets = [];
    ticketsState._ticketsNextPageCursor = null;
    ticketsState._ticketsHasMoreOlder = false;
    ticketsState._ticketsLoadingMore = false;
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
    ...ticketsListQueryConstraints(),
    limit(TICKETS_PAGE_SIZE)
  );
  ticketsState.ticketsUnsubscribe = onSnapshot(q, (snap) => {
    ticketsState._ticketsFirstPageTickets = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (ticketsState._ticketsExtraTickets.length === 0) {
      ticketsState._ticketsNextPageCursor =
        snap.docs.length >= TICKETS_PAGE_SIZE ? snap.docs[snap.docs.length - 1] : null;
      ticketsState._ticketsHasMoreOlder = snap.docs.length === TICKETS_PAGE_SIZE;
    }
    _rebuildCurrentTicketsMerged();
    ticketsState._ticketsListSnapshotReady = true;
    if (ticketsState.editingTicketId) {
      const t = ticketsState.currentTickets.find((x) => x.id === ticketsState.editingTicketId);
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
    ticketsState._ticketsListSnapshotReady = true;
    renderTicketsList();
  });
}

/** Red dot + number on TICKETS nav. Counts visible READY tickets, even while user is outside Tickets. */
function updateTicketsNavBadge() {
  const badge = document.getElementById('ticketsNavBadge');
  if (!badge) return;
  if (!ticketsState.currentUserProfile) {
    badge.textContent = '';
    badge.style.display = 'none';
    return;
  }
  const readyVisible = (ticketsState.currentTickets || []).filter(t => {
    if (t && t.deleted === true) return false;
    return String(t.status || '').toUpperCase() === 'READY_FOR_CHECKOUT' && canSeeTicket(t);
  });
  badge.textContent = readyVisible.length > 0 ? String(readyVisible.length) : '';
  badge.style.display = readyVisible.length > 0 ? '' : 'none';
}

function getTicketCustomerPriceApprovedFromForm() {
  const wrap = document.getElementById('ticketCustomerPriceApprovedWrap');
  const el = document.getElementById('ticketCustomerPriceApproved');
  if (!el || !wrap || wrap.style.display === 'none') return false;
  return !!el.checked;
}

async function createTicket(payload) {
  const salonId = getActiveTicketsSalonId();
  if (!salonId) throw new Error('No salon - ensure your account has salonId');
  const status = payload.status === 'READY_FOR_CHECKOUT' ? 'READY_FOR_CHECKOUT' : 'OPEN';
  const activeLocForNewTicket = getActiveLocationIdForTickets();
  let multi = false;
  try {
    multi = typeof window !== 'undefined'
      && typeof window.ffUserHasMultipleLocations === 'function'
      && !!window.ffUserHasMultipleLocations();
  } catch (_) {}
  if (multi && !activeLocForNewTicket) {
    throw new Error('No active location — cannot create a ticket');
  }
  console.log('[Tickets] createTicket → activeLocationId:', activeLocForNewTicket || '(NONE — ticket will have no locationId)');
  const doc = {
    status,
    asIs: payload.asIs === true,
    asIsMessage: payload.asIs === true ? (payload.asIsMessage || 'Service matches system billing') : null,
    customerApprovedPrice: payload.customerApprovedPrice === true,
    customerName: String(payload.customerName || '').trim(),
    appointmentId: payload.appointmentId || null,
    appointmentData: payload.appointmentData || null,
    technicianStaffId: ticketsState.currentUserProfile.staffId || ticketsState.currentUserProfile.uid,
    technicianName: ticketsState.currentUserProfile.name || ticketsState.currentUserProfile.email || 'Technician',
    performedLines: Array.isArray(payload.performedLines) ? payload.performedLines : [],
    subtotal: Number(payload.subtotal) || Number(payload.total) || 0,
    salesTax: Number(payload.salesTax) || 0,
    productTax: Number(payload.productTax) || 0,
    serviceTax: Number(payload.serviceTax) || 0,
    total: Number(payload.total) || 0,
    forUids: Array.isArray(payload.forUids) ? payload.forUids : [],
    forNames: Array.isArray(payload.forNames) ? payload.forNames : [],
    ...(activeLocForNewTicket ? { locationId: activeLocForNewTicket } : {}),
    ...(status === 'READY_FOR_CHECKOUT' && { finalizedByUid: ticketsState.currentUserProfile.uid }),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdByUid: ticketsState.currentUserProfile.uid,
    history: [{ at: Timestamp.now(), by: ticketsState.currentUserProfile.uid, byName: ticketsState.currentUserProfile.name || '', action: 'created', details: null }]
  };
  const ref = await addDoc(collection(db, `salons/${salonId}/tickets`), doc);
  return ref.id;
}

async function updateTicket(ticketId, updates) {
  const salonId = getActiveTicketsSalonId();
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
    by: ticketsState.currentUserProfile.uid,
    byName: ticketsState.currentUserProfile.name || '',
    action: updates._action || 'updated',
    details: updates._details || null
  }];
  delete updates._action;
  delete updates._details;
  delete updates.history;
  const isOnlyMarkingSeen = Object.keys(updates).length === 1 && updates.seenByFrontDeskAt !== undefined;
  const isServiceUpgradeOnly =
    (hist[hist.length - 1]?.action === 'service_upgrade_marked' ||
      hist[hist.length - 1]?.action === 'service_upgrade_cleared') &&
    Object.keys(updates).every((key) => key === 'serviceUpgrade');
  const isReviewedToggleOnly =
    (hist[hist.length - 1]?.action === 'reviewed_marked' ||
      hist[hist.length - 1]?.action === 'reviewed_cleared') &&
    Object.keys(updates).every((key) => ['reviewedByFrontDesk', 'reviewedByUid', 'reviewedByName', 'reviewedAt'].includes(key));
  const statusNow = (String(data.status || '')).toUpperCase();
  if (!isOnlyMarkingSeen && !isServiceUpgradeOnly && !isReviewedToggleOnly && statusNow === 'READY_FOR_CHECKOUT') {
    updates.editedAfterFinalize = true;
    updates.editedAt = serverTimestamp();
    // A real edit introduces new info, so any prior front-desk "Reviewed"
    // mark is no longer valid — clear it so the ticket needs re-reviewing.
    if (data.reviewedByFrontDesk === true) {
      updates.reviewedByFrontDesk = false;
      updates.reviewedByUid = null;
      updates.reviewedByName = null;
      updates.reviewedAt = null;
    }
  } else if (isServiceUpgradeOnly) {
    updates.editedAfterFinalize = false;
    updates.editedAt = null;
  }
  await updateDoc(ticketRef, {
    ...updates,
    history: hist,
    updatedAt: serverTimestamp()
  });
  // Sync the local pagination cache: tickets loaded via "Load more" are not in
  // the live snapshot window, so without this their stale copy keeps rendering.
  if (ffTicketsPatchLocalTicket(ticketId, { ...updates, history: hist })) {
    _rebuildCurrentTicketsMerged();
    renderTicketsList();
  }
}

async function finalizeTicket(ticketId, forUids, forNames, extra) {
  const updates = { status: 'READY_FOR_CHECKOUT', finalizedByUid: ticketsState.currentUserProfile.uid, _action: 'finalized' };
  if (Array.isArray(forUids) && forUids.length > 0) {
    updates.forUids = forUids;
    updates.forNames = Array.isArray(forNames) ? forNames : [];
  }
  if (extra && typeof extra.customerName === 'string' && extra.customerName.trim()) {
    updates.customerName = extra.customerName.trim();
  }
  await updateTicket(ticketId, updates);
}

/** Append-only history for Tickets Summary (not read by UI yet). */
async function appendTicketSummaryOnClose(salonId, ticketId) {
  console.log('[Tickets Summary DEBUG] appendTicketSummaryOnClose: enter', {
    salonId: salonId || '(missing)',
    ticketId: ticketId || '(missing)',
    profileRole: ticketsState.currentUserProfile?.role ?? '(no profile)'
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
      where('ticketId', '==', ticketId)
    );
    const dupSnap = await getDocs(dupQ);
    // A summary that was reversed by a reopen should not block a fresh entry when
    // the ticket is paid/closed again.
    const hasActiveSummary = dupSnap.docs.some((d) => (d.data() || {}).reopenedReversed !== true);
    if (hasActiveSummary) {
      console.log('[Tickets Summary DEBUG] appendTicketSummaryOnClose: abort — active summary exists for ticketId');
      return;
    }

    const now = new Date();
    const closedDateKey = _fmtYmdLocal(now);

    // Prefer the ticket's own locationId (set at creation) so summaries stay
    // scoped even if the user switched branches between opening and closing.
    // Fallback to the currently active branch if the ticket predates multi-branch.
    const ticketLocationId =
      typeof t.locationId === 'string' && t.locationId
        ? t.locationId
        : getActiveLocationIdForTickets();

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
      source: 'ticket_close',
      ...(ticketLocationId ? { locationId: ticketLocationId } : {})
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
      profileRole: ticketsState.currentUserProfile?.role ?? '(no profile)',
      salonId,
      ticketId
    });
    console.warn('[Tickets] ticketSummaries write failed', e);
  }
}

async function closeTicket(ticketId, preCloseFields = null) {
  const salonId = getActiveTicketsSalonId();
  const closedByName = ticketsState.currentUserProfile?.name || ticketsState.currentUserProfile?.email || 'Manager';
  console.log('[Tickets Summary DEBUG] closeTicket: before update + append', {
    salonId: salonId || '(missing)',
    ticketId: ticketId || '(missing)',
    profileRole: ticketsState.currentUserProfile?.role ?? '(no profile)',
    uid: ticketsState.currentUserProfile?.uid ?? '(no uid)'
  });
  const extra =
    preCloseFields && typeof preCloseFields === 'object'
      ? Object.fromEntries(
          Object.entries(preCloseFields).filter(([, v]) => v !== undefined)
        )
      : {};
  await updateTicket(ticketId, {
    ...extra,
    status: 'CLOSED',
    closedByUid: ticketsState.currentUserProfile.uid,
    closedByName,
    _action: 'closed'
  });
  await appendTicketSummaryOnClose(salonId, ticketId);
}

/** Mark ticketSummaries rows reversed (delete disallowed by rules). */
async function _markTicketSummariesReversed(ticketId) {
  const salonId = getActiveTicketsSalonId();
  if (!salonId || !ticketId) return;
  try {
    const sumQ = query(
      collection(db, `salons/${salonId}/ticketSummaries`),
      where('ticketId', '==', ticketId)
    );
    const sumSnap = await getDocs(sumQ);
    await Promise.all(
      sumSnap.docs.map((d) =>
        updateDoc(d.ref, {
          reopenedReversed: true,
          reopenedAt: serverTimestamp(),
          reopenedByUid: ticketsState.currentUserProfile?.uid ?? null,
          reopenedByName: ticketsState.currentUserProfile?.name || ticketsState.currentUserProfile?.email || null
        }).catch(() => {})
      )
    );
  } catch (e) {
    console.warn('[Tickets] markTicketSummariesReversed failed', e);
  }
}

// Undo an accidental "Paid Ticket" (close). Returns the ticket to the
// Ready-for-checkout state and removes the revenue summary entry created at
// close so the ticket isn't counted twice in analytics.
async function reopenTicket(ticketId) {
  await _markTicketSummariesReversed(ticketId);
  await updateTicket(ticketId, {
    status: 'READY_FOR_CHECKOUT',
    closedByUid: deleteField(),
    closedByName: deleteField(),
    reopenedByUid: ticketsState.currentUserProfile?.uid || null,
    reopenedByName: ticketsState.currentUserProfile?.name || ticketsState.currentUserProfile?.email || 'Manager',
    reopenedAt: serverTimestamp(),
    _action: 'reopened'
  });
}

async function voidTicket(ticketId) {
  const salonId = getActiveTicketsSalonId();
  if (!salonId || !ticketId) throw new Error('Missing salon or ticket');
  const ticketRef = doc(db, `salons/${salonId}/tickets`, ticketId);
  let snap;
  try {
    snap = await getDocFromServer(ticketRef);
  } catch (_) {
    snap = await getDoc(ticketRef);
  }
  if (!snap.exists()) throw new Error('Ticket not found');
  const data = snap.data() || {};
  const statusNow = String(data.status || '').toUpperCase();
  if (statusNow === 'VOID' || statusNow === 'ARCHIVED') {
    throw new Error('Ticket is already voided or archived.');
  }
  if (statusNow === 'CLOSED') {
    await _markTicketSummariesReversed(ticketId);
  }
  const voidedByName =
    ticketsState.currentUserProfile?.name || ticketsState.currentUserProfile?.email || 'Manager';
  await updateTicket(ticketId, {
    status: 'VOID',
    voidedByUid: ticketsState.currentUserProfile?.uid ?? null,
    voidedByName,
    voidedAt: serverTimestamp(),
    _action: 'voided'
  });
}

async function archiveTicket(ticketId) {
  await updateTicket(ticketId, { status: 'ARCHIVED', archivedByUid: ticketsState.currentUserProfile.uid, _action: 'archived' });
}

async function setTicketServiceUpgrade(ticketId, enabled) {
  await updateTicket(ticketId, {
    serviceUpgrade: enabled === true,
    _action: enabled ? 'service_upgrade_marked' : 'service_upgrade_cleared'
  });
}

function getTicketUpgradePointsAccountId() {
  return String(
    (typeof window !== 'undefined' && window.currentSalonId)
    || ticketsState.currentUserProfile?.salonId
    || (typeof window !== 'undefined' && (window.currentAccountId || window.accountId))
    || ''
  ).trim();
}

function getTicketUpgradePointsLocationId(ticket) {
  const fromTicket = String(ticket?.locationId || '').trim();
  if (fromTicket) return fromTicket;
  try {
    const active = getActiveLocationIdForTickets();
    if (active) return String(active).trim();
  } catch (_) {}
  return 'default';
}

async function getTicketUpgradePointsValue(accountId, locationId) {
  try {
    if (typeof window !== 'undefined' && typeof window.ffGetPointsSettings === 'function') {
      const settings = await window.ffGetPointsSettings(accountId, locationId);
      const configured = Number(settings?.ticketUpgrade);
      if (Number.isFinite(configured)) return configured;
    }
  } catch (_) {}
  try {
    const snap = await getDoc(doc(db, `accounts/${accountId}/settings/points`));
    const configured = Number((snap.data() || {}).ticketUpgrade);
    if (Number.isFinite(configured)) return configured;
  } catch (_) {}
  return 5;
}

async function awardTicketUpgradePoints(ticket) {
  try {
    if (!ticket || !ticket.id) {
      console.log('[Ticket Upgrade Points] skipped', { reason: 'missing_ticket' });
      return;
    }
    if (typeof window === 'undefined' || typeof window.ffCreatePointsEvent !== 'function') {
      console.log('[Ticket Upgrade Points] skipped', { reason: 'points_engine_unavailable', ticketId: ticket.id });
      return;
    }
    const accountId = getTicketUpgradePointsAccountId();
    const locationId = getTicketUpgradePointsLocationId(ticket);
    const staffId = String(ticket.technicianStaffId || '').trim();
    const staffName = String(ticket.technicianName || staffId || '').trim();
    if (!accountId || !locationId || !staffId) {
      console.log('[Ticket Upgrade Points] skipped', { reason: 'missing_required_fields', ticketId: ticket.id, accountId, locationId, staffId });
      return;
    }
    const points = await getTicketUpgradePointsValue(accountId, locationId);
    const result = await window.ffCreatePointsEvent({
      accountId,
      staffId,
      staffName,
      locationId,
      type: 'ticket_upgrade',
      sourceModule: 'tickets',
      sourceId: String(ticket.id),
      points,
      uniquePerSource: true
    });
    if (result?.created) {
      console.log('[Ticket Upgrade Points] awarded', { ticketId: ticket.id, staffId, points });
    } else {
      console.log('[Ticket Upgrade Points] skipped', { ticketId: ticket.id, staffId, reason: result?.reason || (result?.duplicate ? 'duplicate' : 'not_created') });
    }
  } catch (err) {
    console.warn('[Ticket Upgrade Points] error', err);
  }
}

/** Does not remove ticketSummaries; marks matching rows when the live ticket is permanently deleted. */
async function markTicketSummariesSourceDeleted(salonId, ticketId) {
  if (!salonId || !ticketId) return;
  const uid = ticketsState.currentUserProfile?.uid ?? null;
  const byName =
    ticketsState.currentUserProfile?.name || ticketsState.currentUserProfile?.email || null;
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
  const salonId = getActiveTicketsSalonId();
  if (!salonId || !ticketId) return;
  await markTicketSummariesSourceDeleted(salonId, ticketId);
  const ticketRef = doc(db, `salons/${salonId}/tickets`, ticketId);
  const deletedByUid = ticketsState.currentUserProfile?.uid ?? null;
  // Soft delete — keep the doc so Summary can still aggregate CLOSED/ARCHIVED history.
  await updateDoc(ticketRef, {
    deleted: true,
    deletedAt: serverTimestamp(),
    deletedByUid,
  });
  ffTicketsPatchLocalTicket(ticketId, {
    deleted: true,
    deletedByUid,
  });
  _rebuildCurrentTicketsMerged();
}

/** Mark ticket as seen/acknowledged by Front Desk (removes "Edited" indicator). Call when FD opens the ticket. */
async function markTicketSeenByFrontDesk(ticketId) {
  const salonId = getActiveTicketsSalonId();
  if (!salonId || !ticketId) return;
  const ticketRef = doc(db, `salons/${salonId}/tickets`, ticketId);
  const snap = await getDoc(ticketRef);
  if (!snap.exists() || snap.data().seenByFrontDeskAt) return;
  await updateTicket(ticketId, { seenByFrontDeskAt: serverTimestamp() });
}

export {
  _rebuildCurrentTicketsMerged,
  ffTicketsPatchLocalTicket,
  updateTicketsLoadMoreUi,
  loadMoreTicketsOlder,
  subscribeTickets,
  updateTicketsNavBadge,
  getTicketCustomerPriceApprovedFromForm,
  createTicket,
  updateTicket,
  finalizeTicket,
  appendTicketSummaryOnClose,
  closeTicket,
  reopenTicket,
  voidTicket,
  archiveTicket,
  setTicketServiceUpgrade,
  getTicketUpgradePointsAccountId,
  getTicketUpgradePointsLocationId,
  getTicketUpgradePointsValue,
  awardTicketUpgradePoints,
  markTicketSummariesSourceDeleted,
  deleteTicketPermanently,
  markTicketSeenByFrontDesk,
};
