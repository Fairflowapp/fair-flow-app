"use strict";

const fs = require("fs");
const path = require("path");
const { CHECKPOINT_SHA } = require("./env");

function classify(title, status, error) {
  const text = String(title || "") + " " + String(error || "");
  if (/QA SAFETY STOP|QA SETUP:|non-staging Firebase|FF_STAGING_/i.test(text)) {
    return "D";
  }
  if (status === "passed") return "";
  if (status === "skipped") return "D";
  return "unknown";
}

class BaselineReporter {
  constructor() {
    this.startedAt = new Date().toISOString();
    this.tests = [];
  }

  onTestEnd(test, result) {
    const title = test.titlePath().filter(Boolean).join(" > ");
    const error = result.errors && result.errors[0]
      ? String(result.errors[0].message || result.errors[0]).split("\n")[0]
      : "";
    this.tests.push({
      checkpointSha: CHECKPOINT_SHA,
      testName: title,
      status: result.status === "passed" ? "pass" : (result.status === "skipped" ? "skipped" : "fail"),
      playwrightStatus: result.status,
      classification: classify(title, result.status, error),
      error: error.slice(0, 400),
      durationMs: result.duration,
      timestamp: new Date().toISOString(),
    });
  }

  onEnd() {
    const suite = process.env.FF_QA_SUITE || "booking-e2e-smoke";
    const out = {
      checkpointSha: CHECKPOINT_SHA,
      generatedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      suite,
      tests: this.tests,
    };
    const fileName = suite === "lifecycle" ? "last-lifecycle.json" : "last-e2e.json";
    const file = path.join(__dirname, "..", "baselines", fileName);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  }
}

module.exports = BaselineReporter;
