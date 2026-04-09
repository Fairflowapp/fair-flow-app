import {
  normalizeStaffSchedulingData,
  getDayNameFromDateKey,
  normalizeBusinessHours,
  getEffectiveShiftSegmentsForDay,
  clipTimeWindowToBestShiftSegment,
  clipTimeWindowToUnionOfShiftSegments,
} from "./schedule-helpers.js?v=20260414_segment_union_stagger";

function normalizeDateKey(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [
      value.getUTCFullYear(),
      String(value.getUTCMonth() + 1).padStart(2, "0"),
      String(value.getUTCDate()).padStart(2, "0"),
    ].join("-");
  }
  return "";
}

function parseDateKey(dateKey) {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  return new Date(Date.UTC(year, monthIndex, day));
}

function addUtcDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function normalizeRangeInput(dateRange) {
  if (!dateRange) return { startDate: "", endDate: "" };
  if (Array.isArray(dateRange)) {
    const startDate = normalizeDateKey(dateRange[0]);
    const endDate = normalizeDateKey(dateRange[1] || dateRange[0]);
    return { startDate, endDate };
  }
  if (typeof dateRange === "string" || dateRange instanceof Date) {
    const dateKey = normalizeDateKey(dateRange);
    return { startDate: dateKey, endDate: dateKey };
  }
  const startDate = normalizeDateKey(dateRange.startDate || dateRange.start || dateRange.from);
  const endDate = normalizeDateKey(dateRange.endDate || dateRange.end || dateRange.to || startDate);
  return { startDate, endDate };
}

function enumerateDateRange(dateRange) {
  const { startDate, endDate } = normalizeRangeInput(dateRange);
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  if (!start || !end || start.getTime() > end.getTime()) return [];
  const dates = [];
  for (let cursor = start; cursor.getTime() <= end.getTime(); cursor = addUtcDays(cursor, 1)) {
    dates.push(normalizeDateKey(cursor));
  }
  return dates;
}

function normalizeTimeValue(value) {
  const candidate = String(value || "").trim();
  return /^\d{2}:\d{2}$/.test(candidate) ? candidate : null;
}

function compareTimeValues(a, b) {
  const left = normalizeTimeValue(a);
  const right = normalizeTimeValue(b);
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return left.localeCompare(right);
}

function maxTimeValue(a, b) {
  const left = normalizeTimeValue(a);
  const right = normalizeTimeValue(b);
  if (!left) return right;
  if (!right) return left;
  return compareTimeValues(left, right) >= 0 ? left : right;
}

function minTimeValue(a, b) {
  const left = normalizeTimeValue(a);
  const right = normalizeTimeValue(b);
  if (!left) return right;
  if (!right) return left;
  return compareTimeValues(left, right) <= 0 ? left : right;
}

function normalizeDayName(value) {
  return String(value || "").trim().toLowerCase();
}

function buildDefaultAvailabilityForDate(staff, dateKey, options = {}) {
  const normalizedStaff = normalizeStaffSchedulingData(staff);
  const schedule = normalizedStaff.defaultSchedule || {};
  const dayName = getDayNameFromDateKey(dateKey);
  const daySchedule = dayName && schedule[dayName] && typeof schedule[dayName] === "object"
    ? schedule[dayName]
    : { enabled: false, startTime: null, endTime: null };
  let startTime = normalizeTimeValue(daySchedule.startTime);
  let endTime = normalizeTimeValue(daySchedule.endTime);

  const businessHours = options.businessHours && typeof options.businessHours === "object"
    ? options.businessHours
    : null;
  const bhEntry = dayName && businessHours && businessHours[dayName] ? businessHours[dayName] : null;

  if (daySchedule.enabled === true && (!startTime || !endTime)) {
    if (bhEntry && bhEntry.isOpen === true) {
      const openT = normalizeTimeValue(bhEntry.openTime);
      const closeT = normalizeTimeValue(bhEntry.closeTime);
      if (openT && closeT && compareTimeValues(openT, closeT) < 0) {
        startTime = startTime || openT;
        endTime = endTime || closeT;
      }
    }
    if (!startTime || !endTime) {
      startTime = startTime || normalizeTimeValue("09:00");
      endTime = endTime || normalizeTimeValue("18:00");
    }
  }

  const isAvailable = Boolean(daySchedule.enabled === true && startTime && endTime && compareTimeValues(startTime, endTime) < 0);
  return {
    isAvailable,
    startTime: isAvailable ? startTime : null,
    endTime: isAvailable ? endTime : null,
    source: "default_schedule",
  };
}

