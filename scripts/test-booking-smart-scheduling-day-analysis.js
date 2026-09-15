/**
 * Smart Scheduling Phase 3 day analysis. No Firestore, DOM, Calendar, or Reports.
 * Usage: node scripts/test-booking-smart-scheduling-day-analysis.js
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
  "public/booking/smart-scheduling/priorities.js"
].forEach(function (rel) { load(rel, windowObj); });

const api = windowObj.ffBookingSmartScheduling;
if (!api || typeof api.analyzeProviderDay !== "function") {
  console.error("Smart Scheduling day analysis API did not load.");
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

function line(startMin, endMin, extra) {
  return Object.assign({
    lineId: "l-" + startMin + "-" + endMin,
    appointmentId: "a-" + startMin,
    providerId: "provA",
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

// ---------------------------------------------------------------------------
// TIME ACCOUNTING
// ---------------------------------------------------------------------------

const empty = makeDay();
const emptyA = api.analyzeProviderDay(empty);
check("empty working minutes are 9 hours", emptyA.workingMinutes === 9 * 60);
check("empty occupied minutes are 0", emptyA.occupiedMinutes === 0);
check("empty true free minutes equal working minutes", emptyA.trueFreeMinutes === 9 * 60);

const half = makeDay({ lines: [line(9 * 60, 13 * 60 + 30)] });
const halfA = api.analyzeProviderDay(half);
check("50% occupied day accounts 270 occupied minutes", halfA.occupiedMinutes === 270);
check("50% true free minutes are 270", halfA.trueFreeMinutes === 270);

const overlapDay = makeDay({
  allowedOverlapMinutes: 30,
  lines: [line(10 * 60, 12 * 60, { lineId: "o1" }), line(11 * 60, 13 * 60, { lineId: "o2" })]
});
const overlapA = api.analyzeProviderDay(overlapDay);
check("overlapping appointments use occupied union, not a sum", overlapA.occupiedMinutes === 3 * 60);
check("overlap utilization stays at or below 100%", overlapA.utilizationPercent <= 100);

const lunch = makeDay({
  workingIntervals: [
    { startMin: 9 * 60, endMin: 12 * 60 },
    { startMin: 13 * 60, endMin: 18 * 60 }
  ],
  lines: [line(9 * 60, 10 * 60)]
});
const lunchA = api.analyzeProviderDay(lunch);
check("split-shift working minutes exclude lunch", lunchA.workingMinutes === 8 * 60);
check("lunch is not true free time", lunchA.trueFreeMinutes === 8 * 60 - 60);
check("no gap spans lunch", lunchA.gaps.every(function (gap) {
  return !(gap.startMin < 12 * 60 && gap.endMin > 13 * 60);
}));

const full = makeDay({ lines: [line(9 * 60, 18 * 60)] });
const fullA = api.analyzeProviderDay(full);
check("full day occupied equals working", fullA.occupiedMinutes === fullA.workingMinutes && fullA.trueFreeMinutes === 0);

// ---------------------------------------------------------------------------
// UTILIZATION
// ---------------------------------------------------------------------------

check("empty utilization is 0", emptyA.utilizationPercent === 0);
check("full utilization is 100", fullA.utilizationPercent === 100);
check("half-day utilization is 50", halfA.utilizationPercent === 50);
check("overlap utilization is 33", overlapA.utilizationPercent === Math.round((180 / 540) * 100));

// ---------------------------------------------------------------------------
// GAPS
// ---------------------------------------------------------------------------

const spec = makeDay({
  lines: [
    line(12 * 60, 13 * 60, { lineId: "client-a", appointmentId: "appt-a" }),
    line(13 * 60 + 30, 14 * 60 + 30, { lineId: "client-b", appointmentId: "appt-b" })
  ]
});
const specA = api.analyzeProviderDay(spec);
check("spec day has leading, between, and trailing gaps", specA.gaps.some(function (g) { return g.kind === "leading"; }) && specA.betweenGapCount === 1 && specA.gaps.some(function (g) { return g.kind === "trailing"; }));
check("30-minute between gap is medium", specA.gaps.some(function (g) {
  return g.kind === "between" && g.gapMin === 30 && g.sizeClass === "medium" && g.stranded === false;
}));

const tiny = makeDay({
  lines: [line(10 * 60, 11 * 60), line(11 * 60 + 15, 12 * 60)]
});
const tinyA = api.analyzeProviderDay(tiny);
check("15-minute between gap is small and stranded at default 30", tinyA.gaps.some(function (g) {
  return g.kind === "between" && g.gapMin === 15 && g.sizeClass === "small" && g.stranded === true;
}));
check("stranded gap minutes include the 15-minute hole", tinyA.strandedGapMinutes >= 15);
check("15-minute between gap contributes to strandedBetweenGapMinutes", tinyA.strandedBetweenGapMinutes === 15 && tinyA.strandedBetweenGapCount === 1);

const leading15 = makeDay({
  workingIntervals: [{ startMin: 9 * 60, endMin: 12 * 60 }],
  lines: [line(9 * 60 + 15, 12 * 60)]
});
const leading15A = api.analyzeProviderDay(leading15);
check("15-minute leading gap is reported as stranded but not between-stranded", leading15A.strandedGapMinutes === 15 && leading15A.strandedBetweenGapMinutes === 0 && leading15A.strandedBetweenGapCount === 0);

const trailing15 = makeDay({
  workingIntervals: [{ startMin: 9 * 60, endMin: 12 * 60 }],
  lines: [line(9 * 60, 12 * 60 - 15)]
});
const trailing15A = api.analyzeProviderDay(trailing15);
check("15-minute trailing gap is reported as stranded but not between-stranded", trailing15A.strandedGapMinutes === 15 && trailing15A.strandedBetweenGapMinutes === 0 && trailing15A.strandedBetweenGapCount === 0);

check("30-minute between gap with reference 30 is not stranded", specA.gaps.some(function (g) {
  return g.kind === "between" && g.gapMin === 30 && g.stranded === false;
}) && specA.strandedBetweenGapMinutes === 0 && specA.strandedBetweenGapCount === 0);

const ref15 = api.analyzeProviderDay(tiny, { referenceServiceDurationMinutes: 15 });
check("configurable reference duration can make a 15-minute gap usable", ref15.gaps.some(function (g) {
  return g.kind === "between" && g.gapMin === 15 && g.stranded === false;
}) && ref15.strandedBetweenGapMinutes === 0 && ref15.strandedBetweenGapCount === 0);

const largeGap = makeDay({
  lines: [line(10 * 60, 11 * 60), line(12 * 60, 13 * 60)]
});
check("60-minute between gap is large", api.analyzeProviderDay(largeGap).gaps.some(function (g) {
  return g.kind === "between" && g.gapMin === 60 && g.sizeClass === "large";
}));

// ---------------------------------------------------------------------------
// FRAGMENTATION
// ---------------------------------------------------------------------------

const chopped = makeDay({
  workingIntervals: [{ startMin: 9 * 60, endMin: 12 * 60 }],
  lines: [
    line(9 * 60, 10 * 60, { lineId: "c1" }),
    line(10 * 60 + 15, 11 * 60, { lineId: "c2" }),
    line(11 * 60 + 15, 12 * 60, { lineId: "c3" })
  ]
});
const block = makeDay({
  workingIntervals: [{ startMin: 9 * 60, endMin: 12 * 60 }],
  lines: [line(9 * 60, 11 * 60 + 30, { lineId: "one" })]
});
const choppedA = api.analyzeProviderDay(chopped);
const blockA = api.analyzeProviderDay(block);
check("two 15-minute between gaps are more fragmented than one equal trailing leftover", choppedA.fragmentationScore > blockA.fragmentationScore);
check("packed-in-block trailing leftover has no between-gap fragmentation", blockA.betweenGapCount === 0 && blockA.fragmentationScore === 0);
check("no between gaps means fragmentation 0 on a full day", fullA.fragmentationScore === 0);
check("lunch split does not create fragmentation", lunchA.fragmentationScore === 0);
check("fragmentation is deterministic", choppedA.fragmentationScore === api.analyzeProviderDay(chopped).fragmentationScore);

// ---------------------------------------------------------------------------
// GAP PRIORITY
// ---------------------------------------------------------------------------

const trailVsBetween = makeDay({
  workingIntervals: [{ startMin: 9 * 60, endMin: 13 * 60 }],
  lines: [
    line(9 * 60, 10 * 60, { lineId: "p1" }),
    line(10 * 60 + 30, 12 * 60 + 30, { lineId: "p2" })
  ]
});
const priorities = api.rankGapPriorities(trailVsBetween);
const topBetween = priorities.find(function (g) { return g.kind === "between"; });
const topTrail = priorities.find(function (g) { return g.kind === "trailing"; });
check("30-minute between gap outranks an equal-or-larger trailing leftover", topBetween && topTrail && topBetween.priorityScore > topTrail.priorityScore);

const recoverablePri = api.rankGapPriorities(spec);
const specBetween = recoverablePri.find(function (g) { return g.kind === "between"; });
check("recoverable between gap carries a move opportunity", !!(specBetween && specBetween.bestOpportunity && specBetween.recoverableMinutes === 30));

const unrecoverable = makeDay({
  lines: [
    line(12 * 60, 13 * 60, { lineId: "u1" }),
    line(13 * 60 + 30, 14 * 60 + 30, { lineId: "u2" }),
    line(10 * 60, 11 * 60, { lineId: "blocker-early" }),
    line(15 * 60, 16 * 60, { lineId: "blocker-late" })
  ]
});
const blockedPri = api.rankGapPriorities(unrecoverable, { maxMoveMinutes: 15 });
const blockedBetween = blockedPri.find(function (g) { return g.kind === "between" && g.startMin === 13 * 60; });
check("a recoverable between gap outranks an equivalent blocked gap", specBetween && blockedBetween && specBetween.priorityScore > blockedBetween.priorityScore);

// ---------------------------------------------------------------------------
// RECOVERABLE MINUTES
// ---------------------------------------------------------------------------

check("two moves that close the same 30-minute hole count 30, not 60", specA.recoverableGapMinutes === 30);

const twoHoles = makeDay({
  lines: [
    line(10 * 60, 11 * 60, { lineId: "h1" }),
    line(11 * 60 + 30, 12 * 60 + 30, { lineId: "h2" }),
    line(13 * 60, 14 * 60, { lineId: "h3" })
  ]
});
const twoA = api.analyzeProviderDay(twoHoles);
check("separate recoverable gaps count separately", twoA.recoverableGapMinutes >= 60);

const overlapMoves = api.analyzeProviderDay(makeDay({
  allowedOverlapMinutes: 15,
  lines: [
    line(12 * 60, 13 * 60, { lineId: "oa" }),
    line(13 * 60 + 30, 14 * 60 + 30, { lineId: "ob" })
  ]
}));
check("permitted overlap does not inflate recoverable minutes past the true gap", overlapMoves.recoverableGapMinutes === 30);

// ---------------------------------------------------------------------------
// OPTIMIZATION SCORE
// ---------------------------------------------------------------------------

check("packed full day scores 100", fullA.optimizationScore === 100);
check("fragmented day scores lower than a packed block", choppedA.optimizationScore < blockA.optimizationScore);
check("empty day is not scored as optimized", emptyA.optimizationScore === 20);
check("optimization score is deterministic", specA.optimizationScore === api.analyzeProviderDay(spec).optimizationScore);
check("optimization stays in 0–100", [emptyA, fullA, choppedA, specA].every(function (row) {
  return row.optimizationScore >= 0 && row.optimizationScore <= 100;
}));

const eqBetween = makeDay({
  workingIntervals: [{ startMin: 9 * 60, endMin: 11 * 60 + 15 }],
  lines: [
    line(9 * 60, 10 * 60, { lineId: "eq-a" }),
    line(10 * 60 + 15, 11 * 60 + 15, { lineId: "eq-b" })
  ]
});
const eqTrail = makeDay({
  workingIntervals: [{ startMin: 9 * 60, endMin: 11 * 60 + 15 }],
  lines: [line(9 * 60, 11 * 60, { lineId: "eq-one" })]
});
const eqBetweenA = api.analyzeProviderDay(eqBetween);
const eqTrailA = api.analyzeProviderDay(eqTrail);
check("equivalent days share occupied and working minutes", eqBetweenA.occupiedMinutes === eqTrailA.occupiedMinutes && eqBetweenA.workingMinutes === eqTrailA.workingMinutes && eqBetweenA.utilizationPercent === eqTrailA.utilizationPercent);
check("15-minute between gap scores lower than an otherwise equivalent 15-minute trailing remainder", eqBetweenA.optimizationScore < eqTrailA.optimizationScore);
check("trailing remainder does not apply the stranded-time optimization penalty", eqTrailA.optimizationComponents.strandedPenalty === 0 && eqBetweenA.optimizationComponents.strandedPenalty > 0);

// ---------------------------------------------------------------------------
// RECOMMENDATIONS
// ---------------------------------------------------------------------------

function synthMove(over) {
  return Object.assign({
    gapRecoveredMinutes: 30,
    scoreImprovement: 20,
    movementCost: 8,
    moveMinutes: 30,
    proposedStartMin: 800,
    appointmentId: "appt-m",
    lineId: "line-m"
  }, over || {});
}

const cmp = api.compareBestMoves;
check("best-move: greater recovered minutes wins first", cmp(synthMove({ gapRecoveredMinutes: 30 }), synthMove({ gapRecoveredMinutes: 15, scoreImprovement: 99, movementCost: 0, moveMinutes: 5, proposedStartMin: 100 })) < 0);
check("best-move: then greater scoreImprovement", cmp(synthMove({ scoreImprovement: 21 }), synthMove({ scoreImprovement: 20, movementCost: 0, moveMinutes: 5 })) < 0);
check("best-move: then lower movementCost", cmp(synthMove({ movementCost: 4 }), synthMove({ movementCost: 8, moveMinutes: 5, proposedStartMin: 100 })) < 0);
check("best-move: then lower moveMinutes", cmp(synthMove({ moveMinutes: 15 }), synthMove({ moveMinutes: 30, proposedStartMin: 100 })) < 0);
check("best-move: then earlier proposedStartMin", cmp(synthMove({ proposedStartMin: 700 }), synthMove({ proposedStartMin: 800, appointmentId: "aaa" })) < 0);
check("best-move: then stable appointmentId", cmp(synthMove({ appointmentId: "a-1" }), synthMove({ appointmentId: "b-1", lineId: "aaa" })) < 0);
check("best-move: then stable lineId", cmp(synthMove({ lineId: "l-1" }), synthMove({ lineId: "l-2" })) < 0);

const specMoves = api.findMoveOpportunities(spec);
check("Phase 2 still returns all qualifying move opportunities", specMoves.length > 1);

const specRecs = api.recommendDayOptimizations(spec);
const specMoveRecs = specRecs.filter(function (row) { return row.type === "move_appointment"; });
check("one gap + multiple valid moves produces exactly one Phase 3 move_appointment", specMoveRecs.length === 1);
check("best move recommendation appears first", specRecs[0] && specRecs[0].type === "move_appointment");
check("spec recommendation recovers the 1:00–1:30 hole", specRecs[0] && specRecs[0].gap && specRecs[0].gap.startMin === 13 * 60 && specRecs[0].opportunity.gapRecoveredMinutes === 30);

const specGapHits = specMoves.filter(function (opportunity) {
  return api.gapsRecoveredByOpportunity(specA.gaps.filter(function (g) { return g.kind === "between"; }), opportunity).length > 0;
}).slice().sort(api.compareBestMoves);
check("rankGapPriorities and recommendations use the same single best move", specBetween.bestOpportunity && specGapHits[0] && specBetween.bestOpportunity.lineId === specGapHits[0].lineId && specBetween.bestOpportunity.proposedStartMin === specGapHits[0].proposedStartMin && specRecs[0].opportunity.lineId === specBetween.bestOpportunity.lineId && specRecs[0].opportunity.proposedStartMin === specBetween.bestOpportunity.proposedStartMin);
check("same-gap alternatives do not inflate priority", specBetween.priorityScore === (40 + 30 + (specBetween.bestOpportunity.scoreImprovement || 0) + (specBetween.bestOpportunity.gapRecoveredMinutes || 0)));

const twoRecs = api.recommendDayOptimizations(twoHoles);
const twoMoveRecs = twoRecs.filter(function (row) { return row.type === "move_appointment"; });
const twoKeys = twoMoveRecs.map(function (row) {
  return [row.gap.workingIntervalIndex, row.gap.startMin, row.gap.endMin].join("|");
});
check("separate gaps may each produce one recommendation", twoMoveRecs.length >= 2 && twoKeys.length === new Set(twoKeys).size && twoMoveRecs.length === twoA.betweenGapCount);
check("same-gap alternatives do not double-count recoverable minutes", specA.recoverableGapMinutes === 30);

const attentionDay = makeDay({
  lines: [
    line(10 * 60, 11 * 60, { lineId: "left-wall" }),
    line(11 * 60 + 15, 12 * 60, { lineId: "mid-wall" }),
    line(12 * 60 + 15, 13 * 60, { lineId: "right-wall" })
  ]
});
const attentionRecs = api.recommendDayOptimizations(attentionDay, { maxMoveMinutes: 0 });
check("no useful moves but a bad gap yields gap_attention", attentionRecs[0] && attentionRecs[0].type === "gap_attention");

const packedRecs = api.recommendDayOptimizations(full);
check("efficient full day is already_optimized", packedRecs[0] && packedRecs[0].type === "already_optimized");
check("empty day is no_action", api.recommendDayOptimizations(empty)[0].type === "no_action");

const before = JSON.stringify(spec);
api.analyzeProviderDay(spec);
api.recommendDayOptimizations(spec);
check("analysis does not mutate the provider day", JSON.stringify(spec) === before);

// ---------------------------------------------------------------------------
// DETERMINISM / PURITY
// ---------------------------------------------------------------------------

check("analyzeProviderDay is repeat-stable", JSON.stringify(specA) === JSON.stringify(api.analyzeProviderDay(spec)));
check("recommendDayOptimizations is repeat-stable", JSON.stringify(specRecs) === JSON.stringify(api.recommendDayOptimizations(spec)));

const src = [
  "public/booking/smart-scheduling/day-analysis.js",
  "public/booking/smart-scheduling/priorities.js"
].map(function (rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}).join("\n");
check("purity: no Firebase APIs", !/firebase-firestore|getDocs\s*\(|onSnapshot\s*\(|updateDoc\s*\(|addDoc\s*\(/.test(src));
check("purity: no network", !/\bfetch\s*\(|XMLHttpRequest/.test(src));
check("purity: no writes / timers / Date", !/\bsetTimeout\b|\bsetInterval\b|\bDate\s*\(|createAppointment|updateAppointment|cancelAppointment/.test(src));
check("purity: no DOM / Calendar / Reports", !/\bdocument\b|\blocalStorage\b|ffBookingCal|ffBookingReports/.test(src));

if (failed) {
  console.error("FAILED", failed);
  process.exit(1);
}
console.log("All Smart Scheduling Phase 3 day analysis tests passed.");
