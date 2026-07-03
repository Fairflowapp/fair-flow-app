// schedule-cloud.js
// Schedule — publish document access, saved week snapshots, cross-location
// busy-load helpers, publish listeners/toggle, and unpublished placeholder UI.
// Extracted verbatim from schedule-ui.js (Phase 4 of the schedule-ui split).
// Storage constants and persistence helpers still live in schedule-ui.js for
// now and are injected via initScheduleCloud() after those constants are
// initialized.

import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
  serverTimestamp,
  deleteField,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { parseScheduleTimeToMinutes } from "./schedule-helpers.js?v=20260420_per_loc_no_default";
import { scheduleState } from "./schedule-state.js?v=20260702_schedule_state";
import {
  _ffSchedActiveLocId,
  _ffSchedPublishDocId,
  ffScheduleAppToast,
  ffScheduleStaffBroadcastToast,
  getAuthedStaffIdForSchedule,
  updateScheduleWeekAckStrip,
} from "./schedule-ack.js?v=20260702_schedule_ack";
import {
  formatWeekLabel,
  getWeekRange,
} from "./schedule-format.js?v=20260702_schedule_format";
import {
  escapeScheduleHtml,
  getScheduleAccessContext,
  scheduleUserCanManualEdit,
} from "./schedule-shift-edit.js?v=20260702_schedule_shift_edit";

// -- injected via initScheduleCloud() (wired in schedule-ui.js after storage constants initialize) --
let SCHEDULE_DRAFT_OVERRIDE_KEY_VER;
let SCHEDULE_DRAFT_OVERRIDE_PAYLOAD_VER;
let SCHEDULE_LAST_BUILD_CACHE_VER;
let clearScheduleLocalDirtyForCurrentUser;
let clearSharedScheduleDraftOverrideForWeek;
let cloneStandByByDateMap;
let loadScheduleDraftOverridePayload;
let persistStaffShiftFingerprintsForWeek;
let refreshSchedulePreview;
let serializeDraftDaysForStorage;

export function initScheduleCloud(deps) {
  ({
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
  } = deps);
}

function getSchedulePublishDocRef() {
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  if (!salonId) return null;
  return doc(db, `salons/${salonId}/schedulePublish/${_ffSchedPublishDocId()}`);
}

/** Saved by managers on Notify / publish so all devices see the same shifts (not only localStorage). */
async function loadWeekDraftSnapshotBlockFromPublishDoc(weekStart) {
  const ref = getSchedulePublishDocRef();
  if (!ref || !weekStart) return { days: null, standByByDate: {}, standByStaffId: "" };
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return { days: null, standByByDate: {}, standByStaffId: "" };
    const data = snap.data();
    const block = data.weekDraftSnapshots && data.weekDraftSnapshots[weekStart];
    const days = block && Array.isArray(block.days) && block.days.length ? block.days : null;
    const standByByDate =
      block?.standByByDate && typeof block.standByByDate === "object"
        ? cloneStandByByDateMap(block.standByByDate)
        : {};
    const standByStaffId = typeof block?.standByStaffId === "string" ? block.standByStaffId.trim() : "";
    return { days, standByByDate, standByStaffId };
  } catch (e) {
    console.warn("[ScheduleUI] load weekDraftSnapshots", e);
    return { days: null, standByByDate: {}, standByStaffId: "" };
  }
}

/**
 * Load draft days for a specific (non-active) location's weekDraftSnapshots
 * block. Used by the cross-location busy map so Build Schedule in branch B
 * knows which shifts branch A already has for the same staff + same week.
 */
