/**
 * Tickets Analytics — standalone screen for ticket insights.
 *
 * Self-contained module: injects #ticketsAnalyticsScreen DOM and scoped CSS,
 * exposes window.goToTicketsAnalytics(), and reads best-effort ticket data from
 * globals when available. It does not write Firestore or change Tickets logic.
 */

import { injectStyles } from "./tickets-analytics-styles.js?v=20260626_tickets_analytics_split";
import {
  LOG,
  cleanString,
  getLocationScope,
  readStaffNames,
  readCandidateArrays,
  readSettingsBusinessHours,
} from "./tickets-analytics-data.js?v=20260626_tickets_analytics_split";
import {
  LOC_LOG,
  fmtCurrency,
  fmtHourRange,
  computeTicketsAnalytics,
  buildInsights,
} from "./tickets-analytics-compute.js?v=20260626_tickets_analytics_split";
import {
  renderLocationScope,
  renderEmpty,
  renderSummary,
  renderByDay,
  renderByHour,
  renderItems,
  renderInsights,
  csvRow,
} from "./tickets-analytics-ui.js?v=20260626_tickets_analytics_split";

const SCREEN_ID = "ticketsAnalyticsScreen";
const STYLE_ID = "ffTicketsAnalyticsStyles";
const RANGE_STORAGE_KEY = "ff_tickets_analytics_range_v1";
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
  "profileBtn",
];

let _injected = false;
let _taRangeState = { mode: "thisWeek", customStart: "", customEnd: "" };
let _lastMetrics = null;
let _lastRange = null;

// ---------- Formatting ----------

function weekStartMs() {
  const d = new Date();
  const day = d.getDay();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}

function dayStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
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
      _taRangeState = {
        mode: saved.mode || "thisWeek",
        customStart: saved.customStart || "",
        customEnd: saved.customEnd || "",
      };
    }
  } catch (_) {}
}

function saveRangeState() {
  try {
    localStorage.setItem(RANGE_STORAGE_KEY, JSON.stringify(_taRangeState));
  } catch (_) {}
}

function getSelectedRange() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const weekStart = new Date(weekStartMs());
  const mode = _taRangeState.mode || "thisWeek";
  let start = weekStart;
  let end = now;
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
    const customStart = parseDateInput(_taRangeState.customStart);
    const customEnd = parseDateInput(_taRangeState.customEnd);
    if (customStart && customEnd) {
      start = dayStart(customStart);
      end = endOfDay(customEnd);
      if (start.getTime() > end.getTime()) {
        const tmp = start;
        start = dayStart(end);
        end = endOfDay(tmp);
      }
      label = `${formatDate(start)} – ${formatDate(end)}`;
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
  const mode = document.getElementById("ffTaRangeMode");
  const start = document.getElementById("ffTaCustomStart");
  const end = document.getElementById("ffTaCustomEnd");
  if (mode) mode.value = _taRangeState.mode || "thisWeek";
  if (start) start.value = _taRangeState.customStart || dateInputValue(new Date());
  if (end) end.value = _taRangeState.customEnd || dateInputValue(new Date());
  if (screen) screen.classList.toggle("ta-custom-range", (_taRangeState.mode || "thisWeek") === "custom");
}

// ---------- DOM ----------

