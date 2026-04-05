import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "./app.js?v=20260329_training_fix1";
import { generateWeeklySchedule } from "./schedule-generator.js?v=20260403_mgmt_only_split";
import { validateScheduleDraft } from "./schedule-validator.js?v=20260403_avail_business_bounds";

let schedulePreviewWeekStart = getStartOfWeek(new Date());
let schedulePreviewState = {
  draft: null,
  validation: null,
  weekRange: null,
  staffList: [],
};
let schedulePreviewView = "management";
let scheduleDragState = null;
let scheduleShiftEditPayload = null;

function escapeScheduleAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function ensureScheduleShiftEditModal() {
  if (document.getElementById("scheduleShiftEditBackdrop")) {
    return document.getElementById("scheduleShiftEditBackdrop");
  }
  const backdrop = document.createElement("div");
  backdrop.id = "scheduleShiftEditBackdrop";
  backdrop.style.cssText = "display:none;position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:4000;align-items:center;justify-content:center;padding:16px;";
  backdrop.innerHTML = `
    <div role="dialog" aria-modal="true" style="background:#fff;border-radius:16px;padding:20px 22px;max-width:360px;width:100%;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);">
      <div id="scheduleShiftEditTitle" style="font-size:16px;font-weight:700;color:#111827;margin-bottom:14px;">Edit shift</div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <label style="font-size:12px;color:#6b7280;">Start
          <input type="time" id="scheduleShiftEditStart" step="300" style="width:100%;margin-top:4px;height:40px;border:1px solid #e5e7eb;border-radius:8px;padding:0 10px;box-sizing:border-box;" />
        </label>
        <label style="font-size:12px;color:#6b7280;">End
          <input type="time" id="scheduleShiftEditEnd" step="300" style="width:100%;margin-top:4px;height:40px;border:1px solid #e5e7eb;border-radius:8px;padding:0 10px;box-sizing:border-box;" />
        </label>
      </div>
      <div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end;">
        <button type="button" id="scheduleShiftEditCancel" style="padding:8px 14px;border-radius:8px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-weight:600;cursor:pointer;">Cancel</button>
        <button type="button" id="scheduleShiftEditSave" style="padding:8px 14px;border-radius:8px;border:none;background:#7c3aed;color:#fff;font-weight:600;cursor:pointer;">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeScheduleShiftEdit();
  });
  document.getElementById("scheduleShiftEditCancel")?.addEventListener("click", closeScheduleShiftEdit);
  document.getElementById("scheduleShiftEditSave")?.addEventListener("click", saveScheduleShiftEdit);
  return backdrop;
}

function openScheduleShiftEdit({ staffKey, dateKey, startTime, endTime, staffName }) {
  const backdrop = ensureScheduleShiftEditModal();
  scheduleShiftEditPayload = { staffKey, dateKey };
  const title = document.getElementById("scheduleShiftEditTitle");
  if (title) title.textContent = staffName ? `Edit shift — ${staffName}` : "Edit shift";
  const toInput = (t) => {
    const s = String(t || "").trim();
    return /^\d{2}:\d{2}$/.test(s) ? s : "09:00";
  };
  const startEl = document.getElementById("scheduleShiftEditStart");
  const endEl = document.getElementById("scheduleShiftEditEnd");
  if (startEl) startEl.value = toInput(startTime);
  if (endEl) endEl.value = toInput(endTime);
  backdrop.style.display = "flex";
}

function closeScheduleShiftEdit() {
  const backdrop = document.getElementById("scheduleShiftEditBackdrop");
  if (backdrop) backdrop.style.display = "none";
  scheduleShiftEditPayload = null;
}

function hhmmFromTimeInput(v) {
  const s = String(v || "").trim();
  return /^\d{2}:\d{2}$/.test(s) ? s : null;
}

function saveScheduleShiftEdit() {
  if (!scheduleShiftEditPayload || !schedulePreviewState.draft) return;
  const start = hhmmFromTimeInput(document.getElementById("scheduleShiftEditStart")?.value);
  const end = hhmmFromTimeInput(document.getElementById("scheduleShiftEditEnd")?.value);
  if (!start || !end) {
    window.alert("Please enter valid start and end times.");
    return;
  }
  if (start >= end) {
    window.alert("End time must be after start time.");
    return;
  }
  const { staffKey, dateKey } = scheduleShiftEditPayload;
  let draft = cloneScheduleDraft(schedulePreviewState.draft);
  const day = findDraftDay(draft, dateKey);
  if (!day) return;
  const idx = (day.assignments || []).findIndex((a) => String(a.staffId || a.uid || "").trim() === staffKey);
  if (idx < 0) return;
  day.assignments[idx] = {
    ...day.assignments[idx],
    startTime: start,
    endTime: end,
  };
  draft = applyBusinessSettingsToDraft(draft);
  revalidateLocalDraft(draft);
  renderScheduleSummary(schedulePreviewState.validation, schedulePreviewState.validation?.days || []);
  renderScheduleBoard(schedulePreviewState.draft, schedulePreviewState.validation, schedulePreviewState.staffList);
  closeScheduleShiftEdit();
}

function bindScheduleShiftEditButtons() {
  document.querySelectorAll("[data-schedule-edit-btn]").forEach((btn) => {
    if (btn.__ffEditBound) return;
    btn.__ffEditBound = true;
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const staffKey = String(btn.getAttribute("data-staff-id") || "").trim();
      const dateKey = String(btn.getAttribute("data-date") || "").trim();
      const startTime = String(btn.getAttribute("data-start") || "").trim();
      const endTime = String(btn.getAttribute("data-end") || "").trim();
      const staffName = String(btn.getAttribute("data-staff-name") || "").trim();
      openScheduleShiftEdit({ staffKey, dateKey, startTime, endTime, staffName });
    });
  });
}

function getWeekStartsOnPreference() {
  const globalValue = (window.settings && window.settings.preferences && window.settings.preferences.weekStartsOn) || "";
  if (String(globalValue).toLowerCase() === "sunday") return "sunday";
  return "monday";
}

function getStartOfWeek(date) {
  const local = new Date(date);
  local.setHours(0, 0, 0, 0);
  const day = local.getDay();
  const weekStartsOn = getWeekStartsOnPreference();
  const diff = weekStartsOn === "sunday"
    ? -day
    : (day === 0 ? -6 : 1 - day);
  local.setDate(local.getDate() + diff);
  return local;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function syncScheduleWeekFilterUi() {
  const filterSelect = document.getElementById("scheduleWeekFilter");
  const customDateInput = document.getElementById("scheduleCustomWeekDate");
  const applyCustomButton = document.getElementById("scheduleApplyCustomWeekBtn");
  const isCustom = filterSelect?.value === "custom";
  if (customDateInput) {
    customDateInput.style.display = isCustom ? "inline-flex" : "none";
  }
  if (applyCustomButton) {
    applyCustomButton.style.display = isCustom ? "inline-flex" : "none";
  }
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getWeekRange(weekStartDate) {
  const start = getStartOfWeek(weekStartDate);
  const end = addDays(start, 6);
  return {
    startDate: toDateKey(start),
    endDate: toDateKey(end),
    start: start,
    end: end,
  };
}

function formatLongDate(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function formatWeekLabel(weekRange) {
  const start = weekRange?.start;
  const end = weekRange?.end;
  if (!start || !end) return "Schedule Preview";
  const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endLabel = end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${startLabel} - ${endLabel}`;
}

