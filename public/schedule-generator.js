import {
  enumerateDateRange,
  getEffectiveAvailability,
} from "./schedule-availability.js?v=20260615_default_schedule_source";
import {
  normalizeManagerType,
  normalizeScheduleRules,
  normalizeStaffSchedulingData,
  normalizeCoverageRules,
  normalizeDayShiftSegments,
  getEffectiveScheduleRulesForDate,
  isCoverageRulesAllZeros,
  hasSegmentListCoverageMinimums,
  getEffectiveWeeklyHoursCap,
  getDayNameFromDateKey,
  getEffectiveShiftSegmentsForDay,
  resolvedSegmentCoverage,
  getCustomSegmentOverlapCoverageGaps,
  assignmentDurationHoursFromTimes,
  sliceTimeWindowFromStart,
  parseScheduleTimeToMinutes,
  formatMinutesAsScheduleTime,
} from "./schedule-helpers.js?v=20260420_per_loc_no_default";

function getNormalizedStaffList(staffList) {
  return (Array.isArray(staffList) ? staffList : [])
    .map((staff) => normalizeStaffSchedulingData(staff))
    .filter((staff) => staff && typeof staff === "object");
}

function getStaffIdentifier(staff) {
  return String(staff?.staffId || staff?.id || "").trim() || null;
}

function getStaffUid(staff) {
  return String(staff?.uid || staff?.userUid || "").trim() || null;
}

function getStaffDisplayName(staff) {
  return String(staff?.name || "").trim() || "Unknown Staff";
}

function getStaffRole(staff) {
  if (staff?.isAdmin === true) return "admin";
  return String(staff?.role || "").trim().toLowerCase() || "technician";
}

function getAssignmentManagerType(staff) {
  if (getStaffRole(staff) !== "manager") return null;
  return normalizeManagerType(staff?.managerType);
}

function buildAvailabilityDirectory(staffList, requests, dateRange, options = {}) {
  const byStaffId = {};
  const byUid = {};

  getNormalizedStaffList(staffList).forEach((staff) => {
    const availability = getEffectiveAvailability(staff, requests, dateRange, options);
    const staffId = getStaffIdentifier(staff);
    const uid = getStaffUid(staff);
    if (staffId) byStaffId[staffId] = availability;
    if (uid) byUid[uid] = availability;
  });

  return { byStaffId, byUid };
}

function buildAssignment(staff, dailyAvailability) {
  return {
    staffId: getStaffIdentifier(staff),
    uid: getStaffUid(staff),
    name: getStaffDisplayName(staff),
    role: getStaffRole(staff),
    managerType: getAssignmentManagerType(staff),
    startTime: dailyAvailability?.startTime || null,
    endTime: dailyAvailability?.endTime || null,
    hasApprovedOverride: dailyAvailability?.hasApprovedOverride === true,
    overrideApplied: dailyAvailability?.overrideApplied === true,
    overrideTypes: Array.isArray(dailyAvailability?.overrideTypes) ? dailyAvailability.overrideTypes : [],
  };
}

function getAvailabilityForStaffDate(staff, availabilityDirectory, dateKey) {
  const staffId = getStaffIdentifier(staff);
  const uid = getStaffUid(staff);
  const availability = (staffId && availabilityDirectory.byStaffId[staffId]) || (uid && availabilityDirectory.byUid[uid]) || null;
  return availability?.byDate?.[dateKey] || null;
}

function compareAssignmentsByTime(left, right) {
  const leftStart = String(left.startTime || "");
  const rightStart = String(right.startTime || "");
  if (leftStart !== rightStart) return leftStart.localeCompare(rightStart);
  return String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" });
}

function assignmentStaffKey(assignment) {
  return String(assignment.staffId || assignment.uid || "").trim();
}

function isFullManagerAssignment(assignment) {
  if (assignment.role === "admin") return true;
  if (assignment.role === "manager") {
    return assignment.managerType !== "assistant_manager";
  }
  return false;
}

function isAssistantManagerAssignment(assignment) {
  return assignment.role === "manager" && assignment.managerType === "assistant_manager";
}

function assignmentOverlapsSegmentWindow(assignment, segStartTime, segEndTime) {
  const aS = parseScheduleTimeToMinutes(assignment.startTime);
  const aE = parseScheduleTimeToMinutes(assignment.endTime);
  const s = parseScheduleTimeToMinutes(segStartTime);
  const e = parseScheduleTimeToMinutes(segEndTime);
  if (aS == null || aE == null || s == null || e == null || e <= s) return false;
  return Math.min(aE, e) > Math.max(aS, s);
}

