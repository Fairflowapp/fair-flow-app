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



/** Max two stand-by contacts per view (technicians vs management) per day. */
const STAND_BY_SLOTS = 2;

function normalizeTwoStandBySlots(val) {
  if (Array.isArray(val)) {
    return [String(val[0] || "").trim(), String(val[1] || "").trim()];
  }
  if (typeof val === "string") {
    const s = val.trim();
    return s ? [s, ""] : ["", ""];
  }
  return ["", ""];
}

/**
 * Legacy: string (one staff id per day).
 * New: { technicians: [a,b], management: [a,b] }.
 */
function parseStandByDayEntry(raw) {
  if (raw == null || raw === "") {
    return { technicians: ["", ""], management: ["", ""] };
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return { technicians: ["", ""], management: ["", ""] };
    return { technicians: [s, ""], management: [s, ""] };
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return {
      technicians: normalizeTwoStandBySlots(raw.technicians),
      management: normalizeTwoStandBySlots(raw.management),
    };
  }
  return { technicians: ["", ""], management: ["", ""] };
}

function standByDayEntryHasAny(entry) {
  const e = parseStandByDayEntry(entry);
  return (
    e.technicians[0] ||
    e.technicians[1] ||
    e.management[0] ||
    e.management[1]
  );
}

function cloneStandByByDateMap(map) {
  try {
    return JSON.parse(JSON.stringify(map && typeof map === "object" ? map : {}));
  } catch (_) {
    return {};
  }
}

/** Per-day stand-by map for this week; migrates legacy single `standByStaffId` / string map. */
function normalizeStandByBlock(block, draftDays) {
  const dates = (Array.isArray(draftDays) ? draftDays : []).map((d) => d.date).filter(Boolean);
  const out = {};
  const rawMap = block?.standByByDate && typeof block.standByByDate === "object" ? block.standByByDate : {};
  for (const dt of dates) {
    const parsed = parseStandByDayEntry(rawMap[dt]);
    if (standByDayEntryHasAny(parsed)) out[dt] = parsed;
  }
  if (Object.keys(out).length === 0 && typeof block?.standByStaffId === "string" && block.standByStaffId.trim()) {
    const leg = block.standByStaffId.trim();
    const entry = { technicians: [leg, ""], management: [leg, ""] };
    for (const dt of dates) out[dt] = { ...entry };
  }
  return out;
}

function standByMapsEqual(a, b) {
  const ma = a && typeof a === "object" ? a : {};
  const mb = b && typeof b === "object" ? b : {};
  const keys = new Set([...Object.keys(ma), ...Object.keys(mb)]);
  for (const k of keys) {
    const pa = parseStandByDayEntry(ma[k]);
    const pb = parseStandByDayEntry(mb[k]);
    if (pa.technicians.join("\0") !== pb.technicians.join("\0")) return false;
    if (pa.management.join("\0") !== pb.management.join("\0")) return false;
  }
  return true;
}

/** Merge local stand-by into cloud when published; per-view fallback if local left a view empty. */
function mergeStandByByDatePreferLocal(cloudMap, localMap, draftDays) {
  const dates = (Array.isArray(draftDays) ? draftDays : []).map((d) => d.date).filter(Boolean);
  const out = {};
  for (const dt of dates) {
    const c = parseStandByDayEntry(cloudMap[dt]);
    const l = parseStandByDayEntry(localMap[dt]);
    const hasLocalKey = localMap && Object.prototype.hasOwnProperty.call(localMap, dt);
    if (!hasLocalKey) {
      if (standByDayEntryHasAny(c)) out[dt] = c;
      continue;
    }
    out[dt] = {
      technicians: l.technicians[0] || l.technicians[1] ? l.technicians : c.technicians,
      management: l.management[0] || l.management[1] ? l.management : c.management,
    };
  }
  return out;
}

