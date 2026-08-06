/**
 * Dashboard (Overview) — Fair Flow
 *
 * Single-screen overview for the business: Queue, Tickets, Time Clock, Tasks
 * plus Insights/Alerts. Read-only; safe to add without touching existing
 * modules.
 *
 * Design notes
 * ------------
 * - Self-contained: injects its own #dashboardScreen DOM and styles.
 * - Reads live data via globals when available, otherwise falls back to 0
 *   or "—" placeholders. Existing modules are not modified.
 * - Hides itself on capture-phase clicks of other main-nav buttons (same
 *   pattern tickets.js uses) so we never have to change goToQueue / etc.
 * - Re-renders on `ff-active-location-changed` so KPIs follow the active
 *   branch.
 *
 * Logging prefix: [Dashboard]
 */

import { injectStyles } from "./dashboard-styles.js?v=20260626_dashboard_split";
import {
  LOG,
  LOC_LOG,
  todayStartMs,
  endOfTodayMs,
  weekStartMs,
  monthStartMs,
  parseLocalDateStartMs,
  parseLocalDateEndMs,
  getDashboardLocationScope,
  readTicketsSnapshot,
  readQueueSnapshot,
  readTasksSnapshot,
  readTimeClockSnapshot,
} from "./dashboard-data.js?v=20260626_dashboard_split";
import {
  renderDashboardLocation,
  renderKpis,
  renderModuleCards,
  renderInsights,
} from "./dashboard-ui.js?v=20260626_dashboard_split";

const SCREEN_ID = "dashboardScreen";
const STYLE_ID = "ffDashboardStyles";
const NAV_BTN_ID = "dashboardBtn";

// Capture-phase auto-hide on these other main-nav buttons. Mirrors the
// pattern in tickets.js so we don't have to modify their goTo* functions.
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
];

let _injected = false;
let _refreshTimer = null;
let _dashboardRangeMode = (() => {
  try { return localStorage.getItem("ff_dashboard_range_mode_v1") || "thisWeek"; } catch (_) { return "thisWeek"; }
})();
let _dashboardCustomStart = (() => {
  try { return localStorage.getItem("ff_dashboard_custom_start_v1") || ""; } catch (_) { return ""; }
})();
let _dashboardCustomEnd = (() => {
  try { return localStorage.getItem("ff_dashboard_custom_end_v1") || ""; } catch (_) { return ""; }
})();

// ---------- DOM injection ----------

