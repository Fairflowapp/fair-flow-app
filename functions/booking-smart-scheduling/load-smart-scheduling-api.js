/**
 * Load Phase 1–18D Smart Scheduling + Booking model into a Node window.
 * Used by the callable handler and Phase 18F tests. Loads generated
 * runtime copies only — never repository public/.
 */
"use strict";

const { filesForGroup } = require("./runtime-manifest");
const { readRuntimeSource } = require("./runtime-paths");

function loadSmartSchedulingApi(windowOverrides) {
  const windowObj = Object.assign({
    settings: { preferences: { salonTimeZone: "America/New_York" } }
  }, windowOverrides || {});
  filesForGroup("smartSchedulingApi").forEach(function (rel) {
    new Function("window", readRuntimeSource(rel))(windowObj);
  });
  const api = windowObj.ffBookingSmartScheduling;
  if (!api || typeof api.evaluateAtomicMutation !== "function") {
    throw new Error("Smart Scheduling atomic API failed to load.");
  }
  api.bookingAppointmentModel = windowObj.ffBookingAppointmentModel || null;
  return api;
}

module.exports = {
  loadSmartSchedulingApi: loadSmartSchedulingApi
};
