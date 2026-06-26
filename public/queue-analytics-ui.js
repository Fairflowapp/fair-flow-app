/**
 * Queue Analytics — UI rendering (DOM/HTML).
 *
 * Pure presentation: builds the summary/day/hour/insights panels, the hour
 * details modal and the CSV row helpers. Extracted verbatim from
 * queue-analytics.js. Takes a metrics object (from the compute module) plus the
 * screen id where needed; owns no module state. The orchestrator keeps
 * SCREEN_ID, buildScreen wiring, refresh and exportCurrentCsv.
 */

import {
  fmtMinutes,
  fmtIdleMinutes,
  fmtStaffAverage,
  fmtHourRange,
  buildWaitTimeTypeRows,
} from "./queue-analytics-compute.js?v=20260625_queue_analytics_split";

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderEmpty(message = "No queue data available yet") {
  ["ffQaSummary", "ffQaByDay", "ffQaByHour", "ffQaInsights"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = "";
  });
  const summary = document.getElementById("ffQaSummary");
  if (summary) {
    summary.outerHTML = `<div id="ffQaSummary" class="qa-empty">${escapeHtml(message)}</div>`;
  }
  const byDay = document.getElementById("ffQaByDay");
  if (byDay) byDay.innerHTML = `<div style="color:#6b7280;font-size:13px;">${escapeHtml(message)}</div>`;
  const byHour = document.getElementById("ffQaByHour");
  if (byHour) byHour.innerHTML = `<div style="color:#6b7280;font-size:13px;">${escapeHtml(message)}</div>`;
  const insights = document.getElementById("ffQaInsights");
  if (insights) {
    insights.innerHTML = `
      <ul class="qa-insights-list">
        <li class="qa-insight is-info"><span aria-hidden="true">ℹ️</span><span>Queue data is currently low. Insights will appear once staff flow events are logged.</span></li>
      </ul>
    `;
  }
}

export function renderSummary(metrics) {
  const root = document.getElementById("ffQaSummary");
  if (!root) return;
  const rangeLabel = metrics.rangeLabel || "Selected range";
  const cards = [
    { label: "Service starts", value: String(metrics.totalStarts || 0), foot: "Work entered" },
    { label: "Active staff", value: String(metrics.totalActiveStaff || 0), foot: rangeLabel },
    { label: "Avg staff / day", value: fmtStaffAverage(metrics.avgStaffPerDay), foot: `${metrics.staffActivityDays || 0} active day${(metrics.staffActivityDays || 0) === 1 ? "" : "s"}` },
    { label: "Average wait time", value: fmtMinutes(metrics.avgWaitMin), foot: rangeLabel },
    { label: "Longest wait time", value: fmtMinutes(metrics.longestWaitMin), foot: rangeLabel },
  ];
  root.outerHTML = `
    <div id="ffQaSummary" class="qa-summary">
      ${cards.map((c) => `
        <div class="qa-card">
          <div class="qa-card-label">${escapeHtml(c.label)}</div>
          <div class="qa-card-value">${escapeHtml(c.value)}</div>
          <div class="qa-card-foot">${escapeHtml(c.foot)}</div>
        </div>
      `).join("")}
    </div>
  `;
}

