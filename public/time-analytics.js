/**
 * Time Analytics - simple dashboard-level analytics.
 *
 * Scope:
 * - Read-only analytics screen.
 * - Uses timeEntries for actual worked time.
 * - Uses published schedule snapshots when available for simple accuracy.
 * - Does not modify Time Clock, Schedule, Firestore, or rules.
 */

import { collection, doc, getDoc, getDocs, limit, query } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "./app.js?v=20260412_salon_owner_uid";

const LOG = "[TimeAnalytics Simple]";
const MATCH_LOG = "[TimeAnalytics Match]";
const SCHEDULE_DEBUG_LOG = "[TimeAnalytics ScheduleDebug]";
const DEVIATIONS_LOG = "[TimeAnalytics Deviations]";
const LOC_LOG = "[TimeAnalytics LocationScope]";
const SCREEN_ID = "timeAnalyticsScreen";
const STYLE_ID = "ffTimeAnalyticsStyles";
const RANGE_STORAGE_KEY = "ff_time_analytics_range_v1";
const DEFAULT_WEEKLY_THRESHOLD = 40;
const DEFAULT_TOLERANCE_MINUTES = 10;
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

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtHours(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}h` : "--";
}

function fmtNumber(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString() : "--";
}

function fmtPercent(value) {
  return Number.isFinite(value) ? `${Math.round(value)}%` : "--";
}

function fmtMinutes(value) {
  const minutes = Math.round(Number(value) || 0);
  if (minutes <= 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmtTime(ms) {
  if (!Number.isFinite(ms)) return "--";
  try {
    return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch (_) {
    return "--";
  }
}

function fmtDayName(dateKey) {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateKey || "";
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!Number.isFinite(d.getTime())) return dateKey || "";
  return d.toLocaleDateString([], { weekday: "long" });
}

function toMillis(value) {
  try {
    if (value == null) return null;
    if (typeof value === "number" && Number.isFinite(value)) {
      return value > 100000000000 ? value : value * 1000;
    }
    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? null : parsed;
    }
    if (typeof value.toMillis === "function") {
      const ms = value.toMillis();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value.toDate === "function") {
      const d = value.toDate();
      const ms = d && typeof d.getTime === "function" ? d.getTime() : NaN;
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value.seconds === "number") {
      return value.seconds * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1000000);
    }
  } catch (err) {
    console.warn(LOG, "toMillis failed", err);
  }
  return null;
}

function minutesFromHHMM(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const ampm = String(match[3] || "").toUpperCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  if (ampm && (hour < 1 || hour > 12)) return null;
  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function ymdLocal(date) {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateFromYmdAndMinutes(dateKey, minutes) {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match || !Number.isFinite(minutes)) return null;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

function readShiftBoundaryMs(value, dateKey) {
  const direct = toMillis(value);
  if (Number.isFinite(direct)) return direct;
  const minutes = minutesFromHHMM(value);
  const d = dateFromYmdAndMinutes(dateKey, minutes);
  return d ? d.getTime() : null;
}

function getWeekStartsOnPreference() {
  try {
    const raw = window.settings?.preferences?.weekStartsOn;
    if (String(raw || "").toLowerCase() === "sunday") return "sunday";
  } catch (_) {}
  return "monday";
}

function getWeekStart(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const startsOnSunday = getWeekStartsOnPreference() === "sunday";
  const day = d.getDay();
  const diff = startsOnSunday ? day : (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
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

function getActiveLocationId() {
  try {
    if (typeof window.ffGetActiveLocationId === "function") {
      const id = String(window.ffGetActiveLocationId() || "").trim();
      if (id) return id;
    }
  } catch (_) {}
  try {
    const id = String(window.__ff_active_location_id || window.activeLocationId || "").trim();
    if (id) return id;
  } catch (_) {}
  return "";
}

function getLocationScope() {
  const id = getActiveLocationId();
  let name = "";
  try {
    const lists = [
      typeof window.ffGetActiveLocations === "function" ? window.ffGetActiveLocations() : null,
      typeof window.ffGetLocations === "function" ? window.ffGetLocations() : null,
      window.ffLocationsState?.locations,
    ];
    for (const list of lists) {
      const match = (Array.isArray(list) ? list : []).find((loc) => String(loc?.id || loc?.locationId || "").trim() === id);
      if (match) {
        name = String(match.name || match.label || match.title || id).trim();
        break;
      }
    }
  } catch (_) {}
  return {
    id,
    name: name || id || "",
    hasLocation: !!id,
    label: id ? `${name || id}` : "Select location",
  };
}

function renderLocationScope(scope = getLocationScope()) {
  const el = document.getElementById("ffTimeAnalyticsLocationLabel");
  if (el) el.textContent = scope.label;
}

function logLocationScope(source, scope, before, after, skippedNoLocation) {
  console.log(LOC_LOG, source, {
    activeLocationId: scope?.id || "",
    recordsBeforeFilter: before,
    recordsAfterFilter: after,
    skippedRecordsWithoutLocationId: skippedNoLocation,
  });
}

function schedulePublishDocId() {
  const locId = getActiveLocationId();
  return locId ? `weeks_${locId}` : "weeks";
}

function getSalonId() {
  try {
    return String(window.currentSalonId || "").trim();
  } catch (_) {
    return "";
  }
}

function getOvertimeThreshold() {
  try {
    const configured = Number(window.settings?.timeClock?.overtime?.weeklyThreshold);
    if (Number.isFinite(configured) && configured >= 0) return configured;
  } catch (_) {}
  return DEFAULT_WEEKLY_THRESHOLD;
}

function readStaffNames() {
  const byId = new Map();
  const addRows = (rows) => {
    (Array.isArray(rows) ? rows : []).forEach((s) => {
      const id = String(s?.id || s?.staffId || s?.uid || s?.firebaseUid || "").trim();
      const name = String(s?.name || s?.staffName || s?.displayName || s?.email || "").trim();
      if (id && name && !byId.has(id)) byId.set(id, name);
    });
  };
  try {
    const store = typeof window.ffGetStaffStore === "function" ? window.ffGetStaffStore() : null;
    addRows(store?.staff);
  } catch (err) {
    console.warn(LOG, "staff helper failed", err);
  }
  try {
    const store = JSON.parse(localStorage.getItem("ff_staff_v1") || "{}");
    addRows(store?.staff);
  } catch (_) {}
  return byId;
}

// ---------- DOM ----------

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${SCREEN_ID} {
      display: none;
      position: fixed;
      top: var(--header-h, 60px);
      left: 0; right: 0; bottom: 0;
      background: #f5f6fa;
      z-index: 9850;
      flex-direction: column;
      overflow: auto;
      pointer-events: auto;
    }
    #${SCREEN_ID} .ta-wrap {
      max-width: 1180px;
      margin: 0 auto;
      padding: 6px 28px 48px;
      width: 100%;
    }
    #${SCREEN_ID} .ta-back {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: none;
      border: 0;
      color: #6b7280;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      padding: 4px 0;
      margin: 0 12px 6px 0;
    }
    #${SCREEN_ID} .ta-back:hover { color: #9d68b9; }
    #${SCREEN_ID} .ta-h1 {
      display: inline-block;
      vertical-align: middle;
      margin: 0 8px 6px 0;
      font-size: 16px;
      font-weight: 800;
      color: #111827;
      letter-spacing: -0.01em;
    }
    #${SCREEN_ID} .ta-sub {
      display: none;
    }
    #${SCREEN_ID} .ta-location {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      vertical-align: middle;
      margin: 0 0 6px 0;
      padding: 5px 8px;
      border-radius: 999px;
      background: #fff;
      border: 1px solid #e5e7eb;
      color: #6b7280;
      font-size: 10px;
      font-weight: 600;
    }
    #${SCREEN_ID} .ta-toolbar {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      padding: 11px 14px;
      margin: 6px 0 12px 0;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    #${SCREEN_ID} .ta-filter-row {
      display: flex;
      align-items: flex-end;
      gap: 10px;
      flex-wrap: wrap;
    }
    #${SCREEN_ID} .ta-field {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    #${SCREEN_ID} .ta-field label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
    }
    #${SCREEN_ID} .ta-field select,
    #${SCREEN_ID} .ta-field input {
      height: 36px;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      background: #fff;
      color: #111827;
      padding: 0 10px;
      font-size: 13px;
      min-width: 150px;
    }
    #${SCREEN_ID} .ta-field.is-custom { display: none; }
    #${SCREEN_ID}.ta-custom-range .ta-field.is-custom { display: flex; }
    #${SCREEN_ID} .ta-toolbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    #${SCREEN_ID} .ta-range-label {
      font-size: 12px;
      color: #6b7280;
      margin-right: 4px;
    }
    #${SCREEN_ID} .ta-action-btn {
      height: 36px;
      border: 0;
      border-radius: 999px;
      padding: 0 14px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      background: linear-gradient(135deg, #9d68b9, #ff9580);
      color: #fff;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.10);
    }
    #${SCREEN_ID} .ta-action-btn.secondary {
      background: #f3f4f6;
      color: #374151;
      box-shadow: none;
      border: 1px solid #e5e7eb;
    }
    #${SCREEN_ID} .ta-section-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6b7280;
      margin: 12px 2px 7px;
    }
    #${SCREEN_ID} .ta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 10px;
    }
    #${SCREEN_ID} .ta-card,
    #${SCREEN_ID} .ta-panel {
      background: #fff;
      border: 1px solid #e5e7eb;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    #${SCREEN_ID} .ta-card {
      border-radius: 14px;
      padding: 11px 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    #${SCREEN_ID} .ta-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
    }
    #${SCREEN_ID} .ta-value {
      font-size: 22px;
      font-weight: 800;
      color: #111827;
      line-height: 1.1;
    }
    #${SCREEN_ID} .ta-foot {
      font-size: 11px;
      color: #6b7280;
    }
    #${SCREEN_ID} .ta-panel {
      border-radius: 16px;
      padding: 18px 20px;
    }
    #${SCREEN_ID} .ta-compare-row {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    #${SCREEN_ID} .ta-deviation-title {
      margin: 18px 0 10px;
      font-size: 12px;
      font-weight: 800;
      color: #111827;
    }
    #${SCREEN_ID} .ta-deviation-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    #${SCREEN_ID} .ta-deviation {
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 12px 14px;
      background: #fafafa;
    }
    #${SCREEN_ID} .ta-deviation-head {
      font-size: 13px;
      font-weight: 800;
      color: #111827;
      margin-bottom: 6px;
    }
    #${SCREEN_ID} .ta-deviation-line {
      font-size: 12px;
      color: #4b5563;
      line-height: 1.45;
    }
    #${SCREEN_ID} .ta-deviation-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    #${SCREEN_ID} .ta-deviation-tag {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 4px 8px;
      background: #fff7ed;
      border: 1px solid #fed7aa;
      color: #9a3412;
      font-size: 11px;
      font-weight: 700;
    }
    #${SCREEN_ID} .ta-empty {
      border: 1px dashed #d1d5db;
      background: #fff;
      border-radius: 14px;
      padding: 24px;
      color: #6b7280;
      font-size: 14px;
      text-align: center;
    }
    #${SCREEN_ID} .ta-insights {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    #${SCREEN_ID} .ta-insight {
      padding: 10px 12px;
      border-radius: 10px;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      color: #1e40af;
      font-size: 13px;
      line-height: 1.4;
    }
    #${SCREEN_ID} .ta-insight.warn {
      background: #fff7ed;
      border-color: #fed7aa;
      color: #9a3412;
    }
    #${SCREEN_ID} .ta-insight.good {
      background: #ecfdf5;
      border-color: #a7f3d0;
      color: #065f46;
    }
    @media (max-width: 800px) {
      #${SCREEN_ID} .ta-wrap { padding: 16px 14px 32px; }
      #${SCREEN_ID} .ta-h1,
      #${SCREEN_ID} .ta-location { margin-left: 0; }
      #${SCREEN_ID} .ta-toolbar { align-items: stretch; }
      #${SCREEN_ID} .ta-toolbar-actions { width: 100%; }
      #${SCREEN_ID} .ta-action-btn { flex: 1; }
      #${SCREEN_ID} .ta-compare-row { grid-template-columns: 1fr; }
    }
  `;
  document.head.appendChild(style);
}

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

