/**
 * Reports-safe sales range retrieval. No live Firestore.
 * Usage: node scripts/test-booking-reports-sales-range.js
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
load("public/booking/reports/compute.js", windowObj);
load("public/booking/reports/sales-range.js", windowObj);
const range = windowObj.ffBookingReportsSalesRange;
const compute = windowObj.ffBookingReportsCompute;

function sale(partial) {
  return Object.assign({
    saleId: "s1",
    status: "closed",
    locationId: "nyc",
    closedAt: new Date("2026-09-10T16:00:00.000Z"),
    items: [{ kind: "service", amount: 10 }],
    subtotal: 10,
    tip: 0,
    total: 10
  }, partial);
}

function makeFetcher(rows) {
  let calls = 0;
  const list = rows.slice();
  async function fetchPage(cursor, pageSize) {
    calls += 1;
    let start = 0;
    if (cursor && cursor.saleId) {
      const idx = list.findIndex(function (row) { return row.saleId === cursor.saleId; });
      start = idx === -1 ? list.length : idx + 1;
    }
    const slice = list.slice(start, start + pageSize);
    return {
      rows: slice.map(function (row) {
        return { sale: row, cursor: { saleId: row.saleId } };
      })
    };
  }
  fetchPage.calls = function () { return calls; };
  return fetchPage;
}

const nycBounds = range.boundsForLocation("2026-09-10", "2026-09-10", "nyc");
const laBounds = range.boundsForLocation("2026-09-10", "2026-09-10", "la");
check("NY today starts at location midnight, not UTC", nycBounds.start.toISOString() === "2026-09-10T04:00:00.000Z");
check("NY exclusive end is the next local midnight", nycBounds.endExclusive.toISOString() === "2026-09-11T04:00:00.000Z");
check("LA uses a different local midnight than NY", laBounds.start.toISOString() === "2026-09-10T07:00:00.000Z");
check("bounds do not use the same instant for every location", nycBounds.start.getTime() !== laBounds.start.getTime());

const winter = range.boundsForLocation("2026-01-15", "2026-01-15", "nyc");
check("NY winter midnight follows EST", winter.start.toISOString() === "2026-01-15T05:00:00.000Z");

const inStart = nycBounds.start.getTime();
const inEnd = nycBounds.endExclusive.getTime();
check("sale at range start is included by the query window", inStart >= nycBounds.start.getTime() && inStart < inEnd);
check("sale at exclusive end is outside the query window", nycBounds.endExclusive.getTime() >= inEnd);

const many = [];
for (let i = 0; i < 120; i += 1) {
  many.push(sale({
    saleId: "p" + String(i).padStart(3, "0"),
    closedAt: new Date(Date.UTC(2026, 8, 10, 20, 0, i)),
    total: 10
  }));
}
async function main() {
const over80 = await range.paginateRange(makeFetcher(many), { pageSize: 50, safetyMax: 1000 });
check("more than 80 rows stay complete across pages", over80.complete === true && over80.sales.length === 120 && over80.truncated === false);
check("paged result keeps every sale id", new Set(over80.sales.map(function (row) { return row.saleId; })).size === 120);

const onePageFetcher = makeFetcher(many.slice(0, 40));
const onePage = await range.paginateRange(onePageFetcher, { pageSize: 150, safetyMax: 1000 });
check("one short page stays complete", onePage.complete === true && onePage.sales.length === 40);
check("one short page does not request another page", onePageFetcher.calls() === 1);

const exactPageFetcher = makeFetcher(many.slice(0, 50));
const exactPage = await range.paginateRange(exactPageFetcher, { pageSize: 50, safetyMax: 1000 });
check("a full first page asks once more and does not duplicate", exactPage.complete === true && exactPage.sales.length === 50 && exactPageFetcher.calls() === 2);
check("full-page follow-up has unique ids", new Set(exactPage.sales.map(function (row) { return row.saleId; })).size === 50);

const august = [
  sale({ saleId: "aug-1", locationId: "nyc", dateKey: "2026-08-03", closedAt: new Date("2026-08-03T16:00:00.000Z") }),
  sale({ saleId: "aug-2", locationId: "nyc", dateKey: "2026-08-12", closedAt: new Date("2026-08-12T16:00:00.000Z") })
];
const september = [
  sale({ saleId: "sep-new", locationId: "nyc", dateKey: "2026-09-10", closedAt: new Date("2026-09-10T16:00:00.000Z") })
];
const pastRepo = {
  listForLocationsRange: async function (ids, fromKey, toKey) {
    const rows = fromKey >= "2026-08-01" && toKey <= "2026-08-31" ? august : september;
    return { sales: rows.filter(function (row) { return ids.indexOf(row.locationId) !== -1; }), complete: true, fetchedCount: rows.length, truncated: false, error: null };
  },
  listForSalon: async function () { return september.concat(august); },
  listForLocation: async function () { return september.concat(august); }
};
const past = await range.fetchForReport(pastRepo, { locationIds: ["nyc"], fromKey: "2026-08-01", toKey: "2026-08-31" });
check("past custom range ignores newer sales", past.complete === true && past.sales.length === 2 && past.sales.every(function (row) { return row.saleId.indexOf("aug") === 0; }));

const locRepo = {
  listForLocationRange: async function (locationId) {
    const rows = [
      sale({ saleId: "nyc-1", locationId: "nyc" }),
      sale({ saleId: "la-1", locationId: "la" })
    ].filter(function (row) { return row.locationId === locationId; });
    return { sales: rows, complete: true, fetchedCount: rows.length, truncated: false, error: null };
  }
};
const onlyNyc = await range.fetchForReport(locRepo, { locationIds: ["nyc"], fromKey: "2026-09-10", toKey: "2026-09-10" });
check("one location does not include another location", onlyNyc.complete === true && onlyNyc.sales.length === 1 && onlyNyc.sales[0].saleId === "nyc-1");

const both = await range.fetchForReport(locRepo, { locationIds: ["nyc", "la"], fromKey: "2026-09-10", toKey: "2026-09-10" });
check("multiple locations combine", both.complete === true && both.sales.length === 2 && both.sales.map(function (row) { return row.saleId; }).sort().join(",") === "la-1,nyc-1");

const sameClosed = [
  sale({ saleId: "t1", closedAt: new Date("2026-09-10T16:00:00.000Z") }),
  sale({ saleId: "t2", closedAt: new Date("2026-09-10T16:00:00.000Z") }),
  sale({ saleId: "t3", closedAt: new Date("2026-09-10T16:00:00.000Z") }),
  sale({ saleId: "t4", closedAt: new Date("2026-09-10T16:00:00.000Z") }),
  sale({ saleId: "t5", closedAt: new Date("2026-09-10T16:00:00.000Z") })
];
const tied = await range.paginateRange(makeFetcher(sameClosed), { pageSize: 2, safetyMax: 1000 });
check("duplicate closedAt does not drop rows", tied.complete === true && tied.sales.length === 5);
check("duplicate closedAt does not duplicate rows", new Set(tied.sales.map(function (row) { return row.saleId; })).size === 5);

const empty = await range.paginateRange(makeFetcher([]), { pageSize: 150, safetyMax: 1000 });
check("empty range is complete", empty.complete === true && empty.sales.length === 0 && empty.truncated === false && empty.error === null);

const safetyRows = [];
for (let i = 0; i < 25; i += 1) safetyRows.push(sale({ saleId: "m" + i }));
const capped = await range.paginateRange(makeFetcher(safetyRows), { pageSize: 8, safetyMax: 20 });
check("safety max stops before exhaustion", capped.complete === false && capped.truncated === true && capped.sales.length === 20);
check("safety max does not look complete because the array is long", capped.complete === false);

async function boom() {
  throw new Error("FirebaseError: 9 FAILED_PRECONDITION: index");
}
const broken = await range.paginateRange(boom, { pageSize: 150, safetyMax: 1000 });
check("query error is not an empty complete report", broken.complete === false && broken.error && broken.sales.length === 0);

const viewErr = range.viewState(broken);
check("error view hides Firestore wording", viewErr.kind === "error" && viewErr.message === "This report could not load." && viewErr.sales.length === 0);

const viewInc = range.viewState(capped);
check("incomplete view refuses sales for totals", viewInc.kind === "incomplete" && viewInc.sales.length === 0);
check("incomplete message is user-facing", viewInc.message === "Sales data for this range is incomplete. Narrow the date range and try again.");

const viewEmpty = range.viewState(empty);
check("empty complete range is empty, not an error", viewEmpty.kind === "empty" && viewEmpty.sales.length === 0);

const todayRows = [];
for (let i = 0; i < 90; i += 1) {
  todayRows.push(sale({
    saleId: "today-" + i,
    dateKey: "2026-09-10",
    items: [{ kind: "service", amount: 5 }],
    subtotal: 5,
    total: 5
  }));
}
const todayFetch = await range.paginateRange(makeFetcher(todayRows), { pageSize: 40, safetyMax: 1000 });
const todayView = range.viewState(todayFetch);
const todaySummary = compute.summarize(todayView.sales, { fromKey: "2026-09-10", toKey: "2026-09-10", locationIds: ["nyc"] });
check("today can exceed 80 closed sales and stay complete", todayFetch.complete === true && todayView.kind === "ok" && todaySummary.totals.sales === 90);

const weekRows = [];
for (let i = 0; i < 110; i += 1) {
  const day = i < 55 ? "2026-09-07" : "2026-09-10";
  weekRows.push(sale({
    saleId: "week-" + i,
    dateKey: day,
    items: [{ kind: "service", amount: 8 }],
    subtotal: 8,
    total: 8
  }));
}
const week = compute.rangeForPreset("this_week", "2026-09-10");
const weekFetch = await range.paginateRange(makeFetcher(weekRows), { pageSize: 40, safetyMax: 1000 });
const weekSummary = compute.summarize(range.viewState(weekFetch).sales, { fromKey: week.fromKey, toKey: week.toKey, locationIds: ["nyc"] });
check("week can exceed 80 closed sales and stay complete", week.fromKey === "2026-09-07" && week.toKey === "2026-09-13" && weekFetch.complete === true && weekSummary.totals.sales === 110);

const monthRows = [];
for (let i = 0; i < 200; i += 1) {
  monthRows.push(sale({
    saleId: "month-" + i,
    dateKey: i % 2 ? "2026-09-02" : "2026-09-18",
    items: [{ kind: "service", amount: 6 }],
    subtotal: 6,
    total: 6
  }));
}
const month = compute.rangeForPreset("month:2026-09", "2026-09-10");
const monthFetch = await range.paginateRange(makeFetcher(monthRows), { pageSize: 60, safetyMax: 1000 });
const monthSummary = compute.summarize(range.viewState(monthFetch).sales, { fromKey: month.fromKey, toKey: month.toKey, locationIds: ["nyc"] });
check("month can exceed 80 closed sales and stay complete", month.fromKey === "2026-09-01" && month.toKey === "2026-09-30" && monthFetch.complete === true && monthSummary.totals.sales === 200);

const customSummary = compute.summarize(range.viewState(past).sales, { fromKey: "2026-08-01", toKey: "2026-08-31", locationIds: ["nyc"] });
check("custom past range summarizes only that range", customSummary.totals.sales === 2);

const stillSame = compute.summarize([
  { status: "closed", locationId: "a", dateKey: "2026-09-10", items: [{ kind: "service", amount: 40 }], tip: 0, history: [{ type: "refunded", amount: 10 }] }
], { fromKey: "2026-09-10", toKey: "2026-09-10" });
check("existing compute math is unchanged", stillSame.days[0].grossTotal === 40 && stillSame.days[0].refunds === 10 && stillSame.days[0].adjustedTotal === 30);

const merged = range.mergeSales([
  [sale({ saleId: "z", closedAt: new Date("2026-09-10T18:00:00.000Z") }), sale({ saleId: "a", closedAt: new Date("2026-09-10T18:00:00.000Z") })],
  [sale({ saleId: "z", closedAt: new Date("2026-09-10T18:00:00.000Z") })]
]);
check("merge sorts by closedAt then sale id and dedupes", merged.length === 2 && merged[0].saleId === "z" && merged[1].saleId === "a");

const locFail = range.combineLocationResults([
  { sales: [sale({ saleId: "ok" })], complete: true, fetchedCount: 1, truncated: false, error: null },
  { sales: [], complete: false, fetchedCount: 0, truncated: false, error: "Firestore failed" }
]);
check("one location error fails the combined report", locFail.complete === false && locFail.error && locFail.sales.length === 0);

const noLegacy = await range.fetchForReport({
  listForSalon: async function () { return [sale({ saleId: "legacy" })]; },
  listForLocation: async function () { return [sale({ saleId: "legacy" })]; }
}, { locationIds: ["nyc"], fromKey: "2026-09-10", toKey: "2026-09-10" });
check("range fetch never falls back to the 80-row list APIs", noLegacy.complete === false && noLegacy.error && (!noLegacy.sales || !noLegacy.sales.length));

const dataSrc = read("public/booking/sales/data.js");
const summarySrc = read("public/booking/reports/sales-summary.js");
const html = read("public/index.html");
check("old list APIs keep the 80-row cap", dataSrc.indexOf("const LIST_LIMIT = 80") !== -1);
check("range APIs were added beside the old list APIs", dataSrc.indexOf("listForLocationRange") !== -1 && dataSrc.indexOf("listForLocationsRange") !== -1);
check("range query uses closedAt bounds and startAfter", dataSrc.indexOf('where("closedAt", ">="') !== -1 && dataSrc.indexOf('where("closedAt", "<"') !== -1 && dataSrc.indexOf("startAfter") !== -1);
check("range query still filters by locationId", dataSrc.indexOf('where("locationId", "==", loc)') !== -1);
check("sales summary no longer loads the latest 80", summarySrc.indexOf("listForSalon") === -1 && summarySrc.indexOf("limit: 80") === -1);
check("sales summary uses the range helper", summarySrc.indexOf("fetchForReport") !== -1 && summarySrc.indexOf("viewState") !== -1);
check("sales summary has an incomplete state", summarySrc.indexOf('status === "incomplete"') !== -1 && summarySrc.indexOf("ff-rpt-warn") !== -1);
check("index.html loads the range helper before sales summary", html.indexOf("/booking/reports/sales-range.js") !== -1 && html.indexOf("/booking/reports/sales-range.js") < html.indexOf("/booking/reports/sales-summary.js"));
check("stale request is not stored", range.shouldStoreReportResult(1, 2) === false && range.shouldStoreReportResult(2, 2) === true);
check("inactive report does not paint", range.shouldPaintReportResult(2, 2, false) === false);
check("only the latest active request paints", range.shouldPaintReportResult(2, 2, true) === true && range.shouldPaintReportResult(1, 2, true) === false);
const svcSrc = read("public/booking/reports/service-sales.js");
const timeSrc = read("public/booking/reports/sales-time.js");
check("all three financial reports isolate active paint", summarySrc.indexOf("shouldPaintReportResult") !== -1 && svcSrc.indexOf("shouldPaintReportResult") !== -1 && timeSrc.indexOf("shouldPaintReportResult") !== -1 && summarySrc.indexOf("isActive") !== -1 && svcSrc.indexOf("isActive") !== -1 && timeSrc.indexOf("isActive") !== -1);

if (failed) process.exit(1);
console.log("All Booking sales-range checks passed.");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
