/**
 * staff-writeups-formal-render.js — pure rendering for formal write-ups
 * (Phase 2). No Firestore imports: shared by the admin tab (staff-writeups)
 * and the employee "My Write-Ups" area (my-writeups.js).
 *
 * Renders: the formal document (structured HTML snapshot), the admin list
 * section, the email preview, and the print/download window (browser
 * print-to-PDF — no PDF library).
 */
import {
  writeupTypeLabel,
  writeupWarningLevelLabel,
  writeupFormalStatusLabel,
  WRITEUP_ACK_TEXT,
} from "./staff-writeups-state.js?v=20260802_writeups_phase2c";

export function wuEscapeHtml(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function wuToDateMaybe(v) {
  try {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v.toDate === "function") return v.toDate();
    if (typeof v === "number") return new Date(v);
    return null;
  } catch (_) {
    return null;
  }
}

export function wuFormatDate(v) {
  const d = wuToDateMaybe(v);
  if (!d) return "—";
  try {
    return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  } catch (_) {
    return d.toISOString().slice(0, 10);
  }
}

export function wuFormatWhen(v) {
  const d = wuToDateMaybe(v);
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

// ---------------------------------------------------------------------------
// The formal document (employee-facing structured snapshot)
// ---------------------------------------------------------------------------

function docSectionHtml(title, text) {
  if (!String(text || "").trim()) return "";
  return `<div style="margin-bottom:16px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6b7280;margin-bottom:4px;">${wuEscapeHtml(title)}</div>
    <div style="font-size:13px;color:#111827;line-height:1.6;white-space:pre-wrap;word-break:break-word;">${wuEscapeHtml(text)}</div>
  </div>`;
}

function incidentRowsHtml(summaries) {
  const rows = (Array.isArray(summaries) ? summaries : [])
    .map(
      (s) => `<tr>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;font-size:12px;color:#374151;white-space:nowrap;vertical-align:top;">${wuEscapeHtml(wuFormatWhen(s.incidentAt))}</td>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;font-size:12px;color:#374151;vertical-align:top;">${wuEscapeHtml(writeupTypeLabel(s.type))}</td>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;font-size:12px;color:#111827;line-height:1.5;word-break:break-word;">${wuEscapeHtml(s.description || "")}</td>
      </tr>`,
    )
    .join("");
  return `<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
    <thead><tr>
      <th style="padding:7px 10px;border:1px solid #e5e7eb;background:#f9fafb;font-size:11px;color:#6b7280;text-align:left;">Date</th>
      <th style="padding:7px 10px;border:1px solid #e5e7eb;background:#f9fafb;font-size:11px;color:#6b7280;text-align:left;">Type</th>
      <th style="padding:7px 10px;border:1px solid #e5e7eb;background:#f9fafb;font-size:11px;color:#6b7280;text-align:left;">What happened</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/**
 * The formal write-up document. `docData` is the issued snapshot (or a draft
 * shaped the same way, for Preview). Never renders private notes or internal
 * manager comments — they are not part of the snapshot at all.
 */
export function renderIssuedDocumentHtml(docData, opts) {
  const d = docData || {};
  const o = opts || {};
  const metaRow = (label, value) =>
    `<div style="display:flex;gap:8px;font-size:12px;line-height:1.5;">
      <span style="color:#6b7280;min-width:110px;flex-shrink:0;">${wuEscapeHtml(label)}</span>
      <span style="color:#111827;font-weight:600;word-break:break-word;">${wuEscapeHtml(value || "—")}</span>
    </div>`;

  const superseded =
    String(d.status || "") === "superseded"
      ? `<div style="border:1px solid #fcd34d;background:#fffbeb;color:#92400e;border-radius:8px;padding:9px 12px;font-size:12px;font-weight:600;margin-bottom:14px;">A corrected version of this document was issued — this copy is kept for record only.</div>`
      : "";

  const ackBlock = d.acknowledgedAt
    ? `<div style="border:1px solid #bbf7d0;background:#f0fdf4;border-radius:10px;padding:12px 14px;">
        <div style="font-size:12px;font-weight:700;color:#15803d;margin-bottom:4px;">Receipt acknowledged</div>
        <p style="margin:0;font-size:12px;color:#374151;line-height:1.55;">${wuEscapeHtml(WRITEUP_ACK_TEXT)}</p>
        <p style="margin:6px 0 0 0;font-size:11px;color:#6b7280;">Acknowledged ${wuEscapeHtml(wuFormatWhen(d.acknowledgedAt))}</p>
      </div>`
    : `<div style="border:1px solid #e5e7eb;background:#f9fafb;border-radius:10px;padding:12px 14px;">
        <div style="font-size:12px;font-weight:700;color:#111827;margin-bottom:4px;">Acknowledgment of receipt</div>
        <p style="margin:0;font-size:12px;color:#374151;line-height:1.55;">${wuEscapeHtml(WRITEUP_ACK_TEXT)}</p>
        ${o.ackActionsHtml || ""}
      </div>`;

  const responseBlock = String(d.employeeResponse || "").trim()
    ? `<div style="margin-bottom:16px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6b7280;margin-bottom:4px;">Employee response</div>
        <div style="font-size:13px;color:#111827;line-height:1.6;white-space:pre-wrap;word-break:break-word;border-left:3px solid #ddd6fe;padding-left:10px;">${wuEscapeHtml(d.employeeResponse)}</div>
        <p style="margin:4px 0 0 0;font-size:11px;color:#9ca3af;">Added ${wuEscapeHtml(wuFormatWhen(d.employeeResponseAt))}</p>
      </div>`
    : "";

  return `<div data-ff-wu-doc style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:22px;box-sizing:border-box;max-width:720px;">
    ${superseded}
    <div style="border-bottom:2px solid #7c3aed;padding-bottom:12px;margin-bottom:16px;">
      <div style="font-size:16px;font-weight:800;color:#111827;">${wuEscapeHtml(d.salonName || "")}</div>
      ${d.parentBrandName && d.parentBrandName !== d.salonName ? `<div style="font-size:11px;color:#9ca3af;margin-top:2px;">Part of ${wuEscapeHtml(d.parentBrandName)}</div>` : ""}
      ${d.locationName && d.locationName !== d.salonName ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">${wuEscapeHtml(d.locationName)}</div>` : ""}
      <div style="font-size:13px;font-weight:700;color:#7c3aed;margin-top:10px;">Employee Write-Up — ${wuEscapeHtml(writeupWarningLevelLabel(d.warningLevel))}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr;gap:5px;margin-bottom:18px;">
      ${metaRow("Employee", d.employeeName)}
      ${metaRow("Position", d.employeePosition)}
      ${metaRow("Write-up date", wuFormatDate(d.writeupDate || d.sentAt))}
      ${d.followUpDate ? metaRow("Follow-up date", d.followUpDate) : ""}
      ${Number(d.version) > 1 ? metaRow("Version", `Corrected version ${Number(d.version)}`) : ""}
    </div>
    <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6b7280;margin-bottom:6px;">Documented incidents</div>
    ${incidentRowsHtml(d.incidentSummaries)}
    ${docSectionHtml("Policy or expectation violated", d.policyViolated)}
    ${docSectionHtml("Required improvement", d.requiredImprovement)}
    ${docSectionHtml("Potential next steps if the issue continues", d.potentialNextSteps)}
    ${docSectionHtml("Manager statement", d.employeeFacingStatement)}
    ${d.managerName ? docSectionHtml("Manager", d.managerName) : ""}
    ${responseBlock}
    ${o.responseFormHtml || ""}
    ${ackBlock}
  </div>`;
}

/** Print / Save as PDF via the browser print flow (same pattern as order details). */
export function openWriteupPrintWindow(docData) {
  const inner = renderIssuedDocumentHtml(docData, {});
  const w = window.open("", "_blank", "width=840,height=900");
  if (!w) return false;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Employee Write-Up</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 24px; background:#fff; }
      @media print { body { margin: 0; } [data-ff-wu-doc] { border: none !important; } }
    </style></head><body>${inner}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => {
    try {
      w.print();
    } catch (_) {}
  }, 250);
  return true;
}

// ---------------------------------------------------------------------------
// Email preview (what the employee's inbox will show)
// ---------------------------------------------------------------------------

export function renderEmailPreviewHtml(subject, bodyText) {
  const paragraphs = String(bodyText || "")
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px 0;">${wuEscapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
    <div style="background:#f9fafb;border-bottom:1px solid #e5e7eb;padding:10px 14px;">
      <div style="font-size:11px;color:#6b7280;">Subject</div>
      <div style="font-size:13px;font-weight:700;color:#111827;">${wuEscapeHtml(subject || "")}</div>
    </div>
    <div style="padding:16px 14px;font-size:13px;color:#111827;line-height:1.6;">
      ${paragraphs}
      <span style="display:inline-block;background:#7c3aed;color:#fff;border-radius:8px;padding:9px 18px;font-size:12px;font-weight:700;">Review Document</span>
      <p style="margin:14px 0 0 0;font-size:11px;color:#9ca3af;">The button links to Fair Flow — the employee signs in to view the document. No incident details are included in the email.</p>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Admin list section ("Formal Write-Ups" under the incidents timeline)
// ---------------------------------------------------------------------------

function formalStatusChipHtml(w) {
  const status = String(w.status || "");
  let label = writeupFormalStatusLabel(status);
  let c = { bg: "#f9fafb", color: "#374151", border: "#e5e7eb" };
  if (status === "draft") c = { bg: "#fffbeb", color: "#92400e", border: "#fcd34d" };
  else if (status === "sending") c = { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" };
  else if (status === "sent" && w.acknowledgedAt) {
    label = "Acknowledged";
    c = { bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0" };
  } else if (status === "sent") c = { bg: "#faf5ff", color: "#6d28d9", border: "#ddd6fe" };
  return `<span style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:10px;font-weight:700;line-height:1.3;background:${c.bg};color:${c.color};border:1px solid ${c.border};">${wuEscapeHtml(label)}</span>`;
}

/** Honest email chip: Not sent / Queued / Send failed only. */
function emailChipHtml(w, mailStates) {
  const status = String(w.status || "");
  if (status !== "sent" && status !== "superseded") {
    return `<span style="font-size:11px;color:#9ca3af;">Email: Not sent</span>`;
  }
  const mailId = String(w.lastMailId || "");
  const state = mailId && mailStates ? mailStates[mailId] : "";
  if (state === "failed") {
    return `<span style="font-size:11px;font-weight:700;color:#b91c1c;">Email: Send failed</span>`;
  }
  return `<span style="font-size:11px;color:#6b7280;">Email: Queued</span>`;
}

function trackRowHtml(label, v) {
  if (!v) return "";
  return `<span style="color:#9ca3af;">${wuEscapeHtml(label)}</span><span>${wuEscapeHtml(wuFormatWhen(v))}</span>`;
}

function formalCardHtml(w, opts) {
  const o = opts || {};
  const status = String(w.status || "");
  const btn =
    "min-height:32px;padding:6px 13px;font-size:11px;font-weight:600;border-radius:999px;line-height:1.2;box-sizing:border-box;font-family:inherit;cursor:pointer;";
  const btnPrimary = btn + "border:1px solid #7c3aed;background:#7c3aed;color:#fff;";
  const btnSoft = btn + "border:1px solid #7c3aed;background:#ede9fe;color:#5b21b6;";
  const btnNeutral = btn + "border:1px solid #e5e7eb;background:#fff;color:#374151;";
  const btnDanger = btn + "border:1px solid #fecaca;background:#fef2f2;color:#b91c1c;";

  const actions = [];
  const act = (action, label, style) =>
    `<button type="button" data-ff-wu-action="${action}" data-wu-writeup-id="${wuEscapeHtml(w.id)}" style="${style}">${label}</button>`;

  if (status === "draft") {
    actions.push(act("formal_edit", "Edit Draft", btnSoft));
    if (o.canApprove) actions.push(act("formal_send", "Approve &amp; Send", btnPrimary));
    actions.push(act("formal_delete_draft", "Delete Draft", btnDanger));
  } else if (status === "sending") {
    if (o.canApprove) actions.push(act("formal_send", "Resume Send", btnPrimary));
    actions.push(act("formal_view", "View", btnNeutral));
  } else {
    actions.push(act("formal_view", "View Document", btnSoft));
    actions.push(act("formal_print", "Print / PDF", btnNeutral));
    if (status === "sent" && o.canApprove) {
      const mailId = String(w.lastMailId || "");
      if (mailId && o.mailStates && o.mailStates[mailId] === "failed") {
        actions.push(act("formal_resend_email", "Resend Email", btnPrimary));
      }
      if (!w.acknowledgedAt && !w.declinedToAcknowledgeAt) {
        actions.push(act("formal_mark_declined", "Mark as Declined to Acknowledge", btnNeutral));
      }
      actions.push(act("formal_correct", "Create Corrected Version", btnNeutral));
    }
  }

  const declined = w.declinedToAcknowledgeAt
    ? `<div style="margin-top:8px;font-size:11px;color:#b91c1c;font-weight:600;">Employee declined to acknowledge — noted ${wuEscapeHtml(wuFormatWhen(w.declinedToAcknowledgeAt))}${
        w.declinedToAcknowledgeNote ? ` · ${wuEscapeHtml(w.declinedToAcknowledgeNote)}` : ""
      }</div>`
    : "";

  return `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:13px 14px;background:#fff;margin-bottom:10px;">
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:8px;">
      ${formalStatusChipHtml(w)}
      <span style="font-size:12px;font-weight:700;color:#111827;">${wuEscapeHtml(writeupWarningLevelLabel(w.warningLevel))}</span>
      ${Number(w.version) > 1 ? `<span style="font-size:10px;color:#6b7280;border:1px solid #e5e7eb;border-radius:999px;padding:2px 8px;">v${Number(w.version)}</span>` : ""}
      <span style="margin-left:auto;">${emailChipHtml(w, o.mailStates)}</span>
    </div>
    <div style="font-size:11px;color:#6b7280;margin-bottom:8px;">${(Array.isArray(w.selectedIncidentIds) ? w.selectedIncidentIds.length : 0)} incident(s) included · Created ${wuEscapeHtml(wuFormatWhen(w.createdAt))}</div>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:11px;color:#374151;line-height:1.45;">
      ${trackRowHtml("Approved", w.approvedAt)}
      ${trackRowHtml("Sent", w.sentAt)}
      ${trackRowHtml("Opened in Fair Flow", w.openedInAppAt)}
      ${trackRowHtml("Response added", w.employeeResponseAt)}
      ${trackRowHtml("Acknowledged", w.acknowledgedAt)}
    </div>
    ${declined}
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid #f3f4f6;">${actions.join("")}</div>
  </div>`;
}

/**
 * The "Formal Write-Ups" section rendered under the incidents timeline.
 * opts: { canApprove, mailStates }
 */
export function renderFormalSectionHtml(list, opts) {
  const o = opts || {};
  const header = `<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin:18px 0 12px 0;padding-top:16px;border-top:1px solid #e5e7eb;">
    <div style="font-size:13px;font-weight:700;color:#111827;">Formal Write-Ups</div>
    <button type="button" data-ff-wu-action="formal_new" style="min-height:32px;padding:6px 14px;font-size:11px;font-weight:600;border-radius:999px;border:1px solid #7c3aed;background:#ede9fe;color:#5b21b6;cursor:pointer;font-family:inherit;">+ New Write-Up</button>
  </div>`;

  if (list === null) {
    return `${header}<p style="margin:0;font-size:12px;color:#9ca3af;">Loading…</p>`;
  }
  if (!Array.isArray(list) || !list.length) {
    return `${header}<p style="margin:0;font-size:12px;color:#6b7280;line-height:1.5;">No formal write-ups yet. Use “Review &amp; Create Write-Up” on a repeated-incident banner, or “+ New Write-Up”, to prepare a draft. Nothing is sent until an owner or admin approves it.</p>`;
  }
  return header + list.map((w) => formalCardHtml(w, o)).join("");
}
