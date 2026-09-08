/**
 * Appointment visit-flow colors and next-step actions.
 * Usage: node scripts/test-booking-appointment-status.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const windowObj = {};
new Function("window", fs.readFileSync(path.join(root, "public/booking/appointments/status.js"), "utf8"))(windowObj);
const status = windowObj.ffBookingAppointmentStatus;

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

check("model loaded", !!status);
check("new bookings wait for confirmation", status.label("scheduled") === "Waiting for confirmation");
check("checked out label", status.label("completed") === "Checked Out");
check("card class uses the status", status.cardClass("checked_in") === "is-status-checked_in");
check("scheduled offers confirm and check in", status.actions("scheduled").map(function (a) { return a.id; }).join(",") === "confirm,check-in");
check("confirm button says Confirm Appointment", status.actions("scheduled")[0].label === "Confirm Appointment");
check("confirmed offers check in", status.actions("confirmed").map(function (a) { return a.next; }).join(",") === "checked_in");
check("checked in starts service", status.actions("checked_in")[0].next === "in_service");
check("in service checks out", status.actions("in_service")[0].next === "completed");
check("checked out has no next step", status.actions("completed").length === 0);
check("cannot skip to checkout from check-in", status.canAdvanceTo("checked_in", "completed") === false);
check("can start service after check-in", status.canAdvanceTo("checked_in", "in_service") === true);

const css = fs.readFileSync(path.join(root, "public/booking/appointments/calendar-cards.css"), "utf8");
check("calendar colors scheduled", css.indexOf(".ff-cal-card.is-status-scheduled") !== -1);
check("calendar colors checked in", css.indexOf(".ff-cal-card.is-status-checked_in") !== -1);
check("calendar colors in service", css.indexOf(".ff-cal-card.is-status-in_service") !== -1);
check("calendar colors completed", css.indexOf(".ff-cal-card.is-status-completed") !== -1);
check("new-client badge stays on the card", css.indexOf(".ff-cal-card-new") !== -1);
check("unconfirmed cards keep scheduled orange", css.indexOf(".ff-cal-card.is-status-scheduled") !== -1);
check("confirmed new client turns light pink", css.indexOf(".ff-cal-card.is-new-client.is-status-confirmed") !== -1);

if (failed) {
  console.error("FAILED", failed);
  process.exit(1);
}
console.log("All Appointment status flow checks passed.");
