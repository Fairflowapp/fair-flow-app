/**
 * Local cleanup-safety tests for the staging callable smoke.
 * No Firebase. No staging/production writes.
 *
 * Usage: node scripts/test-booking-smart-scheduling-staging-smoke-cleanup.js
 */
"use strict";

const {
  createSmokeIdentities,
  recordCreatedDoc,
  assertCleanupRecord,
  assertSalonDeleteTarget,
  assertAuthDeleteTarget,
  isAllowedCleanupPath,
  planExactCleanup,
  MISMATCH
} = require("./lib/booking-smart-scheduling-staging-smoke-cleanup");

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

function throwsMismatch(fn) {
  try {
    fn();
    return false;
  } catch (err) {
    return !!(err && err.code === MISMATCH);
  }
}

const current = createSmokeIdentities("runoneaaa");
recordCreatedDoc(current, "salons/" + current.createdSmokeSalonId);
recordCreatedDoc(current, "salons/" + current.createdSmokeSalonId + "/clients/client-1");
recordCreatedDoc(current, "users/" + current.createdSmokeAuthUid);
recordCreatedDoc(current, "users/" + current.createdSmokeAuthUid + "/memberships/" + current.createdSmokeSalonId);

check("create current-run salon prefix", current.createdSmokeSalonId === "ss-staging-smoke-runoneaaa");
check("create current-run uid prefix", current.createdSmokeAuthUid === "ss-smoke-uid-runoneaaa");
check("create current-run email bound to uid", current.createdSmokeEmail === "ss-smoke-uid-runoneaaa@fair-flow-staging.test");
check("accept exact recorded identities", !throwsMismatch(function () { assertCleanupRecord(current); }));
check("accept exact salon delete", !throwsMismatch(function () {
  assertSalonDeleteTarget(current, current.createdSmokeSalonId);
}));
check("accept exact auth delete", !throwsMismatch(function () {
  assertAuthDeleteTarget(current, { uid: current.createdSmokeAuthUid, email: current.createdSmokeEmail });
}));

const plan = planExactCleanup(current);
check("plan salon is exact current run", plan.salonId === current.createdSmokeSalonId);
check("plan auth uid is exact current run", plan.authUid === current.createdSmokeAuthUid);
check("plan does not include QA uid", plan.authUid !== "ff-booking-qa-user");
check("plan user docs are exact", plan.userDocs.join(",") === [
  "users/" + current.createdSmokeAuthUid + "/memberships/" + current.createdSmokeSalonId,
  "users/" + current.createdSmokeAuthUid
].join(","));
check("allowed current salon path", isAllowedCleanupPath(current, "salons/" + current.createdSmokeSalonId + "/appointments/a1"));
check("reject QA user path", !isAllowedCleanupPath(current, "users/ff-booking-qa-user"));
check("reject QA membership path", !isAllowedCleanupPath(current, "users/ff-booking-qa-user/memberships/ffBookingQa"));
check("reject QA salon member path", !isAllowedCleanupPath(current, "salons/ffBookingQa/members/ff-booking-qa-user"));

check("refuse ff-booking-qa-user as smoke uid", throwsMismatch(function () {
  assertCleanupRecord({
    createdSmokeSalonId: current.createdSmokeSalonId,
    createdSmokeAuthUid: "ff-booking-qa-user",
    createdSmokeEmail: "ff-booking-qa-user@fair-flow-staging.test",
    createdDocumentRefs: []
  });
}));
check("refuse ff-booking-qa email as smoke email", throwsMismatch(function () {
  assertAuthDeleteTarget(current, {
    uid: current.createdSmokeAuthUid,
    email: "ff-booking-qa@fair-flow-staging.test"
  });
}));
check("refuse QA uid auth delete even if email forged to smoke", throwsMismatch(function () {
  assertAuthDeleteTarget(current, {
    uid: "ff-booking-qa-user",
    email: current.createdSmokeEmail
  });
}));

const otherRun = createSmokeIdentities("runbbbbbb");
check("refuse other-run salon", throwsMismatch(function () {
  assertSalonDeleteTarget(current, otherRun.createdSmokeSalonId);
}));
check("refuse other-run uid", throwsMismatch(function () {
  assertAuthDeleteTarget(current, { uid: otherRun.createdSmokeAuthUid, email: otherRun.createdSmokeEmail });
}));
check("refuse other-run path on current plan", !isAllowedCleanupPath(current, "salons/" + otherRun.createdSmokeSalonId));

check("refuse uid prefix match that is not exact", throwsMismatch(function () {
  assertAuthDeleteTarget(current, {
    uid: current.createdSmokeAuthUid + "x",
    email: current.createdSmokeAuthUid + "x@fair-flow-staging.test"
  });
}));
check("refuse email domain match that is not exact smoke email", throwsMismatch(function () {
  assertAuthDeleteTarget(current, {
    uid: current.createdSmokeAuthUid,
    email: "other-user@fair-flow-staging.test"
  });
}));

check("refuse empty record", throwsMismatch(function () { assertCleanupRecord({}); }));
check("refuse undefined record", throwsMismatch(function () { assertCleanupRecord(undefined); }));
check("refuse empty salon id", throwsMismatch(function () {
  assertSalonDeleteTarget(current, "");
}));
check("refuse undefined salon id", throwsMismatch(function () {
  assertSalonDeleteTarget(current, undefined);
}));
check("refuse empty generated ids", throwsMismatch(function () {
  assertCleanupRecord({
    createdSmokeSalonId: "",
    createdSmokeAuthUid: "",
    createdSmokeEmail: "",
    createdDocumentRefs: []
  });
}));
check("refuse malformed salon id", throwsMismatch(function () {
  assertCleanupRecord({
    createdSmokeSalonId: "ffBookingQa",
    createdSmokeAuthUid: current.createdSmokeAuthUid,
    createdSmokeEmail: current.createdSmokeEmail,
    createdDocumentRefs: []
  });
}));
check("refuse salon prefix without suffix", throwsMismatch(function () {
  assertCleanupRecord({
    createdSmokeSalonId: "ss-staging-smoke-",
    createdSmokeAuthUid: current.createdSmokeAuthUid,
    createdSmokeEmail: current.createdSmokeEmail,
    createdDocumentRefs: []
  });
}));
check("refuse recording a doc outside the current namespace", throwsMismatch(function () {
  recordCreatedDoc(current, "users/ff-booking-qa-user");
}));
check("refuse invalid suffix", throwsMismatch(function () {
  createSmokeIdentities("../ff-booking-qa-user");
}));

if (failed) {
  console.error(failed + " staging smoke cleanup safety checks failed.");
  process.exit(1);
}
console.log("All staging smoke cleanup safety checks passed.");
