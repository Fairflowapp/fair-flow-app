/**
 * Smart Scheduling Phase 18E/18F — shared Firestore atomic booking executor.
 *
 * Node/server only. Reuses Phase 18D evaluateAtomicMutation as the algorithm.
 * Consumed by emulator tests and the executeBookingMutation callable.
 * Does not load in the Booking UI, appointments/data.js, Calendar, or Reports.
 *
 * Firestore-specific differences vs Phase 18D (documented, not competing):
 * - bookingMutations are stored under SHA-256(full mutationIdempotencyKey)
 * - Admin runTransaction performs real contention retries
 * - status mutations skip unused guard reads to avoid extra contention
 * - 18E tests may pass candidateAppointmentId; the callable preallocates
 *   a Firestore auto-id before the transaction
 */
"use strict";

const crypto = require("crypto");

const FORBIDDEN_PROJECTS = Object.freeze(["fairflowapp-db841", "fair-flow-staging"]);
const TEST_PROJECT_ID = "fair-flow-smart-scheduling-emulator";
const SCHEMA = 1;

function mutationStorageKey(fullKey) {
  return crypto.createHash("sha256").update(String(fullKey || ""), "utf8").digest("hex");
}

function assertEmulatorIsolation(projectId, emulatorHost) {
  const host = String(emulatorHost || "").trim();
  const project = String(projectId || "").trim();
  if (!host) {
    const err = new Error("FIRESTORE_EMULATOR_HOST is required. Refusing Firestore writes.");
    err.code = "emulator_required";
    throw err;
  }
  if (FORBIDDEN_PROJECTS.indexOf(project) !== -1) {
    const err = new Error("Refusing real Firebase project " + project);
    err.code = "real_project_forbidden";
    throw err;
  }
  if (project !== TEST_PROJECT_ID) {
    const err = new Error("Refusing unexpected projectId " + project + "; expected " + TEST_PROJECT_ID);
    err.code = "unexpected_project";
    throw err;
  }
}

function assertCallableIsolation(projectId, emulatorHost) {
  const host = String(emulatorHost || "").trim();
  const project = String(projectId || "").trim();
  if (project === "fairflowapp-db841") {
    const err = new Error("production_project_forbidden");
    err.code = "production_project_forbidden";
    throw err;
  }
  if (project !== TEST_PROJECT_ID && project !== "fair-flow-staging") {
    const err = new Error("unexpected_project");
    err.code = "unexpected_project";
    throw err;
  }
  if (project === TEST_PROJECT_ID && !host) {
    const err = new Error("FIRESTORE_EMULATOR_HOST is required. Refusing Firestore writes.");
    err.code = "emulator_required";
    throw err;
  }
}

function copyJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function trimText(value) {
  return String(value == null ? "" : value).trim();
}

function sortIds(list) {
  return (list || []).slice().sort();
}

function isRetryableTransactionError(err) {
  const code = err && err.code;
  const msg = String(err && err.message || err || "");
  return code === 10
    || code === "ABORTED"
    || /aborted|contention|invalid or closed|too much contention|failed precondition/i.test(msg);
}

function logicalResult(result, extras) {
  return Object.assign({
    status: result.status,
    appointmentId: result.appointmentId || null,
    appointmentRevision: result.appointmentRevision != null ? result.appointmentRevision : null,
    mutationId: result.mutationId || null,
    mutationFingerprint: result.mutationFingerprint || null,
    resultStatus: result.resultStatus || result.status,
    reasonCodes: result.reasonCodes || [],
    touchedProviderGuards: result.touchedProviderGuards || [],
    touchedResourceGuards: result.touchedResourceGuards || [],
    storageKey: extras && extras.storageKey || null,
    transactionAttempts: extras && extras.transactionAttempts || 0,
    writesPerformed: !!(result.writes)
  }, extras || {});
}

function settingsFromMain(data) {
  const booking = data && data.booking && typeof data.booking === "object" ? data.booking : (data || {});
  return {
    allowedOverlapMinutes: booking.allowedOverlapMinutes != null ? booking.allowedOverlapMinutes : 0,
    overlapPolicyRevision: Number(booking.overlapPolicyRevision || 1)
  };
}

