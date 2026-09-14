/**
 * Booking Reports tab wiring. No Firestore.
 * Usage: node scripts/test-booking-reports.js
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

const state = read("public/booking/state.js");
const sidebar = read("public/booking/sidebar.js");
const shell = read("public/booking/shell.js");
const navSrc = read("public/booking/reports/nav.js");
const ui = read("public/booking/reports/ui.js");
const css = read("public/booking/reports/reports.css");
const html = read("public/index.html");

check("reports is a booking section", state.indexOf("reports: true") !== -1);
check("sidebar has a Reports item", sidebar.indexOf('itemHtml("reports", "Reports"') !== -1);
check("reports sits after clients in the sidebar", /itemHtml\("clients"[\s\S]*itemHtml\("reports", "Reports"/.test(sidebar));
check("shell paints a Reports page", shell.indexOf('data-ff-booking-page="reports"') !== -1);
check("shell refreshes reports", shell.indexOf("ffRefreshBookingReports") !== -1);
check("reports has a Sales group", navSrc.indexOf('label: "Sales"') !== -1);
check("reports has an Intelligence group", navSrc.indexOf('label: "Intelligence"') !== -1 && navSrc.indexOf('id: "booking-intelligence"') !== -1);
check("reports has a Clients group with Cancellations and Client Retention", navSrc.indexOf('id: "clients"') !== -1 && navSrc.indexOf('label: "Clients"') !== -1 && navSrc.indexOf('id: "cancellations"') !== -1 && navSrc.indexOf('id: "client-retention"') !== -1);
check("sales summary remains a report", navSrc.indexOf('id: "sales-summary"') !== -1);
check("sales tabs include service and period only", navSrc.indexOf("service-sales") !== -1 && navSrc.indexOf("sales-by-period") !== -1 && navSrc.indexOf("product-sales") === -1);
check("booking intelligence is the default report", navSrc.indexOf('DEFAULT_ID = "booking-intelligence"') !== -1);
check("reports ui paints the inner sales nav", ui.indexOf("ff-rpt-nav") !== -1 && ui.indexOf("data-ff-rpt") !== -1);
check("reports ui can paint booking intelligence", ui.indexOf("booking-intelligence") !== -1 && ui.indexOf("ffBookingReportsIntelligence") !== -1);
check("reports ui loads isolated intelligence modules", ui.indexOf("/booking/reports/intelligence-compute.js") !== -1 && ui.indexOf("/booking/reports/capacity-patterns.js") !== -1 && ui.indexOf("/booking/reports/service-demand.js") !== -1 && ui.indexOf("/booking/reports/client-behavior.js") !== -1 && ui.indexOf("/booking/reports/insight-priority.js") !== -1 && ui.indexOf("/booking/reports/intelligence.js") !== -1);
check("reports ui loads service sales modules", ui.indexOf("/booking/reports/service-sales-compute.js") !== -1 && ui.indexOf("/booking/reports/service-sales.js") !== -1);
check("reports ui loads sales by time period modules", ui.indexOf("/booking/reports/sales-time-compute.js") !== -1 && ui.indexOf("/booking/reports/sales-time.js") !== -1);
check("reports ui loads cancellations modules", ui.indexOf("/booking/reports/cancellations-compute.js") !== -1 && ui.indexOf("/booking/reports/cancellations.js") !== -1);
check("reports ui loads appointment range helper", ui.indexOf("/booking/reports/appointment-range.js") !== -1);
check("reports ui loads forward outlook modules", ui.indexOf("/booking/reports/forward-outlook-compute.js") !== -1 && ui.indexOf("/booking/reports/forward-outlook.js") !== -1);
check("reports ui loads client retention modules", ui.indexOf("/booking/reports/client-retention-compute.js") !== -1 && ui.indexOf("/booking/reports/client-retention.js") !== -1);
check("reports ui does not read Firestore", ui.indexOf("getFirestore") === -1 && ui.indexOf("collection(") === -1 && ui.indexOf("getDoc") === -1);
check("reports is not a Mangomint catalog", navSrc.indexOf("Gift Card") === -1 && navSrc.indexOf("Membership") === -1 && navSrc.indexOf("Inventory") === -1 && navSrc.indexOf("Mango") === -1);
check("reports page fills the workspace", css.indexOf(".ff-booking-page-reports") !== -1);
check("index.html loads reports nav and sales summary", html.indexOf("/booking/reports/nav.js") !== -1 && html.indexOf("/booking/reports/sales-summary.js") !== -1 && html.indexOf("/booking/reports/ui.js") !== -1);
check("index.html loads sales range retrieval", html.indexOf("/booking/reports/sales-range.js") !== -1);
check("index.html loads appointment range retrieval", html.indexOf("/booking/reports/appointment-range.js") !== -1);
check("index.html is not required for intelligence scripts", html.indexOf("/booking/reports/intelligence.js") === -1);

const store = {};
const windowObj = {
  sessionStorage: {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setItem: function (key, value) { store[key] = String(value); }
  }
};
load("public/booking/reports/nav.js", windowObj);
load("public/booking/reports/compute.js", windowObj);
const nav = windowObj.ffBookingReportsNav;
const compute = windowObj.ffBookingReportsCompute;
check("nav defaults to booking intelligence", nav.getSelectedId() === "booking-intelligence");
check("nav can still open sales summary", nav.setSelectedId("sales-summary") === "sales-summary" && nav.getSelected().label === "Sales Summary");
check("nav can select booking intelligence", nav.setSelectedId("booking-intelligence") === "booking-intelligence" && nav.getSelected().label === "Booking Intelligence");
check("nav can select service sales", nav.setSelectedId("service-sales") === "service-sales" && nav.getSelected().label === "Service Sales");
check("nav can select sales by time period", nav.setSelectedId("sales-by-period") === "sales-by-period" && nav.getSelected().blurb.indexOf("sale date") !== -1);
check("service sales is no longer a placeholder blurb only", nav.find("service-sales").blurb.indexOf("closed checkout") !== -1);
check("sales summary blurb is overall checkout sales", nav.find("sales-summary").blurb.indexOf("Overall closed checkout sales") !== -1);
check("product sales is not a visible report", nav.find("product-sales") == null);
check("stale product-sales selection falls back to intelligence", nav.setSelectedId("product-sales") === "booking-intelligence");
const salesIds = nav.GROUPS.find(function (group) { return group.id === "sales"; }).items.map(function (row) { return row.id; });
check("visible sales nav is summary, service, time", salesIds.join(",") === "sales-summary,service-sales,sales-by-period");
check("nav can select cancellations", nav.setSelectedId("cancellations") === "cancellations" && nav.getSelected().label === "Cancellations");
check("nav can select client retention", nav.setSelectedId("client-retention") === "client-retention" && nav.getSelected().label === "Client Retention");
check("nav can select forward outlook", nav.setSelectedId("forward-outlook") === "forward-outlook" && nav.getSelected().label === "Forward Outlook");
const intelIds = nav.GROUPS.find(function (group) { return group.id === "intelligence"; }).items.map(function (row) { return row.id; });
check("intelligence nav is historical plus outlook", intelIds.join(",") === "booking-intelligence,forward-outlook");
const clientIds = nav.GROUPS.find(function (group) { return group.id === "clients"; }).items.map(function (row) { return row.id; });
check("clients nav is cancellations and retention", clientIds.join(",") === "cancellations,client-retention");
check("visible reports are built surfaces only", nav.items().map(function (row) { return row.id; }).join(",") === "booking-intelligence,forward-outlook,sales-summary,service-sales,sales-by-period,cancellations,client-retention");
const summary = compute.summarize([
  { status: "closed", locationId: "a", dateKey: "2026-09-10", items: [{ kind: "service" }, { kind: "service" }], subtotal: 50, tip: 5, total: 55 },
  { status: "closed", locationId: "a", dateKey: "2026-09-10", items: [{ kind: "service" }], subtotal: 20, tip: 0, total: 20 },
  { status: "void", locationId: "a", dateKey: "2026-09-10", items: [{ kind: "service" }], subtotal: 10, tip: 0, total: 10 }
], { fromKey: "2026-09-10", toKey: "2026-09-10", locationId: "a" });
check("summary groups one day", summary.days.length === 1 && summary.days[0].sales === 2 && summary.days[0].services === 3);
check("summary uses service sales not a product catalog", summary.totals.serviceSales === 70 && summary.totals.tip === 5);
check("summary skips void sales", summary.totals.total === 75);
const openSale = compute.summarize([
  { status: "open", locationId: "a", dateKey: "2026-09-10", items: [{ kind: "service", amount: 40 }], total: 40 }
], { fromKey: "2026-09-10", toKey: "2026-09-10" });
check("summary skips open sales", openSale.days.length === 0);
const mixed = compute.summarize([
  { status: "closed", locationId: "a", dateKey: "2026-09-10", items: [{ kind: "service", amount: 30 }, { kind: "product", amount: 9 }], tip: 0, total: 39 }
], { fromKey: "2026-09-10", toKey: "2026-09-10" });
check("summary counts only service items as service sales", mixed.days[0].services === 1 && mixed.days[0].serviceSales === 30);
check("summary keeps product columns ready", mixed.days[0].products === 1 && mixed.days[0].productSales === 9 && mixed.days[0].subtotal === 39);
const refunded = compute.summarize([
  { status: "closed", locationId: "a", dateKey: "2026-09-10", items: [{ kind: "service", amount: 40 }], tip: 0, history: [{ type: "refunded", amount: 10 }] }
], { fromKey: "2026-09-10", toKey: "2026-09-10" });
check("summary subtracts refunds from adjusted total", refunded.days[0].grossTotal === 40 && refunded.days[0].refunds === 10 && refunded.days[0].adjustedTotal === 30);
const week = compute.rangeForPreset("this_week", "2026-09-10");
check("this week is Monday to Sunday", week.fromKey === "2026-09-07" && week.toKey === "2026-09-13");
const lastWeek = compute.rangeForPreset("last_week", "2026-09-10");
check("last week is the previous Monday to Sunday", lastWeek.fromKey === "2026-08-31" && lastWeek.toKey === "2026-09-06");
const lastTwo = compute.rangeForPreset("last_two_weeks", "2026-09-10");
check("last two weeks are the two full weeks before this week", lastTwo.fromKey === "2026-08-24" && lastTwo.toKey === "2026-09-06");
const aug = compute.rangeForPreset("month:2026-08", "2026-09-10");
check("August 2026 is the full month", aug.fromKey === "2026-08-01" && aug.toKey === "2026-08-31");
const presets = compute.datePresets("2026-09-10");
check("date list has today with the calendar date", presets[0].label === "Today (Sep 10)");
check("date list includes last two weeks and custom", presets.some(function (row) { return row.value === "last_two_weeks"; }) && presets.some(function (row) { return row.value === "custom"; }));
check("date list includes named months", presets.some(function (row) { return row.value === "month:2026-09"; }));
const twoLoc = compute.summarize([
  { status: "closed", locationId: "a", dateKey: "2026-09-10", items: [{ kind: "service" }], subtotal: 10, tip: 0, total: 10 },
  { status: "closed", locationId: "b", dateKey: "2026-09-10", items: [{ kind: "service" }], subtotal: 20, tip: 0, total: 20 }
], { fromKey: "2026-09-10", toKey: "2026-09-10", locationIds: ["b"] });
check("summary can keep one of two locations", twoLoc.days.length === 1 && twoLoc.totals.total === 20);

const summarySrc = read("public/booking/reports/sales-summary.js");
check("location row is a clickable label", summarySrc.indexOf('data-ff-rpt-loc="') !== -1 && summarySrc.indexOf("toggleLocation") !== -1);
check("empty location list does not lock the picker", summarySrc.indexOf("if (all.length) filters.locationIds = all") !== -1);
check("open location menu stacks above the report", css.indexOf(".ff-rpt-dd.is-open") !== -1 && css.indexOf("z-index: 6") !== -1);
check("sales summary shows checkout fields we have", summarySrc.indexOf("Closed tickets") !== -1 && summarySrc.indexOf("Gross service sales") !== -1 && summarySrc.indexOf("Tips") !== -1);
check("sales summary keeps later columns", summarySrc.indexOf("Product Sales") !== -1 && summarySrc.indexOf("Custom Fees") !== -1 && summarySrc.indexOf("Taxes") !== -1 && summarySrc.indexOf("Refunded amount") !== -1 && summarySrc.indexOf("Adjusted sales") !== -1);
check("sales summary uses shared financial terms", summarySrc.indexOf("Gross checkout sales") !== -1 && summarySrc.indexOf("Revenue") === -1);
check("sales summary uses ownerView isolation", summarySrc.indexOf("ownerView") !== -1);
check("sales summary does not add gift cards or memberships", summarySrc.indexOf("Gift Card") === -1 && summarySrc.indexOf("Membership") === -1);
check("sales summary names the location and period", summarySrc.indexOf("Location(s):") !== -1 && summarySrc.indexOf("Period:") !== -1);
check("sales summary uses range-complete retrieval", summarySrc.indexOf("fetchForReport") !== -1 && summarySrc.indexOf("listForSalon") === -1 && summarySrc.indexOf("limit: 80") === -1);
check("sales summary refuses incomplete totals", summarySrc.indexOf('status === "incomplete"') !== -1 && summarySrc.indexOf("ff-rpt-warn") !== -1 && css.indexOf(".ff-rpt-warn") !== -1);
check("sales reports isolate async generate", summarySrc.indexOf("loadGen") !== -1 && summarySrc.indexOf("shouldPaintReportResult") !== -1);

if (failed) process.exit(1);
console.log("All Booking reports tab checks passed.");
