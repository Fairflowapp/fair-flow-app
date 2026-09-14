/**
 * Presentation-only insight ranking. Usage:
 * node scripts/test-booking-reports-insight-priority.js
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
load("public/booking/reports/insight-priority.js", windowObj);
const api = windowObj.ffBookingReportsInsightPriority;

const raw = [
  "4 provider hours were left as calendar gaps this week.",
  "2 provider hours were left in calendar gaps of 30 minutes or less.",
  "Anna had the most calendar gap time this week: 2 hours across 1 gap.",
  "Anna was the most utilized provider at 80%.",
  "12.5% of working capacity was left unused because of calendar gaps.",
  "Most calendar gap time occurred between 1 PM and 4 PM.",
  "Tuesday had the lowest utilization in this period at 48%.",
  "Tuesday had 4.3 provider hours of calendar gaps.",
  "Gel Manicure had the highest booked service demand at 12 provider hours.",
  "Gel Manicure represented 40% of booked service time this period.",
  "58% of provider-assigned service lines were requested-provider bookings.",
  "41% of service lines were requested for a specific provider.",
  "32% of identified clients had multiple appointments this period."
];
const shown = api.presentInsights(raw);
check("keeps high-value gap and utilization insights", shown.indexOf(raw[0]) !== -1 && shown.indexOf(raw[6]) !== -1);
check("drops unused-percent when total gap hours already appear", shown.indexOf(raw[4]) === -1);
check("drops service-mix when demand insight already appears", shown.indexOf(raw[8]) !== -1 && shown.indexOf(raw[9]) === -1);
const shownWide = api.presentInsights(raw, 12);
check("drops requested-line insight when requested-provider insight exists", shownWide.indexOf(raw[10]) !== -1 && shownWide.indexOf(raw[11]) === -1);
check("limits weekday capacity sentences", shown.filter(function (line) {
  return line.indexOf("Tuesday") !== -1;
}).length <= 2);
check("does not dump the full raw list", shown.length <= api.DISPLAY_LIMIT && shown.length < raw.length);

const empty = api.presentInsights(["No appointments were found this week.", "Providers were scheduled for 8 provider hours with no booked appointments."]);
check("empty-state insights stay first", empty[0].indexOf("No appointments were found") !== -1);

const uiSrc = fs.readFileSync(path.join(root, "public/booking/reports/intelligence.js"), "utf8");
check("ui uses presentation ranking instead of dumping all insights", uiSrc.indexOf("presentInsights") !== -1);
check("overview is the first owner section", uiSrc.indexOf("overviewHtml(result)") !== -1 && uiSrc.indexOf("function requestedHtml") === -1);

if (failed) process.exit(1);
console.log("All Booking insight priority checks passed.");
