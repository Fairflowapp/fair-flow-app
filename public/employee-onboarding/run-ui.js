/**
 * Employee Onboarding Runs — Stage D UI + E5 e-sign polish
 * Start Onboarding modal + Run/task list + policy ack + document upload + e-sign summary.
 */

import {
  ref as storageRef,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { storage } from "/app.js?v=20260610_force_lp_ios";

let _odUnsubRuns = null;
let _odUnsubTasks = null;
let _odStaffId = null;
let _odRunsCache = [];
let _odTasksByRun = {};
let _odSelectedRunId = null;
let _odCreateBusy = false;

function _esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function _toast(msg, type) {
  if (typeof window.showToast === "function") window.showToast(msg, type || "info");
  else console.log("[OnboardingRun]", msg);
}

function _canManage() {
  try {
    if (typeof window.ffCanManageOnboardingRunsClient === "function") {
      if (window.ffCanManageOnboardingRunsClient() === true) return true;
    }
    if (typeof window.ffCurrentUserCanManageGeneralSettings === "function") {
      if (window.ffCurrentUserCanManageGeneralSettings() === true) return true;
    }
    if (typeof window.ffIsOwner === "function" && window.ffIsOwner() === true) {
      return true;
    }
    const role = String(window.__ff_user_role || "").toLowerCase();
    if (role === "owner" || role === "admin" || role === "manager") return true;
  } catch (_) {}
  return false;
}

function _statusLabel(s) {
  const m = {
    draft: "Draft",
    sent: "Sent",
    in_progress: "In Progress",
    sealing: "Signing…",
    completed: "Completed",
    cancelled: "Cancelled",
    pending: "Pending",
    waiting_approval: "Waiting Approval",
    rejected: "Rejected",
    skipped: "Skipped",
    failed: "Failed",
  };
  return m[s] || String(s || "—");
}

/** Task status for display — e-sign maps seal failure to Failed without inventing a new persisted status. */
function _taskStatusLabel(task) {
  const st = String((task && task.status) || "pending");
  if (
    task &&
    task.taskType === "electronic_signature" &&
    (st === "in_progress" || st === "pending") &&
    task.result &&
    task.result.lastSealError
  ) {
    return "Failed";
  }
  if (task && task.taskType === "electronic_signature" && st === "sealing") {
    return "In Progress";
  }
  return _statusLabel(st);
}

/** Colored status chip for task list (Pending = orange). */
function _taskStatusHtml(task) {
  const label = _taskStatusLabel(task);
  const st = String((task && task.status) || "pending").toLowerCase();
  let color = "#6b7280";
  let weight = "600";
  if (st === "pending") {
    color = "#ea580c";
    weight = "700";
  } else if (st === "waiting_approval" || st === "in_progress" || st === "sealing") {
    color = "#b45309";
    weight = "700";
  } else if (st === "completed") {
    color = "#059669";
    weight = "700";
  } else if (st === "rejected" || st === "failed" || label === "Failed") {
    color = "#b91c1c";
    weight = "700";
  } else if (st === "skipped" || st === "cancelled") {
    color = "#9ca3af";
  }
  return `<span style="color:${color};font-weight:${weight};">${_esc(label)}</span>`;
}

function _taskTypeLabel(t) {
  if (typeof window.ffOnboardingTaskTypeLabel === "function") {
    return window.ffOnboardingTaskTypeLabel(t);
  }
  const m = {
    document: "Document",
    file_upload: "File upload",
    policy_acknowledgement: "Policy acknowledgement",
    electronic_signature: "Electronic signature",
  };
  return m[t] || t;
}

function _fmtWhen(raw) {
  if (!raw) return "";
  try {
    if (raw.toDate) return raw.toDate().toLocaleString();
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  } catch (_) {}
  return String(raw);
}

function _esignCfg(task) {
  return (task && (task.configSnapshot || task.config)) || {};
}

function _esignResult(task) {
  return (task && task.result) || {};
}

function _dueLabel(due) {
  if (!due) return "";
  if (typeof due === "string") return due;
  if (due.toDate) {
    try {
      return due.toDate().toISOString().slice(0, 10);
    } catch (_) {}
  }
  return String(due);
}

function _portalExpiresLabel(run) {
  const portal = (run && run.portal) || {};
  const exp = portal.expiresAt;
  if (!exp) return "";
  try {
    if (exp.toDate) return exp.toDate().toLocaleString();
    const d = new Date(exp);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  } catch (_) {}
  return _dueLabel(exp);
}

function _fmtPortalTs(t) {
  if (!t) return "";
  try {
    if (t.toDate) return t.toDate().toLocaleString();
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  } catch (_) {}
  return "";
}

function _portalEmailLabel(run) {
  const portal = (run && run.portal) || {};
  if (!portal.lastEmailSentAt && !portal.lastEmailStatus && !portal.lastReminderAt) {
    return "";
  }
  const parts = [];
  const status = String(portal.lastEmailStatus || "");
  const to = portal.lastEmailToMasked ? String(portal.lastEmailToMasked) : "";
  const when = _fmtPortalTs(portal.lastEmailSentAt);
  if (status === "queued" || status === "sent") {
    parts.push(`Email: <strong style="color:#059669;">${_esc(status)}</strong>`);
  } else if (status === "failed") {
    parts.push(`Email: <strong style="color:#b91c1c;">failed</strong>`);
  } else if (status) {
    parts.push(`Email: ${_esc(status)}`);
  }
  if (to) parts.push(_esc(to));
  if (when) parts.push(_esc(when));
  const count = Number(portal.emailSendCount || 0);
  if (count > 1) parts.push(`${count} sends`);

  const remWhen = _fmtPortalTs(portal.lastReminderAt);
  const remStatus = String(portal.lastReminderStatus || "");
  const remKind = String(portal.lastReminderKind || "");
  const remParts = [];
  if (remWhen || remStatus) {
    remParts.push(
      `Last reminder: <strong style="color:#111827;">${_esc(remWhen || "—")}</strong>`
    );
    if (remStatus) remParts.push(_esc(remStatus));
    if (remKind && remKind !== "manual") remParts.push(_esc(remKind.replace(/_/g, " ")));
    const remCount = Number(portal.reminderCount || 0);
    if (remCount > 0) remParts.push(`${remCount} total`);
  }

  let html = "";
  if (parts.length) html += `<div style="margin-top:4px;">${parts.join(" · ")}</div>`;
  if (remParts.length) html += `<div style="margin-top:4px;">${remParts.join(" · ")}</div>`;
  return html;
}

function _portalMetaHtml(run) {
  const portal = (run && run.portal) || {};
  const active = !!(portal.activeTokenId);
  const exp = _portalExpiresLabel(run);
  const emailLine = _portalEmailLabel(run);
  if (!active) {
    return `<span>Portal link: <strong style="color:#111827;">none active</strong> — tap <strong>Send to employee</strong> to invite them.</span>${emailLine}`;
  }
  return `<span>Portal link: <strong style="color:#059669;">active</strong>${
    exp ? ` · expires <strong style="color:#111827;">${_esc(exp)}</strong>` : ""
  }</span>${emailLine}`;
}

function _staffEmail(staff) {
  return String((staff && staff.email) || "").trim();
}

function _hasPortalEmailSent(run) {
  const portal = (run && run.portal) || {};
  return Number(portal.emailSendCount || 0) > 0 || !!portal.firstEmailSentAt;
}

function _syncOdShellStartUi(pane, hasOpenRun) {
  if (!pane) return;
  try {
    pane.dataset.odHasOpenRun = hasOpenRun ? "1" : "0";
  } catch (_) {}
  // Idle = Onboarding + Send package (opens modal). Hide once a run exists.
  const startCard = pane.querySelector("#staffOdStartCard");
  if (startCard) startCard.style.display = hasOpenRun ? "none" : "flex";
  const startBtn = pane.querySelector("#staffOdStartOnboardingBtn");
  if (startBtn) startBtn.style.display = hasOpenRun ? "none" : "";
  const packagesBlock = pane.querySelector("#staffOdPackagesBlock");
  if (packagesBlock) packagesBlock.style.display = "none";
  const note = pane.querySelector("#staffOdAlreadyStartedNote");
  if (note) note.remove();
}

async function _inviteEmployeeByEmail(staff, runId) {
  const email = _staffEmail(staff);
  if (!email || !email.includes("@")) {
    throw new Error(
      "This team member has no email on file. Add an email on their profile, then tap Send to employee."
    );
  }
  if (typeof window.ffSendOnboardingPortalEmail !== "function") {
    throw new Error("Portal email module not loaded yet.");
  }
  return window.ffSendOnboardingPortalEmail({
    staffId: staff.id,
    runId,
  });
}

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

function _ensureModalRoot() {
  let root = document.getElementById("ffOnboardingRunModalRoot");
  if (root) return root;
  root = document.createElement("div");
  root.id = "ffOnboardingRunModalRoot";
  document.body.appendChild(root);
  return root;
}

function _closeModal() {
  const root = document.getElementById("ffOnboardingRunModalRoot");
  if (root) root.innerHTML = "";
}

function _openModal(html) {
  const root = _ensureModalRoot();
  // Sit above staffMembersModal (100001) and other app overlays.
  root.style.cssText =
    "position:fixed;inset:0;z-index:2147483000;pointer-events:auto;";
  root.innerHTML =
    '<div id="ffOdModalBackdrop" style="position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;">' +
    '<div role="dialog" aria-modal="true" style="background:#fff;border-radius:14px;max-width:560px;width:100%;max-height:90vh;overflow:auto;box-shadow:0 20px 50px rgba(0,0,0,0.25);position:relative;z-index:2147483001;">' +
    html +
    "</div></div>";
  const backdrop = root.querySelector("#ffOdModalBackdrop");
  if (backdrop) {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) _closeModal();
    });
  }
  return root;
}

