/**
 * Client Retention. Cohort return after completed visits. No Firestore.
 *
 * Qualifying visit = status === "completed" (checked out).
 * Does not qualify: scheduled, confirmed, checked_in, in_service,
 * cancelled, no_show. Booked or mid-visit rows are not completed visits.
 *
 * Usage: node scripts/test-booking-reports-client-retention.js
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
load("public/booking/reports/appointment-range.js", windowObj);
load("public/booking/reports/client-retention-compute.js", windowObj);
const api = windowObj.ffBookingReportsClientRetentionCompute;
const range = windowObj.ffBookingReportsAppointmentRange || windowObj.ffBookingReportsSalesRange;
const src = read("public/booking/reports/client-retention-compute.js");
const ui = read("public/booking/reports/client-retention.js");

function visit(partial) {
  return Object.assign({
    appointmentId: "a1",
    clientId: "c1",
    clientSnapshot: { displayName: "Ada", phone: "555-0100" },
    locationId: "nyc",
    status: "completed",
    dateKey: "2026-01-05",
    startAt: new Date("2026-01-05T15:00:00.000Z"),
    firstVisit: true
  }, partial);
}

function closedOpts(partial) {
  return Object.assign({
    fromKey: "2026-01-01",
    toKey: "2026-01-31",
    locationIds: ["nyc"],
    asOfKey: "2026-12-01"
  }, partial || {});
}

function windowsOf(summary) {
  return (summary.totals && summary.totals.windows) || {};
}

function retained(summary, days) {
  const row = windowsOf(summary)[days];
  return !!(row && row.eligible === 1 && row.returned === 1 && row.rate === 100);
}

function notRetained(summary, days) {
  const row = windowsOf(summary)[days];
  return !!(row && row.eligible === 1 && row.returned === 0 && row.rate === 0);
}

check("qualifying status is completed only", api.QUALIFYING_STATUS === "completed");
check("completed qualifies", api.isQualifyingVisit(visit()) === true);
["scheduled", "confirmed", "checked_in", "in_service", "cancelled", "no_show"].forEach(function (status) {
  check(status + " does not qualify as a visit", api.isQualifyingVisit(visit({ status: status })) === false);
});

const threeVisits = api.summarizeRetention([
  visit({ appointmentId: "v1", dateKey: "2026-01-05" }),
  visit({ appointmentId: "v2", dateKey: "2026-01-12", startAt: new Date("2026-01-12T15:00:00.000Z") }),
  visit({ appointmentId: "v3", dateKey: "2026-01-20", startAt: new Date("2026-01-20T15:00:00.000Z") })
], closedOpts());
check("A: one client is one cohort member", threeVisits.totals.cohortClients === 1);

const laterAnchor = api.summarizeRetention([
  visit({ appointmentId: "later", dateKey: "2026-01-20", startAt: new Date("2026-01-20T16:00:00.000Z") }),
  visit({ appointmentId: "first", dateKey: "2026-01-05", startAt: new Date("2026-01-05T15:00:00.000Z") }),
  visit({ appointmentId: "mid", dateKey: "2026-01-20", startAt: new Date("2026-01-20T14:00:00.000Z") })
], closedOpts());
check("B: first qualifying cohort visit is the anchor", laterAnchor.totals.medianDaysToFirstReturn === 15);

const sameDay = api.summarizeRetention([
  visit({ appointmentId: "am", dateKey: "2026-01-05", startAt: new Date("2026-01-05T14:00:00.000Z") }),
  visit({ appointmentId: "pm", dateKey: "2026-01-05", startAt: new Date("2026-01-05T18:00:00.000Z") })
], closedOpts());
check("C: same-day second visit is not a return", sameDay.totals.returnedClients === 0 && sameDay.totals.medianDaysToFirstReturn == null && notRetained(sameDay, 30));

const d20 = api.summarizeRetention([
  visit({ appointmentId: "a", dateKey: "2026-01-05" }),
  visit({ appointmentId: "b", dateKey: "2026-01-25", startAt: new Date("2026-01-25T15:00:00.000Z") })
], closedOpts());
check("D: 20-day return counts 30/60/90/180", retained(d20, 30) && retained(d20, 60) && retained(d20, 90) && retained(d20, 180));

const d45 = api.summarizeRetention([
  visit({ appointmentId: "a", dateKey: "2026-01-05" }),
  visit({ appointmentId: "b", dateKey: "2026-02-19", startAt: new Date("2026-02-19T15:00:00.000Z") })
], closedOpts());
check("E: 45-day return skips 30 and counts 60/90/180", notRetained(d45, 30) && retained(d45, 60) && retained(d45, 90) && retained(d45, 180));

const d70 = api.summarizeRetention([
  visit({ appointmentId: "a", dateKey: "2026-01-05" }),
  visit({ appointmentId: "b", dateKey: "2026-03-16", startAt: new Date("2026-03-16T15:00:00.000Z") })
], closedOpts());
check("F: 70-day return counts 90/180 only", notRetained(d70, 30) && notRetained(d70, 60) && retained(d70, 90) && retained(d70, 180));

const d120 = api.summarizeRetention([
  visit({ appointmentId: "a", dateKey: "2026-01-05" }),
  visit({ appointmentId: "b", dateKey: "2026-05-05", startAt: new Date("2026-05-05T15:00:00.000Z") })
], closedOpts());
check("G: 120-day return counts 180 only", notRetained(d120, 30) && notRetained(d120, 60) && notRetained(d120, 90) && retained(d120, 180));

const d200 = api.summarizeRetention([
  visit({ appointmentId: "a", dateKey: "2026-01-05" }),
  visit({ appointmentId: "b", dateKey: "2026-07-24", startAt: new Date("2026-07-24T15:00:00.000Z") })
], closedOpts());
check("H: >180-day return does not count any window", notRetained(d200, 30) && notRetained(d200, 60) && notRetained(d200, 90) && notRetained(d200, 180));

const cancelledReturn = api.summarizeRetention([
  visit({ appointmentId: "a", dateKey: "2026-01-05" }),
  visit({ appointmentId: "b", dateKey: "2026-01-25", status: "cancelled", startAt: new Date("2026-01-25T15:00:00.000Z") })
], closedOpts());
check("I: cancelled appointment is not a qualifying return", cancelledReturn.totals.returnedClients === 0 && notRetained(cancelledReturn, 30));

const futureBooked = api.summarizeRetention([
  visit({ appointmentId: "a", dateKey: "2026-01-05" }),
  visit({
    appointmentId: "b",
    dateKey: "2026-12-15",
    status: "scheduled",
    startAt: new Date("2026-12-15T15:00:00.000Z")
  })
], closedOpts({ asOfKey: "2026-12-01" }));
check("J: future scheduled appointment is not a return", futureBooked.totals.returnedClients === 0 && notRetained(futureBooked, 180));

const futureCompleted = api.summarizeRetention([
  visit({ appointmentId: "a", dateKey: "2026-01-05" }),
  visit({
    appointmentId: "b",
    dateKey: "2026-12-10",
    startAt: new Date("2026-12-10T15:00:00.000Z")
  })
], closedOpts({ asOfKey: "2026-12-01" }));
check("J: future completed date after as-of is not a return yet", futureCompleted.totals.returnedClients === 0);

const manyLater = api.summarizeRetention([
  visit({ appointmentId: "a", dateKey: "2026-01-05" }),
  visit({ appointmentId: "b", dateKey: "2026-01-25", startAt: new Date("2026-01-25T15:00:00.000Z") }),
  visit({ appointmentId: "c", dateKey: "2026-02-10", startAt: new Date("2026-02-10T15:00:00.000Z") }),
  visit({ appointmentId: "d", dateKey: "2026-03-01", startAt: new Date("2026-03-01T15:00:00.000Z") })
], closedOpts());
check("K: multiple later visits count the client once", manyLater.totals.cohortClients === 1 && manyLater.totals.returnedClients === 1 && windowsOf(manyLater)[30].returned === 1);

const mixedWindow = api.summarizeRetention([
  visit({ appointmentId: "closed", clientId: "old", dateKey: "2026-01-05" }),
  visit({ appointmentId: "open", clientId: "new", dateKey: "2026-01-20", startAt: new Date("2026-01-20T15:00:00.000Z") })
], closedOpts({ asOfKey: "2026-02-10" }));
check("L: 30-day denominator includes only closed windows", windowsOf(mixedWindow)[30].eligible === 1 && windowsOf(mixedWindow)[30].open === 1 && mixedWindow.totals.cohortClients === 2);
check("M: open 30-day window is excluded from the denominator", windowsOf(mixedWindow)[30].eligible === 1 && windowsOf(mixedWindow)[30].returned === 0 && windowsOf(mixedWindow)[30].rate === 0);

const open180 = api.summarizeRetention([
  visit({ appointmentId: "a", dateKey: "2026-01-05" })
], closedOpts({ asOfKey: "2026-06-20" }));
check("N: open 180-day window is excluded from the denominator", windowsOf(open180)[180].eligible === 0 && windowsOf(open180)[180].open === 1 && windowsOf(open180)[90].eligible === 1);

const noReturn = api.summarizeRetention([
  visit({ appointmentId: "a", dateKey: "2026-01-05" })
], closedOpts());
check("O: eligible clients with no return produce 0%", noReturn.totals.cohortClients === 1 && windowsOf(noReturn)[30].eligible === 1 && windowsOf(noReturn)[30].rate === 0);

const tooNew = api.summarizeRetention([
  visit({ appointmentId: "a", dateKey: "2026-01-20", startAt: new Date("2026-01-20T15:00:00.000Z") })
], closedOpts({ asOfKey: "2026-02-10" }));
check("P: no eligible closed window is null, not 0%", tooNew.totals.cohortClients === 1 && windowsOf(tooNew)[30].eligible === 0 && windowsOf(tooNew)[30].rate == null);

const missingId = api.summarizeRetention([
  visit({ appointmentId: "anon", clientId: "", clientSnapshot: { displayName: "Walk-in", phone: "555-0199" } }),
  visit({ appointmentId: "known", clientId: "c9", dateKey: "2026-01-06", startAt: new Date("2026-01-06T15:00:00.000Z") })
], closedOpts());
check("Q: missing clientId is excluded from the cohort", missingId.totals.cohortClients === 1 && missingId.totals.unidentifiedVisits === 1);

const sameName = api.summarizeRetention([
  visit({ appointmentId: "n1", clientId: "ada-1", clientSnapshot: { displayName: "Ada", phone: "555-0100" } }),
  visit({ appointmentId: "n2", clientId: "ada-2", clientSnapshot: { displayName: "Ada", phone: "555-0100" }, dateKey: "2026-01-06", startAt: new Date("2026-01-06T15:00:00.000Z") }),
  visit({ appointmentId: "n3", clientId: "", clientSnapshot: { displayName: "Ada", phone: "555-0100" }, dateKey: "2026-01-07", startAt: new Date("2026-01-07T15:00:00.000Z") })
], closedOpts());
check("R: name/phone are not used to invent identity", sameName.totals.cohortClients === 2 && sameName.totals.unidentifiedVisits === 1);
check("R: compute has no name or phone matching", src.indexOf("displayName") === -1 && src.indexOf("phone") === -1);

const scoped = api.summarizeRetention([
  visit({ appointmentId: "nyc1", locationId: "nyc" }),
  visit({ appointmentId: "la1", clientId: "c2", locationId: "la" })
], closedOpts({ locationIds: ["nyc"] }));
check("S: unselected locations stay out of the selected scope", scoped.totals.cohortClients === 1 && scoped.locations.length === 1 && scoped.locations[0].locationId === "nyc");

const returnOtherLoc = api.summarizeRetention([
  visit({ appointmentId: "anchor", locationId: "nyc" }),
  visit({ appointmentId: "back", locationId: "la", dateKey: "2026-01-25", startAt: new Date("2026-01-25T15:00:00.000Z") })
], closedOpts({ locationIds: ["nyc", "la"] }));
check("T: return at another selected location counts", returnOtherLoc.totals.returnedClients === 1 && retained(returnOtherLoc, 30) && returnOtherLoc.locations[0].cohortClients === 1);

const returnUnselected = api.summarizeRetention([
  visit({ appointmentId: "anchor", locationId: "nyc" }),
  visit({ appointmentId: "other", locationId: "la", dateKey: "2026-01-25", startAt: new Date("2026-01-25T15:00:00.000Z") })
], closedOpts({ locationIds: ["nyc"] }));
check("U: return at an unselected location does not count", returnUnselected.totals.returnedClients === 0 && notRetained(returnUnselected, 30));

const timing = api.summarizeRetention([
  visit({ appointmentId: "a1", clientId: "p1", dateKey: "2026-01-01", startAt: new Date("2026-01-01T15:00:00.000Z") }),
  visit({ appointmentId: "a2", clientId: "p1", dateKey: "2026-01-11", startAt: new Date("2026-01-11T15:00:00.000Z") }),
  visit({ appointmentId: "b1", clientId: "p2", dateKey: "2026-01-01", startAt: new Date("2026-01-01T16:00:00.000Z") }),
  visit({ appointmentId: "b2", clientId: "p2", dateKey: "2026-01-21", startAt: new Date("2026-01-21T15:00:00.000Z") }),
  visit({ appointmentId: "c1", clientId: "p3", dateKey: "2026-01-01", startAt: new Date("2026-01-01T17:00:00.000Z") }),
  visit({ appointmentId: "c2", clientId: "p3", dateKey: "2026-01-31", startAt: new Date("2026-01-31T15:00:00.000Z") })
], closedOpts());
check("V: median days to first return", timing.totals.medianDaysToFirstReturn === 20);
check("W: average days to first return", timing.totals.averageDaysToFirstReturn === 20);

check("X: incomplete retrieval suppresses metrics", ui.indexOf('status === "incomplete"') !== -1 && ui.indexOf("ff-rpt-warn") !== -1 && ui.indexOf("Appointment data for this range is incomplete") !== -1 && ui.indexOf("Narrow the cohort range") !== -1);
check("Y: retrieval error is not treated as empty", ui.indexOf("This report could not load.") !== -1 && ui.indexOf('kind === "error"') !== -1);
check("Z: stale request cannot paint", range.shouldPaintReportResult(1, 2, true) === false && range.shouldStoreReportResult(1, 2) === false);
check("Z: inactive report cannot paint", range.shouldPaintReportResult(2, 2, false) === false);
check("Z: ui isolates generate", ui.indexOf("shouldPaintReportResult") !== -1 && ui.indexOf("loadGen") !== -1 && ui.indexOf("isActive") !== -1);

const empty = api.summarizeRetention([], closedOpts());
const emptyView = api.ownerView(empty);
check("empty cohort copy is specific", emptyView.kind === "empty" && emptyView.message === api.EMPTY_COHORT);
check("empty closed rates stay null", windowsOf(empty)[30].rate == null && windowsOf(empty)[180].rate == null);

const immatureView = api.ownerView(tooNew);
check("immature cohort keeps size and maturity note", tooNew.totals.cohortClients === 1 && immatureView.kind === "ok" && immatureView.message === api.MATURITY_NOTE);

check("look-forward caps at as-of", api.lookForwardToKey("2026-01-31", { asOfKey: "2026-03-01" }, ["nyc"]) === "2026-03-01");
check("look-forward reaches cohort end plus 180", api.lookForwardToKey("2026-01-31", { asOfKey: "2026-12-01" }, ["nyc"]) === "2026-07-30");

check("ui uses range-complete loader", ui.indexOf("fetchForReport") !== -1 && ui.indexOf("lookForwardToKey") !== -1 && ui.indexOf("getAppointmentsForDate") === -1);
check("no per-client appointment reads", src.indexOf("getClientAppointments") === -1 && ui.indexOf("getClientAppointments") === -1);
check("no sales data for retention", src.indexOf("fetchSales") === -1 && ui.indexOf("ffBookingReportsSalesRange.fetchForReport") === -1 && src.indexOf("getClientAppointments") === -1);
check("no new-vs-existing split", src.indexOf("New Client") === -1 && ui.indexOf("New Client") === -1 && src.indexOf("firstVisit") === -1);
check("no churn or lost-client language", ui.indexOf("churn") === -1 && ui.indexOf("lost client") === -1 && ui.indexOf("unretained") === -1 && src.indexOf("churn") === -1);
check("no provider ranking", ui.indexOf("By provider") === -1 && src.indexOf("providerId") === -1);
check("presets are salon-local cohort ranges", api.rangeForPreset("last_30", "2026-09-14").fromKey === "2026-08-16" && api.rangeForPreset("last_90", "2026-09-14").fromKey === "2026-06-17");
check("previous month is a closed civil month", api.rangeForPreset("previous_month", "2026-09-14").fromKey === "2026-08-01" && api.rangeForPreset("previous_month", "2026-09-14").toKey === "2026-08-31");
check("default last 90 is not a forward outlook preset", api.datePresets("2026-09-14").every(function (row) {
  return row.value !== "next_7" && row.value !== "next_14" && row.value !== "next_30";
}));

const twoMonths = api.summarizeRetention([
  visit({ appointmentId: "jan", clientId: "m1", dateKey: "2026-01-05" }),
  visit({ appointmentId: "feb", clientId: "m2", dateKey: "2026-02-05", startAt: new Date("2026-02-05T15:00:00.000Z") })
], closedOpts({ fromKey: "2026-01-01", toKey: "2026-02-28" }));
check("month buckets appear when the cohort spans months", twoMonths.months.length === 2 && twoMonths.months[0].monthKey === "2026-01");

const oneMonth = api.summarizeRetention([
  visit({ appointmentId: "jan", dateKey: "2026-01-05" })
], closedOpts());
check("single-month cohort skips a month table", oneMonth.months.length === 0);

const tinyInsight = api.summarizeRetention([
  visit({ appointmentId: "a", dateKey: "2026-01-05" }),
  visit({ appointmentId: "b", dateKey: "2026-01-25", startAt: new Date("2026-01-25T15:00:00.000Z") })
], closedOpts());
check("small samples do not get a comparative rate insight", tinyInsight.insights.every(function (line) {
  return line.indexOf("60 days") === -1 && line.indexOf("90-day retention rate") === -1;
}));

if (failed) process.exit(1);
console.log("All Booking client retention checks passed.");
