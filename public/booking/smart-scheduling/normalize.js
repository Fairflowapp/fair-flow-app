/**
 * Smart Scheduling Phase 1 — provider-day normalization.
 *
 * Pure civil-minute math. Caller supplies already-resolved working intervals
 * and occupied service lines. No I/O, Date, or Calendar reads.
 *
 * Occupied appointments keep their real start/end for gap analysis.
 * allowedOverlapMinutes does not shrink busy time.
 */
(function () {
  var ALLOWED_OVERLAP = [0, 15, 20, 30];
  var OCCUPY_EXCEPT = { cancelled: true };

  function ns() {
    return window.ffBookingSmartScheduling || (window.ffBookingSmartScheduling = {});
  }

  function trimText(value) {
    return String(value == null ? "" : value).trim();
  }

  function toMin(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : NaN;
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

  function normalizeAllowedOverlap(value) {
    var n = Math.round(Number(value));
    return ALLOWED_OVERLAP.indexOf(n) !== -1 ? n : 0;
  }

  function isConflictMinutes(startA, endA, startB, endB, allowed) {
    return overlapMinutes(startA, endA, startB, endB) > normalizeAllowedOverlap(allowed);
  }

  function occupiesTime(status) {
    return !OCCUPY_EXCEPT[trimText(status)];
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function formatClock(totalMin) {
    var m = Number(totalMin);
    if (!Number.isFinite(m)) return "";
    var wrapped = ((Math.round(m) % 1440) + 1440) % 1440;
    var h = Math.floor(wrapped / 60);
    var min = wrapped % 60;
    var suffix = h >= 12 ? "PM" : "AM";
    var h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return h12 + ":" + pad2(min) + " " + suffix;
  }

  function formatDuration(minutes) {
    var n = Math.round(Number(minutes));
    if (!Number.isFinite(n) || n < 0) return "0 minutes";
    if (n === 1) return "1 minute";
    return n + " minutes";
  }

  function formatMinuteAdj(minutes) {
    var n = Math.round(Number(minutes));
    if (!Number.isFinite(n) || n < 0) n = 0;
    return n + "-minute";
  }

  function clipInterval(startMin, endMin, winStart, winEnd) {
    var start = Math.max(Number(startMin), Number(winStart));
    var end = Math.min(Number(endMin), Number(winEnd));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return { startMin: start, endMin: end };
  }

  function mergeBusyIntervals(list) {
    var sorted = (list || []).filter(function (row) {
      return row && Number.isFinite(row.startMin) && Number.isFinite(row.endMin) && row.endMin > row.startMin;
    }).slice().sort(function (a, b) {
      return a.startMin - b.startMin || a.endMin - b.endMin;
    });
    var out = [];
    sorted.forEach(function (item) {
      var last = out[out.length - 1];
      var ids = Array.isArray(item.lineIds) ? item.lineIds.slice() : (item.lineId ? [item.lineId] : []);
      if (!last || item.startMin > last.endMin) {
        out.push({
          startMin: item.startMin,
          endMin: item.endMin,
          lineIds: ids
        });
        return;
      }
      if (item.endMin > last.endMin) last.endMin = item.endMin;
      ids.forEach(function (id) {
        if (id && last.lineIds.indexOf(id) === -1) last.lineIds.push(id);
      });
    });
    return out;
  }

  function clipBusyToWindow(occupied, winStart, winEnd) {
    var clipped = [];
    (occupied || []).forEach(function (row) {
      var hit = clipInterval(row.startMin, row.endMin, winStart, winEnd);
      if (!hit) return;
      clipped.push({
        startMin: hit.startMin,
        endMin: hit.endMin,
        lineId: row.lineId || "",
        lineIds: row.lineId ? [row.lineId] : []
      });
    });
    return mergeBusyIntervals(clipped);
  }

  function normalizeWorkingIntervals(raw) {
    return (Array.isArray(raw) ? raw : []).map(function (row) {
      var startMin = toMin(row && (row.startMin != null ? row.startMin : row.start));
      var endMin = toMin(row && (row.endMin != null ? row.endMin : row.end));
      if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) return null;
      return { startMin: startMin, endMin: endMin };
    }).filter(Boolean).sort(function (a, b) {
      return a.startMin - b.startMin || a.endMin - b.endMin;
    });
  }

  function lineRange(row) {
    var startMin = toMin(row && row.startMin);
    var endMin = toMin(row && row.endMin);
    var duration = toMin(row && row.durationMinutes);
    if (!Number.isFinite(startMin) && Number.isFinite(endMin) && duration > 0) {
      startMin = endMin - duration;
    }
    if (!Number.isFinite(endMin) && Number.isFinite(startMin) && duration > 0) {
      endMin = startMin + duration;
    }
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) return null;
    return { startMin: startMin, endMin: endMin };
  }

  function normalizeOccupiedLine(row, providerId, dateKey) {
    if (!row || typeof row !== "object") return null;
    var lineProvider = trimText(row.providerId);
    if (!lineProvider || lineProvider !== providerId) return null;
    var lineDate = trimText(row.dateKey);
    if (dateKey && lineDate && lineDate !== dateKey) return null;
    if (!occupiesTime(row.status)) return null;
    var range = lineRange(row);
    if (!range) return null;
    return {
      lineId: trimText(row.lineId),
      appointmentId: trimText(row.appointmentId),
      providerId: lineProvider,
      startMin: range.startMin,
      endMin: range.endMin,
      durationMinutes: range.endMin - range.startMin,
      status: trimText(row.status),
      serviceId: trimText(row.serviceId),
      requested: row.requested === true
    };
  }

  function compareOccupied(a, b) {
    return a.startMin - b.startMin
      || a.endMin - b.endMin
      || String(a.lineId || "").localeCompare(String(b.lineId || ""))
      || String(a.appointmentId || "").localeCompare(String(b.appointmentId || ""));
  }

  function normalizeProviderDay(input) {
    var raw = input && typeof input === "object" ? input : {};
    var providerId = trimText(raw.providerId);
    var locationId = trimText(raw.locationId);
    var dateKey = trimText(raw.dateKey);
    var workingIntervals = normalizeWorkingIntervals(raw.workingIntervals);
    var allowedOverlapMinutes = normalizeAllowedOverlap(raw.allowedOverlapMinutes);
    var occupied = (Array.isArray(raw.lines) ? raw.lines : [])
      .map(function (row) { return normalizeOccupiedLine(row, providerId, dateKey); })
      .filter(Boolean)
      .sort(compareOccupied);
    return {
      dateKey: dateKey,
      locationId: locationId,
      providerId: providerId,
      allowedOverlapMinutes: allowedOverlapMinutes,
      workingIntervals: workingIntervals,
      occupied: occupied
    };
  }

  var api = ns();
  api.normalizeProviderDay = normalizeProviderDay;
  api.helpers = {
    ALLOWED_OVERLAP: ALLOWED_OVERLAP.slice(),
    trimText: trimText,
    toMin: toMin,
    overlapMinutes: overlapMinutes,
    normalizeAllowedOverlap: normalizeAllowedOverlap,
    isConflictMinutes: isConflictMinutes,
    occupiesTime: occupiesTime,
    formatClock: formatClock,
    formatDuration: formatDuration,
    formatMinuteAdj: formatMinuteAdj,
    clipInterval: clipInterval,
    mergeBusyIntervals: mergeBusyIntervals,
    clipBusyToWindow: clipBusyToWindow,
    normalizeWorkingIntervals: normalizeWorkingIntervals,
    compareOccupied: compareOccupied
  };
})();
