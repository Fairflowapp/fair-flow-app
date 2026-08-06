/**
 * Tickets — sales-tax engine & line totals (Phase 2 extraction).
 *
 * Pure computation: resolves Product/Service tax config from Settings (window.ffGet*),
 * computes per-line sales tax, ticket totals, and tax breakdowns. No app state, no
 * imports, no injection. Verbatim move from tickets.js; behavior unchanged.
 */

// Sales tax — Product Tax and Service Tax are configured in Settings → Business Format.
//   • Product Tax applies when productTaxEnabled && productTaxRate>0, on taxable product lines.
//   • Service Tax applies when serviceTaxEnabled && serviceTaxRate>0, AND the service's own
//     Charge Tax flag (service.taxable===true) is set.
function getSalonTaxRateForTickets() {
  try {
    if (typeof window.ffGetSalonTaxRate === 'function') {
      const n = Number(window.ffGetSalonTaxRate());
      return Number.isFinite(n) && n > 0 ? n : 0;
    }
  } catch (_) {}
  return 0;
}

// Resolve Product/Service tax config from Settings. Each is { enabled, rate }.
function getTicketTaxConfig() {
  let product = { enabled: false, rate: 0 };
  let service = { enabled: false, rate: 0 };
  try {
    if (typeof window.ffGetProductTaxSettings === 'function') {
      const p = window.ffGetProductTaxSettings();
      if (p && typeof p === 'object') product = { enabled: p.enabled === true, rate: Number(p.rate) || 0 };
    }
  } catch (_) {}
  try {
    if (typeof window.ffGetServiceTaxSettings === 'function') {
      const s = window.ffGetServiceTaxSettings();
      if (s && typeof s === 'object') service = { enabled: s.enabled === true, rate: Number(s.rate) || 0 };
    }
  } catch (_) {}
  return { product, service };
}

// True when at least one tax type is active — drives the Summary "Sales Tax" column visibility.
function ffAnyTicketTaxActive() {
  const cfg = getTicketTaxConfig();
  return (cfg.product.enabled && cfg.product.rate > 0) || (cfg.service.enabled && cfg.service.rate > 0);
}

function isTicketProductLine(line) {
  return !!(line && line.lineType === 'product');
}

// Service lines are the default (legacy lines have no lineType).
function isTicketServiceLine(line) {
  return !!line && line.lineType !== 'product';
}

// Tax for one line → { amount, rate } (rate is the % applied, 0 when none).
function computeLineSalesTax(line, taxConfig) {
  const cfg = taxConfig || getTicketTaxConfig();
  const price = Number(line && line.ticketPrice) || 0;
  if (price <= 0) return { amount: 0, rate: 0 };
  if (isTicketProductLine(line)) {
    if (!cfg.product.enabled || !(cfg.product.rate > 0) || line.taxable !== true) return { amount: 0, rate: 0 };
    return { amount: Math.round(price * cfg.product.rate) / 100, rate: cfg.product.rate };
  }
  // Service line — requires the service's own Charge Tax flag.
  if (!cfg.service.enabled || !(cfg.service.rate > 0) || line.taxable !== true) return { amount: 0, rate: 0 };
  return { amount: Math.round(price * cfg.service.rate) / 100, rate: cfg.service.rate };
}

// Back-compat wrapper (amount only). Second arg may be a taxConfig object.
function computeLineSalesTaxAmount(line, taxConfig) {
  return computeLineSalesTax(line, taxConfig).amount;
}

function computeTicketTotalsFromLines(lines) {
  const arr = Array.isArray(lines) ? lines : [];
  const cfg = getTicketTaxConfig();
  let subtotal = 0;
  let productTax = 0;
  let serviceTax = 0;
  const ratesUsed = new Set();
  arr.forEach((line) => {
    const price = Number(line.ticketPrice) || 0;
    subtotal += price;
    const t = computeLineSalesTax(line, cfg);
    if (isTicketProductLine(line)) productTax += t.amount;
    else serviceTax += t.amount;
    if (t.amount > 0 && t.rate > 0) ratesUsed.add(t.rate);
  });
  subtotal = Math.round(subtotal * 100) / 100;
  productTax = Math.round(productTax * 100) / 100;
  serviceTax = Math.round(serviceTax * 100) / 100;
  const salesTax = Math.round((productTax + serviceTax) * 100) / 100;
  // Show a single "(X%)" label only when one rate applied; otherwise hide it.
  const taxRate = ratesUsed.size === 1 ? Array.from(ratesUsed)[0] : 0;
  return {
    subtotal,
    salesTax,
    productTax,
    serviceTax,
    total: Math.round((subtotal + salesTax) * 100) / 100,
    taxRate
  };
}

function getTicketSalesTaxAmount(ticket, lines) {
  const stored = Number(ticket?.salesTax);
  if (Number.isFinite(stored) && stored >= 0 && ticket != null && ticket.salesTax != null) {
    return Math.round(stored * 100) / 100;
  }
  const arr = Array.isArray(lines) ? lines : [];
  const cfg = getTicketTaxConfig();
  const sum = arr.reduce((acc, line) => acc + computeLineSalesTax(line, cfg).amount, 0);
  return Math.round(sum * 100) / 100;
}

// Split a ticket's tax into product vs service → { productTax, serviceTax }.
// Prefers stored per-type values; falls back to recomputing from lines.
function getTicketTaxBreakdown(ticket, lines) {
  const storedProduct = Number(ticket?.productTax);
  const storedService = Number(ticket?.serviceTax);
  const hasStoredProduct = ticket != null && ticket.productTax != null && Number.isFinite(storedProduct) && storedProduct >= 0;
  const hasStoredService = ticket != null && ticket.serviceTax != null && Number.isFinite(storedService) && storedService >= 0;
  if (hasStoredProduct || hasStoredService) {
    return {
      productTax: hasStoredProduct ? Math.round(storedProduct * 100) / 100 : 0,
      serviceTax: hasStoredService ? Math.round(storedService * 100) / 100 : 0
    };
  }
  const arr = Array.isArray(lines) ? lines : [];
  const cfg = getTicketTaxConfig();
  let productTax = 0;
  let serviceTax = 0;
  arr.forEach((line) => {
    const t = computeLineSalesTax(line, cfg);
    if (isTicketProductLine(line)) productTax += t.amount;
    else serviceTax += t.amount;
  });
  return {
    productTax: Math.round(productTax * 100) / 100,
    serviceTax: Math.round(serviceTax * 100) / 100
  };
}

export {
  getSalonTaxRateForTickets,
  getTicketTaxConfig,
  ffAnyTicketTaxActive,
  isTicketProductLine,
  isTicketServiceLine,
  computeLineSalesTax,
  computeLineSalesTaxAmount,
  computeTicketTotalsFromLines,
  getTicketSalesTaxAmount,
  getTicketTaxBreakdown,
};