async function readTimeEntries(from, to) {
  try {
    if (typeof window.ffListTimeEntriesForSalon !== "function") {
      console.log(LOG, "time entries helper unavailable");
      return [];
    }
    const locationId = getActiveLocationId();
    const rows = await window.ffListTimeEntriesForSalon({
      from,
      to,
      locationId,
      statuses: ["open", "closed"],
      maxResults: 1000,
    });
    console.log(LOG, "time entries loaded", Array.isArray(rows) ? rows.length : 0);
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.warn(LOG, "readTimeEntries failed", err);
    return [];
  }
}

async function readScheduleDays(weekStartDate) {
  const salonId = getSalonId();
  const weekKey = ymdLocal(weekStartDate);
  const weekEndKey = ymdLocal(endOfDay(addDays(weekStartDate, 6)));
  const activeLocationId = getActiveLocationId();
  const account = (() => {
    try {
      return {
        uid: window.auth?.currentUser?.uid || window.currentUserProfile?.uid || null,
        email: window.auth?.currentUser?.email || window.currentUserProfile?.email || null,
        staffId: window.__ff_authedStaffId || window.currentUserProfile?.staffId || null,
      };
    } catch (_) {
      return {};
    }
  })();

  console.log(SCHEDULE_DEBUG_LOG, "context", {
    account,
    salonId,
    activeLocationId,
    weekStart: weekKey,
    weekEnd: weekEndKey,
  });
  if (!salonId || !weekKey) {
    console.warn(SCHEDULE_DEBUG_LOG, "missing required context", { salonId, weekKey });
    return null;
  }

  const sources = [];
  const addSourceResult = (name, details) => {
    sources.push({ name, ...details });
    console.log(SCHEDULE_DEBUG_LOG, "source checked", { name, ...details });
  };
  const pickDays = (name, days, details = {}) => {
    const shifts = extractScheduledShifts(days);
    addSourceResult(name, {
      ...details,
      days: Array.isArray(days) ? days.length : 0,
      shifts: shifts.length,
      firstShift: shifts[0] || null,
      accepted: shifts.length > 0,
      rejectedReason: shifts.length ? "" : (details.rejectedReason || "No shifts found"),
    });
    return shifts.length ? days : null;
  };

  const docIds = [
    schedulePublishDocId(),
    activeLocationId ? "weeks" : "",
    activeLocationId ? `loc_${activeLocationId}` : "",
    "default",
  ].filter(Boolean);
  const seenDocIds = new Set();
  try {
    for (const docId of docIds) {
      if (seenDocIds.has(docId)) continue;
      seenDocIds.add(docId);
      const sourceName = `schedulePublish/${docId}`;
      try {
        const ref = doc(db, `salons/${salonId}/schedulePublish/${docId}`);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          addSourceResult(sourceName, { exists: false, shifts: 0, rejectedReason: "Document does not exist" });
          continue;
        }
        const data = snap.data() || {};
        const block = data.weekDraftSnapshots && data.weekDraftSnapshots[weekKey];
        const days = block && Array.isArray(block.days) ? block.days : null;
        const picked = pickDays(sourceName, days, {
          exists: true,
          docId,
          published: data.published?.[weekKey] === true,
          hasWeekBlock: !!block,
        });
        if (picked) return picked;
      } catch (err) {
        addSourceResult(sourceName, { shifts: 0, rejectedReason: err?.message || String(err) });
      }
    }

    const localDays = readLocalScheduleDays({ salonId, activeLocationId, weekStart: weekKey, weekEnd: weekEndKey });
    for (const item of localDays) {
      const picked = pickDays(item.name, item.days, item.details);
      if (picked) return picked;
    }

    await debugProbeScheduleCollections(salonId, weekKey, addSourceResult);
    console.warn(SCHEDULE_DEBUG_LOG, "no schedule source produced shifts", { sourcesChecked: sources.length, sources });
    return null;
  } catch (err) {
    console.warn(LOG, "readScheduleDays failed", err);
    console.warn(SCHEDULE_DEBUG_LOG, "readScheduleDays failed", err);
    return null;
  }
}

