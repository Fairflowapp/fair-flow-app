/**
 * Queue Analytics — standalone screen for deep queue insights.
 *
 * Mirrors the structure of dashboard.js: self-contained module that injects
 * its own #queueAnalyticsScreen DOM and styles, and exposes
 * window.goToQueueAnalytics(). Reads the queue activity log from window.log
 * (per-location, synced by queue-cloud.js) or localStorage ffv24_log. No
 * Firestore writes, no changes to existing queue logic.
 *
 * Sections rendered:
 *   A — Summary cards (Avg / Longest / Wait events / Busiest day / Peak hour)
 *   B — Wait Time by Day (table: avg, longest, count)
 *   C — Queue Load by Hour (service starts, avg wait, avg people waiting)
 *   D — Auto Insights (text bullets)
 *
 * Logging prefix: [QueueAnalytics]
 */

import { injectStyles } from "./queue-analytics-styles.js?v=20260625_queue_analytics_split";
import { _qaLocationScope } from "./queue-analytics-data.js?v=20260625_queue_analytics_split";
import {
  LOG,
  LOC_LOG,
  computeQueueAnalytics,
  fmtMinutes,
  fmtIdleMinutes,
  fmtStaffAverage,
  fmtHourRange,
  buildWaitTimeTypeRows,
  formatTypeBreakdown,
} from "./queue-analytics-compute.js?v=20260625_queue_analytics_split";
import {
  renderEmpty,
  renderSummary,
  renderByDay,
  renderByHour,
  renderInsights,
  buildInsights,
  csvRow,
} from "./queue-analytics-ui.js?v=20260625_queue_analytics_split";

const SCREEN_ID = "queueAnalyticsScreen";
const RANGE_STORAGE_KEY = "ff_queue_analytics_range_v1";

let _injected = false;
let _qaRangeState = { mode: "thisWeek", customStart: "", customEnd: "" };
let _lastMetrics = null;
let _lastRange = null;

// Capture-phase auto-hide on these other main-nav buttons + Apps panel
// re-opens. Same pattern dashboard.js uses so we never touch goToQueue / etc.
const OTHER_NAV_IDS = [
  "queueBtn",
  "ticketsBtn",
  "tasksBtn",
  "chatBtn",
  "inboxBtn",
  "mediaBtn",
  "inventoryNavBtn",
  "scheduleBtn",
  "trainingBtn",
  "appsBtn",
];

// ---------- DOM injection ----------

