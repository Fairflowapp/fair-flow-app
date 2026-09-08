/**
 * Booking shell switch checks. No Firestore.
 * Usage: node scripts/test-booking-shell.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

let failed = 0;
function check(name, cond) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name);
  }
}

const shell = read("public/booking/shell.js");
const css = read("public/booking/shell.css");

check("entering booking hides operations overlays", shell.indexOf("function hideOpsOverlays") !== -1);
check("staff members is one of the overlays", shell.indexOf('"staffMembersModal"') !== -1);
check("applyArea closes overlays in booking", /if \(inBooking\) hideOpsOverlays\(\)/.test(shell));
check("staff modal is hidden while booking is open", css.indexOf("body.ff-booking-area #staffMembersModal") !== -1);
check("booking workspace stays under LIVE", /z-index:\s*9865/.test(css));
const state = read("public/booking/state.js");
check("sales is a booking section", state.indexOf("sales: true") !== -1);
check("reports is a booking section", state.indexOf("reports: true") !== -1);

if (failed) process.exit(1);
console.log("All Booking shell switch checks passed.");
