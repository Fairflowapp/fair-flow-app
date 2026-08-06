/**
 * Time Analytics — pure compute + formatting.
 *
 * Owns the analytics math (normalize/match entries, schedule-match metrics,
 * the full computeTimeAnalytics pipeline) plus number/time formatters and
 * insight building. No DOM and no direct Firestore: data is reached one-way
 * through time-analytics-data.js (compute -> data). Extracted verbatim from
 * time-analytics.js (computeTimeAnalytics dead default param removed).
 */

import {
  LOG,
  getLocationScope,
  getOvertimeThreshold,
  readStaffNames,
  readTimeEntries,
  readScheduleDaysForRange,
  extractScheduledShifts,
  toMillis,
  ymdLocal,
} from "./time-analytics-data.js?v=20260626_time_analytics_split";

const MATCH_LOG = "[TimeAnalytics Match]";
const DEVIATIONS_LOG = "[TimeAnalytics Deviations]";
export const LOC_LOG = "[TimeAnalytics LocationScope]";
export const DEFAULT_TOLERANCE_MINUTES = 10;

export function fmtHours(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}h` : "--";
}

export function fmtNumber(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString() : "--";
}

export function fmtPercent(value) {
  return Number.isFinite(value) ? `${Math.round(value)}%` : "--";
}

export function fmtMinutes(value) {
  const minutes = Math.round(Number(value) || 0);
  if (minutes <= 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

export function fmtTime(ms) {
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

function logLocationScope(source, scope, before, after, skippedNoLocation) {
  console.log(LOC_LOG, source, {
    activeLocationId: scope?.id || "",
    recordsBeforeFilter: before,
    recordsAfterFilter: after,
    skippedRecordsWithoutLocationId: skippedNoLocation,
  });
}

export async function computeTimeAnalytics(range) {
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
    const shiftLocationId = String(shift.locationId || "").trim();
    const matchesLocation = scope.hasLocation && (shiftLocationId === scope.id || !shiftLocationId);
    return matchesLocation &&
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

export function buildInsights(metrics) {
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
