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
function _ffIcsFormatLocalDateTime(dateKey, timeHHmm) {
  const d = String(dateKey || "").replace(/-/g, "");
  const t = String(timeHHmm || "").replace(/:/g, "");
  if (!/^\d{8}$/.test(d) || !/^\d{4}$/.test(t)) return null;
  return `${d}T${t}00`;
}

function _ffCalendarTimezone() {
  try {
    const prefs = (typeof window !== "undefined" && window.settings && window.settings.preferences) || {};
    const tz = typeof prefs.salonTimeZone === "string" ? prefs.salonTimeZone.trim() : "";
    return tz || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch (_) {
    return "America/New_York";
  }
}

/** iCalendar strings: CR-LF line endings and backslash-escape for TEXT values. */
function _ffIcsEscape(str) {
  return String(str || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** Current salon name (best-effort) — used in SUMMARY/DESCRIPTION. */
function _ffCurrentSalonNameForIcs() {
  try {
    const s = (typeof window !== "undefined" && window.settings) || {};
    const candidates = [s.salonName, s.businessName, s.name];
    for (const c of candidates) {
      const v = typeof c === "string" ? c.trim() : "";
      if (v) return v;
    }
  } catch (_) {}
  return "Salon";
}

/** Active-location display name (best-effort) — used in SUMMARY / LOCATION. */
function _ffActiveLocationNameForIcs() {
  try {
    const id = _ffSchedActiveLocId();
    if (!id) return "";
    const locs = (typeof window !== "undefined" && typeof window.ffGetActiveLocations === "function")
      ? (window.ffGetActiveLocations() || [])
      : [];
    const match = locs.find((l) => l && l.id === id);
    const name = match && (match.name || "");
    return typeof name === "string" ? name.trim() : "";
  } catch (_) {}
  return "";
}

/**
 * Build an iCalendar (.ics) string with a VEVENT per shift for the currently
 * authed staff in the currently-previewed week. "Floating" local time is
 * used so the event displays at the scheduled clock time regardless of the
 * device's timezone — matching how the schedule is shown on-screen.
 */
function buildMyShiftsIcsForCurrentWeek() {
  const draft = scheduleState.schedulePreviewState?.draft;
  const days = Array.isArray(draft?.days) ? draft.days : [];
  const mySid = String(getAuthedStaffIdForSchedule() || "").trim();
  if (!mySid) return { ics: "", eventCount: 0 };

  const salonName = _ffCurrentSalonNameForIcs();
  const activeLocationName = _ffActiveLocationNameForIcs();
  const otherMap = (scheduleState.schedulePreviewState?.myShiftsFromOtherLocs instanceof Map)
    ? scheduleState.schedulePreviewState.myShiftsFromOtherLocs
    : new Map();
  const nowStamp = (() => {
    const d = new Date();
    const yy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mi = String(d.getUTCMinutes()).padStart(2, "0");
    const ss = String(d.getUTCSeconds()).padStart(2, "0");
    return `${yy}${mm}${dd}T${hh}${mi}${ss}Z`;
  })();

  const events = [];
  const calendarLinks = [];
  const calendarTimezone = _ffCalendarTimezone();
  const pushEvent = ({ dateKey, startTime, endTime, locationName, uidSuffix }) => {
    const dtStart = _ffIcsFormatLocalDateTime(dateKey, startTime);
    const dtEnd = _ffIcsFormatLocalDateTime(dateKey, endTime);
    if (!dtStart || !dtEnd || dtEnd <= dtStart) return;
    const summary = locationName
      ? `Work shift — ${salonName} (${locationName})`
      : `Work shift — ${salonName}`;
    const desc = `Your scheduled shift at ${salonName}${locationName ? ` — ${locationName}` : ""}.`;
    const uid = `shift-${dateKey}-${mySid}-${String(startTime || "").replace(/:/g, "")}-${uidSuffix}@fairflow`;
    const lines = [
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${nowStamp}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${_ffIcsEscape(summary)}`,
      `DESCRIPTION:${_ffIcsEscape(desc)}`,
    ];
    if (locationName) lines.push(`LOCATION:${_ffIcsEscape(locationName)}`);
    lines.push("END:VEVENT");
    events.push(lines.join("\r\n"));
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: summary,
      dates: `${dtStart}/${dtEnd}`,
      details: desc,
      ctz: calendarTimezone,
    });
    if (locationName) params.set("location", locationName);
    calendarLinks.push({
      url: `https://calendar.google.com/calendar/render?${params.toString()}`,
      label: `${dateKey} ${formatScheduleTimeRangeDisplay(startTime, endTime, { separator: "-" })}`,
    });
  };

  // Active location (the currently-rendered draft).
  days.forEach((day) => {
    if (!day || !day.date) return;
    const bs = day.businessStatus || { isOpen: true };
    if (bs.isOpen === false) return;
    const assignments = Array.isArray(day.assignments) ? day.assignments : [];
    assignments.forEach((a, idx) => {
      if (!a) return;
      const sameStaff =
        (a.staffId && String(a.staffId) === mySid) ||
        (a.uid && String(a.uid) === mySid);
      if (!sameStaff) return;
      pushEvent({
        dateKey: day.date,
        startTime: a.startTime,
        endTime: a.endTime,
        locationName: activeLocationName,
        uidSuffix: `active-${idx}`,
      });
    });
  });

  // Other locations (unified view — included even if the user hasn't
  // switched the active location to that branch).
  otherMap.forEach((shifts, dateKey) => {
    if (!Array.isArray(shifts)) return;
    shifts.forEach((s, idx) => {
      pushEvent({
        dateKey,
        startTime: s.startTime,
        endTime: s.endTime,
        locationName: s.locationName || "",
        uidSuffix: `${s.locationId || "loc"}-${idx}`,
      });
    });
  });

  if (events.length === 0) return { ics: "", eventCount: 0 };

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FairFlow//Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  return { ics, eventCount: events.length, calendarLinks };
}

function isLikelyMobileCalendarDevice() {
  try {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "")
      || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent || ""));
  } catch (_) {
    return false;
  }
}

function isLikelyAndroidCalendarDevice() {
  try {
    return /Android/i.test(navigator.userAgent || "");
  } catch (_) {
    return false;
  }
}

function ffOpenCalendarUrl(url) {
  if (!url) return;
  try {
    const opened = window.open(url, "_blank", "noopener");
    if (!opened) window.location.href = url;
  } catch (_) {
    window.location.href = url;
  }
}

function ffDownloadCalendarFile(downloadFile) {
  if (!downloadFile || !downloadFile.blobUrl || !downloadFile.filename) return;
  const a = document.createElement("a");
  a.href = downloadFile.blobUrl;
  a.download = downloadFile.filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { try { document.body.removeChild(a); } catch (_) {} }, 200);
}

async function ffShareOrDownloadAllShifts(downloadFile) {
  if (!downloadFile) return;
  try {
    const file = downloadFile.file;
    const canShareFile =
      file
      && typeof navigator !== "undefined"
      && typeof navigator.share === "function"
      && typeof navigator.canShare === "function"
      && navigator.canShare({ files: [file] });
    if (canShareFile) {
      await navigator.share({
        title: "Fair Flow schedule",
        text: "Fair Flow shifts",
        files: [file],
      });
      ffScheduleAppToast("Choose Calendar to import all shifts.", 3500);
      return;
    }
  } catch (e) {
    if (e && (e.name === "AbortError" || e.name === "NotAllowedError")) return;
    console.warn("[ScheduleUI] All-shifts calendar share failed; using download fallback", e);
  }
  ffDownloadCalendarFile(downloadFile);
  ffScheduleAppToast("Calendar file downloaded. Open it to import all shifts.", 4500);
}

function ffShowMobileCalendarChoice(calendarLinks, downloadFile) {
  const links = Array.isArray(calendarLinks) ? calendarLinks.filter((x) => x && x.url) : [];
  if (!links.length) return false;
  const existing = document.getElementById("ffMobileCalendarChoiceModal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "ffMobileCalendarChoiceModal";
  overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.42);display:flex;align-items:flex-end;justify-content:center;padding:14px 14px 92px;";

  const panel = document.createElement("div");
  panel.style.cssText = "width:100%;max-width:420px;background:#fff;border-radius:18px;box-shadow:0 24px 60px rgba(15,23,42,.24);padding:14px;max-height:68vh;overflow:auto;";

  const title = document.createElement("div");
  title.textContent = "Add shifts to calendar";
  title.style.cssText = "font-size:16px;font-weight:800;color:#111827;margin-bottom:5px;";
  panel.appendChild(title);

  const note = document.createElement("div");
  note.textContent = "Add all shifts together, or open each shift separately in Google Calendar and tap Save.";
  note.style.cssText = "font-size:12px;color:#6b7280;line-height:1.35;margin-bottom:10px;";
  panel.appendChild(note);

  if (downloadFile && downloadFile.blobUrl && downloadFile.filename) {
    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.textContent = `Add all ${links.length} shifts together`;
    allBtn.style.cssText = "width:100%;display:flex;justify-content:center;align-items:center;margin:8px 0 12px;padding:12px 14px;border:0;border-radius:14px;background:#111827;color:#fff;font-size:14px;font-weight:850;";
    allBtn.addEventListener("click", async () => {
      await ffShareOrDownloadAllShifts(downloadFile);
    });
    panel.appendChild(allBtn);

    const separator = document.createElement("div");
    separator.textContent = "Or add one shift at a time";
    separator.style.cssText = "font-size:11px;font-weight:800;color:#6b7280;text-align:center;margin:2px 0 8px;text-transform:uppercase;letter-spacing:.04em;";
    panel.appendChild(separator);
  }

  links.forEach((link, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `Open shift ${idx + 1}: ${link.label || "shift"}`;
    btn.style.cssText = "width:100%;display:flex;justify-content:center;align-items:center;margin:7px 0;padding:10px 12px;border:1px solid #c4b5fd;border-radius:12px;background:#ede9fe;color:#5b21b6;font-size:12px;font-weight:800;";
    btn.addEventListener("click", () => ffOpenCalendarUrl(link.url));
    panel.appendChild(btn);
  });

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "Close";
  closeBtn.style.cssText = "width:100%;margin-top:10px;padding:9px 14px;border:0;border-radius:12px;background:#f3f4f6;color:#374151;font-size:12px;font-weight:700;";
  closeBtn.addEventListener("click", () => overlay.remove());
  panel.appendChild(closeBtn);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  return true;
}

