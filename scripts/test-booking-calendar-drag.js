/**
 * Calendar drag drop helpers. No Firestore writes.
 * Usage: node scripts/test-booking-calendar-drag.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function load(rel, windowObj) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  new Function("window", "document", src)(windowObj, { readyState: "complete" });
}

const windowObj = {};
load("public/booking/calendar-layout.js", windowObj);
load("public/booking/calendar-drag.js", windowObj);

const drag = windowObj.ffBookingCalDrag;
const px = 72 / 60;
const quarterPx = 15 * px;
let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

const hold = {
  kind: "hold",
  lineKey: "k1",
  fromProviderId: "koko",
  fromStartMin: 12 * 60 + 30
};

check("same provider and time is not a drop", drag.dropAction(hold, {
  providerId: "koko",
  startMin: 12 * 60 + 30
}) === null);

const toBobo = drag.dropAction(hold, { providerId: "bobo", startMin: 12 * 60 + 30 });
check("other provider is a drop", !!(toBobo && toBobo.providerId === "bobo" && toBobo.startMin === 750));

const later = drag.dropAction(hold, { providerId: "koko", startMin: 14 * 60 });
check("same provider later time is a drop", !!(later && later.startMin === 14 * 60 && later.providerId === "koko"));

check("hold without key cannot drop", drag.dropAction({
  kind: "hold",
  lineKey: "",
  fromProviderId: "koko",
  fromStartMin: 750
}, { providerId: "bobo", startMin: 750 }) === null);

const card = drag.dropAction({
  kind: "card",
  appointmentId: "a1",
  lineId: "l1",
  fromProviderId: "koko",
  fromStartMin: 750
}, { providerId: "bobo", startMin: 13 * 60 });
check("saved service can move provider and time", !!(card && card.source.appointmentId === "a1" && card.startMin === 13 * 60));

check("missing hit is not a drop", drag.dropAction(hold, null) === null);
check("consumeClick starts false", drag.consumeClick() === false);
check("clicking a saved card opens details", drag.releaseOpensDetails({
  kind: "card",
  appointmentId: "a1",
  lineId: "l1"
}, null) === true);
check("a real drop does not open details", drag.releaseOpensDetails({
  kind: "card",
  appointmentId: "a1",
  lineId: "l1"
}, { providerId: "bobo", startMin: 800 }) === false);
check("a hold click does not open details", drag.releaseOpensDetails({
  kind: "hold",
  lineKey: "k1"
}, null) === false);
check("drag starts after a real move, not a tap", drag.THRESHOLD >= 8);

const at930 = { kind: "hold", lineKey: "k1", fromProviderId: "ashley", fromStartMin: 9 * 60 + 30, durationMinutes: 60 };
const plus15 = drag.previewFromDelta(at930, quarterPx, "ashley", { startMin: 8 * 60, endMin: 19 * 60 });
check("drag 15 minutes lands on :45", !!(plus15 && plus15.startMin === 9 * 60 + 45));
const plus8 = drag.previewFromDelta(at930, 8, "ashley", { startMin: 8 * 60, endMin: 19 * 60 });
check("small nudge stays on :30", !!(plus8 && plus8.startMin === 9 * 60 + 30));
const minus15 = drag.previewFromDelta(at930, -quarterPx, "ashley", { startMin: 8 * 60, endMin: 19 * 60 });
check("drag back 15 minutes lands on :15", !!(minus15 && minus15.startMin === 9 * 60 + 15));
const plus30 = drag.previewFromDelta(at930, quarterPx * 2, "nicole", { startMin: 8 * 60, endMin: 19 * 60 });
check("drag 30 minutes and change provider", !!(plus30 && plus30.startMin === 10 * 60 && plus30.providerId === "nicole"));
const deltaDrop = drag.dropAction(at930, { providerId: "ashley", dy: quarterPx, axis: { startMin: 8 * 60, endMin: 19 * 60 } });
check("dropAction uses pointer delta", !!(deltaDrop && deltaDrop.startMin === 9 * 60 + 45));
const toNicole = drag.previewFromDelta(at930, 0, "nicole", { startMin: 8 * 60, endMin: 19 * 60 });
check("same time other provider is a move", !!(toNicole && toNicole.providerId === "nicole" && toNicole.startMin === 9 * 60 + 30));
check("saved card to another provider needs confirm", drag.isProviderChange(card) === true);
check("same-provider time change does not ask", drag.isProviderChange(later) === false);
check("hold to another provider does not ask", drag.isProviderChange(toBobo) === false);
check(
  "move prompt names both providers",
  drag.providerMovePrompt("Ashley", "Nicole") === "Are you sure you want to move this appointment from Ashley to Nicole?"
);
check(
  "requested move prompt warns",
  drag.providerMovePrompt("Nicole", "Ashley", true) === "Pay attention, this is a requested appointment. Are you sure you want to move it from Nicole to Ashley? Keep the request for Ashley, or move without a request?"
);
check(
  "requested move can keep the heart",
  drag.requestedMoveActions("Ashley").keep === "Move as request to Ashley" &&
    drag.moveAskResult("request").keepRequest === true
);
check(
  "requested move can drop the heart",
  drag.requestedMoveActions("Ashley").drop === "Move without request to Ashley" &&
    drag.moveAskResult("plain").keepRequest === false
);
check("regular move stays a simple confirm", drag.moveAskResult("yes").ok === true && drag.moveAskResult("yes").keepRequest == null);
check("canceling a move does not apply", drag.moveAskResult("no").ok === false);
check("a focused service drags only that line", drag.dragLines({
  solo: true,
  lineId: "s2",
  lineIds: ["s1", "s2"]
}).join(",") === "s2");
check("readSource applies solo after the card object", fs.readFileSync(path.join(root, "public/booking/calendar-drag.js"), "utf8").indexOf("return applySolo(source, card, el);") !== -1);
check("without focus the whole visit moves", drag.dragLines({
  lineId: "s1",
  lineIds: ["s1", "s2"]
}).join(",") === "s1,s2");
const dragSrc = fs.readFileSync(path.join(root, "public/booking/calendar-drag.js"), "utf8");
const calCss = fs.readFileSync(path.join(root, "public/booking/calendar.css"), "utf8");
check("move uses an in-app dialog", dragSrc.indexOf("ff-cal-move") !== -1 && dragSrc.indexOf("window.confirm") === -1);
check("requested move writes the heart choice", dragSrc.indexOf("keepRequest === true") !== -1 && dragSrc.indexOf("keepRequest === false") !== -1);
check("staff names are extra bold", /ff-cal-emp-label[\s\S]*font-weight:\s*800/.test(calCss));

if (failed) {
  console.error(failed + " calendar drag helper tests failed.");
  process.exit(1);
}
console.log("All calendar drag helper tests passed.");
