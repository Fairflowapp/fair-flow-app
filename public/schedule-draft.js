// schedule-draft.js
// Schedule — draft cloning/mutation helpers, staff shift fingerprints, save /
// notify flows, manual-off overrides, local draft persistence, and inbox
// availability guards. Extracted verbatim from schedule-ui.js (Phase 5 of the
// schedule-ui split). Remaining board/stand-by/business helpers are injected
// via initScheduleDraft().

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  deleteField,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { generateWeeklySchedule } from "./schedule-generator.js?v=20260817_build_hours";
import { getEffectiveAvailabilityForDate } from "./schedule-availability.js?v=20260903_sched_lock";
import { scheduleState } from "./schedule-state.js?v=20260702_schedule_state";
import {
  _ffSchedActiveLocId,
  _ffSchedHasActiveLocationForWrite,
  _ffSchedPerLocDocId,
  _ffSchedUserHasMultipleLocations,
  ffScheduleAppToast,
  getAuthedStaffIdForSchedule,
  loadScheduleWeekPingMap,
} from "./schedule-ack.js?v=20260903_sched_lock";
import { getSchedulePublishDocRef } from "./schedule-cloud.js?v=20260903_sched_lock";
import {
  formatWeekLabel,
  getScheduleStaffKey,
  getWeekRange,
} from "./schedule-format.js?v=20260903_sched_lock2";
import {
  closeScheduleShiftEdit,
  ensureScheduleRebuildConfirmModal,
  escapeScheduleHtml,
  scheduleUserCanManualEdit,
} from "./schedule-shift-edit.js?v=20260903_sched_lock2";

// -- injected via initScheduleDraft() (wired in schedule-ui.js) --
let _ffActiveLocationNameForIcs;
let applyBusinessSettingsToDraft;
let cloneStandByByDateMap = function cloneStandByByDateMap(map) {
  try {
    return JSON.parse(JSON.stringify(map && typeof map === "object" ? map : {}));
  } catch (_) {
    return {};
  }
};
let getBusinessStatusForDate;
let getStaffByScheduleKey;
let normalizeStandByBlock;
let refreshSchedulePreview;
let renderScheduleBoard;
let renderScheduleSummary;
let revalidateLocalDraft;
let standByMapsEqual;

export function initScheduleDraft(deps) {
  ({
    _ffActiveLocationNameForIcs,
    applyBusinessSettingsToDraft,
    getBusinessStatusForDate,
    getStaffByScheduleKey,
    normalizeStandByBlock,
    refreshSchedulePreview,
    renderScheduleBoard,
    renderScheduleSummary,
    revalidateLocalDraft,
    standByMapsEqual,
  } = deps);
  if (typeof deps.cloneStandByByDateMap === "function") {
    cloneStandByByDateMap = deps.cloneStandByByDateMap;
  }
}

function buildAssignmentLookup(draft) {
  const lookup = new Map();
  (Array.isArray(draft?.days) ? draft.days : []).forEach((day) => {
    (Array.isArray(day.assignments) ? day.assignments : []).forEach((assignment) => {
      const key = String(assignment.staffId || assignment.uid || "").trim();
      if (!key) return;
      lookup.set(`${key}::${day.date}`, assignment);
    });
  });
  return lookup;
}

function getAssignmentId(assignment, dateKey) {
  const rawId = String(assignment?.shiftId || assignment?.id || "").trim();
  if (rawId) return rawId;
  const staffId = String(assignment?.staffId || assignment?.uid || "").trim();
  return `${staffId}::${dateKey}`;
}

const CELL_NOTE_MAX_LEN = 200;

function normalizeCellNote(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > CELL_NOTE_MAX_LEN ? text.slice(0, CELL_NOTE_MAX_LEN) : text;
}

function cloneCellNotesByStaffId(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  Object.keys(value).forEach((rawKey) => {
    const key = String(rawKey || "").trim();
    const note = normalizeCellNote(value[rawKey]);
    if (key && note) out[key] = note;
  });
  return out;
}

function getCellNoteForStaffDay(day, staffKey) {
  const key = String(staffKey || "").trim();
  if (!key || !day || !day.cellNotesByStaffId || typeof day.cellNotesByStaffId !== "object") return "";
  return normalizeCellNote(day.cellNotesByStaffId[key]);
}

function setCellNoteForStaffDay(draft, dateKey, staffKey, note) {
  const day = findDraftDay(draft, dateKey);
  const key = String(staffKey || "").trim();
  if (!day || !key) return;
  const next = cloneCellNotesByStaffId(day.cellNotesByStaffId);
  const normalized = normalizeCellNote(note);
  if (normalized) next[key] = normalized;
  else delete next[key];
  if (Object.keys(next).length) day.cellNotesByStaffId = next;
  else delete day.cellNotesByStaffId;
}

