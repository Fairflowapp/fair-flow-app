/**
 * Client Retention. Cohort return after a completed visit.
 *
 * Qualifying visit = status === "completed". That is the checkout write
 * after Check In → Start Service → Check Out. Booked, cancelled, and
 * no-show appointments are not visits.
 *
 * One identified clientId per cohort. Anchor = first completed visit
 * in the cohort period. A return is a later-civil-date completed visit
 * for the same clientId in the selected locations, already occurred
 * as of now. Windows 30/60/90/180 use only closed observation periods.
 */
(function () {
  var WINDOWS = [30, 60, 90, 180];
  var MIN_RATE_ELIGIBLE = 20;
  var MIN_RETURN_SAMPLE = 5;
  var EMPTY_COHORT = "No qualifying client visits were found in this cohort period.";
  var MATURITY_NOTE = "Retention rates include only clients whose full observation window has elapsed.";
  var LOAD_ERROR_MESSAGE = "This report could not load.";
  var INCOMPLETE_MESSAGE = "Appointment data for this range is incomplete. Narrow the cohort range and try again.";

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function pad2(n) {
    return (Number(n) < 10 ? "0" : "") + Number(n);
  }

  function parseKey(dateKey) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trim(dateKey));
    if (!m) return null;
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }

  function addDays(dateKey, delta) {
    var shared = window.ffBookingReportsCompute;
    if (shared && typeof shared.addDays === "function") return shared.addDays(dateKey, delta);
    var p = parseKey(dateKey);
    if (!p) return "";
    var utc = new Date(Date.UTC(p.y, p.m - 1, p.d + Number(delta || 0)));
    return utc.getUTCFullYear() + "-" + pad2(utc.getUTCMonth() + 1) + "-" + pad2(utc.getUTCDate());
  }

  function daysBetween(fromKey, toKey) {
    var a = parseKey(fromKey);
    var b = parseKey(toKey);
    if (!a || !b) return null;
    var ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
    var n = Math.round(ms / 86400000);
    return Number.isFinite(n) ? n : null;
  }

  function inRange(dateKey, fromKey, toKey) {
    var shared = window.ffBookingReportsCompute;
    if (shared && typeof shared.inRange === "function") return shared.inRange(dateKey, fromKey, toKey);
    var key = trim(dateKey);
    if (!key) return false;
    if (fromKey && key < fromKey) return false;
    if (toKey && key > toKey) return false;
    return true;
  }

  function rangeText(fromKey, toKey) {
    var shared = window.ffBookingReportsCompute;
    if (shared && typeof shared.rangeText === "function") return shared.rangeText(fromKey, toKey);
    if (!fromKey) return "";
    if (!toKey || fromKey === toKey) return fromKey;
    return fromKey + " - " + toKey;
  }

  function monthLabel(dateKey) {
    var p = parseKey(dateKey);
    if (!p) return "";
    var months = ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"];
    return months[p.m - 1] + " " + p.y;
  }

  function monthKey(dateKey) {
    var p = parseKey(dateKey);
    if (!p) return "";
    return p.y + "-" + pad2(p.m);
  }

  function isQualifyingVisit(appt) {
    return !!(appt && trim(appt.status) === "completed");
  }

  function visitDateKey(appt) {
    var key = trim(appt && appt.dateKey);
    if (key) return key;
    var model = window.ffBookingAppointmentModel;
    if (model && typeof model.dateKeyOf === "function" && appt && appt.startAt) {
      return trim(model.dateKeyOf(appt.startAt, appt.locationId));
    }
    var tm = window.ffBookingTime;
    if (tm && typeof tm.zonedDateKey === "function" && appt && appt.startAt) {
      return trim(tm.zonedDateKey(appt.startAt, appt.locationId));
    }
    return "";
  }

  function startMs(value) {
    if (!value && value !== 0) return 0;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? 0 : value.getTime();
    var parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  function appointmentIdOf(appt) {
    return trim(appt && (appt.appointmentId || appt.id));
  }

  function compareVisits(a, b) {
    var da = visitDateKey(a);
    var db = visitDateKey(b);
    if (da !== db) return da < db ? -1 : 1;
    var dt = startMs(a && a.startAt) - startMs(b && b.startAt);
    if (dt) return dt;
    return appointmentIdOf(a).localeCompare(appointmentIdOf(b));
  }

  function asOfKey(locationId, opts) {
    var loc = trim(locationId);
    var map = opts && opts.asOfByLocation;
    if (map && loc && map[loc]) return trim(map[loc]);
    if (map && map["*"]) return trim(map["*"]);
    if (opts && opts.asOfKey) return trim(opts.asOfKey);
    var now = opts && opts.now instanceof Date && !Number.isNaN(opts.now.getTime())
      ? opts.now
      : new Date();
    var tm = window.ffBookingTime;
    if (tm && typeof tm.zonedDateKey === "function") return trim(tm.zonedDateKey(now, loc));
    return trim(opts && opts.todayKey);
  }

  function maxAsOf(locationIds, opts) {
    var ids = Array.isArray(locationIds) && locationIds.length ? locationIds : [""];
    var max = "";
    ids.forEach(function (id) {
      var key = asOfKey(id, opts);
      if (key && (!max || key > max)) max = key;
    });
    return max;
  }

  function lookForwardToKey(toKey, opts, locationIds) {
    var horizon = addDays(trim(toKey), 180);
    var asOf = maxAsOf(locationIds, opts);
    if (!horizon) return asOf || trim(toKey);
    if (!asOf) return horizon;
    return horizon < asOf ? horizon : asOf;
  }

  function rangeForPreset(kind, todayKey, customFrom, customTo) {
    var today = trim(todayKey);
    var key = trim(kind) || "last_90";
    var shared = window.ffBookingReportsCompute;
    if (!today) return { fromKey: "", toKey: "" };
    if (key === "last_30") return { fromKey: addDays(today, -29), toKey: today };
    if (key === "last_90") return { fromKey: addDays(today, -89), toKey: today };
    if (key === "previous_month") {
      var p = parseKey(today);
      if (!p) return { fromKey: "", toKey: "" };
      var y = p.y;
      var m = p.m - 1;
      if (m < 1) {
        m = 12;
        y -= 1;
      }
      if (shared && typeof shared.rangeForPreset === "function") {
        return shared.rangeForPreset("month:" + y + "-" + pad2(m), today);
      }
    }
    if (key === "custom") {
      var from = trim(customFrom);
      var to = trim(customTo);
      if (!from && !to) return { fromKey: "", toKey: "" };
      if (from && to && from > to) return { fromKey: to, toKey: from };
      return { fromKey: from || to, toKey: to || from };
    }
    return { fromKey: addDays(today, -89), toKey: today };
  }

  function datePresets(todayKey) {
    var today = trim(todayKey);
    var last30 = rangeForPreset("last_30", today);
    var last90 = rangeForPreset("last_90", today);
    var prev = rangeForPreset("previous_month", today);
    return [
      { value: "last_30", label: "Last 30 days (" + rangeText(last30.fromKey, last30.toKey) + ")" },
      { value: "last_90", label: "Last 90 days (" + rangeText(last90.fromKey, last90.toKey) + ")" },
      { value: "previous_month", label: "Previous month (" + rangeText(prev.fromKey, prev.toKey) + ")" },
      { value: "custom", label: "Custom" }
    ];
  }

  function emptyWindow() {
    return { days: 0, eligible: 0, returned: 0, open: 0, rate: null };
  }

  function windowMetrics() {
    var out = {};
    WINDOWS.forEach(function (days) {
      out[days] = emptyWindow();
      out[days].days = days;
    });
    return out;
  }

  function applyWindows(windows, firstReturnDays, asOfDays) {
    WINDOWS.forEach(function (days) {
      var row = windows[days];
      if (asOfDays == null || asOfDays < days) {
        row.open += 1;
        return;
      }
      row.eligible += 1;
      if (firstReturnDays != null && firstReturnDays <= days) row.returned += 1;
    });
  }

  function finalizeWindows(windows) {
    WINDOWS.forEach(function (days) {
      var row = windows[days];
      row.rate = row.eligible > 0 ? Math.round((row.returned / row.eligible) * 1000) / 10 : null;
    });
    return windows;
  }

  function median(values) {
    var list = (values || []).filter(function (n) { return Number.isFinite(n); }).slice().sort(function (a, b) {
      return a - b;
    });
    if (!list.length) return null;
    var mid = Math.floor(list.length / 2);
    if (list.length % 2) return list[mid];
    return Math.round(((list[mid - 1] + list[mid]) / 2) * 10) / 10;
  }

  function average(values) {
    var list = (values || []).filter(function (n) { return Number.isFinite(n); });
    if (!list.length) return null;
    var sum = list.reduce(function (acc, n) { return acc + n; }, 0);
    return Math.round((sum / list.length) * 10) / 10;
  }

  function percent(part, whole) {
    if (!whole) return null;
    var n = (Number(part) / Number(whole)) * 100;
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 10) / 10;
  }

  function locationAllowed(appt, locationIds) {
    if (!Array.isArray(locationIds) || !locationIds.length) return true;
    return locationIds.indexOf(trim(appt && appt.locationId)) !== -1;
  }

  function visitOccurred(appt, opts) {
    var dateKey = visitDateKey(appt);
    if (!dateKey) return false;
    var asOf = asOfKey(appt.locationId, opts);
    if (asOf && dateKey > asOf) return false;
    return true;
  }

  function firstReturnDays(anchor, visits) {
    var later = (visits || []).filter(function (row) {
      return appointmentIdOf(row) !== appointmentIdOf(anchor) && visitDateKey(row) > visitDateKey(anchor);
    }).sort(compareVisits);
    if (!later.length) return null;
    return daysBetween(visitDateKey(anchor), visitDateKey(later[0]));
  }

  function emptyLocation(id, name) {
    return {
      locationId: id,
      name: name || id,
      cohortClients: 0,
      unidentifiedVisits: 0,
      windows: windowMetrics()
    };
  }

  function buildInsights(totals, locations, months) {
    var out = [];
    var w60 = totals.windows[60];
    if (w60 && w60.eligible >= MIN_RATE_ELIGIBLE && w60.rate != null) {
      out.push(w60.rate + "% of eligible cohort clients returned within 60 days.");
    }
    var w90 = totals.windows[90];
    if (w90 && w90.open > 0 && out.length < 4) {
      out.push(w90.open + " clients are still inside their 90-day observation window.");
    }
    if (totals.medianDaysToFirstReturn != null && totals.returnedClients >= MIN_RETURN_SAMPLE && out.length < 4) {
      out.push("Median time to first return was " + totals.medianDaysToFirstReturn + " days.");
    }
    var comparable = (months || []).filter(function (row) {
      return row.windows[90] && row.windows[90].eligible >= MIN_RATE_ELIGIBLE && row.windows[90].rate != null;
    });
    if (comparable.length >= 2 && out.length < 4) {
      var top = comparable.slice().sort(function (a, b) {
        return (b.windows[90].rate - a.windows[90].rate) || String(a.label).localeCompare(String(b.label));
      })[0];
      out.push("Clients whose cohort visit was in " + top.label + " had a " + top.windows[90].rate + "% 90-day retention rate.");
    }
    void locations;
    return out.slice(0, 4);
  }

  function summarizeRetention(appointments, opts) {
    var options = opts && typeof opts === "object" ? opts : {};
    var fromKey = trim(options.fromKey);
    var toKey = trim(options.toKey);
    var locationIds = Array.isArray(options.locationIds) ? options.locationIds.map(trim).filter(Boolean) : [];
    var scoped = (appointments || []).filter(function (appt) {
      return locationAllowed(appt, locationIds);
    });
    var qualifying = scoped.filter(function (appt) {
      return isQualifyingVisit(appt) && visitOccurred(appt, options);
    });
    var unidentifiedVisits = 0;
    var byClient = {};
    qualifying.forEach(function (appt) {
      var clientId = trim(appt.clientId);
      var dateKey = visitDateKey(appt);
      if (!dateKey) return;
      if (!clientId) {
        if (inRange(dateKey, fromKey, toKey)) unidentifiedVisits += 1;
        return;
      }
      if (!byClient[clientId]) byClient[clientId] = [];
      byClient[clientId].push(appt);
    });
    Object.keys(byClient).forEach(function (id) {
      byClient[id].sort(compareVisits);
    });

    var cohort = [];
    var returnDays = [];
    var locAgg = {};
    var monthAgg = {};

    Object.keys(byClient).forEach(function (clientId) {
      var visits = byClient[clientId];
      var inCohort = visits.filter(function (appt) {
        return inRange(visitDateKey(appt), fromKey, toKey);
      });
      if (!inCohort.length) return;
      var anchor = inCohort[0];
      var asOf = asOfKey(anchor.locationId, options);
      var asOfDays = daysBetween(visitDateKey(anchor), asOf);
      var days = firstReturnDays(anchor, visits);
      if (days != null) returnDays.push(days);
      cohort.push({
        clientId: clientId,
        anchorDateKey: visitDateKey(anchor),
        locationId: trim(anchor.locationId),
        firstReturnDays: days,
        asOfDays: asOfDays
      });
      var locId = trim(anchor.locationId) || "unspecified";
      if (!locAgg[locId]) locAgg[locId] = emptyLocation(locId, locId);
      locAgg[locId].cohortClients += 1;
      applyWindows(locAgg[locId].windows, days, asOfDays);
      var mk = monthKey(visitDateKey(anchor));
      if (mk) {
        if (!monthAgg[mk]) {
          monthAgg[mk] = {
            monthKey: mk,
            label: monthLabel(visitDateKey(anchor)),
            cohortClients: 0,
            windows: windowMetrics()
          };
        }
        monthAgg[mk].cohortClients += 1;
        applyWindows(monthAgg[mk].windows, days, asOfDays);
      }
    });

    var totals = {
      cohortClients: cohort.length,
      unidentifiedVisits: unidentifiedVisits,
      returnedClients: returnDays.length,
      windows: windowMetrics(),
      medianDaysToFirstReturn: median(returnDays),
      averageDaysToFirstReturn: average(returnDays)
    };
    cohort.forEach(function (row) {
      applyWindows(totals.windows, row.firstReturnDays, row.asOfDays);
    });
    finalizeWindows(totals.windows);
    var locations = Object.keys(locAgg).sort().map(function (id) {
      finalizeWindows(locAgg[id].windows);
      return locAgg[id];
    });
    var months = Object.keys(monthAgg).sort().map(function (id) {
      finalizeWindows(monthAgg[id].windows);
      return monthAgg[id];
    });
    if (months.length < 2) months = [];

    return {
      totals: totals,
      windows: WINDOWS.map(function (days) { return totals.windows[days]; }),
      locations: locations,
      months: months,
      insights: buildInsights(totals, locations, months)
    };
  }

  function ownerView(summary) {
    var totals = summary && summary.totals;
    if (!totals) return { kind: "empty", message: EMPTY_COHORT, summary: null };
    if (!totals.cohortClients) {
      return { kind: "empty", message: EMPTY_COHORT, summary: summary };
    }
    return { kind: "ok", message: MATURITY_NOTE, summary: summary };
  }

  window.ffBookingReportsClientRetentionCompute = {
    WINDOWS: WINDOWS.slice(),
    QUALIFYING_STATUS: "completed",
    MIN_RATE_ELIGIBLE: MIN_RATE_ELIGIBLE,
    EMPTY_COHORT: EMPTY_COHORT,
    MATURITY_NOTE: MATURITY_NOTE,
    LOAD_ERROR_MESSAGE: LOAD_ERROR_MESSAGE,
    INCOMPLETE_MESSAGE: INCOMPLETE_MESSAGE,
    isQualifyingVisit: isQualifyingVisit,
    visitDateKey: visitDateKey,
    daysBetween: daysBetween,
    asOfKey: asOfKey,
    lookForwardToKey: lookForwardToKey,
    rangeForPreset: rangeForPreset,
    datePresets: datePresets,
    firstReturnDays: firstReturnDays,
    summarizeRetention: summarizeRetention,
    ownerView: ownerView,
    percent: percent
  };
})();
