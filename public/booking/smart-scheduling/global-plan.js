/**
 * Smart Scheduling Phase 9 — global provider-day recovery plan.
 *
 * Recommendation-only. Consumes independent Phase 8 per-gap plans and
 * chooses the best compatible set of already-qualified actions.
 *
 * Does not invent move or waitlist candidates. Does not execute, move,
 * message, or book. Phase 8 remains independently reusable.
 *
 * globalPlanScoreRaw =
 *     40
 *   + round(globalGapRecoveryPercent * 0.30)
 *   + clamp(optimizationDelta, -20, +20)
 *   - clamp(max(0, fragmentationDelta), 0, 20)
 *   + clamp(max(0, -fragmentationDelta), 0, 15)
 *   - clamp(max(0, strandedBetweenMinutesDelta), 0, 15)
 *   - min(25, round(totalClientDisruptionMinutes / 15) * 2)
 *   - min(15, overlapActionCount * 5)
 *
 * globalPlanScore = clamp(0, 100, globalPlanScoreRaw)
 *
 * Recovery is recomputed from the final simulated occupancy. Independent
 * Phase 8 gapRecoveredMinutes values are never summed.
 *
 * Final occupancy rejects only NEW or WORSENED overlap conflicts. A
 * pre-existing source violation is tolerated when the same line pair's
 * violating overlap is unchanged or strictly reduced inside the original
 * interval. The empty action set is always a valid baseline candidate.
 *
 * Search evaluates the empty plan first, then Phase 8 actions before SKIP.
 */
