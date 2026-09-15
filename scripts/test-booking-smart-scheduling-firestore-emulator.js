/**
 * Smart Scheduling Phase 18E Firestore Emulator atomic booking suite.
 * Requires a live Firestore Emulator. Never falls back to staging/production.
 * Usage: node scripts/test-booking-smart-scheduling-firestore-emulator.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const root = path.resolve(__dirname, "..");
const executorLib = require("./lib/booking-smart-scheduling-firestore-atomic-executor");

const TEST_PROJECT = executorLib.TEST_PROJECT_ID;
const FORBIDDEN = executorLib.FORBIDDEN_PROJECTS;
const EMULATOR_HOST = "127.0.0.1";
const EMULATOR_PORT = 18080;

function load(rel, windowObj) {
  new Function("window", fs.readFileSync(path.join(root, rel), "utf8"))(windowObj);
}

const windowObj = {
  settings: { preferences: { salonTimeZone: "America/New_York" } }
};
load("public/booking/calendar-time.js", windowObj);
load("public/booking/appointments/model.js", windowObj);
[
  "public/booking/smart-scheduling/normalize.js",
  "public/booking/smart-scheduling/gaps.js",
  "public/booking/smart-scheduling/candidates.js",
  "public/booking/smart-scheduling/score.js",
  "public/booking/smart-scheduling/engine.js",
  "public/booking/smart-scheduling/moves.js",
  "public/booking/smart-scheduling/day-analysis.js",
  "public/booking/smart-scheduling/priorities.js",
  "public/booking/smart-scheduling/assign.js",
  "public/booking/smart-scheduling/cancellation-recovery.js",
  "public/booking/smart-scheduling/waitlist.js",
  "public/booking/smart-scheduling/recovery-planner.js",
  "public/booking/smart-scheduling/gap-planner.js",
  "public/booking/smart-scheduling/global-plan.js",
  "public/booking/smart-scheduling/salon-plan.js",
  "public/booking/smart-scheduling/multi-service.js",
  "public/booking/smart-scheduling/parallel-multi-service.js",
  "public/booking/smart-scheduling/resource-aware-multi-service.js",
  "public/booking/smart-scheduling/flexible-visit.js",
  "public/booking/smart-scheduling/client-offers.js",
  "public/booking/smart-scheduling/offer-revalidation.js",
  "public/booking/smart-scheduling/offer-acceptance.js",
  "public/booking/smart-scheduling/booking-execution-adapter.js",
  "public/booking/smart-scheduling/atomic-booking-simulator.js"
].forEach(function (rel) { load(rel, windowObj); });

const api = windowObj.ffBookingSmartScheduling;
if (!api || typeof api.evaluateAtomicMutation !== "function") {
  console.error("Phase 18D evaluateAtomicMutation is required.");
  process.exit(1);
}

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

check("refuses production project", (function () {
  try {
    executorLib.assertEmulatorIsolation("fairflowapp-db841", "127.0.0.1:8080");
    return false;
  } catch (err) {
    return err.code === "real_project_forbidden";
  }
})());
check("refuses staging project", (function () {
  try {
    executorLib.assertEmulatorIsolation("fair-flow-staging", "127.0.0.1:8080");
    return false;
  } catch (err) {
    return err.code === "real_project_forbidden";
  }
})());
check("refuses writes without emulator host", (function () {
  try {
    executorLib.assertEmulatorIsolation(TEST_PROJECT, "");
    return false;
  } catch (err) {
    return err.code === "emulator_required";
  }
})());
check("accepts emulator test project", (function () {
  try {
    executorLib.assertEmulatorIsolation(TEST_PROJECT, "127.0.0.1:8080");
    return true;
  } catch (err) {
    return false;
  }
})());

const TWO = 14 * 60;
function working(providerId) {
  const map = {};
  map[providerId] = {
    locationId: "locA",
    dateKey: "2026-09-14",
    workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }]
  };
  return map;
}
function line(lineId, providerId, startMin, endMin, extra) {
  return Object.assign({
    lineId: lineId,
    serviceId: extra && extra.serviceId || "svc-gel",
    providerId: providerId,
    startMin: startMin,
    endMin: endMin,
    durationMinutes: endMin - startMin
  }, extra || {});
}
function providerRes(lineId, providerId, startMin, endMin) {
  return {
    providerId: providerId,
    lineId: lineId,
    startMin: startMin,
    endMin: endMin,
    locationId: "locA",
    dateKey: "2026-09-14"
  };
}
function resourceRes(lineId, resourceId, startMin, endMin, extra) {
  return Object.assign({
    resourceId: resourceId,
    lineId: lineId,
    requirementKey: extra && extra.requirementKey || "chair",
    reservationStartMin: startMin,
    reservationEndMin: endMin,
    locationId: "locA",
    dateKey: "2026-09-14"
  }, extra || {});
}
function chairDef(resourceId) {
  return {
    resourceId: resourceId,
    locationId: "locA",
    resourceType: resourceId === "room-a" ? "massage_room" : "pedicure_chair",
    active: true,
    workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }]
  };
}
function createMut(salonId, id, lines, extras) {
  const providerReservations = (lines || []).map(function (row) {
    return providerRes(row.lineId, row.providerId, row.startMin, row.endMin);
  });
  return api.sealAtomicMutation(Object.assign({
    mutationType: "create",
    mutationId: id,
    salonId: salonId,
    candidateAppointmentId: "appt_" + id,
    locationId: "locA",
    dateKey: "2026-09-14",
    availabilityVersions: [{ locationId: "locA", version: extras && extras.epochVersion != null ? extras.epochVersion : 1 }],
    appointmentPayload: {
      clientId: "client-1",
      locationId: "locA",
      dateKey: "2026-09-14",
      status: "scheduled",
      serviceLines: lines
    },
    providerReservations: providerReservations,
    resourceReservations: extras && extras.resourceReservations || [],
    providerAvailability: Object.assign({}, working("maria"), working("ana"))
  }, extras || {}));
}

function canConnect(host, port) {
  return new Promise(function (resolve) {
    const req = require("http").get({ host: host, port: port, path: "/", timeout: 800 }, function (res) {
      let body = "";
      res.on("data", function (chunk) { body += chunk; if (body.length > 200) res.destroy(); });
      res.on("end", function () {
        resolve(/ok|firestore|emulator/i.test(body) && body.indexOf("<html") === -1);
      });
    });
    req.on("timeout", function () { req.destroy(); resolve(false); });
    req.on("error", function () { resolve(false); });
  });
}

function waitFor(fn, timeoutMs) {
  const start = Date.now();
  return (function loop() {
    return fn().then(function (ok) {
      if (ok) return true;
      if (Date.now() - start > timeoutMs) return false;
      return new Promise(function (resolve) { setTimeout(resolve, 250); }).then(loop);
    });
  }());
}

function findJavaHome(dir) {
  if (!dir || !fs.existsSync(dir)) return "";
  if (fs.existsSync(path.join(dir, "bin", "java"))) return dir;
  const macHome = path.join(dir, "Contents", "Home");
  if (fs.existsSync(path.join(macHome, "bin", "java"))) return macHome;
  let found = "";
  fs.readdirSync(dir).some(function (name) {
    const next = path.join(dir, name);
    if (!fs.statSync(next).isDirectory()) return false;
    found = findJavaHome(next);
    return !!found;
  });
  return found;
}

function resolveJavaHome() {
  if (process.env.JAVA_HOME && fs.existsSync(path.join(process.env.JAVA_HOME, "bin", "java"))) {
    return process.env.JAVA_HOME;
  }
  return findJavaHome(path.join(root, ".local", "temurin-jre"));
}

async function ensureJava() {
  const existing = resolveJavaHome();
  if (existing) return existing;
  const dest = path.join(root, ".local", "temurin-jre");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const url = "https://api.adoptium.net/v3/binary/latest/21/ga/mac/aarch64/jre/hotspot/normal/eclipse?project=jdk";
  const tar = path.join(root, ".local", "temurin-jre.tgz");
  console.log("Downloading Temurin JRE for Firestore emulator...");
  await new Promise(function (resolve, reject) {
    const child = spawn("curl", ["-L", "--fail", "-o", tar, url], { stdio: "inherit" });
    child.on("exit", function (code) { code === 0 ? resolve() : reject(new Error("curl JRE failed")); });
  });
  fs.mkdirSync(dest, { recursive: true });
  await new Promise(function (resolve, reject) {
    const child = spawn("tar", ["-xzf", tar, "-C", dest, "--strip-components=1"], { stdio: "inherit" });
    child.on("exit", function (code) { code === 0 ? resolve() : reject(new Error("extract JRE failed")); });
  });
  return dest;
}

async function startEmulator(javaHome) {
  const already = await canConnect(EMULATOR_HOST, EMULATOR_PORT);
  if (already) return { child: null, started: false };
  const env = Object.assign({}, process.env, {
    JAVA_HOME: javaHome,
    PATH: path.join(javaHome, "bin") + ":" + process.env.PATH,
    FIRESTORE_EMULATOR_HOST: EMULATOR_HOST + ":" + EMULATOR_PORT
  });
  const child = spawn("firebase", [
    "emulators:start",
    "--only", "firestore",
    "--project", TEST_PROJECT,
    "--config", path.join(root, "firebase.json")
  ], {
    cwd: root,
    env: env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", function (buf) { process.stdout.write(buf); });
  child.stderr.on("data", function (buf) { process.stderr.write(buf); });
  const ready = await waitFor(function () { return canConnect(EMULATOR_HOST, EMULATOR_PORT); }, 60000);
  if (!ready) {
    child.kill();
    throw new Error("Firestore emulator did not start");
  }
  return { child: child, started: true };
}

async function main() {
  if (FORBIDDEN.indexOf(TEST_PROJECT) !== -1) {
    console.error("Test project id is a real project. Refusing.");
    process.exit(2);
  }

  let emulator;
  try {
    const javaHome = await ensureJava();
    if (!fs.existsSync(path.join(javaHome, "bin", "java"))) {
      throw new Error("Java runtime missing; Firestore emulator cannot start. Refusing writes.");
    }
    emulator = await startEmulator(javaHome);
  } catch (err) {
    console.error("FIRESTORE EMULATOR REQUIRED. Refusing writes.", err.message);
    process.exit(2);
  }

  process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST + ":" + EMULATOR_PORT;
  process.env.GCLOUD_PROJECT = TEST_PROJECT;
  process.env.GOOGLE_CLOUD_PROJECT = TEST_PROJECT;

  const adminPath = path.join(root, "scripts/lib/booking-smart-scheduling-emulator/node_modules/firebase-admin");
  if (!fs.existsSync(adminPath)) {
    console.error("firebase-admin missing. Run npm install in scripts/lib/booking-smart-scheduling-emulator. Refusing writes.");
    if (emulator && emulator.child) emulator.child.kill();
    process.exit(2);
  }
  const admin = require(adminPath);
  if (admin.apps.length) await admin.app().delete();
  const app = admin.initializeApp({ projectId: TEST_PROJECT });
  const db = admin.firestore();
  const ex = executorLib.createFirestoreAtomicExecutor({
    admin: admin,
    api: api,
    db: db,
    projectId: TEST_PROJECT,
    emulatorHost: process.env.FIRESTORE_EMULATOR_HOST
  });

  function salon(name) {
    return "ss-emulator-" + name;
  }

  async function seed(name, extra) {
    const salonId = salon(name);
    await ex.deleteSalonTree(salonId);
    await ex.seedGuardedSalon(salonId, Object.assign({
      resourceSystemReady: true,
      resourceEnforcementStartDateKey: "2026-09-01",
      resourceDefinitions: {
        "chair-1": chairDef("chair-1"),
        "chair-2": chairDef("chair-2"),
        "room-a": chairDef("room-a")
      }
    }, extra || {}));
    return salonId;
  }

  try {
    const sCreate = await seed("create");
    const created = await ex.executeAtomicMutation(createMut(sCreate, "c1", [line("gel", "maria", TWO, TWO + 45)]));
    check("CREATE succeeds", created.status === "created" && created.appointmentRevision === 1 && created.appointmentId === "appt_c1");
    const createdDoc = await ex.refsFor(sCreate).appointments.doc("appt_c1").get();
    check("CREATE wrote appointment", createdDoc.exists && createdDoc.data().status === "scheduled" && createdDoc.data().revision === 1);
    const mariaKey = api.providerDayGuardKey("locA", "2026-09-14", "maria");
    const mariaGuard = await ex.refsFor(sCreate).providerDays.doc(mariaKey).get();
    check("CREATE wrote provider guard", mariaGuard.exists && mariaGuard.data().occupancies.length === 1 && mariaGuard.data().revision === 1);
    const mutDoc = await ex.refsFor(sCreate).mutations.doc(created.storageKey).get();
    check("CREATE wrote SHA-256 mutation doc", mutDoc.exists && mutDoc.data().storageKey === created.storageKey && mutDoc.data().mutationIdempotencyKey.indexOf("mutation|") === 0);
    check("storageKey is sha256 hex", /^[a-f0-9]{64}$/.test(created.storageKey));

    const retry = await ex.executeAtomicMutation(createMut(sCreate, "c1", [line("gel", "maria", TWO, TWO + 45)]));
    check("DOUBLE-CLICK sequential already_completed", retry.status === "already_completed" && retry.appointmentId === "appt_c1");
    const mariaAfterRetry = await ex.refsFor(sCreate).providerDays.doc(mariaKey).get();
    check("idempotent retry does not bump guard revision", mariaAfterRetry.data().revision === 1);

    const mismatch = api.sealAtomicMutation(Object.assign(createMut(sCreate, "c1", [line("gel", "ana", TWO, TWO + 45)]), {
      mutationId: "c1",
      mutationIdempotencyKey: createMut(sCreate, "c1", [line("gel", "maria", TWO, TWO + 45)]).mutationIdempotencyKey
    }));
    const mismatchExec = await ex.executeAtomicMutation(mismatch);
    check("SAME KEY DIFFERENT INTENT mismatches", mismatchExec.status === "idempotency_identity_mismatch");
    const apptCount = await ex.refsFor(sCreate).appointments.get();
    check("mismatch never writes a second appointment", apptCount.size === 1);

    const sMove = await seed("move");
    const moveBase = await ex.executeAtomicMutation(createMut(sMove, "m1", [line("gel", "maria", TWO, TWO + 45)]));
    const moved = await ex.executeAtomicMutation(api.sealAtomicMutation({
      mutationType: "update",
      mutationId: "move-1",
      salonId: sMove,
      appointmentId: "appt_m1",
      expectedAppointmentRevision: 1,
      locationId: "locA",
      dateKey: "2026-09-14",
      availabilityVersions: [{ locationId: "locA", version: 1 }],
      appointmentPayload: {
        clientId: "client-1",
        locationId: "locA",
        dateKey: "2026-09-14",
        serviceLines: [line("gel", "ana", TWO + 60, TWO + 105)]
      },
      providerReservations: [providerRes("gel", "ana", TWO + 60, TWO + 105)],
      resourceReservations: [],
      providerAvailability: Object.assign({}, working("maria"), working("ana"))
    }));
    check("UPDATE/MOVE Maria 2:00 to Ana 3:00", moved.status === "updated" && moved.appointmentRevision === 2);
    const afterMoveMaria = await ex.refsFor(sMove).providerDays.doc(mariaKey).get();
    const anaKey = api.providerDayGuardKey("locA", "2026-09-14", "ana");
    const afterMoveAna = await ex.refsFor(sMove).providerDays.doc(anaKey).get();
    check("MOVE swapped occupancy atomically", !afterMoveMaria.data().occupancies.some(function (row) { return row.appointmentId === "appt_m1"; }) && afterMoveAna.data().occupancies.some(function (row) { return row.appointmentId === "appt_m1"; }));

    const failMove = await ex.executeAtomicMutation(api.sealAtomicMutation({
      mutationType: "update",
      mutationId: "move-status",
      salonId: sMove,
      appointmentId: "appt_m1",
      expectedAppointmentRevision: 2,
      locationId: "locA",
      dateKey: "2026-09-14",
      availabilityVersions: [{ locationId: "locA", version: 1 }],
      appointmentPayload: {
        clientId: "client-1",
        locationId: "locA",
        dateKey: "2026-09-14",
        status: "cancelled",
        serviceLines: [line("gel", "ana", TWO + 60, TWO + 105)]
      },
      providerReservations: [providerRes("gel", "ana", TWO + 60, TWO + 105)],
      resourceReservations: [],
      providerAvailability: Object.assign({}, working("maria"), working("ana"))
    }));
    check("UPDATE cannot cancel", failMove.status === "mutation_invalid" && (failMove.reasonCodes || []).indexOf("use_cancel_mutation") !== -1);
    const stillScheduled = await ex.refsFor(sMove).appointments.doc("appt_m1").get();
    check("rejected UPDATE leaves appointment unchanged", stillScheduled.data().status === "scheduled" && stillScheduled.data().revision === 2);

    const clientChange = await ex.executeAtomicMutation(api.sealAtomicMutation({
      mutationType: "update",
      mutationId: "move-client",
      salonId: sMove,
      appointmentId: "appt_m1",
      expectedAppointmentRevision: 2,
      locationId: "locA",
      dateKey: "2026-09-14",
      availabilityVersions: [{ locationId: "locA", version: 1 }],
      appointmentPayload: {
        clientId: "client-2",
        locationId: "locA",
        dateKey: "2026-09-14",
        serviceLines: [line("gel", "ana", TWO + 60, TWO + 105)]
      },
      providerReservations: [providerRes("gel", "ana", TWO + 60, TWO + 105)],
      resourceReservations: [],
      providerAvailability: Object.assign({}, working("maria"), working("ana"))
    }));
    check("UPDATE cannot change clientId", clientChange.status === "mutation_invalid" && (clientChange.reasonCodes || []).indexOf("appointment_identity_change_not_allowed") !== -1);

    const statusOk = await ex.executeAtomicMutation(api.sealAtomicMutation({
      mutationType: "status",
      mutationId: "status-1",
      salonId: sMove,
      appointmentId: "appt_m1",
      expectedAppointmentRevision: 2,
      targetStatus: "confirmed"
    }));
    check("STATUS scheduled -> confirmed", statusOk.status === "status_updated" && statusOk.appointmentRevision === 3);
    const statusCancel = await ex.executeAtomicMutation(api.sealAtomicMutation({
      mutationType: "status",
      mutationId: "status-bad",
      salonId: sMove,
      appointmentId: "appt_m1",
      expectedAppointmentRevision: 3,
      targetStatus: "cancelled"
    }));
    check("STATUS cannot cancel", statusCancel.status === "mutation_invalid" && (statusCancel.reasonCodes || []).indexOf("use_cancel_mutation") !== -1);
    const statusOcc = await ex.executeAtomicMutation(api.sealAtomicMutation({
      mutationType: "status",
      mutationId: "status-occ",
      salonId: sMove,
      appointmentId: "appt_m1",
      expectedAppointmentRevision: 3,
      targetStatus: "completed",
      providerReservations: [providerRes("gel", "ana", TWO + 60, TWO + 105)]
    }));
    check("STATUS cannot carry occupancy", statusOcc.status === "mutation_invalid" && (statusOcc.reasonCodes || []).indexOf("status_mutation_contains_occupancy_change") !== -1);

    const cancelled = await ex.executeAtomicMutation(api.sealAtomicMutation({
      mutationType: "cancel",
      mutationId: "cancel-1",
      salonId: sMove,
      appointmentId: "appt_m1"
    }));
    check("CANCEL removes occupancy", cancelled.status === "cancelled" && cancelled.appointmentRevision === 4);
    const afterCancelAna = await ex.refsFor(sMove).providerDays.doc(anaKey).get();
    check("CANCEL cleared Ana occupancy", afterCancelAna.data().occupancies.length === 0);
    const cancelRetry = await ex.executeAtomicMutation(api.sealAtomicMutation({
      mutationType: "cancel",
      mutationId: "cancel-1",
      salonId: sMove,
      appointmentId: "appt_m1"
    }));
    check("CANCEL retry already_completed", cancelRetry.status === "already_completed");
    const cancelAgain = await ex.executeAtomicMutation(api.sealAtomicMutation({
      mutationType: "cancel",
      mutationId: "cancel-2",
      salonId: sMove,
      appointmentId: "appt_m1"
    }));
    check("new cancel on cancelled is already_cancelled", cancelAgain.status === "already_cancelled");
    const cancelRev = await ex.refsFor(sMove).providerDays.doc(anaKey).get();
    check("already_cancelled does not bump guard revision", cancelRev.data().revision === afterCancelAna.data().revision);
    const cancelWithLines = await ex.executeAtomicMutation(api.sealAtomicMutation({
      mutationType: "cancel",
      mutationId: "cancel-replace",
      salonId: sMove,
      appointmentId: "appt_m1",
      appointmentPayload: { serviceLines: [line("gel", "maria", TWO, TWO + 45)] },
      providerReservations: [providerRes("gel", "maria", TWO, TWO + 45)]
    }));
    check("CANCEL cannot carry replacement intent", cancelWithLines.status === "mutation_invalid" && (cancelWithLines.reasonCodes || []).indexOf("cancel_mutation_contains_appointment_change") !== -1);

    const sRes = await seed("resource");
    const resCreate = await ex.executeAtomicMutation(createMut(sRes, "r1", [line("gel", "maria", TWO, TWO + 45)], {
      resourceReservations: [resourceRes("gel", "chair-1", TWO, TWO + 45)]
    }));
    check("RESOURCE create", resCreate.status === "created");
    const chair1Key = api.resourceDayGuardKey("locA", "2026-09-14", "chair-1");
    const chair1 = await ex.refsFor(sRes).resourceDays.doc(chair1Key).get();
    check("RESOURCE guard occupancy written", chair1.exists && chair1.data().occupancies.length === 1);

    const sNotReady = await seed("not-ready", { resourceSystemReady: false });
    const notReady = await ex.executeAtomicMutation(createMut(sNotReady, "nr1", [line("gel", "maria", TWO, TWO + 45)], {
      resourceReservations: [resourceRes("gel", "chair-1", TWO, TWO + 45)]
    }));
    check("resourceSystemReady false rejects", notReady.status === "resource_system_not_ready");

    const sNight = await seed("night");
    const overnight = await ex.executeAtomicMutation(createMut(sNight, "night", [line("n", "maria", 22 * 60, 25 * 60)]));
    check("overnight rejected", overnight.status === "overnight_not_supported");

    const sRace = await seed("same-provider");
    let attemptsA = 0;
    let attemptsB = 0;
    let entered = 0;
    let unlockReads;
    const bothRead = new Promise(function (resolve) { unlockReads = resolve; });
    const readGate = Promise.race([
      bothRead,
      new Promise(function (resolve) { setTimeout(resolve, 150); })
    ]);
    function afterReads() {
      entered += 1;
      if (entered >= 2) unlockReads();
      return readGate;
    }
    const [raceA, raceB] = await Promise.all([
      ex.executeAtomicMutation(createMut(sRace, "win-a", [line("gel", "maria", TWO, TWO + 45)]), {
        onTransactionAttempt: function () { attemptsA += 1; },
        onAfterReads: afterReads
      }),
      ex.executeAtomicMutation(createMut(sRace, "lose-b", [line("gel", "maria", TWO, TWO + 45)]), {
        onTransactionAttempt: function () { attemptsB += 1; },
        onAfterReads: afterReads
      })
    ]);
    const raceStatuses = [raceA.status, raceB.status].sort();
    check("SAME PROVIDER one created", (raceA.status === "created") !== (raceB.status === "created"));
    check("SAME PROVIDER other provider_conflict", raceStatuses.indexOf("created") !== -1 && raceStatuses.indexOf("provider_conflict") !== -1);
    const raceAppts = await ex.refsFor(sRace).appointments.get();
    const raceMaria = await ex.refsFor(sRace).providerDays.doc(mariaKey).get();
    check("SAME PROVIDER one appointment and occupancy", raceAppts.size === 1 && raceMaria.data().occupancies.length === 1);

    const sRetry = await seed("tx-retry");
    let retryAttempts = 0;
    let markFirstRead;
    const firstRead = new Promise(function (resolve) { markFirstRead = resolve; });
    let releaseAfterContention;
    const afterContention = new Promise(function (resolve) { releaseAfterContention = resolve; });
    const retryPromise = ex.executeAtomicMutation(createMut(sRetry, "retry-probe", [line("gel", "maria", TWO, TWO + 45)]), {
      onTransactionAttempt: function () { retryAttempts += 1; },
      onAfterReads: async function (info) {
        if (info.attempt !== 1) return;
        markFirstRead();
        await afterContention;
      }
    });
    await Promise.race([
      firstRead,
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error("retry probe first read timeout")); }, 8000);
      })
    ]);
    await ex.refsFor(sRetry).settings.doc("main").set({
      retryProbe: Date.now()
    }, { merge: true });
    releaseAfterContention();
    const retryResult = await retryPromise;
    const retryObserved = retryResult.status === "created" && (retryAttempts >= 2 || retryResult.transactionAttempts > 1);
    check("SAME PROVIDER transaction retry observed", retryObserved, {
      status: retryResult.status,
      retryAttempts: retryAttempts,
      transactionAttempts: retryResult.transactionAttempts
    });

    const sOv = await seed("overlap", { allowedOverlapMinutes: 15 });
    const [ovA, ovB] = await Promise.all([
      ex.executeAtomicMutation(createMut(sOv, "ov15-a", [line("a", "maria", TWO, TWO + 45)])),
      ex.executeAtomicMutation(createMut(sOv, "ov15-b", [line("b", "maria", TWO + 35, TWO + 80)]))
    ]);
    check("ALLOWED OVERLAP 10 both created", ovA.status === "created" && ovB.status === "created");
    const ovGuard = await ex.refsFor(sOv).providerDays.doc(mariaKey).get();
    check("ALLOWED OVERLAP guard has both occupancies", ovGuard.data().occupancies.length === 2);

    const sOver = await seed("over-allowance", { allowedOverlapMinutes: 15 });
    const [overA, overB] = await Promise.all([
      ex.executeAtomicMutation(createMut(sOver, "ov20-a", [line("a", "maria", TWO, TWO + 45)])),
      ex.executeAtomicMutation(createMut(sOver, "ov20-b", [line("b", "maria", TWO + 25, TWO + 70)]))
    ]);
    const overStatuses = [overA.status, overB.status].sort();
    check("OVER ALLOWANCE one conflict", overStatuses.indexOf("created") !== -1 && overStatuses.indexOf("provider_conflict") !== -1);
    const overGuard = await ex.refsFor(sOver).providerDays.doc(mariaKey).get();
    check("OVER ALLOWANCE one occupancy", overGuard.data().occupancies.length === 1);

    const sDiff = await seed("diff-provider");
    const [diffA, diffB] = await Promise.all([
      ex.executeAtomicMutation(createMut(sDiff, "maria-only", [line("a", "maria", TWO, TWO + 45)])),
      ex.executeAtomicMutation(createMut(sDiff, "ana-only", [line("b", "ana", TWO, TWO + 45)]))
    ]);
    check("DIFFERENT PROVIDERS both created", diffA.status === "created" && diffB.status === "created");

    const sSameRes = await seed("same-resource");
    const [chA, chB] = await Promise.all([
      ex.executeAtomicMutation(createMut(sSameRes, "ch-a", [line("a", "maria", TWO, TWO + 45)], { resourceReservations: [resourceRes("a", "chair-1", TWO, TWO + 45)] })),
      ex.executeAtomicMutation(createMut(sSameRes, "ch-b", [line("b", "ana", TWO, TWO + 45)], { resourceReservations: [resourceRes("b", "chair-1", TWO, TWO + 45)] }))
    ]);
    const chStatuses = [chA.status, chB.status].sort();
    check("SAME RESOURCE one created one conflict", chStatuses.indexOf("created") !== -1 && chStatuses.indexOf("resource_conflict") !== -1);
    const sameChair = await ex.refsFor(sSameRes).resourceDays.doc(chair1Key).get();
    check("SAME RESOURCE one occupancy", sameChair.data().occupancies.length === 1);

    const sDiffRes = await seed("diff-resource");
    const [d1, d2] = await Promise.all([
      ex.executeAtomicMutation(createMut(sDiffRes, "ch1", [line("a", "maria", TWO, TWO + 45)], { resourceReservations: [resourceRes("a", "chair-1", TWO, TWO + 45)] })),
      ex.executeAtomicMutation(createMut(sDiffRes, "ch2", [line("b", "ana", TWO, TWO + 45)], { resourceReservations: [resourceRes("b", "chair-2", TWO + 45, TWO + 90)] }))
    ]);
    check("DIFFERENT RESOURCES both created", d1.status === "created" && d2.status === "created");

    const sMulti = await seed("multi-provider");
    const holdAna = await ex.executeAtomicMutation(createMut(sMulti, "hold-ana", [line("x", "ana", TWO, TWO + 45)]));
    const needBoth = await ex.executeAtomicMutation(createMut(sMulti, "need-both", [
      line("a", "maria", TWO, TWO + 45),
      line("b", "ana", TWO, TWO + 45)
    ]));
    check("MULTI-PROVIDER all-or-none", holdAna.status === "created" && needBoth.status === "provider_conflict");
    const needBothAppt = await ex.refsFor(sMulti).appointments.doc("appt_need-both").get();
    const multiMaria = await ex.refsFor(sMulti).providerDays.doc(mariaKey).get();
    check("MULTI-PROVIDER never Maria-only", !needBothAppt.exists && (!multiMaria.exists || !multiMaria.data().occupancies.some(function (row) { return row.appointmentId === "appt_need-both"; })));

    const sMultiRes = await seed("multi-resource");
    const holdRoom = await ex.executeAtomicMutation(createMut(sMultiRes, "hold-room", [line("r", "ana", TWO, TWO + 45)], {
      resourceReservations: [resourceRes("r", "room-a", TWO, TWO + 45, { requirementKey: "room" })]
    }));
    const needBothRes = await ex.executeAtomicMutation(createMut(sMultiRes, "need-both-res", [
      line("a", "maria", TWO, TWO + 45),
      line("b", "ana", TWO + 60, TWO + 105)
    ], {
      resourceReservations: [
        resourceRes("a", "chair-1", TWO, TWO + 45),
        resourceRes("b", "room-a", TWO, TWO + 45, { requirementKey: "room" })
      ]
    }));
    check("MULTI-RESOURCE all-or-none", holdRoom.status === "created" && needBothRes.status === "resource_conflict");
    const bothResAppt = await ex.refsFor(sMultiRes).appointments.doc("appt_need-both-res").get();
    const chairAfterFail = await ex.refsFor(sMultiRes).resourceDays.doc(chair1Key).get();
    check("MULTI-RESOURCE never Chair-only", !bothResAppt.exists && (!chairAfterFail.exists || !chairAfterFail.data().occupancies.some(function (row) { return row.appointmentId === "appt_need-both-res"; })));

    const sClick = await seed("double-click");
    const clickMut = createMut(sClick, "dbl", [line("gel", "maria", TWO, TWO + 45)]);
    const [clickA, clickB] = await Promise.all([
      ex.executeAtomicMutation(clickMut),
      ex.executeAtomicMutation(clickMut)
    ]);
    const clickStatuses = [clickA.status, clickB.status].sort();
    check("CONCURRENT DOUBLE-CLICK created + already_completed", clickStatuses[0] === "already_completed" && clickStatuses[1] === "created");
    check("CONCURRENT DOUBLE-CLICK same appointmentId", clickA.appointmentId === clickB.appointmentId && clickA.appointmentId === "appt_dbl");
    const clickAppts = await ex.refsFor(sClick).appointments.get();
    const clickMuts = await ex.refsFor(sClick).mutations.get();
    check("CONCURRENT DOUBLE-CLICK one appointment and one mutation doc", clickAppts.size === 1 && clickMuts.size === 1);

    const sEpoch = await seed("epoch", { epochVersion: 12 });
    const epochMut = createMut(sEpoch, "epoch-book", [line("gel", "maria", TWO, TWO + 45)], { epochVersion: 12 });
    const [epochBook, epochBump] = await Promise.all([
      ex.executeAtomicMutation(epochMut),
      ex.applyAvailabilityMutation(sEpoch, {
        locationIds: ["locA"],
        availabilityConfig: { locA: { businessHours: { monday: { isOpen: true } } } }
      })
    ]);
    check("EPOCH RACE availability mutation commits", epochBump.status === "availability_updated" && epochBump.epochs.locA.version === 13);
    check("EPOCH RACE booking is created or availability_version_changed", epochBook.status === "created" || epochBook.status === "availability_version_changed", epochBook.status);
    if (epochBook.status === "created") {
      const late = await ex.executeAtomicMutation(createMut(sEpoch, "epoch-late", [line("gel", "ana", TWO, TWO + 45)], { epochVersion: 12 }));
      check("EPOCH RACE stale version after bump is availability_version_changed", late.status === "availability_version_changed");
    } else {
      const epochAppts = await ex.refsFor(sEpoch).appointments.get();
      check("EPOCH RACE no booking against new schedule at version 12", epochAppts.size === 0);
    }

    const sDeact = await seed("deact", { epochVersion: 12 });
    const [deactBook, deactRes] = await Promise.all([
      ex.executeAtomicMutation(createMut(sDeact, "deact-book", [line("gel", "maria", TWO, TWO + 45)], {
        epochVersion: 12,
        resourceReservations: [resourceRes("gel", "chair-1", TWO, TWO + 45)]
      })),
      ex.applyAvailabilityMutation(sDeact, {
        locationIds: ["locA"],
        resourceDefinitions: { "chair-1": Object.assign(chairDef("chair-1"), { active: false }) }
      })
    ]);
    check("RESOURCE DEACTIVATION bumps epoch", deactRes.status === "availability_updated" && deactRes.epochs.locA.version === 13);
    check("RESOURCE DEACTIVATION booking created or fenced", deactBook.status === "created" || deactBook.status === "availability_version_changed" || deactBook.status === "resource_schedule_changed", deactBook.status);
    const staleDeact = await ex.executeAtomicMutation(createMut(sDeact, "deact-stale", [line("gel", "ana", TWO + 60, TWO + 105)], {
      epochVersion: 12,
      resourceReservations: [resourceRes("gel", "chair-1", TWO + 60, TWO + 105)]
    }));
    check("RESOURCE DEACTIVATION stale epoch rejected", staleDeact.status === "availability_version_changed");

    const sUpd = await seed("update-race");
    await ex.executeAtomicMutation(createMut(sUpd, "rev3", [line("gel", "maria", TWO, TWO + 45)]));
    function updateMut(id) {
      return api.sealAtomicMutation({
        mutationType: "update",
        mutationId: id,
        salonId: sUpd,
        appointmentId: "appt_rev3",
        expectedAppointmentRevision: 1,
        locationId: "locA",
        dateKey: "2026-09-14",
        availabilityVersions: [{ locationId: "locA", version: 1 }],
        appointmentPayload: {
          clientId: "client-1",
          locationId: "locA",
          dateKey: "2026-09-14",
          serviceLines: [line("gel", "ana", TWO, TWO + 45)]
        },
        providerReservations: [providerRes("gel", "ana", TWO, TWO + 45)],
        resourceReservations: [],
        providerAvailability: Object.assign({}, working("maria"), working("ana"))
      });
    }
    const [uA, uB] = await Promise.all([
      ex.executeAtomicMutation(updateMut("u-a")),
      ex.executeAtomicMutation(updateMut("u-b"))
    ]);
    const uStatuses = [uA.status, uB.status].sort();
    check("UPDATE RACE one updated", uStatuses.indexOf("updated") !== -1 && uStatuses.indexOf("appointment_revision_mismatch") !== -1);
    const updDoc = await ex.refsFor(sUpd).appointments.doc("appt_rev3").get();
    check("UPDATE RACE revision is 2", updDoc.data().revision === 2);

    const sCc = await seed("cancel-create");
    await ex.executeAtomicMutation(createMut(sCc, "occ", [line("gel", "maria", TWO, TWO + 45)]));
    const [ccCancel, ccCreate] = await Promise.all([
      ex.executeAtomicMutation(api.sealAtomicMutation({
        mutationType: "cancel",
        mutationId: "cc-cancel",
        salonId: sCc,
        appointmentId: "appt_occ"
      })),
      ex.executeAtomicMutation(createMut(sCc, "cc-new", [line("gel", "maria", TWO, TWO + 45)]))
    ]);
    check("CANCEL/CREATE both legal outcomes", (ccCancel.status === "cancelled" && (ccCreate.status === "created" || ccCreate.status === "provider_conflict")) || (ccCreate.status === "created" && ccCancel.status === "cancelled"));
    const ccMaria = await ex.refsFor(sCc).providerDays.doc(mariaKey).get();
    const ccOcc = (ccMaria.exists ? ccMaria.data().occupancies : []).filter(function (row) {
      return row.startMin === TWO && row.endMin === TWO + 45;
    });
    check("CANCEL/CREATE no illegal double occupancy", ccOcc.length <= 1);

    const sCm = await seed("cancel-move");
    await ex.executeAtomicMutation(createMut(sCm, "cm1", [line("gel", "maria", TWO, TWO + 45)]));
    const [cmCancel, cmMove] = await Promise.all([
      ex.executeAtomicMutation(api.sealAtomicMutation({
        mutationType: "cancel",
        mutationId: "cm-cancel",
        salonId: sCm,
        appointmentId: "appt_cm1"
      })),
      ex.executeAtomicMutation(api.sealAtomicMutation({
        mutationType: "update",
        mutationId: "cm-move",
        salonId: sCm,
        appointmentId: "appt_cm1",
        expectedAppointmentRevision: 1,
        locationId: "locA",
        dateKey: "2026-09-14",
        availabilityVersions: [{ locationId: "locA", version: 1 }],
        appointmentPayload: {
          clientId: "client-1",
          locationId: "locA",
          dateKey: "2026-09-14",
          serviceLines: [line("gel", "ana", TWO + 60, TWO + 105)]
        },
        providerReservations: [providerRes("gel", "ana", TWO + 60, TWO + 105)],
        resourceReservations: [],
        providerAvailability: Object.assign({}, working("maria"), working("ana"))
      }))
    ]);
    const cmStatuses = [cmCancel.status, cmMove.status];
    const cmLegal = { cancelled: true, updated: true, appointment_revision_mismatch: true, already_cancelled: true, mutation_invalid: true };
    check("CANCEL/MOVE one coherent winner", cmLegal[cmCancel.status] && cmLegal[cmMove.status] && (cmStatuses.indexOf("cancelled") !== -1 || cmStatuses.indexOf("updated") !== -1), cmStatuses);
    const cmAppt = await ex.refsFor(sCm).appointments.doc("appt_cm1").get();
    const cmMaria = await ex.refsFor(sCm).providerDays.doc(mariaKey).get();
    const cmAna = await ex.refsFor(sCm).providerDays.doc(anaKey).get();
    const liveIds = {};
    if (cmAppt.exists && cmAppt.data().status !== "cancelled") liveIds[cmAppt.id] = true;
    const orphanMaria = (cmMaria.exists ? cmMaria.data().occupancies : []).some(function (row) {
      return row.appointmentId === "appt_cm1" && cmAppt.data().status === "cancelled";
    });
    const orphanAna = (cmAna.exists ? cmAna.data().occupancies : []).some(function (row) {
      return row.appointmentId === "appt_cm1" && cmAppt.data().status === "cancelled";
    });
    check("CANCEL/MOVE no orphan occupancy", !orphanMaria && !orphanAna);
    void liveIds;

    const sGuard = await seed("guard-rev");
    const twoLine = await ex.executeAtomicMutation(createMut(sGuard, "two-line", [
      line("a", "maria", TWO, TWO + 45),
      line("b", "maria", TWO + 50, TWO + 95)
    ]));
    const twoGuard = await ex.refsFor(sGuard).providerDays.doc(mariaKey).get();
    check("multi-line same guard +1 once", twoLine.status === "created" && twoGuard.data().revision === 1 && twoGuard.data().occupancies.length === 2);
    const failCreate = await ex.executeAtomicMutation(createMut(sGuard, "fail-overlap", [line("c", "maria", TWO, TWO + 45)]));
    const failGuard = await ex.refsFor(sGuard).providerDays.doc(mariaKey).get();
    check("failed mutation does not change revision", failCreate.status === "provider_conflict" && failGuard.data().revision === 1);

    const sMissing = await seed("missing-guard");
    const [mgA, mgB] = await Promise.all([
      ex.executeAtomicMutation(createMut(sMissing, "mg-a", [line("a", "maria", TWO, TWO + 45)])),
      ex.executeAtomicMutation(createMut(sMissing, "mg-b", [line("b", "maria", TWO + 60, TWO + 105)]))
    ]);
    check("MISSING GUARD concurrent first writes", mgA.status === "created" && mgB.status === "created");
    const missingGuard = await ex.refsFor(sMissing).providerDays.doc(mariaKey).get();
    check("MISSING GUARD no lost occupancy", missingGuard.data().occupancies.length === 2);

    const ssCancelled = createMut(sCreate, "ss-cancel", [line("gel", "maria", TWO + 120, TWO + 165)]);
    ssCancelled.smartScheduling = { offerId: "o1" };
    ssCancelled.appointmentPayload.status = "cancelled";
    const ssCancelledSealed = api.sealAtomicMutation(ssCancelled);
    const ssCancelExec = await ex.executeAtomicMutation(ssCancelledSealed);
    check("SS CREATE cancelled rejected", ssCancelExec.status === "command_invalid" || ssCancelExec.status === "mutation_invalid");

    await ex.deleteSalonTree(sCreate);
    await ex.deleteSalonTree(sMove);
    await ex.deleteSalonTree(sRes);
    await ex.deleteSalonTree(sNotReady);
    await ex.deleteSalonTree(sNight);
    await ex.deleteSalonTree(sRace);
    await ex.deleteSalonTree(sRetry);
    await ex.deleteSalonTree(sOv);
    await ex.deleteSalonTree(sOver);
    await ex.deleteSalonTree(sDiff);
    await ex.deleteSalonTree(sSameRes);
    await ex.deleteSalonTree(sDiffRes);
    await ex.deleteSalonTree(sMulti);
    await ex.deleteSalonTree(sMultiRes);
    await ex.deleteSalonTree(sClick);
    await ex.deleteSalonTree(sEpoch);
    await ex.deleteSalonTree(sDeact);
    await ex.deleteSalonTree(sUpd);
    await ex.deleteSalonTree(sCc);
    await ex.deleteSalonTree(sCm);
    await ex.deleteSalonTree(sGuard);
    await ex.deleteSalonTree(sMissing);
  } finally {
    if (admin.apps.length) await admin.app().delete();
    if (emulator && emulator.child) emulator.child.kill();
  }

  if (failed) {
    console.error(failed + " Firestore emulator checks failed.");
    process.exit(1);
  }
  console.log("All Firestore emulator atomic booking checks passed.");
}

main().catch(function (err) {
  console.error("FIRESTORE EMULATOR SUITE ABORTED. No staging/production fallback.", err);
  process.exit(2);
});
