// schedule-render-board.js
// Schedule board rendering — desktop grid, mobile cards, staff profile links,
// and loading state. Extracted verbatim from schedule-render.js
// (schedule-render split T2).

import { getInboxApprovalDisplayForDate } from "./schedule-availability.js?v=20260615_default_schedule_source";
import { scheduleState } from "./schedule-state.js?v=20260702_schedule_state";
import { getAuthedStaffIdForSchedule } from "./schedule-ack.js?v=20260702_schedule_ack";
import { bindScheduleBoardDnD } from "./schedule-dnd.js?v=20260702_schedule_dnd";
import {
  buildAssignmentLookup,
  dayHasManualOff,
  getAssignmentId,
  staffDayBlockedByApprovedInbox,
} from "./schedule-draft.js?v=20260702_schedule_draft";
import { _ffActiveLocationNameForIcs } from "./schedule-ics.js?v=20260702_schedule_ics";
import {
  cellShowsScheduleWarningDot,
  compareScheduleHHMM,
  filterCoverageWarnings,
  filterNonCoverageWarnings,
  formatBoardDayLabel,
  formatScheduleTimeRangeDisplay,
  formatScheduleTimeShortAmPm,
  formatWeeklyHoursShort,
  getFilteredScheduleStaff,
  getScheduleStaffKey,
  getValidationByDate,
  getWeekRange,
} from "./schedule-format.js?v=20260806_sched_12h_picker";
import {
  bindScheduleBoardManualAdd,
  bindScheduleShiftEditButtons,
  escapeScheduleAttr,
  escapeScheduleHtml,
  formatLunchBreakCellSubtitle,
  getScheduleAccessContext,
  scheduleUserCanManualEdit,
} from "./schedule-shift-edit.js?v=20260806_sched_12h_picker";
import {
  bindScheduleCoverageDayClick,
  bindScheduleStandByPen,
  renderScheduleStandByRowHtml,
  renderStandBySlotNamesHtml,
} from "./schedule-render-modals.js?v=20260703_schedule_render_split";

// -- injected via initScheduleRenderBoard() (wired in schedule-render.js) --
let computeStaffWeeklyScheduledMinutes;
let formatScheduleTechnicianTypes;
let getBusinessStatusForDate;
let getScheduleRoleLabel;
let parseStandByDayEntry;

export function initScheduleRenderBoard(deps) {
  ({
    computeStaffWeeklyScheduledMinutes,
    formatScheduleTechnicianTypes,
    getBusinessStatusForDate,
    getScheduleRoleLabel,
    parseStandByDayEntry,
  } = deps);
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

export {
  bindScheduleStaffProfileLinks,
  renderScheduleBoard,
  setScheduleLoadingState,
};
