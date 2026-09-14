/**
 * Service Sales from closed checkout items.
 * Uses sale item.amount only. Does not read appointment booked value.
 */
(function () {
  var UNSPECIFIED_KEY = "unspecified";
  var UNATTRIBUTED_KEY = "unattributed";
  var REFUND_CAVEAT = "Refunds are recorded at the ticket level and are not allocated to individual services in this report.";
  var EMPTY_MESSAGE = "No closed service sales in this period.";
  var INCOMPLETE_MESSAGE = "Sales data for this range is incomplete. Narrow the date range and try again.";
  var LOAD_ERROR_MESSAGE = "This report could not load.";

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function collapseName(value) {
    return trim(value).replace(/\s+/g, " ");
  }

  function money2(value) {
    var n = Math.round((Number(value) || 0) * 100) / 100;
    return Number.isFinite(n) ? n : 0;
  }

  function shared() {
    return window.ffBookingReportsCompute || null;
  }

  function dateKeyOf(sale) {
    var api = shared();
    if (api && typeof api.dateKeyOf === "function") return trim(api.dateKeyOf(sale));
    return trim(sale && sale.dateKey);
  }

  function inRange(dateKey, fromKey, toKey) {
    var api = shared();
    if (api && typeof api.inRange === "function") return api.inRange(dateKey, fromKey, toKey);
    var key = trim(dateKey);
    if (!key) return false;
    if (fromKey && key < fromKey) return false;
    if (toKey && key > toKey) return false;
    return true;
  }

  function locationAllowed(sale, options) {
    var ids = options && options.locationIds;
    if (Array.isArray(ids) && ids.length) {
      return ids.indexOf(trim(sale && sale.locationId)) !== -1;
    }
    var locationId = trim(options && options.locationId);
    if (locationId && locationId !== "all") return trim(sale && sale.locationId) === locationId;
    return true;
  }

  function isEligibleSale(sale, options) {
    if (!sale || sale.status === "void" || sale.status === "open") return false;
    if (!locationAllowed(sale, options)) return false;
    return inRange(dateKeyOf(sale), options && options.fromKey, options && options.toKey);
  }

  function isServiceItem(item) {
    var api = shared();
    if (api && typeof api.isServiceItem === "function") return api.isServiceItem(item);
    return !!(item && item.kind !== "product");
  }

  function dedupeSales(sales) {
    var api = shared();
    if (api && typeof api.dedupeSales === "function") return api.dedupeSales(sales);
    return sales || [];
  }

  function itemAmount(item) {
    return money2(item && item.amount);
  }

  function serviceKey(item) {
    var id = trim(item && item.serviceId);
    if (id) return "id:" + id;
    var name = collapseName(item && item.name).toLowerCase();
    if (name) return "name:" + name;
    return UNSPECIFIED_KEY;
  }

  function serviceDisplayName(item) {
    return collapseName(item && item.name) || "Unspecified service";
  }

  function hasExplicitProvider(item) {
    return !!trim(item && item.providerId);
  }

  function providerKey(item) {
    var id = trim(item && item.providerId);
    return id || UNATTRIBUTED_KEY;
  }

  function providerDisplayName(item) {
    if (!hasExplicitProvider(item)) return "";
    return collapseName(item && item.providerName) || "Provider";
  }

  function saleHasTicketRefund(sale) {
    if ((sale && sale.history || []).some(function (row) {
      return row && row.type === "refunded";
    })) return true;
    return Number(sale && sale.refundAmount) > 0;
  }

  function serviceItemsFromSale(sale) {
    var items = (sale && sale.items) || [];
    var out = [];
    var products = 0;
    items.forEach(function (item) {
      if (item && item.kind === "product") {
        products += 1;
        return;
      }
      if (!isServiceItem(item)) return;
      out.push(item);
    });
    var serviceSales = 0;
    out.forEach(function (item) {
      serviceSales = money2(serviceSales + itemAmount(item));
    });
    if (serviceSales === 0 && products === 0) {
      var subtotal = money2(sale && sale.subtotal);
      if (subtotal) {
        return [{
          kind: "service",
          name: "",
          serviceId: "",
          providerId: "",
          providerName: "",
          amount: subtotal
        }];
      }
    }
    return out;
  }

  function emptyTotals() {
    return {
      tickets: 0,
      serviceTickets: 0,
      units: 0,
      grossSales: 0,
      averageUnit: 0,
      averageTicket: 0,
      attributedUnits: 0,
      unattributedUnits: 0,
      unattributedSales: 0,
      attributionCoverage: 0,
      hasTicketRefunds: false
    };
  }

  function bumpName(counts, name) {
    var key = collapseName(name) || "Unspecified service";
    counts[key] = (counts[key] || 0) + 1;
  }

  function topName(counts, fallback) {
    var best = "";
    var bestN = -1;
    Object.keys(counts || {}).forEach(function (name) {
      var n = counts[name] || 0;
      if (n > bestN || (n === bestN && name < best)) {
        best = name;
        bestN = n;
      }
    });
    return best || fallback;
  }

  function percent(part, whole) {
    if (!whole) return 0;
    return Math.round((part / whole) * 1000) / 10;
  }

  function compareSalesDesc(a, b) {
    var dt = (b.sales || 0) - (a.sales || 0);
    if (dt) return dt;
    return String(a.name || "").localeCompare(String(b.name || ""));
  }

  function summarizeServiceSales(sales, opts) {
    var options = opts && typeof opts === "object" ? opts : {};
    var totals = emptyTotals();
    var services = {};
    var providers = {};
    var days = {};
    dedupeSales(sales).forEach(function (sale) {
      if (!isEligibleSale(sale, options)) return;
      totals.tickets += 1;
      if (saleHasTicketRefund(sale)) totals.hasTicketRefunds = true;
      var items = serviceItemsFromSale(sale);
      if (!items.length) return;
      totals.serviceTickets += 1;
      var dayKey = dateKeyOf(sale);
      if (!days[dayKey]) days[dayKey] = { dateKey: dayKey, units: 0, sales: 0 };
      items.forEach(function (item) {
        var amount = itemAmount(item);
        var sKey = serviceKey(item);
        var pKey = providerKey(item);
        if (!services[sKey]) {
          services[sKey] = {
            key: sKey,
            serviceId: trim(item && item.serviceId),
            name: serviceDisplayName(item),
            nameCounts: {},
            units: 0,
            sales: 0,
            mix: 0,
            average: 0
          };
        }
        bumpName(services[sKey].nameCounts, serviceDisplayName(item));
        services[sKey].units += 1;
        services[sKey].sales = money2(services[sKey].sales + amount);
        if (hasExplicitProvider(item)) {
          if (!providers[pKey]) {
            providers[pKey] = {
              key: pKey,
              providerId: pKey,
              name: providerDisplayName(item),
              nameCounts: {},
              assigned: true,
              units: 0,
              sales: 0,
              mix: 0,
              average: 0
            };
          }
          bumpName(providers[pKey].nameCounts, providerDisplayName(item));
          providers[pKey].units += 1;
          providers[pKey].sales = money2(providers[pKey].sales + amount);
          totals.attributedUnits += 1;
        } else {
          totals.unattributedUnits += 1;
          totals.unattributedSales = money2(totals.unattributedSales + amount);
        }
        days[dayKey].units += 1;
        days[dayKey].sales = money2(days[dayKey].sales + amount);
        totals.units += 1;
        totals.grossSales = money2(totals.grossSales + amount);
      });
    });
    totals.averageUnit = totals.units ? money2(totals.grossSales / totals.units) : 0;
    totals.averageTicket = totals.serviceTickets ? money2(totals.grossSales / totals.serviceTickets) : 0;
    totals.attributionCoverage = percent(totals.attributedUnits, totals.units);
    var serviceRows = Object.keys(services).map(function (key) {
      var row = services[key];
      row.name = topName(row.nameCounts, row.name);
      row.mix = percent(row.sales, totals.grossSales);
      row.average = row.units ? money2(row.sales / row.units) : 0;
      delete row.nameCounts;
      return row;
    }).sort(compareSalesDesc);
    var providerRows = Object.keys(providers).map(function (key) {
      var row = providers[key];
      row.name = topName(row.nameCounts, row.name);
      row.mix = percent(row.sales, totals.grossSales);
      row.average = row.units ? money2(row.sales / row.units) : 0;
      delete row.nameCounts;
      return row;
    }).sort(compareSalesDesc);
    var dayRows = Object.keys(days).sort().map(function (key) { return days[key]; });
    return {
      totals: totals,
      services: serviceRows,
      providers: providerRows,
      days: dayRows
    };
  }

  function coverageLabel(coverage) {
    var n = Number(coverage);
    if (!Number.isFinite(n)) n = 0;
    var shown = Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
    return "Provider attribution available for " + shown + "% of service sale lines.";
  }

  function ownerView(fetchView, summary) {
    var view = fetchView && typeof fetchView === "object" ? fetchView : {};
    if (view.kind === "incomplete") {
      return { kind: "incomplete", message: view.message || INCOMPLETE_MESSAGE, summary: null };
    }
    if (view.kind === "error") {
      return { kind: "error", message: view.message || LOAD_ERROR_MESSAGE, summary: null };
    }
    var totals = summary && summary.totals;
    if (!totals || !totals.units) {
      return { kind: "empty", message: EMPTY_MESSAGE, summary: null };
    }
    return { kind: "ok", message: "", summary: summary };
  }

  window.ffBookingReportsServiceSalesCompute = {
    UNSPECIFIED_KEY: UNSPECIFIED_KEY,
    UNATTRIBUTED_KEY: UNATTRIBUTED_KEY,
    REFUND_CAVEAT: REFUND_CAVEAT,
    EMPTY_MESSAGE: EMPTY_MESSAGE,
    INCOMPLETE_MESSAGE: INCOMPLETE_MESSAGE,
    LOAD_ERROR_MESSAGE: LOAD_ERROR_MESSAGE,
    isEligibleSale: isEligibleSale,
    isServiceItem: isServiceItem,
    hasExplicitProvider: hasExplicitProvider,
    serviceKey: serviceKey,
    serviceItemsFromSale: serviceItemsFromSale,
    saleHasTicketRefund: saleHasTicketRefund,
    coverageLabel: coverageLabel,
    ownerView: ownerView,
    summarizeServiceSales: summarizeServiceSales
  };
})();
