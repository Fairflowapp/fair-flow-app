/**
 * Tickets — list rendering + bulk select UI (Phase 6 extraction).
 *
 * Verbatim move from tickets.js of the "UI: List" + "Bulk select" sections:
 * list-line/initial display helpers, bulk archive/permanent-delete selection
 * (chunked Firestore batches), the shared ticket-card HTML builder (also exposed
 * as window.ffRenderTicketCardHTML for the Live Desk), the main renderTicketsList
 * hub, and status colour/escape helpers.
 *
 * Imports from state/crud/helpers/permissions. Eleven helpers that live in
 * tickets.js are injected via initTicketsList to avoid a cycle:
 *   getTicketTechnicianAvatarUrl, ticketHasRealPostSendEdit, ffFormatReviewedAt,
 *   openTicketModal, showToast, ticketConfirm, getActiveTicketsSalonId,
 *   loadAndRenderTicketsSummary, populateTicketsEmployeeSelect,
 *   syncTicketsTimePeriodSelectOptions, ensureTicketsSummaryDefaultTimePeriod.
 *
 * NOTE: renderTicketsList moved here; tickets.js imports it back to keep injecting
 * it into tickets-crud.js (no change to that module).
 */
import { collection, query, where, getDocs, doc, writeBatch, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { ffTicketsPatchLocalTicket, _rebuildCurrentTicketsMerged, updateTicketsLoadMoreUi, deleteTicketPermanently } from "./tickets-crud.js?v=20260630_tickets_crud_split";
import { ffTicketMoney, formatDate, passesTicketsDateFilter, ticketMatchesEmployeeFilter } from "./tickets-helpers.js?v=20260630_tickets_helpers_split";
import { canSeeTicket, updateTicketsTabsVisibility, canViewTicketsSummaryTab, canViewTicketsArchivedTab, ffTicketsSetTimePeriodFiltersVisible, updateTicketsEmployeeFilterVisibility, ffTicketsHideFrontDeskFiltersOnThisView, isTicketsTechnicianRestrictedRole, isStaffRecordManagerOrAdmin, getTicketsSelfEmployeeFilterId, ticketBelongsToTicketsTechnician } from "./tickets-permissions.js?v=20260630_tickets_permissions_split";

let getTicketTechnicianAvatarUrl, ticketHasRealPostSendEdit, ffFormatReviewedAt, openTicketModal, showToast, ticketConfirm, getActiveTicketsSalonId, loadAndRenderTicketsSummary, populateTicketsEmployeeSelect, syncTicketsTimePeriodSelectOptions, ensureTicketsSummaryDefaultTimePeriod;
export function initTicketsList(deps) {
  getTicketTechnicianAvatarUrl = deps.getTicketTechnicianAvatarUrl;
  ticketHasRealPostSendEdit = deps.ticketHasRealPostSendEdit;
  ffFormatReviewedAt = deps.ffFormatReviewedAt;
  openTicketModal = deps.openTicketModal;
  showToast = deps.showToast;
  ticketConfirm = deps.ticketConfirm;
  getActiveTicketsSalonId = deps.getActiveTicketsSalonId;
  loadAndRenderTicketsSummary = deps.loadAndRenderTicketsSummary;
  populateTicketsEmployeeSelect = deps.populateTicketsEmployeeSelect;
  syncTicketsTimePeriodSelectOptions = deps.syncTicketsTimePeriodSelectOptions;
  ensureTicketsSummaryDefaultTimePeriod = deps.ensureTicketsSummaryDefaultTimePeriod;
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

export {
  formatLineForList,
  getInitial,
  ffTicketsCanBulkArchive,
  ffTicketsBulkTabHere,
  ffTicketsExitSelectionMode,
  ffTicketsToggleSelect,
  ffTicketsUpdateBulkBar,
  ffTicketsBulkInit,
  ffTicketsArchiveSelected,
  ffTicketsDeleteSelected,
  ffBuildTicketCardHTML,
  renderTicketsList,
  statusBg,
  statusColor,
  escapeHtml,
};
