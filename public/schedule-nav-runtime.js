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
import { parseScheduleTimeToMinutes } from "./schedule-helpers.js?v=20260420_per_loc_no_default";
import "./format-utils.js";
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
} from "./schedule-render.js?v=20260702_schedule_render";
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
  simpleHashString,
  staffDayBlockedByApprovedInbox,
  syncPublishedWeekStandByToCloud,
} from "./schedule-draft.js?v=20260702_schedule_draft";
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
} from "./schedule-format.js?v=20260702_schedule_format";
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
} from "./schedule-shift-edit.js?v=20260702_schedule_shift_edit";
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
} from "./schedule-nav-core.js?v=20260703_schedule_nav_split";

// Wire nav-core back-references.
initScheduleNavCore({ renderScheduleBoard, refreshSchedulePreview });

// Default to next week — managers usually plan/publish the upcoming week, not the one already in progress.
scheduleState.schedulePreviewWeekStart = addDays(getStartOfWeek(new Date()), 7);

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
} from "./schedule-shift-edit.js?v=20260702_schedule_shift_edit";

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

function applyScheduleWeekFilter() {
  const filterSelect = document.getElementById("scheduleWeekFilter");
  const customDateInput = document.getElementById("scheduleCustomWeekDate");
  const mode = filterSelect?.value || "current";

  if (mode === "previous") {
    scheduleState.schedulePreviewWeekStart = addDays(getStartOfWeek(new Date()), -7);
    syncScheduleWeekFilterUi();
    refreshSchedulePreview();
    return;
  }

  if (mode === "next") {
    scheduleState.schedulePreviewWeekStart = addDays(getStartOfWeek(new Date()), 7);
    syncScheduleWeekFilterUi();
    refreshSchedulePreview();
    return;
  }

  if (mode === "in2") {
    scheduleState.schedulePreviewWeekStart = addDays(getStartOfWeek(new Date()), 14);
    syncScheduleWeekFilterUi();
    refreshSchedulePreview();
    return;
  }

  if (mode === "in3") {
    scheduleState.schedulePreviewWeekStart = addDays(getStartOfWeek(new Date()), 21);
    syncScheduleWeekFilterUi();
    refreshSchedulePreview();
    return;
  }

  if (mode === "in4") {
    scheduleState.schedulePreviewWeekStart = addDays(getStartOfWeek(new Date()), 28);
    syncScheduleWeekFilterUi();
    refreshSchedulePreview();
    return;
  }

  if (mode === "custom") {
    syncScheduleWeekFilterUi();
    const dateValue = customDateInput?.value;
    if (!dateValue) return;
    scheduleState.schedulePreviewWeekStart = getStartOfWeek(new Date(`${dateValue}T00:00:00`));
    refreshSchedulePreview();
    return;
  }

  scheduleState.schedulePreviewWeekStart = getStartOfWeek(new Date());
  syncScheduleWeekFilterUi();
  refreshSchedulePreview();
}

function hideScheduleScreen() {
  const screen = document.getElementById("scheduleScreen");
  if (screen) screen.style.display = "none";
  const btn = document.getElementById("scheduleBtn");
  if (btn) btn.classList.remove("active");
  if (typeof window.ffUpdateMobileHeaderTitle === "function") window.ffUpdateMobileHeaderTitle();
}

