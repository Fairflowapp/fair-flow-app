const DAY_KEYS = Object.freeze([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

const DEFAULT_DAY_SCHEDULE = Object.freeze({
  enabled: false,
  startTime: null,
  endTime: null,
});

const DEFAULT_DEFAULT_SCHEDULE = Object.freeze(
  DAY_KEYS.reduce((acc, dayKey) => {
    acc[dayKey] = DEFAULT_DAY_SCHEDULE;
    return acc;
  }, {})
);

const DEFAULT_CONSTRAINTS = Object.freeze({
  cannotWorkAlone: false,
  requiresManager: false,
  maxWeeklyHours: null,
});

const DEFAULT_MANAGER_TYPE = "manager";
const DEFAULT_EMPLOYMENT_TYPE = null;

const DEFAULT_ROLES_HIERARCHY = Object.freeze({
  manager: 3,
  assistant_manager: 2,
  technician: 1,
  front_desk: 1,
});

const DEFAULT_SCHEDULE_RULES = Object.freeze({
  minManagersPerShift: 1,
  minFrontDeskPerDay: 0,
  minTechniciansPerDay: 0,
  minTotalStaffPerDay: 0,
  allowAssistantManagerAlone: false,
});

const DEFAULT_DAY_BUSINESS_HOURS = Object.freeze({
  isOpen: false,
  openTime: null,
  closeTime: null,
});

const DEFAULT_BUSINESS_HOURS = Object.freeze(
  DAY_KEYS.reduce((acc, dayKey) => {
    acc[dayKey] = {
      isOpen: ["monday", "tuesday", "wednesday", "thursday", "friday"].includes(dayKey),
      openTime: ["monday", "tuesday", "wednesday", "thursday", "friday"].includes(dayKey) ? "09:00" : null,
      closeTime: ["monday", "tuesday", "wednesday", "thursday", "friday"].includes(dayKey) ? "18:00" : null,
    };
    return acc;
  }, {})
);

const DEFAULT_DAY_COVERAGE_RULES = Object.freeze({
  minTotalStaff: 0,
  minManagers: 0,
  minFrontDesk: 0,
  minTechnicians: 0,
});

const DEFAULT_COVERAGE_RULES = Object.freeze(
  DAY_KEYS.reduce((acc, dayKey) => {
    acc[dayKey] = DEFAULT_DAY_COVERAGE_RULES;
    return acc;
  }, {})
);

const DEFAULT_SPECIAL_BUSINESS_DAYS = Object.freeze({});

function cloneDefaultSchedule() {
  return DAY_KEYS.reduce((acc, dayKey) => {
    acc[dayKey] = {
      enabled: DEFAULT_DAY_SCHEDULE.enabled,
      startTime: DEFAULT_DAY_SCHEDULE.startTime,
      endTime: DEFAULT_DAY_SCHEDULE.endTime,
    };
    return acc;
  }, {});
}

function cloneDefaultConstraints() {
  return {
    cannotWorkAlone: DEFAULT_CONSTRAINTS.cannotWorkAlone,
    requiresManager: DEFAULT_CONSTRAINTS.requiresManager,
    maxWeeklyHours: DEFAULT_CONSTRAINTS.maxWeeklyHours,
  };
}

function cloneDefaultRolesHierarchy() {
  return { ...DEFAULT_ROLES_HIERARCHY };
}

function cloneDefaultScheduleRules() {
  return { ...DEFAULT_SCHEDULE_RULES };
}

function cloneDefaultBusinessHours() {
  return DAY_KEYS.reduce((acc, dayKey) => {
    acc[dayKey] = {
      isOpen: DEFAULT_BUSINESS_HOURS[dayKey].isOpen,
      openTime: DEFAULT_BUSINESS_HOURS[dayKey].openTime,
      closeTime: DEFAULT_BUSINESS_HOURS[dayKey].closeTime,
    };
    return acc;
  }, {});
}

function cloneDefaultCoverageRules() {
  return DAY_KEYS.reduce((acc, dayKey) => {
    acc[dayKey] = {
      minTotalStaff: DEFAULT_DAY_COVERAGE_RULES.minTotalStaff,
      minManagers: DEFAULT_DAY_COVERAGE_RULES.minManagers,
      minFrontDesk: DEFAULT_DAY_COVERAGE_RULES.minFrontDesk,
      minTechnicians: DEFAULT_DAY_COVERAGE_RULES.minTechnicians,
    };
    return acc;
  }, {});
}

function cloneDefaultSpecialBusinessDays() {
  return {};
}

function normalizeDay(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeDayScheduleEntry(value, fallback = DEFAULT_DAY_SCHEDULE) {
  const source = value && typeof value === "object" ? value : {};
  return {
    enabled: source.enabled === true,
    startTime: normalizeTimeString(source.startTime, fallback.startTime),
    endTime: normalizeTimeString(source.endTime, fallback.endTime),
  };
}

function normalizeTimeString(value, fallback) {
  const candidate = String(value || "").trim();
  return /^\d{2}:\d{2}$/.test(candidate) ? candidate : fallback;
}

function normalizeBusinessDayEntry(value, fallback = DEFAULT_DAY_BUSINESS_HOURS) {
  const source = value && typeof value === "object" ? value : {};
  let isOpen = source.isOpen === true;
  let openTime = normalizeTimeString(source.openTime, fallback.openTime);
  let closeTime = normalizeTimeString(source.closeTime, fallback.closeTime);

  const o = parseScheduleTimeToMinutes(openTime);
  let c = parseScheduleTimeToMinutes(closeTime);

  if (isOpen && o != null && c != null && c <= o) {
    const cEvening = c + 12 * 60;
    if (cEvening > o && cEvening < 24 * 60) {
      closeTime = formatMinutesAsScheduleTime(cEvening);
      c = cEvening;
    } else {
      const openSwapped = normalizeTimeString(source.closeTime, fallback.closeTime);
      const closeSwapped = normalizeTimeString(source.openTime, fallback.openTime);
      const o2 = parseScheduleTimeToMinutes(openSwapped);
      const c2 = parseScheduleTimeToMinutes(closeSwapped);
      if (o2 != null && c2 != null && c2 > o2) {
        openTime = openSwapped;
        closeTime = closeSwapped;
      } else {
        isOpen = false;
      }
    }
  }

  return {
    isOpen,
    openTime,
    closeTime,
  };
}

function normalizeSpecialBusinessDayEntry(value) {
  const source = value && typeof value === "object" ? value : {};
  const isClosed = source.isClosed === true;
  if (isClosed) {
    return {
      isClosed: true,
      openTime: null,
      closeTime: null,
      note: String(source.note || "").trim(),
    };
  }
  let openTime = normalizeTimeString(source.openTime, null);
  let closeTime = normalizeTimeString(source.closeTime, null);
  const o = parseScheduleTimeToMinutes(openTime);
  const c = parseScheduleTimeToMinutes(closeTime);
  if (o != null && c != null && c <= o) {
    const cEvening = c + 12 * 60;
    if (cEvening > o && cEvening < 24 * 60) {
      closeTime = formatMinutesAsScheduleTime(cEvening);
    }
  }
  return {
    isClosed: false,
    openTime,
    closeTime,
    note: String(source.note || "").trim(),
  };
}

function isValidDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function normalizeRoleKey(value) {
  const role = String(value || "").trim().toLowerCase();
  if (!role) return "";
  if (role === "assistant manager") return "assistant_manager";
  if (role === "front desk" || role === "frontdesk" || role === "reception") return "front_desk";
  return role.replace(/\s+/g, "_");
}

function normalizeManagerType(value, fallback = DEFAULT_MANAGER_TYPE) {
  const managerType = normalizeRoleKey(value);
  if (managerType === "assistant_manager") return "assistant_manager";
  if (managerType === "manager") return "manager";
  return fallback ?? null;
}

function normalizeEmploymentType(value, fallback = DEFAULT_EMPLOYMENT_TYPE) {
  const employmentType = String(value || "").trim().toLowerCase();
  if (employmentType === "full_time" || employmentType === "part_time" || employmentType === "flexible") {
    return employmentType;
  }
  return fallback ?? null;
}

function normalizeWeeklyHoursTarget(value) {
  if (value === null || value === undefined || value === "") return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(0, numericValue) : null;
}

/** Combined weekly ceiling: minimum of Weekly Hours Target and Max Weekly Hours when both set. */
function getEffectiveWeeklyHoursCap(staff) {
  const normalized = normalizeStaffSchedulingData(staff);
  const target = normalized.weeklyHoursTarget;
  const maxH = normalized.constraints?.maxWeeklyHours;
  const vals = [];
  if (target != null && Number.isFinite(target) && target > 0) vals.push(target);
  if (maxH != null && Number.isFinite(maxH) && maxH > 0) vals.push(maxH);
  if (vals.length === 0) return null;
  return Math.min(...vals);
}

function parseScheduleTimeToMinutes(value) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(value || "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function assignmentDurationHoursFromTimes(startTime, endTime) {
  const s = parseScheduleTimeToMinutes(startTime);
  const e = parseScheduleTimeToMinutes(endTime);
  if (s == null || e == null || e <= s) return 0;
  return (e - s) / 60;
}

function formatMinutesAsScheduleTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = Math.round(totalMinutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Same role checks as schedule coverage validation (full manager vs assistant manager). */
function isFullManagerAssignmentForCoverage(a) {
  if (!a) return false;
  if (a.role === "admin") return true;
  if (a.role === "manager") return a.managerType !== "assistant_manager";
  return false;
}

function isAssistantManagerAssignmentForCoverage(a) {
  return Boolean(a && a.role === "manager" && a.managerType === "assistant_manager");
}

function countAssignmentsOverlappingMinuteRange(assignments, lo, hi, predicate) {
  return (Array.isArray(assignments) ? assignments : []).filter((a) => {
    if (!predicate(a)) return false;
    const aS = parseScheduleTimeToMinutes(a.startTime);
    const aE = parseScheduleTimeToMinutes(a.endTime);
    if (aS == null || aE == null || aE <= aS) return false;
    return Math.min(aE, hi) > Math.max(aS, lo);
  }).length;
}

/** Builds a shift window of durationHours starting at availability open, without exceeding close. */
function sliceTimeWindowFromStart(startTime, endTime, durationHours) {
  const s = parseScheduleTimeToMinutes(startTime);
  const e = parseScheduleTimeToMinutes(endTime);
  if (s == null || e == null || e <= s) return null;
  const maxMin = e - s;
  const wantMin = Math.min(Math.round(durationHours * 60), maxMin);
  if (wantMin <= 0) return null;
  return {
    startTime: formatMinutesAsScheduleTime(s),
    endTime: formatMinutesAsScheduleTime(s + wantMin),
  };
}

function inferStaffRoleKey(staff) {
  const explicitRole = normalizeRoleKey(staff?.role);
  const managerType = normalizeManagerType(
    staff?.managerType,
    explicitRole === "assistant_manager" ? "assistant_manager" : null
  );
  if (staff?.isAdmin === true || explicitRole === "owner" || explicitRole === "admin") return "manager";
  if (managerType === "assistant_manager") return "assistant_manager";
  if (managerType === "manager") return "manager";
  if (explicitRole) return explicitRole;
  if (staff?.isManager === true) return "manager";
  return "technician";
}

function normalizeDefaultSchedule(value) {
  const source = value && typeof value === "object" ? value : {};
  const legacyWorkingDays = Array.isArray(source.workingDays)
    ? [...new Set(source.workingDays.map(normalizeDay).filter(Boolean))]
    : [];
  const legacyStartTime = normalizeTimeString(source.startTime, DEFAULT_DAY_SCHEDULE.startTime);
  const legacyEndTime = normalizeTimeString(source.endTime, DEFAULT_DAY_SCHEDULE.endTime);
  const normalized = cloneDefaultSchedule();

  DAY_KEYS.forEach((dayKey) => {
    if (source[dayKey] && typeof source[dayKey] === "object") {
      normalized[dayKey] = normalizeDayScheduleEntry(source[dayKey], DEFAULT_DAY_SCHEDULE);
      return;
    }
    normalized[dayKey] = {
      enabled: legacyWorkingDays.includes(dayKey),
      startTime: legacyWorkingDays.includes(dayKey) ? legacyStartTime : null,
      endTime: legacyWorkingDays.includes(dayKey) ? legacyEndTime : null,
    };
  });

  return normalized;
}

function normalizeConstraints(value) {
  const source = value && typeof value === "object" ? value : {};
  const maxWeeklyHours = source.maxWeeklyHours === null || source.maxWeeklyHours === undefined || source.maxWeeklyHours === ""
    ? null
    : Number(source.maxWeeklyHours);
  return {
    cannotWorkAlone: source.cannotWorkAlone === true,
    requiresManager: source.requiresManager === true,
    maxWeeklyHours: Number.isFinite(maxWeeklyHours) ? maxWeeklyHours : null,
  };
}

function normalizeRolesHierarchy(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalized = cloneDefaultRolesHierarchy();
  Object.keys(source).forEach((key) => {
    const roleKey = normalizeRoleKey(key);
    const level = Number(source[key]);
    if (roleKey && Number.isFinite(level)) normalized[roleKey] = level;
  });
  return normalized;
}

function normalizeScheduleRules(value) {
  const source = value && typeof value === "object" ? value : {};
  const minManagersPerShift = Number(source.minManagersPerShift);
  const minFrontDeskPerDay = Number(source.minFrontDeskPerDay);
  const minTechniciansPerDay = Number(source.minTechniciansPerDay);
  const minTotalStaffPerDay = Number(source.minTotalStaffPerDay);
  return {
    minManagersPerShift: Number.isFinite(minManagersPerShift)
      ? Math.max(0, Math.round(minManagersPerShift))
      : DEFAULT_SCHEDULE_RULES.minManagersPerShift,
    minFrontDeskPerDay: Number.isFinite(minFrontDeskPerDay)
      ? Math.max(0, Math.round(minFrontDeskPerDay))
      : DEFAULT_SCHEDULE_RULES.minFrontDeskPerDay,
    minTechniciansPerDay: Number.isFinite(minTechniciansPerDay)
      ? Math.max(0, Math.round(minTechniciansPerDay))
      : DEFAULT_SCHEDULE_RULES.minTechniciansPerDay,
    minTotalStaffPerDay: Number.isFinite(minTotalStaffPerDay)
      ? Math.max(0, Math.round(minTotalStaffPerDay))
      : DEFAULT_SCHEDULE_RULES.minTotalStaffPerDay,
    allowAssistantManagerAlone: source.allowAssistantManagerAlone === true,
  };
}

function normalizeCoverageDayRules(value) {
  const source = value && typeof value === "object" ? value : {};
  const minTotalStaff = Number(source.minTotalStaff);
  const minManagers = Number(source.minManagers);
  const minFrontDesk = Number(source.minFrontDesk);
  const minTechnicians = Number(source.minTechnicians);
  return {
    minTotalStaff: Number.isFinite(minTotalStaff) ? Math.max(0, Math.round(minTotalStaff)) : DEFAULT_DAY_COVERAGE_RULES.minTotalStaff,
    minManagers: Number.isFinite(minManagers) ? Math.max(0, Math.round(minManagers)) : DEFAULT_DAY_COVERAGE_RULES.minManagers,
    minFrontDesk: Number.isFinite(minFrontDesk) ? Math.max(0, Math.round(minFrontDesk)) : DEFAULT_DAY_COVERAGE_RULES.minFrontDesk,
    minTechnicians: Number.isFinite(minTechnicians) ? Math.max(0, Math.round(minTechnicians)) : DEFAULT_DAY_COVERAGE_RULES.minTechnicians,
  };
}

function normalizeBusinessHours(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalized = cloneDefaultBusinessHours();
  DAY_KEYS.forEach((dayKey) => {
    if (source[dayKey] && typeof source[dayKey] === "object") {
      normalized[dayKey] = normalizeBusinessDayEntry(source[dayKey], DEFAULT_BUSINESS_HOURS[dayKey]);
    }
  });
  return normalized;
}

function coerceOptionalNonNegCoverageInt(value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0) return undefined;
  return Math.min(99, Math.round(v));
}

/** One internal shift window (does not replace opening hours — refines scheduling inside the day). */
function normalizeShiftSegmentEntry(value) {
  const source = value && typeof value === "object" ? value : {};
  let startTime = normalizeTimeString(source.startTime, null);
  let endTime = normalizeTimeString(source.endTime, null);
  const o = parseScheduleTimeToMinutes(startTime);
  let c = parseScheduleTimeToMinutes(endTime);
  if (o == null || c == null) return null;
  if (c <= o) {
    const cEvening = c + 12 * 60;
    if (cEvening > o && cEvening < 24 * 60) {
      endTime = formatMinutesAsScheduleTime(cEvening);
      c = cEvening;
    } else {
      return null;
    }
  }
  const out = { startTime, endTime };
  const m = coerceOptionalNonNegCoverageInt(source.minManagers);
  const f = coerceOptionalNonNegCoverageInt(source.minFrontDesk);
  const t = coerceOptionalNonNegCoverageInt(source.minTechnicians);
  if (m !== undefined) out.minManagers = m;
  if (f !== undefined) out.minFrontDesk = f;
  if (t !== undefined) out.minTechnicians = t;
  return out;
}

function cloneDefaultDayShiftSegments() {
  return DAY_KEYS.reduce((acc, dayKey) => {
    acc[dayKey] = [];
    return acc;
  }, {});
}

/**
 * Per weekday: list of { startTime, endTime } shift segments.
 * Empty list = "not customized" — consumers fall back to business open/close as one segment.
 */
function normalizeDayShiftSegments(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalized = cloneDefaultDayShiftSegments();
  DAY_KEYS.forEach((dayKey) => {
    const raw = source[dayKey];
    const arr = Array.isArray(raw) ? raw : [];
    const segments = [];
    arr.forEach((item) => {
      const seg = normalizeShiftSegmentEntry(item);
      if (seg) segments.push(seg);
    });
    segments.sort((a, b) => {
      const ma = parseScheduleTimeToMinutes(a.startTime);
      const mb = parseScheduleTimeToMinutes(b.startTime);
      return (ma ?? 0) - (mb ?? 0);
    });
    normalized[dayKey] = segments;
  });
  return normalized;
}

/**
 * Effective shift segments for a weekday: custom list if set, else single segment from business hours.
 */
function getEffectiveShiftSegmentsForDay(dayName, businessHours, dayShiftSegmentsRaw) {
  const bhNorm = normalizeBusinessHours(businessHours || {});
  const bh = bhNorm[dayName] || DEFAULT_DAY_BUSINESS_HOURS;
  const segsNorm = normalizeDayShiftSegments(dayShiftSegmentsRaw || {});
  const custom = segsNorm[dayName] || [];
  if (!bh.isOpen) return [];
  if (!Array.isArray(custom) || custom.length === 0) {
    const o = bh.openTime;
    const c = bh.closeTime;
    const om = parseScheduleTimeToMinutes(o);
    const cm = parseScheduleTimeToMinutes(c);
    if (om != null && cm != null && cm > om) {
      return [{ startTime: o, endTime: c }];
    }
    return [];
  }
  return custom;
}

/** Per-segment minimums merged with weekday defaults (same as schedule-generator). */
function resolvedSegmentCoverage(seg, dayCov) {
  const d = dayCov && typeof dayCov === "object" ? dayCov : DEFAULT_DAY_COVERAGE_RULES;
  return {
    minManagers: Math.max(0, Math.round(Number(seg.minManagers != null ? seg.minManagers : d.minManagers) || 0)),
    minFrontDesk: Math.max(0, Math.round(Number(seg.minFrontDesk != null ? seg.minFrontDesk : d.minFrontDesk) || 0)),
    minTechnicians: Math.max(0, Math.round(Number(seg.minTechnicians != null ? seg.minTechnicians : d.minTechnicians) || 0)),
  };
}

/**
 * When a weekday has multiple custom shift segments, split the day at all segment start/end times
 * and compute concurrent coverage required in each sub-interval.
 * Overlapping segments: take the **maximum** per role (Mgr / Asst Mgr / Svc prov), not the sum — each row
 * is its own minimum for that time band; where bands overlap, the highest requirement applies.
 * Returns null if there are no custom segments (falls back to a single business-hours window).
 */
function buildSegmentOverlapCoverageGapsFromSegments(dayName, segs, coverageRules) {
  if (!dayName || !Array.isArray(segs) || segs.length === 0) return null;
  const cov = normalizeCoverageRules(coverageRules || {});
  const dayCov = cov[dayName] || DEFAULT_DAY_COVERAGE_RULES;
  const bounds = new Set();
  segs.forEach((seg) => {
    const s = parseScheduleTimeToMinutes(seg.startTime);
    const e = parseScheduleTimeToMinutes(seg.endTime);
    if (s != null && e != null && e > s) {
      bounds.add(s);
      bounds.add(e);
    }
  });
  const sorted = [...bounds].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (sorted.length < 2) return null;
  const gaps = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i];
    const hi = sorted[i + 1];
    if (hi <= lo) continue;
    const mid = lo + (hi - lo) / 2;
    let needFull = 0;
    let needAsst = 0;
    let needTech = 0;
    segs.forEach((seg) => {
      const s = parseScheduleTimeToMinutes(seg.startTime);
      const e = parseScheduleTimeToMinutes(seg.endTime);
      if (s == null || e == null || e <= s) return;
      if (mid >= s && mid < e) {
        const req = resolvedSegmentCoverage(seg, dayCov);
        needFull = Math.max(needFull, req.minManagers);
        needAsst = Math.max(needAsst, req.minFrontDesk);
        needTech = Math.max(needTech, req.minTechnicians);
      }
    });
    gaps.push({ startMin: lo, endMin: hi, needFull, needAsst, needTech });
  }
  return gaps.length ? gaps : null;
}

function getCustomSegmentOverlapCoverageGaps(dayName, businessHours, dayShiftSegments, coverageRules) {
  const rawSeg = normalizeDayShiftSegments(dayShiftSegments || {})[dayName] || [];
  if (!rawSeg.length) return null;
  const bhNorm = normalizeBusinessHours(businessHours || {});
  const segs = getEffectiveShiftSegmentsForDay(dayName, bhNorm, dayShiftSegments);
  if (!Array.isArray(segs) || segs.length === 0) return null;
  return buildSegmentOverlapCoverageGapsFromSegments(dayName, segs, coverageRules);
}

/**
 * Intersects [startTime, endTime] with the segment that yields the longest overlap.
 * Used for availability and for clamping draft assignments to configured shift windows.
 */
function clipTimeWindowToBestShiftSegment(startTime, endTime, segments) {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const aS = parseScheduleTimeToMinutes(startTime);
  const aE = parseScheduleTimeToMinutes(endTime);
  if (aS == null || aE == null || aE <= aS) return null;
  let bestOverlap = -1;
  let bestLo = null;
  let bestHi = null;
  for (const seg of segments) {
    const s = parseScheduleTimeToMinutes(seg.startTime);
    const e = parseScheduleTimeToMinutes(seg.endTime);
    if (s == null || e == null || e <= s) continue;
    const lo = Math.max(aS, s);
    const hi = Math.min(aE, e);
    const overlap = hi > lo ? hi - lo : 0;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestLo = lo;
      bestHi = hi;
    }
  }
  if (bestOverlap <= 0 || bestLo == null || bestHi == null) return null;
  return {
    startTime: formatMinutesAsScheduleTime(bestLo),
    endTime: formatMinutesAsScheduleTime(bestHi),
  };
}