function getSeverityBadgeStyle(severity) {
  if (severity === "high") return "background:#fee2e2;color:#b91c1c;border:1px solid #fecaca;";
  if (severity === "medium") return "background:#fef3c7;color:#b45309;border:1px solid #fde68a;";
  return "background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd;";
}

function getScheduleStaffRole(staff) {
  if (staff?.isAdmin === true) return "admin";
  const role = String(staff?.role || "").trim().toLowerCase();
  if (staff?.isManager === true || role === "manager" || role === "assistant_manager") return "manager";
  if (role === "front_desk") return "front_desk";
  return "technician";
}

function isManagementScheduleStaff(staff) {
  const role = getScheduleStaffRole(staff);
  return role === "admin" || role === "manager" || role === "front_desk";
}

function isTechnicianScheduleStaff(staff) {
  return getScheduleStaffRole(staff) === "technician";
}

function getFilteredScheduleStaff(staffList) {
  const filtered = (Array.isArray(staffList) ? staffList : []).filter((staff) => {
    return schedulePreviewView === "technicians"
      ? isTechnicianScheduleStaff(staff)
      : isManagementScheduleStaff(staff);
  });

  return filtered.sort((left, right) => {
    const leftRole = getScheduleStaffRole(left);
    const rightRole = getScheduleStaffRole(right);
    const leftRank = leftRole === "admin" ? 0 : leftRole === "manager" ? 1 : leftRole === "front_desk" ? 2 : 3;
    const rightRank = rightRole === "admin" ? 0 : rightRole === "manager" ? 1 : rightRole === "front_desk" ? 2 : 3;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return String(left?.name || "").localeCompare(String(right?.name || ""), undefined, { sensitivity: "base" });
  });
}

function getScheduleStaffKey(staff) {
  return String(staff?.id || staff?.staffId || staff?.uid || staff?.userUid || "").trim();
}

function buildAssignmentLookup(draft) {
  const lookup = new Map();
  (Array.isArray(draft?.days) ? draft.days : []).forEach((day) => {
    (Array.isArray(day.assignments) ? day.assignments : []).forEach((assignment) => {
      const key = String(assignment.staffId || assignment.uid || "").trim();
      if (!key) return;
      lookup.set(`${key}::${day.date}`, assignment);
    });
  });
  return lookup;
}

function getAssignmentId(assignment, dateKey) {
  const rawId = String(assignment?.shiftId || assignment?.id || "").trim();
  if (rawId) return rawId;
  const staffId = String(assignment?.staffId || assignment?.uid || "").trim();
  return `${staffId}::${dateKey}`;
}

function cloneScheduleDraft(draft) {
  return {
    ...draft,
    days: (Array.isArray(draft?.days) ? draft.days : []).map((day) => ({
      ...day,
      assignments: (Array.isArray(day.assignments) ? day.assignments : []).map((assignment) => ({ ...assignment })),
    })),
    context: draft?.context ? { ...draft.context } : draft?.context,
    metadata: draft?.metadata ? { ...draft.metadata } : draft?.metadata,
  };
}

function findDraftDay(draft, dateKey) {
  return (Array.isArray(draft?.days) ? draft.days : []).find((day) => day.date === dateKey) || null;
}

