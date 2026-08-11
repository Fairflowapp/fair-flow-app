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
  if (parts[0] === "onboarding" && parts[1]) return decodeURIComponent(parts[1]);
  return "";
}

export function parseHashTaskId() {
  const h = String(location.hash || "").replace(/^#/, "");
  const m = h.match(/^\/?tasks?\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function portalHttp(name, data) {
  const url = `https://us-central1-${projectId()}.cloudfunctions.net/${name}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: data || {} }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (json && json.error && json.error.message) ||
      `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.code = json && json.error && json.error.status;
    throw err;
  }
  return json.result;
}

export function applyDto(dto) {
  if (!dto) return;
  if (dto.sessionToken) state.sessionToken = dto.sessionToken;
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
  if (/cancel/i.test(msg)) state.errorKind = "cancelled";
  else if (/too many|try again later/i.test(msg) || e.status === 429) state.errorKind = "rate";
  else if (/invalid|expired|link/i.test(msg) || e.status === 401) state.errorKind = "invalid";
  else state.errorKind = "generic";
  state.screen = "error";
}

