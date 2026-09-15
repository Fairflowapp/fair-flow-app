"use strict";

const fs = require("fs");
const path = require("path");

const CHECKPOINT_SHA = "c2ba63ed92faec884e5ab4e2beb0b76829ced251";
const REQUIRED_PROJECT_ID = "fair-flow-staging";
const DEFAULT_ORIGIN = "http://127.0.0.1:4173";
const STAGING_APP_ORIGIN = "https://fair-flow-staging.web.app";
const PRODUCTION_HOST_MARKERS = [
  "fairflowapp-db841",
  "app.fairflowapp.com",
  "fairflowapp.com",
];

const QA_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(QA_ROOT, "..");

function appRoot() {
  const raw = String(process.env.FF_QA_APP_ROOT || "").trim();
  if (!raw) return REPO_ROOT;
  const resolved = path.resolve(raw);
  if (resolved === path.parse(resolved).root) {
    throw new Error("QA SAFETY STOP: FF_QA_APP_ROOT must not be a filesystem root.");
  }
  return resolved;
}

function autIdentity() {
  const explicit = String(process.env.FF_QA_AUT_ID || "").trim();
  if (explicit) return explicit;
  return CHECKPOINT_SHA;
}

function targetLabel() {
  return String(process.env.FF_QA_TARGET_LABEL || "").trim();
}

function targetDirty() {
  return String(process.env.FF_QA_TARGET_DIRTY || "") === "1";
}

function loadOptionalEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eq = trimmed.indexOf("=");
    if (eq < 1) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = value;
    }
  });
}

function loadQaEnv() {
  loadOptionalEnvFile(path.join(QA_ROOT, "fixtures", "staging.env"));
}

function isProductionHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host) return false;
  return PRODUCTION_HOST_MARKERS.some((marker) => host === marker || host.endsWith("." + marker) || host.includes(marker));
}

function assertSafeOrigin(originUrl) {
  let parsed;
  try {
    parsed = new URL(originUrl);
  } catch (err) {
    throw new Error("QA SAFETY STOP: FF_BASE_URL is not a valid URL: " + originUrl);
  }

  if (isProductionHost(parsed.hostname)) {
    throw new Error(
      "QA SAFETY STOP: Refusing production host " +
        parsed.hostname +
        ". Booking browser QA may use local hosting + fair-flow-staging only."
    );
  }

  const local =
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "localhost";
  const stagingHost =
    parsed.hostname === "fair-flow-staging.web.app" ||
    parsed.hostname === "fair-flow-staging.firebaseapp.com";

  if (!local && !stagingHost) {
    throw new Error(
      "QA SAFETY STOP: Unsupported QA host " +
        parsed.hostname +
        ". Use 127.0.0.1 with ?env=staging (this batch) or an explicit fair-flow-staging host."
    );
  }

  return parsed;
}

function appOrigin() {
  loadQaEnv();
  const raw = String(process.env.FF_BASE_URL || STAGING_APP_ORIGIN).trim() || STAGING_APP_ORIGIN;
  const parsed = assertSafeOrigin(raw);
  const local =
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "localhost";
  if (local) {
    return assertSafeOrigin(STAGING_APP_ORIGIN);
  }
  return parsed;
}

function appUrl() {
  const parsed = appOrigin();
  parsed.searchParams.set("env", "staging");
  return parsed.toString();
}

function requireStagingCredentials() {
  loadQaEnv();
  const email = String(process.env.FF_STAGING_EMAIL || "").trim();
  const password = String(process.env.FF_STAGING_PASSWORD || "");
  if (!email || !password) {
    throw new Error(
      "QA SETUP: FF_STAGING_EMAIL and FF_STAGING_PASSWORD are required for authenticated Booking smoke tests. " +
        "Copy qa/fixtures/staging.env.example to qa/fixtures/staging.env (gitignored) or export the variables. " +
        "Do not use production credentials. Tests will not skip and will not try another Firebase project."
    );
  }
  return { email, password };
}

function safetyError(projectId, extra) {
  const seen = projectId == null || projectId === "" ? "(missing)" : String(projectId);
  return (
    "QA SAFETY STOP: This test attempted to use a non-staging Firebase environment. " +
    "Required projectId is fair-flow-staging. Observed projectId is " +
    seen +
    ". Refusing to log in or continue. " +
    (extra || "")
  );
}

module.exports = {
  CHECKPOINT_SHA,
  REQUIRED_PROJECT_ID,
  DEFAULT_ORIGIN,
  STAGING_APP_ORIGIN,
  QA_ROOT,
  REPO_ROOT,
  appRoot,
  autIdentity,
  targetLabel,
  targetDirty,
  loadQaEnv,
  appUrl,
  appOrigin,
  requireStagingCredentials,
  safetyError,
  isProductionHost,
};
