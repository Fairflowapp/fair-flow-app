/**
 * Reports-safe appointment range helpers.
 * Pure pagination, per-location timezone bounds, and completeness metadata.
 * Firestore reads stay in the Appointment repository.
 *
 * Range is appointment start civil date: startAt >= local fromKey midnight
 * and startAt < local midnight after toKey. Future ranges are valid.
 * Status is not filtered here. Safety max is per location per requested range.
 */
(function () {
  var PAGE_SIZE = 150;
  var SAFETY_MAX = 10000;
  var FALLBACK_ZONE = "America/New_York";
  var INCOMPLETE_MESSAGE = "Appointment data for this range is incomplete. Narrow the date range and try again.";
  var LOAD_ERROR_MESSAGE = "This report could not load.";

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function parseKey(dateKey) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trim(dateKey));
    if (!m) return null;
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }

  function pad2(n) {
    return (Number(n) < 10 ? "0" : "") + Number(n);
  }

  function addDays(dateKey, delta) {
    var p = parseKey(dateKey);
    if (!p) return "";
    var utc = new Date(Date.UTC(p.y, p.m - 1, p.d + Number(delta || 0)));
    return utc.getUTCFullYear() + "-" + pad2(utc.getUTCMonth() + 1) + "-" + pad2(utc.getUTCDate());
  }

  function timeZoneFor(locationId) {
    try {
      var tm = window.ffBookingTime;
      if (tm && typeof tm.getTimeZone === "function") {
        var zone = tm.getTimeZone(locationId);
        if (zone) return zone;
      }
    } catch (_) {}
    return FALLBACK_ZONE;
  }

  function zonedInstant(dateKey, minutes, timeZone) {
    var parts = parseKey(dateKey);
    var min = Number(minutes) || 0;
    if (!parts || !Number.isFinite(min)) return null;
    var hour = Math.floor(min / 60);
    var minute = Math.round(min % 60);
    var zone = trim(timeZone) || FALLBACK_ZONE;
    var utcGuess = Date.UTC(parts.y, parts.m - 1, parts.d, hour, minute, 0);
    var fmt;
    try {
      fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      });
    } catch (_) {
      return null;
    }
    function read(ms) {
      var map = {};
      fmt.formatToParts(new Date(ms)).forEach(function (part) {
        if (part.type !== "literal") map[part.type] = part.value;
      });
      return Date.UTC(
        Number(map.year),
        Number(map.month) - 1,
        Number(map.day),
        Number(map.hour),
        Number(map.minute),
        Number(map.second)
      );
    }
    var wanted = Date.UTC(parts.y, parts.m - 1, parts.d, hour, minute, 0);
    return new Date(utcGuess + (wanted - read(utcGuess)));
  }

  function boundsForLocation(fromKey, toKey, locationId) {
    var from = trim(fromKey);
    var to = trim(toKey);
    if (!from || !to) return null;
    if (from > to) {
      var swap = from;
      from = to;
      to = swap;
    }
    var zone = timeZoneFor(locationId);
    var start = zonedInstant(from, 0, zone);
    var endExclusive = zonedInstant(addDays(to, 1), 0, zone);
    if (!start || !endExclusive) return null;
    return {
      start: start,
      endExclusive: endExclusive,
      timeZone: zone,
      fromKey: from,
      toKey: to,
      locationId: trim(locationId)
    };
  }

  function pageSize(options) {
    var n = Number(options && options.pageSize);
    if (Number.isFinite(n) && n > 0) return Math.min(500, Math.floor(n));
    return PAGE_SIZE;
  }

  function safetyMax(options) {
    var n = Number(options && options.safetyMax);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
    return SAFETY_MAX;
  }

  function emptyResult(extra) {
    var row = extra && typeof extra === "object" ? extra : {};
    return {
      appointments: Array.isArray(row.appointments) ? row.appointments : [],
      complete: row.complete === true,
      fetchedCount: Number(row.fetchedCount) || (Array.isArray(row.appointments) ? row.appointments.length : 0),
      truncated: row.truncated === true,
      error: row.error ? String(row.error) : null
    };
  }

  function failResult(error) {
    return emptyResult({
      complete: false,
      truncated: false,
      error: error || LOAD_ERROR_MESSAGE
    });
  }

  function startAtMs(value) {
    if (!value && value !== 0) return 0;
    try {
      if (typeof value.toMillis === "function") return value.toMillis();
    } catch (_) {}
    try {
      if (typeof value.toDate === "function") {
        var date = value.toDate();
        if (date && !Number.isNaN(date.getTime())) return date.getTime();
      }
    } catch (_) {}
    if (typeof value.seconds === "number") {
      return value.seconds * 1000 + Math.floor((Number(value.nanoseconds) || 0) / 1e6);
    }
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? 0 : value.getTime();
    var parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  function appointmentIdOf(appt) {
    return trim(appt && (appt.appointmentId || appt.id));
  }

  function compareAppointmentsAsc(a, b) {
    var dt = startAtMs(a && a.startAt) - startAtMs(b && b.startAt);
    if (dt) return dt;
    return appointmentIdOf(a).localeCompare(appointmentIdOf(b));
  }

  function mergeAppointments(chunks) {
    var seen = {};
    var out = [];
    (chunks || []).forEach(function (list) {
      (list || []).forEach(function (appt) {
        var id = appointmentIdOf(appt);
        if (id) {
          if (seen[id]) return;
          seen[id] = true;
        }
        if (appt) out.push(appt);
      });
    });
    out.sort(compareAppointmentsAsc);
    return out;
  }

  function uniqueLocationIds(locationIds) {
    var seen = {};
    var out = [];
    (Array.isArray(locationIds) ? locationIds : []).forEach(function (id) {
      var loc = trim(id);
      if (!loc || seen[loc]) return;
      seen[loc] = true;
      out.push(loc);
    });
    return out;
  }

  async function paginateRange(fetchPage, options) {
    if (typeof fetchPage !== "function") return failResult("Appointment range lookup is not available.");
    var size = pageSize(options);
    var max = safetyMax(options);
    var appointments = [];
    var seen = {};
    var cursor = null;
    var pageGuard = Math.ceil(max / size) + 2;
    var pages = 0;
    try {
      while (pages < pageGuard) {
        pages += 1;
        var page = await fetchPage(cursor, size);
        if (page && page.error) return failResult(page.error);
        var rows = page && Array.isArray(page.rows) ? page.rows : [];
        if (!rows.length) {
          return emptyResult({
            appointments: appointments,
            complete: true,
            fetchedCount: appointments.length,
            truncated: false
          });
        }
        var i;
        for (i = 0; i < rows.length; i += 1) {
          var row = rows[i] || {};
          var appt = row.appointment;
          var id = appointmentIdOf(appt);
          if (id && seen[id]) {
            cursor = row.cursor != null ? row.cursor : cursor;
            continue;
          }
          if (appointments.length >= max) {
            return emptyResult({
              appointments: appointments,
              complete: false,
              fetchedCount: appointments.length,
              truncated: true
            });
          }
          if (id) seen[id] = true;
          if (appt) appointments.push(appt);
          if (row.cursor != null) cursor = row.cursor;
        }
        if (rows.length < size) {
          return emptyResult({
            appointments: appointments,
            complete: true,
            fetchedCount: appointments.length,
            truncated: false
          });
        }
        if (appointments.length >= max) {
          return emptyResult({
            appointments: appointments,
            complete: false,
            fetchedCount: appointments.length,
            truncated: true
          });
        }
      }
      return emptyResult({
        appointments: appointments,
        complete: false,
        fetchedCount: appointments.length,
        truncated: true
      });
    } catch (err) {
      return failResult(err && err.message ? err.message : LOAD_ERROR_MESSAGE);
    }
  }

  function combineLocationResults(results) {
    var list = Array.isArray(results) ? results : [];
    var error = null;
    var complete = true;
    var truncated = false;
    var chunks = [];
    list.forEach(function (row) {
      var item = row || failResult(LOAD_ERROR_MESSAGE);
      if (item.error) {
        error = item.error;
        complete = false;
      }
      if (!item.complete) {
        complete = false;
        if (item.truncated) truncated = true;
      }
      chunks.push(item.appointments || []);
    });
    if (error) return failResult(error);
    var appointments = mergeAppointments(chunks);
    return emptyResult({
      appointments: appointments,
      complete: complete,
      fetchedCount: appointments.length,
      truncated: truncated || !complete
    });
  }

  function userSafeError(error) {
    var msg = trim(error);
    if (!msg) return LOAD_ERROR_MESSAGE;
    if (msg === "Choose a location." || msg === "Choose a start and end date." || msg === "Appointments are not loaded.") {
      return msg;
    }
    if (/firebase|firestore|failed-precondition|permission|index|quota/i.test(msg)) {
      return LOAD_ERROR_MESSAGE;
    }
    return LOAD_ERROR_MESSAGE;
  }

  function viewState(fetchResult) {
    var row = fetchResult || {};
    if (row.error) {
      return { kind: "error", message: userSafeError(row.error), appointments: [] };
    }
    if (row.complete !== true) {
      return { kind: "incomplete", message: INCOMPLETE_MESSAGE, appointments: [] };
    }
    var appointments = Array.isArray(row.appointments) ? row.appointments : [];
    if (!appointments.length) {
      return { kind: "empty", message: "No appointments in this period.", appointments: [] };
    }
    return { kind: "ok", message: "", appointments: appointments };
  }

  function shouldStoreReportResult(requestId, latestRequestId) {
    return requestId === latestRequestId;
  }

  function shouldPaintReportResult(requestId, latestRequestId, active) {
    return requestId === latestRequestId && active === true;
  }

  async function fetchForReport(repo, options) {
    var opts = options && typeof options === "object" ? options : {};
    var ids = uniqueLocationIds(opts.locationIds);
    var fromKey = trim(opts.fromKey);
    var toKey = trim(opts.toKey);
    if (!ids.length) return failResult("Choose a location.");
    if (!fromKey || !toKey) return failResult("Choose a start and end date.");
    if (!repo) return failResult("Appointments are not loaded.");
    try {
      if (typeof repo.listAppointmentsForLocationsRange === "function") {
        return await repo.listAppointmentsForLocationsRange(ids, fromKey, toKey, opts);
      }
      if (typeof repo.listAppointmentsForLocationRange === "function") {
        var parts = await Promise.all(ids.map(function (id) {
          return repo.listAppointmentsForLocationRange(id, fromKey, toKey, opts);
        }));
        return combineLocationResults(parts);
      }
      return failResult("Appointment range lookup is not available.");
    } catch (err) {
      return failResult(err && err.message ? err.message : LOAD_ERROR_MESSAGE);
    }
  }

  window.ffBookingReportsAppointmentRange = {
    PAGE_SIZE: PAGE_SIZE,
    SAFETY_MAX: SAFETY_MAX,
    INCOMPLETE_MESSAGE: INCOMPLETE_MESSAGE,
    LOAD_ERROR_MESSAGE: LOAD_ERROR_MESSAGE,
    addDays: addDays,
    timeZoneFor: timeZoneFor,
    zonedInstant: zonedInstant,
    boundsForLocation: boundsForLocation,
    pageSize: pageSize,
    safetyMax: safetyMax,
    emptyResult: emptyResult,
    failResult: failResult,
    startAtMs: startAtMs,
    appointmentIdOf: appointmentIdOf,
    compareAppointmentsAsc: compareAppointmentsAsc,
    mergeAppointments: mergeAppointments,
    uniqueLocationIds: uniqueLocationIds,
    paginateRange: paginateRange,
    combineLocationResults: combineLocationResults,
    userSafeError: userSafeError,
    viewState: viewState,
    shouldStoreReportResult: shouldStoreReportResult,
    shouldPaintReportResult: shouldPaintReportResult,
    fetchForReport: fetchForReport
  };
})();
