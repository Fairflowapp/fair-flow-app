/**
 * Calendar card information polish — Time Block + Combo component times.
 * Usage: node scripts/test-booking-calendar-card-info.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

const documentMock = {
  readyState: "complete",
  documentElement: { getAttribute: function () { return ""; }, setAttribute: function () {} },
  addEventListener: function () {},
  getElementById: function () { return null; },
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
  createElement: function (tag) {
    return {
      tagName: String(tag || "").toUpperCase(),
      className: "",
      style: {},
      setAttribute: function () {},
      removeAttribute: function () {},
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      addEventListener: function () {}
    };
  }
};

function load(rel, windowObj) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  new Function("window", "document", src)(windowObj, documentMock);
}

const windowObj = {
  addEventListener: function () {},
  settings: { preferences: { salonTimeZone: "America/New_York" } },
  document: documentMock,
  ffBookingTime: {
    zonedMinutes: function (date) { return date.getUTCHours() * 60 + date.getUTCMinutes(); },
    zonedDateKey: function () { return "2026-09-16"; }
  }
};

load("public/booking/calendar-time.js", windowObj);
windowObj.ffBookingTime.zonedMinutes = function (date) {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
};
windowObj.ffBookingTime.zonedDateKey = function () { return "2026-09-16"; };
load("public/booking/calendar-layout.js", windowObj);
load("public/booking/blocks/model.js", windowObj);
load("public/booking/calendar-blocks.js", windowObj);
load("public/booking/schedule-board.js", windowObj);
load("public/booking/appointments/model.js", windowObj);
load("public/booking/appointments/combo.js", windowObj);
load("public/booking/appointments/calendar-data.js", windowObj);
load("public/booking/appointments/calendar-render.js", windowObj);
load("public/booking/calendar-drag.js", windowObj);

const model = windowObj.ffBookingBlockModel;
const blocks = windowObj.ffBookingCalBlocks;
const cal = windowObj.ffBookingCalAppointments;
const render = windowObj.ffBookingCalCardRender;
const drag = windowObj.ffBookingCalDrag;
const apptModel = windowObj.ffBookingAppointmentModel;

const blockCss = fs.readFileSync(path.join(root, "public/booking/calendar.css"), "utf8");
const cardCss = fs.readFileSync(path.join(root, "public/booking/appointments/calendar-cards.css"), "utf8");
const dragSrc = fs.readFileSync(path.join(root, "public/booking/calendar-drag.js"), "utf8");

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

function utc(h, m) {
  return new Date(Date.UTC(2026, 8, 16, h, m, 0));
}

function makeBlock(spec) {
  return model.normalize(Object.assign({
    blockId: spec.blockId || "blk_" + spec.reason,
    providerId: "rebecca",
    locationId: "loc1",
    dateKey: "2026-09-16"
  }, spec));
}

const meeting = makeBlock({
  reason: "meeting",
  startMin: 16 * 60 + 45,
  endMin: 17 * 60 + 15,
  note: "Manager meeting"
});
const meetingHtml = blocks.blockHtml(meeting, { top: 10, height: 36 });
const meetingLines = blocks.cardLines(meeting);
check("1. Meeting card shows reason", meetingLines.reason === "Meeting" && meetingHtml.indexOf("Meeting") !== -1);
check("2. Meeting card shows start-end time", meetingLines.time === "4:45 PM – 5:15 PM" && meetingHtml.indexOf("4:45 PM – 5:15 PM") !== -1);
check("3. Meeting card shows note", meetingLines.note === "Manager meeting" && meetingHtml.indexOf("Manager meeting") !== -1);

const lunch = makeBlock({
  reason: "lunch",
  startMin: 17 * 60 + 15,
  endMin: 17 * 60 + 45
});
const lunchHtml = blocks.blockHtml(lunch, { top: 20, height: 36 });
check("4. Lunch Break shows start-end", lunchHtml.indexOf("Lunch Break") !== -1 && lunchHtml.indexOf("5:15 PM – 5:45 PM") !== -1);

const personal = makeBlock({
  reason: "personal",
  startMin: 15 * 60,
  endMin: 16 * 60
});
check("5. Personal shows start-end",
  blocks.blockHtml(personal, { top: 4, height: 72 }).indexOf("Personal") !== -1 &&
  blocks.blockHtml(personal, { top: 4, height: 72 }).indexOf("3:00 PM – 4:00 PM") !== -1);

const other = makeBlock({
  reason: "other",
  startMin: 11 * 60,
  endMin: 11 * 60 + 30,
  note: "Inventory delivery"
});
const otherHtml = blocks.blockHtml(other, { top: 8, height: 36 });
check("6. Other shows start-end + note",
  otherHtml.indexOf("Other") !== -1 &&
  otherHtml.indexOf("11:00 AM – 11:30 AM") !== -1 &&
  otherHtml.indexOf("Inventory delivery") !== -1);

check("7. no-note block has no empty note line",
  lunchHtml.indexOf("ff-cal-block-note") === -1 &&
  lunchHtml.indexOf("data-ff-cal-block-note") === -1 &&
  blocks.cardLines(lunch).note === "");

const thirty = makeBlock({
  reason: "meeting",
  startMin: 13 * 60 + 30,
  endMin: 14 * 60,
  note: "Staff meeting"
});
const thirtyHtml = blocks.blockHtml(thirty, { top: 0, height: 36 });
check("8. 30-minute block still shows reason + time",
  thirtyHtml.indexOf("Meeting") !== -1 &&
  thirtyHtml.indexOf("1:30 PM – 2:00 PM") !== -1 &&
  thirtyHtml.indexOf("is-compact") !== -1 &&
  blocks.blockDensityClass(thirty.startMin, thirty.endMin) === " is-compact");
check("9. 30-minute block with note shows note if layout allows",
  thirtyHtml.indexOf("Staff meeting") !== -1 &&
  /ff-cal-block\.is-compact/.test(blockCss) &&
  /\.ff-cal-block\s*>\s*\.ff-cal-block-time\s*\{[\s\S]*?flex:\s*0 0 auto/.test(blockCss));

const longNote = makeBlock({
  reason: "personal",
  startMin: 9 * 60,
  endMin: 9 * 60 + 15,
  note: "A very long Time Block note that must stay available in the editor even if the card truncates it visually"
});
const longHtml = blocks.blockHtml(longNote, { top: 0, height: 18 });
check("10. long note truncates safely",
  longHtml.indexOf(longNote.note) !== -1 &&
  longHtml.indexOf('title="') !== -1 &&
  /text-overflow:\s*ellipsis/.test(blockCss) &&
  longHtml.indexOf("is-tight") !== -1);

check("11. persisted times match displayed times",
  meetingHtml.indexOf('data-ff-cal-start="' + meeting.startMin + '"') !== -1 &&
  meetingHtml.indexOf('data-ff-cal-end="' + meeting.endMin + '"') !== -1 &&
  blocks.formatTimeRange(meeting.startMin, meeting.endMin) === "4:45 PM – 5:15 PM");

check("12. opening/editing still works",
  typeof windowObj.ffBookingCalBlocks.getById === "function" &&
  meeting.reason === "meeting" &&
  meeting.note === "Manager meeting" &&
  meeting.startMin === 16 * 60 + 45 &&
  meeting.endMin === 17 * 60 + 15);

const moved = drag.blockMoveSpec({
  source: {
    kind: "block",
    blockId: meeting.blockId,
    fromProviderId: "rebecca",
    fromLocationId: "loc1",
    fromDateKey: "2026-09-16",
    durationMinutes: 30,
    reason: meeting.reason,
    note: meeting.note,
    label: meeting.label
  },
  providerId: "rebecca",
  startMin: 18 * 60,
  dateKey: "2026-09-16"
});
const movedCard = blocks.blockHtml(model.normalize(Object.assign({}, meeting, moved)), { top: 0, height: 36 });
check("13. drag does not lose card info",
  !!(moved &&
    moved.reason === "meeting" &&
    moved.note === "Manager meeting" &&
    moved.endMin - moved.startMin === 30 &&
    movedCard.indexOf("Meeting") !== -1 &&
    movedCard.indexOf("6:00 PM – 6:30 PM") !== -1 &&
    movedCard.indexOf("Manager meeting") !== -1 &&
    dragSrc.indexOf(".ff-cal-block-time") !== -1));

const training = makeBlock({ reason: "training", startMin: 10 * 60, endMin: 11 * 60, note: "Russian manicure training" });
const legacy = makeBlock({ reason: "time_off", startMin: 8 * 60, endMin: 8 * 60 + 30, label: "Inventory run" });
check("legacy and training Time Blocks still render identity + time",
  blocks.cardLines(training).reason === "Training" &&
  blocks.cardLines(training).time === "10:00 AM – 11:00 AM" &&
  blocks.cardLines(legacy).reason === "Other" &&
  blocks.cardLines(legacy).note === "Inventory run" &&
  blocks.blockHtml(legacy, { top: 0, height: 36 }).indexOf("8:00 AM – 8:30 AM") !== -1);

const gelStart = utc(15, 0);
const gelEnd = utc(15, 30);
const pediStart = utc(15, 30);
const pediEnd = utc(16, 15);
const splitDoc = apptModel.fromDoc("appt_split", {
  appointmentId: "appt_split",
  status: "scheduled",
  locationId: "locA",
  dateKey: "2026-09-16",
  clientSnapshot: { displayName: "Shiri A" },
  serviceLines: [
    {
      lineId: "c1",
      serviceId: "svc-mani",
      serviceNameSnapshot: "Manicure",
      providerId: "nicole",
      startAt: gelStart,
      endAt: gelEnd,
      durationMinutes: 30,
      comboInstanceId: "combo_1",
      comboServiceId: "svc-combo",
      comboNameSnapshot: "Mani Pedi"
    },
    {
      lineId: "c2",
      serviceId: "svc-pedi",
      serviceNameSnapshot: "Pedicure",
      providerId: "ashley",
      startAt: pediStart,
      endAt: pediEnd,
      durationMinutes: 45,
      comboInstanceId: "combo_1",
      comboServiceId: "svc-combo",
      comboNameSnapshot: "Mani Pedi"
    }
  ]
});
const splitCards = cal.cardsFrom([splitDoc], "locA");
const providerA = splitCards.find(function (card) { return card.providerId === "nicole"; });
const providerB = splitCards.find(function (card) { return card.providerId === "ashley"; });
const htmlA = render.cardInnerHtml(providerA, providerA);
const htmlB = render.cardInnerHtml(providerB, providerB);

check("14. split-provider Combo provider A card shows correct component name",
  !!(providerA && providerA.serviceName.indexOf("Manicure") !== -1 && htmlA.indexOf("Manicure") !== -1 && htmlA.indexOf("Mani Pedi") !== -1));
check("15. provider A card shows that component's start-end",
  htmlA.indexOf("3:00 PM – 3:30 PM") !== -1 &&
  htmlA.indexOf("3:30 PM – 4:15 PM") === -1 &&
  render.cardRangeLabel(providerA, providerA) === "3:00 PM – 3:30 PM");
check("16. provider B card shows correct component name",
  !!(providerB && providerB.serviceName.indexOf("Pedicure") !== -1 && htmlB.indexOf("Pedicure") !== -1));
check("17. provider B card shows that component's start-end",
  htmlB.indexOf("3:30 PM – 4:15 PM") !== -1 &&
  htmlB.indexOf("3:00 PM – 3:30 PM") === -1 &&
  render.cardRangeLabel(providerB, providerB) === "3:30 PM – 4:15 PM");
check("18. both cards still open the same appointment",
  splitCards.length === 2 &&
  providerA.appointmentId === "appt_split" &&
  providerB.appointmentId === "appt_split");

const sameDoc = apptModel.fromDoc("appt_same", {
  appointmentId: "appt_same",
  status: "scheduled",
  locationId: "locA",
  dateKey: "2026-09-16",
  clientSnapshot: { displayName: "Shiri A" },
  serviceLines: [
    Object.assign({}, splitDoc.serviceLines[0], { providerId: "nicole", lineId: "s1" }),
    Object.assign({}, splitDoc.serviceLines[1], { providerId: "nicole", lineId: "s2" })
  ]
});
const sameCards = cal.cardsFrom([sameDoc], "locA");
const sameHtml = render.cardInnerHtml(sameCards[0], sameCards[0]);
check("19. same-provider Combo remains readable",
  sameCards.length === 1 &&
  sameHtml.indexOf("Shiri A") !== -1 &&
  sameHtml.indexOf("Mani Pedi") !== -1 &&
  sameHtml.indexOf("Manicure") !== -1 &&
  sameHtml.indexOf("Pedicure") !== -1 &&
  sameHtml.indexOf("3:00 PM – 3:30 PM") !== -1 &&
  sameHtml.indexOf("3:30 PM – 4:15 PM") !== -1);

const singleCards = cal.cardsFrom([{
  appointmentId: "plain",
  status: "scheduled",
  clientSnapshot: { displayName: "Alex" },
  serviceLines: [{
    lineId: "p1",
    providerId: "nicole",
    serviceNameSnapshot: "Gel Manicure",
    startAt: utc(14, 0),
    endAt: utc(14, 45),
    durationMinutes: 45
  }]
}], "locA");
const singleHtml = render.cardInnerHtml(singleCards[0], singleCards[0]);
check("20. normal Single appointment remains unchanged",
  singleCards.length === 1 &&
  !singleCards[0].comboName &&
  !render.isComboCard(singleCards[0]) &&
  singleHtml.indexOf("Combo") === -1 &&
  singleHtml.indexOf("Alex") !== -1 &&
  singleHtml.indexOf("Gel Manicure") !== -1 &&
  singleHtml.indexOf("2:00 PM – 2:45 PM") !== -1);

const multiCards = cal.cardsFrom([{
  appointmentId: "multi",
  status: "scheduled",
  clientSnapshot: { displayName: "Alex" },
  serviceLines: [
    {
      lineId: "m1",
      providerId: "nicole",
      serviceNameSnapshot: "Gel Manicure",
      startAt: utc(16, 0),
      endAt: utc(16, 45),
      durationMinutes: 45
    },
    {
      lineId: "m2",
      providerId: "ashley",
      serviceNameSnapshot: "Regular Pedicure",
      startAt: utc(16, 0),
      endAt: utc(16, 30),
      durationMinutes: 30
    }
  ]
}], "locA");
const multiHtml = multiCards.map(function (card) { return render.cardInnerHtml(card, card); }).join("\n");
check("21. normal multi-service appointment remains unchanged",
  multiCards.length === 2 &&
  multiCards.every(function (card) { return !card.comboName && !render.isComboCard(card); }) &&
  multiHtml.indexOf("Combo") === -1 &&
  multiHtml.indexOf("Gel Manicure") !== -1 &&
  multiHtml.indexOf("Regular Pedicure") !== -1);

check("combo short-card CSS keeps time visible without restyling all cards",
  cardCss.indexOf(".ff-cal-card.is-combo:not(.is-stack) .ff-cal-card-time") !== -1 &&
  /flex:\s*0 0 auto/.test(cardCss.slice(cardCss.indexOf(".ff-cal-card.is-combo:not(.is-stack) .ff-cal-card-time"))) &&
  cardCss.indexOf(".ff-cal-card.is-combo.is-compact:not(.is-stack)") !== -1 &&
  cardCss.indexOf(".ff-cal-card.is-combo.is-tiny .ff-cal-card-svc") !== -1);

if (failed) {
  console.error(failed + " Calendar card info tests failed.");
  process.exit(1);
}
console.log("All Calendar card info tests passed.");
