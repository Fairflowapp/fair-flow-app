/**
 * One-off Calendar Time Block. Not an appointment and not recurring schedule.
 * Persisted path remains salons/{salonId}/calendarBlocks.
 */
(function () {
  var REASONS = ["lunch", "break", "meeting", "training", "personal", "other"];
  var LABELS = {
    lunch: "Lunch Break",
    break: "Break",
    meeting: "Meeting",
    training: "Training",
    personal: "Personal",
    other: "Other"
  };
  var REASON_LABELS = {
    lunch: true,
    "lunch break": true,
    break: true,
    meeting: true,
    training: true,
    personal: true,
    other: true,
    "block time": true,
    "time block": true,
    blocked: true,
    unavailable: true,
    "time off": true
  };
  var DURATIONS = [15, 30, 45, 60, 90, 120];

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function collapse(value) {
    return trim(value).replace(/\s+/g, " ");
  }

  function labelForReason(reason) {
    return LABELS[reason] || LABELS.other;
  }

  function isReasonLabel(value) {
    var key = collapse(value).toLowerCase();
    return !!(key && REASON_LABELS[key]);
  }

  function normalizeReason(value) {
    var key = trim(value).toLowerCase().replace(/\s+/g, "_");
    if (key === "lunch_break" || key === "lunchbreak") key = "lunch";
    if (key === "time_off" || key === "block" || key === "blocked" || key === "unavailable") key = "other";
    return REASONS.indexOf(key) !== -1 ? key : "other";
  }

  function displayNote(raw) {
    if (!raw || typeof raw !== "object") return collapse(raw);
    var note = collapse(raw.note);
    if (note) return note;
    var legacy = collapse(raw.label);
    if (legacy && !isReasonLabel(legacy)) return legacy;
    return "";
  }

  function formatMinutes(total) {
    var m = ((Number(total) % 1440) + 1440) % 1440;
    if (!Number.isFinite(Number(total))) return "";
    var hour = Math.floor(m / 60);
    var min = m % 60;
    var suffix = hour >= 12 ? "PM" : "AM";
    var hour12 = hour % 12;
    if (hour12 === 0) hour12 = 12;
    return hour12 + ":" + String(min).padStart(2, "0") + " " + suffix;
  }

  function formatTimeRange(startMin, endMin) {
    var start = formatMinutes(startMin);
    var end = formatMinutes(endMin);
    if (!start || !end) return "";
    return start + " – " + end;
  }

  function cardLines(raw) {
    var row = raw && raw.reason != null ? raw : normalize(raw);
    if (!row) return { reason: "", time: "", note: "" };
    return {
      reason: labelForReason(row.reason),
      time: formatTimeRange(row.startMin, row.endMin),
      note: displayNote(row)
    };
  }

  function normalize(raw) {
    if (!raw || typeof raw !== "object") return null;
    var providerId = trim(raw.providerId || raw.staffId);
    var locationId = trim(raw.locationId);
    var dateKey = trim(raw.dateKey);
    var startMin = Number(raw.startMin);
    var endMin = Number(raw.endMin);
    if (!Number.isFinite(endMin) && Number.isFinite(Number(raw.durationMinutes))) {
      endMin = startMin + Number(raw.durationMinutes);
    }
    if (!providerId || !locationId || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || !(endMin > startMin)) return null;
    var reason = normalizeReason(raw.reason || raw.kind || raw.type);
    var note = displayNote(raw);
    var label = note || labelForReason(reason);
    return {
      blockId: trim(raw.blockId || raw.id),
      providerId: providerId,
      locationId: locationId,
      dateKey: dateKey,
      startMin: startMin,
      endMin: endMin,
      reason: reason,
      label: label,
      note: note,
      createdByUid: trim(raw.createdByUid),
      createdByStaffId: trim(raw.createdByStaffId),
      createdAt: raw.createdAt || null,
      updatedAt: raw.updatedAt || null
    };
  }

  function fromDoc(id, data) {
    return normalize(Object.assign({ blockId: id, id: id }, data || {}));
  }

  function durationMinutes(row) {
    if (!row) return 30;
    var n = Number(row.endMin) - Number(row.startMin);
    return n > 0 ? n : 30;
  }

  window.ffBookingBlockModel = {
    REASONS: REASONS,
    LABELS: LABELS,
    DURATIONS: DURATIONS,
    normalize: normalize,
    fromDoc: fromDoc,
    normalizeReason: normalizeReason,
    labelForReason: labelForReason,
    isReasonLabel: isReasonLabel,
    displayNote: displayNote,
    formatMinutes: formatMinutes,
    formatTimeRange: formatTimeRange,
    cardLines: cardLines,
    durationMinutes: durationMinutes
  };
})();
