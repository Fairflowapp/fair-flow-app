/**
 * Sales by Time Period.
 * Ticket-level checkout sales by salon-local closedAt date.
 * Gross checkout sales uses Sales Summary breakdown.grossTotal
 * (item amounts + fees + tax + tip). That matches sale.total on
 * current checkout writes. Tip is not added again.
 *
 * Combined multi-location days use each sale's own location-local date.
 * Weekday averages divide by calendar occurrences in the selected range,
 * including $0 dates. Open/closed business hours are not inferred.
 */
(function () {
  var MAX_RANGE_DAYS = 400;
  var MIN_AVG_TICKET_TICKETS = 5;
  var WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  var WEEKDAY_LABELS = {
    monday: "Monday",
    tuesday: "Tuesday",
    wednesday: "Wednesday",
    thursday: "Thursday",
    friday: "Friday",
    saturday: "Saturday",
    sunday: "Sunday"
  };
  var INCOMPLETE_MESSAGE = "Sales data for this range is incomplete. Narrow the date range and try again.";
  var LOAD_ERROR_MESSAGE = "This report could not load.";
  var EMPTY_NOTE = "No closed sales in this period.";

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function money2(value) {
    var n = Math.round((Number(value) || 0) * 100) / 100;
    return Number.isFinite(n) ? n : 0;
  }

  function safeDiv(num, den) {
    if (!den) return 0;
    var n = Number(num) / Number(den);
    return Number.isFinite(n) ? money2(n) : 0;
  }

  function percent(part, whole) {
    if (!whole) return 0;
    var n = (Number(part) / Number(whole)) * 100;
    if (!Number.isFinite(n)) return 0;
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

  function addDays(dateKey, delta) {
    var api = shared();
    if (api && typeof api.addDays === "function") return api.addDays(dateKey, delta);
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trim(dateKey));
    if (!m) return "";
    var utc = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Number(delta || 0)));
    var mm = utc.getUTCMonth() + 1;
    var dd = utc.getUTCDate();
    return utc.getUTCFullYear() + "-" + (mm < 10 ? "0" : "") + mm + "-" + (dd < 10 ? "0" : "") + dd;
  }

  function dateKeysBetween(fromKey, toKey) {
    var a = trim(fromKey);
    var b = trim(toKey) || a;
    if (!a) return [];
    if (b < a) {
      var tmp = a;
      a = b;
      b = tmp;
    }
    var out = [];
    var cur = a;
    var guard = 0;
    while (cur && cur <= b && guard < MAX_RANGE_DAYS) {
      out.push(cur);
      if (cur === b) break;
      cur = addDays(cur, 1);
      guard += 1;
    }
    return out;
  }

  function weekdayFromDateKey(dateKey) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trim(dateKey));
    if (!m) return "";
    var utc = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
    return WEEKDAYS[(utc.getUTCDay() + 6) % 7] || "";
  }

  function weekdayLabel(key) {
    return WEEKDAY_LABELS[key] || key;
  }

  function saleIdOf(sale) {
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
    var refunds = 0;
    (sale && sale.history || []).forEach(function (row) {
      if (row && row.type === "refunded") refunds += Number(row.amount) || 0;
    });
    if (!refunds) refunds = Number(sale && sale.refundAmount) || 0;
    var gross = money2(subtotal + tax + tip);
    return {
      serviceSales: subtotal,
      tip: tip,
      tax: tax,
      grossTotal: gross,
      refunds: money2(refunds),
      adjustedTotal: money2(gross - refunds)
    };
  }

  function emptyDay(dateKey) {
    return {
      dateKey: dateKey || "",
      weekday: weekdayFromDateKey(dateKey),
      tickets: 0,
      grossSales: 0,
      refunds: 0,
      adjustedSales: 0,
      serviceSales: 0,
      tip: 0,
      averageTicket: 0
    };
  }

  function emptyWeekday(key, dateCount) {
    return {
      weekday: key,
      label: weekdayLabel(key),
      dateCount: Number(dateCount) || 0,
      tickets: 0,
      grossSales: 0,
      adjustedSales: 0,
      averagePerDate: 0,
      averageTicket: 0,
      mix: 0
    };
  }

  function moneyText(value) {
    return "$" + money2(value).toFixed(2);
  }

  function dayLabel(dateKey) {
    var api = shared();
    if (api && typeof api.longDate === "function") return api.longDate(dateKey) || dateKey;
    return dateKey;
  }

  function pickHighest(days, score, minTickets) {
    var best = null;
    (days || []).forEach(function (row) {
      if (!row || (Number(minTickets) || 0) > (row.tickets || 0)) return;
      if (!best) {
        best = row;
        return;
      }
      var a = score(row);
      var b = score(best);
      if (a > b || (a === b && row.dateKey < best.dateKey)) best = row;
    });
    return best;
  }

  function buildInsights(days, weekdays, totals) {
    var out = [];
    if (!totals || !totals.tickets) return out;
    var highSales = pickHighest(days, function (row) { return row.grossSales; }, 1);
    if (highSales) {
      out.push(dayLabel(highSales.dateKey) + " had the highest gross checkout sales in this period: " + moneyText(highSales.grossSales) + ".");
    }
    var highTickets = pickHighest(days, function (row) { return row.tickets; }, 1);
    if (highTickets && (!highSales || highTickets.dateKey !== highSales.dateKey)) {
      out.push(dayLabel(highTickets.dateKey) + " had the most closed tickets in this period: " + highTickets.tickets + ".");
    }
    var highAvg = pickHighest(days, function (row) { return row.averageTicket; }, MIN_AVG_TICKET_TICKETS);
    if (highAvg && out.length < 4) {
      out.push(dayLabel(highAvg.dateKey) + " had the highest average closed ticket at " + moneyText(highAvg.averageTicket) + ".");
    }
    var weekdayWithSales = (weekdays || []).filter(function (row) { return row.tickets > 0; });
    if (weekdayWithSales.length >= 2 && out.length < 4) {
      var topWeekday = weekdayWithSales.slice().sort(function (a, b) {
        if (b.grossSales !== a.grossSales) return b.grossSales - a.grossSales;
        return WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday);
      })[0];
      if (topWeekday) {
        out.push(topWeekday.label + " generated the highest gross checkout sales in this period: " + moneyText(topWeekday.grossSales) + ".");
      }
    }
    var avgDateWeekday = (weekdays || []).filter(function (row) {
      return row.dateCount >= 2 && row.tickets > 0;
    }).sort(function (a, b) {
      if (b.averagePerDate !== a.averagePerDate) return b.averagePerDate - a.averagePerDate;
      return WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday);
    })[0];
    if (avgDateWeekday && out.length < 4) {
      out.push(avgDateWeekday.label + " averaged " + moneyText(avgDateWeekday.averagePerDate) + " in gross checkout sales per represented date.");
    }
    var sat = (weekdays || []).find(function (row) { return row.weekday === "saturday"; });
    var sun = (weekdays || []).find(function (row) { return row.weekday === "sunday"; });
    var weekendDates = (sat && sat.dateCount || 0) + (sun && sun.dateCount || 0);
    var weekendGross = money2((sat && sat.grossSales || 0) + (sun && sun.grossSales || 0));
    if (weekendDates && totals.grossSales && out.length < 4) {
      out.push("Weekend dates represented " + percent(weekendGross, totals.grossSales) + "% of gross checkout sales.");
    }
    return out.slice(0, 4);
  }

  function summarizeSalesByPeriod(sales, opts) {
    var options = opts && typeof opts === "object" ? opts : {};
    var fromKey = trim(options.fromKey);
    var toKey = trim(options.toKey);
    var keys = dateKeysBetween(fromKey, toKey);
    var daysMap = {};
    keys.forEach(function (key) {
      daysMap[key] = emptyDay(key);
    });
    var weekdayDateCounts = {};
    WEEKDAYS.forEach(function (key) { weekdayDateCounts[key] = 0; });
    keys.forEach(function (key) {
      var wd = weekdayFromDateKey(key);
      if (wd) weekdayDateCounts[wd] += 1;
    });
    var totals = {
      tickets: 0,
      grossSales: 0,
      refunds: 0,
      adjustedSales: 0,
      serviceSales: 0,
      tip: 0,
      averageTicket: 0
    };
    dedupeSales(sales).forEach(function (sale) {
      if (!isEligibleSale(sale, options)) return;
      var key = dateKeyOf(sale);
      if (!key) return;
      if (!daysMap[key]) daysMap[key] = emptyDay(key);
      var parts = ticketBreakdown(sale);
      var row = daysMap[key];
      row.tickets += 1;
      row.grossSales = money2(row.grossSales + parts.grossTotal);
      row.refunds = money2(row.refunds + parts.refunds);
      row.adjustedSales = money2(row.adjustedSales + parts.adjustedTotal);
      row.serviceSales = money2(row.serviceSales + parts.serviceSales);
      row.tip = money2(row.tip + parts.tip);
      totals.tickets += 1;
      totals.grossSales = money2(totals.grossSales + parts.grossTotal);
      totals.refunds = money2(totals.refunds + parts.refunds);
      totals.adjustedSales = money2(totals.adjustedSales + parts.adjustedTotal);
      totals.serviceSales = money2(totals.serviceSales + parts.serviceSales);
      totals.tip = money2(totals.tip + parts.tip);
    });
    var days = Object.keys(daysMap).sort().map(function (key) {
      var row = daysMap[key];
      row.averageTicket = safeDiv(row.grossSales, row.tickets);
      return row;
    });
    totals.averageTicket = safeDiv(totals.grossSales, totals.tickets);
    var weekdayMap = {};
    WEEKDAYS.forEach(function (key) {
      if (weekdayDateCounts[key]) weekdayMap[key] = emptyWeekday(key, weekdayDateCounts[key]);
    });
    days.forEach(function (day) {
      var row = weekdayMap[day.weekday];
      if (!row) return;
      row.tickets += day.tickets;
      row.grossSales = money2(row.grossSales + day.grossSales);
      row.adjustedSales = money2(row.adjustedSales + day.adjustedSales);
    });
    var weekdays = WEEKDAYS.map(function (key) { return weekdayMap[key]; }).filter(Boolean).map(function (row) {
      row.averagePerDate = safeDiv(row.grossSales, row.dateCount);
      row.averageTicket = safeDiv(row.grossSales, row.tickets);
      row.mix = percent(row.grossSales, totals.grossSales);
      return row;
    });
    var highSales = pickHighest(days, function (row) { return row.grossSales; }, 1);
    var highTickets = pickHighest(days, function (row) { return row.tickets; }, 1);
    var highAvg = pickHighest(days, function (row) { return row.averageTicket; }, MIN_AVG_TICKET_TICKETS);
    return {
      totals: totals,
      days: days,
      weekdays: weekdays,
      highlights: {
        highestSalesDate: highSales ? highSales.dateKey : "",
        highestTicketDate: highTickets ? highTickets.dateKey : "",
        highestAverageTicketDate: highAvg ? highAvg.dateKey : ""
      },
      insights: buildInsights(days, weekdays, totals)
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
    return { kind: "ok", message: "", summary: summary || null };
  }

  window.ffBookingReportsSalesTimeCompute = {
    MIN_AVG_TICKET_TICKETS: MIN_AVG_TICKET_TICKETS,
    INCOMPLETE_MESSAGE: INCOMPLETE_MESSAGE,
    LOAD_ERROR_MESSAGE: LOAD_ERROR_MESSAGE,
    EMPTY_NOTE: EMPTY_NOTE,
    WEEKDAYS: WEEKDAYS.slice(),
    weekdayFromDateKey: weekdayFromDateKey,
    dateKeysBetween: dateKeysBetween,
    dedupeSales: dedupeSales,
    isEligibleSale: isEligibleSale,
    summarizeSalesByPeriod: summarizeSalesByPeriod,
    ownerView: ownerView
  };
})();