function getStaffByScheduleKey(staffList, scheduleKey) {
  return (Array.isArray(staffList) ? staffList : []).find((staff) => getScheduleStaffKey(staff) === scheduleKey) || null;
}

function remapAssignmentToStaff(assignment, staff) {
  const mapped = { ...assignment };
  const targetKey = getScheduleStaffKey(staff);
  const targetUid = String(staff?.uid || staff?.userUid || "").trim() || null;
  mapped.staffId = targetKey || null;
  mapped.uid = targetUid;
  mapped.name = String(staff?.name || mapped.name || "").trim() || mapped.name || "Unknown Staff";
  mapped.role = getScheduleStaffRole(staff);
  mapped.managerType = mapped.role === "manager" ? (staff?.managerType || "manager") : null;
  return mapped;
}

function revalidateLocalDraft(nextDraft) {
  const coverageRules = schedulePreviewState.coverageRules !== undefined
    ? schedulePreviewState.coverageRules
    : (window.settings && typeof window.settings.coverageRules === "object" ? window.settings.coverageRules : undefined);
  const nextValidation = validateScheduleDraft({
    draftSchedule: nextDraft,
    staffList: schedulePreviewState.staffList,
    rules: nextDraft?.rules || schedulePreviewState.draft?.rules || {},
    coverageRules,
    dateRange: schedulePreviewState.weekRange
      ? { startDate: schedulePreviewState.weekRange.startDate, endDate: schedulePreviewState.weekRange.endDate }
      : undefined,
  });

  schedulePreviewState = {
    ...schedulePreviewState,
    draft: nextDraft,
    validation: nextValidation,
  };
  if (typeof window !== "undefined") {
    window.ffSchedulePreviewState = schedulePreviewState;
  }
}

function clearDropZoneVisual(zone) {
  if (!zone) return;
  zone.style.outline = "";
  zone.style.outlineOffset = "";
}

