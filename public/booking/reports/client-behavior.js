/**
 * Client behavior inside the selected report period.
 * firstVisit on any in-range booked appointment → first-visit client.
 * Otherwise an identified client is returning. A client is never both.
 * Repeat-in-period means 2+ booked appointments in this range only.
 * This is not retention, churn, loyalty, or lifetime behavior.
 */
(function () {
  var MIN_REPEAT_CLIENTS = 10;
  var MIN_MULTI_SERVICE_CLIENTS = 10;
  var MIN_REQUESTED_LINES = 10;
  var MIN_CONSISTENT_ELIGIBLE = 5;
  var MIN_SPACING_INTERVALS = 5;

  function compute() {
    return window.ffBookingReportsIntelligenceCompute || null;
  }

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function collapseName(value) {
    return trim(value).replace(/\s+/g, " ");
  }

  function percent(part, whole) {
    var api = compute();
    if (api && typeof api.percent === "function") return api.percent(part, whole);
    if (!whole) return 0;
    return Math.round((part / whole) * 1000) / 10;
  }

  function round1(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 10) / 10;
  }

  function isBookedStatus(status) {
    var api = compute();
    if (api && typeof api.isBookedStatus === "function") return api.isBookedStatus(status);
    return ["scheduled", "confirmed", "checked_in", "in_service", "completed", "no_show"].indexOf(trim(status)) !== -1;
  }

  function serviceKey(line) {
    var id = trim(line && line.serviceId);
    if (id) return "id:" + id;
    var name = collapseName(line && line.serviceNameSnapshot);
    if (name) return "name:" + name.toLowerCase();
    return "";
  }

  function parseKey(dateKey) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trim(dateKey));
    if (!m) return null;
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }

  function daysBetween(fromKey, toKey) {
    if (fromKey === toKey) return 0;
    var api = compute();
    if (api && typeof api.dateKeysBetween === "function") {
      var keys = api.dateKeysBetween(fromKey, toKey);
      if (keys.length) return Math.max(0, keys.length - 1);
    }
    var a = parseKey(fromKey);
    var b = parseKey(toKey);
    if (!a || !b) return null;
    var start = Date.UTC(a.y, a.m - 1, a.d);
    var end = Date.UTC(b.y, b.m - 1, b.d);
    return Math.round((end - start) / 86400000);
  }

  function appointmentSortKey(appt) {
    var dateKey = trim(appt && appt.dateKey) || "9999-99-99";
    var start = Number.MAX_SAFE_INTEGER;
    (appt && appt.serviceLines || []).forEach(function (line) {
      var min = Number(line && line.startMin);
      if (Number.isFinite(min) && min < start) start = min;
    });
    return dateKey + "|" + String(start).padStart(5, "0");
  }

  function median(values) {
    if (!values || !values.length) return null;
    var rows = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(rows.length / 2);
    if (rows.length % 2) return rows[mid];
    return (rows[mid - 1] + rows[mid]) / 2;
  }

  function emptyFrequency() {
    return [
      { bucket: "1", label: "1 appointment", clientCount: 0, sharePercent: 0 },
      { bucket: "2", label: "2 appointments", clientCount: 0, sharePercent: 0 },
      { bucket: "3", label: "3 appointments", clientCount: 0, sharePercent: 0 },
      { bucket: "4+", label: "4+ appointments", clientCount: 0, sharePercent: 0 }
    ];
  }

  function emptyBehavior() {
    return {
      identifiedClientCount: 0,
      firstVisitClientCount: 0,
      returningClientCount: 0,
      unidentifiedClientAppointmentCount: 0,
      identifiedAppointmentCount: 0,
      averageAppointmentsPerClient: 0,
      repeatInPeriodClientCount: 0,
      repeatInPeriodClientShare: 0,
      repeatInPeriodAppointmentCount: 0,
      repeatInPeriodAppointmentShare: 0,
      averageAppointmentsPerRepeatClient: 0,
      frequency: emptyFrequency(),
      averageDistinctServicesPerClient: 0,
      multiServiceClientCount: 0,
      multiServiceClientShare: 0,
      providerAssignedLineCount: 0,
      requestedLineCount: 0,
      requestedProviderShare: 0,
      eligibleRequestedClientCount: 0,
      consistentRequestedClientCount: 0,
      consistentRequestedShare: 0,
      averageMostUsedProviderShare: 0,
      averageDaysBetweenVisits: null,
      medianDaysBetweenVisits: null,
      spacingIntervalCount: 0
    };
  }

  function emptyClient(clientId) {
    return {
      clientId: clientId,
      appointmentIds: {},
      appointments: [],
      firstVisit: false,
      serviceKeys: {},
      lineCount: 0,
      providerLineCount: 0,
      requestedLineCount: 0,
      providerCounts: {},
      requestedProviders: []
    };
  }

  function visitIntervals(appointments) {
    var rows = (appointments || []).slice().sort(function (a, b) {
      return appointmentSortKey(a).localeCompare(appointmentSortKey(b));
    });
    var gaps = [];
    var i;
    for (i = 1; i < rows.length; i += 1) {
      var fromKey = trim(rows[i - 1].dateKey);
      var toKey = trim(rows[i].dateKey);
      if (!fromKey || !toKey) continue;
      var days = daysBetween(fromKey, toKey);
      if (days == null) continue;
      gaps.push(days);
    }
    return gaps;
  }

  function buildClientBehavior(appointments) {
    var out = emptyBehavior();
    var byClient = {};
    var seenAppt = {};

    (appointments || []).forEach(function (appt) {
      if (!isBookedStatus(appt && appt.status)) return;
      var appointmentId = trim(appt && appt.appointmentId);
      if (appointmentId) {
        if (seenAppt[appointmentId]) return;
        seenAppt[appointmentId] = true;
      }
      var clientId = trim(appt && appt.clientId);
      if (!clientId) {
        out.unidentifiedClientAppointmentCount += 1;
        countOwnerLines(out, appt);
        return;
      }
      if (!byClient[clientId]) byClient[clientId] = emptyClient(clientId);
      var row = byClient[clientId];
      if (appointmentId) row.appointmentIds[appointmentId] = true;
      row.appointments.push(appt);
      if (appt.firstVisit === true) row.firstVisit = true;
      countOwnerLines(out, appt);
      (appt.serviceLines || []).forEach(function (line) {
        row.lineCount += 1;
        var key = serviceKey(line);
        if (key) row.serviceKeys[key] = true;
        var providerId = trim(line && line.providerId);
        if (providerId) {
          row.providerLineCount += 1;
          row.providerCounts[providerId] = (row.providerCounts[providerId] || 0) + 1;
        }
        if (line && line.requested === true) {
          row.requestedLineCount += 1;
          row.requestedProviders.push(providerId);
        }
      });
    });

    var clients = Object.keys(byClient).map(function (id) { return byClient[id]; });
    out.identifiedClientCount = clients.length;
    var distinctServiceSum = 0;
    var mostUsedShareSum = 0;
    var mostUsedShareCount = 0;
    var spacing = [];

    clients.forEach(function (row) {
      var appointmentCount = Object.keys(row.appointmentIds).length || row.appointments.length;
      out.identifiedAppointmentCount += appointmentCount;
      if (row.firstVisit) out.firstVisitClientCount += 1;
      else out.returningClientCount += 1;

      if (appointmentCount === 1) out.frequency[0].clientCount += 1;
      else if (appointmentCount === 2) out.frequency[1].clientCount += 1;
      else if (appointmentCount === 3) out.frequency[2].clientCount += 1;
      else if (appointmentCount >= 4) out.frequency[3].clientCount += 1;

      if (appointmentCount >= 2) {
        out.repeatInPeriodClientCount += 1;
        out.repeatInPeriodAppointmentCount += appointmentCount;
        visitIntervals(row.appointments).forEach(function (days) {
          spacing.push(days);
        });
      }

      var distinctServices = Object.keys(row.serviceKeys).length;
      distinctServiceSum += distinctServices;
      if (distinctServices >= 2) out.multiServiceClientCount += 1;

      if (row.providerLineCount > 0) {
        var top = 0;
        Object.keys(row.providerCounts).forEach(function (id) {
          if (row.providerCounts[id] > top) top = row.providerCounts[id];
        });
        mostUsedShareSum += top / row.providerLineCount;
        mostUsedShareCount += 1;
      }

      if (row.requestedLineCount >= 2) {
        out.eligibleRequestedClientCount += 1;
        var consistent = row.requestedProviders.length >= 2
          && row.requestedProviders.every(function (id) {
            return !!id && id === row.requestedProviders[0];
          });
        if (consistent) out.consistentRequestedClientCount += 1;
      }
    });

    out.averageAppointmentsPerClient = out.identifiedClientCount
      ? round1(out.identifiedAppointmentCount / out.identifiedClientCount)
      : 0;
    out.repeatInPeriodClientShare = percent(out.repeatInPeriodClientCount, out.identifiedClientCount);
    out.repeatInPeriodAppointmentShare = percent(out.repeatInPeriodAppointmentCount, out.identifiedAppointmentCount);
    out.averageAppointmentsPerRepeatClient = out.repeatInPeriodClientCount
      ? round1(out.repeatInPeriodAppointmentCount / out.repeatInPeriodClientCount)
      : 0;
    out.frequency.forEach(function (row) {
      row.sharePercent = percent(row.clientCount, out.identifiedClientCount);
    });
    out.averageDistinctServicesPerClient = out.identifiedClientCount
      ? round1(distinctServiceSum / out.identifiedClientCount)
      : 0;
    out.multiServiceClientShare = percent(out.multiServiceClientCount, out.identifiedClientCount);
    out.requestedProviderShare = percent(out.requestedLineCount, out.providerAssignedLineCount);
    out.consistentRequestedShare = percent(out.consistentRequestedClientCount, out.eligibleRequestedClientCount);
    out.averageMostUsedProviderShare = mostUsedShareCount
      ? percent(mostUsedShareSum, mostUsedShareCount)
      : 0;
    out.spacingIntervalCount = spacing.length;
    if (spacing.length) {
      var sum = spacing.reduce(function (total, days) { return total + days; }, 0);
      out.averageDaysBetweenVisits = round1(sum / spacing.length);
      var mid = median(spacing);
      out.medianDaysBetweenVisits = mid == null ? null : round1(mid);
    }
    return out;
  }

  function countOwnerLines(out, appt) {
    (appt.serviceLines || []).forEach(function (line) {
      if (trim(line && line.providerId)) {
        out.providerAssignedLineCount += 1;
        if (line && line.requested === true) out.requestedLineCount += 1;
      }
    });
  }

  function attach(report, appointments) {
    if (!report) return emptyBehavior();
    report.clientBehavior = buildClientBehavior(appointments);
    return report.clientBehavior;
  }

  function appendInsights(out, report, phrase) {
    var b = report && report.clientBehavior;
    if (!b || !out) return;
    var period = phrase || "in this period";

    if (b.identifiedClientCount >= MIN_REPEAT_CLIENTS && b.repeatInPeriodClientShare > 0) {
      out.push(
        b.repeatInPeriodClientShare + "% of identified clients had multiple appointments " + period + "."
      );
    }
    if (b.identifiedClientCount >= MIN_REPEAT_CLIENTS && b.repeatInPeriodAppointmentShare > 0) {
      out.push(
        "Repeat-in-period clients generated " + b.repeatInPeriodAppointmentShare +
        "% of identified-client appointments."
      );
    }
    if (b.identifiedClientCount >= MIN_MULTI_SERVICE_CLIENTS && b.multiServiceClientShare > 0) {
      out.push(
        b.multiServiceClientShare + "% of identified clients booked more than one service type " + period + "."
      );
    }
    if (b.providerAssignedLineCount >= MIN_REQUESTED_LINES && b.requestedProviderShare > 0) {
      out.push(
        b.requestedProviderShare + "% of provider-assigned service lines were requested-provider bookings."
      );
    }
    if (b.eligibleRequestedClientCount >= MIN_CONSISTENT_ELIGIBLE && b.consistentRequestedClientCount > 0) {
      out.push(
        b.consistentRequestedClientCount + " clients consistently requested the same provider across multiple requested services."
      );
    }
    if (b.spacingIntervalCount >= MIN_SPACING_INTERVALS && b.averageDaysBetweenVisits != null) {
      out.push(
        "Repeat-in-period clients averaged " + b.averageDaysBetweenVisits +
        " days between appointments " + period + "."
      );
    }
  }

  window.ffBookingReportsClientBehavior = {
    MIN_REPEAT_CLIENTS: MIN_REPEAT_CLIENTS,
    MIN_MULTI_SERVICE_CLIENTS: MIN_MULTI_SERVICE_CLIENTS,
    MIN_REQUESTED_LINES: MIN_REQUESTED_LINES,
    MIN_CONSISTENT_ELIGIBLE: MIN_CONSISTENT_ELIGIBLE,
    MIN_SPACING_INTERVALS: MIN_SPACING_INTERVALS,
    daysBetween: daysBetween,
    visitIntervals: visitIntervals,
    buildClientBehavior: buildClientBehavior,
    attach: attach,
    appendInsights: appendInsights,
    emptyBehavior: emptyBehavior
  };
})();
