/**
 * staff-writeups-compose.js — the formal write-up composer (Phase 2).
 *
 * A 3-step modal: 1) select incidents, 2) edit the formal document fields,
 * 3) edit the email draft — plus Preview (exactly what the employee sees),
 * Save as Draft, and Approve & Send (Owner/Admin only; the backend enforces
 * this regardless of the UI).
 *
 * The draft is auto-prepared from real data only: staff row, salon doc and
 * the selected incidents. Free-text fields the admin has not filled stay
 * empty — nothing is invented.
 */
import {
  wuState,
  WRITEUP_WARNING_LEVELS,
  WRITEUP_ACK_TEXT,
  writeupTypeLabel,
  writeupDefaultEmailSubject,
  writeupDefaultEmailBody,
} from "./staff-writeups-state.js?v=20260731_writeups_phase2";
import { resolveActorStaff, toDateMaybe } from "./staff-writeups-cloud.js?v=20260731_writeups_phase2";
import {
  createWriteupDraft,
  updateWriteupDraft,
  approveAndSendWriteup,
  loadSalonName,
} from "./staff-writeups-formal-cloud.js?v=20260731_writeups_phase2";
import {
  wuEscapeHtml as escapeHtml,
  wuFormatWhen,
  renderIssuedDocumentHtml,
  renderEmailPreviewHtml,
} from "./staff-writeups-formal-render.js?v=20260731_writeups_phase2";

function toast(msg, variant) {
  try {
    if (window.ffToast && typeof window.ffToast.show === "function") {
      window.ffToast.show(msg, { variant: variant || "info" });
      return;
    }
  } catch (_) {}
  try {
    alert(msg);
  } catch (_) {}
}

function trimStr(v) {
  return String(v == null ? "" : v).trim();
}

