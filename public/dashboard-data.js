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

/** Salon has more than one branch — same gate as History / Points. */
export function dashboardUserHasMultipleLocations() {
  try {
    if (typeof window.ffUserHasMultipleLocations === "function" && window.ffUserHasMultipleLocations()) return true;
    if (typeof window.ffGetLocations === "function") {
      const locs = (window.ffGetLocations() || []).filter((l) => l && l.isActive !== false);
      if (locs.length > 1) return true;
    }
  } catch (_) {}
  return false;
}

function dashboardPrimaryLocationId() {
  try {
    const w = typeof window !== "undefined" ? window : {};
    if (typeof w.ffResolveCurrentStaff === "function" && typeof w.ffEnsureStaffLocationFields === "function") {
      const row = w.ffResolveCurrentStaff();
      if (row) {
        const f = w.ffEnsureStaffLocationFields(row);
        const primary = typeof f.primaryLocationId === "string" ? f.primaryLocationId.trim() : "";
        if (primary) return primary;
      }
    }
    if (typeof w.ffGetUserAllowedLocations === "function") {
      const locs = w.ffGetUserAllowedLocations();
      if (Array.isArray(locs) && locs[0] && locs[0].id) return String(locs[0].id).trim();
    }
  } catch (_) {}
  return "";
}

function dashboardRecordLocationId(record) {
  if (!record || typeof record !== "object") return "";
  return String(record.locationId || record.locId || record.branchId || "").trim();
}

/**
 * Canonical branch gate for every Dashboard record.
 * Stamped id must equal the active location. Unstamped / legacy rows are
 * visible only on a single-location account, or on the primary location
 * when the salon has multiple branches. No active location + multi = hide.
 */
export function dashboardRecordInActiveLoc(record, scope = getDashboardLocationScope()) {
  const multi = dashboardUserHasMultipleLocations();
  const active = String(scope?.id || "").trim();
  if (!active) return !multi;
  const stamped = dashboardRecordLocationId(record);
  if (stamped) return stamped === active;
  if (!multi) return true;
  const primary = dashboardPrimaryLocationId();
  return !!primary && active === primary;
}

/** Drop unstamped leftovers when a snapshot still holds another branch. */
function filterRowsToActiveLocation(rows, scope) {
  const list = safeArr(rows);
  const active = String(scope?.id || "").trim();
  const hasForeignStamp = list.some((row) => {
    const loc = dashboardRecordLocationId(row);
    return loc && loc !== active;
  });
  return list.filter((row) => {
    const loc = dashboardRecordLocationId(row);
    if (loc) return loc === active;
    if (hasForeignStamp) return false;
    return dashboardRecordInActiveLoc(row, scope);
  });
}

function isCompletedTicketStatus(status) {
  const s = String(status || "").toUpperCase();
  return !s || s === "CLOSED" || s === "ARCHIVED";
}

function ticketEventMillis(ticket) {
  return toMillis(
    ticket && (
      ticket.createdAtMs ??
      ticket.createdAt ??
      ticket.created ??
      ticket.closedAt ??
      ticket.closedAtMs ??
      ticket.timestamp
    )
  );
}

