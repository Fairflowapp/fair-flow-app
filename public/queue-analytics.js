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
 *   C — Activity by Hour (grid: hour range, activity count)
 *   D — Auto Insights (text bullets)
 *
 * Logging prefix: [QueueAnalytics]
 */

const LOG = "[QueueAnalytics]";
const BH_LOG = "[QueueAnalytics BusinessHours]";
const V2_LOG = "[QueueAnalytics V2]";
const SCREEN_ID = "queueAnalyticsScreen";

let _injected = false;

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
      <p class="qa-sub">Understand wait times, flow, and peak hours</p>

      <div class="qa-section-title">Summary</div>
      <div id="ffQaSummary" class="qa-summary"></div>

      <div class="qa-section-title">Wait time by day</div>
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
    return { ts, action, worker };
  }
  if (typeof entry !== "string") return null;
  const m = entry.match(/^(\d{1,2}\/\d{1,2}\/\d{4}),\s*([\d:]+\s*[AP]M)\s*(.*)$/);
  if (!m) return null;
  const [, dateStr, timeStr, rest] = m;
  const ts = Date.parse(`${dateStr} ${timeStr}`);
  if (!Number.isFinite(ts)) return null;
  const action = (rest || "").trim();
  return { ts, action, worker: _qaExtractWorker(action) };
}

// Compute the full breakdown needed for sections A-D.
function computeQueueAnalytics(fromMs) {
  const result = {
    sourceFound: false,
    activityCount: 0,
    waitCount: 0,
    avgWaitMin: null,
    longestWaitMin: null,
    busiestDay: null,
    peakHour: null,
    byDay: [],   // { dayIdx, dayName, count, avgWaitMin, longestWaitMin }
    byHour: [],  // { hour, count } from service starts inside business hours
    byDayHour: [], // { dayIdx, dayName, isOpen, hours:[{hour,starts,idleMinutes}] }
    businessHours: null,
    totalStarts: 0,
    totalIdleMinutes: 0,
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

  // Parse + chronological order.
  const parsed = [];
  for (let i = raw.length - 1; i >= 0; i -= 1) {
    const p = _qaParseEntry(raw[i]);
    if (p && p.ts >= fromMs) parsed.push(p);
  }
  if (!parsed.length) {
    console.log(LOG, "no events in range");
    return result;
  }

  const businessHours = resolveBusinessHoursForWeek();
  result.businessHours = businessHours;
  const businessByDay = new Map((businessHours.byDay || []).map((d) => [d.dayIdx, d]));

  const dayBuckets = new Map(); // day → { count, waits: [] }
  const hourBuckets = new Map(); // hour → START count (business-hours only)
  const dayHourStartBuckets = new Map(); // "dayIdx|hour" → START count
  const dayHourIdleBuckets = new Map(); // "dayIdx|hour" → idle minutes
  const lastJoinAt = new Map();
  const seenEvents = new Set();
  const allWaits = [];

  function addIdleIntervalToBusinessHours(joinedAt, startedAt) {
    if (!Number.isFinite(joinedAt) || !Number.isFinite(startedAt) || startedAt <= joinedAt) return;
    const cursor = new Date(joinedAt);
    cursor.setMinutes(0, 0, 0);
    while (cursor.getTime() < startedAt) {
      const hourStart = cursor.getTime();
      const hourEnd = hourStart + 3600000;
      const segStart = Math.max(joinedAt, hourStart);
      const segEnd = Math.min(startedAt, hourEnd);
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
            dayHourIdleBuckets.set(key, (dayHourIdleBuckets.get(key) || 0) + minutes);
            result.totalIdleMinutes += minutes;
          }
        }
      }
      cursor.setHours(cursor.getHours() + 1);
    }
  }

  parsed.forEach((ev) => {
    const kind = _qaActionKind(ev.action);
    if (!kind) return;
    const w = (ev.worker || "").toLowerCase();
    const dedupeKey = `${kind}|${w || ev.action.toLowerCase()}|${Math.round(ev.ts / 5000)}`;
    if (seenEvents.has(dedupeKey)) return;
    seenEvents.add(dedupeKey);
    result.activityCount += 1;
    const d = new Date(ev.ts);
    const dayKey = d.getDay();
    const hourKey = d.getHours();

    if (!dayBuckets.has(dayKey)) dayBuckets.set(dayKey, { count: 0, waits: [] });
    dayBuckets.get(dayKey).count += 1;
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
      lastJoinAt.set(w, ev.ts);
    } else if (kind === "start" && w) {
      if (isInsideBusinessHours) {
        hourBuckets.set(hourKey, (hourBuckets.get(hourKey) || 0) + 1);
        dayHourStartBuckets.set(dayHourKey, (dayHourStartBuckets.get(dayHourKey) || 0) + 1);
        result.totalStarts += 1;
      }
      const joinedAt = lastJoinAt.get(w);
      if (Number.isFinite(joinedAt) && ev.ts > joinedAt) {
        const minutes = (ev.ts - joinedAt) / 60000;
        allWaits.push(minutes);
        addIdleIntervalToBusinessHours(joinedAt, ev.ts);
        // Bucket by the day the wait STARTED (joinedAt).
        const startDay = new Date(joinedAt).getDay();
        if (!dayBuckets.has(startDay)) dayBuckets.set(startDay, { count: 0, waits: [] });
        dayBuckets.get(startDay).waits.push(minutes);
        lastJoinAt.delete(w);
      }
    } else if (kind === "finish" && w) {
      lastJoinAt.delete(w);
    }
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
    });
  });
  dayRows.sort((a, b) => a.dayIdx - b.dayIdx);
  result.byDay = dayRows;

  // Hour rows.
  const hourRows = [];
  hourBuckets.forEach((count, hour) => hourRows.push({ hour, count }));
  hourRows.sort((a, b) => a.hour - b.hour);
  result.byHour = hourRows;

  result.byDayHour = (businessHours.byDay || []).map((day) => ({
    dayIdx: day.dayIdx,
    dayName: day.dayName,
    isOpen: day.isOpen,
    openTime: day.openTime,
    closeTime: day.closeTime,
    hours: day.isOpen
      ? day.hours.map((hour) => ({
        hour,
        starts: dayHourStartBuckets.get(`${day.dayIdx}|${hour}`) || 0,
        idleMinutes: dayHourIdleBuckets.get(`${day.dayIdx}|${hour}`) || 0,
      }))
      : [],
  }));

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
    idleMinutes: result.totalIdleMinutes,
  });
  console.log(V2_LOG, "start events detected", { starts: result.totalStarts });
  console.log(V2_LOG, "idle events calculated", { waitPairs: allWaits.length, idleMinutes: result.totalIdleMinutes });
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

