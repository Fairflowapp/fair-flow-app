import {
  normalizeScheduleRules,
  getEffectiveScheduleRulesForDate,
  getEffectiveWeeklyHoursCap,
  assignmentDurationHoursFromTimes,
} from "./schedule-helpers.js?v=20260403_reception_split";
import {
  buildAvailabilityDirectory,
  getAvailabilityForStaffDate,
  getNormalizedStaffList,
  getStaffIdentifier,
  getStaffUid,
  getStaffDisplayName,
  generateWeeklySchedule,
} from "./schedule-generator.js?v=20260403_mgmt_only_split";

const WARNING_SEVERITY = Object.freeze({
  no_staff_assigned: "high",
  no_manager_assigned: "high",
  assistant_manager_without_manager: "high",
  manager_count_below_minimum: "high",
  assigned_staff_unavailable: "high",
  no_front_desk_assigned: "medium",
  no_technician_assigned: "medium",
  below_min_total_staff: "medium",
  weekly_hours_exceed_cap: "medium",
});

function getWarningSeverity(code) {
  return WARNING_SEVERITY[code] || "low";
}

function buildValidationWarning(code, message, extra = {}) {
  return {
    code,
    severity: getWarningSeverity(code),
    message,
    ...extra,
  };
}

function countAssignmentsByRole(assignments) {
  const normalizedAssignments = Array.isArray(assignments) ? assignments : [];
  const managers = normalizedAssignments.filter((assignment) => assignment.role === "manager" || assignment.role === "admin");
  const fullManagers = managers.filter((assignment) => assignment.role === "admin" || assignment.managerType !== "assistant_manager");
  const assistantManagers = managers.filter((assignment) => assignment.role === "manager" && assignment.managerType === "assistant_manager");
  const technicians = normalizedAssignments.filter((assignment) => assignment.role === "technician");
  const frontDesk = normalizedAssignments.filter((assignment) => assignment.role === "front_desk");

  return {
    totalStaff: normalizedAssignments.length,
    managers,
    fullManagers,
    assistantManagers,
    technicians,
    frontDesk,
  };
}

function compareTimeValues(a, b) {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return left.localeCompare(right);
}

function assignmentViolatesAvailability(assignment, availability) {
  if (!availability?.isAvailable) return true;
  const assignmentStart = String(assignment?.startTime || "").trim();
  const assignmentEnd = String(assignment?.endTime || "").trim();
  const availabilityStart = String(availability?.startTime || "").trim();
  const availabilityEnd = String(availability?.endTime || "").trim();

  if (!assignmentStart || !assignmentEnd || !availabilityStart || !availabilityEnd) {
    return true;
  }

  if (compareTimeValues(assignmentStart, availabilityStart) < 0) return true;
  if (compareTimeValues(assignmentEnd, availabilityEnd) > 0) return true;
  if (compareTimeValues(assignmentStart, assignmentEnd) >= 0) return true;
  return false;
}

function findStaffForAssignment(staffList, assignment) {
  const normalizedStaffList = getNormalizedStaffList(staffList);
  return normalizedStaffList.find((candidate) => {
    const candidateStaffId = getStaffIdentifier(candidate);
    const candidateUid = getStaffUid(candidate);
    if (assignment.staffId && candidateStaffId && candidateStaffId === assignment.staffId) return true;
    if (assignment.uid && candidateUid && candidateUid === assignment.uid) return true;
    return false;
  }) || null;
}

function validateDraftDay({ day, staffList, availabilityDirectory, rules, coverageRules }) {
  const warnings = [];
  const date = day?.date || "";
  const normalizedRules = normalizeScheduleRules(rules);
  const effectiveRules = getEffectiveScheduleRulesForDate(date, normalizedRules, coverageRules);
  const assignments = Array.isArray(day?.assignments) ? day.assignments : [];
  const counts = countAssignmentsByRole(assignments);
  const businessStatus = day?.businessStatus || null;

  if (businessStatus && businessStatus.isOpen === false) {
    return {
      date,
      warnings,
    };
  }

  if (counts.totalStaff === 0) {
    warnings.push(buildValidationWarning(
      "no_staff_assigned",
      "No staff are assigned for this day.",
      { date }
    ));
  }

  if (counts.managers.length === 0) {
    warnings.push(buildValidationWarning(
      "no_manager_assigned",
      "No manager is assigned for this day.",
      { date }
    ));
  }

  if (counts.assistantManagers.length > 0 && counts.fullManagers.length === 0 && effectiveRules.allowAssistantManagerAlone !== true) {
    warnings.push(buildValidationWarning(
      "assistant_manager_without_manager",
      "Assistant Manager is scheduled without a full Manager.",
      {
        date,
        assistantManagerStaffIds: counts.assistantManagers.map((assignment) => assignment.staffId).filter(Boolean),
      }
    ));
  }

  if (counts.fullManagers.length < effectiveRules.minManagersPerShift) {
    warnings.push(buildValidationWarning(
      "manager_count_below_minimum",
      "Manager coverage is below the configured minimum for this day.",
      {
        date,
        minManagersPerShift: effectiveRules.minManagersPerShift,
        actualManagers: counts.fullManagers.length,
      }
    ));
  }

  if (counts.frontDesk.length < effectiveRules.minFrontDeskPerDay) {
    warnings.push(buildValidationWarning(
      "no_front_desk_assigned",
      "Front desk coverage is below the configured minimum for this day.",
      {
        date,
        minFrontDeskPerDay: effectiveRules.minFrontDeskPerDay,
        actualFrontDesk: counts.frontDesk.length,
      }
    ));
  }

  if (counts.technicians.length < effectiveRules.minTechniciansPerDay) {
    warnings.push(buildValidationWarning(
      "no_technician_assigned",
      "Technician coverage is below the configured minimum for this day.",
      {
        date,
        minTechniciansPerDay: effectiveRules.minTechniciansPerDay,
        actualTechnicians: counts.technicians.length,
      }
    ));
  }

  if (counts.totalStaff < effectiveRules.minTotalStaffPerDay) {
    warnings.push(buildValidationWarning(
      "below_min_total_staff",
      "Total staff coverage is below the configured minimum for this day.",
      {
        date,
        minTotalStaffPerDay: effectiveRules.minTotalStaffPerDay,
        actualTotalStaff: counts.totalStaff,
      }
    ));
  }

  assignments.forEach((assignment) => {
    const staff = findStaffForAssignment(staffList, assignment);
    const availability = staff ? getAvailabilityForStaffDate(staff, availabilityDirectory, date) : null;
    if (assignmentViolatesAvailability(assignment, availability)) {
      warnings.push(buildValidationWarning(
        "assigned_staff_unavailable",
        "A scheduled staff member is outside effective availability for this day.",
        {
          date,
          staffId: assignment.staffId || null,
          uid: assignment.uid || null,
          name: assignment.name || null,
        }
      ));
    }
  });

  return {
    date,
    warnings,
  };
}