/**
 * Shares or downloads the current week's shifts as a .ics file. Mobile devices
 * prefer the native share sheet so the user can choose Calendar explicitly.
 */
async function downloadMyShiftsIcsForCurrentWeek() {
  const { ics, eventCount, calendarLinks } = buildMyShiftsIcsForCurrentWeek();
  if (!ics || eventCount === 0) {
    ffScheduleAppToast("No shifts found for you this week.", 4000);
    return;
  }
  const weekStart = scheduleState.schedulePreviewState?.weekRange?.startDate || "week";
  const filename = `my-shifts-${weekStart}.ics`;
  try {
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const mobileDownloadUrl = URL.createObjectURL(blob);
    const file = new File([blob], filename, { type: "text/calendar" });
    const downloadFile = { blobUrl: mobileDownloadUrl, filename, file };
    if (isLikelyAndroidCalendarDevice() && ffShowMobileCalendarChoice(calendarLinks, downloadFile)) {
      return;
    }
    const canShareCalendarFile =
      typeof navigator !== "undefined"
      && typeof navigator.share === "function"
      && typeof navigator.canShare === "function"
      && navigator.canShare({ files: [file] });
    if (isLikelyMobileCalendarDevice() && canShareCalendarFile) {
      await navigator.share({
        title: "Fair Flow schedule",
        text: `Fair Flow schedule - ${weekStart}`,
        files: [file],
      });
      ffScheduleAppToast("Choose Calendar to import your shifts.", 3500);
      return;
    }
    if (isLikelyMobileCalendarDevice() && ffShowMobileCalendarChoice(calendarLinks, downloadFile)) return;
    const url = mobileDownloadUrl;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch (_) {}
      try { URL.revokeObjectURL(url); } catch (_) {}
    }, 200);
    ffScheduleAppToast(`Calendar file downloaded with ${eventCount} shift${eventCount === 1 ? "" : "s"}. Open it to import.`, 4500);
  } catch (e) {
    if (e && (e.name === "AbortError" || e.name === "NotAllowedError")) {
      ffScheduleAppToast("Calendar import was cancelled.", 3500);
      return;
    }
    console.warn("[ScheduleUI] ICS share/download failed", e);
    ffScheduleAppToast("Could not generate the calendar file.", 4000);
  }
}

if (typeof window !== "undefined") {
  window.ffDownloadMyShiftsIcs = downloadMyShiftsIcsForCurrentWeek;
}

// --- Stage 5 background wiring: weekly hours debug log for the authed user ---
// Purely informational. Reads the same shifts that feed the Add-to-calendar
// flow (active draft + myShiftsFromOtherLocs), converts them to the shape the
// Time Clock engine expects, and console.logs the {total, regular, overtime}
// breakdown. NO UI and NO Firestore writes. De-duplicated by week + shift
// fingerprint so the console is not spammed on every render.

function _ffAdaptAssignmentToShift(dateKey, startTime, endTime) {
  if (!dateKey || typeof dateKey !== "string") return null;
  if (!startTime || !endTime) return null;
  const st = String(startTime).trim();
  const et = String(endTime).trim();
  // Build local datetime strings (no timezone suffix → parsed as local).
  const start = `${dateKey}T${st.length === 4 ? "0" + st : st}:00`;
  const end = `${dateKey}T${et.length === 4 ? "0" + et : et}:00`;
  return { start, end, _raw: { dateKey, startTime: st, endTime: et } };
}

function _ffCollectAuthedUserWeeklyShifts() {
  const mySid = String(getAuthedStaffIdForSchedule() || "").trim();
  if (!mySid) return { shifts: [], skipped: [], staffId: null };

  const draft = scheduleState.schedulePreviewState?.draft || {};
  const days = Array.isArray(draft.days) ? draft.days : [];
  const otherMap = (scheduleState.schedulePreviewState?.myShiftsFromOtherLocs instanceof Map)
    ? scheduleState.schedulePreviewState.myShiftsFromOtherLocs
    : new Map();

  const shifts = [];
  const skipped = [];

  // Active-location draft.
  days.forEach((day) => {
    if (!day || !day.date) return;
    const bs = day.businessStatus || { isOpen: true };
    if (bs.isOpen === false) return;
    const assignments = Array.isArray(day.assignments) ? day.assignments : [];
    assignments.forEach((a) => {
      if (!a) return;
      const sameStaff =
        (a.staffId && String(a.staffId) === mySid) ||
        (a.uid && String(a.uid) === mySid);
      if (!sameStaff) return;
      const shift = _ffAdaptAssignmentToShift(day.date, a.startTime, a.endTime);
      if (shift) shifts.push(shift);
      else skipped.push({
        source: "active",
        dateKey: day.date,
        startTime: a.startTime ?? null,
        endTime: a.endTime ?? null,
        reason: "missing or invalid start/end",
      });
    });
  });

  // Other locations (unified My-shifts cross-loc view).
  otherMap.forEach((arr, dateKey) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((s) => {
      if (!s) return;
      const shift = _ffAdaptAssignmentToShift(dateKey, s.startTime, s.endTime);
      if (shift) shifts.push(shift);
      else skipped.push({
        source: "other",
        locationName: s.locationName || null,
        dateKey,
        startTime: s.startTime ?? null,
        endTime: s.endTime ?? null,
        reason: "missing or invalid start/end",
      });
    });
  });

  return { shifts, skipped, staffId: mySid };
}

function _ffResolveAuthedStaffNameForDebug(mySid) {
  try {
    const list = Array.isArray(scheduleState.schedulePreviewState?.staffList) ? scheduleState.schedulePreviewState.staffList : [];
    const st = list.find((x) => getScheduleStaffKey(x) === mySid) || null;
    if (!st) return null;
    return (
      st.name ||
      st.displayName ||
      [st.firstName, st.lastName].filter(Boolean).join(" ").trim() ||
      null
    );
  } catch (_e) {
    return null;
  }
}

function _ffDebugLogAuthedUserWeeklyHours() {
  try {
    if (typeof window === "undefined") return;
    if (typeof window.ffComputeWeeklyShiftHoursSummary !== "function") return;
    const { shifts, skipped, staffId } = _ffCollectAuthedUserWeeklyShifts();
    if (!staffId) return;

    const weekRange = scheduleState.schedulePreviewState?.weekRange || {};
    const weekKey = weekRange.startDate || "week?";
    const shiftKey = shifts
      .map((s) => `${s._raw?.dateKey}|${s._raw?.startTime}|${s._raw?.endTime}`)
      .sort()
      .join(",");
    const key = `${weekKey}|${staffId}|${shifts.length}:${shiftKey}|${skipped.length}`;
    if (key === scheduleState._ffLastHoursDebugKey) return;
    scheduleState._ffLastHoursDebugKey = key;

    const loadSettings = typeof window.ffLoadTimeClockSettings === "function"
      ? window.ffLoadTimeClockSettings()
      : Promise.resolve(null);

    Promise.resolve(loadSettings)
      .then((settings) => {
        const summary = window.ffComputeWeeklyShiftHoursSummary(shifts, settings);
        const staffName = _ffResolveAuthedStaffNameForDebug(staffId);
        console.groupCollapsed(
          `%c[TimeClockEngine] Weekly hours · ${staffName || staffId} · ${weekKey}`,
          "color:#5b21b6;font-weight:600;"
        );
        console.log("staffId:          ", staffId);
        if (staffName) console.log("name:             ", staffName);
        console.log("weekStart:        ", weekKey);
        console.log("totalWorkedHours: ", summary.totalWorkedHours);
        console.log("regularHours:     ", summary.regularHours);
        console.log("overtimeHours:    ", summary.overtimeHours);
        console.log("shifts counted:   ", shifts.length);
        console.log("shifts skipped:   ", skipped.length);
        if (skipped.length) console.log("skipped details: ", skipped);
        console.log("settings used:    ", settings);
        console.groupEnd();
      })
      .catch((e) => {
        console.warn("[TimeClockEngine] debug log failed", e);
      });
  } catch (e) {
    console.warn("[TimeClockEngine] debug log failed", e);
  }
}