function cloneScheduleDraft(draft) {
  return {
    ...draft,
    days: (Array.isArray(draft?.days) ? draft.days : []).map((day) => ({
      ...day,
      manualOffStaffIds: Array.isArray(day.manualOffStaffIds) ? [...day.manualOffStaffIds] : [],
      cellNotesByStaffId: cloneCellNotesByStaffId(day.cellNotesByStaffId),
      assignments: (Array.isArray(day.assignments) ? day.assignments : []).map((assignment) => ({ ...assignment })),
    })),
    context: draft?.context ? { ...draft.context } : draft?.context,
    metadata: draft?.metadata ? { ...draft.metadata } : draft?.metadata,
  };
}

function findDraftDay(draft, dateKey) {
  return (Array.isArray(draft?.days) ? draft.days : []).find((day) => day.date === dateKey) || null;
}

function dayHasManualOff(day, staffKey) {
  const ids = Array.isArray(day?.manualOffStaffIds) ? day.manualOffStaffIds : [];
  return ids.includes(staffKey);
}

function simpleHashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

/** Stable fingerprint of one staff member’s row for the draft week (shifts + OFF). */
function computeStaffShiftFingerprintForWeek(draft, staffKey) {
  const days = Array.isArray(draft?.days) ? draft.days : [];
  const parts = [];
  for (const day of days) {
    const date = day.date;
    const assignments = Array.isArray(day.assignments) ? day.assignments : [];
    const a = assignments.find((x) => String(x.staffId || x.uid || "").trim() === staffKey);
    const off = dayHasManualOff(day, staffKey);
    if (a) {
      const lunch = a.lunchBreakEnabled
        ? `|L:${String(a.lunchStartTime || "").trim()}-${String(a.lunchEndTime || "").trim()}`
        : "";
      parts.push(`${date}|${String(a.startTime || "").trim()}|${String(a.endTime || "").trim()}${lunch}`);
    } else if (off) {
      parts.push(`${date}|OFF`);
    } else {
      parts.push(`${date}|—`);
    }
  }
  parts.sort();
  return simpleHashString(parts.join("~"));
}

function computeFingerprintMapForDraft(draft, staffList) {
  const map = {};
  for (const staff of staffList || []) {
    const k = getScheduleStaffKey(staff);
    if (!k) continue;
    map[k] = computeStaffShiftFingerprintForWeek(draft, k);
  }
  return map;
}

