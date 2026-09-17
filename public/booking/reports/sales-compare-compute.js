/**
 * Sales Comparison. Closed checkout sales vs the immediately preceding
 * equal-length civil date range. No Firestore.
 *
 * Current and previous totals use shared Sales Summary breakdown
 * (gross = items + fees + tax + tip; adjusted = gross − ticket refunds).
 * Previous = 0 never becomes Infinity.
 */
(function () {
  var INCOMPLETE_MESSAGE = "Sales data for this range is incomplete. Narrow the date range and try again.";
  var INCOMPLETE_PREVIOUS_MESSAGE = "Previous-period sales data is incomplete. Narrow the date range and try again.";
  var LOAD_ERROR_MESSAGE = "This report could not load.";
  var EMPTY_NOTE = "No closed sales in either period.";

  function shared() {
    return window.ffBookingReportsCompute || null;
  }

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function money2(value) {
    var n = Math.round((Number(value) || 0) * 100) / 100;
    return Number.isFinite(n) ? n : 0;
  }

  function addDays(dateKey, delta) {
    var api = shared();
    if (api && typeof api.addDays === "function") return api.addDays(dateKey, delta);
    return "";
  }

  function inclusiveDayCount(fromKey, toKey) {
    var from = trim(fromKey);
    var to = trim(toKey) || from;
    if (!from) return 0;
    if (to < from) {
      var tmp = from;
      from = to;
      to = tmp;
    }
    var n = 0;
    var cur = from;
    while (cur && cur <= to && n < 400) {
      n += 1;
      if (cur === to) break;
      var next = addDays(cur, 1);
      if (!next || next === cur) break;
      cur = next;
    }
    return n;
  }

  function previousRange(fromKey, toKey) {
    var from = trim(fromKey);
    var to = trim(toKey) || from;
    if (!from) return { fromKey: "", toKey: "", days: 0 };
    if (to < from) {
      var tmp = from;
      from = to;
      to = tmp;
    }
    var days = inclusiveDayCount(from, to);
    if (days < 1) return { fromKey: "", toKey: "", days: 0 };
    var prevTo = addDays(from, -1);
    var prevFrom = days === 1 ? prevTo : addDays(prevTo, -(days - 1));
    return { fromKey: prevFrom, toKey: prevTo, days: days };
  }

  function averageTicket(totals) {
    var tickets = Number(totals && totals.sales) || 0;
    var gross = money2(totals && totals.grossTotal);
    if (!tickets) return 0;
    return money2(gross / tickets);
  }

  function metricsFromSummary(summary) {
    var totals = (summary && summary.totals) || {};
    return {
      grossTotal: money2(totals.grossTotal),
      adjustedTotal: money2(totals.adjustedTotal),
      tickets: Number(totals.sales) || 0,
      averageTicket: averageTicket(totals),
      tip: money2(totals.tip),
      refunds: money2(totals.refunds)
    };
  }

  function compareAmount(current, previous) {
    var cur = money2(current);
    var prev = money2(previous);
    var change = money2(cur - prev);
    if (prev === 0) {
      if (cur === 0) {
        return { current: cur, previous: prev, change: change, percent: 0, percentKind: "zero" };
      }
      return { current: cur, previous: prev, change: change, percent: null, percentKind: "new" };
    }
    var percent = Math.round((change / prev) * 1000) / 10;
    if (!Number.isFinite(percent)) {
      return { current: cur, previous: prev, change: change, percent: null, percentKind: "unavailable" };
    }
    return { current: cur, previous: prev, change: change, percent: percent, percentKind: "ok" };
  }

  function compareCount(current, previous) {
    var cur = Number(current) || 0;
    var prev = Number(previous) || 0;
    var change = cur - prev;
    if (prev === 0) {
      if (cur === 0) {
        return { current: cur, previous: prev, change: change, percent: 0, percentKind: "zero" };
      }
      return { current: cur, previous: prev, change: change, percent: null, percentKind: "new" };
    }
    var percent = Math.round((change / prev) * 1000) / 10;
    if (!Number.isFinite(percent)) {
      return { current: cur, previous: prev, change: change, percent: null, percentKind: "unavailable" };
    }
    return { current: cur, previous: prev, change: change, percent: percent, percentKind: "ok" };
  }

  function summarize(sales, opts) {
    var api = shared();
    if (api && typeof api.summarize === "function") return api.summarize(sales, opts);
    return { days: [], totals: { sales: 0, tip: 0, grossTotal: 0, refunds: 0, adjustedTotal: 0 } };
  }

  function comparePeriods(currentSales, previousSales, opts) {
    var options = opts && typeof opts === "object" ? opts : {};
    var fromKey = trim(options.fromKey);
    var toKey = trim(options.toKey) || fromKey;
    var locationIds = Array.isArray(options.locationIds) ? options.locationIds.slice() : [];
    var prev = previousRange(fromKey, toKey);
    var currentSummary = summarize(currentSales, {
      fromKey: fromKey,
      toKey: toKey,
      locationIds: locationIds
    });
    var previousSummary = summarize(previousSales, {
      fromKey: prev.fromKey,
      toKey: prev.toKey,
      locationIds: locationIds
    });
    var currentMetrics = metricsFromSummary(currentSummary);
    var previousMetrics = metricsFromSummary(previousSummary);
    return {
      currentRange: { fromKey: fromKey, toKey: toKey, days: prev.days },
      previousRange: prev,
      current: currentSummary,
      previous: previousSummary,
      metrics: {
        grossTotal: compareAmount(currentMetrics.grossTotal, previousMetrics.grossTotal),
        adjustedTotal: compareAmount(currentMetrics.adjustedTotal, previousMetrics.adjustedTotal),
        tickets: compareCount(currentMetrics.tickets, previousMetrics.tickets),
        averageTicket: compareAmount(currentMetrics.averageTicket, previousMetrics.averageTicket),
        tip: compareAmount(currentMetrics.tip, previousMetrics.tip)
      }
    };
  }

  function ownerView(currentFetch, previousFetch, comparison) {
    var range = window.ffBookingReportsSalesRange;
    var incompleteMsg = (range && range.INCOMPLETE_MESSAGE) || INCOMPLETE_MESSAGE;
    var errorMsg = (range && range.LOAD_ERROR_MESSAGE) || LOAD_ERROR_MESSAGE;
    var current = currentFetch && typeof currentFetch === "object" ? currentFetch : {};
    var previous = previousFetch && typeof previousFetch === "object" ? previousFetch : {};
    if (current.kind === "error") {
      return { kind: "error", message: current.message || errorMsg, summary: null };
    }
    if (previous.kind === "error") {
      return { kind: "error", message: previous.message || errorMsg, summary: null };
    }
    if (current.kind === "incomplete") {
      return { kind: "incomplete", message: current.message || incompleteMsg, summary: null };
    }
    if (previous.kind === "incomplete") {
      return { kind: "incomplete", message: INCOMPLETE_PREVIOUS_MESSAGE, summary: null };
    }
    return { kind: "ok", message: "", summary: comparison || null };
  }

  window.ffBookingReportsSalesCompareCompute = {
    INCOMPLETE_MESSAGE: INCOMPLETE_MESSAGE,
    INCOMPLETE_PREVIOUS_MESSAGE: INCOMPLETE_PREVIOUS_MESSAGE,
    LOAD_ERROR_MESSAGE: LOAD_ERROR_MESSAGE,
    EMPTY_NOTE: EMPTY_NOTE,
    inclusiveDayCount: inclusiveDayCount,
    previousRange: previousRange,
    averageTicket: averageTicket,
    metricsFromSummary: metricsFromSummary,
    compareAmount: compareAmount,
    compareCount: compareCount,
    comparePeriods: comparePeriods,
    ownerView: ownerView
  };
})();
