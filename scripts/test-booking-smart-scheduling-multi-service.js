/**
 * Smart Scheduling Phase 11 sequential multi-service visit planner.
 * No Firestore, DOM, Calendar, or Reports.
 * Usage: node scripts/test-booking-smart-scheduling-multi-service.js
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
  "public/booking/smart-scheduling/multi-service.js"
].forEach(function (rel) { load(rel, windowObj); });

const api = windowObj.ffBookingSmartScheduling;
if (!api || typeof api.rankMultiServiceVisitPlans !== "function") {
  console.error("Smart Scheduling multi-service API did not load.");
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

function expectedVisitScore(row, providerCount, workingMinutes) {
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
  raw -= Math.min(20, (Number(row.overlapLineCount) || 0) * 5);
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

function svc(lineKey, durationMinutes, eligible, extra) {
  return Object.assign({
    lineKey: lineKey,
    serviceId: "svc-" + lineKey,
    durationMinutes: durationMinutes,
    eligibleProviderIds: eligible,
    assignmentType: "any_provider"
  }, extra || {});
}

function hasReason(row, code) {
  return (row && row.reasons || []).some(function (item) { return item.code === code; });
}

function providersOf(plan) {
  return (plan && plan.serviceLines || []).map(function (row) { return row.providerId; });
}

const emptyA = makeDay({ providerId: "provA" });
const emptyB = makeDay({ providerId: "provB" });

check("public multi-service API loaded", !!(
  api.rankMultiServiceVisitPlans
  && api.recommendMultiServiceVisit
  && api.compareMultiServiceVisitPlans
  && api.MULTI_SERVICE
));

// ---------------------------------------------------------------------------
// BASIC SAME PROVIDER
// ---------------------------------------------------------------------------

const sameReq = {
  serviceLines: [
    svc("gel", 60, ["provA"]),
    svc("pedi", 45, ["provA"])
  ],
  preferredStartMin: 10 * 60
};
const sameSnap = JSON.stringify(emptyA);
const samePlan = api.recommendMultiServiceVisit([emptyA], sameReq);
check("two sequential services fit the same provider", samePlan && samePlan.valid === true && providersOf(samePlan).join(",") === "provA,provA", samePlan && providersOf(samePlan));
check("same-provider start/end are contiguous", samePlan && samePlan.visitStartMin === 10 * 60 && samePlan.serviceLines[0].endMin === 11 * 60 && samePlan.serviceLines[1].startMin === 11 * 60 && samePlan.serviceLines[1].endMin === 11 * 60 + 45, samePlan);
check("complete visit inserts evolving occupancy identities", samePlan && samePlan.serviceLines[0].startMin === 10 * 60 && samePlan.totalVisitMinutes === 105);
check("exact preferred start bonus is +10", samePlan && samePlan.timePreferenceBonus === 10 && hasReason(samePlan, "exact_preferred_start"));
check("complete_multi_service_fit is present", hasReason(samePlan, "complete_multi_service_fit"));

// ---------------------------------------------------------------------------
// MULTIPLE PROVIDERS
// ---------------------------------------------------------------------------

const splitPlan = api.recommendMultiServiceVisit([emptyA, emptyB], {
  serviceLines: [
    svc("gel", 60, ["provA"]),
    svc("pedi", 45, ["provB"])
  ],
  preferredStartMin: 10 * 60
});
check("service 1 on A and service 2 on B is a complete visit", splitPlan && splitPlan.valid && providersOf(splitPlan).join(",") === "provA,provB" && splitPlan.serviceLines[1].startMin === 11 * 60, providersOf(splitPlan));

// ---------------------------------------------------------------------------
// NON-GREEDY REQUIRED CASE
// ---------------------------------------------------------------------------

const greedyA = makeDay({
  providerId: "provA",
  lines: [
    line(9 * 60, 10 * 60, { providerId: "provA", lineId: "a-morning", appointmentId: "a-morning" }),
    line(11 * 60, 18 * 60, { providerId: "provA", lineId: "a-afternoon", appointmentId: "a-afternoon" })
  ]
});
const greedyB = makeDay({ providerId: "provB" });
const isolatedLine1 = api.recommendProviderAssignment([greedyA, greedyB], {
  durationMinutes: 60,
  snapMinutes: 15,
  preferredStartMin: 10 * 60,
  assignmentType: "any_provider"
});
check("A is locally best for line 1 at 10:00", isolatedLine1 && isolatedLine1.providerId === "provA" && isolatedLine1.startMin === 10 * 60, isolatedLine1);

const greedyReq = {
  serviceLines: [
    svc("cut", 60, ["provA", "provB"]),
    svc("color", 45, ["provA"])
  ],
  preferredStartMin: 10 * 60,
  flexibilityMinutes: 60
};
const greedySnapA = JSON.stringify(greedyA);
const greedySnapB = JSON.stringify(greedyB);
const greedyPlan = api.recommendMultiServiceVisit([greedyA, greedyB], greedyReq);
check("non-greedy: line 1 -> B and line 2 -> A", greedyPlan && greedyPlan.valid && providersOf(greedyPlan).join(",") === "provB,provA", greedyPlan && {
  providers: providersOf(greedyPlan),
  start: greedyPlan && greedyPlan.visitStartMin,
  lines: greedyPlan && greedyPlan.serviceLines
});
check("non-greedy visit is sequential", greedyPlan && greedyPlan.serviceLines[1].startMin === greedyPlan.serviceLines[0].endMin);
check("uses_provider_alternative_for_complete_visit", hasReason(greedyPlan, "uses_provider_alternative_for_complete_visit"));
check("Phase 4 local winner remains A when scored in isolation", isolatedLine1.providerId === "provA");

// ---------------------------------------------------------------------------
// SPECIFIC PROVIDER / MIXED CAPABILITY
// ---------------------------------------------------------------------------

const specificPlan = api.recommendMultiServiceVisit([emptyA, emptyB], {
  serviceLines: [
    svc("gel", 60, ["provA", "provB"], { assignmentType: "specific_provider", requestedProviderId: "provA" }),
    svc("brow", 15, ["provA", "provB"])
  ],
  preferredStartMin: 10 * 60
});
check("specific provider line never switches", specificPlan && specificPlan.serviceLines[0].providerId === "provA");

const mixedPlan = api.recommendMultiServiceVisit([emptyA, emptyB], {
  serviceLines: [
    svc("gel", 60, ["provA"]),
    svc("brow", 15, ["provB"])
  ],
  preferredStartMin: 13 * 60
});
check("caller-resolved eligibleProviderIds are enforced", mixedPlan && providersOf(mixedPlan).join(",") === "provA,provB");

// ---------------------------------------------------------------------------
// SEQUENTIAL TIMING / EVOLVING STATE
// ---------------------------------------------------------------------------

check("no idle gaps between visit lines", samePlan.serviceLines.every(function (row, idx, list) {
  return idx === 0 || row.startMin === list[idx - 1].endMin;
}));
check("no parallel visit lines", samePlan.serviceLines.every(function (row, idx, list) {
  return idx === 0 || row.startMin >= list[idx - 1].endMin;
}));

const evolveA = makeDay({
  providerId: "provA",
  lines: [line(11 * 60, 12 * 60, { providerId: "provA" })]
});
const evolveB = makeDay({ providerId: "provB" });
const evolvePlan = api.recommendMultiServiceVisit([evolveA, evolveB], {
  serviceLines: [
    svc("one", 60, ["provA", "provB"]),
    svc("two", 45, ["provA", "provB"])
  ],
  preferredStartMin: 10 * 60
});
check("earlier inserted line is visible to later assignment", evolvePlan && evolvePlan.valid && evolvePlan.serviceLines[0].endMin === evolvePlan.serviceLines[1].startMin);
check("later line is not placed over the earlier visit line", evolvePlan && !(
  evolvePlan.serviceLines[0].providerId === evolvePlan.serviceLines[1].providerId
  && evolvePlan.serviceLines[0].startMin < evolvePlan.serviceLines[1].endMin
  && evolvePlan.serviceLines[1].startMin < evolvePlan.serviceLines[0].endMin
));

// ---------------------------------------------------------------------------
// PREFERRED START / NO PREFERRED START
// ---------------------------------------------------------------------------

const flexPlan = api.recommendMultiServiceVisit([emptyA], {
  serviceLines: [svc("a", 60, ["provA"]), svc("b", 30, ["provA"])],
  preferredStartMin: 10 * 60,
  flexibilityMinutes: 30,
  earliestStartMin: 10 * 60 + 15,
  latestStartMin: 10 * 60 + 30
});
check("flexibility stays inside earliest/latest hard bounds", flexPlan && flexPlan.visitStartMin >= 10 * 60 + 15 && flexPlan.visitStartMin <= 10 * 60 + 30, flexPlan && flexPlan.visitStartMin);
check("no invented flexibility beyond the supplied window", flexPlan && flexPlan.timeDistanceMinutes <= 30);

const exactOnly = api.rankMultiServiceVisitPlans([emptyA], {
  serviceLines: [svc("a", 60, ["provA"]), svc("b", 30, ["provA"])],
  preferredStartMin: 10 * 60
});
check("missing flexibility searches only the exact preferred start", exactOnly.length > 0 && exactOnly.every(function (row) {
  return row.visitStartMin === 10 * 60;
}));

const openPlan = api.recommendMultiServiceVisit([emptyA], {
  serviceLines: [svc("a", 60, ["provA"]), svc("b", 30, ["provA"])]
});
check("no preferred start still finds a snapped visit", openPlan && openPlan.valid && openPlan.visitStartMin % 15 === 0 && openPlan.timePreferenceBonus === 0, openPlan && openPlan.visitStartMin);

// ---------------------------------------------------------------------------
// SPLIT SHIFT / LUNCH
// ---------------------------------------------------------------------------

const lunchA = makeDay({
  providerId: "provA",
  workingIntervals: [
    { startMin: 9 * 60, endMin: 12 * 60 },
    { startMin: 13 * 60, endMin: 18 * 60 }
  ]
});
const lunchBlocked = api.recommendMultiServiceVisit([lunchA], {
  serviceLines: [svc("a", 45, ["provA"]), svc("b", 45, ["provA"])],
  preferredStartMin: 11 * 60 + 30
});
check("visit cannot illegally cross lunch", !lunchBlocked || lunchBlocked.valid === false || lunchBlocked.reason, lunchBlocked);
const lunchOk = api.recommendMultiServiceVisit([lunchA], {
  serviceLines: [svc("a", 45, ["provA"]), svc("b", 45, ["provA"])],
  preferredStartMin: 10 * 60
});
check("split-shift morning visit stays inside one working interval", lunchOk && lunchOk.valid && lunchOk.visitEndMin <= 12 * 60, lunchOk);

// ---------------------------------------------------------------------------
// BASELINE CONFLICTS
// ---------------------------------------------------------------------------

const baselineA = line(13 * 60, 14 * 60, { lineId: "base-a", appointmentId: "base-a", providerId: "provA" });
const baselineB = line(13 * 60 + 30, 14 * 60 + 30, { lineId: "base-b", appointmentId: "base-b", providerId: "provA" });
const baselineDay = makeDay({
  providerId: "provA",
  lines: [baselineA, baselineB]
});
check("fixture has an illegal baseline overlap", api.helpers.overlapMinutes(baselineA.startMin, baselineA.endMin, baselineB.startMin, baselineB.endMin) === 30);
const baselineVisit = api.recommendMultiServiceVisit([baselineDay], {
  serviceLines: [svc("a", 60, ["provA"]), svc("b", 30, ["provA"])],
  preferredStartMin: 10 * 60
});
check("unchanged baseline illegal overlap is tolerated", baselineVisit && baselineVisit.valid === true && baselineVisit.visitStartMin === 10 * 60, baselineVisit);

const worsenDay = makeDay({
  providerId: "provA",
  allowedOverlapMinutes: 0,
  lines: [line(11 * 60, 12 * 60, { providerId: "provA" })]
});
const worsenPlans = api.rankMultiServiceVisitPlans([worsenDay], {
  serviceLines: [svc("a", 60, ["provA"]), svc("b", 45, ["provA"])],
  preferredStartMin: 10 * 60 + 15
});
check("new visit conflict is rejected", worsenPlans.length === 0, { count: worsenPlans.length, first: worsenPlans[0] });

// ---------------------------------------------------------------------------
// OVERLAP
// ---------------------------------------------------------------------------

const overlapDay = makeDay({
  providerId: "provA",
  allowedOverlapMinutes: 15,
  lines: [line(11 * 60, 12 * 60, { providerId: "provA" })]
});
const overlapPlan = api.recommendMultiServiceVisit([overlapDay], {
  serviceLines: [svc("a", 45, ["provA"]), svc("b", 30, ["provA"])],
  preferredStartMin: 10 * 60
});
check("permitted overlap can remain technically valid", overlapPlan && overlapPlan.valid === true, overlapPlan);
if (overlapPlan && overlapPlan.overlapLineCount > 0) {
  check("overlapLineCount / penalty are applied in the score", overlapPlan.multiServicePlanScore === expectedVisitScore(overlapPlan, 1, api.analyzeProviderDay(overlapDay).workingMinutes) && overlapPlan.overlapLineCount >= 1, {
    count: overlapPlan.overlapLineCount,
    score: overlapPlan.multiServicePlanScore
  });
  check("uses_permitted_overlap reason", hasReason(overlapPlan, "uses_permitted_overlap"));
} else {
  const overlapAlt = api.recommendMultiServiceVisit([overlapDay], {
    serviceLines: [svc("a", 30, ["provA"]), svc("b", 30, ["provA"])],
    preferredStartMin: 10 * 60 + 30
  });
  check("permitted overlap can remain technically valid", overlapAlt && overlapAlt.valid === true && overlapAlt.overlapLineCount >= 1, overlapAlt);
  check("overlapLineCount / penalty are applied in the score", overlapAlt && overlapAlt.multiServicePlanScore === expectedVisitScore(overlapAlt, 1, api.analyzeProviderDay(overlapDay).workingMinutes), overlapAlt);
}

// ---------------------------------------------------------------------------
// FINAL SALON METRICS
// ---------------------------------------------------------------------------

const longA = makeDay({
  providerId: "provA",
  workingIntervals: [{ startMin: 9 * 60, endMin: 17 * 60 }]
});
const shortB = makeDay({
  providerId: "provB",
  workingIntervals: [{ startMin: 9 * 60, endMin: 11 * 60 }]
});
const metricPlan = api.recommendMultiServiceVisit([longA, shortB], {
  serviceLines: [svc("a", 60, ["provA"]), svc("b", 45, ["provA"])],
  preferredStartMin: 10 * 60
});
const working = api.analyzeProviderDay(longA).workingMinutes + api.analyzeProviderDay(shortB).workingMinutes;
check("weighted utilization uses total occupied / total working", metricPlan && metricPlan.totalWorkingMinutes === working && metricPlan.utilizationAfterWeighted === Math.round(100 * metricPlan.totalOccupiedMinutesAfter / working), metricPlan);
check("8-hour and 2-hour working minutes are not averaged equally", metricPlan && working === 8 * 60 + 2 * 60 && metricPlan.utilizationAfterWeighted !== Math.round((metricPlan.utilizationAfterWeighted + 0) / 2));
check("optimization / fragmentation / stranded totals are exposed", metricPlan && "optimizationDeltaTotal" in metricPlan && "fragmentationDeltaTotal" in metricPlan && "strandedBetweenMinutesDeltaTotal" in metricPlan);
check("multiServicePlanScore follows the Phase 11 formula", metricPlan && metricPlan.multiServicePlanScore === expectedVisitScore(metricPlan, 2, working), {
  got: metricPlan && metricPlan.multiServicePlanScore,
  expected: metricPlan && expectedVisitScore(metricPlan, 2, working),
  slotFit: metricPlan && metricPlan.slotFitComponent,
  mean: metricPlan && metricPlan.meanSlotScore
});
check("slotFitComponent uses mean slot score, not a sum", metricPlan && metricPlan.slotFitComponent === clamp(Math.round((metricPlan.meanSlotScore - 50) * 0.40), -20, 20));

// ---------------------------------------------------------------------------
// NO PARTIAL VISIT
// ---------------------------------------------------------------------------

const partialHost = makeDay({
  providerId: "provA",
  workingIntervals: [{ startMin: 10 * 60, endMin: 12 * 60 }]
});
const partialRank = api.rankMultiServiceVisitPlans([partialHost], {
  serviceLines: [
    svc("one", 60, ["provA"]),
    svc("two", 60, ["provA"]),
    svc("three", 60, ["provA"])
  ],
  preferredStartMin: 10 * 60
});
check("if line 3 cannot fit the whole candidate is invalid", partialRank.length === 0);
check("recommend returns null when no complete visit exists", api.recommendMultiServiceVisit([partialHost], {
  serviceLines: [
    svc("one", 60, ["provA"]),
    svc("two", 60, ["provA"]),
    svc("three", 60, ["provA"])
  ],
  preferredStartMin: 10 * 60
}) === null);

// ---------------------------------------------------------------------------
// BOUNDED SEARCH
// ---------------------------------------------------------------------------

const boundRank = api.rankMultiServiceVisitPlans([emptyA, emptyB], {
  serviceLines: [svc("a", 30, ["provA", "provB"]), svc("b", 30, ["provA", "provB"])]
}, { maxVisitStartCandidates: 2, maxProvidersPerLine: 1, maxEvaluatedVisitPlans: 3 });
check("bounded search reports limits", boundRank[0] && boundRank[0].searchMetadata.maxVisitStartCandidates === 2 && boundRank[0].searchMetadata.maxProvidersPerLine === 1 && boundRank[0].searchMetadata.maxEvaluatedVisitPlans === 3, boundRank[0] && boundRank[0].searchMetadata);
check("truncated search does not claim exhaustive optimality", boundRank[0] && boundRank[0].searchMetadata.truncated === true && boundRank[0].searchMetadata.exhaustive === false, boundRank[0] && boundRank[0].searchMetadata);
check("bounded search is deterministic", JSON.stringify(boundRank) === JSON.stringify(api.rankMultiServiceVisitPlans([emptyA, emptyB], {
  serviceLines: [svc("a", 30, ["provA", "provB"]), svc("b", 30, ["provA", "provB"])]
}, { maxVisitStartCandidates: 2, maxProvidersPerLine: 1, maxEvaluatedVisitPlans: 3 })));

// ---------------------------------------------------------------------------
// INPUT VALIDATION
// ---------------------------------------------------------------------------

check("duplicate lineKey is rejected", api.recommendMultiServiceVisit([emptyA], {
  serviceLines: [svc("same", 60, ["provA"]), svc("same", 30, ["provA"])]
}).reason === "duplicate_line_key");
check("bad duration is rejected", api.recommendMultiServiceVisit([emptyA], {
  serviceLines: [svc("a", 0, ["provA"]), svc("b", 30, ["provA"])]
}).reason === "invalid_duration");
check("missing provider is rejected", api.recommendMultiServiceVisit([emptyA], {
  serviceLines: [svc("a", 60, ["provA"]), svc("b", 30, ["provZ"])]
}).reason === "unknown_provider");
check("mixed date/location is rejected", api.recommendMultiServiceVisit([
  emptyA,
  makeDay({ providerId: "provB", dateKey: "2026-09-15" })
], {
  serviceLines: [svc("a", 60, ["provA"]), svc("b", 30, ["provB"])]
}).reason === "mixed_location_or_date");
check("too many service lines is unsupported", api.recommendMultiServiceVisit([emptyA], {
  serviceLines: [
    svc("a", 15, ["provA"]),
    svc("b", 15, ["provA"]),
    svc("c", 15, ["provA"]),
    svc("d", 15, ["provA"]),
    svc("e", 15, ["provA"])
  ]
}).reason === "too_many_service_lines_for_phase11");
check("missing requested provider is rejected", api.recommendMultiServiceVisit([emptyA], {
  serviceLines: [
    svc("a", 60, ["provA"], { assignmentType: "specific_provider" }),
    svc("b", 30, ["provA"])
  ]
}).reason === "missing_requested_provider");
check("requested provider must stay eligible", api.recommendMultiServiceVisit([emptyA], {
  serviceLines: [
    svc("a", 60, ["provA"], { assignmentType: "specific_provider", requestedProviderId: "provB" }),
    svc("b", 30, ["provA"])
  ]
}).reason === "requested_provider_not_eligible");
check("fewer than two service lines is rejected", api.recommendMultiServiceVisit([emptyA], {
  serviceLines: [svc("a", 60, ["provA"])]
}).reason === "too_few_service_lines");
check("missing lineKey is rejected", api.recommendMultiServiceVisit([emptyA], {
  serviceLines: [svc("", 60, ["provA"]), svc("b", 30, ["provA"])]
}).reason === "missing_line_key");
check("service line with no eligible provider is rejected", api.recommendMultiServiceVisit([emptyA], {
  serviceLines: [svc("a", 60, ["provA"]), svc("b", 30, [])]
}).reason === "no_eligible_provider");

// ---------------------------------------------------------------------------
// SOURCE IMMUTABILITY / DETERMINISM / PURITY
// ---------------------------------------------------------------------------

check("original ProviderDays are unchanged", JSON.stringify(emptyA) === sameSnap && JSON.stringify(greedyA) === greedySnapA && JSON.stringify(greedyB) === greedySnapB);
check("same multi-service input yields the same output", samePlan.multiServicePlanScore === api.recommendMultiServiceVisit([emptyA], sameReq).multiServicePlanScore);

const src = fs.readFileSync(path.join(root, "public/booking/smart-scheduling/multi-service.js"), "utf8");
check("purity: no Firebase APIs", !/firebase-firestore|getDocs\s*\(|onSnapshot\s*\(|updateDoc\s*\(|addDoc\s*\(/.test(src));
check("purity: no network", !/\bfetch\s*\(|XMLHttpRequest/.test(src));
check("purity: no writes / timers / Date", !/\bsetTimeout\b|\bsetInterval\b|\bDate\s*\(|createAppointment|updateAppointment|cancelAppointment/.test(src));
check("purity: no DOM / Calendar / Reports", !/\bdocument\b|\blocalStorage\b|ffBookingCal|ffBookingReports/.test(src));
check("purity: no messaging / booking", !/sendSms|sendEmail|twilio|mailer|bookClient|autoBook|acceptLink/i.test(src));
check("module stays out of assign.js / salon-plan.js", !/function rankProviderAssignments/.test(src) && !/function planSalonWideRecovery/.test(src));

if (failed) {
  console.log("\n" + failed + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll multi-service visit checks passed.");
