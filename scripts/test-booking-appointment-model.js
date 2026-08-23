/**
 * Unit tests for the Booking Appointment model.
 * Usage: node scripts/test-booking-appointment-model.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const windowObj = {
  settings: { preferences: { salonTimeZone: "America/New_York" } },
};
new Function("window", fs.readFileSync(path.join(root, "public/booking/calendar-time.js"), "utf8"))(windowObj);
new Function("window", fs.readFileSync(path.join(root, "public/booking/appointments/model.js"), "utf8"))(windowObj);
const model = windowObj.ffBookingAppointmentModel;
if (!model) {
  console.error("Appointment model did not load.");
  process.exit(1);
}

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

check("statuses include scheduled through no_show", model.STATUSES.join(",") === "scheduled,confirmed,checked_in,in_service,completed,cancelled,no_show");
check("cancelled is not an active blocker", model.isActiveStatus("cancelled") === false);
check("scheduled is active", model.isActiveStatus("scheduled") === true);
check("sources are controlled", model.SOURCES.join(",") === "front_desk,phone,online,walk_in,internal");
check("assignment types are controlled", model.ASSIGNMENT_TYPES.join(",") === "specific_provider,any_provider");

const ten = new Date("2026-08-29T14:00:00.000Z");
const eleven = new Date("2026-08-29T15:00:00.000Z");
const eleven30 = new Date("2026-08-29T15:30:00.000Z");
const twelve = new Date("2026-08-29T16:00:00.000Z");
check("overlap 10-11 vs 10:45-11:45", model.intervalsOverlap(ten, eleven, new Date("2026-08-29T14:45:00.000Z"), eleven30) === true);
check("back-to-back 10-11 and 11-12 allowed", model.intervalsOverlap(ten, eleven, eleven, twelve) === false);

const civil = model.civilToDate("2026-08-29", 10 * 60, "locA");
check("civilToDate returns a Date", civil instanceof Date && !Number.isNaN(civil.getTime()));
check(
  "dateKeyOf uses location timezone",
  model.dateKeyOf(civil, "locA") === "2026-08-29"
);

const derived = model.deriveWindow([
  { startAt: new Date("2026-08-29T14:00:00.000Z"), endAt: new Date("2026-08-29T15:00:00.000Z") },
  { startAt: new Date("2026-08-29T14:30:00.000Z"), endAt: new Date("2026-08-29T15:15:00.000Z") },
]);
check("derive start is earliest line", derived.startAt.getTime() === Date.parse("2026-08-29T14:00:00.000Z"));
check("derive end is latest line", derived.endAt.getTime() === Date.parse("2026-08-29T15:15:00.000Z"));

check(
  "staffOverrides enabled:false is incapable",
  model.isProviderCapable({ staffOverrides: { provA: { enabled: false } } }, "provA") === false
);
check(
  "missing staffOverrides stays capable (Operations default-allow)",
  model.isProviderCapable({ name: "Gel" }, "provA") === true
);

const clientSnap = model.clientSnapshotFrom({ firstName: "Jessica", lastName: "Miller", phone: "305-555-1212", email: "a@b.com" });
check("client snapshot is display-only", clientSnap.displayName === "Jessica Miller" && clientSnap.phone === "305-555-1212");

const missingLoc = model.normalizeCreateInput({ clientId: "c1", serviceLines: [{ serviceId: "s1" }] });
check("missing location is rejected", missingLoc.ok === false && missingLoc.code === "MISSING_LOCATION");

if (failed) {
  console.error("FAILED", failed);
  process.exit(1);
}
console.log("All Appointment model tests passed.");
