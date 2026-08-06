/**
 * Tasks Analytics — UI rendering.
 *
 * DOM-producing helpers for the Tasks analytics screen: summary cards, the
 * breakdown / trend / insights panels, the empty state and the CSV row
 * serializer. Extracted verbatim from tasks-analytics.js. Writes into fixed
 * element IDs; owns no module state. Pure metric math lives in compute.
 */

import { fmtRate, buildInsights } from "./tasks-analytics-compute.js?v=20260625_tasks_analytics_split";

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function card(label, value, foot = "") {
  return `
    <div class="tsa-card">
      <div class="tsa-label">${escapeHtml(label)}</div>
      <div class="tsa-value">${escapeHtml(value)}</div>
      <div class="tsa-foot">${escapeHtml(foot)}</div>
    </div>
  `;
}

export function renderEmpty() {
  const summary = document.getElementById("ffTasksAnalyticsSummary");
  const type = document.getElementById("ffTasksAnalyticsType");
  const role = document.getElementById("ffTasksAnalyticsRole");
  const trend = document.getElementById("ffTasksAnalyticsTrend");
  const insights = document.getElementById("ffTasksAnalyticsInsights");
  const empty = '<div class="tsa-empty">No task data available yet</div>';
  if (summary) summary.innerHTML = empty;
  if (type) type.innerHTML = empty;
  if (role) role.innerHTML = empty;
  if (trend) trend.innerHTML = empty;
  if (insights) insights.innerHTML = empty;
}

export function renderSummary(metrics) {
  const root = document.getElementById("ffTasksAnalyticsSummary");
  if (!root) return;
  root.innerHTML = [
    card("Tasks Opened", metrics.total, "All tracked tasks"),
    card("Tasks Completed", metrics.completed, "Marked done"),
    card("Completion Rate", fmtRate(metrics.completionRate), "Completed / opened"),
    card("Open Tasks", metrics.open, "Still active or pending"),
    card("Overdue Tasks", metrics.overdue, "Past due and open"),
  ].join("");
}

export function renderBreakdown(rootId, title, rows) {
  const root = document.getElementById(rootId);
  if (!root) return;
  root.innerHTML = `
    <div class="tsa-label" style="margin-bottom:8px;">${escapeHtml(title)}</div>
    ${rows.map((row) => `
      <div class="tsa-row">
        <span>${escapeHtml(row.label)}</span>
        <b>${escapeHtml(fmtRate(row.rate))}</b>
      </div>
    `).join("")}
  `;
}

export function renderTrend(metrics) {
  const root = document.getElementById("ffTasksAnalyticsTrend");
  if (!root) return;
  const current = metrics.thisWeek.rate;
  const last = metrics.lastWeek.rate;
  let suffix = "Not enough weekly history yet";
  if (Number.isFinite(current) && Number.isFinite(last)) {
    const arrow = current >= last ? "↑" : "↓";
    suffix = `${arrow} from ${fmtRate(last)}`;
  }
  root.innerHTML = `
    <div class="tsa-label">${escapeHtml(metrics.rangeLabel || "Selected range")} vs previous period</div>
    <div class="tsa-trend">${escapeHtml(fmtRate(current))} <span>${escapeHtml(suffix)}</span></div>
    <div class="tsa-foot">${escapeHtml(metrics.thisWeek.completed)} completed of ${escapeHtml(metrics.thisWeek.total)} tracked in this range</div>
  `;
}

export function renderInsights(metrics) {
  const root = document.getElementById("ffTasksAnalyticsInsights");
  if (!root) return;
  const items = buildInsights(metrics);
  root.innerHTML = `
    <ul class="tsa-insights">
      ${items.map((item) => `<li class="tsa-insight ${escapeHtml(item.kind)}">${escapeHtml(item.text)}</li>`).join("")}
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
