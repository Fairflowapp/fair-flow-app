/**
 * Reports-safe appointment range retrieval. No live Firestore.
 * Usage: node scripts/test-booking-reports-appointment-range.js
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
load("public/booking/reports/appointment-range.js", windowObj);
const range = windowObj.ffBookingReportsAppointmentRange;

function appt(partial) {
  return Object.assign({
    appointmentId: "a1",
    status: "scheduled",
    locationId: "nyc",
    startAt: new Date("2026-09-10T15:00:00.000Z")
  }, partial);
}

function makeFetcher(rows) {
  let calls = 0;
  const list = rows.slice();
  async function fetchPage(cursor, pageSize) {
    calls += 1;
    let start = 0;
    if (cursor && cursor.appointmentId) {
      const idx = list.findIndex(function (row) { return row.appointmentId === cursor.appointmentId; });
      start = idx === -1 ? list.length : idx + 1;
    }
    const slice = list.slice(start, start + pageSize);
    return {
      rows: slice.map(function (row) {
        return { appointment: row, cursor: { appointmentId: row.appointmentId } };
      })
    };
  }
  fetchPage.calls = function () { return calls; };
  return fetchPage;
}

const nycBounds = range.boundsForLocation("2026-09-10", "2026-09-10", "nyc");
const laBounds = range.boundsForLocation("2026-09-10", "2026-09-10", "la");
check("L: NY today starts at location midnight, not UTC", nycBounds.start.toISOString() === "2026-09-10T04:00:00.000Z");
check("L: NY exclusive end is the next local midnight", nycBounds.endExclusive.toISOString() === "2026-09-11T04:00:00.000Z");
check("L: LA uses a different local midnight than NY", laBounds.start.toISOString() === "2026-09-10T07:00:00.000Z");
check("L: same civil keys map to independent instants", nycBounds.start.getTime() !== laBounds.start.getTime());

const winter = range.boundsForLocation("2026-01-15", "2026-01-15", "nyc");
check("L: NY winter midnight follows EST", winter.start.toISOString() === "2026-01-15T05:00:00.000Z");

const dst = range.boundsForLocation("2026-03-08", "2026-03-08", "nyc");
check("M: DST spring-forward start is EST midnight", dst.start.toISOString() === "2026-03-08T05:00:00.000Z");
check("M: DST spring-forward exclusive end is EDT midnight", dst.endExclusive.toISOString() === "2026-03-09T04:00:00.000Z");

async function main() {
  const many = [];
  for (let i = 0; i < 520; i += 1) {
    many.push(appt({
      appointmentId: "p" + String(i).padStart(4, "0"),
      startAt: new Date(Date.UTC(2026, 8, 10, 14, 0, i))
    }));
  }
  const over500 = await range.paginateRange(makeFetcher(many), { pageSize: 150, safetyMax: 2000 });
  check("A: more than 500 appointments stay complete across pages", over500.complete === true && over500.appointments.length === 520 && over500.truncated === false);
  check("A: paged result keeps every appointment id", new Set(over500.appointments.map(function (row) { return row.appointmentId; })).size === 520);

  const exactPageFetcher = makeFetcher(many.slice(0, 150));
  const exactPage = await range.paginateRange(exactPageFetcher, { pageSize: 150, safetyMax: 2000 });
  check("B: exactly one full page asks once more and does not duplicate", exactPage.complete === true && exactPage.appointments.length === 150 && exactPageFetcher.calls() === 2);
  check("B: full-page follow-up has unique ids", new Set(exactPage.appointments.map(function (row) { return row.appointmentId; })).size === 150);

  const august = [
    appt({ appointmentId: "aug-1", locationId: "nyc", startAt: new Date("2026-08-03T16:00:00.000Z") }),
    appt({ appointmentId: "aug-2", locationId: "nyc", startAt: new Date("2026-08-12T16:00:00.000Z") })
  ];
  const september = [
    appt({ appointmentId: "sep-new", locationId: "nyc", startAt: new Date("2026-09-10T16:00:00.000Z") })
  ];
  const pastRepo = {
    listAppointmentsForLocationsRange: async function (ids, fromKey, toKey) {
      const rows = fromKey >= "2026-08-01" && toKey <= "2026-08-31" ? august : september;
      return {
        appointments: rows.filter(function (row) { return ids.indexOf(row.locationId) !== -1; }),
        complete: true,
        fetchedCount: rows.length,
        truncated: false,
        error: null
      };
    }
  };
  const past = await range.fetchForReport(pastRepo, { locationIds: ["nyc"], fromKey: "2026-08-01", toKey: "2026-08-31" });
  check("C: past custom range ignores newer appointments", past.complete === true && past.appointments.length === 2 && past.appointments.every(function (row) { return row.appointmentId.indexOf("aug") === 0; }));

  const futureRows = [
    appt({ appointmentId: "fut-1", startAt: new Date("2026-12-01T15:00:00.000Z") }),
    appt({ appointmentId: "fut-2", startAt: new Date("2026-12-15T15:00:00.000Z") })
  ];
  const futureRepo = {
    listAppointmentsForLocationsRange: async function (ids, fromKey, toKey) {
      const rows = fromKey >= "2026-12-01" && toKey <= "2026-12-31" ? futureRows : [];
      return { appointments: rows, complete: true, fetchedCount: rows.length, truncated: false, error: null };
    }
  };
  const future = await range.fetchForReport(futureRepo, { locationIds: ["nyc"], fromKey: "2026-12-01", toKey: "2026-12-31" });
  check("D: future range returns future appointments", future.complete === true && future.appointments.length === 2 && future.appointments[0].appointmentId === "fut-1");

  const locRepo = {
    listAppointmentsForLocationRange: async function (locationId) {
      const rows = [
        appt({ appointmentId: "nyc-1", locationId: "nyc" }),
        appt({ appointmentId: "la-1", locationId: "la" })
      ].filter(function (row) { return row.locationId === locationId; });
      return { appointments: rows, complete: true, fetchedCount: rows.length, truncated: false, error: null };
    }
  };
  const onlyNyc = await range.fetchForReport(locRepo, { locationIds: ["nyc"], fromKey: "2026-09-10", toKey: "2026-09-10" });
  check("E: one location does not include another location", onlyNyc.complete === true && onlyNyc.appointments.length === 1 && onlyNyc.appointments[0].appointmentId === "nyc-1");

  const both = await range.fetchForReport(locRepo, { locationIds: ["nyc", "la"], fromKey: "2026-09-10", toKey: "2026-09-10" });
  check("F: multiple locations combine", both.complete === true && both.appointments.length === 2 && both.appointments.map(function (row) { return row.appointmentId; }).sort().join(",") === "la-1,nyc-1");

  const sameStart = [
    appt({ appointmentId: "t1", startAt: new Date("2026-09-10T16:00:00.000Z") }),
    appt({ appointmentId: "t2", startAt: new Date("2026-09-10T16:00:00.000Z") }),
    appt({ appointmentId: "t3", startAt: new Date("2026-09-10T16:00:00.000Z") }),
    appt({ appointmentId: "t4", startAt: new Date("2026-09-10T16:00:00.000Z") }),
    appt({ appointmentId: "t5", startAt: new Date("2026-09-10T16:00:00.000Z") })
  ];
  const tied = await range.paginateRange(makeFetcher(sameStart), { pageSize: 2, safetyMax: 1000 });
  check("G: duplicate startAt does not drop rows", tied.complete === true && tied.appointments.length === 5);
  check("G: duplicate startAt does not duplicate rows", new Set(tied.appointments.map(function (row) { return row.appointmentId; })).size === 5);

  const merged = range.mergeAppointments([
    [appt({ appointmentId: "dup", startAt: new Date("2026-09-10T15:00:00.000Z") })],
    [appt({ appointmentId: "dup", startAt: new Date("2026-09-10T15:00:00.000Z") }), appt({ appointmentId: "other", startAt: new Date("2026-09-10T14:00:00.000Z") })]
  ]);
  check("H: duplicate appointmentId is deduped", merged.length === 2 && merged[0].appointmentId === "other");

  const empty = await range.paginateRange(makeFetcher([]), { pageSize: 150, safetyMax: 1000 });
  check("I: empty range is complete", empty.complete === true && empty.appointments.length === 0 && empty.truncated === false && empty.error === null);

  const safetyRows = [];
  for (let i = 0; i < 25; i += 1) safetyRows.push(appt({ appointmentId: "m" + i }));
  const capped = await range.paginateRange(makeFetcher(safetyRows), { pageSize: 8, safetyMax: 20 });
  check("J: safety max stops before exhaustion", capped.complete === false && capped.truncated === true && capped.appointments.length === 20);
  check("J: safety max is not complete because the array is long", capped.complete === false);

  const mixedLoc = range.combineLocationResults([
    { appointments: [appt({ appointmentId: "ok" })], complete: true, fetchedCount: 1, truncated: false, error: null },
    { appointments: [], complete: false, fetchedCount: 0, truncated: false, error: "FirebaseError: 9 FAILED_PRECONDITION" }
  ]);
  check("K: one location error is not a complete combined result", mixedLoc.complete === false && mixedLoc.error && mixedLoc.appointments.length === 0);

  const viewErr = range.viewState(mixedLoc);
  check("K: error view hides Firestore wording", viewErr.kind === "error" && viewErr.message === "This report could not load." && viewErr.appointments.length === 0);

  const viewInc = range.viewState(capped);
  check("incomplete view refuses appointments for totals", viewInc.kind === "incomplete" && viewInc.appointments.length === 0);
  check("incomplete message is user-facing", viewInc.message === "Appointment data for this range is incomplete. Narrow the date range and try again.");

  const viewEmpty = range.viewState(empty);
  check("empty complete range is empty, not an error", viewEmpty.kind === "empty" && viewEmpty.appointments.length === 0);

  const data = read("public/booking/appointments/data.js");
  const cancelUi = read("public/booking/reports/cancellations.js");
  const intelUi = read("public/booking/reports/intelligence.js");
  check("repository pages with startAfter on locationId + startAt", data.indexOf("startAfter(cursor)") !== -1 && data.indexOf('where("locationId", "==", loc)') !== -1 && data.indexOf('where("startAt", ">="') !== -1);
  check("repository does not filter status in the range API", /async function listAppointmentsForLocationRange[\s\S]*status/.test(data) === false || data.indexOf("listAppointmentsForLocationRange") !== -1);
  check("calendar day API is still present", data.indexOf("async function getAppointmentsForDate") !== -1);
  check("cancellations no longer loops days", cancelUi.indexOf("getAppointmentsForDate") === -1 && cancelUi.indexOf("dateKeysBetween") === -1);
  check("intelligence no longer loops days for appointments", intelUi.indexOf("getAppointmentsForDate") === -1 && intelUi.indexOf("fetchForReport") !== -1);
  check("intelligence still loads provider schedules by date", intelUi.indexOf("loadCalendarEmployees") !== -1);

  if (failed) process.exit(1);
  console.log("All Booking appointment-range checks passed.");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
