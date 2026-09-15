"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { QA_ROOT, REPO_ROOT, CHECKPOINT_SHA } = require("../helpers/env");
const { inspectTargetWorktree } = require("../helpers/target-worktree");
const { hashProductFiles } = require("../helpers/product-hash");
const { runStaticSuite, expectedFailureKeys } = require("../../scripts/run-booking-static-qa");
const {
  compareStatic,
  compareBrowserSuite,
  compareKnownIssues,
  summarizeComparisons,
} = require("../helpers/baseline-compare");
const { acquireWriteLock, releaseWriteLock, readWriteLock } = require("../helpers/write-lock");

const QA_HARNESS_SHA = readQaHead();

function readQaHead() {
  const res = spawnSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" });
  return res.status === 0 ? String(res.stdout || "").trim() : "";
}

function parseArgs(argv) {
  const out = { worktree: "", label: "", mode: "smoke" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--worktree") out.worktree = argv[++i] || "";
    else if (arg === "--label") out.label = argv[++i] || "";
    else if (arg === "--mode") out.mode = String(argv[++i] || "smoke").trim().toLowerCase();
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

function usage() {
  return [
    "Usage:",
    "  npm run test:booking:regression -- --worktree /absolute/path --label name [--mode smoke|full]",
    "",
    "Default mode is smoke (static + read-only Playwright).",
    "full also runs appointment + client lifecycle and writes isolated staging data.",
  ].join("\n");
}

function isInfraFailure(text) {
  return /QA SETUP:|QA SAFETY STOP|QA CONTENTION|QA LOCAL ASSET MISSING|Executable doesn't exist|Looks like Playwright was just installed|FF_STAGING_EMAIL|missing credentials|Target worktree|not a Git worktree/i.test(String(text || ""));
}

function loadJson(rel) {
  const abs = path.join(QA_ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  return JSON.parse(fs.readFileSync(abs, "utf8"));
}

function lastReporterTests(fileName, notBefore) {
  const json = loadJson(path.join("baselines", fileName));
  if (!json || !Array.isArray(json.tests)) return [];
  if (notBefore && json.finishedAt && Date.parse(json.finishedAt) + 2000 < Date.parse(notBefore)) {
    return [];
  }
  return json.tests;
}

function spawnPlaywright(project, suite, env) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(REPO_ROOT, "node_modules", "@playwright", "test", "cli.js"),
      "test",
      "--config",
      path.join(QA_ROOT, "playwright.config.js"),
      "--project=" + project,
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env,
    }
  );
  const stdout = (result.stdout || "") + (result.stderr || "");
  process.stdout.write(stdout);
  if (!stdout.endsWith("\n")) process.stdout.write("\n");
  return {
    status: result.status,
    stdout,
    error: result.error ? String(result.error.message || result.error) : "",
    suite,
  };
}

function runBrowserSuite(project, suite, env, reporterFile, baseline, nameField) {
  const started = new Date().toISOString();
  const first = spawnPlaywright(project, suite, env);
  const firstInfra = isInfraFailure(first.stdout + "\n" + first.error);
  if (firstInfra) {
    const tests = lastReporterTests(reporterFile, started);
    return {
      attempt: first,
      retried: false,
      flaky: false,
      infra: true,
      tests,
      rows: [{
        scenario: suite,
        baseline: "PASS",
        target: "SKIP",
        comparison: "QA_INFRA_FAILURE",
        classification: "D",
        error: (first.error || first.stdout || "").split("\n").slice(0, 6).join(" "),
      }],
    };
  }

  let attempt = first;
  let retried = false;
  let flaky = false;
  if (first.status !== 0) {
    const second = spawnPlaywright(project, suite, env);
    retried = true;
    if (second.status === 0) {
      attempt = second;
      flaky = true;
    } else {
      attempt = second;
    }
  }

  const tests = lastReporterTests(reporterFile, started);
  const rows = compareBrowserSuite(baseline, tests, nameField, {
    flakyKeys: flaky ? tests.map((row) => String(row.testName || row.test || "").toLowerCase()) : [],
  });
  if (flaky) {
    rows.forEach((row) => {
      if (row.target === "PASS") {
        row.comparison = "FLAKY";
        row.classification = "C";
      }
    });
  }
  if (isInfraFailure(attempt.stdout + "\n" + attempt.error) && attempt.status !== 0) {
    rows.forEach((row) => {
      row.comparison = "QA_INFRA_FAILURE";
      row.classification = "D";
    });
  }
  return { attempt, retried, flaky, infra: false, tests, rows };
}

