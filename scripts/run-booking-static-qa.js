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

function productRoot() {
  const raw = String(process.env.FF_QA_APP_ROOT || "").trim();
  return raw ? path.resolve(raw) : ROOT;
}
const KNOWN_A = {
  "scripts/test-booking-clients-ui.js": [
    "recent list is bounded to 50",
    "UI recent list uses getRecentClients",
    "drawer update uses repository",
  ],
};

/** Environment-dependent suites. Dedicated commands only — never test:booking:static. */
const STATIC_EXCLUDED = [
  "scripts/test-booking-smart-scheduling-execute-booking-mutation.js",
  "scripts/test-booking-smart-scheduling-firestore-emulator.js",
  "scripts/test-booking-smart-scheduling-staging-callable.js",
];

function isStaticBookingScript(rel) {
  const name = String(rel || "").replace(/\\/g, "/");
  if (!/^scripts\/test-booking-.*\.js$/.test(name)) return false;
  return STATIC_EXCLUDED.indexOf(name) === -1;
}

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

function listStaticTests(root) {
  const base = root || productRoot();
  const dir = path.join(base, "scripts");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /^test-booking-.*\.js$/.test(name))
    .map((name) => path.join("scripts", name).replace(/\\/g, "/"))
    .filter(isStaticBookingScript)
    .sort();
}

function runOne(rel, root) {
  const base = root || productRoot();
  const result = spawnSync(process.execPath, [path.join(base, rel)], {
    cwd: base,
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

function runStaticSuite(options) {
  const started = new Date().toISOString();
  const root = options && options.productRoot ? path.resolve(options.productRoot) : productRoot();
  const files = listStaticTests(root);
  const tests = [];
  const ranScripts = files.slice();

  files.forEach((rel) => {
    const result = runOne(rel, root);
    const collected = collectFromSpawn(rel, result);
    if (!(options && options.silent)) {
      process.stdout.write(collected.stdout);
      if (!collected.stdout.endsWith("\n")) process.stdout.write("\n");
    }
    collected.rows.forEach((row) => {
      row.timestamp = new Date().toISOString();
      if (row.status === "fail" && !(options && options.silent)) {
        const label = row.classification === "A"
          ? "CLASS A — PRE-EXISTING AT c2ba63e"
          : "CLASS unknown";
        console.log("  [" + label + "] " + row.testName + (row.error ? " (" + row.error + ")" : ""));
      }
      tests.push(row);
    });
  });

  const assessment = assessCollectedTests(tests);
  return {
    productRoot: root,
    startedAt: started,
    finishedAt: new Date().toISOString(),
    ranScripts,
    tests,
    assessment,
  };
}

function main() {
  console.log("Booking static QA @ checkpoint " + CHECKPOINT_SHA);
  console.log("Product root: " + productRoot());
  console.log("Exit 0 only if failures exactly match the frozen c2ba63e baseline.\n");
  const result = runStaticSuite();
  const assessment = result.assessment;
  const out = {
    checkpointSha: CHECKPOINT_SHA,
    generatedAt: result.startedAt,
    finishedAt: result.finishedAt,
    suite: "booking-static",
    productRoot: result.productRoot,
    unexpectedFails: assessment.unexpected,
    extra: assessment.extra,
    missing: assessment.missing,
    tests: result.tests,
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
  STATIC_EXCLUDED,
  isStaticBookingScript,
  expectedFailureKeys,
  parseFails,
  classifyFail,
  assessCollectedTests,
  collectFromSpawn,
  listStaticTests,
  runStaticSuite,
};

if (require.main === module) {
  main();
}
