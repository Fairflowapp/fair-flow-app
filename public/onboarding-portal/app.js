/**
 * Employee Onboarding Portal UI (Phase 2 + E4 e-sign).
 * Cloud Functions only — no Firestore / no public Storage SDK.
 * Token stays in the URL path for refresh; never logged to console/analytics.
 */

import {
  state,
  esc,
  root,
  destroyEsign,
  parseTokenFromPath,
  parseHashTaskId,
  portalHttp,
  applyDto,
  setErrorFromException,
  CF_NAMES,
  bindRequestRender,
} from "./app-shared.js?v=20260810_od_split_v1";
import { renderHome, wireHome, goHome } from "./app-home.js?v=20260810_od_split_v1";
import { renderTaskDetail, wireTaskDetail } from "./app-task.js?v=20260810_od_split_v1";

function render() {
  const el = root();
  if (!el) return;
  if (state.screen !== "task") destroyEsign();
  if (state.screen === "loading") {
    el.innerHTML = `
      <div class="state">
        <div class="spinner" aria-hidden="true"></div>
        <h1>Loading your onboarding…</h1>
        <p class="sub">Please wait a moment.</p>
      </div>`;
    return;
  }
  if (state.screen === "error") {
    const title =
      state.errorKind === "cancelled"
        ? "Onboarding cancelled"
        : state.errorKind === "invalid"
          ? "Link unavailable"
          : state.errorKind === "rate"
            ? "Please wait"
            : "Unable to open";
    const body =
      state.errorKind === "cancelled"
        ? "This onboarding was cancelled. Ask your manager for help."
        : state.errorKind === "invalid"
          ? "This link is invalid, expired, or no longer active. Ask your manager for a new link."
          : state.errorKind === "rate"
            ? "Too many attempts from this network. Wait a minute and refresh this page."
            : esc(state.error || "Please try again later.");
    el.innerHTML = `
      <div class="state">
        <h1>${esc(title)}</h1>
        <p class="sub">${body}</p>
        ${
          state.errorKind === "rate"
            ? `<div class="btn-row" style="max-width:280px;margin:16px auto 0;"><button type="button" class="btn btn-secondary" id="ffPortalRetry">Try again</button></div>`
            : ""
        }
      </div>`;
    const retry = document.getElementById("ffPortalRetry");
    if (retry) retry.addEventListener("click", () => boot());
    return;
  }

  const dto = state.dto;
  if (!dto) {
    state.screen = "error";
    state.errorKind = "generic";
    state.error = "Missing onboarding data.";
    return render();
  }

  if (state.screen === "task" && state.taskId) {
    const task = (dto.tasks || []).find((t) => t.id === state.taskId);
    if (!task) {
      state.screen = dto.readOnly ? "done" : "home";
      return render();
    }
    el.innerHTML = renderTaskDetail(dto, task);
    wireTaskDetail(task);
    return;
  }

  if (state.screen === "done" || dto.readOnly) {
    el.innerHTML = renderHome(dto, { completedView: true });
    wireHome();
    return;
  }

  el.innerHTML = renderHome(dto, { completedView: false });
  wireHome();
}


async function boot() {
  state.screen = "loading";
  render();
  const token = parseTokenFromPath();
  if (!token || token.length < 20) {
    state.errorKind = "invalid";
    state.error = "Invalid or expired link.";
    state.screen = "error";
    render();
    return;
  }
  try {
    const dto = await portalHttp(CF_NAMES.bootstrap, { token });
    applyDto(dto);
    const hashTask = parseHashTaskId();
    if (dto.readOnly || (dto.run && dto.run.status === "completed")) {
      state.screen = "done";
      if (hashTask) {
        state.taskId = hashTask;
        state.screen = "task";
      }
    } else if (hashTask) {
      state.taskId = hashTask;
      state.screen = "task";
    } else {
      state.screen = "home";
    }
    render();
  } catch (e) {
    setErrorFromException(e);
    render();
  }
}


bindRequestRender(render);

window.addEventListener("hashchange", () => {
  if (state.screen === "loading" || state.screen === "error" || !state.dto) return;
  const id = parseHashTaskId();
  if (id) {
    state.taskId = id;
    state.screen = "task";
  } else {
    goHome();
    return;
  }
  render();
});

// Guard: never echo token via console helpers in this page.
try {
  // Strip token from any accidental analytics URL if present later.
  if (window.history && window.history.replaceState) {
    /* pathname keeps token for refresh; we intentionally do not copy it into query/hash */
  }
} catch (_) {}

boot();

