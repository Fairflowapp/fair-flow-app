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
import { auth, db } from "./app.js?v=20260409_index_safejson";
import { generateWeeklySchedule } from "./schedule-generator.js?v=20260409_stagger_by_coverage_min";
import { validateScheduleDraft } from "./schedule-validator.js?v=20260409_coverage_total_staff_skip";
import {
  getEffectiveAvailabilityForDate,
  getInboxApprovalDisplayForDate,
  isApprovedRequest,
} from "./schedule-availability.js?v=20260409_coverage_plain_cards";
import { parseScheduleTimeToMinutes, clipTimeWindowToBestShiftSegment } from "./schedule-helpers.js?v=20260409_coverage_plain_cards";

// Default to next week — managers usually plan/publish the upcoming week, not the one already in progress.
let schedulePreviewWeekStart = addDays(getStartOfWeek(new Date()), 7);
let schedulePreviewState = {
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
};
let schedulePreviewView = "management";
/** Editors only: "my_shifts" = personal row, view + ack | "build" = full grid editing. */
let schedulePreviewMode = "build";
let scheduleDragState = null;
let scheduleShiftEditPayload = null;

/** ISO week start (Mon/Sun per prefs) -> true when that week is published for all staff */
let schedulePublishedMap = {};
let schedulePublishUnsub = null;
let schedulePublishSalonSubscribed = "";
let schedulePublishPrevMap = null;
let schedulePublishSuppressToast = false;
/** Milliseconds of last seen `lastBroadcastAt` (Firestore); used to notify all clients when a week is published. */
let schedulePublishLastSeenBroadcastMs = null;
/** weekStart -> JSON string of `weekDraftSnapshots[weekStart]` from last snapshot; detect draft updates for staff. */
let lastSeenWeekDraftSnapshotJsonByWeek = {};
/** staffId -> seenAt millis (0 = not acknowledged) */
let scheduleWeekAckSeenAtByStaffId = {};
/** staffId -> last scheduleStaffChangePings.pingAt millis (managers’ grid) */
let scheduleWeekPingAtByStaffId = {};
let scheduleAckUnsub = null;
let scheduleAckSalonWeek = "";
let scheduleChangePingUnsub = null;
let scheduleChangePingSubKey = "";
/** Avoid duplicate toasts for the same ping timestamp */
let scheduleChangePingShownToastMs = 0;
/** When drag-drop needs confirm before placing shift on Marked OFF cell: { payload, targetStaffId, targetDate } */
let scheduleDnDConfirmPending = null;
/** After user confirms placing a shift that conflicts with approved late_start / early_leave */
let scheduleApprovedTimeConflictContinue = null;
let scheduleSaveSkipApprovedTimeConflictOnce = false;

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
  if (scheduleAckUnsub) {
    try {
      scheduleAckUnsub();
    } catch (_) {
      /* ignore */
    }
    scheduleAckUnsub = null;
  }
  scheduleAckSalonWeek = "";
  scheduleWeekAckSeenAtByStaffId = {};
}

