/**
 * Phase 18F isolated Functions deployment-bundle smoke test.
 * Stages only what firebase.json functions.source packages, then loads
 * executeBookingMutation without the repository public/ tree.
 *
 * Usage: node scripts/test-booking-smart-scheduling-functions-bundle.js
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const functionsDir = path.join(root, "functions");
const repoPublic = path.resolve(root, "public");

const {
  syncRuntime,
  verifyRuntimeMatchesSources
} = require("../functions/booking-smart-scheduling/build-runtime");

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

function ignoredByFirebase(rel) {
  if (!rel || rel === ".") return false;
  const parts = rel.split(path.sep);
  if (parts[0] === "node_modules" || parts[0] === ".git") return true;
  const base = parts[parts.length - 1];
  if (base === "firebase-debug.log") return true;
  if (/^firebase-debug\..+\.log$/.test(base)) return true;
  if (base.endsWith(".local")) return true;
  return false;
}

function copyFunctionsSource(dest) {
  fs.cpSync(functionsDir, dest, {
    recursive: true,
    filter: function (src) {
      const rel = path.relative(functionsDir, src);
      return !ignoredByFirebase(rel);
    }
  });
}

const SMOKE = [
  "\"use strict\";",
  "const fs = require(\"fs\");",
  "const path = require(\"path\");",
  "const repoPublic = process.env.REAL_REPO_PUBLIC;",
  "const origRead = fs.readFileSync;",
  "fs.readFileSync = function (p, enc) {",
  "  const abs = path.resolve(String(p));",
  "  if (repoPublic && (abs === repoPublic || abs.indexOf(repoPublic + path.sep) === 0)) {",
  "    throw new Error(\"ISOLATED_BUNDLE_REACHED_REPO_PUBLIC: \" + abs);",
  "  }",
  "  return origRead.call(fs, p, enc);",
  "};",
  "const callable = require(\"./booking-smart-scheduling/callable\");",
  "const loader = require(\"./booking-smart-scheduling/load-smart-scheduling-api\");",
  "const resolver = require(\"./booking-smart-scheduling/availability-resolver\");",
  "const executor = require(\"./booking-smart-scheduling/firestore-atomic-executor\");",
  "const handler = require(\"./booking-smart-scheduling/execute-booking-mutation\");",
  "if (loader.REPO_ROOT) throw new Error(\"REPO_ROOT must not be exported from the API loader\");",
  "if (typeof handler.handleExecuteBookingMutation !== \"function\") throw new Error(\"handler missing\");",
  "if (typeof callable.handleExecuteBookingMutation !== \"function\") throw new Error(\"callable handler missing\");",
  "if (!callable.executeBookingMutation) throw new Error(\"executeBookingMutation export missing\");",
  "const api = loader.loadSmartSchedulingApi();",
  "if (typeof api.prepareOfferAcceptance !== \"function\") throw new Error(\"Phase 17 API missing\");",
  "if (typeof api.acceptanceFingerprintForCommand !== \"function\") throw new Error(\"fingerprint missing\");",
  "if (typeof api.adaptAcceptanceCommandToBookingCreateInput !== \"function\") throw new Error(\"Phase 18B adapter missing\");",
  "if (typeof api.evaluateAtomicMutation !== \"function\") throw new Error(\"atomic evaluator missing\");",
  "if (typeof api.buildSmartSchedulingAtomicCreateMutation !== \"function\") throw new Error(\"SS create builder missing\");",
  "if (!api.bookingAppointmentModel || typeof api.bookingAppointmentModel.isProviderCapable !== \"function\") {",
  "  throw new Error(\"booking model missing\");",
  "}",
  "if (typeof executor.createFirestoreAtomicExecutor !== \"function\") throw new Error(\"executor missing\");",
  "const engine = resolver.loadAvailabilityEngine({ preferences: { salonTimeZone: \"America/New_York\" } });",
  "if (typeof engine.resolveEffectiveProviderAvailability !== \"function\") throw new Error(\"availability engine missing\");",
  "const derived = resolver.deriveProviderAvailability({",
  "  settings: {",
  "    preferences: { salonTimeZone: \"America/New_York\" },",
  "    locationSchedules: {",
  "      locA: {",
  "        businessHours: {",
  "          monday: { isOpen: true, openTime: \"10:00\", closeTime: \"20:30\" }",
  "        }",
  "      }",
  "    }",
  "  },",
  "  staff: {",
  "    id: \"maria\",",
  "    staffId: \"maria\",",
  "    defaultSchedule: {",
  "      monday: { enabled: true, startTime: \"12:00\", endTime: \"18:00\" }",
  "    }",
  "  },",
  "  requests: [],",
  "  locationId: \"locA\",",
  "  dateKey: \"2026-09-14\",",
  "  providerId: \"maria\"",
  "});",
  "if (!derived.workingIntervals[0] || derived.workingIntervals[0].startMin !== 12 * 60) {",
  "  throw new Error(\"availability resolver parity failed: \" + JSON.stringify(derived));",
  "}",
  "const parentPublic = path.resolve(process.cwd(), \"../public/booking/availability.js\");",
  "if (fs.existsSync(parentPublic)) throw new Error(\"isolated bundle has parent public/: \" + parentPublic);",
  "console.log(JSON.stringify({ ok: true, startMin: derived.workingIntervals[0].startMin }));"
].join("\n");

function main() {
  const generated = syncRuntime();
  verifyRuntimeMatchesSources();
  check("runtime built from public/ sources", generated.files.length >= 26, generated.files.length);
  check("runtime hashes match current public/ sources", true);

  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ff-18f-fn-bundle-"));
  const isolated = isolatedRoot;
  try {
    copyFunctionsSource(isolated);
    check("isolated copy has generated runtime", fs.existsSync(path.join(
      isolated,
      "booking-smart-scheduling/runtime/public/booking/availability.js"
    )));
    const siblingPublic = path.resolve(isolated, "../public");
    check(
      "isolated copy is not the repo functions/ tree",
      path.resolve(isolated) !== path.resolve(functionsDir)
    );
    check(
      "isolated sibling public/ is not repo public/",
      siblingPublic !== repoPublic
    );
    check(
      "old ../../public walk from callable dir does not exist",
      !fs.existsSync(path.join(isolated, "booking-smart-scheduling", "..", "..", "public", "booking", "availability.js"))
    );

    const install = spawnSync("npm", ["ci", "--omit=dev"], {
      cwd: isolated,
      encoding: "utf8",
      env: Object.assign({}, process.env, { npm_config_update_notifier: "false" })
    });
    if (install.status !== 0) {
      console.log(install.stdout || "");
      console.log(install.stderr || "");
      check("isolated npm ci --omit=dev", false, install.status);
      return;
    }
    check("isolated npm ci --omit=dev", true);

    fs.writeFileSync(path.join(isolated, "_18f_bundle_smoke.js"), SMOKE);
    const smoke = spawnSync(process.execPath, ["_18f_bundle_smoke.js"], {
      cwd: isolated,
      encoding: "utf8",
      env: Object.assign({}, process.env, {
        REAL_REPO_PUBLIC: repoPublic,
        GCLOUD_PROJECT: "fair-flow-smart-scheduling-emulator",
        GOOGLE_CLOUD_PROJECT: "fair-flow-smart-scheduling-emulator",
        FUNCTIONS_EMULATOR: "true",
        FIREBASE_CONFIG: JSON.stringify({
          projectId: "fair-flow-smart-scheduling-emulator"
        })
      })
    });
    if (smoke.status !== 0) {
      console.log(smoke.stdout || "");
      console.log(smoke.stderr || "");
      check("isolated smoke process", false, smoke.status);
      return;
    }
    let payload = null;
    try {
      payload = JSON.parse(String(smoke.stdout || "").trim().split("\n").pop());
    } catch (err) {
      payload = null;
    }
    check("isolated smoke loaded callable + APIs", payload && payload.ok === true, smoke.stdout);
    check("isolated availability resolver still 12:00 start", payload && payload.startMin === 12 * 60, payload);
    check("isolated smoke did not reach repo public/", String(smoke.stderr || "").indexOf("ISOLATED_BUNDLE_REACHED_REPO_PUBLIC") === -1);
  } finally {
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  }

  if (failed) {
    console.error(failed + " Functions bundle checks failed.");
    process.exit(1);
  }
  console.log("All Phase 18F isolated Functions bundle checks passed.");
}

main();
