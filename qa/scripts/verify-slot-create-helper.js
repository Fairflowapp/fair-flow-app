"use strict";

/**
 * Prevents the appointment slot helper from going stale when Calendar
 * inserts a Block Time chooser in front of New Appointment.
 * Does not exercise product Block Time quality.
 *
 * Current Calendar (after c2ba63e):
 *   slot click -> offerSlotCreate(rememberSlot) -> chooser -> New Appointment
 *   -> openAppointmentFromHit
 * c2ba63e baseline:
 *   slot click -> openAppointmentFromHit(rememberSlot) -> drawer
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { appRoot } = require("../helpers/env");

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

const productRoot = appRoot();
const helperSrc = fs.readFileSync(path.join(__dirname, "../helpers/appointment-ui.js"), "utf8");
const calSrc = fs.readFileSync(path.join(productRoot, "public/booking/calendar.js"), "utf8");
const blocksUiPath = path.join(productRoot, "public/booking/blocks/ui.js");
const blocksUiSrc = fs.existsSync(blocksUiPath) ? fs.readFileSync(blocksUiPath, "utf8") : "";

const usesChooserEntry = /offerSlotCreate\(\s*remember(?:Week)?Slot\b/.test(calSrc);
const usesDirectDrawer = /openAppointmentFromHit\(\s*rememberSlot\b/.test(calSrc);

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

check("product slot click still reaches appointment create", () => {
  assert.ok(
    usesChooserEntry || usesDirectDrawer,
    "expected offerSlotCreate(rememberSlot) or openAppointmentFromHit(rememberSlot)"
  );
});

check("current Calendar chooser remains the New Appointment path", () => {
  if (!usesChooserEntry) {
    assert.ok(usesDirectDrawer, "baseline calendar must open the drawer from the slot click");
    return;
  }
  assert.ok(blocksUiSrc.indexOf("ffBookingCalSlotChooser") !== -1);
  assert.ok(blocksUiSrc.indexOf('data-ff-cal-slot="appointment"') !== -1);
  assert.ok(/openAppointmentFromHit\s*\(/.test(blocksUiSrc) || /openAppointmentFromHit\s*\(/.test(calSrc));
  assert.ok(helperSrc.indexOf('#ffBookingCalSlotChooser [data-ff-cal-slot="appointment"]') !== -1);
});

if (failed) {
  console.error(failed + " slot-create helper checks failed.");
  process.exit(1);
}
console.log("All slot-create helper checks passed.");