function handleShiftDragStart(event) {
  const shiftEl = event.currentTarget;
  if (!shiftEl) return;
  const payload = {
    shiftId: String(shiftEl.getAttribute("data-shift-id") || "").trim(),
    sourceStaffId: String(shiftEl.getAttribute("data-staff-id") || "").trim(),
    sourceDate: String(shiftEl.getAttribute("data-date") || "").trim(),
  };
  scheduleDragState = payload;
  try {
    event.dataTransfer.setData("text/plain", JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "move";
  } catch (_) {}
  shiftEl.style.opacity = "0.55";
  console.log("[Schedule DnD] dragstart", payload);
}

function handleShiftDragEnd(event) {
  if (event?.currentTarget) {
    event.currentTarget.style.opacity = "1";
  }
  document.querySelectorAll('[data-drop-zone="true"]').forEach((zone) => clearDropZoneVisual(zone));
  scheduleDragState = null;
}

function handleDropZoneDragOver(event) {
  event.preventDefault();
  const zone = event.currentTarget;
  if (!zone) return;
  try {
    event.dataTransfer.dropEffect = "move";
  } catch (_) {}
  zone.style.outline = "2px dashed rgba(124,58,237,0.45)";
  zone.style.outlineOffset = "-3px";
}

function handleDropZoneDragLeave(event) {
  clearDropZoneVisual(event.currentTarget);
}

function moveDraftAssignment(payload, targetStaffId, targetDate) {
  const nextDraft = cloneScheduleDraft(schedulePreviewState.draft);
  const sourceDay = findDraftDay(nextDraft, payload.sourceDate);
  const targetDay = findDraftDay(nextDraft, targetDate);
  const sourceStaff = getStaffByScheduleKey(schedulePreviewState.staffList, payload.sourceStaffId);
  const targetStaff = getStaffByScheduleKey(schedulePreviewState.staffList, targetStaffId);
  if (!sourceDay || !targetDay || !sourceStaff || !targetStaff) return null;

  const sourceAssignments = Array.isArray(sourceDay.assignments) ? sourceDay.assignments : [];
  const targetAssignments = Array.isArray(targetDay.assignments) ? targetDay.assignments : [];

  const sourceIndex = sourceAssignments.findIndex((assignment) => {
    return getAssignmentId(assignment, payload.sourceDate) === payload.shiftId
      && String(assignment.staffId || assignment.uid || "").trim() === payload.sourceStaffId;
  });
  if (sourceIndex === -1) return null;

  const [sourceAssignment] = sourceAssignments.splice(sourceIndex, 1);
  const targetIndex = targetAssignments.findIndex((assignment) => {
    return String(assignment.staffId || assignment.uid || "").trim() === targetStaffId;
  });

  const movedAssignment = remapAssignmentToStaff(sourceAssignment, targetStaff);

  if (targetIndex >= 0) {
    const targetAssignment = targetAssignments[targetIndex];
    targetAssignments[targetIndex] = movedAssignment;
    sourceAssignments.push(remapAssignmentToStaff(targetAssignment, sourceStaff));
  } else {
    targetAssignments.push(movedAssignment);
  }

  sourceDay.assignments = sourceAssignments;
  targetDay.assignments = targetAssignments;
  return nextDraft;
}

function handleDropZoneDrop(event) {
  event.preventDefault();
  const zone = event.currentTarget;
  clearDropZoneVisual(zone);
  const targetStaffId = String(zone?.getAttribute("data-staff-id") || "").trim();
  const targetDate = String(zone?.getAttribute("data-date") || "").trim();
  const payload = scheduleDragState;
  if (!payload || !payload.shiftId || !payload.sourceStaffId || !payload.sourceDate || !targetStaffId || !targetDate) return;
  if (payload.sourceStaffId === targetStaffId && payload.sourceDate === targetDate) return;

  const nextDraft = moveDraftAssignment(payload, targetStaffId, targetDate);
  console.log("[Schedule DnD] drop", { payload, targetStaffId, targetDate });
  if (!nextDraft) return;

  revalidateLocalDraft(nextDraft);
  renderScheduleSummary(schedulePreviewState.validation, schedulePreviewState.validation?.days || []);
  renderScheduleViewTabs();
  renderScheduleBoard(schedulePreviewState.draft, schedulePreviewState.validation, schedulePreviewState.staffList);
}

function bindScheduleBoardDnD() {
  document.querySelectorAll('[data-schedule-shift="true"]').forEach((el) => {
    if (el.__ffDnDBound) return;
    el.__ffDnDBound = true;
    el.addEventListener("dragstart", handleShiftDragStart);
    el.addEventListener("dragend", handleShiftDragEnd);
  });

  document.querySelectorAll('[data-drop-zone="true"]').forEach((zone) => {
    if (zone.__ffDnDBound) return;
    zone.__ffDnDBound = true;
    zone.addEventListener("dragover", handleDropZoneDragOver);
    zone.addEventListener("dragleave", handleDropZoneDragLeave);
    zone.addEventListener("drop", handleDropZoneDrop);
  });
}

function getValidationByDate(validation) {
  return new Map((Array.isArray(validation?.days) ? validation.days : []).map((day) => [day.date, day]));
}

/** Warnings tied to configured quotas (managers/FD line, techs, totals). Not availability quirks — so counts track staffing, not side effects. */
const SCHEDULE_COVERAGE_WARNING_CODES = new Set([
  "no_staff_assigned",
  "management_line_below_minimum",
  "no_technician_assigned",
  "below_min_total_staff",
  "assistant_manager_without_manager",
  "manager_count_below_minimum",
  "no_front_desk_assigned",
  "no_manager_assigned",
]);

function filterCoverageWarnings(warnings) {
  return (Array.isArray(warnings) ? warnings : []).filter((w) => w && SCHEDULE_COVERAGE_WARNING_CODES.has(w.code));
}

function filterNonCoverageWarnings(warnings) {
  return (Array.isArray(warnings) ? warnings : []).filter((w) => w && !SCHEDULE_COVERAGE_WARNING_CODES.has(w.code));
}

function warningAppliesToStaffRow(warning, staffKey, staff) {
  if (!warning || warning.code !== "assigned_staff_unavailable") return false;
  const sid = String(warning.staffId || "").trim();
  const uid = String(warning.uid || "").trim();
  if (sid && sid === staffKey) return true;
  const staffUid = String(staff?.uid || staff?.userUid || "").trim();
  if (uid && staffUid && uid === staffUid) return true;
  return false;
}

/** Orange highlight: day has quota issues (whole column), or this row has a row-specific warning (e.g. availability). */
function cellShowsScheduleWarningDot(dayWarnings, staffKey, staff) {
  const list = Array.isArray(dayWarnings) ? dayWarnings : [];
  if (filterCoverageWarnings(list).length > 0) return true;
  return list.some((w) => warningAppliesToStaffRow(w, staffKey, staff));
}

function formatBoardDayLabel(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return { title: dateKey, subtitle: "" };
  return {
    title: date.toLocaleDateString("en-US", { weekday: "short" }),
    subtitle: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  };
}

function getDayNameFromDateKey(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][date.getDay()];
}

function normalizeTimeValue(value) {
  const candidate = String(value || "").trim();
  return /^\d{2}:\d{2}$/.test(candidate) ? candidate : null;
}

function maxTimeValue(a, b) {
  const left = normalizeTimeValue(a);
  const right = normalizeTimeValue(b);
  if (!left) return right;
  if (!right) return left;
  return left.localeCompare(right) >= 0 ? left : right;
}

function minTimeValue(a, b) {
  const left = normalizeTimeValue(a);
  const right = normalizeTimeValue(b);
  if (!left) return right;
  if (!right) return left;
  return left.localeCompare(right) <= 0 ? left : right;
}

function getBusinessStatusForDate(dateKey) {
  const dayName = getDayNameFromDateKey(dateKey);
  const businessHours = window.ffScheduleHelpers?.normalizeBusinessHours
    ? window.ffScheduleHelpers.normalizeBusinessHours(window.settings?.businessHours)
    : (window.settings?.businessHours || {});
  const specialDays = window.ffScheduleHelpers?.normalizeSpecialBusinessDays
    ? window.ffScheduleHelpers.normalizeSpecialBusinessDays(window.settings?.specialBusinessDays)
    : (window.settings?.specialBusinessDays || {});

  const baseDay = businessHours[dayName] || { isOpen: false, openTime: null, closeTime: null };
  const specialDay = specialDays[dateKey] || null;
  if (specialDay) {
    if (specialDay.isClosed === true) {
      return {
        isOpen: false,
        openTime: null,
        closeTime: null,
        source: "special_day_closed",
        note: specialDay.note || "",
      };
    }
    return {
      isOpen: true,
      openTime: specialDay.openTime || baseDay.openTime || null,
      closeTime: specialDay.closeTime || baseDay.closeTime || null,
      source: "special_day_hours",
      note: specialDay.note || "",
    };
  }

  return {
    isOpen: baseDay.isOpen === true,
    openTime: baseDay.openTime || null,
    closeTime: baseDay.closeTime || null,
    source: "business_hours",
    note: "",
  };
}

