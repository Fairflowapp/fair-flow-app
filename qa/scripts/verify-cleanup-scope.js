"use strict";

const assert = require("assert");
const { noteBelongsToRun } = require("../helpers/appointment-admin");
const { clientNoteBelongsToRun, isQaLifecycleNote, FIXTURE_CLIENT_ID } = require("../helpers/client-admin");

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

if (failed) {
  console.error("Cleanup-scope self-check failed:", failed);
  process.exit(1);
}
console.log("Cleanup-scope self-check passed.");
