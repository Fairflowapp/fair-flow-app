import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "./app.js?v=20260329_training_fix1";
import { generateWeeklySchedule } from "./schedule-generator.js?v=20260331_schedule_phase6_staff_profile";
import { validateScheduleDraft } from "./schedule-validator.js?v=20260331_schedule_phase6_staff_profile";

let schedulePreviewWeekStart = getStartOfWeek(new Date());
let schedulePreviewState = {
  draft: null,
  validation: null,
  weekRange: null,
};

function getWeekStartsOnPreference() {
  const globalValue = (window.settings && window.settings.preferences && window.settings.preferences.weekStartsOn) || "";
  if (String(globalValue).toLowerCase() === "sunday") return "sunday";
  try {
    const storedSettings = JSON.parse(localStorage.getItem("ffv24_settings") || "{}");
    return String(storedSettings?.preferences?.weekStartsOn || "").toLowerCase() === "sunday" ? "sunday" : "monday";
  } catch (_) {
    return "monday";
  }
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

function getSummaryCardHtml(label, value, tone) {
  let style = "border:1px solid #e5e7eb;background:#fff;color:#111827;";
  if (tone === "high") style = "border:1px solid #fecaca;background:#fff1f2;color:#b91c1c;";
  if (tone === "medium") style = "border:1px solid #fde68a;background:#fffbeb;color:#b45309;";
  if (tone === "positive") style = "border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;";
  return `
    <div style="padding:14px 16px;border-radius:14px;${style}">
      <div style="font-size:12px;font-weight:600;opacity:0.8;">${label}</div>
      <div style="font-size:24px;font-weight:800;margin-top:4px;">${value}</div>
    </div>
  `;
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
  summaryBar.innerHTML = [
    getSummaryCardHtml("Total Warnings", summary.totalWarnings || 0, summary.totalWarnings ? "medium" : "positive"),
    getSummaryCardHtml("High Severity", summary.highSeverityCount || 0, summary.highSeverityCount ? "high" : "positive"),
    getSummaryCardHtml("Days With Issues", daysWithIssues, daysWithIssues ? "medium" : "positive"),
  ].join("");
}

function renderScheduleDays(draft, validation) {
  const daysList = document.getElementById("scheduleDaysList");
  const empty = document.getElementById("schedulePreviewEmpty");
  if (!daysList || !empty) return;

  const draftDays = Array.isArray(draft?.days) ? draft.days : [];
  const validationByDate = new Map((Array.isArray(validation?.days) ? validation.days : []).map((day) => [day.date, day]));

  if (!draftDays.length) {
    daysList.innerHTML = "";
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  daysList.innerHTML = draftDays.map((day) => {
    const validationDay = validationByDate.get(day.date) || { warnings: [] };
    const assignments = Array.isArray(day.assignments) ? day.assignments : [];
    const warnings = Array.isArray(validationDay.warnings) ? validationDay.warnings : [];

    const assignmentsHtml = assignments.length
      ? assignments.map((assignment) => {
          const roleLabel = assignment.role === "manager"
            ? (assignment.managerType === "assistant_manager" ? "Manager · Assistant Manager" : "Manager")
            : assignment.role === "front_desk"
              ? "Front Desk"
              : assignment.role === "admin"
                ? "Admin"
                : "Technician";
          return `
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;">
              <div style="min-width:0;">
                <div style="font-size:14px;font-weight:700;color:#111827;">${assignment.name || "Unknown Staff"}</div>
                <div style="margin-top:4px;font-size:12px;color:#6b7280;">${roleLabel}</div>
                ${assignment.overrideApplied ? `<div style="margin-top:6px;display:inline-flex;padding:3px 8px;border-radius:999px;background:#ede9fe;color:#6d28d9;font-size:11px;font-weight:600;">Override Applied</div>` : ""}
              </div>
              <div style="text-align:right;flex-shrink:0;">
                <div style="font-size:13px;font-weight:700;color:#111827;">${assignment.startTime || "--:--"} - ${assignment.endTime || "--:--"}</div>
                <div style="margin-top:4px;font-size:11px;color:#9ca3af;">Read-only draft</div>
              </div>
            </div>
          `;
        }).join("")
      : `<div style="padding:16px;border:1px dashed #d1d5db;border-radius:12px;background:#fff;color:#6b7280;font-size:13px;">No staff assigned.</div>`;

    const warningsHtml = warnings.length
      ? warnings.map((warning) => `
          <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:10px;${getSeverityBadgeStyle(warning.severity)}">
            <span style="display:inline-flex;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;${getSeverityBadgeStyle(warning.severity)}">${warning.severity}</span>
            <div style="min-width:0;">
              <div style="font-size:12px;font-weight:700;">${warning.code}</div>
              <div style="font-size:12px;margin-top:2px;">${warning.message}</div>
            </div>
          </div>
        `).join("")
      : `<div style="padding:12px;border-radius:10px;background:#ecfdf5;border:1px solid #bbf7d0;color:#166534;font-size:12px;font-weight:600;">No warnings for this day.</div>`;

    return `
      <section style="display:grid;grid-template-columns:minmax(0,1.4fr) minmax(280px,0.9fr);gap:16px;padding:18px;border:1px solid #e5e7eb;border-radius:18px;background:#fdfdfd;box-shadow:0 1px 3px rgba(15,23,42,0.05);">
        <div style="display:flex;flex-direction:column;gap:12px;min-width:0;">
          <div>
            <div style="font-size:17px;font-weight:800;color:#111827;">${formatLongDate(day.date)}</div>
            <div style="font-size:12px;color:#9ca3af;margin-top:3px;">${day.date}</div>
          </div>
          <div style="display:grid;gap:10px;">${assignmentsHtml}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;min-width:0;">
          <div style="font-size:13px;font-weight:800;color:#111827;">Warnings</div>
          ${warningsHtml}
        </div>
      </section>
    `;
  }).join("");
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

    schedulePreviewState = { draft, validation, weekRange };
    if (typeof window !== "undefined") {
      window.ffSchedulePreviewState = schedulePreviewState;
    }
    renderScheduleSummary(validation, validation.days);
    renderScheduleDays(draft, validation);
    setScheduleLoadingState({ loading: false, error: "" });
  } catch (error) {
    console.error("[ScheduleUI] Failed to refresh schedule preview", error);
    schedulePreviewState = { draft: null, validation: null, weekRange };
    if (typeof window !== "undefined") {
      window.ffSchedulePreviewState = schedulePreviewState;
    }
    renderScheduleSummary({ summary: { totalWarnings: 0, highSeverityCount: 0 } }, []);
    renderScheduleDays(null, null);
    setScheduleLoadingState({ loading: false, error: error?.message || "Failed to build schedule preview." });
  }
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
  document.getElementById("scheduleRefreshBtn")?.addEventListener("click", refreshSchedulePreview);
  document.getElementById("scheduleTodayBtn")?.addEventListener("click", () => {
    schedulePreviewWeekStart = getStartOfWeek(new Date());
    refreshSchedulePreview();
  });
  document.getElementById("schedulePrevWeekBtn")?.addEventListener("click", () => {
    schedulePreviewWeekStart = addDays(schedulePreviewWeekStart, -7);
    refreshSchedulePreview();
  });
  document.getElementById("scheduleNextWeekBtn")?.addEventListener("click", () => {
    schedulePreviewWeekStart = addDays(schedulePreviewWeekStart, 7);
    refreshSchedulePreview();
  });

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
