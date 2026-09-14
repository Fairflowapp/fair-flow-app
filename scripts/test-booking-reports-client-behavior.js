/**
 * Client behavior intelligence. No Firestore. No per-client reads.
 * Usage: node scripts/test-booking-reports-client-behavior.js
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
load("public/booking/reports/client-behavior.js", windowObj);
const intel = windowObj.ffBookingReportsIntelligenceCompute;
const behaviorApi = windowObj.ffBookingReportsClientBehavior;

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

const day = { fromKey: "2026-09-10", toKey: "2026-09-10", locationIds: ["loc"], todayKey: "2026-09-10" };

function report(appointments, range) {
  return intel.buildReport(Object.assign({
    appointments: appointments,
    providers: []
  }, range || day));
}

const unique = behaviorApi.buildClientBehavior([
  appt({ appointmentId: "a1", clientId: "same", dateKey: "2026-09-10", serviceLines: [line()] }),
  appt({ appointmentId: "a2", clientId: "same", dateKey: "2026-09-11", serviceLines: [line({ lineId: "l2" })] })
]);
check("A: same client across appointments counts once", unique.identifiedClientCount === 1 && unique.identifiedAppointmentCount === 2);

const mixedVisit = behaviorApi.buildClientBehavior([
  appt({ appointmentId: "new", clientId: "c1", firstVisit: true, serviceLines: [line()] }),
  appt({ appointmentId: "later", clientId: "c1", firstVisit: false, serviceLines: [line({ lineId: "l2" })] }),
  appt({ appointmentId: "old", clientId: "c2", firstVisit: false, serviceLines: [line({ lineId: "l3" })] })
]);
check("B: any firstVisit in range classifies the client once as first-visit", mixedVisit.firstVisitClientCount === 1 && mixedVisit.returningClientCount === 1);
check("B: a client is never in both groups", mixedVisit.firstVisitClientCount + mixedVisit.returningClientCount === mixedVisit.identifiedClientCount);

const repeat = behaviorApi.buildClientBehavior([
  appt({ appointmentId: "a1", clientId: "rep", serviceLines: [line()] }),
  appt({ appointmentId: "a2", clientId: "rep", dateKey: "2026-09-12", serviceLines: [line({ lineId: "l2" })] }),
  appt({ appointmentId: "b1", clientId: "once", serviceLines: [line({ lineId: "l3" })] })
]);
check("C: 2+ active appointments is repeat-in-period", repeat.repeatInPeriodClientCount === 1 && repeat.repeatInPeriodClientShare === 50);

const cancelled = behaviorApi.buildClientBehavior([
  appt({ appointmentId: "live", clientId: "c1", serviceLines: [line()] }),
  appt({ appointmentId: "cx", clientId: "c1", status: "cancelled", serviceLines: [line({ lineId: "cx" })] })
]);
check("D: cancelled appointment does not create repeat behavior", cancelled.identifiedAppointmentCount === 1 && cancelled.repeatInPeriodClientCount === 0);

check("E: repeat appointment share is 2 / 3", repeat.repeatInPeriodAppointmentCount === 2 && repeat.identifiedAppointmentCount === 3 && repeat.repeatInPeriodAppointmentShare === 66.7);

const freq = behaviorApi.buildClientBehavior([
  appt({ appointmentId: "one", clientId: "c1", serviceLines: [line()] }),
  appt({ appointmentId: "t1", clientId: "c2", serviceLines: [line({ lineId: "a" })] }),
  appt({ appointmentId: "t2", clientId: "c2", dateKey: "2026-09-11", serviceLines: [line({ lineId: "b" })] }),
  appt({ appointmentId: "th1", clientId: "c3", serviceLines: [line({ lineId: "c" })] }),
  appt({ appointmentId: "th2", clientId: "c3", dateKey: "2026-09-11", serviceLines: [line({ lineId: "d" })] }),
  appt({ appointmentId: "th3", clientId: "c3", dateKey: "2026-09-12", serviceLines: [line({ lineId: "e" })] }),
  appt({ appointmentId: "f1", clientId: "c4", serviceLines: [line({ lineId: "f" })] }),
  appt({ appointmentId: "f2", clientId: "c4", dateKey: "2026-09-11", serviceLines: [line({ lineId: "g" })] }),
  appt({ appointmentId: "f3", clientId: "c4", dateKey: "2026-09-12", serviceLines: [line({ lineId: "h" })] }),
  appt({ appointmentId: "f4", clientId: "c4", dateKey: "2026-09-13", serviceLines: [line({ lineId: "i" })] })
]);
check("F: frequency buckets are 1 / 2 / 3 / 4+", freq.frequency[0].clientCount === 1 && freq.frequency[1].clientCount === 1 && freq.frequency[2].clientCount === 1 && freq.frequency[3].clientCount === 1);
check("F: frequency shares use unique identified clients", freq.frequency[0].sharePercent === 25 && freq.frequency[3].label === "4+ appointments");

const missing = behaviorApi.buildClientBehavior([
  appt({ appointmentId: "u1", clientId: "", serviceLines: [line()] }),
  appt({ appointmentId: "u2", clientId: "   ", serviceLines: [line({ lineId: "l2" })] }),
  appt({ appointmentId: "known", clientId: "c1", serviceLines: [line({ lineId: "l3" })] })
]);
check("G: missing clientId does not merge unidentified visits", missing.unidentifiedClientAppointmentCount === 2 && missing.identifiedClientCount === 1 && missing.repeatInPeriodClientCount === 0);

const multi = behaviorApi.buildClientBehavior([
  appt({
    serviceLines: [
      line({ lineId: "g", serviceId: "gel", serviceNameSnapshot: "Gel Manicure" }),
      line({ lineId: "p", serviceId: "pedi", serviceNameSnapshot: "Pedicure" })
    ]
  })
]);
check("H: distinct services in one appointment count once each", multi.averageDistinctServicesPerClient === 2 && multi.multiServiceClientCount === 1 && multi.multiServiceClientShare === 100);

const sameService = behaviorApi.buildClientBehavior([
  appt({
    serviceLines: [
      line({ lineId: "a", serviceId: "gel", serviceNameSnapshot: "Gel" }),
      line({ lineId: "b", serviceId: "gel", serviceNameSnapshot: "Gel Manicure" })
    ]
  })
]);
check("I: same serviceId does not inflate distinct service count", sameService.averageDistinctServicesPerClient === 1 && sameService.multiServiceClientCount === 0);

const requested = behaviorApi.buildClientBehavior([
  appt({
    serviceLines: [
      line({ lineId: "a", requested: true, providerId: "maria" }),
      line({ lineId: "b", requested: false, providerId: "anna" }),
      line({ lineId: "c", requested: true, providerId: "" })
    ]
  })
]);
check("J: requested-provider share uses provider-assigned lines only", requested.providerAssignedLineCount === 2 && requested.requestedLineCount === 1 && requested.requestedProviderShare === 50);

const consistent = behaviorApi.buildClientBehavior([
  appt({
    appointmentId: "a1",
    serviceLines: [
      line({ lineId: "a", requested: true, providerId: "maria" }),
      line({ lineId: "b", requested: true, providerId: "maria" })
    ]
  })
]);
check("K: multiple requested lines to the same provider are consistent", consistent.eligibleRequestedClientCount === 1 && consistent.consistentRequestedClientCount === 1 && consistent.consistentRequestedShare === 100);

const mixedReq = behaviorApi.buildClientBehavior([
  appt({
    serviceLines: [
      line({ lineId: "a", requested: true, providerId: "maria" }),
      line({ lineId: "b", requested: true, providerId: "anna" })
    ]
  })
]);
check("L: different requested providers are not consistent", mixedReq.eligibleRequestedClientCount === 1 && mixedReq.consistentRequestedClientCount === 0);

const missingProv = behaviorApi.buildClientBehavior([
  appt({
    serviceLines: [
      line({ lineId: "a", requested: true, providerId: "maria" }),
      line({ lineId: "b", requested: true, providerId: "" })
    ]
  })
]);
check("M: missing providerId does not create false consistency", missingProv.eligibleRequestedClientCount === 1 && missingProv.consistentRequestedClientCount === 0);

const oneDay = report([
  appt({ appointmentId: "a1", clientId: "c1", firstVisit: true, serviceLines: [line()] }),
  appt({ appointmentId: "a2", clientId: "c1", serviceLines: [line({ lineId: "l2", startMin: 720, endMin: 780 })] })
]);
check("N: one-day report still computes in-period repeat metrics", oneDay.clientBehavior.repeatInPeriodClientCount === 1 && oneDay.clientBehavior.averageDaysBetweenVisits === 0);
check("N: one-day insights do not use retention or rebooking language", oneDay.insights.every(function (line) {
  var text = line.toLowerCase();
  return text.indexOf("retention") === -1
    && text.indexOf("rebooking") === -1
    && text.indexOf("loyal") === -1
    && text.indexOf("churn") === -1
    && text.indexOf("lifetime") === -1;
}));

const tiny = behaviorApi.buildClientBehavior([
  appt({ appointmentId: "a1", clientId: "c1", firstVisit: true, serviceLines: [line({ requested: true })] }),
  appt({ appointmentId: "a2", clientId: "c1", dateKey: "2026-09-12", serviceLines: [line({ lineId: "l2", requested: true })] }),
  appt({ appointmentId: "b1", clientId: "c2", serviceLines: [line({ lineId: "l3", serviceId: "pedi", serviceNameSnapshot: "Pedicure" })] })
]);
const tinyReport = { clientBehavior: tiny, insights: [] };
behaviorApi.appendInsights(tinyReport.insights, tinyReport, "in this period");
check("O: small unique-client samples do not get repeat or multi-service insights", tinyReport.insights.every(function (line) {
  return line.indexOf("had multiple appointments") === -1 && line.indexOf("more than one service type") === -1;
}));
check("O: small requested-line samples do not get requested-provider narrative", tinyReport.insights.every(function (line) {
  return line.indexOf("requested-provider bookings") === -1 && line.indexOf("consistently requested") === -1;
}));

const spaced = behaviorApi.buildClientBehavior([
  appt({ appointmentId: "d1", clientId: "c1", dateKey: "2026-09-07", serviceLines: [line({ startMin: 600 })] }),
  appt({ appointmentId: "d2", clientId: "c1", dateKey: "2026-09-10", serviceLines: [line({ lineId: "l2", startMin: 720 })] }),
  appt({ appointmentId: "d3", clientId: "c1", dateKey: "2026-09-14", serviceLines: [line({ lineId: "l3", startMin: 600 })] }),
  appt({ appointmentId: "same-a", clientId: "c2", dateKey: "2026-09-10", serviceLines: [line({ lineId: "s1", startMin: 600 })] }),
  appt({ appointmentId: "same-b", clientId: "c2", dateKey: "2026-09-10", serviceLines: [line({ lineId: "s2", startMin: 780 })] })
]);
check("P: chronological visit spacing is 3 then 4 days", spaced.averageDaysBetweenVisits === 2.3 && spaced.medianDaysBetweenVisits === 3);
check("P: same-day appointments create a 0-day interval", behaviorApi.visitIntervals([
  appt({ appointmentId: "a", dateKey: "2026-09-10", serviceLines: [line({ startMin: 600 })] }),
  appt({ appointmentId: "b", dateKey: "2026-09-10", serviceLines: [line({ lineId: "x", startMin: 780 })] })
]).join(",") === "0");

const mostUsed = behaviorApi.buildClientBehavior([
  appt({
    serviceLines: [
      line({ lineId: "a", providerId: "maria" }),
      line({ lineId: "b", providerId: "maria" }),
      line({ lineId: "c", providerId: "anna" })
    ]
  })
]);
check("most-used provider share is 2 of 3 assigned lines", mostUsed.averageMostUsedProviderShare === 66.7);

const src = fs.readFileSync(path.join(root, "public/booking/reports/client-behavior.js"), "utf8");
const uiSrc = fs.readFileSync(path.join(root, "public/booking/reports/intelligence.js"), "utf8");
check("module documents first-visit vs returning once", src.indexOf("firstVisit on any in-range booked appointment") !== -1 && src.indexOf("A client is never both") !== -1);
check("module does not call getClientAppointments", src.indexOf("getClientAppointments") === -1 && src.indexOf("getFirestore") === -1);
check("ui keeps client behavior aggregate-only", uiSrc.indexOf("clientSnapshot") === -1 || uiSrc.indexOf("Client behavior") !== -1);
check("ui does not render client PII in the behavior section", uiSrc.indexOf("phone numbers") === -1);

if (failed) process.exit(1);
console.log("All Booking client behavior checks passed.");
