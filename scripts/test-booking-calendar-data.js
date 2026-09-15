/**
 * Calendar staff display-name helpers. No Firestore writes.
 * Usage: node scripts/test-booking-calendar-data.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function load(rel, windowObj) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  new Function("window", src)(windowObj);
}

const windowObj = {};
load("public/booking/calendar-data.js", windowObj);

const data = windowObj.ffBookingCalData;
let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

check("displayNameOf uses the stored full name", data.displayNameOf({
  name: "Ashley Rivera",
  firstName: "Ashley"
}) === "Ashley Rivera");
check("displayNameOf joins first and last when name is missing", data.displayNameOf({
  firstName: "Nicole",
  lastName: "Chen"
}) === "Nicole Chen");
check("displayNameOf prefers name over first+last", data.displayNameOf({
  name: "Ashley Rivera",
  firstName: "Ash",
  lastName: "R"
}) === "Ashley Rivera");
check("displayNameOf accepts displayName", data.displayNameOf({
  displayName: "Bobo Martinez"
}) === "Bobo Martinez");
check("displayNameOf falls back to Staff", data.displayNameOf({}) === "Staff");
check("firstNameOf still returns the first token", data.firstNameOf({
  name: "Ashley Rivera"
}) === "Ashley");
check("firstNameOf uses the joined last name when needed", data.firstNameOf({
  firstName: "Nicole",
  lastName: "Chen"
}) === "Nicole");

const dataSrc = fs.readFileSync(path.join(root, "public/booking/calendar-data.js"), "utf8");
check("calendar employees store displayName", dataSrc.indexOf("displayName: displayNameOf(staff)") !== -1);
check("calendar employees store name as the full display name", dataSrc.indexOf("name: displayNameOf(staff)") !== -1);

const calSrc = fs.readFileSync(path.join(root, "public/booking/calendar.js"), "utf8");
check("header label uses the full display name", calSrc.indexOf("escapeHtml(displayName)") !== -1 && calSrc.indexOf("providerDisplayName") !== -1);
check("header no longer labels columns with firstName only", calSrc.indexOf("ff-cal-emp-label\">' + escapeHtml(firstName)") === -1);
check("circular avatar helper is unchanged", calSrc.indexOf("ff-cal-emp-avatar") !== -1 && calSrc.indexOf("ff-cal-emp-avatar-fallback") !== -1);

if (failed) {
  console.error(failed + " calendar data tests failed.");
  process.exit(1);
}
console.log("All calendar data tests passed.");
