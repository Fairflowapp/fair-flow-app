/**
 * Local Calendar drop guard. No Firestore writes.
 * Usage: node scripts/test-booking-calendar-drop.js
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
load("public/booking/calendar-availability.js", windowObj);
load("public/booking/calendar-drop.js", windowObj);
load("public/booking/calendar-layout.js", windowObj);
load("public/booking/calendar-drag.js", windowObj);

const drop = windowObj.ffBookingCalDrop;
const drag = windowObj.ffBookingCalDrag;
let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

const axis = {
  startMin: 8 * 60,
  endMin: 19 * 60,
  salonOpen: true,
  salonStartMin: 9 * 60,
  salonEndMin: 18 * 60,
  intervals: [{ startMin: 9 * 60, endMin: 18 * 60 }]
};
const emp = {
  id: "ashley",
  working: [{ startMin: 10 * 60, endMin: 16 * 60 }]
};

function action(startMin, extra) {
  return Object.assign({
    providerId: "ashley",
    startMin: startMin,
    durationMinutes: 60,
    axis: axis,
    employee: emp,
    source: { durationMinutes: 60, fromProviderId: "ashley", fromStartMin: 10 * 60 }
  }, extra || {});
}

check("open bookable time is allowed", drop.inspect(action(10 * 60)).ok === true);
check("late morning on-shift is allowed", drop.inspect(action(14 * 60)).ok === true);

const beforeOpen = drop.inspect(action(8 * 60 + 30));
check("salon-closed drop is rejected", beforeOpen.ok === false && beforeOpen.reason === "salon_closed");
check(
  "salon-closed message is specific",
  beforeOpen.message === drop.MESSAGES.salon_closed
);

const providerOff = drop.inspect(action(9 * 60));
check("provider-off drop is rejected", providerOff.ok === false && providerOff.reason === "provider_off");
check(
  "provider-off message is specific",
  providerOff.message === drop.MESSAGES.provider_off
);

const overlapsOff = drop.inspect(action(15 * 60 + 30));
check("a range that ends after the provider leaves is rejected", overlapsOff.ok === false && overlapsOff.reason === "provider_off");

const afterClose = drop.inspect(action(18 * 60));
check("after salon close is salon_closed", afterClose.ok === false && afterClose.reason === "salon_closed");

const closedDay = drop.inspect(action(11 * 60, {
  axis: Object.assign({}, axis, { salonOpen: false, intervals: [] })
}));
check("closed-day drop is salon_closed", closedDay.ok === false && closedDay.reason === "salon_closed");

check("range overlap is exclusive of touching edges", drop.rangeOverlaps([{ startMin: 10 * 60, endMin: 11 * 60 }], 11 * 60, 12 * 60) === false);
check("range overlap catches interior overlap", drop.rangeOverlaps([{ startMin: 10 * 60, endMin: 12 * 60 }], 11 * 60, 13 * 60) === true);

const blocked = drag.unavailableDrop(action(8 * 60 + 30));
check("drag helper surfaces the local reject", !!(blocked && blocked.reason === "salon_closed"));
check("drag helper allows a valid drop", drag.unavailableDrop(action(11 * 60)) === null);

const dragSrc = fs.readFileSync(path.join(root, "public/booking/calendar-drag.js"), "utf8");
check("applyDrop consults the drop guard before persist", dragSrc.indexOf("unavailableDrop(action)") !== -1);
check("rejected drops restore the original card", dragSrc.indexOf("restoreSource()") !== -1 && dragSrc.indexOf("toastError(blocked.message") !== -1);
check("drop logic lives in calendar-drop.js", dragSrc.indexOf("function inspect") === -1);

const css = fs.readFileSync(path.join(root, "public/booking/calendar.css"), "utf8");
check("salon closed stays solid grey", /\.ff-cal-closed\s*\{[^}]*background:\s*#F5F5F7/.test(css));
check("provider-off uses a distinct wash", /\.ff-cal-off\s*\{[^}]*background-color:\s*#E8E4F0/.test(css));
check("provider-off adds a hatch so it is not the same as closed", /\.ff-cal-off\s*\{[^}]*repeating-linear-gradient/.test(css));
check("open columns stay white", /\.ff-cal-col\s*\{[^}]*background:\s*#FFFFFF/.test(css));

if (failed) {
  console.error(failed + " calendar drop tests failed.");
  process.exit(1);
}
console.log("All calendar drop tests passed.");
