// schedule-shift-edit.js
// Schedule — escape/lunch-break helpers, the shift-edit modal and its confirm
// dialogs (DnD-off / rebuild / approved-inbox), manual-edit permissions, shift
// save/remove, and board manual-add binding. Extracted verbatim from
// schedule-ui.js (Phase 2 of the schedule-ui split). Shared mutable state
// lives in schedule-state.js; helpers that still live in schedule-ui.js are
// injected via initScheduleShiftEdit() (function declarations there are
// hoisted, so wiring at module-eval time is safe).

import { getInboxApprovalDisplayForDate } from "./schedule-availability.js?v=20260615_default_schedule_source";
import { scheduleState } from "./schedule-state.js?v=20260702_schedule_state";
import { ffScheduleAppToast } from "./schedule-ack.js?v=20260702_schedule_ack";

// ── injected via initScheduleShiftEdit() (wired in schedule-ui.js) ──
let renderScheduleBoard;
let renderScheduleSummary;
let revalidateLocalDraft;
let cloneScheduleDraft;
let findDraftDay;
let dayHasManualOff;
let removeManualOffForStaffDay;
let markScheduleDayAsOffFromModal;
let runDiscardSavedScheduleWeekDraftAndReload;
let staffDayBlockedByApprovedInbox;
let getApprovedPartialRequestHints;
let getApprovedPartialTimeConflictMessage;
let openScheduleApprovedTimeConflictModal;
let getCrossLocationConflictForShift;
let confirmScheduleCrossLocationConflict;
let completeScheduleDrop;
let getStaffByScheduleKey;
let getScheduleStaffKey;
let getScheduleStaffRole;
let getBusinessStatusForDate;
let getDefaultShiftTimesForDate;
let applyBusinessSettingsToDraft;
let hhmmFromTimeInput;
let setScheduleTimeFieldValue;
let setScheduleTimeCompositeDisabled;
let applyScheduleTimeFieldDisplay;
let formatScheduleTimeShortAmPm;
let compareScheduleHHMM;
let earlierScheduleHHMM;
let laterScheduleHHMM;
let _ffActiveLocationNameForIcs;

export function initScheduleShiftEdit(deps) {
  ({
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
  } = deps);
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
      <div id="scheduleShiftEditLocation" style="display:none;align-items:center;gap:6px;margin-bottom:10px;font-size:12px;font-weight:600;color:#5b21b6;">
        <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;background:#ede9fe;border:1px solid #c4b5fd;line-height:1.3;">
          <span style="width:6px;height:6px;border-radius:50%;background:#7c3aed;flex-shrink:0;"></span>
          <span id="scheduleShiftEditLocationName">This branch</span>
        </span>
      </div>
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
  const requests = Array.isArray(scheduleState.schedulePreviewState.requests) ? scheduleState.schedulePreviewState.requests : [];
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
  scheduleState.scheduleDnDConfirmPending = {
    action: "dnd_move",
    variant: pending.variant || "manual_off",
    payload: pending.payload,
    targetStaffId: pending.targetStaffId,
    targetDate: pending.targetDate,
  };
  const el = ensureScheduleDnDOffConfirmModal();
  const staff = getStaffByScheduleKey(scheduleState.schedulePreviewState.staffList, pending.targetStaffId);
  if (staff && pending.targetDate) {
    applySchedulePlaceShiftConfirmCopy(
      staff,
      pending.targetDate,
      scheduleState.scheduleDnDConfirmPending.variant === "approved_inbox" ? "approved_inbox" : "manual_off",
    );
  } else {
    setScheduleDnDConfirmModalVariant(scheduleState.scheduleDnDConfirmPending.variant);
  }
  el.style.display = "flex";
}

function openScheduleAddShiftApprovedInboxConfirm({ staffKey, dateKey, staffName, startTime, endTime }) {
  scheduleState.scheduleDnDConfirmPending = {
    action: "open_add_shift",
    variant: "approved_inbox",
    staffKey,
    dateKey,
    staffName,
    startTime,
    endTime,
  };
  const el = ensureScheduleDnDOffConfirmModal();
  const staff = getStaffByScheduleKey(scheduleState.schedulePreviewState.staffList, staffKey);
  if (staff) applySchedulePlaceShiftConfirmCopy(staff, dateKey, "approved_inbox");
  else setScheduleDnDConfirmModalVariant("approved_inbox");
  el.style.display = "flex";
}

