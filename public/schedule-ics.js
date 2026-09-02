// schedule-ics.js
// Schedule — ICS calendar export, mobile calendar sharing/download helpers,
// weekly shift collection, and weekly-hours debug logging. Extracted verbatim
// from schedule-ui.js (Phase 7 of the schedule-ui split).

import { scheduleState } from "./schedule-state.js?v=20260702_schedule_state";
import {
  _ffSchedActiveLocId,
  ffScheduleAppToast,
  getAuthedStaffIdForSchedule,
} from "./schedule-ack.js?v=20260902_sched_dual";
import {
  formatScheduleTimeRangeDisplay,
  getScheduleStaffKey,
} from "./schedule-format.js?v=20260806_sched_12h_picker";

function _ffIcsFormatLocalDateTime(dateKey, timeHHmm) {
  const d = String(dateKey || "").replace(/-/g, "");
  const t = String(timeHHmm || "").replace(/:/g, "");
  if (!/^\d{8}$/.test(d) || !/^\d{4}$/.test(t)) return null;
  return `${d}T${t}00`;
}

function _ffCalendarTimezone() {
  try {
    const prefs = (typeof window !== "undefined" && window.settings && window.settings.preferences) || {};
    const tz = typeof prefs.salonTimeZone === "string" ? prefs.salonTimeZone.trim() : "";
    return tz || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch (_) {
    return "America/New_York";
  }
}

/** iCalendar strings: CR-LF line endings and backslash-escape for TEXT values. */
function _ffIcsEscape(str) {
  return String(str || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** Current salon name (best-effort) — used in SUMMARY/DESCRIPTION. */
function _ffCurrentSalonNameForIcs() {
  try {
    const s = (typeof window !== "undefined" && window.settings) || {};
    const candidates = [s.salonName, s.businessName, s.name];
    for (const c of candidates) {
      const v = typeof c === "string" ? c.trim() : "";
      if (v) return v;
    }
  } catch (_) {}
  return "Salon";
}

/** Active-location display name (best-effort) — used in SUMMARY / LOCATION. */
function _ffActiveLocationNameForIcs() {
  try {
    const id = _ffSchedActiveLocId();
    if (!id) return "";
    const locs = (typeof window !== "undefined" && typeof window.ffGetActiveLocations === "function")
      ? (window.ffGetActiveLocations() || [])
      : [];
    const match = locs.find((l) => l && l.id === id);
    const name = match && (match.name || "");
    return typeof name === "string" ? name.trim() : "";
  } catch (_) {}
  return "";
}

/**
 * Build an iCalendar (.ics) string with a VEVENT per shift for the currently
 * authed staff in the currently-previewed week. "Floating" local time is
 * used so the event displays at the scheduled clock time regardless of the
 * device's timezone — matching how the schedule is shown on-screen.
 */
function buildMyShiftsIcsForCurrentWeek() {
  const draft = scheduleState.schedulePreviewState?.draft;
  const days = Array.isArray(draft?.days) ? draft.days : [];
  const mySid = String(getAuthedStaffIdForSchedule() || "").trim();
  if (!mySid) return { ics: "", eventCount: 0 };

  const salonName = _ffCurrentSalonNameForIcs();
  const activeLocationName = _ffActiveLocationNameForIcs();
  const otherMap = (scheduleState.schedulePreviewState?.myShiftsFromOtherLocs instanceof Map)
    ? scheduleState.schedulePreviewState.myShiftsFromOtherLocs
    : new Map();
  const nowStamp = (() => {
    const d = new Date();
    const yy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mi = String(d.getUTCMinutes()).padStart(2, "0");
    const ss = String(d.getUTCSeconds()).padStart(2, "0");
    return `${yy}${mm}${dd}T${hh}${mi}${ss}Z`;
  })();

  const events = [];
  const calendarLinks = [];
  const calendarTimezone = _ffCalendarTimezone();
  const pushEvent = ({ dateKey, startTime, endTime, locationName, uidSuffix }) => {
    const dtStart = _ffIcsFormatLocalDateTime(dateKey, startTime);
    const dtEnd = _ffIcsFormatLocalDateTime(dateKey, endTime);
    if (!dtStart || !dtEnd || dtEnd <= dtStart) return;
    const summary = locationName
      ? `Work shift — ${salonName} (${locationName})`
      : `Work shift — ${salonName}`;
    const desc = `Your scheduled shift at ${salonName}${locationName ? ` — ${locationName}` : ""}.`;
    const uid = `shift-${dateKey}-${mySid}-${String(startTime || "").replace(/:/g, "")}-${uidSuffix}@fairflow`;
    const lines = [
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${nowStamp}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${_ffIcsEscape(summary)}`,
      `DESCRIPTION:${_ffIcsEscape(desc)}`,
    ];
    if (locationName) lines.push(`LOCATION:${_ffIcsEscape(locationName)}`);
    lines.push("END:VEVENT");
    events.push(lines.join("\r\n"));
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: summary,
      dates: `${dtStart}/${dtEnd}`,
      details: desc,
      ctz: calendarTimezone,
    });
    if (locationName) params.set("location", locationName);
    calendarLinks.push({
      url: `https://calendar.google.com/calendar/render?${params.toString()}`,
      label: `${dateKey} ${formatScheduleTimeRangeDisplay(startTime, endTime, { separator: "-" })}`,
    });
  };

  // Active location (the currently-rendered draft).
  days.forEach((day) => {
    if (!day || !day.date) return;
    const bs = day.businessStatus || { isOpen: true };
    if (bs.isOpen === false) return;
    const assignments = Array.isArray(day.assignments) ? day.assignments : [];
    assignments.forEach((a, idx) => {
      if (!a) return;
      const sameStaff =
        (a.staffId && String(a.staffId) === mySid) ||
        (a.uid && String(a.uid) === mySid);
      if (!sameStaff) return;
      pushEvent({
        dateKey: day.date,
        startTime: a.startTime,
        endTime: a.endTime,
        locationName: activeLocationName,
        uidSuffix: `active-${idx}`,
      });
    });
  });

  // Other locations (unified view — included even if the user hasn't
  // switched the active location to that branch).
  otherMap.forEach((shifts, dateKey) => {
    if (!Array.isArray(shifts)) return;
    shifts.forEach((s, idx) => {
      pushEvent({
        dateKey,
        startTime: s.startTime,
        endTime: s.endTime,
        locationName: s.locationName || "",
        uidSuffix: `${s.locationId || "loc"}-${idx}`,
      });
    });
  });

  if (events.length === 0) return { ics: "", eventCount: 0 };

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FairFlow//Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  return { ics, eventCount: events.length, calendarLinks };
}

function isLikelyMobileCalendarDevice() {
  try {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "")
      || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent || ""));
  } catch (_) {
    return false;
  }
}