/** Resolve staff record for stand-by display (handles id / staffId variants). Falls back to draft assignments, then global staff store — so names show even if this user’s `staffList` is partial or the stand-by person has no shift that week. */
function resolveStandByStaffMember(sid, staffList, draft) {
  const s = String(sid || "").trim();
  if (!s) return null;
  const list = Array.isArray(staffList) ? staffList : [];
  const byKey = getStaffByScheduleKey(list, s);
  if (byKey) return byKey;
  const fromList = list.find((st) => {
    const k = getScheduleStaffKey(st);
    return k === s || String(st?.id || "") === s || String(st?.staffId || "") === s;
  });
  if (fromList) return fromList;
  const days = Array.isArray(draft?.days) ? draft.days : [];
  for (const day of days) {
    const assignments = Array.isArray(day.assignments) ? day.assignments : [];
    for (const a of assignments) {
      const k = String(a.staffId || a.uid || "").trim();
      if (k === s) {
        return {
          name: String(a.name || "").trim() || "Staff",
          id: k,
        };
      }
    }
  }
  if (typeof window !== "undefined" && typeof window.ffGetStaffStore === "function") {
    try {
      const store = window.ffGetStaffStore();
      const all = Array.isArray(store?.staff) ? store.staff : [];
      const st =
        all.find((x) => {
          if (!x || x.isArchived === true) return false;
          const k = getScheduleStaffKey(x);
          return k === s || String(x?.id || "") === s || String(x?.staffId || "") === s;
        }) || null;
      if (st) return st;
    } catch (_) {
      /* ignore */
    }
  }
  return null;
}

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


// Wire schedule-cloud after storage constants initialize (avoid TDZ for const deps).
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


function computeStaffWeeklyScheduledMinutes(staffKey, draftDays, assignmentLookup) {
  let total = 0;
  for (const day of draftDays) {
    const a = assignmentLookup.get(`${staffKey}::${day.date}`);
    if (!a || !a.startTime || !a.endTime) continue;
    const sm = parseScheduleTimeToMinutes(String(a.startTime || "").trim());
    const em = parseScheduleTimeToMinutes(String(a.endTime || "").trim());
    if (sm == null || em == null) continue;
    let diff = em - sm;
    if (diff <= 0) diff += 24 * 60;
    total += diff;
  }
  return total;
}


// Wire DnD helpers (function declarations below are hoisted).
initScheduleDnd({
  renderScheduleBoard,
  renderScheduleSummary,
  renderScheduleViewTabs,
});


function getBusinessStatusForDate(dateKey) {
  const dayName = getDayNameFromDateKey(dateKey);
  const businessHours = window.ffScheduleHelpers?.normalizeBusinessHours
    ? window.ffScheduleHelpers.normalizeBusinessHours(window.settings?.businessHours)
    : (window.settings?.businessHours || {});
  const specialDays = window.ffScheduleHelpers?.normalizeSpecialBusinessDays
    ? window.ffScheduleHelpers.normalizeSpecialBusinessDays(window.settings?.specialBusinessDays)
    : (window.settings?.specialBusinessDays || {});

  const baseDay = businessHours[dayName] || { isOpen: false, openTime: null, closeTime: null };
  const shiftSegmentsBase =
    typeof window.ffScheduleHelpers?.getEffectiveShiftSegmentsForDay === "function"
      ? window.ffScheduleHelpers.getEffectiveShiftSegmentsForDay(
          dayName,
          businessHours,
          window.settings?.dayShiftSegments,
        )
      : [];
  const specialDay = specialDays[dateKey] || null;
  if (specialDay) {
    if (specialDay.isClosed === true) {
      return {
        isOpen: false,
        openTime: null,
        closeTime: null,
        source: "special_day_closed",
        note: specialDay.note || "",
        shiftSegments: [],
      };
    }
    const o = specialDay.openTime || baseDay.openTime || null;
    const c = specialDay.closeTime || baseDay.closeTime || null;
    const om = window.ffScheduleHelpers?.parseScheduleTimeToMinutes
      ? window.ffScheduleHelpers.parseScheduleTimeToMinutes(o)
      : null;
    const cm = window.ffScheduleHelpers?.parseScheduleTimeToMinutes
      ? window.ffScheduleHelpers.parseScheduleTimeToMinutes(c)
      : null;
    const oneSeg =
      om != null && cm != null && cm > om ? [{ startTime: o, endTime: c }] : [];
    return {
      isOpen: true,
      openTime: o,
      closeTime: c,
      source: "special_day_hours",
      note: specialDay.note || "",
      shiftSegments: oneSeg,
    };
  }

  return {
    isOpen: baseDay.isOpen === true,
    openTime: baseDay.openTime || null,
    closeTime: baseDay.closeTime || null,
    source: "business_hours",
    note: "",
    shiftSegments: Array.isArray(shiftSegmentsBase) ? shiftSegmentsBase : [],
  };
}

