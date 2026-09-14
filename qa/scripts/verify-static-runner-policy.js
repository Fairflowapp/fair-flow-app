"use strict";

/**
 * Self-check for the static runner failure policy.
 * Does not run or modify Booking product tests.
 */
const assert = require("assert");
const {
  expectedFailureKeys,
  parseFails,
  classifyFail,
  assessCollectedTests,
  collectFromSpawn,
} = require("../../scripts/run-booking-static-qa.js");

const BASE = "scripts/test-booking-clients-ui.js";
const KNOWN = [
  BASE + " :: recent list is bounded to 50",
  BASE + " :: UI recent list uses getRecentClients",
  BASE + " :: drawer update uses repository",
];

function baselineTests() {
  return KNOWN.map((testName) => ({ testName, status: "fail", classification: "A" }));
}

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

check("frozen keys are exactly the three known clients-ui failures", () => {
  assert.deepStrictEqual(expectedFailureKeys(), KNOWN);
});

check("parseFails strips FAIL: prefix", () => {
  assert.deepStrictEqual(parseFails("PASS: x\nFAIL: recent list is bounded to 50 \n"), [
    "recent list is bounded to 50",
  ]);
});

check("classifyFail is exact, not prefix", () => {
  assert.strictEqual(classifyFail(BASE, "recent list is bounded to 50"), "A");
  assert.strictEqual(classifyFail(BASE, "recent list is bounded to 50 extra"), "unknown");
  assert.strictEqual(classifyFail("scripts/test-booking-shell.js", "recent list is bounded to 50"), "unknown");
});

check("exact baseline exits clean", () => {
  const a = assessCollectedTests(baselineTests());
  assert.strictEqual(a.unexpected, 0);
});

check("a fourth clients-ui failure is rejected", () => {
  const tests = baselineTests().concat([
    { testName: BASE + " :: some new check", status: "fail", classification: "unknown" },
  ]);
  const a = assessCollectedTests(tests);
  assert.ok(a.unexpected > 0);
  assert.deepStrictEqual(a.extra, [BASE + " :: some new check"]);
});

check("another script failing is rejected", () => {
  const tests = baselineTests().concat([
    { testName: "scripts/test-booking-shell.js :: sales is a booking section", status: "fail", classification: "unknown" },
  ]);
  assert.ok(assessCollectedTests(tests).unexpected > 0);
});

check("changed known message is rejected", () => {
  const tests = [
    { testName: BASE + " :: recent list is bounded to 50", status: "fail", classification: "A" },
    { testName: BASE + " :: UI recent list uses getRecentClients", status: "fail", classification: "A" },
    { testName: BASE + " :: drawer update uses repo now", status: "fail", classification: "unknown" },
  ];
  const a = assessCollectedTests(tests);
  assert.ok(a.unexpected > 0);
  assert.ok(a.missing.indexOf(BASE + " :: drawer update uses repository") !== -1);
});

check("missing one known failure is rejected", () => {
  const tests = baselineTests().slice(0, 2);
  const a = assessCollectedTests(tests);
  assert.ok(a.unexpected > 0);
  assert.ok(a.missing.length === 1);
});

check("crash without FAIL lines is rejected", () => {
  const collected = collectFromSpawn("scripts/test-booking-shell.js", {
    status: 1,
    stdout: "ReferenceError: boom\n",
    stderr: "",
  });
  assert.strictEqual(collected.rows[0].status, "fail");
  assert.ok(assessCollectedTests(collected.rows).unexpected > 0);
});

check("spawn error is rejected", () => {
  const collected = collectFromSpawn("scripts/test-booking-shell.js", {
    error: new Error("ENOENT"),
    status: null,
    stdout: "",
    stderr: "",
  });
  assert.strictEqual(collected.rows[0].status, "fail");
  assert.ok(assessCollectedTests(collected.rows).unexpected > 0);
});

if (failed) {
  console.error("Static runner policy self-check failed:", failed);
  process.exit(1);
}
console.log("Static runner policy self-check passed.");
