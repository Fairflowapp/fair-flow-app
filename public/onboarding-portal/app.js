/**
 * Employee Onboarding Portal UI (Phase 2 + E4 e-sign).
 * Cloud Functions only — no Firestore / no public Storage SDK.
 * Token stays in the URL path for refresh; never logged to console/analytics.
 */

import { mountEsignSigner } from "./esign-signer.js?v=20260810_pdf_pinch_zoom";

const CF_NAMES = {
  bootstrap: "onboardingPortalBootstrap",
  getState: "onboardingPortalGetState",
  ack: "onboardingPortalAckPolicy",
  createUpload: "onboardingPortalCreateUpload",
  finalize: "onboardingPortalFinalizeUpload",
  getSignaturePacket: "onboardingPortalGetSignaturePacket",
  submitSignature: "onboardingPortalSubmitSignature",
};

const STATUS_LABELS = {
  pending: "Pending",
  in_progress: "In Progress",
  waiting_approval: "Waiting Approval",
  sealing: "Signing…",
  completed: "Completed",
  rejected: "Rejected",
  skipped: "Skipped",
};

/** @type {{ sessionToken: string|null, dto: any, screen: string, taskId: string|null, busy: boolean, error: string, uploadPct: number, esignCtl: any }} */
const state = {
  sessionToken: null,
  dto: null,
  screen: "loading", // loading | error | home | task | done
  taskId: null,
  busy: false,
  error: "",
  errorKind: "", // invalid | cancelled | generic
  uploadPct: 0,
  scrollOk: false,
  esignCtl: null,
};

function projectId() {
  try {
    if (window.__ff_firebase_project_id) return String(window.__ff_firebase_project_id);
    if (/fair-flow-staging/.test(location.host)) return "fair-flow-staging";
    if (/fairflowapp\.com/.test(location.host)) return "fairflowapp-db841";
  } catch (_) {}
  return "fair-flow-staging";
}

function parseTokenFromPath() {
  const parts = String(location.pathname || "").split("/").filter(Boolean);
  // /onboarding/{token}
  if (parts[0] === "onboarding" && parts[1]) return decodeURIComponent(parts[1]);
  return "";
}

