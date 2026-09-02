/**
 * Tasks Analytics - simple high-level operational dashboard.
 *
 * Read-only. Uses current Tasks state/cache when available and falls back to
 * the active location's tasksState document. Does not modify Tasks or Firestore.
 */

import { injectStyles } from "./tasks-analytics-styles.js?v=20260625_tasks_analytics_split";
import {
  LOG,
  TABS,
  KINDS,
  clean,
  safeArr,
  getActiveLocationId,
  getLocationLabel,
  readTasksState,
} from "./tasks-analytics-data.js?v=20260816_dash_tasks";
import {
  normalizeTasks,
  filterRowsByRange,
  computeMetrics,
  buildInsights,
  fmtRate,
} from "./tasks-analytics-compute.js?v=20260816_tasks_week";
import {
  renderEmpty,
  renderSummary,
  renderBreakdown,
  renderTrend,
  renderInsights,
  csvRow,
} from "./tasks-analytics-ui.js?v=20260625_tasks_analytics_split";

const SCREEN_ID = "tasksAnalyticsScreen";
const STYLE_ID = "ffTasksAnalyticsStyles";
const RANGE_STORAGE_KEY = "ff_tasks_analytics_range_v1";
const OTHER_NAV_IDS = [
  "dashboardBtn",
  "queueBtn",
  "ticketsBtn",
  "chatBtn",
  "inboxBtn",
  "mediaBtn",
  "inventoryNavBtn",
  "inventoryBtn",
  "scheduleBtn",
  "timeClockBtn",
  "trainingBtn",
  "appsBtn",
];

let _injected = false;
let _rangeState = { mode: "thisWeek", customStart: "", customEnd: "" };
let _lastMetrics = null;
let _lastRange = null;

