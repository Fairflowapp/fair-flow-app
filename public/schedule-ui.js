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
import { db } from "./app.js?v=20260329_training_fix1";
import { generateWeeklySchedule } from "./schedule-generator.js?v=20260403_mgmt_only_split";
import { validateScheduleDraft } from "./schedule-validator.js?v=20260403_avail_business_bounds";

let schedulePreviewWeekStart = getStartOfWeek(new Date());
let schedulePreviewState = {
  draft: null,
  validation: null,
  weekRange: null,
  staffList: [],
};
let schedulePreviewView = "management";
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
/** staffId -> true when that staff acknowledged viewing this published week */
let scheduleWeekAckByStaffId = {};
let scheduleAckUnsub = null;
let scheduleAckSalonWeek = "";
let scheduleChangePingUnsub = null;
let scheduleChangePingSubKey = "";
/** Avoid duplicate toasts for the same ping timestamp */
let scheduleChangePingShownToastMs = 0;
/** When drag-drop needs confirm before placing shift on Marked OFF cell: { payload, targetStaffId, targetDate } */
let scheduleDnDConfirmPending = null;

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
  scheduleWeekAckByStaffId = {};
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
        if (sid) next[sid] = true;
      });
      scheduleWeekAckByStaffId = next;
      updateScheduleWeekAckStrip();
      if (
        scheduleUserCanManualEdit() &&
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
  const strip = document.getElementById("scheduleWeekAckStrip");
  if (!strip) return;
  const weekRange = getWeekRange(schedulePreviewWeekStart);
  const ws = weekRange.startDate;
  const published = schedulePublishedMap[ws] === true;
  const ctx = getScheduleAccessContext();
  if (ctx.noAccess || scheduleUserCanManualEdit() || !published || !canViewScheduleBoardForCurrentWeek()) {
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
  strip.style.display = "inline-flex";
  const seen = scheduleWeekAckByStaffId[mySid] === true;
  if (seen) {
    strip.innerHTML = `<span style="display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;font-size:11px;font-weight:700;">Viewed ✓</span>`;
    return;
  }
  strip.innerHTML = `<button type="button" id="scheduleWeekAckBtn" style="height:32px;padding:0 14px;border:1px solid #7c3aed;border-radius:999px;background:#fff;color:#5b21b6;font-size:11px;font-weight:700;cursor:pointer;">Confirm viewed</button>`;
  document.getElementById("scheduleWeekAckBtn")?.addEventListener(
    "click",
    () => {
      submitScheduleWeekAck();
    },
    { once: true },
  );
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
    scheduleUserCanManualEdit() ||
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
  el.style.display = "flex";
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 12px;border:1px solid #fcd34d;background:#fffbeb;border-radius:10px;max-width:min(100%,520px);">
      <span style="font-size:12px;font-weight:600;color:#92400e;line-height:1.4;">Your shifts this week were changed — please review the schedule.</span>
      <button type="button" id="scheduleStaffChangePingDismiss" style="height:30px;padding:0 12px;border:1px solid #f59e0b;border-radius:999px;background:#fff;color:#b45309;font-size:11px;font-weight:700;cursor:pointer;flex-shrink:0;">Got it</button>
    </div>`;
  document.getElementById("scheduleStaffChangePingDismiss")?.addEventListener(
    "click",
    () => {
      try {
        localStorage.setItem(scheduleChangePingStorageKey(salonId, ws, mySid), String(ms));
      } catch (_) {
        /* ignore */
      }
      scheduleChangePingShownToastMs = 0;
      el.style.display = "none";
      el.innerHTML = "";
    },
    { once: true },
  );
}

function ensureScheduleChangePingListener(weekStart) {
  const salonId = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  const mySid = getAuthedStaffIdForSchedule();
  const ctx = getScheduleAccessContext();
  if (
    !salonId ||
    !weekStart ||
    !mySid ||
    scheduleUserCanManualEdit() ||
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

function ensureScheduleShiftEditModal() {
  if (document.getElementById("scheduleShiftEditBackdrop")) {
    return document.getElementById("scheduleShiftEditBackdrop");
  }
  const backdrop = document.createElement("div");
  backdrop.id = "scheduleShiftEditBackdrop";
  backdrop.style.cssText = "display:none;position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:4000;align-items:center;justify-content:center;padding:16px;";
  backdrop.innerHTML = `
    <div role="dialog" aria-modal="true" style="background:#fff;border-radius:16px;padding:20px 22px;max-width:360px;width:100%;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);">
      <div id="scheduleShiftEditTitle" style="font-size:16px;font-weight:700;color:#111827;margin-bottom:6px;">Edit shift</div>
      <div id="scheduleShiftEditHint" style="display:none;font-size:11px;color:#6b7280;margin-bottom:10px;line-height:1.4;">Preview only — not saved to staff profiles. Marked OFF for this week is remembered in this browser until you remove it or switch weeks.</div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <label style="font-size:12px;color:#6b7280;">Start
          <input type="time" id="scheduleShiftEditStart" step="300" style="width:100%;margin-top:4px;height:40px;border:1px solid #e5e7eb;border-radius:8px;padding:0 10px;box-sizing:border-box;" />
        </label>
        <label style="font-size:12px;color:#6b7280;">End
          <input type="time" id="scheduleShiftEditEnd" step="300" style="width:100%;margin-top:4px;height:40px;border:1px solid #e5e7eb;border-radius:8px;padding:0 10px;box-sizing:border-box;" />
        </label>
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
      <div id="scheduleDnDOffConfirmTitle" style="font-size:18px;font-weight:700;color:#111827;margin-bottom:10px;">Place shift on a marked OFF day?</div>
      <p id="scheduleDnDOffConfirmBody" style="margin:0 0 22px 0;font-size:14px;color:#4b5563;line-height:1.55;">This day is marked OFF for this staff member. Placing a shift here will remove the OFF mark.</p>
      <div style="display:flex;gap:12px;justify-content:flex-end;flex-wrap:wrap;">
        <button type="button" id="scheduleDnDOffConfirmCancel" style="padding:10px 18px;border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-weight:600;cursor:pointer;font-size:14px;">Cancel</button>
        <button type="button" id="scheduleDnDOffConfirmOk" style="padding:10px 18px;border-radius:10px;border:none;background:#7c3aed;color:#fff;font-weight:600;cursor:pointer;font-size:14px;">Yes, place shift</button>
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

function openScheduleDnDOffConfirm(pending) {
  scheduleDnDConfirmPending = pending;
  const el = ensureScheduleDnDOffConfirmModal();
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
  if (!pending?.payload || !pending.targetStaffId || !pending.targetDate) return;
  completeScheduleDrop(pending.payload, pending.targetStaffId, pending.targetDate);
}

function openScheduleShiftEdit({ staffKey, dateKey, startTime, endTime, staffName, isNew }) {
  const backdrop = ensureScheduleShiftEditModal();
  const isNewShift = Boolean(isNew);
  scheduleShiftEditPayload = { staffKey, dateKey, isNew: isNewShift };
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
  if (hint) hint.style.display = canManual ? "block" : "none";
  if (removeBtn) removeBtn.style.display = !isNewShift && canManual ? "block" : "none";
  if (markOffBtn) markOffBtn.style.display = isNewShift && canManual && dayOpen ? "block" : "none";
  if (saveBtn) saveBtn.textContent = isNewShift ? "Add shift" : "Save";
  const defaults = getDefaultShiftTimesForDate(dateKey);
  const toInput = (t, fallback) => {
    const s = String(t || "").trim();
    return /^\d{2}:\d{2}$/.test(s) ? s : fallback;
  };
  const startEl = document.getElementById("scheduleShiftEditStart");
  const endEl = document.getElementById("scheduleShiftEditEnd");
  if (startEl) startEl.value = toInput(isNewShift ? startTime || defaults.start : startTime || defaults.start, defaults.start);
  if (endEl) endEl.value = toInput(isNewShift ? endTime || defaults.end : endTime || defaults.end, defaults.end);
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
  const { staffKey, dateKey, isNew } = scheduleShiftEditPayload;
  const staff = getStaffByScheduleKey(schedulePreviewState.staffList, staffKey);
  if (!staff) return;

  let draft = cloneScheduleDraft(schedulePreviewState.draft);
  const day = findDraftDay(draft, dateKey);
  if (!day) return;

  if (isNew) {
    if ((day.assignments || []).some((a) => String(a.staffId || a.uid || "").trim() === staffKey)) {
      window.alert("This cell already has a shift. Edit it with the pencil or remove it first.");
      return;
    }
    removeManualOffForStaffDay(draft, dateKey, staffKey);
    day.assignments = [...(day.assignments || []), buildManualDraftAssignment(staff, start, end)];
  } else {
    const idx = (day.assignments || []).findIndex((a) => String(a.staffId || a.uid || "").trim() === staffKey);
    if (idx < 0) return;
    const markManual = scheduleUserCanManualEdit();
    day.assignments[idx] = {
      ...day.assignments[idx],
      startTime: start,
      endTime: end,
      ...(markManual ? { manualAdminEdit: true } : {}),
    };
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
    if (!scheduleUserCanManualEdit()) return;
    const staffKey = String(btn.getAttribute("data-staff-id") || "").trim();
    const dateKey = String(btn.getAttribute("data-date") || "").trim();
    const staffName = String(btn.getAttribute("data-staff-name") || "").trim();
    const defaults = getDefaultShiftTimesForDate(dateKey);
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
      schedulePublishedMap = { ...pub };

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
      if (screen && screen.style.display !== "none" && typeof refreshSchedulePreview === "function") {
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
  btn.style.display = canEdit ? "inline-flex" : "none";
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
    notifyBtn.style.display = canEdit && published ? "inline-flex" : "none";
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

function getScheduleStaffKey(staff) {
  return String(staff?.id || staff?.staffId || staff?.uid || staff?.userUid || "").trim();
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
      parts.push(
        `${date}|${String(a.startTime || "").trim()}|${String(a.endTime || "").trim()}`,
      );
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
  try {
    await setDoc(
      ref,
      {
        staffShiftFingerprints: { [weekStart]: fp },
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (e) {
    console.warn("[ScheduleUI] persist shift fingerprints", e);
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
  try {
    const snap = await getDoc(getSchedulePublishDocRef());
    const data = snap.exists() ? snap.data() : {};
    const sfp = data.staffShiftFingerprints && typeof data.staffShiftFingerprints === "object" ? data.staffShiftFingerprints : {};
    fpOld = sfp[key] && typeof sfp[key] === "object" ? sfp[key] : {};
  } catch (_) {
    /* ignore */
  }
  const allKeys = new Set([...Object.keys(fpNew), ...Object.keys(fpOld)]);
  const changed = [];
  for (const k of allKeys) {
    if (fpNew[k] !== fpOld[k]) changed.push(k);
  }
  if (changed.length === 0) {
    ffScheduleAppToast("No shift changes detected since the last publish or notify.", 4000);
    return;
  }
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
  batch.set(
    weeksRef,
    {
      staffShiftFingerprints: { [key]: fpNew },
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  try {
    await batch.commit();
    ffScheduleAppToast(`Notified ${changed.length} staff member(s) with updated shifts.`, 4500);
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

function getSchedulePreviewSalonStorageKey() {
  const s = String(typeof window !== "undefined" && window.currentSalonId ? window.currentSalonId : "").trim();
  return s || "_local";
}

function getScheduleManualOffStorageKey(weekRange) {
  if (!weekRange?.startDate || !weekRange?.endDate) return null;
  const salon = getSchedulePreviewSalonStorageKey();
  return `ff_schedule_manual_off_v${SCHEDULE_MANUAL_OFF_STORAGE_VERSION}_${salon}_${weekRange.startDate}_${weekRange.endDate}`;
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

/** Persist Marked OFF cells after local edits (same browser / device). */
function persistScheduleManualOffFromState() {
  const weekRange = schedulePreviewState.weekRange;
  const draft = schedulePreviewState.draft;
  const key = getScheduleManualOffStorageKey(weekRange);
  if (!key || !draft?.days || typeof localStorage === "undefined") return;
  const manualOffByDate = {};
  draft.days.forEach((day) => {
    const ids = Array.isArray(day.manualOffStaffIds) ? day.manualOffStaffIds.filter(Boolean) : [];
    if (ids.length) manualOffByDate[day.date] = ids;
  });
  try {
    if (Object.keys(manualOffByDate).length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(
        key,
        JSON.stringify({ v: SCHEDULE_MANUAL_OFF_STORAGE_VERSION, manualOffByDate }),
      );
    }
  } catch (e) {
    console.warn("[ScheduleUI] Failed to persist Marked OFF overrides", e);
  }
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
  return mapped;
}

function revalidateLocalDraft(nextDraft) {
  const coverageRules = schedulePreviewState.coverageRules !== undefined
    ? schedulePreviewState.coverageRules
    : (window.settings && typeof window.settings.coverageRules === "object" ? window.settings.coverageRules : undefined);
  const nextValidation = validateScheduleDraft({
    draftSchedule: nextDraft,
    staffList: schedulePreviewState.staffList,
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
  persistScheduleManualOffFromState();
}

function clearDropZoneVisual(zone) {
  if (!zone) return;
  zone.style.outline = "";
  zone.style.outlineOffset = "";
}

function handleShiftDragStart(event) {
  if (!scheduleUserCanManualEdit()) {
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
  if (!scheduleUserCanManualEdit()) return;
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

function completeScheduleDrop(payload, targetStaffId, targetDate) {
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
  if (!scheduleUserCanManualEdit()) return;
  const zone = event.currentTarget;
  clearDropZoneVisual(zone);
  const targetStaffId = String(zone?.getAttribute("data-staff-id") || "").trim();
  const targetDate = String(zone?.getAttribute("data-date") || "").trim();
  const payload = scheduleDragState;
  if (!payload || !payload.shiftId || !payload.sourceStaffId || !payload.sourceDate || !targetStaffId || !targetDate) return;
  if (payload.sourceStaffId === targetStaffId && payload.sourceDate === targetDate) return;

  const targetDayPreview = findDraftDay(schedulePreviewState.draft, targetDate);
  if (targetDayPreview && dayHasManualOff(targetDayPreview, targetStaffId)) {
    openScheduleDnDOffConfirm({ payload, targetStaffId, targetDate });
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
  "management_line_below_minimum",
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

/** Orange highlight: day has quota issues (whole column), or this row has a row-specific warning (e.g. availability). */
function cellShowsScheduleWarningDot(dayWarnings, staffKey, staff) {
  const list = Array.isArray(dayWarnings) ? dayWarnings : [];
  if (filterCoverageWarnings(list).length > 0) return true;
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
  const date = new Date(`${dateKey}T00:00:00`);
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
  const specialDay = specialDays[dateKey] || null;
  if (specialDay) {
    if (specialDay.isClosed === true) {
      return {
        isOpen: false,
        openTime: null,
        closeTime: null,
        source: "special_day_closed",
        note: specialDay.note || "",
      };
    }
    return {
      isOpen: true,
      openTime: specialDay.openTime || baseDay.openTime || null,
      closeTime: specialDay.closeTime || baseDay.closeTime || null,
      source: "special_day_hours",
      note: specialDay.note || "",
    };
  }

  return {
    isOpen: baseDay.isOpen === true,
    openTime: baseDay.openTime || null,
    closeTime: baseDay.closeTime || null,
    source: "business_hours",
    note: "",
  };
}

/** Default shift window for manual add / empty inputs — follows business open/close when set. */
function getDefaultShiftTimesForDate(dateKey) {
  const bs = getBusinessStatusForDate(dateKey);
  let start = normalizeTimeValue(bs.openTime) || "09:00";
  let end = normalizeTimeValue(bs.closeTime) || "17:00";
  if (!bs.isOpen) return { start: "09:00", end: "17:00" };
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
        assignments = assignments
          .map((assignment) => {
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
  return "Technician";
}

function renderScheduleViewTabs() {
  const toggleWrap = document.getElementById("scheduleViewToggleWrap");
  if (toggleWrap) {
    const ctx = getScheduleAccessContext();
    toggleWrap.style.display = ctx.viewOwnOnly ? "none" : "";
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
    button.style.setProperty("background", active ? "#7c3aed" : "#f9fafb", "important");
    button.style.setProperty("color", active ? "#fff" : "#6b7280", "important");
    button.style.setProperty("border-color", active ? "#7c3aed" : "#e5e7eb", "important");
    button.style.setProperty("font-weight", active ? "600" : "500", "important");
    button.style.setProperty("border-radius", left ? "8px 0 0 8px" : "0 8px 8px 0", "important");
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

async function loadApprovedScheduleRequests() {
  const salonId = String(window.currentSalonId || "").trim();
  if (!salonId) return [];
  try {
    const inboxRef = collection(db, `salons/${salonId}/inboxItems`);
    const snap = await getDocs(query(inboxRef, where("status", "==", "approved")));
    return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  } catch (error) {
    console.warn("[ScheduleUI] Failed to load approved requests via query, retrying full scan", error);
    const snap = await getDocs(collection(db, `salons/${salonId}/inboxItems`));
    return snap.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .filter((item) => String(item?.status || "").toLowerCase() === "approved");
  }
}

function renderScheduleSummary(validation, days) {
  const summaryBar = document.getElementById("scheduleSummaryBar");
  if (!summaryBar) return;
  const summary = validation?.summary || { totalWarnings: 0, highSeverityCount: 0, mediumSeverityCount: 0 };
  const dayList = Array.isArray(days) ? days : [];
  const coverageCount = dayList.reduce((n, day) => n + filterCoverageWarnings(day?.warnings).length, 0);
  const daysWithCoverageIssues = dayList.filter((day) => filterCoverageWarnings(day?.warnings).length > 0).length;
  const total = summary.totalWarnings || 0;
  const otherCount = Math.max(0, total - coverageCount);

  if (total === 0) {
    summaryBar.innerHTML = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
         <span style="display:inline-flex;padding:4px 10px;border-radius:999px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;font-size:12px;font-weight:600;">No warnings</span>
         <span style="font-size:13px;color:#6b7280;">Edit shifts with the pen icon (saved locally in this preview only).</span>
       </div>`;
    return;
  }

  const pieces = [];
  if (coverageCount > 0) {
    pieces.push(`<span style="display:inline-flex;padding:4px 10px;border-radius:999px;background:#fff7ed;color:#b45309;border:1px solid #fed7aa;font-size:12px;font-weight:600;">${coverageCount} coverage warning${coverageCount === 1 ? "" : "s"}</span>`);
    pieces.push(`<span style="font-size:13px;color:#6b7280;">${daysWithCoverageIssues} day${daysWithCoverageIssues === 1 ? "" : "s"} with coverage gaps.</span>`);
  }
  if (otherCount > 0) {
    pieces.push(`<span style="display:inline-flex;padding:4px 10px;border-radius:999px;background:#f8fafc;color:#64748b;border:1px solid #e2e8f0;font-size:12px;font-weight:600;">+${otherCount} other</span>`);
    pieces.push(`<span style="font-size:13px;color:#94a3b8;">availability / weekly limits</span>`);
  }
  if (coverageCount === 0 && otherCount > 0) {
    pieces.length = 0;
    pieces.push(`<span style="display:inline-flex;padding:4px 10px;border-radius:999px;background:#f8fafc;color:#64748b;border:1px solid #e2e8f0;font-size:12px;font-weight:600;">${otherCount} scheduling note${otherCount === 1 ? "" : "s"}</span>`);
    pieces.push(`<span style="font-size:13px;color:#94a3b8;">not quota — availability or weekly hours</span>`);
  }
  summaryBar.innerHTML = `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">${pieces.join("")}</div>`;
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

function renderScheduleBoard(draft, validation, staffList) {
  const board = document.getElementById("scheduleBoard");
  const empty = document.getElementById("schedulePreviewEmpty");
  if (!board || !empty) return;

  const draftDays = Array.isArray(draft?.days) ? draft.days : [];
  const validationByDate = getValidationByDate(validation);
  const filteredStaff = getFilteredScheduleStaff(staffList);
  const assignmentLookup = buildAssignmentLookup(draft);
  const canManual = scheduleUserCanManualEdit();

  if (!draftDays.length || !filteredStaff.length) {
    board.innerHTML = "";
    empty.style.display = "block";
    empty.textContent = draftDays.length
      ? `No ${schedulePreviewView === "management" ? "management staff" : "technicians"} available for this week.`
      : "No schedule preview available for this week.";
    return;
  }

  empty.style.display = "none";
  const wrAck = getWeekRange(schedulePreviewWeekStart);
  const weekPubForAck = schedulePublishedMap[wrAck.startDate] === true;
  const showStaffAck = scheduleUserCanManualEdit() && weekPubForAck;
  const firstColW = showStaffAck ? 258 : 220;
  const gridTemplate = `${firstColW}px repeat(${draftDays.length}, minmax(120px, 1fr))`;
  const headerCells = draftDays.map((day) => {
    const allWarnings = Array.isArray(validationByDate.get(day.date)?.warnings) ? validationByDate.get(day.date).warnings : [];
    const cov = filterCoverageWarnings(allWarnings);
    const other = filterNonCoverageWarnings(allWarnings);
    const dayLabel = formatBoardDayLabel(day.date);
    const businessStatus = day.businessStatus || { isOpen: true, source: "business_hours" };
    let issueHtml = "";
    if (businessStatus.isOpen !== false) {
      if (cov.length > 0) {
        issueHtml = `<div style="margin-top:6px;font-size:11px;color:#b45309;font-weight:600;">${cov.length} coverage issue${cov.length === 1 ? "" : "s"}</div>`;
      } else if (other.length > 0) {
        issueHtml = `<div style="margin-top:6px;font-size:11px;color:#94a3b8;">${other.length} note${other.length === 1 ? "" : "s"}</div>`;
      }
    }
    const specialNoteRaw = String(businessStatus.note || "").trim();
    const specialNoteHtml = specialNoteRaw
      ? `<div style="margin-top:5px;font-size:10px;color:#6d28d9;line-height:1.35;font-weight:500;">* ${escapeScheduleHtml(specialNoteRaw)}</div>`
      : "";
    return `
      <div style="padding:12px 10px;border-bottom:1px solid #e5e7eb;background:#f8fafc;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:#111827;">${dayLabel.title}</div>
        <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${dayLabel.subtitle}</div>
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
    const allowCellEdit = scheduleUserCanManualEdit();
    const cells = draftDays.map((day) => {
      const assignment = assignmentLookup.get(`${staffKey}::${day.date}`) || null;
      const manualOff = Boolean(!assignment && dayHasManualOff(day, staffKey));
      const warnings = Array.isArray(validationByDate.get(day.date)?.warnings) ? validationByDate.get(day.date).warnings : [];
      const hasWarnings = cellShowsScheduleWarningDot(warnings, staffKey, staff);
      const businessStatus = day.businessStatus || getBusinessStatusForDate(day.date);
      const canEditShift = Boolean(assignment && businessStatus?.isOpen !== false && allowCellEdit);
      const cellStyle = assignment
        ? `background:#f5f3ff;border:1px solid #d8b4fe;color:#5b21b6;box-shadow:${hasWarnings ? "inset 0 0 0 1px rgba(245,158,11,0.35)" : "none"};`
        : manualOff
          ? `background:#f1f5f9;border:1px solid #cbd5e1;color:#475569;box-shadow:${hasWarnings ? "inset 0 0 0 1px rgba(245,158,11,0.28)" : "none"};`
          : `background:#f3f4f6;border:1px solid #e5e7eb;color:#6b7280;box-shadow:${hasWarnings ? "inset 0 0 0 1px rgba(245,158,11,0.28)" : "none"};`;
      const assignmentId = assignment ? getAssignmentId(assignment, day.date) : "";
      const safeStaffName = escapeScheduleAttr(staff.name || "");
      const editBtn = canEditShift
        ? `<button type="button" data-schedule-edit-btn="true" data-staff-id="${escapeScheduleAttr(staffKey)}" data-date="${escapeScheduleAttr(day.date)}" data-start="${escapeScheduleAttr(assignment.startTime || "")}" data-end="${escapeScheduleAttr(assignment.endTime || "")}" data-staff-name="${safeStaffName}" title="Edit hours" aria-label="Edit shift hours" style="position:absolute;top:4px;left:4px;min-width:22px;min-height:22px;padding:0;border:none;background:transparent;box-shadow:none;color:#7c3aed;font-size:15px;line-height:1;cursor:pointer;opacity:0.85;z-index:2;">\u270E</button>`
        : "";
      const manualAddBtn =
        !assignment && !manualOff && businessStatus?.isOpen !== false && canManual
          ? `<button type="button" data-schedule-manual-add="true" data-staff-id="${escapeScheduleAttr(staffKey)}" data-date="${escapeScheduleAttr(day.date)}" data-staff-name="${safeStaffName}" title="Add shift manually" aria-label="Add shift manually" style="margin-top:2px;padding:4px 10px;font-size:11px;font-weight:600;border:1px dashed #c4b5fd;background:#faf5ff;color:#7c3aed;border-radius:8px;cursor:pointer;">+ Add shift</button>`
          : "";
      const manualOffBlock = manualOff
        ? `<div style="font-size:10px;font-weight:700;color:#64748b;margin-top:5px;letter-spacing:0.04em;text-transform:uppercase;">Marked OFF</div>`
        : "";
      const emptyCellWrap = !assignment
        ? `style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:100%;"`
        : "";
      return `
        <div data-drop-zone="true" data-staff-id="${staffKey}" data-date="${day.date}" style="position:relative;padding:10px;border-radius:12px;min-height:68px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:12px;font-weight:${assignment ? "700" : "500"};line-height:1.35;transition:outline-color 0.12s ease;${cellStyle}">
          ${hasWarnings ? `<span style="position:absolute;top:7px;right:7px;width:7px;height:7px;border-radius:50%;background:#f59e0b;opacity:0.9;"></span>` : ""}
          ${editBtn}
          <div ${assignment && allowCellEdit ? `data-schedule-shift="true" draggable="true" data-shift-id="${assignmentId}" data-staff-id="${staffKey}" data-date="${day.date}" style="cursor:grab;user-select:none;"` : assignment ? `style="user-select:none;"` : emptyCellWrap}>
            <div>${assignment ? `${assignment.startTime || "--:--"} - ${assignment.endTime || "--:--"}` : "Off"}</div>
            ${manualOffBlock}
            ${manualAddBtn}
          </div>
        </div>
      `;
    }).join("");

    const nameControl = staffKey
      ? `<button type="button" data-schedule-staff-profile="true" data-staff-id="${escapeScheduleAttr(staffKey)}" title="לחיצה — עריכת לוח זמנים בפרופיל" aria-label="פתיחת לוח זמנים של העובד בפרופיל" style="font:inherit;font-size:13px;font-weight:700;line-height:1.3;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;width:100%;border:none;background:transparent;padding:0;margin:0;cursor:pointer;text-align:left;text-decoration:none;display:block;box-sizing:border-box;">${escapeScheduleAttr(staff.name || "Unknown Staff")}</button>`
      : `<span style="font-size:13px;font-weight:700;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeScheduleAttr(staff.name || "Unknown Staff")}</span>`;

    const ackSeen = Boolean(staffKey && scheduleWeekAckByStaffId[staffKey]);
    const ackBadgeHtml = showStaffAck
      ? ackSeen
        ? `<span style="display:inline-flex;align-items:center;flex-shrink:0;padding:1px 7px;border-radius:999px;background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;font-size:9px;font-weight:700;line-height:1.35;">Seen</span>`
        : `<span style="display:inline-flex;align-items:center;flex-shrink:0;padding:1px 7px;border-radius:999px;background:#f9fafb;color:#9ca3af;border:1px solid #e5e7eb;font-size:9px;font-weight:700;line-height:1.35;">Not seen</span>`
      : "";
    const roleSafe = escapeScheduleHtml(roleLabel);
    const roleRowHtml = showStaffAck
      ? `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;font-size:11px;color:#6b7280;line-height:1.35;min-width:0;">
          <span style="min-width:0;">${roleSafe}</span>
          ${ackBadgeHtml}
        </div>`
      : `<div style="font-size:11px;color:#6b7280;line-height:1.35;">${roleSafe}</div>`;

    return `
      <div style="display:grid;grid-template-columns:${gridTemplate};align-items:stretch;">
        <div style="padding:12px 14px;border-bottom:1px solid #e5e7eb;background:#fff;display:flex;flex-direction:column;justify-content:center;gap:4px;min-width:0;">
          ${nameControl}
          ${roleRowHtml}
        </div>
        ${cells}
      </div>
    `;
  }).join("");

  board.innerHTML = `
    <section style="border:1px solid #e5e7eb;border-radius:18px;background:#fff;overflow:auto;">
      <div style="min-width:${firstColW + (draftDays.length * 120)}px;">
        <div style="display:grid;grid-template-columns:${gridTemplate};align-items:stretch;">
          <div style="padding:12px 14px;border-bottom:1px solid #e5e7eb;background:#f8fafc;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Staff${showStaffAck ? ` <span style="font-weight:600;color:#94a3b8;font-size:10px;">(viewed)</span>` : ""}</div>
          ${headerCells}
        </div>
        ${rowHtml}
      </div>
    </section>
  `;
  bindScheduleBoardDnD();
  bindScheduleShiftEditButtons();
  bindScheduleBoardManualAdd();
  bindScheduleStaffProfileLinks();
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

    const draft = generateWeeklySchedule({
      staffList,
      requests,
      rules,
      businessHours,
      coverageRules,
      dateRange: { startDate: weekRange.startDate, endDate: weekRange.endDate },
    });
    let draftWithBusinessRules = applyBusinessSettingsToDraft(draft);
    const manualOffOverrides = loadScheduleManualOffOverrides(weekRange);
    draftWithBusinessRules = mergeManualOffOverridesIntoDraft(draftWithBusinessRules, manualOffOverrides, staffList);

    const validation = validateScheduleDraft({
      draftSchedule: draftWithBusinessRules,
      staffList,
      requests,
      rules: draftWithBusinessRules.rules,
      coverageRules,
      dateRange: { startDate: weekRange.startDate, endDate: weekRange.endDate },
    });

    schedulePreviewState = { draft: draftWithBusinessRules, validation, weekRange, staffList, coverageRules };
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
    renderScheduleSummary(validation, validation.days);
    renderScheduleViewTabs();
    renderScheduleBoard(draftWithBusinessRules, validation, staffList);
    updateSchedulePublishToggleUi();
    updateScheduleWeekAckStrip();
    setScheduleLoadingState({ loading: false, error: "" });
  } catch (error) {
    console.error("[ScheduleUI] Failed to refresh schedule preview", error);
    schedulePreviewState = { draft: null, validation: null, weekRange, staffList: [] };
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
  document.getElementById("scheduleBtn")?.addEventListener("click", goToSchedule);
  document.getElementById("scheduleViewManagementBtn")?.addEventListener("click", () => setSchedulePreviewView("management"));
  document.getElementById("scheduleViewTechniciansBtn")?.addEventListener("click", () => setSchedulePreviewView("technicians"));
  document.getElementById("scheduleWeekFilter")?.addEventListener("change", () => {
    syncScheduleWeekFilterUi();
    const mode = document.getElementById("scheduleWeekFilter")?.value || "current";
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
  window.toggleScheduleWeekPublished = toggleScheduleWeekPublished;
  window.submitScheduleWeekAck = submitScheduleWeekAck;
  window.notifyStaffScheduleChanges = notifyStaffScheduleChanges;
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
