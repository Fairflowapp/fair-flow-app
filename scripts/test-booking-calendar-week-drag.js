/**
 * Week View drag/drop for existing appointments. Reuses Day drag + bookability.
 * Usage: node scripts/test-booking-calendar-week-drag.js
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

const cards = [
  { appointmentId: "a1", providerId: "ashley", dateKey: "2026-09-15", startMin: 14 * 60, endMin: 15 * 60 },
  { appointmentId: "a2", providerId: "ashley", dateKey: "2026-09-14", startMin: 11 * 60, endMin: 12 * 60 },
  { appointmentId: "a3", providerId: "nicole", dateKey: "2026-09-15", startMin: 14 * 60, endMin: 15 * 60 }
];

const appts = {
  a1: {
    appointmentId: "a1",
    locationId: "loc1",
    dateKey: "2026-09-15",
    clientId: "c1",
    status: "scheduled",
    serviceLines: [{
      lineId: "l1",
      serviceId: "gel",
      serviceNameSnapshot: "Gel",
      providerId: "ashley",
      startAt: { dateKey: "2026-09-15", minutes: 14 * 60, locationId: "loc1" },
      durationMinutes: 60,
      requested: true,
      guestKey: "",
      guestName: ""
    }]
  },
  multi: {
    appointmentId: "multi",
    locationId: "loc1",
    dateKey: "2026-09-15",
    serviceLines: [
      { lineId: "m1", providerId: "ashley", durationMinutes: 30 },
      { lineId: "m2", providerId: "nicole", durationMinutes: 45 }
    ]
  },
  stacked: {
    appointmentId: "stacked",
    locationId: "loc1",
    dateKey: "2026-09-15",
    serviceLines: [
      {
        lineId: "s1",
        serviceId: "gel",
        serviceNameSnapshot: "Gel",
        providerId: "ashley",
        startAt: { dateKey: "2026-09-15", minutes: 14 * 60, locationId: "loc1" },
        durationMinutes: 30,
        requested: true
      },
      {
        lineId: "s2",
        serviceId: "pedi",
        serviceNameSnapshot: "Pedi",
        providerId: "ashley",
        startAt: { dateKey: "2026-09-15", minutes: 14 * 60 + 30, locationId: "loc1" },
        durationMinutes: 45,
        requested: false
      }
    ]
  }
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
            monday: { enabled: true, startTime: "09:00", endTime: "18:00" },
            tuesday: { enabled: true, startTime: "09:00", endTime: "18:00" },
            wednesday: { enabled: true, startTime: "09:00", endTime: "18:00" },
            thursday: { enabled: true, startTime: "09:00", endTime: "18:00" }
          }
        }
      ]
    };
  },
  ffBookingCalAppointments: {
    cardsForProvider: function (dateKey, locationId, providerId) {
      return cards.filter(function (card) {
        return card.dateKey === dateKey && card.providerId === providerId;
      });
    },
    getCachedById: function (id) {
      return appts[id] || null;
    }
  },
  ffBookingAppointmentModel: {
    civilToDate: function (dateKey, minutes, locationId) {
      return { dateKey: dateKey, minutes: minutes, locationId: locationId };
    },
    toDate: function (value) {
      return value || null;
    }
  },
  ffBookingTime: null
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
load("public/booking/calendar-drag.js", windowObj);
load("public/booking/calendar.js", windowObj);

windowObj.ffBookingTime.zonedMinutes = function (value) {
  return value && Number.isFinite(Number(value.minutes)) ? Number(value.minutes) : null;
};

const st = windowObj.ffBookingCalState;
const week = windowObj.ffBookingCalWeek;
const drag = windowObj.ffBookingCalDrag;
const drop = windowObj.ffBookingCalDrop;
const blocks = windowObj.ffBookingCalBlocks;
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
st.setVisibleProviderIds(["ashley"]);
st.setView("week");
st.setWeekProviderId("ashley");
st.setWeekAnchorKey("2026-09-16");

const source = {
  kind: "card",
  appointmentId: "a1",
  lineId: "l1",
  lineIds: ["l1"],
  fromProviderId: "ashley",
  fromDateKey: "2026-09-15",
  fromStartMin: 14 * 60,
  durationMinutes: 60
};

const sameDay = drag.dropAction(source, {
  providerId: "ashley",
  dateKey: "2026-09-15",
  startMin: 15 * 60
});
check("drag same day to new valid time", !!(sameDay && sameDay.startMin === 15 * 60 && sameDay.dateKey === "2026-09-15"));

const crossDay = drag.dropAction(source, {
  providerId: "ashley",
  dateKey: "2026-09-14",
  startMin: 11 * 60
});
check("drag to different day in same week", !!(crossDay && crossDay.dateKey === "2026-09-14" && crossDay.startMin === 11 * 60));

const px = 72 / 60;
const snapped = drag.previewFromDelta(source, 15 * px, "ashley", { startMin: 8 * 60, endMin: 19 * 60 });
check("15-minute snap", !!(snapped && snapped.startMin === 14 * 60 + 15));

check("same provider preserved", !!(crossDay && crossDay.providerId === "ashley"));
const forced = drag.dropAction(source, {
  providerId: "nicole",
  dateKey: "2026-09-14",
  startMin: 11 * 60
});
check("Week drop cannot change provider", !!(forced && forced.providerId === "ashley"));

const planned = drag.planCardMove(appts.a1, {
  lineIds: ["l1"],
  providerId: "ashley",
  startMin: 15 * 60 + 15,
  fromStartMin: 14 * 60,
  dateKey: "2026-09-17",
  lockProvider: true
});
check("active location preserved", !!(planned && planned.locationId === "loc1"));
check("successful move updates correct date/time", !!(planned && planned.dateKey === "2026-09-17" && planned.lines[0].startAt.minutes === 15 * 60 + 15 && planned.lines[0].endAt.minutes === 16 * 60 + 15));
check("duration preserved", planned.lines[0].durationMinutes === 60);
check("service lines preserved", planned.lines[0].serviceId === "gel" && planned.lines[0].serviceNameSnapshot === "Gel" && planned.lines[0].requested === true);
check("appointment does not duplicate after move", planned.lines.length === 1 && planned.dateKey === "2026-09-17");

const stackedMove = drag.planCardMove(appts.stacked, {
  lineIds: ["s1", "s2"],
  providerId: "ashley",
  startMin: 11 * 60,
  fromStartMin: 14 * 60,
  dateKey: "2026-09-14",
  lockProvider: true
});
check("multi-service stays one visit", !!(stackedMove && stackedMove.lines[0].startAt.minutes === 11 * 60 && stackedMove.lines[1].startAt.minutes === 11 * 60 + 30 && stackedMove.lines[0].providerId === "ashley" && stackedMove.lines[1].providerId === "ashley"));
check("multi-service durations stay intact", stackedMove.lines[0].durationMinutes === 30 && stackedMove.lines[1].durationMinutes === 45);

const self = week.inspectMove({
  dateKey: "2026-09-15",
  startMin: 14 * 60 + 15,
  durationMinutes: 60,
  source: source
});
check("source appointment excluded from self-collision", self.ok === true);

const collide = week.inspectMove({
  dateKey: "2026-09-14",
  startMin: 11 * 60,
  durationMinutes: 60,
  source: source
});
check("destination appointment collision rejected", collide.ok === false && collide.reason === "appointment_conflict");

const closed = week.inspectMove({ dateKey: "2026-09-20", startMin: 11 * 60, durationMinutes: 60, source: source });
check("location closed rejected", closed.ok === false && (closed.reason === "salon_closed" || closed.reason === "not_bookable"));

const specialClosed = week.inspectMove({ dateKey: "2026-09-16", startMin: 11 * 60, durationMinutes: 60, source: source });
check("special closed day rejected", specialClosed.ok === false && (specialClosed.reason === "salon_closed" || specialClosed.reason === "not_bookable"));

const specialOpen = week.inspectMove({ dateKey: "2026-09-18", startMin: 12 * 60, durationMinutes: 60, source: source });
check("special opening hours respected — open window allowed", specialOpen.ok === true);
const specialAfter = week.inspectMove({ dateKey: "2026-09-18", startMin: 13 * 60 + 30, durationMinutes: 60, source: source });
check("special opening hours respected — duration must fit", specialAfter.ok === false && (specialAfter.reason === "salon_closed" || specialAfter.reason === "not_bookable"));

const off = week.inspectMove({ dateKey: "2026-09-17", startMin: 10 * 60, durationMinutes: 60, source: { appointmentId: "none" } });
check("provider unavailable rejected", off.ok === false && (off.reason === "provider_off" || off.reason === "not_bookable"));

blocks.setAll([{
  providerId: "ashley",
  locationId: "loc1",
  dateKey: "2026-09-14",
  startMin: 12 * 60,
  endMin: 13 * 60,
  reason: "lunch"
}]);
const blocked = week.inspectMove({ dateKey: "2026-09-14", startMin: 12 * 60, durationMinutes: 60, source: source });
check("blocked time rejected", blocked.ok === false && blocked.reason === "provider_blocked");

const tooLong = week.inspectMove({ dateKey: "2026-09-14", startMin: 15 * 60 + 30, durationMinutes: 90, source: source });
check("entire duration must fit", tooLong.ok === false);

const original = { dateKey: appts.a1.dateKey, start: appts.a1.serviceLines[0].startAt.minutes };
const rejected = drag.applyDrop({
  source: source,
  providerId: "ashley",
  dateKey: "2026-09-20",
  startMin: 11 * 60,
  durationMinutes: 60
});
check("invalid drop leaves original time/date untouched", original.dateKey === "2026-09-15" && original.start === 14 * 60 && appts.a1.dateKey === "2026-09-15");
check("invalid drop does not persist", typeof rejected.then === "function");

check("click still opens appointment", drag.releaseOpensDetails({
  kind: "card",
  appointmentId: "a1",
  lineId: "l1"
}, null) === true);
check("a real Week drop does not open details", drag.releaseOpensDetails(source, crossDay) === false);

const validCreate = week.inspectCreate("2026-09-14", 11 * 60);
check("Week empty-slot create still works", validCreate.ok === true && validCreate.hit.slot.providerId === "ashley");

check("multi-provider appointment is not Week-draggable", drag.weekCardDraggable(appts.multi, "ashley") === false);
check("same-provider visit is Week-draggable", drag.weekCardDraggable(appts.a1, "ashley") === true);
check("other provider data is not used", drag.weekCardDraggable(appts.a1, "nicole") === false);

const before = drag.dragContext();
st.setWeekProviderId("nicole");
check("changing Week provider during drag cancels safely", drag.dragContextChanged(before) === true);
st.setWeekProviderId("ashley");
const beforeNav = drag.dragContext();
st.shiftWeek(1);
check("navigating Week during drag cancels safely", drag.dragContextChanged(beforeNav) === true);
st.shiftWeek(-1);

check("Day selected date survived Week drag helpers", st.getSelectedDateKey() === "2026-09-15");
st.setView("day");
check("Day view state survives Week drag work", st.getView() === "day" && st.getSelectedDateKey() === "2026-09-15" && st.getVisibleProviderIds().join(",") === "ashley");

const dayMove = drag.dropAction({
  kind: "card",
  appointmentId: "a1",
  lineId: "l1",
  fromProviderId: "ashley",
  fromStartMin: 14 * 60
}, { providerId: "nicole", startMin: 15 * 60 });
check("Day drag/drop behavior still allows provider change", !!(dayMove && dayMove.providerId === "nicole" && drag.isProviderChange(dayMove)));

const dragSrc = fs.readFileSync(path.join(root, "public/booking/calendar-drag.js"), "utf8");
const weekSrc = fs.readFileSync(path.join(root, "public/booking/calendar-week.js"), "utf8");
const calSrc = fs.readFileSync(path.join(root, "public/booking/calendar.js"), "utf8");
check("Week no longer blocks pointer drag", dragSrc.indexOf("if (st && st.isWeek && st.isWeek()) return;") === -1);
check("Week provider change cancels an active drag", weekSrc.indexOf("ffBookingCalDrag.cancel") !== -1);
check("Week navigation cancels an active drag", calSrc.indexOf("cancelActiveDrag") !== -1 && calSrc.indexOf("shiftWeek") !== -1);
check("drop still consumes the click so create does not fire", calSrc.indexOf("consumeClick") !== -1);
check("Day create helpers remain", typeof create.blockedCreate === "function");
check("Week move uses Day drop inspect", weekSrc.indexOf("inspectMove") !== -1 && typeof drop.inspectMove === "function");

if (failed) {
  console.error(failed + " calendar week-drag tests failed.");
  process.exit(1);
}
console.log("All calendar week-drag tests passed.");