function fmtCompactMinutes(min) {
  if (!Number.isFinite(min) || min <= 0) return "0m";
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
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
        <li class="qa-insight is-info"><span aria-hidden="true">ℹ️</span><span>Queue activity is currently low. Insights will appear once events are logged.</span></li>
      </ul>
    `;
  }
}

function renderSummary(metrics) {
  const root = document.getElementById("ffQaSummary");
  if (!root) return;
  const cards = [
    { label: "Average wait time", value: fmtMinutes(metrics.avgWaitMin), foot: "This week" },
    { label: "Longest wait time", value: fmtMinutes(metrics.longestWaitMin), foot: "This week" },
    { label: "Wait events", value: String(metrics.waitCount || 0), foot: "join → start pairs" },
    { label: "Busiest day", value: metrics.busiestDay || "—", foot: "By queue load" },
    { label: "Peak hour", value: metrics.peakHour == null ? "—" : fmtHourRange(metrics.peakHour), foot: "By service starts" },
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
    root.innerHTML = '<div style="color:#6b7280;font-size:13px;">No day-level activity yet.</div>';
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
          <th class="num">Queue Load</th>
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

function renderByHour(metrics) {
  const root = document.getElementById("ffQaByHour");
  if (!root) return;
  const dayRows = metrics.byDayHour || [];
  if (!dayRows.length) {
    root.innerHTML = '<div style="color:#6b7280;font-size:13px;">No hourly activity yet.</div>';
    return;
  }
  const peak = metrics.peakHour;
  root.innerHTML = `
    <div>
      ${dayRows.map((day, idx) => `
        <details class="qa-hour-day" ${idx === new Date().getDay() ? "open" : ""}>
          <summary class="qa-hour-day-title">
            <span>${escapeHtml(day.dayName)} ▼</span>
            <span class="qa-hour-day-hours">${day.isOpen ? `${escapeHtml(day.openTime)}–${escapeHtml(day.closeTime)}` : "Closed"}</span>
          </summary>
          ${day.isOpen ? `
            <div class="qa-hour-day-body">
              <div>
                <div class="qa-metric-title">Service Starts</div>
                <div class="qa-hour-grid">
                  ${day.hours.map((r) => `
                    <div class="qa-hour-tile ${r.hour === peak && r.starts > 0 ? "is-peak" : ""}">
                      <div class="qa-hour-tile-label">${escapeHtml(fmtHourRange(r.hour))}</div>
                      <div class="qa-hour-tile-value">${escapeHtml(String(r.starts))}</div>
                    </div>
                  `).join("")}
                </div>
              </div>
              <div>
                <div class="qa-metric-title">Idle Time</div>
                ${metrics.waitCount > 0 ? `
                  <div class="qa-hour-grid">
                    ${day.hours.map((r) => `
                      <div class="qa-hour-tile ${r.idleMinutes >= 30 ? "is-peak" : ""}">
                        <div class="qa-hour-tile-label">${escapeHtml(fmtHourRange(r.hour))}</div>
                        <div class="qa-hour-tile-value">${escapeHtml(fmtCompactMinutes(r.idleMinutes))}</div>
                      </div>
                    `).join("")}
                  </div>
                ` : '<div class="qa-closed">Not enough data yet</div>'}
              </div>
            </div>
          ` : '<div class="qa-hour-day-body"><div class="qa-closed">Closed</div></div>'}
        </details>
      `).join("")}
    </div>
  `;
}

function buildInsights(metrics) {
  const out = [];
  if (!metrics.sourceFound || (metrics.activityCount === 0 && metrics.waitCount === 0)) {
    out.push({ kind: "info", icon: "ℹ️", text: "Queue activity is currently low. Insights will appear once events are logged." });
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
  let highestIdle = null;
  let morningIdleMinutes = 0;
  (metrics.byDayHour || []).forEach((day) => {
    (day.hours || []).forEach((hour) => {
      if (hour.hour < 12) morningIdleMinutes += hour.idleMinutes || 0;
      if (!highestIdle || (hour.idleMinutes || 0) > highestIdle.idleMinutes) {
        highestIdle = { ...hour, dayName: day.dayName };
      }
    });
  });
  if (morningIdleMinutes >= 30) {
    out.push({
      kind: "warn",
      icon: "⚠️",
      text: `High idle time detected in morning (${fmtCompactMinutes(morningIdleMinutes)}).`,
    });
  } else if (highestIdle && highestIdle.idleMinutes >= 30) {
    out.push({
      kind: "warn",
      icon: "⚠️",
      text: `High idle time around ${fmtHourRange(highestIdle.hour)} (${fmtCompactMinutes(highestIdle.idleMinutes)}).`,
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
      text: `Longest wait this week reached ${fmtMinutes(metrics.longestWaitMin)}.`,
    });
  }
  if (!out.length) {
    if (metrics.waitCount === 0 && metrics.activityCount > 0) {
      out.push({ kind: "info", icon: "ℹ️", text: "Activity recorded, but no completed join → start pairs yet." });
    } else {
      out.push({ kind: "good", icon: "✅", text: "Queue is flowing smoothly. No bottlenecks detected this week." });
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

function refresh() {
  const screen = document.getElementById(SCREEN_ID);
  if (!screen || screen.style.display === "none") return;
  let metrics;
  try {
    metrics = computeQueueAnalytics(_qaWeekStartMs());
  } catch (e) {
    console.warn(LOG, "error calculating metrics", e);
    renderEmpty();
    return;
  }
  if (!metrics.sourceFound || (metrics.activityCount === 0 && metrics.waitCount === 0)) {
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
