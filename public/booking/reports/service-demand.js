/**
 * Service demand from appointment service lines.
 * priceSnapshot is booked service value, not collected sales.
 *
 * Duration counts each service line separately. Overlapping lines still
 * add demand here. Provider utilization unions the same overlaps so
 * provider minutes and service mix minutes can differ.
 */
(function () {
  var MIN_VALUE_HOUR_MINUTES = 120;
  var MIN_CONCENTRATION_MINUTES = 180;
  var MIN_CONCENTRATION_LINES = 2;
  var MIN_DEMAND_MINUTES = 120;
  var MIN_MIX_MINUTES = 120;

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

  function formatHours(minutes) {
    var api = compute();
    if (api && typeof api.formatHours === "function") return api.formatHours(minutes);
    var hours = Number(minutes) / 60;
    if (!Number.isFinite(hours) || hours === 0) return "0";
    if (Math.abs(hours - Math.round(hours)) < 0.05) return String(Math.round(hours));
    return String(Math.round(hours * 10) / 10);
  }

  function formatMoney(value) {
    var api = compute();
    if (api && typeof api.formatMoney === "function") return api.formatMoney(value);
    var n = Math.round(Number(value) * 100) / 100;
    if (!Number.isFinite(n)) n = 0;
    return "$" + n.toFixed(2);
  }

  function hourWord(count) {
    return Number(count) === 1 ? "hour" : "hours";
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

  function lineBookedMinutes(line, appointment) {
    var duration = Number(line && line.durationMinutes);
    if (duration > 0) return duration;
    var api = compute();
    if (api && typeof api.lineWindow === "function") {
      var win = api.lineWindow(line, appointment, appointment && appointment.locationId);
      if (win && win.durationMinutes > 0) return win.durationMinutes;
    }
    var start = Number(line && line.startMin);
    var end = Number(line && line.endMin);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) return end - start;
    return 0;
  }

  function clientKey(appointment) {
    var clientId = trim(appointment && appointment.clientId);
    if (clientId) return "c:" + clientId;
    var appointmentId = trim(appointment && appointment.appointmentId);
    if (appointmentId) return "a:" + appointmentId;
    return "";
  }

  function emptyService(key, serviceId, name) {
    return {
      key: key,
      serviceId: serviceId || "",
      name: name || "Service",
      nameCounts: {},
      lineCount: 0,
      appointmentIds: {},
      clientIds: {},
      providerIds: {},
      providerMinutes: {},
      bookedMinutes: 0,
      bookedServiceValue: 0,
      pricedLineCount: 0,
      unpricedLineCount: 0,
      pricedMinutes: 0,
      pricedValue: 0,
      requestedLineCount: 0,
      completedLineCount: 0,
      durationLineCount: 0
    };
  }

  function pickName(row) {
    var best = row.name || "Service";
    var bestCount = 0;
    Object.keys(row.nameCounts).forEach(function (name) {
      var count = row.nameCounts[name];
      if (count > bestCount || (count === bestCount && name < best)) {
        best = name;
        bestCount = count;
      }
    });
    return best;
  }

  function finalizeService(row, totals) {
    var appointmentCount = Object.keys(row.appointmentIds).length;
    var clientCount = Object.keys(row.clientIds).length;
    var providerCount = Object.keys(row.providerIds).length;
    var topProviderMinutes = 0;
    Object.keys(row.providerMinutes).forEach(function (id) {
      if (row.providerMinutes[id] > topProviderMinutes) topProviderMinutes = row.providerMinutes[id];
    });
    var valuePerHour = null;
    if (row.pricedMinutes > 0 && row.pricedValue > 0) {
      valuePerHour = Math.round((row.pricedValue / (row.pricedMinutes / 60)) * 100) / 100;
    }
    var averageValue = row.pricedLineCount > 0
      ? Math.round((row.pricedValue / row.pricedLineCount) * 100) / 100
      : null;
    var averageDuration = row.durationLineCount > 0
      ? Math.round((row.bookedMinutes / row.durationLineCount) * 10) / 10
      : 0;
    return {
      key: row.key,
      serviceId: row.serviceId,
      name: pickName(row),
      lineCount: row.lineCount,
      appointmentCount: appointmentCount,
      clientCount: clientCount,
      bookedMinutes: row.bookedMinutes,
      bookedServiceValue: Math.round(row.bookedServiceValue * 100) / 100,
      averageBookedValue: averageValue,
      averageDurationMinutes: averageDuration,
      valuePerProviderHour: valuePerHour,
      requestedLineCount: row.requestedLineCount,
      requestedPercent: percent(row.requestedLineCount, row.lineCount),
      completedLineCount: row.completedLineCount,
      providerCount: providerCount,
      topProviderSharePercent: row.bookedMinutes > 0 && topProviderMinutes > 0
        ? percent(topProviderMinutes, row.bookedMinutes)
        : 0,
      timeMixPercent: percent(row.bookedMinutes, totals.bookedMinutes),
      valueSharePercent: percent(row.bookedServiceValue, totals.bookedServiceValue),
      pricedLineCount: row.pricedLineCount,
      unpricedLineCount: row.unpricedLineCount,
      pricedMinutes: row.pricedMinutes
    };
  }

  function rankServices(rows) {
    return (rows || []).slice().sort(function (a, b) {
      return (b.bookedMinutes - a.bookedMinutes)
        || (b.lineCount - a.lineCount)
        || String(a.name || "").localeCompare(String(b.name || ""));
    });
  }

  function emptyDemand() {
    return {
      services: [],
      totals: {
        serviceCount: 0,
        lineCount: 0,
        bookedMinutes: 0,
        bookedServiceValue: 0,
        pricedLineCount: 0,
        unpricedLineCount: 0,
        completedLineCount: 0
      },
      highestDemand: null
    };
  }

  function collectFacts(appointments) {
    var facts = [];
    (appointments || []).forEach(function (appt) {
      if (!isBookedStatus(appt && appt.status)) return;
      (appt.serviceLines || []).forEach(function (line) {
        var key = serviceKey(line);
        if (!key) return;
        var minutes = lineBookedMinutes(line, appt);
        var price = Number(line && line.priceSnapshot);
        var priced = price > 0;
        facts.push({
          key: key,
          serviceId: trim(line && line.serviceId),
          name: collapseName(line && line.serviceNameSnapshot) || "Service",
          appointmentId: trim(appt && appt.appointmentId),
          clientKey: clientKey(appt),
          providerId: trim(line && line.providerId),
          minutes: minutes,
          price: priced ? price : 0,
          priced: priced,
          requested: !!(line && line.requested),
          completed: trim(appt && appt.status) === "completed"
        });
      });
    });
    return facts;
  }

  function buildServiceDemand(appointments) {
    var facts = collectFacts(appointments);
    var byKey = {};
    var totals = {
      serviceCount: 0,
      lineCount: 0,
      bookedMinutes: 0,
      bookedServiceValue: 0,
      pricedLineCount: 0,
      unpricedLineCount: 0,
      completedLineCount: 0
    };

    facts.forEach(function (fact) {
      if (!byKey[fact.key]) {
        byKey[fact.key] = emptyService(fact.key, fact.serviceId, fact.name);
      }
      var row = byKey[fact.key];
      row.lineCount += 1;
      totals.lineCount += 1;
      if (fact.name) {
        row.nameCounts[fact.name] = (row.nameCounts[fact.name] || 0) + 1;
      }
      if (fact.appointmentId) row.appointmentIds[fact.appointmentId] = true;
      if (fact.clientKey) row.clientIds[fact.clientKey] = true;
      if (fact.providerId) {
        row.providerIds[fact.providerId] = true;
        row.providerMinutes[fact.providerId] = (row.providerMinutes[fact.providerId] || 0) + fact.minutes;
      }
      if (fact.minutes > 0) {
        row.bookedMinutes += fact.minutes;
        row.durationLineCount += 1;
        totals.bookedMinutes += fact.minutes;
      }
      if (fact.priced) {
        row.bookedServiceValue += fact.price;
        row.pricedValue += fact.price;
        row.pricedLineCount += 1;
        totals.bookedServiceValue += fact.price;
        totals.pricedLineCount += 1;
        if (fact.minutes > 0) row.pricedMinutes += fact.minutes;
      } else {
        row.unpricedLineCount += 1;
        totals.unpricedLineCount += 1;
      }
      if (fact.requested) row.requestedLineCount += 1;
      if (fact.completed) {
        row.completedLineCount += 1;
        totals.completedLineCount += 1;
      }
    });

    totals.bookedServiceValue = Math.round(totals.bookedServiceValue * 100) / 100;
    var services = rankServices(Object.keys(byKey).map(function (key) {
      return finalizeService(byKey[key], totals);
    }));
    totals.serviceCount = services.length;
    return {
      services: services,
      totals: totals,
      highestDemand: services[0] || null
    };
  }

  function attach(report, appointments) {
    if (!report) return emptyDemand();
    report.serviceDemand = buildServiceDemand(appointments);
    return report.serviceDemand;
  }

  function appendInsights(out, report, phrase) {
    var demand = report && report.serviceDemand;
    if (!demand || !out) return;
    var services = demand.services || [];
    var totals = demand.totals || {};
    if (!services.length) return;

    var topDemand = services[0];
    if (topDemand && topDemand.bookedMinutes >= MIN_DEMAND_MINUTES) {
      out.push(
        topDemand.name + " had the highest booked service demand at " +
        formatHours(topDemand.bookedMinutes) + " provider " +
        hourWord(topDemand.bookedMinutes / 60) + "."
      );
    }

    if (totals.bookedMinutes >= MIN_MIX_MINUTES && topDemand && topDemand.timeMixPercent > 0) {
      out.push(
        topDemand.name + " represented " + topDemand.timeMixPercent +
        "% of booked service time " + (phrase || "in this period") + "."
      );
    }

    var valueHourRows = services.filter(function (row) {
      return row.pricedMinutes >= MIN_VALUE_HOUR_MINUTES && row.valuePerProviderHour != null;
    }).sort(function (a, b) {
      return (b.valuePerProviderHour - a.valuePerProviderHour) || (b.pricedMinutes - a.pricedMinutes);
    });
    if (valueHourRows[0]) {
      out.push(
        valueHourRows[0].name + " had the highest booked value per provider hour at " +
        formatMoney(valueHourRows[0].valuePerProviderHour) + "."
      );
    }

    var concentrated = services.filter(function (row) {
      return row.bookedMinutes >= MIN_CONCENTRATION_MINUTES
        && row.lineCount >= MIN_CONCENTRATION_LINES
        && row.providerCount >= 2
        && row.topProviderSharePercent > 0;
    }).sort(function (a, b) {
      return (b.topProviderSharePercent - a.topProviderSharePercent) || (b.bookedMinutes - a.bookedMinutes);
    });
    if (concentrated[0]) {
      out.push(
        concentrated[0].topProviderSharePercent + "% of " + concentrated[0].name +
        " service time was assigned to one provider."
      );
    }

    var valueRows = services.filter(function (row) {
      return row.bookedServiceValue > 0 && (row.pricedLineCount >= 2 || row.pricedMinutes >= MIN_VALUE_HOUR_MINUTES);
    }).sort(function (a, b) {
      return (b.valueSharePercent - a.valueSharePercent) || (b.bookedServiceValue - a.bookedServiceValue);
    });
    if (totals.pricedLineCount >= 2 && valueRows[0] && valueRows[0].valueSharePercent > 0) {
      out.push(
        valueRows[0].name + " accounted for " + valueRows[0].valueSharePercent +
        "% of booked appointment value."
      );
    }
  }

  window.ffBookingReportsServiceDemand = {
    MIN_VALUE_HOUR_MINUTES: MIN_VALUE_HOUR_MINUTES,
    MIN_CONCENTRATION_MINUTES: MIN_CONCENTRATION_MINUTES,
    serviceKey: serviceKey,
    lineBookedMinutes: lineBookedMinutes,
    buildServiceDemand: buildServiceDemand,
    attach: attach,
    appendInsights: appendInsights,
    emptyDemand: emptyDemand
  };
})();
