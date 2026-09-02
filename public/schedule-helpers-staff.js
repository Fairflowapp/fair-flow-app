// schedule-helpers-staff.js
// Schedule helpers staff — coverage rules, multi-location schedules, staff
// normalization, and constraint validation. Extracted verbatim from
// schedule-helpers.js (schedule-helpers split T2).

import {
  DAY_KEYS,
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_DAY_COVERAGE_RULES,
  DEFAULT_EMPLOYMENT_TYPE,
  DEFAULT_MANAGER_TYPE,
  DEFAULT_ROLES_HIERARCHY,
  DEFAULT_SCHEDULE_RULES,
  cloneDefaultCoverageRules,
  cloneDefaultSchedule,
  cloneDefaultSpecialBusinessDays,
  formatMinutesAsScheduleTime,
  getEffectiveShiftSegmentsForDay,
  isValidDateKey,
  normalizeBusinessHours,
  normalizeConstraints,
  normalizeCoverageDayRules,
  normalizeDayShiftSegments,
  normalizeDefaultSchedule,
  normalizeEmploymentType,
  normalizeManagerType,
  normalizeRoleKey,
  normalizeRolesHierarchy,
  normalizeScheduleRules,
  normalizeSpecialBusinessDayEntry,
  normalizeWeeklyHoursTarget,
  parseScheduleTimeToMinutes,
} from "./schedule-helpers-core.js?v=20260816_sat_open";

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
 * Dual-location staff (the option we built):
 *   1. Use `locationScheduleAvailability[thisLoc].defaultSchedule` when that
 *      branch has working days.
 *   2. If they already set hours at another branch but left this one empty
 *      → all days off here (they chose not to work at this branch).
 *   3. If they have not set per-branch hours yet → use top-level
 *      `defaultSchedule` at EVERY assigned location, so they still appear
 *      and can be built at both branches.
 */
function scheduleHasEnabledDay(sched) {
  if (!sched || typeof sched !== "object") return false;
  return DAY_KEYS.some((dayKey) => sched[dayKey] && sched[dayKey].enabled === true);
}

function staffHasHoursAtAnotherLocation(mapRaw, exceptLoc) {
  if (!mapRaw || typeof mapRaw !== "object") return false;
  return Object.keys(mapRaw).some((id) => {
    if (!id || id === exceptLoc) return false;
    const ds = mapRaw[id] && mapRaw[id].defaultSchedule;
    return scheduleHasEnabledDay(normalizeDefaultSchedule(ds));
  });
}

function getStaffDefaultScheduleForLocation(staff, locationId) {
  const locKey = typeof locationId === "string" ? locationId.trim() : "";
  const globalSchedule = normalizeDefaultSchedule(staff && staff.defaultSchedule);
  const mapRaw = staff && staff.locationScheduleAvailability;
  if (locKey && mapRaw && typeof mapRaw === "object") {
    const entry = mapRaw[locKey];
    if (entry && entry.defaultSchedule && typeof entry.defaultSchedule === "object") {
      const perLoc = normalizeDefaultSchedule(entry.defaultSchedule);
      if (scheduleHasEnabledDay(perLoc)) return perLoc;
      if (staffHasHoursAtAnotherLocation(mapRaw, locKey)) return cloneDefaultSchedule();
      return globalSchedule;
    }
    if (staffHasHoursAtAnotherLocation(mapRaw, locKey)) return cloneDefaultSchedule();
    return globalSchedule;
  }
  return globalSchedule;
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

/**
 * Per-day multi-location availability for a staff member.
 * Returns `[{ dayKey, locationIds: [...] }]` for every day (Mon–Sun) where
 * the staff has `enabled === true` in 2 or more locations. This is a strict
 * superset of `detectStaffLocationScheduleConflicts`: any day with an hour
 * overlap is also a multi-location day, but a multi-location day alone does
 * not imply a time conflict (e.g. Branch A 09:00–12:00 + Branch B 14:00–18:00).
 * Used by the Default Schedule UI to surface an INFO banner even when there
 * is no hard conflict.
 */
function detectStaffLocationScheduleMultiDays(staff) {
  const source = staff && typeof staff === "object" ? staff : {};
  const perLoc = normalizeLocationScheduleAvailability(source.locationScheduleAvailability);
  const allowed = Array.isArray(source.allowedLocationIds) ? source.allowedLocationIds.slice() : [];
  if (allowed.length < 2) return [];
  const emptySchedule = cloneDefaultSchedule();
  const perLocEffective = {};
  allowed.forEach((locId) => {
    if (!locId) return;
    perLocEffective[locId] = perLoc[locId]?.defaultSchedule || emptySchedule;
  });
  const result = [];
  DAY_KEYS.forEach((dayKey) => {
    const activeLocs = [];
    allowed.forEach((locId) => {
      const day = perLocEffective[locId]?.[dayKey];
      if (day && day.enabled === true) activeLocs.push(locId);
    });
    if (activeLocs.length >= 2) {
      result.push({ dayKey, locationIds: activeLocs });
    }
  });
  return result;
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

export {
  getEffectiveWeeklyHoursCap,
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
  detectStaffLocationScheduleMultiDays,
  getStaffRoleLevel,
  canWorkAlone,
  hasRequiredManager,
  validateStaffConstraints,
};
