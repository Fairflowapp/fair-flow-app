/**
 * Smart Scheduling Phase 1 — valid slot enumeration.
 *
 * A candidate must fit inside one working interval and must not exceed
 * Booking's overlap allowance against occupied lines.
 *
 * Overlap can make a slot valid. It never turns occupied time into a gap.
 */
(function () {
  var DEFAULT_SNAP = 15;

  function ns() {
    return window.ffBookingSmartScheduling || (window.ffBookingSmartScheduling = {});
  }

  function helpers() {
    return ns().helpers || {};
  }

  function positiveInt(value, fallback) {
    var n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.round(n);
  }

  function firstSnappedStart(winStart, snap) {
    var start = Number(winStart);
    var stepped = Math.ceil(start / snap) * snap;
    if (stepped < start) stepped += snap;
    return stepped;
  }

  function overlapAgainstOccupied(startMin, endMin, occupied) {
    var h = helpers();
    var overlapMinutes = h.overlapMinutes;
    var hits = [];
    var maxOverlap = 0;
    (occupied || []).forEach(function (row) {
      var mins = overlapMinutes(startMin, endMin, row.startMin, row.endMin);
      if (!(mins > 0)) return;
      hits.push({ lineId: row.lineId || "", overlapMinutes: mins });
      if (mins > maxOverlap) maxOverlap = mins;
    });
    return { hits: hits, maxOverlap: maxOverlap };
  }

  function conflictsOccupied(startMin, endMin, occupied, allowed) {
    var h = helpers();
    return (occupied || []).some(function (row) {
      return h.isConflictMinutes(startMin, endMin, row.startMin, row.endMin, allowed);
    });
  }

  function primaryFreeGap(gaps, startMin, endMin, workingIntervalIndex) {
    var best = null;
    var bestOverlap = 0;
    (gaps || []).forEach(function (gap) {
      if (gap.workingIntervalIndex !== workingIntervalIndex) return;
      var overlap = Math.min(endMin, gap.endMin) - Math.max(startMin, gap.startMin);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = gap;
      }
    });
    return best;
  }

  function enumerateValidSlots(day, request) {
    var req = request && typeof request === "object" ? request : {};
    var durationMinutes = positiveInt(req.durationMinutes, 0);
    if (durationMinutes <= 0) return [];
    var snapMinutes = positiveInt(req.snapMinutes, DEFAULT_SNAP);
    var intervals = day && Array.isArray(day.workingIntervals) ? day.workingIntervals : [];
    var occupied = day && Array.isArray(day.occupied) ? day.occupied : [];
    var allowed = day && day.allowedOverlapMinutes != null ? day.allowedOverlapMinutes : 0;
    var findGaps = ns().findFreeGaps;
    var gaps = typeof findGaps === "function" ? findGaps(day) : [];
    var slots = [];
    intervals.forEach(function (win, workingIntervalIndex) {
      if (!win || !(win.endMin > win.startMin)) return;
      if (durationMinutes > win.endMin - win.startMin) return;
      var startMin = firstSnappedStart(win.startMin, snapMinutes);
      while (startMin + durationMinutes <= win.endMin) {
        var endMin = startMin + durationMinutes;
        if (!conflictsOccupied(startMin, endMin, occupied, allowed)) {
          var overlap = overlapAgainstOccupied(startMin, endMin, occupied);
          var gap = primaryFreeGap(gaps, startMin, endMin, workingIntervalIndex);
          slots.push({
            startMin: startMin,
            endMin: endMin,
            durationMinutes: durationMinutes,
            workingIntervalIndex: workingIntervalIndex,
            usesOverlap: overlap.maxOverlap > 0,
            overlapMinutes: overlap.maxOverlap,
            overlapLineIds: overlap.hits.map(function (hit) { return hit.lineId; }).filter(Boolean),
            freeGapStartMin: gap ? gap.startMin : null,
            freeGapEndMin: gap ? gap.endMin : null
          });
        }
        startMin += snapMinutes;
      }
    });
    return slots;
  }

  var api = ns();
  api.enumerateValidSlots = enumerateValidSlots;
  api.DEFAULT_SNAP_MINUTES = DEFAULT_SNAP;
})();
