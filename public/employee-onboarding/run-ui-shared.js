/**
 * Employee Onboarding Runs — shared helpers (escape, toasts, portal meta, modals, packages).
 */

/** Cross-module UI state (selected run shared by start modal + panel). */
export const odUiState = {
  selectedRunId: null,
};

export function _esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function _toast(msg, type) {
  if (typeof window.showToast === "function") window.showToast(msg, type || "info");
  else console.log("[OnboardingRun]", msg);
}

export function _canManage() {
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

export function _statusLabel(s) {
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
export function _taskStatusLabel(task) {
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
export function _taskStatusHtml(task) {
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

export function _taskTypeLabel(t) {
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

export function _fmtWhen(raw) {
  if (!raw) return "";
  try {
    if (raw.toDate) return raw.toDate().toLocaleString();
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  } catch (_) {}
  return String(raw);
}

export function _esignCfg(task) {
  return (task && (task.configSnapshot || task.config)) || {};
}

export function _esignResult(task) {
  return (task && task.result) || {};
}

export function _dueLabel(due) {
  if (!due) return "";
  if (typeof due === "string") return due;
  if (due.toDate) {
    try {
      return due.toDate().toISOString().slice(0, 10);
    } catch (_) {}
  }
  return String(due);
}

export function _portalExpiresLabel(run) {
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

export function _fmtPortalTs(t) {
  if (!t) return "";
  try {
    if (t.toDate) return t.toDate().toLocaleString();
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  } catch (_) {}
  return "";
}

export function _portalEmailLabel(run) {
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

export function _portalMetaHtml(run) {
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

export function _staffEmail(staff) {
  return String((staff && staff.email) || "").trim();
}

export function _hasPortalEmailSent(run) {
  const portal = (run && run.portal) || {};
  return Number(portal.emailSendCount || 0) > 0 || !!portal.firstEmailSentAt;
}

export function _syncOdShellStartUi(pane, hasOpenRun) {
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

export async function _inviteEmployeeByEmail(staff, runId) {
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

export function _ensureModalRoot() {
  let root = document.getElementById("ffOnboardingRunModalRoot");
  if (root) return root;
  root = document.createElement("div");
  root.id = "ffOnboardingRunModalRoot";
  document.body.appendChild(root);
  return root;
}

export function _closeModal() {
  const root = document.getElementById("ffOnboardingRunModalRoot");
  if (root) root.innerHTML = "";
}

export function _openModal(html) {
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

export async function _ensurePackagesReady() {
  if (typeof window.ffEnsureOnboardingSettingsSubscribed !== "function") return;
  try {
    // Never hang the Start button on a stuck subscription promise.
    await Promise.race([
      window.ffEnsureOnboardingSettingsSubscribed(),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch (_) {}
}

export async function _loadActivePackages() {
  await _ensurePackagesReady();
  if (typeof window.ffGetOnboardingPackages !== "function") return [];
  const pkgs = await window.ffGetOnboardingPackages();
  return (pkgs || []).filter((p) => p && p.active !== false);
}

export async function _loadMatchedPackages(staff) {
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

export async function _previewTasksForPackage(pkg) {
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
