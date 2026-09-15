/**
 * Smart Scheduling Phase 18B booking execution adapter / simulator.
 * No Firestore, DOM, Calendar, Reports, writes, or transactions.
 * Usage: node scripts/test-booking-smart-scheduling-booking-execution-adapter.js
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
  "public/booking/smart-scheduling/booking-execution-adapter.js"
].forEach(function (rel) { load(rel, windowObj); });

const api = windowObj.ffBookingSmartScheduling;
const model = windowObj.ffBookingAppointmentModel;
if (!api || typeof api.adaptAcceptanceCommandToBookingCreateInput !== "function") {
  console.error("Smart Scheduling booking execution adapter API did not load.");
  process.exit(1);
}
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

function makeResource(overrides) {
  return Object.assign({
    resourceId: "chair-1",
    resourceType: "pedicure_chair",
    locationId: "locA",
    dateKey: "2026-09-14",
    workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }],
    occupied: []
  }, overrides || {});
}

function occ(startMin, endMin, extra) {
  return Object.assign({
    lineId: "l-" + startMin + "-" + endMin,
    appointmentId: "a-" + startMin,
    providerId: extra && extra.providerId || "maria",
    startMin: startMin,
    endMin: endMin,
    status: "scheduled"
  }, extra || {});
}

function resAssign(requirementKey, resourceId, start, end, extra) {
  return Object.assign({
    requirementKey: requirementKey,
    resourceId: resourceId,
    resourceType: extra && extra.resourceType || "pedicure_chair",
    serviceStartMin: start,
    serviceEndMin: end,
    reservationStartMin: extra && extra.reservationStartMin != null ? extra.reservationStartMin : start,
    reservationEndMin: extra && extra.reservationEndMin != null ? extra.reservationEndMin : end,
    bufferBeforeMinutes: extra && extra.bufferBeforeMinutes || 0,
    bufferAfterMinutes: extra && extra.bufferAfterMinutes || 0
  }, extra || {});
}

function fakePlan(overrides) {
  const start = overrides.visitStartMin != null ? overrides.visitStartMin : 14 * 60;
  const wait = overrides.totalClientWaitMinutes != null ? overrides.totalClientWaitMinutes : 0;
  const gelEnd = start + 45;
  const pediStart = gelEnd + wait;
  const pediEnd = pediStart + 45;
  const lines = overrides.serviceLines || [
    {
      lineKey: "gel",
      serviceId: "svc-gel",
      providerId: overrides.gelProvider || "maria",
      startMin: start,
      endMin: gelEnd,
      durationMinutes: 45,
      blockIndex: 0,
      resourceAssignments: []
    },
    {
      lineKey: "pedi",
      serviceId: "svc-pedi",
      providerId: overrides.pediProvider || "ana",
      startMin: pediStart,
      endMin: pediEnd,
      durationMinutes: 45,
      blockIndex: 1,
      resourceAssignments: overrides.noResources
        ? []
        : [resAssign("chair", overrides.chairId || "chair-1", pediStart, pediEnd)]
    }
  ];
  const blocks = overrides.blocks || [
    {
      blockIndex: 0,
      sourceBlockIndex: 0,
      startMin: start,
      endMin: gelEnd,
      waitBeforeMinutes: 0,
      parallel: false,
      lineKeys: [lines[0].lineKey],
      durationMinutes: 45
    },
    {
      blockIndex: 1,
      sourceBlockIndex: 1,
      startMin: lines[1] ? lines[1].startMin : pediStart,
      endMin: lines[1] ? lines[1].endMin : pediEnd,
      waitBeforeMinutes: wait,
      parallel: false,
      lineKeys: lines[1] ? [lines[1].lineKey] : [],
      durationMinutes: 45
    }
  ];
  return Object.assign({
    valid: true,
    dateKey: overrides.dateKey || "2026-09-14",
    locationId: overrides.locationId || "locA",
    visitStartMin: start,
    visitEndMin: lines.length === 1 ? lines[0].endMin : (overrides.visitEndMin != null ? overrides.visitEndMin : pediEnd),
    totalClientWaitMinutes: wait,
    visitElapsedMinutes: (lines.length === 1 ? lines[0].endMin : pediEnd) - start,
    sumServiceMinutes: lines.reduce(function (sum, row) { return sum + (row.durationMinutes || 0); }, 0),
    parallelMinutesSaved: overrides.parallelMinutesSaved || 0,
    orderChanged: !!overrides.orderChanged,
    orderDistance: overrides.orderChanged ? 1 : 0,
    timeDistanceMinutes: 0,
    flexibleVisitPlanScore: overrides.flexibleVisitPlanScore != null ? overrides.flexibleVisitPlanScore : 90,
    assignmentKey: lines.map(function (row) { return row.lineKey + "|" + row.providerId; }).join("||"),
    resourceAssignmentKey: overrides.noResources ? "" : ("pedi|chair|" + (overrides.chairId || "chair-1")),
    overlapLineCount: overrides.overlapLineCount || 0,
    blocks: blocks,
    serviceLines: lines,
    searchMetadata: { truncated: false, exhaustive: true }
  }, overrides.extra || {});
}

function offerFrom(plan) {
  return api.rankClientVisitOffers([], [], {}, { sourcePlans: [plan], maxOffers: 1 })[0];
}

function acceptOf(offer, extra) {
  return Object.assign({
    acceptanceId: extra && extra.acceptanceId || "accept-1",
    offerId: offer.offerId,
    sourcePlanKey: offer.sourcePlanKey,
    clientId: extra && extra.clientId !== undefined ? extra.clientId : "client-1"
  }, extra || {});
}

function baseContext(extra) {
  return Object.assign({
    salonId: "salon-1",
    client: {
      clientId: "client-1",
      displayName: "Jessica Miller",
      phone: "305-555-1212",
      email: "a@b.com"
    },
    staffById: {
      maria: { name: "Maria" },
      ana: { name: "Ana" }
    },
    servicesById: {
      "svc-gel": { name: "Gel Mani", defaultPrice: 45, durationMinutes: 45 },
      "svc-pedi": { name: "Regular Pedi", defaultPrice: 50, durationMinutes: 45 }
    },
    source: "front_desk",
    notes: "Phase 18B preview",
    createdByUid: "uid-1",
    createdByStaffId: "staff-1"
  }, extra || {});
}

const TWO = 14 * 60;
const PEDI_250 = TWO + 50;
const maria = makeDay({ providerId: "maria" });
const ana = makeDay({ providerId: "ana" });
const chair1 = makeResource({ resourceId: "chair-1" });
const chair2 = makeResource({ resourceId: "chair-2" });

check("public adapter API loaded", !!(
  api.adaptAcceptanceCommandToBookingCreateInput
  && api.simulateBookingExecution
  && api.bookingPayloadPreview
  && api.deterministicBookingLineId
  && api.BOOKING_EXECUTION_ADAPTER
));

const adapterSrc = fs.readFileSync(path.join(root, "public/booking/smart-scheduling/booking-execution-adapter.js"), "utf8");
check("adapter source has no Date.now", adapterSrc.indexOf("Date.now") === -1);
check("adapter source has no Math.random", adapterSrc.indexOf("Math.random") === -1);
check("adapter source has no firebase I/O", !/\b(addDoc|getDoc|getDocs|setDoc|updateDoc|runTransaction|writeBatch|collection|onSnapshot)\b/.test(adapterSrc));
check("adapter source has no network", !/\bfetch\b|XMLHttpRequest|WebSocket/.test(adapterSrc));
check("adapter source has no DOM/calendar/reports", !/document\.|ffBookingCalendar|ffReports/.test(adapterSrc));

function prepare(plan, extra) {
  const offer = offerFrom(plan);
  const acceptance = acceptOf(offer, extra);
  return api.prepareOfferAcceptance([maria, ana], [chair1, chair2], offer, acceptance, {
    availabilityVersions: [{ locationId: offer.locationId, version: 12 }]
  });
}

const singlePlan = fakePlan({
  noResources: true,
  serviceLines: [{
    lineKey: "gel",
    serviceId: "svc-gel",
    providerId: "maria",
    startMin: TWO,
    endMin: TWO + 45,
    durationMinutes: 45,
    blockIndex: 0,
    resourceAssignments: []
  }],
  blocks: [{
    blockIndex: 0,
    sourceBlockIndex: 0,
    startMin: TWO,
    endMin: TWO + 45,
    waitBeforeMinutes: 0,
    parallel: false,
    lineKeys: ["gel"],
    durationMinutes: 45
  }],
  visitEndMin: TWO + 45
});
const singleReady = prepare(singlePlan);
const singleCmd = singleReady.bookingCommand;
const singleCtx = baseContext();
const singleAdapt = api.adaptAcceptanceCommandToBookingCreateInput(singleCmd, singleCtx);

check("BASIC valid command maps to Booking create input", !!(singleAdapt && singleAdapt.valid && singleAdapt.bookingCreateInput), singleAdapt);
check("BASIC one service line", singleAdapt.bookingCreateInput.serviceLines.length === 1);
check("BASIC service/provider/duration preserved", !!(
  singleAdapt.bookingCreateInput.serviceLines[0].serviceId === "svc-gel"
  && singleAdapt.bookingCreateInput.serviceLines[0].providerId === "maria"
  && singleAdapt.bookingCreateInput.serviceLines[0].durationMinutes === 45
));
check("BASIC snapshots come from caller context", !!(
  singleAdapt.bookingCreateInput.serviceLines[0].serviceNameSnapshot === "Gel Mani"
  && singleAdapt.bookingCreateInput.serviceLines[0].providerNameSnapshot === "Maria"
  && singleAdapt.bookingCreateInput.serviceLines[0].priceSnapshot === 45
));
check("BASIC clientId required field present", singleAdapt.bookingCreateInput.clientId === "client-1");
check("BASIC locationId and dateKey preserved", singleAdapt.bookingCreateInput.locationId === "locA" && singleAdapt.persistencePreview.dateKey === "2026-09-14");
check("BASIC source is caller-supported enum not smart_scheduling", singleAdapt.bookingCreateInput.source === "front_desk");
check("BASIC assignmentType is specific_provider", singleAdapt.bookingCreateInput.assignmentType === "specific_provider");
check("BASIC requested is false for optimizer assignment", singleAdapt.bookingCreateInput.serviceLines[0].requested === false);
check("BASIC appointmentId strategy is current auto-id", singleAdapt.appointmentIdStrategy === "firestore_auto_id_currently");
check("BASIC createdAt is server_timestamp_required", singleAdapt.persistencePreview.createdAt === "server_timestamp_required" && singleAdapt.persistencePreview.updatedAt === "server_timestamp_required");
check("BASIC firstVisit is not invented", singleAdapt.persistencePreview.firstVisit === "requires_client_history_io");
check("BASIC normalizeCreateInput accepts adapted input", model.normalizeCreateInput(singleAdapt.bookingCreateInput).ok === true);
check("BASIC availabilityVersions stay off bookingCreateInput", !Object.prototype.hasOwnProperty.call(singleAdapt.bookingCreateInput, "availabilityVersions"));
check("BASIC availabilityVersions stay off persistencePreview", !Object.prototype.hasOwnProperty.call(singleAdapt.persistencePreview, "availabilityVersions"));
check("BASIC provenance keeps command availabilityVersions", !!(
  singleAdapt.smartSchedulingProvenance.availabilityVersions
  && singleAdapt.smartSchedulingProvenance.availabilityVersions.length === 1
  && singleAdapt.smartSchedulingProvenance.availabilityVersions[0].locationId === "locA"
  && singleAdapt.smartSchedulingProvenance.availabilityVersions[0].version === 12
  && !Object.prototype.hasOwnProperty.call(singleAdapt.smartSchedulingProvenance, "availabilityVersion")
));

const waitPlan = fakePlan({ totalClientWaitMinutes: 5, noResources: true });
const waitReady = prepare(waitPlan);
const waitAdapt = api.adaptAcceptanceCommandToBookingCreateInput(waitReady.bookingCommand, baseContext());
const waitInput = waitAdapt.bookingCreateInput;
check("MULTI-SERVICE one create input", waitAdapt.valid && waitInput.serviceLines.length === 2);
check("MULTI-PROVIDER one appointment with both providers", waitInput.serviceLines[0].providerId === "maria" && waitInput.serviceLines[1].providerId === "ana" && waitAdapt.persistencePreview.providerIds.join(",") === "maria,ana");
check("CLIENT WAIT does not invent a wait service line", waitInput.serviceLines.every(function (line) {
  return line.serviceId === "svc-gel" || line.serviceId === "svc-pedi";
}) && waitInput.serviceLines.length === 2);
check("CLIENT WAIT 2:50 pedi start is exact minutes", waitInput.serviceLines[1].startAt.getTime() === model.civilToDate("2026-09-14", PEDI_250, "locA").getTime());
check("NO SNAP 2:50 is not rounded to :45 or :00", waitInput.serviceLines[1].startAt.getTime() !== model.civilToDate("2026-09-14", TWO + 45, "locA").getTime() && waitInput.serviceLines[1].startAt.getTime() !== model.civilToDate("2026-09-14", TWO + 60, "locA").getTime());
check("APPOINTMENT WINDOW min/max match visit", waitAdapt.persistencePreview.startAt.getTime() === model.civilToDate("2026-09-14", TWO, "locA").getTime() && waitAdapt.persistencePreview.endAt.getTime() === model.civilToDate("2026-09-14", PEDI_250 + 45, "locA").getTime());
check("CLIENT WAIT span includes the 5-minute wait", waitAdapt.persistencePreview.endAt.getTime() - waitAdapt.persistencePreview.startAt.getTime() === 95 * 60000);

const parallelLines = [
  {
    lineKey: "gel",
    serviceId: "svc-gel",
    providerId: "maria",
    startMin: TWO,
    endMin: TWO + 45,
    durationMinutes: 45,
    blockIndex: 0,
    resourceAssignments: []
  },
  {
    lineKey: "pedi",
    serviceId: "svc-pedi",
    providerId: "ana",
    startMin: TWO,
    endMin: TWO + 45,
    durationMinutes: 45,
    blockIndex: 0,
    resourceAssignments: []
  }
];
const parallelPlan = fakePlan({
  noResources: true,
  serviceLines: parallelLines,
  visitEndMin: TWO + 45,
  overlapLineCount: 2,
  parallelMinutesSaved: 45,
  blocks: [{
    blockIndex: 0,
    sourceBlockIndex: 0,
    startMin: TWO,
    endMin: TWO + 45,
    waitBeforeMinutes: 0,
    parallel: true,
    parallelGroup: "g1",
    lineKeys: ["gel", "pedi"],
    durationMinutes: 45
  }]
});
const parallelReady = prepare(parallelPlan);
const parallelAdapt = api.adaptAcceptanceCommandToBookingCreateInput(parallelReady.bookingCommand, baseContext());
check("PARALLEL remains two overlapping lines", !!(
  parallelAdapt.valid
  && parallelAdapt.bookingCreateInput.serviceLines.length === 2
  && parallelAdapt.bookingCreateInput.serviceLines[0].startAt.getTime() === parallelAdapt.bookingCreateInput.serviceLines[1].startAt.getTime()
  && parallelAdapt.bookingCreateInput.serviceLines[0].endAt.getTime() === parallelAdapt.bookingCreateInput.serviceLines[1].endAt.getTime()
  && parallelAdapt.bookingCreateInput.serviceLines[0].providerId !== parallelAdapt.bookingCreateInput.serviceLines[1].providerId
));
check("PARALLEL is still one appointment", parallelAdapt.persistencePreview.providerIds.join(",") === "maria,ana");

const reorderedPlan = fakePlan({
  noResources: true,
  orderChanged: true,
  serviceLines: [
    {
      lineKey: "pedi",
      serviceId: "svc-pedi",
      providerId: "ana",
      startMin: TWO,
      endMin: TWO + 45,
      durationMinutes: 45,
      blockIndex: 0,
      resourceAssignments: []
    },
    {
      lineKey: "gel",
      serviceId: "svc-gel",
      providerId: "maria",
      startMin: TWO + 45,
      endMin: TWO + 90,
      durationMinutes: 45,
      blockIndex: 1,
      resourceAssignments: []
    }
  ],
  blocks: [
    {
      blockIndex: 0,
      sourceBlockIndex: 1,
      startMin: TWO,
      endMin: TWO + 45,
      waitBeforeMinutes: 0,
      parallel: false,
      lineKeys: ["pedi"],
      durationMinutes: 45
    },
    {
      blockIndex: 1,
      sourceBlockIndex: 0,
      startMin: TWO + 45,
      endMin: TWO + 90,
      waitBeforeMinutes: 0,
      parallel: false,
      lineKeys: ["gel"],
      durationMinutes: 45
    }
  ],
  visitEndMin: TWO + 90
});
const reorderedReady = prepare(reorderedPlan);
const reorderedAdapt = api.adaptAcceptanceCommandToBookingCreateInput(reorderedReady.bookingCommand, baseContext());
check("REORDERED accepted Pedi-then-Mani order preserved", !!(
  reorderedAdapt.valid
  && reorderedAdapt.bookingCreateInput.serviceLines[0].serviceId === "svc-pedi"
  && reorderedAdapt.bookingCreateInput.serviceLines[1].serviceId === "svc-gel"
  && reorderedAdapt.bookingCreateInput.serviceLines[0].lineId.indexOf(encodeURIComponent("pedi")) !== -1
));
check("ATOMIC one gel line never splits", singleAdapt.bookingCreateInput.serviceLines.length === 1 && singleAdapt.bookingCreateInput.serviceLines[0].endAt.getTime() - singleAdapt.bookingCreateInput.serviceLines[0].startAt.getTime() === 45 * 60000);

const noClientOffer = offerFrom(singlePlan);
const noClientPrepared = api.prepareOfferAcceptance([maria, ana], [chair1], noClientOffer, {
  acceptanceId: "accept-no-client",
  offerId: noClientOffer.offerId,
  sourcePlanKey: noClientOffer.sourcePlanKey
}, {
  availabilityVersions: [{ locationId: noClientOffer.locationId, version: 12 }]
});
check("Phase 17 can prepare without clientId", noClientPrepared.status === "ready" && !noClientPrepared.bookingCommand.clientId);
const missingClientAdapt = api.adaptAcceptanceCommandToBookingCreateInput(noClientPrepared.bookingCommand, baseContext());
check("MISSING CLIENT is adapter-invalid", missingClientAdapt.valid === false && missingClientAdapt.reasonCodes.indexOf("client_required_for_booking") !== -1 && !missingClientAdapt.bookingCreateInput);
const missingClientSim = api.simulateBookingExecution([maria, ana], [chair1], noClientPrepared.bookingCommand, noClientPrepared.transactionPreconditions, baseContext());
check("MISSING CLIENT simulator is adapter_invalid", missingClientSim.status === "adapter_invalid" && missingClientSim.blockers.indexOf("client_required_for_booking") !== -1);

function assertInvalid(name, result, code, extra) {
  check(name, !!(
    result
    && result.valid === false
    && !result.bookingCreateInput
    && !result.persistencePreview
    && result.reasonCodes.indexOf(code) !== -1
    && result.warnings.indexOf("service_snapshot_incomplete") === -1
    && result.warnings.indexOf("staff_snapshot_incomplete") === -1
    && result.warnings.indexOf("client_snapshot_incomplete") === -1
  ), extra != null ? extra : result);
}

const blankServiceIdCmd = JSON.parse(JSON.stringify(singleCmd));
blankServiceIdCmd.serviceLines[0].serviceId = "";
blankServiceIdCmd.acceptanceFingerprint = api.acceptanceFingerprintForCommand(blankServiceIdCmd);
const blankServiceIdAdapt = api.adaptAcceptanceCommandToBookingCreateInput(blankServiceIdCmd, baseContext());
assertInvalid("MISSING SERVICE ID is adapter-invalid", blankServiceIdAdapt, "service_required_for_booking");
const blankServiceIdPre = JSON.parse(JSON.stringify(singleReady.transactionPreconditions));
blankServiceIdPre.acceptanceFingerprint = blankServiceIdCmd.acceptanceFingerprint;
const blankServiceIdSim = api.simulateBookingExecution([maria, ana], [chair1], blankServiceIdCmd, blankServiceIdPre, baseContext());
check("MISSING SERVICE ID simulator is adapter_invalid", blankServiceIdSim.status === "adapter_invalid" && !blankServiceIdSim.bookingCreateInput && blankServiceIdSim.reasonCodes.indexOf("service_required_for_booking") !== -1);

const missingServiceRecord = api.adaptAcceptanceCommandToBookingCreateInput(singleCmd, baseContext({
  servicesById: { "svc-pedi": { name: "Regular Pedi", defaultPrice: 50 } }
}));
assertInvalid("MISSING SERVICE RECORD is adapter-invalid", missingServiceRecord, "service_snapshot_required");
const missingServiceRecordSim = api.simulateBookingExecution([maria, ana], [chair1], singleCmd, singleReady.transactionPreconditions, baseContext({
  servicesById: { "svc-pedi": { name: "Regular Pedi", defaultPrice: 50 } }
}));
check("MISSING SERVICE RECORD simulator is adapter_invalid", missingServiceRecordSim.status === "adapter_invalid" && missingServiceRecordSim.reasonCodes.indexOf("service_snapshot_required") !== -1);

const missingServiceName = api.adaptAcceptanceCommandToBookingCreateInput(singleCmd, baseContext({
  servicesById: { "svc-gel": { defaultPrice: 45, durationMinutes: 45 } }
}));
assertInvalid("MISSING SERVICE NAME is adapter-invalid", missingServiceName, "service_snapshot_required");

const missingPrice = api.adaptAcceptanceCommandToBookingCreateInput(singleCmd, baseContext({
  servicesById: { "svc-gel": { name: "Gel Mani", durationMinutes: 45 } }
}));
assertInvalid("MISSING PRICE is adapter-invalid", missingPrice, "service_price_snapshot_required");
const nanPrice = api.adaptAcceptanceCommandToBookingCreateInput(singleCmd, baseContext({
  servicesById: { "svc-gel": { name: "Gel Mani", defaultPrice: NaN } }
}));
assertInvalid("NaN PRICE is adapter-invalid", nanPrice, "service_price_snapshot_required");

const freeAdapt = api.adaptAcceptanceCommandToBookingCreateInput(singleCmd, baseContext({
  servicesById: { "svc-gel": { name: "Complimentary Gel", defaultPrice: 0, durationMinutes: 45 } }
}));
check("EXPLICIT ZERO PRICE is valid complimentary mapping", !!(
  freeAdapt.valid
  && freeAdapt.bookingCreateInput
  && freeAdapt.bookingCreateInput.serviceLines[0].priceSnapshot === 0
  && freeAdapt.bookingCreateInput.serviceLines[0].serviceNameSnapshot === "Complimentary Gel"
));

const missingProviderRecord = api.adaptAcceptanceCommandToBookingCreateInput(singleCmd, baseContext({
  staffById: { ana: { name: "Ana" } }
}));
assertInvalid("MISSING PROVIDER RECORD is adapter-invalid", missingProviderRecord, "provider_snapshot_required");
const missingProviderName = api.adaptAcceptanceCommandToBookingCreateInput(singleCmd, baseContext({
  staffById: { maria: { name: "" }, ana: { name: "Ana" } }
}));
assertInvalid("MISSING PROVIDER NAME is adapter-invalid", missingProviderName, "provider_snapshot_required");

const missingClientName = api.adaptAcceptanceCommandToBookingCreateInput(singleCmd, baseContext({
  client: { clientId: "client-1" }
}));
assertInvalid("MISSING CLIENT DISPLAY NAME is adapter-invalid", missingClientName, "client_snapshot_required");
const clientMismatch = api.adaptAcceptanceCommandToBookingCreateInput(singleCmd, baseContext({
  client: { clientId: "other-client", displayName: "Pat Other" }
}));
assertInvalid("CLIENT ID MISMATCH is adapter-invalid", clientMismatch, "client_context_mismatch");

const missingSalon = api.adaptAcceptanceCommandToBookingCreateInput(singleCmd, baseContext({ salonId: "" }));
assertInvalid("MISSING SALON ID is adapter-invalid", missingSalon, "salon_context_required");
const missingSalonSim = api.simulateBookingExecution([maria, ana], [chair1], singleCmd, singleReady.transactionPreconditions, baseContext({ salonId: "" }));
check("MISSING SALON ID simulator is adapter_invalid", missingSalonSim.status === "adapter_invalid" && missingSalonSim.reasonCodes.indexOf("salon_context_required") !== -1 && !missingSalonSim.bookingCreateInput);

check("COMPLETE CONTEXT remains a valid adapter result", singleAdapt.valid === true && !!singleAdapt.bookingCreateInput && singleAdapt.warnings.indexOf("service_snapshot_incomplete") === -1 && singleAdapt.warnings.indexOf("staff_snapshot_incomplete") === -1 && singleAdapt.warnings.indexOf("client_snapshot_incomplete") === -1);

const idA = api.deterministicBookingLineId(waitReady.bookingCommand, "gel");
const idB = api.deterministicBookingLineId(waitReady.bookingCommand, "gel");
const idC = api.deterministicBookingLineId(waitReady.bookingCommand, "pedi");
const again = api.adaptAcceptanceCommandToBookingCreateInput(waitReady.bookingCommand, baseContext());
check("LINE ID mapping is deterministic", idA === idB && idA === waitAdapt.bookingCreateInput.serviceLines[0].lineId && again.bookingCreateInput.serviceLines[0].lineId === waitAdapt.bookingCreateInput.serviceLines[0].lineId);
check("LINE ID differs from lineKey", waitAdapt.bookingCreateInput.serviceLines[0].lineId !== "gel" && waitAdapt.smartSchedulingProvenance.lineKeyToLineId.gel === waitAdapt.bookingCreateInput.serviceLines[0].lineId);
check("LINE ID namespace is smart_", waitAdapt.bookingCreateInput.serviceLines[0].lineId.indexOf("smart_") === 0 && idC !== idA);
check("LINE ID uses command identity + lineKey", waitAdapt.smartSchedulingProvenance.lineKeyToLineId.pedi === waitAdapt.bookingCreateInput.serviceLines[1].lineId);

const requestedAdapt = api.adaptAcceptanceCommandToBookingCreateInput(waitReady.bookingCommand, baseContext({
  requestedByLineKey: { gel: true }
}));
check("REQUESTED only when caller marks the source request", requestedAdapt.bookingCreateInput.serviceLines[0].requested === true && requestedAdapt.bookingCreateInput.serviceLines[1].requested === false);

const defaultSourceAdapt = api.adaptAcceptanceCommandToBookingCreateInput(singleCmd, baseContext({ source: undefined }));
check("SOURCE defaults to internal", defaultSourceAdapt.bookingCreateInput.source === "internal");
const badSourceAdapt = api.adaptAcceptanceCommandToBookingCreateInput(singleCmd, baseContext({ source: "smart_scheduling" }));
check("SOURCE rejects unsupported smart_scheduling enum", badSourceAdapt.bookingCreateInput.source === "internal");

const resourcePlan = fakePlan({ totalClientWaitMinutes: 5 });
const resourceReady = prepare(resourcePlan);
const resourceAdapt = api.adaptAcceptanceCommandToBookingCreateInput(resourceReady.bookingCommand, baseContext());
check("RESOURCE command still maps appointment payload", resourceAdapt.valid === true && resourceAdapt.bookingCreateInput.serviceLines.length === 2);
check("RESOURCE reservations are not appointment service lines", resourceAdapt.bookingCreateInput.serviceLines.every(function (line) {
  return !line.resourceId && !line.resourceAssignments;
}) && resourceAdapt.physicalResourceReservations.length === 1);
check("RESOURCE requiresResourcePersistence", resourceAdapt.requiresResourcePersistence === true && resourceAdapt.blockers.indexOf("physical_resource_persistence_missing") !== -1);
check("RESOURCE reservation keeps Chair identity", resourceAdapt.physicalResourceReservations[0].resourceId === "chair-1" && resourceAdapt.physicalResourceReservations[0].lineKey === "pedi");

check("NO-RESOURCE still has provider + idempotency blockers", singleAdapt.blockers.indexOf("provider_atomic_guard_missing") !== -1 && singleAdapt.blockers.indexOf("idempotency_persistence_missing") !== -1 && singleAdapt.blockers.indexOf("physical_resource_persistence_missing") === -1);

check("PROVENANCE keeps offer/acceptance/idempotency/fingerprint", !!(
  waitAdapt.smartSchedulingProvenance.offerId === waitReady.bookingCommand.offerId
  && waitAdapt.smartSchedulingProvenance.sourcePlanKey === waitReady.bookingCommand.sourcePlanKey
  && waitAdapt.smartSchedulingProvenance.acceptanceId === waitReady.bookingCommand.acceptanceId
  && waitAdapt.smartSchedulingProvenance.idempotencyKey === waitReady.bookingCommand.idempotencyKey
  && waitAdapt.smartSchedulingProvenance.acceptanceFingerprint === waitReady.bookingCommand.acceptanceFingerprint
));
check("PROVENANCE is not on create input", !("smartScheduling" in waitAdapt.bookingCreateInput) && waitAdapt.persistencePreview.smartSchedulingNotIncluded === true);

const persistWithProv = Object.assign({}, waitAdapt.persistencePreview, {
  smartScheduling: waitAdapt.smartSchedulingProvenance,
  clientSnapshot: waitAdapt.persistencePreview.clientSnapshot
});
const readBack = model.fromDoc("preview", persistWithProv);
check("CURRENT READER strips unknown provenance", readBack.smartScheduling == null && waitAdapt.provenanceReadbackRequiresModelChange === true && waitAdapt.provenancePersistenceCompatible === true);
check("CURRENT READER warning is classified as warning not hard blocker", waitAdapt.warnings.indexOf("provenance_readback_requires_model_change") !== -1 && waitAdapt.blockers.indexOf("provenance_readback_requires_model_change") === -1);

const preview = api.bookingPayloadPreview(waitReady.bookingCommand, baseContext());
check("payload preview keeps create vs persist vs extras distinct", !!(
  preview.valid
  && preview.bookingCreateInput.serviceLines
  && preview.persistencePreview.appointmentIdStrategy === "firestore_auto_id_currently"
  && preview.smartSchedulingProvenance.lineKeyToLineId
  && preview.physicalResourceReservations
));

const noResourceSim = api.simulateBookingExecution(
  [maria, ana],
  [chair1],
  singleCmd,
  singleReady.transactionPreconditions,
  singleCtx
);
check("NO-RESOURCE simulator is blocked_by_missing_persistence", noResourceSim.status === "blocked_by_missing_persistence" && noResourceSim.validMapping === true && noResourceSim.readyForAtomicExecution === false);
check("NO-RESOURCE simulator lists atomic + idempotency blockers", noResourceSim.blockers.indexOf("provider_atomic_guard_missing") !== -1 && noResourceSim.blockers.indexOf("idempotency_persistence_missing") !== -1);

const resourceSim = api.simulateBookingExecution(
  [maria, ana],
  [chair1, chair2],
  resourceReady.bookingCommand,
  resourceReady.transactionPreconditions,
  baseContext()
);
check("RESOURCE simulator is blocked_by_missing_persistence", resourceSim.status === "blocked_by_missing_persistence" && resourceSim.validMapping === true);
check("RESOURCE simulator lists physical_resource_persistence_missing", resourceSim.blockers.indexOf("physical_resource_persistence_missing") !== -1);

const busyMaria = makeDay({ providerId: "maria", lines: [occ(TWO, TWO + 30, { providerId: "maria" })] });
const toctouProvider = api.simulateBookingExecution(
  [busyMaria, ana],
  [chair1],
  waitReady.bookingCommand,
  waitReady.transactionPreconditions,
  baseContext()
);
check("TOCTOU PROVIDER fails before adapter", toctouProvider.status === "precondition_failed" && toctouProvider.bookingCreateInput == null && toctouProvider.validMapping === false);

const busyChair = makeResource({
  resourceId: "chair-1",
  occupied: [{ occupancyId: "taken-chair", startMin: PEDI_250, endMin: PEDI_250 + 45 }]
});
const toctouResource = api.simulateBookingExecution(
  [maria, ana],
  [busyChair],
  resourceReady.bookingCommand,
  resourceReady.transactionPreconditions,
  baseContext()
);
check("TOCTOU RESOURCE fails before adapter", toctouResource.status === "precondition_failed" && toctouResource.bookingCreateInput == null);

const already = api.simulateBookingExecution(
  [maria, ana],
  [chair1],
  waitReady.bookingCommand,
  waitReady.transactionPreconditions,
  baseContext(),
  { completedIdempotencyKeys: [waitReady.bookingCommand.idempotencyKey] }
);
check("ALREADY COMPLETED preserved", already.status === "already_completed" && already.bookingCreateInput == null);

const tampered = copyAndTamper(waitReady.bookingCommand);
function copyAndTamper(command) {
  const next = JSON.parse(JSON.stringify(command));
  next.serviceLines[0].startMin = TWO + 15;
  next.serviceLines[0].endMin = TWO + 60;
  return next;
}
const tamperAdapt = api.adaptAcceptanceCommandToBookingCreateInput(tampered, baseContext());
const tamperSim = api.simulateBookingExecution(
  [maria, ana],
  [chair1],
  tampered,
  waitReady.transactionPreconditions,
  baseContext()
);
check("COMMAND TAMPER stops adapter", tamperAdapt.valid === false && tamperAdapt.reasonCodes.indexOf("command_integrity_mismatch") !== -1 && !tamperAdapt.bookingCreateInput);
check("COMMAND TAMPER simulator is command_invalid", tamperSim.status === "command_invalid" && tamperSim.bookingCreateInput == null);

const versionTampered = JSON.parse(JSON.stringify(waitReady.bookingCommand));
versionTampered.availabilityVersions = [{ locationId: "locA", version: 13 }];
const versionTamperAdapt = api.adaptAcceptanceCommandToBookingCreateInput(versionTampered, baseContext());
check("VERSION TAMPER stops adapter before mapping", versionTamperAdapt.valid === false && versionTamperAdapt.reasonCodes.indexOf("command_integrity_mismatch") !== -1 && !versionTamperAdapt.bookingCreateInput);

const ctxSnap = baseContext();
const cmdSnap = JSON.parse(JSON.stringify(waitReady.bookingCommand));
const ctxBefore = JSON.stringify(ctxSnap);
const cmdBefore = JSON.stringify(waitReady.bookingCommand);
api.adaptAcceptanceCommandToBookingCreateInput(waitReady.bookingCommand, ctxSnap);
api.simulateBookingExecution([maria, ana], [chair1], waitReady.bookingCommand, waitReady.transactionPreconditions, ctxSnap);
check("CONTEXT INPUT IMMUTABILITY", ctxBefore === JSON.stringify(ctxSnap));
check("COMMAND INPUT IMMUTABILITY", cmdBefore === JSON.stringify(waitReady.bookingCommand) && cmdBefore === JSON.stringify(cmdSnap));

const sameA = api.adaptAcceptanceCommandToBookingCreateInput(waitReady.bookingCommand, baseContext());
const sameB = api.adaptAcceptanceCommandToBookingCreateInput(waitReady.bookingCommand, baseContext());
check("DETERMINISM same command+context same lineIds", sameA.bookingCreateInput.serviceLines[0].lineId === sameB.bookingCreateInput.serviceLines[0].lineId && sameA.bookingCreateInput.serviceLines[1].lineId === sameB.bookingCreateInput.serviceLines[1].lineId);
check("DETERMINISM same civil instants", sameA.bookingCreateInput.serviceLines[1].startAt.getTime() === sameB.bookingCreateInput.serviceLines[1].startAt.getTime());
check("DETERMINISM same fingerprint provenance", sameA.smartSchedulingProvenance.acceptanceFingerprint === sameB.smartSchedulingProvenance.acceptanceFingerprint);
check("DETERMINISM same availabilityVersions provenance", JSON.stringify(sameA.smartSchedulingProvenance.availabilityVersions) === JSON.stringify(sameB.smartSchedulingProvenance.availabilityVersions));

const mismatchWindow = JSON.parse(JSON.stringify(waitReady.bookingCommand));
mismatchWindow.visitEndMin = waitReady.bookingCommand.visitEndMin + 10;
mismatchWindow.acceptanceFingerprint = api.acceptanceFingerprintForCommand(mismatchWindow);
const windowFail = api.adaptAcceptanceCommandToBookingCreateInput(mismatchWindow, baseContext());
check("WINDOW mismatch is adapter failure", windowFail.valid === false && windowFail.reasonCodes.indexOf("command_visit_window_mismatch") !== -1);

const overnight = JSON.parse(JSON.stringify(singleCmd));
overnight.visitEndMin = overnight.visitStartMin - 15;
overnight.acceptanceFingerprint = api.acceptanceFingerprintForCommand(overnight);
const overnightFail = api.adaptAcceptanceCommandToBookingCreateInput(overnight, baseContext());
check("OVERNIGHT without expressible span is reported", overnightFail.valid === false && overnightFail.reasonCodes.indexOf("overnight_visit_not_safely_expressible") !== -1);

check("writesPerformed is always false", noResourceSim.writesPerformed === false && resourceSim.writesPerformed === false && already.writesPerformed === false && tamperSim.writesPerformed === false);
check("advisoryOnly is always true", noResourceSim.advisoryOnly === true && resourceSim.advisoryOnly === true);

if (failed) {
  console.error(failed + " booking execution adapter checks failed.");
  process.exit(1);
}
console.log("All booking execution adapter checks passed.");
