/**
 * Tickets — date/format + summary computation helpers (Phase 5 extraction).
 *
 * Verbatim move from tickets.js of the pure/computational helper layer: date &
 * money formatting, date-range presets, CLOSED-tickets summary fetch (indexed +
 * client-scan fallback), staff matching, per-staff commission/supply-deduction
 * resolution, and the "by employee" summary row/total builders.
 *
 * Depends on ticketsState + _ticketSummaryPageSize (state), pricing
 * (getTicketTaxConfig, isTicketProductLine) and permissions (canSeeTicket,
 * getActiveLocationIdForTickets, isTicketsTechnicianRestrictedRole,
 * isStaffRecordManagerOrAdmin, ticketBelongsToTicketsTechnician). Five helpers
 * that live in tickets.js are injected via initTicketsHelpers to avoid a cycle:
 *   normalizeTicketTechName, getServiceStaffOverrides, getProductStaffOverrides,
 *   getStaffDefaultServiceCommission, getStaffDefaultSupplyDeduction.
 *
 * NOTE: ticketSubmittedAtDate + _fmtYmdLocal moved here but are still injected
 * into tickets-crud.js by tickets.js (which now imports them from this module).
 */
import {
  collection, query, where, orderBy, startAfter, limit, getDocs, Timestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { ticketsState, _ticketSummaryPageSize } from "./tickets-state.js?v=20260630_tickets_state_split";
import { getTicketTaxConfig, isTicketProductLine } from "./tickets-pricing.js?v=20260630_tickets_pricing_split";
import { canSeeTicket, getActiveLocationIdForTickets, isTicketsTechnicianRestrictedRole, isStaffRecordManagerOrAdmin, ticketBelongsToTicketsTechnician } from "./tickets-permissions.js?v=20260901_loc_isolate";

let normalizeTicketTechName, getServiceStaffOverrides, getProductStaffOverrides, getStaffDefaultServiceCommission, getStaffDefaultSupplyDeduction;
export function initTicketsHelpers(deps) {
  normalizeTicketTechName = deps.normalizeTicketTechName;
  getServiceStaffOverrides = deps.getServiceStaffOverrides;
  getProductStaffOverrides = deps.getProductStaffOverrides;
  getStaffDefaultServiceCommission = deps.getStaffDefaultServiceCommission;
  getStaffDefaultSupplyDeduction = deps.getStaffDefaultSupplyDeduction;
}

function ticketDateFromValue(value) {
  if (!value) return null;
  const d = value?.toDate ? value.toDate() : (value instanceof Date ? value : new Date(value));
  return d instanceof Date && !isNaN(d.getTime()) ? d : null;
}

function formatTicketDisplayDateTime(value) {
  const d = ticketDateFromValue(value);
  if (!d) return '';
  const datePart = d.toLocaleDateString();
  const timePart = typeof window !== 'undefined' && typeof window.ffFormatDisplayTime === 'function'
    ? window.ffFormatDisplayTime(d, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${datePart} ${timePart}`;
}

function formatDate(ts) {
  return formatTicketDisplayDateTime(ts);
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

/** Firestore bounds for Summary queries (local calendar day, same as passesTicketsDateFilter). */
function _summaryRangeToTimestampBounds(fromStr, toStr) {
  if (!fromStr && !toStr) return { minTs: null, maxTs: null };
  let minTs = null;
  let maxTs = null;
  if (fromStr) {
    const p = fromStr.split('-').map(Number);
    if (p.length === 3) {
      const d = new Date(p[0], p[1] - 1, p[2], 0, 0, 0, 0);
      minTs = Timestamp.fromDate(d);
    }
  }
  if (toStr) {
    const p = toStr.split('-').map(Number);
    if (p.length === 3) {
      const d = new Date(p[0], p[1] - 1, p[2], 23, 59, 59, 999);
      maxTs = Timestamp.fromDate(d);
    }
  }
  return { minTs, maxTs };
}

/**
 * Indexed path: status + createdAt (needs composite index on collection group "tickets").
 */
/** Statuses that count toward Tickets Summary (soft-deleted docs stay included). */
const SUMMARY_TICKET_STATUSES = ['CLOSED', 'ARCHIVED'];

async function _fetchClosedTicketsForSummaryIndexed(salonId, fromStr, toStr) {
  const colRef = collection(db, `salons/${salonId}/tickets`);
  const { minTs, maxTs } = _summaryRangeToTimestampBounds(fromStr, toStr);
  const out = [];
  const PAGE = _ticketSummaryPageSize;
  // status IN uses the same status+createdAt composite index as equality; no deleted filter —
  // soft-deleted tickets must remain in Summary.
  const constraints = [where('status', 'in', SUMMARY_TICKET_STATUSES)];
  if (minTs && maxTs) {
    constraints.push(where('createdAt', '>=', minTs));
    constraints.push(where('createdAt', '<=', maxTs));
  } else if (minTs) {
    constraints.push(where('createdAt', '>=', minTs));
  } else if (maxTs) {
    constraints.push(where('createdAt', '<=', maxTs));
  }
  constraints.push(orderBy('createdAt', 'desc'));
  let lastDoc = null;
  for (;;) {
    const q = lastDoc
      ? query(colRef, ...constraints, startAfter(lastDoc), limit(PAGE))
      : query(colRef, ...constraints, limit(PAGE));
    const snap = await getDocs(q);
    if (snap.empty) break;
    snap.docs.forEach((d) => out.push({ id: d.id, ...d.data() }));
    if (snap.size < PAGE) break;
    lastDoc = snap.docs[snap.docs.length - 1];
  }
  return out;
}

/** Scan by createdAt only (no status in query) — works without the CLOSED+createdAt composite index; stops once past fromStr. */
async function _fetchClosedTicketsForSummaryClientScan(salonId, fromStr, toStr) {
  const colRef = collection(db, `salons/${salonId}/tickets`);
  const out = [];
  const PAGE = _ticketSummaryPageSize;
  let lastDoc = null;
  let fromMs = null;
  if (fromStr) {
    const p = fromStr.split('-').map(Number);
    if (p.length === 3) fromMs = new Date(p[0], p[1] - 1, p[2], 0, 0, 0, 0).getTime();
  }
  const maxPages = 250;
  for (let page = 0; page < maxPages; page++) {
    const q = lastDoc
      ? query(colRef, orderBy('createdAt', 'desc'), startAfter(lastDoc), limit(PAGE))
      : query(colRef, orderBy('createdAt', 'desc'), limit(PAGE));
    const snap = await getDocs(q);
    if (snap.empty) break;
    let oldestInPageMs = Infinity;
    for (const d of snap.docs) {
      const data = d.data();
      const row = { id: d.id, ...data };
      const ts = data?.createdAt;
      if (ts && typeof ts.toDate === 'function') {
        const tms = ts.toDate().getTime();
        if (!isNaN(tms) && tms < oldestInPageMs) oldestInPageMs = tms;
      }
      const st = String(data.status || '').toUpperCase();
      if (st !== 'CLOSED' && st !== 'ARCHIVED') continue;
      if (!passesTicketsDateFilter(row, fromStr, toStr)) continue;
      out.push(row);
    }
    if (snap.size < PAGE) break;
    if (fromMs != null && Number.isFinite(oldestInPageMs) && oldestInPageMs < fromMs) break;
    lastDoc = snap.docs[snap.docs.length - 1];
  }
  return out;
}

/**
 * Load CLOSED + ARCHIVED tickets for Summary (not the paged list snapshot).
 * Soft-deleted tickets are included. Date semantics: submitted time (createdAt).
 */
async function fetchClosedTicketsForSummary(salonId, fromStr, toStr) {
  try {
    return await _fetchClosedTicketsForSummaryIndexed(salonId, fromStr, toStr);
  } catch (e) {
    if (e?.code === 'failed-precondition') {
      console.warn('[Tickets] Summary: using client-filter scan (Firestore index missing or still building)', e.message || e);
      return await _fetchClosedTicketsForSummaryClientScan(salonId, fromStr, toStr);
    }
    throw e;
  }
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
  if (typeof window !== 'undefined' && typeof window.ffFormatCurrency === 'function') {
    return window.ffFormatCurrency(v, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
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

/** Ticket money helper — respects salon currency, formats with given decimals. */
function ffTicketMoney(n, decimals) {
  const x = n == null || n === '' ? NaN : Number(n);
  const v = Number.isFinite(x) ? x : 0;
  const d = Number.isFinite(decimals) ? decimals : 2;
  if (typeof window !== 'undefined' && typeof window.ffFormatCurrency === 'function') {
    return window.ffFormatCurrency(v, { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  return '$' + v.toFixed(d);
}

/** Current salon currency symbol (fallback $). Used for inline prefixes/placeholders. */
function ffTicketCurSym() {
  if (typeof window !== 'undefined' && typeof window.ffGetCurrencySymbol === 'function') {
    return window.ffGetCurrencySymbol();
  }
  return '$';
}

function formatSummaryInt(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return '0';
  return String(Math.round(x));
}

function getSummaryStaffList() {
  try {
    const store = typeof window !== 'undefined' && typeof window.ffGetStaffStore === 'function'
      ? window.ffGetStaffStore()
      : null;
    return Array.isArray(store?.staff) ? store.staff : [];
  } catch (_) {
    return [];
  }
}

function summaryStaffMatchesTicket(staff, ticket) {
  if (!staff || !ticket) return false;
  const staffIds = [
    staff.id,
    staff.staffId,
    staff.uid,
    staff.firebaseUid,
    staff.firebaseAuthUid,
    staff.authUid,
    staff.userUid
  ].map((v) => String(v || '').trim()).filter(Boolean);
  const ticketStaffId = String(ticket.technicianStaffId || '').trim();
  if (ticketStaffId && staffIds.indexOf(ticketStaffId) !== -1) return true;
  const tn = normalizeTicketTechName(ticket.technicianName || '');
  const names = [staff.name, staff.displayName, staff.fullName, staff.email]
    .map((v) => normalizeTicketTechName(v || ''))
    .filter(Boolean);
  return !!tn && names.some((name) => name === tn);
}

function resolveSummaryStaffForTicket(ticket, staffList) {
  const list = Array.isArray(staffList) ? staffList : [];
  return list.find((staff) => summaryStaffMatchesTicket(staff, ticket)) || null;
}

function getSummaryStaffIdCandidates(staff, ticket) {
  const out = [];
  const add = (v) => {
    const s = String(v || '').trim();
    if (s && out.indexOf(s) === -1) out.push(s);
  };
  add(ticket?.technicianStaffId);
  if (staff) {
    add(staff.id);
    add(staff.staffId);
    add(staff.uid);
    add(staff.firebaseUid);
    add(staff.firebaseAuthUid);
    add(staff.authUid);
    add(staff.userUid);
  }
  return out;
}

function findSummaryServiceForLine(line) {
  const serviceId = String(line?.serviceId || '').trim();
  if (serviceId) {
    const byId = ticketsState.salonServices.find((service) => String(service?.id || '').trim() === serviceId);
    if (byId) return byId;
  }
  const lineName = normalizeTicketTechName(line?.serviceName || '');
  if (!lineName) return null;
  return ticketsState.salonServices.find((service) => normalizeTicketTechName(service?.name || '') === lineName) || null;
}

function findSummaryProductForLine(line) {
  const productId = String(line?.productId || '').trim();
  if (productId) {
    const byId = ticketsState.salonProducts.find((product) => String(product?.id || '').trim() === productId);
    if (byId) return byId;
  }
  const lineName = normalizeTicketTechName(line?.serviceName || '');
  if (!lineName) return null;
  return ticketsState.salonProducts.find((product) => normalizeTicketTechName(product?.name || '') === lineName) || null;
}

function getSummaryProductStaffOverride(product, staff, ticket) {
  const overrides = getProductStaffOverrides(product);
  const ids = getSummaryStaffIdCandidates(staff, ticket);
  for (const id of ids) {
    if (overrides[id] && typeof overrides[id] === 'object') return overrides[id];
  }
  return null;
}

function getSummaryProductCommissionRule(product, staff, ticket) {
  const override = getSummaryProductStaffOverride(product, staff, ticket);
  if (override?.commission && Number.isFinite(Number(override.commission.value))) {
    return {
      type: override.commission.type === 'fixed' ? 'fixed' : 'percentage',
      value: Number(override.commission.value)
    };
  }
  const staffId = staff?.id || staff?.staffId || ticket?.technicianStaffId || '';
  try {
    if (typeof window.ffGetStaffProductCommission === 'function') {
      const def = window.ffGetStaffProductCommission(staffId);
      if (def && Number.isFinite(Number(def.value))) return def;
    }
  } catch (_) {}
  return null;
}

function getSummaryStaffOverride(service, staff, ticket) {
  const overrides = getServiceStaffOverrides(service);
  const ids = getSummaryStaffIdCandidates(staff, ticket);
  for (const id of ids) {
    if (overrides[id] && typeof overrides[id] === 'object') return overrides[id];
  }
  return null;
}

function getSummaryCommissionRule(service, staff, ticket) {
  const override = getSummaryStaffOverride(service, staff, ticket);
  if (override?.commission && Number.isFinite(Number(override.commission.value))) {
    return {
      type: override.commission.type === 'fixed' ? 'fixed' : 'percentage',
      value: Number(override.commission.value)
    };
  }
  return getStaffDefaultServiceCommission(staff, staff?.id || staff?.staffId || '');
}

function getSummarySupplyDeductionRule(service, staff, ticket) {
  const override = getSummaryStaffOverride(service, staff, ticket);
  if (override?.supplyDeduction && override.supplyDeduction.enabled === false) return null;
  if (override?.supplyDeduction?.enabled === true && Number.isFinite(Number(override.supplyDeduction.value))) {
    return {
      type: override.supplyDeduction.type === 'percentage' ? 'percentage' : 'fixed',
      value: Number(override.supplyDeduction.value)
    };
  }
  return getStaffDefaultSupplyDeduction(staff);
}

function computeSummaryDeductionAmount(servicePrice, deductionRule) {
  const price = Number(servicePrice) || 0;
  if (!deductionRule || !Number.isFinite(Number(deductionRule.value))) return 0;
  const raw = deductionRule.type === 'percentage'
    ? price * (Number(deductionRule.value) / 100)
    : Number(deductionRule.value);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function computeSummaryCommissionAmount(commissionable, commissionRule) {
  const base = Number(commissionable) || 0;
  if (!commissionRule || !Number.isFinite(Number(commissionRule.value))) return 0;
  const raw = commissionRule.type === 'fixed'
    ? Number(commissionRule.value)
    : base * (Number(commissionRule.value) / 100);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
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

/** Mirrors canSeeTicket's location gate for summary rows.
 *  Behavior:
 *   • Single-branch mode / owners: legacy rows without a locationId stay
 *     visible so older history isn't hidden.
 *   • Multi-branch users: legacy rows without a locationId are HIDDEN.
 *     Without this, a Brickell manager would see Key-Biscayne revenue mixed
 *     into her "by employee" totals any time a ticket closed before the
 *     multi-branch rollout stamped locationId. Matches the strict behavior
 *     we adopted in Inventory. */
function summaryDocMatchesLocation(d) {
  const activeLoc = getActiveLocationIdForTickets();
  if (!activeLoc) return true;
  const hasLocationId = d && typeof d.locationId === 'string' && d.locationId;
  if (hasLocationId) {
    return d.locationId === activeLoc;
  }
  // Legacy row (no locationId). Keep visible only when the viewer has a
  // single branch; hide from multi-branch users to avoid cross-branch leak.
  let viewerIsMultiBranch = false;
  try {
    if (typeof window !== 'undefined' && typeof window.ffUserHasMultipleLocations === 'function') {
      viewerIsMultiBranch = !!window.ffUserHasMultipleLocations();
    }
  } catch (_) {}
  return !viewerIsMultiBranch;
}

function buildSummaryRowsFromClosedTicketList(ticketList, fromStr, toStr, employeeId) {
  const techSelfOnly =
    isTicketsTechnicianRestrictedRole() && !isStaffRecordManagerOrAdmin();
  const staffList = getSummaryStaffList();
  const filtered = (ticketList || []).filter((t) => {
    if (!canSeeTicket(t)) return false;
    const st = String(t.status || '').toUpperCase();
    if (st !== 'CLOSED' && st !== 'ARCHIVED') return false;
    if (!passesTicketsDateFilter(t, fromStr, toStr)) return false;
    if (techSelfOnly) return ticketBelongsToTicketsTechnician(t);
    return ticketMatchesEmployeeFilter(t, employeeId);
  });
  const groups = new Map();
  for (const t of filtered) {
    const staff = resolveSummaryStaffForTicket(t, staffList);
    const idPart =
      t.technicianStaffId != null && String(t.technicianStaffId).trim() !== ''
        ? String(t.technicianStaffId).trim()
        : (staff?.id ? String(staff.id).trim() : '');
    const nk = normalizeTicketTechName(t.technicianName || '');
    const gkey = idPart ? `id:${idPart}` : `name:${nk || 'unknown'}`;
    if (!groups.has(gkey)) {
      groups.set(gkey, {
        name: 'Unknown',
        tickets: 0,
        services: 0,
        serviceSales: 0,
        supplyDeductions: 0,
        serviceCommission: 0,
        productSales: 0,
        productCommission: 0,
        salesTax: 0,
        productTax: 0,
        serviceTax: 0,
        totalEarned: 0
      });
    }
    const g = groups.get(gkey);
    const nm =
      t.technicianName != null && String(t.technicianName).trim() !== ''
        ? String(t.technicianName).trim()
        : String(staff?.name || staff?.displayName || staff?.email || '').trim();
    if (nm && g.name === 'Unknown') g.name = nm;
    g.tickets += 1;
    const lines = Array.isArray(t.performedLines) ? t.performedLines : [];
    // Use the stored per-type tax when present (locks historical financials);
    // otherwise recompute live from the CURRENT catalog Charge Tax flags.
    const storedProductTax = (t && t.productTax != null && Number.isFinite(Number(t.productTax))) ? Number(t.productTax) : null;
    const storedServiceTax = (t && t.serviceTax != null && Number.isFinite(Number(t.serviceTax))) ? Number(t.serviceTax) : null;
    const hasStoredTax = storedProductTax != null || storedServiceTax != null;
    const taxCfg = getTicketTaxConfig();
    let liveProductTax = 0;
    let liveServiceTax = 0;
    for (const line of lines) {
      if (isTicketProductLine(line)) {
        const productPrice = Number(line?.ticketPrice) || 0;
        const product = findSummaryProductForLine(line);
        const commissionRule = getSummaryProductCommissionRule(product, staff, t);
        const commissionAmount = computeSummaryCommissionAmount(productPrice, commissionRule);
        g.productSales += productPrice;
        g.productCommission += commissionAmount;
        const productTaxable = product ? (product.taxable === true) : (line.taxable === true);
        if (taxCfg.product.enabled && taxCfg.product.rate > 0 && productTaxable && productPrice > 0) {
          liveProductTax += Math.round(productPrice * taxCfg.product.rate) / 100;
        }
        continue;
      }
      g.services += 1;
      const servicePrice = Number(line?.ticketPrice) || 0;
      const service = findSummaryServiceForLine(line);
      const deductionRule = getSummarySupplyDeductionRule(service, staff, t);
      const deductionAmount = computeSummaryDeductionAmount(servicePrice, deductionRule);
      const commissionable = Math.max(0, servicePrice - deductionAmount);
      const commissionRule = getSummaryCommissionRule(service, staff, t);
      const commissionAmount = computeSummaryCommissionAmount(commissionable, commissionRule);
      g.serviceSales += servicePrice;
      g.supplyDeductions += deductionAmount;
      g.serviceCommission += commissionAmount;
      const serviceTaxable = service ? (service.taxable === true) : (line.taxable === true);
      if (taxCfg.service.enabled && taxCfg.service.rate > 0 && serviceTaxable && servicePrice > 0) {
        liveServiceTax += Math.round(servicePrice * taxCfg.service.rate) / 100;
      }
    }
    const pTax = hasStoredTax ? (storedProductTax || 0) : Math.round(liveProductTax * 100) / 100;
    const sTax = hasStoredTax ? (storedServiceTax || 0) : Math.round(liveServiceTax * 100) / 100;
    g.productTax += pTax;
    g.serviceTax += sTax;
    g.salesTax += Math.round((pTax + sTax) * 100) / 100;
  }
  const sorted = [...groups.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
  const totals = {
    tickets: 0,
    services: 0,
    serviceSales: 0,
    supplyDeductions: 0,
    serviceCommission: 0,
    productSales: 0,
    productCommission: 0,
    salesTax: 0,
    productTax: 0,
    serviceTax: 0,
    totalEarned: 0
  };
  sorted.forEach((r) => {
    r.totalEarned = r.serviceCommission + r.productCommission;
    totals.tickets += r.tickets;
    totals.services += r.services;
    totals.serviceSales += r.serviceSales;
    totals.supplyDeductions += r.supplyDeductions;
    totals.serviceCommission += r.serviceCommission;
    totals.productSales += r.productSales;
    totals.productCommission += r.productCommission;
    totals.salesTax += r.salesTax;
    totals.productTax += r.productTax;
    totals.serviceTax += r.serviceTax;
    totals.totalEarned += r.totalEarned;
  });
  const summaryRows = sorted.map((r) => ({
    name: !r.name || !String(r.name).trim() ? 'Unknown' : r.name.trim(),
    tickets: r.tickets,
    services: r.services,
    serviceSales: r.serviceSales,
    supplyDeductions: r.supplyDeductions,
    serviceCommission: r.serviceCommission,
    productSales: r.productSales,
    productCommission: r.productCommission,
    salesTax: r.salesTax,
    productTax: r.productTax,
    serviceTax: r.serviceTax,
    totalEarned: r.totalEarned
  }));
  return { summaryRows, totals };
}

function buildSummaryRowsFromLiveClosedTickets(fromStr, toStr, employeeId) {
  return buildSummaryRowsFromClosedTicketList(ticketsState.currentTickets, fromStr, toStr, employeeId);
}

export {
  ticketDateFromValue,
  formatTicketDisplayDateTime,
  formatDate,
  ticketSubmittedAtDate,
  passesTicketsDateFilter,
  _summaryRangeToTimestampBounds,
  _fetchClosedTicketsForSummaryIndexed,
  _fetchClosedTicketsForSummaryClientScan,
  fetchClosedTicketsForSummary,
  _fmtYmdLocal,
  _ticketsStartOfWeekSunday,
  computeRangeForPreset,
  _ticketsFmtMonthDay,
  _ticketsRangeLabelMd,
  ticketMatchesEmployeeFilter,
  formatSummaryMoney,
  ffTicketMoney,
  ffTicketCurSym,
  formatSummaryInt,
  getSummaryStaffList,
  summaryStaffMatchesTicket,
  resolveSummaryStaffForTicket,
  getSummaryStaffIdCandidates,
  findSummaryServiceForLine,
  findSummaryProductForLine,
  getSummaryProductStaffOverride,
  getSummaryProductCommissionRule,
  getSummaryStaffOverride,
  getSummaryCommissionRule,
  getSummarySupplyDeductionRule,
  computeSummaryDeductionAmount,
  computeSummaryCommissionAmount,
  getSummaryFilterDateRangeFromDom,
  summaryDocMatchesLocation,
  buildSummaryRowsFromClosedTicketList,
  buildSummaryRowsFromLiveClosedTickets,
};
