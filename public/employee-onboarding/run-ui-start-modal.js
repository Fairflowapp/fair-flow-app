/**
 * Employee Onboarding Runs — Start Onboarding modal + package preview / create flow.
 */

import {
  odUiState,
  _esc,
  _toast,
  _canManage,
  _taskTypeLabel,
  _staffEmail,
  _inviteEmployeeByEmail,
  _closeModal,
  _openModal,
  _loadActivePackages,
  _previewTasksForPackage,
} from "./run-ui-shared.js?v=20260810_od_split_v1";

let _odCreateBusy = false;

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
      odUiState.selectedRunId = runId || odUiState.selectedRunId;

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
