/**
 * Phase 18F authorized server handler for executeBookingMutation.
 * Business logic is independent of the Functions onCall transport.
 */
"use strict";

const {
  EMULATOR_PROJECT,
  assertCallableRuntimeProject
} = require("./project-guard");
const {
  createFirestoreAtomicExecutor,
  mutationStorageKey
} = require("./firestore-atomic-executor");
const {
  loadScheduleInputs,
  evaluateOccupancyAuthority
} = require("./availability-resolver");

const PRODUCT_STATUSES = Object.freeze({
  created: true,
  updated: true,
  cancelled: true,
  status_updated: true,
  already_completed: true,
  already_cancelled: true,
  provider_conflict: true,
  provider_schedule_changed: true,
  resource_conflict: true,
  resource_schedule_changed: true,
  availability_version_changed: true,
  command_invalid: true,
  mutation_invalid: true,
  idempotency_identity_mismatch: true,
  appointment_revision_mismatch: true,
  guard_not_ready: true,
  resource_system_not_ready: true,
  overnight_not_supported: true,
  unauthenticated: true,
  permission_denied: true,
  adapter_invalid: true,
  production_project_forbidden: true,
  unexpected_project: true,
  client_required_for_booking: true,
  client_snapshot_required: true,
  service_snapshot_required: true,
  service_price_snapshot_required: true,
  provider_snapshot_required: true,
  client_context_mismatch: true,
  provider_not_eligible_for_service: true,
  provider_not_bookable_at_location: true,
  provider_not_bookable: true
});

function trimText(value) {
  return String(value == null ? "" : value).trim();
}

function copyJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function publicResult(result) {
  const reasons = Array.isArray(result && result.reasonCodes) ? result.reasonCodes.slice() : [];
  let status = result && result.status ? String(result.status) : "mutation_invalid";
  if (!PRODUCT_STATUSES[status]) {
    const mapped = reasons.find(function (code) { return PRODUCT_STATUSES[code]; });
    status = mapped || "mutation_invalid";
  }
  return {
    status: status,
    appointmentId: result && result.appointmentId || null,
    appointmentRevision: result && result.appointmentRevision != null ? result.appointmentRevision : null,
    reasonCodes: reasons
  };
}

function logSafe(fields) {
  console.log("[executeBookingMutation]", {
    salonId: fields.salonId || null,
    mutationType: fields.mutationType || null,
    mutationIdPrefix: trimText(fields.mutationId).slice(0, 12) || null,
    storageKeyPrefix: trimText(fields.storageKey).slice(0, 12) || null,
    status: fields.status || null,
    attempts: fields.attempts != null ? fields.attempts : null
  });
}

function fieldValue(admin) {
  return admin && admin.firestore && admin.firestore.FieldValue
    ? admin.firestore.FieldValue
    : null;
}

async function authorizeSalonMember(db, uid, salonId) {
  const [userSnap, salonSnap, memberSnap, membershipSnap] = await Promise.all([
    db.doc("users/" + uid).get(),
    db.doc("salons/" + salonId).get(),
    db.doc("salons/" + salonId + "/members/" + uid).get(),
    db.doc("users/" + uid + "/memberships/" + salonId).get()
  ]);
  if (!salonSnap.exists) return { ok: false };
  const salon = salonSnap.data() || {};
  if (trimText(salon.ownerUid) === uid) return { ok: true, role: "owner" };
  const user = userSnap.exists ? userSnap.data() || {} : {};
  if (trimText(user.salonId) === salonId) {
    return { ok: true, role: trimText(user.role) || "member" };
  }
  if (memberSnap.exists) {
    const member = memberSnap.data() || {};
    return { ok: true, role: trimText(member.role) || "member" };
  }
  if (membershipSnap.exists) {
    const membership = membershipSnap.data() || {};
    return { ok: true, role: trimText(membership.role) || "member" };
  }
  return { ok: false };
}

async function loadClient(db, salonId, clientId) {
  const id = trimText(clientId);
  if (!id) return null;
  const snap = await db.doc("salons/" + salonId + "/clients/" + id).get();
  if (!snap.exists) return null;
  return Object.assign({ clientId: snap.id }, snap.data());
}

