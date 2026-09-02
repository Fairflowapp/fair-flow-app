/**
 * Onboarding portal UI — shared state + HTTP helpers.
 */

export const CF_NAMES = {
  bootstrap: "onboardingPortalBootstrap",
  getState: "onboardingPortalGetState",
  ack: "onboardingPortalAckPolicy",
  createUpload: "onboardingPortalCreateUpload",
  finalize: "onboardingPortalFinalizeUpload",
  getSignaturePacket: "onboardingPortalGetSignaturePacket",
  submitSignature: "onboardingPortalSubmitSignature",
};

export const STATUS_LABELS = {
  pending: "Pending",
  in_progress: "In Progress",
  waiting_approval: "Waiting Approval",
  sealing: "Signing…",
  completed: "Completed",
  rejected: "Rejected",
  skipped: "Skipped",
};

/** @type { sessionToken: string|null, dto: any, screen: string, taskId: string|null, busy: boolean, error: string, uploadPct: number, esignCtl: any } */
export const state = {
  sessionToken: null,
  dto: null,
  screen: "loading",
  taskId: null,
  busy: false,
  error: "",
  errorKind: "",
  uploadPct: 0,
  scrollOk: false,
  esignCtl: null,
};

let _requestRender = () => {};
export function bindRequestRender(fn) {
  _requestRender = typeof fn === "function" ? fn : () => {};
}
export function requestRender() {
  _requestRender();
}

export function projectId() {
  try {
    if (window.__ff_firebase_project_id) return String(window.__ff_firebase_project_id);
    if (/fair-flow-staging/.test(location.host)) return "fair-flow-staging";
    if (/fairflowapp\.com/.test(location.host)) return "fairflowapp-db841";
  } catch (_) {}
  return "fair-flow-staging";
}

export function parseTokenFromPath() {
  const parts = String(location.pathname || "").split("/").filter(Boolean);
  // /onboarding/{token}
  if (parts[0] === "onboarding" && parts[1]) {
    let tok = parts[1];
    try {
      tok = decodeURIComponent(tok);
    } catch (_) {}
    // Strip tracking junk some mail clients append into the path segment.
    tok = String(tok || "")
      .split("?")[0]
      .split("#")[0]
      .replace(/[^A-Za-z0-9_-]/g, "");
    return tok;
  }
  // Fallback: ?token= / ?t=
  try {
    const q = new URLSearchParams(location.search || "");
    const t = q.get("token") || q.get("t") || "";
    return String(t).replace(/[^A-Za-z0-9_-]/g, "");
  } catch (_) {
    return "";
  }
}

export function parseHashTaskId() {
  const h = String(location.hash || "").replace(/^#/, "");
  const m = h.match(/^\/?tasks?\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

async function _fetchPortal(url, data, timeoutMs) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer =
    ctrl && timeoutMs
      ? setTimeout(() => {
          try {
            ctrl.abort();
          } catch (_) {}
        }, timeoutMs)
      : null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: data || {} }),
      signal: ctrl ? ctrl.signal : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Prefer same-origin /api/* (Firebase Hosting → Function rewrite).
 * In-app browsers (Gmail etc.) often break cross-origin calls to *.cloudfunctions.net.
 */
export async function portalHttp(name, data, opts) {
  const fn = String(name || "").trim();
  // Seal/submit can exceed 20s on mobile — allow longer for signature submit.
  const isSubmit = /SubmitSignature$/i.test(fn);
  const isUpload = /CreateUpload$/i.test(fn);
  const timeoutMs =
    (opts && Number(opts.timeoutMs)) ||
    (isSubmit ? 120000 : isUpload ? 90000 : 25000);
  const urls = [
    `/api/${fn}`,
    `https://us-central1-${projectId()}.cloudfunctions.net/${fn}`,
  ];
  let lastErr = null;
  for (let i = 0; i < urls.length; i++) {
    try {
      const { res, json } = await _fetchPortal(urls[i], data, timeoutMs);
      if (!res.ok) {
        const msg =
          (json && json.error && json.error.message) ||
          `Request failed (${res.status})`;
        const err = new Error(msg);
        err.status = res.status;
        err.code = json && json.error && json.error.status;
        // Don't fall back on auth/business errors — only on network/5xx/HTML mishaps
        if (res.status >= 400 && res.status < 500 && res.status !== 404) {
          throw err;
        }
        lastErr = err;
        continue;
      }
      return json.result;
    } catch (e) {
      lastErr = e;
      const aborted = e && (e.name === "AbortError" || /abort/i.test(String(e.message || "")));
      const network =
        aborted ||
        (e && /Failed to fetch|NetworkError|Load failed|abort/i.test(String(e.message || e)));
      if (!network && e && e.status && e.status < 500) throw e;
      // try next URL
    }
  }
  if (lastErr && lastErr.name === "AbortError") {
    throw new Error("Request timed out. Check your connection and try again.");
  }
  throw lastErr || new Error("Request failed.");
}

const SESS_TTL_MS = 2 * 60 * 60 * 1000 - 30 * 1000;

function persistSession(sessionToken) {
  try {
    const token = parseTokenFromPath();
    if (!token || !sessionToken) return;
    sessionStorage.setItem(
      "ff_od_sess_v1_" + String(token).slice(-20),
      JSON.stringify({
        sessionToken: String(sessionToken),
        exp: Date.now() + SESS_TTL_MS,
      })
    );
  } catch (_) {}
}

export function applyDto(dto) {
  if (!dto) return;
  if (dto.sessionToken) {
    state.sessionToken = dto.sessionToken;
    persistSession(dto.sessionToken);
  }
  state.dto = dto;
  if (dto.readOnly || (dto.run && dto.run.status === "completed")) {
    if (state.screen === "home" || state.screen === "done" || state.screen === "loading") {
      state.screen = "done";
    }
  }
}

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatDue(due) {
  if (!due) return "";
  try {
    if (typeof due === "string") {
      const d = new Date(due);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
      }
      return due;
    }
    if (due.seconds) {
      return new Date(due.seconds * 1000).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
  } catch (_) {}
  return "";
}

export function progressPct(run) {
  const p = (run && run.progress) || {};
  const total = Number(p.requiredTotal || 0);
  const done = Number(p.requiredCompleted || 0);
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

export function statusBadge(status) {
  const st = String(status || "pending");
  const label = STATUS_LABELS[st] || st;
  const cls = `badge badge-${st in STATUS_LABELS ? st : "pending"}`;
  return `<span class="${cls}">${esc(label)}</span>`;
}

export function taskIcon(task) {
  if (task.taskType === "policy_acknowledgement") return "📋";
  if (task.taskType === "document" || task.taskType === "file_upload") return "📎";
  if (task.taskType === "electronic_signature") return "✍️";
  return "✓";
}

export function destroyEsign() {
  if (state.esignCtl && typeof state.esignCtl.destroy === "function") {
    try {
      state.esignCtl.destroy();
    } catch (_) {}
  }
  state.esignCtl = null;
  try {
    document.getElementById("app")?.classList.remove("esign-mode");
  } catch (_) {}
}

export function root() {
  return document.getElementById("root");
}

export function setErrorFromException(e) {
  const msg = String((e && e.message) || "Something went wrong.");
  state.error = msg;
  if (/already used/i.test(msg)) state.errorKind = "used";
  else if (/cancel/i.test(msg)) state.errorKind = "cancelled";
  else if (/too many|try again later/i.test(msg) || e.status === 429) state.errorKind = "rate";
  else if (/invalid|expired|link/i.test(msg) || e.status === 401) state.errorKind = "invalid";
  else state.errorKind = "generic";
  state.screen = "error";
}

