/**
 * Dashboard — data layer.
 *
 * Owns every read path for the Dashboard screen: window-global + localStorage
 * snapshot readers (tickets/queue/tasks/time-clock), the location-scope reader,
 * and the self-contained queue-metrics engine that parses window.log. Also owns
 * the pure date/array/millis helpers the readers depend on (so this module has
 * no outward imports and there is no circular dependency with compute). No
 * direct Firestore. Extracted verbatim from dashboard.js.
 */

export const LOG = "[Dashboard]";
export const LOC_LOG = "[Dashboard LocationScope]";
const QM_LOG_PREFIX = "[Dashboard QueueMetrics]";
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

export function getDashboardLocationScope() {
  let id = "";
  try {
    if (typeof window.ffGetActiveLocationId === "function") id = String(window.ffGetActiveLocationId() || "").trim();
  } catch (_) {}
  if (!id) {
    try { id = String(window.__ff_active_location_id || window.activeLocationId || window.currentLocationId || "").trim(); } catch (_) {}
  }
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
    label: id ? `${name || id}` : "Select location",
    hasLocation: !!id,
  };
}

function recordMatchesDashboardLocation(record, scope) {
  if (!scope?.hasLocation) return false;
  const loc = String(record?.locationId || record?.locId || record?.branchId || "").trim();
  return !!loc && loc === scope.id;
}

function logDashboardScope(source, scope, before, after, skippedNoLocation) {
  console.log(LOC_LOG, source, {
    activeLocationId: scope?.id || "",
    recordsBeforeFilter: before,
    recordsAfterFilter: after,
    skippedRecordsWithoutLocationId: skippedNoLocation,
  });
}

export function todayStartMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfTodayMs() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function weekStartMs() {
  const d = new Date();
  const day = d.getDay(); // 0 = Sunday
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}

export function monthStartMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d.getTime();
}

