/**
 * Inbox — pure stateless helpers.
 *
 * Self-contained utilities for the Inbox/Requests module: date normalization,
 * expiry/type classification + noise filters, role/permission evaluation
 * (operate on a passed-in profile), supply-line parsing, and number/date
 * formatting. Location isolation helpers may read the header switcher on window.
 * Extracted verbatim from inbox.js.
 */

import { ffExpirationTimestampToYmdInput } from "./staff-documents.js?v=20260701_staffdoc_render_split";

/** Normalize Firestore/string date to YYYY-MM-DD for &lt;input type="date"&gt;. */
export function ffInboxYmdFromRaw(v) {
  if (v == null || v === "") return "";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return ffExpirationTimestampToYmdInput(v);
}

/** Inclusive YYYY-MM-DD list — same shape schedule-availability expects for ranges / affectedDates. */
export function enumerateInclusiveDateKeysForInbox(startDateStr, endDateStr) {
  const start = String(startDateStr || "").trim();
  const end = String(endDateStr || start || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return [];
  const a = new Date(`${start}T12:00:00`);
  const b = new Date(`${end}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || a > b) return [];
  const out = [];
  for (let d = new Date(a.getTime()); d <= b; d.setDate(d.getDate() + 1)) {
    out.push([
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0"),
    ].join("-"));
  }
  return out;
}

function inboxExpiringDateToMillis(v) {
  if (v == null) return null;
  try {
    if (typeof v.toMillis === "function") return v.toMillis();
    if (typeof v.toDate === "function") return v.toDate().getTime();
  } catch (_) {}
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    const s = v.trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T12:00:00.000Z`).getTime();
  }
  return null;
}

/** document_expiring_soon rows past expiration → group under document_expired (To handle). */
export function inboxEffectiveTypeForGrouping(req) {
  const t = String(req?.type || "").trim();
  if (t !== "document_expiring_soon") return t || "other";
  const expRaw = req?.expirationDate ?? req?.data?.expirationDate;
  const expMs = inboxExpiringDateToMillis(expRaw);
  if (expMs != null && Date.now() > expMs) return "document_expired";
  return "document_expiring_soon";
}

/** True if this doc-alert row should show as "expired" in the card (type or past expiry date). */
export function inboxDocAlertIsExpiredForUi(request) {
  const t = String(request?.type || "").trim();
  if (t === "document_expired") return true;
  if (t !== "document_expiring_soon") return false;
  const expMs = inboxExpiringDateToMillis(request?.expirationDate ?? request?.data?.expirationDate);
  return expMs != null && Date.now() > expMs;
}

/** Mistaken "Other" rows (e.g. staff-call noise) — hide from admin My Requests and from technicians' Inbox. */
export function ffInboxIsStaffCallOtherNoise(r) {
  const t = String(r?.type || "").trim();
  if (t !== "other") return false;
  const d = r?.data || {};
  const msg = String(r?.message || "").toLowerCase();
  const subj = String(r?.title || r?.subject || d.subject || d.title || "").toLowerCase();
  const det = String(d.details || "").toLowerCase();
  if (String(d.source || "").toLowerCase() === "staff_call") return true;
  if (msg.includes("staff call") || subj.includes("staff call") || det.includes("staff call")) return true;
  return false;
}

export function inboxItemActivityMs(r) {
  const la = r && r.lastActivityAt;
  const ca = r && r.createdAt;
  if (la && typeof la.toMillis === 'function') return la.toMillis();
  if (ca && typeof ca.toMillis === 'function') return ca.toMillis();
  return 0;
}

export function inboxErrorNeedsIndex(error) {
  const msg = String(error?.message || "").toLowerCase();
  return error?.code === "failed-precondition" &&
    (msg.includes("requires an index") || msg.includes("index is currently building"));
}

/** Map users/membership role strings to the Inbox notion of "line staff" (= technician). */
export function inboxNormalizeLineStaffRoleLc(raw) {
  const r = String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
  if (
    r === "technician" ||
    r === "tech" ||
    r === "staff" ||
    r === "service_provider" ||
    r === "service provider" ||
    r === "serviceprovider"
  ) {
    return "technician";
  }
  return r;
}

/** Roles that historically had full inbox access before per-staff permission flags. */
function inboxLegacyDeskRoleLc(roleLc) {
  return ["manager", "admin", "owner", "front_desk", "assistant_manager"].includes(roleLc);
}

export function inboxCanViewInboxEval(profile) {
  // Salon owner/admin session must never be blocked by a missing/partial profile merge.
  if (inboxSessionIsSalonOwnerOrAdmin()) return true;
  if (!profile) return false;
  // Owner/admin/manager always have inbox_view access, even if the permissions map
  // is missing (e.g. a brand-new owner whose users/{uid} doc has no staff merge yet).
  // This mirrors the legacy desk-role behaviour used by inboxCanManageInboxEval below.
  const role = inboxNormalizeLineStaffRoleLc(profile.role || "");
  if (inboxLegacyDeskRoleLc(role)) return true;
  const p = profile.permissions || {};
  return p.inbox_view === true;
}

