"use strict";

/**
 * Prevents the appointment slot helper from going stale when Calendar
 * inserts a Block Time chooser in front of New Appointment.
 * Does not exercise product Block Time quality.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { REPO_ROOT } = require("../helpers/env");

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log("PASS:", name);
  } catch (err) {
    failed += 1;
    console.log("FAIL:", name, err && err.message ? err.message : err);
  }
}

const helperSrc = fs.readFileSync(path.join(REPO_ROOT, "qa/helpers/appointment-ui.js"), "utf8");
const baselineCal = fs.readFileSync(path.join(REPO_ROOT, "public/booking/calendar.js"), "utf8");

check("helper still requires the appointment drawer", () => {
  assert.ok(helperSrc.indexOf("#ffBookingApptDrawer") !== -1);
  assert.ok(helperSrc.indexOf("New Appointment") !== -1);
});

check("helper recognizes the committed Block Time chooser", () => {
  assert.ok(helperSrc.indexOf("#ffBookingCalSlotChooser") !== -1);
  assert.ok(helperSrc.indexOf('[data-ff-cal-slot="appointment"]') !== -1);
});

check("chooser path clicks New Appointment, never Block Time", () => {
  assert.ok(helperSrc.indexOf('data-ff-cal-slot="appointment"') !== -1);
  assert.ok(helperSrc.indexOf('data-ff-cal-slot="block"') === -1);
});

check("helper stays a real browser click path", () => {
  assert.ok(helperSrc.indexOf("page.mouse.click") !== -1);
  assert.ok(!/openAppointmentFromHit|ffBookingCalBlockUi|ffBookingBlockEditor|offerSlotCreate/.test(helperSrc));
});

check("c2ba63e-style calendar in this harness still opens the drawer directly", () => {
  assert.ok(baselineCal.indexOf("openAppointmentFromHit(rememberSlot") !== -1);
  assert.ok(baselineCal.indexOf("offerSlotCreate") === -1);
  assert.ok(baselineCal.indexOf("ffBookingCalSlotChooser") === -1);
});

if (failed) {
  console.error(failed + " slot-create helper checks failed.");
  process.exit(1);
}
console.log("All slot-create helper checks passed.");