/** Default shift window for manual add / empty inputs — first shift segment when configured, else open/close. */
function getDefaultShiftTimesForDate(dateKey) {
  const bs = getBusinessStatusForDate(dateKey);
  if (!bs.isOpen) return { start: "09:00", end: "17:00" };
  const segs = Array.isArray(bs.shiftSegments) ? bs.shiftSegments : [];
  if (segs.length > 0) {
    const first = segs[0];
    let start = normalizeTimeValue(first?.startTime) || normalizeTimeValue(bs.openTime) || "09:00";
    let end = normalizeTimeValue(first?.endTime) || normalizeTimeValue(bs.closeTime) || "17:00";
    if (start && end && start < end) return { start, end };
  }
  let start = normalizeTimeValue(bs.openTime) || "09:00";
  let end = normalizeTimeValue(bs.closeTime) || "17:00";
  if (!start || !end || start >= end) {
    start = "09:00";
    end = "17:00";
  }
  return { start, end };
}

function applyBusinessSettingsToDraft(draft) {
  const nextDraft = {
    ...draft,
    days: (Array.isArray(draft?.days) ? draft.days : []).map((day) => {
      const businessStatus = getBusinessStatusForDate(day.date);
      let assignments = (Array.isArray(day.assignments) ? day.assignments : []).map((assignment) => ({ ...assignment }));

      if (!businessStatus.isOpen) {
        assignments = [];
      }

      return {
        ...day,
        assignments,
        businessStatus,
      };
    }),
  };

  return nextDraft;
}

function getScheduleRoleLabel(staff) {
  const role = getScheduleStaffRole(staff);
  if (role === "admin") return "Admin";
  if (role === "manager") return staff?.managerType === "assistant_manager" ? "Assistant Manager" : "Manager";
  if (role === "front_desk") return "Front Desk";
  return "Service Provider";
}


function rebuildScheduleTechTypeMap(types) {
  const map = {};
  (Array.isArray(types) ? types : []).forEach((t) => {
    if (t && typeof t === "object" && t.id != null) {
      const nm = String(t.name || "").trim();
      if (nm) map[String(t.id)] = nm;
    }
  });
  scheduleState.scheduleTechTypeNameById = map;
}

/**
 * Loads the salon's technician-types catalog once (id -> name) and keeps it
 * fresh via the shared `ff-technician-types-updated` event. Used so the staff
 * rows show readable type names instead of raw document ids.
 */
async function ensureScheduleTechTypeMap() {
  if (!scheduleState.scheduleTechTypesListenerBound && typeof document !== "undefined") {
    scheduleState.scheduleTechTypesListenerBound = true;
    document.addEventListener("ff-technician-types-updated", (e) => {
      rebuildScheduleTechTypeMap(e?.detail);
      scheduleState.scheduleTechTypesLoaded = true;
      if (scheduleState.schedulePreviewState?.draft) {
        try {
          renderScheduleBoard(
            scheduleState.schedulePreviewState.draft,
            scheduleState.schedulePreviewState.validation,
            scheduleState.schedulePreviewState.staffList,
          );
        } catch (_) { /* ignore */ }
      }
    });
  }
  if (scheduleState.scheduleTechTypesLoaded) return;
  try {
    if (typeof window !== "undefined" && typeof window.ffGetTechnicianTypes === "function") {
      const types = await window.ffGetTechnicianTypes({ all: true });
      rebuildScheduleTechTypeMap(types);
      scheduleState.scheduleTechTypesLoaded = true;
    }
  } catch (_) { /* ignore */ }
}

