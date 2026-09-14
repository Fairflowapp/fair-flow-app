/**
 * Smart Scheduling Phase 17 offer acceptance command preparation.
 * No Firestore, DOM, Calendar, or Reports.
 * Usage: node scripts/test-booking-smart-scheduling-offer-acceptance.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function load(rel, windowObj) {
  new Function("window", fs.readFileSync(path.join(root, rel), "utf8"))(windowObj);
}

const windowObj = {};
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
  "public/booking/smart-scheduling/offer-acceptance.js"
].forEach(function (rel) { load(rel, windowObj); });

const api = windowObj.ffBookingSmartScheduling;
if (!api || typeof api.prepareOfferAcceptance !== "function") {
  console.error("Smart Scheduling offer acceptance API did not load.");
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
      resourceAssignments: [resAssign("chair", overrides.chairId || "chair-1", pediStart, pediEnd)]
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
      lineKeys: ["gel"],
      durationMinutes: 45
    },
    {
      blockIndex: 1,
      sourceBlockIndex: 1,
      startMin: pediStart,
      endMin: pediEnd,
      waitBeforeMinutes: wait,
      parallel: false,
      lineKeys: ["pedi"],
      durationMinutes: 45
    }
  ];
  return Object.assign({
    valid: true,
    dateKey: overrides.dateKey || "2026-09-14",
    locationId: overrides.locationId || "locA",
    visitStartMin: start,
    visitEndMin: pediEnd,
    totalClientWaitMinutes: wait,
    visitElapsedMinutes: pediEnd - start,
    sumServiceMinutes: 90,
    parallelMinutesSaved: 0,
    orderChanged: !!overrides.orderChanged,
    orderDistance: overrides.orderChanged ? 1 : 0,
    timeDistanceMinutes: 0,
    flexibleVisitPlanScore: overrides.flexibleVisitPlanScore != null ? overrides.flexibleVisitPlanScore : 90,
    assignmentKey: lines.map(function (row) { return row.lineKey + "|" + row.providerId; }).join("||"),
    resourceAssignmentKey: "pedi|chair|" + (overrides.chairId || "chair-1"),
    overlapLineCount: 0,
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
    sourcePlanKey: offer.sourcePlanKey
  }, extra || {});
}

const TWO = 14 * 60;
const maria = makeDay({ providerId: "maria" });
const ana = makeDay({ providerId: "ana" });
const sara = makeDay({ providerId: "sara" });
const chair1 = makeResource({ resourceId: "chair-1" });
const chair2 = makeResource({ resourceId: "chair-2" });
const snapMaria = JSON.stringify(maria);
const snapChair = JSON.stringify(chair1);

check("public acceptance API loaded", !!(
  api.prepareOfferAcceptance
  && api.prepareOfferAcceptances
  && api.evaluateAcceptancePreconditions
  && api.acceptanceFingerprintForCommand
  && api.OFFER_ACCEPTANCE
));

const offer = offerFrom(fakePlan({ visitStartMin: TWO, totalClientWaitMinutes: 5 }));
const offerSnap = JSON.stringify(offer);
const acceptance = acceptOf(offer);
const acceptSnap = JSON.stringify(acceptance);

// ---------------------------------------------------------------------------
// READY / IDENTITY / MISSING ID
// ---------------------------------------------------------------------------

const ready = api.prepareOfferAcceptance([maria, ana], [chair1], offer, acceptance);
check("valid snapshot prepares a ready acceptance", ready && ready.status === "ready" && ready.readyForAtomicExecution === true && ready.refreshRequired === false && ready.reasonCodes.indexOf("ready_for_atomic_execution") !== -1, ready);
check("ready result is advisory and performs no writes", ready && ready.advisoryOnly === true && ready.writesPerformed === false && ready.holdsCapacity === false && ready.idempotencyCheckRequiredAtExecution === true);
check("command times/providers/resources exactly match the offer", !!(ready.bookingCommand
  && ready.bookingCommand.commandType === "create_appointment_from_smart_offer"
  && ready.bookingCommand.locationId === offer.locationId
  && ready.bookingCommand.dateKey === offer.dateKey
  && ready.bookingCommand.visitStartMin === offer.visitStartMin
  && ready.bookingCommand.visitEndMin === offer.visitEndMin
  && ready.bookingCommand.serviceLines[0].providerId === "maria"
  && ready.bookingCommand.serviceLines[0].startMin === TWO
  && ready.bookingCommand.serviceLines[1].providerId === "ana"
  && ready.bookingCommand.serviceLines[1].startMin === TWO + 50
  && ready.bookingCommand.serviceLines[1].resourceAssignments[0].resourceId === "chair-1"
  && ready.bookingCommand.blocks[1].waitBeforeMinutes === 5
));
check("each command service line remains one atomic provider interval", ready.bookingCommand.serviceLines.every(function (line) {
  return typeof line.providerId === "string" && line.endMin === line.startMin + line.durationMinutes;
}));
check("command is bound to offer dateKey and locationId", ready.bookingCommand.dateKey === "2026-09-14" && ready.bookingCommand.locationId === "locA");
check("preconditions carry exact reservation windows not only service times", ready.transactionPreconditions.resources[0]
  && ready.transactionPreconditions.resources[0].reservationStartMin === TWO + 50
  && ready.transactionPreconditions.resources[0].reservationEndMin === TWO + 95);
check("preconditions are machine-readable provider/resource intervals", !!(
  ready.transactionPreconditions.idempotency.checkRequiredAtExecution === true
  && ready.transactionPreconditions.providers.length === 2
  && ready.transactionPreconditions.sameVisitConstraints.uniqueProviderPerOverlappingLine === true
));

const mismatch = api.prepareOfferAcceptance([maria, ana], [chair1], offer, {
  acceptanceId: "accept-1",
  offerId: "other-offer",
  sourcePlanKey: offer.sourcePlanKey
});
check("identity mismatch is invalid_acceptance", mismatch && mismatch.status === "invalid_acceptance" && mismatch.readyForAtomicExecution === false && mismatch.reasonCodes.indexOf("acceptance_offer_identity_mismatch") !== -1 && !mismatch.bookingCommand, mismatch);

const missingId = api.prepareOfferAcceptance([maria, ana], [chair1], offer, {
  acceptanceId: "",
  offerId: offer.offerId,
  sourcePlanKey: offer.sourcePlanKey
});
check("missing acceptanceId is invalid_acceptance", missingId && missingId.status === "invalid_acceptance" && missingId.reasonCodes.indexOf("acceptance_id_missing") !== -1 && !missingId.bookingCommand, missingId);

const blankClient = api.prepareOfferAcceptance([maria, ana], [chair1], offer, acceptOf(offer, { clientId: "" }));
check("blank supplied clientId is invalid_acceptance", blankClient && blankClient.status === "invalid_acceptance" && blankClient.reasonCodes.indexOf("acceptance_client_id_invalid") !== -1, blankClient);

// ---------------------------------------------------------------------------
// STALE / INVALID
// ---------------------------------------------------------------------------

const mariaBusy = makeDay({
  providerId: "maria",
  lines: [occ(TWO, TWO + 45, { providerId: "maria", appointmentId: "booked-gel" })]
});
const stale = api.prepareOfferAcceptance([mariaBusy, ana], [chair1], offer, acceptance);
check("stale offer is rejected with no executable command", stale && stale.status === "stale" && stale.readyForAtomicExecution === false && stale.refreshRequired === true && stale.reasonCodes.indexOf("offer_stale") !== -1 && !stale.bookingCommand, stale);

const tamperedOffer = JSON.parse(JSON.stringify(offer));
tamperedOffer.serviceLines[0].providerId = "sara";
const invalidOffer = api.prepareOfferAcceptance([maria, ana, sara], [chair1], tamperedOffer, {
  acceptanceId: "accept-1",
  offerId: tamperedOffer.offerId,
  sourcePlanKey: tamperedOffer.sourcePlanKey
});
check("invalid offer is rejected without a command", invalidOffer && invalidOffer.status === "invalid_offer" && invalidOffer.readyForAtomicExecution === false && invalidOffer.reasonCodes.indexOf("offer_invalid") !== -1 && !invalidOffer.bookingCommand, invalidOffer);

// ---------------------------------------------------------------------------
// IDEMPOTENCY / FINGERPRINT / CLIENT ID
// ---------------------------------------------------------------------------

const again = api.prepareOfferAcceptance([maria, ana], [chair1], offer, acceptance);
check("same acceptance input yields the same idempotencyKey", ready.idempotencyKey === again.idempotencyKey && ready.idempotencyKey.indexOf("accept|") === 0);
check("same acceptance input yields the same fingerprint", ready.acceptanceFingerprint === again.acceptanceFingerprint && ready.bookingCommand.acceptanceFingerprint === api.acceptanceFingerprintForCommand(ready.bookingCommand));

const otherAccept = api.prepareOfferAcceptance([maria, ana], [chair1], offer, acceptOf(offer, { acceptanceId: "accept-2" }));
check("different acceptanceId yields a different idempotencyKey", otherAccept.status === "ready" && otherAccept.idempotencyKey !== ready.idempotencyKey);

const withClient = api.prepareOfferAcceptance([maria, ana], [chair1], offer, acceptOf(offer, { clientId: "client-9" }));
check("supplied clientId is copied into command and fingerprint", withClient.status === "ready" && withClient.bookingCommand.clientId === "client-9" && withClient.acceptanceFingerprint !== ready.acceptanceFingerprint);
check("absent clientId is not invented", ready.bookingCommand.clientId === undefined);

// ---------------------------------------------------------------------------
// TOCTOU
// ---------------------------------------------------------------------------

const prepared = api.prepareOfferAcceptance([maria, ana], [chair1], offer, acceptance);
const commandSnap = JSON.stringify(prepared.bookingCommand);
const evalOk = api.evaluateAcceptancePreconditions([maria, ana], [chair1], prepared.bookingCommand, prepared.transactionPreconditions);
check("evaluator allows create against the original snapshot", evalOk && evalOk.status === "can_create" && evalOk.writesPerformed === false, evalOk);
check("unchanged command fingerprint is deterministic", prepared.acceptanceFingerprint === api.acceptanceFingerprintForCommand(prepared.bookingCommand)
  && prepared.acceptanceFingerprint === api.acceptanceFingerprintForCommand(JSON.parse(JSON.stringify(prepared.bookingCommand)))
  && prepared.transactionPreconditions.acceptanceFingerprint === prepared.acceptanceFingerprint);

const evalProvider = api.evaluateAcceptancePreconditions([mariaBusy, ana], [chair1], prepared.bookingCommand, prepared.transactionPreconditions);
check("provider TOCTOU fails precondition evaluation", evalProvider && evalProvider.status === "precondition_failed" && evalProvider.reasonCodes.indexOf("provider_now_conflicted") !== -1 && evalProvider.reasonCodes.indexOf("command_integrity_mismatch") === -1, evalProvider);
check("TOCTOU does not mutate the original command", JSON.stringify(prepared.bookingCommand) === commandSnap);

const chairBusy = makeResource({
  resourceId: "chair-1",
  occupied: [{ occupancyId: "taken-chair", startMin: TWO + 50, endMin: TWO + 95 }]
});
const evalResource = api.evaluateAcceptancePreconditions([maria, ana], [chairBusy, chair2], prepared.bookingCommand, prepared.transactionPreconditions);
check("resource TOCTOU fails when Chair 1 is busy", evalResource && evalResource.status === "precondition_failed" && evalResource.reasonCodes.indexOf("resource_now_conflicted") !== -1 && evalResource.reasonCodes.indexOf("command_integrity_mismatch") === -1, evalResource);
check("resource TOCTOU does not substitute Chair 2", evalResource.status === "precondition_failed" && prepared.bookingCommand.serviceLines[1].resourceAssignments[0].resourceId === "chair-1");

const massagePlan = fakePlan({ visitStartMin: 10 * 60, totalClientWaitMinutes: 0 });
massagePlan.serviceLines = [
  {
    lineKey: "massage",
    serviceId: "svc-massage",
    providerId: "maria",
    startMin: 10 * 60,
    endMin: 11 * 60,
    durationMinutes: 60,
    blockIndex: 0,
    resourceAssignments: [resAssign("room", "room-a", 10 * 60, 11 * 60, {
      resourceType: "massage_room",
      reservationEndMin: 11 * 60 + 15,
      bufferAfterMinutes: 15
    })]
  },
  {
    lineKey: "next",
    serviceId: "svc-next",
    providerId: "ana",
    startMin: 11 * 60,
    endMin: 11 * 60 + 30,
    durationMinutes: 30,
    blockIndex: 1,
    resourceAssignments: []
  }
];
massagePlan.blocks = [
  { blockIndex: 0, sourceBlockIndex: 0, startMin: 10 * 60, endMin: 11 * 60, waitBeforeMinutes: 0, parallel: false, lineKeys: ["massage"], durationMinutes: 60 },
  { blockIndex: 1, sourceBlockIndex: 1, startMin: 11 * 60, endMin: 11 * 60 + 30, waitBeforeMinutes: 0, parallel: false, lineKeys: ["next"], durationMinutes: 30 }
];
massagePlan.visitEndMin = 11 * 60 + 30;
massagePlan.visitElapsedMinutes = 90;
massagePlan.assignmentKey = "massage|maria||next|ana";
massagePlan.resourceAssignmentKey = "massage|room|room-a";
const massageOffer = offerFrom(massagePlan);
const room = makeResource({ resourceId: "room-a", resourceType: "massage_room" });
const massageReady = api.prepareOfferAcceptance([maria, ana], [room], massageOffer, acceptOf(massageOffer, { acceptanceId: "massage-1" }));
check("buffer reservation is 10:00–11:15 on the command", massageReady.status === "ready"
  && massageReady.bookingCommand.serviceLines[0].resourceAssignments[0].reservationEndMin === 11 * 60 + 15
  && massageReady.transactionPreconditions.resources[0].reservationEndMin === 11 * 60 + 15);
const roomBusyBuffer = makeResource({
  resourceId: "room-a",
  resourceType: "massage_room",
  occupied: [{ occupancyId: "cleanup-clash", startMin: 11 * 60 + 5, endMin: 11 * 60 + 35 }]
});
const evalBuffer = api.evaluateAcceptancePreconditions([maria, ana], [roomBusyBuffer], massageReady.bookingCommand, massageReady.transactionPreconditions);
check("buffer TOCTOU fails when cleanup window is occupied", evalBuffer && evalBuffer.status === "precondition_failed" && evalBuffer.reasonCodes.indexOf("resource_now_conflicted") !== -1 && evalBuffer.reasonCodes.indexOf("command_integrity_mismatch") === -1, evalBuffer);

// ---------------------------------------------------------------------------
// DOUBLE CLICK / TAMPER
// ---------------------------------------------------------------------------

const firstEval = api.evaluateAcceptancePreconditions([maria, ana], [chair1], prepared.bookingCommand, prepared.transactionPreconditions);
const secondEval = api.evaluateAcceptancePreconditions(
  [maria, ana],
  [chair1],
  prepared.bookingCommand,
  prepared.transactionPreconditions,
  { completedIdempotencyKeys: [prepared.idempotencyKey] }
);
check("double-click simulation: first can_create", firstEval.status === "can_create");
check("double-click simulation: completed key is already_completed", secondEval.status === "already_completed" && secondEval.reasonCodes.indexOf("already_completed") !== -1, secondEval);

const tamperedCmd = JSON.parse(JSON.stringify(prepared.bookingCommand));
tamperedCmd.serviceLines[0].providerId = "sara";
const tamperEval = api.evaluateAcceptancePreconditions([maria, ana, sara], [chair1], tamperedCmd, prepared.transactionPreconditions);
check("tampered command is command_invalid", tamperEval && tamperEval.status === "command_invalid" && tamperEval.reasonCodes.indexOf("command_integrity_mismatch") !== -1, tamperEval);

const tamperedTime = JSON.parse(JSON.stringify(prepared.bookingCommand));
tamperedTime.serviceLines[1].startMin = TWO + 60;
tamperedTime.serviceLines[1].endMin = TWO + 105;
tamperedTime.acceptanceFingerprint = api.acceptanceFingerprintForCommand(tamperedTime);
const tamperTimeEval = api.evaluateAcceptancePreconditions([maria, ana], [chair1], tamperedTime, prepared.transactionPreconditions);
check("tampered time with rewritten fingerprint still fails preconditions", tamperTimeEval && tamperTimeEval.status === "command_invalid" && tamperTimeEval.reasonCodes.indexOf("command_integrity_mismatch") !== -1, tamperTimeEval);

function mutatePrepared(mutator) {
  const cmd = JSON.parse(JSON.stringify(prepared.bookingCommand));
  mutator(cmd);
  return api.evaluateAcceptancePreconditions([maria, ana], [chair1], cmd, prepared.transactionPreconditions);
}

const serviceIdTamper = mutatePrepared(function (cmd) { cmd.serviceLines[0].serviceId = "builder-gel"; });
check("serviceId tamper is command_integrity_mismatch", serviceIdTamper.status === "command_invalid" && serviceIdTamper.reasonCodes.indexOf("command_integrity_mismatch") !== -1, serviceIdTamper);

const waitTamper = mutatePrepared(function (cmd) { cmd.blocks[1].waitBeforeMinutes = 10; });
check("block wait tamper is command_integrity_mismatch", waitTamper.status === "command_invalid" && waitTamper.reasonCodes.indexOf("command_integrity_mismatch") !== -1, waitTamper);

const blockIndexTamper = mutatePrepared(function (cmd) {
  cmd.blocks[0].blockIndex = 1;
  cmd.blocks[1].blockIndex = 0;
  cmd.serviceLines[0].blockIndex = 1;
});
check("block order / blockIndex tamper is command_integrity_mismatch", blockIndexTamper.status === "command_invalid" && blockIndexTamper.reasonCodes.indexOf("command_integrity_mismatch") !== -1, blockIndexTamper);

const durationTamper = mutatePrepared(function (cmd) { cmd.serviceLines[0].durationMinutes = 40; });
check("durationMinutes tamper is command_integrity_mismatch", durationTamper.status === "command_invalid" && durationTamper.reasonCodes.indexOf("command_integrity_mismatch") !== -1, durationTamper);

const bufferTamper = mutatePrepared(function (cmd) {
  cmd.serviceLines[1].resourceAssignments[0].bufferAfterMinutes = 15;
});
check("resource buffer tamper is command_integrity_mismatch", bufferTamper.status === "command_invalid" && bufferTamper.reasonCodes.indexOf("command_integrity_mismatch") !== -1, bufferTamper);

const clientCmd = JSON.parse(JSON.stringify(withClient.bookingCommand));
clientCmd.clientId = "client-other";
const clientTamper = api.evaluateAcceptancePreconditions([maria, ana], [chair1], clientCmd, withClient.transactionPreconditions);
check("clientId tamper is command_integrity_mismatch", clientTamper.status === "command_invalid" && clientTamper.reasonCodes.indexOf("command_integrity_mismatch") !== -1, clientTamper);

const keyTamper = mutatePrepared(function (cmd) { cmd.idempotencyKey = "accept|forged"; });
check("idempotencyKey tamper is command_integrity_mismatch", keyTamper.status === "command_invalid" && keyTamper.reasonCodes.indexOf("command_integrity_mismatch") !== -1, keyTamper);

// ---------------------------------------------------------------------------
// PARALLEL / WAIT / NO RESOURCE / CONTEXT
// ---------------------------------------------------------------------------

const parallelPlan = fakePlan({ visitStartMin: 10 * 60 });
parallelPlan.serviceLines = [
  { lineKey: "mani", serviceId: "svc-mani", providerId: "maria", startMin: 10 * 60, endMin: 11 * 60, durationMinutes: 60, blockIndex: 0, resourceAssignments: [resAssign("chair", "chair-1", 10 * 60, 11 * 60)] },
  { lineKey: "pedi", serviceId: "svc-pedi", providerId: "ana", startMin: 10 * 60, endMin: 11 * 60, durationMinutes: 60, blockIndex: 0, resourceAssignments: [resAssign("chair", "chair-2", 10 * 60, 11 * 60)] }
];
parallelPlan.blocks = [{
  blockIndex: 0, sourceBlockIndex: 0, startMin: 10 * 60, endMin: 11 * 60, waitBeforeMinutes: 0, parallel: true, lineKeys: ["mani", "pedi"], durationMinutes: 60
}];
parallelPlan.visitEndMin = 11 * 60;
parallelPlan.visitElapsedMinutes = 60;
parallelPlan.parallelMinutesSaved = 60;
parallelPlan.assignmentKey = "mani|maria||pedi|ana";
parallelPlan.resourceAssignmentKey = "mani|chair|chair-1||pedi|chair|chair-2";
const parallelOffer = offerFrom(parallelPlan);
const parallelReady = api.prepareOfferAcceptance([maria, ana], [chair1, chair2], parallelOffer, acceptOf(parallelOffer, { acceptanceId: "par-1" }));
check("parallel command keeps simultaneous lines", parallelReady.status === "ready"
  && parallelReady.bookingCommand.blocks[0].parallel === true
  && parallelReady.bookingCommand.serviceLines[0].startMin === parallelReady.bookingCommand.serviceLines[1].startMin
  && parallelReady.transactionPreconditions.sameVisitConstraints.uniqueProviderPerOverlappingLine === true);

const noResPlan = fakePlan({ visitStartMin: 10 * 60, totalClientWaitMinutes: 0 });
noResPlan.serviceLines[1].resourceAssignments = [];
noResPlan.resourceAssignmentKey = "";
const noResOffer = offerFrom(noResPlan);
const noResReady = api.prepareOfferAcceptance([maria, ana], [], noResOffer, acceptOf(noResOffer, { acceptanceId: "nores-1" }));
check("provider-only offer prepares with empty resource preconditions", noResReady.status === "ready" && noResReady.transactionPreconditions.resources.length === 0);
const noResEval = api.evaluateAcceptancePreconditions([maria, ana], [], noResReady.bookingCommand, noResReady.transactionPreconditions);
check("provider-only precondition evaluation can create", noResEval.status === "can_create");

const waitOffer = offerFrom(fakePlan({ visitStartMin: TWO, totalClientWaitMinutes: 5, orderChanged: true }));
const waitReady = api.prepareOfferAcceptance([maria, ana], [chair1], waitOffer, acceptOf(waitOffer, { acceptanceId: "wait-1" }));
check("wait/reorder timeline is preserved on the command", waitReady.status === "ready"
  && waitReady.bookingCommand.serviceLines[1].startMin === TWO + 50
  && waitReady.bookingCommand.blocks[1].waitBeforeMinutes === 5
  && waitReady.bookingCommand.sourceOfferSnapshot.orderChanged === true
  && waitReady.bookingCommand.sourceOfferSnapshot.totalClientWaitMinutes === 5);

const wrongDateDays = [makeDay({ providerId: "maria", dateKey: "2026-09-15" }), makeDay({ providerId: "ana", dateKey: "2026-09-15" })];
const wrongDateRes = [makeResource({ resourceId: "chair-1", dateKey: "2026-09-15" })];
const wrongDateEval = api.evaluateAcceptancePreconditions(wrongDateDays, wrongDateRes, prepared.bookingCommand, prepared.transactionPreconditions);
check("evaluator rejects snapshot date/location mismatch", wrongDateEval && wrongDateEval.status === "precondition_failed" && wrongDateEval.reasonCodes.indexOf("snapshot_context_mismatch") !== -1, wrongDateEval);

const laterOffer = offerFrom(fakePlan({ visitStartMin: 16 * 60, totalClientWaitMinutes: 0 }));
const batch = api.prepareOfferAcceptances([mariaBusy, ana], [chair1], [
  { offer: offer, acceptance: acceptance },
  { offer: laterOffer, acceptance: acceptOf(laterOffer, { acceptanceId: "later-1" }) },
  { offer: offer, acceptance: acceptOf(offer, { acceptanceId: "accept-3" }) }
]);
check("batch preserves order and isolates stale acceptances", batch.length === 3
  && batch[0].status === "stale"
  && batch[1].status === "ready"
  && batch[2].status === "stale"
  && batch[1].offerId === laterOffer.offerId, batch.map(function (row) { return row.status; }));

// ---------------------------------------------------------------------------
// IMMUTABILITY / PURITY / DETERMINISM
// ---------------------------------------------------------------------------

check("providerDays are unchanged", JSON.stringify(maria) === snapMaria);
check("resourceDays are unchanged", JSON.stringify(chair1) === snapChair);
check("offer is unchanged", JSON.stringify(offer) === offerSnap);
check("acceptance is unchanged", JSON.stringify(acceptance) === acceptSnap);
check("same inputs yield the same logical prepare result", JSON.stringify(ready.bookingCommand) === JSON.stringify(again.bookingCommand)
  && ready.idempotencyKey === again.idempotencyKey);
check("same evaluator inputs are deterministic", JSON.stringify(evalOk) === JSON.stringify(api.evaluateAcceptancePreconditions([maria, ana], [chair1], prepared.bookingCommand, prepared.transactionPreconditions)));

const src = fs.readFileSync(path.join(root, "public/booking/smart-scheduling/offer-acceptance.js"), "utf8");
check("purity: no Firebase APIs", !/firebase-firestore|getDocs\s*\(|onSnapshot\s*\(|updateDoc\s*\(|addDoc\s*\(|runTransaction/.test(src));
check("purity: no network", !/\bfetch\s*\(|XMLHttpRequest/.test(src));
check("purity: no writes / timers / Date", !/\bsetTimeout\b|\bsetInterval\b|\bDate\s*\(|Date\.now|createAppointment|updateAppointment|cancelAppointment/.test(src));
check("purity: no DOM / Calendar / Reports", !/\bdocument\b|\blocalStorage\b|ffBookingCal|ffBookingReports/.test(src));
check("purity: no messaging / booking / holds", !/sendSms|sendEmail|twilio|mailer|bookClient|autoBook|holdSlot|reserveChair/i.test(src));
check("reuses Phase 16 rather than duplicating a scheduler", /revalidateClientVisitOffer/.test(src) && !/rankFlexibleVisitPlans|recommendFlexibleVisit|rankClientVisitOffers/.test(src));

if (failed) {
  console.log("\n" + failed + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll offer acceptance checks passed.");
