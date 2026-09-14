"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REQUIRED_PROJECT = "fair-flow-staging";
const FORBIDDEN_PROJECTS = ["fairflowapp-db841"];
const SALON_ID = "ffBookingQa";

function abort(message) {
  throw new Error("QA SAFETY STOP: " + message);
}

function assertNoForbiddenEnv() {
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    abort("Emulator environment variables are set. Staging Admin work must not use an emulator.");
  }
  const hinted = String(process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "");
  if (FORBIDDEN_PROJECTS.indexOf(hinted) !== -1) {
    abort("Environment points at production project " + hinted + ".");
  }
}

function loadAdminSdk(repoRoot) {
  const candidates = [
    path.join(repoRoot, "functions", "node_modules", "firebase-admin"),
    path.join(os.tmpdir(), "ff-booking-qa-admin", "node_modules", "firebase-admin"),
  ];
  for (const dir of candidates) {
    try {
      return require(dir);
    } catch (_) {}
  }
  const tmp = path.join(os.tmpdir(), "ff-booking-qa-admin");
  fs.mkdirSync(tmp, { recursive: true });
  if (!fs.existsSync(path.join(tmp, "package.json"))) {
    fs.writeFileSync(tmp + "/package.json", JSON.stringify({ name: "ff-booking-qa-admin", private: true }, null, 2));
  }
  const install = spawnSync("npm", ["install", "firebase-admin@^13.6.0", "--no-fund", "--no-audit"], {
    cwd: tmp,
    encoding: "utf8",
  });
  if (install.status !== 0) {
    abort("Could not install firebase-admin. " + (install.stderr || install.stdout || ""));
  }
  return require(path.join(tmp, "node_modules", "firebase-admin"));
}

function firebaseCliOauth() {
  const apiPath = "/usr/local/lib/node_modules/firebase-tools/lib/api.js";
  if (!fs.existsSync(apiPath)) {
    abort("Firebase CLI package not found. Run `firebase login` for fair-flow-staging.");
  }
  const api = require(apiPath);
  return {
    client_id: api.clientId(),
    client_secret: api.clientSecret(),
  };
}

function prepareAdc() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    return;
  }
  const cfgPath = path.join(os.homedir(), ".config", "configstore", "firebase-tools.json");
  if (!fs.existsSync(cfgPath)) {
    abort("No Firebase CLI login found. Run `firebase login`, then retry.");
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const tokens = cfg.tokens || {};
  if (!tokens.refresh_token) {
    abort("firebase-tools.json has no refresh_token. Run `firebase login --reauth`.");
  }
  const oauth = firebaseCliOauth();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ff-qa-adc-"));
  const adc = path.join(tmp, "adc.json");
  fs.writeFileSync(adc, JSON.stringify({
    type: "authorized_user",
    client_id: oauth.client_id,
    client_secret: oauth.client_secret,
    refresh_token: tokens.refresh_token,
  }));
  process.env.GOOGLE_APPLICATION_CREDENTIALS = adc;
}

async function assertStagingProject(admin) {
  const projectId = admin.app().options.projectId;
  if (projectId !== REQUIRED_PROJECT) {
    abort("Firebase Admin projectId is " + JSON.stringify(projectId) + ", not fair-flow-staging.");
  }
  const db = admin.firestore();
  const formatted = typeof db.formattedName === "string" ? db.formattedName : "";
  if (formatted && formatted.indexOf("projects/" + REQUIRED_PROJECT + "/") === -1) {
    abort("Firestore client is not bound to fair-flow-staging: " + formatted);
  }
  const probe = await db.doc("salons/" + SALON_ID).get();
  if (probe.readTime == null && probe.exists !== true && probe.exists !== false) {
    abort("Could not confirm a Firestore read against fair-flow-staging.");
  }
  return { projectId, salonExists: probe.exists };
}

async function openStagingAdmin(repoRoot) {
  assertNoForbiddenEnv();
  process.env.GCLOUD_PROJECT = REQUIRED_PROJECT;
  process.env.GOOGLE_CLOUD_PROJECT = REQUIRED_PROJECT;
  prepareAdc();
  const admin = loadAdminSdk(repoRoot);
  if (admin.apps.length) {
    const existing = admin.app();
    if (existing.options.projectId !== REQUIRED_PROJECT) {
      abort("A Firebase Admin app is already initialized for " + existing.options.projectId + ".");
    }
    await assertStagingProject(admin);
    return { admin, db: admin.firestore() };
  }
  admin.initializeApp({
    projectId: REQUIRED_PROJECT,
    credential: admin.credential.applicationDefault(),
  });
  await assertStagingProject(admin);
  return { admin, db: admin.firestore() };
}

function assertQaSalonPath(docPath) {
  const p = String(docPath || "");
  if (!p.startsWith("salons/" + SALON_ID + "/")) {
    abort("Refusing path outside salons/" + SALON_ID + ": " + p);
  }
}

module.exports = {
  REQUIRED_PROJECT,
  SALON_ID,
  abort,
  openStagingAdmin,
  assertQaSalonPath,
};