function buildScreen() {
  if (document.getElementById(SCREEN_ID)) return document.getElementById(SCREEN_ID);
  const root = document.createElement("div");
  root.id = SCREEN_ID;
  root.innerHTML = `
    <div class="qa-wrap">
      <button type="button" class="qa-back" id="ffQaBack" aria-label="Back">← Back</button>
      <h1 class="qa-h1">Queue Analytics</h1>
      <p class="qa-sub">Understand average wait time, staff flow, and hourly capacity</p>
      <div class="qa-location" id="ffQaLocationLabel">—</div>

      <div class="qa-toolbar" id="ffQaToolbar">
        <div class="qa-filter-row">
          <div class="qa-field">
            <label for="ffQaRangeMode">Date range</label>
            <select id="ffQaRangeMode">
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
          <div class="qa-field is-custom">
            <label for="ffQaCustomStart">Start</label>
            <input type="date" id="ffQaCustomStart">
          </div>
          <div class="qa-field is-custom">
            <label for="ffQaCustomEnd">End</label>
            <input type="date" id="ffQaCustomEnd">
          </div>
          <button type="button" class="qa-action-btn secondary" id="ffQaApplyRange">Apply</button>
        </div>
        <div class="qa-toolbar-actions">
          <span class="qa-range-label" id="ffQaRangeLabel">This week</span>
          <button type="button" class="qa-action-btn" id="ffQaExportCsv">Export Excel</button>
        </div>
      </div>

      <div class="qa-section-title">Summary</div>
      <div id="ffQaSummary" class="qa-summary"></div>

      <div class="qa-section-title">Available wait by day</div>
      <div id="ffQaByDay" class="qa-panel"></div>

      <div class="qa-section-title">Queue Load by Hour</div>
      <div id="ffQaByHour" class="qa-panel"></div>

      <div class="qa-section-title">Insights</div>
      <div id="ffQaInsights" class="qa-panel"></div>
    </div>
  `;
  document.body.appendChild(root);
  const back = root.querySelector("#ffQaBack");
  if (back) {
    back.addEventListener("click", () => {
      hideSelf();
      try {
        if (typeof window.goToDashboard === "function") {
          window.goToDashboard();
        }
      } catch (e) { console.warn(LOG, "back nav failed", e); }
    });
  }
  const rangeMode = root.querySelector("#ffQaRangeMode");
  const customStart = root.querySelector("#ffQaCustomStart");
  const customEnd = root.querySelector("#ffQaCustomEnd");
  const applyRange = root.querySelector("#ffQaApplyRange");
  const exportCsv = root.querySelector("#ffQaExportCsv");
  if (rangeMode) {
    rangeMode.addEventListener("change", () => {
      _qaRangeState.mode = rangeMode.value || "thisWeek";
      _qaSaveRangeState();
      syncRangeControls();
      if (_qaRangeState.mode !== "custom") refresh();
    });
  }
  [customStart, customEnd].forEach((input) => {
    if (!input) return;
    input.addEventListener("change", () => {
      _qaRangeState.customStart = customStart ? customStart.value : "";
      _qaRangeState.customEnd = customEnd ? customEnd.value : "";
      _qaSaveRangeState();
    });
  });
  if (applyRange) {
    applyRange.addEventListener("click", () => {
      _qaRangeState.mode = rangeMode ? rangeMode.value : _qaRangeState.mode;
      _qaRangeState.customStart = customStart ? customStart.value : _qaRangeState.customStart;
      _qaRangeState.customEnd = customEnd ? customEnd.value : _qaRangeState.customEnd;
      _qaSaveRangeState();
      syncRangeControls();
      refresh();
    });
  }
  if (exportCsv) {
    exportCsv.addEventListener("click", () => {
      exportCurrentCsv();
    });
  }
  _qaLoadRangeState();
  syncRangeControls();
  return root;
}

// ---------- Data helpers (self-contained copy of dashboard's parser) ----------

function _qaWeekStartMs() {
  const d = new Date();
  const day = d.getDay();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}

