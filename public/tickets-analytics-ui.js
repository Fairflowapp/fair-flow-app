/**
 * Tickets Analytics — UI rendering.
 *
 * DOM-producing helpers for the Tickets analytics screen: summary cards, the
 * by-day / by-hour / items tables, the insights list, the location label, the
 * empty state and the CSV row serializer. Extracted verbatim from
 * tickets-analytics.js. Writes into fixed element IDs; owns no module state.
 */

import { fmtNumber, fmtCurrency, fmtHourRange, buildInsights } from "./tickets-analytics-compute.js?v=20260626_tickets_analytics_split";
import { getLocationScope } from "./tickets-analytics-data.js?v=20260626_tickets_analytics_split";

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderLocationScope(scope = getLocationScope()) {
  const el = document.getElementById("ffTaLocationLabel");
  if (el) el.textContent = scope.label;
}

export function renderEmpty(message = "No ticket data available yet") {
  const summary = document.getElementById("ffTaSummary");
  const byDay = document.getElementById("ffTaByDay");
  const byHour = document.getElementById("ffTaByHour");
  const items = document.getElementById("ffTaItems");
  const insights = document.getElementById("ffTaInsights");
  if (summary) {
    summary.innerHTML = ["Total Tickets", "Total Amount", "Average Ticket", "Busiest Day", "Peak Hour", "Best Selling Item"].map((label) => `
      <div class="ta-card">
        <div class="ta-card-label">${escapeHtml(label)}</div>
        <div class="ta-card-value">—</div>
        <div class="ta-card-foot">Not enough data yet</div>
      </div>
    `).join("");
  }
  const empty = `<div class="ta-empty">${escapeHtml(message)}</div>`;
  if (byDay) byDay.innerHTML = empty;
  if (byHour) byHour.innerHTML = empty;
  if (items) items.innerHTML = empty;
  if (insights) insights.innerHTML = '<ul class="ta-insights"><li class="ta-insight">No ticket data available yet.</li></ul>';
}

export function renderSummary(metrics) {
  const root = document.getElementById("ffTaSummary");
  if (!root) return;
  const cards = [
    { label: "Total Tickets", value: fmtNumber(metrics.totalTickets), foot: metrics.activeLocationId ? `Active location · ${metrics.rangeLabel}` : metrics.rangeLabel },
    { label: "Total Amount", value: fmtCurrency(metrics.totalAmount), foot: metrics.rangeLabel },
    { label: "Average Ticket", value: fmtCurrency(metrics.averageTicket), foot: "Revenue per ticket" },
    { label: "Busiest Day", value: metrics.busiestDay?.tickets ? metrics.busiestDay.dayName : "—", foot: metrics.busiestDay?.tickets ? `${fmtNumber(metrics.busiestDay.tickets)} tickets` : "Not enough data yet" },
    { label: "Peak Hour", value: metrics.peakHour ? fmtHourRange(metrics.peakHour.hour) : "—", foot: metrics.peakHour ? `${fmtNumber(metrics.peakHour.tickets)} tickets` : "Not enough data yet" },
    { label: "Best Selling Item", value: metrics.bestSellingItem?.name || "—", foot: metrics.bestSellingItem ? `${fmtNumber(metrics.bestSellingItem.sold)} sold` : "No item data yet" },
  ];
  root.innerHTML = cards.map((card) => `
    <div class="ta-card">
      <div class="ta-card-label">${escapeHtml(card.label)}</div>
      <div class="ta-card-value">${escapeHtml(card.value)}</div>
      <div class="ta-card-foot">${escapeHtml(card.foot)}</div>
    </div>
  `).join("");
}

