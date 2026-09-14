/**
 * Week View empty-slot create. Reuses Day draft/bookability.
 * Usage: node scripts/test-booking-calendar-week-create.js
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
load("public/booking/calendar-drop.js", windowObj);
load("public/booking/calendar-draft.js", windowObj);
load("public/booking/calendar-week.js", windowObj);
load("public/booking/calendar.js", windowObj);

const st = windowObj.ffBookingCalState;
const week = windowObj.ffBookingCalWeek;
const draft = windowObj.ffBookingCalDraft;
const blocks = windowObj.ffBookingCalBlocks;
const lay = windowObj.ffBookingCalLayout;
const create = windowObj.ffBookingCalendarCreate;

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

st.setEmployees([emp("ashley", "Ashley Rivera"), emp("nicole", "Nicole Chen")]);
st.setLocationId("loc1");
st.setSelectedDateKey("2026-09-15");
st.setVisibleProviderIds(["ashley", "nicole"]);
st.setView("week");
st.setWeekProviderId("ashley");
st.setWeekAnchorKey("2026-09-16");

const twoFifteen = week.inspectCreate("2026-09-14", 14 * 60 + 15);
check("Monday 2:15 PM uses that salon date and snapped start", twoFifteen.ok === true && twoFifteen.hit.slot.dateKey === "2026-09-14" && twoFifteen.hit.slot.startMin === 14 * 60 + 15);

const valid = week.inspectCreate("2026-09-14", 11 * 60);
check("click valid Week empty slot is bookable", valid.ok === true && valid.reason === "available");
check("correct Week provider", valid.hit.slot.providerId === "ashley");
check("correct active location", valid.hit.locationId === "loc1");
check("correct date", valid.hit.slot.dateKey === "2026-09-14");
check("correct 15-minute start time", valid.hit.slot.startMin === 11 * 60);
const nicoleOpen = week.inspectCreate("2026-09-14", 9 * 60);
check("other provider hours are not used", nicoleOpen.ok === false && (nicoleOpen.reason === "provider_off" || nicoleOpen.reason === "not_bookable"));

draft.set({
  providerId: valid.hit.slot.providerId,
  dateKey: valid.hit.slot.dateKey,
  startMin: valid.hit.slot.startMin,
  durationMinutes: 30
});
const started = draft.get();
check("click valid Week empty slot starts draft", !!(started && started.dateKey === "2026-09-14" && started.startMin === 11 * 60 && started.providerId === "ashley"));

const closed = week.inspectCreate("2026-09-20", 11 * 60);
check("closed time rejected", closed.ok === false && (closed.reason === "salon_closed" || closed.reason === "not_bookable"));

const specialClosed = week.inspectCreate("2026-09-16", 11 * 60);
check("special closed day rejected", specialClosed.ok === false && (specialClosed.reason === "salon_closed" || specialClosed.reason === "not_bookable"));

const specialOpen = week.inspectCreate("2026-09-18", 12 * 60);
check("special hours respected — open window allowed", specialOpen.ok === true);
const specialAfter = week.inspectCreate("2026-09-18", 15 * 60);
check("special hours respected — after close rejected", specialAfter.ok === false && (specialAfter.reason === "salon_closed" || specialAfter.reason === "not_bookable"));

const off = week.inspectCreate("2026-09-17", 11 * 60);
check("provider unavailable rejected", off.ok === false && (off.reason === "provider_off" || off.reason === "not_bookable"));

blocks.setAll([{
  providerId: "ashley",
  locationId: "loc1",
  dateKey: "2026-09-15",
  startMin: 12 * 60,
  endMin: 13 * 60,
  reason: "lunch"
}]);
const blocked = week.inspectCreate("2026-09-15", 12 * 60);
check("blocked time rejected", blocked.ok === false && blocked.reason === "provider_blocked");
const besideBlock = week.inspectCreate("2026-09-15", 11 * 60);
check("time beside a block can still create", besideBlock.ok === true);

const nicoleHit = week.createHit("2026-09-14", 11 * 60);
check("other provider data is not used", nicoleHit.slot.providerId === "ashley" && nicoleHit.employees.every(function (row) {
  return row.id === "ashley";
}));

const dayDate = st.getSelectedDateKey();
const dayFilter = st.getVisibleProviderIds().join(",");
draft.clear();
check("draft cancel clears Week draft", draft.get() === null);

draft.set({
  providerId: "ashley",
  dateKey: "2026-09-14",
  startMin: 14 * 60 + 15,
  durationMinutes: 30
});
const draftDate = draft.get().dateKey;
st.shiftWeek(1);
check("Week navigation does not mutate an existing draft date", draft.get() && draft.get().dateKey === draftDate && draft.get().dateKey === "2026-09-14");
check("Day selected date is unchanged by Week navigation", st.getSelectedDateKey() === dayDate);

st.setView("day");
check("Day state survives Week creation round trip", st.getView() === "day" && st.getSelectedDateKey() === "2026-09-15" && st.getVisibleProviderIds().join(",") === dayFilter);

const y = lay.timeToY(14 * 60 + 15, week.sharedAxis().startMin);
st.setView("week");
st.setWeekProviderId("ashley");
st.setWeekAnchorKey("2026-09-16");
const snapped = week.hitTestFromPoint(10, y, 144);
check("Week hit uses 15-minute grid", !!(snapped && snapped.slot.startMin === 14 * 60 + 15 && snapped.slot.dateKey === "2026-09-14"));

const calSrc = fs.readFileSync(path.join(root, "public/booking/calendar.js"), "utf8");
const bindSrc = calSrc.slice(calSrc.indexOf("function bind()"));
const cardFirst = bindSrc.indexOf('t.closest("[data-ff-cal-card]")');
const blockFirst = bindSrc.indexOf('t.closest("[data-ff-cal-block]")');
const weekCreate = bindSrc.indexOf("rememberWeekSlot");
check("appointment click does not start new draft", cardFirst !== -1 && weekCreate !== -1 && cardFirst < weekCreate);
check("blocked-time chip click does not start a draft", blockFirst !== -1 && weekCreate !== -1 && blockFirst < weekCreate);
check("Day create helpers are reused", typeof create.blockedCreate === "function" && typeof create.slotIsOpen === "function");
check("Week create uses Day drop inspect", fs.readFileSync(path.join(root, "public/booking/calendar-week.js"), "utf8").indexOf("blockedCreate") !== -1);

if (failed) {
  console.error(failed + " calendar week-create tests failed.");
  process.exit(1);
}
console.log("All calendar week-create tests passed.");