function summarizeWarnings(warnings) {
  const flatWarnings = Array.isArray(warnings) ? warnings : [];
  return {
    totalWarnings: flatWarnings.length,
    highSeverityCount: flatWarnings.filter((warning) => warning.severity === "high").length,
    mediumSeverityCount: flatWarnings.filter((warning) => warning.severity === "medium").length,
    lowSeverityCount: flatWarnings.filter((warning) => warning.severity === "low").length,
  };
}

function validateWeeklyHoursAgainstDraft(draft, staffList) {
  const warnings = [];
  const totals = {};
  (draft?.days || []).forEach((day) => {
    (day.assignments || []).forEach((a) => {
      const key = String(a.staffId || a.uid || "").trim();
      if (!key) return;
      const h = assignmentDurationHoursFromTimes(a.startTime, a.endTime);
      totals[key] = (totals[key] || 0) + h;
    });
  });

  getNormalizedStaffList(staffList).forEach((staff) => {
    const cap = getEffectiveWeeklyHoursCap(staff);
    if (cap == null) return;
    const key = String(getStaffIdentifier(staff) || getStaffUid(staff) || "").trim();
    if (!key) return;
    const hours = totals[key] || 0;
    if (hours > cap + 1e-6) {
      warnings.push(buildValidationWarning(
        "weekly_hours_exceed_cap",
        `Scheduled weekly hours (${hours.toFixed(1)}h) exceed the weekly limit (${cap}h) for ${getStaffDisplayName(staff)}.`,
        {
          staffId: getStaffIdentifier(staff) || null,
          uid: getStaffUid(staff) || null,
          scheduledHours: hours,
          weeklyHoursCap: cap,
        }
      ));
    }
  });
  return warnings;
}

function getAvailabilityDirectoryForValidation({ draftSchedule, staffList, requests, dateRange }) {
  if (draftSchedule?.context?.availabilityDirectory) {
    return draftSchedule.context.availabilityDirectory;
  }
  return buildAvailabilityDirectory(staffList, requests, dateRange);
}

function validateScheduleDraft({ draftSchedule, staffList = [], requests = [], rules = {}, coverageRules, dateRange } = {}) {
  const draft = draftSchedule || generateWeeklySchedule({ staffList, requests, rules, dateRange });
  const normalizedStaffList = getNormalizedStaffList(staffList);
  const normalizedRules = normalizeScheduleRules(rules || draft.rules || {});
  const effectiveDateRange = dateRange || { startDate: draft.startDate, endDate: draft.endDate };
  const availabilityDirectory = getAvailabilityDirectoryForValidation({
    draftSchedule: draft,
    staffList: normalizedStaffList,
    requests,
    dateRange: effectiveDateRange,
  });

  const coverageRulesInput = coverageRules !== undefined && coverageRules !== null
    ? coverageRules
    : (typeof draft.coverageRules === "object" ? draft.coverageRules : undefined);

  const days = (Array.isArray(draft.days) ? draft.days : []).map((day) =>
    validateDraftDay({
      day,
      staffList: normalizedStaffList,
      availabilityDirectory,
      rules: normalizedRules,
      coverageRules: coverageRulesInput,
    })
  );

  const weeklyHoursWarnings = validateWeeklyHoursAgainstDraft(draft, normalizedStaffList);
  const warnings = [...days.flatMap((day) => day.warnings), ...weeklyHoursWarnings];

  return {
    startDate: draft.startDate || null,
    endDate: draft.endDate || null,
    rules: normalizedRules,
    days,
    warnings,
    summary: summarizeWarnings(warnings),
    metadata: {
      validatedAt: new Date().toISOString(),
      usedDraftSchedule: Boolean(draftSchedule),
      usedEffectiveAvailability: true,
      reusedDraftAvailabilityContext: Boolean(draftSchedule?.context?.availabilityDirectory),
      usedPerDayCoverageRules: Boolean(coverageRulesInput && typeof coverageRulesInput === "object"),
    },
  };
}

const scheduleValidator = {
  validateScheduleDraft,
  validateDraftDay,
  getWarningSeverity,
};

if (typeof window !== "undefined") {
  window.ffScheduleValidator = scheduleValidator;
  window.validateScheduleDraft = validateScheduleDraft;
}

export {
  validateScheduleDraft,
  validateDraftDay,
  getWarningSeverity,
};
