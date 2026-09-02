// schedule-helpers.js
// Schedule helpers entry — re-exports the full public API and attaches the
// legacy window.ffScheduleHelpers object. Core logic lives in
// schedule-helpers-core.js; staff/coverage logic in schedule-helpers-staff.js.

import * as core from "./schedule-helpers-core.js?v=20260816_sat_open";
import * as staff from "./schedule-helpers-staff.js?v=20260902_sched_dual";

const scheduleHelpers = { ...core, ...staff };

if (typeof window !== "undefined") {
  window.ffScheduleHelpers = scheduleHelpers;
  window.getStaffRoleLevel = staff.getStaffRoleLevel;
  window.canWorkAlone = staff.canWorkAlone;
  window.hasRequiredManager = staff.hasRequiredManager;
  window.validateStaffConstraints = staff.validateStaffConstraints;
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
} from "./schedule-helpers-core.js?v=20260816_sat_open";
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
} from "./schedule-helpers-staff.js?v=20260902_sched_dual";