/**
 * When multiple shift segments exist, intersect staff availability with the **bounding hull**
 * (earliest segment start → latest segment end) instead of picking only the single segment
 * with the longest overlap. Otherwise everyone ends up clipped to e.g. 09:15–19:15 and no one
 * covers a later segment that runs until 21:00.
 */
function clipTimeWindowToUnionOfShiftSegments(startTime, endTime, segments) {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const aS = parseScheduleTimeToMinutes(startTime);
  const aE = parseScheduleTimeToMinutes(endTime);
  if (aS == null || aE == null || aE <= aS) return null;
  let minS = Infinity;
  let maxE = -Infinity;
  for (const seg of segments) {
    const s = parseScheduleTimeToMinutes(seg.startTime);
    const e = parseScheduleTimeToMinutes(seg.endTime);
    if (s == null || e == null || e <= s) continue;
    minS = Math.min(minS, s);
    maxE = Math.max(maxE, e);
  }
  if (!Number.isFinite(minS) || maxE <= minS) return null;
  const lo = Math.max(aS, minS);
  const hi = Math.min(aE, maxE);
  if (hi <= lo) return null;
  return {
    startTime: formatMinutesAsScheduleTime(lo),
    endTime: formatMinutesAsScheduleTime(hi),
  };
}

function normalizeCoverageRules(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalized = cloneDefaultCoverageRules();
  DAY_KEYS.forEach((dayKey) => {
    if (source[dayKey] && typeof source[dayKey] === "object") {
      normalized[dayKey] = normalizeCoverageDayRules(source[dayKey]);
    }
  });
  return normalized;
}

