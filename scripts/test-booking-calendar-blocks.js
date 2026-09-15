/**
 * Calendar blocked-time foundation. No Firestore writes.
 * Usage: node scripts/test-booking-calendar-blocks.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function load(rel, windowObj) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  new Function("window", "document", src)(windowObj, {
    readyState: "complete",
    documentElement: {},
    body: {},
    addEventListener: function () {},
    getElementById: function () { return null; },
    querySelector: function () { return null; }
  });
}

const weekly = {
  sunday: { isOpen: false },
  monday: { isOpen: true, openTime: "09:00", closeTime: "18:00" },
  tuesday: { isOpen: true, openTime: "09:00", closeTime: "18:00" },
  wednesday: { isOpen: true, openTime: "09:00", closeTime: "18:00" },
  thursday: { isOpen: true, openTime: "09:00", closeTime: "18:00" },
  friday: { isOpen: true, openTime: "09:00", closeTime: "18:00" },
  saturday: { isOpen: true, openTime: "09:00", closeTime: "18:00" }
};

const windowObj = {
  addEventListener: function () {},
  settings: {
    businessHours: weekly,
    specialBusinessDays: {
      "2026-12-25": { isClosed: true, note: "Christmas" }
    }
  },
  ffGetStaffStore: function () {
    return {
      staff: [{
        id: "ashley",
        name: "Ashley Rivera",
        technicianTypes: ["nails"],
        defaultSchedule: {
          thursday: { enabled: true, startTime: "10:00", endTime: "16:00" },
          friday: { enabled: true, startTime: "10:00", endTime: "16:00" }
        }
      }]
    };
  }
};

load("public/booking/calendar-time.js", windowObj);
load("public/booking/availability.js", windowObj);
load("public/booking/calendar-data.js", windowObj);
load("public/booking/calendar-blocks.js", windowObj);
load("public/booking/calendar-availability.js", windowObj);
load("public/booking/calendar-drop.js", windowObj);
load("public/booking/calendar-layout.js", windowObj);

const blocks = windowObj.ffBookingCalBlocks;
const data = windowObj.ffBookingCalData;
const av = windowObj.ffBookingCalAvailability;
const drop = windowObj.ffBookingCalDrop;
const engine = windowObj.ffBookingAvailability;
const layout = windowObj.ffBookingCalLayout;

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

const lunch = blocks.normalize({
  providerId: "ashley",
  locationId: "loc1",
  dateKey: "2026-12-17",
  startMin: 12 * 60,
  endMin: 13 * 60,
  reason: "lunch",
  label: "Lunch"
});
check("normalize keeps a lunch block during working hours", !!(lunch && lunch.reason === "lunch" && lunch.label === "Lunch"));
check("normalize rejects a missing location", blocks.normalize({
  providerId: "ashley",
  dateKey: "2026-12-17",
  startMin: 12 * 60,
  endMin: 13 * 60
}) === null);

blocks.setAll([
  lunch,
  {
    providerId: "nicole",
    locationId: "loc1",
    dateKey: "2026-12-17",
    startMin: 12 * 60,
    endMin: 12 * 60 + 30,
    reason: "meeting"
  },
  {
    providerId: "ashley",
    locationId: "loc2",
    dateKey: "2026-12-17",
    startMin: 12 * 60,
    endMin: 13 * 60,
    reason: "personal",
    label: "Personal"
  }
]);

check("block renders only for the matching provider", blocks.forProvider("2026-12-17", "loc1", "ashley").length === 1);
check("other provider on the same day does not receive Ashley's block", blocks.forProvider("2026-12-17", "loc1", "koko").length === 0);
check("block respects location", blocks.forProvider("2026-12-17", "loc2", "ashley")[0].label === "Personal");
check("same provider at another location is not this calendar's block", blocks.forView("2026-12-17", "loc1").every(function (row) {
  return row.locationId === "loc1";
}));

const day = data.businessDayFor("2026-12-17", "loc1");
const axis = data.axisFromDay(day);
const emp = { id: "ashley", working: [{ startMin: 10 * 60, endMin: 16 * 60 }] };
const regions = av.unavailableForProvider(emp, axis);

check(
  "blocked window sits inside otherwise bookable time",
  regions.blocked.length === 1 && regions.blocked[0].startMin === 12 * 60 && regions.blocked[0].endMin === 13 * 60
);
check(
  "blocked time is not painted as provider-off",
  !regions.off.some(function (win) { return win.startMin <= 12 * 60 && win.endMin > 12 * 60; })
);
check(
  "blocked time is not painted as salon-closed",
  !regions.closed.some(function (win) { return win.startMin <= 12 * 60 && win.endMin > 12 * 60; })
);
check("reasonAt at lunch is provider_blocked", av.reasonAt(emp, axis, 12 * 60) === "provider_blocked");
check("reasonAt at 11:00 stays available", av.reasonAt(emp, axis, 11 * 60) === "available");

function inspectAt(startMin, durationMinutes, extra) {
  return drop.inspect(Object.assign({
    providerId: "ashley",
    startMin: startMin,
    durationMinutes: durationMinutes || 60,
    axis: axis,
    employee: emp
  }, extra || {}));
}

check("create overlapping a block is rejected", drop.inspectCreate({
  providerId: "ashley",
  startMin: 12 * 60,
  axis: axis,
  employee: emp
}).reason === "provider_blocked");
check("drag overlapping a block is rejected", inspectAt(12 * 60 + 15, 30).reason === "provider_blocked");
check("adjacent appointment before a block stays valid", inspectAt(11 * 60, 60).ok === true);
check("adjacent appointment after a block stays valid", inspectAt(13 * 60, 60).ok === true);
check("create on another provider ignores Ashley's lunch", drop.inspectCreate({
  providerId: "koko",
  startMin: 12 * 60,
  axis: axis,
  employee: { id: "koko", working: [{ startMin: 10 * 60, endMin: 16 * 60 }] }
}).ok === true);

const nicoleAxis = data.axisFromDay(data.businessDayFor("2026-12-17", "loc2"));
check("Ashley lunch at loc1 does not block loc2 create at 11:00", drop.inspectCreate({
  providerId: "ashley",
  startMin: 11 * 60,
  axis: nicoleAxis,
  employee: emp
}).ok === true);
check("Ashley personal block at loc2 still rejects loc2 lunch hour", drop.inspectCreate({
  providerId: "ashley",
  startMin: 12 * 60,
  axis: nicoleAxis,
  employee: emp
}).reason === "provider_blocked");

check(
  "engine create fit rejects a visit overlapping a block",
  engine.canProviderFitDuration("ashley", { dateKey: "2026-12-17", minutes: 12 * 60 }, 60, "loc1") === false
);
check(
  "engine create fit allows the adjacent 11:00 hour",
  engine.canProviderFitDuration("ashley", { dateKey: "2026-12-17", minutes: 11 * 60 }, 60, "loc1") === true
);

const closedDay = data.axisFromDay(data.businessDayFor("2026-12-25", "loc1"));
check(
  "special closed day still wins over a block on that date",
  drop.inspect({
    providerId: "ashley",
    startMin: 11 * 60,
    durationMinutes: 60,
    axis: closedDay,
    employee: emp
  }).reason === "salon_closed"
);
check("provider-off at 9:00 is still provider_off", inspectAt(9 * 60).reason === "provider_off");
check("weekly closed 8:30 is still salon_closed", inspectAt(8 * 60 + 30).reason === "salon_closed");

const markup = blocks.blockHtml(lunch, layout.windowToRect(12 * 60, 13 * 60, 8 * 60, 19 * 60));
check("block markup is not an appointment card", markup.indexOf("ff-cal-card") === -1 && markup.indexOf("ff-cal-block") !== -1);
check("block markup shows the reason label", markup.indexOf("Lunch") !== -1 && markup.indexOf("data-ff-cal-block-reason=\"lunch\"") !== -1);

const css = fs.readFileSync(path.join(root, "public/booking/calendar.css"), "utf8");
check("block style is dashed, not an appointment fill", /\.ff-cal-block\s*\{[^}]*dashed/.test(css));
check("block style is not the provider-off hatch", !/\.ff-cal-block\s*\{[^}]*repeating-linear-gradient/.test(css));
check("salon closed grey is unchanged", /\.ff-cal-closed\s*\{[^}]*background:\s*#F5F5F7/.test(css));

const menuSrc = fs.readFileSync(path.join(root, "public/booking/calendar-menu.js"), "utf8");
check("Block time menu is enabled", /id:\s*"block"[\s\S]*?enabled:\s*true/.test(menuSrc));
check("Mark unavailable today stays later", menuSrc.indexOf("Mark unavailable today") !== -1 && menuSrc.indexOf("Coming later") !== -1);

if (failed) {
  console.error(failed + " calendar blocked-time tests failed.");
  process.exit(1);
}
console.log("All calendar blocked-time tests passed.");
