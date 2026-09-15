"use strict";

const assert = require("assert");
const {
  compareScenario,
  compareStatic,
  compareBrowserSuite,
  summarizeComparisons,
  detectKnownIssues,
} = require("../helpers/baseline-compare");

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

check("baseline fail + same target fail is PRE_EXISTING / A", () => {
  const row = compareScenario("FAIL", "FAIL");
  assert.strictEqual(row.comparison, "PRE_EXISTING");
  assert.strictEqual(row.classification, "A");
});

check("baseline pass + target fail is NEW_REGRESSION / B", () => {
  const row = compareScenario("PASS", "FAIL");
  assert.strictEqual(row.comparison, "NEW_REGRESSION");
  assert.strictEqual(row.classification, "B");
});

check("baseline fail + target pass is FIXED_VS_BASELINE", () => {
  const row = compareScenario("FAIL", "PASS");
  assert.strictEqual(row.comparison, "FIXED_VS_BASELINE");
});

check("changed static failure message is not classified A", () => {
  const rows = compareStatic(
    ["scripts/test-booking-clients-ui.js :: drawer update uses repository"],
    {
      ranScripts: ["scripts/test-booking-clients-ui.js"],
      assessment: { failKeys: ["scripts/test-booking-clients-ui.js :: drawer update uses repo now"] },
      tests: [],
    }
  );
  const changed = rows.find((row) => /repo now/.test(row.scenario));
  const missing = rows.find((row) => /uses repository$/.test(row.scenario));
  assert.strictEqual(changed.comparison, "NEW_REGRESSION");
  assert.strictEqual(missing.comparison, "FIXED_VS_BASELINE");
});

check("smoke baseline pass becoming fail is NEW_REGRESSION", () => {
  const rows = compareBrowserSuite(
    { tests: [{ testName: "G. Reports smoke — page renders", status: "pass" }] },
    [{ testName: "Authenticated Booking smoke > G. Reports smoke — page renders", status: "fail" }],
    "testName"
  );
  assert.strictEqual(rows[0].comparison, "NEW_REGRESSION");
});

check("self-comparison of green browser flows is UNCHANGED_PASS", () => {
  const rows = compareBrowserSuite(
    { tests: [{ test: "1. create appointment", status: "PASS" }] },
    [{ testName: "Booking appointment lifecycle > 1. create appointment", status: "pass" }],
    "test"
  );
  assert.strictEqual(rows[0].comparison, "UNCHANGED_PASS");
});

check("infra skip is D not B", () => {
  const row = compareScenario("PASS", "SKIP", { infra: true });
  assert.strictEqual(row.comparison, "QA_INFRA_FAILURE");
  assert.strictEqual(row.classification, "D");
});

check("A2 detection requires blur + innerHTML", () => {
  const hit = detectKnownIssues("NotFoundError innerHTML blur event handler");
  const miss = detectKnownIssues("NotFoundError only");
  assert.strictEqual(hit.A2, true);
  assert.strictEqual(miss.A2, false);
});

check("summary prefers regressions and infra wording", () => {
  const summary = summarizeComparisons([
    { comparison: "NEW_REGRESSION" },
    { comparison: "QA_INFRA_FAILURE" },
  ]);
  assert.strictEqual(summary.result, "REGRESSIONS FOUND / QA INFRA FAILURE");
});

if (failed) {
  console.error("Baseline compare self-check failed:", failed);
  process.exit(1);
}
console.log("Baseline compare self-check passed.");
