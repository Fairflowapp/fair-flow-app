/**
 * Booking Appointment model V1 — identity, status, and line helpers.
 * Does not read Firestore. The repository consumes this.
 *
 * Path: salons/{salonId}/appointments/{appointmentId}
 * Capability source: existing Operations service.staffOverrides[staffId].enabled
 * (opt-out). No new capability schema.
 */
(function () {
  var NOTES_MAX = 2000;
  var DURATION_MAX = 1440;
  var STATUSES = [
    "scheduled",
    "confirmed",
    "checked_in",
    "in_service",
    "completed",
    "cancelled",
    "no_show"
  ];
  var ACTIVE_STATUSES = [
    "scheduled",
    "confirmed",
    "checked_in",
    "in_service",
    "completed",
    "no_show"
  ];
  var SOURCES = ["front_desk", "phone", "online", "walk_in", "internal"];
  var ASSIGNMENT_TYPES = ["specific_provider", "any_provider"];
  var CODES = {
    PROVIDER_NOT_WORKING: "PROVIDER_NOT_WORKING",
    OUTSIDE_BUSINESS_HOURS: "OUTSIDE_BUSINESS_HOURS",
    APPOINTMENT_CONFLICT: "APPOINTMENT_CONFLICT",
    INVALID_SERVICE: "INVALID_SERVICE",
    INVALID_CLIENT: "INVALID_CLIENT",
    PROVIDER_INCAPABLE: "PROVIDER_INCAPABLE",
    INVALID_STATUS: "INVALID_STATUS",
    INVALID_SOURCE: "INVALID_SOURCE",
    INVALID_ASSIGNMENT: "INVALID_ASSIGNMENT",
    MISSING_LOCATION: "MISSING_LOCATION",
    INVALID_LINE: "INVALID_LINE",
    UNRESOLVED_GAP: "UNRESOLVED_GAP"
  };

  function trimText(value) {
    return String(value == null ? "" : value).trim();
  }

  function collapseSpaces(value) {
    return trimText(value).replace(/\s+/g, " ");
  }

  function uniqueStrings(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (item) {
      var key = String(item || "").trim();
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(key);
    });
    return out;
  }

  function isStatus(value) {
    return STATUSES.indexOf(trimText(value)) !== -1;
  }

  function isActiveStatus(value) {
    return ACTIVE_STATUSES.indexOf(trimText(value)) !== -1;
  }

  function isSource(value) {
    return SOURCES.indexOf(trimText(value)) !== -1;
  }

  function isAssignmentType(value) {
    return ASSIGNMENT_TYPES.indexOf(trimText(value)) !== -1;
  }

  function toDate(value) {
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
      if (Number.isFinite(ms)) return new Date(ms);
    }
    if (typeof value.seconds === "number") {
      return new Date(value.seconds * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1e6));
    }
    if (typeof value === "object" && value.dateKey) {
      var minutes = value.minutes;
      if (minutes == null && value.time) {
        var parsed = parseHm(value.time);
        if (parsed == null) return null;
        minutes = parsed;
      }
      return civilToDate(value.dateKey, minutes, value.locationId);
    }
    var instant = new Date(value);
    return Number.isNaN(instant.getTime()) ? null : instant;
  }

  function parseHm(value) {
    var raw = trimText(value);
    var m24 = /^(\d{1,2}):(\d{2})$/.exec(raw);
    if (m24) return Number(m24[1]) * 60 + Number(m24[2]);
    return null;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function parseDateKey(dateKey) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimText(dateKey));
    if (!m) return null;
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }

  function getTimeZone(locationId) {
    try {
      if (window.ffBookingTime && typeof window.ffBookingTime.getTimeZone === "function") {
        return window.ffBookingTime.getTimeZone(locationId);
      }
    } catch (_) {}
    return "America/New_York";
  }

  function civilToDate(dateKey, minutes, locationId) {
    var parts = parseDateKey(dateKey);
    var min = Number(minutes);
    if (!parts || !Number.isFinite(min)) return null;
    var hour = Math.floor(min / 60);
    var minute = Math.round(min % 60);
    var timeZone = getTimeZone(locationId);
    var utcGuess = Date.UTC(parts.y, parts.m - 1, parts.d, hour, minute, 0);
    var fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
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

  function dateKeyOf(value, locationId) {
    var date = toDate(value);
    if (!date) return "";
    try {
      if (window.ffBookingTime && typeof window.ffBookingTime.zonedDateKey === "function") {
        return window.ffBookingTime.zonedDateKey(date, locationId);
      }
    } catch (_) {}
    return date.toISOString().slice(0, 10);
  }

  function addDateKey(dateKey, delta) {
    var p = parseDateKey(dateKey);
    if (!p) return "";
    var utc = new Date(Date.UTC(p.y, p.m - 1, p.d + Number(delta || 0)));
    return utc.getUTCFullYear() + "-" + pad2(utc.getUTCMonth() + 1) + "-" + pad2(utc.getUTCDate());
  }

  function dateKeysBetween(startKey, endKey) {
    var a = trimText(startKey);
    var b = trimText(endKey) || a;
    if (!a) return [];
    if (b < a) {
      var tmp = a;
      a = b;
      b = tmp;
    }
    var out = [];
    var cur = a;
    var guard = 0;
    while (cur && cur <= b && guard < 8) {
      out.push(cur);
      if (cur === b) break;
      cur = addDateKey(cur, 1);
      guard += 1;
    }
    return uniqueStrings(out);
  }

  function intervalsOverlap(startA, endA, startB, endB) {
    var a0 = toDate(startA);
    var a1 = toDate(endA);
    var b0 = toDate(startB);
    var b1 = toDate(endB);
    if (!a0 || !a1 || !b0 || !b1) return false;
    return a0.getTime() < b1.getTime() && a1.getTime() > b0.getTime();
  }

  function makeLineId() {
    return "line_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function clientSnapshotFrom(client) {
    var row = client && typeof client === "object" ? client : {};
    return {
      displayName: collapseSpaces(row.displayName || [row.firstName, row.lastName].filter(Boolean).join(" ")),
      phone: collapseSpaces(row.phone),
      email: trimText(row.email)
    };
  }

  function providerNameFrom(staff) {
    var row = staff && typeof staff === "object" ? staff : {};
    return collapseSpaces(
      row.name
      || row.displayName
      || [row.firstName, row.lastName].filter(Boolean).join(" ")
    );
  }

  function isProviderCapable(service, providerId) {
    var id = trimText(providerId);
    var overrides = service && service.staffOverrides && typeof service.staffOverrides === "object"
      ? service.staffOverrides
      : {};
    var override = id && overrides[id] && typeof overrides[id] === "object" ? overrides[id] : null;
    if (override && override.enabled === false) return false;
    return true;
  }

  function resolveDurationMinutes(service, providerId, requested) {
    var req = Number(requested);
    if (Number.isFinite(req) && req >= 1 && req <= DURATION_MAX) return Math.round(req);
    var id = trimText(providerId);
    var overrides = service && service.staffOverrides && typeof service.staffOverrides === "object"
      ? service.staffOverrides
      : {};
    var override = id && overrides[id] && typeof overrides[id] === "object" ? overrides[id] : null;
    var overDur = Number(override && override.durationMinutes);
    if (Number.isFinite(overDur) && overDur >= 1 && overDur <= DURATION_MAX) return Math.round(overDur);
    var raw = service && (service.durationMinutes != null ? service.durationMinutes : (
      service.duration != null ? service.duration : (
        service.defaultDuration != null ? service.defaultDuration : service.minutes
      )
    ));
    var n = Number(raw);
    if (Number.isFinite(n) && n >= 1 && n <= DURATION_MAX) return Math.round(n);
    return 30;
  }

  function resolvePriceSnapshot(service, providerId) {
    var id = trimText(providerId);
    var overrides = service && service.staffOverrides && typeof service.staffOverrides === "object"
      ? service.staffOverrides
      : {};
    var override = id && overrides[id] && typeof overrides[id] === "object" ? overrides[id] : null;
    if (override && override.price != null && Number.isFinite(Number(override.price))) {
      return Number(override.price);
    }
    var price = service && service.defaultPrice;
    return Number.isFinite(Number(price)) ? Number(price) : 0;
  }

  function lineStartMs(line) {
    var start = toDate(line && line.startAt);
    return start ? start.getTime() : NaN;
  }

  function lineEndMs(line) {
    var end = toDate(line && line.endAt);
    if (end) return end.getTime();
    var start = lineStartMs(line);
    var duration = Number(line && line.durationMinutes);
    if (Number.isFinite(start) && duration > 0) return start + duration * 60000;
    return NaN;
  }

  function clientIdleGaps(lines) {
    var rows = (lines || []).map(function (line) {
      return { start: lineStartMs(line), end: lineEndMs(line) };
    }).filter(function (row) {
      return Number.isFinite(row.start) && Number.isFinite(row.end) && row.end > row.start;
    }).sort(function (a, b) {
      return a.start - b.start || a.end - b.end;
    });
    var gaps = [];
    for (var i = 0; i < rows.length - 1; i += 1) {
      if (rows[i + 1].start > rows[i].end) {
        gaps.push({
          start: rows[i].end,
          end: rows[i + 1].start,
          ms: rows[i + 1].start - rows[i].end
        });
      }
    }
    return gaps;
  }

  function partySizeFromIntervals(intervals) {
    var events = [];
    (intervals || []).forEach(function (row) {
      var start = Number(row && row.start);
      var end = Number(row && row.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
      events.push({ t: start, d: 1 });
      events.push({ t: end, d: -1 });
    });
    if (!events.length) return 1;
    events.sort(function (a, b) {
      return a.t - b.t || a.d - b.d;
    });
    var current = 0;
    var max = 0;
    events.forEach(function (event) {
      current += event.d;
      if (current > max) max = current;
    });
    return Math.max(1, max);
  }

  function personKey(line) {
    var key = trimText(line && line.guestKey);
    return key && key !== "booker" ? key : "booker";
  }

  function uniquePeopleFromLines(lines) {
    var keys = {};
    (lines || []).forEach(function (line) {
      var key = personKey(line);
      if (key !== "booker") keys[key] = true;
    });
    return 1 + Object.keys(keys).length;
  }

  function partySizeForVisit(lines) {
    return uniquePeopleFromLines(lines);
  }

  function deriveWindow(lines) {
    var start = null;
    var end = null;
    (lines || []).forEach(function (line) {
      var a = toDate(line && line.startAt);
      var b = toDate(line && line.endAt);
      if (a && (!start || a < start)) start = a;
      if (b && (!end || b > end)) end = b;
    });
    return { startAt: start, endAt: end };
  }

  function normalizeNotes(value) {
    var notes = collapseSpaces(value);
    if (notes.length > NOTES_MAX) notes = notes.slice(0, NOTES_MAX);
    return notes;
  }

  function fail(code, error, extra) {
    var out = { ok: false, code: code, error: error || code };
    if (extra && typeof extra === "object") {
      Object.keys(extra).forEach(function (key) {
        out[key] = extra[key];
      });
    }
    return out;
  }

  function normalizeCreateInput(input) {
    var raw = input && typeof input === "object" ? input : {};
    var status = trimText(raw.status) || "scheduled";
    var source = trimText(raw.source) || "front_desk";
    var assignmentType = trimText(raw.assignmentType) || "specific_provider";
    var locationId = trimText(raw.locationId);
    var clientId = trimText(raw.clientId);
    var lines = Array.isArray(raw.serviceLines) ? raw.serviceLines : [];
    if (!locationId) return fail(CODES.MISSING_LOCATION, "A location is required.");
    if (!clientId) return fail(CODES.INVALID_CLIENT, "A client is required.");
    if (!isStatus(status) || status === "cancelled") {
      return fail(CODES.INVALID_STATUS, "Invalid appointment status.");
    }
    if (!isSource(source)) return fail(CODES.INVALID_SOURCE, "Invalid appointment source.");
    if (!isAssignmentType(assignmentType)) {
      return fail(CODES.INVALID_ASSIGNMENT, "Invalid assignment type.");
    }
    if (!lines.length) return fail(CODES.INVALID_LINE, "At least one service line is required.");
    return {
      ok: true,
      fields: {
        clientId: clientId,
        locationId: locationId,
        status: status,
        source: source,
        assignmentType: assignmentType,
        notes: normalizeNotes(raw.notes),
        serviceLines: lines
      }
    };
  }

  function mergeOneLine(prev, row) {
    var current = prev && typeof prev === "object" ? prev : {};
    var next = row && typeof row === "object" ? row : {};
    var serviceId = trimText(next.serviceId) || trimText(current.serviceId);
    var sameService = !!serviceId && trimText(current.serviceId) === serviceId;
    return {
      lineId: trimText(next.lineId) || trimText(current.lineId),
      serviceId: serviceId,
      providerId: trimText(next.providerId) || trimText(current.providerId),
      startAt: next.startAt != null ? next.startAt : current.startAt,
      endAt: next.endAt != null ? next.endAt : current.endAt,
      durationMinutes: Number(next.durationMinutes) > 0 ? Number(next.durationMinutes) : Number(current.durationMinutes) || 0,
      priceSnapshot: sameService ? Number(current.priceSnapshot) || 0 : Number(next.priceSnapshot) || 0,
      serviceNameSnapshot: sameService
        ? collapseSpaces(current.serviceNameSnapshot)
        : collapseSpaces(next.serviceNameSnapshot),
      preservePriceSnapshot: sameService,
      preserveNameSnapshot: sameService,
      guestKey: trimText(next.guestKey) || trimText(current.guestKey),
      guestName: collapseSpaces(next.guestName != null ? next.guestName : current.guestName),
      requested: next.requested != null ? next.requested === true : current.requested === true
    };
  }

  function mergeServiceLinePatch(existingLines, incomingLines) {
    var existing = Array.isArray(existingLines) ? existingLines : [];
    var incoming = incomingLines != null ? incomingLines : existing;
    if (!Array.isArray(incoming)) incoming = existing;
    return incoming.map(function (line) {
      var row = line && typeof line === "object" ? line : {};
      var incomingId = trimText(row.lineId);
      var prev = incomingId
        ? existing.find(function (item) {
          return item && trimText(item.lineId) === incomingId;
        }) || {}
        : {};
      return mergeOneLine(prev, row);
    });
  }

  function fromDoc(id, data) {
    var raw = data && typeof data === "object" ? data : {};
    var snapshot = raw.clientSnapshot && typeof raw.clientSnapshot === "object" ? raw.clientSnapshot : {};
    var lines = Array.isArray(raw.serviceLines) ? raw.serviceLines.map(function (line) {
      var row = line && typeof line === "object" ? line : {};
      return {
        lineId: trimText(row.lineId),
        serviceId: trimText(row.serviceId),
        serviceNameSnapshot: collapseSpaces(row.serviceNameSnapshot),
        providerId: trimText(row.providerId),
        providerNameSnapshot: collapseSpaces(row.providerNameSnapshot),
        startAt: row.startAt || null,
        endAt: row.endAt || null,
        durationMinutes: Number(row.durationMinutes) || 0,
        priceSnapshot: Number(row.priceSnapshot) || 0,
        guestKey: trimText(row.guestKey),
        guestName: collapseSpaces(row.guestName),
        requested: row.requested === true
      };
    }) : [];
    return {
      appointmentId: String(id || raw.appointmentId || ""),
      clientId: trimText(raw.clientId),
      clientSnapshot: {
        displayName: collapseSpaces(snapshot.displayName),
        phone: collapseSpaces(snapshot.phone),
        email: trimText(snapshot.email)
      },
      locationId: trimText(raw.locationId),
      status: trimText(raw.status) || "scheduled",
      source: trimText(raw.source) || "front_desk",
      assignmentType: trimText(raw.assignmentType) || "specific_provider",
      notes: collapseSpaces(raw.notes),
      serviceLines: lines,
      providerIds: Array.isArray(raw.providerIds) ? uniqueStrings(raw.providerIds) : uniqueStrings(lines.map(function (line) {
        return line.providerId;
      })),
      startAt: raw.startAt || null,
      endAt: raw.endAt || null,
      dateKey: trimText(raw.dateKey),
      dateKeys: Array.isArray(raw.dateKeys) ? uniqueStrings(raw.dateKeys) : [],
      createdAt: raw.createdAt || null,
      updatedAt: raw.updatedAt || null,
      createdByUid: trimText(raw.createdByUid),
      createdByStaffId: trimText(raw.createdByStaffId),
      cancelledAt: raw.cancelledAt || null,
      cancelledByUid: trimText(raw.cancelledByUid),
      cancellationReason: collapseSpaces(raw.cancellationReason),
      firstVisit: raw.firstVisit === true,
      saleId: trimText(raw.saleId)
    };
  }

  function isFirstVisit(appointment) {
    return !!(appointment && appointment.firstVisit);
  }

  window.ffBookingAppointmentModel = {
    NOTES_MAX: NOTES_MAX,
    STATUSES: STATUSES.slice(),
    ACTIVE_STATUSES: ACTIVE_STATUSES.slice(),
    SOURCES: SOURCES.slice(),
    ASSIGNMENT_TYPES: ASSIGNMENT_TYPES.slice(),
    CODES: CODES,
    isStatus: isStatus,
    isActiveStatus: isActiveStatus,
    isSource: isSource,
    isAssignmentType: isAssignmentType,
    toDate: toDate,
    civilToDate: civilToDate,
    dateKeyOf: dateKeyOf,
    dateKeysBetween: dateKeysBetween,
    intervalsOverlap: intervalsOverlap,
    makeLineId: makeLineId,
    clientSnapshotFrom: clientSnapshotFrom,
    providerNameFrom: providerNameFrom,
    isProviderCapable: isProviderCapable,
    resolveDurationMinutes: resolveDurationMinutes,
    resolvePriceSnapshot: resolvePriceSnapshot,
    deriveWindow: deriveWindow,
    clientIdleGaps: clientIdleGaps,
    partySizeFromIntervals: partySizeFromIntervals,
    personKey: personKey,
    uniquePeopleFromLines: uniquePeopleFromLines,
    partySizeForVisit: partySizeForVisit,
    normalizeNotes: normalizeNotes,
    normalizeCreateInput: normalizeCreateInput,
    mergeServiceLinePatch: mergeServiceLinePatch,
    fromDoc: fromDoc,
    isFirstVisit: isFirstVisit
  };
})();
