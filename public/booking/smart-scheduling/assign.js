/**
 * Smart Scheduling Phase 4 — multi-provider assignment ranking.
 *
 * Recommendation-only. Simulates inserting one new appointment onto each
 * eligible provider day, then ranks providers by operational day impact.
 *
 * Caller supplies eligible provider days. This module does not read the
 * catalog or apply requested-provider score weighting.
 *
 * assignmentType:
 *   specific_provider  evaluate ONLY requestedProviderId
 *                      missing / not supplied → no assignment
 *   any_provider       rank supplied providers by calendar fit
 *
 * preferredStartMin, when set, evaluates that exact start only.
 * Nearby alternatives require allowNearbyStarts === true.
 *
 * assignmentScoreRaw =
 *     slotScore
 *   + clamp(optimizationDelta, -15, +15)
 *   - clamp(max(0, fragmentationDelta), 0, 15)
 *   + clamp(max(0, -fragmentationDelta), 0, 10)
 *   - clamp(max(0, strandedBetweenMinutesDelta), 0, 15)
 *   + (closesExistingGap ? 10 : 0)
 *   + underutilizationBonus
 *
 * underutilizationBonus = min(5, max(0, round((100 - utilizationBefore) * 0.05)))
 *
 * assignmentScore = clamp(0–100, assignmentScoreRaw)
 *
 * Overlap is not penalized again if Phase 1 already applied
 * uses_permitted_overlap.
 *
 * rankProviderAssignments returns one best placement per provider.
 */