async function loadService(db, salonId, serviceId) {
  const id = trimText(serviceId);
  if (!id) return null;
  const local = await db.doc("salons/" + salonId + "/services/" + id).get();
  if (local.exists) return Object.assign({ id: local.id }, local.data());
  const shared = await db.doc("accounts/" + salonId + "/shared/serviceCatalog/items/" + id).get();
  if (shared.exists) return Object.assign({ id: shared.id }, shared.data());
  return null;
}

async function loadStaff(db, salonId, providerId) {
  const id = trimText(providerId);
  if (!id) return null;
  const snap = await db.doc("salons/" + salonId + "/staff/" + id).get();
  if (!snap.exists) return null;
  return Object.assign({ id: snap.id, staffId: snap.id }, snap.data());
}

function adapterStatus(adapted) {
  const reasons = (adapted && adapted.reasonCodes) || [];
  const specific = [
    "command_integrity_mismatch",
    "client_required_for_booking",
    "client_context_mismatch",
    "client_snapshot_required",
    "service_snapshot_required",
    "service_price_snapshot_required",
    "provider_snapshot_required"
  ];
  let i;
  for (i = 0; i < specific.length; i += 1) {
    if (reasons.indexOf(specific[i]) !== -1) {
      return specific[i] === "command_integrity_mismatch"
        ? publicResult({ status: "command_invalid", reasonCodes: reasons })
        : publicResult({ status: specific[i], reasonCodes: reasons });
    }
  }
  return publicResult({ status: "adapter_invalid", reasonCodes: reasons });
}

async function authorizeLiveSchedule(db, salonId, locationId, dateKey, lines, staffById, servicesById, bookingModel) {
  const loaded = await loadScheduleInputs(db, salonId, locationId);
  if (!loaded.epochStable) {
    return { ok: false, status: "availability_version_changed", reasonCodes: ["availability_version_changed"] };
  }
  const evaluated = evaluateOccupancyAuthority({
    lines: lines,
    staffById: staffById,
    servicesById: servicesById,
    locationId: locationId,
    dateKey: dateKey,
    bookingModel: bookingModel,
    settings: loaded.settings,
    requests: loaded.requests
  });
  if (!evaluated.ok) {
    return { ok: false, status: evaluated.status, reasonCodes: [evaluated.status] };
  }
  return {
    ok: true,
    providerAvailability: evaluated.providerAvailability,
    epochVersion: loaded.epochVersion
  };
}

function persistenceFields(adapted, actorUid, mutationType, extras) {
  const preview = adapted && adapted.persistencePreview ? adapted.persistencePreview : null;
  const lines = preview && preview.serviceLines ? preview.serviceLines : [];
  const fields = {
    clientSnapshot: preview && preview.clientSnapshot ? copyJson(preview.clientSnapshot) : null,
    source: preview && preview.source || "internal",
    assignmentType: preview && preview.assignmentType || "specific_provider",
    notes: preview && preview.notes || "",
    startAt: preview && preview.startAt || null,
    endAt: preview && preview.endAt || null
  };
  if (lines.length) {
    fields.serviceLines = lines.map(function (line) {
      return {
        lineId: line.lineId,
        serviceId: line.serviceId,
        serviceNameSnapshot: line.serviceNameSnapshot,
        providerId: line.providerId,
        providerNameSnapshot: line.providerNameSnapshot,
        startAt: line.startAt,
        endAt: line.endAt,
        durationMinutes: line.durationMinutes,
        priceSnapshot: line.priceSnapshot,
        guestKey: line.guestKey || "",
        guestName: line.guestName || "",
        requested: line.requested === true
      };
    });
  }
  if (mutationType === "create") fields.createdByUid = actorUid;
  if (mutationType === "update" || mutationType === "status") fields.updatedByUid = actorUid;
  if (mutationType === "cancel") {
    fields.cancelledByUid = actorUid;
    if (extras && extras.cancellationReason) fields.cancellationReason = extras.cancellationReason;
  }
  return fields;
}

