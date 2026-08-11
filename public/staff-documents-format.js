/**
 * staff-documents-format.js — pure, state-free helpers split out of staff-documents.js.
 * Date/lifecycle math, HTML escaping, badge/label formatting, document sorting,
 * filtering and filter-chip rendering. No module state, no Firestore reads
 * (only Timestamp for date parsing). Consumed by staff-documents.js and
 * staff-documents-inbox-sync.js.
 */
import { Timestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

function trimStr(v) {
  return v == null ? "" : String(v).trim();
}

function stripUndefined(obj) {
  const out = {};
  Object.keys(obj).forEach((k) => {
    if (obj[k] !== undefined) out[k] = obj[k];
  });
  return out;
}

/**
 * Shared &lt;option&gt; list for Request / Upload / Renewal / edit metadata (same values app-wide).
 */
export function ffStaffDocumentTypeSelectOptionsHtml() {
  return `
          <option value="">Select document type…</option>
          <optgroup label="Employment &amp; tax">
            <option value="I-9">I-9 (employment eligibility)</option>
            <option value="W-2">W-2</option>
            <option value="W-4">W-4</option>
            <option value="1099">1099</option>
            <option value="Employment Letter">Employment Letter</option>
            <option value="Contract">Contract</option>
          </optgroup>
          <optgroup label="Identity &amp; verification">
            <option value="Government ID">Government ID</option>
            <option value="SSN card">SSN card</option>
          </optgroup>
          <optgroup label="Beauty, spa &amp; wellness (professional)">
            <option value="Cosmetology license">Cosmetology license</option>
            <option value="Esthetician license">Esthetician license</option>
            <option value="Full Specialist">Full Specialist</option>
            <option value="Nail technician license">Nail technician license</option>
            <option value="Barber license">Barber license</option>
            <option value="Massage therapy license">Massage therapy license</option>
            <option value="Salon / shop license">Salon / shop license</option>
            <option value="Continuing education certificate">Continuing education certificate</option>
          </optgroup>
          <optgroup label="Coverage &amp; business">
            <option value="Insurance">Insurance</option>
            <option value="Liability insurance (COI)">Liability insurance (COI)</option>
            <option value="Workers compensation">Workers compensation</option>
          </optgroup>
          <optgroup label="Training &amp; compliance">
            <option value="Certification">Certification</option>
            <option value="BBP / infection control">BBP / infection control</option>
            <option value="OSHA / safety training">OSHA / safety training</option>
          </optgroup>
          <optgroup label="General">
            <option value="License">License</option>
            <option value="Other">Other</option>
          </optgroup>`;
}

/** YYYY-MM-DD for &lt;input type="date"&gt; from Timestamp / string / Date. */
export function ffExpirationTimestampToYmdInput(raw) {
  const d = toDateMaybe(raw);
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseExpirationForStaffDoc(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw.toDate === "function") return raw;
  if (raw instanceof Timestamp) return raw;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(`${s.slice(0, 10)}T12:00:00`);
    if (!Number.isNaN(d.getTime())) return Timestamp.fromDate(d);
  }
  return null;
}