function assignmentOverlapsMinuteRange(assignment, lo, hi) {
  const aS = parseScheduleTimeToMinutes(assignment.startTime);
  const aE = parseScheduleTimeToMinutes(assignment.endTime);
  if (aS == null || aE == null || aE <= aS) return false;
  return Math.min(aE, hi) > Math.max(aS, lo);
}

/**
 * When coverage rules are customized (not all zeros), pick a minimal set that tries to meet
 * per-day effective minimums (full managers / assistant managers / technicians / total).
 * When custom shift segments exist, requirements are enforced per segment (overlap with assignment window).
 */
function filterAssignmentsByCoverageTargets(candidates, dateKey, scheduleRules, coverageRules, options = {}) {
  const sorted = [...candidates].sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" })
  );
  const cov = normalizeCoverageRules(coverageRules || {});
  const dayName = getDayNameFromDateKey(dateKey);
  const { businessHours, dayShiftSegments } = options;

  const covAllZero = isCoverageRulesAllZeros(cov);
  const segMin = dayName ? hasSegmentListCoverageMinimums(dayName, dayShiftSegments, cov) : false;
  if (covAllZero && !segMin) {
    return sorted.sort(compareAssignmentsByTime);
  }

  const customSegForDay = dayName ? (normalizeDayShiftSegments(dayShiftSegments || {})[dayName] || []) : [];

  const runDayLevelPick = () => {
    const eff = getEffectiveScheduleRulesForDate(dateKey, scheduleRules, coverageRules, { businessHours, dayShiftSegments });
  const taken = new Set();
  const picked = [];

  const takeUpTo = (list, n) => {
    let remaining = n;
    for (const a of list) {
      if (remaining <= 0) break;
      const k = assignmentStaffKey(a);
      if (!k || taken.has(k)) continue;
      picked.push(a);
      taken.add(k);
      remaining -= 1;
    }
  };

  const fullManagers = sorted.filter(isFullManagerAssignment);
    const assistantManagers = sorted.filter(isAssistantManagerAssignment);
  const technicians = sorted.filter((a) => a.role === "technician");

  takeUpTo(fullManagers, eff.minManagersPerShift);
    takeUpTo(assistantManagers, eff.minFrontDeskPerDay);
  takeUpTo(technicians, eff.minTechniciansPerDay);

  for (const a of sorted) {
    if (picked.length >= eff.minTotalStaffPerDay) break;
    const k = assignmentStaffKey(a);
    if (!k || taken.has(k)) continue;
    picked.push(a);
    taken.add(k);
  }

  return picked.sort(compareAssignmentsByTime);
  };

  if (!customSegForDay.length || !dayName || !businessHours) {
    return runDayLevelPick();
  }

  const dayCov = cov[dayName] || { minManagers: 0, minFrontDesk: 0, minTechnicians: 0, minTotalStaff: 0 };
  const effectiveSegs = getEffectiveShiftSegmentsForDay(dayName, businessHours, dayShiftSegments);
  if (!effectiveSegs.length) {
    return sorted.sort(compareAssignmentsByTime);
  }

  const pickedList = [];
  const taken = new Set();
  const add = (a) => {
    const k = assignmentStaffKey(a);
    if (!k || taken.has(k)) return;
    taken.add(k);
    pickedList.push(a);
  };

  const countOverlapInRange = (pred, lo, hi) =>
    pickedList.filter((a) => pred(a) && assignmentOverlapsMinuteRange(a, lo, hi)).length;

  const overlapGaps = getCustomSegmentOverlapCoverageGaps(dayName, businessHours, dayShiftSegments, coverageRules);

  if (overlapGaps && overlapGaps.length > 0) {
    overlapGaps.forEach((gap) => {
      while (countOverlapInRange(isFullManagerAssignment, gap.startMin, gap.endMin) < gap.needFull) {
        const next = sorted.find(
          (a) =>
            isFullManagerAssignment(a)
            && !taken.has(assignmentStaffKey(a))
            && assignmentOverlapsMinuteRange(a, gap.startMin, gap.endMin),
        );
        if (!next) break;
        add(next);
      }
      while (countOverlapInRange(isAssistantManagerAssignment, gap.startMin, gap.endMin) < gap.needAsst) {
        const next = sorted.find(
          (a) =>
            isAssistantManagerAssignment(a)
            && !taken.has(assignmentStaffKey(a))
            && assignmentOverlapsMinuteRange(a, gap.startMin, gap.endMin),
        );
        if (!next) break;
        add(next);
      }
      while (countOverlapInRange((a) => a.role === "technician", gap.startMin, gap.endMin) < gap.needTech) {
        const next = sorted.find(
          (a) =>
            a.role === "technician"
            && !taken.has(assignmentStaffKey(a))
            && assignmentOverlapsMinuteRange(a, gap.startMin, gap.endMin),
        );
        if (!next) break;
        add(next);
      }
    });
  } else {
    const countOverlap = (pred, seg) =>
      pickedList.filter((a) => pred(a) && assignmentOverlapsSegmentWindow(a, seg.startTime, seg.endTime)).length;

    for (const seg of effectiveSegs) {
      const req = resolvedSegmentCoverage(seg, dayCov);
      while (countOverlap(isFullManagerAssignment, seg) < req.minManagers) {
        const next = sorted.find(
          (a) =>
            isFullManagerAssignment(a)
            && !taken.has(assignmentStaffKey(a))
            && assignmentOverlapsSegmentWindow(a, seg.startTime, seg.endTime),
        );
        if (!next) break;
        add(next);
      }
      while (countOverlap(isAssistantManagerAssignment, seg) < req.minFrontDesk) {
        const next = sorted.find(
          (a) =>
            isAssistantManagerAssignment(a)
            && !taken.has(assignmentStaffKey(a))
            && assignmentOverlapsSegmentWindow(a, seg.startTime, seg.endTime),
        );
        if (!next) break;
        add(next);
      }
      while (countOverlap((a) => a.role === "technician", seg) < req.minTechnicians) {
        const next = sorted.find(
          (a) =>
            a.role === "technician"
            && !taken.has(assignmentStaffKey(a))
            && assignmentOverlapsSegmentWindow(a, seg.startTime, seg.endTime),
        );
        if (!next) break;
        add(next);
      }
    }
  }

  const eff = getEffectiveScheduleRulesForDate(dateKey, scheduleRules, coverageRules, { businessHours, dayShiftSegments });
  for (const a of sorted) {
    if (pickedList.length >= eff.minTotalStaffPerDay) break;
    const k = assignmentStaffKey(a);
    if (!k || taken.has(k)) continue;
    add(a);
  }

  return pickedList.sort(compareAssignmentsByTime);
}

