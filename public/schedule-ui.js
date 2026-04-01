import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "./app.js?v=20260329_training_fix1";
import { generateWeeklySchedule } from "./schedule-generator.js?v=20260331_schedule_phase6_staff_profile";
import { validateScheduleDraft } from "./schedule-validator.js?v=20260331_schedule_phase6_staff_profile";

let schedulePreviewWeekStart = getStartOfWeek(new Date());
let schedulePreviewState = {
  draft: null,
  validation: null,
  weekRange: null,
  staffList: [],
};
let schedulePreviewView = "management";

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
  return role === "admin" || role === "manager";
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
    const leftRank = leftRole === "admin" ? 0 : leftRole === "manager" ? 1 : 2;
    const rightRank = rightRole === "admin" ? 0 : rightRole === "manager" ? 1 : 2;
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

function getValidationByDate(validation) {
  return new Map((Array.isArray(validation?.days) ? validation.days : []).map((day) => [day.date, day]));
}

function formatBoardDayLabel(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return { title: dateKey, subtitle: "" };
  return {
    title: date.toLocaleDateString("en-US", { weekday: "short" }),
    subtitle: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  };
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
  const daysWithIssues = (Array.isArray(days) ? days : []).filter((day) => Array.isArray(day.warnings) && day.warnings.length > 0).length;
  const hasWarnings = (summary.totalWarnings || 0) > 0;
  summaryBar.innerHTML = hasWarnings
    ? `<span style="display:inline-flex;padding:4px 10px;border-radius:999px;background:#fff7ed;color:#b45309;border:1px solid #fed7aa;font-size:12px;font-weight:600;">${summary.totalWarnings} warnings</span>
       <span style="font-size:13px;color:#6b7280;">${daysWithIssues} day${daysWithIssues === 1 ? "" : "s"} with issues.</span>`
    : `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
         <span style="display:inline-flex;padding:4px 10px;border-radius:999px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;font-size:12px;font-weight:600;">No warnings</span>
         <span style="font-size:13px;color:#6b7280;">This weekly preview is read-only.</span>
       </div>`;
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
    const warningCount = Array.isArray(validationByDate.get(day.date)?.warnings) ? validationByDate.get(day.date).warnings.length : 0;
    const dayLabel = formatBoardDayLabel(day.date);
    return `
      <div style="padding:12px 10px;border-bottom:1px solid #e5e7eb;background:#f8fafc;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:#111827;">${dayLabel.title}</div>
        <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${dayLabel.subtitle}</div>
        ${warningCount > 0 ? `<div style="margin-top:6px;font-size:11px;color:#b45309;">${warningCount} issue${warningCount === 1 ? "" : "s"}</div>` : ""}
      </div>
    `;
  }).join("");

  const rowHtml = filteredStaff.map((staff) => {
    const staffKey = getScheduleStaffKey(staff);
    const roleLabel = getScheduleRoleLabel(staff);
    const cells = draftDays.map((day) => {
      const assignment = assignmentLookup.get(`${staffKey}::${day.date}`) || null;
      const warnings = Array.isArray(validationByDate.get(day.date)?.warnings) ? validationByDate.get(day.date).warnings : [];
      const hasWarnings = warnings.length > 0;
      const cellStyle = assignment
        ? `background:#f5f3ff;border:1px solid #d8b4fe;color:#5b21b6;box-shadow:${hasWarnings ? "inset 0 0 0 1px rgba(245,158,11,0.35)" : "none"};`
        : `background:#f3f4f6;border:1px solid #e5e7eb;color:#6b7280;box-shadow:${hasWarnings ? "inset 0 0 0 1px rgba(245,158,11,0.28)" : "none"};`;
      return `
        <div style="position:relative;padding:10px;border-radius:12px;min-height:68px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:12px;font-weight:${assignment ? "700" : "500"};line-height:1.35;${cellStyle}">
          ${hasWarnings ? `<span style="position:absolute;top:7px;right:7px;width:7px;height:7px;border-radius:50%;background:#f59e0b;opacity:0.9;"></span>` : ""}
          <div>
            <div>${assignment ? `${assignment.startTime || "--:--"} - ${assignment.endTime || "--:--"}` : "Off"}</div>
          </div>
        </div>
      `;
    }).join("");

    return `
      <div style="display:grid;grid-template-columns:${gridTemplate};align-items:stretch;">
        <div style="padding:12px 14px;border-bottom:1px solid #e5e7eb;background:#fff;display:flex;flex-direction:column;justify-content:center;gap:4px;min-width:0;">
          <div style="font-size:13px;font-weight:700;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${staff.name || "Unknown Staff"}</div>
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

    const draft = generateWeeklySchedule({
      staffList,
      requests,
      rules,
      dateRange: { startDate: weekRange.startDate, endDate: weekRange.endDate },
    });

    const validation = validateScheduleDraft({
      draftSchedule: draft,
      staffList,
      requests,
      rules: draft.rules,
      dateRange: { startDate: weekRange.startDate, endDate: weekRange.endDate },
    });

    schedulePreviewState = { draft, validation, weekRange, staffList };
    if (typeof window !== "undefined") {
      window.ffSchedulePreviewState = schedulePreviewState;
    }
    renderScheduleSummary(validation, validation.days);
    renderScheduleViewTabs();
    renderScheduleBoard(draft, validation, staffList);
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
