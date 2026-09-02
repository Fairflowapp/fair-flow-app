/**
 * Onboarding portal UI — home list + navigation.
 */

import {
  state,
  esc,
  formatDue,
  progressPct,
  statusBadge,
  taskIcon,
  root,
  destroyEsign,
  requestRender,
} from "./app-shared.js?v=20260812_od_portal_sameorigin";

export function renderHome(dto, { completedView }) {
  const salon = (dto.salon && dto.salon.name) || "Your salon";
  const staff = (dto.staff && dto.staff.displayName) || "Team member";
  const pkg = (dto.run && dto.run.packageNameSnapshot) || "Onboarding";
  const due = formatDue(dto.run && dto.run.dueDate);
  const pct = progressPct(dto.run);
  const p = (dto.run && dto.run.progress) || {};
  const tasks = Array.isArray(dto.tasks) ? dto.tasks : [];

  const banner = completedView
    ? `<div class="readonly-banner">Onboarding complete — viewing only. Signed documents can’t be changed.</div>`
    : "";

  const taskList = tasks
    .map((t) => {
      const openable = !completedView || true; // always can view details read-only
      let meta = t.categoryNameSnapshot || "";
      if (t.taskType === "electronic_signature") {
        meta = (t.config && t.config.documentTitle) || meta || "Electronic signature";
        if (t.status === "completed") meta += " · Signed";
      }
      meta += t.required === false ? " · Optional" : " · Required";
      return `
        <button type="button" class="task" data-task-id="${esc(t.id)}" ${openable ? "" : "disabled"}>
          <div class="task-icon" aria-hidden="true">${taskIcon(t)}</div>
          <div class="task-body">
            <p class="task-name">${esc(t.templateNameSnapshot || "Task")}</p>
            <p class="task-meta">${esc(meta)}</p>
          </div>
          ${statusBadge(t.status)}
        </button>`;
    })
    .join("");

  return `
    ${banner}
    <div class="card">
      <p class="sub" style="font-weight:700;color:var(--brand1);margin-bottom:6px;">${esc(salon)}</p>
      <h1 class="hero-title">${completedView ? "You're all set" : `Welcome, ${esc(staff)}`}</h1>
      <p class="sub">${
        completedView
          ? `${esc(pkg)} is complete. You can review tasks below.`
          : `${esc(pkg)} — complete the items below.`
      }</p>
      <div class="meta-row">
        <span class="chip">${esc(staff)}</span>
        ${due ? `<span class="chip">Due ${esc(due)}</span>` : ""}
        ${
          dto.expiresAt
            ? `<span class="chip">Link expires ${esc(formatDue(dto.expiresAt))}</span>`
            : ""
        }
      </div>
      <div class="progress-block">
        <div class="progress-label">
          <span>Progress</span>
          <span>${Number(p.requiredCompleted || 0)}/${Number(p.requiredTotal || 0)} required · ${pct}%</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
    </div>
    <div class="section-title">Tasks</div>
    <div>${taskList || `<div class="card"><p class="sub">No tasks in this onboarding.</p></div>`}</div>
  `;
}

export function wireHome() {
  root().querySelectorAll("[data-task-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-task-id");
      openTask(id);
    });
  });
}

export function openTask(taskId) {
  state.taskId = taskId;
  state.screen = "task";
  state.error = "";
  state.scrollOk = false;
  state.uploadPct = 0;
  try {
    history.replaceState(null, "", `#/task/${encodeURIComponent(taskId)}`);
  } catch (_) {}
  requestRender();
}

export function goHome() {
  destroyEsign();
  state.taskId = null;
  state.error = "";
  const dto = state.dto;
  state.screen = dto && (dto.readOnly || (dto.run && dto.run.status === "completed"))
    ? "done"
    : "home";
  try {
    history.replaceState(null, "", location.pathname);
  } catch (_) {}
  requestRender();
}

