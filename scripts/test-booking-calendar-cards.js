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
load("public/booking/schedule-board.js", windowObj);
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
check("card keeps visit status", cards[0].status === "scheduled");
check("regular card is not a first visit", cards[0].firstVisit === false);
check("named provider is not a request by default", cards[0].requested === false);
const requestedCards = data.cardsFrom([{
  appointmentId: "r1",
  status: "confirmed",
  clientSnapshot: { displayName: "Jenny" },
  serviceLines: [{
    lineId: "rl1",
    providerId: "nicole",
    serviceNameSnapshot: "mani",
    requested: true,
    startAt: utc(15, 0),
    endAt: utc(15, 30),
    durationMinutes: 30
  }]
}], "locA");
check("requested line is marked on the card", requestedCards[0] && requestedCards[0].requested === true);
const newClientCards = data.cardsFrom([{
  appointmentId: "n1",
  status: "scheduled",
  firstVisit: true,
  clientSnapshot: { displayName: "New Person" },
  serviceLines: [{
    lineId: "nl1",
    providerId: "bobo",
    serviceNameSnapshot: "Gel",
    startAt: utc(11, 0),
    endAt: utc(12, 0),
    durationMinutes: 60
  }]
}], "locA");
check("first-visit card is marked", newClientCards[0] && newClientCards[0].firstVisit === true);
check("cancelled omitted", !cards.some(function (c) { return c.appointmentId === "a2"; }));
check("client snapshot used", cards[0].clientName === "Jessica Miller");
check("service snapshot used", cards[0].serviceName === "Gel Manicure");
check("60 min height math", layout.durationToHeight(60) === 72);
check("45 min height math", layout.durationToHeight(45) === 54);
check("30 min height math", layout.durationToHeight(30) === 36);
check("30 min cards use compact type", render.densityClass(30) === "is-compact");
check("15 min cards use tiny type", render.densityClass(15) === "is-tiny");
check("60 min cards stay regular", render.densityClass(60) === "");
check("90 min height math", layout.durationToHeight(90) === 108);
check("10:15 clock", render.clock(14 * 60 + 15) === "2:15 PM");
check("10:15 label", render.clock(10 * 60 + 15) === "10:15 AM");
check("card time range is start and end", render.rangeLabel(15 * 60, 16 * 60) === "3:00 PM – 4:00 PM");
check("isActiveStatus hides cancelled", model.isActiveStatus("cancelled") === false);

