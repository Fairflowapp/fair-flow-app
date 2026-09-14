/**
 * Smart Scheduling Phase 14 — flexible visit orchestration.
 *
 * Recommendation-only. Reordering and bounded client waits participate
 * during search. Service lines stay atomic (one provider, uninterrupted).
 * Parallel blocks stay atomic. No-flex requests wrap Phase 13.
 *
 * flexibleVisitPlanScoreRaw =
 *     Phase 12/13 operational structure
 *   - clientWaitPenalty
 *
 * clientWaitPenalty = min(20, round(totalClientWaitMinutes / 5) * 2)
 * parallelMinutesSaved = sumServiceMinutes - serviceExecutionElapsedMinutes
 */
(function () {
  var BASE = 50;
  var SLOT_FIT_CLAMP = 20;
  var OPT_CLAMP = 20;
  var FRAG_PENALTY_CAP = 20;
  var FRAG_BONUS_CAP = 15;
  var STRANDED_PENALTY_CAP = 15;
  var OVERLAP_ACTION_PENALTY = 5;
  var OVERLAP_PENALTY_CAP = 20;
  var EFFICIENCY_CAP = 15;
  var WAIT_PENALTY_CAP = 20;
  var DEFAULT_SNAP = 15;
  var DEFAULT_WAIT_SNAP = 5;
  var DEFAULT_MAX_LINES = 4;
  var DEFAULT_MAX_PARALLEL = 3;
  var DEFAULT_MAX_PROVIDERS = 5;
  var DEFAULT_MAX_RESOURCES = 5;
  var DEFAULT_MAX_REQUIREMENTS = 2;
  var DEFAULT_MAX_PERMS = 24;
  var DEFAULT_MAX_STARTS = 40;
  var DEFAULT_MAX_WAITS = 7;
  var DEFAULT_MAX_BLOCK = 150;
  var DEFAULT_MAX_EVALUATED = 10000;
  var DEFAULT_MAX_RETURNED = 10;

  function ns() {
    return window.ffBookingSmartScheduling || (window.ffBookingSmartScheduling = {});
  }

  function p12() {
    return ns().PHASE12_INTERNALS || {};
  }

  function p13() {
    return ns().PHASE13_INTERNALS || {};
  }

  function helpers() {
    return ns().helpers || {};
  }

  function trimText(value) {
    var h = helpers();
    return h.trimText ? h.trimText(value) : String(value == null ? "" : value).trim();
  }

  function optionInt(opts, key, fallback) {
    if (p12().optionInt) return p12().optionInt(opts, key, fallback);
    if (!opts || opts[key] == null || opts[key] === "") return fallback;
    var n = Math.round(Number(opts[key]));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function optionNonNeg(obj, key, fallback) {
    if (!obj || obj[key] == null || obj[key] === "") return fallback;
    var n = Math.round(Number(obj[key]));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  function optionMin(obj, key) {
    if (!obj || obj[key] == null || obj[key] === "") return null;
    var n = Number(obj[key]);
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  function flagOf(req, opts, key) {
    return (req && req[key] === true) || (opts && opts[key] === true);
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
    return typeof api.clampScore === "function" ? api.clampScore(value) : clampInt(value, 0, 100);
  }

  function clientWaitPenaltyOf(minutes) {
    return Math.min(WAIT_PENALTY_CAP, Math.round((Number(minutes) || 0) / 5) * 2);
  }

  function efficiencyBonus(saved) {
    return Math.min(EFFICIENCY_CAP, Math.round((Number(saved) || 0) / 15) * 2);
  }

  function timePreferenceBonus(visitStartMin, preferred) {
    if (preferred == null) return 0;
    var distance = Math.abs(visitStartMin - preferred);
    if (distance === 0) return 10;
    if (distance <= 15) return 7;
    if (distance <= 30) return 4;
    return 1;
  }

  function assignmentKey(lines) {
    return (lines || []).map(function (row) {
      return String(row.lineKey || "") + "|" + String(row.providerId || "");
    }).join("||");
  }

  function orderDistanceOf(sourceIndexes) {
    var inv = 0;
    var i;
    var j;
    for (i = 0; i < sourceIndexes.length; i += 1) {
      for (j = i + 1; j < sourceIndexes.length; j += 1) {
        if (sourceIndexes[i] > sourceIndexes[j]) inv += 1;
      }
    }
    return inv;
  }

  function permute(list) {
    if (list.length <= 1) return [list.slice()];
    var out = [];
    list.forEach(function (item, idx) {
      permute(list.slice(0, idx).concat(list.slice(idx + 1))).forEach(function (rest) {
        out.push([item].concat(rest));
      });
    });
    return out;
  }

  function waitCandidates(maxBetween, remaining, snap, maxCands, allowWait) {
    if (!allowWait) return { waits: [0], truncated: false };
    var limit = Math.min(maxBetween, remaining);
    var out = [];
    var cut = false;
    var wait = 0;
    while (wait <= limit) {
      if (out.length >= maxCands) {
        cut = true;
        break;
      }
      out.push(wait);
      if (!(snap > 0)) break;
      wait += snap;
    }
    return { waits: out, truncated: cut };
  }

  function analyzeDay(day, options) {
    var api = ns();
    if (typeof api.analyzeProviderDay !== "function") {
      return {
        workingMinutes: 0,
        occupiedMinutes: 0,
        optimizationScore: 0,
        fragmentationScore: 0,
        strandedBetweenGapMinutes: 0
      };
    }
    return api.analyzeProviderDay(day, options);
  }

  function allowedOverlapOf(day) {
    var h = helpers();
    var raw = day && day.allowedOverlapMinutes;
    return h.normalizeAllowedOverlap ? h.normalizeAllowedOverlap(raw) : (Number(raw) || 0);
  }

  function worsensOverlap(occupied, allowed, day) {
    var api = ns();
    if (typeof api.newOrWorsenedOverlapConflict !== "function") return false;
    var baseline = typeof api.baselineConflictMap === "function" ? api.baselineConflictMap(day) : {};
    return api.newOrWorsenedOverlapConflict(occupied, allowed, baseline);
  }

  function emptyMetadata(lines, blocks, opts, extras) {
    return Object.assign({
      serviceLineCount: (lines || []).length,
      blockCount: (blocks || []).length,
      orderPermutationCount: 0,
      visitStartCandidateCount: 0,
      waitCandidatesEvaluated: 0,
      providerCandidatesByLine: (lines || []).map(function () { return 0; }),
      resourceCandidatesByRequirement: [],
      evaluatedBlockAssignments: 0,
      evaluatedVisitPlans: 0,
      maxServiceLines: optionInt(opts, "maxServiceLines", DEFAULT_MAX_LINES),
      maxParallelLinesPerBlock: optionInt(opts, "maxParallelLinesPerBlock", DEFAULT_MAX_PARALLEL),
      maxProvidersPerLine: optionInt(opts, "maxProvidersPerLine", DEFAULT_MAX_PROVIDERS),
      maxResourcesPerRequirement: optionInt(opts, "maxResourcesPerRequirement", DEFAULT_MAX_RESOURCES),
      maxResourceRequirementsPerLine: optionInt(opts, "maxResourceRequirementsPerLine", DEFAULT_MAX_REQUIREMENTS),
      maxOrderPermutations: optionInt(opts, "maxOrderPermutations", DEFAULT_MAX_PERMS),
      maxVisitStartCandidates: optionInt(opts, "maxVisitStartCandidates", DEFAULT_MAX_STARTS),
      maxWaitCandidatesPerTransition: optionInt(opts, "maxWaitCandidatesPerTransition", DEFAULT_MAX_WAITS),
      maxBlockAssignments: optionInt(opts, "maxBlockAssignments", DEFAULT_MAX_BLOCK),
      maxEvaluatedVisitPlans: optionInt(opts, "maxEvaluatedVisitPlans", DEFAULT_MAX_EVALUATED),
      truncated: false,
      exhaustive: false
    }, extras || {});
  }

  function invalidPlan(reason, days, lines, blocks, opts) {
    var first = days && days[0];
    return {
      valid: false,
      reason: reason,
      dateKey: trimText(first && first.dateKey),
      locationId: trimText(first && first.locationId),
      blocks: [],
      serviceLines: [],
      flexibleVisitPlanScore: 0,
      reasons: [],
      searchMetadata: emptyMetadata(lines || [], blocks || [], opts)
    };
  }

  function addReason(reasons, seen, code, text) {
    if (seen[code]) return;
    seen[code] = true;
    reasons.push({ code: code, text: text });
  }

  function buildReasons(plan, flags) {
    var reasons = [];
    var seen = {};
    addReason(reasons, seen, "complete_flexible_visit_fit", "Every requested service line is placed as an atomic provider-owned line.");
    if (plan.orderChanged) {
      addReason(reasons, seen, "reordered_services_for_availability", "Visit blocks were reordered to complete the visit.");
    }
    if (plan.totalClientWaitMinutes > 0) {
      addReason(reasons, seen, "client_wait_required", "A bounded client wait sits between completed visit blocks.");
    }
    if (flags.waitProvider) {
      addReason(reasons, seen, "waits_for_provider_availability", "A later block waits for a provider to become free.");
    }
    if (flags.waitResource) {
      addReason(reasons, seen, "waits_for_resource_availability", "A later block waits for a required physical resource.");
    }
    if (flags.multipleProviders) {
      addReason(reasons, seen, "uses_multiple_providers", "Different service lines use different providers.");
    }
    if (flags.usedAlternative) {
      addReason(reasons, seen, "uses_provider_alternative_for_complete_visit", "A locally second-best provider was used so the complete visit could finish.");
    }
    if (flags.usedResourceAlternative) {
      addReason(reasons, seen, "uses_resource_alternative_for_complete_visit", "A locally second-best resource was used so the complete visit could finish.");
    }
    if (plan.orderChanged || plan.totalClientWaitMinutes > 0 || flags.usedAlternative || flags.usedResourceAlternative) {
      addReason(reasons, seen, "reduces_visit_rejection", "Flexible order or waiting completed a visit that a fixed contiguous plan would reject.");
    }
    if (plan.timePreferenceBonus === 10) addReason(reasons, seen, "exact_preferred_start", "Visit starts at the preferred time.");
    else if (plan.timePreferenceBonus === 7 || plan.timePreferenceBonus === 4) {
      addReason(reasons, seen, "near_preferred_start", "Visit starts near the preferred time.");
    }
    if (plan.optimizationDeltaTotal > 0) addReason(reasons, seen, "improves_salon_optimization", "The complete visit improves total provider-day optimization.");
    if (plan.fragmentationDeltaTotal < 0) addReason(reasons, seen, "reduces_salon_fragmentation", "The complete visit reduces total provider-day fragmentation.");
    if (plan.overlapLineCount > 0) addReason(reasons, seen, "uses_permitted_overlap", "At least one visit line uses permitted overlap.");
    return reasons;
  }

  function flexMetadata(meta, lines, blocks, opts, extras) {
    var src = meta || {};
    return emptyMetadata(lines, blocks, opts, Object.assign({
      orderPermutationCount: src.orderPermutationCount || 1,
      visitStartCandidateCount: src.visitStartCandidateCount || 0,
      waitCandidatesEvaluated: src.waitCandidatesEvaluated || 0,
      providerCandidatesByLine: src.providerCandidatesByLine || (lines || []).map(function () { return 0; }),
      resourceCandidatesByRequirement: src.resourceCandidatesByRequirement || [],
      evaluatedBlockAssignments: src.evaluatedBlockAssignments || 0,
      evaluatedVisitPlans: src.evaluatedVisitPlans || src.evaluatedPlanCount || 0,
      truncated: !!src.truncated,
      exhaustive: src.exhaustive !== false && !src.truncated
    }, extras || {}));
  }

  function wrapPhase13Plan(plan, lines, blocks, opts) {
    if (!plan) return null;
    if (plan.valid === false) {
      return Object.assign({}, plan, {
        flexibleVisitPlanScore: 0,
        serviceExecutionElapsedMinutes: 0,
        totalClientWaitMinutes: 0,
        clientWaitPenalty: 0,
        orderChanged: false,
        orderDistance: 0,
        searchMetadata: flexMetadata(plan.searchMetadata, lines, blocks, opts)
      });
    }
    var exec = 0;
    var flexBlocks = (plan.blocks || []).map(function (block, idx) {
      var duration = block.durationMinutes != null ? block.durationMinutes : (block.endMin - block.startMin);
      exec += duration;
      return Object.assign({}, block, {
        sourceBlockIndex: block.sourceBlockIndex != null ? block.sourceBlockIndex : idx,
        waitBeforeMinutes: 0
      });
    });
    var providers = {};
    (plan.serviceLines || []).forEach(function (row) { providers[row.providerId] = true; });
    var score = plan.resourceAwareVisitPlanScore != null ? plan.resourceAwareVisitPlanScore : plan.parallelVisitPlanScore;
    var wrapped = Object.assign({}, plan, {
      blocks: flexBlocks,
      serviceExecutionElapsedMinutes: exec,
      totalClientWaitMinutes: 0,
      clientWaitPenalty: 0,
      orderChanged: false,
      orderDistance: 0,
      flexibleVisitPlanScore: score,
      searchMetadata: flexMetadata(plan.searchMetadata, lines, blocks, opts, { orderPermutationCount: 1 })
    });
    var seen = {};
    var reasons = [];
    addReason(reasons, seen, "complete_flexible_visit_fit", "Every requested service line is placed as an atomic provider-owned line.");
    (plan.reasons || []).forEach(function (row) {
      if (row.code === "complete_parallel_visit_fit" || row.code === "complete_multi_service_visit_fit") return;
      addReason(reasons, seen, row.code, row.text);
    });
    if (Object.keys(providers).length > 1) {
      addReason(reasons, seen, "uses_multiple_providers", "Different service lines use different providers.");
    }
    wrapped.reasons = reasons;
    return wrapped;
  }

  function compareFlexibleVisitPlans(a, b) {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    if (a.flexibleVisitPlanScore !== b.flexibleVisitPlanScore) {
      return b.flexibleVisitPlanScore - a.flexibleVisitPlanScore;
    }
    if (a.totalClientWaitMinutes !== b.totalClientWaitMinutes) {
      return a.totalClientWaitMinutes - b.totalClientWaitMinutes;
    }
    if (a.visitElapsedMinutes !== b.visitElapsedMinutes) return a.visitElapsedMinutes - b.visitElapsedMinutes;
    if (a.meanSlotScore !== b.meanSlotScore) return b.meanSlotScore - a.meanSlotScore;
    if (a.optimizationDeltaTotal !== b.optimizationDeltaTotal) {
      return b.optimizationDeltaTotal - a.optimizationDeltaTotal;
    }
    if (a.fragmentationAfterTotal !== b.fragmentationAfterTotal) {
      return a.fragmentationAfterTotal - b.fragmentationAfterTotal;
    }
    if (a.strandedBetweenGapMinutesAfterTotal !== b.strandedBetweenGapMinutesAfterTotal) {
      return a.strandedBetweenGapMinutesAfterTotal - b.strandedBetweenGapMinutesAfterTotal;
    }
    if (a.overlapLineCount !== b.overlapLineCount) return a.overlapLineCount - b.overlapLineCount;
    if (a.timeDistanceMinutes !== b.timeDistanceMinutes) return a.timeDistanceMinutes - b.timeDistanceMinutes;
    if (a.visitStartMin !== b.visitStartMin) return a.visitStartMin - b.visitStartMin;
    if ((a.orderDistance || 0) !== (b.orderDistance || 0)) return (a.orderDistance || 0) - (b.orderDistance || 0);
    var providers = String(a.assignmentKey || "").localeCompare(String(b.assignmentKey || ""));
    if (providers) return providers;
    return String(a.resourceAssignmentKey || "").localeCompare(String(b.resourceAssignmentKey || ""));
  }

  function diagnoseGap(block, daysById, resourceById, startMin, snap, maxProviders, maxResources, maxBlock) {
    var internals = p12();
    var resApi = p13();
    var providers = internals.enumerateBlockAssignments
      ? internals.enumerateBlockAssignments(block, daysById, startMin, snap, maxProviders, maxBlock)
      : { combos: [] };
    if (!providers.combos.length) return { provider: true, resource: false };
    var resourceGap = providers.combos.length > 0;
    var i;
    for (i = 0; i < providers.combos.length; i += 1) {
      var resources = resApi.enumerateResourceAssignments
        ? resApi.enumerateResourceAssignments(block, resourceById, startMin, maxResources, maxBlock)
        : { combos: [[]] };
      if (resources.combos && resources.combos.length) {
        resourceGap = false;
        break;
      }
    }
    return { provider: false, resource: resourceGap };
  }

  function scoreFlexibleVisit(originalDays, lineRows, blockMetas, visitStartMin, request, options, flags) {
    var internals = p12();
    var resApi = p13();
    var simulatedById = internals.copyDaysMap
      ? internals.copyDaysMap((function () {
        var map = {};
        originalDays.forEach(function (day) { map[trimText(day.providerId)] = day; });
        return map;
      })())
      : {};
    var serviceLines = [];
    lineRows.forEach(function (row) {
      var startMin = row.serviceStartMin;
      simulatedById[row.assignment.providerId] = internals.insertVisitLine
        ? internals.insertVisitLine(simulatedById[row.assignment.providerId], row.line, startMin)
        : simulatedById[row.assignment.providerId];
      serviceLines.push({
        lineKey: row.line.lineKey,
        serviceId: row.line.serviceId,
        providerId: row.assignment.providerId,
        startMin: startMin,
        endMin: startMin + row.line.durationMinutes,
        durationMinutes: row.line.durationMinutes,
        blockIndex: row.blockIndex,
        slotScore: Number(row.assignment.slotScore) || 0,
        slotLabel: row.assignment.slotLabel || "",
        usesOverlap: !!row.assignment.usesOverlap,
        assignmentScore: Number(row.assignment.assignmentScore) || 0,
        reasons: row.assignment.reasons || [],
        resourceAssignments: []
      });
    });

    if (originalDays.some(function (day) {
      var id = trimText(day.providerId);
      return worsensOverlap(simulatedById[id].occupied, allowedOverlapOf(day), day);
    })) return null;

    var working = 0;
    var occupiedBefore = 0;
    var occupiedAfter = 0;
    var optBefore = 0;
    var optAfter = 0;
    var fragBefore = 0;
    var fragAfter = 0;
    var strandedBefore = 0;
    var strandedAfter = 0;
    originalDays.forEach(function (day) {
      var id = trimText(day.providerId);
      var before = analyzeDay(day, options);
      var after = analyzeDay(simulatedById[id], options);
      working += Number(before.workingMinutes) || 0;
      occupiedBefore += Number(before.occupiedMinutes) || 0;
      occupiedAfter += Number(after.occupiedMinutes) || 0;
      optBefore += Number(before.optimizationScore) || 0;
      optAfter += Number(after.optimizationScore) || 0;
      fragBefore += Number(before.fragmentationScore) || 0;
      fragAfter += Number(after.fragmentationScore) || 0;
      strandedBefore += Number(before.strandedBetweenGapMinutes) || 0;
      strandedAfter += Number(after.strandedBetweenGapMinutes) || 0;
    });

    var slotSum = 0;
    var overlapLineCount = 0;
    var sumService = 0;
    serviceLines.forEach(function (row) {
      slotSum += row.slotScore;
      sumService += row.durationMinutes;
      if (row.usesOverlap) overlapLineCount += 1;
    });
    var visitEndMin = blockMetas.length ? blockMetas[blockMetas.length - 1].endMin : visitStartMin;
    var totalWait = 0;
    var exec = 0;
    blockMetas.forEach(function (block) {
      totalWait += Number(block.waitBeforeMinutes) || 0;
      exec += Number(block.durationMinutes) || 0;
    });
    var elapsed = visitEndMin - visitStartMin;
    var saved = sumService - exec;
    var meanSlotScore = Math.round(slotSum / serviceLines.length);
    var slotFitComponent = clampInt(Math.round((meanSlotScore - 50) * 0.40), -SLOT_FIT_CLAMP, SLOT_FIT_CLAMP);
    var preferred = optionMin(request, "preferredStartMin");
    var timeBonus = timePreferenceBonus(visitStartMin, preferred);
    var bonus = efficiencyBonus(saved);
    var waitPenalty = clientWaitPenaltyOf(totalWait);
    var providerCount = originalDays.length;
    var optDelta = optAfter - optBefore;
    var fragDelta = fragAfter - fragBefore;
    var strandedDelta = strandedAfter - strandedBefore;
    var optAvg = providerCount === 0 ? 0 : Math.round(optDelta / providerCount);
    var fragAvg = providerCount === 0 ? 0 : Math.round(fragDelta / providerCount);
    var strandedPct = working === 0 ? 0 : Math.round(100 * strandedDelta / working);
    var raw = BASE;
    raw += slotFitComponent;
    raw += clampInt(optAvg, -OPT_CLAMP, OPT_CLAMP);
    raw -= clampInt(Math.max(0, fragAvg), 0, FRAG_PENALTY_CAP);
    raw += clampInt(Math.max(0, -fragAvg), 0, FRAG_BONUS_CAP);
    raw -= clampInt(Math.max(0, strandedPct), 0, STRANDED_PENALTY_CAP);
    raw += timeBonus;
    raw += bonus;
    raw -= Math.min(OVERLAP_PENALTY_CAP, overlapLineCount * OVERLAP_ACTION_PENALTY);
    var operational = raw;
    raw -= waitPenalty;
    var sourceIndexes = blockMetas.map(function (block) { return block.sourceBlockIndex; });
    var orderDistance = orderDistanceOf(sourceIndexes);
    var plan = {
      valid: true,
      reason: "",
      dateKey: trimText(originalDays[0] && originalDays[0].dateKey),
      locationId: trimText(originalDays[0] && originalDays[0].locationId),
      visitStartMin: visitStartMin,
      visitEndMin: visitEndMin,
      sumServiceMinutes: sumService,
      serviceExecutionElapsedMinutes: exec,
      totalClientWaitMinutes: totalWait,
      visitElapsedMinutes: elapsed,
      parallelMinutesSaved: saved,
      parallelEfficiencyBonus: bonus,
      orderChanged: orderDistance > 0,
      orderDistance: orderDistance,
      blocks: blockMetas.map(function (block, blockIndex) {
        return {
          blockIndex: blockIndex,
          sourceBlockIndex: block.sourceBlockIndex,
          startMin: block.startMin,
          endMin: block.endMin,
          waitBeforeMinutes: block.waitBeforeMinutes,
          parallel: !!block.parallel,
          parallelGroup: block.parallelGroup || undefined,
          lineKeys: block.lineKeys.slice(),
          durationMinutes: block.durationMinutes
        };
      }),
      serviceLines: serviceLines,
      meanSlotScore: meanSlotScore,
      slotFitComponent: slotFitComponent,
      timePreferenceBonus: timeBonus,
      timeDistanceMinutes: preferred == null ? 0 : Math.abs(visitStartMin - preferred),
      clientWaitPenalty: waitPenalty,
      assignmentKey: assignmentKey(serviceLines),
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
      totalWorkingMinutes: working,
      totalOccupiedMinutesBefore: occupiedBefore,
      totalOccupiedMinutesAfter: occupiedAfter,
      utilizationBeforeWeighted: working === 0 ? 0 : Math.round(100 * occupiedBefore / working),
      utilizationAfterWeighted: working === 0 ? 0 : Math.round(100 * occupiedAfter / working),
      overlapLineCount: overlapLineCount,
      parallelVisitPlanScore: clampScore(operational),
      resourceAwareVisitPlanScore: clampScore(operational),
      flexibleVisitPlanScore: clampScore(raw)
    };
    flags.multipleProviders = (function () {
      var ids = {};
      serviceLines.forEach(function (row) { ids[row.providerId] = true; });
      return Object.keys(ids).length > 1;
    })();
    plan.reasons = buildReasons(plan, flags);
    return resApi.attachResources ? resApi.attachResources(plan, resApi.flattenChosenResources(lineRows)) : plan;
  }

  function rankFlexibleVisitPlans(providerDays, resourceDays, request, options) {
    var internals = p12();
    var resApi = p13();
    var opts = options && typeof options === "object" ? options : {};
    var req = request && typeof request === "object" ? request : {};
    var allowReorder = flagOf(req, opts, "allowServiceReordering");
    var allowWait = flagOf(req, opts, "allowClientWait");
    var maxBetween = optionNonNeg(req, "maxWaitBetweenBlocksMinutes", optionNonNeg(opts, "maxWaitBetweenBlocksMinutes", 0));
    var maxTotal = optionNonNeg(req, "maxTotalClientWaitMinutes", optionNonNeg(opts, "maxTotalClientWaitMinutes", 0));
    var waitSnap = optionInt(req, "waitSnapMinutes", optionInt(opts, "waitSnapMinutes", DEFAULT_WAIT_SNAP));
    var canWait = allowWait && maxBetween > 0 && maxTotal > 0;
    var maxLines = optionInt(opts, "maxServiceLines", DEFAULT_MAX_LINES);
    var maxParallel = optionInt(opts, "maxParallelLinesPerBlock", DEFAULT_MAX_PARALLEL);
    var maxProviders = optionInt(opts, "maxProvidersPerLine", DEFAULT_MAX_PROVIDERS);
    var maxResources = optionInt(opts, "maxResourcesPerRequirement", DEFAULT_MAX_RESOURCES);
    var maxReqs = optionInt(opts, "maxResourceRequirementsPerLine", DEFAULT_MAX_REQUIREMENTS);
    var maxPerms = optionInt(opts, "maxOrderPermutations", DEFAULT_MAX_PERMS);
    var maxStarts = optionInt(opts, "maxVisitStartCandidates", DEFAULT_MAX_STARTS);
    var maxWaits = optionInt(opts, "maxWaitCandidatesPerTransition", DEFAULT_MAX_WAITS);
    var maxBlock = optionInt(opts, "maxBlockAssignments", DEFAULT_MAX_BLOCK);
    var maxEvaluated = optionInt(opts, "maxEvaluatedVisitPlans", DEFAULT_MAX_EVALUATED);
    var maxReturned = optionInt(opts, "maxReturnedPlans", DEFAULT_MAX_RETURNED);
    var snapMinutes = optionInt(opts, "snapMinutes", optionInt(req, "snapMinutes", DEFAULT_SNAP));
    var days = (Array.isArray(providerDays) ? providerDays : []).map(function (day) {
      return internals.asDay ? internals.asDay(day) : day;
    });
    var lines = resApi.parseLines ? resApi.parseLines(req) : (internals.parseLines ? internals.parseLines(req) : []);
    var blocks = internals.buildBlocks ? internals.buildBlocks(lines) : [];
    blocks.forEach(function (block, idx) { block.sourceBlockIndex = idx; });

    if (!allowReorder && !canWait && typeof ns().rankResourceAwareVisitPlans === "function") {
      return (ns().rankResourceAwareVisitPlans(providerDays, resourceDays, req, opts) || []).map(function (plan) {
        return wrapPhase13Plan(plan, lines, blocks, opts);
      }).filter(Boolean);
    }

    if (lines.length > maxLines) return [invalidPlan("too_many_service_lines_for_phase14", days, lines, blocks, opts)];
    var parsedRes = resApi.parseResourceDays ? resApi.parseResourceDays(resourceDays) : { days: [] };
    if (parsedRes.error) return [invalidPlan(parsedRes.error, days, lines, blocks, opts)];
    var resourceList = parsedRes.days || [];
    var resourceErr = resApi.validateResources ? resApi.validateResources(resourceList, days) : "";
    if (resourceErr) return [invalidPlan(resourceErr, days, lines, blocks, opts)];
    var resourceById = {};
    resourceList.forEach(function (day) { resourceById[day.resourceId] = day; });
    var reqErr = resApi.validateRequirements ? resApi.validateRequirements(lines, resourceById, maxReqs) : "";
    if (reqErr) return [invalidPlan(reqErr, days, lines, blocks, opts)];
    var providerErr = internals.validateRequest ? internals.validateRequest(days, lines, blocks, maxParallel) : "";
    if (providerErr) {
      return [invalidPlan(providerErr === "too_many_parallel_lines_for_phase12"
        ? "too_many_parallel_lines_for_phase14"
        : providerErr, days, lines, blocks, opts)];
    }

    var allPerms = allowReorder ? permute(blocks) : [blocks.slice()];
    var orderCut = allPerms.length > maxPerms;
    var perms = allPerms.slice(0, maxPerms);
    var daysById = {};
    days.forEach(function (day) { daysById[trimText(day.providerId)] = day; });
    var evaluated = 0;
    var evaluatedBlocks = 0;
    var waitEvaluated = 0;
    var startCount = 0;
    var validPlans = [];
    var hitCap = false;
    var blockBoundHit = false;
    var providerBoundHit = false;
    var resourceBoundHit = false;
    var waitBoundHit = false;
    var startBoundHit = false;
    var providerCandidatesByLine = lines.map(function () { return 0; });
    var resourceCandidates = [];
    var lineIndex = {};
    lines.forEach(function (line, idx) { lineIndex[line.lineKey] = idx; });

    function consider(lineRows, blockMetas, visitStartMin, flags) {
      if (evaluated >= maxEvaluated) {
        hitCap = true;
        return;
      }
      evaluated += 1;
      var plan = scoreFlexibleVisit(days, lineRows, blockMetas, visitStartMin, req, opts, flags);
      if (plan) validPlans.push(plan);
    }

    function search(perm, blockIndex, visitStartMin, cursor, remainingWait, simDays, simRes, lineRows, blockMetas, flags) {
      if (hitCap) return;
      if (blockIndex >= perm.length) {
        consider(lineRows, blockMetas, visitStartMin, flags);
        return;
      }
      var block = perm[blockIndex];
      var waitBefore = blockMetas.length ? cursor - blockMetas[blockMetas.length - 1].endMin : 0;
      var providers = internals.enumerateBlockAssignments
        ? internals.enumerateBlockAssignments(block, simDays, cursor, 1, maxProviders, maxBlock)
        : { combos: [], truncated: false, providerCut: false, rankedByLine: [] };
      if (providers.truncated) blockBoundHit = true;
      if (providers.providerCut) providerBoundHit = true;
      block.lines.forEach(function (line, idx) {
        var count = (providers.rankedByLine[idx] || []).length;
        var at = lineIndex[line.lineKey];
        if (count > providerCandidatesByLine[at]) providerCandidatesByLine[at] = count;
      });
      providers.combos.forEach(function (combo) {
        if (hitCap) return;
        var remaining = maxBlock - evaluatedBlocks;
        if (remaining <= 0) {
          blockBoundHit = true;
          return;
        }
        var resources = resApi.enumerateResourceAssignments
          ? resApi.enumerateResourceAssignments(block, simRes, cursor, maxResources, remaining)
          : { combos: [[]], truncated: false, cut: false, rankedJobs: [] };
        if (resources.truncated || resources.cut) resourceBoundHit = true;
        resources.rankedJobs.forEach(function (row) {
          resourceCandidates.push({
            lineKey: row.job.line.lineKey,
            requirementKey: row.job.req.requirementKey,
            count: row.ranked.length
          });
        });
        var alt = flags.usedAlternative;
        var resAlt = flags.usedResourceAlternative;
        combo.forEach(function (row, idx) {
          var ranked = providers.rankedByLine[idx] || [];
          if (ranked[0] && row.assignment.providerId !== ranked[0].providerId) alt = true;
        });
        resources.combos.forEach(function (resCombo) {
          if (hitCap) return;
          evaluatedBlocks += 1;
          resources.rankedJobs.forEach(function (row) {
            var chosen = resCombo.filter(function (item) {
              return item.lineKey === row.job.line.lineKey && item.req.requirementKey === row.job.req.requirementKey;
            })[0];
            if (row.ranked[0] && chosen && chosen.resourceId !== row.ranked[0].resourceId) resAlt = true;
          });
          var nextDays = internals.copyDaysMap ? internals.copyDaysMap(simDays) : simDays;
          var nextRes = resApi.copyResourceMap ? resApi.copyResourceMap(simRes) : simRes;
          combo.forEach(function (row) {
            nextDays[row.assignment.providerId] = internals.insertVisitLine
              ? internals.insertVisitLine(nextDays[row.assignment.providerId], row.line, cursor)
              : nextDays[row.assignment.providerId];
          });
          resCombo.forEach(function (res) {
            nextRes[res.resourceId] = resApi.insertReservation(
              nextRes[res.resourceId],
              res.lineKey,
              res.req,
              res.resourceId,
              res.window.startMin,
              res.window.endMin
            );
          });
          var chosenBlock = combo.map(function (row) {
            return Object.assign({}, row, {
              serviceStartMin: cursor,
              blockIndex: blockIndex,
              resources: resCombo.filter(function (res) { return res.lineKey === row.line.lineKey; })
            });
          });
          var nextBlocks = blockMetas.concat([{
            sourceBlockIndex: block.sourceBlockIndex,
            startMin: cursor,
            endMin: cursor + block.durationMinutes,
            waitBeforeMinutes: waitBefore,
            parallel: block.parallel,
            parallelGroup: block.parallelGroup,
            lineKeys: block.lines.map(function (line) { return line.lineKey; }),
            durationMinutes: block.durationMinutes
          }]);
          var nextFlags = {
            usedAlternative: alt,
            usedResourceAlternative: resAlt,
            waitProvider: flags.waitProvider,
            waitResource: flags.waitResource
          };
          var nextRows = lineRows.concat(chosenBlock);
          var blockEnd = cursor + block.durationMinutes;
          if (blockIndex + 1 >= perm.length) {
            search(perm, blockIndex + 1, visitStartMin, blockEnd, remainingWait, nextDays, nextRes, nextRows, nextBlocks, nextFlags);
            return;
          }
          var waits = waitCandidates(maxBetween, remainingWait, waitSnap, maxWaits, canWait);
          if (waits.truncated) waitBoundHit = true;
          waits.waits.forEach(function (wait) {
            if (hitCap) return;
            waitEvaluated += 1;
            var gap = { provider: false, resource: false };
            if (wait > 0) {
              gap = diagnoseGap(perm[blockIndex + 1], nextDays, nextRes, blockEnd, 1, maxProviders, maxResources, maxBlock);
            }
            search(
              perm,
              blockIndex + 1,
              visitStartMin,
              blockEnd + wait,
              remainingWait - wait,
              nextDays,
              nextRes,
              nextRows,
              nextBlocks,
              {
                usedAlternative: nextFlags.usedAlternative,
                usedResourceAlternative: nextFlags.usedResourceAlternative,
                waitProvider: nextFlags.waitProvider || gap.provider,
                waitResource: nextFlags.waitResource || gap.resource
              }
            );
          });
        });
      });
    }

    perms.forEach(function (perm) {
      if (hitCap) return;
      var startInfo = internals.collectVisitStarts
        ? internals.collectVisitStarts(daysById, perm[0], req, snapMinutes, maxStarts)
        : { allCount: 0, starts: [] };
      if (startInfo.starts.length > startCount) startCount = startInfo.starts.length;
      if (startInfo.allCount > startInfo.starts.length) startBoundHit = true;
      startInfo.starts.forEach(function (startMin) {
        if (hitCap) return;
        search(
          perm,
          0,
          startMin,
          startMin,
          maxTotal,
          internals.copyDaysMap ? internals.copyDaysMap(daysById) : daysById,
          resApi.copyResourceMap ? resApi.copyResourceMap(resourceById) : resourceById,
          [],
          [],
          { usedAlternative: false, usedResourceAlternative: false, waitProvider: false, waitResource: false }
        );
      });
    });

    var truncated = hitCap || blockBoundHit || providerBoundHit || resourceBoundHit || waitBoundHit || startBoundHit || orderCut;
    validPlans.sort(compareFlexibleVisitPlans);
    var returned = validPlans.slice(0, maxReturned);
    var metadata = emptyMetadata(lines, blocks, opts, {
      orderPermutationCount: perms.length,
      visitStartCandidateCount: startCount,
      waitCandidatesEvaluated: waitEvaluated,
      providerCandidatesByLine: providerCandidatesByLine,
      resourceCandidatesByRequirement: resourceCandidates,
      evaluatedBlockAssignments: evaluatedBlocks,
      evaluatedVisitPlans: evaluated,
      truncated: truncated,
      exhaustive: !truncated
    });
    returned.forEach(function (plan) { plan.searchMetadata = metadata; });
    return returned;
  }

  function recommendFlexibleVisit(providerDays, resourceDays, request, options) {
    var ranked = rankFlexibleVisitPlans(providerDays, resourceDays, request, options);
    if (!ranked.length) return null;
    if (ranked[0] && ranked[0].valid === false) return ranked[0];
    return ranked[0] || null;
  }

  var api = ns();
  api.rankFlexibleVisitPlans = rankFlexibleVisitPlans;
  api.recommendFlexibleVisit = recommendFlexibleVisit;
  api.compareFlexibleVisitPlans = compareFlexibleVisitPlans;
  api.FLEXIBLE_VISIT = {
    BASE: BASE,
    WAIT_PENALTY_CAP: WAIT_PENALTY_CAP,
    DEFAULT_WAIT_SNAP_MINUTES: DEFAULT_WAIT_SNAP,
    DEFAULT_MAX_SERVICE_LINES: DEFAULT_MAX_LINES,
    DEFAULT_MAX_PARALLEL_LINES_PER_BLOCK: DEFAULT_MAX_PARALLEL,
    DEFAULT_MAX_PROVIDERS_PER_LINE: DEFAULT_MAX_PROVIDERS,
    DEFAULT_MAX_RESOURCES_PER_REQUIREMENT: DEFAULT_MAX_RESOURCES,
    DEFAULT_MAX_RESOURCE_REQUIREMENTS_PER_LINE: DEFAULT_MAX_REQUIREMENTS,
    DEFAULT_MAX_ORDER_PERMUTATIONS: DEFAULT_MAX_PERMS,
    DEFAULT_MAX_VISIT_START_CANDIDATES: DEFAULT_MAX_STARTS,
    DEFAULT_MAX_WAIT_CANDIDATES_PER_TRANSITION: DEFAULT_MAX_WAITS,
    DEFAULT_MAX_BLOCK_ASSIGNMENTS: DEFAULT_MAX_BLOCK,
    DEFAULT_MAX_EVALUATED_VISIT_PLANS: DEFAULT_MAX_EVALUATED,
    DEFAULT_MAX_RETURNED_PLANS: DEFAULT_MAX_RETURNED
  };
})();
