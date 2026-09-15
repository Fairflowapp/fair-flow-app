/**
 * Smart Scheduling Phase 1 — deterministic slot scoring.
 *
 * BASE = 50, then additive reason deltas, clamped to 0…100.
 *
 * Overlap usage penalty (Phase 1 engineering default):
 *   uses_permitted_overlap  −25
 * Occupied time is never treated as a free opening. A valid overlapping
 * slot is ranked, not hidden, and is not scored as an ideal pack.
 *
 * packs_both_sides applies only when the candidate fills a true free
 * opening that has a real occupied block immediately before AND after.
 * Shift boundaries alone do not qualify.
 *
 * Labels (easy to retune):
 *   80–100 best_fit
 *   60–79  good_fit
 *   40–59  available
 *   0–39   low_fit
 */
(function () {
  var BASE = 50;
  var OVERLAP_PENALTY = -25;
  var LABEL_BEST = 80;
  var LABEL_GOOD = 60;
  var LABEL_AVAILABLE = 40;

  function ns() {
    return window.ffBookingSmartScheduling || (window.ffBookingSmartScheduling = {});
  }

  function helpers() {
    return ns().helpers || {};
  }

  function labelFor(score) {
    if (score >= LABEL_BEST) return "best_fit";
    if (score >= LABEL_GOOD) return "good_fit";
    if (score >= LABEL_AVAILABLE) return "available";
    return "low_fit";
  }

  function clampScore(value) {
    var n = Math.round(Number(value));
    if (!Number.isFinite(n)) n = 0;
    if (n < 0) return 0;
    if (n > 100) return 100;
    return n;
  }

  function requestDuration(slot, request) {
    var fromReq = Number(request && request.durationMinutes);
    if (Number.isFinite(fromReq) && fromReq > 0) return Math.round(fromReq);
    var fromSlot = Number(slot && slot.durationMinutes);
    return Number.isFinite(fromSlot) && fromSlot > 0 ? Math.round(fromSlot) : 0;
  }

  function busyInInterval(day, intervalIndex) {
    var h = helpers();
    var win = day && day.workingIntervals && day.workingIntervals[intervalIndex];
    if (!win || !h.clipBusyToWindow) return [];
    return h.clipBusyToWindow(day.occupied || [], win.startMin, win.endMin);
  }

  function remainderKind(minutes, durationMinutes) {
    var n = Number(minutes);
    if (!(n > 0)) return "none";
    if (n >= durationMinutes) return "usable";
    return "stranded";
  }

  function scoreSlot(day, slot, request) {
    var h = helpers();
    var durationMinutes = requestDuration(slot, request);
    var startMin = Number(slot && slot.startMin);
    var endMin = Number(slot && slot.endMin);
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) {
      endMin = startMin + durationMinutes;
    }
    if (!Number.isFinite(endMin) && Number.isFinite(startMin) && durationMinutes > 0) {
      endMin = startMin + durationMinutes;
    }
    var usesOverlap = !!(slot && slot.usesOverlap);
    var overlapMinutes = Number(slot && slot.overlapMinutes) || 0;
    var intervalIndex = Number(slot && slot.workingIntervalIndex);
    if (!Number.isFinite(intervalIndex)) intervalIndex = 0;
    var win = day && day.workingIntervals && day.workingIntervals[intervalIndex] || null;
    var freeStart = slot && slot.freeGapStartMin != null ? Number(slot.freeGapStartMin) : NaN;
    var freeEnd = slot && slot.freeGapEndMin != null ? Number(slot.freeGapEndMin) : NaN;
    var hasFree = Number.isFinite(freeStart) && Number.isFinite(freeEnd) && freeEnd > freeStart;

    var remainderBefore = 0;
    var remainderAfter = 0;
    if (hasFree) {
      remainderBefore = startMin > freeStart ? startMin - freeStart : 0;
      remainderAfter = endMin < freeEnd ? freeEnd - endMin : 0;
    }

    var fillsFree = hasFree && !usesOverlap && startMin === freeStart && endMin === freeEnd;
    var busy = busyInInterval(day, intervalIndex);
    var prev = null;
    var next = null;
    busy.forEach(function (block) {
      if (block.endMin <= startMin) prev = block;
      if (!next && block.startMin >= endMin) next = block;
    });
    // Shift edges never count as the other "side". Both neighbors must be
    // real occupied blocks that touch the free opening.
    var packsBothSides = fillsFree
      && prev && prev.endMin === startMin
      && next && next.startMin === endMin;

    var reasons = [];

    function add(code, delta, text) {
      reasons.push({ code: code, delta: delta, text: text });
    }

    if (packsBothSides) {
      add("packs_both_sides", 30, "Closes the opening with no leftover time.");
    }

    if (!usesOverlap && win && startMin === win.startMin) {
      add("abuts_shift_start", 15, "Starts at the beginning of working hours.");
    } else if (!usesOverlap && prev && startMin === prev.endMin) {
      add("abuts_previous", 15, "Starts when the previous appointment ends.");
    }

    if (!usesOverlap && win && endMin === win.endMin) {
      add("abuts_shift_end", 15, "Ends at the end of working hours.");
    } else if (!usesOverlap && next && endMin === next.startMin) {
      add("abuts_next", 15, "Ends when the next appointment starts.");
    }

    function adj(minutes) {
      return h.formatMinuteAdj ? h.formatMinuteAdj(minutes) : (Math.round(Number(minutes)) + "-minute");
    }

    if (fillsFree) {
      add("exact_window_fit", 10, "Uses the full " + adj(freeEnd - freeStart) + " opening.");
    }

    var beforeKind = remainderKind(remainderBefore, durationMinutes);
    var afterKind = remainderKind(remainderAfter, durationMinutes);

    if (beforeKind === "usable") {
      add("usable_remainder_before", 8, "Leaves a " + adj(remainderBefore) + " opening before this appointment.");
    }
    if (afterKind === "usable") {
      add("usable_remainder_after", 8, "Leaves a " + adj(remainderAfter) + " opening after this appointment.");
    }
    if (beforeKind === "stranded") {
      add("stranded_remainder_before", -20, "Leaves a " + adj(remainderBefore) + " opening before this appointment.");
    }
    if (afterKind === "stranded") {
      add("stranded_remainder_after", -20, "Leaves a " + adj(remainderAfter) + " opening after this appointment.");
    }
    if (beforeKind === "stranded" && afterKind === "stranded") {
      add("fragments_window", -15, "Splits one opening into two leftovers that cannot fit this service.");
    }

    if (usesOverlap) {
      add(
        "uses_permitted_overlap",
        OVERLAP_PENALTY,
        "Uses " + (h.formatDuration ? h.formatDuration(overlapMinutes) : overlapMinutes + " minutes") +
          " of permitted overlap with an existing appointment."
      );
    }

    var raw = BASE;
    reasons.forEach(function (row) { raw += row.delta; });
    var score = clampScore(raw);

    return {
      startMin: startMin,
      endMin: endMin,
      durationMinutes: durationMinutes,
      workingIntervalIndex: intervalIndex,
      usesOverlap: usesOverlap,
      overlapMinutes: overlapMinutes,
      score: score,
      label: labelFor(score),
      reasons: reasons
    };
  }

  var api = ns();
  api.scoreSlot = scoreSlot;
  api.labelForScore = labelFor;
  api.clampScore = clampScore;
  api.SCORE = {
    BASE: BASE,
    OVERLAP_PENALTY: OVERLAP_PENALTY,
    PACKS_BOTH_SIDES: 30,
    ABUTS: 15,
    EXACT_WINDOW_FIT: 10,
    USABLE_REMAINDER: 8,
    STRANDED_REMAINDER: -20,
    FRAGMENTS_WINDOW: -15,
    LABEL_BEST: LABEL_BEST,
    LABEL_GOOD: LABEL_GOOD,
    LABEL_AVAILABLE: LABEL_AVAILABLE
  };
})();
