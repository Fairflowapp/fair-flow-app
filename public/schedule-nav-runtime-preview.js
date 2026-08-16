// schedule-nav-runtime-preview.js
// Schedule preview orchestration — module init wiring and refresh/build flow.
// Extracted verbatim from schedule-nav-runtime.js (nav-runtime split T1).

// schedule-nav-runtime.js
// Schedule runtime orchestration — module init wiring, refresh/build flow,
// navigation, event binding, window hooks, and console utilities. Extracted
// verbatim from schedule-nav.js (schedule-nav split T2).

import {
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  updateDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  deleteField,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { auth, db } from "/app.js?v=20260610_force_lp_ios";
import { generateWeeklySchedule } from "./schedule-generator.js?v=20260615_default_schedule_source";
import { validateScheduleDraft } from "./schedule-validator.js?v=20260409_coverage_total_staff_skip";
import {
  getEffectiveAvailabilityForDate,
  getInboxApprovalDisplayForDate,
  isApprovedRequest,
} from "./schedule-availability.js?v=20260615_default_schedule_source";
import { parseScheduleTimeToMinutes } from "./schedule-helpers.js?v=20260704_schedule_helpers_split";
import "./format-utils.js?v=20260806_sched_12h_picker";
import { scheduleState } from "./schedule-state.js?v=20260702_schedule_state";
import {
  initScheduleRender,
  bindScheduleCoverageDayClick,
  bindScheduleStaffProfileLinks,
  bindScheduleStandByPen,
  buildCoverageMinimalGapLinesHtml,
  buildScheduleCoverageModalBodyHtml,
  closeScheduleDayCoverageModal,
  closeScheduleStandByModal,
  ensureScheduleDayCoverageModal,
  ensureScheduleStandByModal,
  formatScheduleCoverageModalDateTitle,
  getCoverageOverlapGapsForModal,
  openScheduleCoverageDayModal,
  openScheduleStandByModal,
  renderScheduleBoard,
  renderScheduleStandByRowHtml,
  renderScheduleSummary,
  renderStandBySlotNamesHtml,
  setScheduleLoadingState,
  setSchedulePreviewMode,
  setSchedulePreviewView,
  shortenCoverageWarningForModal,
} from "./schedule-render.js?v=20260816_cell_notes6";
import {
  _ffActiveLocationNameForIcs,
  _ffAdaptAssignmentToShift,
  _ffCalendarTimezone,
  _ffCollectAuthedUserWeeklyShifts,
  _ffCurrentSalonNameForIcs,
  _ffDebugLogAuthedUserWeeklyHours,
  _ffIcsEscape,
  _ffIcsFormatLocalDateTime,
  _ffResolveAuthedStaffNameForDebug,
  buildMyShiftsIcsForCurrentWeek,
  downloadMyShiftsIcsForCurrentWeek,
  ffDownloadCalendarFile,
  ffOpenCalendarUrl,
  ffShareOrDownloadAllShifts,
  ffShowMobileCalendarChoice,
  isLikelyAndroidCalendarDevice,
  isLikelyMobileCalendarDevice,
} from "./schedule-ics.js?v=20260702_schedule_ics";
import {
  initScheduleDnd,
  bindScheduleBoardDnD,
  clearDropZoneVisual,
  closeScheduleApprovedTimeConflictModal,
  closeScheduleCrossLocationConflictModal,
  completeScheduleDrop,
  confirmScheduleApprovedTimeConflictModal,
  confirmScheduleCrossLocationConflict,
  ensureScheduleApprovedTimeConflictModal,
  ensureScheduleCrossLocationConflictModal,
  getAssignmentFromDragPayload,
  getCrossLocationConflictForShift,
  getStaffByScheduleKey,
  handleDropZoneDragLeave,
  handleDropZoneDragOver,
  handleDropZoneDrop,
  handleScheduleShiftClick,
  handleShiftDragEnd,
  handleShiftDragStart,
  moveDraftAssignment,
  openScheduleApprovedTimeConflictModal,
  remapAssignmentToStaff,
  revalidateLocalDraft,
} from "./schedule-dnd.js?v=20260702_schedule_dnd";
import {
  initScheduleDraft,
  SCHEDULE_DRAFT_OVERRIDE_KEY_VER,
  SCHEDULE_DRAFT_OVERRIDE_PAYLOAD_VER,
  SCHEDULE_LAST_BUILD_CACHE_VER,
  SCHEDULE_MANUAL_OFF_STORAGE_VERSION,
  addManualOffForStaffDay,
  applyDraftDaysOverride,
  buildAssignmentLookup,
  clearScheduleLocalDirtyForCurrentUser,
  clearSharedScheduleDraftOverrideForWeek,
  cloneScheduleDraft,
  computeFingerprintMapForDraft,
  computeStaffShiftFingerprintForWeek,
  dayHasManualOff,
  discardSavedScheduleWeekDraftAndReload,
  findDraftDay,
  getAssignmentId,
  getCellNoteForStaffDay,
  getScheduleDraftOverrideStorageKey,
  getScheduleLocalDirtyStorageKey,
  getScheduleManualOffStorageKey,
  getSchedulePreviewSalonStorageKey,
  loadScheduleDraftDaysOverride,
  loadScheduleDraftOverridePayload,
  loadScheduleManualOffOverrides,
  markScheduleDayAsOffFromModal,
  mergeManualOffOverridesIntoDraft,
  notifyStaffScheduleChanges,
  persistScheduleDraftOverrideFromState,
  persistScheduleManualOffFromState,
  persistStaffShiftFingerprintsForWeek,
  removeManualOffForStaffDay,
  runDiscardSavedScheduleWeekDraftAndReload,
  saveScheduleWeekDraftToCloud,
  serializeDraftDaysForStorage,
  setCellNoteForStaffDay,
  simpleHashString,
  staffDayBlockedByApprovedInbox,
  syncPublishedWeekStandByToCloud,
} from "./schedule-draft.js?v=20260816_cell_notes6";
import {
  initScheduleCloud,
  canViewScheduleBoardForCurrentWeek,
  ensureSchedulePublishListener,
  fetchSchedulePublishedMap,
  getScheduleLastBuildCacheStorageKey,
  getSchedulePublishDocRef,
  isAuthedUserMultiLocationForWeek,
  loadAllStaffShiftsFromOtherLocationsForWeek,
  loadCrossLocationBusyForWeek,
  loadMyShiftsFromOtherLocationsForWeek,
  loadOtherLocationLastBuildCache,
  loadOtherLocationLocalDraftDays,
  loadOtherLocationWeekDraftDays,
  loadWeekDraftSnapshotBlockFromPublishDoc,
  renderScheduleUnpublishedPlaceholder,
  saveScheduleLastBuildCacheForActiveLocation,
  teardownSchedulePublishListener,
  toggleScheduleWeekPublished,
  updateSchedulePublishToggleUi,
} from "./schedule-cloud.js?v=20260702_schedule_cloud";
import {
  SCHEDULE_COVERAGE_WARNING_CODES,
  SCHEDULE_TIME_COMPOSITE_CLASS,
  addDays,
  applyScheduleTimeFieldDisplay,
  buildScheduleMinuteOptions,
  cellShowsScheduleWarningDot,
  compareScheduleHHMM,
  earlierScheduleHHMM,
  filterCoverageWarnings,
  filterNonCoverageWarnings,
  formatBoardDayLabel,
  formatLongDate,
  formatScheduleRawRangeDisplay,
  formatScheduleTimeDisplay,
  formatScheduleTimeRangeDisplay,
  formatScheduleTimeShortAmPm,
  formatWeekLabel,
  formatWeeklyHoursShort,
  getApprovedPartialRequestHints,
  getApprovedPartialTimeConflictMessage,
  getDayNameFromDateKey,
  getFilteredScheduleStaff,
  getScheduleStaffKey,
  getScheduleStaffRole,
  getSeverityBadgeStyle,
  getStartOfWeek,
  getValidationByDate,
  getWeekRange,
  getWeekStartsOnPreference,
  getOrCreateScheduleTimeComposite,
  hhmmFromTimeInput,
  isManagementScheduleStaff,
  isTechnicianScheduleStaff,
  laterScheduleHHMM,
  normalizeTimeValue,
  setScheduleTimeCompositeDisabled,
  setScheduleTimeFieldValue,
  syncScheduleCompositeFromHHMM,
  syncScheduleHiddenFromComposite,
  syncScheduleWeekFilterUi,
  toDateKey,
  warningAppliesToStaffRow,
} from "./schedule-format.js?v=20260806_sched_12h_picker";
import {
  _ffSchedActiveLocId,
  _ffSchedPerLocDocId,
  _ffSchedPublishDocId,
  ensureScheduleChangePingListener,
  ensureScheduleWeekAckListener,
  ffScheduleAppToast,
  ffScheduleStaffBroadcastToast,
  getAuthedStaffIdForSchedule,
  initScheduleAck,
  loadScheduleWeekPingMap,
  submitScheduleWeekAck,
  teardownScheduleAckListener,
  teardownScheduleChangePingListener,
  updateScheduleWeekAckStrip,
} from "./schedule-ack.js?v=20260702_schedule_ack";
import {
  bindScheduleBoardManualAdd,
  bindScheduleShiftEditButtons,
  closeScheduleShiftEdit,
  ensureScheduleRebuildConfirmModal,
  escapeScheduleAttr,
  escapeScheduleHtml,
  formatLunchBreakCellSubtitle,
  getScheduleAccessContext,
  initScheduleShiftEdit,
  openScheduleDnDOffConfirm,
  openScheduleShiftEdit,
  scheduleUserCanManualEdit,
} from "./schedule-shift-edit.js?v=20260816_cell_notes6";
import {
  STAND_BY_SLOTS,
  SCHEDULE_INBOX_TYPES_FOR_AVAILABILITY,
  _ffSchedApplyPerLocationSchedule,
  _ffSchedStaffInActiveLocation,
  applyBusinessSettingsToDraft,
  cloneStandByByDateMap,
  computeStaffWeeklyScheduledMinutes,
  ensureScheduleTechTypeMap,
  formatScheduleTechnicianTypes,
  getBusinessStatusForDate,
  getDefaultShiftTimesForDate,
  getScheduleRoleLabel,
  loadApprovedScheduleRequests,
  loadScheduleStaffList,
  mergeStandByByDatePreferLocal,
  normalizeStandByBlock,
  normalizeTwoStandBySlots,
  parseStandByDayEntry,
  rebuildScheduleTechTypeMap,
  renderScheduleCrossLocationConflictBanner,
  renderScheduleViewTabs,
  resolveStandByStaffMember,
  scheduleInboxUserIsFirestoreManager,
  standByDayEntryHasAny,
  standByMapsEqual,
  initScheduleNavCore,
} from "./schedule-nav-core.js?v=20260703_schedule_nav_wiring_fix";

// Wire nav-core back-references.
initScheduleNavCore({ renderScheduleBoard, refreshSchedulePreview });

// Wire draft helpers (function declarations below are hoisted).
initScheduleDraft({
  _ffActiveLocationNameForIcs,
  applyBusinessSettingsToDraft,
  cloneStandByByDateMap,
  getBusinessStatusForDate,
  getStaffByScheduleKey,
  normalizeStandByBlock,
  refreshSchedulePreview,
  renderScheduleBoard,
  renderScheduleSummary,
  revalidateLocalDraft,
  standByMapsEqual,
});

// Wire schedule-cloud back-references (storage constants are imports here, no TDZ).
initScheduleCloud({
  SCHEDULE_DRAFT_OVERRIDE_KEY_VER,
  SCHEDULE_DRAFT_OVERRIDE_PAYLOAD_VER,
  SCHEDULE_LAST_BUILD_CACHE_VER,
  clearScheduleLocalDirtyForCurrentUser,
  clearSharedScheduleDraftOverrideForWeek,
  cloneStandByByDateMap,
  loadScheduleDraftOverridePayload,
  persistStaffShiftFingerprintsForWeek,
  refreshSchedulePreview,
  serializeDraftDaysForStorage,
});

// Wire DnD helpers (function declarations below are hoisted).
initScheduleDnd({
  renderScheduleBoard,
  renderScheduleSummary,
  renderScheduleViewTabs,
});

// Default to next week — managers usually plan/publish the upcoming week, not the one already in progress.
scheduleState.schedulePreviewWeekStart = addDays(getStartOfWeek(new Date()), 7);

// Wire the ack module's back-references into this file (function declarations
// below are hoisted, so this is safe at module-eval time).
initScheduleAck({
  renderScheduleBoard,
  getWeekRange,
  canViewScheduleBoardForCurrentWeek,
  getScheduleAccessContext,
  scheduleInboxUserIsFirestoreManager,
  scheduleUserCanManualEdit,
});

// Wire the shift-edit module's back-references into this file (function
// declarations below are hoisted, so this is safe at module-eval time).
initScheduleShiftEdit({
  renderScheduleBoard,
  renderScheduleSummary,
  revalidateLocalDraft,
  cloneScheduleDraft,
  findDraftDay,
  dayHasManualOff,
  removeManualOffForStaffDay,
  markScheduleDayAsOffFromModal,
  runDiscardSavedScheduleWeekDraftAndReload,
  staffDayBlockedByApprovedInbox,
  getApprovedPartialRequestHints,
  getApprovedPartialTimeConflictMessage,
  openScheduleApprovedTimeConflictModal,
  getCrossLocationConflictForShift,
  confirmScheduleCrossLocationConflict,
  completeScheduleDrop,
  getStaffByScheduleKey,
  getScheduleStaffKey,
  getScheduleStaffRole,
  getBusinessStatusForDate,
  getDefaultShiftTimesForDate,
  applyBusinessSettingsToDraft,
  getCellNoteForStaffDay,
  setCellNoteForStaffDay,
  hhmmFromTimeInput,
  setScheduleTimeFieldValue,
  setScheduleTimeCompositeDisabled,
  applyScheduleTimeFieldDisplay,
  formatScheduleTimeShortAmPm,
  compareScheduleHHMM,
  earlierScheduleHHMM,
  laterScheduleHHMM,
  _ffActiveLocationNameForIcs,
});

/** "YYYY-MM-DD" + "HH:MM" → "YYYYMMDDTHHMMSS" (iCalendar local/floating time). */

// Wire render helpers (stand-by/business helpers below are hoisted/initialized before runtime use).
initScheduleRender({
  STAND_BY_SLOTS,
  cloneStandByByDateMap,
  computeStaffWeeklyScheduledMinutes,
  formatScheduleTechnicianTypes,
  getBusinessStatusForDate,
  getScheduleRoleLabel,
  parseStandByDayEntry,
  renderScheduleViewTabs,
  resolveStandByStaffMember,
  standByDayEntryHasAny,
});

async function refreshSchedulePreview(options = {}) {
  const ignoreSavedDrafts = options?.ignoreSavedDrafts === true;
  const persistFreshLocalDraft = options?.persistFreshLocalDraft === true;
  const weekRange = getWeekRange(scheduleState.schedulePreviewWeekStart);
  const weekLabel = document.getElementById("scheduleWeekLabel");
  if (weekLabel) weekLabel.textContent = formatWeekLabel(weekRange);

  await fetchSchedulePublishedMap();
  ensureSchedulePublishListener();

  setScheduleLoadingState({ loading: true, error: "" });

  try {
    const [staffList, requests] = await Promise.all([
      loadScheduleStaffList(),
      loadApprovedScheduleRequests(),
    ]);
    await ensureScheduleTechTypeMap();

    const rules = (window.settings && typeof window.settings.scheduleRules === "object")
      ? window.settings.scheduleRules
      : {};
    const coverageRules = (window.settings && typeof window.settings.coverageRules === "object")
      ? window.settings.coverageRules
      : undefined;
    const businessHours = (window.settings && typeof window.settings.businessHours === "object")
      ? window.settings.businessHours
      : undefined;
    const dayShiftSegments = (window.settings && typeof window.settings.dayShiftSegments === "object")
      ? window.settings.dayShiftSegments
      : undefined;

    // Multi-location: load every OTHER branch's week draft so the generator
    // can skip a staff member who is already booked for overlapping hours
    // elsewhere on the same day. Intentionally non-blocking on failure —
    // if the read errors out we fall back to no cross-location data and
    // behave exactly as before (with the banner still surfacing the
    // conflict in the Default Schedule editor).
    const crossLocationBusy = await loadCrossLocationBusyForWeek(weekRange);

    const draft = generateWeeklySchedule({
      staffList,
      requests,
      rules,
      businessHours,
      coverageRules,
      dayShiftSegments,
      dateRange: { startDate: weekRange.startDate, endDate: weekRange.endDate },
      crossLocationBusy,
    });
    let draftWithBusinessRules = applyBusinessSettingsToDraft(draft);
    const localPayload = loadScheduleDraftOverridePayload(weekRange);
    const localDraftDays = localPayload?.days || null;
    const cloudBlock = await loadWeekDraftSnapshotBlockFromPublishDoc(weekRange.startDate);
    const cloudDraftDays = cloudBlock.days;
    const weekPublished = scheduleState.schedulePublishedMap[weekRange.startDate] === true;
    const dirtyKey = getScheduleLocalDirtyStorageKey(weekRange.startDate);
    const localDirty =
      typeof localStorage !== "undefined" &&
      dirtyKey &&
      localStorage.getItem(dirtyKey) === "1";
    const canEdit = scheduleUserCanManualEdit();
    const hasLocal = !ignoreSavedDrafts && Array.isArray(localDraftDays) && localDraftDays.length > 0;
    const hasCloud = !ignoreSavedDrafts && Array.isArray(cloudDraftDays) && cloudDraftDays.length > 0;

    let standByByDate = {};

    if (canEdit && hasLocal && localDirty) {
      draftWithBusinessRules = applyDraftDaysOverride(draftWithBusinessRules, localDraftDays, staffList);
      standByByDate = normalizeStandByBlock(
        {
          standByByDate: localPayload?.standByByDate,
          standByStaffId: localPayload?.standByStaffId,
        },
        draftWithBusinessRules.days,
      );
    } else if (weekPublished && hasCloud) {
      draftWithBusinessRules = applyDraftDaysOverride(draftWithBusinessRules, cloudDraftDays, staffList);
      standByByDate = normalizeStandByBlock(cloudBlock, draftWithBusinessRules.days);
    } else if (canEdit && hasLocal) {
      draftWithBusinessRules = applyDraftDaysOverride(draftWithBusinessRules, localDraftDays, staffList);
      standByByDate = normalizeStandByBlock(
        {
          standByByDate: localPayload?.standByByDate,
          standByStaffId: localPayload?.standByStaffId,
        },
        draftWithBusinessRules.days,
      );
    } else if (hasCloud) {
      draftWithBusinessRules = applyDraftDaysOverride(draftWithBusinessRules, cloudDraftDays, staffList);
      standByByDate = normalizeStandByBlock(cloudBlock, draftWithBusinessRules.days);
    } else {
      const manualOffOverrides = loadScheduleManualOffOverrides(weekRange);
      if (!ignoreSavedDrafts) {
        draftWithBusinessRules = mergeManualOffOverridesIntoDraft(draftWithBusinessRules, manualOffOverrides, staffList);
      }
      const fromLocal = normalizeStandByBlock(
        {
          standByByDate: localPayload?.standByByDate,
          standByStaffId: localPayload?.standByStaffId,
        },
        draftWithBusinessRules.days,
      );
      const fromCloud = normalizeStandByBlock(cloudBlock, draftWithBusinessRules.days);
      standByByDate = ignoreSavedDrafts ? {} : (Object.keys(fromLocal).length > 0 ? fromLocal : fromCloud);
    }

    /* Published week: merge stand-by from Firestore; local wins per date when set; per-view fallback from cloud. */
    if (weekPublished && !ignoreSavedDrafts) {
      const cloudSb = normalizeStandByBlock(cloudBlock, draftWithBusinessRules.days);
      standByByDate = mergeStandByByDatePreferLocal(cloudSb, standByByDate, draftWithBusinessRules.days);
    }

    const validation = validateScheduleDraft({
      draftSchedule: draftWithBusinessRules,
      staffList,
      requests,
      rules: draftWithBusinessRules.rules,
      coverageRules,
      dateRange: { startDate: weekRange.startDate, endDate: weekRange.endDate },
    });

    // Cache the final (post-override) draft for the active location so that
    // when the owner switches to another branch and hits Build, the
    // cross-location busy-map picks up these shifts and prevents
    // double-booking the same staff member on overlapping hours. Saved on
    // every refresh; cheap. Writes under a separate cache key so it doesn't
    // collide with user "override" edits.
    saveScheduleLastBuildCacheForActiveLocation(weekRange, draftWithBusinessRules);

    // Stage 1 "unified My shifts": for the authed user, pull their shifts
    // from every OTHER active location so the My-shifts view can show a
    // single row with a branch tag on each cell instead of forcing the user
    // to switch active locations to see their full week.
    const myShiftsFromOtherLocs = await loadMyShiftsFromOtherLocationsForWeek(weekRange);

    // Stage 2 "unified management view": for managers/owners building the
    // schedule, pull EVERY staff member's other-location shifts so each cell
    // can show a branch tag for multi-location staff (display only).
    const allStaffOtherLocShifts = canEdit
      ? await loadAllStaffShiftsFromOtherLocationsForWeek(weekRange)
      : new Map();

    scheduleState.schedulePreviewState = {
      draft: draftWithBusinessRules,
      validation,
      weekRange,
      staffList,
      coverageRules,
      requests,
      businessHours,
      standByByDate,
      myShiftsFromOtherLocs,
      allStaffOtherLocShifts,
    };
    if (typeof window !== "undefined") {
      window.ffSchedulePreviewState = scheduleState.schedulePreviewState;
    }
    if (persistFreshLocalDraft && canEdit) {
      persistScheduleDraftOverrideFromState();
    }
    if (!canViewScheduleBoardForCurrentWeek()) {
      teardownScheduleAckListener();
      teardownScheduleChangePingListener();
      updateScheduleWeekAckStrip();
      renderScheduleUnpublishedPlaceholder(weekRange);
      renderScheduleViewTabs();
      updateSchedulePublishToggleUi();
      setScheduleLoadingState({ loading: false, error: "" });
      return;
    }
    if (scheduleState.schedulePublishedMap[weekRange.startDate] === true) {
      ensureScheduleWeekAckListener(weekRange.startDate);
      ensureScheduleChangePingListener(weekRange.startDate);
    } else {
      teardownScheduleAckListener();
      teardownScheduleChangePingListener();
      updateScheduleWeekAckStrip();
    }
    await loadScheduleWeekPingMap(weekRange.startDate);
    renderScheduleSummary(validation, validation.days);
    renderScheduleViewTabs();
    renderScheduleCrossLocationConflictBanner();
    renderScheduleBoard(draftWithBusinessRules, validation, staffList);
    updateSchedulePublishToggleUi();
    updateScheduleWeekAckStrip();
    setScheduleLoadingState({ loading: false, error: "" });
  } catch (error) {
    console.error("[ScheduleUI] Failed to refresh schedule preview", error);
    scheduleState.schedulePreviewState = {
      draft: null,
      validation: null,
      weekRange,
      staffList: [],
      requests: [],
      businessHours: undefined,
      standByByDate: {},
      myShiftsFromOtherLocs: new Map(),
      allStaffOtherLocShifts: new Map(),
    };
    if (typeof window !== "undefined") {
      window.ffSchedulePreviewState = scheduleState.schedulePreviewState;
    }
    renderScheduleSummary({ summary: { totalWarnings: 0, highSeverityCount: 0 } }, []);
    renderScheduleViewTabs();
    (() => { const b = document.getElementById("scheduleCrossLocConflictBanner"); if (b) b.style.display = "none"; })();
    renderScheduleBoard(null, null, []);
    teardownScheduleAckListener();
    teardownScheduleChangePingListener();
    updateScheduleWeekAckStrip();
    updateSchedulePublishToggleUi();
    setScheduleLoadingState({ loading: false, error: error?.message || "Failed to build schedule preview." });
  }
}

export { refreshSchedulePreview };