function parseHashTaskId() {
  const h = String(location.hash || "").replace(/^#/, "");
  const m = h.match(/^\/?tasks?\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

async function portalHttp(name, data) {
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

function applyDto(dto) {
  if (!dto) return;
  if (dto.sessionToken) state.sessionToken = dto.sessionToken;
  state.dto = dto;
  if (dto.readOnly || (dto.run && dto.run.status === "completed")) {
    if (state.screen === "home" || state.screen === "done" || state.screen === "loading") {
      state.screen = "done";
    }
  }
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDue(due) {
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

function progressPct(run) {
  const p = (run && run.progress) || {};
  const total = Number(p.requiredTotal || 0);
  const done = Number(p.requiredCompleted || 0);
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function statusBadge(status) {
  const st = String(status || "pending");
  const label = STATUS_LABELS[st] || st;
  const cls = `badge badge-${st in STATUS_LABELS ? st : "pending"}`;
  return `<span class="${cls}">${esc(label)}</span>`;
}

function taskIcon(task) {
  if (task.taskType === "policy_acknowledgement") return "📋";
  if (task.taskType === "document" || task.taskType === "file_upload") return "📎";
  if (task.taskType === "electronic_signature") return "✍️";
  return "✓";
}

function destroyEsign() {
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

function root() {
  return document.getElementById("root");
}

function setErrorFromException(e) {
  const msg = String((e && e.message) || "Something went wrong.");
  state.error = msg;
  if (/cancel/i.test(msg)) state.errorKind = "cancelled";
  else if (/too many|try again later/i.test(msg) || e.status === 429) state.errorKind = "rate";
  else if (/invalid|expired|link/i.test(msg) || e.status === 401) state.errorKind = "invalid";
  else state.errorKind = "generic";
  state.screen = "error";
}

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

function renderHome(dto, { completedView }) {
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

function wireHome() {
  root().querySelectorAll("[data-task-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-task-id");
      openTask(id);
    });
  });
}

function openTask(taskId) {
  state.taskId = taskId;
  state.screen = "task";
  state.error = "";
  state.scrollOk = false;
  state.uploadPct = 0;
  try {
    history.replaceState(null, "", `#/task/${encodeURIComponent(taskId)}`);
  } catch (_) {}
  render();
}

function goHome() {
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
  render();
}

function renderTaskDetail(dto, task) {
  const readOnly = !!(dto.readOnly || dto.run.status === "completed");
  const st = String(task.status || "pending");
  let body = "";
  if (task.taskType === "policy_acknowledgement") {
    body = renderPolicy(task, readOnly);
  } else if (task.taskType === "document" || task.taskType === "file_upload") {
    body = renderUpload(task, readOnly);
  } else if (task.taskType === "electronic_signature") {
    body = `<div id="ffEsignMount" class="esign-mount"></div>`;
  } else {
    body = `<div class="alert alert-info">This task type isn’t supported in the portal yet. Please contact your manager.</div>`;
  }

  const isEsign = task.taskType === "electronic_signature";
  return `
    <button type="button" class="back-link" id="ffPortalBack">← Back to list</button>
    <div class="card ${isEsign ? "card-esign" : ""}">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
        <div>
          <h1 class="hero-title" style="font-size:20px;">${esc(task.templateNameSnapshot || "Task")}</h1>
          <p class="sub">${esc(
            isEsign
              ? (task.config && task.config.documentTitle) ||
                  task.categoryNameSnapshot ||
                  "Electronic signature"
              : task.categoryNameSnapshot || ""
          )}</p>
        </div>
        ${statusBadge(st)}
      </div>
      ${body}
      <div class="error-msg" id="ffPortalTaskErr">${esc(state.error)}</div>
    </div>`;
}

/** Client-side defense-in-depth for policy HTML (server already sanitizes). */
function sanitizePolicyHtmlClient(html) {
  let s = String(html == null ? "" : html);
  s = s.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "");
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  s = s.replace(/javascript:/gi, "");
  s = s.replace(/data:/gi, "");
  s = s.replace(
    /<\/?(?!\/?(p|br|ul|ol|li|strong|em|b|i|a|h1|h2|h3)\b)[^>]*>/gi,
    ""
  );
  return s.slice(0, 100000);
}

function renderPolicy(task, readOnly) {
  const cfg = task.config || {};
  const done = task.status === "completed";
  const html = sanitizePolicyHtmlClient(
    cfg.bodyHtml || "<p>No policy text provided.</p>"
  );
  const needName = cfg.requireTypedName === true;
  const needScroll = cfg.requireScrollToEnd === true && !done && !readOnly;

  return `
    ${done ? `<div class="alert alert-ok">Policy acknowledged. Thank you.</div>` : ""}
    ${readOnly && !done ? `<div class="alert alert-info">Viewing only.</div>` : ""}
    <div class="field">
      <label>Policy${cfg.version ? ` · v${esc(cfg.version)}` : ""}</label>
      <div class="policy-box" id="ffPolicyBox">${html}</div>
      ${needScroll ? `<p class="sub" style="margin-top:8px;" id="ffScrollHint">Scroll to the end to enable acknowledge.</p>` : ""}
    </div>
    ${
      needName && !done && !readOnly
        ? `<div class="field">
            <label for="ffTypedName">Type your full name</label>
            <input id="ffTypedName" type="text" autocomplete="name" placeholder="Full name">
          </div>`
        : ""
    }
    ${
      !done && !readOnly
        ? `<div class="btn-row">
            <button type="button" class="btn btn-primary" id="ffAckBtn" ${needScroll ? "disabled" : ""}>I acknowledge</button>
          </div>`
        : ""
    }
  `;
}

function renderUpload(task, readOnly) {
  const cfg = task.config || {};
  const st = String(task.status || "pending");
  const rejected = st === "rejected";
  const waiting = st === "waiting_approval";
  const done = st === "completed";
  const canUpload = !readOnly && !done && !waiting;
  const accept = Array.isArray(cfg.acceptedMime) ? cfg.acceptedMime.join(",") : "";
  const maxMb = Number(cfg.maxSizeMb) || 10;
  const reason =
    task.resultPublic && task.resultPublic.rejectionReason
      ? task.resultPublic.rejectionReason
      : "";

  let statusBlock = "";
  if (done) statusBlock = `<div class="alert alert-ok">Document approved.</div>`;
  else if (waiting)
    statusBlock = `<div class="alert alert-warn">Uploaded — waiting for manager approval.</div>`;
  else if (rejected)
    statusBlock = `<div class="alert alert-danger">Rejected${
      reason ? ": " + esc(reason) : ""
    }. Please upload again.</div>`;

  return `
    ${statusBlock}
    <p class="sub" style="margin-top:10px;">Accepted: ${esc(accept || "common documents/images")} · Max ${esc(String(maxMb))} MB</p>
    ${
      canUpload
        ? `
      <div class="file-drop" style="margin-top:14px;">
        <strong>${rejected ? "Upload a new file" : "Choose a file"}</strong>
        <span class="sub">Tap to browse</span>
        <input type="file" id="ffFileInput" ${accept ? `accept="${esc(accept)}"` : ""}>
      </div>
      <p class="sub" id="ffFileName" style="margin-top:8px;"></p>
      <div class="upload-bar" id="ffUploadBar"><i id="ffUploadFill"></i></div>
      ${
        cfg.requiresExpiration
          ? `<div class="field">
              <label for="ffExpDate">Expiration date</label>
              <input id="ffExpDate" type="date">
            </div>`
          : ""
      }
      <div class="field">
        <label for="ffNotes">Notes (optional)</label>
        <textarea id="ffNotes" rows="2" placeholder="Anything your manager should know"></textarea>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" id="ffUploadBtn" disabled>Upload</button>
      </div>`
        : ""
    }
    ${
      waiting && !readOnly
        ? `<div class="alert alert-info" style="margin-top:12px;">You can close this page. We’ll keep your submission for review.</div>`
        : ""
    }
  `;
}

function wireTaskDetail(task) {
  const back = document.getElementById("ffPortalBack");
  if (back) back.addEventListener("click", goHome);

  if (task.taskType === "electronic_signature") {
    destroyEsign();
    try {
      document.getElementById("app")?.classList.add("esign-mode");
    } catch (_) {}
    const mount = document.getElementById("ffEsignMount");
    if (mount) {
      state.esignCtl = mountEsignSigner(mount, {
        task,
        sessionToken: state.sessionToken,
        portalHttp,
        getPacketName: CF_NAMES.getSignaturePacket,
        submitName: CF_NAMES.submitSignature,
        onCompleted: async (result) => {
          try {
            // Prefer server state from submit; else refresh
            if (result && result.state) {
              applyDto(result.state);
            } else {
              const fresh = await portalHttp(CF_NAMES.getState, {
                sessionToken: state.sessionToken,
              });
              applyDto(fresh);
            }
          } catch (_) {}
          state.error = "";
          destroyEsign();
          if (
            state.dto &&
            (state.dto.readOnly ||
              (state.dto.run && state.dto.run.status === "completed"))
          ) {
            state.screen = "done";
            state.taskId = null;
            try {
              history.replaceState(null, "", location.pathname);
            } catch (_) {}
          } else {
            state.screen = "home";
            state.taskId = null;
            try {
              history.replaceState(null, "", location.pathname);
            } catch (_) {}
          }
          render();
        },
        onFatalError: (e) => {
          destroyEsign();
          setErrorFromException(e);
          render();
        },
      });
    }
    return;
  }

  if (task.taskType === "policy_acknowledgement") {
    const box = document.getElementById("ffPolicyBox");
    const btn = document.getElementById("ffAckBtn");
    const cfg = task.config || {};
    if (box && btn && cfg.requireScrollToEnd) {
      const check = () => {
        const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
        state.scrollOk = atEnd || box.scrollHeight <= box.clientHeight + 4;
        btn.disabled = !state.scrollOk || state.busy;
        const hint = document.getElementById("ffScrollHint");
        if (hint && state.scrollOk) hint.textContent = "Ready to acknowledge.";
      };
      box.addEventListener("scroll", check, { passive: true });
      setTimeout(check, 50);
    }
    if (btn) {
      btn.addEventListener("click", () => submitAck(task));
    }
  }

  if (task.taskType === "document" || task.taskType === "file_upload") {
    const input = document.getElementById("ffFileInput");
    const uploadBtn = document.getElementById("ffUploadBtn");
    const nameEl = document.getElementById("ffFileName");
    let file = null;
    if (input) {
      input.addEventListener("change", () => {
        file = input.files && input.files[0] ? input.files[0] : null;
        if (nameEl) nameEl.textContent = file ? file.name : "";
        if (uploadBtn) uploadBtn.disabled = !file || state.busy;
        state.error = "";
        const err = document.getElementById("ffPortalTaskErr");
        if (err) err.textContent = "";
      });
    }
    if (uploadBtn) {
      uploadBtn.addEventListener("click", () => {
        if (!file) return;
        submitUpload(task, file);
      });
    }
  }
}

async function submitAck(task) {
  if (state.busy) return;
  const cfg = task.config || {};
  const typedEl = document.getElementById("ffTypedName");
  const typedName = typedEl ? String(typedEl.value || "").trim() : "";
  if (cfg.requireTypedName && !typedName) {
    state.error = "Please type your full name.";
    const err = document.getElementById("ffPortalTaskErr");
    if (err) err.textContent = state.error;
    return;
  }
  if (cfg.requireScrollToEnd && !state.scrollOk) {
    state.error = "Please scroll to the end of the policy.";
    const err = document.getElementById("ffPortalTaskErr");
    if (err) err.textContent = state.error;
    return;
  }
  state.busy = true;
  const btn = document.getElementById("ffAckBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saving…";
  }
  try {
    const dto = await portalHttp(CF_NAMES.ack, {
      sessionToken: state.sessionToken,
      taskId: task.id,
      typedName: typedName || undefined,
    });
    applyDto(dto);
    state.error = "";
    if (dto.readOnly || (dto.run && dto.run.status === "completed")) {
      state.screen = "done";
      state.taskId = null;
      try {
        history.replaceState(null, "", location.pathname);
      } catch (_) {}
    }
    render();
  } catch (e) {
    state.error = (e && e.message) || "Could not save acknowledgement.";
    const err = document.getElementById("ffPortalTaskErr");
    if (err) err.textContent = state.error;
    if (btn) {
      btn.disabled = false;
      btn.textContent = "I acknowledge";
    }
  } finally {
    state.busy = false;
  }
}

function extMimeGuess(name) {
  const n = String(name || "").toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".heic")) return "image/heic";
  return "";
}

function mimeAllowed(file, acceptedMime) {
  if (!Array.isArray(acceptedMime) || !acceptedMime.length) return true;
  const name = String(file.name || "").toLowerCase();
  const type = String(file.type || extMimeGuess(name) || "").toLowerCase();
  return acceptedMime.some((rule) => {
    const r = String(rule || "").trim().toLowerCase();
    if (!r) return false;
    if (r.endsWith("/*")) {
      const prefix = r.slice(0, -1);
      return type.startsWith(prefix);
    }
    if (r.startsWith(".")) return name.endsWith(r);
    return type === r;
  });
}

function putWithProgress(uploadUrl, file, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);
    xhr.setRequestHeader("Content-Type", contentType || file.type || "application/octet-stream");
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.send(file);
  });
}

