/**
 * Booking overlap policy. No Firestore.
 * Usage: node scripts/test-booking-overlap-settings.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function load(rel, windowObj) {
  new Function("window", fs.readFileSync(path.join(root, rel), "utf8"))(windowObj);
}

const windowObj = {
  settings: { preferences: { salonTimeZone: "America/New_York" } }
};
load("public/booking/settings/model.js", windowObj);
const model = windowObj.ffBookingSettingsModel;

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

check("model loaded", !!model);
check("default is no overlap", model.allowedMinutes() === 0);
check("unknown value falls back to none", model.normalizeMinutes(12) === 0);
check("15 is a valid choice", model.normalizeMinutes(15) === 15);
check("20 is a valid choice", model.normalizeMinutes(20) === 20);
check("30 is a valid choice", model.normalizeMinutes(30) === 30);

const allenStart = 9 * 60 + 30;
const allenEnd = 10 * 60 + 30;
const shiriStart = 10 * 60 + 15;
const shiriEnd = 11 * 60 + 15;
check("Allen 9:30-10:30 and Shiri 10:15-11:15 overlap 15 minutes", model.overlapMinutes(allenStart, allenEnd, shiriStart, shiriEnd) === 15);
check("15 on 15 is not a conflict", model.isConflictMinutes(allenStart, allenEnd, shiriStart, shiriEnd, 15) === false);
check("15 on 0 is a conflict", model.isConflictMinutes(allenStart, allenEnd, shiriStart, shiriEnd, 0) === true);
check("back-to-back is never a conflict", model.isConflictMinutes(allenStart, allenEnd, allenEnd, allenEnd + 60, 0) === false);

const a0 = new Date("2026-09-05T13:30:00.000Z");
const a1 = new Date("2026-09-05T14:30:00.000Z");
const b0 = new Date("2026-09-05T14:15:00.000Z");
const b1 = new Date("2026-09-05T15:15:00.000Z");
check("date overlap is 15 minutes", model.overlapMs(a0, a1, b0, b1) === 15 * 60000);
check("date 15 on 15 is allowed", model.isConflictDates(a0, a1, b0, b1, 15) === false);
check("date 15 on 0 is blocked", model.isConflictDates(a0, a1, b0, b1, 0) === true);

windowObj.settings.booking = { allowedOverlapMinutes: 20 };
check("reads the salon setting", model.allowedMinutes() === 20);
windowObj.settings.booking = { allowedOverlapMinutes: 99 };
check("invalid salon setting falls back to none", model.allowedMinutes() === 0);

const shell = fs.readFileSync(path.join(root, "public/booking/shell.js"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "public/booking/sidebar.js"), "utf8");
const state = fs.readFileSync(path.join(root, "public/booking/state.js"), "utf8");
check("shell has a settings page", shell.indexOf('data-ff-booking-page="settings"') !== -1);
check("sidebar has Settings", sidebar.indexOf('itemHtml("settings", "Settings"') !== -1);
check("state knows the settings section", state.indexOf("settings: true") !== -1);

if (failed) {
  console.error("FAILED", failed);
  process.exit(1);
}
console.log("All Booking overlap settings checks passed.");