function buildScreen() {
  if (document.getElementById(SCREEN_ID)) return document.getElementById(SCREEN_ID);
  const root = document.createElement("div");
  root.id = SCREEN_ID;
  root.innerHTML = `
    <div class="ta-wrap">
      <button type="button" class="ta-back" id="ffTaBack" aria-label="Back">← Back</button>
      <h1 class="ta-h1">Tickets Analytics</h1>
      <p class="ta-sub">Understand ticket volume, revenue, and employee performance</p>
      <div class="ta-location" id="ffTaLocationLabel">—</div>

      <div class="ta-toolbar" id="ffTaToolbar">
        <div class="ta-filter-row">
          <div class="ta-field">
            <label for="ffTaRangeMode">Date range</label>
            <select id="ffTaRangeMode">
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
            <label for="ffTaCustomStart">Start</label>
            <input type="date" id="ffTaCustomStart">
          </div>
          <div class="ta-field is-custom">
            <label for="ffTaCustomEnd">End</label>
            <input type="date" id="ffTaCustomEnd">
          </div>
          <button type="button" class="ta-action-btn secondary" id="ffTaApplyRange">Apply</button>
        </div>
        <div class="ta-toolbar-actions">
          <span class="ta-range-label" id="ffTaRangeLabel">This week</span>
          <button type="button" class="ta-action-btn" id="ffTaExportCsv">Export Excel</button>
        </div>
      </div>

      <div class="ta-section-title">Summary</div>
      <div id="ffTaSummary" class="ta-summary"></div>

      <div class="ta-section-title">Tickets by Day</div>
      <div id="ffTaByDay" class="ta-panel"></div>

      <div class="ta-section-title">Tickets by Hour</div>
      <div id="ffTaByHour" class="ta-panel"></div>

      <div class="ta-section-title">Top Selling Items</div>
      <div id="ffTaItems" class="ta-panel"></div>

      <div class="ta-section-title">Insights</div>
      <div id="ffTaInsights" class="ta-panel"></div>
    </div>
  `;
  document.body.appendChild(root);
  const back = root.querySelector("#ffTaBack");
  if (back) {
    back.addEventListener("click", () => {
      hideSelf();
      try {
        if (typeof window.goToDashboard === "function") window.goToDashboard();
      } catch (err) {
        console.warn(LOG, "back nav failed", err);
      }
    });
  }
  const rangeMode = root.querySelector("#ffTaRangeMode");
  const customStart = root.querySelector("#ffTaCustomStart");
  const customEnd = root.querySelector("#ffTaCustomEnd");
  const applyRange = root.querySelector("#ffTaApplyRange");
  const exportCsv = root.querySelector("#ffTaExportCsv");
  if (rangeMode) {
    rangeMode.addEventListener("change", () => {
      _taRangeState.mode = rangeMode.value || "thisWeek";
      saveRangeState();
      syncRangeControls();
      if (_taRangeState.mode !== "custom") refresh();
    });
  }
  [customStart, customEnd].forEach((input) => {
    if (!input) return;
    input.addEventListener("change", () => {
      _taRangeState.customStart = customStart ? customStart.value : "";
      _taRangeState.customEnd = customEnd ? customEnd.value : "";
      saveRangeState();
    });
  });
  if (applyRange) {
    applyRange.addEventListener("click", () => {
      _taRangeState.mode = rangeMode ? rangeMode.value : _taRangeState.mode;
      _taRangeState.customStart = customStart ? customStart.value : _taRangeState.customStart;
      _taRangeState.customEnd = customEnd ? customEnd.value : _taRangeState.customEnd;
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

// ---------- Data helpers ----------

// ---------- Render ----------

async function exportCurrentCsv() {
  const range = _lastRange || getSelectedRange();
  const metrics = _lastMetrics || await computeTicketsAnalytics(range);
  const insights = buildInsights(metrics);
  const rows = [];

  rows.push(["Tickets Analytics Export"]);
  rows.push(["Range", range.label]);
  rows.push(["From", range.startLabel]);
  rows.push(["To", range.endLabel]);
  rows.push([]);

  rows.push(["Summary"]);
  rows.push(["Metric", "Value"]);
  rows.push(["Total tickets", metrics.totalTickets || 0]);
  rows.push(["Total amount", fmtCurrency(metrics.totalAmount)]);
  rows.push(["Average ticket", fmtCurrency(metrics.averageTicket)]);
  rows.push(["Busiest day", metrics.busiestDay?.tickets ? metrics.busiestDay.dayName : ""]);
  rows.push(["Peak hour", metrics.peakHour ? fmtHourRange(metrics.peakHour.hour) : ""]);
  rows.push(["Best selling item", metrics.bestSellingItem?.name || ""]);
  rows.push([]);

  rows.push(["Tickets by Day"]);
  rows.push(["Day", "Tickets", "Total Amount", "Average Ticket", "Highest Ticket"]);
  (metrics.byDay || []).forEach((row) => {
    rows.push([
      row.dayName,
      row.tickets || 0,
      fmtCurrency(row.totalAmount || 0),
      row.tickets ? fmtCurrency(row.averageTicket) : "",
      row.tickets ? fmtCurrency(row.highestTicket) : "",
    ]);
  });
  rows.push([]);

  rows.push(["Tickets by Hour"]);
  rows.push(["Day", "Hour", "Tickets", "Total Amount", "Average Ticket"]);
  (metrics.byDayHour || []).forEach((day) => {
    if (!day.hours || !day.hours.length) {
      rows.push([day.dayName, "Closed", "", "", ""]);
      return;
    }
    day.hours.forEach((hour) => {
      rows.push([
        day.dayName,
        fmtHourRange(hour.hour),
        hour.tickets || 0,
        fmtCurrency(hour.totalAmount || 0),
        hour.tickets ? fmtCurrency(hour.averageTicket) : "",
      ]);
    });
  });
  rows.push([]);

  rows.push(["Top Selling Items"]);
  rows.push(["Item", "Sold", "Total Amount", "Average Price"]);
  (metrics.items || []).slice(0, 10).forEach((item) => {
    rows.push([
      item.name,
      item.sold || 0,
      fmtCurrency(item.totalAmount || 0),
      fmtCurrency(item.averagePrice),
    ]);
  });
  rows.push([]);

  rows.push(["Insights"]);
  insights.forEach((text) => rows.push([text]));

  const csv = `\uFEFF${rows.map(csvRow).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const safeRange = String(range.label || "range").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const a = document.createElement("a");
  a.href = url;
  a.download = `tickets-analytics-${safeRange || "range"}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  try {
    if (window.ffToast && typeof window.ffToast.success === "function") {
      window.ffToast.success("Tickets Analytics export created");
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
  const label = document.getElementById("ffTaRangeLabel");
  if (label) label.textContent = range.label;
  try {
    const metrics = await computeTicketsAnalytics(range);
    _lastMetrics = metrics;
    _lastRange = range;
    if (!metrics.hasData) {
      renderEmpty(scope.hasLocation ? "No ticket data available for this location yet" : "Please select a location");
      return;
    }
    renderSummary(metrics);
    renderByDay(metrics);
    renderByHour(metrics);
    renderItems(metrics);
    renderInsights(metrics);
  } catch (err) {
    console.error(LOG, "refresh failed", err);
    renderEmpty(scope.hasLocation ? "No ticket data available for this location yet" : "Please select a location");
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
    if (!btn || btn._ffTaHideHandler) return;
    btn._ffTaHideHandler = () => { hideSelf(); };
    btn.addEventListener("click", btn._ffTaHideHandler, { capture: true });
  });
}

export function goToTicketsAnalytics() {
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
  window.goToTicketsAnalytics = goToTicketsAnalytics;
  ensureInjected();
  if (!window.__ffTaLocationListenerBound) {
    window.__ffTaLocationListenerBound = true;
    document.addEventListener("ff-active-location-changed", () => {
      console.log(LOG, "active location changed → refresh");
      refresh();
    });
    document.addEventListener("ff-tickets-data-changed", () => {
      console.log(LOG, "tickets data changed → refresh");
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
