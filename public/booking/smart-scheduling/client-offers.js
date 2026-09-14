/**
 * Smart Scheduling Phase 15 — client visit offer generation.
 *
 * Recommendation-only. Selects a small, diverse set of complete Phase 14
 * visit plans. Does not reschedule, invent starts/providers/resources/waits,
 * book, message, or write.
 *
 * One offer = one Phase 14 source plan.
 *
 * Three signatures:
 *   exactSource          identity / traceability (includes providers + resources)
 *   offerEquivalence     HARD client-offer dedupe (providers yes, resourceId no)
 *   timelineDiversity    classification only (ignores providerId and resourceId)
 *
 * Resource-unit-only differences collapse. Provider-only differences do not.
 */
(function () {
  var DEFAULT_MAX_OFFERS = 3;
  var DEFAULT_MAX_SOURCE = 30;
  var DEFAULT_SCORE_DROP = 15;
  var DEFAULT_MIN_START_DIFF = 15;
  var DEFAULT_MIN_WAIT_DIFF = 5;
  var DEFAULT_MIN_ELAPSED_DIFF = 15;
  var OFFER_PREFIX = "__smart_offer__";
  var ROLE_PRIORITY = [
    "least_wait",
    "closest_to_preferred_start",
    "earliest_start",
    "shortest_visit",
    "original_order",
    "alternative_provider_plan"
  ];

  function ns() {
    return window.ffBookingSmartScheduling || (window.ffBookingSmartScheduling = {});
  }

  function optionNonNeg(obj, key, fallback) {
    if (!obj || obj[key] == null || obj[key] === "") return fallback;
    var n = Math.round(Number(obj[key]));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  function optionInt(obj, key, fallback) {
    if (!obj || obj[key] == null || obj[key] === "") return fallback;
    var n = Math.round(Number(obj[key]));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function comparePlans(a, b) {
    var api = ns();
    if (typeof api.compareFlexibleVisitPlans === "function") return api.compareFlexibleVisitPlans(a, b);
    var as = Number(a && a.flexibleVisitPlanScore) || 0;
    var bs = Number(b && b.flexibleVisitPlanScore) || 0;
    if (as !== bs) return bs - as;
    return String(a && a.assignmentKey || "").localeCompare(String(b && b.assignmentKey || ""));
  }

  function copyJson(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function lineTimeKey(plan) {
    return (plan.serviceLines || []).map(function (row) {
      return [row.lineKey, row.startMin, row.endMin, row.durationMinutes].join(":");
    }).join("|");
  }

  function lineProviderKey(plan) {
    return (plan.serviceLines || []).map(function (row) {
      return [row.lineKey, row.providerId, row.startMin, row.endMin, row.durationMinutes].join(":");
    }).join("|");
  }

  function blockTimelineKey(plan, includeSource) {
    return (plan.blocks || []).map(function (block) {
      return [
        includeSource ? String(block.sourceBlockIndex) : "",
        block.startMin,
        block.endMin,
        Number(block.waitBeforeMinutes) || 0,
        block.parallel ? 1 : 0,
        (block.lineKeys || []).join(",")
      ].join(":");
    }).join("|");
  }

  function resourceKey(plan) {
    var parts = [];
    (plan.serviceLines || []).forEach(function (line) {
      (line.resourceAssignments || []).forEach(function (row) {
        parts.push([line.lineKey, row.requirementKey, row.resourceId].join(":"));
      });
    });
    if (plan.resourceAssignmentKey) parts.push(String(plan.resourceAssignmentKey));
    return parts.join("|");
  }

  function timelineDiversitySignature(plan) {
    return [
      Number(plan.visitStartMin) || 0,
      Number(plan.visitEndMin) || 0,
      Number(plan.totalClientWaitMinutes) || 0,
      Number(plan.visitElapsedMinutes) || 0,
      blockTimelineKey(plan, false),
      lineTimeKey(plan)
    ].join("||");
  }

  function offerEquivalenceSignature(plan) {
    return [
      timelineDiversitySignature(plan),
      lineProviderKey(plan),
      providerKey(plan)
    ].join("||");
  }

  function exactSourceSignature(plan) {
    var lines = (plan.serviceLines || []).map(function (row) {
      var res = (row.resourceAssignments || []).map(function (item) {
        return [item.requirementKey, item.resourceId].join(":");
      }).join(",");
      return [row.lineKey, row.providerId, row.startMin, row.endMin, res].join(":");
    }).join("|");
    return [
      Number(plan.visitStartMin) || 0,
      Number(plan.visitEndMin) || 0,
      blockTimelineKey(plan, true),
      lines,
      String(plan.assignmentKey || ""),
      resourceKey(plan)
    ].join("||");
  }

  function exactPlanKey(plan) {
    return exactSourceSignature(plan);
  }

  function providerKey(plan) {
    return String(plan.assignmentKey || (plan.serviceLines || []).map(function (row) {
      return String(row.lineKey || "") + "|" + String(row.providerId || "");
    }).join("||"));
  }

  function parallelStructureKey(plan) {
    return (plan.blocks || []).map(function (block) {
      return (block.parallel ? "P" : "S") + ":" + (block.lineKeys || []).join(",");
    }).join("|");
  }

  function orderKey(plan) {
    return (plan.blocks || []).map(function (block) {
      return String(block.sourceBlockIndex);
    }).join("|") + "||" + (plan.serviceLines || []).map(function (row) { return row.lineKey; }).join("|");
  }

  function uniqueProviders(plan) {
    var ids = {};
    (plan.serviceLines || []).forEach(function (row) { if (row.providerId) ids[row.providerId] = true; });
    return Object.keys(ids);
  }

  function timingDistinct(a, b, mins) {
    if (Math.abs((Number(a.visitStartMin) || 0) - (Number(b.visitStartMin) || 0)) >= mins.minStart) return true;
    if (Math.abs((Number(a.totalClientWaitMinutes) || 0) - (Number(b.totalClientWaitMinutes) || 0)) >= mins.minWait) return true;
    if (Math.abs((Number(a.visitElapsedMinutes) || 0) - (Number(b.visitElapsedMinutes) || 0)) >= mins.minElapsed) return true;
    if (orderKey(a) !== orderKey(b)) return true;
    if (parallelStructureKey(a) !== parallelStructureKey(b)) return true;
    return false;
  }

  function providerDistinct(a, b) {
    return providerKey(a) !== providerKey(b);
  }

  function isMaterialVsSelected(candidate, selected, mins, allowProviderOnly) {
    if (!selected.length) return true;
    var newTimeline = selected.every(function (row) { return timingDistinct(candidate, row, mins); });
    if (newTimeline) return true;
    if (allowProviderOnly && selected.some(function (row) {
      return !timingDistinct(candidate, row, mins) && providerDistinct(candidate, row);
    })) return true;
    return false;
  }

  function remainingTimingAlternatives(candidates, selected, mins) {
    return candidates.some(function (plan) {
      return selected.indexOf(plan) === -1 && isMaterialVsSelected(plan, selected, mins, false);
    });
  }

  function pickBy(list, scoreFn, compare) {
    var best = null;
    list.forEach(function (item) {
      if (!best) {
        best = item;
        return;
      }
      var sa = scoreFn(item);
      var sb = scoreFn(best);
      if (sa < sb) best = item;
      else if (sa === sb && compare(item, best) < 0) best = item;
    });
    return best;
  }

  function classifyRoles(plan, best, eligible, request) {
    var roles = [];
    var minStart = Math.min.apply(null, eligible.map(function (row) { return Number(row.visitStartMin) || 0; }));
    var minWait = Math.min.apply(null, eligible.map(function (row) { return Number(row.totalClientWaitMinutes) || 0; }));
    var minElapsed = Math.min.apply(null, eligible.map(function (row) { return Number(row.visitElapsedMinutes) || 0; }));
    var minDist = Math.min.apply(null, eligible.map(function (row) { return Number(row.timeDistanceMinutes) || 0; }));
    var someReordered = eligible.some(function (row) { return !!row.orderChanged; });
    if (plan === best) roles.push("best_overall");
    if ((Number(plan.visitStartMin) || 0) === minStart) roles.push("earliest_start");
    if ((Number(plan.totalClientWaitMinutes) || 0) === minWait) roles.push("least_wait");
    if ((Number(plan.visitElapsedMinutes) || 0) === minElapsed) roles.push("shortest_visit");
    if (request && request.preferredStartMin != null && request.preferredStartMin !== "") {
      if ((Number(plan.timeDistanceMinutes) || 0) === minDist) roles.push("closest_to_preferred_start");
    }
    if (!plan.orderChanged && someReordered) roles.push("original_order");
    if (providerDistinct(plan, best)) roles.push("alternative_provider_plan");
    return roles;
  }

  function primaryRoleOf(roles, selectedFor) {
    if (roles.indexOf("best_overall") !== -1 && selectedFor === "best_overall") return "best_overall";
    var i;
    for (i = 0; i < ROLE_PRIORITY.length; i += 1) {
      if (roles.indexOf(ROLE_PRIORITY[i]) !== -1 && (selectedFor === ROLE_PRIORITY[i] || selectedFor === "timing" || selectedFor === "best_overall")) {
        if (selectedFor === "best_overall") break;
        if (selectedFor === "timing") return ROLE_PRIORITY[i];
        return ROLE_PRIORITY[i];
      }
    }
    if (selectedFor && selectedFor !== "timing" && selectedFor !== "provider") return selectedFor;
    if (roles.indexOf("alternative_provider_plan") !== -1) return "alternative_provider_plan";
    return roles[0] || "best_overall";
  }

  function advantageCodes(plan, roles) {
    var out = [];
    function add(code) {
      if (out.indexOf(code) === -1) out.push(code);
    }
    if (roles.indexOf("best_overall") !== -1) add("best_overall");
    if (roles.indexOf("earliest_start") !== -1) add("earliest_start");
    if ((Number(plan.totalClientWaitMinutes) || 0) === 0) add("no_client_wait");
    if (roles.indexOf("least_wait") !== -1) add("least_client_wait");
    if (roles.indexOf("shortest_visit") !== -1) add("shortest_visit");
    if (roles.indexOf("closest_to_preferred_start") !== -1) add("closest_to_preferred_start");
    if (!plan.orderChanged) add("keeps_original_service_order");
    if ((Number(plan.parallelMinutesSaved) || 0) > 0) add("parallel_services_reduce_visit_time");
    return out.map(function (code) { return { code: code }; });
  }

  function tradeoffCodes(plan, best) {
    var out = [];
    function add(code) {
      if (out.indexOf(code) === -1) out.push(code);
    }
    if ((Number(plan.totalClientWaitMinutes) || 0) > 0) add("requires_client_wait");
    if ((Number(plan.visitStartMin) || 0) > (Number(best.visitStartMin) || 0)) add("starts_later");
    if ((Number(plan.visitElapsedMinutes) || 0) > (Number(best.visitElapsedMinutes) || 0)) add("longer_visit");
    if (plan.orderChanged) add("services_reordered");
    if (uniqueProviders(plan).length > 1) add("uses_multiple_providers");
    if ((Number(plan.overlapLineCount) || 0) > 0) add("uses_permitted_overlap");
    return out.map(function (code) { return { code: code }; });
  }

  function copyBlocks(plan) {
    return copyJson(plan.blocks || []);
  }

  function copyServiceLines(plan) {
    return (plan.serviceLines || []).map(function (row) {
      return {
        lineKey: row.lineKey,
        serviceId: row.serviceId,
        providerId: row.providerId,
        startMin: row.startMin,
        endMin: row.endMin,
        durationMinutes: row.durationMinutes,
        blockIndex: row.blockIndex,
        resourceAssignments: copyJson(row.resourceAssignments || [])
      };
    });
  }

  function diversityTypeOf(plan, selected, index) {
    if (index === 0) return "best_overall";
    var mine = timelineDiversitySignature(plan);
    var i;
    for (i = 0; i < index; i += 1) {
      if (timelineDiversitySignature(selected[i]) === mine && providerDistinct(plan, selected[i])) {
        return "provider_only_alternative";
      }
    }
    return "client_timeline_alternative";
  }

  function diversityRank(offer) {
    var type = offer && offer.diversityType;
    if (type === "best_overall") return 0;
    if (type === "client_timeline_alternative") return 1;
    if (type === "provider_only_alternative") return 2;
    if (offer && (offer.primaryRole === "best_overall" || (offer.roles || []).indexOf("best_overall") !== -1)) return 0;
    return 1;
  }

  function toOffer(plan, roles, selectedFor, rank, metadata, diversityType) {
    var primary = selectedFor === "best_overall" ? "best_overall" : primaryRoleOf(roles, selectedFor);
    if (roles.indexOf(primary) === -1) roles = [primary].concat(roles);
    var sourceKey = exactPlanKey(plan);
    return {
      offerId: OFFER_PREFIX + "|" + sourceKey,
      primaryRole: primary,
      roles: roles.slice(),
      diversityType: diversityType || (selectedFor === "best_overall" ? "best_overall" : "client_timeline_alternative"),
      sourcePlanKey: sourceKey,
      sourcePlanRank: rank,
      sourcePlanScore: Number(plan.flexibleVisitPlanScore) || 0,
      visitStartMin: plan.visitStartMin,
      visitEndMin: plan.visitEndMin,
      totalClientWaitMinutes: Number(plan.totalClientWaitMinutes) || 0,
      visitElapsedMinutes: Number(plan.visitElapsedMinutes) || 0,
      sumServiceMinutes: Number(plan.sumServiceMinutes) || 0,
      parallelMinutesSaved: Number(plan.parallelMinutesSaved) || 0,
      orderChanged: !!plan.orderChanged,
      orderDistance: Number(plan.orderDistance) || 0,
      timeDistanceMinutes: Number(plan.timeDistanceMinutes) || 0,
      assignmentKey: providerKey(plan),
      blocks: copyBlocks(plan),
      serviceLines: copyServiceLines(plan),
      advantages: advantageCodes(plan, roles),
      tradeoffs: tradeoffCodes(plan, plan),
      sourceSearchMetadata: copyJson(plan.searchMetadata || {}),
      offerSetMetadata: metadata
    };
  }

  function compareClientVisitOffers(a, b) {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    var aDiv = diversityRank(a);
    var bDiv = diversityRank(b);
    if (aDiv !== bDiv) return aDiv - bDiv;
    if (a.sourcePlanScore !== b.sourcePlanScore) return b.sourcePlanScore - a.sourcePlanScore;
    if (a.totalClientWaitMinutes !== b.totalClientWaitMinutes) {
      return a.totalClientWaitMinutes - b.totalClientWaitMinutes;
    }
    if (a.visitElapsedMinutes !== b.visitElapsedMinutes) return a.visitElapsedMinutes - b.visitElapsedMinutes;
    if ((a.timeDistanceMinutes || 0) !== (b.timeDistanceMinutes || 0)) {
      return (a.timeDistanceMinutes || 0) - (b.timeDistanceMinutes || 0);
    }
    if (a.visitStartMin !== b.visitStartMin) return a.visitStartMin - b.visitStartMin;
    if ((a.orderDistance || 0) !== (b.orderDistance || 0)) return (a.orderDistance || 0) - (b.orderDistance || 0);
    return String(a.sourcePlanKey || "").localeCompare(String(b.sourcePlanKey || ""));
  }

  function emptyMetadata(extras) {
    return Object.assign({
      sourcePlanCount: 0,
      qualityEligiblePlanCount: 0,
      exactDedupedPlanCount: 0,
      offerEquivalenceGroupCount: 0,
      clientTimelineCount: 0,
      returnedOfferCount: 0,
      bestSourcePlanScore: 0,
      maxScoreDropFromBest: DEFAULT_SCORE_DROP,
      sourceSearchTruncated: false,
      sourceSearchExhaustive: true
    }, extras || {});
  }

  function finish(offers, metadata) {
    metadata.returnedOfferCount = offers.length;
    offers.forEach(function (offer) { offer.offerSetMetadata = metadata; });
    offers.offerSetMetadata = metadata;
    return offers;
  }

  function acquireSourcePlans(providerDays, resourceDays, request, options) {
    var opts = options && typeof options === "object" ? options : {};
    if (Array.isArray(opts.sourcePlans)) return opts.sourcePlans.slice();
    var api = ns();
    if (typeof api.rankFlexibleVisitPlans !== "function") return [];
    var maxSource = optionInt(opts, "maxSourcePlans", DEFAULT_MAX_SOURCE);
    var phase14Opts = Object.assign({}, opts);
    delete phase14Opts.sourcePlans;
    delete phase14Opts.maxOffers;
    delete phase14Opts.maxScoreDropFromBest;
    delete phase14Opts.minStartDifferenceMinutes;
    delete phase14Opts.minWaitDifferenceMinutes;
    delete phase14Opts.minElapsedDifferenceMinutes;
    delete phase14Opts.planQualityFilter;
    phase14Opts.maxReturnedPlans = maxSource;
    return api.rankFlexibleVisitPlans(providerDays, resourceDays, request, phase14Opts) || [];
  }

  function dedupeBy(plans, keyFn) {
    var seen = {};
    var out = [];
    plans.forEach(function (plan) {
      var key = keyFn(plan);
      if (seen[key]) return;
      seen[key] = true;
      out.push(plan);
    });
    return out;
  }

  function uniqueSignatureCount(plans, keyFn) {
    var seen = {};
    (plans || []).forEach(function (plan) { seen[keyFn(plan)] = true; });
    return Object.keys(seen).length;
  }

  function selectPlans(eligible, request, maxOffers, mins) {
    if (!eligible.length || maxOffers <= 0) return [];
    var selected = [eligible[0]];
    var selectedFor = ["best_overall"];
    if (selected.length >= maxOffers) return { selected: selected, selectedFor: selectedFor };

    function leftover() {
      return eligible.filter(function (plan) { return selected.indexOf(plan) === -1; });
    }

    function tryAdd(plan, reason, allowProviderOnly) {
      if (!plan || selected.indexOf(plan) !== -1 || selected.length >= maxOffers) return false;
      if (!isMaterialVsSelected(plan, selected, mins, allowProviderOnly)) return false;
      selected.push(plan);
      selectedFor.push(reason);
      return true;
    }

    var rest = leftover();
    var best = eligible[0];
    var roleFns = {
      least_wait: function (list) {
        if ((Number(best.totalClientWaitMinutes) || 0) >= mins.minWait) {
          var zero = list.filter(function (plan) { return (Number(plan.totalClientWaitMinutes) || 0) === 0; });
          if (zero.length) return pickBy(zero, function (plan) { return 0; }, comparePlans);
        }
        return pickBy(list, function (plan) { return Number(plan.totalClientWaitMinutes) || 0; }, comparePlans);
      },
      closest_to_preferred_start: function (list) {
        if (!request || request.preferredStartMin == null || request.preferredStartMin === "") return null;
        return pickBy(list, function (plan) { return Number(plan.timeDistanceMinutes) || 0; }, comparePlans);
      },
      earliest_start: function (list) {
        return pickBy(list, function (plan) { return Number(plan.visitStartMin) || 0; }, comparePlans);
      },
      shortest_visit: function (list) {
        return pickBy(list, function (plan) { return Number(plan.visitElapsedMinutes) || 0; }, comparePlans);
      },
      original_order: function (list) {
        if (!best.orderChanged) return null;
        var orig = list.filter(function (plan) { return !plan.orderChanged; });
        return orig.length ? orig.slice().sort(comparePlans)[0] : null;
      }
    };

    ROLE_PRIORITY.forEach(function (role) {
      if (selected.length >= maxOffers || role === "alternative_provider_plan") return;
      rest = leftover();
      var pick = roleFns[role] ? roleFns[role](rest) : null;
      tryAdd(pick, role, false);
    });

    leftover().slice().sort(comparePlans).forEach(function (plan) {
      if (selected.length >= maxOffers) return;
      tryAdd(plan, "timing", false);
    });

    if (selected.length < maxOffers && !remainingTimingAlternatives(eligible, selected, mins)) {
      leftover().slice().sort(comparePlans).forEach(function (plan) {
        if (selected.length >= maxOffers) return;
        tryAdd(plan, "alternative_provider_plan", true);
      });
    }
    return { selected: selected, selectedFor: selectedFor };
  }

  function rankClientVisitOffers(providerDays, resourceDays, request, options) {
    var opts = options && typeof options === "object" ? options : {};
    var req = request && typeof request === "object" ? request : {};
    var maxOffers = optionNonNeg(opts, "maxOffers", DEFAULT_MAX_OFFERS);
    var maxDrop = optionNonNeg(opts, "maxScoreDropFromBest", DEFAULT_SCORE_DROP);
    var mins = {
      minStart: optionNonNeg(opts, "minStartDifferenceMinutes", DEFAULT_MIN_START_DIFF),
      minWait: optionNonNeg(opts, "minWaitDifferenceMinutes", DEFAULT_MIN_WAIT_DIFF),
      minElapsed: optionNonNeg(opts, "minElapsedDifferenceMinutes", DEFAULT_MIN_ELAPSED_DIFF)
    };
    var source = acquireSourcePlans(providerDays, resourceDays, req, opts);
    var truncated = source.some(function (plan) {
      return plan && plan.searchMetadata && plan.searchMetadata.truncated === true;
    });
    var valid = source.filter(function (plan) { return plan && plan.valid !== false; });
    valid.sort(comparePlans);
    var metadata = emptyMetadata({
      sourcePlanCount: valid.length,
      maxScoreDropFromBest: maxDrop,
      sourceSearchTruncated: truncated,
      sourceSearchExhaustive: !truncated
    });
    if (!valid.length || maxOffers === 0) return finish([], metadata);

    var exactDeduped = dedupeBy(valid, exactSourceSignature);
    var offerGroups = dedupeBy(exactDeduped, offerEquivalenceSignature);
    metadata.exactDedupedPlanCount = exactDeduped.length;
    metadata.offerEquivalenceGroupCount = offerGroups.length;
    metadata.clientTimelineCount = uniqueSignatureCount(offerGroups, timelineDiversitySignature);

    var originalBest = offerGroups[0];
    var floor = (Number(originalBest.flexibleVisitPlanScore) || 0) - maxDrop;
    var filter = typeof opts.planQualityFilter === "function" ? opts.planQualityFilter : null;
    var eligible = offerGroups.filter(function (plan) {
      if (filter && filter(plan, originalBest) === false) return false;
      if (plan === originalBest) return true;
      if ((Number(plan.flexibleVisitPlanScore) || 0) < floor) return false;
      return true;
    });
    metadata.qualityEligiblePlanCount = eligible.length;
    metadata.bestSourcePlanScore = Number(originalBest.flexibleVisitPlanScore) || 0;
    if (!eligible.length) return finish([], metadata);

    var picked = selectPlans(eligible, req, maxOffers, mins);
    var rankByKey = {};
    valid.forEach(function (plan, idx) {
      var key = exactPlanKey(plan);
      if (rankByKey[key] == null) rankByKey[key] = idx + 1;
    });
    var offers = picked.selected.map(function (plan, idx) {
      var roles = classifyRoles(plan, eligible[0], eligible, req);
      var diversityType = diversityTypeOf(plan, picked.selected, idx);
      var offer = toOffer(plan, roles, picked.selectedFor[idx], rankByKey[exactPlanKey(plan)] || (idx + 1), metadata, diversityType);
      offer.tradeoffs = tradeoffCodes(plan, eligible[0]);
      return offer;
    });
    offers.sort(compareClientVisitOffers);
    return finish(offers, metadata);
  }

  function recommendClientVisitOffers(providerDays, resourceDays, request, options) {
    return rankClientVisitOffers(providerDays, resourceDays, request, options);
  }

  var api = ns();
  api.rankClientVisitOffers = rankClientVisitOffers;
  api.recommendClientVisitOffers = recommendClientVisitOffers;
  api.compareClientVisitOffers = compareClientVisitOffers;
  api.CLIENT_VISIT_OFFERS = {
    DEFAULT_MAX_OFFERS: DEFAULT_MAX_OFFERS,
    DEFAULT_MAX_SOURCE_PLANS: DEFAULT_MAX_SOURCE,
    DEFAULT_MAX_SCORE_DROP_FROM_BEST: DEFAULT_SCORE_DROP,
    DEFAULT_MIN_START_DIFFERENCE_MINUTES: DEFAULT_MIN_START_DIFF,
    DEFAULT_MIN_WAIT_DIFFERENCE_MINUTES: DEFAULT_MIN_WAIT_DIFF,
    DEFAULT_MIN_ELAPSED_DIFFERENCE_MINUTES: DEFAULT_MIN_ELAPSED_DIFF,
    OFFER_ID_PREFIX: OFFER_PREFIX,
    DIVERSITY_BEST_OVERALL: "best_overall",
    DIVERSITY_CLIENT_TIMELINE: "client_timeline_alternative",
    DIVERSITY_PROVIDER_ONLY: "provider_only_alternative"
  };
})();
