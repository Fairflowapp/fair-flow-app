/**
 * staff-writeups-render.js — rendering for the Employee Write-Ups tab
 * (Phase 1: incidents): toolbar with status filters, repeated-incident
 * suggestion banner, incident timeline cards, and empty / loading / error /
 * permission-denied states. Matches the Staff Documents tab visual language.
 */
import {
  wuState,
  WRITEUP_STATUSES,
  WRITEUP_FILTER_IDS,
  writeupTypeLabel,
  writeupStatusLabel,
  WRITEUP_DEFAULT_SETTINGS,
} from "./staff-writeups-state.js?v=20260802_writeups_phase2c";
import {
  toDateMaybe,
  computeRepeatSuggestions,
} from "./staff-writeups-cloud.js?v=20260802_writeups_phase2c";
import { renderFormalSectionHtml } from "./staff-writeups-formal-render.js?v=20260802_writeups_phase2c";

export function escapeHtml(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shellStyle() {
  return "padding:16px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-sizing:border-box;";
}

function messageBlockHtml(text, color) {
  return `<div style="min-height:88px;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;"><p style="margin:0;font-size:13px;color:${color || "#6b7280"};text-align:center;line-height:1.5;">${escapeHtml(text)}</p></div>`;
}

export function renderLoadingHtml() {
  return `<div style="${shellStyle()}">${messageBlockHtml("Loading write-ups…")}</div>`;
}

export function renderPermissionDeniedHtml() {
  return `<div style="${shellStyle()}">
    <div style="min-height:110px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:16px;box-sizing:border-box;text-align:center;">
      <div style="font-size:20px;">🔒</div>
      <p style="margin:0;font-size:13px;font-weight:600;color:#111827;">Restricted section</p>
      <p style="margin:0;font-size:12px;color:#6b7280;max-width:340px;line-height:1.5;">Employee write-ups are confidential. Only the owner and authorized admins can view this tab.</p>
    </div>
  </div>`;
}

export function renderErrorHtml() {
  return `<div style="${shellStyle()}">${messageBlockHtml("Could not load write-ups. Please try again.", "#b91c1c")}</div>`;
}

function formatWhen(v) {
  const d = toDateMaybe(v);
  if (!d) return "—";
  try {
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch (_) {
    return d.toISOString();
  }
}

function statusBadgeHtml(status) {
  const s = String(status || "");
  const map = {
    documented: { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
    excused: { bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0" },
    included_in_writeup: { bg: "#faf5ff", color: "#6d28d9", border: "#ddd6fe" },
  };
  const c = map[s] || { bg: "#f9fafb", color: "#374151", border: "#e5e7eb" };
  return `<span style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:0.02em;line-height:1.3;background:${c.bg};color:${c.color};border:1px solid ${c.border};">${escapeHtml(writeupStatusLabel(s))}</span>`;
}

function filterChipsHtml(activeFilter, list) {
  const counts = { all: list.length };
  WRITEUP_STATUSES.forEach((s) => {
    counts[s.id] = list.filter((i) => String(i.status || "") === s.id).length;
  });
  const chips = [{ id: "all", label: "All" }].concat(WRITEUP_STATUSES);
  return chips
    .map((c) => {
      const isActive = activeFilter === c.id;
      const style = isActive
        ? "border:1px solid #7c3aed;background:#ede9fe;color:#5b21b6;"
        : "border:1px solid #e5e7eb;background:#fff;color:#374151;";
      return `<button type="button" data-ff-wu-filter="${c.id}" style="padding:6px 12px;border-radius:999px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;${style}">${escapeHtml(c.label)} (${counts[c.id] || 0})</button>`;
    })
    .join("");
}

/** Repeated-incident suggestion banner — a recommendation only; never sends anything. */
function suggestionBannerHtml(suggestions, settings) {
  const s = settings || WRITEUP_DEFAULT_SETTINGS;
  const visible = suggestions.filter((sug) => !isSuggestionDismissed(sug));
  if (!visible.length) return "";
  return visible
    .map((sug) => {
      return `<div data-ff-wu-banner="${escapeHtml(sug.typeId)}" style="border:1px solid #fcd34d;background:#fffbeb;border-radius:10px;padding:13px 14px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:4px;">Repeated incidents: ${escapeHtml(writeupTypeLabel(sug.typeId))}</div>
        <p style="margin:0 0 10px 0;font-size:12px;color:#78350f;line-height:1.5;">${sug.count} related incidents were recorded within ${s.windowDays} days. Would you like to review them and create an employee write-up?</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          <button type="button" data-ff-wu-action="review_create" data-wu-type="${escapeHtml(sug.typeId)}" style="min-height:32px;padding:6px 13px;font-size:11px;font-weight:600;border-radius:999px;border:1px solid #7c3aed;background:#7c3aed;color:#fff;cursor:pointer;font-family:inherit;">Review &amp; Create Write-Up</button>
          <button type="button" data-ff-wu-action="dismiss_banner" data-wu-type="${escapeHtml(sug.typeId)}" data-wu-count="${sug.count}" style="min-height:32px;padding:6px 13px;font-size:11px;font-weight:600;border-radius:999px;border:1px solid #e5e7eb;background:#fff;color:#374151;cursor:pointer;font-family:inherit;">Not Now</button>
          <button type="button" data-ff-wu-action="excuse_picker" data-wu-type="${escapeHtml(sug.typeId)}" style="min-height:32px;padding:6px 13px;font-size:11px;font-weight:600;border-radius:999px;border:1px solid #e5e7eb;background:#fff;color:#374151;cursor:pointer;font-family:inherit;">Mark an Incident as Excused</button>
        </div>
      </div>`;
    })
    .join("");
}

function suggestionDismissKey(sug) {
  const ctx = wuState._mountCtx;
  return `ff_wu_dismiss::${ctx.salonId}::${ctx.staffId}::${sug.typeId}::${sug.count}`;
}

function isSuggestionDismissed(sug) {
  try {
    return sessionStorage.getItem(suggestionDismissKey(sug)) === "1";
  } catch (_) {
    return false;
  }
}

export function dismissSuggestion(typeId, count) {
  try {
    sessionStorage.setItem(
      suggestionDismissKey({ typeId, count: Number(count) || 0 }),
      "1",
    );
  } catch (_) {}
}

function attachmentRowHtml(att, idx, incidentId) {
  const name = escapeHtml(att && att.name ? att.name : `Attachment ${idx + 1}`);
  return `<button type="button" data-ff-wu-action="view_attachment" data-wu-id="${escapeHtml(incidentId)}" data-wu-att-idx="${idx}" style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;border:1px solid #ddd6fe;background:#faf5ff;color:#5b21b6;cursor:pointer;font-family:inherit;max-width:100%;"><span style="flex-shrink:0;">📎</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span></button>`;
}

function fieldRowHtml(label, valueHtml) {
  if (!valueHtml) return "";
  return `<span style="color:#9ca3af;">${escapeHtml(label)}</span><span style="word-break:break-word;">${valueHtml}</span>`;
}

function incidentCardHtml(inc) {
  const typeLabel = writeupTypeLabel(inc.type);
  const status = String(inc.status || "documented");
  const canExcuse = status !== "excused";
  const attachments = Array.isArray(inc.attachments) ? inc.attachments : [];
  const minutesLate =
    inc.minutesLate != null && Number.isFinite(Number(inc.minutesLate)) && Number(inc.minutesLate) > 0
      ? `${Number(inc.minutesLate)} min`
      : "";

  const attRow = attachments.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">${attachments
        .map((a, i) => attachmentRowHtml(a, i, inc.id))
        .join("")}</div>`
    : "";

  const btnStyle =
    "min-height:32px;padding:6px 13px;font-size:11px;font-weight:600;border-radius:999px;line-height:1.2;box-sizing:border-box;font-family:inherit;cursor:pointer;border:1px solid #7c3aed;background:#ede9fe;color:#5b21b6;";
  const btnNeutral =
    "min-height:32px;padding:6px 13px;font-size:11px;font-weight:600;border-radius:999px;line-height:1.2;box-sizing:border-box;font-family:inherit;cursor:pointer;border:1px solid #e5e7eb;background:#fff;color:#374151;";

  return `<div class="ff-wu-card" style="border:1px solid #e5e7eb;border-radius:10px;padding:13px 14px;background:#fff;margin-bottom:10px;">
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:8px;">
      ${statusBadgeHtml(status)}
      <span style="font-size:11px;color:#6b7280;">${escapeHtml(formatWhen(inc.incidentAt))}</span>
    </div>
    <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:8px;line-height:1.35;">${escapeHtml(typeLabel)}</div>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:12px;color:#374151;line-height:1.45;">
      ${fieldRowHtml("Minutes late", minutesLate ? escapeHtml(minutesLate) : "")}
      ${fieldRowHtml("Location", inc.locationName ? escapeHtml(inc.locationName) : "")}
      ${fieldRowHtml("What happened", inc.description ? escapeHtml(inc.description) : "")}
      ${fieldRowHtml("Employee response", inc.employeeResponse ? escapeHtml(inc.employeeResponse) : "")}
      ${fieldRowHtml("Private notes", inc.privateNotes ? `<span style="color:#92400e;">${escapeHtml(inc.privateNotes)}</span>` : "")}
      ${fieldRowHtml("Recorded by", inc.recordedByName ? escapeHtml(inc.recordedByName) : "")}
      ${fieldRowHtml("Recorded", escapeHtml(formatWhen(inc.createdAt)))}
    </div>
    ${attRow}
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid #f3f4f6;align-items:center;">
      <button type="button" data-ff-wu-action="edit" data-wu-id="${escapeHtml(inc.id)}" style="${btnStyle}">Edit</button>
      ${canExcuse ? `<button type="button" data-ff-wu-action="excuse" data-wu-id="${escapeHtml(inc.id)}" style="${btnNeutral}">Mark as Excused</button>` : ""}
    </div>
  </div>`;
}

function emptyHtml() {
  return `<div style="min-height:110px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:16px;box-sizing:border-box;text-align:center;">
    <p style="margin:0;font-size:13px;font-weight:600;color:#111827;">No incidents recorded</p>
    <p style="margin:0;font-size:12px;color:#6b7280;max-width:320px;line-height:1.5;">Use “+ Add Incident” to document late arrivals, absences, complaints and other events. Nothing is sent to the employee.</p>
  </div>`;
}

export function renderWriteupsIntoContainer(container) {
  if (!container) return;

  if (wuState._loadError === "permission") {
    container.innerHTML = renderPermissionDeniedHtml();
    return;
  }
  if (wuState._loadError) {
    container.innerHTML = renderErrorHtml();
    return;
  }
  const list = wuState._lastIncidentList;
  if (list === null) {
    container.innerHTML = renderLoadingHtml();
    return;
  }

  const settings = wuState._settings || WRITEUP_DEFAULT_SETTINGS;
  const suggestions = computeRepeatSuggestions(list, settings);

  const addBtn = `<button type="button" data-ff-wu-action="add" style="min-height:36px;padding:8px 16px;font-size:12px;font-weight:600;border-radius:999px;border:none;background:#7c3aed;color:#fff;cursor:pointer;font-family:inherit;white-space:nowrap;">+ Add Incident</button>`;
  const header = `<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;">
    <div style="font-size:13px;font-weight:700;color:#111827;">Write-Ups <span style="font-weight:500;color:#9ca3af;font-size:11px;">· Confidential</span></div>
    ${addBtn}
  </div>`;

  if (!WRITEUP_FILTER_IDS.has(wuState._statusFilter)) wuState._statusFilter = "all";
  const f = wuState._statusFilter;
  const toolbar = list.length
    ? `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 14px 0;padding-bottom:12px;border-bottom:1px solid #f3f4f6;">${filterChipsHtml(f, list)}</div>`
    : "";

  const filtered = f === "all" ? list : list.filter((i) => String(i.status || "") === f);
  let body;
  if (!list.length) {
    body = emptyHtml();
  } else if (!filtered.length) {
    body = messageBlockHtml("No incidents match this filter.");
  } else {
    body = filtered.map(incidentCardHtml).join("");
  }

  // Phase 2 — formal write-ups section. Approve/Send/Resend/Decline/Correct are
  // owner/admin only (backend enforces this; the flag only shapes the UI).
  let canApprove = false;
  try {
    canApprove =
      typeof window.ffCurrentUserIsWriteupsOwnerAdmin === "function" &&
      window.ffCurrentUserIsWriteupsOwnerAdmin() === true;
  } catch (_) {}
  const formal = renderFormalSectionHtml(wuState._formalList, {
    canApprove,
    mailStates: wuState._mailStates,
  });

  container.innerHTML = `<div style="${shellStyle()}">${header}${suggestionBannerHtml(suggestions, settings)}${toolbar}${body}${formal}</div>`;
}
