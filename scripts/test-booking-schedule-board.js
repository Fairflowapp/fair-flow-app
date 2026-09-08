/**
 * Readable schedule board: lanes, gaps, overlaps. No Firestore writes.
 * Usage: node scripts/test-booking-schedule-board.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function load(rel, windowObj) {
  new Function("window", fs.readFileSync(path.join(root, rel), "utf8"))(windowObj);
}

const windowObj = {
  settings: { preferences: { salonTimeZone: "America/New_York" } }
};
load("public/booking/schedule-board.js", windowObj);
load("public/booking/calendar-time.js", windowObj);
load("public/booking/appointments/model.js", windowObj);
load("public/booking/appointments/form.js", windowObj);

const board = windowObj.ffBookingScheduleBoard;
const form = windowObj.ffBookingAppointmentForm;
let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

const ashley = board.build({
  cards: [{
    appointmentId: "allen",
    lineId: "l-allen",
    providerId: "ashley",
    startMin: 10 * 60 + 45,
    endMin: 12 * 60 + 15,
    clientName: "Allen"
  }],
  holds: [{
    key: "hold:l-shiri",
    lineKey: "l-shiri",
    providerId: "ashley",
    startMin: 11 * 60 + 45,
    endMin: 12 * 60 + 45,
    durationMinutes: 60
  }]
});
const allen = ashley.items.find(function (row) { return row.kind === "card"; });
const shiri = ashley.items.find(function (row) { return row.kind === "hold"; });
check("Allen and Shiri sit in two lanes", allen.lane !== shiri.lane);
check("overlap cluster is two equal columns", allen.laneCount === 2 && shiri.laneCount === 2);
check("each column is 50 percent wide", allen.widthPct === 50 && shiri.widthPct === 50);
check("columns sit side by side", allen.leftPct + shiri.leftPct === 50);
check("overlap is thirty minutes", ashley.overlaps.length === 1 && ashley.overlaps[0].overlapMin === 30);

const sequential = board.build({
  cards: [
    { appointmentId: "a", lineId: "1", providerId: "ashley", startMin: 10 * 60, endMin: 11 * 60 },
    { appointmentId: "b", lineId: "2", providerId: "ashley", startMin: 11 * 60, endMin: 12 * 60 }
  ]
});
check("back-to-back stays one lane", sequential.items.every(function (row) {
  return row.lane === 0 && row.laneCount === 1 && row.widthPct === 100;
}));
check("back-to-back is not an overlap", sequential.overlaps.length === 0);
check("no gap when visits touch", sequential.gaps.length === 0);

const gapped = board.build({
  cards: [
    { appointmentId: "a", lineId: "1", providerId: "ashley", startMin: 10 * 60, endMin: 11 * 60 },
    { appointmentId: "b", lineId: "2", providerId: "ashley", startMin: 11 * 60 + 15, endMin: 12 * 60 }
  ]
});
check("empty window is a fifteen minute gap", gapped.gaps.length === 1 && gapped.gaps[0].gapMin === 15);

const sameWorker = form.emptyState({ locationId: "locA", dateKey: "2026-08-30", startMin: 11 * 60, providerId: "bobo" });
form.setClient(sameWorker, { clientId: "cli_allen", displayName: "Allen mora" });
sameWorker.lines[0].services = [{ id: "combo", name: "UV Gel Mani / Reg Pedi", durationMinutes: 90, price: 84, raw: { durationMinutes: 90, defaultPrice: 84 } }];
form.setLineService(sameWorker, sameWorker.lines[0].key, "combo");
form.addGuest(sameWorker);
sameWorker.lines[1].providerId = "bobo";
sameWorker.lines[1].services = [{ id: "combo", name: "UV Gel Mani / Reg Pedi", durationMinutes: 90, price: 84, raw: { durationMinutes: 90, defaultPrice: 84 } }];
form.setLineService(sameWorker, sameWorker.lines[1].key, "combo");
form.setLineStart(sameWorker, sameWorker.lines[1].key, 11 * 60);
check("same booking two guests on one worker still rejected", form.findProviderOverlaps(sameWorker).length === 1 && form.canCreate(sameWorker) === false);

if (failed) process.exit(1);
console.log("All schedule board tests passed.");
