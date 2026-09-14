/**
 * Cancellations report.
 * Appointment-date range only. Status === "cancelled" rows.
 * Cancellation rate denominator = all appointments scheduled in the
 * selected appointment-date range (every known status, including
 * completed, no_show, and cancelled). Not completed-only.
 *
 * Cancelled provider time unions overlapping line windows per provider.
 * Notice uses startAt - cancelledAt. Same-day uses location-local dates.
 * Later appointments are only those already in the loaded range.
 * This is not rebooking, recovery, retention, or lost revenue.
 */
(function () {
  var MAX_RANGE_DAYS = 400;
  var NOTICE_DAY_MINUTES = 24 * 60;
  var MIN_RATE_SCHEDULED = 10;
  var MIN_NOTICE_SAMPLE = 5;
  var MIN_RANK_LINES = 3;
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
  var UNATTRIBUTED_KEY = "unattributed";
  var UNSPECIFIED_SERVICE = "unspecified";
  var EMPTY_MESSAGE = "No cancelled appointments in this period.";
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

  function hours1(minutes) {
    var n = Math.round(((Number(minutes) || 0) / 60) * 10) / 10;
    return Number.isFinite(n) ? n : 0;
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

  function model() {
    return window.ffBookingAppointmentModel || null;
  }

  function toDate(value) {
    var api = model();
    if (api && typeof api.toDate === "function") return api.toDate(value);
    if (!value && value !== 0) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value.toDate === "function") {
      try {
        var fromTs = value.toDate();
        return fromTs instanceof Date && !Number.isNaN(fromTs.getTime()) ? fromTs : null;
      } catch (_) {}
    }
    if (typeof value.toMillis === "function") {
      var ms = Number(value.toMillis());
      return Number.isFinite(ms) ? new Date(ms) : null;
    }
    var parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function dateKeyOfInstant(value, locationId) {
    var date = toDate(value);
    if (!date) return "";
    var appt = model();
    if (appt && typeof appt.dateKeyOf === "function") return trim(appt.dateKeyOf(date, locationId));
    try {
      var tm = window.ffBookingTime;
      if (tm && typeof tm.zonedDateKey === "function") return trim(tm.zonedDateKey(date, locationId));
    } catch (_) {}
    return "";
  }

  function appointmentDateKey(appt) {
    var key = trim(appt && appt.dateKey);
    if (key) return key;
    return dateKeyOfInstant(appt && appt.startAt, appt && appt.locationId);
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

  function inRange(dateKey, fromKey, toKey) {
    var api = shared();
    if (api && typeof api.inRange === "function") return api.inRange(dateKey, fromKey, toKey);
    var key = trim(dateKey);
    if (!key) return false;
    if (fromKey && key < fromKey) return false;
    if (toKey && key > toKey) return false;
    return true;
  }

  function locationAllowed(appt, options) {
    var ids = options && options.locationIds;
    if (Array.isArray(ids) && ids.length) {
      return ids.indexOf(trim(appt && appt.locationId)) !== -1;
    }
    var locationId = trim(options && options.locationId);
    if (locationId && locationId !== "all") return trim(appt && appt.locationId) === locationId;
    return true;
  }

  function appointmentIdOf(appt) {
    return trim(appt && (appt.appointmentId || appt.id));
  }

  function dedupeAppointments(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (appt) {
      var id = appointmentIdOf(appt);
      if (id) {
        if (seen[id]) return;
        seen[id] = true;
      }
      if (appt) out.push(appt);
    });
    return out;
  }

  function isEligibleAppointment(appt, options) {
    if (!appt || !appointmentIdOf(appt)) return false;
    if (!locationAllowed(appt, options)) return false;
    return inRange(appointmentDateKey(appt), options && options.fromKey, options && options.toKey);
  }

  function isCancelled(appt) {
    return !!(appt && appt.status === "cancelled");
  }

  function lineMs(line, field) {
    var date = toDate(line && line[field]);
    return date ? date.getTime() : NaN;
  }

  function lineInterval(line) {
    var start = lineMs(line, "startAt");
    var end = lineMs(line, "endAt");
    var duration = Number(line && line.durationMinutes) || 0;
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return { startMs: start, endMs: end, minutes: (end - start) / 60000, usedWindow: true };
    }
    if (Number.isFinite(start) && duration > 0) {
      return { startMs: start, endMs: start + duration * 60000, minutes: duration, usedWindow: true };
    }
    if (duration > 0) {
      return { startMs: NaN, endMs: NaN, minutes: duration, usedWindow: false };
    }
    return null;
  }

  function mergeMs(list) {
    var rows = (list || []).filter(function (row) {
      return row && Number.isFinite(row.startMs) && Number.isFinite(row.endMs) && row.endMs > row.startMs;
    }).slice().sort(function (a, b) {
      return a.startMs - b.startMs || a.endMs - b.endMs;
    });
    if (!rows.length) return [];
    var out = [{ startMs: rows[0].startMs, endMs: rows[0].endMs }];
    rows.slice(1).forEach(function (row) {
      var last = out[out.length - 1];
      if (row.startMs <= last.endMs) last.endMs = Math.max(last.endMs, row.endMs);
      else out.push({ startMs: row.startMs, endMs: row.endMs });
    });
    return out;
  }

  function providerMinutesFromLines(lines) {
    var byProvider = {};
    (lines || []).forEach(function (line) {
      var interval = lineInterval(line);
      if (!interval) return;
      var providerId = trim(line && line.providerId);
      var key = providerId || UNATTRIBUTED_KEY;
      if (!byProvider[key]) {
        byProvider[key] = {
          providerId: providerId,
          attributed: !!providerId,
          name: providerId ? (collapseName(line && line.providerNameSnapshot) || "Provider") : "",
          windows: [],
          fallbackMinutes: 0,
          lineCount: 0
        };
      }
      byProvider[key].lineCount += 1;
      if (interval.usedWindow) byProvider[key].windows.push(interval);
      else byProvider[key].fallbackMinutes += interval.minutes;
    });
    Object.keys(byProvider).forEach(function (key) {
      var row = byProvider[key];
      var union = mergeMs(row.windows);
      var windowMinutes = union.reduce(function (sum, piece) {
        return sum + (piece.endMs - piece.startMs) / 60000;
      }, 0);
      row.minutes = money2(windowMinutes + row.fallbackMinutes);
    });
    return byProvider;
  }

  function noticeMinutesOf(appt) {
    var start = toDate(appt && appt.startAt);
    var cancelled = toDate(appt && appt.cancelledAt);
    if (!start || !cancelled) return null;
    var n = (start.getTime() - cancelled.getTime()) / 60000;
    return Number.isFinite(n) ? money2(n) : null;
  }

  function isWithin24h(noticeMinutes) {
    if (noticeMinutes == null) return false;
    return Math.abs(Number(noticeMinutes)) < NOTICE_DAY_MINUTES;
  }

  function isSameDay(appt) {
    var loc = appt && appt.locationId;
    var startKey = dateKeyOfInstant(appt && appt.startAt, loc) || appointmentDateKey(appt);
    var cancelKey = dateKeyOfInstant(appt && appt.cancelledAt, loc);
    return !!(startKey && cancelKey && startKey === cancelKey);
  }

  function median(values) {
    var list = (values || []).filter(function (n) { return Number.isFinite(n); }).slice().sort(function (a, b) {
      return a - b;
    });
    if (!list.length) return null;
    var mid = Math.floor(list.length / 2);
    if (list.length % 2) return list[mid];
    return money2((list[mid - 1] + list[mid]) / 2);
  }

  function average(values) {
    var list = (values || []).filter(function (n) { return Number.isFinite(n); });
    if (!list.length) return null;
    var sum = list.reduce(function (acc, n) { return acc + n; }, 0);
    return money2(sum / list.length);
  }

  function compareHoursDesc(a, b) {
    var dt = (b.minutes || 0) - (a.minutes || 0);
    if (dt) return dt;
    return (b.lineCount || 0) - (a.lineCount || 0) || String(a.name || "").localeCompare(String(b.name || ""));
  }

  function laterAppointmentInLoadedRange(cancelled, loaded) {
    var clientId = trim(cancelled && cancelled.clientId);
    if (!clientId) return false;
    var start = toDate(cancelled && cancelled.startAt);
    if (!start) return false;
    return (loaded || []).some(function (appt) {
      if (!appt || isCancelled(appt)) return false;
      if (trim(appt.clientId) !== clientId) return false;
      if (appointmentIdOf(appt) === appointmentIdOf(cancelled)) return false;
      var other = toDate(appt.startAt);
      return !!(other && other.getTime() > start.getTime());
    });
  }

  function emptyDay(dateKey) {
    return {
      dateKey: dateKey || "",
      weekday: weekdayFromDateKey(dateKey),
      scheduled: 0,
      cancelled: 0,
      minutes: 0,
      rate: 0
    };
  }

  function buildInsights(totals, weekdays, services) {
    var out = [];
    if (totals.scheduled >= MIN_RATE_SCHEDULED) {
      out.push(percent(totals.cancelled, totals.scheduled) + "% of appointments scheduled in this period were cancelled.");
    }
    if (totals.cancelled && totals.minutes) {
      out.push(hours1(totals.minutes) + " provider hours were attached to cancelled appointments.");
    }
    if (totals.noticeSample >= MIN_NOTICE_SAMPLE && totals.cancelled) {
      out.push(percent(totals.within24h, totals.cancelled) + "% of cancellations happened within 24 hours of the appointment.");
    }
    var weekdayWithCancel = (weekdays || []).filter(function (row) { return row.cancelled > 0; });
    if (weekdayWithCancel.length >= 2 && totals.minutes && out.length < 4) {
      var topDay = weekdayWithCancel.slice().sort(function (a, b) {
        if (b.minutes !== a.minutes) return b.minutes - a.minutes;
        return WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday);
      })[0];
      if (topDay) {
        out.push(topDay.label + " had the most cancelled provider hours.");
      }
    }
    var rankedServices = (services || []).filter(function (row) { return row.lineCount >= MIN_RANK_LINES; });
    if (rankedServices.length && totals.minutes && out.length < 4) {
      var topSvc = rankedServices[0];
      out.push(topSvc.name + " represented " + topSvc.mix + "% of cancelled booked time.");
    }
    return out.slice(0, 4);
  }

  function summarizeCancellations(appointments, opts) {
    var options = opts && typeof opts === "object" ? opts : {};
    var fromKey = trim(options.fromKey);
    var toKey = trim(options.toKey);
    var keys = dateKeysBetween(fromKey, toKey);
    var loaded = dedupeAppointments(appointments).filter(function (appt) {
      return isEligibleAppointment(appt, options);
    });
    var daysMap = {};
    keys.forEach(function (key) { daysMap[key] = emptyDay(key); });
    var weekdayDateCounts = {};
    WEEKDAYS.forEach(function (key) { weekdayDateCounts[key] = 0; });
    keys.forEach(function (key) {
      var wd = weekdayFromDateKey(key);
      if (wd) weekdayDateCounts[wd] += 1;
    });
    var cancelled = [];
    var notices = [];
    var clientCancelCounts = {};
    var providerAgg = {};
    var serviceAgg = {};
    var totals = {
      scheduled: 0,
      cancelled: 0,
      rate: 0,
      minutes: 0,
      hours: 0,
      averageNoticeMinutes: null,
      medianNoticeMinutes: null,
      noticeSample: 0,
      within24h: 0,
      sameDay: 0,
      withReason: 0,
      repeatClients: 0,
      unattributedLines: 0
    };
    loaded.forEach(function (appt) {
      totals.scheduled += 1;
      var dayKey = appointmentDateKey(appt);
      if (!daysMap[dayKey]) daysMap[dayKey] = emptyDay(dayKey);
      daysMap[dayKey].scheduled += 1;
      if (!isCancelled(appt)) return;
      cancelled.push(appt);
      totals.cancelled += 1;
      daysMap[dayKey].cancelled += 1;
      if (trim(appt.cancellationReason)) totals.withReason += 1;
      var notice = noticeMinutesOf(appt);
      if (notice != null) {
        notices.push(notice);
        if (isWithin24h(notice)) totals.within24h += 1;
      }
      if (isSameDay(appt)) totals.sameDay += 1;
      var clientId = trim(appt.clientId);
      if (clientId) clientCancelCounts[clientId] = (clientCancelCounts[clientId] || 0) + 1;
      var byProvider = providerMinutesFromLines(appt.serviceLines || []);
      var apptMinutes = 0;
      Object.keys(byProvider).forEach(function (key) {
        var piece = byProvider[key];
        apptMinutes += piece.minutes;
        if (!piece.attributed) totals.unattributedLines += piece.lineCount;
        if (!providerAgg[key]) {
          providerAgg[key] = {
            key: key,
            providerId: piece.providerId,
            attributed: piece.attributed,
            name: piece.name || (piece.attributed ? "Provider" : "Not attributed"),
            lineCount: 0,
            appointmentIds: {},
            minutes: 0,
            notices: []
          };
        }
        providerAgg[key].lineCount += piece.lineCount;
        providerAgg[key].appointmentIds[appointmentIdOf(appt)] = true;
        providerAgg[key].minutes = money2(providerAgg[key].minutes + piece.minutes);
        if (notice != null) providerAgg[key].notices.push(notice);
        if (piece.name && piece.attributed) providerAgg[key].name = piece.name;
      });
      daysMap[dayKey].minutes = money2(daysMap[dayKey].minutes + apptMinutes);
      totals.minutes = money2(totals.minutes + apptMinutes);
      (appt.serviceLines || []).forEach(function (line) {
        var interval = lineInterval(line);
        var minutes = interval ? interval.minutes : 0;
        var serviceId = trim(line && line.serviceId);
        var name = collapseName(line && line.serviceNameSnapshot);
        var sKey = serviceId ? "id:" + serviceId : (name ? "name:" + name.toLowerCase() : UNSPECIFIED_SERVICE);
        if (!serviceAgg[sKey]) {
          serviceAgg[sKey] = {
            key: sKey,
            serviceId: serviceId,
            name: name || "Unspecified service",
            lineCount: 0,
            minutes: 0
          };
        }
        serviceAgg[sKey].lineCount += 1;
        serviceAgg[sKey].minutes = money2(serviceAgg[sKey].minutes + minutes);
        if (name) serviceAgg[sKey].name = name;
      });
    });
    totals.rate = percent(totals.cancelled, totals.scheduled);
    totals.hours = hours1(totals.minutes);
    totals.noticeSample = notices.length;
    totals.averageNoticeMinutes = average(notices);
    totals.medianNoticeMinutes = median(notices);
    Object.keys(clientCancelCounts).forEach(function (id) {
      if (clientCancelCounts[id] >= 2) totals.repeatClients += 1;
    });
    var providers = Object.keys(providerAgg).map(function (key) {
      var row = providerAgg[key];
      row.appointments = Object.keys(row.appointmentIds).length;
      row.hours = hours1(row.minutes);
      row.mix = percent(row.minutes, totals.minutes);
      row.averageNoticeMinutes = average(row.notices);
      delete row.appointmentIds;
      delete row.notices;
      return row;
    }).filter(function (row) {
      return row.attributed;
    }).sort(compareHoursDesc);
    var services = Object.keys(serviceAgg).map(function (key) {
      var row = serviceAgg[key];
      row.hours = hours1(row.minutes);
      row.mix = percent(row.minutes, totals.minutes);
      return row;
    }).sort(compareHoursDesc);
    var days = Object.keys(daysMap).sort().map(function (key) {
      var row = daysMap[key];
      row.rate = percent(row.cancelled, row.scheduled);
      row.hours = hours1(row.minutes);
      return row;
    });
    var weekdayMap = {};
    WEEKDAYS.forEach(function (key) {
      if (weekdayDateCounts[key]) {
        weekdayMap[key] = {
          weekday: key,
          label: WEEKDAY_LABELS[key],
          dateCount: weekdayDateCounts[key],
          scheduled: 0,
          cancelled: 0,
          minutes: 0,
          rate: 0,
          hours: 0
        };
      }
    });
    days.forEach(function (day) {
      var row = weekdayMap[day.weekday];
      if (!row) return;
      row.scheduled += day.scheduled;
      row.cancelled += day.cancelled;
      row.minutes = money2(row.minutes + day.minutes);
    });
    var weekdays = WEEKDAYS.map(function (key) { return weekdayMap[key]; }).filter(Boolean).map(function (row) {
      row.rate = percent(row.cancelled, row.scheduled);
      row.hours = hours1(row.minutes);
      return row;
    });
    var rows = cancelled.slice().sort(function (a, b) {
      var da = appointmentDateKey(a);
      var db = appointmentDateKey(b);
      if (da !== db) return da < db ? -1 : 1;
      return appointmentIdOf(a).localeCompare(appointmentIdOf(b));
    }).map(function (appt) {
      var byProvider = providerMinutesFromLines(appt.serviceLines || []);
      var minutes = 0;
      var providerNames = [];
      var serviceNames = [];
      Object.keys(byProvider).forEach(function (key) {
        minutes += byProvider[key].minutes;
        if (byProvider[key].attributed && byProvider[key].name) providerNames.push(byProvider[key].name);
      });
      (appt.serviceLines || []).forEach(function (line) {
        var name = collapseName(line && line.serviceNameSnapshot) || (trim(line && line.serviceId) ? "Service" : "Unspecified service");
        if (serviceNames.indexOf(name) === -1) serviceNames.push(name);
      });
      var notice = noticeMinutesOf(appt);
      return {
        appointmentId: appointmentIdOf(appt),
        dateKey: appointmentDateKey(appt),
        locationId: trim(appt.locationId),
        startAt: appt.startAt || null,
        cancelledAt: appt.cancelledAt || null,
        clientName: collapseName(appt.clientSnapshot && appt.clientSnapshot.displayName) || "Client",
        providers: providerNames,
        services: serviceNames,
        minutes: money2(minutes),
        hours: hours1(minutes),
        noticeMinutes: notice,
        sameDay: isSameDay(appt),
        within24h: isWithin24h(notice),
        reason: collapseName(appt.cancellationReason),
        laterAppointmentInRange: laterAppointmentInLoadedRange(appt, loaded)
      };
    });
    return {
      totals: totals,
      days: days,
      weekdays: weekdays,
      providers: providers,
      services: services,
      rows: rows,
      insights: buildInsights(totals, weekdays, services)
    };
  }

  function ownerView(summary) {
    var totals = summary && summary.totals;
    if (!totals) return { kind: "empty", message: EMPTY_MESSAGE, summary: null };
    if (!totals.scheduled && !totals.cancelled) {
      return { kind: "empty", message: "No appointments in this period.", summary: summary };
    }
    return { kind: "ok", message: totals.cancelled ? "" : EMPTY_MESSAGE, summary: summary };
  }

  window.ffBookingReportsCancellationsCompute = {
    NOTICE_DAY_MINUTES: NOTICE_DAY_MINUTES,
    MIN_RATE_SCHEDULED: MIN_RATE_SCHEDULED,
    MIN_NOTICE_SAMPLE: MIN_NOTICE_SAMPLE,
    MIN_RANK_LINES: MIN_RANK_LINES,
    UNATTRIBUTED_KEY: UNATTRIBUTED_KEY,
    EMPTY_MESSAGE: EMPTY_MESSAGE,
    LOAD_ERROR_MESSAGE: LOAD_ERROR_MESSAGE,
    WEEKDAYS: WEEKDAYS.slice(),
    appointmentDateKey: appointmentDateKey,
    dateKeysBetween: dateKeysBetween,
    weekdayFromDateKey: weekdayFromDateKey,
    noticeMinutesOf: noticeMinutesOf,
    isWithin24h: isWithin24h,
    isSameDay: isSameDay,
    providerMinutesFromLines: providerMinutesFromLines,
    laterAppointmentInLoadedRange: laterAppointmentInLoadedRange,
    summarizeCancellations: summarizeCancellations,
    ownerView: ownerView
  };
})();
