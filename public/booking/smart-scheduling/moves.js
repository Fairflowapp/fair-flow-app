/**
 * Smart Scheduling Phase 2 — move opportunities.
 *
 * Recommendation-only. Identifies where an existing line could move
 * slightly earlier or later on the same provider/day to recover a gap.
 * Never writes, messages, or mutates the input ProviderDay.
 *
 * Load after engine.js.
 *
 * Movement cost (Phase 2 engineering default, minute-based):
 *   Math.round((moveMinutes / 15) * 4)
 *   Independent of snapMinutes.
 *   15 → 4, 20 → 5, 30 → 8, 45 → 12, 60 → 16
 *
 * Minimum improvement (Phase 2 engineering default):
 *   scoreImprovement >= 8 after movement cost
 *   AND gapRecoveredMinutes > 0
 *
 * placementScoreImprovement = proposedScore - currentScore
 * scoreImprovement = placementScoreImprovement - movementCost
 * Phase 1 scores are reused unchanged. Movement cost is applied only here.
 */
(function () {
  var DEFAULT_MAX_MOVE = 60;
  var DEFAULT_MIN_IMPROVEMENT = 8;
  var COST_STEP_MINUTES = 15;
  var COST_PER_STEP = 4;

  function ns() {
    return window.ffBookingSmartScheduling || (window.ffBookingSmartScheduling = {});
  }

  function helpers() {
    return ns().helpers || {};
  }

  function snapOf(options) {
    var snap = Number(options && options.snapMinutes);
    if (!Number.isFinite(snap) || snap <= 0) {
      snap = ns().DEFAULT_SNAP_MINUTES || 15;
    }
    return Math.round(snap);
  }

  function maxMoveOf(options) {
    if (!options || options.maxMoveMinutes == null || options.maxMoveMinutes === "") {
      return DEFAULT_MAX_MOVE;
    }
    var n = Number(options.maxMoveMinutes);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_MAX_MOVE;
    return Math.round(n);
  }

  function minImprovementOf(options) {
    if (!options || options.minimumImprovementScore == null || options.minimumImprovementScore === "") {
      return DEFAULT_MIN_IMPROVEMENT;
    }
    var n = Number(options.minimumImprovementScore);
    if (!Number.isFinite(n)) return DEFAULT_MIN_IMPROVEMENT;
    return n;
  }

  function movementCost(moveMinutes) {
    var move = Math.abs(Number(moveMinutes) || 0);
    return Math.round((move / COST_STEP_MINUTES) * COST_PER_STEP);
  }

  function sameLine(a, b) {
    if (!a || !b) return false;
    if (a.lineId && b.lineId) return a.lineId === b.lineId;
    return a.appointmentId === b.appointmentId
      && a.startMin === b.startMin
      && a.endMin === b.endMin;
  }

  function dayWithoutLine(day, line) {
    return {
      dateKey: day.dateKey,
      locationId: day.locationId,
      providerId: day.providerId,
      allowedOverlapMinutes: day.allowedOverlapMinutes,
      workingIntervals: day.workingIntervals,
      occupied: (day.occupied || []).filter(function (row) {
        return !sameLine(row, line);
      })
    };
  }

  function adjacentOriginalGaps(originalGaps, line) {
    return (originalGaps || []).filter(function (gap) {
      return gap.endMin === line.startMin || gap.startMin === line.endMin;
    });
  }

  function gapRecoveredMinutes(originalGaps, line, proposedStartMin, proposedEndMin) {
    var h = helpers();
    var overlapMinutes = h.overlapMinutes;
    var recovered = 0;
    adjacentOriginalGaps(originalGaps, line).forEach(function (gap) {
      var overlap = overlapMinutes(gap.startMin, gap.endMin, proposedStartMin, proposedEndMin);
      if (!(overlap > 0)) return;
      if (gap.kind === "between" || overlap === gap.gapMin) recovered += overlap;
    });
    return recovered;
  }

  function closedBetweenGap(originalGaps, line, proposedStartMin, proposedEndMin) {
    var h = helpers();
    return adjacentOriginalGaps(originalGaps, line).some(function (gap) {
      if (gap.kind !== "between") return false;
      return h.overlapMinutes(gap.startMin, gap.endMin, proposedStartMin, proposedEndMin) > 0;
    });
  }

  function compareMoves(a, b) {
    if (b.scoreImprovement !== a.scoreImprovement) return b.scoreImprovement - a.scoreImprovement;
    if (b.gapRecoveredMinutes !== a.gapRecoveredMinutes) return b.gapRecoveredMinutes - a.gapRecoveredMinutes;
    if (a.moveMinutes !== b.moveMinutes) return a.moveMinutes - b.moveMinutes;
    if (a.proposedStartMin !== b.proposedStartMin) return a.proposedStartMin - b.proposedStartMin;
    var aLine = String(a.lineId || "");
    var bLine = String(b.lineId || "");
    if (aLine !== bLine) return aLine < bLine ? -1 : 1;
    var aAppt = String(a.appointmentId || "");
    var bAppt = String(b.appointmentId || "");
    if (aAppt !== bAppt) return aAppt < bAppt ? -1 : 1;
    return 0;
  }

  function opportunityReasons(spec) {
    var h = helpers();
    var adj = h.formatMinuteAdj ? h.formatMinuteAdj : function (n) { return Math.round(n) + "-minute"; };
    var dur = h.formatDuration ? h.formatDuration : function (n) { return n + " minutes"; };
    var reasons = [];
    function add(code, delta, text) {
      var row = { code: code, text: text };
      if (delta != null) row.delta = delta;
      reasons.push(row);
    }
    if (spec.direction === "earlier") {
      add("moves_earlier", 0, "Moving " + dur(spec.moveMinutes) + " earlier.");
    } else {
      add("moves_later", 0, "Moving " + dur(spec.moveMinutes) + " later.");
    }
    if (spec.gapRecoveredMinutes > 0) {
      add(
        "gap_recovered",
        spec.gapRecoveredMinutes,
        "Moving " + dur(spec.moveMinutes) + " " + spec.direction +
          " removes a " + adj(spec.gapRecoveredMinutes) + " gap."
      );
    }
    if (spec.closesBetween) {
      add("closes_between_gap", spec.gapRecoveredMinutes, "Closes a gap between two appointments.");
    }
    if (spec.proposedScore > spec.currentScore) {
      add(
        "improves_calendar_fit",
        spec.proposedScore - spec.currentScore,
        "Improves calendar fit by " + (spec.proposedScore - spec.currentScore) + " points."
      );
    }
    add(
      "movement_cost",
      -spec.cost,
      "A " + adj(spec.moveMinutes) + " move costs " + spec.cost + " points."
    );
    if (spec.usesOverlap) {
      add(
        "uses_permitted_overlap",
        (ns().SCORE && ns().SCORE.OVERLAP_PENALTY) || -25,
        "Uses permitted overlap with an existing appointment."
      );
    }
    return reasons;
  }

  function findMovesForLine(day, line, options) {
    var api = ns();
    var snapMinutes = snapOf(options);
    var maxMoveMinutes = maxMoveOf(options);
    var minImprovement = minImprovementOf(options);
    var durationMinutes = line.endMin - line.startMin;
    if (!(durationMinutes > 0) || maxMoveMinutes <= 0) return [];
    if (typeof api.describePlacement !== "function" || typeof api.enumerateValidSlots !== "function") {
      return [];
    }
    var without = dayWithoutLine(day, line);
    var currentSlot = api.describePlacement(without, line.startMin, line.endMin);
    if (!currentSlot) return [];
    var request = { durationMinutes: durationMinutes, snapMinutes: snapMinutes };
    var currentScored = api.scoreSlot(without, currentSlot, request);
    var originalGaps = typeof api.findFreeGaps === "function" ? api.findFreeGaps(day) : [];
    var slots = api.enumerateValidSlots(without, request);
    var out = [];
    slots.forEach(function (slot) {
      if (!slot || slot.startMin === line.startMin) return;
      var moveMinutes = Math.abs(slot.startMin - line.startMin);
      if (moveMinutes > maxMoveMinutes) return;
      var proposedScored = api.scoreSlot(without, slot, request);
      var cost = movementCost(moveMinutes);
      var placementScoreImprovement = proposedScored.score - currentScored.score;
      var recovered = gapRecoveredMinutes(originalGaps, line, slot.startMin, slot.endMin);
      var scoreImprovement = placementScoreImprovement - cost;
      if (recovered <= 0) return;
      if (scoreImprovement < minImprovement) return;
      var direction = slot.startMin < line.startMin ? "earlier" : "later";
      var closesBetween = closedBetweenGap(originalGaps, line, slot.startMin, slot.endMin);
      out.push({
        appointmentId: line.appointmentId || "",
        lineId: line.lineId || "",
        providerId: line.providerId || day.providerId || "",
        currentStartMin: line.startMin,
        currentEndMin: line.endMin,
        proposedStartMin: slot.startMin,
        proposedEndMin: slot.endMin,
        moveMinutes: moveMinutes,
        direction: direction,
        currentScore: currentScored.score,
        proposedScore: proposedScored.score,
        placementScoreImprovement: placementScoreImprovement,
        movementCost: cost,
        scoreImprovement: scoreImprovement,
        gapRecoveredMinutes: recovered,
        usesOverlap: !!slot.usesOverlap,
        reasons: opportunityReasons({
          direction: direction,
          moveMinutes: moveMinutes,
          gapRecoveredMinutes: recovered,
          closesBetween: closesBetween,
          proposedScore: proposedScored.score,
          currentScore: currentScored.score,
          cost: cost,
          usesOverlap: !!slot.usesOverlap
        })
      });
    });
    return out;
  }

  function findMoveOpportunities(day, options) {
    var input = day && typeof day === "object" ? day : {};
    var occupied = Array.isArray(input.occupied) ? input.occupied : [];
    var opportunities = [];
    occupied.forEach(function (line) {
      findMovesForLine(input, line, options).forEach(function (row) {
        opportunities.push(row);
      });
    });
    return opportunities.sort(compareMoves);
  }

  var api = ns();
  api.findMoveOpportunities = findMoveOpportunities;
  api.movementCost = movementCost;
  api.dayWithoutLine = dayWithoutLine;
  api.MOVE = {
    DEFAULT_MAX_MOVE: DEFAULT_MAX_MOVE,
    DEFAULT_MIN_IMPROVEMENT: DEFAULT_MIN_IMPROVEMENT,
    COST_STEP_MINUTES: COST_STEP_MINUTES,
    COST_PER_STEP: COST_PER_STEP
  };
})();