const multiCards = data.cardsFrom([{
  appointmentId: "A123",
  status: "scheduled",
  clientSnapshot: { displayName: "Shiri A" },
  serviceLines: [
    { lineId: "l1", providerId: "koko", serviceNameSnapshot: "Manicure", startAt: utc(15, 45), endAt: utc(16, 45), durationMinutes: 60 },
    { lineId: "l2", providerId: "bobo", serviceNameSnapshot: "Pedicure", startAt: utc(16, 45), endAt: utc(17, 45), durationMinutes: 60 }
  ]
}], "locA");
const partyCards = data.cardsFrom([{
  appointmentId: "P2",
  status: "scheduled",
  clientSnapshot: { displayName: "Allen mora" },
  serviceLines: [
    { lineId: "p1", providerId: "bobo", serviceNameSnapshot: "UV Gel Pedi", startAt: utc(15, 30), endAt: utc(16, 30), durationMinutes: 60 },
    { lineId: "p2", providerId: "koko", serviceNameSnapshot: "Pedicure", startAt: utc(16, 0), endAt: utc(16, 30), durationMinutes: 30 }
  ]
}], "locA");
check("same client extra service is still one person", partyCards.length === 2 && partyCards[0].partySize === 1 && partyCards[1].partySize === 1);
const stackedCards = data.cardsFrom([{
    appointmentId: "S1",
  clientId: "cli_shiri",
  status: "confirmed",
  clientSnapshot: { displayName: "Shiri A" },
  serviceLines: [
    { lineId: "s1", providerId: "nicole", serviceNameSnapshot: "mani", startAt: utc(15, 15), endAt: utc(15, 45), durationMinutes: 30, requested: true },
    { lineId: "s2", providerId: "nicole", serviceNameSnapshot: "Dip Mani / UV Gel Pedi", startAt: utc(15, 45), endAt: utc(17, 45), durationMinutes: 120 }
  ]
}], "locA");
check("add service on the same person stays one card", stackedCards.length === 1);
check("stacked card keeps the client name", stackedCards[0] && stackedCards[0].clientName === "Shiri A");
check("stacked card joins both services", stackedCards[0] && stackedCards[0].serviceName.indexOf("mani") !== -1 && stackedCards[0].serviceName.indexOf("Dip Mani / UV Gel Pedi") !== -1);
check("stacked card spans first start to last end", stackedCards[0] && stackedCards[0].startMin === 15 * 60 + 15 && stackedCards[0].endMin === 17 * 60 + 45);
check("stacked card is not two people", stackedCards[0] && stackedCards[0].partySize === 1);
check("stacked card keeps the request heart", stackedCards[0] && stackedCards[0].requested === true);
check("stacked card keeps timed segments", !!(stackedCards[0] && stackedCards[0].segments && stackedCards[0].segments.length === 2 && stackedCards[0].segments[0].endMin === stackedCards[0].segments[1].startMin));
check("card keeps the client key for hover", stackedCards[0] && stackedCards[0].clientKey === "cli_shiri");
const splitClient = data.cardsFrom([{
  appointmentId: "A1",
  clientId: "cli_neymar",
  status: "confirmed",
  clientSnapshot: { displayName: "Neymar Carrero" },
  serviceLines: [{
    lineId: "n1", providerId: "luz", serviceNameSnapshot: "Pedicure",
    startAt: utc(16, 15), endAt: utc(17, 0), durationMinutes: 45
  }]
}, {
  appointmentId: "A2",
  clientId: "cli_neymar",
  status: "confirmed",
  clientSnapshot: { displayName: "Neymar Carrero" },
  serviceLines: [{
    lineId: "n2", providerId: "bibiana", serviceNameSnapshot: "UV Gel Mani",
    startAt: utc(11, 0), endAt: utc(12, 30), durationMinutes: 90
  }]
}], "locA");
check("same client shares a highlight key", splitClient.length === 2 && splitClient[0].clientKey === "cli_neymar" && splitClient[1].clientKey === "cli_neymar");
const guestCards = data.cardsFrom([{
  appointmentId: "G1",
  status: "scheduled",
  clientSnapshot: { displayName: "Allen mora" },
  serviceLines: [
    { lineId: "g1", providerId: "koko", serviceNameSnapshot: "UV Gel Pedi", startAt: utc(16, 0), endAt: utc(17, 0), durationMinutes: 60 },
    { lineId: "g2", providerId: "bobo", serviceNameSnapshot: "UV Gel Pedi", startAt: utc(16, 0), endAt: utc(17, 0), durationMinutes: 60, guestName: "Sara" }
  ]
}], "locA");
check("named guest card uses the guest name", guestCards[1].clientName === "Sara");
check("booker card keeps the booker name", guestCards[0].clientName === "Allen mora");
const threeCards = data.cardsFrom([{
  appointmentId: "G3",
  status: "scheduled",
  clientSnapshot: { displayName: "Allen mora" },
  serviceLines: [
    { lineId: "a", providerId: "bobo", serviceNameSnapshot: "UV Gel Mani / Reg Pedi", startAt: utc(15, 30), endAt: utc(17, 0), durationMinutes: 90 },
    { lineId: "b", providerId: "koko", serviceNameSnapshot: "UV Gel Mani / Reg Pedi", startAt: utc(15, 30), endAt: utc(17, 0), durationMinutes: 90, guestKey: "g_1" },
    { lineId: "c", providerId: "bobo", serviceNameSnapshot: "Manicure / Pedicure", startAt: utc(17, 0), endAt: utc(17, 45), durationMinutes: 45, guestKey: "g_2" }
  ]
}], "locA");
check("group of 3 shows 3 people on every card", threeCards.length === 3 && threeCards.every(function (card) { return card.partySize === 3; }));
check("T one card per service line", multiCards.length === 2);
check("U both cards share appointmentId", multiCards[0].appointmentId === "A123" && multiCards[1].appointmentId === "A123");
check("each card keeps its line and provider", multiCards[0].lineId === "l1" && multiCards[1].providerId === "bobo");