function createFirestoreAtomicExecutor(options) {
  const opts = options || {};
  const admin = opts.admin;
  const api = opts.api;
  const db = opts.db;
  const projectId = opts.projectId || TEST_PROJECT_ID;
  const emulatorHost = opts.emulatorHost || process.env.FIRESTORE_EMULATOR_HOST;
  if (opts.isolation === "callable") {
    assertCallableIsolation(projectId, emulatorHost);
  } else {
    assertEmulatorIsolation(projectId, emulatorHost);
  }
  if (!admin || !db || !api || typeof api.evaluateAtomicMutation !== "function") {
    throw new Error("Firestore atomic executor requires admin, db, and Phase 18D evaluateAtomicMutation.");
  }

  function salonDoc(salonId) {
    return db.collection("salons").doc(trimText(salonId));
  }

  function refsFor(salonId) {
    const salon = salonDoc(salonId);
    return {
      salon: salon,
      appointments: salon.collection("appointments"),
      providerDays: salon.collection("bookingProviderDays"),
      resources: salon.collection("bookingResources"),
      resourceDays: salon.collection("bookingResourceDays"),
      mutations: salon.collection("bookingMutations"),
      epochs: salon.collection("bookingAvailabilityEpochs"),
      execution: salon.collection("bookingExecution"),
      settings: salon.collection("settings")
    };
  }

  function collectResourceIds(mutation, appointment) {
    const ids = {};
    function add(row) {
      const id = trimText(row && row.resourceId);
      if (id) ids[id] = true;
    }
    (mutation && mutation.resourceReservations || []).forEach(add);
    (appointment && appointment.resourceReservations || []).forEach(add);
    return sortIds(Object.keys(ids));
  }

  function collectGuardMeta(mutation, appointment) {
    return api.evaluateAtomicMutation
      ? (function () {
        const keys = {
          providers: {},
          resources: {}
        };
        function addProvider(row) {
          if (!row || !row.providerId) return;
          const key = api.providerDayGuardKey(row.locationId, row.dateKey, row.providerId);
          keys.providers[key] = { locationId: row.locationId, dateKey: row.dateKey, providerId: row.providerId };
        }
        function addResource(row) {
          if (!row || !row.resourceId) return;
          const key = api.resourceDayGuardKey(row.locationId, row.dateKey, row.resourceId);
          keys.resources[key] = { locationId: row.locationId, dateKey: row.dateKey, resourceId: row.resourceId };
        }
        (mutation && mutation.providerReservations || []).forEach(addProvider);
        (mutation && mutation.resourceReservations || []).forEach(addResource);
        if (appointment) {
          (appointment.providerReservations || []).forEach(addProvider);
          (appointment.resourceReservations || []).forEach(addResource);
        }
        return keys;
      }())
      : { providers: {}, resources: {} };
  }

  async function deleteCollection(col) {
    const snap = await col.get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach(function (doc) { batch.delete(doc.ref); });
    await batch.commit();
  }

  async function deleteSalonTree(salonId) {
    const refs = refsFor(salonId);
    await deleteCollection(refs.appointments);
    await deleteCollection(refs.providerDays);
    await deleteCollection(refs.resources);
    await deleteCollection(refs.resourceDays);
    await deleteCollection(refs.mutations);
    await deleteCollection(refs.epochs);
    await deleteCollection(refs.execution);
    await deleteCollection(refs.settings);
    await deleteCollection(refs.salon.collection("clients"));
    await deleteCollection(refs.salon.collection("staff"));
    await deleteCollection(refs.salon.collection("members"));
    await deleteCollection(refs.salon.collection("services"));
    await deleteCollection(refs.salon.collection("inboxItems"));
    await refs.salon.delete().catch(function () { /* missing salon doc is fine */ });
  }

  async function seedGuardedSalon(salonId, extra) {
    const more = extra || {};
    const refs = refsFor(salonId);
    const config = Object.assign({
      executionMode: "guarded",
      providerGuardsReady: true,
      writersConverted: true,
      mutationIdempotencyReady: true,
      availabilityWritersAudited: true,
      availabilityWritersAtomic: true,
      resourceSystemReady: more.resourceSystemReady === true,
      resourceEnforcementStartDateKey: more.resourceEnforcementStartDateKey || "",
      callableExecutorReady: true,
      concurrencyTestsGreen: false,
      configRevision: 1
    }, more.executionConfig || {});
    const settings = {
      booking: {
        allowedOverlapMinutes: more.allowedOverlapMinutes != null ? more.allowedOverlapMinutes : 0,
        overlapPolicyRevision: more.overlapPolicyRevision != null ? more.overlapPolicyRevision : 1
      }
    };
    const locationId = more.locationId || "locA";
    const epochVersion = more.epochVersion != null ? more.epochVersion : 1;
    await refs.execution.doc("config").set(config);
    await refs.settings.doc("main").set(settings);
    await refs.epochs.doc(locationId).set({
      schemaVersion: SCHEMA,
      locationId: locationId,
      version: epochVersion,
      config: more.availabilityConfig || {}
    });
    const resources = more.resourceDefinitions || {};
    const resourceIds = Object.keys(resources);
    let i;
    for (i = 0; i < resourceIds.length; i += 1) {
      await refs.resources.doc(resourceIds[i]).set(Object.assign({
        schemaVersion: SCHEMA,
        salonId: salonId
      }, resources[resourceIds[i]]));
    }
    return { salonId: salonId, locationId: locationId, epochVersion: epochVersion };
  }

  async function applyAvailabilityMutation(salonId, patch) {
    const req = patch || {};
    const locationIds = sortIds((req.locationIds || []).map(trimText).filter(Boolean));
    if (!locationIds.length) {
      return { status: "mutation_invalid", reasonCodes: ["location_ids_required"], transactionAttempts: 0 };
    }
    const refs = refsFor(salonId);
    let attempts = 0;
    const epochs = {};
    let outer = 0;
    while (outer < 6) {
      outer += 1;
      try {
        await db.runTransaction(async function (tx) {
      attempts += 1;
      if (req.onTransactionAttempt) req.onTransactionAttempt(attempts);
      const epochSnaps = {};
      let i;
      for (i = 0; i < locationIds.length; i += 1) {
        epochSnaps[locationIds[i]] = await tx.get(refs.epochs.doc(locationIds[i]));
      }
      const resourceIds = sortIds(Object.keys(req.resourceDefinitions || {}));
      const resourceSnaps = {};
      for (i = 0; i < resourceIds.length; i += 1) {
        resourceSnaps[resourceIds[i]] = await tx.get(refs.resources.doc(resourceIds[i]));
      }
      for (i = 0; i < locationIds.length; i += 1) {
        const locationId = locationIds[i];
        const prev = epochSnaps[locationId].exists ? epochSnaps[locationId].data() : { version: 0, config: {} };
        const nextVersion = Number(prev.version || 0) + 1;
        const incoming = req.availabilityConfig && req.availabilityConfig[locationId];
        const config = Object.assign({}, prev.config || {}, incoming || {});
        epochs[locationId] = { version: nextVersion };
        tx.set(refs.epochs.doc(locationId), {
          schemaVersion: SCHEMA,
          locationId: locationId,
          version: nextVersion,
          config: config
        });
      }
      for (i = 0; i < resourceIds.length; i += 1) {
        const resourceId = resourceIds[i];
        const prev = resourceSnaps[resourceId].exists ? resourceSnaps[resourceId].data() : { resourceId: resourceId };
        tx.set(refs.resources.doc(resourceId), Object.assign({}, prev, copyJson(req.resourceDefinitions[resourceId]), {
          schemaVersion: SCHEMA,
          salonId: salonId
        }));
      }
        });
        break;
      } catch (err) {
        if (!isRetryableTransactionError(err) || outer >= 6) {
          return { status: "mutation_invalid", reasonCodes: ["transaction_failed"], transactionAttempts: attempts };
        }
      }
    }
    return { status: "availability_updated", locationIds: locationIds, epochs: epochs, transactionAttempts: attempts };
  }

  async function executeAtomicMutation(mutation, execOpts) {
    const extras = execOpts || {};
    if (!mutation || typeof mutation !== "object") {
      return logicalResult({ status: "mutation_invalid", reasonCodes: ["mutation_invalid"] }, { transactionAttempts: 0 });
    }
    const sealed = mutation.mutationFingerprint ? copyJson(mutation) : api.sealAtomicMutation(mutation);
    const expectedFp = api.atomicMutationFingerprint(sealed);
    if (!sealed.mutationFingerprint || sealed.mutationFingerprint !== expectedFp) {
      return logicalResult({
        status: sealed.smartScheduling ? "command_invalid" : "mutation_invalid",
        reasonCodes: ["mutation_integrity_mismatch"]
      }, { transactionAttempts: 0 });
    }
    const salonId = trimText(sealed.salonId);
    const mutationType = trimText(sealed.mutationType);
    const mutationId = trimText(sealed.mutationId);
    if (!salonId || !mutationType || !mutationId) {
      return logicalResult({ status: "mutation_invalid" }, { transactionAttempts: 0 });
    }
    const fullKey = sealed.mutationIdempotencyKey || api.mutationIdempotencyKey(salonId, mutationType, mutationId);
    const storageKey = mutationStorageKey(fullKey);
    const appointmentId = mutationType === "create"
      ? (trimText(sealed.candidateAppointmentId) || ("appt_" + mutationId))
      : trimText(sealed.appointmentId);
    const refs = refsFor(salonId);
    const mutationRef = refs.mutations.doc(storageKey);
    const configRef = refs.execution.doc("config");
    const settingsRef = refs.settings.doc("main");
    const appointmentRef = appointmentId ? refs.appointments.doc(appointmentId) : null;
    const epochIds = sortIds(((sealed.availabilityVersions || []).map(function (row) {
      return trimText(row && row.locationId);
    })).filter(Boolean));
    if (sealed.locationId && epochIds.indexOf(trimText(sealed.locationId)) === -1) {
      epochIds.push(trimText(sealed.locationId));
      epochIds.sort();
    }

    let attempts = 0;
    let outcome = null;
    let outer = 0;
    const maxOuter = 6;
    while (outer < maxOuter) {
      outer += 1;
      try {
        await db.runTransaction(async function (tx) {
      attempts += 1;
      if (extras.onTransactionAttempt) extras.onTransactionAttempt(attempts);

      const mutationSnap = await tx.get(mutationRef);
      const configSnap = await tx.get(configRef);
      const settingsSnap = await tx.get(settingsRef);
      const epochSnaps = {};
      let i;
      for (i = 0; i < epochIds.length; i += 1) {
        epochSnaps[epochIds[i]] = await tx.get(refs.epochs.doc(epochIds[i]));
      }
      const appointmentSnap = appointmentRef ? await tx.get(appointmentRef) : null;
      const existingAppointment = appointmentSnap && appointmentSnap.exists ? appointmentSnap.data() : null;

      const resourceIds = collectResourceIds(sealed, existingAppointment);
      const resourceSnaps = {};
      for (i = 0; i < resourceIds.length; i += 1) {
        resourceSnaps[resourceIds[i]] = await tx.get(refs.resources.doc(resourceIds[i]));
      }

      const needGuards = mutationType === "create" || mutationType === "update" || mutationType === "cancel";
      const guardMeta = needGuards ? collectGuardMeta(sealed, existingAppointment) : { providers: {}, resources: {} };
      const providerKeys = sortIds(Object.keys(guardMeta.providers));
      const resourceKeys = sortIds(Object.keys(guardMeta.resources));
      const providerSnaps = {};
      const resourceDaySnaps = {};
      for (i = 0; i < providerKeys.length; i += 1) {
        providerSnaps[providerKeys[i]] = await tx.get(refs.providerDays.doc(providerKeys[i]));
      }
      for (i = 0; i < resourceKeys.length; i += 1) {
        resourceDaySnaps[resourceKeys[i]] = await tx.get(refs.resourceDays.doc(resourceKeys[i]));
      }

      const store = {
        executionConfig: configSnap.exists ? configSnap.data() : { executionMode: "legacy" },
        settings: settingsFromMain(settingsSnap.exists ? settingsSnap.data() : {}),
        availabilityEpochs: {},
        availabilityConfig: {},
        providerAvailability: sealed.providerAvailability || {},
        providerDays: {},
        resourceDefinitions: {},
        resourceDays: {},
        appointments: {},
        bookingMutations: {}
      };
      for (i = 0; i < epochIds.length; i += 1) {
        const loc = epochIds[i];
        if (epochSnaps[loc].exists) {
          store.availabilityEpochs[loc] = { version: Number(epochSnaps[loc].data().version || 0) };
          store.availabilityConfig[loc] = epochSnaps[loc].data().config || {};
        }
      }
      for (i = 0; i < resourceIds.length; i += 1) {
        const resourceId = resourceIds[i];
        if (resourceSnaps[resourceId].exists) store.resourceDefinitions[resourceId] = resourceSnaps[resourceId].data();
      }
      for (i = 0; i < providerKeys.length; i += 1) {
        const key = providerKeys[i];
        if (providerSnaps[key].exists) store.providerDays[key] = providerSnaps[key].data();
      }
      for (i = 0; i < resourceKeys.length; i += 1) {
        const key = resourceKeys[i];
        if (resourceDaySnaps[key].exists) store.resourceDays[key] = resourceDaySnaps[key].data();
      }
      if (existingAppointment) store.appointments[appointmentId] = existingAppointment;
      if (mutationSnap.exists) {
        const row = mutationSnap.data();
        if (trimText(row.mutationIdempotencyKey) && trimText(row.mutationIdempotencyKey) !== fullKey) {
          outcome = logicalResult({
            status: "idempotency_identity_mismatch",
            reasonCodes: ["idempotency_identity_mismatch"]
          }, { storageKey: storageKey, transactionAttempts: attempts, writesPerformed: false });
          return;
        }
        store.bookingMutations[fullKey] = row;
      }

      if (typeof extras.onAfterReads === "function") {
        await extras.onAfterReads({ attempt: attempts, salonId: salonId });
      }

      const evaluated = api.evaluateAtomicMutation(store, sealed);
      const result = evaluated && evaluated.result ? evaluated.result : { status: "mutation_invalid" };
      if (!result.writes) {
        outcome = logicalResult(result, { storageKey: storageKey, transactionAttempts: attempts, writesPerformed: false });
        return;
      }

      const writes = result.writes;
      if (writes.appointment) {
        const appointmentWrite = Object.assign({}, writes.appointment, extras.persistAppointmentFields || {});
        tx.set(refs.appointments.doc(appointmentWrite.appointmentId), appointmentWrite);
      }
      Object.keys(writes.providerDays || {}).forEach(function (key) {
        tx.set(refs.providerDays.doc(key), writes.providerDays[key]);
      });
      Object.keys(writes.resourceDays || {}).forEach(function (key) {
        tx.set(refs.resourceDays.doc(key), writes.resourceDays[key]);
      });
      if (writes.bookingMutation) {
        const FieldValue = admin.firestore && admin.firestore.FieldValue;
        tx.set(mutationRef, Object.assign({}, writes.bookingMutation, {
          storageKey: storageKey,
          mutationIdempotencyKey: fullKey,
          createdAt: FieldValue && FieldValue.serverTimestamp ? FieldValue.serverTimestamp() : null
        }, extras.persistMutationFields || {}));
      }
      outcome = logicalResult(result, {
        storageKey: storageKey,
        transactionAttempts: attempts,
        writesPerformed: true
      });
        });
        break;
      } catch (err) {
        if (!isRetryableTransactionError(err) || outer >= maxOuter) {
          outcome = logicalResult({
            status: "mutation_invalid",
            reasonCodes: ["transaction_failed"]
          }, { storageKey: storageKey, transactionAttempts: attempts, writesPerformed: false });
          break;
        }
      }
    }

    if (!outcome) {
      return logicalResult({ status: "mutation_invalid" }, { storageKey: storageKey, transactionAttempts: attempts });
    }
    outcome.transactionAttempts = attempts;
    return outcome;
  }

  return {
    TEST_PROJECT_ID: TEST_PROJECT_ID,
    FORBIDDEN_PROJECTS: FORBIDDEN_PROJECTS,
    SCHEMA_VERSION: SCHEMA,
    mutationStorageKey: mutationStorageKey,
    assertEmulatorIsolation: assertEmulatorIsolation,
    assertCallableIsolation: assertCallableIsolation,
    salonDoc: salonDoc,
    refsFor: refsFor,
    seedGuardedSalon: seedGuardedSalon,
    deleteSalonTree: deleteSalonTree,
    applyAvailabilityMutation: applyAvailabilityMutation,
    executeAtomicMutation: executeAtomicMutation
  };
}

module.exports = {
  FORBIDDEN_PROJECTS: FORBIDDEN_PROJECTS,
  TEST_PROJECT_ID: TEST_PROJECT_ID,
  mutationStorageKey: mutationStorageKey,
  assertEmulatorIsolation: assertEmulatorIsolation,
  assertCallableIsolation: assertCallableIsolation,
  createFirestoreAtomicExecutor: createFirestoreAtomicExecutor
};