export function inboxSessionIsSalonOwnerOrAdmin() {
  try {
    if (typeof window !== "undefined" && typeof window.ffIsOwner === "function" && window.ffIsOwner() === true) {
      return true;
    }
    const sessionRole = String(
      (typeof window !== "undefined" && (window.__ff_user_role || window.__ff_actorRole)) ||
        (typeof sessionStorage !== "undefined" ? sessionStorage.getItem("ff_actor_role") : "") ||
        ""
    )
      .toLowerCase()
      .trim();
    if (sessionRole === "owner" || sessionRole === "admin") return true;
  } catch (_) {}
  return false;
}

export function inboxCanManageInboxEval(profile) {
  if (!profile && !inboxSessionIsSalonOwnerOrAdmin()) return false;
  const role = inboxNormalizeLineStaffRoleLc((profile && profile.role) || "");
  // Owner/admin always get "To handle" — inbox_manage:false on staff must not hide it.
  if (role === "owner" || role === "admin" || inboxSessionIsSalonOwnerOrAdmin()) return true;
  // Desk managers also always see To handle (legacy + product expectation).
  if (role === "manager" || role === "assistant_manager" || role === "front_desk") {
    return true;
  }
  const p = (profile && profile.permissions) || {};
  if (p.inbox_manage === false) return false;
  if (p.inbox_manage === true) return true;
  return inboxLegacyDeskRoleLc(role);
}

export function inboxCanSendRequestsEval(profile) {
  // Owners/admins can always create requests (same as manage / view).
  if (inboxSessionIsSalonOwnerOrAdmin()) return true;
  if (!profile) return false;
  const role = inboxNormalizeLineStaffRoleLc(profile.role || "");
  const p = profile.permissions || {};
  if (inboxCanManageInboxEval(profile)) return true;
  if (p.inbox_send === false) return false;
  if (p.inbox_send === true) return true;
  if (role === "technician") {
    return true;
  }
  if (p.inbox_manage === false) return false;
  return inboxLegacyDeskRoleLc(role);
}

/** Firestore inboxItems create rules require string identity fields; staging user/staff docs sometimes store role as a number. */
export function ffInboxRuleString(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return String(v);
}

/** Format a numeric daysLeft value for display: 1 decimal when small, integer when big. */
export function ffSuggestionFmtDays(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (n < 0) return '0';
  if (n < 10) return (Math.round(n * 10) / 10).toString();
  return Math.round(n).toString();
}

/** Human-readable avg use per day for the smart card (e.g. "3.5/day" or "0.4/day"). */
export function ffSuggestionFmtRate(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 10) return `${Math.round(n)}/day`;
  return `${Math.round(n * 10) / 10}/day`;
}

/** Supply requests use pending → approved | denied; legacy supplies may still be status open. */
export function inboxSupplyRequestIsPending(request) {
  if (!request || String(request.type || "").trim() !== "supplies") return false;
  const s = String(request.status || "").trim();
  return s === "pending" || s === "open";
}

/** Human-readable decision label for supply requests (modal + cards + details). */
export function inboxSupplyStatusDisplayLabel(request) {
  if (!request || String(request.type || "").trim() !== "supplies") return null;
  const s = String(request.status || "").trim();
  if (s === "pending" || s === "open") return "Pending";
  if (s === "approved") return "Approved";
  if (s === "denied") return "Denied";
  return s.replace(/_/g, " ");
}

