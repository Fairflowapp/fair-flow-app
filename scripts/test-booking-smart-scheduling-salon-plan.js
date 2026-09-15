/**
 * Smart Scheduling Phase 10 salon-wide recovery plan.
 * No Firestore, DOM, Calendar, or Reports.
 * Usage: node scripts/test-booking-smart-scheduling-salon-plan.js
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
  "public/booking/smart-scheduling/salon-plan.js"
].forEach(function (rel) { load(rel, windowObj); });

const api = windowObj.ffBookingSmartScheduling;
if (!api || typeof api.planSalonWideRecovery !== "function") {
  console.error("Smart Scheduling salon plan API did not load.");
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

function expectedSalonScore(row, providerCount, workingMinutes) {
  var optAvg = providerCount === 0 ? 0 : Math.round((Number(row.optimizationDeltaTotal) || 0) / providerCount);
  var fragAvg = providerCount === 0 ? 0 : Math.round((Number(row.fragmentationDeltaTotal) || 0) / providerCount);
  var strandedPct = workingMinutes === 0 ? 0 : Math.round(100 * (Number(row.strandedBetweenMinutesDeltaTotal) || 0) / workingMinutes);
  var raw = 40;
  raw += Math.round((Number(row.salonGapRecoveryPercent) || 0) * 0.30);
  raw += clamp(optAvg, -20, 20);
  raw -= clamp(Math.max(0, fragAvg), 0, 20);
  raw += clamp(Math.max(0, -fragAvg), 0, 15);
  raw -= clamp(Math.max(0, strandedPct), 0, 15);
  raw -= Math.min(30, Math.round((Number(row.totalClientDisruptionMinutes) || 0) / 15) * 2);
  raw -= Math.min(20, (Number(row.totalOverlapActionCount) || 0) * 5);
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

function waitReq(partial) {
  return Object.assign({
    waitlistId: "wl-default",
    clientId: "client-1",
    durationMinutes: 30,
    assignmentType: "any_provider",
    createdAtOrder: 1
  }, partial || {});
}

function hasReason(row, code) {
  return (row && row.reasons || []).some(function (item) { return item.code === code; });
}

function waitlistUses(plan, waitlistId) {
  return (plan.selectedProviderPlans || []).reduce(function (sum, row) {
    return sum + (row.selectedActions || []).filter(function (action) {
      return action.waitlistId === waitlistId;
    }).length;
  }, 0);
}

function packedPair(providerId, morning) {
  var a = morning ? 10 * 60 : 15 * 60;
  return [
    line(a, a + 60, { lineId: providerId + "-a", appointmentId: providerId + "-a", providerId: providerId }),
    line(a + 90, a + 150, { lineId: providerId + "-b", appointmentId: providerId + "-b", providerId: providerId })
  ];
}

function pairDay(providerId, extras) {
  return makeDay(Object.assign({
    providerId: providerId,
    workingIntervals: [
      { startMin: 9 * 60, endMin: 12 * 60 + 30 },
      { startMin: 15 * 60, endMin: 18 * 60 }
    ],
    lines: packedPair(providerId, true).concat(packedPair(providerId, false))
  }, extras || {}));
}

function oneGapDay(providerId) {
  return makeDay({
    providerId: providerId,
    lines: [
      line(10 * 60, 11 * 60, { lineId: providerId + "-a", appointmentId: providerId + "-a", providerId: providerId }),
      line(11 * 60 + 30, 12 * 60 + 30, { lineId: providerId + "-b", appointmentId: providerId + "-b", providerId: providerId })
    ]
  });
}

check("public salon plan API loaded", !!(
  api.planSalonWideRecovery && api.rankGlobalProviderDayRecoveryCandidates && api.compareSalonPlans && api.SALON_PLAN
));

const dayA = pairDay("provA");
const dayB = pairDay("provB");
const snapshotA = JSON.stringify(dayA);
const snapshotB = JSON.stringify(dayB);

// ---------------------------------------------------------------------------
// PHASE 9 CANDIDATE EXPOSURE
// ---------------------------------------------------------------------------

const phase9Winner = api.planGlobalProviderDayRecovery(dayA, []);
const phase9Ranked = api.rankGlobalProviderDayRecoveryCandidates(dayA, []);
const phase9Snap = JSON.stringify(phase9Ranked);
check("Phase 9 winner remains the first ranked candidate", phase9Ranked[0]
  && JSON.stringify(phase9Ranked[0].selectedActions.map(function (row) { return row.actionId; }))
    === JSON.stringify(phase9Winner.selectedActions.map(function (row) { return row.actionId; }))
  && phase9Ranked[0].globalPlanScore === phase9Winner.globalPlanScore,
  { winner: phase9Winner.selectedActions.map(function (row) { return row.actionId; }) }
);
check("ranked candidates include the zero-action plan", phase9Ranked.some(function (row) {
  return row.isZeroAction || !(row.selectedActions || []).length;
}));
check("existing Phase 9 winner API did not regress", phase9Winner.globalPlanScore === api.planGlobalProviderDayRecovery(dayA, []).globalPlanScore);

// ---------------------------------------------------------------------------
// TWO PROVIDERS INDEPENDENT
// ---------------------------------------------------------------------------

const independent = api.planSalonWideRecovery([dayA, dayB], []);
check("two independent providers can both receive actions", independent.valid === true && independent.activeProviderPlanCount === 2, {
  active: independent.activeProviderPlanCount,
  selected: (independent.selectedProviderPlans || []).map(function (row) {
    return row.providerId + ":" + (row.selectedActions || []).length;
  })
});
check("recovers_gaps_across_providers", hasReason(independent, "recovers_gaps_across_providers"));
check("salonPlanScore follows the Phase 10 formula", independent.salonPlanScore === expectedSalonScore(
  independent,
  independent.providerCount,
  api.analyzeProviderDay(dayA).workingMinutes + api.analyzeProviderDay(dayB).workingMinutes
), { got: independent.salonPlanScore, expected: expectedSalonScore(independent, 2, api.analyzeProviderDay(dayA).workingMinutes + api.analyzeProviderDay(dayB).workingMinutes) });

// ---------------------------------------------------------------------------
// SAME WAITLIST TWO PROVIDERS
// ---------------------------------------------------------------------------

const waitW = [waitReq({ waitlistId: "wl-shared", durationMinutes: 30, createdAtOrder: 1 })];
const shareA = oneGapDay("provA");
const shareB = oneGapDay("provB");
const shared = api.planSalonWideRecovery([shareA, shareB], waitW);
check("same waitlist is used at most once across two providers", waitlistUses(shared, "wl-shared") <= 1, {
  uses: waitlistUses(shared, "wl-shared"),
  selected: (shared.selectedProviderPlans || []).map(function (row) {
    return row.providerId + ":" + (row.selectedActions || []).map(function (action) { return action.waitlistId || action.actionId; }).join(",");
  })
});
check("avoids_duplicate_waitlist_use", hasReason(shared, "avoids_duplicate_waitlist_use") || waitlistUses(shared, "wl-shared") <= 1);

// ---------------------------------------------------------------------------
// LOCAL ALTERNATIVE WINS GLOBALLY
// ---------------------------------------------------------------------------

const altA = oneGapDay("provA");
const altB = makeDay({
  providerId: "provB",
  lines: [
    line(15 * 60, 16 * 60, { lineId: "provB-a", appointmentId: "provB-a", providerId: "provB" }),
    line(16 * 60 + 30, 17 * 60 + 30, { lineId: "provB-b", appointmentId: "provB-b", providerId: "provB" })
  ]
});
const altWait = [
  waitReq({ waitlistId: "wl-w", durationMinutes: 30, createdAtOrder: 1 }),
  waitReq({
    waitlistId: "wl-x",
    durationMinutes: 30,
    createdAtOrder: 2,
    preferredStartMin: 11 * 60,
    flexibilityMinutes: 0
  })
];
const altRankA = api.rankGlobalProviderDayRecoveryCandidates(altA, altWait);
const altRankB = api.rankGlobalProviderDayRecoveryCandidates(altB, altWait);
const altSalon = api.planSalonWideRecovery([altA, altB], altWait);
const aWinnerUsesW = altRankA[0] && (altRankA[0].selectedActions || []).some(function (row) { return row.waitlistId === "wl-w"; });
const aHasX = altRankA.some(function (plan) {
  return (plan.selectedActions || []).some(function (row) { return row.waitlistId === "wl-x"; });
});
const bWinnerUsesW = altRankB[0] && (altRankB[0].selectedActions || []).some(function (row) { return row.waitlistId === "wl-w"; });
const salonA = (altSalon.selectedProviderPlans || []).find(function (row) { return row.providerId === "provA"; });
const salonB = (altSalon.selectedProviderPlans || []).find(function (row) { return row.providerId === "provB"; });
check("Provider A local winner can use W while an alternative uses X", aWinnerUsesW && aHasX, altRankA.map(function (plan) {
  return (plan.selectedActions || []).map(function (row) { return row.waitlistId || row.type; }).join(",");
}));
check("Provider B local winner uses W", bWinnerUsesW, altRankB[0] && (altRankB[0].selectedActions || []).map(function (row) { return row.waitlistId || row.type; }));
check("salon can keep A's alternative so B can use W", !!(
  salonA && salonB
  && (salonA.selectedActions || []).some(function (row) { return row.waitlistId === "wl-x"; })
  && (salonB.selectedActions || []).some(function (row) { return row.waitlistId === "wl-w"; })
), {
  a: salonA && (salonA.selectedActions || []).map(function (row) { return row.waitlistId || row.actionId; }),
  b: salonB && (salonB.selectedActions || []).map(function (row) { return row.waitlistId || row.actionId; })
});
check("uses_provider_alternative_for_global_fit", hasReason(altSalon, "uses_provider_alternative_for_global_fit"));

// ---------------------------------------------------------------------------
// THREE PROVIDERS SAME WAITLIST
// ---------------------------------------------------------------------------

const three = api.planSalonWideRecovery([
  oneGapDay("provA"),
  oneGapDay("provB"),
  oneGapDay("provC")
], waitW);
check("waitlist W is used once across three providers", waitlistUses(three, "wl-shared") === 1, waitlistUses(three, "wl-shared"));

// ---------------------------------------------------------------------------
// ZERO-ACTION SALON PLAN
// ---------------------------------------------------------------------------

const weakWait = [waitReq({
  waitlistId: "wl-middle",
  durationMinutes: 15,
  preferredStartMin: 11 * 60 + 30,
  flexibilityMinutes: 0
})];
function weakDay(providerId) {
  return makeDay({
    providerId: providerId,
    lines: [
      line(10 * 60, 11 * 60, { lineId: providerId + "-na-a", appointmentId: providerId + "-na-a", providerId: providerId }),
      line(12 * 60 + 30, 13 * 60 + 30, { lineId: providerId + "-na-b", appointmentId: providerId + "-na-b", providerId: providerId })
    ]
  });
}
const zeroSalon = api.planSalonWideRecovery([weakDay("provA"), weakDay("provB")], weakWait, {
  maxMoveMinutes: 0,
  minimumWaitlistMatchScore: 0
});
check("all-provider baseline may win", zeroSalon.activeProviderPlanCount === 0 && zeroSalon.searchMetadata.zeroActionSalonPlanEvaluated === true, {
  active: zeroSalon.activeProviderPlanCount,
  score: zeroSalon.salonPlanScore
});
check("no_action_is_best", hasReason(zeroSalon, "no_action_is_best"));

// ---------------------------------------------------------------------------
// PROVIDER WITH NO GAPS + WEIGHTED UTILIZATION
// ---------------------------------------------------------------------------

const longDay = makeDay({
  providerId: "provLong",
  workingIntervals: [{ startMin: 9 * 60, endMin: 17 * 60 }],
  lines: [line(10 * 60, 11 * 60, { lineId: "long-a", appointmentId: "long-a", providerId: "provLong" })]
});
const shortDay = makeDay({
  providerId: "provShort",
  workingIntervals: [{ startMin: 9 * 60, endMin: 11 * 60 }],
  lines: [line(9 * 60, 10 * 60, { lineId: "short-a", appointmentId: "short-a", providerId: "provShort" })]
});
const weighted = api.planSalonWideRecovery([longDay, shortDay], []);
const longA = api.analyzeProviderDay(longDay);
const shortA = api.analyzeProviderDay(shortDay);
const expectedUtil = Math.round(100 * (longA.occupiedMinutes + shortA.occupiedMinutes) / (longA.workingMinutes + shortA.workingMinutes));
const equalAvg = Math.round((longA.utilizationPercent + shortA.utilizationPercent) / 2);
check("no-gap provider stays baseline and still counts in metrics", weighted.providerCount === 2
  && weighted.activeProviderPlanCount === 0
  && weighted.utilizationBeforeWeighted === expectedUtil, {
    util: weighted.utilizationBeforeWeighted,
    expected: expectedUtil,
    working: longA.workingMinutes + shortA.workingMinutes
  });
check("salon utilization is weighted by working minutes", weighted.utilizationBeforeWeighted === expectedUtil && (
  equalAvg === expectedUtil || weighted.utilizationBeforeWeighted !== equalAvg || longA.workingMinutes !== shortA.workingMinutes
), { weighted: weighted.utilizationBeforeWeighted, equalAvg: equalAvg });
check("8-hour and 2-hour working minutes are not averaged equally", longA.workingMinutes === 480 && shortA.workingMinutes === 120 && weighted.utilizationBeforeWeighted === expectedUtil);
check("no original between-gaps yields 0 salon recovery percent", weighted.totalOriginalBetweenGapMinutes === 0 && weighted.salonGapRecoveryPercent === 0 && weighted.resolvedGapCount === 0);

// ---------------------------------------------------------------------------
// NO CROSS-PROVIDER MOVES
// ---------------------------------------------------------------------------

check("existing appointments never change provider", (independent.selectedProviderPlans || []).every(function (plan) {
  return (plan.selectedActions || []).every(function (action) {
    return !action.appointmentId || action.providerId === plan.providerId || !action.providerId;
  });
}));

// ---------------------------------------------------------------------------
// PHASE 9 TRUNCATION PROPAGATION
// ---------------------------------------------------------------------------

function manyGapDay(providerId) {
  const lines = [];
  var i;
  for (i = 0; i < 8; i += 1) {
    var start = 8 * 60 + i * 90;
    lines.push(line(start, start + 60, { lineId: providerId + "-mg-" + i, appointmentId: providerId + "-mg-" + i, providerId: providerId }));
  }
  return makeDay({
    providerId: providerId,
    workingIntervals: [{ startMin: 8 * 60, endMin: 20 * 60 }],
    lines: lines
  });
}
const truncA = manyGapDay("provTrunc");
const truncB = oneGapDay("provKeep");
const truncSalon = api.planSalonWideRecovery([truncA, truncB], [], {
  maxEvaluatedCombinations: 2,
  maxGaps: 6,
  maxActionsPerGap: 4
});
check("Phase 9 truncation makes the salon plan non-exhaustive", truncSalon.searchMetadata.truncated === true && truncSalon.searchMetadata.exhaustive === false, truncSalon.searchMetadata);

// ---------------------------------------------------------------------------
// PROVIDER LIMIT
// ---------------------------------------------------------------------------

const limitSalon = api.planSalonWideRecovery([
  oneGapDay("provA"),
  oneGapDay("provB"),
  oneGapDay("provC")
], waitW, { maxProviders: 2 });
check("provider limit forces leftover providers to baseline", limitSalon.baselineOnlyProviderCount === 1 && limitSalon.optimizedProviderCount === 2, limitSalon.searchMetadata);
check("excluded provider stays in salon metrics", limitSalon.providerCount === 3 && limitSalon.skippedProviderPlans.some(function (row) {
  return row.reason === "outside_salon_search_limit";
}), limitSalon.skippedProviderPlans);
check("excluded provider still contributes working time", limitSalon.utilizationBeforeWeighted > 0);

// ---------------------------------------------------------------------------
// PLAN LIMIT + EVALUATION CAP
// ---------------------------------------------------------------------------

const planLimit = api.rankGlobalProviderDayRecoveryCandidates(dayA, [
  waitReq({ waitlistId: "wl-a", durationMinutes: 30 }),
  waitReq({ waitlistId: "wl-b", durationMinutes: 30 })
], { maxPlansPerProvider: 2 });
check("maxPlansPerProvider preselects deterministically", planLimit.length <= 2 && planLimit.some(function (row) {
  return !(row.selectedActions || []).length;
}) && JSON.stringify(planLimit.map(function (row) { return (row.selectedActions || []).map(function (action) { return action.actionId; }); }))
  === JSON.stringify(api.rankGlobalProviderDayRecoveryCandidates(dayA, [
    waitReq({ waitlistId: "wl-a", durationMinutes: 30 }),
    waitReq({ waitlistId: "wl-b", durationMinutes: 30 })
  ], { maxPlansPerProvider: 2 }).map(function (row) {
    return (row.selectedActions || []).map(function (action) { return action.actionId; });
  }))
);

const capSalon = api.planSalonWideRecovery([
  oneGapDay("provA"),
  oneGapDay("provB"),
  oneGapDay("provC")
], [
  waitReq({ waitlistId: "wl-1", durationMinutes: 30, createdAtOrder: 1 }),
  waitReq({ waitlistId: "wl-2", durationMinutes: 30, createdAtOrder: 2 })
], { maxPlansPerProvider: 4, maxEvaluatedSalonCombinations: 5 });
const capAgain = api.planSalonWideRecovery([
  oneGapDay("provA"),
  oneGapDay("provB"),
  oneGapDay("provC")
], [
  waitReq({ waitlistId: "wl-1", durationMinutes: 30, createdAtOrder: 1 }),
  waitReq({ waitlistId: "wl-2", durationMinutes: 30, createdAtOrder: 2 })
], { maxPlansPerProvider: 4, maxEvaluatedSalonCombinations: 5 });
check("evaluation cap is a hard ceiling", capSalon.searchMetadata.evaluatedCombinationCount <= 5 && capSalon.searchMetadata.truncated === true, capSalon.searchMetadata);
check("truncated salon search is deterministic", capSalon.salonPlanScore === capAgain.salonPlanScore && JSON.stringify((capSalon.selectedProviderPlans || []).map(function (row) {
  return row.providerId + ":" + (row.selectedActions || []).map(function (action) { return action.actionId; }).join(",");
})) === JSON.stringify((capAgain.selectedProviderPlans || []).map(function (row) {
  return row.providerId + ":" + (row.selectedActions || []).map(function (action) { return action.actionId; }).join(",");
})));
check("bounded_salon_search", hasReason(capSalon, "bounded_salon_search"));

const mixed = api.planSalonWideRecovery([
  dayA,
  makeDay({ providerId: "provX", dateKey: "2026-09-15", locationId: "locA" })
], []);
check("mixed date/location is rejected", mixed.valid === false && mixed.reason === "mixed_location_or_date", mixed);

// ---------------------------------------------------------------------------
// WHOLE-SALON BETWEEN-GAP DENOMINATOR
// ---------------------------------------------------------------------------

function eightBetweenDay(providerId) {
  const lines = [];
  var i;
  for (i = 0; i < 9; i += 1) {
    var start = 8 * 60 + i * 90;
    lines.push(line(start, start + 60, { lineId: providerId + "-eb-" + i, appointmentId: providerId + "-eb-" + i, providerId: providerId }));
  }
  return makeDay({
    providerId: providerId,
    workingIntervals: [{ startMin: 8 * 60, endMin: 21 * 60 }],
    lines: lines
  });
}

function betweenMinutes(day) {
  return (api.findFreeGaps(day) || []).filter(function (gap) { return gap.kind === "between"; }).reduce(function (sum, gap) {
    return sum + gap.gapMin;
  }, 0);
}

const eightDay = eightBetweenDay("provEight");
const eightBetween = (api.findFreeGaps(eightDay) || []).filter(function (gap) { return gap.kind === "between"; });
const eightWaits = [];
var wi;
for (wi = 0; wi < 6; wi += 1) {
  eightWaits.push(waitReq({ waitlistId: "wl-eight-" + wi, durationMinutes: 30, createdAtOrder: wi + 1 }));
}
const eightOpts = { maxGaps: 6, maxMoveMinutes: 0, maxAlternatives: 5, maxActionsPerGap: 6 };
const eightPhase9 = api.planGlobalProviderDayRecovery(eightDay, eightWaits, eightOpts);
const eightSalon = api.planSalonWideRecovery([eightDay], eightWaits, eightOpts);
check("eight original BETWEEN gaps total 240 minutes", eightBetween.length === 8 && betweenMinutes(eightDay) === 240, {
  count: eightBetween.length,
  minutes: betweenMinutes(eightDay)
});
check("salon denominator keeps all 240 original BETWEEN minutes", eightSalon.totalOriginalBetweenGapMinutes === 240, eightSalon.totalOriginalBetweenGapMinutes);
check("Phase 9 considered set is smaller than the salon denominator", eightSalon.searchConsideredBetweenGapMinutes === 180 && eightPhase9.globalGapRecoveryPercent === 100, {
  considered: eightSalon.searchConsideredBetweenGapMinutes,
  phase9Percent: eightPhase9.globalGapRecoveryPercent
});
check("Phase 9 100% considered recovery is 75% of the whole salon day", eightSalon.totalGapRecoveredMinutes === 180 && eightSalon.salonGapRecoveryPercent === 75, {
  recovered: eightSalon.totalGapRecoveredMinutes,
  percent: eightSalon.salonGapRecoveryPercent,
  phase9Recovered: eightPhase9.globalGapRecoveredMinutes
});
check("resolved/partial counts include all original gaps", eightSalon.resolvedGapCount === 6 && eightSalon.partiallyRecoveredGapCount === 0 && eightSalon.originalGapRecoveries.length === 8, {
  resolved: eightSalon.resolvedGapCount,
  partial: eightSalon.partiallyRecoveredGapCount,
  gaps: eightSalon.originalGapRecoveries.length
});
check("Phase 9 source recovery is not rewritten", eightPhase9.globalGapRecoveredMinutes === 180 && eightPhase9.globalGapRecoveryPercent === 100);
check("salonPlanScore uses the corrected whole-salon percent", eightSalon.salonPlanScore === expectedSalonScore(
  eightSalon,
  1,
  api.analyzeProviderDay(eightDay).workingMinutes
), { got: eightSalon.salonPlanScore, expected: expectedSalonScore(eightSalon, 1, api.analyzeProviderDay(eightDay).workingMinutes) });

const limitDenom = api.planSalonWideRecovery([
  oneGapDay("provA"),
  oneGapDay("provB")
], waitW, { maxProviders: 1, maxMoveMinutes: 0 });
check("excluded provider's BETWEEN gaps stay in the salon denominator", limitDenom.totalOriginalBetweenGapMinutes === 60 && limitDenom.totalGapRecoveredMinutes === 30 && limitDenom.salonGapRecoveryPercent === 50, {
  original: limitDenom.totalOriginalBetweenGapMinutes,
  recovered: limitDenom.totalGapRecoveredMinutes,
  percent: limitDenom.salonGapRecoveryPercent,
  baseline: limitDenom.baselineOnlyProviderCount
});
check("untouched baseline provider still contributes gap minutes", limitDenom.originalGapRecoveries.filter(function (row) {
  return row.recoveredMinutes === 0;
}).length === 1 && limitDenom.originalGapRecoveries.reduce(function (sum, row) {
  return sum + row.originalGapMinutes;
}, 0) === 60);

const partialDay = makeDay({
  providerId: "provPartial",
  lines: [
    line(10 * 60, 11 * 60, { lineId: "part-a", appointmentId: "part-a", providerId: "provPartial" }),
    line(12 * 60, 13 * 60, { lineId: "part-b", appointmentId: "part-b", providerId: "provPartial" })
  ]
});
const partialSalon = api.planSalonWideRecovery([partialDay], [
  waitReq({ waitlistId: "wl-half", durationMinutes: 30 })
], { maxMoveMinutes: 0 });
check("partial recovery of a 60-minute gap is 50%", partialSalon.totalOriginalBetweenGapMinutes === 60 && partialSalon.totalGapRecoveredMinutes === 30 && partialSalon.salonGapRecoveryPercent === 50 && partialSalon.partiallyRecoveredGapCount === 1 && partialSalon.resolvedGapCount === 0, {
  original: partialSalon.totalOriginalBetweenGapMinutes,
  recovered: partialSalon.totalGapRecoveredMinutes,
  percent: partialSalon.salonGapRecoveryPercent,
  partial: partialSalon.partiallyRecoveredGapCount,
  resolved: partialSalon.resolvedGapCount
});

check("truncated search still uses the whole original salon denominator", truncSalon.totalOriginalBetweenGapMinutes === betweenMinutes(truncA) + betweenMinutes(truncB) && truncSalon.searchMetadata.truncated === true, {
  salonOriginal: truncSalon.totalOriginalBetweenGapMinutes,
  days: betweenMinutes(truncA) + betweenMinutes(truncB)
});

// ---------------------------------------------------------------------------
// SOURCE IMMUTABILITY / DETERMINISM / PURITY
// ---------------------------------------------------------------------------

check("original ProviderDays are unchanged", JSON.stringify(dayA) === snapshotA && JSON.stringify(dayB) === snapshotB);
check("Phase 9 candidate plans are unchanged", JSON.stringify(phase9Ranked) === phase9Snap);
check("same salon input yields the same output", independent.salonPlanScore === api.planSalonWideRecovery([dayA, dayB], []).salonPlanScore);

const src = fs.readFileSync(path.join(root, "public/booking/smart-scheduling/salon-plan.js"), "utf8");
check("purity: no Firebase APIs", !/firebase-firestore|getDocs\s*\(|onSnapshot\s*\(|updateDoc\s*\(|addDoc\s*\(/.test(src));
check("purity: no network", !/\bfetch\s*\(|XMLHttpRequest/.test(src));
check("purity: no writes / timers / Date", !/\bsetTimeout\b|\bsetInterval\b|\bDate\s*\(|createAppointment|updateAppointment|cancelAppointment/.test(src));
check("purity: no DOM / Calendar / Reports", !/\bdocument\b|\blocalStorage\b|ffBookingCal|ffBookingReports/.test(src));
check("purity: no messaging / booking", !/sendSms|sendEmail|twilio|mailer|bookClient|autoBook|acceptLink/i.test(src));
check("purity: does not invent Phase 2 / Phase 6 / Phase 8 candidates", !/findMoveOpportunities|rankWaitlistMatch|planGapRecovery/.test(src));
check("module stays out of global-plan search duplication", !/function runGlobalProviderDaySearch/.test(src));

if (failed) {
  console.log("\n" + failed + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll salon plan checks passed.");
