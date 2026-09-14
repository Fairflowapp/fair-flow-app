/**
 * Smart Scheduling Phase 1 — free-gap detection.
 *
 * Gaps exist only inside supplied working intervals.
 * Off-hours and lunch / split-shift holes are not gaps.
 * Overlapping occupied lines are merged before measuring free time.
 */
(function () {
  function ns() {
    return window.ffBookingSmartScheduling || (window.ffBookingSmartScheduling = {});
  }

  function helpers() {
    return ns().helpers || {};
  }

  function gapKind(startMin, endMin, winStart, winEnd, hasBusyBefore, hasBusyAfter) {
    var atStart = startMin === winStart;
    var atEnd = endMin === winEnd;
    if (atStart && !hasBusyBefore && hasBusyAfter) return "leading";
    if (atEnd && !hasBusyAfter && hasBusyBefore) return "trailing";
    if (atStart && atEnd && !hasBusyBefore && !hasBusyAfter) return "leading";
    if (hasBusyBefore && hasBusyAfter) return "between";
    if (atStart) return "leading";
    if (atEnd) return "trailing";
    return "between";
  }

  function firstLineId(busy) {
    if (!busy || !Array.isArray(busy.lineIds) || !busy.lineIds.length) return "";
    return busy.lineIds[0];
  }

  function findFreeGaps(day) {
    var h = helpers();
    var clipBusy = h.clipBusyToWindow;
    var intervals = day && Array.isArray(day.workingIntervals) ? day.workingIntervals : [];
    var occupied = day && Array.isArray(day.occupied) ? day.occupied : [];
    var gaps = [];
    intervals.forEach(function (win, workingIntervalIndex) {
      if (!win || !(win.endMin > win.startMin)) return;
      var busy = clipBusy ? clipBusy(occupied, win.startMin, win.endMin) : [];
      var cursor = win.startMin;
      var beforeLineId = "";
      var i;
      for (i = 0; i < busy.length; i += 1) {
        var block = busy[i];
        if (block.startMin > cursor) {
          gaps.push({
            startMin: cursor,
            endMin: block.startMin,
            gapMin: block.startMin - cursor,
            kind: gapKind(cursor, block.startMin, win.startMin, win.endMin, !!beforeLineId, true),
            workingIntervalIndex: workingIntervalIndex,
            beforeLineId: beforeLineId || undefined,
            afterLineId: firstLineId(block) || undefined
          });
        }
        cursor = Math.max(cursor, block.endMin);
        beforeLineId = firstLineId(block) || beforeLineId;
      }
      if (cursor < win.endMin) {
        gaps.push({
          startMin: cursor,
          endMin: win.endMin,
          gapMin: win.endMin - cursor,
          kind: gapKind(cursor, win.endMin, win.startMin, win.endMin, !!beforeLineId, false),
          workingIntervalIndex: workingIntervalIndex,
          beforeLineId: beforeLineId || undefined,
          afterLineId: undefined
        });
      }
    });
    return gaps;
  }

  ns().findFreeGaps = findFreeGaps;
})();