function applyBusinessSettingsToDraft(draft) {
  const nextDraft = {
    ...draft,
    days: (Array.isArray(draft?.days) ? draft.days : []).map((day) => {
      const businessStatus = getBusinessStatusForDate(day.date);
      let assignments = (Array.isArray(day.assignments) ? day.assignments : []).map((assignment) => ({ ...assignment }));

      if (!businessStatus.isOpen) {
        assignments = [];
      } else {
        assignments = assignments
          .map((assignment) => {
            const startTime = maxTimeValue(assignment.startTime, businessStatus.openTime);
            const endTime = minTimeValue(assignment.endTime, businessStatus.closeTime);
            if (!startTime || !endTime || startTime >= endTime) return null;
            return {
              ...assignment,
              startTime,
              endTime,
            };
          })
          .filter(Boolean);
      }

      return {
        ...day,
        assignments,
        businessStatus,
      };
    }),
  };

  return nextDraft;
}

function getScheduleRoleLabel(staff) {
  const role = getScheduleStaffRole(staff);
  if (role === "admin") return "Admin";
  if (role === "manager") return staff?.managerType === "assistant_manager" ? "Assistant Manager" : "Manager";
  if (role === "front_desk") return "Front Desk";
  return "Technician";
}

function renderScheduleViewTabs() {
  const managementBtn = document.getElementById("scheduleViewManagementBtn");
  const techniciansBtn = document.getElementById("scheduleViewTechniciansBtn");
  const applyState = (button, active, left) => {
    if (!button) return;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.style.setProperty("display", "inline-flex", "important");
    button.style.setProperty("align-items", "center", "important");
    button.style.setProperty("justify-content", "center", "important");
    button.style.setProperty("margin", "0", "important");
    button.style.setProperty("background", active ? "#7c3aed" : "#f9fafb", "important");
    button.style.setProperty("color", active ? "#fff" : "#6b7280", "important");
    button.style.setProperty("border-color", active ? "#7c3aed" : "#e5e7eb", "important");
    button.style.setProperty("font-weight", active ? "600" : "500", "important");
    button.style.setProperty("border-radius", left ? "8px 0 0 8px" : "0 8px 8px 0", "important");
    button.style.setProperty("box-shadow", active ? "inset 0 0 0 1px #7c3aed" : "none", "important");
    button.style.setProperty("z-index", active ? "1" : "0", "important");
  };
  applyState(managementBtn, schedulePreviewView === "management", true);
  applyState(techniciansBtn, schedulePreviewView === "technicians", false);
}

async function loadScheduleStaffList() {
  if (typeof window.ffStaffForceLoad === "function") {
    try { await window.ffStaffForceLoad(); } catch (_) {}
  }
  const store = typeof window.ffGetStaffStore === "function" ? window.ffGetStaffStore() : { staff: [] };
  return (Array.isArray(store?.staff) ? store.staff : []).filter((staff) => staff && staff.isArchived !== true);
}

async function loadApprovedScheduleRequests() {
  const salonId = String(window.currentSalonId || "").trim();
  if (!salonId) return [];
  try {
    const inboxRef = collection(db, `salons/${salonId}/inboxItems`);
    const snap = await getDocs(query(inboxRef, where("status", "==", "approved")));
    return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  } catch (error) {
    console.warn("[ScheduleUI] Failed to load approved requests via query, retrying full scan", error);
    const snap = await getDocs(collection(db, `salons/${salonId}/inboxItems`));
    return snap.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .filter((item) => String(item?.status || "").toLowerCase() === "approved");
  }
}

