/**
 * Smart Scheduling Phase 12 — parallel / simultaneous multi-service visits.
 *
 * Recommendation-only. Caller must declare parallelGroup explicitly.
 * Consecutive same-group lines form one simultaneous block. Phase 11
 * sequential planning stays independent and is reused when no groups exist.
 *
 * parallelVisitPlanScoreRaw =
 *     50
 *   + slotFitComponent
 *   + clamp(optimizationDeltaAverage, -20, +20)
 *   - clamp(max(0, fragmentationDeltaAverage), 0, 20)
 *   + clamp(max(0, -fragmentationDeltaAverage), 0, 15)
 *   - clamp(max(0, strandedBetweenMinutesDeltaPercent), 0, 15)
 *   + timePreferenceBonus
 *   + parallelEfficiencyBonus
 *   - overlapPenalty
 *
 * parallelEfficiencyBonus = min(15, round(parallelMinutesSaved / 15) * 2)
 * Same-provider simultaneous lines are invalid before scoring.
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
  var DEFAULT_SNAP = 15;
  var DEFAULT_MAX_LINES = 4;
  var DEFAULT_MAX_PARALLEL = 3;
  var DEFAULT_MAX_PROVIDERS = 5;
  var DEFAULT_MAX_STARTS = 40;
  var DEFAULT_MAX_BLOCK = 100;
  var DEFAULT_MAX_EVALUATED = 5000;
  var DEFAULT_MAX_RETURNED = 10;

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

  function optionInt(opts, key, fallback) {
    if (!opts || opts[key] == null || opts[key] === "") return fallback;
    var n = Math.round(Number(opts[key]));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function optionMin(obj, key) {
    if (!obj || obj[key] == null || obj[key] === "") return null;
    var n = Number(obj[key]);
    return Number.isFinite(n) ? Math.round(n) : null;
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
    return (list || []).map(function (row) { return { startMin: row.startMin, endMin: row.endMin }; });
  }

  function copyOccupied(list) {
    return (list || []).map(function (row) {
      return Object.assign({}, row, { requested: row.requested === true });
    });
  }

  function copyDay(day) {
    return {
      dateKey: trimText(day && day.dateKey),
      locationId: trimText(day && day.locationId),
      providerId: trimText(day && day.providerId),
      allowedOverlapMinutes: day && day.allowedOverlapMinutes != null ? day.allowedOverlapMinutes : 0,
      workingIntervals: copyIntervals(day && day.workingIntervals),
      occupied: copyOccupied(day && day.occupied)
    };
  }

  function copyDaysMap(daysById) {
    var out = {};
    Object.keys(daysById).forEach(function (id) { out[id] = copyDay(daysById[id]); });
    return out;
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

  function visitLineId(lineKey) {
    var prefix = ns().MULTI_SERVICE && ns().MULTI_SERVICE.VISIT_LINE_PREFIX;
    return (prefix || "__smart_visit__") + "|" + trimText(lineKey);
  }

  function assignmentTypeOf(line) {
    var raw = trimText(line && line.assignmentType);
    return raw === "specific_provider" || raw === "any_provider" ? raw : "any_provider";
  }

  function parseLines(request) {
    return (request && Array.isArray(request.serviceLines) ? request.serviceLines : []).map(function (row) {
      return {
        lineKey: trimText(row && row.lineKey),
        serviceId: trimText(row && row.serviceId),
        durationMinutes: Math.round(Number(row && row.durationMinutes)),
        eligibleProviderIds: (row && Array.isArray(row.eligibleProviderIds) ? row.eligibleProviderIds : []).map(trimText).filter(Boolean),
        assignmentType: assignmentTypeOf(row),
        requestedProviderId: trimText(row && row.requestedProviderId),
        parallelGroup: trimText(row && row.parallelGroup)
      };
    });
  }

  function buildBlocks(lines) {
    var blocks = [];
    var i = 0;
    while (i < lines.length) {
      var group = lines[i].parallelGroup;
      if (group) {
        var members = [lines[i]];
        var j = i + 1;
        while (j < lines.length && lines[j].parallelGroup === group) {
          members.push(lines[j]);
          j += 1;
        }
        blocks.push({
          parallel: members.length > 1,
          parallelGroup: group,
          lines: members,
          durationMinutes: members.reduce(function (max, line) {
            return line.durationMinutes > max ? line.durationMinutes : max;
          }, 0)
        });
        i = j;
      } else {
        blocks.push({
          parallel: false,
          parallelGroup: "",
          lines: [lines[i]],
          durationMinutes: lines[i].durationMinutes
        });
        i += 1;
      }
    }
    return blocks;
  }

  function validateRequest(days, lines, blocks, maxParallel) {
    if (lines.length < 2) return "too_few_service_lines";
    var seen = {};
    var i;
    for (i = 0; i < lines.length; i += 1) {
      var line = lines[i];
      if (!line.lineKey) return "missing_line_key";
      if (seen[line.lineKey]) return "duplicate_line_key";
      seen[line.lineKey] = true;
      if (!(line.durationMinutes > 0)) return "invalid_duration";
      if (!line.eligibleProviderIds.length) return "no_eligible_provider";
      if (line.assignmentType === "specific_provider") {
        if (!line.requestedProviderId) return "missing_requested_provider";
        if (line.eligibleProviderIds.indexOf(line.requestedProviderId) === -1) {
          return "requested_provider_not_eligible";
        }
      }
    }
    if (blocks.some(function (block) { return block.lines.length > maxParallel; })) {
      return "too_many_parallel_lines_for_phase12";
    }
    if (!days.length) return "unknown_provider";
    var locationId = trimText(days[0].locationId);
    var dateKey = trimText(days[0].dateKey);
    if (days.some(function (day) {
      return trimText(day.locationId) !== locationId || trimText(day.dateKey) !== dateKey;
    })) return "mixed_location_or_date";
    var have = {};
    days.forEach(function (day) { have[trimText(day.providerId)] = true; });
    for (i = 0; i < lines.length; i += 1) {
      var ids = lines[i].assignmentType === "specific_provider"
        ? [lines[i].requestedProviderId]
        : lines[i].eligibleProviderIds;
      if (ids.some(function (id) { return !have[id]; })) return "unknown_provider";
    }
    return "";
  }

  function hasParallelGroups(lines) {
    return lines.some(function (line) { return !!line.parallelGroup; });
  }

  function daysForLine(daysById, line) {
    var ids = line.assignmentType === "specific_provider"
      ? [line.requestedProviderId]
      : line.eligibleProviderIds;
    return ids.map(function (id) { return daysById[id]; }).filter(Boolean);
  }

  function firstSnapped(winStart, snap) {
    var stepped = Math.ceil(Number(winStart) / snap) * snap;
    if (stepped < winStart) stepped += snap;
    return stepped;
  }

  function lineFitsWorking(day, startMin, duration) {
    var endMin = startMin + duration;
    return (day.workingIntervals || []).some(function (win) {
      return startMin >= win.startMin && endMin <= win.endMin;
    });
  }

  function startFitsFirstBlock(startMin, block, daysById) {
    return block.lines.every(function (line) {
      return daysForLine(daysById, line).some(function (day) {
        return lineFitsWorking(day, startMin, line.durationMinutes);
      });
    });
  }

  function flexibilityOf(request) {
    if (!request || request.preferredStartMin == null || request.preferredStartMin === "") return 0;
    if (request.flexibilityMinutes == null || request.flexibilityMinutes === "") return 0;
    var n = Math.round(Number(request.flexibilityMinutes));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function collectVisitStarts(daysById, firstBlock, request, snap, maxStarts) {
    var preferred = optionMin(request, "preferredStartMin");
    var flex = flexibilityOf(request);
    var earliest = optionMin(request, "earliestStartMin");
    var latest = optionMin(request, "latestStartMin");
    var found = {};

    function add(startMin) {
      if (!Number.isFinite(startMin)) return;
      if (earliest != null && startMin < earliest) return;
      if (latest != null && startMin > latest) return;
      if (!startFitsFirstBlock(startMin, firstBlock, daysById)) return;
      found[startMin] = true;
    }

    var hosts = [];
    firstBlock.lines.forEach(function (line) {
      daysForLine(daysById, line).forEach(function (day) { hosts.push({ day: day, duration: line.durationMinutes }); });
    });

    if (preferred != null && flex === 0) {
      add(preferred);
    } else if (preferred != null) {
      add(preferred);
      var lo = preferred - flex;
      var hi = preferred + flex;
      hosts.forEach(function (host) {
        (host.day.workingIntervals || []).forEach(function (win) {
          var start = firstSnapped(Math.max(win.startMin, lo), snap);
          while (start + host.duration <= win.endMin && start <= hi) {
            add(start);
            start += snap;
          }
        });
      });
    } else {
      hosts.forEach(function (host) {
        (host.day.workingIntervals || []).forEach(function (win) {
          var start = firstSnapped(win.startMin, snap);
          while (start + host.duration <= win.endMin) {
            add(start);
            start += snap;
          }
        });
      });
    }

    var starts = Object.keys(found).map(Number);
    starts.sort(function (a, b) {
      if (preferred != null) {
        var da = Math.abs(a - preferred);
        var db = Math.abs(b - preferred);
        if (da !== db) return da - db;
      }
      return a - b;
    });
    return { allCount: starts.length, starts: starts.slice(0, maxStarts) };
  }

  function uniqueProviders(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (row) {
      var key = String(row.providerId || "");
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(row);
    });
    return out;
  }

  function rankProvidersForLine(daysById, line, startMin, snapMinutes) {
    var api = ns();
    var days = daysForLine(daysById, line);
    var request = {
      durationMinutes: line.durationMinutes,
      snapMinutes: snapMinutes,
      preferredStartMin: startMin,
      allowNearbyStarts: false,
      assignmentType: line.assignmentType,
      requestedProviderId: line.requestedProviderId
    };
    var ranked = typeof api.rankProviderAssignmentCandidates === "function"
      ? api.rankProviderAssignmentCandidates(days, request)
      : [];
    ranked = uniqueProviders(ranked.filter(function (row) { return row.startMin === startMin; }));
    if (api.compareAssignments) ranked.sort(api.compareAssignments);
    return ranked;
  }

  function insertVisitLine(day, line, startMin) {
    var next = copyDay(day);
    var identity = visitLineId(line.lineKey);
    next.occupied.push({
      lineId: identity,
      appointmentId: identity,
      providerId: trimText(day.providerId),
      startMin: startMin,
      endMin: startMin + line.durationMinutes,
      durationMinutes: line.durationMinutes,
      status: "scheduled",
      serviceId: line.serviceId,
      requested: line.assignmentType === "specific_provider"
    });
    if (helpers().compareOccupied) next.occupied.sort(helpers().compareOccupied);
    return next;
  }

  function timePreferenceBonus(visitStartMin, preferred) {
    if (preferred == null) return 0;
    var distance = Math.abs(visitStartMin - preferred);
    if (distance === 0) return 10;
    if (distance <= 15) return 7;
    if (distance <= 30) return 4;
    return 1;
  }

  function efficiencyBonus(saved) {
    return Math.min(EFFICIENCY_CAP, Math.round((Number(saved) || 0) / 15) * 2);
  }

  function assignmentKey(lines) {
    return (lines || []).map(function (row) {
      return String(row.lineKey || "") + "|" + String(row.providerId || "");
    }).join("||");
  }

  function compareParallelPlans(a, b) {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    if (a.parallelVisitPlanScore !== b.parallelVisitPlanScore) {
      return b.parallelVisitPlanScore - a.parallelVisitPlanScore;
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
    return String(a.assignmentKey || "").localeCompare(String(b.assignmentKey || ""));
  }

  function buildReasons(plan, usedAlternative) {
    var reasons = [];
    function add(code, text) { reasons.push({ code: code, text: text }); }
    add("complete_parallel_visit_fit", "Every requested service line is placed in the declared sequential/parallel blocks.");
    if (plan.parallelMinutesSaved > 0) {
      add("parallel_services_reduce_visit_time", "Simultaneous services reduce total client visit elapsed time.");
    }
    if (plan.meanSlotScore >= 80) add("strong_overall_slot_fit", "Mean Phase 1 slot score is in the best-fit range.");
    if (plan.timePreferenceBonus === 10) add("exact_preferred_start", "Visit starts at the preferred time.");
    else if (plan.timePreferenceBonus === 7 || plan.timePreferenceBonus === 4) {
      add("near_preferred_start", "Visit starts near the preferred time.");
    }
    if (plan.optimizationDeltaTotal > 0) add("improves_salon_optimization", "The complete visit improves total provider-day optimization.");
    if (plan.fragmentationDeltaTotal < 0) add("reduces_salon_fragmentation", "The complete visit reduces total provider-day fragmentation.");
    if (plan.fragmentationDeltaTotal > 0) add("creates_fragmentation", "The complete visit increases total provider-day fragmentation.");
    if (plan.strandedBetweenMinutesDeltaTotal > 0) add("creates_stranded_time", "The complete visit leaves more stranded between-gap minutes.");
    if (plan.overlapLineCount > 0) add("uses_permitted_overlap", "At least one visit line uses permitted overlap.");
    if (usedAlternative) {
      add("uses_provider_alternative_for_parallel_fit", "Chose a locally second-best provider so simultaneous lines could use distinct people.");
    }
    return reasons;
  }

  function scoreCompleteVisit(originalDays, chosen, blocks, visitStartMin, request, options, usedAlternative) {
    var simulatedById = {};
    originalDays.forEach(function (day) { simulatedById[trimText(day.providerId)] = copyDay(day); });
    var serviceLines = [];
    var blockViews = [];
    var cursor = visitStartMin;
    var lineByKey = {};
    chosen.forEach(function (row) { lineByKey[row.line.lineKey] = row; });
    blocks.forEach(function (block, blockIndex) {
      var startMin = cursor;
      var endMin = startMin + block.durationMinutes;
      blockViews.push({
        blockIndex: blockIndex,
        parallel: block.parallel,
        parallelGroup: block.parallelGroup || undefined,
        startMin: startMin,
        endMin: endMin,
        durationMinutes: block.durationMinutes,
        lineKeys: block.lines.map(function (line) { return line.lineKey; })
      });
      block.lines.forEach(function (line) {
        var pick = lineByKey[line.lineKey];
        simulatedById[pick.assignment.providerId] = insertVisitLine(
          simulatedById[pick.assignment.providerId],
          line,
          startMin
        );
        serviceLines.push({
          lineKey: line.lineKey,
          serviceId: line.serviceId,
          providerId: pick.assignment.providerId,
          startMin: startMin,
          endMin: startMin + line.durationMinutes,
          durationMinutes: line.durationMinutes,
          blockIndex: blockIndex,
          slotScore: Number(pick.assignment.slotScore) || 0,
          slotLabel: pick.assignment.slotLabel || "",
          usesOverlap: !!pick.assignment.usesOverlap,
          assignmentScore: Number(pick.assignment.assignmentScore) || 0,
          reasons: pick.assignment.reasons || []
        });
      });
      cursor = endMin;
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
    var visitEndMin = cursor;
    var elapsed = visitEndMin - visitStartMin;
    var saved = sumService - elapsed;
    var meanSlotScore = Math.round(slotSum / serviceLines.length);
    var slotFitComponent = clampInt(Math.round((meanSlotScore - 50) * 0.40), -SLOT_FIT_CLAMP, SLOT_FIT_CLAMP);
    var preferred = optionMin(request, "preferredStartMin");
    var timeBonus = timePreferenceBonus(visitStartMin, preferred);
    var bonus = efficiencyBonus(saved);
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

    var plan = {
      valid: true,
      reason: "",
      dateKey: trimText(originalDays[0] && originalDays[0].dateKey),
      locationId: trimText(originalDays[0] && originalDays[0].locationId),
      visitStartMin: visitStartMin,
      visitEndMin: visitEndMin,
      sumServiceMinutes: sumService,
      visitElapsedMinutes: elapsed,
      parallelMinutesSaved: saved,
      parallelEfficiencyBonus: bonus,
      blocks: blockViews,
      serviceLines: serviceLines,
      meanSlotScore: meanSlotScore,
      slotFitComponent: slotFitComponent,
      timePreferenceBonus: timeBonus,
      timeDistanceMinutes: preferred == null ? 0 : Math.abs(visitStartMin - preferred),
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
      parallelVisitPlanScore: clampScore(raw)
    };
    plan.reasons = buildReasons(plan, usedAlternative);
    return plan;
  }

  function emptyMetadata(lines, blocks, opts, extras) {
    return Object.assign({
      serviceLineCount: (lines || []).length,
      blockCount: (blocks || []).length,
      visitStartCandidateCount: 0,
      providerCandidatesByLine: (lines || []).map(function () { return 0; }),
      evaluatedBlockAssignments: 0,
      evaluatedVisitPlans: 0,
      maxServiceLines: optionInt(opts, "maxServiceLines", DEFAULT_MAX_LINES),
      maxParallelLinesPerBlock: optionInt(opts, "maxParallelLinesPerBlock", DEFAULT_MAX_PARALLEL),
      maxProvidersPerLine: optionInt(opts, "maxProvidersPerLine", DEFAULT_MAX_PROVIDERS),
      maxVisitStartCandidates: optionInt(opts, "maxVisitStartCandidates", DEFAULT_MAX_STARTS),
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
      parallelVisitPlanScore: 0,
      reasons: [],
      searchMetadata: emptyMetadata(lines || [], blocks || [], opts)
    };
  }

  function wrapPhase11Plan(plan, lines, blocks, opts) {
    if (!plan) return null;
    if (plan.valid === false) {
      return invalidPlan(plan.reason || "invalid", [], lines, blocks, opts);
    }
    var sumService = 0;
    var wrappedLines = (plan.serviceLines || []).map(function (row, idx) {
      sumService += Number(row.durationMinutes) || 0;
      return Object.assign({}, row, { blockIndex: idx });
    });
    var elapsed = (plan.visitEndMin || 0) - (plan.visitStartMin || 0);
    var saved = sumService - elapsed;
    var bonus = efficiencyBonus(saved);
    var meta = plan.searchMetadata || {};
    return Object.assign({}, plan, {
      sumServiceMinutes: sumService,
      visitElapsedMinutes: elapsed,
      parallelMinutesSaved: saved,
      parallelEfficiencyBonus: bonus,
      parallelVisitPlanScore: plan.multiServicePlanScore,
      blocks: (plan.serviceLines || []).map(function (row, idx) {
        return {
          blockIndex: idx,
          parallel: false,
          startMin: row.startMin,
          endMin: row.endMin,
          durationMinutes: row.durationMinutes,
          lineKeys: [row.lineKey]
        };
      }),
      serviceLines: wrappedLines,
      searchMetadata: emptyMetadata(lines, blocks, opts, {
        visitStartCandidateCount: meta.visitStartCandidateCount || 0,
        providerCandidatesByLine: meta.providerCandidatesByLine || lines.map(function () { return 0; }),
        evaluatedBlockAssignments: meta.evaluatedPlanCount || 0,
        evaluatedVisitPlans: meta.evaluatedPlanCount || 0,
        truncated: !!meta.truncated,
        exhaustive: meta.exhaustive !== false && !meta.truncated
      })
    });
  }

  function enumerateBlockAssignments(block, daysById, startMin, snap, maxProviders, maxCombos) {
    var providerCut = false;
    var rankedByLine = block.lines.map(function (line) {
      var ranked = rankProvidersForLine(daysById, line, startMin, snap);
      if (ranked.length > maxProviders) providerCut = true;
      return ranked.slice(0, maxProviders);
    });
    var combos = [];
    var truncated = false;
    function dfs(index, used, picks) {
      if (combos.length >= maxCombos) {
        truncated = true;
        return;
      }
      if (index >= block.lines.length) {
        combos.push(picks);
        return;
      }
      var ranked = rankedByLine[index];
      var i;
      for (i = 0; i < ranked.length; i += 1) {
        if (truncated) return;
        var pick = ranked[i];
        if (block.parallel && used[pick.providerId]) continue;
        var nextUsed = Object.assign({}, used);
        nextUsed[pick.providerId] = true;
        dfs(index + 1, nextUsed, picks.concat([{ line: block.lines[index], assignment: pick }]));
      }
    }
    dfs(0, {}, []);
    return { combos: combos, truncated: truncated, providerCut: providerCut, rankedByLine: rankedByLine };
  }

  function rankParallelMultiServiceVisitPlans(providerDays, request, options) {
    var opts = options && typeof options === "object" ? options : {};
    var req = request && typeof request === "object" ? request : {};
    var maxLines = optionInt(opts, "maxServiceLines", DEFAULT_MAX_LINES);
    var maxParallel = optionInt(opts, "maxParallelLinesPerBlock", DEFAULT_MAX_PARALLEL);
    var maxProviders = optionInt(opts, "maxProvidersPerLine", DEFAULT_MAX_PROVIDERS);
    var maxStarts = optionInt(opts, "maxVisitStartCandidates", DEFAULT_MAX_STARTS);
    var maxBlock = optionInt(opts, "maxBlockAssignments", DEFAULT_MAX_BLOCK);
    var maxEvaluated = optionInt(opts, "maxEvaluatedVisitPlans", DEFAULT_MAX_EVALUATED);
    var maxReturned = optionInt(opts, "maxReturnedPlans", DEFAULT_MAX_RETURNED);
    var snapMinutes = optionInt(opts, "snapMinutes", optionInt(req, "snapMinutes", DEFAULT_SNAP));
    var days = (Array.isArray(providerDays) ? providerDays : []).map(asDay);
    var lines = parseLines(req);
    var blocks = buildBlocks(lines);
    if (lines.length > maxLines) return [invalidPlan("too_many_service_lines_for_phase12", days, lines, blocks, opts)];
    var invalid = validateRequest(days, lines, blocks, maxParallel);
    if (invalid) return [invalidPlan(invalid, days, lines, blocks, opts)];

    if (!hasParallelGroups(lines) && typeof ns().rankMultiServiceVisitPlans === "function") {
      return ns().rankMultiServiceVisitPlans(providerDays, req, opts).map(function (plan) {
        return wrapPhase11Plan(plan, lines, blocks, opts);
      }).filter(Boolean);
    }

    var daysById = {};
    days.forEach(function (day) { daysById[trimText(day.providerId)] = day; });
    var startInfo = collectVisitStarts(daysById, blocks[0], req, snapMinutes, maxStarts);
    var evaluated = 0;
    var evaluatedBlocks = 0;
    var validPlans = [];
    var hitCap = false;
    var blockBoundHit = false;
    var providerBoundHit = false;
    var providerCandidatesByLine = lines.map(function () { return 0; });
    var lineIndex = {};
    lines.forEach(function (line, idx) { lineIndex[line.lineKey] = idx; });

    function recordCandidates(rankedByLine, block) {
      block.lines.forEach(function (line, idx) {
        var count = (rankedByLine[idx] || []).length;
        var at = lineIndex[line.lineKey];
        if (count > providerCandidatesByLine[at]) providerCandidatesByLine[at] = count;
      });
    }

    function consider(chosen, visitStartMin, usedAlternative) {
      if (evaluated >= maxEvaluated) {
        hitCap = true;
        return;
      }
      evaluated += 1;
      var plan = scoreCompleteVisit(days, chosen, blocks, visitStartMin, req, opts, usedAlternative);
      if (plan) validPlans.push(plan);
    }

    function search(blockIndex, visitStartMin, cursor, simulated, chosen, usedAlternative) {
      if (hitCap) return;
      if (blockIndex >= blocks.length) {
        consider(chosen, visitStartMin, usedAlternative);
        return;
      }
      var block = blocks[blockIndex];
      var enumerated = enumerateBlockAssignments(block, simulated, cursor, snapMinutes, maxProviders, maxBlock);
      evaluatedBlocks += enumerated.combos.length;
      if (enumerated.truncated) blockBoundHit = true;
      if (enumerated.providerCut) providerBoundHit = true;
      recordCandidates(enumerated.rankedByLine, block);
      enumerated.combos.forEach(function (combo) {
        if (hitCap) return;
        var nextDays = copyDaysMap(simulated);
        var alt = usedAlternative;
        var ok = combo.every(function (row, idx) {
          var ranked = enumerated.rankedByLine[idx] || [];
          if (ranked[0] && row.assignment.providerId !== ranked[0].providerId) alt = true;
          nextDays[row.assignment.providerId] = insertVisitLine(nextDays[row.assignment.providerId], row.line, cursor);
          return !worsensOverlap(
            nextDays[row.assignment.providerId].occupied,
            allowedOverlapOf(nextDays[row.assignment.providerId]),
            daysById[row.assignment.providerId]
          );
        });
        if (!ok) return;
        search(blockIndex + 1, visitStartMin, cursor + block.durationMinutes, nextDays, chosen.concat(combo), alt);
      });
    }

    startInfo.starts.forEach(function (startMin) {
      if (!hitCap) search(0, startMin, startMin, copyDaysMap(daysById), [], false);
    });

    var truncated = hitCap || blockBoundHit || providerBoundHit || startInfo.allCount > startInfo.starts.length;
    validPlans.sort(compareParallelPlans);
    var returned = validPlans.slice(0, maxReturned);
    var metadata = emptyMetadata(lines, blocks, opts, {
      visitStartCandidateCount: startInfo.starts.length,
      providerCandidatesByLine: providerCandidatesByLine,
      evaluatedBlockAssignments: evaluatedBlocks,
      evaluatedVisitPlans: evaluated,
      truncated: truncated,
      exhaustive: !truncated
    });
    returned.forEach(function (plan) { plan.searchMetadata = metadata; });
    return returned;
  }

  function recommendParallelMultiServiceVisit(providerDays, request, options) {
    var ranked = rankParallelMultiServiceVisitPlans(providerDays, request, options);
    if (!ranked.length) return null;
    if (ranked[0] && ranked[0].valid === false) return ranked[0];
    return ranked[0] || null;
  }

  var api = ns();
  api.rankParallelMultiServiceVisitPlans = rankParallelMultiServiceVisitPlans;
  api.recommendParallelMultiServiceVisit = recommendParallelMultiServiceVisit;
  api.compareParallelMultiServiceVisitPlans = compareParallelPlans;
  api.PHASE12_INTERNALS = {
    parseLines: parseLines,
    buildBlocks: buildBlocks,
    validateRequest: validateRequest,
    collectVisitStarts: collectVisitStarts,
    rankProvidersForLine: rankProvidersForLine,
    scoreCompleteVisit: scoreCompleteVisit,
    compareParallelPlans: compareParallelPlans,
    enumerateBlockAssignments: enumerateBlockAssignments,
    insertVisitLine: insertVisitLine,
    copyDaysMap: copyDaysMap,
    asDay: asDay,
    optionInt: optionInt
  };
  api.PARALLEL_MULTI_SERVICE = {
    BASE: BASE,
    EFFICIENCY_CAP: EFFICIENCY_CAP,
    DEFAULT_MAX_SERVICE_LINES: DEFAULT_MAX_LINES,
    DEFAULT_MAX_PARALLEL_LINES_PER_BLOCK: DEFAULT_MAX_PARALLEL,
    DEFAULT_MAX_PROVIDERS_PER_LINE: DEFAULT_MAX_PROVIDERS,
    DEFAULT_MAX_VISIT_START_CANDIDATES: DEFAULT_MAX_STARTS,
    DEFAULT_MAX_BLOCK_ASSIGNMENTS: DEFAULT_MAX_BLOCK,
    DEFAULT_MAX_EVALUATED_VISIT_PLANS: DEFAULT_MAX_EVALUATED,
    DEFAULT_MAX_RETURNED_PLANS: DEFAULT_MAX_RETURNED
  };
})();
