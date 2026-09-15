/**
 * Smart Scheduling Phase 4 multi-provider assignment. No Firestore, DOM, Calendar, or Reports.
 * Usage: node scripts/test-booking-smart-scheduling-assign.js
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
  "public/booking/smart-scheduling/assign.js"
].forEach(function (rel) { load(rel, windowObj); });

const api = windowObj.ffBookingSmartScheduling;
if (!api || typeof api.rankProviderAssignments !== "function") {
  console.error("Smart Scheduling assignment API did not load.");
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

function hasReason(row, code) {
  return (row && row.reasons || []).some(function (item) { return item.code === code; });
}

function deltaOf(row, code) {
  const hit = (row && row.reasons || []).find(function (item) { return item.code === code; });
  return hit ? hit.delta : null;
}

const morning = { startMin: 9 * 60, endMin: 12 * 60 };
const cleanA = makeDay({
  providerId: "provA",
  workingIntervals: [morning],
  lines: [line(10 * 60, 11 * 60, { providerId: "provA" })]
});
const emptyB = makeDay({
  providerId: "provB",
  workingIntervals: [morning],
  lines: []
});
const atEleven60 = {
  durationMinutes: 60,
  snapMinutes: 15,
  preferredStartMin: 11 * 60,
  assignmentType: "any_provider"
};

check("public assignment API loaded", !!(
  api.rankProviderAssignments
  && api.rankProviderAssignmentCandidates
  && api.recommendProviderAssignment
));

// ---------------------------------------------------------------------------
// SIMULATION
// ---------------------------------------------------------------------------

const beforeA = api.analyzeProviderDay(cleanA);
const snapshot = JSON.stringify(cleanA);
const simulated = api.dayWithAssignmentCandidate(cleanA, {
  startMin: 11 * 60,
  endMin: 12 * 60
});
const afterA = api.analyzeProviderDay(simulated);
const beforeAgain = api.analyzeProviderDay(cleanA);

check("before metrics are unchanged after a later analysis", beforeA.optimizationScore === beforeAgain.optimizationScore && beforeA.occupiedMinutes === beforeAgain.occupiedMinutes && beforeA.betweenGapCount === beforeAgain.betweenGapCount);
check("original ProviderDay object is not mutated", JSON.stringify(cleanA) === snapshot);
check("simulated day contains the synthetic occupying line", simulated.occupied.some(function (row) {
  return row.lineId === api.ASSIGN.CANDIDATE_LINE_ID && row.startMin === 11 * 60 && row.endMin === 12 * 60 && row.status === "scheduled";
}));
check("simulated after metrics reflect the inserted appointment", afterA.occupiedMinutes === beforeA.occupiedMinutes + 60 && afterA.utilizationPercent > beforeA.utilizationPercent);
check("simulation does not mutate original occupied lines", cleanA.occupied.every(function (row) {
  return row.lineId !== api.ASSIGN.CANDIDATE_LINE_ID;
}));

const cleanRank = api.rankProviderAssignments([cleanA, emptyB], atEleven60);
const cleanPick = cleanRank.find(function (row) { return row.providerId === "provA"; });
check("optimizationBefore matches Phase 3 before analysis", cleanPick && cleanPick.optimizationBefore === beforeA.optimizationScore);
check("optimizationAfter matches Phase 3 simulated analysis", cleanPick && cleanPick.optimizationAfter === afterA.optimizationScore);
check("optimizationDelta is after minus before", cleanPick && cleanPick.optimizationDelta === afterA.optimizationScore - beforeA.optimizationScore);

// ---------------------------------------------------------------------------
// CLEAN FIT VS EMPTY PROVIDER
// ---------------------------------------------------------------------------

check("clean 11:00 pack on a busy provider outranks an empty provider", cleanRank[0] && cleanRank[0].providerId === "provA" && cleanRank[0].startMin === 11 * 60);
check("empty provider still appears as a second choice", cleanRank.some(function (row) { return row.providerId === "provB"; }));
check("underutilization on the empty provider is only the modest max +5", cleanRank.find(function (row) {
  return row.providerId === "provB";
}).underutilizationBonus === 5);
check("underutilization cannot beat a materially superior clean fit", cleanRank[0].providerId === "provA");

// ---------------------------------------------------------------------------
// FRAGMENTATION / STRANDED
// ---------------------------------------------------------------------------

const fragHost = makeDay({
  providerId: "provFrag",
  lines: [
    line(10 * 60, 11 * 60, { providerId: "provFrag" }),
    line(12 * 60 + 15, 13 * 60 + 15, { providerId: "provFrag" })
  ]
});
const cleanHost = makeDay({
  providerId: "provClean",
  lines: [line(10 * 60, 11 * 60, { providerId: "provClean" })]
});
const fragVsClean = api.rankProviderAssignments([fragHost, cleanHost], {
  durationMinutes: 60,
  snapMinutes: 15,
  preferredStartMin: 11 * 60 + 15,
  assignmentType: "any_provider"
});
const fragPick = fragVsClean.find(function (row) { return row.providerId === "provFrag"; });
const cleanAlt = api.rankProviderAssignments([fragHost, cleanHost], {
  durationMinutes: 60,
  snapMinutes: 15,
  preferredStartMin: 11 * 60,
  assignmentType: "any_provider"
});
check("shrinking an existing between-gap from one side is not createsBetweenGap", fragPick && fragPick.createsBetweenGap === false);
check("a one-sided leftover can still increase fragmentation", fragPick && fragPick.fragmentationDelta > 0 && hasReason(fragPick, "increases_fragmentation"));
check("stranded-between increase is penalized", fragPick && fragPick.strandedBetweenMinutesDelta > 0 && hasReason(fragPick, "creates_stranded_time"));
check("clean 11:00 placement outranks a 11:15 placement that strands 15 minutes", cleanAlt[0] && cleanAlt[0].providerId === "provClean" && cleanAlt[0].createsBetweenGap === false);

const reduced = api.rankProviderAssignments([
  makeDay({
    providerId: "provHole",
    lines: [
      line(10 * 60, 11 * 60, { providerId: "provHole" }),
      line(11 * 60 + 30, 12 * 60 + 30, { providerId: "provHole" })
    ]
  })
], {
  durationMinutes: 30,
  snapMinutes: 15,
  preferredStartMin: 11 * 60
});
check("closing a 30-minute hole reduces fragmentation", reduced[0] && reduced[0].fragmentationDelta < 0 && hasReason(reduced[0], "reduces_fragmentation"));

// ---------------------------------------------------------------------------
// GAP CLOSURE
// ---------------------------------------------------------------------------

const hole = makeDay({
  providerId: "provA",
  lines: [
    line(12 * 60, 13 * 60, { providerId: "provA" }),
    line(13 * 60 + 30, 14 * 60 + 30, { providerId: "provA" })
  ]
});
const closeGap = api.rankProviderAssignments([hole], {
  durationMinutes: 30,
  snapMinutes: 15,
  preferredStartMin: 13 * 60
});
check("exact between-gap fill sets closesExistingGap", closeGap[0] && closeGap[0].closesExistingGap === true && closeGap[0].startMin === 13 * 60);
check("exact fill does not create a between-gap", closeGap[0] && closeGap[0].createsBetweenGap === false);
check("closing an existing between-gap receives the +10 bonus", closeGap[0] && hasReason(closeGap[0], "closes_existing_gap") && deltaOf(closeGap[0], "closes_existing_gap") === 10);

const leadFill = api.rankProviderAssignments([
  makeDay({
    providerId: "provA",
    workingIntervals: [{ startMin: 9 * 60, endMin: 12 * 60 }],
    lines: [line(10 * 60, 12 * 60, { providerId: "provA" })]
  })
], {
  durationMinutes: 60,
  snapMinutes: 15,
  preferredStartMin: 9 * 60
});
check("leading fill is not closesExistingGap", leadFill[0] && leadFill[0].startMin === 9 * 60 && leadFill[0].closesExistingGap === false);

const trailFill = api.rankProviderAssignments([cleanA], {
  durationMinutes: 60,
  snapMinutes: 15,
  preferredStartMin: 11 * 60
});
check("trailing fill is not closesExistingGap", trailFill[0] && trailFill[0].closesExistingGap === false);

const resizeHost = makeDay({
  providerId: "provResize",
  lines: [
    line(9 * 60, 10 * 60, { providerId: "provResize" }),
    line(11 * 60, 12 * 60, { providerId: "provResize" })
  ]
});
const shrinkSide = api.rankProviderAssignments([resizeHost], {
  durationMinutes: 30,
  snapMinutes: 15,
  preferredStartMin: 10 * 60
});
check("shrinking 10:00-11:00 to 10:30-11:00 does not create a between-gap", shrinkSide[0] && shrinkSide[0].startMin === 10 * 60 && shrinkSide[0].createsBetweenGap === false);

const splitGap = api.rankProviderAssignments([resizeHost], {
  durationMinutes: 30,
  snapMinutes: 15,
  preferredStartMin: 10 * 60 + 15
});
check("splitting 10:00-11:00 into 10:00-10:15 and 10:45-11:00 creates a between-gap", splitGap[0] && splitGap[0].startMin === 10 * 60 + 15 && splitGap[0].createsBetweenGap === true);

const fromLeading = api.rankProviderAssignments([
  makeDay({
    providerId: "provLead",
    workingIntervals: [{ startMin: 9 * 60, endMin: 12 * 60 }],
    lines: [line(10 * 60, 12 * 60, { providerId: "provLead" })]
  })
], {
  durationMinutes: 30,
  snapMinutes: 15,
  preferredStartMin: 9 * 60 + 15
});
check("a between-gap created from former leading capacity is createsBetweenGap", fromLeading[0] && fromLeading[0].startMin === 9 * 60 + 15 && fromLeading[0].createsBetweenGap === true);

const fromTrailing = api.rankProviderAssignments([
  makeDay({
    providerId: "provTrail",
    workingIntervals: [{ startMin: 9 * 60, endMin: 12 * 60 }],
    lines: [line(9 * 60, 10 * 60, { providerId: "provTrail" })]
  })
], {
  durationMinutes: 30,
  snapMinutes: 15,
  preferredStartMin: 10 * 60 + 15
});
check("a between-gap created from former trailing capacity is createsBetweenGap", fromTrailing[0] && fromTrailing[0].startMin === 10 * 60 + 15 && fromTrailing[0].createsBetweenGap === true);

const lunchDay = makeDay({
  providerId: "provLunch",
  workingIntervals: [
    { startMin: 9 * 60, endMin: 12 * 60 },
    { startMin: 13 * 60, endMin: 18 * 60 }
  ],
  lines: [
    line(11 * 60, 12 * 60, { providerId: "provLunch" }),
    line(13 * 60, 14 * 60, { providerId: "provLunch" })
  ]
});
const lunchPlace = api.rankProviderAssignments([lunchDay], {
  durationMinutes: 60,
  snapMinutes: 15,
  preferredStartMin: 10 * 60
});
check("lunch / off-hours are never a created between-gap", lunchPlace[0] && lunchPlace[0].startMin === 10 * 60 && lunchPlace[0].createsBetweenGap === false && lunchPlace[0].betweenGapCountAfter === 0);

// ---------------------------------------------------------------------------
// UNDERUTILIZATION
// ---------------------------------------------------------------------------

check("0% utilized bonus is +5", emptyB && api.rankProviderAssignments([emptyB], atEleven60)[0].underutilizationBonus === 5);
const twenty = makeDay({
  providerId: "provU",
  workingIntervals: [{ startMin: 9 * 60, endMin: 14 * 60 }],
  lines: [line(9 * 60, 10 * 60, { providerId: "provU" })]
});
const twentyA = api.analyzeProviderDay(twenty);
check("fixture utilization is 20%", twentyA.utilizationPercent === 20);
const twentyPick = api.rankProviderAssignments([twenty], {
  durationMinutes: 60,
  snapMinutes: 15,
  preferredStartMin: 10 * 60
})[0];
check("20% utilized bonus is +4", twentyPick && twentyPick.underutilizationBonus === 4);

function bonusDay(occupiedEndMin, startMin) {
  const day = makeDay({
    providerId: "provBonus",
    workingIntervals: [{ startMin: 9 * 60, endMin: 14 * 60 }],
    lines: occupiedEndMin > 9 * 60 ? [line(9 * 60, occupiedEndMin, { providerId: "provBonus" })] : []
  });
  const ranked = api.rankProviderAssignments([day], {
    durationMinutes: 60,
    snapMinutes: 15,
    preferredStartMin: startMin
  });
  return ranked[0];
}
check("40% utilized bonus is +3", bonusDay(11 * 60, 11 * 60) && bonusDay(11 * 60, 11 * 60).underutilizationBonus === 3 && api.analyzeProviderDay(makeDay({
  workingIntervals: [{ startMin: 9 * 60, endMin: 14 * 60 }],
  lines: [line(9 * 60, 11 * 60)]
})).utilizationPercent === 40);
check("60% utilized bonus is +2", bonusDay(12 * 60, 12 * 60) && bonusDay(12 * 60, 12 * 60).underutilizationBonus === 2);
check("80% utilized bonus is +1", bonusDay(13 * 60, 13 * 60) && bonusDay(13 * 60, 13 * 60).underutilizationBonus === 1);

const equalEmpty = makeDay({ providerId: "provZ", workingIntervals: [morning], lines: [] });
const equalBusy = makeDay({
  providerId: "provY",
  workingIntervals: [morning],
  lines: [line(9 * 60, 9 * 60 + 36, { providerId: "provY" })]
});
// 36 minutes of 180 = 20%. Same preferred 11:00 60-min slot on both if the busy block ends before 11:00.
const equalFit = api.rankProviderAssignments([equalBusy, equalEmpty], atEleven60);
check("equal operational start can be broken by the modest underutilization bonus", equalFit[0] && equalFit.find(function (row) {
  return row.providerId === "provZ";
}) && equalFit.find(function (row) {
  return row.providerId === "provZ";
}).underutilizationBonus > equalFit.find(function (row) {
  return row.providerId === "provY";
}).underutilizationBonus);

// ---------------------------------------------------------------------------
// SPECIFIC / ANY PROVIDER
// ---------------------------------------------------------------------------

const specific = api.rankProviderAssignments([cleanA, emptyB], Object.assign({
  requestedProviderId: "provB"
}, atEleven60, { assignmentType: "specific_provider" }));
check("specific_provider evaluates only the requested provider", specific.length === 1 && specific[0].providerId === "provB");

check("specific_provider with no requestedProviderId returns no assignment", api.rankProviderAssignments([cleanA, emptyB], Object.assign({}, atEleven60, {
  assignmentType: "specific_provider"
})).length === 0);

check("specific_provider with a missing provider returns no assignment", api.rankProviderAssignments([cleanA], Object.assign({
  requestedProviderId: "provMissing"
}, atEleven60, { assignmentType: "specific_provider" })).length === 0);

check("recommend is null when specific provider is missing", api.recommendProviderAssignment([cleanA], {
  durationMinutes: 60,
  assignmentType: "specific_provider"
}) === null);

const anyRank = api.rankProviderAssignments([cleanA, emptyB], atEleven60);
check("any_provider does not apply requested-provider score weighting", anyRank.every(function (row) {
  return !hasReason(row, "requested_provider") && !hasReason(row, "other_than_requested");
}));
check("any_provider still ranks by operational fit", anyRank[0].providerId === "provA");

const ignoredRequest = api.rankProviderAssignments([cleanA, emptyB], Object.assign({
  requestedProviderId: "provB"
}, atEleven60));
check("requestedProviderId does not change any_provider ranking", ignoredRequest[0].providerId === "provA");

// ---------------------------------------------------------------------------
// BEST PER PROVIDER / PREFERRED START
// ---------------------------------------------------------------------------

const manySlots = api.rankProviderAssignmentCandidates([cleanA], {
  durationMinutes: 60,
  snapMinutes: 15
});
const oneBest = api.rankProviderAssignments([cleanA], {
  durationMinutes: 60,
  snapMinutes: 15
});
check("internal helper can return multiple slots for one provider", manySlots.length > 1);
check("main API returns only the best placement per provider", oneBest.length === 1);
check("best-per-provider row is the top internal candidate", oneBest[0].startMin === manySlots[0].startMin && oneBest[0].assignmentScore === manySlots[0].assignmentScore);

const exactOnly = api.rankProviderAssignments([cleanA], {
  durationMinutes: 60,
  snapMinutes: 15,
  preferredStartMin: 11 * 60
});
check("preferredStartMin evaluates exactly that start", exactOnly.length === 1 && exactOnly[0].startMin === 11 * 60);

const nearby = api.rankProviderAssignmentCandidates([cleanA], {
  durationMinutes: 60,
  snapMinutes: 15,
  preferredStartMin: 11 * 60,
  allowNearbyStarts: true
});
check("nearby alternatives stay off unless allowNearbyStarts is set", nearby.length > 1);

// ---------------------------------------------------------------------------
// OVERLAP
// ---------------------------------------------------------------------------

const overlapDay = makeDay({
  providerId: "provO",
  allowedOverlapMinutes: 15,
  lines: [line(12 * 60, 13 * 60, { providerId: "provO" })]
});
const overlapCandidates = api.rankProviderAssignmentCandidates([overlapDay], {
  durationMinutes: 30,
  snapMinutes: 15,
  allowNearbyStarts: true
});
const overlapFit = overlapCandidates.find(function (row) {
  return row.startMin === 12 * 60 + 45 && row.usesOverlap === true;
});
const freeFit = overlapCandidates.find(function (row) {
  return row.startMin === 13 * 60 && row.usesOverlap === false;
});
check("permitted overlap remains a valid assignment candidate", !!overlapFit);
check("assignment layer does not add another overlap score penalty", overlapFit && deltaOf(overlapFit, "uses_permitted_overlap") === 0);
check("true-free fit outranks an equivalent overlap fit", freeFit && overlapFit && (
  freeFit.assignmentScore > overlapFit.assignmentScore
  || (freeFit.assignmentScore === overlapFit.assignmentScore && api.compareAssignments(freeFit, overlapFit) < 0)
));

// ---------------------------------------------------------------------------
// SCORE FORMULA / REASONS
// ---------------------------------------------------------------------------

function expectedAssignmentScore(row) {
  function clamp(n, lo, hi) {
    n = Math.round(Number(n));
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }
  let raw = row.slotScore;
  raw += clamp(row.optimizationDelta, -15, 15);
  raw -= clamp(Math.max(0, row.fragmentationDelta), 0, 15);
  raw += clamp(Math.max(0, -row.fragmentationDelta), 0, 10);
  raw -= clamp(Math.max(0, row.strandedBetweenMinutesDelta), 0, 15);
  if (row.closesExistingGap) raw += 10;
  raw += row.underutilizationBonus;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

check("assignmentScore follows the Phase 4 day-impact formula", cleanPick && cleanPick.assignmentScore === expectedAssignmentScore(cleanPick));
check("assignment uses the optimization delta", cleanPick && cleanPick.optimizationDelta === cleanPick.optimizationAfter - cleanPick.optimizationBefore);
check("clean fit emits clean_calendar_fit", cleanPick && hasReason(cleanPick, "clean_calendar_fit"));
check("improves_day_optimization is present when the day improves", cleanPick.optimizationDelta > 0 && hasReason(cleanPick, "improves_day_optimization"));
check("assignmentLabel uses the Phase 1 bands", cleanPick.assignmentLabel === api.labelForScore(cleanPick.assignmentScore));

// ---------------------------------------------------------------------------
// DETERMINISM / PURITY
// ---------------------------------------------------------------------------

const beforeDays = JSON.stringify([cleanA, emptyB]);
api.rankProviderAssignments([cleanA, emptyB], atEleven60);
check("ranking does not mutate provider days", JSON.stringify([cleanA, emptyB]) === beforeDays);
check("assignment ranking is deterministic", JSON.stringify(cleanRank) === JSON.stringify(api.rankProviderAssignments([cleanA, emptyB], atEleven60)));
check("nobody available yields no assignments", api.rankProviderAssignments([], atEleven60).length === 0);
check("invalid duration yields no assignments", api.rankProviderAssignments([emptyB], { durationMinutes: 0 }).length === 0);

const src = fs.readFileSync(path.join(root, "public/booking/smart-scheduling/assign.js"), "utf8");
check("purity: no Firebase APIs", !/firebase-firestore|getDocs\s*\(|onSnapshot\s*\(|updateDoc\s*\(|addDoc\s*\(/.test(src));
check("purity: no network", !/\bfetch\s*\(|XMLHttpRequest/.test(src));
check("purity: no writes / timers / Date", !/\bsetTimeout\b|\bsetInterval\b|\bDate\s*\(|createAppointment|updateAppointment|cancelAppointment/.test(src));
check("purity: no DOM / Calendar / Reports", !/\bdocument\b|\blocalStorage\b|ffBookingCal|ffBookingReports/.test(src));
check("purity: no requested-provider score weighting", !/REQUESTED_MATCH|requested_provider|other_than_requested/.test(src));
check("purity: no catalog capability lookup", !/isProviderCapable|staffOverrides/.test(src));

if (failed) {
  console.error("FAILED", failed);
  process.exit(1);
}
console.log("All Smart Scheduling Phase 4 assignment tests passed.");
