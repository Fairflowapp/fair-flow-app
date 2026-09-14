/**
 * Booking Intelligence calculations. No Firestore.
 * Usage: node scripts/test-booking-reports-intelligence.js
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
    startMin: 540,
    endMin: 600,
    durationMinutes: 60,
    requested: false,
    priceSnapshot: 0
  }, partial);
}

function provider(id, name, windows, dateKey) {
  return {
    id: id,
    name: name,
    firstName: name,
    schedule: [{
      dateKey: dateKey || "2026-09-10",
      locationId: "loc",
      windows: windows
    }]
  };
}

const day = { fromKey: "2026-09-10", toKey: "2026-09-10", locationIds: ["loc"], todayKey: "2026-09-10" };
const work9to5 = [{ startMin: 540, endMin: 1020 }];
const work9to12 = [{ startMin: 540, endMin: 720 }];
const maria = provider("maria", "Maria", work9to5);

const none = intel.buildReport(Object.assign({
  appointments: [],
  providers: [maria]
}, day));
check("no appointments: total is 0", none.appointments.total === 0 && none.appointments.cancellationRate === 0);
check("no appointments: no booked minutes", none.utilization.bookedMinutes === 0);
check("no appointments: working minutes still count", none.utilization.workingMinutes === 480);
check("no appointments: no calendar gaps", none.gaps.count === 0 && none.gaps.totalMinutes === 0);
check("no appointments: no estimated dollars", none.capacity.estimatedDollars == null);
check("no appointments: insight is from empty data", none.insights[0] === "No appointments were found today.");
check("no appointments: scheduled-hours insight uses working time", none.insights.some(function (line) {
  return line === "Providers were scheduled for 8 provider hours with no booked appointments.";
}));

const full = intel.buildReport(Object.assign({
  appointments: [appt({
    appointmentId: "full",
    status: "completed",
    serviceLines: [line({ startMin: 540, endMin: 1020, durationMinutes: 480, priceSnapshot: 400 })]
  })],
  providers: [maria]
}, day));
check("full utilization is 100%", full.utilization.percent === 100 && full.utilization.bookedMinutes === 480 && full.utilization.idleMinutes === 0);
check("full utilization has no gaps", full.gaps.count === 0 && full.gaps.totalMinutes === 0);
check("full utilization has no unused capacity estimate", full.capacity.estimatedDollars == null && full.capacity.unusedPercent === 0);

const gap15 = intel.buildReport(Object.assign({
  appointments: [
    appt({ appointmentId: "a", serviceLines: [line({ startMin: 540, endMin: 600, durationMinutes: 60 })] }),
    appt({ appointmentId: "b", serviceLines: [line({ lineId: "l2", startMin: 615, endMin: 720, durationMinutes: 105 })] })
  ],
  providers: [provider("maria", "Maria", work9to12)]
}, day));
check("one 15-minute gap is counted", gap15.gaps.count === 1 && gap15.gaps.totalMinutes === 15 && gap15.gaps.smallCount === 1);
check("15-minute gap is not a larger gap", gap15.gaps.largerCount === 0);
check("15-minute gap booked minutes exclude the hole", gap15.utilization.bookedMinutes === 165 && gap15.utilization.workingMinutes === 180);

const gap30 = intel.buildReport(Object.assign({
  appointments: [
    appt({ appointmentId: "a", serviceLines: [line({ startMin: 540, endMin: 600, durationMinutes: 60 })] }),
    appt({ appointmentId: "b", serviceLines: [line({ lineId: "l2", startMin: 630, endMin: 720, durationMinutes: 90 })] })
  ],
  providers: [provider("maria", "Maria", work9to12)]
}, day));
check("one 30-minute gap is a small recoverable gap", gap30.gaps.count === 1 && gap30.gaps.totalMinutes === 30 && gap30.gaps.smallCount === 1);
check("30-minute gap insight mentions recoverable gaps", gap30.insights.some(function (line) {
  return line === "1 gap of 30 minutes or less was detected and may have been recoverable.";
}));

const many = intel.buildReport(Object.assign({
  appointments: [
    appt({ appointmentId: "a", serviceLines: [line({ startMin: 540, endMin: 600, durationMinutes: 60 })] }),
    appt({ appointmentId: "b", serviceLines: [line({ lineId: "l2", startMin: 615, endMin: 660, durationMinutes: 45 })] }),
    appt({ appointmentId: "c", serviceLines: [line({ lineId: "l3", startMin: 705, endMin: 780, durationMinutes: 75 })] })
  ],
  providers: [provider("maria", "Maria", [{ startMin: 540, endMin: 840 }])]
}, day));
check("multiple gaps are counted separately", many.gaps.count === 2 && many.gaps.smallCount === 1 && many.gaps.largerCount === 1);
check("multiple gaps add minutes", many.gaps.totalMinutes === 60 && many.gaps.smallMinutes === 15 && many.gaps.largerMinutes === 45);

const cancelledOnly = intel.buildReport(Object.assign({
  appointments: [appt({
    appointmentId: "cx",
    status: "cancelled",
    serviceLines: [line({ startMin: 540, endMin: 720, durationMinutes: 180, requested: true, priceSnapshot: 90 })]
  })],
  providers: [provider("maria", "Maria", work9to12)]
}, day));
check("cancelled appointment is not booked time", cancelledOnly.utilization.bookedMinutes === 0 && cancelledOnly.appointments.cancelled === 1);
check("cancelled appointment does not create requested lines", cancelledOnly.requested.totalLines === 0);
check("cancelled appointment does not create gaps by itself", cancelledOnly.gaps.count === 0);

const cancelledBetween = intel.buildReport(Object.assign({
  appointments: [
    appt({ appointmentId: "a", status: "confirmed", serviceLines: [line({ startMin: 540, endMin: 600, durationMinutes: 60 })] }),
    appt({ appointmentId: "cx", status: "cancelled", serviceLines: [line({ lineId: "cx", startMin: 600, endMin: 660, durationMinutes: 60 })] }),
    appt({ appointmentId: "b", status: "completed", serviceLines: [line({ lineId: "l2", startMin: 660, endMin: 720, durationMinutes: 60 })] })
  ],
  providers: [provider("maria", "Maria", work9to12)]
}, day));
check("cancelled appointment between actives leaves a gap", cancelledBetween.gaps.count === 1 && cancelledBetween.gaps.totalMinutes === 60);
check("cancelled appointment is excluded from booked minutes", cancelledBetween.utilization.bookedMinutes === 120);

const noShow = intel.buildReport(Object.assign({
  appointments: [appt({
    appointmentId: "ns",
    status: "no_show",
    serviceLines: [line({ startMin: 540, endMin: 600, durationMinutes: 60 })]
  })],
  providers: [provider("maria", "Maria", work9to12)]
}, day));
check("no-show still occupies booked time", noShow.appointments.noShow === 1 && noShow.utilization.bookedMinutes === 60);

const multi = intel.buildReport(Object.assign({
  appointments: [
    appt({
      appointmentId: "m1",
      serviceLines: [line({ providerId: "maria", startMin: 540, endMin: 780, durationMinutes: 240 })]
    }),
    appt({
      appointmentId: "m2",
      serviceLines: [line({ lineId: "l2", providerId: "alex", startMin: 540, endMin: 900, durationMinutes: 360 })]
    })
  ],
  providers: [
    provider("maria", "Maria", work9to5),
    provider("alex", "Alex", work9to5)
  ]
}, day));
check("multiple providers keep separate booked minutes", multi.utilization.providers[0].bookedMinutes === 240 && multi.utilization.providers[1].bookedMinutes === 360);
check("multiple providers share a location average", multi.utilization.workingMinutes === 960 && multi.utilization.bookedMinutes === 600 && multi.utilization.percent === 62.5);
check("lowest-utilization insight uses real percents", multi.insights.some(function (line) {
  return line === "Provider Maria had 50% utilization compared with the location average of 62.5%.";
}));

const hoursDiffer = intel.buildReport(Object.assign({
  appointments: [
    appt({
      appointmentId: "h1",
      serviceLines: [line({ providerId: "maria", startMin: 600, endMin: 660, durationMinutes: 60 })]
    }),
    appt({
      appointmentId: "h2",
      serviceLines: [line({ lineId: "l2", providerId: "alex", startMin: 600, endMin: 660, durationMinutes: 60 })]
    })
  ],
  providers: [
    provider("maria", "Maria", work9to5),
    provider("alex", "Alex", [{ startMin: 600, endMin: 840 }])
  ]
}, day));
check("different working hours change utilization", hoursDiffer.utilization.providers[0].percent === 12.5 && hoursDiffer.utilization.providers[1].percent === 25);
check("different working hours keep idle correct", hoursDiffer.utilization.providers[0].idleMinutes === 420 && hoursDiffer.utilization.providers[1].idleMinutes === 180);

const requested = intel.buildReport(Object.assign({
  appointments: [
    appt({
      appointmentId: "r1",
      serviceLines: [
        line({ lineId: "a", requested: true }),
        line({ lineId: "b", requested: true, startMin: 600, endMin: 660 }),
        line({ lineId: "c", requested: false, startMin: 660, endMin: 720 })
      ]
    })
  ],
  providers: [maria]
}, day));
check("requested vs non-requested lines", requested.requested.requestedLines === 2 && requested.requested.nonRequestedLines === 1);
check("requested percentage is 66.7", requested.requested.requestedPercent === 66.7);

const clients = intel.buildReport(Object.assign({
  appointments: [
    appt({ appointmentId: "n1", firstVisit: true }),
    appt({ appointmentId: "n2", firstVisit: true, status: "completed" }),
    appt({ appointmentId: "r1", firstVisit: false }),
    appt({ appointmentId: "r2", firstVisit: false }),
    appt({ appointmentId: "r3" })
  ],
  providers: [maria]
}, day));
check("new vs returning uses firstVisit", clients.clients.newAppointments === 2 && clients.clients.returningAppointments === 3);
check("client volume percents add to 100", clients.clients.newPercent === 40 && clients.clients.returningPercent === 60);

const sources = intel.buildReport(Object.assign({
  appointments: [
    appt({ appointmentId: "s1", source: "front_desk" }),
    appt({ appointmentId: "s2", source: "phone" }),
    appt({ appointmentId: "s3", source: "online" }),
    appt({ appointmentId: "s4", source: "walk_in" }),
    appt({ appointmentId: "s5", source: "internal" }),
    appt({ appointmentId: "s6", source: "phone" })
  ],
  providers: [maria]
}, day));
check("multiple booking sources are counted", sources.sources.counts.front_desk === 1 && sources.sources.counts.phone === 2 && sources.sources.counts.online === 1 && sources.sources.counts.walk_in === 1 && sources.sources.counts.internal === 1);
check("source total matches appointments", sources.sources.total === 6 && sources.appointments.total === 6);

const overlap = intel.buildReport(Object.assign({
  appointments: [appt({
    appointmentId: "ov",
    status: "confirmed",
    serviceLines: [
      line({ lineId: "a", startMin: 540, endMin: 660, durationMinutes: 120 }),
      line({ lineId: "b", startMin: 600, endMin: 720, durationMinutes: 120 })
    ]
  })],
  providers: [provider("maria", "Maria", work9to12)]
}, day));
check("overlapping lines do not double-count booked minutes", overlap.utilization.bookedMinutes === 180);

const statuses = intel.buildReport(Object.assign({
  appointments: [
    appt({ appointmentId: "c1", status: "completed" }),
    appt({ appointmentId: "s1", status: "scheduled" }),
    appt({ appointmentId: "f1", status: "confirmed" }),
    appt({ appointmentId: "x1", status: "cancelled" }),
    appt({ appointmentId: "n1", status: "no_show" })
  ],
  providers: [maria]
}, day));
check("appointment status totals", statuses.appointments.total === 5 && statuses.appointments.completed === 1 && statuses.appointments.scheduled === 1 && statuses.appointments.confirmed === 1 && statuses.appointments.cancelled === 1 && statuses.appointments.noShow === 1);
check("cancellation rate is 20%", statuses.appointments.cancellationRate === 20);

const estimated = intel.buildReport(Object.assign({
  appointments: [
    appt({
      appointmentId: "p1",
      status: "completed",
      serviceLines: [line({ startMin: 540, endMin: 600, durationMinutes: 60, priceSnapshot: 60 })]
    }),
    appt({
      appointmentId: "p2",
      status: "completed",
      serviceLines: [line({ lineId: "l2", startMin: 630, endMin: 690, durationMinutes: 60, priceSnapshot: 60 })]
    })
  ],
  providers: [provider("maria", "Maria", [{ startMin: 540, endMin: 720 }])]
}, day));
check("estimated unused capacity uses booked rate times gap minutes", estimated.capacity.averageRatePerMinute === 1 && estimated.capacity.estimatedDollars === 30);
check("estimated unused capacity insight is labeled as estimate", estimated.insights.some(function (line) {
  return line === "Estimated unused service capacity is $30.00. This is estimated capacity, not actual lost revenue.";
}));
check("unused capacity percent is gap over working minutes", estimated.capacity.unusedPercent === 16.7 && estimated.gaps.totalMinutes === 30);

const peak = intel.buildReport(Object.assign({
  appointments: [
    appt({ appointmentId: "a", serviceLines: [line({ startMin: 720, endMin: 780, durationMinutes: 60 })] }),
    appt({ appointmentId: "b", serviceLines: [line({ lineId: "l2", startMin: 960, endMin: 1020, durationMinutes: 60 })] })
  ],
  providers: [provider("maria", "Maria", [{ startMin: 720, endMin: 1020 }])]
}, day));
check("peak unused period is between 1 PM and 4 PM", peak.gaps.peakPeriod && peak.gaps.peakPeriod.label === "1 PM and 4 PM");
check("gap hours insight uses calculated hours", peak.insights.some(function (line) {
  return line === "3 provider hours were left as calendar gaps today.";
}));
const oneHourGap = intel.buildReport(Object.assign({
  appointments: [
    appt({ appointmentId: "a", serviceLines: [line({ startMin: 540, endMin: 600, durationMinutes: 60 })] }),
    appt({ appointmentId: "b", serviceLines: [line({ lineId: "l2", startMin: 660, endMin: 720, durationMinutes: 60 })] })
  ],
  providers: [provider("maria", "Maria", work9to12)]
}, day));
check("one hour gap uses singular insight wording", oneHourGap.gaps.totalMinutes === 60 && oneHourGap.insights.some(function (line) {
  return line === "1 provider hour was left as calendar gaps today.";
}));
check("provider with most gap time is Maria", peak.gaps.mostGapProvider && peak.gaps.mostGapProvider.id === "maria" && peak.gaps.mostGapProvider.minutes === 180);

const week = intel.buildReport({
  appointments: [
    appt({
      appointmentId: "w1",
      dateKey: "2026-09-07",
      serviceLines: [line({ startMin: 540, endMin: 600, durationMinutes: 60 })]
    }),
    appt({
      appointmentId: "w2",
      dateKey: "2026-09-08",
      serviceLines: [line({ lineId: "l2", startMin: 630, endMin: 690, durationMinutes: 60 })]
    }),
    appt({
      appointmentId: "w3",
      dateKey: "2026-09-08",
      serviceLines: [line({ lineId: "l3", startMin: 540, endMin: 600, durationMinutes: 60 })]
    })
  ],
  providers: [
    {
      id: "maria",
      name: "Maria Lopez",
      firstName: "Maria",
      schedule: [
        { dateKey: "2026-09-07", locationId: "loc", windows: work9to12 },
        { dateKey: "2026-09-08", locationId: "loc", windows: work9to12 }
      ]
    }
  ],
  fromKey: "2026-09-07",
  toKey: "2026-09-13",
  locationIds: ["loc"],
  todayKey: "2026-09-10"
});
check("week range insight says this week", week.gaps.totalMinutes === 30 && week.insights.some(function (line) {
  return line === "0.5 provider hours were left as calendar gaps this week.";
}));

const otherLoc = intel.buildReport(Object.assign({
  appointments: [appt({ locationId: "other", serviceLines: [line()] })],
  providers: [maria]
}, day));
check("appointments at another location are excluded", otherLoc.appointments.total === 0);

check("dateKeysBetween covers a month", intel.dateKeysBetween("2026-08-01", "2026-08-31").length === 31);
check("small gap max is 30 minutes", intel.SMALL_GAP_MAX === 30);
check("cancelled is not a booked status", intel.isBookedStatus("cancelled") === false && intel.isBookedStatus("completed") === true && intel.isBookedStatus("no_show") === true);

const uiSrc = fs.readFileSync(path.join(root, "public/booking/reports/intelligence.js"), "utf8");
const navSrc = fs.readFileSync(path.join(root, "public/booking/reports/nav.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/booking/reports/reports.css"), "utf8");
check("intelligence ui keeps sales summary out of its own paint", uiSrc.indexOf("Sales Summary stays") !== -1);
check("intelligence ui does not read Firestore", uiSrc.indexOf("getFirestore") === -1 && uiSrc.indexOf("collection(") === -1);
check("intelligence ui uses existing appointment reads", uiSrc.indexOf("getAppointmentsForDate") !== -1);
check("intelligence ui uses existing calendar employees for hours", uiSrc.indexOf("loadCalendarEmployees") !== -1);
check("nav includes booking intelligence", navSrc.indexOf('id: "booking-intelligence"') !== -1);
check("dashboard styles stay in reports css", css.indexOf(".ff-rpt-insights") !== -1 && css.indexOf(".ff-rpt-estimate-label") !== -1);
check("estimated capacity is labeled in the ui", uiSrc.indexOf("Estimated capacity") !== -1 && uiSrc.indexOf("not actual lost revenue") !== -1);

if (failed) process.exit(1);
console.log("All Booking Intelligence report checks passed.");