const overlap = render.overlapLanes([
  { providerId: "bobo", startMin: 615, endMin: 675 },
  { providerId: "bobo", startMin: 630, endMin: 690 }
]);
check("overlap uses a second lane", overlap[0].lane === 0 && overlap[1].lane === 1);
check("overlap laneCount is two", overlap[0].laneCount === 2 && overlap[1].laneCount === 2);
const renderSrc = fs.readFileSync(path.join(root, "public/booking/appointments/calendar-render.js"), "utf8");
const cardCss = fs.readFileSync(path.join(root, "public/booking/appointments/calendar-cards.css"), "utf8");
check("calendar request uses a card class", renderSrc.indexOf("is-requested") !== -1);
check("calendar request is not the word Request", renderSrc.indexOf('ff-cal-card-req">Request') === -1 && renderSrc.indexOf("ff-cal-card-pin") === -1);
check("request mark is a black heart", cardCss.indexOf(".ff-cal-card.is-requested::before") !== -1 && cardCss.indexOf("♥") !== -1 && cardCss.indexOf("#111111") !== -1);
check(
  "card shows name then service then time",
  renderSrc.lastIndexOf('class="ff-cal-card-name"') < renderSrc.lastIndexOf("servicesHtml(card)")
    && renderSrc.lastIndexOf("servicesHtml(card)") < renderSrc.lastIndexOf('class="ff-cal-card-time"')
);
check("card text is uniform black", cardCss.indexOf(".ff-cal-card-name,") !== -1 && cardCss.indexOf("color: #111111") !== -1);
check("client name is bold", /\.ff-cal-card-name \{[\s\S]*?font-weight:\s*700/.test(cardCss));
check("card time is not bold", /\.ff-cal-card-time \{[\s\S]*?font-weight:\s*400/.test(cardCss));
check("status does not recolor card text", cardCss.indexOf(".ff-cal-card.is-status-scheduled .ff-cal-card-svc") === -1);
check("segment height follows service duration", render.segmentShare({ startMin: 15 * 60 + 45, endMin: 16 * 60 + 15 }, 15 * 60 + 45, 17 * 60).height === 40);
check("next segment starts where the first ends", render.segmentShare({ startMin: 16 * 60 + 15, endMin: 17 * 60 }, 15 * 60 + 45, 17 * 60).top === 40);
check("stack header names the client and count", render.stackHtml({
  clientName: "Shiri A",
  startMin: 15 * 60 + 45,
  endMin: 17 * 60,
  segments: [
    { serviceName: "mani", startMin: 15 * 60 + 45, endMin: 16 * 60 + 15 },
    { serviceName: "Manicure / Pedicure", startMin: 16 * 60 + 15, endMin: 17 * 60 }
  ]
}).indexOf("Shiri A") !== -1 && render.stackHtml({
  clientName: "Shiri A",
  startMin: 15 * 60 + 45,
  endMin: 17 * 60,
  segments: [
    { serviceName: "mani", startMin: 15 * 60 + 45, endMin: 16 * 60 + 15 },
    { serviceName: "Manicure / Pedicure", startMin: 16 * 60 + 15, endMin: 17 * 60 }
  ]
}).indexOf("2 services") !== -1);
check("30 min segment uses a compact layout", render.segmentDensity(30) === " is-tight");
check("first segment keeps its own time", (function () {
  var html = render.stackHtml({
    clientName: "Shiri A",
    startMin: 15 * 60 + 45,
    endMin: 17 * 60,
    segments: [
      { serviceName: "mani", startMin: 15 * 60 + 45, endMin: 16 * 60 + 15, durationMinutes: 30 },
      { serviceName: "Manicure / Pedicure", startMin: 16 * 60 + 15, endMin: 17 * 60, durationMinutes: 45 }
    ]
  });
  return html.indexOf("3:45 PM") !== -1 && html.indexOf("4:15 PM") !== -1 && html.indexOf("5:00 PM") !== -1 && html.indexOf("is-first") !== -1;
})());
check("stack uses an inner divider only", render.stackHtml({
  clientName: "Shiri A",
  startMin: 15 * 60 + 45,
  endMin: 17 * 60,
  segments: [
    { serviceName: "mani", startMin: 15 * 60 + 45, endMin: 16 * 60 + 15 },
    { serviceName: "Manicure / Pedicure", startMin: 16 * 60 + 15, endMin: 17 * 60 }
  ]
}).indexOf("is-next") !== -1 && cardCss.indexOf("border-radius: 0") !== -1);
check("one card is one appointment click target", renderSrc.indexOf("data-ff-cal-card") !== -1 && cardCss.indexOf(".ff-cal-card.is-stack") !== -1);
check("client hover uses a rose mark", cardCss.indexOf(".ff-cal-card.is-client-on") !== -1 && cardCss.indexOf("#ffe4e6") !== -1);
check("calendar cards expose the client key", renderSrc.indexOf("data-ff-cal-client") !== -1);
check("client highlight is exported", typeof render.highlightClient === "function");
check("each stacked service can be focused", render.stackHtml({
  clientName: "Shiri A",
  startMin: 15 * 60 + 45,
  endMin: 17 * 60,
  segments: [
    { lineId: "s1", serviceName: "mani", startMin: 15 * 60 + 45, endMin: 16 * 60 + 15, durationMinutes: 30 },
    { lineId: "s2", serviceName: "Manicure / Pedicure", startMin: 16 * 60 + 15, endMin: 17 * 60, durationMinutes: 45 }
  ]
}).indexOf('data-ff-cal-seg="s2"') !== -1);

if (failed) process.exit(1);
console.log("All Calendar card helper tests passed.");