/**
 * Returns true when the given [startMin,endMin) window overlaps ANY busy
 * window already assigned to this staff at a different location for the
 * same date. Used to block cross-location double-booking during Build
 * Schedule without introducing travel buffers or other complex rules.
 * Busy windows come from `crossLocationBusy[staffKey][dateKey]`.
 */
function hasCrossLocationBusyConflict(crossLocationBusy, staffKeys, dateKey, startMin, endMin) {
  if (!crossLocationBusy || !dateKey) return false;
  if (startMin == null || endMin == null || endMin <= startMin) return false;
  for (const k of staffKeys) {
    const byDate = k ? crossLocationBusy[k] : null;
    const list = byDate && byDate[dateKey];
    if (!Array.isArray(list) || list.length === 0) continue;
    for (const w of list) {
      const ws = Number(w.startMin);
      const we = Number(w.endMin);
      if (!Number.isFinite(ws) || !Number.isFinite(we) || we <= ws) continue;
      if (Math.min(endMin, we) > Math.max(startMin, ws)) return true;
    }
  }
  return false;
}

function staffBusyElsewhereForAvailability(staff, dateKey, availability, crossLocationBusy) {
  if (!crossLocationBusy) return false;
  const aS = parseScheduleTimeToMinutes(availability?.startTime);
  const aE = parseScheduleTimeToMinutes(availability?.endTime);
  if (aS == null || aE == null || aE <= aS) return false;
  const staffKeys = [getStaffIdentifier(staff), getStaffUid(staff)].filter(Boolean);
  return hasCrossLocationBusyConflict(crossLocationBusy, staffKeys, dateKey, aS, aE);
}

function buildAssignmentsForDate(staffList, availabilityDirectory, dateKey, options = {}) {
  const crossLocationBusy = options && options.crossLocationBusy;
  return getNormalizedStaffList(staffList)
    .map((staff) => {
      const dailyAvailability = getAvailabilityForStaffDate(staff, availabilityDirectory, dateKey);
      if (!dailyAvailability?.isAvailable) return null;
      // Skip this staff entirely for this date if their availability overlaps
      // with a busy window in another location. This matches the Multi-location
      // conflict guard shown in the Default Schedule editor: same staff cannot
      // be booked to overlapping shifts across branches.
      if (staffBusyElsewhereForAvailability(staff, dateKey, dailyAvailability, crossLocationBusy)) {
        return null;
      }
      return buildAssignment(staff, dailyAvailability);
    })
    .filter(Boolean)
    .sort(compareAssignmentsByTime);
}

