/**
 * Time Blocks are removed from client-bookable working capacity.
 * They are not booked appointment minutes. No Firestore.
 * Usage: node scripts/test-booking-reports-time-blocks.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function load(rel, windowObj) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  new Function("window", "document", src)(windowObj, { readyState: "complete" });
}

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

const windowObj = {};
load("public/booking/reports/compute.js", windowObj);
load("public/booking/reports/intelligence-compute.js", windowObj);
load("public/booking/reports/forward-outlook-compute.js", windowObj);
load("public/booking/blocks/model.js", windowObj);
load("public/booking/blocks/series-model.js", windowObj);
load("public/booking/reports/time-block-range.js", windowObj);

const intel = windowObj.ffBookingReportsIntelligenceCompute;
const outlook = windowObj.ffBookingReportsForwardOutlookCompute;
const series = windowObj.ffBookingBlockSeriesModel;
const range = windowObj.ffBookingReportsTimeBlockRange;
const dataSrc = fs.readFileSync(path.join(root, "public/booking/blocks/data.js"), "utf8");

function appt(partial) {
  return Object.assign({
    appointmentId: "a1",
    locationId: "loc",
    dateKey: "2026-09-10",
    status: "scheduled",
    source: "front_desk",
    firstVisit: false,
    serviceLines: []
  }, partial);
}

function line(partial) {
  return Object.assign({
    lineId: "l1",
    providerId: "maria",
    startMin: 720,
    endMin: 780,
    durationMinutes: 60,
    requested: false,
    priceSnapshot: 0
  }, partial);
}

function provider(id, name, windows, dateKey, locationId) {
  return {
    id: id,
    name: name,
    firstName: name,
    schedule: [{
      dateKey: dateKey || "2026-09-10",
      locationId: locationId || "loc",
      windows: windows || [{ startMin: 600, endMin: 1080 }]
    }]
  };
}

function block(partial) {
  return Object.assign({
    blockId: "b1",
    providerId: "maria",
    locationId: "loc",
    dateKey: "2026-09-10",
    startMin: 840,
    endMin: 870,
    reason: "lunch"
  }, partial);
}

const day = { fromKey: "2026-09-10", toKey: "2026-09-10", locationIds: ["loc"], todayKey: "2026-09-10" };
const work10to6 = [{ startMin: 600, endMin: 1080 }];

const before = intel.buildReport(Object.assign({
  appointments: [appt({ serviceLines: [line()] })],
  providers: [provider("maria", "Maria", work10to6)]
}, day));
check("before: 10-6 is 480 working minutes", before.utilization.workingMinutes === 480);
check("before: lunch is still inside available time", before.utilization.idleMinutes === 420);
check("before: booked is appointment only", before.utilization.bookedMinutes === 60);

const lunch = intel.buildReport(Object.assign({
  appointments: [appt({ serviceLines: [line()] })],
  providers: [provider("maria", "Maria", work10to6)],
  timeBlocks: [block()]
}, day));
check("after: 30-minute lunch leaves 450 bookable minutes", lunch.utilization.workingMinutes === 450);
check("after: lunch is not booked appointment time", lunch.utilization.bookedMinutes === 60);
check("after: idle excludes lunch", lunch.utilization.idleMinutes === 390);
check("after: utilization denominator is 450", lunch.utilization.percent === 13.3);
check("after: a single visit does not create a lunch gap", lunch.gaps.totalMinutes === 0 && lunch.utilization.openEdgeMinutes === 390);

const overlapCuts = intel.subtractFromWindows(
  [{ startMin: 600, endMin: 1080 }],
  [{ startMin: 840, endMin: 870 }, { startMin: 855, endMin: 885 }]
);
check("overlapping blocks union before subtract", intel.minutesOf(overlapCuts) === 435);

const twoBlocks = intel.buildReport(Object.assign({
  appointments: [],
  providers: [provider("maria", "Maria", work10to6)],
  timeBlocks: [
    block({ blockId: "lunch", startMin: 840, endMin: 870 }),
    block({ blockId: "meeting", startMin: 855, endMin: 885 })
  ]
}, day));
check("two overlapping blocks subtract 45 once", twoBlocks.utilization.workingMinutes === 435);

const outside = intel.buildReport(Object.assign({
  appointments: [],
  providers: [provider("maria", "Maria", work10to6)],
  timeBlocks: [block({ startMin: 480, endMin: 540 })]
}, day));
check("block outside the shift does not change working minutes", outside.utilization.workingMinutes === 480);

const otherProvider = intel.buildReport(Object.assign({
  appointments: [],
  providers: [provider("maria", "Maria", work10to6)],
  timeBlocks: [block({ providerId: "anna" })]
}, day));
check("another provider's block is ignored", otherProvider.utilization.workingMinutes === 480);

const otherLoc = intel.buildReport(Object.assign({
  appointments: [],
  providers: [provider("maria", "Maria", work10to6)],
  timeBlocks: [block({ locationId: "other" })]
}, day));
check("another location's block is ignored", otherLoc.utilization.workingMinutes === 480);

const overlapAppt = intel.buildReport(Object.assign({
  appointments: [appt({
    serviceLines: [line({ startMin: 825, endMin: 855, durationMinutes: 30 })]
  })],
  providers: [provider("maria", "Maria", work10to6)],
  timeBlocks: [block()]
}, day));
check("appointment overlapping lunch is clipped to bookable time", overlapAppt.utilization.bookedMinutes === 15);
check("appointment overlap does not count lunch as booked", overlapAppt.utilization.workingMinutes === 450);

const flexPreferred = intel.buildReport(Object.assign({
  appointments: [],
  providers: [provider("maria", "Maria", work10to6)],
  timeBlocks: [block({
    flexibilityMode: "flexible",
    preferredStartMin: 840,
    earliestStartMin: 780,
    latestEndMin: 960,
    startMin: 900,
    endMin: 930,
    actualStartMin: 900,
    actualEndMin: 930
  })]
}, day));
check("flexible block uses actual occurrence time", flexPreferred.utilization.workingMinutes === 450);
const preferredWindowGone = intel.bookableWindows(work10to6, [{ startMin: 780, endMin: 960 }]);
check("flexible preferred window is not the subtracted interval", intel.minutesOf(preferredWindowGone) === 300 && flexPreferred.utilization.workingMinutes !== 300);

const keys = ["2026-09-14", "2026-09-15", "2026-09-16"];
const weekdaySeries = {
  seriesId: "ser1",
  providerId: "maria",
  locationId: "loc",
  startDateKey: "2026-09-14",
  preferredStartMin: 840,
  durationMinutes: 30,
  repeatFrequency: "weekdays",
  reason: "lunch"
};
const generated = series.generateOccurrences([weekdaySeries], keys, [
  { seriesId: "ser1", occurrenceDateKey: "2026-09-15", kind: "skip" },
  { seriesId: "ser1", occurrenceDateKey: "2026-09-16", kind: "override", startMin: 900, endMin: 930 }
]);
check("recurring series emits Mon and moved Wed, skips Tue", generated.length === 2);
check("Monday occurrence stays at preferred lunch", generated[0].dateKey === "2026-09-14" && generated[0].startMin === 840 && generated[0].endMin === 870);
check("Wednesday override uses the moved actual time", generated[1].dateKey === "2026-09-16" && generated[1].startMin === 900 && generated[1].endMin === 930);

const recurringReport = intel.buildReport({
  appointments: [],
  providers: [{
    id: "maria",
    name: "Maria",
    firstName: "Maria",
    schedule: [
      { dateKey: "2026-09-14", locationId: "loc", windows: work10to6 },
      { dateKey: "2026-09-15", locationId: "loc", windows: work10to6 },
      { dateKey: "2026-09-16", locationId: "loc", windows: work10to6 }
    ]
  }],
  timeBlocks: generated,
  fromKey: "2026-09-14",
  toKey: "2026-09-16",
  locationIds: ["loc"],
  todayKey: "2026-09-16"
});
check("recurring+skip+move: Mon 450 + skipped Tue 480 + moved Wed 450", recurringReport.utilization.workingMinutes === 1380);

const outlookLunch = outlook.buildOutlook({
  appointments: [appt({ dateKey: "2026-09-14", serviceLines: [line({ startMin: 720, endMin: 780 })] })],
  providers: [provider("maria", "Maria", work10to6, "2026-09-14")],
  timeBlocks: [block({ dateKey: "2026-09-14" })],
  fromKey: "2026-09-14",
  toKey: "2026-09-14",
  locationIds: ["loc"],
  todayKey: "2026-09-14",
  nowByLocation: { loc: { todayKey: "2026-09-14", nowMinutes: 540 } }
});
check("outlook: lunch removed from future working", outlookLunch.totals.workingMinutes === 450);
check("outlook: booked ahead stays appointment minutes", outlookLunch.totals.bookedMinutes === 60);
check("outlook: open future hours exclude lunch", outlookLunch.totals.openMinutes === 390);

const duringLunch = outlook.buildOutlook({
  appointments: [],
  providers: [provider("maria", "Maria", work10to6, "2026-09-14")],
  timeBlocks: [block({ dateKey: "2026-09-14" })],
  fromKey: "2026-09-14",
  toKey: "2026-09-14",
  locationIds: ["loc"],
  todayKey: "2026-09-14",
  nowByLocation: { loc: { todayKey: "2026-09-14", nowMinutes: 850 } }
});
check("outlook: now during lunch keeps only time after the block", duringLunch.totals.workingMinutes === 210);

const afterLunch = outlook.buildOutlook({
  appointments: [],
  providers: [provider("maria", "Maria", work10to6, "2026-09-14")],
  timeBlocks: [block({ dateKey: "2026-09-14" })],
  fromKey: "2026-09-14",
  toKey: "2026-09-14",
  locationIds: ["loc"],
  todayKey: "2026-09-14",
  nowByLocation: { loc: { todayKey: "2026-09-14", nowMinutes: 900 } }
});
check("outlook: past lunch is already clipped away by now", afterLunch.totals.workingMinutes === 180);

check("blocks repo exposes a cache-free report range list", dataSrc.indexOf("async function listForLocationsRange") !== -1);
check("calendar loadForDates still uses listVisibleBlocks", dataSrc.indexOf("listVisibleBlocks") !== -1 && dataSrc.indexOf("applyList(rows, started)") !== -1);

(async function () {
  const missing = await range.fetchForReport(null, { locationIds: ["loc"], fromKey: "2026-09-10", toKey: "2026-09-10" });
  check("range fetch errors when the blocks repo is missing", missing.kind === "error" && missing.blocks.length === 0);

  const fakeRows = [block(), block({ blockId: "b2", startMin: 900, endMin: 930 })];
  const ok = await range.fetchForReport({
    listForLocationsRange: async function () { return fakeRows; }
  }, { locationIds: ["loc"], fromKey: "2026-09-10", toKey: "2026-09-10" });
  check("range fetch returns repo blocks", ok.kind === "ok" && ok.blocks.length === 2);

  const view = range.viewState(ok);
  check("range viewState is ok with blocks", view.kind === "ok" && view.blocks.length === 2);

  if (failed) {
    console.log("FAILED:", failed);
    process.exit(1);
  }
  console.log("All Time Block report tests passed.");
})().catch(function (err) {
  console.log("FAIL:", err && err.message ? err.message : err);
  process.exit(1);
});
