/**
 * Smart Scheduling Phase 6 — waitlist matching intelligence.
 *
 * Recommendation-only. Ranks caller-supplied waitlist requests against one
 * true open window on one provider day. No storage, outreach, or booking.
 *
 * waitlistMatchScoreRaw =
 *     slotScore
 *   + clamp(optimizationDelta, -15, +15)
 *   - clamp(max(0, fragmentationDelta), 0, 15)
 *   + clamp(max(0, -fragmentationDelta), 0, 10)
 *   - clamp(max(0, strandedBetweenMinutesDelta), 0, 15)
 *   + openingFitBonus
 *   + timePreferenceBonus
 *
 * openingFitBonus (one outcome only):
 *   exact_fill          +15
 *   usable_remainder    +8
 *   stranded_remainder  −10
 *
 * timePreferenceBonus when preferredStartMin exists:
 *   exact → +10, within 15 → +7, within 30 → +4,
 *   otherwise within allowed flexibility → +1
 *
 * waitlistMatchScore = clamp(0–100, waitlistMatchScoreRaw)
 *
 * No second overlap penalty. createdAtOrder is a late tie-break only.
 * Missing createdAtOrder sorts after any finite value; it never scores.
 */
(function () {
  var DEFAULT_REFERENCE = 30;
  var DEFAULT_MIN_MATCH = 50;
  var OPT_CLAMP = 15;
  var FRAG_PENALTY_CAP = 15;
  var FRAG_BONUS_CAP = 10;
  var STRANDED_PENALTY_CAP = 15;
  var EXACT_FILL_BONUS = 15;
  var USABLE_REMAINDER_BONUS = 8;
  var STRANDED_REMAINDER_PENALTY = -10;
  var FIT_RANK = { exact_fill: 0, usable_remainder: 1, stranded_remainder: 2 };

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

  function optionalMin(value) {
    if (value == null || value === "") return null;
    var n = Number(value);
    if (!Number.isFinite(n)) return null;
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

  function openingOf(raw) {
    var startMin = Number(raw && raw.startMin);
    var endMin = Number(raw && raw.endMin);
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || !(endMin > startMin)) return null;
    return { startMin: startMin, endMin: endMin, minutes: endMin - startMin };
  }

  function assignmentTypeOf(request) {
    var raw = trimText(request && request.assignmentType);
    if (raw === "specific_provider" || raw === "any_provider") return raw;
    return "any_provider";
  }

  function createdAtOrderOf(value) {
    if (value == null || value === "") return null;
    if (typeof value === "string" && !trimText(value)) return null;
    var n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.round(n);
  }

  function requestOf(raw) {
    if (!raw || typeof raw !== "object") return null;
    var waitlistId = trimText(raw.waitlistId);
    if (!waitlistId) return null;
    var durationMinutes = Math.round(Number(raw.durationMinutes));
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;
    return {
      waitlistId: waitlistId,
      clientId: trimText(raw.clientId),
      serviceId: trimText(raw.serviceId),
      durationMinutes: durationMinutes,
      requestedProviderId: trimText(raw.requestedProviderId),
      assignmentType: assignmentTypeOf(raw),
      preferredStartMin: optionalMin(raw.preferredStartMin),
      earliestStartMin: optionalMin(raw.earliestStartMin),
      latestStartMin: optionalMin(raw.latestStartMin),
      flexibilityMinutes: raw.flexibilityMinutes == null || raw.flexibilityMinutes === ""
        ? null
        : Math.max(0, Math.round(Number(raw.flexibilityMinutes)) || 0),
      createdAtOrder: createdAtOrderOf(raw.createdAtOrder)
    };
  }

  function providerEligible(day, request) {
    if (request.assignmentType !== "specific_provider") return true;
    if (!request.requestedProviderId) return false;
    return request.requestedProviderId === trimText(day && day.providerId);
  }

  function startAllowed(startMin, request) {
    if (request.earliestStartMin != null && startMin < request.earliestStartMin) return false;
    if (request.latestStartMin != null && startMin > request.latestStartMin) return false;
    if (request.preferredStartMin == null) return true;
    var flex = request.flexibilityMinutes;
    if (flex == null || flex === 0) return startMin === request.preferredStartMin;
    return Math.abs(startMin - request.preferredStartMin) <= flex;
  }

  function timePreferenceBonus(startMin, request) {
    if (request.preferredStartMin == null) {
      return { bonus: 0, distance: 0 };
    }
    var distance = Math.abs(startMin - request.preferredStartMin);
    var bonus = 0;
    if (distance === 0) bonus = 10;
    else if (distance <= 15) bonus = 7;
    else if (distance <= 30) bonus = 4;
    else bonus = 1;
    return { bonus: bonus, distance: distance };
  }

  function leftoverKind(minutes, referenceMinutes) {
    if (!(minutes > 0)) return "none";
    if (minutes >= referenceMinutes) return "usable";
    return "stranded";
  }

  function openingFitOf(leftoverBefore, leftoverAfter, referenceMinutes) {
    if (!(leftoverBefore > 0) && !(leftoverAfter > 0)) {
      return {
        outcome: "exact_fill",
        bonus: EXACT_FILL_BONUS,
        createsStrandedOpeningRemainder: false,
        strandedOpeningRemainderMinutes: 0
      };
    }
    var beforeKind = leftoverKind(leftoverBefore, referenceMinutes);
    var afterKind = leftoverKind(leftoverAfter, referenceMinutes);
    var stranded = 0;
    if (beforeKind === "stranded") stranded += leftoverBefore;
    if (afterKind === "stranded") stranded += leftoverAfter;
    if (stranded > 0) {
      return {
        outcome: "stranded_remainder",
        bonus: STRANDED_REMAINDER_PENALTY,
        createsStrandedOpeningRemainder: true,
        strandedOpeningRemainderMinutes: stranded
      };
    }
    return {
      outcome: "usable_remainder",
      bonus: USABLE_REMAINDER_BONUS,
      createsStrandedOpeningRemainder: false,
      strandedOpeningRemainderMinutes: 0
    };
  }

  function analyzeDay(day, options) {
    var api = ns();
    if (typeof api.analyzeProviderDay !== "function") {
      return {
        optimizationScore: 0,
        fragmentationScore: 0,
        strandedBetweenGapMinutes: 0
      };
    }
    return api.analyzeProviderDay(day, options);
  }

  function slotsInsideOpening(day, opening, durationMinutes, snapMinutes) {
    var api = ns();
    if (typeof api.enumerateValidSlots !== "function") return [];
    return api.enumerateValidSlots(day, {
      durationMinutes: durationMinutes,
      snapMinutes: snapMinutes
    }).filter(function (slot) {
      return slot
        && slot.startMin >= opening.startMin
        && slot.endMin <= opening.endMin;
    });
  }

  function matchReasons(impact) {
    var reasons = [];
    function add(code, delta, text) {
      reasons.push({ code: code, delta: delta, text: text });
    }
    if (impact.openingFit.outcome === "exact_fill") {
      add("exact_opening_fill", EXACT_FILL_BONUS, "Fills the entire opening.");
    } else if (impact.openingFit.outcome === "usable_remainder") {
      add("usable_opening_remainder", USABLE_REMAINDER_BONUS, "Leaves a remainder that can fit the reference service.");
    } else {
      add("creates_stranded_opening_remainder", STRANDED_REMAINDER_PENALTY, "Leaves a remainder too small for the reference service.");
    }
    if (impact.time.bonus === 10) {
      add("matches_preferred_time", 10, "Starts at the preferred time.");
    } else if (impact.time.bonus > 0) {
      add("near_preferred_time", impact.time.bonus, "Starts near the preferred time.");
    }
    if (impact.optimizationDelta > 0) {
      add("improves_day_optimization", clampInt(impact.optimizationDelta, -OPT_CLAMP, OPT_CLAMP), "Improves the provider day's optimization score.");
    }
    if (impact.fragmentationDelta < 0) {
      add("reduces_fragmentation", clampInt(-impact.fragmentationDelta, 0, FRAG_BONUS_CAP), "Reduces fragmentation.");
    }
    if (impact.fragmentationDelta > 0) {
      add("increases_fragmentation", -clampInt(impact.fragmentationDelta, 0, FRAG_PENALTY_CAP), "Increases fragmentation.");
    }
    if (impact.strandedBetweenMinutesDelta > 0) {
      add("creates_stranded_between_time", -clampInt(impact.strandedBetweenMinutesDelta, 0, STRANDED_PENALTY_CAP), "Creates more stranded time between appointments.");
    }
    if (impact.usesOverlap) {
      add("uses_permitted_overlap", 0, "Uses permitted overlap already penalized in the slot score.");
    }
    return reasons;
  }

  function scoreMatch(slotScore, impact) {
    var raw = Number(slotScore) || 0;
    raw += clampInt(impact.optimizationDelta, -OPT_CLAMP, OPT_CLAMP);
    raw -= clampInt(Math.max(0, impact.fragmentationDelta), 0, FRAG_PENALTY_CAP);
    raw += clampInt(Math.max(0, -impact.fragmentationDelta), 0, FRAG_BONUS_CAP);
    raw -= clampInt(Math.max(0, impact.strandedBetweenMinutesDelta), 0, STRANDED_PENALTY_CAP);
    raw += impact.openingFit.bonus;
    raw += impact.time.bonus;
    return clampScore(raw);
  }

  function toMatch(day, request, slot, opening, before, options, referenceMinutes) {
    var api = ns();
    var leftoverBefore = slot.startMin - opening.startMin;
    var leftoverAfter = opening.endMin - slot.endMin;
    var openingFit = openingFitOf(leftoverBefore, leftoverAfter, referenceMinutes);
    var time = timePreferenceBonus(slot.startMin, request);
    var simulated = typeof api.dayWithAssignmentCandidate === "function"
      ? api.dayWithAssignmentCandidate(day, slot)
      : day;
    var after = analyzeDay(simulated, options);
    var impact = {
      optimizationDelta: (after.optimizationScore || 0) - (before.optimizationScore || 0),
      fragmentationDelta: (after.fragmentationScore || 0) - (before.fragmentationScore || 0),
      strandedBetweenMinutesDelta: (after.strandedBetweenGapMinutes || 0) - (before.strandedBetweenGapMinutes || 0),
      usesOverlap: !!slot.usesOverlap,
      openingFit: openingFit,
      time: time
    };
    var waitlistMatchScore = scoreMatch(slot.score, impact);
    return {
      waitlistId: request.waitlistId,
      clientId: request.clientId,
      serviceId: request.serviceId,
      providerId: trimText(day && day.providerId),
      dateKey: trimText(day && day.dateKey),
      locationId: trimText(day && day.locationId),
      durationMinutes: request.durationMinutes,
      candidateStartMin: slot.startMin,
      candidateEndMin: slot.endMin,
      createdAtOrder: request.createdAtOrder,
      assignmentType: request.assignmentType,
      slotScore: Number(slot.score) || 0,
      slotLabel: slot.label || "",
      waitlistMatchScore: waitlistMatchScore,
      openingMinutes: opening.minutes,
      openingUsedMinutes: request.durationMinutes,
      openingRemainingBeforeMinutes: leftoverBefore,
      openingRemainingAfterMinutes: leftoverAfter,
      leftoverBeforeMinutes: leftoverBefore,
      leftoverAfterMinutes: leftoverAfter,
      openingFillPercent: opening.minutes > 0
        ? Math.round((request.durationMinutes / opening.minutes) * 100)
        : 0,
      openingFit: openingFit.outcome,
      createsStrandedOpeningRemainder: openingFit.createsStrandedOpeningRemainder,
      strandedOpeningRemainderMinutes: openingFit.strandedOpeningRemainderMinutes,
      timePreferenceBonus: time.bonus,
      timeDistanceMinutes: time.distance,
      optimizationBefore: before.optimizationScore || 0,
      optimizationAfter: after.optimizationScore || 0,
      optimizationDelta: impact.optimizationDelta,
      fragmentationBefore: before.fragmentationScore || 0,
      fragmentationAfter: after.fragmentationScore || 0,
      fragmentationDelta: impact.fragmentationDelta,
      strandedBetweenGapMinutesBefore: before.strandedBetweenGapMinutes || 0,
      strandedBetweenGapMinutesAfter: after.strandedBetweenGapMinutes || 0,
      strandedBetweenMinutesDelta: impact.strandedBetweenMinutesDelta,
      usesOverlap: !!slot.usesOverlap,
      reasons: matchReasons(impact)
    };
  }

  function compareMatches(a, b) {
    if (b.waitlistMatchScore !== a.waitlistMatchScore) return b.waitlistMatchScore - a.waitlistMatchScore;
    if (b.slotScore !== a.slotScore) return b.slotScore - a.slotScore;
    var aFit = FIT_RANK[a.openingFit] != null ? FIT_RANK[a.openingFit] : 9;
    var bFit = FIT_RANK[b.openingFit] != null ? FIT_RANK[b.openingFit] : 9;
    if (aFit !== bFit) return aFit - bFit;
    if (b.optimizationDelta !== a.optimizationDelta) return b.optimizationDelta - a.optimizationDelta;
    if (a.fragmentationAfter !== b.fragmentationAfter) return a.fragmentationAfter - b.fragmentationAfter;
    if (a.strandedBetweenGapMinutesAfter !== b.strandedBetweenGapMinutesAfter) {
      return a.strandedBetweenGapMinutesAfter - b.strandedBetweenGapMinutesAfter;
    }
    if (a.timeDistanceMinutes !== b.timeDistanceMinutes) return a.timeDistanceMinutes - b.timeDistanceMinutes;
    if (a.candidateStartMin !== b.candidateStartMin) return a.candidateStartMin - b.candidateStartMin;
    var aHasOrder = Number.isFinite(a.createdAtOrder);
    var bHasOrder = Number.isFinite(b.createdAtOrder);
    if (aHasOrder && bHasOrder && a.createdAtOrder !== b.createdAtOrder) {
      return a.createdAtOrder - b.createdAtOrder;
    }
    if (aHasOrder !== bHasOrder) return aHasOrder ? -1 : 1;
    return String(a.waitlistId || "").localeCompare(String(b.waitlistId || ""));
  }

  function bestPerRequest(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (row) {
      var key = String(row.waitlistId || "");
      if (seen[key]) return;
      seen[key] = true;
      out.push(row);
    });
    return out;
  }

  function rankWaitlistMatchCandidates(day, openingInput, requests, options) {
    var api = ns();
    var dayNorm = asDay(day);
    var opening = openingOf(openingInput);
    var opts = options && typeof options === "object" ? options : {};
    if (!opening) return [];
    var snapMinutes = optionInt(opts, "snapMinutes", api.DEFAULT_SNAP_MINUTES || 15);
    var referenceMinutes = optionInt(opts, "referenceServiceDurationMinutes", DEFAULT_REFERENCE);
    var before = analyzeDay(dayNorm, opts);
    var matches = [];
    (Array.isArray(requests) ? requests : []).forEach(function (raw) {
      var request = requestOf(raw);
      if (!request) return;
      if (request.durationMinutes > opening.minutes) return;
      if (!providerEligible(dayNorm, request)) return;
      slotsInsideOpening(dayNorm, opening, request.durationMinutes, snapMinutes).forEach(function (slot) {
        if (!startAllowed(slot.startMin, request)) return;
        var scored = typeof api.scoreSlot === "function"
          ? api.scoreSlot(dayNorm, slot, { durationMinutes: request.durationMinutes, snapMinutes: snapMinutes })
          : slot;
        matches.push(toMatch(dayNorm, request, scored, opening, before, opts, referenceMinutes));
      });
    });
    return matches.sort(compareMatches);
  }

  function rankWaitlistMatches(day, opening, requests, options) {
    return bestPerRequest(rankWaitlistMatchCandidates(day, opening, requests, options));
  }

  function recommendWaitlistMatch(day, opening, requests, options) {
    var opts = options && typeof options === "object" ? options : {};
    var minScore = optionInt(opts, "minimumWaitlistMatchScore", DEFAULT_MIN_MATCH);
    var ranked = rankWaitlistMatches(day, opening, requests, opts);
    if (!ranked[0] || ranked[0].waitlistMatchScore < minScore) return null;
    return ranked[0];
  }

  var api = ns();
  api.rankWaitlistMatches = rankWaitlistMatches;
  api.rankWaitlistMatchCandidates = rankWaitlistMatchCandidates;
  api.recommendWaitlistMatch = recommendWaitlistMatch;
  api.compareWaitlistMatches = compareMatches;
  api.WAITLIST = {
    DEFAULT_REFERENCE_DURATION: DEFAULT_REFERENCE,
    DEFAULT_MIN_MATCH: DEFAULT_MIN_MATCH,
    EXACT_FILL_BONUS: EXACT_FILL_BONUS,
    USABLE_REMAINDER_BONUS: USABLE_REMAINDER_BONUS,
    STRANDED_REMAINDER_PENALTY: STRANDED_REMAINDER_PENALTY
  };
})();
