/**
 * Time Analytics - simple dashboard-level analytics.
 *
 * Scope:
 * - Read-only analytics screen.
 * - Uses timeEntries for actual worked time.
 * - Uses published schedule snapshots when available for simple accuracy.
 * - Does not modify Time Clock, Schedule, Firestore, or rules.
 */

import { injectStyles } from "./time-analytics-styles.js?v=20260626_time_analytics_split";
import {
  LOG,
  getLocationScope,
  getWeekStart,
  addDays,
  endOfDay,
} from "./time-analytics-data.js?v=20260626_time_analytics_split";
import {
  LOC_LOG,
  fmtHours,
  fmtPercent,
  fmtMinutes,
  fmtTime,
  buildInsights,
  computeTimeAnalytics,
} from "./time-analytics-compute.js?v=20260626_time_analytics_split";
import {
  renderLocationScope,
  renderEmpty,
  renderSummary,
  renderCompare,
  renderInsights,
  csvRow,
} from "./time-analytics-ui.js?v=20260626_time_analytics_split";

const SCREEN_ID = "timeAnalyticsScreen";
const STYLE_ID = "ffTimeAnalyticsStyles";
const RANGE_STORAGE_KEY = "ff_time_analytics_range_v1";
const OTHER_NAV_IDS = [
  "dashboardBtn",
  "queueBtn",
  "ticketsBtn",
  "tasksBtn",
  "chatBtn",
  "inboxBtn",
  "mediaBtn",
  "scheduleBtn",
  "timeClockBtn",
  "inventoryBtn",
  "trainingBtn",
];

let _injected = false;
let _timeRangeState = { mode: "thisWeek", customStart: "", customEnd: "" };
let _lastMetrics = null;
let _lastRange = null;

// ---------- Formatting ----------

function dayStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dateInputValue(date) {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateInput(value) {
  const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(d.getTime()) ? d : null;
}

function formatDate(date) {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function loadRangeState() {
  try {
    const saved = JSON.parse(localStorage.getItem(RANGE_STORAGE_KEY) || "{}");
    if (saved && typeof saved.mode === "string") {
      _timeRangeState = {
        mode: saved.mode || "thisWeek",
        customStart: saved.customStart || "",
        customEnd: saved.customEnd || "",
      };
    }
  } catch (_) {}
}

function saveRangeState() {
  try {
    localStorage.setItem(RANGE_STORAGE_KEY, JSON.stringify(_timeRangeState));
  } catch (_) {}
}

function getSelectedRange() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const weekStart = getWeekStart(now);
  const mode = _timeRangeState.mode || "thisWeek";
  let start = weekStart;
  let end = endOfDay(addDays(weekStart, 6));
  let label = "This week";

  if (mode === "lastWeek") {
    start = addDays(weekStart, -7);
    end = endOfDay(addDays(weekStart, -1));
    label = "Last week";
  } else if (mode === "last2Weeks") {
    start = addDays(weekStart, -14);
    end = endOfDay(addDays(weekStart, -1));
    label = "Last 2 weeks";
  } else if (mode === "last30Days") {
    start = addDays(dayStart(now), -29);
    end = now;
    label = "Last 30 days";
  } else if (mode === "thisMonth") {
    start = new Date(currentYear, now.getMonth(), 1);
    end = now;
    label = "This month";
  } else if (/^month-\d{1,2}$/.test(mode)) {
    const month = Number(mode.split("-")[1]);
    start = new Date(currentYear, month, 1);
    end = endOfDay(new Date(currentYear, month + 1, 0));
    label = start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  } else if (mode === "custom") {
    const customStart = parseDateInput(_timeRangeState.customStart);
    const customEnd = parseDateInput(_timeRangeState.customEnd);
    if (customStart && customEnd) {
      start = dayStart(customStart);
      end = endOfDay(customEnd);
      if (start.getTime() > end.getTime()) {
        const tmp = start;
        start = dayStart(end);
        end = endOfDay(tmp);
      }
      label = `${formatDate(start)} - ${formatDate(end)}`;
    } else {
      label = "Custom range";
    }
  }

  return {
    mode,
    fromMs: start.getTime(),
    toMs: end.getTime(),
    label,
    startLabel: formatDate(start),
    endLabel: formatDate(end),
  };
}

function syncRangeControls() {
  const screen = document.getElementById(SCREEN_ID);
  const mode = document.getElementById("ffTimeAnalyticsRangeMode");
  const start = document.getElementById("ffTimeAnalyticsCustomStart");
  const end = document.getElementById("ffTimeAnalyticsCustomEnd");
  if (mode) mode.value = _timeRangeState.mode || "thisWeek";
  if (start) start.value = _timeRangeState.customStart || dateInputValue(new Date());
  if (end) end.value = _timeRangeState.customEnd || dateInputValue(new Date());
  if (screen) screen.classList.toggle("ta-custom-range", (_timeRangeState.mode || "thisWeek") === "custom");
}

// ---------- DOM ----------

function buildScreen() {
  if (document.getElementById(SCREEN_ID)) return document.getElementById(SCREEN_ID);
  const root = document.createElement("div");
  root.id = SCREEN_ID;
  root.innerHTML = `
    <div class="ta-wrap">
      <button type="button" class="ta-back" id="ffTimeAnalyticsBack">&larr; Back</button>
      <h1 class="ta-h1">Time Analytics</h1>
      <p class="ta-sub">Simple overview of work hours, overtime, and schedule accuracy</p>
      <div class="ta-location" id="ffTimeAnalyticsLocationLabel">—</div>

      <div class="ta-toolbar" id="ffTimeAnalyticsToolbar">
        <div class="ta-filter-row">
          <div class="ta-field">
            <label for="ffTimeAnalyticsRangeMode">Date range</label>
            <select id="ffTimeAnalyticsRangeMode">
              <option value="thisWeek">This week</option>
              <option value="lastWeek">Last week</option>
              <option value="last2Weeks">Last 2 weeks</option>
              <option value="last30Days">Last 30 days</option>
              <option value="thisMonth">This month</option>
              <option value="month-0">January</option>
              <option value="month-1">February</option>
              <option value="month-2">March</option>
              <option value="month-3">April</option>
              <option value="month-4">May</option>
              <option value="month-5">June</option>
              <option value="month-6">July</option>
              <option value="month-7">August</option>
              <option value="month-8">September</option>
              <option value="month-9">October</option>
              <option value="month-10">November</option>
              <option value="month-11">December</option>
              <option value="custom">Custom range</option>
            </select>
          </div>
          <div class="ta-field is-custom">
            <label for="ffTimeAnalyticsCustomStart">Start</label>
            <input type="date" id="ffTimeAnalyticsCustomStart">
          </div>
          <div class="ta-field is-custom">
            <label for="ffTimeAnalyticsCustomEnd">End</label>
            <input type="date" id="ffTimeAnalyticsCustomEnd">
          </div>
          <button type="button" class="ta-action-btn secondary" id="ffTimeAnalyticsApplyRange">Apply</button>
        </div>
        <div class="ta-toolbar-actions">
          <span class="ta-range-label" id="ffTimeAnalyticsRangeLabel">This week</span>
          <button type="button" class="ta-action-btn" id="ffTimeAnalyticsExportCsv">Export Excel</button>
        </div>
      </div>

      <div class="ta-section-title">Summary</div>
      <div id="ffTimeAnalyticsSummary" class="ta-grid"></div>

      <div class="ta-section-title">Scheduled vs Actual</div>
      <div id="ffTimeAnalyticsCompare" class="ta-panel"></div>

      <div class="ta-section-title">Insights</div>
      <div id="ffTimeAnalyticsInsights" class="ta-panel"></div>
    </div>
  `;
  document.body.appendChild(root);
  const back = root.querySelector("#ffTimeAnalyticsBack");
  if (back) {
    back.addEventListener("click", () => {
      hideSelf();
      try {
        if (typeof window.goToDashboard === "function") window.goToDashboard();
      } catch (err) {
        console.warn(LOG, "back navigation failed", err);
      }
    });
  }
  const rangeMode = root.querySelector("#ffTimeAnalyticsRangeMode");
  const customStart = root.querySelector("#ffTimeAnalyticsCustomStart");
  const customEnd = root.querySelector("#ffTimeAnalyticsCustomEnd");
  const applyRange = root.querySelector("#ffTimeAnalyticsApplyRange");
  const exportCsv = root.querySelector("#ffTimeAnalyticsExportCsv");
  if (rangeMode) {
    rangeMode.addEventListener("change", () => {
      _timeRangeState.mode = rangeMode.value || "thisWeek";
      saveRangeState();
      syncRangeControls();
      if (_timeRangeState.mode !== "custom") refresh();
    });
  }
  [customStart, customEnd].forEach((input) => {
    if (!input) return;
    input.addEventListener("change", () => {
      _timeRangeState.customStart = customStart ? customStart.value : "";
      _timeRangeState.customEnd = customEnd ? customEnd.value : "";
      saveRangeState();
    });
  });
  if (applyRange) {
    applyRange.addEventListener("click", () => {
      _timeRangeState.mode = rangeMode ? rangeMode.value : _timeRangeState.mode;
      _timeRangeState.customStart = customStart ? customStart.value : _timeRangeState.customStart;
      _timeRangeState.customEnd = customEnd ? customEnd.value : _timeRangeState.customEnd;
      saveRangeState();
      syncRangeControls();
      refresh();
    });
  }
  if (exportCsv) {
    exportCsv.addEventListener("click", () => {
      exportCurrentCsv();
    });
  }
  loadRangeState();
  syncRangeControls();
  return root;
}

// ---------- Data ----------

// ---------- Render ----------

async function exportCurrentCsv() {
  const range = _lastRange || getSelectedRange();
  const metrics = _lastMetrics || await computeTimeAnalytics(range);
  const insights = buildInsights(metrics);
  const rows = [];

  rows.push(["Time Analytics Export"]);
  rows.push(["Range", range.label]);
  rows.push(["From", range.startLabel]);
  rows.push(["To", range.endLabel]);
  rows.push([]);

  rows.push(["Summary"]);
  rows.push(["Metric", "Value"]);
  rows.push(["Total Hours", fmtHours(metrics.totalHours)]);
  rows.push(["Regular Hours", fmtHours(metrics.regularHours)]);
  rows.push(["Overtime Hours", fmtHours(metrics.overtimeHours)]);
  rows.push(["Shift Accuracy", metrics.hasSchedule && Number.isFinite(metrics.shiftAccuracy) ? fmtPercent(metrics.shiftAccuracy) : ""]);
  rows.push(["Late Starts", metrics.hasSchedule ? metrics.lateStarts : ""]);
  rows.push(["Early Leaves", metrics.hasSchedule ? metrics.earlyLeaves : ""]);
  rows.push(["Stayed Longer Shifts", metrics.hasSchedule ? metrics.overtimeShifts : ""]);
  rows.push(["Matched Entries", metrics.matchedEntries || 0]);
  rows.push(["Rejected Entries", metrics.rejectedEntries || 0]);
  rows.push([]);

  rows.push(["Scheduled vs Actual"]);
  rows.push(["Metric", "Value"]);
  rows.push(["Total Scheduled Hours", fmtHours(metrics.totalScheduledHours)]);
  rows.push(["Total Actual Hours", fmtHours(metrics.totalActualHours)]);
  rows.push(["Difference", `${metrics.differenceHours >= 0 ? "+" : ""}${Number(metrics.differenceHours || 0).toFixed(1)}h`]);
  rows.push([]);

  rows.push(["Schedule Deviations"]);
  rows.push(["Employee", "Date", "Scheduled", "Actual", "Late Start", "Early Leave", "Stayed Longer"]);
  if (Array.isArray(metrics.deviations) && metrics.deviations.length) {
    metrics.deviations.forEach((row) => {
      rows.push([
        row.employeeName || "",
        row.dateKey || row.dayName || "",
        `${fmtTime(row.scheduledStartMs)} - ${fmtTime(row.scheduledEndMs)}`,
        `${fmtTime(row.actualStartMs)} - ${fmtTime(row.actualEndMs)}`,
        row.lateMinutes > 0 ? fmtMinutes(row.lateMinutes) : "",
        row.earlyMinutes > 0 ? fmtMinutes(row.earlyMinutes) : "",
        row.stayedLongerMinutes > 0 ? fmtMinutes(row.stayedLongerMinutes) : "",
      ]);
    });
  } else {
    rows.push(["No schedule deviations detected"]);
  }
  rows.push([]);

  rows.push(["Insights"]);
  insights.forEach((item) => rows.push([item.text || ""]));

  const csv = `\uFEFF${rows.map(csvRow).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const safeRange = String(range.label || "range").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const a = document.createElement("a");
  a.href = url;
  a.download = `time-analytics-${safeRange || "range"}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  try {
    if (window.ffToast && typeof window.ffToast.success === "function") {
      window.ffToast.success("Time Analytics export created");
    }
  } catch (_) {}
}

async function refresh() {
  const screen = document.getElementById(SCREEN_ID);
  if (!screen || screen.style.display === "none") return;
  syncRangeControls();
  const scope = getLocationScope();
  renderLocationScope(scope);
  console.log(LOC_LOG, "active location", { activeLocationId: scope.id || "", label: scope.label });
  const range = getSelectedRange();
  const label = document.getElementById("ffTimeAnalyticsRangeLabel");
  if (label) label.textContent = range.label;
  try {
    const metrics = await computeTimeAnalytics(range);
    _lastMetrics = metrics;
    _lastRange = range;
    if (!metrics.hasData) {
      renderEmpty(scope.hasLocation ? "No time data available for this location yet" : "Please select a location");
      return;
    }
    renderSummary(metrics);
    renderCompare(metrics);
    renderInsights(metrics);
  } catch (err) {
    console.error(LOG, "refresh failed", err);
    renderEmpty(scope.hasLocation ? "No time data available for this location yet" : "Please select a location");
  }
}

// ---------- Navigation ----------

function hideOtherScreens() {
  const ids = [
    "tasksScreen",
    "inboxScreen",
    "chatScreen",
    "mediaScreen",
    "trainingScreen",
    "scheduleScreen",
    "timeClockScreen",
    "ticketsScreen",
    "inventoryScreen",
    "manageQueueScreen",
    "userProfileScreen",
    "myProfileScreen",
    "pointsAppScreen",
    "owner-view",
    "dashboardScreen",
    "queueAnalyticsScreen",
    "ticketsAnalyticsScreen",
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  ["#joinBar", ".joinBar", ".wrap", "#queueControls"].forEach((sel) => {
    const el = document.querySelector(sel);
    if (el) el.style.display = "none";
  });
}

function hideSelf() {
  const screen = document.getElementById(SCREEN_ID);
  if (screen) screen.style.display = "none";
  document.body.classList.remove("ff-dashboard-analytics-open");
  if (typeof window.ffUpdateMobileHeaderTitle === "function") window.ffUpdateMobileHeaderTitle();
}

function bindAutoHideOnOtherNav() {
  OTHER_NAV_IDS.forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn || btn._ffTimeAnalyticsHideHandler) return;
    btn._ffTimeAnalyticsHideHandler = () => { hideSelf(); };
    btn.addEventListener("click", btn._ffTimeAnalyticsHideHandler, { capture: true });
  });
}

