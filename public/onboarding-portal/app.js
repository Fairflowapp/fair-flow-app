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
} from "./app-shared.js?v=20260812_od_portal_sameorigin";
import { renderHome, wireHome, goHome } from "./app-home.js?v=20260812_od_portal_sameorigin";
import { renderTaskDetail, wireTaskDetail } from "./app-task.js?v=20260812_od_portal_sameorigin";

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
        : state.errorKind === "used"
          ? "Link already used"
          : state.errorKind === "invalid"
            ? "Link unavailable"
            : state.errorKind === "rate"
              ? "Please wait"
              : "Unable to open";
    const body =
      state.errorKind === "cancelled"
        ? "This onboarding was cancelled. Ask your manager for help."
        : state.errorKind === "used"
          ? "This link was already opened. Ask your manager for a new link."
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


const SESS_TTL_MS = 2 * 60 * 60 * 1000 - 30 * 1000;

function sessionStoreKey(token) {
  return "ff_od_sess_v1_" + String(token || "").slice(-20);
}

function loadStoredSession(token) {
  try {
    const raw = sessionStorage.getItem(sessionStoreKey(token));
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || !o.sessionToken) return null;
    if (o.exp && Date.now() > Number(o.exp)) {
      sessionStorage.removeItem(sessionStoreKey(token));
      return null;
    }
    return String(o.sessionToken);
  } catch (_) {
    return null;
  }
}

function saveStoredSession(token, sessionToken) {
  try {
    if (!sessionToken) return;
    sessionStorage.setItem(
      sessionStoreKey(token),
      JSON.stringify({
        sessionToken: String(sessionToken),
        exp: Date.now() + SESS_TTL_MS,
      })
    );
  } catch (_) {}
}

function clearStoredSession(token) {
  try {
    sessionStorage.removeItem(sessionStoreKey(token));
  } catch (_) {}
}

function paintFromDto(dto) {
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
}

async function boot() {
  try { if (typeof window.__ffPortalMarkBooted === "function") window.__ffPortalMarkBooted(); } catch (_) {}
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
  const stored = loadStoredSession(token);
  if (stored) {
    try {
      const dto = await portalHttp(CF_NAMES.getState, { sessionToken: stored });
      if (dto && dto.sessionToken) saveStoredSession(token, dto.sessionToken);
      paintFromDto(dto);
      render();
      return;
    } catch (e) {
      clearStoredSession(token);
      const msg = String((e && e.message) || "");
      if (/cancel/i.test(msg)) {
        setErrorFromException(e);
        render();
        return;
      }
    }
  }
  try {
    const dto = await portalHttp(CF_NAMES.bootstrap, { token });
    if (dto && dto.sessionToken) saveStoredSession(token, dto.sessionToken);
    paintFromDto(dto);
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