export async function goToSchedule() {
  const schedCtx =
    typeof window.ffGetSchedulePermissionContext === "function"
      ? window.ffGetSchedulePermissionContext()
      : getScheduleAccessContext();
  if (schedCtx.noAccess) {
    ffScheduleAppToast("You do not have permission to open Schedule.", 4000);
    return;
  }

  if (typeof window.ffCloseGlobalBlockingOverlays === "function") {
    try {
      window.ffCloseGlobalBlockingOverlays();
    } catch (e) {}
  }
  if (typeof window.closeStaffMembersModal === "function") {
    window.closeStaffMembersModal();
  }
  const screenIdsToHide = [
    "tasksScreen",
    "inboxScreen",
    "chatScreen",
    "mediaScreen",
    "ticketsScreen",
    "trainingScreen",
    "userProfileScreen",
    "manageQueueScreen",
    "timeClockScreen",
    "dashboardScreen",
    "queueAnalyticsScreen",
    "ticketsAnalyticsScreen",
    "timeAnalyticsScreen",
    "tasksAnalyticsScreen",
  ];
  screenIdsToHide.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });

  const ownerView = document.getElementById("owner-view");
  const joinBar = document.getElementById("joinBar");
  const queueControls = document.getElementById("queueControls");
  const wrap = document.querySelector(".wrap");
  if (ownerView) ownerView.style.display = "none";
  if (joinBar) joinBar.style.display = "none";
  if (queueControls) queueControls.style.display = "none";
  if (wrap) wrap.style.display = "none";

  const screen = document.getElementById("scheduleScreen");
  if (screen) screen.style.display = "flex";

  document.querySelectorAll(".btn-pill").forEach((button) => button.classList.remove("active"));
  const scheduleBtn = document.getElementById("scheduleBtn");
  if (scheduleBtn) scheduleBtn.classList.add("active");

  await refreshSchedulePreview();

  if (typeof window.ffUpdateMobileHeaderTitle === "function") window.ffUpdateMobileHeaderTitle();

  if (Array.isArray(scheduleState.schedulePreviewState.staffList) && scheduleState.schedulePreviewState.staffList.length) {
    const sid = String(
      typeof window !== "undefined" && window.__ff_authedStaffId
        ? window.__ff_authedStaffId
        : (typeof localStorage !== "undefined" ? localStorage.getItem("ff_authedStaffId_v1") : "") || "",
    ).trim();
    const me = scheduleState.schedulePreviewState.staffList.find((s) => getScheduleStaffKey(s) === sid);
    const shouldFocusOwnSchedule =
      schedCtx.viewOwnOnly ||
      (me && isTechnicianScheduleStaff(me) && !scheduleInboxUserIsFirestoreManager());
    if (me && shouldFocusOwnSchedule && canViewScheduleBoardForCurrentWeek()) {
      if (schedCtx.viewOwnOnly) scheduleState.schedulePreviewMode = "my_shifts";
      scheduleState.schedulePreviewView = isTechnicianScheduleStaff(me) ? "technicians" : "management";
      renderScheduleViewTabs();
      renderScheduleBoard(scheduleState.schedulePreviewState.draft, scheduleState.schedulePreviewState.validation, scheduleState.schedulePreviewState.staffList);
    }
  }
}

function setScheduleMobileControlsCollapsed(collapsed) {
  const screen = document.getElementById("scheduleScreen");
  const btn = document.getElementById("scheduleMobileControlsToggle");
  const icon = document.getElementById("scheduleMobileControlsToggleIcon");
  if (!screen || !btn) return;
  screen.classList.toggle("ff-schedule-controls-collapsed", collapsed === true);
  btn.setAttribute("aria-expanded", collapsed === true ? "false" : "true");
  btn.setAttribute("aria-label", collapsed === true ? "Show schedule controls" : "Collapse schedule controls");
  btn.setAttribute("title", collapsed === true ? "Show controls" : "Collapse controls");
  if (icon) icon.textContent = collapsed === true ? "\u25BC" : "\u25B2";
}

