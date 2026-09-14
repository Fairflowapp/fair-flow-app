"use strict";

/**
 * Create/update the isolated Booking QA salon + Auth user on fair-flow-staging.
 * Never targets production. Does not print the password.
 *
 * Usage: node qa/scripts/setup-staging-qa-fixture.js
 */
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REQUIRED_PROJECT = "fair-flow-staging";
const FORBIDDEN_PROJECTS = ["fairflowapp-db841"];
const QA_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(QA_ROOT, "..");
const ENV_PATH = path.join(QA_ROOT, "fixtures", "staging.env");
const MANIFEST_PATH = path.join(QA_ROOT, "baselines", "staging-qa-fixture.json");

const EMAIL = "ff-booking-qa@fair-flow-staging.test";
const UID = "ff-booking-qa-user";
const SALON_ID = "ffBookingQa";
const LOCATION_ID = "qaLoc1";
const PROVIDER_ID = "qaProv1";
const MANAGER_STAFF_ID = "qaManager1";
const TECH_TYPE_ID = "qa-manicure";

function abort(message) {
  console.error("ABORT:", message);
  process.exit(1);
}

function weekHours() {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const out = {};
  days.forEach((day) => {
    out[day] = { isOpen: true, openTime: "09:00", closeTime: "18:00" };
  });
  return out;
}

function weekSchedule() {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const out = {};
  days.forEach((day) => {
    out[day] = { enabled: true, startTime: "09:00", endTime: "18:00" };
  });
  return out;
}

function readEnvFile(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  fs.readFileSync(filePath, "utf8").split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eq = trimmed.indexOf("=");
    if (eq < 1) return;
    values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  });
  return values;
}

function writeStagingEnv(email, password) {
  const existing = readEnvFile(ENV_PATH);
  const lines = [
    "# Local Booking QA credentials. Gitignored. Staging only.",
    "FF_STAGING_EMAIL=" + email,
    "FF_STAGING_PASSWORD=" + password,
    "FF_BASE_URL=" + (existing.FF_BASE_URL || "http://127.0.0.1:4173"),
  ];
  fs.writeFileSync(ENV_PATH, lines.join("\n") + "\n", { mode: 0o600 });
}

function generatePassword() {
  return "Qa!" + crypto.randomBytes(18).toString("base64url");
}

function loadAdminSdk() {
  const candidates = [
    path.join(REPO_ROOT, "functions", "node_modules", "firebase-admin"),
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
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "ff-booking-qa-admin", private: true }, null, 2));
  }
  const install = spawnSync("npm", ["install", "firebase-admin@^13.6.0", "--no-fund", "--no-audit"], {
    cwd: tmp,
    encoding: "utf8",
  });
  if (install.status !== 0) {
    abort("Could not install firebase-admin for the QA setup script. " + (install.stderr || install.stdout || ""));
  }
  return require(path.join(tmp, "node_modules", "firebase-admin"));
}

