/**
 * Sales Comparison. Closed checkout sales vs previous equal-length range.
 * No Firestore.
 * Usage: node scripts/test-booking-reports-sales-compare.js
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
load("public/booking/reports/sales-compare-compute.js", windowObj);

const compute = windowObj.ffBookingReportsCompute;
const range = windowObj.ffBookingReportsSalesRange;
const api = windowObj.ffBookingReportsSalesCompareCompute;
const src = read("public/booking/reports/sales-compare-compute.js");
const ui = read("public/booking/reports/sales-compare.js");
const shell = read("public/booking/reports/ui.js");
const navSrc = read("public/booking/reports/nav.js");

function sale(partial) {
  return Object.assign({
    saleId: "s1",
    status: "closed",
    locationId: "nyc",
    dateKey: "2026-09-01",
    items: [{ kind: "service", amount: 40 }],
    subtotal: 40,
    tip: 0,
    tax: 0,
    customFees: 0,
    total: 40
  }, partial);
}

const week7 = api.previousRange("2026-09-01", "2026-09-07");
check("7-day previous range is Aug 25-31", week7.fromKey === "2026-08-25" && week7.toKey === "2026-08-31" && week7.days === 7);

const month30 = api.previousRange("2026-09-01", "2026-09-30");
check("month-like 30-day previous range is Aug 2-31", month30.fromKey === "2026-08-02" && month30.toKey === "2026-08-31" && month30.days === 30);

const oneDay = api.previousRange("2026-09-11", "2026-09-11");
check("single-day previous is the prior civil day", oneDay.fromKey === "2026-09-10" && oneDay.toKey === "2026-09-10" && oneDay.days === 1);

const weekSales = [
  sale({ saleId: "prev", dateKey: "2026-08-26", items: [{ kind: "service", amount: 50 }], subtotal: 50, total: 50 }),
  sale({ saleId: "cur", dateKey: "2026-09-03", items: [{ kind: "service", amount: 70 }], subtotal: 70, total: 70 })
];
const weekCmp = api.comparePeriods(weekSales, weekSales, {
  fromKey: "2026-09-01",
  toKey: "2026-09-07",
  locationIds: ["nyc"]
});
check("7-day current uses only Sep 1-7 sales", weekCmp.metrics.grossTotal.current === 70 && weekCmp.metrics.tickets.current === 1);
check("7-day previous uses only Aug 25-31 sales", weekCmp.metrics.grossTotal.previous === 50 && weekCmp.metrics.tickets.previous === 1);
check("current greater than previous reports a rise", weekCmp.metrics.grossTotal.change === 20 && weekCmp.metrics.grossTotal.percent === 40 && weekCmp.metrics.grossTotal.percentKind === "ok");

const down = api.comparePeriods(
  [sale({ saleId: "cur", dateKey: "2026-09-03", items: [{ kind: "service", amount: 50 }], subtotal: 50, total: 50 })],
  [sale({ saleId: "prev", dateKey: "2026-08-26", items: [{ kind: "service", amount: 100 }], subtotal: 100, total: 100 })],
  { fromKey: "2026-09-01", toKey: "2026-09-07", locationIds: ["nyc"] }
);
check("current less than previous reports a drop", down.metrics.grossTotal.current === 50 && down.metrics.grossTotal.previous === 100 && down.metrics.grossTotal.change === -50 && down.metrics.grossTotal.percent === -50);

const monthCmp = api.comparePeriods(
  [sale({ saleId: "sep", dateKey: "2026-09-15", items: [{ kind: "service", amount: 300 }], subtotal: 300, total: 300 })],
  [sale({ saleId: "aug", dateKey: "2026-08-10", items: [{ kind: "service", amount: 100 }], subtotal: 100, total: 100 })],
  { fromKey: "2026-09-01", toKey: "2026-09-30", locationIds: ["nyc"] }
);
check("month-like custom range uses equal-length previous", monthCmp.previousRange.fromKey === "2026-08-02" && monthCmp.previousRange.toKey === "2026-08-31" && monthCmp.metrics.grossTotal.current === 300 && monthCmp.metrics.grossTotal.previous === 100 && monthCmp.metrics.grossTotal.percent === 200);

const zeroPrev = api.compareAmount(80, 0);
check("previous zero with current sales is New, not Infinity", zeroPrev.percent == null && zeroPrev.percentKind === "new" && zeroPrev.change === 80 && !Number.isFinite(1 / 0) === true);

const bothZero = api.compareAmount(0, 0);
check("both periods zero stay 0 percent", bothZero.percent === 0 && bothZero.percentKind === "zero" && bothZero.change === 0);

const emptyCmp = api.comparePeriods([], [], {
  fromKey: "2026-09-01",
  toKey: "2026-09-07",
  locationIds: ["nyc"]
});
check("no sales in either period stay zero without fake percent", emptyCmp.metrics.grossTotal.current === 0 && emptyCmp.metrics.grossTotal.previous === 0 && emptyCmp.metrics.tickets.current === 0 && emptyCmp.metrics.tickets.previous === 0 && emptyCmp.metrics.grossTotal.percent === 0 && emptyCmp.metrics.tickets.percentKind === "zero");

const refunded = api.comparePeriods(
  [sale({
    saleId: "cur-ref",
    dateKey: "2026-09-03",
    items: [{ kind: "service", amount: 40 }],
    subtotal: 40,
    tip: 5,
    total: 45,
    history: [{ type: "refunded", amount: 10 }]
  })],
  [sale({
    saleId: "prev-ok",
    dateKey: "2026-08-26",
    items: [{ kind: "service", amount: 40 }],
    subtotal: 40,
    total: 40
  })],
  { fromKey: "2026-09-01", toKey: "2026-09-07", locationIds: ["nyc"] }
);
check("refunds reduce adjusted sales only", refunded.metrics.grossTotal.current === 45 && refunded.metrics.adjustedTotal.current === 35 && refunded.metrics.adjustedTotal.previous === 40 && refunded.metrics.adjustedTotal.change === -5);

const tips = api.comparePeriods(
  [sale({ saleId: "cur-tip", dateKey: "2026-09-03", items: [{ kind: "service", amount: 50 }], subtotal: 50, tip: 10, total: 60 })],
  [sale({ saleId: "prev-tip", dateKey: "2026-08-26", items: [{ kind: "service", amount: 50 }], subtotal: 50, tip: 4, total: 54 })],
  { fromKey: "2026-09-01", toKey: "2026-09-07", locationIds: ["nyc"] }
);
check("tips compare current vs previous", tips.metrics.tip.current === 10 && tips.metrics.tip.previous === 4 && tips.metrics.tip.change === 6 && tips.metrics.tip.percent === 150);
check("tips stay inside gross checkout sales", tips.metrics.grossTotal.current === 60 && tips.metrics.grossTotal.previous === 54);

const newTips = api.compareAmount(8, 0);
check("tips from a zero previous period are New", newTips.percentKind === "new" && newTips.percent == null);

const multiSales = [
  sale({ saleId: "n1", locationId: "nyc", dateKey: "2026-09-03", items: [{ kind: "service", amount: 10 }], subtotal: 10, total: 10 }),
  sale({ saleId: "l1", locationId: "la", dateKey: "2026-09-04", items: [{ kind: "service", amount: 20 }], subtotal: 20, total: 20 }),
  sale({ saleId: "p1", locationId: "nyc", dateKey: "2026-08-26", items: [{ kind: "service", amount: 5 }], subtotal: 5, total: 5 })
];
const multiOpts = { fromKey: "2026-09-01", toKey: "2026-09-07", locationIds: ["nyc", "la"] };
const multiCmp = api.comparePeriods(multiSales, multiSales, multiOpts);
const multiSummary = compute.summarize(multiSales, multiOpts);
check("multiple locations combine into one comparison total", multiCmp.metrics.grossTotal.current === 30 && multiCmp.metrics.tickets.current === 2);
check("current comparison totals reconcile with Sales Summary", multiCmp.metrics.grossTotal.current === multiSummary.totals.grossTotal && multiCmp.metrics.adjustedTotal.current === multiSummary.totals.adjustedTotal && multiCmp.metrics.tickets.current === multiSummary.totals.sales && multiCmp.metrics.tip.current === multiSummary.totals.tip && multiCmp.metrics.averageTicket.current === api.averageTicket(multiSummary.totals));

const zonedSales = [
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
];
const zonedCmp = api.comparePeriods(zonedSales, zonedSales, {
  fromKey: "2026-09-11",
  toKey: "2026-09-11",
  locationIds: ["nyc", "la"]
});
check("timezone: NY 05:00Z is current Sep 11", zonedCmp.metrics.grossTotal.current === 10 && zonedCmp.metrics.tickets.current === 1);
check("timezone: LA 05:00Z is previous Sep 10", zonedCmp.metrics.grossTotal.previous === 20 && zonedCmp.metrics.tickets.previous === 1);
const zonedCurrentSummary = compute.summarize(zonedSales, {
  fromKey: "2026-09-11",
  toKey: "2026-09-11",
  locationIds: ["nyc", "la"]
});
check("timezone current totals still match Sales Summary", zonedCmp.metrics.grossTotal.current === zonedCurrentSummary.totals.grossTotal && zonedCurrentSummary.totals.grossTotal === 10);

const currentIncomplete = api.ownerView(
  { kind: "incomplete", message: range.INCOMPLETE_MESSAGE, sales: weekSales },
  { kind: "ok", sales: weekSales },
  weekCmp
);
check("incomplete current range suppresses comparison", currentIncomplete.kind === "incomplete" && currentIncomplete.summary == null && currentIncomplete.message === range.INCOMPLETE_MESSAGE);

const previousIncomplete = api.ownerView(
  { kind: "ok", sales: weekSales },
  { kind: "incomplete", message: range.INCOMPLETE_MESSAGE, sales: weekSales },
  weekCmp
);
check("incomplete previous range suppresses comparison", previousIncomplete.kind === "incomplete" && previousIncomplete.summary == null && previousIncomplete.message === api.INCOMPLETE_PREVIOUS_MESSAGE);

const currentError = api.ownerView(
  { kind: "error", message: range.LOAD_ERROR_MESSAGE, sales: [] },
  { kind: "ok", sales: weekSales },
  weekCmp
);
check("current fetch error is not treated as empty", currentError.kind === "error" && currentError.summary == null);

const previousError = api.ownerView(
  { kind: "ok", sales: weekSales },
  { kind: "error", message: range.LOAD_ERROR_MESSAGE, sales: [] },
  weekCmp
);
check("previous fetch error is not treated as empty", previousError.kind === "error" && previousError.summary == null);

const emptyViews = api.ownerView(
  { kind: "empty", sales: [] },
  { kind: "empty", sales: [] },
  emptyCmp
);
check("complete empty periods remain a trustworthy zero comparison", emptyViews.kind === "ok" && emptyViews.summary === emptyCmp);

const skipped = api.comparePeriods(
  [
    sale({ saleId: "open", status: "open", dateKey: "2026-09-03", total: 99 }),
    sale({ saleId: "void", status: "void", dateKey: "2026-09-03", total: 77 }),
    sale({ saleId: "ok", dateKey: "2026-09-03", items: [{ kind: "service", amount: 12 }], subtotal: 12, total: 12 })
  ],
  [sale({ saleId: "prev-ok", dateKey: "2026-08-26", items: [{ kind: "service", amount: 12 }], subtotal: 12, total: 12 })],
  { fromKey: "2026-09-01", toKey: "2026-09-07", locationIds: ["nyc"] }
);
check("open and void tickets are excluded", skipped.metrics.tickets.current === 1 && skipped.metrics.grossTotal.current === 12);

const avg = api.comparePeriods(
  [
    sale({ saleId: "c1", dateKey: "2026-09-03", items: [{ kind: "service", amount: 40 }], subtotal: 40, tip: 10, total: 50 }),
    sale({ saleId: "c2", dateKey: "2026-09-04", items: [{ kind: "service", amount: 20 }], subtotal: 20, total: 20 })
  ],
  [sale({ saleId: "p1", dateKey: "2026-08-26", items: [{ kind: "service", amount: 30 }], subtotal: 30, total: 30 })],
  { fromKey: "2026-09-01", toKey: "2026-09-07", locationIds: ["nyc"] }
);
check("average ticket is current gross / closed tickets", avg.metrics.averageTicket.current === 35 && avg.metrics.averageTicket.previous === 30 && avg.metrics.averageTicket.change === 5);

check("ui shows New instead of Infinity", ui.indexOf("percentKind === \"new\"") !== -1 && ui.indexOf("New") !== -1 && ui.indexOf("Infinity") === -1);
check("ui names current and previous periods", ui.indexOf("Current period:") !== -1 && ui.indexOf("Previous period:") !== -1);
check("ui refuses incomplete totals", ui.indexOf('status === "incomplete"') !== -1 && ui.indexOf("ff-rpt-warn") !== -1);
check("ui isolates generate", ui.indexOf("shouldPaintReportResult") !== -1 && ui.indexOf("loadGen") !== -1 && ui.indexOf("isActive") !== -1);
check("ui uses range-complete sales loader", ui.indexOf("fetchForReport") !== -1 && ui.indexOf("listForSalon") === -1 && ui.indexOf("listForLocation") === -1);
check("ui fetches current and previous ranges", ui.indexOf("previousRange") !== -1 && ui.indexOf("Promise.all") !== -1);
check("compute does not use booked appointment value", src.indexOf("priceSnapshot") === -1 && ui.indexOf("priceSnapshot") === -1);
check("nav exposes Sales Comparison", navSrc.indexOf('id: "sales-comparison"') !== -1 && navSrc.indexOf("Sales Comparison") !== -1);
check("reports ui lazy-loads comparison modules", shell.indexOf("/booking/reports/sales-compare-compute.js") !== -1 && shell.indexOf("/booking/reports/sales-compare.js") !== -1);
check("no per-location table yet", ui.indexOf("By location") === -1 && src.indexOf("perLocation") === -1);
check("stale request cannot paint", range.shouldPaintReportResult(1, 2, true) === false && range.shouldStoreReportResult(1, 2) === false);

if (failed) process.exit(1);
console.log("All Booking sales comparison checks passed.");
