/**
 * Cancellations report. Appointment-date range. No Firestore.
 * Usage: node scripts/test-booking-reports-cancellations.js
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
      nyc: { salonTimeZone: "America/New_York" },
      la: { salonTimeZone: "America/Los_Angeles" }
    },
    preferences: { salonTimeZone: "America/New_York" }
  }
};
load("public/booking/calendar-time.js", windowObj);
load("public/booking/appointments/model.js", windowObj);
load("public/booking/reports/compute.js", windowObj);
load("public/booking/reports/sales-range.js", windowObj);
load("public/booking/reports/cancellations-compute.js", windowObj);
const api = windowObj.ffBookingReportsCancellationsCompute;
const range = windowObj.ffBookingReportsSalesRange;

function line(partial) {
  return Object.assign({
    lineId: "l1",
    serviceId: "gel",
    serviceNameSnapshot: "Gel Manicure",
    providerId: "maria",
    providerNameSnapshot: "Maria",
    startAt: new Date("2026-09-10T15:00:00.000Z"),
    endAt: new Date("2026-09-10T16:00:00.000Z"),
    durationMinutes: 60
  }, partial);
}

function appt(partial) {
  return Object.assign({
    appointmentId: "a1",
    clientId: "c1",
    clientSnapshot: { displayName: "Ada" },
    locationId: "nyc",
    status: "cancelled",
    dateKey: "2026-09-10",
    startAt: new Date("2026-09-10T15:00:00.000Z"),
    endAt: new Date("2026-09-10T16:00:00.000Z"),
    cancelledAt: new Date("2026-09-10T14:00:00.000Z"),
    cancellationReason: "",
    serviceLines: [line()]
  }, partial);
}

const opts = { fromKey: "2026-09-10", toKey: "2026-09-10", locationIds: ["nyc"] };
const week = { fromKey: "2026-09-07", toKey: "2026-09-13", locationIds: ["nyc"] };

const mixed = api.summarizeCancellations([
  appt({ appointmentId: "cxl1" }),
  appt({ appointmentId: "cxl2", clientId: "c2", serviceLines: [line({ durationMinutes: 30, startAt: new Date("2026-09-10T17:00:00.000Z"), endAt: new Date("2026-09-10T17:30:00.000Z") })] }),
  appt({ appointmentId: "ok1", status: "completed", cancelledAt: null }),
  appt({ appointmentId: "ok2", status: "scheduled", cancelledAt: null, clientId: "c3" }),
  appt({ appointmentId: "ok3", status: "no_show", cancelledAt: null, clientId: "c4" })
], opts);
check("A: cancelled appointment count", mixed.totals.cancelled === 2 && mixed.rows.length === 2);
check("B: cancellation rate denominator is all scheduled appointments", mixed.totals.scheduled === 5 && mixed.totals.rate === 40);
check("C: non-cancelled stay out of rows but stay in the denominator", mixed.rows.every(function (row) { return row.appointmentId.indexOf("cxl") === 0; }) && mixed.totals.scheduled === 5);

check("D: cancelled provider hours use the line window", mixed.totals.hours === 1.5 && mixed.totals.minutes === 90);

const multiService = api.summarizeCancellations([
  appt({
    serviceLines: [
      line({ lineId: "a", serviceId: "gel", serviceNameSnapshot: "Gel Manicure", startAt: new Date("2026-09-10T15:00:00.000Z"), endAt: new Date("2026-09-10T15:30:00.000Z"), durationMinutes: 30 }),
      line({ lineId: "b", serviceId: "cut", serviceNameSnapshot: "Cut", startAt: new Date("2026-09-10T15:30:00.000Z"), endAt: new Date("2026-09-10T16:00:00.000Z"), durationMinutes: 30 })
    ]
  })
], opts);
check("E: multi-service appointment keeps both services", multiService.services.length === 2 && multiService.totals.minutes === 60);

const multiProvider = api.summarizeCancellations([
  appt({
    serviceLines: [
      line({ lineId: "m", providerId: "maria", providerNameSnapshot: "Maria", startAt: new Date("2026-09-10T15:00:00.000Z"), endAt: new Date("2026-09-10T15:30:00.000Z"), durationMinutes: 30 }),
      line({ lineId: "n", providerId: "anna", providerNameSnapshot: "Anna", serviceId: "cut", serviceNameSnapshot: "Cut", startAt: new Date("2026-09-10T15:00:00.000Z"), endAt: new Date("2026-09-10T15:30:00.000Z"), durationMinutes: 30 })
    ]
  })
], opts);
check("F: multi-provider appointment splits time", multiProvider.providers.length === 2 && multiProvider.providers[0].minutes === 30 && multiProvider.providers[1].minutes === 30 && multiProvider.totals.minutes === 60);

const overlap = api.providerMinutesFromLines([
  line({ startAt: new Date("2026-09-10T15:00:00.000Z"), endAt: new Date("2026-09-10T16:00:00.000Z"), durationMinutes: 60 }),
  line({ lineId: "l2", startAt: new Date("2026-09-10T15:30:00.000Z"), endAt: new Date("2026-09-10T16:30:00.000Z"), durationMinutes: 60 })
]);
check("G: same-provider overlapping windows are unioned", overlap.maria.minutes === 90);

const notices = api.summarizeCancellations([
  appt({ appointmentId: "n1", cancelledAt: new Date("2026-09-10T13:00:00.000Z") }),
  appt({ appointmentId: "n2", clientId: "c2", cancelledAt: new Date("2026-09-10T14:00:00.000Z") }),
  appt({ appointmentId: "n3", clientId: "c3", cancelledAt: new Date("2026-09-10T12:00:00.000Z") })
], opts);
check("H: average notice uses startAt minus cancelledAt", notices.totals.averageNoticeMinutes === 120);
check("I: median notice is the middle sample", notices.totals.medianNoticeMinutes === 120);

const missingCancelAt = api.summarizeCancellations([
  appt({ cancelledAt: null }),
  appt({ appointmentId: "n2", clientId: "c2", cancelledAt: new Date("2026-09-10T14:00:00.000Z") })
], opts);
check("J: missing cancelledAt is excluded from notice statistics", missingCancelAt.totals.noticeSample === 1 && missingCancelAt.totals.averageNoticeMinutes === 60 && missingCancelAt.rows[0].noticeMinutes == null);

check("K: cancellation within 24h uses the 24-hour window", notices.totals.within24h === 3);

const sameDay = api.summarizeCancellations([
  appt({ cancelledAt: new Date("2026-09-10T14:00:00.000Z") }),
  appt({ appointmentId: "prev", clientId: "c2", cancelledAt: new Date("2026-09-09T22:00:00.000Z") })
], opts);
check("L: same-day uses salon-local civil dates", sameDay.totals.sameDay === 1 && sameDay.rows.filter(function (row) { return row.sameDay; }).length === 1);

check("M: provider breakdown uses explicit providerId", mixed.providers.length === 1 && mixed.providers[0].providerId === "maria" && mixed.providers[0].lineCount === 2);

check("N: service breakdown groups by serviceId", multiService.services[0].serviceId === "cut" || multiService.services[0].serviceId === "gel");
check("N: service hours add to cancelled booked time", multiService.services.reduce(function (sum, row) { return sum + row.minutes; }, 0) === 60);

const noProvider = api.summarizeCancellations([
  appt({ serviceLines: [line({ providerId: "", providerNameSnapshot: "" })] })
], opts);
check("O: missing providerId does not invent attribution", noProvider.providers.length === 0 && noProvider.totals.unattributedLines === 1);

const noServiceId = api.summarizeCancellations([
  appt({ serviceLines: [line({ serviceId: "", serviceNameSnapshot: "Add-on" })] })
], opts);
check("P: missing serviceId falls back to snapshot name", noServiceId.services.length === 1 && noServiceId.services[0].name === "Add-on" && noServiceId.services[0].serviceId === "");

const repeats = api.summarizeCancellations([
  appt({ appointmentId: "r1", clientId: "same" }),
  appt({ appointmentId: "r2", clientId: "same", dateKey: "2026-09-11", startAt: new Date("2026-09-11T15:00:00.000Z"), cancelledAt: new Date("2026-09-11T14:00:00.000Z") }),
  appt({ appointmentId: "r3", clientId: "other" })
], week);
check("Q: repeated cancelled client grouping uses clientId", repeats.totals.repeatClients === 1 && repeats.totals.cancelled === 3);

const src = read("public/booking/reports/cancellations-compute.js");
const ui = read("public/booking/reports/cancellations.js");
check("R: compute does not call getClientAppointments", src.indexOf("getClientAppointments") === -1 && ui.indexOf("getClientAppointments") === -1);
check("R: ui does not read Firestore directly", ui.indexOf("getFirestore") === -1 && ui.indexOf("collection(") === -1);

const empty = api.summarizeCancellations([], opts);
check("S: empty range has zero scheduled and cancelled", empty.totals.scheduled === 0 && empty.totals.cancelled === 0 && empty.rows.length === 0);

const noneCancelled = api.summarizeCancellations([
  appt({ status: "completed", cancelledAt: null }),
  appt({ appointmentId: "a2", status: "scheduled", cancelledAt: null })
], opts);
check("T: no cancellations with a valid denominator is 0%", noneCancelled.totals.scheduled === 2 && noneCancelled.totals.cancelled === 0 && noneCancelled.totals.rate === 0);

const allCancelled = api.summarizeCancellations([
  appt({ appointmentId: "x1" }),
  appt({ appointmentId: "x2", clientId: "c2" })
], opts);
check("U: all cancelled appointments are 100%", allCancelled.totals.scheduled === 2 && allCancelled.totals.cancelled === 2 && allCancelled.totals.rate === 100);

const tiny = api.summarizeCancellations([
  appt({ appointmentId: "t1" }),
  appt({ appointmentId: "t2", status: "completed", cancelledAt: null })
], opts);
check("V: tiny scheduled samples do not get a rate insight", tiny.insights.every(function (line) {
  return line.indexOf("% of appointments scheduled") === -1;
}));
check("V: hours insight can still appear when cancellations exist", tiny.insights.some(function (line) {
  return line.indexOf("provider hours") !== -1;
}));

const zoned = api.summarizeCancellations([
  {
    appointmentId: "ny-same",
    clientId: "c1",
    clientSnapshot: { displayName: "Ada" },
    locationId: "nyc",
    status: "cancelled",
    startAt: new Date("2026-09-11T05:00:00.000Z"),
    cancelledAt: new Date("2026-09-11T04:00:00.000Z"),
    serviceLines: [line({ startAt: new Date("2026-09-11T05:00:00.000Z"), endAt: new Date("2026-09-11T06:00:00.000Z") })]
  },
  {
    appointmentId: "la-prev",
    clientId: "c2",
    clientSnapshot: { displayName: "Bea" },
    locationId: "la",
    status: "cancelled",
    startAt: new Date("2026-09-11T05:00:00.000Z"),
    cancelledAt: new Date("2026-09-10T06:00:00.000Z"),
    serviceLines: [line({ providerId: "anna", providerNameSnapshot: "Anna", startAt: new Date("2026-09-11T05:00:00.000Z"), endAt: new Date("2026-09-11T06:00:00.000Z") })]
  }
], { fromKey: "2026-09-10", toKey: "2026-09-11", locationIds: ["nyc", "la"] });
const nyRow = zoned.rows.find(function (row) { return row.appointmentId === "ny-same"; });
const laRow = zoned.rows.find(function (row) { return row.appointmentId === "la-prev"; });
check("W: NY 05:00Z is Sep 11 local and same-day", nyRow && nyRow.dateKey === "2026-09-11" && nyRow.sameDay === true);
check("W: LA 05:00Z is Sep 10 local so cancel at 04:00Z is not same-day", laRow && laRow.dateKey === "2026-09-10" && laRow.sameDay === false);

check("X: stale request cannot paint", range.shouldPaintReportResult(1, 2, true) === false && range.shouldStoreReportResult(1, 2) === false);
check("X: inactive report cannot paint", range.shouldPaintReportResult(2, 2, false) === false);

const later = api.summarizeCancellations([
  appt({ appointmentId: "first", clientId: "keep", dateKey: "2026-09-10" }),
  appt({
    appointmentId: "next",
    clientId: "keep",
    status: "scheduled",
    dateKey: "2026-09-12",
    startAt: new Date("2026-09-12T15:00:00.000Z"),
    cancelledAt: null
  })
], week);
check("later appointment in loaded range is flagged without calling it a rebook", later.rows[0].laterAppointmentInRange === true);
check("ui does not claim rebooked or lost revenue", ui.indexOf("rebooked") === -1 && ui.indexOf("lost revenue") === -1 && ui.indexOf("slot recovered") === -1);

const confirmedKept = api.summarizeCancellations([
  appt({ status: "confirmed", cancelledAt: null })
], opts);
check("confirmed appointments are denominator only", confirmedKept.totals.scheduled === 1 && confirmedKept.totals.cancelled === 0);

check("A: Cancellations uses range-complete loader", ui.indexOf("fetchForReport") !== -1 && ui.indexOf("ffBookingReportsAppointmentRange") !== -1 && ui.indexOf("getAppointmentsForDate") === -1);
check("C: incomplete appointment retrieval suppresses totals", ui.indexOf('status === "incomplete"') !== -1 && ui.indexOf("ff-rpt-warn") !== -1 && ui.indexOf("Appointment data for this range is incomplete") !== -1);
check("D: retrieval error is not treated as empty data", ui.indexOf("This report could not load.") !== -1 && ui.indexOf('kind === "error"') !== -1);

const afterStart = api.summarizeCancellations([
  appt({ appointmentId: "late", cancelledAt: new Date("2026-09-10T16:00:00.000Z") }),
  appt({ appointmentId: "ok", clientId: "c2", cancelledAt: new Date("2026-09-10T14:00:00.000Z") })
], opts);
check("E: negative notice is excluded from advance-notice average", afterStart.totals.averageNoticeMinutes === 60 && afterStart.totals.noticeSample === 1 && afterStart.totals.afterStartCount === 1);
check("F: negative notice is excluded from within 24h", afterStart.totals.within24h === 1 && afterStart.rows.find(function (row) { return row.appointmentId === "late"; }).within24h === false);

const exactDay = api.summarizeCancellations([
  appt({ appointmentId: "edge", cancelledAt: new Date("2026-09-09T15:00:00.000Z") }),
  appt({ appointmentId: "short", clientId: "c2", cancelledAt: new Date("2026-09-10T15:00:00.000Z") })
], opts);
check("G: zero notice counts as within 24h", exactDay.rows.find(function (row) { return row.appointmentId === "short"; }).within24h === true && exactDay.totals.within24h === 1);
check("H: exactly 1440 minutes does not count under within 24h", exactDay.rows.find(function (row) { return row.appointmentId === "edge"; }).noticeMinutes === 1440 && exactDay.rows.find(function (row) { return row.appointmentId === "edge"; }).within24h === false);
check("ui isolates stale generate", ui.indexOf("shouldPaintReportResult") !== -1 && ui.indexOf("loadGen") !== -1 && ui.indexOf("isActive") !== -1);
check("ui does not show phone or email columns", ui.indexOf("phone") === -1 && ui.indexOf("email") === -1);
check("ui does not call no-show a headline KPI", ui.indexOf('kpi("No-show"') === -1);

if (failed) process.exit(1);
console.log("All Booking cancellations checks passed.");
