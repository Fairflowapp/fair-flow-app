/**
 * Combo component identity contract for Smart Scheduling.
 * Proves Gel Manicure + Regular Pedicure reach the engine as two real
 * underlying services — never generic "Service" and never one 75-minute Combo.
 * Does not execute appointment moves.
 * Usage: node scripts/test-booking-smart-scheduling-combo-components.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function load(rel, windowObj) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  new Function("window", "document", src)(windowObj, windowObj.document);
}

const windowObj = {
  settings: { preferences: { salonTimeZone: "America/New_York" } },
  document: {
    getElementById: function () { return null; },
    addEventListener: function () {},
    dispatchEvent: function () {},
    documentElement: { getAttribute: function () { return ""; }, setAttribute: function () {} }
  },
  addEventListener: function () {},
  ffGetLocations: function () { return [{ id: "locA", name: "Soso spa" }]; },
  ffBookingCalState: {
    getEmployees: function () {
      return [
        { id: "nicole", firstName: "Nicole" },
        { id: "ashley", firstName: "Ashley" }
      ];
    }
  },
  ffBookingTime: {
    zonedMinutes: function (date) { return date.getUTCHours() * 60 + date.getUTCMinutes(); },
    zonedDateKey: function () { return "2026-09-16"; },
    formatDisplayDate: function () { return "Wednesday, Sep 16, 2026"; }
  }
};

load("public/booking/calendar-time.js", windowObj);
load("public/booking/settings/model.js", windowObj);
load("public/booking/appointments/model.js", windowObj);
const comboSrc = fs.readFileSync(path.join(root, "public/tickets-catalog-combo.js"), "utf8").replace(/^export /gm, "");
new Function("window", comboSrc)(windowObj);
load("public/booking/appointments/combo.js", windowObj);
load("public/booking/appointments/form.js", windowObj);
[
  "public/booking/smart-scheduling/normalize.js",
  "public/booking/smart-scheduling/gaps.js",
  "public/booking/smart-scheduling/candidates.js",
  "public/booking/smart-scheduling/score.js",
  "public/booking/smart-scheduling/engine.js",
  "public/booking/smart-scheduling/moves.js",
  "public/booking/smart-scheduling/day-analysis.js",
  "public/booking/smart-scheduling/priorities.js",
  "public/booking/smart-scheduling/assign.js",
  "public/booking/smart-scheduling/cancellation-recovery.js",
  "public/booking/smart-scheduling/waitlist.js",
  "public/booking/smart-scheduling/recovery-planner.js",
  "public/booking/smart-scheduling/gap-planner.js",
  "public/booking/smart-scheduling/global-plan.js",
  "public/booking/smart-scheduling/salon-plan.js",
  "public/booking/smart-scheduling/multi-service.js"
].forEach(function (rel) { load(rel, windowObj); });

const combo = windowObj.ffBookingAppointmentCombo;
const form = windowObj.ffBookingAppointmentForm;
const ss = windowObj.ffBookingSmartScheduling;

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

const gel = {
  id: "svc-gel",
  name: "Gel Manicure",
  durationMinutes: 45,
  price: 55,
  defaultPrice: 55,
  staffOverrides: { ashley: { enabled: false } },
  raw: { durationMinutes: 45, defaultPrice: 55, staffOverrides: { ashley: { enabled: false } } }
};
const pedi = {
  id: "svc-pedi",
  name: "Regular Pedicure",
  durationMinutes: 30,
  price: 45,
  defaultPrice: 45,
  staffOverrides: {},
  raw: { durationMinutes: 30, defaultPrice: 45, staffOverrides: {} }
};
const comboSvc = {
  id: "svc-combo",
  name: "Gel Mani + Regular Pedi",
  durationMinutes: 75,
  price: 84,
  defaultPrice: 84,
  serviceType: "combo",
  components: [
    { serviceId: "svc-gel", allocatedPrice: 44, sortOrder: 0, serviceNameSnapshot: "Gel Manicure" },
    { serviceId: "svc-pedi", allocatedPrice: 40, sortOrder: 1, serviceNameSnapshot: "Regular Pedicure" }
  ],
  raw: {
    serviceType: "combo",
    defaultPrice: 84,
    durationMinutes: 75,
    components: [
      { serviceId: "svc-gel", allocatedPrice: 44, sortOrder: 0, serviceNameSnapshot: "Gel Manicure" },
      { serviceId: "svc-pedi", allocatedPrice: 40, sortOrder: 1, serviceNameSnapshot: "Regular Pedicure" }
    ]
  }
};
const catalog = [gel, pedi, comboSvc];
const providers = [
  { id: "nicole", firstName: "Nicole" },
  { id: "ashley", firstName: "Ashley" }
];

windowObj.ffBookingAppointmentServices = {
  listAll: async function () { return catalog; },
  listForProvider: async function () { return catalog; },
  isCapable: function (service, providerId) {
    const overrides = service && service.staffOverrides || {};
    const row = overrides[providerId];
    return !(row && row.enabled === false);
  },
  effectiveDuration: function (service) { return Number(service.durationMinutes) || 30; },
  effectivePrice: function (service) { return Number(service.defaultPrice || service.price) || 0; }
};

const state = form.emptyState({
  locationId: "locA",
  dateKey: "2026-09-16",
  startMin: 11 * 60 + 30,
  providerId: "nicole"
});
state.catalogServices = catalog;
state.lines[0].services = catalog;
form.setLineService(state, state.lines[0].key, "svc-combo");

check("combo helper and Smart Scheduling loaded", !!(combo && form && ss && typeof combo.smartSchedulingRequestLines === "function" && typeof ss.recommendMultiServiceVisit === "function"));
check("form expanded two underlying components", state.lines.length === 2
  && state.lines[0].serviceId === "svc-gel"
  && state.lines[1].serviceId === "svc-pedi");

const requestLines = combo.smartSchedulingRequestLines(state.lines, { providers: providers });
check("Smart Scheduling receives two Combo components", requestLines.length === 2);
check("component 1 is Gel Manicure identity", requestLines[0].serviceId === "svc-gel"
  && requestLines[0].serviceName === "Gel Manicure"
  && requestLines[0].durationMinutes === 45
  && requestLines[0].serviceId !== "svc-combo");
check("component 2 is Regular Pedicure identity", requestLines[1].serviceId === "svc-pedi"
  && requestLines[1].serviceName === "Regular Pedicure"
  && requestLines[1].durationMinutes === 30
  && requestLines[1].serviceId !== "svc-combo");
check("no generic Service identity", requestLines.every(function (row) {
  return row.serviceName && row.serviceName !== "Service" && String(row.serviceName).toLowerCase() !== "service";
}));
check("provider eligibility uses the underlying Single", requestLines[0].eligibleProviderIds.indexOf("nicole") !== -1
  && requestLines[0].eligibleProviderIds.indexOf("ashley") === -1
  && requestLines[1].eligibleProviderIds.indexOf("nicole") !== -1
  && requestLines[1].eligibleProviderIds.indexOf("ashley") !== -1);

function makeDay(providerId) {
  return ss.normalizeProviderDay({
    dateKey: "2026-09-16",
    locationId: "locA",
    providerId: providerId,
    workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }],
    lines: [],
    allowedOverlapMinutes: 0
  });
}

const plan = ss.recommendMultiServiceVisit(
  [makeDay("nicole"), makeDay("ashley")],
  {
    serviceLines: requestLines.map(function (row) {
      return {
        lineKey: row.lineKey,
        serviceId: row.serviceId,
        durationMinutes: row.durationMinutes,
        eligibleProviderIds: row.eligibleProviderIds,
        assignmentType: "any_provider"
      };
    }),
    preferredStartMin: 11 * 60 + 30
  }
);

check("engine keeps two distinct component durations", !!(plan && plan.valid
  && plan.serviceLines.length === 2
  && plan.serviceLines[0].durationMinutes === 45
  && plan.serviceLines[1].durationMinutes === 30
  && plan.totalVisitMinutes === 75));
check("engine does not treat the Combo as one opaque 75-minute service", !(plan && plan.serviceLines.length === 1)
  && plan.serviceLines[0].serviceId === "svc-gel"
  && plan.serviceLines[1].serviceId === "svc-pedi");
check("Gel component cannot be assigned to ineligible Ashley", plan.serviceLines[0].providerId !== "ashley");

if (failed) {
  console.error("FAILED", failed);
  process.exit(1);
}
console.log("All Smart Scheduling Combo-component contract tests passed.");
