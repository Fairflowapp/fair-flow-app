/**
 * Time Analytics — DOM rendering + CSV row formatting.
 *
 * Owns every HTML/DOM write for the Time Analytics screen: location label,
 * summary/compare/insights panels, the empty state, deviation list, and the
 * CSV row serializer. Pure presentation: takes a metrics object (from compute)
 * and writes into known element IDs. Number/time formatting is imported from
 * compute; location scope + weekly threshold from data. The orchestrator owns
 * buildScreen (event wiring) and calls these renderers. Extracted verbatim
 * from time-analytics.js.
 */

import {
  fmtHours,
  fmtNumber,
  fmtPercent,
  fmtMinutes,
  fmtTime,
  buildInsights,
  DEFAULT_TOLERANCE_MINUTES,
} from "./time-analytics-compute.js?v=20260626_time_analytics_split";
import {
  getLocationScope,
  DEFAULT_WEEKLY_THRESHOLD,
} from "./time-analytics-data.js?v=20260626_time_analytics_split";

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderLocationScope(scope = getLocationScope()) {
  const el = document.getElementById("ffTimeAnalyticsLocationLabel");
  if (el) el.textContent = scope.label;
}

function card(label, value, foot = "") {
  return `
    <div class="ta-card">
      <div class="ta-label">${escapeHtml(label)}</div>
      <div class="ta-value">${escapeHtml(value)}</div>
      <div class="ta-foot">${escapeHtml(foot || "")}</div>
    </div>
  `;
}

export function renderEmpty(message = "Not enough data yet") {
  const summary = document.getElementById("ffTimeAnalyticsSummary");
  const compare = document.getElementById("ffTimeAnalyticsCompare");
  const insights = document.getElementById("ffTimeAnalyticsInsights");
  if (summary) {
    summary.innerHTML = [
      "Total Hours",
      "Regular Hours",
      "Overtime Hours",
      "Shift Accuracy",
      "Late Starts",
      "Early Leaves",
    ].map((label) => card(label, "--", message)).join("");
  }
  if (compare) compare.innerHTML = `<div class="ta-empty">${escapeHtml(message)}</div>`;
  if (insights) insights.innerHTML = `<div class="ta-empty">${escapeHtml(message)}</div>`;
}

export function renderSummary(metrics) {
  const root = document.getElementById("ffTimeAnalyticsSummary");
  if (!root) return;
  const hasMatchedSchedule = metrics.hasSchedule && metrics.totalShifts > 0;
  root.innerHTML = [
    card("Total Hours", fmtHours(metrics.totalHours), metrics.weekLabel),
    card("Regular Hours", fmtHours(metrics.regularHours), "Before overtime"),
    card("Overtime Hours", fmtHours(metrics.overtimeHours), `Over ${metrics.overtimeThreshold || DEFAULT_WEEKLY_THRESHOLD}h per staff`),
    card("Shift Accuracy", hasMatchedSchedule ? fmtPercent(metrics.shiftAccuracy) : "--", hasMatchedSchedule ? `${metrics.accurateShifts}/${metrics.totalShifts} accurate` : "Schedule tracking not enabled"),
    card("Late Starts", hasMatchedSchedule ? fmtNumber(metrics.lateStarts) : "--", hasMatchedSchedule ? `${DEFAULT_TOLERANCE_MINUTES}m tolerance` : "Schedule tracking not enabled"),
    card("Early Leaves", hasMatchedSchedule ? fmtNumber(metrics.earlyLeaves) : "--", hasMatchedSchedule ? `${DEFAULT_TOLERANCE_MINUTES}m tolerance` : "Schedule tracking not enabled"),
  ].join("");
}

export function renderCompare(metrics) {
  const root = document.getElementById("ffTimeAnalyticsCompare");
  if (!root) return;
  if (!metrics.hasSchedule) {
    root.innerHTML = '<div class="ta-empty">Schedule tracking not enabled</div>';
    return;
  }
  const diff = metrics.differenceHours;
  const diffLabel = Number.isFinite(diff) ? `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}h` : "--";
  root.innerHTML = `
    <div class="ta-compare-row">
      ${card("Total Scheduled Hours", fmtHours(metrics.totalScheduledHours), "Planned shifts")}
      ${card("Total Actual Hours", fmtHours(metrics.totalActualHours), "Clocked time")}
      ${card("Difference", diffLabel, diff > 0 ? "More than scheduled" : diff < 0 ? "Less than scheduled" : "Matches schedule")}
    </div>
    <div class="ta-deviation-title">Schedule Deviations</div>
    ${renderDeviationList(metrics.deviations)}
  `;
}

function renderDeviationList(deviations) {
  const rows = Array.isArray(deviations) ? deviations : [];
  if (!rows.length) {
    return '<div class="ta-empty">No schedule deviations detected</div>';
  }
  return `
    <div class="ta-deviation-list">
      ${rows.map((row) => {
        const tags = [];
        if (row.lateMinutes > 0) tags.push(`Late start: ${fmtMinutes(row.lateMinutes)}`);
        if (row.earlyMinutes > 0) tags.push(`Early leave: ${fmtMinutes(row.earlyMinutes)}`);
        if (row.stayedLongerMinutes > 0) tags.push(`Stayed longer: ${fmtMinutes(row.stayedLongerMinutes)}`);
        return `
          <div class="ta-deviation">
            <div class="ta-deviation-head">${escapeHtml(row.employeeName)} - ${escapeHtml(row.dayName || row.dateKey)}</div>
            <div class="ta-deviation-line">Scheduled: ${escapeHtml(fmtTime(row.scheduledStartMs))} - ${escapeHtml(fmtTime(row.scheduledEndMs))}</div>
            <div class="ta-deviation-line">Actual: ${escapeHtml(fmtTime(row.actualStartMs))} - ${escapeHtml(fmtTime(row.actualEndMs))}</div>
            <div class="ta-deviation-tags">
              ${tags.map((tag) => `<span class="ta-deviation-tag">${escapeHtml(tag)}</span>`).join("")}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

export function renderInsights(metrics) {
  const root = document.getElementById("ffTimeAnalyticsInsights");
  if (!root) return;
  const insights = buildInsights(metrics);
  if (!insights.length) {
    root.innerHTML = '<div class="ta-empty">Not enough data yet</div>';
    return;
  }
  root.innerHTML = `
    <ul class="ta-insights">
      ${insights.map((item) => `<li class="ta-insight ${escapeHtml(item.kind)}">${escapeHtml(item.text)}</li>`).join("")}
    </ul>
  `;
}

function csvCell(value) {
  const s = String(value == null ? "" : value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(values) {
  return values.map(csvCell).join(",");
}