export function renderByDay(metrics) {
  const root = document.getElementById("ffQaByDay");
  if (!root) return;
  const rows = metrics.byDay || [];
  if (!rows.length) {
    root.innerHTML = '<div style="color:#6b7280;font-size:13px;">No day-level staff flow yet.</div>';
    return;
  }
  const maxCount = rows.reduce((a, r) => (r.count > a ? r.count : a), 0) || 1;
  root.innerHTML = `
    <table class="qa-table">
      <thead>
        <tr>
          <th>Day</th>
          <th class="num">Avg wait</th>
          <th class="num">Longest wait</th>
          <th class="num">Staff Flow</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => {
          const pct = Math.round((r.count / maxCount) * 100);
          return `
            <tr>
              <td>${escapeHtml(r.dayName)}</td>
              <td class="num">${escapeHtml(fmtMinutes(r.avgWaitMin))}</td>
              <td class="num">${escapeHtml(fmtMinutes(r.longestWaitMin))}</td>
              <td class="num">
                ${escapeHtml(String(r.count))}
                <div class="qa-bar"><span style="width:${pct}%"></span></div>
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function renderTypeBreakdown(title, rows, formatter = (value) => String(value || 0)) {
  const cleanRows = Array.isArray(rows) && rows.length ? rows : [{ type: "Other", count: 0 }];
  return `
    <div>
      <div class="qa-type-title">${escapeHtml(title)}</div>
      ${cleanRows.map((row) => `
        <div class="qa-type-row">
          <span>${escapeHtml(row.type || "Other")}</span>
          <strong>${escapeHtml(formatter(row.count || 0))}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function closeHourDetailsModal() {
  const modal = document.getElementById("ffQaHourDetailsModal");
  if (modal) modal.remove();
}

function showHourDetailsModal(day, hour, screenId) {
  closeHourDetailsModal();
  const root = document.getElementById(screenId);
  if (!root || !day || !hour) return;
  const modal = document.createElement("div");
  modal.id = "ffQaHourDetailsModal";
  modal.className = "qa-hour-modal-backdrop";
  modal.innerHTML = `
    <div class="qa-hour-modal" role="dialog" aria-modal="true" aria-labelledby="ffQaHourModalTitle">
      <div class="qa-hour-modal-head">
        <div>
          <h2 class="qa-hour-modal-title" id="ffQaHourModalTitle">${escapeHtml(day.dayName)} ${escapeHtml(fmtHourRange(hour.hour))}</h2>
          <p class="qa-hour-modal-sub">Staff and Available wait breakdown for this hour</p>
        </div>
        <button type="button" class="qa-hour-modal-close" data-qa-hour-modal-close aria-label="Close details">×</button>
      </div>
      <div class="qa-hour-modal-body">
        <div class="qa-hour-modal-summary">
          <div class="qa-hour-modal-stat"><span>Starts</span><strong>${escapeHtml(String(hour.starts || 0))}</strong></div>
          <div class="qa-hour-modal-stat"><span>Staff</span><strong>${escapeHtml(String(hour.activeStaff || 0))}</strong></div>
          <div class="qa-hour-modal-stat"><span>Average Wait</span><strong>${escapeHtml(fmtIdleMinutes(hour.idleMinutes))}</strong></div>
        </div>
        <div class="qa-hour-modal-section">
          ${renderTypeBreakdown("Average wait by type", buildWaitTimeTypeRows(hour), fmtIdleMinutes)}
        </div>
        <div class="qa-hour-modal-section">
          ${renderTypeBreakdown("Staff by type", hour.staffByType)}
        </div>
      </div>
    </div>
  `;
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest("[data-qa-hour-modal-close]")) {
      closeHourDetailsModal();
    }
  });
  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      closeHourDetailsModal();
      document.removeEventListener("keydown", onKeyDown);
    }
  };
  document.addEventListener("keydown", onKeyDown);
  root.appendChild(modal);
  const closeBtn = modal.querySelector("[data-qa-hour-modal-close]");
  if (closeBtn) closeBtn.focus();
}

export function renderByHour(metrics, screenId) {
  const root = document.getElementById("ffQaByHour");
  if (!root) return;
  const dayRows = metrics.byDayHour || [];
  if (!dayRows.length) {
    root.innerHTML = '<div style="color:#6b7280;font-size:13px;">No hourly staff flow yet.</div>';
    return;
  }
  root.innerHTML = `
    <div>
      ${dayRows.map((day, idx) => `
        <details class="qa-hour-day">
          <summary class="qa-hour-day-title">
            <span>${escapeHtml(day.dayName)} ▼</span>
            <span class="qa-hour-day-hours">${day.isOpen ? `${escapeHtml(day.openTime)}–${escapeHtml(day.closeTime)}${day.hasActivityOutsideHours ? " · After hours activity" : ""}` : (day.hours && day.hours.length ? "Closed · activity logged" : "Closed")}</span>
          </summary>
          ${(day.isOpen || (day.hours && day.hours.length)) ? `
            <div class="qa-hour-day-body">
              <div class="qa-day-stats">
                <span class="qa-day-stat">Total Staff: ${escapeHtml(String(day.totalStaff || 0))}</span>
                <span class="qa-day-stat">Peak Hour: ${escapeHtml(day.peakHour == null ? "—" : fmtHourRange(day.peakHour))}</span>
              </div>
              <div class="qa-hour-grid">
                ${day.hours.map((r) => `
                  <button type="button" class="qa-hour-tile ${r.hour === day.peakHour ? "is-peak" : ""}" data-qa-hour-card data-day-idx="${escapeHtml(String(day.dayIdx))}" data-hour="${escapeHtml(String(r.hour))}" aria-label="Open ${escapeHtml(day.dayName)} ${escapeHtml(fmtHourRange(r.hour))} details">
                    <div class="qa-hour-card-title">${escapeHtml(fmtHourRange(r.hour))}</div>
                    <div class="qa-hour-card-row"><span>Starts</span><strong>${escapeHtml(String(r.starts || 0))}</strong></div>
                    <div class="qa-hour-card-row"><span>Staff</span><strong>${escapeHtml(String(r.activeStaff || 0))}</strong></div>
                    <div class="qa-hour-card-row"><span>Average Wait</span><strong>${escapeHtml(fmtIdleMinutes(r.idleMinutes))}</strong></div>
                  </button>
                `).join("")}
              </div>
            </div>
          ` : '<div class="qa-hour-day-body"><div class="qa-closed">Closed</div></div>'}
        </details>
      `).join("")}
    </div>
  `;
  root.querySelectorAll("[data-qa-hour-card]").forEach((card) => {
    card.addEventListener("click", () => {
      const dayIdx = Number(card.getAttribute("data-day-idx"));
      const hourValue = Number(card.getAttribute("data-hour"));
      const day = dayRows.find((row) => row.dayIdx === dayIdx);
      const hour = day?.hours?.find((row) => row.hour === hourValue);
      showHourDetailsModal(day, hour, screenId);
    });
  });
}

