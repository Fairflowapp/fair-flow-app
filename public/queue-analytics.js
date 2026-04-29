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

const LOG = "[QueueAnalytics]";
const BH_LOG = "[QueueAnalytics BusinessHours]";
const V2_LOG = "[QueueAnalytics V2]";
const TYPES_LOG = "[QueueAnalytics Types]";
const SCREEN_ID = "queueAnalyticsScreen";
const RANGE_STORAGE_KEY = "ff_queue_analytics_range_v1";

let _injected = false;
let _qaRangeState = { mode: "thisWeek", customStart: "", customEnd: "" };
let _lastMetrics = null;
let _lastRange = null;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

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

function injectStyles() {
  if (document.getElementById("ffQueueAnalyticsStyles")) return;
  const style = document.createElement("style");
  style.id = "ffQueueAnalyticsStyles";
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
    #${SCREEN_ID} .qa-wrap {
      max-width: 1280px;
      margin: 0 auto;
      padding: 24px 28px 48px 28px;
      width: 100%;
    }
    #${SCREEN_ID} .qa-back {
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
      margin-bottom: 14px;
    }
    #${SCREEN_ID} .qa-back:hover { color: #9d68b9; }
    #${SCREEN_ID} .qa-h1 {
      margin: 0 0 4px 0;
      font-size: 22px;
      font-weight: 700;
      color: #111827;
      letter-spacing: -0.01em;
    }
    #${SCREEN_ID} .qa-sub {
      margin: 0 0 22px 0;
      font-size: 13px;
      color: #6b7280;
    }
    #${SCREEN_ID} .qa-section-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6b7280;
      margin: 22px 2px 10px 2px;
    }
    #${SCREEN_ID} .qa-toolbar {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      padding: 14px 16px;
      margin: 18px 0 20px 0;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 14px;
      flex-wrap: wrap;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    #${SCREEN_ID} .qa-filter-row {
      display: flex;
      align-items: flex-end;
      gap: 10px;
      flex-wrap: wrap;
    }
    #${SCREEN_ID} .qa-field {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    #${SCREEN_ID} .qa-field label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
    }
    #${SCREEN_ID} .qa-field select,
    #${SCREEN_ID} .qa-field input {
      height: 36px;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      background: #fff;
      color: #111827;
      padding: 0 10px;
      font-size: 13px;
      min-width: 150px;
    }
    #${SCREEN_ID} .qa-field.is-custom { display: none; }
    #${SCREEN_ID}.qa-custom-range .qa-field.is-custom { display: flex; }
    #${SCREEN_ID} .qa-toolbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    #${SCREEN_ID} .qa-range-label {
      font-size: 12px;
      color: #6b7280;
      margin-right: 4px;
    }
    #${SCREEN_ID} .qa-action-btn {
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
    #${SCREEN_ID} .qa-action-btn.secondary {
      background: #f3f4f6;
      color: #374151;
      box-shadow: none;
      border: 1px solid #e5e7eb;
    }
    #${SCREEN_ID} .qa-empty {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 24px;
      text-align: center;
      color: #6b7280;
      font-size: 14px;
    }
    #${SCREEN_ID} .qa-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 12px;
    }
    #${SCREEN_ID} .qa-card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 14px;
      padding: 14px 16px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    #${SCREEN_ID} .qa-card-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
    }
    #${SCREEN_ID} .qa-card-value {
      font-size: 24px;
      font-weight: 700;
      color: #111827;
      line-height: 1.1;
    }
    #${SCREEN_ID} .qa-card-foot {
      font-size: 12px;
      color: #6b7280;
    }
    #${SCREEN_ID} .qa-panel {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      padding: 18px 20px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    #${SCREEN_ID} .qa-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    #${SCREEN_ID} .qa-table th,
    #${SCREEN_ID} .qa-table td {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid #f3f4f6;
    }
    #${SCREEN_ID} .qa-table th {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
    }
    #${SCREEN_ID} .qa-table tr:last-child td { border-bottom: 0; }
    #${SCREEN_ID} .qa-table td.num,
    #${SCREEN_ID} .qa-table th.num { text-align: right; font-variant-numeric: tabular-nums; }
    #${SCREEN_ID} .qa-bar {
      position: relative;
      height: 6px;
      background: #f3f4f6;
      border-radius: 3px;
      overflow: hidden;
      margin-top: 2px;
    }
    #${SCREEN_ID} .qa-bar > span {
      position: absolute;
      top: 0; bottom: 0; left: 0;
      background: linear-gradient(90deg, #9d68b9, #ff9580);
      border-radius: 3px;
    }
    #${SCREEN_ID} .qa-hour-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 8px;
      margin-top: 4px;
    }
    #${SCREEN_ID} .qa-hour-day {
      border: 1px solid #eef0f3;
      border-radius: 12px;
      background: #fff;
      margin-bottom: 10px;
      overflow: hidden;
    }
    #${SCREEN_ID} .qa-hour-day:last-child { margin-bottom: 0; }
    #${SCREEN_ID} .qa-hour-day-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      width: 100%;
      padding: 12px 14px;
      border: 0;
      background: #f9fafb;
      font-size: 12px;
      font-weight: 700;
      color: #111827;
      cursor: pointer;
      text-align: left;
    }
    #${SCREEN_ID} .qa-hour-day-title::-webkit-details-marker { display: none; }
    #${SCREEN_ID} .qa-hour-day-hours {
      font-weight: 500;
      color: #6b7280;
    }
    #${SCREEN_ID} .qa-hour-day-body {
      padding: 12px 14px 14px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    #${SCREEN_ID} .qa-metric-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
      margin-bottom: 8px;
    }
    #${SCREEN_ID} .qa-day-stats {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    #${SCREEN_ID} .qa-day-stat {
      border: 1px solid #eef0f3;
      background: #f9fafb;
      border-radius: 999px;
      padding: 7px 10px;
      font-size: 12px;
      color: #374151;
      font-weight: 700;
    }
    #${SCREEN_ID} .qa-hour-card-title {
      font-size: 13px;
      font-weight: 800;
      color: #111827;
      margin-bottom: 8px;
    }
    #${SCREEN_ID} .qa-hour-card-row {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      font-size: 12px;
      line-height: 1.6;
      color: #4b5563;
    }
    #${SCREEN_ID} .qa-hour-card-row strong {
      color: #111827;
      font-variant-numeric: tabular-nums;
    }
    #${SCREEN_ID} .qa-type-title {
      font-size: 10px;
      font-weight: 800;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 2px;
    }
    #${SCREEN_ID} .qa-type-row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      color: #4b5563;
      font-size: 11px;
      line-height: 1.4;
    }
    #${SCREEN_ID} .qa-type-row strong {
      color: #111827;
      font-variant-numeric: tabular-nums;
    }
    #${SCREEN_ID} .qa-hour-modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 9995;
      background: rgba(17, 24, 39, 0.42);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
    }
    #${SCREEN_ID} .qa-hour-modal {
      width: min(520px, 100%);
      max-height: min(720px, calc(100vh - 36px));
      overflow: auto;
      background: #fff;
      border-radius: 18px;
      border: 1px solid #e5e7eb;
      box-shadow: 0 24px 70px rgba(15, 23, 42, 0.24);
    }
    #${SCREEN_ID} .qa-hour-modal-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
      padding: 18px 20px 12px;
      border-bottom: 1px solid #f3f4f6;
    }
    #${SCREEN_ID} .qa-hour-modal-title {
      margin: 0;
      font-size: 18px;
      font-weight: 800;
      color: #111827;
    }
    #${SCREEN_ID} .qa-hour-modal-sub {
      margin: 4px 0 0;
      font-size: 12px;
      color: #6b7280;
    }
    #${SCREEN_ID} .qa-hour-modal-close {
      border: 0;
      background: #f3f4f6;
      color: #374151;
      border-radius: 999px;
      width: 32px;
      height: 32px;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
    }
    #${SCREEN_ID} .qa-hour-modal-body {
      padding: 16px 20px 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    #${SCREEN_ID} .qa-hour-modal-summary {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }
    #${SCREEN_ID} .qa-hour-modal-stat {
      border: 1px solid #eef0f3;
      background: #f9fafb;
      border-radius: 12px;
      padding: 10px 12px;
    }
    #${SCREEN_ID} .qa-hour-modal-stat span {
      display: block;
      font-size: 10px;
      font-weight: 800;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
    }
    #${SCREEN_ID} .qa-hour-modal-stat strong {
      font-size: 18px;
      color: #111827;
      font-variant-numeric: tabular-nums;
    }
    #${SCREEN_ID} .qa-hour-modal-section {
      border: 1px solid #eef0f3;
      border-radius: 14px;
      padding: 12px 14px;
      background: #fff;
    }
    #${SCREEN_ID} .qa-closed {
      padding: 10px 12px;
      border: 1px dashed #e5e7eb;
      border-radius: 10px;
      background: #f9fafb;
      color: #6b7280;
      font-size: 13px;
    }
    #${SCREEN_ID} .qa-hour-tile {
      background: #f9fafb;
      border: 1px solid #eef0f3;
      border-radius: 10px;
      padding: 10px 12px;
      appearance: none;
      cursor: pointer;
      text-align: left;
      width: 100%;
    }
    #${SCREEN_ID} .qa-hour-tile:hover {
      border-color: #d8b6e8;
      box-shadow: 0 2px 8px rgba(157, 104, 185, 0.10);
    }
    #${SCREEN_ID} .qa-hour-tile:focus-visible {
      outline: 2px solid #9d68b9;
      outline-offset: 2px;
    }
    #${SCREEN_ID} .qa-hour-tile.is-peak {
      background: linear-gradient(135deg, rgba(157, 104, 185, 0.10), rgba(255, 149, 128, 0.10));
      border-color: #d8b6e8;
    }
    #${SCREEN_ID} .qa-hour-tile-label {
      font-size: 11px;
      color: #6b7280;
      font-weight: 500;
    }
    #${SCREEN_ID} .qa-hour-tile-value {
      font-size: 16px;
      font-weight: 700;
      color: #111827;
      margin-top: 2px;
    }
    #${SCREEN_ID} .qa-insights-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    #${SCREEN_ID} .qa-insight {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 12px;
      background: #fff7ed;
      border: 1px solid #fed7aa;
      border-radius: 10px;
      color: #9a3412;
      font-size: 13px;
      line-height: 1.4;
    }
    #${SCREEN_ID} .qa-insight.is-info {
      background: #eff6ff;
      border-color: #bfdbfe;
      color: #1e40af;
    }
    #${SCREEN_ID} .qa-insight.is-good {
      background: #ecfdf5;
      border-color: #a7f3d0;
      color: #065f46;
    }
    @media (max-width: 900px) {
      #${SCREEN_ID} .qa-wrap { padding: 16px 14px 32px 14px; }
      #${SCREEN_ID} .qa-toolbar { align-items: stretch; }
      #${SCREEN_ID} .qa-toolbar-actions { width: 100%; }
      #${SCREEN_ID} .qa-action-btn { flex: 1; }
      #${SCREEN_ID} .qa-hour-modal-summary { grid-template-columns: 1fr; }
    }
  `;
  document.head.appendChild(style);
}

function buildScreen() {
  if (document.getElementById(SCREEN_ID)) return document.getElementById(SCREEN_ID);
  const root = document.createElement("div");
  root.id = SCREEN_ID;
  root.innerHTML = `
    <div class="qa-wrap">
      <button type="button" class="qa-back" id="ffQaBack" aria-label="Back to dashboard">← Back to dashboard</button>
      <h1 class="qa-h1">Queue Analytics</h1>
      <p class="qa-sub">Understand average wait time, staff flow, and hourly capacity</p>

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

