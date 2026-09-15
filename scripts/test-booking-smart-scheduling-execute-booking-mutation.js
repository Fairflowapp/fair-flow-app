/**
 * Smart Scheduling Phase 18F server-handler tests.
 * Firestore Emulator only. Does not connect to staging or production.
 * Usage: node scripts/test-booking-smart-scheduling-execute-booking-mutation.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const root = path.resolve(__dirname, "..");

require("../functions/booking-smart-scheduling/build-runtime").syncRuntime();

const {
  handleExecuteBookingMutation
} = require("../functions/booking-smart-scheduling/execute-booking-mutation");
const {
  deriveProviderAvailability,
  loadAvailabilityEngine
} = require("../functions/booking-smart-scheduling/availability-resolver");
const {
  assertCallableRuntimeProject,
  EMULATOR_PROJECT,
  STAGING_PROJECT,
  PRODUCTION_PROJECT
} = require("../functions/booking-smart-scheduling/project-guard");
const {
  assertEmulatorIsolation,
  createFirestoreAtomicExecutor
} = require("../functions/booking-smart-scheduling/firestore-atomic-executor");
const { loadSmartSchedulingApi } = require("../functions/booking-smart-scheduling/load-smart-scheduling-api");

const TEST_PROJECT = EMULATOR_PROJECT;
const EMULATOR_HOST = "127.0.0.1";
const EMULATOR_PORT = 18080;
const TWO = 14 * 60;

const api = loadSmartSchedulingApi();

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

check("runtime guard allows emulator", (function () {
  try {
    return assertCallableRuntimeProject(EMULATOR_PROJECT) === EMULATOR_PROJECT;
  } catch (err) {
    return false;
  }
})());
check("runtime guard allows staging id without connecting", (function () {
  try {
    return assertCallableRuntimeProject(STAGING_PROJECT) === STAGING_PROJECT;
  } catch (err) {
    return false;
  }
})());
check("runtime guard refuses production", (function () {
  try {
    assertCallableRuntimeProject(PRODUCTION_PROJECT);
    return false;
  } catch (err) {
    return err.code === "production_project_forbidden";
  }
})());
check("runtime guard refuses unexpected project", (function () {
  try {
    assertCallableRuntimeProject("some-other-project");
    return false;
  } catch (err) {
    return err.code === "unexpected_project";
  }
})());
check("18E emulator isolation still refuses staging", (function () {
  try {
    assertEmulatorIsolation(STAGING_PROJECT, "127.0.0.1:18080");
    return false;
  } catch (err) {
    return err.code === "real_project_forbidden";
  }
})());

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
  ], { cwd: root, env: env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", function (buf) { process.stdout.write(buf); });
  child.stderr.on("data", function (buf) { process.stderr.write(buf); });
  const ready = await waitFor(function () { return canConnect(EMULATOR_HOST, EMULATOR_PORT); }, 60000);
  if (!ready) {
    child.kill();
    throw new Error("Firestore emulator did not start");
  }
  return { child: child, started: true };
}

function makeDay(providerId) {
  return api.normalizeProviderDay({
    dateKey: "2026-09-14",
    locationId: "locA",
    providerId: providerId,
    workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }],
    lines: [],
    allowedOverlapMinutes: 0
  });
}

function makeResource(resourceId) {
  return {
    resourceId: resourceId,
    resourceType: "pedicure_chair",
    locationId: "locA",
    dateKey: "2026-09-14",
    workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }],
    occupied: []
  };
}

function gelPlan(extra) {
  const more = extra || {};
  const start = more.startMin != null ? more.startMin : TWO;
  const end = start + 45;
  const assignments = more.resourceId
    ? [{
      requirementKey: "chair",
      resourceId: more.resourceId,
      resourceType: "pedicure_chair",
      serviceStartMin: start,
      serviceEndMin: end,
      reservationStartMin: start,
      reservationEndMin: end,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0
    }]
    : [];
  return {
    valid: true,
    dateKey: "2026-09-14",
    locationId: "locA",
    visitStartMin: start,
    visitEndMin: end,
    totalClientWaitMinutes: 0,
    visitElapsedMinutes: 45,
    sumServiceMinutes: 45,
    parallelMinutesSaved: 0,
    orderChanged: false,
    orderDistance: 0,
    timeDistanceMinutes: 0,
    flexibleVisitPlanScore: 90,
    assignmentKey: "gel|" + (more.providerId || "maria"),
    resourceAssignmentKey: more.resourceId ? "gel|chair|" + more.resourceId : "",
    overlapLineCount: 0,
    blocks: [{
      blockIndex: 0,
      sourceBlockIndex: 0,
      startMin: start,
      endMin: end,
      waitBeforeMinutes: 0,
      parallel: false,
      lineKeys: ["gel"],
      durationMinutes: 45
    }],
    serviceLines: [{
      lineKey: "gel",
      serviceId: more.serviceId || "svc-gel",
      providerId: more.providerId || "maria",
      startMin: start,
      endMin: end,
      durationMinutes: 45,
      blockIndex: 0,
      resourceAssignments: assignments
    }],
    searchMetadata: { truncated: false, exhaustive: true }
  };
}

function readyCommand(plan, extra) {
  const offer = api.rankClientVisitOffers([], [], {}, { sourcePlans: [plan], maxOffers: 1 })[0];
  const acceptance = Object.assign({
    acceptanceId: extra && extra.acceptanceId || "accept-1",
    offerId: offer.offerId,
    sourcePlanKey: offer.sourcePlanKey,
    clientId: extra && extra.clientId || "client-1"
  }, extra && extra.acceptance || {});
  return api.prepareOfferAcceptance(
    [makeDay("maria"), makeDay("ana")],
    [makeResource("chair-1"), makeResource("chair-2")],
    offer,
    acceptance,
    { availabilityVersions: [{ locationId: "locA", version: extra && extra.epochVersion != null ? extra.epochVersion : 1 }] }
  );
}

async function main() {
  check("FIRESTORE_EMULATOR_HOST required later", true);

  let emulator;
  try {
    const javaHome = findJavaHome(path.join(root, ".local", "temurin-jre"));
    if (!javaHome || !fs.existsSync(path.join(javaHome, "bin", "java"))) {
      throw new Error("Java runtime missing");
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
  const admin = require(adminPath);
  if (admin.apps.length) await admin.app().delete();
  admin.initializeApp({ projectId: TEST_PROJECT });
  const db = admin.firestore();
  const ex = createFirestoreAtomicExecutor({
    admin: admin,
    api: api,
    db: db,
    projectId: TEST_PROJECT,
    emulatorHost: process.env.FIRESTORE_EMULATOR_HOST
  });

  const AUTH_A = { uid: "uid-authorized" };
  const AUTH_B = { uid: "uid-outsider" };
  const AUTH_C = { uid: "uid-salon-b" };

  function weekHours(openTime, closeTime) {
    const map = {};
    ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].forEach(function (day) {
      map[day] = { isOpen: true, openTime: openTime, closeTime: closeTime };
    });
    return map;
  }
  function weekSchedule(startTime, endTime) {
    const map = {};
    ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].forEach(function (day) {
      map[day] = { enabled: true, startTime: startTime, endTime: endTime };
    });
    return map;
  }
  async function writeSchedule(salonId, extra) {
    const more = extra || {};
    const ref = db.doc("salons/" + salonId + "/settings/main");
    const prev = await ref.get();
    const data = prev.exists ? prev.data() : {};
    await ref.set(Object.assign({}, data, {
      booking: data.booking || { allowedOverlapMinutes: 0, overlapPolicyRevision: 1 },
      preferences: { salonTimeZone: "America/New_York" },
      locationSchedules: {
        locA: {
          businessHours: more.businessHours || weekHours("09:00", "18:00"),
          specialBusinessDays: more.specialBusinessDays || {}
        }
      }
    }), { merge: true });
  }

  async function seedWorld(name, extra) {
    const more = extra || {};
    const salonId = "ss-18f-" + name;
    await ex.deleteSalonTree(salonId);
    await db.doc("users/" + AUTH_B.uid).set({ salonId: "other-salon", role: "staff" });
    await db.doc("users/" + AUTH_A.uid).set({ salonId: salonId, role: "admin" });
    await db.doc("users/" + AUTH_C.uid).set({ salonId: "ss-18f-other", role: "admin" });
    await db.doc("salons/" + salonId).set({ name: "18F Test", ownerUid: AUTH_A.uid });
    await db.doc("salons/" + salonId + "/members/" + AUTH_A.uid).set({ role: "admin", staffId: "front-desk" });
    await db.doc("users/" + AUTH_A.uid + "/memberships/" + salonId).set({ role: "admin", staffId: "front-desk" });
    await db.doc("salons/ss-18f-other").set({ name: "Other", ownerUid: AUTH_C.uid });
    await db.doc("salons/ss-18f-other/members/" + AUTH_C.uid).set({ role: "admin" });
    await db.doc("salons/" + salonId + "/clients/client-1").set({
      firstName: "Ada",
      lastName: "Lovelace",
      displayName: "Ada Lovelace",
      phone: "555-0100",
      email: "ada@example.test"
    });
    await db.doc("salons/" + salonId + "/services/svc-gel").set({
      name: "Gel Manicure",
      defaultPrice: more.price != null ? more.price : 100
    });
    await db.doc("salons/" + salonId + "/staff/maria").set({
      firstName: "Maria",
      lastName: "Chen",
      displayName: "Maria Chen",
      allowedLocationIds: ["locA"],
      technicianTypes: ["gel"],
      defaultSchedule: more.mariaSchedule || weekSchedule("09:00", "18:00")
    });
    await db.doc("salons/" + salonId + "/staff/ana").set({
      firstName: "Ana",
      lastName: "Diaz",
      displayName: "Ana Diaz",
      allowedLocationIds: ["locA"],
      technicianTypes: ["gel"],
      defaultSchedule: more.anaSchedule || weekSchedule("09:00", "18:00")
    });
    await ex.seedGuardedSalon(salonId, Object.assign({
      resourceSystemReady: true,
      resourceEnforcementStartDateKey: "2026-09-01",
      epochVersion: more.epochVersion != null ? more.epochVersion : 1,
      resourceDefinitions: {
        "chair-1": {
          resourceId: "chair-1",
          locationId: "locA",
          resourceType: "pedicure_chair",
          active: true,
          workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }]
        },
        "chair-2": {
          resourceId: "chair-2",
          locationId: "locA",
          resourceType: "pedicure_chair",
          active: true,
          workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }]
        }
      }
    }, more.seed || {}));
    await writeSchedule(salonId, more);
    return salonId;
  }

  function call(auth, data, projectId) {
    return handleExecuteBookingMutation({
      auth: auth,
      data: data,
      db: db,
      projectId: projectId || TEST_PROJECT,
      admin: admin,
      api: api,
      emulatorHost: process.env.FIRESTORE_EMULATOR_HOST
    });
  }

  try {
    const sAuth = await seedWorld("auth");
    const prepared = readyCommand(gelPlan(), { acceptanceId: "a-auth" });
    check("prepared SS command is ready", prepared.status === "ready", prepared.status);

    const noAuth = await call(null, {
      mutationType: "create",
      salonId: sAuth,
      mutationId: "m-noauth",
      bookingCommand: prepared.bookingCommand,
      transactionPreconditions: prepared.transactionPreconditions
    });
    check("NO AUTH unauthenticated", noAuth.status === "unauthenticated");

    const outsider = await call(AUTH_B, {
      mutationType: "create",
      salonId: sAuth,
      mutationId: "m-out",
      bookingCommand: prepared.bookingCommand,
      transactionPreconditions: prepared.transactionPreconditions
    });
    check("NON MEMBER permission_denied", outsider.status === "permission_denied");

    const cross = await call(AUTH_C, {
      mutationType: "create",
      salonId: sAuth,
      mutationId: "m-cross",
      bookingCommand: prepared.bookingCommand,
      transactionPreconditions: prepared.transactionPreconditions
    });
    check("SALON B user cannot mutate salon A", cross.status === "permission_denied");

    const prod = await handleExecuteBookingMutation({
      auth: AUTH_A,
      data: { mutationType: "create", salonId: sAuth, mutationId: "m-prod" },
      db: db,
      projectId: PRODUCTION_PROJECT,
      admin: admin,
      api: api,
      emulatorHost: process.env.FIRESTORE_EMULATOR_HOST
    });
    check("handler refuses production project", prod.status === "production_project_forbidden");

    const unexpected = await handleExecuteBookingMutation({
      auth: AUTH_A,
      data: { mutationType: "create", salonId: sAuth, mutationId: "m-unx" },
      db: db,
      projectId: "not-a-real-target",
      admin: admin,
      api: api,
      emulatorHost: process.env.FIRESTORE_EMULATOR_HOST
    });
    check("handler refuses unexpected project", unexpected.status === "unexpected_project");

    const stagingGuard = await handleExecuteBookingMutation({
      auth: AUTH_A,
      data: { mutationType: "create", salonId: sAuth, mutationId: "m-stg" },
      db: db,
      projectId: STAGING_PROJECT,
      admin: admin,
      api: api,
      emulatorHost: ""
    });
    check("staging id allowed by guard but writes latch without emulator", stagingGuard.status === "mutation_invalid" && (stagingGuard.reasonCodes || []).indexOf("staging_execution_not_enabled") !== -1);

    const created = await call(AUTH_A, {
      mutationType: "create",
      salonId: sAuth,
      mutationId: "m-create",
      bookingCommand: prepared.bookingCommand,
      transactionPreconditions: prepared.transactionPreconditions,
      adapterContext: {
        servicesById: { "svc-gel": { name: "Forged", defaultPrice: 1 } },
        staffById: { maria: { displayName: "Forged Provider" } },
        client: { clientId: "client-1", displayName: "Forged Client" }
      }
    });
    check("SMART CREATE created", created.status === "created" && !!created.appointmentId, created);
    const appt = await ex.refsFor(sAuth).appointments.doc(created.appointmentId).get();
    const apptData = appt.exists ? appt.data() : {};
    check("CREATE wrote one appointment", appt.exists && apptData.status === "scheduled" && apptData.revision === 1);
    check("CREATE used server service price 100", apptData.serviceLines && apptData.serviceLines[0] && apptData.serviceLines[0].priceSnapshot === 100);
    check("CREATE used server service name", apptData.serviceLines[0].serviceNameSnapshot === "Gel Manicure");
    check("CREATE used server provider name", apptData.serviceLines[0].providerNameSnapshot === "Maria Chen");
    check("CREATE used server client name", apptData.clientSnapshot && apptData.clientSnapshot.displayName === "Ada Lovelace");
    check("CREATE ignored caller forged snapshots", apptData.serviceLines[0].priceSnapshot !== 1 && apptData.clientSnapshot.displayName !== "Forged Client");
    check("CREATE actor uid is auth uid", apptData.createdByUid === AUTH_A.uid);
    check("CREATE appointment id is not appt_{mutationId}", created.appointmentId !== "appt_m-create");
    const mariaKey = api.providerDayGuardKey("locA", "2026-09-14", "maria");
    const mariaGuard = await ex.refsFor(sAuth).providerDays.doc(mariaKey).get();
    check("CREATE wrote provider guard", mariaGuard.exists && mariaGuard.data().occupancies.length === 1);
    const muts = await ex.refsFor(sAuth).mutations.get();
    check("CREATE wrote one mutation record", muts.size === 1 && muts.docs[0].data().resultStatus === "created");
    check("CREATE mutation storage key is sha256", /^[a-f0-9]{64}$/.test(muts.docs[0].id));

    const sZero = await seedWorld("zero", { price: 0 });
    const zeroPrep = readyCommand(gelPlan(), { acceptanceId: "a-zero" });
    const zero = await call(AUTH_A, {
      mutationType: "create",
      salonId: sZero,
      mutationId: "m-zero",
      bookingCommand: zeroPrep.bookingCommand,
      transactionPreconditions: zeroPrep.transactionPreconditions
    });
    const zeroDoc = zero.appointmentId ? await ex.refsFor(sZero).appointments.doc(zero.appointmentId).get() : { exists: false };
    check("EXPLICIT ZERO price persists 0", zero.status === "created" && zeroDoc.exists && zeroDoc.data().serviceLines[0].priceSnapshot === 0);

    const sMissing = await seedWorld("missing-price");
    await db.doc("salons/" + sMissing + "/services/svc-gel").set({ name: "Gel Manicure" });
    const missPrep = readyCommand(gelPlan(), { acceptanceId: "a-miss" });
    const missing = await call(AUTH_A, {
      mutationType: "create",
      salonId: sMissing,
      mutationId: "m-miss",
      bookingCommand: missPrep.bookingCommand,
      transactionPreconditions: missPrep.transactionPreconditions
    });
    check("MISSING price is service_price_snapshot_required", missing.status === "service_price_snapshot_required");
    const missingAppts = await ex.refsFor(sMissing).appointments.get();
    check("MISSING price wrote nothing", missingAppts.empty);

    const sTamper = await seedWorld("tamper");
    const tamperPrep = readyCommand(gelPlan(), { acceptanceId: "a-tamper" });
    const tampered = copyJson(tamperPrep.bookingCommand);
    tampered.serviceLines[0].serviceId = "svc-other";
    const tamper = await call(AUTH_A, {
      mutationType: "create",
      salonId: sTamper,
      mutationId: "m-tamper",
      bookingCommand: tampered,
      transactionPreconditions: tamperPrep.transactionPreconditions
    });
    check("COMMAND TAMPER command_invalid", tamper.status === "command_invalid" && (tamper.reasonCodes || []).indexOf("command_integrity_mismatch") !== -1);
    const tamperAppts = await ex.refsFor(sTamper).appointments.get();
    const tamperGuards = await ex.refsFor(sTamper).providerDays.get();
    const tamperMuts = await ex.refsFor(sTamper).mutations.get();
    check("COMMAND TAMPER no writes", tamperAppts.empty && tamperGuards.empty && tamperMuts.empty);

    const sEpoch = await seedWorld("epoch", { epochVersion: 13 });
    const stalePrep = readyCommand(gelPlan(), { acceptanceId: "a-epoch", epochVersion: 12 });
    const stale = await call(AUTH_A, {
      mutationType: "create",
      salonId: sEpoch,
      mutationId: "m-epoch",
      bookingCommand: stalePrep.bookingCommand,
      transactionPreconditions: stalePrep.transactionPreconditions
    });
    check("STALE EPOCH availability_version_changed", stale.status === "availability_version_changed");
    const staleAppts = await ex.refsFor(sEpoch).appointments.get();
    check("STALE EPOCH no writes", staleAppts.empty);

    const sRace = await seedWorld("race");
    const raceA = readyCommand(gelPlan(), { acceptanceId: "race-a" });
    const raceB = readyCommand(gelPlan(), { acceptanceId: "race-b" });
    const [r1, r2] = await Promise.all([
      call(AUTH_A, {
        mutationType: "create",
        salonId: sRace,
        mutationId: "m-race-a",
        bookingCommand: raceA.bookingCommand,
        transactionPreconditions: raceA.transactionPreconditions
      }),
      call(AUTH_A, {
        mutationType: "create",
        salonId: sRace,
        mutationId: "m-race-b",
        bookingCommand: raceB.bookingCommand,
        transactionPreconditions: raceB.transactionPreconditions
      })
    ]);
    const raceStatuses = [r1.status, r2.status].sort();
    check("SAME PROVIDER created + provider_conflict", raceStatuses[0] === "created" && raceStatuses[1] === "provider_conflict", raceStatuses);
    const raceAppts = await ex.refsFor(sRace).appointments.get();
    check("SAME PROVIDER one appointment", raceAppts.size === 1);

    const sClick = await seedWorld("click");
    const clickPrep = readyCommand(gelPlan(), { acceptanceId: "click-1" });
    const clickPayload = {
      mutationType: "create",
      salonId: sClick,
      mutationId: "m-click",
      bookingCommand: clickPrep.bookingCommand,
      transactionPreconditions: clickPrep.transactionPreconditions
    };
    const [c1, c2] = await Promise.all([call(AUTH_A, clickPayload), call(AUTH_A, clickPayload)]);
    const clickStatuses = [c1.status, c2.status].sort();
    check("DOUBLE CLICK created + already_completed", clickStatuses[0] === "already_completed" && clickStatuses[1] === "created", clickStatuses);
    check("DOUBLE CLICK same appointmentId", c1.appointmentId === c2.appointmentId && !!c1.appointmentId);
    const clickAppts = await ex.refsFor(sClick).appointments.get();
    check("DOUBLE CLICK one appointment", clickAppts.size === 1);

    const sRes = await seedWorld("resource");
    const resA = readyCommand(gelPlan({ providerId: "maria", resourceId: "chair-1" }), { acceptanceId: "res-a" });
    const resB = readyCommand(gelPlan({ providerId: "ana", resourceId: "chair-1" }), { acceptanceId: "res-b" });
    const [res1, res2] = await Promise.all([
      call(AUTH_A, {
        mutationType: "create",
        salonId: sRes,
        mutationId: "m-res-a",
        bookingCommand: resA.bookingCommand,
        transactionPreconditions: resA.transactionPreconditions
      }),
      call(AUTH_A, {
        mutationType: "create",
        salonId: sRes,
        mutationId: "m-res-b",
        bookingCommand: resB.bookingCommand,
        transactionPreconditions: resB.transactionPreconditions
      })
    ]);
    const resStatuses = [res1.status, res2.status].sort();
    check("RESOURCE CONFLICT created + resource_conflict", resStatuses.indexOf("created") !== -1 && resStatuses.indexOf("resource_conflict") !== -1, resStatuses);

    const sUpd = await seedWorld("update");
    const updPrep = readyCommand(gelPlan(), { acceptanceId: "upd-1" });
    const updCreate = await call(AUTH_A, {
      mutationType: "create",
      salonId: sUpd,
      mutationId: "m-upd-c",
      bookingCommand: updPrep.bookingCommand,
      transactionPreconditions: updPrep.transactionPreconditions
    });
    const moved = await call(AUTH_A, {
      mutationType: "update",
      salonId: sUpd,
      mutationId: "m-upd-1",
      appointmentId: updCreate.appointmentId,
      expectedAppointmentRevision: 1,
      locationId: "locA",
      dateKey: "2026-09-14",
      availabilityVersions: [{ locationId: "locA", version: 1 }],
      appointmentPayload: {
        clientId: "client-1",
        locationId: "locA",
        dateKey: "2026-09-14",
        serviceLines: [{
          lineId: "line-ana",
          serviceId: "svc-gel",
          providerId: "ana",
          startMin: TWO + 60,
          endMin: TWO + 105,
          durationMinutes: 45
        }]
      },
      providerReservations: [{
        providerId: "ana",
        lineId: "line-ana",
        startMin: TWO + 60,
        endMin: TWO + 105,
        locationId: "locA",
        dateKey: "2026-09-14"
      }]
    });
    check("UPDATE move succeeds", moved.status === "updated" && moved.appointmentRevision === 2, moved);
    const staleUpd = await call(AUTH_A, {
      mutationType: "update",
      salonId: sUpd,
      mutationId: "m-upd-stale",
      appointmentId: updCreate.appointmentId,
      expectedAppointmentRevision: 1,
      locationId: "locA",
      dateKey: "2026-09-14",
      availabilityVersions: [{ locationId: "locA", version: 1 }],
      appointmentPayload: {
        clientId: "client-1",
        locationId: "locA",
        dateKey: "2026-09-14",
        serviceLines: [{
          lineId: "line-ana",
          serviceId: "svc-gel",
          providerId: "ana",
          startMin: TWO + 60,
          endMin: TWO + 105,
          durationMinutes: 45
        }]
      },
      providerReservations: [{
        providerId: "ana",
        lineId: "line-ana",
        startMin: TWO + 60,
        endMin: TWO + 105,
        locationId: "locA",
        dateKey: "2026-09-14"
      }]
    });
    check("UPDATE stale revision rejected", staleUpd.status === "appointment_revision_mismatch");

    const statusOk = await call(AUTH_A, {
      mutationType: "status",
      salonId: sUpd,
      mutationId: "m-status-1",
      appointmentId: updCreate.appointmentId,
      expectedAppointmentRevision: 2,
      targetStatus: "confirmed"
    });
    check("STATUS scheduled -> confirmed", statusOk.status === "status_updated" && statusOk.appointmentRevision === 3);
    const statusCancel = await call(AUTH_A, {
      mutationType: "status",
      salonId: sUpd,
      mutationId: "m-status-bad",
      appointmentId: updCreate.appointmentId,
      expectedAppointmentRevision: 3,
      targetStatus: "cancelled"
    });
    check("STATUS cancelled target rejected", statusCancel.status === "mutation_invalid" && (statusCancel.reasonCodes || []).indexOf("use_cancel_mutation") !== -1);

    const cancelled = await call(AUTH_A, {
      mutationType: "cancel",
      salonId: sUpd,
      mutationId: "m-cancel-1",
      appointmentId: updCreate.appointmentId,
      cancellationReason: "client asked"
    });
    check("CANCEL frees appointment", cancelled.status === "cancelled");
    const afterCancel = await ex.refsFor(sUpd).appointments.doc(updCreate.appointmentId).get();
    const anaKey = api.providerDayGuardKey("locA", "2026-09-14", "ana");
    const anaGuard = await ex.refsFor(sUpd).providerDays.doc(anaKey).get();
    check("CANCEL wrote cancelledByUid", afterCancel.data().cancelledByUid === AUTH_A.uid);
    check("CANCEL freed Ana guard", !anaGuard.exists || anaGuard.data().occupancies.length === 0);
    const cancelRetry = await call(AUTH_A, {
      mutationType: "cancel",
      salonId: sUpd,
      mutationId: "m-cancel-1",
      appointmentId: updCreate.appointmentId
    });
    check("CANCEL retry already_completed", cancelRetry.status === "already_completed");

    const foreign = await call(AUTH_A, {
      mutationType: "cancel",
      salonId: sAuth,
      mutationId: "m-foreign",
      appointmentId: updCreate.appointmentId
    });
    check("CROSS-SALON appointment id does not mutate other salon", foreign.status === "mutation_invalid");
    const stillB = await ex.refsFor(sUpd).appointments.doc(updCreate.appointmentId).get();
    check("CROSS-SALON salon B appointment remains cancelled only by B", stillB.data().status === "cancelled");

    async function createFromPlan(salonId, mutationId, planExtra, acceptExtra) {
      const preparedRow = readyCommand(gelPlan(planExtra || {}), Object.assign({ acceptanceId: mutationId }, acceptExtra || {}));
      return call(AUTH_A, {
        mutationType: "create",
        salonId: salonId,
        mutationId: mutationId,
        bookingCommand: preparedRow.bookingCommand,
        transactionPreconditions: preparedRow.transactionPreconditions
      });
    }
    async function assertNoWrites(salonId, label) {
      const appts = await ex.refsFor(salonId).appointments.get();
      const guards = await ex.refsFor(salonId).providerDays.get();
      const muts = await ex.refsFor(salonId).mutations.get();
      check(label, appts.empty && guards.empty && muts.empty);
    }

    const engine = loadAvailabilityEngine({
      preferences: { salonTimeZone: "America/New_York" },
      locationSchedules: { locA: { businessHours: weekHours("10:00", "20:30") } }
    });
    const parityStaff = {
      id: "maria",
      staffId: "maria",
      defaultSchedule: weekSchedule("12:00", "18:00")
    };
    const derived = deriveProviderAvailability({
      settings: { locationSchedules: { locA: { businessHours: weekHours("10:00", "20:30") } } },
      staff: parityStaff,
      requests: [],
      locationId: "locA",
      dateKey: "2026-09-14",
      providerId: "maria"
    });
    const live = engine.resolveEffectiveProviderAvailability("maria", "2026-09-14", "locA", {
      settings: { locationSchedules: { locA: { businessHours: weekHours("10:00", "20:30") } } },
      staff: parityStaff,
      requests: []
    });
    check("resolver parity with availability.js", derived.workingIntervals[0] && live.intervals[0]
      && derived.workingIntervals[0].startMin === live.intervals[0].startMin
      && derived.workingIntervals[0].endMin === live.intervals[0].endMin, derived);

    const sClosed = await seedWorld("loc-closed", { businessHours: weekHours("10:00", "20:30") });
    const closed = await createFromPlan(sClosed, "m-closed", { startMin: 9 * 60 + 30 });
    check("LOCATION CLOSED rejects", closed.status === "provider_schedule_changed", closed.status);
    await assertNoWrites(sClosed, "LOCATION CLOSED no writes");

    const sSpecial = await seedWorld("special-closed", {
      businessHours: weekHours("10:00", "20:30"),
      specialBusinessDays: { "2026-09-14": { isClosed: true } }
    });
    const specialClosed = await createFromPlan(sSpecial, "m-special-closed", { startMin: TWO });
    check("SPECIAL DAY CLOSED rejects", specialClosed.status === "provider_schedule_changed", specialClosed.status);
    await assertNoWrites(sSpecial, "SPECIAL DAY CLOSED no writes");

    const sShort = await seedWorld("special-short", {
      businessHours: weekHours("10:00", "20:30"),
      specialBusinessDays: { "2026-09-14": { isClosed: false, openTime: "10:00", closeTime: "15:00" } }
    });
    const shortFail = await createFromPlan(sShort, "m-short", { startMin: 16 * 60 });
    check("SHORTENED SPECIAL DAY 16:00 rejects", shortFail.status === "provider_schedule_changed", shortFail.status);
    await assertNoWrites(sShort, "SHORTENED SPECIAL DAY no writes");

    const sProv = await seedWorld("prov-hours", {
      businessHours: weekHours("10:00", "20:30"),
      mariaSchedule: weekSchedule("12:00", "18:00")
    });
    const earlyProv = await createFromPlan(sProv, "m-prov-early", { startMin: 11 * 60 });
    check("PROVIDER 12-18 rejects 11:00", earlyProv.status === "provider_schedule_changed", earlyProv.status);
    const validProv = await createFromPlan(sProv, "m-prov-ok", { startMin: 13 * 60 });
    check("PROVIDER 12-18 accepts 13:00", validProv.status === "created", validProv.status);

    const sLate = await seedWorld("late-start", {
      businessHours: weekHours("10:00", "20:30"),
      mariaSchedule: weekSchedule("10:00", "18:00")
    });
    await db.doc("salons/" + sLate + "/inboxItems/late-1").set({
      type: "late_start",
      status: "approved",
      createdByUid: "uid-maria",
      createdByStaffId: "maria",
      data: { subjectStaffId: "maria", date: "2026-09-14", requestedTime: "12:00" }
    });
    const lateFail = await createFromPlan(sLate, "m-late-fail", { startMin: 11 * 60 });
    check("APPROVED LATE START rejects 11:00", lateFail.status === "provider_schedule_changed", lateFail.status);
    const lateOk = await createFromPlan(sLate, "m-late-ok", { startMin: 12 * 60 });
    check("APPROVED LATE START accepts 12:00", lateOk.status === "created", lateOk.status);

    const sVac = await seedWorld("vacation");
    await db.doc("salons/" + sVac + "/inboxItems/vac-1").set({
      type: "vacation",
      status: "approved",
      createdByStaffId: "maria",
      data: { subjectStaffId: "maria", startDate: "2026-09-14", endDate: "2026-09-16" }
    });
    const vac = await createFromPlan(sVac, "m-vac", { startMin: TWO });
    check("APPROVED VACATION rejects", vac.status === "provider_schedule_changed", vac.status);
    await assertNoWrites(sVac, "APPROVED VACATION no writes");

    const sPend = await seedWorld("pending-vac");
    await db.doc("salons/" + sPend + "/inboxItems/vac-pend").set({
      type: "vacation",
      status: "pending",
      createdByStaffId: "maria",
      data: { subjectStaffId: "maria", startDate: "2026-09-14", endDate: "2026-09-16" }
    });
    const pend = await createFromPlan(sPend, "m-pend", { startMin: TWO });
    check("PENDING VACATION does not block", pend.status === "created", pend.status);

    const sDenied = await seedWorld("denied-vac");
    await db.doc("salons/" + sDenied + "/inboxItems/vac-denied").set({
      type: "vacation",
      status: "denied",
      createdByStaffId: "maria",
      data: { subjectStaffId: "maria", startDate: "2026-09-14", endDate: "2026-09-16" }
    });
    const denied = await createFromPlan(sDenied, "m-denied", { startMin: TWO });
    check("DENIED VACATION does not block", denied.status === "created", denied.status);

    const sDayOff = await seedWorld("day-off");
    await db.doc("salons/" + sDayOff + "/inboxItems/day-off-1").set({
      type: "day_off",
      status: "approved",
      createdByStaffId: "maria",
      data: { subjectStaffId: "maria", date: "2026-09-14" }
    });
    const dayOff = await createFromPlan(sDayOff, "m-dayoff", { startMin: TWO });
    check("APPROVED DAY OFF rejects", dayOff.status === "provider_schedule_changed", dayOff.status);
    await assertNoWrites(sDayOff, "APPROVED DAY OFF no writes");

    const sEarly = await seedWorld("early-leave", {
      businessHours: weekHours("10:00", "20:30"),
      mariaSchedule: weekSchedule("10:00", "18:00")
    });
    await db.doc("salons/" + sEarly + "/inboxItems/early-1").set({
      type: "early_leave",
      status: "approved",
      createdByStaffId: "maria",
      data: { subjectStaffId: "maria", date: "2026-09-14", requestedTime: "14:00" }
    });
    const earlyFail = await createFromPlan(sEarly, "m-early-fail", { startMin: 14 * 60 });
    check("APPROVED EARLY LEAVE rejects 14:00", earlyFail.status === "provider_schedule_changed", earlyFail.status);
    const earlyOk = await createFromPlan(sEarly, "m-early-ok", { startMin: 13 * 60 });
    check("APPROVED EARLY LEAVE accepts 13:00", earlyOk.status === "created", earlyOk.status);

    const sChange = await seedWorld("sched-change");
    await db.doc("salons/" + sChange + "/inboxItems/change-1").set({
      type: "schedule_change",
      status: "approved",
      createdByStaffId: "maria",
      data: { subjectStaffId: "maria", startDate: "2026-09-14", endDate: "2026-09-14" }
    });
    const changed = await createFromPlan(sChange, "m-change", { startMin: TWO });
    check("APPROVED SCHEDULE CHANGE is full-day unavailable", changed.status === "provider_schedule_changed", changed.status);
    await assertNoWrites(sChange, "APPROVED SCHEDULE CHANGE no writes");

    const sLoc = await seedWorld("loc-assign");
    await db.doc("salons/" + sLoc + "/staff/maria").set({
      firstName: "Maria",
      lastName: "Chen",
      displayName: "Maria Chen",
      allowedLocationIds: ["locOther"],
      technicianTypes: ["gel"],
      defaultSchedule: weekSchedule("09:00", "18:00")
    }, { merge: true });
    const locFail = await createFromPlan(sLoc, "m-loc", { startMin: TWO });
    check("LOCATION ASSIGNMENT rejects other-location provider", locFail.status === "provider_not_bookable_at_location", locFail.status);
    await assertNoWrites(sLoc, "LOCATION ASSIGNMENT no writes");

    const sCap = await seedWorld("cap");
    await db.doc("salons/" + sCap + "/services/svc-gel").set({
      name: "Gel Manicure",
      defaultPrice: 100,
      staffOverrides: { maria: { enabled: false, price: 80 } }
    });
    const cap = await createFromPlan(sCap, "m-cap", { startMin: TWO });
    check("DISABLED PROVIDER provider_not_eligible_for_service", cap.status === "provider_not_eligible_for_service", cap.status);
    check("DISABLED PROVIDER price override is not eligibility", cap.status !== "created");
    await assertNoWrites(sCap, "DISABLED PROVIDER no writes");

    const sAfter = await seedWorld("cap-after");
    const afterPrep = readyCommand(gelPlan(), { acceptanceId: "after-1" });
    check("capability-after command stays ready", afterPrep.status === "ready");
    await db.doc("salons/" + sAfter + "/services/svc-gel").set({
      name: "Gel Manicure",
      defaultPrice: 100,
      staffOverrides: { maria: { enabled: false } }
    });
    const after = await call(AUTH_A, {
      mutationType: "create",
      salonId: sAfter,
      mutationId: "m-after",
      bookingCommand: afterPrep.bookingCommand,
      transactionPreconditions: afterPrep.transactionPreconditions
    });
    check("CAPABILITY AFTER OFFER rejects intact command", after.status === "provider_not_eligible_for_service", after.status);
    await assertNoWrites(sAfter, "CAPABILITY AFTER OFFER no writes");

    const sMoveBad = await seedWorld("upd-unavail", {
      businessHours: weekHours("10:00", "20:30"),
      mariaSchedule: weekSchedule("12:00", "18:00")
    });
    const moveBase = await createFromPlan(sMoveBad, "m-upd-base", { startMin: 13 * 60 });
    check("UPDATE base create at 13:00", moveBase.status === "created", moveBase.status);
    const moveEarly = await call(AUTH_A, {
      mutationType: "update",
      salonId: sMoveBad,
      mutationId: "m-upd-early",
      appointmentId: moveBase.appointmentId,
      expectedAppointmentRevision: 1,
      locationId: "locA",
      dateKey: "2026-09-14",
      availabilityVersions: [{ locationId: "locA", version: 1 }],
      appointmentPayload: {
        clientId: "client-1",
        locationId: "locA",
        dateKey: "2026-09-14",
        serviceLines: [{
          lineId: "line-early",
          serviceId: "svc-gel",
          providerId: "maria",
          startMin: 11 * 60,
          endMin: 11 * 60 + 45,
          durationMinutes: 45
        }]
      },
      providerReservations: [{
        providerId: "maria",
        lineId: "line-early",
        startMin: 11 * 60,
        endMin: 11 * 60 + 45,
        locationId: "locA",
        dateKey: "2026-09-14"
      }]
    });
    check("UPDATE into 11:00 while Maria starts 12:00", moveEarly.status === "provider_schedule_changed", moveEarly.status);
    const stillOld = await ex.refsFor(sMoveBad).appointments.doc(moveBase.appointmentId).get();
    const stillMaria = await ex.refsFor(sMoveBad).providerDays.doc(api.providerDayGuardKey("locA", "2026-09-14", "maria")).get();
    check("UPDATE unavailable leaves old appointment", stillOld.data().revision === 1 && stillOld.data().status === "scheduled");
    check("UPDATE unavailable leaves old guard", stillMaria.exists && stillMaria.data().occupancies.length === 1);

    const sMoveAna = await seedWorld("upd-inelig");
    const anaBase = await createFromPlan(sMoveAna, "m-ana-base", { startMin: TWO });
    await db.doc("salons/" + sMoveAna + "/services/svc-gel").set({
      name: "Gel Manicure",
      defaultPrice: 100,
      staffOverrides: { ana: { enabled: false } }
    }, { merge: true });
    const moveAna = await call(AUTH_A, {
      mutationType: "update",
      salonId: sMoveAna,
      mutationId: "m-ana-bad",
      appointmentId: anaBase.appointmentId,
      expectedAppointmentRevision: 1,
      locationId: "locA",
      dateKey: "2026-09-14",
      availabilityVersions: [{ locationId: "locA", version: 1 }],
      appointmentPayload: {
        clientId: "client-1",
        locationId: "locA",
        dateKey: "2026-09-14",
        serviceLines: [{
          lineId: "line-ana",
          serviceId: "svc-gel",
          providerId: "ana",
          startMin: TWO + 60,
          endMin: TWO + 105,
          durationMinutes: 45
        }]
      },
      providerReservations: [{
        providerId: "ana",
        lineId: "line-ana",
        startMin: TWO + 60,
        endMin: TWO + 105,
        locationId: "locA",
        dateKey: "2026-09-14"
      }]
    });
    check("UPDATE to ineligible Ana rejected", moveAna.status === "provider_not_eligible_for_service", moveAna.status);
    const stillMariaAppt = await ex.refsFor(sMoveAna).appointments.doc(anaBase.appointmentId).get();
    const stillMariaGuard = await ex.refsFor(sMoveAna).providerDays.doc(api.providerDayGuardKey("locA", "2026-09-14", "maria")).get();
    check("UPDATE ineligible leaves Maria occupancy", stillMariaAppt.data().revision === 1 && stillMariaGuard.data().occupancies.length === 1);

    await ex.deleteSalonTree(sAuth);
    await ex.deleteSalonTree(sZero);
    await ex.deleteSalonTree(sMissing);
    await ex.deleteSalonTree(sTamper);
    await ex.deleteSalonTree(sEpoch);
    await ex.deleteSalonTree(sRace);
    await ex.deleteSalonTree(sClick);
    await ex.deleteSalonTree(sRes);
    await ex.deleteSalonTree(sUpd);
    await ex.deleteSalonTree(sClosed);
    await ex.deleteSalonTree(sSpecial);
    await ex.deleteSalonTree(sShort);
    await ex.deleteSalonTree(sProv);
    await ex.deleteSalonTree(sLate);
    await ex.deleteSalonTree(sVac);
    await ex.deleteSalonTree(sPend);
    await ex.deleteSalonTree(sDenied);
    await ex.deleteSalonTree(sDayOff);
    await ex.deleteSalonTree(sEarly);
    await ex.deleteSalonTree(sChange);
    await ex.deleteSalonTree(sLoc);
    await ex.deleteSalonTree(sCap);
    await ex.deleteSalonTree(sAfter);
    await ex.deleteSalonTree(sMoveBad);
    await ex.deleteSalonTree(sMoveAna);
  } finally {
    if (admin.apps.length) await admin.app().delete();
    if (emulator && emulator.child) emulator.child.kill();
  }

  if (failed) {
    console.error(failed + " Phase 18F handler checks failed.");
    process.exit(1);
  }
  console.log("All Phase 18F server-handler checks passed.");
}

function copyJson(value) {
  return JSON.parse(JSON.stringify(value));
}

main().catch(function (err) {
  console.error("PHASE 18F SUITE ABORTED. No staging/production fallback.", err);
  process.exit(2);
});
