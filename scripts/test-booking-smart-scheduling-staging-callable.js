/**
 * Phase 18F.1 remote smoke for the deployed executeBookingMutation callable.
 * Staging only. Refuses production and any other project.
 *
 * Usage:
 *   node scripts/test-booking-smart-scheduling-staging-callable.js --project fair-flow-staging
 *
 * Do not set FIRESTORE_EMULATOR_HOST. Never uses the default Firebase alias.
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const STAGING_PROJECT = "fair-flow-staging";
const PRODUCTION_PROJECT = "fairflowapp-db841";
const REGION = "us-central1";
const FUNCTION_NAME = "executeBookingMutation";
const STAGING_API_KEY = "AIzaSyDTBRAIbEmgx5uJ3I81mw5qfhlCpZAX4VI";
const TWO = 14 * 60;

require("../functions/booking-smart-scheduling/build-runtime").syncRuntime();
const { loadSmartSchedulingApi } = require("../functions/booking-smart-scheduling/load-smart-scheduling-api");
const { mutationStorageKey } = require("../functions/booking-smart-scheduling/firestore-atomic-executor");

const api = loadSmartSchedulingApi();

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

function failHard(message) {
  console.error("HARD FAIL:", message);
  process.exit(2);
}

function resolveTargetProject() {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--project");
  const fromArg = idx >= 0 ? String(args[idx + 1] || "").trim() : "";
  if (!fromArg) failHard("explicit --project fair-flow-staging is required");
  if (fromArg === PRODUCTION_PROJECT) failHard("production_project_forbidden");
  if (fromArg !== STAGING_PROJECT) failHard("unexpected_project: " + fromArg);
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    failHard("FIRESTORE_EMULATOR_HOST must be unset for staging smoke");
  }
  return STAGING_PROJECT;
}

function loadAdmin(projectId) {
  const adminPath = path.join(root, "scripts/lib/booking-smart-scheduling-emulator/node_modules/firebase-admin");
  if (!fs.existsSync(adminPath)) failHard("local firebase-admin missing under scripts/lib emulator helper");
  const admin = require(adminPath);
  const cfgPath = path.join(os.homedir(), ".config/configstore/firebase-tools.json");
  if (!fs.existsSync(cfgPath)) failHard("firebase-tools credentials missing");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const refresh = cfg && cfg.tokens && cfg.tokens.refresh_token;
  if (!refresh) failHard("firebase-tools refresh token missing");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ff-18f1-adc-"));
  fs.writeFileSync(path.join(tmp, "adc.json"), JSON.stringify({
    type: "authorized_user",
    client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
    client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi",
    refresh_token: refresh
  }));
  process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(tmp, "adc.json");
  process.env.GCLOUD_PROJECT = projectId;
  process.env.GOOGLE_CLOUD_PROJECT = projectId;
  if (admin.apps.length) {
    failHard("firebase-admin already initialized; refusing reused app");
  }
  admin.initializeApp({
    projectId: projectId,
    credential: admin.credential.applicationDefault()
  });
  const resolved = String(admin.app().options.projectId || "").trim();
  if (resolved !== projectId) failHard("admin project mismatch: " + resolved);
  return admin;
}

function weekHours() {
  const map = {};
  ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].forEach(function (day) {
    map[day] = { isOpen: true, openTime: "09:00", closeTime: "18:00" };
  });
  return map;
}

function weekSchedule() {
  const map = {};
  ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].forEach(function (day) {
    map[day] = { enabled: true, startTime: "09:00", endTime: "18:00" };
  });
  return map;
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

function gelPlan(extra) {
  const more = extra || {};
  const start = more.startMin != null ? more.startMin : TWO;
  const end = start + 45;
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
    resourceAssignmentKey: "",
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
      resourceAssignments: []
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
    [makeDay("maria")],
    [],
    offer,
    acceptance,
    { availabilityVersions: [{ locationId: "locA", version: extra && extra.epochVersion != null ? extra.epochVersion : 1 }] }
  );
}

function callableUrl() {
  return "https://" + REGION + "-" + STAGING_PROJECT + ".cloudfunctions.net/" + FUNCTION_NAME;
}

async function callRemote(idToken, data) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = "Bearer " + idToken;
  const res = await fetch(callableUrl(), {
    method: "POST",
    headers: headers,
    body: JSON.stringify({ data: data || {} })
  });
  let body = null;
  try {
    body = await res.json();
  } catch (err) {
    body = null;
  }
  if (body && body.result && typeof body.result === "object") {
    return { httpStatus: res.status, result: body.result, error: null };
  }
  const err = body && body.error ? body.error : {};
  const status = String(err.status || "").toLowerCase();
  const mapped = status === "unauthenticated"
    ? "unauthenticated"
    : (status === "permission-denied" || status === "permission_denied")
      ? "permission_denied"
      : (err.message || "http_" + res.status);
  return {
    httpStatus: res.status,
    result: { status: mapped, reasonCodes: [mapped] },
    error: err
  };
}

async function idTokenFor(admin, uid) {
  const custom = await admin.auth().createCustomToken(uid);
  const res = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=" + STAGING_API_KEY,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: custom, returnSecureToken: true })
    }
  );
  const body = await res.json();
  if (!body || !body.idToken) failHard("custom-token sign-in failed");
  return body.idToken;
}

async function deleteCollection(col) {
  const snap = await col.limit(200).get();
  if (snap.empty) return;
  const batch = col.firestore.batch();
  snap.docs.forEach(function (doc) { batch.delete(doc.ref); });
  await batch.commit();
  if (snap.size === 200) await deleteCollection(col);
}

async function deleteDocRecursive(docRef) {
  const cols = await docRef.listCollections();
  let i;
  for (i = 0; i < cols.length; i += 1) {
    const docs = await cols[i].listDocuments();
    let j;
    for (j = 0; j < docs.length; j += 1) {
      await deleteDocRecursive(docs[j]);
    }
  }
  await docRef.delete().catch(function () {});
}

async function countDescendants(docRef) {
  const cols = await docRef.listCollections();
  let total = 0;
  let i;
  for (i = 0; i < cols.length; i += 1) {
    const docs = await cols[i].listDocuments();
    total += docs.length;
    let j;
    for (j = 0; j < docs.length; j += 1) {
      total += await countDescendants(docs[j]);
    }
  }
  return total;
}

async function cleanup(admin, salonId, uid) {
  const db = admin.firestore();
  await deleteDocRecursive(db.doc("salons/" + salonId));
  if (uid) {
    await db.doc("users/" + uid + "/memberships/" + salonId).delete().catch(function () {});
    await db.doc("users/" + uid).delete().catch(function () {});
    try {
      await admin.auth().deleteUser(uid);
    } catch (err) {
      if (!err || err.code !== "auth/user-not-found") throw err;
    }
  }
}

async function main() {
  const projectId = resolveTargetProject();
  check("explicit project is fair-flow-staging", projectId === STAGING_PROJECT);
  const admin = loadAdmin(projectId);
  const resolved = String(admin.app().options.projectId || "");
  check("admin runtime project is fair-flow-staging", resolved === STAGING_PROJECT);
  if (resolved === PRODUCTION_PROJECT) failHard("admin resolved production");

  const suffix = Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
  const salonId = "ss-staging-smoke-" + suffix;
  const uid = "ss-smoke-uid-" + suffix;
  const db = admin.firestore();
  if (!/^ss-staging-smoke-/.test(salonId)) failHard("salon namespace invalid");

  let cleanupFailed = false;
  try {
    const unauth = await callRemote(null, {
      mutationType: "create",
      salonId: salonId,
      mutationId: "m-unauth"
    });
    check("REMOTE unauthenticated", unauth.result.status === "unauthenticated", unauth.result.status);

    await db.doc("salons/" + salonId).set({
      name: "18F.1 staging smoke",
      ownerUid: "not-this-user",
      smokeTest: true,
      phase: "18F.1"
    });
    await admin.auth().createUser({ uid: uid, disabled: false });
    const token = await idTokenFor(admin, uid);
    const denied = await callRemote(token, {
      mutationType: "create",
      salonId: salonId,
      mutationId: "m-denied"
    });
    check("REMOTE permission_denied before membership", denied.result.status === "permission_denied", denied.result.status);

    await db.doc("users/" + uid).set({
      salonId: salonId,
      role: "admin",
      smokeTest: true
    });
    await db.doc("salons/" + salonId + "/members/" + uid).set({
      role: "admin",
      staffId: "front-desk",
      smokeTest: true
    });
    await db.doc("users/" + uid + "/memberships/" + salonId).set({
      role: "admin",
      staffId: "front-desk",
      smokeTest: true
    });
    await db.doc("salons/" + salonId + "/clients/client-1").set({
      firstName: "Ada",
      lastName: "Lovelace",
      displayName: "Ada Lovelace",
      smokeTest: true
    });
    await db.doc("salons/" + salonId + "/services/svc-gel").set({
      name: "Gel Manicure",
      defaultPrice: 100,
      smokeTest: true
    });
    await db.doc("salons/" + salonId + "/staff/maria").set({
      firstName: "Maria",
      lastName: "Chen",
      displayName: "Maria Chen",
      allowedLocationIds: ["locA"],
      defaultSchedule: weekSchedule(),
      smokeTest: true
    });
    await db.doc("salons/" + salonId + "/bookingExecution/config").set({
      executionMode: "guarded",
      providerGuardsReady: true,
      writersConverted: true,
      mutationIdempotencyReady: true,
      availabilityWritersAudited: true,
      availabilityWritersAtomic: true,
      callableExecutorReady: true,
      resourceSystemReady: false,
      resourceEnforcementStartDateKey: "",
      configRevision: 1,
      smokeTest: true
    });
    await db.doc("salons/" + salonId + "/settings/main").set({
      booking: { allowedOverlapMinutes: 0, overlapPolicyRevision: 1 },
      preferences: { salonTimeZone: "America/New_York" },
      locationSchedules: { locA: { businessHours: weekHours(), specialBusinessDays: {} } },
      smokeTest: true
    });
    await db.doc("salons/" + salonId + "/bookingAvailabilityEpochs/locA").set({
      schemaVersion: 1,
      locationId: "locA",
      version: 1,
      config: {},
      smokeTest: true
    });

    const prepared = readyCommand(gelPlan(), { acceptanceId: "a-create" });
    check("prepared Phase 17 command ready", prepared.status === "ready", prepared.status);
    const created = await callRemote(token, {
      mutationType: "create",
      salonId: salonId,
      mutationId: "m-create",
      bookingCommand: prepared.bookingCommand,
      transactionPreconditions: prepared.transactionPreconditions,
      adapterContext: {
        servicesById: { "svc-gel": { name: "Forged", defaultPrice: 1 } },
        client: { clientId: "client-1", displayName: "Forged Client" }
      }
    });
    check("REMOTE create created", created.result.status === "created" && !!created.result.appointmentId, created.result.status);
    check("REMOTE create revision 1", created.result.appointmentRevision === 1, created.result.appointmentRevision);

    const appts = await db.collection("salons/" + salonId + "/appointments").get();
    const appt = created.result.appointmentId
      ? await db.doc("salons/" + salonId + "/appointments/" + created.result.appointmentId).get()
      : { exists: false };
    const apptData = appt.exists ? appt.data() : {};
    const line = apptData.serviceLines && apptData.serviceLines[0] ? apptData.serviceLines[0] : {};
    const guardKey = api.providerDayGuardKey("locA", "2026-09-14", "maria");
    const guard = await db.doc("salons/" + salonId + "/bookingProviderDays/" + guardKey).get();
    const muts = await db.collection("salons/" + salonId + "/bookingMutations").get();
    check("REMOTE one appointment", appts.size === 1 && appt.exists);
    check("REMOTE canonical service price 100", line.priceSnapshot === 100);
    check("REMOTE canonical service name", line.serviceNameSnapshot === "Gel Manicure");
    check("REMOTE canonical provider", line.providerId === "maria" && line.providerNameSnapshot === "Maria Chen");
    check("REMOTE canonical client snapshot", !!(apptData.clientSnapshot && apptData.clientSnapshot.displayName === "Ada Lovelace"));
    check("REMOTE forged adapterContext ignored", line.priceSnapshot !== 1 && !(apptData.clientSnapshot && apptData.clientSnapshot.displayName === "Forged Client"));
    check("REMOTE provider guard occupancy", guard.exists && Array.isArray(guard.data().occupancies) && guard.data().occupancies.length === 1);
    check("REMOTE one mutation record", muts.size === 1);
    check("REMOTE mutation storage key sha256", muts.size === 1 && /^[a-f0-9]{64}$/.test(muts.docs[0].id));
    const expectedKey = mutationStorageKey(api.mutationIdempotencyKey(salonId, "create", "m-create"));
    check("REMOTE mutation key matches server sha256", muts.size === 1 && muts.docs[0].id === expectedKey);

    const retry = await callRemote(token, {
      mutationType: "create",
      salonId: salonId,
      mutationId: "m-create",
      bookingCommand: prepared.bookingCommand,
      transactionPreconditions: prepared.transactionPreconditions
    });
    check("REMOTE double-click already_completed", retry.result.status === "already_completed", retry.result.status);
    check("REMOTE double-click same appointmentId", retry.result.appointmentId === created.result.appointmentId);
    const apptsAfter = await db.collection("salons/" + salonId + "/appointments").get();
    const guardAfter = await db.doc("salons/" + salonId + "/bookingProviderDays/" + guardKey).get();
    const mutsAfter = await db.collection("salons/" + salonId + "/bookingMutations").get();
    check("REMOTE double-click still one appointment", apptsAfter.size === 1);
    check("REMOTE double-click occupancy unchanged", guardAfter.exists && guardAfter.data().occupancies.length === 1);
    check("REMOTE double-click guard revision unchanged", guardAfter.data().revision === guard.data().revision);
    check("REMOTE double-click one mutation record", mutsAfter.size === 1);

    const conflictPrep = readyCommand(gelPlan(), { acceptanceId: "a-conflict" });
    const conflict = await callRemote(token, {
      mutationType: "create",
      salonId: salonId,
      mutationId: "m-conflict",
      bookingCommand: conflictPrep.bookingCommand,
      transactionPreconditions: conflictPrep.transactionPreconditions
    });
    check("REMOTE provider_conflict", conflict.result.status === "provider_conflict", conflict.result.status);
    const apptsConflict = await db.collection("salons/" + salonId + "/appointments").get();
    const guardConflict = await db.doc("salons/" + salonId + "/bookingProviderDays/" + guardKey).get();
    check("REMOTE conflict no second appointment", apptsConflict.size === 1);
    check("REMOTE conflict occupancy still one", guardConflict.exists && guardConflict.data().occupancies.length === 1);

    const stalePrep = readyCommand(gelPlan({ startMin: 15 * 60 }), { acceptanceId: "a-stale", epochVersion: 1 });
    check("stale-epoch command ready", stalePrep.status === "ready");
    await db.runTransaction(async function (tx) {
      const ref = db.doc("salons/" + salonId + "/bookingAvailabilityEpochs/locA");
      const snap = await tx.get(ref);
      const prev = snap.exists ? snap.data() : { version: 1, config: {} };
      tx.set(ref, {
        schemaVersion: 1,
        locationId: "locA",
        version: Number(prev.version || 0) + 1,
        config: Object.assign({}, prev.config || {}, { smokeBump: true }),
        smokeTest: true
      });
    });
    const stale = await callRemote(token, {
      mutationType: "create",
      salonId: salonId,
      mutationId: "m-stale",
      bookingCommand: stalePrep.bookingCommand,
      transactionPreconditions: stalePrep.transactionPreconditions
    });
    check("REMOTE availability_version_changed", stale.result.status === "availability_version_changed", stale.result.status);
    const apptsEpoch = await db.collection("salons/" + salonId + "/appointments").get();
    check("REMOTE stale epoch created no extra appointment", apptsEpoch.size === 1);
  } catch (err) {
    failed += 1;
    console.error("FAIL: staging smoke aborted", err && err.message ? err.message : err);
  } finally {
    try {
      await cleanup(admin, salonId, uid);
      const salonSnap = await admin.firestore().doc("salons/" + salonId).get();
      const leftover = salonSnap.exists ? 1 + await countDescendants(salonSnap.ref) : await countDescendants(admin.firestore().doc("salons/" + salonId));
      const userSnap = await admin.firestore().doc("users/" + uid).get();
      const memberSnap = await admin.firestore().doc("users/" + uid + "/memberships/" + salonId).get();
      let authGone = false;
      try {
        await admin.auth().getUser(uid);
        authGone = false;
      } catch (err) {
        authGone = !!(err && err.code === "auth/user-not-found");
      }
      check("CLEANUP salon doc absent", !salonSnap.exists);
      check("CLEANUP no salon descendants", leftover === 0, leftover);
      check("CLEANUP user profile absent", !userSnap.exists);
      check("CLEANUP user membership absent", !memberSnap.exists);
      check("CLEANUP auth user absent", authGone);
      if (salonSnap.exists || leftover || userSnap.exists || memberSnap.exists || !authGone) {
        cleanupFailed = true;
      }
    } catch (err) {
      cleanupFailed = true;
      failed += 1;
      console.error("FAIL: CLEANUP threw", err && err.message ? err.message : err);
    }
    if (admin.apps.length) await admin.app().delete();
  }

  const logs = spawnSync("firebase", [
    "functions:log",
    "--only", FUNCTION_NAME,
    "--project", STAGING_PROJECT
  ], { cwd: root, encoding: "utf8", timeout: 30000 });
  const logText = String(logs.stdout || "") + String(logs.stderr || "");
  check("LOGS command ran", logs.status === 0 || logText.length > 0);
  check("LOGS no production project id", logText.indexOf(PRODUCTION_PROJECT) === -1);
  check("LOGS no adapter forged name", logText.indexOf("Forged Client") === -1);
  check("LOGS no custom token dump", logText.indexOf("eyJ") === -1);

  if (cleanupFailed) {
    console.error("CLEANUP FAILED. STOP. Temporary staging fixtures may remain: " + salonId);
    process.exit(2);
  }
  if (failed) {
    console.error(failed + " staging callable smoke checks failed.");
    process.exit(1);
  }
  console.log("All Phase 18F.1 staging callable smoke checks passed.");
}

main().catch(function (err) {
  console.error("STAGING SMOKE ABORTED.", err && err.message ? err.message : err);
  process.exit(2);
});
