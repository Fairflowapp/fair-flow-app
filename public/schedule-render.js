// schedule-render.js
// Schedule render entry — summary bar and view/mode controls. Board rendering
// lives in schedule-render-board.js; stand-by and coverage modals live in
// schedule-render-modals.js. This entry re-exports the full public API and
// fans initScheduleRender() deps out to both sub-modules.

import { scheduleState } from "./schedule-state.js?v=20260702_schedule_state";
import {
  ensureScheduleChangePingListener,
  getAuthedStaffIdForSchedule,
  teardownScheduleChangePingListener,
  updateScheduleWeekAckStrip,
} from "./schedule-ack.js?v=20260702_schedule_ack";
import {
  canViewScheduleBoardForCurrentWeek,
  isAuthedUserMultiLocationForWeek,
  renderScheduleUnpublishedPlaceholder,
  updateSchedulePublishToggleUi,
} from "./schedule-cloud.js?v=20260702_schedule_cloud";
import {
  _ffDebugLogAuthedUserWeeklyHours,
  buildMyShiftsIcsForCurrentWeek,
  downloadMyShiftsIcsForCurrentWeek,
} from "./schedule-ics.js?v=20260702_schedule_ics";
import { getWeekRange } from "./schedule-format.js?v=20260702_schedule_format";
import {
  escapeScheduleHtml,
  getScheduleAccessContext,
  scheduleUserCanManualEdit,
} from "./schedule-shift-edit.js?v=20260702_schedule_shift_edit";
import { initScheduleRenderModals } from "./schedule-render-modals.js?v=20260703_schedule_render_split";
import {
  initScheduleRenderBoard,
  renderScheduleBoard,
} from "./schedule-render-board.js?v=20260703_schedule_render_split";

// -- injected via initScheduleRender() (wired in schedule-nav-runtime.js) --
let renderScheduleViewTabs;

export function initScheduleRender(deps) {
  ({ renderScheduleViewTabs } = deps);
  initScheduleRenderModals({
    STAND_BY_SLOTS: deps.STAND_BY_SLOTS,
    cloneStandByByDateMap: deps.cloneStandByByDateMap,
    getBusinessStatusForDate: deps.getBusinessStatusForDate,
    parseStandByDayEntry: deps.parseStandByDayEntry,
    renderScheduleBoard,
    resolveStandByStaffMember: deps.resolveStandByStaffMember,
    standByDayEntryHasAny: deps.standByDayEntryHasAny,
  });
  initScheduleRenderBoard({
    computeStaffWeeklyScheduledMinutes: deps.computeStaffWeeklyScheduledMinutes,
    formatScheduleTechnicianTypes: deps.formatScheduleTechnicianTypes,
    getBusinessStatusForDate: deps.getBusinessStatusForDate,
    getScheduleRoleLabel: deps.getScheduleRoleLabel,
    parseStandByDayEntry: deps.parseStandByDayEntry,
  });
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

export {
  bindScheduleCoverageDayClick,
  bindScheduleStandByPen,
  buildCoverageMinimalGapLinesHtml,
  buildScheduleCoverageModalBodyHtml,
  closeScheduleDayCoverageModal,
  closeScheduleStandByModal,
  ensureScheduleDayCoverageModal,
  ensureScheduleStandByModal,
  formatScheduleCoverageModalDateTitle,
  getCoverageOverlapGapsForModal,
  openScheduleCoverageDayModal,
  openScheduleStandByModal,
  renderScheduleStandByRowHtml,
  renderStandBySlotNamesHtml,
  shortenCoverageWarningForModal,
} from "./schedule-render-modals.js?v=20260703_schedule_render_split";
export {
  bindScheduleStaffProfileLinks,
  setScheduleLoadingState,
} from "./schedule-render-board.js?v=20260703_schedule_render_split";
export { renderScheduleBoard };
export {
  renderScheduleSummary,
  setSchedulePreviewMode,
  setSchedulePreviewView,
};
