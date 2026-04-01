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
  return {
    isOpen: source.isOpen === true,
    openTime: normalizeTimeString(source.openTime, fallback.openTime),
    closeTime: normalizeTimeString(source.closeTime, fallback.closeTime),
  };
}

function normalizeSpecialBusinessDayEntry(value) {
  const source = value && typeof value === "object" ? value : {};
  const isClosed = source.isClosed === true;
  return {
    isClosed,
    openTime: isClosed ? null : normalizeTimeString(source.openTime, null),
    closeTime: isClosed ? null : normalizeTimeString(source.closeTime, null),
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

function normalizeSpecialBusinessDays(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalized = cloneDefaultSpecialBusinessDays();
  Object.keys(source).forEach((dateKey) => {
    if (!isValidDateKey(dateKey)) return;
    normalized[dateKey] = normalizeSpecialBusinessDayEntry(source[dateKey]);
  });
  return normalized;
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
  if (normalizedStaff.constraints.maxWeeklyHours != null && Number.isFinite(projectedWeeklyHours) && projectedWeeklyHours > normalizedStaff.constraints.maxWeeklyHours) {
    reasons.push("Staff member exceeds max weekly hours.");
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
  cloneDefaultCoverageRules,
  cloneDefaultSpecialBusinessDays,
  normalizeEmploymentType,
  normalizeWeeklyHoursTarget,
  normalizeDefaultSchedule,
  normalizeConstraints,
  normalizeManagerType,
  normalizeRolesHierarchy,
  normalizeScheduleRules,
  normalizeBusinessHours,
  normalizeCoverageRules,
  normalizeSpecialBusinessDays,
  normalizeStaffSchedulingData,
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
  cloneDefaultCoverageRules,
  cloneDefaultSpecialBusinessDays,
  normalizeEmploymentType,
  normalizeWeeklyHoursTarget,
  normalizeDefaultSchedule,
  normalizeConstraints,
  normalizeManagerType,
  normalizeRolesHierarchy,
  normalizeScheduleRules,
  normalizeBusinessHours,
  normalizeCoverageRules,
  normalizeSpecialBusinessDays,
  normalizeStaffSchedulingData,
  getStaffRoleLevel,
  canWorkAlone,
  hasRequiredManager,
  validateStaffConstraints,
};
