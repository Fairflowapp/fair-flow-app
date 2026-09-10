// schedule-dnd.js
// Schedule — drag/drop payloads, shift click/edit routing, approved-time and
// cross-location conflict modals, draft revalidation, and board DnD binding.
// Extracted verbatim from schedule-ui.js (Phase 6 of the schedule-ui split).
// Board rendering callbacks still live in schedule-ui.js and are injected via
// initScheduleDnd().

import { validateScheduleDraft } from "./schedule-validator.js?v=20260817_build_hours";
import { parseScheduleTimeToMinutes } from "./schedule-helpers.js?v=20260903_sched_lock";
import { scheduleState } from "./schedule-state.js?v=20260702_schedule_state";
import { loadCrossLocationBusyForWeek } from "./schedule-cloud.js?v=20260903_sched_lock";
import {
  formatScheduleTimeRangeDisplay,
  getApprovedPartialTimeConflictMessage,
  getScheduleStaffKey,
  getScheduleStaffRole,
  getWeekRange,
} from "./schedule-format.js?v=20260903_sched_lock2";
import {
  cloneScheduleDraft,
  dayHasManualOff,
  findDraftDay,
  getAssignmentId,
  persistScheduleDraftOverrideFromState,
  pushScheduleUndoSnapshot,
  removeManualOffForStaffDay,
  staffDayBlockedByApprovedInbox,
} from "./schedule-draft.js?v=20260903_sched_lock";
import {
  openScheduleDnDOffConfirm,
  openScheduleShiftEdit,
  scheduleUserCanManualEdit,
} from "./schedule-shift-edit.js?v=20260903_sched_lock2";

// -- injected via initScheduleDnd() (wired in schedule-ui.js) --
let renderScheduleBoard;
let renderScheduleSummary;
let renderScheduleViewTabs;

export function initScheduleDnd(deps) {
  ({
    renderScheduleBoard,
    renderScheduleSummary,
    renderScheduleViewTabs,
  } = deps);
}

function getAssignmentFromDragPayload(payload) {
  const day = findDraftDay(scheduleState.schedulePreviewState.draft, payload?.sourceDate);
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
  scheduleState.scheduleApprovedTimeConflictContinue = null;
}

function openScheduleApprovedTimeConflictModal(message, onConfirm) {
  scheduleState.scheduleApprovedTimeConflictContinue = onConfirm;
  const body = document.getElementById("scheduleApprovedTimeConflictBody");
  if (body) body.textContent = message;
  const el = ensureScheduleApprovedTimeConflictModal();
  el.style.display = "flex";
}

function confirmScheduleApprovedTimeConflictModal() {
  const fn = scheduleState.scheduleApprovedTimeConflictContinue;
  closeScheduleApprovedTimeConflictModal();
  if (typeof fn === "function") {
    try {
      fn();
    } catch (e) {
      console.error("[ScheduleUI] approved time conflict confirm", e);
    }
  }
}

/**
 * Returns the conflicting cross-location busy window for a staff member on a
 * given date if the proposed [start,end] shift overlaps a shift they already
 * have at ANOTHER active location for the same day; otherwise null. Reuses the
 * exact same busy data the auto-builder uses (loadCrossLocationBusyForWeek),
 * keyed by every identity variant so it matches regardless of staffId/uid.
 * Fail-open: any error (e.g. the other branch's draft can't be read) returns
 * null so a manual save is never blocked by a transient read failure.
 */
async function getCrossLocationConflictForShift(staff, dateKey, startHHMM, endHHMM) {
  try {
    if (!staff || !dateKey) return null;
    const startMin = parseScheduleTimeToMinutes(startHHMM);
    const endMin = parseScheduleTimeToMinutes(endHHMM);
    if (startMin == null || endMin == null || endMin <= startMin) return null;
    const weekRange = getWeekRange(scheduleState.schedulePreviewWeekStart);
    const busy = await loadCrossLocationBusyForWeek(weekRange);
    if (!busy) return null;

    const candidateKeys = [];
    const pushKey = (k) => {
      const s = String(k || "").trim();
      if (s && !candidateKeys.includes(s)) candidateKeys.push(s);
    };
    pushKey(getScheduleStaffKey(staff));
    pushKey(staff.staffId);
    pushKey(staff.uid);
    pushKey(staff.userUid);
    pushKey(staff.id);

    let hit = null;
    for (const key of candidateKeys) {
      const list = busy[key] && busy[key][dateKey];
      if (!Array.isArray(list)) continue;
      for (const w of list) {
        const ws = Number(w.startMin);
        const we = Number(w.endMin);
        if (!Number.isFinite(ws) || !Number.isFinite(we) || we <= ws) continue;
        if (Math.min(endMin, we) > Math.max(startMin, ws)) {
          hit = { startMin: ws, endMin: we };
          break;
        }
      }
      if (hit) break;
    }
    if (!hit) return null;

    const toHHMM = (m) =>
      `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const range = formatScheduleTimeRangeDisplay(toHHMM(hit.startMin), toHHMM(hit.endMin), {
      compact: true,
    });
    const name = String(staff.name || "").trim() || "This person";
    const message =
      `${name} is already scheduled at another location on this day (${range}). ` +
      `The same person can't work two branches at the same time. Save this shift anyway?`;
    return { ...hit, message };
  } catch (e) {
    console.warn("[ScheduleUI] cross-location conflict check failed", e);
    return null;
  }
}