async function readScheduleDaysForRange(range) {
  const out = [];
  const seenDates = new Set();
  try {
    const fromMs = Number(range?.fromMs);
    const toMs = Number(range?.toMs);
    const firstWeek = getWeekStart(Number.isFinite(fromMs) ? new Date(fromMs) : new Date());
    const lastWeek = getWeekStart(Number.isFinite(toMs) ? new Date(toMs) : new Date());
    for (let cursor = new Date(firstWeek); cursor.getTime() <= lastWeek.getTime(); cursor = addDays(cursor, 7)) {
      const days = await readScheduleDays(cursor);
      (Array.isArray(days) ? days : []).forEach((day) => {
        const key = String(day?.date || day?.dateKey || "").trim();
        if (!key || seenDates.has(key)) return;
        seenDates.add(key);
        out.push(day);
      });
    }
  } catch (err) {
    console.warn(SCHEDULE_DEBUG_LOG, "readScheduleDaysForRange failed", err);
  }
  return out;
}

function readLocalScheduleDays({ salonId, activeLocationId, weekStart, weekEnd }) {
  const out = [];
  try {
    const locPart = activeLocationId ? `__${activeLocationId}` : "";
    const salonKey = `${salonId || "_local"}${locPart}`;
    const keys = [
      `ff_schedule_draft_override_v1_${salonKey}_${weekStart}_${weekEnd}`,
      `ff_schedule_last_build_v1_${salonId || "_local"}${locPart}_${weekStart}_${weekEnd}`,
    ];
    keys.forEach((key) => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) {
          out.push({ name: `localStorage/${key}`, days: null, details: { exists: false, rejectedReason: "Missing localStorage key" } });
          return;
        }
        const parsed = JSON.parse(raw);
        out.push({
          name: `localStorage/${key}`,
          days: Array.isArray(parsed?.days) ? parsed.days : null,
          details: { exists: true, payloadVersion: parsed?.v || null },
        });
      } catch (err) {
        out.push({ name: `localStorage/${key}`, days: null, details: { exists: true, rejectedReason: err?.message || String(err) } });
      }
    });
  } catch (err) {
    console.warn(SCHEDULE_DEBUG_LOG, "local schedule probe failed", err);
  }
  return out;
}

