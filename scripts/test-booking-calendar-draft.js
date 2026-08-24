/**
 * Temporary New Appointment hold preview. No Firestore writes.
 * Usage: node scripts/test-booking-calendar-draft.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function load(rel, windowObj) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  new Function("window", "document", src)(windowObj, undefined);
}

const windowObj = { document: undefined };
load("public/booking/calendar-draft.js", windowObj);

const draft = windowObj.ffBookingCalDraft;
let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

const empty = draft.bodyHtml({
  startMin: 11 * 60 + 15,
  durationMinutes: 30,
  title: "",
  clientName: ""
});
check("empty hold keeps Hold · time", empty === '<span class="ff-cal-hold-meta">Hold · 11:15 AM</span>', empty);

const clientOnly = draft.bodyHtml({
  startMin: 11 * 60 + 15,
  durationMinutes: 30,
  title: "",
  clientName: "Shiri A"
});
check(
  "client only shows name + Hold",
  clientOnly ===
    '<span class="ff-cal-hold-name">Shiri A</span><span class="ff-cal-hold-meta">Hold · 11:15 AM</span>',
  clientOnly
);

const serviceOnly = draft.bodyHtml({
  startMin: 11 * 60 + 15,
  durationMinutes: 60,
  title: "Manicure",
  clientName: ""
});
check(
  "service only shows service + range",
  serviceOnly ===
    '<span class="ff-cal-hold-name">Manicure</span><span class="ff-cal-hold-time">11:15 AM – 12:15 PM</span>',
  serviceOnly
);

const both = draft.bodyHtml({
  startMin: 11 * 60 + 15,
  durationMinutes: 60,
  title: "Manicure",
  clientName: "Shiri A"
});
check(
  "client + service shows three lines",
  both ===
    '<span class="ff-cal-hold-name">Shiri A</span><span class="ff-cal-hold-svc">Manicure</span><span class="ff-cal-hold-time">11:15 AM – 12:15 PM</span>',
  both
);

check("duration drives end time", draft.formatTime(11 * 60 + 15 + 45) === "12:00 PM");
check("escapes client HTML", draft.bodyHtml({
  startMin: 600,
  clientName: "<b>X</b>",
  title: ""
}).indexOf("&lt;b&gt;X&lt;/b&gt;") !== -1);

if (failed) process.exit(1);
console.log("All Calendar draft preview tests passed.");
