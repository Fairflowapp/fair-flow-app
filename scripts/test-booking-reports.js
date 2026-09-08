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
const ui = read("public/booking/reports/ui.js");
const css = read("public/booking/reports/reports.css");
const html = read("public/index.html");

check("reports is a booking section", state.indexOf("reports: true") !== -1);
check("sidebar has a Reports item", sidebar.indexOf('itemHtml("reports", "Reports"') !== -1);
check("reports sits after clients in the sidebar", /itemHtml\("clients"[\s\S]*itemHtml\("reports", "Reports"/.test(sidebar));
check("shell paints a Reports page", shell.indexOf('data-ff-booking-page="reports"') !== -1);
check("shell refreshes reports", shell.indexOf("ffRefreshBookingReports") !== -1);
check("reports home has a title", ui.indexOf("<h1>Reports</h1>") !== -1);
check("reports home is empty on purpose", ui.indexOf("No reports yet") !== -1);
check("reports ui does not read Firestore", ui.indexOf("getFirestore") === -1 && ui.indexOf("collection(") === -1 && ui.indexOf("getDoc") === -1);
check("reports is not a Mangomint catalog", ui.indexOf("Gift Card") === -1 && ui.indexOf("Membership") === -1 && ui.indexOf("Inventory") === -1 && ui.indexOf("Mango") === -1);
check("reports page fills the workspace", css.indexOf(".ff-booking-page-reports") !== -1);
check("index.html loads the reports screen", html.indexOf("/booking/reports/ui.js") !== -1 && html.indexOf("/booking/reports/reports.css") !== -1);

if (failed) process.exit(1);
console.log("All Booking reports tab checks passed.");
