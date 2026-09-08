/**
 * Booking salon settings. Owner-chosen overlap allowance.
 * Allowed values: 0 (none), 15, 20, 30 minutes.
 */
(function () {
  var CHOICES = [0, 15, 20, 30];
  var DEFAULT_MINUTES = 0;

  function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value.toDate === "function") {
      try {
        var fromTs = value.toDate();
        return fromTs instanceof Date && !Number.isNaN(fromTs.getTime()) ? fromTs : null;
      } catch (_) {
        return null;
      }
    }
    if (typeof value.seconds === "number") {
      var fromSec = new Date(value.seconds * 1000);
      return Number.isNaN(fromSec.getTime()) ? null : fromSec;
    }
    var parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function normalizeMinutes(value) {
    var n = Math.round(Number(value));
    return CHOICES.indexOf(n) !== -1 ? n : DEFAULT_MINUTES;
  }

  function readRawMinutes() {
    try {
      var booking = typeof window !== "undefined" && window.settings && window.settings.booking;
      if (booking && booking.allowedOverlapMinutes != null) return booking.allowedOverlapMinutes;
    } catch (_) {}
    return DEFAULT_MINUTES;
  }

  function allowedMinutes(raw) {
    return normalizeMinutes(raw != null ? raw : readRawMinutes());
  }

  function overlapMinutes(startA, endA, startB, endB) {
    var a0 = Number(startA);
    var a1 = Number(endA);
    var b0 = Number(startB);
    var b1 = Number(endB);
    if (!Number.isFinite(a0) || !Number.isFinite(a1) || !Number.isFinite(b0) || !Number.isFinite(b1)) return 0;
    var n = Math.min(a1, b1) - Math.max(a0, b0);
    return n > 0 ? n : 0;
  }

  function overlapMs(startA, endA, startB, endB) {
    var a0 = toDate(startA);
    var a1 = toDate(endA);
    var b0 = toDate(startB);
    var b1 = toDate(endB);
    if (!a0 || !a1 || !b0 || !b1) return 0;
    var n = Math.min(a1.getTime(), b1.getTime()) - Math.max(a0.getTime(), b0.getTime());
    return n > 0 ? n : 0;
  }

  function exceedsAllowance(overlapMin, allowed) {
    return Number(overlapMin) > allowedMinutes(allowed);
  }

  function isConflictMinutes(startA, endA, startB, endB, allowed) {
    return exceedsAllowance(overlapMinutes(startA, endA, startB, endB), allowed);
  }

  function isConflictDates(startA, endA, startB, endB, allowed) {
    return overlapMs(startA, endA, startB, endB) > allowedMinutes(allowed) * 60000;
  }

  function choiceLabel(minutes) {
    var n = normalizeMinutes(minutes);
    if (n === 0) return "No overlap";
    if (n === 30) return "30 minutes";
    return n + " minutes";
  }

  window.ffBookingSettingsModel = {
    CHOICES: CHOICES.slice(),
    DEFAULT_MINUTES: DEFAULT_MINUTES,
    normalizeMinutes: normalizeMinutes,
    allowedMinutes: allowedMinutes,
    overlapMinutes: overlapMinutes,
    overlapMs: overlapMs,
    exceedsAllowance: exceedsAllowance,
    isConflictMinutes: isConflictMinutes,
    isConflictDates: isConflictDates,
    choiceLabel: choiceLabel
  };
})();