function _qaDayStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function _qaEndOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function _qaAddDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function _qaDateInputValue(date) {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function _qaParseDateInput(value) {
  const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(d.getTime()) ? d : null;
}

function _qaFormatDate(date) {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function _qaLoadRangeState() {
  try {
    const saved = JSON.parse(localStorage.getItem(RANGE_STORAGE_KEY) || "{}");
    if (saved && typeof saved.mode === "string") {
      _qaRangeState = {
        mode: saved.mode || "thisWeek",
        customStart: saved.customStart || "",
        customEnd: saved.customEnd || "",
      };
    }
  } catch (_) {}
}

function _qaSaveRangeState() {
  try {
    localStorage.setItem(RANGE_STORAGE_KEY, JSON.stringify(_qaRangeState));
  } catch (_) {}
}

function getSelectedRange() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const weekStart = new Date(_qaWeekStartMs());
  const mode = _qaRangeState.mode || "thisWeek";
  let start = weekStart;
  let end = now;
  let label = "This week";

  if (mode === "lastWeek") {
    start = _qaAddDays(weekStart, -7);
    end = _qaEndOfDay(_qaAddDays(weekStart, -1));
    label = "Last week";
  } else if (mode === "last2Weeks") {
    start = _qaAddDays(weekStart, -14);
    end = _qaEndOfDay(_qaAddDays(weekStart, -1));
    label = "Last 2 weeks";
  } else if (mode === "last30Days") {
    start = _qaAddDays(_qaDayStart(now), -29);
    end = now;
    label = "Last 30 days";
  } else if (mode === "thisMonth") {
    start = new Date(currentYear, now.getMonth(), 1);
    end = now;
    label = "This month";
  } else if (/^month-\d{1,2}$/.test(mode)) {
    const month = Number(mode.split("-")[1]);
    start = new Date(currentYear, month, 1);
    end = _qaEndOfDay(new Date(currentYear, month + 1, 0));
    label = start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  } else if (mode === "custom") {
    const customStart = _qaParseDateInput(_qaRangeState.customStart);
    const customEnd = _qaParseDateInput(_qaRangeState.customEnd);
    if (customStart && customEnd) {
      start = _qaDayStart(customStart);
      end = _qaEndOfDay(customEnd);
      if (start.getTime() > end.getTime()) {
        const tmp = start;
        start = _qaDayStart(end);
        end = _qaEndOfDay(tmp);
      }
      label = `${_qaFormatDate(start)} – ${_qaFormatDate(end)}`;
    } else {
      label = "Custom range";
    }
  }

  return {
    mode,
    fromMs: start.getTime(),
    toMs: end.getTime(),
    label,
    startLabel: _qaFormatDate(start),
    endLabel: _qaFormatDate(end),
  };
}

function syncRangeControls() {
  const screen = document.getElementById(SCREEN_ID);
  const mode = document.getElementById("ffQaRangeMode");
  const start = document.getElementById("ffQaCustomStart");
  const end = document.getElementById("ffQaCustomEnd");
  if (mode) mode.value = _qaRangeState.mode || "thisWeek";
  if (start) start.value = _qaRangeState.customStart || _qaDateInputValue(new Date());
  if (end) end.value = _qaRangeState.customEnd || _qaDateInputValue(new Date());
  if (screen) screen.classList.toggle("qa-custom-range", (_qaRangeState.mode || "thisWeek") === "custom");
}

function _qaRenderLocation(scope = _qaLocationScope()) {
  const el = document.getElementById("ffQaLocationLabel");
  if (el) el.textContent = scope.label;
}

// Compute the full breakdown needed for sections A-D.
// ---------- Formatting helpers ----------

// ---------- Render ----------

function exportCurrentCsv() {
  const range = _lastRange || getSelectedRange();
  const metrics = _lastMetrics || computeQueueAnalytics(range.fromMs, range.toMs);
  metrics.rangeLabel = metrics.rangeLabel || range.label;
  const insights = buildInsights(metrics);
  const rows = [];

  rows.push(["Queue Analytics Export"]);
  rows.push(["Range", range.label]);
  rows.push(["From", range.startLabel]);
  rows.push(["To", range.endLabel]);
  rows.push([]);

  rows.push(["Summary"]);
  rows.push(["Metric", "Value"]);
  rows.push(["Service starts", metrics.totalStarts || 0]);
  rows.push(["Active staff", metrics.totalActiveStaff || 0]);
  rows.push(["Average staff per day", fmtStaffAverage(metrics.avgStaffPerDay)]);
  rows.push(["Staff activity days", metrics.staffActivityDays || 0]);
  rows.push(["Average wait time", fmtMinutes(metrics.avgWaitMin)]);
  rows.push(["Longest wait time", fmtMinutes(metrics.longestWaitMin)]);
  rows.push(["Wait events", metrics.waitCount || 0]);
  rows.push(["Busiest day", metrics.busiestDay || ""]);
  rows.push(["Peak hour", metrics.peakHour == null ? "" : fmtHourRange(metrics.peakHour)]);
  rows.push([]);

  rows.push(["Wait Time by Day"]);
  rows.push(["Day", "Average Wait", "Longest Wait", "Queue Load", "Wait Events", "Total Staff", "Peak Hour"]);
  (metrics.byDay || []).forEach((r) => {
    rows.push([
      r.dayName,
      fmtMinutes(r.avgWaitMin),
      fmtMinutes(r.longestWaitMin),
      r.count || 0,
      r.waitsInDay || 0,
      r.totalStaff || 0,
      r.peakHour == null ? "" : fmtHourRange(r.peakHour),
    ]);
  });
  rows.push([]);

  rows.push(["Queue Load by Hour"]);
  rows.push(["Day", "Hour", "Service Starts", "Active Staff", "Staff by Type", "Average Wait by Type", "Average Wait"]);
  (metrics.byDayHour || []).forEach((day) => {
    if (!day.isOpen) {
      rows.push([day.dayName, "Closed", "", "", "", "", "", ""]);
      return;
    }
    (day.hours || []).forEach((hour) => {
      rows.push([
        day.dayName,
        fmtHourRange(hour.hour),
        hour.starts || 0,
        hour.activeStaff || 0,
        formatTypeBreakdown(hour.staffByType),
        formatTypeBreakdown(buildWaitTimeTypeRows(hour), fmtIdleMinutes),
        fmtIdleMinutes(hour.idleMinutes),
      ]);
    });
  });
  rows.push([]);

  rows.push(["Insights"]);
  insights.forEach((item) => rows.push([item.text]));

  const csv = `\uFEFF${rows.map(csvRow).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const safeRange = String(range.label || "range").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const a = document.createElement("a");
  a.href = url;
  a.download = `fair-flow-queue-analytics-${safeRange || "export"}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  try {
    if (window.ffToast && typeof window.ffToast.success === "function") {
      window.ffToast.success("Queue Analytics export created");
    }
  } catch (_) {}
}

function refresh() {
  const screen = document.getElementById(SCREEN_ID);
  if (!screen || screen.style.display === "none") return;
  syncRangeControls();
  const scope = _qaLocationScope();
  _qaRenderLocation(scope);
  console.log(LOC_LOG, "active location", { activeLocationId: scope.id || "", label: scope.label });
  const range = getSelectedRange();
  const label = document.getElementById("ffQaRangeLabel");
  if (label) label.textContent = range.label;
  let metrics;
  try {
    metrics = computeQueueAnalytics(range.fromMs, range.toMs);
    metrics.rangeLabel = range.label;
    metrics.range = range;
    _lastMetrics = metrics;
    _lastRange = range;
  } catch (e) {
    console.warn(LOG, "error calculating metrics", e);
    renderEmpty(scope.hasLocation ? "No queue data available for this location yet" : "Please select a location");
    return;
  }
  if (!metrics.sourceFound || (
    metrics.activityCount === 0 &&
    metrics.waitCount === 0 &&
    metrics.totalStarts === 0 &&
    metrics.totalActiveStaff === 0 &&
    metrics.totalIdleMinutes === 0
  )) {
    renderEmpty(scope.hasLocation ? "No queue data available for this location yet" : "Please select a location");
    return;
  }
  renderSummary(metrics);
  renderByDay(metrics);
  renderByHour(metrics, SCREEN_ID);
  renderInsights(metrics);
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
    if (!btn || btn._ffQaHideHandler) return;
    btn._ffQaHideHandler = () => { hideSelf(); };
    btn.addEventListener("click", btn._ffQaHideHandler, { capture: true });
  });
}

export function goToQueueAnalytics() {
  console.log(LOG, "screen opened");
  if (typeof window.ffCloseGlobalBlockingOverlays === "function") {
    try { window.ffCloseGlobalBlockingOverlays(); } catch (_) {}
  }
  if (typeof window.closeStaffMembersModal === "function") {
    try { window.closeStaffMembersModal(); } catch (_) {}
  }
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
  // transition (iOS Capacitor sometimes returns the pre-class computed style
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
  injectStyles(SCREEN_ID);
  buildScreen();
  bindAutoHideOnOtherNav();
  _injected = true;
  console.log(LOG, "screen injected");
}

// ---------- Init ----------

function init() {
  window.goToQueueAnalytics = goToQueueAnalytics;
  ensureInjected();

  if (!window.__ffQaLocationListenerBound) {
    window.__ffQaLocationListenerBound = true;
    document.addEventListener("ff-active-location-changed", () => {
      console.log(LOG, "active location changed → refresh");
      refresh();
    });
  }

  console.log(LOG, "init complete");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
