/**
 * New / Edit Appointment form state.
 * N independent service lines. Repository remains the authority for create/conflicts.
 */
(function () {
  var CODES = {
    APPOINTMENT_CONFLICT: "This provider already has an appointment during this time.",
    PROVIDER_NOT_WORKING: "This provider is not scheduled to work at this time.",
    OUTSIDE_BUSINESS_HOURS: "This appointment falls outside business hours.",
    PROVIDER_INCAPABLE: "This provider is not available for this service.",
    INVALID_CLIENT: "Please select a valid client.",
    INVALID_SERVICE: "Please select a valid service.",
    MISSING_LOCATION: "A location is required.",
    INVALID_LINE: "Please complete every service.",
    UNRESOLVED_GAP: "Choose whether to keep the gap or make the times consecutive.",
    PROVIDER_DOUBLE_BOOKED: "This provider cannot serve two guests at the same time."
  };

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function money(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return "$0";
    return "$" + n.toFixed(n % 1 ? 2 : 0);
  }

  function makeLineKey() {
    return "k_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }

  function staffList() {
    try {
      if (typeof window.ffGetStaffStore === "function") {
        var store = window.ffGetStaffStore();
        if (store && Array.isArray(store.staff)) return store.staff;
      }
    } catch (_) {}
    return [];
  }

  function providerName(providerId) {
    var id = trim(providerId);
    var staff = staffList().find(function (row) {
      return row && (String(row.id || "") === id || String(row.staffId || "") === id);
    });
    if (!staff) return "This provider";
    var name = trim(staff.name || staff.displayName || staff.firstName);
    return name ? name.split(/\s+/)[0] : "This provider";
  }

  function friendlyError(code, providerId) {
    var first = providerName(providerId);
    if (code === "APPOINTMENT_CONFLICT") return first + " already has an appointment during this time.";
    if (code === "PROVIDER_NOT_WORKING") return first + " is not scheduled to work at this time.";
    if (code === "PROVIDER_INCAPABLE") return first + " is not available for this service.";
    if (code === "UNRESOLVED_GAP") return CODES.UNRESOLVED_GAP;
    if (code === "PROVIDER_DOUBLE_BOOKED") return first + " cannot serve two guests at the same time.";
    return CODES[code] || "This appointment could not be created.";
  }

  function formatMinutes(total) {
    var m = ((Number(total) % 1440) + 1440) % 1440;
    var hour = Math.floor(m / 60);
    var min = m % 60;
    var suffix = hour >= 12 ? "PM" : "AM";
    var hour12 = hour % 12;
    if (hour12 === 0) hour12 = 12;
    return hour12 + ":" + String(min).padStart(2, "0") + " " + suffix;
  }

  // Same rules as tickets-service-duration.formatServiceDurationLabel.
  function formatDurationLabel(totalMinutes) {
    var n = Number(totalMinutes);
    if (!Number.isInteger(n) || n < 1) return "";
    var hours = Math.floor(n / 60);
    var minutes = n % 60;
    if (hours > 0 && minutes > 0) return hours + " hr " + minutes + " min";
    if (hours > 0) return hours + " hr";
    return minutes + " min";
  }

  function emptyLine(seed) {
    var storedPrice = seed && seed.storedPrice != null ? seed.storedPrice : seed && seed.price;
    return {
      key: trim(seed && seed.key) || makeLineKey(),
      lineId: trim(seed && seed.lineId),
      providerId: trim(seed && seed.providerId),
      serviceId: trim(seed && seed.serviceId),
      service: seed && seed.service || null,
      services: Array.isArray(seed && seed.services) ? seed.services : [],
      startMin: Number.isFinite(Number(seed && seed.startMin)) ? Number(seed.startMin) : NaN,
      durationMinutes: 0,
      endMin: 0,
      price: 0,
      capabilityMessage: trim(seed && seed.capabilityMessage),
      originalServiceId: trim(seed && (seed.originalServiceId || seed.serviceId)),
      originalServiceName: trim(seed && (seed.originalServiceName || seed.serviceName)),
      storedDurationMinutes: Number(seed && (seed.storedDurationMinutes != null ? seed.storedDurationMinutes : seed.durationMinutes)) || 0,
      storedPrice: Number.isFinite(Number(storedPrice)) ? Number(storedPrice) : null,
      keepStoredSnapshots: !!(seed && seed.keepStoredSnapshots),
      guestKey: trim(seed && seed.guestKey),
      guestName: seed && seed.guestName != null ? String(seed.guestName) : "",
      requested: !!(seed && seed.requested)
    };
  }

  function syncHead(state) {
    var line = state && state.lines && state.lines[0];
    if (!state || !line) return state;
    state.providerId = line.providerId;
    state.serviceId = line.serviceId;
    state.service = line.service;
    state.services = line.services;
    state.startMin = line.startMin;
    state.durationMinutes = line.durationMinutes;
    state.endMin = line.endMin;
    state.price = line.price;
    state.capabilityMessage = line.capabilityMessage;
    state.lineId = line.lineId;
    return state;
  }

  function ensureLines(state) {
    if (!state) return state;
    if (!Array.isArray(state.lines) || !state.lines.length) {
      state.lines = [emptyLine(state)];
    }
    return state;
  }

  function findLine(state, key) {
    var id = trim(key);
    return ((state && state.lines) || []).find(function (line) {
      return line && (line.key === id || line.lineId === id);
    }) || null;
  }

  function deriveLine(line) {
    if (!line) return line;
    var duration = 0;
    var price = 0;
    if (line.service) {
      var svc = window.ffBookingAppointmentServices;
      duration = svc ? svc.effectiveDuration(line.service.raw || line.service, line.providerId) : Number(line.service.durationMinutes) || 0;
      price = svc ? svc.effectivePrice(line.service.raw || line.service) : Number(line.service.price) || 0;
    }
    if (line.keepStoredSnapshots && trim(line.serviceId) && trim(line.serviceId) === trim(line.originalServiceId)) {
      if (Number(line.storedDurationMinutes) > 0) duration = Number(line.storedDurationMinutes);
      if (line.storedPrice != null && Number.isFinite(Number(line.storedPrice))) price = Number(line.storedPrice);
    }
    line.durationMinutes = duration;
    line.price = price;
    line.endMin = Number.isFinite(line.startMin) && duration > 0 ? line.startMin + duration : 0;
    return line;
  }

  function derive(state) {
    if (!state) return state;
    if (Array.isArray(state.lines) && state.lines.length) {
      state.lines.forEach(deriveLine);
      return syncHead(state);
    }
    var duration = 0;
    var price = 0;
    if (state.service) {
      var svc = window.ffBookingAppointmentServices;
      duration = svc ? svc.effectiveDuration(state.service.raw || state.service, state.providerId) : Number(state.service.durationMinutes) || 0;
      price = svc ? svc.effectivePrice(state.service.raw || state.service) : Number(state.service.price) || 0;
    }
    if (state.keepStoredSnapshots && trim(state.serviceId) && trim(state.serviceId) === trim(state.originalServiceId)) {
      if (Number(state.storedDurationMinutes) > 0) duration = Number(state.storedDurationMinutes);
      if (state.storedPrice != null && Number.isFinite(Number(state.storedPrice))) price = Number(state.storedPrice);
    }
    state.durationMinutes = duration;
    state.price = price;
    state.endMin = Number.isFinite(state.startMin) && duration > 0 ? state.startMin + duration : 0;
    return state;
  }

  function emptyState(seed) {
    var state = {
      locationId: trim(seed && seed.locationId),
      dateKey: trim(seed && seed.dateKey),
      clientId: "",
      client: null,
      notes: "",
      lines: [emptyLine(seed)],
      error: "",
      errorLineKey: "",
      catalogServices: [],
      creating: false,
      keptGaps: {}
    };
    return derive(state);
  }

  function lineComplete(line) {
    return !!(
      line
      && trim(line.providerId)
      && trim(line.serviceId)
      && Number.isFinite(Number(line.startMin))
      && Number(line.durationMinutes) > 0
    );
  }

  function isDirty(state) {
    if (!state) return false;
    if (state.clientId || state.client || trim(state.notes)) return true;
    return ((state.lines || []).some(function (line) {
      return !!(line && (line.serviceId || line.service));
    }));
  }

  function canCreate(state) {
    return !!(
      state
      && state.locationId
      && state.dateKey
      && state.clientId
      && state.lines
      && state.lines.length
      && state.lines.every(lineComplete)
      && !unresolvedGaps(state).length
      && !findProviderOverlaps(state).length
    );
  }

  async function refreshLineServices(state, line) {
    var api = window.ffBookingAppointmentServices;
    line.services = api && line.providerId ? await api.listForProvider(line.providerId) : [];
    if (line.serviceId) {
      var next = line.services.find(function (row) { return row.id === line.serviceId; }) || null;
      if (!next) {
        line.serviceId = "";
        line.service = null;
        line.capabilityMessage = "This service is not available with this provider.";
      } else {
        line.service = next;
        line.capabilityMessage = "";
      }
    }
    deriveLine(line);
    return syncHead(state);
  }

  async function refreshCatalog(state) {
    var api = window.ffBookingAppointmentServices;
    if (!state) return state;
    try {
      state.catalogServices = api && typeof api.listAll === "function" ? await api.listAll() : [];
    } catch (_) {
      state.catalogServices = [];
    }
    return state;
  }

  function findServiceRow(state, line, serviceId) {
    var id = trim(serviceId);
    if (!id) return null;
    return (line && line.services || []).find(function (row) { return row.id === id; })
      || (state && state.catalogServices || []).find(function (row) { return row.id === id; })
      || null;
  }

  async function refreshServices(state) {
    ensureLines(state);
    await refreshCatalog(state);
    for (var i = 0; i < state.lines.length; i += 1) {
      await refreshLineServices(state, state.lines[i]);
    }
    return derive(state);
  }

  function setLineService(state, key, serviceId) {
    ensureLines(state);
    var line = findLine(state, key) || state.lines[0];
    if (!line) return derive(state);
    var id = trim(serviceId);
    line.serviceId = id;
    line.service = findServiceRow(state, line, id);
    line.capabilityMessage = "";
    if (line.service && line.providerId) {
      var svcApi = window.ffBookingAppointmentServices;
      if (svcApi && typeof svcApi.isCapable === "function" && !svcApi.isCapable(line.service.raw || line.service, line.providerId)) {
        line.capabilityMessage = "This provider is not available for this service.";
      }
    }
    state.error = "";
    state.errorLineKey = "";
    return derive(state);
  }

  function applyLineProvider(state, key, providerId) {
    ensureLines(state);
    var line = findLine(state, key) || state.lines[0];
    if (!line) return derive(state);
    line.providerId = trim(providerId);
    state.error = "";
    state.errorLineKey = "";
    if (line.service) {
      var svcApi = window.ffBookingAppointmentServices;
      if (svcApi && typeof svcApi.isCapable === "function" && !svcApi.isCapable(line.service.raw || line.service, line.providerId)) {
        line.capabilityMessage = "This provider is not available for this service.";
      } else {
        line.capabilityMessage = "";
      }
    }
    return derive(state);
  }

  async function setLineProvider(state, key, providerId) {
    applyLineProvider(state, key, providerId);
    var line = findLine(state, key) || state.lines[0];
    if (line) await refreshLineServices(state, line);
    return derive(state);
  }

  function setLineRequested(state, key, on) {
    ensureLines(state);
    var line = findLine(state, key);
    if (!line) return derive(state);
    line.requested = arguments.length > 2 ? !!on : !line.requested;
    return derive(state);
  }

  function setLineStart(state, key, startMin) {
    ensureLines(state);
    var line = findLine(state, key) || state.lines[0];
    if (!line) return derive(state);
    line.startMin = Number(startMin);
    state.error = "";
    state.errorLineKey = "";
    return derive(state);
  }

  function lineServiceName(line) {
    return trim(line && line.service && line.service.name)
      || trim(line && line.originalServiceName)
      || "Service";
  }

  function lineEndMin(line) {
    var start = Number(line && line.startMin);
    var end = Number(line && line.endMin);
    if (Number.isFinite(end) && Number.isFinite(start) && end > start) return end;
    var duration = Number(line && line.durationMinutes);
    if (Number.isFinite(start) && duration > 0) return start + duration;
    return 0;
  }

  function findGaps(state) {
    var rows = ((state && state.lines) || []).filter(function (line) {
      return line
        && (trim(line.serviceId) || (line.service && line.service.name))
        && Number.isFinite(Number(line.startMin))
        && lineEndMin(line) > Number(line.startMin);
    }).slice().sort(function (a, b) {
      return Number(a.startMin) - Number(b.startMin) || lineEndMin(a) - lineEndMin(b);
    });
    var gaps = [];
    for (var i = 0; i < rows.length - 1; i += 1) {
      var prev = rows[i];
      var next = rows[i + 1];
      var prevEnd = lineEndMin(prev);
      var gapMin = Number(next.startMin) - prevEnd;
      if (!(gapMin > 0)) continue;
      var prevKey = trim(prev.key || prev.lineId);
      var nextKey = trim(next.key || next.lineId);
      gaps.push({
        prevKey: prevKey,
        nextKey: nextKey,
        gapMin: gapMin,
        prevEnd: prevEnd,
        nextStart: Number(next.startMin),
        prevName: lineServiceName(prev),
        nextName: lineServiceName(next),
        signature: [prevKey, nextKey, gapMin, prevEnd, next.startMin].join("|")
      });
    }
    return gaps;
  }

  function allowedOverlapMinutes() {
    var settings = window.ffBookingSettingsModel;
    if (settings && typeof settings.allowedMinutes === "function") return settings.allowedMinutes();
    return 0;
  }

  function overlapMinutesOf(aStart, aEnd, bStart, bEnd) {
    var settings = window.ffBookingSettingsModel;
    if (settings && typeof settings.overlapMinutes === "function") {
      return settings.overlapMinutes(aStart, aEnd, bStart, bEnd);
    }
    var start = Math.max(Number(aStart), Number(bStart));
    var end = Math.min(Number(aEnd), Number(bEnd));
    var n = end - start;
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function toJsDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value.toDate === "function") {
      try {
        var fromTs = value.toDate();
        return fromTs instanceof Date && !Number.isNaN(fromTs.getTime()) ? fromTs : null;
      } catch (_) {
        return null;
      }
    }
    if (typeof value.seconds === "number") {
      var fromSec = new Date(value.seconds * 1000);
      return Number.isNaN(fromSec.getTime()) ? null : fromSec;
    }
    var parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function dateToMinutes(value, locationId) {
    var date = toJsDate(value);
    if (!date) return NaN;
    var tm = window.ffBookingTime;
    if (tm && typeof tm.zonedMinutes === "function") {
      try { return tm.zonedMinutes(date, locationId); } catch (_) {}
    }
    return date.getHours() * 60 + date.getMinutes();
  }

  function isActiveAppointment(appt) {
    var api = window.ffBookingAppointmentModel;
    if (api && typeof api.isActiveStatus === "function") return api.isActiveStatus(appt && appt.status);
    var status = String(appt && appt.status || "").toLowerCase();
    return status !== "cancelled" && status !== "no_show";
  }

  function cachedLineRange(line, locationId) {
    var start = dateToMinutes(line && line.startAt, locationId);
    var end = dateToMinutes(line && line.endAt, locationId);
    if (!Number.isFinite(start) && Number.isFinite(Number(line && line.startMin))) start = Number(line.startMin);
    if (!Number.isFinite(end) && Number.isFinite(start) && Number(line && line.durationMinutes) > 0) {
      end = start + Number(line.durationMinutes);
    }
    return { start: start, end: end };
  }

  function findProviderOverlaps(state) {
    var allowed = allowedOverlapMinutes();
    var rows = ((state && state.lines) || []).filter(function (line) {
      return line
        && trim(line.providerId)
        && Number.isFinite(Number(line.startMin))
        && lineEndMin(line) > Number(line.startMin);
    });
    var hits = [];
    for (var i = 0; i < rows.length; i += 1) {
      for (var j = i + 1; j < rows.length; j += 1) {
        if (trim(rows[i].providerId) !== trim(rows[j].providerId)) continue;
        var aStart = Number(rows[i].startMin);
        var aEnd = lineEndMin(rows[i]);
        var bStart = Number(rows[j].startMin);
        var bEnd = lineEndMin(rows[j]);
        var formOverlap = overlapMinutesOf(aStart, aEnd, bStart, bEnd);
        if (!(formOverlap > allowed)) continue;
        hits.push({
          aKey: trim(rows[i].key || rows[i].lineId),
          bKey: trim(rows[j].key || rows[j].lineId),
          providerId: trim(rows[i].providerId),
          source: "form",
          overlapMin: formOverlap
        });
      }
    }
    var store = window.ffBookingCalAppointments;
    var cached = store && typeof store.getCached === "function" ? store.getCached() : [];
    var excludeId = trim(state && state.appointmentId);
    var locationId = trim(state && state.locationId);
    if (Array.isArray(cached) && cached.length) {
      rows.forEach(function (line) {
        var aStart = Number(line.startMin);
        var aEnd = lineEndMin(line);
        cached.forEach(function (appt) {
          if (!appt || (excludeId && trim(appt.appointmentId) === excludeId)) return;
          if (!isActiveAppointment(appt)) return;
          if (locationId && trim(appt.locationId) && trim(appt.locationId) !== locationId) return;
          (appt.serviceLines || []).forEach(function (other) {
            if (!other || trim(other.providerId) !== trim(line.providerId)) return;
            var range = cachedLineRange(other, locationId || trim(appt.locationId));
            var calOverlap = overlapMinutesOf(aStart, aEnd, range.start, range.end);
            if (!(calOverlap > allowed)) return;
            hits.push({
              aKey: trim(line.key || line.lineId),
              bKey: trim(other.lineId || appt.appointmentId),
              providerId: trim(line.providerId),
              source: "calendar",
              overlapMin: calOverlap
            });
          });
        });
      });
    }
    return hits;
  }

  function providerOverlapKeys(state) {
    var keys = {};
    findProviderOverlaps(state).forEach(function (hit) {
      if (hit.aKey) keys[hit.aKey] = true;
      if (hit.bKey) keys[hit.bKey] = true;
    });
    return keys;
  }

  function providerOverlapMessage(state) {
    var hits = findProviderOverlaps(state);
    if (!hits.length) return "";
    var first = hits[0];
    var name = providerName(first.providerId);
    if (hits.some(function (hit) { return hit.source === "calendar"; })) {
      return name + " already has an appointment during this time.";
    }
    return name + " cannot serve two guests at the same time.";
  }

  function closeGap(state, nextKey) {
    var id = trim(nextKey);
    var gap = findGaps(state).find(function (row) { return row.nextKey === id; });
    if (!gap) return derive(state);
    return setLineStart(state, gap.nextKey, gap.prevEnd);
  }

  function keepGap(state, signature) {
    if (!state) return state;
    if (!state.keptGaps) state.keptGaps = {};
    var sig = trim(signature);
    if (sig) state.keptGaps[sig] = true;
    state.error = "";
    return state;
  }

  function keptGapMap(state, options) {
    var map = {};
    var fromState = state && state.keptGaps;
    if (fromState && typeof fromState === "object") {
      Object.keys(fromState).forEach(function (key) {
        if (fromState[key]) map[key] = true;
      });
    }
    var fromOpt = options && options.dismissedGaps;
    if (fromOpt && typeof fromOpt === "object") {
      Object.keys(fromOpt).forEach(function (key) {
        if (fromOpt[key]) map[key] = true;
      });
    }
    return map;
  }

  function unresolvedGaps(state) {
    var kept = state && state.keptGaps || {};
    return findGaps(state).filter(function (gap) { return !kept[gap.signature]; });
  }

  function gapNoticeHtml(gap, options) {
    var dismissed = options && options.dismissedGaps || {};
    if (!gap || dismissed[gap.signature]) return "";
    var dur = formatDurationLabel(gap.gapMin) || (gap.gapMin + " min");
    var readOnly = !!(options && options.gapReadOnly);
    var actions = readOnly ? "" : (
      '<div class="ff-appt-gap-acts">' +
        '<button type="button" class="ff-appt-gap-keep" data-ff-line-act="keep-gap" data-ff-gap-sig="' +
          escapeHtml(gap.signature) + '">Keep gap</button>' +
        '<button type="button" class="ff-appt-gap-close" data-ff-line-act="close-gap" data-ff-line="' +
          escapeHtml(gap.nextKey) + '">Make consecutive</button>' +
      "</div>"
    );
    return (
      '<div class="ff-appt-gap' + (readOnly ? " is-note" : "") + '" data-ff-gap="' + escapeHtml(gap.signature) + '">' +
        '<p class="ff-appt-gap-title">There\'s a ' + escapeHtml(dur) + " gap between these services.</p>" +
        '<p class="ff-appt-gap-sub">' + escapeHtml(gap.prevName) + " ends at " +
          escapeHtml(formatMinutes(gap.prevEnd)) + " · " + escapeHtml(gap.nextName) + " starts at " +
          escapeHtml(formatMinutes(gap.nextStart)) +
          (readOnly ? "." : ". Keep the wait, or make the times consecutive?") + "</p>" +
        actions +
      "</div>"
    );
  }

  function overlapPartySize(state) {
    var model = window.ffBookingAppointmentModel;
    var rows = ((state && state.lines) || []).filter(function (line) {
      return line
        && (trim(line.serviceId) || (line.service && line.service.name))
        && Number.isFinite(Number(line.startMin))
        && lineEndMin(line) > Number(line.startMin);
    }).map(function (line) {
      return { start: Number(line.startMin), end: lineEndMin(line) };
    });
    if (model && typeof model.partySizeFromIntervals === "function") {
      return model.partySizeFromIntervals(rows);
    }
    return rows.length ? rows.length : 1;
  }

  function partySize(state) {
    return uniquePeople(state);
  }

  function partyNoticeHtml(state) {
    var size = partySize(state);
    if (!(size > 1)) return "";
    var people = uniquePeople(state);
    var named = [];
    var seen = {};
    ((state && state.lines) || []).forEach(function (line) {
      if (!isGuestLine(line) || !trim(line.guestName) || seen[line.guestKey]) return;
      seen[line.guestKey] = true;
      named.push(trim(line.guestName));
    });
    var sub = people > 1
      ? (named.length
        ? bookerName(state) + " is booking with " + named.join(" + ") + "."
        : bookerName(state) + " is booking. Guest name is optional.")
      : "These services overlap, so more than one guest is being served at the same time.";
    return (
      '<div class="ff-appt-party" data-ff-party="' + size + '">' +
        '<p class="ff-appt-party-title">This booking is for ' + size + " people</p>" +
        '<p class="ff-appt-party-sub">' + escapeHtml(sub) + "</p>" +
      "</div>"
    );
  }

  function gapAfterHtml(state, prevKey, options) {
    var id = trim(prevKey);
    var gap = findGaps(state).find(function (row) { return row.prevKey === id; });
    return gap ? gapNoticeHtml(gap, Object.assign({}, options, { dismissedGaps: keptGapMap(state, options) })) : "";
  }

  function setService(state, serviceId) {
    ensureLines(state);
    return setLineService(state, state.lines[0] && state.lines[0].key, serviceId);
  }

  async function setProvider(state, providerId) {
    ensureLines(state);
    return setLineProvider(state, state.lines[0] && state.lines[0].key, providerId);
  }

  function setStart(state, startMin) {
    ensureLines(state);
    return setLineStart(state, state.lines[0] && state.lines[0].key, startMin);
  }

  function setDate(state, dateKey) {
    state.dateKey = trim(dateKey);
    state.error = "";
    state.errorLineKey = "";
    return state;
  }

  function setClient(state, client) {
    state.client = client || null;
    state.clientId = client && client.clientId ? String(client.clientId) : "";
    state.error = "";
    return state;
  }

  function addLine(state) {
    ensureLines(state);
    var prev = state.lines[state.lines.length - 1];
    var startMin = prev && Number(prev.endMin) > 0
      ? Number(prev.endMin)
      : (prev && Number.isFinite(Number(prev.startMin)) ? Number(prev.startMin) : NaN);
    state.lines.push(emptyLine({
      startMin: startMin,
      providerId: prev && prev.providerId,
      guestKey: prev && prev.guestKey,
      guestName: prev && prev.guestName
    }));
    state.error = "";
    state.errorLineKey = "";
    return derive(state);
  }

  function addGuest(state) {
    ensureLines(state);
    var first = state.lines[0];
    var startMin = first && Number.isFinite(Number(first.startMin)) ? Number(first.startMin) : NaN;
    state.lines.push(emptyLine({
      startMin: startMin,
      guestKey: "g_" + makeLineKey(),
      guestName: ""
    }));
    state.error = "";
    state.errorLineKey = "";
    return derive(state);
  }

  function setLineGuestName(state, key, name) {
    ensureLines(state);
    var line = findLine(state, key);
    if (!line) return state;
    line.guestName = name == null ? "" : String(name);
    if (trim(line.guestKey)) {
      state.lines.forEach(function (other) {
        if (other && other.guestKey === line.guestKey) other.guestName = line.guestName;
      });
    }
    return state;
  }

  function bookerName(state) {
    return trim(state && state.client && state.client.displayName) || "Client";
  }

  function isGuestLine(line) {
    var key = trim(line && line.guestKey);
    return !!(key && key !== "booker");
  }

  function uniquePeople(state) {
    var keys = {};
    ((state && state.lines) || []).forEach(function (line) {
      if (isGuestLine(line)) keys[line.guestKey] = true;
    });
    return 1 + Object.keys(keys).length;
  }

  function servedName(state, line) {
    if (isGuestLine(line) && trim(line.guestName)) return trim(line.guestName);
    return bookerName(state);
  }

  function guestRowHtml(state, line) {
    if (uniquePeople(state) < 2 && !isGuestLine(line)) return "";
    if (!isGuestLine(line)) {
      return '<div class="ff-appt-guest">For <strong>' + escapeHtml(bookerName(state)) + "</strong></div>";
    }
    return (
      '<label class="ff-appt-guest is-edit">' +
        "<span>Guest</span>" +
        '<input type="text" data-ff-guest-name data-ff-line="' + escapeHtml(line.key) +
          '" maxlength="80" placeholder="Name (optional)" value="' + escapeHtml(line.guestName || "") + '">' +
      "</label>"
    );
  }

  function removeLine(state, key) {
    ensureLines(state);
    if (state.lines.length <= 1) return state;
    var id = trim(key);
    var next = state.lines.filter(function (line) {
      return line && line.key !== id && line.lineId !== id;
    });
    if (!next.length) return state;
    state.lines = next;
    state.error = "";
    state.errorLineKey = "";
    return derive(state);
  }

  function startAtDateForLine(state, line) {
    var model = window.ffBookingAppointmentModel;
    if (!model || typeof model.civilToDate !== "function" || !line) return null;
    return model.civilToDate(state.dateKey, line.startMin, state.locationId);
  }

  function startAtDate(state) {
    ensureLines(state);
    return startAtDateForLine(state, state.lines[0]);
  }

  function applyRepoError(state, result) {
    var providerId = result && result.providerId;
    state.errorLineKey = "";
    if (Number.isInteger(result && result.lineIndex) && state.lines && state.lines[result.lineIndex]) {
      state.errorLineKey = state.lines[result.lineIndex].key;
      providerId = providerId || state.lines[result.lineIndex].providerId;
    } else if (result && result.lineId && state.lines) {
      var hit = state.lines.find(function (line) { return line && line.lineId === result.lineId; });
      if (hit) {
        state.errorLineKey = hit.key;
        providerId = providerId || hit.providerId;
      }
    }
    state.error = friendlyError(result && result.code, providerId);
    if (!(result && result.code)) state.error = (result && result.error) || state.error;
    return state;
  }

  function linePayload(state, line) {
    var sameService = line.keepStoredSnapshots && trim(line.serviceId) === trim(line.originalServiceId);
    return {
      lineId: line.lineId,
      serviceId: line.serviceId,
      providerId: line.providerId,
      startAt: startAtDateForLine(state, line),
      durationMinutes: line.durationMinutes,
      priceSnapshot: line.price,
      serviceNameSnapshot: sameService ? line.originalServiceName : (line.service && line.service.name) || "",
      preservePriceSnapshot: sameService,
      preserveNameSnapshot: sameService,
      guestKey: trim(line.guestKey),
      guestName: trim(line.guestName),
      requested: !!line.requested
    };
  }

  async function create(state) {
    if (findProviderOverlaps(state).length) {
      state.error = providerOverlapMessage(state) || CODES.PROVIDER_DOUBLE_BOOKED;
      return { ok: false, code: "PROVIDER_DOUBLE_BOOKED", error: state.error };
    }
    if (unresolvedGaps(state).length) {
      state.error = CODES.UNRESOLVED_GAP;
      return { ok: false, code: "UNRESOLVED_GAP", error: state.error };
    }
    if (!canCreate(state)) {
      state.error = !state.clientId ? CODES.INVALID_CLIENT : CODES.INVALID_SERVICE;
      return { ok: false, error: state.error };
    }
    var repo = window.ffBookingAppointments;
    if (!repo) return { ok: false, error: "Appointments are not ready." };
    state.creating = true;
    state.error = "";
    state.errorLineKey = "";
    try {
      var result = await repo.createAppointment({
        clientId: state.clientId,
        locationId: state.locationId,
        source: "front_desk",
        assignmentType: "specific_provider",
        notes: state.notes,
        gapsAcknowledged: unresolvedGaps(state).length === 0,
        serviceLines: state.lines.map(function (line) { return linePayload(state, line); })
      });
      if (!result || !result.ok) {
        applyRepoError(state, result);
        return { ok: false, code: result && result.code, error: state.error, result: result };
      }
      return { ok: true, appointment: result.appointment };
    } catch (err) {
      state.error = err && err.message ? err.message : "This appointment could not be created.";
      return { ok: false, error: state.error };
    } finally {
      state.creating = false;
    }
  }

  function timeOptionsHtml(selected) {
    var value = Number(selected);
    var out = [];
    if (Number.isFinite(value) && value % 15 !== 0) {
      out.push('<option value="' + value + '" selected>' + formatMinutes(value) + "</option>");
    }
    for (var m = 6 * 60; m < 22 * 60; m += 15) {
      out.push(
        '<option value="' + m + '"' + (m === value ? " selected" : "") + ">" +
        formatMinutes(m) + "</option>"
      );
    }
    return out.join("");
  }

  function fingerprint(state) {
    return [
      trim(state && state.dateKey),
      trim(state && state.notes),
      ((state && state.lines) || []).map(function (line) {
        return [trim(line.lineId), trim(line.serviceId), trim(line.providerId), Number(line.startMin), trim(line.guestKey), trim(line.guestName), line.requested ? "1" : "0"].join("|");
      }).join(";")
    ].join("::");
  }

  function editStateFrom(seed) {
    var rows = Array.isArray(seed && seed.lines) && seed.lines.length ? seed.lines : [seed];
    var state = emptyState(seed);
    state.appointmentId = trim(seed && seed.appointmentId);
    state.clientId = trim(seed && seed.clientId);
    state.notes = seed && seed.notes != null ? String(seed.notes) : "";
    state.saving = false;
    state.keepStoredSnapshots = true;
    state.lines = rows.map(function (row) {
      var line = emptyLine({
        lineId: row && row.lineId,
        providerId: row && row.providerId,
        serviceId: row && row.serviceId,
        startMin: row && row.startMin,
        serviceName: row && (row.serviceName || row.originalServiceName),
        durationMinutes: row && row.durationMinutes,
        price: row && row.price,
        keepStoredSnapshots: true,
        guestKey: row && row.guestKey,
        guestName: row && row.guestName,
        requested: !!(row && row.requested)
      });
      if (line.serviceId) {
        line.service = {
          id: line.serviceId,
          name: line.originalServiceName || "Service",
          durationMinutes: line.storedDurationMinutes,
          price: line.storedPrice || 0,
          raw: {
            durationMinutes: line.storedDurationMinutes,
            defaultPrice: line.storedPrice || 0
          }
        };
      }
      return deriveLine(line);
    });
    derive(state);
    state.keptGaps = {};
    findGaps(state).forEach(function (gap) {
      state.keptGaps[gap.signature] = true;
    });
    state.originalServiceId = state.serviceId;
    state.originalServiceName = state.lines[0] && state.lines[0].originalServiceName || "";
    state.storedDurationMinutes = state.durationMinutes;
    state.storedPrice = state.price;
    state.original = {
      dateKey: state.dateKey,
      notes: trim(state.notes),
      fingerprint: fingerprint(state)
    };
    return state;
  }

  function isEditDirty(state) {
    if (!state || !state.original) return false;
    return trim(state.dateKey) !== trim(state.original.dateKey)
      || trim(state.notes) !== trim(state.original.notes)
      || fingerprint(state) !== state.original.fingerprint;
  }

  function canSave(state) {
    return !!(
      state
      && isEditDirty(state)
      && state.appointmentId
      && state.locationId
      && state.dateKey
      && state.lines
      && state.lines.length
      && state.lines.every(lineComplete)
      && !unresolvedGaps(state).length
      && !findProviderOverlaps(state).length
    );
  }

  function editPatch(state) {
    return {
      notes: state.notes,
      gapsAcknowledged: unresolvedGaps(state).length === 0,
      serviceLines: (state.lines || []).map(function (line) { return linePayload(state, line); })
    };
  }

  async function update(state) {
    if (findProviderOverlaps(state).length) {
      state.error = providerOverlapMessage(state) || CODES.PROVIDER_DOUBLE_BOOKED;
      return { ok: false, code: "PROVIDER_DOUBLE_BOOKED", error: state.error };
    }
    if (unresolvedGaps(state).length) {
      state.error = CODES.UNRESOLVED_GAP;
      return { ok: false, code: "UNRESOLVED_GAP", error: state.error };
    }
    if (!canSave(state)) {
      state.error = state && !(state.lines || []).every(lineComplete) ? CODES.INVALID_SERVICE : "No changes to save.";
      return { ok: false, error: state.error };
    }
    var repo = window.ffBookingAppointments;
    if (!repo || typeof repo.updateAppointment !== "function") {
      return { ok: false, error: "Appointments are not ready." };
    }
    state.saving = true;
    state.error = "";
    state.errorLineKey = "";
    try {
      var result = await repo.updateAppointment(state.appointmentId, editPatch(state));
      if (!result || !result.ok) {
        applyRepoError(state, result);
        if (!result || !result.code) state.error = (result && result.error) || "This time is no longer available.";
        return { ok: false, code: result && result.code, error: state.error, result: result };
      }
      return { ok: true, appointment: result.appointment };
    } catch (err) {
      state.error = err && err.message ? err.message : "This appointment could not be saved.";
      return { ok: false, error: state.error };
    } finally {
      state.saving = false;
    }
  }

  function holdSpec(state) {
    var dateKey = trim(state && state.dateKey);
    if (!dateKey) {
      try {
        var cal = window.ffBookingCalState;
        if (cal && typeof cal.getSelectedDateKey === "function") dateKey = trim(cal.getSelectedDateKey());
      } catch (_) {}
    }
    if (!state || !dateKey) return null;
    var clientName = state.client && state.client.displayName ? String(state.client.displayName) : "";
    var lines = (state.lines || []).filter(function (line) {
      return line && trim(line.providerId) && Number.isFinite(Number(line.startMin));
    }).map(function (line) {
      return {
        lineKey: trim(line.key) || trim(line.lineId),
        providerId: line.providerId,
        startMin: Number(line.startMin),
        durationMinutes: Number(line.durationMinutes) > 0 ? Number(line.durationMinutes) : 30,
        title: line.service && line.service.name ? String(line.service.name) : "",
        clientName: servedName(state, line),
        guestKey: trim(line.guestKey)
      };
    });
    if (!lines.length) return null;
    return { dateKey: dateKey, clientName: clientName, lines: lines };
  }

  function pickerServices(state, line) {
    if (line && trim(line.providerId) && (line.services || []).length) return line.services;
    return (state && state.catalogServices) || [];
  }

  function catalogRank(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function sortCatalogServices(rows) {
    return (rows || []).slice().sort(function (a, b) {
      var catA = catalogRank(a && a.categorySortOrder, 999);
      var catB = catalogRank(b && b.categorySortOrder, 999);
      if (catA !== catB) return catA - catB;
      var svcA = catalogRank(a && a.sortOrder, 999);
      var svcB = catalogRank(b && b.sortOrder, 999);
      if (svcA !== svcB) return svcA - svcB;
      return String(a && a.name || "").localeCompare(String(b && b.name || ""));
    });
  }

  function categoryGroupKey(svc) {
    var name = trim(svc && svc.category) || "Services";
    return "shared:" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "other";
  }

  function servicePickerHtml(state, line, options) {
    var query = trim(options && options.serviceQ).toLowerCase();
    var rows = sortCatalogServices(pickerServices(state, line).filter(function (svc) {
      if (!svc || !svc.name) return false;
      if (!query) return true;
      return String(svc.name).toLowerCase().indexOf(query) !== -1
        || String(svc.category || "").toLowerCase().indexOf(query) !== -1;
    }));
    var groups = [];
    var seen = {};
    rows.forEach(function (svc) {
      var cat = trim(svc.category) || "Services";
      var key = categoryGroupKey(svc);
      if (seen[key] == null) {
        seen[key] = groups.length;
        groups.push({ key: key, name: cat, services: [] });
      }
      groups[seen[key]].services.push(svc);
    });
    var expanded = (options && options.expandedCats) || {};
    var list = groups.map(function (group) {
      var shut = !query && !expanded[group.name];
      return '<div class="ff-appt-picker-group' + (shut ? " is-collapsed" : "") + '">' +
        '<button type="button" class="ff-appt-picker-cat" data-ff-appt-act="toggle-service-cat" data-ff-cat="' +
          escapeHtml(group.name) + '" aria-expanded="' + (shut ? "false" : "true") + '">' +
          "<span>" + escapeHtml(group.name) + "</span>" +
          '<span class="ff-appt-picker-cat-count">' + group.services.length + "</span>" +
          '<span class="ff-appt-picker-cat-caret" aria-hidden="true">▾</span>' +
        "</button>" +
        '<div class="ff-appt-picker-cat-list">' +
          group.services.map(function (svc) {
            return '<button type="button" class="ff-appt-svc-row" data-ff-appt-act="pick-service" data-ff-line="' +
              escapeHtml(line.key) + '" data-ff-service="' + escapeHtml(svc.id) + '">' +
              "<span>" + escapeHtml(svc.name) + "</span>" +
              "<strong>" + escapeHtml(money(svc.price)) + "</strong>" +
              "</button>";
          }).join("") +
        "</div>" +
      "</div>";
    }).join("");
    return (
      '<div class="ff-appt-picker" data-ff-picker="service">' +
        '<input type="search" class="ff-appt-picker-q" data-ff-service-q placeholder="Search services..." value="' +
          escapeHtml(options && options.serviceQ || "") + '" autocomplete="off">' +
        '<div class="ff-appt-picker-list">' +
          (list || '<div class="ff-appt-picker-empty">No services found</div>') +
        "</div>" +
      "</div>"
    );
  }

  function providerPickerHtml(line, providers, options) {
    var query = trim(options && options.providerQ).toLowerCase();
    var rows = (providers || []).filter(function (emp) {
      if (!emp || !emp.id) return false;
      var name = trim(emp.firstName || emp.name);
      return !query || name.toLowerCase().indexOf(query) !== -1;
    });
    var list = rows.map(function (emp) {
      var name = trim(emp.firstName || emp.name) || "Provider";
      var photo = trim(emp.photoURL || emp.photoUrl || emp.avatarUrl);
      var avatar = photo
        ? '<img src="' + escapeHtml(photo) + '" alt="">'
        : "<span>" + escapeHtml(name.charAt(0).toUpperCase()) + "</span>";
      return '<button type="button" class="ff-appt-prov-row" data-ff-appt-act="pick-provider" data-ff-line="' +
        escapeHtml(line.key) + '" data-ff-provider="' + escapeHtml(emp.id) + '">' +
        '<span class="ff-appt-prov-avatar">' + avatar + "</span>" +
        "<span>" + escapeHtml(name) + "</span>" +
        "</button>";
    }).join("");
    return (
      '<div class="ff-appt-picker" data-ff-picker="provider">' +
        '<input type="search" class="ff-appt-picker-q" data-ff-provider-q placeholder="Search..." value="' +
          escapeHtml(options && options.providerQ || "") + '" autocomplete="off">' +
        '<div class="ff-appt-picker-list">' +
          (list || '<div class="ff-appt-picker-empty">No providers found</div>') +
        "</div>" +
      "</div>"
    );
  }

  function linesTotal(state) {
    return ((state && state.lines) || []).reduce(function (sum, line) {
      var n = Number(line && line.price);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
  }

  function createLinesHtml(state, providers, options) {
    var rows = (state && state.lines) || [];
    var list = Array.isArray(providers) ? providers : [];
    var ui = options || {};
    var canRemove = rows.length > 1;
    var showError = ui.showError !== false;
    return partyNoticeHtml(state) + rows.map(function (line, index) {
      var lineProviders = list.slice();
      if (line.providerId && !lineProviders.some(function (emp) { return emp && emp.id === line.providerId; })) {
        lineProviders = lineProviders.concat([{ id: line.providerId, firstName: providerName(line.providerId) }]);
      }
      var clash = providerOverlapKeys(state)[line.key];
      var err = !!(clash || (showError && state.errorLineKey === line.key && state.error));
      var pickingService = ui.servicePickerKey === line.key;
      var pickingProvider = ui.providerPickerKey === line.key;
      var rail = '<div class="ff-appt-rail"><span class="ff-appt-rail-node">' + (index + 1) + "</span></div>";
      if (!trim(line.serviceId)) {
        return (
          '<div class="ff-appt-svc is-empty' + (err ? " is-error" : "") + '" data-ff-line="' + escapeHtml(line.key) + '">' +
            rail +
            '<div class="ff-appt-card">' +
              guestRowHtml(state, line) +
              '<button type="button" class="ff-appt-search-row" data-ff-appt-act="open-service-picker" data-ff-line="' +
                escapeHtml(line.key) + '">Search or select service</button>' +
              (pickingService ? servicePickerHtml(state, line, ui) : "") +
              (err ? '<div class="ff-appt-error">' + escapeHtml(state.error) + "</div>" : "") +
            "</div>" +
          "</div>"
        );
      }
      var withName = line.providerId ? providerName(line.providerId) : "Provider";
      var emp = lineProviders.find(function (row) { return row && row.id === line.providerId; }) || null;
      var photo = emp ? trim(emp.photoURL || emp.photoUrl || emp.avatarUrl) : "";
      var avatar = photo
        ? '<img class="ff-appt-chip-av" src="' + escapeHtml(photo) + '" alt="">'
        : '<span class="ff-appt-chip-av">' + escapeHtml(withName.charAt(0).toUpperCase()) + "</span>";
      var startLabel = Number.isFinite(Number(line.startMin)) ? formatMinutes(line.startMin) : "—";
      var endLabel = Number.isFinite(Number(line.endMin)) ? formatMinutes(line.endMin) : "—";
      return (
        '<div class="ff-appt-svc' + (err ? " is-error" : "") + '" data-ff-line="' + escapeHtml(line.key) + '">' +
          rail +
          '<div class="ff-appt-card">' +
            guestRowHtml(state, line) +
            '<div class="ff-appt-card-top">' +
              '<button type="button" class="ff-appt-card-name" data-ff-appt-act="open-service-picker" data-ff-line="' +
                escapeHtml(line.key) + '">' + escapeHtml((line.service && line.service.name) || "Service") + "</button>" +
              '<span class="ff-appt-card-price">' + escapeHtml(money(line.price)) + "</span>" +
              (canRemove
                ? '<button type="button" class="ff-appt-card-x" data-ff-line-act="remove" data-ff-line="' +
                  escapeHtml(line.key) + '" aria-label="Remove service">×</button>'
                : "") +
            "</div>" +
            '<div class="ff-appt-strip">' +
              '<label class="ff-appt-strip-start">' +
                '<select data-ff-line-field="start" aria-label="Start time">' + timeOptionsHtml(line.startMin) + "</select>" +
                '<span class="ff-appt-strip-value">' + escapeHtml(startLabel) + "</span>" +
              "</label>" +
              '<span class="ff-appt-strip-line" aria-hidden="true"></span>' +
              '<span class="ff-appt-strip-end">' + escapeHtml(endLabel) + "</span>" +
            "</div>" +
            '<div class="ff-appt-card-row">' +
              '<button type="button" class="ff-appt-chip" data-ff-appt-act="open-provider-picker" data-ff-line="' +
                escapeHtml(line.key) + '">' + avatar +
                "<span>" + escapeHtml(withName) + "</span>" +
                '<span class="ff-appt-caret" aria-hidden="true">▾</span></button>' +
              '<button type="button" class="ff-appt-request' + (line.requested ? " is-on" : "") +
                '" data-ff-appt-act="toggle-request" data-ff-line="' + escapeHtml(line.key) +
                '" aria-pressed="' + (line.requested ? "true" : "false") + '" title="Requested for this provider">' +
                '<span class="ff-appt-request-mark" aria-hidden="true"></span>Request</button>' +
              '<span class="ff-appt-card-dur">' + escapeHtml(formatDurationLabel(line.durationMinutes) || "—") + "</span>" +
            "</div>" +
            (pickingProvider ? providerPickerHtml(line, lineProviders, ui) : "") +
            (pickingService ? servicePickerHtml(state, line, ui) : "") +
            '<div class="ff-appt-cap"' + (line.capabilityMessage ? "" : " hidden") + ">" + escapeHtml(line.capabilityMessage) + "</div>" +
            (clash
              ? '<div class="ff-appt-error">' + escapeHtml(providerOverlapMessage(state)) + "</div>"
              : (showError && state.errorLineKey === line.key && state.error
                ? '<div class="ff-appt-error">' + escapeHtml(state.error) + "</div>"
                : "")) +
          "</div>" +
        "</div>" +
        gapAfterHtml(state, line.key, ui)
      );
    }).join("");
  }

  function linesHtml(state, providers, options) {
    var rows = (state && state.lines) || [];
    var list = Array.isArray(providers) ? providers : [];
    var canRemove = rows.length > 1;
    var showError = options && options.showError !== false;
    return rows.map(function (line, index) {
      var lineProviders = list.slice();
      if (line.providerId && !lineProviders.some(function (emp) { return emp && emp.id === line.providerId; })) {
        lineProviders = lineProviders.concat([{ id: line.providerId, firstName: providerName(line.providerId) }]);
      }
      var clash = providerOverlapKeys(state)[line.key];
      var err = !!(clash || (showError && state.errorLineKey === line.key && state.error));
      return (
        '<div class="ff-appt-line' + (err ? " is-error" : "") + '" data-ff-line="' + escapeHtml(line.key) + '">' +
          '<div class="ff-appt-line-head">' +
            "<strong>Service " + (index + 1) + "</strong>" +
            (canRemove
              ? '<button type="button" class="ff-appt-line-remove" data-ff-line-act="remove" data-ff-line="' + escapeHtml(line.key) + '">Remove</button>'
              : "") +
          "</div>" +
          '<label class="ff-appt-field"><span>Service</span>' +
            '<select data-ff-line-field="service">' +
              '<option value="">Select a service</option>' +
              (line.services || []).map(function (svc) {
                return '<option value="' + escapeHtml(svc.id) + '"' + (svc.id === line.serviceId ? " selected" : "") + ">" +
                  escapeHtml(svc.name) + " · " + svc.durationMinutes + " min · " + money(svc.price) +
                  "</option>";
              }).join("") +
            "</select>" +
          "</label>" +
          '<label class="ff-appt-field"><span>Provider</span>' +
            '<select data-ff-line-field="provider">' +
              '<option value="">Select a provider</option>' +
              lineProviders.map(function (emp) {
                return '<option value="' + escapeHtml(emp.id) + '"' + (emp.id === line.providerId ? " selected" : "") + ">" +
                  escapeHtml(emp.firstName || emp.name || "Provider") + "</option>";
              }).join("") +
            "</select>" +
          "</label>" +
          '<label class="ff-appt-field"><span>Start time</span>' +
            '<select data-ff-line-field="start">' + timeOptionsHtml(line.startMin) + "</select>" +
          "</label>" +
          '<div class="ff-appt-summary"' + (line.service ? "" : " hidden") + ">" +
            "<div><span>Duration</span><strong>" + escapeHtml(line.durationMinutes ? line.durationMinutes + " min" : "—") + "</strong></div>" +
            "<div><span>End time</span><strong>" + escapeHtml(line.endMin ? formatMinutes(line.endMin) : "—") + "</strong></div>" +
            "<div><span>Price</span><strong>" + escapeHtml(money(line.price)) + "</strong></div>" +
          "</div>" +
          '<div class="ff-appt-cap"' + (line.capabilityMessage ? "" : " hidden") + ">" + escapeHtml(line.capabilityMessage) + "</div>" +
          (clash
            ? '<div class="ff-appt-error">' + escapeHtml(providerOverlapMessage(state)) + "</div>"
            : (err && state.error ? '<div class="ff-appt-error">' + escapeHtml(state.error) + "</div>" : "")) +
        "</div>" +
        gapAfterHtml(state, line.key, options)
      );
    }).join("");
  }

  window.ffBookingAppointmentForm = {
    emptyState: emptyState,
    emptyLine: emptyLine,
    derive: derive,
    isDirty: isDirty,
    canCreate: canCreate,
    refreshServices: refreshServices,
    setService: setService,
    setProvider: setProvider,
    setDate: setDate,
    setStart: setStart,
    setClient: setClient,
    addLine: addLine,
    addGuest: addGuest,
    setLineGuestName: setLineGuestName,
    servedName: servedName,
    uniquePeople: uniquePeople,
    removeLine: removeLine,
    setLineService: setLineService,
    applyLineProvider: applyLineProvider,
    setLineProvider: setLineProvider,
    setLineRequested: setLineRequested,
    setLineStart: setLineStart,
    findGaps: findGaps,
    findProviderOverlaps: findProviderOverlaps,
    providerOverlapMessage: providerOverlapMessage,
    partySize: partySize,
    partyNoticeHtml: partyNoticeHtml,
    unresolvedGaps: unresolvedGaps,
    keepGap: keepGap,
    closeGap: closeGap,
    gapNoticeHtml: gapNoticeHtml,
    startAtDate: startAtDate,
    create: create,
    timeOptionsHtml: timeOptionsHtml,
    editStateFrom: editStateFrom,
    isEditDirty: isEditDirty,
    canSave: canSave,
    editPatch: editPatch,
    update: update,
    formatMinutes: formatMinutes,
    providerName: providerName,
    friendlyError: friendlyError,
    holdSpec: holdSpec,
    linesHtml: linesHtml,
    createLinesHtml: createLinesHtml,
    linesTotal: linesTotal,
    servicePickerHtml: servicePickerHtml,
    providerPickerHtml: providerPickerHtml,
    formatDurationLabel: formatDurationLabel,
    lineComplete: lineComplete,
    applyRepoError: applyRepoError
  };
})();
