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
