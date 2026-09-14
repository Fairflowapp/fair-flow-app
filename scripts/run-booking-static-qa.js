"use strict";

/**
 * Run existing Booking static Node tests. Does not rewrite those files.
 *
 * Exit 0 only when the failure set is exactly the frozen c2ba63e baseline.
 * Any extra, missing, renamed, or crash failure exits non-zero.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CHECKPOINT_SHA = "c2ba63ed92faec884e5ab4e2beb0b76829ced251";
const KNOWN_A = {
  "scripts/test-booking-clients-ui.js": [
    "recent list is bounded to 50",
    "UI recent list uses getRecentClients",
    "drawer update uses repository",
  ],
};

function expectedFailureKeys() {
  const keys = [];
  Object.keys(KNOWN_A).sort().forEach((rel) => {
    KNOWN_A[rel].forEach((name) => keys.push(rel + " :: " + name));
  });
  return keys;
}

function parseFails(stdout) {
  return String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("FAIL:"))
    .map((line) => line.replace(/^FAIL:\s*/, "").trim());
}

function classifyFail(rel, name) {
  const known = KNOWN_A[rel] || [];
  if (known.indexOf(name) !== -1) return "A";
  return "unknown";
}

function sameKeySet(actual, expected) {
  if (actual.length !== expected.length) return false;
  const a = actual.slice().sort();
  const b = expected.slice().sort();
  return a.every((value, i) => value === b[i]);
}

function assessCollectedTests(tests) {
  const failKeys = tests.filter((row) => row.status === "fail").map((row) => row.testName);
  const expected = expectedFailureKeys();
  const extra = failKeys.filter((key) => expected.indexOf(key) === -1).sort();
  const missing = expected.filter((key) => failKeys.indexOf(key) === -1).sort();
  const unexpected = extra.length + missing.length;
  return { failKeys: failKeys.slice().sort(), expected, extra, missing, unexpected };
}

function listStaticTests() {
  return fs
    .readdirSync(path.join(ROOT, "scripts"))
    .filter((name) => /^test-booking-.*\.js$/.test(name))
    .sort()
    .map((name) => path.join("scripts", name));
}

function runOne(rel) {
  const result = spawnSync(process.execPath, [path.join(ROOT, rel)], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return result;
}

function collectFromSpawn(rel, result) {
  const stdout = (result.stdout || "") + (result.stderr || "");
  const fails = parseFails(stdout);
  const rows = [];

  if (result.error) {
    rows.push({
      checkpointSha: CHECKPOINT_SHA,
      testName: rel,
      status: "fail",
      classification: "unknown",
      error: String(result.error.message || result.error),
    });
    return { rows, stdout };
  }

  if (!fails.length && result.status === 0) {
    rows.push({
      checkpointSha: CHECKPOINT_SHA,
      testName: rel,
      status: "pass",
      classification: "",
    });
    return { rows, stdout };
  }

  if (!fails.length && result.status !== 0) {
    rows.push({
      checkpointSha: CHECKPOINT_SHA,
      testName: rel,
      status: "fail",
      classification: "unknown",
      error: "exited " + result.status + " without FAIL lines",
    });
    return { rows, stdout };
  }

  fails.forEach((name) => {
    const classification = classifyFail(rel, name);
    rows.push({
      checkpointSha: CHECKPOINT_SHA,
      testName: rel + " :: " + name,
      status: "fail",
      classification,
    });
  });

  if (result.status === 0 && fails.length) {
    rows.push({
      checkpointSha: CHECKPOINT_SHA,
      testName: rel,
      status: "fail",
      classification: "unknown",
      error: "printed FAIL lines but exited 0",
    });
  }

  return { rows, stdout };
}

function main() {
  const started = new Date().toISOString();
  const files = listStaticTests();
  const tests = [];

  console.log("Booking static QA @ checkpoint " + CHECKPOINT_SHA);
  console.log("Exit 0 only if failures exactly match the frozen c2ba63e baseline.\n");

  files.forEach((rel) => {
    const result = runOne(rel);
    const collected = collectFromSpawn(rel, result);
    process.stdout.write(collected.stdout);
    if (!collected.stdout.endsWith("\n")) process.stdout.write("\n");
    collected.rows.forEach((row) => {
      row.timestamp = new Date().toISOString();
      if (row.status === "fail") {
        const label = row.classification === "A"
          ? "CLASS A — PRE-EXISTING AT c2ba63e"
          : "CLASS unknown";
        console.log("  [" + label + "] " + row.testName + (row.error ? " (" + row.error + ")" : ""));
      }
      tests.push(row);
    });
  });

  const assessment = assessCollectedTests(tests);
  const out = {
    checkpointSha: CHECKPOINT_SHA,
    generatedAt: started,
    finishedAt: new Date().toISOString(),
    suite: "booking-static",
    unexpectedFails: assessment.unexpected,
    extra: assessment.extra,
    missing: assessment.missing,
    tests,
  };
  const dest = path.join(ROOT, "qa", "baselines", "last-static.json");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
  console.log("\nWrote " + path.relative(ROOT, dest));

  if (assessment.unexpected) {
    if (assessment.extra.length) console.error("New/changed failures:", assessment.extra.join(" | "));
    if (assessment.missing.length) console.error("Missing baseline failures:", assessment.missing.join(" | "));
    process.exit(1);
  }
  console.log("Static suite complete. Failures exactly match CLASS A baseline at c2ba63e.");
}

module.exports = {
  CHECKPOINT_SHA,
  KNOWN_A,
  expectedFailureKeys,
  parseFails,
  classifyFail,
  assessCollectedTests,
  collectFromSpawn,
};

if (require.main === module) {
  main();
}
