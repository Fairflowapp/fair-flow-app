/**
 * Smart Scheduling Phase 3 — gap priority and day-level recommendations.
 *
 * Recommendation-only. No writes, messaging, or Calendar updates.
 *
 * Gap priority (higher = more worth solving):
 *   (between ? 40 : 10)
 *   + min(gapMinutes, 90)
 *   + (stranded between-gap ? 15 : 0)
 *   + best move scoreImprovement
 *   + best move recovered minutes
 *
 * Between-gaps outrank equal-size leading/trailing leftovers by default.
 *
 * Recommendation types:
 *   move_appointment  — a Phase 2 move that recovers a gap
 *   gap_attention     — a between-gap with no qualifying move
 *   already_optimized — occupied day with no between-gaps
 *   no_action         — empty day or nothing useful to do
 *
 * At most one primary move_appointment per true between-gap. Phase 2
 * still returns every qualifying move; Phase 3 picks the single best
 * using compareBestMoves (recovered minutes, score improvement,
 * movement cost, move distance, proposed start, stable ids).
 */
(function () {
  function ns() {
    return window.ffBookingSmartScheduling || (window.ffBookingSmartScheduling = {});
  }

  function helpers() {
    return ns().helpers || {};
  }

  function gapIdentity(gap) {
    return [gap.workingIntervalIndex, gap.startMin, gap.endMin].join("|");
  }

  function actionKey(gap) {
    return gapIdentity(gap);
  }

  function priorityScoreOf(gap) {
    var between = gap.kind === "between";
    var score = (between ? 40 : 10) + Math.min(Number(gap.gapMin) || 0, 90);
    if (between && gap.stranded) score += 15;
    if (gap.bestOpportunity) {
      score += Number(gap.bestOpportunity.scoreImprovement) || 0;
      score += Number(gap.bestOpportunity.gapRecoveredMinutes) || 0;
    }
    return score;
  }

  function comparePriorities(a, b) {
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    if (b.gapMin !== a.gapMin) return b.gapMin - a.gapMin;
    if (a.startMin !== b.startMin) return a.startMin - b.startMin;
    return (a.kind || "").localeCompare(b.kind || "");
  }

  function rankGapPriorities(day, options) {
    var analysis = ns().analyzeProviderDay(day, options);
    return (analysis.gaps || []).map(function (gap) {
      return Object.assign({}, gap, { priorityScore: priorityScoreOf(gap) });
    }).sort(comparePriorities);
  }

  function moveText(opportunity) {
    var h = helpers();
    var dur = h.formatDuration ? h.formatDuration : function (n) { return n + " minutes"; };
    var clock = h.formatClock ? h.formatClock : function (n) { return String(n); };
    return "Appointment could potentially move "
      + dur(opportunity.moveMinutes) + " " + opportunity.direction
      + " from " + clock(opportunity.currentStartMin)
      + " to " + clock(opportunity.proposedStartMin)
      + ", recovering " + dur(opportunity.gapRecoveredMinutes) + ".";
  }

  function recommendDayOptimizations(day, options) {
    var api = ns();
    var analysis = typeof api.analyzeProviderDay === "function"
      ? api.analyzeProviderDay(day, options)
      : { gaps: [], occupiedMinutes: 0, betweenGapCount: 0, optimizationScore: 0 };
    var priorities = (analysis.gaps || []).map(function (gap) {
      return Object.assign({}, gap, { priorityScore: priorityScoreOf(gap) });
    }).sort(comparePriorities);
    var moves = [];
    var seen = {};
    priorities.forEach(function (gap) {
      if (gap.kind !== "between" || !gap.bestOpportunity) return;
      var key = actionKey(gap);
      if (seen[key]) return;
      seen[key] = true;
      moves.push({
        type: "move_appointment",
        priorityScore: gap.priorityScore,
        gap: gap,
        opportunity: gap.bestOpportunity,
        text: moveText(gap.bestOpportunity)
      });
    });
    if (moves.length) {
      return moves.sort(function (a, b) {
        if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
        return (b.opportunity.scoreImprovement || 0) - (a.opportunity.scoreImprovement || 0);
      });
    }
    var attention = priorities.filter(function (gap) {
      return gap.kind === "between";
    }).map(function (gap) {
      return {
        type: "gap_attention",
        priorityScore: gap.priorityScore,
        gap: gap,
        opportunity: null,
        text: "A " + gap.gapMin + "-minute gap between appointments has no qualifying small move."
      };
    });
    if (attention.length) return attention;
    if (analysis.occupiedMinutes > 0 && analysis.betweenGapCount === 0) {
      return [{
        type: "already_optimized",
        priorityScore: analysis.optimizationScore,
        gap: null,
        opportunity: null,
        text: "This provider day has no between-appointment gaps to recover."
      }];
    }
    return [{
      type: "no_action",
      priorityScore: 0,
      gap: null,
      opportunity: null,
      text: "No scheduling changes are recommended."
    }];
  }

  var api = ns();
  api.rankGapPriorities = rankGapPriorities;
  api.recommendDayOptimizations = recommendDayOptimizations;
})();