function buildScreen() {
  if (document.getElementById(SCREEN_ID)) return document.getElementById(SCREEN_ID);
  const root = document.createElement("div");
  root.id = SCREEN_ID;
  root.innerHTML = `
    <div class="dash-wrap" id="ffDashWrap">
      <div class="dash-head-row">
        <div class="dash-title-group">
          <h1 class="dash-h1">Dashboard</h1>
          <p class="dash-sub" id="ffDashSubtitle">Overview of your business activity</p>
          <div class="dash-location" id="ffDashLocationLabel">—</div>
        </div>
        <div class="dash-range-controls" aria-label="Dashboard date range">
          <span class="dash-range-label">Date range</span>
          <select id="ffDashRangeSelect" class="dash-range-select">
            <option value="today">Today</option>
            <option value="thisWeek">This week</option>
            <option value="thisMonth">This month</option>
            <option value="last7">Last 7 days</option>
            <option value="custom">Custom date</option>
          </select>
          <span id="ffDashCustomRange" class="dash-range-custom">
            <input id="ffDashCustomStart" class="dash-range-date" type="date" aria-label="Custom start date">
            <span style="font-size:12px;color:#9ca3af;">to</span>
            <input id="ffDashCustomEnd" class="dash-range-date" type="date" aria-label="Custom end date">
          </span>
        </div>
      </div>

      <div class="dash-section-title" id="ffDashGlanceTitle">At a glance</div>
      <div class="dash-kpis" id="ffDashKpis"></div>

      <div class="dash-section-title">Modules</div>
      <div class="dash-grid" id="ffDashGrid"></div>

      <div class="dash-section-title">Insights</div>
      <div class="dash-card">
        <div class="dash-card-header">
          <h3 class="dash-card-title">Insights &amp; alerts</h3>
          <span class="dash-card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/><circle cx="12" cy="12" r="4"/></svg>
          </span>
        </div>
        <ul class="dash-insights-list" id="ffDashInsights"></ul>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  return root;
}

// ---------- Data helpers (best-effort, never throw) ----------

function getDashboardDateRange() {
  const now = Date.now();
  const today = todayStartMs();
  const mode = ["today", "thisWeek", "thisMonth", "last7", "custom"].includes(_dashboardRangeMode)
    ? _dashboardRangeMode
    : "thisWeek";
  if (mode === "today") {
    return { mode, startMs: today, endMs: endOfTodayMs(), label: "Today", shortLabel: "Today" };
  }
  if (mode === "thisMonth") {
    return { mode, startMs: monthStartMs(), endMs: now, label: "This month", shortLabel: "This month" };
  }
  if (mode === "last7") {
    return { mode, startMs: now - (7 * 24 * 60 * 60 * 1000), endMs: now, label: "Last 7 days", shortLabel: "Last 7 days" };
  }
  if (mode === "custom") {
    const start = parseLocalDateStartMs(_dashboardCustomStart);
    const end = parseLocalDateEndMs(_dashboardCustomEnd);
    if (start != null && end != null && end >= start) {
      return {
        mode,
        startMs: start,
        endMs: end,
        label: `${_dashboardCustomStart} to ${_dashboardCustomEnd}`,
        shortLabel: "Custom date",
      };
    }
  }
  return { mode: "thisWeek", startMs: weekStartMs(), endMs: now, label: "This week", shortLabel: "This week" };
}

// Best-effort tickets snapshot. Tickets module keeps its data internal,
// so we look for any of the common globals it (or future code) might
// expose. Falls back gracefully.
// ---------- Queue metrics (from window.log / ffv24_log) ----------
//
// Source: queue-cloud.js syncs salons/{salonId}/queueState/{locationId}.log into
// `window.log` (and localStorage `ffv24_log`). Entries are an array of strings
// in chronological-DESC order, each in the form
//   "MM/DD/YYYY, h:mm:ss AM <ACTION>"
// where <ACTION> is one of (case sensitive on the verb keywords):
//   join: <name>
//   START -> IN SERVICE: <name>
//   FINISH -> Back to end: <name>
//   HOLD: <name> | RELEASE: <name>
//   MOVE UP: <name> | MOVE DOWN: <name>
// Newer object-shaped entries (points corrections, etc.) carry their own ts /
// action / source fields and are skipped unless source === 'queue'.

// Parse a single log entry (string or object) into { ts, action, worker } or null.
// Compute queue metrics for [fromMs, nowMs]. Returns nulls when no data.
// ---------- Render ----------

function renderDashboardRangeControls(range) {
  const select = document.getElementById("ffDashRangeSelect");
  const custom = document.getElementById("ffDashCustomRange");
  const start = document.getElementById("ffDashCustomStart");
  const end = document.getElementById("ffDashCustomEnd");
  const title = document.getElementById("ffDashGlanceTitle");
  if (select) select.value = range.mode || _dashboardRangeMode || "thisWeek";
  if (custom) custom.style.display = (select?.value || range.mode) === "custom" ? "inline-flex" : "none";
  if (start) start.value = _dashboardCustomStart || "";
  if (end) end.value = _dashboardCustomEnd || "";
  if (title) title.textContent = `${range.shortLabel || "Selected range"} at a glance`;
}

function bindDashboardRangeControls() {
  const select = document.getElementById("ffDashRangeSelect");
  const start = document.getElementById("ffDashCustomStart");
  const end = document.getElementById("ffDashCustomEnd");
  if (select && !select.__ffDashBound) {
    select.__ffDashBound = true;
    select.addEventListener("change", () => {
      _dashboardRangeMode = select.value || "thisWeek";
      try { localStorage.setItem("ff_dashboard_range_mode_v1", _dashboardRangeMode); } catch (_) {}
      refresh();
    });
  }
  if (start && !start.__ffDashBound) {
    start.__ffDashBound = true;
    start.addEventListener("change", () => {
      _dashboardCustomStart = start.value || "";
      try { localStorage.setItem("ff_dashboard_custom_start_v1", _dashboardCustomStart); } catch (_) {}
      refresh();
    });
  }
  if (end && !end.__ffDashBound) {
    end.__ffDashBound = true;
    end.addEventListener("change", () => {
      _dashboardCustomEnd = end.value || "";
      try { localStorage.setItem("ff_dashboard_custom_end_v1", _dashboardCustomEnd); } catch (_) {}
      refresh();
    });
  }
}

async function refresh() {
  const screen = document.getElementById(SCREEN_ID);
  if (!screen || screen.style.display === "none") return;
  console.log(LOG, "refresh");
  const scope = getDashboardLocationScope();
  const range = getDashboardDateRange();
  console.log(LOC_LOG, "active location", { activeLocationId: scope.id || "", label: scope.label });
  renderDashboardLocation(scope);
  renderDashboardRangeControls(range);
  const snap = {
    tickets: await readTicketsSnapshot(range),
    queue: readQueueSnapshot(range),
    tasks: readTasksSnapshot(range),
    time: { totalHours: 0, overtimeHours: 0, topStaffName: null, hasData: false },
  };
  try {
    snap.time = await readTimeClockSnapshot(range);
  } catch (e) {
    console.warn(LOG, "async time refresh failed", e);
  }
  renderKpis(snap, range);
  renderModuleCards(snap, range);
  renderInsights(snap);
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

function bindAutoHideOnOtherNav() {
  const screen = () => document.getElementById(SCREEN_ID);
  OTHER_NAV_IDS.forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn || btn._ffDashHideHandler) return;
    btn._ffDashHideHandler = () => {
      const s = screen();
      if (s) s.style.display = "none";
      document.body.classList.remove("ff-dashboard-open");
      const navBtn = document.getElementById(NAV_BTN_ID);
      if (navBtn) navBtn.classList.remove("active");
      if (typeof window.ffUpdateMobileHeaderTitle === "function") window.ffUpdateMobileHeaderTitle();
      if (_refreshTimer) {
        clearInterval(_refreshTimer);
        _refreshTimer = null;
      }
    };
    btn.addEventListener("click", btn._ffDashHideHandler, { capture: true });
  });
}

export function goToDashboard() {
  console.log(LOG, "goToDashboard");
  if (typeof window.ffCurrentUserHasDashboardViewPermission === "function" && !window.ffCurrentUserHasDashboardViewPermission()) {
    if (typeof window.showToast === "function") {
      try { window.showToast("Dashboard access is not enabled for this staff member.", "error"); } catch (_) {}
    }
    return;
  }
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
  // up too small. That pushes the first row of content behind the purple
  // bar on iOS.
  document.body.classList.add("ff-dashboard-open");

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
  const btn = document.getElementById(NAV_BTN_ID);
  if (btn) btn.classList.add("active");

  refresh();

  if (_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = setInterval(() => { refresh(); }, 30000);

  if (typeof window.ffUpdateMobileHeaderTitle === "function") window.ffUpdateMobileHeaderTitle();
}

function ensureInjected() {
  if (_injected) return;
  injectStyles(SCREEN_ID, STYLE_ID);
  buildScreen();
  bindDashboardRangeControls();
  bindAutoHideOnOtherNav();
  _injected = true;
  console.log(LOG, "screen injected");
}

// ---------- Init ----------

function init() {
  // Make navigation function available even if the button is wired before
  // this module finishes loading.
  window.goToDashboard = goToDashboard;

  ensureInjected();

  const navBtn = document.getElementById(NAV_BTN_ID);
  if (navBtn && !navBtn._ffDashBound) {
    navBtn._ffDashBound = true;
    navBtn.addEventListener("click", (e) => {
      e.preventDefault();
      goToDashboard();
    });
  }

  // Re-render whenever the active branch changes.
  if (!window.__ffDashLocationListenerBound) {
    window.__ffDashLocationListenerBound = true;
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