(function () {
  var CANDIDATE_LINE_ID = "__smart_assignment_candidate__";
  var CLOSE_GAP_BONUS = 10;
  var OPT_CLAMP = 15;
  var FRAG_PENALTY_CAP = 15;
  var FRAG_BONUS_CAP = 10;
  var STRANDED_PENALTY_CAP = 15;
  var UNDERUTIL_CAP = 5;

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

  function labelFor(score) {
    var api = ns();
    if (typeof api.labelForScore === "function") return api.labelForScore(score);
    if (score >= 80) return "best_fit";
    if (score >= 60) return "good_fit";
    if (score >= 40) return "available";
    return "low_fit";
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

  function requestedIdOf(request) {
    return trimText(request && request.requestedProviderId);
  }

  function assignmentTypeOf(request) {
    var raw = trimText(request && request.assignmentType);
    if (raw === "specific_provider" || raw === "any_provider") return raw;
    return "any_provider";
  }

  function preferredStartOf(request) {
    if (!request || request.preferredStartMin == null || request.preferredStartMin === "") return null;
    var n = Number(request.preferredStartMin);
    if (!Number.isFinite(n)) return null;
    return Math.round(n);
  }

  function eligibleDays(days, request) {
    var list = (Array.isArray(days) ? days : []).map(asDay);
    if (assignmentTypeOf(request) !== "specific_provider") return list;
    var requestedId = requestedIdOf(request);
    if (!requestedId) return [];
    return list.filter(function (day) {
      return trimText(day && day.providerId) === requestedId;
    });
  }

  function analyzeDay(day, request) {
    var api = ns();
    if (typeof api.analyzeProviderDay !== "function") {
      return {
        utilizationPercent: 0,
        optimizationScore: 0,
        fragmentationScore: 0,
        betweenGapCount: 0,
        strandedBetweenGapMinutes: 0,
        gaps: []
      };
    }
    return api.analyzeProviderDay(day, request);
  }

  function dayWithCandidate(day, slot) {
    var occupied = copyOccupied(day && day.occupied);
    occupied.push({
      lineId: CANDIDATE_LINE_ID,
      appointmentId: CANDIDATE_LINE_ID,
      providerId: trimText(day && day.providerId),
      startMin: slot.startMin,
      endMin: slot.endMin,
      durationMinutes: slot.endMin - slot.startMin,
      status: "scheduled",
      serviceId: "",
      requested: false
    });
    var compare = helpers().compareOccupied;
    if (compare) occupied.sort(compare);
    return {
      dateKey: trimText(day && day.dateKey),
      locationId: trimText(day && day.locationId),
      providerId: trimText(day && day.providerId),
      allowedOverlapMinutes: day && day.allowedOverlapMinutes != null ? day.allowedOverlapMinutes : 0,
      workingIntervals: copyIntervals(day && day.workingIntervals),
      occupied: occupied
    };
  }

  function betweenGapsOf(analysis) {
    return (analysis && analysis.gaps || []).filter(function (gap) {
      return gap.kind === "between";
    });
  }

  function containedInBeforeGap(afterGap, beforeGap) {
    return afterGap.workingIntervalIndex === beforeGap.workingIntervalIndex
      && afterGap.startMin >= beforeGap.startMin
      && afterGap.endMin <= beforeGap.endMin;
  }

  function closesExistingGap(before, slot) {
    return (before && before.gaps || []).some(function (gap) {
      if (gap.kind !== "between") return false;
      return slot.startMin <= gap.startMin && slot.endMin >= gap.endMin;
    });
  }

  function createsBetweenGap(before, after) {
    var beforeGaps = betweenGapsOf(before);
    var afterGaps = betweenGapsOf(after);
    var i;
    var j;
    for (i = 0; i < afterGaps.length; i += 1) {
      var contained = false;
      for (j = 0; j < beforeGaps.length; j += 1) {
        if (containedInBeforeGap(afterGaps[i], beforeGaps[j])) {
          contained = true;
          break;
        }
      }
      if (!contained) return true;
    }
    for (j = 0; j < beforeGaps.length; j += 1) {
      var remainders = 0;
      for (i = 0; i < afterGaps.length; i += 1) {
        if (containedInBeforeGap(afterGaps[i], beforeGaps[j])) remainders += 1;
      }
      if (remainders >= 2) return true;
    }
    return false;
  }

  function underutilizationBonusOf(utilizationBefore) {
    var bonus = Math.round((100 - Number(utilizationBefore || 0)) * 0.05);
    if (bonus < 0) bonus = 0;
    if (bonus > UNDERUTIL_CAP) bonus = UNDERUTIL_CAP;
    return bonus;
  }

  function slotsForDay(day, request) {
    var api = ns();
    var slots = typeof api.rankSlots === "function" ? api.rankSlots(day, request) : [];
    var preferred = preferredStartOf(request);
    if (preferred == null || request.allowNearbyStarts === true) return slots;
    return slots.filter(function (slot) { return slot.startMin === preferred; });
  }

  function assignmentReasons(impact) {
    var reasons = [];
    function add(code, delta, text) {
      reasons.push({ code: code, delta: delta, text: text });
    }
    if (impact.cleanCalendarFit) {
      add("clean_calendar_fit", 0, "Places the appointment without creating a between-gap or extra fragmentation.");
    }
    if (impact.closesExistingGap) {
      add("closes_existing_gap", CLOSE_GAP_BONUS, "Fills an existing gap between appointments.");
    }
    if (impact.optimizationDelta > 0) {
      add("improves_day_optimization", clampInt(impact.optimizationDelta, -OPT_CLAMP, OPT_CLAMP), "Improves the provider day's optimization score.");
    }
    if (impact.fragmentationDelta < 0) {
      add("reduces_fragmentation", clampInt(-impact.fragmentationDelta, 0, FRAG_BONUS_CAP), "Reduces fragmentation on this provider day.");
    }
    if (impact.createsBetweenGap) {
      add("creates_between_gap", 0, "Creates a new gap between appointments.");
    }
    if (impact.fragmentationDelta > 0) {
      add("increases_fragmentation", -clampInt(impact.fragmentationDelta, 0, FRAG_PENALTY_CAP), "Increases fragmentation on this provider day.");
    }
    if (impact.strandedBetweenMinutesDelta > 0) {
      add("creates_stranded_time", -clampInt(impact.strandedBetweenMinutesDelta, 0, STRANDED_PENALTY_CAP), "Leaves more stranded time between appointments.");
    }
    if (impact.underutilizationBonus > 0) {
      add("underutilized_provider", impact.underutilizationBonus, "This provider still has unused working time.");
    }
    if (impact.usesOverlap) {
      add("uses_permitted_overlap", 0, "Uses permitted overlap already penalized in the slot score.");
    }
    return reasons;
  }

  function scoreAssignment(slotScore, impact) {
    var raw = Number(slotScore) || 0;
    raw += clampInt(impact.optimizationDelta, -OPT_CLAMP, OPT_CLAMP);
    raw -= clampInt(Math.max(0, impact.fragmentationDelta), 0, FRAG_PENALTY_CAP);
    raw += clampInt(Math.max(0, -impact.fragmentationDelta), 0, FRAG_BONUS_CAP);
    raw -= clampInt(Math.max(0, impact.strandedBetweenMinutesDelta), 0, STRANDED_PENALTY_CAP);
    if (impact.closesExistingGap) raw += CLOSE_GAP_BONUS;
    raw += impact.underutilizationBonus;
    return clampScore(raw);
  }

  function toAssignment(day, slot, request, before) {
    var simulated = dayWithCandidate(day, slot);
    var after = analyzeDay(simulated, request);
    var optimizationBefore = before.optimizationScore || 0;
    var optimizationAfter = after.optimizationScore || 0;
    var fragmentationBefore = before.fragmentationScore || 0;
    var fragmentationAfter = after.fragmentationScore || 0;
    var utilizationBefore = before.utilizationPercent || 0;
    var utilizationAfter = after.utilizationPercent || 0;
    var betweenGapCountBefore = before.betweenGapCount || 0;
    var betweenGapCountAfter = after.betweenGapCount || 0;
    var strandedBefore = before.strandedBetweenGapMinutes || 0;
    var strandedAfter = after.strandedBetweenGapMinutes || 0;
    var impact = {
      optimizationDelta: optimizationAfter - optimizationBefore,
      fragmentationDelta: fragmentationAfter - fragmentationBefore,
      strandedBetweenMinutesDelta: strandedAfter - strandedBefore,
      closesExistingGap: closesExistingGap(before, slot),
      createsBetweenGap: createsBetweenGap(before, after),
      usesOverlap: !!slot.usesOverlap,
      underutilizationBonus: underutilizationBonusOf(utilizationBefore)
    };
    impact.cleanCalendarFit = !impact.createsBetweenGap
      && !(impact.fragmentationDelta > 0)
      && !(impact.strandedBetweenMinutesDelta > 0)
      && !impact.usesOverlap;
    var assignmentScore = scoreAssignment(slot.score, impact);
    var reasons = assignmentReasons(impact);
    return {
      providerId: trimText(day && day.providerId),
      dateKey: trimText(day && day.dateKey),
      locationId: trimText(day && day.locationId),
      startMin: slot.startMin,
      endMin: slot.endMin,
      durationMinutes: slot.durationMinutes,
      workingIntervalIndex: slot.workingIntervalIndex,
      slotScore: Number(slot.score) || 0,
      slotLabel: slot.label || labelFor(slot.score),
      assignmentScore: assignmentScore,
      assignmentLabel: labelFor(assignmentScore),
      optimizationBefore: optimizationBefore,
      optimizationAfter: optimizationAfter,
      optimizationDelta: impact.optimizationDelta,
      utilizationBefore: utilizationBefore,
      utilizationAfter: utilizationAfter,
      fragmentationBefore: fragmentationBefore,
      fragmentationAfter: fragmentationAfter,
      fragmentationDelta: impact.fragmentationDelta,
      betweenGapCountBefore: betweenGapCountBefore,
      betweenGapCountAfter: betweenGapCountAfter,
      strandedBetweenGapMinutesBefore: strandedBefore,
      strandedBetweenGapMinutesAfter: strandedAfter,
      strandedBetweenMinutesDelta: impact.strandedBetweenMinutesDelta,
      closesExistingGap: impact.closesExistingGap,
      createsBetweenGap: impact.createsBetweenGap,
      usesOverlap: impact.usesOverlap,
      underutilizationBonus: impact.underutilizationBonus,
      assignmentType: assignmentTypeOf(request),
      reasons: reasons
    };
  }

  function compareAssignments(a, b) {
    if (b.assignmentScore !== a.assignmentScore) return b.assignmentScore - a.assignmentScore;
    if (b.slotScore !== a.slotScore) return b.slotScore - a.slotScore;
    if (b.optimizationDelta !== a.optimizationDelta) return b.optimizationDelta - a.optimizationDelta;
    if (a.fragmentationAfter !== b.fragmentationAfter) return a.fragmentationAfter - b.fragmentationAfter;
    if (a.strandedBetweenGapMinutesAfter !== b.strandedBetweenGapMinutesAfter) {
      return a.strandedBetweenGapMinutesAfter - b.strandedBetweenGapMinutesAfter;
    }
    if (!!a.usesOverlap !== !!b.usesOverlap) return a.usesOverlap ? 1 : -1;
    if (a.startMin !== b.startMin) return a.startMin - b.startMin;
    return String(a.providerId || "").localeCompare(String(b.providerId || ""));
  }

  function bestPerProvider(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (row) {
      var key = String(row.providerId || "");
      if (seen[key]) return;
      seen[key] = true;
      out.push(row);
    });
    return out;
  }

  function rankProviderAssignmentCandidates(days, request) {
    var req = request && typeof request === "object" ? request : {};
    var assignments = [];
    eligibleDays(days, req).forEach(function (day) {
      var before = analyzeDay(day, req);
      slotsForDay(day, req).forEach(function (slot) {
        assignments.push(toAssignment(day, slot, req, before));
      });
    });
    return assignments.sort(compareAssignments);
  }

  function rankProviderAssignments(days, request) {
    return bestPerProvider(rankProviderAssignmentCandidates(days, request));
  }

  function recommendProviderAssignment(days, request) {
    var ranked = rankProviderAssignments(days, request);
    return ranked[0] || null;
  }

  var api = ns();
  api.rankProviderAssignments = rankProviderAssignments;
  api.rankProviderAssignmentCandidates = rankProviderAssignmentCandidates;
  api.recommendProviderAssignment = recommendProviderAssignment;
  api.compareAssignments = compareAssignments;
  api.dayWithAssignmentCandidate = dayWithCandidate;
  api.ASSIGN = {
    CANDIDATE_LINE_ID: CANDIDATE_LINE_ID,
    CLOSE_GAP_BONUS: CLOSE_GAP_BONUS,
    OPT_CLAMP: OPT_CLAMP,
    FRAG_PENALTY_CAP: FRAG_PENALTY_CAP,
    FRAG_BONUS_CAP: FRAG_BONUS_CAP,
    STRANDED_PENALTY_CAP: STRANDED_PENALTY_CAP,
    UNDERUTIL_CAP: UNDERUTIL_CAP
  };
})();
