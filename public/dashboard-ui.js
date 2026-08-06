/**
 * Dashboard — DOM rendering.
 *
 * Owns the HTML/DOM writes driven by a snapshot+range: location label, KPI
 * row, per-module cards (with analytics deep-links), and the insights list,
 * plus the escapeHtml helper. Pure presentation: reads nothing from module
 * state. Formatters + insight building come from compute; location scope + LOG
 * from data. The orchestrator owns buildScreen and the range controls (which
 * mutate state). Extracted verbatim from dashboard.js.
 */

import {
  getDashboardLocationScope,
  LOG,
} from "./dashboard-data.js?v=20260626_dashboard_split";
import {
  fmtNumber,
  fmtMinutes,
  fmtHourRange,
  fmtCurrency,
  buildInsights,
} from "./dashboard-compute.js?v=20260626_dashboard_split";

export function renderDashboardLocation(scope = getDashboardLocationScope()) {
  const el = document.getElementById("ffDashLocationLabel");
  if (el) el.textContent = scope.label;
}

export function renderKpis(snap, range) {
  const root = document.getElementById("ffDashKpis");
  if (!root) return;
  const cards = [
    { label: "Tickets", value: snap.tickets.hasData ? fmtNumber(snap.tickets.rangeCount) : "0", foot: range.label },
    { label: "Revenue", value: snap.tickets.hasData && snap.tickets.totalAmount ? fmtCurrency(snap.tickets.totalAmount) : "—", foot: range.label },
    { label: "Avg wait time", value: fmtMinutes(snap.queue.avgWaitMin), foot: range.label },
    { label: "Hours worked", value: snap.time.hasData ? `${snap.time.totalHours.toFixed(1)}h` : "0h", foot: range.label },
    { label: "Overtime", value: snap.time.hasData ? `${snap.time.overtimeHours.toFixed(1)}h` : "0h", foot: range.label },
    { label: "Tasks completed", value: fmtNumber(snap.tasks.completed), foot: range.label },
  ];
  root.innerHTML = cards.map((c) => `
    <div class="dash-kpi">
      <div class="dash-kpi-label">${escapeHtml(c.label)}</div>
      <div class="dash-kpi-value">${escapeHtml(c.value)}</div>
      <div class="dash-kpi-foot">${escapeHtml(c.foot)}</div>
    </div>
  `).join("");
}