function renderScheduleSummary(validation, days) {
  const summaryBar = document.getElementById("scheduleSummaryBar");
  if (!summaryBar) return;
  const summary = validation?.summary || { totalWarnings: 0, highSeverityCount: 0, mediumSeverityCount: 0 };
  const dayList = Array.isArray(days) ? days : [];
  const coverageCount = dayList.reduce((n, day) => n + filterCoverageWarnings(day?.warnings).length, 0);
  const daysWithCoverageIssues = dayList.filter((day) => filterCoverageWarnings(day?.warnings).length > 0).length;
  const total = summary.totalWarnings || 0;
  const otherCount = Math.max(0, total - coverageCount);

  if (total === 0) {
    summaryBar.innerHTML = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
         <span style="display:inline-flex;padding:4px 10px;border-radius:999px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;font-size:12px;font-weight:600;">No warnings</span>
         <span style="font-size:13px;color:#6b7280;">Edit shifts with the pen icon (saved locally in this preview only).</span>
       </div>`;
    return;
  }

  const pieces = [];
  if (coverageCount > 0) {
    pieces.push(`<span style="display:inline-flex;padding:4px 10px;border-radius:999px;background:#fff7ed;color:#b45309;border:1px solid #fed7aa;font-size:12px;font-weight:600;">${coverageCount} coverage warning${coverageCount === 1 ? "" : "s"}</span>`);
    pieces.push(`<span style="font-size:13px;color:#6b7280;">${daysWithCoverageIssues} day${daysWithCoverageIssues === 1 ? "" : "s"} with coverage gaps.</span>`);
  }
  if (otherCount > 0) {
    pieces.push(`<span style="display:inline-flex;padding:4px 10px;border-radius:999px;background:#f8fafc;color:#64748b;border:1px solid #e2e8f0;font-size:12px;font-weight:600;">+${otherCount} other</span>`);
    pieces.push(`<span style="font-size:13px;color:#94a3b8;">availability / weekly limits</span>`);
  }
  if (coverageCount === 0 && otherCount > 0) {
    pieces.length = 0;
    pieces.push(`<span style="display:inline-flex;padding:4px 10px;border-radius:999px;background:#f8fafc;color:#64748b;border:1px solid #e2e8f0;font-size:12px;font-weight:600;">${otherCount} scheduling note${otherCount === 1 ? "" : "s"}</span>`);
    pieces.push(`<span style="font-size:13px;color:#94a3b8;">not quota — availability or weekly hours</span>`);
  }
  summaryBar.innerHTML = `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">${pieces.join("")}</div>`;
}

function setSchedulePreviewView(view) {
  schedulePreviewView = view === "technicians" ? "technicians" : "management";
  renderScheduleViewTabs();
  renderScheduleBoard(schedulePreviewState.draft, schedulePreviewState.validation, schedulePreviewState.staffList);
}

function renderScheduleBoard(draft, validation, staffList) {
  const board = document.getElementById("scheduleBoard");
  const empty = document.getElementById("schedulePreviewEmpty");
  if (!board || !empty) return;

  const draftDays = Array.isArray(draft?.days) ? draft.days : [];
  const validationByDate = getValidationByDate(validation);
  const filteredStaff = getFilteredScheduleStaff(staffList);
  const assignmentLookup = buildAssignmentLookup(draft);

  if (!draftDays.length || !filteredStaff.length) {
    board.innerHTML = "";
    empty.style.display = "block";
    empty.textContent = draftDays.length
      ? `No ${schedulePreviewView === "management" ? "management staff" : "technicians"} available for this week.`
      : "No schedule preview available for this week.";
    return;
  }

  empty.style.display = "none";
  const gridTemplate = `220px repeat(${draftDays.length}, minmax(120px, 1fr))`;
  const headerCells = draftDays.map((day) => {
    const allWarnings = Array.isArray(validationByDate.get(day.date)?.warnings) ? validationByDate.get(day.date).warnings : [];
    const cov = filterCoverageWarnings(allWarnings);
    const other = filterNonCoverageWarnings(allWarnings);
    const dayLabel = formatBoardDayLabel(day.date);
    const businessStatus = day.businessStatus || { isOpen: true, source: "business_hours" };
    let issueHtml = "";
    if (businessStatus.isOpen !== false) {
      if (cov.length > 0) {
        issueHtml = `<div style="margin-top:6px;font-size:11px;color:#b45309;font-weight:600;">${cov.length} coverage issue${cov.length === 1 ? "" : "s"}</div>`;
      } else if (other.length > 0) {
        issueHtml = `<div style="margin-top:6px;font-size:11px;color:#94a3b8;">${other.length} note${other.length === 1 ? "" : "s"}</div>`;
      }
    }
    return `
      <div style="padding:12px 10px;border-bottom:1px solid #e5e7eb;background:#f8fafc;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:#111827;">${dayLabel.title}</div>
        <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${dayLabel.subtitle}</div>
        ${businessStatus.isOpen === false
          ? `<div style="margin-top:6px;font-size:11px;color:#9ca3af;">Closed</div>`
          : issueHtml}
      </div>
    `;
  }).join("");

  const rowHtml = filteredStaff.map((staff) => {
    const staffKey = getScheduleStaffKey(staff);
    const roleLabel = getScheduleRoleLabel(staff);
    const cells = draftDays.map((day) => {
      const assignment = assignmentLookup.get(`${staffKey}::${day.date}`) || null;
      const warnings = Array.isArray(validationByDate.get(day.date)?.warnings) ? validationByDate.get(day.date).warnings : [];
      const hasWarnings = cellShowsScheduleWarningDot(warnings, staffKey, staff);
      const businessStatus = day.businessStatus || getBusinessStatusForDate(day.date);
      const canEditShift = Boolean(assignment && businessStatus?.isOpen !== false);
      const cellStyle = assignment
        ? `background:#f5f3ff;border:1px solid #d8b4fe;color:#5b21b6;box-shadow:${hasWarnings ? "inset 0 0 0 1px rgba(245,158,11,0.35)" : "none"};`
        : `background:#f3f4f6;border:1px solid #e5e7eb;color:#6b7280;box-shadow:${hasWarnings ? "inset 0 0 0 1px rgba(245,158,11,0.28)" : "none"};`;
      const assignmentId = assignment ? getAssignmentId(assignment, day.date) : "";
      const safeStaffName = escapeScheduleAttr(staff.name || "");
      const editBtn = canEditShift
        ? `<button type="button" data-schedule-edit-btn="true" data-staff-id="${escapeScheduleAttr(staffKey)}" data-date="${escapeScheduleAttr(day.date)}" data-start="${escapeScheduleAttr(assignment.startTime || "")}" data-end="${escapeScheduleAttr(assignment.endTime || "")}" data-staff-name="${safeStaffName}" title="Edit hours" aria-label="Edit shift hours" style="position:absolute;top:4px;left:4px;min-width:22px;min-height:22px;padding:0;border:none;background:transparent;box-shadow:none;color:#7c3aed;font-size:15px;line-height:1;cursor:pointer;opacity:0.85;z-index:2;">\u270E</button>`
        : "";
      return `
        <div data-drop-zone="true" data-staff-id="${staffKey}" data-date="${day.date}" style="position:relative;padding:10px;border-radius:12px;min-height:68px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:12px;font-weight:${assignment ? "700" : "500"};line-height:1.35;transition:outline-color 0.12s ease;${cellStyle}">
          ${hasWarnings ? `<span style="position:absolute;top:7px;right:7px;width:7px;height:7px;border-radius:50%;background:#f59e0b;opacity:0.9;"></span>` : ""}
          ${editBtn}
          <div ${assignment ? `data-schedule-shift="true" draggable="true" data-shift-id="${assignmentId}" data-staff-id="${staffKey}" data-date="${day.date}" style="cursor:grab;user-select:none;"` : ""}>
            <div>${assignment ? `${assignment.startTime || "--:--"} - ${assignment.endTime || "--:--"}` : "Off"}</div>
          </div>
        </div>
      `;
    }).join("");

    const nameControl = staffKey
      ? `<button type="button" data-schedule-staff-profile="true" data-staff-id="${escapeScheduleAttr(staffKey)}" title="לחיצה — עריכת לוח זמנים בפרופיל" aria-label="פתיחת לוח זמנים של העובד בפרופיל" style="font:inherit;font-size:13px;font-weight:700;line-height:1.3;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;width:100%;border:none;background:transparent;padding:0;margin:0;cursor:pointer;text-align:left;text-decoration:none;display:block;box-sizing:border-box;">${escapeScheduleAttr(staff.name || "Unknown Staff")}</button>`
      : `<span style="font-size:13px;font-weight:700;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeScheduleAttr(staff.name || "Unknown Staff")}</span>`;

    return `
      <div style="display:grid;grid-template-columns:${gridTemplate};align-items:stretch;">
        <div style="padding:12px 14px;border-bottom:1px solid #e5e7eb;background:#fff;display:flex;flex-direction:column;justify-content:center;gap:4px;min-width:0;">
          ${nameControl}
          <div style="font-size:11px;color:#6b7280;">${roleLabel}</div>
        </div>
        ${cells}
      </div>
    `;
  }).join("");

  board.innerHTML = `
    <section style="border:1px solid #e5e7eb;border-radius:18px;background:#fff;overflow:auto;">
      <div style="min-width:${220 + (draftDays.length * 120)}px;">
        <div style="display:grid;grid-template-columns:${gridTemplate};align-items:stretch;">
          <div style="padding:12px 14px;border-bottom:1px solid #e5e7eb;background:#f8fafc;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Staff</div>
          ${headerCells}
        </div>
        ${rowHtml}
      </div>
    </section>
  `;
  bindScheduleBoardDnD();
  bindScheduleShiftEditButtons();
  bindScheduleStaffProfileLinks();
}

function bindScheduleStaffProfileLinks() {
  const board = document.getElementById("scheduleBoard");
  if (!board || board.__ffStaffProfileBound) return;
  board.__ffStaffProfileBound = true;
  board.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-schedule-staff-profile]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const id = String(btn.getAttribute("data-staff-id") || "").trim();
    if (!id || typeof window.openStaffMemberScheduleTab !== "function") return;
    window.openStaffMemberScheduleTab(id);
  });
}

