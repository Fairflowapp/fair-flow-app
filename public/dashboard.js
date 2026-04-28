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

const LOG = "[Dashboard]";
const SCREEN_ID = "dashboardScreen";
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

// ---------- DOM injection ----------

function injectStyles() {
  if (document.getElementById("ffDashboardStyles")) return;
  const style = document.createElement("style");
  style.id = "ffDashboardStyles";
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
    #${SCREEN_ID} .dash-wrap {
      max-width: 1280px;
      margin: 0 auto;
      padding: 24px 28px 48px 28px;
      width: 100%;
    }
    #${SCREEN_ID} .dash-h1 {
      margin: 0 0 4px 0;
      font-size: 22px;
      font-weight: 700;
      color: #111827;
      letter-spacing: -0.01em;
    }
    #${SCREEN_ID} .dash-sub {
      margin: 0 0 22px 0;
      font-size: 13px;
      color: #6b7280;
    }
    #${SCREEN_ID} .dash-section-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6b7280;
      margin: 22px 2px 10px 2px;
    }
    #${SCREEN_ID} .dash-kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }
    #${SCREEN_ID} .dash-kpi {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 14px;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    #${SCREEN_ID} .dash-kpi-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
    }
    #${SCREEN_ID} .dash-kpi-value {
      font-size: 26px;
      font-weight: 700;
      color: #111827;
      line-height: 1.1;
    }
    #${SCREEN_ID} .dash-kpi-foot {
      font-size: 12px;
      color: #6b7280;
    }
    #${SCREEN_ID} .dash-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
    }
    #${SCREEN_ID} .dash-card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    #${SCREEN_ID} .dash-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    #${SCREEN_ID} .dash-card-title {
      font-size: 15px;
      font-weight: 700;
      color: #111827;
      margin: 0;
    }
    #${SCREEN_ID} .dash-card-icon {
      width: 32px; height: 32px;
      border-radius: 10px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, rgba(157, 104, 185, 0.12), rgba(255, 149, 128, 0.12));
      color: #9d68b9;
    }
    #${SCREEN_ID} .dash-card-icon svg {
      width: 16px; height: 16px;
    }
    #${SCREEN_ID} .dash-stats {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }
    #${SCREEN_ID} .dash-stat {
      background: #f9fafb;
      border: 1px solid #eef0f3;
      border-radius: 10px;
      padding: 10px 12px;
    }
    #${SCREEN_ID} .dash-stat-label {
      font-size: 11px;
      color: #6b7280;
      font-weight: 500;
    }
    #${SCREEN_ID} .dash-stat-value {
      font-size: 18px;
      font-weight: 700;
      color: #111827;
      margin-top: 2px;
    }
    #${SCREEN_ID} .dash-meta {
      font-size: 12px;
      color: #6b7280;
      line-height: 1.5;
    }
    #${SCREEN_ID} .dash-meta b {
      color: #374151;
      font-weight: 600;
    }
    #${SCREEN_ID} .dash-link {
      align-self: flex-start;
      background: none;
      border: 0;
      color: #9d68b9;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      padding: 4px 0;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    #${SCREEN_ID} .dash-link:hover {
      text-decoration: underline;
    }
    #${SCREEN_ID} .dash-insights-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    #${SCREEN_ID} .dash-insight {
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
    #${SCREEN_ID} .dash-insight.is-info {
      background: #eff6ff;
      border-color: #bfdbfe;
      color: #1e40af;
    }
    #${SCREEN_ID} .dash-insight.is-good {
      background: #ecfdf5;
      border-color: #a7f3d0;
      color: #065f46;
    }
    #${SCREEN_ID} .dash-insight-ico {
      flex-shrink: 0;
      font-size: 14px;
      line-height: 1.4;
    }

    @media (max-width: 900px) {
      #${SCREEN_ID} .dash-wrap { padding: 16px 14px 32px 14px; }
      #${SCREEN_ID} .dash-grid { grid-template-columns: 1fr; }
      #${SCREEN_ID} .dash-stats { grid-template-columns: 1fr 1fr; }
    }
  `;
  document.head.appendChild(style);
}

function buildScreen() {
  if (document.getElementById(SCREEN_ID)) return document.getElementById(SCREEN_ID);
  const root = document.createElement("div");
  root.id = SCREEN_ID;
  root.innerHTML = `
    <div class="dash-wrap" id="ffDashWrap">
      <h1 class="dash-h1">Dashboard</h1>
      <p class="dash-sub" id="ffDashSubtitle">Overview of your business activity</p>

      <div class="dash-section-title">Today at a glance</div>
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

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

function todayStartMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function weekStartMs() {
  const d = new Date();
  const day = d.getDay(); // 0 = Sunday
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}

function fmtNumber(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (typeof n !== "number") return String(n);
  if (Math.abs(n) >= 1000) return n.toLocaleString();
  return String(n);
}

function fmtMinutes(min) {
  if (!Number.isFinite(min) || min <= 0) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fmtHourRange(hour24) {
  if (!Number.isFinite(hour24) || hour24 < 0 || hour24 > 23) return "—";
  const next = (hour24 + 1) % 24;
  const label = (h) => {
    if (h === 0) return "12 AM";
    if (h === 12) return "12 PM";
    return h < 12 ? `${h} AM` : `${h - 12} PM`;
  };
  return `${label(hour24).replace(/ AM| PM/, "")}–${label(next)}`;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function fmtCurrency(v) {
  if (!Number.isFinite(v)) return "—";
  try {
    return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  } catch (_) {
    return `$${Math.round(v).toLocaleString()}`;
  }
}

// Best-effort tickets snapshot. Tickets module keeps its data internal,
// so we look for any of the common globals it (or future code) might
// expose. Falls back gracefully.
function readTicketsSnapshot() {
  const out = { todayCount: 0, weekCount: 0, totalCount: 0, totalAmount: 0, hasData: false };
  let list = [];
  if (Array.isArray(window.currentTickets)) list = window.currentTickets;
  else if (Array.isArray(window.allTickets)) list = window.allTickets;
  else if (Array.isArray(window.ticketsCache)) list = window.ticketsCache;
  if (!list.length) return out;

  out.hasData = true;
  out.totalCount = list.length;
  const todayMs = todayStartMs();
  const weekMs = weekStartMs();
  list.forEach((t) => {
    const created = t && (t.createdAtMs || t.createdAt || t.created || t.timestamp);
    let ms = null;
    if (typeof created === "number") ms = created;
    else if (created && typeof created.toMillis === "function") {
      try { ms = created.toMillis(); } catch (_) {}
    } else if (created && typeof created.seconds === "number") {
      ms = created.seconds * 1000;
    } else if (typeof created === "string") {
      const p = Date.parse(created);
      if (!Number.isNaN(p)) ms = p;
    }
    if (ms != null) {
      if (ms >= todayMs) out.todayCount += 1;
      if (ms >= weekMs) out.weekCount += 1;
    }
    const amt = Number(t && (t.totalAmount ?? t.total ?? t.amount));
    if (Number.isFinite(amt)) out.totalAmount += amt;
  });
  return out;
}

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
const QM_LOG_PREFIX = "[Dashboard QueueMetrics]";

function _qmReadRawLog() {
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

// Parse a single log entry (string or object) into { ts, action, worker } or null.
function _qmParseEntry(entry) {
  if (entry == null) return null;
  if (typeof entry === "object") {
    const source = String(entry.source || "queue").toLowerCase();
    if (source !== "queue") return null;
    const ts = Number(entry.ts || entry.timestamp);
    if (!Number.isFinite(ts)) return null;
    const action = String(entry.action || entry.actionText || "").trim();
    const worker = String(entry.worker || entry.assignedTo || "").trim();
    return { ts, action, worker };
  }
  if (typeof entry !== "string") return null;
  // Match "MM/DD/YYYY, h:mm:ss AM/PM <rest>"
  const m = entry.match(/^(\d{1,2}\/\d{1,2}\/\d{4}),\s*([\d:]+\s*[AP]M)\s*(.*)$/);
  if (!m) return null;
  const [, dateStr, timeStr, rest] = m;
  const ts = Date.parse(`${dateStr} ${timeStr}`);
  if (!Number.isFinite(ts)) return null;
  const action = (rest || "").trim();
  const worker = _qmExtractWorker(action);
  return { ts, action, worker };
}

function _qmExtractWorker(action) {
  if (!action) return "";
  let mm = action.match(/IN SERVICE:\s*(.+)$/i); if (mm) return mm[1].trim();
  mm = action.match(/Back to end:\s*(.+)$/i);    if (mm) return mm[1].trim();
  mm = action.match(/^join:\s*(.+)$/i);          if (mm) return mm[1].trim();
  mm = action.match(/^HOLD:\s*(.+)$/i);          if (mm) return mm[1].trim();
  mm = action.match(/^RELEASE:\s*(.+)$/i);       if (mm) return mm[1].trim();
  mm = action.match(/^MOVE (?:UP|DOWN):\s*(.+)$/i); if (mm) return mm[1].trim();
  const idx = action.lastIndexOf(":");
  return idx > -1 ? action.slice(idx + 1).trim() : "";
}

function _qmActionKind(action) {
  if (!action) return null;
  if (/^join:/i.test(action)) return "join";
  if (/IN SERVICE:/i.test(action)) return "start";
  if (/^FINISH\b|Back to end:/i.test(action)) return "finish";
  if (/^HOLD:/i.test(action)) return "hold";
  if (/^RELEASE:/i.test(action)) return "release";
  if (/^MOVE (?:UP|DOWN):/i.test(action)) return "move";
  return null;
}

// Compute queue metrics for [fromMs, nowMs]. Returns nulls when no data.
function computeQueueMetrics(fromMs) {
  const result = {
    avgWaitMin: null,
    longestWaitMin: null,
    busiestDay: null,
    peakHour: null,
    waitCount: 0,
    activityCount: 0,
    sourceFound: false,
  };
  let raw;
  try {
    raw = _qmReadRawLog();
  } catch (e) {
    console.warn(QM_LOG_PREFIX, "error reading log", e);
    return result;
  }
  if (!Array.isArray(raw) || !raw.length) {
    console.log(QM_LOG_PREFIX, "no historical queue data source found");
    return result;
  }
  result.sourceFound = true;
  console.log(QM_LOG_PREFIX, "source detected", { entries: raw.length });

  // Parse + chronological order (raw is newest-first; we walk oldest-first
  // so join → START pairs resolve correctly).
  const parsed = [];
  for (let i = raw.length - 1; i >= 0; i -= 1) {
    const p = _qmParseEntry(raw[i]);
    if (p && p.ts >= fromMs) parsed.push(p);
  }
  if (!parsed.length) {
    console.log(QM_LOG_PREFIX, "no events in range");
    return result;
  }

  const dayCounts = new Map();
  const hourCounts = new Map();
  const lastJoinAt = new Map();
  const waits = [];

  parsed.forEach((ev) => {
    const kind = _qmActionKind(ev.action);
    if (!kind) return;
    result.activityCount += 1;
    const d = new Date(ev.ts);
    const dayKey = d.getDay();
    const hourKey = d.getHours();
    dayCounts.set(dayKey, (dayCounts.get(dayKey) || 0) + 1);
    hourCounts.set(hourKey, (hourCounts.get(hourKey) || 0) + 1);
    const w = (ev.worker || "").toLowerCase();
    if (kind === "join" && w) {
      lastJoinAt.set(w, ev.ts);
    } else if (kind === "start" && w) {
      const joinedAt = lastJoinAt.get(w);
      if (Number.isFinite(joinedAt) && ev.ts > joinedAt) {
        waits.push((ev.ts - joinedAt) / 60000);
        lastJoinAt.delete(w);
      }
    } else if (kind === "finish" && w) {
      lastJoinAt.delete(w);
    }
  });

  if (waits.length) {
    const total = waits.reduce((a, b) => a + b, 0);
    result.avgWaitMin = total / waits.length;
    result.longestWaitMin = waits.reduce((a, b) => (b > a ? b : a), 0);
    result.waitCount = waits.length;
  }

  if (dayCounts.size) {
    let bestDay = null, bestDayCount = -1;
    dayCounts.forEach((count, day) => {
      if (count > bestDayCount) { bestDayCount = count; bestDay = day; }
    });
    if (bestDay != null) result.busiestDay = DAY_NAMES[bestDay];
  }
  if (hourCounts.size) {
    let bestHour = null, bestHourCount = -1;
    hourCounts.forEach((count, hour) => {
      if (count > bestHourCount) { bestHourCount = count; bestHour = hour; }
    });
    if (bestHour != null) result.peakHour = bestHour;
  }

  console.log(QM_LOG_PREFIX, "metrics calculated", {
    waits: waits.length,
    avgWaitMin: result.avgWaitMin,
    longestWaitMin: result.longestWaitMin,
    busiestDay: result.busiestDay,
    peakHour: result.peakHour,
    activity: result.activityCount,
  });
  return result;
}

function readQueueSnapshot() {
  const q = safeArr(window.queue);
  const service = safeArr(window.service);
  const out = {
    inQueue: q.length,
    inService: service.length,
    held: q.filter((x) => x && x.held).length,
    avgWaitMin: null,
    longestWaitMin: null,
    busiestDay: null,
    peakHour: null,
  };
  try {
    const metrics = computeQueueMetrics(weekStartMs());
    out.avgWaitMin = metrics.avgWaitMin;
    out.longestWaitMin = metrics.longestWaitMin;
    out.busiestDay = metrics.busiestDay;
    out.peakHour = metrics.peakHour;
  } catch (e) {
    console.warn(QM_LOG_PREFIX, "error calculating metrics", e);
  }
  return out;
}

function readTasksSnapshot() {
  const cache = window.tasksCache;
  const out = { opened: 0, completed: 0, openCount: 0, completionRate: null, hasData: false };
  if (!cache || typeof cache !== "object") return out;
  let totalActive = 0;
  let totalDone = 0;
  let totalOpen = 0;
  Object.keys(cache).forEach((tab) => {
    const v = cache[tab];
    const arr = Array.isArray(v) ? v : (v && Array.isArray(v.items) ? v.items : []);
    arr.forEach((task) => {
      if (!task) return;
      totalActive += 1;
      const status = String(task.status || task.state || "").toLowerCase();
      if (status === "done" || status === "completed" || task.completed === true || task.doneAt) {
        totalDone += 1;
      } else {
        totalOpen += 1;
      }
    });
  });
  if (!totalActive) return out;
  out.hasData = true;
  out.opened = totalActive;
  out.completed = totalDone;
  out.openCount = totalOpen;
  out.completionRate = totalActive > 0 ? Math.round((totalDone / totalActive) * 100) : 0;
  return out;
}

async function readTimeClockSnapshot() {
  const out = { totalHoursWeek: 0, overtimeHours: 0, topStaffName: null, hasData: false };
  if (typeof window.ffListTimeEntriesForSalon !== "function") return out;
  try {
    const fromDate = new Date(weekStartMs());
    const entries = await window.ffListTimeEntriesForSalon({
      from: fromDate,
      statuses: ["open", "closed"],
      maxResults: 500,
    });
    if (!Array.isArray(entries) || !entries.length) return out;
    out.hasData = true;
    const byStaff = new Map();
    entries.forEach((e) => {
      const inAt = e && (e.clockInAt || e.clockIn || e.startAt);
      const outAt = e && (e.clockOutAt || e.clockOut || e.endAt);
      const inMs = toMillis(inAt);
      const outMs = toMillis(outAt) || (e && e.status === "open" ? Date.now() : null);
      if (!inMs || !outMs || outMs <= inMs) return;
      const hours = (outMs - inMs) / 3600000;
      out.totalHoursWeek += hours;
      const sid = String(e.staffId || e.staffMemberId || e.uid || "unknown");
      const sname = String(e.staffName || e.name || sid);
      byStaff.set(sid, { name: sname, hours: (byStaff.get(sid)?.hours || 0) + hours });
    });
    // Naive overtime: hours over 40/week per staff.
    byStaff.forEach((v) => {
      if (v.hours > 40) out.overtimeHours += v.hours - 40;
    });
    let top = null;
    byStaff.forEach((v) => { if (!top || v.hours > top.hours) top = v; });
    if (top && top.name) out.topStaffName = top.name;
  } catch (e) {
    console.warn(LOG, "time-clock snapshot failed", e);
  }
  return out;
}

function toMillis(v) {
  if (!v) return null;
  if (typeof v === "number") return v;
  if (typeof v.toMillis === "function") {
    try { return v.toMillis(); } catch (_) { return null; }
  }
  if (typeof v.seconds === "number") return v.seconds * 1000;
  if (typeof v === "string") {
    const p = Date.parse(v);
    return Number.isNaN(p) ? null : p;
  }
  return null;
}

// ---------- Render ----------

function renderKpis(snap) {
  const root = document.getElementById("ffDashKpis");
  if (!root) return;
  const cards = [
    { label: "Tickets today", value: snap.tickets.hasData ? fmtNumber(snap.tickets.todayCount) : "0", foot: "Today" },
    { label: "Tickets this week", value: snap.tickets.hasData ? fmtNumber(snap.tickets.weekCount) : "0", foot: "Last 7 days" },
    { label: "Revenue", value: snap.tickets.hasData && snap.tickets.totalAmount ? fmtCurrency(snap.tickets.totalAmount) : "—", foot: "All visible tickets" },
    { label: "Avg wait time", value: fmtMinutes(snap.queue.avgWaitMin), foot: snap.queue.inQueue ? `${snap.queue.inQueue} in queue now` : "—" },
    { label: "Hours worked", value: snap.time.hasData ? `${snap.time.totalHoursWeek.toFixed(1)}h` : "0h", foot: "This week" },
    { label: "Overtime", value: snap.time.hasData ? `${snap.time.overtimeHours.toFixed(1)}h` : "0h", foot: "Over 40h/week" },
  ];
  root.innerHTML = cards.map((c) => `
    <div class="dash-kpi">
      <div class="dash-kpi-label">${escapeHtml(c.label)}</div>
      <div class="dash-kpi-value">${escapeHtml(c.value)}</div>
      <div class="dash-kpi-foot">${escapeHtml(c.foot)}</div>
    </div>
  `).join("");
}

function renderModuleCards(snap) {
  const root = document.getElementById("ffDashGrid");
  if (!root) return;

  const queueCard = `
    <div class="dash-card">
      <div class="dash-card-header">
        <h3 class="dash-card-title">Queue Flow</h3>
        <span class="dash-card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </span>
      </div>
      <div class="dash-stats">
        <div class="dash-stat"><div class="dash-stat-label">Average wait time</div><div class="dash-stat-value">${escapeHtml(fmtMinutes(snap.queue.avgWaitMin))}</div></div>
        <div class="dash-stat"><div class="dash-stat-label">Longest wait time</div><div class="dash-stat-value">${escapeHtml(fmtMinutes(snap.queue.longestWaitMin))}</div></div>
      </div>
      <div class="dash-meta">
        <div>Busiest day: <b>${escapeHtml(snap.queue.busiestDay || "—")}</b></div>
        <div>Peak hour: <b>${escapeHtml(snap.queue.peakHour == null ? "—" : fmtHourRange(snap.queue.peakHour))}</b></div>
      </div>
      <button type="button" class="dash-link" data-dash-action="queue-analytics">View Queue Analytics →</button>
    </div>
  `;

  const ticketsCard = `
    <div class="dash-card">
      <div class="dash-card-header">
        <h3 class="dash-card-title">Tickets</h3>
        <span class="dash-card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </span>
      </div>
      <div class="dash-stats">
        <div class="dash-stat"><div class="dash-stat-label">Total tickets</div><div class="dash-stat-value">${escapeHtml(fmtNumber(snap.tickets.totalCount))}</div></div>
        <div class="dash-stat"><div class="dash-stat-label">Total amount</div><div class="dash-stat-value">${escapeHtml(snap.tickets.totalAmount ? fmtCurrency(snap.tickets.totalAmount) : "—")}</div></div>
      </div>
      <div class="dash-meta">
        Average ticket: <b>${escapeHtml(snap.tickets.totalCount && snap.tickets.totalAmount ? fmtCurrency(snap.tickets.totalAmount / snap.tickets.totalCount) : "—")}</b>
      </div>
      <button type="button" class="dash-link" data-dash-action="tickets-analytics">View Tickets Analytics →</button>
    </div>
  `;

  const timeCard = `
    <div class="dash-card">
      <div class="dash-card-header">
        <h3 class="dash-card-title">Time Clock</h3>
        <span class="dash-card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </span>
      </div>
      <div class="dash-stats">
        <div class="dash-stat"><div class="dash-stat-label">Total hours</div><div class="dash-stat-value">${snap.time.hasData ? `${snap.time.totalHoursWeek.toFixed(1)}h` : "0h"}</div></div>
        <div class="dash-stat"><div class="dash-stat-label">Overtime</div><div class="dash-stat-value">${snap.time.hasData ? `${snap.time.overtimeHours.toFixed(1)}h` : "0h"}</div></div>
      </div>
      <div class="dash-meta">
        Most hours by: <b>${escapeHtml(snap.time.topStaffName || "—")}</b>
      </div>
      <button type="button" class="dash-link" data-dash-action="time-analytics">View Time Analytics →</button>
    </div>
  `;

  const tasksCard = `
    <div class="dash-card">
      <div class="dash-card-header">
        <h3 class="dash-card-title">Tasks</h3>
        <span class="dash-card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </span>
      </div>
      <div class="dash-stats">
        <div class="dash-stat"><div class="dash-stat-label">Tasks opened</div><div class="dash-stat-value">${escapeHtml(fmtNumber(snap.tasks.opened))}</div></div>
        <div class="dash-stat"><div class="dash-stat-label">Completed</div><div class="dash-stat-value">${escapeHtml(fmtNumber(snap.tasks.completed))}</div></div>
      </div>
      <div class="dash-meta">
        Completion rate: <b>${snap.tasks.completionRate == null ? "—" : `${snap.tasks.completionRate}%`}</b>
        &nbsp;·&nbsp; Open tasks: <b>${escapeHtml(fmtNumber(snap.tasks.openCount))}</b>
      </div>
      <button type="button" class="dash-link" data-dash-action="tasks-analytics">View Tasks Analytics →</button>
    </div>
  `;

  root.innerHTML = queueCard + ticketsCard + timeCard + tasksCard;

  const ANALYTICS_LABELS = {
    "queue-analytics": "Queue Analytics",
    "tickets-analytics": "Tickets Analytics",
    "time-analytics": "Time Analytics",
    "tasks-analytics": "Tasks Analytics",
  };
  const ANALYTICS_ROUTES = {
    "queue-analytics": "goToQueueAnalytics",
  };
  root.querySelectorAll("[data-dash-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const action = btn.getAttribute("data-dash-action");
      const label = ANALYTICS_LABELS[action] || "Analytics";
      console.log(LOG, "analytics link clicked", action);
      const routeFn = ANALYTICS_ROUTES[action];
      if (routeFn && typeof window[routeFn] === "function") {
        try {
          window[routeFn]();
          return;
        } catch (err) {
          console.warn(LOG, "route navigation failed", routeFn, err);
        }
      }
      try {
        if (window.ffToast && typeof window.ffToast.info === "function") {
          window.ffToast.info(`${label} screen — coming soon`, 3500);
        } else if (typeof window.showToast === "function") {
          window.showToast(`${label} screen — coming soon`, 3500);
        }
      } catch (err) {
        console.warn(LOG, "toast failed", err);
      }
    });
  });
}

