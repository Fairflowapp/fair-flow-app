/**
 * Tickets — modal EDIT half (Phase 10 split of tickets-modal.js, part 2/2).
 * Form population, performed-line editing (add service/product, price/note,
 * totals/diff), service-upgrade control, and the save/send/finalize/close
 * action handlers.
 *
 * tickets.js helpers + sibling (view-half) functions are injected via
 * initModalEdit (fanned out from the tickets-modal.js barrel) to keep the
 * two halves free of a circular import.
 */
import { serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { updateTicketsNavBadge, markTicketSeenByFrontDesk, updateTicket, archiveTicket, deleteTicketPermanently, setTicketServiceUpgrade, awardTicketUpgradePoints, createTicket, finalizeTicket, getTicketCustomerPriceApprovedFromForm, closeTicket } from "./tickets-crud.js?v=20260630_tickets_crud_split";
import { renderTicketsList, escapeHtml } from "./tickets-list.js?v=20260630_tickets_list_split";
import { ffTicketMoney, ffTicketCurSym } from "./tickets-helpers.js?v=20260630_tickets_helpers_split";
import { computeTicketTotalsFromLines } from "./tickets-pricing.js?v=20260630_tickets_pricing_split";
import { canSeeTicket, canCurrentUserCloseTickets, getTicketVisibility, getAutoFrontDeskRecipients } from "./tickets-permissions.js?v=20260630_tickets_permissions_split";
import { loadServiceCategories, loadServices } from "./tickets-catalog-data.js?v=20260704_tickets_catalog_data_split";

let showToast, ticketConfirm, ffTicketLinesChanged, ffTicketServiceSearchClear, ffTicketServiceSearchSetVisible, setupTicketsUI, getTicketPriceForServiceAndCurrentStaff, getTicketPriceForProductAndActiveLocation, closeTicketModal, openTicketDetailsModal, ffTicketRequiresCustomerName, ffApplyTicketCustomerRequiredUI;
export function initModalEdit(deps) {
  showToast = deps.showToast;
  ticketConfirm = deps.ticketConfirm;
  ffTicketLinesChanged = deps.ffTicketLinesChanged;
  ffTicketServiceSearchClear = deps.ffTicketServiceSearchClear;
  ffTicketServiceSearchSetVisible = deps.ffTicketServiceSearchSetVisible;
  setupTicketsUI = deps.setupTicketsUI;
  getTicketPriceForServiceAndCurrentStaff = deps.getTicketPriceForServiceAndCurrentStaff;
  getTicketPriceForProductAndActiveLocation = deps.getTicketPriceForProductAndActiveLocation;
  closeTicketModal = deps.closeTicketModal;
  openTicketDetailsModal = deps.openTicketDetailsModal;
  ffTicketRequiresCustomerName = deps.ffTicketRequiresCustomerName;
  ffApplyTicketCustomerRequiredUI = deps.ffApplyTicketCustomerRequiredUI;
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
