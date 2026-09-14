/**
 * Provider capacity intelligence. No Firestore.
 * Usage: node scripts/test-booking-reports-provider-capacity.js
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
const intel = windowObj.ffBookingReportsIntelligenceCompute;

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

function provider(id, name, windows) {
  return {
    id: id,
    name: name,
    firstName: name,
    schedule: [{
      dateKey: "2026-09-10",
      locationId: "loc",
      windows: windows
    }]
  };
}

const day = { fromKey: "2026-09-10", toKey: "2026-09-10", locationIds: ["loc"], todayKey: "2026-09-10" };
const work10to6 = [{ startMin: 600, endMin: 1080 }];

const basic = intel.buildReport(Object.assign({
  appointments: [appt({
    serviceLines: [line({ startMin: 720, endMin: 780, durationMinutes: 60 })]
  })],
  providers: [provider("maria", "Maria", work10to6)]
}, day));
const basicRow = basic.utilization.providers[0];
check("A: working is 480", basic.utilization.workingMinutes === 480 && basicRow.workingMinutes === 480);
check("A: booked is 60", basic.utilization.bookedMinutes === 60);
check("A: idle is 420", basic.utilization.idleMinutes === 420);
check("A: calendar gap is 0", basic.gaps.totalMinutes === 0 && basicRow.gapCount === 0);
check("A: open-edge idle is 420", basic.utilization.openEdgeMinutes === 420 && basicRow.openEdgeMinutes === 420);
check("A: utilization is 12.5%", basic.utilization.percent === 12.5 && basicRow.percent === 12.5);
check("A: idle share is 87.5% and gap share is 0", basicRow.idleSharePercent === 87.5 && basicRow.gapSharePercent === 0);

const internal = intel.buildReport(Object.assign({
  appointments: [
    appt({ appointmentId: "a", serviceLines: [line({ startMin: 720, endMin: 780, durationMinutes: 60 })] }),
    appt({ appointmentId: "b", serviceLines: [line({ lineId: "l2", startMin: 810, endMin: 870, durationMinutes: 60 })] })
  ],
  providers: [provider("maria", "Maria", work10to6)]
}, day));
const internalRow = internal.utilization.providers[0];
check("B: working 480 booked 120 idle 360", internal.utilization.workingMinutes === 480 && internal.utilization.bookedMinutes === 120 && internal.utilization.idleMinutes === 360);
check("B: calendar gap is 30 with count 1", internal.gaps.totalMinutes === 30 && internalRow.gapCount === 1 && internalRow.gapMinutes === 30);
check("B: open-edge idle is 330", internal.utilization.openEdgeMinutes === 330 && internalRow.openEdgeMinutes === 330);

const many = intel.buildReport(Object.assign({
  appointments: [
    appt({ appointmentId: "a", serviceLines: [line({ startMin: 600, endMin: 660, durationMinutes: 60 })] }),
    appt({ appointmentId: "b", serviceLines: [line({ lineId: "l2", startMin: 690, endMin: 750, durationMinutes: 60 })] }),
    appt({ appointmentId: "c", serviceLines: [line({ lineId: "l3", startMin: 840, endMin: 900, durationMinutes: 60 })] })
  ],
  providers: [provider("maria", "Maria", work10to6)]
}, day));
check("C: multiple gaps count and minutes", many.gaps.count === 2 && many.gaps.totalMinutes === 120 && many.utilization.providers[0].gapCount === 2);
check("C: open-edge excludes internal gaps", many.utilization.bookedMinutes === 180 && many.utilization.idleMinutes === 300 && many.utilization.openEdgeMinutes === 180);

const cancelled = intel.buildReport(Object.assign({
  appointments: [
    appt({ appointmentId: "a", status: "confirmed", serviceLines: [line({ startMin: 720, endMin: 780, durationMinutes: 60 })] }),
    appt({ appointmentId: "cx", status: "cancelled", serviceLines: [line({ lineId: "cx", startMin: 780, endMin: 840, durationMinutes: 60 })] }),
    appt({ appointmentId: "b", status: "completed", serviceLines: [line({ lineId: "l2", startMin: 840, endMin: 900, durationMinutes: 60 })] })
  ],
  providers: [provider("maria", "Maria", work10to6)]
}, day));
check("D: cancelled time is not booked", cancelled.utilization.bookedMinutes === 120);
check("D: cancelled hole between actives is a calendar gap", cancelled.gaps.totalMinutes === 60 && cancelled.utilization.openEdgeMinutes === 300);

const overlap = intel.buildReport(Object.assign({
  appointments: [appt({
    appointmentId: "ov",
    serviceLines: [
      line({ lineId: "a", startMin: 720, endMin: 780, durationMinutes: 60 }),
      line({ lineId: "b", startMin: 750, endMin: 810, durationMinutes: 60 })
    ]
  })],
  providers: [provider("maria", "Maria", work10to6)]
}, day));
check("E: overlapping lines union to 90 minutes", overlap.utilization.bookedMinutes === 90 && overlap.utilization.idleMinutes === 390);

const multi = intel.buildReport(Object.assign({
  appointments: [appt({
    appointmentId: "party",
    serviceLines: [
      line({ lineId: "a", providerId: "maria", startMin: 720, endMin: 780, durationMinutes: 60 }),
      line({ lineId: "b", providerId: "anna", startMin: 720, endMin: 840, durationMinutes: 120 })
    ]
  })],
  providers: [
    provider("maria", "Maria", work10to6),
    provider("anna", "Anna", work10to6)
  ]
}, day));
const mariaRow = multi.utilization.providers.find(function (row) { return row.id === "maria"; });
const annaRow = multi.utilization.providers.find(function (row) { return row.id === "anna"; });
check("F: each provider gets only their line time", mariaRow.bookedMinutes === 60 && annaRow.bookedMinutes === 120);
check("F: overall utilization is sum booked over sum working", multi.utilization.workingMinutes === 960 && multi.utilization.bookedMinutes === 180 && multi.utilization.percent === 18.8);

const split = intel.buildReport(Object.assign({
  appointments: [
    appt({ appointmentId: "am", serviceLines: [line({ startMin: 600, endMin: 660, durationMinutes: 60 })] }),
    appt({ appointmentId: "pm", serviceLines: [line({ lineId: "l2", startMin: 840, endMin: 900, durationMinutes: 60 })] })
  ],
  providers: [provider("maria", "Maria", [{ startMin: 600, endMin: 780 }, { startMin: 840, endMin: 1080 }])]
}, day));
check("G: split windows exclude the closed hour from working", split.utilization.workingMinutes === 420);
check("G: closed interval is not idle or a calendar gap", split.gaps.count === 0 && split.utilization.idleMinutes === 300 && split.utilization.openEdgeMinutes === 300);

const clipped = intel.buildReport(Object.assign({
  appointments: [appt({
    serviceLines: [line({ startMin: 540, endMin: 660, durationMinutes: 120 })]
  })],
  providers: [provider("maria", "Maria", work10to6)]
}, day));
check("H: appointment outside the window is clipped to working time", clipped.utilization.bookedMinutes === 60 && clipped.utilization.workingMinutes === 480);
check("H: clipped leftover is open-edge idle not a gap", clipped.gaps.totalMinutes === 0 && clipped.utilization.openEdgeMinutes === 420);

const zeroWork = intel.buildReport(Object.assign({
  appointments: [appt({
    serviceLines: [line({ providerId: "off", startMin: 720, endMin: 780, durationMinutes: 60 })]
  })],
  providers: [
    provider("maria", "Maria", work10to6),
    { id: "off", name: "Off Duty", firstName: "Off", schedule: [{ dateKey: "2026-09-10", locationId: "loc", windows: [] }] }
  ]
}, day));
check("I: zero working time is excluded from ranking", zeroWork.utilization.providers.length === 1 && zeroWork.utilization.providers[0].id === "maria");
check("I: zero working time does not create invalid utilization", zeroWork.utilization.percent === 0 && zeroWork.utilization.providers.every(function (row) {
  return row.workingMinutes > 0 && Number.isFinite(row.percent);
}));

const uneven = intel.buildReport(Object.assign({
  appointments: [
    appt({
      appointmentId: "m1",
      serviceLines: [line({ providerId: "maria", startMin: 600, endMin: 1080, durationMinutes: 480 })]
    }),
    appt({
      appointmentId: "a1",
      serviceLines: [line({ lineId: "l2", providerId: "anna", startMin: 720, endMin: 780, durationMinutes: 60 })]
    })
  ],
  providers: [
    provider("maria", "Maria", work10to6),
    provider("anna", "Anna", work10to6)
  ]
}, day));
const avgOfPercents = (100 + 12.5) / 2;
check("J: overall utilization is sum booked / sum working", uneven.utilization.workingMinutes === 960 && uneven.utilization.bookedMinutes === 540 && uneven.utilization.percent === 56.3);
check("J: overall utilization is not the average of provider percents", uneven.utilization.percent !== avgOfPercents && uneven.utilization.percent !== 56.25);

const ranked = intel.buildReport(Object.assign({
  appointments: [
    appt({
      appointmentId: "gappy",
      serviceLines: [
        line({ providerId: "john", startMin: 600, endMin: 660, durationMinutes: 60 }),
        line({ lineId: "j2", providerId: "john", startMin: 780, endMin: 840, durationMinutes: 60 })
      ]
    }),
    appt({
      appointmentId: "idle",
      serviceLines: [line({ providerId: "anna", startMin: 720, endMin: 780, durationMinutes: 60 })]
    })
  ],
  providers: [
    provider("anna", "Anna", work10to6),
    provider("john", "John", work10to6)
  ]
}, day));
check("default rank is most gap hours then most idle", ranked.utilization.providers[0].id === "john" && ranked.utilization.providers[0].gapMinutes === 120 && ranked.utilization.providers[1].id === "anna");
check("most-gap insight includes hours and gap count", ranked.insights.some(function (line) {
  return line === "John had the most calendar gap time today: 2 hours across 1 gap.";
}));
check("most-utilized insight uses the highest percent", ranked.insights.some(function (line) {
  return line === "John was the most utilized provider at 25%.";
}));
check("idle vs between-appointments insight stays descriptive", ranked.insights.some(function (line) {
  return line === "Anna had 7 idle working hours, but only 0 hours were between appointments.";
}));
check("below 50% insight uses a count", ranked.insights.some(function (line) {
  return line === "2 providers were below 50% utilization.";
}));
check("capacity insights stay operational", ranked.insights.every(function (line) {
  return line.indexOf("worst") === -1 && line.indexOf("inefficient") === -1 && line.indexOf("wasted") === -1 && line.indexOf("poor performer") === -1 && line.indexOf("recoverable") === -1;
}));

if (failed) process.exit(1);
console.log("All Booking provider capacity checks passed.");
