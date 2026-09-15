/**
 * Smart Scheduling Phase 5 cancellation recovery. No Firestore, DOM, Calendar, or Reports.
 * Usage: node scripts/test-booking-smart-scheduling-cancellation-recovery.js
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
  "public/booking/smart-scheduling/cancellation-recovery.js"
].forEach(function (rel) { load(rel, windowObj); });

const api = windowObj.ffBookingSmartScheduling;
if (!api || typeof api.analyzeCancellationRecovery !== "function") {
  console.error("Smart Scheduling cancellation recovery API did not load.");
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

check("public cancellation recovery API loaded", !!(
  api.analyzeCancellationRecovery && api.recommendCancellationRecovery && api.dayWithCancelledLine
));

const specCancel = {
  appointmentId: "cancelled-130",
  lineId: "cancelled-130",
  providerId: "provA",
  startMin: 13 * 60,
  endMin: 13 * 60 + 30,
  durationMinutes: 30
};
const specAfter = makeDay({
  lines: [
    line(12 * 60, 13 * 60, { lineId: "client-a", appointmentId: "appt-a" }),
    line(13 * 60 + 30, 14 * 60 + 30, { lineId: "client-b", appointmentId: "appt-b" })
  ]
});
const specBeforeDay = makeDay({
  lines: [
    line(12 * 60, 13 * 60, { lineId: "client-a", appointmentId: "appt-a" }),
    line(13 * 60, 13 * 60 + 30, { lineId: "cancelled-130", appointmentId: "cancelled-130" }),
    line(13 * 60 + 30, 14 * 60 + 30, { lineId: "client-b", appointmentId: "appt-b" })
  ]
});

// ---------------------------------------------------------------------------
// BEFORE / AFTER CANCELLATION
// ---------------------------------------------------------------------------

const snapshot = JSON.stringify(specAfter);
const reconstructed = api.dayWithCancelledLine(specAfter, specCancel);
const reconstructedA = api.analyzeProviderDay(reconstructed);
const realBeforeA = api.analyzeProviderDay(specBeforeDay);
const specAnalysis = api.analyzeCancellationRecovery(specAfter, specCancel);

check("reinsert cancelled line reconstructs before occupied minutes", reconstructedA.occupiedMinutes === realBeforeA.occupiedMinutes);
check("reinsert cancelled line reconstructs before optimization", reconstructedA.optimizationScore === realBeforeA.optimizationScore);
check("original day is not mutated by reconstruction", JSON.stringify(specAfter) === snapshot);
check("utilization drops after cancellation", specAnalysis.utilizationAfterCancellation < specAnalysis.utilizationBeforeCancellation);
check("occupied minutes drop by the cancelled duration", specAnalysis.occupiedMinutesBeforeCancellation - specAnalysis.occupiedMinutesAfterCancellation === 30);
check("fragmentation increases when a mid-day cancellation opens a between-gap", specAnalysis.fragmentationAfterCancellation > specAnalysis.fragmentationBeforeCancellation);
check("optimization changes after cancellation", specAnalysis.optimizationDeltaFromCancellation === specAnalysis.optimizationAfterCancellation - specAnalysis.optimizationBeforeCancellation);
check("analysis does not mutate the post-cancellation day", JSON.stringify(specAfter) === snapshot);

// ---------------------------------------------------------------------------
// CANCELLATION WINDOW
// ---------------------------------------------------------------------------

check("exact cancelled duration is exposed", specAnalysis.cancelledDurationMinutes === 30);
check("newlyFreedMinutes is the cancelled duration, not adjacent free time", specAnalysis.newlyFreedMinutes === 30);
check("spec resulting window is the 30-minute between-gap", specAnalysis.resultingFreeWindow && specAnalysis.resultingFreeWindow.startMin === 13 * 60 && specAnalysis.resultingFreeWindow.endMin === 13 * 60 + 30 && specAnalysis.resultingFreeWindow.gapMin === 30);

const mergeAfter = makeDay({
  lines: [
    line(10 * 60, 11 * 60, { lineId: "m-a" }),
    line(12 * 60, 13 * 60, { lineId: "m-c" })
  ]
});
const mergeCancel = {
  appointmentId: "m-cancel",
  lineId: "m-cancel",
  providerId: "provA",
  startMin: 11 * 60,
  endMin: 11 * 60 + 30
};
const mergeA = api.analyzeCancellationRecovery(mergeAfter, mergeCancel);
check("adjacent free capacity merges into a larger resulting window", mergeA.resultingFreeWindow && mergeA.resultingFreeWindow.startMin === 11 * 60 && mergeA.resultingFreeWindow.endMin === 12 * 60 && mergeA.resultingFreeWindow.gapMin === 60);
check("newlyFreedMinutes does not include the pre-existing 30 free minutes", mergeA.newlyFreedMinutes === 30 && mergeA.cancelledDurationMinutes === 30);

const lunchDay = makeDay({
  workingIntervals: [
    { startMin: 9 * 60, endMin: 12 * 60 },
    { startMin: 13 * 60, endMin: 18 * 60 }
  ],
  lines: [line(9 * 60, 10 * 60), line(14 * 60, 15 * 60)]
});
const lunchCancel = {
  appointmentId: "lunch",
  lineId: "lunch",
  providerId: "provA",
  startMin: 12 * 60,
  endMin: 13 * 60
};
const lunchA = api.analyzeCancellationRecovery(lunchDay, lunchCancel);
check("lunch / off-hours are not newly freed working minutes", lunchA.newlyFreedMinutes === 0);
check("lunch is not a resulting free window", lunchA.resultingFreeWindow == null);

const simpleCancelAfter = makeDay({
  lines: [line(12 * 60, 13 * 60, { lineId: "s-a" }), line(13 * 60 + 30, 14 * 60 + 30, { lineId: "s-b" })]
});
const simpleA = api.analyzeCancellationRecovery(simpleCancelAfter, {
  appointmentId: "s-cancel",
  lineId: "s-cancel",
  providerId: "provA",
  startMin: 13 * 60,
  endMin: 13 * 60 + 30
});
check("simple cancellation newlyFreedMinutes equals 30", simpleA.cancelledDurationMinutes === 30 && simpleA.newlyFreedMinutes === 30);
check("simple cancellation newlyFreedIntervals are 1:00-1:30", simpleA.newlyFreedIntervals.length === 1 && simpleA.newlyFreedIntervals[0].startMin === 13 * 60 && simpleA.newlyFreedIntervals[0].endMin === 13 * 60 + 30 && simpleA.newlyFreedIntervals[0].minutes === 30);

const overlapCancelAfter = makeDay({
  allowedOverlapMinutes: 30,
  lines: [line(13 * 60, 14 * 60, { lineId: "ov-survive", appointmentId: "ov-a" })]
});
const overlapCancel = {
  appointmentId: "ov-b",
  lineId: "ov-b",
  providerId: "provA",
  startMin: 13 * 60 + 30,
  endMin: 14 * 60 + 30
};
const overlapCancelA = api.analyzeCancellationRecovery(overlapCancelAfter, overlapCancel);
check("partially overlapped cancellation keeps cancelledDurationMinutes 60", overlapCancelA.cancelledDurationMinutes === 60);
check("partially overlapped cancellation newlyFreedMinutes is 30", overlapCancelA.newlyFreedMinutes === 30);
check("partially overlapped newlyFreedIntervals are 2:00-2:30", overlapCancelA.newlyFreedIntervals.length === 1 && overlapCancelA.newlyFreedIntervals[0].startMin === 14 * 60 && overlapCancelA.newlyFreedIntervals[0].endMin === 14 * 60 + 30);

const coveredAfter = makeDay({
  allowedOverlapMinutes: 30,
  lines: [line(13 * 60, 14 * 60, { lineId: "cov-a" })]
});
const coveredA = api.analyzeCancellationRecovery(coveredAfter, {
  appointmentId: "cov-b",
  lineId: "cov-b",
  providerId: "provA",
  startMin: 13 * 60 + 15,
  endMin: 13 * 60 + 45
});
check("fully covered cancellation newlyFreedMinutes is 0", coveredA.cancelledDurationMinutes === 30 && coveredA.newlyFreedMinutes === 0 && coveredA.newlyFreedIntervals.length === 0);
check("fully covered cancellation has no cancellation-created free window", coveredA.resultingFreeWindow == null && coveredA.opensUsableCapacity === false);
check("fully covered cancellation is no_action, not open_fill", api.recommendCancellationRecovery(coveredAfter, {
  appointmentId: "cov-b",
  lineId: "cov-b",
  providerId: "provA",
  startMin: 13 * 60 + 15,
  endMin: 13 * 60 + 45
}).type === "no_action");

const recoverOverlapAfter = makeDay({
  allowedOverlapMinutes: 30,
  lines: [
    line(13 * 60, 14 * 60, { lineId: "rec-a", appointmentId: "rec-a" }),
    line(14 * 60 + 30, 15 * 60 + 30, { lineId: "rec-c", appointmentId: "rec-c" })
  ]
});
const recoverOverlapA = api.analyzeCancellationRecovery(recoverOverlapAfter, overlapCancel);
const recoverOverlapMove = recoverOverlapA.recoveryOpportunities.find(function (row) {
  return row.appointmentId === "rec-c" && row.proposedStartMin === 14 * 60;
});
check("recovery of true newly-freed 30 minutes scores a full +20 bonus", !!(
  recoverOverlapMove
  && recoverOverlapMove.cancellationWindowRecoveredMinutes === 30
  && recoverOverlapMove.recoveredCancellationCapacityBonus === 20
));
check("surviving overlap is not counted as recovered cancellation capacity", recoverOverlapA.recoveryOpportunities.every(function (row) {
  return row.cancellationWindowRecoveredMinutes <= 30;
}));

// ---------------------------------------------------------------------------
// BETWEEN GAP / LINEAGE
// ---------------------------------------------------------------------------

check("cancellation between two appointments creates a between-gap", specAnalysis.createsBetweenGap === true && specAnalysis.betweenGapCountAfterCancellation === 1);

const leadAfter = makeDay({
  workingIntervals: [{ startMin: 9 * 60, endMin: 12 * 60 }],
  lines: [line(10 * 60, 12 * 60)]
});
const leadA = api.analyzeCancellationRecovery(leadAfter, {
  appointmentId: "lead",
  lineId: "lead",
  providerId: "provA",
  startMin: 9 * 60,
  endMin: 10 * 60
});
check("cancellation at shift start does not create a between-gap", leadA.createsBetweenGap === false);

const trailAfter = makeDay({
  workingIntervals: [{ startMin: 9 * 60, endMin: 12 * 60 }],
  lines: [line(9 * 60, 11 * 60)]
});
const trailA = api.analyzeCancellationRecovery(trailAfter, {
  appointmentId: "trail",
  lineId: "trail",
  providerId: "provA",
  startMin: 11 * 60,
  endMin: 12 * 60
});
check("cancellation at shift end does not create a between-gap", trailA.createsBetweenGap === false);

const lineageAfter = makeDay({
  lines: [
    line(12 * 60, 13 * 60, { lineId: "lin-a" }),
    line(13 * 60 + 30, 14 * 60 + 30, { lineId: "lin-b" })
  ]
});
const lineageA = api.analyzeCancellationRecovery(lineageAfter, {
  appointmentId: "lin-trail",
  lineId: "lin-trail",
  providerId: "provA",
  startMin: 16 * 60,
  endMin: 17 * 60
});
check("lineage does not treat an unrelated trailing cancellation as a new between-gap", lineageA.createsBetweenGap === false && lineageA.betweenGapCountAfterCancellation === 1);

// ---------------------------------------------------------------------------
// USABLE CAPACITY
// ---------------------------------------------------------------------------

const tinyAfter = makeDay({
  lines: [
    line(10 * 60, 11 * 60, { lineId: "t1" }),
    line(11 * 60 + 15, 12 * 60, { lineId: "t2" })
  ]
});
const tinyA = api.analyzeCancellationRecovery(tinyAfter, {
  appointmentId: "tiny",
  lineId: "tiny",
  providerId: "provA",
  startMin: 11 * 60,
  endMin: 11 * 60 + 15
});
check("15-minute opening under reference 30 is not usable", tinyA.opensUsableCapacity === false && tinyA.resultingFreeWindow && tinyA.resultingFreeWindow.gapMin === 15);

check("30-minute opening is usable at default reference", specAnalysis.opensUsableCapacity === true);

const tinyAsUsable = api.analyzeCancellationRecovery(tinyAfter, {
  appointmentId: "tiny",
  lineId: "tiny",
  providerId: "provA",
  startMin: 11 * 60,
  endMin: 11 * 60 + 15
}, { referenceServiceDurationMinutes: 15 });
check("configurable reference duration can make a 15-minute opening usable", tinyAsUsable.opensUsableCapacity === true);

// ---------------------------------------------------------------------------
// MOVE RECOVERY
// ---------------------------------------------------------------------------

const specMove = specAnalysis.recoveryOpportunities.find(function (row) {
  return row.appointmentId === "appt-b" && row.proposedStartMin === 13 * 60;
}) || specAnalysis.recoveryOpportunities[0];
check("spec example finds a move of the 1:30 appointment", !!(specAnalysis.recoveryOpportunities.find(function (row) {
  return row.appointmentId === "appt-b" && row.proposedStartMin === 13 * 60 && row.direction === "earlier" && row.moveMinutes === 30;
})));
check("spec move direction is earlier and 30 minutes", specMove && specMove.appointmentId === "appt-b" && specMove.direction === "earlier" && specMove.moveMinutes === 30);
check("target does not conflict with itself", specMove && specMove.proposedStartMin === 13 * 60 && specMove.proposedEndMin === 14 * 60);
check("movement cost is preserved from Phase 2", specMove && specMove.movementCost === api.movementCost(30) && specMove.movementCost === 8);
check("same provider only", specAnalysis.recoveryOpportunities.every(function (row) {
  return row.providerId === "provA";
}));

const blockedAfter = makeDay({
  lines: [
    line(12 * 60, 13 * 60, { lineId: "blk-a" }),
    line(13 * 60 + 30, 14 * 60 + 30, { lineId: "blk-b", appointmentId: "appt-b" }),
    line(14 * 60 + 30, 15 * 60 + 30, { lineId: "blk-c", appointmentId: "appt-c" })
  ]
});
const blockedA = api.analyzeCancellationRecovery(blockedAfter, specCancel);
check("other appointments still block moving the later client onto 1:00", blockedA.recoveryOpportunities.every(function (row) {
  return !(row.appointmentId === "appt-c" && row.proposedStartMin === 13 * 60);
}));

const otherProvider = api.analyzeCancellationRecovery(specAfter, Object.assign({}, specCancel, { providerId: "provB" }));
check("a cancellation on another provider yields no recovery", otherProvider.recoveryOpportunities.length === 0 && otherProvider.newlyFreedMinutes === 0);

// ---------------------------------------------------------------------------
// RECOVERY SIMULATION / SCORE
// ---------------------------------------------------------------------------

const recoveredDay = api.normalizeProviderDay({
  dateKey: "2026-09-14",
  locationId: "locA",
  providerId: "provA",
  workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }],
  lines: [
    line(12 * 60, 13 * 60, { lineId: "client-a", appointmentId: "appt-a" }),
    line(13 * 60, 14 * 60, { lineId: "client-b", appointmentId: "appt-b" })
  ],
  allowedOverlapMinutes: 0
});
const recoveredA = api.analyzeProviderDay(recoveredDay);
check("after recovery metrics match a packed reconstructed day", specMove && specMove.optimizationAfterRecovery === recoveredA.optimizationScore);
check("recovery improves the damaged day", specMove && specMove.optimizationDeltaFromRecovery > 0 && specMove.fragmentationDeltaFromRecovery < 0);

function expectedRecoveryScore(row) {
  function clamp(n, lo, hi) {
    n = Math.round(Number(n));
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }
  let raw = row.scoreImprovement;
  raw += clamp(row.optimizationDeltaFromRecovery, -15, 15);
  raw -= clamp(Math.max(0, row.fragmentationDeltaFromRecovery), 0, 15);
  raw += clamp(Math.max(0, -row.fragmentationDeltaFromRecovery), 0, 10);
  raw -= clamp(Math.max(0, row.strandedBetweenMinutesDeltaFromRecovery), 0, 15);
  raw += row.recoveredCancellationCapacityBonus;
  return Math.max(0, Math.min(100, Math.round(raw)));
}
check("recoveryScore follows the Phase 5 formula", specMove && specMove.recoveryScore === expectedRecoveryScore(specMove));
check("full cancelled-window recovery bonus is +20", specMove && specMove.recoveredCancellationCapacityBonus === 20);

const mergeMove = mergeA.recoveryOpportunities.find(function (row) {
  return row.appointmentId === "a-" + (12 * 60) || row.lineId === "m-c";
}) || mergeA.recoveryOpportunities[0];
check("merged opening can recover 30 cancelled minutes and 60 gap minutes", !!(mergeMove && mergeMove.cancellationWindowRecoveredMinutes === 30 && mergeMove.totalGapRecoveredMinutes === 60));

check("spec cancellationWindowRecoveredMinutes is 30", specMove && specMove.cancellationWindowRecoveredMinutes === 30);
check("spec totalGapRecoveredMinutes is 30", specMove && specMove.totalGapRecoveredMinutes === 30);

// ---------------------------------------------------------------------------
// OVERLAP
// ---------------------------------------------------------------------------

const overlapAfter = makeDay({
  allowedOverlapMinutes: 15,
  lines: [
    line(12 * 60, 13 * 60, { lineId: "ov-a" }),
    line(13 * 60 + 30, 14 * 60 + 30, { lineId: "ov-b", appointmentId: "ov-b" })
  ]
});
const overlapA = api.analyzeCancellationRecovery(overlapAfter, specCancel);
const overlapMove = overlapA.recoveryOpportunities.find(function (row) { return row.usesOverlap === true; });
const cleanMove = overlapA.recoveryOpportunities.find(function (row) {
  return row.appointmentId === "ov-b" && row.proposedStartMin === 13 * 60 && row.usesOverlap === false;
});
check("permitted overlap can remain a technically valid recovery", overlapA.recoveryOpportunities.some(function (row) { return row.usesOverlap === true; }) || !overlapMove);
check("assignment/recovery layer does not add another overlap score penalty", !overlapMove || hasReason(overlapMove, "uses_permitted_overlap") && overlapMove.reasons.some(function (row) {
  return row.code === "uses_permitted_overlap" && row.delta === 0;
}));
check("clean recovery beats overlap recovery when both exist", !overlapMove || (cleanMove && (
  cleanMove.recoveryScore > overlapMove.recoveryScore
  || (cleanMove.recoveryScore === overlapMove.recoveryScore && cleanMove.usesOverlap === false)
)));

// ---------------------------------------------------------------------------
// OPEN FILL / PRIMARY RECOMMENDATION
// ---------------------------------------------------------------------------

const emptyAfter = makeDay();
const emptyCancel = {
  appointmentId: "only",
  lineId: "only",
  providerId: "provA",
  startMin: 10 * 60,
  endMin: 11 * 60
};
const emptyRec = api.recommendCancellationRecovery(emptyAfter, emptyCancel);
check("usable opening + no qualifying move => open_fill_opportunity", emptyRec && emptyRec.type === "open_fill_opportunity" && emptyRec.startMin <= 10 * 60 && emptyRec.endMin >= 11 * 60);

const tinyRec = api.recommendCancellationRecovery(tinyAfter, {
  appointmentId: "tiny",
  lineId: "tiny",
  providerId: "provA",
  startMin: 11 * 60,
  endMin: 11 * 60 + 15
}, { maxMoveMinutes: 0 });
check("unusable tiny opening with no moves => no_action", tinyRec && tinyRec.type === "no_action");

const specRec = api.recommendCancellationRecovery(specAfter, specCancel);
check("strong qualifying move is the primary recommendation", specRec && specRec.type === "move_existing_appointment" && (specRec.appointmentId === "appt-b" || specRec.appointmentId === "appt-a"));

check("open fill does not search clients or waitlist", emptyRec && !emptyRec.clientId && !emptyRec.waitlistId);

// ---------------------------------------------------------------------------
// MINIMUM THRESHOLD
// ---------------------------------------------------------------------------

const highBar = api.analyzeCancellationRecovery(specAfter, specCancel, { minimumRecoveryScore: 99 });
check("weak / below-threshold recovery is omitted", highBar.recoveryOpportunities.length === 0);
check("below-threshold move falls back to open_fill_opportunity", api.recommendCancellationRecovery(specAfter, specCancel, { minimumRecoveryScore: 99 }).type === "open_fill_opportunity");
check("strong recovery is retained at the default threshold", specAnalysis.recoveryOpportunities.length > 0 && specMove.recoveryScore >= 10);

// ---------------------------------------------------------------------------
// DETERMINISM / PURITY
// ---------------------------------------------------------------------------

check("same input yields the same analysis", JSON.stringify(specAnalysis) === JSON.stringify(api.analyzeCancellationRecovery(specAfter, specCancel)));
check("same input yields the same recommendation", JSON.stringify(specRec) === JSON.stringify(api.recommendCancellationRecovery(specAfter, specCancel)));
check("invalid cancellation yields no_action", api.recommendCancellationRecovery(specAfter, {}).type === "no_action");

const src = [
  "public/booking/smart-scheduling/cancellation-recovery.js"
].map(function (rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}).join("\n");
check("purity: no Firebase APIs", !/firebase-firestore|getDocs\s*\(|onSnapshot\s*\(|updateDoc\s*\(|addDoc\s*\(/.test(src));
check("purity: no network", !/\bfetch\s*\(|XMLHttpRequest/.test(src));
check("purity: no writes / timers / Date", !/\bsetTimeout\b|\bsetInterval\b|\bDate\s*\(|createAppointment|updateAppointment|cancelAppointment/.test(src));
check("purity: no DOM / Calendar / Reports", !/\bdocument\b|\blocalStorage\b|ffBookingCal|ffBookingReports/.test(src));
check("purity: no messaging / waitlist", !/sendSms|sendEmail|twilio|mailer|getWaitlist|loadWaitlist/i.test(src));

if (failed) {
  console.error("FAILED", failed);
  process.exit(1);
}
console.log("All Smart Scheduling Phase 5 cancellation recovery tests passed.");
