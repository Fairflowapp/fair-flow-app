/**
 * Smart Scheduling Phase 7 recovery action planner. No Firestore, DOM, Calendar, or Reports.
 * Usage: node scripts/test-booking-smart-scheduling-recovery-planner.js
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
  "public/booking/smart-scheduling/recovery-planner.js"
].forEach(function (rel) { load(rel, windowObj); });

const api = windowObj.ffBookingSmartScheduling;
if (!api || typeof api.planCancellationRecovery !== "function") {
  console.error("Smart Scheduling recovery planner API did not load.");
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
  raw += Math.round((Number(row.openingRecoveryPercent) || 0) * 0.30);
  raw += clamp(row.optimizationDeltaFromPostCancellation, -15, 15);
  raw -= clamp(Math.max(0, row.fragmentationDeltaFromPostCancellation), 0, 15);
  raw += clamp(Math.max(0, -row.fragmentationDeltaFromPostCancellation), 0, 10);
  raw -= clamp(Math.max(0, row.strandedBetweenMinutesDeltaFromPostCancellation), 0, 15);
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

function cancelOf(startMin, endMin, extra) {
  return Object.assign({
    appointmentId: "cancelled-" + startMin,
    lineId: "cancelled-" + startMin,
    providerId: "provA",
    startMin: startMin,
    endMin: endMin,
    durationMinutes: endMin - startMin
  }, extra || {});
}

function waitReq(partial) {
  return Object.assign({
    waitlistId: "wl-default",
    clientId: "client-1",
    durationMinutes: 60,
    assignmentType: "any_provider",
    createdAtOrder: 1
  }, partial || {});
}

function hasReason(row, code) {
  return (row && row.reasons || []).some(function (item) { return item.code === code; });
}

function types(plan) {
  return [plan.primaryAction && plan.primaryAction.type].concat(
    (plan.alternatives || []).map(function (row) { return row.type; })
  );
}

function ids(plan) {
  return [plan.primaryAction && plan.primaryAction.actionId].concat(
    (plan.alternatives || []).map(function (row) { return row.actionId; })
  );
}

check("public planner API loaded", !!(api.planCancellationRecovery && api.compareRecoveryActions && api.PLAN));

const snapshotDay = makeDay({
  lines: [
    line(10 * 60, 11 * 60, { lineId: "keep-a", appointmentId: "keep-a" }),
    line(12 * 60, 13 * 60, { lineId: "keep-c", appointmentId: "keep-c" })
  ]
});
const snapshotJson = JSON.stringify(snapshotDay);

// ---------------------------------------------------------------------------
// MOVE WINS
// A 15-minute between-gap is closed by a 15-minute existing-client slide.
// A 45-minute waitlist cannot fit that opening.
// A 30-minute between-gap plus a 15-minute waitlist (stranded remainder)
// keeps the closing move first when that waitlist is allowed through.
// ---------------------------------------------------------------------------

const moveWinAfter = makeDay({
  lines: [
    line(12 * 60, 13 * 60, { lineId: "slide-a", appointmentId: "slide-a" }),
    line(13 * 60 + 15, 14 * 60 + 15, { lineId: "slide-b", appointmentId: "slide-b" })
  ]
});
const moveWinCancel = cancelOf(13 * 60, 13 * 60 + 15);
const moveWinPlan = api.planCancellationRecovery(moveWinAfter, moveWinCancel, [
  waitReq({ waitlistId: "wl-too-long-45", durationMinutes: 45, createdAtOrder: 1 })
]);

check(
  "move wins: primary is move_existing_appointment",
  moveWinPlan.primaryAction && moveWinPlan.primaryAction.type === "move_existing_appointment",
  types(moveWinPlan)
);
check(
  "move wins: 15-minute move closes full cancellation capacity",
  moveWinPlan.primaryAction
    && moveWinPlan.primaryAction.moveMinutes === 15
    && moveWinPlan.primaryAction.openingRecoveredMinutes === 15
    && moveWinPlan.primaryAction.openingRecoveryPercent === 100,
  moveWinPlan.primaryAction
);
check("move wins: requires_client_move reason", hasReason(moveWinPlan.primaryAction, "requires_client_move"));
check("move wins: recovers_all_cancelled_capacity", hasReason(moveWinPlan.primaryAction, "recovers_all_cancelled_capacity"));
check("move wins: best_available_recovery", hasReason(moveWinPlan.primaryAction, "best_available_recovery"));

const strandedAltAfter = makeDay({
  lines: [
    line(12 * 60, 13 * 60, { lineId: "gap-a", appointmentId: "gap-a" }),
    line(13 * 60 + 30, 14 * 60 + 30, { lineId: "gap-b", appointmentId: "gap-b" })
  ]
});
const strandedAltCancel = cancelOf(13 * 60, 13 * 60 + 30);
const strandedAltPlan = api.planCancellationRecovery(strandedAltAfter, strandedAltCancel, [
  waitReq({ waitlistId: "wl-stranded-15", durationMinutes: 15, createdAtOrder: 1 })
], { minimumWaitlistMatchScore: 20 });
check(
  "move wins: waitlist alternative exists and leaves stranded remainder",
  strandedAltPlan.primaryAction
    && strandedAltPlan.primaryAction.type === "move_existing_appointment"
    && strandedAltPlan.primaryAction.openingRecoveryPercent === 100
    && (strandedAltPlan.alternatives || []).some(function (row) {
      return row.type === "fill_from_waitlist"
        && row.waitlistId === "wl-stranded-15"
        && row.leavesStrandedOpeningRemainder === true;
    }),
  {
    primary: strandedAltPlan.primaryAction && strandedAltPlan.primaryAction.type,
    alts: (strandedAltPlan.alternatives || []).map(function (row) {
      return { type: row.type, id: row.waitlistId, strand: row.leavesStrandedOpeningRemainder };
    })
  }
);

// ---------------------------------------------------------------------------
// WAITLIST WINS
// 60-minute hole between two packed appointments. A 60-minute existing
// move would recover it, but a waitlist exact-fill does so without disruption.
// ---------------------------------------------------------------------------

const waitWinAfter = makeDay({
  lines: [
    line(10 * 60, 11 * 60, { lineId: "pack-a", appointmentId: "pack-a" }),
    line(12 * 60, 13 * 60, { lineId: "pack-b", appointmentId: "pack-b" })
  ]
});
const waitWinCancel = cancelOf(11 * 60, 12 * 60);
const waitWinPlan = api.planCancellationRecovery(waitWinAfter, waitWinCancel, [
  waitReq({ waitlistId: "wl-exact-60", durationMinutes: 60, createdAtOrder: 9 })
]);

check(
  "waitlist wins: primary is fill_from_waitlist",
  waitWinPlan.primaryAction && waitWinPlan.primaryAction.type === "fill_from_waitlist",
  types(waitWinPlan)
);
check(
  "waitlist wins against a 60-minute existing-client move",
  waitWinPlan.primaryAction
    && waitWinPlan.primaryAction.waitlistId === "wl-exact-60"
    && waitWinPlan.primaryAction.clientDisruptionMinutes === 0
    && waitWinPlan.primaryAction.openingRecoveryPercent === 100
    && (waitWinPlan.alternatives || []).some(function (row) {
      return row.type === "move_existing_appointment" && row.clientDisruptionMinutes === 60;
    }),
  {
    primary: waitWinPlan.primaryAction && {
      type: waitWinPlan.primaryAction.type,
      score: waitWinPlan.primaryAction.actionScore,
      recovered: waitWinPlan.primaryAction.openingRecoveredMinutes
    },
    alts: (waitWinPlan.alternatives || []).map(function (row) {
      return { type: row.type, score: row.actionScore, disrupt: row.clientDisruptionMinutes };
    })
  }
);
check("waitlist wins: avoids_moving_existing_client", hasReason(waitWinPlan.primaryAction, "avoids_moving_existing_client"));

// ---------------------------------------------------------------------------
// FULL RECOVERY — both recover 100%; disruption / calendar decide
// ---------------------------------------------------------------------------

const fullAfter = makeDay({
  lines: [
    line(12 * 60, 13 * 60, { lineId: "full-a", appointmentId: "full-a" }),
    line(13 * 60 + 15, 14 * 60 + 15, { lineId: "full-b", appointmentId: "full-b" })
  ]
});
const fullCancel = cancelOf(13 * 60, 13 * 60 + 15);
const fullPlan = api.planCancellationRecovery(fullAfter, fullCancel, [
  waitReq({ waitlistId: "wl-full-15", durationMinutes: 15 })
]);
const fullPrimary = fullPlan.primaryAction;
const fullAlt = (fullPlan.alternatives || []).find(function (row) {
  return row.type !== fullPrimary.type;
});
check(
  "full recovery: both actionable types recover 100%",
  fullPrimary && fullPrimary.openingRecoveryPercent === 100
    && fullAlt && fullAlt.openingRecoveryPercent === 100,
  { primary: fullPrimary, alt: fullAlt }
);
check(
  "full recovery: lower disruption wins when recovery is equal",
  fullPrimary
    && fullPrimary.type === "fill_from_waitlist"
    && fullPrimary.clientDisruptionMinutes === 0
    && fullAlt && fullAlt.clientDisruptionMinutes === 15,
  types(fullPlan)
);

// ---------------------------------------------------------------------------
// PARTIAL RECOVERY
// ---------------------------------------------------------------------------

const partialAfter = makeDay({
  lines: [
    line(10 * 60, 11 * 60, { lineId: "par-a", appointmentId: "par-a" }),
    line(13 * 60, 14 * 60, { lineId: "par-c", appointmentId: "par-c" })
  ]
});
const partialCancel = cancelOf(11 * 60, 12 * 60);
const partialPlan = api.planCancellationRecovery(partialAfter, partialCancel, [
  waitReq({ waitlistId: "wl-30", durationMinutes: 30, createdAtOrder: 1 }),
  waitReq({ waitlistId: "wl-15", durationMinutes: 15, createdAtOrder: 2 })
]);
const recoveredById = {};
[partialPlan.primaryAction].concat(partialPlan.alternatives || []).forEach(function (row) {
  if (row && row.waitlistId) recoveredById[row.waitlistId] = row.openingRecoveredMinutes;
});
check(
  "partial recovery: 30-minute waitlist recovers more cancelled capacity than 15",
  recoveredById["wl-30"] > recoveredById["wl-15"]
    && recoveredById["wl-30"] === 30
    && recoveredById["wl-15"] === 15,
  recoveredById
);
check(
  "partial recovery: greater true newly-freed recovery ranks first among waitlist options",
  partialPlan.primaryAction
    && (partialPlan.primaryAction.waitlistId === "wl-30"
      || partialPlan.primaryAction.openingRecoveredMinutes >= 30),
  partialPlan.primaryAction
);

// ---------------------------------------------------------------------------
// TRUE CANCELLATION CAPACITY
// ---------------------------------------------------------------------------

const mergeAfter = makeDay({
  lines: [
    line(10 * 60, 11 * 60, { lineId: "m-a", appointmentId: "m-a" }),
    line(12 * 60, 13 * 60, { lineId: "m-c", appointmentId: "m-c" })
  ]
});
const mergeCancel = cancelOf(11 * 60, 11 * 60 + 30);
const mergePlan = api.planCancellationRecovery(mergeAfter, mergeCancel, [
  waitReq({ waitlistId: "wl-merge-60", durationMinutes: 60 })
]);
const mergeWait = [mergePlan.primaryAction].concat(mergePlan.alternatives || []).find(function (row) {
  return row && row.waitlistId === "wl-merge-60";
});
check(
  "true capacity: pre-existing adjacent free time is not counted as cancellation recovery",
  mergeWait
    && mergeWait.openingRecoveredMinutes === 30
    && mergeWait.openingRecoveryPercent === 100
    && mergePlan.cancellationAnalysis.newlyFreedMinutes === 30
    && mergePlan.cancellationAnalysis.cancelledDurationMinutes === 30
    && mergePlan.opening && mergePlan.opening.minutes === 60,
  mergeWait
);

const overlapAfter = makeDay({
  allowedOverlapMinutes: 30,
  lines: [line(13 * 60, 14 * 60, { lineId: "ov-survive", appointmentId: "ov-a" })]
});
const overlapCancel = cancelOf(13 * 60 + 30, 14 * 60 + 30, { appointmentId: "ov-b", lineId: "ov-b" });
const overlapPlan = api.planCancellationRecovery(overlapAfter, overlapCancel, [
  waitReq({ waitlistId: "wl-ov-60", durationMinutes: 60 })
]);
const overlapWait = [overlapPlan.primaryAction].concat(overlapPlan.alternatives || []).find(function (row) {
  return row && row.waitlistId === "wl-ov-60";
});
check(
  "true capacity: surviving overlap does not invent recovered minutes",
  overlapPlan.cancellationAnalysis.newlyFreedMinutes === 30
    && (!overlapWait || overlapWait.openingRecoveredMinutes <= 30),
  overlapWait
);

// ---------------------------------------------------------------------------
// SOURCE THRESHOLDS
// ---------------------------------------------------------------------------

const thresholdAfter = makeDay({
  lines: [
    line(10 * 60, 11 * 60, { lineId: "th-a", appointmentId: "th-a" }),
    line(12 * 60, 13 * 60, { lineId: "th-b", appointmentId: "th-b" })
  ]
});
const thresholdCancel = cancelOf(11 * 60, 12 * 60);
const noResurrectMove = api.planCancellationRecovery(thresholdAfter, thresholdCancel, [
  waitReq({ waitlistId: "wl-keep", durationMinutes: 60 })
], { minimumRecoveryScore: 101 });
check(
  "rejected Phase 5 move is not resurrected",
  noResurrectMove.primaryAction
    && noResurrectMove.primaryAction.type === "fill_from_waitlist"
    && (noResurrectMove.alternatives || []).every(function (row) { return row.type !== "move_existing_appointment"; }),
  types(noResurrectMove)
);

const noResurrectWait = api.planCancellationRecovery(thresholdAfter, thresholdCancel, [
  waitReq({ waitlistId: "wl-low", durationMinutes: 60 })
], { minimumWaitlistMatchScore: 101, maxMoveMinutes: 0 });
check(
  "waitlist below Phase 6 threshold is not resurrected",
  noResurrectWait.primaryAction
    && noResurrectWait.primaryAction.type !== "fill_from_waitlist"
    && (noResurrectWait.alternatives || []).every(function (row) { return row.type !== "fill_from_waitlist"; }),
  types(noResurrectWait)
);

// ---------------------------------------------------------------------------
// OPEN FILL FALLBACK
// ---------------------------------------------------------------------------

const openFillAfter = makeDay({
  lines: [line(9 * 60, 17 * 60, { lineId: "all-day", appointmentId: "all-day" })]
});
const openFillCancel = cancelOf(17 * 60, 18 * 60);
const openFillPlan = api.planCancellationRecovery(openFillAfter, openFillCancel, [], { maxMoveMinutes: 0 });
check(
  "no qualifying move/waitlist + usable capacity -> open_fill_opportunity",
  openFillPlan.primaryAction && openFillPlan.primaryAction.type === "open_fill_opportunity"
    && openFillPlan.primaryAction.actionScore === 0,
  openFillPlan.primaryAction
);
check("open fill identity is deterministic", openFillPlan.primaryAction && openFillPlan.primaryAction.actionId === "open_fill|provA|" + (17 * 60) + "|" + (18 * 60));

const tinyAfter = makeDay({
  lines: [
    line(12 * 60, 13 * 60, { lineId: "tiny-a", appointmentId: "tiny-a" }),
    line(13 * 60 + 15, 14 * 60, { lineId: "tiny-b", appointmentId: "tiny-b" })
  ]
});
const tinyCancel = cancelOf(13 * 60, 13 * 60 + 15);
const tinyPlan = api.planCancellationRecovery(tinyAfter, tinyCancel, [], { maxMoveMinutes: 0 });
check(
  "unusable capacity -> no_action",
  tinyPlan.primaryAction && tinyPlan.primaryAction.type === "no_action" && tinyPlan.primaryAction.actionScore === 0,
  tinyPlan.primaryAction
);

// ---------------------------------------------------------------------------
// ALTERNATIVES
// ---------------------------------------------------------------------------

const altPlan = api.planCancellationRecovery(waitWinAfter, waitWinCancel, [
  waitReq({ waitlistId: "wl-a", durationMinutes: 60, createdAtOrder: 1 }),
  waitReq({ waitlistId: "wl-b", durationMinutes: 30, createdAtOrder: 2 }),
  waitReq({ waitlistId: "wl-c", durationMinutes: 45, createdAtOrder: 3 })
]);
check("alternatives cap at 3", (altPlan.alternatives || []).length <= 3, (altPlan.alternatives || []).length);
check("primary plus alternatives stay unique", new Set(ids(altPlan)).size === ids(altPlan).length, ids(altPlan));
check(
  "open_fill is not mixed into actionable alternatives",
  (altPlan.alternatives || []).every(function (row) { return row.type !== "open_fill_opportunity"; })
);
const altAgain = api.planCancellationRecovery(waitWinAfter, waitWinCancel, [
  waitReq({ waitlistId: "wl-c", durationMinutes: 45, createdAtOrder: 3 }),
  waitReq({ waitlistId: "wl-a", durationMinutes: 60, createdAtOrder: 1 }),
  waitReq({ waitlistId: "wl-b", durationMinutes: 30, createdAtOrder: 2 })
]);
check("alternatives stay in deterministic order", JSON.stringify(ids(altPlan)) === JSON.stringify(ids(altAgain)), ids(altPlan) + " vs " + ids(altAgain));

// ---------------------------------------------------------------------------
// WAITLIST AGE
// ---------------------------------------------------------------------------

const agePlan = api.planCancellationRecovery(waitWinAfter, waitWinCancel, [
  waitReq({ waitlistId: "wl-old-stranded", durationMinutes: 45, createdAtOrder: 1 }),
  waitReq({ waitlistId: "wl-new-exact", durationMinutes: 60, createdAtOrder: 99 })
]);
check(
  "older waitlist request does not override a better operational action",
  agePlan.primaryAction
    && agePlan.primaryAction.type === "fill_from_waitlist"
    && agePlan.primaryAction.waitlistId === "wl-new-exact",
  agePlan.primaryAction
);

const ageVsMove = api.planCancellationRecovery(waitWinAfter, waitWinCancel, [
  waitReq({ waitlistId: "wl-old-45", durationMinutes: 45, createdAtOrder: 1 })
]);
check(
  "createdAtOrder remains inside Phase 6; it does not outrank actionScore",
  ageVsMove.primaryAction
    && ageVsMove.primaryAction.actionScore === expectedActionScore(ageVsMove.primaryAction),
  ageVsMove.primaryAction
);

// ---------------------------------------------------------------------------
// PHASE 7 CHOOSES THE ACTION-BEST PLACEMENT, NOT PHASE 6's MATCH
// Cancel 11:00-11:30; 11:30-12:00 was already free. One 30-minute request
// prefers 11:30 (Phase 6 time bonus) but recovers the cancelled 11:00-11:30
// only when placed at 11:00 (Phase 7 actionScore).
// ---------------------------------------------------------------------------

const splitAfter = makeDay({
  lines: [
    line(10 * 60, 11 * 60, { lineId: "split-a", appointmentId: "split-a" }),
    line(12 * 60, 13 * 60, { lineId: "split-c", appointmentId: "split-c" })
  ]
});
const splitCancel = cancelOf(11 * 60, 11 * 60 + 30);
const splitOpening = { startMin: 11 * 60, endMin: 12 * 60 };
const splitReq = waitReq({
  waitlistId: "wl-split",
  durationMinutes: 30,
  preferredStartMin: 11 * 60 + 30,
  flexibilityMinutes: 30
});
const splitCands = api.rankWaitlistMatchCandidates(splitAfter, splitOpening, [splitReq]);
const splitPhase6 = api.rankWaitlistMatches(splitAfter, splitOpening, [splitReq])[0];
const placeA = splitCands.find(function (row) { return row.candidateStartMin === 11 * 60 + 30; });
const placeB = splitCands.find(function (row) { return row.candidateStartMin === 11 * 60; });
check(
  "split request has two Phase 6-qualified placements",
  placeA && placeB
    && placeA.waitlistMatchScore >= 50
    && placeB.waitlistMatchScore >= 50
    && placeA.waitlistMatchScore > placeB.waitlistMatchScore,
  { a: placeA && placeA.waitlistMatchScore, b: placeB && placeB.waitlistMatchScore }
);
check(
  "Phase 6 one-best keeps the preferred 11:30 placement",
  splitPhase6 && splitPhase6.candidateStartMin === 11 * 60 + 30,
  splitPhase6 && splitPhase6.candidateStartMin
);
const splitPlan = api.planCancellationRecovery(splitAfter, splitCancel, [splitReq], { maxMoveMinutes: 0 });
const splitWaitActions = [splitPlan.primaryAction].concat(splitPlan.alternatives || []).filter(function (row) {
  return row && row.waitlistId === "wl-split";
});
check(
  "Phase 7 chooses the 11:00 placement that recovers cancelled capacity",
  splitPlan.primaryAction
    && splitPlan.primaryAction.type === "fill_from_waitlist"
    && splitPlan.primaryAction.waitlistId === "wl-split"
    && splitPlan.primaryAction.candidateStartMin === 11 * 60
    && splitPlan.primaryAction.openingRecoveredMinutes === 30
    && splitPlan.primaryAction.openingRecoveryPercent === 100
    && splitPlan.primaryAction.sourceScore === placeB.waitlistMatchScore
    && splitPlan.primaryAction.sourceScoreName === "waitlistMatchScore"
    && splitPlan.primaryAction.actionScore > 40,
  splitPlan.primaryAction
);
check(
  "final planner output contains only one action for that waitlistId",
  splitWaitActions.length === 1,
  splitWaitActions.map(function (row) { return row.actionId; })
);
check(
  "alternatives do not contain another placement for the same waitlistId",
  (splitPlan.alternatives || []).every(function (row) { return row.waitlistId !== "wl-split"; })
);

const threshReq = waitReq({
  waitlistId: "wl-thresh",
  durationMinutes: 15,
  preferredStartMin: 11 * 60,
  flexibilityMinutes: 15
});
const threshCands = api.rankWaitlistMatchCandidates(splitAfter, splitOpening, [threshReq]);
const threshOk = threshCands.filter(function (row) { return row.waitlistMatchScore >= 50; });
const threshLow = threshCands.filter(function (row) { return row.waitlistMatchScore < 50; });
check(
  "one start is above the Phase 6 threshold and another valid start is below it",
  threshOk.length === 1 && threshOk[0].candidateStartMin === 11 * 60
    && threshLow.length >= 1
    && threshLow.some(function (row) { return row.candidateStartMin === 11 * 60 + 15; }),
  { ok: threshOk.map(function (row) { return row.candidateStartMin + ":" + row.waitlistMatchScore; }),
    low: threshLow.map(function (row) { return row.candidateStartMin + ":" + row.waitlistMatchScore; }) }
);
const threshPlan = api.planCancellationRecovery(splitAfter, splitCancel, [threshReq], { maxMoveMinutes: 0 });
check(
  "only the Phase 6-threshold placement reaches Phase 7",
  threshPlan.primaryAction
    && threshPlan.primaryAction.waitlistId === "wl-thresh"
    && threshPlan.primaryAction.candidateStartMin === 11 * 60
    && [threshPlan.primaryAction].concat(threshPlan.alternatives || []).filter(function (row) {
      return row && row.waitlistId === "wl-thresh";
    }).length === 1,
  threshPlan.primaryAction
);
check(
  "below-threshold mid-window start is not resurrected",
  [threshPlan.primaryAction].concat(threshPlan.alternatives || []).every(function (row) {
    return !(row && row.waitlistId === "wl-thresh" && row.candidateStartMin === 11 * 60 + 15);
  })
);

// ---------------------------------------------------------------------------
// OVERLAP — action-level penalty once
// ---------------------------------------------------------------------------

const overlapMoveAfter = makeDay({
  allowedOverlapMinutes: 15,
  lines: [
    line(12 * 60, 13 * 60, { lineId: "ovm-a", appointmentId: "ovm-a" }),
    line(14 * 60, 15 * 60, { lineId: "ovm-c", appointmentId: "ovm-c" })
  ]
});
const overlapMoveCancel = cancelOf(13 * 60, 14 * 60);
const overlapMovePlan = api.planCancellationRecovery(overlapMoveAfter, overlapMoveCancel, [
  waitReq({ waitlistId: "wl-clean-60", durationMinutes: 60 })
]);
const cleanAction = [overlapMovePlan.primaryAction].concat(overlapMovePlan.alternatives || []).find(function (row) {
  return row && row.usesOverlap === false && row.openingRecoveredMinutes === 60;
});
const overlapAction = [overlapMovePlan.primaryAction].concat(overlapMovePlan.alternatives || []).find(function (row) {
  return row && row.usesOverlap === true;
});
check(
  "clean action beats otherwise equivalent overlap action when both exist",
  !overlapAction || (cleanAction && cleanAction.actionScore > overlapAction.actionScore),
  {
    clean: cleanAction && { type: cleanAction.type, score: cleanAction.actionScore },
    overlap: overlapAction && { type: overlapAction.type, score: overlapAction.actionScore, penalty: overlapAction.overlapPenalty }
  }
);
check(
  "action-level overlap penalty is exactly 5 and applied once",
  !overlapAction || (
    overlapAction.overlapPenalty === 5
    && overlapAction.actionScore === expectedActionScore(overlapAction)
    && api.PLAN.OVERLAP_ACTION_PENALTY === 5
  ),
  overlapAction
);
check(
  "waitlist exact-fill is a clean action and ranks first here",
  overlapMovePlan.primaryAction
    && overlapMovePlan.primaryAction.usesOverlap === false
    && overlapMovePlan.primaryAction.actionScore === expectedActionScore(overlapMovePlan.primaryAction),
  overlapMovePlan.primaryAction
);

// ---------------------------------------------------------------------------
// COMMON MODEL + SCORE FORMULA
// ---------------------------------------------------------------------------

check(
  "actionScore follows the Phase 7 formula for the waitlist winner",
  waitWinPlan.primaryAction.actionScore === expectedActionScore(waitWinPlan.primaryAction),
  { got: waitWinPlan.primaryAction.actionScore, expected: expectedActionScore(waitWinPlan.primaryAction) }
);
check(
  "15-minute disruption penalty is 3",
  moveWinPlan.primaryAction.disruptionPenalty === 3 && moveWinPlan.primaryAction.clientDisruptionMinutes === 15
);
check(
  "60-minute disruption penalty is 12",
  (waitWinPlan.alternatives || []).some(function (row) {
    return row.type === "move_existing_appointment"
      && row.clientDisruptionMinutes === 60
      && row.disruptionPenalty === 12;
  })
);
check(
  "source scores are exposed separately and not used as actionScore",
  waitWinPlan.primaryAction.sourceScoreName === "waitlistMatchScore"
    && waitWinPlan.primaryAction.sourceScore !== waitWinPlan.primaryAction.actionScore
);
check(
  "move source score is recoveryScore",
  moveWinPlan.primaryAction.sourceScoreName === "recoveryScore"
);
check(
  "waitlist clientDisruptionMinutes is 0",
  waitWinPlan.primaryAction.clientDisruptionMinutes === 0 && waitWinPlan.primaryAction.disruptionPenalty === 0
);
check(
  "original day is not mutated",
  JSON.stringify(snapshotDay) === snapshotJson && JSON.stringify(moveWinAfter) === JSON.stringify(makeDay({
    lines: [
      line(12 * 60, 13 * 60, { lineId: "slide-a", appointmentId: "slide-a" }),
      line(13 * 60 + 15, 14 * 60 + 15, { lineId: "slide-b", appointmentId: "slide-b" })
    ]
  }))
);

// ---------------------------------------------------------------------------
// IDENTITIES
// ---------------------------------------------------------------------------

check(
  "move identity uses appointment, line, and proposed start",
  moveWinPlan.primaryAction.actionId.indexOf("move|") === 0
    && moveWinPlan.primaryAction.actionId.split("|").length === 4
);
check(
  "waitlist identity uses waitlistId and candidate start",
  waitWinPlan.primaryAction.actionId === "waitlist|wl-exact-60|" + (11 * 60)
);

// ---------------------------------------------------------------------------
// DETERMINISM + PURITY
// ---------------------------------------------------------------------------

const detA = api.planCancellationRecovery(waitWinAfter, waitWinCancel, [
  waitReq({ waitlistId: "wl-z", durationMinutes: 45, createdAtOrder: 3 }),
  waitReq({ waitlistId: "wl-a", durationMinutes: 60, createdAtOrder: 1 })
]);
const detB = api.planCancellationRecovery(waitWinAfter, waitWinCancel, [
  waitReq({ waitlistId: "wl-z", durationMinutes: 45, createdAtOrder: 3 }),
  waitReq({ waitlistId: "wl-a", durationMinutes: 60, createdAtOrder: 1 })
]);
check("same inputs yield the same logical output", JSON.stringify(detA.primaryAction) === JSON.stringify(detB.primaryAction) && JSON.stringify(ids(detA)) === JSON.stringify(ids(detB)));

const src = fs.readFileSync(path.join(root, "public/booking/smart-scheduling/recovery-planner.js"), "utf8");
check("purity: no Firebase APIs", !/firebase-firestore|getDocs\s*\(|onSnapshot\s*\(|updateDoc\s*\(|addDoc\s*\(/.test(src));
check("purity: no network", !/\bfetch\s*\(|XMLHttpRequest/.test(src));
check("purity: no writes / timers / Date", !/\bsetTimeout\b|\bsetInterval\b|\bDate\s*\(|createAppointment|updateAppointment|cancelAppointment/.test(src));
check("purity: no DOM / Calendar / Reports", !/\bdocument\b|\blocalStorage\b|ffBookingCal|ffBookingReports/.test(src));
check("purity: no messaging / booking", !/sendSms|sendEmail|twilio|mailer|bookClient|autoBook|acceptLink/i.test(src));

if (failed) {
  console.log("\n" + failed + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll recovery planner checks passed.");
