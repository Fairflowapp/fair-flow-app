/**
 * Booking Intelligence numbers. Appointments, utilization, gaps, insights.
 * No Firestore. Callers pass appointments and provider schedules.
 *
 * Time buckets stay separate:
 *   working  = provider scheduled minutes inside effective working windows
 *   booked   = union of active appointment time clipped to those windows
 *   idle     = working − booked (includes open time before first / after last)
 *   gap      = unused working time BETWEEN booked blocks only
 * Calendar gap time is a subset of idle time. Utilization stays booked / working.
 */
(function () {
  var BOOKED_STATUSES = [
    "scheduled",
    "confirmed",
    "checked_in",
    "in_service",
    "completed",
    "no_show"
  ];
  var KNOWN_SOURCES = ["front_desk", "phone", "online", "walk_in", "internal"];
  var SOURCE_LABELS = {
    front_desk: "Front desk",
    phone: "Phone",
    online: "Online",
    walk_in: "Walk-in",
    internal: "Internal",
    other: "Other"
  };
  var SMALL_GAP_MAX = 30;
  var MAX_RANGE_DAYS = 366;

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

  function inRange(dateKey, fromKey, toKey) {
    var shared = window.ffBookingReportsCompute;
    if (shared && typeof shared.inRange === "function") return shared.inRange(dateKey, fromKey, toKey);
    var key = trim(dateKey);
    if (!key) return false;
    if (fromKey && key < fromKey) return false;
    if (toKey && key > toKey) return false;
    return true;
  }

  function isBookedStatus(status) {
    return BOOKED_STATUSES.indexOf(trim(status)) !== -1;
  }

  function appointmentDateKeys(appt) {
    var keys = [];
    if (appt && Array.isArray(appt.dateKeys)) {
      appt.dateKeys.forEach(function (key) {
        var k = trim(key);
        if (k) keys.push(k);
      });
    }
    var main = trim(appt && appt.dateKey);
    if (main && keys.indexOf(main) === -1) keys.unshift(main);
    return keys;
  }

  function appointmentDateKey(appt, locationId) {
    var keys = appointmentDateKeys(appt);
    if (keys.length) return keys[0];
    return lineDateKey({ startAt: appt && appt.startAt }, locationId || (appt && appt.locationId));
  }

  function locationAllowed(row, locationIds) {
    var ids = Array.isArray(locationIds) ? locationIds : [];
    if (!ids.length) return true;
    return ids.indexOf(trim(row && row.locationId)) !== -1;
  }

  function appointmentInScope(appt, opts) {
    if (!appt) return false;
    if (!locationAllowed(appt, opts && opts.locationIds)) return false;
    var fromKey = trim(opts && opts.fromKey);
    var toKey = trim(opts && opts.toKey);
    var keys = appointmentDateKeys(appt);
    if (!keys.length) {
      var derived = appointmentDateKey(appt, appt.locationId);
      if (derived) keys = [derived];
    }
    if (!keys.length) return !fromKey && !toKey;
    return keys.some(function (key) {
      return inRange(key, fromKey, toKey);
    });
  }

  function toDate(value) {
    var model = window.ffBookingAppointmentModel;
    if (model && typeof model.toDate === "function") return model.toDate(value);
    if (!value && value !== 0) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    var instant = new Date(value);
    return Number.isNaN(instant.getTime()) ? null : instant;
  }

  function lineDateKey(line, locationId) {
    if (line && trim(line.dateKey)) return trim(line.dateKey);
    var model = window.ffBookingAppointmentModel;
    if (model && typeof model.dateKeyOf === "function" && line && line.startAt) {
      return trim(model.dateKeyOf(line.startAt, locationId));
    }
    var tm = window.ffBookingTime;
    var date = toDate(line && line.startAt);
    if (date && tm && typeof tm.zonedDateKey === "function") {
      return trim(tm.zonedDateKey(date, locationId));
    }
    return "";
  }

  function zonedMinutes(value, locationId) {
    var tm = window.ffBookingTime;
    var date = toDate(value);
    if (date && tm && typeof tm.zonedMinutes === "function") {
      var min = tm.zonedMinutes(date, locationId);
      return Number.isFinite(min) ? min : null;
    }
    if (date) return date.getHours() * 60 + date.getMinutes();
    return null;
  }

  function lineWindow(line, appointment, locationId) {
    var loc = trim(locationId || (appointment && appointment.locationId) || (line && line.locationId));
    var startMin = Number(line && line.startMin);
    var endMin = Number(line && line.endMin);
    var duration = Number(line && line.durationMinutes);
    if (Number.isFinite(startMin) && Number.isFinite(endMin) && endMin > startMin) {
      return {
        startMin: startMin,
        endMin: endMin,
        dateKey: trim(line.dateKey) || appointmentDateKey(appointment, loc),
        durationMinutes: endMin - startMin
      };
    }
    if (Number.isFinite(startMin) && duration > 0) {
      return {
        startMin: startMin,
        endMin: startMin + duration,
        dateKey: trim(line.dateKey) || appointmentDateKey(appointment, loc),
        durationMinutes: duration
      };
    }
    var start = zonedMinutes(line && line.startAt, loc);
    var end = zonedMinutes(line && line.endAt, loc);
    if (start == null) return null;
    if (end == null || end <= start) {
      end = start + (duration > 0 ? duration : 0);
    }
    if (!(end > start)) return null;
    return {
      startMin: start,
      endMin: end,
      dateKey: lineDateKey(line, loc) || appointmentDateKey(appointment, loc),
      durationMinutes: end - start
    };
  }

  function mergeIntervals(list) {
    var rows = (list || []).filter(function (row) {
      return row && Number.isFinite(row.startMin) && Number.isFinite(row.endMin) && row.endMin > row.startMin;
    }).map(function (row) {
      return { startMin: row.startMin, endMin: row.endMin };
    }).sort(function (a, b) {
      return a.startMin - b.startMin || a.endMin - b.endMin;
    });
    if (!rows.length) return [];
    var out = [{ startMin: rows[0].startMin, endMin: rows[0].endMin }];
    rows.slice(1).forEach(function (row) {
      var last = out[out.length - 1];
      if (row.startMin <= last.endMin) {
        last.endMin = Math.max(last.endMin, row.endMin);
      } else {
        out.push({ startMin: row.startMin, endMin: row.endMin });
      }
    });
    return out;
  }

  function clipInterval(interval, win) {
    if (!interval || !win) return null;
    var start = Math.max(interval.startMin, win.startMin);
    var end = Math.min(interval.endMin, win.endMin);
    if (!(end > start)) return null;
    return { startMin: start, endMin: end };
  }

  function minutesOf(list) {
    return (list || []).reduce(function (sum, row) {
      return sum + Math.max(0, (row.endMin || 0) - (row.startMin || 0));
    }, 0);
  }

  function scheduleWindows(entry) {
    if (!entry) return [];
    if (Array.isArray(entry)) return entry;
    if (Array.isArray(entry.windows)) return entry.windows;
    if (Array.isArray(entry.working)) return entry.working;
    return [];
  }

  function normalizeProviders(providers) {
    return (providers || []).map(function (row) {
      var id = trim(row && (row.id || row.providerId || row.staffId));
      var schedule = [];
      if (row && Array.isArray(row.schedule)) {
        row.schedule.forEach(function (entry) {
          schedule.push({
            dateKey: trim(entry && entry.dateKey),
            locationId: trim(entry && entry.locationId),
            windows: mergeIntervals(scheduleWindows(entry))
          });
        });
      } else if (row && row.days && typeof row.days === "object") {
        Object.keys(row.days).forEach(function (key) {
          var entry = row.days[key];
          var dateKey = trim(entry && entry.dateKey) || trim(key).split("|")[0];
          var locationId = trim(entry && entry.locationId) || (key.indexOf("|") !== -1 ? key.split("|")[1] : "");
          schedule.push({
            dateKey: dateKey,
            locationId: locationId,
            windows: mergeIntervals(scheduleWindows(entry))
          });
        });
      }
      return {
        id: id,
        name: trim(row && (row.name || row.displayName || row.providerNameSnapshot)),
        firstName: trim(row && row.firstName),
        schedule: schedule.filter(function (entry) { return !!entry.dateKey; })
      };
    }).filter(function (row) { return !!row.id; });
  }

  function providerLabel(provider) {
    if (provider && provider.firstName) return provider.firstName;
    var name = trim(provider && provider.name);
    if (!name) return "Provider";
    return name.split(/\s+/)[0];
  }

  function emptyAppointments() {
    return {
      total: 0,
      completed: 0,
      scheduled: 0,
      confirmed: 0,
      cancelled: 0,
      noShow: 0,
      checkedIn: 0,
      inService: 0,
      cancellationRate: 0
    };
  }

  function emptySources() {
    var out = {};
    KNOWN_SOURCES.forEach(function (key) { out[key] = 0; });
    out.other = 0;
    return out;
  }

  function emptyReport() {
    return {
      appointments: emptyAppointments(),
      clients: { newAppointments: 0, returningAppointments: 0, newPercent: 0, returningPercent: 0 },
      sources: { counts: emptySources(), total: 0 },
      requested: { requestedLines: 0, nonRequestedLines: 0, totalLines: 0, requestedPercent: 0 },
      utilization: { workingMinutes: 0, bookedMinutes: 0, idleMinutes: 0, percent: 0, providers: [] },
      gaps: {
        count: 0,
        totalMinutes: 0,
        smallCount: 0,
        smallMinutes: 0,
        largerCount: 0,
        largerMinutes: 0,
        mostGapProvider: null,
        peakPeriod: null,
        items: []
      },
      capacity: {
        gapMinutes: 0,
        unusedPercent: 0,
        estimatedDollars: null,
        averageRatePerMinute: null
      },
      insights: []
    };
  }

  function round1(value) {
    return Math.round(Number(value) * 10) / 10;
  }

  function percent(part, whole) {
    if (!whole) return 0;
    return round1((part / whole) * 100);
  }

  function sourceKey(value) {
    var key = trim(value);
    if (!key) return "front_desk";
    if (KNOWN_SOURCES.indexOf(key) !== -1) return key;
    return "other";
  }

  function collectPricedRate(appointments) {
    var minutes = 0;
    var amount = 0;
    (appointments || []).forEach(function (appt) {
      if (!isBookedStatus(appt && appt.status)) return;
      (appt.serviceLines || []).forEach(function (line) {
        var price = Number(line && line.priceSnapshot);
        var duration = Number(line && line.durationMinutes);
        if (!(price > 0)) return;
        if (!(duration > 0)) {
          var win = lineWindow(line, appt, appt.locationId);
          duration = win ? win.durationMinutes : 0;
        }
        if (!(duration > 0)) return;
        minutes += duration;
        amount += price;
      });
    });
    if (!minutes) return null;
    return amount / minutes;
  }

  function hourLabel(hour) {
    var h = ((Number(hour) % 24) + 24) % 24;
    var suffix = h >= 12 ? "PM" : "AM";
    var display = h % 12;
    if (!display) display = 12;
    return display + " " + suffix;
  }

  function peakPeriodFromGaps(items) {
    var hours = [];
    var i;
    for (i = 0; i < 24; i += 1) hours[i] = 0;
    (items || []).forEach(function (gap) {
      var t = gap.startMin;
      while (t < gap.endMin) {
        var h = Math.floor(t / 60);
        if (h >= 0 && h < 24) {
          var sliceEnd = Math.min(gap.endMin, (h + 1) * 60);
          hours[h] += sliceEnd - t;
        }
        t = (Math.floor(t / 60) + 1) * 60;
      }
    });
    var max = 0;
    var peakHour = -1;
    for (i = 0; i < 24; i += 1) {
      if (hours[i] > max) {
        max = hours[i];
        peakHour = i;
      }
    }
    if (peakHour < 0 || max <= 0) return null;
    var startH = peakHour;
    var endH = peakHour;
    var floor = max * 0.25;
    while (startH > 0 && hours[startH - 1] >= floor) startH -= 1;
    while (endH < 23 && hours[endH + 1] >= floor) endH += 1;
    var minutes = 0;
    for (i = startH; i <= endH; i += 1) minutes += hours[i];
    return {
      startHour: startH,
      endHour: endH + 1,
      minutes: minutes,
      label: hourLabel(startH) + " and " + hourLabel(endH + 1)
    };
  }

  function formatHours(minutes) {
    var hours = Number(minutes) / 60;
    if (!Number.isFinite(hours) || hours === 0) return "0";
    if (Math.abs(hours - Math.round(hours)) < 0.05) return String(Math.round(hours));
    return String(round1(hours));
  }

  function formatMoney(value) {
    var n = Math.round(Number(value) * 100) / 100;
    if (!Number.isFinite(n)) n = 0;
    return "$" + n.toFixed(2);
  }

  function periodPhrase(opts) {
    var fromKey = trim(opts && opts.fromKey);
    var toKey = trim(opts && opts.toKey) || fromKey;
    var todayKey = trim(opts && opts.todayKey);
    if (fromKey && fromKey === toKey) {
      if (todayKey && fromKey === todayKey) return "today";
      return "on this day";
    }
    var sales = window.ffBookingReportsCompute;
    if (sales && typeof sales.rangeForPreset === "function" && todayKey) {
      var week = sales.rangeForPreset("this_week", todayKey);
      if (week.fromKey === fromKey && week.toKey === toKey) return "this week";
      var last = sales.rangeForPreset("last_week", todayKey);
      if (last.fromKey === fromKey && last.toKey === toKey) return "last week";
    }
    return "in this period";
  }

  function hourWord(count) {
    return Number(count) === 1 ? "hour" : "hours";
  }

  function buildInsights(report, opts) {
    var out = [];
    var phrase = periodPhrase(opts);
    var appt = report.appointments;
    var gaps = report.gaps;
    var util = report.utilization;
    var cap = report.capacity;

    if (!appt.total) {
      out.push("No appointments were found " + phrase + ".");
      if (util.workingMinutes > 0) {
        out.push(
          "Providers were scheduled for " + formatHours(util.workingMinutes) +
          " provider " + hourWord(util.workingMinutes / 60) + " with no booked appointments."
        );
      }
      return out;
    }

    if (gaps.totalMinutes > 0) {
      var gapHours = gaps.totalMinutes / 60;
      out.push(
        formatHours(gaps.totalMinutes) + " provider " + hourWord(gapHours) +
        (Math.abs(gapHours - 1) < 0.05 ? " was" : " were") +
        " left as calendar gaps " + phrase + "."
      );
    }

    if (gaps.smallMinutes > 0) {
      var smallHours = gaps.smallMinutes / 60;
      out.push(
        formatHours(gaps.smallMinutes) + " provider " + hourWord(smallHours) +
        (Math.abs(smallHours - 1) < 0.05 ? " was" : " were") +
        " left in calendar gaps of 30 minutes or less."
      );
    }

    var compared = (util.providers || []).filter(function (row) {
      return row.workingMinutes > 0 && trim(row.name || row.firstName);
    });
    if (compared.length > 1 && util.workingMinutes > 0) {
      var avg = util.percent;
      var farthest = compared.slice().sort(function (a, b) {
        var da = a.percent - avg;
        var db = b.percent - avg;
        return da - db || b.gapMinutes - a.gapMinutes;
      })[0];
      if (farthest && Math.abs(farthest.percent - avg) >= 1) {
        out.push(
          "Provider " + providerLabel(farthest) + " had " + farthest.percent +
          "% utilization compared with the location average of " + avg + "%."
        );
      }
    }

    if (gaps.peakPeriod && gaps.peakPeriod.label) {
      out.push("Most calendar gap time occurred between " + gaps.peakPeriod.label + ".");
    }

    if (gaps.mostGapProvider && gaps.mostGapProvider.minutes > 0) {
      out.push(
        "Provider " + providerLabel(gaps.mostGapProvider) + " had the most calendar gap time (" +
        formatHours(gaps.mostGapProvider.minutes) + " " + hourWord(gaps.mostGapProvider.minutes / 60) + ")."
      );
    }

    if (cap.unusedPercent > 0 && gaps.totalMinutes > 0) {
      out.push(
        cap.unusedPercent + "% of working capacity was left unused because of calendar gaps."
      );
    }

    if (cap.estimatedDollars != null) {
      out.push(
        "Estimated unused service capacity is " + formatMoney(cap.estimatedDollars) +
        ", based on booked service value and calendar gap time."
      );
    }

    if (appt.cancellationRate > 0) {
      out.push(
        "Cancellation rate was " + appt.cancellationRate + "% (" +
        appt.cancelled + " of " + appt.total + " appointments)."
      );
    }

    if (report.requested.totalLines > 0 && report.requested.requestedLines > 0) {
      out.push(
        report.requested.requestedPercent + "% of service lines were requested for a specific provider."
      );
    }

    if (report.clients.newAppointments > 0) {
      out.push(
        report.clients.newAppointments + " of " + appt.total +
        " appointments were first visits."
      );
    }

    return out.slice(0, 8);
  }

  function emptyProviderUtil(provider) {
    return {
      id: provider.id,
      name: provider.name || provider.id,
      firstName: provider.firstName || "",
      workingMinutes: 0,
      bookedMinutes: 0,
      idleMinutes: 0,
      percent: 0,
      gapCount: 0,
      gapMinutes: 0
    };
  }

  function buildReport(input) {
    var opts = input && typeof input === "object" ? input : {};
    var report = emptyReport();
    var appointments = (opts.appointments || []).filter(function (appt) {
      return appointmentInScope(appt, opts);
    });
    var providers = normalizeProviders(opts.providers);
    var counts = report.appointments;
    var sources = report.sources.counts;

    appointments.forEach(function (appt) {
      counts.total += 1;
      var status = trim(appt.status) || "scheduled";
      if (status === "completed") counts.completed += 1;
      else if (status === "scheduled") counts.scheduled += 1;
      else if (status === "confirmed") counts.confirmed += 1;
      else if (status === "cancelled") counts.cancelled += 1;
      else if (status === "no_show") counts.noShow += 1;
      else if (status === "checked_in") counts.checkedIn += 1;
      else if (status === "in_service") counts.inService += 1;

      sources[sourceKey(appt.source)] += 1;
      report.sources.total += 1;

      if (appt.firstVisit === true) report.clients.newAppointments += 1;
      else report.clients.returningAppointments += 1;

      if (status !== "cancelled") {
        (appt.serviceLines || []).forEach(function (line) {
          report.requested.totalLines += 1;
          if (line && line.requested === true) report.requested.requestedLines += 1;
          else report.requested.nonRequestedLines += 1;
        });
      }
    });
    counts.cancellationRate = percent(counts.cancelled, counts.total);
    report.clients.newPercent = percent(report.clients.newAppointments, counts.total);
    report.clients.returningPercent = percent(report.clients.returningAppointments, counts.total);
    report.requested.requestedPercent = percent(report.requested.requestedLines, report.requested.totalLines);

    var bookedByKey = {};
    appointments.forEach(function (appt) {
      if (!isBookedStatus(appt.status)) return;
      (appt.serviceLines || []).forEach(function (line) {
        var providerId = trim(line && line.providerId);
        if (!providerId) return;
        var win = lineWindow(line, appt, appt.locationId);
        if (!win || !win.dateKey) return;
        var key = providerId + "|" + win.dateKey + "|" + trim(appt.locationId);
        if (!bookedByKey[key]) bookedByKey[key] = [];
        bookedByKey[key].push({ startMin: win.startMin, endMin: win.endMin });
      });
    });

    var gapItems = [];
    var utilRows = providers.map(function (provider) {
      var row = emptyProviderUtil(provider);
      (provider.schedule || []).forEach(function (entry) {
        if (opts.locationIds && opts.locationIds.length && entry.locationId &&
            opts.locationIds.indexOf(entry.locationId) === -1) return;
        if (!inRange(entry.dateKey, opts.fromKey, opts.toKey)) return;
        var windows = mergeIntervals(entry.windows);
        row.workingMinutes += minutesOf(windows);
        var key = provider.id + "|" + entry.dateKey + "|" + trim(entry.locationId);
        var booked = mergeIntervals(bookedByKey[key] || []);
        var clipped = [];
        windows.forEach(function (windowRow) {
          booked.forEach(function (block) {
            var piece = clipInterval(block, windowRow);
            if (piece) clipped.push(piece);
          });
        });
        var occupied = mergeIntervals(clipped);
        row.bookedMinutes += minutesOf(occupied);
        windows.forEach(function (windowRow) {
          var inside = mergeIntervals(occupied.map(function (block) {
            return clipInterval(block, windowRow);
          }).filter(Boolean));
          var g;
          // Gaps are holes between consecutive booked blocks in this window only.
          for (g = 0; g < inside.length - 1; g += 1) {
            var startMin = inside[g].endMin;
            var endMin = inside[g + 1].startMin;
            if (!(endMin > startMin)) continue;
            var minutes = endMin - startMin;
            var gap = {
              providerId: provider.id,
              providerName: provider.name,
              firstName: provider.firstName,
              dateKey: entry.dateKey,
              locationId: entry.locationId,
              startMin: startMin,
              endMin: endMin,
              minutes: minutes,
              small: minutes <= SMALL_GAP_MAX
            };
            gapItems.push(gap);
            row.gapCount += 1;
            row.gapMinutes += minutes;
          }
        });
      });
      row.idleMinutes = Math.max(0, row.workingMinutes - row.bookedMinutes);
      row.percent = percent(row.bookedMinutes, row.workingMinutes);
      return row;
    });

    var workingMinutes = 0;
    var bookedMinutes = 0;
    utilRows.forEach(function (row) {
      workingMinutes += row.workingMinutes;
      bookedMinutes += row.bookedMinutes;
    });

    report.utilization = {
      workingMinutes: workingMinutes,
      bookedMinutes: bookedMinutes,
      idleMinutes: Math.max(0, workingMinutes - bookedMinutes),
      percent: percent(bookedMinutes, workingMinutes),
      providers: utilRows
    };

    var smallCount = 0;
    var smallMinutes = 0;
    var largerCount = 0;
    var largerMinutes = 0;
    var byProvider = {};
    gapItems.forEach(function (gap) {
      if (gap.small) {
        smallCount += 1;
        smallMinutes += gap.minutes;
      } else {
        largerCount += 1;
        largerMinutes += gap.minutes;
      }
      if (!byProvider[gap.providerId]) {
        byProvider[gap.providerId] = {
          id: gap.providerId,
          name: gap.providerName,
          firstName: gap.firstName,
          minutes: 0
        };
      }
      byProvider[gap.providerId].minutes += gap.minutes;
    });
    var mostGap = null;
    Object.keys(byProvider).forEach(function (id) {
      var row = byProvider[id];
      if (!mostGap || row.minutes > mostGap.minutes) mostGap = row;
    });

    report.gaps = {
      count: gapItems.length,
      totalMinutes: smallMinutes + largerMinutes,
      smallCount: smallCount,
      smallMinutes: smallMinutes,
      largerCount: largerCount,
      largerMinutes: largerMinutes,
      mostGapProvider: mostGap,
      peakPeriod: peakPeriodFromGaps(gapItems),
      items: gapItems
    };

    var rate = collectPricedRate(appointments);
    var estimated = null;
    if (rate != null && report.gaps.totalMinutes > 0) {
      estimated = Math.round(rate * report.gaps.totalMinutes * 100) / 100;
    }
    report.capacity = {
      gapMinutes: report.gaps.totalMinutes,
      unusedPercent: percent(report.gaps.totalMinutes, workingMinutes),
      estimatedDollars: estimated,
      averageRatePerMinute: rate
    };

    report.insights = buildInsights(report, opts);
    return report;
  }

  window.ffBookingReportsIntelligenceCompute = {
    BOOKED_STATUSES: BOOKED_STATUSES.slice(),
    KNOWN_SOURCES: KNOWN_SOURCES.slice(),
    SOURCE_LABELS: SOURCE_LABELS,
    SMALL_GAP_MAX: SMALL_GAP_MAX,
    addDays: addDays,
    dateKeysBetween: dateKeysBetween,
    inRange: inRange,
    isBookedStatus: isBookedStatus,
    appointmentInScope: appointmentInScope,
    mergeIntervals: mergeIntervals,
    minutesOf: minutesOf,
    formatHours: formatHours,
    formatMoney: formatMoney,
    hourLabel: hourLabel,
    percent: percent,
    emptyReport: emptyReport,
    buildInsights: buildInsights,
    buildReport: buildReport
  };
})();