function attachTimestamps(fields, admin, mutationType) {
  const fv = fieldValue(admin);
  if (!fv || !fv.serverTimestamp) return fields;
  const stamped = Object.assign({}, fields);
  const now = fv.serverTimestamp();
  if (mutationType === "create") {
    stamped.createdAt = now;
    stamped.updatedAt = now;
  } else if (mutationType === "cancel") {
    stamped.cancelledAt = now;
    stamped.updatedAt = now;
  } else {
    stamped.updatedAt = now;
  }
  return stamped;
}

async function loadAdapterContext(db, salonId, bookingCommand) {
  const clientId = trimText(bookingCommand && bookingCommand.clientId);
  const client = await loadClient(db, salonId, clientId);
  const servicesById = {};
  const staffById = {};
  const lines = bookingCommand && Array.isArray(bookingCommand.serviceLines) ? bookingCommand.serviceLines : [];
  let i;
  for (i = 0; i < lines.length; i += 1) {
    const serviceId = trimText(lines[i] && lines[i].serviceId);
    const providerId = trimText(lines[i] && lines[i].providerId);
    if (serviceId && !servicesById[serviceId]) {
      const service = await loadService(db, salonId, serviceId);
      if (service) servicesById[serviceId] = service;
    }
    if (providerId && !staffById[providerId]) {
      const staff = await loadStaff(db, salonId, providerId);
      if (staff) staffById[providerId] = staff;
    }
  }
  return {
    salonId: salonId,
    client: client ? Object.assign({ clientId: client.clientId || clientId }, client) : null,
    servicesById: servicesById,
    staffById: staffById
  };
}

function buildDirectMutation(api, data, salonId, actorUid, extraAvailability) {
  const type = trimText(data.mutationType);
  const mutationId = trimText(data.mutationId);
  const appointmentId = trimText(data.appointmentId);
  if (type === "cancel") {
    return api.sealAtomicMutation({
      mutationType: "cancel",
      mutationId: mutationId,
      salonId: salonId,
      appointmentId: appointmentId,
      expectedAppointmentRevision: data.expectedAppointmentRevision,
      actorUid: actorUid
    });
  }
  if (type === "status") {
    return api.sealAtomicMutation({
      mutationType: "status",
      mutationId: mutationId,
      salonId: salonId,
      appointmentId: appointmentId,
      expectedAppointmentRevision: data.expectedAppointmentRevision,
      targetStatus: trimText(data.targetStatus)
    });
  }
  if (type === "update") {
    return api.sealAtomicMutation({
      mutationType: "update",
      mutationId: mutationId,
      salonId: salonId,
      appointmentId: appointmentId,
      expectedAppointmentRevision: data.expectedAppointmentRevision,
      locationId: trimText(data.locationId),
      dateKey: trimText(data.dateKey),
      availabilityVersions: data.availabilityVersions || [],
      appointmentPayload: data.appointmentPayload && typeof data.appointmentPayload === "object"
        ? copyJson(data.appointmentPayload)
        : {},
      providerReservations: Array.isArray(data.providerReservations) ? copyJson(data.providerReservations) : [],
      resourceReservations: Array.isArray(data.resourceReservations) ? copyJson(data.resourceReservations) : [],
      providerAvailability: extraAvailability && typeof extraAvailability === "object"
        ? extraAvailability
        : {}
    });
  }
  return null;
}

