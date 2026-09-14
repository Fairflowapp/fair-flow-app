/**
 * Capacity pattern intelligence. No Firestore.
 * Usage: node scripts/test-booking-reports-capacity-patterns.js
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
load("public/booking/reports/capacity-patterns.js", windowObj);
const intel = windowObj.ffBookingReportsIntelligenceCompute;
const patterns = windowObj.ffBookingReportsCapacityPatterns;

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

function hour(report, h) {
  return ((report.patterns && report.patterns.hours) || []).find(function (row) {
    return row.hour === h;
  }) || null;
}

function weekday(report, key) {
  return ((report.patterns && report.patterns.weekdays) || []).find(function (row) {
    return row.weekday === key;
  }) || null;
}

function dayRow(report, dateKey) {
  return ((report.patterns && report.patterns.days) || []).find(function (row) {
    return row.dateKey === dateKey;
  }) || null;
}

const day = { fromKey: "2026-09-10", toKey: "2026-09-10", locationIds: ["loc"], todayKey: "2026-09-10" };
const work10to6 = [{ startMin: 600, endMin: 1080 }];

const daily = intel.buildReport(Object.assign({
  appointments: [
    appt({
      appointmentId: "m1",
      serviceLines: [line({ providerId: "maria", startMin: 720, endMin: 780, durationMinutes: 60 })]
    }),
    appt({
      appointmentId: "a1",
      serviceLines: [line({ lineId: "a", providerId: "anna", startMin: 600, endMin: 720, durationMinutes: 120 })]
    })
  ],
  providers: [
    provider("maria", "Maria", work10to6),
    provider("anna", "Anna", [{ startMin: 600, endMin: 840 }])
  ]
}, day));
const dailyDay = dayRow(daily, "2026-09-10");
check("A: daily working is the sum of provider minutes", dailyDay && dailyDay.workingMinutes === 720);
check("A: daily booked is the sum of provider booked minutes", dailyDay && dailyDay.bookedMinutes === 180);
check("A: daily utilization uses summed minutes", dailyDay && dailyDay.percent === 25);
check("A: daily idle and open-edge follow provider-capacity rules", dailyDay && dailyDay.idleMinutes === 540 && dailyDay.gapMinutes === 0 && dailyDay.openEdgeMinutes === 540);

const twoMondays = intel.buildReport({
  fromKey: "2026-09-07",
  toKey: "2026-09-14",
  locationIds: ["loc"],
  todayKey: "2026-09-14",
  appointments: [
    appt({
      appointmentId: "m-short",
      dateKey: "2026-09-07",
      serviceLines: [line({ startMin: 600, endMin: 780, durationMinutes: 180 })]
    }),
    appt({
      appointmentId: "m-long",
      dateKey: "2026-09-14",
      serviceLines: [line({ startMin: 600, endMin: 720, durationMinutes: 120 })]
    })
  ],
  providers: [
    {
      id: "maria",
      name: "Maria",
      firstName: "Maria",
      schedule: [
        { dateKey: "2026-09-07", locationId: "loc", windows: [{ startMin: 600, endMin: 840 }] },
        { dateKey: "2026-09-14", locationId: "loc", windows: [{ startMin: 600, endMin: 1080 }] }
      ]
    }
  ]
});
const monday = weekday(twoMondays, "monday");
const avgOfDaily = (75 + 25) / 2;
check("B: two Mondays are one weekday with dateCount 2", monday && monday.dateCount === 2);
check("B: weekday utilization is sum booked / sum working", monday && monday.workingMinutes === 720 && monday.bookedMinutes === 300 && monday.percent === 41.7);
check("B: weekday utilization is not the average of daily percents", monday && monday.percent !== avgOfDaily);

const withClosed = intel.buildReport({
  fromKey: "2026-09-07",
  toKey: "2026-09-08",
  locationIds: ["loc"],
  todayKey: "2026-09-08",
  appointments: [],
  providers: [
    {
      id: "maria",
      name: "Maria",
      firstName: "Maria",
      schedule: [
        { dateKey: "2026-09-07", locationId: "loc", windows: [{ startMin: 600, endMin: 840 }] },
        { dateKey: "2026-09-08", locationId: "loc", windows: [] }
      ]
    }
  ]
});
check("C: closed day is omitted from daily rows", !dayRow(withClosed, "2026-09-08") && !!dayRow(withClosed, "2026-09-07"));
check("C: closed weekday is not a fake 0% utilization record", !weekday(withClosed, "tuesday") && weekday(withClosed, "monday") && weekday(withClosed, "monday").percent === 0 && weekday(withClosed, "monday").workingMinutes === 240);

const hourSlices = [];
patterns.allocateToHours(630, 750, function (h, minutes) {
  hourSlices.push({ hour: h, minutes: minutes });
});
check("D: working 10:30–12:30 allocates 30 / 60 / 30", hourSlices.length === 3 && hourSlices[0].hour === 10 && hourSlices[0].minutes === 30 && hourSlices[1].hour === 11 && hourSlices[1].minutes === 60 && hourSlices[2].hour === 12 && hourSlices[2].minutes === 30);

const hourWork = intel.buildReport(Object.assign({
  appointments: [],
  providers: [provider("maria", "Maria", [{ startMin: 630, endMin: 750 }])]
}, day));
check("D: report hour buckets match partial working windows", hour(hourWork, 10) && hour(hourWork, 10).workingMinutes === 30 && hour(hourWork, 11).workingMinutes === 60 && hour(hourWork, 12).workingMinutes === 30);
check("D: hours without working minutes are omitted", !hour(hourWork, 9) && !hour(hourWork, 13));

const crossHour = intel.buildReport(Object.assign({
  appointments: [appt({
    serviceLines: [line({ startMin: 645, endMin: 675, durationMinutes: 30 })]
  })],
  providers: [provider("maria", "Maria", [{ startMin: 630, endMin: 750 }])]
}, day));
check("E: appointment 10:45–11:15 allocates booked 15 / 15", hour(crossHour, 10) && hour(crossHour, 10).bookedMinutes === 15 && hour(crossHour, 11).bookedMinutes === 15);
check("E: booked minutes are not rounded to a full hour", hour(crossHour, 10).bookedMinutes !== 60 && hour(crossHour, 11).workingMinutes === 60);

const gapCross = intel.buildReport(Object.assign({
  appointments: [
    appt({ appointmentId: "a", serviceLines: [line({ startMin: 720, endMin: 825, durationMinutes: 105 })] }),
    appt({ appointmentId: "b", serviceLines: [line({ lineId: "l2", startMin: 855, endMin: 900, durationMinutes: 45 })] })
  ],
  providers: [provider("maria", "Maria", [{ startMin: 720, endMin: 900 }])]
}, day));
check("F: gap 13:45–14:15 allocates 15 / 15", hour(gapCross, 13) && hour(gapCross, 13).gapMinutes === 15 && hour(gapCross, 14).gapMinutes === 15);
check("F: gap minutes stay a subset of idle in those hours", hour(gapCross, 13).gapMinutes <= hour(gapCross, 13).idleMinutes && hour(gapCross, 14).gapMinutes <= hour(gapCross, 14).idleMinutes);

const multiHour = intel.buildReport(Object.assign({
  appointments: [
    appt({
      appointmentId: "only-maria",
      serviceLines: [line({ providerId: "maria", startMin: 600, endMin: 660, durationMinutes: 60 })]
    })
  ],
  providers: [
    provider("maria", "Maria", [{ startMin: 600, endMin: 660 }]),
    provider("anna", "Anna", [{ startMin: 600, endMin: 660 }])
  ]
}, day));
check("G: two providers in the same hour add provider working minutes", hour(multiHour, 10) && hour(multiHour, 10).workingMinutes === 120);
check("G: one booked provider is 50% utilization in that hour", hour(multiHour, 10).bookedMinutes === 60 && hour(multiHour, 10).percent === 50);

const split = intel.buildReport(Object.assign({
  appointments: [
    appt({ appointmentId: "am", serviceLines: [line({ startMin: 600, endMin: 660, durationMinutes: 60 })] }),
    appt({ appointmentId: "pm", serviceLines: [line({ lineId: "l2", startMin: 840, endMin: 900, durationMinutes: 60 })] })
  ],
  providers: [provider("maria", "Maria", [{ startMin: 600, endMin: 780 }, { startMin: 840, endMin: 1080 }])]
}, day));
check("H: split windows keep 13:00–14:00 out of working time", !hour(split, 13));
check("H: closed lunch is not idle or a gap", hour(split, 12) && hour(split, 12).workingMinutes === 60 && (hour(split, 14) && hour(split, 14).workingMinutes === 60) && split.gaps.totalMinutes === 0);

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
check("I: overlapping same-provider bookings are unioned in the hour buckets", hour(overlap, 12) && hour(overlap, 12).bookedMinutes === 60 && hour(overlap, 13).bookedMinutes === 30);
check("I: overlapping lines do not double-count daily booked time", dayRow(overlap, "2026-09-10") && dayRow(overlap, "2026-09-10").bookedMinutes === 90);

windowObj.ffBookingTime = {
  zonedMinutes: function (value) {
    var t = (value instanceof Date ? value : new Date(value)).getTime();
    if (t === Date.parse("2026-09-10T00:00:00.000Z")) return 630;
    if (t === Date.parse("2026-09-10T02:00:00.000Z")) return 750;
    return 0;
  },
  zonedDateKey: function () { return "2026-09-10"; },
  weekdayKey: function (dateKey) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || "").trim());
    if (!m) return "";
    var utc = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
    return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][utc.getUTCDay()] || "";
  }
};
const naiveHour = new Date("2026-09-10T00:00:00.000Z").getHours();
const zoned = intel.buildReport(Object.assign({
  appointments: [appt({
    serviceLines: [{
      lineId: "tz",
      providerId: "maria",
      startAt: "2026-09-10T00:00:00.000Z",
      endAt: "2026-09-10T02:00:00.000Z",
      durationMinutes: 120,
      requested: false,
      priceSnapshot: 0
    }]
  })],
  providers: [provider("maria", "Maria", [{ startMin: 630, endMin: 750 }])]
}, day));
const zonedHours = ((zoned.patterns && zoned.patterns.hours) || []).map(function (row) { return row.hour; });
check("J: salon-local minutes win over the Date wall-clock hour", hour(zoned, 10) && hour(zoned, 10).workingMinutes === 30 && hour(zoned, 11).workingMinutes === 60 && hour(zoned, 12).workingMinutes === 30);
check("J: buckets follow salon minutes, not Date.getHours()", zonedHours.join(",") === "10,11,12");
if (naiveHour !== 10 && naiveHour !== 11 && naiveHour !== 12) {
  check("J: browser/system hour of the timestamp is not a working bucket", !hour(zoned, naiveHour));
}
check("J: civil date weekday is Thursday, not a UTC-midnight shift", patterns.weekdayFromDateKey("2026-09-10") === "thursday" && dayRow(zoned, "2026-09-10").weekday === "thursday");
delete windowObj.ffBookingTime;

const tiny = intel.buildReport({
  fromKey: "2026-09-07",
  toKey: "2026-09-08",
  locationIds: ["loc"],
  todayKey: "2026-09-08",
  appointments: [
    appt({
      appointmentId: "mon",
      dateKey: "2026-09-07",
      serviceLines: [line({ startMin: 600, endMin: 630, durationMinutes: 30 })]
    }),
    appt({
      appointmentId: "tue",
      dateKey: "2026-09-08",
      serviceLines: [line({ startMin: 600, endMin: 645, durationMinutes: 45 })]
    })
  ],
  providers: [
    {
      id: "maria",
      name: "Maria",
      firstName: "Maria",
      schedule: [
        { dateKey: "2026-09-07", locationId: "loc", windows: [{ startMin: 600, endMin: 660 }] },
        { dateKey: "2026-09-08", locationId: "loc", windows: [{ startMin: 600, endMin: 660 }] }
      ]
    }
  ]
});
check("K: tiny weekday samples are not ranked for utilization", tiny.insights.every(function (line) {
  return line.indexOf("lowest utilization") === -1 && line.indexOf("most utilized weekday") === -1;
}));
check("K: tiny hour samples are not ranked for utilization", tiny.insights.every(function (line) {
  return line.indexOf("providers were booked for") === -1;
}));
check("K: weekday rows still exist when working time is present", weekday(tiny, "monday") && weekday(tiny, "monday").workingMinutes === 60 && weekday(tiny, "tuesday") && weekday(tiny, "tuesday").workingMinutes === 60);

const oneDay = intel.buildReport(Object.assign({
  appointments: [
    appt({ appointmentId: "a", serviceLines: [line({ startMin: 600, endMin: 660, durationMinutes: 60 })] }),
    appt({ appointmentId: "b", serviceLines: [line({ lineId: "l2", startMin: 780, endMin: 840, durationMinutes: 60 })] })
  ],
  providers: [provider("maria", "Maria", work10to6)]
}, day));
check("L: one-day report still has daily and weekday rows", dayRow(oneDay, "2026-09-10") && weekday(oneDay, "thursday"));
check("L: one-day report does not invent a weekday comparison", oneDay.insights.every(function (line) {
  return line.indexOf("lowest utilization") === -1 && line.indexOf("most utilized weekday") === -1;
}));
check("L: one weekday can still mention gap hours without ranking days", oneDay.insights.some(function (line) {
  return line.indexOf("Thursday had") !== -1 && line.indexOf("calendar gaps") !== -1;
}));

check("weekdayFromDateKey uses civil dates", patterns.weekdayFromDateKey("2026-09-07") === "monday" && patterns.weekdayFromDateKey("2026-09-13") === "sunday");
check("insights stay descriptive", oneDay.insights.concat(tiny.insights, twoMondays.insights).every(function (line) {
  return line.indexOf("recoverable") === -1 && line.indexOf("lost revenue") === -1 && line.indexOf("could have been filled") === -1 && line.indexOf("bad day") === -1 && line.indexOf("poor performance") === -1 && line.indexOf("inefficient") === -1;
}));

const uiSrc = fs.readFileSync(path.join(root, "public/booking/reports/intelligence.js"), "utf8");
check("ui keeps patterns inside Booking Intelligence", uiSrc.indexOf("Capacity patterns") !== -1 && uiSrc.indexOf("data-ff-intel-pattern") !== -1);
check("ui does not add scheduling actions", uiSrc.indexOf("recoverable") === -1 && uiSrc.indexOf("move appointment") === -1);

if (failed) process.exit(1);
console.log("All Booking capacity pattern checks passed.");