function firebaseCliOauth() {
  const apiPath = "/usr/local/lib/node_modules/firebase-tools/lib/api.js";
  if (!fs.existsSync(apiPath)) {
    abort(
      "Firebase CLI package not found at " + apiPath +
        ". Need a valid `firebase login` for fair-flow-staging. Not inventing credentials."
    );
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
    abort("No Firebase CLI login found at ~/.config/configstore/firebase-tools.json. Run `firebase login`, then retry. No production fallback.");
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const tokens = cfg.tokens || {};
  if (!tokens.refresh_token) {
    abort("firebase-tools.json has no refresh_token. Run `firebase login --reauth`, then retry.");
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

function assertNoForbiddenEnv() {
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    abort("Emulator environment variables are set. This fixture must write to fair-flow-staging, not an emulator.");
  }
  const hinted = String(process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "");
  if (FORBIDDEN_PROJECTS.indexOf(hinted) !== -1) {
    abort("Environment points at production project " + hinted + ". Refusing to continue.");
  }
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
  // Live read against the staging project URL before any write.
  const probe = await db.doc("salons/" + SALON_ID).get();
  if (probe.readTime == null && probe.exists !== true && probe.exists !== false) {
    abort("Could not confirm a Firestore read against fair-flow-staging.");
  }
  console.log("Verified Firebase project:", projectId, "salon probe exists=", probe.exists);
}

async function ensureAuthUser(admin, password) {
  try {
    await admin.auth().updateUser(UID, {
      email: EMAIL,
      password,
      displayName: "FF Booking QA",
      disabled: false,
      emailVerified: true,
    });
    console.log("Updated staging Auth user", EMAIL);
  } catch (err) {
    if (err && err.code === "auth/user-not-found") {
      await admin.auth().createUser({
        uid: UID,
        email: EMAIL,
        password,
        displayName: "FF Booking QA",
        disabled: false,
        emailVerified: true,
      });
      console.log("Created staging Auth user", EMAIL);
      return;
    }
    if (err && err.code === "auth/email-already-exists") {
      const existing = await admin.auth().getUserByEmail(EMAIL);
      if (existing.uid !== UID) {
        abort("Auth email exists on a different uid (" + existing.uid + "). Not altering that user.");
      }
      await admin.auth().updateUser(UID, { password, disabled: false, emailVerified: true });
      console.log("Updated existing staging Auth user", EMAIL);
      return;
    }
    throw err;
  }
}

async function main() {
  assertNoForbiddenEnv();
  process.env.GCLOUD_PROJECT = REQUIRED_PROJECT;
  process.env.GOOGLE_CLOUD_PROJECT = REQUIRED_PROJECT;
  prepareAdc();

  const admin = loadAdminSdk();
  if (admin.apps.length) {
    abort("A Firebase Admin app was already initialized. Refusing to reuse an ambiguous app.");
  }
  admin.initializeApp({
    projectId: REQUIRED_PROJECT,
    credential: admin.credential.applicationDefault(),
  });
  await assertStagingProject(admin);

  const existingEnv = readEnvFile(ENV_PATH);
  const password = existingEnv.FF_STAGING_PASSWORD || generatePassword();
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  await ensureAuthUser(admin, password);

  const created = [];
  async function setDoc(docPath, data) {
    await db.doc(docPath).set(data, { merge: true });
    created.push(docPath);
  }

  await setDoc("salons/" + SALON_ID, {
    name: "FF Booking QA Salon",
    email: EMAIL,
    ownerUid: UID,
    timezone: "America/New_York",
    accountStatus: "active",
    isQaSalon: true,
    isTestSalon: true,
    updatedAt: now,
  });

  await setDoc("salons/" + SALON_ID + "/settings/main", {
    ownerUid: UID,
    preferences: { salonTimeZone: "America/New_York" },
    locationPreferences: {
      [LOCATION_ID]: { salonTimeZone: "America/New_York" },
    },
    locationSchedules: {
      [LOCATION_ID]: { businessHours: weekHours() },
    },
    updatedAt: now,
  });

  await setDoc("salons/" + SALON_ID + "/locations/" + LOCATION_ID, {
    name: "QA Location One",
    address: "QA fixture — do not use for human work",
    isActive: true,
    isQaLocation: true,
    lat: null,
    lng: null,
    updatedAt: now,
  });

  await setDoc("salons/" + SALON_ID + "/technicianTypes/" + TECH_TYPE_ID, {
    name: "QA Manicure",
    active: true,
    isQaType: true,
    updatedAt: now,
  });

  await setDoc("salons/" + SALON_ID + "/staff/" + MANAGER_STAFF_ID, {
    name: "QA Manager",
    role: "manager",
    isManager: true,
    uid: UID,
    firebaseUid: UID,
    email: EMAIL,
    allowedLocationIds: [LOCATION_ID],
    primaryLocationId: LOCATION_ID,
    active: true,
    isArchived: false,
    isQaStaff: true,
    defaultSchedule: weekSchedule(),
    updatedAt: now,
  });

  await setDoc("salons/" + SALON_ID + "/staff/" + PROVIDER_ID, {
    name: "QA Provider",
    role: "technician",
    technicianTypes: [TECH_TYPE_ID],
    allowedLocationIds: [LOCATION_ID],
    primaryLocationId: LOCATION_ID,
    active: true,
    isArchived: false,
    isQaStaff: true,
    defaultSchedule: weekSchedule(),
    updatedAt: now,
  });

  await setDoc("salons/" + SALON_ID + "/members/" + UID, {
    name: "QA Manager",
    role: "manager",
    staffId: MANAGER_STAFF_ID,
    email: EMAIL,
    updatedAt: now,
  });

  await setDoc("users/" + UID, {
    email: EMAIL,
    emailLower: EMAIL.toLowerCase(),
    name: "QA Manager",
    role: "manager",
    salonId: SALON_ID,
    staffId: MANAGER_STAFF_ID,
    isQaUser: true,
    isTestUser: true,
    updatedAt: now,
  });

  await setDoc("users/" + UID + "/memberships/" + SALON_ID, {
    salonId: SALON_ID,
    salonName: "FF Booking QA Salon",
    staffId: MANAGER_STAFF_ID,
    role: "manager",
    status: "active",
    email: EMAIL,
    name: "QA Manager",
    updatedAt: now,
  });

  writeStagingEnv(EMAIL, password);
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify({
    projectId: REQUIRED_PROJECT,
    email: EMAIL,
    uid: UID,
    salonId: SALON_ID,
    locationId: LOCATION_ID,
    providerId: PROVIDER_ID,
    managerStaffId: MANAGER_STAFF_ID,
    documents: created,
    createdAt: new Date().toISOString(),
    note: "Password is only in qa/fixtures/staging.env (gitignored).",
  }, null, 2) + "\n");

  console.log("Wrote local staging.env (gitignored) and fixture manifest.");
  console.log("QA email:", EMAIL);
  console.log("QA salon:", SALON_ID);
  console.log("Documents upserted:", created.length);
}

main().catch((err) => {
  const text = String(err && (err.details || err.message || err));
  if (/invalid_rapt|invalid_grant|credentials are no longer valid/i.test(text)) {
    console.error("ABORT: Firebase/Google credentials need interactive reauth before any staging write.");
    console.error("Run: firebase login --reauth");
    console.error("Then: node qa/scripts/setup-staging-qa-fixture.js");
    console.error("No Auth user or salon documents were created. No production fallback.");
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
