/**
 * Service Sales from closed checkout items.
 * Uses sale item.amount only. Does not read appointment booked value.
 */
(function () {
  var UNSPECIFIED_KEY = "unspecified";
  var UNASSIGNED_KEY = "unassigned";

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
    return !!(item && item.kind !== "product");
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

  function providerKey(item) {
    var id = trim(item && item.providerId);
    return id || UNASSIGNED_KEY;
  }

  function providerDisplayName(item) {
    var name = collapseName(item && item.providerName);
    if (trim(item && item.providerId)) return name || "Provider";
    return "Unassigned";
  }

  function serviceItemsFromSale(sale) {
    var items = (sale && sale.items) || [];
    var out = [];
    items.forEach(function (item) {
      if (!isServiceItem(item)) return;
      out.push(item);
    });
    if (!items.length) {
      var subtotal = money2(sale && sale.subtotal);
      if (subtotal) {
        out.push({
          kind: "service",
          name: "",
          serviceId: "",
          providerId: "",
          providerName: "",
          amount: subtotal
        });
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
      unassignedUnits: 0,
      unassignedSales: 0
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
    (sales || []).forEach(function (sale) {
      if (!isEligibleSale(sale, options)) return;
      totals.tickets += 1;
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
        if (!providers[pKey]) {
          providers[pKey] = {
            key: pKey,
            providerId: pKey === UNASSIGNED_KEY ? "" : pKey,
            name: providerDisplayName(item),
            nameCounts: {},
            assigned: pKey !== UNASSIGNED_KEY,
            units: 0,
            sales: 0,
            mix: 0,
            average: 0
          };
        }
        bumpName(providers[pKey].nameCounts, providerDisplayName(item));
        providers[pKey].units += 1;
        providers[pKey].sales = money2(providers[pKey].sales + amount);
        days[dayKey].units += 1;
        days[dayKey].sales = money2(days[dayKey].sales + amount);
        totals.units += 1;
        totals.grossSales = money2(totals.grossSales + amount);
        if (pKey === UNASSIGNED_KEY) {
          totals.unassignedUnits += 1;
          totals.unassignedSales = money2(totals.unassignedSales + amount);
        }
      });
    });
    totals.averageUnit = totals.units ? money2(totals.grossSales / totals.units) : 0;
    totals.averageTicket = totals.serviceTickets ? money2(totals.grossSales / totals.serviceTickets) : 0;
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
    }).sort(function (a, b) {
      if (a.assigned !== b.assigned) return a.assigned ? -1 : 1;
      return compareSalesDesc(a, b);
    });
    var dayRows = Object.keys(days).sort().map(function (key) { return days[key]; });
    return {
      totals: totals,
      services: serviceRows,
      providers: providerRows,
      days: dayRows
    };
  }

  window.ffBookingReportsServiceSalesCompute = {
    UNSPECIFIED_KEY: UNSPECIFIED_KEY,
    UNASSIGNED_KEY: UNASSIGNED_KEY,
    isEligibleSale: isEligibleSale,
    isServiceItem: isServiceItem,
    serviceKey: serviceKey,
    serviceItemsFromSale: serviceItemsFromSale,
    summarizeServiceSales: summarizeServiceSales
  };
})();
