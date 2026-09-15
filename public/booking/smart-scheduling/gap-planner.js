/**
 * Smart Scheduling Phase 8 — general gap recovery planner.
 *
 * Recommendation-only. Plans the best next action for one TRUE Phase 1
 * gap (primary focus: kind === "between"). No cancellation descriptor
 * is required. Phase 7 stays independently reusable.
 *
 * actionScoreRaw =
 *     40
 *   + round(gapRecoveryPercent * 0.30)
 *   + clamp(optimizationDelta, -15, +15)
 *   - clamp(max(0, fragmentationDelta), 0, 15)
 *   + clamp(max(0, -fragmentationDelta), 0, 10)
 *   - clamp(max(0, strandedBetweenMinutesDelta), 0, 15)
 *   - disruptionPenalty
 *   - overlapPenalty
 *
 * This is Phase 8 cross-action scoring. It does not replace Phase 2
 * scoreImprovement or Phase 6 waitlistMatchScore (those stay sourceScore).
 *
 * An action must recover gapRecoveredMinutes > 0 of the TARGET gap.
 * Unrelated calendar improvements are not recovery actions for that gap.
 *
 * planProviderDayGapRecoveries produces one INDEPENDENT plan per between-gap.
 * The same appointment may appear in more than one plan. Global conflict
 * resolution is out of scope.
 */