async function loadOtherLocationWeekDraftDays(locationId, weekStart) {
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  if (!salonId || !locationId || !weekStart) return null;
  try {
    const ref = doc(db, `salons/${salonId}/schedulePublish/weeks_${locationId}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    const block = data.weekDraftSnapshots && data.weekDraftSnapshots[weekStart];
    const days = block && Array.isArray(block.days) && block.days.length ? block.days : null;
    return days;
  } catch (e) {
    console.warn("[ScheduleUI] load other-location weekDraftSnapshots", e);
    return null;
  }
}

/** Per-location cache key for the LAST auto-built draft (not user-edited). */
function getScheduleLastBuildCacheStorageKey(locationId, weekRange) {
  if (!weekRange?.startDate || !weekRange?.endDate) return null;
  const salonBase = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim() || "_local";
  const locPart = locationId ? `__${locationId}` : "";
  return `ff_schedule_last_build_v${SCHEDULE_LAST_BUILD_CACHE_VER}_${salonBase}${locPart}_${weekRange.startDate}_${weekRange.endDate}`;
}

/** Persist the just-built draft for the active location. Cross-location
 *  conflict detection reads this cache (plus the regular override cache
 *  + cloud) when another location is rebuilt. Silent on storage errors. */
function saveScheduleLastBuildCacheForActiveLocation(weekRange, draft) {
  try {
    if (typeof localStorage === "undefined") return;
    const locId = _ffSchedActiveLocId();
    const key = getScheduleLastBuildCacheStorageKey(locId, weekRange);
    if (!key) return;
    const days = serializeDraftDaysForStorage(draft);
    if (!Array.isArray(days) || days.length === 0) return;
    const payload = { v: SCHEDULE_LAST_BUILD_CACHE_VER, savedAt: Date.now(), days };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (_) { /* storage full / disabled — ignore */ }
}

/** Read a different location's last-built cache (see above). */
function loadOtherLocationLastBuildCache(locationId, weekRange) {
  if (!locationId || typeof localStorage === "undefined") return null;
  const key = getScheduleLastBuildCacheStorageKey(locationId, weekRange);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.v !== SCHEDULE_LAST_BUILD_CACHE_VER) return null;
    const days = Array.isArray(parsed.days) ? parsed.days : null;
    return days && days.length ? days : null;
  } catch (_) { return null; }
}

/**
 * Same idea as `loadScheduleDraftOverridePayload` but for a DIFFERENT
 * location's localStorage bucket. Owners who edit several branches on
 * the same device keep their in-progress drafts per-location in
 * localStorage until they press Notify/Publish. We surface those drafts
 * too so cross-location conflict detection is correct even before the
 * cloud snapshot is written.
 */
function loadOtherLocationLocalDraftDays(locationId, weekRange) {
  if (!locationId || !weekRange?.startDate || !weekRange?.endDate || typeof localStorage === "undefined") return null;
  const salonBase = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim() || "_local";
  const salonKey = `${salonBase}__${locationId}`;
  const storageKey = `ff_schedule_draft_override_v${SCHEDULE_DRAFT_OVERRIDE_KEY_VER}_${salonKey}_${weekRange.startDate}_${weekRange.endDate}`;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.v !== 1 && parsed?.v !== 2 && parsed?.v !== 3 && parsed?.v !== SCHEDULE_DRAFT_OVERRIDE_PAYLOAD_VER) return null;
    const days = Array.isArray(parsed.days) ? parsed.days : null;
    return days && days.length ? days : null;
  } catch (_) {
    return null;
  }
}

/**
 * Build a cross-location busy map for a week:
 *   { [staffKey]: { [dateKey]: [{ startMin, endMin }, ...] } }
 *
 * Busy windows come from every OTHER location's current week draft.
 * localStorage overrides (in-progress edits on this device) take priority
 * over the cloud snapshot so the most recent state wins. The active
 * location itself is excluded — the generator is the one building that
 * location's shifts right now.
 *
 * This is what lets Build Schedule skip a staff member who is already
 * booked for overlapping hours in a different branch on the same day.
 */
async function loadCrossLocationBusyForWeek(weekRange) {
  try {
    if (!weekRange?.startDate) return null;
    const activeLoc = _ffSchedActiveLocId();
    const allLocs = (typeof window !== "undefined" && typeof window.ffGetActiveLocations === "function")
      ? (window.ffGetActiveLocations() || [])
      : [];
    const otherIds = allLocs
      .map((l) => (l && l.id ? String(l.id) : ""))
      .filter((id) => id && id !== activeLoc);
    if (otherIds.length === 0) return null;

    // Priority: user-edited override (hand-tweaked) > last auto-built cache
    // (freshly generated but not saved as override) > cloud publish-doc
    // snapshot (written when a manager presses Notify). Highest-priority
    // source that produces days wins. This lets cross-location detection
    // see the current branch's latest draft even before it's saved.
    const perLocDays = await Promise.all(otherIds.map(async (locId) => {
      const override = loadOtherLocationLocalDraftDays(locId, weekRange);
      if (Array.isArray(override) && override.length > 0) return { locId, days: override };
      const lastBuild = loadOtherLocationLastBuildCache(locId, weekRange);
      if (Array.isArray(lastBuild) && lastBuild.length > 0) return { locId, days: lastBuild };
      const cloud = await loadOtherLocationWeekDraftDays(locId, weekRange.startDate);
      return { locId, days: Array.isArray(cloud) ? cloud : null };
    }));

    const busy = {};
    const addBusy = (key, dateKey, startMin, endMin) => {
      if (!key || !dateKey) return;
      if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) return;
      if (!busy[key]) busy[key] = {};
      if (!busy[key][dateKey]) busy[key][dateKey] = [];
      busy[key][dateKey].push({ startMin, endMin });
    };

    perLocDays.forEach(({ days }) => {
      if (!Array.isArray(days)) return;
      days.forEach((day) => {
        const dateKey = String(day?.date || "").trim();
        if (!dateKey) return;
        const assignments = Array.isArray(day?.assignments) ? day.assignments : [];
        assignments.forEach((a) => {
          if (!a) return;
          const s = parseScheduleTimeToMinutes(a.startTime);
          const e = parseScheduleTimeToMinutes(a.endTime);
          if (s == null || e == null || e <= s) return;
          // Register under BOTH staffId and uid so the generator can look the
          // same shift up by either identity (its internal keys differ per
          // staff depending on whether they were invited / have a firebase uid).
          const sid = String(a.staffId || "").trim();
          const uid = String(a.uid || "").trim();
          if (sid) addBusy(sid, dateKey, s, e);
          if (uid && uid !== sid) addBusy(uid, dateKey, s, e);
        });
      });
    });

    return Object.keys(busy).length > 0 ? busy : null;
  } catch (e) {
    console.warn("[ScheduleUI] loadCrossLocationBusyForWeek failed", e);
    return null;
  }
}

/**
 * Load THIS user's own shifts across every OTHER active location for a week,
 * so the unified "My shifts" view can render all their shifts in one row
 * regardless of which branch is currently active. Same priority order as
 * cross-location busy (override > last-build cache > cloud snapshot).
 *
 * Returns a Map<dateKey, Array<{ locationId, locationName, startTime,
 * endTime, lunchBreakEnabled, lunchBreakStart, lunchBreakEnd }>>.
 * Empty map if user is single-location or no other-location data exists.
 */
async function loadMyShiftsFromOtherLocationsForWeek(weekRange) {
  const empty = new Map();
  try {
    const myId = String(getAuthedStaffIdForSchedule() || "").trim();
    if (!myId || !weekRange?.startDate) return empty;
    const activeLoc = _ffSchedActiveLocId();
    const allLocs = (typeof window !== "undefined" && typeof window.ffGetActiveLocations === "function")
      ? (window.ffGetActiveLocations() || [])
      : [];
    const others = allLocs.filter((l) => l && l.id && String(l.id) !== String(activeLoc));
    if (others.length === 0) return empty;

    const perLoc = await Promise.all(others.map(async (loc) => {
      const override = loadOtherLocationLocalDraftDays(loc.id, weekRange);
      if (Array.isArray(override) && override.length > 0) return { loc, days: override };
      const lastBuild = loadOtherLocationLastBuildCache(loc.id, weekRange);
      if (Array.isArray(lastBuild) && lastBuild.length > 0) return { loc, days: lastBuild };
      const cloud = await loadOtherLocationWeekDraftDays(loc.id, weekRange.startDate);
      return { loc, days: Array.isArray(cloud) ? cloud : null };
    }));

    const out = new Map();
    perLoc.forEach(({ loc, days }) => {
      if (!Array.isArray(days)) return;
      days.forEach((day) => {
        const dk = String(day?.date || "").trim();
        if (!dk) return;
        const assignments = Array.isArray(day?.assignments) ? day.assignments : [];
        assignments.forEach((a) => {
          if (!a) return;
          const sid = String(a.staffId || "").trim();
          const uid = String(a.uid || "").trim();
          if (sid !== myId && uid !== myId) return;
          if (!a.startTime || !a.endTime) return;
          if (!out.has(dk)) out.set(dk, []);
          out.get(dk).push({
            locationId: loc.id,
            locationName: loc.name || "",
            startTime: a.startTime,
            endTime: a.endTime,
            lunchBreakEnabled: !!a.lunchBreakEnabled,
            lunchBreakStart: a.lunchBreakStart,
            lunchBreakEnd: a.lunchBreakEnd,
          });
        });
      });
    });
    // Sort each day's shifts by start time for stable rendering.
    out.forEach((arr) => {
      arr.sort((x, y) => String(x.startTime || "").localeCompare(String(y.startTime || "")));
    });
    return out;
  } catch (e) {
    console.warn("[ScheduleUI] loadMyShiftsFromOtherLocationsForWeek failed", e);
    return empty;
  }
}

/** Is the currently-authed user scheduled in 2+ active locations this week? */
function isAuthedUserMultiLocationForWeek() {
  const map = scheduleState.schedulePreviewState?.myShiftsFromOtherLocs;
  return !!(map && typeof map.size === "number" && map.size > 0);
}

/**
 * Management/Team view variant of loadMyShiftsFromOtherLocationsForWeek: pulls
 * EVERY staff member's shifts from every OTHER active location for the week so
 * the management board can show, in each cell, a branch tag for staff who work
 * more than one location — without the manager switching location tabs.
 *
 * Returns Map<staffKey, Map<dateKey, Array<{ locationId, locationName,
 * startTime, endTime, lunchBreakEnabled, lunchBreakStart, lunchBreakEnd }>>>.
 * Each shift is registered under BOTH the staffId and uid so the renderer can
 * find it by either identity. Read-only; same priority order (override >
 * last-build cache > cloud snapshot) and same fail-open behavior as the others.
 */
async function loadAllStaffShiftsFromOtherLocationsForWeek(weekRange) {
  const empty = new Map();
  try {
    if (!weekRange?.startDate) return empty;
    const activeLoc = _ffSchedActiveLocId();
    const allLocs = (typeof window !== "undefined" && typeof window.ffGetActiveLocations === "function")
      ? (window.ffGetActiveLocations() || [])
      : [];
    const others = allLocs.filter((l) => l && l.id && String(l.id) !== String(activeLoc));
    if (others.length === 0) return empty;

    const perLoc = await Promise.all(others.map(async (loc) => {
      const override = loadOtherLocationLocalDraftDays(loc.id, weekRange);
      if (Array.isArray(override) && override.length > 0) return { loc, days: override };
      const lastBuild = loadOtherLocationLastBuildCache(loc.id, weekRange);
      if (Array.isArray(lastBuild) && lastBuild.length > 0) return { loc, days: lastBuild };
      const cloud = await loadOtherLocationWeekDraftDays(loc.id, weekRange.startDate);
      return { loc, days: Array.isArray(cloud) ? cloud : null };
    }));

    const out = new Map();
    const addShift = (key, dk, shift) => {
      if (!key || !dk) return;
      if (!out.has(key)) out.set(key, new Map());
      const byDate = out.get(key);
      if (!byDate.has(dk)) byDate.set(dk, []);
      byDate.get(dk).push(shift);
    };
    perLoc.forEach(({ loc, days }) => {
      if (!Array.isArray(days)) return;
      days.forEach((day) => {
        const dk = String(day?.date || "").trim();
        if (!dk) return;
        const assignments = Array.isArray(day?.assignments) ? day.assignments : [];
        assignments.forEach((a) => {
          if (!a || !a.startTime || !a.endTime) return;
          const sid = String(a.staffId || "").trim();
          const uid = String(a.uid || "").trim();
          const shift = {
            locationId: loc.id,
            locationName: loc.name || "",
            startTime: a.startTime,
            endTime: a.endTime,
            lunchBreakEnabled: !!a.lunchBreakEnabled,
            lunchBreakStart: a.lunchBreakStart,
            lunchBreakEnd: a.lunchBreakEnd,
          };
          if (sid) addShift(sid, dk, shift);
          if (uid && uid !== sid) addShift(uid, dk, shift);
        });
      });
    });
    out.forEach((byDate) => {
      byDate.forEach((arr) => {
        arr.sort((x, y) => String(x.startTime || "").localeCompare(String(y.startTime || "")));
      });
    });
    return out;
  } catch (e) {
    console.warn("[ScheduleUI] loadAllStaffShiftsFromOtherLocationsForWeek failed", e);
    return empty;
  }
}

function teardownSchedulePublishListener() {
  if (scheduleState.schedulePublishUnsub) {
    try {
      scheduleState.schedulePublishUnsub();
    } catch (_) {
      /* ignore */
    }
    scheduleState.schedulePublishUnsub = null;
  }
  scheduleState.schedulePublishSalonSubscribed = "";
  scheduleState.schedulePublishPrevMap = null;
  scheduleState.schedulePublishLastSeenBroadcastMs = null;
  scheduleState.lastSeenWeekDraftSnapshotJsonByWeek = {};
}

function ensureSchedulePublishListener() {
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  if (!salonId) {
    teardownSchedulePublishListener();
    return;
  }
  const subKey = `${salonId}::${_ffSchedActiveLocId() || "_legacy"}`;
  if (scheduleState.schedulePublishSalonSubscribed === subKey && scheduleState.schedulePublishUnsub) return;

  teardownSchedulePublishListener();
  // Subscribe per-location so each branch's Build-schedule state is isolated.
  scheduleState.schedulePublishSalonSubscribed = subKey;
  const ref = doc(db, `salons/${salonId}/schedulePublish/${_ffSchedPublishDocId()}`);
  scheduleState.schedulePublishUnsub = onSnapshot(
    ref,
    (snap) => {
      const data = snap.exists() ? snap.data() : {};
      const pub = data.published && typeof data.published === "object" ? data.published : {};
      const prevPublishedJson = JSON.stringify(scheduleState.schedulePublishedMap);
      scheduleState.schedulePublishedMap = { ...pub };
      const publishedVisibilityChanged = prevPublishedJson !== JSON.stringify(scheduleState.schedulePublishedMap);

      const drafts = data.weekDraftSnapshots && typeof data.weekDraftSnapshots === "object" ? data.weekDraftSnapshots : {};
      const wrSnap = getWeekRange(scheduleState.schedulePreviewWeekStart);
      const wsSnap = wrSnap.startDate;
      const blockJson = drafts[wsSnap] ? JSON.stringify(drafts[wsSnap]) : "";
      const prevBlock = Object.prototype.hasOwnProperty.call(scheduleState.lastSeenWeekDraftSnapshotJsonByWeek, wsSnap)
        ? scheduleState.lastSeenWeekDraftSnapshotJsonByWeek[wsSnap]
        : undefined;
      const weekDraftSnapshotChanged = prevBlock !== undefined && blockJson !== prevBlock;
      scheduleState.lastSeenWeekDraftSnapshotJsonByWeek[wsSnap] = blockJson;

      const bAt = data.lastBroadcastAt;
      const ms = bAt && typeof bAt.toMillis === "function" ? bAt.toMillis() : 0;
      const wk = String(data.lastBroadcastWeekKey || "").trim();

      if (scheduleState.schedulePublishLastSeenBroadcastMs === null) {
        scheduleState.schedulePublishLastSeenBroadcastMs = ms;
        scheduleState.schedulePublishPrevMap = { ...pub };
        scheduleState.schedulePublishSuppressToast = false;
      } else if (ms > scheduleState.schedulePublishLastSeenBroadcastMs && wk && !scheduleState.schedulePublishSuppressToast) {
        ffScheduleStaffBroadcastToast(6500);
        scheduleState.schedulePublishLastSeenBroadcastMs = ms;
        scheduleState.schedulePublishPrevMap = { ...pub };
      } else {
        scheduleState.schedulePublishLastSeenBroadcastMs = Math.max(scheduleState.schedulePublishLastSeenBroadcastMs, ms);
        scheduleState.schedulePublishPrevMap = { ...pub };
      }
      scheduleState.schedulePublishSuppressToast = false;

      const screen = document.getElementById("scheduleScreen");
      if (
        (publishedVisibilityChanged || weekDraftSnapshotChanged) &&
        screen &&
        screen.style.display !== "none" &&
        typeof refreshSchedulePreview === "function"
      ) {
        refreshSchedulePreview();
      }
    },
    (err) => console.warn("[ScheduleUI] schedulePublish listener", err),
  );
}

async function fetchSchedulePublishedMap() {
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  if (!salonId) return;
  const ref = getSchedulePublishDocRef();
  if (!ref) return;
  try {
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};
    const pub = data.published && typeof data.published === "object" ? data.published : {};
    scheduleState.schedulePublishedMap = { ...pub };
  } catch (e) {
    console.warn("[ScheduleUI] fetch schedule publish", e);
  }
}

/** Staff who only view the schedule see content only after the week is published; schedule editors always see drafts. */
function canViewScheduleBoardForCurrentWeek() {
  if (scheduleUserCanManualEdit()) return true;
  const ctx = getScheduleAccessContext();
  if (ctx.noAccess) return false;
  const weekRange = getWeekRange(scheduleState.schedulePreviewWeekStart);
  return scheduleState.schedulePublishedMap[weekRange.startDate] === true;
}

function updateSchedulePublishToggleUi() {
  const btn = document.getElementById("schedulePublishToggleBtn");
  const icon = document.getElementById("schedulePublishToggleIcon");
  const label = document.getElementById("schedulePublishToggleLabel");
  const notifyBtn = document.getElementById("scheduleNotifyChangesBtn");
  const discardBtn = document.getElementById("scheduleDiscardSavedDraftBtn");
  const saveBtn = document.getElementById("scheduleSaveDraftBtn");
  const canEdit = scheduleUserCanManualEdit();
  const buildUi = !canEdit || scheduleState.schedulePreviewMode === "build";
  const weekRange = getWeekRange(scheduleState.schedulePreviewWeekStart);
  const published = scheduleState.schedulePublishedMap[weekRange.startDate] === true;

  if (saveBtn) {
    saveBtn.style.display = canEdit && buildUi ? "inline-flex" : "none";
  }
  if (notifyBtn) {
    notifyBtn.style.display = canEdit && published && buildUi ? "inline-flex" : "none";
  }
  if (discardBtn) {
    discardBtn.style.display = canEdit && buildUi ? "inline-flex" : "none";
  }

  if (btn) {
    btn.style.display = canEdit && buildUi ? "inline-flex" : "none";
    if (canEdit) {
      btn.setAttribute("aria-pressed", published ? "true" : "false");
      btn.title = published
        ? "Published — staff can see this week. Click to hide until ready."
        : "Draft — hidden from staff. Click to publish and notify everyone.";
      if (icon) icon.textContent = published ? "\uD83D\uDC41\uFE0F" : "\uD83D\uDD12";
      if (label) label.textContent = published ? "Visible to staff" : "Hidden from staff";
    }
  }

  updateScheduleWeekAckStrip();
}

function renderScheduleUnpublishedPlaceholder(weekRange) {
  const board = document.getElementById("scheduleBoard");
  const empty = document.getElementById("schedulePreviewEmpty");
  const summaryBar = document.getElementById("scheduleSummaryBar");
  if (summaryBar) summaryBar.innerHTML = "";
  if (empty) {
    empty.style.display = "block";
    empty.textContent =
      "This week’s schedule has not been published yet. Ask a manager when it is ready, or check back later.";
  }
  if (board) {
    board.innerHTML = `
      <section style="border:1px solid #e5e7eb;border-radius:18px;background:#fff;padding:32px 24px;text-align:center;max-width:560px;margin:0 auto;">
        <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:8px;">Schedule not available yet</div>
        <div style="font-size:13px;color:#6b7280;line-height:1.5;">This week is still being prepared. You will get an on-screen notice when it is published.</div>
        <div style="margin-top:14px;font-size:12px;color:#9ca3af;">${escapeScheduleHtml(formatWeekLabel(weekRange))}</div>
      </section>
    `;
  }
}

async function toggleScheduleWeekPublished() {
  if (!scheduleUserCanManualEdit()) return;
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  if (!salonId) {
    ffScheduleAppToast("No salon selected.", 3500);
    return;
  }
  const weekRange = getWeekRange(scheduleState.schedulePreviewWeekStart);
  const key = weekRange.startDate;
  const ref = getSchedulePublishDocRef();
  if (!ref) return;
  const nextPublished = !(scheduleState.schedulePublishedMap[key] === true);
  try {
    scheduleState.schedulePublishSuppressToast = true;
    if (nextPublished) {
      const locId = _ffSchedActiveLocId();
      try {
        await updateDoc(ref, {
          [`published.${key}`]: true,
          locationId: locId || null,
          lastBroadcastAt: serverTimestamp(),
          lastBroadcastWeekKey: key,
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        if (e?.code === "not-found") {
          await setDoc(ref, {
            locationId: locId || null,
            published: { [key]: true },
            lastBroadcastAt: serverTimestamp(),
            lastBroadcastWeekKey: key,
            updatedAt: serverTimestamp(),
          });
        } else {
          throw e;
        }
      }
      ffScheduleAppToast("Schedule published — staff can now see this week.", 4500);
      await persistStaffShiftFingerprintsForWeek(
        key,
        scheduleState.schedulePreviewState.draft,
        scheduleState.schedulePreviewState.staffList,
      );
      clearSharedScheduleDraftOverrideForWeek(weekRange);
      clearScheduleLocalDirtyForCurrentUser(key);
    } else {
      try {
        await updateDoc(ref, { [`published.${key}`]: deleteField(), updatedAt: serverTimestamp() });
      } catch (e) {
        if (e?.code === "not-found") {
          await setDoc(ref, { published: {}, updatedAt: serverTimestamp() }, { merge: true });
        } else {
          throw e;
        }
      }
      ffScheduleAppToast("This week is hidden from staff again.", 3500);
    }
    await fetchSchedulePublishedMap();
    updateSchedulePublishToggleUi();
    await refreshSchedulePreview();
  } catch (e) {
    console.error("[ScheduleUI] publish toggle", e);
    scheduleState.schedulePublishSuppressToast = false;
    ffScheduleAppToast(e?.message || "Could not update publish status.", 4000);
  }
}


export {
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
};