/**
 * Resolves a staff member's technicianTypes into a readable, comma-separated
 * label: custom-type ids -> their catalog name; built-in snake_case slugs ->
 * Title Case; unresolved raw ids are hidden (so no document id leaks to the UI).
 */
function formatScheduleTechnicianTypes(staff) {
  const list = Array.isArray(staff?.technicianTypes) ? staff.technicianTypes : [];
  if (!list.length) return null;
  const labels = list
    .map((t) => String(t == null ? "" : t).trim())
    .filter((key) => key && key !== "all_technicians")
    .map((key) => {
      if (scheduleState.scheduleTechTypeNameById[key]) return scheduleState.scheduleTechTypeNameById[key];
      // Built-in slug: snake_case / spaced / all-lowercase word(s) -> Title Case.
      if (/[_\s]/.test(key) || /^[a-z]+$/.test(key)) {
        return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      }
      // Unresolved raw document id (mixed case / digits) -> hide it.
      return null;
    })
    .filter(Boolean);
  return labels.length ? labels.join(", ") : null;
}

function renderScheduleViewTabs() {
  const modeWrap = document.getElementById("scheduleModeToggleWrap");
  const canEdit = scheduleUserCanManualEdit();
  if (modeWrap) {
    modeWrap.style.display = canEdit ? "inline-flex" : "none";
    modeWrap.classList.toggle("ff-schedule-tabs-visible", canEdit);
  }
  const myShiftsBtn = document.getElementById("scheduleViewMyShiftsBtn");
  const buildScheduleBtn = document.getElementById("scheduleViewBuildScheduleBtn");
  const applyModeState = (button, active, left) => {
    if (!button) return;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.style.setProperty("display", "inline-flex", "important");
    button.style.setProperty("align-items", "center", "important");
    button.style.setProperty("justify-content", "center", "important");
    button.style.setProperty("margin", "0", "important");
    button.style.setProperty("height", "34px", "important");
    button.style.setProperty("padding", "0 14px", "important");
    button.style.setProperty("box-sizing", "border-box", "important");
    button.style.setProperty("line-height", "1", "important");
    button.style.setProperty("font-size", "12px", "important");
    button.style.setProperty("font-weight", active ? "600" : "500", "important");
    button.style.setProperty("background", active ? "#7c3aed" : "#f9fafb", "important");
    button.style.setProperty("color", active ? "#fff" : "#6b7280", "important");
    button.style.setProperty("border-style", "solid", "important");
    button.style.setProperty("border-width", "1px", "important");
    button.style.setProperty("border-color", active ? "#7c3aed" : "#e5e7eb", "important");
    if (left) {
      button.style.setProperty("border-right-width", "0", "important");
      button.style.setProperty("border-radius", "8px 0 0 8px", "important");
    } else {
      button.style.setProperty("border-left-width", "0", "important");
      button.style.setProperty("border-radius", "0 8px 8px 0", "important");
    }
    button.style.setProperty("box-shadow", active ? "inset 0 0 0 1px #7c3aed" : "none", "important");
    button.style.setProperty("z-index", active ? "1" : "0", "important");
    button.style.setProperty("cursor", "pointer", "important");
  };
  applyModeState(myShiftsBtn, scheduleState.schedulePreviewMode === "my_shifts", true);
  applyModeState(buildScheduleBtn, scheduleState.schedulePreviewMode === "build", false);

  const toggleWrap = document.getElementById("scheduleViewToggleWrap");
  if (toggleWrap) {
    const ctx = getScheduleAccessContext();
    const showTeamTabs = canEdit && scheduleState.schedulePreviewMode === "build" && !ctx.viewOwnOnly;
    toggleWrap.style.display = showTeamTabs ? "inline-flex" : "none";
    toggleWrap.classList.toggle("ff-schedule-tabs-visible", showTeamTabs);
  }
  const managementBtn = document.getElementById("scheduleViewManagementBtn");
  const techniciansBtn = document.getElementById("scheduleViewTechniciansBtn");
  const applyState = (button, active, left) => {
    if (!button) return;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.style.setProperty("display", "inline-flex", "important");
    button.style.setProperty("align-items", "center", "important");
    button.style.setProperty("justify-content", "center", "important");
    button.style.setProperty("margin", "0", "important");
    button.style.setProperty("height", "34px", "important");
    button.style.setProperty("padding", "0 16px", "important");
    button.style.setProperty("box-sizing", "border-box", "important");
    button.style.setProperty("line-height", "1", "important");
    button.style.setProperty("background", active ? "#7c3aed" : "#f9fafb", "important");
    button.style.setProperty("color", active ? "#fff" : "#6b7280", "important");
    button.style.setProperty("border-style", "solid", "important");
    button.style.setProperty("border-width", "1px", "important");
    button.style.setProperty("border-color", active ? "#7c3aed" : "#e5e7eb", "important");
    if (left) {
      button.style.setProperty("border-right-width", "0", "important");
      button.style.setProperty("border-radius", "8px 0 0 8px", "important");
    } else {
      button.style.setProperty("border-left-width", "0", "important");
      button.style.setProperty("border-radius", "0 8px 8px 0", "important");
    }
    button.style.setProperty("font-weight", active ? "600" : "500", "important");
    button.style.setProperty("box-shadow", active ? "inset 0 0 0 1px #7c3aed" : "none", "important");
    button.style.setProperty("z-index", active ? "1" : "0", "important");
  };
  applyState(managementBtn, scheduleState.schedulePreviewView === "management", true);
  applyState(techniciansBtn, scheduleState.schedulePreviewView === "technicians", false);
}

