/**
 * Service duration Hours + Minutes conversion. No Firestore writes.
 * Usage: node scripts/test-booking-service-duration.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "public/tickets-service-duration.js"), "utf8")
  .replace(/^export /gm, "");
const windowObj = {};
new Function("window", src)(windowObj);
const api = windowObj.ffServiceDuration;

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

check("helper loaded", !!api);
check("30 → 0 hr / 30 min", api.splitServiceDurationMinutes(30).hours === 0 && api.splitServiceDurationMinutes(30).minutes === 30);
check("45 → 0 hr / 45 min", api.splitServiceDurationMinutes(45).hours === 0 && api.splitServiceDurationMinutes(45).minutes === 45);
check("60 → 1 hr / 0 min", api.splitServiceDurationMinutes(60).hours === 1 && api.splitServiceDurationMinutes(60).minutes === 0);
check("75 → 1 hr / 15 min", api.splitServiceDurationMinutes(75).hours === 1 && api.splitServiceDurationMinutes(75).minutes === 15);
check("105 → 1 hr / 45 min", api.splitServiceDurationMinutes(105).hours === 1 && api.splitServiceDurationMinutes(105).minutes === 45);
check("120 → 2 hr / 0 min", api.splitServiceDurationMinutes(120).hours === 2 && api.splitServiceDurationMinutes(120).minutes === 0);
check("150 → 2 hr / 30 min", api.splitServiceDurationMinutes(150).hours === 2 && api.splitServiceDurationMinutes(150).minutes === 30);

check("0/30 saves 30", api.joinServiceDurationMinutes(0, 30) === 30);
check("0/45 saves 45", api.joinServiceDurationMinutes(0, 45) === 45);
check("1/0 saves 60", api.joinServiceDurationMinutes(1, 0) === 60);
check("1/15 saves 75", api.joinServiceDurationMinutes(1, 15) === 75);
check("1/45 saves 105", api.joinServiceDurationMinutes(1, 45) === 105);
check("2/0 saves 120", api.joinServiceDurationMinutes(2, 0) === 120);
check("2/30 saves 150", api.joinServiceDurationMinutes(2, 30) === 150);
check("0/0 cannot save", api.joinServiceDurationMinutes(0, 0) === null);

check("30 min label", api.formatServiceDurationLabel(30) === "30 min");
check("45 min label", api.formatServiceDurationLabel(45) === "45 min");
check("1 hr label", api.formatServiceDurationLabel(60) === "1 hr");
check("1 hr 15 min label", api.formatServiceDurationLabel(75) === "1 hr 15 min");
check("1 hr 45 min label", api.formatServiceDurationLabel(105) === "1 hr 45 min");
check("2 hr label", api.formatServiceDurationLabel(120) === "2 hr");
check("2 hr 30 min label", api.formatServiceDurationLabel(150) === "2 hr 30 min");
check("does not show 105 min", api.formatServiceDurationLabel(105).indexOf("105 min") === -1);

const data = fs.readFileSync(path.join(root, "public/tickets-catalog-data.js"), "utf8");
check("save payload still uses durationMinutes", data.includes("payload.durationMinutes"));
check("no durationHours field written", data.indexOf("durationHours") === -1);
check("no durationMinutePart field written", data.indexOf("durationMinutePart") === -1);

if (failed) {
  console.error("FAILED", failed);
  process.exit(1);
}
console.log("All service duration helper tests passed.");
