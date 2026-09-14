/**
 * Smart Scheduling Phase 10 — salon-wide recovery plan.
 *
 * Recommendation-only. Coordinates Phase 9 provider-day candidate plans
 * at one location/date. Resolves shared waitlist use. Does not move
 * booked appointments across providers, execute, message, or book.
 *
 * salonPlanScoreRaw =
 *     40
 *   + round(salonGapRecoveryPercent * 0.30)
 *   + clamp(optimizationDeltaAverage, -20, +20)
 *   - clamp(max(0, fragmentationDeltaAverage), 0, 20)
 *   + clamp(max(0, -fragmentationDeltaAverage), 0, 15)
 *   - clamp(max(0, strandedBetweenMinutesDeltaPercent), 0, 15)
 *   - min(30, round(totalClientDisruptionMinutes / 15) * 2)
 *   - min(20, totalOverlapActionCount * 5)
 *
 * salonPlanScore = clamp(0, 100, salonPlanScoreRaw)
 *
 * Do not sum provider globalPlanScore values.
 *
 * Salon recovery uses ALL original kind === "between" gaps on every
 * input ProviderDay, not Phase 9 considered-gap subsets. Search limits
 * do not shrink the denominator.
 */
(function () {
  var BASE = 40;
  var OPT_CLAMP = 20;
  var FRAG_PENALTY_CAP = 20;
  var FRAG_BONUS_CAP = 15;
  var STRANDED_PENALTY_CAP = 15;
  var DISRUPTION_CAP = 30;
  var OVERLAP_ACTION_PENALTY = 5;
  var OVERLAP_PENALTY_CAP = 20;
  var DEFAULT_MAX_PROVIDERS = 8;
  var DEFAULT_MAX_PLANS = 5;
  var DEFAULT_MAX_EVALUATED = 10000;

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
        workingMinutes: 0,
        occupiedMinutes: 0,
        utilizationPercent: 0,
        optimizationScore: 0,
        fragmentationScore: 0,
        strandedBetweenGapMinutes: 0,
        totalBetweenGapMinutes: 0
      };
    }
    return api.analyzeProviderDay(day, options);
  }

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function consideredGapMinutes(plan) {
    var total = 0;
    ((plan && plan.consideredGaps) || []).forEach(function (row) {
      total += Number(row && row.originalGapMinutes) || 0;
    });
    return total;
  }

  function gapIdentityOf(gap) {
    var api = ns();
    if (typeof api.gapIdentity === "function") return api.gapIdentity(gap);
    if (!gap) return "";
    return [gap.workingIntervalIndex, gap.startMin, gap.endMin].join("|");
  }

  function originalBetweenGaps(day) {
    var api = ns();
    var gaps = typeof api.findFreeGaps === "function" ? api.findFreeGaps(day) : [];
    return (gaps || []).filter(function (gap) { return gap && gap.kind === "between"; });
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

  function recoverOriginalGaps(providerId, gaps, simulatedDay) {
    return (gaps || []).map(function (gap) {
      var original = Number(gap && gap.gapMin) || 0;
      var recovered = simulatedDay && simulatedDay.occupied
        ? occupiedMinutesInRange(simulatedDay.occupied, gap.startMin, gap.endMin)
        : 0;
      if (recovered > original) recovered = original;
      var percent = original === 0 ? 0 : clampInt(Math.round(100 * recovered / original), 0, 100);
      return {
        providerId: providerId,
        gapId: gapIdentityOf(gap),
        originalGapMinutes: original,
        recoveredMinutes: recovered,
        recoveryPercent: percent,
        fullyResolved: original > 0 && recovered === original
      };
    });
  }

  function gapPriorityAggregate(plan) {
    var total = 0;
    ((plan && plan.consideredGaps) || []).forEach(function (row) {
      total += Number(row && row.gapPriorityScore) || 0;
    });
    return total;
  }

  function actionIdsOf(plan) {
    return ((plan && plan.selectedActions) || []).map(function (row) {
      return String(row.actionId || "");
    }).slice().sort();
  }

  function providerPlanKey(plan) {
    return trimText(plan && plan.providerId) + ":" + actionIdsOf(plan).join(",");
  }

  function salonSelectionKey(plans) {
    return (plans || []).slice().sort(function (a, b) {
      return trimText(a.providerId).localeCompare(trimText(b.providerId));
    }).map(providerPlanKey).join("|");
  }

  function waitlistIdsOf(plan) {
    var ids = [];
    ((plan && plan.selectedActions) || []).forEach(function (row) {
      if (row && row.type === "fill_from_waitlist" && trimText(row.waitlistId)) {
        ids.push(trimText(row.waitlistId));
      }
    });
    return ids;
  }

  function salonHardConflicts(plans) {
    var seenWait = {};
    var seenAction = {};
    var i;
    var j;
    for (i = 0; i < (plans || []).length; i += 1) {
      var plan = plans[i];
      if (!plan) return "invalid_provider_plan";
      var waits = waitlistIdsOf(plan);
      for (j = 0; j < waits.length; j += 1) {
        if (seenWait[waits[j]]) return "same_waitlist_used_twice";
        seenWait[waits[j]] = true;
      }
      var ids = actionIdsOf(plan);
      for (j = 0; j < ids.length; j += 1) {
        if (!ids[j]) continue;
        if (seenAction[ids[j]]) return "duplicate_action";
        seenAction[ids[j]] = true;
      }
    }
    return "";
  }

  function compareSalonPlans(a, b) {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    if (a.salonPlanScore !== b.salonPlanScore) return b.salonPlanScore - a.salonPlanScore;
    if (a.totalGapRecoveredMinutes !== b.totalGapRecoveredMinutes) {
      return b.totalGapRecoveredMinutes - a.totalGapRecoveredMinutes;
    }
    if (a.salonGapRecoveryPercent !== b.salonGapRecoveryPercent) {
      return b.salonGapRecoveryPercent - a.salonGapRecoveryPercent;
    }
    if (a.optimizationDeltaTotal !== b.optimizationDeltaTotal) {
      return b.optimizationDeltaTotal - a.optimizationDeltaTotal;
    }
    if (a.fragmentationAfterTotal !== b.fragmentationAfterTotal) {
      return a.fragmentationAfterTotal - b.fragmentationAfterTotal;
    }
    if (a.strandedBetweenGapMinutesAfterTotal !== b.strandedBetweenGapMinutesAfterTotal) {
      return a.strandedBetweenGapMinutesAfterTotal - b.strandedBetweenGapMinutesAfterTotal;
    }
    if (a.totalClientDisruptionMinutes !== b.totalClientDisruptionMinutes) {
      return a.totalClientDisruptionMinutes - b.totalClientDisruptionMinutes;
    }
    if (a.totalOverlapActionCount !== b.totalOverlapActionCount) {
      return a.totalOverlapActionCount - b.totalOverlapActionCount;
    }
    if (a.resolvedGapCount !== b.resolvedGapCount) return b.resolvedGapCount - a.resolvedGapCount;
    if (a.totalSelectedActionCount !== b.totalSelectedActionCount) {
      return a.totalSelectedActionCount - b.totalSelectedActionCount;
    }
    return String(a.selectionKey || "").localeCompare(String(b.selectionKey || ""));
  }

  function scoreSalonCombination(entries, selectedByProvider) {
    var providerCount = entries.length;
    var recovered = 0;
    var original = 0;
    var considered = 0;
    var resolved = 0;
    var partial = 0;
    var gapRecoveries = [];
    var disruption = 0;
    var overlapCount = 0;
    var optBefore = 0;
    var optAfter = 0;
    var fragBefore = 0;
    var fragAfter = 0;
    var strandedBefore = 0;
    var strandedAfter = 0;
    var working = 0;
    var occupiedBefore = 0;
    var occupiedAfter = 0;
    var actionCount = 0;
    var active = 0;
    var selected = [];
    entries.forEach(function (entry) {
      var plan = selectedByProvider[entry.providerId];
      selected.push(plan);
      var simulated = entry.simulatedDayByPlan[providerPlanKey(plan)] || entry.day;
      var recoveries = recoverOriginalGaps(entry.providerId, entry.originalGaps, simulated);
      recoveries.forEach(function (row) {
        gapRecoveries.push(row);
        original += row.originalGapMinutes;
        recovered += row.recoveredMinutes;
        if (row.fullyResolved) resolved += 1;
        else if (row.recoveredMinutes > 0) partial += 1;
      });
      considered += consideredGapMinutes(plan);
      disruption += Number(plan.totalClientDisruptionMinutes) || 0;
      overlapCount += Number(plan.overlapActionCount) || 0;
      optBefore += Number(plan.optimizationBefore) || 0;
      optAfter += Number(plan.optimizationAfter) || 0;
      fragBefore += Number(plan.fragmentationBefore) || 0;
      fragAfter += Number(plan.fragmentationAfter) || 0;
      strandedBefore += Number(plan.strandedBetweenGapMinutesBefore) || 0;
      strandedAfter += Number(plan.strandedBetweenGapMinutesAfter) || 0;
      working += Number(entry.workingMinutes) || 0;
      occupiedBefore += Number(entry.occupiedMinutes) || 0;
      occupiedAfter += Number(entry.afterOccupiedByPlan[providerPlanKey(plan)]) || 0;
      actionCount += (plan.selectedActions || []).length;
      if ((plan.selectedActions || []).length) active += 1;
    });
    var percent = original === 0 ? 0 : clampInt(Math.round(100 * recovered / original), 0, 100);
    var optDelta = optAfter - optBefore;
    var fragDelta = fragAfter - fragBefore;
    var strandedDelta = strandedAfter - strandedBefore;
    var optAvg = providerCount === 0 ? 0 : Math.round(optDelta / providerCount);
    var fragAvg = providerCount === 0 ? 0 : Math.round(fragDelta / providerCount);
    var strandedPct = working === 0 ? 0 : Math.round(100 * strandedDelta / working);
    var utilBefore = working === 0 ? 0 : Math.round(100 * occupiedBefore / working);
    var utilAfter = working === 0 ? 0 : Math.round(100 * occupiedAfter / working);
    var disruptionPenalty = Math.min(DISRUPTION_CAP, Math.round((disruption || 0) / 15) * 2);
    var overlapPenalty = Math.min(OVERLAP_PENALTY_CAP, overlapCount * OVERLAP_ACTION_PENALTY);
    var raw = BASE;
    raw += Math.round(percent * 0.30);
    raw += clampInt(optAvg, -OPT_CLAMP, OPT_CLAMP);
    raw -= clampInt(Math.max(0, fragAvg), 0, FRAG_PENALTY_CAP);
    raw += clampInt(Math.max(0, -fragAvg), 0, FRAG_BONUS_CAP);
    raw -= clampInt(Math.max(0, strandedPct), 0, STRANDED_PENALTY_CAP);
    raw -= disruptionPenalty;
    raw -= overlapPenalty;
    return {
      selectedProviderPlans: selected,
      selectionKey: salonSelectionKey(selected),
      totalOriginalBetweenGapMinutes: original,
      searchConsideredBetweenGapMinutes: considered,
      totalGapRecoveredMinutes: recovered,
      salonGapRecoveryPercent: percent,
      originalGapRecoveries: gapRecoveries,
      resolvedGapCount: resolved,
      partiallyRecoveredGapCount: partial,
      totalClientDisruptionMinutes: disruption,
      totalOverlapActionCount: overlapCount,
      totalSelectedActionCount: actionCount,
      activeProviderPlanCount: active,
      optimizationBeforeTotal: optBefore,
      optimizationAfterTotal: optAfter,
      optimizationDeltaTotal: optDelta,
      optimizationDeltaAverage: optAvg,
      fragmentationBeforeTotal: fragBefore,
      fragmentationAfterTotal: fragAfter,
      fragmentationDeltaTotal: fragDelta,
      fragmentationDeltaAverage: fragAvg,
      strandedBetweenGapMinutesBeforeTotal: strandedBefore,
      strandedBetweenGapMinutesAfterTotal: strandedAfter,
      strandedBetweenMinutesDeltaTotal: strandedDelta,
      strandedBetweenMinutesDeltaPercent: strandedPct,
      utilizationBeforeWeighted: utilBefore,
      utilizationAfterWeighted: utilAfter,
      totalWorkingMinutes: working,
      salonPlanScore: clampScore(raw)
    };
  }

  function compareProviderInclusion(a, b) {
    if (b.betweenGapMinutes !== a.betweenGapMinutes) return b.betweenGapMinutes - a.betweenGapMinutes;
    if (b.priorityAggregate !== a.priorityAggregate) return b.priorityAggregate - a.priorityAggregate;
    return String(a.providerId || "").localeCompare(String(b.providerId || ""));
  }

  function rankProviderCandidates(day, waitlistRequests, options) {
    var api = ns();
    if (typeof api.rankGlobalProviderDayRecoveryCandidates === "function") {
      return api.rankGlobalProviderDayRecoveryCandidates(day, waitlistRequests, options);
    }
    var winner = typeof api.planGlobalProviderDayRecovery === "function"
      ? api.planGlobalProviderDayRecovery(day, waitlistRequests, options)
      : null;
    return winner ? [winner] : [];
  }

  function simulatePlanDay(day, plan, options) {
    var api = ns();
    var sim = typeof api.simulateGlobalRecoveryPlan === "function"
      ? api.simulateGlobalRecoveryPlan(day, plan && plan.selectedActions)
      : { day: day, valid: true };
    var simulated = sim.day || day;
    var analysis = analyzeDay(simulated, options);
    return {
      day: simulated,
      occupiedMinutes: Number(analysis.occupiedMinutes) || 0
    };
  }

  function buildReasons(scored, ctx) {
    var reasons = [];
    function add(code, text) {
      reasons.push({ code: code, text: text });
    }
    if (!scored.activeProviderPlanCount) {
      add("no_action_is_best", "No compatible salon-wide action set beats the all-provider baseline.");
    }
    var recoveredProviders = (scored.selectedProviderPlans || []).filter(function (plan) {
      return (Number(plan.globalGapRecoveredMinutes) || 0) > 0;
    }).length;
    if (recoveredProviders >= 2) {
      add("recovers_gaps_across_providers", "Selected plans recover between-gaps on more than one provider.");
    }
    if (ctx.avoidedDuplicateWaitlist) {
      add("avoids_duplicate_waitlist_use", "Used each waitlist request in at most one selected salon action.");
    }
    if (ctx.usedAlternative) {
      add("uses_provider_alternative_for_global_fit", "Chose a non-local Phase 9 winner so a shared resource could be used elsewhere.");
    }
    if (scored.fragmentationDeltaTotal < 0) {
      add("reduces_salon_fragmentation", "The salon combination reduces total provider-day fragmentation.");
    }
    if (scored.optimizationDeltaTotal > 0) {
      add("improves_salon_optimization", "The salon combination improves total provider-day optimization.");
    }
    if (ctx.limitsDisruption) {
      add("limits_total_client_disruption", "Preferred a lower booked-client movement set over a more disruptive salon combination.");
    }
    if (ctx.avoidedDuplicateWaitlist) {
      add("avoids_cross_provider_resource_conflict", "Did not assign the same waitlist request to more than one provider.");
    }
    if (ctx.truncated) {
      add("bounded_salon_search", "Salon search bounds prevented exhaustive evaluation of every combination.");
    }
    return reasons;
  }

  function invalidSalonPlan(reason, extras) {
    return Object.assign({
      valid: false,
      reason: reason,
      providerCount: 0,
      optimizedProviderCount: 0,
      baselineOnlyProviderCount: 0,
      activeProviderPlanCount: 0,
      selectedProviderPlans: [],
      skippedProviderPlans: [],
      salonPlanScore: 0,
      reasons: [{ code: "invalid_input", text: reason === "mixed_location_or_date"
        ? "Provider days must share one location and date."
        : "No valid salon-wide recovery plan." }],
      searchMetadata: {
        totalProviderCount: 0,
        consideredProviderCount: 0,
        baselineOnlyProviderCount: 0,
        maxProviders: DEFAULT_MAX_PROVIDERS,
        maxPlansPerProvider: DEFAULT_MAX_PLANS,
        maxEvaluatedSalonCombinations: DEFAULT_MAX_EVALUATED,
        evaluatedCombinationCount: 0,
        validCombinationCount: 0,
        rejectedConflictCount: 0,
        zeroActionSalonPlanEvaluated: false,
        truncated: false,
        exhaustive: false
      }
    }, extras || {});
  }

  function planSalonWideRecovery(providerDays, waitlistRequests, options) {
    var opts = options && typeof options === "object" ? options : {};
    var maxProviders = optionInt(opts, "maxProviders", DEFAULT_MAX_PROVIDERS);
    var maxPlans = optionInt(opts, "maxPlansPerProvider", DEFAULT_MAX_PLANS);
    var maxEvaluated = optionInt(opts, "maxEvaluatedSalonCombinations", DEFAULT_MAX_EVALUATED);
    var rawDays = Array.isArray(providerDays) ? providerDays : [];
    var days = rawDays.map(asDay);
    if (!days.length) {
      return invalidSalonPlan("no_providers", { valid: true, reason: "", salonPlanScore: 40 });
    }
    var locationId = trimText(days[0].locationId);
    var dateKey = trimText(days[0].dateKey);
    var mixed = days.some(function (day) {
      return trimText(day.locationId) !== locationId || trimText(day.dateKey) !== dateKey;
    });
    if (mixed) return invalidSalonPlan("mixed_location_or_date", { providerCount: days.length });

    var rankOpts = Object.assign({}, opts, { maxPlansPerProvider: maxPlans });
    var entries = days.map(function (day) {
      var analysis = analyzeDay(day, opts);
      var candidates = rankProviderCandidates(day, waitlistRequests, rankOpts);
      if (!candidates.length) {
        candidates = [ns().planGlobalProviderDayRecovery(day, waitlistRequests, rankOpts)];
      }
      var zero = null;
      var actionPlans = [];
      candidates.forEach(function (plan) {
        if ((plan.selectedActions || []).length) actionPlans.push(plan);
        else if (!zero) zero = plan;
      });
      if (!zero) zero = candidates[candidates.length - 1];
      var afterOccupiedByPlan = {};
      var simulatedDayByPlan = {};
      candidates.forEach(function (plan) {
        var simulated = simulatePlanDay(day, plan, opts);
        var key = providerPlanKey(plan);
        afterOccupiedByPlan[key] = simulated.occupiedMinutes;
        simulatedDayByPlan[key] = simulated.day;
      });
      var originalGaps = originalBetweenGaps(day);
      var phase9Truncated = candidates.some(function (plan) {
        return !!(plan.searchMetadata && plan.searchMetadata.truncated);
      });
      var validPhase9 = Number(zero && zero.searchMetadata && zero.searchMetadata.validCombinationCount) || candidates.length;
      return {
        day: day,
        providerId: trimText(day.providerId),
        workingMinutes: Number(analysis.workingMinutes) || 0,
        occupiedMinutes: Number(analysis.occupiedMinutes) || 0,
        originalGaps: originalGaps,
        betweenGapMinutes: Number(analysis.totalBetweenGapMinutes) || 0,
        priorityAggregate: gapPriorityAggregate(zero || candidates[0]),
        candidates: candidates,
        actionPlans: actionPlans,
        zeroPlan: zero,
        afterOccupiedByPlan: afterOccupiedByPlan,
        simulatedDayByPlan: simulatedDayByPlan,
        phase9Truncated: phase9Truncated,
        candidateTruncated: validPhase9 > candidates.length
      };
    });

    entries.sort(compareProviderInclusion);
    var considered = entries.slice(0, maxProviders);
    var baselineOnly = entries.slice(maxProviders);
    considered.sort(function (a, b) {
      return String(a.providerId || "").localeCompare(String(b.providerId || ""));
    });

    var evaluated = 0;
    var validCount = 0;
    var rejected = 0;
    var hitCap = false;
    var best = null;
    var usedAlternative = false;
    var avoidedDuplicateWaitlist = entries.some(function (entry) {
      var seen = {};
      return entry.actionPlans.some(function (plan) {
        return waitlistIdsOf(plan).some(function (id) {
          if (seen[id]) return false;
          seen[id] = true;
          return entries.some(function (other) {
            return other.providerId !== entry.providerId && other.actionPlans.some(function (row) {
              return waitlistIdsOf(row).indexOf(id) !== -1;
            });
          });
        });
      });
    });

    function selectionFromIndexes(indexes) {
      var map = {};
      entries.forEach(function (entry) {
        map[entry.providerId] = entry.zeroPlan;
      });
      considered.forEach(function (entry, idx) {
        var options = entry.actionPlans.concat([entry.zeroPlan]);
        map[entry.providerId] = options[indexes[idx]] || entry.zeroPlan;
      });
      return map;
    }

    function consider(indexes) {
      if (evaluated >= maxEvaluated) {
        hitCap = true;
        return;
      }
      evaluated += 1;
      var selectedMap = selectionFromIndexes(indexes);
      var selected = entries.map(function (entry) { return selectedMap[entry.providerId]; });
      if (salonHardConflicts(selected)) {
        rejected += 1;
        return;
      }
      var scored = scoreSalonCombination(entries, selectedMap);
      validCount += 1;
      if (!best || compareSalonPlans(scored, best) < 0) {
        if (best && scored.totalClientDisruptionMinutes < best.totalClientDisruptionMinutes) {
          scored.limitsDisruption = true;
        }
        var choseAlt = considered.some(function (entry) {
          var chosen = selectedMap[entry.providerId];
          var localBest = entry.actionPlans[0];
          return !!(localBest && chosen && chosen !== localBest && chosen !== entry.zeroPlan
            && (chosen.selectedActions || []).length);
        });
        if (choseAlt) usedAlternative = true;
        best = scored;
      }
    }

    function dfs(index, indexes, choseAction) {
      if (hitCap) return;
      if (index >= considered.length) {
        if (!choseAction) return;
        consider(indexes);
        return;
      }
      var entry = considered[index];
      var actionCount = entry.actionPlans.length;
      var i;
      for (i = 0; i < actionCount; i += 1) {
        if (hitCap) return;
        dfs(index + 1, indexes.concat([i]), true);
      }
      dfs(index + 1, indexes.concat([actionCount]), choseAction);
    }

    consider(considered.map(function (entry) { return entry.actionPlans.length; }));
    if (evaluated < maxEvaluated && considered.length) {
      dfs(0, [], false);
    } else if (considered.some(function (entry) { return entry.actionPlans.length > 0; })) {
      hitCap = true;
    }

    if (!best) {
      best = scoreSalonCombination(entries, selectionFromIndexes(considered.map(function () {
        return 0;
      })));
    }

    var phase9Truncated = entries.some(function (entry) { return entry.phase9Truncated; });
    var candidateTruncated = entries.some(function (entry) { return entry.candidateTruncated; });
    var truncated = hitCap || baselineOnly.length > 0 || phase9Truncated || candidateTruncated;
    var localWinnersUseSharedWaitlist = avoidedDuplicateWaitlist;
    var reasons = buildReasons(best, {
      avoidedDuplicateWaitlist: localWinnersUseSharedWaitlist,
      usedAlternative: usedAlternative,
      limitsDisruption: !!best.limitsDisruption,
      truncated: truncated
    });

    var skipped = [];
    baselineOnly.forEach(function (entry) {
      skipped.push({
        providerId: entry.providerId,
        reason: "outside_salon_search_limit",
        text: "This provider stayed on the zero-action baseline because of the salon provider limit.",
        plan: entry.zeroPlan
      });
    });
    considered.forEach(function (entry) {
      var chosen = (best.selectedProviderPlans || []).filter(function (plan) {
        return plan.providerId === entry.providerId;
      })[0];
      if (chosen && (chosen.selectedActions || []).length) return;
      skipped.push({
        providerId: entry.providerId,
        reason: (entry.actionPlans || []).length ? "lower_salon_value" : "no_qualifying_action",
        text: (entry.actionPlans || []).length
          ? "A qualifying provider-day plan existed, but the salon search kept this provider at baseline."
          : "No qualifying Phase 9 recovery actions were available for this provider.",
        plan: entry.zeroPlan
      });
    });

    return {
      valid: true,
      reason: "",
      locationId: locationId,
      dateKey: dateKey,
      providerCount: entries.length,
      optimizedProviderCount: considered.length,
      baselineOnlyProviderCount: baselineOnly.length,
      activeProviderPlanCount: best.activeProviderPlanCount,
      selectedProviderPlans: (best.selectedProviderPlans || []).map(cloneValue),
      skippedProviderPlans: skipped,
      totalOriginalBetweenGapMinutes: best.totalOriginalBetweenGapMinutes,
      searchConsideredBetweenGapMinutes: best.searchConsideredBetweenGapMinutes,
      totalGapRecoveredMinutes: best.totalGapRecoveredMinutes,
      salonGapRecoveryPercent: best.salonGapRecoveryPercent,
      originalGapRecoveries: best.originalGapRecoveries,
      resolvedGapCount: best.resolvedGapCount,
      partiallyRecoveredGapCount: best.partiallyRecoveredGapCount,
      totalClientDisruptionMinutes: best.totalClientDisruptionMinutes,
      totalOverlapActionCount: best.totalOverlapActionCount,
      optimizationBeforeTotal: best.optimizationBeforeTotal,
      optimizationAfterTotal: best.optimizationAfterTotal,
      optimizationDeltaTotal: best.optimizationDeltaTotal,
      fragmentationBeforeTotal: best.fragmentationBeforeTotal,
      fragmentationAfterTotal: best.fragmentationAfterTotal,
      fragmentationDeltaTotal: best.fragmentationDeltaTotal,
      strandedBetweenGapMinutesBeforeTotal: best.strandedBetweenGapMinutesBeforeTotal,
      strandedBetweenGapMinutesAfterTotal: best.strandedBetweenGapMinutesAfterTotal,
      strandedBetweenMinutesDeltaTotal: best.strandedBetweenMinutesDeltaTotal,
      utilizationBeforeWeighted: best.utilizationBeforeWeighted,
      utilizationAfterWeighted: best.utilizationAfterWeighted,
      totalWorkingMinutes: best.totalWorkingMinutes,
      salonPlanScore: best.salonPlanScore,
      searchMetadata: {
        totalProviderCount: entries.length,
        consideredProviderCount: considered.length,
        baselineOnlyProviderCount: baselineOnly.length,
        maxProviders: maxProviders,
        maxPlansPerProvider: maxPlans,
        maxEvaluatedSalonCombinations: maxEvaluated,
        evaluatedCombinationCount: evaluated,
        validCombinationCount: validCount,
        rejectedConflictCount: rejected,
        zeroActionSalonPlanEvaluated: true,
        truncated: truncated,
        exhaustive: !truncated
      },
      reasons: reasons
    };
  }

  var api = ns();
  api.planSalonWideRecovery = planSalonWideRecovery;
  api.compareSalonPlans = compareSalonPlans;
  api.SALON_PLAN = {
    BASE: BASE,
    OPT_CLAMP: OPT_CLAMP,
    FRAG_PENALTY_CAP: FRAG_PENALTY_CAP,
    FRAG_BONUS_CAP: FRAG_BONUS_CAP,
    STRANDED_PENALTY_CAP: STRANDED_PENALTY_CAP,
    DISRUPTION_CAP: DISRUPTION_CAP,
    OVERLAP_ACTION_PENALTY: OVERLAP_ACTION_PENALTY,
    OVERLAP_PENALTY_CAP: OVERLAP_PENALTY_CAP,
    DEFAULT_MAX_PROVIDERS: DEFAULT_MAX_PROVIDERS,
    DEFAULT_MAX_PLANS_PER_PROVIDER: DEFAULT_MAX_PLANS,
    DEFAULT_MAX_EVALUATED_SALON_COMBINATIONS: DEFAULT_MAX_EVALUATED
  };
})();