function buildInsights(snap) {
  const out = [];
  // High wait
  if (Number.isFinite(snap.queue.avgWaitMin) && snap.queue.avgWaitMin >= 20) {
    out.push({ kind: "warn", icon: "⚠️", text: `High wait times detected — average is ${fmtMinutes(snap.queue.avgWaitMin)}.` });
  }
  // Big queue
  if (snap.queue.inQueue >= 8) {
    out.push({ kind: "warn", icon: "⚠️", text: `Long queue — ${snap.queue.inQueue} customers waiting right now.` });
  }
  // Overtime
  if (snap.time.hasData && snap.time.overtimeHours >= 5) {
    out.push({ kind: "warn", icon: "⚠️", text: `High overtime this week — ${snap.time.overtimeHours.toFixed(1)}h beyond 40h/staff.` });
  }
  // Tasks completion
  if (snap.tasks.hasData && snap.tasks.completionRate != null && snap.tasks.completionRate < 50) {
    out.push({ kind: "warn", icon: "⚠️", text: `Tasks completion is low — only ${snap.tasks.completionRate}% completed.` });
  }
  // Positive: nothing pending
  if (!out.length) {
    if (snap.tasks.hasData && snap.tasks.completionRate != null && snap.tasks.completionRate >= 90) {
      out.push({ kind: "good", icon: "✅", text: `Great job — ${snap.tasks.completionRate}% of tasks are completed.` });
    } else {
      out.push({ kind: "info", icon: "ℹ️", text: "No alerts right now. Things look quiet." });
    }
  }
  return out.slice(0, 4);
}