/**
 * When defaultSchedule has this weekday off but Inbox has approved late_start / early_leave only,
 * use salon business hours (or 09:00–18:00) as the baseline window so partial overrides can apply.
 * Full-day blocks (vacation, etc.) keep the default "off" row.
 */
function resolveDefaultAvailabilityForOverrides(staff, dateKey, businessHours, dayOverrides) {
  const bh = businessHours && typeof businessHours === "object" ? businessHours : null;
  const base = buildDefaultAvailabilityForDate(staff, dateKey, { businessHours: bh });
  const overrides = Array.isArray(dayOverrides) ? dayOverrides : [];
  const hasBlocking = overrides.some((o) => o && o.mode === "unavailable");
  const hasPartial = overrides.some((o) => o && (o.mode === "late_start" || o.mode === "early_leave"));
  if (base.isAvailable || hasBlocking || !hasPartial) {
    return base;
  }
  const dayName = getDayNameFromDateKey(dateKey);
  const bhEntry = dayName && bh && bh[dayName] ? bh[dayName] : null;
  let startTime = null;
  let endTime = null;
  if (bhEntry && bhEntry.isOpen === true) {
    startTime = normalizeTimeValue(bhEntry.openTime);
    endTime = normalizeTimeValue(bhEntry.closeTime);
  }
  if (!startTime || !endTime || compareTimeValues(startTime, endTime) >= 0) {
    startTime = normalizeTimeValue("09:00");
    endTime = normalizeTimeValue("18:00");
  }
  return {
    isAvailable: true,
    startTime,
    endTime,
    source: "default_schedule",
  };
}

