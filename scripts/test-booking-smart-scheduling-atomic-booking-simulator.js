/**
 * Smart Scheduling Phase 18D atomic Booking guard / transaction simulator.
 * No Firestore, DOM, Calendar, Reports, writes, or transactions against Firebase.
 * Usage: node scripts/test-booking-smart-scheduling-atomic-booking-simulator.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function load(rel, windowObj) {
  new Function("window", fs.readFileSync(path.join(root, rel), "utf8"))(windowObj);
}

const windowObj = {
  settings: { preferences: { salonTimeZone: "America/New_York" } }
};
load("public/booking/calendar-time.js", windowObj);
load("public/booking/appointments/model.js", windowObj);
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
  "public/booking/smart-scheduling/multi-service.js",
  "public/booking/smart-scheduling/parallel-multi-service.js",
  "public/booking/smart-scheduling/resource-aware-multi-service.js",
  "public/booking/smart-scheduling/flexible-visit.js",
  "public/booking/smart-scheduling/client-offers.js",
  "public/booking/smart-scheduling/offer-revalidation.js",
  "public/booking/smart-scheduling/offer-acceptance.js",
  "public/booking/smart-scheduling/booking-execution-adapter.js",
  "public/booking/smart-scheduling/atomic-booking-simulator.js"
].forEach(function (rel) { load(rel, windowObj); });

const api = windowObj.ffBookingSmartScheduling;
if (!api || typeof api.executeAtomicMutation !== "function") {
  console.error("Atomic booking simulator API did not load.");
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

const TWO = 14 * 60;
const src = fs.readFileSync(path.join(root, "public/booking/smart-scheduling/atomic-booking-simulator.js"), "utf8");
check("public simulator API loaded", !!(
  api.executeAtomicMutation
  && api.prepareSimulatedTransaction
  && api.commitSimulatedTransaction
  && api.simulateConcurrentMutations
  && api.buildSmartSchedulingAtomicCreateMutation
  && api.applyAvailabilityMutationAtomically
  && api.ATOMIC_BOOKING_SIMULATOR
));
check("simulator source has no Date.now", src.indexOf("Date.now") === -1);
check("simulator source has no Math.random", src.indexOf("Math.random") === -1);
check("simulator source has no firebase I/O", !/\b(addDoc|getDoc|getDocs|setDoc|updateDoc|runTransaction|writeBatch|onSnapshot)\b/.test(src));
check("simulator source has no network/DOM", !/\bfetch\b|XMLHttpRequest|document\.|ffBookingCalendar|ffReports/.test(src));

function working(providerId) {
  const map = {};
  map[providerId] = {
    locationId: "locA",
    dateKey: "2026-09-14",
    workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }]
  };
  return map;
}

function readyStore(extra) {
  return api.createGuardedAtomicStore(Object.assign({
    providerAvailability: Object.assign({}, working("maria"), working("ana")),
    resourceDefinitions: {
      "chair-1": {
        resourceId: "chair-1",
        locationId: "locA",
        resourceType: "pedicure_chair",
        active: true,
        workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }]
      },
      "chair-2": {
        resourceId: "chair-2",
        locationId: "locA",
        resourceType: "pedicure_chair",
        active: true,
        workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }]
      },
      "room-a": {
        resourceId: "room-a",
        locationId: "locA",
        resourceType: "massage_room",
        active: true,
        workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }]
      }
    }
  }, extra || {}));
}

function line(lineId, providerId, startMin, endMin, extra) {
  return Object.assign({
    lineId: lineId,
    serviceId: extra && extra.serviceId || "svc-gel",
    providerId: providerId,
    startMin: startMin,
    endMin: endMin,
    durationMinutes: endMin - startMin
  }, extra || {});
}

function providerRes(lineId, providerId, startMin, endMin) {
  return {
    providerId: providerId,
    lineId: lineId,
    startMin: startMin,
    endMin: endMin,
    locationId: "locA",
    dateKey: "2026-09-14"
  };
}

function resourceRes(lineId, resourceId, startMin, endMin, extra) {
  return Object.assign({
    resourceId: resourceId,
    lineId: lineId,
    requirementKey: extra && extra.requirementKey || "chair",
    reservationStartMin: startMin,
    reservationEndMin: endMin,
    locationId: "locA",
    dateKey: "2026-09-14"
  }, extra || {});
}

function createMut(id, lines, extras) {
  const providerReservations = (lines || []).map(function (row) {
    return providerRes(row.lineId, row.providerId, row.startMin, row.endMin);
  });
  return api.sealAtomicMutation(Object.assign({
    mutationType: "create",
    mutationId: id,
    salonId: "salon-1",
    candidateAppointmentId: "appt_" + id,
    locationId: "locA",
    dateKey: "2026-09-14",
    availabilityVersions: [{ locationId: "locA", version: 1 }],
    appointmentPayload: {
      clientId: "client-1",
      locationId: "locA",
      dateKey: "2026-09-14",
      status: "scheduled",
      serviceLines: lines
    },
    providerReservations: providerReservations,
    resourceReservations: [],
    providerAvailability: Object.assign({}, working("maria"), working("ana"))
  }, extras || {}));
}

function snap(store) {
  return JSON.stringify(store);
}

const legacy = api.createEmptyAtomicStore();
const legacyExec = api.executeAtomicMutation(legacy, createMut("legacy-1", [line("l1", "maria", TWO, TWO + 45)]));
check("legacy rejects atomic booking", legacyExec.status === "guard_not_ready" && snap(legacyExec.state) === snap(legacy));

const migrating = api.createEmptyAtomicStore({
  executionConfig: {
    executionMode: "migration",
    providerGuardsReady: true,
    writersConverted: true,
    mutationIdempotencyReady: true,
    availabilityWritersAudited: true,
    availabilityWritersAtomic: true,
    callableExecutorReady: true,
    configRevision: 1
  }
});
check("migration rejects atomic booking", api.executeAtomicMutation(migrating, createMut("mig-1", [line("l1", "maria", TWO, TWO + 45)])).status === "guard_not_ready");

const missingFlag = readyStore();
missingFlag.executionConfig.writersConverted = false;
check("guarded missing readiness flag rejects", api.executeAtomicMutation(missingFlag, createMut("flag-1", [line("l1", "maria", TWO, TWO + 45)])).status === "guard_not_ready");

const store0 = readyStore();
const store0Snap = snap(store0);
const created = api.executeAtomicMutation(store0, createMut("c1", [line("gel", "maria", TWO, TWO + 45)]));
check("fully ready permits single-provider create", created.status === "created" && created.appointmentRevision === 1 && created.appointmentId === "appt_c1");
check("create input store is immutable", snap(store0) === store0Snap);
check("create returns new store", created.state !== store0 && !!created.state.appointments.appt_c1);
check("production appointment id strategy documented", created.productionAppointmentIdStrategy === "firestore_auto_id_preallocated_before_transaction");

const cutoverNo = api.evaluateGuardedCutoverReadiness(store0);
const cutoverYes = api.evaluateGuardedCutoverReadiness(readyStore({
  executionConfig: Object.assign({}, store0.executionConfig, { concurrencyTestsGreen: true })
}));
check("cutover readiness requires concurrencyTestsGreen", cutoverNo.ready === false && cutoverNo.missing.indexOf("concurrencyTestsGreen") !== -1);
check("cutover readiness passes when green", cutoverYes.ready === true);

const multi = api.executeAtomicMutation(store0, createMut("c2", [
  line("gel", "maria", TWO, TWO + 45),
  line("pedi", "ana", TWO + 50, TWO + 95, { serviceId: "svc-pedi" })
]));
check("MULTI-SERVICE one appointment", multi.status === "created" && multi.state.appointments.appt_c2.serviceLines.length === 2);
check("MULTI-PROVIDER both guards written", multi.touchedProviderGuards.length === 2);

const sameVisit = api.executeAtomicMutation(store0, createMut("overlap-same", [
  line("a", "maria", TWO, TWO + 45),
  line("b", "maria", TWO + 30, TWO + 75)
]));
check("same-visit same-provider overlap rejects", sameVisit.status === "provider_conflict" && snap(sameVisit.state) === store0Snap);

const resourceStore = readyStore({
  executionConfig: Object.assign({}, store0.executionConfig, {
    resourceSystemReady: true,
    resourceEnforcementStartDateKey: "2026-09-01"
  })
});
const withRes = createMut("res1", [line("gel", "maria", TWO, TWO + 45)], {
  resourceReservations: [resourceRes("gel", "chair-1", TWO, TWO + 45)]
});
const resCreate = api.executeAtomicMutation(resourceStore, withRes);
check("resource create succeeds when ready", resCreate.status === "created" && resCreate.touchedResourceGuards.length === 1);

const notReadyRes = api.executeAtomicMutation(store0, withRes);
check("resourceSystemReady false rejects", notReadyRes.status === "resource_system_not_ready" && snap(notReadyRes.state) === store0Snap);

const beforeStart = readyStore({
  executionConfig: Object.assign({}, store0.executionConfig, {
    resourceSystemReady: true,
    resourceEnforcementStartDateKey: "2026-09-20"
  })
});
check("date before enforcement start rejects", api.executeAtomicMutation(beforeStart, withRes).status === "resource_system_not_ready");

const sameResVisit = api.executeAtomicMutation(resourceStore, createMut("same-res", [
  line("a", "maria", TWO, TWO + 45),
  line("b", "ana", TWO + 15, TWO + 60)
], {
  resourceReservations: [
    resourceRes("a", "chair-1", TWO, TWO + 45),
    resourceRes("b", "chair-1", TWO + 15, TWO + 60)
  ]
}));
check("same-visit same-resource overlap rejects", sameResVisit.status === "resource_conflict");

const multiRes = api.executeAtomicMutation(resourceStore, createMut("multi-res", [
  line("a", "maria", TWO, TWO + 45),
  line("b", "ana", TWO, TWO + 45)
], {
  resourceReservations: [
    resourceRes("a", "chair-1", TWO, TWO + 45),
    resourceRes("b", "room-a", TWO, TWO + 45, { requirementKey: "room" })
  ]
}));
check("MULTI-RESOURCE create succeeds", multiRes.status === "created" && multiRes.touchedResourceGuards.length === 2);

const ov0 = api.executeAtomicMutation(readyStore({ settings: { allowedOverlapMinutes: 0 } }), createMut("ov0", [line("gel", "maria", TWO, TWO + 45)]));
check("overlap setting 0 can create isolated", ov0.status === "created");

const overlapStore = readyStore({ settings: { allowedOverlapMinutes: 15 } });
const firstOv = api.executeAtomicMutation(overlapStore, createMut("ov-a", [line("a", "maria", TWO, TWO + 45)]));
const second10 = api.executeAtomicMutation(firstOv.state, createMut("ov-b", [line("b", "maria", TWO + 35, TWO + 80)]));
check("permitted 10-min overlap with setting 15 succeeds", second10.status === "created");
const second20 = api.executeAtomicMutation(firstOv.state, createMut("ov-c", [line("c", "maria", TWO + 25, TWO + 70)]));
check("20-min overlap with setting 15 conflicts", second20.status === "provider_conflict" && snap(second20.state) === snap(firstOv.state));

const liveOverlapStore = firstOv.state;
const tightened = JSON.parse(JSON.stringify(liveOverlapStore));
tightened.settings.allowedOverlapMinutes = 0;
tightened.settings.overlapPolicyRevision = 2;
const liveFail = api.executeAtomicMutation(tightened, createMut("ov-live", [line("d", "maria", TWO + 35, TWO + 80)]));
check("live overlap change uses current setting", liveFail.status === "provider_conflict");

const first = created;
const retry = api.executeAtomicMutation(first.state, createMut("c1", [line("gel", "maria", TWO, TWO + 45)]));
check("same create retry is already_completed", retry.status === "already_completed" && retry.appointmentId === "appt_c1" && retry.appointmentRevision === 1);
const mariaKey = api.providerDayGuardKey("locA", "2026-09-14", "maria");
check("idempotent retry does not bump guard revision", retry.state.providerDays[mariaKey].revision === first.state.providerDays[mariaKey].revision);

const tampered = JSON.parse(JSON.stringify(createMut("c1", [line("gel", "ana", TWO, TWO + 45)])));
tampered.mutationIdempotencyKey = createMut("c1", [line("gel", "maria", TWO, TWO + 45)]).mutationIdempotencyKey;
tampered.mutationId = "c1";
const mismatch = api.executeAtomicMutation(first.state, tampered);
check("same-key different fingerprint mismatches", mismatch.status === "idempotency_identity_mismatch" && snap(mismatch.state) === snap(first.state));

const overnight = createMut("night", [line("n", "maria", 22 * 60, 25 * 60)]);
check("SS/create overnight rejected", api.executeAtomicMutation(store0, overnight).status === "overnight_not_supported");

const moved = api.executeAtomicMutation(first.state, api.sealAtomicMutation({
  mutationType: "update",
  mutationId: "move-1",
  salonId: "salon-1",
  appointmentId: "appt_c1",
  expectedAppointmentRevision: 1,
  locationId: "locA",
  dateKey: "2026-09-14",
  availabilityVersions: [{ locationId: "locA", version: 1 }],
  appointmentPayload: {
    clientId: "client-1",
    locationId: "locA",
    dateKey: "2026-09-14",
    serviceLines: [line("gel", "ana", TWO + 60, TWO + 105)]
  },
  providerReservations: [providerRes("gel", "ana", TWO + 60, TWO + 105)],
  resourceReservations: [],
  providerAvailability: Object.assign({}, working("maria"), working("ana"))
}));
check("MOVE Maria 2:00 to Ana 3:00", moved.status === "updated" && moved.appointmentRevision === 2);
check("move increments appointment revision", moved.state.appointments.appt_c1.revision === 2);
check("Maria occupancy removed and Ana added", !moved.state.providerDays[mariaKey].occupancies.some(function (row) { return row.appointmentId === "appt_c1"; }) && moved.state.providerDays[api.providerDayGuardKey("locA", "2026-09-14", "ana")].occupancies.some(function (row) { return row.appointmentId === "appt_c1"; }));

const blockingAna = api.executeAtomicMutation(first.state, createMut("ana-busy", [line("x", "ana", TWO + 60, TWO + 105)]));
const failMove = api.executeAtomicMutation(blockingAna.state, api.sealAtomicMutation({
  mutationType: "update",
  mutationId: "move-fail",
  salonId: "salon-1",
  appointmentId: "appt_c1",
  expectedAppointmentRevision: 1,
  locationId: "locA",
  dateKey: "2026-09-14",
  availabilityVersions: [{ locationId: "locA", version: 1 }],
  appointmentPayload: {
    clientId: "client-1",
    locationId: "locA",
    dateKey: "2026-09-14",
    serviceLines: [line("gel", "ana", TWO + 60, TWO + 105)]
  },
  providerReservations: [providerRes("gel", "ana", TWO + 60, TWO + 105)],
  resourceReservations: [],
  providerAvailability: Object.assign({}, working("maria"), working("ana"))
}));
check("failed destination move leaves Maria reserved", failMove.status === "provider_conflict" && failMove.state.providerDays[mariaKey].occupancies.some(function (row) { return row.appointmentId === "appt_c1"; }));

const staleRev = api.executeAtomicMutation(moved.state, api.sealAtomicMutation({
  mutationType: "update",
  mutationId: "stale-move",
  salonId: "salon-1",
  appointmentId: "appt_c1",
  expectedAppointmentRevision: 1,
  locationId: "locA",
  dateKey: "2026-09-14",
  availabilityVersions: [{ locationId: "locA", version: 1 }],
  appointmentPayload: moved.state.appointments.appt_c1,
  providerReservations: [providerRes("gel", "ana", TWO + 60, TWO + 105)],
  resourceReservations: [],
  providerAvailability: Object.assign({}, working("maria"), working("ana"))
}));
check("stale revision rejected", staleRev.status === "appointment_revision_mismatch" && snap(staleRev.state) === snap(moved.state));

const moveRetry = api.executeAtomicMutation(moved.state, api.sealAtomicMutation({
  mutationType: "update",
  mutationId: "move-1",
  salonId: "salon-1",
  appointmentId: "appt_c1",
  expectedAppointmentRevision: 1,
  locationId: "locA",
  dateKey: "2026-09-14",
  availabilityVersions: [{ locationId: "locA", version: 1 }],
  appointmentPayload: {
    clientId: "client-1",
    locationId: "locA",
    dateKey: "2026-09-14",
    serviceLines: [line("gel", "ana", TWO + 60, TWO + 105)]
  },
  providerReservations: [providerRes("gel", "ana", TWO + 60, TWO + 105)],
  resourceReservations: [],
  providerAvailability: Object.assign({}, working("maria"), working("ana"))
}));
check("update retry already_completed before revision check", moveRetry.status === "already_completed" && moveRetry.appointmentRevision === 2);

const resReadyCreated = resCreate;
const chair1Key = api.resourceDayGuardKey("locA", "2026-09-14", "chair-1");
const chair2Key = api.resourceDayGuardKey("locA", "2026-09-14", "chair-2");
const resMove = api.executeAtomicMutation(resReadyCreated.state, api.sealAtomicMutation({
  mutationType: "update",
  mutationId: "res-move",
  salonId: "salon-1",
  appointmentId: "appt_res1",
  expectedAppointmentRevision: 1,
  locationId: "locA",
  dateKey: "2026-09-14",
  availabilityVersions: [{ locationId: "locA", version: 1 }],
  appointmentPayload: {
    clientId: "client-1",
    locationId: "locA",
    dateKey: "2026-09-14",
    serviceLines: [line("gel", "maria", TWO, TWO + 45)]
  },
  providerReservations: [providerRes("gel", "maria", TWO, TWO + 45)],
  resourceReservations: [resourceRes("gel", "chair-2", TWO, TWO + 45)],
  providerAvailability: working("maria")
}));
check("MOVE Chair 1 to Chair 2", resMove.status === "updated" && !resMove.state.resourceDays[chair1Key].occupancies.some(function (row) { return row.appointmentId === "appt_res1"; }) && resMove.state.resourceDays[chair2Key].occupancies.some(function (row) { return row.appointmentId === "appt_res1"; }));

const occupyC2 = api.executeAtomicMutation(resReadyCreated.state, createMut("hold-c2", [line("z", "ana", TWO, TWO + 45)], {
  resourceReservations: [resourceRes("z", "chair-2", TWO, TWO + 45)]
}));
const failResMove = api.executeAtomicMutation(occupyC2.state, api.sealAtomicMutation({
  mutationType: "update",
  mutationId: "res-move-fail",
  salonId: "salon-1",
  appointmentId: "appt_res1",
  expectedAppointmentRevision: 1,
  locationId: "locA",
  dateKey: "2026-09-14",
  availabilityVersions: [{ locationId: "locA", version: 1 }],
  appointmentPayload: occupyC2.state.appointments.appt_res1 || { clientId: "client-1", locationId: "locA", dateKey: "2026-09-14", serviceLines: [line("gel", "maria", TWO, TWO + 45)] },
  providerReservations: [providerRes("gel", "maria", TWO, TWO + 45)],
  resourceReservations: [resourceRes("gel", "chair-2", TWO, TWO + 45)],
  providerAvailability: Object.assign({}, working("maria"), working("ana"))
}));
check("failed Chair 2 move keeps Chair 1", failResMove.status === "resource_conflict" && failResMove.state.resourceDays[chair1Key].occupancies.some(function (row) { return row.appointmentId === "appt_res1"; }));

const cancelled = api.executeAtomicMutation(first.state, api.sealAtomicMutation({
  mutationType: "cancel",
  mutationId: "cancel-c1",
  salonId: "salon-1",
  appointmentId: "appt_c1"
}));
check("cancel removes occupancy", cancelled.status === "cancelled" && cancelled.appointmentRevision === 2 && !cancelled.state.providerDays[mariaKey].occupancies.some(function (row) { return row.appointmentId === "appt_c1"; }));
const cancelRetry = api.executeAtomicMutation(cancelled.state, api.sealAtomicMutation({
  mutationType: "cancel",
  mutationId: "cancel-c1",
  salonId: "salon-1",
  appointmentId: "appt_c1"
}));
check("cancel retry already_completed no extra revision", cancelRetry.status === "already_completed" && cancelRetry.appointmentRevision === 2 && cancelRetry.state.appointments.appt_c1.revision === 2);
const cancelAgain = api.executeAtomicMutation(cancelled.state, api.sealAtomicMutation({
  mutationType: "cancel",
  mutationId: "cancel-c1-new",
  salonId: "salon-1",
  appointmentId: "appt_c1"
}));
check("new cancel on already cancelled is already_cancelled", cancelAgain.status === "already_cancelled" && cancelAgain.state.appointments.appt_c1.revision === 2);

const statusDone = api.executeAtomicMutation(first.state, api.sealAtomicMutation({
  mutationType: "status",
  mutationId: "status-1",
  salonId: "salon-1",
  appointmentId: "appt_c1",
  expectedAppointmentRevision: 1,
  targetStatus: "completed"
}));
check("status completed keeps occupancy", statusDone.status === "status_updated" && statusDone.state.providerDays[mariaKey].occupancies.some(function (row) { return row.appointmentId === "appt_c1"; }));
const statusNoShow = api.executeAtomicMutation(statusDone.state, api.sealAtomicMutation({
  mutationType: "status",
  mutationId: "status-2",
  salonId: "salon-1",
  appointmentId: "appt_c1",
  expectedAppointmentRevision: 2,
  targetStatus: "no_show"
}));
check("status no_show keeps occupancy", statusNoShow.status === "status_updated" && statusNoShow.state.providerDays[mariaKey].occupancies.length === 1);
const statusCancel = api.executeAtomicMutation(first.state, api.sealAtomicMutation({
  mutationType: "status",
  mutationId: "status-bad",
  salonId: "salon-1",
  appointmentId: "appt_c1",
  expectedAppointmentRevision: 1,
  targetStatus: "cancelled"
}));
check("status path cannot cancel", statusCancel.status === "mutation_invalid" && (statusCancel.reasonCodes || []).indexOf("use_cancel_mutation") !== -1 && snap(statusCancel.state) === snap(first.state));
const statusRetry = api.executeAtomicMutation(statusDone.state, api.sealAtomicMutation({
  mutationType: "status",
  mutationId: "status-1",
  salonId: "salon-1",
  appointmentId: "appt_c1",
  expectedAppointmentRevision: 1,
  targetStatus: "completed"
}));
check("status retry already_completed", statusRetry.status === "already_completed" && statusRetry.appointmentRevision === 2);

const firstSnap = snap(first.state);
const firstRev = first.state.appointments.appt_c1.revision;
const firstGuardRev = first.state.providerDays[mariaKey].revision;
const updateToCancelled = api.executeAtomicMutation(first.state, api.sealAtomicMutation({
  mutationType: "update",
  mutationId: "upd-cancel",
  salonId: "salon-1",
  appointmentId: "appt_c1",
  expectedAppointmentRevision: 1,
  locationId: "locA",
  dateKey: "2026-09-14",
  availabilityVersions: [{ locationId: "locA", version: 1 }],
  appointmentPayload: {
    clientId: "client-1",
    locationId: "locA",
    dateKey: "2026-09-14",
    status: "cancelled",
    serviceLines: [line("gel", "maria", TWO, TWO + 45)]
  },
  providerReservations: [providerRes("gel", "maria", TWO, TWO + 45)],
  resourceReservations: [],
  providerAvailability: Object.assign({}, working("maria"), working("ana"))
}));
check("UPDATE -> CANCELLED uses cancel mutation", updateToCancelled.status === "mutation_invalid" && (updateToCancelled.reasonCodes || []).indexOf("use_cancel_mutation") !== -1);
check("UPDATE -> CANCELLED leaves appointment and guards unchanged", snap(updateToCancelled.state) === firstSnap && updateToCancelled.state.appointments.appt_c1.status === "scheduled" && updateToCancelled.state.appointments.appt_c1.revision === firstRev && updateToCancelled.state.providerDays[mariaKey].revision === firstGuardRev);

const updateToConfirmed = api.executeAtomicMutation(first.state, api.sealAtomicMutation({
  mutationType: "update",
  mutationId: "upd-confirm",
  salonId: "salon-1",
  appointmentId: "appt_c1",
  expectedAppointmentRevision: 1,
  locationId: "locA",
  dateKey: "2026-09-14",
  availabilityVersions: [{ locationId: "locA", version: 1 }],
  appointmentPayload: {
    clientId: "client-1",
    locationId: "locA",
    dateKey: "2026-09-14",
    status: "confirmed",
    serviceLines: [line("gel", "maria", TWO, TWO + 45)]
  },
  providerReservations: [providerRes("gel", "maria", TWO, TWO + 45)],
  resourceReservations: [],
  providerAvailability: Object.assign({}, working("maria"), working("ana"))
}));
check("UPDATE -> CONFIRMED uses status mutation", updateToConfirmed.status === "mutation_invalid" && (updateToConfirmed.reasonCodes || []).indexOf("use_status_mutation") !== -1 && snap(updateToConfirmed.state) === firstSnap);

const updateClient = api.executeAtomicMutation(first.state, api.sealAtomicMutation({
  mutationType: "update",
  mutationId: "upd-client",
  salonId: "salon-1",
  appointmentId: "appt_c1",
  expectedAppointmentRevision: 1,
  locationId: "locA",
  dateKey: "2026-09-14",
  availabilityVersions: [{ locationId: "locA", version: 1 }],
  appointmentPayload: {
    clientId: "client-2",
    locationId: "locA",
    dateKey: "2026-09-14",
    serviceLines: [line("gel", "maria", TWO, TWO + 45)]
  },
  providerReservations: [providerRes("gel", "maria", TWO, TWO + 45)],
  resourceReservations: [],
  providerAvailability: Object.assign({}, working("maria"), working("ana"))
}));
check("UPDATE clientId change rejected", updateClient.status === "mutation_invalid" && (updateClient.reasonCodes || []).indexOf("appointment_identity_change_not_allowed") !== -1 && snap(updateClient.state) === firstSnap && updateClient.state.appointments.appt_c1.clientId === "client-1");

const statusWithOccupancy = api.executeAtomicMutation(first.state, api.sealAtomicMutation({
  mutationType: "status",
  mutationId: "status-occ",
  salonId: "salon-1",
  appointmentId: "appt_c1",
  expectedAppointmentRevision: 1,
  targetStatus: "confirmed",
  appointmentPayload: {
    clientId: "client-1",
    locationId: "locA",
    dateKey: "2026-09-14",
    serviceLines: [line("gel", "ana", TWO + 60, TWO + 105)]
  },
  providerReservations: [providerRes("gel", "ana", TWO + 60, TWO + 105)],
  resourceReservations: [resourceRes("gel", "chair-2", TWO + 60, TWO + 105)]
}));
check("STATUS with occupancy change rejected", statusWithOccupancy.status === "mutation_invalid" && (statusWithOccupancy.reasonCodes || []).indexOf("status_mutation_contains_occupancy_change") !== -1 && snap(statusWithOccupancy.state) === firstSnap);

const statusConfirmed = api.executeAtomicMutation(first.state, api.sealAtomicMutation({
  mutationType: "status",
  mutationId: "status-confirm",
  salonId: "salon-1",
  appointmentId: "appt_c1",
  expectedAppointmentRevision: 1,
  targetStatus: "confirmed"
}));
check("NORMAL STATUS scheduled -> confirmed", statusConfirmed.status === "status_updated" && statusConfirmed.appointmentRevision === 2 && statusConfirmed.state.appointments.appt_c1.status === "confirmed" && statusConfirmed.state.appointments.appt_c1.revision === 2);
check("NORMAL STATUS leaves guards unchanged", statusConfirmed.state.providerDays[mariaKey].revision === firstGuardRev && statusConfirmed.state.providerDays[mariaKey].occupancies.some(function (row) { return row.appointmentId === "appt_c1"; }));

const cancelWithLines = api.executeAtomicMutation(first.state, api.sealAtomicMutation({
  mutationType: "cancel",
  mutationId: "cancel-replace",
  salonId: "salon-1",
  appointmentId: "appt_c1",
  appointmentPayload: {
    clientId: "client-1",
    locationId: "locA",
    dateKey: "2026-09-14",
    serviceLines: [line("gel", "ana", TWO + 60, TWO + 105)]
  },
  providerReservations: [providerRes("gel", "ana", TWO + 60, TWO + 105)],
  resourceReservations: [resourceRes("gel", "chair-2", TWO + 60, TWO + 105)]
}));
check("CANCEL with replacement lines rejected", cancelWithLines.status === "mutation_invalid" && (cancelWithLines.reasonCodes || []).indexOf("cancel_mutation_contains_appointment_change") !== -1 && snap(cancelWithLines.state) === firstSnap && cancelWithLines.state.appointments.appt_c1.status === "scheduled");

const createCancelled = api.executeAtomicMutation(store0, createMut("create-cancelled", [line("gel", "maria", TWO, TWO + 45)], {
  appointmentPayload: {
    clientId: "client-1",
    locationId: "locA",
    dateKey: "2026-09-14",
    status: "cancelled",
    serviceLines: [line("gel", "maria", TWO, TWO + 45)]
  }
}));
check("generic CREATE cancelled rejected", createCancelled.status === "mutation_invalid" && (createCancelled.reasonCodes || []).indexOf("invalid_create_status") !== -1 && !createCancelled.state.appointments["appt_create-cancelled"] && snap(createCancelled.state) === store0Snap);

const epochStore = readyStore();
const epochSnap = snap(epochStore);
const avail = api.applyAvailabilityMutationAtomically(epochStore, {
  locationIds: ["locA"],
  availabilityConfig: { locA: { businessHours: { monday: { isOpen: true } } } },
  providerAvailability: { maria: { locationId: "locA", dateKey: "2026-09-14", workingIntervals: [{ startMin: 15 * 60, endMin: 18 * 60 }] } }
});
check("availability mutation increments epoch with config", avail.status === "availability_updated" && avail.state.availabilityEpochs.locA.version === 2 && avail.state.availabilityConfig.locA.businessHours.monday.isOpen === true);
check("availability mutation leaves original store unchanged", snap(epochStore) === epochSnap);
check("no intermediate epoch-only state", avail.state.availabilityEpochs.locA.version === 2 && !!avail.state.availabilityConfig.locA.businessHours);

const staleEpochMut = createMut("epoch-old", [line("gel", "maria", TWO, TWO + 45)], {
  availabilityVersions: [{ locationId: "locA", version: 1 }]
});
const epochChanged = api.executeAtomicMutation(avail.state, staleEpochMut);
check("live epoch change is availability_version_changed", epochChanged.status === "availability_version_changed" && snap(epochChanged.state) === snap(avail.state));

const sealed = createMut("tamper-v", [line("gel", "maria", TWO, TWO + 45)]);
const tamperedVersion = JSON.parse(JSON.stringify(sealed));
tamperedVersion.availabilityVersions = [{ locationId: "locA", version: 13 }];
const tamperExec = api.executeAtomicMutation(store0, tamperedVersion);
check("version tamper is integrity failure not epoch change", tamperExec.status === "mutation_invalid" && tamperExec.reasonCodes.indexOf("mutation_integrity_mismatch") !== -1);

const deactivated = api.applyAvailabilityMutationAtomically(resourceStore, {
  locationIds: ["locA"],
  resourceDefinitions: {
    "chair-1": {
      resourceId: "chair-1",
      locationId: "locA",
      resourceType: "pedicure_chair",
      active: false,
      workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }]
    }
  }
});
const oldResCmd = createMut("old-chair", [line("gel", "maria", TWO, TWO + 45)], {
  resourceReservations: [resourceRes("gel", "chair-1", TWO, TWO + 45)],
  availabilityVersions: [{ locationId: "locA", version: 1 }]
});
check("resource deactivation bumps epoch and stale command fails epoch", api.executeAtomicMutation(deactivated.state, oldResCmd).status === "availability_version_changed");
const newInactive = createMut("new-chair", [line("gel", "maria", TWO, TWO + 45)], {
  resourceReservations: [resourceRes("gel", "chair-1", TWO, TWO + 45)],
  availabilityVersions: [{ locationId: "locA", version: 2 }]
});
check("new command at new epoch with inactive Chair 1 is resource_schedule_changed", api.executeAtomicMutation(deactivated.state, newInactive).status === "resource_schedule_changed");

const sameProv = api.simulateConcurrentMutations(
  store0,
  createMut("win-a", [line("gel", "maria", TWO, TWO + 45)]),
  createMut("lose-b", [line("gel", "maria", TWO, TWO + 45)])
);
check("same-provider race: first created", sameProv.first.status === "created");
check("same-provider race: second attempt retries", sameProv.secondAttempt.status === "transaction_retry_required");
check("same-provider race: retry provider_conflict", sameProv.second.status === "provider_conflict");
check("same-provider race: one appointment", Object.keys(sameProv.state.appointments).length === 1);

const bothOverlap = api.simulateConcurrentMutations(
  readyStore({ settings: { allowedOverlapMinutes: 15 } }),
  createMut("ov15-a", [line("a", "maria", TWO, TWO + 45)]),
  createMut("ov15-b", [line("b", "maria", TWO + 35, TWO + 80)])
);
check("allowed-overlap race both created", bothOverlap.first.status === "created" && bothOverlap.second.status === "created" && Object.keys(bothOverlap.state.appointments).length === 2);

const overAllowance = api.simulateConcurrentMutations(
  readyStore({ settings: { allowedOverlapMinutes: 15 } }),
  createMut("ov20-a", [line("a", "maria", TWO, TWO + 45)]),
  createMut("ov20-b", [line("b", "maria", TWO + 25, TWO + 70)])
);
check("over-allowance race one winner", overAllowance.first.status === "created" && overAllowance.second.status === "provider_conflict" && Object.keys(overAllowance.state.appointments).length === 1);

const diffProv = api.simulateConcurrentMutations(
  store0,
  createMut("maria-only", [line("a", "maria", TWO, TWO + 45)]),
  createMut("ana-only", [line("b", "ana", TWO, TWO + 45)])
);
check("different providers both succeed", diffProv.first.status === "created" && diffProv.second.status === "created");

const holdAna = api.executeAtomicMutation(store0, createMut("hold-ana", [line("x", "ana", TWO, TWO + 45)]));
const needBothFail = api.executeAtomicMutation(holdAna.state, createMut("need-both-2", [
  line("a", "maria", TWO, TWO + 45),
  line("b", "ana", TWO, TWO + 45)
]));
check("multi-provider visit fails entirely when Ana busy", needBothFail.status === "provider_conflict" && !needBothFail.state.appointments["appt_need-both-2"] && snap(needBothFail.state) === snap(holdAna.state));

const sameChair = api.simulateConcurrentMutations(
  resourceStore,
  createMut("ch-a", [line("a", "maria", TWO, TWO + 45)], { resourceReservations: [resourceRes("a", "chair-1", TWO, TWO + 45)] }),
  createMut("ch-b", [line("b", "ana", TWO, TWO + 45)], { resourceReservations: [resourceRes("b", "chair-1", TWO, TWO + 45)] })
);
check("same resource race one winner", sameChair.first.status === "created" && sameChair.second.status === "resource_conflict" && Object.keys(sameChair.state.appointments).length === 1);

const diffChair = api.simulateConcurrentMutations(
  resourceStore,
  createMut("ch1", [line("a", "maria", TWO, TWO + 45)], { resourceReservations: [resourceRes("a", "chair-1", TWO, TWO + 45)] }),
  createMut("ch2", [line("b", "ana", TWO, TWO + 45)], { resourceReservations: [resourceRes("b", "chair-2", TWO, TWO + 45)] })
);
check("different resources both succeed", diffChair.first.status === "created" && diffChair.second.status === "created");

const holdRoom = api.executeAtomicMutation(resourceStore, createMut("hold-room", [line("r", "ana", TWO, TWO + 45)], {
  resourceReservations: [resourceRes("r", "room-a", TWO, TWO + 45, { requirementKey: "room" })]
}));
const multiResFail = api.executeAtomicMutation(holdRoom.state, createMut("need-both-res", [
  line("a", "maria", TWO, TWO + 45),
  line("b", "ana", TWO + 60, TWO + 105)
], {
  resourceReservations: [
    resourceRes("a", "chair-1", TWO, TWO + 45),
    resourceRes("b", "room-a", TWO, TWO + 45, { requirementKey: "room" })
  ]
}));
check("multi-resource visit all-or-none", multiResFail.status === "resource_conflict" && !multiResFail.state.appointments["appt_need-both-res"]);

const dbl = api.simulateConcurrentMutations(
  store0,
  createMut("dbl", [line("gel", "maria", TWO, TWO + 45)]),
  createMut("dbl", [line("gel", "maria", TWO, TWO + 45)])
);
check("double-click one appointment already_completed", dbl.first.status === "created" && dbl.second.status === "already_completed" && dbl.second.appointmentId === dbl.first.appointmentId && Object.keys(dbl.state.appointments).length === 1);

const schedRaceStore = store0;
const bookingPrep = api.prepareSimulatedTransaction(schedRaceStore, createMut("vs-sched", [line("gel", "maria", TWO, TWO + 45)]));
const schedCommit = api.applyAvailabilityMutationAtomically(schedRaceStore, {
  locationIds: ["locA"],
  availabilityConfig: { locA: { businessHours: { changed: true } } }
});
const afterSched = api.commitSimulatedTransaction(schedCommit.state, bookingPrep);
check("schedule mutation race forces retry", afterSched.status === "transaction_retry_required");
const afterSchedRetry = api.executeAtomicMutation(schedCommit.state, createMut("vs-sched", [line("gel", "maria", TWO, TWO + 45)]));
check("retry after schedule change is availability_version_changed", afterSchedRetry.status === "availability_version_changed");

const baseAppt = api.executeAtomicMutation(store0, createMut("rev3", [line("gel", "maria", TWO, TWO + 45)]));
const u1 = api.sealAtomicMutation({
  mutationType: "update",
  mutationId: "u-a",
  salonId: "salon-1",
  appointmentId: "appt_rev3",
  expectedAppointmentRevision: 1,
  locationId: "locA",
  dateKey: "2026-09-14",
  availabilityVersions: [{ locationId: "locA", version: 1 }],
  appointmentPayload: {
    clientId: "client-1",
    locationId: "locA",
    dateKey: "2026-09-14",
    serviceLines: [line("gel", "maria", TWO + 15, TWO + 60)]
  },
  providerReservations: [providerRes("gel", "maria", TWO + 15, TWO + 60)],
  resourceReservations: [],
  providerAvailability: working("maria")
});
const u2 = api.sealAtomicMutation({
  mutationType: "update",
  mutationId: "u-b",
  salonId: "salon-1",
  appointmentId: "appt_rev3",
  expectedAppointmentRevision: 1,
  locationId: "locA",
  dateKey: "2026-09-14",
  availabilityVersions: [{ locationId: "locA", version: 1 }],
  appointmentPayload: {
    clientId: "client-1",
    locationId: "locA",
    dateKey: "2026-09-14",
    serviceLines: [line("gel", "ana", TWO + 15, TWO + 60)]
  },
  providerReservations: [providerRes("gel", "ana", TWO + 15, TWO + 60)],
  resourceReservations: [],
  providerAvailability: Object.assign({}, working("maria"), working("ana"))
});
const updRace = api.simulateConcurrentMutations(baseAppt.state, u1, u2);
check("update/update race second is revision mismatch", updRace.first.status === "updated" && updRace.second.status === "appointment_revision_mismatch");

const existing = api.executeAtomicMutation(store0, createMut("occ", [line("gel", "maria", TWO, TWO + 45)]));
const cancelMut = api.sealAtomicMutation({
  mutationType: "cancel",
  mutationId: "cancel-occ",
  salonId: "salon-1",
  appointmentId: "appt_occ",
  expectedAppointmentRevision: 1
});
const newBook = createMut("new-at-two", [line("n", "maria", TWO, TWO + 45)]);
const cancelFirst = api.simulateConcurrentMutations(existing.state, cancelMut, newBook);
check("cancel then create: create may succeed", cancelFirst.first.status === "cancelled" && cancelFirst.second.status === "created");
const createFirst = api.simulateConcurrentMutations(existing.state, newBook, cancelMut);
check("create then cancel: create conflicts, cancel still legal", createFirst.first.status === "provider_conflict" && createFirst.second.status === "cancelled");
check("cancel/create never double-occupies Maria 2:00", function () {
  function illegal(state) {
    const occ = (state.providerDays[mariaKey] && state.providerDays[mariaKey].occupancies) || [];
    const active = occ.filter(function (row) {
      const appt = state.appointments[row.appointmentId];
      return appt && appt.status !== "cancelled" && row.startMin === TWO;
    });
    return active.length > 1;
  }
  return !illegal(cancelFirst.state) && !illegal(createFirst.state);
}());

const moveSame = api.sealAtomicMutation({
  mutationType: "update",
  mutationId: "move-occ",
  salonId: "salon-1",
  appointmentId: "appt_occ",
  expectedAppointmentRevision: 1,
  locationId: "locA",
  dateKey: "2026-09-14",
  availabilityVersions: [{ locationId: "locA", version: 1 }],
  appointmentPayload: {
    clientId: "client-1",
    locationId: "locA",
    dateKey: "2026-09-14",
    serviceLines: [line("gel", "ana", TWO, TWO + 45)]
  },
  providerReservations: [providerRes("gel", "ana", TWO, TWO + 45)],
  resourceReservations: [],
  providerAvailability: Object.assign({}, working("maria"), working("ana"))
});
const cancelVsMove = api.simulateConcurrentMutations(existing.state, cancelMut, moveSame);
check("cancel vs move: one logical winner", (cancelVsMove.first.status === "cancelled" && cancelVsMove.second.status === "appointment_revision_mismatch") || (cancelVsMove.first.status === "updated" && cancelVsMove.second.status === "appointment_revision_mismatch") || (cancelVsMove.first.status === "cancelled" && cancelVsMove.second.status === "mutation_invalid"));

check("guard revision once per successful create", first.state.providerDays[mariaKey].revision === 1);
check("failed mutation does not change revision", failMove.state.providerDays[mariaKey].revision === 1);
const twoLine = api.executeAtomicMutation(store0, createMut("two-line-maria-ana", [
  line("a", "maria", TWO, TWO + 45),
  line("b", "ana", TWO + 50, TWO + 95)
]));
check("multi-line same guard still +1 once", twoLine.state.providerDays[mariaKey].revision === 1 && twoLine.state.providerDays[api.providerDayGuardKey("locA", "2026-09-14", "ana")].revision === 1);

function makeDay(overrides) {
  return api.normalizeProviderDay(Object.assign({
    dateKey: "2026-09-14",
    locationId: "locA",
    providerId: "provA",
    workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }],
    lines: [],
    allowedOverlapMinutes: 0
  }, overrides || {}));
}
function resAssign(requirementKey, resourceId, start, end) {
  return {
    requirementKey: requirementKey,
    resourceId: resourceId,
    resourceType: "pedicure_chair",
    serviceStartMin: start,
    serviceEndMin: end,
    reservationStartMin: start,
    reservationEndMin: end,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0
  };
}
function fakePlan(overrides) {
  const start = TWO;
  const wait = 5;
  return {
    valid: true,
    dateKey: "2026-09-14",
    locationId: "locA",
    visitStartMin: start,
    visitEndMin: start + 95,
    totalClientWaitMinutes: wait,
    visitElapsedMinutes: 95,
    sumServiceMinutes: 90,
    parallelMinutesSaved: 0,
    orderChanged: false,
    orderDistance: 0,
    timeDistanceMinutes: 0,
    flexibleVisitPlanScore: 90,
    assignmentKey: "gel|maria||pedi|ana",
    resourceAssignmentKey: "",
    overlapLineCount: 0,
    blocks: [
      { blockIndex: 0, sourceBlockIndex: 0, startMin: start, endMin: start + 45, waitBeforeMinutes: 0, parallel: false, lineKeys: ["gel"], durationMinutes: 45 },
      { blockIndex: 1, sourceBlockIndex: 1, startMin: start + 50, endMin: start + 95, waitBeforeMinutes: wait, parallel: false, lineKeys: ["pedi"], durationMinutes: 45 }
    ],
    serviceLines: [
      { lineKey: "gel", serviceId: "svc-gel", providerId: "maria", startMin: start, endMin: start + 45, durationMinutes: 45, blockIndex: 0, resourceAssignments: [] },
      { lineKey: "pedi", serviceId: "svc-pedi", providerId: "ana", startMin: start + 50, endMin: start + 95, durationMinutes: 45, blockIndex: 1, resourceAssignments: [] }
    ],
    searchMetadata: { truncated: false, exhaustive: true }
  };
}
const mariaDay = makeDay({ providerId: "maria" });
const anaDay = makeDay({ providerId: "ana" });
const offer = api.rankClientVisitOffers([], [], {}, { sourcePlans: [fakePlan()], maxOffers: 1 })[0];
const prepared = api.prepareOfferAcceptance([mariaDay, anaDay], [], offer, {
  acceptanceId: "accept-sim",
  offerId: offer.offerId,
  sourcePlanKey: offer.sourcePlanKey,
  clientId: "client-1"
});
const ssBridge = api.buildSmartSchedulingAtomicCreateMutation(
  prepared.bookingCommand,
  prepared.transactionPreconditions,
  {
    salonId: "salon-1",
    candidateAppointmentId: "appt_ss1",
    client: { clientId: "client-1", displayName: "Jessica Miller" },
    staffById: { maria: { name: "Maria" }, ana: { name: "Ana" } },
    servicesById: {
      "svc-gel": { name: "Gel Mani", defaultPrice: 45 },
      "svc-pedi": { name: "Regular Pedi", defaultPrice: 50 }
    },
    providerAvailability: Object.assign({}, working("maria"), working("ana"))
  },
  "ss-create-1",
  [{ locationId: "locA", version: 1 }]
);
check("SS create mutation bridge ok", !!(ssBridge.ok && ssBridge.mutation && ssBridge.mutation.smartScheduling.offerId === offer.offerId));
const ssExec = api.executeAtomicMutation(store0, ssBridge.mutation);
check("SS create executes atomically", ssExec.status === "created" && ssExec.state.appointments.appt_ss1.serviceLines[0].providerId === "maria" && ssExec.state.appointments.appt_ss1.serviceLines[1].providerId === "ana");

const ssTamper = JSON.parse(JSON.stringify(ssBridge.mutation));
ssTamper.availabilityVersions = [{ locationId: "locA", version: 13 }];
check("SS version tamper is command_invalid", api.executeAtomicMutation(store0, ssTamper).status === "command_invalid");

const ssCancelled = JSON.parse(JSON.stringify(ssBridge.mutation));
ssCancelled.appointmentPayload.status = "cancelled";
const ssCancelledExec = api.executeAtomicMutation(store0, ssCancelled);
check("SMART CREATE cancelled rejected", ssCancelledExec.status === "command_invalid" && (ssCancelledExec.reasonCodes || []).indexOf("invalid_create_status") !== -1 && !ssCancelledExec.state.appointments.appt_ss1 && snap(ssCancelledExec.state) === store0Snap);
const ssCompleted = JSON.parse(JSON.stringify(ssBridge.mutation));
ssCompleted.appointmentPayload.status = "completed";
const ssCompletedExec = api.executeAtomicMutation(store0, ssCompleted);
check("SMART CREATE completed rejected", ssCompletedExec.status === "command_invalid" && (ssCompletedExec.reasonCodes || []).indexOf("invalid_create_status") !== -1 && !ssCompletedExec.state.appointments.appt_ss1);

check("front-desk overnight remaining gap exposed", created.frontDeskOvernightGuardSplit === "front_desk_overnight_guard_split_not_simulated");
check("sha256 storage strategy documented", api.ATOMIC_BOOKING_SIMULATOR.PERSISTENT_STORAGE_KEY_STRATEGY === "sha256_required_in_firestore");

if (failed) {
  console.error(failed + " atomic booking simulator checks failed.");
  process.exit(1);
}
console.log("All atomic booking simulator checks passed.");