export function renderModuleCards(snap, range) {
  const root = document.getElementById("ffDashGrid");
  if (!root) return;

  const queueCard = `
    <div class="dash-card">
      <div class="dash-card-header">
        <h3 class="dash-card-title">Queue Flow</h3>
        <span class="dash-card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </span>
      </div>
      <div class="dash-meta">Showing: <b>${escapeHtml(range.label)}</b></div>
      <div class="dash-stats">
        <div class="dash-stat"><div class="dash-stat-label">Average wait time</div><div class="dash-stat-value">${escapeHtml(fmtMinutes(snap.queue.avgWaitMin))}</div></div>
        <div class="dash-stat"><div class="dash-stat-label">Longest wait time</div><div class="dash-stat-value">${escapeHtml(fmtMinutes(snap.queue.longestWaitMin))}</div></div>
      </div>
      <div class="dash-meta">
        <div>Busiest day in range: <b>${escapeHtml(snap.queue.busiestDay || "—")}</b></div>
        <div>Peak hour in range: <b>${escapeHtml(snap.queue.peakHour == null ? "—" : fmtHourRange(snap.queue.peakHour))}</b></div>
      </div>
      <button type="button" class="dash-link" data-dash-action="queue-analytics">View Queue Analytics →</button>
    </div>
  `;

  const ticketsCard = `
    <div class="dash-card">
      <div class="dash-card-header">
        <h3 class="dash-card-title">Tickets</h3>
        <span class="dash-card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </span>
      </div>
      <div class="dash-meta">Showing: <b>${escapeHtml(range.label)}</b></div>
      <div class="dash-stats">
        <div class="dash-stat"><div class="dash-stat-label">Total tickets</div><div class="dash-stat-value">${escapeHtml(fmtNumber(snap.tickets.totalCount))}</div></div>
        <div class="dash-stat"><div class="dash-stat-label">Total amount</div><div class="dash-stat-value">${escapeHtml(snap.tickets.totalAmount ? fmtCurrency(snap.tickets.totalAmount) : "—")}</div></div>
      </div>
      <div class="dash-meta">
        Average ticket: <b>${escapeHtml(snap.tickets.totalCount && snap.tickets.totalAmount ? fmtCurrency(snap.tickets.totalAmount / snap.tickets.totalCount) : "—")}</b>
      </div>
      <button type="button" class="dash-link" data-dash-action="tickets-analytics">View Tickets Analytics →</button>
    </div>
  `;

  const timeCard = `
    <div class="dash-card">
      <div class="dash-card-header">
        <h3 class="dash-card-title">Time Clock</h3>
        <span class="dash-card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </span>
      </div>
      <div class="dash-meta">Showing: <b>${escapeHtml(range.label)}</b></div>
      <div class="dash-stats">
        <div class="dash-stat"><div class="dash-stat-label">Total hours</div><div class="dash-stat-value">${snap.time.hasData ? `${snap.time.totalHours.toFixed(1)}h` : "0h"}</div></div>
        <div class="dash-stat"><div class="dash-stat-label">Overtime</div><div class="dash-stat-value">${snap.time.hasData ? `${snap.time.overtimeHours.toFixed(1)}h` : "0h"}</div></div>
      </div>
      <div class="dash-meta">
        Most hours by: <b>${escapeHtml(snap.time.topStaffName || "—")}</b>
      </div>
      <button type="button" class="dash-link" data-dash-action="time-analytics">View Time Analytics →</button>
    </div>
  `;

  const tasksCard = `
    <div class="dash-card">
      <div class="dash-card-header">
        <h3 class="dash-card-title">Tasks</h3>
        <span class="dash-card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </span>
      </div>
      <div class="dash-meta">Showing: <b>${escapeHtml(range.label)}</b></div>
      <div class="dash-stats">
        <div class="dash-stat"><div class="dash-stat-label">Tasks opened</div><div class="dash-stat-value">${escapeHtml(fmtNumber(snap.tasks.opened))}</div></div>
        <div class="dash-stat"><div class="dash-stat-label">Completed</div><div class="dash-stat-value">${escapeHtml(fmtNumber(snap.tasks.completed))}</div></div>
      </div>
      <div class="dash-meta">
        Completion rate: <b>${snap.tasks.completionRate == null ? "—" : `${snap.tasks.completionRate}%`}</b>
        &nbsp;·&nbsp; Open tasks: <b>${escapeHtml(fmtNumber(snap.tasks.openCount))}</b>
      </div>
      <button type="button" class="dash-link" data-dash-action="tasks-analytics">View Tasks Analytics →</button>
    </div>
  `;

  root.innerHTML = queueCard + ticketsCard + timeCard + tasksCard;

  const ANALYTICS_LABELS = {
    "queue-analytics": "Queue Analytics",
    "tickets-analytics": "Tickets Analytics",
    "time-analytics": "Time Analytics",
    "tasks-analytics": "Tasks Analytics",
  };
  const ANALYTICS_ROUTES = {
    "queue-analytics": "goToQueueAnalytics",
    "tickets-analytics": "goToTicketsAnalytics",
    "time-analytics": "goToTimeAnalytics",
    "tasks-analytics": "goToTasksAnalytics",
  };
  const ANALYTICS_MODULES = {
    "queue-analytics": { src: "/queue-analytics.js?v=20260514_mobile_analytics_ready", exportName: "goToQueueAnalytics" },
    "tickets-analytics": { src: "/tickets-analytics.js?v=20260514_mobile_analytics_ready", exportName: "goToTicketsAnalytics" },
    "time-analytics": { src: "/time-analytics.js?v=20260514_mobile_analytics_ready", exportName: "goToTimeAnalytics" },
    "tasks-analytics": { src: "/tasks-analytics.js?v=20260514_mobile_analytics_ready", exportName: "goToTasksAnalytics" },
  };
  root.querySelectorAll("[data-dash-action]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const action = btn.getAttribute("data-dash-action");
      const label = ANALYTICS_LABELS[action] || "Analytics";
      console.log(LOG, "analytics link clicked", action);
      const routeFn = ANALYTICS_ROUTES[action];
      if (routeFn && typeof window[routeFn] === "function") {
        try {
          window[routeFn]();
          return;
        } catch (err) {
          console.warn(LOG, "route navigation failed", routeFn, err);
        }
      }
      const moduleMeta = ANALYTICS_MODULES[action];
      if (moduleMeta?.src) {
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = `Loading ${label}...`;
        try {
          const mod = await import(moduleMeta.src);
          const fn = window[routeFn] || mod?.[moduleMeta.exportName];
          if (typeof fn === "function") {
            fn();
            return;
          }
          console.warn(LOG, "analytics module loaded without route", action);
        } catch (err) {
          console.warn(LOG, "analytics module load failed", action, err);
        } finally {
          btn.disabled = false;
          btn.textContent = originalText;
        }
      }
      try {
        if (window.ffToast && typeof window.ffToast.info === "function") {
          window.ffToast.info(`${label} is still loading. Please try again in a moment.`, 3500);
        } else if (typeof window.showToast === "function") {
          window.showToast(`${label} is still loading. Please try again in a moment.`, 3500);
        }
      } catch (err) {
        console.warn(LOG, "toast failed", err);
      }
    });
  });
}

export function renderInsights(snap) {
  const root = document.getElementById("ffDashInsights");
  if (!root) return;
  const items = buildInsights(snap);
  root.innerHTML = items.map((i) => {
    const cls = i.kind === "good" ? "is-good" : i.kind === "info" ? "is-info" : "";
    return `
      <li class="dash-insight ${cls}">
        <span class="dash-insight-ico" aria-hidden="true">${escapeHtml(i.icon)}</span>
        <span>${escapeHtml(i.text)}</span>
      </li>
    `;
  }).join("");
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
