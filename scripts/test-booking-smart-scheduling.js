/**
 * Smart Scheduling Phase 1. No Firestore, DOM, Calendar, or Reports.
 * Usage: node scripts/test-booking-smart-scheduling.js
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

const api = windowObj.ffBookingSmartScheduling;
if (!api) {
  console.error("Smart Scheduling engine did not load.");
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
  const row = Object.assign({
    lineId: "l-" + startMin + "-" + endMin,
    appointmentId: "a-" + startMin,
    providerId: "provA",
    startMin: startMin,
    endMin: endMin,
    status: "scheduled"
  }, extra || {});
  return row;
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

function reasonCodes(scored) {
  return (scored.reasons || []).map(function (row) { return row.code; });
}

function hasReason(scored, code) {
  return reasonCodes(scored).indexOf(code) !== -1;
}

function deltaOf(scored, code) {
  const hit = (scored.reasons || []).find(function (row) { return row.code === code; });
  return hit ? hit.delta : null;
}

function startsOf(slots) {
  return (slots || []).map(function (row) { return row.startMin; });
}

check("public API loaded", !!(
  api.normalizeProviderDay && api.findFreeGaps && api.enumerateValidSlots && api.scoreSlot && api.rankSlots
));

// ---------------------------------------------------------------------------
// NORMALIZATION
// ---------------------------------------------------------------------------

const empty = makeDay();
check("empty day keeps working interval", empty.workingIntervals.length === 1 && empty.workingIntervals[0].startMin === 540);
check("empty day has no occupied lines", empty.occupied.length === 0);
check("IDs are trimmed", makeDay({
  providerId: "  provA  ",
  locationId: " locA ",
  dateKey: " 2026-09-14 "
}).providerId === "provA");

const mixed = makeDay({
  lines: [
    line(13 * 60, 14 * 60, { status: "cancelled", lineId: "cancelled" }),
    line(10 * 60, 11 * 60, { status: "completed", lineId: "completed" }),
    line(15 * 60, 16 * 60, { status: "no_show", lineId: "noshow" }),
    line(12 * 60, 13 * 60, { status: "scheduled", lineId: "scheduled", providerId: "  provA " }),
    line(11 * 60, 12 * 60, { providerId: "other", lineId: "other" })
  ]
});
check("cancelled does not occupy", mixed.occupied.every(function (row) { return row.lineId !== "cancelled"; }));
check("completed occupies", mixed.occupied.some(function (row) { return row.lineId === "completed"; }));
check("no_show occupies", mixed.occupied.some(function (row) { return row.lineId === "noshow"; }));
check("other provider excluded", mixed.occupied.every(function (row) { return row.providerId === "provA"; }));
check(
  "occupied sorted by start",
  mixed.occupied.map(function (row) { return row.lineId; }).join(",") === "completed,scheduled,noshow"
);

const overlapOcc = makeDay({
  lines: [
    line(12 * 60, 13 * 60 + 30, { lineId: "late" }),
    line(12 * 60 + 30, 14 * 60, { lineId: "early" })
  ]
});
check("overlapping occupied lines are both kept", overlapOcc.occupied.length === 2);
check(
  "overlap does not shrink real busy time",
  overlapOcc.occupied[0].startMin === 12 * 60 && overlapOcc.occupied[0].endMin === 13 * 60 + 30
);

const outside = makeDay({
  workingIntervals: [{ startMin: 10 * 60, endMin: 18 * 60 }],
  lines: [
    line(8 * 60, 9 * 60, { lineId: "before" }),
    line(9 * 60 + 30, 10 * 60 + 30, { lineId: "partial" })
  ]
});
check("line entirely outside working hours is still recorded", outside.occupied.some(function (row) {
  return row.lineId === "before";
}));
const outsideGaps = api.findFreeGaps(outside);
check("outside line does not create working time", outsideGaps.every(function (gap) {
  return gap.startMin >= 10 * 60;
}));
check("partial outside line clips into the working interval", outsideGaps[0] && outsideGaps[0].startMin === 10 * 60 + 30);

const splitWork = makeDay({
  workingIntervals: [
    { startMin: 13 * 60, endMin: 18 * 60 },
    { startMin: 9 * 60, endMin: 12 * 60 }
  ]
});
check(
  "working intervals sort but stay split",
  splitWork.workingIntervals.length === 2
    && splitWork.workingIntervals[0].endMin === 12 * 60
    && splitWork.workingIntervals[1].startMin === 13 * 60
);

check("unknown overlap allowance falls back to 0", makeDay({ allowedOverlapMinutes: 99 }).allowedOverlapMinutes === 0);
check("15 overlap allowance is kept", makeDay({ allowedOverlapMinutes: 15 }).allowedOverlapMinutes === 15);
check("other-day line is dropped", makeDay({
  lines: [line(10 * 60, 11 * 60, { dateKey: "2026-09-15" })]
}).occupied.length === 0);

// ---------------------------------------------------------------------------
// GAPS
// ---------------------------------------------------------------------------

const specExample = makeDay({
  lines: [
    line(12 * 60, 13 * 60, { lineId: "client-a" }),
    line(13 * 60 + 30, 14 * 60 + 30, { lineId: "client-b" })
  ]
});
const specGaps = api.findFreeGaps(specExample);
const between = specGaps.find(function (gap) { return gap.kind === "between"; });
check("spec example has a 30-minute between gap", !!(between && between.gapMin === 30 && between.startMin === 13 * 60 && between.endMin === 13 * 60 + 30));
check("spec example also has leading and trailing gaps", specGaps.some(function (g) { return g.kind === "leading"; }) && specGaps.some(function (g) { return g.kind === "trailing"; }));
check("between gap names neighbors", between && between.beforeLineId === "client-a" && between.afterLineId === "client-b");

const backToBack = api.findFreeGaps(makeDay({
  lines: [line(12 * 60, 13 * 60), line(13 * 60, 14 * 60)]
}));
check("back-to-back appointments produce no between gap", backToBack.every(function (gap) { return gap.kind !== "between"; }));

const leadingOnly = api.findFreeGaps(makeDay({
  workingIntervals: [{ startMin: 9 * 60, endMin: 12 * 60 }],
  lines: [line(10 * 60, 12 * 60)]
}));
check("leading unused working time is a leading gap", leadingOnly.length === 1 && leadingOnly[0].kind === "leading" && leadingOnly[0].gapMin === 60);

const trailingOnly = api.findFreeGaps(makeDay({
  workingIntervals: [{ startMin: 9 * 60, endMin: 12 * 60 }],
  lines: [line(9 * 60, 10 * 60)]
}));
check("trailing unused working time is a trailing gap", trailingOnly.length === 1 && trailingOnly[0].kind === "trailing" && trailingOnly[0].gapMin === 120);

const emptyGaps = api.findFreeGaps(empty);
check(
  "empty provider day exposes the working interval",
  emptyGaps.length === 1 && emptyGaps[0].startMin === 9 * 60 && emptyGaps[0].endMin === 18 * 60 && emptyGaps[0].gapMin === 9 * 60
);

const full = api.findFreeGaps(makeDay({
  lines: [line(9 * 60, 18 * 60)]
}));
check("fully occupied interval has no gaps", full.length === 0);

const stackedGaps = api.findFreeGaps(makeDay({
  lines: [
    line(12 * 60, 13 * 60 + 30, { lineId: "a" }),
    line(13 * 60, 14 * 60, { lineId: "b" })
  ]
}));
check(
  "overlapping occupied lines merge so no invalid gap appears",
  stackedGaps.every(function (gap) {
    return !(gap.startMin >= 12 * 60 && gap.endMin <= 14 * 60 && gap.kind === "between");
  })
);

const lunch = makeDay({
  workingIntervals: [
    { startMin: 9 * 60, endMin: 12 * 60 },
    { startMin: 13 * 60, endMin: 18 * 60 }
  ],
  lines: [line(11 * 60, 11 * 60 + 30)]
});
const lunchGaps = api.findFreeGaps(lunch);
check("no gap across lunch", lunchGaps.every(function (gap) {
  return !(gap.startMin < 12 * 60 && gap.endMin > 13 * 60);
}));
check("split shifts produce independent free windows", lunchGaps.some(function (gap) {
  return gap.workingIntervalIndex === 0;
}) && lunchGaps.some(function (gap) {
  return gap.workingIntervalIndex === 1 && gap.startMin === 13 * 60 && gap.endMin === 18 * 60;
}));

const threeShifts = api.findFreeGaps(makeDay({
  workingIntervals: [
    { startMin: 9 * 60, endMin: 12 * 60 },
    { startMin: 13 * 60, endMin: 17 * 60 },
    { startMin: 18 * 60, endMin: 20 * 60 }
  ]
}));
check("three split shifts yield three free windows", threeShifts.length === 3);
check("gaps stay in working-interval order", threeShifts[0].workingIntervalIndex === 0 && threeShifts[2].workingIntervalIndex === 2);

// ---------------------------------------------------------------------------
// CANDIDATES
// ---------------------------------------------------------------------------

const hole30 = makeDay({
  lines: [
    line(9 * 60, 10 * 60 + 30),
    line(11 * 60, 18 * 60)
  ]
});
check(
  "60-minute service cannot fit a 30-minute true opening when overlap is 0",
  api.enumerateValidSlots(hole30, { durationMinutes: 60 }).length === 0
);

const hole30overlap = makeDay({
  allowedOverlapMinutes: 15,
  lines: [
    line(9 * 60, 10 * 60 + 30, { lineId: "left" }),
    line(11 * 60, 18 * 60, { lineId: "right" })
  ]
});
const overlap60 = api.enumerateValidSlots(hole30overlap, { durationMinutes: 60 });
check("60-minute service can use 15+15 permitted overlap around a 30-minute hole", overlap60.length === 1 && overlap60[0].startMin === 10 * 60 + 15);
check("overlap candidate is flagged", overlap60[0] && overlap60[0].usesOverlap === true && overlap60[0].overlapMinutes === 15);

const freeHour = makeDay({
  workingIntervals: [{ startMin: 10 * 60, endMin: 11 * 60 }]
});
const snapped = api.enumerateValidSlots(freeHour, { durationMinutes: 30, snapMinutes: 15 });
check(
  "30-minute service over 10:00-11:00 snap 15 yields 10:00, 10:15, 10:30",
  startsOf(snapped).join(",") === [10 * 60, 10 * 60 + 15, 10 * 60 + 30].join(",")
);

const noCross = api.enumerateValidSlots(lunch, { durationMinutes: 30 });
check("no candidate crosses a working-interval boundary", noCross.every(function (slot) {
  const win = lunch.workingIntervals[slot.workingIntervalIndex];
  return slot.startMin >= win.startMin && slot.endMin <= win.endMin;
}));
check("no 11:45 candidate when morning closes at 12:00", noCross.every(function (slot) {
  return slot.startMin !== 11 * 60 + 45;
}));

const customSnap = api.enumerateValidSlots(freeHour, { durationMinutes: 20, snapMinutes: 10 });
check(
  "custom snapMinutes 10 yields 10:00, 10:10, 10:20, 10:30, 10:40",
  startsOf(customSnap).join(",") === [600, 610, 620, 630, 640].join(",")
);

check("invalid duration returns no candidates", api.enumerateValidSlots(empty, { durationMinutes: 0 }).length === 0);
check("negative duration returns no candidates", api.enumerateValidSlots(empty, { durationMinutes: -30 }).length === 0);
check("missing duration returns no candidates", api.enumerateValidSlots(empty, {}).length === 0);

const abutOccupied = makeDay({
  allowedOverlapMinutes: 0,
  lines: [line(12 * 60, 13 * 60)]
});
const noOverlapSlots = api.enumerateValidSlots(abutOccupied, { durationMinutes: 30 });
check("with overlap 0, a slot may start at 13:00 but not at 12:45", noOverlapSlots.some(function (s) {
  return s.startMin === 13 * 60 && s.usesOverlap === false;
}) && noOverlapSlots.every(function (s) { return s.startMin !== 12 * 60 + 45; }));

const allow15 = makeDay({
  allowedOverlapMinutes: 15,
  lines: [line(12 * 60, 13 * 60)]
});
const withOverlapSlots = api.enumerateValidSlots(allow15, { durationMinutes: 30 });
const overlapStart = withOverlapSlots.find(function (s) { return s.startMin === 12 * 60 + 45; });
check("with overlap 15, 12:45-13:15 is valid", !!(overlapStart && overlapStart.usesOverlap && overlapStart.overlapMinutes === 15));
check("12:30-13:00 is still invalid when allowance is 15", withOverlapSlots.every(function (s) {
  return s.startMin !== 12 * 60 + 30;
}));
check("true free 13:00 slot is not marked as overlap", withOverlapSlots.some(function (s) {
  return s.startMin === 13 * 60 && s.usesOverlap === false;
}));

// ---------------------------------------------------------------------------
// SCORING
// ---------------------------------------------------------------------------

const hourWindow = makeDay({
  workingIntervals: [{ startMin: 10 * 60, endMin: 11 * 60 }]
});
const rankedHour = api.rankSlots(hourWindow, { durationMinutes: 30, snapMinutes: 15 });
const at1000 = rankedHour.find(function (s) { return s.startMin === 10 * 60; });
const at1015 = rankedHour.find(function (s) { return s.startMin === 10 * 60 + 15; });
const at1030 = rankedHour.find(function (s) { return s.startMin === 10 * 60 + 30; });
check("edge placements outrank the orphan-producing 10:15", at1000.score > at1015.score && at1030.score > at1015.score);
check("10:15 is low_fit but still returned", at1015.label === "low_fit" && rankedHour.length === 3);
check("10:15 fragments the window", hasReason(at1015, "fragments_window") && hasReason(at1015, "stranded_remainder_before") && hasReason(at1015, "stranded_remainder_after"));
check("10:00 abuts shift start and leaves a usable remainder", hasReason(at1000, "abuts_shift_start") && hasReason(at1000, "usable_remainder_after"));
check("10:30 abuts shift end and leaves a usable remainder", hasReason(at1030, "abuts_shift_end") && hasReason(at1030, "usable_remainder_before"));

const packed = makeDay({
  lines: [
    line(12 * 60, 13 * 60, { lineId: "a" }),
    line(13 * 60 + 30, 14 * 60 + 30, { lineId: "b" })
  ]
});
const packedRank = api.rankSlots(packed, { durationMinutes: 30 });
const closeGap = packedRank.find(function (s) { return s.startMin === 13 * 60; });
check("packing both sides ranks first", packedRank[0].startMin === 13 * 60);
check("pack-both-sides and exact-window-fit apply together", hasReason(closeGap, "packs_both_sides") && hasReason(closeGap, "exact_window_fit"));
check("pack slot also abuts previous and next", hasReason(closeGap, "abuts_previous") && hasReason(closeGap, "abuts_next"));
check("exact 30-in-30 is best_fit after clamp", closeGap.label === "best_fit" && closeGap.score === 100);
check("exact-fit reason text names the opening", closeGap.reasons.some(function (row) {
  return row.code === "exact_window_fit" && row.text === "Uses the full 30-minute opening.";
}));

const emptyHour = makeDay({
  workingIntervals: [{ startMin: 9 * 60, endMin: 10 * 60 }]
});
const emptyHourFill = api.rankSlots(emptyHour, { durationMinutes: 60 }).find(function (s) {
  return s.startMin === 9 * 60;
});
check("empty shift-length slot is not packs_both_sides", !hasReason(emptyHourFill, "packs_both_sides"));
check("empty shift-length slot still exact-fits the window", hasReason(emptyHourFill, "exact_window_fit"));
check("empty shift-length slot abuts both shift edges", hasReason(emptyHourFill, "abuts_shift_start") && hasReason(emptyHourFill, "abuts_shift_end"));

const midBlock = makeDay({
  workingIntervals: [{ startMin: 9 * 60, endMin: 12 * 60 }],
  lines: [line(10 * 60, 11 * 60, { lineId: "mid" })]
});
const midRank = api.rankSlots(midBlock, { durationMinutes: 60 });
const leadFill = midRank.find(function (s) { return s.startMin === 9 * 60; });
const trailFill = midRank.find(function (s) { return s.startMin === 11 * 60; });
check("leading exact opening against a shift start is not packs_both_sides", !hasReason(leadFill, "packs_both_sides"));
check("leading exact opening keeps shift-start, next, and exact-fit", hasReason(leadFill, "abuts_shift_start") && hasReason(leadFill, "abuts_next") && hasReason(leadFill, "exact_window_fit"));
check("trailing exact opening against a shift end is not packs_both_sides", !hasReason(trailFill, "packs_both_sides"));
check("trailing exact opening keeps previous, shift-end, and exact-fit", hasReason(trailFill, "abuts_previous") && hasReason(trailFill, "abuts_shift_end") && hasReason(trailFill, "exact_window_fit"));

const oneSide = makeDay({
  lines: [line(9 * 60, 10 * 60)]
});
const oneSideRank = api.rankSlots(oneSide, { durationMinutes: 30 });
const afterPrev = oneSideRank.find(function (s) { return s.startMin === 10 * 60; });
check("one-side adjacency uses abuts_previous", hasReason(afterPrev, "abuts_previous") && !hasReason(afterPrev, "packs_both_sides"));

const shiftEdge = api.rankSlots(empty, { durationMinutes: 60 });
const openStart = shiftEdge.find(function (s) { return s.startMin === 9 * 60; });
const openEnd = shiftEdge.find(function (s) { return s.startMin === 17 * 60; });
check("shift-start adjacency is scored", hasReason(openStart, "abuts_shift_start"));
check("shift-end adjacency is scored", hasReason(openEnd, "abuts_shift_end"));

check("usable remainder delta is +8", deltaOf(at1000, "usable_remainder_after") === 8);
check("stranded remainder delta is -20", deltaOf(at1015, "stranded_remainder_before") === -20);
check("fragments delta is -15", deltaOf(at1015, "fragments_window") === -15);

const overlapScored = api.scoreSlot(hole30overlap, overlap60[0], { durationMinutes: 60 });
check("permitted-overlap candidate is penalized", hasReason(overlapScored, "uses_permitted_overlap") && deltaOf(overlapScored, "uses_permitted_overlap") === -25);
check("overlap candidate is not treated as an ideal pack", !hasReason(overlapScored, "packs_both_sides") && !hasReason(overlapScored, "exact_window_fit"));
check("overlap penalty keeps the slot returned", overlapScored.score >= 0 && overlapScored.label === "low_fit");

check("score clamp high", api.clampScore(140) === 100);
check("score clamp low", api.clampScore(-20) === 0);
check("label best_fit at 80", api.labelForScore(80) === "best_fit");
check("label good_fit at 60", api.labelForScore(60) === "good_fit");
check("label available at 40", api.labelForScore(40) === "available");
check("label low_fit at 39", api.labelForScore(39) === "low_fit");
check("BASE score constant is 50", api.SCORE.BASE === 50);

check("every reason has code, delta, and text", closeGap.reasons.every(function (row) {
  return row.code && typeof row.delta === "number" && String(row.text || "").trim();
}));

// ---------------------------------------------------------------------------
// RANKING
// ---------------------------------------------------------------------------

check("higher score is ranked first", rankedHour[0].score >= rankedHour[1].score && rankedHour[1].score >= rankedHour[2].score);
check("equal-score tie uses earlier startMin", at1000.score === at1030.score && rankedHour[0].startMin === 10 * 60 && rankedHour[1].startMin === 10 * 60 + 30);

const first = JSON.stringify(api.rankSlots(packed, { durationMinutes: 30, snapMinutes: 15 }));
const second = JSON.stringify(api.rankSlots(packed, { durationMinutes: 30, snapMinutes: 15 }));
check("ranking is deterministic across repeats", first === second);

const emptyRank = api.rankSlots(empty, { durationMinutes: 30 });
check("empty-day ranking is also deterministic", JSON.stringify(emptyRank) === JSON.stringify(api.rankSlots(empty, { durationMinutes: 30 })));
check("low_fit slots remain in ranked output", rankedHour.some(function (s) { return s.label === "low_fit"; }));

// ---------------------------------------------------------------------------
// PURITY
// ---------------------------------------------------------------------------

const engineFiles = [
  "public/booking/smart-scheduling/normalize.js",
  "public/booking/smart-scheduling/gaps.js",
  "public/booking/smart-scheduling/candidates.js",
  "public/booking/smart-scheduling/score.js",
  "public/booking/smart-scheduling/engine.js"
].map(function (rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
});
const joined = engineFiles.join("\n");
function forbids(name, pattern) {
  check("purity: no " + name, !pattern.test(joined));
}
forbids("Firebase APIs", /firebase-firestore|fromDoc\(|getDocs\s*\(|onSnapshot\s*\(|updateDoc\s*\(|addDoc\s*\(/);
forbids("network", /\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon/);
forbids("timers", /\bsetTimeout\b|\bsetInterval\b|\bDate\s*\(/);
forbids("DOM", /\bdocument\b|\blocalStorage\b|\bwindow\.location\b/);
forbids("Calendar", /ffBookingCal|calendar-drag|calendar-layout/);
forbids("Reports", /ffBookingReports|reports\/compute/);
check("purity: no appointment writes", !/createAppointment|updateAppointment|cancelAppointment/.test(joined));

if (failed) {
  console.error("FAILED", failed);
  process.exit(1);
}
console.log("All Smart Scheduling Phase 1 tests passed.");
