/**
 * staff-writeups-ui.js — interactions for the Employee Write-Ups tab
 * (Phase 1): Add / Edit incident modal, Mark-as-Excused confirm, attachment
 * viewing, and repeated-incident banner actions. "Review & Create Write-Up"
 * is a Phase 2 stub — nothing is ever sent to the employee from this tab.
 */
import {
  wuState,
  WRITEUP_INCIDENT_TYPES,
  WRITEUP_ACCEPT_FILE_TYPES,
  writeupTypeLabel,
} from "./staff-writeups-state.js?v=20260731_writeups_phase1";
import {
  createIncident,
  updateIncident,
  setIncidentStatus,
  resolveAttachmentUrl,
  resolveActorStaff,
  toDateMaybe,
} from "./staff-writeups-cloud.js?v=20260731_writeups_phase1";
import { escapeHtml, dismissSuggestion } from "./staff-writeups-render.js?v=20260731_writeups_phase1";

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

let _rerender = null;
export function initStaffWriteupsUi(opts) {
  _rerender = opts && typeof opts.rerender === "function" ? opts.rerender : null;
}

function rerender() {
  if (_rerender && wuState._boundContainer) _rerender(wuState._boundContainer);
}

function currentIncident(incidentId) {
  return (wuState._lastIncidentList || []).find((i) => i.id === incidentId) || null;
}

// ---------- Modal scaffolding (same overlay pattern as staff-documents-ui) ----------

function openOverlay(innerHtml, maxWidth) {
  const overlay = document.createElement("div");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.style.cssText =
    "position:fixed;left:0;top:0;right:0;bottom:0;width:100%;min-height:100vh;min-height:100dvh;background:rgba(0,0,0,0.45);z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;overflow-y:auto;overflow-x:hidden;";
  overlay.innerHTML = `<div style="background:#fff;border-radius:16px;padding:24px 26px;max-width:${maxWidth || 480}px;width:100%;box-shadow:0 25px 50px -12px rgba(0,0,0,0.28);margin:auto;flex-shrink:0;box-sizing:border-box;">${innerHtml}</div>`;
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
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) finish();
  });
  document.body.appendChild(overlay);
  return { overlay, finish };
}

const labelStyle = "display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;";
const inputStyle =
  "width:100%;padding:11px 12px;margin-bottom:12px;border:1px solid #d1d5db;border-radius:8px;font-size:12px;color:#111827;box-sizing:border-box;font-family:inherit;background:#fff;";

function typeOptionsHtml(selected) {
  return WRITEUP_INCIDENT_TYPES.map(
    (t) => `<option value="${t.id}"${t.id === selected ? " selected" : ""}>${escapeHtml(t.label)}</option>`,
  ).join("");
}

function locationOptionsHtml(selectedId) {
  let locations = [];
  try {
    locations = typeof window.ffGetLocations === "function" ? window.ffGetLocations() || [] : [];
  } catch (_) {}
  const opts = ['<option value="">— Select location —</option>'];
  locations.forEach((loc) => {
    const id = String((loc && (loc.id || loc.locationId)) || "").trim();
    const name = String((loc && (loc.name || loc.title)) || "").trim() || id;
    if (!id) return;
    opts.push(`<option value="${escapeHtml(id)}"${id === selectedId ? " selected" : ""}>${escapeHtml(name)}</option>`);
  });
  return opts.join("");
}

