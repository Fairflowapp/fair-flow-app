import {
  normalizeStaffSchedulingData,
  getDayNameFromDateKey,
  normalizeBusinessHours,
} from "./schedule-helpers.js?v=20260403_reception_split";

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

function normalizeRequestType(type) {
  return String(type || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isApprovedRequest(request) {
  return String(request?.status || "").trim().toLowerCase() === "approved";
}

function getStaffIdentity(staff) {
  return {
    uid: String(staff?.uid || staff?.userUid || "").trim(),
    staffId: String(staff?.staffId || staff?.id || "").trim(),
    email: String(staff?.email || "").trim().toLowerCase(),
    name: String(staff?.name || "").trim().toLowerCase(),
  };
}

function requestMatchesStaff(request, staff) {
  const identity = getStaffIdentity(staff);
  const createdByUid = String(request?.createdByUid || "").trim();
  const createdByStaffId = String(request?.createdByStaffId || "").trim();
  const forUid = String(request?.forUid || "").trim();
  const forStaffId = String(request?.forStaffId || "").trim();
  const createdByName = String(request?.createdByName || "").trim().toLowerCase();
  const forStaffName = String(request?.forStaffName || "").trim().toLowerCase();

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
  const type = normalizeRequestType(request?.type);

  if (type === "vacation") {
    return enumerateDateRange({ startDate: data.startDate, endDate: data.endDate });
  }

  if (type === "day_off") {
    const explicitDate = normalizeDateKey(data.date);
    if (explicitDate) return [explicitDate];
    return enumerateDateRange({ startDate: data.startDate, endDate: data.endDate });
  }

  const singleDate = normalizeDateKey(data.date);
  return singleDate ? [singleDate] : [];
}

function getRequestOverrideInfo(request, dateKey) {
  const type = normalizeRequestType(request?.type);
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
  const defaultAvailability = buildDefaultAvailabilityForDate(staff, normalizedDate, { businessHours: bhNormalized });
  const overridesByDate = getApprovedAvailabilityOverrides(staff, requests, { startDate: normalizedDate, endDate: normalizedDate });
  const applied = applyAvailabilityOverrides(defaultAvailability, overridesByDate[normalizedDate] || []);
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
    const defaultAvailability = buildDefaultAvailabilityForDate(staff, dateKey, { businessHours: bhNormalized });
    const applied = applyAvailabilityOverrides(defaultAvailability, overridesByDate[dateKey] || []);
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
  return ["vacation", "day_off", "late_start", "early_leave"];
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
};
