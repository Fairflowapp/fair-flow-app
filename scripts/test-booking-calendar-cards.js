/**
 * Calendar appointment card helpers. No Firestore writes.
 * Usage: node scripts/test-booking-calendar-cards.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function load(rel, windowObj) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  new Function("window", "document", src)(windowObj, undefined);
}

const windowObj = {
  document: undefined,
  ffBookingTime: {
    zonedMinutes: function (date) {
      return date.getUTCHours() * 60 + date.getUTCMinutes();
    }
  }
};
load("public/booking/appointments/model.js", windowObj);
load("public/booking/appointments/calendar-data.js", windowObj);
load("public/booking/appointments/calendar-render.js", windowObj);
load("public/booking/calendar-layout.js", windowObj);

const model = windowObj.ffBookingAppointmentModel;
const data = windowObj.ffBookingCalAppointments;
const render = windowObj.ffBookingCalCardRender;
const layout = windowObj.ffBookingCalLayout;
let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

function utc(h, m) {
  return new Date(Date.UTC(2026, 7, 22, h, m, 0));
}

const cards = data.cardsFrom([
  {
    appointmentId: "a1",
    status: "scheduled",
    clientSnapshot: { displayName: "Jessica Miller" },
    serviceLines: [{
      lineId: "l1",
      providerId: "bobo",
      serviceNameSnapshot: "Gel Manicure",
      startAt: utc(14, 15),
      endAt: utc(15, 15),
      durationMinutes: 60
    }]
  },
  {
    appointmentId: "a2",
    status: "cancelled",
    clientSnapshot: { displayName: "Hidden" },
    serviceLines: [{
      lineId: "l2",
      providerId: "bobo",
      serviceNameSnapshot: "Cut",
      startAt: utc(16, 0),
      endAt: utc(17, 0),
      durationMinutes: 60
    }]
  },
  {
    appointmentId: "a3",
    status: "confirmed",
    clientSnapshot: { displayName: "Other Loc" },
    serviceLines: [{
      lineId: "l3",
      providerId: "koko",
      serviceNameSnapshot: "Color",
      startAt: utc(14, 15),
      endAt: utc(15, 0),
      durationMinutes: 45
    }]
  }
], "locA");

check("active card kept", cards.some(function (c) { return c.appointmentId === "a1"; }));
check("cancelled omitted", !cards.some(function (c) { return c.appointmentId === "a2"; }));
check("client snapshot used", cards[0].clientName === "Jessica Miller");
check("service snapshot used", cards[0].serviceName === "Gel Manicure");
check("60 min height math", layout.durationToHeight(60) === 72);
check("45 min height math", layout.durationToHeight(45) === 54);
check("30 min height math", layout.durationToHeight(30) === 36);
check("90 min height math", layout.durationToHeight(90) === 108);
check("10:15 clock", render.clock(14 * 60 + 15) === "2:15" || render.clock(10 * 60 + 15) === "10:15");
check("10:15 label", render.clock(10 * 60 + 15) === "10:15");
check("isActiveStatus hides cancelled", model.isActiveStatus("cancelled") === false);

const overlap = render.overlapLanes([
  { providerId: "bobo", startMin: 615, endMin: 675 },
  { providerId: "bobo", startMin: 630, endMin: 690 }
]);
check("overlap uses a second lane", overlap[0].lane === 0 && overlap[1].lane === 1);

if (failed) process.exit(1);
console.log("All Calendar card helper tests passed.");
