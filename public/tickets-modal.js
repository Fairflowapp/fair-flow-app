/**
 * Tickets — ticket modal: create/edit form + line editing (Phase 7 extraction).
 *
 * Verbatim move of the "UI: Ticket Modal (create/edit)" section out of tickets.js:
 * the create/edit + admin + details modals (open/close), reviewed toggle,
 * customer-name requirement UI, form reset/populate, performed-line editing
 * (add service/product, price/note edits, totals/diff), service-upgrade control,
 * and the save/send/finalize/close action handlers.
 *
 * Imports from state/crud/list/helpers/pricing/permissions/catalog-data. Ten
 * tickets.js helpers are injected via initTicketsModal to avoid a cycle:
 *   showToast, ticketConfirm, computeDiff, ffTicketLinesChanged,
 *   ffRenderFrontDeskChangesHtml, ffTicketServiceSearchClear,
 *   ffTicketServiceSearchSetVisible, setupTicketsUI,
 *   getTicketPriceForServiceAndCurrentStaff, getTicketPriceForProductAndActiveLocation.
 *
 * NOTE: closeTicketModal (injected into tickets-crud) and openTicketModal +
 * ffFormatReviewedAt (injected into tickets-list) now live here; tickets.js
 * imports them back to keep injecting them into those modules (no change there).
 */
import { serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { updateTicketsNavBadge, markTicketSeenByFrontDesk, updateTicket, reopenTicket, archiveTicket, deleteTicketPermanently, setTicketServiceUpgrade, awardTicketUpgradePoints, createTicket, finalizeTicket, getTicketCustomerPriceApprovedFromForm, closeTicket } from "./tickets-crud.js?v=20260630_tickets_crud_split";
import { renderTicketsList, escapeHtml } from "./tickets-list.js?v=20260630_tickets_list_split";
import { ffTicketMoney, ffTicketCurSym, formatTicketDisplayDateTime } from "./tickets-helpers.js?v=20260630_tickets_helpers_split";
import { computeTicketTotalsFromLines } from "./tickets-pricing.js?v=20260630_tickets_pricing_split";
import { canSeeTicket, canCurrentUserCloseTickets, getTicketVisibility, getAutoFrontDeskRecipients } from "./tickets-permissions.js?v=20260630_tickets_permissions_split";
import { loadServiceCategories, loadServices } from "./tickets-catalog-data.js?v=20260630_tickets_catalog_data_split";

let showToast, ticketConfirm, computeDiff, ffTicketLinesChanged, ffRenderFrontDeskChangesHtml, ffTicketServiceSearchClear, ffTicketServiceSearchSetVisible, setupTicketsUI, getTicketPriceForServiceAndCurrentStaff, getTicketPriceForProductAndActiveLocation;
export function initTicketsModal(deps) {
  showToast = deps.showToast;
  ticketConfirm = deps.ticketConfirm;
  computeDiff = deps.computeDiff;
  ffTicketLinesChanged = deps.ffTicketLinesChanged;
  ffRenderFrontDeskChangesHtml = deps.ffRenderFrontDeskChangesHtml;
  ffTicketServiceSearchClear = deps.ffTicketServiceSearchClear;
  ffTicketServiceSearchSetVisible = deps.ffTicketServiceSearchSetVisible;
  setupTicketsUI = deps.setupTicketsUI;
  getTicketPriceForServiceAndCurrentStaff = deps.getTicketPriceForServiceAndCurrentStaff;
  getTicketPriceForProductAndActiveLocation = deps.getTicketPriceForProductAndActiveLocation;
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

export {
  openTicketModal,
  ffFormatReviewedAt,
  toggleTicketReviewed,
  openAdminTicketView,
  closeTicketModal,
  openTicketDetailsModal,
  closeTicketDetailsModal,
  ffTicketRequiresCustomerName,
  ffApplyTicketCustomerRequiredUI,
  resetTicketForm,
  populateTicketForm,
  syncTicketFormLinesFromDom,
  renderPerformedLines,
  renderDiff,
  addServiceToTicket,
  addProductToTicket,
  setupTicketFormToggles,
  updateTicketDiff,
  updateTicketTotal,
  paintTicketServiceUpgradeButton,
  setupTicketServiceUpgradeControl,
  saveTicket,
  doSendNewTicket,
  doFinalizeTicket,
  doCloseTicket,
};
