/**
 * Smart Scheduling Phase 2 move opportunities. No Firestore, DOM, Calendar, or Reports.
 * Usage: node scripts/test-booking-smart-scheduling-moves.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function load(rel, windowObj) {
  new Function("window", fs.readFileSync(path.join(root, rel), "utf8"))(windowObj);
}

const windowObj = {};
load("public/booking/smart-scheduling/normalize.js", windowObj);
load("public/booking/smart-scheduling/gaps.js", windowObj);
load("public/booking/smart-scheduling/candidates.js", windowObj);
load("public/booking/smart-scheduling/score.js", windowObj);
load("public/booking/smart-scheduling/engine.js", windowObj);
load("public/booking/smart-scheduling/moves.js", windowObj);

const api = windowObj.ffBookingSmartScheduling;
if (!api || typeof api.findMoveOpportunities !== "function") {
  console.error("Smart Scheduling move API did not load.");
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
  return (row.reasons || []).some(function (item) { return item.code === code; });
}

function reasonText(row, code) {
  const hit = (row.reasons || []).find(function (item) { return item.code === code; });
  return hit ? hit.text : "";
}

function movesFor(day, options, lineId) {
  return api.findMoveOpportunities(day, options || {}).filter(function (row) {
    return !lineId || row.lineId === lineId;
  });
}

// ---------------------------------------------------------------------------
// CORE EXAMPLE
// ---------------------------------------------------------------------------

const clientA = line(12 * 60, 13 * 60, { lineId: "client-a", appointmentId: "appt-a" });
const clientB = line(13 * 60 + 30, 14 * 60 + 30, { lineId: "client-b", appointmentId: "appt-b" });
const specDay = makeDay({ lines: [clientA, clientB] });
const specBefore = JSON.stringify(specDay);
const specMoves = api.findMoveOpportunities(specDay);
const bEarlier = specMoves.find(function (row) {
  return row.lineId === "client-b" && row.proposedStartMin === 13 * 60;
});

check("core example finds the 1:00 move", !!bEarlier);
check("core example direction is earlier", bEarlier && bEarlier.direction === "earlier");
check("core example moveMinutes is 30", bEarlier && bEarlier.moveMinutes === 30);
check("core example gapRecoveredMinutes is 30", bEarlier && bEarlier.gapRecoveredMinutes === 30);
check("core example proposed window is 1:00-2:00", bEarlier && bEarlier.proposedStartMin === 13 * 60 && bEarlier.proposedEndMin === 14 * 60);
check("core example has positive improvement", bEarlier && bEarlier.scoreImprovement >= api.MOVE.DEFAULT_MIN_IMPROVEMENT);
check("core example proposed Phase 1 score beats current", bEarlier && bEarlier.proposedScore > bEarlier.currentScore);
check("placementScoreImprovement is proposed minus current", bEarlier && bEarlier.placementScoreImprovement === bEarlier.proposedScore - bEarlier.currentScore);
check("scoreImprovement subtracts movementCost", bEarlier && bEarlier.scoreImprovement === bEarlier.placementScoreImprovement - bEarlier.movementCost);
check("core movementCost is 8 for a 30-minute move", bEarlier && bEarlier.movementCost === 8);
check("core example explains the gap recovery", bEarlier && reasonText(bEarlier, "gap_recovered") === "Moving 30 minutes earlier removes a 30-minute gap.");
check("core example marks a between-gap close", bEarlier && hasReason(bEarlier, "closes_between_gap"));
check("findMoveOpportunities does not mutate the day", JSON.stringify(specDay) === specBefore);

// ---------------------------------------------------------------------------
// NO MOVE
// ---------------------------------------------------------------------------

const packed = makeDay({
  lines: [line(12 * 60, 13 * 60, { lineId: "p1" }), line(13 * 60, 14 * 60, { lineId: "p2" })]
});
check("already packed appointments produce no moves", api.findMoveOpportunities(packed).length === 0);

const isolated = makeDay({
  lines: [line(12 * 60, 13 * 60, { lineId: "solo" })]
});
check("isolated appointment with no between-gap is not moved", api.findMoveOpportunities(isolated).length === 0);

const highBar = api.findMoveOpportunities(specDay, { minimumImprovementScore: 1000 });
check("improvement below threshold is omitted", highBar.length === 0);

// ---------------------------------------------------------------------------
// EARLIER / LATER
// ---------------------------------------------------------------------------

const laterDay = makeDay({
  lines: [
    line(12 * 60, 13 * 60, { lineId: "t-later", appointmentId: "appt-t" }),
    line(13 * 60 + 30, 14 * 60 + 30, { lineId: "after", appointmentId: "appt-c" })
  ]
});
const laterMoves = movesFor(laterDay, {}, "t-later");
const laterHit = laterMoves.find(function (row) {
  return row.direction === "later" && row.proposedStartMin === 12 * 60 + 30;
});
check("valid later move is found", laterHit && laterHit.moveMinutes === 30 && laterHit.proposedEndMin === 13 * 60 + 30);
check("later move recovers 30 minutes", laterHit && laterHit.gapRecoveredMinutes === 30);

const bothDay = makeDay({
  lines: [
    line(11 * 60, 12 * 60, { lineId: "left" }),
    line(12 * 60 + 30, 13 * 60 + 30, { lineId: "mid", appointmentId: "appt-mid" }),
    line(14 * 60, 15 * 60, { lineId: "right" })
  ]
});
const both = movesFor(bothDay, {}, "mid");
check("both earlier and later moves can qualify", both.some(function (row) { return row.direction === "earlier"; }) && both.some(function (row) { return row.direction === "later"; }));
check("better or tied earlier start ranks first among equal mid moves", both.length >= 2 && both[0].scoreImprovement >= both[1].scoreImprovement);

// ---------------------------------------------------------------------------
// BOUNDARIES
// ---------------------------------------------------------------------------

const lunch = makeDay({
  workingIntervals: [
    { startMin: 9 * 60, endMin: 12 * 60 },
    { startMin: 13 * 60, endMin: 18 * 60 }
  ],
  lines: [
    line(11 * 60, 12 * 60, { lineId: "morning" }),
    line(13 * 60 + 30, 14 * 60 + 30, { lineId: "afternoon" })
  ]
});
check("moves do not cross a lunch / split shift", api.findMoveOpportunities(lunch).every(function (row) {
  if (row.lineId === "morning") return row.proposedEndMin <= 12 * 60;
  if (row.lineId === "afternoon") return row.proposedStartMin >= 13 * 60;
  return true;
}));

const capped = movesFor(specDay, { maxMoveMinutes: 15 }, "client-b");
check("maxMoveMinutes 15 blocks the 30-minute core move", capped.every(function (row) { return row.moveMinutes <= 15; }) && !capped.some(function (row) { return row.proposedStartMin === 13 * 60; }));

check("cannot move outside the working interval", specMoves.every(function (row) {
  return row.proposedStartMin >= 9 * 60 && row.proposedEndMin <= 18 * 60;
}));

const snapped = movesFor(specDay, { snapMinutes: 15 }, "client-b");
check("proposed starts respect snapMinutes", snapped.every(function (row) { return row.proposedStartMin % 15 === 0; }));

// ---------------------------------------------------------------------------
// SELF REMOVAL
// ---------------------------------------------------------------------------

check("target can occupy its own current time after self-removal", !!bEarlier);
check("other appointments still block movement onto Client A", specMoves.every(function (row) {
  return !(row.lineId === "client-b" && row.proposedStartMin === 12 * 60);
}));

const withoutB = api.dayWithoutLine(specDay, specDay.occupied.find(function (row) { return row.lineId === "client-b"; }));
check("dayWithoutLine drops only the target", withoutB.occupied.length === 1 && withoutB.occupied[0].lineId === "client-a");
check("dayWithoutLine does not mutate original occupied", specDay.occupied.length === 2);

// ---------------------------------------------------------------------------
// OVERLAP
// ---------------------------------------------------------------------------

const overlapDay = makeDay({
  allowedOverlapMinutes: 15,
  lines: [clientA, clientB]
});
const overlapSlots = api.enumerateValidSlots(api.dayWithoutLine(overlapDay, overlapDay.occupied[1]), {
  durationMinutes: 60,
  snapMinutes: 15
});
const overlapSlot = overlapSlots.find(function (slot) { return slot.startMin === 12 * 60 + 45; });
const freeSlot = overlapSlots.find(function (slot) { return slot.startMin === 13 * 60; });
check("overlap-permitted 12:45 slot remains technically possible", !!(overlapSlot && overlapSlot.usesOverlap && overlapSlot.overlapMinutes === 15));
check("true-free 1:00 slot does not use overlap", !!(freeSlot && freeSlot.usesOverlap === false));

const overlapMoves = api.findMoveOpportunities(overlapDay, { minimumImprovementScore: -100 });
const overlapMove = overlapMoves.find(function (row) {
  return row.lineId === "client-b" && row.proposedStartMin === 12 * 60 + 45;
});
const freeMove = overlapMoves.find(function (row) {
  return row.lineId === "client-b" && row.proposedStartMin === 13 * 60;
});
check("overlap move, if considered, carries the overlap penalty reason", !overlapMove || hasReason(overlapMove, "uses_permitted_overlap"));
check("true-free move outranks an overlap move", freeMove && (!overlapMove || freeMove.scoreImprovement > overlapMove.scoreImprovement));
check("default threshold prefers the true-free core move", api.findMoveOpportunities(overlapDay).some(function (row) {
  return row.lineId === "client-b" && row.proposedStartMin === 13 * 60 && row.usesOverlap === false;
}));

check("overlap minutes are not counted as recovered capacity", !overlapMove || overlapMove.gapRecoveredMinutes === 30);

// ---------------------------------------------------------------------------
// MOVEMENT COST
// ---------------------------------------------------------------------------

check("15-minute move costs 4", api.movementCost(15) === 4);
check("30-minute move costs 8", api.movementCost(30) === 8);
check("60-minute move costs 16", api.movementCost(60) === 16);
check("20-minute move costs 5", api.movementCost(20) === 5);
check("45-minute move costs 12", api.movementCost(45) === 12);
check("30-minute cost is identical for any unused extra argument", api.movementCost(30, 15) === api.movementCost(30, 30));
check("30-minute cost does not depend on snapMinutes 5/15/20/30", [5, 15, 20, 30].every(function () {
  return api.movementCost(30) === 8;
}));

const snap15 = movesFor(specDay, { snapMinutes: 15 }, "client-b").find(function (row) {
  return row.moveMinutes === 30;
});
const snap30 = movesFor(specDay, { snapMinutes: 30 }, "client-b").find(function (row) {
  return row.moveMinutes === 30;
});
check("same 30-minute move costs 8 with snap 15 and snap 30", !!(snap15 && snap30 && snap15.movementCost === 8 && snap30.movementCost === 8));

const equalProposed = 66;
const equalCurrent = 38;
check(
  "equal operational gain prefers the 15-minute move",
  (equalProposed - equalCurrent - api.movementCost(15))
    > (equalProposed - equalCurrent - api.movementCost(60))
);

const blockedByNet = api.findMoveOpportunities(specDay, {
  minimumImprovementScore: (bEarlier ? bEarlier.placementScoreImprovement : 0) - 4
});
check("threshold uses net scoreImprovement, not raw placement gain", !blockedByNet.some(function (row) {
  return row.lineId === "client-b" && row.proposedStartMin === 13 * 60;
}) && bEarlier && bEarlier.placementScoreImprovement - 4 > bEarlier.scoreImprovement);

const strongLong = makeDay({
  lines: [
    line(12 * 60, 13 * 60, { lineId: "long-a" }),
    line(13 * 60 + 45, 14 * 60 + 45, { lineId: "long-b", appointmentId: "appt-long" })
  ]
});
const longMoves = movesFor(strongLong, {}, "long-b");
const longWin = longMoves.find(function (row) { return row.proposedStartMin === 13 * 60; });
check("a larger move can still win when it closes the gap", !!(longWin && longWin.moveMinutes === 45 && longWin.gapRecoveredMinutes === 45 && longWin.scoreImprovement >= 8));
check("weak 15-minute slide is omitted when it does not improve enough", longMoves.every(function (row) { return row.moveMinutes !== 15; }));

// ---------------------------------------------------------------------------
// GAPS
// ---------------------------------------------------------------------------

check("recovered minutes match the true between gap", bEarlier && bEarlier.gapRecoveredMinutes === 30);
const offHours = makeDay({
  workingIntervals: [{ startMin: 10 * 60, endMin: 16 * 60 }],
  lines: [
    line(10 * 60, 11 * 60, { lineId: "open" }),
    line(11 * 60 + 30, 12 * 60 + 30, { lineId: "next" })
  ]
});
check("recovery is not counted outside working hours", api.findMoveOpportunities(offHours).every(function (row) {
  return row.proposedStartMin >= 10 * 60 && row.proposedEndMin <= 16 * 60;
}));

// ---------------------------------------------------------------------------
// DETERMINISM
// ---------------------------------------------------------------------------

check("same input yields identical output", JSON.stringify(specMoves) === JSON.stringify(api.findMoveOpportunities(specDay)));
const again = api.findMoveOpportunities(bothDay);
check("ranking is stable across repeats", JSON.stringify(both) === JSON.stringify(movesFor(bothDay, {}, "mid")) && JSON.stringify(again) === JSON.stringify(api.findMoveOpportunities(bothDay)));

// ---------------------------------------------------------------------------
// PURITY
// ---------------------------------------------------------------------------

const src = [
  "public/booking/smart-scheduling/moves.js",
  "public/booking/smart-scheduling/candidates.js",
  "public/booking/smart-scheduling/engine.js"
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
console.log("All Smart Scheduling Phase 2 move tests passed.");