function getDayNameFromDateKey(dateKey) {
  const date = new Date(`${String(dateKey || "").trim()}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][date.getDay()];
}

function isCoverageRulesAllZeros(normalizedCov) {
  return DAY_KEYS.every((k) => {
    const d = normalizedCov[k];
    return (
      (d.minTotalStaff || 0) === 0
      && (d.minManagers || 0) === 0
      && (d.minFrontDesk || 0) === 0
      && (d.minTechnicians || 0) === 0
    );
  });
}

/**
 * True when custom shift segments list has at least one non-zero coverage target
 * (explicit on segment or inherited from day defaults once merged in UI).
 */
function hasSegmentListCoverageMinimums(dayName, dayShiftSegmentsRaw, normalizedCov) {
  const norm = normalizeDayShiftSegments(dayShiftSegmentsRaw || {});
  const custom = norm[dayName] || [];
  if (!custom.length) return false;
  const d = normalizedCov[dayName] || DEFAULT_DAY_COVERAGE_RULES;
  return custom.some((s) => {
    const m = s.minManagers != null ? Number(s.minManagers) : d.minManagers;
    const f = s.minFrontDesk != null ? Number(s.minFrontDesk) : d.minFrontDesk;
    const t = s.minTechnicians != null ? Number(s.minTechnicians) : d.minTechnicians;
    return (m || 0) > 0 || (f || 0) > 0 || (t || 0) > 0;
  });
}

/**
 * Merges global scheduleRules with per-weekday coverageRules from Settings.
 * When all coverage days are zero (default / not customized), global scheduleRules apply.
 * Once any day has a non-zero minimum, per-day values are used for every weekday (zeros mean no minimum that day).
 * Optional `options.businessHours` + `options.dayShiftSegments`: when that day has custom segments,
 * effective minimums use the max of per-segment requirements (for validation / summaries).
 * Coverage field `minFrontDesk` / `minFrontDeskPerDay` counts Assistant Managers (Manager + Assistant Manager type), not the front_desk role.
 */
function getEffectiveScheduleRulesForDate(dateKey, scheduleRules, coverageRules, options = {}) {
  const base = normalizeScheduleRules(scheduleRules);
  const normalizedCov = normalizeCoverageRules(coverageRules);
  const dayName = getDayNameFromDateKey(dateKey);
  const { businessHours, dayShiftSegments } = options;
  const segMinActive = dayName && hasSegmentListCoverageMinimums(dayName, dayShiftSegments, normalizedCov);
  if (isCoverageRulesAllZeros(normalizedCov) && !segMinActive) {
    return base;
  }
  if (!dayName) return base;
  const d = normalizedCov[dayName] || DEFAULT_DAY_COVERAGE_RULES;
  let minManagersPerShift = d.minManagers;
  let minFrontDeskPerDay = d.minFrontDesk;
  let minTechniciansPerDay = d.minTechnicians;
  const rawSeg = dayName && dayShiftSegments != null ? normalizeDayShiftSegments(dayShiftSegments)[dayName] : null;
  if (businessHours && rawSeg && rawSeg.length > 0) {
    const segs = getEffectiveShiftSegmentsForDay(dayName, businessHours, dayShiftSegments);
    if (segs.length) {
      minManagersPerShift = Math.max(
        ...segs.map((s) => Number(s.minManagers != null ? s.minManagers : d.minManagers) || 0),
        0,
      );
      minFrontDeskPerDay = Math.max(
        ...segs.map((s) => Number(s.minFrontDesk != null ? s.minFrontDesk : d.minFrontDesk) || 0),
        0,
      );
      minTechniciansPerDay = Math.max(
        ...segs.map((s) => Number(s.minTechnicians != null ? s.minTechnicians : d.minTechnicians) || 0),
        0,
      );
    }
  }
  return {
    ...base,
    minManagersPerShift,
    minFrontDeskPerDay,
    minTechniciansPerDay,
    minTotalStaffPerDay: d.minTotalStaff,
  };
}

function normalizeSpecialBusinessDays(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalized = cloneDefaultSpecialBusinessDays();
  Object.keys(source).forEach((dateKey) => {
    if (!isValidDateKey(dateKey)) return;
    normalized[dateKey] = normalizeSpecialBusinessDayEntry(source[dateKey]);
  });
  return normalized;
}

/**
 * Multi-location staff: a staff member can be assigned to several branches
 * (`allowedLocationIds`) and may work DIFFERENT hours in each. The canonical
 * shape stored on the staff document is:
 *   {
 *     <locationId>: {
 *       defaultSchedule: { monday: {enabled,startTime,endTime}, ... }
 *     }
 *   }
 * Only locations with an explicit override are persisted; any location
 * without an entry here falls back to the staff's top-level `defaultSchedule`.
 */
function normalizeLocationScheduleAvailability(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized = {};
  Object.keys(value).forEach((locId) => {
    const key = typeof locId === "string" ? locId.trim() : "";
    if (!key) return;
    const entry = value[locId];
    if (!entry || typeof entry !== "object") return;
    const ds = entry.defaultSchedule;
    if (!ds || typeof ds !== "object") return;
    normalized[key] = {
      defaultSchedule: normalizeDefaultSchedule(ds),
    };
  });
  return normalized;
}

/**
 * Returns the effective `defaultSchedule` for a staff row at a given location.
 *
 * Precedence:
 *   1. `locationScheduleAvailability[locId].defaultSchedule` when present.
 *   2. Multi-location staff who have already configured at least one
 *      branch-specific schedule but NOT this branch → "not scheduled here"
 *      (all days off). This matches the owner's mental model of
 *      "tell me which days you work at each branch" — a branch that was
 *      deliberately left empty is not a place the staff works.
 *   3. Otherwise fall back to the top-level `staff.defaultSchedule`.
 *      This preserves legacy behaviour for single-location staff and for
 *      multi-location staff who haven't yet been migrated to the new
 *      per-branch schedule UI.
 */
function getStaffDefaultScheduleForLocation(staff, locationId) {
  const locKey = typeof locationId === "string" ? locationId.trim() : "";
  const mapRaw = staff && staff.locationScheduleAvailability;
  if (locKey && mapRaw && typeof mapRaw === "object") {
    const entry = mapRaw[locKey];
    if (entry && entry.defaultSchedule && typeof entry.defaultSchedule === "object") {
      return normalizeDefaultSchedule(entry.defaultSchedule);
    }
    const allowed = Array.isArray(staff && staff.allowedLocationIds) ? staff.allowedLocationIds : [];
    if (allowed.length > 1 && Object.keys(mapRaw).length > 0) {
      return cloneDefaultSchedule();
    }
  }
  return normalizeDefaultSchedule(staff && staff.defaultSchedule);
}

/**
 * Cross-branch conflict detection for a multi-location staff member.
 * Returns a list of `{ dayKey, locationAId, locationBId, overlap: "HH:MM-HH:MM" }`
 * when the staff is scheduled to work overlapping hours in two different
 * branches on the same weekday. Callers can surface this as a warning when
 * the owner edits a schedule, or block auto-build from placing conflicting
 * shifts. Days that are Off in a branch, or where only one branch has
 * hours, never produce a conflict.
 */
function detectStaffLocationScheduleConflicts(staff) {
  const source = staff && typeof staff === "object" ? staff : {};
  const perLoc = normalizeLocationScheduleAvailability(source.locationScheduleAvailability);
  const allowed = Array.isArray(source.allowedLocationIds) ? source.allowedLocationIds.slice() : [];
  if (allowed.length < 2) return [];
  // Resolve each location's effective schedule from the explicit override.
  // Locations without an override are treated as "not scheduled" (all days off)
  // — matching the strict no-default model used by getStaffDefaultScheduleForLocation.
  const emptySchedule = cloneDefaultSchedule();
  const perLocEffective = {};
  allowed.forEach((locId) => {
    if (!locId) return;
    perLocEffective[locId] = perLoc[locId]?.defaultSchedule || emptySchedule;
  });
  const conflicts = [];
  DAY_KEYS.forEach((dayKey) => {
    for (let i = 0; i < allowed.length; i += 1) {
      for (let j = i + 1; j < allowed.length; j += 1) {
        const a = allowed[i]; const b = allowed[j];
        const da = perLocEffective[a]?.[dayKey]; const db = perLocEffective[b]?.[dayKey];
        if (!da || !db || !da.enabled || !db.enabled) continue;
        const aS = parseScheduleTimeToMinutes(da.startTime);
        const aE = parseScheduleTimeToMinutes(da.endTime);
        const bS = parseScheduleTimeToMinutes(db.startTime);
        const bE = parseScheduleTimeToMinutes(db.endTime);
        if (aS == null || aE == null || bS == null || bE == null) continue;
        if (aE <= aS || bE <= bS) continue;
        const lo = Math.max(aS, bS); const hi = Math.min(aE, bE);
        if (hi > lo) {
          conflicts.push({
            dayKey,
            locationAId: a,
            locationBId: b,
            overlap: `${formatMinutesAsScheduleTime(lo)}-${formatMinutesAsScheduleTime(hi)}`,
          });
        }
      }
    }
  });
  return conflicts;
}

function normalizeStaffSchedulingData(staff) {
  const source = staff && typeof staff === "object" ? staff : {};
  const explicitRole = normalizeRoleKey(source.role);
  const isAdmin = source.isAdmin === true || explicitRole === "owner" || explicitRole === "admin";
  const isLegacyAssistantManager = explicitRole === "assistant_manager";
  const normalizedRole = isAdmin
    ? "admin"
    : (isLegacyAssistantManager ? "manager" : (explicitRole || (source.isManager === true ? "manager" : "technician")));
  const isManager = !isAdmin && (normalizedRole === "manager" || source.isManager === true || isLegacyAssistantManager);
  const managerType = isManager
    ? normalizeManagerType(source.managerType, isLegacyAssistantManager ? "assistant_manager" : DEFAULT_MANAGER_TYPE)
    : undefined;
  return {
    ...source,
    role: normalizedRole,
    isAdmin,
    isManager,
    managerType,
    employmentType: normalizeEmploymentType(source.employmentType),
    weeklyHoursTarget: normalizeWeeklyHoursTarget(source.weeklyHoursTarget),
    defaultSchedule: normalizeDefaultSchedule(source.defaultSchedule),
    locationScheduleAvailability: normalizeLocationScheduleAvailability(source.locationScheduleAvailability),
    constraints: normalizeConstraints(source.constraints),
  };
}

function getStaffRoleLevel(staff, rolesHierarchy = DEFAULT_ROLES_HIERARCHY) {
  const normalizedHierarchy = normalizeRolesHierarchy(rolesHierarchy);
  const roleKey = inferStaffRoleKey(staff);
  if (normalizedHierarchy[roleKey] != null) return normalizedHierarchy[roleKey];
  if (roleKey === "owner" || roleKey === "admin") return normalizedHierarchy.manager ?? DEFAULT_ROLES_HIERARCHY.manager;
  return 0;
}

function canWorkAlone(staff, options = {}) {
  const normalizedStaff = normalizeStaffSchedulingData(staff);
  const rolesHierarchy = normalizeRolesHierarchy(options.rolesHierarchy);
  const scheduleRules = normalizeScheduleRules(options.scheduleRules);
  const roleKey = inferStaffRoleKey(normalizedStaff);

  if (normalizedStaff.constraints.cannotWorkAlone || normalizedStaff.constraints.requiresManager) return false;
  if (roleKey === "assistant_manager") return scheduleRules.allowAssistantManagerAlone === true;
  return getStaffRoleLevel(normalizedStaff, rolesHierarchy) >= (rolesHierarchy.manager ?? DEFAULT_ROLES_HIERARCHY.manager);
}

function hasRequiredManager(staffList, options = {}) {
  const scheduleRules = normalizeScheduleRules(options.scheduleRules);
  const rolesHierarchy = normalizeRolesHierarchy(options.rolesHierarchy);
  const requiredManagers = scheduleRules.minManagersPerShift;
  if (requiredManagers <= 0) return true;

  const managerCount = (Array.isArray(staffList) ? staffList : []).reduce((count, staff) => {
    const normalizedStaff = normalizeStaffSchedulingData(staff);
    const roleKey = inferStaffRoleKey(normalizedStaff);
    const isManagerLevel = getStaffRoleLevel(normalizedStaff, rolesHierarchy) >= (rolesHierarchy.manager ?? DEFAULT_ROLES_HIERARCHY.manager);
    const assistantCounts = roleKey === "assistant_manager" && scheduleRules.allowAssistantManagerAlone === true;
    return count + (isManagerLevel || assistantCounts ? 1 : 0);
  }, 0);

  return managerCount >= requiredManagers;
}

function validateStaffConstraints(staff, context = {}) {
  const normalizedStaff = normalizeStaffSchedulingData(staff);
  const rolesHierarchy = normalizeRolesHierarchy(context.rolesHierarchy);
  const scheduleRules = normalizeScheduleRules(context.scheduleRules);
  const reasons = [];
  const projectedWeeklyHours = Number(context.projectedWeeklyHours);
  const hasManager = context.hasManager === true || hasRequiredManager(context.staffList || [], { rolesHierarchy, scheduleRules });

  if (context.isSoloShift === true && !canWorkAlone(normalizedStaff, { rolesHierarchy, scheduleRules })) {
    reasons.push("Staff member cannot work alone.");
  }
  if (normalizedStaff.constraints.requiresManager && !hasManager) {
    reasons.push("Staff member requires manager coverage.");
  }
  const weeklyCap = getEffectiveWeeklyHoursCap(normalizedStaff);
  if (weeklyCap != null && Number.isFinite(projectedWeeklyHours) && projectedWeeklyHours > weeklyCap) {
    reasons.push("Staff member exceeds weekly hours limit.");
  }

  return {
    valid: reasons.length === 0,
    reasons,
  };
}

const scheduleHelpers = {
  DAY_KEYS,
  DEFAULT_DEFAULT_SCHEDULE,
  DEFAULT_CONSTRAINTS,
  DEFAULT_MANAGER_TYPE,
  DEFAULT_EMPLOYMENT_TYPE,
  DEFAULT_ROLES_HIERARCHY,
  DEFAULT_SCHEDULE_RULES,
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_COVERAGE_RULES,
  DEFAULT_SPECIAL_BUSINESS_DAYS,
  cloneDefaultSchedule,
  cloneDefaultConstraints,
  cloneDefaultRolesHierarchy,
  cloneDefaultScheduleRules,
  cloneDefaultBusinessHours,
  cloneDefaultDayShiftSegments,
  cloneDefaultCoverageRules,
  cloneDefaultSpecialBusinessDays,
  normalizeEmploymentType,
  normalizeWeeklyHoursTarget,
  getEffectiveWeeklyHoursCap,
  parseScheduleTimeToMinutes,
  assignmentDurationHoursFromTimes,
  formatMinutesAsScheduleTime,
  isFullManagerAssignmentForCoverage,
  isAssistantManagerAssignmentForCoverage,
  countAssignmentsOverlappingMinuteRange,
  sliceTimeWindowFromStart,
  normalizeDefaultSchedule,
  normalizeConstraints,
  normalizeManagerType,
  normalizeRolesHierarchy,
  normalizeScheduleRules,
  normalizeBusinessHours,
  normalizeDayShiftSegments,
  getEffectiveShiftSegmentsForDay,
  resolvedSegmentCoverage,
  getCustomSegmentOverlapCoverageGaps,
  buildSegmentOverlapCoverageGapsFromSegments,
  clipTimeWindowToBestShiftSegment,
  clipTimeWindowToUnionOfShiftSegments,
  hasSegmentListCoverageMinimums,
  normalizeCoverageRules,
  getDayNameFromDateKey,
  getEffectiveScheduleRulesForDate,
  isCoverageRulesAllZeros,
  normalizeSpecialBusinessDays,
  normalizeStaffSchedulingData,
  normalizeLocationScheduleAvailability,
  getStaffDefaultScheduleForLocation,
  detectStaffLocationScheduleConflicts,
  getStaffRoleLevel,
  canWorkAlone,
  hasRequiredManager,
  validateStaffConstraints,
};

if (typeof window !== "undefined") {
  window.ffScheduleHelpers = scheduleHelpers;
  window.getStaffRoleLevel = getStaffRoleLevel;
  window.canWorkAlone = canWorkAlone;
  window.hasRequiredManager = hasRequiredManager;
  window.validateStaffConstraints = validateStaffConstraints;
}

export {
  DAY_KEYS,
  DEFAULT_DEFAULT_SCHEDULE,
  DEFAULT_CONSTRAINTS,
  DEFAULT_MANAGER_TYPE,
  DEFAULT_EMPLOYMENT_TYPE,
  DEFAULT_ROLES_HIERARCHY,
  DEFAULT_SCHEDULE_RULES,
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_COVERAGE_RULES,
  DEFAULT_SPECIAL_BUSINESS_DAYS,
  cloneDefaultSchedule,
  cloneDefaultConstraints,
  cloneDefaultRolesHierarchy,
  cloneDefaultScheduleRules,
  cloneDefaultBusinessHours,
  cloneDefaultDayShiftSegments,
  cloneDefaultCoverageRules,
  cloneDefaultSpecialBusinessDays,
  normalizeEmploymentType,
  normalizeWeeklyHoursTarget,
  getEffectiveWeeklyHoursCap,
  parseScheduleTimeToMinutes,
  assignmentDurationHoursFromTimes,
  formatMinutesAsScheduleTime,
  isFullManagerAssignmentForCoverage,
  isAssistantManagerAssignmentForCoverage,
  countAssignmentsOverlappingMinuteRange,
  sliceTimeWindowFromStart,
  normalizeDefaultSchedule,
  normalizeConstraints,
  normalizeManagerType,
  normalizeRolesHierarchy,
  normalizeScheduleRules,
  normalizeBusinessHours,
  normalizeDayShiftSegments,
  getEffectiveShiftSegmentsForDay,
  resolvedSegmentCoverage,
  getCustomSegmentOverlapCoverageGaps,
  buildSegmentOverlapCoverageGapsFromSegments,
  clipTimeWindowToBestShiftSegment,
  clipTimeWindowToUnionOfShiftSegments,
  hasSegmentListCoverageMinimums,
  normalizeCoverageRules,
  getDayNameFromDateKey,
  getEffectiveScheduleRulesForDate,
  isCoverageRulesAllZeros,
  normalizeSpecialBusinessDays,
  normalizeStaffSchedulingData,
  normalizeLocationScheduleAvailability,
  getStaffDefaultScheduleForLocation,
  detectStaffLocationScheduleConflicts,
  getStaffRoleLevel,
  canWorkAlone,
  hasRequiredManager,
  validateStaffConstraints,
};