function toYmd(d) {
  if (!d) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function toHm(d) {
  if (!d) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- Add / Edit incident modal ----------

export function openIncidentModal(existing) {
  const isEdit = !!existing;
  const rid = `ffwu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const prevAt = isEdit ? toDateMaybe(existing.incidentAt) : null;
  const now = new Date();
  const actor = resolveActorStaff();
  const recordedByName = isEdit
    ? existing.recordedByName || ""
    : actor.name || "";
  const existingAttCount = isEdit && Array.isArray(existing.attachments) ? existing.attachments.length : 0;

  const html = `
    <div style="font-size:18px;font-weight:700;color:#111827;margin-bottom:6px;line-height:1.3;">${isEdit ? "Edit Incident" : "Add Incident"}</div>
    <p style="margin:0 0 16px 0;font-size:12px;color:#6b7280;line-height:1.5;">Internal documentation only — nothing is sent to the employee.</p>

    <label style="${labelStyle}">Incident type</label>
    <select id="${rid}_type" style="${inputStyle}">${typeOptionsHtml(isEdit ? String(existing.type || "") : "")}</select>

    <div style="display:flex;gap:10px;">
      <div style="flex:1;min-width:0;">
        <label style="${labelStyle}">Date</label>
        <input type="date" id="${rid}_date" value="${escapeHtml(toYmd(prevAt || now))}" style="${inputStyle}" />
      </div>
      <div style="flex:1;min-width:0;">
        <label style="${labelStyle}">Time</label>
        <input type="time" id="${rid}_time" value="${escapeHtml(toHm(prevAt || now))}" style="${inputStyle}" />
      </div>
    </div>

    <div id="${rid}_minutes_wrap" style="display:none;">
      <label style="${labelStyle}">Minutes late</label>
      <input type="number" id="${rid}_minutes" min="0" step="1" placeholder="e.g. 15" value="${isEdit && existing.minutesLate != null ? escapeHtml(String(existing.minutesLate)) : ""}" style="${inputStyle}" />
    </div>

    <label style="${labelStyle}">Location</label>
    <select id="${rid}_location" style="${inputStyle}">${locationOptionsHtml(isEdit ? String(existing.locationId || "") : "")}</select>

    <label style="${labelStyle}">What happened (factual description)</label>
    <textarea id="${rid}_desc" rows="3" placeholder="Stick to observable facts: what, when, who was present." style="${inputStyle}resize:vertical;">${isEdit ? escapeHtml(existing.description || "") : ""}</textarea>

    <label style="${labelStyle}">Employee explanation / response (optional)</label>
    <textarea id="${rid}_response" rows="2" placeholder="What the employee said, if anything." style="${inputStyle}resize:vertical;">${isEdit ? escapeHtml(existing.employeeResponse || "") : ""}</textarea>

    <label style="${labelStyle}">Private manager notes (optional, never shared)</label>
    <textarea id="${rid}_notes" rows="2" style="${inputStyle}resize:vertical;">${isEdit ? escapeHtml(existing.privateNotes || "") : ""}</textarea>

    <label style="${labelStyle}">Attachments (optional${existingAttCount ? ` — ${existingAttCount} already attached` : ""})</label>
    <input type="file" id="${rid}_files" multiple accept="${WRITEUP_ACCEPT_FILE_TYPES}" style="${inputStyle}padding:9px 12px;" />
    <p style="margin:-6px 0 12px 0;font-size:11px;color:#9ca3af;">PDF or images, up to 10 MB each.${isEdit ? " New files are added; existing attachments are kept." : ""}</p>

    <label style="${labelStyle}">Recorded by</label>
    <input type="text" id="${rid}_recorded" value="${escapeHtml(recordedByName)}" ${recordedByName ? "readonly" : ""} placeholder="Your name" style="${inputStyle}${recordedByName ? "background:#f9fafb;color:#6b7280;" : ""}" />

    <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:6px;">
      <button type="button" data-ff-cancel style="padding:10px 18px;border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-weight:600;cursor:pointer;font-size:14px;font-family:inherit;">Cancel</button>
      <button type="button" data-ff-save style="padding:10px 18px;border-radius:10px;border:none;background:#7c3aed;color:#fff;font-weight:600;cursor:pointer;font-size:14px;font-family:inherit;">${isEdit ? "Save Changes" : "Save Incident"}</button>
    </div>`;

  const { overlay, finish } = openOverlay(html, 480);

  const typeSel = overlay.querySelector(`#${rid}_type`);
  const minutesWrap = overlay.querySelector(`#${rid}_minutes_wrap`);
  const syncMinutesVisibility = () => {
    const t = typeSel ? typeSel.value : "";
    minutesWrap.style.display = t === "late_arrival" || t === "left_early" ? "block" : "none";
  };
  if (typeSel) typeSel.addEventListener("change", syncMinutesVisibility);
  syncMinutesVisibility();

  overlay.querySelector("[data-ff-cancel]").onclick = () => finish();
  overlay.querySelector("[data-ff-save]").onclick = async () => {
    if (wuState._saveInFlight) return;
    const type = typeSel ? String(typeSel.value || "").trim() : "";
    const dateVal = String(overlay.querySelector(`#${rid}_date`)?.value || "").trim();
    const timeVal = String(overlay.querySelector(`#${rid}_time`)?.value || "").trim();
    const desc = String(overlay.querySelector(`#${rid}_desc`)?.value || "").trim();
    const response = String(overlay.querySelector(`#${rid}_response`)?.value || "").trim();
    const notes = String(overlay.querySelector(`#${rid}_notes`)?.value || "").trim();
    const recorded = String(overlay.querySelector(`#${rid}_recorded`)?.value || "").trim();
    const locSel = overlay.querySelector(`#${rid}_location`);
    const locationId = locSel ? String(locSel.value || "").trim() : "";
    const locationName = locSel && locSel.selectedIndex > 0 ? String(locSel.options[locSel.selectedIndex].text || "").trim() : "";
    const minutesRaw = String(overlay.querySelector(`#${rid}_minutes`)?.value || "").trim();
    const minutesApplicable = type === "late_arrival" || type === "left_early";
    const minutesLate = minutesApplicable && minutesRaw !== "" && Number.isFinite(Number(minutesRaw))
      ? Math.max(0, Math.floor(Number(minutesRaw)))
      : null;
    const fileInput = overlay.querySelector(`#${rid}_files`);
    const files = fileInput && fileInput.files ? Array.from(fileInput.files) : [];

    if (!type) return toast("Select an incident type.", "error");
    if (!dateVal) return toast("Select the incident date.", "error");
    if (!desc) return toast("Describe what happened.", "error");
    const incidentAt = new Date(`${dateVal}T${timeVal || "09:00"}`);
    if (isNaN(incidentAt.getTime())) return toast("Invalid date or time.", "error");

    const ctx = wuState._mountCtx;
    const saveBtn = overlay.querySelector("[data-ff-save]");
    wuState._saveInFlight = true;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      if (isEdit) {
        const changes = {};
        const changedFields = [];
        const track = (field, newVal, oldVal) => {
          const ov = oldVal == null ? (typeof newVal === "number" ? null : "") : oldVal;
          if (String(newVal ?? "") !== String(ov ?? "")) {
            changes[field] = newVal;
            changedFields.push(field);
          }
        };
        track("type", type, existing.type);
        track("description", desc, existing.description);
        track("employeeResponse", response, existing.employeeResponse);
        track("privateNotes", notes, existing.privateNotes);
        track("locationId", locationId, existing.locationId);
        track("locationName", locationName, existing.locationName);
        track("minutesLate", minutesLate, existing.minutesLate);
        const prevMs = toDateMaybe(existing.incidentAt)?.getTime();
        if (prevMs !== incidentAt.getTime()) {
          changes.incidentAt = incidentAt;
          changedFields.push("incidentAt");
        }
        if (!changedFields.length && !files.length) {
          toast("No changes to save.", "info");
          return;
        }
        await updateIncident(ctx.salonId, ctx.staffId, existing.id, changes, changedFields, files);
        toast("Incident updated.", "success");
      } else {
        await createIncident(
          ctx.salonId,
          ctx.staffId,
          {
            type,
            incidentAt,
            minutesLate,
            locationId: locationId || null,
            locationName: locationName || null,
            description: desc,
            employeeResponse: response || null,
            privateNotes: notes || null,
            status: "documented",
            recordedByName: recorded || null,
          },
          files,
        );
        toast("Incident saved. Nothing was sent to the employee.", "success");
      }
      finish();
    } catch (err) {
      console.warn("[staff-writeups] save failed", err);
      toast(
        err && err.code === "permission-denied"
          ? "You are not authorized to manage write-ups."
          : err && err.message
            ? err.message
            : "Could not save the incident.",
        "error",
      );
    } finally {
      wuState._saveInFlight = false;
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? "Save Changes" : "Save Incident";
    }
  };
}

// ---------- Mark as Excused ----------

function openExcuseConfirm(incidentId) {
  const inc = currentIncident(incidentId);
  if (!inc) return;
  const { overlay, finish } = openOverlay(
    `<div style="font-size:17px;font-weight:700;color:#111827;margin-bottom:8px;">Mark as Excused?</div>
     <p style="margin:0 0 16px 0;font-size:13px;color:#6b7280;line-height:1.5;">“${escapeHtml(writeupTypeLabel(inc.type))}” on ${escapeHtml(
       toDateMaybe(inc.incidentAt)?.toLocaleDateString() || "—",
     )} will no longer count toward the repeated-incident suggestion.</p>
     <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;">
       <button type="button" data-ff-cancel style="padding:10px 18px;border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-weight:600;cursor:pointer;font-size:14px;font-family:inherit;">Cancel</button>
       <button type="button" data-ff-confirm style="padding:10px 18px;border-radius:10px;border:none;background:#15803d;color:#fff;font-weight:600;cursor:pointer;font-size:14px;font-family:inherit;">Mark as Excused</button>
     </div>`,
    420,
  );
  overlay.querySelector("[data-ff-cancel]").onclick = () => finish();
  overlay.querySelector("[data-ff-confirm]").onclick = async () => {
    const ctx = wuState._mountCtx;
    try {
      await setIncidentStatus(ctx.salonId, ctx.staffId, incidentId, "excused", inc.status);
      toast("Incident marked as excused.", "success");
      finish();
    } catch (err) {
      console.warn("[staff-writeups] excuse failed", err);
      toast("Could not update the incident.", "error");
    }
  };
}

/** Banner action: pick which related incident to excuse. */
function openExcusePicker(typeId) {
  const list = (wuState._lastIncidentList || []).filter(
    (i) => String(i.type || "") === typeId && String(i.status || "") !== "excused" && i.archived !== true,
  );
  if (!list.length) return toast("No incidents of this type to excuse.", "info");
  const rows = list
    .map(
      (i) => `<button type="button" data-pick-id="${escapeHtml(i.id)}" style="display:block;width:100%;text-align:left;padding:10px 12px;margin-bottom:8px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;cursor:pointer;font-family:inherit;font-size:12px;color:#111827;">
        <span style="font-weight:600;">${escapeHtml(toDateMaybe(i.incidentAt)?.toLocaleString() || "—")}</span>
        <span style="display:block;color:#6b7280;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(i.description || "")}</span>
      </button>`,
    )
    .join("");
  const { overlay, finish } = openOverlay(
    `<div style="font-size:17px;font-weight:700;color:#111827;margin-bottom:8px;">Mark an Incident as Excused</div>
     <p style="margin:0 0 14px 0;font-size:12px;color:#6b7280;">Choose which “${escapeHtml(writeupTypeLabel(typeId))}” incident to excuse:</p>
     ${rows}
     <div style="display:flex;justify-content:flex-end;margin-top:4px;">
       <button type="button" data-ff-cancel style="padding:10px 18px;border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-weight:600;cursor:pointer;font-size:14px;font-family:inherit;">Cancel</button>
     </div>`,
    440,
  );
  overlay.querySelector("[data-ff-cancel]").onclick = () => finish();
  overlay.querySelectorAll("[data-pick-id]").forEach((btn) => {
    btn.onclick = () => {
      finish();
      openExcuseConfirm(btn.getAttribute("data-pick-id"));
    };
  });
}

// ---------- Attachment view ----------

async function viewAttachment(incidentId, idx) {
  const inc = currentIncident(incidentId);
  const att = inc && Array.isArray(inc.attachments) ? inc.attachments[idx] : null;
  if (!att || !att.storagePath) return toast("Attachment not found.", "error");
  try {
    const url = await resolveAttachmentUrl(att.storagePath);
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    console.warn("[staff-writeups] attachment open failed", err);
    toast("Could not open the attachment.", "error");
  }
}

// ---------- Delegated click handler ----------

export function handleWriteupsActionClick(e) {
  const btn = e.target && e.target.closest && e.target.closest("[data-ff-wu-action],[data-ff-wu-filter]");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();

  const filter = btn.getAttribute("data-ff-wu-filter");
  if (filter) {
    wuState._statusFilter = filter;
    rerender();
    return;
  }

  const action = btn.getAttribute("data-ff-wu-action");
  const incidentId = btn.getAttribute("data-wu-id") || "";
  const typeId = btn.getAttribute("data-wu-type") || "";

  if (action === "add") {
    openIncidentModal(null);
  } else if (action === "edit") {
    const inc = currentIncident(incidentId);
    if (inc) openIncidentModal(inc);
  } else if (action === "excuse") {
    openExcuseConfirm(incidentId);
  } else if (action === "excuse_picker") {
    openExcusePicker(typeId);
  } else if (action === "view_attachment") {
    void viewAttachment(incidentId, Number(btn.getAttribute("data-wu-att-idx")) || 0);
  } else if (action === "dismiss_banner") {
    dismissSuggestion(typeId, btn.getAttribute("data-wu-count"));
    rerender();
  } else if (action === "review_create") {
    // Phase 2: incident selection + formal write-up draft. Recommendation only for now.
    toast("Formal write-up creation is coming in Phase 2.", "info");
  }
}