function openScheduleAddShiftManualOffConfirm({ staffKey, dateKey, staffName, startTime, endTime }) {
  scheduleState.scheduleDnDConfirmPending = {
    action: "open_add_shift",
    variant: "manual_off",
    staffKey,
    dateKey,
    staffName,
    startTime,
    endTime,
  };
  const el = ensureScheduleDnDOffConfirmModal();
  const staff = getStaffByScheduleKey(scheduleState.schedulePreviewState.staffList, staffKey);
  if (staff) applySchedulePlaceShiftConfirmCopy(staff, dateKey, "manual_off");
  else setScheduleDnDConfirmModalVariant("manual_off");
  el.style.display = "flex";
}

function closeScheduleDnDOffConfirm() {
  const el = document.getElementById("scheduleDnDOffConfirmBackdrop");
  if (el) el.style.display = "none";
  scheduleState.scheduleDnDConfirmPending = null;
}

function cancelScheduleDnDOffConfirm() {
  closeScheduleDnDOffConfirm();
}

function confirmScheduleDnDOffConfirm() {
  const pending = scheduleState.scheduleDnDConfirmPending;
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
    const staff = getStaffByScheduleKey(scheduleState.schedulePreviewState.staffList, staffKey);
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
  scheduleState.scheduleShiftEditPayload = {
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
    const editStaff = getStaffByScheduleKey(scheduleState.schedulePreviewState.staffList, staffKey);
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
  const editStaffForDefaults = getStaffByScheduleKey(scheduleState.schedulePreviewState.staffList, staffKey);
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
  const prefers24h =
    typeof window !== "undefined" &&
    typeof window.ffGetDisplayTimeFormat === "function" &&
    window.ffGetDisplayTimeFormat() === "24h";
  [startEl, endEl].forEach((el) => applyScheduleTimeFieldDisplay(el, prefers24h));
  if (startEl) {
    setScheduleTimeFieldValue(
      startEl,
      toInput(isNewShift ? startTime || defStart : startTime || defStart, defStart),
      prefers24h,
    );
  }
  if (endEl) {
    setScheduleTimeFieldValue(
      endEl,
      toInput(isNewShift ? endTime || defEnd : endTime || defEnd, defEnd),
      prefers24h,
    );
  }
  let existingAssign = null;
  if (!isNewShift && scheduleState.schedulePreviewState.draft) {
    const dEx = findDraftDay(scheduleState.schedulePreviewState.draft, dateKey);
    existingAssign =
      dEx && Array.isArray(dEx.assignments)
        ? dEx.assignments.find((x) => String(x.staffId || x.uid || "").trim() === staffKey)
        : null;
  }
  const lunchCb = document.getElementById("scheduleShiftEditLunchEnabled");
  const lunchSt = document.getElementById("scheduleShiftEditLunchStart");
  const lunchEn = document.getElementById("scheduleShiftEditLunchEnd");
  [lunchSt, lunchEn].forEach((el) => applyScheduleTimeFieldDisplay(el, prefers24h));
  if (lunchCb) {
    lunchCb.checked = Boolean(existingAssign?.lunchBreakEnabled);
    lunchCb.disabled = !canManual;
  }
  if (lunchSt) {
    setScheduleTimeFieldValue(lunchSt, toInput(existingAssign?.lunchStartTime || "", ""), prefers24h);
    lunchSt.disabled = !canManual;
    setScheduleTimeCompositeDisabled(lunchSt, !canManual);
  }
  if (lunchEn) {
    setScheduleTimeFieldValue(lunchEn, toInput(existingAssign?.lunchEndTime || "", ""), prefers24h);
    lunchEn.disabled = !canManual;
    setScheduleTimeCompositeDisabled(lunchEn, !canManual);
  }
  syncScheduleShiftEditLunchRowVisibility();
  // Show which branch this shift belongs to (read-only). Only meaningful when
  // the salon has more than one active location — otherwise it's redundant.
  const locRow = document.getElementById("scheduleShiftEditLocation");
  if (locRow) {
    const activeLocs = (typeof window !== "undefined" && typeof window.ffGetActiveLocations === "function")
      ? (window.ffGetActiveLocations() || [])
      : [];
    const locName = _ffActiveLocationNameForIcs();
    if (activeLocs.length > 1 && locName) {
      const nameEl = document.getElementById("scheduleShiftEditLocationName");
      if (nameEl) nameEl.textContent = locName;
      locRow.style.display = "flex";
    } else {
      locRow.style.display = "none";
    }
  }
  backdrop.style.display = "flex";
}

function closeScheduleShiftEdit() {
  const backdrop = document.getElementById("scheduleShiftEditBackdrop");
  if (backdrop) backdrop.style.display = "none";
  scheduleState.scheduleShiftEditPayload = null;
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

async function saveScheduleShiftEdit() {
  if (!scheduleState.scheduleShiftEditPayload || !scheduleState.schedulePreviewState.draft) return;
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
  const { staffKey, dateKey, isNew, overrideApprovedInbox } = scheduleState.scheduleShiftEditPayload;
  const staff = getStaffByScheduleKey(scheduleState.schedulePreviewState.staffList, staffKey);
  if (!staff) return;
  if (isNew && staffDayBlockedByApprovedInbox(staff, dateKey) && !overrideApprovedInbox) {
    ffScheduleAppToast(
      "This person has approved time off on this day. Update Inbox or pick another day.",
    );
    return;
  }

  if (!scheduleState.scheduleSaveSkipApprovedTimeConflictOnce) {
    const conflictMsg = getApprovedPartialTimeConflictMessage(staff, dateKey, start, end);
    if (conflictMsg) {
      openScheduleApprovedTimeConflictModal(conflictMsg.message, () => {
        scheduleState.scheduleSaveSkipApprovedTimeConflictOnce = true;
        try {
          saveScheduleShiftEdit();
        } finally {
          scheduleState.scheduleSaveSkipApprovedTimeConflictOnce = false;
        }
      });
      return;
    }
  }

  // Cross-location double-booking guard: a person can't physically work two
  // branches at overlapping hours on the same day. Manual add/edit previously
  // bypassed this entirely (only the auto-builder checked it), so the same
  // staff could be hand-placed in two branches for the same hours with no
  // warning. We surface a confirm here. Fail-open by design: if the other
  // branch's data can't be read, getCrossLocationConflictForShift returns null
  // and the save proceeds exactly as before — never blocks on a read error.
  const crossLocConflict = await getCrossLocationConflictForShift(staff, dateKey, start, end);
  if (crossLocConflict) {
    const proceed = await confirmScheduleCrossLocationConflict(crossLocConflict.message);
    if (!proceed) return;
  }

  let draft = cloneScheduleDraft(scheduleState.schedulePreviewState.draft);
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
  renderScheduleSummary(scheduleState.schedulePreviewState.validation, scheduleState.schedulePreviewState.validation?.days || []);
  renderScheduleBoard(scheduleState.schedulePreviewState.draft, scheduleState.schedulePreviewState.validation, scheduleState.schedulePreviewState.staffList);
  closeScheduleShiftEdit();
}

function removeScheduleShiftFromDraft() {
  if (!scheduleState.scheduleShiftEditPayload || !scheduleState.schedulePreviewState.draft) return;
  const { staffKey, dateKey, isNew } = scheduleState.scheduleShiftEditPayload;
  if (isNew) {
    closeScheduleShiftEdit();
    return;
  }
  let draft = cloneScheduleDraft(scheduleState.schedulePreviewState.draft);
  const day = findDraftDay(draft, dateKey);
  if (!day) return;
  const idx = (day.assignments || []).findIndex((a) => String(a.staffId || a.uid || "").trim() === staffKey);
  if (idx < 0) return;
  day.assignments.splice(idx, 1);
  draft = applyBusinessSettingsToDraft(draft);
  revalidateLocalDraft(draft);
  renderScheduleSummary(scheduleState.schedulePreviewState.validation, scheduleState.schedulePreviewState.validation?.days || []);
  renderScheduleBoard(scheduleState.schedulePreviewState.draft, scheduleState.schedulePreviewState.validation, scheduleState.schedulePreviewState.staffList);
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
    if (!scheduleUserCanManualEdit() || scheduleState.schedulePreviewMode !== "build") return;
    const staffKey = String(btn.getAttribute("data-staff-id") || "").trim();
    const dateKey = String(btn.getAttribute("data-date") || "").trim();
    const staffName = String(btn.getAttribute("data-staff-name") || "").trim();
    const defaults = getDefaultShiftTimesForDate(dateKey);
    const staff = getStaffByScheduleKey(scheduleState.schedulePreviewState.staffList, staffKey);
    const day = findDraftDay(scheduleState.schedulePreviewState.draft, dateKey);
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

export {
  bindScheduleBoardManualAdd,
  bindScheduleShiftEditButtons,
  closeScheduleShiftEdit,
  ensureScheduleRebuildConfirmModal,
  escapeScheduleAttr,
  escapeScheduleHtml,
  formatLunchBreakCellSubtitle,
  getScheduleAccessContext,
  openScheduleDnDOffConfirm,
  openScheduleShiftEdit,
  scheduleUserCanManualEdit,
};