export function buildInsights(metrics) {
  const out = [];
  if (!metrics.sourceFound || (
    metrics.activityCount === 0 &&
    metrics.waitCount === 0 &&
    metrics.totalStarts === 0 &&
    metrics.totalActiveStaff === 0 &&
    metrics.totalIdleMinutes === 0
  )) {
    out.push({ kind: "info", icon: "ℹ️", text: "Queue data is currently low. Insights will appear once staff flow events are logged." });
    return out;
  }
  let peakStart = null;
  (metrics.byDayHour || []).forEach((day) => {
    (day.hours || []).forEach((hour) => {
      if (!peakStart || hour.starts > peakStart.starts) {
        peakStart = { ...hour, dayName: day.dayName };
      }
    });
  });
  if (peakStart && peakStart.starts > 0) {
    out.push({
      kind: "warn",
      icon: "⚠️",
      text: `Peak demand at ${fmtHourRange(peakStart.hour)} (${peakStart.starts} service starts).`,
    });
  }
  let busiestStaffHour = null;
  let highestIdleHour = null;
  (metrics.byDayHour || []).forEach((day) => {
    (day.hours || []).forEach((hour) => {
      if (!busiestStaffHour || (hour.activeStaff || 0) > busiestStaffHour.activeStaff) {
        busiestStaffHour = { ...hour, dayName: day.dayName };
      }
      if (!highestIdleHour || (hour.idleMinutes || 0) > highestIdleHour.idleMinutes) {
        highestIdleHour = { ...hour, dayName: day.dayName };
      }
    });
  });
  if (busiestStaffHour && busiestStaffHour.activeStaff >= 1) {
    out.push({
      kind: "warn",
      icon: "⚠️",
      text: `Most active staff were on ${busiestStaffHour.dayName} around ${fmtHourRange(busiestStaffHour.hour)} (${busiestStaffHour.activeStaff} staff).`,
    });
  }
  if (highestIdleHour && highestIdleHour.idleMinutes >= 20) {
    out.push({
      kind: "warn",
      icon: "⚠️",
      text: `Highest wait time was ${highestIdleHour.dayName} ${fmtHourRange(highestIdleHour.hour)} (${fmtIdleMinutes(highestIdleHour.idleMinutes)}).`,
    });
  }
  // Worst day by avg wait (only consider days that actually have wait pairs).
  const dayWithWaits = (metrics.byDay || []).filter((r) => Number.isFinite(r.avgWaitMin) && r.avgWaitMin > 0);
  if (dayWithWaits.length) {
    let worst = dayWithWaits[0];
    dayWithWaits.forEach((r) => { if (r.avgWaitMin > worst.avgWaitMin) worst = r; });
    out.push({
      kind: "warn",
      icon: "⚠️",
      text: `${worst.dayName} has the highest average wait time (${fmtMinutes(worst.avgWaitMin)}).`,
    });
  }
  if (Number.isFinite(metrics.avgWaitMin) && metrics.avgWaitMin >= 20) {
    out.push({
      kind: "warn",
      icon: "⚠️",
      text: `Average wait time is high (${fmtMinutes(metrics.avgWaitMin)}). Consider adding capacity.`,
    });
  }
  if (Number.isFinite(metrics.longestWaitMin) && metrics.longestWaitMin >= 45) {
    out.push({
      kind: "warn",
      icon: "⚠️",
      text: `Longest wait time in this range reached ${fmtMinutes(metrics.longestWaitMin)}.`,
    });
  }
  if (!out.length) {
    if (metrics.waitCount === 0 && metrics.activityCount > 0) {
      out.push({ kind: "info", icon: "ℹ️", text: "Staff flow was recorded, but no completed join → start pairs yet." });
    } else {
      out.push({ kind: "good", icon: "✅", text: "Queue is flowing smoothly. No bottlenecks detected in this range." });
    }
  }
  return out.slice(0, 4);
}

export function renderInsights(metrics) {
  const root = document.getElementById("ffQaInsights");
  if (!root) return;
  const items = buildInsights(metrics);
  root.innerHTML = `
    <ul class="qa-insights-list">
      ${items.map((i) => {
        const cls = i.kind === "good" ? "is-good" : i.kind === "info" ? "is-info" : "";
        return `
          <li class="qa-insight ${cls}">
            <span aria-hidden="true">${escapeHtml(i.icon)}</span>
            <span>${escapeHtml(i.text)}</span>
          </li>
        `;
      }).join("")}
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
