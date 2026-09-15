/**
 * Smart Scheduling Phase 7 — recovery action planner.
 *
 * Recommendation-only. Compares Phase 5 move recoveries and Phase 6
 * waitlist matches as ACTION TYPES. Does not execute, message, or book.
 *
 * Phase 5 recoveryScore and Phase 6 waitlistMatchScore are different
 * instruments. They are exposed as sourceScore and are never compared
 * directly. Phase 7 ranks a separate actionScore.
 *
 * actionScoreRaw =
 *     40
 *   + round(openingRecoveryPercent * 0.30)
 *   + clamp(optimizationDeltaFromPostCancellation, -15, +15)
 *   - clamp(max(0, fragmentationDeltaFromPostCancellation), 0, 15)
 *   + clamp(max(0, -fragmentationDeltaFromPostCancellation), 0, 10)
 *   - clamp(max(0, strandedBetweenMinutesDeltaFromPostCancellation), 0, 15)
 *   - disruptionPenalty
 *   - overlapPenalty
 *
 * disruptionPenalty (move only) = min(15, round(clientDisruptionMinutes / 15) * 3)
 * fill_from_waitlist disruptionPenalty = 0
 *
 * overlapPenalty is an ACTION-level preference (0 or 5). Phase 1/5/6
 * source scores may already penalize overlap; this is an extra type-level
 * preference against overlap-dependent actions, applied exactly once here.
 *
 * openingRecoveredMinutes uses true newlyFreedIntervals only, never the
 * nominal cancelled duration or Phase 6 openingFillPercent.
 *
 * Waitlist placements come from rankWaitlistMatchCandidates, not
 * rankWaitlistMatches. Every Phase 6-qualified start is action-scored,
 * then one best Phase 7 placement is kept per waitlistId.
 *
 * Only source-qualified Phase 5 / Phase 6 candidates are considered.
 * open_fill_opportunity is a fallback, not a competing scored action.
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

  function minutesInIntervals(startMin, endMin, intervals) {
    var total = 0;
    (intervals || []).forEach(function (row) {
      total += overlapMinutes(startMin, endMin, row.startMin, row.endMin);
    });
    return total;
  }

  function openingRecoveryPercent(recovered, newlyFreedMinutes) {
    var pct = Math.round(100 * (Number(recovered) || 0) / Math.max(1, Number(newlyFreedMinutes) || 0));
    return clampInt(pct, 0, 100);
  }

  function disruptionPenaltyOf(minutes) {
    var n = Number(minutes) || 0;
    if (!(n > 0)) return 0;
    return Math.min(DISRUPTION_CAP, Math.round(n / 15) * 3);
  }

  function analyzeDay(day, options) {
    var api = ns();
    if (typeof api.analyzeProviderDay !== "function") {
      return { trueFreeMinutes: 0, strandedBetweenGapMinutes: 0 };
    }
    return api.analyzeProviderDay(day, options);
  }

  function waitlistAfterDay(day, match) {
    var api = ns();
    if (typeof api.dayWithAssignmentCandidate !== "function") return day;
    return api.dayWithAssignmentCandidate(day, {
      startMin: match.candidateStartMin,
      endMin: match.candidateEndMin
    });
  }

  function moveAfterDay(day, move) {
    var api = ns();
    var without = typeof api.dayWithoutLine === "function"
      ? api.dayWithoutLine(day, {
        lineId: move.lineId,
        appointmentId: move.appointmentId
      })
      : day;
    if (typeof api.dayWithAssignmentCandidate !== "function") return without;
    return api.dayWithAssignmentCandidate(without, {
      startMin: move.proposedStartMin,
      endMin: move.proposedEndMin
    });
  }

  function actionScoreOf(impact) {
    var raw = BASE;
    raw += Math.round((Number(impact.openingRecoveryPercent) || 0) * 0.30);
    raw += clampInt(impact.optimizationDeltaFromPostCancellation, -OPT_CLAMP, OPT_CLAMP);
    raw -= clampInt(Math.max(0, impact.fragmentationDeltaFromPostCancellation), 0, FRAG_PENALTY_CAP);
    raw += clampInt(Math.max(0, -impact.fragmentationDeltaFromPostCancellation), 0, FRAG_BONUS_CAP);
    raw -= clampInt(Math.max(0, impact.strandedBetweenMinutesDeltaFromPostCancellation), 0, STRANDED_PENALTY_CAP);
    raw -= Number(impact.disruptionPenalty) || 0;
    raw -= Number(impact.overlapPenalty) || 0;
    return clampScore(raw);
  }

  function actionReasons(action, maxRecovered) {
    var reasons = [];
    function add(code, delta, text) {
      reasons.push({ code: code, delta: delta, text: text });
    }
    if (action.openingRecoveryPercent === 100) {
      add("recovers_all_cancelled_capacity", Math.round(action.openingRecoveryPercent * 0.30), "Recovers all true cancelled capacity.");
    } else if (action.openingRecoveredMinutes > 0 && action.openingRecoveredMinutes === maxRecovered) {
      add("recovers_most_cancelled_capacity", Math.round(action.openingRecoveryPercent * 0.30), "Recovers the most true cancelled capacity among considered actions.");
    }
    if (action.optimizationDeltaFromPostCancellation > 0) {
      add("improves_day_optimization", clampInt(action.optimizationDeltaFromPostCancellation, -OPT_CLAMP, OPT_CLAMP), "Improves the post-cancellation day.");
    }
    if (action.fragmentationDeltaFromPostCancellation < 0) {
      add("reduces_fragmentation", clampInt(-action.fragmentationDeltaFromPostCancellation, 0, FRAG_BONUS_CAP), "Reduces fragmentation.");
    }
    if (action.type === "fill_from_waitlist") {
      add("avoids_moving_existing_client", 0, "Does not move an existing booked client.");
    }
    if (action.type === "move_existing_appointment") {
      add("requires_client_move", -action.disruptionPenalty, "Moves an existing booked client.");
      if (action.clientDisruptionMinutes >= 45) {
        add("large_client_move", -action.disruptionPenalty, "Requires a large existing-client move.");
      }
    }
    if (action.usesOverlap) {
      add("uses_permitted_overlap", -OVERLAP_ACTION_PENALTY, "Uses permitted overlap; Phase 7 applies a one-time action-level preference.");
    }
    if (action.strandedBetweenMinutesDeltaFromPostCancellation > 0 || action.leavesStrandedOpeningRemainder) {
      add("leaves_stranded_time", -clampInt(Math.max(0, action.strandedBetweenMinutesDeltaFromPostCancellation), 0, STRANDED_PENALTY_CAP), "Leaves stranded time after the action.");
    }
    return reasons;
  }

  function compareActions(a, b) {
    if (b.actionScore !== a.actionScore) return b.actionScore - a.actionScore;
    if (b.openingRecoveredMinutes !== a.openingRecoveredMinutes) {
      return b.openingRecoveredMinutes - a.openingRecoveredMinutes;
    }
    if (b.openingRecoveryPercent !== a.openingRecoveryPercent) {
      return b.openingRecoveryPercent - a.openingRecoveryPercent;
    }
    if (b.optimizationDeltaFromPostCancellation !== a.optimizationDeltaFromPostCancellation) {
      return b.optimizationDeltaFromPostCancellation - a.optimizationDeltaFromPostCancellation;
    }
    if (a.fragmentationAfterAction !== b.fragmentationAfterAction) {
      return a.fragmentationAfterAction - b.fragmentationAfterAction;
    }
    if (a.strandedBetweenGapMinutesAfterAction !== b.strandedBetweenGapMinutesAfterAction) {
      return a.strandedBetweenGapMinutesAfterAction - b.strandedBetweenGapMinutesAfterAction;
    }
    if (a.clientDisruptionMinutes !== b.clientDisruptionMinutes) {
      return a.clientDisruptionMinutes - b.clientDisruptionMinutes;
    }
    if (!!a.usesOverlap !== !!b.usesOverlap) return a.usesOverlap ? 1 : -1;
    var aStart = a.proposedStartMin != null ? a.proposedStartMin : a.candidateStartMin;
    var bStart = b.proposedStartMin != null ? b.proposedStartMin : b.candidateStartMin;
    if (aStart !== bStart) return aStart - bStart;
    return String(a.actionId || "").localeCompare(String(b.actionId || ""));
  }

  function fromMove(move, analysis, day, options) {
    var recovered = Number(move.cancellationWindowRecoveredMinutes) || 0;
    var percent = openingRecoveryPercent(recovered, analysis.newlyFreedMinutes);
    var afterSim = analyzeDay(moveAfterDay(day, move), options);
    var disruption = Number(move.moveMinutes) || 0;
    var action = {
      type: "move_existing_appointment",
      actionId: ["move", trimText(move.appointmentId), trimText(move.lineId), Number(move.proposedStartMin) || 0].join("|"),
      appointmentId: trimText(move.appointmentId),
      lineId: trimText(move.lineId),
      providerId: trimText(move.providerId || analysis.providerId),
      currentStartMin: move.currentStartMin,
      currentEndMin: move.currentEndMin,
      proposedStartMin: move.proposedStartMin,
      proposedEndMin: move.proposedEndMin,
      moveMinutes: disruption,
      direction: move.direction || "",
      sourceScore: Number(move.recoveryScore) || 0,
      sourceScoreName: "recoveryScore",
      openingRecoveredMinutes: recovered,
      openingRecoveryPercent: percent,
      optimizationAfterAction: Number(move.optimizationAfterRecovery) || 0,
      optimizationDeltaFromPostCancellation: Number(move.optimizationDeltaFromRecovery) || 0,
      fragmentationAfterAction: Number(move.fragmentationAfterRecovery) || 0,
      fragmentationDeltaFromPostCancellation: Number(move.fragmentationDeltaFromRecovery) || 0,
      strandedBetweenGapMinutesAfterAction: afterSim.strandedBetweenGapMinutes || 0,
      strandedBetweenMinutesDeltaFromPostCancellation: Number(move.strandedBetweenMinutesDeltaFromRecovery) || 0,
      trueFreeMinutesAfterAction: afterSim.trueFreeMinutes || 0,
      usesOverlap: !!move.usesOverlap,
      clientDisruptionMinutes: disruption,
      disruptionPenalty: disruptionPenaltyOf(disruption),
      overlapPenalty: move.usesOverlap ? OVERLAP_ACTION_PENALTY : 0,
      leavesStrandedOpeningRemainder: false
    };
    action.actionScore = actionScoreOf(action);
    return action;
  }

  function fromWaitlist(match, analysis, day, options) {
    var recovered = minutesInIntervals(
      match.candidateStartMin,
      match.candidateEndMin,
      analysis.newlyFreedIntervals
    );
    var percent = openingRecoveryPercent(recovered, analysis.newlyFreedMinutes);
    var afterSim = analyzeDay(waitlistAfterDay(day, match), options);
    var action = {
      type: "fill_from_waitlist",
      actionId: ["waitlist", trimText(match.waitlistId), Number(match.candidateStartMin) || 0].join("|"),
      waitlistId: trimText(match.waitlistId),
      clientId: trimText(match.clientId),
      serviceId: trimText(match.serviceId),
      providerId: trimText(match.providerId || analysis.providerId),
      candidateStartMin: match.candidateStartMin,
      candidateEndMin: match.candidateEndMin,
      durationMinutes: match.durationMinutes,
      openingFit: match.openingFit,
      sourceScore: Number(match.waitlistMatchScore) || 0,
      sourceScoreName: "waitlistMatchScore",
      openingRecoveredMinutes: recovered,
      openingRecoveryPercent: percent,
      optimizationAfterAction: Number(match.optimizationAfter) || 0,
      optimizationDeltaFromPostCancellation: Number(match.optimizationDelta) || 0,
      fragmentationAfterAction: Number(match.fragmentationAfter) || 0,
      fragmentationDeltaFromPostCancellation: Number(match.fragmentationDelta) || 0,
      strandedBetweenGapMinutesAfterAction: Number(match.strandedBetweenGapMinutesAfter) || 0,
      strandedBetweenMinutesDeltaFromPostCancellation: Number(match.strandedBetweenMinutesDelta) || 0,
      trueFreeMinutesAfterAction: afterSim.trueFreeMinutes || 0,
      usesOverlap: !!match.usesOverlap,
      clientDisruptionMinutes: 0,
      disruptionPenalty: 0,
      overlapPenalty: match.usesOverlap ? OVERLAP_ACTION_PENALTY : 0,
      leavesStrandedOpeningRemainder: !!match.createsStrandedOpeningRemainder
    };
    action.actionScore = actionScoreOf(action);
    return action;
  }

  function fallbackAction(analysis, type) {
    var windowRow = analysis.resultingFreeWindow;
    if (type === "open_fill_opportunity" && windowRow) {
      return {
        type: "open_fill_opportunity",
        actionId: [
          "open_fill",
          trimText(analysis.providerId),
          Number(windowRow.startMin) || 0,
          Number(windowRow.endMin) || 0
        ].join("|"),
        actionScore: 0,
        sourceScore: null,
        sourceScoreName: null,
        providerId: trimText(analysis.providerId),
        startMin: windowRow.startMin,
        endMin: windowRow.endMin,
        durationMinutes: windowRow.gapMin,
        openingRecoveredMinutes: 0,
        openingRecoveryPercent: 0,
        optimizationAfterAction: analysis.optimizationAfterCancellation || 0,
        optimizationDeltaFromPostCancellation: 0,
        fragmentationAfterAction: analysis.fragmentationAfterCancellation || 0,
        fragmentationDeltaFromPostCancellation: 0,
        strandedBetweenGapMinutesAfterAction: analysis.strandedBetweenGapMinutesAfterCancellation || 0,
        strandedBetweenMinutesDeltaFromPostCancellation: 0,
        trueFreeMinutesAfterAction: analysis.afterAnalysis ? analysis.afterAnalysis.trueFreeMinutes || 0 : 0,
        usesOverlap: false,
        clientDisruptionMinutes: 0,
        disruptionPenalty: 0,
        overlapPenalty: 0,
        reasons: [{
          code: "open_fill_fallback",
          delta: 0,
          text: "No qualifying move or waitlist action; the cancellation left usable open capacity."
        }]
      };
    }
    return {
      type: "no_action",
      actionId: "no_action",
      actionScore: 0,
      sourceScore: null,
      sourceScoreName: null,
      providerId: trimText(analysis.providerId),
      openingRecoveredMinutes: 0,
      openingRecoveryPercent: 0,
      optimizationAfterAction: analysis.optimizationAfterCancellation || 0,
      optimizationDeltaFromPostCancellation: 0,
      fragmentationAfterAction: analysis.fragmentationAfterCancellation || 0,
      fragmentationDeltaFromPostCancellation: 0,
      strandedBetweenGapMinutesAfterAction: analysis.strandedBetweenGapMinutesAfterCancellation || 0,
      strandedBetweenMinutesDeltaFromPostCancellation: 0,
      trueFreeMinutesAfterAction: analysis.afterAnalysis ? analysis.afterAnalysis.trueFreeMinutes || 0 : 0,
      usesOverlap: false,
      clientDisruptionMinutes: 0,
      disruptionPenalty: 0,
      overlapPenalty: 0,
      reasons: [{
        code: "no_action",
        delta: 0,
        text: "No qualifying recovery action is available."
      }]
    };
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
      if (compareActions(row, best[key]) < 0) best[key] = row;
    });
    return order.map(function (key) { return best[key]; });
  }

  function openingOf(analysis) {
    var win = analysis && analysis.resultingFreeWindow;
    if (!win) return null;
    return {
      startMin: win.startMin,
      endMin: win.endMin,
      minutes: win.gapMin
    };
  }

  function qualifyingWaitlist(day, opening, requests, options) {
    var api = ns();
    var opts = options && typeof options === "object" ? options : {};
    if (!opening || typeof api.rankWaitlistMatchCandidates !== "function") return [];
    var minScore = optionInt(opts, "minimumWaitlistMatchScore", DEFAULT_MIN_WAITLIST);
    return api.rankWaitlistMatchCandidates(day, opening, requests, opts).filter(function (row) {
      return row && row.waitlistMatchScore >= minScore;
    });
  }

  function planCancellationRecovery(day, cancellation, waitlistRequests, options) {
    var api = ns();
    var opts = options && typeof options === "object" ? options : {};
    var analysis = typeof api.analyzeCancellationRecovery === "function"
      ? api.analyzeCancellationRecovery(day, cancellation, opts)
      : { recoveryOpportunities: [], newlyFreedIntervals: [], newlyFreedMinutes: 0 };
    var opening = openingOf(analysis);
    var maxAlts = optionInt(opts, "maxAlternatives", DEFAULT_MAX_ALTERNATIVES);
    var moves = (analysis.recoveryOpportunities || []).map(function (move) {
      return fromMove(move, analysis, day, opts);
    });
    var waitlist = bestWaitlistActionPerRequest(
      qualifyingWaitlist(day, opening, waitlistRequests, opts).map(function (match) {
        return fromWaitlist(match, analysis, day, opts);
      })
    );
    var actionable = dedupeById(moves.concat(waitlist)).sort(compareActions);
    var maxRecovered = 0;
    actionable.forEach(function (row) {
      if (row.openingRecoveredMinutes > maxRecovered) maxRecovered = row.openingRecoveredMinutes;
    });
    actionable.forEach(function (row) {
      row.reasons = actionReasons(row, maxRecovered);
    });
    var primary;
    var alternatives = [];
    var planReasons = [];
    if (actionable.length) {
      primary = actionable[0];
      primary.reasons = primary.reasons.concat([{
        code: "best_available_recovery",
        delta: 0,
        text: "Best available recovery action by operational actionScore."
      }]);
      alternatives = actionable.slice(1, 1 + maxAlts);
      planReasons.push({
        code: "best_available_recovery",
        delta: 0,
        text: "Selected " + primary.type + " as the best next operational action."
      });
    } else if (analysis.opensUsableCapacity && analysis.newlyFreedMinutes > 0 && opening) {
      primary = fallbackAction(analysis, "open_fill_opportunity");
      planReasons.push({
        code: "open_fill_fallback",
        delta: 0,
        text: "No qualifying move or waitlist action; leave the opening available to fill."
      });
    } else {
      primary = fallbackAction(analysis, "no_action");
      planReasons.push({
        code: "no_action",
        delta: 0,
        text: "No qualifying recovery action is available."
      });
    }
    return {
      primaryAction: primary,
      alternatives: alternatives,
      cancellationAnalysis: analysis,
      opening: opening,
      reasons: planReasons
    };
  }

  var api = ns();
  api.planCancellationRecovery = planCancellationRecovery;
  api.compareRecoveryActions = compareActions;
  api.PLAN = {
    BASE: BASE,
    OVERLAP_ACTION_PENALTY: OVERLAP_ACTION_PENALTY,
    DISRUPTION_CAP: DISRUPTION_CAP,
    DEFAULT_MAX_ALTERNATIVES: DEFAULT_MAX_ALTERNATIVES
  };
})();
