// schedule-nav-core.js
// Schedule nav core helpers — stand-by normalization, business/role helpers,
// staff/inbox loading, tech type labels, view tabs, and cross-location warning
// banner. Extracted verbatim from schedule-nav.js (schedule-nav split T1).

import {
  collection,
  getDocs,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { auth, db } from "/app.js?v=20260610_force_lp_ios";
import { isApprovedRequest } from "./schedule-availability.js?v=20260902_sched_dual";
import { inboxItemMatchesActiveLocation, inboxGetActiveLocationId } from "./inbox-helpers.js?v=20260901_sched_req";
import { parseScheduleTimeToMinutes } from "./schedule-helpers.js?v=20260902_sched_dual";
import { scheduleState } from "./schedule-state.js?v=20260702_schedule_state";
import { _ffSchedActiveLocId, _ffSchedUserHasMultipleLocations, _ffSchedPrimaryLocationId } from "./schedule-ack.js?v=20260902_sched_dual";
import { getStaffByScheduleKey } from "./schedule-dnd.js?v=20260827_1258notes";
import {
  formatScheduleRawRangeDisplay,
  getDayNameFromDateKey,
  getScheduleStaffKey,
  getScheduleStaffRole,
  normalizeTimeValue,
} from "./schedule-format.js?v=20260806_sched_12h_picker";
import {
  getScheduleAccessContext,
  scheduleUserCanManualEdit,
} from "./schedule-shift-edit.js?v=20260817_build_hours";

// -- injected via initScheduleNavCore() (wired in schedule-nav-runtime.js) --
let renderScheduleBoard;
let refreshSchedulePreview;

export function initScheduleNavCore(deps) {
  ({ renderScheduleBoard, refreshSchedulePreview } = deps);
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


function rebuildScheduleTechTypeMap(types) {
  const map = {};
  (Array.isArray(types) ? types : []).forEach((t) => {
    if (t && typeof t === "object" && t.id != null) {
      const nm = String(t.name || "").trim();
      if (nm) map[String(t.id)] = nm;
    }
  });
  scheduleState.scheduleTechTypeNameById = map;
}

/**
 * Loads the salon's technician-types catalog once (id -> name) and keeps it
 * fresh via the shared `ff-technician-types-updated` event. Used so the staff
 * rows show readable type names instead of raw document ids.
 */
async function ensureScheduleTechTypeMap() {
  if (!scheduleState.scheduleTechTypesListenerBound && typeof document !== "undefined") {
    scheduleState.scheduleTechTypesListenerBound = true;
    document.addEventListener("ff-technician-types-updated", (e) => {
      rebuildScheduleTechTypeMap(e?.detail);
      scheduleState.scheduleTechTypesLoaded = true;
      if (scheduleState.schedulePreviewState?.draft) {
        try {
          renderScheduleBoard(
            scheduleState.schedulePreviewState.draft,
            scheduleState.schedulePreviewState.validation,
            scheduleState.schedulePreviewState.staffList,
          );
        } catch (_) { /* ignore */ }
      }
    });
  }
  if (scheduleState.scheduleTechTypesLoaded) return;
  try {
    if (typeof window !== "undefined" && typeof window.ffGetTechnicianTypes === "function") {
      const types = await window.ffGetTechnicianTypes({ all: true });
      rebuildScheduleTechTypeMap(types);
      scheduleState.scheduleTechTypesLoaded = true;
    }
  } catch (_) { /* ignore */ }
}

/**
 * Resolves a staff member's technicianTypes into a readable, comma-separated
 * label: custom-type ids -> their catalog name; built-in snake_case slugs ->
 * Title Case; unresolved raw ids are hidden (so no document id leaks to the UI).
 */
function formatScheduleTechnicianTypes(staff) {
  const list = Array.isArray(staff?.technicianTypes) ? staff.technicianTypes : [];
  if (!list.length) return null;
  const labels = list
    .map((t) => String(t == null ? "" : t).trim())
    .filter((key) => key && key !== "all_technicians")
    .map((key) => {
      if (scheduleState.scheduleTechTypeNameById[key]) return scheduleState.scheduleTechTypeNameById[key];
      // Built-in slug: snake_case / spaced / all-lowercase word(s) -> Title Case.
      if (/[_\s]/.test(key) || /^[a-z]+$/.test(key)) {
        return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      }
      // Unresolved raw document id (mixed case / digits) -> hide it.
      return null;
    })
    .filter(Boolean);
  return labels.length ? labels.join(", ") : null;
}

function renderScheduleViewTabs() {
  const modeWrap = document.getElementById("scheduleModeToggleWrap");
  const canEdit = scheduleUserCanManualEdit();
  if (modeWrap) {
    modeWrap.style.display = canEdit ? "inline-flex" : "none";
    modeWrap.classList.toggle("ff-schedule-tabs-visible", canEdit);
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
  applyModeState(myShiftsBtn, scheduleState.schedulePreviewMode === "my_shifts", true);
  applyModeState(buildScheduleBtn, scheduleState.schedulePreviewMode === "build", false);

  const toggleWrap = document.getElementById("scheduleViewToggleWrap");
  if (toggleWrap) {
    const ctx = getScheduleAccessContext();
    const showTeamTabs = canEdit && scheduleState.schedulePreviewMode === "build" && !ctx.viewOwnOnly;
    toggleWrap.style.display = showTeamTabs ? "inline-flex" : "none";
    toggleWrap.classList.toggle("ff-schedule-tabs-visible", showTeamTabs);
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
  applyState(managementBtn, scheduleState.schedulePreviewView === "management", true);
  applyState(techniciansBtn, scheduleState.schedulePreviewView === "technicians", false);
}

/**
 * A staff row is visible in the active branch's schedule when they are
 * assigned to that branch. Dual-location staff (allowed at 2+ locations)
 * appear on every assigned board, each with its own hours.
 */
function _ffSchedStaffInActiveLocation(staff) {
  const multi = _ffSchedUserHasMultipleLocations();
  const activeLoc = _ffSchedActiveLocId();
  if (!activeLoc) return !multi;
  if (!staff) return false;
  const role = String(staff.role || "").toLowerCase().trim();
  const isOwner = role === "owner" || staff.isOwner === true;
  let allowed = Array.isArray(staff.allowedLocationIds) ? staff.allowedLocationIds : [];
  let primary = typeof staff.primaryLocationId === "string" ? staff.primaryLocationId.trim() : "";
  try {
    if (typeof window !== "undefined" && typeof window.ffEnsureStaffLocationFields === "function") {
      const f = window.ffEnsureStaffLocationFields(staff);
      if (Array.isArray(f.allowedLocationIds)) allowed = f.allowedLocationIds;
      if (typeof f.primaryLocationId === "string") primary = f.primaryLocationId.trim();
    }
  } catch (_) {}
  const allowedIds = allowed.map((id) => String(id || "").trim()).filter(Boolean);
  if (allowedIds.length > 0) return allowedIds.indexOf(activeLoc) !== -1;
  if (isOwner) return true;
  if (primary) return primary === activeLoc;
  if (!multi) return true;
  const salonPrimary = _ffSchedPrimaryLocationId();
  return !!salonPrimary && activeLoc === salonPrimary;
}

/**
 * When a staff row has a per-location availability override
 * (`locationScheduleAvailability[activeLoc].defaultSchedule`), swap in that
 * map as the effective `defaultSchedule`. The generator + validator read
 * `defaultSchedule` directly, so this single substitution propagates the
 * per-branch hours everywhere (auto-build, availability, coverage checks).
 * Rows without an override keep their top-level `defaultSchedule` — works
 * identically to the previous behaviour for single-branch salons.
 */
function _ffSchedApplyPerLocationSchedule(staff) {
  const activeLoc = _ffSchedActiveLocId();
  if (!activeLoc || !staff || typeof staff !== "object") return staff;
  const helper = window.ffScheduleHelpers && window.ffScheduleHelpers.getStaffDefaultScheduleForLocation;
  if (typeof helper !== "function") return staff;
  try {
    const perLoc = helper(staff, activeLoc);
    if (!perLoc) return staff;
    // Diagnostic: log which branch schedule we're applying. Helps verify
    // that per-location overrides are picked up by Build Schedule.
    try {
      const allowed = Array.isArray(staff.allowedLocationIds) ? staff.allowedLocationIds.length : 0;
      if (allowed > 1) {
        const active = Object.keys(perLoc).filter((d) => perLoc[d] && perLoc[d].enabled);
        console.log(`[ScheduleUI] per-loc schedule for ${staff.name || staff.id} @ ${activeLoc}: ${active.length ? active.join(",") : "all days OFF"}`);
      }
    } catch (_) { /* ignore */ }
    return { ...staff, defaultSchedule: perLoc };
  } catch (_) {
    return staff;
  }
}

async function loadScheduleStaffList() {
  if (typeof window.ffStaffForceLoad === "function") {
    try { await window.ffStaffForceLoad(); } catch (_) {}
  }
  const store = typeof window.ffGetStaffStore === "function" ? window.ffGetStaffStore() : { staff: [] };
  return (Array.isArray(store?.staff) ? store.staff : [])
    .filter((staff) => staff && staff.isArchived !== true)
    .filter(_ffSchedStaffInActiveLocation)
    .map(_ffSchedApplyPerLocationSchedule);
}

/** Scan ALL staff (including those not filtered to the active location)
 *  for same-day cross-location overlaps and render a warning banner above
 *  the schedule grid. Only relevant for multi-location staff.
 */
function renderScheduleCrossLocationConflictBanner() {
  const banner = document.getElementById("scheduleCrossLocConflictBanner");
  if (!banner) return;
  try {
    const store = typeof window.ffGetStaffStore === "function" ? window.ffGetStaffStore() : { staff: [] };
    const allStaff = Array.isArray(store?.staff) ? store.staff : [];
    const detect = window.ffScheduleHelpers && window.ffScheduleHelpers.detectStaffLocationScheduleConflicts;
    if (typeof detect !== "function") { banner.style.display = "none"; return; }
    const locations = (typeof window !== "undefined" && typeof window.ffGetActiveLocations === "function")
      ? (window.ffGetActiveLocations() || [])
      : [];
    const locNameById = new Map();
    locations.forEach((loc) => {
      if (loc && loc.id) locNameById.set(String(loc.id), String(loc.name || loc.id));
    });
    const labelLoc = (id) => locNameById.get(String(id)) || String(id);
    const dayLabels = {
      monday: "Mon", tuesday: "Tue", wednesday: "Wed",
      thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun",
    };
    const rows = [];
    allStaff.forEach((staff) => {
      if (!staff || staff.isArchived === true) return;
      const conflicts = detect(staff) || [];
      if (!conflicts.length) return;
      const name = String(staff.name || staff.fullName || "Staff");
      conflicts.forEach((c) => {
        const overlap = formatScheduleRawRangeDisplay(c.overlap);
        rows.push(`<li style="margin:3px 0;">
          <strong>${name}</strong> — ${dayLabels[c.dayKey] || c.dayKey} overlap
          between <em>${labelLoc(c.locationAId)}</em> and <em>${labelLoc(c.locationBId)}</em>
          (${overlap || c.overlap})
        </li>`);
      });
    });
    if (!rows.length) { banner.style.display = "none"; banner.innerHTML = ""; return; }
    banner.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <div style="flex:0 0 auto;font-size:18px;line-height:1;">⚠️</div>
        <div style="flex:1 1 auto;">
          <div style="font-weight:700;margin-bottom:4px;">Cross-location scheduling conflicts</div>
          <div style="color:#92400e;font-size:12px;margin-bottom:6px;">
            The following staff are scheduled at two locations on the same day with overlapping hours.
            Review each staff member's Schedule tab to resolve.
          </div>
          <ul style="margin:0;padding-left:18px;color:#78350f;font-size:12px;">${rows.join("")}</ul>
        </div>
      </div>`;
    banner.style.display = "block";
  } catch (err) {
    console.warn("[ScheduleUI] cross-loc banner failed", err);
    banner.style.display = "none";
  }
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
  const activeLocId = _ffSchedActiveLocId() || inboxGetActiveLocationId();
  if (_ffSchedUserHasMultipleLocations() && !activeLocId) return [];
  const mapDoc = (docSnap) => ({ id: docSnap.id, ...docSnap.data() });
  const keepScheduleType = (item) =>
    SCHEDULE_INBOX_TYPES_FOR_AVAILABILITY.has(String(item?.type || "").trim());
  // Same rule as Inbox: stamped locationId must match this branch. Legacy
  // unstamped rows stay on the primary location only — never every branch
  // the staff member is allowed to work.
  const keepLocation = (item) => inboxItemMatchesActiveLocation(item, activeLocId);
  const filterPipeline = (docs) =>
    docs.map(mapDoc).filter(keepScheduleType).filter(keepLocation).filter(isApprovedRequest);

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

export {
  STAND_BY_SLOTS,
  SCHEDULE_INBOX_TYPES_FOR_AVAILABILITY,
  _ffSchedApplyPerLocationSchedule,
  _ffSchedStaffInActiveLocation,
  applyBusinessSettingsToDraft,
  cloneStandByByDateMap,
  computeStaffWeeklyScheduledMinutes,
  ensureScheduleTechTypeMap,
  formatScheduleTechnicianTypes,
  getBusinessStatusForDate,
  getDefaultShiftTimesForDate,
  getScheduleRoleLabel,
  loadApprovedScheduleRequests,
  loadScheduleStaffList,
  mergeStandByByDatePreferLocal,
  normalizeStandByBlock,
  normalizeTwoStandBySlots,
  parseStandByDayEntry,
  rebuildScheduleTechTypeMap,
  renderScheduleCrossLocationConflictBanner,
  renderScheduleViewTabs,
  resolveStandByStaffMember,
  scheduleInboxUserIsFirestoreManager,
  standByDayEntryHasAny,
  standByMapsEqual,
};