async function submitUpload(task, file) {
  if (state.busy || !file) return;
  const cfg = task.config || {};
  const maxMb = Number(cfg.maxSizeMb) || 10;
  if (file.size > maxMb * 1024 * 1024) {
    state.error = `File must be under ${maxMb} MB.`;
    const err = document.getElementById("ffPortalTaskErr");
    if (err) err.textContent = state.error;
    return;
  }
  if (!mimeAllowed(file, cfg.acceptedMime)) {
    state.error = "This file type is not accepted.";
    const err = document.getElementById("ffPortalTaskErr");
    if (err) err.textContent = state.error;
    return;
  }
  const expEl = document.getElementById("ffExpDate");
  const notesEl = document.getElementById("ffNotes");
  const expirationDate = expEl ? String(expEl.value || "").trim() : "";
  if (cfg.requiresExpiration && !expirationDate) {
    state.error = "Expiration date is required.";
    const err = document.getElementById("ffPortalTaskErr");
    if (err) err.textContent = state.error;
    return;
  }

  state.busy = true;
  const btn = document.getElementById("ffUploadBtn");
  const bar = document.getElementById("ffUploadBar");
  const fill = document.getElementById("ffUploadFill");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Uploading…";
  }
  if (bar) bar.style.display = "block";
  if (fill) fill.style.width = "0%";

  try {
    const contentType =
      file.type || extMimeGuess(file.name) || "application/octet-stream";
    const created = await portalHttp(CF_NAMES.createUpload, {
      sessionToken: state.sessionToken,
      taskId: task.id,
      fileName: file.name,
      contentType,
      size: file.size,
    });
    await putWithProgress(created.uploadUrl, file, contentType, (pct) => {
      state.uploadPct = pct;
      if (fill) fill.style.width = `${pct}%`;
    });
    if (fill) fill.style.width = "100%";
    if (btn) btn.textContent = "Finalizing…";
    const fin = await portalHttp(CF_NAMES.finalize, {
      sessionToken: state.sessionToken,
      uploadId: created.uploadId,
      expirationDate: expirationDate || undefined,
      notes: notesEl ? String(notesEl.value || "").trim() || undefined : undefined,
    });
    if (fin && fin.state) applyDto(fin.state);
    else if (state.sessionToken) {
      const fresh = await portalHttp(CF_NAMES.getState, {
        sessionToken: state.sessionToken,
      });
      applyDto(fresh);
    }
    state.error = "";
    render();
  } catch (e) {
    state.error = (e && e.message) || "Upload failed.";
    const err = document.getElementById("ffPortalTaskErr");
    if (err) err.textContent = state.error;
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Upload";
    }
  } finally {
    state.busy = false;
  }
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
