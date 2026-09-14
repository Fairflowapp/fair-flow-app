/**
 * Sales by Time Period. No Firestore.
 * Usage: node scripts/test-booking-reports-sales-time.js
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
load("public/booking/sales/model.js", windowObj);
load("public/booking/reports/compute.js", windowObj);
load("public/booking/reports/sales-range.js", windowObj);
load("public/booking/reports/sales-time-compute.js", windowObj);
const api = windowObj.ffBookingReportsSalesTimeCompute;
const range = windowObj.ffBookingReportsSalesRange;

function sale(partial) {
  return Object.assign({
    saleId: "s1",
    status: "closed",
    locationId: "nyc",
    dateKey: "2026-09-10",
    items: [{ kind: "service", amount: 40 }],
    subtotal: 40,
    tip: 0,
    tax: 0,
    total: 40
  }, partial);
}

const week = { fromKey: "2026-09-07", toKey: "2026-09-13", locationIds: ["nyc"] };

const sameDay = api.summarizeSalesByPeriod([
  sale({ saleId: "a", items: [{ kind: "service", amount: 40 }], subtotal: 40, total: 40 }),
  sale({ saleId: "b", items: [{ kind: "service", amount: 25 }], subtotal: 25, total: 25 })
], { fromKey: "2026-09-10", toKey: "2026-09-10", locationIds: ["nyc"] });
check("A: same civil date aggregates tickets and gross", sameDay.days.length === 1 && sameDay.days[0].tickets === 2 && sameDay.totals.grossSales === 65);

const split = api.summarizeSalesByPeriod([
  sale({ saleId: "a", dateKey: "2026-09-09", total: 10, subtotal: 10, items: [{ kind: "service", amount: 10 }] }),
  sale({ saleId: "b", dateKey: "2026-09-10", total: 20, subtotal: 20, items: [{ kind: "service", amount: 20 }] })
], { fromKey: "2026-09-09", toKey: "2026-09-10", locationIds: ["nyc"] });
check("B: different dates stay separate", split.days.length === 2 && split.days[0].grossSales === 10 && split.days[1].grossSales === 20);

const mondays = api.summarizeSalesByPeriod([
  sale({ saleId: "m1", dateKey: "2026-09-07", total: 30, subtotal: 30, items: [{ kind: "service", amount: 30 }] }),
  sale({ saleId: "m2", dateKey: "2026-09-14", total: 50, subtotal: 50, items: [{ kind: "service", amount: 50 }] })
], { fromKey: "2026-09-07", toKey: "2026-09-20", locationIds: ["nyc"] });
const monday = mondays.weekdays.find(function (row) { return row.weekday === "monday"; });
check("C: multiple Mondays aggregate", monday && monday.tickets === 2 && monday.grossSales === 80 && monday.dateCount === 2);

check("D: average sales per date uses calendar occurrences", monday.averagePerDate === 40);

const zeros = api.summarizeSalesByPeriod([
  sale({ dateKey: "2026-09-07", total: 12, subtotal: 12, items: [{ kind: "service", amount: 12 }] })
], { fromKey: "2026-09-07", toKey: "2026-09-09", locationIds: ["nyc"] });
check("E: zero-sales dates stay in the daily table", zeros.days.length === 3 && zeros.days[1].tickets === 0 && zeros.days[1].grossSales === 0 && zeros.days[2].dateKey === "2026-09-09");

check("F: gross checkout sales is the ticket gross total", sameDay.totals.grossSales === 65);

const refunded = api.summarizeSalesByPeriod([
  sale({
    items: [{ kind: "service", amount: 40 }],
    subtotal: 40,
    tip: 5,
    total: 45,
    history: [{ type: "refunded", amount: 10 }]
  })
], { fromKey: "2026-09-10", toKey: "2026-09-10", locationIds: ["nyc"] });
check("G: ticket-level refunds reduce adjusted sales only", refunded.totals.grossSales === 45 && refunded.totals.refunds === 10 && refunded.totals.adjustedSales === 35);

const tipped = api.summarizeSalesByPeriod([
  sale({
    items: [{ kind: "service", amount: 50 }],
    subtotal: 50,
    tip: 5,
    total: 55
  })
], { fromKey: "2026-09-10", toKey: "2026-09-10", locationIds: ["nyc"] });
check("H: tip is inside gross checkout sales once", tipped.totals.grossSales === 55 && tipped.totals.tip === 5 && tipped.days[0].serviceSales === 50);

check("I: average closed ticket is gross / tickets", sameDay.totals.averageTicket === 32.5);

const skipped = api.summarizeSalesByPeriod([
  sale({ status: "open", total: 40 }),
  sale({ saleId: "v", status: "void", total: 40 }),
  sale({ saleId: "ok", total: 12, subtotal: 12, items: [{ kind: "service", amount: 12 }] })
], { fromKey: "2026-09-10", toKey: "2026-09-10", locationIds: ["nyc"] });
check("J: open sales are excluded", skipped.totals.tickets === 1 && skipped.totals.grossSales === 12);
check("K: void sales are excluded", skipped.totals.tickets === 1);

const dupes = api.summarizeSalesByPeriod([
  sale({ saleId: "same", total: 20, subtotal: 20, items: [{ kind: "service", amount: 20 }] }),
  sale({ saleId: "same", total: 20, subtotal: 20, items: [{ kind: "service", amount: 20 }] })
], { fromKey: "2026-09-10", toKey: "2026-09-10", locationIds: ["nyc"] });
check("L: duplicate sale IDs are counted once", dupes.totals.tickets === 1 && dupes.totals.grossSales === 20);

const multi = api.summarizeSalesByPeriod([
  sale({ saleId: "n1", locationId: "nyc", dateKey: "2026-09-10", total: 10, subtotal: 10, items: [{ kind: "service", amount: 10 }] }),
  sale({ saleId: "l1", locationId: "la", dateKey: "2026-09-10", total: 15, subtotal: 15, items: [{ kind: "service", amount: 15 }] })
], { fromKey: "2026-09-10", toKey: "2026-09-10", locationIds: ["nyc", "la"] });
check("M: same civil date across locations combines", multi.days.length === 1 && multi.days[0].tickets === 2 && multi.totals.grossSales === 25);

const zoned = api.summarizeSalesByPeriod([
  {
    saleId: "ny-late",
    status: "closed",
    locationId: "nyc",
    closedAt: new Date("2026-09-11T05:00:00.000Z"),
    items: [{ kind: "service", amount: 10 }],
    subtotal: 10,
    tip: 0,
    total: 10
  },
  {
    saleId: "la-late",
    status: "closed",
    locationId: "la",
    closedAt: new Date("2026-09-11T05:00:00.000Z"),
    items: [{ kind: "service", amount: 20 }],
    subtotal: 20,
    tip: 0,
    total: 20
  }
], { fromKey: "2026-09-10", toKey: "2026-09-11", locationIds: ["nyc", "la"] });
const nyDay = zoned.days.find(function (row) { return row.dateKey === "2026-09-11"; });
const laDay = zoned.days.find(function (row) { return row.dateKey === "2026-09-10"; });
check("N: civil date follows each sale location timezone", nyDay && nyDay.tickets === 1 && nyDay.grossSales === 10 && laDay && laDay.tickets === 1 && laDay.grossSales === 20);

const empty = api.summarizeSalesByPeriod([], { fromKey: "2026-09-10", toKey: "2026-09-10", locationIds: ["nyc"] });
check("O: complete empty range still has the civil date row", empty.days.length === 1 && empty.days[0].tickets === 0 && empty.totals.grossSales === 0);
check("O: empty owner view still renders the zero table", api.ownerView({ kind: "empty", sales: [] }, empty).kind === "ok" && api.ownerView({ kind: "empty", sales: [] }, empty).summary.days.length === 1);

const incomplete = api.ownerView({ kind: "incomplete", message: api.INCOMPLETE_MESSAGE, sales: [sale()] }, sameDay);
check("P: incomplete range has no authoritative totals", incomplete.kind === "incomplete" && incomplete.summary == null);

check("Q: stale request cannot paint the active report", range.shouldPaintReportResult(1, 2, true) === false && range.shouldStoreReportResult(1, 2) === false);
check("Q: inactive report cannot paint", range.shouldPaintReportResult(2, 2, false) === false);

const tinyAvg = api.summarizeSalesByPeriod([
  sale({ saleId: "t1", total: 200, subtotal: 200, items: [{ kind: "service", amount: 200 }] }),
  sale({ saleId: "t2", dateKey: "2026-09-11", total: 10, subtotal: 10, items: [{ kind: "service", amount: 10 }] }),
  sale({ saleId: "t3", dateKey: "2026-09-11", total: 10, subtotal: 10, items: [{ kind: "service", amount: 10 }] }),
  sale({ saleId: "t4", dateKey: "2026-09-11", total: 10, subtotal: 10, items: [{ kind: "service", amount: 10 }] }),
  sale({ saleId: "t5", dateKey: "2026-09-11", total: 10, subtotal: 10, items: [{ kind: "service", amount: 10 }] }),
  sale({ saleId: "t6", dateKey: "2026-09-11", total: 10, subtotal: 10, items: [{ kind: "service", amount: 10 }] })
], week);
check("R: a 1-ticket high average is not a strongest-ticket insight", tinyAvg.highlights.highestAverageTicketDate === "2026-09-11" && tinyAvg.highlights.highestAverageTicketDate !== "2026-09-10");
check("R: tiny-sample average insight is withheld", !tinyAvg.insights.some(function (line) { return line.indexOf("September 10") !== -1 && line.indexOf("average closed ticket") !== -1; }));

check("weekday from civil date is Thursday for Sep 10 2026", api.weekdayFromDateKey("2026-09-10") === "thursday");

const src = read("public/booking/reports/sales-time-compute.js");
const ui = read("public/booking/reports/sales-time.js");
const shell = read("public/booking/reports/ui.js");
check("compute does not read priceSnapshot", src.indexOf("priceSnapshot") === -1);
check("compute documents location-local dates", src.indexOf("location-local date") !== -1);
check("hourly close-time UI was not added", ui.indexOf("Best sales hour") === -1 && ui.indexOf("By sale close time") === -1);
check("ui uses range-complete retrieval", ui.indexOf("fetchForReport") !== -1 && ui.indexOf("listForSalon") === -1 && ui.indexOf("listForLocation") === -1);
check("ui refuses incomplete totals", ui.indexOf('status === "incomplete"') !== -1 && ui.indexOf("ff-rpt-warn") !== -1);
check("ui isolates stale generate", ui.indexOf("shouldPaintReportResult") !== -1 && ui.indexOf("loadGen") !== -1 && ui.indexOf("isActive") !== -1);
check("ui does not call it revenue or profit", ui.indexOf("revenue") === -1 && ui.indexOf("profit") === -1 && ui.indexOf("Net income") === -1);
check("reports ui loads sales time modules", shell.indexOf("/booking/reports/sales-time-compute.js") !== -1 && shell.indexOf("/booking/reports/sales-time.js") !== -1);

if (failed) process.exit(1);
console.log("All Booking sales-by-time checks passed.");