(function () {
  var BASE = 40;
  var OPT_CLAMP = 20;
  var FRAG_PENALTY_CAP = 20;
  var FRAG_BONUS_CAP = 15;
  var STRANDED_PENALTY_CAP = 15;
  var DISRUPTION_CAP = 25;
  var OVERLAP_ACTION_PENALTY = 5;
  var OVERLAP_PENALTY_CAP = 15;
  var DEFAULT_MAX_GAPS = 6;
  var DEFAULT_MAX_ACTIONS_PER_GAP = 4;
  var DEFAULT_MAX_EVALUATED = 5000;
  var WAITLIST_LINE_PREFIX = "__smart_waitlist__";

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

  function analyzeDay(day, options) {
    var api = ns();
    if (typeof api.analyzeProviderDay !== "function") {
      return {
        optimizationScore: 0,
        fragmentationScore: 0,
        strandedBetweenGapMinutes: 0,
        utilizationPercent: 0,
        trueFreeMinutes: 0,
        betweenGapCount: 0
      };
    }
    return api.analyzeProviderDay(day, options);
  }

  function gapIdentityOf(gap) {
    var api = ns();
    if (typeof api.gapIdentity === "function") return api.gapIdentity(gap);
    if (!gap) return "";
    return [gap.workingIntervalIndex, gap.startMin, gap.endMin].join("|");
  }

  function isActionable(action) {
    return !!(action && (
      action.type === "move_existing_appointment" || action.type === "fill_from_waitlist"
    ));
  }

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function copyLine(row) {
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
  }

  function copyDay(day) {
    return {
      dateKey: day.dateKey,
      locationId: day.locationId,
      providerId: day.providerId,
      allowedOverlapMinutes: day.allowedOverlapMinutes,
      workingIntervals: (day.workingIntervals || []).map(function (row) {
        return { startMin: row.startMin, endMin: row.endMin };
      }),
      occupied: (day.occupied || []).map(copyLine)
    };
  }

  function sortOccupied(list) {
    var compare = helpers().compareOccupied;
    if (compare) list.sort(compare);
    else {
      list.sort(function (a, b) {
        return a.startMin - b.startMin || a.endMin - b.endMin
          || String(a.lineId || "").localeCompare(String(b.lineId || ""));
      });
    }
    return list;
  }

  function sameLine(a, b) {
    if (!a || !b) return false;
    if (a.lineId && b.lineId) return a.lineId === b.lineId;
    return a.appointmentId === b.appointmentId
      && a.startMin === b.startMin
      && a.endMin === b.endMin;
  }

  function moveSourceRef(action) {
    return {
      lineId: trimText(action && action.lineId),
      appointmentId: trimText(action && action.appointmentId),
      startMin: action && action.currentStartMin,
      endMin: action && action.currentEndMin
    };
  }

  function findSourceLine(occupied, action) {
    var ref = moveSourceRef(action);
    var found = null;
    (occupied || []).forEach(function (row) {
      if (!found && sameLine(row, ref)) found = row;
    });
    return found;
  }

  function moveResourceKey(action) {
    return trimText(action && action.appointmentId) + "|" + trimText(action && action.lineId);
  }

  function waitlistLineId(action) {
    return [
      WAITLIST_LINE_PREFIX,
      trimText(action && action.waitlistId),
      Number(action && action.candidateStartMin) || 0
    ].join("|");
  }

  function lineStableId(row) {
    return trimText(row && row.appointmentId) + "|" + trimText(row && row.lineId);
  }

  function pairIdentity(a, b) {
    var ia = lineStableId(a);
    var ib = lineStableId(b);
    return ia < ib ? ia + "||" + ib : ib + "||" + ia;
  }

  function overlapInterval(a, b) {
    var start = Math.max(Number(a && a.startMin), Number(b && b.startMin));
    var end = Math.min(Number(a && a.endMin), Number(b && b.endMin));
    var minutes = Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : 0;
    return { overlapStart: start, overlapEnd: end, overlapMinutes: minutes };
  }

  function allowedOverlapOf(day) {
    var h = helpers();
    var raw = day && day.allowedOverlapMinutes;
    return h.normalizeAllowedOverlap ? h.normalizeAllowedOverlap(raw) : (Number(raw) || 0);
  }

  function violatingPairs(occupied, allowed) {
    var list = occupied || [];
    var out = [];
    var i;
    var j;
    for (i = 0; i < list.length; i += 1) {
      for (j = i + 1; j < list.length; j += 1) {
        var ov = overlapInterval(list[i], list[j]);
        if (ov.overlapMinutes > allowed) {
          out.push({
            pairId: pairIdentity(list[i], list[j]),
            overlapStart: ov.overlapStart,
            overlapEnd: ov.overlapEnd,
            overlapMinutes: ov.overlapMinutes
          });
        }
      }
    }
    return out;
  }

  function baselineConflictMap(day) {
    var map = {};
    violatingPairs(day && day.occupied, allowedOverlapOf(day)).forEach(function (row) {
      map[row.pairId] = row;
    });
    return map;
  }

  function isBaselineTolerated(pair, baseline) {
    if (!pair || !baseline) return false;
    return pair.overlapStart >= baseline.overlapStart
      && pair.overlapEnd <= baseline.overlapEnd
      && pair.overlapMinutes <= baseline.overlapMinutes;
  }

  function newOrWorsenedOverlapConflict(occupied, allowed, baseline) {
    var pairs = violatingPairs(occupied, allowed);
    var i;
    for (i = 0; i < pairs.length; i += 1) {
      var base = baseline && baseline[pairs[i].pairId];
      if (!base || !isBaselineTolerated(pairs[i], base)) return true;
    }
    return false;
  }

  function hardSetConflicts(actions) {
    var seenAction = {};
    var seenMove = {};
    var seenWaitlist = {};
    var i;
    for (i = 0; i < (actions || []).length; i += 1) {
      var action = actions[i];
      if (!isActionable(action)) return "invalid_action";
      var actionId = String(action.actionId || "");
      if (!actionId || seenAction[actionId]) return "duplicate_action";
      seenAction[actionId] = true;
      if (action.type === "move_existing_appointment") {
        var moveKey = moveResourceKey(action);
        if (!trimText(action.appointmentId) && !trimText(action.lineId)) return "invalid_source_line";
        if (seenMove[moveKey]) return "same_appointment_moved_twice";
        seenMove[moveKey] = true;
      }
      if (action.type === "fill_from_waitlist") {
        var waitKey = trimText(action.waitlistId);
        if (!waitKey) return "duplicate_waitlist";
        if (seenWaitlist[waitKey]) return "same_waitlist_used_twice";
        seenWaitlist[waitKey] = true;
      }
    }
    return "";
  }

  function occupiedMinutesInRange(occupied, startMin, endMin) {
    var h = helpers();
    var clipped = h.clipBusyToWindow
      ? h.clipBusyToWindow(occupied, startMin, endMin)
      : [];
    var total = 0;
    (clipped || []).forEach(function (row) {
      total += Math.max(0, (Number(row.endMin) || 0) - (Number(row.startMin) || 0));
    });
    return total;
  }

  function snapshotMetrics(analysis) {
    return {
      optimizationScore: Number(analysis && analysis.optimizationScore) || 0,
      fragmentationScore: Number(analysis && analysis.fragmentationScore) || 0,
      strandedBetweenGapMinutes: Number(analysis && analysis.strandedBetweenGapMinutes) || 0,
      utilizationPercent: Number(analysis && analysis.utilizationPercent) || 0,
      trueFreeMinutes: Number(analysis && analysis.trueFreeMinutes) || 0,
      betweenGapCount: Number(analysis && analysis.betweenGapCount) || 0
    };
  }

  function globalDisruptionPenalty(minutes) {
    var n = Number(minutes) || 0;
    if (!(n > 0)) return 0;
    return Math.min(DISRUPTION_CAP, Math.round(n / 15) * 2);
  }

  function globalOverlapPenalty(count) {
    return Math.min(OVERLAP_PENALTY_CAP, (Number(count) || 0) * OVERLAP_ACTION_PENALTY);
  }

  function actionKey(actions) {
    return (actions || []).map(function (row) {
      return String(row.actionId || "");
    }).slice().sort().join(";");
  }

  function compareGlobalPlans(a, b) {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    if (a.globalPlanScore !== b.globalPlanScore) return b.globalPlanScore - a.globalPlanScore;
    if (a.globalGapRecoveredMinutes !== b.globalGapRecoveredMinutes) {
      return b.globalGapRecoveredMinutes - a.globalGapRecoveredMinutes;
    }
    if (a.globalGapRecoveryPercent !== b.globalGapRecoveryPercent) {
      return b.globalGapRecoveryPercent - a.globalGapRecoveryPercent;
    }
    if (a.optimizationDelta !== b.optimizationDelta) return b.optimizationDelta - a.optimizationDelta;
    if (a.fragmentationAfter !== b.fragmentationAfter) return a.fragmentationAfter - b.fragmentationAfter;
    if (a.strandedBetweenGapMinutesAfter !== b.strandedBetweenGapMinutesAfter) {
      return a.strandedBetweenGapMinutesAfter - b.strandedBetweenGapMinutesAfter;
    }
    if (a.totalClientDisruptionMinutes !== b.totalClientDisruptionMinutes) {
      return a.totalClientDisruptionMinutes - b.totalClientDisruptionMinutes;
    }
    if (a.overlapActionCount !== b.overlapActionCount) return a.overlapActionCount - b.overlapActionCount;
    if (a.resolvedGapCount !== b.resolvedGapCount) return b.resolvedGapCount - a.resolvedGapCount;
    var aCount = (a.selectedActions || []).length;
    var bCount = (b.selectedActions || []).length;
    if (aCount !== bCount) return aCount - bCount;
    return actionKey(a.selectedActions).localeCompare(actionKey(b.selectedActions));
  }

  function compareGlobalPlansPrefix(a, b) {
    if (a.globalPlanScore !== b.globalPlanScore) return b.globalPlanScore - a.globalPlanScore;
    if (a.globalGapRecoveredMinutes !== b.globalGapRecoveredMinutes) {
      return b.globalGapRecoveredMinutes - a.globalGapRecoveredMinutes;
    }
    if (a.globalGapRecoveryPercent !== b.globalGapRecoveryPercent) {
      return b.globalGapRecoveryPercent - a.globalGapRecoveryPercent;
    }
    if (a.optimizationDelta !== b.optimizationDelta) return b.optimizationDelta - a.optimizationDelta;
    if (a.fragmentationAfter !== b.fragmentationAfter) return a.fragmentationAfter - b.fragmentationAfter;
    if (a.strandedBetweenGapMinutesAfter !== b.strandedBetweenGapMinutesAfter) {
      return a.strandedBetweenGapMinutesAfter - b.strandedBetweenGapMinutesAfter;
    }
    if (a.totalClientDisruptionMinutes !== b.totalClientDisruptionMinutes) {
      return a.totalClientDisruptionMinutes - b.totalClientDisruptionMinutes;
    }
    if (a.overlapActionCount !== b.overlapActionCount) return a.overlapActionCount - b.overlapActionCount;
    if (a.resolvedGapCount !== b.resolvedGapCount) return b.resolvedGapCount - a.resolvedGapCount;
    return 0;
  }

  function simulateGlobalRecoveryPlan(day, actions) {
    var source = asDay(day);
    var next = copyDay(source);
    var list = Array.isArray(actions) ? actions : [];
    var baseline = baselineConflictMap(source);
    if (!list.length) {
      return { day: next, valid: true, conflictReason: "" };
    }
    var i;
    for (i = 0; i < list.length; i += 1) {
      var action = list[i];
      if (!isActionable(action)) {
        return { day: next, valid: false, conflictReason: "invalid_action" };
      }
      if (action.type === "move_existing_appointment") {
        var sourceLine = findSourceLine(next.occupied, action);
        if (!sourceLine) {
          return { day: next, valid: false, conflictReason: "invalid_source_line" };
        }
        var moved = copyLine(sourceLine);
        next.occupied = next.occupied.filter(function (row) {
          return !sameLine(row, sourceLine);
        });
        moved.startMin = Number(action.proposedStartMin);
        moved.endMin = Number(action.proposedEndMin);
        moved.durationMinutes = moved.endMin - moved.startMin;
        next.occupied.push(moved);
      } else {
        var waitId = waitlistLineId(action);
        next.occupied.push({
          lineId: waitId,
          appointmentId: waitId,
          providerId: trimText(next.providerId),
          startMin: Number(action.candidateStartMin),
          endMin: Number(action.candidateEndMin),
          durationMinutes: (Number(action.candidateEndMin) || 0) - (Number(action.candidateStartMin) || 0),
          status: "scheduled",
          serviceId: trimText(action.serviceId),
          requested: false
        });
      }
    }
    sortOccupied(next.occupied);
    if (newOrWorsenedOverlapConflict(next.occupied, allowedOverlapOf(next), baseline)) {
      return { day: next, valid: false, conflictReason: "new_or_worsened_overlap_conflict" };
    }
    return { day: next, valid: true, conflictReason: "" };
  }

  function gapRecoveriesOf(considered, simulatedDay) {
    return (considered || []).map(function (row) {
      var gap = row.gap;
      var original = Number(gap && gap.gapMin) || 0;
      var recovered = gap
        ? occupiedMinutesInRange(simulatedDay.occupied, gap.startMin, gap.endMin)
        : 0;
      if (recovered > original) recovered = original;
      var percent = original === 0 ? 0 : clampInt(Math.round(100 * recovered / original), 0, 100);
      return {
        gapId: row.gapIdentity,
        originalGapMinutes: original,
        recoveredMinutes: recovered,
        recoveryPercent: percent,
        fullyResolved: original > 0 && recovered === original
      };
    });
  }

  function scoreCombination(day, actions, considered, before, options, extras) {
    var sim = simulateGlobalRecoveryPlan(day, actions);
    if (!sim.valid) return null;
    var afterAnalysis = analyzeDay(sim.day, options);
    var beforeM = snapshotMetrics(before);
    var afterM = snapshotMetrics(afterAnalysis);
    var recoveries = gapRecoveriesOf(considered, sim.day);
    var recoveredMinutes = 0;
    var resolved = 0;
    var partial = 0;
    recoveries.forEach(function (row) {
      recoveredMinutes += row.recoveredMinutes;
      if (row.fullyResolved) resolved += 1;
      else if (row.recoveredMinutes > 0) partial += 1;
    });
    var denom = extras.totalConsideredGapMinutes;
    var percent = denom === 0 ? 0 : clampInt(Math.round(100 * recoveredMinutes / denom), 0, 100);
    var disruption = 0;
    var overlapCount = 0;
    (actions || []).forEach(function (action) {
      if (action.type === "move_existing_appointment") {
        disruption += Number(action.moveMinutes) || 0;
      }
      if (action.usesOverlap) overlapCount += 1;
    });
    var optimizationDelta = afterM.optimizationScore - beforeM.optimizationScore;
    var fragmentationDelta = afterM.fragmentationScore - beforeM.fragmentationScore;
    var strandedDelta = afterM.strandedBetweenGapMinutes - beforeM.strandedBetweenGapMinutes;
    var raw = BASE;
    raw += Math.round(percent * 0.30);
    raw += clampInt(optimizationDelta, -OPT_CLAMP, OPT_CLAMP);
    raw -= clampInt(Math.max(0, fragmentationDelta), 0, FRAG_PENALTY_CAP);
    raw += clampInt(Math.max(0, -fragmentationDelta), 0, FRAG_BONUS_CAP);
    raw -= clampInt(Math.max(0, strandedDelta), 0, STRANDED_PENALTY_CAP);
    raw -= globalDisruptionPenalty(disruption);
    raw -= globalOverlapPenalty(overlapCount);
    return {
      selectedActions: (actions || []).slice(),
      gapRecoveries: recoveries,
      simulatedDay: sim.day,
      before: beforeM,
      after: afterM,
      globalGapRecoveredMinutes: recoveredMinutes,
      globalGapRecoveryPercent: percent,
      resolvedGapCount: resolved,
      partiallyRecoveredGapCount: partial,
      totalClientDisruptionMinutes: disruption,
      overlapActionCount: overlapCount,
      optimizationBefore: beforeM.optimizationScore,
      optimizationAfter: afterM.optimizationScore,
      optimizationDelta: optimizationDelta,
      fragmentationBefore: beforeM.fragmentationScore,
      fragmentationAfter: afterM.fragmentationScore,
      fragmentationDelta: fragmentationDelta,
      strandedBetweenGapMinutesBefore: beforeM.strandedBetweenGapMinutes,
      strandedBetweenGapMinutesAfter: afterM.strandedBetweenGapMinutes,
      strandedBetweenMinutesDelta: strandedDelta,
      utilizationBefore: beforeM.utilizationPercent,
      utilizationAfter: afterM.utilizationPercent,
      trueFreeMinutesBefore: beforeM.trueFreeMinutes,
      trueFreeMinutesAfter: afterM.trueFreeMinutes,
      betweenGapCountBefore: beforeM.betweenGapCount,
      betweenGapCountAfter: afterM.betweenGapCount,
      globalPlanScore: clampScore(raw),
      simplerEquivalent: false
    };
  }

  function collectCandidates(row, maxActions) {
    var seen = {};
    var out = [];
    var dropped = false;
    function take(action) {
      if (!isActionable(action)) return;
      var id = String(action.actionId || "");
      if (!id || seen[id]) return;
      if (out.length >= maxActions) {
        dropped = true;
        return;
      }
      seen[id] = true;
      var copy = cloneValue(action);
      copy.sourceGapIdentity = row.gapIdentity;
      out.push(copy);
    }
    take(row.primaryAction);
    (row.plan && row.plan.alternatives ? row.plan.alternatives : []).forEach(take);
    return { actions: out, dropped: dropped };
  }

  function annotateSelected(action, gapPrimaryId) {
    var copy = cloneValue(action);
    copy.selectedGlobally = true;
    copy.globalSelectionReason = copy.actionId && copy.actionId === gapPrimaryId
      ? "Selected as part of the best compatible provider-day plan."
      : "Selected instead of this gap's independent primary to improve the global plan.";
    return copy;
  }

  function hardConflictsWithSelected(action, selected) {
    return !!hardSetConflicts((selected || []).concat([action]));
  }

  function skipReasonFor(entry, selected, originalDay) {
    if (!entry.actions.length) return "no_qualifying_action";
    var allHard = entry.actions.every(function (action) {
      return hardConflictsWithSelected(action, selected);
    });
    if (allHard) return "conflicts_with_better_global_plan";
    var canAdd = entry.actions.some(function (action) {
      if (hardConflictsWithSelected(action, selected)) return false;
      var sim = simulateGlobalRecoveryPlan(originalDay, selected.concat([action]));
      return !!(sim && sim.valid);
    });
    if (!canAdd) return "conflicts_with_better_global_plan";
    return "lower_global_value";
  }

  function buildReasons(plan, ctx) {
    var reasons = [];
    function add(code, text) {
      reasons.push({ code: code, text: text });
    }
    if (!plan.selectedActions.length) {
      add("no_action_is_best", "No compatible action set beats leaving the provider day unchanged.");
    }
    if (plan.gapRecoveries.filter(function (row) { return row.recoveredMinutes > 0; }).length >= 2) {
      add("recovers_multiple_gaps", "The selected set recovers more than one original between-gap.");
    }
    if (plan.resolvedGapCount > 0) {
      add("fully_resolves_gap", "At least one original between-gap is fully occupied in the final plan.");
    }
    if (plan.fragmentationDelta < 0) {
      add("reduces_day_fragmentation", "The combined plan reduces provider-day fragmentation.");
    }
    if (plan.optimizationDelta > 0) {
      add("improves_day_optimization", "The combined plan improves provider-day optimization.");
    }
    if (ctx.avoidedConflictingMoves) {
      add("avoids_conflicting_moves", "Did not select two incompatible moves of the same appointment.");
    }
    if (ctx.avoidedDuplicateWaitlist) {
      add("avoids_duplicate_waitlist_use", "Used each waitlist request in at most one selected action.");
    }
    if (ctx.limitsDisruption) {
      add("limits_client_disruption", "Preferred a lower booked-client movement set over a more disruptive combination.");
    }
    if (ctx.avoidedOverlap) {
      add("avoids_permitted_overlap", "Avoided a permitted-overlap action when a cleaner compatible set existed.");
    }
    if (plan.simplerEquivalent) {
      add("simpler_equivalent_plan", "Chose the smaller recommendation set among equivalent global outcomes.");
    }
    if (ctx.truncated) {
      add("bounded_search", "Search bounds prevented exhaustive evaluation of every combination.");
    }
    return reasons;
  }

  function runGlobalProviderDaySearch(day, waitlistRequests, options) {
    var api = ns();
    var opts = options && typeof options === "object" ? options : {};
    var dayNorm = asDay(day);
    var maxGaps = optionInt(opts, "maxGaps", DEFAULT_MAX_GAPS);
    var maxActionsPerGap = optionInt(opts, "maxActionsPerGap", DEFAULT_MAX_ACTIONS_PER_GAP);
    var maxEvaluated = optionInt(opts, "maxEvaluatedCombinations", DEFAULT_MAX_EVALUATED);
    var phase8 = typeof api.planProviderDayGapRecoveries === "function"
      ? api.planProviderDayGapRecoveries(dayNorm, waitlistRequests, opts)
      : [];
    var totalBetweenGaps = phase8.length;
    var consideredRows = phase8.slice(0, maxGaps);
    var excludedRows = phase8.slice(maxGaps);
    var considered = [];
    var actionPreselectionTruncated = false;
    consideredRows.forEach(function (row) {
      var collected = collectCandidates(row, maxActionsPerGap);
      if (collected.dropped) actionPreselectionTruncated = true;
      considered.push({
        gap: row.gap,
        gapIdentity: row.gapIdentity || gapIdentityOf(row.gap),
        gapPriorityScore: Number(row.gapPriorityScore) || 0,
        primaryActionId: row.primaryAction && isActionable(row.primaryAction)
          ? String(row.primaryAction.actionId || "")
          : "",
        primaryAction: row.primaryAction,
        actions: collected.actions
      });
    });
    var totalConsideredGapMinutes = 0;
    considered.forEach(function (row) {
      totalConsideredGapMinutes += Number(row.gap && row.gap.gapMin) || 0;
    });
    var before = analyzeDay(dayNorm, opts);
    var evaluated = 0;
    var validCount = 0;
    var rejected = 0;
    var hitCap = false;
    var best = null;
    var sawSimpler = false;
    var validScored = [];

    function considerCombo(actions) {
      if (evaluated >= maxEvaluated) {
        hitCap = true;
        return;
      }
      evaluated += 1;
      if (hardSetConflicts(actions) || (actions.some(function (action) {
        return action.type === "move_existing_appointment" && !findSourceLine(dayNorm.occupied, action);
      }))) {
        rejected += 1;
        return;
      }
      var scored = scoreCombination(dayNorm, actions, considered, before, opts, {
        totalConsideredGapMinutes: totalConsideredGapMinutes
      });
      if (!scored) {
        rejected += 1;
        return;
      }
      validCount += 1;
      validScored.push(scored);
      if (!best) {
        best = scored;
        return;
      }
      if (compareGlobalPlansPrefix(scored, best) === 0
        && (scored.selectedActions || []).length < (best.selectedActions || []).length) {
        scored.simplerEquivalent = true;
        sawSimpler = true;
      }
      if (compareGlobalPlans(scored, best) < 0) {
        if (compareGlobalPlansPrefix(scored, best) === 0
          && (scored.selectedActions || []).length < (best.selectedActions || []).length) {
          scored.simplerEquivalent = true;
          sawSimpler = true;
        }
        best = scored;
      }
    }

    function dfs(index, chosen, choseAny) {
      if (hitCap) return;
      if (index >= considered.length) {
        if (!choseAny) return;
        considerCombo(chosen);
        return;
      }
      var actions = considered[index].actions;
      var i;
      for (i = 0; i < actions.length; i += 1) {
        if (hitCap) return;
        dfs(index + 1, chosen.concat([actions[i]]), true);
      }
      dfs(index + 1, chosen, choseAny);
    }

    considerCombo([]);
    if (evaluated < maxEvaluated) {
      dfs(0, [], false);
    } else if (considered.some(function (row) { return row.actions.length > 0; })) {
      hitCap = true;
    }
    if (!best) {
      best = scoreCombination(dayNorm, [], considered, before, opts, {
        totalConsideredGapMinutes: totalConsideredGapMinutes
      });
      if (best) validScored.push(best);
    }
    if (sawSimpler && best) best.simplerEquivalent = true;
    return {
      dayNorm: dayNorm,
      opts: opts,
      considered: considered,
      excludedRows: excludedRows,
      best: best,
      validScored: validScored,
      evaluated: evaluated,
      validCount: validCount,
      rejected: rejected,
      hitCap: hitCap,
      actionPreselectionTruncated: actionPreselectionTruncated,
      totalBetweenGaps: totalBetweenGaps
    };
  }

  function assembleGlobalPlan(scored, ctx) {
    var dayNorm = ctx.dayNorm;
    var considered = ctx.considered;
    var excludedRows = ctx.excludedRows;
    var selectedByGap = {};
    (scored.selectedActions || []).forEach(function (action) {
      selectedByGap[action.sourceGapIdentity] = action;
    });
    var selectedActions = (scored.selectedActions || []).map(function (action) {
      return annotateSelected(action, (considered.filter(function (row) {
        return row.gapIdentity === action.sourceGapIdentity;
      })[0] || {}).primaryActionId);
    });
    var skippedGaps = excludedRows.map(function (row) {
      return {
        gapId: row.gapIdentity || gapIdentityOf(row.gap),
        gap: row.gap,
        reason: "outside_global_search_limit",
        text: "This between-gap was outside the highest-priority global search limit."
      };
    });
    considered.forEach(function (row) {
      if (selectedByGap[row.gapIdentity]) return;
      var reason = skipReasonFor(row, scored.selectedActions || [], dayNorm);
      skippedGaps.push({
        gapId: row.gapIdentity,
        gap: row.gap,
        reason: reason,
        text: reason === "no_qualifying_action"
          ? "No Phase 8 move or waitlist action qualified for this gap."
          : reason === "conflicts_with_better_global_plan"
            ? "Every qualifying action conflicts with the better global plan."
            : "A qualifying action existed, but skipping this gap produced a better global plan."
      });
    });
    var moveKeys = {};
    var waitlistGaps = {};
    var hadOverlapCandidate = false;
    var primaryDisruption = 0;
    considered.forEach(function (row) {
      row.actions.forEach(function (action) {
        if (action.usesOverlap) hadOverlapCandidate = true;
        if (action.type === "move_existing_appointment") {
          var key = moveResourceKey(action);
          moveKeys[key] = (moveKeys[key] || 0) + 1;
        }
        if (action.type === "fill_from_waitlist") {
          var waitKey = trimText(action.waitlistId);
          if (!waitlistGaps[waitKey]) waitlistGaps[waitKey] = {};
          waitlistGaps[waitKey][row.gapIdentity] = true;
        }
      });
      if (row.primaryAction && row.primaryAction.type === "move_existing_appointment") {
        primaryDisruption += Number(row.primaryAction.moveMinutes) || 0;
      }
    });
    var avoidedConflictingMoves = Object.keys(moveKeys).some(function (key) {
      return moveKeys[key] > 1;
    }) && !hardSetConflicts(selectedActions);
    var avoidedDuplicateWaitlist = Object.keys(waitlistGaps).some(function (key) {
      return Object.keys(waitlistGaps[key]).length > 1;
    });
    var truncated = ctx.hitCap || excludedRows.length > 0 || ctx.actionPreselectionTruncated;
    var reasons = buildReasons(scored, {
      avoidedConflictingMoves: avoidedConflictingMoves,
      avoidedDuplicateWaitlist: avoidedDuplicateWaitlist,
      limitsDisruption: (scored.totalClientDisruptionMinutes || 0) < primaryDisruption
        || (!selectedActions.length && primaryDisruption > 0),
      avoidedOverlap: hadOverlapCandidate && scored.overlapActionCount === 0,
      truncated: truncated
    });
    return {
      providerId: trimText(dayNorm.providerId),
      dateKey: trimText(dayNorm.dateKey),
      isZeroAction: !selectedActions.length,
      consideredGaps: considered.map(function (row, index) {
        var recovery = scored.gapRecoveries[index] || {
          gapId: row.gapIdentity,
          originalGapMinutes: Number(row.gap && row.gap.gapMin) || 0,
          recoveredMinutes: 0,
          recoveryPercent: 0,
          fullyResolved: false
        };
        return {
          gapId: row.gapIdentity,
          gap: row.gap,
          gapPriorityScore: row.gapPriorityScore,
          originalGapMinutes: recovery.originalGapMinutes,
          recoveredMinutes: recovery.recoveredMinutes,
          recoveryPercent: recovery.recoveryPercent,
          fullyResolved: recovery.fullyResolved
        };
      }),
      selectedActions: selectedActions,
      skippedGaps: skippedGaps,
      before: scored.before,
      after: scored.after,
      globalGapRecoveredMinutes: scored.globalGapRecoveredMinutes,
      globalGapRecoveryPercent: scored.globalGapRecoveryPercent,
      resolvedGapCount: scored.resolvedGapCount,
      partiallyRecoveredGapCount: scored.partiallyRecoveredGapCount,
      totalClientDisruptionMinutes: scored.totalClientDisruptionMinutes,
      overlapActionCount: scored.overlapActionCount,
      optimizationBefore: scored.optimizationBefore,
      optimizationAfter: scored.optimizationAfter,
      optimizationDelta: scored.optimizationDelta,
      fragmentationBefore: scored.fragmentationBefore,
      fragmentationAfter: scored.fragmentationAfter,
      fragmentationDelta: scored.fragmentationDelta,
      strandedBetweenGapMinutesBefore: scored.strandedBetweenGapMinutesBefore,
      strandedBetweenGapMinutesAfter: scored.strandedBetweenGapMinutesAfter,
      strandedBetweenMinutesDelta: scored.strandedBetweenMinutesDelta,
      utilizationBefore: scored.utilizationBefore,
      utilizationAfter: scored.utilizationAfter,
      trueFreeMinutesBefore: scored.trueFreeMinutesBefore,
      trueFreeMinutesAfter: scored.trueFreeMinutesAfter,
      betweenGapCountBefore: scored.betweenGapCountBefore,
      betweenGapCountAfter: scored.betweenGapCountAfter,
      globalPlanScore: scored.globalPlanScore,
      searchMetadata: {
        totalBetweenGaps: ctx.totalBetweenGaps,
        consideredGapCount: considered.length,
        excludedGapCount: excludedRows.length,
        evaluatedCombinationCount: ctx.evaluated,
        validCombinationCount: ctx.validCount,
        rejectedConflictCount: ctx.rejected,
        truncated: truncated,
        emptyPlanEvaluated: true,
        exhaustive: !truncated
      },
      reasons: reasons
    };
  }

  function pickRankedScored(validScored, maxPlans) {
    var empty = null;
    var rest = [];
    (validScored || []).forEach(function (row) {
      if (!(row.selectedActions || []).length) {
        if (!empty || compareGlobalPlans(row, empty) < 0) empty = row;
        return;
      }
      rest.push(row);
    });
    rest.sort(compareGlobalPlans);
    var limit = Math.max(1, Number(maxPlans) || 1);
    var chosen = [];
    if (empty) chosen.push(empty);
    rest.forEach(function (row) {
      if (chosen.length >= limit) return;
      chosen.push(row);
    });
    chosen.sort(compareGlobalPlans);
    return chosen;
  }

  function planGlobalProviderDayRecovery(day, waitlistRequests, options) {
    var ctx = runGlobalProviderDaySearch(day, waitlistRequests, options);
    return assembleGlobalPlan(ctx.best, ctx);
  }

  function rankGlobalProviderDayRecoveryCandidates(day, waitlistRequests, options) {
    var opts = options && typeof options === "object" ? options : {};
    var maxPlans = optionInt(opts, "maxPlansPerProvider", 5);
    var ctx = runGlobalProviderDaySearch(day, waitlistRequests, opts);
    return pickRankedScored(ctx.validScored, maxPlans).map(function (scored) {
      return assembleGlobalPlan(scored, ctx);
    });
  }

  var api = ns();
  api.planGlobalProviderDayRecovery = planGlobalProviderDayRecovery;
  api.rankGlobalProviderDayRecoveryCandidates = rankGlobalProviderDayRecoveryCandidates;
  api.simulateGlobalRecoveryPlan = simulateGlobalRecoveryPlan;
  api.compareGlobalPlans = compareGlobalPlans;
  api.GLOBAL_PLAN = {
    BASE: BASE,
    OPT_CLAMP: OPT_CLAMP,
    FRAG_PENALTY_CAP: FRAG_PENALTY_CAP,
    FRAG_BONUS_CAP: FRAG_BONUS_CAP,
    STRANDED_PENALTY_CAP: STRANDED_PENALTY_CAP,
    DISRUPTION_CAP: DISRUPTION_CAP,
    OVERLAP_ACTION_PENALTY: OVERLAP_ACTION_PENALTY,
    OVERLAP_PENALTY_CAP: OVERLAP_PENALTY_CAP,
    DEFAULT_MAX_GAPS: DEFAULT_MAX_GAPS,
    DEFAULT_MAX_ACTIONS_PER_GAP: DEFAULT_MAX_ACTIONS_PER_GAP,
    DEFAULT_MAX_EVALUATED_COMBINATIONS: DEFAULT_MAX_EVALUATED,
    DEFAULT_MAX_PLANS_PER_PROVIDER: 5,
    WAITLIST_LINE_PREFIX: WAITLIST_LINE_PREFIX
  };
})();
