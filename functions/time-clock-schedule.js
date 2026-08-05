/**
 * Time Clock ↔ Schedule enforcement helpers (S0).
 *
 * Pure date/TZ/window math + Firestore loaders for resolving a staff member's
 * published assignment on a given salon-local day. Wired into timeClockPunch
 * in later stages (S1/S2); this module is intentionally side-effect free on
 * the punch path until then.
 *
 * Decisions locked for v1:
 *   - Publish gate: unpublished week ⇒ no enforcement for that week
 *   - Clock-out late flag uses clock-in snapshot (linkedShiftStart/End)
 *   - Default noShiftPolicy = "allow"
 *   - TZ fallback = America/New_York (settings UI warns when enforcement on
 *     and salonTimeZone is empty — S3)
 */

const DEFAULT_TZ = "America/New_York";

const DEFAULT_EARLY_CLOCK_IN_MINUTES = 15;
const DEFAULT_LATE_CLOCK_OUT_MINUTES = 15;
const MAX_WINDOW_MINUTES = 24 * 60;

// ─── string / number helpers ─────────────────────────────────────────────────

function trimStr(v) {
  return String(v == null ? "" : v).trim();
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function clampInt(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  const i = Math.floor(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

/** Parse "HH:mm" (24h) → minutes since midnight, or null. */
function parseHHmmToMinutes(raw) {
  const s = trimStr(raw);
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function minutesToHHmm(mins) {
  if (!Number.isFinite(mins) || mins < 0) return null;
  const h = Math.floor(mins / 60) % 24;
  const m = Math.floor(mins % 60);
  return `${pad2(h)}:${pad2(m)}`;
}

/** Validate IANA tz; invalid → DEFAULT_TZ. */
function normalizeTimeZone(tz) {
  const s = trimStr(tz);
  if (!s) return DEFAULT_TZ;
  try {
    // Throws RangeError for unknown zones in modern Node.
    Intl.DateTimeFormat("en-US", { timeZone: s }).format(new Date());
    return s;
  } catch (_) {
    return DEFAULT_TZ;
  }
}

// ─── salon-local calendar ────────────────────────────────────────────────────

/**
 * Local wall-clock parts for `date` in IANA `tz`.
 * @returns {{ dateKey: string, minutes: number, year: number, month: number, day: number, hour: number, minute: number }}
 */
function localParts(date, tz) {
  const timeZone = normalizeTimeZone(tz);
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch (_) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: DEFAULT_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  const p = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  let hh = parseInt(p.hour, 10);
  if (hh === 24) hh = 0; // some ICU builds emit "24" for midnight
  const mm = parseInt(p.minute, 10);
  const year = parseInt(p.year, 10);
  const month = parseInt(p.month, 10);
  const day = parseInt(p.day, 10);
  return {
    dateKey: `${p.year}-${p.month}-${p.day}`,
    minutes: hh * 60 + mm,
    year,
    month,
    day,
    hour: hh,
    minute: mm,
  };
}

/** Salon-local YYYY-MM-DD for an instant. */
function salonDateKey(date, tz) {
  return localParts(date, tz).dateKey;
}

/**
 * Convert a salon-local civil wall time (dateKey + HH:mm) to UTC epoch ms.
 * Iteratively corrects for the zone offset (handles DST).
 */
function zonedWallTimeToUtcMs(dateKey, hhmm, tz) {
  const timeZone = normalizeTimeZone(tz);
  const key = trimStr(dateKey);
  const mins = parseHHmmToMinutes(hhmm);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || mins == null) return null;
  const y = parseInt(key.slice(0, 4), 10);
  const mo = parseInt(key.slice(5, 7), 10);
  const d = parseInt(key.slice(8, 10), 10);
  const h = Math.floor(mins / 60);
  const mi = mins % 60;

  // Initial guess: treat the wall clock as if it were UTC.
  let utcMs = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  for (let i = 0; i < 4; i++) {
    const parts = localParts(new Date(utcMs), timeZone);
    const [py, pm, pd] = parts.dateKey.split("-").map(Number);
    const dayDiffMs = Date.UTC(y, mo - 1, d) - Date.UTC(py, pm - 1, pd);
    const minDiffMs = (mins - parts.minutes) * 60 * 1000;
    const adjust = dayDiffMs + minDiffMs;
    if (adjust === 0) break;
    utcMs += adjust;
  }
  return utcMs;
}

/**
 * Week-start YYYY-MM-DD for a salon-local dateKey.
 * weekStartsOn: "monday" (default) | "sunday".
 * Uses UTC-noon civil arithmetic so the calendar day is stable.
 */
function weekStartKeyFromDateKey(dateKey, weekStartsOn) {
  const key = trimStr(dateKey);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const y = parseInt(key.slice(0, 4), 10);
  const mo = parseInt(key.slice(5, 7), 10);
  const d = parseInt(key.slice(8, 10), 10);
  const utcNoon = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  const day = utcNoon.getUTCDay(); // 0=Sun … 6=Sat
  const startsSunday = String(weekStartsOn || "").toLowerCase() === "sunday";
  const diff = startsSunday ? -day : (day === 0 ? -6 : 1 - day);
  const start = new Date(utcNoon);
  start.setUTCDate(start.getUTCDate() + diff);
  return `${start.getUTCFullYear()}-${pad2(start.getUTCMonth() + 1)}-${pad2(start.getUTCDate())}`;
}

function schedulePublishDocId(locationId) {
  const loc = trimStr(locationId);
  // Time Clock uses "default" when no branch is selected; Schedule legacy
  // publish doc id is "weeks". Real branches use weeks_{locationId}.
  if (!loc || loc === "default") return "weeks";
  return `weeks_${loc}`;
}

// ─── settings normalization ──────────────────────────────────────────────────

/**
 * Normalize scheduleEnforcement block from settings/timeClock.
 * Missing / malformed → safe defaults (enforcement OFF, noShiftPolicy allow).
 */
function normalizeScheduleEnforcement(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const noShift =
    String(r.noShiftPolicy || "").toLowerCase() === "block" ? "block" : "allow";
  return {
    enabled: r.enabled === true,
    earlyClockInMinutes: clampInt(
      r.earlyClockInMinutes,
      DEFAULT_EARLY_CLOCK_IN_MINUTES,
      0,
      MAX_WINDOW_MINUTES,
    ),
    lateClockOutMinutes: clampInt(
      r.lateClockOutMinutes,
      DEFAULT_LATE_CLOCK_OUT_MINUTES,
      0,
      MAX_WINDOW_MINUTES,
    ),
    noShiftPolicy: noShift,
  };
}

// ─── assignment matching ─────────────────────────────────────────────────────

function staffKeysMatch(assignment, staffId) {
  const target = trimStr(staffId);
  if (!target) return false;
  const aStaff = trimStr(assignment && assignment.staffId);
  const aUid = trimStr(assignment && assignment.uid);
  return (aStaff && aStaff === target) || (aUid && aUid === target);
}

/**
 * Find the day's assignment for staff inside a weekDraftSnapshots block.
 * @returns {null|{ dateKey, startTime, endTime, linkedShiftId, assignment }}
 */
function findAssignmentInWeekBlock(weekBlock, dateKey, staffId) {
  const days = weekBlock && Array.isArray(weekBlock.days) ? weekBlock.days : null;
  if (!days) return null;
  const day = days.find((d) => trimStr(d && d.date) === trimStr(dateKey));
  if (!day) return null;
  const assignments = Array.isArray(day.assignments) ? day.assignments : [];
  const hit = assignments.find((a) => staffKeysMatch(a, staffId));
  if (!hit) return null;
  const startTime = trimStr(hit.startTime || hit.start || "");
  const endTime = trimStr(hit.endTime || hit.end || "");
  if (parseHHmmToMinutes(startTime) == null || parseHHmmToMinutes(endTime) == null) {
    return null;
  }
  // Same-day only (Schedule UI rejects end <= start).
  if (parseHHmmToMinutes(endTime) <= parseHHmmToMinutes(startTime)) {
    return null;
  }
  const explicitId = trimStr(hit.shiftId || hit.id);
  const linkedShiftId = explicitId || `${trimStr(staffId)}::${trimStr(dateKey)}`;
  return {
    dateKey: trimStr(dateKey),
    startTime,
    endTime,
    linkedShiftId,
    assignment: hit,
  };
}

function isWeekPublished(publishDocData, weekStartKey) {
  const published = publishDocData && publishDocData.published;
  if (!published || typeof published !== "object") return false;
  return published[weekStartKey] === true;
}

// ─── enforcement decisions (pure) ────────────────────────────────────────────

/**
 * Clock-in gate decision.
 *
 * @param {object} args
 * @param {object} args.enforcement - normalizeScheduleEnforcement() result
 * @param {boolean} args.weekPublished
 * @param {object|null} args.shift - findAssignmentInWeekBlock() result
 * @param {number} args.nowMs
 * @param {string} args.timeZone
 * @returns {object}
 */
function evaluateScheduleClockIn(args) {
  const enforcement = args.enforcement || normalizeScheduleEnforcement(null);
  const nowMs = Number(args.nowMs);
  const timeZone = normalizeTimeZone(args.timeZone);

  if (!enforcement.enabled) {
    return { enforce: false, ok: true, reason: null };
  }
  // Publish gate: unpublished week ⇒ no enforcement.
  if (!args.weekPublished) {
    return { enforce: false, ok: true, reason: "unpublished_week" };
  }

  const shift = args.shift || null;
  if (!shift) {
    if (enforcement.noShiftPolicy === "allow") {
      return {
        enforce: true,
        ok: true,
        reason: null,
        scheduled: false,
        linkedShiftId: null,
        linkedShiftStart: null,
        linkedShiftEnd: null,
      };
    }
    return {
      enforce: true,
      ok: false,
      reason: "no_scheduled_shift",
      scheduled: false,
      linkedShiftId: null,
      linkedShiftStart: null,
      linkedShiftEnd: null,
    };
  }

  const startMs = zonedWallTimeToUtcMs(shift.dateKey, shift.startTime, timeZone);
  const endMs = zonedWallTimeToUtcMs(shift.dateKey, shift.endTime, timeZone);
  if (startMs == null || endMs == null) {
    // Corrupt times → fail open (do not strand staff).
    return { enforce: true, ok: true, reason: "shift_parse_failed", scheduled: false };
  }

  const allowedAtMs = startMs - enforcement.earlyClockInMinutes * 60 * 1000;
  const snapshot = {
    scheduled: true,
    linkedShiftId: shift.linkedShiftId,
    linkedShiftStart: shift.startTime,
    linkedShiftEnd: shift.endTime,
    shiftStartMs: startMs,
    shiftEndMs: endMs,
    allowedAtMs,
  };

  if (Number.isFinite(nowMs) && nowMs < allowedAtMs) {
    return {
      enforce: true,
      ok: false,
      reason: "too_early_for_shift",
      allowedAt: new Date(allowedAtMs).toISOString(),
      ...snapshot,
    };
  }

  return {
    enforce: true,
    ok: true,
    reason: null,
    ...snapshot,
  };
}

/**
 * Clock-out late flag decision — uses clock-in snapshot only (not live schedule).
 *
 * @param {object} args
 * @param {object} args.enforcement
 * @param {string|null} args.linkedShiftEnd - HH:mm snapshot from entry
 * @param {string|null} args.linkedShiftStart
 * @param {string|null} args.dateKey - salon-local day of the open entry (or shift day)
 * @param {boolean} args.scheduled
 * @param {number} args.nowMs
 * @param {string} args.timeZone
 */
function evaluateScheduleClockOut(args) {
  const enforcement = args.enforcement || normalizeScheduleEnforcement(null);
  const nowMs = Number(args.nowMs);
  const timeZone = normalizeTimeZone(args.timeZone);

  if (!enforcement.enabled) {
    return { lateClockOutFlag: false, reason: null };
  }
  if (args.scheduled !== true) {
    return { lateClockOutFlag: false, reason: "unscheduled_entry" };
  }
  const endHHmm = trimStr(args.linkedShiftEnd);
  const dateKey = trimStr(args.dateKey);
  if (!endHHmm || !dateKey) {
    return { lateClockOutFlag: false, reason: "missing_snapshot" };
  }

  const endMs = zonedWallTimeToUtcMs(dateKey, endHHmm, timeZone);
  if (endMs == null) {
    return { lateClockOutFlag: false, reason: "shift_parse_failed" };
  }
  const thresholdMs = endMs + enforcement.lateClockOutMinutes * 60 * 1000;
  if (Number.isFinite(nowMs) && nowMs > thresholdMs) {
    return {
      lateClockOutFlag: true,
      reason: "past_schedule",
      shiftEndMs: endMs,
      thresholdMs,
      lateMinutes: Math.round((nowMs - endMs) / 60000),
    };
  }
  return {
    lateClockOutFlag: false,
    reason: null,
    shiftEndMs: endMs,
    thresholdMs,
  };
}

/**
 * Entry has a usable clock-in schedule snapshot for late clock-out.
 * linkedShiftEnd + linkedShiftDateKey are required; scheduled may be missing
 * on some legacy rows that still carried the wall-clock fields.
 */
function entryHasLinkedShiftSnapshot(entry) {
  if (!entry || typeof entry !== "object") return false;
  return !!(trimStr(entry.linkedShiftEnd) && trimStr(entry.linkedShiftDateKey));
}

/** Snapshot fields written onto a time entry from a published-shift hit. */
function linkedShiftSnapshotFromShift(shift, dateKeyFallback) {
  if (!shift || !trimStr(shift.endTime)) return null;
  const dateKey = trimStr(shift.dateKey) || trimStr(dateKeyFallback);
  if (!dateKey) return null;
  return {
    scheduled: true,
    linkedShiftId: trimStr(shift.linkedShiftId) || null,
    linkedShiftStart: trimStr(shift.startTime) || null,
    linkedShiftEnd: trimStr(shift.endTime),
    linkedShiftDateKey: dateKey,
  };
}

/**
 * Resolve late clock-out eval inputs for a PUNCH clock-out.
 * Prefers entry linkedShift* snapshot; if missing (manual / legacy /
 * scheduled:false), falls back to a live published-schedule lookup for the
 * clock-in salon-local day + location.
 *
 * @returns {Promise<{
 *   source: "snapshot"|"live_fallback"|"none",
 *   decision: object,
 *   snapshotPatch: object|null,
 *   timeZone: string,
 * }>}
 */
async function resolveLateClockOutForPunch(db, {
  salonId, locationId, staffId, entry, nowMs, enforcement,
}) {
  const enf = enforcement || normalizeScheduleEnforcement(null);
  const tzInfo = await resolveSalonTimeZone(db, salonId, locationId);
  const timeZone = tzInfo.timeZone;
  const ms = Number(nowMs);

  if (entryHasLinkedShiftSnapshot(entry)) {
    const decision = evaluateScheduleClockOut({
      enforcement: enf,
      scheduled: true,
      linkedShiftEnd: entry.linkedShiftEnd,
      linkedShiftStart: entry.linkedShiftStart || null,
      dateKey: entry.linkedShiftDateKey,
      nowMs: ms,
      timeZone,
    });
    return {
      source: "snapshot",
      decision,
      snapshotPatch: null,
      timeZone,
      dateKey: trimStr(entry.linkedShiftDateKey),
    };
  }

  // Live fallback — clock-in salon day when available, else punch "now".
  let clockInMs = null;
  try {
    const ci = entry && entry.clockInAt;
    if (ci && typeof ci.toMillis === "function") clockInMs = ci.toMillis();
    else if (ci && typeof ci.toDate === "function") clockInMs = ci.toDate().getTime();
    else if (typeof ci === "number" && isFinite(ci)) clockInMs = ci;
    else if (ci instanceof Date) clockInMs = ci.getTime();
  } catch (_) { /* ignore */ }
  const dayMs = (typeof clockInMs === "number" && isFinite(clockInMs)) ? clockInMs : ms;
  const dateKey = salonDateKey(new Date(dayMs), timeZone);
  const weekStartsOn = await resolveWeekStartsOn(db, salonId);
  const loaded = await loadScheduleShiftForDay(
    db, salonId, locationId, staffId, dateKey, weekStartsOn,
  );

  if (!loaded.weekPublished) {
    const decision = evaluateScheduleClockOut({
      enforcement: enf,
      scheduled: false,
      linkedShiftEnd: null,
      dateKey: null,
      nowMs: ms,
      timeZone,
    });
    return {
      source: "none",
      decision: Object.assign({}, decision, { reason: decision.reason || "unpublished_week" }),
      snapshotPatch: null,
      timeZone,
      dateKey,
      weekStartKey: loaded.weekStartKey,
    };
  }

  const snapshotPatch = linkedShiftSnapshotFromShift(loaded.shift, dateKey);
  if (!snapshotPatch) {
    const decision = evaluateScheduleClockOut({
      enforcement: enf,
      scheduled: false,
      linkedShiftEnd: null,
      dateKey: null,
      nowMs: ms,
      timeZone,
    });
    return {
      source: "none",
      decision: Object.assign({}, decision, { reason: decision.reason || "live_no_shift" }),
      snapshotPatch: null,
      timeZone,
      dateKey,
      weekStartKey: loaded.weekStartKey,
    };
  }

  const decision = evaluateScheduleClockOut({
    enforcement: enf,
    scheduled: true,
    linkedShiftEnd: snapshotPatch.linkedShiftEnd,
    linkedShiftStart: snapshotPatch.linkedShiftStart,
    dateKey: snapshotPatch.linkedShiftDateKey,
    nowMs: ms,
    timeZone,
  });
  return {
    source: "live_fallback",
    decision,
    snapshotPatch,
    timeZone,
    dateKey: snapshotPatch.linkedShiftDateKey,
    weekStartKey: loaded.weekStartKey,
  };
}

/**
 * Snapshot to attach on Manage-add when a published shift exists for the
 * clock-in salon-local day / location / staff. Returns nulls when none.
 */
async function resolveLinkedShiftSnapshotForManageAdd(db, {
  salonId, locationId, staffId, clockInAtMs,
}) {
  const tzInfo = await resolveSalonTimeZone(db, salonId, locationId);
  const timeZone = tzInfo.timeZone;
  const ms = Number(clockInAtMs);
  if (!isFinite(ms)) {
    return { snapshot: null, timeZone, dateKey: null };
  }
  const dateKey = salonDateKey(new Date(ms), timeZone);
  const weekStartsOn = await resolveWeekStartsOn(db, salonId);
  const loaded = await loadScheduleShiftForDay(
    db, salonId, locationId, staffId, dateKey, weekStartsOn,
  );
  if (!loaded.weekPublished) {
    return { snapshot: null, timeZone, dateKey, weekStartKey: loaded.weekStartKey };
  }
  return {
    snapshot: linkedShiftSnapshotFromShift(loaded.shift, dateKey),
    timeZone,
    dateKey,
    weekStartKey: loaded.weekStartKey,
  };
}

// ─── Firestore loaders ───────────────────────────────────────────────────────

/**
 * Resolve salon IANA timezone + whether the configured value was empty
 * (so settings UI can warn when enforcement is on).
 *
 * Prefer: salon.timezone → preferences.salonTimeZone (root) →
 * settings/main preferences / locationPreferences → DEFAULT_TZ.
 */
async function resolveSalonTimeZone(db, salonId, locationId) {
  const sid = trimStr(salonId);
  const loc = trimStr(locationId);
  let configured = "";

  try {
    const salonSnap = await db.collection("salons").doc(sid).get();
    if (salonSnap.exists) {
      const top = trimStr(salonSnap.get("timezone"));
      if (top) configured = top;
      if (!configured) {
        const rootPrefs = salonSnap.get("preferences");
        if (rootPrefs && typeof rootPrefs === "object") {
          configured = trimStr(rootPrefs.salonTimeZone);
        }
      }
    }
  } catch (e) {
    console.warn("[timeClockSchedule] salon tz read failed", sid, e && e.message);
  }

  if (!configured) {
    try {
      const mainSnap = await db.collection("salons").doc(sid).collection("settings").doc("main").get();
      if (mainSnap.exists) {
        const data = mainSnap.data() || {};
        const locPrefs = data.locationPreferences;
        if (loc && locPrefs && typeof locPrefs === "object") {
          const row = locPrefs[loc];
          if (row && row.salonTimeZone) configured = trimStr(row.salonTimeZone);
        }
        if (!configured && data.preferences && data.preferences.salonTimeZone) {
          configured = trimStr(data.preferences.salonTimeZone);
        }
      }
    } catch (e) {
      console.warn("[timeClockSchedule] settings/main tz read failed", sid, e && e.message);
    }
  }

  const usedDefault = !configured;
  return {
    timeZone: normalizeTimeZone(configured || DEFAULT_TZ),
    configuredTimeZone: configured || null,
    usedDefault,
  };
}

/** weekStartsOn from settings/main preferences (default monday). */
async function resolveWeekStartsOn(db, salonId) {
  try {
    const mainSnap = await db.collection("salons").doc(trimStr(salonId))
      .collection("settings").doc("main").get();
    if (mainSnap.exists) {
      const prefs = (mainSnap.data() || {}).preferences || {};
      if (String(prefs.weekStartsOn || "").toLowerCase() === "sunday") return "sunday";
    }
  } catch (e) {
    console.warn("[timeClockSchedule] weekStartsOn read failed", e && e.message);
  }
  // Also check salon root preferences (some salons mirror there).
  try {
    const salonSnap = await db.collection("salons").doc(trimStr(salonId)).get();
    const prefs = salonSnap.exists ? salonSnap.get("preferences") : null;
    if (prefs && String(prefs.weekStartsOn || "").toLowerCase() === "sunday") return "sunday";
  } catch (_) { /* ignore */ }
  return "monday";
}

/**
 * Load published-week assignment for staff on a salon-local date at a location.
 *
 * @returns {Promise<{
 *   weekStartKey: string,
 *   weekPublished: boolean,
 *   shift: object|null,
 *   publishDocId: string,
 * }>}
 */
async function loadScheduleShiftForDay(db, salonId, locationId, staffId, dateKey, weekStartsOn) {
  const weekStartKey = weekStartKeyFromDateKey(dateKey, weekStartsOn);
  const publishDocId = schedulePublishDocId(locationId);
  if (!weekStartKey) {
    return { weekStartKey: null, weekPublished: false, shift: null, publishDocId };
  }

  let data = null;
  try {
    const snap = await db.collection("salons").doc(trimStr(salonId))
      .collection("schedulePublish").doc(publishDocId).get();
    data = snap.exists ? (snap.data() || {}) : null;
  } catch (e) {
    console.warn("[timeClockSchedule] schedulePublish read failed", {
      salonId, publishDocId, message: e && e.message,
    });
    return { weekStartKey, weekPublished: false, shift: null, publishDocId };
  }

  if (!data) {
    return { weekStartKey, weekPublished: false, shift: null, publishDocId };
  }

  const weekPublished = isWeekPublished(data, weekStartKey);
  const snapshots = data.weekDraftSnapshots && typeof data.weekDraftSnapshots === "object"
    ? data.weekDraftSnapshots
    : {};
  const weekBlock = snapshots[weekStartKey] || null;
  const shift = findAssignmentInWeekBlock(weekBlock, dateKey, staffId);
  return { weekStartKey, weekPublished, shift, publishDocId };
}

/**
 * Convenience: resolve TZ + week start + today's shift for a punch moment.
 */
async function resolveScheduleContextForPunch(db, {
  salonId,
  locationId,
  staffId,
  nowMs,
  enforcement,
}) {
  const tzInfo = await resolveSalonTimeZone(db, salonId, locationId);
  const weekStartsOn = await resolveWeekStartsOn(db, salonId);
  const dateKey = salonDateKey(new Date(nowMs), tzInfo.timeZone);
  const loaded = await loadScheduleShiftForDay(
    db, salonId, locationId, staffId, dateKey, weekStartsOn,
  );
  const decision = evaluateScheduleClockIn({
    enforcement: enforcement || normalizeScheduleEnforcement(null),
    weekPublished: loaded.weekPublished,
    shift: loaded.shift,
    nowMs,
    timeZone: tzInfo.timeZone,
  });
  return {
    ...tzInfo,
    weekStartsOn,
    dateKey,
    ...loaded,
    decision,
  };
}

function getDb() {
  // Lazy require so pure unit tests do not need firebase-admin on the path.
  const admin = require("firebase-admin");
  if (!admin.apps.length) admin.initializeApp();
  return admin.firestore();
}

module.exports = {
  DEFAULT_TZ,
  DEFAULT_EARLY_CLOCK_IN_MINUTES,
  DEFAULT_LATE_CLOCK_OUT_MINUTES,
  trimStr,
  parseHHmmToMinutes,
  minutesToHHmm,
  normalizeTimeZone,
  localParts,
  salonDateKey,
  zonedWallTimeToUtcMs,
  weekStartKeyFromDateKey,
  schedulePublishDocId,
  normalizeScheduleEnforcement,
  staffKeysMatch,
  findAssignmentInWeekBlock,
  isWeekPublished,
  evaluateScheduleClockIn,
  evaluateScheduleClockOut,
  entryHasLinkedShiftSnapshot,
  linkedShiftSnapshotFromShift,
  resolveLateClockOutForPunch,
  resolveLinkedShiftSnapshotForManageAdd,
  resolveSalonTimeZone,
  resolveWeekStartsOn,
  loadScheduleShiftForDay,
  resolveScheduleContextForPunch,
  getDb,
};
