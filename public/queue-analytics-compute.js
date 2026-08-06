/**
 * Queue Analytics — compute engine (pure logic, no DOM).
 *
 * The analytics core: log parsing, business-hours resolution, staff-type
 * resolution, the computeQueueAnalytics aggregator, value formatters and
 * type-row transforms. Extracted verbatim from queue-analytics.js. Reads its
 * data only via the data-readers module; no Firestore, no DOM.
 */

import {
  _qaActiveLocationId,
  _qaLocationScope,
  _qaReadSettingsBusinessHours,
  _qaReadRawLog,
  _qaReadStaffList,
} from "./queue-analytics-data.js?v=20260625_queue_analytics_split";

export const LOG = "[QueueAnalytics]";
const BH_LOG = "[QueueAnalytics BusinessHours]";
export const LOC_LOG = "[QueueAnalytics LocationScope]";
const V2_LOG = "[QueueAnalytics V2]";
const TYPES_LOG = "[QueueAnalytics Types]";
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function _qaLogScope(source, scope, before, after, skippedNoLocation) {
  console.log(LOC_LOG, source, {
    activeLocationId: scope?.id || "",
    recordsBeforeFilter: before,
    recordsAfterFilter: after,
    skippedRecordsWithoutLocationId: skippedNoLocation,
  });
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
    const locationId = String(entry.locationId || entry.locId || "").trim();
    return { ts, action: typedAction, worker, staffId, locationId };
  }
  if (typeof entry !== "string") return null;
  const m = entry.match(/^(\d{1,2}\/\d{1,2}\/\d{4}),\s*([\d:]+\s*[AP]M)\s*(.*)$/);
  if (!m) return null;
  const [, dateStr, timeStr, rest] = m;
  const ts = Date.parse(`${dateStr} ${timeStr}`);
  if (!Number.isFinite(ts)) return null;
  const action = (rest || "").trim();
  return { ts, action, worker: _qaExtractWorker(action), staffId: "", locationId: "" };
}

export function computeQueueAnalytics(fromMs, toMs = Date.now()) {
  const scope = _qaLocationScope();
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
    activeLocationId: scope.id,
    locationLabel: scope.label,
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
  let skippedNoLocation = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const p = _qaParseEntry(raw[i]);
    if (!p || p.ts > toMs) continue;
    if (!p.locationId) {
      skippedNoLocation += 1;
      continue;
    }
    if (scope.hasLocation && p.locationId === scope.id) parsed.push(p);
  }
  _qaLogScope("queue-events", scope, raw.length, parsed.length, skippedNoLocation);
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

  function addMinutesIntervalToBusinessHours(startedAt, endedAt, onOverlap, options = {}) {
    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) return;
    const includeOutsideHours = options && options.includeOutsideHours === true;
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
        if (includeOutsideHours) {
          const minutes = (segEnd - segStart) / 60000;
          const key = `${dayKey}|${hourKey}`;
          onOverlap({ key, dayKey, hourKey, dateKey: dateKeyFromMs(hourStart), minutes });
        } else if (isBusinessHour) {
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
    }, { includeOutsideHours: true });
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

  function addActiveInterval(state, startedAt, endedAt, includeOutsideHours = true) {
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
    }, { includeOutsideHours });
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

  function closeActive(state, ts, includeOutsideHours = true) {
    if (!state || !Number.isFinite(state.activeStart) || ts <= state.activeStart) {
      if (state) state.activeStart = null;
      return;
    }
    addActiveInterval(state, state.activeStart, ts, includeOutsideHours);
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
      if (eventInRange) {
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
    closeActive(state, toMs, false);
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
    const activityHours = new Set();
    [dayHourStartBuckets, dayHourIdleBuckets, dayHourActiveStaff].forEach((bucket) => {
      bucket.forEach((_, key) => {
        const [dayPart, hourPart] = String(key).split("|");
        if (Number(dayPart) === day.dayIdx) activityHours.add(Number(hourPart));
      });
    });
    const displayHours = Array.from(new Set([...(day.hours || []), ...Array.from(activityHours)])).sort((a, b) => a - b);
    const hours = displayHours
      .map((hour) => {
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
      });
    const totalStaff = dayBuckets.get(day.dayIdx)?.staff?.size || 0;
    return {
      dayIdx: day.dayIdx,
      dayName: day.dayName,
      isOpen: day.isOpen,
      openTime: day.openTime,
      closeTime: day.closeTime,
      hasActivityOutsideHours: Array.from(activityHours).some((hour) => !(day.hours || []).includes(hour)),
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

export function fmtMinutes(min) {
  if (!Number.isFinite(min) || min <= 0) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function fmtIdleMinutes(min) {
  if (!Number.isFinite(min) || min <= 0) return "0m";
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function fmtStaffAverage(value) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
}

export function fmtHourRange(hour24) {
  if (!Number.isFinite(hour24) || hour24 < 0 || hour24 > 23) return "—";
  const next = (hour24 + 1) % 24;
  const labelFull = (h) => {
    if (h === 0) return "12 AM";
    if (h === 12) return "12 PM";
    return h < 12 ? `${h} AM` : `${h - 12} PM`;
  };
  return `${labelFull(hour24).replace(/ AM| PM/, "")}–${labelFull(next)}`;
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

export function buildWaitTimeTypeRows(hour) {
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

export function formatTypeBreakdown(rows, formatter = (value) => String(value || 0)) {
  const cleanRows = Array.isArray(rows) && rows.length ? rows : [{ type: "Other", count: 0 }];
  return cleanRows.map((row) => `${row.type || "Other"}: ${formatter(row.count || 0)}`).join("; ");
}
