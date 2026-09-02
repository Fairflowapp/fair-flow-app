// schedule-format.js
// Schedule — time input/composite helpers, week/date formatting, staff-role
// filters, HHMM/time display helpers, and warning/day-label formatting.
// Extracted verbatim from schedule-ui.js (Phase 3 of the schedule-ui split).

import { getInboxApprovalDisplayForDate } from "./schedule-availability.js?v=20260902_sched_dual";
import { parseScheduleTimeToMinutes } from "./schedule-helpers.js?v=20260902_sched_dual";
import { scheduleState } from "./schedule-state.js?v=20260702_schedule_state";
import { getAuthedStaffIdForSchedule } from "./schedule-ack.js?v=20260902_sched_dual";
import {
  getScheduleAccessContext,
  scheduleUserCanManualEdit,
} from "./schedule-shift-edit.js?v=20260817_build_hours";

function hhmmFromTimeInput(v) {
  const s = String(v || "").trim();
  const match = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// ── 12-hour shift-time picker ────────────────────────────────────────────
// Native <input type="time"> renders 12h/24h purely by the browser/OS locale,
// so it ignores the app's Time Format preference (a 12h-preference user on a
// 24h OS still sees 24h). To honor the preference deterministically across all
// browsers, when the preference is 12h we hide the raw input (keeping it as the
// canonical "HH:MM" 24h value holder so NO read/validation code changes) and
// drive it from a composite hour(1-12) / minute / AM-PM picker.

const SCHEDULE_TIME_COMPOSITE_CLASS = "ff-sched-time-12h";

function buildScheduleMinuteOptions(selectEl, currentMin) {
  if (!selectEl) return;
  const mins = [];
  for (let m = 0; m < 60; m += 5) mins.push(m);
  const cur = Number.isFinite(currentMin) ? currentMin : null;
  if (cur != null && !mins.includes(cur)) {
    mins.push(cur);
    mins.sort((a, b) => a - b);
  }
  selectEl.innerHTML = mins
    .map((m) => `<option value="${m}">${String(m).padStart(2, "0")}</option>`)
    .join("");
}

function getOrCreateScheduleTimeComposite(inputEl) {
  if (!inputEl) return null;
  const next = inputEl.nextElementSibling;
  if (next && next.classList && next.classList.contains(SCHEDULE_TIME_COMPOSITE_CLASS)) {
    return next;
  }
  const wrap = document.createElement("span");
  wrap.className = SCHEDULE_TIME_COMPOSITE_CLASS;
  wrap.style.cssText =
    "display:flex;gap:6px;align-items:center;margin-top:4px;";
  const selStyle =
    "height:40px;border:1px solid #e5e7eb;border-radius:8px;padding:0 8px;box-sizing:border-box;background:#fff;font-size:14px;color:#111827;cursor:pointer;";
  const hourSel = document.createElement("select");
  hourSel.setAttribute("data-ff-role", "hour");
  hourSel.style.cssText = selStyle + "flex:1;min-width:60px;";
  hourSel.innerHTML = Array.from({ length: 12 }, (_, i) => i + 1)
    .map((h) => `<option value="${h}">${h}</option>`)
    .join("");
  const colon = document.createElement("span");
  colon.textContent = ":";
  colon.style.cssText = "color:#6b7280;font-weight:700;";
  const minSel = document.createElement("select");
  minSel.setAttribute("data-ff-role", "min");
  minSel.style.cssText = selStyle + "flex:1;min-width:60px;";
  buildScheduleMinuteOptions(minSel, 0);
  const ampmSel = document.createElement("select");
  ampmSel.setAttribute("data-ff-role", "ampm");
  ampmSel.style.cssText = selStyle + "flex:1;min-width:64px;";
  ampmSel.innerHTML = `<option value="AM">AM</option><option value="PM">PM</option>`;
  wrap.appendChild(hourSel);
  wrap.appendChild(colon);
  wrap.appendChild(minSel);
  wrap.appendChild(ampmSel);
  const onChange = () => syncScheduleHiddenFromComposite(inputEl);
  hourSel.addEventListener("change", onChange);
  minSel.addEventListener("change", onChange);
  ampmSel.addEventListener("change", onChange);
  inputEl.insertAdjacentElement("afterend", wrap);
  return wrap;
}

function syncScheduleCompositeFromHHMM(inputEl, hhmm) {
  const wrap = getOrCreateScheduleTimeComposite(inputEl);
  if (!wrap) return;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  let h24 = 9;
  let min = 0;
  if (m) {
    h24 = Math.max(0, Math.min(23, Number(m[1])));
    min = Math.max(0, Math.min(59, Number(m[2])));
  }
  const ampm = h24 >= 12 ? "PM" : "AM";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  const hourSel = wrap.querySelector('[data-ff-role="hour"]');
  const minSel = wrap.querySelector('[data-ff-role="min"]');
  const ampmSel = wrap.querySelector('[data-ff-role="ampm"]');
  if (minSel) buildScheduleMinuteOptions(minSel, min);
  if (hourSel) hourSel.value = String(h12);
  if (minSel) minSel.value = String(min);
  if (ampmSel) ampmSel.value = ampm;
}

function syncScheduleHiddenFromComposite(inputEl) {
  if (!inputEl) return;
  const wrap = inputEl.nextElementSibling;
  if (!wrap || !wrap.classList || !wrap.classList.contains(SCHEDULE_TIME_COMPOSITE_CLASS)) return;
  const hourSel = wrap.querySelector('[data-ff-role="hour"]');
  const minSel = wrap.querySelector('[data-ff-role="min"]');
  const ampmSel = wrap.querySelector('[data-ff-role="ampm"]');
  let h12 = Number(hourSel?.value);
  const min = Number(minSel?.value);
  const ampm = ampmSel?.value === "PM" ? "PM" : "AM";
  if (!Number.isFinite(h12) || !Number.isFinite(min)) return;
  h12 = h12 % 12;
  const h24 = ampm === "PM" ? h12 + 12 : h12;
  inputEl.value = `${String(h24).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function setScheduleTimeCompositeDisabled(inputEl, disabled) {
  const wrap = inputEl?.nextElementSibling;
  if (!wrap || !wrap.classList || !wrap.classList.contains(SCHEDULE_TIME_COMPOSITE_CLASS)) return;
  wrap.querySelectorAll("select").forEach((sel) => {
    sel.disabled = Boolean(disabled);
    sel.style.opacity = disabled ? "0.6" : "";
    sel.style.cursor = disabled ? "not-allowed" : "pointer";
  });
}

/**
 * Configures a shift-time field for the current Time Format preference.
 * 24h → plain text "HH:mm" input (existing behavior). 12h → raw input becomes
 * a hidden canonical value holder driven by an AM/PM composite picker.
 */
function applyScheduleTimeFieldDisplay(inputEl, prefers24h) {
  if (!inputEl) return;
  if (prefers24h) {
    const wrap = inputEl.nextElementSibling;
    if (wrap && wrap.classList && wrap.classList.contains(SCHEDULE_TIME_COMPOSITE_CLASS)) {
      wrap.style.display = "none";
    }
    inputEl.style.display = "";
    inputEl.type = "text";
    inputEl.inputMode = "numeric";
    inputEl.maxLength = 5;
    inputEl.pattern = "\\d{1,2}:\\d{2}";
    inputEl.placeholder = "HH:mm";
  } else {
    inputEl.type = "hidden";
    inputEl.removeAttribute("inputmode");
    inputEl.removeAttribute("maxlength");
    inputEl.removeAttribute("pattern");
    inputEl.removeAttribute("placeholder");
    const wrap = getOrCreateScheduleTimeComposite(inputEl);
    if (wrap) wrap.style.display = "flex";
  }
}

/** Sets a shift-time field's value ("HH:MM" 24h) and mirrors it to the picker. */
function setScheduleTimeFieldValue(inputEl, hhmm, prefers24h) {
  if (!inputEl) return;
  inputEl.value = String(hhmm || "");
  if (!prefers24h) syncScheduleCompositeFromHHMM(inputEl, hhmm);
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
  if (ctx.viewOwnOnly) {
    const sid = String(
      typeof window !== "undefined" && window.__ff_authedStaffId
        ? window.__ff_authedStaffId
        : (typeof localStorage !== "undefined" ? localStorage.getItem("ff_authedStaffId_v1") : "") || "",
    ).trim();
    if (!sid) return [];
    const me = (Array.isArray(staffList) ? staffList : []).find((staff) => getScheduleStaffKey(staff) === sid);
    return me ? [me] : [];
  }

  if (scheduleUserCanManualEdit() && scheduleState.schedulePreviewMode === "my_shifts") {
    const sid = getAuthedStaffIdForSchedule();
    if (!sid) return [];
    const me = (Array.isArray(staffList) ? staffList : []).find((staff) => getScheduleStaffKey(staff) === sid);
    return me ? [me] : [];
  }

  let filtered = (Array.isArray(staffList) ? staffList : []).filter((staff) => {
    return scheduleState.schedulePreviewView === "technicians"
      ? isTechnicianScheduleStaff(staff)
      : isManagementScheduleStaff(staff);
  });

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


function compareScheduleHHMM(a, b) {
  const ma = parseScheduleTimeToMinutes(a);
  const mb = parseScheduleTimeToMinutes(b);
  if (ma == null || mb == null) return 0;
  return ma - mb;
}

function formatWeeklyHoursShort(totalMinutes) {
  if (!totalMinutes || totalMinutes <= 0) return "0h";
  const h = totalMinutes / 60;
  const rounded = Math.round(h * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 0.05) return `${Math.round(rounded)}h`;
  return `${rounded.toFixed(1)}h`;
}

/** "HH:mm" -> display label according to Preferences > Time Format. */
function formatScheduleTimeShortAmPm(hhmm) {
  if (typeof window !== "undefined" && typeof window.ffFormatDisplayTime === "function") {
    return window.ffFormatDisplayTime(hhmm, { compact: true });
  }
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

function formatScheduleTimeDisplay(hhmm, options = {}) {
  const raw = String(hhmm || "").trim();
  if (!raw) return options.fallback || "";
  if (typeof window !== "undefined" && typeof window.ffFormatDisplayTime === "function") {
    return window.ffFormatDisplayTime(raw, { compact: options.compact === true, fallback: raw });
  }
  return raw;
}

function formatScheduleTimeRangeDisplay(start, end, options = {}) {
  const rawStart = String(start || "").trim();
  const rawEnd = String(end || "").trim();
  if (!rawStart && !rawEnd) return options.fallback || "";
  if (typeof window !== "undefined" && typeof window.ffFormatDisplayTimeRange === "function") {
    return window.ffFormatDisplayTimeRange(rawStart, rawEnd, {
      compact: options.compact === true,
      separator: options.separator || " - ",
    });
  }
  if (!rawStart) return rawEnd;
  if (!rawEnd) return rawStart;
  return `${rawStart}${options.separator || " - "}${rawEnd}`;
}

function formatScheduleRawRangeDisplay(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/);
  if (!match) return raw;
  return formatScheduleTimeRangeDisplay(match[1], match[2], { separator: raw.includes("–") ? "–" : "-" });
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
  const requests = Array.isArray(scheduleState.schedulePreviewState.requests) ? scheduleState.schedulePreviewState.requests : [];
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

export {
  SCHEDULE_COVERAGE_WARNING_CODES,
  SCHEDULE_TIME_COMPOSITE_CLASS,
  addDays,
  applyScheduleTimeFieldDisplay,
  buildScheduleMinuteOptions,
  cellShowsScheduleWarningDot,
  compareScheduleHHMM,
  earlierScheduleHHMM,
  filterCoverageWarnings,
  filterNonCoverageWarnings,
  formatBoardDayLabel,
  formatLongDate,
  formatScheduleRawRangeDisplay,
  formatScheduleTimeDisplay,
  formatScheduleTimeRangeDisplay,
  formatScheduleTimeShortAmPm,
  formatWeekLabel,
  formatWeeklyHoursShort,
  getApprovedPartialRequestHints,
  getApprovedPartialTimeConflictMessage,
  getDayNameFromDateKey,
  getFilteredScheduleStaff,
  getScheduleStaffKey,
  getScheduleStaffRole,
  getSeverityBadgeStyle,
  getStartOfWeek,
  getValidationByDate,
  getWeekRange,
  getWeekStartsOnPreference,
  getOrCreateScheduleTimeComposite,
  hhmmFromTimeInput,
  isManagementScheduleStaff,
  isTechnicianScheduleStaff,
  laterScheduleHHMM,
  normalizeTimeValue,
  setScheduleTimeCompositeDisabled,
  setScheduleTimeFieldValue,
  syncScheduleCompositeFromHHMM,
  syncScheduleHiddenFromComposite,
  syncScheduleWeekFilterUi,
  toDateKey,
  warningAppliesToStaffRow,
};
