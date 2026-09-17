/**
 * Forward Outlook. Future booked capacity from now through a selected range.
 * Reuses Intelligence interval primitives. No Firestore.
 *
 * Future working minutes = remaining provider windows minus Time Blocks.
 * Booked ahead minutes = union of non-cancelled future line intervals
 * clipped to those bookable windows and to now. Utilization = booked / working.
 * Time Blocks are removed from capacity and are not booked appointment time.
 * Upcoming gaps are unused bookable time BETWEEN future booked appointments.
 */
(function () {
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
  var MIN_UTIL_WORKING = 120;
  var MIN_WEEKDAY_DATES = 2;
  var MIN_SERVICE_LINES = 3;
  var MIN_SMALL_GAP = 30;
  var MIN_VALUE = 1;
  var DAY_END_MIN = 36 * 60;
  var EMPTY_BOOKED = "No appointments are currently booked in this future period.";
  var EMPTY_CAPACITY = "No future working time in this period.";
  var LOAD_ERROR_MESSAGE = "This report could not load.";
  var SCHEDULE_ERROR_MESSAGE = "Provider schedules for this range could not load.";

  function intel() {
    return window.ffBookingReportsIntelligenceCompute || null;
  }

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function collapseName(value) {
    return trim(value).replace(/\s+/g, " ");
  }

  function addDays(dateKey, delta) {
    var api = intel();
    if (api && typeof api.addDays === "function") return api.addDays(dateKey, delta);
    var shared = window.ffBookingReportsCompute;
    if (shared && typeof shared.addDays === "function") return shared.addDays(dateKey, delta);
    return "";
  }

  function dateKeysBetween(fromKey, toKey) {
    var api = intel();
    if (api && typeof api.dateKeysBetween === "function") return api.dateKeysBetween(fromKey, toKey);
    return [];
  }

  function inRange(dateKey, fromKey, toKey) {
    var api = intel();
    if (api && typeof api.inRange === "function") return api.inRange(dateKey, fromKey, toKey);
    var key = trim(dateKey);
    if (!key) return false;
    if (fromKey && key < fromKey) return false;
    if (toKey && key > toKey) return false;
    return true;
  }

  function isBookedStatus(status) {
    var api = intel();
    if (api && typeof api.isBookedStatus === "function") return api.isBookedStatus(status);
    return ["scheduled", "confirmed", "checked_in", "in_service", "completed", "no_show"].indexOf(trim(status)) !== -1;
  }

  function mergeIntervals(list) {
    var api = intel();
    if (api && typeof api.mergeIntervals === "function") return api.mergeIntervals(list);
    return [];
  }

  function clipInterval(interval, win) {
    var api = intel();
    if (api && typeof api.clipInterval === "function") return api.clipInterval(interval, win);
    return null;
  }

  function capacityFromWindows(windows, booked) {
    var api = intel();
    if (api && typeof api.capacityFromWindows === "function") return api.capacityFromWindows(windows, booked);
    return {
      windows: [],
      occupied: [],
      gaps: [],
      workingMinutes: 0,
      bookedMinutes: 0,
      idleMinutes: 0,
      gapMinutes: 0,
      openEdgeMinutes: 0
    };
  }

  function subtractFromWindows(windows, cuts) {
    var api = intel();
    if (api && typeof api.subtractFromWindows === "function") return api.subtractFromWindows(windows, cuts);
    return mergeIntervals(windows);
  }

  function indexTimeBlocks(blocks) {
    var api = intel();
    if (api && typeof api.indexTimeBlocks === "function") return api.indexTimeBlocks(blocks);
    return {};
  }

  function lineWindow(line, appointment, locationId) {
    var api = intel();
    if (api && typeof api.lineWindow === "function") return api.lineWindow(line, appointment, locationId);
    return null;
  }

  function percent(part, whole) {
    var api = intel();
    if (api && typeof api.percent === "function") return api.percent(part, whole);
    if (!whole) return 0;
    var n = (Number(part) / Number(whole)) * 100;
    return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
  }

  function formatHours(minutes) {
    var api = intel();
    if (api && typeof api.formatHours === "function") return api.formatHours(minutes);
    var hours = Number(minutes) / 60;
    if (!Number.isFinite(hours) || hours === 0) return "0";
    return String(Math.round(hours * 10) / 10);
  }

  function formatMoney(value) {
    var api = intel();
    if (api && typeof api.formatMoney === "function") return api.formatMoney(value);
    var n = Math.round(Number(value) * 100) / 100;
    if (!Number.isFinite(n)) n = 0;
    return "$" + n.toFixed(2);
  }

  function hours1(minutes) {
    var n = Math.round(((Number(minutes) || 0) / 60) * 10) / 10;
    return Number.isFinite(n) ? n : 0;
  }

  function money2(value) {
    var n = Math.round((Number(value) || 0) * 100) / 100;
    return Number.isFinite(n) ? n : 0;
  }

  function weekdayFromDateKey(dateKey) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trim(dateKey));
    if (!m) return "";
    var utc = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
    return WEEKDAYS[(utc.getUTCDay() + 6) % 7] || "";
  }

  function rangeText(fromKey, toKey) {
    var shared = window.ffBookingReportsCompute;
    if (shared && typeof shared.rangeText === "function") return shared.rangeText(fromKey, toKey);
    if (!fromKey) return "";
    if (!toKey || fromKey === toKey) return fromKey;
    return fromKey + " - " + toKey;
  }

  function rangeForPreset(kind, todayKey, customFrom, customTo) {
    var today = trim(todayKey);
    var key = trim(kind) || "next_7";
    if (!today) return { fromKey: "", toKey: "" };
    if (key === "next_7") return { fromKey: today, toKey: addDays(today, 6) };
    if (key === "next_14") return { fromKey: today, toKey: addDays(today, 13) };
    if (key === "next_30") return { fromKey: today, toKey: addDays(today, 29) };
    if (key === "custom") {
      var from = trim(customFrom);
      var to = trim(customTo);
      if (!from && !to) return { fromKey: "", toKey: "" };
      if (from && to && from > to) return { fromKey: to, toKey: from };
      return { fromKey: from || to, toKey: to || from };
    }
    return { fromKey: today, toKey: addDays(today, 6) };
  }

  function datePresets(todayKey) {
    var today = trim(todayKey);
    var n7 = rangeForPreset("next_7", today);
    var n14 = rangeForPreset("next_14", today);
    var n30 = rangeForPreset("next_30", today);
    return [
      { value: "next_7", label: "Next 7 days (" + rangeText(n7.fromKey, n7.toKey) + ")" },
      { value: "next_14", label: "Next 14 days (" + rangeText(n14.fromKey, n14.toKey) + ")" },
      { value: "next_30", label: "Next 30 days (" + rangeText(n30.fromKey, n30.toKey) + ")" },
      { value: "custom", label: "Custom" }
    ];
  }

  function locationNow(locationId, opts) {
    var map = opts && opts.nowByLocation;
    var loc = trim(locationId);
    if (map && loc && map[loc]) {
      return {
        todayKey: trim(map[loc].todayKey),
        nowMinutes: Number(map[loc].nowMinutes)
      };
    }
    if (map && map["*"]) {
      return {
        todayKey: trim(map["*"].todayKey),
        nowMinutes: Number(map["*"].nowMinutes)
      };
    }
    var now = opts && opts.now;
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) now = new Date();
    var tm = window.ffBookingTime;
    if (tm && typeof tm.zonedDateKey === "function" && typeof tm.zonedMinutes === "function") {
      return {
        todayKey: trim(tm.zonedDateKey(now, loc)),
        nowMinutes: Number(tm.zonedMinutes(now, loc))
      };
    }
    return {
      todayKey: trim(opts && opts.todayKey),
      nowMinutes: 0
    };
  }

  function clipWindowsAtNow(windows, dateKey, locNow) {
    var merged = mergeIntervals(windows);
    if (!locNow || !locNow.todayKey) return merged;
    if (dateKey < locNow.todayKey) return [];
    if (dateKey > locNow.todayKey) return merged;
    var nowMin = Number(locNow.nowMinutes);
    if (!Number.isFinite(nowMin)) return merged;
    return mergeIntervals(merged.map(function (win) {
      return clipInterval(win, { startMin: nowMin, endMin: DAY_END_MIN });
    }).filter(Boolean));
  }

  function clipBookedInterval(win, locNow) {
    if (!win || !win.dateKey) return null;
    if (locNow && locNow.todayKey && win.dateKey < locNow.todayKey) return null;
    if (locNow && locNow.todayKey && win.dateKey === locNow.todayKey) {
      var nowMin = Number(locNow.nowMinutes);
      if (Number.isFinite(nowMin)) {
        return clipInterval(win, { startMin: nowMin, endMin: DAY_END_MIN });
      }
    }
    if (!(win.endMin > win.startMin)) return null;
    return { startMin: win.startMin, endMin: win.endMin };
  }

  function periodPhrase(opts) {
    var kind = trim(opts && opts.preset);
    if (kind === "next_7") return "over the next 7 days";
    if (kind === "next_14") return "over the next 14 days";
    if (kind === "next_30") return "over the next 30 days";
    return "in this future period";
  }

  function hourWord(count) {
    return Number(count) === 1 ? "hour" : "hours";
  }

  function serviceKey(line) {
    var id = trim(line && line.serviceId);
    if (id) return "id:" + id;
    var name = collapseName(line && line.serviceNameSnapshot);
    if (name) return "name:" + name.toLowerCase();
    return "unspecified";
  }

  function normalizeProviders(providers) {
    return (providers || []).map(function (row) {
      return {
        id: trim(row && (row.id || row.providerId || row.staffId)),
        name: trim(row && (row.name || row.displayName || row.providerNameSnapshot)),
        firstName: trim(row && row.firstName),
        schedule: (row && row.schedule || []).map(function (entry) {
          return {
            dateKey: trim(entry && entry.dateKey),
            locationId: trim(entry && entry.locationId),
            windows: mergeIntervals(entry && (entry.windows || entry.working) || [])
          };
        }).filter(function (entry) { return !!entry.dateKey; })
      };
    }).filter(function (row) { return row.id; });
  }

  function emptyDay(dateKey) {
    return {
      dateKey: dateKey,
      weekday: weekdayFromDateKey(dateKey),
      workingMinutes: 0,
      bookedMinutes: 0,
      openMinutes: 0,
      gapMinutes: 0,
      openEdgeMinutes: 0,
      percent: 0,
      appointmentCount: 0,
      bookedServiceValue: 0,
      hours: 0
    };
  }

  function buildInsights(totals, weekdays, services, opts) {
    var out = [];
    var phrase = periodPhrase(opts);
    if (totals.workingMinutes >= MIN_UTIL_WORKING) {
      out.push(totals.utilization + "% of provider working time is already booked " + phrase + ".");
    }
    if (totals.workingMinutes > 0 && totals.openMinutes > 0 && out.length < 4) {
      out.push(formatHours(totals.openMinutes) + " provider " + hourWord(totals.openMinutes / 60) + " are still open " + phrase + ".");
    }
    var weekdayHits = (weekdays || []).filter(function (row) {
      return row.dateCount >= MIN_WEEKDAY_DATES && row.workingMinutes > 0;
    });
    if (weekdayHits.length >= 2 && out.length < 4) {
      var top = weekdayHits.slice().sort(function (a, b) {
        return (b.percent - a.percent) || (b.bookedMinutes - a.bookedMinutes);
      })[0];
      if (top) {
        out.push(top.label + " currently has the highest booked-ahead utilization at " + top.percent + "%.");
      }
    }
    if (totals.gapMinutes > 0 && out.length < 4) {
      out.push(formatHours(totals.gapMinutes) + " provider " + hourWord(totals.gapMinutes / 60) + " are currently split across internal calendar gaps.");
    }
    if (totals.smallGapMinutes >= MIN_SMALL_GAP && out.length < 4) {
      out.push(formatHours(totals.smallGapMinutes) + " provider " + hourWord(totals.smallGapMinutes / 60) + " are currently sitting in calendar gaps of 30 minutes or less " + phrase + ".");
    }
    var ranked = (services || []).filter(function (row) { return row.lineCount >= MIN_SERVICE_LINES; });
    if (ranked.length && totals.serviceMinutes && out.length < 4) {
      out.push(ranked[0].name + " represents " + ranked[0].timeMix + "% of booked provider time ahead.");
    }
    if (totals.bookedServiceValue >= MIN_VALUE && out.length < 4) {
      out.push(formatMoney(totals.bookedServiceValue) + " in booked service value is currently on the future book.");
    }
    return out.slice(0, 4);
  }

  function buildOutlook(input) {
    var opts = input && typeof input === "object" ? input : {};
    var fromKey = trim(opts.fromKey);
    var toKey = trim(opts.toKey);
    var locationIds = Array.isArray(opts.locationIds) ? opts.locationIds.map(trim).filter(Boolean) : [];
    var keys = dateKeysBetween(fromKey, toKey);
    var providers = normalizeProviders(opts.providers);
    var appointments = (opts.appointments || []).filter(function (appt) {
      if (!appt) return false;
      if (locationIds.length && locationIds.indexOf(trim(appt.locationId)) === -1) return false;
      var dateKey = trim(appt.dateKey);
      if (dateKey) return inRange(dateKey, fromKey, toKey);
      var api = intel();
      if (api && typeof api.appointmentInScope === "function") return api.appointmentInScope(appt, opts);
      return true;
    });

    var bookedByKey = {};
    var blockByKey = indexTimeBlocks(opts.timeBlocks);
    var futureAppointments = [];
    var clientIds = {};
    var firstVisit = 0;
    var requestedLines = 0;
    var futureLines = 0;
    var valueByDay = {};
    var apptByDay = {};
    var serviceAgg = {};
    var pricedLines = 0;
    var unpricedLines = 0;
    var bookedServiceValue = 0;
    var serviceMinutes = 0;

    appointments.forEach(function (appt) {
      if (!isBookedStatus(appt.status)) return;
      var locNow = locationNow(appt.locationId, opts);
      var remaining = false;
      (appt.serviceLines || []).forEach(function (line) {
        var win = lineWindow(line, appt, appt.locationId);
        var clipped = clipBookedInterval(win, locNow);
        if (!clipped) return;
        remaining = true;
        var providerId = trim(line && line.providerId);
        if (providerId && win && win.dateKey) {
          var key = providerId + "|" + win.dateKey + "|" + trim(appt.locationId);
          if (!bookedByKey[key]) bookedByKey[key] = [];
          bookedByKey[key].push(clipped);
        }
        futureLines += 1;
        if (line && line.requested === true) requestedLines += 1;
        var minutes = clipped.endMin - clipped.startMin;
        var duration = Number(line && line.durationMinutes);
        if (!(duration > 0)) duration = minutes;
        var price = Number(line && line.priceSnapshot);
        var sKey = serviceKey(line);
        if (!serviceAgg[sKey]) {
          serviceAgg[sKey] = {
            key: sKey,
            serviceId: trim(line && line.serviceId),
            name: collapseName(line && line.serviceNameSnapshot) || "Service",
            lineCount: 0,
            minutes: 0,
            value: 0,
            providerIds: {}
          };
        }
        serviceAgg[sKey].lineCount += 1;
        serviceAgg[sKey].minutes += duration;
        serviceMinutes += duration;
        if (trim(line && line.providerId)) serviceAgg[sKey].providerIds[trim(line.providerId)] = true;
        if (price > 0) {
          serviceAgg[sKey].value = money2(serviceAgg[sKey].value + price);
          bookedServiceValue = money2(bookedServiceValue + price);
          pricedLines += 1;
          if (win && win.dateKey) valueByDay[win.dateKey] = money2((valueByDay[win.dateKey] || 0) + price);
        } else {
          unpricedLines += 1;
        }
      });
      if (!remaining) return;
      futureAppointments.push(appt);
      var dayKey = trim(appt.dateKey) || (appt.serviceLines && appt.serviceLines[0] && lineWindow(appt.serviceLines[0], appt, appt.locationId) || {}).dateKey || "";
      if (dayKey) apptByDay[dayKey] = (apptByDay[dayKey] || 0) + 1;
      if (trim(appt.clientId)) clientIds[trim(appt.clientId)] = true;
      if (appt.firstVisit === true) firstVisit += 1;
    });

    var daysMap = {};
    keys.forEach(function (key) { daysMap[key] = emptyDay(key); });
    var providersOut = [];
    var workingMinutes = 0;
    var bookedMinutes = 0;
    var openMinutes = 0;
    var gapMinutes = 0;
    var openEdgeMinutes = 0;
    var gapCount = 0;
    var smallGapMinutes = 0;

    providers.forEach(function (provider) {
      var row = {
        id: provider.id,
        name: provider.name || provider.id,
        firstName: provider.firstName || "",
        workingMinutes: 0,
        bookedMinutes: 0,
        openMinutes: 0,
        gapMinutes: 0,
        openEdgeMinutes: 0,
        gapCount: 0,
        percent: 0
      };
      (provider.schedule || []).forEach(function (entry) {
        if (locationIds.length && entry.locationId && locationIds.indexOf(entry.locationId) === -1) return;
        if (!inRange(entry.dateKey, fromKey, toKey)) return;
        var locNow = locationNow(entry.locationId, opts);
        var key = provider.id + "|" + entry.dateKey + "|" + trim(entry.locationId);
        var windows = subtractFromWindows(
          clipWindowsAtNow(entry.windows, entry.dateKey, locNow),
          blockByKey[key] || []
        );
        var cap = capacityFromWindows(windows, bookedByKey[key] || []);
        row.workingMinutes += cap.workingMinutes;
        row.bookedMinutes += cap.bookedMinutes;
        row.gapMinutes += cap.gapMinutes;
        row.gapCount += cap.gaps.length;
        cap.gaps.forEach(function (gap) {
          if (gap.minutes <= 30) smallGapMinutes += gap.minutes;
        });
        if (!daysMap[entry.dateKey]) daysMap[entry.dateKey] = emptyDay(entry.dateKey);
        daysMap[entry.dateKey].workingMinutes += cap.workingMinutes;
        daysMap[entry.dateKey].bookedMinutes += cap.bookedMinutes;
        daysMap[entry.dateKey].gapMinutes += cap.gapMinutes;
        daysMap[entry.dateKey].openEdgeMinutes += cap.openEdgeMinutes;
      });
      row.openMinutes = Math.max(0, row.workingMinutes - row.bookedMinutes);
      row.openEdgeMinutes = Math.max(0, row.openMinutes - row.gapMinutes);
      row.percent = percent(row.bookedMinutes, row.workingMinutes);
      row.hoursWorking = hours1(row.workingMinutes);
      row.hoursBooked = hours1(row.bookedMinutes);
      row.hoursOpen = hours1(row.openMinutes);
      row.hoursGap = hours1(row.gapMinutes);
      row.hoursOpenEdge = hours1(row.openEdgeMinutes);
      if (row.workingMinutes > 0) providersOut.push(row);
      workingMinutes += row.workingMinutes;
      bookedMinutes += row.bookedMinutes;
      openMinutes += row.openMinutes;
      gapMinutes += row.gapMinutes;
      openEdgeMinutes += row.openEdgeMinutes;
      gapCount += row.gapCount;
    });

    providersOut.sort(function (a, b) {
      return (b.gapMinutes - a.gapMinutes)
        || (b.openMinutes - a.openMinutes)
        || (b.workingMinutes - a.workingMinutes)
        || String(a.name || a.id).localeCompare(String(b.name || b.id));
    });

    Object.keys(apptByDay).forEach(function (key) {
      if (!daysMap[key]) daysMap[key] = emptyDay(key);
      daysMap[key].appointmentCount = apptByDay[key];
    });
    Object.keys(valueByDay).forEach(function (key) {
      if (!daysMap[key]) daysMap[key] = emptyDay(key);
      daysMap[key].bookedServiceValue = valueByDay[key];
    });

    var days = Object.keys(daysMap).sort().map(function (key) {
      var row = daysMap[key];
      row.openMinutes = Math.max(0, row.workingMinutes - row.bookedMinutes);
      row.percent = row.workingMinutes > 0 ? percent(row.bookedMinutes, row.workingMinutes) : 0;
      row.hoursWorking = hours1(row.workingMinutes);
      row.hoursBooked = hours1(row.bookedMinutes);
      row.hoursOpen = hours1(row.openMinutes);
      row.hoursGap = hours1(row.gapMinutes);
      return row;
    }).filter(function (row) {
      return row.workingMinutes > 0;
    });

    var weekdayDateCounts = {};
    WEEKDAYS.forEach(function (key) { weekdayDateCounts[key] = 0; });
    days.forEach(function (day) {
      if (day.weekday) weekdayDateCounts[day.weekday] += 1;
    });
    var weekdayMap = {};
    WEEKDAYS.forEach(function (key) {
      weekdayMap[key] = {
        weekday: key,
        label: WEEKDAY_LABELS[key],
        dateCount: weekdayDateCounts[key],
        workingMinutes: 0,
        bookedMinutes: 0,
        gapMinutes: 0,
        bookedServiceValue: 0,
        percent: 0
      };
    });
    days.forEach(function (day) {
      var row = weekdayMap[day.weekday];
      if (!row) return;
      row.workingMinutes += day.workingMinutes;
      row.bookedMinutes += day.bookedMinutes;
      row.gapMinutes += day.gapMinutes;
      row.bookedServiceValue = money2(row.bookedServiceValue + day.bookedServiceValue);
    });
    var weekdays = WEEKDAYS.map(function (key) { return weekdayMap[key]; }).filter(function (row) {
      return row.dateCount > 0 && row.workingMinutes > 0;
    }).map(function (row) {
      row.percent = percent(row.bookedMinutes, row.workingMinutes);
      row.hoursWorking = hours1(row.workingMinutes);
      row.hoursBooked = hours1(row.bookedMinutes);
      row.hoursGap = hours1(row.gapMinutes);
      return row;
    });

    var services = Object.keys(serviceAgg).map(function (key) {
      var row = serviceAgg[key];
      return {
        key: row.key,
        serviceId: row.serviceId,
        name: row.name,
        lineCount: row.lineCount,
        minutes: row.minutes,
        hours: hours1(row.minutes),
        timeMix: percent(row.minutes, serviceMinutes),
        bookedServiceValue: money2(row.value),
        valueShare: percent(row.value, bookedServiceValue),
        providerCount: Object.keys(row.providerIds).length
      };
    }).sort(function (a, b) {
      return (b.minutes - a.minutes) || (b.lineCount - a.lineCount) || String(a.name).localeCompare(String(b.name));
    });

    var totals = {
      futureAppointments: futureAppointments.length,
      identifiedClients: Object.keys(clientIds).length,
      firstVisitAppointments: firstVisit,
      requestedLines: requestedLines,
      futureLines: futureLines,
      requestedPercent: percent(requestedLines, futureLines),
      workingMinutes: workingMinutes,
      bookedMinutes: bookedMinutes,
      openMinutes: openMinutes,
      gapMinutes: gapMinutes,
      openEdgeMinutes: openEdgeMinutes,
      gapCount: gapCount,
      smallGapMinutes: smallGapMinutes,
      utilization: percent(bookedMinutes, workingMinutes),
      hoursWorking: hours1(workingMinutes),
      hoursBooked: hours1(bookedMinutes),
      hoursOpen: hours1(openMinutes),
      hoursGap: hours1(gapMinutes),
      bookedServiceValue: money2(bookedServiceValue),
      pricedLineCount: pricedLines,
      unpricedLineCount: unpricedLines,
      pricingCoverage: percent(pricedLines, pricedLines + unpricedLines),
      serviceMinutes: serviceMinutes
    };

    return {
      totals: totals,
      providers: providersOut,
      days: days,
      weekdays: weekdays,
      services: services,
      insights: buildInsights(totals, weekdays, services, opts)
    };
  }

  function ownerView(summary) {
    var totals = summary && summary.totals;
    if (!totals) return { kind: "empty", message: EMPTY_CAPACITY, summary: null };
    if (!totals.workingMinutes) {
      return { kind: "empty", message: EMPTY_CAPACITY, summary: summary };
    }
    if (!totals.futureAppointments) {
      return { kind: "empty-booked", message: EMPTY_BOOKED, summary: summary };
    }
    return { kind: "ok", message: "", summary: summary };
  }

  window.ffBookingReportsForwardOutlookCompute = {
    MIN_UTIL_WORKING: MIN_UTIL_WORKING,
    MIN_WEEKDAY_DATES: MIN_WEEKDAY_DATES,
    MIN_SERVICE_LINES: MIN_SERVICE_LINES,
    EMPTY_BOOKED: EMPTY_BOOKED,
    EMPTY_CAPACITY: EMPTY_CAPACITY,
    LOAD_ERROR_MESSAGE: LOAD_ERROR_MESSAGE,
    SCHEDULE_ERROR_MESSAGE: SCHEDULE_ERROR_MESSAGE,
    WEEKDAYS: WEEKDAYS.slice(),
    WEEKDAY_LABELS: WEEKDAY_LABELS,
    addDays: addDays,
    rangeForPreset: rangeForPreset,
    datePresets: datePresets,
    locationNow: locationNow,
    clipWindowsAtNow: clipWindowsAtNow,
    clipBookedInterval: clipBookedInterval,
    isBookedStatus: isBookedStatus,
    buildOutlook: buildOutlook,
    ownerView: ownerView,
    formatHours: formatHours,
    formatMoney: formatMoney
  };
})();
