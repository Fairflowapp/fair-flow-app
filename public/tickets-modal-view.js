/**
 * Tickets — modal VIEW half (Phase 10 split of tickets-modal.js, part 1/2).
 * Open dispatcher, admin & closed-ticket detail views, reviewed toggle,
 * close handlers, customer-name-required UI, and the create/edit form reset.
 *
 * tickets.js helpers + sibling (edit-half) functions are injected via
 * initModalView (fanned out from the tickets-modal.js barrel) to keep the
 * two halves free of a circular import.
 */
import { serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { updateTicketsNavBadge, markTicketSeenByFrontDesk, updateTicket, reopenTicket, archiveTicket, deleteTicketPermanently, voidTicket } from "./tickets-crud.js?v=20260708_ticket_void";
import { renderTicketsList, escapeHtml } from "./tickets-list.js?v=20260630_tickets_list_split";
import { ffTicketMoney, formatTicketDisplayDateTime } from "./tickets-helpers.js?v=20260630_tickets_helpers_split";
import { canSeeTicket, canCurrentUserCloseTickets, getTicketVisibility } from "./tickets-permissions.js?v=20260630_tickets_permissions_split";

let showToast, ticketConfirm, computeDiff, ffRenderFrontDeskChangesHtml, ffTicketServiceSearchClear, ffTicketServiceSearchSetVisible, setupTicketsUI, populateTicketForm, setupTicketServiceUpgradeControl, doCloseTicket, doSendNewTicket, paintTicketServiceUpgradeButton, updateTicketDiff, setupTicketFormToggles;
export function initModalView(deps) {
  showToast = deps.showToast;
  ticketConfirm = deps.ticketConfirm;
  computeDiff = deps.computeDiff;
  ffRenderFrontDeskChangesHtml = deps.ffRenderFrontDeskChangesHtml;
  ffTicketServiceSearchClear = deps.ffTicketServiceSearchClear;
  ffTicketServiceSearchSetVisible = deps.ffTicketServiceSearchSetVisible;
  setupTicketsUI = deps.setupTicketsUI;
  populateTicketForm = deps.populateTicketForm;
  setupTicketServiceUpgradeControl = deps.setupTicketServiceUpgradeControl;
  doCloseTicket = deps.doCloseTicket;
  doSendNewTicket = deps.doSendNewTicket;
  paintTicketServiceUpgradeButton = deps.paintTicketServiceUpgradeButton;
  updateTicketDiff = deps.updateTicketDiff;
  setupTicketFormToggles = deps.setupTicketFormToggles;
}

/** Guards concurrent Void Ticket submissions from the admin view. */
let _ticketVoidInFlight = false;

async function doVoidTicket(ticketId) {
  if (_ticketVoidInFlight) return;
  const ok = await ticketConfirm(
    'Void this ticket? It will not count toward sales or commission.',
    'Void Ticket'
  );
  if (!ok) return;
  _ticketVoidInFlight = true;
  const btn = document.getElementById('ticketVoidBtn');
  const prevText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Voiding...';
  }
  try {
    await voidTicket(ticketId);
    showToast('Ticket voided', 'success');
    if (btn) {
      btn.disabled = false;
      btn.textContent = prevText || 'Void Ticket';
    }
    closeTicketModal();
    renderTicketsList();
    updateTicketsNavBadge();
  } catch (err) {
    showToast(err?.message || 'Failed to void ticket', 'error');
    if (btn) {
      btn.disabled = false;
      btn.textContent = prevText || 'Void Ticket';
    }
  } finally {
    _ticketVoidInFlight = false;
  }
}

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

  // Void Ticket — same permission gate as Paid Ticket; does not count toward Summary.
  let voidBtn = document.getElementById('ticketVoidBtn');
  if (!voidBtn && closeBtn && closeBtn.parentNode) {
    voidBtn = document.createElement('button');
    voidBtn.type = 'button';
    voidBtn.id = 'ticketVoidBtn';
    closeBtn.parentNode.insertBefore(voidBtn, closeBtn);
  }
  if (voidBtn) {
    if (canCurrentUserCloseTickets()) {
      voidBtn.style.display = 'inline-block';
      voidBtn.style.width = '100%';
      voidBtn.style.padding = '12px';
      voidBtn.style.fontSize = '15px';
      voidBtn.style.fontWeight = '700';
      voidBtn.style.borderRadius = '10px';
      voidBtn.style.marginBottom = '8px';
      voidBtn.style.background = '#fff';
      voidBtn.style.color = '#b91c1c';
      voidBtn.style.border = '1px solid #fca5a5';
      voidBtn.style.cursor = 'pointer';
      voidBtn.disabled = false;
      voidBtn.textContent = 'Void Ticket';
      voidBtn.onclick = () => doVoidTicket(t.id);
    } else {
      voidBtn.style.display = 'none';
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
};
