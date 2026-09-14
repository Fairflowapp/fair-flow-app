/**
 * Smart Scheduling Phase 14 flexible visit orchestration.
 * No Firestore, DOM, Calendar, or Reports.
 * Usage: node scripts/test-booking-smart-scheduling-flexible-visit.js
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
  "public/booking/smart-scheduling/flexible-visit.js"
].forEach(function (rel) { load(rel, windowObj); });

const api = windowObj.ffBookingSmartScheduling;
if (!api || typeof api.rankFlexibleVisitPlans !== "function") {
  console.error("Smart Scheduling flexible visit API did not load.");
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

function clamp(value, lo, hi) {
  var n = Math.round(Number(value));
  if (!Number.isFinite(n)) n = 0;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function expectedFlexibleScore(row, providerCount, workingMinutes) {
  var optAvg = providerCount === 0 ? 0 : Math.round((Number(row.optimizationDeltaTotal) || 0) / providerCount);
  var fragAvg = providerCount === 0 ? 0 : Math.round((Number(row.fragmentationDeltaTotal) || 0) / providerCount);
  var strandedPct = workingMinutes === 0 ? 0 : Math.round(100 * (Number(row.strandedBetweenMinutesDeltaTotal) || 0) / workingMinutes);
  var raw = 50;
  raw += Number(row.slotFitComponent) || 0;
  raw += clamp(optAvg, -20, 20);
  raw -= clamp(Math.max(0, fragAvg), 0, 20);
  raw += clamp(Math.max(0, -fragAvg), 0, 15);
  raw -= clamp(Math.max(0, strandedPct), 0, 15);
  raw += Number(row.timePreferenceBonus) || 0;
  raw += Number(row.parallelEfficiencyBonus) || 0;
  raw -= Math.min(20, (Number(row.overlapLineCount) || 0) * 5);
  raw -= Number(row.clientWaitPenalty) || 0;
  return clamp(raw, 0, 100);
}

function line(startMin, endMin, extra) {
  return Object.assign({
    lineId: "l-" + startMin + "-" + endMin,
    appointmentId: "a-" + startMin,
    providerId: extra && extra.providerId || "provA",
    startMin: startMin,
    endMin: endMin,
    status: "scheduled"
  }, extra || {});
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

function assignmentOf(plan, lineKey, requirementKey) {
  const lineRow = (plan && plan.serviceLines || []).find(function (row) { return row.lineKey === lineKey; });
  return (lineRow && lineRow.resourceAssignments || []).find(function (row) {
    return row.requirementKey === requirementKey;
  });
}

function lineOf(plan, lineKey) {
  return (plan && plan.serviceLines || []).find(function (row) { return row.lineKey === lineKey; });
}

function reasonCodes(plan) {
  return (plan && plan.reasons || []).map(function (row) { return row.code; });
}

const TWO = 14 * 60;
const maria = makeDay({ providerId: "maria" });
const ana = makeDay({ providerId: "ana" });
const emptyA = makeDay({ providerId: "provA" });
const emptyB = makeDay({ providerId: "provB" });
const emptyC = makeDay({ providerId: "provC" });
const chair1 = makeResource({ resourceId: "chair-1" });
const snapMaria = JSON.stringify(maria);
const snapChair = JSON.stringify(chair1);

check("public flexible visit API loaded", !!(
  api.rankFlexibleVisitPlans
  && api.recommendFlexibleVisit
  && api.compareFlexibleVisitPlans
  && api.FLEXIBLE_VISIT
  && api.PHASE13_INTERNALS
));

// ---------------------------------------------------------------------------
// MANI FIRST BECAUSE PEDI CHAIR IS BUSY
// ---------------------------------------------------------------------------

const busyUntil250 = makeResource({
  resourceId: "chair-1",
  occupied: [{ occupancyId: "am-pedi", startMin: 9 * 60, endMin: TWO + 50 }]
});
const maniPediFlex = {
  serviceLines: [
    svc("gel", 45, ["maria"]),
    svc("pedi", 45, ["ana"], { resourceRequirements: [req("chair", ["chair-1"])] })
  ],
  preferredStartMin: TWO,
  allowServiceReordering: true,
  allowClientWait: true,
  maxWaitBetweenBlocksMinutes: 5,
  maxTotalClientWaitMinutes: 5
};
const chairBusy = api.recommendFlexibleVisit([maria, ana], [busyUntil250], maniPediFlex);
const gelLine = lineOf(chairBusy, "gel");
const pediLine = lineOf(chairBusy, "pedi");
check("mani-first / chair-busy yields a complete visit", !!(chairBusy && chairBusy.valid), chairBusy);
check("2:00–2:45 Gel Manicure is Maria", !!(gelLine && gelLine.providerId === "maria" && gelLine.startMin === TWO && gelLine.endMin === TWO + 45), gelLine);
check("2:45–2:50 is a 5-minute client wait", !!(chairBusy && chairBusy.totalClientWaitMinutes === 5 && (chairBusy.blocks || []).some(function (block) {
  return block.lineKeys.indexOf("pedi") !== -1 && block.waitBeforeMinutes === 5 && block.startMin === TWO + 50;
})), chairBusy && chairBusy.blocks);
check("2:50–3:35 Regular Pedicure is Ana on the freed chair", !!(pediLine && pediLine.providerId === "ana" && pediLine.startMin === TWO + 50 && pediLine.endMin === TWO + 95 && assignmentOf(chairBusy, "pedi", "chair") && assignmentOf(chairBusy, "pedi", "chair").resourceId === "chair-1"), pediLine);
check("chair-busy case is not rejected just because 2:00 had no pedi chair", chairBusy && chairBusy.valid && reasonCodes(chairBusy).indexOf("waits_for_resource_availability") !== -1 && reasonCodes(chairBusy).indexOf("client_wait_required") !== -1);

const noFlexChair = Object.assign({}, maniPediFlex, {
  allowServiceReordering: false,
  allowClientWait: false,
  maxWaitBetweenBlocksMinutes: 0,
  maxTotalClientWaitMinutes: 0
});
check("without wait the 2:00 chair-busy request has no contiguous Phase 13 visit", api.recommendFlexibleVisit([maria, ana], [busyUntil250], noFlexChair) === null);

// ---------------------------------------------------------------------------
// SPLIT SERVICES ACROSS PROVIDERS
// ---------------------------------------------------------------------------

const mariaShort = makeDay({
  providerId: "maria",
  workingIntervals: [{ startMin: TWO, endMin: TWO + 45 }]
});
const anaLate = makeDay({
  providerId: "ana",
  workingIntervals: [{ startMin: TWO + 50, endMin: TWO + 95 }]
});
const splitReq = {
  serviceLines: [
    svc("gel", 45, ["maria"]),
    svc("pedi", 45, ["ana"])
  ],
  preferredStartMin: TWO,
  allowServiceReordering: true,
  allowClientWait: true,
  maxWaitBetweenBlocksMinutes: 5,
  maxTotalClientWaitMinutes: 5
};
const split = api.recommendFlexibleVisit([mariaShort, anaLate], [], splitReq);
check("split-across-providers completes with A then wait then B", !!(split && split.valid && lineOf(split, "gel") && lineOf(split, "gel").providerId === "maria" && lineOf(split, "pedi") && lineOf(split, "pedi").providerId === "ana" && split.totalClientWaitMinutes === 5), split);
check("no single provider owns the whole visit", !!(split && lineOf(split, "gel").providerId !== lineOf(split, "pedi").providerId));
check("each service line has exactly one providerId", !!(split && (split.serviceLines || []).every(function (row) {
  return typeof row.providerId === "string" && row.providerId && !Array.isArray(row.providerId);
})));
check("split case waits for provider availability", reasonCodes(split).indexOf("waits_for_provider_availability") !== -1 || reasonCodes(split).indexOf("uses_multiple_providers") !== -1, reasonCodes(split));

// ---------------------------------------------------------------------------
// ATOMIC SERVICE — no A30 + B30 handoff
// ---------------------------------------------------------------------------

const provA30 = makeDay({
  providerId: "provA",
  workingIntervals: [{ startMin: TWO, endMin: TWO + 30 }]
});
const provB30 = makeDay({
  providerId: "provB",
  workingIntervals: [{ startMin: TWO + 30, endMin: TWO + 60 }]
});
const atomic = api.recommendFlexibleVisit([provA30, provB30, emptyC], [], {
  serviceLines: [
    svc("mani60", 60, ["provA", "provB"]),
    svc("brows", 15, ["provC"])
  ],
  preferredStartMin: TWO,
  allowServiceReordering: true,
  allowClientWait: true,
  maxWaitBetweenBlocksMinutes: 30,
  maxTotalClientWaitMinutes: 30
});
check("atomic 60-minute manicure is not split across two 30-minute providers", atomic === null, atomic);

// ---------------------------------------------------------------------------
// REORDER
// ---------------------------------------------------------------------------

const pediFirstReq = {
  serviceLines: [
    svc("pedi", 45, ["ana"], { resourceRequirements: [req("chair", ["chair-1"])] }),
    svc("gel", 45, ["maria"])
  ],
  preferredStartMin: TWO,
  allowServiceReordering: true,
  allowClientWait: true,
  maxWaitBetweenBlocksMinutes: 5,
  maxTotalClientWaitMinutes: 5
};
const reordered = api.recommendFlexibleVisit([maria, ana], [busyUntil250], pediFirstReq);
check("reordering can put Mani first when Pedi chair is initially busy", !!(reordered && reordered.valid && reordered.orderChanged && lineOf(reordered, "gel") && lineOf(reordered, "gel").startMin === TWO && lineOf(reordered, "pedi") && lineOf(reordered, "pedi").startMin === TWO + 50), reordered);
check("original order remains hard when reordering is disabled", api.recommendFlexibleVisit([maria, ana], [busyUntil250], Object.assign({}, pediFirstReq, {
  allowServiceReordering: false
})) === null);

// ---------------------------------------------------------------------------
// WAIT LIMITS
// ---------------------------------------------------------------------------

const busyUntil255 = makeResource({
  resourceId: "chair-1",
  occupied: [{ occupancyId: "late", startMin: 9 * 60, endMin: TWO + 55 }]
});
const waitLimitReq = {
  serviceLines: [
    svc("gel", 45, ["maria"]),
    svc("pedi", 45, ["ana"], { resourceRequirements: [req("chair", ["chair-1"])] })
  ],
  preferredStartMin: TWO,
  allowServiceReordering: true,
  allowClientWait: true,
  maxWaitBetweenBlocksMinutes: 5,
  maxTotalClientWaitMinutes: 15
};
check("a 10-minute resource wait is rejected when the between-block cap is 5", api.recommendFlexibleVisit([maria, ana], [busyUntil255], waitLimitReq) === null);
const wait10 = api.recommendFlexibleVisit([maria, ana], [busyUntil255], Object.assign({}, waitLimitReq, {
  maxWaitBetweenBlocksMinutes: 10
}));
check("the same 10-minute wait is allowed when the cap is 10", !!(wait10 && wait10.valid && wait10.totalClientWaitMinutes === 10 && lineOf(wait10, "pedi") && lineOf(wait10, "pedi").startMin === TWO + 55), wait10);

const totalWaitReq = {
  serviceLines: [
    svc("one", 30, ["provA"]),
    svc("two", 30, ["provB"]),
    svc("three", 30, ["provC"])
  ],
  preferredStartMin: TWO,
  allowServiceReordering: false,
  allowClientWait: true,
  maxWaitBetweenBlocksMinutes: 15,
  maxTotalClientWaitMinutes: 10
};
const lateB = makeDay({
  providerId: "provB",
  workingIntervals: [{ startMin: TWO + 35, endMin: 18 * 60 }]
});
const lateC = makeDay({
  providerId: "provC",
  workingIntervals: [{ startMin: TWO + 75, endMin: 18 * 60 }]
});
check("5 + 10 wait exceeds maxTotalClientWaitMinutes 10", api.recommendFlexibleVisit([emptyA, lateB, lateC], [], totalWaitReq) === null);
const totalOk = api.recommendFlexibleVisit([emptyA, lateB, lateC], [], Object.assign({}, totalWaitReq, {
  maxTotalClientWaitMinutes: 15
}));
check("the 15-minute total-wait plan is valid when the total cap is 15", !!(totalOk && totalOk.valid && totalOk.totalClientWaitMinutes === 15), totalOk);

// ---------------------------------------------------------------------------
// NO-WAIT / NO-FLEX / PHASE 13 REGRESSION
// ---------------------------------------------------------------------------

const phase13Req = {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 60, ["provB"], { parallelGroup: "g", resourceRequirements: [req("chair", ["chair-1"])] })
  ],
  preferredStartMin: 10 * 60
};
const phase13 = api.recommendResourceAwareVisit([emptyA, emptyB], [chair1], phase13Req);
const noWait = api.recommendFlexibleVisit([emptyA, emptyB], [chair1], Object.assign({}, phase13Req, {
  allowServiceReordering: false,
  allowClientWait: false
}));
check("no-wait request stays contiguous like Phase 13", !!(noWait && phase13 && noWait.valid && noWait.visitStartMin === phase13.visitStartMin && noWait.visitEndMin === phase13.visitEndMin && noWait.totalClientWaitMinutes === 0 && (noWait.blocks || []).every(function (block) {
  return block.waitBeforeMinutes === 0;
})));
check("no-flex plan matches Phase 13 providers, times, resources, and operational score", !!(noWait && phase13 && lineOf(noWait, "mani").providerId === lineOf(phase13, "mani").providerId && lineOf(noWait, "pedi").providerId === lineOf(phase13, "pedi").providerId && lineOf(noWait, "mani").startMin === lineOf(phase13, "mani").startMin && assignmentOf(noWait, "pedi", "chair").resourceId === assignmentOf(phase13, "pedi", "chair").resourceId && noWait.flexibleVisitPlanScore === phase13.resourceAwareVisitPlanScore && noWait.parallelVisitPlanScore === phase13.parallelVisitPlanScore));

check("hidden waiting is not introduced when allowClientWait is false", noWait && noWait.clientWaitPenalty === 0 && noWait.visitElapsedMinutes === noWait.serviceExecutionElapsedMinutes);

// ---------------------------------------------------------------------------
// PARALLEL BLOCK REORDER — do not split the block
// ---------------------------------------------------------------------------

const browsEarly = makeDay({
  providerId: "provC",
  workingIntervals: [{ startMin: 10 * 60, endMin: 10 * 60 + 15 }]
});
const parallelReorder = api.recommendFlexibleVisit([emptyA, emptyB, browsEarly], [chair1], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "nails" }),
    svc("pedi", 60, ["provB"], { parallelGroup: "nails", resourceRequirements: [req("chair", ["chair-1"])] }),
    svc("brows", 15, ["provC"])
  ],
  preferredStartMin: 10 * 60,
  allowServiceReordering: true,
  allowClientWait: false
});
check("parallel Mani/Pedi stay one atomic block when reordering", !!(parallelReorder && parallelReorder.valid && (parallelReorder.blocks || []).some(function (block) {
  return block.parallel && block.lineKeys.slice().sort().join("|") === "mani|pedi";
})), parallelReorder && parallelReorder.blocks);
check("reordering never pulls Mani out of its declared parallel group", !!(parallelReorder && (parallelReorder.blocks || []).every(function (block) {
  var keys = block.lineKeys || [];
  if (keys.indexOf("mani") !== -1) return keys.indexOf("pedi") !== -1 && keys.length === 2;
  if (keys.indexOf("pedi") !== -1) return keys.indexOf("mani") !== -1;
  return true;
})));

// ---------------------------------------------------------------------------
// RESOURCE BUFFER + WAIT
// ---------------------------------------------------------------------------

const roomA = makeResource({ resourceId: "room-a", resourceType: "massage_room" });
const bufferWaitReq = {
  serviceLines: [
    svc("massage", 60, ["provA"], { resourceRequirements: [req("room", ["room-a"], { bufferAfterMinutes: 15 })] }),
    svc("next", 30, ["provB"], { resourceRequirements: [req("room", ["room-a"])] })
  ],
  preferredStartMin: 10 * 60,
  allowServiceReordering: false,
  allowClientWait: true,
  maxWaitBetweenBlocksMinutes: 15,
  maxTotalClientWaitMinutes: 15
};
const bufferWait = api.recommendFlexibleVisit([emptyA, emptyB], [roomA], bufferWaitReq);
check("waiting 15 minutes can reuse Room A after its cleanup buffer", !!(bufferWait && bufferWait.valid && bufferWait.totalClientWaitMinutes === 15 && lineOf(bufferWait, "next") && lineOf(bufferWait, "next").startMin === 11 * 60 + 15), bufferWait);
check("a 10-minute wait cannot cover a 15-minute room buffer", api.recommendFlexibleVisit([emptyA, emptyB], [roomA], Object.assign({}, bufferWaitReq, {
  maxWaitBetweenBlocksMinutes: 10,
  maxTotalClientWaitMinutes: 10
})) === null);

// ---------------------------------------------------------------------------
// PREFERRED START vs INTRA-VISIT WAIT
// ---------------------------------------------------------------------------

check("preferred start stays 2:00 even when a later block waits", !!(chairBusy && chairBusy.visitStartMin === TWO && chairBusy.timePreferenceBonus === 10 && reasonCodes(chairBusy).indexOf("exact_preferred_start") !== -1));

const flexStart = api.recommendFlexibleVisit([maria, ana], [busyUntil250], Object.assign({}, maniPediFlex, {
  preferredStartMin: TWO,
  flexibilityMinutes: 30
}));
check("intra-visit wait is not used to fake a different preferred start", !!(flexStart && flexStart.valid && flexStart.blocks && flexStart.blocks[0] && flexStart.blocks[0].startMin === flexStart.visitStartMin && flexStart.blocks[0].waitBeforeMinutes === 0), flexStart);

// ---------------------------------------------------------------------------
// TIMELINE FORMULAS + WAIT PENALTY + SCORE
// ---------------------------------------------------------------------------

const browsLate = makeDay({
  providerId: "provC",
  workingIntervals: [{ startMin: 11 * 60 + 10, endMin: 18 * 60 }]
});
const timeline = api.recommendFlexibleVisit([emptyA, emptyB, browsLate], [chair1], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 60, ["provB"], { parallelGroup: "g", resourceRequirements: [req("chair", ["chair-1"])] }),
    svc("brows", 15, ["provC"])
  ],
  preferredStartMin: 10 * 60,
  allowServiceReordering: false,
  allowClientWait: true,
  maxWaitBetweenBlocksMinutes: 15,
  maxTotalClientWaitMinutes: 15
});
check("timeline: sumServiceMinutes 135", timeline && timeline.sumServiceMinutes === 135, timeline);
check("timeline: serviceExecutionElapsedMinutes 75", timeline && timeline.serviceExecutionElapsedMinutes === 75, timeline);
check("timeline: parallelMinutesSaved 60 ignores client wait", timeline && timeline.parallelMinutesSaved === 60, timeline);
check("timeline: totalClientWaitMinutes 10", timeline && timeline.totalClientWaitMinutes === 10, timeline);
check("timeline: visitElapsedMinutes 85", timeline && timeline.visitElapsedMinutes === 85, timeline);
check("clientWaitPenalty is 4 for a 10-minute wait", timeline && timeline.clientWaitPenalty === 4);
check("flexibleVisitPlanScore matches the Phase 14 formula", timeline && timeline.flexibleVisitPlanScore === expectedFlexibleScore(timeline, 3, timeline.totalWorkingMinutes), timeline);
check("wait penalty is applied on top of unchanged Phase 12 operational structure", timeline && timeline.flexibleVisitPlanScore === clamp((timeline.parallelVisitPlanScore || 0) - 4, 0, 100));
check("no service-reordering score penalty field", timeline && !("orderPenalty" in timeline) && timeline.orderChanged === false);

check("clientWaitPenalty examples", (
  Math.min(20, Math.round(0 / 5) * 2) === 0
  && Math.min(20, Math.round(5 / 5) * 2) === 2
  && Math.min(20, Math.round(10 / 5) * 2) === 4
  && Math.min(20, Math.round(15 / 5) * 2) === 6
  && Math.min(20, Math.round(30 / 5) * 2) === 12
  && Math.min(20, Math.round(50 / 5) * 2) === 20
));

// ---------------------------------------------------------------------------
// EXISTING RESOURCE DOUBLE BOOK / BASELINE
// ---------------------------------------------------------------------------

const messy = makeResource({
  resourceId: "chair-messy",
  occupied: [
    { occupancyId: "x", startMin: TWO, endMin: TWO + 60 },
    { occupancyId: "y", startMin: TWO + 30, endMin: TWO + 90 }
  ]
});
check("historical overlapping resource occupancies stay a busy union", api.recommendFlexibleVisit([maria, ana], [messy], {
  serviceLines: [
    svc("gel", 45, ["maria"]),
    svc("pedi", 30, ["ana"], { resourceRequirements: [req("chair", ["chair-messy"])] })
  ],
  preferredStartMin: TWO,
  allowServiceReordering: true,
  allowClientWait: true,
  maxWaitBetweenBlocksMinutes: 5,
  maxTotalClientWaitMinutes: 5
}) === null);

// ---------------------------------------------------------------------------
// SEARCH BOUNDS / TRUNCATION
// ---------------------------------------------------------------------------

const bound = api.rankFlexibleVisitPlans([emptyA, emptyB, emptyC], [chair1], {
  serviceLines: [
    svc("one", 30, ["provA"]),
    svc("two", 30, ["provB"]),
    svc("three", 30, ["provC"])
  ],
  allowServiceReordering: true,
  allowClientWait: true,
  maxWaitBetweenBlocksMinutes: 30,
  maxTotalClientWaitMinutes: 30
}, {
  maxOrderPermutations: 2,
  maxVisitStartCandidates: 2,
  maxWaitCandidatesPerTransition: 2,
  maxProvidersPerLine: 1
});
check("bounded search reports Phase 14 limits", bound[0] && bound[0].searchMetadata.maxOrderPermutations === 2 && bound[0].searchMetadata.maxWaitCandidatesPerTransition === 2 && bound[0].searchMetadata.maxVisitStartCandidates === 2 && bound[0].searchMetadata.orderPermutationCount === 2 && bound[0].searchMetadata.visitStartCandidateCount === 2, bound[0] && bound[0].searchMetadata);
check("truncated search does not claim exhaustive optimality", bound[0] && bound[0].searchMetadata.truncated === true && bound[0].searchMetadata.exhaustive === false, bound[0] && bound[0].searchMetadata);

const tooManyReqs = api.recommendFlexibleVisit([emptyA, emptyB], [chair1, makeResource({ resourceId: "chair-2" }), makeResource({ resourceId: "chair-3" })], {
  serviceLines: [
    svc("mani", 30, ["provA"]),
    svc("pedi", 30, ["provB"], {
      resourceRequirements: [req("a", ["chair-1"]), req("b", ["chair-2"]), req("c", ["chair-3"])]
    })
  ],
  allowServiceReordering: true,
  allowClientWait: true,
  maxWaitBetweenBlocksMinutes: 5,
  maxTotalClientWaitMinutes: 5
});
check("too many resource requirements stay invalid and are not truncated", tooManyReqs && tooManyReqs.valid === false && tooManyReqs.reason === "too_many_resource_requirements_for_phase13");

// ---------------------------------------------------------------------------
// IMMUTABILITY / PURITY / DETERMINISM
// ---------------------------------------------------------------------------

const flexSnap = JSON.stringify(maniPediFlex);
check("providerDays are unchanged", JSON.stringify(maria) === snapMaria);
check("resourceDays are unchanged", JSON.stringify(chair1) === snapChair);
check("request is unchanged", JSON.stringify(maniPediFlex) === flexSnap);
check("same inputs yield the same logical result", JSON.stringify(chairBusy) === JSON.stringify(api.recommendFlexibleVisit([maria, ana], [busyUntil250], maniPediFlex)));

const src = fs.readFileSync(path.join(root, "public/booking/smart-scheduling/flexible-visit.js"), "utf8");
check("purity: no Firebase APIs", !/firebase-firestore|getDocs\s*\(|onSnapshot\s*\(|updateDoc\s*\(|addDoc\s*\(/.test(src));
check("purity: no network", !/\bfetch\s*\(|XMLHttpRequest/.test(src));
check("purity: no writes / timers / Date", !/\bsetTimeout\b|\bsetInterval\b|\bDate\s*\(|createAppointment|updateAppointment|cancelAppointment/.test(src));
check("purity: no DOM / Calendar / Reports", !/\bdocument\b|\blocalStorage\b|ffBookingCal|ffBookingReports/.test(src));
check("purity: no messaging / booking", !/sendSms|sendEmail|twilio|mailer|bookClient|autoBook|acceptLink/i.test(src));
check("does not rewrite Phase 11–13 planners", !/function rankResourceAwareVisitPlans/.test(src) && !/function rankParallelMultiServiceVisitPlans/.test(src) && !/function rankMultiServiceVisitPlans/.test(src));

if (failed) {
  console.log("\n" + failed + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll flexible visit checks passed.");