async function debugProbeScheduleCollections(salonId, weekKey, addSourceResult) {
  const probes = [
    { name: "settings/schedule", kind: "doc", path: `salons/${salonId}/settings/schedule` },
    { name: "settings/businessHours", kind: "doc", path: `salons/${salonId}/settings/businessHours` },
    { name: "schedules collection", kind: "collection", path: `salons/${salonId}/schedules` },
    { name: "schedule collection", kind: "collection", path: `salons/${salonId}/schedule` },
  ];
  for (const probe of probes) {
    try {
      if (probe.kind === "doc") {
        const snap = await getDoc(doc(db, probe.path));
        addSourceResult(probe.name, {
          path: probe.path,
          exists: snap.exists(),
          shifts: 0,
          rejectedReason: snap.exists() ? "Settings doc is not a shift source" : "Document does not exist",
        });
      } else {
        const snap = await getDocs(query(collection(db, probe.path), limit(5)));
        addSourceResult(probe.name, {
          path: probe.path,
          exists: !snap.empty,
          docsRead: snap.size,
          shifts: 0,
          firstDoc: snap.empty ? null : { id: snap.docs[0].id, keys: Object.keys(snap.docs[0].data() || {}).slice(0, 12) },
          rejectedReason: snap.empty ? "Collection empty or inaccessible" : `No reader implemented for week ${weekKey}; primary Schedule UI uses schedulePublish snapshots`,
        });
      }
    } catch (err) {
      addSourceResult(probe.name, {
        path: probe.path,
        shifts: 0,
        rejectedReason: err?.message || String(err),
      });
    }
  }
}

