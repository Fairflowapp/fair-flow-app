/**
 * staff-writeups-state.js — shared mutable state + constants for the
 * Employee Write-Ups tab (Phase 1: confidential incidents).
 *
 * Data lives at salons/{salonId}/staff/{staffId}/writeupIncidents/{incidentId}
 * and is readable ONLY by owner / admin / staff with permissions.writeups_manage
 * (enforced in firestore.rules — the UI gate is visibility only).
 */

export const wuState = {
  _unsub: null,
  _mountedKey: "",
  _mountCtx: { salonId: "", staffId: "" },
  _boundContainer: null,
  _onActionClick: null,
  /** @type {Array<Record<string, unknown>> | null} null = still loading */
  _lastIncidentList: null,
  /** Load error message ("" = no error). */
  _loadError: "",
  _statusFilter: "all",
  /** Cached per-salon write-up settings ({ threshold, windowDays }). */
  _settings: null,
  _settingsSalonId: "",
  _saveInFlight: false,
  // ---- Phase 2: formal write-ups (admin side) ----
  _formalUnsub: null,
  /** @type {Array<Record<string, unknown>> | null} null = still loading */
  _formalList: null,
  _formalError: "",
  /** mailId -> 'queued' | 'failed' (resolved lazily for email status chips). */
  _mailStates: {},
  _sendInFlight: false,
};

export const WRITEUP_INCIDENT_TYPES = [
  { id: "late_arrival", label: "Late Arrival" },
  { id: "absence", label: "Absence" },
  { id: "no_call_no_show", label: "No Call / No Show" },
  { id: "left_early", label: "Left Early" },
  { id: "customer_complaint", label: "Customer Complaint" },
  { id: "failure_to_complete_task", label: "Failure to Complete Task" },
  { id: "policy_violation", label: "Policy Violation" },
  { id: "inappropriate_conduct", label: "Inappropriate Conduct" },
  { id: "other", label: "Other" },
];

export function writeupTypeLabel(typeId) {
  const t = WRITEUP_INCIDENT_TYPES.find((x) => x.id === typeId);
  return t ? t.label : typeId ? String(typeId) : "—";
}

export const WRITEUP_STATUSES = [
  { id: "documented", label: "Documented" },
  { id: "excused", label: "Excused" },
  { id: "included_in_writeup", label: "Included in Write-Up" },
];

export function writeupStatusLabel(statusId) {
  const s = WRITEUP_STATUSES.find((x) => x.id === statusId);
  return s ? s.label : statusId ? String(statusId) : "—";
}

export const WRITEUP_FILTER_IDS = new Set([
  "all",
  "documented",
  "excused",
  "included_in_writeup",
]);

/** Local defaults — no settings doc is required per salon in Phase 1. */
export const WRITEUP_DEFAULT_SETTINGS = { threshold: 3, windowDays: 30 };

/** Statuses that count toward the repeated-incident suggestion. */
export const WRITEUP_COUNTABLE_STATUSES = new Set([
  "documented",
  "included_in_writeup",
]);

/** Attachment upload limits (same as the staff documents / inbox uploads). */
export const WRITEUP_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const WRITEUP_ACCEPT_FILE_TYPES = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif";

// ---------------------------------------------------------------------------
// Phase 2 — formal write-ups
// ---------------------------------------------------------------------------

export const WRITEUP_WARNING_LEVELS = [
  { id: "coaching_verbal", label: "Coaching / Verbal Warning Documentation" },
  { id: "written", label: "Written Warning" },
  { id: "final_written", label: "Final Written Warning" },
];

export function writeupWarningLevelLabel(id) {
  const w = WRITEUP_WARNING_LEVELS.find((x) => x.id === id);
  return w ? w.label : id ? String(id) : "—";
}

/**
 * Formal write-up lifecycle (admin workflow doc):
 *   draft -> sending -> sent -> (superseded)
 * "sending" is set by the backend when Approve & Send starts; a write-up stuck
 * in "sending" after a partial failure is resumed by calling the same
 * callable again (every send step is idempotent).
 */
