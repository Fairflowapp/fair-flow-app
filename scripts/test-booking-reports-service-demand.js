/**
 * Service demand intelligence. No Firestore. No Sales collection.
 * Usage: node scripts/test-booking-reports-service-demand.js
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
load("public/booking/reports/service-demand.js", windowObj);
const intel = windowObj.ffBookingReportsIntelligenceCompute;
const demandApi = windowObj.ffBookingReportsServiceDemand;

function appt(partial) {
  return Object.assign({
    appointmentId: "a1",
    clientId: "c1",
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
    serviceId: "gel",
    serviceNameSnapshot: "Gel Manicure",
    providerId: "maria",
    startMin: 600,
    endMin: 660,
    durationMinutes: 60,
    requested: false,
    priceSnapshot: 60
  }, partial);
}

function provider(id, name, windows) {
  return {
    id: id,
    name: name,
    firstName: name,
    schedule: [{ dateKey: "2026-09-10", locationId: "loc", windows: windows }]
  };
}

function svc(report, idOrName) {
  var services = (report && report.serviceDemand && report.serviceDemand.services)
    || (report && report.services)
    || [];
  return services.find(function (row) {
    return row.serviceId === idOrName || row.name === idOrName || row.key === idOrName;
  }) || null;
}

const day = { fromKey: "2026-09-10", toKey: "2026-09-10", locationIds: ["loc"], todayKey: "2026-09-10" };
const work10to6 = [{ startMin: 600, endMin: 1080 }];

const basic = intel.buildReport(Object.assign({
  appointments: [
    appt({
      appointmentId: "a1",
      clientId: "c1",
      serviceLines: [line({ lineId: "l1", startMin: 600, endMin: 660 })]
    }),
    appt({
      appointmentId: "a2",
      clientId: "c2",
      serviceLines: [line({ lineId: "l2", startMin: 720, endMin: 780, durationMinutes: 60 })]
    })
  ],
  providers: [provider("maria", "Maria", work10to6)]
}, day));
const gel = svc(basic, "gel");
check("A: two lines of the same service aggregate", gel && gel.lineCount === 2 && gel.appointmentCount === 2);
check("A: booked minutes and value add", gel && gel.bookedMinutes === 120 && gel.bookedServiceValue === 120);
check("A: average booked value is per priced line", gel && gel.averageBookedValue === 60);

const multiService = intel.buildReport(Object.assign({
  appointments: [appt({
    appointmentId: "combo",
    clientId: "c1",
    serviceLines: [
      line({ lineId: "g", serviceId: "gel", serviceNameSnapshot: "Gel Manicure", durationMinutes: 60, priceSnapshot: 60 }),
      line({ lineId: "p", serviceId: "pedi", serviceNameSnapshot: "Pedicure", providerId: "anna", startMin: 660, endMin: 780, durationMinutes: 120, priceSnapshot: 80 })
    ]
  })],
  providers: [provider("maria", "Maria", work10to6), provider("anna", "Anna", work10to6)]
}, day));
check("B: multi-service appointment keeps separate services", svc(multiService, "gel") && svc(multiService, "pedi") && multiService.serviceDemand.totals.serviceCount === 2);
check("B: each service keeps its own line metrics", svc(multiService, "gel").lineCount === 1 && svc(multiService, "pedi").lineCount === 1 && svc(multiService, "pedi").bookedMinutes === 120);

const multiProvider = intel.buildReport(Object.assign({
  appointments: [appt({
    appointmentId: "party",
    clientId: "c1",
    serviceLines: [
      line({ lineId: "a", providerId: "maria", durationMinutes: 90, startMin: 600, endMin: 690, priceSnapshot: 90 }),
      line({ lineId: "b", providerId: "anna", durationMinutes: 30, startMin: 600, endMin: 630, priceSnapshot: 30 })
    ]
  })],
  providers: [provider("maria", "Maria", work10to6), provider("anna", "Anna", work10to6)]
}, day));
const shared = svc(multiProvider, "gel");
check("C: same service on two providers counts both", shared && shared.providerCount === 2 && shared.bookedMinutes === 120);
check("C: top-provider share uses service minutes", shared && shared.topProviderSharePercent === 75);
check("C: overlapping service lines still add demand minutes", multiProvider.serviceDemand.totals.bookedMinutes === 120);

const cancelled = intel.buildReport(Object.assign({
  appointments: [
    appt({
      appointmentId: "live",
      serviceLines: [line({ durationMinutes: 60, priceSnapshot: 50 })]
    }),
    appt({
      appointmentId: "cx",
      status: "cancelled",
      serviceLines: [line({ lineId: "cx", serviceId: "gel", durationMinutes: 90, priceSnapshot: 90 })]
    })
  ],
  providers: [provider("maria", "Maria", work10to6)]
}, day));
check("D: cancelled appointment is not active service demand", svc(cancelled, "gel") && svc(cancelled, "gel").lineCount === 1 && svc(cancelled, "gel").bookedMinutes === 60 && cancelled.serviceDemand.totals.bookedServiceValue === 50);

const valueHour = demandApi.buildServiceDemand([
  appt({
    serviceLines: [line({ durationMinutes: 90, priceSnapshot: 120, startMin: 600, endMin: 690 })]
  })
]);
check("E: $120 over 90 priced minutes is $80 per provider hour", valueHour.services[0].valuePerProviderHour === 80);

const missingPrice = intel.buildReport(Object.assign({
  appointments: [
    appt({
      appointmentId: "priced",
      serviceLines: [line({ durationMinutes: 60, priceSnapshot: 80 })]
    }),
    appt({
      appointmentId: "free",
      clientId: "c2",
      serviceLines: [line({ lineId: "f", durationMinutes: 60, priceSnapshot: 0 })]
    })
  ],
  providers: [provider("maria", "Maria", work10to6)]
}, day));
const missingRow = svc(missingPrice, "gel");
check("F: missing price still counts time and lines", missingRow && missingRow.lineCount === 2 && missingRow.bookedMinutes === 120);
check("F: missing price does not add booked value", missingRow.bookedServiceValue === 80 && missingRow.unpricedLineCount === 1);
check("F: value per hour uses priced duration only", missingRow.valuePerProviderHour === 80 && missingRow.pricedMinutes === 60);

const zeroDur = demandApi.buildServiceDemand([
  appt({
    serviceLines: [line({ durationMinutes: 0, startMin: 0, endMin: 0, priceSnapshot: 200 })]
  })
]);
const zeroRow = zeroDur.services[0];
check("G: zero duration does not create a value-per-hour figure", zeroRow && zeroRow.valuePerProviderHour == null);
check("G: zero duration does not invent booked minutes", zeroRow.bookedMinutes === 0 && zeroRow.bookedServiceValue === 200);

const concentration = demandApi.buildServiceDemand([
  appt({
    appointmentId: "a",
    clientId: "c1",
    serviceLines: [line({ lineId: "a", providerId: "maria", durationMinutes: 180, priceSnapshot: 90 })]
  }),
  appt({
    appointmentId: "b",
    clientId: "c2",
    serviceLines: [line({ lineId: "b", providerId: "anna", durationMinutes: 120, priceSnapshot: 60 })]
  })
]);
check("H: top-provider share is 60% of 300 minutes", concentration.services[0].bookedMinutes === 300 && concentration.services[0].topProviderSharePercent === 60);
check("H: both providers are counted", concentration.services[0].providerCount === 2);

const clients = demandApi.buildServiceDemand([
  appt({ appointmentId: "a", clientId: "same", serviceLines: [line({ lineId: "a" })] }),
  appt({ appointmentId: "b", clientId: "same", serviceLines: [line({ lineId: "b" })] })
]);
check("I: same client booking twice is one unique client", clients.services[0].clientCount === 1 && clients.services[0].appointmentCount === 2);

const twoLines = demandApi.buildServiceDemand([
  appt({
    appointmentId: "double",
    clientId: "c1",
    serviceLines: [
      line({ lineId: "a", durationMinutes: 45, priceSnapshot: 40 }),
      line({ lineId: "b", durationMinutes: 45, priceSnapshot: 40 })
    ]
  })
]);
check("J: two same-service lines in one appointment keep line vs appointment counts", twoLines.services[0].lineCount === 2 && twoLines.services[0].appointmentCount === 1);
check("J: both line durations count as service demand", twoLines.services[0].bookedMinutes === 90);

const renamed = demandApi.buildServiceDemand([
  appt({
    appointmentId: "old",
    serviceLines: [line({ lineId: "a", serviceId: "gel", serviceNameSnapshot: "Gel" })]
  }),
  appt({
    appointmentId: "new",
    clientId: "c2",
    serviceLines: [line({ lineId: "b", serviceId: "gel", serviceNameSnapshot: "Gel Manicure" })]
  })
]);
check("K: same serviceId stays one service when snapshot names differ", renamed.services.length === 1 && renamed.services[0].lineCount === 2);
check("K: display name uses the more common snapshot", renamed.services[0].name === "Gel" || renamed.services[0].name === "Gel Manicure");

const noId = demandApi.buildServiceDemand([
  appt({
    appointmentId: "a",
    serviceLines: [line({ lineId: "a", serviceId: "", serviceNameSnapshot: "Gel Manicure" })]
  }),
  appt({
    appointmentId: "b",
    clientId: "c2",
    serviceLines: [line({ lineId: "b", serviceId: "", serviceNameSnapshot: "Builder Gel" })]
  })
]);
check("L: missing serviceId does not merge different snapshot names", noId.services.length === 2);
check("L: each unnamed-id service keeps its snapshot name", !!svc(noId, "Gel Manicure") && !!svc(noId, "Builder Gel"));

const mix = demandApi.buildServiceDemand([
  appt({
    appointmentId: "a",
    serviceLines: [line({ serviceId: "gel", serviceNameSnapshot: "Gel Manicure", durationMinutes: 60, priceSnapshot: 40 })]
  }),
  appt({
    appointmentId: "b",
    clientId: "c2",
    serviceLines: [line({ serviceId: "pedi", serviceNameSnapshot: "Pedicure", durationMinutes: 180, priceSnapshot: 120 })]
  })
]);
check("M: value share uses priced service value as the denominator", svc(mix, "pedi").valueSharePercent === 75 && svc(mix, "gel").valueSharePercent === 25);
check("N: time mix uses service-line booked minutes as the denominator", svc(mix, "pedi").timeMixPercent === 75 && svc(mix, "gel").timeMixPercent === 25);

const overlapMix = intel.buildReport(Object.assign({
  appointments: [appt({
    appointmentId: "overlap",
    serviceLines: [
      line({ lineId: "a", durationMinutes: 60, startMin: 600, endMin: 660, priceSnapshot: 40 }),
      line({ lineId: "b", durationMinutes: 60, startMin: 630, endMin: 690, priceSnapshot: 40 })
    ]
  })],
  providers: [provider("maria", "Maria", work10to6)]
}, day));
check("N: overlapping same-provider lines add 120 service minutes", overlapMix.serviceDemand.totals.bookedMinutes === 120);
check("N: provider utilization unions those overlaps to 90 booked minutes", overlapMix.utilization.bookedMinutes === 90);

const tinyValue = intel.buildReport(Object.assign({
  appointments: [
    appt({
      appointmentId: "pricey",
      serviceLines: [line({
        serviceId: "art",
        serviceNameSnapshot: "Nail Art",
        durationMinutes: 15,
        startMin: 600,
        endMin: 615,
        priceSnapshot: 200
      })]
    }),
    appt({
      appointmentId: "volume",
      clientId: "c2",
      serviceLines: [line({
        serviceId: "gel",
        serviceNameSnapshot: "Gel Manicure",
        durationMinutes: 180,
        startMin: 720,
        endMin: 900,
        priceSnapshot: 90
      })]
    })
  ],
  providers: [provider("maria", "Maria", work10to6)]
}, day));
check("O: tiny priced sample is not ranked as highest value per hour", tinyValue.insights.every(function (line) {
  return line.indexOf("Nail Art had the highest booked value per provider hour") === -1;
}));
check("O: a service with enough priced minutes can still be ranked", tinyValue.insights.some(function (line) {
  return line.indexOf("Gel Manicure had the highest booked value per provider hour") !== -1;
}));
check("insights stay descriptive", tinyValue.insights.concat(basic.insights).every(function (line) {
  return line.indexOf("most profitable") === -1
    && line.indexOf("best service") === -1
    && line.indexOf("losing money") === -1
    && line.indexOf("should raise prices") === -1
    && line.indexOf("causes the most calendar gaps") === -1;
}));

const noShow = demandApi.buildServiceDemand([
  appt({
    appointmentId: "ns",
    status: "no_show",
    serviceLines: [line({ durationMinutes: 60, priceSnapshot: 55 })]
  })
]);
check("no-show still counts as booked demand, matching existing Reports status rules", noShow.services[0] && noShow.services[0].bookedMinutes === 60);

const src = fs.readFileSync(path.join(root, "public/booking/reports/service-demand.js"), "utf8");
const uiSrc = fs.readFileSync(path.join(root, "public/booking/reports/intelligence.js"), "utf8");
check("module documents service-mix vs provider-union duration", src.indexOf("Provider utilization unions") !== -1 && src.indexOf("service mix minutes can differ") !== -1);
check("ui uses booked service value language", uiSrc.indexOf("Booked service value") !== -1 && uiSrc.indexOf("booked value density") !== -1);
check("ui does not query sales for service demand", src.indexOf("ffBookingSales") === -1 && src.indexOf("getSales") === -1);

if (failed) process.exit(1);
console.log("All Booking service demand checks passed.");