function extractScheduledShifts(days) {
  const out = [];
  if (!Array.isArray(days)) return out;
  days.forEach((day) => {
    const dateKey = String(day?.date || day?.dateKey || "").trim();
    const dayLocationId = String(day?.locationId || day?.locId || "").trim();
    const assignments = Array.isArray(day?.assignments) ? day.assignments : [];
    assignments.forEach((assignment) => {
      const staffId = String(
        assignment?.staffId ||
        assignment?.uid ||
        assignment?.staffMemberId ||
        "",
      ).trim();
      const startRaw = assignment?.scheduledStart || assignment?.scheduledStartAt || assignment?.startTime || assignment?.start;
      const endRaw = assignment?.scheduledEnd || assignment?.scheduledEndAt || assignment?.endTime || assignment?.end;
      const startMs = readShiftBoundaryMs(startRaw, dateKey);
      let endMs = readShiftBoundaryMs(endRaw, dateKey);
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs <= startMs) {
        endMs += 24 * 60 * 60 * 1000;
      }
      if (!staffId || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
      out.push({
        staffId,
        dateKey,
        scheduledStartMs: startMs,
        scheduledEndMs: endMs,
        scheduledStart: startRaw,
        scheduledEnd: endRaw,
        locationId: String(assignment?.locationId || dayLocationId || "").trim(),
        scheduledHours: (endMs - startMs) / 3600000,
      });
    });
  });
  return out;
}

function normalizeEntry(entry) {
  const clockInMs = toMillis(entry?.clockInAt || entry?.clockIn || entry?.startAt);
  const rawOut = toMillis(entry?.clockOutAt || entry?.clockOut || entry?.endAt);
  const clockOutMs = rawOut || (entry?.status === "open" ? Date.now() : null);
  if (!Number.isFinite(clockInMs) || !Number.isFinite(clockOutMs) || clockOutMs <= clockInMs) return null;
  return {
    id: String(entry?.id || ""),
    staffId: String(entry?.staffId || entry?.staffMemberId || entry?.uid || "unknown"),
    dateKey: ymdLocal(clockInMs),
    clockInMs,
    clockOutMs,
    locationId: String(entry?.locationId || entry?.locId || "").trim(),
    actualHours: (clockOutMs - clockInMs) / 3600000,
  };
}

function matchEntryToShift(entry, shifts, usedShiftIds) {
  const candidates = shifts
    .map((shift, idx) => ({ shift, idx }))
    .filter(({ shift, idx }) => {
      if (usedShiftIds.has(idx)) return false;
      return shift.staffId === entry.staffId && shift.dateKey === entry.dateKey;
    })
    .map(({ shift, idx }) => ({
      shift,
      idx,
      distance: Math.abs(entry.clockInMs - shift.scheduledStartMs),
    }))
    .sort((a, b) => a.distance - b.distance);
  const best = candidates[0] || null;
  if (!best) return null;
  usedShiftIds.add(best.idx);
  return best.shift;
}

