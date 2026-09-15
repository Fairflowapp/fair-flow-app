/**
 * Smart Scheduling Phase 3 — provider-day time accounting and scores.
 *
 * Reuses Phase 1 gaps and Phase 2 move opportunities. No I/O.
 *
 * Time accounting:
 *   workingMinutes  = sum of supplied working intervals
 *   occupiedMinutes = union of occupied time clipped inside those intervals
 *   trueFreeMinutes = workingMinutes - occupiedMinutes
 *   utilizationPercent = workingMinutes === 0 ? 0 : round(occupied / working * 100)
 *
 * Overlapping appointments are merged before summing. Lunch / off-hours
 * are not working time and are not free time.
 *
 * Gap size classes (engineering defaults):
 *   1–smallGapMaxMinutes      small   (default 15)
 *   small+1–mediumGapMaxMinutes medium (default 30)
 *   above medium              large
 *
 * strandedGapMinutes: all true free gaps shorter than the reference duration,
 * including leading/trailing. Reported only.
 *
 * strandedBetweenGapMinutes / strandedBetweenGapCount: ONLY
 *   kind === "between" AND gapMin < referenceServiceDurationMinutes
 *
 * Fragmentation (0–100, higher = more broken). Between-gaps only:
 *   betweenGapCount * 15
 *   + smallBetweenCount * 10
 *   + min(40, strandedBetweenGapMinutes)
 *
 * Optimization (0–100, higher = better):
 *   no working time → 0
 *   no occupied time → 20 (empty is not "optimized")
 *   else 30 + round(utilization * 0.5) + (no between gaps ? 20 : 0)
 *        - round(fragmentation * 0.3)
 *        - min(15, round(strandedBetweenGapMinutes * 0.25))
 *
 * Recoverable minutes: independently recoverable capacity. Per unique true
 * gap, keep the MAX minutes any single move recovers from that gap, then
 * sum. This does not mean all moves can execute at once.
 */