function parseApprovedSupplyLineQty(line) {
  const q = line?.qty;
  if (q == null || q === "") return null;
  const n = typeof q === "number" ? q : Number(String(q).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function parseApprovedSupplyLineUnit(line) {
  const u = line?.unit;
  if (u == null || u === "") return null;
  const t = String(u).trim();
  return t === "" ? null : t.slice(0, 80);
}

/** Parse a cell's approved qty + contributions (mirrors inventory.js getCellApprovedInfo). */
function ffGetCellApprovedInfoInbox(cell) {
  if (!cell || typeof cell !== "object") return { approved: 0, approvedRequests: [] };
  const list = Array.isArray(cell.approvedRequests) ? cell.approvedRequests : [];
  const approved = list.reduce((acc, e) => acc + (typeof e?.qty === "number" ? e.qty : Number(e?.qty) || 0), 0);
  return { approved, approvedRequests: list };
}

/** Heuristic: category/subcategory names suggest dip/gel/regular inventory. */
function suppliesCategorySubcategoryVariantsRelevant(categoryName, subcategoryName) {
  const s = `${categoryName || ""} ${subcategoryName || ""}`.toLowerCase();
  if (!s.trim()) return false;
  return /(dip|gel|powder|acrylic|lacquer|polish|color|nail)/.test(s);
}

/**
 * No longer needed — groups in the inventory row now act as variants, captured via the item select's
 * composite `rowId:groupId` value. Kept as a no-op for back-compat with existing call sites.
 */
export function suppliesRowRequiresVariant(_row) {
  return false;
}

/** Active location from the header switcher. */
export function inboxGetActiveLocationId() {
  try {
    if (typeof window !== 'undefined' && typeof window.ffGetActiveLocationId === 'function') {
      const v = window.ffGetActiveLocationId();
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    if (typeof window !== 'undefined' && typeof window.__ff_active_location_id === 'string'
        && window.__ff_active_location_id.trim()) {
      return window.__ff_active_location_id.trim();
    }
  } catch (_) {}
  return '';
}

export function inboxUserHasMultipleLocations() {
  try {
    if (typeof window !== 'undefined' && typeof window.ffUserHasMultipleLocations === 'function') {
      if (window.ffUserHasMultipleLocations()) return true;
    }
    if (typeof window !== 'undefined' && typeof window.ffGetLocations === 'function') {
      const locs = (window.ffGetLocations() || []).filter(l => l && l.isActive !== false);
      if (locs.length > 1) return true;
    }
  } catch (_) {}
  return false;
}

export function inboxPrimaryLocationId() {
  try {
    const w = typeof window !== 'undefined' ? window : {};
    if (typeof w.ffResolveCurrentStaff === 'function' && typeof w.ffEnsureStaffLocationFields === 'function') {
      const row = w.ffResolveCurrentStaff();
      if (row) {
        const f = w.ffEnsureStaffLocationFields(row);
        const primary = typeof f.primaryLocationId === 'string' ? f.primaryLocationId.trim() : '';
        if (primary) return primary;
      }
    }
    if (typeof w.ffGetUserAllowedLocations === 'function') {
      const locs = w.ffGetUserAllowedLocations();
      if (Array.isArray(locs) && locs[0] && locs[0].id) return String(locs[0].id).trim();
    }
  } catch (_) {}
  return '';
}

export function inboxHasActiveLocationForWrite() {
  if (!inboxUserHasMultipleLocations()) return true;
  return !!inboxGetActiveLocationId();
}

/**
 * Inbox row belongs to the active branch only.
 * Stamped locationId must match. Unstamped/legacy rows: single-location salons,
 * or the primary branch only — never every allowed location of the subject staff.
 */
export function inboxItemMatchesActiveLocation(req, activeLocationId) {
  const multi = inboxUserHasMultipleLocations();
  const active = typeof activeLocationId === 'string' && activeLocationId.trim()
    ? activeLocationId.trim()
    : inboxGetActiveLocationId();
  const explicitTop = req && typeof req.locationId === 'string' ? req.locationId.trim() : '';
  const data = req && req.data && typeof req.data === 'object' ? req.data : null;
  const explicitData = data && typeof data.locationId === 'string' ? data.locationId.trim() : '';
  const explicit = explicitTop || explicitData;
  if (!active) return !multi;
  if (explicit) return explicit === active;
  if (!multi) return true;
  const primary = inboxPrimaryLocationId();
  return !!primary && active === primary;
}

export function inboxMemberAllowedAtActiveLocation(member) {
  if (!member) return false;
  const activeLoc = inboxGetActiveLocationId();
  const multi = inboxUserHasMultipleLocations();
  if (!activeLoc) return !multi;

  const roleLc = String(member.role || '').toLowerCase().trim();
  let staffRow = null;
  try {
    const store = typeof window.ffGetStaffStore === 'function' ? window.ffGetStaffStore() : null;
    const staff = store && Array.isArray(store.staff) ? store.staff : [];
    const uid = String(member.uid || '').trim();
    const staffId = String(member.staffId || member.id || '').trim();
    staffRow = staff.find(s => s && (
      (uid && (String(s.uid || '').trim() === uid || String(s.firebaseUid || '').trim() === uid))
      || (staffId && String(s.id || '').trim() === staffId)
    )) || null;
  } catch (_) {}

  if (staffRow && typeof window.ffEnsureStaffLocationFields === 'function') {
    try {
      const f = window.ffEnsureStaffLocationFields(staffRow);
      const allowed = Array.isArray(f.allowedLocationIds)
        ? f.allowedLocationIds.map(id => String(id || '').trim()).filter(Boolean)
        : [];
      if (allowed.length) return allowed.indexOf(activeLoc) !== -1;
      const primary = typeof f.primaryLocationId === 'string' ? f.primaryLocationId.trim() : '';
      if (primary) return primary === activeLoc;
    } catch (_) {}
  }

  if (Array.isArray(member.allowedLocationIds) && member.allowedLocationIds.length) {
    return member.allowedLocationIds.map(id => String(id || '').trim()).indexOf(activeLoc) !== -1;
  }
  if (typeof member.primaryLocationId === 'string' && member.primaryLocationId.trim()) {
    return member.primaryLocationId.trim() === activeLoc;
  }
  if (roleLc === 'owner') return true;
  return !multi;
}

export function formatRelativeDate(date) {
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  return date.toLocaleDateString();
}