function computeScheduleMatchMetrics(entries, scheduledShifts) {
  const out = {
    totalShifts: 0,
    accurateShifts: 0,
    lateStarts: 0,
    earlyLeaves: 0,
    overtimeShifts: 0,
    matchedEntries: 0,
    rejectedEntries: 0,
    scheduledShiftsFound: scheduledShifts.length,
    scheduleTrackingEnabled: scheduledShifts.length > 0,
    deviations: [],
  };
  if (!out.scheduleTrackingEnabled) {
    console.log(MATCH_LOG, "Schedule tracking not enabled", {
      entries: entries.length,
      scheduledShifts: scheduledShifts.length,
    });
    return out;
  }

  const usedShiftIds = new Set();
  entries.forEach((entry) => {
    const shift = matchEntryToShift(entry, scheduledShifts, usedShiftIds);
    if (!shift) {
      out.rejectedEntries += 1;
      return;
    }

    out.matchedEntries += 1;
    out.totalShifts += 1;

    const lateMinutes = Math.max(0, (entry.clockInMs - shift.scheduledStartMs) / 60000);
    const earlyMinutes = Math.max(0, (shift.scheduledEndMs - entry.clockOutMs) / 60000);
    const overtimeMinutes = Math.max(0, (entry.clockOutMs - shift.scheduledEndMs) / 60000);
    const late = lateMinutes > DEFAULT_TOLERANCE_MINUTES;
    const early = earlyMinutes > DEFAULT_TOLERANCE_MINUTES;
    const overtime = overtimeMinutes > DEFAULT_TOLERANCE_MINUTES;

    if (late) out.lateStarts += 1;
    if (early) out.earlyLeaves += 1;
    if (overtime) out.overtimeShifts += 1;
    if (!late && !early) out.accurateShifts += 1;
    if (late || early || overtime) {
      out.deviations.push({
        staffId: entry.staffId,
        dateKey: entry.dateKey,
        dayName: fmtDayName(entry.dateKey),
        scheduledStartMs: shift.scheduledStartMs,
        scheduledEndMs: shift.scheduledEndMs,
        actualStartMs: entry.clockInMs,
        actualEndMs: entry.clockOutMs,
        lateMinutes: late ? lateMinutes : 0,
        earlyMinutes: early ? earlyMinutes : 0,
        stayedLongerMinutes: overtime ? overtimeMinutes : 0,
      });
    }
  });

  console.log(DEVIATIONS_LOG, "deviations calculated", {
    count: out.deviations.length,
    firstDeviation: out.deviations[0] || null,
  });
  console.log(MATCH_LOG, "match summary", {
    scheduledShifts: out.scheduledShiftsFound,
    matched: out.matchedEntries,
    rejected: out.rejectedEntries,
    lateStarts: out.lateStarts,
    earlyLeaves: out.earlyLeaves,
    overtimeShifts: out.overtimeShifts,
    accurateShifts: out.accurateShifts,
    toleranceMinutes: DEFAULT_TOLERANCE_MINUTES,
  });
  return out;
}

async function computeTimeAnalytics(range = getSelectedRange()) {
  const scope = getLocationScope();
  const fromDate = new Date(range.fromMs);
  const toDate = new Date(range.toMs);
  const entriesRaw = await readTimeEntries(fromDate, toDate);
  const normalizedEntries = entriesRaw.map(normalizeEntry).filter(Boolean);
  const skippedEntriesNoLocation = normalizedEntries.filter((entry) => !entry.locationId).length;
  const entries = normalizedEntries.filter((entry) => scope.hasLocation && entry.locationId === scope.id);
  logLocationScope("time-entries", scope, entriesRaw.length, entries.length, skippedEntriesNoLocation);
  const scheduleDays = await readScheduleDaysForRange(range);
  const allScheduledShifts = extractScheduledShifts(scheduleDays);
  const skippedScheduleNoLocation = allScheduledShifts.filter((shift) => !shift.locationId).length;
  const scheduledShifts = allScheduledShifts.filter((shift) => {
    return scope.hasLocation &&
      shift.locationId === scope.id &&
      shift.scheduledStartMs >= range.fromMs &&
      shift.scheduledStartMs <= range.toMs;
  });
  logLocationScope("schedule-shifts", scope, allScheduledShifts.length, scheduledShifts.length, skippedScheduleNoLocation);
  const hasSchedule = scheduledShifts.length > 0;
  const threshold = getOvertimeThreshold();
  const staffNames = readStaffNames();

  const byStaff = new Map();
  let totalHours = 0;
  entries.forEach((entry) => {
    totalHours += entry.actualHours;
    byStaff.set(entry.staffId, (byStaff.get(entry.staffId) || 0) + entry.actualHours);
  });

  let overtimeHours = 0;
  let topStaff = null;
  byStaff.forEach((hours) => {
    if (hours > threshold) overtimeHours += hours - threshold;
    if (!topStaff || hours > topStaff.hours) {
      topStaff = {
        staffId: "",
        name: "",
        hours,
      };
    }
  });
  byStaff.forEach((hours, staffId) => {
    if (topStaff && hours === topStaff.hours && !topStaff.staffId) {
      topStaff.staffId = staffId;
      topStaff.name = staffNames.get(staffId) || "Unknown staff";
    }
  });
  const regularHours = Math.max(0, totalHours - overtimeHours);
  const totalScheduledHours = scheduledShifts.reduce((sum, shift) => sum + shift.scheduledHours, 0);
  const differenceHours = totalHours - totalScheduledHours;

  const matchMetrics = computeScheduleMatchMetrics(entries, scheduledShifts);
  const shiftAccuracy = matchMetrics.totalShifts ? (matchMetrics.accurateShifts / matchMetrics.totalShifts) * 100 : null;
  const deviations = matchMetrics.deviations.map((item) => ({
    ...item,
    employeeName: staffNames.get(item.staffId) || "Unknown staff",
  }));

  const metrics = {
    hasData: entries.length > 0 || scheduledShifts.length > 0,
    hasSchedule,
    totalHours,
    regularHours,
    overtimeHours,
    totalScheduledHours,
    totalActualHours: totalHours,
    differenceHours,
    totalShifts: matchMetrics.totalShifts,
    accurateShifts: matchMetrics.accurateShifts,
    lateStarts: matchMetrics.lateStarts,
    earlyLeaves: matchMetrics.earlyLeaves,
    overtimeShifts: matchMetrics.overtimeShifts,
    matchedEntries: matchMetrics.matchedEntries,
    rejectedEntries: matchMetrics.rejectedEntries,
    scheduleTrackingEnabled: matchMetrics.scheduleTrackingEnabled,
    deviations,
    shiftAccuracy,
    topStaff,
    overtimeThreshold: threshold,
    rangeLabel: range.label,
    weekLabel: range.label,
    activeLocationId: scope.id,
    locationLabel: scope.label,
  };

  console.log(LOG, "metrics calculated", metrics);
  return metrics;
}