function bindScheduleUi() {
  const scheduleOpenSettingsBtn = document.getElementById("scheduleScreenOpenSettingsBtn");
  if (scheduleOpenSettingsBtn && !scheduleOpenSettingsBtn.__ffOpenScheduleSettingsBound) {
    scheduleOpenSettingsBtn.__ffOpenScheduleSettingsBound = true;
    scheduleOpenSettingsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      // Close the board first so goToUserProfile does not use ff-overlay-from-schedule (same layout as Settings → Schedule from the menu).
      hideScheduleScreen();
      if (typeof window !== "undefined" && typeof window.goToUserProfile === "function") {
        window.goToUserProfile("schedule");
      }
    });
  }

  const scheduleMobileControlsToggle = document.getElementById("scheduleMobileControlsToggle");
  if (scheduleMobileControlsToggle && !scheduleMobileControlsToggle.__ffScheduleMobileControlsBound) {
    scheduleMobileControlsToggle.__ffScheduleMobileControlsBound = true;
    scheduleMobileControlsToggle.addEventListener("click", (e) => {
      e.preventDefault();
      const screen = document.getElementById("scheduleScreen");
      const collapsed = !(screen && screen.classList.contains("ff-schedule-controls-collapsed"));
      setScheduleMobileControlsCollapsed(collapsed);
    });
  }

  document.getElementById("scheduleBtn")?.addEventListener("click", goToSchedule);
  document.getElementById("scheduleViewMyShiftsBtn")?.addEventListener("click", () => setSchedulePreviewMode("my_shifts"));
  document.getElementById("scheduleViewBuildScheduleBtn")?.addEventListener("click", () => setSchedulePreviewMode("build"));
  document.getElementById("scheduleViewManagementBtn")?.addEventListener("click", () => setSchedulePreviewView("management"));
  document.getElementById("scheduleViewTechniciansBtn")?.addEventListener("click", () => setSchedulePreviewView("technicians"));
  document.getElementById("scheduleWeekFilter")?.addEventListener("change", () => {
    syncScheduleWeekFilterUi();
    const mode = document.getElementById("scheduleWeekFilter")?.value || "next";
    if (mode !== "custom") applyScheduleWeekFilter();
  });
  document.getElementById("scheduleApplyCustomWeekBtn")?.addEventListener("click", applyScheduleWeekFilter);

  const schedulePublishToggleBtn = document.getElementById("schedulePublishToggleBtn");
  if (schedulePublishToggleBtn && !schedulePublishToggleBtn.__ffSchedulePublishBound) {
    schedulePublishToggleBtn.__ffSchedulePublishBound = true;
    schedulePublishToggleBtn.addEventListener("click", () => {
      toggleScheduleWeekPublished();
    });
  }

  const scheduleSaveDraftBtn = document.getElementById("scheduleSaveDraftBtn");
  if (scheduleSaveDraftBtn && !scheduleSaveDraftBtn.__ffScheduleSaveDraftBound) {
    scheduleSaveDraftBtn.__ffScheduleSaveDraftBound = true;
    scheduleSaveDraftBtn.addEventListener("click", () => {
      saveScheduleWeekDraftToCloud();
    });
  }

  const scheduleNotifyChangesBtn = document.getElementById("scheduleNotifyChangesBtn");
  if (scheduleNotifyChangesBtn && !scheduleNotifyChangesBtn.__ffScheduleNotifyChangesBound) {
    scheduleNotifyChangesBtn.__ffScheduleNotifyChangesBound = true;
    scheduleNotifyChangesBtn.addEventListener("click", () => {
      notifyStaffScheduleChanges();
    });
  }

  const scheduleDiscardSavedDraftBtn = document.getElementById("scheduleDiscardSavedDraftBtn");
  if (scheduleDiscardSavedDraftBtn && !scheduleDiscardSavedDraftBtn.__ffScheduleDiscardSavedDraftBound) {
    scheduleDiscardSavedDraftBtn.__ffScheduleDiscardSavedDraftBound = true;
    scheduleDiscardSavedDraftBtn.addEventListener("click", () => {
      discardSavedScheduleWeekDraftAndReload();
    });
  }

  ["queueBtn", "ticketsBtn", "tasksBtn", "chatBtn", "inboxBtn", "mediaBtn", "appsBtn", "trainingBtn"].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn && !btn.__ffScheduleHideBound) {
      btn.__ffScheduleHideBound = true;
      btn.addEventListener("click", () => {
        if (id !== "scheduleBtn") hideScheduleScreen();
      }, { capture: true });
    }
  });

  if (typeof window !== "undefined" && !window.__ffSchedulePublishKickStarted) {
    window.__ffSchedulePublishKickStarted = true;
    let tries = 0;
    const kickId = setInterval(() => {
      tries += 1;
      if (String(window.currentSalonId || "").trim()) {
        ensureSchedulePublishListener();
        clearInterval(kickId);
      } else if (tries > 80) {
        clearInterval(kickId);
      }
    }, 400);
  }

  // Multi-location isolation: when the user switches branches, every cloud
  // listener is tied to the old branch's doc id → tear them down, reset the
  // caches, and re-bind against the new location-specific paths. If the
  // Schedule screen is currently visible we also trigger a full preview
  // refresh so the grid doesn't show stale cross-branch data.
  if (typeof document !== "undefined" && !document.__ffScheduleLocChangeBound) {
    document.__ffScheduleLocChangeBound = true;
    const handler = () => {
      try {
        teardownSchedulePublishListener();
        teardownScheduleAckListener();
        teardownScheduleChangePingListener();
        scheduleState.schedulePublishedMap = {};
        scheduleState.scheduleWeekAckSeenAtByStaffId = {};
        scheduleState.scheduleWeekPingAtByStaffId = {};
        scheduleState.lastSeenWeekDraftSnapshotJsonByWeek = {};
        scheduleState.schedulePreviewState = {
          draft: null,
          validation: null,
          weekRange: null,
          staffList: [],
          requests: [],
          businessHours: undefined,
          standByByDate: {},
        };
        if (typeof window !== "undefined") {
          window.ffSchedulePreviewState = scheduleState.schedulePreviewState;
        }
        ensureSchedulePublishListener();
        const screen = document.getElementById("scheduleScreen");
        if (screen && screen.style.display !== "none" && typeof refreshSchedulePreview === "function") {
          void refreshSchedulePreview();
        }
      } catch (e) {
        console.warn("[ScheduleUI] location change handler failed", e);
      }
    };
    document.addEventListener("ff-active-location-changed", handler);
    window.addEventListener("ff-active-location-changed", handler);
    const settingsUpdatedHandler = () => {
      const screen = document.getElementById("scheduleScreen");
      if (screen && screen.style.display !== "none") {
        renderScheduleCrossLocationConflictBanner();
        renderScheduleBoard(scheduleState.schedulePreviewState.draft, scheduleState.schedulePreviewState.validation, scheduleState.schedulePreviewState.staffList);
      }
    };
    document.addEventListener("ff-schedule-settings-changed", settingsUpdatedHandler);
    window.addEventListener("ff-schedule-settings-changed", settingsUpdatedHandler);
    // When the owner edits a staff member's Locations tab we also need to
    // re-evaluate who belongs in the current branch's grid.
    const staffUpdatedHandler = () => {
      const screen = document.getElementById("scheduleScreen");
      if (screen && screen.style.display !== "none" && typeof refreshSchedulePreview === "function") {
        void refreshSchedulePreview();
      }
    };
    document.addEventListener("ff-staff-cloud-updated", staffUpdatedHandler);
    window.addEventListener("ff-staff-cloud-updated", staffUpdatedHandler);
  }
}

