/**
 * Canonical Booking availability engine V1.
 *
 * Answers: can this provider work at this location on this date/time?
 * Schedule availability only — no appointment conflicts, Queue, Tickets, or Services.
 *
 * Composes Operations sources:
 *   settings.locationSchedules.{locationId}.specialBusinessDays | specialBusinessDays
 *   settings.locationSchedules.{locationId}.businessHours | businessHours
 *   staff.locationScheduleAvailability / defaultSchedule via getStaffDefaultScheduleForLocation
 *   approved inboxItems (vacation, day_off/time_off, late_start, early_leave, schedule_change)
 *     via window.ffScheduleAvailability.getEffectiveAvailabilityForDate when loaded
 *
 * Internal bookable windows are always an interval list:
 *   [{ start: "HH:MM", end: "HH:MM", startMin, endMin }, ...]
 */
(function () {
  var DEFAULT_OPEN = 9 * 60;
  var DEFAULT_CLOSE = 18 * 60;
  var WEEKDAY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

  function helpers() {
    return window.ffScheduleHelpers || null;
  }

  function schedAvail() {
    return window.ffScheduleAvailability || null;
  }

  function timeApi() {
    return window.ffBookingTime || null;
  }

  function settingsOf(raw) {
    return raw && typeof raw === "object" ? raw : (window.settings && typeof window.settings === "object" ? window.settings : {});
  }

  function resolveLocationId(locationId) {
    var loc = String(locationId || "").trim();
    if (loc) return loc;
    try {
      if (typeof window.ffGetActiveLocationId === "function") {
        loc = String(window.ffGetActiveLocationId() || "").trim();
      }
    } catch (_) {}
    if (loc) return loc;
    try {
      return String(window.__ff_active_location_id || "").trim();
    } catch (_) {
      return "";
    }
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function formatMinutes(total) {
    var m = Number(total);
    if (!Number.isFinite(m)) return "";
    var wrapped = ((Math.round(m) % 1440) + 1440) % 1440;
    return pad2(Math.floor(wrapped / 60)) + ":" + pad2(wrapped % 60);
  }

  function parseMinutes(value) {
    var api = helpers();
    if (api && typeof api.parseScheduleTimeToMinutes === "function") {
      var parsed = api.parseScheduleTimeToMinutes(value);
      if (parsed != null) return parsed;
    }
    var raw = String(value || "").trim();
    var m24 = /^(\d{1,2}):(\d{2})$/.exec(raw);
    if (m24) return Number(m24[1]) * 60 + Number(m24[2]);
    var m12 = /^(\d{1,2}):(\d{2})\s*([ap]m)$/i.exec(raw);
    if (m12) {
      var hour = Number(m12[1]) % 12;
      if (/pm/i.test(m12[3])) hour += 12;
      return hour * 60 + Number(m12[2]);
    }
    return null;
  }

  function normalizeDateKey(value, locationId) {
    if (value && typeof value === "object" && value.dateKey) {
      return normalizeDateKey(value.dateKey, locationId);
    }
    if (typeof value === "string") {
      var match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) return match[1] + "-" + match[2] + "-" + match[3];
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      var tm = timeApi();
      if (tm && typeof tm.zonedDateKey === "function") {
        return tm.zonedDateKey(value, locationId);
      }
      var iso = value.toISOString();
      return iso.slice(0, 10);
    }
    return "";
  }

  function weekdayKey(dateKey) {
    var tm = timeApi();
    if (tm && typeof tm.weekdayKey === "function") return tm.weekdayKey(dateKey);
    var api = helpers();
    if (api && typeof api.getDayNameFromDateKey === "function") {
      return api.getDayNameFromDateKey(dateKey) || "";
    }
    var parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || "").trim());
    if (!parts) return "";
    var utc = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 12, 0, 0));
    return WEEKDAY[utc.getUTCDay()] || "";
  }

  function makeInterval(startMin, endMin, startText, endText) {
    var start = Number(startMin);
    var end = Number(endMin);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return {
      start: startText || formatMinutes(start),
      end: endText || formatMinutes(end),
      startMin: start,
      endMin: end
    };
  }

  function intervalFromTimes(startTime, endTime) {
    var startMin = parseMinutes(startTime);
    var endMin = parseMinutes(endTime);
    if (startMin == null || endMin == null) return null;
    return makeInterval(startMin, endMin, startTime, endTime);
  }

  function mergeIntervals(list) {
    var sorted = (list || []).filter(Boolean).sort(function (a, b) {
      return a.startMin - b.startMin;
    });
    var out = [];
    sorted.forEach(function (item) {
      var last = out[out.length - 1];
      if (!last || item.startMin > last.endMin) {
        out.push({
          start: item.start,
          end: item.end,
          startMin: item.startMin,
          endMin: item.endMin
        });
        return;
      }
      if (item.endMin > last.endMin) {
        last.endMin = item.endMin;
        last.end = item.end;
      }
    });
    return out;
  }

  function intersectIntervals(left, right) {
    var out = [];
    (left || []).forEach(function (a) {
      (right || []).forEach(function (b) {
        var startMin = Math.max(a.startMin, b.startMin);
        var endMin = Math.min(a.endMin, b.endMin);
        var hit = makeInterval(startMin, endMin);
        if (hit) out.push(hit);
      });
    });
    return mergeIntervals(out);
  }

  function containsMinutes(intervals, minutes) {
    var m = Number(minutes);
    if (!Number.isFinite(m)) return false;
    return (intervals || []).some(function (win) {
      return m >= win.startMin && m < win.endMin;
    });
  }

  function pickLocationScheduleField(settings, locationId, key) {
    var locId = String(locationId || "").trim();
    var locSchedules = settings && settings.locationSchedules;
    var bucket = locId && locSchedules && typeof locSchedules === "object" ? locSchedules[locId] : null;
    if (bucket && Object.prototype.hasOwnProperty.call(bucket, key) &&
        bucket[key] && typeof bucket[key] === "object") {
      return bucket[key];
    }
    return settings && settings[key] && typeof settings[key] === "object" ? settings[key] : null;
  }

  function normalizeBusinessHoursMap(raw) {
    var api = helpers();
    if (api && typeof api.normalizeBusinessHours === "function" && raw) {
      return api.normalizeBusinessHours(raw);
    }
    return raw && typeof raw === "object" ? raw : null;
  }

  function normalizeSpecialDaysMap(raw) {
    var api = helpers();
    if (api && typeof api.normalizeSpecialBusinessDays === "function") {
      return api.normalizeSpecialBusinessDays(raw || {});
    }
    var out = {};
    if (!raw || typeof raw !== "object") return out;
    Object.keys(raw).forEach(function (dateKey) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
      var src = raw[dateKey] && typeof raw[dateKey] === "object" ? raw[dateKey] : {};
      if (src.isClosed === true) {
        out[dateKey] = { isClosed: true, openTime: null, closeTime: null, note: String(src.note || "").trim() };
        return;
      }
      out[dateKey] = {
        isClosed: false,
        openTime: src.openTime || null,
        closeTime: src.closeTime || null,
        note: String(src.note || "").trim()
      };
    });
    return out;
  }

  function weeklyBusinessIntervals(weekly, dayKey, dayShiftSegments) {
    var entry = weekly && dayKey ? weekly[dayKey] : null;
    if (!entry || entry.isOpen !== true) return [];
    var api = helpers();
    if (api && typeof api.getEffectiveShiftSegmentsForDay === "function") {
      var segs = api.getEffectiveShiftSegmentsForDay(dayKey, weekly, dayShiftSegments);
      if (Array.isArray(segs) && segs.length) {
        return mergeIntervals(segs.map(function (seg) {
          return intervalFromTimes(seg.startTime, seg.endTime);
        }));
      }
    }
    var win = intervalFromTimes(entry.openTime, entry.closeTime);
    return win ? [win] : [];
  }

  function resolveEffectiveBusinessHours(date, locationId, settingsRaw) {
    var locId = resolveLocationId(locationId);
    var settings = settingsOf(settingsRaw);
    var dateKey = normalizeDateKey(date, locId);
    var empty = {
      dateKey: dateKey,
      locationId: locId,
      isOpen: false,
      source: "none",
      note: "",
      intervals: [],
      weekly: null
    };
    if (!dateKey) return empty;

    var weeklyRaw = pickLocationScheduleField(settings, locId, "businessHours");
    var weekly = normalizeBusinessHoursMap(weeklyRaw);
    var special = normalizeSpecialDaysMap(pickLocationScheduleField(settings, locId, "specialBusinessDays"));
    var shifts = pickLocationScheduleField(settings, locId, "dayShiftSegments");
    var dayKey = weekdayKey(dateKey);
    var specialDay = special && special[dateKey] ? special[dateKey] : null;

    if (specialDay) {
      if (specialDay.isClosed === true) {
        return {
          dateKey: dateKey,
          locationId: locId,
          isOpen: false,
          source: "special_day_closed",
          note: specialDay.note || "",
          intervals: [],
          weekly: weekly
        };
      }
      var specialWin = intervalFromTimes(specialDay.openTime, specialDay.closeTime);
      if (!specialWin) {
        var fallbackWin = weeklyBusinessIntervals(weekly, dayKey, null)[0] || null;
        if (fallbackWin) {
          specialWin = intervalFromTimes(
            specialDay.openTime || fallbackWin.start,
            specialDay.closeTime || fallbackWin.end
          );
        }
      }
      return {
        dateKey: dateKey,
        locationId: locId,
        isOpen: !!specialWin,
        source: "special_day_hours",
        note: specialDay.note || "",
        intervals: specialWin ? [specialWin] : [],
        weekly: weekly
      };
    }

    var weeklyIntervals = weeklyBusinessIntervals(weekly, dayKey, shifts);
    return {
      dateKey: dateKey,
      locationId: locId,
      isOpen: weeklyIntervals.length > 0,
      source: "business_hours",
      note: "",
      intervals: weeklyIntervals,
      weekly: weekly
    };
  }

  function dayIsEnabled(day) {
    if (!day || typeof day !== "object") return false;
    return day.enabled === true || day.enabled === 1 || String(day.enabled).toLowerCase() === "true";
  }

  function scheduleHasEnabledDay(sched) {
    if (!sched || typeof sched !== "object") return false;
    return Object.keys(sched).some(function (key) {
      return dayIsEnabled(sched[key]);
    });
  }

  function locationDefaultSchedule(staff, locationId) {
    var api = helpers();
    var sched = null;
    if (api && typeof api.getStaffDefaultScheduleForLocation === "function") {
      sched = api.getStaffDefaultScheduleForLocation(staff, locationId);
    } else if (staff && staff.defaultSchedule) {
      sched = staff.defaultSchedule;
    }
    if (api && sched && typeof api.normalizeDefaultSchedule === "function") {
      sched = api.normalizeDefaultSchedule(sched);
    }
    return sched && typeof sched === "object" ? sched : {};
  }

  function defaultProviderIntervals(staff, dateKey, locationId, business) {
    var sched = locationDefaultSchedule(staff, locationId);
    var dayKey = weekdayKey(dateKey);
    var day = sched && dayKey ? sched[dayKey] : null;
    if (dayIsEnabled(day)) {
      var explicit = intervalFromTimes(day.startTime, day.endTime);
      if (explicit) return { intervals: [explicit], source: "default_schedule", schedule: sched };
      if (business && business.intervals && business.intervals.length) {
        return { intervals: business.intervals.slice(), source: "default_schedule", schedule: sched };
      }
      var fallback = makeInterval(DEFAULT_OPEN, DEFAULT_CLOSE, "09:00", "18:00");
      return { intervals: fallback ? [fallback] : [], source: "default_schedule", schedule: sched };
    }
    if (scheduleHasEnabledDay(sched)) {
      return { intervals: [], source: "default_schedule", schedule: sched };
    }
    if (business && business.isOpen && business.intervals && business.intervals.length) {
      return { intervals: business.intervals.slice(), source: "salon_hours_inherit", schedule: sched };
    }
    return { intervals: [], source: "default_schedule", schedule: sched };
  }

  function findStaff(providerId, explicit) {
    if (explicit && typeof explicit === "object") return explicit;
    var id = String(providerId || "").trim();
    if (!id) return null;
    var list = [];
    try {
      if (typeof window.ffGetStaffStore === "function") {
        var store = window.ffGetStaffStore();
        if (store && Array.isArray(store.staff)) list = store.staff;
      }
    } catch (_) {}
    if (!list.length) {
      try {
        var raw = JSON.parse(localStorage.getItem("ff_staff_v1") || "{}");
        if (Array.isArray(raw.staff)) list = raw.staff;
      } catch (_) {}
    }
    return list.find(function (staff) {
      if (!staff) return false;
      return String(staff.id || "") === id
        || String(staff.staffId || "") === id
        || String(staff.uid || "") === id
        || String(staff.userUid || "") === id;
    }) || null;
  }

  function approvedRequestsFor(locationId) {
    var store = window.ffBookingAvailabilityStore;
    if (store && typeof store.getApprovedRequests === "function") {
      return store.getApprovedRequests(locationId) || [];
    }
    return [];
  }

  function staffForResolver(staff, locationId, dateKey, business) {
    var baseline = defaultProviderIntervals(staff, dateKey, locationId, business);
    var schedule = baseline.schedule || locationDefaultSchedule(staff, locationId);
    if (baseline.source === "salon_hours_inherit" && business && business.intervals && business.intervals[0]) {
      var dayKey = weekdayKey(dateKey);
      var first = business.intervals[0];
      schedule = Object.assign({}, schedule);
      schedule[dayKey] = {
        enabled: true,
        startTime: first.start,
        endTime: first.end
      };
    }
    return {
      staff: Object.assign({}, staff, {
        defaultSchedule: schedule,
        staffId: staff.staffId || staff.id || "",
        uid: staff.uid || staff.userUid || "",
        userUid: staff.userUid || staff.uid || ""
      }),
      source: baseline.source
    };
  }

  function intervalsFromAvailabilityResult(result) {
    if (!result || result.isAvailable !== true) return [];
    var win = intervalFromTimes(result.startTime, result.endTime);
    return win ? [win] : [];
  }

  function applyApprovedExceptions(staff, requests, dateKey, weeklyHours) {
    var api = schedAvail();
    if (api && typeof api.getEffectiveAvailabilityForDate === "function") {
      return api.getEffectiveAvailabilityForDate(staff, requests, dateKey, {
        businessHours: weeklyHours || null
      });
    }
    return applyApprovedExceptionsFallback(staff, requests, dateKey, weeklyHours);
  }

  function normalizeRequestType(type) {
    var t = String(type || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    return t === "time_off" ? "day_off" : t;
  }

  function isApprovedRequestFallback(request) {
    var api = schedAvail();
    if (api && typeof api.isApprovedRequest === "function") return api.isApprovedRequest(request);
    var s = String(request && request.status || "").trim().toLowerCase();
    if (s === "approved" || s === "done") return true;
    if (s === "archived") {
      var prev = String(request && request.previousStatus || "").trim().toLowerCase();
      if (prev === "approved" || prev === "done") return true;
      if (!prev) {
        var t = normalizeRequestType(request && request.type);
        return ["vacation", "day_off", "late_start", "early_leave", "schedule_change"].indexOf(t) !== -1;
      }
    }
    return false;
  }

  function requestMatchesStaffFallback(request, staff) {
    var api = schedAvail();
    if (api && typeof api.requestMatchesStaff === "function") return api.requestMatchesStaff(request, staff);
    var uid = String(staff && (staff.uid || staff.userUid) || "").trim();
    var staffId = String(staff && (staff.staffId || staff.id) || "").trim();
    var data = request && request.data && typeof request.data === "object" ? request.data : {};
    var subjectUid = String(data.subjectUid || "").trim();
    var subjectStaffId = String(data.subjectStaffId || "").trim();
    if (subjectUid || subjectStaffId) {
      if (uid && subjectUid && uid === subjectUid) return true;
      if (staffId && subjectStaffId && staffId === subjectStaffId) return true;
      return false;
    }
    if (uid && (String(request.createdByUid || "") === uid || String(request.forUid || "") === uid)) return true;
    if (staffId && (String(request.createdByStaffId || "") === staffId || String(request.forStaffId || "") === staffId)) return true;
    return false;
  }

  function requestCoversDate(request, dateKey) {
    var data = request && request.data && typeof request.data === "object" ? request.data : {};
    var type = normalizeRequestType(request && request.type);
    function inRange(start, end) {
      var a = normalizeDateKey(start);
      var b = normalizeDateKey(end || start);
      return a && b && dateKey >= a && dateKey <= b;
    }
    if (type === "vacation") return inRange(data.startDate, data.endDate);
    if (type === "schedule_change") {
      if (Array.isArray(data.affectedDates) && data.affectedDates.length) {
        return data.affectedDates.map(normalizeDateKey).indexOf(dateKey) !== -1;
      }
      return inRange(data.startDate, data.endDate || data.startDate);
    }
    if (type === "day_off") {
      var explicit = normalizeDateKey(data.date);
      if (explicit) return explicit === dateKey;
      if (Array.isArray(data.affectedDates) && data.affectedDates.length) {
        return data.affectedDates.map(normalizeDateKey).indexOf(dateKey) !== -1;
      }
      return inRange(data.startDate, data.endDate);
    }
    return normalizeDateKey(data.date) === dateKey;
  }

  function applyApprovedExceptionsFallback(staff, requests, dateKey, weeklyHours) {
    var dayName = weekdayKey(dateKey);
    var schedule = staff && staff.defaultSchedule && staff.defaultSchedule[dayName]
      ? staff.defaultSchedule[dayName]
      : { enabled: false, startTime: null, endTime: null };
    var startTime = schedule.enabled === true ? schedule.startTime : null;
    var endTime = schedule.enabled === true ? schedule.endTime : null;
    var list = (Array.isArray(requests) ? requests : []).filter(function (request) {
      return isApprovedRequestFallback(request)
        && requestMatchesStaffFallback(request, staff)
        && requestCoversDate(request, dateKey);
    });
    var blocking = list.some(function (request) {
      var type = normalizeRequestType(request.type);
      return type === "vacation" || type === "day_off" || type === "schedule_change";
    });
    var late = list.filter(function (request) { return normalizeRequestType(request.type) === "late_start"; });
    var early = list.filter(function (request) { return normalizeRequestType(request.type) === "early_leave"; });
    if ((!startTime || !endTime) && !blocking && (late.length || early.length)) {
      var bh = weeklyHours && dayName ? weeklyHours[dayName] : null;
      startTime = startTime || (bh && bh.openTime) || "09:00";
      endTime = endTime || (bh && bh.closeTime) || "18:00";
    }
    if (blocking) {
      return { isAvailable: false, startTime: null, endTime: null, overrideTypes: list.map(function (r) { return normalizeRequestType(r.type); }) };
    }
    late.forEach(function (request) {
      var data = request.data || {};
      var requested = data.requestedTime || data.time || data.startTime;
      if (requested && (!startTime || String(requested) > String(startTime))) startTime = requested;
    });
    early.forEach(function (request) {
      var data = request.data || {};
      var requested = data.requestedTime || data.time || data.endTime;
      if (requested && (!endTime || String(requested) < String(endTime))) endTime = requested;
    });
    var win = intervalFromTimes(startTime, endTime);
    return {
      isAvailable: !!win,
      startTime: win ? win.start : null,
      endTime: win ? win.end : null,
      overrideTypes: list.map(function (r) { return normalizeRequestType(r.type); })
    };
  }

  function resolveEffectiveProviderAvailability(providerId, date, locationId, options) {
    var opts = options && typeof options === "object" ? options : {};
    var locId = resolveLocationId(locationId || opts.locationId);
    var dateKey = normalizeDateKey(date, locId);
    var settings = settingsOf(opts.settings);
    var business = resolveEffectiveBusinessHours(dateKey, locId, settings);
    var empty = {
      providerId: String(providerId || ""),
      dateKey: dateKey,
      locationId: locId,
      intervals: [],
      source: "none",
      overrideTypes: [],
      businessSource: business.source,
      isBusinessOpen: business.isOpen
    };
    if (!dateKey) return empty;
    if (!business.isOpen) {
      empty.source = "business_closed";
      return empty;
    }
    var staff = findStaff(providerId, opts.staff);
    if (!staff) return empty;
    var prepared = staffForResolver(staff, locId, dateKey, business);
    var requests = Array.isArray(opts.requests) ? opts.requests : approvedRequestsFor(locId);
    var applied = applyApprovedExceptions(prepared.staff, requests, dateKey, business.weekly);
    var providerIntervals = intervalsFromAvailabilityResult(applied);
    var bookable = intersectIntervals(business.intervals, providerIntervals);
    return {
      providerId: String(staff.id || staff.staffId || providerId || ""),
      dateKey: dateKey,
      locationId: locId,
      intervals: bookable,
      source: prepared.source,
      overrideTypes: Array.isArray(applied && applied.overrideTypes) ? applied.overrideTypes : [],
      businessSource: business.source,
      isBusinessOpen: business.isOpen
    };
  }

  function resolveDateTime(dateTime, locationId) {
    if (!dateTime && dateTime !== 0) return null;
    if (typeof dateTime === "object" && dateTime.dateKey) {
      var minutes = dateTime.minutes;
      if (minutes == null && dateTime.time) minutes = parseMinutes(dateTime.time);
      if (minutes == null) return null;
      return { dateKey: normalizeDateKey(dateTime.dateKey, locationId), minutes: Number(minutes) };
    }
    var instant = dateTime instanceof Date ? dateTime : (typeof dateTime === "string" || typeof dateTime === "number" ? new Date(dateTime) : null);
    if (!instant || Number.isNaN(instant.getTime())) return null;
    var tm = timeApi();
    var dateKey = tm && typeof tm.zonedDateKey === "function"
      ? tm.zonedDateKey(instant, locationId)
      : normalizeDateKey(instant, locationId);
    var mins = tm && typeof tm.zonedMinutes === "function"
      ? tm.zonedMinutes(instant, locationId)
      : (instant.getHours() * 60 + instant.getMinutes());
    return { dateKey: dateKey, minutes: mins };
  }

  function getEffectiveBusinessHours(date, locationId) {
    return resolveEffectiveBusinessHours(date, locationId);
  }

  function getEffectiveProviderAvailability(providerId, date, locationId) {
    return resolveEffectiveProviderAvailability(providerId, date, locationId);
  }

  function isProviderAvailableAt(providerId, dateTime, locationId) {
    var locId = resolveLocationId(locationId);
    var when = resolveDateTime(dateTime, locId);
    if (!when) return false;
    var availability = resolveEffectiveProviderAvailability(providerId, when.dateKey, locId);
    return containsMinutes(availability.intervals, when.minutes);
  }

  function canProviderFitDuration(providerId, startDateTime, durationMinutes, locationId) {
    var locId = resolveLocationId(locationId);
    var when = resolveDateTime(startDateTime, locId);
    var duration = Number(durationMinutes);
    if (!when || !Number.isFinite(duration) || duration <= 0) return false;
    var availability = resolveEffectiveProviderAvailability(providerId, when.dateKey, locId);
    var endMin = when.minutes + duration;
    return (availability.intervals || []).some(function (win) {
      return when.minutes >= win.startMin && endMin <= win.endMin;
    });
  }

  function businessAxis(date, locationId) {
    var hours = resolveEffectiveBusinessHours(date, locationId);
    var first = hours.intervals[0] || null;
    var last = hours.intervals.length ? hours.intervals[hours.intervals.length - 1] : null;
    var salonStart = first ? first.startMin : DEFAULT_OPEN;
    var salonEnd = last ? last.endMin : DEFAULT_CLOSE;
    if (salonEnd <= salonStart) {
      salonStart = DEFAULT_OPEN;
      salonEnd = DEFAULT_CLOSE;
    }
    return {
      dateKey: hours.dateKey,
      locationId: hours.locationId,
      isOpen: hours.isOpen,
      source: hours.source,
      note: hours.note,
      salonStartMin: salonStart,
      salonEndMin: salonEnd,
      startMin: Math.max(0, salonStart - 60),
      endMin: Math.min(24 * 60, salonEnd + 60),
      intervals: hours.intervals
    };
  }

  window.ffBookingAvailability = {
    getEffectiveBusinessHours: getEffectiveBusinessHours,
    getEffectiveProviderAvailability: getEffectiveProviderAvailability,
    isProviderAvailableAt: isProviderAvailableAt,
    canProviderFitDuration: canProviderFitDuration,
    businessAxis: businessAxis,
    resolveEffectiveBusinessHours: resolveEffectiveBusinessHours,
    resolveEffectiveProviderAvailability: resolveEffectiveProviderAvailability,
    intersectIntervals: intersectIntervals,
    INTERVAL_KIND: "scheduledAvailability"
  };
})();
