import {
  normalizeScheduleRules,
  getEffectiveScheduleRulesForDate,
  getEffectiveWeeklyHoursCap,
  assignmentDurationHoursFromTimes,
  parseScheduleTimeToMinutes,
  formatMinutesAsScheduleTime,
  getDayNameFromDateKey,
  getCustomSegmentOverlapCoverageGaps,
  buildSegmentOverlapCoverageGapsFromSegments,
  isFullManagerAssignmentForCoverage,
  isAssistantManagerAssignmentForCoverage,
  countAssignmentsOverlappingMinuteRange,
} from "./schedule-helpers.js?v=20260420_per_loc_no_default";
import {
  buildAvailabilityDirectory,
  getAvailabilityForStaffDate,
  getNormalizedStaffList,
  getStaffIdentifier,
  getStaffUid,
  getStaffDisplayName,
  generateWeeklySchedule,
} from "./schedule-generator.js?v=20260420_cross_loc_busy";

const WARNING_SEVERITY = Object.freeze({
  no_staff_assigned: "high",
  no_manager_assigned: "high",
  assistant_manager_without_manager: "high",
  manager_count_below_minimum: "high",
  assigned_staff_unavailable: "high",
  no_front_desk_assigned: "medium",
  assistant_manager_count_below_minimum: "medium",
  segment_coverage_shortfall: "medium",
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

/**
 * Returns a violation description, or null if the assignment fits effective availability + business hours.
 * Effective window already includes approved late_start / early_leave (schedule-availability).
 */
function getAvailabilityViolationDetail(assignment, availability, businessStatus) {
  if (assignment?.manualAdminEdit === true) return null;

  if (!availability?.isAvailable) {
    const ovs = Array.isArray(availability?.overrides) ? availability.overrides : [];
    const blocking = ovs.filter((o) => o && o.mode === "unavailable");
    const types = blocking.map((o) => o.type).filter(Boolean);
    return {
      conflictKind: "full_day_unavailable",
      message: types.length
        ? `Not available: approved time-off / schedule hold (${types.join(", ")}). Adjust the shift or the approved request in Inbox.`
        : "Staff is not available this day.",
      overrideTypes: types,
    };
  }

  const aS = parseScheduleTimeToMinutes(assignment?.startTime);
  const aE = parseScheduleTimeToMinutes(assignment?.endTime);
  if (aS == null || aE == null || aE <= aS) {
    return { conflictKind: "invalid_shift", message: "Shift has invalid start/end times." };
  }

  const vS = parseScheduleTimeToMinutes(availability?.startTime);
  const vE = parseScheduleTimeToMinutes(availability?.endTime);
  if (vS == null || vE == null || vE <= vS) {
    return { conflictKind: "invalid_availability", message: "Effective availability window is invalid." };
  }

  const ovs = Array.isArray(availability?.overrides) ? availability.overrides : [];
  const hasLate = ovs.some((o) => o && o.mode === "late_start");
  const hasEarly = ovs.some((o) => o && o.mode === "early_leave");

  if (aS < vS) {
    const lateOv = ovs.find((o) => o && o.mode === "late_start");
    const approved = lateOv?.requestedTime || availability.startTime;
    return {
      conflictKind: "late_start",
      message: hasLate
        ? `Shift starts at ${assignment.startTime}, before the approved late start (${approved}).`
        : `Shift starts at ${assignment.startTime}, before effective availability (${availability.startTime}).`,
    };
  }
  if (aE > vE) {
    const earlyOv = ovs.find((o) => o && o.mode === "early_leave");
    const approved = earlyOv?.requestedTime || availability.endTime;
    return {
      conflictKind: "early_leave",
      message: hasEarly
        ? `Shift ends at ${assignment.endTime}, after the approved early leave (${approved}).`
        : `Shift ends at ${assignment.endTime}, after effective availability (${availability.endTime}).`,
    };
  }

  if (businessStatus?.isOpen === true) {
    const bo = parseScheduleTimeToMinutes(businessStatus.openTime);
    const bc = parseScheduleTimeToMinutes(businessStatus.closeTime);
    if (bo != null && bc != null && bc > bo && (aS < bo || aE > bc)) {
      return {
        conflictKind: "business_hours",
        message: `Shift (${assignment.startTime}–${assignment.endTime}) is outside salon business hours (${businessStatus.openTime}–${businessStatus.closeTime}).`,
      };
    }
  }

  return null;
}

function assignmentViolatesAvailability(assignment, availability, businessStatus) {
  return getAvailabilityViolationDetail(assignment, availability, businessStatus) !== null;
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

function validateDraftDay({ day, staffList, availabilityDirectory, rules, coverageRules, businessHours, dayShiftSegments } = {}) {
  const warnings = [];
  const date = day?.date || "";
  const normalizedRules = normalizeScheduleRules(rules);
  const bh = businessHours !== undefined ? businessHours : (typeof window !== "undefined" && window.settings?.businessHours);
  const dss = dayShiftSegments !== undefined ? dayShiftSegments : (typeof window !== "undefined" && window.settings?.dayShiftSegments);
  const covInput = coverageRules !== undefined && coverageRules !== null
    ? coverageRules
    : (typeof window !== "undefined" && window.settings?.coverageRules);
  const effectiveRules = getEffectiveScheduleRulesForDate(date, normalizedRules, covInput, { businessHours: bh, dayShiftSegments: dss });
  const assignments = Array.isArray(day?.assignments) ? day.assignments : [];
  const counts = countAssignmentsByRole(assignments);
  const businessStatus = day?.businessStatus || null;
  const dayName = getDayNameFromDateKey(date);
  /** Must match `getBusinessStatusForDate` / board: same segment list as `applyBusinessSettingsToDraft`. */
  let segmentOverlapGaps = null;
  if (dayName && covInput && bh && dss) {
    if (
      businessStatus &&
      businessStatus.isOpen !== false &&
      Array.isArray(businessStatus.shiftSegments) &&
      businessStatus.shiftSegments.length > 0
    ) {
      segmentOverlapGaps = buildSegmentOverlapCoverageGapsFromSegments(
        dayName,
        businessStatus.shiftSegments,
        covInput,
      );
    } else {
      segmentOverlapGaps = getCustomSegmentOverlapCoverageGaps(dayName, bh, dss, covInput);
    }
  }
  const useOverlapSegmentValidation = Array.isArray(segmentOverlapGaps) && segmentOverlapGaps.length > 0;

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

  const minM = Math.max(0, Math.round(Number(effectiveRules.minManagersPerShift) || 0));
  const minAsst = Math.max(0, Math.round(Number(effectiveRules.minFrontDeskPerDay) || 0));

  if (counts.totalStaff > 0 && useOverlapSegmentValidation) {
    segmentOverlapGaps.forEach((gap) => {
      const parts = [];
      if (gap.needFull > 0) {
        const actual = countAssignmentsOverlappingMinuteRange(assignments, gap.startMin, gap.endMin, isFullManagerAssignmentForCoverage);
        if (actual < gap.needFull) {
          parts.push(`need ${gap.needFull} full manager(s), have ${actual}`);
        }
      }
      if (gap.needAsst > 0) {
        const actual = countAssignmentsOverlappingMinuteRange(assignments, gap.startMin, gap.endMin, isAssistantManagerAssignmentForCoverage);
        if (actual < gap.needAsst) {
          parts.push(`need ${gap.needAsst} assistant manager(s), have ${actual}`);
        }
      }
      if (gap.needTech > 0) {
        const actual = countAssignmentsOverlappingMinuteRange(assignments, gap.startMin, gap.endMin, (a) => a.role === "technician");
        if (actual < gap.needTech) {
          parts.push(`need ${gap.needTech} service provider(s), have ${actual}`);
        }
      }
      if (parts.length) {
        const rangeLabel = `${formatMinutesAsScheduleTime(gap.startMin)}–${formatMinutesAsScheduleTime(gap.endMin)}`;
        warnings.push(buildValidationWarning(
          "segment_coverage_shortfall",
          `Coverage below segment minimums ${rangeLabel}: ${parts.join("; ")}.`,
          {
            date,
            rangeLabel,
            startMin: gap.startMin,
            endMin: gap.endMin,
            needFull: gap.needFull,
            needAsst: gap.needAsst,
            needTech: gap.needTech,
          }
        ));
      }
    });
  } else if (counts.totalStaff > 0) {
    if (counts.fullManagers.length < minM) {
      warnings.push(buildValidationWarning(
        "manager_count_below_minimum",
        "Full manager coverage (Manager or Admin, not Assistant Manager) is below the configured minimum for this day.",
        {
          date,
          minManagersPerShift: effectiveRules.minManagersPerShift,
          actualFullManagers: counts.fullManagers.length,
        }
      ));
    }

    if (counts.assistantManagers.length < minAsst) {
      warnings.push(buildValidationWarning(
        "assistant_manager_count_below_minimum",
        "Assistant Manager coverage is below the configured minimum for this day.",
        {
          date,
          minFrontDeskPerDay: effectiveRules.minFrontDeskPerDay,
          actualAssistantManagers: counts.assistantManagers.length,
        }
      ));
    }
  }

  if (effectiveRules.allowAssistantManagerAlone !== true) {
    if (useOverlapSegmentValidation && Array.isArray(segmentOverlapGaps) && segmentOverlapGaps.length > 0) {
      segmentOverlapGaps.forEach((gap) => {
        const asstN = countAssignmentsOverlappingMinuteRange(
          assignments,
          gap.startMin,
          gap.endMin,
          isAssistantManagerAssignmentForCoverage,
        );
        const fullN = countAssignmentsOverlappingMinuteRange(
          assignments,
          gap.startMin,
          gap.endMin,
          isFullManagerAssignmentForCoverage,
        );
        if (asstN > 0 && fullN === 0) {
          const rangeLabel = `${formatMinutesAsScheduleTime(gap.startMin)}–${formatMinutesAsScheduleTime(gap.endMin)}`;
          warnings.push(buildValidationWarning(
            "assistant_manager_without_manager",
            `Assistant Manager is scheduled without overlapping full Manager or Admin coverage during ${rangeLabel}.`,
            {
              date,
              rangeLabel,
              assistantManagerStaffIds: counts.assistantManagers.map((assignment) => assignment.staffId).filter(Boolean),
            }
          ));
        }
      });
    } else if (counts.assistantManagers.length > 0 && counts.fullManagers.length === 0) {
      warnings.push(buildValidationWarning(
        "assistant_manager_without_manager",
        "Assistant Manager is scheduled without a full Manager.",
        {
          date,
          assistantManagerStaffIds: counts.assistantManagers.map((assignment) => assignment.staffId).filter(Boolean),
        }
      ));
    }
  }

  if (!useOverlapSegmentValidation && counts.technicians.length < effectiveRules.minTechniciansPerDay) {
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

  /* Segment overlap mode already enforces concurrent staffing per sub-interval; the legacy
     per-day minTotalStaff target often disagrees (e.g. min total 4 vs three roles covering segments). */
  if (
    !useOverlapSegmentValidation &&
    counts.totalStaff < effectiveRules.minTotalStaffPerDay
  ) {
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
    if (!staff) {
      warnings.push(buildValidationWarning(
        "assigned_staff_unavailable",
        "Could not match this assignment to a staff profile for availability.",
        {
          date,
          staffId: assignment.staffId || null,
          uid: assignment.uid || null,
          name: assignment.name || null,
          conflictKind: "unknown_staff",
        }
      ));
      return;
    }
    const availability = getAvailabilityForStaffDate(staff, availabilityDirectory, date);
    const detail = getAvailabilityViolationDetail(assignment, availability, businessStatus);
    if (detail) {
      const ovs = Array.isArray(availability?.overrides) ? availability.overrides : [];
      const blocking = ovs.filter((o) => o && o.mode === "unavailable");
      const types = blocking.map((o) => o.type).filter(Boolean);
      const hasApprovedTimeOff = types.some((t) =>
        t === "vacation" || t === "day_off" || t === "time_off" || t === "schedule_change"
      );
      const hasPartial =
        detail.conflictKind === "late_start" ||
        detail.conflictKind === "early_leave" ||
        hasApprovedTimeOff;
      warnings.push(buildValidationWarning(
        "assigned_staff_unavailable",
        detail.message,
        {
          date,
          staffId: assignment.staffId || null,
          uid: assignment.uid || null,
          name: assignment.name || null,
          conflictKind: detail.conflictKind || null,
          conflictWithApprovedInboxRequest: hasPartial,
          overrideTypes: detail.overrideTypes || types,
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

  const businessHours = typeof window !== "undefined" && window.settings?.businessHours;
  const dayShiftSegments = typeof window !== "undefined" && window.settings?.dayShiftSegments;
  const days = (Array.isArray(draft.days) ? draft.days : []).map((day) =>
    validateDraftDay({
      day,
      staffList: normalizedStaffList,
      availabilityDirectory,
      rules: normalizedRules,
      coverageRules: coverageRulesInput,
      businessHours,
      dayShiftSegments,
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
