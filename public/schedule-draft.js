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
import { generateWeeklySchedule } from "./schedule-generator.js?v=20260615_default_schedule_source";
import { getEffectiveAvailabilityForDate } from "./schedule-availability.js?v=20260615_default_schedule_source";
import { scheduleState } from "./schedule-state.js?v=20260702_schedule_state";
import {
  _ffSchedActiveLocId,
  _ffSchedPerLocDocId,
  ffScheduleAppToast,
  getAuthedStaffIdForSchedule,
  loadScheduleWeekPingMap,
} from "./schedule-ack.js?v=20260702_schedule_ack";
import { getSchedulePublishDocRef } from "./schedule-cloud.js?v=20260702_schedule_cloud";
import {
  formatWeekLabel,
  getScheduleStaffKey,
  getWeekRange,
} from "./schedule-format.js?v=20260806_sched_12h_picker";
import {
  closeScheduleShiftEdit,
  ensureScheduleRebuildConfirmModal,
  escapeScheduleHtml,
  scheduleUserCanManualEdit,
} from "./schedule-shift-edit.js?v=20260806_sched_12h_picker";

// -- injected via initScheduleDraft() (wired in schedule-ui.js) --
let _ffActiveLocationNameForIcs;
let applyBusinessSettingsToDraft;
let cloneStandByByDateMap;
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
    cloneStandByByDateMap,
    getBusinessStatusForDate,
    getStaffByScheduleKey,
    normalizeStandByBlock,
    refreshSchedulePreview,
    renderScheduleBoard,
    renderScheduleSummary,
    revalidateLocalDraft,
    standByMapsEqual,
  } = deps);
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