function renderScheduleSummary(validation, days) {
  const summaryBar = document.getElementById("scheduleSummaryBar");
  if (!summaryBar) return;

  _ffDebugLogAuthedUserWeeklyHours();

  // Show the "Add to calendar" button whenever the authed user is looking at
  // their own shifts — either an editor in "my_shifts" mode or a read-only
  // staff member (viewOwnOnly). Hide it for managers looking at the full team.
  const ctx = getScheduleAccessContext();
  const editorMyShifts = scheduleUserCanManualEdit() && scheduleState.schedulePreviewMode === "my_shifts";
  const readOnlyOwnOnly = !scheduleUserCanManualEdit() && ctx && ctx.viewOwnOnly === true;
  const showAddToCalendar = !!getAuthedStaffIdForSchedule() && (editorMyShifts || readOnlyOwnOnly);

  if (showAddToCalendar) {
    const { eventCount } = buildMyShiftsIcsForCurrentWeek();
    const label = eventCount > 0
      ? `Add ${eventCount} shift${eventCount === 1 ? "" : "s"} to calendar`
      : `Add to calendar`;
    const disabled = eventCount === 0;
    const isMulti = isAuthedUserMultiLocationForWeek();
    const multiSuffix = isMulti
      ? ` <span style="font-size:11px;color:#1d4ed8;font-weight:600;">· All branches combined</span>`
      : "";
    const leftNote = editorMyShifts
      ? `<span style="font-size:12px;color:#6b7280;">Your shifts only — switch to <strong>Team view</strong> to edit the full team.${multiSuffix}</span>`
      : `<span style="font-size:12px;color:#6b7280;">Your shifts for this week.${multiSuffix}</span>`;
    summaryBar.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        ${leftNote}
        <button type="button" id="scheduleAddToCalendarBtn" title="Download a .ics file and open it in Google Calendar, Apple Calendar or Outlook"
          ${disabled ? "disabled" : ""}
          style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:10px;border:1px solid ${disabled ? "#e5e7eb" : "#c4b5fd"};background:${disabled ? "#f3f4f6" : "#ede9fe"};color:${disabled ? "#9ca3af" : "#5b21b6"};font-size:12px;font-weight:600;cursor:${disabled ? "not-allowed" : "pointer"};white-space:nowrap;">
          <span aria-hidden="true" style="font-size:14px;line-height:1;">\uD83D\uDCC5</span>
          <span>${escapeScheduleHtml(label)}</span>
        </button>
      </div>
    `;
    const btn = document.getElementById("scheduleAddToCalendarBtn");
    if (btn && !disabled) {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        await downloadMyShiftsIcsForCurrentWeek();
      });
    }
    return;
  }
  summaryBar.innerHTML = "";
}

function setSchedulePreviewMode(mode) {
  scheduleState.schedulePreviewMode = mode === "my_shifts" ? "my_shifts" : "build";
  renderScheduleViewTabs();
  updateSchedulePublishToggleUi();
  const weekRange = scheduleState.schedulePreviewState.weekRange || getWeekRange(scheduleState.schedulePreviewWeekStart);
  if (scheduleState.schedulePublishedMap[weekRange.startDate] === true) {
    teardownScheduleChangePingListener();
    ensureScheduleChangePingListener(weekRange.startDate);
  }
  updateScheduleWeekAckStrip();
  if (!canViewScheduleBoardForCurrentWeek()) {
    renderScheduleUnpublishedPlaceholder(weekRange);
    return;
  }
  renderScheduleBoard(scheduleState.schedulePreviewState.draft, scheduleState.schedulePreviewState.validation, scheduleState.schedulePreviewState.staffList);
  renderScheduleSummary(scheduleState.schedulePreviewState.validation, scheduleState.schedulePreviewState.validation?.days || []);
}

function setSchedulePreviewView(view) {
  scheduleState.schedulePreviewView = view === "technicians" ? "technicians" : "management";
  renderScheduleViewTabs();
  if (!canViewScheduleBoardForCurrentWeek()) {
    const wr = scheduleState.schedulePreviewState.weekRange || getWeekRange(scheduleState.schedulePreviewWeekStart);
    renderScheduleUnpublishedPlaceholder(wr);
    return;
  }
  renderScheduleBoard(scheduleState.schedulePreviewState.draft, scheduleState.schedulePreviewState.validation, scheduleState.schedulePreviewState.staffList);
}

function renderStandBySlotNamesHtml(slotIds, staffList, draftForNames, standbyTextStyle) {
  const lines = [];
  for (let i = 0; i < STAND_BY_SLOTS; i++) {
    const sid = String(slotIds[i] || "").trim();
    if (!sid) continue;
    const member = resolveStandByStaffMember(sid, staffList, draftForNames);
    const nameShort = member
      ? `<span style="${standbyTextStyle}">${escapeScheduleHtml(String(member.name || "Staff"))}</span>`
      : `<span style="font-size:12px;font-weight:400;color:#b45309;">Former staff</span>`;
    lines.push(nameShort);
  }
  if (lines.length === 0) return `<span style="font-size:12px;font-weight:400;color:#9ca3af;">Not set</span>`;
  return `<div style="display:flex;flex-direction:column;gap:3px;align-items:center;width:100%;">${lines.join("")}</div>`;
}

function renderScheduleStandByRowHtml({
  draftDays,
  gridTemplate,
  standByByDate,
  staffListForNames,
  draftForNames,
  canPickStandBy,
  standByView,
}) {
  const map = standByByDate && typeof standByByDate === "object" ? standByByDate : {};
  const viewKey = standByView === "technicians" ? "technicians" : "management";
  /** Same visual weight as “Off” cells in staff rows */
  const standbyTextStyle = "font-size:12px;font-weight:400;color:#6b7280;line-height:1.35;word-break:break-word;";

  const cells = (Array.isArray(draftDays) ? draftDays : []).map((day) => {
    const dateKey = day.date;
    const bs = day.businessStatus || getBusinessStatusForDate(dateKey);
    const open = bs.isOpen !== false;
    const entry = parseStandByDayEntry(map[dateKey]);
    const slotIds = entry[viewKey] || ["", ""];
    if (!open) {
      return `
      <div data-schedule-standby-cell="true" style="position:relative;padding:4px;border-radius:8px;min-height:40px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:11px;font-weight:400;color:#cbd5e1;background:#f3f4f6;border:1px dashed #e5e7eb;">
        Closed
      </div>`;
    }
    const nameShort = renderStandBySlotNamesHtml(slotIds, staffListForNames, draftForNames, standbyTextStyle);

    if (canPickStandBy) {
      return `
      <div data-schedule-standby-cell="true" style="position:relative;padding:6px 24px 6px 6px;border-radius:8px;min-height:42px;background:#f3f4f6;border:1px solid #e5e7eb;display:flex;align-items:center;justify-content:center;">
        <button type="button" data-schedule-standby-edit="true" data-date="${escapeScheduleAttr(dateKey)}" title="Choose stand by" aria-label="Edit stand by for this day"
          style="position:absolute;top:4px;right:4px;min-width:26px;min-height:26px;padding:0;border:none;background:transparent;color:#7c3aed;font-size:16px;line-height:1;cursor:pointer;z-index:2;opacity:0.9;">\u270E</button>
        <div style="text-align:center;width:100%;">${nameShort}</div>
      </div>`;
    }

    return `
      <div data-schedule-standby-cell="true" style="position:relative;padding:6px 4px;border-radius:8px;min-height:42px;display:flex;align-items:center;justify-content:center;text-align:center;background:#f3f4f6;border:1px solid #e5e7eb;">
        <div style="width:100%;">${nameShort}</div>
      </div>`;
  }).join("");

  return `
    <div style="display:grid;grid-template-columns:${gridTemplate};align-items:stretch;border-top:2px solid #e5e7eb;background:linear-gradient(180deg,#fafafa 0%,#fff 100%);">
      <div style="padding:7px 9px;border-bottom:1px solid #e5e7eb;display:flex;flex-direction:column;justify-content:center;min-width:0;">
        <div style="font-size:11px;font-weight:600;color:#6b7280;letter-spacing:0.08em;">STAND BY</div>
      </div>
      ${cells}
    </div>`;
}


function closeScheduleStandByModal() {
  const backdrop = document.getElementById("scheduleStandByModalBackdrop");
  if (backdrop) backdrop.style.display = "none";
  scheduleState.scheduleStandByModalDateKey = null;
}

function ensureScheduleStandByModal() {
  let backdrop = document.getElementById("scheduleStandByModalBackdrop");
  if (backdrop && !document.getElementById("scheduleStandByModalSelect1")) {
    try {
      backdrop.remove();
    } catch (_) {
      /* ignore */
    }
    backdrop = null;
  }
  if (backdrop) return backdrop;
  backdrop = document.createElement("div");
  backdrop.id = "scheduleStandByModalBackdrop";
  backdrop.style.cssText =
    "display:none;position:fixed;inset:0;z-index:100055;background:rgba(15,23,42,0.5);align-items:center;justify-content:center;padding:20px;box-sizing:border-box;";
  backdrop.innerHTML = `
    <div role="dialog" aria-modal="true" aria-labelledby="scheduleStandByModalTitle" style="background:#fff;border-radius:16px;max-width:420px;width:100%;padding:22px 24px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);border:1px solid #e5e7eb;">
      <div id="scheduleStandByModalTitle" style="font-size:17px;font-weight:700;color:#111827;margin:0 0 6px;">Stand by</div>
      <p id="scheduleStandByModalSubtitle" style="font-size:13px;color:#64748b;margin:0 0 16px;line-height:1.45;"></p>
      <label for="scheduleStandByModalSelect1" style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;">Stand by — contact 1</label>
      <select id="scheduleStandByModalSelect1" style="width:100%;height:42px;padding:0 12px;border:1px solid #e5e7eb;border-radius:10px;font-size:14px;background:#fff;color:#111827;box-sizing:border-box;"></select>
      <label for="scheduleStandByModalSelect2" style="display:block;font-size:12px;font-weight:600;color:#374151;margin-top:12px;margin-bottom:6px;">Stand by — contact 2 (optional)</label>
      <select id="scheduleStandByModalSelect2" style="width:100%;height:42px;padding:0 12px;border:1px solid #e5e7eb;border-radius:10px;font-size:14px;background:#fff;color:#111827;box-sizing:border-box;"></select>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px;">
        <button type="button" id="scheduleStandByModalCancel" style="padding:10px 18px;border-radius:10px;border:1px solid #e5e7eb;background:#fff;color:#374151;font-size:14px;font-weight:600;cursor:pointer;">Cancel</button>
        <button type="button" id="scheduleStandByModalSave" style="padding:10px 18px;border-radius:10px;border:none;background:#7c3aed;color:#fff;font-size:14px;font-weight:600;cursor:pointer;">Save</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const card = backdrop.querySelector('[role="dialog"]');
  card?.addEventListener("click", (e) => e.stopPropagation());
  backdrop.addEventListener("click", () => closeScheduleStandByModal());
  backdrop.querySelector("#scheduleStandByModalCancel")?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeScheduleStandByModal();
  });
  backdrop.querySelector("#scheduleStandByModalSave")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!scheduleState.scheduleStandByModalDateKey) return;
    const sel1 = document.getElementById("scheduleStandByModalSelect1");
    const sel2 = document.getElementById("scheduleStandByModalSelect2");
    const id1 = String(sel1?.value || "").trim();
    const id2 = String(sel2?.value || "").trim();
    const viewKey = scheduleState.schedulePreviewView === "technicians" ? "technicians" : "management";
    const dk = scheduleState.scheduleStandByModalDateKey;
    const prevMap =
      scheduleState.schedulePreviewState.standByByDate && typeof scheduleState.schedulePreviewState.standByByDate === "object"
        ? cloneStandByByDateMap(scheduleState.schedulePreviewState.standByByDate)
        : {};
    const base = parseStandByDayEntry(prevMap[dk]);
    prevMap[dk] = {
      ...base,
      [viewKey]: [id1, id2],
    };
    if (!standByDayEntryHasAny(prevMap[dk])) delete prevMap[dk];
    scheduleState.schedulePreviewState.standByByDate = prevMap;
    if (typeof window !== "undefined") {
      window.ffSchedulePreviewState = scheduleState.schedulePreviewState;
    }
    persistScheduleDraftOverrideFromState();
    const wr = scheduleState.schedulePreviewState.weekRange || getWeekRange(scheduleState.schedulePreviewWeekStart);
    const ws = wr?.startDate;
    if (ws && scheduleState.schedulePublishedMap[ws] === true) {
      void syncPublishedWeekStandByToCloud(ws);
    }
    closeScheduleStandByModal();
    renderScheduleBoard(
      scheduleState.schedulePreviewState.draft,
      scheduleState.schedulePreviewState.validation,
      scheduleState.schedulePreviewState.staffList,
    );
  });
  return backdrop;
}

