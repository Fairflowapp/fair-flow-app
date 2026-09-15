/**
 * Smart Scheduling Phase 16 exact client-offer revalidation.
 * No Firestore, DOM, Calendar, or Reports.
 * Usage: node scripts/test-booking-smart-scheduling-offer-revalidation.js
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
  "public/booking/smart-scheduling/offer-revalidation.js"
].forEach(function (rel) { load(rel, windowObj); });

const api = windowObj.ffBookingSmartScheduling;
if (!api || typeof api.revalidateClientVisitOffer !== "function") {
  console.error("Smart Scheduling offer revalidation API did not load.");
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

function svc(lineKey, durationMinutes, eligible, extra) {
  return Object.assign({
    lineKey: lineKey,
    serviceId: "svc-" + lineKey,
    durationMinutes: durationMinutes,
    eligibleProviderIds: eligible,
    assignmentType: "any_provider"
  }, extra || {});
}

function req(requirementKey, eligible, extra) {
  return Object.assign({
    requirementKey: requirementKey,
    eligibleResourceIds: eligible,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0
  }, extra || {});
}

function resAssign(requirementKey, resourceId, start, end, extra) {
  return Object.assign({
    requirementKey: requirementKey,
    resourceId: resourceId,
    resourceType: "pedicure_chair",
    serviceStartMin: start,
    serviceEndMin: end,
    reservationStartMin: start,
    reservationEndMin: end,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0
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
    orderChanged: false,
    orderDistance: 0,
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
  const offers = api.rankClientVisitOffers([], [], {}, { sourcePlans: [plan], maxOffers: 1 });
  return offers[0];
}

const TWO = 14 * 60;
const maria = makeDay({ providerId: "maria" });
const ana = makeDay({ providerId: "ana" });
const chair1 = makeResource({ resourceId: "chair-1" });
const chair2 = makeResource({ resourceId: "chair-2" });
const snapMaria = JSON.stringify(maria);
const snapChair = JSON.stringify(chair1);

check("public revalidation API loaded", !!(
  api.revalidateClientVisitOffer
  && api.revalidateClientVisitOffers
  && api.OFFER_REVALIDATION
  && api.PHASE15_INTERNALS
  && api.PHASE15_INTERNALS.exactSourceSignature
));

const basePlan = fakePlan({ visitStartMin: TWO, totalClientWaitMinutes: 5 });
const offer = offerFrom(basePlan);
const offerSnap = JSON.stringify(offer);
check("Phase 15 offer integrity matches exported exact source signature", !!(offer && offer.offerId === api.PHASE15_INTERNALS.offerIdFromSourceKey(offer.sourcePlanKey)));

// ---------------------------------------------------------------------------
// UNCHANGED SNAPSHOT
// ---------------------------------------------------------------------------

const unchanged = api.revalidateClientVisitOffer([maria, ana], [chair1], offer);
check("unchanged snapshot is still_valid", unchanged && unchanged.status === "still_valid" && unchanged.validNow === true && unchanged.stale === false && unchanged.refreshRequired === false && unchanged.reasonCodes.indexOf("still_valid") !== -1, unchanged);
check("advisory boundary is explicit", unchanged && unchanged.advisoryOnly === true && unchanged.holdsCapacity === false);

// ---------------------------------------------------------------------------
// PROVIDER NOW BUSY / NO SUBSTITUTION
// ---------------------------------------------------------------------------

const mariaBusy = makeDay({
  providerId: "maria",
  lines: [occ(TWO, TWO + 45, { providerId: "maria", appointmentId: "booked-gel", lineId: "booked-gel-line" })]
});
const sara = makeDay({ providerId: "sara" });
const providerBusy = api.revalidateClientVisitOffer([mariaBusy, ana, sara], [chair1], offer);
check("exact provider newly busy makes the offer stale", providerBusy && providerBusy.status === "stale" && providerBusy.validNow === false && providerBusy.refreshRequired === true && providerBusy.reasonCodes.indexOf("provider_now_conflicted") !== -1, providerBusy);
check("other free provider is not substituted", providerBusy && providerBusy.stale === true && providerBusy.lineResults.some(function (row) {
  return row.lineKey === "gel" && row.providerId === "maria" && row.validNow === false && (row.providerConflictIds || []).indexOf("booked-gel") !== -1;
}), providerBusy && providerBusy.lineResults);

// ---------------------------------------------------------------------------
// PROVIDER HOURS CHANGED
// ---------------------------------------------------------------------------

const mariaShort = makeDay({
  providerId: "maria",
  workingIntervals: [{ startMin: 9 * 60, endMin: TWO + 30 }]
});
const hoursChanged = api.revalidateClientVisitOffer([mariaShort, ana], [chair1], offer);
check("provider hours no longer covering the exact line is stale", hoursChanged && hoursChanged.status === "stale" && hoursChanged.reasonCodes.indexOf("provider_schedule_changed") !== -1, hoursChanged);

// ---------------------------------------------------------------------------
// PERMITTED OVERLAP / NEW ILLEGAL OVERLAP / HISTORICAL BASELINE
// ---------------------------------------------------------------------------

const overlapOffer = offerFrom(fakePlan({ visitStartMin: 10 * 60, totalClientWaitMinutes: 0 }));
const mariaOverlapOk = makeDay({
  providerId: "maria",
  allowedOverlapMinutes: 15,
  lines: [occ(10 * 60 + 30, 11 * 60, { providerId: "maria", appointmentId: "tail" })]
});
const overlapOk = api.revalidateClientVisitOffer([mariaOverlapOk, makeDay({ providerId: "ana" })], [chair1], overlapOffer);
check("permitted provider overlap may remain valid", overlapOk && overlapOk.status === "still_valid", overlapOk);

const mariaOverlapBad = makeDay({
  providerId: "maria",
  allowedOverlapMinutes: 0,
  lines: [occ(10 * 60 + 30, 11 * 60, { providerId: "maria", appointmentId: "tail-bad" })]
});
const overlapBad = api.revalidateClientVisitOffer([mariaOverlapBad, makeDay({ providerId: "ana" })], [chair1], overlapOffer);
check("new illegal provider overlap is stale", overlapBad && overlapBad.status === "stale" && overlapBad.reasonCodes.indexOf("provider_now_conflicted") !== -1, overlapBad);

const historical = makeDay({
  providerId: "maria",
  lines: [
    occ(9 * 60, 10 * 60, { providerId: "maria", appointmentId: "hist-a", lineId: "hist-a" }),
    occ(9 * 60 + 45, 10 * 60 + 30, { providerId: "maria", appointmentId: "hist-b", lineId: "hist-b" })
  ]
});
const histCheck = api.revalidateClientVisitOffer([historical, ana], [chair1], offer);
check("unrelated historical provider conflict does not invalidate the exact offer", histCheck && histCheck.status === "still_valid", histCheck);

// ---------------------------------------------------------------------------
// RESOURCE BUSY / NO SUBSTITUTION / HOURS / BUFFER / TOUCHING
// ---------------------------------------------------------------------------

const chair1Busy = makeResource({
  resourceId: "chair-1",
  occupied: [{ occupancyId: "taken-chair", startMin: TWO + 50, endMin: TWO + 95 }]
});
const resBusy = api.revalidateClientVisitOffer([maria, ana], [chair1Busy, chair2], offer);
check("exact chair newly busy makes the offer stale", resBusy && resBusy.status === "stale" && resBusy.reasonCodes.indexOf("resource_now_conflicted") !== -1, resBusy);
check("free Chair 2 is not substituted for the exposed Chair 1 offer", resBusy && resBusy.stale === true && resBusy.resourceResults.some(function (row) {
  return row.resourceId === "chair-1" && row.validNow === false && (row.conflictOccupancyIds || []).indexOf("taken-chair") !== -1;
}), resBusy && resBusy.resourceResults);

const chairHours = makeResource({
  resourceId: "chair-1",
  workingIntervals: [{ startMin: 9 * 60, endMin: TWO + 60 }]
});
const resHours = api.revalidateClientVisitOffer([maria, ana], [chairHours], offer);
check("resource hours no longer covering the reservation are stale", resHours && resHours.status === "stale" && resHours.reasonCodes.indexOf("resource_schedule_changed") !== -1, resHours);

const massagePlan = fakePlan({
  visitStartMin: 10 * 60,
  totalClientWaitMinutes: 0,
  extra: {}
});
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
massagePlan.sumServiceMinutes = 90;
massagePlan.assignmentKey = "massage|maria||next|ana";
massagePlan.resourceAssignmentKey = "massage|room|room-a";
const massageOffer = offerFrom(massagePlan);
const roomBusyBuffer = makeResource({
  resourceId: "room-a",
  resourceType: "massage_room",
  occupied: [{ occupancyId: "cleanup-clash", startMin: 11 * 60 + 5, endMin: 11 * 60 + 35 }]
});
const bufferConflict = api.revalidateClientVisitOffer([maria, ana], [roomBusyBuffer], massageOffer);
check("resource buffer overlap is stale even if client service ended", bufferConflict && bufferConflict.status === "stale" && bufferConflict.reasonCodes.indexOf("resource_now_conflicted") !== -1, bufferConflict);

const roomTouch = makeResource({
  resourceId: "chair-1",
  occupied: [{ occupancyId: "next-guest", startMin: TWO + 95, endMin: TWO + 140 }]
});
const touching = api.revalidateClientVisitOffer([maria, ana], [roomTouch], offer);
check("touching resource intervals remain valid", touching && touching.status === "still_valid", touching);

const missingChair = api.revalidateClientVisitOffer([maria, ana], [chair2], offer);
check("missing exact resource is stale, not substituted", missingChair && missingChair.status === "stale" && missingChair.reasonCodes.indexOf("resource_missing") !== -1, missingChair);

// ---------------------------------------------------------------------------
// EXACT 2:50 / TIMELINE IMMUTABLE
// ---------------------------------------------------------------------------

const waitOffer = offerFrom(fakePlan({ visitStartMin: TWO, totalClientWaitMinutes: 5 }));
check("exact 2:50 wait start revalidates without 15-minute snap", waitOffer && waitOffer.serviceLines[1].startMin === TWO + 50 && api.revalidateClientVisitOffer([maria, ana], [chair1], waitOffer).status === "still_valid");

const chairUntil255 = makeResource({
  resourceId: "chair-1",
  occupied: [{ occupancyId: "until-255", startMin: TWO + 45, endMin: TWO + 55 }]
});
const timelineLocked = api.revalidateClientVisitOffer([maria, ana], [chairUntil255], waitOffer);
check("exact 2:50 offer stays stale even if a later start would fit", timelineLocked && timelineLocked.status === "stale" && waitOffer.serviceLines[1].startMin === TWO + 50, timelineLocked);

// ---------------------------------------------------------------------------
// PARALLEL SAME PROVIDER / SAME RESOURCE
// ---------------------------------------------------------------------------

const parallelSameProv = fakePlan({ visitStartMin: 10 * 60 });
parallelSameProv.serviceLines = [
  { lineKey: "mani", serviceId: "svc-mani", providerId: "maria", startMin: 10 * 60, endMin: 11 * 60, durationMinutes: 60, blockIndex: 0, resourceAssignments: [resAssign("chair", "chair-1", 10 * 60, 11 * 60)] },
  { lineKey: "pedi", serviceId: "svc-pedi", providerId: "maria", startMin: 10 * 60, endMin: 11 * 60, durationMinutes: 60, blockIndex: 0, resourceAssignments: [resAssign("chair", "chair-2", 10 * 60, 11 * 60)] }
];
parallelSameProv.blocks = [{
  blockIndex: 0, sourceBlockIndex: 0, startMin: 10 * 60, endMin: 11 * 60, waitBeforeMinutes: 0, parallel: true, lineKeys: ["mani", "pedi"], durationMinutes: 60
}];
parallelSameProv.visitEndMin = 11 * 60;
parallelSameProv.visitElapsedMinutes = 60;
parallelSameProv.assignmentKey = "mani|maria||pedi|maria";
parallelSameProv.resourceAssignmentKey = "mani|chair|chair-1||pedi|chair|chair-2";
const parallelProvOffer = offerFrom(parallelSameProv);
const parallelProv = api.revalidateClientVisitOffer([maria, ana], [chair1, chair2], parallelProvOffer);
check("same provider on two simultaneous lines is stale", parallelProv && (parallelProv.status === "stale" || parallelProv.status === "invalid_offer") && parallelProv.reasonCodes.indexOf("same_visit_provider_conflict") !== -1, parallelProv);

const parallelSameRes = fakePlan({ visitStartMin: 10 * 60 });
parallelSameRes.serviceLines = [
  { lineKey: "mani", serviceId: "svc-mani", providerId: "maria", startMin: 10 * 60, endMin: 11 * 60, durationMinutes: 60, blockIndex: 0, resourceAssignments: [resAssign("chair", "chair-1", 10 * 60, 11 * 60)] },
  { lineKey: "pedi", serviceId: "svc-pedi", providerId: "ana", startMin: 10 * 60, endMin: 11 * 60, durationMinutes: 60, blockIndex: 0, resourceAssignments: [resAssign("chair", "chair-1", 10 * 60, 11 * 60)] }
];
parallelSameRes.blocks = [{
  blockIndex: 0, sourceBlockIndex: 0, startMin: 10 * 60, endMin: 11 * 60, waitBeforeMinutes: 0, parallel: true, lineKeys: ["mani", "pedi"], durationMinutes: 60
}];
parallelSameRes.visitEndMin = 11 * 60;
parallelSameRes.visitElapsedMinutes = 60;
parallelSameRes.assignmentKey = "mani|maria||pedi|ana";
parallelSameRes.resourceAssignmentKey = "mani|chair|chair-1||pedi|chair|chair-1";
const parallelResOffer = offerFrom(parallelSameRes);
const parallelRes = api.revalidateClientVisitOffer([maria, ana], [chair1, chair2], parallelResOffer);
check("same physical resource on two simultaneous lines is stale", parallelRes && (parallelRes.status === "stale" || parallelRes.status === "invalid_offer") && parallelRes.reasonCodes.indexOf("same_visit_resource_conflict") !== -1, parallelRes);

check("each service line remains one uninterrupted provider interval", (offer.serviceLines || []).every(function (line) {
  return typeof line.providerId === "string" && line.endMin === line.startMin + line.durationMinutes;
}));

// ---------------------------------------------------------------------------
// INTEGRITY / BATCH / PROVIDER-ONLY / NO RESOURCE
// ---------------------------------------------------------------------------

const tampered = JSON.parse(JSON.stringify(offer));
tampered.serviceLines[0].providerId = "sara";
const integrity = api.revalidateClientVisitOffer([maria, ana, sara], [chair1], tampered);
check("tampered provider without signature update is invalid_offer", integrity && integrity.status === "invalid_offer" && integrity.reasonCodes.indexOf("offer_integrity_mismatch") !== -1, integrity);

const offerB = offerFrom(fakePlan({ visitStartMin: 16 * 60, totalClientWaitMinutes: 0, flexibleVisitPlanScore: 88 }));
const offerC = offerFrom(fakePlan({ visitStartMin: TWO + 15, totalClientWaitMinutes: 0, flexibleVisitPlanScore: 70, gelProvider: "maria" }));
const batch = api.revalidateClientVisitOffers(
  [mariaBusy, ana, sara],
  [chair1],
  [offer, offerB, offerC]
);
check("batch preserves input order and does not rerank", batch.length === 3
  && batch[0].status === "stale"
  && batch[0].offerId === offer.offerId
  && batch[1].status === "still_valid"
  && batch[1].offerId === offerB.offerId
  && batch[2].status === "stale"
  && batch[2].offerId === offerC.offerId, batch.map(function (row) { return { id: row.offerId, status: row.status }; }));
check("batch does not rewrite Phase 15 diversity roles", !batch.some(function (row) { return row.diversityType || row.primaryRole; }));

const mariaOffer = offerFrom(fakePlan({ visitStartMin: TWO, totalClientWaitMinutes: 0, gelProvider: "maria", chairId: "chair-1" }));
const saraOffer = offerFrom(fakePlan({ visitStartMin: TWO, totalClientWaitMinutes: 0, gelProvider: "sara", chairId: "chair-1" }));
const onlyMariaBusy = api.revalidateClientVisitOffers([mariaBusy, ana, sara], [chair1], [mariaOffer, saraOffer]);
check("provider-only offers revalidate independently", onlyMariaBusy[0].status === "stale" && onlyMariaBusy[1].status === "still_valid", onlyMariaBusy.map(function (row) { return row.status; }));

const noResPlan = fakePlan({ visitStartMin: 10 * 60, totalClientWaitMinutes: 0 });
noResPlan.serviceLines[1].resourceAssignments = [];
noResPlan.resourceAssignmentKey = "";
const noResOffer = offerFrom(noResPlan);
const noRes = api.revalidateClientVisitOffer([maria, ana], [], noResOffer);
check("provider-only offer revalidates with empty resourceDays", noRes && noRes.status === "still_valid" && noRes.resourceResults.length === 0, noRes);

check("resource-dedupe consequence: Chair 1 offer is stale while Chair 2 is free", resBusy.status === "stale" && chair2.occupied.length === 0);

const missingProv = api.revalidateClientVisitOffer([ana], [chair1], offer);
check("missing exact provider is stale, not substituted", missingProv && missingProv.status === "stale" && missingProv.reasonCodes.indexOf("provider_missing") !== -1, missingProv);

// ---------------------------------------------------------------------------
// MIXED SNAPSHOT / IMMUTABILITY / PURITY
// ---------------------------------------------------------------------------

const dateOffer = offerFrom(fakePlan({ dateKey: "2026-09-15", locationId: "locA" }));
const locOffer = offerFrom(fakePlan({ dateKey: "2026-09-14", locationId: "locB" }));
check("different dateKey yields a different sourcePlanKey and offerId", offer.sourcePlanKey !== dateOffer.sourcePlanKey && offer.offerId !== dateOffer.offerId && dateOffer.dateKey === "2026-09-15");
check("different locationId yields a different sourcePlanKey and offerId", offer.sourcePlanKey !== locOffer.sourcePlanKey && offer.offerId !== locOffer.offerId && locOffer.locationId === "locB");
check("same context + same plan yields the same sourcePlanKey/offerId", offer.offerId === offerFrom(fakePlan({ visitStartMin: TWO, totalClientWaitMinutes: 5 })).offerId);

const missingDate = JSON.parse(JSON.stringify(offer));
missingDate.dateKey = "";
const missingDateResult = api.revalidateClientVisitOffer([maria, ana], [chair1], missingDate);
check("missing offer dateKey is invalid_offer", missingDateResult && missingDateResult.status === "invalid_offer" && missingDateResult.reasonCodes.indexOf("offer_integrity_mismatch") !== -1, missingDateResult);

const missingLoc = JSON.parse(JSON.stringify(offer));
missingLoc.locationId = "";
const missingLocResult = api.revalidateClientVisitOffer([maria, ana], [chair1], missingLoc);
check("missing offer locationId is invalid_offer", missingLocResult && missingLocResult.status === "invalid_offer" && missingLocResult.reasonCodes.indexOf("offer_integrity_mismatch") !== -1, missingLocResult);

const wrongDateDays = [makeDay({ providerId: "maria", dateKey: "2026-09-15" }), makeDay({ providerId: "ana", dateKey: "2026-09-15" })];
const wrongDateRes = [makeResource({ resourceId: "chair-1", dateKey: "2026-09-15" })];
const wrongDate = api.revalidateClientVisitOffer(wrongDateDays, wrongDateRes, offer);
check("wrong current date is snapshot_context_mismatch", wrongDate && wrongDate.status === "invalid_offer" && wrongDate.reasonCodes.indexOf("snapshot_context_mismatch") !== -1, wrongDate);

const wrongLocDays = [makeDay({ providerId: "maria", locationId: "locB" }), makeDay({ providerId: "ana", locationId: "locB" })];
const wrongLocRes = [makeResource({ resourceId: "chair-1", locationId: "locB" })];
const wrongLoc = api.revalidateClientVisitOffer(wrongLocDays, wrongLocRes, offer);
check("wrong current location is snapshot_context_mismatch", wrongLoc && wrongLoc.status === "invalid_offer" && wrongLoc.reasonCodes.indexOf("snapshot_context_mismatch") !== -1, wrongLoc);

const dupProv = api.revalidateClientVisitOffer([maria, makeDay({ providerId: "maria" }), ana], [chair1], offer);
check("duplicate providerId in snapshot is invalid", dupProv && dupProv.status === "invalid_offer" && dupProv.reasonCodes.indexOf("snapshot_context_mismatch") !== -1, dupProv);

const dupRes = api.revalidateClientVisitOffer([maria, ana], [chair1, makeResource({ resourceId: "chair-1" })], offer);
check("duplicate resourceId in snapshot is invalid", dupRes && dupRes.status === "invalid_offer" && dupRes.reasonCodes.indexOf("snapshot_context_mismatch") !== -1, dupRes);

const mixedBatch = api.revalidateClientVisitOffers(
  [maria, ana],
  [chair1],
  [offer, dateOffer, offerB]
);
check("batch mixed offer context validates independently", mixedBatch.length === 3
  && mixedBatch[0].status === "still_valid"
  && mixedBatch[0].offerId === offer.offerId
  && mixedBatch[1].status === "invalid_offer"
  && mixedBatch[1].reasonCodes.indexOf("snapshot_context_mismatch") !== -1
  && mixedBatch[2].status === "still_valid"
  && mixedBatch[2].offerId === offerB.offerId, mixedBatch.map(function (row) { return { status: row.status, reasons: row.reasonCodes }; }));

const mixed = api.revalidateClientVisitOffer(
  [maria, makeDay({ providerId: "ana", dateKey: "2026-09-15" })],
  [chair1],
  offer
);
check("mixed current date/location is invalid snapshot context", mixed && mixed.status === "invalid_offer" && mixed.reasonCodes.indexOf("snapshot_context_mismatch") !== -1, mixed);

check("providerDays are unchanged", JSON.stringify(maria) === snapMaria);
check("resourceDays are unchanged", JSON.stringify(chair1) === snapChair);
check("offer is unchanged", JSON.stringify(offer) === offerSnap);
check("same snapshot + offer is deterministic", JSON.stringify(unchanged) === JSON.stringify(api.revalidateClientVisitOffer([maria, ana], [chair1], offer)));

const src = fs.readFileSync(path.join(root, "public/booking/smart-scheduling/offer-revalidation.js"), "utf8");
check("purity: no Firebase APIs", !/firebase-firestore|getDocs\s*\(|onSnapshot\s*\(|updateDoc\s*\(|addDoc\s*\(/.test(src));
check("purity: no network", !/\bfetch\s*\(|XMLHttpRequest/.test(src));
check("purity: no writes / timers / Date", !/\bsetTimeout\b|\bsetInterval\b|\bDate\s*\(|Date\.now|createAppointment|updateAppointment|cancelAppointment/.test(src));
check("purity: no DOM / Calendar / Reports", !/\bdocument\b|\blocalStorage\b|ffBookingCal|ffBookingReports/.test(src));
check("purity: no messaging / booking / holds", !/sendSms|sendEmail|twilio|mailer|bookClient|autoBook|holdSlot|reserveChair/i.test(src));
check("does not call Phase 14 to replace the offer", !/rankFlexibleVisitPlans|recommendFlexibleVisit/.test(src));
check("does not rewrite Phase 15 selector", !/function rankClientVisitOffers/.test(src));

if (failed) {
  console.log("\n" + failed + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll offer revalidation checks passed.");