// ---------- Render ----------

function card(label, value, foot = "") {
  return `
    <div class="ta-card">
      <div class="ta-label">${escapeHtml(label)}</div>
      <div class="ta-value">${escapeHtml(value)}</div>
      <div class="ta-foot">${escapeHtml(foot || "")}</div>
    </div>
  `;
}

function renderEmpty(message = "Not enough data yet") {
  const summary = document.getElementById("ffTimeAnalyticsSummary");
  const compare = document.getElementById("ffTimeAnalyticsCompare");
  const insights = document.getElementById("ffTimeAnalyticsInsights");
  if (summary) {
    summary.innerHTML = [
      "Total Hours",
      "Regular Hours",
      "Overtime Hours",
      "Shift Accuracy",
      "Late Starts",
      "Early Leaves",
    ].map((label) => card(label, "--", message)).join("");
  }
  if (compare) compare.innerHTML = `<div class="ta-empty">${escapeHtml(message)}</div>`;
  if (insights) insights.innerHTML = `<div class="ta-empty">${escapeHtml(message)}</div>`;
}

function renderSummary(metrics) {
  const root = document.getElementById("ffTimeAnalyticsSummary");
  if (!root) return;
  const hasMatchedSchedule = metrics.hasSchedule && metrics.totalShifts > 0;
  root.innerHTML = [
    card("Total Hours", fmtHours(metrics.totalHours), metrics.weekLabel),
    card("Regular Hours", fmtHours(metrics.regularHours), "Before overtime"),
    card("Overtime Hours", fmtHours(metrics.overtimeHours), `Over ${metrics.overtimeThreshold || DEFAULT_WEEKLY_THRESHOLD}h per staff`),
    card("Shift Accuracy", hasMatchedSchedule ? fmtPercent(metrics.shiftAccuracy) : "--", hasMatchedSchedule ? `${metrics.accurateShifts}/${metrics.totalShifts} accurate` : "Schedule tracking not enabled"),
    card("Late Starts", hasMatchedSchedule ? fmtNumber(metrics.lateStarts) : "--", hasMatchedSchedule ? `${DEFAULT_TOLERANCE_MINUTES}m tolerance` : "Schedule tracking not enabled"),
    card("Early Leaves", hasMatchedSchedule ? fmtNumber(metrics.earlyLeaves) : "--", hasMatchedSchedule ? `${DEFAULT_TOLERANCE_MINUTES}m tolerance` : "Schedule tracking not enabled"),
  ].join("");
}

