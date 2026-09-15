/**
 * One-off Calendar Block Time. Not an appointment and not recurring schedule.
 */
(function () {
  var REASONS = ["lunch", "break", "meeting", "training", "personal", "other"];
  var LABELS = {
    lunch: "Lunch",
    break: "Break",
    meeting: "Meeting",
    training: "Training",
    personal: "Personal",
    other: "Other"
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

  function normalizeReason(value) {
    var key = trim(value).toLowerCase().replace(/\s+/g, "_");
    if (key === "time_off" || key === "block" || key === "blocked" || key === "unavailable") key = "other";
    return REASONS.indexOf(key) !== -1 ? key : "other";
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
    var note = collapse(raw.note);
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
      note: collapse(raw.note),
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
    durationMinutes: durationMinutes
  };
})();