(function () {
  var DEFAULT_SMALL = 15;
  var DEFAULT_MEDIUM = 30;
  var DEFAULT_REFERENCE = 30;

  function ns() {
    return window.ffBookingSmartScheduling || (window.ffBookingSmartScheduling = {});
  }

  function helpers() {
    return ns().helpers || {};
  }

  function optionInt(options, key, fallback) {
    if (!options || options[key] == null || options[key] === "") return fallback;
    var n = Number(options[key]);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.round(n);
  }

  function clamp(value, lo, hi) {
    var n = Math.round(Number(value));
    if (!Number.isFinite(n)) n = 0;
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  function gapKey(gap) {
    return [gap.workingIntervalIndex, gap.startMin, gap.endMin].join("|");
  }

  function sizeClassOf(gapMin, smallMax, mediumMax) {
    var n = Number(gapMin) || 0;
    if (n <= smallMax) return "small";
    if (n <= mediumMax) return "medium";
    return "large";
  }

  function workingMinutesOf(intervals) {
    var total = 0;
    (intervals || []).forEach(function (win) {
      if (win && win.endMin > win.startMin) total += win.endMin - win.startMin;
    });
    return total;
  }

  function occupiedMinutesOf(day) {
    var h = helpers();
    var clip = h.clipBusyToWindow;
    var total = 0;
    (day && day.workingIntervals || []).forEach(function (win) {
      if (!win || !(win.endMin > win.startMin) || !clip) return;
      clip(day.occupied || [], win.startMin, win.endMin).forEach(function (block) {
        total += block.endMin - block.startMin;
      });
    });
    return total;
  }

  function utilizationPercentOf(occupiedMinutes, workingMinutes) {
    if (!(workingMinutes > 0)) return 0;
    return Math.round((occupiedMinutes / workingMinutes) * 100);
  }

  function gapsRecoveredByOpportunity(gaps, opportunity) {
    var h = helpers();
    var overlapMinutes = h.overlapMinutes;
    var currentStart = opportunity && opportunity.currentStartMin;
    var currentEnd = opportunity && opportunity.currentEndMin;
    var proposedStart = opportunity && opportunity.proposedStartMin;
    var proposedEnd = opportunity && opportunity.proposedEndMin;
    return (gaps || []).filter(function (gap) {
      var adjacent = gap.endMin === currentStart || gap.startMin === currentEnd;
      if (!adjacent) return false;
      var overlap = overlapMinutes(gap.startMin, gap.endMin, proposedStart, proposedEnd);
      if (!(overlap > 0)) return false;
      return gap.kind === "between" || overlap === gap.gapMin;
    }).map(function (gap) {
      return {
        gap: gap,
        recoveredMinutes: overlapMinutes(gap.startMin, gap.endMin, proposedStart, proposedEnd)
      };
    });
  }

  function uniqueRecoverableByGap(gaps, opportunities) {
    var byKey = {};
    (opportunities || []).forEach(function (opportunity) {
      gapsRecoveredByOpportunity(gaps, opportunity).forEach(function (hit) {
        var key = gapKey(hit.gap);
        if (!byKey[key] || hit.recoveredMinutes > byKey[key]) byKey[key] = hit.recoveredMinutes;
      });
    });
    return byKey;
  }

  function compareBestMoves(a, b) {
    var aRec = Number(a && a.gapRecoveredMinutes) || 0;
    var bRec = Number(b && b.gapRecoveredMinutes) || 0;
    if (bRec !== aRec) return bRec - aRec;
    var aImp = Number(a && a.scoreImprovement) || 0;
    var bImp = Number(b && b.scoreImprovement) || 0;
    if (bImp !== aImp) return bImp - aImp;
    var aCost = Number(a && a.movementCost) || 0;
    var bCost = Number(b && b.movementCost) || 0;
    if (aCost !== bCost) return aCost - bCost;
    var aMove = Number(a && a.moveMinutes) || 0;
    var bMove = Number(b && b.moveMinutes) || 0;
    if (aMove !== bMove) return aMove - bMove;
    var aStart = Number(a && a.proposedStartMin) || 0;
    var bStart = Number(b && b.proposedStartMin) || 0;
    if (aStart !== bStart) return aStart - bStart;
    var aAppt = String(a && a.appointmentId || "");
    var bAppt = String(b && b.appointmentId || "");
    if (aAppt !== bAppt) return aAppt < bAppt ? -1 : 1;
    var aLine = String(a && a.lineId || "");
    var bLine = String(b && b.lineId || "");
    if (aLine !== bLine) return aLine < bLine ? -1 : 1;
    return 0;
  }

  function bestOpportunityForGap(gap, opportunities) {
    var hits = (opportunities || []).filter(function (opportunity) {
      return gapsRecoveredByOpportunity([gap], opportunity).length > 0;
    }).slice().sort(compareBestMoves);
    return hits[0] || null;
  }

  function enrichGaps(rawGaps, opportunities, smallMax, mediumMax, referenceMinutes) {
    var recoveredByGap = uniqueRecoverableByGap(rawGaps, opportunities);
    return (rawGaps || []).map(function (gap) {
      var sizeClass = sizeClassOf(gap.gapMin, smallMax, mediumMax);
      var stranded = gap.gapMin > 0 && gap.gapMin < referenceMinutes;
      var key = gapKey(gap);
      var best = bestOpportunityForGap(gap, opportunities);
      return {
        startMin: gap.startMin,
        endMin: gap.endMin,
        gapMin: gap.gapMin,
        kind: gap.kind,
        workingIntervalIndex: gap.workingIntervalIndex,
        beforeLineId: gap.beforeLineId,
        afterLineId: gap.afterLineId,
        sizeClass: sizeClass,
        stranded: stranded,
        recoverableMinutes: recoveredByGap[key] || 0,
        bestOpportunity: best
      };
    });
  }

  function fragmentationOf(gaps) {
    var between = (gaps || []).filter(function (gap) { return gap.kind === "between"; });
    var smallBetween = between.filter(function (gap) { return gap.sizeClass === "small"; });
    var strandedBetweenMinutes = 0;
    between.forEach(function (gap) {
      if (gap.stranded) strandedBetweenMinutes += gap.gapMin;
    });
    var components = {
      betweenGapCount: between.length,
      betweenGapWeight: 15,
      smallBetweenCount: smallBetween.length,
      smallBetweenWeight: 10,
      strandedBetweenMinutes: strandedBetweenMinutes,
      strandedCap: 40
    };
    var raw = components.betweenGapCount * components.betweenGapWeight
      + components.smallBetweenCount * components.smallBetweenWeight
      + Math.min(components.strandedCap, components.strandedBetweenMinutes);
    return {
      fragmentationScore: clamp(raw, 0, 100),
      components: components
    };
  }

  function optimizationOf(metrics) {
    var components = {
      base: 30,
      utilizationShare: Math.round(metrics.utilizationPercent * 0.5),
      packedBonus: metrics.betweenGapCount === 0 && metrics.occupiedMinutes > 0 ? 20 : 0,
      fragmentationPenalty: Math.round(metrics.fragmentationScore * 0.3),
      strandedPenalty: Math.min(15, Math.round(metrics.strandedBetweenGapMinutes * 0.25)),
      emptyScore: 20
    };
    if (!(metrics.workingMinutes > 0)) {
      return { optimizationScore: 0, components: components };
    }
    if (!(metrics.occupiedMinutes > 0)) {
      return { optimizationScore: components.emptyScore, components: components };
    }
    var raw = components.base
      + components.utilizationShare
      + components.packedBonus
      - components.fragmentationPenalty
      - components.strandedPenalty;
    return { optimizationScore: clamp(raw, 0, 100), components: components };
  }

  function summaryReasons(analysis) {
    var reasons = [];
    reasons.push({
      code: "utilization",
      text: "Utilization is " + analysis.utilizationPercent + "%."
    });
    if (analysis.betweenGapCount > 0) {
      reasons.push({
        code: "between_gaps",
        text: analysis.betweenGapCount + " between-appointment gap"
          + (analysis.betweenGapCount === 1 ? "" : "s")
          + " totaling " + analysis.totalBetweenGapMinutes + " minutes."
      });
    } else if (analysis.occupiedMinutes > 0) {
      reasons.push({ code: "packed", text: "No gaps between appointments." });
    } else {
      reasons.push({ code: "empty_day", text: "No appointments occupy this working day." });
    }
    if (analysis.strandedGapMinutes > 0) {
      reasons.push({
        code: "stranded_time",
        text: analysis.strandedGapMinutes + " minutes of free time are too small for the reference service."
      });
    }
    if (analysis.recoverableGapMinutes > 0) {
      reasons.push({
        code: "recoverable",
        text: analysis.recoverableGapMinutes + " minutes could potentially be recovered by small moves."
      });
    }
    return reasons;
  }

  function analyzeProviderDay(day, options) {
    var api = ns();
    var input = day && typeof day === "object" ? day : {};
    var smallMax = optionInt(options, "smallGapMaxMinutes", DEFAULT_SMALL);
    var mediumMax = optionInt(options, "mediumGapMaxMinutes", DEFAULT_MEDIUM);
    var referenceMinutes = optionInt(options, "referenceServiceDurationMinutes", DEFAULT_REFERENCE);
    if (mediumMax < smallMax) mediumMax = smallMax;
    var workingMinutes = workingMinutesOf(input.workingIntervals);
    var occupiedMinutes = occupiedMinutesOf(input);
    if (occupiedMinutes > workingMinutes) occupiedMinutes = workingMinutes;
    var trueFreeMinutes = workingMinutes - occupiedMinutes;
    var utilizationPercent = utilizationPercentOf(occupiedMinutes, workingMinutes);
    var rawGaps = typeof api.findFreeGaps === "function" ? api.findFreeGaps(input) : [];
    var opportunities = typeof api.findMoveOpportunities === "function"
      ? api.findMoveOpportunities(input, options)
      : [];
    var gaps = enrichGaps(rawGaps, opportunities, smallMax, mediumMax, referenceMinutes);
    var between = gaps.filter(function (gap) { return gap.kind === "between"; });
    var stranded = gaps.filter(function (gap) { return gap.stranded; });
    var strandedGapMinutes = 0;
    stranded.forEach(function (gap) { strandedGapMinutes += gap.gapMin; });
    var strandedBetween = between.filter(function (gap) { return gap.stranded; });
    var strandedBetweenGapMinutes = 0;
    strandedBetween.forEach(function (gap) { strandedBetweenGapMinutes += gap.gapMin; });
    var totalBetweenGapMinutes = 0;
    var largestBetweenGapMinutes = 0;
    between.forEach(function (gap) {
      totalBetweenGapMinutes += gap.gapMin;
      if (gap.gapMin > largestBetweenGapMinutes) largestBetweenGapMinutes = gap.gapMin;
    });
    var recoveredByGap = uniqueRecoverableByGap(rawGaps, opportunities);
    var recoverableGapMinutes = 0;
    Object.keys(recoveredByGap).forEach(function (key) {
      recoverableGapMinutes += recoveredByGap[key];
    });
    var frag = fragmentationOf(gaps);
    var opt = optimizationOf({
      workingMinutes: workingMinutes,
      occupiedMinutes: occupiedMinutes,
      utilizationPercent: utilizationPercent,
      betweenGapCount: between.length,
      fragmentationScore: frag.fragmentationScore,
      strandedBetweenGapMinutes: strandedBetweenGapMinutes
    });
    var analysis = {
      providerId: input.providerId || "",
      dateKey: input.dateKey || "",
      locationId: input.locationId || "",
      workingMinutes: workingMinutes,
      occupiedMinutes: occupiedMinutes,
      trueFreeMinutes: trueFreeMinutes,
      utilizationPercent: utilizationPercent,
      gaps: gaps,
      gapCount: gaps.length,
      betweenGapCount: between.length,
      totalBetweenGapMinutes: totalBetweenGapMinutes,
      largestBetweenGapMinutes: largestBetweenGapMinutes,
      strandedGapCount: stranded.length,
      strandedGapMinutes: strandedGapMinutes,
      strandedBetweenGapCount: strandedBetween.length,
      strandedBetweenGapMinutes: strandedBetweenGapMinutes,
      fragmentationScore: frag.fragmentationScore,
      fragmentationComponents: frag.components,
      moveOpportunities: opportunities,
      recoverableGapMinutes: recoverableGapMinutes,
      optimizationScore: opt.optimizationScore,
      optimizationComponents: opt.components
    };
    analysis.summaryReasons = summaryReasons(analysis);
    return analysis;
  }

  var api = ns();
  api.analyzeProviderDay = analyzeProviderDay;
  api.gapsRecoveredByOpportunity = gapsRecoveredByOpportunity;
  api.compareBestMoves = compareBestMoves;
  api.DAY = {
    DEFAULT_SMALL_GAP: DEFAULT_SMALL,
    DEFAULT_MEDIUM_GAP: DEFAULT_MEDIUM,
    DEFAULT_REFERENCE_DURATION: DEFAULT_REFERENCE
  };
})();
