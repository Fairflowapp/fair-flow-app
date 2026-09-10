// schedule-render-modals.js
// Schedule render modals — stand-by row + picker modal, and the day coverage
// modal. Extracted verbatim from schedule-render.js (schedule-render split T1).

import { scheduleState } from "./schedule-state.js?v=20260702_schedule_state";
import {
  findDraftDay,
  persistScheduleDraftOverrideFromState,
  pushScheduleUndoSnapshot,
  syncPublishedWeekStandByToCloud,
} from "./schedule-draft.js?v=20260903_sched_lock";
import {
  filterCoverageWarnings,
  formatBoardDayLabel,
  formatScheduleTimeRangeDisplay,
  getDayNameFromDateKey,
  getFilteredScheduleStaff,
  getScheduleStaffKey,
  getValidationByDate,
  getWeekRange,
} from "./schedule-format.js?v=20260903_sched_lock2";
import {
  escapeScheduleAttr,
  escapeScheduleHtml,
  scheduleUserCanManualEdit,
} from "./schedule-shift-edit.js?v=20260903_sched_lock2";

// -- injected via initScheduleRenderModals() (wired in schedule-render.js) --
let STAND_BY_SLOTS;
let cloneStandByByDateMap = function cloneStandByByDateMap(map) {
  try {
    return JSON.parse(JSON.stringify(map && typeof map === "object" ? map : {}));
  } catch (_) {
    return {};
  }
};
let getBusinessStatusForDate;
let parseStandByDayEntry;
let renderScheduleBoard;
let resolveStandByStaffMember;
let standByDayEntryHasAny;

export function initScheduleRenderModals(deps) {
  ({
    STAND_BY_SLOTS,
    getBusinessStatusForDate,
    parseStandByDayEntry,
    renderScheduleBoard,
    resolveStandByStaffMember,
    standByDayEntryHasAny,
  } = deps);
  if (typeof deps.cloneStandByByDateMap === "function") {
    cloneStandByByDateMap = deps.cloneStandByByDateMap;
  }
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


function closeScheduleStandByModal() {
  const backdrop = document.getElementById("scheduleStandByModalBackdrop");
  if (backdrop) backdrop.style.display = "none";
  scheduleState.scheduleStandByModalDateKey = null;
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
    if (!scheduleState.scheduleStandByModalDateKey) return;
    const sel1 = document.getElementById("scheduleStandByModalSelect1");
    const sel2 = document.getElementById("scheduleStandByModalSelect2");
    const id1 = String(sel1?.value || "").trim();
    const id2 = String(sel2?.value || "").trim();
    const viewKey = scheduleState.schedulePreviewView === "technicians" ? "technicians" : "management";
    const dk = scheduleState.scheduleStandByModalDateKey;
    let prevMap = {};
    try {
      prevMap = JSON.parse(
        JSON.stringify(
          scheduleState.schedulePreviewState.standByByDate && typeof scheduleState.schedulePreviewState.standByByDate === "object"
            ? scheduleState.schedulePreviewState.standByByDate
            : {},
        ),
      );
    } catch (_) {
      prevMap = {};
    }
    const base = parseStandByDayEntry(prevMap[dk]);
    prevMap[dk] = {
      ...base,
      [viewKey]: [id1, id2],
    };
    if (!standByDayEntryHasAny(prevMap[dk])) delete prevMap[dk];
    pushScheduleUndoSnapshot();
    scheduleState.schedulePreviewState.standByByDate = prevMap;
    if (typeof window !== "undefined") {
      window.ffSchedulePreviewState = scheduleState.schedulePreviewState;
    }
    persistScheduleDraftOverrideFromState();
    const wr = scheduleState.schedulePreviewState.weekRange || getWeekRange(scheduleState.schedulePreviewWeekStart);
    const ws = wr?.startDate;
    if (ws && scheduleState.schedulePublishedMap[ws] === true) {
      void syncPublishedWeekStandByToCloud(ws);
    }
    closeScheduleStandByModal();
    renderScheduleBoard(
      scheduleState.schedulePreviewState.draft,
      scheduleState.schedulePreviewState.validation,
      scheduleState.schedulePreviewState.staffList,
    );
  });
  return backdrop;
}

function openScheduleStandByModal(dateKey) {
  const backdrop = ensureScheduleStandByModal();
  scheduleState.scheduleStandByModalDateKey = String(dateKey || "").trim();
  const dk = scheduleState.scheduleStandByModalDateKey;
  const dayLabel = formatBoardDayLabel(dk);
  const titleEl = document.getElementById("scheduleStandByModalTitle");
  const subEl = document.getElementById("scheduleStandByModalSubtitle");
  const tab = scheduleState.schedulePreviewView === "technicians" ? "Service Providers" : "Management";
  const viewKey = scheduleState.schedulePreviewView === "technicians" ? "technicians" : "management";
  if (titleEl) titleEl.textContent = `Stand by (${tab}) — ${dayLabel.title} ${dayLabel.subtitle}`;
  if (subEl) {
    subEl.textContent = `Up to two contacts for this day. Lists only ${tab} staff. The other tab has its own stand-by row.`;
  }
  const staffOpts = getFilteredScheduleStaff(scheduleState.schedulePreviewState.staffList);
  const entry = parseStandByDayEntry(scheduleState.schedulePreviewState.standByByDate?.[dk]);
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
    if (!scheduleUserCanManualEdit() || scheduleState.schedulePreviewMode !== "build") return;
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
    const range = formatScheduleTimeRangeDisplay(fmt(m.lo), fmt(m.hi), { separator: "–" });
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
  const validationByDate = getValidationByDate(scheduleState.schedulePreviewState.validation);
  const dayEntry = validationByDate.get(dateKey);
  const cov = filterCoverageWarnings(dayEntry?.warnings);
  const helpers = window.ffScheduleHelpers;
  const dayName = getDayNameFromDateKey(dateKey);
  const businessHours = window.settings?.businessHours || {};
  const dayShiftSegments = window.settings?.dayShiftSegments || {};
  const coverageRules = window.settings?.coverageRules || {};
  const draftDay = findDraftDay(scheduleState.schedulePreviewState.draft, dateKey);
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
    if (!scheduleUserCanManualEdit() || scheduleState.schedulePreviewMode !== "build") return;
    const dateKey = String(btn.getAttribute("data-date") || "").trim();
    if (!dateKey) return;
    openScheduleCoverageDayModal(dateKey);
  });
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
};
