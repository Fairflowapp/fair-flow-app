/**
 * Tickets Summary Module
 * Extracted verbatim from tickets.js (Phase 9b).
 * Closed-ticket summary table + aggregation + date/employee filters.
 * Pure module: no injected tickets.js dependencies (zero-inject).
 */

import { collection, getDocs } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { getTicketsSelfEmployeeFilterId, isStaffRecordManagerOrAdmin, isTicketsTechnicianRestrictedRole } from "./tickets-permissions.js?v=20260630_tickets_permissions_split";
import { getTicketTaxConfig } from "./tickets-pricing.js?v=20260630_tickets_pricing_split";
import { fetchClosedTicketsForSummary, computeRangeForPreset, _ticketsFmtMonthDay, _ticketsRangeLabelMd, formatSummaryMoney, formatSummaryInt, getSummaryFilterDateRangeFromDom, buildSummaryRowsFromClosedTicketList, buildSummaryRowsFromLiveClosedTickets } from "./tickets-helpers.js?v=20260721_ticket_soft_delete";
import { renderTicketsList, escapeHtml } from "./tickets-list.js?v=20260721_ticket_soft_delete";
import { loadServices, subscribeProductsCatalog } from "./tickets-catalog-data.js?v=20260704_tickets_catalog_data_unsplit";

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
 * Summary tab: aggregate CLOSED + ARCHIVED tickets in Firestore (includes soft-deleted).
 * Date rules match Closed tab: createdAt. ticketSummaries rows are still written on close
 * for optional analytics; the UI does not depend on them.
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

export {
  paintTicketsSummaryTable,
  loadAndRenderTicketsSummary,
  populateTicketsEmployeeSelect,
  syncTicketsTimePeriodSelectOptions,
  ensureTicketsSummaryDefaultTimePeriod,
  applyTicketsTimePeriodFromSelect,
  setupTicketsDateFilters,
  _alignGearToAvatar,
};