function normalizeRequestType(type) {
  return String(type || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isScheduleAvailabilityRequestType(type) {
  const t = normalizeRequestType(type);
  const x = t === "time_off" ? "day_off" : t;
  return ["vacation", "day_off", "late_start", "early_leave", "schedule_change"].includes(x);
}

/**
 * Approved schedule items still apply after "archive" (status becomes archived).
 * Also treat "done" like approved for calendar purposes.
 */
function isApprovedRequest(request) {
  const s = String(request?.status || "").trim().toLowerCase();
  if (s === "approved" || s === "done") return true;
  if (s === "archived") {
    const p = String(request?.previousStatus || "").trim().toLowerCase();
    if (p === "approved" || p === "done") return true;
    // Legacy: archived before we stored previousStatus — keep schedule impact for schedule request types
    if (!p && isScheduleAvailabilityRequestType(request?.type)) return true;
    return false;
  }
  return false;
}

function getStaffIdentity(staff) {
  return {
    uid: String(staff?.uid || staff?.userUid || "").trim(),
    staffId: String(staff?.staffId || staff?.id || "").trim(),
    email: String(staff?.email || "").trim().toLowerCase(),
    name: String(staff?.name || "").trim().toLowerCase(),
  };
}

/**
 * Which staff member this approved schedule request applies to.
 * Inbox may set forUid to the approver/recipient while createdByUid is the requester — both must NOT match.
 */
function requestMatchesStaff(request, staff) {
  const identity = getStaffIdentity(staff);
  const createdByUid = String(request?.createdByUid || "").trim();
  const createdByStaffId = String(request?.createdByStaffId || "").trim();
  const forUid = String(request?.forUid || "").trim();
  const forStaffId = String(request?.forStaffId || "").trim();
  const createdByName = String(request?.createdByName || "").trim().toLowerCase();
  const forStaffName = String(request?.forStaffName || "").trim().toLowerCase();
  const data = request?.data && typeof request.data === "object" ? request.data : {};
  const subjectUid = String(data.subjectUid || "").trim();
  const subjectStaffId = String(data.subjectStaffId || "").trim();

  if (subjectUid || subjectStaffId) {
    if (identity.uid && subjectUid && identity.uid === subjectUid) return true;
    if (identity.staffId && subjectStaffId && identity.staffId === subjectStaffId) return true;
    return false;
  }

  const sched = isScheduleAvailabilityRequestType(request?.type);
  if (sched && createdByUid && forUid && createdByUid !== forUid) {
    if (identity.uid && identity.uid === createdByUid) return true;
    if (identity.staffId && createdByStaffId && identity.staffId === createdByStaffId) return true;
    if (!identity.uid && !identity.staffId && identity.email) {
      const createdByEmail = String(request?.createdByEmail || request?.email || "").trim().toLowerCase();
      if (createdByEmail && createdByEmail === identity.email) return true;
    }
    if (!identity.uid && !identity.staffId && identity.name && createdByName && createdByName === identity.name) return true;
    return false;
  }

  if (identity.uid && (createdByUid === identity.uid || forUid === identity.uid)) return true;
  if (identity.staffId && (createdByStaffId === identity.staffId || forStaffId === identity.staffId)) return true;
  if (!identity.uid && !identity.staffId && identity.email) {
    const createdByEmail = String(request?.createdByEmail || request?.email || "").trim().toLowerCase();
    if (createdByEmail && createdByEmail === identity.email) return true;
  }
  if (!identity.uid && !identity.staffId && identity.name) {
    if (createdByName && createdByName === identity.name) return true;
    if (forStaffName && forStaffName === identity.name) return true;
  }
  return false;
}

function buildRequestDateKeys(request) {
  const data = request?.data && typeof request.data === "object" ? request.data : {};
  let type = normalizeRequestType(request?.type);
  if (type === "time_off") type = "day_off";

  if (type === "vacation") {
    return enumerateDateRange({ startDate: data.startDate, endDate: data.endDate });
  }

  if (type === "day_off") {
    const explicitDate = normalizeDateKey(data.date);
    if (explicitDate) return [explicitDate];
    return enumerateDateRange({ startDate: data.startDate, endDate: data.endDate });
  }

  if (type === "schedule_change") {
    const ad = data.affectedDates;
    if (Array.isArray(ad) && ad.length > 0) {
      return ad.map((d) => normalizeDateKey(d)).filter(Boolean);
    }
    const range = enumerateDateRange({ startDate: data.startDate, endDate: data.endDate || data.startDate });
    return range.length > 0 ? range : [];
  }

  const singleDate = normalizeDateKey(data.date);
  return singleDate ? [singleDate] : [];
}

function getRequestOverrideInfo(request, dateKey) {
  let type = normalizeRequestType(request?.type);
  if (type === "time_off") type = "day_off";
  const data = request?.data && typeof request.data === "object" ? request.data : {};
  const dates = buildRequestDateKeys(request);
  if (!dates.includes(dateKey)) return null;

  if (type === "vacation" || type === "day_off") {
    return {
      type,
      mode: "unavailable",
      date: dateKey,
      requestId: request?.id || request?.requestId || null,
      requestedTime: null,
      request,
    };
  }

  if (type === "schedule_change") {
    return {
      type: "schedule_change",
      mode: "unavailable",
      date: dateKey,
      requestId: request?.id || request?.requestId || null,
      requestedTime: null,
      request,
    };
  }

  if (type === "late_start") {
    return {
      type,
      mode: "late_start",
      date: dateKey,
      requestId: request?.id || request?.requestId || null,
      requestedTime: normalizeTimeValue(data.requestedTime || data.time || data.startTime),
      request,
    };
  }

  if (type === "early_leave") {
    return {
      type,
      mode: "early_leave",
      date: dateKey,
      requestId: request?.id || request?.requestId || null,
      requestedTime: normalizeTimeValue(data.requestedTime || data.time || data.endTime),
      request,
    };
  }

  return null;
}

function getApprovedAvailabilityOverrides(staff, requests, dateRange) {
  const dateKeys = new Set(enumerateDateRange(dateRange));
  const overridesByDate = {};

  (Array.isArray(requests) ? requests : []).forEach((request) => {
    if (!isApprovedRequest(request) || !requestMatchesStaff(request, staff)) return;
    const requestDates = buildRequestDateKeys(request).filter((dateKey) => dateKeys.has(dateKey));
    requestDates.forEach((dateKey) => {
      const override = getRequestOverrideInfo(request, dateKey);
      if (!override) return;
      if (!overridesByDate[dateKey]) overridesByDate[dateKey] = [];
      overridesByDate[dateKey].push(override);
    });
  });

  return overridesByDate;
}

function applyAvailabilityOverrides(defaultAvailability, overrides) {
  const normalizedOverrides = Array.isArray(overrides) ? overrides : [];
  const result = {
    ...defaultAvailability,
    overrideApplied: false,
    hasApprovedOverride: normalizedOverrides.length > 0,
    overrideTypes: normalizedOverrides.map((override) => override.type),
    overrides: normalizedOverrides,
  };

  if (!result.isAvailable) {
    return result;
  }

  const blockingOverride = normalizedOverrides.find((override) => override.mode === "unavailable");
  if (blockingOverride) {
    return {
      ...result,
      isAvailable: false,
      startTime: null,
      endTime: null,
      overrideApplied: true,
      overrideTypes: normalizedOverrides.map((override) => override.type),
    };
  }

  let nextStart = result.startTime;
  let nextEnd = result.endTime;

  normalizedOverrides.forEach((override) => {
    if (override.mode === "late_start" && override.requestedTime) {
      nextStart = maxTimeValue(nextStart, override.requestedTime);
    } else if (override.mode === "early_leave" && override.requestedTime) {
      nextEnd = minTimeValue(nextEnd, override.requestedTime);
    }
  });

  const hasValidWindow = normalizeTimeValue(nextStart) && normalizeTimeValue(nextEnd) && compareTimeValues(nextStart, nextEnd) < 0;
  return {
    ...result,
    isAvailable: Boolean(hasValidWindow),
    startTime: hasValidWindow ? nextStart : null,
    endTime: hasValidWindow ? nextEnd : null,
    overrideApplied: hasValidWindow ? (nextStart !== result.startTime || nextEnd !== result.endTime) : normalizedOverrides.length > 0,
  };
}

function clipDailyAvailabilityToShiftSegments(applied, dateKey, options) {
  if (!applied?.isAvailable || !applied.startTime || !applied.endTime) return applied;
  const bh = options.businessHours ? normalizeBusinessHours(options.businessHours) : null;
  if (!bh) return applied;
  const dayName = getDayNameFromDateKey(dateKey);
  if (!dayName) return applied;
  const segs = getEffectiveShiftSegmentsForDay(dayName, bh, options.dayShiftSegments);
  const clipped =
    Array.isArray(segs) && segs.length > 1
      ? clipTimeWindowToUnionOfShiftSegments(applied.startTime, applied.endTime, segs)
      : clipTimeWindowToBestShiftSegment(applied.startTime, applied.endTime, segs);
  if (!clipped) {
    return {
      ...applied,
      isAvailable: false,
      startTime: null,
      endTime: null,
      overrideApplied: true,
    };
  }
  const startChanged = String(clipped.startTime) !== String(applied.startTime || "").trim();
  const endChanged = String(clipped.endTime) !== String(applied.endTime || "").trim();
  return {
    ...applied,
    startTime: clipped.startTime,
    endTime: clipped.endTime,
    overrideApplied: applied.overrideApplied === true || startChanged || endChanged,
  };
}

function getEffectiveAvailabilityForDate(staff, requests, dateKey, options = {}) {
  const normalizedDate = normalizeDateKey(dateKey);
  if (!normalizedDate) {
    return {
      date: "",
      isAvailable: false,
      startTime: null,
      endTime: null,
      hasApprovedOverride: false,
      overrideApplied: false,
      overrideTypes: [],
      overrides: [],
      source: "default_schedule",
    };
  }

  const bhNormalized = options.businessHours
    ? normalizeBusinessHours(options.businessHours)
    : null;
  const overridesByDate = getApprovedAvailabilityOverrides(staff, requests, { startDate: normalizedDate, endDate: normalizedDate });
  const dayOverrides = overridesByDate[normalizedDate] || [];
  const defaultAvailability = resolveDefaultAvailabilityForOverrides(
    staff,
    normalizedDate,
    bhNormalized,
    dayOverrides,
  );
  let applied = applyAvailabilityOverrides(defaultAvailability, dayOverrides);
  applied = clipDailyAvailabilityToShiftSegments(applied, normalizedDate, options);
  return {
    date: normalizedDate,
    isAvailable: applied.isAvailable,
    startTime: applied.startTime,
    endTime: applied.endTime,
    hasApprovedOverride: applied.hasApprovedOverride,
    overrideApplied: applied.overrideApplied,
    overrideTypes: applied.overrideTypes,
    overrides: applied.overrides,
    source: applied.source,
  };
}

function getEffectiveAvailability(staff, requests, dateRange, options = {}) {
  const dates = enumerateDateRange(dateRange);
  const overridesByDate = getApprovedAvailabilityOverrides(staff, requests, dateRange);
  const bhNormalized = options.businessHours
    ? normalizeBusinessHours(options.businessHours)
    : null;
  const availability = dates.map((dateKey) => {
    const dayOverrides = overridesByDate[dateKey] || [];
    const defaultAvailability = resolveDefaultAvailabilityForOverrides(staff, dateKey, bhNormalized, dayOverrides);
    let applied = applyAvailabilityOverrides(defaultAvailability, dayOverrides);
    applied = clipDailyAvailabilityToShiftSegments(applied, dateKey, options);
    return {
      date: dateKey,
      isAvailable: applied.isAvailable,
      startTime: applied.startTime,
      endTime: applied.endTime,
      hasApprovedOverride: applied.hasApprovedOverride,
      overrideApplied: applied.overrideApplied,
      overrideTypes: applied.overrideTypes,
      overrides: applied.overrides,
      source: applied.source,
    };
  });

  return {
    staffId: String(staff?.staffId || staff?.id || "").trim() || null,
    uid: String(staff?.uid || staff?.userUid || "").trim() || null,
    startDate: dates[0] || null,
    endDate: dates[dates.length - 1] || null,
    days: availability,
    byDate: availability.reduce((acc, day) => {
      acc[day.date] = day;
      return acc;
    }, {}),
  };
}

function getSupportedAvailabilityRequestTypes() {
  return ["vacation", "day_off", "time_off", "late_start", "early_leave", "schedule_change"];
}

/**
 * Raw Inbox approvals for this staff + date (does not merge overrides).
 * Use for UI labels so a late_start on a day is never hidden behind an unrelated full-day row.
 */
function getInboxApprovalDisplayForDate(staff, requests, dateKey) {
  const normalized = normalizeDateKey(dateKey);
  const empty = {
    hasFullDayRequest: false,
    lateStart: null,
    earlyLeave: null,
    hasConflict: false,
  };
  if (!normalized) return empty;

  let hasFullDayRequest = false;
  let lateStart = null;
  let earlyLeave = null;

  (Array.isArray(requests) ? requests : []).forEach((req) => {
    if (!isApprovedRequest(req) || !requestMatchesStaff(req, staff)) return;
    const keys = buildRequestDateKeys(req);
    if (!keys.includes(normalized)) return;

    let t = normalizeRequestType(req?.type);
    if (t === "time_off") t = "day_off";

    if (t === "vacation" || t === "day_off" || t === "schedule_change") {
      hasFullDayRequest = true;
    }

    const data = req?.data && typeof req.data === "object" ? req.data : {};
    if (t === "late_start") {
      const lt = normalizeTimeValue(data.requestedTime || data.time || data.startTime);
      if (lt) lateStart = lt;
    }
    if (t === "early_leave") {
      const et = normalizeTimeValue(data.requestedTime || data.time || data.endTime);
      if (et) earlyLeave = et;
    }
  });

  const hasPartial = Boolean(lateStart || earlyLeave);
  return {
    hasFullDayRequest,
    lateStart,
    earlyLeave,
    hasConflict: Boolean(hasFullDayRequest && hasPartial),
  };
}

const scheduleAvailabilityHelpers = {
  normalizeDateKey,
  enumerateDateRange,
  isApprovedRequest,
  requestMatchesStaff,
  getApprovedAvailabilityOverrides,
  getEffectiveAvailabilityForDate,
  getEffectiveAvailability,
  getSupportedAvailabilityRequestTypes,
  getInboxApprovalDisplayForDate,
};

if (typeof window !== "undefined") {
  window.ffScheduleAvailability = scheduleAvailabilityHelpers;
  window.getEffectiveAvailability = getEffectiveAvailability;
}

export {
  normalizeDateKey,
  enumerateDateRange,
  isApprovedRequest,
  requestMatchesStaff,
  getApprovedAvailabilityOverrides,
  getEffectiveAvailabilityForDate,
  getEffectiveAvailability,
  getSupportedAvailabilityRequestTypes,
  getInboxApprovalDisplayForDate,
};