function renderInsights(snap) {
  const root = document.getElementById("ffDashInsights");
  if (!root) return;
  const items = buildInsights(snap);
  root.innerHTML = items.map((i) => {
    const cls = i.kind === "good" ? "is-good" : i.kind === "info" ? "is-info" : "";
    return `
      <li class="dash-insight ${cls}">
        <span class="dash-insight-ico" aria-hidden="true">${escapeHtml(i.icon)}</span>
        <span>${escapeHtml(i.text)}</span>
      </li>
    `;
  }).join("");
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function refresh() {
  const screen = document.getElementById(SCREEN_ID);
  if (!screen || screen.style.display === "none") return;
  console.log(LOG, "refresh");
  const snap = {
    tickets: readTicketsSnapshot(),
    queue: readQueueSnapshot(),
    tasks: readTasksSnapshot(),
    time: { totalHoursWeek: 0, overtimeHours: 0, topStaffName: null, hasData: false },
  };
  // Render now with sync data, then patch in time-clock async.
  renderKpis(snap);
  renderModuleCards(snap);
  renderInsights(snap);
  try {
    snap.time = await readTimeClockSnapshot();
    renderKpis(snap);
    renderModuleCards(snap);
    renderInsights(snap);
  } catch (e) {
    console.warn(LOG, "async time refresh failed", e);
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
      const navBtn = document.getElementById(NAV_BTN_ID);
      if (navBtn) navBtn.classList.remove("active");
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
  const btn = document.getElementById(NAV_BTN_ID);
  if (btn) btn.classList.add("active");

  refresh();

  if (_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = setInterval(() => { refresh(); }, 30000);
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
  }

  console.log(LOG, "init complete");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