export function goToTimeAnalytics() {
  console.log(LOG, "screen opened");
  try {
    if (typeof window.ffCloseGlobalBlockingOverlays === "function") window.ffCloseGlobalBlockingOverlays();
  } catch (_) {}
  try {
    if (typeof window.closeStaffMembersModal === "function") window.closeStaffMembersModal();
  } catch (_) {}
  ensureInjected();
  hideOtherScreens();

  // IMPORTANT: add the body class FIRST so the mobile CSS that switches the
  // header to `position: fixed; top: env(safe-area-inset-top)` is applied
  // before we measure. Otherwise getComputedStyle still sees the desktop
  // default (sticky, top:0), topOffset comes out as 0, and --header-h ends
  // up too small. That pushes the "← Back / title" row behind the purple
  // bar on iOS.
  document.body.classList.add("ff-dashboard-analytics-open");

  const screen = document.getElementById(SCREEN_ID);
  if (screen) {
    screen.style.display = "flex";
    screen.style.setProperty("pointer-events", "auto", "important");
  }

  const recomputeHeaderH = () => {
    const headerEl = document.querySelector(".header");
    if (!headerEl) return;
    let topOffset = 0;
    try {
      const cs = getComputedStyle(headerEl);
      if (cs && cs.position === "fixed") topOffset = parseFloat(cs.top) || 0;
    } catch (_) {}
    document.documentElement.style.setProperty("--header-h", `${headerEl.offsetHeight + topOffset}px`);
  };
  recomputeHeaderH();
  // Re-measure after the browser has actually applied the body-class CSS
  // (iOS Capacitor sometimes returns the pre-class computed style
  // synchronously). Two rAFs is a well-known way to wait for a full paint.
  requestAnimationFrame(function () {
    recomputeHeaderH();
    requestAnimationFrame(recomputeHeaderH);
  });
  document.querySelectorAll(".btn-pill").forEach((b) => b.classList.remove("active"));
  refresh();
  if (typeof window.ffUpdateMobileHeaderTitle === "function") window.ffUpdateMobileHeaderTitle();
}

function ensureInjected() {
  if (_injected) return;
  injectStyles(SCREEN_ID, STYLE_ID);
  buildScreen();
  bindAutoHideOnOtherNav();
  _injected = true;
  console.log(LOG, "screen injected");
}

function init() {
  window.goToTimeAnalytics = goToTimeAnalytics;
  ensureInjected();
  console.log(LOG, "init complete");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