/**
 * A staff row is visible in the active branch's schedule when:
 *   • no active location is resolved (single-branch salon or bootstrap), OR
 *   • the staff is the Owner (business owner is always present), OR
 *   • `allowedLocationIds` is explicitly set and contains the active location, OR
 *   • `allowedLocationIds` is empty/missing but `primaryLocationId` matches, OR
 *   • neither field is set (legacy row) — we treat that as "no assignment
 *     chosen yet" and keep them visible to avoid silently losing legacy data.
 *
 * Admins and managers who DID pick specific locations via the Locations tab
 * are filtered — the user's expectation is that Magi (Manager, toggled only
 * at Key Biscayne) must NOT appear in Brickell's grid.
 */
function _ffSchedStaffInActiveLocation(staff) {
  const activeLoc = _ffSchedActiveLocId();
  if (!activeLoc) return true;
  if (!staff) return false;
  const role = String(staff.role || "").toLowerCase().trim();
  const isOwner = role === "owner" || staff.isOwner === true;
  if (isOwner) return true;
  const allowed = Array.isArray(staff.allowedLocationIds) ? staff.allowedLocationIds : [];
  if (allowed.length > 0) {
    return allowed.indexOf(activeLoc) !== -1;
  }
  const primary = typeof staff.primaryLocationId === "string" ? staff.primaryLocationId.trim() : "";
  if (primary) return primary === activeLoc;
  // Legacy row with no assignment info: default to visible so pre-existing
  // staff don't disappear. Users can fix this by opening the Locations tab.
  return true;
}

/**
 * When a staff row has a per-location availability override
 * (`locationScheduleAvailability[activeLoc].defaultSchedule`), swap in that
 * map as the effective `defaultSchedule`. The generator + validator read
 * `defaultSchedule` directly, so this single substitution propagates the
 * per-branch hours everywhere (auto-build, availability, coverage checks).
 * Rows without an override keep their top-level `defaultSchedule` — works
 * identically to the previous behaviour for single-branch salons.
 */