function openScheduleStandByModal(dateKey) {
  const backdrop = ensureScheduleStandByModal();
  scheduleState.scheduleStandByModalDateKey = String(dateKey || "").trim();
  const dk = scheduleState.scheduleStandByModalDateKey;
  const dayLabel = formatBoardDayLabel(dk);
  const titleEl = document.getElementById("scheduleStandByModalTitle");
  const subEl = document.getElementById("scheduleStandByModalSubtitle");
  const tab = scheduleState.schedulePreviewView === "technicians" ? "Service Providers" : "Management";
  const viewKey = scheduleState.schedulePreviewView === "technicians" ? "technicians" : "management";
  if (titleEl) titleEl.textContent = `Stand by (${tab}) — ${dayLabel.title} ${dayLabel.subtitle}`;
  if (subEl) {
    subEl.textContent = `Up to two contacts for this day. Lists only ${tab} staff. The other tab has its own stand-by row.`;
  }
  const staffOpts = getFilteredScheduleStaff(scheduleState.schedulePreviewState.staffList);
  const entry = parseStandByDayEntry(scheduleState.schedulePreviewState.standByByDate?.[dk]);
  const slots = entry[viewKey] || ["", ""];
  const cur1 = String(slots[0] || "").trim();
  const cur2 = String(slots[1] || "").trim();
  const keys = new Set(staffOpts.map((s) => getScheduleStaffKey(s)).filter(Boolean));
  const sel1 = document.getElementById("scheduleStandByModalSelect1");
  const sel2 = document.getElementById("scheduleStandByModalSelect2");
  if (!sel1 || !sel2) return;

  function buildOptions(currentId) {
    const parts = ['<option value="">— None —</option>'];
    if (currentId && !keys.has(currentId)) {
      parts.push(`<option value="${escapeScheduleAttr(currentId)}">Former staff</option>`);
    }
    staffOpts.forEach((s) => {
      const k = getScheduleStaffKey(s);
      if (!k) return;
      parts.push(`<option value="${escapeScheduleAttr(k)}">${escapeScheduleHtml(String(s.name || "Staff"))}</option>`);
    });
    return parts.join("");
  }

  sel1.innerHTML = buildOptions(cur1);
  sel2.innerHTML = buildOptions(cur2);
  sel1.value = cur1;
  sel2.value = cur2;
  backdrop.style.display = "flex";
}

function bindScheduleStandByPen() {
  const board = document.getElementById("scheduleBoard");
  if (!board || board.__ffStandByPenBound) return;
  board.__ffStandByPenBound = true;
  board.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-schedule-standby-edit]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (!scheduleUserCanManualEdit() || scheduleState.schedulePreviewMode !== "build") return;
    const dateKey = String(btn.getAttribute("data-date") || "").trim();
    if (!dateKey) return;
    openScheduleStandByModal(dateKey);
  });
}

function formatScheduleCoverageModalDateTitle(dateKey) {
  const date = new Date(`${String(dateKey || "").trim()}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(dateKey || "").trim() || "—";
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function getCoverageOverlapGapsForModal(dayName, helpers, businessHours, dayShiftSegments, coverageRules) {
  if (!dayName || !helpers) return null;
  let gaps = null;
  if (typeof helpers.getCustomSegmentOverlapCoverageGaps === "function") {
    gaps = helpers.getCustomSegmentOverlapCoverageGaps(dayName, businessHours, dayShiftSegments, coverageRules);
  }
  if (Array.isArray(gaps) && gaps.length > 0) return gaps;
  if (
    typeof helpers.getEffectiveShiftSegmentsForDay === "function" &&
    typeof helpers.buildSegmentOverlapCoverageGapsFromSegments === "function"
  ) {
    const segs = helpers.getEffectiveShiftSegmentsForDay(dayName, businessHours, dayShiftSegments);
    if (Array.isArray(segs) && segs.length > 0) {
      gaps = helpers.buildSegmentOverlapCoverageGapsFromSegments(dayName, segs, coverageRules);
    }
  }
  return Array.isArray(gaps) && gaps.length > 0 ? gaps : null;
}

/** One line per gap; consecutive gaps with identical “Missing” text merge into a single time range (avoids “1 SP” × 3 rows). */
function buildCoverageMinimalGapLinesHtml(gaps, assignments, helpers) {
  if (!Array.isArray(gaps) || !gaps.length || !helpers?.formatMinutesAsScheduleTime) return "";
  const fmt = helpers.formatMinutesAsScheduleTime;
  const count = helpers.countAssignmentsOverlappingMinuteRange;
  const isFull = helpers.isFullManagerAssignmentForCoverage;
  const isAsst = helpers.isAssistantManagerAssignmentForCoverage;
  if (typeof count !== "function" || typeof isFull !== "function" || typeof isAsst !== "function") return "";
  const techPred = (a) => a && a.role === "technician";

  const rows = [];
  for (const g of gaps) {
    const nf = Number(g.needFull) || 0;
    const na = Number(g.needAsst) || 0;
    const nt = Number(g.needTech) || 0;
    if (nf + na + nt === 0) continue;
    const lo = g.startMin;
    const hi = g.endMin;
    const af = count(assignments, lo, hi, isFull);
    const aa = count(assignments, lo, hi, isAsst);
    const at = count(assignments, lo, hi, techPred);
    const shortFull = nf > af;
    const shortAsst = na > aa;
    const shortTech = nt > at;
    if (!shortFull && !shortAsst && !shortTech) continue;

    const missBits = [];
    if (shortFull) missBits.push(`${nf - af} full manager${nf - af === 1 ? "" : "s"}`);
    if (shortAsst) missBits.push(`${na - aa} assistant manager${na - aa === 1 ? "" : "s"}`);
    if (shortTech) missBits.push(`${nt - at} service provider${nt - at === 1 ? "" : "s"}`);
    const line = `Missing: ${missBits.join(", ")}.`;
    const lineKey = missBits.join(" | ");
    rows.push({ lo, hi, line, lineKey });
  }

  const merged = [];
  for (const r of rows) {
    const prev = merged[merged.length - 1];
    if (prev && prev.hi === r.lo && prev.lineKey === r.lineKey) {
      prev.hi = r.hi;
    } else {
      merged.push({ lo: r.lo, hi: r.hi, line: r.line, lineKey: r.lineKey });
    }
  }

  const parts = [];
  for (const m of merged) {
    const range = formatScheduleTimeRangeDisplay(fmt(m.lo), fmt(m.hi), { separator: "–" });
    parts.push(`<div style="margin:0 0 10px;font-size:14px;line-height:1.45;color:#334155;">
      <span style="font-weight:700;color:#c2410c;">${escapeScheduleHtml(range)}</span>
      <span> — ${escapeScheduleHtml(m.line)}</span>
    </div>`);
  }
  return parts.join("");
}

function shortenCoverageWarningForModal(w) {
  if (!w) return "";
  const code = w.code;
  if (code === "assistant_manager_without_manager") {
    const r = String(w.rangeLabel || "").trim();
    return r
      ? `Assistant manager on shift without a full manager/admin overlapping (${r}).`
      : "Assistant manager on shift without a full manager/admin overlapping.";
  }
  if (code === "no_staff_assigned") return "No staff assigned for this day.";
  if (code === "no_manager_assigned") return "No full manager or admin assigned for this day.";
  if (code === "manager_count_below_minimum") return "Full managers are below the minimum set for this day.";
  if (code === "assistant_manager_count_below_minimum") return "Assistant managers are below the minimum set for this day.";
  if (code === "no_technician_assigned") return "No service provider assigned for this day.";
  if (code === "below_min_total_staff") return "Total staff for the day is below the minimum.";
  if (code === "no_front_desk_assigned") return "No front desk coverage for this day.";
  if (code === "segment_coverage_shortfall") {
    const msg = String(w.message || "").trim();
    if (msg.length <= 120) return msg;
    return `${msg.slice(0, 117)}…`;
  }
  return String(w.message || w.code || "").trim();
}

function buildScheduleCoverageModalBodyHtml(dateKey) {
  const validationByDate = getValidationByDate(scheduleState.schedulePreviewState.validation);
  const dayEntry = validationByDate.get(dateKey);
  const cov = filterCoverageWarnings(dayEntry?.warnings);
  const helpers = window.ffScheduleHelpers;
  const dayName = getDayNameFromDateKey(dateKey);
  const businessHours = window.settings?.businessHours || {};
  const dayShiftSegments = window.settings?.dayShiftSegments || {};
  const coverageRules = window.settings?.coverageRules || {};
  const draftDay = findDraftDay(scheduleState.schedulePreviewState.draft, dateKey);
  const assignments = Array.isArray(draftDay?.assignments) ? draftDay.assignments : [];

  const gapsRaw = getCoverageOverlapGapsForModal(dayName, helpers, businessHours, dayShiftSegments, coverageRules);
  const gaps =
    Array.isArray(gapsRaw) && gapsRaw.length
      ? gapsRaw.filter((g) => (Number(g.needFull) || 0) + (Number(g.needAsst) || 0) + (Number(g.needTech) || 0) > 0)
      : [];
  const minimalGapHtml = gaps.length > 0 ? buildCoverageMinimalGapLinesHtml(gaps, assignments, helpers) : "";

  const seenMsg = new Set();
  const uniqueCov = cov.filter((w) => {
    if (minimalGapHtml && w.code === "segment_coverage_shortfall") return false;
    if (minimalGapHtml && w.code === "assistant_manager_without_manager") return false;
    const m = String(w.message || w.code || "");
    if (seenMsg.has(m)) return false;
    seenMsg.add(m);
    return true;
  });

  const otherLines = uniqueCov
    .map((w) => shortenCoverageWarningForModal(w))
    .filter(Boolean);

  let body = "";
  if (minimalGapHtml) {
    body += minimalGapHtml;
  }
  if (otherLines.length > 0) {
    otherLines.forEach((line) => {
      body += `<div style="margin:0 0 10px;font-size:14px;line-height:1.45;color:#334155;">${escapeScheduleHtml(line)}</div>`;
    });
  }
  if (!body) {
    body = `<p style="font-size:14px;color:#64748b;margin:0;">No coverage issues for this day.</p>`;
  }

  return body;
}

function closeScheduleDayCoverageModal() {
  const backdrop = document.getElementById("scheduleDayCoverageModalBackdrop");
  if (backdrop) backdrop.style.display = "none";
}

function ensureScheduleDayCoverageModal() {
  let backdrop = document.getElementById("scheduleDayCoverageModalBackdrop");
  if (backdrop && document.getElementById("scheduleDayCoverageModalIntro")) {
    try {
      backdrop.remove();
    } catch (_) {
      /* ignore */
    }
    backdrop = null;
  }
  if (backdrop) return backdrop;
  backdrop = document.createElement("div");
  backdrop.id = "scheduleDayCoverageModalBackdrop";
  backdrop.style.cssText =
    "display:none;position:fixed;inset:0;z-index:100056;background:rgba(15,23,42,0.5);align-items:center;justify-content:center;padding:20px;box-sizing:border-box;";
  backdrop.innerHTML = `
    <div role="dialog" aria-modal="true" aria-labelledby="scheduleDayCoverageModalTitle" style="background:#fff;border-radius:14px;max-width:min(92vw,420px);width:100%;max-height:min(80vh,520px);overflow:auto;padding:18px 20px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);border:1px solid #e5e7eb;">
      <div id="scheduleDayCoverageModalTitle" style="font-size:16px;font-weight:700;color:#111827;margin:0 0 14px;line-height:1.3;">Coverage</div>
      <div id="scheduleDayCoverageModalBody" style="font-size:14px;color:#334155;"></div>
      <div style="display:flex;justify-content:flex-end;margin-top:20px;">
        <button type="button" id="scheduleDayCoverageModalClose" style="padding:10px 18px;border-radius:10px;border:none;background:#7c3aed;color:#fff;font-size:14px;font-weight:600;cursor:pointer;">Close</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const card = backdrop.querySelector('[role="dialog"]');
  card?.addEventListener("click", (e) => e.stopPropagation());
  backdrop.addEventListener("click", () => closeScheduleDayCoverageModal());
  backdrop.querySelector("#scheduleDayCoverageModalClose")?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeScheduleDayCoverageModal();
  });
  return backdrop;
}

