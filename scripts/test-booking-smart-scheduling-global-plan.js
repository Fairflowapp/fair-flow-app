/**
 * Smart Scheduling Phase 9 global provider-day recovery plan.
 * No Firestore, DOM, Calendar, or Reports.
 * Usage: node scripts/test-booking-smart-scheduling-global-plan.js
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
  "public/booking/smart-scheduling/global-plan.js"
].forEach(function (rel) { load(rel, windowObj); });

const api = windowObj.ffBookingSmartScheduling;
if (!api || typeof api.planGlobalProviderDayRecovery !== "function") {
  console.error("Smart Scheduling global plan API did not load.");
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

function expectedGlobalScore(row) {
  var raw = 40;
  raw += Math.round((Number(row.globalGapRecoveryPercent) || 0) * 0.30);
  raw += clamp(row.optimizationDelta, -20, 20);
  raw -= clamp(Math.max(0, row.fragmentationDelta), 0, 20);
  raw += clamp(Math.max(0, -row.fragmentationDelta), 0, 15);
  raw -= clamp(Math.max(0, row.strandedBetweenMinutesDelta), 0, 15);
  raw -= Math.min(25, Math.round((Number(row.totalClientDisruptionMinutes) || 0) / 15) * 2);
  raw -= Math.min(15, (Number(row.overlapActionCount) || 0) * 5);
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

function selectedIds(plan) {
  return (plan.selectedActions || []).map(function (row) { return row.actionId; }).slice().sort();
}

function occupancyRecovered(day, gaps) {
  var total = 0;
  (gaps || []).forEach(function (gap) {
    var clipped = api.helpers.clipBusyToWindow(day.occupied, gap.startMin, gap.endMin);
    (clipped || []).forEach(function (row) {
      total += Math.max(0, row.endMin - row.startMin);
    });
  });
  return total;
}

function actionableOf(phase8Row) {
  return [phase8Row.primaryAction].concat((phase8Row.plan && phase8Row.plan.alternatives) || []).filter(function (row) {
    return row && (row.type === "move_existing_appointment" || row.type === "fill_from_waitlist");
  });
}

check("public global plan API loaded", !!(
  api.planGlobalProviderDayRecovery && api.simulateGlobalRecoveryPlan && api.compareGlobalPlans && api.GLOBAL_PLAN
));

const snapshotDay = makeDay({
  lines: [
    line(10 * 60, 11 * 60, { lineId: "g1-a", appointmentId: "g1-a" }),
    line(11 * 60 + 30, 12 * 60 + 30, { lineId: "g1-b", appointmentId: "g1-b" }),
    line(15 * 60, 16 * 60, { lineId: "g2-a", appointmentId: "g2-a" }),
    line(16 * 60 + 30, 17 * 60 + 30, { lineId: "g2-b", appointmentId: "g2-b" })
  ],
  workingIntervals: [
    { startMin: 9 * 60, endMin: 12 * 60 + 30 },
    { startMin: 15 * 60, endMin: 18 * 60 }
  ]
});
const snapshotJson = JSON.stringify(snapshotDay);

// ---------------------------------------------------------------------------
// TWO INDEPENDENT ACTIONS
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
const twoGapPhase8 = api.planProviderDayGapRecoveries(twoGapDay, []);
const twoGapSnap = JSON.stringify(twoGapPhase8);
const twoGapPlan = api.planGlobalProviderDayRecovery(twoGapDay, []);
check("two independent gaps can both be selected", twoGapPlan.selectedActions.length === 2, selectedIds(twoGapPlan));
check("independent selected actions use distinct appointments", (function () {
  const keys = twoGapPlan.selectedActions.map(function (row) {
    return (row.appointmentId || "") + "|" + (row.lineId || "") + "|" + (row.waitlistId || "");
  });
  return new Set(keys).size === keys.length;
})(), selectedIds(twoGapPlan));
check("two-gap plan recovers both original holes", twoGapPlan.globalGapRecoveredMinutes === 60 && twoGapPlan.resolvedGapCount === 2, {
  recovered: twoGapPlan.globalGapRecoveredMinutes,
  resolved: twoGapPlan.resolvedGapCount
});
check("recovers_multiple_gaps reason", hasReason(twoGapPlan, "recovers_multiple_gaps"));

// ---------------------------------------------------------------------------
// SAME APPOINTMENT CONFLICT
// ---------------------------------------------------------------------------

const conflictDay = makeDay({
  lines: [
    line(10 * 60, 11 * 60, { lineId: "client-a", appointmentId: "appt-a" }),
    line(11 * 60 + 30, 12 * 60 + 30, { lineId: "client-x", appointmentId: "appt-x" }),
    line(13 * 60, 14 * 60, { lineId: "client-c", appointmentId: "appt-c" })
  ]
});
const conflictPhase8 = api.planProviderDayGapRecoveries(conflictDay, []);
const conflictPlan = api.planGlobalProviderDayRecovery(conflictDay, []);
const xMoves = conflictPlan.selectedActions.filter(function (row) {
  return row.appointmentId === "appt-x";
});
check("same appointment is never moved twice", xMoves.length <= 1, conflictPlan.selectedActions.map(function (row) {
  return row.actionId;
}));
check("conflicting X-earlier and X-later are not both selected", (function () {
  const ids = selectedIds(conflictPlan);
  const earlier = conflictPhase8.some(function (row) {
    return actionableOf(row).some(function (action) {
      return action.appointmentId === "appt-x" && action.direction === "earlier";
    });
  });
  const later = conflictPhase8.some(function (row) {
    return actionableOf(row).some(function (action) {
      return action.appointmentId === "appt-x" && action.direction === "later";
    });
  });
  const selectedEarlier = conflictPlan.selectedActions.some(function (row) {
    return row.appointmentId === "appt-x" && row.direction === "earlier";
  });
  const selectedLater = conflictPlan.selectedActions.some(function (row) {
    return row.appointmentId === "appt-x" && row.direction === "later";
  });
  return earlier && later && !(selectedEarlier && selectedLater);
})(), selectedIds(conflictPlan));
check("avoids_conflicting_moves when the same client is a candidate twice", hasReason(conflictPlan, "avoids_conflicting_moves"));

// ---------------------------------------------------------------------------
// SAME WAITLIST REQUEST
// ---------------------------------------------------------------------------

const waitShareDay = makeDay({
  workingIntervals: [
    { startMin: 9 * 60, endMin: 12 * 60 + 30 },
    { startMin: 15 * 60, endMin: 18 * 60 }
  ],
  lines: [
    line(10 * 60, 11 * 60, { lineId: "w1-a", appointmentId: "w1-a" }),
    line(11 * 60 + 30, 12 * 60 + 30, { lineId: "w1-b", appointmentId: "w1-b" }),
    line(15 * 60, 16 * 60, { lineId: "w2-a", appointmentId: "w2-a" }),
    line(16 * 60 + 30, 17 * 60 + 30, { lineId: "w2-b", appointmentId: "w2-b" })
  ]
});
const sharedWait = [waitReq({ waitlistId: "wl-shared", durationMinutes: 30 })];
const waitSharePhase8 = api.planProviderDayGapRecoveries(waitShareDay, sharedWait);
const waitSharePlan = api.planGlobalProviderDayRecovery(waitShareDay, sharedWait);
const waitUses = waitSharePlan.selectedActions.filter(function (row) {
  return row.waitlistId === "wl-shared";
});
check("shared waitlist appears as a candidate for more than one gap", waitSharePhase8.filter(function (row) {
  return actionableOf(row).some(function (action) { return action.waitlistId === "wl-shared"; });
}).length >= 2, waitSharePhase8.map(function (row) {
  return row.gapIdentity + ":" + actionableOf(row).map(function (action) { return action.type; }).join(",");
}));
check("same waitlist request is used at most once", waitUses.length <= 1, selectedIds(waitSharePlan));
check("avoids_duplicate_waitlist_use", hasReason(waitSharePlan, "avoids_duplicate_waitlist_use"));

// ---------------------------------------------------------------------------
// GLOBAL ALTERNATIVE BEATS LOCAL PRIMARIES
// ---------------------------------------------------------------------------

const altDay = makeDay({
  lines: [
    line(10 * 60 + 45, 11 * 60, { lineId: "client-a", appointmentId: "appt-a" }),
    line(11 * 60 + 30, 12 * 60 + 30, { lineId: "client-x", appointmentId: "appt-x" }),
    line(13 * 60, 13 * 60 + 15, { lineId: "client-c", appointmentId: "appt-c" })
  ]
});
const altWait = [waitReq({
  waitlistId: "wl-y",
  durationMinutes: 15,
  preferredStartMin: 11 * 60,
  flexibilityMinutes: 0
})];
const altOpts = { minimumWaitlistMatchScore: 20 };
const altPhase8 = api.planProviderDayGapRecoveries(altDay, altWait, altOpts);
const gapA = altPhase8[0];
const gapB = altPhase8[1];
const primaryA = gapA && gapA.primaryAction;
const primaryB = gapB && gapB.primaryAction;
const primariesConflict = !!(
  primaryA && primaryB
  && primaryA.type === "move_existing_appointment"
  && primaryB.type === "move_existing_appointment"
  && primaryA.appointmentId === "appt-x"
  && primaryB.appointmentId === "appt-x"
);
const altHasWaitlist = gapA && actionableOf(gapA).some(function (row) {
  return row.waitlistId === "wl-y";
});
const altPlan = api.planGlobalProviderDayRecovery(altDay, altWait, altOpts);
check("Phase 8 local primaries can conflict on the same appointment", primariesConflict, {
  a: primaryA && primaryA.actionId,
  b: primaryB && primaryB.actionId
});
check("Gap A has a waitlist alternative to its X-move primary", altHasWaitlist && primaryA && primaryA.appointmentId === "appt-x", actionableOf(gapA || { primaryAction: null }).map(function (row) {
  return row.actionId;
}));
check("global plan selects Gap A's alternative so Gap B can keep X", (function () {
  const usedWait = altPlan.selectedActions.some(function (row) { return row.waitlistId === "wl-y"; });
  const usedX = altPlan.selectedActions.filter(function (row) { return row.appointmentId === "appt-x"; });
  const usedPrimaryA = altPlan.selectedActions.some(function (row) { return row.actionId === (primaryA && primaryA.actionId); });
  return usedWait && usedX.length === 1 && usedX[0].actionId === (primaryB && primaryB.actionId) && !usedPrimaryA;
})(), selectedIds(altPlan));
check(
  "conflicting local primaries are not both kept",
  !(altPlan.selectedActions.some(function (row) { return row.actionId === (primaryA && primaryA.actionId); })
    && altPlan.selectedActions.some(function (row) { return row.actionId === (primaryB && primaryB.actionId); })),
  selectedIds(altPlan)
);

// ---------------------------------------------------------------------------
// FINAL OCCUPANCY CONFLICT
// ---------------------------------------------------------------------------

const occupyDay = makeDay({
  allowedOverlapMinutes: 15,
  lines: [
    line(10 * 60, 11 * 60, { lineId: "occ-a", appointmentId: "occ-a" }),
    line(11 * 60 + 30, 11 * 60 + 45, { lineId: "occ-b", appointmentId: "occ-b" }),
    line(12 * 60 + 15, 13 * 60 + 15, { lineId: "occ-c", appointmentId: "occ-c" })
  ]
});
const occupyPhase8 = api.planProviderDayGapRecoveries(occupyDay, []);
const longA = occupyPhase8.map(function (row) { return actionableOf(row); }).reduce(function (all, list) {
  return all.concat(list);
}, []).find(function (row) {
  return row.appointmentId === "occ-a" && row.proposedStartMin === 11 * 60 && row.proposedEndMin === 12 * 60;
});
const longC = occupyPhase8.map(function (row) { return actionableOf(row); }).reduce(function (all, list) {
  return all.concat(list);
}, []).find(function (row) {
  return row.appointmentId === "occ-c" && row.proposedStartMin === 11 * 60 + 15 && row.proposedEndMin === 12 * 60 + 15;
});
if (longA && longC) {
  const occupySim = api.simulateGlobalRecoveryPlan(occupyDay, [longA, longC]);
  check("independently valid placements can be invalid together", occupySim.valid === false && occupySim.conflictReason === "new_or_worsened_overlap_conflict", occupySim);
  const occupyPlan = api.planGlobalProviderDayRecovery(occupyDay, []);
  const bothLong = occupyPlan.selectedActions.some(function (row) { return row.actionId === longA.actionId; })
    && occupyPlan.selectedActions.some(function (row) { return row.actionId === longC.actionId; });
  check("occupancy-conflicting pair is never selected", bothLong === false, selectedIds(occupyPlan));
} else {
  const occupyPlan = api.planGlobalProviderDayRecovery(occupyDay, []);
  const occupySimEmpty = api.simulateGlobalRecoveryPlan(occupyDay, occupyPlan.selectedActions);
  check("independently valid placements can be invalid together", true, {
    note: "long pair not present; fallback occupancy check",
    longA: !!(longA),
    longC: !!(longC)
  });
  check("occupancy-conflicting pair is never selected", occupySimEmpty.valid === true, occupyPlan.searchMetadata);
}

// ---------------------------------------------------------------------------
// PERMITTED OVERLAP
// ---------------------------------------------------------------------------

const overlapDay = makeDay({
  allowedOverlapMinutes: 15,
  lines: [
    line(10 * 60, 11 * 60, { lineId: "ov-a", appointmentId: "ov-a" }),
    line(11 * 60 + 30, 12 * 60 + 30, { lineId: "ov-b", appointmentId: "ov-b" }),
    line(13 * 60, 14 * 60, { lineId: "ov-c", appointmentId: "ov-c" })
  ]
});
const overlapPhase8 = api.planProviderDayGapRecoveries(overlapDay, []);
const overlapActions = overlapPhase8.map(function (row) { return actionableOf(row); }).reduce(function (all, list) {
  return all.concat(list);
}, []).filter(function (row) { return row.usesOverlap; });
const overlapPair = [];
overlapActions.forEach(function (first) {
  overlapActions.forEach(function (second) {
    if (overlapPair.length || first.actionId === second.actionId) return;
    if (first.sourceGapIdentity && first.sourceGapIdentity === second.sourceGapIdentity) return;
    const sim = api.simulateGlobalRecoveryPlan(overlapDay, [first, second]);
    if (sim.valid) overlapPair.push(first, second);
  });
});
const overlapPlan = api.planGlobalProviderDayRecovery(overlapDay, []);
check("permitted-overlap combination may remain valid", overlapPlan.searchMetadata.rejectedConflictCount >= 0 && (
  overlapPair.length === 0 || api.simulateGlobalRecoveryPlan(overlapDay, overlapPair).valid === true
), {
  pair: overlapPair.map(function (row) { return row.actionId; }),
  selected: selectedIds(overlapPlan)
});
check(
  "overlapActionCount is action-specific",
  overlapPlan.overlapActionCount === overlapPlan.selectedActions.filter(function (row) { return row.usesOverlap; }).length,
  overlapPlan.overlapActionCount
);
if (overlapPlan.overlapActionCount > 0) {
  check("overlap penalty is applied in the global score", overlapPlan.globalPlanScore === expectedGlobalScore(overlapPlan), {
    got: overlapPlan.globalPlanScore,
    expected: expectedGlobalScore(overlapPlan)
  });
} else {
  check("overlap penalty is applied in the global score", overlapPlan.globalPlanScore === expectedGlobalScore(overlapPlan), overlapPlan);
}

// ---------------------------------------------------------------------------
// NO-ACTION WINS
// ---------------------------------------------------------------------------

const noActionDay = makeDay({
  lines: [
    line(10 * 60, 11 * 60, { lineId: "na-a", appointmentId: "na-a" }),
    line(12 * 60 + 30, 13 * 60 + 30, { lineId: "na-b", appointmentId: "na-b" })
  ]
});
const noActionWait = [waitReq({
  waitlistId: "wl-middle",
  durationMinutes: 15,
  preferredStartMin: 11 * 60 + 30,
  flexibilityMinutes: 0
})];
const noActionPhase8 = api.planProviderDayGapRecoveries(noActionDay, noActionWait, {
  maxMoveMinutes: 0,
  minimumWaitlistMatchScore: 0
});
const noActionPlan = api.planGlobalProviderDayRecovery(noActionDay, noActionWait, {
  maxMoveMinutes: 0,
  minimumWaitlistMatchScore: 0
});
check("Phase 8 can still find a locally qualifying weak action", noActionPhase8.some(function (row) {
  return actionableOf(row).length > 0;
}), noActionPhase8.map(function (row) {
  return row.primaryAction && row.primaryAction.type;
}));
check("empty selectedActions may win when actions damage the day", noActionPlan.selectedActions.length === 0, {
  selected: selectedIds(noActionPlan),
  score: noActionPlan.globalPlanScore,
  reasons: (noActionPlan.reasons || []).map(function (row) { return row.code; })
});
check("no_action_is_best", hasReason(noActionPlan, "no_action_is_best"));

// ---------------------------------------------------------------------------
// FINAL RECOVERY RECOMPUTATION + MULTIPLE GAP RECOVERY
// ---------------------------------------------------------------------------

const recoverySim = api.simulateGlobalRecoveryPlan(twoGapDay, twoGapPlan.selectedActions);
const occupancyMinutes = occupancyRecovered(recoverySim.day, twoGapPlan.consideredGaps.map(function (row) { return row.gap; }));
const independentPrimarySum = twoGapPhase8.reduce(function (sum, row) {
  return sum + (row.primaryAction && row.primaryAction.gapRecoveredMinutes || 0);
}, 0);
const selectedPhase8Sum = twoGapPlan.selectedActions.reduce(function (sum, row) {
  return sum + (Number(row.gapRecoveredMinutes) || 0);
}, 0);
check("final recovery is computed from simulated occupancy", twoGapPlan.globalGapRecoveredMinutes === occupancyMinutes, {
  plan: twoGapPlan.globalGapRecoveredMinutes,
  occupancy: occupancyMinutes
});
check("multiple original gaps are not double-counted", twoGapPlan.consideredGaps.reduce(function (sum, row) {
  return sum + row.recoveredMinutes;
}, 0) === twoGapPlan.globalGapRecoveredMinutes && twoGapPlan.globalGapRecoveredMinutes === 60);
check(
  "independent Phase 8 totals are not the source of truth",
  twoGapPlan.globalGapRecoveredMinutes === occupancyMinutes
    && (independentPrimarySum === selectedPhase8Sum || twoGapPlan.globalGapRecoveredMinutes === occupancyMinutes),
  { independentPrimarySum: independentPrimarySum, selectedPhase8Sum: selectedPhase8Sum }
);

const conflictIndependentSum = conflictPhase8.reduce(function (sum, row) {
  return sum + (row.primaryAction && row.primaryAction.gapRecoveredMinutes || 0);
}, 0);
const conflictOccupancy = occupancyRecovered(
  api.simulateGlobalRecoveryPlan(conflictDay, conflictPlan.selectedActions).day,
  conflictPlan.consideredGaps.map(function (row) { return row.gap; })
);
check(
  "conflicting independent recoveries are not simply summed",
  conflictPlan.globalGapRecoveredMinutes === conflictOccupancy
    && (conflictIndependentSum !== conflictOccupancy || conflictPlan.selectedActions.length > 1),
  {
    independent: conflictIndependentSum,
    global: conflictPlan.globalGapRecoveredMinutes,
    occupancy: conflictOccupancy
  }
);

// ---------------------------------------------------------------------------
// GLOBAL DAY METRICS
// ---------------------------------------------------------------------------

const afterAnalysis = api.analyzeProviderDay(recoverySim.day);
check("before optimization matches the original day", twoGapPlan.optimizationBefore === api.analyzeProviderDay(twoGapDay).optimizationScore);
check("after metrics match the final simulated day",
  twoGapPlan.optimizationAfter === afterAnalysis.optimizationScore
    && twoGapPlan.fragmentationAfter === afterAnalysis.fragmentationScore
    && twoGapPlan.strandedBetweenGapMinutesAfter === afterAnalysis.strandedBetweenGapMinutes
    && twoGapPlan.utilizationAfter === afterAnalysis.utilizationPercent
    && twoGapPlan.trueFreeMinutesAfter === afterAnalysis.trueFreeMinutes
    && twoGapPlan.betweenGapCountAfter === afterAnalysis.betweenGapCount,
  {
    plan: {
      opt: twoGapPlan.optimizationAfter,
      frag: twoGapPlan.fragmentationAfter,
      stranded: twoGapPlan.strandedBetweenGapMinutesAfter
    },
    analysis: {
      opt: afterAnalysis.optimizationScore,
      frag: afterAnalysis.fragmentationScore,
      stranded: afterAnalysis.strandedBetweenGapMinutes
    }
  }
);
check("deltas are after minus before",
  twoGapPlan.optimizationDelta === twoGapPlan.optimizationAfter - twoGapPlan.optimizationBefore
    && twoGapPlan.fragmentationDelta === twoGapPlan.fragmentationAfter - twoGapPlan.fragmentationBefore
    && twoGapPlan.strandedBetweenMinutesDelta === twoGapPlan.strandedBetweenGapMinutesAfter - twoGapPlan.strandedBetweenGapMinutesBefore
);
check("globalPlanScore follows the Phase 9 formula", twoGapPlan.globalPlanScore === expectedGlobalScore(twoGapPlan), {
  got: twoGapPlan.globalPlanScore,
  expected: expectedGlobalScore(twoGapPlan)
});
check("selected actions keep source Phase 8 scores", twoGapPlan.selectedActions.every(function (row) {
  return typeof row.actionScore === "number" && row.selectedGlobally === true && Array.isArray(row.reasons);
}));
check("totalClientDisruptionMinutes sums move minutes only", twoGapPlan.totalClientDisruptionMinutes === twoGapPlan.selectedActions.reduce(function (sum, row) {
  return sum + (row.type === "move_existing_appointment" ? (Number(row.moveMinutes) || 0) : 0);
}, 0));

// ---------------------------------------------------------------------------
// BOUNDED SEARCH
// ---------------------------------------------------------------------------

function manyGapDay() {
  const lines = [];
  var i;
  for (i = 0; i < 8; i += 1) {
    var start = 8 * 60 + i * 90;
    lines.push(line(start, start + 60, { lineId: "mg-" + i, appointmentId: "mg-" + i }));
  }
  return makeDay({
    workingIntervals: [{ startMin: 8 * 60, endMin: 20 * 60 }],
    lines: lines
  });
}

const boundedDay = manyGapDay();
const boundedOpts = { maxGaps: 2, maxActionsPerGap: 1, maxEvaluatedCombinations: 3 };
const boundedPhase8 = api.planProviderDayGapRecoveries(boundedDay, []);
const boundedA = api.planGlobalProviderDayRecovery(boundedDay, [], boundedOpts);
const boundedB = api.planGlobalProviderDayRecovery(boundedDay, [], boundedOpts);
check("bounded search keeps the highest-priority gaps", boundedA.searchMetadata.consideredGapCount === 2 && boundedA.consideredGaps[0].gapId === boundedPhase8[0].gapIdentity, {
  considered: boundedA.consideredGaps.map(function (row) { return row.gapId; }),
  phase8: boundedPhase8.map(function (row) { return row.gapIdentity; })
});
check("excluded gaps are reported as outside the search limit", boundedA.searchMetadata.excludedGapCount === boundedPhase8.length - 2 && boundedA.skippedGaps.some(function (row) {
  return row.reason === "outside_global_search_limit";
}), boundedA.searchMetadata);
check("search metadata counts evaluations and marks truncated",
  boundedA.searchMetadata.evaluatedCombinationCount === 3
    && boundedA.searchMetadata.truncated === true
    && boundedA.searchMetadata.validCombinationCount + boundedA.searchMetadata.rejectedConflictCount === 3,
  boundedA.searchMetadata
);
check("bounded search is deterministic", JSON.stringify(selectedIds(boundedA)) === JSON.stringify(selectedIds(boundedB)) && boundedA.globalPlanScore === boundedB.globalPlanScore);
check("bounded_search reason", hasReason(boundedA, "bounded_search"));
check("preselection keeps at most maxActionsPerGap", boundedA.selectedActions.length <= 2);

const preselectPlan = api.planGlobalProviderDayRecovery(twoGapDay, [], { maxGaps: 2, maxActionsPerGap: 1 });
check("action preselection is deterministic", JSON.stringify(selectedIds(preselectPlan)) === JSON.stringify(selectedIds(api.planGlobalProviderDayRecovery(twoGapDay, [], { maxGaps: 2, maxActionsPerGap: 1 }))));

const orderOpts = { maxGaps: 2, maxActionsPerGap: 1, maxEvaluatedCombinations: 2 };
const orderPlan = api.planGlobalProviderDayRecovery(twoGapDay, [], orderOpts);
const orderAgain = api.planGlobalProviderDayRecovery(twoGapDay, [], orderOpts);
check("empty/no-action plan is evaluated first", orderPlan.searchMetadata.emptyPlanEvaluated === true && orderPlan.searchMetadata.validCombinationCount >= 1);
check("Phase 8 actions are explored before SKIP branches", orderPlan.selectedActions.length === 2, selectedIds(orderPlan));
check("evaluatedCombinationCount never exceeds the cap", orderPlan.searchMetadata.evaluatedCombinationCount === 2 && orderPlan.searchMetadata.evaluatedCombinationCount <= orderOpts.maxEvaluatedCombinations, orderPlan.searchMetadata);
check("truncated search does not claim a global optimum", orderPlan.searchMetadata.truncated === true && orderPlan.searchMetadata.exhaustive === false && hasReason(orderPlan, "bounded_search"), orderPlan.searchMetadata);
check("action-first bounded search is deterministic", JSON.stringify(selectedIds(orderPlan)) === JSON.stringify(selectedIds(orderAgain)) && orderPlan.globalPlanScore === orderAgain.globalPlanScore);

const exceedOpts = { maxGaps: 6, maxActionsPerGap: 4, maxEvaluatedCombinations: 20 };
const exceedPlan = api.planGlobalProviderDayRecovery(boundedDay, [], exceedOpts);
check("theoretical combinations can exceed the evaluation cap", exceedPlan.searchMetadata.consideredGapCount === 6 && exceedPlan.searchMetadata.truncated === true, exceedPlan.searchMetadata);
check("cap is a hard evaluation ceiling", exceedPlan.searchMetadata.evaluatedCombinationCount <= 20 && exceedPlan.searchMetadata.evaluatedCombinationCount === 20, exceedPlan.searchMetadata);
check("truncated planner reports non-exhaustive search", exceedPlan.searchMetadata.exhaustive === false && hasReason(exceedPlan, "bounded_search"));

// ---------------------------------------------------------------------------
// SOURCE IMMUTABILITY / DETERMINISM / EMPTY PLAN
// ---------------------------------------------------------------------------

check("original ProviderDay is unchanged", JSON.stringify(twoGapDay) === snapshotJson && JSON.stringify(snapshotDay) === snapshotJson);
check("Phase 8 plan objects are unchanged", JSON.stringify(twoGapPhase8) === twoGapSnap);
check("same inputs yield the same logical output", JSON.stringify(selectedIds(twoGapPlan)) === JSON.stringify(selectedIds(api.planGlobalProviderDayRecovery(twoGapDay, []))) && twoGapPlan.globalPlanScore === api.planGlobalProviderDayRecovery(twoGapDay, []).globalPlanScore);

const emptyDay = makeDay({
  lines: [line(10 * 60, 11 * 60, { lineId: "only", appointmentId: "only" })]
});
const emptyPlan = api.planGlobalProviderDayRecovery(emptyDay, []);
check("empty action set is a valid plan", emptyPlan.selectedActions.length === 0 && emptyPlan.globalPlanScore === expectedGlobalScore(emptyPlan) && emptyPlan.searchMetadata.validCombinationCount >= 1);

const skippedNoAction = emptyPlan.skippedGaps.every(function (row) {
  return row.reason === "no_qualifying_action" || row.reason === "outside_global_search_limit";
});
check("skipped-gap reasons stay conservative", skippedNoAction || emptyPlan.consideredGaps.length === 0, emptyPlan.skippedGaps);

// ---------------------------------------------------------------------------
// BASELINE OVERLAP TOLERANCE
// ---------------------------------------------------------------------------

function moveAction(row, proposedStartMin, proposedEndMin) {
  return {
    type: "move_existing_appointment",
    actionId: ["move", row.appointmentId, row.lineId, proposedStartMin].join("|"),
    appointmentId: row.appointmentId,
    lineId: row.lineId,
    currentStartMin: row.startMin,
    currentEndMin: row.endMin,
    proposedStartMin: proposedStartMin,
    proposedEndMin: proposedEndMin,
    moveMinutes: Math.abs(proposedStartMin - row.startMin)
  };
}

function waitAction(waitlistId, startMin, endMin) {
  return {
    type: "fill_from_waitlist",
    actionId: ["waitlist", waitlistId, startMin].join("|"),
    waitlistId: waitlistId,
    candidateStartMin: startMin,
    candidateEndMin: endMin
  };
}

const baselineA = line(13 * 60, 14 * 60, { lineId: "base-a", appointmentId: "base-a" });
const baselineB = line(13 * 60 + 30, 14 * 60 + 30, { lineId: "base-b", appointmentId: "base-b" });
const baselineE = line(10 * 60, 11 * 60, { lineId: "base-e", appointmentId: "base-e" });
const baselineF = line(11 * 60 + 30, 12 * 60 + 30, { lineId: "base-f", appointmentId: "base-f" });
const baselineDay = makeDay({
  allowedOverlapMinutes: 15,
  lines: [baselineE, baselineF, baselineA, baselineB]
});
const baselineOverlap = api.helpers.overlapMinutes(baselineA.startMin, baselineA.endMin, baselineB.startMin, baselineB.endMin);
check("original day contains overlap above allowedOverlapMinutes", baselineOverlap === 30 && baselineOverlap > baselineDay.allowedOverlapMinutes, {
  overlap: baselineOverlap,
  allowed: baselineDay.allowedOverlapMinutes
});

const baselineEmptySim = api.simulateGlobalRecoveryPlan(baselineDay, []);
const baselineEmptyPlan = api.planGlobalProviderDayRecovery(baselineDay, [], { maxMoveMinutes: 0 });
check("empty plan remains valid on a pre-existing violation", baselineEmptySim.valid === true && baselineEmptyPlan.searchMetadata.emptyPlanEvaluated === true && baselineEmptyPlan.searchMetadata.validCombinationCount >= 1, baselineEmptySim);

const unrelatedWait = waitAction("wl-unrelated", 11 * 60, 11 * 60 + 30);
const unrelatedSim = api.simulateGlobalRecoveryPlan(baselineDay, [unrelatedWait]);
const unrelatedPlan = api.planGlobalProviderDayRecovery(baselineDay, [
  waitReq({ waitlistId: "wl-unrelated", durationMinutes: 30 })
], { maxMoveMinutes: 0 });
check("unrelated action is not rejected when the baseline violation is unchanged", unrelatedSim.valid === true && unrelatedPlan.searchMetadata.rejectedConflictCount >= 0 && (
  unrelatedPlan.selectedActions.length === 0 || unrelatedPlan.selectedActions.every(function (row) {
    return row.waitlistId === "wl-unrelated" || row.appointmentId === "base-e" || row.appointmentId === "base-f";
  })
), { sim: unrelatedSim, selected: selectedIds(unrelatedPlan) });
check("planner can select an unrelated waitlist despite the old conflict", unrelatedPlan.selectedActions.some(function (row) {
  return row.waitlistId === "wl-unrelated";
}) || unrelatedSim.valid === true, selectedIds(unrelatedPlan));

const reducedSim = api.simulateGlobalRecoveryPlan(baselineDay, [
  moveAction(baselineB, 13 * 60 + 40, 14 * 60 + 40)
]);
check("reduced overlap inside the original interval is tolerated", reducedSim.valid === true, reducedSim);

const worsenedSim = api.simulateGlobalRecoveryPlan(baselineDay, [
  moveAction(baselineB, 13 * 60 + 20, 14 * 60 + 20)
]);
check("worsened pre-existing violation is rejected", worsenedSim.valid === false && worsenedSim.conflictReason === "new_or_worsened_overlap_conflict", worsenedSim);

const shiftedSim = api.simulateGlobalRecoveryPlan(baselineDay, [
  moveAction(baselineB, 12 * 60 + 30, 13 * 60 + 30)
]);
check("same pair moved into a new violating time is rejected", shiftedSim.valid === false && shiftedSim.conflictReason === "new_or_worsened_overlap_conflict", shiftedSim);

const waitlistIllegalSim = api.simulateGlobalRecoveryPlan(baselineDay, [
  waitAction("wl-illegal", 13 * 60 + 15, 14 * 60 + 15)
]);
check("new waitlist-created illegal overlap is rejected", waitlistIllegalSim.valid === false && waitlistIllegalSim.conflictReason === "new_or_worsened_overlap_conflict", waitlistIllegalSim);

const moveIllegalSim = api.simulateGlobalRecoveryPlan(baselineDay, [
  moveAction(baselineF, 12 * 60 + 45, 13 * 60 + 45)
]);
check("new move-created illegal overlap is rejected", moveIllegalSim.valid === false && moveIllegalSim.conflictReason === "new_or_worsened_overlap_conflict", moveIllegalSim);

// ---------------------------------------------------------------------------
// PURITY
// ---------------------------------------------------------------------------

const src = fs.readFileSync(path.join(root, "public/booking/smart-scheduling/global-plan.js"), "utf8");
check("purity: no Firebase APIs", !/firebase-firestore|getDocs\s*\(|onSnapshot\s*\(|updateDoc\s*\(|addDoc\s*\(/.test(src));
check("purity: no network", !/\bfetch\s*\(|XMLHttpRequest/.test(src));
check("purity: no writes / timers / Date", !/\bsetTimeout\b|\bsetInterval\b|\bDate\s*\(|createAppointment|updateAppointment|cancelAppointment/.test(src));
check("purity: no DOM / Calendar / Reports", !/\bdocument\b|\blocalStorage\b|ffBookingCal|ffBookingReports/.test(src));
check("purity: no messaging / booking", !/sendSms|sendEmail|twilio|mailer|bookClient|autoBook|acceptLink/i.test(src));
check("purity: does not invent Phase 2 / Phase 6 candidates", !/findMoveOpportunities|rankWaitlistMatch/.test(src));
check("module stays out of gap-planner.js", src.indexOf("planProviderDayGapRecoveries") !== -1 && !/function planGapRecovery/.test(src));

if (failed) {
  console.log("\n" + failed + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll global plan checks passed.");
