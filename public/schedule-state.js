// schedule-state.js
// Shared mutable state for the Schedule UI module graph. Extracted from
// schedule-ui.js (Phase 0 of the schedule-ui split): every module-level `let`
// moved here as a property of a single exported object, and all references in
// schedule-ui.js were mechanically renamed `var` -> `scheduleState.var`.
// Comments were carried over from the original declarations.

export const scheduleState = {
  // Default is the current week (set at module-eval in schedule-nav-runtime-preview.js).
  schedulePreviewWeekStart: null,
  schedulePreviewState: {
    draft: null,
    validation: null,
    weekRange: null,
    staffList: [],
    /** Approved inbox items used for availability (same as generator/validator). */
    requests: [],
    /** Salon business hours object from settings (optional). */
    businessHours: undefined,
    /** date (YYYY-MM-DD) -> { technicians: [id,id], management: [id,id] } (legacy: string per day). */
    standByByDate: {},
  },
  schedulePreviewView: "management",
  /** Editors only: "my_shifts" = personal row, view + ack | "build" = full grid editing. */
  schedulePreviewMode: "build",

  scheduleDragState: null,
  scheduleShiftEditPayload: null,

  /** ISO week start (Mon/Sun per prefs) -> true when that week is published for all staff */
  schedulePublishedMap: {},
  schedulePublishUnsub: null,
  schedulePublishSalonSubscribed: "",
  schedulePublishPrevMap: null,
  schedulePublishSuppressToast: false,
  /** Milliseconds of last seen `lastBroadcastAt` (Firestore); used to notify all clients when a week is published. */
  schedulePublishLastSeenBroadcastMs: null,
  /** weekStart -> JSON string of `weekDraftSnapshots[weekStart]` from last snapshot; detect draft updates for staff. */
  lastSeenWeekDraftSnapshotJsonByWeek: {},
  lastSeenWeekPublishedSnapshotJsonByWeek: {},
  /** Writer skips the echo refresh after its own server write (other devices still refresh). */
  scheduleSkipNextDraftSnapshotRefresh: false,
  /** Ignore own-write snapshot echoes for a short window (serverTimestamp can fire twice). */
  scheduleSkipDraftRefreshUntil: 0,
  /** staffId -> seenAt millis (0 = not acknowledged) */
  scheduleWeekAckSeenAtByStaffId: {},
  /** staffId -> last scheduleStaffChangePings.pingAt millis (managers’ grid) */
  scheduleWeekPingAtByStaffId: {},
  scheduleAckUnsub: null,
  scheduleAckSalonWeek: "",
  scheduleChangePingUnsub: null,
  scheduleChangePingSubKey: "",
  /** Avoid duplicate toasts for the same ping timestamp */
  scheduleChangePingShownToastMs: 0,
  /** When drag-drop needs confirm before placing shift on Marked OFF cell: { payload, targetStaffId, targetDate } */
  scheduleDnDConfirmPending: null,
  /** After user confirms placing a shift that conflicts with approved late_start / early_leave */
  scheduleApprovedTimeConflictContinue: null,
  scheduleSaveSkipApprovedTimeConflictOnce: false,
  /** Promise resolver for the cross-location (double-booking) confirm modal. */
  scheduleCrossLocationConflictResolver: null,

  /** Custom technician-type id -> display name (from salons/{salonId}/technicianTypes). */
  scheduleTechTypeNameById: {},
  scheduleTechTypesListenerBound: false,
  scheduleTechTypesLoaded: false,

  /** De-dup key for the weekly-hours console debug log (see _ffDebugLogAuthedUserWeeklyHours). */
  _ffLastHoursDebugKey: null,

  scheduleStandByModalDateKey: null,
  /** Snapshots of draft + stand-by before each local edit. */
  scheduleUndoStack: [],
  scheduleUndoSkip: false,
};