function setScheduleLoadingState({ loading = false, error = "" } = {}) {
  const loadingEl = document.getElementById("schedulePreviewLoading");
  const errorEl = document.getElementById("schedulePreviewError");
  if (loadingEl) loadingEl.style.display = loading ? "block" : "none";
  if (errorEl) {
    errorEl.style.display = error ? "block" : "none";
    errorEl.textContent = error || "";
  }
}

async function refreshSchedulePreview() {
  const weekRange = getWeekRange(schedulePreviewWeekStart);
  const weekLabel = document.getElementById("scheduleWeekLabel");
  if (weekLabel) weekLabel.textContent = formatWeekLabel(weekRange);

  setScheduleLoadingState({ loading: true, error: "" });

  try {
    const [staffList, requests] = await Promise.all([
      loadScheduleStaffList(),
      loadApprovedScheduleRequests(),
    ]);

    const rules = (window.settings && typeof window.settings.scheduleRules === "object")
      ? window.settings.scheduleRules
      : {};
    const coverageRules = (window.settings && typeof window.settings.coverageRules === "object")
      ? window.settings.coverageRules
      : undefined;
    const businessHours = (window.settings && typeof window.settings.businessHours === "object")
      ? window.settings.businessHours
      : undefined;

    const draft = generateWeeklySchedule({
      staffList,
      requests,
      rules,
      businessHours,
      coverageRules,
      dateRange: { startDate: weekRange.startDate, endDate: weekRange.endDate },
    });
    const draftWithBusinessRules = applyBusinessSettingsToDraft(draft);

    const validation = validateScheduleDraft({
      draftSchedule: draftWithBusinessRules,
      staffList,
      requests,
      rules: draftWithBusinessRules.rules,
      coverageRules,
      dateRange: { startDate: weekRange.startDate, endDate: weekRange.endDate },
    });

    schedulePreviewState = { draft: draftWithBusinessRules, validation, weekRange, staffList, coverageRules };
    if (typeof window !== "undefined") {
      window.ffSchedulePreviewState = schedulePreviewState;
    }
    renderScheduleSummary(validation, validation.days);
    renderScheduleViewTabs();
    renderScheduleBoard(draftWithBusinessRules, validation, staffList);
    setScheduleLoadingState({ loading: false, error: "" });
  } catch (error) {
    console.error("[ScheduleUI] Failed to refresh schedule preview", error);
    schedulePreviewState = { draft: null, validation: null, weekRange, staffList: [] };
    if (typeof window !== "undefined") {
      window.ffSchedulePreviewState = schedulePreviewState;
    }
    renderScheduleSummary({ summary: { totalWarnings: 0, highSeverityCount: 0 } }, []);
    renderScheduleViewTabs();
    renderScheduleBoard(null, null, []);
    setScheduleLoadingState({ loading: false, error: error?.message || "Failed to build schedule preview." });
  }
}

