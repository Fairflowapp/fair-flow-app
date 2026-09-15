/**
 * Client Spend. Closed checkout sales grouped by identified clientId.
 * In-period spend only. Not lifetime value, predicted spend, or retention.
 *
 * Spend uses shared checkout breakdown.grossTotal so identified +
 * unidentified tickets reconcile to Sales Summary / Sales by Time Period.
 * Tickets without clientId stay out of the ranked table.
 */
(function () {
  var INCOMPLETE_MESSAGE = "Sales data for this range is incomplete. Narrow the date range and try again.";
  var LOAD_ERROR_MESSAGE = "This report could not load.";
  var EMPTY_NOTE = "No identified-client closed sales in this period.";

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function money2(value) {
    var n = Math.round((Number(value) || 0) * 100) / 100;
    return Number.isFinite(n) ? n : 0;
  }

  function safeDiv(num, den) {
    if (!den) return null;
    var n = Number(num) / Number(den);
    if (!Number.isFinite(n)) return null;
    return money2(n);
  }

  function percent(part, whole) {
    if (!whole) return null;
    var n = (Number(part) / Number(whole)) * 100;
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 10) / 10;
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

  function saleIdOf(sale) {
    var api = shared();
    if (api && typeof api.saleIdOf === "function") return api.saleIdOf(sale);
    return trim(sale && (sale.saleId || sale.id));
  }

  function dedupeSales(sales) {
    var api = shared();
    if (api && typeof api.dedupeSales === "function") return api.dedupeSales(sales);
    var seen = {};
    var out = [];
    (sales || []).forEach(function (sale) {
      var id = saleIdOf(sale);
      if (id) {
        if (seen[id]) return;
        seen[id] = true;
      }
      if (sale) out.push(sale);
    });
    return out;
  }

  function isEligibleSale(sale, options) {
    if (!sale || sale.status === "void" || sale.status === "open") return false;
    if (!locationAllowed(sale, options)) return false;
    return inRange(dateKeyOf(sale), options && options.fromKey, options && options.toKey);
  }

  function ticketBreakdown(sale) {
    var api = shared();
    if (api && typeof api.breakdown === "function") return api.breakdown(sale);
    var tip = Number(sale && sale.tip) || 0;
    var tax = Number(sale && sale.tax) || 0;
    var subtotal = Number(sale && sale.subtotal) || 0;
    return {
      grossTotal: money2(subtotal + tax + tip),
      refunds: 0,
      adjustedTotal: money2(subtotal + tax + tip)
    };
  }

  function clientIdOf(sale) {
    return trim(sale && sale.clientId);
  }

  function clientNameOf(sale) {
    var snap = sale && sale.clientSnapshot;
    var name = trim(snap && (snap.displayName || snap.name));
    return name || "Client";
  }

  function closedMs(sale) {
    var value = sale && (sale.closedAt || sale.updatedAt);
    if (!value && value !== 0) return 0;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? 0 : value.getTime();
    if (typeof value.seconds === "number") return value.seconds * 1000;
    if (typeof value.toDate === "function") {
      try {
        var date = value.toDate();
        return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
      } catch (_) {
        return 0;
      }
    }
    var parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  function isLaterVisit(sale, currentKey, currentMs) {
    var key = dateKeyOf(sale);
    if (!currentKey || key > currentKey) return true;
    if (key < currentKey) return false;
    return closedMs(sale) >= currentMs;
  }

  function emptyTotals() {
    return {
      tickets: 0,
      identifiedTickets: 0,
      unidentifiedTickets: 0,
      identifiedClients: 0,
      identifiedSales: 0,
      unidentifiedSales: 0,
      allSales: 0,
      refunds: 0,
      adjustedSales: 0,
      averageSpendPerClient: null
    };
  }

  function buildInsights(totals, clients) {
    var out = [];
    if (totals.identifiedClients) {
      out.push(totals.identifiedClients + " identified clients spent in this period.");
    }
    if (totals.unidentifiedTickets) {
      out.push(totals.unidentifiedTickets + " closed tickets were excluded from the client ranking because they had no client id.");
    }
    if (clients.length >= 5 && totals.identifiedSales) {
      var top = clients[0];
      var share = percent(top.spend, totals.identifiedSales);
      if (share != null && share >= 20) {
        out.push(top.name + " accounted for " + share + "% of identified-client sales.");
      }
    }
    return out.slice(0, 3);
  }

  function summarizeClientSpend(sales, opts) {
    var options = opts && typeof opts === "object" ? opts : {};
    var byClient = {};
    var totals = emptyTotals();
    dedupeSales(sales).forEach(function (sale) {
      if (!isEligibleSale(sale, options)) return;
      var parts = ticketBreakdown(sale);
      totals.tickets += 1;
      totals.allSales = money2(totals.allSales + parts.grossTotal);
      totals.refunds = money2(totals.refunds + parts.refunds);
      totals.adjustedSales = money2(totals.adjustedSales + parts.adjustedTotal);
      var clientId = clientIdOf(sale);
      if (!clientId) {
        totals.unidentifiedTickets += 1;
        totals.unidentifiedSales = money2(totals.unidentifiedSales + parts.grossTotal);
        return;
      }
      totals.identifiedTickets += 1;
      totals.identifiedSales = money2(totals.identifiedSales + parts.grossTotal);
      if (!byClient[clientId]) {
        byClient[clientId] = {
          clientId: clientId,
          name: clientNameOf(sale),
          tickets: 0,
          spend: 0,
          refunds: 0,
          adjustedSpend: 0,
          lastClosedDateKey: "",
          lastClosedMs: 0
        };
      }
      var row = byClient[clientId];
      row.tickets += 1;
      row.spend = money2(row.spend + parts.grossTotal);
      row.refunds = money2(row.refunds + parts.refunds);
      row.adjustedSpend = money2(row.adjustedSpend + parts.adjustedTotal);
      if (isLaterVisit(sale, row.lastClosedDateKey, row.lastClosedMs)) {
        row.lastClosedDateKey = dateKeyOf(sale);
        row.lastClosedMs = closedMs(sale);
        row.name = clientNameOf(sale) || row.name;
      }
    });
    var clients = Object.keys(byClient).map(function (id) {
      var row = byClient[id];
      row.averageSpend = safeDiv(row.spend, row.tickets);
      return row;
    }).sort(function (a, b) {
      if (b.spend !== a.spend) return b.spend - a.spend;
      var names = String(a.name).localeCompare(String(b.name));
      if (names) return names;
      return String(a.clientId).localeCompare(String(b.clientId));
    });
    totals.identifiedClients = clients.length;
    totals.averageSpendPerClient = safeDiv(totals.identifiedSales, totals.identifiedClients);
    return {
      totals: totals,
      clients: clients,
      insights: buildInsights(totals, clients)
    };
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
    if (totals && !totals.identifiedClients) {
      return { kind: "ok", message: EMPTY_NOTE, summary: summary || null };
    }
    return { kind: "ok", message: "", summary: summary || null };
  }

  window.ffBookingReportsClientSpendCompute = {
    INCOMPLETE_MESSAGE: INCOMPLETE_MESSAGE,
    LOAD_ERROR_MESSAGE: LOAD_ERROR_MESSAGE,
    EMPTY_NOTE: EMPTY_NOTE,
    isEligibleSale: isEligibleSale,
    clientIdOf: clientIdOf,
    summarizeClientSpend: summarizeClientSpend,
    ownerView: ownerView
  };
})();
