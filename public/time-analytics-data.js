/**
 * Time Analytics — data + low-level helpers.
 *
 * Owns every I/O path for the Time Analytics screen: window/localStorage
 * readers plus the only Firestore reads (schedulePublish snapshots + debug
 * probes). Also owns the pure shift-extraction chain (extractScheduledShifts +
 * timestamp/date helpers) because the schedule reader depends on it — keeping
 * it here lets compute import one-way (compute -> data) with no Firestore in
 * compute and no circular import. Extracted verbatim from time-analytics.js.
 */

import { collection, doc, getDoc, getDocs, limit, query } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";

export const LOG = "[TimeAnalytics Simple]";
const SCHEDULE_DEBUG_LOG = "[TimeAnalytics ScheduleDebug]";
export const DEFAULT_WEEKLY_THRESHOLD = 40;

export function toMillis(value) {
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

export function ymdLocal(date) {
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

export function getWeekStart(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const startsOnSunday = getWeekStartsOnPreference() === "sunday";
  const day = d.getDay();
  const diff = startsOnSunday ? day : (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
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

export function getLocationScope() {
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

function getSalonId() {
  try {
    return String(window.currentSalonId || "").trim();
  } catch (_) {
    return "";
  }
}

export function getOvertimeThreshold() {
  try {
    const configured = Number(window.settings?.timeClock?.overtime?.weeklyThreshold);
    if (Number.isFinite(configured) && configured >= 0) return configured;
  } catch (_) {}
  return DEFAULT_WEEKLY_THRESHOLD;
}

export function readStaffNames() {
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

function schedulePublishDocId() {
  const locId = getActiveLocationId();
  return locId ? `weeks_${locId}` : "weeks";
}

export async function readTimeEntries(from, to) {
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

export function extractScheduledShifts(days) {
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
  const stampDaysLocation = (days, locationId) => {
    const loc = String(locationId || "").trim();
    if (!loc || !Array.isArray(days)) return days;
    return days.map((day) => ({
      ...day,
      locationId: String(day?.locationId || day?.locId || loc).trim(),
      assignments: (Array.isArray(day?.assignments) ? day.assignments : []).map((assignment) => ({
        ...assignment,
        locationId: String(assignment?.locationId || assignment?.locId || day?.locationId || day?.locId || loc).trim(),
      })),
    }));
  };
  const pickDays = (name, days, details = {}) => {
    const normalizedDays = stampDaysLocation(days, details.locationId || "");
    const shifts = extractScheduledShifts(normalizedDays);
    addSourceResult(name, {
      ...details,
      days: Array.isArray(normalizedDays) ? normalizedDays.length : 0,
      shifts: shifts.length,
      firstShift: shifts[0] || null,
      accepted: shifts.length > 0,
      rejectedReason: shifts.length ? "" : (details.rejectedReason || "No shifts found"),
    });
    return shifts.length ? normalizedDays : null;
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
          locationId: docId === schedulePublishDocId() ? activeLocationId : (data.locationId || ""),
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

export async function readScheduleDaysForRange(range) {
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