function applyScheduleWeekFilter() {
  const filterSelect = document.getElementById("scheduleWeekFilter");
  const customDateInput = document.getElementById("scheduleCustomWeekDate");
  const mode = filterSelect?.value || "current";

  if (mode === "previous") {
    schedulePreviewWeekStart = addDays(getStartOfWeek(new Date()), -7);
    syncScheduleWeekFilterUi();
    refreshSchedulePreview();
    return;
  }

  if (mode === "next") {
    schedulePreviewWeekStart = addDays(getStartOfWeek(new Date()), 7);
    syncScheduleWeekFilterUi();
    refreshSchedulePreview();
    return;
  }

  if (mode === "custom") {
    syncScheduleWeekFilterUi();
    const dateValue = customDateInput?.value;
    if (!dateValue) return;
    schedulePreviewWeekStart = getStartOfWeek(new Date(`${dateValue}T00:00:00`));
    refreshSchedulePreview();
    return;
  }

  schedulePreviewWeekStart = getStartOfWeek(new Date());
  syncScheduleWeekFilterUi();
  refreshSchedulePreview();
}

function hideScheduleScreen() {
  const screen = document.getElementById("scheduleScreen");
  if (screen) screen.style.display = "none";
  const btn = document.getElementById("scheduleBtn");
  if (btn) btn.classList.remove("active");
}

export async function goToSchedule() {
  if (typeof window.closeStaffMembersModal === "function") {
    window.closeStaffMembersModal();
  }
  const screenIdsToHide = [
    "tasksScreen",
    "inboxScreen",
    "chatScreen",
    "mediaScreen",
    "ticketsScreen",
    "trainingScreen",
    "userProfileScreen",
    "manageQueueScreen",
  ];
  screenIdsToHide.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });

  const ownerView = document.getElementById("owner-view");
  const joinBar = document.getElementById("joinBar");
  const queueControls = document.getElementById("queueControls");
  const wrap = document.querySelector(".wrap");
  if (ownerView) ownerView.style.display = "none";
  if (joinBar) joinBar.style.display = "none";
  if (queueControls) queueControls.style.display = "none";
  if (wrap) wrap.style.display = "none";

  const screen = document.getElementById("scheduleScreen");
  if (screen) screen.style.display = "flex";

  document.querySelectorAll(".btn-pill").forEach((button) => button.classList.remove("active"));
  const scheduleBtn = document.getElementById("scheduleBtn");
  if (scheduleBtn) scheduleBtn.classList.add("active");

  await refreshSchedulePreview();
}

function bindScheduleUi() {
  document.getElementById("scheduleBtn")?.addEventListener("click", goToSchedule);
  document.getElementById("scheduleViewManagementBtn")?.addEventListener("click", () => setSchedulePreviewView("management"));
  document.getElementById("scheduleViewTechniciansBtn")?.addEventListener("click", () => setSchedulePreviewView("technicians"));
  document.getElementById("scheduleWeekFilter")?.addEventListener("change", () => {
    syncScheduleWeekFilterUi();
    const mode = document.getElementById("scheduleWeekFilter")?.value || "current";
    if (mode !== "custom") applyScheduleWeekFilter();
  });
  document.getElementById("scheduleApplyCustomWeekBtn")?.addEventListener("click", applyScheduleWeekFilter);

  ["queueBtn", "ticketsBtn", "tasksBtn", "chatBtn", "inboxBtn", "mediaBtn", "appsBtn"].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn && !btn.__ffScheduleHideBound) {
      btn.__ffScheduleHideBound = true;
      btn.addEventListener("click", () => {
        if (id !== "scheduleBtn") hideScheduleScreen();
      }, { capture: true });
    }
  });
}

if (typeof window !== "undefined") {
  window.goToSchedule = goToSchedule;
  window.ffSchedulePreviewState = schedulePreviewState;
  window.refreshSchedulePreview = refreshSchedulePreview;
  window.setSchedulePreviewView = setSchedulePreviewView;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindScheduleUi);
} else {
  bindScheduleUi();
}

export {
  refreshSchedulePreview,
  hideScheduleScreen,
};