function buildDayDraft({ date, staffList, availabilityDirectory, rules, coverageRules, businessHours, dayShiftSegments, crossLocationBusy } = {}) {
  const all = buildAssignmentsForDate(staffList, availabilityDirectory, date, { crossLocationBusy });
  const assignments = filterAssignmentsByCoverageTargets(all, date, rules, coverageRules, { businessHours, dayShiftSegments });
  return {
    date,
    assignments,
  };
}

function computeTotalsHoursByAssignmentKey(days) {
  const totals = {};
  (Array.isArray(days) ? days : []).forEach((day) => {
    (Array.isArray(day.assignments) ? day.assignments : []).forEach((a) => {
      const key = assignmentStaffKey(a);
      if (!key) return;
      const h = assignmentDurationHoursFromTimes(a.startTime, a.endTime);
      totals[key] = (totals[key] || 0) + h;
    });
  });
  return totals;
}

/**
 * Drops whole-day assignments from the end of the week backward until each staff member is
 * within getEffectiveWeeklyHoursCap (Weekly Hours Target / Max Weekly Hours).
 */
function applyWeeklyHoursCapToDraft(draft, staffList) {
  const capMap = new Map();
  getNormalizedStaffList(staffList).forEach((staff) => {
    const cap = getEffectiveWeeklyHoursCap(staff);
    if (cap == null || !Number.isFinite(cap) || cap <= 0) return;
    const key = assignmentStaffKey({
      staffId: getStaffIdentifier(staff),
      uid: getStaffUid(staff),
    });
    if (key) capMap.set(key, cap);
  });
  if (capMap.size === 0) return draft;

  const days = (draft.days || []).map((d) => ({
    ...d,
    assignments: [...(d.assignments || [])],
  }));

  let guard = 0;
  while (guard++ < 400) {
    const totals = computeTotalsHoursByAssignmentKey(days);
    let overKey = null;
    for (const [key, cap] of capMap.entries()) {
      const t = totals[key] || 0;
      if (t > cap + 1e-6) {
        overKey = key;
        break;
      }
    }
    if (!overKey) break;

    let removed = false;
    for (let d = days.length - 1; d >= 0; d--) {
      const arr = days[d].assignments || [];
      const idx = arr.findIndex((a) => assignmentStaffKey(a) === overKey);
      if (idx >= 0) {
        arr.splice(idx, 1);
        days[d].assignments = arr;
        removed = true;
        break;
      }
    }
    if (!removed) break;
  }

  return { ...draft, days };
}

function getWeeklyFillTargetHours(staff) {
  const n = normalizeStaffSchedulingData(staff);
  const goal = n.weeklyHoursTarget;
  if (goal == null || !Number.isFinite(goal) || goal <= 0) return null;
  const cap = getEffectiveWeeklyHoursCap(staff);
  if (cap == null) return goal;
  return Math.min(goal, cap);
}

function computeStaffWeeklyHoursInDays(days, staff) {
  const sid = getStaffIdentifier(staff);
  const uid = getStaffUid(staff);
  let h = 0;
  (Array.isArray(days) ? days : []).forEach((day) => {
    (day.assignments || []).forEach((a) => {
      const match = (sid && a.staffId === sid) || (uid && a.uid === uid);
      if (match) h += assignmentDurationHoursFromTimes(a.startTime, a.endTime);
    });
  });
  return h;
}

/**
 * Adds shifts on days where the staff had no assignment yet, until weeklyHoursTarget (capped) is reached.
 */
