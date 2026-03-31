import {
  enumerateDateRange,
  getEffectiveAvailability,
} from "./schedule-availability.js?v=20260331_schedule_phase6_staff_profile";
import {
  normalizeManagerType,
  normalizeScheduleRules,
  normalizeStaffSchedulingData,
} from "./schedule-helpers.js?v=20260331_schedule_phase6_staff_profile";

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

function buildAvailabilityDirectory(staffList, requests, dateRange) {
  const byStaffId = {};
  const byUid = {};

  getNormalizedStaffList(staffList).forEach((staff) => {
    const availability = getEffectiveAvailability(staff, requests, dateRange);
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

function buildAssignmentsForDate(staffList, availabilityDirectory, dateKey) {
  return getNormalizedStaffList(staffList)
    .map((staff) => {
      const dailyAvailability = getAvailabilityForStaffDate(staff, availabilityDirectory, dateKey);
      if (!dailyAvailability?.isAvailable) return null;
      return buildAssignment(staff, dailyAvailability);
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftStart = String(left.startTime || "");
      const rightStart = String(right.startTime || "");
      if (leftStart !== rightStart) return leftStart.localeCompare(rightStart);
      return String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" });
    });
}

function buildDayDraft({ date, staffList, availabilityDirectory, rules }) {
  const assignments = buildAssignmentsForDate(staffList, availabilityDirectory, date);
  return {
    date,
    assignments,
  };
}

function generateWeeklySchedule({ staffList = [], requests = [], rules = {}, dateRange } = {}) {
  const dates = enumerateDateRange(dateRange);
  const normalizedStaffList = getNormalizedStaffList(staffList);
  const availabilityDirectory = buildAvailabilityDirectory(normalizedStaffList, requests, dateRange);
  const normalizedRules = normalizeScheduleRules(rules);

  const days = dates.map((date) =>
    buildDayDraft({
      date,
      staffList: normalizedStaffList,
      availabilityDirectory,
      rules: normalizedRules,
    })
  );

  return {
    startDate: dates[0] || null,
    endDate: dates[dates.length - 1] || null,
    rules: normalizedRules,
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