function readLocalJsonArray(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
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
  if (dashboardUserHasMultipleLocations() && !scope.hasLocation) {
    logDashboardScope("tickets", scope, 0, 0, 0);
    return out;
  }
  let list = [];
  // Date-bounded Firestore load (same path as Tickets Summary). No 500 cap —
  // pages through every CLOSED/ARCHIVED ticket in the selected range.
  if (typeof window.ffLoadTicketsForAnalytics === "function") {
    try {
      const loadedTickets = await window.ffLoadTicketsForAnalytics({
        startMs: range?.startMs,
        endMs: range?.endMs,
      });
      if (Array.isArray(loadedTickets)) list = loadedTickets;
    } catch (err) {
      console.warn(LOG, "ffLoadTicketsForAnalytics failed", err);
    }
  }
  if (!list.length) {
    if (Array.isArray(window.currentTickets)) list = window.currentTickets;
    else if (Array.isArray(window.allTickets)) list = window.allTickets;
    else if (Array.isArray(window.ticketsCache)) list = window.ticketsCache;
  }
  if (!list.length && typeof window.ffGetCurrentTickets === "function") {
    try {
      const visibleTickets = window.ffGetCurrentTickets();
      if (Array.isArray(visibleTickets)) list = visibleTickets;
    } catch (err) {
      console.warn(LOG, "ffGetCurrentTickets failed", err);
    }
  }
  if (!list.length) return out;
  const before = list.length;
  let skippedNoLocation = 0;
  const completed = [];
  list.forEach((ticket) => {
    if (!ticket || ticket.deleted === true) return;
    if (!isCompletedTicketStatus(ticket.status)) return;
    const loc = dashboardRecordLocationId(ticket);
    if (!dashboardRecordInActiveLoc(ticket, scope)) {
      if (!loc) skippedNoLocation += 1;
      return;
    }
    if (!loc) skippedNoLocation += 1;
    const ms = ticketEventMillis(ticket);
    if (ms == null) return;
    completed.push({ ticket, ms });
  });
  logDashboardScope("tickets", scope, before, completed.length, skippedNoLocation);
  if (!scope.hasLocation || !completed.length) return out;

  out.hasData = true;
  const todayMs = todayStartMs();
  const weekMs = weekStartMs();
  completed.forEach(({ ticket, ms }) => {
    if (ms >= todayMs) out.todayCount += 1;
    if (ms >= weekMs) out.weekCount += 1;
    if (!range || inDashboardRange(ms, range)) {
      out.rangeCount += 1;
      const amt = Number(ticket && (ticket.totalAmount ?? ticket.total ?? ticket.amount));
      if (Number.isFinite(amt)) out.totalAmount += amt;
    }
  });
  out.totalCount = out.rangeCount;
  return out;
}

function _qmReadRawLog() {
  // queue-cloud applyState writes localStorage; window.log is often stale.
  const stored = readLocalJsonArray("ffv24_log");
  if (stored && stored.length) return stored;
  try {
    if (Array.isArray(window.log) && window.log.length) return window.log;
  } catch (_) {}
  return stored;
}

