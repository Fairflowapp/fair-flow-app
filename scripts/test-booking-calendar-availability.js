/**
 * Calendar special-day hours and unavailable-time correctness.
 * Usage: node scripts/test-booking-calendar-availability.js
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
      "2026-12-25": { isClosed: true, note: "Christmas" },
      "2026-12-24": { isClosed: false, openTime: "10:00", closeTime: "14:00", note: "Christmas Eve" }
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
load("public/booking/calendar-availability.js", windowObj);
load("public/booking/calendar-drop.js", windowObj);
load("public/booking/calendar.js", windowObj);

const engine = windowObj.ffBookingAvailability;
const data = windowObj.ffBookingCalData;
const av = windowObj.ffBookingCalAvailability;
const drop = windowObj.ffBookingCalDrop;
const create = windowObj.ffBookingCalendarCreate;

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

const regular = data.businessDayFor("2026-12-17", "loc1");
check("regular Thursday follows weekly 9–6", regular.isOpen === true && regular.salonStartMin === 9 * 60 && regular.salonEndMin === 18 * 60);
check("regular day source is business_hours", regular.source === "business_hours");

const specialClosed = data.businessDayFor("2026-12-25", "loc1");
check("special closed day is not open", specialClosed.isOpen === false && specialClosed.source === "special_day_closed");
check("special closed day keeps the note", specialClosed.note === "Christmas");
check("special closed banner uses the note", data.dayStatusLabel(specialClosed) === "Christmas");

const specialHours = data.businessDayFor("2026-12-24", "loc1");
check("special opening hours replace weekly hours", specialHours.isOpen === true && specialHours.source === "special_day_hours");
check("special hours are 10–2", specialHours.salonStartMin === 10 * 60 && specialHours.salonEndMin === 14 * 60);
check("special hours banner uses the note", data.dayStatusLabel(specialHours) === "Christmas Eve");
check("regular closed Sunday still says Salon closed", data.dayStatusLabel({
  isOpen: false,
  source: "business_hours"
}) === "Salon closed");

const regularAxis = data.axisFromDay(regular);
const specialHoursAxis = data.axisFromDay(specialHours);
const specialClosedAxis = data.axisFromDay(specialClosed);
const emp = { id: "ashley", working: [{ startMin: 10 * 60, endMin: 16 * 60 }] };

const regularRegions = av.unavailableForProvider(emp, regularAxis);
check(
  "location-closed bands stay grey on a normal day",
  regularRegions.closed.some(function (win) { return win.startMin === 8 * 60 && win.endMin === 9 * 60; }) &&
    regularRegions.closed.some(function (win) { return win.startMin === 18 * 60 && win.endMin === 19 * 60; })
);
check(
  "provider-off is inside open hours, not the closed bands",
  regularRegions.off.some(function (win) { return win.startMin === 9 * 60 && win.endMin === 10 * 60; }) &&
    regularRegions.off.some(function (win) { return win.startMin === 16 * 60 && win.endMin === 18 * 60; }) &&
    !regularRegions.off.some(function (win) { return win.startMin < 9 * 60; })
);
check(
  "open bookable time has no overlay",
  !regularRegions.closed.some(function (win) { return win.startMin <= 11 * 60 && win.endMin > 11 * 60; }) &&
    !regularRegions.off.some(function (win) { return win.startMin <= 11 * 60 && win.endMin > 11 * 60; })
);

const specialHourRegions = av.unavailableForProvider(emp, specialHoursAxis);
check(
  "special hours grey the weekly morning that is now closed",
  specialHourRegions.closed.some(function (win) { return win.startMin === 9 * 60 && win.endMin === 10 * 60; })
);
check(
  "special hours keep 11:00 white for an on-shift provider",
  !specialHourRegions.closed.some(function (win) { return win.startMin <= 11 * 60 && win.endMin > 11 * 60; }) &&
    !specialHourRegions.off.some(function (win) { return win.startMin <= 11 * 60 && win.endMin > 11 * 60; })
);

const closedRegions = av.unavailableForProvider(emp, specialClosedAxis);
check(
  "special closed day is all salon-closed, not provider-off hatch",
  closedRegions.closed.length === 1 &&
    closedRegions.closed[0].startMin === specialClosedAxis.startMin &&
    closedRegions.closed[0].endMin === specialClosedAxis.endMin &&
    closedRegions.off.length === 0
);

function inspectAt(axis, startMin, durationMinutes) {
  return drop.inspect({
    providerId: "ashley",
    startMin: startMin,
    durationMinutes: durationMinutes || 60,
    axis: axis,
    employee: emp
  });
}

check("drag into weekly closed is salon_closed", inspectAt(regularAxis, 8 * 60 + 30).reason === "salon_closed");
check("drag into provider-off while location is open is provider_off", inspectAt(regularAxis, 9 * 60).reason === "provider_off");
check("drag into open + working time is allowed", inspectAt(regularAxis, 11 * 60).ok === true);
check("drag into special-hours morning is salon_closed", inspectAt(specialHoursAxis, 9 * 60).reason === "salon_closed");
check("drag during special opening hours is allowed", inspectAt(specialHoursAxis, 11 * 60).ok === true);
check("drag after special close is salon_closed", inspectAt(specialHoursAxis, 14 * 60).reason === "salon_closed");
check("drag on a special closed day is salon_closed", inspectAt(specialClosedAxis, 11 * 60).reason === "salon_closed");

const createBlocked = drop.inspectCreate({
  providerId: "ashley",
  startMin: 9 * 60,
  axis: regularAxis,
  employee: emp
});
check("create inspect rejects provider-off", createBlocked.ok === false && createBlocked.reason === "provider_off");
check("create inspect allows a 30-minute hold on shift", drop.inspectCreate({
  providerId: "ashley",
  startMin: 11 * 60,
  axis: regularAxis,
  employee: emp
}).ok === true);
check("create inspect rejects a special closed day", drop.inspectCreate({
  providerId: "ashley",
  startMin: 11 * 60,
  axis: specialClosedAxis,
  employee: emp
}).reason === "salon_closed");

const hitOff = {
  slot: { providerId: "ashley", startMin: 9 * 60 },
  axis: regularAxis
};
const hitOk = {
  slot: { providerId: "ashley", startMin: 11 * 60 },
  axis: regularAxis
};
check("calendar create gate blocks unavailable time", !!(create.blockedCreate(hitOff, emp) && create.blockedCreate(hitOff, emp).reason === "provider_off"));
check("calendar create gate allows bookable time", create.blockedCreate(hitOk, emp) === null);

check(
  "engine rejects fitting a visit on a special closed day",
  engine.canProviderFitDuration("ashley", { dateKey: "2026-12-25", minutes: 11 * 60 }, 60, "loc1") === false
);
check(
  "engine rejects a visit before special opening hours",
  engine.canProviderFitDuration("ashley", { dateKey: "2026-12-24", minutes: 9 * 60 }, 60, "loc1") === false
);
check(
  "engine allows a visit inside special opening hours",
  engine.canProviderFitDuration("ashley", { dateKey: "2026-12-24", minutes: 11 * 60 }, 60, "loc1") === true
);

const css = fs.readFileSync(path.join(root, "public/booking/calendar.css"), "utf8");
check("salon closed stays solid grey", /\.ff-cal-closed\s*\{[^}]*background:\s*#F5F5F7/.test(css));
check("provider-off stays a distinct hatch", /\.ff-cal-off\s*\{[^}]*repeating-linear-gradient/.test(css));
check("special hours get their own toolbar chip", css.indexOf(".ff-cal-special-note") !== -1);

const calSrc = fs.readFileSync(path.join(root, "public/booking/calendar.js"), "utf8");
check("empty-slot create uses the shared unavailable guard", calSrc.indexOf("blockedCreate(hit, emp)") !== -1);
check("create shows a toast instead of failing silently", calSrc.indexOf("toastUnavailable(blocked.message") !== -1);

if (failed) {
  console.error(failed + " calendar availability tests failed.");
  process.exit(1);
}
console.log("All calendar availability tests passed.");
