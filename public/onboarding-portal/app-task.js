/**
 * Onboarding portal UI — task detail (policy / upload / e-sign).
 */

import { mountEsignSigner } from "./esign-signer.js?v=20260810_od_split_v1";
import {
  state,
  CF_NAMES,
  esc,
  statusBadge,
  portalHttp,
  applyDto,
  setErrorFromException,
  requestRender,
  destroyEsign,
} from "./app-shared.js?v=20260810_od_split_v1";
import { goHome } from "./app-home.js?v=20260810_od_split_v1";

export function renderTaskDetail(dto, task) {
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
export function sanitizePolicyHtmlClient(html) {
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

export function renderPolicy(task, readOnly) {
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

export function renderUpload(task, readOnly) {
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

export function wireTaskDetail(task) {
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
          requestRender();
        },
        onFatalError: (e) => {
          destroyEsign();
          setErrorFromException(e);
          requestRender();
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

export async function submitAck(task) {
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
    requestRender();
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

export function extMimeGuess(name) {
  const n = String(name || "").toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".heic")) return "image/heic";
  return "";
}

export function mimeAllowed(file, acceptedMime) {
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

export function putWithProgress(uploadUrl, file, contentType, onProgress) {
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

export async function submitUpload(task, file) {
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
    requestRender();
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

