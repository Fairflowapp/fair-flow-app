/**
 * Employee Onboarding Runs — task rows, PDF viewer, policy/upload modals, panel + mount.
 */

import {
  odUiState,
  _esc,
  _toast,
  _canManage,
  _statusLabel,
  _taskStatusHtml,
  _taskTypeLabel,
  _fmtWhen,
  _esignCfg,
  _esignResult,
  _dueLabel,
  _portalMetaHtml,
  _portalOpened,
  _staffEmail,
  _hasPortalEmailSent,
  _syncOdShellStartUi,
  _inviteEmployeeByEmail,
  _closeModal,
  _openModal,
} from "./run-ui-shared.js?v=20260815_od_s6";
import { ffOpenStartOnboardingModal } from "./run-ui-start-modal.js?v=20260815_od_s6";
import { ffOpenInAppDocumentOverlay } from "/inapp-pdf-viewer.js?v=20260825_od_iospdf";

let _odUnsubRuns = null;
let _odUnsubTasks = null;
let _odStaffId = null;
const _odPromotedUploads = new Set();

function _promoteWaitingUploads(staff, runId, tasks) {
  if (!staff || !runId || !Array.isArray(tasks)) return;
  if (typeof window.ffPromoteOnboardingWaitingUpload !== "function") return;
  tasks.forEach((task) => {
    if (!task || !task.id) return;
    if (task.taskType !== "document" && task.taskType !== "file_upload") return;
    if (String(task.status || "") !== "waiting_approval") return;
    const key = `${staff.id}:${runId}:${task.id}`;
    if (_odPromotedUploads.has(key)) return;
    _odPromotedUploads.add(key);
    window.ffPromoteOnboardingWaitingUpload({
      staffId: staff.id,
      runId,
      taskId: task.id,
    }).catch((e) => {
      _odPromotedUploads.delete(key);
      console.warn("[OnboardingRun] promote waiting upload", e);
    });
  });
}
let _odRunsCache = [];
let _odTasksByRun = {};

function _teardownSubs() {
  try {
    if (_odUnsubRuns) _odUnsubRuns();
  } catch (_) {}
  try {
    if (_odUnsubTasks) _odUnsubTasks();
  } catch (_) {}
  _odUnsubRuns = null;
  _odUnsubTasks = null;
}

