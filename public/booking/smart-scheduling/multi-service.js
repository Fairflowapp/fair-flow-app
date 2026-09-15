/**
 * Smart Scheduling Phase 11 — sequential multi-service visit planner.
 *
 * Recommendation-only. One client, one location, one date, fixed line
 * order, contiguous services, no client idle time. Keeps Phase 4
 * provider alternatives long enough to optimize the complete visit.
 *
 * multiServicePlanScoreRaw =
 *     50
 *   + slotFitComponent
 *   + clamp(optimizationDeltaAverage, -20, +20)
 *   - clamp(max(0, fragmentationDeltaAverage), 0, 20)
 *   + clamp(max(0, -fragmentationDeltaAverage), 0, 15)
 *   - clamp(max(0, strandedBetweenMinutesDeltaPercent), 0, 15)
 *   + timePreferenceBonus
 *   - overlapPenalty
 *
 * slotFitComponent = clamp(round((meanSlotScore - 50) * 0.40), -20, +20)
 * overlapPenalty = min(20, overlapLineCount * 5)
 * multiServicePlanScore = clamp(0, 100, multiServicePlanScoreRaw)
 */
(function () {
  var VISIT_LINE_PREFIX = "__smart_visit__";
  var BASE = 50;
  var SLOT_FIT_CLAMP = 20;
  var OPT_CLAMP = 20;
  var FRAG_PENALTY_CAP = 20;
  var FRAG_BONUS_CAP = 15;
  var STRANDED_PENALTY_CAP = 15;
  var OVERLAP_ACTION_PENALTY = 5;
  var OVERLAP_PENALTY_CAP = 20;
  var DEFAULT_SNAP = 15;
  var DEFAULT_MAX_LINES = 4;
  var DEFAULT_MAX_PROVIDERS = 5;
  var DEFAULT_MAX_STARTS = 40;
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
    if (typeof api.clampScore === "function") return api.clampScore(value);
    return clampInt(value, 0, 100);
  }

  function optionInt(opts, key, fallback) {
    if (!opts || opts[key] == null || opts[key] === "") return fallback;
    var n = Math.round(Number(opts[key]));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function optionMin(obj, key) {
    if (!obj || obj[key] == null || obj[key] === "") return null;
    var n = Number(obj[key]);
    if (!Number.isFinite(n)) return null;
    return Math.round(n);
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

  function analyzeDay(day, options) {
    var api = ns();
    if (typeof api.analyzeProviderDay !== "function") {
      return {
        workingMinutes: 0,
        occupiedMinutes: 0,
        utilizationPercent: 0,
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

  function baselineMapOf(day) {
    var api = ns();
    if (typeof api.baselineConflictMap === "function") return api.baselineConflictMap(day);
    return {};
  }

  function worsensOverlap(occupied, allowed, baseline) {
    var api = ns();
    if (typeof api.newOrWorsenedOverlapConflict === "function") {
      return api.newOrWorsenedOverlapConflict(occupied, allowed, baseline);
    }
    return false;
  }

  function visitLineId(lineKey) {
    return VISIT_LINE_PREFIX + "|" + trimText(lineKey);
  }

  function assignmentTypeOf(line) {
    var raw = trimText(line && line.assignmentType);
    if (raw === "specific_provider" || raw === "any_provider") return raw;
    return "any_provider";
  }

  function eligibleIdsOf(line) {
    return (line && Array.isArray(line.eligibleProviderIds) ? line.eligibleProviderIds : []).map(trimText).filter(Boolean);
  }

  function parseLines(request) {
    return (request && Array.isArray(request.serviceLines) ? request.serviceLines : []).map(function (row) {
      return {
        lineKey: trimText(row && row.lineKey),
        serviceId: trimText(row && row.serviceId),
        durationMinutes: Math.round(Number(row && row.durationMinutes)),
        eligibleProviderIds: eligibleIdsOf(row),
        assignmentType: assignmentTypeOf(row),
        requestedProviderId: trimText(row && row.requestedProviderId)
      };
    });
  }

  function validateRequest(days, lines) {
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

  function lineOffsets(lines) {
    var offsets = [];
    var cursor = 0;
    lines.forEach(function (line) {
      offsets.push(cursor);
      cursor += line.durationMinutes;
    });
    return { offsets: offsets, total: cursor };
  }

  function firstSnapped(winStart, snap) {
    var start = Number(winStart);
    var stepped = Math.ceil(start / snap) * snap;
    if (stepped < start) stepped += snap;
    return stepped;
  }

  function line1Days(daysById, line) {
    var ids = line.assignmentType === "specific_provider"
      ? [line.requestedProviderId]
      : line.eligibleProviderIds;
    return ids.map(function (id) { return daysById[id]; }).filter(Boolean);
  }

  function startFitsWorking(startMin, duration, days) {
    var endMin = startMin + duration;
    return (days || []).some(function (day) {
      return (day.workingIntervals || []).some(function (win) {
        return startMin >= win.startMin && endMin <= win.endMin;
      });
    });
  }

  function flexibilityOf(request) {
    if (!request || request.preferredStartMin == null || request.preferredStartMin === "") return 0;
    if (request.flexibilityMinutes == null || request.flexibilityMinutes === "") return 0;
    var n = Math.round(Number(request.flexibilityMinutes));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function collectVisitStarts(daysById, lines, request, snap, maxStarts) {
    var preferred = optionMin(request, "preferredStartMin");
    var flex = flexibilityOf(request);
    var earliest = optionMin(request, "earliestStartMin");
    var latest = optionMin(request, "latestStartMin");
    var duration = lines[0].durationMinutes;
    var hosts = line1Days(daysById, lines[0]);
    var found = {};

    function add(startMin) {
      if (!Number.isFinite(startMin)) return;
      if (earliest != null && startMin < earliest) return;
      if (latest != null && startMin > latest) return;
      if (!startFitsWorking(startMin, duration, hosts)) return;
      found[startMin] = true;
    }

    if (preferred != null && flex === 0) {
      add(preferred);
    } else if (preferred != null) {
      add(preferred);
      var lo = preferred - flex;
      var hi = preferred + flex;
      hosts.forEach(function (day) {
        (day.workingIntervals || []).forEach(function (win) {
          var start = firstSnapped(Math.max(win.startMin, lo), snap);
          while (start + duration <= win.endMin && start <= hi) {
            add(start);
            start += snap;
          }
        });
      });
    } else {
      hosts.forEach(function (day) {
        (day.workingIntervals || []).forEach(function (win) {
          var start = firstSnapped(win.startMin, snap);
          while (start + duration <= win.endMin) {
            add(start);
            start += snap;
          }
        });
      });
    }

    var starts = Object.keys(found).map(function (key) { return Number(key); });
    starts.sort(function (a, b) {
      if (preferred != null) {
        var da = Math.abs(a - preferred);
        var db = Math.abs(b - preferred);
        if (da !== db) return da - db;
      }
      return a - b;
    });
    return {
      allCount: starts.length,
      starts: starts.slice(0, maxStarts)
    };
  }

  function daysForLine(daysById, line) {
    var ids = line.assignmentType === "specific_provider"
      ? [line.requestedProviderId]
      : line.eligibleProviderIds;
    return ids.map(function (id) { return daysById[id]; }).filter(Boolean);
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

  function slotConflicts(day, startMin, endMin) {
    var h = helpers();
    var allowed = allowedOverlapOf(day);
    return (day.occupied || []).some(function (row) {
      return h.isConflictMinutes
        ? h.isConflictMinutes(startMin, endMin, row.startMin, row.endMin, allowed)
        : false;
    });
  }

  function assignmentFromExactSlot(day, line, startMin, request) {
    var api = ns();
    var endMin = startMin + line.durationMinutes;
    if (typeof api.describePlacement !== "function" || slotConflicts(day, startMin, endMin)) return null;
    if (!api.describePlacement(day, startMin, endMin)) return null;
    var ranked = typeof api.rankProviderAssignmentCandidates === "function"
      ? api.rankProviderAssignmentCandidates([day], Object.assign({}, request, {
        preferredStartMin: startMin,
        allowNearbyStarts: false,
        snapMinutes: 1
      }))
      : [];
    return ranked.filter(function (row) { return row.startMin === startMin; })[0] || null;
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
    ranked = ranked.filter(function (row) { return row.startMin === startMin; });
    if (!ranked.length) {
      days.forEach(function (day) {
        var extra = assignmentFromExactSlot(day, line, startMin, request);
        if (extra) ranked.push(extra);
      });
    }
    var compare = api.compareAssignments;
    var unique = uniqueProviders(ranked);
    if (compare) unique.sort(compare);
    return unique;
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
    var compare = helpers().compareOccupied;
    if (compare) next.occupied.sort(compare);
    return next;
  }

  function copyDaysMap(daysById) {
    var out = {};
    Object.keys(daysById).forEach(function (id) {
      out[id] = copyDay(daysById[id]);
    });
    return out;
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

  function compareVisitPlans(a, b) {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    if (a.multiServicePlanScore !== b.multiServicePlanScore) {
      return b.multiServicePlanScore - a.multiServicePlanScore;
    }
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
    if (a.timeDistanceMinutes !== b.timeDistanceMinutes) {
      return a.timeDistanceMinutes - b.timeDistanceMinutes;
    }
    if (a.visitStartMin !== b.visitStartMin) return a.visitStartMin - b.visitStartMin;
    return String(a.assignmentKey || "").localeCompare(String(b.assignmentKey || ""));
  }

  function buildReasons(plan, usedAlternative) {
    var reasons = [];
    function add(code, text) {
      reasons.push({ code: code, text: text });
    }
    add("complete_multi_service_fit", "Every requested service line is placed sequentially with no client idle time.");
    if (plan.meanSlotScore >= 80) {
      add("strong_overall_slot_fit", "Mean Phase 1 slot score is in the best-fit range.");
    }
    if (plan.timePreferenceBonus === 10) {
      add("exact_preferred_start", "Visit starts at the preferred time.");
    } else if (plan.timePreferenceBonus === 7 || plan.timePreferenceBonus === 4) {
      add("near_preferred_start", "Visit starts near the preferred time.");
    }
    if (plan.optimizationDeltaTotal > 0) {
      add("improves_salon_optimization", "The complete visit improves total provider-day optimization.");
    }
    if (plan.fragmentationDeltaTotal < 0) {
      add("reduces_salon_fragmentation", "The complete visit reduces total provider-day fragmentation.");
    }
    if (plan.fragmentationDeltaTotal > 0) {
      add("creates_fragmentation", "The complete visit increases total provider-day fragmentation.");
    }
    if (plan.strandedBetweenMinutesDeltaTotal > 0) {
      add("creates_stranded_time", "The complete visit leaves more stranded between-gap minutes.");
    }
    if (plan.overlapLineCount > 0) {
      add("uses_permitted_overlap", "At least one visit line uses permitted overlap.");
    }
    if (usedAlternative) {
      add("uses_provider_alternative_for_complete_visit", "Chose a locally second-best provider so the complete visit could fit.");
    }
    return reasons;
  }

  function scoreCompleteVisit(originalDays, chosen, timing, request, options, usedAlternative) {
    var providerCount = originalDays.length;
    var simulatedById = {};
    originalDays.forEach(function (day) {
      simulatedById[trimText(day.providerId)] = copyDay(day);
    });
    var serviceLines = chosen.map(function (row, idx) {
      var startMin = timing.visitStartMin + timing.offsets[idx];
      simulatedById[row.assignment.providerId] = insertVisitLine(
        simulatedById[row.assignment.providerId],
        row.line,
        startMin
      );
      return {
        lineKey: row.line.lineKey,
        serviceId: row.line.serviceId,
        providerId: row.assignment.providerId,
        startMin: startMin,
        endMin: startMin + row.line.durationMinutes,
        durationMinutes: row.line.durationMinutes,
        slotScore: Number(row.assignment.slotScore) || 0,
        slotLabel: row.assignment.slotLabel || "",
        usesOverlap: !!row.assignment.usesOverlap,
        assignmentScore: Number(row.assignment.assignmentScore) || 0,
        assignmentLabel: row.assignment.assignmentLabel || "",
        assignmentType: row.line.assignmentType,
        reasons: row.assignment.reasons || []
      };
    });

    var invalid = originalDays.some(function (day) {
      var id = trimText(day.providerId);
      return worsensOverlap(
        simulatedById[id].occupied,
        allowedOverlapOf(day),
        baselineMapOf(day)
      );
    });
    if (invalid) return null;

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
    serviceLines.forEach(function (row) {
      slotSum += row.slotScore;
      if (row.usesOverlap) overlapLineCount += 1;
    });
    var meanSlotScore = Math.round(slotSum / serviceLines.length);
    var slotFitComponent = clampInt(Math.round((meanSlotScore - 50) * 0.40), -SLOT_FIT_CLAMP, SLOT_FIT_CLAMP);
    var preferred = optionMin(request, "preferredStartMin");
    var timeBonus = timePreferenceBonus(timing.visitStartMin, preferred);
    var optDelta = optAfter - optBefore;
    var fragDelta = fragAfter - fragBefore;
    var strandedDelta = strandedAfter - strandedBefore;
    var optAvg = providerCount === 0 ? 0 : Math.round(optDelta / providerCount);
    var fragAvg = providerCount === 0 ? 0 : Math.round(fragDelta / providerCount);
    var strandedPct = working === 0 ? 0 : Math.round(100 * strandedDelta / working);
    var overlapPenalty = Math.min(OVERLAP_PENALTY_CAP, overlapLineCount * OVERLAP_ACTION_PENALTY);
    var raw = BASE;
    raw += slotFitComponent;
    raw += clampInt(optAvg, -OPT_CLAMP, OPT_CLAMP);
    raw -= clampInt(Math.max(0, fragAvg), 0, FRAG_PENALTY_CAP);
    raw += clampInt(Math.max(0, -fragAvg), 0, FRAG_BONUS_CAP);
    raw -= clampInt(Math.max(0, strandedPct), 0, STRANDED_PENALTY_CAP);
    raw += timeBonus;
    raw -= overlapPenalty;

    var plan = {
      valid: true,
      reason: "",
      dateKey: trimText(originalDays[0] && originalDays[0].dateKey),
      locationId: trimText(originalDays[0] && originalDays[0].locationId),
      visitStartMin: timing.visitStartMin,
      visitEndMin: timing.visitStartMin + timing.total,
      totalVisitMinutes: timing.total,
      serviceLines: serviceLines,
      meanSlotScore: meanSlotScore,
      slotFitComponent: slotFitComponent,
      timePreferenceBonus: timeBonus,
      timeDistanceMinutes: preferred == null ? 0 : Math.abs(timing.visitStartMin - preferred),
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
      multiServicePlanScore: clampScore(raw)
    };
    plan.reasons = buildReasons(plan, usedAlternative);
    return plan;
  }

  function emptyMetadata(lines, opts, extras) {
    return Object.assign({
      serviceLineCount: (lines || []).length,
      visitStartCandidateCount: 0,
      providerCandidatesByLine: (lines || []).map(function () { return 0; }),
      evaluatedPlanCount: 0,
      validPlanCount: 0,
      maxServiceLines: optionInt(opts, "maxServiceLines", DEFAULT_MAX_LINES),
      maxProvidersPerLine: optionInt(opts, "maxProvidersPerLine", DEFAULT_MAX_PROVIDERS),
      maxVisitStartCandidates: optionInt(opts, "maxVisitStartCandidates", DEFAULT_MAX_STARTS),
      maxEvaluatedVisitPlans: optionInt(opts, "maxEvaluatedVisitPlans", DEFAULT_MAX_EVALUATED),
      truncated: false,
      exhaustive: false
    }, extras || {});
  }

  function invalidPlan(reason, days, lines, opts, extras) {
    var first = days && days[0];
    return Object.assign({
      valid: false,
      reason: reason,
      dateKey: trimText(first && first.dateKey),
      locationId: trimText(first && first.locationId),
      visitStartMin: 0,
      visitEndMin: 0,
      totalVisitMinutes: 0,
      serviceLines: [],
      multiServicePlanScore: 0,
      reasons: [],
      searchMetadata: emptyMetadata(lines || [], opts)
    }, extras || {});
  }

  function isolatedWinnerId(daysById, line, startMin, snapMinutes) {
    var ranked = rankProvidersForLine(daysById, line, startMin, snapMinutes);
    return ranked[0] ? ranked[0].providerId : "";
  }

  function rankMultiServiceVisitPlans(providerDays, request, options) {
    var opts = options && typeof options === "object" ? options : {};
    var req = request && typeof request === "object" ? request : {};
    var maxLines = optionInt(opts, "maxServiceLines", DEFAULT_MAX_LINES);
    var maxProviders = optionInt(opts, "maxProvidersPerLine", DEFAULT_MAX_PROVIDERS);
    var maxStarts = optionInt(opts, "maxVisitStartCandidates", DEFAULT_MAX_STARTS);
    var maxEvaluated = optionInt(opts, "maxEvaluatedVisitPlans", DEFAULT_MAX_EVALUATED);
    var maxReturned = optionInt(opts, "maxReturnedPlans", DEFAULT_MAX_RETURNED);
    var snapMinutes = optionInt(opts, "snapMinutes", optionInt(req, "snapMinutes", DEFAULT_SNAP));
    var rawDays = Array.isArray(providerDays) ? providerDays : [];
    var days = rawDays.map(asDay);
    var lines = parseLines(req);
    if (lines.length > maxLines) {
      return [invalidPlan("too_many_service_lines_for_phase11", days, lines, opts, {
        searchMetadata: emptyMetadata(lines, opts, { serviceLineCount: lines.length, truncated: false, exhaustive: false })
      })];
    }
    var invalid = validateRequest(days, lines);
    if (invalid) return [invalidPlan(invalid, days, lines, opts)];

    var daysById = {};
    days.forEach(function (day) { daysById[trimText(day.providerId)] = day; });
    var timingBase = lineOffsets(lines);
    var startInfo = collectVisitStarts(daysById, lines, req, snapMinutes, maxStarts);
    var preferred = optionMin(req, "preferredStartMin");
    var isolatedStarts = lines.map(function (line, idx) {
      if (idx === 0 && preferred != null) return preferred;
      return null;
    });

    var evaluated = 0;
    var validPlans = [];
    var hitCap = false;
    var providerBoundHit = false;
    var providerCandidatesByLine = lines.map(function () { return 0; });

    function consider(chosen, visitStartMin, usedAlternative) {
      if (evaluated >= maxEvaluated) {
        hitCap = true;
        return;
      }
      evaluated += 1;
      var plan = scoreCompleteVisit(days, chosen, {
        visitStartMin: visitStartMin,
        offsets: timingBase.offsets,
        total: timingBase.total
      }, req, opts, usedAlternative);
      if (!plan) return;
      validPlans.push(plan);
    }

    function dfs(lineIndex, visitStartMin, simulated, chosen, usedAlternative) {
      if (hitCap) return;
      if (lineIndex >= lines.length) {
        consider(chosen, visitStartMin, usedAlternative);
        return;
      }
      var line = lines[lineIndex];
      var lineStart = visitStartMin + timingBase.offsets[lineIndex];
      var ranked = rankProvidersForLine(simulated, line, lineStart, snapMinutes);
      if (ranked.length > maxProviders) {
        providerBoundHit = true;
        ranked = ranked.slice(0, maxProviders);
      }
      if (ranked.length > providerCandidatesByLine[lineIndex]) {
        providerCandidatesByLine[lineIndex] = ranked.length;
      }
      var localWinner = ranked[0] ? ranked[0].providerId : "";
      var isolatedStart = isolatedStarts[lineIndex];
      if (isolatedStart != null && !localWinner) {
        localWinner = isolatedWinnerId(daysById, line, isolatedStart, snapMinutes);
      }
      var i;
      for (i = 0; i < ranked.length; i += 1) {
        if (hitCap) return;
        var pick = ranked[i];
        var nextDays = copyDaysMap(simulated);
        nextDays[pick.providerId] = insertVisitLine(nextDays[pick.providerId], line, lineStart);
        if (worsensOverlap(nextDays[pick.providerId].occupied, allowedOverlapOf(nextDays[pick.providerId]), baselineMapOf(daysById[pick.providerId]))) {
          continue;
        }
        var alt = usedAlternative || (localWinner && pick.providerId !== localWinner);
        if (!alt && isolatedStart != null) {
          var isolated = isolatedWinnerId(daysById, line, isolatedStart, snapMinutes);
          if (isolated && pick.providerId !== isolated) alt = true;
        }
        dfs(lineIndex + 1, visitStartMin, nextDays, chosen.concat([{ line: line, assignment: pick }]), alt);
      }
    }

    var s;
    for (s = 0; s < startInfo.starts.length; s += 1) {
      if (hitCap) break;
      dfs(0, startInfo.starts[s], copyDaysMap(daysById), [], false);
    }

    var truncated = hitCap
      || startInfo.allCount > startInfo.starts.length
      || providerBoundHit;
    validPlans.sort(compareVisitPlans);
    var returned = validPlans.slice(0, maxReturned);
    var metadata = emptyMetadata(lines, opts, {
      visitStartCandidateCount: startInfo.starts.length,
      providerCandidatesByLine: providerCandidatesByLine,
      evaluatedPlanCount: evaluated,
      validPlanCount: validPlans.length,
      truncated: truncated,
      exhaustive: !truncated
    });
    returned.forEach(function (plan) {
      plan.searchMetadata = metadata;
    });
    return returned;
  }

  function recommendMultiServiceVisit(providerDays, request, options) {
    var ranked = rankMultiServiceVisitPlans(providerDays, request, options);
    if (!ranked.length) return null;
    if (ranked[0] && ranked[0].valid === false) return ranked[0];
    return ranked[0] || null;
  }

  var api = ns();
  api.rankMultiServiceVisitPlans = rankMultiServiceVisitPlans;
  api.recommendMultiServiceVisit = recommendMultiServiceVisit;
  api.compareMultiServiceVisitPlans = compareVisitPlans;
  api.MULTI_SERVICE = {
    VISIT_LINE_PREFIX: VISIT_LINE_PREFIX,
    BASE: BASE,
    SLOT_FIT_CLAMP: SLOT_FIT_CLAMP,
    OPT_CLAMP: OPT_CLAMP,
    FRAG_PENALTY_CAP: FRAG_PENALTY_CAP,
    FRAG_BONUS_CAP: FRAG_BONUS_CAP,
    STRANDED_PENALTY_CAP: STRANDED_PENALTY_CAP,
    OVERLAP_ACTION_PENALTY: OVERLAP_ACTION_PENALTY,
    OVERLAP_PENALTY_CAP: OVERLAP_PENALTY_CAP,
    DEFAULT_SNAP_MINUTES: DEFAULT_SNAP,
    DEFAULT_MAX_SERVICE_LINES: DEFAULT_MAX_LINES,
    DEFAULT_MAX_PROVIDERS_PER_LINE: DEFAULT_MAX_PROVIDERS,
    DEFAULT_MAX_VISIT_START_CANDIDATES: DEFAULT_MAX_STARTS,
    DEFAULT_MAX_EVALUATED_VISIT_PLANS: DEFAULT_MAX_EVALUATED,
    DEFAULT_MAX_RETURNED_PLANS: DEFAULT_MAX_RETURNED
  };
})();
