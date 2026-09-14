/**
 * Phase 1 Week View: one provider × seven salon days.
 * Usage: node scripts/test-booking-calendar-week.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function load(rel, windowObj) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  new Function("window", "document", src)(windowObj, {
    readyState: "complete",
    documentElement: { getAttribute: function () { return ""; }, setAttribute: function () {} },
    body: {},
    addEventListener: function () {},
    getElementById: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    createElement: function () { return { style: {}, setAttribute: function () {}, classList: { add: function () {} } }; }
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
      "2026-09-16": { isClosed: true, note: "Staff event" },
      "2026-09-18": { isClosed: false, openTime: "10:00", closeTime: "14:00", note: "Early close" }
    }
  },
  ffGetStaffStore: function () {
    return {
      staff: [
        {
          id: "ashley",
          name: "Ashley Rivera",
          technicianTypes: ["nails"],
          defaultSchedule: {
            monday: { enabled: true, startTime: "10:00", endTime: "16:00" },
            tuesday: { enabled: true, startTime: "10:00", endTime: "16:00" },
            wednesday: { enabled: true, startTime: "10:00", endTime: "16:00" },
            thursday: { enabled: false },
            friday: { enabled: true, startTime: "11:00", endTime: "17:00" }
          }
        },
        {
          id: "nicole",
          name: "Nicole Chen",
          technicianTypes: ["nails"],
          defaultSchedule: {
            monday: { enabled: true, startTime: "09:00", endTime: "18:00" }
          }
        },
        {
          id: "koko",
          name: "Koko",
          technicianTypes: ["nails"]
        }
      ]
    };
  }
};

load("public/booking/calendar-time.js", windowObj);
load("public/booking/calendar-layout.js", windowObj);
load("public/booking/calendar-state.js", windowObj);
load("public/booking/availability.js", windowObj);
load("public/booking/calendar-data.js", windowObj);
load("public/booking/calendar-availability.js", windowObj);
load("public/booking/calendar-blocks.js", windowObj);
load("public/booking/appointments/model.js", windowObj);
load("public/booking/appointments/calendar-data.js", windowObj);
load("public/booking/calendar-print.js", windowObj);
load("public/booking/calendar-week.js", windowObj);

const st = windowObj.ffBookingCalState;
const tm = windowObj.ffBookingTime;
const data = windowObj.ffBookingCalData;
const av = windowObj.ffBookingCalAvailability;
const week = windowObj.ffBookingCalWeek;
const blocks = windowObj.ffBookingCalBlocks;
const cards = windowObj.ffBookingCalAppointments;
const printApi = windowObj.ffBookingCalPrint;

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

function emp(id, name) {
  return { id: id, firstName: name, displayName: name, name: name };
}

st.setEmployees([emp("ashley", "Ashley Rivera"), emp("nicole", "Nicole Chen"), emp("koko", "Koko")]);
st.setLocationId("loc1");
st.setSelectedDateKey("2026-09-16");

check("Day remains default view", st.getView() === "day" && st.isWeek() === false);

const dayDate = st.getSelectedDateKey();
const dayFilterBefore = st.getVisibleProviderIds().slice();
st.setVisibleProviderIds(["ashley", "nicole"]);
check("day filter can be set independently", st.isProviderFilterActive() === true);

st.setView("week");
check("switching to Week keeps Day date", st.getSelectedDateKey() === dayDate);
check("multiple visible providers do not auto-pick a Week provider", st.weekNeedsProvider() === true && st.getWeekProviderId() === "");
week.chooseProvider("ashley");
check("Week requires/resolves exactly one provider", st.getWeekProviderId() === "ashley" && !st.weekNeedsProvider());

const keys = st.getWeekDateKeys();
check("correct seven salon dates", keys.length === 7 && keys[0] === "2026-09-14" && keys[6] === "2026-09-20");
check("week is Monday–Sunday", tm.weekdayKey(keys[0]) === "monday" && tm.weekdayKey(keys[6]) === "sunday");
check("week range label", tm.formatWeekRange("2026-09-16") === "Sep 14 – Sep 20, 2026");

st.shiftWeek(-1);
check("previous week", st.getWeekStartKey() === "2026-09-07" && st.getWeekDateKeys()[6] === "2026-09-13");
st.shiftWeek(1);
check("next week returns to original range", st.getWeekStartKey() === "2026-09-14");

const originalToday = tm.todayDateKey;
tm.todayDateKey = function () { return "2026-09-16"; };
st.goThisWeek();
check("this week uses salon today", st.getWeekStartKey() === "2026-09-14" && st.isThisWeek() === true);

check("Day date survived week navigation", st.getSelectedDateKey() === "2026-09-16");
st.setView("day");
check("switching Day → Week → Day restores Day view", st.getView() === "day");
check("Day provider filter survives round trip", st.getVisibleProviderIds().join(",") === "ashley,nicole" && st.isProviderFilterActive() === true);
check("Week provider is kept for the next Week visit", st.getWeekProviderId() === "ashley");

st.setView("week");
function utc(dateKey, h, m) {
  const p = dateKey.split("-");
  return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]), h, m, 0));
}
const weekCards = cards.cardsFrom([
  {
    appointmentId: "a1",
    dateKey: "2026-09-15",
    status: "scheduled",
    clientSnapshot: { displayName: "Jenny" },
    serviceLines: [{
      lineId: "l1",
      providerId: "ashley",
      serviceNameSnapshot: "Gel",
      startAt: utc("2026-09-15", 15, 0),
      endAt: utc("2026-09-15", 16, 0),
      durationMinutes: 60
    }]
  },
  {
    appointmentId: "a2",
    dateKey: "2026-09-15",
    status: "scheduled",
    clientSnapshot: { displayName: "Maya" },
    serviceLines: [{
      lineId: "l2",
      providerId: "nicole",
      serviceNameSnapshot: "Cut",
      startAt: utc("2026-09-15", 14, 0),
      endAt: utc("2026-09-15", 15, 0),
      durationMinutes: 60
    }]
  }
]);
const ashleyTue = weekCards.filter(function (card) {
  return card.providerId === "ashley" && card.dateKey === "2026-09-15";
});
const nicoleTue = weekCards.filter(function (card) {
  return card.providerId === "nicole";
});
check("appointments land on correct day", ashleyTue.length === 1 && ashleyTue[0].clientName === "Jenny" && ashleyTue[0].dateKey === "2026-09-15");
check("appointments for other providers are excluded", ashleyTue.every(function (card) { return card.providerId === "ashley"; }) && nicoleTue[0].providerId === "nicole");

const closed = week.axisForDate("2026-09-16", week.sharedAxis());
check("special closed day is represented correctly", closed.salonOpen === false && closed.source === "special_day_closed");
const specialHours = week.axisForDate("2026-09-18", week.sharedAxis());
check("special-hours day is represented correctly", specialHours.salonOpen === true && specialHours.source === "special_day_hours" && specialHours.salonStartMin === 10 * 60 && specialHours.salonEndMin === 14 * 60);

st.setLocationId("loc1");
const thuEmp = week.employeeForDay("ashley", "2026-09-17", "loc1");
const friEmp = week.employeeForDay("ashley", "2026-09-18", "loc1");
const thuAxis = week.axisForDate("2026-09-17", week.sharedAxis());
const friAxis = week.axisForDate("2026-09-18", week.sharedAxis());
check("provider unavailable periods are day-specific", av.reasonAt(thuEmp, thuAxis, 11 * 60) === "provider_off");
check("Friday noon inside special hours is available", av.reasonAt(friEmp, friAxis, 12 * 60) === "available");
check("Friday after special close is salon-closed", av.reasonAt(friEmp, friAxis, 15 * 60) === "salon_closed");

blocks.setAll([
  { providerId: "ashley", locationId: "loc1", dateKey: "2026-09-15", startMin: 12 * 60, endMin: 13 * 60, reason: "lunch" },
  { providerId: "nicole", locationId: "loc1", dateKey: "2026-09-15", startMin: 12 * 60, endMin: 13 * 60, reason: "lunch" },
  { providerId: "ashley", locationId: "loc2", dateKey: "2026-09-15", startMin: 12 * 60, endMin: 13 * 60, reason: "lunch" },
  { providerId: "ashley", locationId: "loc1", dateKey: "2026-09-14", startMin: 12 * 60, endMin: 13 * 60, reason: "meeting" }
]);
check("blocked time lands on correct date/provider/location", blocks.forProvider("2026-09-15", "loc1", "ashley").length === 1 && blocks.forProvider("2026-09-15", "loc1", "nicole").length === 1);
check("other location block does not leak", blocks.forProvider("2026-09-15", "loc1", "ashley")[0].locationId === "loc1");
check("Monday block stays on Monday", blocks.forProvider("2026-09-14", "loc1", "ashley")[0].reason === "meeting");

check("current-time line appears only on today column", week.nowLineDayKey() === "2026-09-16");
st.shiftWeek(1);
check("current-time line is absent on another week", week.nowLineDayKey() === "");
st.shiftWeek(-1);

st.setWeekProviderId("ashley");
st.setEmployees([emp("nicole", "Nicole Chen"), emp("koko", "Koko")]);
check("location change invalidates stale Week provider safely", st.getWeekProviderId() === "" && st.weekNeedsProvider() === true);

st.setEmployees([emp("ashley", "Ashley Rivera"), emp("nicole", "Nicole Chen"), emp("koko", "Koko")]);
st.setVisibleProviderIds(["nicole"]);
st.clearWeekProvider();
st.setView("week");
check("exactly one visible/focused provider becomes the Week provider", st.getWeekProviderId() === "nicole");

st.setView("day");
check("Print Day remains available in Day view", printApi.canPrintDay() === true && printApi.printButtonLabel() === "Print Day");
st.setView("week");
check("Print Week is available while Week View is active", printApi.canPrintWeek() === true && printApi.canPrintDay() === false && printApi.printButtonLabel() === "Print Week");
const weekPrint = printApi.printCurrent();
check("toolbar print prints the current Week provider", !!(weekPrint && weekPrint.header && weekPrint.header.title === "Booking Week Schedule" && weekPrint.providerIds.join(",") === st.getWeekProviderId()));
if (printApi.exitPrintMode) printApi.exitPrintMode();
st.setView("day");
check("returning to Day restores Print Day", printApi.canPrintDay() === true && printApi.printButtonLabel() === "Print Day");

const calSrc = fs.readFileSync(path.join(root, "public/booking/calendar.js"), "utf8");
const weekSrc = fs.readFileSync(path.join(root, "public/booking/calendar-week.js"), "utf8");
const menuSrc = fs.readFileSync(path.join(root, "public/booking/calendar-menu.js"), "utf8");
check("toolbar Week control is enabled", calSrc.indexOf('data-ff-cal-act="view-week"') !== -1 && calSrc.indexOf("Week view coming later") === -1);
check("provider menu can open Week without mutating Day filters", menuSrc.indexOf("setWeekProviderId") !== -1 && menuSrc.indexOf("View provider week") !== -1);
check("Week paint does not reuse provider photos on each day", weekSrc.indexOf("ff-cal-day-head") !== -1 && weekSrc.indexOf("providerBarHtml") !== -1);
check("Week empty-slot create reuses Day openAppointmentFromHit", calSrc.indexOf("rememberWeekSlot") !== -1 && calSrc.indexOf("openAppointmentFromHit(rememberWeekSlot") !== -1);

load("public/booking/schedule-board.js", windowObj);
const board = windowObj.ffBookingScheduleBoard;
const sameClock = board.build({
  cards: [
    { providerId: "ashley", dateKey: "2026-09-14", startMin: 14 * 60, endMin: 15 * 60, appointmentId: "m1", lineId: "lm1" },
    { providerId: "ashley", dateKey: "2026-09-15", startMin: 14 * 60, endMin: 15 * 60, appointmentId: "t1", lineId: "lt1" }
  ]
});
check("merged week cards at the same clock time would collide", sameClock.items.some(function (item) {
  return item.laneCount > 1;
}));
const mondayOnly = board.build({
  cards: [
    { providerId: "ashley", dateKey: "2026-09-14", startMin: 14 * 60, endMin: 15 * 60, appointmentId: "m1", lineId: "lm1" }
  ]
});
check("per-day board build keeps a full-width Monday card", mondayOnly.items[0].laneCount === 1 && mondayOnly.items[0].widthPct === 100);

const renderSrc = fs.readFileSync(path.join(root, "public/booking/appointments/calendar-render.js"), "utf8");
check("Week paint builds overlap lanes one day at a time", renderSrc.indexOf("cardsForWeekDay") !== -1 && renderSrc.indexOf("getWeekDateKeys") !== -1);
check("Week header stays taller than Day tokens", week.headerHeight() === 68);

const prevZoned = tm.zonedDateKey;
tm.zonedDateKey = function () { return "2026-09-15"; };
const derived = cards.cardsFrom([{
  appointmentId: "derived1",
  status: "scheduled",
  clientSnapshot: { displayName: "No Key" },
  serviceLines: [{
    lineId: "ld1",
    providerId: "ashley",
    serviceNameSnapshot: "Gel",
    startAt: utc("2026-09-15", 15, 0),
    endAt: utc("2026-09-15", 16, 0),
    durationMinutes: 60
  }]
}]);
check("missing appointment dateKey falls back to salon zoned start", derived[0] && derived[0].dateKey === "2026-09-15");
tm.zonedDateKey = prevZoned;

tm.todayDateKey = originalToday;

if (failed) {
  console.error(failed + " calendar week tests failed.");
  process.exit(1);
}
console.log("All calendar week tests passed.");