function applyWeeklyRemainingHoursFill(draft, staffList, crossLocationBusy) {
  const availabilityDirectory = draft.context?.availabilityDirectory;
  if (!availabilityDirectory) return draft;

  const days = (draft.days || []).map((d) => ({
    ...d,
    assignments: [...(d.assignments || [])],
  }));

  getNormalizedStaffList(staffList).forEach((staff) => {
    const targetHours = getWeeklyFillTargetHours(staff);
    if (targetHours == null) return;

    let remaining = targetHours - computeStaffWeeklyHoursInDays(days, staff);
    if (remaining <= 0.02) return;

    const staffId = getStaffIdentifier(staff);
    const uid = getStaffUid(staff);
    const staffKeys = [staffId, uid].filter(Boolean);

    for (let i = 0; i < days.length; i++) {
      if (remaining <= 0.02) break;
      const day = days[i];
      const has = day.assignments.some(
        (a) => (staffId && a.staffId === staffId) || (uid && a.uid === uid)
      );
      if (has) continue;

      const avail = getAvailabilityForStaffDate(staff, availabilityDirectory, day.date);
      if (!avail?.isAvailable || !avail.startTime || !avail.endTime) continue;

      const maxDayH = assignmentDurationHoursFromTimes(avail.startTime, avail.endTime);
      const addH = Math.min(remaining, maxDayH);
      if (addH <= 0.02) continue;

      const window = sliceTimeWindowFromStart(avail.startTime, avail.endTime, addH);
      if (!window) continue;

      // Respect cross-location busy windows when topping up weekly hours too,
      // otherwise the fill step could re-introduce the exact double-booking
      // buildDayDraft just prevented.
      const winStart = parseScheduleTimeToMinutes(window.startTime);
      const winEnd = parseScheduleTimeToMinutes(window.endTime);
      if (hasCrossLocationBusyConflict(crossLocationBusy, staffKeys, day.date, winStart, winEnd)) {
        continue;
      }

      day.assignments.push({
        staffId,
        uid,
        name: getStaffDisplayName(staff),
        role: getStaffRole(staff),
        managerType: getAssignmentManagerType(staff),
        startTime: window.startTime,
        endTime: window.endTime,
        hasApprovedOverride: false,
        overrideApplied: false,
        overrideTypes: [],
      });
      remaining -= addH;
    }
  });

  days.forEach((day) => {
    day.assignments.sort(compareAssignmentsByTime);
  });

  return { ...draft, days };
}

function generateWeeklySchedule({ staffList = [], requests = [], rules = {}, dateRange, businessHours, coverageRules, dayShiftSegments, crossLocationBusy } = {}) {
  const dates = enumerateDateRange(dateRange);
  const normalizedStaffList = getNormalizedStaffList(staffList);
  const availabilityDirectory = buildAvailabilityDirectory(normalizedStaffList, requests, dateRange, {
    businessHours,
    dayShiftSegments,
  });
  const normalizedRules = normalizeScheduleRules(rules);
  const normalizedCrossBusy = (crossLocationBusy && typeof crossLocationBusy === "object") ? crossLocationBusy : null;

  const days = dates.map((date) =>
    buildDayDraft({
      date,
      staffList: normalizedStaffList,
      availabilityDirectory,
      rules: normalizedRules,
      coverageRules,
      businessHours,
      dayShiftSegments,
      crossLocationBusy: normalizedCrossBusy,
    })
  );

  const draftBeforeCap = {
    startDate: dates[0] || null,
    endDate: dates[dates.length - 1] || null,
    rules: normalizedRules,
    coverageRules: coverageRules && typeof coverageRules === "object" ? coverageRules : undefined,
    days,
    context: {
      availabilityDirectory,
      usedEffectiveAvailability: true,
    },
    metadata: {
      generatedAt: new Date().toISOString(),
      staffCount: normalizedStaffList.length,
      requestCount: Array.isArray(requests) ? requests.length : 0,
      usedEffectiveAvailability: true,
    },
  };

  let draft = applyWeeklyHoursCapToDraft(draftBeforeCap, normalizedStaffList);
  draft = applyWeeklyRemainingHoursFill(draft, normalizedStaffList, normalizedCrossBusy);
  draft = applyWeeklyHoursCapToDraft(draft, normalizedStaffList);
  return draft;
}

const scheduleGenerator = {
  generateWeeklySchedule,
  getNormalizedStaffList,
  getStaffIdentifier,
  getStaffUid,
  getStaffDisplayName,
  getStaffRole,
  getAvailabilityForStaffDate,
  buildAvailabilityDirectory,
  buildAssignmentsForDate,
};

if (typeof window !== "undefined") {
  window.ffScheduleGenerator = scheduleGenerator;
  window.generateWeeklySchedule = generateWeeklySchedule;
}

export {
  generateWeeklySchedule,
  getNormalizedStaffList,
  getStaffIdentifier,
  getStaffUid,
  getStaffDisplayName,
  getStaffRole,
  getAvailabilityForStaffDate,
  buildAvailabilityDirectory,
  buildAssignmentsForDate,
};
