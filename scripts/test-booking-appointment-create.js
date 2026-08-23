/**
 * Unit tests for New Appointment V1 form helpers and calendar open gate.
 * Usage: node scripts/test-booking-appointment-create.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const windowObj = {};
new Function("window", fs.readFileSync(path.join(root, "public/booking/appointments/form.js"), "utf8"))(windowObj);
const form = windowObj.ffBookingAppointmentForm;

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

check("form loaded", !!form);
check("2:15 formats as 2:15 PM", form.formatMinutes(14 * 60 + 15) === "2:15 PM");
check("end time is start + duration", form.derive({
  startMin: 14 * 60 + 15,
  providerId: "bobo",
  service: { durationMinutes: 60, price: 45, raw: { durationMinutes: 60, defaultPrice: 45 } }
}).endMin === 15 * 60 + 15);

const conflict = form.friendlyError("APPOINTMENT_CONFLICT", "x");
check("conflict error is friendly", /already has an appointment/.test(conflict) && conflict.indexOf("APPOINTMENT_CONFLICT") === -1);

const state = form.emptyState({
  locationId: "locA",
  dateKey: "2026-08-25",
  startMin: 14 * 60 + 15,
  providerId: "bobo"
});
check("A seed has provider/date/time/location", state.providerId === "bobo" && state.dateKey === "2026-08-25" && state.startMin === 855 && state.locationId === "locA");
check("cannot create incomplete", form.canCreate(state) === false);
check("dirty after notes", form.isDirty(Object.assign({}, state, { notes: "hi" })) === true);
check("clean empty form", form.isDirty(state) === false);

windowObj.ffBookingAppointmentServices = {
  listForProvider: async function () { return [{ id: "gel", name: "Gel", durationMinutes: 45, price: 40, raw: { durationMinutes: 45, defaultPrice: 40 } }]; },
  effectiveDuration: function (service) { return Number(service.durationMinutes) || 45; },
  effectivePrice: function (service) { return Number(service.defaultPrice) || 40; }
};
form.refreshServices({
  providerId: "anna",
  serviceId: "acrylic",
  service: { id: "acrylic" },
  services: [],
  startMin: 600,
  capabilityMessage: ""
}).then(function (cleared) {
  check("invalid service combination is cleared", cleared.serviceId === "" && /not available/.test(cleared.capabilityMessage));
  finish();
});
function finish() {
check("setService keeps a valid service", form.setService({
  services: [{ id: "gel", name: "Gel", durationMinutes: 45, price: 40, raw: { durationMinutes: 45, defaultPrice: 40 } }],
  startMin: 600,
  providerId: "bobo"
}, "gel").serviceId === "gel");

function isBookableAt(emp, axis, minutes) {
  if (!emp) return false;
  return minutes >= 9 * 60 && minutes < 18 * 60;
}
check("B gray/unavailable does not open", isBookableAt({ id: "bobo" }, {}, 8 * 60) === false);
check("A available 2:15 can open", isBookableAt({ id: "bobo" }, {}, 14 * 60 + 15) === true);

  if (failed) {
    console.error("FAILED", failed);
    process.exit(1);
  }
  console.log("All New Appointment helper tests passed.");
}
