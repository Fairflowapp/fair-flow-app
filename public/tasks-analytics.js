/**
 * Tasks Analytics - simple high-level operational dashboard.
 *
 * Read-only. Uses current Tasks state/cache when available and falls back to
 * the active location's tasksState document. Does not modify Tasks or Firestore.
 */

import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db, auth } from "./app.js?v=20260412_salon_owner_uid";

const LOG = "[TasksAnalytics]";
const SCREEN_ID = "tasksAnalyticsScreen";
const STYLE_ID = "ffTasksAnalyticsStyles";
const RANGE_STORAGE_KEY = "ff_tasks_analytics_range_v1";
const TABS = ["opening", "closing", "weekly", "monthly", "yearly"];
const TASK_TYPE_LABELS = ["Opening", "Closing", "Weekly", "Monthly", "Yearly"];
const KINDS = ["active", "pending", "done"];
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

function clean(value) {
  return value == null ? "" : String(value).trim();
}

function safeArr(value) {
  return Array.isArray(value) ? value : [];
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toMillis(value) {
  if (!value) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value.toMillis === "function") {
    try { return value.toMillis(); } catch (_) { return null; }
  }
  if (typeof value.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

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
  try {
    const parsed = JSON.parse(localStorage.getItem(RANGE_STORAGE_KEY) || "{}");
    if (parsed && typeof parsed === "object") {
      _rangeState = {
        mode: clean(parsed.mode) || "thisWeek",
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

function getActiveLocationId() {
  try {
    if (typeof window.ffGetActiveLocationId === "function") {
      const id = clean(window.ffGetActiveLocationId());
      if (id) return id;
    }
  } catch (_) {}
  try {
    return clean(window.__ff_active_location_id || window.activeLocationId || window.currentLocationId);
  } catch (_) {
    return "";
  }
}

function getLocationLabel() {
  const id = getActiveLocationId();
  let name = "";
  try {
    const lists = [
      typeof window.ffGetActiveLocations === "function" ? window.ffGetActiveLocations() : null,
      typeof window.ffGetLocations === "function" ? window.ffGetLocations() : null,
      window.ffLocationsState?.locations,
    ];
    for (const list of lists) {
      const match = safeArr(list).find((loc) => clean(loc?.id || loc?.locationId) === id);
      if (match) {
        name = clean(match.name || match.label || match.title || id);
        break;
      }
    }
  } catch (_) {}
  return id ? `${name || id}` : "Select location";
}

async function getSalonId() {
  try {
    if (window.currentSalonId) return clean(window.currentSalonId);
  } catch (_) {}
  try {
    const cached = localStorage.getItem("ff_salonId_v1");
    if (cached) return clean(cached);
  } catch (_) {}
  try {
    const uid = auth?.currentUser?.uid;
    if (!uid) return "";
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? clean(snap.data()?.salonId) : "";
  } catch (err) {
    console.warn(LOG, "salon lookup failed", err);
    return "";
  }
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function stateFromLocalStorage() {
  const state = { catalog: readJson("ff_tasks_catalog_v1", {}) || {} };
  TABS.forEach((tab) => {
    state[tab] = {};
    KINDS.forEach((kind) => {
      state[tab][kind] = readJson(`ff_tasks_${tab}_${kind}_v1`, []);
    });
  });
  return state;
}

function stateHasRows(state) {
  return TABS.some((tab) => KINDS.some((kind) => safeArr(state?.[tab]?.[kind]).length));
}

async function readTasksState() {
  const candidates = [];
  try {
    if (window.tasksCache && typeof window.tasksCache === "object") {
      candidates.push({ source: "window.tasksCache", state: window.tasksCache });
    }
  } catch (_) {}

  candidates.push({ source: "localStorage", state: stateFromLocalStorage() });

  const cached = candidates.find((item) => stateHasRows(item.state));
  if (cached) {
    console.log(LOG, "data source detected", cached.source);
    return cached;
  }

  const salonId = await getSalonId();
  const locationId = getActiveLocationId();
  if (salonId) {
    try {
      const snap = await getDoc(doc(db, `salons/${salonId}/tasksState`, locationId || "default"));
      if (snap.exists()) {
        const state = snap.data() || {};
        console.log(LOG, "data source detected", "Firestore tasksState");
        return { source: "Firestore tasksState", state };
      }
    } catch (err) {
      console.warn(LOG, "tasksState fallback failed", err);
    }
  }

  console.log(LOG, "no task data source found");
  return { source: "none", state: {} };
}

function isCompleted(task, kind) {
  const status = clean(task?.status || task?.state).toLowerCase();
  return kind === "done" ||
    status === "done" ||
    status === "completed" ||
    task?.completed === true ||
    task?.isCompleted === true ||
    task?.done === true ||
    !!task?.completedAt ||
    !!task?.completedBy;
}

function taskType(task, tab) {
  const raw = clean(task?.type || task?.taskType || task?.category || tab).toLowerCase();
  if (raw.includes("open") || tab === "opening") return "Opening";
  if (raw.includes("close") || tab === "closing") return "Closing";
  if (raw.includes("week") || tab === "weekly") return "Weekly";
  if (raw.includes("month") || tab === "monthly") return "Monthly";
  if (raw.includes("year") || tab === "yearly") return "Yearly";
  return tab ? tab.charAt(0).toUpperCase() + tab.slice(1) : "Other";
}

function roleType(task) {
  const raw = clean(
    task?.assignedRole ||
    task?.staffRole ||
    task?.role ||
    task?.assignTo ||
    task?.assignedToRole ||
    task?.requiredRole,
  ).toLowerCase();
  if (/(manager|admin|owner|lead)/.test(raw)) return "Manager";
  if (/(service|provider|technician|tech|staff|employee)/.test(raw)) return "Service Provider";
  return "Other";
}

function taskTimestamp(task) {
  return toMillis(
    task?.createdAt ??
    task?.createdAtMs ??
    task?.created ??
    task?.addedAt ??
    task?.completedAt ??
    task?.dueDate,
  );
}

function dueTimestamp(task) {
  return toMillis(task?.dueDate ?? task?.dueAt ?? task?.deadline ?? task?.alertAt);
}

function normalizeTasks(state) {
  const rows = [];
  const seen = new Set();
  TABS.forEach((tab) => {
    KINDS.forEach((kind) => {
      const list = safeArr(state?.[tab]?.[kind] || state?.[tab]?.items);
      list.forEach((task, index) => {
        if (!task || typeof task !== "object") return;
        const id = clean(task.taskId || task.id || task.title || `${tab}-${kind}-${index}`);
        const completed = isCompleted(task, kind);
        const key = `${tab}|${id}|${completed ? "done" : "open"}`;
        if (seen.has(key)) return;
        seen.add(key);
        rows.push({
          id,
          title: clean(task.title || task.name || id),
          tab,
          kind,
          completed,
          type: taskType(task, tab),
          role: roleType(task),
          createdMs: taskTimestamp(task),
          completedMs: toMillis(task.completedAt ?? task.completedAtMs),
          dueMs: dueTimestamp(task),
        });
      });
    });
  });
  return rows;
}

function rate(completed, total) {
  return total > 0 ? Math.round((completed / total) * 100) : null;
}

function fmtRate(value) {
  return Number.isFinite(value) ? `${Math.round(value)}%` : "--";
}

function bucketRate(rows, label, picker) {
  const scoped = rows.filter((row) => picker(row) === label);
  return {
    label,
    total: scoped.length,
    completed: scoped.filter((row) => row.completed).length,
    rate: rate(scoped.filter((row) => row.completed).length, scoped.length),
  };
}

function periodRate(rows, fromMs, toMs) {
  const scoped = rows.filter((row) => {
    const ms = row.completedMs || row.createdMs;
    return Number.isFinite(ms) && ms >= fromMs && ms < toMs;
  });
  return {
    total: scoped.length,
    completed: scoped.filter((row) => row.completed).length,
    rate: rate(scoped.filter((row) => row.completed).length, scoped.length),
  };
}

function taskRangeMs(row) {
  return row.completedMs || row.createdMs || row.dueMs || null;
}

function filterRowsByRange(rows, range) {
  const from = Number(range?.fromMs);
  const to = Number(range?.toMs);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return rows;
  return rows.filter((row) => {
    const ms = taskRangeMs(row);
    return !Number.isFinite(ms) || (ms >= from && ms <= to);
  });
}

function previousRange(range) {
  const from = Number(range?.fromMs);
  const to = Number(range?.toMs);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const span = Math.max(1, to - from + 1);
  return { fromMs: from - span, toMs: from - 1 };
}

function computeMetrics(rows, source, range = getSelectedRange(), allRows = rows) {
  const now = Date.now();
  const completed = rows.filter((row) => row.completed).length;
  const open = rows.length - completed;
  const overdue = rows.filter((row) => !row.completed && Number.isFinite(row.dueMs) && row.dueMs < now).length;
  const prev = previousRange(range);
  const thisWeek = periodRate(allRows, range.fromMs, range.toMs + 1);
  const lastWeek = prev ? periodRate(allRows, prev.fromMs, prev.toMs + 1) : { total: 0, completed: 0, rate: null };
  const overallRate = rate(completed, rows.length);
  const labels = [...TASK_TYPE_LABELS];
  rows.forEach((row) => {
    if (row.type && !labels.includes(row.type)) labels.push(row.type);
  });
  const byType = labels.map((label) => bucketRate(rows, label, (row) => row.type));
  const byRole = ["Manager", "Service Provider", "Other"].map((label) => bucketRate(rows, label, (row) => row.role));
  const metrics = {
    source,
    total: rows.length,
    completed,
    open,
    overdue,
    completionRate: overallRate,
    byType,
    byRole,
    thisWeek,
    lastWeek,
    rangeLabel: range.label,
    hasData: rows.length > 0,
  };
  console.log(LOG, "metrics calculated", metrics);
  return metrics;
}

function buildInsights(metrics) {
  if (!metrics.hasData) return [];
  const out = [];
  const closing = metrics.byType.find((row) => row.label === "Closing");
  const service = metrics.byRole.find((row) => row.label === "Service Provider");
  if (closing?.total >= 2 && Number.isFinite(closing.rate) && closing.rate < 70) {
    out.push({ kind: "warn", text: "Closing tasks often not completed." });
  }
  if (service?.total >= 2 && Number.isFinite(service.rate) && service.rate < 70) {
    out.push({ kind: "warn", text: "Service Providers have low completion rate." });
  }
  if (metrics.overdue >= 5 || (metrics.open > 0 && metrics.overdue / metrics.open >= 0.3)) {
    out.push({ kind: "warn", text: "High number of overdue tasks." });
  }
  if (Number.isFinite(metrics.completionRate) && metrics.completionRate >= 80) {
    out.push({ kind: "good", text: "Good task completion this week." });
  }
  if (!out.length) out.push({ kind: "info", text: "Task activity is being tracked. More insights will appear as patterns develop." });
  return out.slice(0, 4);
}

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
    #${SCREEN_ID} .tsa-wrap {
      max-width: 1180px;
      margin: 0 auto;
      padding: 6px 28px 48px;
      width: 100%;
    }
    #${SCREEN_ID} .tsa-back {
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
    #${SCREEN_ID} .tsa-back:hover { color: #9d68b9; }
    #${SCREEN_ID} .tsa-h1 {
      display: inline-block;
      vertical-align: middle;
      margin: 0 8px 6px 0;
      font-size: 16px;
      font-weight: 800;
      color: #111827;
      letter-spacing: -0.01em;
    }
    #${SCREEN_ID} .tsa-sub {
      display: none;
    }
    #${SCREEN_ID} .tsa-location {
      display: inline-flex;
      align-items: center;
      vertical-align: middle;
      margin: 0 0 6px 0;
      padding: 5px 8px;
      border-radius: 999px;
      background: #fff;
      border: 1px solid #e5e7eb;
      color: #6b7280;
      font-size: 10px;
      font-weight: 700;
    }
    #${SCREEN_ID} .tsa-toolbar {
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
    #${SCREEN_ID} .tsa-filter-row {
      display: flex;
      align-items: flex-end;
      gap: 10px;
      flex-wrap: wrap;
    }
    #${SCREEN_ID} .tsa-field {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    #${SCREEN_ID} .tsa-field label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
    }
    #${SCREEN_ID} .tsa-field select,
    #${SCREEN_ID} .tsa-field input {
      height: 36px;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      background: #fff;
      color: #111827;
      padding: 0 10px;
      font-size: 13px;
      min-width: 150px;
    }
    #${SCREEN_ID} .tsa-field.is-custom { display: none; }
    #${SCREEN_ID}.tsa-custom-range .tsa-field.is-custom { display: flex; }
    #${SCREEN_ID} .tsa-toolbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    #${SCREEN_ID} .tsa-range-label {
      font-size: 12px;
      color: #6b7280;
      margin-right: 4px;
    }
    #${SCREEN_ID} .tsa-action-btn {
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
    #${SCREEN_ID} .tsa-action-btn.secondary {
      background: #f3f4f6;
      color: #374151;
      box-shadow: none;
      border: 1px solid #e5e7eb;
    }
    #${SCREEN_ID} .tsa-section-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6b7280;
      margin: 12px 2px 7px;
    }
    #${SCREEN_ID} .tsa-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 10px;
    }
    #${SCREEN_ID} .tsa-card,
    #${SCREEN_ID} .tsa-panel {
      background: #fff;
      border: 1px solid #e5e7eb;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    #${SCREEN_ID} .tsa-card {
      border-radius: 14px;
      padding: 11px 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    #${SCREEN_ID} .tsa-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
    }
    #${SCREEN_ID} .tsa-value {
      font-size: 24px;
      font-weight: 800;
      color: #111827;
      line-height: 1.1;
    }
    #${SCREEN_ID} .tsa-foot {
      font-size: 11px;
      color: #6b7280;
    }
    #${SCREEN_ID} .tsa-two-col {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    #${SCREEN_ID} .tsa-panel {
      border-radius: 16px;
      padding: 18px 20px;
    }
    #${SCREEN_ID} .tsa-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid #eef0f3;
      font-size: 13px;
      color: #374151;
    }
    #${SCREEN_ID} .tsa-row:last-child { border-bottom: 0; }
    #${SCREEN_ID} .tsa-row b {
      color: #111827;
      font-size: 18px;
    }
    #${SCREEN_ID} .tsa-trend {
      display: flex;
      align-items: baseline;
      gap: 8px;
      font-size: 28px;
      font-weight: 800;
      color: #111827;
    }
    #${SCREEN_ID} .tsa-trend span {
      font-size: 13px;
      font-weight: 700;
      color: #6b7280;
    }
    #${SCREEN_ID} .tsa-insights {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    #${SCREEN_ID} .tsa-insight {
      padding: 10px 12px;
      border-radius: 10px;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      color: #1e40af;
      font-size: 13px;
      line-height: 1.4;
    }
    #${SCREEN_ID} .tsa-insight.warn {
      background: #fff7ed;
      border-color: #fed7aa;
      color: #9a3412;
    }
    #${SCREEN_ID} .tsa-insight.good {
      background: #ecfdf5;
      border-color: #a7f3d0;
      color: #065f46;
    }
    #${SCREEN_ID} .tsa-empty {
      border: 1px dashed #d1d5db;
      background: #fff;
      border-radius: 14px;
      padding: 24px;
      color: #6b7280;
      font-size: 14px;
      text-align: center;
    }
    @media (max-width: 800px) {
      #${SCREEN_ID} .tsa-wrap { padding: 16px 14px 32px; }
      #${SCREEN_ID} .tsa-h1,
      #${SCREEN_ID} .tsa-location { margin-left: 0; }
      #${SCREEN_ID} .tsa-toolbar { align-items: stretch; }
      #${SCREEN_ID} .tsa-toolbar-actions { width: 100%; }
      #${SCREEN_ID} .tsa-action-btn { flex: 1; }
      #${SCREEN_ID} .tsa-two-col { grid-template-columns: 1fr; }
    }
  `;
  document.head.appendChild(style);
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

function card(label, value, foot = "") {
  return `
    <div class="tsa-card">
      <div class="tsa-label">${escapeHtml(label)}</div>
      <div class="tsa-value">${escapeHtml(value)}</div>
      <div class="tsa-foot">${escapeHtml(foot)}</div>
    </div>
  `;
}

function renderEmpty() {
  const summary = document.getElementById("ffTasksAnalyticsSummary");
  const type = document.getElementById("ffTasksAnalyticsType");
  const role = document.getElementById("ffTasksAnalyticsRole");
  const trend = document.getElementById("ffTasksAnalyticsTrend");
  const insights = document.getElementById("ffTasksAnalyticsInsights");
  const empty = '<div class="tsa-empty">No task data available yet</div>';
  if (summary) summary.innerHTML = empty;
  if (type) type.innerHTML = empty;
  if (role) role.innerHTML = empty;
  if (trend) trend.innerHTML = empty;
  if (insights) insights.innerHTML = empty;
}

function renderSummary(metrics) {
  const root = document.getElementById("ffTasksAnalyticsSummary");
  if (!root) return;
  root.innerHTML = [
    card("Tasks Opened", metrics.total, "All tracked tasks"),
    card("Tasks Completed", metrics.completed, "Marked done"),
    card("Completion Rate", fmtRate(metrics.completionRate), "Completed / opened"),
    card("Open Tasks", metrics.open, "Still active or pending"),
    card("Overdue Tasks", metrics.overdue, "Past due and open"),
  ].join("");
}

function renderBreakdown(rootId, title, rows) {
  const root = document.getElementById(rootId);
  if (!root) return;
  root.innerHTML = `
    <div class="tsa-label" style="margin-bottom:8px;">${escapeHtml(title)}</div>
    ${rows.map((row) => `
      <div class="tsa-row">
        <span>${escapeHtml(row.label)}</span>
        <b>${escapeHtml(fmtRate(row.rate))}</b>
      </div>
    `).join("")}
  `;
}

function renderTrend(metrics) {
  const root = document.getElementById("ffTasksAnalyticsTrend");
  if (!root) return;
  const current = metrics.thisWeek.rate;
  const last = metrics.lastWeek.rate;
  let suffix = "Not enough weekly history yet";
  if (Number.isFinite(current) && Number.isFinite(last)) {
    const arrow = current >= last ? "↑" : "↓";
    suffix = `${arrow} from ${fmtRate(last)}`;
  }
  root.innerHTML = `
    <div class="tsa-label">${escapeHtml(metrics.rangeLabel || "Selected range")} vs previous period</div>
    <div class="tsa-trend">${escapeHtml(fmtRate(current))} <span>${escapeHtml(suffix)}</span></div>
    <div class="tsa-foot">${escapeHtml(metrics.thisWeek.completed)} completed of ${escapeHtml(metrics.thisWeek.total)} tracked in this range</div>
  `;
}

function renderInsights(metrics) {
  const root = document.getElementById("ffTasksAnalyticsInsights");
  if (!root) return;
  const items = buildInsights(metrics);
  root.innerHTML = `
    <ul class="tsa-insights">
      ${items.map((item) => `<li class="tsa-insight ${escapeHtml(item.kind)}">${escapeHtml(item.text)}</li>`).join("")}
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
  const screen = document.getElementById(SCREEN_ID);
  if (screen) screen.style.display = "flex";
  document.querySelectorAll(".btn-pill").forEach((btn) => btn.classList.remove("active"));
  refresh();
}

function ensureInjected() {
  if (_injected) return;
  injectStyles();
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

