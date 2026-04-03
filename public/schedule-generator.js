import {
  enumerateDateRange,
  getEffectiveAvailability,
} from "./schedule-availability.js?v=20260403_reception_split";
import {
  normalizeManagerType,
  normalizeScheduleRules,
  normalizeStaffSchedulingData,
  normalizeCoverageRules,
  normalizeBusinessHours,
  getEffectiveScheduleRulesForDate,
  isCoverageRulesAllZeros,
  getEffectiveWeeklyHoursCap,
  getDayNameFromDateKey,
  assignmentDurationHoursFromTimes,
  sliceTimeWindowFromStart,
  parseScheduleTimeToMinutes,
  formatMinutesAsScheduleTime,
} from "./schedule-helpers.js?v=20260403_reception_split";

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

/**
 * When coverage rules are customized (not all zeros), pick a minimal set that tries to meet
 * per-day effective minimums (managers / front desk / technicians / total).
 * Otherwise keep every available assignment (legacy behavior).
 */
function filterAssignmentsByCoverageTargets(candidates, dateKey, scheduleRules, coverageRules) {
  const sorted = [...candidates].sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" })
  );
  const cov = normalizeCoverageRules(coverageRules);
  if (!coverageRules || isCoverageRulesAllZeros(cov)) {
    return sorted.sort(compareAssignmentsByTime);
  }

  const eff = getEffectiveScheduleRulesForDate(dateKey, scheduleRules, coverageRules);
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
  const frontDesk = sorted.filter((a) => a.role === "front_desk");
  const technicians = sorted.filter((a) => a.role === "technician");

  takeUpTo(fullManagers, eff.minManagersPerShift);
  takeUpTo(frontDesk, eff.minFrontDeskPerDay);
  takeUpTo(technicians, eff.minTechniciansPerDay);

  for (const a of sorted) {
    if (picked.length >= eff.minTotalStaffPerDay) break;
    const k = assignmentStaffKey(a);
    if (!k || taken.has(k)) continue;
    picked.push(a);
    taken.add(k);
  }

  return picked.sort(compareAssignmentsByTime);
}

function buildAssignmentsForDate(staffList, availabilityDirectory, dateKey) {
  return getNormalizedStaffList(staffList)
    .map((staff) => {
      const dailyAvailability = getAvailabilityForStaffDate(staff, availabilityDirectory, dateKey);
      if (!dailyAvailability?.isAvailable) return null;
      return buildAssignment(staff, dailyAvailability);
    })
    .filter(Boolean)
    .sort(compareAssignmentsByTime);
}

function buildDayDraft({ date, staffList, availabilityDirectory, rules, coverageRules }) {
  const all = buildAssignmentsForDate(staffList, availabilityDirectory, date);
  const assignments = filterAssignmentsByCoverageTargets(all, date, rules, coverageRules);
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
function applyWeeklyRemainingHoursFill(draft, staffList) {
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

function findStaffForAssignmentList(staffList, assignment) {
  return getNormalizedStaffList(staffList).find((staff) => {
    const sid = getStaffIdentifier(staff);
    const uid = getStaffUid(staff);
    if (assignment.staffId && sid && assignment.staffId === sid) return true;
    if (assignment.uid && uid && assignment.uid === uid) return true;
    return false;
  }) || null;
}

function clampSegmentMinutesToAvailability(staff, dateKey, startMin, endMin, availabilityDirectory) {
  if (!availabilityDirectory) return { startMin, endMin };
  const avail = getAvailabilityForStaffDate(staff, availabilityDirectory, dateKey);
  if (!avail?.isAvailable) return null;
  const aS = parseScheduleTimeToMinutes(avail.startTime);
  const aE = parseScheduleTimeToMinutes(avail.endTime);
  if (aS == null || aE == null || aE <= aS) return null;
  const ns = Math.max(startMin, aS);
  const ne = Math.min(endMin, aE);
  if (ne <= ns) return null;
  return { startMin: ns, endMin: ne };
}

function isManagementRoleAssignment(a) {
  return a.role === "admin" || a.role === "manager";
}

/**
 * Splits the salon business window into equal consecutive segments among admin + manager only
 * when 2+ management staff are scheduled the same day. Front desk and technicians are unchanged.
 */
function applyEqualSplitAmongManagement(draft, staffList, businessHours) {
  const availabilityDirectory = draft.context?.availabilityDirectory;
  const bhNorm = normalizeBusinessHours(businessHours || {});

  const days = (draft.days || []).map((day) => {
    const dayName = getDayNameFromDateKey(day.date);
    const bh = dayName ? bhNorm[dayName] : null;
    if (!bh || bh.isOpen !== true) return day;

    const openM = parseScheduleTimeToMinutes(bh.openTime);
    const closeM = parseScheduleTimeToMinutes(bh.closeTime);
    if (openM == null || closeM == null || closeM <= openM) return day;

    const assignments = Array.isArray(day.assignments) ? [...day.assignments] : [];
    const bucket = assignments.filter(isManagementRoleAssignment);
    if (bucket.length < 2) return day;

    const totalMin = closeM - openM;
    const n = bucket.length;
    const sorted = [...bucket].sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" })
    );

    sorted.forEach((assign, i) => {
      const segStart = openM + Math.floor((totalMin * i) / n);
      const segEnd = i === n - 1 ? closeM : openM + Math.floor((totalMin * (i + 1)) / n);
      const staff = findStaffForAssignmentList(staffList, assign);
      const clamped = staff
        ? clampSegmentMinutesToAvailability(staff, day.date, segStart, segEnd, availabilityDirectory)
        : { startMin: segStart, endMin: segEnd };
      if (!clamped) return;
      const target = assignments.find((a) => assignmentStaffKey(a) === assignmentStaffKey(assign));
      if (!target) return;
      target.startTime = formatMinutesAsScheduleTime(clamped.startMin);
      target.endTime = formatMinutesAsScheduleTime(clamped.endMin);
    });

    assignments.sort(compareAssignmentsByTime);
    return { ...day, assignments };
  });

  return { ...draft, days };
}

function generateWeeklySchedule({ staffList = [], requests = [], rules = {}, dateRange, businessHours, coverageRules } = {}) {
  const dates = enumerateDateRange(dateRange);
  const normalizedStaffList = getNormalizedStaffList(staffList);
  const availabilityDirectory = buildAvailabilityDirectory(normalizedStaffList, requests, dateRange, { businessHours });
  const normalizedRules = normalizeScheduleRules(rules);

  const days = dates.map((date) =>
    buildDayDraft({
      date,
      staffList: normalizedStaffList,
      availabilityDirectory,
      rules: normalizedRules,
      coverageRules,
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
  draft = applyWeeklyRemainingHoursFill(draft, normalizedStaffList);
  draft = applyWeeklyHoursCapToDraft(draft, normalizedStaffList);
  draft = applyEqualSplitAmongManagement(draft, normalizedStaffList, businessHours);
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