function renderCompare(metrics) {
  const root = document.getElementById("ffTimeAnalyticsCompare");
  if (!root) return;
  if (!metrics.hasSchedule) {
    root.innerHTML = '<div class="ta-empty">Schedule tracking not enabled</div>';
    return;
  }
  const diff = metrics.differenceHours;
  const diffLabel = Number.isFinite(diff) ? `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}h` : "--";
  root.innerHTML = `
    <div class="ta-compare-row">
      ${card("Total Scheduled Hours", fmtHours(metrics.totalScheduledHours), "Planned shifts")}
      ${card("Total Actual Hours", fmtHours(metrics.totalActualHours), "Clocked time")}
      ${card("Difference", diffLabel, diff > 0 ? "More than scheduled" : diff < 0 ? "Less than scheduled" : "Matches schedule")}
    </div>
    <div class="ta-deviation-title">Schedule Deviations</div>
    ${renderDeviationList(metrics.deviations)}
  `;
}

function renderDeviationList(deviations) {
  const rows = Array.isArray(deviations) ? deviations : [];
  if (!rows.length) {
    return '<div class="ta-empty">No schedule deviations detected</div>';
  }
  return `
    <div class="ta-deviation-list">
      ${rows.map((row) => {
        const tags = [];
        if (row.lateMinutes > 0) tags.push(`Late start: ${fmtMinutes(row.lateMinutes)}`);
        if (row.earlyMinutes > 0) tags.push(`Early leave: ${fmtMinutes(row.earlyMinutes)}`);
        if (row.stayedLongerMinutes > 0) tags.push(`Stayed longer: ${fmtMinutes(row.stayedLongerMinutes)}`);
        return `
          <div class="ta-deviation">
            <div class="ta-deviation-head">${escapeHtml(row.employeeName)} - ${escapeHtml(row.dayName || row.dateKey)}</div>
            <div class="ta-deviation-line">Scheduled: ${escapeHtml(fmtTime(row.scheduledStartMs))} - ${escapeHtml(fmtTime(row.scheduledEndMs))}</div>
            <div class="ta-deviation-line">Actual: ${escapeHtml(fmtTime(row.actualStartMs))} - ${escapeHtml(fmtTime(row.actualEndMs))}</div>
            <div class="ta-deviation-tags">
              ${tags.map((tag) => `<span class="ta-deviation-tag">${escapeHtml(tag)}</span>`).join("")}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function buildInsights(metrics) {
  if (!metrics.hasData) return [];
  const out = [];
  if (metrics.overtimeHours >= 5) {
    out.push({ kind: "warn", text: `Overtime is high in this range (${fmtHours(metrics.overtimeHours)}).` });
  }
  if (metrics.topStaff?.hours > 0) {
    out.push({ kind: "info", text: `Most hours in this range: ${metrics.topStaff.name} (${fmtHours(metrics.topStaff.hours)}).` });
  }
  if (metrics.hasSchedule && metrics.lateStarts >= 3) {
    out.push({ kind: "warn", text: `There are several late starts this week (${metrics.lateStarts}).` });
  }
  if (metrics.hasSchedule && metrics.earlyLeaves >= 3) {
    out.push({ kind: "warn", text: `There are several early leaves this week (${metrics.earlyLeaves}).` });
  }
  if (metrics.hasSchedule && Number.isFinite(metrics.shiftAccuracy) && metrics.shiftAccuracy >= 85) {
    out.push({ kind: "good", text: "Staff are following the schedule well this week." });
  }
  if (!out.length && metrics.hasSchedule) {
    out.push({ kind: "good", text: "Time clock activity looks stable this week." });
  }
  if (!out.length && !metrics.hasSchedule) {
    out.push({ kind: "info", text: "Actual hours are available. Schedule insights will appear once shifts are published." });
  }
  return out.slice(0, 4);
}

function renderInsights(metrics) {
  const root = document.getElementById("ffTimeAnalyticsInsights");
  if (!root) return;
  const insights = buildInsights(metrics);
  if (!insights.length) {
    root.innerHTML = '<div class="ta-empty">Not enough data yet</div>';
    return;
  }
  root.innerHTML = `
    <ul class="ta-insights">
      ${insights.map((item) => `<li class="ta-insight ${escapeHtml(item.kind)}">${escapeHtml(item.text)}</li>`).join("")}
    </ul>
  `;
}

function csvCell(value) {
  const s = String(value == null ? "" : value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(values) {
  return values.map(csvCell).join(",");
}

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

  const headerEl = document.querySelector(".header");
  if (headerEl) {
    document.documentElement.style.setProperty("--header-h", `${headerEl.offsetHeight}px`);
  }

  const screen = document.getElementById(SCREEN_ID);
  if (screen) {
    screen.style.display = "flex";
    screen.style.setProperty("pointer-events", "auto", "important");
  }
  document.querySelectorAll(".btn-pill").forEach((b) => b.classList.remove("active"));
  refresh();
}

function ensureInjected() {
  if (_injected) return;
  injectStyles();
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
