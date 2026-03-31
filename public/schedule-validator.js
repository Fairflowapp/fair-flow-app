import {
  normalizeScheduleRules,
} from "./schedule-helpers.js?v=20260331_schedule_phase6_staff_profile";
import {
  buildAvailabilityDirectory,
  getAvailabilityForStaffDate,
  getNormalizedStaffList,
  getStaffIdentifier,
  getStaffUid,
  generateWeeklySchedule,
} from "./schedule-generator.js?v=20260331_schedule_phase6_staff_profile";

const WARNING_SEVERITY = Object.freeze({
  no_staff_assigned: "high",
  no_manager_assigned: "high",
  assistant_manager_without_manager: "high",
  manager_count_below_minimum: "high",
  assigned_staff_unavailable: "high",
  no_front_desk_assigned: "medium",
  no_technician_assigned: "medium",
  below_min_total_staff: "medium",
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

function validateDraftDay({ day, staffList, availabilityDirectory, rules }) {
  const warnings = [];
  const normalizedRules = normalizeScheduleRules(rules);
  const assignments = Array.isArray(day?.assignments) ? day.assignments : [];
  const counts = countAssignmentsByRole(assignments);
  const date = day?.date || "";

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

  if (counts.assistantManagers.length > 0 && counts.fullManagers.length === 0 && normalizedRules.allowAssistantManagerAlone !== true) {
    warnings.push(buildValidationWarning(
      "assistant_manager_without_manager",
      "Assistant Manager is scheduled without a full Manager.",
      {
        date,
        assistantManagerStaffIds: counts.assistantManagers.map((assignment) => assignment.staffId).filter(Boolean),
      }
    ));
  }

  if (counts.fullManagers.length < normalizedRules.minManagersPerShift) {
    warnings.push(buildValidationWarning(
      "manager_count_below_minimum",
      "Manager coverage is below the configured minimum for this day.",
      {
        date,
        minManagersPerShift: normalizedRules.minManagersPerShift,
        actualManagers: counts.fullManagers.length,
      }
    ));
  }

  if (counts.frontDesk.length < normalizedRules.minFrontDeskPerDay) {
    warnings.push(buildValidationWarning(
      "no_front_desk_assigned",
      "Front desk coverage is below the configured minimum for this day.",
      {
        date,
        minFrontDeskPerDay: normalizedRules.minFrontDeskPerDay,
        actualFrontDesk: counts.frontDesk.length,
      }
    ));
  }

  if (counts.technicians.length < normalizedRules.minTechniciansPerDay) {
    warnings.push(buildValidationWarning(
      "no_technician_assigned",
      "Technician coverage is below the configured minimum for this day.",
      {
        date,
        minTechniciansPerDay: normalizedRules.minTechniciansPerDay,
        actualTechnicians: counts.technicians.length,
      }
    ));
  }

  if (counts.totalStaff < normalizedRules.minTotalStaffPerDay) {
    warnings.push(buildValidationWarning(
      "below_min_total_staff",
      "Total staff coverage is below the configured minimum for this day.",
      {
        date,
        minTotalStaffPerDay: normalizedRules.minTotalStaffPerDay,
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

function getAvailabilityDirectoryForValidation({ draftSchedule, staffList, requests, dateRange }) {
  if (draftSchedule?.context?.availabilityDirectory) {
    return draftSchedule.context.availabilityDirectory;
  }
  return buildAvailabilityDirectory(staffList, requests, dateRange);
}

function validateScheduleDraft({ draftSchedule, staffList = [], requests = [], rules = {}, dateRange } = {}) {
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

  const days = (Array.isArray(draft.days) ? draft.days : []).map((day) =>
    validateDraftDay({
      day,
      staffList: normalizedStaffList,
      availabilityDirectory,
      rules: normalizedRules,
    })
  );

  const warnings = days.flatMap((day) => day.warnings);

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