export function renderByDay(metrics) {
  const root = document.getElementById("ffTaByDay");
  if (!root) return;
  root.innerHTML = `
    <div class="ta-table-wrap">
      <table class="ta-table">
        <thead>
          <tr>
            <th>Day</th>
            <th class="num">Tickets</th>
            <th class="num">Total Amount</th>
            <th class="num">Average Ticket</th>
            <th class="num">Highest Ticket</th>
          </tr>
        </thead>
        <tbody>
          ${metrics.byDay.map((row) => `
            <tr>
              <td>${escapeHtml(row.dayName)}</td>
              <td class="num">${escapeHtml(fmtNumber(row.tickets))}</td>
              <td class="num">${escapeHtml(row.tickets ? fmtCurrency(row.totalAmount) : "$0.00")}</td>
              <td class="num">${escapeHtml(row.tickets ? fmtCurrency(row.averageTicket) : "—")}</td>
              <td class="num">${escapeHtml(row.tickets ? fmtCurrency(row.highestTicket) : "—")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

export function renderByHour(metrics) {
  const root = document.getElementById("ffTaByHour");
  if (!root) return;
  root.innerHTML = metrics.byDayHour.map((day) => {
    const dayTickets = day.hours.reduce((sum, hour) => sum + hour.tickets, 0);
    const dayAmount = day.hours.reduce((sum, hour) => sum + hour.totalAmount, 0);
    if (!day.hours.length) {
      return `
        <details class="ta-day">
          <summary class="ta-day-title">
            <span>${escapeHtml(day.dayName)}</span>
            <span class="ta-day-meta">Closed</span>
          </summary>
          <div class="ta-day-body"><div class="ta-closed">Business hours are closed for this day.</div></div>
        </details>
      `;
    }
    return `
      <details class="ta-day">
        <summary class="ta-day-title">
          <span>${escapeHtml(day.dayName)}</span>
          <span class="ta-day-meta">${day.isOpen ? "" : "Closed · "}${day.hasActivityOutsideHours ? "After hours · " : ""}${escapeHtml(fmtNumber(dayTickets))} tickets · ${escapeHtml(fmtCurrency(dayAmount))}</span>
        </summary>
        <div class="ta-day-body">
          <div class="ta-hour-grid">
            ${day.hours.map((hour) => `
              <div class="ta-hour-card ${day.peakHour === hour.hour ? "is-peak" : ""}">
                <div class="ta-hour-title">${escapeHtml(fmtHourRange(hour.hour))}</div>
                <div class="ta-hour-row"><span>Tickets</span><strong>${escapeHtml(fmtNumber(hour.tickets))}</strong></div>
                <div class="ta-hour-row"><span>Total</span><strong>${escapeHtml(hour.tickets ? fmtCurrency(hour.totalAmount) : "$0.00")}</strong></div>
                <div class="ta-hour-row"><span>Average</span><strong>${escapeHtml(hour.tickets ? fmtCurrency(hour.averageTicket) : "—")}</strong></div>
              </div>
            `).join("")}
          </div>
        </div>
      </details>
    `;
  }).join("");
}

export function renderItems(metrics) {
  const root = document.getElementById("ffTaItems");
  if (!root) return;
  const rows = (metrics.items || []).slice(0, 10);
  if (!rows.length) {
    root.innerHTML = '<div class="ta-empty">No item-level data yet</div>';
    return;
  }
  root.innerHTML = `
    <div class="ta-table-wrap">
      <table class="ta-table">
        <thead>
          <tr>
            <th>Item</th>
            <th class="num">Sold</th>
            <th class="num">Total Amount</th>
            <th class="num">Average Price</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.name)}</td>
              <td class="num">${escapeHtml(fmtNumber(row.sold))}</td>
              <td class="num">${escapeHtml(fmtCurrency(row.totalAmount))}</td>
              <td class="num">${escapeHtml(fmtCurrency(row.averagePrice))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

export function renderInsights(metrics) {
  const root = document.getElementById("ffTaInsights");
  if (!root) return;
  const items = buildInsights(metrics);
  if (!items.length) {
    root.innerHTML = '<ul class="ta-insights"><li class="ta-insight">Not enough data yet.</li></ul>';
    return;
  }
  root.innerHTML = `
    <ul class="ta-insights">
      ${items.map((text) => `<li class="ta-insight">${escapeHtml(text)}</li>`).join("")}
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