function cloneScheduleDraft(draft) {
  return {
    ...draft,
    days: (Array.isArray(draft?.days) ? draft.days : []).map((day) => ({
      ...day,
      manualOffStaffIds: Array.isArray(day.manualOffStaffIds) ? [...day.manualOffStaffIds] : [],
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
  const fp = computeFingerprintMapForDraft(draft, staffList);
  const ref = getSchedulePublishDocRef();
  if (!ref) return;
  const standByByDate =
    scheduleState.schedulePreviewState?.standByByDate && typeof scheduleState.schedulePreviewState.standByByDate === "object"
      ? cloneStandByByDateMap(scheduleState.schedulePreviewState.standByByDate)
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

/**
 * Explicit "Save" — writes the current week draft to the CLOUD snapshot
 * (`weekDraftSnapshots[weekStart]`) without publishing it to staff. This makes
 * edits survive a page refresh reliably (loaded from Firestore, not only the
 * device's localStorage) and syncs the draft to the manager's other devices.
 * Staff still can't see the week until it is Published.
 */
async function saveScheduleWeekDraftToCloud() {
  if (!scheduleUserCanManualEdit()) return;
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  if (!salonId) {
    ffScheduleAppToast("No salon selected.", 3500);
    return;
  }
  const weekRange = getWeekRange(scheduleState.schedulePreviewWeekStart);
  const weekStart = weekRange.startDate;
  const draft = scheduleState.schedulePreviewState.draft;
  const staffList = scheduleState.schedulePreviewState.staffList;
  if (!weekStart || !draft || !Array.isArray(staffList)) {
    ffScheduleAppToast("Schedule is still loading.", 3000);
    return;
  }
  const btn = document.getElementById("scheduleSaveDraftBtn");
  const prevLabel = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = "0.7";
    btn.style.cursor = "default";
    btn.textContent = "Saving…";
  }
  try {
    // Keep this device's local override in sync with what we push to cloud.
    persistScheduleDraftOverrideFromState();
    const ref = getSchedulePublishDocRef();
    if (!ref) throw new Error("No schedule document reference.");
    const standByByDate =
      scheduleState.schedulePreviewState?.standByByDate && typeof scheduleState.schedulePreviewState.standByByDate === "object"
        ? cloneStandByByDateMap(scheduleState.schedulePreviewState.standByByDate)
        : {};
    // Write ONLY the draft snapshot — intentionally NOT the staffShiftFingerprints,
    // so the "Notify staff of changes" baseline (set at the last Publish) is
    // preserved and still detects edits made after publishing.
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
    ffScheduleAppToast("Saved. This draft will survive refresh and sync to your other devices.", 4500);
  } catch (e) {
    console.error("[ScheduleUI] save week draft to cloud", e);
    ffScheduleAppToast(e?.message || "Could not save the draft. Check connection or Firestore rules.", 5000);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = "1";
      btn.style.cursor = "pointer";
      btn.textContent = prevLabel || "Save";
    }
  }
}

/**
 * Stand-by was only persisted to localStorage until "Notify staff"; VIEW users read Firestore, so they always saw "Not set".
 * After saving stand-by in the modal, merge `standByByDate` into the published week snapshot so everyone sees it without a separate notify.
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
      ? cloneStandByByDateMap(scheduleState.schedulePreviewState.standByByDate)
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
    ffScheduleAppToast("Stand by saved — visible to all staff.", 3500);
  } catch (e) {
    console.warn("[ScheduleUI] sync stand-by to cloud", e);
    ffScheduleAppToast(e?.message || "Could not save stand by to the cloud.", 4500);
  }
}

async function notifyStaffScheduleChanges() {
  if (!scheduleUserCanManualEdit()) return;
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  if (!salonId) {
    ffScheduleAppToast("No salon selected.", 3500);
    return;
  }
  const weekRange = getWeekRange(scheduleState.schedulePreviewWeekStart);
  const key = weekRange.startDate;
  if (scheduleState.schedulePublishedMap[key] !== true) {
    ffScheduleAppToast("Publish this week to staff before notifying about changes.", 4000);
    return;
  }
  const draft = scheduleState.schedulePreviewState.draft;
  const staffList = scheduleState.schedulePreviewState.staffList;
  if (!draft || !Array.isArray(staffList)) {
    ffScheduleAppToast("Schedule is still loading.", 3000);
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
  for (const k of allKeys) {
    if (fpNew[k] !== fpOld[k]) changed.push(k);
  }
  if (changed.length === 0 && !standByChanged) {
    ffScheduleAppToast("No shift changes detected since the last publish or notify.", 4000);
    return;
  }
  persistScheduleDraftOverrideFromState();
  const batch = writeBatch(db);
  const weeksRef = getSchedulePublishDocRef();
  if (!weeksRef) return;
  const locId = _ffSchedActiveLocId();
  for (const sid of changed) {
    const pingRef = doc(db, `salons/${salonId}/scheduleStaffChangePings/${_ffSchedPerLocDocId(key, sid)}`);
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
      ? cloneStandByByDateMap(scheduleState.schedulePreviewState.standByByDate)
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
    if (changed.length === 0 && standByChanged) {
      ffScheduleAppToast("Stand by updated for this week (saved to the cloud).", 4000);
    } else {
      ffScheduleAppToast(`Notified ${changed.length} staff member(s) with updated shifts.`, 4500);
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
  // Include active location so different branches never share the same
  // localStorage bucket for draft overrides / manual-off / dirty markers.
  return loc ? `${base}__${loc}` : base;
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
 * Clears local draft + Firestore week snapshot so the next load uses fresh generateWeeklySchedule output.
 * (Deleting only localStorage is not enough — published weeks also load weekDraftSnapshots from Firestore.)
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
  clearScheduleLocalDirtyForCurrentUser(weekStart);
  const manualKey = getScheduleManualOffStorageKey(weekRange);
  if (manualKey && typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(manualKey);
    } catch (_) {
      /* ignore */
    }
  }
  const ref = getSchedulePublishDocRef();
  if (ref) {
    try {
      await updateDoc(ref, {
        [`weekDraftSnapshots.${weekStart}`]: deleteField(),
        [`staffShiftFingerprints.${weekStart}`]: deleteField(),
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn("[ScheduleUI] discard week draft snapshot", e);
      ffScheduleAppToast(
        e?.message || "Could not clear the cloud draft. Check connection or Firestore rules.",
        5000,
      );
    }
  }
  await refreshSchedulePreview({ ignoreSavedDrafts: true, persistFreshLocalDraft: true });
  ffScheduleAppToast("Schedule rebuilt from rules for this week.", 4000);
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
  if (titleEl) titleEl.textContent = `Rebuild only ${weekLabel}?`;
  if (bodyEl) {
    const scopeLine =
      `This affects <strong>only this week</strong> (${escapeScheduleHtml(weekLabel)}) at <strong>${escapeScheduleHtml(locName)}</strong>. ` +
      `No other week and no other branch is touched.`;
    const lossLine = published
      ? `<br/><br/><span style="color:#b91c1c;font-weight:700;">Warning: this week is already published.</span> ` +
        `Rebuilding will replace the schedule your staff currently see with a fresh auto-generated one. ` +
        `You'll need to review and Save / re-publish.`
      : `<br/><br/>Your saved edits for this week will be replaced by a new schedule generated from your coverage rules.`;
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
        ? cloneStandByByDateMap(parsed.standByByDate)
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
      return { ...day, assignments, manualOffStaffIds };
    }),
  };
}

/** Full week (shifts + OFF) after local edits — survives refresh on this browser. */
function persistScheduleDraftOverrideFromState() {
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
            ? cloneStandByByDateMap(scheduleState.schedulePreviewState.standByByDate)
            : {},
      }),
    );
    if (manualKey) localStorage.removeItem(manualKey);
    if (scheduleUserCanManualEdit()) {
      const dk = getScheduleLocalDirtyStorageKey(weekRange.startDate);
      if (dk) localStorage.setItem(dk, "1");
    }
  } catch (e) {
    console.warn("[ScheduleUI] persist draft override", e);
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
};
