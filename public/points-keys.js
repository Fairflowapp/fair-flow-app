/**
 * Points — pure key/id helpers.
 *
 * No Firestore, no DOM, no side effects. Period/day keys for summaries and
 * deterministic event ids for de-duplication.
 *
 * Extracted from points-engine.js (step 1 of points refactor) with identical
 * behavior — do not change semantics without checking ffCreatePointsEvent /
 * ffVoidPointsEvent which depend on these exact id/key shapes.
 */

function startOfUtcYear(date) {
  return Date.UTC(date.getUTCFullYear(), 0, 1);
}

export function getIsoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const week = Math.ceil((((d.getTime() - startOfUtcYear(d)) / 86400000) + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function getMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function getDayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function safeIdPart(value) {
  return encodeURIComponent(String(value || "").trim()).replace(/\./g, "%2E").slice(0, 240);
}

export function buildEventId({ staffId, type, sourceModule, sourceId, dayKey }) {
  const parts = [
    safeIdPart(type),
    safeIdPart(sourceModule),
    safeIdPart(staffId),
    safeIdPart(sourceId),
  ];
  if (dayKey) parts.push(safeIdPart(dayKey));
  return parts.join("__");
}