function isLikelyAndroidCalendarDevice() {
  try {
    return /Android/i.test(navigator.userAgent || "");
  } catch (_) {
    return false;
  }
}

function ffOpenCalendarUrl(url) {
  if (!url) return;
  try {
    const opened = window.open(url, "_blank", "noopener");
    if (!opened) window.location.href = url;
  } catch (_) {
    window.location.href = url;
  }
}

function ffDownloadCalendarFile(downloadFile) {
  if (!downloadFile || !downloadFile.blobUrl || !downloadFile.filename) return;
  const a = document.createElement("a");
  a.href = downloadFile.blobUrl;
  a.download = downloadFile.filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { try { document.body.removeChild(a); } catch (_) {} }, 200);
}

async function ffShareOrDownloadAllShifts(downloadFile) {
  if (!downloadFile) return;
  try {
    const file = downloadFile.file;
    const canShareFile =
      file
      && typeof navigator !== "undefined"
      && typeof navigator.share === "function"
      && typeof navigator.canShare === "function"
      && navigator.canShare({ files: [file] });
    if (canShareFile) {
      await navigator.share({
        title: "Fair Flow schedule",
        text: "Fair Flow shifts",
        files: [file],
      });
      ffScheduleAppToast("Choose Calendar to import all shifts.", 3500);
      return;
    }
  } catch (e) {
    if (e && (e.name === "AbortError" || e.name === "NotAllowedError")) return;
    console.warn("[ScheduleUI] All-shifts calendar share failed; using download fallback", e);
  }
  ffDownloadCalendarFile(downloadFile);
  ffScheduleAppToast("Calendar file downloaded. Open it to import all shifts.", 4500);
}