export const WRITEUP_FORMAL_STATUSES = [
  { id: "draft", label: "Draft" },
  { id: "sending", label: "Sending…" },
  { id: "sent", label: "Sent" },
  { id: "superseded", label: "Superseded" },
];

export function writeupFormalStatusLabel(id) {
  const s = WRITEUP_FORMAL_STATUSES.find((x) => x.id === id);
  return s ? s.label : id ? String(id) : "—";
}

/** Exact employee acknowledgment wording — do not alter. */
export const WRITEUP_ACK_TEXT =
  "My acknowledgment confirms that I received and reviewed this write-up. It does not necessarily mean that I agree with it.";

/** Default email draft — deliberately contains no incident details. */
export function writeupDefaultEmailSubject(salonName) {
  return `Important document from ${String(salonName || "").trim() || "your salon"}`;
}

export function writeupDefaultEmailBody(salonName, employeeFirstName) {
  const salon = String(salonName || "").trim() || "your salon";
  const hi = String(employeeFirstName || "").trim();
  return (
    `${hi ? `Hi ${hi},` : "Hello,"}\n\n` +
    `You have received an important document from ${salon} Management.\n\n` +
    `Please sign in to Fair Flow to review and acknowledge it. ` +
    `The document is available in your profile under "My Write-Ups."\n\n` +
    `Thank you,\n${salon} Management`
  );
}

/**
 * Location auto-selection for the formal write-up composer (pure — testable).
 *
 * Order of precedence:
 *   1. If every selected incident carries the same non-empty locationId and
 *      that location exists in `locations`, select it.
 *   2. If the employee is assigned to exactly one active location, select it.
 *   3. Otherwise no auto-selection — the composer shows a required dropdown.
 *
 * `locations` = active location docs ({id, name}) offered in the dropdown:
 * the employee's assigned active locations when any exist, else every active
 * salon location (so Salon/Location are never left blank when a valid
 * location exists).
 *
 * Returns { locations, autoSelectedId } — autoSelectedId is "" when the admin
 * must choose.
 */
export function computeWriteupLocationChoice(opts) {
  const trim = (v) => String(v == null ? "" : v).trim();
  const o = opts || {};
  const allActive = (Array.isArray(o.activeLocations) ? o.activeLocations : [])
    .filter((l) => l && trim(l.id))
    .map((l) => ({ id: trim(l.id), name: trim(l.name) || trim(l.id) }));
  const byId = {};
  allActive.forEach((l) => {
    byId[l.id] = l;
  });

  const staff = o.staffRow && typeof o.staffRow === "object" ? o.staffRow : {};
  const rawAssigned = Array.isArray(staff.allowedLocationIds)
    ? staff.allowedLocationIds
    : trim(staff.primaryLocationId)
      ? [trim(staff.primaryLocationId)]
      : [];
  const assigned = [];
  rawAssigned.forEach((id) => {
    const t = trim(id);
    if (t && byId[t] && !assigned.some((l) => l.id === t)) assigned.push(byId[t]);
  });

  const locations = assigned.length ? assigned : allActive;

  // 1. All selected incidents agree on one existing location.
  const selectedIds = new Set((Array.isArray(o.selectedIncidentIds) ? o.selectedIncidentIds : []).map(trim));
  const incidentLocIds = new Set();
  (Array.isArray(o.incidents) ? o.incidents : []).forEach((inc) => {
    if (inc && selectedIds.has(trim(inc.id))) incidentLocIds.add(trim(inc.locationId));
  });
  if (incidentLocIds.size === 1) {
    const only = incidentLocIds.values().next().value;
    if (only && locations.some((l) => l.id === only)) {
      return { locations, autoSelectedId: only };
    }
  }

  // 2. Exactly one assigned active location.
  if (assigned.length === 1) return { locations, autoSelectedId: assigned[0].id };

  // 3. Single option overall (e.g. salon has one location) — still automatic.
  if (locations.length === 1) return { locations, autoSelectedId: locations[0].id };

  return { locations, autoSelectedId: "" };
}
