/**
 * Smart Scheduling Phase 5 — cancellation recovery intelligence.
 *
 * Recommendation-only. Measures what a cancellation opened, whether an
 * existing same-provider appointment could move into that opening, and
 * whether the hole should simply be offered as an open fill.
 *
 * day = provider day AFTER the cancellation no longer occupies time.
 * cancellation = explicit descriptor of the removed line.
 *
 * recoveryScoreRaw =
 *     scoreImprovement
 *   + clamp(optimizationDeltaFromRecovery, -15, +15)
 *   - clamp(max(0, fragmentationDeltaFromRecovery), 0, 15)
 *   + clamp(max(0, -fragmentationDeltaFromRecovery), 0, 10)
 *   - clamp(max(0, strandedBetweenMinutesDeltaFromRecovery), 0, 15)
 *   + recoveredCancellationCapacityBonus
 *
 * recoveredCancellationCapacityBonus =
 *   min(20, round(20 * cancellationWindowRecoveredMinutes / max(1, newlyFreedMinutes)))
 *
 * newlyFreedMinutes is occupied-union time that became true free capacity,
 * not the nominal cancelled duration.
 *
 * recoveryScore = clamp(0–100, recoveryScoreRaw)
 *
 * A move is recommended only when recoveryScore >= minimumRecoveryScore
 * (default 10) AND cancellationWindowRecoveredMinutes > 0.
 *
 * Destinations are limited to the cancellation-created free window.
 * Same provider / same day only. No outreach, messaging, or writes.
 */