async function persistStaffShiftFingerprintsForWeek(weekStart, draft, staffList) {
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  if (!salonId || !weekStart || !draft) return;
  if (!_ffSchedHasActiveLocationForWrite()) return;
  const fp = computeFingerprintMapForDraft(draft, staffList);
  const ref = getSchedulePublishDocRef();
  if (!ref) return;
  const standByByDate =
    scheduleState.schedulePreviewState?.standByByDate && typeof scheduleState.schedulePreviewState.standByByDate === "object"
      ? cloneStandByMapSafe(scheduleState.schedulePreviewState.standByByDate)
      : {};
  try {
    await setDoc(
      ref,
      {
        locationId: _ffSchedActiveLocId() || null,
        staffShiftFingerprints: { [weekStart]: fp },
        weekDraftSnapshots: {
          [weekStart]: {
            savedAt: serverTimestamp(),
            days: serializeDraftDaysForStorage(draft),
            standByByDate,
          },
        },
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (e) {
    console.warn("[ScheduleUI] persist shift fingerprints", e);
  }
}

let _scheduleWeekDraftAutosaveTimer = null;
let _scheduleWeekDraftAutosaveInFlight = false;
let _scheduleWeekDraftAutosaveQueued = false;

function setScheduleSaveStatus(text, kind) {
  const btn = document.getElementById("scheduleSaveDraftBtn");
  if (!btn) return;
  const state = kind === "error" ? "is-error" : kind === "busy" ? "is-busy" : kind === "dirty" ? "is-dirty" : "is-ok";
  btn.style.display = "none";
  btn.disabled = true;
  btn.textContent = text;
  btn.dataset.ffSaveStatusSeeded = "1";
  btn.classList.remove("is-ok", "is-busy", "is-error", "is-dirty");
  btn.classList.add(state);
}

function markScheduleLocalDirty(weekStart) {
  const dk = getScheduleLocalDirtyStorageKey(weekStart);
  if (dk && typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(dk, "1");
    } catch (_) {
      /* ignore */
    }
  }
}

function queueScheduleWeekDraftAutosave() {
  if (!scheduleUserCanManualEdit()) return;
  if (_scheduleWeekDraftAutosaveTimer) {
    clearTimeout(_scheduleWeekDraftAutosaveTimer);
    _scheduleWeekDraftAutosaveTimer = null;
  }
  const weekRange = getWeekRange(scheduleState.schedulePreviewWeekStart);
  if (weekRange.startDate) markScheduleLocalDirty(weekRange.startDate);
  setScheduleSaveStatus("Saving", "busy");
  _scheduleWeekDraftAutosaveTimer = setTimeout(() => {
    _scheduleWeekDraftAutosaveTimer = null;
    saveScheduleWeekDraftToCloud({ silent: true });
  }, 900);
}

/** Write the in-progress draft to the salon now (before Publish / week switch). */
async function flushScheduleWeekDraftToCloud() {
  if (!scheduleUserCanManualEdit()) return;
  if (_scheduleWeekDraftAutosaveTimer) {
    clearTimeout(_scheduleWeekDraftAutosaveTimer);
    _scheduleWeekDraftAutosaveTimer = null;
  }
  const started = Date.now();
  if (!_scheduleWeekDraftAutosaveInFlight) {
    await saveScheduleWeekDraftToCloud({ silent: true });
  }
  while (_scheduleWeekDraftAutosaveInFlight && Date.now() - started < 8000) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

function scheduleWeekHasUnsavedLocalEdits(weekStart) {
  const ws = String(weekStart || "").trim();
  if (!ws || typeof localStorage === "undefined") return false;
  const dk = getScheduleLocalDirtyStorageKey(ws);
  return !!(dk && localStorage.getItem(dk) === "1");
}

/** Flush the cloud draft before leaving the week. Staff still see the last Publish. */
async function scheduleConfirmLeaveWeekIfDirty() {
  await flushScheduleWeekDraftToCloud();
  return true;
}

/**
 * Autosave the manager draft to `weekDraftSnapshots`. Staff keep seeing
 * `weekPublishedSnapshots` until Publish copies this draft over.
 */
async function saveScheduleWeekDraftToCloud(options = {}) {
  if (!scheduleUserCanManualEdit()) return;
  const silent = options.silent === true;
  if (_scheduleWeekDraftAutosaveInFlight) {
    _scheduleWeekDraftAutosaveQueued = true;
    return;
  }
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  if (!salonId) {
    if (!silent) ffScheduleAppToast("No salon selected.", 3500);
    return;
  }
  if (!_ffSchedHasActiveLocationForWrite()) {
    if (!silent) ffScheduleAppToast("Choose a location before saving this schedule.", 3500);
    return;
  }
  const weekRange = getWeekRange(scheduleState.schedulePreviewWeekStart);
  const weekStart = weekRange.startDate;
  const draft = scheduleState.schedulePreviewState.draft;
  const staffList = scheduleState.schedulePreviewState.staffList;
  if (!weekStart || !draft || !Array.isArray(staffList)) {
    if (!silent) ffScheduleAppToast("Schedule is still loading.", 3000);
    return;
  }
  _scheduleWeekDraftAutosaveInFlight = true;
  setScheduleSaveStatus("Saving", "busy");
  try {
    persistScheduleDraftOverrideFromState({ skipAutosave: true });
    const ref = getSchedulePublishDocRef();
    if (!ref) throw new Error("No schedule document reference.");
    const standByByDate =
      scheduleState.schedulePreviewState?.standByByDate && typeof scheduleState.schedulePreviewState.standByByDate === "object"
        ? cloneStandByMapSafe(scheduleState.schedulePreviewState.standByByDate)
        : {};
    scheduleState.scheduleSkipNextDraftSnapshotRefresh = true;
    scheduleState.scheduleSkipDraftRefreshUntil = Date.now() + 4000;
    await setDoc(
      ref,
      {
        locationId: _ffSchedActiveLocId() || null,
        weekDraftSnapshots: {
          [weekStart]: {
            savedAt: serverTimestamp(),
            days: serializeDraftDaysForStorage(draft),
            standByByDate,
          },
        },
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    clearScheduleLocalDirtyForCurrentUser(weekStart);
    setScheduleSaveStatus("Saved", "ok");
  } catch (e) {
    scheduleState.scheduleSkipNextDraftSnapshotRefresh = false;
    markScheduleLocalDirty(weekStart);
    console.error("[ScheduleUI] save week draft to cloud", e);
    setScheduleSaveStatus("Not saved", "error");
    ffScheduleAppToast("Could not save the schedule. Check connection.", 5000);
  } finally {
    _scheduleWeekDraftAutosaveInFlight = false;
    if (_scheduleWeekDraftAutosaveQueued) {
      _scheduleWeekDraftAutosaveQueued = false;
      queueScheduleWeekDraftAutosave();
    }
  }
}

/**
 * Stand-by was only persisted to localStorage until "Notify staff"; VIEW users read Firestore, so they always saw "Not set".
 * After saving stand-by in the modal, merge `standByByDate` into the manager draft. Staff see it after Publish.
 */
async function syncPublishedWeekStandByToCloud(weekStart) {
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  if (!salonId || !weekStart) return;
  if (scheduleState.schedulePublishedMap[weekStart] !== true) return;
  if (!scheduleUserCanManualEdit()) return;
  const ref = getSchedulePublishDocRef();
  if (!ref) return;
  const standByByDate =
    scheduleState.schedulePreviewState?.standByByDate && typeof scheduleState.schedulePreviewState.standByByDate === "object"
      ? cloneStandByMapSafe(scheduleState.schedulePreviewState.standByByDate)
      : {};
  try {
    await setDoc(
      ref,
      {
        locationId: _ffSchedActiveLocId() || null,
        weekDraftSnapshots: {
          [weekStart]: {
            savedAt: serverTimestamp(),
            standByByDate,
          },
        },
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    ffScheduleAppToast("Stand by saved. Publish to update the team.", 3500);
  } catch (e) {
    console.warn("[ScheduleUI] sync stand-by to cloud", e);
    ffScheduleAppToast("Could not save stand by. Check connection.", 4500);
  }
}

function updateScheduleUndoUi() {
  if (typeof window !== "undefined") window.ffUpdateScheduleUndoUi = updateScheduleUndoUi;
  const btn = document.getElementById("scheduleUndoBtn");
  if (!btn) return;
  const canEdit = scheduleUserCanManualEdit();
  const buildUi = !canEdit || scheduleState.schedulePreviewMode === "build";
  const canUndo = canEdit && buildUi && scheduleState.scheduleUndoStack.length > 0;
  btn.style.display = canEdit && buildUi ? "inline-flex" : "none";
  btn.disabled = !canUndo;
  btn.style.opacity = canUndo ? "1" : "0.4";
  btn.style.cursor = canUndo ? "pointer" : "default";
}

function cloneStandByMapSafe(map) {
  try {
    return JSON.parse(JSON.stringify(map && typeof map === "object" ? map : {}));
  } catch (_) {
    return {};
  }
}

function snapshotScheduleForUndo() {
  const draft = scheduleState.schedulePreviewState.draft;
  if (!draft) return null;
  return {
    days: serializeDraftDaysForStorage(draft),
    standByByDate: cloneStandByMapSafe(scheduleState.schedulePreviewState.standByByDate),
  };
}

function pushScheduleUndoSnapshot() {
  if (scheduleState.scheduleUndoSkip) return;
  try {
    const snap = snapshotScheduleForUndo();
    if (!snap) return;
    scheduleState.scheduleUndoStack.push(snap);
    if (scheduleState.scheduleUndoStack.length > 30) scheduleState.scheduleUndoStack.shift();
    updateScheduleUndoUi();
  } catch (e) {
    console.warn("[ScheduleUI] undo snapshot failed", e);
  }
}

function clearScheduleUndoStack() {
  scheduleState.scheduleUndoStack = [];
  updateScheduleUndoUi();
}

function undoScheduleLastEdit() {
  if (!scheduleUserCanManualEdit()) return;
  const snap = scheduleState.scheduleUndoStack.pop();
  if (!snap) {
    updateScheduleUndoUi();
    return;
  }
  const staffList = scheduleState.schedulePreviewState.staffList || [];
  const base = cloneScheduleDraft(scheduleState.schedulePreviewState.draft);
  const next = applyDraftDaysOverride(base, snap.days, staffList);
  scheduleState.schedulePreviewState.standByByDate = cloneStandByMapSafe(snap.standByByDate);
  scheduleState.scheduleUndoSkip = true;
  revalidateLocalDraft(next);
  scheduleState.scheduleUndoSkip = false;
  if (typeof renderScheduleSummary === "function") {
    renderScheduleSummary(
      scheduleState.schedulePreviewState.validation,
      scheduleState.schedulePreviewState.validation?.days || [],
    );
  }
  if (typeof renderScheduleBoard === "function") {
    renderScheduleBoard(
      scheduleState.schedulePreviewState.draft,
      scheduleState.schedulePreviewState.validation,
      scheduleState.schedulePreviewState.staffList,
    );
  }
  updateScheduleUndoUi();
}

let _publishedWeekNotifyTimer = null;

function queuePublishedWeekAutoNotify() {
  const weekRange = getWeekRange(scheduleState.schedulePreviewWeekStart);
  const key = weekRange.startDate;
  if (scheduleState.schedulePublishedMap[key] !== true) return;
  if (_publishedWeekNotifyTimer) clearTimeout(_publishedWeekNotifyTimer);
  _publishedWeekNotifyTimer = setTimeout(() => {
    _publishedWeekNotifyTimer = null;
    void notifyStaffScheduleChanges({ silent: true });
  }, 1800);
}

async function notifyStaffScheduleChanges(options = {}) {
  if (!scheduleUserCanManualEdit()) return;
  const silent = options.silent === true;
  const forceAll = options.forceAll === true;
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  if (!salonId) {
    if (!silent) ffScheduleAppToast("No salon selected.", 3500);
    return;
  }
  if (!_ffSchedHasActiveLocationForWrite()) {
    if (!silent) ffScheduleAppToast("Choose a location before notifying staff.", 3500);
    return;
  }
  const weekRange = getWeekRange(scheduleState.schedulePreviewWeekStart);
  const key = weekRange.startDate;
  if (!forceAll && scheduleState.schedulePublishedMap[key] !== true) {
    if (!silent) ffScheduleAppToast("Publish this week to staff before notifying about changes.", 4000);
    return;
  }
  const draft = scheduleState.schedulePreviewState.draft;
  const staffList = scheduleState.schedulePreviewState.staffList;
  if (!draft || !Array.isArray(staffList)) {
    if (!silent) ffScheduleAppToast("Schedule is still loading.", 3000);
    return;
  }
  const fpNew = computeFingerprintMapForDraft(draft, staffList);
  let fpOld = {};
  let cloudStandByMap = {};
  try {
    const snap = await getDoc(getSchedulePublishDocRef());
    const data = snap.exists() ? snap.data() : {};
    const sfp = data.staffShiftFingerprints && typeof data.staffShiftFingerprints === "object" ? data.staffShiftFingerprints : {};
    fpOld = sfp[key] && typeof sfp[key] === "object" ? sfp[key] : {};
    const wb = data.weekDraftSnapshots && data.weekDraftSnapshots[key];
    cloudStandByMap = normalizeStandByBlock(wb || {}, draft.days);
  } catch (_) {
    /* ignore */
  }
  const localStandByMap = normalizeStandByBlock(
    { standByByDate: scheduleState.schedulePreviewState?.standByByDate },
    draft.days,
  );
  const standByChanged = !standByMapsEqual(cloudStandByMap, localStandByMap);
  const allKeys = new Set([...Object.keys(fpNew), ...Object.keys(fpOld)]);
  const changed = [];
  if (forceAll) {
    (staffList || []).forEach((staff) => {
      const k = getScheduleStaffKey(staff);
      if (k) changed.push(k);
    });
  } else {
    for (const k of allKeys) {
      if (fpNew[k] !== fpOld[k]) changed.push(k);
    }
  }
  if (changed.length === 0 && !standByChanged) {
    if (!silent) ffScheduleAppToast("No shift changes detected since the last publish or notify.", 4000);
    return;
  }
  persistScheduleDraftOverrideFromState({ skipAutosave: true });
  const batch = writeBatch(db);
  const weeksRef = getSchedulePublishDocRef();
  if (!weeksRef) return;
  const locId = _ffSchedActiveLocId();
  for (const sid of changed) {
    const pingId = _ffSchedPerLocDocId(key, sid);
    if (!pingId) continue;
    const pingRef = doc(db, `salons/${salonId}/scheduleStaffChangePings/${pingId}`);
    batch.set(
      pingRef,
      {
        salonId,
        weekStart: key,
        staffId: sid,
        locationId: locId || null,
        pingAt: serverTimestamp(),
      },
      { merge: true },
    );
  }
  const standByByDate =
    scheduleState.schedulePreviewState?.standByByDate && typeof scheduleState.schedulePreviewState.standByByDate === "object"
      ? cloneStandByMapSafe(scheduleState.schedulePreviewState.standByByDate)
      : {};
  batch.set(
    weeksRef,
    {
      locationId: locId || null,
      lastChangeNotifyAt: serverTimestamp(),
      lastChangeNotifyWeekKey: key,
      lastChangeNotifyLocationId: locId || null,
      lastChangeNotifyStaffIds: changed.length
        ? changed
        : (staffList || []).map((staff) => getScheduleStaffKey(staff)).filter(Boolean),
      staffShiftFingerprints: { [key]: fpNew },
      weekDraftSnapshots: {
        [key]: {
          savedAt: serverTimestamp(),
          days: serializeDraftDaysForStorage(draft),
          standByByDate,
        },
      },
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  try {
    await batch.commit();
    const wrAfter = getWeekRange(scheduleState.schedulePreviewWeekStart);
    clearSharedScheduleDraftOverrideForWeek(wrAfter);
    clearScheduleLocalDirtyForCurrentUser(key);
    if (!silent) {
      if (forceAll) {
        ffScheduleAppToast("Published — the team was notified.", 4500);
      } else if (changed.length === 0 && standByChanged) {
        ffScheduleAppToast("Stand by updated for this week.", 4000);
      } else {
        ffScheduleAppToast(`Team notified (${changed.length}).`, 4000);
      }
    }
    await loadScheduleWeekPingMap(key);
    if (
      scheduleState.schedulePreviewState.draft &&
      scheduleUserCanManualEdit() &&
      scheduleState.schedulePreviewMode === "build" &&
      document.getElementById("scheduleScreen")?.style.display !== "none"
    ) {
      renderScheduleBoard(
        scheduleState.schedulePreviewState.draft,
        scheduleState.schedulePreviewState.validation,
        scheduleState.schedulePreviewState.staffList,
      );
    }
  } catch (e) {
    console.error("[ScheduleUI] notifyStaffScheduleChanges", e);
    ffScheduleAppToast(e?.message || "Could not send notifications.", 4000);
  }
}

function addManualOffForStaffDay(draft, dateKey, staffKey) {
  const day = findDraftDay(draft, dateKey);
  if (!day || !staffKey) return;
  const set = new Set(Array.isArray(day.manualOffStaffIds) ? day.manualOffStaffIds : []);
  set.add(staffKey);
  day.manualOffStaffIds = [...set];
}

function removeManualOffForStaffDay(draft, dateKey, staffKey) {
  const day = findDraftDay(draft, dateKey);
  if (!day || !staffKey) return;
  day.manualOffStaffIds = (Array.isArray(day.manualOffStaffIds) ? day.manualOffStaffIds : []).filter((id) => id !== staffKey);
}

const SCHEDULE_MANUAL_OFF_STORAGE_VERSION = 1;
/** Storage key segment — do not bump unless intentionally migrating to a new localStorage namespace. */
const SCHEDULE_DRAFT_OVERRIDE_KEY_VER = 1;
/** Payload `v` inside JSON — bump when adding fields (e.g. stand-by per day). */
const SCHEDULE_DRAFT_OVERRIDE_PAYLOAD_VER = 4;
/** Per-location cache of the most recently auto-built week draft. Written
 *  after every successful `generateWeeklySchedule` so that cross-location
 *  conflict detection can see a branch's just-built (not yet saved/notified)
 *  shifts when the owner switches to another branch and hits Build there. */
const SCHEDULE_LAST_BUILD_CACHE_VER = 1;

function getSchedulePreviewSalonStorageKey() {
  const s = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  const loc = _ffSchedActiveLocId();
  const base = s || "_local";
  if (loc) return `${base}__${loc}`;
  if (_ffSchedUserHasMultipleLocations()) return `${base}__noloc`;
  return base;
}

function getScheduleManualOffStorageKey(weekRange) {
  if (!weekRange?.startDate || !weekRange?.endDate) return null;
  const salon = getSchedulePreviewSalonStorageKey();
  return `ff_schedule_manual_off_v${SCHEDULE_MANUAL_OFF_STORAGE_VERSION}_${salon}_${weekRange.startDate}_${weekRange.endDate}`;
}

function getScheduleDraftOverrideStorageKey(weekRange) {
  if (!weekRange?.startDate || !weekRange?.endDate) return null;
  const salon = getSchedulePreviewSalonStorageKey();
  return `ff_schedule_draft_override_v${SCHEDULE_DRAFT_OVERRIDE_KEY_VER}_${salon}_${weekRange.startDate}_${weekRange.endDate}`;
}

/** Per logged-in staff: "I have unsaved local edits" — avoids managers seeing stale shared localStorage instead of Firestore cloud. */
function getScheduleLocalDirtyStorageKey(weekStart) {
  if (!weekStart) return null;
  const salon = getSchedulePreviewSalonStorageKey();
  const sid = getAuthedStaffIdForSchedule() || "_";
  return `ff_schedule_local_dirty_v1_${salon}_${weekStart}_${sid}`;
}

function clearSharedScheduleDraftOverrideForWeek(weekRange) {
  const k = getScheduleDraftOverrideStorageKey(weekRange);
  if (k && typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(k);
    } catch (_) {
      /* ignore */
    }
  }
}

function clearScheduleLocalDirtyForCurrentUser(weekStart) {
  const dk = getScheduleLocalDirtyStorageKey(weekStart);
  if (dk && typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(dk);
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * Build a fresh generated schedule for THIS week. Autosaves the manager draft.
 * Staff keep the last published copy until Publish.
 */
async function runDiscardSavedScheduleWeekDraftAndReload() {
  if (!scheduleUserCanManualEdit()) return;
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  if (!salonId) {
    ffScheduleAppToast("No salon selected.", 3500);
    return;
  }
  const weekRange = getWeekRange(scheduleState.schedulePreviewWeekStart);
  const weekStart = weekRange.startDate;
  if (!weekStart) return;
  clearSharedScheduleDraftOverrideForWeek(weekRange);
  const manualKey = getScheduleManualOffStorageKey(weekRange);
  if (manualKey && typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(manualKey);
    } catch (_) {
      /* ignore */
    }
  }
  await refreshSchedulePreview({ ignoreSavedDrafts: true, persistFreshLocalDraft: true });
  markScheduleLocalDirty(weekStart);
  queueScheduleWeekDraftAutosave();
  ffScheduleAppToast("New schedule built for this week. Publish when the team should see it.", 5000);
}

async function discardSavedScheduleWeekDraftAndReload() {
  if (!scheduleUserCanManualEdit()) return;
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  if (!salonId) {
    ffScheduleAppToast("No salon selected.", 3500);
    return;
  }
  const weekRange = getWeekRange(scheduleState.schedulePreviewWeekStart);
  const weekStart = weekRange.startDate;
  if (!weekStart) return;
  const el = ensureScheduleRebuildConfirmModal();
  const weekLabel = formatWeekLabel(weekRange);
  const locName = _ffActiveLocationNameForIcs() || "this branch";
  const published = scheduleState.schedulePublishedMap[weekStart] === true;
  const titleEl = document.getElementById("scheduleRebuildConfirmTitle");
  const bodyEl = document.getElementById("scheduleRebuildConfirmBody");
  if (titleEl) titleEl.textContent = "Are you sure you want to Build this week?";
  const okEl = document.getElementById("scheduleRebuildConfirmOk");
  if (okEl) okEl.textContent = "Yes, Build this week";
  if (bodyEl) {
    const scopeLine =
      `This builds a <strong>new auto-generated schedule</strong> for <strong>this week only</strong> (${escapeScheduleHtml(weekLabel)}) at <strong>${escapeScheduleHtml(locName)}</strong>. ` +
      `Other weeks and other branches stay exactly as they are.`;
    const lossLine = published
      ? `<br/><br/><span style="color:#b91c1c;font-weight:700;">This week is already published.</span> ` +
        `Staff keep seeing the current salon schedule until you click <strong>Save</strong>. ` +
        `After Save, this new Build replaces what they see.`
      : `<br/><br/>The current schedule stays in the salon until you click <strong>Save</strong>. Cancel keeps everything as it is.`;
    bodyEl.innerHTML = scopeLine + lossLine;
  }
  el.style.display = "flex";
}

/** Load saved Marked OFF map for this salon + week (survives page refresh). */
function loadScheduleManualOffOverrides(weekRange) {
  const key = getScheduleManualOffStorageKey(weekRange);
  if (!key || typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const byDate = parsed?.manualOffByDate;
    return byDate && typeof byDate === "object" ? byDate : {};
  } catch (_) {
    return {};
  }
}

function mergeManualOffOverridesIntoDraft(draft, overrides, staffList) {
  if (!draft?.days?.length || !overrides || typeof overrides !== "object") return draft;
  if (Object.keys(overrides).length === 0) return draft;
  const validKeys = new Set((staffList || []).map((s) => getScheduleStaffKey(s)).filter(Boolean));
  return {
    ...draft,
    days: draft.days.map((day) => {
      const saved = overrides[day.date];
      if (!Array.isArray(saved) || saved.length === 0) return day;
      const assigned = new Set(
        (day.assignments || []).map((a) => String(a.staffId || a.uid || "").trim()).filter(Boolean),
      );
      const manualOffStaffIds = saved.filter((id) => validKeys.has(id) && !assigned.has(id));
      return { ...day, manualOffStaffIds };
    }),
  };
}

function loadScheduleDraftOverridePayload(weekRange) {
  const key = getScheduleDraftOverrideStorageKey(weekRange);
  if (!key || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.v !== 1 && parsed?.v !== 2 && parsed?.v !== 3 && parsed?.v !== SCHEDULE_DRAFT_OVERRIDE_PAYLOAD_VER)
      return null;
    const days = Array.isArray(parsed.days) ? parsed.days : null;
    const standByStaffId = typeof parsed.standByStaffId === "string" ? parsed.standByStaffId.trim() : "";
    const standByByDate =
      parsed.standByByDate && typeof parsed.standByByDate === "object"
        ? cloneStandByMapSafe(parsed.standByByDate)
        : {};
    return {
      days: days && days.length ? days : null,
      standByStaffId,
      standByByDate,
    };
  } catch (_) {
    return null;
  }
}

function loadScheduleDraftDaysOverride(weekRange) {
  const p = loadScheduleDraftOverridePayload(weekRange);
  return p?.days || null;
}

function serializeDraftDaysForStorage(draft) {
  return (Array.isArray(draft?.days) ? draft.days : []).map((day) => ({
    date: day.date,
    assignments: (Array.isArray(day.assignments) ? day.assignments : []).map((a) => ({ ...a })),
    manualOffStaffIds: Array.isArray(day.manualOffStaffIds) ? [...day.manualOffStaffIds] : [],
    cellNotesByStaffId: cloneCellNotesByStaffId(day.cellNotesByStaffId),
  }));
}

function applyDraftDaysOverride(draft, savedDays, staffList) {
  if (!draft?.days?.length || !Array.isArray(savedDays) || !savedDays.length) return draft;
  const validKeys = new Set((staffList || []).map((s) => getScheduleStaffKey(s)).filter(Boolean));
  const byDate = new Map(savedDays.map((d) => [d.date, d]));
  return {
    ...draft,
    days: draft.days.map((day) => {
      const o = byDate.get(day.date);
      if (!o) return day;
      const assignments = (Array.isArray(o.assignments) ? o.assignments : [])
        .filter((a) => validKeys.has(String(a.staffId || a.uid || "").trim()))
        .map((a) => ({ ...a }));
      const manualOffStaffIds = (Array.isArray(o.manualOffStaffIds) ? o.manualOffStaffIds : []).filter((id) =>
        validKeys.has(id),
      );
      const cellNotesByStaffId = {};
      const rawNotes = o.cellNotesByStaffId && typeof o.cellNotesByStaffId === "object" ? o.cellNotesByStaffId : {};
      Object.keys(rawNotes).forEach((id) => {
        if (!validKeys.has(id)) return;
        const note = normalizeCellNote(rawNotes[id]);
        if (note) cellNotesByStaffId[id] = note;
      });
      return { ...day, assignments, manualOffStaffIds, cellNotesByStaffId };
    }),
  };
}

/** Local cache only. Server snapshot is the source of truth — dirty is set only if a cloud write fails. */
function persistScheduleDraftOverrideFromState(options = {}) {
  const weekRange = scheduleState.schedulePreviewState.weekRange;
  const draft = scheduleState.schedulePreviewState.draft;
  const key = getScheduleDraftOverrideStorageKey(weekRange);
  const manualKey = getScheduleManualOffStorageKey(weekRange);
  if (!key || !draft?.days || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        v: SCHEDULE_DRAFT_OVERRIDE_PAYLOAD_VER,
        days: serializeDraftDaysForStorage(draft),
        standByByDate:
          scheduleState.schedulePreviewState.standByByDate && typeof scheduleState.schedulePreviewState.standByByDate === "object"
            ? cloneStandByMapSafe(scheduleState.schedulePreviewState.standByByDate)
            : {},
      }),
    );
    if (manualKey) localStorage.removeItem(manualKey);
  } catch (e) {
    console.warn("[ScheduleUI] persist draft override", e);
  }
  if (options.skipAutosave !== true && scheduleUserCanManualEdit()) {
    queueScheduleWeekDraftAutosave();
  }
}

/** @deprecated use persistScheduleDraftOverrideFromState */
function persistScheduleManualOffFromState() {
  persistScheduleDraftOverrideFromState();
}

function markScheduleDayAsOffFromModal() {
  if (!scheduleState.scheduleShiftEditPayload || !scheduleState.schedulePreviewState.draft) return;
  const { staffKey, dateKey, isNew } = scheduleState.scheduleShiftEditPayload;
  if (!isNew || !scheduleUserCanManualEdit()) return;
  const staff = getStaffByScheduleKey(scheduleState.schedulePreviewState.staffList, staffKey);
  if (!staff) return;
  const bs = getBusinessStatusForDate(dateKey);
  if (bs.isOpen === false) {
    window.alert("This day is closed for the business.");
    return;
  }
  let draft = cloneScheduleDraft(scheduleState.schedulePreviewState.draft);
  const day = findDraftDay(draft, dateKey);
  if (!day) return;
  if ((day.assignments || []).some((a) => String(a.staffId || a.uid || "").trim() === staffKey)) {
    window.alert("This cell already has a shift. Edit or remove it first.");
    return;
  }
  addManualOffForStaffDay(draft, dateKey, staffKey);
  const noteEl = typeof document !== "undefined" ? document.getElementById("scheduleShiftEditNote") : null;
  if (noteEl) setCellNoteForStaffDay(draft, dateKey, staffKey, noteEl.value);
  draft = applyBusinessSettingsToDraft(draft);
  revalidateLocalDraft(draft);
  renderScheduleSummary(scheduleState.schedulePreviewState.validation, scheduleState.schedulePreviewState.validation?.days || []);
  renderScheduleBoard(scheduleState.schedulePreviewState.draft, scheduleState.schedulePreviewState.validation, scheduleState.schedulePreviewState.staffList);
  closeScheduleShiftEdit();
}

/** Full-day approved block (vacation / schedule_change / day off) — not late_start / early_leave partial windows. */
function staffDayBlockedByApprovedInbox(staff, dateKey) {
  const requests = Array.isArray(scheduleState.schedulePreviewState.requests) ? scheduleState.schedulePreviewState.requests : [];
  const bh =
    scheduleState.schedulePreviewState.businessHours && typeof scheduleState.schedulePreviewState.businessHours === "object"
      ? scheduleState.schedulePreviewState.businessHours
      : undefined;
  const av = getEffectiveAvailabilityForDate(staff, requests, dateKey, { businessHours: bh });
  if (!av || !av.hasApprovedOverride) return false;
  const hasBlockingOverride = Array.isArray(av.overrides) && av.overrides.some((o) => o && o.mode === "unavailable");
  return Boolean(av.isAvailable === false && hasBlockingOverride);
}


export {
  SCHEDULE_DRAFT_OVERRIDE_KEY_VER,
  SCHEDULE_DRAFT_OVERRIDE_PAYLOAD_VER,
  SCHEDULE_LAST_BUILD_CACHE_VER,
  SCHEDULE_MANUAL_OFF_STORAGE_VERSION,
  addManualOffForStaffDay,
  applyDraftDaysOverride,
  buildAssignmentLookup,
  clearScheduleLocalDirtyForCurrentUser,
  clearScheduleUndoStack,
  clearSharedScheduleDraftOverrideForWeek,
  cloneCellNotesByStaffId,
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
  setScheduleSaveStatus,
  scheduleWeekHasUnsavedLocalEdits,
  scheduleConfirmLeaveWeekIfDirty,
  queueScheduleWeekDraftAutosave,
  flushScheduleWeekDraftToCloud,
  persistStaffShiftFingerprintsForWeek,
  pushScheduleUndoSnapshot,
  removeManualOffForStaffDay,
  runDiscardSavedScheduleWeekDraftAndReload,
  saveScheduleWeekDraftToCloud,
  serializeDraftDaysForStorage,
  setCellNoteForStaffDay,
  simpleHashString,
  staffDayBlockedByApprovedInbox,
  syncPublishedWeekStandByToCloud,
  undoScheduleLastEdit,
  updateScheduleUndoUi,
};