function ensureScheduleCrossLocationConflictModal() {
  if (document.getElementById("scheduleCrossLocationConflictBackdrop")) {
    return document.getElementById("scheduleCrossLocationConflictBackdrop");
  }
  const backdrop = document.createElement("div");
  backdrop.id = "scheduleCrossLocationConflictBackdrop";
  backdrop.style.cssText =
    "display:none;position:fixed;inset:0;background:rgba(15,23,42,0.5);z-index:4150;align-items:center;justify-content:center;padding:20px;";
  backdrop.innerHTML = `
    <div role="dialog" aria-modal="true" aria-labelledby="scheduleCrossLocationConflictTitle" style="background:#fff;border-radius:16px;padding:24px 26px;max-width:460px;width:100%;box-shadow:0 25px 50px -12px rgba(0,0,0,0.28);">
      <div id="scheduleCrossLocationConflictTitle" style="font-size:18px;font-weight:700;color:#111827;margin-bottom:10px;">Already booked at another location</div>
      <p id="scheduleCrossLocationConflictBody" style="margin:0 0 22px 0;font-size:14px;color:#4b5563;line-height:1.55;"></p>
      <div style="display:flex;gap:12px;justify-content:flex-end;flex-wrap:wrap;">
        <button type="button" id="scheduleCrossLocationConflictCancel" style="padding:10px 18px;border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-weight:600;cursor:pointer;font-size:14px;">Cancel</button>
        <button type="button" id="scheduleCrossLocationConflictOk" style="padding:10px 18px;border-radius:10px;border:none;background:#7c3aed;color:#fff;font-weight:600;cursor:pointer;font-size:14px;">Save anyway</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeScheduleCrossLocationConflictModal(false);
  });
  document
    .getElementById("scheduleCrossLocationConflictCancel")
    ?.addEventListener("click", () => closeScheduleCrossLocationConflictModal(false));
  document
    .getElementById("scheduleCrossLocationConflictOk")
    ?.addEventListener("click", () => closeScheduleCrossLocationConflictModal(true));
  return backdrop;
}

function closeScheduleCrossLocationConflictModal(result) {
  const el = document.getElementById("scheduleCrossLocationConflictBackdrop");
  if (el) el.style.display = "none";
  const resolve = scheduleState.scheduleCrossLocationConflictResolver;
  scheduleState.scheduleCrossLocationConflictResolver = null;
  if (typeof resolve === "function") resolve(result === true);
}

/** Opens the cross-location confirm modal; resolves true to proceed, false to cancel. */
function confirmScheduleCrossLocationConflict(message) {
  return new Promise((resolve) => {
    // If a previous prompt is somehow still pending, resolve it as cancelled
    // so we never leave a dangling promise.
    if (typeof scheduleState.scheduleCrossLocationConflictResolver === "function") {
      try { scheduleState.scheduleCrossLocationConflictResolver(false); } catch (_) {}
    }
    const el = ensureScheduleCrossLocationConflictModal();
    const body = document.getElementById("scheduleCrossLocationConflictBody");
    if (body) body.textContent = message;
    scheduleState.scheduleCrossLocationConflictResolver = resolve;
    el.style.display = "flex";
  });
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
  try {
    if (scheduleState.schedulePreviewState.draft) {
      pushScheduleUndoSnapshot();
    }
  } catch (e) {
    console.warn("[ScheduleUI] undo snapshot on edit failed", e);
  }
  const coverageRules = scheduleState.schedulePreviewState.coverageRules !== undefined
    ? scheduleState.schedulePreviewState.coverageRules
    : (window.settings && typeof window.settings.coverageRules === "object" ? window.settings.coverageRules : undefined);
  const requests = Array.isArray(scheduleState.schedulePreviewState.requests) ? scheduleState.schedulePreviewState.requests : [];
  const nextValidation = validateScheduleDraft({
    draftSchedule: nextDraft,
    staffList: scheduleState.schedulePreviewState.staffList,
    requests,
    rules: nextDraft?.rules || scheduleState.schedulePreviewState.draft?.rules || {},
    coverageRules,
    dateRange: scheduleState.schedulePreviewState.weekRange
      ? { startDate: scheduleState.schedulePreviewState.weekRange.startDate, endDate: scheduleState.schedulePreviewState.weekRange.endDate }
      : undefined,
  });

  scheduleState.schedulePreviewState = {
    ...scheduleState.schedulePreviewState,
    draft: nextDraft,
    validation: nextValidation,
  };
  if (typeof window !== "undefined") {
    window.ffSchedulePreviewState = scheduleState.schedulePreviewState;
  }
  try {
    persistScheduleDraftOverrideFromState();
  } catch (e) {
    console.warn("[ScheduleUI] persist after edit failed", e);
  }
}

function clearDropZoneVisual(zone) {
  if (!zone) return;
  zone.style.outline = "";
  zone.style.outlineOffset = "";
}

function handleShiftDragStart(event) {
  if (!scheduleUserCanManualEdit() || scheduleState.schedulePreviewMode !== "build") {
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
  scheduleState.scheduleDragState = payload;
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
  scheduleState.scheduleDragState = null;
}

function handleScheduleShiftClick(event) {
  if (event.target && event.target.closest && event.target.closest("[data-schedule-cell-note]")) return;
  if (!scheduleUserCanManualEdit() || scheduleState.schedulePreviewMode !== "build") return;
  const shiftEl = event.currentTarget;
  const staffKey = String(shiftEl?.getAttribute("data-staff-id") || "").trim();
  const dateKey = String(shiftEl?.getAttribute("data-date") || "").trim();
  if (!staffKey || !dateKey) return;
  const day = findDraftDay(scheduleState.schedulePreviewState.draft, dateKey);
  const assignment = Array.isArray(day?.assignments)
    ? day.assignments.find((a) => String(a.staffId || a.uid || "").trim() === staffKey)
    : null;
  if (!assignment) return;
  const staff = getStaffByScheduleKey(scheduleState.schedulePreviewState.staffList, staffKey);
  event.preventDefault();
  event.stopPropagation();
  openScheduleShiftEdit({
    staffKey,
    dateKey,
    startTime: assignment.startTime,
    endTime: assignment.endTime,
    staffName: String(staff?.name || assignment.name || "").trim(),
    isNew: false,
  });
}

function handleDropZoneDragOver(event) {
  if (!scheduleUserCanManualEdit() || scheduleState.schedulePreviewMode !== "build") return;
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
  const nextDraft = cloneScheduleDraft(scheduleState.schedulePreviewState.draft);
  const sourceDay = findDraftDay(nextDraft, payload.sourceDate);
  const targetDay = findDraftDay(nextDraft, targetDate);
  const sourceStaff = getStaffByScheduleKey(scheduleState.schedulePreviewState.staffList, payload.sourceStaffId);
  const targetStaff = getStaffByScheduleKey(scheduleState.schedulePreviewState.staffList, targetStaffId);
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
    const targetStaff = getStaffByScheduleKey(scheduleState.schedulePreviewState.staffList, targetStaffId);
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

  try {
    revalidateLocalDraft(nextDraft);
  } catch (e) {
    console.error("[Schedule DnD] drop apply failed", e);
    scheduleState.schedulePreviewState.draft = nextDraft;
  }
  renderScheduleSummary(scheduleState.schedulePreviewState.validation, scheduleState.schedulePreviewState.validation?.days || []);
  renderScheduleViewTabs();
  renderScheduleBoard(scheduleState.schedulePreviewState.draft, scheduleState.schedulePreviewState.validation, scheduleState.schedulePreviewState.staffList);
}

function handleDropZoneDrop(event) {
  event.preventDefault();
  if (!scheduleUserCanManualEdit() || scheduleState.schedulePreviewMode !== "build") return;
  const zone = event.currentTarget;
  clearDropZoneVisual(zone);
  const targetStaffId = String(zone?.getAttribute("data-staff-id") || "").trim();
  const targetDate = String(zone?.getAttribute("data-date") || "").trim();
  const payload = scheduleState.scheduleDragState;
  if (!payload || !payload.shiftId || !payload.sourceStaffId || !payload.sourceDate || !targetStaffId || !targetDate) return;
  if (payload.sourceStaffId === targetStaffId && payload.sourceDate === targetDate) return;

  const targetStaff = getStaffByScheduleKey(scheduleState.schedulePreviewState.staffList, targetStaffId);
  if (targetStaff && staffDayBlockedByApprovedInbox(targetStaff, targetDate)) {
    openScheduleDnDOffConfirm({
      variant: "approved_inbox",
      payload,
      targetStaffId,
      targetDate,
    });
    return;
  }

  const targetDayPreview = findDraftDay(scheduleState.schedulePreviewState.draft, targetDate);
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
    el.addEventListener("click", handleScheduleShiftClick);
  });

  document.querySelectorAll('[data-drop-zone="true"]').forEach((zone) => {
    if (zone.__ffDnDBound) return;
    zone.__ffDnDBound = true;
    zone.addEventListener("dragover", handleDropZoneDragOver);
    zone.addEventListener("dragleave", handleDropZoneDragLeave);
    zone.addEventListener("drop", handleDropZoneDrop);
  });
}


export {
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
};