(function () {
  var BASE = 40;
  var OPT_CLAMP = 15;
  var FRAG_PENALTY_CAP = 15;
  var FRAG_BONUS_CAP = 10;
  var STRANDED_PENALTY_CAP = 15;
  var DISRUPTION_CAP = 15;
  var OVERLAP_ACTION_PENALTY = 5;
  var DEFAULT_MAX_ALTERNATIVES = 3;
  var DEFAULT_MIN_WAITLIST = 50;
  var DEFAULT_REFERENCE = 30;

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

  function overlapMinutes(startA, endA, startB, endB) {
    var h = helpers();
    if (h.overlapMinutes) return h.overlapMinutes(startA, endA, startB, endB);
    var n = Math.min(Number(endA), Number(endB)) - Math.max(Number(startA), Number(startB));
    return n > 0 ? n : 0;
  }

  function gapIdentity(gap) {
    if (!gap) return "";
    return [gap.workingIntervalIndex, gap.startMin, gap.endMin].join("|");
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
      return { optimizationScore: 0, fragmentationScore: 0, strandedBetweenGapMinutes: 0, trueFreeMinutes: 0 };
    }
    return api.analyzeProviderDay(day, options);
  }

  function currentGaps(day) {
    var api = ns();
    return typeof api.findFreeGaps === "function" ? api.findFreeGaps(day) : [];
  }

  function resolveGap(day, rawGap) {
    if (!rawGap || typeof rawGap !== "object") return null;
    var key = gapIdentity(rawGap);
    if (!key || rawGap.workingIntervalIndex == null) return null;
    var found = null;
    currentGaps(day).forEach(function (gap) {
      if (!found && gapIdentity(gap) === key) found = gap;
    });
    return found;
  }

  function recoveryPercent(recovered, gapMin) {
    return clampInt(Math.round(100 * (Number(recovered) || 0) / Math.max(1, Number(gapMin) || 0)), 0, 100);
  }

  function disruptionPenaltyOf(minutes) {
    var n = Number(minutes) || 0;
    if (!(n > 0)) return 0;
    return Math.min(DISRUPTION_CAP, Math.round(n / 15) * 3);
  }

  function actionScoreOf(impact) {
    var raw = BASE;
    raw += Math.round((Number(impact.gapRecoveryPercent) || 0) * 0.30);
    raw += clampInt(impact.optimizationDelta, -OPT_CLAMP, OPT_CLAMP);
    raw -= clampInt(Math.max(0, impact.fragmentationDelta), 0, FRAG_PENALTY_CAP);
    raw += clampInt(Math.max(0, -impact.fragmentationDelta), 0, FRAG_BONUS_CAP);
    raw -= clampInt(Math.max(0, impact.strandedBetweenMinutesDelta), 0, STRANDED_PENALTY_CAP);
    raw -= Number(impact.disruptionPenalty) || 0;
    raw -= Number(impact.overlapPenalty) || 0;
    return clampScore(raw);
  }

  function toCompareShape(action) {
    return {
      actionScore: action.actionScore,
      openingRecoveredMinutes: action.gapRecoveredMinutes,
      openingRecoveryPercent: action.gapRecoveryPercent,
      optimizationDeltaFromPostCancellation: action.optimizationDelta,
      fragmentationAfterAction: action.fragmentationAfterAction,
      strandedBetweenGapMinutesAfterAction: action.strandedBetweenGapMinutesAfterAction,
      clientDisruptionMinutes: action.clientDisruptionMinutes,
      usesOverlap: action.usesOverlap,
      proposedStartMin: action.proposedStartMin,
      candidateStartMin: action.candidateStartMin,
      actionId: action.actionId
    };
  }

  function compareGapActions(a, b) {
    var api = ns();
    if (typeof api.compareRecoveryActions === "function") {
      return api.compareRecoveryActions(toCompareShape(a), toCompareShape(b));
    }
    if (b.actionScore !== a.actionScore) return b.actionScore - a.actionScore;
    if (b.gapRecoveredMinutes !== a.gapRecoveredMinutes) return b.gapRecoveredMinutes - a.gapRecoveredMinutes;
    if (a.clientDisruptionMinutes !== b.clientDisruptionMinutes) {
      return a.clientDisruptionMinutes - b.clientDisruptionMinutes;
    }
    return String(a.actionId || "").localeCompare(String(b.actionId || ""));
  }

  function simulateMoveDay(day, move) {
    var api = ns();
    var without = typeof api.dayWithoutLine === "function"
      ? api.dayWithoutLine(day, { lineId: move.lineId, appointmentId: move.appointmentId })
      : day;
    if (typeof api.dayWithAssignmentCandidate !== "function") return without;
    return api.dayWithAssignmentCandidate(without, {
      startMin: move.proposedStartMin,
      endMin: move.proposedEndMin
    });
  }

  function simulateWaitlistDay(day, match) {
    var api = ns();
    if (typeof api.dayWithAssignmentCandidate !== "function") return day;
    return api.dayWithAssignmentCandidate(day, {
      startMin: match.candidateStartMin,
      endMin: match.candidateEndMin
    });
  }

  function recoveredByMove(gap, move) {
    var api = ns();
    if (typeof api.gapsRecoveredByOpportunity === "function") {
      var hits = api.gapsRecoveredByOpportunity([gap], move);
      var total = 0;
      (hits || []).forEach(function (hit) { total += Number(hit.recoveredMinutes) || 0; });
      return total;
    }
    return overlapMinutes(gap.startMin, gap.endMin, move.proposedStartMin, move.proposedEndMin);
  }

  function actionReasons(action, gap) {
    var reasons = [];
    function add(code, delta, text) {
      reasons.push({ code: code, delta: delta, text: text });
    }
    if (action.gapRecoveryPercent === 100) {
      add("fully_recovers_gap", Math.round(action.gapRecoveryPercent * 0.30), "Fully recovers the target gap.");
    } else if (action.gapRecoveredMinutes > 0) {
      add("partially_recovers_gap", Math.round(action.gapRecoveryPercent * 0.30), "Partially recovers the target gap.");
    }
    if (action.type === "move_existing_appointment") {
      if (action.direction === "earlier") {
        add("moves_next_appointment_earlier", -action.disruptionPenalty, "Moves the later appointment earlier into the gap.");
      } else if (action.direction === "later") {
        add("moves_previous_appointment_later", -action.disruptionPenalty, "Moves the earlier appointment later into the gap.");
      }
      add("requires_client_move", -action.disruptionPenalty, "Moves an existing booked client.");
    }
    if (action.type === "fill_from_waitlist") {
      add("fills_gap_from_waitlist", 0, "Fills the target gap from the waitlist.");
      add("avoids_moving_existing_client", 0, "Does not move an existing booked client.");
    }
    if (action.optimizationDelta > 0) {
      add("improves_day_optimization", clampInt(action.optimizationDelta, -OPT_CLAMP, OPT_CLAMP), "Improves the provider day's optimization score.");
    }
    if (action.fragmentationDelta < 0) {
      add("reduces_fragmentation", clampInt(-action.fragmentationDelta, 0, FRAG_BONUS_CAP), "Reduces fragmentation.");
    }
    if (action.usesOverlap) {
      add("uses_permitted_overlap", -OVERLAP_ACTION_PENALTY, "Uses permitted overlap; Phase 8 applies a one-time action-level preference.");
    }
    if (gap && gap.kind === "between" && action.gapRecoveredMinutes > 0) {
      add("best_available_gap_recovery", 0, "Considered as a recovery action for this between-gap.");
    }
    return reasons;
  }

  function fromMove(move, gap, before, after) {
    var recovered = recoveredByMove(gap, move);
    var disruption = Number(move.moveMinutes) || 0;
    var action = {
      type: "move_existing_appointment",
      actionId: ["move", trimText(move.appointmentId), trimText(move.lineId), Number(move.proposedStartMin) || 0].join("|"),
      appointmentId: trimText(move.appointmentId),
      lineId: trimText(move.lineId),
      providerId: trimText(move.providerId),
      currentStartMin: move.currentStartMin,
      currentEndMin: move.currentEndMin,
      proposedStartMin: move.proposedStartMin,
      proposedEndMin: move.proposedEndMin,
      moveMinutes: disruption,
      direction: move.direction || "",
      gapRecoveredMinutes: recovered,
      gapRecoveryPercent: recoveryPercent(recovered, gap.gapMin),
      optimizationAfterAction: after.optimizationScore || 0,
      optimizationDelta: (after.optimizationScore || 0) - (before.optimizationScore || 0),
      fragmentationAfterAction: after.fragmentationScore || 0,
      fragmentationDelta: (after.fragmentationScore || 0) - (before.fragmentationScore || 0),
      strandedBetweenGapMinutesAfterAction: after.strandedBetweenGapMinutes || 0,
      strandedBetweenMinutesDelta: (after.strandedBetweenGapMinutes || 0) - (before.strandedBetweenGapMinutes || 0),
      trueFreeMinutesAfterAction: after.trueFreeMinutes || 0,
      usesOverlap: !!move.usesOverlap,
      clientDisruptionMinutes: disruption,
      disruptionPenalty: disruptionPenaltyOf(disruption),
      overlapPenalty: move.usesOverlap ? OVERLAP_ACTION_PENALTY : 0,
      sourceScore: Number(move.scoreImprovement) || 0,
      sourceScoreName: "scoreImprovement"
    };
    action.actionScore = actionScoreOf(action);
    action.reasons = actionReasons(action, gap);
    return action;
  }

  function fromWaitlist(match, gap, before, after) {
    var recovered = overlapMinutes(gap.startMin, gap.endMin, match.candidateStartMin, match.candidateEndMin);
    var action = {
      type: "fill_from_waitlist",
      actionId: ["waitlist", trimText(match.waitlistId), Number(match.candidateStartMin) || 0].join("|"),
      waitlistId: trimText(match.waitlistId),
      clientId: trimText(match.clientId),
      serviceId: trimText(match.serviceId),
      providerId: trimText(match.providerId),
      candidateStartMin: match.candidateStartMin,
      candidateEndMin: match.candidateEndMin,
      durationMinutes: match.durationMinutes,
      openingFit: match.openingFit,
      gapRecoveredMinutes: recovered,
      gapRecoveryPercent: recoveryPercent(recovered, gap.gapMin),
      optimizationAfterAction: after.optimizationScore || 0,
      optimizationDelta: (after.optimizationScore || 0) - (before.optimizationScore || 0),
      fragmentationAfterAction: after.fragmentationScore || 0,
      fragmentationDelta: (after.fragmentationScore || 0) - (before.fragmentationScore || 0),
      strandedBetweenGapMinutesAfterAction: after.strandedBetweenGapMinutes || 0,
      strandedBetweenMinutesDelta: (after.strandedBetweenGapMinutes || 0) - (before.strandedBetweenGapMinutes || 0),
      trueFreeMinutesAfterAction: after.trueFreeMinutes || 0,
      usesOverlap: !!match.usesOverlap,
      clientDisruptionMinutes: 0,
      disruptionPenalty: 0,
      overlapPenalty: match.usesOverlap ? OVERLAP_ACTION_PENALTY : 0,
      sourceScore: Number(match.waitlistMatchScore) || 0,
      sourceScoreName: "waitlistMatchScore"
    };
    action.actionScore = actionScoreOf(action);
    action.reasons = actionReasons(action, gap);
    return action;
  }

  function fallbackAction(day, gap, type, extraReason) {
    var base = {
      providerId: trimText(day && day.providerId),
      startMin: gap && gap.startMin,
      endMin: gap && gap.endMin,
      gapMin: gap && gap.gapMin,
      actionScore: 0,
      sourceScore: null,
      sourceScoreName: null,
      gapRecoveredMinutes: 0,
      gapRecoveryPercent: 0,
      optimizationAfterAction: 0,
      optimizationDelta: 0,
      fragmentationAfterAction: 0,
      fragmentationDelta: 0,
      strandedBetweenGapMinutesAfterAction: 0,
      strandedBetweenMinutesDelta: 0,
      clientDisruptionMinutes: 0,
      usesOverlap: false,
      disruptionPenalty: 0,
      overlapPenalty: 0
    };
    if (type === "open_gap_opportunity") {
      return Object.assign(base, {
        type: "open_gap_opportunity",
        actionId: ["open_gap", trimText(day && day.providerId), Number(gap.startMin) || 0, Number(gap.endMin) || 0].join("|"),
        reasons: [{
          code: "open_gap_fallback",
          delta: 0,
          text: extraReason || "No qualifying move or waitlist recovery; leave the gap available to fill."
        }]
      });
    }
    return Object.assign(base, {
      type: "no_action",
      actionId: "no_action|" + gapIdentity(gap),
      reasons: [{
        code: extraReason === "invalid_gap" ? "invalid_gap" : (extraReason === "gap_too_small" ? "gap_too_small" : "no_action"),
        delta: 0,
        text: extraReason === "invalid_gap"
          ? "The supplied gap is not a current true gap on this provider day."
          : extraReason === "gap_too_small"
            ? "The target gap is too small to treat as a usable open opportunity."
            : "No qualifying gap recovery action is available."
      }]
    });
  }

  function bestWaitlistActionPerRequest(list) {
    var best = {};
    var order = [];
    (list || []).forEach(function (row) {
      var key = String(row && row.waitlistId || "");
      if (!key) return;
      if (!best[key]) {
        best[key] = row;
        order.push(key);
        return;
      }
      if (compareGapActions(row, best[key]) < 0) best[key] = row;
    });
    return order.map(function (key) { return best[key]; });
  }

  function dedupeById(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (row) {
      var key = String(row.actionId || "");
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(row);
    });
    return out;
  }

  function qualifyingMoves(day, gap, options) {
    var api = ns();
    if (typeof api.findMoveOpportunities !== "function") return [];
    return (api.findMoveOpportunities(day, options) || []).filter(function (move) {
      return recoveredByMove(gap, move) > 0;
    });
  }

  function qualifyingWaitlist(day, gap, requests, options) {
    var api = ns();
    var opts = options && typeof options === "object" ? options : {};
    if (typeof api.rankWaitlistMatchCandidates !== "function") return [];
    var minScore = optionInt(opts, "minimumWaitlistMatchScore", DEFAULT_MIN_WAITLIST);
    return api.rankWaitlistMatchCandidates(day, {
      startMin: gap.startMin,
      endMin: gap.endMin
    }, requests, opts).filter(function (row) {
      return row
        && row.waitlistMatchScore >= minScore
        && overlapMinutes(gap.startMin, gap.endMin, row.candidateStartMin, row.candidateEndMin) > 0;
    });
  }

  function emptyPlan(day, gap, type, extraReason) {
    var primary = fallbackAction(day, gap, type, extraReason);
    return {
      primaryAction: primary,
      alternatives: [],
      gap: gap || null,
      gapIdentity: gapIdentity(gap),
      valid: extraReason !== "invalid_gap",
      reasons: primary.reasons.slice()
    };
  }

  function planGapRecovery(day, gapInput, waitlistRequests, options) {
    var opts = options && typeof options === "object" ? options : {};
    var dayNorm = asDay(day);
    var gap = resolveGap(dayNorm, gapInput);
    var referenceMinutes = optionInt(opts, "referenceServiceDurationMinutes", DEFAULT_REFERENCE);
    var maxAlts = optionInt(opts, "maxAlternatives", DEFAULT_MAX_ALTERNATIVES);
    if (!gap) {
      return emptyPlan(dayNorm, gapInput, "no_action", "invalid_gap");
    }
    var before = analyzeDay(dayNorm, opts);
    var moves = qualifyingMoves(dayNorm, gap, opts).map(function (move) {
      return fromMove(move, gap, before, analyzeDay(simulateMoveDay(dayNorm, move), opts));
    }).filter(function (row) { return row.gapRecoveredMinutes > 0; });
    var waitlist = bestWaitlistActionPerRequest(
      qualifyingWaitlist(dayNorm, gap, waitlistRequests, opts).map(function (match) {
        return fromWaitlist(match, gap, before, analyzeDay(simulateWaitlistDay(dayNorm, match), opts));
      }).filter(function (row) { return row.gapRecoveredMinutes > 0; })
    );
    var actionable = dedupeById(moves.concat(waitlist)).sort(compareGapActions);
    if (actionable.length) {
      var primary = actionable[0];
      primary.reasons = primary.reasons.concat([{
        code: "best_available_gap_recovery",
        delta: 0,
        text: "Best available recovery action for this gap by operational actionScore."
      }]);
      return {
        primaryAction: primary,
        alternatives: actionable.slice(1, 1 + maxAlts),
        gap: gap,
        gapIdentity: gapIdentity(gap),
        valid: true,
        reasons: [{
          code: "best_available_gap_recovery",
          delta: 0,
          text: "Selected " + primary.type + " as the best next action for this gap."
        }]
      };
    }
    if (gap.gapMin >= referenceMinutes) {
      return emptyPlan(dayNorm, gap, "open_gap_opportunity");
    }
    return emptyPlan(dayNorm, gap, "no_action", "gap_too_small");
  }

  function isActionable(action) {
    return !!(action && (action.type === "move_existing_appointment" || action.type === "fill_from_waitlist"));
  }

  function compareGapPlans(a, b) {
    var aAct = isActionable(a && a.primaryAction);
    var bAct = isActionable(b && b.primaryAction);
    if (aAct !== bAct) return aAct ? -1 : 1;
    if ((b.gapPriorityScore || 0) !== (a.gapPriorityScore || 0)) {
      return (b.gapPriorityScore || 0) - (a.gapPriorityScore || 0);
    }
    var aScore = a.primaryAction ? a.primaryAction.actionScore : 0;
    var bScore = b.primaryAction ? b.primaryAction.actionScore : 0;
    if (bScore !== aScore) return bScore - aScore;
    var aGap = a.gap && a.gap.gapMin || 0;
    var bGap = b.gap && b.gap.gapMin || 0;
    if (bGap !== aGap) return bGap - aGap;
    var aRec = a.primaryAction ? a.primaryAction.gapRecoveredMinutes : 0;
    var bRec = b.primaryAction ? b.primaryAction.gapRecoveredMinutes : 0;
    if (bRec !== aRec) return bRec - aRec;
    var aStart = a.gap && a.gap.startMin || 0;
    var bStart = b.gap && b.gap.startMin || 0;
    if (aStart !== bStart) return aStart - bStart;
    return String(a.gapIdentity || "").localeCompare(String(b.gapIdentity || ""));
  }

  function planProviderDayGapRecoveries(day, waitlistRequests, options) {
    var api = ns();
    var opts = options && typeof options === "object" ? options : {};
    var dayNorm = asDay(day);
    var priorities = typeof api.rankGapPriorities === "function"
      ? api.rankGapPriorities(dayNorm, opts)
      : currentGaps(dayNorm);
    var rows = [];
    (priorities || []).forEach(function (gap) {
      if (!gap || gap.kind !== "between") return;
      var plan = planGapRecovery(dayNorm, gap, waitlistRequests, opts);
      rows.push({
        gap: plan.gap || gap,
        gapIdentity: plan.gapIdentity || gapIdentity(gap),
        gapPriorityScore: Number(gap.priorityScore) || 0,
        plan: plan,
        recoverable: isActionable(plan.primaryAction),
        primaryAction: plan.primaryAction,
        independent: true
      });
    });
    rows.sort(compareGapPlans);
    rows.independentPlans = true;
    return rows;
  }

  var api = ns();
  api.planGapRecovery = planGapRecovery;
  api.planProviderDayGapRecoveries = planProviderDayGapRecoveries;
  api.compareGapActions = compareGapActions;
  api.gapIdentity = gapIdentity;
  api.GAP_PLAN = {
    BASE: BASE,
    OVERLAP_ACTION_PENALTY: OVERLAP_ACTION_PENALTY,
    DISRUPTION_CAP: DISRUPTION_CAP,
    DEFAULT_MAX_ALTERNATIVES: DEFAULT_MAX_ALTERNATIVES,
    DEFAULT_REFERENCE_DURATION: DEFAULT_REFERENCE,
    INDEPENDENT_PLANS: true
  };
})();
