/**
 * Smart Scheduling Phase 6 waitlist matching. No Firestore, DOM, Calendar, or Reports.
 * Usage: node scripts/test-booking-smart-scheduling-waitlist.js
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
  "public/booking/smart-scheduling/waitlist.js"
].forEach(function (rel) { load(rel, windowObj); });

const api = windowObj.ffBookingSmartScheduling;
if (!api || typeof api.rankWaitlistMatches !== "function") {
  console.error("Smart Scheduling waitlist API did not load.");
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

function clamp(value, lo, hi) {
  var n = Math.round(Number(value));
  if (!Number.isFinite(n)) n = 0;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function openingFitBonus(outcome) {
  if (outcome === "exact_fill") return 15;
  if (outcome === "usable_remainder") return 8;
  if (outcome === "stranded_remainder") return -10;
  return 0;
}

function expectedMatchScore(row) {
  var raw = Number(row.slotScore) || 0;
  raw += clamp(row.optimizationDelta, -15, 15);
  raw -= clamp(Math.max(0, row.fragmentationDelta), 0, 15);
  raw += clamp(Math.max(0, -row.fragmentationDelta), 0, 10);
  raw -= clamp(Math.max(0, row.strandedBetweenMinutesDelta), 0, 15);
  raw += openingFitBonus(row.openingFit);
  raw += Number(row.timePreferenceBonus) || 0;
  return clamp(raw, 0, 100);
}

function line(startMin, endMin, extra) {
  return Object.assign({
    lineId: "l-" + startMin + "-" + endMin,
    appointmentId: "a-" + startMin,
    providerId: "provA",
    startMin: startMin,
    endMin: endMin,
    status: "scheduled"
  }, extra || {});
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

function hasReason(row, code) {
  return (row && row.reasons || []).some(function (item) { return item.code === code; });
}

function ids(rows) {
  return (rows || []).map(function (row) { return row.waitlistId; });
}

function req(partial) {
  return Object.assign({
    waitlistId: "wl-default",
    clientId: "client-1",
    durationMinutes: 60,
    assignmentType: "any_provider",
    createdAtOrder: 1
  }, partial || {});
}

const opening60 = { startMin: 10 * 60, endMin: 11 * 60 };
const packedDay = makeDay({
  lines: [
    line(9 * 60, 10 * 60),
    line(11 * 60, 12 * 60)
  ]
});
const emptyDay = makeDay();

check("public waitlist API loaded", !!(
  api.rankWaitlistMatches
  && api.rankWaitlistMatchCandidates
  && api.recommendWaitlistMatch
));

// ---------------------------------------------------------------------------
// HARD ELIGIBILITY
// ---------------------------------------------------------------------------

check(
  "service too long for opening is omitted",
  api.rankWaitlistMatches(packedDay, opening60, [req({ waitlistId: "too-long", durationMinutes: 90 })]).length === 0
);

check(
  "duration <= 0 is omitted",
  api.rankWaitlistMatches(packedDay, opening60, [req({ waitlistId: "zero", durationMinutes: 0 })]).length === 0
);

check(
  "missing waitlistId is omitted",
  api.rankWaitlistMatches(packedDay, opening60, [{
    clientId: "client-1",
    durationMinutes: 60,
    assignmentType: "any_provider"
  }]).length === 0
);
check(
  "null waitlistId is omitted",
  api.rankWaitlistMatches(packedDay, opening60, [req({ waitlistId: null })]).length === 0
);
check(
  "empty waitlistId is omitted",
  api.rankWaitlistMatches(packedDay, opening60, [req({ waitlistId: "" })]).length === 0
);
check(
  "whitespace-only waitlistId is omitted",
  api.rankWaitlistMatches(packedDay, opening60, [req({ waitlistId: "   " })]).length === 0
);

const twoDistinct = api.rankWaitlistMatches(packedDay, opening60, [
  req({ waitlistId: "  wl-one  ", durationMinutes: 60, createdAtOrder: 1 }),
  req({ waitlistId: "wl-two", durationMinutes: 60, createdAtOrder: 2 })
]);
check(
  "two different valid waitlistIds never collapse",
  twoDistinct.length === 2 && twoDistinct.some(function (row) { return row.waitlistId === "wl-one"; })
    && twoDistinct.some(function (row) { return row.waitlistId === "wl-two"; }),
  ids(twoDistinct)
);
check("valid waitlistId is normalized to a trimmed string", twoDistinct.some(function (row) { return row.waitlistId === "wl-one"; }));

check(
  "wrong specific provider is omitted",
  api.rankWaitlistMatches(packedDay, opening60, [req({
    waitlistId: "wrong-prov",
    assignmentType: "specific_provider",
    requestedProviderId: "provB"
  })]).length === 0
);

const sameProvider = api.rankWaitlistMatches(packedDay, opening60, [req({
  waitlistId: "same-prov",
  assignmentType: "specific_provider",
  requestedProviderId: "provA"
})]);
check("same specific provider is allowed", sameProvider.length === 1 && sameProvider[0].waitlistId === "same-prov", ids(sameProvider));

check(
  "specific_provider without requestedProviderId is omitted",
  api.rankWaitlistMatches(packedDay, opening60, [req({
    waitlistId: "missing-prov",
    assignmentType: "specific_provider"
  })]).length === 0
);

const constrained = api.rankWaitlistMatches(packedDay, { startMin: 10 * 60, endMin: 12 * 60 }, [req({
  waitlistId: "windowed",
  durationMinutes: 30,
  earliestStartMin: 10 * 60 + 30,
  latestStartMin: 10 * 60 + 30
})]);
check(
  "earliest/latest constraints keep only allowed starts",
  constrained.length === 1 && constrained[0].candidateStartMin === 10 * 60 + 30,
  constrained[0]
);

check(
  "start before earliestStartMin is omitted",
  api.rankWaitlistMatches(packedDay, opening60, [req({
    waitlistId: "too-early",
    durationMinutes: 30,
    earliestStartMin: 10 * 60 + 45
  })]).length === 0
);

check(
  "any_provider does not require requestedProviderId",
  api.rankWaitlistMatches(packedDay, opening60, [req({
    waitlistId: "any",
    assignmentType: "any_provider",
    requestedProviderId: "provB"
  })]).length === 1
);

check(
  "no technically valid slot is omitted",
  api.rankWaitlistMatches(packedDay, { startMin: 9 * 60, endMin: 10 * 60 }, [req({
    waitlistId: "busy-window",
    durationMinutes: 30
  })]).length === 0
);

// ---------------------------------------------------------------------------
// PREFERRED TIME
// ---------------------------------------------------------------------------

const preferredExact = api.rankWaitlistMatches(packedDay, opening60, [req({
  waitlistId: "pref-exact",
  durationMinutes: 30,
  preferredStartMin: 10 * 60,
  flexibilityMinutes: 30
})]);
check(
  "exact preferred start is selected as the one best placement",
  preferredExact.length === 1 && preferredExact[0].candidateStartMin === 10 * 60 && preferredExact[0].timePreferenceBonus === 10,
  preferredExact[0]
);
check("matches_preferred_time reason", hasReason(preferredExact[0], "matches_preferred_time"));

const nearbyCandidates = api.rankWaitlistMatchCandidates(packedDay, opening60, [req({
  waitlistId: "pref-near",
  durationMinutes: 30,
  preferredStartMin: 10 * 60,
  flexibilityMinutes: 30
})]);
const exactCand = nearbyCandidates.find(function (row) { return row.candidateStartMin === 10 * 60; });
const near15 = nearbyCandidates.find(function (row) { return row.candidateStartMin === 10 * 60 + 15; });
check("15-minute nearby candidate exists when flexibility allows it", !!(exactCand && near15));
check(
  "15-minute nearby scores lower than exact preferred",
  exactCand && near15 && exactCand.waitlistMatchScore > near15.waitlistMatchScore
    && exactCand.timePreferenceBonus === 10
    && near15.timePreferenceBonus === 7,
  { exact: exactCand && exactCand.waitlistMatchScore, near: near15 && near15.waitlistMatchScore }
);
check("near_preferred_time reason on nearby start", hasReason(near15, "near_preferred_time"));

check(
  "beyond flexibility is omitted",
  api.rankWaitlistMatchCandidates(packedDay, opening60, [req({
    waitlistId: "beyond",
    durationMinutes: 30,
    preferredStartMin: 10 * 60,
    flexibilityMinutes: 15
  })]).every(function (row) { return row.candidateStartMin <= 10 * 60 + 15; })
    && api.rankWaitlistMatchCandidates(packedDay, opening60, [req({
      waitlistId: "beyond",
      durationMinutes: 30,
      preferredStartMin: 10 * 60,
      flexibilityMinutes: 15
    })]).some(function (row) { return row.candidateStartMin === 10 * 60 + 15; })
    && api.rankWaitlistMatchCandidates(packedDay, opening60, [req({
      waitlistId: "beyond",
      durationMinutes: 30,
      preferredStartMin: 10 * 60,
      flexibilityMinutes: 15
    })]).every(function (row) { return row.candidateStartMin !== 10 * 60 + 30; })
);

check(
  "absent flexibility defaults to exact preferred time only",
  api.rankWaitlistMatchCandidates(packedDay, opening60, [req({
    waitlistId: "exact-default",
    durationMinutes: 30,
    preferredStartMin: 10 * 60
  })]).every(function (row) { return row.candidateStartMin === 10 * 60; })
    && api.rankWaitlistMatchCandidates(packedDay, opening60, [req({
      waitlistId: "exact-default",
      durationMinutes: 30,
      preferredStartMin: 10 * 60
    })]).length === 1
);

check(
  "flexibility 0 is exact preferred only",
  api.rankWaitlistMatchCandidates(packedDay, opening60, [req({
    waitlistId: "flex-0",
    durationMinutes: 30,
    preferredStartMin: 10 * 60,
    flexibilityMinutes: 0
  })]).length === 1
    && api.rankWaitlistMatchCandidates(packedDay, opening60, [req({
      waitlistId: "flex-0",
      durationMinutes: 30,
      preferredStartMin: 10 * 60,
      flexibilityMinutes: 0
    })]).every(function (row) { return row.candidateStartMin === 10 * 60; })
);

const noPreferred = api.rankWaitlistMatches(packedDay, opening60, [req({
  waitlistId: "no-pref",
  durationMinutes: 30
})]);
check(
  "no preferred start works and scores time bonus 0",
  noPreferred.length === 1 && noPreferred[0].timePreferenceBonus === 0 && noPreferred[0].timeDistanceMinutes === 0,
  noPreferred[0]
);

// ---------------------------------------------------------------------------
// OPENING FIT
// ---------------------------------------------------------------------------

const exactFill = api.rankWaitlistMatches(packedDay, opening60, [req({
  waitlistId: "fill-60",
  durationMinutes: 60
})])[0];
check("60-minute request is exact_fill", exactFill && exactFill.openingFit === "exact_fill", exactFill);
check("exact fill uses the whole opening", exactFill && exactFill.openingMinutes === 60 && exactFill.openingUsedMinutes === 60 && exactFill.openingFillPercent === 100 && exactFill.leftoverBeforeMinutes === 0 && exactFill.leftoverAfterMinutes === 0);
check("exact_opening_fill reason", hasReason(exactFill, "exact_opening_fill"));
check("exact fill does not also claim usable remainder", !hasReason(exactFill, "usable_opening_remainder"));

const usable30 = api.rankWaitlistMatches(packedDay, opening60, [req({
  waitlistId: "edge-30",
  durationMinutes: 30
})])[0];
check("30-minute edge placement is usable_remainder", usable30 && usable30.openingFit === "usable_remainder", usable30);
check(
  "usable 30-minute remainder sits on an edge",
  usable30 && ((usable30.leftoverBeforeMinutes === 0 && usable30.leftoverAfterMinutes === 30)
    || (usable30.leftoverBeforeMinutes === 30 && usable30.leftoverAfterMinutes === 0)),
  usable30
);
check("usable remainder fill percent is 50", usable30 && usable30.openingFillPercent === 50);
check("usable_opening_remainder reason", hasReason(usable30, "usable_opening_remainder"));
check("usable remainder is not stranded", usable30 && usable30.createsStrandedOpeningRemainder === false);

const stranded45 = api.rankWaitlistMatches(packedDay, opening60, [req({
  waitlistId: "mid-45",
  durationMinutes: 45
})])[0];
check("45-minute request is stranded_remainder", stranded45 && stranded45.openingFit === "stranded_remainder", stranded45);
check(
  "45-minute request leaves a 15-minute stranded remainder",
  stranded45 && stranded45.createsStrandedOpeningRemainder === true
    && stranded45.strandedOpeningRemainderMinutes === 15
    && stranded45.openingFillPercent === 75,
  stranded45
);
check("creates_stranded_opening_remainder reason", hasReason(stranded45, "creates_stranded_opening_remainder"));

const fitRank = api.rankWaitlistMatches(packedDay, opening60, [
  req({ waitlistId: "stranded-older", durationMinutes: 45, createdAtOrder: 1 }),
  req({ waitlistId: "exact-newer", durationMinutes: 60, createdAtOrder: 99 })
]);
check(
  "exact fill outranks stranded remainder",
  fitRank[0] && fitRank[0].waitlistId === "exact-newer" && fitRank[0].openingFit === "exact_fill"
    && fitRank[1] && fitRank[1].waitlistId === "stranded-older",
  ids(fitRank)
);

// ---------------------------------------------------------------------------
// SIMULATION
// ---------------------------------------------------------------------------

const snapshot = JSON.stringify(packedDay);
const before = api.analyzeProviderDay(packedDay);
const simulatedMatch = api.rankWaitlistMatches(packedDay, opening60, [req({
  waitlistId: "sim-60",
  durationMinutes: 60
})])[0];
const afterOriginal = api.analyzeProviderDay(packedDay);

check("original ProviderDay object is not mutated", JSON.stringify(packedDay) === snapshot);
check("before metrics are unchanged after ranking", before.optimizationScore === afterOriginal.optimizationScore && before.occupiedMinutes === afterOriginal.occupiedMinutes);
check("simulation exposes before/after optimization", simulatedMatch && simulatedMatch.optimizationAfter !== simulatedMatch.optimizationBefore);
check("optimizationDelta matches after − before", simulatedMatch && simulatedMatch.optimizationDelta === simulatedMatch.optimizationAfter - simulatedMatch.optimizationBefore);
check("fragmentationDelta matches after − before", simulatedMatch && simulatedMatch.fragmentationDelta === simulatedMatch.fragmentationAfter - simulatedMatch.fragmentationBefore);
check(
  "strandedBetween delta matches after − before",
  simulatedMatch && simulatedMatch.strandedBetweenMinutesDelta === simulatedMatch.strandedBetweenGapMinutesAfter - simulatedMatch.strandedBetweenGapMinutesBefore
);

const cleanVsFrag = api.rankWaitlistMatchCandidates(packedDay, opening60, [req({
  waitlistId: "place-30",
  durationMinutes: 30
})]);
const cleanEdge = cleanVsFrag.find(function (row) { return row.candidateStartMin === 10 * 60; });
const fragMiddle = cleanVsFrag.find(function (row) { return row.candidateStartMin === 10 * 60 + 15; });
check("clean edge and fragmenting middle placements both exist", !!(cleanEdge && fragMiddle));
check(
  "clean placement wins over fragmenting placement",
  cleanEdge && fragMiddle && cleanEdge.waitlistMatchScore > fragMiddle.waitlistMatchScore
    && cleanEdge.openingFit === "usable_remainder"
    && fragMiddle.openingFit === "stranded_remainder",
  {
    clean: cleanEdge && { score: cleanEdge.waitlistMatchScore, fit: cleanEdge.openingFit, frag: cleanEdge.fragmentationAfter },
    frag: fragMiddle && { score: fragMiddle.waitlistMatchScore, fit: fragMiddle.openingFit, frag: fragMiddle.fragmentationAfter }
  }
);

check(
  "waitlistMatchScore follows the published formula",
  simulatedMatch && simulatedMatch.waitlistMatchScore === expectedMatchScore(simulatedMatch),
  { got: simulatedMatch && simulatedMatch.waitlistMatchScore, expected: simulatedMatch && expectedMatchScore(simulatedMatch) }
);

// ---------------------------------------------------------------------------
// OVERLAP
// ---------------------------------------------------------------------------

const overlapDay = makeDay({
  allowedOverlapMinutes: 15,
  lines: [line(12 * 60, 13 * 60)]
});
const overlapOpening = { startMin: 12 * 60 + 45, endMin: 13 * 60 + 30 };
const overlapCands = api.rankWaitlistMatchCandidates(overlapDay, overlapOpening, [req({
  waitlistId: "overlap-30",
  durationMinutes: 30
})]);
const overlapSlot = overlapCands.find(function (row) { return row.candidateStartMin === 12 * 60 + 45; });
const freeSlot = overlapCands.find(function (row) { return row.candidateStartMin === 13 * 60; });
check("allowed overlap remains technically possible", !!(overlapSlot && overlapSlot.usesOverlap === true), overlapSlot);
check("true-free placement in the same opening is also possible", !!(freeSlot && freeSlot.usesOverlap === false), freeSlot);
check(
  "true-free match wins equivalent overlap match",
  freeSlot && overlapSlot && freeSlot.waitlistMatchScore > overlapSlot.waitlistMatchScore,
  { free: freeSlot && freeSlot.waitlistMatchScore, overlap: overlapSlot && overlapSlot.waitlistMatchScore }
);
check(
  "no second overlap penalty",
  overlapSlot && overlapSlot.waitlistMatchScore === expectedMatchScore(overlapSlot) && hasReason(overlapSlot, "uses_permitted_overlap"),
  { got: overlapSlot && overlapSlot.waitlistMatchScore, expected: overlapSlot && expectedMatchScore(overlapSlot) }
);
check(
  "overlap reason delta is 0",
  overlapSlot && (overlapSlot.reasons.find(function (item) { return item.code === "uses_permitted_overlap"; }) || {}).delta === 0
);

// ---------------------------------------------------------------------------
// ONE BEST PER REQUEST
// ---------------------------------------------------------------------------

const manyStarts = api.rankWaitlistMatchCandidates(packedDay, opening60, [req({
  waitlistId: "many-starts",
  durationMinutes: 30
})]);
const oneBest = api.rankWaitlistMatches(packedDay, opening60, [req({
  waitlistId: "many-starts",
  durationMinutes: 30
})]);
check("several valid starts exist for one request", manyStarts.length > 1, manyStarts.length);
check("main API returns one placement per waitlist request", oneBest.length === 1 && oneBest[0].waitlistId === "many-starts");
check(
  "kept placement is the globally best candidate for that request",
  oneBest[0] && manyStarts[0] && oneBest[0].candidateStartMin === manyStarts[0].candidateStartMin
    && oneBest[0].waitlistMatchScore === manyStarts[0].waitlistMatchScore
);

// ---------------------------------------------------------------------------
// MULTIPLE REQUESTS / AGE IS A LATE TIE-BREAK
// ---------------------------------------------------------------------------

const superiorVsOlder = api.rankWaitlistMatches(packedDay, opening60, [
  req({ waitlistId: "older-stranded", clientId: "c-old", durationMinutes: 45, createdAtOrder: 1 }),
  req({ waitlistId: "newer-exact", clientId: "c-new", durationMinutes: 60, createdAtOrder: 50 })
]);
check(
  "operationally superior request outranks worse fit",
  superiorVsOlder[0] && superiorVsOlder[0].waitlistId === "newer-exact",
  ids(superiorVsOlder)
);
check(
  "older request does not override clearly superior calendar fit",
  superiorVsOlder[0] && superiorVsOlder[0].createdAtOrder === 50 && superiorVsOlder[1].createdAtOrder === 1
);

const ageTie = api.rankWaitlistMatches(packedDay, opening60, [
  req({ waitlistId: "zlater", durationMinutes: 60, createdAtOrder: 20 }),
  req({ waitlistId: "aolder", durationMinutes: 60, createdAtOrder: 2 })
]);
check(
  "age only breaks late ties",
  ageTie.length === 2
    && ageTie[0].waitlistMatchScore === ageTie[1].waitlistMatchScore
    && ageTie[0].createdAtOrder === 2
    && ageTie[0].waitlistId === "aolder",
  ids(ageTie).concat([ageTie[0] && ageTie[0].waitlistMatchScore, ageTie[1] && ageTie[1].waitlistMatchScore])
);

const idTie = api.rankWaitlistMatches(packedDay, opening60, [
  req({ waitlistId: "wl-b", durationMinutes: 60, createdAtOrder: 7 }),
  req({ waitlistId: "wl-a", durationMinutes: 60, createdAtOrder: 7 })
]);
check(
  "waitlistId is the last stable tie-break",
  idTie[0] && idTie[0].waitlistId === "wl-a" && idTie[1].waitlistId === "wl-b",
  ids(idTie)
);

const missingVsSupplied = api.rankWaitlistMatches(packedDay, opening60, [
  req({ waitlistId: "missing-age", durationMinutes: 60, createdAtOrder: null }),
  req({ waitlistId: "has-age", durationMinutes: 60, createdAtOrder: 99 })
]);
check(
  "missing createdAtOrder does not beat a supplied value",
  missingVsSupplied.length === 2
    && missingVsSupplied[0].waitlistId === "has-age"
    && missingVsSupplied[1].waitlistId === "missing-age"
    && missingVsSupplied[0].createdAtOrder === 99
    && missingVsSupplied[1].createdAtOrder == null,
  ids(missingVsSupplied)
);

const bothMissingAge = api.rankWaitlistMatches(packedDay, opening60, [
  req({ waitlistId: "wl-z", durationMinutes: 60, createdAtOrder: null }),
  req({ waitlistId: "wl-m", durationMinutes: 60, createdAtOrder: undefined })
]);
check(
  "two missing createdAtOrder values fall through to waitlistId",
  bothMissingAge.length === 2
    && bothMissingAge[0].waitlistId === "wl-m"
    && bothMissingAge[1].waitlistId === "wl-z"
    && bothMissingAge[0].createdAtOrder == null
    && bothMissingAge[1].createdAtOrder == null,
  ids(bothMissingAge)
);

const scoredWithAge = api.rankWaitlistMatches(packedDay, opening60, [req({
  waitlistId: "score-age",
  durationMinutes: 60,
  createdAtOrder: 1
})])[0];
const scoredWithoutAge = api.rankWaitlistMatches(packedDay, opening60, [req({
  waitlistId: "score-age",
  durationMinutes: 60,
  createdAtOrder: null
})])[0];
check(
  "createdAtOrder never changes waitlistMatchScore",
  scoredWithAge && scoredWithoutAge
    && scoredWithAge.waitlistMatchScore === scoredWithoutAge.waitlistMatchScore
    && scoredWithAge.waitlistMatchScore === expectedMatchScore(scoredWithAge),
  { withAge: scoredWithAge && scoredWithAge.waitlistMatchScore, withoutAge: scoredWithoutAge && scoredWithoutAge.waitlistMatchScore }
);

// ---------------------------------------------------------------------------
// SPECIFIC PROVIDER — no cross-provider fallback
// ---------------------------------------------------------------------------

check(
  "specific_provider never falls back to another provider",
  api.rankWaitlistMatches(packedDay, opening60, [req({
    waitlistId: "other-shop",
    assignmentType: "specific_provider",
    requestedProviderId: "provZ"
  })]).length === 0
);

// ---------------------------------------------------------------------------
// PRIMARY RECOMMENDATION
// ---------------------------------------------------------------------------

const rec = api.recommendWaitlistMatch(packedDay, opening60, [
  req({ waitlistId: "rec-60", durationMinutes: 60 })
]);
check("recommendWaitlistMatch returns the best qualifying match", rec && rec.waitlistId === "rec-60" && rec.waitlistMatchScore >= 50, rec);
check(
  "default minimumWaitlistMatchScore is 50",
  api.WAITLIST && api.WAITLIST.DEFAULT_MIN_MATCH === 50
);
check(
  "configurable minimumWaitlistMatchScore can reject an otherwise valid match",
  api.recommendWaitlistMatch(packedDay, opening60, [req({ waitlistId: "high-bar", durationMinutes: 60 })], {
    minimumWaitlistMatchScore: 101
  }) === null
);

const overlapOnlyRec = api.recommendWaitlistMatch(overlapDay, { startMin: 12 * 60 + 45, endMin: 13 * 60 + 15 }, [req({
  waitlistId: "overlap-only",
  durationMinutes: 30
})], { minimumWaitlistMatchScore: 50 });
check(
  "low-scoring overlap-only match can fall below the default minimum",
  overlapOnlyRec === null || overlapOnlyRec.waitlistMatchScore >= 50
);

// ---------------------------------------------------------------------------
// DETERMINISM
// ---------------------------------------------------------------------------

const shuffledA = api.rankWaitlistMatches(packedDay, opening60, [
  req({ waitlistId: "wl-c", durationMinutes: 45, createdAtOrder: 3 }),
  req({ waitlistId: "wl-a", durationMinutes: 60, createdAtOrder: 1 }),
  req({ waitlistId: "wl-b", durationMinutes: 30, createdAtOrder: 2 })
]);
const shuffledB = api.rankWaitlistMatches(packedDay, opening60, [
  req({ waitlistId: "wl-b", durationMinutes: 30, createdAtOrder: 2 }),
  req({ waitlistId: "wl-c", durationMinutes: 45, createdAtOrder: 3 }),
  req({ waitlistId: "wl-a", durationMinutes: 60, createdAtOrder: 1 })
]);
check("same input yields the same output", JSON.stringify(shuffledA) === JSON.stringify(api.rankWaitlistMatches(packedDay, opening60, [
  req({ waitlistId: "wl-c", durationMinutes: 45, createdAtOrder: 3 }),
  req({ waitlistId: "wl-a", durationMinutes: 60, createdAtOrder: 1 }),
  req({ waitlistId: "wl-b", durationMinutes: 30, createdAtOrder: 2 })
])));
check("request order does not change ranked waitlistIds", ids(shuffledA).join(",") === ids(shuffledB).join(","), ids(shuffledA) + " vs " + ids(shuffledB));
check(
  "ranking prefers higher waitlistMatchScore then exact_fill",
  shuffledA[0] && shuffledA[0].waitlistId === "wl-a" && shuffledA[0].openingFit === "exact_fill",
  ids(shuffledA)
);

// ---------------------------------------------------------------------------
// SEARCH STAYS INSIDE THE OPENING
// ---------------------------------------------------------------------------

const outside = api.rankWaitlistMatchCandidates(emptyDay, opening60, [req({
  waitlistId: "inside-only",
  durationMinutes: 30
})]);
check(
  "candidates stay inside the supplied opening",
  outside.length > 0 && outside.every(function (row) {
    return row.candidateStartMin >= opening60.startMin && row.candidateEndMin <= opening60.endMin;
  }),
  outside.map(function (row) { return row.candidateStartMin + "-" + row.candidateEndMin; })
);

// ---------------------------------------------------------------------------
// PURITY
// ---------------------------------------------------------------------------

const src = fs.readFileSync(path.join(root, "public/booking/smart-scheduling/waitlist.js"), "utf8");
check("purity: no Firebase APIs", !/firebase-firestore|getDocs\s*\(|onSnapshot\s*\(|updateDoc\s*\(|addDoc\s*\(/.test(src));
check("purity: no network", !/\bfetch\s*\(|XMLHttpRequest/.test(src));
check("purity: no writes / timers / Date", !/\bsetTimeout\b|\bsetInterval\b|\bDate\s*\(|createAppointment|updateAppointment|cancelAppointment/.test(src));
check("purity: no DOM / Calendar / Reports", !/\bdocument\b|\blocalStorage\b|ffBookingCal|ffBookingReports/.test(src));
check("purity: no SMS/email/client messaging", !/sendSms|sendEmail|twilio|mailer|getWaitlist|loadWaitlist/i.test(src));
check("purity: no automatic booking", !/bookClient|autoBook|acceptLink/i.test(src));

if (failed) {
  console.log("\n" + failed + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll waitlist matching checks passed.");
