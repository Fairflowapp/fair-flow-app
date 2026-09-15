/**
 * Smart Scheduling Phase 12 parallel / simultaneous multi-service visits.
 * No Firestore, DOM, Calendar, or Reports.
 * Usage: node scripts/test-booking-smart-scheduling-parallel-multi-service.js
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
  "public/booking/smart-scheduling/parallel-multi-service.js"
].forEach(function (rel) { load(rel, windowObj); });

const api = windowObj.ffBookingSmartScheduling;
if (!api || typeof api.rankParallelMultiServiceVisitPlans !== "function") {
  console.error("Smart Scheduling parallel multi-service API did not load.");
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

function expectedParallelScore(row, providerCount, workingMinutes) {
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

function byKey(plan, key) {
  return (plan && plan.serviceLines || []).find(function (row) { return row.lineKey === key; });
}

const emptyA = makeDay({ providerId: "provA" });
const emptyB = makeDay({ providerId: "provB" });
const emptyC = makeDay({ providerId: "provC" });

check("public parallel multi-service API loaded", !!(
  api.rankParallelMultiServiceVisitPlans
  && api.recommendParallelMultiServiceVisit
  && api.compareParallelMultiServiceVisitPlans
  && api.PARALLEL_MULTI_SERVICE
));

// ---------------------------------------------------------------------------
// BASIC PARALLEL
// ---------------------------------------------------------------------------

const basicReq = {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "hands_feet" }),
    svc("pedi", 60, ["provB"], { parallelGroup: "hands_feet" })
  ],
  preferredStartMin: 10 * 60
};
const snapA = JSON.stringify(emptyA);
const snapB = JSON.stringify(emptyB);
const basic = api.recommendParallelMultiServiceVisit([emptyA, emptyB], basicReq);
check("basic parallel uses two providers at the same start", basic && basic.valid && byKey(basic, "mani").startMin === 10 * 60 && byKey(basic, "pedi").startMin === 10 * 60 && providersOf(basic).sort().join(",") === "provA,provB", basic && {
  providers: providersOf(basic),
  starts: basic.serviceLines.map(function (row) { return row.startMin; })
});
check("basic parallel elapsed 60, sum 120, saved 60", basic && basic.visitElapsedMinutes === 60 && basic.sumServiceMinutes === 120 && basic.parallelMinutesSaved === 60, basic);
check("60 minutes saved yields +8 efficiency bonus", basic && basic.parallelEfficiencyBonus === 8);
check("complete_parallel_visit_fit and time-saved reasons", hasReason(basic, "complete_parallel_visit_fit") && hasReason(basic, "parallel_services_reduce_visit_time"));

// ---------------------------------------------------------------------------
// PARALLEL + SEQUENTIAL / DIFFERENT DURATIONS
// ---------------------------------------------------------------------------

const mixed = api.recommendParallelMultiServiceVisit([emptyA, emptyB, emptyC], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "hands_feet" }),
    svc("pedi", 45, ["provB"], { parallelGroup: "hands_feet" }),
    svc("brows", 15, ["provC"])
  ],
  preferredStartMin: 10 * 60
});
check("parallel 60/45 then brows 15 elapsed 75", mixed && mixed.valid && mixed.visitElapsedMinutes === 75 && mixed.sumServiceMinutes === 120 && mixed.parallelMinutesSaved === 45, mixed);
check("shorter pedi ends at 10:45 but brows wait for the 11:00 block barrier", mixed && byKey(mixed, "pedi").endMin === 10 * 60 + 45 && byKey(mixed, "brows").startMin === 11 * 60, mixed && {
  pediEnd: mixed && byKey(mixed, "pedi") && byKey(mixed, "pedi").endMin,
  browsStart: mixed && byKey(mixed, "brows") && byKey(mixed, "brows").startMin,
  blocks: mixed && mixed.blocks
});
check("non-consecutive same group name is not merged", api.recommendParallelMultiServiceVisit([emptyA, emptyB, emptyC], {
  serviceLines: [
    svc("a", 30, ["provA"], { parallelGroup: "x" }),
    svc("b", 30, ["provB"], { parallelGroup: "x" }),
    svc("c", 15, ["provC"], { parallelGroup: "y" }),
    svc("d", 15, ["provA"], { parallelGroup: "x" })
  ],
  preferredStartMin: 10 * 60
}).blocks.map(function (row) { return row.lineKeys.join("+"); }).join("|") === "a+b|c|d");

// ---------------------------------------------------------------------------
// SAME PROVIDER INVALID / NON-GREEDY
// ---------------------------------------------------------------------------

const sameProvider = api.rankParallelMultiServiceVisitPlans([emptyA], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "hands_feet" }),
    svc("pedi", 60, ["provA"], { parallelGroup: "hands_feet" })
  ],
  preferredStartMin: 10 * 60
});
check("same provider cannot take both simultaneous lines", sameProvider.length === 0, { count: sameProvider.length });

const packedA = makeDay({
  providerId: "provA",
  lines: [
    line(9 * 60, 10 * 60, { providerId: "provA", lineId: "a-am", appointmentId: "a-am" }),
    line(11 * 60, 12 * 60, { providerId: "provA", lineId: "a-noon", appointmentId: "a-noon" })
  ]
});
const isolatedMani = api.recommendProviderAssignment([packedA, emptyB], {
  durationMinutes: 60,
  snapMinutes: 15,
  preferredStartMin: 10 * 60,
  assignmentType: "any_provider"
});
const isolatedPedi = api.recommendProviderAssignment([packedA, emptyC], {
  durationMinutes: 60,
  snapMinutes: 15,
  preferredStartMin: 10 * 60,
  assignmentType: "any_provider"
});
check("A is locally best for both isolated services", isolatedMani && isolatedMani.providerId === "provA" && isolatedPedi && isolatedPedi.providerId === "provA");

const greedy = api.recommendParallelMultiServiceVisit([packedA, emptyB, emptyC], {
  serviceLines: [
    svc("mani", 60, ["provA", "provB"], { parallelGroup: "hands_feet" }),
    svc("pedi", 60, ["provA", "provC"], { parallelGroup: "hands_feet" })
  ],
  preferredStartMin: 10 * 60
});
const greedyIds = providersOf(greedy);
check("non-greedy block assigns A to only one simultaneous line", greedy && greedy.valid && greedyIds.indexOf("provA") !== -1 && greedyIds.filter(function (id) { return id === "provA"; }).length === 1 && greedyIds.length === 2, greedy && greedyIds);
check("uses_provider_alternative_for_parallel_fit", hasReason(greedy, "uses_provider_alternative_for_parallel_fit"));

const twoSpecific = api.recommendParallelMultiServiceVisit([emptyA, emptyB], {
  serviceLines: [
    svc("mani", 60, ["provA"], { assignmentType: "specific_provider", requestedProviderId: "provA", parallelGroup: "hands_feet" }),
    svc("pedi", 60, ["provA"], { assignmentType: "specific_provider", requestedProviderId: "provA", parallelGroup: "hands_feet" })
  ],
  preferredStartMin: 10 * 60
});
check("two specific lines requiring the same provider have no complete visit", twoSpecific === null);

// ---------------------------------------------------------------------------
// EVOLVING STATE
// ---------------------------------------------------------------------------

const evolveA = makeDay({
  providerId: "provA",
  lines: [line(11 * 60, 12 * 60, { providerId: "provA" })]
});
const evolve = api.recommendParallelMultiServiceVisit([evolveA, emptyB], {
  serviceLines: [
    svc("mani", 60, ["provB"], { parallelGroup: "hands_feet" }),
    svc("pedi", 45, ["provA"], { parallelGroup: "hands_feet" }),
    svc("brows", 15, ["provA", "provB"])
  ],
  preferredStartMin: 10 * 60
});
check("block 1 occupancy is visible before block 2", evolve && evolve.valid && byKey(evolve, "brows").startMin === 11 * 60 && byKey(evolve, "brows").providerId === "provB", evolve && {
  brows: evolve && byKey(evolve, "brows"),
  pedi: evolve && byKey(evolve, "pedi")
});

// ---------------------------------------------------------------------------
// SEQUENTIAL REGRESSION
// ---------------------------------------------------------------------------

const seqReq = {
  serviceLines: [svc("gel", 60, ["provA"]), svc("brow", 15, ["provB"])],
  preferredStartMin: 10 * 60
};
const phase11 = api.recommendMultiServiceVisit([emptyA, emptyB], seqReq);
const phase12 = api.recommendParallelMultiServiceVisit([emptyA, emptyB], seqReq);
check("no parallel groups stay consistent with Phase 11 providers and times", phase11 && phase12 && phase12.valid && providersOf(phase12).join(",") === providersOf(phase11).join(",") && phase12.visitStartMin === phase11.visitStartMin && phase12.serviceLines[1].startMin === phase11.serviceLines[1].startMin, {
  p11: phase11 && providersOf(phase11),
  p12: phase12 && providersOf(phase12)
});
check("sequential Phase 12 score matches Phase 11 when nothing is saved", phase12 && phase12.parallelMinutesSaved === 0 && phase12.parallelEfficiencyBonus === 0 && phase12.parallelVisitPlanScore === phase11.multiServicePlanScore);

// ---------------------------------------------------------------------------
// PREFERRED START / LUNCH
// ---------------------------------------------------------------------------

const flex = api.recommendParallelMultiServiceVisit([emptyA, emptyB], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 60, ["provB"], { parallelGroup: "g" })
  ],
  preferredStartMin: 10 * 60,
  flexibilityMinutes: 30,
  earliestStartMin: 10 * 60 + 15,
  latestStartMin: 10 * 60 + 30
});
check("flexibility stays inside earliest/latest hard bounds", flex && flex.visitStartMin >= 10 * 60 + 15 && flex.visitStartMin <= 10 * 60 + 30, flex && flex.visitStartMin);

const lunchA = makeDay({
  providerId: "provA",
  workingIntervals: [{ startMin: 9 * 60, endMin: 12 * 60 }, { startMin: 13 * 60, endMin: 18 * 60 }]
});
const lunchB = makeDay({
  providerId: "provB",
  workingIntervals: [{ startMin: 9 * 60, endMin: 12 * 60 }, { startMin: 13 * 60, endMin: 18 * 60 }]
});
check("parallel visit cannot illegally cross lunch", api.recommendParallelMultiServiceVisit([lunchA, lunchB], {
  serviceLines: [
    svc("mani", 45, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 45, ["provB"], { parallelGroup: "g" })
  ],
  preferredStartMin: 11 * 60 + 30
}) === null);
const lunchOk = api.recommendParallelMultiServiceVisit([lunchA, lunchB], {
  serviceLines: [
    svc("mani", 45, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 45, ["provB"], { parallelGroup: "g" })
  ],
  preferredStartMin: 10 * 60
});
check("split-shift morning parallel visit stays inside one interval", lunchOk && lunchOk.valid && lunchOk.visitEndMin <= 12 * 60);

// ---------------------------------------------------------------------------
// OVERLAP / BASELINE
// ---------------------------------------------------------------------------

const overlapA = makeDay({
  providerId: "provA",
  allowedOverlapMinutes: 15,
  lines: [line(11 * 60, 12 * 60, { providerId: "provA" })]
});
const overlapPlan = api.recommendParallelMultiServiceVisit([overlapA, emptyB], {
  serviceLines: [
    svc("mani", 30, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 30, ["provB"], { parallelGroup: "g" })
  ],
  preferredStartMin: 10 * 60 + 45
});
check("permitted salon overlap can remain valid", overlapPlan && overlapPlan.valid === true, overlapPlan);
check("same-visit same-provider parallel stays invalid even with overlap allowance", api.rankParallelMultiServiceVisitPlans([overlapA], {
  serviceLines: [
    svc("mani", 30, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 30, ["provA"], { parallelGroup: "g" })
  ],
  preferredStartMin: 10 * 60
}).length === 0);

const baseA = line(13 * 60, 14 * 60, { lineId: "base-a", appointmentId: "base-a", providerId: "provA" });
const baseB = line(13 * 60 + 30, 14 * 60 + 30, { lineId: "base-b", appointmentId: "base-b", providerId: "provA" });
const baselineDay = makeDay({ providerId: "provA", lines: [baseA, baseB] });
check("fixture has an illegal baseline overlap", api.helpers.overlapMinutes(baseA.startMin, baseA.endMin, baseB.startMin, baseB.endMin) === 30);
const baselineVisit = api.recommendParallelMultiServiceVisit([baselineDay, emptyB], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 60, ["provB"], { parallelGroup: "g" })
  ],
  preferredStartMin: 10 * 60
});
check("unchanged baseline illegal overlap is tolerated", baselineVisit && baselineVisit.valid === true, baselineVisit);

const worsen = api.rankParallelMultiServiceVisitPlans([
  makeDay({
    providerId: "provA",
    lines: [line(11 * 60, 12 * 60, { providerId: "provA" })]
  }),
  emptyB
], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 60, ["provB"], { parallelGroup: "g" })
  ],
  preferredStartMin: 10 * 60 + 15
});
check("new/worsened visit overlap is rejected", worsen.length === 0, { count: worsen.length });

// ---------------------------------------------------------------------------
// EFFICIENCY / SCORE
// ---------------------------------------------------------------------------

check("efficiency bonus examples and cap", api.PARALLEL_MULTI_SERVICE.EFFICIENCY_CAP === 15);
const triple = api.recommendParallelMultiServiceVisit([emptyA, emptyB, emptyC], {
  serviceLines: [
    svc("a", 60, ["provA"], { parallelGroup: "g" }),
    svc("b", 60, ["provB"], { parallelGroup: "g" }),
    svc("c", 60, ["provC"], { parallelGroup: "g" })
  ],
  preferredStartMin: 10 * 60
});
check("120 minutes saved caps efficiency bonus at 15", triple && triple.parallelMinutesSaved === 120 && triple.parallelEfficiencyBonus === 15, triple);
const working = api.analyzeProviderDay(emptyA).workingMinutes + api.analyzeProviderDay(emptyB).workingMinutes;
check("parallelVisitPlanScore follows the Phase 12 formula", basic && basic.parallelVisitPlanScore === expectedParallelScore(basic, 2, working), {
  got: basic && basic.parallelVisitPlanScore,
  expected: basic && expectedParallelScore(basic, 2, working)
});
check("slotFitComponent uses mean slot score", basic && basic.slotFitComponent === clamp(Math.round((basic.meanSlotScore - 50) * 0.40), -20, 20));

// ---------------------------------------------------------------------------
// FULL PLAN ONLY / BOUNDED SEARCH
// ---------------------------------------------------------------------------

const failedLine = api.rankParallelMultiServiceVisitPlans([emptyA, emptyB], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 60, ["provB"], { parallelGroup: "g" }),
    svc("late", 60, ["provA"])
  ],
  preferredStartMin: 17 * 60
});
check("one failed later line invalidates the complete candidate", failedLine.length === 0);

const boundOpts = { maxVisitStartCandidates: 2, maxProvidersPerLine: 2, maxBlockAssignments: 2, maxEvaluatedVisitPlans: 2 };
const boundReq = {
  serviceLines: [
    svc("mani", 30, ["provA", "provB"], { parallelGroup: "g" }),
    svc("pedi", 30, ["provB", "provC"], { parallelGroup: "g" })
  ]
};
const bound = api.rankParallelMultiServiceVisitPlans([emptyA, emptyB, emptyC], boundReq, boundOpts);
check("bounded search reports Phase 12 limits", bound[0] && bound[0].searchMetadata.maxParallelLinesPerBlock === 3 && bound[0].searchMetadata.maxBlockAssignments === 2 && bound[0].searchMetadata.maxEvaluatedVisitPlans === 2, bound[0] && bound[0].searchMetadata);
check("truncated search does not claim exhaustive optimality", bound[0] && bound[0].searchMetadata.truncated === true && bound[0].searchMetadata.exhaustive === false, bound[0] && bound[0].searchMetadata);
check("bounded search is deterministic", JSON.stringify(bound) === JSON.stringify(api.rankParallelMultiServiceVisitPlans([emptyA, emptyB, emptyC], boundReq, boundOpts)));

// ---------------------------------------------------------------------------
// VALIDATION
// ---------------------------------------------------------------------------

check("too many parallel lines in one block is rejected", api.recommendParallelMultiServiceVisit([emptyA, emptyB, emptyC, makeDay({ providerId: "provD" })], {
  serviceLines: [
    svc("a", 15, ["provA"], { parallelGroup: "g" }),
    svc("b", 15, ["provB"], { parallelGroup: "g" }),
    svc("c", 15, ["provC"], { parallelGroup: "g" }),
    svc("d", 15, ["provD"], { parallelGroup: "g" })
  ]
}).reason === "too_many_parallel_lines_for_phase12");
check("duplicate lineKey is rejected", api.recommendParallelMultiServiceVisit([emptyA, emptyB], {
  serviceLines: [
    svc("same", 60, ["provA"], { parallelGroup: "g" }),
    svc("same", 60, ["provB"], { parallelGroup: "g" })
  ]
}).reason === "duplicate_line_key");
check("bad duration is rejected", api.recommendParallelMultiServiceVisit([emptyA, emptyB], {
  serviceLines: [
    svc("mani", 0, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 60, ["provB"], { parallelGroup: "g" })
  ]
}).reason === "invalid_duration");
check("missing provider is rejected", api.recommendParallelMultiServiceVisit([emptyA], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 60, ["provZ"], { parallelGroup: "g" })
  ]
}).reason === "unknown_provider");
check("mixed date/location is rejected", api.recommendParallelMultiServiceVisit([
  emptyA,
  makeDay({ providerId: "provB", dateKey: "2026-09-15" })
], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 60, ["provB"], { parallelGroup: "g" })
  ]
}).reason === "mixed_location_or_date");
check("too many service lines is unsupported", api.recommendParallelMultiServiceVisit([emptyA], {
  serviceLines: [svc("a", 15, ["provA"]), svc("b", 15, ["provA"]), svc("c", 15, ["provA"]), svc("d", 15, ["provA"]), svc("e", 15, ["provA"])]
}).reason === "too_many_service_lines_for_phase12");

// ---------------------------------------------------------------------------
// IMMUTABILITY / PURITY
// ---------------------------------------------------------------------------

check("original ProviderDays are unchanged", JSON.stringify(emptyA) === snapA && JSON.stringify(emptyB) === snapB);
check("same parallel input yields the same output", basic.parallelVisitPlanScore === api.recommendParallelMultiServiceVisit([emptyA, emptyB], basicReq).parallelVisitPlanScore);

const src = fs.readFileSync(path.join(root, "public/booking/smart-scheduling/parallel-multi-service.js"), "utf8");
check("purity: no Firebase APIs", !/firebase-firestore|getDocs\s*\(|onSnapshot\s*\(|updateDoc\s*\(|addDoc\s*\(/.test(src));
check("purity: no network", !/\bfetch\s*\(|XMLHttpRequest/.test(src));
check("purity: no writes / timers / Date", !/\bsetTimeout\b|\bsetInterval\b|\bDate\s*\(|createAppointment|updateAppointment|cancelAppointment/.test(src));
check("purity: no DOM / Calendar / Reports", !/\bdocument\b|\blocalStorage\b|ffBookingCal|ffBookingReports/.test(src));
check("purity: no messaging / booking", !/sendSms|sendEmail|twilio|mailer|bookClient|autoBook|acceptLink/i.test(src));
check("does not rewrite Phase 11 sequential planner", !/function rankMultiServiceVisitPlans/.test(src) && !/function recommendMultiServiceVisit/.test(src));

if (failed) {
  console.log("\n" + failed + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll parallel multi-service visit checks passed.");