function printSummary(report) {
  const allRows = []
    .concat(report.static.rows || [])
    .concat(report.smoke.rows || [])
    .concat(report.lifecycle.rows || [])
    .concat(report.clients.rows || [])
    .concat(report.knownIssues || []);
  const summary = summarizeComparisons(allRows);
  const buckets = summary.buckets;

  function list(title, items, pick) {
    console.log(title);
    if (!items.length) {
      console.log("- none");
      return;
    }
    items.forEach((row) => console.log("- " + pick(row)));
  }

  console.log("");
  console.log("TARGET:");
  console.log(report.targetBranch + (report.targetLabel ? " (" + report.targetLabel + ")" : ""));
  console.log("SHA:");
  console.log(report.targetDirty ? report.targetHeadSha + " + DIRTY WORKTREE" : report.targetHeadSha);
  console.log("");
  console.log("RESULT:");
  console.log(summary.result);
  console.log("");
  list("NEW REGRESSIONS:", buckets.NEW_REGRESSION, (row) => row.scenario);
  console.log("");
  list("PRE-EXISTING:", buckets.PRE_EXISTING, (row) => row.scenario || row.title || row.id);
  console.log("");
  list("FIXED VS BASELINE:", buckets.FIXED_VS_BASELINE, (row) => row.scenario || row.title || row.id);
  console.log("");
  list("UNCHANGED PASS:", buckets.UNCHANGED_PASS, (row) => row.scenario);
  console.log("");
  list("FLAKY / ENVIRONMENT:", buckets.FLAKY, (row) => row.scenario);
  console.log("");
  list("QA INFRA:", buckets.QA_INFRA_FAILURE, (row) => row.scenario);
  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.worktree) {
    console.log(usage());
    process.exit(args.help ? 0 : 2);
  }
  if (args.mode !== "smoke" && args.mode !== "full") {
    console.error("QA SETUP: --mode must be smoke or full.");
    process.exit(2);
  }

  const target = inspectTargetWorktree(args.worktree, args.label);
  const productFileHashes = hashProductFiles(target.worktree);
  const startedAt = new Date().toISOString();

  console.log("Booking cross-worktree regression");
  console.log("QA harness:     " + REPO_ROOT + " @ " + QA_HARNESS_SHA);
  console.log("Baseline:       " + CHECKPOINT_SHA);
  console.log("Target path:    " + target.worktree);
  console.log("Target branch:  " + target.branch);
  console.log("Target SHA:     " + target.headSha + (target.dirty ? " + DIRTY WORKTREE" : ""));
  console.log("Target label:   " + target.label);
  console.log("Mode:           " + args.mode);
  console.log("Serving:        " + target.publicRoot + " under https://fair-flow-staging.web.app");
  if (target.dirty) {
    console.log("DIRTY WORKTREE: browser tests serve files on disk, not a clean HEAD checkout.");
    console.log(target.statusPorcelain);
  }

  const childEnv = Object.assign({}, process.env, {
    FF_QA_APP_ROOT: target.worktree,
    FF_QA_TARGET_LABEL: target.label,
    FF_QA_TARGET_SHA: target.headSha,
    FF_QA_TARGET_DIRTY: target.dirty ? "1" : "0",
    FF_QA_AUT_ID: target.autId,
    FF_QA_TARGET_BRANCH: target.branch,
  });

  const report = {
    qaHarnessSha: QA_HARNESS_SHA,
    baselineProductSha: CHECKPOINT_SHA,
    targetWorktree: target.worktree,
    targetLabel: target.label,
    targetBranch: target.branch,
    targetHeadSha: target.headSha,
    targetDirty: target.dirty,
    targetStatus: target.statusPorcelain,
    productFileHashes,
    mode: args.mode,
    startedAt,
    finishedAt: "",
    static: { rows: [] },
    smoke: { rows: [] },
    lifecycle: { rows: [] },
    clients: { rows: [] },
    knownIssues: [],
    writeLease: {
      path: "salons/ffBookingQa/qaLocks/booking-write-suite",
      required: args.mode === "full",
      acquired: false,
      released: false,
      runId: "",
      error: "",
    },
    runId: "",
    classification: {},
    baselineComparison: {},
  };

  console.log("\n=== STATIC against target product scripts ===\n");
  let staticResult;
  try {
    staticResult = runStaticSuite({ productRoot: target.worktree });
    if (!staticResult.ranScripts.length) {
      throw new Error("QA SETUP: Target has no scripts/test-booking-*.js files.");
    }
    report.static = {
      productRoot: staticResult.productRoot,
      ranScripts: staticResult.ranScripts,
      tests: staticResult.tests,
      assessment: staticResult.assessment,
      rows: compareStatic(expectedFailureKeys(), staticResult),
    };
  } catch (err) {
    report.static = {
      error: String(err && err.message ? err.message : err),
      rows: [{
        scenario: "static suite",
        baseline: "FAIL",
        target: "SKIP",
        comparison: "QA_INFRA_FAILURE",
        classification: "D",
      }],
    };
  }

  console.log("\n=== SMOKE (read-only) against target public/ ===\n");
  const e2eBaseline = loadJson("baselines/c2ba63e-e2e.json") || { tests: [] };
  childEnv.FF_QA_SUITE = "booking-e2e-smoke";
  report.smoke = runBrowserSuite("chromium", "smoke", childEnv, "last-e2e.json", e2eBaseline, "testName");

  if (args.mode === "full") {
    console.log("");
    console.log("============================================================");
    console.log("STAGING-WRITE MODE");
    console.log("Firebase project: fair-flow-staging");
    console.log("Salon:            ffBookingQa / qaLoc1");
    console.log("Target branch:    " + target.branch);
    console.log("Target SHA:       " + target.headSha + (target.dirty ? " + DIRTY WORKTREE" : ""));
    console.log("Isolated FF-QA-* data only. Never production.");
    console.log("============================================================");
    console.log("");

    let lease = null;
    try {
      const leaseRunId = "FF-QA-REG-" + Date.now().toString(36) + process.pid.toString(36);
      report.runId = leaseRunId;
      report.writeLease.runId = leaseRunId;
      lease = await acquireWriteLock({
        runId: leaseRunId,
        targetLabel: target.label,
        targetSha: target.dirty ? target.headSha + "+DIRTY" : target.headSha,
      });
      report.writeLease.acquired = true;
      childEnv.FF_QA_WRITE_LOCK_HELD = "1";
      console.log("Write lease acquired:", leaseRunId);

      console.log("\n=== APPOINTMENT LIFECYCLE against target ===\n");
      const lifeBaseline = loadJson("baselines/c2ba63e-lifecycle.json") || { tests: [] };
      childEnv.FF_QA_SUITE = "lifecycle";
      report.lifecycle = runBrowserSuite(
        "lifecycle",
        "lifecycle",
        childEnv,
        "last-lifecycle.json",
        lifeBaseline,
        "test"
      );
      report.knownIssues = compareKnownIssues(
        lifeBaseline.discoveredProductNotes || [],
        {},
        report.lifecycle.attempt ? report.lifecycle.attempt.stdout : ""
      );

      console.log("\n=== CLIENT LIFECYCLE against target ===\n");
      const clientBaseline = loadJson("baselines/c2ba63e-clients.json") || { tests: [] };
      childEnv.FF_QA_SUITE = "clients";
      report.clients = runBrowserSuite(
        "clients",
        "clients",
        childEnv,
        "last-clients.json",
        clientBaseline,
        "scenario"
      );
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      const contention = err && err.code === "QA_WRITE_LOCK_HELD";
      report.writeLease.error = message;
      report.lifecycle.rows = [{
        scenario: "appointment lifecycle",
        baseline: "PASS",
        target: "SKIP",
        comparison: "QA_INFRA_FAILURE",
        classification: "D",
        error: message,
      }];
      report.clients.rows = [{
        scenario: "client lifecycle",
        baseline: "PASS",
        target: "SKIP",
        comparison: "QA_INFRA_FAILURE",
        classification: "D",
        error: message,
      }];
      console.error(contention ? message : "QA SETUP: " + message);
    } finally {
      if (lease) {
        const released = await releaseWriteLock(lease);
        report.writeLease.released = !!(released && released.released);
        const leftover = await readWriteLock();
        if (leftover && leftover.runId === lease.runId) {
          report.writeLease.error = "Lease still held by this run after release.";
          report.lifecycle.rows = (report.lifecycle.rows || []).concat([{
            scenario: "staging-write lease release",
            baseline: "PASS",
            target: "FAIL",
            comparison: "QA_INFRA_FAILURE",
            classification: "D",
          }]);
        } else if (!report.writeLease.released && leftover && leftover.runId === lease.runId) {
          report.writeLease.error = "Lease release did not delete this run's lock.";
        }
        console.log("Write lease released:", lease.runId, report.writeLease.released ? "yes" : "no");
      }
    }
  }

  report.finishedAt = new Date().toISOString();
  const summary = printSummary(report);
  report.classification = {
    result: summary.result,
    counts: Object.keys(summary.buckets).reduce((acc, key) => {
      acc[key] = summary.buckets[key].length;
      return acc;
    }, {}),
  };
  report.baselineComparison = {
    static: report.static.rows,
    smoke: report.smoke.rows,
    lifecycle: report.lifecycle.rows,
    clients: report.clients.rows,
    knownIssues: report.knownIssues,
  };

  const stamp = report.finishedAt.replace(/[:.]/g, "").replace("T", "-").replace("Z", "Z");
  const fileName = stamp + "-" + target.label.replace(/[^A-Za-z0-9._-]+/g, "-") + "-" + target.shortSha + ".json";
  const destDir = path.join(QA_ROOT, "regression-results");
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, fileName);
  fs.writeFileSync(dest, JSON.stringify(report, null, 2) + "\n");
  console.log("\nWrote " + path.relative(REPO_ROOT, dest));

  if (summary.result !== "PASS") process.exit(1);
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
