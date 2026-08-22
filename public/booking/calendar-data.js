/**
 * Booking Calendar data adapters.
 * Reuses Fair Flow staff, locations, and schedule helpers. No new collections.
 *
 * Bookable provider assumption (single filter — do not copy this elsewhere):
 * A Calendar column is a non-archived staff member who can perform services
 * (has technicianTypes, or manager/admin queueJoinAsTechnicianTypes).
 * Owners/admins with no service types are excluded.
 * If the active location is set and allowedLocationIds is a non-empty list,
 * the staff member must include that location.
 *
 * Working hours come from the canonical Booking availability engine
 * (ffBookingAvailability). That engine composes Operations business hours,
 * specialBusinessDays, location-aware defaultSchedule, and approved Inbox
 * schedule exceptions. Appointment conflicts are out of scope for V1.
 */
(function () {
  var DEFAULT_OPEN = 9 * 60;
  var DEFAULT_CLOSE = 18 * 60;
  var AXIS_PAD_MINUTES = 60;
  var DAY_END = 24 * 60;

  function helpers() {
    return window.ffScheduleHelpers || null;
  }

  function readStaffList() {
    try {
      if (typeof window.ffGetStaffStore === "function") {
        var store = window.ffGetStaffStore();
        if (store && Array.isArray(store.staff)) return store.staff;
      }
    } catch (_) {}
    try {
      var raw = JSON.parse(localStorage.getItem("ff_staff_v1") || "{}");
      if (Array.isArray(raw.staff)) return raw.staff;
    } catch (_) {}
    return [];
  }

  function currentLocationId() {
    try {
      if (typeof window.ffGetActiveLocationId === "function") {
        return String(window.ffGetActiveLocationId() || "").trim();
      }
    } catch (_) {}
    try {
      return String(window.__ff_active_location_id || "").trim();
    } catch (_) {
      return "";
    }
  }

  function firstNameOf(staff) {
    var raw = String((staff && (staff.name || staff.firstName)) || "").trim();
    if (!raw) return "Staff";
    return raw.split(/\s+/)[0];
  }

  function serviceTypeIds(staff) {
    if (!staff || typeof staff !== "object") return [];
    var role = String(staff.role || "").toLowerCase().trim();
    var isLead = staff.isManager === true || staff.isAdmin === true
      || role === "manager" || role === "admin" || role === "owner";
    var source = isLead && Array.isArray(staff.queueJoinAsTechnicianTypes)
      && staff.queueJoinAsTechnicianTypes.length
      ? staff.queueJoinAsTechnicianTypes
      : staff.technicianTypes;
    return (Array.isArray(source) ? source : [])
      .map(function (id) { return String(id || "").trim(); })
      .filter(Boolean);
  }

  function isBookableProvider(staff, locationId) {
    if (!staff || typeof staff !== "object") return false;
    if (staff.isArchived === true || staff.archived === true) return false;
    if (staff.active === false || staff.isActive === false) return false;
    if (!String(staff.name || staff.firstName || "").trim()) return false;
    if (!serviceTypeIds(staff).length) return false;
    var loc = String(locationId || "").trim();
    if (!loc) return true;
    var allowed = Array.isArray(staff.allowedLocationIds) ? staff.allowedLocationIds : [];
    if (!allowed.length) return true;
    return allowed.indexOf(loc) !== -1;
  }

  function parseMinutes(value, helpersApi) {
    if (helpersApi && typeof helpersApi.parseScheduleTimeToMinutes === "function") {
      var parsed = helpersApi.parseScheduleTimeToMinutes(value);
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

  function dayIsEnabled(day) {
    if (!day || typeof day !== "object") return false;
    return day.enabled === true || day.enabled === 1 || String(day.enabled).toLowerCase() === "true";
  }

  function businessWindowForDay(dayKey) {
    var map = readBusinessHoursMap();
    var entry = map && dayKey ? map[dayKey] : null;
    var api = helpers();
    var start = entry ? parseMinutes(entry.openTime, api) : null;
    var end = entry ? parseMinutes(entry.closeTime, api) : null;
    if (entry && entry.isOpen && start != null && end != null && end > start) {
      return { startMin: start, endMin: end };
    }
    return { startMin: DEFAULT_OPEN, endMin: DEFAULT_CLOSE };
  }

  function scheduleHasEnabledDay(sched) {
    if (!sched || typeof sched !== "object") return false;
    return Object.keys(sched).some(function (key) {
      return dayIsEnabled(sched[key]);
    });
  }

  function inheritSalonWindow(dayKey) {
    var map = readBusinessHoursMap();
    var entry = map && dayKey ? map[dayKey] : null;
    if (!entry || !entry.isOpen) return [];
    var win = businessWindowForDay(dayKey);
    if (win.startMin == null || win.endMin == null || win.endMin <= win.startMin) return [];
    return [{ startMin: win.startMin, endMin: win.endMin }];
  }

  function intervalsToWindows(intervals) {
    return (intervals || []).map(function (win) {
      return { startMin: win.startMin, endMin: win.endMin };
    }).filter(function (win) {
      return Number.isFinite(win.startMin) && Number.isFinite(win.endMin) && win.endMin > win.startMin;
    });
  }

  function workingWindowsFor(staff, dateKey, locationId) {
    var engine = window.ffBookingAvailability;
    if (engine && typeof engine.resolveEffectiveProviderAvailability === "function") {
      var resolved = engine.resolveEffectiveProviderAvailability(
        staff && (staff.id || staff.staffId),
        dateKey,
        locationId,
        { staff: staff }
      );
      return intervalsToWindows(resolved && resolved.intervals);
    }
    var api = helpers();
    var time = window.ffBookingTime;
    var dayKey = time ? time.weekdayKey(dateKey) : "";
    if (!dayKey) return [];
    var sched = null;
    if (api && typeof api.getStaffDefaultScheduleForLocation === "function") {
      sched = api.getStaffDefaultScheduleForLocation(staff, locationId);
    } else if (staff && staff.defaultSchedule) {
      sched = staff.defaultSchedule;
    }
    if (api && sched && typeof api.normalizeDefaultSchedule === "function") {
      sched = api.normalizeDefaultSchedule(sched);
    }
    var day = sched && sched[dayKey] ? sched[dayKey] : null;
    if (!dayIsEnabled(day)) {
      return scheduleHasEnabledDay(sched) ? [] : inheritSalonWindow(dayKey);
    }
    var start = parseMinutes(day.startTime, api);
    var end = parseMinutes(day.endTime, api);
    if (start == null || end == null || end <= start) {
      var fallback = businessWindowForDay(dayKey);
      start = start == null ? fallback.startMin : start;
      end = end == null || end <= start ? fallback.endMin : end;
    }
    if (start == null || end == null || end <= start) return inheritSalonWindow(dayKey);
    return [{ startMin: start, endMin: end }];
  }

  function salonClosedWindows(axisStartMin, axisEndMin, salonStartMin, salonEndMin, isOpen, intervals) {
    var axisStart = Number(axisStartMin);
    var axisEnd = Number(axisEndMin);
    if (!isOpen) return [{ startMin: axisStart, endMin: axisEnd }];
    if (Array.isArray(intervals) && intervals.length) {
      return unavailableWindows(intervals, axisStart, axisEnd);
    }
    var salonStart = Number(salonStartMin);
    var salonEnd = Number(salonEndMin);
    var out = [];
    if (salonStart > axisStart) out.push({ startMin: axisStart, endMin: salonStart });
    if (salonEnd < axisEnd) out.push({ startMin: salonEnd, endMin: axisEnd });
    return out;
  }

  function employeeOffWindows(working, salonStartMin, salonEndMin, isOpen) {
    if (!isOpen) return [];
    return unavailableWindows(working, salonStartMin, salonEndMin);
  }

  function unavailableWindows(working, axisStartMin, axisEndMin) {
    var start = Number(axisStartMin);
    var end = Number(axisEndMin);
    var windows = (working || [])
      .map(function (w) {
        return {
          startMin: Math.max(w.startMin, start),
          endMin: Math.min(w.endMin, end)
        };
      })
      .filter(function (w) { return w.endMin > w.startMin; })
      .sort(function (a, b) { return a.startMin - b.startMin; });
    if (!windows.length) return [{ startMin: start, endMin: end }];
    var out = [];
    var cursor = start;
    windows.forEach(function (w) {
      if (w.startMin > cursor) out.push({ startMin: cursor, endMin: w.startMin });
      cursor = Math.max(cursor, w.endMin);
    });
    if (cursor < end) out.push({ startMin: cursor, endMin: end });
    return out;
  }

  function readBusinessHoursMap() {
    var api = helpers();
    var locId = currentLocationId();
    var settings = (window.settings && typeof window.settings === "object") ? window.settings : {};
    var locBucket = locId && settings.locationSchedules && settings.locationSchedules[locId];
    var raw = (locBucket && locBucket.businessHours) || settings.businessHours || null;
    if (!raw) {
      try {
        var stored = JSON.parse(localStorage.getItem("ffv24_settings") || "{}");
        raw = stored && stored.businessHours ? stored.businessHours : null;
      } catch (_) {}
    }
    if (api && typeof api.normalizeBusinessHours === "function" && raw) {
      return api.normalizeBusinessHours(raw);
    }
    return raw && typeof raw === "object" ? raw : null;
  }

  function businessDayFor(dateKey, locationId) {
    var engine = window.ffBookingAvailability;
    var loc = String(locationId || currentLocationId() || "").trim();
    if (engine && typeof engine.businessAxis === "function") {
      var axis = engine.businessAxis(dateKey, loc);
      var time = window.ffBookingTime;
      return {
        dayKey: time ? time.weekdayKey(dateKey) : "",
        isOpen: !!axis.isOpen,
        salonStartMin: axis.salonStartMin,
        salonEndMin: axis.salonEndMin,
        startMin: axis.startMin,
        endMin: axis.endMin,
        intervals: axis.intervals || [],
        source: axis.source,
        usedDefault: false
      };
    }
    var timeLegacy = window.ffBookingTime;
    var dayKey = timeLegacy ? timeLegacy.weekdayKey(dateKey) : "";
    var map = readBusinessHoursMap();
    var entry = map && dayKey ? map[dayKey] : null;
    var api = helpers();
    var start = entry ? parseMinutes(entry.openTime, api) : null;
    var end = entry ? parseMinutes(entry.closeTime, api) : null;
    var isOpen = !!(entry && entry.isOpen && start != null && end != null && end > start);
    var salonStart = start != null ? start : DEFAULT_OPEN;
    var salonEnd = end != null && end > salonStart ? end : DEFAULT_CLOSE;
    if (salonEnd <= salonStart) {
      salonStart = DEFAULT_OPEN;
      salonEnd = DEFAULT_CLOSE;
    }
    var axisStart = Math.max(0, salonStart - AXIS_PAD_MINUTES);
    var axisEnd = Math.min(DAY_END, salonEnd + AXIS_PAD_MINUTES);
    if (axisEnd <= axisStart) {
      axisStart = Math.max(0, salonStart - AXIS_PAD_MINUTES);
      axisEnd = Math.min(DAY_END, salonEnd + AXIS_PAD_MINUTES);
    }
    return {
      dayKey: dayKey,
      isOpen: isOpen,
      salonStartMin: salonStart,
      salonEndMin: salonEnd,
      startMin: axisStart,
      endMin: axisEnd,
      intervals: isOpen ? [{ startMin: salonStart, endMin: salonEnd }] : [],
      usedDefault: start == null || end == null
    };
  }

  function loadCalendarEmployees(dateKey, locationId) {
    var loc = String(locationId || currentLocationId() || "").trim();
    var list = readStaffList().filter(function (staff) {
      return isBookableProvider(staff, loc);
    }).map(function (staff) {
      var working = workingWindowsFor(staff, dateKey, loc);
      return {
        id: String(staff.id || staff.staffId || staff.name || ""),
        firstName: firstNameOf(staff),
        name: String(staff.name || staff.firstName || "").trim(),
        photoURL: String(staff.avatarUrl || staff.photoURL || staff.photoUrl || staff.imageUrl || "").trim(),
        working: working
      };
    }).filter(function (row) {
      return !!row.id;
    }).sort(function (a, b) {
      return a.firstName.localeCompare(b.firstName);
    });
    return list;
  }

  window.ffBookingCalData = {
    currentLocationId: currentLocationId,
    isBookableProvider: isBookableProvider,
    firstNameOf: firstNameOf,
    workingWindowsFor: workingWindowsFor,
    unavailableWindows: unavailableWindows,
    salonClosedWindows: salonClosedWindows,
    employeeOffWindows: employeeOffWindows,
    businessDayFor: businessDayFor,
    loadCalendarEmployees: loadCalendarEmployees,
    AXIS_PAD_MINUTES: AXIS_PAD_MINUTES
  };
})();
