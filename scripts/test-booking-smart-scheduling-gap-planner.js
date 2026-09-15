/**
 * Smart Scheduling Phase 8 general gap recovery planner.
 * No Firestore, DOM, Calendar, or Reports.
 * Usage: node scripts/test-booking-smart-scheduling-gap-planner.js
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
  "public/booking/smart-scheduling/gap-planner.js"
].forEach(function (rel) { load(rel, windowObj); });

const api = windowObj.ffBookingSmartScheduling;
if (!api || typeof api.planGapRecovery !== "function") {
  console.error("Smart Scheduling gap planner API did not load.");
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

function expectedActionScore(row) {
  var raw = 40;
  raw += Math.round((Number(row.gapRecoveryPercent) || 0) * 0.30);
  raw += clamp(row.optimizationDelta, -15, 15);
  raw -= clamp(Math.max(0, row.fragmentationDelta), 0, 15);
  raw += clamp(Math.max(0, -row.fragmentationDelta), 0, 10);
  raw -= clamp(Math.max(0, row.strandedBetweenMinutesDelta), 0, 15);
  raw -= Number(row.disruptionPenalty) || 0;
  raw -= Number(row.overlapPenalty) || 0;
  return clamp(raw, 0, 100);
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

function betweenGap(day, startMin, endMin) {
  return (api.findFreeGaps(day) || []).find(function (gap) {
    return gap.kind === "between" && gap.startMin === startMin && gap.endMin === endMin;
  });
}

function actionsOf(plan) {
  return [plan.primaryAction].concat(plan.alternatives || []).filter(Boolean);
}

function ids(plan) {
  return actionsOf(plan).map(function (row) { return row.actionId; });
}

check("public gap planner API loaded", !!(
  api.planGapRecovery && api.planProviderDayGapRecoveries && api.compareGapActions && api.GAP_PLAN
));

const snapshotDay = makeDay({
  lines: [
    line(12 * 60, 13 * 60, { lineId: "client-a", appointmentId: "appt-a" }),
    line(13 * 60 + 30, 14 * 60 + 30, { lineId: "client-b", appointmentId: "appt-b" })
  ]
});
const snapshotJson = JSON.stringify(snapshotDay);

// ---------------------------------------------------------------------------
// CORE GAP — 12:00-1:00 A, 1:00-1:30 gap, 1:30-2:30 B
// ---------------------------------------------------------------------------

const coreDay = makeDay({
  lines: [
    line(12 * 60, 13 * 60, { lineId: "client-a", appointmentId: "appt-a" }),
    line(13 * 60 + 30, 14 * 60 + 30, { lineId: "client-b", appointmentId: "appt-b" })
  ]
});
const coreGap = betweenGap(coreDay, 13 * 60, 13 * 60 + 30);
check("core between-gap is the 1:00-1:30 hole", !!(coreGap && coreGap.gapMin === 30 && coreGap.kind === "between"), coreGap);

const coreMovesOnly = api.planGapRecovery(coreDay, coreGap, []);
const coreMoveActions = actionsOf(coreMovesOnly).filter(function (row) {
  return row.type === "move_existing_appointment";
});
const moveB = coreMoveActions.find(function (row) {
  return row.appointmentId === "appt-b" && row.direction === "earlier";
});
const moveA = coreMoveActions.find(function (row) {
  return row.appointmentId === "appt-a" && row.direction === "later";
});
check("B earlier can recover the core gap", !!(moveB && moveB.gapRecoveredMinutes === 30 && moveB.moveMinutes === 30), moveB);
check("A later can recover the core gap when valid", !!(moveA && moveA.gapRecoveredMinutes === 30 && moveA.moveMinutes === 30), moveA);
check(
  "best core action is selected deterministically",
  coreMovesOnly.primaryAction
    && (coreMovesOnly.primaryAction.appointmentId === "appt-a" || coreMovesOnly.primaryAction.appointmentId === "appt-b")
    && coreMovesOnly.primaryAction.gapRecoveryPercent === 100
    && JSON.stringify(ids(coreMovesOnly)) === JSON.stringify(ids(api.planGapRecovery(coreDay, coreGap, []))),
  coreMovesOnly.primaryAction
);
check("core move uses Phase 2 source score", coreMovesOnly.primaryAction.sourceScoreName === "scoreImprovement");
check("no cancellation descriptor is required", coreMovesOnly.valid === true && coreMovesOnly.gapIdentity === "0|780|810");

// ---------------------------------------------------------------------------
// WAITLIST — exact fill competes; all Phase 6 placements scored; one per id
// ---------------------------------------------------------------------------

const waitPlan = api.planGapRecovery(coreDay, coreGap, [
  waitReq({ waitlistId: "wl-exact-30", durationMinutes: 30 })
]);
check(
  "exact-fill waitlist competes against the move",
  waitPlan.primaryAction
    && (waitPlan.primaryAction.type === "fill_from_waitlist" || (waitPlan.alternatives || []).some(function (row) {
      return row.type === "fill_from_waitlist" && row.waitlistId === "wl-exact-30";
    })),
  waitPlan.primaryAction
);

const splitOpening = { startMin: 13 * 60, endMin: 13 * 60 + 30 };
const splitReq = waitReq({
  waitlistId: "wl-split",
  durationMinutes: 15,
  preferredStartMin: 13 * 60 + 15,
  flexibilityMinutes: 15
});
const splitCands = api.rankWaitlistMatchCandidates(coreDay, splitOpening, [splitReq]);
const splitQualified = splitCands.filter(function (row) { return row.waitlistMatchScore >= 20; });
const splitPhase6 = api.rankWaitlistMatches(coreDay, splitOpening, [splitReq], { minimumWaitlistMatchScore: 20 })[0];
const splitPlan = api.planGapRecovery(coreDay, coreGap, [splitReq], { minimumWaitlistMatchScore: 20, maxMoveMinutes: 0 });
const splitWait = actionsOf(splitPlan).filter(function (row) { return row.waitlistId === "wl-split"; });
check("split request has more than one Phase 6-qualified start", splitQualified.length > 1, splitQualified.map(function (row) {
  return row.candidateStartMin + ":" + row.waitlistMatchScore;
}));
check(
  "Phase 8 keeps one best action-level placement per waitlistId",
  splitWait.length === 1 && splitPlan.primaryAction.waitlistId === "wl-split",
  splitWait.map(function (row) { return row.actionId; })
);
check(
  "alternatives do not repeat that waitlistId",
  (splitPlan.alternatives || []).every(function (row) { return row.waitlistId !== "wl-split"; })
);
check(
  "Phase 8 can choose a different start than Phase 6's one-best match",
  splitPhase6 && splitWait[0]
    && splitPhase6.candidateStartMin === 13 * 60 + 15
    && splitWait[0].candidateStartMin === 13 * 60,
  { phase6: splitPhase6 && splitPhase6.candidateStartMin, phase8: splitWait[0] && splitWait[0].candidateStartMin }
);

// ---------------------------------------------------------------------------
// MOVE VS WAITLIST
// ---------------------------------------------------------------------------

check(
  "exact waitlist fill beats a 30-minute existing-client move",
  waitPlan.primaryAction
    && waitPlan.primaryAction.type === "fill_from_waitlist"
    && waitPlan.primaryAction.clientDisruptionMinutes === 0
    && waitPlan.primaryAction.gapRecoveryPercent === 100
    && (waitPlan.alternatives || []).some(function (row) {
      return row.type === "move_existing_appointment" && row.clientDisruptionMinutes === 30;
    }),
  waitPlan.primaryAction
);

const smallMoveDay = makeDay({
  lines: [
    line(12 * 60, 13 * 60, { lineId: "slide-a", appointmentId: "slide-a" }),
    line(13 * 60 + 15, 14 * 60 + 15, { lineId: "slide-b", appointmentId: "slide-b" })
  ]
});
const smallGap = betweenGap(smallMoveDay, 13 * 60, 13 * 60 + 15);
const smallPlan = api.planGapRecovery(smallMoveDay, smallGap, [
  waitReq({ waitlistId: "wl-too-long", durationMinutes: 45 })
]);
check(
  "small 15-minute move can win when waitlist cannot fit",
  smallPlan.primaryAction
    && smallPlan.primaryAction.type === "move_existing_appointment"
    && smallPlan.primaryAction.moveMinutes === 15
    && smallPlan.primaryAction.gapRecoveryPercent === 100,
  smallPlan.primaryAction
);

// ---------------------------------------------------------------------------
// TARGET GAP ONLY
// ---------------------------------------------------------------------------

const twoGapDay = makeDay({
  workingIntervals: [
    { startMin: 9 * 60, endMin: 12 * 60 + 30 },
    { startMin: 15 * 60, endMin: 18 * 60 }
  ],
  lines: [
    line(10 * 60, 11 * 60, { lineId: "g1-a", appointmentId: "g1-a" }),
    line(11 * 60 + 30, 12 * 60 + 30, { lineId: "g1-b", appointmentId: "g1-b" }),
    line(15 * 60, 16 * 60, { lineId: "g2-a", appointmentId: "g2-a" }),
    line(16 * 60 + 30, 17 * 60 + 30, { lineId: "g2-b", appointmentId: "g2-b" })
  ]
});
const gapOne = betweenGap(twoGapDay, 11 * 60, 11 * 60 + 30);
const gapTwo = betweenGap(twoGapDay, 16 * 60, 16 * 60 + 30);
const planOne = api.planGapRecovery(twoGapDay, gapOne, []);
check("unrelated afternoon move is omitted from the morning gap plan", actionsOf(planOne).every(function (row) {
  return row.type !== "move_existing_appointment" || (row.appointmentId !== "g2-a" && row.appointmentId !== "g2-b");
}), ids(planOne));
check("every actionable result recovers the target gap", actionsOf(planOne).filter(function (row) {
  return row.type === "move_existing_appointment" || row.type === "fill_from_waitlist";
}).every(function (row) { return row.gapRecoveredMinutes > 0; }));

const outsideWait = api.planGapRecovery(coreDay, coreGap, [
  waitReq({ waitlistId: "wl-outside", durationMinutes: 30, preferredStartMin: 10 * 60, flexibilityMinutes: 0 })
], { maxMoveMinutes: 0 });
check(
  "waitlist placement outside the target gap is omitted",
  outsideWait.primaryAction.type !== "fill_from_waitlist",
  outsideWait.primaryAction
);

// ---------------------------------------------------------------------------
// PARTIAL / FULL RECOVERY
// ---------------------------------------------------------------------------

const partialDay = makeDay({
  lines: [
    line(12 * 60, 13 * 60, { lineId: "par-a", appointmentId: "par-a" }),
    line(13 * 60 + 30, 13 * 60 + 45, { lineId: "par-short", appointmentId: "par-short" })
  ]
});
const partialGap = betweenGap(partialDay, 13 * 60, 13 * 60 + 30);
const partialPlan = api.planGapRecovery(partialDay, partialGap, [
  waitReq({ waitlistId: "wl-15", durationMinutes: 15 })
], { minimumWaitlistMatchScore: 20, maxMoveMinutes: 0 });
check(
  "15 minutes recovered from a 30-minute gap is 50%",
  partialPlan.primaryAction
    && partialPlan.primaryAction.gapRecoveredMinutes === 15
    && partialPlan.primaryAction.gapRecoveryPercent === 50
    && hasReason(partialPlan.primaryAction, "partially_recovers_gap"),
  partialPlan.primaryAction
);
check(
  "full recovery is 100%",
  waitPlan.primaryAction.gapRecoveredMinutes === 30 && waitPlan.primaryAction.gapRecoveryPercent === 100
    && hasReason(waitPlan.primaryAction, "fully_recovers_gap")
);

// ---------------------------------------------------------------------------
// FALLBACK
// ---------------------------------------------------------------------------

const isolatedDay = makeDay({
  lines: [line(12 * 60, 13 * 60, { lineId: "iso-a", appointmentId: "iso-a" })]
});
const trailing = (api.findFreeGaps(isolatedDay) || []).find(function (gap) {
  return gap.kind === "trailing" && gap.startMin === 13 * 60;
});
const openBetweenDay = makeDay({
  lines: [
    line(10 * 60, 11 * 60, { lineId: "iso-left", appointmentId: "iso-left" }),
    line(16 * 60, 17 * 60, { lineId: "iso-right", appointmentId: "iso-right" })
  ]
});
const wideGap = betweenGap(openBetweenDay, 11 * 60, 16 * 60);
const openPlan = api.planGapRecovery(openBetweenDay, wideGap, [], { maxMoveMinutes: 0 });
check(
  "usable gap + no qualifying action => open_gap_opportunity",
  openPlan.primaryAction && openPlan.primaryAction.type === "open_gap_opportunity"
    && openPlan.primaryAction.actionScore === 0
    && hasReason(openPlan.primaryAction, "open_gap_fallback"),
  openPlan.primaryAction
);

const tinyDay = makeDay({
  lines: [
    line(12 * 60, 13 * 60, { lineId: "tiny-a", appointmentId: "tiny-a" }),
    line(13 * 60 + 15, 14 * 60, { lineId: "tiny-b", appointmentId: "tiny-b" })
  ]
});
const tinyGap = betweenGap(tinyDay, 13 * 60, 13 * 60 + 15);
const tinyPlan = api.planGapRecovery(tinyDay, tinyGap, [], { maxMoveMinutes: 0 });
check(
  "tiny stranded gap => no_action",
  tinyPlan.primaryAction && tinyPlan.primaryAction.type === "no_action"
    && hasReason(tinyPlan.primaryAction, "gap_too_small"),
  tinyPlan.primaryAction
);

// ---------------------------------------------------------------------------
// STALE GAP
// ---------------------------------------------------------------------------

const stale = api.planGapRecovery(coreDay, {
  workingIntervalIndex: 0,
  startMin: 15 * 60,
  endMin: 15 * 60 + 30,
  gapMin: 30,
  kind: "between"
}, []);
check(
  "supplied gap that no longer exists => no recovery planning",
  stale.primaryAction && stale.primaryAction.type === "no_action"
    && stale.valid === false
    && hasReason(stale.primaryAction, "invalid_gap"),
  stale.primaryAction
);

// ---------------------------------------------------------------------------
// DAY PLANNER
// ---------------------------------------------------------------------------

const dayPlans = api.planProviderDayGapRecoveries(twoGapDay, []);
check("one plan per between-gap", dayPlans.length === 2, dayPlans.length);
check("leading/trailing gaps are not primary recovery targets", dayPlans.every(function (row) {
  return row.gap && row.gap.kind === "between";
}));
check("plans are ranked by operational importance", dayPlans[0].gapPriorityScore >= dayPlans[1].gapPriorityScore);
check("independent plans are documented", dayPlans.independentPlans === true && dayPlans.every(function (row) {
  return row.independent === true;
}));
check("same appointment may appear in separate gap plans without global resolution", (function () {
  const idsA = actionsOf(dayPlans[0].plan).map(function (row) { return row.appointmentId; }).filter(Boolean);
  const idsB = actionsOf(dayPlans[1].plan).map(function (row) { return row.appointmentId; }).filter(Boolean);
  return idsA.length > 0 && idsB.length > 0 && idsA.every(function (id) { return idsB.indexOf(id) === -1 || true; });
})());

const leadTrailDay = makeDay({
  lines: [line(10 * 60, 11 * 60, { lineId: "mid", appointmentId: "mid" })]
});
const leadTrailPlans = api.planProviderDayGapRecoveries(leadTrailDay, []);
check("empty-of-between day yields no between-gap plans", leadTrailPlans.length === 0, leadTrailPlans.length);

const mixedDay = makeDay({
  lines: [
    line(10 * 60, 11 * 60, { lineId: "lead-busy", appointmentId: "lead-busy" }),
    line(11 * 60 + 30, 12 * 60, { lineId: "mid-busy", appointmentId: "mid-busy" })
  ]
});
const mixedPlans = api.planProviderDayGapRecoveries(mixedDay, []);
check("day planner ignores leading leftover next to a between-gap", mixedPlans.length === 1 && mixedPlans[0].gap.startMin === 11 * 60, mixedPlans.map(function (row) {
  return row.gap && row.gap.kind + ":" + row.gap.startMin;
}));

// ---------------------------------------------------------------------------
// OVERLAP
// ---------------------------------------------------------------------------

const overlapDay = makeDay({
  allowedOverlapMinutes: 15,
  lines: [
    line(12 * 60, 13 * 60, { lineId: "ov-a", appointmentId: "ov-a" }),
    line(14 * 60, 15 * 60, { lineId: "ov-c", appointmentId: "ov-c" })
  ]
});
const overlapGap = betweenGap(overlapDay, 13 * 60, 14 * 60);
const overlapPlan = api.planGapRecovery(overlapDay, overlapGap, [
  waitReq({ waitlistId: "wl-clean-60", durationMinutes: 60 })
]);
const cleanAction = actionsOf(overlapPlan).find(function (row) {
  return row.usesOverlap === false && row.gapRecoveredMinutes === 60;
});
const overlapAction = actionsOf(overlapPlan).find(function (row) { return row.usesOverlap === true; });
check("overlap does not invent free time in the target gap", overlapGap && overlapGap.gapMin === 60);
check(
  "clean action beats an equivalent permitted-overlap action when both exist",
  !overlapAction || (cleanAction && cleanAction.actionScore > overlapAction.actionScore),
  { clean: cleanAction && cleanAction.actionScore, overlap: overlapAction && overlapAction.actionScore }
);
check(
  "Phase 8 overlap penalty is 5 and applied once",
  !overlapAction || (
    overlapAction.overlapPenalty === 5
    && overlapAction.actionScore === expectedActionScore(overlapAction)
  ),
  overlapAction
);

// ---------------------------------------------------------------------------
// SCORE FORMULA / REASONS / PURITY
// ---------------------------------------------------------------------------

check("actionScore follows the Phase 8 formula", waitPlan.primaryAction.actionScore === expectedActionScore(waitPlan.primaryAction), {
  got: waitPlan.primaryAction.actionScore,
  expected: expectedActionScore(waitPlan.primaryAction)
});
check("waitlist disruption is 0", waitPlan.primaryAction.clientDisruptionMinutes === 0 && waitPlan.primaryAction.disruptionPenalty === 0);
check("30-minute move disruption penalty is 6", (waitPlan.alternatives || []).some(function (row) {
  return row.type === "move_existing_appointment" && row.clientDisruptionMinutes === 30 && row.disruptionPenalty === 6;
}));
check("fills_gap_from_waitlist reason", hasReason(waitPlan.primaryAction, "fills_gap_from_waitlist"));
check("avoids_moving_existing_client reason", hasReason(waitPlan.primaryAction, "avoids_moving_existing_client"));
check("requires_client_move on a move", hasReason(moveB || coreMovesOnly.primaryAction, "requires_client_move"));
check("original day is not mutated", JSON.stringify(coreDay) === snapshotJson && JSON.stringify(snapshotDay) === snapshotJson);

const detA = api.planGapRecovery(coreDay, coreGap, [waitReq({ waitlistId: "wl-a", durationMinutes: 30 })]);
const detB = api.planGapRecovery(coreDay, coreGap, [waitReq({ waitlistId: "wl-a", durationMinutes: 30 })]);
check("same input yields the same output", JSON.stringify(ids(detA)) === JSON.stringify(ids(detB)) && JSON.stringify(detA.primaryAction) === JSON.stringify(detB.primaryAction));

const src = fs.readFileSync(path.join(root, "public/booking/smart-scheduling/gap-planner.js"), "utf8");
check("purity: no Firebase APIs", !/firebase-firestore|getDocs\s*\(|onSnapshot\s*\(|updateDoc\s*\(|addDoc\s*\(/.test(src));
check("purity: no network", !/\bfetch\s*\(|XMLHttpRequest/.test(src));
check("purity: no writes / timers / Date", !/\bsetTimeout\b|\bsetInterval\b|\bDate\s*\(|createAppointment|updateAppointment|cancelAppointment/.test(src));
check("purity: no DOM / Calendar / Reports", !/\bdocument\b|\blocalStorage\b|ffBookingCal|ffBookingReports/.test(src));
check("purity: no messaging / booking", !/sendSms|sendEmail|twilio|mailer|bookClient|autoBook|acceptLink/i.test(src));
check("purity: does not call Phase 7 cancellation planner", !/planCancellationRecovery|analyzeCancellationRecovery/.test(src));

if (failed) {
  console.log("\n" + failed + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll gap planner checks passed.");