function openScheduleCoverageDayModal(dateKey) {
  const dk = String(dateKey || "").trim();
  if (!dk) return;
  const backdrop = ensureScheduleDayCoverageModal();
  const titleEl = document.getElementById("scheduleDayCoverageModalTitle");
  const bodyEl = document.getElementById("scheduleDayCoverageModalBody");
  if (titleEl) titleEl.textContent = `Coverage — ${formatScheduleCoverageModalDateTitle(dk)}`;
  if (bodyEl) bodyEl.innerHTML = buildScheduleCoverageModalBodyHtml(dk);
  backdrop.style.display = "flex";
}

function bindScheduleCoverageDayClick() {
  const board = document.getElementById("scheduleBoard");
  if (!board || board.__ffCoverageDayBound) return;
  board.__ffCoverageDayBound = true;
  board.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-schedule-coverage-day]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (!scheduleUserCanManualEdit() || scheduleState.schedulePreviewMode !== "build") return;
    const dateKey = String(btn.getAttribute("data-date") || "").trim();
    if (!dateKey) return;
    openScheduleCoverageDayModal(dateKey);
  });
}

function renderScheduleBoard(draft, validation, staffList) {
  const board = document.getElementById("scheduleBoard");
  const empty = document.getElementById("schedulePreviewEmpty");
  if (!board || !empty) return;

  const draftDays = Array.isArray(draft?.days) ? draft.days : [];
  const validationByDate = getValidationByDate(validation);
  const filteredStaff = getFilteredScheduleStaff(staffList);
  const assignmentLookup = buildAssignmentLookup(draft);
  const canBuild = scheduleUserCanManualEdit() && scheduleState.schedulePreviewMode === "build";
  const canManual = canBuild;

  if (!draftDays.length || !filteredStaff.length) {
    board.innerHTML = "";
    empty.style.display = "block";
    empty.textContent = !draftDays.length
      ? "No schedule preview available for this week."
      : scheduleUserCanManualEdit() && scheduleState.schedulePreviewMode === "my_shifts"
        ? "Your staff profile was not found in this week's roster."
        : `No ${scheduleState.schedulePreviewView === "management" ? "management staff" : "technicians"} available for this week.`;
    return;
  }

  empty.style.display = "none";
  const wrAck = getWeekRange(scheduleState.schedulePreviewWeekStart);
  const weekPubForAck = scheduleState.schedulePublishedMap[wrAck.startDate] === true;
  const showStaffAck = canBuild && weekPubForAck;
  const firstColW = showStaffAck ? (canBuild ? 288 : 258) : canBuild ? 252 : 220;
  const gridTemplate = `${firstColW}px repeat(${draftDays.length}, minmax(104px, 1fr))`;
  const headerCells = draftDays.map((day) => {
    const allWarnings = Array.isArray(validationByDate.get(day.date)?.warnings) ? validationByDate.get(day.date).warnings : [];
    const other = filterNonCoverageWarnings(allWarnings);
    const coverageWarnings = filterCoverageWarnings(allWarnings);
    const dayLabel = formatBoardDayLabel(day.date);
    const businessStatus = day.businessStatus || { isOpen: true, source: "business_hours" };
    let issueHtml = "";
    if (businessStatus.isOpen !== false) {
      if (other.length > 0) {
        issueHtml = `<div style="margin-top:6px;font-size:11px;color:#94a3b8;">${other.length} note${other.length === 1 ? "" : "s"}</div>`;
      }
    }
    const coverageStarHtml = "";
    const specialNoteRaw = String(businessStatus.note || "").trim();
    const specialNoteHtml = specialNoteRaw
      ? `<div style="margin-top:5px;font-size:10px;color:#6d28d9;line-height:1.35;font-weight:500;">* ${escapeScheduleHtml(specialNoteRaw)}</div>`
      : "";
    return `
      <div style="padding:7px 6px;border-bottom:1px solid #e5e7eb;background:#f8fafc;min-width:0;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:4px;">
          <div style="min-width:0;flex:1;">
            <div style="font-size:12px;font-weight:700;color:#111827;">${dayLabel.title}</div>
            <div style="font-size:10px;color:#9ca3af;margin-top:1px;">${dayLabel.subtitle}</div>
          </div>
          ${coverageStarHtml}
        </div>
        ${businessStatus.isOpen === false
          ? `<div style="margin-top:6px;font-size:11px;color:#9ca3af;">Closed</div>`
          : issueHtml}
        ${specialNoteHtml}
      </div>
    `;
  }).join("");

  const myAuthedSid = String(getAuthedStaffIdForSchedule() || "").trim();
  const activeLocName = _ffActiveLocationNameForIcs();
  const ctxForBoard = getScheduleAccessContext();
  const isOwnShiftsContext = (!canBuild) && (
    (scheduleUserCanManualEdit() && scheduleState.schedulePreviewMode === "my_shifts") ||
    (ctxForBoard && ctxForBoard.viewOwnOnly === true)
  );
  const unifiedMapForBoard = (scheduleState.schedulePreviewState.myShiftsFromOtherLocs instanceof Map)
    ? scheduleState.schedulePreviewState.myShiftsFromOtherLocs
    : new Map();
  // Management/Team view: per-staff other-location shifts (display-only branch
  // tags for multi-location staff). Only used when the user can build/manage.
  const allStaffOtherLocMap = (canBuild && scheduleState.schedulePreviewState.allStaffOtherLocShifts instanceof Map)
    ? scheduleState.schedulePreviewState.allStaffOtherLocShifts
    : new Map();

  const rowHtml = filteredStaff.map((staff) => {
    const staffKey = getScheduleStaffKey(staff);
    const roleLabel = getScheduleRoleLabel(staff);
    const techTypes = formatScheduleTechnicianTypes(staff);
    const allowCellEdit = canBuild;
    const isMyRowUnified = Boolean(
      isOwnShiftsContext &&
      myAuthedSid &&
      staffKey === myAuthedSid &&
      unifiedMapForBoard.size > 0,
    );
    // Resolve this staff member's other-location shifts for the management view
    // by any identity variant (staffKey / staffId / uid / id).
    let mgmtOtherLocByDate = null;
    if (canBuild && allStaffOtherLocMap.size > 0) {
      const lookupKeys = [staffKey, staff.staffId, staff.uid, staff.userUid, staff.id]
        .map((k) => String(k || "").trim())
        .filter(Boolean);
      for (const k of lookupKeys) {
        if (allStaffOtherLocMap.has(k)) {
          mgmtOtherLocByDate = allStaffOtherLocMap.get(k);
          break;
        }
      }
    }
    const isMgmtRowUnified = Boolean(canBuild && mgmtOtherLocByDate && mgmtOtherLocByDate.size > 0);
    const useUnifiedLayout = isMyRowUnified || isMgmtRowUnified;
    const cells = draftDays.map((day) => {
      const assignment = assignmentLookup.get(`${staffKey}::${day.date}`) || null;
      const otherLocShifts = isMyRowUnified
        ? (unifiedMapForBoard.get(day.date) || [])
        : (isMgmtRowUnified ? (mgmtOtherLocByDate.get(day.date) || []) : []);
      const hasOtherLocShifts = otherLocShifts.length > 0;
      const manualOff = Boolean(!assignment && dayHasManualOff(day, staffKey));
      const inboxApprovedOff = Boolean(
        !assignment && !manualOff && staffDayBlockedByApprovedInbox(staff, day.date),
      );
      const warnings = Array.isArray(validationByDate.get(day.date)?.warnings) ? validationByDate.get(day.date).warnings : [];
      const hasWarnings = cellShowsScheduleWarningDot(warnings, staffKey, staff);
      const businessStatus = day.businessStatus || getBusinessStatusForDate(day.date);
      const canEditShift = Boolean(assignment && businessStatus?.isOpen !== false && allowCellEdit);
      const cellStyle = assignment
        ? `background:#f5f3ff;border:1px solid #d8b4fe;color:#5b21b6;`
        : manualOff || inboxApprovedOff
          ? `background:#f1f5f9;border:1px solid #cbd5e1;color:#475569;`
          : `background:#f3f4f6;border:1px solid #e5e7eb;color:#6b7280;`;
      const assignmentId = assignment ? getAssignmentId(assignment, day.date) : "";
      const safeStaffName = escapeScheduleAttr(staff.name || "");
      const editBtn = canEditShift
        ? `<button type="button" data-schedule-edit-btn="true" data-staff-id="${escapeScheduleAttr(staffKey)}" data-date="${escapeScheduleAttr(day.date)}" data-start="${escapeScheduleAttr(assignment.startTime || "")}" data-end="${escapeScheduleAttr(assignment.endTime || "")}" data-staff-name="${safeStaffName}" title="Edit hours" aria-label="Edit shift hours" style="position:absolute;top:4px;left:4px;min-width:22px;min-height:22px;padding:0;border:none;background:transparent;box-shadow:none;color:#7c3aed;font-size:15px;line-height:1;cursor:pointer;opacity:0.85;z-index:2;">\u270E</button>`
        : "";
      const manualAddBtn =
        !assignment && !manualOff && businessStatus?.isOpen !== false && canManual
          ? `<button type="button" data-schedule-manual-add="true" data-approved-inbox="${inboxApprovedOff ? "1" : "0"}" data-staff-id="${escapeScheduleAttr(staffKey)}" data-date="${escapeScheduleAttr(day.date)}" data-staff-name="${safeStaffName}" title="Add shift manually" aria-label="Add shift manually" style="margin-top:2px;padding:4px 10px;font-size:11px;font-weight:600;border:1px dashed #c4b5fd;background:#faf5ff;color:#7c3aed;border-radius:8px;cursor:pointer;">+ Add shift</button>`
          : "";
      const manualOffBlock = manualOff
        ? `<div style="font-size:10px;font-weight:700;color:#64748b;margin-top:5px;letter-spacing:0.04em;text-transform:uppercase;">Marked OFF</div>`
        : "";
      const requestsList = Array.isArray(scheduleState.schedulePreviewState.requests) ? scheduleState.schedulePreviewState.requests : [];
      const inboxDisp = getInboxApprovalDisplayForDate(staff, requestsList, day.date);
      const showGreenFullDayInboxLabel = Boolean(
        inboxApprovedOff &&
          inboxDisp.hasFullDayRequest &&
          !inboxDisp.hasConflict &&
          !inboxDisp.lateStart &&
          !inboxDisp.earlyLeave,
      );
      const hasPartialApproval = Boolean(
        !assignment &&
          !manualOff &&
          (inboxDisp.lateStart || inboxDisp.earlyLeave) &&
          !inboxDisp.hasFullDayRequest,
      );
      const inboxConflictBlock =
        !assignment && inboxDisp.hasConflict
          ? `<div style="font-size:10px;font-weight:700;color:#b45309;margin-top:5px;line-height:1.35;">Inbox lists a full-day request and a partial time — remove the extra one if wrong.</div>`
          : "";
      const inboxOffBlock = showGreenFullDayInboxLabel
        ? `<div style="font-size:10px;font-weight:700;color:#0f766e;margin-top:5px;letter-spacing:0.04em;text-transform:uppercase;">Approved day off</div>`
        : "";
      const approvedRequestLines = [];
      if (
        (inboxDisp.lateStart || inboxDisp.earlyLeave) &&
        (!inboxDisp.hasFullDayRequest || inboxDisp.hasConflict)
      ) {
        if (inboxDisp.lateStart) {
          approvedRequestLines.push(`Approved START ${formatScheduleTimeShortAmPm(inboxDisp.lateStart)}`);
        }
        if (inboxDisp.earlyLeave) {
          approvedRequestLines.push(`Approved leave by ${formatScheduleTimeShortAmPm(inboxDisp.earlyLeave)}`);
        }
      }
      const approvedRequestBlock =
        !assignment && approvedRequestLines.length > 0
          ? `<div style="font-size:${hasPartialApproval || inboxDisp.hasConflict ? "11" : "9"}px;font-weight:700;color:#0e7490;margin-top:6px;line-height:1.35;max-width:100%;">${approvedRequestLines.map(escapeScheduleHtml).join("<br/>")}</div>`
          : "";
      let approvedMismatchBlock = "";
      if (assignment && (inboxDisp.lateStart || inboxDisp.earlyLeave)) {
        const st = assignment.startTime;
        const en = assignment.endTime;
        const mismatch = [];
        if (inboxDisp.lateStart && compareScheduleHHMM(st, inboxDisp.lateStart) < 0) {
          mismatch.push(
            `Start from ${formatScheduleTimeShortAmPm(inboxDisp.lateStart)} · shift ${formatScheduleTimeShortAmPm(st) || st || "—"}`,
          );
        }
        if (inboxDisp.earlyLeave && en && compareScheduleHHMM(en, inboxDisp.earlyLeave) > 0) {
          mismatch.push(
            `Leave by ${formatScheduleTimeShortAmPm(inboxDisp.earlyLeave)} · shift ${formatScheduleTimeShortAmPm(en) || en}`,
          );
        }
        if (mismatch.length > 0) {
          approvedMismatchBlock = `<div style="font-size:9px;font-weight:600;color:#b45309;margin-top:4px;line-height:1.3;max-width:100%;">${mismatch.map(escapeScheduleHtml).join("<br/>")}</div>`;
        }
      }
      const lunchSubline =
        assignment && assignment.lunchBreakEnabled
          ? `<div style="font-size:9px;font-weight:600;color:#92400e;margin-top:4px;line-height:1.3;max-width:100%;">${escapeScheduleHtml(formatLunchBreakCellSubtitle(assignment))}</div>`
          : "";
      const emptyCellWrap = !assignment
        ? `style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:100%;"`
        : "";

      // Unified multi-location layout for the authed user's own row. Keeps
      // the active-location block editable as usual and renders each
      // other-location shift as a compact read-only sub-block beneath it.
      if (useUnifiedLayout && (assignment || hasOtherLocShifts)) {
        const activeName = activeLocName || "This branch";
        const totalUnifiedBlocks = (assignment ? 1 : 0) + otherLocShifts.length;
        // Location name shown INSIDE the cell as a compact colored line (no pill
        // chip) so a single shift fills the cell like a normal one — no gap.
        const locLine = (name, color) =>
          `<div style="font-size:9px;font-weight:800;letter-spacing:0.02em;line-height:1.2;margin-bottom:2px;color:${color};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;">${escapeScheduleHtml(name)}</div>`;
        const lunchOtherHtml = (s) =>
          s.lunchBreakEnabled
            ? `<div style="font-size:9px;font-weight:600;color:#92400e;margin-top:3px;line-height:1.25;max-width:100%;">${escapeScheduleHtml(formatLunchBreakCellSubtitle({
                lunchBreakEnabled: true,
                lunchBreakStart: s.lunchBreakStart,
                lunchBreakEnd: s.lunchBreakEnd,
              }))}</div>`
            : "";

        // Common case — exactly ONE shift in the cell. Render it to FILL the
        // cell exactly like a normal cell: colored by branch, location name
        // inside, edit/add control absolute inside (no extra gap/whitespace).
        if (totalUnifiedBlocks === 1 && assignment) {
          return `
            <div data-drop-zone="true" data-staff-id="${staffKey}" data-date="${day.date}" style="position:relative;padding:6px;border-radius:8px;min-height:50px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-size:11px;font-weight:700;line-height:1.25;background:#f5f3ff;border:1px solid #d8b4fe;color:#5b21b6;">
              ${editBtn}
              ${locLine(activeName, "#7c3aed")}
              <div ${allowCellEdit ? `data-schedule-shift="true" draggable="true" data-shift-id="${assignmentId}" data-staff-id="${staffKey}" data-date="${day.date}" style="cursor:grab;user-select:none;"` : `style="user-select:none;"`}>
                <div>${escapeScheduleHtml(formatScheduleTimeRangeDisplay(assignment.startTime, assignment.endTime, { fallback: "--:-- - --:--" }))}</div>
                ${lunchSubline}
                ${approvedMismatchBlock}
              </div>
            </div>
          `;
        }
        if (totalUnifiedBlocks === 1 && !assignment) {
          const s = otherLocShifts[0];
          const labelName = s.locationName || "Other branch";
          const addCornerBtn =
            !manualOff && businessStatus?.isOpen !== false && canManual
              ? `<button type="button" data-schedule-manual-add="true" data-approved-inbox="${inboxApprovedOff ? "1" : "0"}" data-staff-id="${escapeScheduleAttr(staffKey)}" data-date="${escapeScheduleAttr(day.date)}" data-staff-name="${safeStaffName}" title="Add shift in ${escapeScheduleAttr(activeName)}" aria-label="Add shift in active branch" style="position:absolute;top:3px;right:3px;min-width:20px;height:20px;padding:0 6px;border:1px dashed #c4b5fd;background:#faf5ff;color:#7c3aed;border-radius:999px;font-size:13px;font-weight:800;line-height:1;cursor:pointer;z-index:2;">+</button>`
              : "";
          return `
            <div style="position:relative;padding:6px;border-radius:8px;min-height:50px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-size:11px;font-weight:700;line-height:1.25;background:#eff6ff;border:1px solid #93c5fd;color:#1d4ed8;" title="From ${escapeScheduleAttr(labelName)} — edit in that branch's schedule">
              ${addCornerBtn}
              ${locLine(labelName, "#2563eb")}
              <div>${escapeScheduleHtml(formatScheduleTimeRangeDisplay(s.startTime, s.endTime, { fallback: "--:-- - --:--" }))}</div>
              ${lunchOtherHtml(s)}
            </div>
          `;
        }

        // 2+ shifts the same day → stack compactly (tight gap, blocks fill).
        const activeBlock = assignment
          ? `
            <div data-drop-zone="true" data-staff-id="${staffKey}" data-date="${day.date}" style="position:relative;padding:5px 6px;border-radius:8px;min-height:46px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-size:11px;font-weight:700;line-height:1.2;background:#f5f3ff;border:1px solid #d8b4fe;color:#5b21b6;">
              ${editBtn}
              ${locLine(activeName, "#7c3aed")}
              <div ${allowCellEdit ? `data-schedule-shift="true" draggable="true" data-shift-id="${assignmentId}" data-staff-id="${staffKey}" data-date="${day.date}" style="cursor:grab;user-select:none;"` : `style="user-select:none;"`}>
                <div>${escapeScheduleHtml(formatScheduleTimeRangeDisplay(assignment.startTime, assignment.endTime, { fallback: "--:-- - --:--" }))}</div>
                ${lunchSubline}
                ${approvedMismatchBlock}
              </div>
            </div>
          `
          : "";

        const otherBlocks = otherLocShifts.map((s) => {
          const labelName = s.locationName || "Other branch";
          return `
            <div style="padding:5px 6px;border-radius:8px;min-height:46px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-size:11px;font-weight:700;line-height:1.2;background:#eff6ff;border:1px solid #93c5fd;color:#1d4ed8;" title="From ${escapeScheduleAttr(labelName)} — edit in that branch's schedule">
              ${locLine(labelName, "#2563eb")}
              <div>${escapeScheduleHtml(formatScheduleTimeRangeDisplay(s.startTime, s.endTime, { fallback: "--:-- - --:--" }))}</div>
              ${lunchOtherHtml(s)}
            </div>
          `;
        }).join("");

        return `
          <div style="padding:0;display:flex;flex-direction:column;gap:3px;min-height:50px;">
            ${activeBlock}
            ${otherBlocks}
          </div>
        `;
      }

      return `
        <div data-drop-zone="true" data-staff-id="${staffKey}" data-date="${day.date}" style="position:relative;padding:6px;border-radius:8px;min-height:50px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:11px;font-weight:${assignment ? "700" : "500"};line-height:1.25;transition:outline-color 0.12s ease;${cellStyle}">
          ${editBtn}
          <div ${assignment && allowCellEdit ? `data-schedule-shift="true" draggable="true" data-shift-id="${assignmentId}" data-staff-id="${staffKey}" data-date="${day.date}" style="cursor:grab;user-select:none;"` : assignment ? `style="user-select:none;"` : emptyCellWrap}>
            <div>${
              assignment
                ? escapeScheduleHtml(formatScheduleTimeRangeDisplay(assignment.startTime, assignment.endTime, { fallback: "--:-- - --:--" }))
                : hasPartialApproval
                  ? `<span style="font-weight:600;color:#475569;">Not scheduled</span>`
                  : "Off"
            }</div>
            ${lunchSubline}
            ${approvedMismatchBlock}
            ${manualOffBlock}
            ${inboxOffBlock}
            ${approvedRequestBlock}
            ${manualAddBtn}
          </div>
        </div>
      `;
    }).join("");

    const weeklyMins = computeStaffWeeklyScheduledMinutes(staffKey, draftDays, assignmentLookup);
    const weeklyHoursSuffix = canBuild
      ? ` <span style="font-weight:600;color:#64748b;">(${formatWeeklyHoursShort(weeklyMins)})</span>`
      : "";
    const nameControl = staffKey
      ? `<button type="button" data-schedule-staff-profile="true" data-staff-id="${escapeScheduleAttr(staffKey)}" title="Open staff profile — edit default schedule" aria-label="Open staff profile to edit default schedule" style="font:inherit;font-size:12px;font-weight:700;line-height:1.25;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;width:100%;border:none;background:transparent;padding:0;margin:0;cursor:pointer;text-align:left;text-decoration:none;display:block;box-sizing:border-box;">${escapeScheduleAttr(staff.name || "Unknown Staff")}${weeklyHoursSuffix}</button>`
      : `<span style="font-size:12px;font-weight:700;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeScheduleAttr(staff.name || "Unknown Staff")}${weeklyHoursSuffix}</span>`;

    const seenMsRow = staffKey ? scheduleState.scheduleWeekAckSeenAtByStaffId[staffKey] || 0 : 0;
    const pingMsRow = staffKey ? scheduleState.scheduleWeekPingAtByStaffId[staffKey] || 0 : 0;
    const ackUpToDate = Boolean(staffKey && seenMsRow > 0 && (pingMsRow === 0 || seenMsRow >= pingMsRow));
    const ackPendingUpdate = Boolean(staffKey && pingMsRow > 0 && seenMsRow < pingMsRow);
    const ackBadgeHtml = showStaffAck
      ? ackUpToDate
        ? `<span style="display:inline-flex;align-items:center;flex-shrink:0;padding:1px 7px;border-radius:999px;background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;font-size:9px;font-weight:700;line-height:1.35;">Seen</span>`
        : ackPendingUpdate
          ? `<span style="display:inline-flex;align-items:center;flex-shrink:0;padding:1px 7px;border-radius:999px;background:#fffbeb;color:#b45309;border:1px solid #fcd34d;font-size:9px;font-weight:700;line-height:1.35;">Pending</span>`
          : `<span style="display:inline-flex;align-items:center;flex-shrink:0;padding:1px 7px;border-radius:999px;background:#f9fafb;color:#9ca3af;border:1px solid #e5e7eb;font-size:9px;font-weight:700;line-height:1.35;">Not seen</span>`
      : "";
    const roleSafe = escapeScheduleHtml(roleLabel);
    const techTypesSafe = techTypes ? escapeScheduleHtml(techTypes) : null;
    const roleRowHtml = showStaffAck
      ? `<div style="display:flex;flex-direction:column;gap:2px;font-size:11px;color:#6b7280;line-height:1.35;min-width:0;">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;min-width:0;">
            <span style="min-width:0;">${roleSafe}</span>
            ${ackBadgeHtml}
          </div>
          ${techTypesSafe ? `<div style="font-size:10px;color:#9ca3af;">${techTypesSafe}</div>` : ''}
        </div>`
      : `<div style="font-size:11px;color:#6b7280;line-height:1.35;">${roleSafe}${techTypesSafe ? `<br/><span style="font-size:10px;color:#9ca3af;">${techTypesSafe}</span>` : ''}</div>`;

    return `
      <div class="schedule-board-desktop-row" style="display:grid;grid-template-columns:${gridTemplate};align-items:stretch;">
        <div style="padding:7px 9px;border-bottom:1px solid #e5e7eb;background:#fff;display:flex;flex-direction:column;justify-content:center;gap:2px;min-width:0;">
          ${nameControl}
          ${roleRowHtml}
        </div>
        ${cells}
      </div>
    `;
  }).join("");

  const mobileRowHtml = filteredStaff.map((staff) => {
    const staffKey = getScheduleStaffKey(staff);
    const roleLabel = getScheduleRoleLabel(staff);
    const weeklyMins = computeStaffWeeklyScheduledMinutes(staffKey, draftDays, assignmentLookup);
    const weeklyHours = canBuild ? formatWeeklyHoursShort(weeklyMins) : "";
    const staffName = escapeScheduleHtml(staff.name || "Unknown Staff");
    const roleSafe = escapeScheduleHtml(roleLabel);
    const safeStaffName = escapeScheduleAttr(staff.name || "");
    // Resolve this staff member's other-location shifts so mobile cards show a
    // branch tag per day for multi-location staff (My-shifts view = own row;
    // management view = any row). Mirrors the desktop unified-layout logic.
    let mobileOtherLocByDate = null;
    if (isOwnShiftsContext && myAuthedSid && staffKey === myAuthedSid && unifiedMapForBoard.size > 0) {
      mobileOtherLocByDate = unifiedMapForBoard;
    } else if (canBuild && allStaffOtherLocMap.size > 0) {
      const lookupKeys = [staffKey, staff.staffId, staff.uid, staff.userUid, staff.id]
        .map((k) => String(k || "").trim())
        .filter(Boolean);
      for (const k of lookupKeys) {
        if (allStaffOtherLocMap.has(k)) {
          mobileOtherLocByDate = allStaffOtherLocMap.get(k);
          break;
        }
      }
    }
    const staffIsMultiLoc = Boolean(mobileOtherLocByDate && mobileOtherLocByDate.size > 0);
    const activeLocNameMobile = activeLocName || "This branch";
    const dayCards = draftDays.map((day) => {
      const dayLabel = formatBoardDayLabel(day.date);
      const assignment = assignmentLookup.get(`${staffKey}::${day.date}`) || null;
      const manualOff = Boolean(!assignment && dayHasManualOff(day, staffKey));
      const requestsList = Array.isArray(scheduleState.schedulePreviewState.requests) ? scheduleState.schedulePreviewState.requests : [];
      const inboxDisp = getInboxApprovalDisplayForDate(staff, requestsList, day.date);
      const inboxApprovedOff = Boolean(!assignment && !manualOff && staffDayBlockedByApprovedInbox(staff, day.date));
      const businessStatus = day.businessStatus || getBusinessStatusForDate(day.date);
      const dayIsClosed = businessStatus?.isOpen === false || getBusinessStatusForDate(day.date).isOpen === false;
      const assignmentId = assignment ? getAssignmentId(assignment, day.date) : "";
      const canEditShift = Boolean(assignment && !dayIsClosed && canManual);
      const editBtn = canEditShift
        ? `<button type="button" data-schedule-edit-btn="true" data-staff-id="${escapeScheduleAttr(staffKey)}" data-date="${escapeScheduleAttr(day.date)}" data-start="${escapeScheduleAttr(assignment.startTime || "")}" data-end="${escapeScheduleAttr(assignment.endTime || "")}" data-staff-name="${safeStaffName}" title="Edit hours" aria-label="Edit shift hours" style="border:none;background:#ede9fe;color:#7c3aed;border-radius:999px;font-size:11px;font-weight:800;padding:3px 7px;cursor:pointer;line-height:1.2;">Edit</button>`
        : "";
      const manualAddBtn =
        !assignment && !manualOff && !dayIsClosed && canManual
          ? `<button type="button" data-schedule-manual-add="true" data-approved-inbox="${inboxApprovedOff ? "1" : "0"}" data-staff-id="${escapeScheduleAttr(staffKey)}" data-date="${escapeScheduleAttr(day.date)}" data-staff-name="${safeStaffName}" title="Add shift manually" aria-label="Add shift manually" style="border:1px dashed #c4b5fd;background:#faf5ff;color:#7c3aed;border-radius:999px;font-size:11px;font-weight:800;padding:3px 8px;cursor:pointer;line-height:1.2;white-space:nowrap;">+ Add shift</button>`
          : "";
      const noteParts = [];
      if (manualOff) noteParts.push("Marked OFF");
      if (inboxApprovedOff && inboxDisp.hasFullDayRequest) noteParts.push("Approved day off");
      if (inboxDisp.lateStart) noteParts.push(`Approved START ${formatScheduleTimeShortAmPm(inboxDisp.lateStart)}`);
      if (inboxDisp.earlyLeave) noteParts.push(`Approved leave by ${formatScheduleTimeShortAmPm(inboxDisp.earlyLeave)}`);
      const noteHtml = noteParts.length
        ? `<div style="margin-top:5px;font-size:11px;font-weight:700;color:#64748b;line-height:1.35;">${noteParts.map(escapeScheduleHtml).join("<br/>")}</div>`
        : "";
      const statusHtml = dayIsClosed
        ? `<span style="color:#9ca3af;font-size:13px;font-weight:700;">Closed</span>`
        : assignment
          ? `<span ${canManual ? `data-schedule-shift="true" draggable="true" data-shift-id="${assignmentId}" data-staff-id="${staffKey}" data-date="${day.date}" style="cursor:grab;user-select:none;"` : `style="user-select:none;"`}>${escapeScheduleHtml(formatScheduleTimeRangeDisplay(assignment.startTime, assignment.endTime, { fallback: "--:-- - --:--" }))}</span>`
          : manualOff
            ? `<span style="color:#64748b;font-weight:800;">Marked OFF</span>`
            : inboxApprovedOff
              ? `<span style="color:#0f766e;font-weight:800;">Approved off</span>`
              : `<span style="color:#9ca3af;font-weight:800;">Off</span>`;
      // Multi-location: show which branch the active shift is at, and list any
      // shifts the person has at other branches that day (display only).
      const dayOtherShifts = mobileOtherLocByDate ? (mobileOtherLocByDate.get(day.date) || []) : [];
      const activeBranchTagMobile = (staffIsMultiLoc && assignment && !dayIsClosed)
        ? `<div style="margin-top:5px;display:flex;justify-content:flex-end;"><span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd;font-size:10px;font-weight:800;line-height:1.25;"><span style="width:5px;height:5px;border-radius:50%;background:#7c3aed;"></span>${escapeScheduleHtml(activeLocNameMobile)}</span></div>`
        : "";
      const otherShiftsMobileHtml = dayOtherShifts.length
        ? `<div style="margin-top:6px;display:flex;flex-direction:column;gap:5px;">${dayOtherShifts.map((s) => `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:5px 8px;border-radius:8px;background:#eff6ff;border:1px dashed #93c5fd;">
              <span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:800;color:#1d4ed8;line-height:1.25;"><span style="width:5px;height:5px;border-radius:50%;background:#2563eb;"></span>${escapeScheduleHtml(s.locationName || "Other branch")}</span>
              <span style="font-size:12px;font-weight:900;color:#1d4ed8;">${escapeScheduleHtml(formatScheduleTimeRangeDisplay(s.startTime, s.endTime, { fallback: "--:-- - --:--" }))}</span>
            </div>`).join("")}</div>`
        : "";
      return `
        <div style="border:1px solid #e5e7eb;border-radius:10px;background:#f8fafc;padding:7px 9px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <div style="min-width:0;">
              <div style="font-size:12px;font-weight:900;color:#111827;line-height:1.15;">${dayLabel.title}</div>
              <div style="font-size:10px;color:#9ca3af;margin-top:0;">${dayLabel.subtitle}</div>
            </div>
            <div style="display:flex;align-items:center;justify-content:flex-end;gap:7px;text-align:right;font-size:13px;font-weight:900;color:${assignment ? "#5b21b6" : "#6b7280"};line-height:1.25;min-width:0;">
              ${statusHtml}
              ${editBtn || manualAddBtn}
            </div>
          </div>
          ${activeBranchTagMobile}
          ${noteHtml}
          ${otherShiftsMobileHtml}
        </div>
      `;
    }).join("");
    return `
      <article class="schedule-mobile-staff-card" style="border:1px solid #e5e7eb;border-radius:16px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,0.04);overflow:hidden;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:12px 14px;border-bottom:1px solid #ddd6fe;background:#f5f3ff;">
          <div style="min-width:0;">
            <div style="font-size:14px;font-weight:900;color:#5b21b6;line-height:1.25;">${staffName}${weeklyHours ? ` <span style="font-size:12px;color:#7c3aed;font-weight:700;">(${weeklyHours})</span>` : ""}</div>
            <div style="font-size:12px;color:#6d28d9;margin-top:3px;font-weight:600;">${roleSafe}</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;padding:8px;">
          ${dayCards}
        </div>
      </article>
    `;
  }).join("");

  const standByMap = scheduleState.schedulePreviewState.standByByDate && typeof scheduleState.schedulePreviewState.standByByDate === "object"
    ? scheduleState.schedulePreviewState.standByByDate
    : {};
  const canPickStandBy = scheduleUserCanManualEdit() && scheduleState.schedulePreviewMode === "build";
  const standByRowHtml = renderScheduleStandByRowHtml({
    draftDays,
    gridTemplate,
    standByByDate: standByMap,
    staffListForNames: staffList,
    draftForNames: draft,
    canPickStandBy,
    standByView: scheduleState.schedulePreviewView,
  });
  const mobileStandByHtml = (() => {
    const map = standByMap && typeof standByMap === "object" ? standByMap : {};
    const viewKey = scheduleState.schedulePreviewView === "technicians" ? "technicians" : "management";
    const standbyTextStyle = "font-size:13px;font-weight:800;color:#374151;line-height:1.35;";
    const dayCards = draftDays.map((day) => {
      const dayLabel = formatBoardDayLabel(day.date);
      const bs = day.businessStatus || getBusinessStatusForDate(day.date);
      const dayIsClosed = bs.isOpen === false || getBusinessStatusForDate(day.date).isOpen === false;
      const entry = parseStandByDayEntry(map[day.date]);
      const slotIds = entry[viewKey] || ["", ""];
      const names = dayIsClosed
        ? `<span style="color:#9ca3af;font-size:13px;font-weight:700;">Closed</span>`
        : renderStandBySlotNamesHtml(slotIds, staffList, draft, standbyTextStyle);
      const editBtn = canPickStandBy && !dayIsClosed
        ? `<button type="button" data-schedule-standby-edit="true" data-date="${escapeScheduleAttr(day.date)}" title="Choose stand by" aria-label="Edit stand by for this day" style="border:1px solid #ddd6fe;background:#f5f3ff;color:#7c3aed;border-radius:999px;font-size:12px;font-weight:800;padding:5px 10px;cursor:pointer;">Edit</button>`
        : "";
      return `
        <div style="border:1px solid #e5e7eb;border-radius:12px;background:#f8fafc;padding:10px 11px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div>
            <div style="font-size:12px;font-weight:900;color:#111827;">${dayLabel.title}</div>
            <div style="font-size:10px;color:#9ca3af;margin-top:1px;">${dayLabel.subtitle}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;text-align:right;">${names}${editBtn}</div>
        </div>
      `;
    }).join("");
    return `
      <details class="schedule-mobile-staff-card" style="border:1px solid #e5e7eb;border-radius:16px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,0.04);overflow:hidden;">
        <summary style="list-style:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;background:#f8fafc;border-bottom:1px solid #f1f5f9;cursor:pointer;">
          <span style="font-size:13px;font-weight:900;color:#6b7280;letter-spacing:.06em;text-transform:uppercase;">Stand By</span>
          <span aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:999px;border:1px solid #e5e7eb;background:#fff;color:#6b7280;font-size:13px;font-weight:900;">▼</span>
        </summary>
        <div style="display:flex;flex-direction:column;gap:8px;padding:10px;">${dayCards}</div>
      </details>
    `;
  })();

  board.innerHTML = `
    <section class="schedule-board-desktop" style="border:1px solid #e5e7eb;border-radius:14px;background:#fff;overflow:auto;">
      <div style="min-width:${firstColW + (draftDays.length * 104)}px;">
        <div style="display:grid;grid-template-columns:${gridTemplate};align-items:stretch;">
          <div style="padding:9px 11px;border-bottom:1px solid #e5e7eb;background:#f8fafc;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Staff${showStaffAck ? ` <span style="font-weight:600;color:#94a3b8;font-size:10px;">(viewed)</span>` : ""}</div>
          ${headerCells}
        </div>
        ${rowHtml}
        ${standByRowHtml}
      </div>
    </section>
    <section class="schedule-board-mobile-list">
      ${mobileRowHtml}
      ${mobileStandByHtml}
    </section>
  `;
  bindScheduleBoardDnD();
  bindScheduleShiftEditButtons();
  bindScheduleBoardManualAdd();
  bindScheduleStaffProfileLinks();
  bindScheduleStandByPen();
  bindScheduleCoverageDayClick();
}

function bindScheduleStaffProfileLinks() {
  const board = document.getElementById("scheduleBoard");
  if (!board || board.__ffStaffProfileBound) return;
  board.__ffStaffProfileBound = true;
  board.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-schedule-staff-profile]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const id = String(btn.getAttribute("data-staff-id") || "").trim();
    if (!id || typeof window.openStaffMemberScheduleTab !== "function") return;
    window.openStaffMemberScheduleTab(id);
  });
}

function setScheduleLoadingState({ loading = false, error = "" } = {}) {
  const loadingEl = document.getElementById("schedulePreviewLoading");
  const errorEl = document.getElementById("schedulePreviewError");
  if (loadingEl) loadingEl.style.display = loading ? "block" : "none";
  if (errorEl) {
    errorEl.style.display = error ? "block" : "none";
    errorEl.textContent = error || "";
  }
}

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