function startOfWeek(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function dateInputValue(date) {
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDate(date) {
  try {
    return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch (_) {
    return "";
  }
}

function loadRangeState() {
  _rangeState = { mode: "thisWeek", customStart: "", customEnd: "" };
  try {
    const parsed = JSON.parse(localStorage.getItem(RANGE_STORAGE_KEY) || "{}");
    if (parsed && typeof parsed === "object" && clean(parsed.mode) === "custom") {
      _rangeState = {
        mode: "custom",
        customStart: clean(parsed.customStart),
        customEnd: clean(parsed.customEnd),
      };
    }
  } catch (_) {}
}

function saveRangeState() {
  try {
    localStorage.setItem(RANGE_STORAGE_KEY, JSON.stringify(_rangeState));
  } catch (_) {}
}

function getSelectedRange() {
  const now = new Date();
  const mode = _rangeState.mode || "thisWeek";
  let start = startOfWeek(now);
  let end = endOfDay(now);
  let label = "This week";

  if (mode === "lastWeek") {
    start = addDays(startOfWeek(now), -7);
    end = endOfDay(addDays(start, 6));
    label = "Last week";
  } else if (mode === "last2Weeks") {
    start = addDays(startOfWeek(now), -7);
    end = endOfDay(now);
    label = "Last 2 weeks";
  } else if (mode === "last30Days") {
    start = startOfDay(addDays(now, -29));
    end = endOfDay(now);
    label = "Last 30 days";
  } else if (mode === "thisMonth") {
    start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    end = endOfDay(now);
    label = "This month";
  } else if (/^month-\d+$/.test(mode)) {
    const month = Number(mode.split("-")[1]);
    start = startOfDay(new Date(now.getFullYear(), month, 1));
    end = endOfDay(new Date(now.getFullYear(), month + 1, 0));
    label = start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  } else if (mode === "custom") {
    const customStart = _rangeState.customStart ? new Date(`${_rangeState.customStart}T00:00:00`) : null;
    const customEnd = _rangeState.customEnd ? new Date(`${_rangeState.customEnd}T23:59:59`) : null;
    if (customStart && Number.isFinite(customStart.getTime()) && customEnd && Number.isFinite(customEnd.getTime())) {
      start = startOfDay(customStart);
      end = endOfDay(customEnd);
      if (end < start) end = endOfDay(start);
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
  const mode = document.getElementById("ffTasksAnalyticsRangeMode");
  const start = document.getElementById("ffTasksAnalyticsCustomStart");
  const end = document.getElementById("ffTasksAnalyticsCustomEnd");
  if (mode) mode.value = _rangeState.mode || "thisWeek";
  if (start) start.value = _rangeState.customStart || dateInputValue(new Date());
  if (end) end.value = _rangeState.customEnd || dateInputValue(new Date());
  if (screen) screen.classList.toggle("tsa-custom-range", (_rangeState.mode || "thisWeek") === "custom");
}

function buildScreen() {
  if (document.getElementById(SCREEN_ID)) return document.getElementById(SCREEN_ID);
  const root = document.createElement("div");
  root.id = SCREEN_ID;
  root.innerHTML = `
    <div class="tsa-wrap">
      <button type="button" class="tsa-back" id="ffTasksAnalyticsBack">&larr; Back</button>
      <h1 class="tsa-h1">Tasks Analytics</h1>
      <p class="tsa-sub">Simple overview of task completion, open work, and weekly performance</p>
      <div class="tsa-location" id="ffTasksAnalyticsLocation">—</div>

      <div class="tsa-toolbar" id="ffTasksAnalyticsToolbar">
        <div class="tsa-filter-row">
          <div class="tsa-field">
            <label for="ffTasksAnalyticsRangeMode">Date range</label>
            <select id="ffTasksAnalyticsRangeMode">
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
          <div class="tsa-field is-custom">
            <label for="ffTasksAnalyticsCustomStart">Start</label>
            <input type="date" id="ffTasksAnalyticsCustomStart">
          </div>
          <div class="tsa-field is-custom">
            <label for="ffTasksAnalyticsCustomEnd">End</label>
            <input type="date" id="ffTasksAnalyticsCustomEnd">
          </div>
          <button type="button" class="tsa-action-btn secondary" id="ffTasksAnalyticsApplyRange">Apply</button>
        </div>
        <div class="tsa-toolbar-actions">
          <span class="tsa-range-label" id="ffTasksAnalyticsRangeLabel">This week</span>
          <button type="button" class="tsa-action-btn" id="ffTasksAnalyticsExportCsv">Export Excel</button>
        </div>
      </div>

      <div class="tsa-section-title">Summary</div>
      <div id="ffTasksAnalyticsSummary" class="tsa-grid"></div>

      <div class="tsa-section-title">Completion Breakdown</div>
      <div class="tsa-two-col">
        <div id="ffTasksAnalyticsType" class="tsa-panel"></div>
        <div id="ffTasksAnalyticsRole" class="tsa-panel"></div>
      </div>

      <div class="tsa-section-title">Weekly Trend</div>
      <div id="ffTasksAnalyticsTrend" class="tsa-panel"></div>

      <div class="tsa-section-title">Insights</div>
      <div id="ffTasksAnalyticsInsights" class="tsa-panel"></div>
    </div>
  `;
  document.body.appendChild(root);
  root.querySelector("#ffTasksAnalyticsBack")?.addEventListener("click", () => {
    hideSelf();
    if (typeof window.goToDashboard === "function") window.goToDashboard();
  });
  bindToolbar();
  loadRangeState();
  syncRangeControls();
  return root;
}

function bindToolbar() {
  const mode = document.getElementById("ffTasksAnalyticsRangeMode");
  const customStart = document.getElementById("ffTasksAnalyticsCustomStart");
  const customEnd = document.getElementById("ffTasksAnalyticsCustomEnd");
  const apply = document.getElementById("ffTasksAnalyticsApplyRange");
  const exportBtn = document.getElementById("ffTasksAnalyticsExportCsv");

  if (mode && !mode._ffBound) {
    mode._ffBound = true;
    mode.addEventListener("change", () => {
      _rangeState.mode = mode.value || "thisWeek";
      saveRangeState();
      syncRangeControls();
      if (_rangeState.mode !== "custom") refresh();
    });
  }
  [customStart, customEnd].forEach((input) => {
    if (!input || input._ffBound) return;
    input._ffBound = true;
    input.addEventListener("change", () => {
      _rangeState.customStart = customStart ? customStart.value : _rangeState.customStart;
      _rangeState.customEnd = customEnd ? customEnd.value : _rangeState.customEnd;
      saveRangeState();
    });
  });
  if (apply && !apply._ffBound) {
    apply._ffBound = true;
    apply.addEventListener("click", () => {
      _rangeState.mode = mode ? mode.value || "thisWeek" : _rangeState.mode;
      _rangeState.customStart = customStart ? customStart.value : _rangeState.customStart;
      _rangeState.customEnd = customEnd ? customEnd.value : _rangeState.customEnd;
      saveRangeState();
      syncRangeControls();
      refresh();
    });
  }
  if (exportBtn && !exportBtn._ffBound) {
    exportBtn._ffBound = true;
    exportBtn.addEventListener("click", exportCurrentCsv);
  }
}

function exportCurrentCsv() {
  if (!_lastMetrics || !_lastRange) {
    try {
      if (window.ffToast && typeof window.ffToast.info === "function") {
        window.ffToast.info("No task analytics data to export yet");
      }
    } catch (_) {}
    return;
  }

  const metrics = _lastMetrics;
  const insights = buildInsights(metrics);
  const rows = [];
  rows.push(["Tasks Analytics Export"]);
  rows.push(["Range", _lastRange.label]);
  rows.push(["From", _lastRange.startLabel]);
  rows.push(["To", _lastRange.endLabel]);
  rows.push(["Location", getLocationLabel().replace(/^Location:\s*/i, "")]);
  rows.push([]);

  rows.push(["Summary"]);
  rows.push(["Metric", "Value"]);
  rows.push(["Tasks Opened", metrics.total]);
  rows.push(["Tasks Completed", metrics.completed]);
  rows.push(["Completion Rate", fmtRate(metrics.completionRate)]);
  rows.push(["Open Tasks", metrics.open]);
  rows.push(["Overdue Tasks", metrics.overdue]);
  rows.push([]);

  rows.push(["Completion by Task Type"]);
  rows.push(["Type", "Completed", "Total", "Completion Rate"]);
  metrics.byType.forEach((row) => rows.push([row.label, row.completed, row.total, fmtRate(row.rate)]));
  rows.push([]);

  rows.push(["Completion by Role"]);
  rows.push(["Role", "Completed", "Total", "Completion Rate"]);
  metrics.byRole.forEach((row) => rows.push([row.label, row.completed, row.total, fmtRate(row.rate)]));
  rows.push([]);

  rows.push(["Trend"]);
  rows.push(["Period", "Completed", "Total", "Completion Rate"]);
  rows.push(["Selected Range", metrics.thisWeek.completed, metrics.thisWeek.total, fmtRate(metrics.thisWeek.rate)]);
  rows.push(["Previous Period", metrics.lastWeek.completed, metrics.lastWeek.total, fmtRate(metrics.lastWeek.rate)]);
  rows.push([]);

  rows.push(["Insights"]);
  insights.forEach((item) => rows.push([item.text]));

  const csv = `\uFEFF${rows.map(csvRow).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const safeRange = String(_lastRange.label || "range").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const a = document.createElement("a");
  a.href = url;
  a.download = `fair-flow-tasks-analytics-${safeRange || "export"}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  try {
    if (window.ffToast && typeof window.ffToast.success === "function") {
      window.ffToast.success("Tasks Analytics export created");
    }
  } catch (_) {}
}

async function refresh() {
  const screen = document.getElementById(SCREEN_ID);
  if (!screen || screen.style.display === "none") return;
  syncRangeControls();
  const range = getSelectedRange();
  const label = document.getElementById("ffTasksAnalyticsRangeLabel");
  if (label) label.textContent = range.label;
  const location = document.getElementById("ffTasksAnalyticsLocation");
  if (location) location.textContent = getLocationLabel();
  try {
    const { source, state } = await readTasksState();
    const allRows = normalizeTasks(state);
    const rows = filterRowsByRange(allRows, range);
    console.log(LOG, "records loaded", {
      source,
      count: allRows.length,
      filteredCount: rows.length,
      range: range.label,
      activeLocationId: getActiveLocationId() || "",
    });
    const metrics = computeMetrics(rows, source, range, allRows);
    _lastMetrics = metrics;
    _lastRange = range;
    if (!metrics.hasData) {
      renderEmpty();
      return;
    }
    renderSummary(metrics);
    renderBreakdown("ffTasksAnalyticsType", "Completion by Task Type", metrics.byType);
    renderBreakdown("ffTasksAnalyticsRole", "Completion by Role", metrics.byRole);
    renderTrend(metrics);
    renderInsights(metrics);
  } catch (err) {
    console.error(LOG, "refresh failed", err);
    renderEmpty();
  }
}

function hideOtherScreens() {
  [
    "dashboardScreen",
    "tasksScreen",
    "queueAnalyticsScreen",
    "ticketsAnalyticsScreen",
    "timeAnalyticsScreen",
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
  ].forEach((id) => {
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
    if (!btn || btn._ffTasksAnalyticsHideHandler) return;
    btn._ffTasksAnalyticsHideHandler = () => { hideSelf(); };
    btn.addEventListener("click", btn._ffTasksAnalyticsHideHandler, { capture: true });
  });
}

export function goToTasksAnalytics() {
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
  document.querySelectorAll(".btn-pill").forEach((btn) => btn.classList.remove("active"));
  refresh();
  if (typeof window.ffUpdateMobileHeaderTitle === "function") window.ffUpdateMobileHeaderTitle();
}

function ensureInjected() {
  if (_injected) return;
  injectStyles(SCREEN_ID, STYLE_ID);
  buildScreen();
  bindAutoHideOnOtherNav();
  _injected = true;
  document.addEventListener("ff-active-location-changed", () => {
    console.log(LOG, "active location changed -> refresh");
    refresh();
  });
}

if (typeof window !== "undefined") {
  window.goToTasksAnalytics = goToTasksAnalytics;
  window.hideTasksAnalytics = hideSelf;
}