function ffShowMobileCalendarChoice(calendarLinks, downloadFile) {
  const links = Array.isArray(calendarLinks) ? calendarLinks.filter((x) => x && x.url) : [];
  if (!links.length) return false;
  const existing = document.getElementById("ffMobileCalendarChoiceModal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "ffMobileCalendarChoiceModal";
  overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.42);display:flex;align-items:flex-end;justify-content:center;padding:14px 14px 92px;";

  const panel = document.createElement("div");
  panel.style.cssText = "width:100%;max-width:420px;background:#fff;border-radius:18px;box-shadow:0 24px 60px rgba(15,23,42,.24);padding:14px;max-height:68vh;overflow:auto;";

  const title = document.createElement("div");
  title.textContent = "Add shifts to calendar";
  title.style.cssText = "font-size:16px;font-weight:800;color:#111827;margin-bottom:5px;";
  panel.appendChild(title);

  const note = document.createElement("div");
  note.textContent = "Add all shifts together, or open each shift separately in Google Calendar and tap Save.";
  note.style.cssText = "font-size:12px;color:#6b7280;line-height:1.35;margin-bottom:10px;";
  panel.appendChild(note);

  if (downloadFile && downloadFile.blobUrl && downloadFile.filename) {
    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.textContent = `Add all ${links.length} shifts together`;
    allBtn.style.cssText = "width:100%;display:flex;justify-content:center;align-items:center;margin:8px 0 12px;padding:12px 14px;border:0;border-radius:14px;background:#111827;color:#fff;font-size:14px;font-weight:850;";
    allBtn.addEventListener("click", async () => {
      await ffShareOrDownloadAllShifts(downloadFile);
    });
    panel.appendChild(allBtn);

    const separator = document.createElement("div");
    separator.textContent = "Or add one shift at a time";
    separator.style.cssText = "font-size:11px;font-weight:800;color:#6b7280;text-align:center;margin:2px 0 8px;text-transform:uppercase;letter-spacing:.04em;";
    panel.appendChild(separator);
  }

  links.forEach((link, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `Open shift ${idx + 1}: ${link.label || "shift"}`;
    btn.style.cssText = "width:100%;display:flex;justify-content:center;align-items:center;margin:7px 0;padding:10px 12px;border:1px solid #c4b5fd;border-radius:12px;background:#ede9fe;color:#5b21b6;font-size:12px;font-weight:800;";
    btn.addEventListener("click", () => ffOpenCalendarUrl(link.url));
    panel.appendChild(btn);
  });

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "Close";
  closeBtn.style.cssText = "width:100%;margin-top:10px;padding:9px 14px;border:0;border-radius:12px;background:#f3f4f6;color:#374151;font-size:12px;font-weight:700;";
  closeBtn.addEventListener("click", () => overlay.remove());
  panel.appendChild(closeBtn);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  return true;
}

/**
 * Shares or downloads the current week's shifts as a .ics file. Mobile devices
 * prefer the native share sheet so the user can choose Calendar explicitly.
 */
