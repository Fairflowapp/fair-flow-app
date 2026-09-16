"use strict";

const assert = require("assert");
const { noteBelongsToRun } = require("../helpers/appointment-admin");
const { clientNoteBelongsToRun, isQaLifecycleNote, FIXTURE_CLIENT_ID } = require("../helpers/client-admin");
const {
  isQaCalendarBlockMark,
  isQaOwnedCalendarBlock,
  isRunOwnedCalendarBlock,
  noteBelongsToRun: blockNoteBelongsToRun,
  isStaleUpdate,
  FIXTURE_NOTE,
} = require("../helpers/calendar-block-admin");

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log("PASS:", name);
  } catch (err) {
    failed += 1;
    console.log("FAIL:", name, err && err.message ? err.message : err);
  }
}

check("appointment cleanup matches exact run prefix only", () => {
  const runA = "FF-QA-aaa111";
  const runB = "FF-QA-bbb222";
  assert.strictEqual(noteBelongsToRun(runA + " create", runA), true);
  assert.strictEqual(noteBelongsToRun(runB + " create", runA), false);
  assert.strictEqual(noteBelongsToRun(runA + "create", runA), false);
  assert.strictEqual(noteBelongsToRun("FF-QA-FIXTURE", runA), false);
});

check("missing appointment runId is not treated as all-QA", () => {
  assert.strictEqual(noteBelongsToRun("FF-QA-aaa111 create", ""), false);
});

check("client cleanup matches FF-QA-CLIENT-<runId> only", () => {
  const runA = "aaa111";
  const runB = "bbb222";
  assert.strictEqual(clientNoteBelongsToRun("FF-QA-CLIENT-" + runA + " create", runA), true);
  assert.strictEqual(clientNoteBelongsToRun("FF-QA-CLIENT-" + runB + " create", runA), false);
  assert.strictEqual(clientNoteBelongsToRun("FF-QA-CLIENT-" + runA, runA), true);
  assert.strictEqual(isQaLifecycleNote("FF-QA-FIXTURE"), false);
  assert.notStrictEqual(FIXTURE_CLIENT_ID, runA);
});

check("ordinary cleanup would not match every FF-QA-CLIENT-*", () => {
  const runA = "aaa111";
  assert.strictEqual(clientNoteBelongsToRun("FF-QA-CLIENT-other create", runA), false);
});

check("calendar block marks include leftover FF-QA-LIVE-BLOCK", () => {
  assert.strictEqual(isQaCalendarBlockMark("FF-QA-LIVE-BLOCK"), true);
  assert.strictEqual(isQaCalendarBlockMark("FF-QA-aaa111"), true);
  assert.strictEqual(isQaCalendarBlockMark("FF-QA-aaa111 lunch"), true);
});

check("calendar block marks reject fixture and real block labels", () => {
  assert.strictEqual(isQaCalendarBlockMark(FIXTURE_NOTE), false);
  assert.strictEqual(isQaCalendarBlockMark("Lunch"), false);
  assert.strictEqual(isQaCalendarBlockMark("Lunch Break"), false);
  assert.strictEqual(isQaCalendarBlockMark("Break"), false);
  assert.strictEqual(isQaCalendarBlockMark("meeting with FF"), false);
  assert.strictEqual(isQaCalendarBlockMark(""), false);
});

check("calendar block cleanup keeps non-QA and off-location blocks", () => {
  assert.strictEqual(isQaOwnedCalendarBlock({
    locationId: "qaLoc1",
    providerId: "qaProv1",
    note: "FF-QA-LIVE-BLOCK",
    label: "FF-QA-LIVE-BLOCK",
  }), true);
  assert.strictEqual(isQaOwnedCalendarBlock({
    locationId: "qaLoc1",
    providerId: "qaProv1",
    note: "",
    label: "Lunch",
  }), false);
  assert.strictEqual(isQaOwnedCalendarBlock({
    locationId: "otherLoc",
    providerId: "qaProv1",
    note: "FF-QA-LIVE-BLOCK",
    label: "FF-QA-LIVE-BLOCK",
  }), false);
  assert.strictEqual(isQaOwnedCalendarBlock({
    locationId: "qaLoc1",
    providerId: "realProv9",
    note: "FF-QA-LIVE-BLOCK",
    label: "FF-QA-LIVE-BLOCK",
  }), false);
});

check("calendar block run cleanup matches exact run prefix only", () => {
  const runA = "FF-QA-aaa111";
  const runB = "FF-QA-bbb222";
  const owned = {
    locationId: "qaLoc1",
    providerId: "qaProv1",
    note: runA + " personal",
    label: runA + " personal",
  };
  assert.strictEqual(blockNoteBelongsToRun(runA + " personal", runA), true);
  assert.strictEqual(blockNoteBelongsToRun(runB + " personal", runA), false);
  assert.strictEqual(isRunOwnedCalendarBlock(owned, runA), true);
  assert.strictEqual(isRunOwnedCalendarBlock(owned, runB), false);
  assert.strictEqual(isRunOwnedCalendarBlock({
    locationId: "qaLoc1",
    providerId: "qaProv1",
    note: "",
    label: "Lunch Break",
  }, runA), false);
});

check("stale calendar block age cutoff is exclusive of fresh updates", () => {
  const cutoff = 1_000_000;
  assert.strictEqual(isStaleUpdate(cutoff, cutoff), true);
  assert.strictEqual(isStaleUpdate(cutoff - 1, cutoff), true);
  assert.strictEqual(isStaleUpdate(cutoff + 1, cutoff), false);
  assert.strictEqual(isStaleUpdate(0, cutoff), false);
});

if (failed) {
  console.error("Cleanup-scope self-check failed:", failed);
  process.exit(1);
}
console.log("Cleanup-scope self-check passed.");
