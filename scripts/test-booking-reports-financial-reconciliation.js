/**
 * Cross-report checkout Sales reconciliation.
 * Same complete in-memory dataset through Summary, Service Sales,
 * and Sales by Time Period. No Firestore.
 * Usage: node scripts/test-booking-reports-financial-reconciliation.js
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
load("public/booking/reports/service-sales-compute.js", windowObj);
load("public/booking/reports/sales-time-compute.js", windowObj);

const compute = windowObj.ffBookingReportsCompute;
const range = windowObj.ffBookingReportsSalesRange;
const serviceApi = windowObj.ffBookingReportsServiceSalesCompute;
const timeApi = windowObj.ffBookingReportsSalesTimeCompute;

const SALES = [
  {
    saleId: "a1",
    status: "closed",
    locationId: "nyc",
    dateKey: "2026-09-10",
    items: [
      { kind: "service", name: "Gel", serviceId: "gel", amount: 40 },
      { kind: "service", name: "Cut", serviceId: "cut", amount: 20 }
    ],
    subtotal: 60,
    tip: 6,
    tax: 0,
    customFees: 0,
    total: 66
  },
  {
    saleId: "b1",
    status: "closed",
    locationId: "la",
    dateKey: "2026-09-10",
    items: [{ kind: "service", name: "Color", serviceId: "color", amount: 30 }],
    subtotal: 30,
    tip: 0,
    total: 30
  },
  {
    saleId: "a2",
    status: "closed",
    locationId: "nyc",
    dateKey: "2026-09-11",
    items: [{ kind: "service", name: "Color", serviceId: "color", amount: 80 }],
    subtotal: 80,
    tip: 8,
    total: 88,
    history: [{ type: "refunded", amount: 20 }]
  },
  {
    saleId: "a3",
    status: "closed",
    locationId: "nyc",
    dateKey: "2026-09-11",
    items: [
      { kind: "service", name: "Blowout", serviceId: "blow", amount: 25 },
      { kind: "product", name: "Serum", amount: 15 }
    ],
    subtotal: 40,
    tip: 0,
    tax: 2,
    customFees: 3,
    total: 45
  },
  {
    saleId: "open1",
    status: "open",
    locationId: "nyc",
    dateKey: "2026-09-10",
    items: [{ kind: "service", amount: 99 }],
    subtotal: 99,
    total: 99
  },
  {
    saleId: "void1",
    status: "void",
    locationId: "nyc",
    dateKey: "2026-09-10",
    items: [{ kind: "service", amount: 77 }],
    subtotal: 77,
    total: 77
  },
  {
    saleId: "a1",
    status: "closed",
    locationId: "nyc",
    dateKey: "2026-09-10",
    items: [
      { kind: "service", name: "Gel", serviceId: "gel", amount: 40 },
      { kind: "service", name: "Cut", serviceId: "cut", amount: 20 }
    ],
    subtotal: 60,
    tip: 6,
    total: 66
  }
];

const OPTS = { fromKey: "2026-09-10", toKey: "2026-09-12", locationIds: ["nyc", "la"] };
const summary = compute.summarize(SALES, OPTS);
const service = serviceApi.summarizeServiceSales(SALES, OPTS);
const time = timeApi.summarizeSalesByPeriod(SALES, OPTS);
const timeDailyGross = time.days.reduce(function (sum, row) { return sum + row.grossSales; }, 0);
const timeDailyRefunds = time.days.reduce(function (sum, row) { return sum + row.refunds; }, 0);
const timeDailyAdjusted = time.days.reduce(function (sum, row) { return sum + row.adjustedSales; }, 0);
const timeDailyService = time.days.reduce(function (sum, row) { return sum + row.serviceSales; }, 0);

check("A: Sales Summary gross == Sales Time total daily gross", summary.totals.grossTotal === time.totals.grossSales && time.totals.grossSales === timeDailyGross && summary.totals.grossTotal === 229);
check("B: Sales Summary refunds == Sales Time daily refunds", summary.totals.refunds === time.totals.refunds && time.totals.refunds === timeDailyRefunds && summary.totals.refunds === 20);
check("C: Sales Summary adjusted == Sales Time daily adjusted", summary.totals.adjustedTotal === time.totals.adjustedSales && time.totals.adjustedSales === timeDailyAdjusted && summary.totals.adjustedTotal === 209);
check("D: Service Sales gross == Sales Time service-item gross", service.totals.grossSales === time.totals.serviceSales && time.totals.serviceSales === timeDailyService && service.totals.grossSales === 195);
check("D: Summary service-item column matches Service Sales gross", summary.totals.serviceSales === service.totals.grossSales);

check("E: Service Sales gross excludes tips", service.totals.grossSales === 195 && service.totals.grossSales !== summary.totals.grossTotal);
check("F: Sales Summary gross includes tip", summary.totals.tip === 14 && summary.totals.grossTotal === 229);

check("G: open sale excluded everywhere", summary.totals.sales === 4 && service.totals.tickets === 4 && time.totals.tickets === 4);
check("H: void sale excluded everywhere", summary.totals.grossTotal === 229 && service.totals.grossSales === 195 && time.totals.grossSales === 229);

check("I: same complete dataset produces consistent ticket counts", summary.totals.sales === time.totals.tickets && time.totals.tickets === service.totals.tickets);
check("I: Summary and Time share the same tip total", summary.totals.tip === time.totals.tip);

check("J: refund stays ticket-level and does not change Service Sales gross", service.totals.grossSales === 195 && service.totals.hasTicketRefunds === true);
check("J: Summary and Time use the same refundAmount helper", compute.refundAmount(SALES[2]) === 20 && time.totals.refunds === compute.refundAmount(SALES[2]));

check("K: multiple days still reconcile", summary.days.length === 2 && time.days.length === 3 && time.days[2].dateKey === "2026-09-12" && time.days[2].grossSales === 0);
check("K: Sep 10 gross matches across Summary and Time", summary.days[0].grossTotal === 96 && time.days[0].grossSales === 96);
check("K: Sep 11 gross matches across Summary and Time", summary.days[1].grossTotal === 133 && time.days[1].grossSales === 133);

check("L: multiple locations still reconcile", summary.totals.grossTotal === 229 && service.totals.grossSales === 195);

check("M: duplicate sale IDs are not double-counted inconsistently", summary.totals.sales === 4 && service.totals.units === 5 && time.totals.tickets === 4);

const incompleteFetch = { kind: "incomplete", message: range.INCOMPLETE_MESSAGE, sales: SALES };
check("N: incomplete retrieval suppresses Summary totals", compute.ownerView(incompleteFetch, summary).summary == null);
check("N: incomplete retrieval suppresses Service Sales totals", serviceApi.ownerView(incompleteFetch, service).summary == null);
check("N: incomplete retrieval suppresses Time Period totals", timeApi.ownerView(incompleteFetch, time).summary == null);

function reportBox() {
  return {
    loadGen: 0,
    active: false,
    stored: null,
    painted: null,
    start: function () {
      this.loadGen += 1;
      return this.loadGen;
    },
    finish: function (requestId, payload) {
      if (!range.shouldStoreReportResult(requestId, this.loadGen)) return;
      this.stored = payload;
      if (!range.shouldPaintReportResult(requestId, this.loadGen, this.active)) return;
      this.painted = payload;
    }
  };
}

function lateCannotOverwrite() {
  const from = reportBox();
  const to = reportBox();
  from.active = true;
  const fromId = from.start();
  from.active = false;
  to.active = true;
  const toId = to.start();
  from.finish(fromId, "LATE");
  to.finish(toId, "ACTIVE");
  return from.painted == null && to.painted === "ACTIVE";
}

check("O: Sales Summary late response cannot overwrite Service Sales", lateCannotOverwrite());
check("O: Service Sales late response cannot overwrite Sales by Time Period", lateCannotOverwrite());
check("O: Sales by Time Period late response cannot overwrite Sales Summary", lateCannotOverwrite());

const same = reportBox();
same.active = true;
const older = same.start();
const newer = same.start();
same.finish(older, "OLD_GENERATE");
same.finish(newer, "NEW_GENERATE");
check("O: older Generate from the same report cannot overwrite a newer Generate", same.stored === "NEW_GENERATE" && same.painted === "NEW_GENERATE");

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
const zonedOpts = { fromKey: "2026-09-10", toKey: "2026-09-11", locationIds: ["nyc", "la"] };
const zonedSummary = compute.summarize(zonedSales, zonedOpts);
const zonedService = serviceApi.summarizeServiceSales(zonedSales, zonedOpts);
const zonedTime = timeApi.summarizeSalesByPeriod(zonedSales, zonedOpts);
check("L: timezone civil dates stay aligned across reports", zonedSummary.days.length === 2 && zonedTime.days.length === 2 && zonedService.days.length === 2);
check("L: NY close lands on Sep 11 and LA on Sep 10 in every report", zonedSummary.days[0].dateKey === "2026-09-10" && zonedSummary.days[0].grossTotal === 20 && zonedSummary.days[1].dateKey === "2026-09-11" && zonedSummary.days[1].grossTotal === 10 && zonedTime.days[0].grossSales === 20 && zonedTime.days[1].grossSales === 10 && zonedService.days[0].sales === 20 && zonedService.days[1].sales === 10);
check("L: combined timezone totals still reconcile", zonedSummary.totals.grossTotal === 30 && zonedTime.totals.grossSales === 30 && zonedService.totals.grossSales === 30);

check("intentional: service gross is not checkout gross", service.totals.grossSales !== summary.totals.grossTotal);
check("intentional: average closed ticket is checkout gross / tickets", time.totals.averageTicket === 57.25);
check("intentional: average service sale is service gross / service tickets", service.totals.averageTicket === 48.75);

const summarySrc = read("public/booking/reports/sales-summary.js");
const serviceSrc = read("public/booking/reports/service-sales.js");
const timeSrc = read("public/booking/reports/sales-time.js");
const serviceComputeSrc = read("public/booking/reports/service-sales-compute.js");
const timeComputeSrc = read("public/booking/reports/sales-time-compute.js");
const computeSrc = read("public/booking/reports/compute.js");
const uiSrc = read("public/booking/reports/ui.js");
const navSrc = read("public/booking/reports/nav.js");

function usesRangeOnly(src) {
  return src.indexOf("fetchForReport") !== -1 && src.indexOf("listForSalon") === -1 && src.indexOf("listForLocation") === -1 && src.indexOf("limit: 80") === -1;
}

check("source: all three reports use fetchForReport only", usesRangeOnly(summarySrc) && usesRangeOnly(serviceSrc) && usesRangeOnly(timeSrc));
check("source: computes do not read priceSnapshot or booked value", computeSrc.indexOf("priceSnapshot") === -1 && serviceComputeSrc.indexOf("priceSnapshot") === -1 && timeComputeSrc.indexOf("priceSnapshot") === -1);
check("source: all three share rangeForPreset and locationIds", summarySrc.indexOf("rangeForPreset") !== -1 && serviceSrc.indexOf("rangeForPreset") !== -1 && timeSrc.indexOf("rangeForPreset") !== -1 && summarySrc.indexOf("locationIds: ids") !== -1 && serviceSrc.indexOf("locationIds: ids") !== -1 && timeSrc.indexOf("locationIds: ids") !== -1);
check("source: reports ui does not preload financial fetches", uiSrc.indexOf("fetchForReport") === -1);
check("copy: Sales Summary is overall checkout sales", navSrc.indexOf("Overall closed checkout sales.") !== -1 && summarySrc.indexOf("Overall closed checkout sales.") !== -1);
check("copy: Service Sales explains service-item scope", serviceSrc.indexOf("Tips and ticket-level refunds are not allocated to services.") !== -1);
check("copy: Time Period is grouped by sale date", timeSrc.indexOf("Closed checkout sales grouped by sale date.") !== -1);
check("copy: Product Sales is not a visible nav item", navSrc.indexOf('id: "product-sales"') === -1);
check("copy: financial reports do not say revenue or profit", summarySrc.indexOf("Revenue") === -1 && serviceSrc.indexOf("Revenue") === -1 && timeSrc.indexOf("Revenue") === -1 && timeSrc.indexOf("profit") === -1);
check("copy: incomplete and error strings match", summarySrc.indexOf("Sales data for this range is incomplete. Narrow the date range and try again.") !== -1 && serviceSrc.indexOf("Sales data for this range is incomplete. Narrow the date range and try again.") !== -1 && timeSrc.indexOf("Sales data for this range is incomplete. Narrow the date range and try again.") !== -1 && summarySrc.indexOf("This report could not load.") !== -1 && serviceSrc.indexOf("This report could not load.") !== -1 && timeSrc.indexOf("This report could not load.") !== -1);
check("shared item-kind semantic is kind !== product", compute.isServiceItem({ kind: "service" }) === true && compute.isServiceItem({ kind: "product" }) === false && serviceApi.isServiceItem({ kind: "addon" }) === true);

if (failed) process.exit(1);
console.log("All Booking financial reconciliation checks passed.");