async function downloadMyShiftsIcsForCurrentWeek() {
  const { ics, eventCount, calendarLinks } = buildMyShiftsIcsForCurrentWeek();
  if (!ics || eventCount === 0) {
    ffScheduleAppToast("No shifts found for you this week.", 4000);
    return;
  }
  const weekStart = scheduleState.schedulePreviewState?.weekRange?.startDate || "week";
  const filename = `my-shifts-${weekStart}.ics`;
  try {
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const mobileDownloadUrl = URL.createObjectURL(blob);
    const file = new File([blob], filename, { type: "text/calendar" });
    const downloadFile = { blobUrl: mobileDownloadUrl, filename, file };
    if (isLikelyAndroidCalendarDevice() && ffShowMobileCalendarChoice(calendarLinks, downloadFile)) {
      return;
    }
    const canShareCalendarFile =
      typeof navigator !== "undefined"
      && typeof navigator.share === "function"
      && typeof navigator.canShare === "function"
      && navigator.canShare({ files: [file] });
    if (isLikelyMobileCalendarDevice() && canShareCalendarFile) {
      await navigator.share({
        title: "Fair Flow schedule",
        text: `Fair Flow schedule - ${weekStart}`,
        files: [file],
      });
      ffScheduleAppToast("Choose Calendar to import your shifts.", 3500);
      return;
    }
    if (isLikelyMobileCalendarDevice() && ffShowMobileCalendarChoice(calendarLinks, downloadFile)) return;
    const url = mobileDownloadUrl;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch (_) {}
      try { URL.revokeObjectURL(url); } catch (_) {}
    }, 200);
    ffScheduleAppToast(`Calendar file downloaded with ${eventCount} shift${eventCount === 1 ? "" : "s"}. Open it to import.`, 4500);
  } catch (e) {
    if (e && (e.name === "AbortError" || e.name === "NotAllowedError")) {
      ffScheduleAppToast("Calendar import was cancelled.", 3500);
      return;
    }
    console.warn("[ScheduleUI] ICS share/download failed", e);
    ffScheduleAppToast("Could not generate the calendar file.", 4000);
  }
}

if (typeof window !== "undefined") {
  window.ffDownloadMyShiftsIcs = downloadMyShiftsIcsForCurrentWeek;
}

// --- Stage 5 background wiring: weekly hours debug log for the authed user ---
// Purely informational. Reads the same shifts that feed the Add-to-calendar
// flow (active draft + myShiftsFromOtherLocs), converts them to the shape the
// Time Clock engine expects, and console.logs the {total, regular, overtime}
// breakdown. NO UI and NO Firestore writes. De-duplicated by week + shift
// fingerprint so the console is not spammed on every render.

function _ffAdaptAssignmentToShift(dateKey, startTime, endTime) {
  if (!dateKey || typeof dateKey !== "string") return null;
  if (!startTime || !endTime) return null;
  const st = String(startTime).trim();
  const et = String(endTime).trim();
  // Build local datetime strings (no timezone suffix → parsed as local).
  const start = `${dateKey}T${st.length === 4 ? "0" + st : st}:00`;
  const end = `${dateKey}T${et.length === 4 ? "0" + et : et}:00`;
  return { start, end, _raw: { dateKey, startTime: st, endTime: et } };
}

function _ffCollectAuthedUserWeeklyShifts() {
  const mySid = String(getAuthedStaffIdForSchedule() || "").trim();
  if (!mySid) return { shifts: [], skipped: [], staffId: null };

  const draft = scheduleState.schedulePreviewState?.draft || {};
  const days = Array.isArray(draft.days) ? draft.days : [];
  const otherMap = (scheduleState.schedulePreviewState?.myShiftsFromOtherLocs instanceof Map)
    ? scheduleState.schedulePreviewState.myShiftsFromOtherLocs
    : new Map();

  const shifts = [];
  const skipped = [];

  // Active-location draft.
  days.forEach((day) => {
    if (!day || !day.date) return;
    const bs = day.businessStatus || { isOpen: true };
    if (bs.isOpen === false) return;
    const assignments = Array.isArray(day.assignments) ? day.assignments : [];
    assignments.forEach((a) => {
      if (!a) return;
      const sameStaff =
        (a.staffId && String(a.staffId) === mySid) ||
        (a.uid && String(a.uid) === mySid);
      if (!sameStaff) return;
      const shift = _ffAdaptAssignmentToShift(day.date, a.startTime, a.endTime);
      if (shift) shifts.push(shift);
      else skipped.push({
        source: "active",
        dateKey: day.date,
        startTime: a.startTime ?? null,
        endTime: a.endTime ?? null,
        reason: "missing or invalid start/end",
      });
    });
  });

  // Other locations (unified My-shifts cross-loc view).
  otherMap.forEach((arr, dateKey) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((s) => {
      if (!s) return;
      const shift = _ffAdaptAssignmentToShift(dateKey, s.startTime, s.endTime);
      if (shift) shifts.push(shift);
      else skipped.push({
        source: "other",
        locationName: s.locationName || null,
        dateKey,
        startTime: s.startTime ?? null,
        endTime: s.endTime ?? null,
        reason: "missing or invalid start/end",
      });
    });
  });

  return { shifts, skipped, staffId: mySid };
}