function ensureScheduleWeekAckListener(weekStart) {
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  if (!salonId || !weekStart || schedulePublishedMap[weekStart] !== true) {
    teardownScheduleAckListener();
    updateScheduleWeekAckStrip();
    return;
  }
  const subKey = `${salonId}::${weekStart}`;
  if (scheduleAckSalonWeek === subKey && scheduleAckUnsub) {
    updateScheduleWeekAckStrip();
    return;
  }

  teardownScheduleAckListener();
  scheduleAckSalonWeek = subKey;
  const ackQ = query(collection(db, `salons/${salonId}/scheduleWeekAcks`), where("weekStart", "==", weekStart));
  scheduleAckUnsub = onSnapshot(
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
      scheduleWeekAckSeenAtByStaffId = next;
      updateScheduleWeekAckStrip();
      if (
        scheduleUserCanManualEdit() &&
        schedulePreviewMode === "build" &&
        schedulePreviewState.draft &&
        document.getElementById("scheduleScreen")?.style.display !== "none"
      ) {
        renderScheduleBoard(schedulePreviewState.draft, schedulePreviewState.validation, schedulePreviewState.staffList);
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
  const weekRange = getWeekRange(schedulePreviewWeekStart);
  const ws = weekRange.startDate;
  const published = schedulePublishedMap[ws] === true;
  const ctx = getScheduleAccessContext();
  const editorMyShifts =
    scheduleUserCanManualEdit() && schedulePreviewMode === "my_shifts";
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
  let seenMs = scheduleWeekAckSeenAtByStaffId[mySid] || 0;
  try {
    const [pSnap, aSnap] = await Promise.all([
      getDoc(doc(db, `salons/${salonId}/scheduleStaffChangePings/${ws}_${mySid}`)),
      getDoc(doc(db, `salons/${salonId}/scheduleWeekAcks/${ws}_${mySid}`)),
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
      scheduleChangePingShownToastMs = 0;
      void refreshScheduleWeekAckStripAsync();
    },
    { once: true },
  );
}

async function loadScheduleWeekPingMap(weekStart) {
  scheduleWeekPingAtByStaffId = {};
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
      const pingRef = doc(db, `salons/${salonId}/scheduleStaffChangePings/${weekStart}_${mySid}`);
      const snap = await getDoc(pingRef);
      const m = {};
      if (snap.exists()) {
        const x = snap.data();
        const sid = String(x.staffId || "").trim();
        const pt = x.pingAt;
        const ms = pt && typeof pt.toMillis === "function" ? pt.toMillis() : 0;
        if (sid && ms) m[sid] = ms;
      }
      scheduleWeekPingAtByStaffId = m;
      return;
    }
    const pingQ = query(
      collection(db, `salons/${salonId}/scheduleStaffChangePings`),
      where("weekStart", "==", weekStart),
    );
    const snap = await getDocs(pingQ);
    const m = {};
    snap.docs.forEach((d) => {
      const x = d.data();
      const sid = String(x.staffId || "").trim();
      const pt = x.pingAt;
      const ms = pt && typeof pt.toMillis === "function" ? pt.toMillis() : 0;
      if (sid && ms) m[sid] = ms;
    });
    scheduleWeekPingAtByStaffId = m;
  } catch (e) {
    console.warn("[ScheduleUI] loadScheduleWeekPingMap", e);
  }
}

async function submitScheduleWeekAck() {
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  const mySid = getAuthedStaffIdForSchedule();
  const weekRange = getWeekRange(schedulePreviewWeekStart);
  const ws = weekRange.startDate;
  if (!salonId || !mySid || !ws || schedulePublishedMap[ws] !== true) return;
  try {
    const ref = doc(db, `salons/${salonId}/scheduleWeekAcks/${ws}_${mySid}`);
    await setDoc(
      ref,
      {
        salonId,
        weekStart: ws,
        staffId: mySid,
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
  if (scheduleChangePingUnsub) {
    try {
      scheduleChangePingUnsub();
    } catch (_) {
      /* ignore */
    }
    scheduleChangePingUnsub = null;
  }
  scheduleChangePingSubKey = "";
  scheduleChangePingShownToastMs = 0;
}

function updateScheduleChangePingStripFromSnapshot(snap) {
  const el = document.getElementById("scheduleStaffChangeStrip");
  if (!el) return;
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  const mySid = getAuthedStaffIdForSchedule();
  const weekRange = getWeekRange(schedulePreviewWeekStart);
  const ws = weekRange.startDate;
  if (
    !salonId ||
    !mySid ||
    (scheduleUserCanManualEdit() && schedulePreviewMode !== "my_shifts") ||
    getScheduleAccessContext().noAccess ||
    schedulePublishedMap[ws] !== true
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
  if (ms > stored && ms !== scheduleChangePingShownToastMs) {
    scheduleChangePingShownToastMs = ms;
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
    (scheduleUserCanManualEdit() && schedulePreviewMode !== "my_shifts") ||
    ctx.noAccess ||
    schedulePublishedMap[weekStart] !== true
  ) {
    teardownScheduleChangePingListener();
    const el = document.getElementById("scheduleStaffChangeStrip");
    if (el) {
      el.style.display = "none";
      el.innerHTML = "";
    }
    return;
  }
  const subKey = `${salonId}::${weekStart}::${mySid}`;
  if (scheduleChangePingSubKey === subKey && scheduleChangePingUnsub) {
    return;
  }
  teardownScheduleChangePingListener();
  scheduleChangePingSubKey = subKey;
  const pingRef = doc(db, `salons/${salonId}/scheduleStaffChangePings/${weekStart}_${mySid}`);
  scheduleChangePingUnsub = onSnapshot(
    pingRef,
    (snap) => {
      updateScheduleChangePingStripFromSnapshot(snap);
    },
    (err) => console.warn("[ScheduleUI] schedule change ping", err),
  );
}

function escapeScheduleAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** Plain text for schedule board cells (not attribute context). */
function escapeScheduleHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Optional lunch break label for schedule cells. */
function formatLunchBreakCellSubtitle(assignment) {
  if (!assignment || !assignment.lunchBreakEnabled) return "";
  const ls = String(assignment.lunchStartTime || "").trim();
  const le = String(assignment.lunchEndTime || "").trim();
  if (ls && le) {
    return `Lunch break ${formatScheduleTimeShortAmPm(ls)}–${formatScheduleTimeShortAmPm(le)}`;
  }
  return "Lunch break";
}

function syncScheduleShiftEditLunchRowVisibility() {
  const cb = document.getElementById("scheduleShiftEditLunchEnabled");
  const row = document.getElementById("scheduleShiftEditLunchTimesRow");
  if (row) row.style.display = cb?.checked ? "flex" : "none";
}

function readLunchBreakFieldsFromShiftEditForm(shiftStart, shiftEnd) {
  const cb = document.getElementById("scheduleShiftEditLunchEnabled");
  const enabled = Boolean(cb?.checked);
  if (!enabled) {
    return { ok: true, lunchBreakEnabled: false, lunchStartTime: null, lunchEndTime: null };
  }
  const lsRaw = hhmmFromTimeInput(document.getElementById("scheduleShiftEditLunchStart")?.value);
  const leRaw = hhmmFromTimeInput(document.getElementById("scheduleShiftEditLunchEnd")?.value);
  const hasLs = Boolean(lsRaw);
  const hasLe = Boolean(leRaw);
  if (hasLs !== hasLe) {
    return {
      ok: false,
      error: "Enter both lunch start and end times, or leave both fields empty.",
    };
  }
  if (!hasLs && !hasLe) {
    return { ok: true, lunchBreakEnabled: true, lunchStartTime: null, lunchEndTime: null };
  }
  if (lsRaw >= leRaw) {
    return { ok: false, error: "Lunch end time must be after lunch start time." };
  }
  if (compareScheduleHHMM(lsRaw, shiftStart) < 0 || compareScheduleHHMM(leRaw, shiftEnd) > 0) {
    return { ok: false, error: "Lunch break must fall within the shift hours." };
  }
  return { ok: true, lunchBreakEnabled: true, lunchStartTime: lsRaw, lunchEndTime: leRaw };
}

function applyLunchBreakToAssignment(assignment, lunchRes) {
  if (!assignment || !lunchRes || !lunchRes.ok) return;
  if (!lunchRes.lunchBreakEnabled) {
    delete assignment.lunchBreakEnabled;
    delete assignment.lunchStartTime;
    delete assignment.lunchEndTime;
    return;
  }
  assignment.lunchBreakEnabled = true;
  if (lunchRes.lunchStartTime && lunchRes.lunchEndTime) {
    assignment.lunchStartTime = lunchRes.lunchStartTime;
    assignment.lunchEndTime = lunchRes.lunchEndTime;
  } else {
    delete assignment.lunchStartTime;
    delete assignment.lunchEndTime;
  }
}

function ensureScheduleShiftEditModal() {
  if (document.getElementById("scheduleShiftEditBackdrop")) {
    return document.getElementById("scheduleShiftEditBackdrop");
  }
  const backdrop = document.createElement("div");
  backdrop.id = "scheduleShiftEditBackdrop";
  backdrop.style.cssText = "display:none;position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:4000;align-items:center;justify-content:center;padding:16px;";
  backdrop.innerHTML = `
    <div role="dialog" aria-modal="true" style="background:#fff;border-radius:16px;padding:20px 22px;max-width:400px;width:100%;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);">
      <div id="scheduleShiftEditTitle" style="font-size:16px;font-weight:700;color:#111827;margin-bottom:6px;">Edit shift</div>
      <div id="scheduleShiftEditHint" style="display:none;font-size:11px;color:#6b7280;margin-bottom:10px;line-height:1.4;">Preview only — not saved to staff profiles. Marked OFF for this week is remembered in this browser until you remove it or switch weeks.</div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <label style="font-size:12px;color:#6b7280;">Start
          <input type="time" id="scheduleShiftEditStart" step="300" style="width:100%;margin-top:4px;height:40px;border:1px solid #e5e7eb;border-radius:8px;padding:0 10px;box-sizing:border-box;" />
        </label>
        <label style="font-size:12px;color:#6b7280;">End
          <input type="time" id="scheduleShiftEditEnd" step="300" style="width:100%;margin-top:4px;height:40px;border:1px solid #e5e7eb;border-radius:8px;padding:0 10px;box-sizing:border-box;" />
        </label>
        <label style="display:flex;align-items:flex-start;gap:10px;font-size:12px;color:#374151;cursor:pointer;margin-top:2px;">
          <input type="checkbox" id="scheduleShiftEditLunchEnabled" style="margin-top:3px;width:16px;height:16px;accent-color:#7c3aed;cursor:pointer;flex-shrink:0;" />
          <span style="line-height:1.4;"><strong style="color:#111827;">Lunch break</strong><span style="display:block;font-size:11px;color:#6b7280;font-weight:400;margin-top:2px;">Optional — shown under the shift hours on the board</span></span>
        </label>
        <div id="scheduleShiftEditLunchTimesRow" style="display:none;flex-wrap:wrap;gap:10px;align-items:flex-end;">
          <label style="font-size:12px;color:#6b7280;flex:1;min-width:120px;">Lunch from
            <input type="time" id="scheduleShiftEditLunchStart" step="300" style="width:100%;margin-top:4px;height:40px;border:1px solid #e5e7eb;border-radius:8px;padding:0 10px;box-sizing:border-box;" />
          </label>
          <label style="font-size:12px;color:#6b7280;flex:1;min-width:120px;">Lunch to
            <input type="time" id="scheduleShiftEditLunchEnd" step="300" style="width:100%;margin-top:4px;height:40px;border:1px solid #e5e7eb;border-radius:8px;padding:0 10px;box-sizing:border-box;" />
          </label>
        </div>
      </div>
      <button type="button" id="scheduleShiftEditMarkOff" style="display:none;width:100%;margin-top:14px;padding:10px 12px;border-radius:10px;border:1px solid rgba(124,58,237,0.28);background:linear-gradient(180deg,rgba(124,58,237,0.14),rgba(124,58,237,0.06));color:#6d28d9;font-weight:600;cursor:pointer;font-size:12px;box-shadow:inset 0 1px 0 rgba(255,255,255,0.85);">Mark day as OFF</button>
      <button type="button" id="scheduleShiftEditRemove" style="display:none;width:100%;margin-top:10px;padding:8px 12px;border-radius:8px;border:1px solid #fecaca;background:#fff;color:#b91c1c;font-weight:600;cursor:pointer;font-size:12px;">Remove shift (OFF)</button>
      <div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end;">
        <button type="button" id="scheduleShiftEditCancel" style="padding:8px 14px;border-radius:8px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-weight:600;cursor:pointer;">Cancel</button>
        <button type="button" id="scheduleShiftEditSave" style="padding:8px 14px;border-radius:8px;border:none;background:#7c3aed;color:#fff;font-weight:600;cursor:pointer;">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeScheduleShiftEdit();
  });
  document.getElementById("scheduleShiftEditCancel")?.addEventListener("click", closeScheduleShiftEdit);
  document.getElementById("scheduleShiftEditSave")?.addEventListener("click", saveScheduleShiftEdit);
  document.getElementById("scheduleShiftEditRemove")?.addEventListener("click", removeScheduleShiftFromDraft);
  document.getElementById("scheduleShiftEditMarkOff")?.addEventListener("click", markScheduleDayAsOffFromModal);
  document.getElementById("scheduleShiftEditLunchEnabled")?.addEventListener("change", syncScheduleShiftEditLunchRowVisibility);
  return backdrop;
}

function ensureScheduleDnDOffConfirmModal() {
  if (document.getElementById("scheduleDnDOffConfirmBackdrop")) {
    return document.getElementById("scheduleDnDOffConfirmBackdrop");
  }
  const backdrop = document.createElement("div");
  backdrop.id = "scheduleDnDOffConfirmBackdrop";
  backdrop.style.cssText =
    "display:none;position:fixed;inset:0;background:rgba(15,23,42,0.5);z-index:4100;align-items:center;justify-content:center;padding:20px;";
  backdrop.innerHTML = `
    <div role="dialog" aria-modal="true" aria-labelledby="scheduleDnDOffConfirmTitle" style="background:#fff;border-radius:16px;padding:24px 26px;max-width:420px;width:100%;box-shadow:0 25px 50px -12px rgba(0,0,0,0.28);">
      <div id="scheduleDnDOffConfirmTitle" style="font-size:18px;font-weight:700;color:#111827;margin-bottom:10px;">Note</div>
      <p id="scheduleDnDOffConfirmBody" style="margin:0 0 22px 0;font-size:14px;color:#4b5563;line-height:1.55;"></p>
      <div style="display:flex;gap:12px;justify-content:flex-end;flex-wrap:wrap;">
        <button type="button" id="scheduleDnDOffConfirmCancel" style="padding:10px 18px;border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-weight:600;cursor:pointer;font-size:14px;">Cancel</button>
        <button type="button" id="scheduleDnDOffConfirmOk" style="padding:10px 18px;border-radius:10px;border:none;background:#7c3aed;color:#fff;font-weight:600;cursor:pointer;font-size:14px;">Continue</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) cancelScheduleDnDOffConfirm();
  });
  document.getElementById("scheduleDnDOffConfirmCancel")?.addEventListener("click", cancelScheduleDnDOffConfirm);
  document.getElementById("scheduleDnDOffConfirmOk")?.addEventListener("click", confirmScheduleDnDOffConfirm);
  return backdrop;
}

function ensureScheduleRebuildConfirmModal() {
  if (document.getElementById("scheduleRebuildConfirmBackdrop")) {
    return document.getElementById("scheduleRebuildConfirmBackdrop");
  }
  const backdrop = document.createElement("div");
  backdrop.id = "scheduleRebuildConfirmBackdrop";
  backdrop.style.cssText =
    "display:none;position:fixed;inset:0;background:rgba(15,23,42,0.5);z-index:4100;align-items:center;justify-content:center;padding:20px;";
  backdrop.innerHTML = `
    <div role="dialog" aria-modal="true" aria-labelledby="scheduleRebuildConfirmTitle" style="background:#fff;border-radius:16px;padding:24px 26px;max-width:440px;width:100%;box-shadow:0 25px 50px -12px rgba(0,0,0,0.28);">
      <div id="scheduleRebuildConfirmTitle" style="font-size:18px;font-weight:700;color:#111827;margin-bottom:10px;">Replace this week’s draft?</div>
      <p id="scheduleRebuildConfirmBody" style="margin:0 0 22px 0;font-size:14px;color:#4b5563;line-height:1.55;">We’ll delete the saved draft (here and online) and build a new schedule from your coverage rules.</p>
      <div style="display:flex;gap:12px;justify-content:flex-end;flex-wrap:wrap;">
        <button type="button" id="scheduleRebuildConfirmCancel" style="padding:10px 18px;border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-weight:600;cursor:pointer;font-size:14px;">Cancel</button>
        <button type="button" id="scheduleRebuildConfirmOk" style="padding:10px 18px;border-radius:10px;border:none;background:#7c3aed;color:#fff;font-weight:600;cursor:pointer;font-size:14px;">Build schedule</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeScheduleRebuildConfirmModal();
  });
  document.getElementById("scheduleRebuildConfirmCancel")?.addEventListener("click", closeScheduleRebuildConfirmModal);
  document.getElementById("scheduleRebuildConfirmOk")?.addEventListener("click", confirmScheduleRebuildConfirmModal);
  return backdrop;
}

function closeScheduleRebuildConfirmModal() {
  const el = document.getElementById("scheduleRebuildConfirmBackdrop");
  if (el) el.style.display = "none";
}

function confirmScheduleRebuildConfirmModal() {
  closeScheduleRebuildConfirmModal();
  void runDiscardSavedScheduleWeekDraftAndReload();
}

/** Fallback when staff/date missing — keep minimal */
function setScheduleDnDConfirmModalVariant(variant) {
  const titleEl = document.getElementById("scheduleDnDOffConfirmTitle");
  const bodyEl = document.getElementById("scheduleDnDOffConfirmBody");
  const okEl = document.getElementById("scheduleDnDOffConfirmOk");
  if (titleEl) titleEl.textContent = "Note";
  if (bodyEl) {
    bodyEl.textContent =
      variant === "approved_inbox"
        ? "Please note: Inbox may restrict this cell."
        : "Please note: this cell may be marked OFF for this week.";
  }
  if (okEl) okEl.textContent = "Continue";
}

/**
 * One line: what applies to this cell (Inbox + optional weekly OFF). Used for Add shift / drag confirm.
 * @param {"manual_off"|"approved_inbox"} kind — manual_off ⇒ include weekly Marked OFF in the line.
 */
function buildScheduleCellApprovalNoteLine(staff, dateKey, kind) {
  const manualOff = kind === "manual_off";
  const requests = Array.isArray(schedulePreviewState.requests) ? schedulePreviewState.requests : [];
  const d = getInboxApprovalDisplayForDate(staff, requests, dateKey);
  const chunks = [];
  if (d.lateStart) chunks.push(`Approved START ${formatScheduleTimeShortAmPm(d.lateStart)}`);
  if (d.earlyLeave) chunks.push(`Approved leave by ${formatScheduleTimeShortAmPm(d.earlyLeave)}`);
  const hasPartial = chunks.length > 0;
  if (!hasPartial && d.hasFullDayRequest) chunks.push("Approved day off (Inbox)");
  if (manualOff) chunks.push("Marked OFF for this week");
  return chunks.join(" · ");
}

/** @param {"manual_off"|"approved_inbox"} kind */
function applySchedulePlaceShiftConfirmCopy(staff, dateKey, kind) {
  const titleEl = document.getElementById("scheduleDnDOffConfirmTitle");
  const bodyEl = document.getElementById("scheduleDnDOffConfirmBody");
  const okEl = document.getElementById("scheduleDnDOffConfirmOk");
  const line = buildScheduleCellApprovalNoteLine(staff, dateKey, kind);
  if (titleEl) titleEl.textContent = "Note";
  if (bodyEl) {
    bodyEl.textContent = line
      ? `Please note: ${line}.`
      : "Please note: you can place a shift on this cell.";
  }
  if (okEl) okEl.textContent = "Continue";
}

function openScheduleDnDOffConfirm(pending) {
  scheduleDnDConfirmPending = {
    action: "dnd_move",
    variant: pending.variant || "manual_off",
    payload: pending.payload,
    targetStaffId: pending.targetStaffId,
    targetDate: pending.targetDate,
  };
  const el = ensureScheduleDnDOffConfirmModal();
  const staff = getStaffByScheduleKey(schedulePreviewState.staffList, pending.targetStaffId);
  if (staff && pending.targetDate) {
    applySchedulePlaceShiftConfirmCopy(
      staff,
      pending.targetDate,
      scheduleDnDConfirmPending.variant === "approved_inbox" ? "approved_inbox" : "manual_off",
    );
  } else {
    setScheduleDnDConfirmModalVariant(scheduleDnDConfirmPending.variant);
  }
  el.style.display = "flex";
}

function openScheduleAddShiftApprovedInboxConfirm({ staffKey, dateKey, staffName, startTime, endTime }) {
  scheduleDnDConfirmPending = {
    action: "open_add_shift",
    variant: "approved_inbox",
    staffKey,
    dateKey,
    staffName,
    startTime,
    endTime,
  };
  const el = ensureScheduleDnDOffConfirmModal();
  const staff = getStaffByScheduleKey(schedulePreviewState.staffList, staffKey);
  if (staff) applySchedulePlaceShiftConfirmCopy(staff, dateKey, "approved_inbox");
  else setScheduleDnDConfirmModalVariant("approved_inbox");
  el.style.display = "flex";
}

function openScheduleAddShiftManualOffConfirm({ staffKey, dateKey, staffName, startTime, endTime }) {
  scheduleDnDConfirmPending = {
    action: "open_add_shift",
    variant: "manual_off",
    staffKey,
    dateKey,
    staffName,
    startTime,
    endTime,
  };
  const el = ensureScheduleDnDOffConfirmModal();
  const staff = getStaffByScheduleKey(schedulePreviewState.staffList, staffKey);
  if (staff) applySchedulePlaceShiftConfirmCopy(staff, dateKey, "manual_off");
  else setScheduleDnDConfirmModalVariant("manual_off");
  el.style.display = "flex";
}

function closeScheduleDnDOffConfirm() {
  const el = document.getElementById("scheduleDnDOffConfirmBackdrop");
  if (el) el.style.display = "none";
  scheduleDnDConfirmPending = null;
}

function cancelScheduleDnDOffConfirm() {
  closeScheduleDnDOffConfirm();
}

function confirmScheduleDnDOffConfirm() {
  const pending = scheduleDnDConfirmPending;
  closeScheduleDnDOffConfirm();
  if (!pending) return;
  if (pending.action === "open_add_shift") {
    openScheduleShiftEdit({
      staffKey: pending.staffKey,
      dateKey: pending.dateKey,
      staffName: pending.staffName,
      isNew: true,
      startTime: pending.startTime,
      endTime: pending.endTime,
      overrideApprovedInbox: pending.variant === "approved_inbox",
    });
    return;
  }
  if (pending.action === "dnd_move" && pending.payload && pending.targetStaffId && pending.targetDate) {
    completeScheduleDrop(pending.payload, pending.targetStaffId, pending.targetDate);
  }
}

function openScheduleShiftEdit({ staffKey, dateKey, startTime, endTime, staffName, isNew, overrideApprovedInbox }) {
  const isNewShift = Boolean(isNew);
  if (isNewShift && !overrideApprovedInbox) {
    const staff = getStaffByScheduleKey(schedulePreviewState.staffList, staffKey);
    if (staff && staffDayBlockedByApprovedInbox(staff, dateKey)) {
      const defaults = getDefaultShiftTimesForDate(dateKey);
      openScheduleAddShiftApprovedInboxConfirm({
        staffKey,
        dateKey,
        staffName,
        startTime: startTime || defaults.start,
        endTime: endTime || defaults.end,
      });
      return;
    }
  }
  const backdrop = ensureScheduleShiftEditModal();
  scheduleShiftEditPayload = {
    staffKey,
    dateKey,
    isNew: isNewShift,
    overrideApprovedInbox: Boolean(overrideApprovedInbox),
  };
  const title = document.getElementById("scheduleShiftEditTitle");
  const hint = document.getElementById("scheduleShiftEditHint");
  const removeBtn = document.getElementById("scheduleShiftEditRemove");
  const markOffBtn = document.getElementById("scheduleShiftEditMarkOff");
  const saveBtn = document.getElementById("scheduleShiftEditSave");
  const dayOpen = (getBusinessStatusForDate(dateKey).isOpen !== false);
  if (title) {
    title.textContent = isNewShift
      ? (staffName ? `Add shift — ${staffName}` : "Add shift")
      : (staffName ? `Edit shift — ${staffName}` : "Edit shift");
  }
  const canManual = scheduleUserCanManualEdit();
  if (hint) {
    const editStaff = getStaffByScheduleKey(schedulePreviewState.staffList, staffKey);
    const ph = editStaff ? getApprovedPartialRequestHints(editStaff, dateKey) : { lateStart: null, earlyLeave: null };
    const parts = [];
    if (ph.lateStart) parts.push(`Approved START ${formatScheduleTimeShortAmPm(ph.lateStart)}`);
    if (ph.earlyLeave) parts.push(`Approved leave by ${formatScheduleTimeShortAmPm(ph.earlyLeave)}`);
    if (parts.length > 0) {
      hint.innerHTML = `<span style="color:#0f766e;font-weight:600;">${parts.join(" · ")}</span>`;
      hint.style.display = "block";
    } else {
      hint.textContent = "";
      hint.style.display = canManual ? "block" : "none";
    }
  }
  if (removeBtn) removeBtn.style.display = !isNewShift && canManual ? "block" : "none";
  if (markOffBtn) markOffBtn.style.display = isNewShift && canManual && dayOpen ? "block" : "none";
  if (saveBtn) saveBtn.textContent = isNewShift ? "Add shift" : "Save";
  const defaults = getDefaultShiftTimesForDate(dateKey);
  const editStaffForDefaults = getStaffByScheduleKey(schedulePreviewState.staffList, staffKey);
  const phDefaults = editStaffForDefaults ? getApprovedPartialRequestHints(editStaffForDefaults, dateKey) : { lateStart: null, earlyLeave: null };
  let defStart = defaults.start;
  let defEnd = defaults.end;
  if (phDefaults.lateStart) defStart = laterScheduleHHMM(defStart, phDefaults.lateStart);
  if (phDefaults.earlyLeave) defEnd = earlierScheduleHHMM(defEnd, phDefaults.earlyLeave);
  const toInput = (t, fallback) => {
    const s = String(t || "").trim();
    return /^\d{2}:\d{2}$/.test(s) ? s : fallback;
  };
  const startEl = document.getElementById("scheduleShiftEditStart");
  const endEl = document.getElementById("scheduleShiftEditEnd");
  if (startEl) {
    startEl.value = toInput(
      isNewShift ? startTime || defStart : startTime || defStart,
      defStart,
    );
  }
  if (endEl) {
    endEl.value = toInput(isNewShift ? endTime || defEnd : endTime || defEnd, defEnd);
  }
  let existingAssign = null;
  if (!isNewShift && schedulePreviewState.draft) {
    const dEx = findDraftDay(schedulePreviewState.draft, dateKey);
    existingAssign =
      dEx && Array.isArray(dEx.assignments)
        ? dEx.assignments.find((x) => String(x.staffId || x.uid || "").trim() === staffKey)
        : null;
  }
  const lunchCb = document.getElementById("scheduleShiftEditLunchEnabled");
  const lunchSt = document.getElementById("scheduleShiftEditLunchStart");
  const lunchEn = document.getElementById("scheduleShiftEditLunchEnd");
  if (lunchCb) {
    lunchCb.checked = Boolean(existingAssign?.lunchBreakEnabled);
    lunchCb.disabled = !canManual;
  }
  if (lunchSt) {
    lunchSt.value = toInput(existingAssign?.lunchStartTime || "", "");
    lunchSt.disabled = !canManual;
  }
  if (lunchEn) {
    lunchEn.value = toInput(existingAssign?.lunchEndTime || "", "");
    lunchEn.disabled = !canManual;
  }
  syncScheduleShiftEditLunchRowVisibility();
  backdrop.style.display = "flex";
}

function closeScheduleShiftEdit() {
  const backdrop = document.getElementById("scheduleShiftEditBackdrop");
  if (backdrop) backdrop.style.display = "none";
  scheduleShiftEditPayload = null;
}

function hhmmFromTimeInput(v) {
  const s = String(v || "").trim();
  return /^\d{2}:\d{2}$/.test(s) ? s : null;
}

function scheduleUserCanManualEditLegacy() {
  if (typeof window !== "undefined" && typeof window.ffHasAdminAccess === "function" && window.ffHasAdminAccess()) {
    return true;
  }
  const r = String(typeof window !== "undefined" && window.__ff_user_role ? window.__ff_user_role : "").toLowerCase();
  return r === "owner" || r === "admin" || r === "manager";
}

/** Resolved from Staff → Permissions (schedule_*) when set; else legacy admin/manager behavior. */
function getScheduleAccessContext() {
  if (typeof window !== "undefined" && typeof window.ffGetSchedulePermissionContext === "function") {
    try {
      return window.ffGetSchedulePermissionContext();
    } catch (e) {
      console.warn("[ScheduleUI] ffGetSchedulePermissionContext failed", e);
    }
  }
  const le = scheduleUserCanManualEditLegacy();
  return { canEdit: le, viewAll: true, viewOwnOnly: false, readOnly: !le, noAccess: false };
}

/** Owner / permissions — can add shifts, edit hours, or mark OFF in the weekly preview. */
function scheduleUserCanManualEdit() {
  const ctx = getScheduleAccessContext();
  return ctx.noAccess ? false : ctx.canEdit === true;
}

function buildManualDraftAssignment(staff, start, end) {
  const role = getScheduleStaffRole(staff);
  let managerType = null;
  if (role === "manager") {
    managerType = staff?.managerType === "assistant_manager" ? "assistant_manager" : "manager";
  }
  return {
    staffId: getScheduleStaffKey(staff),
    uid: String(staff?.uid || staff?.userUid || "").trim() || null,
    name: String(staff?.name || "").trim() || "Unknown Staff",
    role,
    managerType,
    startTime: start,
    endTime: end,
    manualAdminEdit: true,
  };
}

function saveScheduleShiftEdit() {
  if (!scheduleShiftEditPayload || !schedulePreviewState.draft) return;
  const start = hhmmFromTimeInput(document.getElementById("scheduleShiftEditStart")?.value);
  const end = hhmmFromTimeInput(document.getElementById("scheduleShiftEditEnd")?.value);
  if (!start || !end) {
    window.alert("Please enter valid start and end times.");
    return;
  }
  if (start >= end) {
    window.alert("End time must be after start time.");
    return;
  }
  const lunchRes = readLunchBreakFieldsFromShiftEditForm(start, end);
  if (!lunchRes.ok) {
    window.alert(lunchRes.error);
    return;
  }
  const { staffKey, dateKey, isNew, overrideApprovedInbox } = scheduleShiftEditPayload;
  const staff = getStaffByScheduleKey(schedulePreviewState.staffList, staffKey);
  if (!staff) return;
  if (isNew && staffDayBlockedByApprovedInbox(staff, dateKey) && !overrideApprovedInbox) {
    ffScheduleAppToast(
      "This person has approved time off on this day. Update Inbox or pick another day.",
    );
    return;
  }

  if (!scheduleSaveSkipApprovedTimeConflictOnce) {
    const conflictMsg = getApprovedPartialTimeConflictMessage(staff, dateKey, start, end);
    if (conflictMsg) {
      openScheduleApprovedTimeConflictModal(conflictMsg.message, () => {
        scheduleSaveSkipApprovedTimeConflictOnce = true;
        try {
          saveScheduleShiftEdit();
        } finally {
          scheduleSaveSkipApprovedTimeConflictOnce = false;
        }
      });
      return;
    }
  }

  let draft = cloneScheduleDraft(schedulePreviewState.draft);
  const day = findDraftDay(draft, dateKey);
  if (!day) return;

  if (isNew) {
    if ((day.assignments || []).some((a) => String(a.staffId || a.uid || "").trim() === staffKey)) {
      window.alert("This cell already has a shift. Edit it with the pencil or remove it first.");
      return;
    }
    removeManualOffForStaffDay(draft, dateKey, staffKey);
    const newRow = buildManualDraftAssignment(staff, start, end);
    applyLunchBreakToAssignment(newRow, lunchRes);
    day.assignments = [...(day.assignments || []), newRow];
  } else {
    const idx = (day.assignments || []).findIndex((a) => String(a.staffId || a.uid || "").trim() === staffKey);
    if (idx < 0) return;
    const markManual = scheduleUserCanManualEdit();
    const merged = {
      ...day.assignments[idx],
      startTime: start,
      endTime: end,
      ...(markManual ? { manualAdminEdit: true } : {}),
    };
    applyLunchBreakToAssignment(merged, lunchRes);
    day.assignments[idx] = merged;
  }

  draft = applyBusinessSettingsToDraft(draft);
  revalidateLocalDraft(draft);
  renderScheduleSummary(schedulePreviewState.validation, schedulePreviewState.validation?.days || []);
  renderScheduleBoard(schedulePreviewState.draft, schedulePreviewState.validation, schedulePreviewState.staffList);
  closeScheduleShiftEdit();
}

function removeScheduleShiftFromDraft() {
  if (!scheduleShiftEditPayload || !schedulePreviewState.draft) return;
  const { staffKey, dateKey, isNew } = scheduleShiftEditPayload;
  if (isNew) {
    closeScheduleShiftEdit();
    return;
  }
  let draft = cloneScheduleDraft(schedulePreviewState.draft);
  const day = findDraftDay(draft, dateKey);
  if (!day) return;
  const idx = (day.assignments || []).findIndex((a) => String(a.staffId || a.uid || "").trim() === staffKey);
  if (idx < 0) return;
  day.assignments.splice(idx, 1);
  draft = applyBusinessSettingsToDraft(draft);
  revalidateLocalDraft(draft);
  renderScheduleSummary(schedulePreviewState.validation, schedulePreviewState.validation?.days || []);
  renderScheduleBoard(schedulePreviewState.draft, schedulePreviewState.validation, schedulePreviewState.staffList);
  closeScheduleShiftEdit();
}

function bindScheduleShiftEditButtons() {
  document.querySelectorAll("[data-schedule-edit-btn]").forEach((btn) => {
    if (btn.__ffEditBound) return;
    btn.__ffEditBound = true;
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const staffKey = String(btn.getAttribute("data-staff-id") || "").trim();
      const dateKey = String(btn.getAttribute("data-date") || "").trim();
      const startTime = String(btn.getAttribute("data-start") || "").trim();
      const endTime = String(btn.getAttribute("data-end") || "").trim();
      const staffName = String(btn.getAttribute("data-staff-name") || "").trim();
      openScheduleShiftEdit({ staffKey, dateKey, startTime, endTime, staffName, isNew: false });
    });
  });
}

function bindScheduleBoardManualAdd() {
  const board = document.getElementById("scheduleBoard");
  if (!board || board.__ffManualAddBound) return;
  board.__ffManualAddBound = true;
  board.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-schedule-manual-add]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (!scheduleUserCanManualEdit() || schedulePreviewMode !== "build") return;
    const staffKey = String(btn.getAttribute("data-staff-id") || "").trim();
    const dateKey = String(btn.getAttribute("data-date") || "").trim();
    const staffName = String(btn.getAttribute("data-staff-name") || "").trim();
    const defaults = getDefaultShiftTimesForDate(dateKey);
    const staff = getStaffByScheduleKey(schedulePreviewState.staffList, staffKey);
    const day = findDraftDay(schedulePreviewState.draft, dateKey);
    const approvedInbox =
      btn.getAttribute("data-approved-inbox") === "1" &&
      staff &&
      staffDayBlockedByApprovedInbox(staff, dateKey);
    if (approvedInbox) {
      openScheduleAddShiftApprovedInboxConfirm({
        staffKey,
        dateKey,
        staffName,
        startTime: defaults.start,
        endTime: defaults.end,
      });
      return;
    }
    if (staff && day && dayHasManualOff(day, staffKey)) {
      openScheduleAddShiftManualOffConfirm({
        staffKey,
        dateKey,
        staffName,
        startTime: defaults.start,
        endTime: defaults.end,
      });
      return;
    }
    openScheduleShiftEdit({
      staffKey,
      dateKey,
      staffName,
      isNew: true,
      startTime: defaults.start,
      endTime: defaults.end,
    });
  });
}

function getWeekStartsOnPreference() {
  const globalValue = (window.settings && window.settings.preferences && window.settings.preferences.weekStartsOn) || "";
  if (String(globalValue).toLowerCase() === "sunday") return "sunday";
  return "monday";
}

function getStartOfWeek(date) {
  const local = new Date(date);
  local.setHours(0, 0, 0, 0);
  const day = local.getDay();
  const weekStartsOn = getWeekStartsOnPreference();
  const diff = weekStartsOn === "sunday"
    ? -day
    : (day === 0 ? -6 : 1 - day);
  local.setDate(local.getDate() + diff);
  return local;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function syncScheduleWeekFilterUi() {
  const filterSelect = document.getElementById("scheduleWeekFilter");
  const customDateInput = document.getElementById("scheduleCustomWeekDate");
  const applyCustomButton = document.getElementById("scheduleApplyCustomWeekBtn");
  const isCustom = filterSelect?.value === "custom";
  if (customDateInput) {
    customDateInput.style.display = isCustom ? "inline-flex" : "none";
  }
  if (applyCustomButton) {
    applyCustomButton.style.display = isCustom ? "inline-flex" : "none";
  }
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getWeekRange(weekStartDate) {
  const start = getStartOfWeek(weekStartDate);
  const end = addDays(start, 6);
  return {
    startDate: toDateKey(start),
    endDate: toDateKey(end),
    start: start,
    end: end,
  };
}

function formatLongDate(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function formatWeekLabel(weekRange) {
  const start = weekRange?.start;
  const end = weekRange?.end;
  if (!start || !end) return "Schedule Preview";
  const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endLabel = end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${startLabel} - ${endLabel}`;
}

function getSchedulePublishDocRef() {
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  if (!salonId) return null;
  return doc(db, `salons/${salonId}/schedulePublish/weeks`);
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

function teardownSchedulePublishListener() {
  if (schedulePublishUnsub) {
    try {
      schedulePublishUnsub();
    } catch (_) {
      /* ignore */
    }
    schedulePublishUnsub = null;
  }
  schedulePublishSalonSubscribed = "";
  schedulePublishPrevMap = null;
  schedulePublishLastSeenBroadcastMs = null;
  lastSeenWeekDraftSnapshotJsonByWeek = {};
}

function ensureSchedulePublishListener() {
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  if (!salonId) {
    teardownSchedulePublishListener();
    return;
  }
  if (schedulePublishSalonSubscribed === salonId && schedulePublishUnsub) return;

  teardownSchedulePublishListener();
  schedulePublishSalonSubscribed = salonId;
  const ref = doc(db, `salons/${salonId}/schedulePublish/weeks`);
  schedulePublishUnsub = onSnapshot(
    ref,
    (snap) => {
      const data = snap.exists() ? snap.data() : {};
      const pub = data.published && typeof data.published === "object" ? data.published : {};
      const prevPublishedJson = JSON.stringify(schedulePublishedMap);
      schedulePublishedMap = { ...pub };
      const publishedVisibilityChanged = prevPublishedJson !== JSON.stringify(schedulePublishedMap);

      const drafts = data.weekDraftSnapshots && typeof data.weekDraftSnapshots === "object" ? data.weekDraftSnapshots : {};
      const wrSnap = getWeekRange(schedulePreviewWeekStart);
      const wsSnap = wrSnap.startDate;
      const blockJson = drafts[wsSnap] ? JSON.stringify(drafts[wsSnap]) : "";
      const prevBlock = Object.prototype.hasOwnProperty.call(lastSeenWeekDraftSnapshotJsonByWeek, wsSnap)
        ? lastSeenWeekDraftSnapshotJsonByWeek[wsSnap]
        : undefined;
      const weekDraftSnapshotChanged = prevBlock !== undefined && blockJson !== prevBlock;
      lastSeenWeekDraftSnapshotJsonByWeek[wsSnap] = blockJson;

      const bAt = data.lastBroadcastAt;
      const ms = bAt && typeof bAt.toMillis === "function" ? bAt.toMillis() : 0;
      const wk = String(data.lastBroadcastWeekKey || "").trim();

      if (schedulePublishLastSeenBroadcastMs === null) {
        schedulePublishLastSeenBroadcastMs = ms;
        schedulePublishPrevMap = { ...pub };
        schedulePublishSuppressToast = false;
      } else if (ms > schedulePublishLastSeenBroadcastMs && wk && !schedulePublishSuppressToast) {
        ffScheduleStaffBroadcastToast(6500);
        schedulePublishLastSeenBroadcastMs = ms;
        schedulePublishPrevMap = { ...pub };
      } else {
        schedulePublishLastSeenBroadcastMs = Math.max(schedulePublishLastSeenBroadcastMs, ms);
        schedulePublishPrevMap = { ...pub };
      }
      schedulePublishSuppressToast = false;

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
    schedulePublishedMap = { ...pub };
  } catch (e) {
    console.warn("[ScheduleUI] fetch schedule publish", e);
  }
}

/** Staff who only view the schedule see content only after the week is published; schedule editors always see drafts. */
function canViewScheduleBoardForCurrentWeek() {
  if (scheduleUserCanManualEdit()) return true;
  const ctx = getScheduleAccessContext();
  if (ctx.noAccess) return false;
  const weekRange = getWeekRange(schedulePreviewWeekStart);
  return schedulePublishedMap[weekRange.startDate] === true;
}

function updateSchedulePublishToggleUi() {
  const btn = document.getElementById("schedulePublishToggleBtn");
  const icon = document.getElementById("schedulePublishToggleIcon");
  const label = document.getElementById("schedulePublishToggleLabel");
  if (!btn) return;
  const canEdit = scheduleUserCanManualEdit();
  const buildUi = !canEdit || schedulePreviewMode === "build";
  btn.style.display = canEdit && buildUi ? "inline-flex" : "none";
  if (!canEdit) return;
  const weekRange = getWeekRange(schedulePreviewWeekStart);
  const published = schedulePublishedMap[weekRange.startDate] === true;
  btn.setAttribute("aria-pressed", published ? "true" : "false");
  btn.title = published
    ? "Published — staff can see this week. Click to hide until ready."
    : "Draft — hidden from staff. Click to publish and notify everyone.";
  if (icon) icon.textContent = published ? "\uD83D\uDC41\uFE0F" : "\uD83D\uDD12";
  if (label) label.textContent = published ? "Visible to staff" : "Hidden from staff";
  const notifyBtn = document.getElementById("scheduleNotifyChangesBtn");
  if (notifyBtn) {
    notifyBtn.style.display = canEdit && published && buildUi ? "inline-flex" : "none";
  }
  const discardBtn = document.getElementById("scheduleDiscardSavedDraftBtn");
  if (discardBtn) {
    discardBtn.style.display = canEdit && buildUi ? "inline-flex" : "none";
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
  const weekRange = getWeekRange(schedulePreviewWeekStart);
  const key = weekRange.startDate;
  const ref = getSchedulePublishDocRef();
  if (!ref) return;
  const nextPublished = !(schedulePublishedMap[key] === true);
  try {
    schedulePublishSuppressToast = true;
    if (nextPublished) {
      try {
        await updateDoc(ref, {
          [`published.${key}`]: true,
          lastBroadcastAt: serverTimestamp(),
          lastBroadcastWeekKey: key,
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        if (e?.code === "not-found") {
          await setDoc(ref, {
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
        schedulePreviewState.draft,
        schedulePreviewState.staffList,
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
    schedulePublishSuppressToast = false;
    ffScheduleAppToast(e?.message || "Could not update publish status.", 4000);
  }
}

function getSeverityBadgeStyle(severity) {
  if (severity === "high") return "background:#fee2e2;color:#b91c1c;border:1px solid #fecaca;";
  if (severity === "medium") return "background:#fef3c7;color:#b45309;border:1px solid #fde68a;";
  return "background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd;";
}

function getScheduleStaffRole(staff) {
  if (staff?.isAdmin === true) return "admin";
  const role = String(staff?.role || "").trim().toLowerCase();
  if (staff?.isManager === true || role === "manager" || role === "assistant_manager") return "manager";
  if (role === "front_desk") return "front_desk";
  return "technician";
}

function isManagementScheduleStaff(staff) {
  const role = getScheduleStaffRole(staff);
  return role === "admin" || role === "manager" || role === "front_desk";
}

function isTechnicianScheduleStaff(staff) {
  return getScheduleStaffRole(staff) === "technician";
}

function getFilteredScheduleStaff(staffList) {
  const ctx = getScheduleAccessContext();
  if (scheduleUserCanManualEdit() && schedulePreviewMode === "my_shifts") {
    const sid = getAuthedStaffIdForSchedule();
    if (!sid) return [];
    const me = (Array.isArray(staffList) ? staffList : []).find((staff) => getScheduleStaffKey(staff) === sid);
    return me ? [me] : [];
  }

  let filtered = (Array.isArray(staffList) ? staffList : []).filter((staff) => {
    return schedulePreviewView === "technicians"
      ? isTechnicianScheduleStaff(staff)
      : isManagementScheduleStaff(staff);
  });

  if (ctx.viewOwnOnly) {
    const sid = String(
      typeof window !== "undefined" && window.__ff_authedStaffId
        ? window.__ff_authedStaffId
        : (typeof localStorage !== "undefined" ? localStorage.getItem("ff_authedStaffId_v1") : "") || "",
    ).trim();
    if (sid) {
      filtered = filtered.filter((staff) => getScheduleStaffKey(staff) === sid);
    }
  }

  return filtered.sort((left, right) => {
    const leftRole = getScheduleStaffRole(left);
    const rightRole = getScheduleStaffRole(right);
    const leftRank = leftRole === "admin" ? 0 : leftRole === "manager" ? 1 : leftRole === "front_desk" ? 2 : 3;
    const rightRank = rightRole === "admin" ? 0 : rightRole === "manager" ? 1 : rightRole === "front_desk" ? 2 : 3;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return String(left?.name || "").localeCompare(String(right?.name || ""), undefined, { sensitivity: "base" });
  });
}

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

function getScheduleStaffKey(staff) {
  return String(staff?.id || staff?.staffId || staff?.uid || staff?.userUid || "").trim();
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
    schedulePreviewState?.standByByDate && typeof schedulePreviewState.standByByDate === "object"
      ? cloneStandByByDateMap(schedulePreviewState.standByByDate)
      : {};
  try {
    await setDoc(
      ref,
      {
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
 * Stand-by was only persisted to localStorage until "Notify staff"; VIEW users read Firestore, so they always saw "Not set".
 * After saving stand-by in the modal, merge `standByByDate` into the published week snapshot so everyone sees it without a separate notify.
 */
async function syncPublishedWeekStandByToCloud(weekStart) {
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  if (!salonId || !weekStart) return;
  if (schedulePublishedMap[weekStart] !== true) return;
  if (!scheduleUserCanManualEdit()) return;
  const ref = getSchedulePublishDocRef();
  if (!ref) return;
  const standByByDate =
    schedulePreviewState?.standByByDate && typeof schedulePreviewState.standByByDate === "object"
      ? cloneStandByByDateMap(schedulePreviewState.standByByDate)
      : {};
  try {
    await setDoc(
      ref,
      {
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
  const weekRange = getWeekRange(schedulePreviewWeekStart);
  const key = weekRange.startDate;
  if (schedulePublishedMap[key] !== true) {
    ffScheduleAppToast("Publish this week to staff before notifying about changes.", 4000);
    return;
  }
  const draft = schedulePreviewState.draft;
  const staffList = schedulePreviewState.staffList;
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
    { standByByDate: schedulePreviewState?.standByByDate },
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
  for (const sid of changed) {
    const pingRef = doc(db, `salons/${salonId}/scheduleStaffChangePings/${key}_${sid}`);
    batch.set(
      pingRef,
      {
        salonId,
        weekStart: key,
        staffId: sid,
        pingAt: serverTimestamp(),
      },
      { merge: true },
    );
  }
  const standByByDate =
    schedulePreviewState?.standByByDate && typeof schedulePreviewState.standByByDate === "object"
      ? cloneStandByByDateMap(schedulePreviewState.standByByDate)
      : {};
  batch.set(
    weeksRef,
    {
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
    const wrAfter = getWeekRange(schedulePreviewWeekStart);
    clearSharedScheduleDraftOverrideForWeek(wrAfter);
    clearScheduleLocalDirtyForCurrentUser(key);
    if (changed.length === 0 && standByChanged) {
      ffScheduleAppToast("Stand by updated for this week (saved to the cloud).", 4000);
    } else {
      ffScheduleAppToast(`Notified ${changed.length} staff member(s) with updated shifts.`, 4500);
    }
    await loadScheduleWeekPingMap(key);
    if (
      schedulePreviewState.draft &&
      scheduleUserCanManualEdit() &&
      schedulePreviewMode === "build" &&
      document.getElementById("scheduleScreen")?.style.display !== "none"
    ) {
      renderScheduleBoard(
        schedulePreviewState.draft,
        schedulePreviewState.validation,
        schedulePreviewState.staffList,
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

function getSchedulePreviewSalonStorageKey() {
  const s = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  return s || "_local";
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
  const weekRange = getWeekRange(schedulePreviewWeekStart);
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
  await refreshSchedulePreview();
  ffScheduleAppToast("Schedule rebuilt from rules for this week.", 4000);
}

async function discardSavedScheduleWeekDraftAndReload() {
  if (!scheduleUserCanManualEdit()) return;
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  if (!salonId) {
    ffScheduleAppToast("No salon selected.", 3500);
    return;
  }
  const weekRange = getWeekRange(schedulePreviewWeekStart);
  const weekStart = weekRange.startDate;
  if (!weekStart) return;
  const el = ensureScheduleRebuildConfirmModal();
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
  const weekRange = schedulePreviewState.weekRange;
  const draft = schedulePreviewState.draft;
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
          schedulePreviewState.standByByDate && typeof schedulePreviewState.standByByDate === "object"
            ? cloneStandByByDateMap(schedulePreviewState.standByByDate)
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
  if (!scheduleShiftEditPayload || !schedulePreviewState.draft) return;
  const { staffKey, dateKey, isNew } = scheduleShiftEditPayload;
  if (!isNew || !scheduleUserCanManualEdit()) return;
  const staff = getStaffByScheduleKey(schedulePreviewState.staffList, staffKey);
  if (!staff) return;
  const bs = getBusinessStatusForDate(dateKey);
  if (bs.isOpen === false) {
    window.alert("This day is closed for the business.");
    return;
  }
  let draft = cloneScheduleDraft(schedulePreviewState.draft);
  const day = findDraftDay(draft, dateKey);
  if (!day) return;
  if ((day.assignments || []).some((a) => String(a.staffId || a.uid || "").trim() === staffKey)) {
    window.alert("This cell already has a shift. Edit or remove it first.");
    return;
  }
  addManualOffForStaffDay(draft, dateKey, staffKey);
  draft = applyBusinessSettingsToDraft(draft);
  revalidateLocalDraft(draft);
  renderScheduleSummary(schedulePreviewState.validation, schedulePreviewState.validation?.days || []);
  renderScheduleBoard(schedulePreviewState.draft, schedulePreviewState.validation, schedulePreviewState.staffList);
  closeScheduleShiftEdit();
}

/** Full-day approved block (vacation / schedule_change / day off) — not late_start / early_leave partial windows. */
function staffDayBlockedByApprovedInbox(staff, dateKey) {
  const requests = Array.isArray(schedulePreviewState.requests) ? schedulePreviewState.requests : [];
  const bh =
    schedulePreviewState.businessHours && typeof schedulePreviewState.businessHours === "object"
      ? schedulePreviewState.businessHours
      : undefined;
  const av = getEffectiveAvailabilityForDate(staff, requests, dateKey, { businessHours: bh });
  if (!av || !av.hasApprovedOverride) return false;
  const hasBlockingOverride = Array.isArray(av.overrides) && av.overrides.some((o) => o && o.mode === "unavailable");
  return Boolean(av.isAvailable === false && hasBlockingOverride);
}

function compareScheduleHHMM(a, b) {
  const ma = parseScheduleTimeToMinutes(a);
  const mb = parseScheduleTimeToMinutes(b);
  if (ma == null || mb == null) return 0;
  return ma - mb;
}

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

function formatWeeklyHoursShort(totalMinutes) {
  if (!totalMinutes || totalMinutes <= 0) return "0h";
  const h = totalMinutes / 60;
  const rounded = Math.round(h * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 0.05) return `${Math.round(rounded)}h`;
  return `${rounded.toFixed(1)}h`;
}

/** "HH:mm" -> compact label e.g. "11 AM", "2:30 PM" */
function formatScheduleTimeShortAmPm(hhmm) {
  const m = parseScheduleTimeToMinutes(String(hhmm || "").trim());
  if (m == null) return String(hhmm || "").trim() || "";
  const h24 = Math.floor(m / 60) % 24;
  const min = m % 60;
  const isAm = h24 < 12;
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  const minPart = min === 0 ? "" : `:${String(min).padStart(2, "0")}`;
  return `${h12}${minPart} ${isAm ? "AM" : "PM"}`;
}

function laterScheduleHHMM(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return compareScheduleHHMM(a, b) >= 0 ? a : b;
}

function earlierScheduleHHMM(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return compareScheduleHHMM(a, b) <= 0 ? a : b;
}

/** Inbox partial times from raw requests (not merged with vacation). */
function getApprovedPartialRequestHints(staff, dateKey) {
  const requests = Array.isArray(schedulePreviewState.requests) ? schedulePreviewState.requests : [];
  const d = getInboxApprovalDisplayForDate(staff, requests, dateKey);
  return { lateStart: d.lateStart, earlyLeave: d.earlyLeave };
}

/** Returns { kind, message } if shift times conflict with approved partial request; otherwise null. */
function getApprovedPartialTimeConflictMessage(staff, dateKey, shiftStart, shiftEnd) {
  const { lateStart, earlyLeave } = getApprovedPartialRequestHints(staff, dateKey);
  const start = hhmmFromTimeInput(shiftStart);
  const end = hhmmFromTimeInput(shiftEnd);
  if (!start || !end) return null;
  if (lateStart && compareScheduleHHMM(start, lateStart) < 0) {
    return {
      kind: "late_start",
      message: `Approved START ${formatScheduleTimeShortAmPm(lateStart)} or later. Shift starts ${formatScheduleTimeShortAmPm(start)}. Save anyway?`,
    };
  }
  if (earlyLeave && compareScheduleHHMM(end, earlyLeave) > 0) {
    return {
      kind: "early_leave",
      message: `Approved leave by ${formatScheduleTimeShortAmPm(earlyLeave)}. Shift ends ${formatScheduleTimeShortAmPm(end)}. Save anyway?`,
    };
  }
  return null;
}

function getAssignmentFromDragPayload(payload) {
  const day = findDraftDay(schedulePreviewState.draft, payload?.sourceDate);
  const list = Array.isArray(day?.assignments) ? day.assignments : [];
  return (
    list.find(
      (a) =>
        getAssignmentId(a, payload.sourceDate) === payload.shiftId &&
        String(a.staffId || a.uid || "").trim() === payload.sourceStaffId,
    ) || null
  );
}

function ensureScheduleApprovedTimeConflictModal() {
  if (document.getElementById("scheduleApprovedTimeConflictBackdrop")) {
    return document.getElementById("scheduleApprovedTimeConflictBackdrop");
  }
  const backdrop = document.createElement("div");
  backdrop.id = "scheduleApprovedTimeConflictBackdrop";
  backdrop.style.cssText =
    "display:none;position:fixed;inset:0;background:rgba(15,23,42,0.5);z-index:4150;align-items:center;justify-content:center;padding:20px;";
  backdrop.innerHTML = `
    <div role="dialog" aria-modal="true" aria-labelledby="scheduleApprovedTimeConflictTitle" style="background:#fff;border-radius:16px;padding:24px 26px;max-width:460px;width:100%;box-shadow:0 25px 50px -12px rgba(0,0,0,0.28);">
      <div id="scheduleApprovedTimeConflictTitle" style="font-size:18px;font-weight:700;color:#111827;margin-bottom:10px;">Does not match approved request</div>
      <p id="scheduleApprovedTimeConflictBody" style="margin:0 0 22px 0;font-size:14px;color:#4b5563;line-height:1.55;"></p>
      <div style="display:flex;gap:12px;justify-content:flex-end;flex-wrap:wrap;">
        <button type="button" id="scheduleApprovedTimeConflictCancel" style="padding:10px 18px;border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-weight:600;cursor:pointer;font-size:14px;">Cancel</button>
        <button type="button" id="scheduleApprovedTimeConflictOk" style="padding:10px 18px;border-radius:10px;border:none;background:#7c3aed;color:#fff;font-weight:600;cursor:pointer;font-size:14px;">Yes, use these times</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeScheduleApprovedTimeConflictModal();
  });
  document.getElementById("scheduleApprovedTimeConflictCancel")?.addEventListener("click", closeScheduleApprovedTimeConflictModal);
  document.getElementById("scheduleApprovedTimeConflictOk")?.addEventListener("click", confirmScheduleApprovedTimeConflictModal);
  return backdrop;
}

function closeScheduleApprovedTimeConflictModal() {
  const el = document.getElementById("scheduleApprovedTimeConflictBackdrop");
  if (el) el.style.display = "none";
  scheduleApprovedTimeConflictContinue = null;
}

function openScheduleApprovedTimeConflictModal(message, onConfirm) {
  scheduleApprovedTimeConflictContinue = onConfirm;
  const body = document.getElementById("scheduleApprovedTimeConflictBody");
  if (body) body.textContent = message;
  const el = ensureScheduleApprovedTimeConflictModal();
  el.style.display = "flex";
}

function confirmScheduleApprovedTimeConflictModal() {
  const fn = scheduleApprovedTimeConflictContinue;
  closeScheduleApprovedTimeConflictModal();
  if (typeof fn === "function") {
    try {
      fn();
    } catch (e) {
      console.error("[ScheduleUI] approved time conflict confirm", e);
    }
  }
}

function getStaffByScheduleKey(staffList, scheduleKey) {
  return (Array.isArray(staffList) ? staffList : []).find((staff) => getScheduleStaffKey(staff) === scheduleKey) || null;
}

function remapAssignmentToStaff(assignment, staff) {
  const mapped = { ...assignment };
  const targetKey = getScheduleStaffKey(staff);
  const targetUid = String(staff?.uid || staff?.userUid || "").trim() || null;
  mapped.staffId = targetKey || null;
  mapped.uid = targetUid;
  mapped.name = String(staff?.name || mapped.name || "").trim() || mapped.name || "Unknown Staff";
  mapped.role = getScheduleStaffRole(staff);
  mapped.managerType = mapped.role === "manager" ? (staff?.managerType || "manager") : null;
  if (scheduleUserCanManualEdit()) {
    mapped.manualAdminEdit = true;
  }
  return mapped;
}

function revalidateLocalDraft(nextDraft) {
  const coverageRules = schedulePreviewState.coverageRules !== undefined
    ? schedulePreviewState.coverageRules
    : (window.settings && typeof window.settings.coverageRules === "object" ? window.settings.coverageRules : undefined);
  const requests = Array.isArray(schedulePreviewState.requests) ? schedulePreviewState.requests : [];
  const nextValidation = validateScheduleDraft({
    draftSchedule: nextDraft,
    staffList: schedulePreviewState.staffList,
    requests,
    rules: nextDraft?.rules || schedulePreviewState.draft?.rules || {},
    coverageRules,
    dateRange: schedulePreviewState.weekRange
      ? { startDate: schedulePreviewState.weekRange.startDate, endDate: schedulePreviewState.weekRange.endDate }
      : undefined,
  });

  schedulePreviewState = {
    ...schedulePreviewState,
    draft: nextDraft,
    validation: nextValidation,
  };
  if (typeof window !== "undefined") {
    window.ffSchedulePreviewState = schedulePreviewState;
  }
  persistScheduleDraftOverrideFromState();
}

function clearDropZoneVisual(zone) {
  if (!zone) return;
  zone.style.outline = "";
  zone.style.outlineOffset = "";
}

function handleShiftDragStart(event) {
  if (!scheduleUserCanManualEdit() || schedulePreviewMode !== "build") {
    event.preventDefault();
    return;
  }
  const shiftEl = event.currentTarget;
  if (!shiftEl) return;
  const payload = {
    shiftId: String(shiftEl.getAttribute("data-shift-id") || "").trim(),
    sourceStaffId: String(shiftEl.getAttribute("data-staff-id") || "").trim(),
    sourceDate: String(shiftEl.getAttribute("data-date") || "").trim(),
  };
  scheduleDragState = payload;
  try {
    event.dataTransfer.setData("text/plain", JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "move";
  } catch (_) {}
  shiftEl.style.opacity = "0.55";
  console.log("[Schedule DnD] dragstart", payload);
}

function handleShiftDragEnd(event) {
  if (event?.currentTarget) {
    event.currentTarget.style.opacity = "1";
  }
  document.querySelectorAll('[data-drop-zone="true"]').forEach((zone) => clearDropZoneVisual(zone));
  scheduleDragState = null;
}

function handleDropZoneDragOver(event) {
  if (!scheduleUserCanManualEdit() || schedulePreviewMode !== "build") return;
  event.preventDefault();
  const zone = event.currentTarget;
  if (!zone) return;
  try {
    event.dataTransfer.dropEffect = "move";
  } catch (_) {}
  zone.style.outline = "2px dashed rgba(124,58,237,0.45)";
  zone.style.outlineOffset = "-3px";
}

function handleDropZoneDragLeave(event) {
  clearDropZoneVisual(event.currentTarget);
}

function moveDraftAssignment(payload, targetStaffId, targetDate) {
  const nextDraft = cloneScheduleDraft(schedulePreviewState.draft);
  const sourceDay = findDraftDay(nextDraft, payload.sourceDate);
  const targetDay = findDraftDay(nextDraft, targetDate);
  const sourceStaff = getStaffByScheduleKey(schedulePreviewState.staffList, payload.sourceStaffId);
  const targetStaff = getStaffByScheduleKey(schedulePreviewState.staffList, targetStaffId);
  if (!sourceDay || !targetDay || !sourceStaff || !targetStaff) return null;

  const sourceAssignments = Array.isArray(sourceDay.assignments) ? sourceDay.assignments : [];
  const targetAssignments = Array.isArray(targetDay.assignments) ? targetDay.assignments : [];

  const sourceIndex = sourceAssignments.findIndex((assignment) => {
    return getAssignmentId(assignment, payload.sourceDate) === payload.shiftId
      && String(assignment.staffId || assignment.uid || "").trim() === payload.sourceStaffId;
  });
  if (sourceIndex === -1) return null;

  const [sourceAssignment] = sourceAssignments.splice(sourceIndex, 1);
  const targetIndex = targetAssignments.findIndex((assignment) => {
    return String(assignment.staffId || assignment.uid || "").trim() === targetStaffId;
  });

  const movedAssignment = remapAssignmentToStaff(sourceAssignment, targetStaff);

  if (targetIndex >= 0) {
    const targetAssignment = targetAssignments[targetIndex];
    targetAssignments[targetIndex] = movedAssignment;
    sourceAssignments.push(remapAssignmentToStaff(targetAssignment, sourceStaff));
  } else {
    targetAssignments.push(movedAssignment);
  }

  sourceDay.assignments = sourceAssignments;
  targetDay.assignments = targetAssignments;
  removeManualOffForStaffDay(nextDraft, targetDate, targetStaffId);
  return nextDraft;
}

function completeScheduleDrop(payload, targetStaffId, targetDate, options = {}) {
  if (!options.skipApprovedTimeConflictCheck) {
    const targetStaff = getStaffByScheduleKey(schedulePreviewState.staffList, targetStaffId);
    const sourceAssignment = getAssignmentFromDragPayload(payload);
    if (targetStaff && sourceAssignment) {
      const conflictMsg = getApprovedPartialTimeConflictMessage(
        targetStaff,
        targetDate,
        sourceAssignment.startTime,
        sourceAssignment.endTime,
      );
      if (conflictMsg) {
        openScheduleApprovedTimeConflictModal(conflictMsg.message, () => {
          completeScheduleDrop(payload, targetStaffId, targetDate, { skipApprovedTimeConflictCheck: true });
        });
        return;
      }
    }
  }

  const nextDraft = moveDraftAssignment(payload, targetStaffId, targetDate);
  console.log("[Schedule DnD] drop", { payload, targetStaffId, targetDate });
  if (!nextDraft) return;

  revalidateLocalDraft(nextDraft);
  renderScheduleSummary(schedulePreviewState.validation, schedulePreviewState.validation?.days || []);
  renderScheduleViewTabs();
  renderScheduleBoard(schedulePreviewState.draft, schedulePreviewState.validation, schedulePreviewState.staffList);
}

function handleDropZoneDrop(event) {
  event.preventDefault();
  if (!scheduleUserCanManualEdit() || schedulePreviewMode !== "build") return;
  const zone = event.currentTarget;
  clearDropZoneVisual(zone);
  const targetStaffId = String(zone?.getAttribute("data-staff-id") || "").trim();
  const targetDate = String(zone?.getAttribute("data-date") || "").trim();
  const payload = scheduleDragState;
  if (!payload || !payload.shiftId || !payload.sourceStaffId || !payload.sourceDate || !targetStaffId || !targetDate) return;
  if (payload.sourceStaffId === targetStaffId && payload.sourceDate === targetDate) return;

  const targetStaff = getStaffByScheduleKey(schedulePreviewState.staffList, targetStaffId);
  if (targetStaff && staffDayBlockedByApprovedInbox(targetStaff, targetDate)) {
    openScheduleDnDOffConfirm({
      variant: "approved_inbox",
      payload,
      targetStaffId,
      targetDate,
    });
    return;
  }

  const targetDayPreview = findDraftDay(schedulePreviewState.draft, targetDate);
  if (targetDayPreview && dayHasManualOff(targetDayPreview, targetStaffId)) {
    openScheduleDnDOffConfirm({ variant: "manual_off", payload, targetStaffId, targetDate });
    return;
  }

  completeScheduleDrop(payload, targetStaffId, targetDate);
}

function bindScheduleBoardDnD() {
  document.querySelectorAll('[data-schedule-shift="true"]').forEach((el) => {
    if (el.__ffDnDBound) return;
    el.__ffDnDBound = true;
    el.addEventListener("dragstart", handleShiftDragStart);
    el.addEventListener("dragend", handleShiftDragEnd);
  });

  document.querySelectorAll('[data-drop-zone="true"]').forEach((zone) => {
    if (zone.__ffDnDBound) return;
    zone.__ffDnDBound = true;
    zone.addEventListener("dragover", handleDropZoneDragOver);
    zone.addEventListener("dragleave", handleDropZoneDragLeave);
    zone.addEventListener("drop", handleDropZoneDrop);
  });
}

function getValidationByDate(validation) {
  return new Map((Array.isArray(validation?.days) ? validation.days : []).map((day) => [day.date, day]));
}

/** Warnings tied to configured quotas (managers/FD line, techs, totals). Not availability quirks — so counts track staffing, not side effects. */
const SCHEDULE_COVERAGE_WARNING_CODES = new Set([
  "no_staff_assigned",
  "assistant_manager_count_below_minimum",
  "segment_coverage_shortfall",
  "no_technician_assigned",
  "below_min_total_staff",
  "assistant_manager_without_manager",
  "manager_count_below_minimum",
  "no_front_desk_assigned",
  "no_manager_assigned",
]);

function filterCoverageWarnings(warnings) {
  return (Array.isArray(warnings) ? warnings : []).filter((w) => w && SCHEDULE_COVERAGE_WARNING_CODES.has(w.code));
}

function filterNonCoverageWarnings(warnings) {
  return (Array.isArray(warnings) ? warnings : []).filter((w) => w && !SCHEDULE_COVERAGE_WARNING_CODES.has(w.code));
}

function warningAppliesToStaffRow(warning, staffKey, staff) {
  if (!warning || warning.code !== "assigned_staff_unavailable") return false;
  const sid = String(warning.staffId || "").trim();
  const uid = String(warning.uid || "").trim();
  if (sid && sid === staffKey) return true;
  const staffUid = String(staff?.uid || staff?.userUid || "").trim();
  if (uid && staffUid && uid === staffUid) return true;
  return false;
}

/** Row/cell orange dot: row-specific issues only (e.g. availability). Coverage quota hints are not shown on the board — segment rules are visible in Settings. */
function cellShowsScheduleWarningDot(dayWarnings, staffKey, staff) {
  const list = Array.isArray(dayWarnings) ? dayWarnings : [];
  return list.some((w) => warningAppliesToStaffRow(w, staffKey, staff));
}

function formatBoardDayLabel(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return { title: dateKey, subtitle: "" };
  return {
    title: date.toLocaleDateString("en-US", { weekday: "short" }),
    subtitle: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  };
}

function getDayNameFromDateKey(dateKey) {
  const date = new Date(`${String(dateKey || "").trim()}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][date.getDay()];
}

function normalizeTimeValue(value) {
  const candidate = String(value || "").trim();
  return /^\d{2}:\d{2}$/.test(candidate) ? candidate : null;
}

function maxTimeValue(a, b) {
  const left = normalizeTimeValue(a);
  const right = normalizeTimeValue(b);
  if (!left) return right;
  if (!right) return left;
  return left.localeCompare(right) >= 0 ? left : right;
}

function minTimeValue(a, b) {
  const left = normalizeTimeValue(a);
  const right = normalizeTimeValue(b);
  if (!left) return right;
  if (!right) return left;
  return left.localeCompare(right) <= 0 ? left : right;
}

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
      } else {
        const segs = Array.isArray(businessStatus.shiftSegments) ? businessStatus.shiftSegments : [];
        assignments = assignments
          .map((assignment) => {
            if (segs.length === 1) {
              const clipped = clipTimeWindowToBestShiftSegment(
                assignment.startTime,
                assignment.endTime,
                segs,
              );
              if (!clipped) return null;
              return {
                ...assignment,
                startTime: clipped.startTime,
                endTime: clipped.endTime,
              };
            }
            if (segs.length > 1) {
              const startTime = maxTimeValue(assignment.startTime, businessStatus.openTime);
              const endTime = minTimeValue(assignment.endTime, businessStatus.closeTime);
              if (!startTime || !endTime || startTime >= endTime) return null;
              return {
                ...assignment,
                startTime,
                endTime,
              };
            }
            const startTime = maxTimeValue(assignment.startTime, businessStatus.openTime);
            const endTime = minTimeValue(assignment.endTime, businessStatus.closeTime);
            if (!startTime || !endTime || startTime >= endTime) return null;
            return {
              ...assignment,
              startTime,
              endTime,
            };
          })
          .filter(Boolean);
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

function renderScheduleViewTabs() {
  const modeWrap = document.getElementById("scheduleModeToggleWrap");
  const canEdit = scheduleUserCanManualEdit();
  if (modeWrap) {
    modeWrap.style.display = canEdit ? "inline-flex" : "none";
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
  applyModeState(myShiftsBtn, schedulePreviewMode === "my_shifts", true);
  applyModeState(buildScheduleBtn, schedulePreviewMode === "build", false);

  const toggleWrap = document.getElementById("scheduleViewToggleWrap");
  if (toggleWrap) {
    const ctx = getScheduleAccessContext();
    const showTeamTabs = canEdit && schedulePreviewMode === "build" && !ctx.viewOwnOnly;
    toggleWrap.style.display = showTeamTabs ? "inline-flex" : "none";
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
  applyState(managementBtn, schedulePreviewView === "management", true);
  applyState(techniciansBtn, schedulePreviewView === "technicians", false);
}

async function loadScheduleStaffList() {
  if (typeof window.ffStaffForceLoad === "function") {
    try { await window.ffStaffForceLoad(); } catch (_) {}
  }
  const store = typeof window.ffGetStaffStore === "function" ? window.ffGetStaffStore() : { staff: [] };
  return (Array.isArray(store?.staff) ? store.staff : []).filter((staff) => staff && staff.isArchived !== true);
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
  const mapDoc = (docSnap) => ({ id: docSnap.id, ...docSnap.data() });
  const keepScheduleType = (item) =>
    SCHEDULE_INBOX_TYPES_FOR_AVAILABILITY.has(String(item?.type || "").trim());
  const filterPipeline = (docs) =>
    docs.map(mapDoc).filter(keepScheduleType).filter(isApprovedRequest);

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

function renderScheduleSummary(validation, days) {
  const summaryBar = document.getElementById("scheduleSummaryBar");
  if (!summaryBar) return;
  if (scheduleUserCanManualEdit() && schedulePreviewMode === "my_shifts") {
    summaryBar.innerHTML = `<span style="font-size:12px;color:#6b7280;">Your shifts only — switch to <strong>Team view</strong> to edit the full team.</span>`;
    return;
  }
  const summary = validation?.summary || { totalWarnings: 0, highSeverityCount: 0, mediumSeverityCount: 0 };
  const dayList = Array.isArray(days) ? days : [];
  const coverageCount = dayList.reduce((n, day) => n + filterCoverageWarnings(day?.warnings).length, 0);
  const total = summary.totalWarnings || 0;
  const otherCount = Math.max(0, total - coverageCount);

  if (otherCount === 0) {
    summaryBar.innerHTML = "";
    return;
  }

  summaryBar.innerHTML = `<span style="display:inline-flex;padding:4px 10px;border-radius:999px;background:#fffbeb;color:#b45309;border:1px solid #fcd34d;font-size:12px;font-weight:600;">${otherCount} issue${otherCount === 1 ? "" : "s"}</span>`;
}

function setSchedulePreviewMode(mode) {
  schedulePreviewMode = mode === "my_shifts" ? "my_shifts" : "build";
  renderScheduleViewTabs();
  updateSchedulePublishToggleUi();
  const weekRange = schedulePreviewState.weekRange || getWeekRange(schedulePreviewWeekStart);
  if (schedulePublishedMap[weekRange.startDate] === true) {
    teardownScheduleChangePingListener();
    ensureScheduleChangePingListener(weekRange.startDate);
  }
  updateScheduleWeekAckStrip();
  if (!canViewScheduleBoardForCurrentWeek()) {
    renderScheduleUnpublishedPlaceholder(weekRange);
    return;
  }
  renderScheduleBoard(schedulePreviewState.draft, schedulePreviewState.validation, schedulePreviewState.staffList);
  renderScheduleSummary(schedulePreviewState.validation, schedulePreviewState.validation?.days || []);
}

function setSchedulePreviewView(view) {
  schedulePreviewView = view === "technicians" ? "technicians" : "management";
  renderScheduleViewTabs();
  if (!canViewScheduleBoardForCurrentWeek()) {
    const wr = schedulePreviewState.weekRange || getWeekRange(schedulePreviewWeekStart);
    renderScheduleUnpublishedPlaceholder(wr);
    return;
  }
  renderScheduleBoard(schedulePreviewState.draft, schedulePreviewState.validation, schedulePreviewState.staffList);
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

let scheduleStandByModalDateKey = null;

function closeScheduleStandByModal() {
  const backdrop = document.getElementById("scheduleStandByModalBackdrop");
  if (backdrop) backdrop.style.display = "none";
  scheduleStandByModalDateKey = null;
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
    if (!scheduleStandByModalDateKey) return;
    const sel1 = document.getElementById("scheduleStandByModalSelect1");
    const sel2 = document.getElementById("scheduleStandByModalSelect2");
    const id1 = String(sel1?.value || "").trim();
    const id2 = String(sel2?.value || "").trim();
    const viewKey = schedulePreviewView === "technicians" ? "technicians" : "management";
    const dk = scheduleStandByModalDateKey;
    const prevMap =
      schedulePreviewState.standByByDate && typeof schedulePreviewState.standByByDate === "object"
        ? cloneStandByByDateMap(schedulePreviewState.standByByDate)
        : {};
    const base = parseStandByDayEntry(prevMap[dk]);
    prevMap[dk] = {
      ...base,
      [viewKey]: [id1, id2],
    };
    if (!standByDayEntryHasAny(prevMap[dk])) delete prevMap[dk];
    schedulePreviewState.standByByDate = prevMap;
    if (typeof window !== "undefined") {
      window.ffSchedulePreviewState = schedulePreviewState;
    }
    persistScheduleDraftOverrideFromState();
    const wr = schedulePreviewState.weekRange || getWeekRange(schedulePreviewWeekStart);
    const ws = wr?.startDate;
    if (ws && schedulePublishedMap[ws] === true) {
      void syncPublishedWeekStandByToCloud(ws);
    }
    closeScheduleStandByModal();
    renderScheduleBoard(
      schedulePreviewState.draft,
      schedulePreviewState.validation,
      schedulePreviewState.staffList,
    );
  });
  return backdrop;
}

function openScheduleStandByModal(dateKey) {
  const backdrop = ensureScheduleStandByModal();
  scheduleStandByModalDateKey = String(dateKey || "").trim();
  const dk = scheduleStandByModalDateKey;
  const dayLabel = formatBoardDayLabel(dk);
  const titleEl = document.getElementById("scheduleStandByModalTitle");
  const subEl = document.getElementById("scheduleStandByModalSubtitle");
  const tab = schedulePreviewView === "technicians" ? "Service Providers" : "Management";
  const viewKey = schedulePreviewView === "technicians" ? "technicians" : "management";
  if (titleEl) titleEl.textContent = `Stand by (${tab}) — ${dayLabel.title} ${dayLabel.subtitle}`;
  if (subEl) {
    subEl.textContent = `Up to two contacts for this day. Lists only ${tab} staff. The other tab has its own stand-by row.`;
  }
  const staffOpts = getFilteredScheduleStaff(schedulePreviewState.staffList);
  const entry = parseStandByDayEntry(schedulePreviewState.standByByDate?.[dk]);
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
    if (!scheduleUserCanManualEdit() || schedulePreviewMode !== "build") return;
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
    const range = `${fmt(m.lo)}–${fmt(m.hi)}`;
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
  const validationByDate = getValidationByDate(schedulePreviewState.validation);
  const dayEntry = validationByDate.get(dateKey);
  const cov = filterCoverageWarnings(dayEntry?.warnings);
  const helpers = window.ffScheduleHelpers;
  const dayName = getDayNameFromDateKey(dateKey);
  const businessHours = window.settings?.businessHours || {};
  const dayShiftSegments = window.settings?.dayShiftSegments || {};
  const coverageRules = window.settings?.coverageRules || {};
  const draftDay = findDraftDay(schedulePreviewState.draft, dateKey);
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
    if (!scheduleUserCanManualEdit() || schedulePreviewMode !== "build") return;
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
  const canBuild = scheduleUserCanManualEdit() && schedulePreviewMode === "build";
  const canManual = canBuild;

  if (!draftDays.length || !filteredStaff.length) {
    board.innerHTML = "";
    empty.style.display = "block";
    empty.textContent = !draftDays.length
      ? "No schedule preview available for this week."
      : scheduleUserCanManualEdit() && schedulePreviewMode === "my_shifts"
        ? "Your staff profile was not found in this week's roster."
        : `No ${schedulePreviewView === "management" ? "management staff" : "technicians"} available for this week.`;
    return;
  }

  empty.style.display = "none";
  const wrAck = getWeekRange(schedulePreviewWeekStart);
  const weekPubForAck = schedulePublishedMap[wrAck.startDate] === true;
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
    const showCoverageStar =
      canBuild && businessStatus.isOpen !== false && coverageWarnings.length > 0;
    const coverageStarHtml = showCoverageStar
      ? `<button type="button" data-schedule-coverage-day="true" data-date="${escapeScheduleAttr(day.date)}" title="Coverage staffing — open details" aria-label="Coverage staffing issues for this day" style="flex-shrink:0;margin:0;padding:0 4px;border:none;background:transparent;color:#ea580c;font-size:20px;font-weight:800;line-height:1;cursor:pointer;align-self:flex-start;">*</button>`
      : "";
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

  const rowHtml = filteredStaff.map((staff) => {
    const staffKey = getScheduleStaffKey(staff);
    const roleLabel = getScheduleRoleLabel(staff);
    const techTypes = Array.isArray(staff.technicianTypes) && staff.technicianTypes.length > 0
      ? staff.technicianTypes
          .filter(t => t !== 'all_technicians')
          .map(t => String(t).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
          .join(', ')
      : null;
    const allowCellEdit = canBuild;
    const cells = draftDays.map((day) => {
      const assignment = assignmentLookup.get(`${staffKey}::${day.date}`) || null;
      const manualOff = Boolean(!assignment && dayHasManualOff(day, staffKey));
      const inboxApprovedOff = Boolean(
        !assignment && !manualOff && staffDayBlockedByApprovedInbox(staff, day.date),
      );
      const warnings = Array.isArray(validationByDate.get(day.date)?.warnings) ? validationByDate.get(day.date).warnings : [];
      const hasWarnings = cellShowsScheduleWarningDot(warnings, staffKey, staff);
      const businessStatus = day.businessStatus || getBusinessStatusForDate(day.date);
      const canEditShift = Boolean(assignment && businessStatus?.isOpen !== false && allowCellEdit);
      const cellStyle = assignment
        ? `background:#f5f3ff;border:1px solid #d8b4fe;color:#5b21b6;box-shadow:${hasWarnings ? "inset 0 0 0 1px rgba(245,158,11,0.35)" : "none"};`
        : manualOff || inboxApprovedOff
          ? `background:#f1f5f9;border:1px solid #cbd5e1;color:#475569;box-shadow:${hasWarnings ? "inset 0 0 0 1px rgba(245,158,11,0.28)" : "none"};`
          : `background:#f3f4f6;border:1px solid #e5e7eb;color:#6b7280;box-shadow:${hasWarnings ? "inset 0 0 0 1px rgba(245,158,11,0.28)" : "none"};`;
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
      const requestsList = Array.isArray(schedulePreviewState.requests) ? schedulePreviewState.requests : [];
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
      return `
        <div data-drop-zone="true" data-staff-id="${staffKey}" data-date="${day.date}" style="position:relative;padding:6px;border-radius:8px;min-height:50px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:11px;font-weight:${assignment ? "700" : "500"};line-height:1.25;transition:outline-color 0.12s ease;${cellStyle}">
          ${hasWarnings ? `<span style="position:absolute;top:5px;right:5px;width:6px;height:6px;border-radius:50%;background:#f59e0b;opacity:0.9;"></span>` : ""}
          ${editBtn}
          <div ${assignment && allowCellEdit ? `data-schedule-shift="true" draggable="true" data-shift-id="${assignmentId}" data-staff-id="${staffKey}" data-date="${day.date}" style="cursor:grab;user-select:none;"` : assignment ? `style="user-select:none;"` : emptyCellWrap}>
            <div>${
              assignment
                ? `${assignment.startTime || "--:--"} - ${assignment.endTime || "--:--"}`
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

    const seenMsRow = staffKey ? scheduleWeekAckSeenAtByStaffId[staffKey] || 0 : 0;
    const pingMsRow = staffKey ? scheduleWeekPingAtByStaffId[staffKey] || 0 : 0;
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
      <div style="display:grid;grid-template-columns:${gridTemplate};align-items:stretch;">
        <div style="padding:7px 9px;border-bottom:1px solid #e5e7eb;background:#fff;display:flex;flex-direction:column;justify-content:center;gap:2px;min-width:0;">
          ${nameControl}
          ${roleRowHtml}
        </div>
        ${cells}
      </div>
    `;
  }).join("");

  const standByMap = schedulePreviewState.standByByDate && typeof schedulePreviewState.standByByDate === "object"
    ? schedulePreviewState.standByByDate
    : {};
  const canPickStandBy = scheduleUserCanManualEdit() && schedulePreviewMode === "build";
  const standByRowHtml = renderScheduleStandByRowHtml({
    draftDays,
    gridTemplate,
    standByByDate: standByMap,
    staffListForNames: staffList,
    draftForNames: draft,
    canPickStandBy,
    standByView: schedulePreviewView,
  });

  board.innerHTML = `
    <section style="border:1px solid #e5e7eb;border-radius:14px;background:#fff;overflow:auto;">
      <div style="min-width:${firstColW + (draftDays.length * 104)}px;">
        <div style="display:grid;grid-template-columns:${gridTemplate};align-items:stretch;">
          <div style="padding:9px 11px;border-bottom:1px solid #e5e7eb;background:#f8fafc;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Staff${showStaffAck ? ` <span style="font-weight:600;color:#94a3b8;font-size:10px;">(viewed)</span>` : ""}</div>
          ${headerCells}
        </div>
        ${rowHtml}
        ${standByRowHtml}
      </div>
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

async function refreshSchedulePreview() {
  const weekRange = getWeekRange(schedulePreviewWeekStart);
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

    const draft = generateWeeklySchedule({
      staffList,
      requests,
      rules,
      businessHours,
      coverageRules,
      dayShiftSegments,
      dateRange: { startDate: weekRange.startDate, endDate: weekRange.endDate },
    });
    let draftWithBusinessRules = applyBusinessSettingsToDraft(draft);
    const localPayload = loadScheduleDraftOverridePayload(weekRange);
    const localDraftDays = localPayload?.days || null;
    const cloudBlock = await loadWeekDraftSnapshotBlockFromPublishDoc(weekRange.startDate);
    const cloudDraftDays = cloudBlock.days;
    const weekPublished = schedulePublishedMap[weekRange.startDate] === true;
    const dirtyKey = getScheduleLocalDirtyStorageKey(weekRange.startDate);
    const localDirty =
      typeof localStorage !== "undefined" &&
      dirtyKey &&
      localStorage.getItem(dirtyKey) === "1";
    const canEdit = scheduleUserCanManualEdit();
    const hasLocal = Array.isArray(localDraftDays) && localDraftDays.length > 0;
    const hasCloud = Array.isArray(cloudDraftDays) && cloudDraftDays.length > 0;

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
      draftWithBusinessRules = mergeManualOffOverridesIntoDraft(draftWithBusinessRules, manualOffOverrides, staffList);
      const fromLocal = normalizeStandByBlock(
        {
          standByByDate: localPayload?.standByByDate,
          standByStaffId: localPayload?.standByStaffId,
        },
        draftWithBusinessRules.days,
      );
      const fromCloud = normalizeStandByBlock(cloudBlock, draftWithBusinessRules.days);
      standByByDate = Object.keys(fromLocal).length > 0 ? fromLocal : fromCloud;
    }

    /* Published week: merge stand-by from Firestore; local wins per date when set; per-view fallback from cloud. */
    if (weekPublished) {
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

    schedulePreviewState = {
      draft: draftWithBusinessRules,
      validation,
      weekRange,
      staffList,
      coverageRules,
      requests,
      businessHours,
      standByByDate,
    };
    if (typeof window !== "undefined") {
      window.ffSchedulePreviewState = schedulePreviewState;
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
    if (schedulePublishedMap[weekRange.startDate] === true) {
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
    renderScheduleBoard(draftWithBusinessRules, validation, staffList);
    updateSchedulePublishToggleUi();
    updateScheduleWeekAckStrip();
    setScheduleLoadingState({ loading: false, error: "" });
  } catch (error) {
    console.error("[ScheduleUI] Failed to refresh schedule preview", error);
    schedulePreviewState = {
      draft: null,
      validation: null,
      weekRange,
      staffList: [],
      requests: [],
      businessHours: undefined,
      standByByDate: {},
    };
    if (typeof window !== "undefined") {
      window.ffSchedulePreviewState = schedulePreviewState;
    }
    renderScheduleSummary({ summary: { totalWarnings: 0, highSeverityCount: 0 } }, []);
    renderScheduleViewTabs();
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
    schedulePreviewWeekStart = addDays(getStartOfWeek(new Date()), -7);
    syncScheduleWeekFilterUi();
    refreshSchedulePreview();
    return;
  }

  if (mode === "next") {
    schedulePreviewWeekStart = addDays(getStartOfWeek(new Date()), 7);
    syncScheduleWeekFilterUi();
    refreshSchedulePreview();
    return;
  }

  if (mode === "in2") {
    schedulePreviewWeekStart = addDays(getStartOfWeek(new Date()), 14);
    syncScheduleWeekFilterUi();
    refreshSchedulePreview();
    return;
  }

  if (mode === "in3") {
    schedulePreviewWeekStart = addDays(getStartOfWeek(new Date()), 21);
    syncScheduleWeekFilterUi();
    refreshSchedulePreview();
    return;
  }

  if (mode === "in4") {
    schedulePreviewWeekStart = addDays(getStartOfWeek(new Date()), 28);
    syncScheduleWeekFilterUi();
    refreshSchedulePreview();
    return;
  }

  if (mode === "custom") {
    syncScheduleWeekFilterUi();
    const dateValue = customDateInput?.value;
    if (!dateValue) return;
    schedulePreviewWeekStart = getStartOfWeek(new Date(`${dateValue}T00:00:00`));
    refreshSchedulePreview();
    return;
  }

  schedulePreviewWeekStart = getStartOfWeek(new Date());
  syncScheduleWeekFilterUi();
  refreshSchedulePreview();
}

function hideScheduleScreen() {
  const screen = document.getElementById("scheduleScreen");
  if (screen) screen.style.display = "none";
  const btn = document.getElementById("scheduleBtn");
  if (btn) btn.classList.remove("active");
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

  if (schedCtx.viewOwnOnly && Array.isArray(schedulePreviewState.staffList) && schedulePreviewState.staffList.length) {
    const sid = String(
      typeof window !== "undefined" && window.__ff_authedStaffId
        ? window.__ff_authedStaffId
        : (typeof localStorage !== "undefined" ? localStorage.getItem("ff_authedStaffId_v1") : "") || "",
    ).trim();
    const me = schedulePreviewState.staffList.find((s) => getScheduleStaffKey(s) === sid);
    if (me && canViewScheduleBoardForCurrentWeek()) {
      schedulePreviewView = isTechnicianScheduleStaff(me) ? "technicians" : "management";
      renderScheduleViewTabs();
      renderScheduleBoard(schedulePreviewState.draft, schedulePreviewState.validation, schedulePreviewState.staffList);
    }
  }
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

  ["queueBtn", "ticketsBtn", "tasksBtn", "chatBtn", "inboxBtn", "mediaBtn", "appsBtn"].forEach((id) => {
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
}

if (typeof window !== "undefined") {
  window.goToSchedule = goToSchedule;
  window.ffSchedulePreviewState = schedulePreviewState;
  window.refreshSchedulePreview = refreshSchedulePreview;
  window.setSchedulePreviewView = setSchedulePreviewView;
  window.setSchedulePreviewMode = setSchedulePreviewMode;
  window.toggleScheduleWeekPublished = toggleScheduleWeekPublished;
  window.submitScheduleWeekAck = submitScheduleWeekAck;
  window.notifyStaffScheduleChanges = notifyStaffScheduleChanges;
  window.ffDiscardSavedScheduleWeekDraft = discardSavedScheduleWeekDraftAndReload;
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