/** Whole calendar days from local "today" to the expiration date (same clock as users see in the UI). */
function calendarDaysUntilExpiry(expirationMs) {
  const exp = new Date(expirationMs);
  const expDay = new Date(exp.getFullYear(), exp.getMonth(), exp.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((expDay.getTime() - today.getTime()) / 86400000);
}

/** Expired / expiring_soon (≤30d) / active — derived from expiration date only. */
export function ffComputeLifecycleFromExpiration(expirationRaw) {
  const d = toDateMaybe(expirationRaw);
  if (!d) return "active";
  const diff = calendarDaysUntilExpiry(d.getTime());
  if (diff < 0) return "expired";
  if (diff <= 30) return "expiring_soon";
  return "active";
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Double-quoted HTML attribute escape (e.g. href). */
function escapeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function toDateMaybe(v) {
  if (v == null) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function formatWhen(v) {
  const d = toDateMaybe(v);
  if (!d) return "—";
  try {
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch (_) {
    return d.toISOString();
  }
}

function formatDay(v) {
  const d = toDateMaybe(v);
  if (!d) return "—";
  try {
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch (_) {
    return "—";
  }
}

/** Display line for document title when missing or blank. */
function formatDocumentTitle(raw) {
  const s = raw != null ? String(raw).trim() : "";
  return s ? s : "Untitled document";
}

function formatApprovalLabel(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s || s === "—") return "—";
  const map = { pending: "Pending", approved: "Approved", rejected: "Rejected" };
  return map[s] || String(raw).trim();
}

function formatLifecycleLabel(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s || s === "—") return "—";
  const map = {
    active: "Active",
    archived: "Archived",
    expired: "Expired",
    expiring_soon: "Expiring soon",
  };
  return map[s] || String(raw).trim();
}

/** Unified empty / no-results copy in the Documents panel. */
function staffDocsEmptyMessageHtml(message) {
  return `<div class="ff-staff-doc-empty" style="margin:0;font-size:13px;line-height:1.45;color:#6b7280;text-align:center;padding:28px 16px;min-height:260px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;flex:1;">${escapeHtml(message)}</div>`;
}

function staffDocsShellStyle() {
  return "padding:16px;background:#fff;border:1px solid var(--border);border-radius:12px;min-height:calc(100dvh - 250px);box-sizing:border-box;display:flex;flex-direction:column;";
}

function expiryBadgeState(expirationRaw) {
  const exp = toDateMaybe(expirationRaw);
  if (!exp) return null;
  const t = ffComputeLifecycleFromExpiration(expirationRaw);
  if (t === "expired") return "expired";
  if (t === "expiring_soon") return "expiring_soon";
  return null;
}

function badgeStyle(kind) {
  const map = {
    pending: {
      bg: "#fffbeb",
      color: "#a16207",
      label: "Pending",
      border: "1px solid #fcd34d",
      weight: "800",
    },
    approved: { bg: "#d1fae5", color: "#065f46", label: "Approved", border: "1px solid #a7f3d0" },
    rejected: { bg: "#fee2e2", color: "#991b1b", label: "Rejected", border: "1px solid #fecaca" },
    expiring_soon: {
      bg: "#ffedd5",
      color: "#c2410c",
      label: "Expiring soon",
      border: "1px solid #fdba74",
      weight: "700",
    },
    expired: {
      bg: "#fecaca",
      color: "#7f1d1d",
      label: "Expired",
      border: "1px solid #f87171",
      weight: "800",
    },
    archived: { bg: "#f3f4f6", color: "#6b7280", label: "Archived", border: "1px solid #e5e7eb", weight: "600" },
    esigned: {
      bg: "#ede9fe",
      color: "#5b21b6",
      label: "E-signed",
      border: "1px solid #c4b5fd",
      weight: "800",
    },
    esign_certificate: {
      bg: "#f5f3ff",
      color: "#6d28d9",
      label: "Certificate",
      border: "1px solid #ddd6fe",
      weight: "700",
    },
    sealed: {
      bg: "#ecfdf5",
      color: "#065f46",
      label: "Sealed",
      border: "1px solid #a7f3d0",
      weight: "700",
    },
  };
  return map[kind] || {
    bg: "#e5e7eb",
    color: "#374151",
    label: String(kind),
    border: "1px solid #d1d5db",
    weight: "700",
  };
}

function badgeHtml(kind) {
  const s = badgeStyle(kind);
  const w = s.weight || "700";
  const b = s.border || "1px solid transparent";
  return `<span style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:10px;font-weight:${w};letter-spacing:0.02em;background:${s.bg};color:${s.color};border:${b};">${escapeHtml(s.label)}</span>`;
}

/** True for sealed onboarding e-sign registry rows (signed PDF or certificate). */
function isPortalEsignDocument(doc) {
  if (!doc) return false;
  const via = String(doc.via || "").toLowerCase();
  if (via === "portal_esign") return true;
  return String(doc.approvedBy || "").toLowerCase() === "portal_esign";
}

function groupDocument(doc) {
  const lifecycle = trimStr(String(doc.lifecycleStatus || "")).toLowerCase();
  if (lifecycle === "archived") return "archived";
  const approval = String(doc.approvalStatus || "").toLowerCase();
  if (approval === "pending") return "pending_review";
  return "active";
}

/** Lifecycle tier for documents in the main (non-archived) list. */
function tierForActiveSectionDoc(doc) {
  if (doc.expirationDate != null) {
    return ffComputeLifecycleFromExpiration(doc.expirationDate);
  }
  const ls = String(doc.lifecycleStatus || "").toLowerCase();
  if (ls === "expired" || ls === "expiring_soon" || ls === "active") return ls;
  return "active";
}

function docTimeMs(v) {
  const d = toDateMaybe(v);
  return d ? d.getTime() : null;
}

/**
 * Active section: expired → expiring_soon → active; within each tier by expiration urgency;
 * no expiration → createdAt descending.
 */
function sortActiveDocuments(list) {
  const tierRank = { expired: 0, expiring_soon: 1, active: 2 };
  function createdDesc(a, b) {
    const ca = docTimeMs(a.createdAt) ?? 0;
    const cb = docTimeMs(b.createdAt) ?? 0;
    return cb - ca;
  }
  return list.slice().sort((a, b) => {
    const ta = tierRank[tierForActiveSectionDoc(a)] ?? 2;
    const tb = tierRank[tierForActiveSectionDoc(b)] ?? 2;
    if (ta !== tb) return ta - tb;
    const tier = tierForActiveSectionDoc(a);
    const aExp = docTimeMs(a.expirationDate);
    const bExp = docTimeMs(b.expirationDate);
    if (aExp != null && bExp != null) {
      if (tier === "expired") {
        const cmp = bExp - aExp;
        return cmp !== 0 ? cmp : createdDesc(a, b);
      }
      const cmp = aExp - bExp;
      return cmp !== 0 ? cmp : createdDesc(a, b);
    }
    if (aExp != null && bExp == null) return -1;
    if (aExp == null && bExp != null) return 1;
    return createdDesc(a, b);
  });
}

/** Archived: newest archivedAt first; fallback updatedAt then createdAt. */
function sortArchivedDocuments(list) {
  return list.slice().sort((a, b) => {
    const ta = docTimeMs(a.archivedAt) ?? docTimeMs(a.updatedAt) ?? docTimeMs(a.createdAt) ?? 0;
    const tb = docTimeMs(b.archivedAt) ?? docTimeMs(b.updatedAt) ?? docTimeMs(b.createdAt) ?? 0;
    return tb - ta;
  });
}

function renderActiveSubheader(title, isFirst) {
  const mt = isFirst ? "0" : "14px";
  return `<h5 style="margin:${mt} 0 8px 0;font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(title)}</h5>`;
}

/** Bucket for filters/counts: archived → pending → else derive from expiration when present. */
function bucketForSummary(doc) {
  const life = String(doc.lifecycleStatus || "").toLowerCase();
  if (life === "archived") return "archived";
  const approval = String(doc.approvalStatus || "").toLowerCase();
  if (approval === "pending") return "pending";
  if (doc.expirationDate != null) {
    return ffComputeLifecycleFromExpiration(doc.expirationDate);
  }
  const ls = String(doc.lifecycleStatus || "").toLowerCase();
  if (ls === "expired" || ls === "expiring_soon" || ls === "active") return ls;
  return "active";
}

/** Phase 9: filter list by chip id (uses groupDocument + bucketForSummary). */
function filterDocumentsByChip(docs, chip) {
  if (chip === "all") return docs.slice();
  if (chip === "archived") return docs.filter((d) => groupDocument(d) === "archived");
  if (chip === "expired") return docs.filter((d) => bucketForSummary(d) === "expired");
  if (chip === "expiring_soon") return docs.filter((d) => bucketForSummary(d) === "expiring_soon");
  if (chip === "active") {
    return docs.filter((d) => {
      const b = bucketForSummary(d);
      return b === "active" || b === "pending";
    });
  }
  return docs.slice();
}

function countForChipId(list, chipId) {
  if (chipId === "all") return list.length;
  return filterDocumentsByChip(list, chipId).length;
}

/** Phase 10: trim + collapse spaces; empty string = no search. */
function normalizeStaffDocSearch(q) {
  return String(q ?? "").trim().replace(/\s+/g, " ");
}

/** Case-insensitive partial match on title, type, fileName (missing fields safe). */
function docMatchesSearch(doc, qNorm) {
  if (!qNorm) return true;
  const n = qNorm.toLowerCase();
  const parts = [doc.title, doc.type, doc.fileName].map((x) =>
    x != null ? String(x).toLowerCase() : ""
  );
  return parts.some((p) => p.includes(n));
}

/** Phase 8 sort rules applied to a single-filter result set. */
function sortDocumentsForFilterChip(docs, chip) {
  if (chip === "archived") return sortArchivedDocuments(docs);
  if (chip === "expired" || chip === "expiring_soon" || chip === "active") {
    return sortActiveDocuments(docs);
  }
  return docs.slice();
}

const STAFF_DOC_FILTER_CHIPS = [
  { id: "active", label: "Active" },
  { id: "expiring_soon", label: "Expiring Soon" },
  { id: "expired", label: "Expired" },
  { id: "archived", label: "Archived" },
  { id: "all", label: "All" },
];

function renderFilterChipsHtml(currentFilter, list) {
  const options = STAFF_DOC_FILTER_CHIPS.map((c) => {
    const n = countForChipId(list, c.id);
    const selected = currentFilter === c.id ? " selected" : "";
    return `<option value="${escapeHtml(c.id)}"${selected}>${escapeHtml(c.label)} (${n})</option>`;
  }).join("");
  return `<label style="display:flex;align-items:center;gap:8px;width:100%;">
    <span style="font-size:11px;font-weight:600;color:#6b7280;white-space:nowrap;">Filter</span>
    <select data-ff-doc-filter-select aria-label="Document filter" style="width:100%;min-height:36px;padding:7px 34px 7px 11px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;color:#111827;font-size:12px;font-weight:600;font-family:inherit;box-sizing:border-box;cursor:pointer;">
      ${options}
    </select>
  </label>`;
}

export {
  trimStr,
  stripUndefined,
  parseExpirationForStaffDoc,
  calendarDaysUntilExpiry,
  escapeHtml,
  escapeAttr,
  toDateMaybe,
  formatWhen,
  formatDay,
  formatDocumentTitle,
  formatApprovalLabel,
  formatLifecycleLabel,
  staffDocsEmptyMessageHtml,
  staffDocsShellStyle,
  expiryBadgeState,
  badgeStyle,
  badgeHtml,
  isPortalEsignDocument,
  groupDocument,
  tierForActiveSectionDoc,
  docTimeMs,
  sortActiveDocuments,
  sortArchivedDocuments,
  renderActiveSubheader,
  bucketForSummary,
  filterDocumentsByChip,
  countForChipId,
  normalizeStaffDocSearch,
  docMatchesSearch,
  sortDocumentsForFilterChip,
  STAFF_DOC_FILTER_CHIPS,
  renderFilterChipsHtml,
};
