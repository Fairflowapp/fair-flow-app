/**
 * Edit Appointment helpers. No Firestore writes.
 * Usage: node scripts/test-booking-appointment-edit.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function load(rel, windowObj) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  new Function("window", src)(windowObj);
}

const windowObj = {
  settings: { preferences: { salonTimeZone: "America/New_York" } }
};
load("public/booking/calendar-time.js", windowObj);
load("public/booking/appointments/model.js", windowObj);
load("public/booking/appointments/form.js", windowObj);

windowObj.ffBookingAppointmentServices = {
  effectiveDuration: function (service) {
    return Number(service.durationMinutes || service.defaultDurationMinutes) || 45;
  },
  effectivePrice: function (service) {
    return Number(service.defaultPrice != null ? service.defaultPrice : service.price) || 80;
  },
  listForProvider: async function () {
    return [
      { id: "mani", name: "Manicure", durationMinutes: 45, price: 80, raw: { durationMinutes: 45, defaultPrice: 80 } },
      { id: "pedi", name: "Pedicure", durationMinutes: 50, price: 65, raw: { durationMinutes: 50, defaultPrice: 65 } }
    ];
  }
};

const form = windowObj.ffBookingAppointmentForm;
const model = windowObj.ffBookingAppointmentModel;
let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

const seed = {
  appointmentId: "appt_1",
  lineId: "line_1",
  clientId: "cli_1",
  locationId: "locA",
  dateKey: "2026-08-24",
  startMin: 11 * 60 + 15,
  providerId: "koko",
  serviceId: "mani",
  serviceName: "Manicure",
  durationMinutes: 60,
  price: 55,
  notes: "Prefers quiet room"
};

const state = form.editStateFrom(seed);
check("edit initializes date", state.dateKey === "2026-08-24");
check("edit initializes start", state.startMin === 675);
check("edit initializes service", state.serviceId === "mani");
check("edit initializes provider", state.providerId === "koko");
check("edit initializes notes", state.notes === "Prefers quiet room");
check("unchanged service keeps stored duration", state.durationMinutes === 60);
check("unchanged service keeps stored price", state.price === 55);
check("end time is start + stored duration", state.endMin === 675 + 60);
check("save disabled when unchanged", form.isEditDirty(state) === false && form.canSave(state) === false);

const moved = form.setStart(Object.assign({}, state, { original: state.original, keepStoredSnapshots: true, originalServiceId: "mani", storedDurationMinutes: 60, storedPrice: 55, service: state.service, serviceId: "mani" }), 12 * 60);
check("start change updates end", moved.endMin === 12 * 60 + 60);
check("start change is dirty", form.isEditDirty(moved) === true && form.canSave(moved) === true);

const reverted = form.setStart(moved, 11 * 60 + 15);
check("reverting start clears dirty", form.isEditDirty(reverted) === false);

const other = form.setService({
  services: [
    { id: "mani", name: "Manicure", durationMinutes: 45, price: 80, raw: { durationMinutes: 45, defaultPrice: 80 } },
    { id: "pedi", name: "Pedicure", durationMinutes: 50, price: 65, raw: { durationMinutes: 50, defaultPrice: 65 } }
  ],
  startMin: 675,
  providerId: "koko",
  keepStoredSnapshots: true,
  originalServiceId: "mani",
  storedDurationMinutes: 60,
  storedPrice: 55,
  original: state.original,
  appointmentId: "appt_1",
  locationId: "locA",
  dateKey: "2026-08-24",
  notes: "Prefers quiet room"
}, "pedi");
check("new service updates duration", other.durationMinutes === 50);
check("new service updates price", other.price === 65);
check("new service updates end", other.endMin === 675 + 50);

const patch = form.editPatch(state);
check("patch keeps appointment identity fields out", !patch.clientId && !patch.locationId && !patch.appointmentId);
check("same-service patch preserves price snapshot", patch.serviceLines[0].preservePriceSnapshot === true);
check("same-service patch keeps stored price", patch.serviceLines[0].priceSnapshot === 55);

const existing = [{
  lineId: "line_1",
  serviceId: "mani",
  providerId: "koko",
  startAt: new Date("2026-08-24T15:15:00.000Z"),
  endAt: new Date("2026-08-24T16:15:00.000Z"),
  durationMinutes: 60,
  priceSnapshot: 55,
  serviceNameSnapshot: "Manicure"
}];
const mergedSame = model.mergeServiceLinePatch(existing, [{
  lineId: "line_1",
  serviceId: "mani",
  providerId: "koko",
  startAt: new Date("2026-08-24T16:00:00.000Z"),
  durationMinutes: 60
}]);
check("merge preserves price when service unchanged", mergedSame[0].priceSnapshot === 55 && mergedSame[0].preservePriceSnapshot === true);
check("merge preserves service name when unchanged", mergedSame[0].serviceNameSnapshot === "Manicure");

const mergedNew = model.mergeServiceLinePatch(existing, [{
  lineId: "line_1",
  serviceId: "pedi",
  providerId: "koko",
  startAt: new Date("2026-08-24T15:15:00.000Z"),
  durationMinutes: 50,
  priceSnapshot: 65,
  serviceNameSnapshot: "Pedicure"
}]);
check("merge uses new price when service changes", mergedNew[0].priceSnapshot === 65 && mergedNew[0].preservePriceSnapshot === false);

const notesOnly = model.mergeServiceLinePatch(existing, existing);
check("notes-only merge still preserves price", notesOnly[0].priceSnapshot === 55);

const twoLines = model.mergeServiceLinePatch([
  existing[0],
  {
    lineId: "line_2",
    serviceId: "color",
    providerId: "anna",
    durationMinutes: 30,
    priceSnapshot: 40,
    serviceNameSnapshot: "Color"
  }
], [{
  lineId: "line_1",
  serviceId: "mani",
  providerId: "koko",
  durationMinutes: 60
}]);
check("incoming lines replace the stored set", twoLines.length === 1 && twoLines[0].lineId === "line_1");
const added = model.mergeServiceLinePatch(existing, [
  existing[0],
  { serviceId: "pedi", providerId: "bobo", durationMinutes: 60, priceSnapshot: 65, serviceNameSnapshot: "Pedicure" }
]);
check("new line is appended without inheriting first-line price", added.length === 2 && added[1].priceSnapshot === 65 && added[1].serviceId === "pedi");

if (failed) process.exit(1);
console.log("All Edit Appointment helper tests passed.");