function openOverlay(innerHtml, maxWidth) {
  const overlay = document.createElement("div");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.style.cssText =
    "position:fixed;left:0;top:0;right:0;bottom:0;width:100%;min-height:100vh;min-height:100dvh;background:rgba(0,0,0,0.45);z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;overflow-y:auto;overflow-x:hidden;";
  overlay.innerHTML = `<div style="background:#fff;border-radius:16px;padding:24px 26px;max-width:${maxWidth || 640}px;width:100%;box-shadow:0 25px 50px -12px rgba(0,0,0,0.28);margin:auto;flex-shrink:0;box-sizing:border-box;">${innerHtml}</div>`;
  const finish = () => {
    try {
      overlay.remove();
    } catch (_) {}
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (ev) => {
    if (ev.key === "Escape") finish();
  };
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  return { overlay, finish };
}

const labelStyle = "display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;";
const inputStyle =
  "width:100%;padding:11px 12px;margin-bottom:12px;border:1px solid #d1d5db;border-radius:8px;font-size:12px;color:#111827;box-sizing:border-box;font-family:inherit;background:#fff;";
const hintStyle = "margin:-8px 0 12px 0;font-size:11px;color:#9ca3af;line-height:1.4;";

function resolveStaffRow(staffId) {
  try {
    const store = typeof window.ffGetStaffStore === "function" ? window.ffGetStaffStore() : null;
    const list = store && Array.isArray(store.staff) ? store.staff : [];
    return (
      list.find((s) => trimStr((s && (s.id || s.staffId)) || "").toLowerCase() === trimStr(staffId).toLowerCase()) ||
      null
    );
  } catch (_) {
    return null;
  }
}

function staffRoleLabel(staff) {
  const r = trimStr(staff && staff.role);
  if (!r) return "";
  return r
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function canApproveNow() {
  try {
    return (
      typeof window.ffCurrentUserIsWriteupsOwnerAdmin === "function" &&
      window.ffCurrentUserIsWriteupsOwnerAdmin() === true
    );
  } catch (_) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

/**
 * Open the composer. opts:
 *   typeId        — preselect countable incidents of this type (banner entry)
 *   existingDraft — edit an existing draft
 *   correctionOf  — a sent write-up being corrected (clone -> new draft v(n+1))
 */
export async function openWriteupComposer(opts) {
  const o = opts || {};
  const ctx = wuState._mountCtx;
  if (!ctx.salonId || !ctx.staffId) return;

  const existing = o.existingDraft || null;
  const correctionOf = o.correctionOf || null;
  const base = existing || correctionOf || null;

  const staffRow = resolveStaffRow(ctx.staffId);
  const actor = resolveActorStaff();
  const salonName = trimStr(base && base.salonName) || (await loadSalonName(ctx.salonId)) || "";

  const incidents = (wuState._lastIncidentList || []).filter((i) => i && i.archived !== true);
  const preselected = new Set(
    base && Array.isArray(base.selectedIncidentIds)
      ? base.selectedIncidentIds.map(trimStr)
      : incidents
          .filter(
            (i) =>
              (!o.typeId || trimStr(i.type) === trimStr(o.typeId)) &&
              trimStr(i.status) === "documented",
          )
          .map((i) => trimStr(i.id)),
  );
  const savedDescriptions = {};
  if (base && Array.isArray(base.incidentSummaries)) {
    base.incidentSummaries.forEach((s) => {
      if (s && s.incidentId) savedDescriptions[trimStr(s.incidentId)] = trimStr(s.description);
    });
  }

  const employeeFirstName = trimStr(staffRow && staffRow.name).split(/\s+/)[0] || "";
  const fields = {
    employeeName: trimStr(base && base.employeeName) || trimStr(staffRow && staffRow.name),
    employeePosition:
      trimStr(base && base.employeePosition) || staffRoleLabel(staffRow) || "Service Provider",
    salonName,
    locationName:
      trimStr(base && base.locationName) ||
      trimStr(staffRow && (staffRow.locationName || staffRow.location)) ||
      "",
    warningLevel: trimStr(base && base.warningLevel),
    policyViolated: trimStr(base && base.policyViolated),
    requiredImprovement: trimStr(base && base.requiredImprovement),
    followUpDate: trimStr(base && base.followUpDate),
    potentialNextSteps: trimStr(base && base.potentialNextSteps),
    employeeFacingStatement: trimStr(base && base.employeeFacingStatement),
    managerComments: trimStr(base && base.managerComments),
    managerName: trimStr(base && base.managerName) || trimStr(actor.name),
    emailSubject: trimStr(base && base.emailSubject) || writeupDefaultEmailSubject(salonName),
    emailBody:
      trimStr(base && base.emailBody) || writeupDefaultEmailBody(salonName, employeeFirstName),
  };

  const rid = `ffwuc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const canApprove = canApproveNow();

  // ---- Step 1: incident checklist ----
  const incidentRows = incidents
    .map((i) => {
      const id = trimStr(i.id);
      const status = trimStr(i.status);
      const excused = status === "excused";
      const included = status === "included_in_writeup";
      const checked = !excused && preselected.has(id);
      return `<label style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;margin-bottom:8px;border:1px solid ${checked ? "#ddd6fe" : "#e5e7eb"};border-radius:8px;background:${excused ? "#f9fafb" : "#fff"};cursor:${excused ? "not-allowed" : "pointer"};opacity:${excused ? "0.55" : "1"};">
        <input type="checkbox" data-wu-inc-check="${escapeHtml(id)}" ${checked ? "checked" : ""} ${excused ? "disabled" : ""} style="margin-top:2px;flex-shrink:0;" />
        <span style="min-width:0;font-size:12px;line-height:1.45;color:#111827;">
          <span style="font-weight:700;">${escapeHtml(writeupTypeLabel(i.type))}</span>
          <span style="color:#6b7280;"> · ${escapeHtml(wuFormatWhen(i.incidentAt))}</span>
          ${excused ? `<span style="color:#15803d;font-weight:600;"> · Excused (cannot be included)</span>` : ""}
          ${included ? `<span style="color:#6d28d9;font-weight:600;"> · Already included in a write-up</span>` : ""}
          <span style="display:block;color:#374151;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(i.description || "")}</span>
        </span>
      </label>`;
    })
    .join("");

  const step1 = `<div data-wu-step="1">
    <p style="margin:0 0 12px 0;font-size:12px;color:#6b7280;line-height:1.5;">Choose the documented incidents this write-up covers. Excused incidents cannot be included.</p>
    ${incidentRows || `<p style="margin:0;font-size:12px;color:#9ca3af;">No incidents recorded for this employee.</p>`}
  </div>`;

  // ---- Step 2: formal document fields ----
  const levelOptions = ['<option value="">— Select warning level —</option>']
    .concat(
      WRITEUP_WARNING_LEVELS.map(
        (l) =>
          `<option value="${l.id}"${l.id === fields.warningLevel ? " selected" : ""}>${escapeHtml(l.label)}</option>`,
      ),
    )
    .join("");

  const step2 = `<div data-wu-step="2" style="display:none;">
    <div style="display:flex;gap:10px;">
      <div style="flex:1;min-width:0;">
        <label style="${labelStyle}">Employee</label>
        <input type="text" id="${rid}_emp" value="${escapeHtml(fields.employeeName)}" style="${inputStyle}" />
      </div>
      <div style="flex:1;min-width:0;">
        <label style="${labelStyle}">Position</label>
        <input type="text" id="${rid}_pos" value="${escapeHtml(fields.employeePosition)}" style="${inputStyle}" />
      </div>
    </div>
    <div style="display:flex;gap:10px;">
      <div style="flex:1;min-width:0;">
        <label style="${labelStyle}">Salon</label>
        <input type="text" id="${rid}_salon" value="${escapeHtml(fields.salonName)}" style="${inputStyle}" />
      </div>
      <div style="flex:1;min-width:0;">
        <label style="${labelStyle}">Location</label>
        <input type="text" id="${rid}_loc" value="${escapeHtml(fields.locationName)}" style="${inputStyle}" />
      </div>
    </div>
    <label style="${labelStyle}">Warning level</label>
    <select id="${rid}_level" style="${inputStyle}">${levelOptions}</select>

    <label style="${labelStyle}">Selected incidents (employee-facing copies — editing here never changes the original incident)</label>
    <div id="${rid}_summaries" style="margin-bottom:12px;"></div>

    <label style="${labelStyle}">Policy or expectation violated</label>
    <textarea id="${rid}_policy" rows="2" style="${inputStyle}resize:vertical;">${escapeHtml(fields.policyViolated)}</textarea>

    <label style="${labelStyle}">Required improvement</label>
    <textarea id="${rid}_improve" rows="2" style="${inputStyle}resize:vertical;">${escapeHtml(fields.requiredImprovement)}</textarea>

    <label style="${labelStyle}">Follow-up date</label>
    <input type="date" id="${rid}_followup" value="${escapeHtml(fields.followUpDate)}" style="${inputStyle}" />

    <label style="${labelStyle}">Potential next steps if the issue continues</label>
    <textarea id="${rid}_next" rows="2" style="${inputStyle}resize:vertical;">${escapeHtml(fields.potentialNextSteps)}</textarea>

    <label style="${labelStyle}">Employee-Facing Manager Statement (appears in the document)</label>
    <textarea id="${rid}_statement" rows="3" style="${inputStyle}resize:vertical;">${escapeHtml(fields.employeeFacingStatement)}</textarea>

    <label style="${labelStyle}">Internal Manager Comments (admin side only — never shown to the employee)</label>
    <textarea id="${rid}_comments" rows="2" style="${inputStyle}resize:vertical;border-color:#fcd34d;background:#fffbeb;">${escapeHtml(fields.managerComments)}</textarea>

    <label style="${labelStyle}">Manager name</label>
    <input type="text" id="${rid}_manager" value="${escapeHtml(fields.managerName)}" style="${inputStyle}" />
  </div>`;

  // ---- Step 3: email draft ----
  const step3 = `<div data-wu-step="3" style="display:none;">
    <p style="margin:0 0 12px 0;font-size:12px;color:#6b7280;line-height:1.5;">This email is sent when the write-up is approved. Keep incident details out of it — the employee reviews the document securely inside Fair Flow.</p>
    <label style="${labelStyle}">Subject</label>
    <input type="text" id="${rid}_subject" value="${escapeHtml(fields.emailSubject)}" style="${inputStyle}" />
    <label style="${labelStyle}">Message</label>
    <textarea id="${rid}_body" rows="8" style="${inputStyle}resize:vertical;">${escapeHtml(fields.emailBody)}</textarea>
    <p style="${hintStyle}">A “Review Document” button linking to Fair Flow is added automatically.</p>
  </div>`;

  const title = existing
    ? "Edit Write-Up Draft"
    : correctionOf
      ? "Corrected Write-Up (new version)"
      : "Create Formal Write-Up";

  const html = `
    <div style="font-size:18px;font-weight:700;color:#111827;margin-bottom:4px;">${escapeHtml(title)}</div>
    <p style="margin:0 0 14px 0;font-size:12px;color:#6b7280;line-height:1.5;">Nothing will be sent until ${canApprove ? "you review and approve this document." : "an owner or admin reviews and approves this document."}</p>
    <div id="${rid}_stepnav" style="display:flex;gap:6px;margin-bottom:16px;"></div>
    ${step1}${step2}${step3}
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:1px solid #f3f4f6;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" data-wu-back style="padding:10px 16px;border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-weight:600;cursor:pointer;font-size:13px;font-family:inherit;">Back</button>
        <button type="button" data-wu-preview style="padding:10px 16px;border-radius:10px;border:1px solid #ddd6fe;background:#faf5ff;color:#5b21b6;font-weight:600;cursor:pointer;font-size:13px;font-family:inherit;">Preview</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" data-wu-cancel style="padding:10px 16px;border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-weight:600;cursor:pointer;font-size:13px;font-family:inherit;">Cancel</button>
        <button type="button" data-wu-save-draft style="padding:10px 16px;border-radius:10px;border:1px solid #7c3aed;background:#ede9fe;color:#5b21b6;font-weight:600;cursor:pointer;font-size:13px;font-family:inherit;">Save as Draft</button>
        <button type="button" data-wu-next style="padding:10px 16px;border-radius:10px;border:none;background:#7c3aed;color:#fff;font-weight:600;cursor:pointer;font-size:13px;font-family:inherit;">Next</button>
        ${canApprove ? `<button type="button" data-wu-send style="display:none;padding:10px 16px;border-radius:10px;border:none;background:#16a34a;color:#fff;font-weight:600;cursor:pointer;font-size:13px;font-family:inherit;">Approve &amp; Send</button>` : ""}
      </div>
    </div>`;

  const { overlay, finish } = openOverlay(html, 640);

  // ---------------- step handling ----------------
  let step = 1;
  const stepTitles = ["Incidents", "Document", "Email"];
  const syncSteps = () => {
    overlay.querySelectorAll("[data-wu-step]").forEach((el) => {
      el.style.display = Number(el.getAttribute("data-wu-step")) === step ? "block" : "none";
    });
    const nav = overlay.querySelector(`#${rid}_stepnav`);
    nav.innerHTML = stepTitles
      .map((t, idx) => {
        const n = idx + 1;
        const active = n === step;
        return `<span style="flex:1;text-align:center;padding:7px 4px;border-radius:8px;font-size:11px;font-weight:700;${
          active ? "background:#ede9fe;color:#5b21b6;border:1px solid #ddd6fe;" : "background:#f9fafb;color:#9ca3af;border:1px solid #f3f4f6;"
        }">${n}. ${escapeHtml(t)}</span>`;
      })
      .join("");
    overlay.querySelector("[data-wu-back]").style.visibility = step === 1 ? "hidden" : "visible";
    overlay.querySelector("[data-wu-next]").style.display = step === 3 ? "none" : "inline-block";
    const sendBtn = overlay.querySelector("[data-wu-send]");
    if (sendBtn) sendBtn.style.display = step === 3 ? "inline-block" : "none";
    if (step === 2) rebuildSummaryEditors();
  };

  const selectedIds = () =>
    Array.from(overlay.querySelectorAll("[data-wu-inc-check]:checked")).map((el) =>
      el.getAttribute("data-wu-inc-check"),
    );

  /** Frozen employee-facing copies — editable text, original incidents untouched. */
  const summaryDrafts = {}; // incidentId -> edited description
  function rebuildSummaryEditors() {
    const holder = overlay.querySelector(`#${rid}_summaries`);
    const ids = selectedIds();
    if (!ids.length) {
      holder.innerHTML = `<p style="margin:0 0 4px 0;font-size:12px;color:#b91c1c;">No incidents selected — go back to step 1.</p>`;
      return;
    }
    holder.innerHTML = ids
      .map((id) => {
        const inc = incidents.find((i) => trimStr(i.id) === id) || {};
        const current =
          summaryDrafts[id] != null
            ? summaryDrafts[id]
            : savedDescriptions[id] != null
              ? savedDescriptions[id]
              : trimStr(inc.description);
        return `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:9px 11px;margin-bottom:8px;">
          <div style="font-size:11px;font-weight:700;color:#111827;margin-bottom:5px;">${escapeHtml(writeupTypeLabel(inc.type))} · ${escapeHtml(wuFormatWhen(inc.incidentAt))}</div>
          <textarea data-wu-summary="${escapeHtml(id)}" rows="2" style="${inputStyle}margin-bottom:0;resize:vertical;">${escapeHtml(current)}</textarea>
        </div>`;
      })
      .join("");
    holder.querySelectorAll("[data-wu-summary]").forEach((ta) => {
      ta.addEventListener("input", () => {
        summaryDrafts[ta.getAttribute("data-wu-summary")] = ta.value;
      });
    });
  }

  function collectFields() {
    const val = (suffix) => trimStr(overlay.querySelector(`#${rid}_${suffix}`)?.value);
    const ids = selectedIds();
    const incidentSummaries = ids.map((id) => {
      const inc = incidents.find((i) => trimStr(i.id) === id) || {};
      const desc =
        summaryDrafts[id] != null
          ? trimStr(summaryDrafts[id])
          : savedDescriptions[id] != null
            ? savedDescriptions[id]
            : trimStr(inc.description);
      return {
        incidentId: id,
        type: trimStr(inc.type),
        incidentAt: toDateMaybe(inc.incidentAt),
        description: desc,
      };
    });
    return {
      employeeName: val("emp"),
      employeePosition: val("pos"),
      salonName: val("salon"),
      locationName: val("loc"),
      warningLevel: val("level"),
      selectedIncidentIds: ids,
      incidentSummaries,
      policyViolated: val("policy"),
      requiredImprovement: val("improve"),
      followUpDate: val("followup"),
      potentialNextSteps: val("next"),
      employeeFacingStatement: val("statement"),
      managerComments: val("comments"),
      managerName: val("manager"),
      emailSubject: val("subject"),
      emailBody: val("body"),
      writeupDate: new Date(),
    };
  }

  function validate(f, forSend) {
    if (!f.selectedIncidentIds.length) return "Select at least one incident.";
    if (f.incidentSummaries.some((s) => !s.description)) {
      return "Every selected incident needs a description.";
    }
    if (forSend) {
      if (!f.warningLevel) return "Select a warning level.";
      if (!f.employeeName) return "Employee name is required.";
      if (!f.salonName) return "Salon name is required.";
      if (!f.emailSubject) return "Email subject is required.";
    }
    return "";
  }

  // ---------------- preview ----------------
  function openPreview() {
    const f = collectFields();
    const docLike = {
      ...f,
      status: "sent",
      version: Number(base && base.version) || (correctionOf ? (Number(correctionOf.version) || 1) + 1 : 1),
      acknowledgmentText: WRITEUP_ACK_TEXT,
      sentAt: new Date(),
    };
    const inner = `
      <div style="font-size:16px;font-weight:700;color:#111827;margin-bottom:4px;">Preview — what the employee will see</div>
      <p style="margin:0 0 14px 0;font-size:12px;color:#6b7280;">Internal manager comments and private incident notes are never part of this document.</p>
      <div style="max-height:52vh;overflow-y:auto;margin-bottom:16px;">${renderIssuedDocumentHtml(docLike, {})}</div>
      <div style="font-size:13px;font-weight:700;color:#111827;margin:0 0 8px 0;">Email preview</div>
      ${renderEmailPreviewHtml(f.emailSubject, f.emailBody)}
      <div style="display:flex;justify-content:flex-end;margin-top:16px;">
        <button type="button" data-wu-preview-close style="padding:10px 18px;border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-weight:600;cursor:pointer;font-size:13px;font-family:inherit;">Close Preview</button>
      </div>`;
    const p = openOverlay(inner, 760);
    p.overlay.querySelector("[data-wu-preview-close]").onclick = () => p.finish();
  }

  // ---------------- save / send ----------------
  async function saveDraft(silent) {
    const f = collectFields();
    const err = validate(f, false);
    if (err) {
      toast(err, "error");
      return null;
    }
    try {
      if (existing) {
        await updateWriteupDraft(ctx.salonId, ctx.staffId, existing.id, f);
        if (!silent) toast("Draft saved. Nothing was sent.", "success");
        return existing.id;
      }
      const id = await createWriteupDraft(
        ctx.salonId,
        ctx.staffId,
        f,
        correctionOf
          ? { version: (Number(correctionOf.version) || 1) + 1, previousWriteupId: correctionOf.id }
          : {},
      );
      if (!silent) toast("Draft saved. Nothing was sent.", "success");
      return id;
    } catch (e) {
      console.warn("[staff-writeups] draft save failed", e);
      toast(
        e && e.code === "permission-denied"
          ? "You are not authorized to manage write-ups."
          : "Could not save the draft.",
        "error",
      );
      return null;
    }
  }

  function confirmAndSend() {
    const f = collectFields();
    const err = validate(f, true);
    if (err) return toast(err, "error");

    const c = openOverlay(
      `<div style="font-size:17px;font-weight:700;color:#111827;margin-bottom:8px;">Approve &amp; Send?</div>
       <p style="margin:0 0 8px 0;font-size:13px;color:#374151;line-height:1.55;">Nothing will be sent until you review and approve this document.</p>
       <p style="margin:0 0 16px 0;font-size:12px;color:#6b7280;line-height:1.55;">On approval, ${escapeHtml(f.employeeName || "the employee")} receives the email and an in-app notification, and the document appears in their “My Write-Ups” area. The issued document cannot be edited afterwards — corrections create a new version.</p>
       <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;">
         <button type="button" data-wu-c-cancel style="padding:10px 18px;border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-weight:600;cursor:pointer;font-size:14px;font-family:inherit;">Cancel</button>
         <button type="button" data-wu-c-send style="padding:10px 18px;border-radius:10px;border:none;background:#16a34a;color:#fff;font-weight:600;cursor:pointer;font-size:14px;font-family:inherit;">Approve &amp; Send</button>
       </div>`,
      460,
    );
    c.overlay.querySelector("[data-wu-c-cancel]").onclick = () => c.finish();
    c.overlay.querySelector("[data-wu-c-send]").onclick = async () => {
      if (wuState._sendInFlight) return;
      const btn = c.overlay.querySelector("[data-wu-c-send]");
      wuState._sendInFlight = true;
      btn.disabled = true;
      btn.textContent = "Sending…";
      try {
        const draftId = await saveDraft(true);
        if (!draftId) return;
        await approveAndSendWriteup(ctx.salonId, ctx.staffId, draftId);
        toast("Write-up approved and sent.", "success");
        c.finish();
        finish();
      } catch (e) {
        console.warn("[staff-writeups] send failed", e);
        toast(
          e && e.message ? e.message : "Sending failed — you can retry from the write-up list.",
          "error",
        );
      } finally {
        wuState._sendInFlight = false;
        btn.disabled = false;
        btn.textContent = "Approve & Send";
      }
    };
  }

  // ---------------- wiring ----------------
  overlay.querySelector("[data-wu-cancel]").onclick = () => finish();
  overlay.querySelector("[data-wu-back]").onclick = () => {
    if (step > 1) {
      step -= 1;
      syncSteps();
    }
  };
  overlay.querySelector("[data-wu-next]").onclick = () => {
    if (step === 1 && !selectedIds().length) return toast("Select at least one incident.", "error");
    if (step < 3) {
      step += 1;
      syncSteps();
    }
  };
  overlay.querySelector("[data-wu-preview]").onclick = () => openPreview();
  overlay.querySelector("[data-wu-save-draft]").onclick = async () => {
    const id = await saveDraft(false);
    if (id) finish();
  };
  const sendBtn = overlay.querySelector("[data-wu-send]");
  if (sendBtn) sendBtn.onclick = () => confirmAndSend();

  syncSteps();
}