function _qmReadLiveList(storageKey, windowKey) {
  const stored = readLocalJsonArray(storageKey);
  if (stored && stored.length) return stored;
  try {
    if (Array.isArray(window[windowKey]) && window[windowKey].length) return window[windowKey];
  } catch (_) {}
  return stored || [];
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
  if (dashboardUserHasMultipleLocations() && !scope.hasLocation) {
    return {
      avgWaitMin: null,
      longestWaitMin: null,
      busiestDay: null,
      peakHour: null,
      waitCount: 0,
      activityCount: 0,
      sourceFound: false,
    };
  }
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
  const hasForeignStamp = raw.some((entry) => {
    const loc = String(entry?.locationId || entry?.locId || "").trim();
    return loc && loc !== scope.id;
  });
  for (let i = 0; i < raw.length; i += 1) {
    const p = _qmParseEntry(raw[i]);
    if (!p || p.ts < fromMs || p.ts > endMs) continue;
    if (!p.locationId && hasForeignStamp) {
      skippedNoLocation += 1;
      continue;
    }
    if (!dashboardRecordInActiveLoc(p, scope)) {
      if (!p.locationId) skippedNoLocation += 1;
      continue;
    }
    if (!p.locationId) skippedNoLocation += 1;
    parsed.push(p);
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
  if (dashboardUserHasMultipleLocations() && !scope.hasLocation) {
    logDashboardScope("queue-live", scope, 0, 0, 0);
    return {
      inQueue: 0,
      inService: 0,
      held: 0,
      avgWaitMin: null,
      longestWaitMin: null,
      busiestDay: null,
      peakHour: null,
    };
  }
  const rawQ = safeArr(_qmReadLiveList("ffv24_queue", "queue"));
  const rawService = safeArr(_qmReadLiveList("ffv24_service", "service"));
  const q = filterRowsToActiveLocation(rawQ, scope);
  const service = filterRowsToActiveLocation(rawService, scope);
  const skippedNoLocation = rawQ.concat(rawService).filter((row) => !dashboardRecordLocationId(row)).length;
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

function collectTasksFromState(state) {
  const tabs = ["opening", "closing", "weekly", "monthly", "yearly"];
  const kinds = ["active", "pending", "done"];
  const rows = [];
  if (!state || typeof state !== "object") return rows;
  tabs.forEach((tab) => {
    const block = state[tab];
    if (Array.isArray(block)) {
      block.forEach((task) => {
        if (task && typeof task === "object") rows.push({ ...task, __tab: tab, __kind: "active" });
      });
      return;
    }
    if (!block || typeof block !== "object") return;
    kinds.forEach((kind) => {
      const list = Array.isArray(block[kind]) ? block[kind] : (kind === "active" ? block.items : null);
      if (!Array.isArray(list)) return;
      list.forEach((task) => {
        if (task && typeof task === "object") rows.push({ ...task, __tab: tab, __kind: kind });
      });
    });
  });
  return rows;
}

function readTasksStateFromLocalStorage() {
  const state = {};
  ["opening", "closing", "weekly", "monthly", "yearly"].forEach((tab) => {
    state[tab] = {};
    ["active", "pending", "done"].forEach((kind) => {
      try {
        const raw = localStorage.getItem(`ff_tasks_${tab}_${kind}_v1`);
        const list = raw ? JSON.parse(raw) : [];
        state[tab][kind] = Array.isArray(list) ? list : [];
      } catch (_) {
        state[tab][kind] = [];
      }
    });
  });
  return state;
}

export async function readTasksSnapshot(range) {
  const scope = getDashboardLocationScope();
  const out = { opened: 0, completed: 0, openCount: 0, completionRate: null, hasData: false };
  if (dashboardUserHasMultipleLocations() && !scope.hasLocation) {
    logDashboardScope("tasks", scope, 0, 0, 0);
    return out;
  }
  let state = null;
  let source = "none";
  if (typeof window.ffLoadTasksStateForDashboard === "function") {
    try {
      const loaded = await window.ffLoadTasksStateForDashboard();
      if (loaded && loaded.state && typeof loaded.state === "object") {
        state = loaded.state;
        source = loaded.source || "firestore";
      }
    } catch (err) {
      console.warn(LOG, "ffLoadTasksStateForDashboard failed", err);
    }
  }
  // Cache / salon-wide localStorage can still hold another branch after a
  // location switch. Only fall back on single-location accounts.
  if (!state && !dashboardUserHasMultipleLocations()) {
    if (window.tasksCache && typeof window.tasksCache === "object") {
      state = window.tasksCache;
      source = "window.tasksCache";
    }
    if (!state) {
      state = readTasksStateFromLocalStorage();
      source = "localStorage";
    }
  }
  const rows = collectTasksFromState(state);
  const cloudScoped = source === "firestore" || source === "tasks-cloud-memory";
  const scopedRows = rows.filter((task) => {
    const stamped = dashboardRecordLocationId(task);
    if (stamped) return stamped === scope.id;
    if (cloudScoped) return !!scope.id || !dashboardUserHasMultipleLocations();
    return dashboardRecordInActiveLoc(task, scope);
  });
  const skippedNoLocation = rows.length - scopedRows.length;
  if (!scopedRows.length) {
    logDashboardScope("tasks", scope, rows.length, 0, skippedNoLocation);
    return out;
  }
  const rangeIncludesNow = !range || (Date.now() >= range.startMs && Date.now() <= range.endMs);
  const seen = new Map();
  scopedRows.forEach((task, index) => {
    const id = String(task.taskId || task.id || `${task.__tab}:${task.__kind}:${task.title || index}`).trim();
    const key = `${task.__tab || "task"}:${id}`;
    const status = String(task.status || task.state || "").toLowerCase();
    const isDone = task.__kind === "done" || status === "done" || status === "completed" || task.completed === true || !!task.completedAt || !!task.doneAt;
    const taskMs = eventMillis(
      task.completedAt || task.doneAt || task.updatedAt || task.createdAt || task.createdAtMs || task.ts || task.timestamp
    );
    // Live Tasks lists are the source of truth. Keep current open/done when
    // the selected range includes now. For a past custom range, only keep
    // rows that actually have a timestamp in that range.
    if (!rangeIncludesNow) {
      if (!taskMs || !inDashboardRange(taskMs, range)) return;
    }
    const current = seen.get(key) || { done: false };
    current.done = current.done || isDone;
    seen.set(key, current);
  });
  let totalDone = 0;
  let totalOpen = 0;
  seen.forEach((task) => {
    if (task.done) totalDone += 1;
    else totalOpen += 1;
  });
  const scopedCount = totalDone + totalOpen;
  logDashboardScope("tasks", scope, rows.length, scopedCount, skippedNoLocation);
  console.log(LOG, "tasks source", source, { opened: scopedCount, completed: totalDone, open: totalOpen });
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
    const toDate = new Date((range?.endMs || endOfTodayMs()) + 1);
    const entries = await window.ffListTimeEntriesForSalon({
      from: fromDate,
      to: toDate,
      locationId: scope.id,
      statuses: ["open", "closed"],
      pageAll: true,
      maxResults: 500,
    });
    if (!Array.isArray(entries) || !entries.length) return out;
    const skippedNoLocation = entries.filter((entry) => !dashboardRecordLocationId(entry)).length;
    const scopedEntries = entries.filter((entry) => dashboardRecordInActiveLoc(entry, scope));
    logDashboardScope("time-clock", scope, entries.length, scopedEntries.length, skippedNoLocation);
    if (!scopedEntries.length) return out;
    out.hasData = true;
    const byStaff = new Map();
    const byStaffWeek = new Map();
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
      addDashboardHoursByWeek(byStaffWeek, sid, sname, startMs, endMs);
    });
    byStaffWeek.forEach((v) => {
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

function dashboardWeekStartMs(ms) {
  const d = new Date(ms);
  const day = d.getDay();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}

function addDashboardHoursByWeek(byStaffWeek, staffId, staffName, startMs, endMs) {
  let cursor = startMs;
  while (cursor < endMs) {
    const weekStart = dashboardWeekStartMs(cursor);
    const weekEnd = weekStart + (7 * 24 * 60 * 60 * 1000);
    const sliceEnd = Math.min(endMs, weekEnd);
    const hours = (sliceEnd - cursor) / 3600000;
    const key = `${staffId}|${weekStart}`;
    const prev = byStaffWeek.get(key) || { name: staffName, hours: 0 };
    prev.hours += hours;
    byStaffWeek.set(key, prev);
    cursor = sliceEnd;
  }
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
  if (v instanceof Date) {
    const ms = v.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof v.toMillis === "function") {
    try { return v.toMillis(); } catch (_) { return null; }
  }
  if (typeof v.toDate === "function") {
    try {
      const d = v.toDate();
      const ms = d && typeof d.getTime === "function" ? d.getTime() : NaN;
      return Number.isFinite(ms) ? ms : null;
    } catch (_) {
      return null;
    }
  }
  if (typeof v.seconds === "number") return v.seconds * 1000;
  if (typeof v === "string") {
    const p = Date.parse(v);
    return Number.isNaN(p) ? null : p;
  }
  return null;
}