function _ffSchedApplyPerLocationSchedule(staff) {
  const activeLoc = _ffSchedActiveLocId();
  if (!activeLoc || !staff || typeof staff !== "object") return staff;
  const helper = window.ffScheduleHelpers && window.ffScheduleHelpers.getStaffDefaultScheduleForLocation;
  if (typeof helper !== "function") return staff;
  try {
    const perLoc = helper(staff, activeLoc);
    if (!perLoc) return staff;
    // Diagnostic: log which branch schedule we're applying. Helps verify
    // that per-location overrides are picked up by Build Schedule.
    try {
      const allowed = Array.isArray(staff.allowedLocationIds) ? staff.allowedLocationIds.length : 0;
      if (allowed > 1) {
        const active = Object.keys(perLoc).filter((d) => perLoc[d] && perLoc[d].enabled);
        console.log(`[ScheduleUI] per-loc schedule for ${staff.name || staff.id} @ ${activeLoc}: ${active.length ? active.join(",") : "all days OFF"}`);
      }
    } catch (_) { /* ignore */ }
    return { ...staff, defaultSchedule: perLoc };
  } catch (_) {
    return staff;
  }
}

async function loadScheduleStaffList() {
  if (typeof window.ffStaffForceLoad === "function") {
    try { await window.ffStaffForceLoad(); } catch (_) {}
  }
  const store = typeof window.ffGetStaffStore === "function" ? window.ffGetStaffStore() : { staff: [] };
  return (Array.isArray(store?.staff) ? store.staff : [])
    .filter((staff) => staff && staff.isArchived !== true)
    .filter(_ffSchedStaffInActiveLocation)
    .map(_ffSchedApplyPerLocationSchedule);
}

/** Scan ALL staff (including those not filtered to the active location)
 *  for same-day cross-location overlaps and render a warning banner above
 *  the schedule grid. Only relevant for multi-location staff.
 */
