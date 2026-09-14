/**
 * Forward Outlook calculations. No Firestore.
 * Usage: node scripts/test-booking-reports-forward-outlook.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

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

const windowObj = {
  settings: {
    locationPreferences: {
      loc: { salonTimeZone: "America/New_York" },
      nyc: { salonTimeZone: "America/New_York" },
      la: { salonTimeZone: "America/Los_Angeles" }
    },
    preferences: { salonTimeZone: "America/New_York" }
  }
};
load("public/booking/calendar-time.js", windowObj);
load("public/booking/reports/compute.js", windowObj);
load("public/booking/reports/intelligence-compute.js", windowObj);
load("public/booking/reports/appointment-range.js", windowObj);
load("public/booking/reports/forward-outlook-compute.js", windowObj);
const api = windowObj.ffBookingReportsForwardOutlookCompute;
const range = windowObj.ffBookingReportsAppointmentRange;
const sales = windowObj.ffBookingReportsCompute;

function line(partial) {
  return Object.assign({
    lineId: "l1",
    serviceId: "gel",
    serviceNameSnapshot: "Gel Manicure",
    providerId: "maria",
    providerNameSnapshot: "Maria",
    startMin: 840,
    endMin: 900,
    durationMinutes: 60,
    priceSnapshot: 80,
    requested: false
  }, partial);
}

function appt(partial) {
  return Object.assign({
    appointmentId: "a1",
    clientId: "c1",
    locationId: "loc",
    status: "scheduled",
    dateKey: "2026-09-14",
    firstVisit: false,
    serviceLines: [line()]
  }, partial);
}

function provider(id, name, windows, dateKey, locationId) {
  return {
    id: id,
    name: name,
    firstName: name,
    schedule: [{
      dateKey: dateKey || "2026-09-14",
      locationId: locationId || "loc",
      windows: windows || [{ startMin: 600, endMin: 1080 }]
    }]
  };
}

function build(appointments, providers, extra) {
  return api.buildOutlook(Object.assign({
    appointments: appointments,
    providers: providers,
    fromKey: "2026-09-14",
    toKey: "2026-09-14",
    locationIds: ["loc"],
    todayKey: "2026-09-14",
    preset: "custom",
    nowByLocation: { loc: { todayKey: "2026-09-14", nowMinutes: 0 } }
  }, extra || {}));
}

const beforeShift = build(
  [appt()],
  [provider("maria", "Maria")],
  { nowByLocation: { loc: { todayKey: "2026-09-14", nowMinutes: 540 } } }
);
check("A: now before shift counts the full future shift", beforeShift.totals.workingMinutes === 480 && beforeShift.totals.bookedMinutes === 60);
check("A: basic open minutes", beforeShift.totals.openMinutes === 420);
check("B: booked-ahead utilization is booked / working", beforeShift.totals.utilization === 12.5);

const overlap = build([
  appt({
    serviceLines: [
      line({ startMin: 900, endMin: 960, durationMinutes: 60 }),
      line({ lineId: "l2", startMin: 930, endMin: 990, durationMinutes: 60 })
    ]
  })
], [provider("maria", "Maria")]);
check("C: overlapping same-provider future lines are unioned", overlap.totals.bookedMinutes === 90);

const splitProviders = build([
  appt({
    serviceLines: [
      line({ startMin: 840, endMin: 870, durationMinutes: 30 }),
      line({ lineId: "l2", providerId: "anna", providerNameSnapshot: "Anna", serviceId: "cut", serviceNameSnapshot: "Cut", startMin: 840, endMin: 870, durationMinutes: 30, priceSnapshot: 40 })
    ]
  })
], [
  provider("maria", "Maria"),
  provider("anna", "Anna")
]);
check("D: multi-provider appointment splits booked time", splitProviders.totals.bookedMinutes === 60 && splitProviders.providers.length === 2 && splitProviders.providers.every(function (row) { return row.bookedMinutes === 30; }));

const cancelled = build(
  [appt({ status: "cancelled" })],
  [provider("maria", "Maria")]
);
check("E: cancelled future appointment is excluded from booked ahead", cancelled.totals.bookedMinutes === 0 && cancelled.totals.futureAppointments === 0 && cancelled.totals.workingMinutes === 480);

const during = build(
  [appt({ serviceLines: [line({ startMin: 780, endMin: 840, durationMinutes: 60 })] })],
  [provider("maria", "Maria")],
  { nowByLocation: { loc: { todayKey: "2026-09-14", nowMinutes: 795 } } }
);
check("F: now during shift excludes the past portion of the window", during.totals.workingMinutes === 285);
check("F: in-progress appointment keeps only the remaining portion", during.totals.bookedMinutes === 45);

const pastAppt = build(
  [appt({ serviceLines: [line({ startMin: 600, endMin: 660, durationMinutes: 60 })] })],
  [provider("maria", "Maria")],
  { nowByLocation: { loc: { todayKey: "2026-09-14", nowMinutes: 795 } } }
);
check("F: appointment entirely before now does not count", pastAppt.totals.bookedMinutes === 0 && pastAppt.totals.futureAppointments === 0);

const laterAppt = build(
  [appt({ serviceLines: [line({ startMin: 900, endMin: 960, durationMinutes: 60 })] })],
  [provider("maria", "Maria")],
  { nowByLocation: { loc: { todayKey: "2026-09-14", nowMinutes: 795 } } }
);
check("F: appointment entirely after now counts in full", laterAppt.totals.bookedMinutes === 60);

const splitWindows = build(
  [appt({ serviceLines: [line({ startMin: 810, endMin: 870, durationMinutes: 60 })] })],
  [provider("maria", "Maria", [{ startMin: 600, endMin: 720 }, { startMin: 780, endMin: 1080 }])]
);
check("G: split working intervals exclude the closed hour", splitWindows.totals.workingMinutes === 420 && splitWindows.totals.bookedMinutes === 60);

const gaps = build([
  appt({
    appointmentId: "g1",
    serviceLines: [line({ startMin: 840, endMin: 900, durationMinutes: 60 })]
  }),
  appt({
    appointmentId: "g2",
    clientId: "c2",
    serviceLines: [line({ lineId: "l2", startMin: 930, endMin: 990, durationMinutes: 60 })]
  })
], [provider("maria", "Maria")]);
check("H: upcoming gap is the hole between booked blocks", gaps.totals.gapMinutes === 30 && gaps.totals.gapCount === 1);
check("I: leading and trailing open time is not a gap", gaps.totals.openMinutes === 360 && gaps.totals.openEdgeMinutes === 330);
check("J: a 30-minute hole is a small upcoming gap", gaps.totals.smallGapMinutes === 30);

const valued = build([appt()], [provider("maria", "Maria")]);
check("K: booked service value ahead sums priceSnapshot", valued.totals.bookedServiceValue === 80);

const missingPrice = build([
  appt({ serviceLines: [line({ priceSnapshot: 0 })] }),
  appt({ appointmentId: "a2", clientId: "c2", serviceLines: [line({ lineId: "l2", priceSnapshot: 50 })] })
], [provider("maria", "Maria")]);
check("L: missing price is coverage, not invented value", missingPrice.totals.bookedServiceValue === 50 && missingPrice.totals.unpricedLineCount === 1 && missingPrice.totals.pricedLineCount === 1);

const twoDays = api.buildOutlook({
  appointments: [
    appt({ dateKey: "2026-09-14" }),
    appt({ appointmentId: "a2", dateKey: "2026-09-15", serviceLines: [line({ startMin: 600, endMin: 720, durationMinutes: 120, priceSnapshot: 120 })] })
  ],
  providers: [
    {
      id: "maria",
      name: "Maria",
      firstName: "Maria",
      schedule: [
        { dateKey: "2026-09-14", locationId: "loc", windows: [{ startMin: 600, endMin: 1080 }] },
        { dateKey: "2026-09-15", locationId: "loc", windows: [{ startMin: 600, endMin: 1080 }] }
      ]
    }
  ],
  fromKey: "2026-09-14",
  toKey: "2026-09-15",
  locationIds: ["loc"],
  todayKey: "2026-09-14",
  nowByLocation: { loc: { todayKey: "2026-09-13", nowMinutes: 0 } }
});
check("M: daily future aggregation keeps both working dates", twoDays.days.length === 2 && twoDays.days[0].bookedMinutes === 60 && twoDays.days[1].bookedMinutes === 120);

const weighted = api.buildOutlook({
  appointments: [
    appt({ dateKey: "2026-09-10", serviceLines: [line({ startMin: 600, endMin: 840, durationMinutes: 240 })] }),
    appt({ appointmentId: "a2", dateKey: "2026-09-17", serviceLines: [line({ startMin: 600, endMin: 840, durationMinutes: 240 })] })
  ],
  providers: [{
    id: "maria",
    name: "Maria",
    firstName: "Maria",
    schedule: [
      { dateKey: "2026-09-10", locationId: "loc", windows: [{ startMin: 600, endMin: 1080 }] },
      { dateKey: "2026-09-17", locationId: "loc", windows: [{ startMin: 600, endMin: 840 }] }
    ]
  }],
  fromKey: "2026-09-10",
  toKey: "2026-09-17",
  locationIds: ["loc"],
  nowByLocation: { loc: { todayKey: "2026-09-01", nowMinutes: 0 } }
});
const thursday = weighted.weekdays.find(function (row) { return row.weekday === "thursday"; });
check("N: weekday utilization is weighted booked / working", thursday && thursday.dateCount === 2 && thursday.workingMinutes === 720 && thursday.bookedMinutes === 480 && thursday.percent === 66.7);

const demand = splitProviders.services.find(function (row) { return row.serviceId === "gel"; });
check("O: service demand ahead groups by serviceId", demand && demand.lineCount === 1 && demand.minutes === 30 && demand.providerCount === 1);

const multiLoc = api.buildOutlook({
  appointments: [
    appt({ locationId: "nyc", serviceLines: [line({ startMin: 840, endMin: 900 })] }),
    appt({ appointmentId: "a2", locationId: "la", serviceLines: [line({ providerId: "anna", startMin: 840, endMin: 900 })] })
  ],
  providers: [
    provider("maria", "Maria", [{ startMin: 600, endMin: 1080 }], "2026-09-14", "nyc"),
    provider("anna", "Anna", [{ startMin: 600, endMin: 1080 }], "2026-09-14", "la")
  ],
  fromKey: "2026-09-14",
  toKey: "2026-09-14",
  locationIds: ["nyc", "la"],
  nowByLocation: {
    nyc: { todayKey: "2026-09-14", nowMinutes: 0 },
    la: { todayKey: "2026-09-14", nowMinutes: 0 }
  }
});
check("P: multi-location provider minutes are additive", multiLoc.totals.workingMinutes === 960 && multiLoc.totals.bookedMinutes === 120);

const zonedNow = api.buildOutlook({
  appointments: [
    appt({
      locationId: "nyc",
      serviceLines: [line({ startMin: 780, endMin: 840, durationMinutes: 60 })]
    }),
    appt({
      appointmentId: "a2",
      locationId: "la",
      serviceLines: [line({ providerId: "anna", startMin: 780, endMin: 840, durationMinutes: 60 })]
    })
  ],
  providers: [
    provider("maria", "Maria", [{ startMin: 600, endMin: 1080 }], "2026-09-14", "nyc"),
    provider("anna", "Anna", [{ startMin: 600, endMin: 1080 }], "2026-09-14", "la")
  ],
  fromKey: "2026-09-14",
  toKey: "2026-09-14",
  locationIds: ["nyc", "la"],
  nowByLocation: {
    nyc: { todayKey: "2026-09-14", nowMinutes: 795 },
    la: { todayKey: "2026-09-14", nowMinutes: 540 }
  }
});
const nycRow = zonedNow.providers.find(function (row) { return row.id === "maria"; });
const laRow = zonedNow.providers.find(function (row) { return row.id === "anna"; });
check("Q: different location NOW clips independently", nycRow && nycRow.workingMinutes === 285 && nycRow.bookedMinutes === 45);
check("Q: earlier local NOW keeps more of the same civil shift", laRow && laRow.workingMinutes === 480 && laRow.bookedMinutes === 60);

const emptyBook = build([], [provider("maria", "Maria")]);
check("R: working date with zero appointments stays in the daily table", emptyBook.days.length === 1 && emptyBook.days[0].workingMinutes === 480 && emptyBook.days[0].bookedMinutes === 0 && emptyBook.totals.utilization === 0);
check("R: empty booked state is useful, not no-data", api.ownerView(emptyBook).kind === "empty-booked" && api.ownerView(emptyBook).message.indexOf("No appointments are currently booked") === 0);

const noWork = build([appt()], []);
check("S: no working capacity does not invent utilization", noWork.totals.workingMinutes === 0 && noWork.totals.utilization === 0 && api.ownerView(noWork).kind === "empty");

const ui = read("public/booking/reports/forward-outlook.js");
const src = read("public/booking/reports/forward-outlook-compute.js");
check("T: incomplete appointment retrieval suppresses metrics", ui.indexOf('status === "incomplete"') !== -1 && ui.indexOf("Appointment data for this range is incomplete") !== -1 && ui.indexOf("ff-rpt-warn") !== -1);
check("U: schedule load error does not become 0% utilization", ui.indexOf("SCHEDULE_ERROR_MESSAGE") !== -1 && ui.indexOf("loadCalendarEmployees") !== -1 && src.indexOf("SCHEDULE_ERROR_MESSAGE") !== -1);
check("V: stale/inactive report cannot paint over another report", ui.indexOf("shouldPaintReportResult") !== -1 && ui.indexOf("loadGen") !== -1 && ui.indexOf("isActive") !== -1);
check("V: uses range-complete appointment loader", ui.indexOf("fetchForReport") !== -1 && ui.indexOf("getAppointmentsForDate") === -1 && ui.indexOf("getClientAppointments") === -1);

const tiny = build(
  [appt()],
  [provider("maria", "Maria", [{ startMin: 840, endMin: 900 }])]
);
check("W: tiny working samples do not get a utilization insight", tiny.insights.every(function (line) {
  return line.indexOf("% of provider working time") === -1;
}));
check("W: insights stay neutral", src.indexOf("forecast") === -1 && src.indexOf("expected revenue") === -1 && src.indexOf("recoverable") === -1 && src.indexOf("should move") === -1 && ui.indexOf("Forecast") === -1 && ui.indexOf("expected revenue") === -1);

const n7 = api.rangeForPreset("next_7", "2026-09-14");
const n14 = api.rangeForPreset("next_14", "2026-09-14");
const n30 = api.rangeForPreset("next_30", "2026-09-14");
const custom = api.rangeForPreset("custom", "2026-09-14", "2026-09-20", "2026-09-25");
check("preset: next 7 is today through the 7th civil day", n7.fromKey === "2026-09-14" && n7.toKey === "2026-09-20");
check("preset: next 14 is today through the 14th civil day", n14.fromKey === "2026-09-14" && n14.toKey === "2026-09-27");
check("preset: next 30 is today through the 30th civil day", n30.fromKey === "2026-09-14" && n30.toKey === "2026-10-13");
check("preset: future custom keeps the selected civil keys", custom.fromKey === "2026-09-20" && custom.toKey === "2026-09-25");
check("sales presets are unchanged", sales.rangeForPreset("this_week", "2026-09-14").fromKey === "2026-09-14" && sales.rangeForPreset("next_7", "2026-09-14").fromKey === "2026-09-14" && sales.rangeForPreset("next_7", "2026-09-14").toKey === "2026-09-14");

const presets = api.datePresets("2026-09-14");
check("preset list is next 7/14/30 and custom", presets.map(function (row) { return row.value; }).join(",") === "next_7,next_14,next_30,custom");

check("X: stale request cannot paint", range.shouldPaintReportResult(1, 2, true) === false);
check("X: inactive report cannot paint", range.shouldPaintReportResult(2, 2, false) === false);

const noShow = build([appt({ status: "no_show" })], [provider("maria", "Maria")]);
check("no-show stays booked consistent with Intelligence", noShow.totals.bookedMinutes === 60);

if (failed) process.exit(1);
console.log("All Booking Forward Outlook checks passed.");