(function () {
  var DEFAULT_REFERENCE = 30;
  var DEFAULT_MIN_RECOVERY = 10;
  var OPT_CLAMP = 15;
  var FRAG_PENALTY_CAP = 15;
  var FRAG_BONUS_CAP = 10;
  var STRANDED_PENALTY_CAP = 15;
  var RECOVERED_BONUS_CAP = 20;

  function ns() {
    return window.ffBookingSmartScheduling || (window.ffBookingSmartScheduling = {});
  }

  function helpers() {
    return ns().helpers || {};
  }

  function trimText(value) {
    var h = helpers();
    return h.trimText ? h.trimText(value) : String(value == null ? "" : value).trim();
  }

  function optionInt(options, key, fallback) {
    if (!options || options[key] == null || options[key] === "") return fallback;
    var n = Number(options[key]);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.round(n);
  }

  function clampInt(value, lo, hi) {
    var n = Math.round(Number(value));
    if (!Number.isFinite(n)) n = 0;
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  function clampScore(value) {
    var api = ns();
    if (typeof api.clampScore === "function") return api.clampScore(value);
    return clampInt(value, 0, 100);
  }

  function asDay(input) {
    var api = ns();
    if (!input || typeof input !== "object") {
      return typeof api.normalizeProviderDay === "function" ? api.normalizeProviderDay({}) : {};
    }
    if (Array.isArray(input.occupied) && Array.isArray(input.workingIntervals)) return input;
    return typeof api.normalizeProviderDay === "function" ? api.normalizeProviderDay(input) : input;
  }

  function copyIntervals(list) {
    return (list || []).map(function (row) {
      return { startMin: row.startMin, endMin: row.endMin };
    });
  }

  function copyOccupied(list) {
    return (list || []).map(function (row) {
      return {
        lineId: row.lineId,
        appointmentId: row.appointmentId,
        providerId: row.providerId,
        startMin: row.startMin,
        endMin: row.endMin,
        durationMinutes: row.durationMinutes,
        status: row.status,
        serviceId: row.serviceId,
        requested: row.requested === true
      };
    });
  }

  function copyDay(day, occupied) {
    return {
      dateKey: trimText(day && day.dateKey),
      locationId: trimText(day && day.locationId),
      providerId: trimText(day && day.providerId),
      allowedOverlapMinutes: day && day.allowedOverlapMinutes != null ? day.allowedOverlapMinutes : 0,
      workingIntervals: copyIntervals(day && day.workingIntervals),
      occupied: occupied
    };
  }

  function analyzeDay(day, options) {
    var api = ns();
    if (typeof api.analyzeProviderDay !== "function") {
      return {
        utilizationPercent: 0,
        optimizationScore: 0,
        fragmentationScore: 0,
        betweenGapCount: 0,
        strandedBetweenGapMinutes: 0,
        occupiedMinutes: 0,
        gaps: []
      };
    }
    return api.analyzeProviderDay(day, options);
  }

  function cancellationOf(raw) {
    var row = raw && typeof raw === "object" ? raw : {};
    var startMin = Number(row.startMin);
    var endMin = Number(row.endMin);
    var duration = Number(row.durationMinutes);
    if (!Number.isFinite(startMin) && Number.isFinite(endMin) && duration > 0) startMin = endMin - duration;
    if (!Number.isFinite(endMin) && Number.isFinite(startMin) && duration > 0) endMin = startMin + duration;
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || !(endMin > startMin)) return null;
    return {
      appointmentId: trimText(row.appointmentId),
      lineId: trimText(row.lineId),
      providerId: trimText(row.providerId),
      startMin: startMin,
      endMin: endMin,
      durationMinutes: endMin - startMin
    };
  }

  function occupiedUnionInWorking(day) {
    var h = helpers();
    var clip = h.clipBusyToWindow;
    var blocks = [];
    (day && day.workingIntervals || []).forEach(function (win) {
      if (!win || !clip || !(win.endMin > win.startMin)) return;
      clip(day.occupied || [], win.startMin, win.endMin).forEach(function (block) {
        blocks.push({ startMin: block.startMin, endMin: block.endMin });
      });
    });
    return h.mergeBusyIntervals ? h.mergeBusyIntervals(blocks) : blocks;
  }

  function subtractIntervals(positive, negative) {
    var out = [];
    (positive || []).forEach(function (pos) {
      var pieces = [{ startMin: pos.startMin, endMin: pos.endMin }];
      (negative || []).forEach(function (neg) {
        var next = [];
        pieces.forEach(function (piece) {
          var overlapStart = Math.max(piece.startMin, neg.startMin);
          var overlapEnd = Math.min(piece.endMin, neg.endMin);
          if (!(overlapEnd > overlapStart)) {
            next.push(piece);
            return;
          }
          if (piece.startMin < overlapStart) {
            next.push({ startMin: piece.startMin, endMin: overlapStart });
          }
          if (overlapEnd < piece.endMin) {
            next.push({ startMin: overlapEnd, endMin: piece.endMin });
          }
        });
        pieces = next;
      });
      pieces.forEach(function (piece) {
        if (piece.endMin > piece.startMin) out.push(piece);
      });
    });
    out.sort(function (a, b) {
      return a.startMin - b.startMin || a.endMin - b.endMin;
    });
    return out;
  }

  function newlyFreedIntervalsOf(beforeDay, afterDay) {
    return subtractIntervals(occupiedUnionInWorking(beforeDay), occupiedUnionInWorking(afterDay)).map(function (row) {
      return {
        startMin: row.startMin,
        endMin: row.endMin,
        minutes: row.endMin - row.startMin
      };
    });
  }

  function minutesInIntervals(startMin, endMin, intervals) {
    var total = 0;
    (intervals || []).forEach(function (row) {
      total += windowOverlap(startMin, endMin, row.startMin, row.endMin);
    });
    return total;
  }

  function resultingFreeWindowOf(afterGaps, newlyFreedIntervals) {
    var h = helpers();
    var overlapMinutes = h.overlapMinutes;
    var best = null;
    var bestOverlap = 0;
    if (!(newlyFreedIntervals || []).length) return null;
    (afterGaps || []).forEach(function (gap) {
      var overlap = 0;
      newlyFreedIntervals.forEach(function (freed) {
        overlap += overlapMinutes(gap.startMin, gap.endMin, freed.startMin, freed.endMin);
      });
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = {
          startMin: gap.startMin,
          endMin: gap.endMin,
          gapMin: gap.gapMin,
          kind: gap.kind,
          workingIntervalIndex: gap.workingIntervalIndex
        };
      }
    });
    return bestOverlap > 0 ? best : null;
  }

  function dayWithCancelledLine(day, cancellation) {
    var compare = helpers().compareOccupied;
    var occupied = copyOccupied(day && day.occupied);
    occupied.push({
      lineId: cancellation.lineId || "__cancelled_line__",
      appointmentId: cancellation.appointmentId || "__cancelled_appointment__",
      providerId: cancellation.providerId || trimText(day && day.providerId),
      startMin: cancellation.startMin,
      endMin: cancellation.endMin,
      durationMinutes: cancellation.durationMinutes,
      status: "scheduled",
      serviceId: "",
      requested: false
    });
    if (compare) occupied.sort(compare);
    return copyDay(day, occupied);
  }

  function dayWithRecoveredLine(afterDay, line, proposedStartMin, proposedEndMin) {
    var api = ns();
    var without = typeof api.dayWithoutLine === "function"
      ? api.dayWithoutLine(afterDay, line)
      : afterDay;
    var compare = helpers().compareOccupied;
    var occupied = copyOccupied(without.occupied);
    occupied.push({
      lineId: line.lineId,
      appointmentId: line.appointmentId,
      providerId: line.providerId || afterDay.providerId,
      startMin: proposedStartMin,
      endMin: proposedEndMin,
      durationMinutes: proposedEndMin - proposedStartMin,
      status: line.status || "scheduled",
      serviceId: line.serviceId || "",
      requested: line.requested === true
    });
    if (compare) occupied.sort(compare);
    return copyDay(afterDay, occupied);
  }

  function windowOverlap(startA, endA, startB, endB) {
    var h = helpers();
    return h.overlapMinutes ? h.overlapMinutes(startA, endA, startB, endB) : 0;
  }

  function recoveredCapacityBonus(recovered, newlyFreedMinutes) {
    var denom = Math.max(1, Number(newlyFreedMinutes) || 0);
    return clampInt(Math.round(20 * (Number(recovered) || 0) / denom), 0, RECOVERED_BONUS_CAP);
  }

  function recoveryScoreOf(spec) {
    var raw = Number(spec.scoreImprovement) || 0;
    raw += clampInt(spec.optimizationDeltaFromRecovery, -OPT_CLAMP, OPT_CLAMP);
    raw -= clampInt(Math.max(0, spec.fragmentationDeltaFromRecovery), 0, FRAG_PENALTY_CAP);
    raw += clampInt(Math.max(0, -spec.fragmentationDeltaFromRecovery), 0, FRAG_BONUS_CAP);
    raw -= clampInt(Math.max(0, spec.strandedBetweenMinutesDeltaFromRecovery), 0, STRANDED_PENALTY_CAP);
    raw += spec.recoveredCancellationCapacityBonus;
    return clampScore(raw);
  }

  function recoveryReasons(spec) {
    var h = helpers();
    var dur = h.formatDuration ? h.formatDuration : function (n) { return n + " minutes"; };
    var reasons = [];
    function add(code, delta, text) {
      reasons.push({ code: code, delta: delta, text: text });
    }
    add(
      spec.direction === "earlier" ? "moves_earlier" : "moves_later",
      0,
      "Appointment could move " + dur(spec.moveMinutes) + " " + spec.direction + "."
    );
    if (spec.cancellationWindowRecoveredMinutes > 0) {
      add(
        "recovers_cancelled_window",
        spec.recoveredCancellationCapacityBonus,
        "Recovers " + dur(spec.cancellationWindowRecoveredMinutes) + " of the cancelled opening."
      );
    }
    if (spec.optimizationDeltaFromRecovery > 0) {
      add("improves_day_optimization", clampInt(spec.optimizationDeltaFromRecovery, -OPT_CLAMP, OPT_CLAMP), "Improves the day after the cancellation.");
    }
    if (spec.fragmentationDeltaFromRecovery < 0) {
      add("reduces_fragmentation", clampInt(-spec.fragmentationDeltaFromRecovery, 0, FRAG_BONUS_CAP), "Reduces fragmentation created by the cancellation.");
    }
    if (spec.fragmentationDeltaFromRecovery > 0) {
      add("increases_fragmentation", -clampInt(spec.fragmentationDeltaFromRecovery, 0, FRAG_PENALTY_CAP), "Would increase fragmentation.");
    }
    if (spec.usesOverlap) {
      add("uses_permitted_overlap", 0, "Uses permitted overlap already penalized in the slot score.");
    }
    return reasons;
  }

  function compareRecovery(a, b) {
    if (b.recoveryScore !== a.recoveryScore) return b.recoveryScore - a.recoveryScore;
    if (b.cancellationWindowRecoveredMinutes !== a.cancellationWindowRecoveredMinutes) {
      return b.cancellationWindowRecoveredMinutes - a.cancellationWindowRecoveredMinutes;
    }
    if (b.totalGapRecoveredMinutes !== a.totalGapRecoveredMinutes) {
      return b.totalGapRecoveredMinutes - a.totalGapRecoveredMinutes;
    }
    if (b.scoreImprovement !== a.scoreImprovement) return b.scoreImprovement - a.scoreImprovement;
    if (a.movementCost !== b.movementCost) return a.movementCost - b.movementCost;
    if (a.moveMinutes !== b.moveMinutes) return a.moveMinutes - b.moveMinutes;
    if (!!a.usesOverlap !== !!b.usesOverlap) return a.usesOverlap ? 1 : -1;
    if (a.proposedStartMin !== b.proposedStartMin) return a.proposedStartMin - b.proposedStartMin;
    var ap = String(a.appointmentId || "");
    var bp = String(b.appointmentId || "");
    if (ap !== bp) return ap < bp ? -1 : 1;
    return String(a.lineId || "").localeCompare(String(b.lineId || ""));
  }

  function findRecoveryOpportunities(afterDay, afterAnalysis, cancellation, resultingWindow, newlyFreedIntervals, newlyFreedMinutes, options) {
    var api = ns();
    if (!resultingWindow || typeof api.enumerateValidSlots !== "function") return [];
    var snapMinutes = optionInt(options, "snapMinutes", api.DEFAULT_SNAP_MINUTES || 15);
    var maxMove = optionInt(
      options,
      "maxMoveMinutes",
      api.MOVE && api.MOVE.DEFAULT_MAX_MOVE != null ? api.MOVE.DEFAULT_MAX_MOVE : 60
    );
    var minRecovery = optionInt(options, "minimumRecoveryScore", DEFAULT_MIN_RECOVERY);
    var occupied = afterDay.occupied || [];
    var opportunities = [];
    occupied.forEach(function (line) {
      var durationMinutes = line.endMin - line.startMin;
      if (!(durationMinutes > 0) || trimText(line.providerId) !== trimText(afterDay.providerId)) return;
      var without = api.dayWithoutLine(afterDay, line);
      var currentSlot = api.describePlacement(without, line.startMin, line.endMin);
      if (!currentSlot) return;
      var request = { durationMinutes: durationMinutes, snapMinutes: snapMinutes };
      var currentScored = api.scoreSlot(without, currentSlot, request);
      var afterGaps = afterAnalysis.gaps || [];
      api.enumerateValidSlots(without, request).forEach(function (slot) {
        if (!slot || slot.startMin === line.startMin) return;
        var moveMinutes = Math.abs(slot.startMin - line.startMin);
        if (moveMinutes > maxMove) return;
        if (!(windowOverlap(slot.startMin, slot.endMin, resultingWindow.startMin, resultingWindow.endMin) > 0)) return;
        var cancellationWindowRecoveredMinutes = minutesInIntervals(
          slot.startMin,
          slot.endMin,
          newlyFreedIntervals
        );
        if (!(cancellationWindowRecoveredMinutes > 0)) return;
        var proposedScored = api.scoreSlot(without, slot, request);
        var cost = api.movementCost(moveMinutes);
        var placementScoreImprovement = proposedScored.score - currentScored.score;
        var scoreImprovement = placementScoreImprovement - cost;
        var recoveredHits = typeof api.gapsRecoveredByOpportunity === "function"
          ? api.gapsRecoveredByOpportunity(afterGaps, {
            currentStartMin: line.startMin,
            currentEndMin: line.endMin,
            proposedStartMin: slot.startMin,
            proposedEndMin: slot.endMin
          })
          : [];
        var totalGapRecoveredMinutes = 0;
        recoveredHits.forEach(function (hit) { totalGapRecoveredMinutes += hit.recoveredMinutes; });
        var recoveredDay = dayWithRecoveredLine(afterDay, line, slot.startMin, slot.endMin);
        var recoveredAnalysis = analyzeDay(recoveredDay, options);
        var spec = {
          scoreImprovement: scoreImprovement,
          optimizationDeltaFromRecovery: (recoveredAnalysis.optimizationScore || 0) - (afterAnalysis.optimizationScore || 0),
          fragmentationDeltaFromRecovery: (recoveredAnalysis.fragmentationScore || 0) - (afterAnalysis.fragmentationScore || 0),
          strandedBetweenMinutesDeltaFromRecovery: (recoveredAnalysis.strandedBetweenGapMinutes || 0) - (afterAnalysis.strandedBetweenGapMinutes || 0),
          cancellationWindowRecoveredMinutes: cancellationWindowRecoveredMinutes,
          recoveredCancellationCapacityBonus: recoveredCapacityBonus(cancellationWindowRecoveredMinutes, newlyFreedMinutes),
          direction: slot.startMin < line.startMin ? "earlier" : "later",
          moveMinutes: moveMinutes,
          usesOverlap: !!slot.usesOverlap
        };
        var recoveryScore = recoveryScoreOf(spec);
        if (recoveryScore < minRecovery) return;
        opportunities.push({
          type: "move_existing_appointment",
          appointmentId: line.appointmentId || "",
          lineId: line.lineId || "",
          providerId: line.providerId || afterDay.providerId || "",
          currentStartMin: line.startMin,
          currentEndMin: line.endMin,
          proposedStartMin: slot.startMin,
          proposedEndMin: slot.endMin,
          moveMinutes: moveMinutes,
          direction: spec.direction,
          cancellationWindowRecoveredMinutes: cancellationWindowRecoveredMinutes,
          totalGapRecoveredMinutes: totalGapRecoveredMinutes,
          currentScore: currentScored.score,
          proposedScore: proposedScored.score,
          placementScoreImprovement: placementScoreImprovement,
          movementCost: cost,
          scoreImprovement: scoreImprovement,
          optimizationAfterRecovery: recoveredAnalysis.optimizationScore || 0,
          fragmentationAfterRecovery: recoveredAnalysis.fragmentationScore || 0,
          optimizationDeltaFromRecovery: spec.optimizationDeltaFromRecovery,
          fragmentationDeltaFromRecovery: spec.fragmentationDeltaFromRecovery,
          strandedBetweenMinutesDeltaFromRecovery: spec.strandedBetweenMinutesDeltaFromRecovery,
          usesOverlap: !!slot.usesOverlap,
          recoveryScore: recoveryScore,
          recoveredCancellationCapacityBonus: spec.recoveredCancellationCapacityBonus,
          reasons: recoveryReasons(spec)
        });
      });
    });
    return opportunities.sort(compareRecovery);
  }

  function openFillOf(day, cancellation, resultingWindow) {
    if (!resultingWindow) return null;
    return {
      type: "open_fill_opportunity",
      providerId: trimText(day && day.providerId),
      startMin: resultingWindow.startMin,
      endMin: resultingWindow.endMin,
      durationMinutes: resultingWindow.gapMin,
      resultingFreeWindowMinutes: resultingWindow.gapMin,
      cancelledAppointmentId: cancellation.appointmentId,
      text: "This cancellation created a usable "
        + resultingWindow.gapMin
        + "-minute opening that should be filled."
    };
  }

  function analyzeCancellationRecovery(day, cancellationInput, options) {
    var api = ns();
    var afterDay = asDay(day);
    var cancellation = cancellationOf(cancellationInput);
    var opts = options && typeof options === "object" ? options : {};
    var referenceMinutes = optionInt(opts, "referenceServiceDurationMinutes", DEFAULT_REFERENCE);
    if (!cancellation) {
      return emptyAnalysis(afterDay, null, referenceMinutes);
    }
    if (cancellation.providerId && trimText(afterDay.providerId) && cancellation.providerId !== trimText(afterDay.providerId)) {
      return emptyAnalysis(afterDay, cancellation, referenceMinutes);
    }
    var beforeDay = dayWithCancelledLine(afterDay, cancellation);
    var before = analyzeDay(beforeDay, opts);
    var after = analyzeDay(afterDay, opts);
    var newlyFreedIntervals = newlyFreedIntervalsOf(beforeDay, afterDay);
    var newlyFreedMinutes = 0;
    newlyFreedIntervals.forEach(function (row) { newlyFreedMinutes += row.minutes; });
    var resultingFreeWindow = resultingFreeWindowOf(after.gaps, newlyFreedIntervals);
    var createsBetweenGap = typeof api.createsBetweenGapFromAnalyses === "function"
      ? api.createsBetweenGapFromAnalyses(before, after)
      : false;
    var increasesFragmentation = (after.fragmentationScore || 0) > (before.fragmentationScore || 0);
    var createsStrandedBetweenTime = (after.strandedBetweenGapMinutes || 0) > (before.strandedBetweenGapMinutes || 0);
    var opensUsableCapacity = !!(
      newlyFreedMinutes > 0
      && resultingFreeWindow
      && resultingFreeWindow.gapMin >= referenceMinutes
    );
    var recoveryOpportunities = findRecoveryOpportunities(
      afterDay,
      after,
      cancellation,
      resultingFreeWindow,
      newlyFreedIntervals,
      newlyFreedMinutes,
      opts
    );
    return {
      providerId: afterDay.providerId || "",
      dateKey: afterDay.dateKey || "",
      locationId: afterDay.locationId || "",
      cancellation: cancellation,
      cancelledDurationMinutes: cancellation.durationMinutes,
      newlyFreedMinutes: newlyFreedMinutes,
      newlyFreedIntervals: newlyFreedIntervals,
      resultingFreeWindow: resultingFreeWindow,
      referenceServiceDurationMinutes: referenceMinutes,
      optimizationBeforeCancellation: before.optimizationScore || 0,
      optimizationAfterCancellation: after.optimizationScore || 0,
      optimizationDeltaFromCancellation: (after.optimizationScore || 0) - (before.optimizationScore || 0),
      fragmentationBeforeCancellation: before.fragmentationScore || 0,
      fragmentationAfterCancellation: after.fragmentationScore || 0,
      fragmentationDeltaFromCancellation: (after.fragmentationScore || 0) - (before.fragmentationScore || 0),
      utilizationBeforeCancellation: before.utilizationPercent || 0,
      utilizationAfterCancellation: after.utilizationPercent || 0,
      betweenGapCountBeforeCancellation: before.betweenGapCount || 0,
      betweenGapCountAfterCancellation: after.betweenGapCount || 0,
      strandedBetweenGapMinutesBeforeCancellation: before.strandedBetweenGapMinutes || 0,
      strandedBetweenGapMinutesAfterCancellation: after.strandedBetweenGapMinutes || 0,
      occupiedMinutesBeforeCancellation: before.occupiedMinutes || 0,
      occupiedMinutesAfterCancellation: after.occupiedMinutes || 0,
      createsBetweenGap: createsBetweenGap,
      increasesFragmentation: increasesFragmentation,
      createsStrandedBetweenTime: createsStrandedBetweenTime,
      opensUsableCapacity: opensUsableCapacity,
      recoveryOpportunities: recoveryOpportunities,
      beforeAnalysis: before,
      afterAnalysis: after
    };
  }

  function emptyAnalysis(day, cancellation, referenceMinutes) {
    return {
      providerId: day && day.providerId || "",
      dateKey: day && day.dateKey || "",
      locationId: day && day.locationId || "",
      cancellation: cancellation,
      cancelledDurationMinutes: cancellation ? cancellation.durationMinutes : 0,
      newlyFreedMinutes: 0,
      newlyFreedIntervals: [],
      resultingFreeWindow: null,
      referenceServiceDurationMinutes: referenceMinutes,
      optimizationBeforeCancellation: 0,
      optimizationAfterCancellation: 0,
      optimizationDeltaFromCancellation: 0,
      fragmentationBeforeCancellation: 0,
      fragmentationAfterCancellation: 0,
      fragmentationDeltaFromCancellation: 0,
      utilizationBeforeCancellation: 0,
      utilizationAfterCancellation: 0,
      betweenGapCountBeforeCancellation: 0,
      betweenGapCountAfterCancellation: 0,
      strandedBetweenGapMinutesBeforeCancellation: 0,
      strandedBetweenGapMinutesAfterCancellation: 0,
      occupiedMinutesBeforeCancellation: 0,
      occupiedMinutesAfterCancellation: 0,
      createsBetweenGap: false,
      increasesFragmentation: false,
      createsStrandedBetweenTime: false,
      opensUsableCapacity: false,
      recoveryOpportunities: [],
      beforeAnalysis: null,
      afterAnalysis: null
    };
  }

  function recommendCancellationRecovery(day, cancellation, options) {
    var analysis = analyzeCancellationRecovery(day, cancellation, options);
    var best = analysis.recoveryOpportunities && analysis.recoveryOpportunities[0];
    if (best && best.cancellationWindowRecoveredMinutes > 0) {
      return Object.assign({
        text: "Moving an existing appointment "
          + best.moveMinutes
          + " minutes "
          + best.direction
          + " would recover the cancelled opening."
      }, best);
    }
    if (analysis.opensUsableCapacity && analysis.resultingFreeWindow && analysis.newlyFreedMinutes > 0) {
      return openFillOf(asDay(day), analysis.cancellation || cancellationOf(cancellation) || {}, analysis.resultingFreeWindow);
    }
    return {
      type: "no_action",
      providerId: analysis.providerId,
      text: "No cancellation recovery is recommended."
    };
  }

  var api = ns();
  api.analyzeCancellationRecovery = analyzeCancellationRecovery;
  api.recommendCancellationRecovery = recommendCancellationRecovery;
  api.dayWithCancelledLine = dayWithCancelledLine;
  api.CANCEL = {
    DEFAULT_REFERENCE_DURATION: DEFAULT_REFERENCE,
    DEFAULT_MIN_RECOVERY: DEFAULT_MIN_RECOVERY,
    RECOVERED_BONUS_CAP: RECOVERED_BONUS_CAP
  };
})();
