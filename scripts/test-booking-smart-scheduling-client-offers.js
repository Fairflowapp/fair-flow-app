/**
 * Smart Scheduling Phase 15 client visit offer generation.
 * No Firestore, DOM, Calendar, or Reports.
 * Usage: node scripts/test-booking-smart-scheduling-client-offers.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function load(rel, windowObj) {
  new Function("window", fs.readFileSync(path.join(root, rel), "utf8"))(windowObj);
}

const windowObj = {};
[
  "public/booking/smart-scheduling/normalize.js",
  "public/booking/smart-scheduling/gaps.js",
  "public/booking/smart-scheduling/candidates.js",
  "public/booking/smart-scheduling/score.js",
  "public/booking/smart-scheduling/engine.js",
  "public/booking/smart-scheduling/moves.js",
  "public/booking/smart-scheduling/day-analysis.js",
  "public/booking/smart-scheduling/priorities.js",
  "public/booking/smart-scheduling/assign.js",
  "public/booking/smart-scheduling/cancellation-recovery.js",
  "public/booking/smart-scheduling/waitlist.js",
  "public/booking/smart-scheduling/recovery-planner.js",
  "public/booking/smart-scheduling/gap-planner.js",
  "public/booking/smart-scheduling/global-plan.js",
  "public/booking/smart-scheduling/salon-plan.js",
  "public/booking/smart-scheduling/multi-service.js",
  "public/booking/smart-scheduling/parallel-multi-service.js",
  "public/booking/smart-scheduling/resource-aware-multi-service.js",
  "public/booking/smart-scheduling/flexible-visit.js",
  "public/booking/smart-scheduling/client-offers.js"
].forEach(function (rel) { load(rel, windowObj); });

const api = windowObj.ffBookingSmartScheduling;
if (!api || typeof api.rankClientVisitOffers !== "function") {
  console.error("Smart Scheduling client offer API did not load.");
  process.exit(1);
}

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

function makeDay(overrides) {
  return api.normalizeProviderDay(Object.assign({
    dateKey: "2026-09-14",
    locationId: "locA",
    providerId: "provA",
    workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }],
    lines: [],
    allowedOverlapMinutes: 0
  }, overrides || {}));
}

function makeResource(overrides) {
  return Object.assign({
    resourceId: "chair-1",
    resourceType: "pedicure_chair",
    locationId: "locA",
    dateKey: "2026-09-14",
    workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }],
    occupied: []
  }, overrides || {});
}

function svc(lineKey, durationMinutes, eligible, extra) {
  return Object.assign({
    lineKey: lineKey,
    serviceId: "svc-" + lineKey,
    durationMinutes: durationMinutes,
    eligibleProviderIds: eligible,
    assignmentType: "any_provider"
  }, extra || {});
}

function req(requirementKey, eligible, extra) {
  return Object.assign({
    requirementKey: requirementKey,
    eligibleResourceIds: eligible,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0
  }, extra || {});
}

function resAssign(requirementKey, resourceId, start, end) {
  return {
    requirementKey: requirementKey,
    resourceId: resourceId,
    resourceType: "pedicure_chair",
    serviceStartMin: start,
    serviceEndMin: end,
    reservationStartMin: start,
    reservationEndMin: end,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0
  };
}

function fakePlan(overrides) {
  const start = overrides.visitStartMin != null ? overrides.visitStartMin : 14 * 60;
  const wait = overrides.totalClientWaitMinutes != null ? overrides.totalClientWaitMinutes : 0;
  const gelEnd = start + 45;
  const pediStart = gelEnd + wait;
  const pediEnd = pediStart + 45;
  const lines = overrides.serviceLines || [
    {
      lineKey: "gel",
      serviceId: "svc-gel",
      providerId: overrides.gelProvider || "maria",
      startMin: start,
      endMin: gelEnd,
      durationMinutes: 45,
      blockIndex: 0,
      resourceAssignments: []
    },
    {
      lineKey: "pedi",
      serviceId: "svc-pedi",
      providerId: overrides.pediProvider || "ana",
      startMin: pediStart,
      endMin: pediEnd,
      durationMinutes: 45,
      blockIndex: 1,
      resourceAssignments: [resAssign("chair", overrides.chairId || "chair-1", pediStart, pediEnd)]
    }
  ];
  const blocks = overrides.blocks || [
    {
      blockIndex: 0,
      sourceBlockIndex: overrides.orderChanged ? 1 : 0,
      startMin: start,
      endMin: gelEnd,
      waitBeforeMinutes: 0,
      parallel: false,
      lineKeys: ["gel"],
      durationMinutes: 45
    },
    {
      blockIndex: 1,
      sourceBlockIndex: overrides.orderChanged ? 0 : 1,
      startMin: pediStart,
      endMin: pediEnd,
      waitBeforeMinutes: wait,
      parallel: false,
      lineKeys: ["pedi"],
      durationMinutes: 45
    }
  ];
  const assignmentKey = lines.map(function (row) { return row.lineKey + "|" + row.providerId; }).join("||");
  const resourceAssignmentKey = (overrides.chairId || "chair-1") === ""
    ? ""
    : "pedi|chair|" + (overrides.chairId || "chair-1");
  return Object.assign({
    valid: true,
    visitStartMin: start,
    visitEndMin: pediEnd,
    totalClientWaitMinutes: wait,
    visitElapsedMinutes: pediEnd - start,
    sumServiceMinutes: 90,
    parallelMinutesSaved: 0,
    orderChanged: !!overrides.orderChanged,
    orderDistance: overrides.orderDistance != null ? overrides.orderDistance : (overrides.orderChanged ? 1 : 0),
    timeDistanceMinutes: overrides.timeDistanceMinutes != null ? overrides.timeDistanceMinutes : 0,
    flexibleVisitPlanScore: overrides.flexibleVisitPlanScore != null ? overrides.flexibleVisitPlanScore : 90,
    assignmentKey: assignmentKey,
    resourceAssignmentKey: resourceAssignmentKey,
    overlapLineCount: 0,
    blocks: blocks,
    serviceLines: lines,
    searchMetadata: Object.assign({ truncated: false, exhaustive: true }, overrides.searchMetadata || {})
  }, overrides.extra || {});
}

function codes(list) {
  return (list || []).map(function (row) { return row.code; });
}

function offersFrom(plans, request, options) {
  return api.rankClientVisitOffers([], [], request || {}, Object.assign({ sourcePlans: plans }, options || {}));
}

const TWO = 14 * 60;
const maria = makeDay({ providerId: "maria" });
const ana = makeDay({ providerId: "ana" });
const emptyA = makeDay({ providerId: "provA" });
const emptyB = makeDay({ providerId: "provB" });
const chair1 = makeResource({ resourceId: "chair-1" });
const chair2 = makeResource({ resourceId: "chair-2" });
const snapMaria = JSON.stringify(maria);
const snapChair = JSON.stringify(chair1);

check("public client offer API loaded", !!(
  api.rankClientVisitOffers
  && api.recommendClientVisitOffers
  && api.compareClientVisitOffers
  && api.CLIENT_VISIT_OFFERS
));

// ---------------------------------------------------------------------------
// BEST OVERALL + REAL PHASE 14 SOURCE
// ---------------------------------------------------------------------------

const realReq = {
  serviceLines: [
    svc("gel", 45, ["maria"]),
    svc("pedi", 45, ["ana"], { resourceRequirements: [req("chair", ["chair-1"])] })
  ],
  preferredStartMin: TWO
};
const phase14 = api.rankFlexibleVisitPlans([maria, ana], [chair1], realReq);
const realOffers = api.rankClientVisitOffers([maria, ana], [chair1], realReq);
const realSnap = JSON.stringify(realReq);
check("Phase 14 winner is offer #1", !!(realOffers[0] && phase14[0] && realOffers[0].visitStartMin === phase14[0].visitStartMin && realOffers[0].visitEndMin === phase14[0].visitEndMin && realOffers[0].sourcePlanScore === phase14[0].flexibleVisitPlanScore && realOffers[0].primaryRole === "best_overall"), realOffers[0]);
check("best_overall role is present on the first offer", realOffers[0] && (realOffers[0].roles || []).indexOf("best_overall") !== -1);

// ---------------------------------------------------------------------------
// THREE DISTINCT / NO PADDING / EXAMPLE A+B / C DEDUPE / D FLOOR
// ---------------------------------------------------------------------------

const planA = fakePlan({
  visitStartMin: TWO,
  totalClientWaitMinutes: 5,
  flexibleVisitPlanScore: 91,
  timeDistanceMinutes: 0
});
const planB = fakePlan({
  visitStartMin: TWO + 30,
  totalClientWaitMinutes: 0,
  flexibleVisitPlanScore: 89,
  timeDistanceMinutes: 30
});
const planC = fakePlan({
  visitStartMin: TWO,
  totalClientWaitMinutes: 5,
  flexibleVisitPlanScore: 88,
  chairId: "chair-2",
  timeDistanceMinutes: 0
});
const planD = fakePlan({
  visitStartMin: TWO - 15,
  totalClientWaitMinutes: 25,
  flexibleVisitPlanScore: 72,
  timeDistanceMinutes: 15
});
const exampleOffers = offersFrom([planA, planB, planC, planD], { preferredStartMin: TWO });
check("example A/B/C/D returns two client offers", exampleOffers.length === 2, exampleOffers.length);
check("best overall is the 2:00 wait-5 plan", exampleOffers[0] && exampleOffers[0].visitStartMin === TWO && exampleOffers[0].totalClientWaitMinutes === 5 && exampleOffers[0].primaryRole === "best_overall");
check("no-wait later start is the meaningful alternative", exampleOffers[1] && exampleOffers[1].visitStartMin === TWO + 30 && exampleOffers[1].totalClientWaitMinutes === 0);
check("resource-only chair-2 plan is not a separate offer", exampleOffers.every(function (offer) {
  const pedi = (offer.serviceLines || []).find(function (row) { return row.lineKey === "pedi"; });
  return !pedi || (pedi.resourceAssignments || []).every(function (row) { return row.resourceId !== "chair-2" || offer.visitStartMin !== TWO || offer.totalClientWaitMinutes !== 5 || offer.sourcePlanScore === 91; });
}));
check("score-72 plan is excluded by the default quality floor", exampleOffers.every(function (offer) { return offer.sourcePlanScore !== 72; }));

const onlyOne = offersFrom([planA], {});
check("no padding when only one meaningful plan exists", onlyOne.length === 1 && onlyOne[0].primaryRole === "best_overall", onlyOne.length);

check("no valid complete plans returns an empty list", api.rankClientVisitOffers([maria], [], {
  serviceLines: [svc("gel", 45, ["nobody"]), svc("pedi", 45, ["nobody"])]
}).length === 0);

check("maxOffers 0 returns no offers", offersFrom([planA, planB], {}, { maxOffers: 0 }).length === 0);

// ---------------------------------------------------------------------------
// RESOURCE-ONLY / EXACT DUPLICATE
// ---------------------------------------------------------------------------

const chairTwin = offersFrom([
  fakePlan({ flexibleVisitPlanScore: 90, chairId: "chair-1" }),
  fakePlan({ flexibleVisitPlanScore: 90, chairId: "chair-2" })
], {});
check("resource-only hard dedupe: same providers/timeline, different chair => one offer", chairTwin.length === 1, chairTwin.length);
check("resource-only collapse keeps one offer-equivalence group", chairTwin.offerSetMetadata && chairTwin.offerSetMetadata.offerEquivalenceGroupCount === 1 && chairTwin.offerSetMetadata.exactDedupedPlanCount === 2 && chairTwin.offerSetMetadata.clientTimelineCount === 1, chairTwin.offerSetMetadata);

const exactDup = offersFrom([planA, JSON.parse(JSON.stringify(planA))], {});
check("exact duplicate source plans collapse to one offer", exactDup.length === 1, exactDup.length);

const providerEligible = offersFrom([
  fakePlan({ visitStartMin: TWO, totalClientWaitMinutes: 0, flexibleVisitPlanScore: 91, gelProvider: "maria" }),
  fakePlan({ visitStartMin: TWO, totalClientWaitMinutes: 0, flexibleVisitPlanScore: 90, gelProvider: "sara" })
], {}, { maxOffers: 2 });
check("provider-only is not hard-deduped: both remain eligible source candidates", providerEligible.length === 2 && providerEligible.offerSetMetadata.offerEquivalenceGroupCount === 2 && providerEligible.offerSetMetadata.clientTimelineCount === 1, providerEligible.offerSetMetadata);

// ---------------------------------------------------------------------------
// QUALITY FLOOR
// ---------------------------------------------------------------------------

const floor74 = offersFrom([
  fakePlan({ flexibleVisitPlanScore: 90, visitStartMin: TWO }),
  fakePlan({ flexibleVisitPlanScore: 74, visitStartMin: TWO + 30, totalClientWaitMinutes: 0 })
], {}, { maxScoreDropFromBest: 15 });
check("score 74 is excluded when best is 90 and drop cap is 15", floor74.length === 1 && floor74[0].sourcePlanScore === 90, floor74.map(function (row) { return row.sourcePlanScore; }));

const floor75 = offersFrom([
  fakePlan({ flexibleVisitPlanScore: 90, visitStartMin: TWO }),
  fakePlan({ flexibleVisitPlanScore: 75, visitStartMin: TWO + 30, totalClientWaitMinutes: 0 })
], {}, { maxScoreDropFromBest: 15 });
check("score 75 is eligible when best is 90 and drop cap is 15", floor75.length === 2 && floor75.some(function (row) { return row.sourcePlanScore === 75; }), floor75.map(function (row) { return row.sourcePlanScore; }));

// ---------------------------------------------------------------------------
// EARLY WITH WAIT VS LATER NO WAIT
// ---------------------------------------------------------------------------

const trade = offersFrom([
  fakePlan({ visitStartMin: TWO, totalClientWaitMinutes: 10, flexibleVisitPlanScore: 90, timeDistanceMinutes: 0 }),
  fakePlan({ visitStartMin: TWO + 20, totalClientWaitMinutes: 0, flexibleVisitPlanScore: 88, timeDistanceMinutes: 20 })
], { preferredStartMin: TWO });
check("early-with-wait and later-no-wait can both appear", trade.length === 2 && trade.some(function (row) { return row.visitStartMin === TWO && row.totalClientWaitMinutes === 10; }) && trade.some(function (row) { return row.visitStartMin === TWO + 20 && row.totalClientWaitMinutes === 0; }), trade);

// ---------------------------------------------------------------------------
// PREFERRED START / ORIGINAL ORDER
// ---------------------------------------------------------------------------

const preferred = offersFrom([
  fakePlan({ visitStartMin: TWO + 15, totalClientWaitMinutes: 0, flexibleVisitPlanScore: 90, timeDistanceMinutes: 15 }),
  fakePlan({ visitStartMin: TWO, totalClientWaitMinutes: 5, flexibleVisitPlanScore: 88, timeDistanceMinutes: 0 })
], { preferredStartMin: TWO });
check("closest strong plan can receive closest_to_preferred_start", preferred.some(function (row) {
  return row.visitStartMin === TWO && ((row.roles || []).indexOf("closest_to_preferred_start") !== -1 || row.primaryRole === "closest_to_preferred_start");
}), preferred.map(function (row) { return { start: row.visitStartMin, roles: row.roles, primary: row.primaryRole }; }));

const reorderedBest = fakePlan({
  visitStartMin: TWO,
  totalClientWaitMinutes: 5,
  flexibleVisitPlanScore: 91,
  orderChanged: true,
  orderDistance: 1
});
const originalAlt = fakePlan({
  visitStartMin: TWO + 30,
  totalClientWaitMinutes: 0,
  flexibleVisitPlanScore: 88,
  orderChanged: false,
  orderDistance: 0
});
const originalOffers = offersFrom([reorderedBest, originalAlt], {});
check("strong original-order alternative can surface with original_order", originalOffers.some(function (row) {
  return row.orderChanged === false && ((row.roles || []).indexOf("original_order") !== -1 || row.primaryRole === "original_order");
}), originalOffers.map(function (row) { return { changed: row.orderChanged, roles: row.roles, primary: row.primaryRole }; }));

// ---------------------------------------------------------------------------
// PROVIDER-ONLY LOWER DIVERSITY / FALLBACK
// ---------------------------------------------------------------------------

const timingAlt = fakePlan({
  visitStartMin: TWO + 30,
  totalClientWaitMinutes: 0,
  flexibleVisitPlanScore: 88,
  gelProvider: "maria",
  pediProvider: "ana"
});
const providerOnly = fakePlan({
  visitStartMin: TWO,
  totalClientWaitMinutes: 5,
  flexibleVisitPlanScore: 90,
  gelProvider: "sara",
  pediProvider: "ana",
  extra: { flexibleVisitPlanScore: 87 }
});
providerOnly.flexibleVisitPlanScore = 87;
const providerVsTiming = offersFrom([
  fakePlan({ visitStartMin: TWO, totalClientWaitMinutes: 5, flexibleVisitPlanScore: 91, gelProvider: "maria" }),
  timingAlt,
  providerOnly
], {}, { maxOffers: 2 });
check("provider-only alternative does not displace a stronger time/wait alternative", providerVsTiming.length === 2 && providerVsTiming[0].primaryRole === "best_overall" && providerVsTiming.some(function (row) { return row.visitStartMin === TWO + 30 && row.totalClientWaitMinutes === 0; }) && providerVsTiming.every(function (row) { return (row.serviceLines || []).every(function (line) { return line.lineKey !== "gel" || line.providerId !== "sara"; }); }), providerVsTiming);

const providerFallback = offersFrom([
  fakePlan({ visitStartMin: TWO, totalClientWaitMinutes: 0, flexibleVisitPlanScore: 91, gelProvider: "maria" }),
  fakePlan({ visitStartMin: TWO, totalClientWaitMinutes: 0, flexibleVisitPlanScore: 90, gelProvider: "sara" })
], {}, { maxOffers: 2 });
check("provider-only fallback: different provider may appear when no timing alternatives exist", providerFallback.length === 2 && providerFallback[0].diversityType === "best_overall" && providerFallback[1].diversityType === "provider_only_alternative" && providerFallback.some(function (row) {
  return (row.serviceLines || []).some(function (line) { return line.lineKey === "gel" && line.providerId === "sara"; });
}), providerFallback.map(function (row) { return { gel: row.serviceLines.map(function (line) { return line.providerId; }), div: row.diversityType }; }));

check("comparator: client-timeline alternative sorts before higher-scoring provider-only", api.compareClientVisitOffers({
  diversityType: "client_timeline_alternative",
  sourcePlanScore: 88,
  totalClientWaitMinutes: 0,
  visitElapsedMinutes: 90,
  timeDistanceMinutes: 30,
  visitStartMin: TWO + 30,
  orderDistance: 0,
  sourcePlanKey: "timeline"
}, {
  diversityType: "provider_only_alternative",
  sourcePlanScore: 89,
  totalClientWaitMinutes: 5,
  visitElapsedMinutes: 95,
  timeDistanceMinutes: 0,
  visitStartMin: TWO,
  orderDistance: 0,
  sourcePlanKey: "provider"
}) < 0);

const comboA = fakePlan({ visitStartMin: TWO, totalClientWaitMinutes: 5, flexibleVisitPlanScore: 90, gelProvider: "maria", chairId: "chair-1" });
const comboB = fakePlan({ visitStartMin: TWO, totalClientWaitMinutes: 5, flexibleVisitPlanScore: 90, gelProvider: "maria", chairId: "chair-2" });
const comboC = fakePlan({ visitStartMin: TWO, totalClientWaitMinutes: 5, flexibleVisitPlanScore: 89, gelProvider: "sara", chairId: "chair-1" });
const comboD = fakePlan({ visitStartMin: TWO + 30, totalClientWaitMinutes: 0, flexibleVisitPlanScore: 88, gelProvider: "maria" });
const combo3 = offersFrom([comboA, comboB, comboC, comboD], {}, { maxOffers: 3 });
const combo2 = offersFrom([comboA, comboB, comboC, comboD], {}, { maxOffers: 2 });
function gelProviderOf(offer) {
  const line = (offer.serviceLines || []).find(function (row) { return row.lineKey === "gel"; });
  return line && line.providerId;
}
function chairOf(offer) {
  const line = (offer.serviceLines || []).find(function (row) { return row.lineKey === "pedi"; });
  const res = line && (line.resourceAssignments || [])[0];
  return res && res.resourceId;
}
check("combined A/B/C/D maxOffers=2 is A + D, not A + C", combo2.length === 2 && combo2[0].primaryRole === "best_overall" && gelProviderOf(combo2[0]) === "maria" && combo2[0].visitStartMin === TWO && combo2.some(function (row) { return row.visitStartMin === TWO + 30 && row.totalClientWaitMinutes === 0; }) && combo2.every(function (row) { return gelProviderOf(row) !== "sara"; }), combo2.map(function (row) { return { start: row.visitStartMin, wait: row.totalClientWaitMinutes, gel: gelProviderOf(row), chair: chairOf(row) }; }));
check("combined A/B/C/D maxOffers=3 returns A, D, C in that order", combo3.length === 3 && combo3[0].diversityType === "best_overall" && gelProviderOf(combo3[0]) === "maria" && chairOf(combo3[0]) === "chair-1" && combo3[0].visitStartMin === TWO && combo3[1].diversityType === "client_timeline_alternative" && combo3[1].visitStartMin === TWO + 30 && combo3[1].totalClientWaitMinutes === 0 && combo3[1].sourcePlanScore === 88 && combo3[2].diversityType === "provider_only_alternative" && gelProviderOf(combo3[2]) === "sara" && combo3[2].sourcePlanScore === 89 && chairOf(combo3[0]) !== "chair-2", combo3.map(function (row) { return { start: row.visitStartMin, wait: row.totalClientWaitMinutes, gel: gelProviderOf(row), chair: chairOf(row), score: row.sourcePlanScore, div: row.diversityType }; }));
check("combined metadata: exact 4, offer-equivalence 3, timeline-diversity 2", combo3.offerSetMetadata && combo3.offerSetMetadata.exactDedupedPlanCount === 4 && combo3.offerSetMetadata.offerEquivalenceGroupCount === 3 && combo3.offerSetMetadata.clientTimelineCount === 2, combo3.offerSetMetadata);

const multiTimeline = offersFrom([
  fakePlan({ visitStartMin: TWO, totalClientWaitMinutes: 5, flexibleVisitPlanScore: 90 }),
  fakePlan({ visitStartMin: TWO + 30, totalClientWaitMinutes: 0, flexibleVisitPlanScore: 88 }),
  fakePlan({ visitStartMin: TWO + 45, totalClientWaitMinutes: 0, flexibleVisitPlanScore: 86 })
], {}, { maxOffers: 3 });
check("multiple timeline alternatives sort by score/wait after best_overall", multiTimeline.length === 3 && multiTimeline[0].diversityType === "best_overall" && multiTimeline[1].diversityType === "client_timeline_alternative" && multiTimeline[1].sourcePlanScore === 88 && multiTimeline[2].diversityType === "client_timeline_alternative" && multiTimeline[2].sourcePlanScore === 86 && multiTimeline[1].visitStartMin === TWO + 30 && multiTimeline[2].visitStartMin === TWO + 45, multiTimeline.map(function (row) { return { start: row.visitStartMin, score: row.sourcePlanScore, div: row.diversityType }; }));

const multiProvider = offersFrom([
  fakePlan({ visitStartMin: TWO, totalClientWaitMinutes: 0, flexibleVisitPlanScore: 91, gelProvider: "maria" }),
  fakePlan({ visitStartMin: TWO, totalClientWaitMinutes: 0, flexibleVisitPlanScore: 89, gelProvider: "sara" }),
  fakePlan({ visitStartMin: TWO, totalClientWaitMinutes: 0, flexibleVisitPlanScore: 87, gelProvider: "lea" })
], {}, { maxOffers: 3 });
check("multiple provider-only alternatives sort by score after best_overall", multiProvider.length === 3 && multiProvider[0].diversityType === "best_overall" && gelProviderOf(multiProvider[0]) === "maria" && multiProvider[1].diversityType === "provider_only_alternative" && gelProviderOf(multiProvider[1]) === "sara" && multiProvider[1].sourcePlanScore === 89 && multiProvider[2].diversityType === "provider_only_alternative" && gelProviderOf(multiProvider[2]) === "lea" && multiProvider[2].sourcePlanScore === 87, multiProvider.map(function (row) { return { gel: gelProviderOf(row), score: row.sourcePlanScore, div: row.diversityType }; }));

const filteredWinner = offersFrom([
  fakePlan({ visitStartMin: TWO, totalClientWaitMinutes: 5, flexibleVisitPlanScore: 91 }),
  fakePlan({ visitStartMin: TWO + 30, totalClientWaitMinutes: 0, flexibleVisitPlanScore: 88 })
], {}, {
  planQualityFilter: function (plan) { return plan.flexibleVisitPlanScore !== 91; }
});
check("quality filter removing the Phase 14 winner promotes the next surviving plan to best_overall", filteredWinner.length >= 1 && filteredWinner[0].primaryRole === "best_overall" && filteredWinner[0].sourcePlanScore === 88 && filteredWinner[0].visitStartMin === TWO + 30 && filteredWinner.offerSetMetadata.bestSourcePlanScore === 91 && filteredWinner.every(function (row) { return row.sourcePlanScore !== 91; }), filteredWinner);

// ---------------------------------------------------------------------------
// TRACEABILITY / ATOMIC / TIMELINE PRESERVED
// ---------------------------------------------------------------------------

check("every offer maps to exactly one source Phase 14 plan", exampleOffers.every(function (offer) {
  return exampleOffers.filter(function (other) { return other.sourcePlanKey === offer.sourcePlanKey; }).length === 1
    && typeof offer.sourcePlanRank === "number"
    && offer.sourcePlanRank >= 1;
}));
check("offers are not cross-composed from two plans", exampleOffers[1] && exampleOffers[1].visitStartMin === TWO + 30 && exampleOffers[1].visitEndMin === TWO + 30 + 90 && exampleOffers[1].totalClientWaitMinutes === 0);
check("each service line keeps a single atomic providerId", exampleOffers.every(function (offer) {
  return (offer.serviceLines || []).every(function (line) {
    return typeof line.providerId === "string" && line.providerId && !Array.isArray(line.providerId) && line.endMin === line.startMin + line.durationMinutes;
  });
}));

const waitOffer = exampleOffers[0];
check("offer timeline exactly matches the source Phase 14 plan", waitOffer && waitOffer.visitStartMin === planA.visitStartMin && waitOffer.visitEndMin === planA.visitEndMin && waitOffer.totalClientWaitMinutes === planA.totalClientWaitMinutes && waitOffer.blocks[0].startMin === planA.blocks[0].startMin && waitOffer.blocks[1].waitBeforeMinutes === planA.blocks[1].waitBeforeMinutes);

// ---------------------------------------------------------------------------
// ADVANTAGES / TRADEOFFS / IDS / ORDER
// ---------------------------------------------------------------------------

check("advantage and tradeoff codes are structured codes only", waitOffer && codes(waitOffer.advantages).indexOf("best_overall") !== -1 && codes(waitOffer.tradeoffs).indexOf("requires_client_wait") !== -1 && waitOffer.advantages.every(function (row) { return row.code && !row.text; }));
check("later no-wait offer records starts_later and no_client_wait", exampleOffers[1] && codes(exampleOffers[1].advantages).indexOf("no_client_wait") !== -1 && codes(exampleOffers[1].tradeoffs).indexOf("starts_later") !== -1);

const again = offersFrom([planA, planB, planC, planD], { preferredStartMin: TWO });
check("deterministic offer IDs and order", JSON.stringify(exampleOffers.map(function (row) { return row.offerId; })) === JSON.stringify(again.map(function (row) { return row.offerId; })) && exampleOffers[0].offerId.indexOf("__smart_offer__") === 0);
check("signature determinism: same logical plans yield same sourcePlanKeys", JSON.stringify(exampleOffers.map(function (row) { return row.sourcePlanKey; })) === JSON.stringify(again.map(function (row) { return row.sourcePlanKey; })));

check("recommendClientVisitOffers matches rankClientVisitOffers", JSON.stringify(api.recommendClientVisitOffers([], [], { preferredStartMin: TWO }, { sourcePlans: [planA, planB, planC, planD] }).map(function (row) { return row.offerId; })) === JSON.stringify(exampleOffers.map(function (row) { return row.offerId; })));

// ---------------------------------------------------------------------------
// THREE DISTINCT ROLES
// ---------------------------------------------------------------------------

const parallel = fakePlan({
  visitStartMin: TWO + 45,
  totalClientWaitMinutes: 0,
  flexibleVisitPlanScore: 88,
  extra: {}
});
parallel.blocks = [{
  blockIndex: 0,
  sourceBlockIndex: 0,
  startMin: TWO + 45,
  endMin: TWO + 90,
  waitBeforeMinutes: 0,
  parallel: true,
  parallelGroup: "g",
  lineKeys: ["gel", "pedi"],
  durationMinutes: 45
}];
parallel.serviceLines = [
  { lineKey: "gel", serviceId: "svc-gel", providerId: "maria", startMin: TWO + 45, endMin: TWO + 90, durationMinutes: 45, blockIndex: 0, resourceAssignments: [] },
  { lineKey: "pedi", serviceId: "svc-pedi", providerId: "ana", startMin: TWO + 45, endMin: TWO + 90, durationMinutes: 45, blockIndex: 0, resourceAssignments: [resAssign("chair", "chair-1", TWO + 45, TWO + 90)] }
];
parallel.visitEndMin = TWO + 90;
parallel.visitElapsedMinutes = 45;
parallel.parallelMinutesSaved = 45;
parallel.assignmentKey = "gel|maria||pedi|ana";
const three = offersFrom([planA, planB, parallel], { preferredStartMin: TWO }, { maxOffers: 3 });
check("up to three meaningfully distinct offers are returned", three.length === 3, three.map(function (row) { return { start: row.visitStartMin, wait: row.totalClientWaitMinutes, elapsed: row.visitElapsedMinutes, parallel: row.blocks[0] && row.blocks[0].parallel }; }));

// ---------------------------------------------------------------------------
// TRUNCATION / METADATA
// ---------------------------------------------------------------------------

const truncatedPlan = fakePlan({
  flexibleVisitPlanScore: 90,
  searchMetadata: { truncated: true, exhaustive: false }
});
const truncatedOffers = offersFrom([truncatedPlan], {});
check("Phase 14 truncation is propagated and not claimed exhaustive", truncatedOffers[0] && truncatedOffers[0].offerSetMetadata.sourceSearchTruncated === true && truncatedOffers[0].offerSetMetadata.sourceSearchExhaustive === false && truncatedOffers.offerSetMetadata.sourceSearchTruncated === true);

const realTrunc = api.rankClientVisitOffers([emptyA, emptyB], [chair1], {
  serviceLines: [
    svc("mani", 30, ["provA"]),
    svc("pedi", 30, ["provB"], { resourceRequirements: [req("chair", ["chair-1"])] })
  ],
  allowServiceReordering: true,
  allowClientWait: true,
  maxWaitBetweenBlocksMinutes: 30,
  maxTotalClientWaitMinutes: 30
}, { maxVisitStartCandidates: 1, maxOrderPermutations: 1, maxSourcePlans: 30 });
check("real truncated Phase 14 search is reflected on the offer set", !realTrunc.length || realTrunc.offerSetMetadata.sourceSearchTruncated === true, realTrunc.offerSetMetadata);

// ---------------------------------------------------------------------------
// SOURCE TRACE / IMMUTABILITY / PURITY
// ---------------------------------------------------------------------------

const srcPlans = [planA, planB];
const srcSnap = JSON.stringify(srcPlans);
const srcOffers = offersFrom(srcPlans, { preferredStartMin: TWO });
check("source plans are unchanged", JSON.stringify(srcPlans) === srcSnap);
check("providerDays are unchanged", JSON.stringify(maria) === snapMaria);
check("resourceDays are unchanged", JSON.stringify(chair1) === snapChair);
check("request is unchanged", JSON.stringify(realReq) === realSnap);
check("same inputs yield the same logical offers", JSON.stringify(srcOffers) === JSON.stringify(offersFrom(srcPlans, { preferredStartMin: TWO })));

const src = fs.readFileSync(path.join(root, "public/booking/smart-scheduling/client-offers.js"), "utf8");
check("purity: no Firebase APIs", !/firebase-firestore|getDocs\s*\(|onSnapshot\s*\(|updateDoc\s*\(|addDoc\s*\(/.test(src));
check("purity: no network", !/\bfetch\s*\(|XMLHttpRequest/.test(src));
check("purity: no writes / timers / Date", !/\bsetTimeout\b|\bsetInterval\b|\bDate\s*\(|createAppointment|updateAppointment|cancelAppointment/.test(src));
check("purity: no DOM / Calendar / Reports", !/\bdocument\b|\blocalStorage\b|ffBookingCal|ffBookingReports/.test(src));
check("purity: no messaging / booking / client copy", !/sendSms|sendEmail|twilio|mailer|bookClient|autoBook|Would you like|phone script/i.test(src));
check("does not rewrite Phase 14 planner", !/function rankFlexibleVisitPlans/.test(src));

if (failed) {
  console.log("\n" + failed + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll client visit offer checks passed.");
