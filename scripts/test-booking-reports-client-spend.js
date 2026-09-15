/**
 * Client Spend. Closed checkout sales by identified clientId. No Firestore.
 * Usage: node scripts/test-booking-reports-client-spend.js
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
load("public/booking/reports/client-spend-compute.js", windowObj);
const api = windowObj.ffBookingReportsClientSpendCompute;
const compute = windowObj.ffBookingReportsCompute;
const range = windowObj.ffBookingReportsSalesRange;
const src = read("public/booking/reports/client-spend-compute.js");
const ui = read("public/booking/reports/client-spend.js");

function sale(partial) {
  return Object.assign({
    saleId: "s1",
    status: "closed",
    locationId: "nyc",
    clientId: "c1",
    clientSnapshot: { displayName: "Ada" },
    dateKey: "2026-09-10",
    items: [{ kind: "service", amount: 40 }],
    subtotal: 40,
    tip: 0,
    tax: 0,
    total: 40
  }, partial);
}

const day = { fromKey: "2026-09-10", toKey: "2026-09-10", locationIds: ["nyc"] };
const week = { fromKey: "2026-09-07", toKey: "2026-09-13", locationIds: ["nyc"] };

const twoClients = api.summarizeClientSpend([
  sale({ saleId: "a1", clientId: "c1", clientSnapshot: { displayName: "Ada" }, items: [{ kind: "service", amount: 40 }], subtotal: 40, tip: 4, total: 44 }),
  sale({ saleId: "a2", clientId: "c1", clientSnapshot: { displayName: "Ada" }, dateKey: "2026-09-12", items: [{ kind: "service", amount: 20 }], subtotal: 20, total: 20 }),
  sale({ saleId: "b1", clientId: "c2", clientSnapshot: { displayName: "Bea" }, items: [{ kind: "service", amount: 30 }], subtotal: 30, total: 30 })
], week);
check("groups closed sales by clientId", twoClients.totals.identifiedClients === 2 && twoClients.clients.length === 2);
check("same client tickets stay one ranked row", twoClients.clients[0].clientId === "c1" && twoClients.clients[0].tickets === 2);
check("spend uses shared gross checkout math including tip", twoClients.clients[0].spend === 64 && twoClients.totals.identifiedSales === 94);
check("average spend per identified client", twoClients.totals.averageSpendPerClient === 47);
check("average spend per checkout", twoClients.clients[0].averageSpend === 32 && twoClients.clients[1].averageSpend === 30);
check("ranks by spend then name", twoClients.clients[0].name === "Ada" && twoClients.clients[1].name === "Bea");
check("last closed checkout uses the later civil date", twoClients.clients[0].lastClosedDateKey === "2026-09-12");

const missingId = api.summarizeClientSpend([
  sale({ saleId: "anon", clientId: "", clientSnapshot: { displayName: "Walk-in", phone: "555-0100" } }),
  sale({ saleId: "known", clientId: "c9", clientSnapshot: { displayName: "Cara" } })
], day);
check("missing clientId stays out of the ranked table", missingId.clients.length === 1 && missingId.clients[0].clientId === "c9");
check("unidentified tickets are counted separately", missingId.totals.unidentifiedTickets === 1 && missingId.totals.identifiedClients === 1);
check("identified plus unidentified equals all closed sales", missingId.totals.identifiedSales + missingId.totals.unidentifiedSales === missingId.totals.allSales);

const sameName = api.summarizeClientSpend([
  sale({ saleId: "n1", clientId: "ada-1", clientSnapshot: { displayName: "Ada", phone: "555-0100" } }),
  sale({ saleId: "n2", clientId: "ada-2", clientSnapshot: { displayName: "Ada", phone: "555-0100" } })
], day);
check("name/phone are not used to invent identity", sameName.totals.identifiedClients === 2 && sameName.clients.length === 2);

const skipped = api.summarizeClientSpend([
  sale({ saleId: "open", status: "open", clientId: "c1" }),
  sale({ saleId: "void", status: "void", clientId: "c1" }),
  sale({ saleId: "ok", status: "closed", clientId: "c1" })
], day);
check("open and void tickets are excluded", skipped.totals.identifiedTickets === 1 && skipped.totals.identifiedSales === 40);

const loc = api.summarizeClientSpend([
  sale({ saleId: "nyc", locationId: "nyc", clientId: "c1" }),
  sale({ saleId: "la", locationId: "la", clientId: "c2", clientSnapshot: { displayName: "Bea" } })
], { fromKey: "2026-09-10", toKey: "2026-09-10", locationIds: ["nyc"] });
check("unselected locations stay out of scope", loc.totals.identifiedClients === 1 && loc.clients[0].clientId === "c1");

const multiLoc = api.summarizeClientSpend([
  sale({ saleId: "nyc", locationId: "nyc", clientId: "c1", items: [{ kind: "service", amount: 10 }], subtotal: 10, total: 10 }),
  sale({ saleId: "la", locationId: "la", clientId: "c1", items: [{ kind: "service", amount: 15 }], subtotal: 15, total: 15 })
], { fromKey: "2026-09-10", toKey: "2026-09-10", locationIds: ["nyc", "la"] });
check("selected-location tickets for the same client combine", multiLoc.totals.identifiedClients === 1 && multiLoc.clients[0].spend === 25 && multiLoc.clients[0].tickets === 2);

const outside = api.summarizeClientSpend([
  sale({ saleId: "in", dateKey: "2026-09-10" }),
  sale({ saleId: "out", dateKey: "2026-09-14", clientId: "c2" })
], week);
check("tickets outside the civil range are excluded", outside.totals.identifiedTickets === 1 && outside.totals.identifiedClients === 1);

const dup = api.summarizeClientSpend([
  sale({ saleId: "same", items: [{ kind: "service", amount: 40 }], subtotal: 40, total: 40 }),
  sale({ saleId: "same", items: [{ kind: "service", amount: 40 }], subtotal: 40, total: 40 })
], day);
check("duplicate sale ids are counted once", dup.totals.identifiedTickets === 1 && dup.totals.identifiedSales === 40);

const empty = api.summarizeClientSpend([], day);
check("empty range has zero identified clients and a null average", empty.totals.identifiedClients === 0 && empty.totals.averageSpendPerClient == null);
check("empty owner copy is specific", api.ownerView({ kind: "ok" }, empty).message === api.EMPTY_NOTE);

const summary = compute.summarize([
  sale({ saleId: "a", clientId: "c1", tip: 4, total: 44 }),
  sale({ saleId: "b", clientId: "", clientSnapshot: { displayName: "Walk-in" }, items: [{ kind: "service", amount: 12 }], subtotal: 12, total: 12 })
], day);
const spend = api.summarizeClientSpend([
  sale({ saleId: "a", clientId: "c1", tip: 4, total: 44 }),
  sale({ saleId: "b", clientId: "", clientSnapshot: { displayName: "Walk-in" }, items: [{ kind: "service", amount: 12 }], subtotal: 12, total: 12 })
], day);
check("identified plus unidentified reconciles to Sales Summary gross", spend.totals.allSales === summary.totals.grossTotal && spend.totals.identifiedSales + spend.totals.unidentifiedSales === summary.totals.grossTotal);
check("ticket count reconciles to Sales Summary closed tickets", spend.totals.tickets === summary.totals.sales);

const zoned = api.summarizeClientSpend([
  {
    saleId: "ny",
    status: "closed",
    locationId: "nyc",
    clientId: "c1",
    clientSnapshot: { displayName: "Ada" },
    closedAt: new Date("2026-09-11T05:00:00.000Z"),
    items: [{ kind: "service", amount: 10 }],
    subtotal: 10,
    total: 10
  },
  {
    saleId: "la",
    status: "closed",
    locationId: "la",
    clientId: "c2",
    clientSnapshot: { displayName: "Bea" },
    closedAt: new Date("2026-09-11T05:00:00.000Z"),
    items: [{ kind: "service", amount: 10 }],
    subtotal: 10,
    total: 10
  }
], { fromKey: "2026-09-10", toKey: "2026-09-11", locationIds: ["nyc", "la"] });
const ny = zoned.clients.find(function (row) { return row.clientId === "c1"; });
const la = zoned.clients.find(function (row) { return row.clientId === "c2"; });
check("civil last-visit date follows each sale location timezone", ny && ny.lastClosedDateKey === "2026-09-11" && la && la.lastClosedDateKey === "2026-09-10");

check("incomplete retrieval suppresses metrics", ui.indexOf('status === "incomplete"') !== -1 && ui.indexOf("ff-rpt-warn") !== -1);
check("retrieval error is not treated as empty", ui.indexOf("This report could not load.") !== -1);
check("stale request cannot paint", range.shouldPaintReportResult(1, 2, true) === false && range.shouldStoreReportResult(1, 2) === false);
check("ui isolates generate", ui.indexOf("shouldPaintReportResult") !== -1 && ui.indexOf("loadGen") !== -1 && ui.indexOf("isActive") !== -1);
check("ui uses range-complete sales loader", ui.indexOf("fetchForReport") !== -1 && ui.indexOf("ffBookingReportsSalesRange") !== -1);
check("no appointment or per-client reads", src.indexOf("getClientAppointments") === -1 && ui.indexOf("getClientAppointments") === -1 && ui.indexOf("getAppointmentsForDate") === -1);
check("no LTV language", src.indexOf("lifetime") !== -1 && ui.indexOf("lifetime value") !== -1 && src.indexOf("LTV") === -1 && ui.indexOf("predicted") === -1);
check("no phone matching", src.indexOf("phone") === -1);

if (failed) process.exit(1);
console.log("All Booking client spend checks passed.");