function _ffResolveAuthedStaffNameForDebug(mySid) {
  try {
    const list = Array.isArray(scheduleState.schedulePreviewState?.staffList) ? scheduleState.schedulePreviewState.staffList : [];
    const st = list.find((x) => getScheduleStaffKey(x) === mySid) || null;
    if (!st) return null;
    return (
      st.name ||
      st.displayName ||
      [st.firstName, st.lastName].filter(Boolean).join(" ").trim() ||
      null
    );
  } catch (_e) {
    return null;
  }
}

function _ffDebugLogAuthedUserWeeklyHours() {
  try {
    if (typeof window === "undefined") return;
    if (typeof window.ffComputeWeeklyShiftHoursSummary !== "function") return;
    const { shifts, skipped, staffId } = _ffCollectAuthedUserWeeklyShifts();
    if (!staffId) return;

    const weekRange = scheduleState.schedulePreviewState?.weekRange || {};
    const weekKey = weekRange.startDate || "week?";
    const shiftKey = shifts
      .map((s) => `${s._raw?.dateKey}|${s._raw?.startTime}|${s._raw?.endTime}`)
      .sort()
      .join(",");
    const key = `${weekKey}|${staffId}|${shifts.length}:${shiftKey}|${skipped.length}`;
    if (key === scheduleState._ffLastHoursDebugKey) return;
    scheduleState._ffLastHoursDebugKey = key;

    const loadSettings = typeof window.ffLoadTimeClockSettings === "function"
      ? window.ffLoadTimeClockSettings()
      : Promise.resolve(null);

    Promise.resolve(loadSettings)
      .then((settings) => {
        const summary = window.ffComputeWeeklyShiftHoursSummary(shifts, settings);
        const staffName = _ffResolveAuthedStaffNameForDebug(staffId);
        console.groupCollapsed(
          `%c[TimeClockEngine] Weekly hours · ${staffName || staffId} · ${weekKey}`,
          "color:#5b21b6;font-weight:600;"
        );
        console.log("staffId:          ", staffId);
        if (staffName) console.log("name:             ", staffName);
        console.log("weekStart:        ", weekKey);
        console.log("totalWorkedHours: ", summary.totalWorkedHours);
        console.log("regularHours:     ", summary.regularHours);
        console.log("overtimeHours:    ", summary.overtimeHours);
        console.log("shifts counted:   ", shifts.length);
        console.log("shifts skipped:   ", skipped.length);
        if (skipped.length) console.log("skipped details: ", skipped);
        console.log("settings used:    ", settings);
        console.groupEnd();
      })
      .catch((e) => {
        console.warn("[TimeClockEngine] debug log failed", e);
      });
  } catch (e) {
    console.warn("[TimeClockEngine] debug log failed", e);
  }
}

export {
  _ffActiveLocationNameForIcs,
  _ffAdaptAssignmentToShift,
  _ffCalendarTimezone,
  _ffCollectAuthedUserWeeklyShifts,
  _ffCurrentSalonNameForIcs,
  _ffDebugLogAuthedUserWeeklyHours,
  _ffIcsEscape,
  _ffIcsFormatLocalDateTime,
  _ffResolveAuthedStaffNameForDebug,
  buildMyShiftsIcsForCurrentWeek,
  downloadMyShiftsIcsForCurrentWeek,
  ffDownloadCalendarFile,
  ffOpenCalendarUrl,
  ffShareOrDownloadAllShifts,
  ffShowMobileCalendarChoice,
  isLikelyAndroidCalendarDevice,
  isLikelyMobileCalendarDevice,
};