async function handleExecuteBookingMutation(input) {
  const opts = input || {};
  const api = opts.api;
  const bookingModel = opts.bookingModel || (api && api.bookingAppointmentModel) || null;
  const db = opts.db;
  const admin = opts.admin;
  const data = opts.data && typeof opts.data === "object" ? opts.data : {};
  let projectId;
  try {
    projectId = assertCallableRuntimeProject(opts.projectId);
  } catch (err) {
    const code = err && err.code || "unexpected_project";
    logSafe({ status: code, mutationType: data.mutationType, mutationId: data.mutationId, salonId: data.salonId });
    return publicResult({ status: code, reasonCodes: [code] });
  }

  const auth = opts.auth;
  const actorUid = auth && trimText(auth.uid);
  if (!actorUid) {
    return publicResult({ status: "unauthenticated", reasonCodes: ["unauthenticated"] });
  }

  const salonId = trimText(data.salonId);
  const mutationType = trimText(data.mutationType);
  const mutationId = trimText(data.mutationId);
  if (!salonId || !mutationType || !mutationId) {
    return publicResult({ status: "mutation_invalid", reasonCodes: ["mutation_invalid"] });
  }
  if (["create", "update", "cancel", "status"].indexOf(mutationType) === -1) {
    return publicResult({ status: "mutation_invalid", reasonCodes: ["mutation_invalid"] });
  }

  const membership = await authorizeSalonMember(db, actorUid, salonId);
  if (!membership.ok) {
    logSafe({ salonId: salonId, mutationType: mutationType, mutationId: mutationId, status: "permission_denied" });
    return publicResult({ status: "permission_denied", reasonCodes: ["permission_denied"] });
  }

  const emulatorHost = opts.emulatorHost != null
    ? trimText(opts.emulatorHost)
    : trimText(process.env.FIRESTORE_EMULATOR_HOST);
  if (projectId === EMULATOR_PROJECT && !emulatorHost) {
    return publicResult({ status: "mutation_invalid", reasonCodes: ["emulator_required"] });
  }

  const ex = createFirestoreAtomicExecutor({
    admin: admin,
    api: api,
    db: db,
    projectId: projectId,
    emulatorHost: emulatorHost,
    isolation: "callable"
  });

  let mutation;
  let persistAppointmentFields = {};
  const fv = fieldValue(admin);

  try {
    if (mutationType === "create") {
      const bookingCommand = data.bookingCommand && typeof data.bookingCommand === "object"
        ? copyJson(data.bookingCommand)
        : null;
      const preconditions = data.transactionPreconditions && typeof data.transactionPreconditions === "object"
        ? copyJson(data.transactionPreconditions)
        : null;
      if (!bookingCommand) {
        return publicResult({ status: "command_invalid", reasonCodes: ["command_integrity_mismatch"] });
      }
      const expectedFingerprint = typeof api.acceptanceFingerprintForCommand === "function"
        ? api.acceptanceFingerprintForCommand(bookingCommand)
        : "";
      if (!expectedFingerprint || expectedFingerprint !== String(bookingCommand.acceptanceFingerprint || "")) {
        return publicResult({ status: "command_invalid", reasonCodes: ["command_integrity_mismatch"] });
      }
      if (preconditions && preconditions.acceptanceFingerprint
        && String(preconditions.acceptanceFingerprint) !== expectedFingerprint) {
        return publicResult({ status: "command_invalid", reasonCodes: ["command_integrity_mismatch"] });
      }
      const context = await loadAdapterContext(db, salonId, bookingCommand);
      const scheduleAuth = await authorizeLiveSchedule(
        db,
        salonId,
        trimText(bookingCommand.locationId),
        trimText(bookingCommand.dateKey),
        bookingCommand.serviceLines || [],
        context.staffById,
        context.servicesById,
        bookingModel
      );
      if (!scheduleAuth.ok) {
        return publicResult({ status: scheduleAuth.status, reasonCodes: scheduleAuth.reasonCodes });
      }
      context.providerAvailability = scheduleAuth.providerAvailability;
      const appointmentRef = ex.refsFor(salonId).appointments.doc();
      context.candidateAppointmentId = appointmentRef.id;
      context.transactionPreconditions = preconditions;
      const built = api.buildSmartSchedulingAtomicCreateMutation(
        bookingCommand,
        preconditions,
        context,
        mutationId
      );
      if (!built || built.ok !== true) {
        const adapted = built && built.adapter;
        if (adapted && adapted.valid !== true) return adapterStatus(adapted);
        return publicResult({
          status: built && built.status || "command_invalid",
          reasonCodes: (built && built.reasonCodes) || ["command_integrity_mismatch"]
        });
      }
      mutation = built.mutation;
      persistAppointmentFields = attachTimestamps(
        persistenceFields(built.adapter, actorUid, "create"),
        admin,
        "create"
      );
    } else {
      if (mutationType !== "create" && !trimText(data.appointmentId)) {
        return publicResult({ status: "mutation_invalid", reasonCodes: ["appointment_missing"] });
      }
      const staffById = {};
      const reservations = Array.isArray(data.providerReservations) ? data.providerReservations : [];
      let ri;
      for (ri = 0; ri < reservations.length; ri += 1) {
        const providerId = trimText(reservations[ri] && reservations[ri].providerId);
        if (providerId && !staffById[providerId]) {
          const staff = await loadStaff(db, salonId, providerId);
          if (staff) staffById[providerId] = staff;
        }
      }
      const payloadLines = data.appointmentPayload && data.appointmentPayload.serviceLines || [];
      for (ri = 0; ri < payloadLines.length; ri += 1) {
        const providerId = trimText(payloadLines[ri] && payloadLines[ri].providerId);
        if (providerId && !staffById[providerId]) {
          const staff = await loadStaff(db, salonId, providerId);
          if (staff) staffById[providerId] = staff;
        }
      }
      let extraAvailability = {};
      if (mutationType === "update") {
        const servicesById = {};
        for (ri = 0; ri < payloadLines.length; ri += 1) {
          const serviceId = trimText(payloadLines[ri] && payloadLines[ri].serviceId);
          if (serviceId && !servicesById[serviceId]) {
            const service = await loadService(db, salonId, serviceId);
            if (service) servicesById[serviceId] = service;
          }
        }
        const updateLines = payloadLines.length ? payloadLines : reservations;
        const scheduleAuth = await authorizeLiveSchedule(
          db,
          salonId,
          trimText(data.locationId),
          trimText(data.dateKey),
          updateLines,
          staffById,
          servicesById,
          bookingModel
        );
        if (!scheduleAuth.ok) {
          return publicResult({ status: scheduleAuth.status, reasonCodes: scheduleAuth.reasonCodes });
        }
        extraAvailability = scheduleAuth.providerAvailability;
      }
      mutation = buildDirectMutation(
        api,
        data,
        salonId,
        actorUid,
        extraAvailability
      );
      if (!mutation) {
        return publicResult({ status: "mutation_invalid", reasonCodes: ["mutation_invalid"] });
      }
      persistAppointmentFields = attachTimestamps({
        updatedByUid: mutationType === "cancel" ? undefined : actorUid,
        cancelledByUid: mutationType === "cancel" ? actorUid : undefined,
        cancellationReason: mutationType === "cancel" ? trimText(data.cancellationReason) : undefined
      }, admin, mutationType);
      Object.keys(persistAppointmentFields).forEach(function (key) {
        if (persistAppointmentFields[key] == null || persistAppointmentFields[key] === "") {
          delete persistAppointmentFields[key];
        }
      });
    }

    const outcome = await ex.executeAtomicMutation(mutation, {
      persistAppointmentFields: persistAppointmentFields,
      persistMutationFields: fv && fv.serverTimestamp ? {} : {},
      onTransactionAttempt: opts.onTransactionAttempt,
      onAfterReads: opts.onAfterReads
    });
    const mapped = publicResult(outcome);
    logSafe({
      salonId: salonId,
      mutationType: mutationType,
      mutationId: mutationId,
      storageKey: mutationStorageKey(mutation.mutationIdempotencyKey || ""),
      status: mapped.status,
      attempts: outcome && outcome.transactionAttempts
    });
    return mapped;
  } catch (err) {
    console.error("[executeBookingMutation] unexpected", {
      salonId: salonId,
      mutationType: mutationType,
      mutationIdPrefix: mutationId.slice(0, 12)
    });
    return publicResult({ status: "mutation_invalid", reasonCodes: ["internal_error"] });
  }
}

module.exports = {
  PRODUCT_STATUSES: PRODUCT_STATUSES,
  handleExecuteBookingMutation: handleExecuteBookingMutation,
  authorizeSalonMember: authorizeSalonMember,
  publicResult: publicResult
};