function _renderEsignSummary(task, opts) {
  const manage = !!(opts && opts.manage);
  const cancelled = !!(opts && opts.cancelled);
  const cfg = _esignCfg(task);
  const res = _esignResult(task);
  const st = String(task.status || "pending");
  const failed =
    (st === "in_progress" || st === "pending") && !!res.lastSealError;
  const canVoid =
    manage &&
    !cancelled &&
    (st === "completed" || st === "sealing");
  const voidBtn = canVoid
    ? `<button type="button" data-od-act="esign_reopen" data-task="${_esc(task.id)}" title="Void this form only and email the employee to fill it again" style="padding:6px 10px;border:1px solid #fecaca;border-radius:7px;background:#fff;color:#b91c1c;font-size:11px;font-weight:700;cursor:pointer;">Void this form &amp; send again</button>`
    : "";

  const encMapEarly =
    res.fieldValuesEncrypted && typeof res.fieldValuesEncrypted === "object"
      ? res.fieldValuesEncrypted
      : {};
  const hasEncryptedFields = Object.keys(encMapEarly).length > 0;

  if (
    (st === "completed" &&
      (res.signedPdfSha256 || res.signedDocumentId || res.signedStoragePath)) ||
    hasEncryptedFields
  ) {
    const docName =
      cfg.documentTitle || task.templateNameSnapshot || "Document";
    const version =
      cfg.documentVersion != null
        ? cfg.documentVersion
        : res.documentVersionId || "—";
    const signedWhen = _fmtWhen(res.signedAt || task.completedAt);
    const signer = res.signerName || "—";
    const pub =
      res.fieldValuesPublic && typeof res.fieldValuesPublic === "object"
        ? res.fieldValuesPublic
        : {};
    const enc = encMapEarly;
    const sensitiveRows = Object.keys(enc)
      .map((fid) => {
        const p = pub[fid] || {};
        const e = enc[fid] || {};
        const display =
          p.displayValue ||
          (e.last4
            ? e.sensitiveKind === "ssn"
              ? `***-**-${e.last4}`
              : `••••${e.last4}`
            : "••••");
        const label = p.label || fid;
        return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid #f3f4f6;">
          <span style="font-size:11px;color:#374151;"><span style="color:#9ca3af;">${_esc(label)}</span> · ${_esc(display)}</span>
          <button type="button" data-od-act="esign_reveal_sensitive" data-task="${_esc(task.id)}" data-field="${_esc(fid)}" style="padding:4px 8px;border:1px solid #fde68a;border-radius:6px;background:#fffbeb;color:#92400e;font-size:10px;font-weight:700;cursor:pointer;">Reveal</button>
        </div>`;
      })
      .join("");
    const sealed =
      st === "completed" &&
      !!(res.signedPdfSha256 || res.signedDocumentId || res.signedStoragePath);
    return `<div style="margin-top:10px;padding:12px 14px;border:1px solid #e5e7eb;border-radius:12px;background:#fafafa;">
      <div style="font-size:13px;font-weight:700;color:#111827;line-height:1.3;">${_esc(docName)}</div>
      <div style="font-size:11px;font-weight:700;color:${sealed ? "#065f46" : "#92400e"};margin-top:4px;">${sealed ? "E-signed · Completed" : "Sensitive fields (encrypted)"}</div>
      ${
        sealed
          ? `<div style="display:grid;grid-template-columns:72px 1fr;gap:3px 10px;font-size:11px;color:#374151;line-height:1.45;margin-top:8px;">
        <span style="color:#9ca3af;">Signed</span><span>${_esc(signedWhen || "—")}</span>
        <span style="color:#9ca3af;">Signer</span><span>${_esc(signer)}</span>
        <span style="color:#9ca3af;">Version</span><span>${_esc(String(version))}</span>
      </div>`
          : ""
      }
      ${
        sensitiveRows
          ? `<div style="margin-top:8px;"><div style="font-size:10px;font-weight:700;color:#92400e;margin-bottom:4px;">Sensitive fields (masked)</div>${sensitiveRows}</div>`
          : ""
      }
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;align-items:center;">
        ${
          res.signedPdfSha256 || res.signedDocumentId || res.signedStoragePath
            ? `<button type="button" data-od-act="esign_view_signed" data-task="${_esc(task.id)}" style="padding:6px 10px;border:1px solid #111827;border-radius:7px;background:#111827;color:#fff;font-size:11px;font-weight:600;cursor:pointer;">View signed PDF</button>`
            : ""
        }
        ${
          res.certificateDocumentId || res.certificateStoragePath
            ? `<button type="button" data-od-act="esign_view_cert" data-task="${_esc(task.id)}" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:7px;background:#fff;font-size:11px;font-weight:600;cursor:pointer;">View certificate</button>`
            : ""
        }
      </div>
      ${
        voidBtn
          ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid #ececec;">
        <div style="font-size:10px;color:#9ca3af;margin-bottom:6px;">This action applies only to ${_esc(docName)}.</div>
        ${voidBtn}
      </div>`
          : ""
      }
      ${
        hasEncryptedFields
          ? `<div style="font-size:10px;color:#9ca3af;margin-top:8px;line-height:1.4;">Sensitive values are masked here. Reveal is audited (who / when / field / IP). The signed PDF still shows the full value.</div>`
          : ""
      }
    </div>`;
  }

  if (failed) {
    return `<div style="margin-top:6px;font-size:11px;color:#b91c1c;line-height:1.4;">Signing failed — the employee can open the portal link and try again. Previous sealed documents (if any) were not overwritten.</div>`;
  }

  if (st === "sealing" || st === "in_progress" || st === "pending") {
    return `<div style="margin-top:8px;">
      <div style="font-size:11px;color:#6b7280;line-height:1.4;">Employee signs in the Onboarding Portal. Status updates when the signature is sealed.</div>
      ${
        voidBtn
          ? `<div style="margin-top:8px;">${voidBtn}</div>`
          : ""
      }
    </div>`;
  }

  return voidBtn ? `<div style="margin-top:8px;">${voidBtn}</div>` : "";
}

function _renderTaskRow(staff, run, task) {
  const manage = _canManage();
  const cancelled = run.status === "cancelled";
  const done = task.status === "completed" || task.status === "skipped";
  let actions = "";

  if (!cancelled && !done) {
    if (task.taskType === "policy_acknowledgement") {
      actions += `<button type="button" data-od-act="ack" data-task="${_esc(task.id)}" style="padding:5px 9px;border:1px solid #e5e7eb;border-radius:7px;background:#fff;font-size:11px;font-weight:600;cursor:pointer;">Open &amp; acknowledge</button>`;
    }
    if (task.taskType === "document" || task.taskType === "file_upload") {
      if (task.status === "waiting_approval") {
        actions += `<span style="font-size:11px;color:#6b7280;font-weight:600;">Saving to documents…</span>`;
      } else if (
        task.status === "rejected" ||
        task.status === "pending" ||
        task.status === "in_progress"
      ) {
        actions += `<button type="button" data-od-act="upload" data-task="${_esc(task.id)}" style="padding:5px 9px;border:1px solid #e5e7eb;border-radius:7px;background:#fff;font-size:11px;font-weight:600;cursor:pointer;">${task.status === "rejected" ? "Resubmit file" : "Upload file"}</button>`;
      }
    }
    if (task.taskType === "electronic_signature") {
      actions += `<button type="button" data-od-act="open_portal" data-task="${_esc(task.id)}" title="Open the employee portal for this task" style="padding:6px 10px;border:1px solid #ddd6fe;border-radius:8px;background:#f5f3ff;color:#5b21b6;font-size:11px;font-weight:700;cursor:pointer;">Open portal</button>`;
    }
    if (manage && task.required === false && task.status !== "skipped") {
      actions += `<button type="button" data-od-act="skip" data-task="${_esc(task.id)}" style="padding:5px 9px;border:1px solid #e5e7eb;border-radius:7px;background:#fafafa;font-size:11px;font-weight:600;cursor:pointer;color:#6b7280;">Skip</button>`;
    }
  }

  const rejectNote =
    task.status === "rejected" && task.result && task.result.rejectionReason
      ? `<div style="font-size:11px;color:#b91c1c;margin-top:4px;">Denied: ${_esc(task.result.rejectionReason)}</div>`
      : task.status === "rejected"
        ? `<div style="font-size:11px;color:#b91c1c;margin-top:4px;">Denied — resubmit a new file.</div>`
        : "";

  const esignBlock =
    task.taskType === "electronic_signature"
      ? _renderEsignSummary(task, { manage, cancelled })
      : "";

  return `<div data-od-task-row="${_esc(task.id)}" style="padding:12px 0;border-bottom:1px solid #f3f4f6;">
    <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:flex-start;">
      <div style="min-width:0;flex:1;">
        <div style="font-size:13px;font-weight:600;color:#111827;">${_esc(task.templateNameSnapshot || task.templateId)}</div>
        <div style="font-size:11px;color:#9ca3af;margin-top:2px;">
          ${_esc(_taskTypeLabel(task.taskType))}
          ${task.categoryNameSnapshot ? " · " + _esc(task.categoryNameSnapshot) : ""}
          · ${task.required === false ? "Optional" : "Required"}
          · ${_taskStatusHtml(task)}
        </div>
        ${rejectNote}
        ${esignBlock}
      </div>
      ${
        actions
          ? `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">${actions}</div>`
          : ""
      }
    </div>
  </div>`;
}

function _isIosMobileViewer() {
  try {
    if (document.documentElement.classList.contains("ff-ios-capacitor-safe")) {
      return true;
    }
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    return (
      /iPhone|iPad|iPod/i.test(ua) ||
      (platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
  } catch (_) {
    return false;
  }
}

function _openBlankTabForUrl() {
  try {
    const w = window.open("about:blank", "_blank");
    if (w) {
      try {
        w.opener = null;
      } catch (_) {}
    }
    return w;
  } catch (_) {
    return null;
  }
}

function _closeBlankTab(w) {
  try {
    if (w && !w.closed) w.close();
  } catch (_) {}
}

function _showPdfViewerOverlay(url, title) {
  if (!url) return false;
  return ffOpenInAppDocumentOverlay(url, title || "Signed PDF");
}

function _assignUrlToTabOrOverlay(url, tab, title) {
  if (!url) return false;
  if (_isIosMobileViewer()) {
    _closeBlankTab(tab);
    return _showPdfViewerOverlay(url, title);
  }
  if (tab && !tab.closed) {
    try {
      tab.location.href = url;
      return true;
    } catch (_) {
      _closeBlankTab(tab);
    }
  }
  // Popup blocked or tab missing — in-app viewer (same as Documents on mobile).
  if (_showPdfViewerOverlay(url, title)) return true;
  try {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch (_) {
    return false;
  }
}

async function _resolveStaffDocFile(staffId, documentId) {
  if (!staffId || !documentId) return { path: "", fileUrl: "", fileName: "" };
  try {
    const { doc, getDoc } = await import(
      "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js"
    );
    const { db } = await import("/app.js?v=20260610_force_lp_ios");
    const salonId = window.currentSalonId;
    const snap = await getDoc(
      doc(db, "salons", salonId, "staff", staffId, "documents", documentId)
    );
    if (!snap.exists()) return { path: "", fileUrl: "", fileName: "" };
    const d = snap.data() || {};
    return {
      path: String(d.storagePath || d.filePath || "").trim(),
      fileUrl: String(d.fileUrl || "").trim(),
      fileName: String(d.fileName || d.name || "").trim(),
    };
  } catch (_) {
    return { path: "", fileUrl: "", fileName: "" };
  }
}

async function _ensureArtifactReader() {
  if (
    typeof window.ffGetOnboardingArtifactReadUrl === "function" &&
    window.ffGetOnboardingArtifactReadUrl._ffFileB64
  ) {
    return true;
  }
  if (!document.querySelector('script[data-ff-od-run="artifact_b64"]')) {
    const s = document.createElement("script");
    s.type = "module";
    s.src = "/employee-onboarding/esign-library-cloud.js?v=20260825_od_iospdf";
    s.setAttribute("data-ff-od-run", "artifact_b64");
    document.body.appendChild(s);
  }
  for (let i = 0; i < 40; i += 1) {
    if (
      typeof window.ffGetOnboardingArtifactReadUrl === "function" &&
      window.ffGetOnboardingArtifactReadUrl._ffFileB64
    ) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return !!(
    typeof window.ffGetOnboardingArtifactReadUrl === "function" &&
    window.ffGetOnboardingArtifactReadUrl._ffFileB64
  );
}

async function _openEsignStoredPdf(staff, task, kind) {
  // Open blank tab synchronously so mobile/desktop popup blockers don't kill the view
  // after the async download URL resolve (Documents tab already does this).
  const tab = _isIosMobileViewer() ? null : _openBlankTabForUrl();
  const res = _esignResult(task);
  const title =
    kind === "cert"
      ? "Signature certificate"
      : (_esignCfg(task).documentTitle ||
          task.templateNameSnapshot ||
          "Signed PDF");
  let path =
    kind === "cert" ? res.certificateStoragePath : res.signedStoragePath;
  let fileName = title;

  const docId =
    kind === "cert" ? res.certificateDocumentId : res.signedDocumentId;
  if (docId) {
    const resolved = await _resolveStaffDocFile(staff.id, docId);
    if (!path) path = resolved.path;
    if (resolved.fileName) fileName = resolved.fileName;
  }
  if (!path && staff && staff.id && task && task.id) {
    const salonId = String(window.currentSalonId || "").trim();
    const runId = String(
      (task && task.runId) || odUiState.selectedRunId || ""
    ).trim();
    if (salonId && runId) {
      const file = kind === "cert" ? "certificate.pdf" : "signed.pdf";
      path = `onboardingArtifacts/${salonId}/sealed/${staff.id}/${runId}/${task.id}/${file}`;
    }
  }

  try {
    // S1/S7: never use client getDownloadURL — Storage denies onboarding artifacts.
    const ready = await _ensureArtifactReader();
    if (!ready) {
      _closeBlankTab(tab);
      _toast("Download is still loading — tap again in a moment.", "error");
      return;
    }
    const kindArg = kind === "cert" ? "certificate" : "signed";
    const meta = await window.ffGetOnboardingArtifactReadUrl({
      storagePath: path || undefined,
      staffId: staff && staff.id,
      runId: task && (task.runId || odUiState.selectedRunId),
      taskId: task && task.id,
      kind: kindArg,
    });
    const url = (meta && meta.readUrl) || "";
    if (!url) {
      _closeBlankTab(tab);
      _toast(
        kind === "cert"
          ? "Certificate file is missing."
          : "Signed PDF is missing.",
        "error"
      );
      return;
    }
    if (!_assignUrlToTabOrOverlay(url, tab, fileName || title)) {
      _closeBlankTab(tab);
      _toast("Could not open file", "error");
    }
  } catch (e) {
    _closeBlankTab(tab);
    console.warn("[OnboardingRun] esign view", e);
    _toast(e.message || "Could not open file", "error");
  }
}

async function _openPolicyModal(staff, run, task) {
  const cfg = task.configSnapshot || {};
  const body = String(cfg.bodyHtml || "<p>(No policy body)</p>");
  const requireName = cfg.requireTypedName === true;
  _openModal(
    `<div style="padding:18px;">
      <div style="display:flex;justify-content:space-between;gap:10px;">
        <div>
          <div style="font-size:16px;font-weight:700;">${_esc(task.templateNameSnapshot || "Policy")}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">Version ${_esc(cfg.version || "1.0")}</div>
        </div>
        <button type="button" id="ffOdModalClose" style="border:none;background:transparent;font-size:20px;cursor:pointer;color:#9ca3af;">×</button>
      </div>
      <div id="ffOdPolicyBody" style="margin-top:14px;max-height:40vh;overflow:auto;border:1px solid #e5e7eb;border-radius:10px;padding:12px;font-size:13px;line-height:1.5;color:#111827;">${body}</div>
      ${
        requireName
          ? `<label style="display:block;margin-top:12px;font-size:11px;font-weight:600;color:#6b7280;">Type your full name</label>
             <input id="ffOdAckName" type="text" style="width:100%;margin-top:6px;padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;box-sizing:border-box;" />`
          : ""
      }
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
        <button type="button" id="ffOdCancelBtn" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;font-size:12px;font-weight:600;cursor:pointer;">Cancel</button>
        <button type="button" id="ffOdAckBtn" style="padding:8px 14px;border:none;border-radius:8px;background:#111827;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">I acknowledge</button>
      </div>
    </div>`
  );
  document.getElementById("ffOdModalClose")?.addEventListener("click", _closeModal);
  document.getElementById("ffOdCancelBtn")?.addEventListener("click", _closeModal);
  const ackBtn = document.getElementById("ffOdAckBtn");
  ackBtn?.addEventListener("click", async () => {
    if (ackBtn.dataset.busy === "1") return;
    ackBtn.dataset.busy = "1";
    ackBtn.disabled = true;
    try {
      const typedName = document.getElementById("ffOdAckName")?.value || "";
      await window.ffAcknowledgeOnboardingPolicyTask({
        staffId: staff.id,
        runId: run.id,
        taskId: task.id,
        typedName,
      });
      _closeModal();
      _toast("Policy acknowledged.", "success");
    } catch (e) {
      _toast(e.message || "Could not acknowledge", "error");
      ackBtn.dataset.busy = "0";
      ackBtn.disabled = false;
    }
  });
}

async function _openUploadModal(staff, run, task) {
  const cfg = task.configSnapshot || {};
  const needsExp = cfg.requiresExpiration === true;
  _openModal(
    `<div style="padding:18px;">
      <div style="display:flex;justify-content:space-between;gap:10px;">
        <div>
          <div style="font-size:16px;font-weight:700;">Upload — ${_esc(task.templateNameSnapshot || "Document")}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">Uses the existing Inbox approval flow.</div>
        </div>
        <button type="button" id="ffOdModalClose" style="border:none;background:transparent;font-size:20px;cursor:pointer;color:#9ca3af;">×</button>
      </div>
      <label style="display:block;margin-top:14px;font-size:11px;font-weight:600;color:#6b7280;">File</label>
      <input type="file" id="ffOdUploadFile" style="margin-top:6px;width:100%;font-size:13px;" />
      ${
        needsExp
          ? `<label style="display:block;margin-top:12px;font-size:11px;font-weight:600;color:#6b7280;">Expiration date</label>
             <input type="date" id="ffOdUploadExp" style="width:100%;margin-top:6px;padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;box-sizing:border-box;" />`
          : ""
      }
      <label style="display:block;margin-top:12px;font-size:11px;font-weight:600;color:#6b7280;">Notes (optional)</label>
      <textarea id="ffOdUploadNotes" rows="2" style="width:100%;margin-top:6px;padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;box-sizing:border-box;font-size:13px;"></textarea>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
        <button type="button" id="ffOdCancelBtn" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;font-size:12px;font-weight:600;cursor:pointer;">Cancel</button>
        <button type="button" id="ffOdUploadBtn" style="padding:8px 14px;border:none;border-radius:8px;background:#111827;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">Submit to Inbox</button>
      </div>
    </div>`
  );
  document.getElementById("ffOdModalClose")?.addEventListener("click", _closeModal);
  document.getElementById("ffOdCancelBtn")?.addEventListener("click", _closeModal);
  const upBtn = document.getElementById("ffOdUploadBtn");
  upBtn?.addEventListener("click", async () => {
    if (upBtn.dataset.busy === "1") return;
    const fileInput = document.getElementById("ffOdUploadFile");
    const file = fileInput && fileInput.files && fileInput.files[0];
    if (!file) {
      _toast("Choose a file first.", "error");
      return;
    }
    if (needsExp && !document.getElementById("ffOdUploadExp")?.value) {
      _toast("Expiration date is required.", "error");
      return;
    }
    upBtn.dataset.busy = "1";
    upBtn.disabled = true;
    upBtn.textContent = "Uploading…";
    try {
      await window.ffSubmitOnboardingDocumentUpload({
        staffId: staff.id,
        runId: run.id,
        taskId: task.id,
        file,
        expirationDate: document.getElementById("ffOdUploadExp")?.value || null,
        notes: document.getElementById("ffOdUploadNotes")?.value || null,
      });
      _closeModal();
      _toast("Uploaded — waiting for Inbox approval.", "success");
    } catch (e) {
      console.error(e);
      _toast(e.message || "Upload failed", "error");
      upBtn.dataset.busy = "0";
      upBtn.disabled = false;
      upBtn.textContent = "Submit to Inbox";
    }
  });
}

function _wireTaskActions(host, staff, run, tasks) {
  host.querySelectorAll("[data-od-act]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const act = btn.getAttribute("data-od-act");
      const tid = btn.getAttribute("data-task");
      const task = (tasks || []).find((t) => t.id === tid);
      if (!task) return;
      if (act === "ack") {
        await _openPolicyModal(staff, run, task);
      } else if (act === "upload") {
        await _openUploadModal(staff, run, task);
      } else if (act === "esign_view_signed") {
        await _openEsignStoredPdf(staff, task, "signed");
      } else if (act === "esign_view_cert") {
        await _openEsignStoredPdf(staff, task, "cert");
      } else if (act === "open_portal") {
        if (typeof window.ffOpenOnboardingPortalLink !== "function") {
          _toast("Portal module not loaded yet.", "error");
          return;
        }
        btn.disabled = true;
        try {
          await window.ffOpenOnboardingPortalLink({
            staffId: staff.id,
            runId: run.id,
            taskId: task.id,
          });
        } catch (e) {
          _toast((e && e.message) || "Could not open portal", "error");
        } finally {
          btn.disabled = false;
        }
      } else if (act === "esign_reveal_sensitive") {
        const fieldId = btn.getAttribute("data-field");
        if (!fieldId) return;
        if (typeof window.ffRevealOnboardingSensitiveField !== "function") {
          _toast("Reveal module not loaded yet.", "error");
          return;
        }
        if (
          !window.confirm(
            "Reveal this sensitive value? This action is audited (who, when, field, IP)."
          )
        ) {
          return;
        }
        btn.disabled = true;
        try {
          const out = await window.ffRevealOnboardingSensitiveField({
            staffId: staff.id,
            runId: run.id,
            taskId: task.id,
            fieldId,
          });
          const value = out && out.plaintext != null ? String(out.plaintext) : "";
          try {
            window.alert(`Revealed value:\n\n${value}`);
          } catch (_) {
            _toast(value || "Revealed", "success");
          }
        } catch (e) {
          console.error("[OnboardingRun] reveal", e);
          _toast(e.message || "Reveal failed", "error");
          try {
            window.alert(e.message || "Reveal failed");
          } catch (_) {}
        } finally {
          btn.disabled = false;
        }
      } else if (act === "esign_reopen") {
        if (!_canManage()) return;
        if (btn.dataset.busy === "1") return;
        const formName = task.templateNameSnapshot || "this form";
        if (
          !window.confirm(
            `Void “${formName}” and email the employee to fill only this form again?\n\nOther completed documents stay as they are.`
          )
        ) {
          return;
        }
        btn.dataset.busy = "1";
        btn.disabled = true;
        try {
          if (typeof window.ffReopenOnboardingEsignTask !== "function") {
            throw new Error("Reopen is not loaded yet. Refresh and try again.");
          }
          await window.ffReopenOnboardingEsignTask({
            staffId: staff.id,
            runId: run.id,
            taskId: task.id,
          });
          if (typeof window.ffSendOnboardingPortalEmail === "function") {
            await window.ffSendOnboardingPortalEmail({
              staffId: staff.id,
              runId: run.id,
            });
          } else if (typeof window.ffSendOnboardingPortalReminder === "function") {
            await window.ffSendOnboardingPortalReminder({
              staffId: staff.id,
              runId: run.id,
            });
          }
          _toast(
            `Voided. An email was queued so they can complete ${formName}.`,
            "success"
          );
        } catch (e) {
          _toast(e.message || "Could not reopen this form", "error");
          btn.dataset.busy = "0";
          btn.disabled = false;
        }
      } else if (act === "skip") {
        if (!_canManage()) return;
        if (btn.dataset.busy === "1") return;
        btn.dataset.busy = "1";
        try {
          await window.ffSkipOnboardingTask(staff.id, run.id, task.id);
          _toast("Task skipped.", "success");
        } catch (e) {
          _toast(e.message || "Skip failed", "error");
          btn.dataset.busy = "0";
        }
      }
    });
  });
}

function _renderRunsPanel(host, staff) {
  if (!host) return;
  const manage = _canManage();
  const runs = (_odRunsCache || []).filter((r) => r && r.status !== "cancelled");
  const cancelled = (_odRunsCache || []).filter((r) => r && r.status === "cancelled");
  const active = runs[0] || null;
  if (odUiState.selectedRunId) {
    const found = (_odRunsCache || []).find((r) => r.id === odUiState.selectedRunId);
    if (found) {
      /* keep explicit chip click, including cancelled history */
    } else if (active) {
      odUiState.selectedRunId = active.id;
    }
  } else if (active) {
    odUiState.selectedRunId = active.id;
  } else if (cancelled[0]) {
    odUiState.selectedRunId = cancelled[0].id;
  }

  const selected =
    (_odRunsCache || []).find((r) => r.id === odUiState.selectedRunId) || active;
  const tasks = selected ? _odTasksByRun[selected.id] || [] : [];

  let runsListHtml = "";
  if (!(_odRunsCache || []).length) {
    // Idle empty state lives in #staffOdStartCard (Send package → modal).
    runsListHtml = "";
  } else {
    const chips = (_odRunsCache || [])
      .slice(0, 8)
      .map((r) => {
        const sel = selected && selected.id === r.id;
        return `<button type="button" data-od-run="${_esc(r.id)}" style="padding:6px 10px;border:1px solid ${sel ? "#111827" : "#e5e7eb"};border-radius:999px;background:${sel ? "#111827" : "#fff"};color:${sel ? "#fff" : "#374151"};font-size:11px;font-weight:600;cursor:pointer;">${_esc(r.packageNameSnapshot || r.packageId)} · ${_esc(_statusLabel(r.status))}</button>`;
      })
      .join(" ");
    runsListHtml = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">${chips}</div>`;

    if (selected) {
      const prog = selected.progress || {};
      const due = _dueLabel(selected.dueDate);
      runsListHtml +=
        `<div style="padding:12px;border:1px solid #f3f4f6;border-radius:10px;background:#fafafa;margin-bottom:10px;">
          <div style="font-size:14px;font-weight:700;color:#111827;">${_esc(selected.packageNameSnapshot || selected.packageId)}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;line-height:1.5;">
            Status: <strong style="color:#111827;">${_esc(_statusLabel(selected.status))}</strong>
            · Progress: ${Number(prog.requiredCompleted || 0)}/${Number(prog.requiredTotal || 0)} required
            (${Number(prog.completed || 0)}/${Number(prog.total || 0)} total)
            ${due ? " · Due: " + _esc(due) : ""}
          </div>
          ${
            manage && selected.status !== "cancelled"
              ? `<div style="margin-top:10px;display:flex;flex-direction:column;gap:8px;">
                  <div style="font-size:12px;color:#6b7280;line-height:1.45;" id="ffOdPortalMeta">${_portalMetaHtml(selected)}</div>
                  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                    ${
                      selected.status !== "completed"
                        ? _hasPortalEmailSent(selected)
                          ? `<button type="button" id="ffOdPrimaryInviteBtn" data-od-invite="reminder" style="padding:8px 14px;border:none;border-radius:8px;background:#7c3aed;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">Send Reminder</button>`
                          : `<button type="button" id="ffOdPrimaryInviteBtn" data-od-invite="invite" style="padding:8px 14px;border:none;border-radius:8px;background:#7c3aed;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">Send to employee</button>`
                        : ""
                    }
                    ${
                      selected.status !== "cancelled"
                        ? `<button type="button" id="ffOdOpenPortalBtn" style="padding:8px 12px;border:1px solid #c4b5fd;border-radius:8px;background:#f5f3ff;color:#5b21b6;font-size:12px;font-weight:700;cursor:pointer;">Open portal</button>
                           ${
                             !_portalOpened(selected)
                               ? `<button type="button" id="ffOdCopyPortalBtn" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;color:#374151;font-size:12px;font-weight:600;cursor:pointer;">Copy link</button>`
                               : ""
                           }
                           <button type="button" id="ffOdNewPortalBtn" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;color:#374151;font-size:12px;font-weight:600;cursor:pointer;">New link</button>
                           ${
                             selected.portal && selected.portal.activeTokenId
                               ? `<button type="button" id="ffOdRevokePortalBtn" style="padding:8px 12px;border:1px solid #fecaca;border-radius:8px;background:#fff;color:#b91c1c;font-size:12px;font-weight:600;cursor:pointer;">Revoke</button>`
                               : ""
                           }`
                        : ""
                    }
                    ${
                      selected.status !== "completed"
                        ? `<button type="button" id="ffOdCancelRunBtn" style="padding:8px 12px;border:1px solid #fecaca;border-radius:8px;background:#fff;color:#b91c1c;font-size:12px;font-weight:600;cursor:pointer;">Cancel run</button>`
                        : ""
                    }
                  </div>
                </div>`
              : ""
          }
        </div>
        <div style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">Tasks</div>
        <div id="ffOdTasksList">${tasks.map((t) => _renderTaskRow(staff, selected, t)).join("") || '<div style="font-size:12px;color:#9ca3af;">Loading tasks…</div>'}</div>`;
    }
  }

  const hasOpenRun = (_odRunsCache || []).some(
    (r) => r && r.status !== "cancelled"
  );
  _syncOdShellStartUi(host, hasOpenRun);

  const runsHost = host.querySelector("#staffOdRunsHost");
  if (runsHost) {
    runsHost.innerHTML = runsListHtml;
    runsHost.querySelectorAll("[data-od-run]").forEach((btn) => {
      btn.addEventListener("click", () => {
        odUiState.selectedRunId = btn.getAttribute("data-od-run");
        _subscribeTasks(staff, odUiState.selectedRunId);
        _renderRunsPanel(host, staff);
      });
    });
    const primaryBtn = runsHost.querySelector("#ffOdPrimaryInviteBtn");
    if (primaryBtn && selected) {
      primaryBtn.addEventListener("click", async () => {
        if (primaryBtn.dataset.busy === "1") return;
        const mode = primaryBtn.getAttribute("data-od-invite") || "invite";
        const staffEmail = _staffEmail(staff);
        if (mode === "reminder") {
          if (typeof window.ffSendOnboardingPortalReminder !== "function") {
            _toast("Reminder module not loaded yet.", "error");
            return;
          }
          if (
            selected.status === "completed" ||
            selected.status === "cancelled"
          ) {
            _toast("Reminders are only for active onboarding runs.", "error");
            return;
          }
          if (
            !window.confirm(
              staffEmail
                ? `Send a reminder email to ${staffEmail}?`
                : "Send an onboarding reminder email now?"
            )
          ) {
            return;
          }
          primaryBtn.dataset.busy = "1";
          const prev = primaryBtn.textContent;
          primaryBtn.textContent = "Sending…";
          try {
            const res = await window.ffSendOnboardingPortalReminder({
              staffId: staff.id,
              runId: selected.id,
            });
            _toast(
              res && res.skipped
                ? "Reminder already queued."
                : "Reminder email queued.",
              "success"
            );
            primaryBtn.textContent = "Sent";
            setTimeout(() => {
              primaryBtn.textContent = prev;
              primaryBtn.dataset.busy = "0";
            }, 1200);
          } catch (e) {
            _toast((e && e.message) || "Could not send reminder", "error");
            primaryBtn.textContent = prev;
            primaryBtn.dataset.busy = "0";
          }
          return;
        }
        if (!staffEmail || !staffEmail.includes("@")) {
          _toast(
            "This team member has no email on file. Add an email on their profile first.",
            "error"
          );
          return;
        }
        if (
          !window.confirm(`Send the onboarding email to ${staffEmail}?`)
        ) {
          return;
        }
        primaryBtn.dataset.busy = "1";
        const prev = primaryBtn.textContent;
        primaryBtn.textContent = "Sending…";
        try {
          const res = await _inviteEmployeeByEmail(staff, selected.id);
          _toast(
            res && res.issuedNewToken
              ? `Email queued to ${(res && res.toMasked) || staffEmail} (new portal link).`
              : `Email queued to ${(res && res.toMasked) || staffEmail}.`,
            "success"
          );
          primaryBtn.textContent = "Sent";
          setTimeout(() => {
            primaryBtn.dataset.busy = "0";
          }, 800);
        } catch (e) {
          _toast((e && e.message) || "Could not send email", "error");
          primaryBtn.textContent = prev;
          primaryBtn.dataset.busy = "0";
        }
      });
    }
    const openPortalBtn = runsHost.querySelector("#ffOdOpenPortalBtn");
    if (openPortalBtn && selected) {
      openPortalBtn.addEventListener("click", async () => {
        if (openPortalBtn.dataset.busy === "1") return;
        if (typeof window.ffOpenOnboardingPortalLink !== "function") {
          _toast("Portal module not loaded yet.", "error");
          return;
        }
        openPortalBtn.dataset.busy = "1";
        try {
          await window.ffOpenOnboardingPortalLink({
            staffId: staff.id,
            runId: selected.id,
          });
        } catch (e) {
          _toast((e && e.message) || "Could not open portal", "error");
        } finally {
          openPortalBtn.dataset.busy = "0";
        }
      });
    }
    const copyPortalBtn = runsHost.querySelector("#ffOdCopyPortalBtn");
    if (copyPortalBtn && selected) {
      copyPortalBtn.addEventListener("click", async () => {
        if (copyPortalBtn.dataset.busy === "1") return;
        if (typeof window.ffCopyOnboardingPortalLink !== "function") {
          _toast("Portal module not loaded yet.", "error");
          return;
        }
        copyPortalBtn.dataset.busy = "1";
        try {
          await window.ffCopyOnboardingPortalLink({
            staffId: staff.id,
            runId: selected.id,
          });
        } catch (e) {
          _toast((e && e.message) || "Could not copy link", "error");
        } finally {
          copyPortalBtn.dataset.busy = "0";
        }
      });
    }
    const newPortalBtn = runsHost.querySelector("#ffOdNewPortalBtn");
    if (newPortalBtn && selected) {
      newPortalBtn.addEventListener("click", async () => {
        if (newPortalBtn.dataset.busy === "1") return;
        if (typeof window.ffReissueAndCopyOnboardingPortalLink !== "function") {
          _toast("Portal module not loaded yet.", "error");
          return;
        }
        if (
          !window.confirm(
            "Create a new portal link? The previous link will stop working."
          )
        ) {
          return;
        }
        newPortalBtn.dataset.busy = "1";
        try {
          await window.ffReissueAndCopyOnboardingPortalLink({
            staffId: staff.id,
            runId: selected.id,
          });
        } catch (e) {
          _toast((e && e.message) || "Could not create a new link", "error");
        } finally {
          newPortalBtn.dataset.busy = "0";
        }
      });
    }
    const revokePortalBtn = runsHost.querySelector("#ffOdRevokePortalBtn");
    if (revokePortalBtn && selected) {
      revokePortalBtn.addEventListener("click", async () => {
        if (revokePortalBtn.dataset.busy === "1") return;
        if (typeof window.ffRevokeOnboardingPortalToken !== "function") {
          _toast("Portal module not loaded yet.", "error");
          return;
        }
        if (
          !window.confirm(
            "Revoke the current portal link? The employee will not be able to open it."
          )
        ) {
          return;
        }
        revokePortalBtn.dataset.busy = "1";
        try {
          await window.ffRevokeOnboardingPortalToken({
            staffId: staff.id,
            runId: selected.id,
          });
          _toast("Portal link revoked.", "success");
        } catch (e) {
          _toast((e && e.message) || "Could not revoke link", "error");
        } finally {
          revokePortalBtn.dataset.busy = "0";
        }
      });
    }
    const cancelBtn = runsHost.querySelector("#ffOdCancelRunBtn");
    if (cancelBtn && selected) {
      cancelBtn.addEventListener("click", async () => {
        if (cancelBtn.dataset.busy === "1") return;
        const ok = window.confirm("Cancel this onboarding run?");
        if (!ok) return;
        cancelBtn.dataset.busy = "1";
        try {
          await window.ffCancelOnboardingRun(staff.id, selected.id);
          if (typeof window.ffRevokeOnboardingPortalToken === "function") {
            try {
              await window.ffRevokeOnboardingPortalToken({
                staffId: staff.id,
                runId: selected.id,
              });
            } catch (_) {}
          }
          _toast("Run cancelled.", "success");
        } catch (e) {
          _toast(e.message || "Cancel failed", "error");
          cancelBtn.dataset.busy = "0";
        }
      });
    }
    if (selected) {
      _wireTaskActions(runsHost, staff, selected, tasks);
    }
  }

  // unused cancelled list kept for future — silence lint
  void cancelled;
}

function _subscribeTasks(staff, runId) {
  try {
    if (_odUnsubTasks) _odUnsubTasks();
  } catch (_) {}
  _odUnsubTasks = null;
  if (!staff || !runId || typeof window.ffSubscribeOnboardingRunTasks !== "function") return;
  _odUnsubTasks = window.ffSubscribeOnboardingRunTasks(staff.id, runId, (tasks) => {
    _odTasksByRun[runId] = tasks || [];
    const host = document.getElementById("staffOdOnboardingPane");
    if (host && _odStaffId === staff.id) _renderRunsPanel(host, staff);
    _promoteWaitingUploads(staff, runId, tasks || []);
  });
}

/**
 * Wire Start button + subscribe runs into an already-rendered Stage C shell.
 */
export function ffMountStaffOnboardingRuns(pane, staff) {
  if (!pane || !staff || !staff.id) return;
  _teardownSubs();
  _odStaffId = staff.id;
  _odRunsCache = [];
  _odTasksByRun = {};
  odUiState.selectedRunId = null;

  const startBtn = pane.querySelector("#staffOdStartOnboardingBtn");
  if (startBtn) {
    // Keep the button clickable; prefer the global shell handler (inline + capture).
    startBtn.disabled = false;
    startBtn.removeAttribute("title");
    startBtn.style.background = "#7c3aed";
    startBtn.style.color = "#fff";
    startBtn.style.border = "none";
    startBtn.style.cursor = "pointer";
    startBtn.style.pointerEvents = "auto";
    startBtn.style.position = "relative";
    startBtn.style.zIndex = "50";
    window.__ffOdCurrentStaff = staff;
    pane.__ffOdStaff = staff;
    startBtn.onclick = (ev) => {
      if (typeof window.__ffOdStartOnboardingClick === "function") {
        return window.__ffOdStartOnboardingClick(ev);
      }
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      void ffOpenStartOnboardingModal(staff);
    };
  }

  // Ensure runs host exists (replace empty-state block if needed)
  let runsHost = pane.querySelector("#staffOdRunsHost");
  if (!runsHost) {
    // Find dashed empty-state container (last grid child) or append
    const grid = pane.querySelector("div[style*='display:grid']") || pane;
    runsHost = document.createElement("div");
    runsHost.id = "staffOdRunsHost";
    // Remove the Stage C empty-state dashed box if present
    const dashed = Array.from(grid.children || []).find(
      (el) => el && /No onboarding has been started/i.test(el.textContent || "")
    );
    if (dashed) dashed.replaceWith(runsHost);
    else grid.appendChild(runsHost);
  }
  runsHost.innerHTML =
    '<div style="font-size:12px;color:#9ca3af;">Loading onboarding runs…</div>';

  if (typeof window.ffSubscribeOnboardingRuns === "function") {
    _odUnsubRuns = window.ffSubscribeOnboardingRuns(staff.id, (runs) => {
      _odRunsCache = runs || [];
      if (!odUiState.selectedRunId && _odRunsCache.length) {
        const open = _odRunsCache.find((r) => r && r.status !== "cancelled");
        odUiState.selectedRunId = (open || _odRunsCache[0]).id;
      }
      if (odUiState.selectedRunId) _subscribeTasks(staff, odUiState.selectedRunId);
      _renderRunsPanel(pane, staff);
    });
  } else {
    runsHost.textContent = "Onboarding run module not loaded yet.";
  }
}

export function ffUnmountStaffOnboardingRuns() {
  _teardownSubs();
  _odStaffId = null;
  _odRunsCache = [];
  _odTasksByRun = {};
  odUiState.selectedRunId = null;
  _closeModal();
}