export function parseLocalDateStartMs(value) {
  const s = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function parseLocalDateEndMs(value) {
  const s = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T23:59:59.999`);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function inDashboardRange(ms, range) {
  return Number.isFinite(ms) && ms >= range.startMs && ms <= range.endMs;
}

function eventMillis(v) {
  return toMillis(v);
}

export async function readTicketsSnapshot(range) {
  const out = { rangeCount: 0, todayCount: 0, weekCount: 0, totalCount: 0, totalAmount: 0, hasData: false };
  const scope = getDashboardLocationScope();
  let list = [];
  if (Array.isArray(window.currentTickets)) list = window.currentTickets;
  else if (Array.isArray(window.allTickets)) list = window.allTickets;
  else if (Array.isArray(window.ticketsCache)) list = window.ticketsCache;
  if (!list.length && typeof window.ffGetCurrentTickets === "function") {
    try {
      const visibleTickets = window.ffGetCurrentTickets();
      if (Array.isArray(visibleTickets)) list = visibleTickets;
    } catch (err) {
      console.warn(LOG, "ffGetCurrentTickets failed", err);
    }
  }
  if (!list.length && typeof window.ffLoadTicketsForAnalytics === "function") {
    try {
      const loadedTickets = await window.ffLoadTicketsForAnalytics();
      if (Array.isArray(loadedTickets)) list = loadedTickets;
    } catch (err) {
      console.warn(LOG, "ffLoadTicketsForAnalytics failed", err);
    }
  }
  if (!list.length) return out;
  const before = list.length;
  let skippedNoLocation = 0;
  list = list.filter((ticket) => {
    const loc = String(ticket?.locationId || "").trim();
    if (!loc) {
      skippedNoLocation += 1;
      return false;
    }
    return scope.hasLocation && loc === scope.id;
  });
  logDashboardScope("tickets", scope, before, list.length, skippedNoLocation);
  if (!scope.hasLocation || !list.length) return out;

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
      if (!range || inDashboardRange(ms, range)) {
        out.rangeCount += 1;
        const amt = Number(t && (t.totalAmount ?? t.total ?? t.amount));
        if (Number.isFinite(amt)) out.totalAmount += amt;
      }
    }
  });
  out.totalCount = out.rangeCount;
  return out;
}

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

function _qmParseEntry(entry) {
  if (entry == null) return null;
  if (typeof entry === "object") {
    const source = String(entry.source || "queue").toLowerCase();
    if (source !== "queue") return null;
    const ts = Number(entry.ts || entry.timestamp);
    if (!Number.isFinite(ts)) return null;
    const action = String(entry.action || entry.actionText || "").trim();
    const worker = String(entry.worker || entry.assignedTo || "").trim();
    const typedAction = entry.type === "queue_check_out" ? `${action} queue_check_out` : action;
    const locationId = String(entry.locationId || entry.locId || "").trim();
    return { ts, action: typedAction, worker, locationId };
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
  return { ts, action, worker, locationId: "" };
}

function _qmExtractWorker(action) {
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

function _qmActionKind(action) {
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

function computeQueueMetrics(fromMs, endMs = Date.now()) {
  const scope = getDashboardLocationScope();
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

  // Parse + chronological order. Legacy forced-log entries used unshift()
  // (newest-first), while newer queue/history entries use push()
  // (oldest-first). Sort by timestamp so join → START pairs resolve
  // correctly regardless of write path.
  const parsed = [];
  let skippedNoLocation = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const p = _qmParseEntry(raw[i]);
    if (!p || p.ts < fromMs || p.ts > endMs) continue;
    if (!p.locationId) {
      skippedNoLocation += 1;
      continue;
    }
    if (scope.hasLocation && p.locationId === scope.id) parsed.push(p);
  }
  logDashboardScope("queue-events", scope, raw.length, parsed.length, skippedNoLocation);
  parsed.sort((a, b) => a.ts - b.ts);
  if (!parsed.length) {
    console.log(QM_LOG_PREFIX, "no events in range");
    return result;
  }

  const dayCounts = new Map();
  const hourCounts = new Map();
  const staffStates = new Map();
  const seenEvents = new Set();
  const waits = [];

  function closeIdle(state, ts) {
    if (!state || !Number.isFinite(state.idleStart) || ts <= state.idleStart) {
      if (state) state.idleStart = null;
      return;
    }
    state.waitMinutes += (ts - state.idleStart) / 60000;
    state.idleStart = null;
  }

  function recordCompletedWait(state) {
    if (!state || !Number.isFinite(state.waitMinutes) || state.waitMinutes <= 0) return;
    waits.push(state.waitMinutes);
    state.waitMinutes = 0;
    state.joinedAt = null;
  }

  function createAvailableState(ts) {
    return {
      joinedAt: ts,
      idleStart: ts,
      waitMinutes: 0,
      inService: false,
      onHold: false,
    };
  }

  parsed.forEach((ev) => {
    const kind = _qmActionKind(ev.action);
    if (!kind) return;
    const w = (ev.worker || "").toLowerCase();
    const dedupeKey = `${kind}|${w || ev.action.toLowerCase()}|${Math.round(ev.ts / 5000)}`;
    if (seenEvents.has(dedupeKey)) return;
    seenEvents.add(dedupeKey);
    result.activityCount += 1;
    const d = new Date(ev.ts);
    const dayKey = d.getDay();
    const hourKey = d.getHours();
    dayCounts.set(dayKey, (dayCounts.get(dayKey) || 0) + 1);
    hourCounts.set(hourKey, (hourCounts.get(hourKey) || 0) + 1);
    if (kind === "join" && w) {
      const existing = staffStates.get(w);
      if (existing) closeIdle(existing, ev.ts);
      staffStates.set(w, createAvailableState(ev.ts));
    } else if (kind === "start" && w) {
      let state = staffStates.get(w);
      if (!state) {
        state = {
          joinedAt: null,
          idleStart: null,
          waitMinutes: 0,
          inService: false,
          onHold: false,
        };
        staffStates.set(w, state);
      }
      closeIdle(state, ev.ts);
      recordCompletedWait(state);
      state.inService = true;
      state.onHold = false;
    } else if (kind === "finish" && w) {
      let state = staffStates.get(w);
      if (state) {
        state.inService = false;
        state.onHold = false;
        state.joinedAt = ev.ts;
        state.idleStart = ev.ts;
      } else {
        staffStates.set(w, createAvailableState(ev.ts));
      }
    } else if (kind === "hold" && w) {
      const state = staffStates.get(w);
      if (state && !state.onHold) {
        closeIdle(state, ev.ts);
        state.onHold = true;
      }
    } else if (kind === "release" && w) {
      const state = staffStates.get(w);
      if (state) {
        state.onHold = false;
        if (!state.inService) state.idleStart = ev.ts;
      }
    } else if (kind === "checkout" && w) {
      const state = staffStates.get(w);
      if (state) {
        closeIdle(state, ev.ts);
        recordCompletedWait(state);
        staffStates.delete(w);
      }
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

export function readQueueSnapshot(range) {
  const scope = getDashboardLocationScope();
  const rawQ = safeArr(window.queue);
  const rawService = safeArr(window.service);
  let skippedNoLocation = 0;
  const filterQueueRows = (rows) => rows.filter((row) => {
    const loc = String(row?.locationId || row?.locId || "").trim();
    if (!loc) {
      // queue-cloud already subscribes to salons/{salonId}/queueState/{activeLocationId};
      // legacy rows from that scoped document may not carry locationId.
      return scope.hasLocation;
    }
    return scope.hasLocation && loc === scope.id;
  });
  const q = filterQueueRows(rawQ);
  const service = filterQueueRows(rawService);
  logDashboardScope("queue-live", scope, rawQ.length + rawService.length, q.length + service.length, skippedNoLocation);
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
    const metrics = computeQueueMetrics(range?.startMs || weekStartMs(), range?.endMs || Date.now());
    out.avgWaitMin = metrics.avgWaitMin;
    out.longestWaitMin = metrics.longestWaitMin;
    out.busiestDay = metrics.busiestDay;
    out.peakHour = metrics.peakHour;
  } catch (e) {
    console.warn(QM_LOG_PREFIX, "error calculating metrics", e);
  }
  return out;
}

export function readTasksSnapshot(range) {
  const scope = getDashboardLocationScope();
  const out = { opened: 0, completed: 0, openCount: 0, completionRate: null, hasData: false };
  const tabs = ["opening", "closing", "weekly", "monthly", "yearly"];
  const rows = [];
  const pushRows = (tab, kind, list, scopedByStorage = false) => {
    if (!Array.isArray(list)) return;
    list.forEach((task) => {
      if (!task || typeof task !== "object") return;
      rows.push({ ...task, __tab: tab, __kind: kind, __scopedByStorage: scopedByStorage });
    });
  };
  const cache = window.tasksCache;
  if (cache && typeof cache === "object") {
    tabs.forEach((tab) => {
      const v = cache[tab];
      if (Array.isArray(v)) {
        pushRows(tab, "active", v, false);
      } else if (v && typeof v === "object") {
        pushRows(tab, "active", Array.isArray(v.active) ? v.active : v.items, false);
        pushRows(tab, "pending", v.pending, false);
        pushRows(tab, "done", v.done, false);
      }
    });
  }
  // Current Tasks storage is already location-scoped by tasks-cloud.js, so rows
  // generally do not carry locationId. Use it as the primary fallback/source.
  try {
    tabs.forEach((tab) => {
      ["active", "pending", "done"].forEach((kind) => {
        const raw = localStorage.getItem(`ff_tasks_${tab}_${kind}_v1`);
        const list = raw ? JSON.parse(raw) : [];
        pushRows(tab, kind, Array.isArray(list) ? list : [], true);
      });
    });
  } catch (e) {
    console.warn(LOG, "tasks localStorage read failed", e);
  }
  if (!rows.length) return out;
  let before = 0;
  let skippedNoLocation = 0;
  let scopedCount = 0;
  let totalDone = 0;
  let totalOpen = 0;
  const seen = new Map();
  rows.forEach((task, index) => {
    before += 1;
    const loc = String(task.locationId || task.locId || "").trim();
    if (!task.__scopedByStorage) {
      if (!loc) {
        skippedNoLocation += 1;
        return;
      }
      if (!scope.hasLocation || loc !== scope.id) return;
    }
    const id = String(task.taskId || task.id || `${task.__tab}:${task.__kind}:${task.title || index}`).trim();
    const key = `${task.__tab || "task"}:${id}`;
    const status = String(task.status || task.state || "").toLowerCase();
    const taskMs = eventMillis(
      task.completedAt || task.doneAt || task.updatedAt || task.createdAt || task.createdAtMs || task.ts || task.timestamp
    );
    if (taskMs && range && !inDashboardRange(taskMs, range)) return;
    const isDone = task.__kind === "done" || status === "done" || status === "completed" || task.completed === true || !!task.completedAt || !!task.doneAt;
    const isPending = task.__kind === "pending" || status === "pending" || !!task.assignedTo;
    const current = seen.get(key) || { done: false, pending: false };
    current.done = current.done || isDone;
    current.pending = current.pending || isPending;
    seen.set(key, current);
  });
  seen.forEach((task) => {
    scopedCount += 1;
    if (task.done) totalDone += 1;
    else totalOpen += 1;
  });
  logDashboardScope("tasks", scope, before, scopedCount, skippedNoLocation);
  if (!scopedCount) return out;
  out.hasData = true;
  out.opened = scopedCount;
  out.completed = totalDone;
  out.openCount = totalOpen;
  out.completionRate = scopedCount > 0 ? Math.round((totalDone / scopedCount) * 100) : 0;
  return out;
}

export async function readTimeClockSnapshot(range) {
  const out = { totalHours: 0, overtimeHours: 0, topStaffName: null, hasData: false };
  const scope = getDashboardLocationScope();
  if (!scope.hasLocation) {
    logDashboardScope("time-clock", scope, 0, 0, 0);
    return out;
  }
  if (typeof window.ffListTimeEntriesForSalon !== "function") return out;
  try {
    const fromDate = new Date(range?.startMs || weekStartMs());
    const entries = await window.ffListTimeEntriesForSalon({
      from: fromDate,
      locationId: scope.id,
      statuses: ["open", "closed"],
      maxResults: 500,
    });
    if (!Array.isArray(entries) || !entries.length) return out;
    const skippedNoLocation = entries.filter((entry) => !String(entry?.locationId || "").trim()).length;
    const scopedEntries = entries.filter((entry) => recordMatchesDashboardLocation(entry, scope));
    logDashboardScope("time-clock", scope, entries.length, scopedEntries.length, skippedNoLocation);
    if (!scopedEntries.length) return out;
    out.hasData = true;
    const byStaff = new Map();
    scopedEntries.forEach((e) => {
      const inAt = e && (e.clockInAt || e.clockIn || e.startAt);
      const outAt = e && (e.clockOutAt || e.clockOut || e.endAt);
      const inMs = toMillis(inAt);
      const outMs = toMillis(outAt) || (e && e.status === "open" ? Date.now() : null);
      if (!inMs || !outMs || outMs <= inMs) return;
      const startMs = Math.max(inMs, range?.startMs || inMs);
      const endMs = Math.min(outMs, range?.endMs || outMs);
      if (endMs <= startMs) return;
      const hours = (endMs - startMs) / 3600000;
      out.totalHours += hours;
      const sid = String(e.staffId || e.staffMemberId || e.uid || "unknown");
      const sname = resolveDashboardStaffName(sid, e.staffName || e.name || "");
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

function resolveDashboardStaffName(staffId, fallback = "") {
  const sid = String(staffId || "").trim();
  const direct = String(fallback || "").trim();
  if (direct && direct !== sid) return direct;
  const readName = (row) => {
    const id = String(row?.id || row?.staffId || row?.uid || row?.firebaseUid || "").trim();
    if (!sid || id !== sid) return "";
    return String(row?.name || row?.staffName || row?.displayName || row?.email || "").trim();
  };
  try {
    const store = typeof window.ffGetStaffStore === "function" ? window.ffGetStaffStore() : null;
    const list = Array.isArray(store?.staff) ? store.staff : [];
    for (const row of list) {
      const name = readName(row);
      if (name) return name;
    }
  } catch (err) {
    console.warn(LOG, "staff name helper failed", err);
  }
  try {
    const store = JSON.parse(localStorage.getItem("ff_staff_v1") || "{}");
    const list = Array.isArray(store?.staff) ? store.staff : [];
    for (const row of list) {
      const name = readName(row);
      if (name) return name;
    }
  } catch (_) {}
  return sid && sid !== "unknown" ? "Unknown staff" : "—";
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