function _qaActiveLocationId() {
  try {
    if (typeof window.ffGetActiveLocationId === "function") {
      const v = window.ffGetActiveLocationId();
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  } catch (_) {}
  try {
    const raw = typeof window.__ff_active_location_id === "string" ? window.__ff_active_location_id.trim() : "";
    return raw || "";
  } catch (_) {
    return "";
  }
}

function _qaTimeToMinutes(value) {
  const s = String(value || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function _qaMinutesToHourFloor(minutes) {
  if (!Number.isFinite(minutes)) return null;
  return Math.max(0, Math.min(23, Math.floor(minutes / 60)));
}

function _qaReadSettingsBusinessHours() {
  try {
    const fromWindow = window.settings && typeof window.settings.businessHours === "object"
      ? window.settings.businessHours
      : null;
    if (fromWindow) return { source: "window.settings.businessHours", value: fromWindow };
  } catch (_) {}
  try {
    const stored = JSON.parse(localStorage.getItem("ffv24_settings") || "{}");
    if (stored && typeof stored.businessHours === "object") {
      return { source: "localStorage.ffv24_settings.businessHours", value: stored.businessHours };
    }
  } catch (_) {}
  return null;
}

function resolveBusinessHoursForWeek() {
  const activeLocationId = _qaActiveLocationId();
  console.log(BH_LOG, "active location used", activeLocationId || "(default/current settings)");

  let source = null;
  let rawHours = null;
  const found = _qaReadSettingsBusinessHours();
  if (found && found.value) {
    source = found.source;
    rawHours = found.value;
    console.log(BH_LOG, "source found", source);
  }

  if (rawHours && typeof window.ffScheduleHelpers?.normalizeBusinessHours === "function") {
    try {
      rawHours = window.ffScheduleHelpers.normalizeBusinessHours(rawHours);
    } catch (e) {
      console.warn(BH_LOG, "normalizeBusinessHours failed", e);
    }
  }

  if (!rawHours || typeof rawHours !== "object") {
    console.log(BH_LOG, "fallback used", "9 AM–9 PM (no business hours source found)");
    source = "fallback";
    rawHours = {};
    DAY_KEYS.forEach((day) => {
      rawHours[day] = { isOpen: true, openTime: "09:00", closeTime: "21:00" };
    });
  }

  const byDay = DAY_KEYS.map((dayKey, dayIdx) => {
    const entry = rawHours[dayKey] && typeof rawHours[dayKey] === "object" ? rawHours[dayKey] : null;
    const isOpen = !!(entry && entry.isOpen === true);
    const openMin = isOpen ? _qaTimeToMinutes(entry.openTime) : null;
    const closeMin = isOpen ? _qaTimeToMinutes(entry.closeTime) : null;
    const usable = isOpen && Number.isFinite(openMin) && Number.isFinite(closeMin) && closeMin > openMin;
    const row = {
      dayIdx,
      dayKey,
      dayName: DAY_NAMES[dayIdx],
      isOpen: usable,
      openTime: usable ? entry.openTime : null,
      closeTime: usable ? entry.closeTime : null,
      openMin: usable ? openMin : null,
      closeMin: usable ? closeMin : null,
      hours: [],
    };
    if (usable) {
      const startHour = _qaMinutesToHourFloor(openMin);
      const endHourExclusive = Math.ceil(closeMin / 60);
      for (let h = startHour; h < endHourExclusive && h <= 23; h += 1) {
        row.hours.push(h);
      }
    }
    return row;
  });

  console.log(BH_LOG, "hours per day", byDay.map((d) => ({
    day: d.dayName,
    status: d.isOpen ? `${d.openTime}-${d.closeTime}` : "Closed",
  })));

  return { source, activeLocationId, byDay };
}

function _qaReadRawLog() {
  try {
    if (Array.isArray(window.log) && window.log.length) return window.log;
  } catch (_) {}
  try {
    const raw = localStorage.getItem("ffv24_log");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (_) {}
  return null;
}

function _qaReadStaffList() {
  try {
    if (typeof window.ffGetStaffStore === "function") {
      const store = window.ffGetStaffStore();
      if (Array.isArray(store?.staff)) return store.staff.filter(Boolean);
    }
  } catch (_) {}
  try {
    const store = JSON.parse(localStorage.getItem("ff_staff_v1") || "{}");
    if (Array.isArray(store?.staff)) return store.staff.filter(Boolean);
  } catch (_) {}
  return [];
}

function _qaTypeDisplayLabel(typeId) {
  const raw = String(typeId || "").trim();
  if (!raw) return "Other";
  try {
    const cachedTypes = Array.isArray(window.__ff_technician_types_cache) ? window.__ff_technician_types_cache : [];
    const match = cachedTypes.find((t) => t && String(t.id || "").trim() === raw);
    if (match && match.name) return String(match.name).trim();
  } catch (_) {}
  const withoutLocationSuffix = raw.includes("--") ? raw.split("--")[0] : raw;
  return withoutLocationSuffix
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || "Other";
}

function buildStaffTypeResolver() {
  const staffList = _qaReadStaffList();
  const byId = new Map();
  const byName = new Map();
  const mappingLog = [];

  staffList.forEach((staff) => {
    const id = String(staff?.id || staff?.staffId || "").trim();
    const name = String(staff?.name || staff?.staffName || staff?.displayName || "").trim();
    const rawType = String(
      staff?.serviceProviderType ||
      staff?.technicianType ||
      staff?.providerType ||
      (Array.isArray(staff?.technicianTypes) ? staff.technicianTypes[0] : "") ||
      "",
    ).trim();
    const type = rawType ? _qaTypeDisplayLabel(rawType) : "Other";
    const record = { id, name, type };
    if (id) byId.set(id, record);
    if (name) byName.set(name.toLowerCase(), record);
    if (id || name) mappingLog.push({ staffId: id || "(missing)", name: name || "(missing)", type });
  });

  console.log(TYPES_LOG, "staffId → type mapping", mappingLog);

  return function resolveType({ staffId, worker }) {
    const id = String(staffId || "").trim();
    const name = String(worker || "").trim();
    const match = (id && byId.get(id)) || (name && byName.get(name.toLowerCase())) || null;
    return match?.type || "Other";
  };
}

function _qaExtractWorker(action) {
  if (!action) return "";
  let mm = action.match(/IN SERVICE:\s*(.+)$/i); if (mm) return mm[1].trim();
  mm = action.match(/Back to end:\s*(.+)$/i);    if (mm) return mm[1].trim();
  mm = action.match(/^join:\s*(.+)$/i);          if (mm) return mm[1].trim();
  mm = action.match(/^(JOIN|START|FINISH)\s+(?![•·>-])(.+)$/i); if (mm) return mm[2].trim();
  mm = action.match(/^HOLD:\s*(.+)$/i);          if (mm) return mm[1].trim();
  mm = action.match(/^RELEASE:\s*(.+)$/i);       if (mm) return mm[1].trim();
  mm = action.match(/^MOVE (?:UP|DOWN):\s*(.+)$/i); if (mm) return mm[1].trim();
  const idx = action.lastIndexOf(":");
  return idx > -1 ? action.slice(idx + 1).trim() : "";
}

function _qaActionKind(action) {
  if (!action) return null;
  if (/^JOIN\b|^join:/i.test(action)) return "join";
  if (/^START\b|IN SERVICE:/i.test(action)) return "start";
  if (/^FINISH\b|Back to end:/i.test(action)) return "finish";
  if (/Remove from queue|Leave queue|queue_check_out/i.test(action)) return "checkout";
  if (/^HOLD:/i.test(action)) return "hold";
  if (/^RELEASE:/i.test(action)) return "release";
  if (/^MOVE (?:UP|DOWN):/i.test(action)) return "move";
  return null;
}

function _qaParseEntry(entry) {
  if (entry == null) return null;
  if (typeof entry === "object") {
    const source = String(entry.source || "queue").toLowerCase();
    if (source !== "queue") return null;
    const ts = Number(entry.ts || entry.timestamp);
    if (!Number.isFinite(ts)) return null;
    const action = String(entry.action || entry.actionText || "").trim();
    const worker = String(entry.worker || entry.assignedTo || "").trim() || _qaExtractWorker(action);
    const staffId = String(entry.staffId || entry.staffMemberId || entry.employeeId || "").trim();
    const typedAction = entry.type === "queue_check_out" ? `${action} queue_check_out` : action;
    return { ts, action: typedAction, worker, staffId };
  }
  if (typeof entry !== "string") return null;
  const m = entry.match(/^(\d{1,2}\/\d{1,2}\/\d{4}),\s*([\d:]+\s*[AP]M)\s*(.*)$/);
  if (!m) return null;
  const [, dateStr, timeStr, rest] = m;
  const ts = Date.parse(`${dateStr} ${timeStr}`);
  if (!Number.isFinite(ts)) return null;
  const action = (rest || "").trim();
  return { ts, action, worker: _qaExtractWorker(action), staffId: "" };
}

// Compute the full breakdown needed for sections A-D.
function computeQueueAnalytics(fromMs, toMs = Date.now()) {
  const result = {
    sourceFound: false,
    activityCount: 0,
    waitCount: 0,
    avgWaitMin: null,
    longestWaitMin: null,
    busiestDay: null,
    peakHour: null,
    byDay: [],   // { dayIdx, dayName, count, avgWaitMin, longestWaitMin, totalStaff, peakHour }
    byHour: [],  // { hour, count } from service starts inside business hours
    byDayHour: [], // { dayIdx, dayName, isOpen, totalStaff, peakHour, hours:[{hour,starts,activeStaff,idleMinutes,startsByType,staffByType,idleByType}] }
    businessHours: null,
    totalStarts: 0,
    totalActiveStaff: 0,
    totalIdleMinutes: 0,
    avgStaffPerDay: null,
    staffActivityDays: 0,
  };

  let raw;
  try {
    raw = _qaReadRawLog();
  } catch (e) {
    console.warn(LOG, "error reading log", e);
    return result;
  }
  if (!Array.isArray(raw) || !raw.length) {
    console.log(LOG, "no historical queue data source found");
    return result;
  }
  result.sourceFound = true;
  console.log(LOG, "data source detected", { entries: raw.length });

  // Parse + chronological order. Legacy forced-log entries used unshift()
  // (newest-first), while newer queue/history entries use push()
  // (oldest-first). Sort by timestamp so JOIN → START pairs resolve
  // correctly regardless of write path.
  const parsed = [];
  for (let i = 0; i < raw.length; i += 1) {
    const p = _qaParseEntry(raw[i]);
    if (p && p.ts <= toMs) parsed.push(p);
  }
  parsed.sort((a, b) => a.ts - b.ts);
  if (!parsed.length) {
    console.log(LOG, "no events in range");
    return result;
  }

  const businessHours = resolveBusinessHoursForWeek();
  result.businessHours = businessHours;
  const businessByDay = new Map((businessHours.byDay || []).map((d) => [d.dayIdx, d]));
  const resolveStaffType = buildStaffTypeResolver();

  const dayBuckets = new Map(); // day → { count, waits: [], staff: Set }
  const hourBuckets = new Map(); // hour → START count (business-hours only)
  const dayHourStartBuckets = new Map(); // "dayIdx|hour" → START count
  const dayHourStartTypeBuckets = new Map(); // "dayIdx|hour" → Map(type → START count)
  const dayHourIdleBuckets = new Map(); // "dayIdx|hour" → Available time before START, HOLD excluded
  const dayHourIdleTypeBuckets = new Map(); // "dayIdx|hour" → Map(type → idle minutes)
  const dayHourActiveStaff = new Map(); // "dayIdx|hour" → Set(worker)
  const dayHourActiveStaffTypes = new Map(); // "dayIdx|hour" → Map(type → Set(worker))
  const dailyActiveStaff = new Map(); // "YYYY-MM-DD" → Set(worker)
  const staffStates = new Map();
  const seenEvents = new Set();
  const allWaits = [];

  function dateKeyFromMs(ms) {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function addMinutesIntervalToBusinessHours(startedAt, endedAt, onOverlap) {
    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) return;
    const clippedStart = Math.max(startedAt, fromMs);
    const clippedEnd = Math.min(endedAt, toMs);
    if (clippedEnd <= clippedStart) return;
    const cursor = new Date(clippedStart);
    cursor.setMinutes(0, 0, 0);
    while (cursor.getTime() < clippedEnd) {
      const hourStart = cursor.getTime();
      const hourEnd = hourStart + 3600000;
      const segStart = Math.max(clippedStart, hourStart);
      const segEnd = Math.min(clippedEnd, hourEnd);
      if (segEnd > segStart) {
        const d = new Date(hourStart);
        const dayKey = d.getDay();
        const hourKey = d.getHours();
        const businessDay = businessByDay.get(dayKey);
        const minuteOfDay = hourKey * 60;
        const isBusinessHour = !!(
          businessDay &&
          businessDay.isOpen &&
          minuteOfDay < businessDay.closeMin &&
          (minuteOfDay + 60) > businessDay.openMin
        );
        if (isBusinessHour) {
          const businessStart = new Date(hourStart);
          businessStart.setHours(0, 0, 0, 0);
          const openMs = businessStart.getTime() + businessDay.openMin * 60000;
          const closeMs = businessStart.getTime() + businessDay.closeMin * 60000;
          const overlapStart = Math.max(segStart, openMs);
          const overlapEnd = Math.min(segEnd, closeMs);
          if (overlapEnd > overlapStart) {
            const minutes = (overlapEnd - overlapStart) / 60000;
            const key = `${dayKey}|${hourKey}`;
            onOverlap({ key, dayKey, hourKey, dateKey: dateKeyFromMs(hourStart), minutes });
          }
        }
      }
      cursor.setHours(cursor.getHours() + 1);
    }
  }

  function ensureDayBucket(dayIdx) {
    if (!dayBuckets.has(dayIdx)) dayBuckets.set(dayIdx, { count: 0, waits: [], staff: new Set() });
    return dayBuckets.get(dayIdx);
  }

  function addIdleInterval(state, startedAt, endedAt) {
    addMinutesIntervalToBusinessHours(startedAt, endedAt, ({ key, minutes }) => {
      dayHourIdleBuckets.set(key, (dayHourIdleBuckets.get(key) || 0) + minutes);
      addTypeCount(dayHourIdleTypeBuckets, key, state?.type || "Other", minutes);
      result.totalIdleMinutes += minutes;
    });
  }

  function addTypeCount(bucket, key, type, amount = 1) {
    const cleanType = String(type || "").trim() || "Other";
    if (!bucket.has(key)) bucket.set(key, new Map());
    const typeMap = bucket.get(key);
    typeMap.set(cleanType, (typeMap.get(cleanType) || 0) + amount);
  }

  function addTypeStaff(bucket, key, type, staffKey) {
    const cleanType = String(type || "").trim() || "Other";
    const cleanStaff = String(staffKey || "").trim();
    if (!cleanStaff) return;
    if (!bucket.has(key)) bucket.set(key, new Map());
    const typeMap = bucket.get(key);
    if (!typeMap.has(cleanType)) typeMap.set(cleanType, new Set());
    typeMap.get(cleanType).add(cleanStaff);
  }

  function typeCountRows(typeMap) {
    if (!(typeMap instanceof Map)) return [];
    return Array.from(typeMap.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  }

  function typeStaffRows(typeMap) {
    if (!(typeMap instanceof Map)) return [];
    return Array.from(typeMap.entries())
      .map(([type, set]) => ({ type, count: set instanceof Set ? set.size : 0 }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  }

  function addActiveInterval(state, startedAt, endedAt) {
    if (!state) return;
    const worker = String(state.worker || "").trim();
    const staff = String(worker || "").trim();
    if (!staff) return;
    addMinutesIntervalToBusinessHours(startedAt, endedAt, ({ key, dayKey, dateKey }) => {
      if (!dayHourActiveStaff.has(key)) dayHourActiveStaff.set(key, new Set());
      dayHourActiveStaff.get(key).add(staff);
      addTypeStaff(dayHourActiveStaffTypes, key, state.type || "Other", state.staffId || state.worker);
      ensureDayBucket(dayKey).staff.add(staff);
      if (!dailyActiveStaff.has(dateKey)) dailyActiveStaff.set(dateKey, new Set());
      dailyActiveStaff.get(dateKey).add(staff);
    });
  }

  function closeIdle(state, ts) {
    if (!state || !Number.isFinite(state.idleStart) || ts <= state.idleStart) {
      if (state) state.idleStart = null;
      return;
    }
    const minutes = (ts - state.idleStart) / 60000;
    state.waitMinutes += minutes;
    addIdleInterval(state, state.idleStart, ts);
    state.idleStart = null;
  }

  function closeActive(state, ts) {
    if (!state || !Number.isFinite(state.activeStart) || ts <= state.activeStart) {
      if (state) state.activeStart = null;
      return;
    }
    addActiveInterval(state, state.activeStart, ts);
    state.activeStart = null;
  }

  function createAvailableState({ worker, staffId, type, ts }) {
    return {
      worker,
      staffId,
      type,
      joinedAt: ts,
      activeStart: ts,
      idleStart: ts,
      waitMinutes: 0,
      inService: false,
      onHold: false,
    };
  }

  function recordCompletedWait(state, ts) {
    if (!state || !Number.isFinite(state.waitMinutes) || state.waitMinutes <= 0) return;
    const minutes = state.waitMinutes;
    allWaits.push(minutes);
    const startDay = new Date(Number.isFinite(state.joinedAt) ? state.joinedAt : ts).getDay();
    ensureDayBucket(startDay).waits.push(minutes);
    state.waitMinutes = 0;
    state.joinedAt = null;
  }

  parsed.forEach((ev) => {
    const kind = _qaActionKind(ev.action);
    if (!kind) return;
    const workerName = String(ev.worker || "").trim();
    const staffId = String(ev.staffId || "").trim();
    const staffType = resolveStaffType({ staffId, worker: workerName });
    const staffKey = workerName || staffId;
    const w = staffKey.toLowerCase();
    const dedupeKey = `${kind}|${w || ev.action.toLowerCase()}|${Math.round(ev.ts / 5000)}`;
    if (seenEvents.has(dedupeKey)) return;
    seenEvents.add(dedupeKey);
    const d = new Date(ev.ts);
    const dayKey = d.getDay();
    const hourKey = d.getHours();
    const eventInRange = ev.ts >= fromMs && ev.ts <= toMs;

    if (eventInRange) {
      result.activityCount += 1;
      const dayBucket = ensureDayBucket(dayKey);
      dayBucket.count += 1;
      if (staffKey) dayBucket.staff.add(staffKey);
    }
    const businessDay = businessByDay.get(dayKey);
    const minuteOfDay = d.getHours() * 60 + d.getMinutes();
    const isInsideBusinessHours = !!(
      businessDay &&
      businessDay.isOpen &&
      minuteOfDay >= businessDay.openMin &&
      minuteOfDay < businessDay.closeMin
    );
    const dayHourKey = `${dayKey}|${hourKey}`;

    if (kind === "join" && w) {
      const existing = staffStates.get(w);
      if (existing) {
        closeIdle(existing, ev.ts);
        closeActive(existing, ev.ts);
      }
      staffStates.set(w, createAvailableState({ worker: staffKey, staffId, type: staffType, ts: ev.ts }));
    } else if (kind === "start" && w) {
      let state = staffStates.get(w);
      if (!state) {
        state = {
          worker: staffKey,
          staffId,
          type: staffType,
          joinedAt: null,
          activeStart: ev.ts,
          idleStart: null,
          waitMinutes: 0,
          inService: false,
          onHold: false,
        };
        staffStates.set(w, state);
      }
      if (!state.staffId && staffId) state.staffId = staffId;
      if (!state.type || state.type === "Other") state.type = staffType;
      if (eventInRange && isInsideBusinessHours) {
        hourBuckets.set(hourKey, (hourBuckets.get(hourKey) || 0) + 1);
        dayHourStartBuckets.set(dayHourKey, (dayHourStartBuckets.get(dayHourKey) || 0) + 1);
        addTypeCount(dayHourStartTypeBuckets, dayHourKey, state.type || staffType || "Other");
        result.totalStarts += 1;
      }
      closeIdle(state, ev.ts);
      if (eventInRange) recordCompletedWait(state, ev.ts);
      state.inService = true;
      state.onHold = false;
      if (!Number.isFinite(state.activeStart)) state.activeStart = ev.ts;
    } else if (kind === "hold" && w) {
      const state = staffStates.get(w);
      if (state && !state.onHold) {
        closeIdle(state, ev.ts);
        closeActive(state, ev.ts);
        state.onHold = true;
      }
    } else if (kind === "release" && w) {
      const state = staffStates.get(w);
      if (state) {
        state.onHold = false;
        state.activeStart = ev.ts;
        if (!state.inService) state.idleStart = ev.ts;
      }
    } else if (kind === "finish" && w) {
      let state = staffStates.get(w);
      if (state) {
        state.inService = false;
        state.onHold = false;
        state.joinedAt = ev.ts;
        state.idleStart = ev.ts;
        if (!Number.isFinite(state.activeStart)) state.activeStart = ev.ts;
      } else {
        state = createAvailableState({ worker: staffKey, staffId, type: staffType, ts: ev.ts });
        staffStates.set(w, state);
      }
    } else if (kind === "checkout" && w) {
      const state = staffStates.get(w);
      if (state) {
        closeIdle(state, ev.ts);
        if (eventInRange) recordCompletedWait(state, ev.ts);
        closeActive(state, ev.ts);
        staffStates.delete(w);
      }
    }
  });

  staffStates.forEach((state) => {
    // Open staff records still count for Active Staff through the selected
    // range, but incomplete Available waits are not counted as Idle Time
    // until a START confirms the wait duration.
    closeActive(state, toMs);
  });

  // Aggregate global metrics.
  if (allWaits.length) {
    const total = allWaits.reduce((a, b) => a + b, 0);
    result.avgWaitMin = total / allWaits.length;
    result.longestWaitMin = allWaits.reduce((a, b) => (b > a ? b : a), 0);
    result.waitCount = allWaits.length;
  }

  // Per-day rows.
  const dayRows = [];
  dayBuckets.forEach((bucket, dayIdx) => {
    const waits = bucket.waits;
    const avg = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null;
    const longest = waits.length ? waits.reduce((a, b) => (b > a ? b : a), 0) : null;
    dayRows.push({
      dayIdx,
      dayName: DAY_NAMES[dayIdx],
      count: bucket.count,
      avgWaitMin: avg,
      longestWaitMin: longest,
      waitsInDay: waits.length,
      totalStaff: bucket.staff ? bucket.staff.size : 0,
      peakHour: null,
    });
  });
  dayRows.sort((a, b) => a.dayIdx - b.dayIdx);
  result.byDay = dayRows;

  // Hour rows.
  const hourRows = [];
  hourBuckets.forEach((count, hour) => hourRows.push({ hour, count }));
  hourRows.sort((a, b) => a.hour - b.hour);
  result.byHour = hourRows;

  result.byDayHour = (businessHours.byDay || []).map((day) => {
    let peak = null;
    const hours = day.isOpen
      ? day.hours.map((hour) => {
        const key = `${day.dayIdx}|${hour}`;
        const activeStaffSet = dayHourActiveStaff.get(key);
        const row = {
          hour,
          starts: dayHourStartBuckets.get(key) || 0,
          activeStaff: activeStaffSet ? activeStaffSet.size : 0,
          idleMinutes: dayHourIdleBuckets.get(key) || 0,
          startsByType: typeCountRows(dayHourStartTypeBuckets.get(key)),
          staffByType: typeStaffRows(dayHourActiveStaffTypes.get(key)),
          idleByType: typeCountRows(dayHourIdleTypeBuckets.get(key)),
        };
        if (
          !peak ||
          row.starts > peak.starts ||
          (row.starts === peak.starts && row.activeStaff > peak.activeStaff) ||
          (row.starts === peak.starts && row.activeStaff === peak.activeStaff && row.idleMinutes > peak.idleMinutes)
        ) {
          peak = row;
        }
        return row;
      })
      : [];
    const totalStaff = dayBuckets.get(day.dayIdx)?.staff?.size || 0;
    return {
      dayIdx: day.dayIdx,
      dayName: day.dayName,
      isOpen: day.isOpen,
      openTime: day.openTime,
      closeTime: day.closeTime,
      totalStaff,
      peakHour: peak && (peak.starts > 0 || peak.activeStaff > 0 || peak.idleMinutes > 0) ? peak.hour : null,
      hours,
    };
  });

  result.byDay.forEach((day) => {
    const hourly = result.byDayHour.find((row) => row.dayIdx === day.dayIdx);
    if (hourly) {
      day.totalStaff = hourly.totalStaff;
      day.peakHour = hourly.peakHour;
    }
  });
  const allActiveStaff = new Set();
  dayBuckets.forEach((bucket) => {
    if (bucket.staff) bucket.staff.forEach((staff) => allActiveStaff.add(staff));
  });
  result.totalActiveStaff = allActiveStaff.size;
  const dailyStaffCounts = Array.from(dailyActiveStaff.values()).map((staffSet) => staffSet.size);
  if (dailyStaffCounts.length) {
    result.staffActivityDays = dailyStaffCounts.length;
    result.avgStaffPerDay = dailyStaffCounts.reduce((sum, count) => sum + count, 0) / dailyStaffCounts.length;
  }

  // Busiest day / peak hour from rows.
  if (dayRows.length) {
    let best = null;
    dayRows.forEach((r) => { if (!best || r.count > best.count) best = r; });
    if (best) result.busiestDay = best.dayName;
  }
  if (hourRows.length) {
    let best = null;
    hourRows.forEach((r) => { if (!best || r.count > best.count) best = r; });
    if (best) result.peakHour = best.hour;
  }

  console.log(LOG, "metrics calculated", {
    activity: result.activityCount,
    waitCount: result.waitCount,
    avgWaitMin: result.avgWaitMin,
    longestWaitMin: result.longestWaitMin,
    busiestDay: result.busiestDay,
    peakHour: result.peakHour,
    days: dayRows.length,
    hours: hourRows.length,
    businessHoursSource: businessHours.source,
    starts: result.totalStarts,
    activeStaff: result.totalActiveStaff,
    idleMinutes: result.totalIdleMinutes,
    avgStaffPerDay: result.avgStaffPerDay,
    staffActivityDays: result.staffActivityDays,
  });
  console.log(V2_LOG, "start events detected", { starts: result.totalStarts });
  console.log(V2_LOG, "idle time calculated", {
    waitPairs: allWaits.length,
    idleMinutes: result.totalIdleMinutes,
  });
  console.log(TYPES_LOG, "per hour type counts", result.byDayHour.map((day) => ({
    day: day.dayName,
    hours: (day.hours || []).map((hour) => ({
      hour: fmtHourRange(hour.hour),
      startsByType: hour.startsByType,
      staffByType: hour.staffByType,
      idleByType: hour.idleByType,
      totalWait: fmtIdleMinutes(hour.idleMinutes),
      waitTimeByType: buildWaitTimeTypeRows(hour).map((row) => ({
        type: row.type,
        wait: fmtIdleMinutes(row.count),
      })),
    })),
  })));
  console.log(V2_LOG, "per hour aggregation", result.byDayHour);
  return result;
}

// ---------- Formatting helpers ----------

function fmtMinutes(min) {
  if (!Number.isFinite(min) || min <= 0) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fmtIdleMinutes(min) {
  if (!Number.isFinite(min) || min <= 0) return "0m";
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fmtStaffAverage(value) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
}

function fmtHourRange(hour24) {
  if (!Number.isFinite(hour24) || hour24 < 0 || hour24 > 23) return "—";
  const next = (hour24 + 1) % 24;
  const labelFull = (h) => {
    if (h === 0) return "12 AM";
    if (h === 12) return "12 PM";
    return h < 12 ? `${h} AM` : `${h - 12} PM`;
  };
  return `${labelFull(hour24).replace(/ AM| PM/, "")}–${labelFull(next)}`;
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------- Render ----------

function renderEmpty() {
  ["ffQaSummary", "ffQaByDay", "ffQaByHour", "ffQaInsights"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = "";
  });
  const summary = document.getElementById("ffQaSummary");
  if (summary) {
    summary.outerHTML = '<div id="ffQaSummary" class="qa-empty">No queue data available yet</div>';
  }
  const byDay = document.getElementById("ffQaByDay");
  if (byDay) byDay.innerHTML = '<div style="color:#6b7280;font-size:13px;">No queue data available yet</div>';
  const byHour = document.getElementById("ffQaByHour");
  if (byHour) byHour.innerHTML = '<div style="color:#6b7280;font-size:13px;">No queue data available yet</div>';
  const insights = document.getElementById("ffQaInsights");
  if (insights) {
    insights.innerHTML = `
      <ul class="qa-insights-list">
        <li class="qa-insight is-info"><span aria-hidden="true">ℹ️</span><span>Queue data is currently low. Insights will appear once staff flow events are logged.</span></li>
      </ul>
    `;
  }
}

function renderSummary(metrics) {
  const root = document.getElementById("ffQaSummary");
  if (!root) return;
  const rangeLabel = metrics.rangeLabel || "Selected range";
  const cards = [
    { label: "Service starts", value: String(metrics.totalStarts || 0), foot: "Work entered" },
    { label: "Active staff", value: String(metrics.totalActiveStaff || 0), foot: rangeLabel },
    { label: "Avg staff / day", value: fmtStaffAverage(metrics.avgStaffPerDay), foot: `${metrics.staffActivityDays || 0} active day${(metrics.staffActivityDays || 0) === 1 ? "" : "s"}` },
    { label: "Average wait time", value: fmtMinutes(metrics.avgWaitMin), foot: rangeLabel },
    { label: "Longest wait time", value: fmtMinutes(metrics.longestWaitMin), foot: rangeLabel },
  ];
  root.outerHTML = `
    <div id="ffQaSummary" class="qa-summary">
      ${cards.map((c) => `
        <div class="qa-card">
          <div class="qa-card-label">${escapeHtml(c.label)}</div>
          <div class="qa-card-value">${escapeHtml(c.value)}</div>
          <div class="qa-card-foot">${escapeHtml(c.foot)}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderByDay(metrics) {
  const root = document.getElementById("ffQaByDay");
  if (!root) return;
  const rows = metrics.byDay || [];
  if (!rows.length) {
    root.innerHTML = '<div style="color:#6b7280;font-size:13px;">No day-level staff flow yet.</div>';
    return;
  }
  const maxCount = rows.reduce((a, r) => (r.count > a ? r.count : a), 0) || 1;
  root.innerHTML = `
    <table class="qa-table">
      <thead>
        <tr>
          <th>Day</th>
          <th class="num">Avg wait</th>
          <th class="num">Longest wait</th>
          <th class="num">Staff Flow</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => {
          const pct = Math.round((r.count / maxCount) * 100);
          return `
            <tr>
              <td>${escapeHtml(r.dayName)}</td>
              <td class="num">${escapeHtml(fmtMinutes(r.avgWaitMin))}</td>
              <td class="num">${escapeHtml(fmtMinutes(r.longestWaitMin))}</td>
              <td class="num">
                ${escapeHtml(String(r.count))}
                <div class="qa-bar"><span style="width:${pct}%"></span></div>
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function renderTypeBreakdown(title, rows, formatter = (value) => String(value || 0)) {
  const cleanRows = Array.isArray(rows) && rows.length ? rows : [{ type: "Other", count: 0 }];
  return `
    <div>
      <div class="qa-type-title">${escapeHtml(title)}</div>
      ${cleanRows.map((row) => `
        <div class="qa-type-row">
          <span>${escapeHtml(row.type || "Other")}</span>
          <strong>${escapeHtml(formatter(row.count || 0))}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function mergeTypeRows(primaryRows, ...fallbackRows) {
  const out = new Map();
  (Array.isArray(primaryRows) ? primaryRows : []).forEach((row) => {
    const type = String(row?.type || "Other").trim() || "Other";
    out.set(type, Number(row?.count) || 0);
  });
  fallbackRows.forEach((rows) => {
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const type = String(row?.type || "Other").trim() || "Other";
      if (!out.has(type)) out.set(type, 0);
    });
  });
  return Array.from(out.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

function buildWaitTimeTypeRows(hour) {
  const totalWait = Number(hour?.idleMinutes) || 0;
  const primaryRows = Array.isArray(hour?.idleByType) ? hour.idleByType : [];
  const primaryTotal = primaryRows.reduce((sum, row) => sum + (Number(row?.count) || 0), 0);

  if (totalWait > 0 && primaryTotal <= 0) {
    return [{ type: "Unassigned", count: totalWait }];
  }

  const rows = primaryRows
    .filter((row) => (Number(row?.count) || 0) > 0)
    .map((row) => ({
      type: String(row?.type || "Unassigned").trim() || "Unassigned",
      count: Number(row?.count) || 0,
    }));

  if (totalWait > 0 && primaryTotal > 0 && Math.abs(totalWait - primaryTotal) >= 0.5) {
    const missing = totalWait - primaryTotal;
    const first = rows[0];
    if (first) first.count = (Number(first.count) || 0) + missing;
  }

  return rows.sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

function formatTypeBreakdown(rows, formatter = (value) => String(value || 0)) {
  const cleanRows = Array.isArray(rows) && rows.length ? rows : [{ type: "Other", count: 0 }];
  return cleanRows.map((row) => `${row.type || "Other"}: ${formatter(row.count || 0)}`).join("; ");
}

function closeHourDetailsModal() {
  const modal = document.getElementById("ffQaHourDetailsModal");
  if (modal) modal.remove();
}

function showHourDetailsModal(day, hour) {
  closeHourDetailsModal();
  const root = document.getElementById(SCREEN_ID);
  if (!root || !day || !hour) return;
  const modal = document.createElement("div");
  modal.id = "ffQaHourDetailsModal";
  modal.className = "qa-hour-modal-backdrop";
  modal.innerHTML = `
    <div class="qa-hour-modal" role="dialog" aria-modal="true" aria-labelledby="ffQaHourModalTitle">
      <div class="qa-hour-modal-head">
        <div>
          <h2 class="qa-hour-modal-title" id="ffQaHourModalTitle">${escapeHtml(day.dayName)} ${escapeHtml(fmtHourRange(hour.hour))}</h2>
          <p class="qa-hour-modal-sub">Staff and Available wait breakdown for this hour</p>
        </div>
        <button type="button" class="qa-hour-modal-close" data-qa-hour-modal-close aria-label="Close details">×</button>
      </div>
      <div class="qa-hour-modal-body">
        <div class="qa-hour-modal-summary">
          <div class="qa-hour-modal-stat"><span>Starts</span><strong>${escapeHtml(String(hour.starts || 0))}</strong></div>
          <div class="qa-hour-modal-stat"><span>Staff</span><strong>${escapeHtml(String(hour.activeStaff || 0))}</strong></div>
          <div class="qa-hour-modal-stat"><span>Average Wait</span><strong>${escapeHtml(fmtIdleMinutes(hour.idleMinutes))}</strong></div>
        </div>
        <div class="qa-hour-modal-section">
          ${renderTypeBreakdown("Average wait by type", buildWaitTimeTypeRows(hour), fmtIdleMinutes)}
        </div>
        <div class="qa-hour-modal-section">
          ${renderTypeBreakdown("Staff by type", hour.staffByType)}
        </div>
      </div>
    </div>
  `;
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest("[data-qa-hour-modal-close]")) {
      closeHourDetailsModal();
    }
  });
  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      closeHourDetailsModal();
      document.removeEventListener("keydown", onKeyDown);
    }
  };
  document.addEventListener("keydown", onKeyDown);
  root.appendChild(modal);
  const closeBtn = modal.querySelector("[data-qa-hour-modal-close]");
  if (closeBtn) closeBtn.focus();
}

function renderByHour(metrics) {
  const root = document.getElementById("ffQaByHour");
  if (!root) return;
  const dayRows = metrics.byDayHour || [];
  if (!dayRows.length) {
    root.innerHTML = '<div style="color:#6b7280;font-size:13px;">No hourly staff flow yet.</div>';
    return;
  }
  root.innerHTML = `
    <div>
      ${dayRows.map((day, idx) => `
        <details class="qa-hour-day">
          <summary class="qa-hour-day-title">
            <span>${escapeHtml(day.dayName)} ▼</span>
            <span class="qa-hour-day-hours">${day.isOpen ? `${escapeHtml(day.openTime)}–${escapeHtml(day.closeTime)}` : "Closed"}</span>
          </summary>
          ${day.isOpen ? `
            <div class="qa-hour-day-body">
              <div class="qa-day-stats">
                <span class="qa-day-stat">Total Staff: ${escapeHtml(String(day.totalStaff || 0))}</span>
                <span class="qa-day-stat">Peak Hour: ${escapeHtml(day.peakHour == null ? "—" : fmtHourRange(day.peakHour))}</span>
              </div>
              <div class="qa-hour-grid">
                ${day.hours.map((r) => `
                  <button type="button" class="qa-hour-tile ${r.hour === day.peakHour ? "is-peak" : ""}" data-qa-hour-card data-day-idx="${escapeHtml(String(day.dayIdx))}" data-hour="${escapeHtml(String(r.hour))}" aria-label="Open ${escapeHtml(day.dayName)} ${escapeHtml(fmtHourRange(r.hour))} details">
                    <div class="qa-hour-card-title">${escapeHtml(fmtHourRange(r.hour))}</div>
                    <div class="qa-hour-card-row"><span>Starts</span><strong>${escapeHtml(String(r.starts || 0))}</strong></div>
                    <div class="qa-hour-card-row"><span>Staff</span><strong>${escapeHtml(String(r.activeStaff || 0))}</strong></div>
                    <div class="qa-hour-card-row"><span>Average Wait</span><strong>${escapeHtml(fmtIdleMinutes(r.idleMinutes))}</strong></div>
                  </button>
                `).join("")}
              </div>
            </div>
          ` : '<div class="qa-hour-day-body"><div class="qa-closed">Closed</div></div>'}
        </details>
      `).join("")}
    </div>
  `;
  root.querySelectorAll("[data-qa-hour-card]").forEach((card) => {
    card.addEventListener("click", () => {
      const dayIdx = Number(card.getAttribute("data-day-idx"));
      const hourValue = Number(card.getAttribute("data-hour"));
      const day = dayRows.find((row) => row.dayIdx === dayIdx);
      const hour = day?.hours?.find((row) => row.hour === hourValue);
      showHourDetailsModal(day, hour);
    });
  });
}

function buildInsights(metrics) {
  const out = [];
  if (!metrics.sourceFound || (
    metrics.activityCount === 0 &&
    metrics.waitCount === 0 &&
    metrics.totalStarts === 0 &&
    metrics.totalActiveStaff === 0 &&
    metrics.totalIdleMinutes === 0
  )) {
    out.push({ kind: "info", icon: "ℹ️", text: "Queue data is currently low. Insights will appear once staff flow events are logged." });
    return out;
  }
  let peakStart = null;
  (metrics.byDayHour || []).forEach((day) => {
    (day.hours || []).forEach((hour) => {
      if (!peakStart || hour.starts > peakStart.starts) {
        peakStart = { ...hour, dayName: day.dayName };
      }
    });
  });
  if (peakStart && peakStart.starts > 0) {
    out.push({
      kind: "warn",
      icon: "⚠️",
      text: `Peak demand at ${fmtHourRange(peakStart.hour)} (${peakStart.starts} service starts).`,
    });
  }
  let busiestStaffHour = null;
  let highestIdleHour = null;
  (metrics.byDayHour || []).forEach((day) => {
    (day.hours || []).forEach((hour) => {
      if (!busiestStaffHour || (hour.activeStaff || 0) > busiestStaffHour.activeStaff) {
        busiestStaffHour = { ...hour, dayName: day.dayName };
      }
      if (!highestIdleHour || (hour.idleMinutes || 0) > highestIdleHour.idleMinutes) {
        highestIdleHour = { ...hour, dayName: day.dayName };
      }
    });
  });
  if (busiestStaffHour && busiestStaffHour.activeStaff >= 1) {
    out.push({
      kind: "warn",
      icon: "⚠️",
      text: `Most active staff were on ${busiestStaffHour.dayName} around ${fmtHourRange(busiestStaffHour.hour)} (${busiestStaffHour.activeStaff} staff).`,
    });
  }
  if (highestIdleHour && highestIdleHour.idleMinutes >= 20) {
    out.push({
      kind: "warn",
      icon: "⚠️",
      text: `Highest wait time was ${highestIdleHour.dayName} ${fmtHourRange(highestIdleHour.hour)} (${fmtIdleMinutes(highestIdleHour.idleMinutes)}).`,
    });
  }
  // Worst day by avg wait (only consider days that actually have wait pairs).
  const dayWithWaits = (metrics.byDay || []).filter((r) => Number.isFinite(r.avgWaitMin) && r.avgWaitMin > 0);
  if (dayWithWaits.length) {
    let worst = dayWithWaits[0];
    dayWithWaits.forEach((r) => { if (r.avgWaitMin > worst.avgWaitMin) worst = r; });
    out.push({
      kind: "warn",
      icon: "⚠️",
      text: `${worst.dayName} has the highest average wait time (${fmtMinutes(worst.avgWaitMin)}).`,
    });
  }
  if (Number.isFinite(metrics.avgWaitMin) && metrics.avgWaitMin >= 20) {
    out.push({
      kind: "warn",
      icon: "⚠️",
      text: `Average wait time is high (${fmtMinutes(metrics.avgWaitMin)}). Consider adding capacity.`,
    });
  }
  if (Number.isFinite(metrics.longestWaitMin) && metrics.longestWaitMin >= 45) {
    out.push({
      kind: "warn",
      icon: "⚠️",
      text: `Longest wait time in this range reached ${fmtMinutes(metrics.longestWaitMin)}.`,
    });
  }
  if (!out.length) {
    if (metrics.waitCount === 0 && metrics.activityCount > 0) {
      out.push({ kind: "info", icon: "ℹ️", text: "Staff flow was recorded, but no completed join → start pairs yet." });
    } else {
      out.push({ kind: "good", icon: "✅", text: "Queue is flowing smoothly. No bottlenecks detected in this range." });
    }
  }
  return out.slice(0, 4);
}

function renderInsights(metrics) {
  const root = document.getElementById("ffQaInsights");
  if (!root) return;
  const items = buildInsights(metrics);
  root.innerHTML = `
    <ul class="qa-insights-list">
      ${items.map((i) => {
        const cls = i.kind === "good" ? "is-good" : i.kind === "info" ? "is-info" : "";
        return `
          <li class="qa-insight ${cls}">
            <span aria-hidden="true">${escapeHtml(i.icon)}</span>
            <span>${escapeHtml(i.text)}</span>
          </li>
        `;
      }).join("")}
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
    renderEmpty();
    return;
  }
  if (!metrics.sourceFound || (
    metrics.activityCount === 0 &&
    metrics.waitCount === 0 &&
    metrics.totalStarts === 0 &&
    metrics.totalActiveStaff === 0 &&
    metrics.totalIdleMinutes === 0
  )) {
    renderEmpty();
    return;
  }
  renderSummary(metrics);
  renderByDay(metrics);
  renderByHour(metrics);
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