if (typeof window !== "undefined") {
  window.ffScheduleRefreshPermissionChrome = () => {
    updateSchedulePublishToggleUi();
    renderScheduleSummary(
      scheduleState.schedulePreviewState?.validation,
      scheduleState.schedulePreviewState?.validation?.days || [],
    );
  };
  window.goToSchedule = goToSchedule;
  window.ffSchedulePreviewState = scheduleState.schedulePreviewState;
  window.refreshSchedulePreview = refreshSchedulePreview;
  window.setSchedulePreviewView = setSchedulePreviewView;
  window.setSchedulePreviewMode = setSchedulePreviewMode;
  window.toggleScheduleWeekPublished = toggleScheduleWeekPublished;
  window.submitScheduleWeekAck = submitScheduleWeekAck;
  window.notifyStaffScheduleChanges = notifyStaffScheduleChanges;
  window.ffDiscardSavedScheduleWeekDraft = discardSavedScheduleWeekDraftAndReload;

  // Console utility: list duplicate staff members by name. Useful for finding
  // accidentally-duplicated profiles (e.g. two "Test Multi" Admins) that cause
  // doubled rows in the Schedule / Staff sidebar. Usage: ffListDuplicateStaff()
  // Merge the unique data from the "archive" staff record into the "keep"
  // staff record (only fills blanks on keep; never overwrites existing data),
  // then archives the duplicate. This is the safe way to resolve duplicated
  // staff profiles that share the same person but drift on some fields.
  //
  // Usage: await ffMergeAndArchiveDuplicateStaff("KEEP_ID", "ARCHIVE_ID")
  window.ffMergeAndArchiveDuplicateStaff = async function ffMergeAndArchiveDuplicateStaff(keepId, archiveId) {
    const kId = String(keepId || "").trim();
    const aId = String(archiveId || "").trim();
    if (!kId || !aId || kId === aId) {
      console.warn("[StaffDedupe] provide two distinct IDs: keepId, archiveId");
      return false;
    }
    const store = typeof window.ffGetStaffStore === "function" ? window.ffGetStaffStore() : { staff: [] };
    const list = Array.isArray(store?.staff) ? store.staff : [];
    const keepIdx = list.findIndex((s) => String(s?.id || "") === kId);
    const archIdx = list.findIndex((s) => String(s?.id || "") === aId);
    if (keepIdx === -1) { console.warn("[StaffDedupe] keepId not found:", kId); return false; }
    if (archIdx === -1) { console.warn("[StaffDedupe] archiveId not found:", aId); return false; }
    const keep = list[keepIdx];
    const arch = list[archIdx];

    // Only fill blanks on keep — never clobber existing data.
    const blank = (v) => v === undefined || v === null ||
      (typeof v === "string" && v.trim() === "") ||
      (Array.isArray(v) && v.length === 0) ||
      (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

    const merged = { ...keep };
    const fieldsToCopy = [
      "allowedLocationIds", "primaryLocationId", "locationScheduleAvailability",
      "defaultSchedule", "constraints", "weeklyHoursTarget", "employmentType",
      "technicianTypes", "permissions", "buttonColor", "color", "fontColor", "fcolor",
      "managerType", "phone", "birthday", "pin",
    ];
    const copied = [];
    fieldsToCopy.forEach((f) => {
      if (blank(merged[f]) && !blank(arch[f])) {
        merged[f] = arch[f];
        copied.push(f);
      }
    });
    merged.updatedAtMs = Date.now();

    list[keepIdx] = merged;
    list[archIdx] = { ...arch, isArchived: true, updatedAtMs: Date.now() };

    if (typeof window.ffSaveStaffStore === "function") window.ffSaveStaffStore(store);
    try { document.dispatchEvent(new CustomEvent("ff-staff-cloud-updated")); } catch (_) {}

    console.log(`[StaffDedupe] Merged ${copied.length ? copied.join(", ") : "(nothing — keep already had all fields)"} from ${aId} into ${kId}.`);
    console.log(`[StaffDedupe] Archived ${aId}. Toggle "Show Archived Staff" in the sidebar to view archived rows.`);
    return true;
  };

  // Archive a staff record by Firestore ID (safer than delete — keeps history).
  // Usage: await ffArchiveStaffById("abc123")
  window.ffArchiveStaffById = async function ffArchiveStaffById(staffId) {
    const id = String(staffId || "").trim();
    if (!id) { console.warn("[StaffDedupe] missing id"); return false; }
    try {
      const store = typeof window.ffGetStaffStore === "function" ? window.ffGetStaffStore() : { staff: [] };
      const list = Array.isArray(store?.staff) ? store.staff : [];
      const idx = list.findIndex((s) => String(s?.id || "") === id);
      if (idx === -1) { console.warn("[StaffDedupe] id not found in store:", id); return false; }
      const target = list[idx];
      list[idx] = { ...target, isArchived: true, updatedAtMs: Date.now() };
      if (typeof window.ffSaveStaffStore === "function") window.ffSaveStaffStore(store);
      console.log(`[StaffDedupe] Archived "${target.name}" (${id}). Toggle 'Show Archived Staff' to view archived rows.`);
      try { document.dispatchEvent(new CustomEvent("ff-staff-cloud-updated")); } catch (_) {}
      return true;
    } catch (err) {
      console.error("[StaffDedupe] archive failed", err);
      return false;
    }
  };

  window.ffListDuplicateStaff = function ffListDuplicateStaff() {
    try {
      const store = typeof window.ffGetStaffStore === "function" ? window.ffGetStaffStore() : { staff: [] };
      const list = Array.isArray(store?.staff) ? store.staff : [];
      const byName = new Map();
      list.forEach((s) => {
        if (!s || s.isArchived === true) return;
        const name = String(s.name || s.fullName || "").trim().toLowerCase();
        if (!name) return;
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(s);
      });
      const dups = [];
      byName.forEach((arr, name) => {
        if (arr.length > 1) dups.push({ name, count: arr.length, records: arr });
      });
      if (!dups.length) {
        console.log("[StaffDedupe] No duplicate staff names detected.");
        return [];
      }
      // Emit a compact comparison table per name so the user can scan
      // the rows side-by-side and pick which one to keep. The table
      // highlights the fields that usually differ between a real profile
      // and an accidentally-re-invited duplicate.
      console.log(`[StaffDedupe] Found ${dups.length} duplicated staff name${dups.length === 1 ? "" : "s"}. Scroll down for tables.`);
      dups.forEach((d) => {
        const rows = d.records.map((r) => {
          const perLocKeys = r.locationScheduleAvailability && typeof r.locationScheduleAvailability === "object"
            ? Object.keys(r.locationScheduleAvailability).length
            : 0;
          const createdMs = typeof r.createdAt === "number" ? r.createdAt : (r.createdAt?.toMillis ? r.createdAt.toMillis() : null);
          const updatedMs = typeof r.updatedAtMs === "number" ? r.updatedAtMs : null;
          return {
            id: String(r.id || ""),
            idTail: String(r.id || "").slice(-6),
            email: String(r.email || ""),
            role: String(r.role || ""),
            allowedLocs: Array.isArray(r.allowedLocationIds) ? r.allowedLocationIds.length : 0,
            primaryLoc: String(r.primaryLocationId || ""),
            perLocSchedules: perLocKeys,
            inviteSentCount: r.invite?.sentCount || 0,
            invited: r.invited === true,
            hasPin: !!r.pin,
            created: createdMs ? new Date(createdMs).toISOString() : "",
            updated: updatedMs ? new Date(updatedMs).toISOString() : "",
          };
        });
        console.log(`── ${d.name} — ${d.count} records ──`);
        console.table(rows);
        console.log(`To archive one, copy its full id from the table above and run:`);
        console.log(`  await ffArchiveStaffById("<paste id here>")`);
      });
      return dups;
    } catch (err) {
      console.warn("[StaffDedupe] failed", err);
      return [];
    }
  };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindScheduleUi);
} else {
  bindScheduleUi();
}


export {
  goToSchedule,
  refreshSchedulePreview,
  hideScheduleScreen,
};