function renderScheduleCrossLocationConflictBanner() {
  const banner = document.getElementById("scheduleCrossLocConflictBanner");
  if (!banner) return;
  try {
    const store = typeof window.ffGetStaffStore === "function" ? window.ffGetStaffStore() : { staff: [] };
    const allStaff = Array.isArray(store?.staff) ? store.staff : [];
    const detect = window.ffScheduleHelpers && window.ffScheduleHelpers.detectStaffLocationScheduleConflicts;
    if (typeof detect !== "function") { banner.style.display = "none"; return; }
    const locations = (typeof window !== "undefined" && typeof window.ffGetActiveLocations === "function")
      ? (window.ffGetActiveLocations() || [])
      : [];
    const locNameById = new Map();
    locations.forEach((loc) => {
      if (loc && loc.id) locNameById.set(String(loc.id), String(loc.name || loc.id));
    });
    const labelLoc = (id) => locNameById.get(String(id)) || String(id);
    const dayLabels = {
      monday: "Mon", tuesday: "Tue", wednesday: "Wed",
      thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun",
    };
    const rows = [];
    allStaff.forEach((staff) => {
      if (!staff || staff.isArchived === true) return;
      const conflicts = detect(staff) || [];
      if (!conflicts.length) return;
      const name = String(staff.name || staff.fullName || "Staff");
      conflicts.forEach((c) => {
        const overlap = formatScheduleRawRangeDisplay(c.overlap);
        rows.push(`<li style="margin:3px 0;">
          <strong>${name}</strong> — ${dayLabels[c.dayKey] || c.dayKey} overlap
          between <em>${labelLoc(c.locationAId)}</em> and <em>${labelLoc(c.locationBId)}</em>
          (${overlap || c.overlap})
        </li>`);
      });
    });
    if (!rows.length) { banner.style.display = "none"; banner.innerHTML = ""; return; }
    banner.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <div style="flex:0 0 auto;font-size:18px;line-height:1;">⚠️</div>
        <div style="flex:1 1 auto;">
          <div style="font-weight:700;margin-bottom:4px;">Cross-location scheduling conflicts</div>
          <div style="color:#92400e;font-size:12px;margin-bottom:6px;">
            The following staff are scheduled at two locations on the same day with overlapping hours.
            Review each staff member's Schedule tab to resolve.
          </div>
          <ul style="margin:0;padding-left:18px;color:#78350f;font-size:12px;">${rows.join("")}</ul>
        </div>
      </div>`;
    banner.style.display = "block";
  } catch (err) {
    console.warn("[ScheduleUI] cross-loc banner failed", err);
    banner.style.display = "none";
  }
}

/** Inbox types that feed effective availability (approved only; see schedule-availability.js). */
const SCHEDULE_INBOX_TYPES_FOR_AVAILABILITY = new Set([
  "vacation",
  "late_start",
  "early_leave",
  "schedule_change",
  "day_off",
  "time_off",
]);

function scheduleInboxUserIsFirestoreManager() {
  const r = String(
    typeof window !== "undefined" && window.__ff_user_role ? window.__ff_user_role : "",
  ).toLowerCase();
  return r === "owner" || r === "admin" || r === "manager";
}

async function loadApprovedScheduleRequests() {
  const salonId = String(window.currentSalonId || "").trim();
  if (!salonId) return [];
  const activeLocId = _ffSchedActiveLocId();
  const mapDoc = (docSnap) => ({ id: docSnap.id, ...docSnap.data() });
  const keepScheduleType = (item) =>
    SCHEDULE_INBOX_TYPES_FOR_AVAILABILITY.has(String(item?.type || "").trim());
  // When a location is active, only keep requests that either belong to that
  // branch (`locationId` stamped) or legacy items with no `locationId` (so
  // they still appear for the default branch and don't disappear silently).
  const keepLocation = (item) => {
    if (!activeLocId) return true;
    const raw = item && typeof item.locationId === "string" ? item.locationId.trim() : "";
    // Legacy (unstamped) items fall through to "default" — visible in the
    // first branch only so they don't leak sideways. When multiple locations
    // exist we treat missing locationId as default.
    const effective = raw || "default";
    return effective === activeLocId;
  };
  const filterPipeline = (docs) =>
    docs.map(mapDoc).filter(keepScheduleType).filter(keepLocation).filter(isApprovedRequest);

  const inboxRef = collection(db, `salons/${salonId}/inboxItems`);
  const statusApproved = ["approved", "done", "archived"];

  try {
    if (scheduleInboxUserIsFirestoreManager()) {
      const snap = await getDocs(query(inboxRef, where("status", "in", statusApproved)));
      return filterPipeline(snap.docs);
    }

    const uid = auth?.currentUser?.uid ? String(auth.currentUser.uid).trim() : "";
    if (!uid) return [];

    /**
     * Firestore rules let technicians read only inbox docs they created or are the recipient of.
     * A salon-wide query is rejected ("Missing or insufficient permissions"). Load by uid and merge.
     */
    const [snapFor, snapBy] = await Promise.all([
      getDocs(query(inboxRef, where("forUid", "==", uid))),
      getDocs(query(inboxRef, where("createdByUid", "==", uid))),
    ]);
    const byId = new Map();
    for (const d of snapFor.docs) byId.set(d.id, d);
    for (const d of snapBy.docs) byId.set(d.id, d);
    const merged = [...byId.values()].filter((d) => {
      const st = String(d.data()?.status || "").trim();
      return statusApproved.includes(st);
    });
    return filterPipeline(merged);
  } catch (error) {
    console.warn("[ScheduleUI] Failed to load approved inbox for schedule; continuing without it", error);
    return [];
  }
}

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
  refreshSchedulePreview,
  hideScheduleScreen,
};