async function _ensurePackagesReady() {
  if (typeof window.ffEnsureOnboardingSettingsSubscribed !== "function") return;
  try {
    // Never hang the Start button on a stuck subscription promise.
    await Promise.race([
      window.ffEnsureOnboardingSettingsSubscribed(),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch (_) {}
}

async function _loadActivePackages() {
  await _ensurePackagesReady();
  if (typeof window.ffGetOnboardingPackages !== "function") return [];
  const pkgs = await window.ffGetOnboardingPackages();
  return (pkgs || []).filter((p) => p && p.active !== false);
}

async function _loadMatchedPackages(staff) {
  await _ensurePackagesReady();
  if (
    typeof window.ffGetOnboardingPackages !== "function" ||
    typeof window.ffFilterOnboardingPackagesForStaff !== "function"
  ) {
    return [];
  }
  const pkgs = await window.ffGetOnboardingPackages();
  return window.ffFilterOnboardingPackagesForStaff(pkgs || [], staff);
}

async function _previewTasksForPackage(pkg) {
  const templates =
    typeof window.ffGetOnboardingTaskTemplates === "function"
      ? await window.ffGetOnboardingTaskTemplates()
      : [];
  const categories =
    typeof window.ffGetOnboardingCategories === "function"
      ? await window.ffGetOnboardingCategories()
      : [];
  const templatesById = {};
  (templates || []).forEach((t) => {
    if (t && t.id) templatesById[t.id] = t;
  });
  const categoriesById = {};
  (categories || []).forEach((c) => {
    if (c && c.id) categoriesById[c.id] = c;
  });
  if (typeof window.ffBuildOnboardingRunSnapshot !== "function") return [];
  return window.ffBuildOnboardingRunSnapshot(pkg, templatesById, categoriesById);
}

export async function ffOpenStartOnboardingModal(staff, opts) {
  const preferredPackageId =
    opts && opts.packageId ? String(opts.packageId) : "";
  console.log("[OnboardingRun] open start modal", staff && staff.id, preferredPackageId);

  if (!staff || !staff.id) {
    _toast("Staff member not found.", "error");
    try {
      window.alert("Staff member not found.");
    } catch (_) {}
    return;
  }

  // Show UI immediately so a slow/hung package load never looks like a dead button.
  // Permission is enforced again on Start (and in cloud writes) — never block open.
  _openModal(
    `<div style="padding:18px 18px 8px;">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
        <div>
          <div style="font-size:16px;font-weight:700;color:#111827;">Start Onboarding</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">Choose a package — we&rsquo;ll email ${_esc(staff.name || "staff")} a portal link automatically.</div>
        </div>
        <button type="button" id="ffOdModalClose" style="border:none;background:transparent;font-size:20px;line-height:1;cursor:pointer;color:#9ca3af;">×</button>
      </div>
      <div id="ffOdModalBody" style="margin-top:14px;font-size:13px;color:#6b7280;">Loading packages…</div>
    </div>`
  );
  document.getElementById("ffOdModalClose")?.addEventListener("click", () => _closeModal());

  let activePkgs = [];
  try {
    activePkgs = await _loadActivePackages();
  } catch (e) {
    console.warn("[OnboardingRun] load packages failed", e);
    const body = document.getElementById("ffOdModalBody");
    if (body) {
      body.innerHTML = `<div style="color:#b91c1c;">${_esc(e.message || "Could not load packages")}</div>`;
    }
    return;
  }
  if (!activePkgs.length) {
    const body = document.getElementById("ffOdModalBody");
    if (body) {
      body.innerHTML =
        'No packages yet. Create one in <strong>Settings → Onboarding &amp; Documents → Packages</strong>.';
    }
    return;
  }

  // Owner chooses the package per employee — no auto-matching by classification.
  const selectable = activePkgs
    .slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  const options = selectable
    .map((p) => {
      const sel =
        preferredPackageId && preferredPackageId === p.id ? " selected" : "";
      return `<option value="${_esc(p.id)}"${sel}>${_esc(p.name || p.id)}</option>`;
    })
    .join("");

  const body = document.getElementById("ffOdModalBody");
  if (!body) return;
  body.innerHTML = `
      <label style="display:block;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">Package</label>
      <select id="ffOdPkgSelect" style="width:100%;margin-top:6px;padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;box-sizing:border-box;">${options}</select>
      <label style="display:block;margin-top:12px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">Due date (optional)</label>
      <input type="date" id="ffOdDueDate" style="width:100%;margin-top:6px;padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;box-sizing:border-box;" />
      <div style="margin-top:14px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">What they'll get</div>
      <div id="ffOdTaskPreview" style="margin-top:6px;border:1px solid #f3f4f6;border-radius:10px;padding:10px 12px;background:#fafafa;font-size:12px;color:#374151;min-height:48px;">Loading…</div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;padding-bottom:4px;">
        <button type="button" id="ffOdCancelBtn" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;font-size:12px;font-weight:600;cursor:pointer;">Cancel</button>
        <button type="button" id="ffOdCreateBtn" style="padding:8px 14px;border:none;border-radius:8px;background:#7c3aed;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">Start &amp; send email</button>
      </div>`;

  const close = () => _closeModal();
  document.getElementById("ffOdModalClose")?.addEventListener("click", close);
  document.getElementById("ffOdCancelBtn")?.addEventListener("click", close);

  const select = document.getElementById("ffOdPkgSelect");
  const previewEl = document.getElementById("ffOdTaskPreview");

  async function refreshPreview() {
    const pid = select?.value;
    const pkg = selectable.find((p) => p.id === pid);
    if (!pkg || !previewEl) return;
    previewEl.textContent = "Loading…";
    try {
      const tasks = await _previewTasksForPackage(pkg);
      if (!tasks.length) {
        previewEl.innerHTML =
          '<span style="color:#b91c1c;">This package has no active v1 tasks.</span>';
        return;
      }
      previewEl.innerHTML = tasks
        .map(
          (t) =>
            `<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid #f3f4f6;">
              <span><strong>${_esc(t.templateNameSnapshot)}</strong>
              <span style="color:#9ca3af;"> · ${_esc(_taskTypeLabel(t.taskType))}</span>
              ${t.categoryNameSnapshot ? `<span style="color:#9ca3af;"> · ${_esc(t.categoryNameSnapshot)}</span>` : ""}
              </span>
              <span style="color:${t.required ? "#b45309" : "#6b7280"};font-weight:600;">${t.required ? "Required" : "Optional"}</span>
            </div>`
        )
        .join("");
    } catch (e) {
      previewEl.textContent = "Could not build preview.";
      console.warn(e);
    }
  }

  select?.addEventListener("change", refreshPreview);
  await refreshPreview();

  document.getElementById("ffOdCreateBtn")?.addEventListener("click", async () => {
    if (_odCreateBusy) return;
    if (!_canManage()) {
      const msg =
        "Only owners/managers can start onboarding. Try refreshing, or sign in again as the owner.";
      _toast(msg, "error");
      try {
        window.alert(msg);
      } catch (_) {}
      return;
    }
    const pid = select?.value;
    const pkg = selectable.find((p) => p.id === pid);
    if (!pkg) return;
    const due = document.getElementById("ffOdDueDate")?.value || null;
    _odCreateBusy = true;
    const btn = document.getElementById("ffOdCreateBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Starting…";
    }
    try {
      const templates = await window.ffGetOnboardingTaskTemplates();
      const categories = await window.ffGetOnboardingCategories();
      if (btn) btn.textContent = "Starting…";
      const result = await window.ffCreateOnboardingRunFromPackage({
        staffId: staff.id,
        packageId: pkg.id,
        dueDate: due,
        templates,
        categories,
        pkg,
      });
      const runId = result && result.runId ? result.runId : null;
      _odSelectedRunId = runId || _odSelectedRunId;

      const staffEmail = _staffEmail(staff);
      if (!runId) {
        _closeModal();
        _toast("Onboarding started.", "success");
        return;
      }
      if (!staffEmail || !staffEmail.includes("@")) {
        _closeModal();
        _toast(
          "Onboarding created, but this team member has no email on file. Add an email, then tap Send to employee.",
          "error"
        );
        return;
      }

      if (btn) btn.textContent = "Sending email…";
      try {
        const mailRes = await _inviteEmployeeByEmail(staff, runId);
        _closeModal();
        const to =
          (mailRes && mailRes.toMasked) || staffEmail;
        _toast(
          mailRes && mailRes.issuedNewToken
            ? `Onboarding started — email queued to ${to} (new portal link).`
            : `Onboarding started — email queued to ${to}.`,
          "success"
        );
      } catch (mailErr) {
        console.warn("[OnboardingRun] auto-send email failed", mailErr);
        _closeModal();
        _toast(
          (mailErr && mailErr.message) ||
            "Onboarding created, but the email failed. Tap Send to employee to retry.",
          "error"
        );
      }
    } catch (e) {
      console.error(e);
      _toast(e.message || "Failed to start onboarding", "error");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Start & send email";
      }
    } finally {
      _odCreateBusy = false;
    }
  });
}

function _renderEsignSummary(task) {
  const cfg = _esignCfg(task);
  const res = _esignResult(task);
  const st = String(task.status || "pending");
  const failed =
    (st === "in_progress" || st === "pending") && !!res.lastSealError;

  if (st === "completed" && (res.signedPdfSha256 || res.signedDocumentId)) {
    const docName =
      cfg.documentTitle || task.templateNameSnapshot || "Document";
    const version =
      cfg.documentVersion != null
        ? cfg.documentVersion
        : res.documentVersionId || "—";
    const signedWhen = _fmtWhen(res.signedAt || task.completedAt);
    const signer = res.signerName || "—";
    return `<div style="margin-top:8px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px;background:#fafafa;">
      <div style="font-size:11px;font-weight:700;color:#065f46;margin-bottom:6px;">E-signed · Completed</div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:11px;color:#374151;line-height:1.4;">
        <span style="color:#9ca3af;">Signed</span><span>${_esc(signedWhen || "—")}</span>
        <span style="color:#9ca3af;">Signer</span><span>${_esc(signer)}</span>
        <span style="color:#9ca3af;">Document</span><span>${_esc(docName)}</span>
        <span style="color:#9ca3af;">Version</span><span>${_esc(String(version))}</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
        <button type="button" data-od-act="esign_view_signed" data-task="${_esc(task.id)}" style="padding:5px 9px;border:1px solid #111827;border-radius:7px;background:#111827;color:#fff;font-size:11px;font-weight:600;cursor:pointer;">View signed PDF</button>
        ${
          res.certificateDocumentId || res.certificateStoragePath
            ? `<button type="button" data-od-act="esign_view_cert" data-task="${_esc(task.id)}" style="padding:5px 9px;border:1px solid #e5e7eb;border-radius:7px;background:#fff;font-size:11px;font-weight:600;cursor:pointer;">View certificate</button>`
            : ""
        }
      </div>
      <div style="font-size:10px;color:#9ca3af;margin-top:6px;line-height:1.4;">Sealed copy is read-only. A new library version needs a new task — older signed copies stay in Documents.</div>
    </div>`;
  }

  if (failed) {
    return `<div style="margin-top:6px;font-size:11px;color:#b91c1c;line-height:1.4;">Signing failed — the employee can open the portal link and try again. Previous sealed documents (if any) were not overwritten.</div>`;
  }

  if (st === "sealing" || st === "in_progress" || st === "pending") {
    return `<div style="margin-top:6px;font-size:11px;color:#6b7280;line-height:1.4;">Employee signs in the Onboarding Portal. Status updates when the signature is sealed.</div>`;
  }

  return "";
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
        actions += `<span style="font-size:11px;color:#b45309;font-weight:600;">In Inbox for approval</span>`;
      } else if (
        task.status === "rejected" ||
        task.status === "pending" ||
        task.status === "in_progress"
      ) {
        actions += `<button type="button" data-od-act="upload" data-task="${_esc(task.id)}" style="padding:5px 9px;border:1px solid #e5e7eb;border-radius:7px;background:#fff;font-size:11px;font-weight:600;cursor:pointer;">${task.status === "rejected" ? "Resubmit file" : "Upload file"}</button>`;
      }
    }
    if (task.taskType === "electronic_signature") {
      actions += `<span style="font-size:11px;color:#6b7280;font-weight:600;">Portal e-sign</span>`;
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
    task.taskType === "electronic_signature" ? _renderEsignSummary(task) : "";

  return `<div data-od-task-row="${_esc(task.id)}" style="padding:10px 0;border-bottom:1px solid #f3f4f6;">
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
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">${actions}</div>
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
  const rid = `ffOdPdfView_${Date.now()}`;
  const overlay = document.createElement("div");
  overlay.id = rid;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.style.cssText =
    "position:fixed;left:0;top:0;right:0;bottom:0;width:100%;height:100vh;height:100dvh;background:#0f172a;z-index:2147483647;display:flex;flex-direction:column;box-sizing:border-box;padding:calc(10px + env(safe-area-inset-top,0px)) 10px calc(10px + env(safe-area-inset-bottom,0px));";
  overlay.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 4px 12px;color:#fff;flex:0 0 auto;">
      <div style="min-width:0;font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(title || "Signed PDF")}</div>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        <a href="${_esc(url)}" target="_blank" rel="noopener noreferrer" style="border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.12);color:#fff;border-radius:999px;padding:7px 12px;font-size:13px;font-weight:700;text-decoration:none;">Open tab</a>
        <button type="button" data-ff-od-pdf-close style="border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.12);color:#fff;border-radius:999px;padding:7px 12px;font-size:13px;font-weight:700;cursor:pointer;">Close</button>
      </div>
    </div>
    <div style="flex:1 1 auto;min-height:0;background:#fff;border-radius:14px;overflow:hidden;">
      <iframe src="${_esc(url)}" title="${_esc(title || "Signed PDF")}" style="width:100%;height:100%;border:0;background:#fff;"></iframe>
    </div>`;
  const close = () => {
    try {
      overlay.remove();
    } catch (_) {}
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (ev) => {
    if (ev.key === "Escape") close();
  };
  overlay.querySelector("[data-ff-od-pdf-close]")?.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  return true;
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
  let fileUrl = "";
  let fileName = title;

  const docId =
    kind === "cert" ? res.certificateDocumentId : res.signedDocumentId;
  if (docId) {
    const resolved = await _resolveStaffDocFile(staff.id, docId);
    if (!path) path = resolved.path;
    if (resolved.fileUrl) fileUrl = resolved.fileUrl;
    if (resolved.fileName) fileName = resolved.fileName;
  }

  try {
    let url = "";
    if (fileUrl.startsWith("http://") || fileUrl.startsWith("https://")) {
      url = fileUrl;
    } else if (path) {
      url = await getDownloadURL(storageRef(storage, path));
    }
    if (!url) {
      _closeBlankTab(tab);
      _toast("Signed file not found yet.", "error");
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
  if (_odSelectedRunId) {
    const found = (_odRunsCache || []).find((r) => r.id === _odSelectedRunId);
    if (found) {
      /* keep selection */
    } else if (active) {
      _odSelectedRunId = active.id;
    }
  } else if (active) {
    _odSelectedRunId = active.id;
  }

  const selected =
    (_odRunsCache || []).find((r) => r.id === _odSelectedRunId) || active;
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
        _odSelectedRunId = btn.getAttribute("data-od-run");
        _subscribeTasks(staff, _odSelectedRunId);
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
  _odSelectedRunId = null;

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
      if (!_odSelectedRunId && _odRunsCache.length) {
        _odSelectedRunId = _odRunsCache[0].id;
      }
      if (_odSelectedRunId) _subscribeTasks(staff, _odSelectedRunId);
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
  _odSelectedRunId = null;
  _closeModal();
}

if (typeof window !== "undefined") {
  window.ffOpenStartOnboardingModal = ffOpenStartOnboardingModal;
  window.ffMountStaffOnboardingRuns = ffMountStaffOnboardingRuns;
  window.ffUnmountStaffOnboardingRuns = ffUnmountStaffOnboardingRuns;
  window.__ffOdSyncShellStartUi = _syncOdShellStartUi;
}
