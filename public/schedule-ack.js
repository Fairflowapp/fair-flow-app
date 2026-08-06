// schedule-ack.js
// Schedule — multi-location doc-id helpers, toasts, week acknowledgements and
// change-ping listeners/strips. Extracted verbatim from schedule-ui.js
// (Phase 1 of the schedule-ui split). Shared mutable state lives in
// schedule-state.js; board/permission callbacks are injected via
// initScheduleAck() (wired at the top of schedule-ui.js).

import {
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { scheduleState } from "./schedule-state.js?v=20260702_schedule_state";

// ── injected via initScheduleAck() (wired in schedule-ui.js) ──
let renderScheduleBoard;
let getWeekRange;
let canViewScheduleBoardForCurrentWeek;
let getScheduleAccessContext;
let scheduleInboxUserIsFirestoreManager;
let scheduleUserCanManualEdit;

export function initScheduleAck(deps) {
  ({
    renderScheduleBoard,
    getWeekRange,
    canViewScheduleBoardForCurrentWeek,
    getScheduleAccessContext,
    scheduleInboxUserIsFirestoreManager,
    scheduleUserCanManualEdit,
  } = deps);
}

/**
 * Multi-location separation helpers
 * ---------------------------------
 * The Schedule module stores published weeks, week-draft snapshots, staff
 * acknowledgements and change-pings under `salons/{salonId}/...`. To keep
 * each branch fully isolated we:
 *   • key all cloud documents by the active `locationId` (legacy = no suffix)
 *   • stamp a `locationId` field on every write
 *   • filter every cross-location query by the active location
 *   • listen to `ff-active-location-changed` and re-load the whole board
 *
 * This matches the per-location isolation shipped for Queue/Tickets/Tasks/
 * Inbox/Chat/Media/Inventory.
 */
function _ffSchedActiveLocId() {
  try {
    if (typeof window !== "undefined" && typeof window.ffGetActiveLocationId === "function") {
      const v = window.ffGetActiveLocationId();
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  } catch (_) { /* ignore */ }
  try {
    const v = typeof window !== "undefined" ? window.__ff_active_location_id : "";
    if (typeof v === "string" && v.trim()) return v.trim();
  } catch (_) { /* ignore */ }
  try {
    if (typeof localStorage !== "undefined") {
      const v = localStorage.getItem("ff_active_location_id");
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  } catch (_) { /* ignore */ }
  return "";
}

/** Per-location document id for `salons/{salonId}/schedulePublish/{id}`. */
function _ffSchedPublishDocId() {
  const locId = _ffSchedActiveLocId();
  return locId ? `weeks_${locId}` : "weeks";
}

/** Per-location document id for ack / change-ping docs. */
function _ffSchedPerLocDocId(weekStart, staffId) {
  const locId = _ffSchedActiveLocId();
  const ws = String(weekStart || "").trim();
  const sid = String(staffId || "").trim();
  return locId ? `${locId}__${ws}_${sid}` : `${ws}_${sid}`;
}

/** Toast for schedule messages — works even when `window.showToast` is not defined (common in this app shell). */
function ffScheduleAppToast(message, duration = 5000) {
  if (typeof window.showToast === "function") {
    try {
      window.showToast(message, duration);
      return;
    } catch (_) {
      /* fall through */
    }
  }
  let el = document.getElementById("ff-schedule-app-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "ff-schedule-app-toast";
    el.setAttribute("role", "status");
    el.style.cssText =
      "position:fixed;bottom:28px;left:50%;transform:translateX(-50%);max-width:min(94vw,440px);background:#0f172a;color:#fff;padding:16px 22px;border-radius:14px;font-size:15px;font-weight:600;z-index:100060;box-shadow:0 12px 40px rgba(0,0,0,.38);text-align:center;line-height:1.45;white-space:pre-line;";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.display = "block";
  if (el.__ffHide) clearTimeout(el.__ffHide);
  el.__ffHide = setTimeout(() => {
    el.style.display = "none";
  }, duration);
}

/** Shown to all other staff when a manager publishes a week — English only, centered on screen. */
const FF_SCHEDULE_STAFF_BROADCAST_MESSAGE = "NEW SCHEDULE POSTED — PLEASE CHECK YOUR SCHEDULE";

function hideScheduleStaffBroadcastToast() {
  const el = document.getElementById("ff-schedule-staff-broadcast-toast");
  if (!el) return;
  el.style.display = "none";
  if (el.__ffHide) {
    clearTimeout(el.__ffHide);
    el.__ffHide = null;
  }
}

function ffScheduleStaffBroadcastToast(duration = 6500) {
  let el = document.getElementById("ff-schedule-staff-broadcast-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "ff-schedule-staff-broadcast-toast";
    el.setAttribute("role", "alert");
    el.style.cssText =
      "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);max-width:min(92vw,480px);background:#ffffff;padding:0;border-radius:16px;z-index:100065;border:2px solid #7c3aed;box-shadow:0 10px 36px rgba(15,23,42,0.08);";
    el.innerHTML = `
      <div style="position:relative;padding:22px 44px 24px 22px;">
        <button type="button" class="ff-schedule-broadcast-close" aria-label="Close notification" title="Close"
          style="position:absolute;top:10px;right:10px;width:34px;height:34px;padding:0;border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb;color:#374151;font-size:20px;line-height:1;cursor:pointer;font-weight:600;display:flex;align-items:center;justify-content:center;">×</button>
        <div style="color:#111827;font-size:16px;font-weight:700;letter-spacing:0.03em;text-align:center;line-height:1.45;">
          ${FF_SCHEDULE_STAFF_BROADCAST_MESSAGE}
        </div>
      </div>`;
    const closeBtn = el.querySelector(".ff-schedule-broadcast-close");
    closeBtn?.addEventListener("click", hideScheduleStaffBroadcastToast);
    closeBtn?.addEventListener("mouseenter", (e) => {
      e.currentTarget.style.background = "#f3e8ff";
      e.currentTarget.style.borderColor = "#c4b5fd";
    });
    closeBtn?.addEventListener("mouseleave", (e) => {
      e.currentTarget.style.background = "#f9fafb";
      e.currentTarget.style.borderColor = "#e5e7eb";
    });
    document.body.appendChild(el);
  }
  el.style.display = "block";
  if (el.__ffHide) clearTimeout(el.__ffHide);
  el.__ffHide = setTimeout(() => {
    hideScheduleStaffBroadcastToast();
  }, duration);
}

function getAuthedStaffIdForSchedule() {
  return String(
    typeof window !== "undefined" && window.__ff_authedStaffId
      ? window.__ff_authedStaffId
      : typeof localStorage !== "undefined"
        ? localStorage.getItem("ff_authedStaffId_v1") || ""
        : "",
  ).trim();
}

function teardownScheduleAckListener() {
  if (scheduleState.scheduleAckUnsub) {
    try {
      scheduleState.scheduleAckUnsub();
    } catch (_) {
      /* ignore */
    }
    scheduleState.scheduleAckUnsub = null;
  }
  scheduleState.scheduleAckSalonWeek = "";
  scheduleState.scheduleWeekAckSeenAtByStaffId = {};
}

function ensureScheduleWeekAckListener(weekStart) {
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  if (!salonId || !weekStart || scheduleState.schedulePublishedMap[weekStart] !== true) {
    teardownScheduleAckListener();
    updateScheduleWeekAckStrip();
    return;
  }
  const locId = _ffSchedActiveLocId();
  const subKey = `${salonId}::${locId || "_legacy"}::${weekStart}`;
  if (scheduleState.scheduleAckSalonWeek === subKey && scheduleState.scheduleAckUnsub) {
    updateScheduleWeekAckStrip();
    return;
  }

  teardownScheduleAckListener();
  scheduleState.scheduleAckSalonWeek = subKey;
  // Match per-location: if a location is active we only watch acks stamped
  // with that `locationId`. Legacy (unstamped) docs stay visible when there
  // is no active location yet (e.g. single-branch salons).
  const ackCol = collection(db, `salons/${salonId}/scheduleWeekAcks`);
  const ackQ = locId
    ? query(ackCol, where("weekStart", "==", weekStart), where("locationId", "==", locId))
    : query(ackCol, where("weekStart", "==", weekStart));
  scheduleState.scheduleAckUnsub = onSnapshot(
    ackQ,
    (snap) => {
      const next = {};
      snap.docs.forEach((d) => {
        const x = d.data();
        const sid = String(x.staffId || "").trim();
        if (!sid) return;
        const sa = x.seenAt;
        const seenMs = sa && typeof sa.toMillis === "function" ? sa.toMillis() : 0;
        next[sid] = seenMs;
      });
      scheduleState.scheduleWeekAckSeenAtByStaffId = next;
      updateScheduleWeekAckStrip();
      if (
        scheduleUserCanManualEdit() &&
        scheduleState.schedulePreviewMode === "build" &&
        scheduleState.schedulePreviewState.draft &&
        document.getElementById("scheduleScreen")?.style.display !== "none"
      ) {
        renderScheduleBoard(scheduleState.schedulePreviewState.draft, scheduleState.schedulePreviewState.validation, scheduleState.schedulePreviewState.staffList);
      }
    },
    (err) => console.warn("[ScheduleUI] scheduleWeekAcks listener", err),
  );
}

function updateScheduleWeekAckStrip() {
  void refreshScheduleWeekAckStripAsync();
}

async function refreshScheduleWeekAckStripAsync() {
  const strip = document.getElementById("scheduleWeekAckStrip");
  if (!strip) return;
  const weekRange = getWeekRange(scheduleState.schedulePreviewWeekStart);
  const ws = weekRange.startDate;
  const published = scheduleState.schedulePublishedMap[ws] === true;
  const ctx = getScheduleAccessContext();
  const editorMyShifts =
    scheduleUserCanManualEdit() && scheduleState.schedulePreviewMode === "my_shifts";
  if (
    ctx.noAccess ||
    (scheduleUserCanManualEdit() && !editorMyShifts) ||
    !published ||
    !canViewScheduleBoardForCurrentWeek()
  ) {
    strip.style.display = "none";
    strip.innerHTML = "";
    return;
  }
  const mySid = getAuthedStaffIdForSchedule();
  if (!mySid) {
    strip.style.display = "none";
    strip.innerHTML = "";
    return;
  }
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  if (!salonId) {
    strip.style.display = "none";
    strip.innerHTML = "";
    return;
  }

  let pingMs = 0;
  let seenMs = scheduleState.scheduleWeekAckSeenAtByStaffId[mySid] || 0;
  try {
    const perLoc = _ffSchedPerLocDocId(ws, mySid);
    const [pSnap, aSnap] = await Promise.all([
      getDoc(doc(db, `salons/${salonId}/scheduleStaffChangePings/${perLoc}`)),
      getDoc(doc(db, `salons/${salonId}/scheduleWeekAcks/${perLoc}`)),
    ]);
    if (pSnap.exists()) {
      const p = pSnap.data().pingAt;
      pingMs = p && typeof p.toMillis === "function" ? p.toMillis() : 0;
    }
    if (aSnap.exists()) {
      const sa = aSnap.data().seenAt;
      const sm = sa && typeof sa.toMillis === "function" ? sa.toMillis() : 0;
      if (sm > 0) seenMs = sm;
    }
  } catch (e) {
    console.warn("[ScheduleUI] refreshScheduleWeekAckStripAsync", e);
  }

  const needsReconfirm = pingMs > 0 && seenMs < pingMs;
  const upToDate = seenMs > 0 && (pingMs === 0 || seenMs >= pingMs);

  strip.style.display = "flex";
  strip.style.flexDirection = "row";
  strip.style.alignItems = "center";
  strip.style.flexWrap = "wrap";
  strip.style.gap = "8px";
  strip.style.maxWidth = "100%";

  if (upToDate) {
    strip.style.width = "";
    strip.style.maxWidth = "";
    strip.innerHTML = `<span style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;font-size:10px;font-weight:700;">Viewed ✓</span>`;
    return;
  }

  const lineText = needsReconfirm
    ? "* PAY ATTENTION — Your updated shifts are in the grid below. Review them, then tap Got it."
    : "Please confirm you've viewed this week.";

  strip.style.width = "fit-content";
  strip.style.maxWidth = "100%";

  strip.innerHTML = `
    <div style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;max-width:100%;box-sizing:border-box;padding:3px 8px 3px 9px;border:1px solid #fcd34d;background:#fffbeb;border-radius:7px;">
      <span style="font-size:10px;font-weight:600;color:#92400e;line-height:1.3;max-width:min(100%,42rem);">${lineText}</span>
      <button type="button" id="scheduleWeekAckBtn" style="height:22px;padding:0 8px;border:1px solid #f59e0b;border-radius:999px;background:#fff;color:#b45309;font-size:10px;font-weight:700;cursor:pointer;flex-shrink:0;line-height:1;">Got it</button>
    </div>`;
  document.getElementById("scheduleWeekAckBtn")?.addEventListener(
    "click",
    async () => {
      await submitScheduleWeekAck();
      try {
        if (pingMs > 0) {
          localStorage.setItem(scheduleChangePingStorageKey(salonId, ws, mySid), String(pingMs));
        }
      } catch (_) {
        /* ignore */
      }
      scheduleState.scheduleChangePingShownToastMs = 0;
      void refreshScheduleWeekAckStripAsync();
    },
    { once: true },
  );
}

async function loadScheduleWeekPingMap(weekStart) {
  scheduleState.scheduleWeekPingAtByStaffId = {};
  if (!weekStart || !scheduleUserCanManualEdit()) return;
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  if (!salonId) return;
  try {
    /**
     * Managers may list all pings for the week. Non-managers may only read their own ping doc (Firestore rules).
     * Staff with schedule_edit but role technician used to trigger permission-denied on the broad query.
     */
    if (!scheduleInboxUserIsFirestoreManager()) {
      const mySid = getAuthedStaffIdForSchedule();
      if (!mySid) return;
      const pingRef = doc(db, `salons/${salonId}/scheduleStaffChangePings/${_ffSchedPerLocDocId(weekStart, mySid)}`);
      const snap = await getDoc(pingRef);
      const m = {};
      if (snap.exists()) {
        const x = snap.data();
        const sid = String(x.staffId || "").trim();
        const pt = x.pingAt;
        const ms = pt && typeof pt.toMillis === "function" ? pt.toMillis() : 0;
        if (sid && ms) m[sid] = ms;
      }
      scheduleState.scheduleWeekPingAtByStaffId = m;
      return;
    }
    const locId = _ffSchedActiveLocId();
    const pingCol = collection(db, `salons/${salonId}/scheduleStaffChangePings`);
    const pingQ = locId
      ? query(pingCol, where("weekStart", "==", weekStart), where("locationId", "==", locId))
      : query(pingCol, where("weekStart", "==", weekStart));
    const snap = await getDocs(pingQ);
    const m = {};
    snap.docs.forEach((d) => {
      const x = d.data();
      const sid = String(x.staffId || "").trim();
      const pt = x.pingAt;
      const ms = pt && typeof pt.toMillis === "function" ? pt.toMillis() : 0;
      if (sid && ms) m[sid] = ms;
    });
    scheduleState.scheduleWeekPingAtByStaffId = m;
  } catch (e) {
    console.warn("[ScheduleUI] loadScheduleWeekPingMap", e);
  }
}

async function submitScheduleWeekAck() {
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  const mySid = getAuthedStaffIdForSchedule();
  const weekRange = getWeekRange(scheduleState.schedulePreviewWeekStart);
  const ws = weekRange.startDate;
  if (!salonId || !mySid || !ws || scheduleState.schedulePublishedMap[ws] !== true) return;
  try {
    const locId = _ffSchedActiveLocId();
    const ref = doc(db, `salons/${salonId}/scheduleWeekAcks/${_ffSchedPerLocDocId(ws, mySid)}`);
    await setDoc(
      ref,
      {
        salonId,
        weekStart: ws,
        staffId: mySid,
        locationId: locId || null,
        seenAt: serverTimestamp(),
      },
      { merge: true },
    );
    ffScheduleAppToast("Saved. Your manager can see you viewed this schedule.", 3500);
  } catch (e) {
    console.error("[ScheduleUI] schedule ack", e);
    ffScheduleAppToast(e?.message || "Could not save confirmation.", 4000);
  }
}

function scheduleChangePingStorageKey(salonId, weekStart, staffId) {
  return `ff_schedule_changeping_${salonId}_${weekStart}_${staffId}`;
}

function teardownScheduleChangePingListener() {
  if (scheduleState.scheduleChangePingUnsub) {
    try {
      scheduleState.scheduleChangePingUnsub();
    } catch (_) {
      /* ignore */
    }
    scheduleState.scheduleChangePingUnsub = null;
  }
  scheduleState.scheduleChangePingSubKey = "";
  scheduleState.scheduleChangePingShownToastMs = 0;
}

function updateScheduleChangePingStripFromSnapshot(snap) {
  const el = document.getElementById("scheduleStaffChangeStrip");
  if (!el) return;
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  const mySid = getAuthedStaffIdForSchedule();
  const weekRange = getWeekRange(scheduleState.schedulePreviewWeekStart);
  const ws = weekRange.startDate;
  if (
    !salonId ||
    !mySid ||
    (scheduleUserCanManualEdit() && scheduleState.schedulePreviewMode !== "my_shifts") ||
    getScheduleAccessContext().noAccess ||
    scheduleState.schedulePublishedMap[ws] !== true
  ) {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }
  if (!snap.exists()) {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }
  const pingAt = snap.data().pingAt;
  const ms = pingAt && typeof pingAt.toMillis === "function" ? pingAt.toMillis() : 0;
  if (!ms) {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }
  let stored = 0;
  try {
    stored = parseInt(localStorage.getItem(scheduleChangePingStorageKey(salonId, ws, mySid)) || "0", 10);
  } catch (_) {
    stored = 0;
  }
  if (ms <= stored) {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }
  if (ms > stored && ms !== scheduleState.scheduleChangePingShownToastMs) {
    scheduleState.scheduleChangePingShownToastMs = ms;
    ffScheduleAppToast("YOUR SHIFTS FOR THIS WEEK WERE UPDATED — PLEASE CHECK THE SCHEDULE.", 6500);
  }
  el.style.display = "none";
  el.innerHTML = "";
  updateScheduleWeekAckStrip();
}

function ensureScheduleChangePingListener(weekStart) {
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  const mySid = getAuthedStaffIdForSchedule();
  const ctx = getScheduleAccessContext();
  if (
    !salonId ||
    !weekStart ||
    !mySid ||
    (scheduleUserCanManualEdit() && scheduleState.schedulePreviewMode !== "my_shifts") ||
    ctx.noAccess ||
    scheduleState.schedulePublishedMap[weekStart] !== true
  ) {
    teardownScheduleChangePingListener();
    const el = document.getElementById("scheduleStaffChangeStrip");
    if (el) {
      el.style.display = "none";
      el.innerHTML = "";
    }
    return;
  }
  const locId = _ffSchedActiveLocId();
  const subKey = `${salonId}::${locId || "_legacy"}::${weekStart}::${mySid}`;
  if (scheduleState.scheduleChangePingSubKey === subKey && scheduleState.scheduleChangePingUnsub) {
    return;
  }
  teardownScheduleChangePingListener();
  scheduleState.scheduleChangePingSubKey = subKey;
  const pingRef = doc(db, `salons/${salonId}/scheduleStaffChangePings/${_ffSchedPerLocDocId(weekStart, mySid)}`);
  scheduleState.scheduleChangePingUnsub = onSnapshot(
    pingRef,
    (snap) => {
      updateScheduleChangePingStripFromSnapshot(snap);
    },
    (err) => console.warn("[ScheduleUI] schedule change ping", err),
  );
}

export {
  _ffSchedActiveLocId,
  _ffSchedPerLocDocId,
  _ffSchedPublishDocId,
  ensureScheduleChangePingListener,
  ensureScheduleWeekAckListener,
  ffScheduleAppToast,
  ffScheduleStaffBroadcastToast,
  getAuthedStaffIdForSchedule,
  loadScheduleWeekPingMap,
  submitScheduleWeekAck,
  teardownScheduleAckListener,
  teardownScheduleChangePingListener,
  updateScheduleWeekAckStrip,
};
