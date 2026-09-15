/**
 * Smart Scheduling Phase 18D — pure in-memory atomic Booking guard / transaction simulator.
 *
 * Models the Phase 18C / 18C.1 concurrency algorithm with zero persistence.
 * Does not call Firebase, Firestore, Cloud Functions, or createAppointment.
 *
 * Phase 17 acceptanceFingerprint is reused, not replaced.
 * availabilityVersions are bound only on the simulator mutation fingerprint.
 *
 * Cross-day Smart Scheduling create is rejected (overnight_not_supported).
 * Front-desk overnight guard split is not simulated.
 *
 * Mutation types are mutually authoritative:
 * create / update / cancel / status. Field-authority validation runs after
 * fingerprint integrity and after same-key/same-fingerprint already_completed,
 * and before readiness, epochs, and occupancy writes.
 */
(function () {
  var SCHEMA = 1;
  var ALLOWED_OVERLAP = [0, 15, 20, 30];
  var STATUS_OCCUPY = {
    scheduled: true,
    confirmed: true,
    checked_in: true,
    in_service: true,
    completed: true,
    no_show: true
  };
  var STATUS_ALLOWED = ["scheduled", "confirmed", "checked_in", "in_service", "completed", "no_show"];
  var READY_FLAGS = [
    "providerGuardsReady",
    "writersConverted",
    "mutationIdempotencyReady",
    "availabilityWritersAudited",
    "availabilityWritersAtomic",
    "callableExecutorReady"
  ];

  function ns() {
    return window.ffBookingSmartScheduling || (window.ffBookingSmartScheduling = {});
  }

  function helpers() {
    return ns().helpers || {};
  }

  function trimText(value) {
    var h = helpers();
    return h.trimText ? h.trimText(value) : String(value == null ? "" : value).trim();
  }

  function copyJson(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function encodePart(value) {
    return encodeURIComponent(String(value == null ? "" : value));
  }

  function overlapMinutes(a0, a1, b0, b1) {
    var h = helpers();
    if (h.overlapMinutes) return h.overlapMinutes(a0, a1, b0, b1);
    var n = Math.min(Number(a1), Number(b1)) - Math.max(Number(a0), Number(b0));
    return n > 0 ? n : 0;
  }

  function normalizeOverlap(value) {
    var n = Math.round(Number(value));
    return ALLOWED_OVERLAP.indexOf(n) !== -1 ? n : 0;
  }

  function providerDayGuardKey(locationId, dateKey, providerId) {
    return encodePart(locationId) + "__" + trimText(dateKey) + "__" + encodePart(providerId);
  }

  function resourceDayGuardKey(locationId, dateKey, resourceId) {
    return encodePart(locationId) + "__" + trimText(dateKey) + "__" + encodePart(resourceId);
  }

  function mutationIdempotencyKey(salonId, mutationType, mutationId) {
    return ["mutation", trimText(salonId), trimText(mutationType), encodePart(mutationId)].join("|");
  }

  function sortVersions(list) {
    return (list || []).slice().sort(function (a, b) {
      return trimText(a && a.locationId).localeCompare(trimText(b && b.locationId));
    });
  }

  function normalizeAvailabilityVersions(raw, requiredLocationId) {
    var seen = {};
    var out = [];
    var i;
    var rows = Array.isArray(raw) ? raw : [];
    for (i = 0; i < rows.length; i += 1) {
      var locationId = trimText(rows[i] && rows[i].locationId);
      var version = Number(rows[i] && rows[i].version);
      if (!locationId || !Number.isInteger(version) || version < 0) {
        return { ok: false, reason: "availability_versions_invalid", versions: [] };
      }
      if (seen[locationId]) return { ok: false, reason: "availability_versions_duplicate", versions: [] };
      seen[locationId] = true;
      out.push({ locationId: locationId, version: version });
    }
    out = sortVersions(out);
    var required = trimText(requiredLocationId);
    if (required) {
      if (out.length !== 1 || out[0].locationId !== required) {
        return { ok: false, reason: "availability_versions_location_mismatch", versions: out };
      }
    }
    return { ok: true, versions: out };
  }

  function emptyStore(overrides) {
    var extra = overrides && typeof overrides === "object" ? overrides : {};
    var base = {
      executionConfig: {
        executionMode: "legacy",
        providerGuardsReady: false,
        writersConverted: false,
        mutationIdempotencyReady: false,
        availabilityWritersAudited: false,
        availabilityWritersAtomic: false,
        resourceSystemReady: false,
        resourceEnforcementStartDateKey: "",
        callableExecutorReady: false,
        concurrencyTestsGreen: false,
        configRevision: 1
      },
      settings: { allowedOverlapMinutes: 0, overlapPolicyRevision: 1 },
      availabilityEpochs: {},
      availabilityConfig: {},
      providerAvailability: {},
      providerDays: {},
      resourceDefinitions: {},
      resourceDays: {},
      appointments: {},
      bookingMutations: {}
    };
    var next = copyJson(base);
    Object.keys(extra).forEach(function (key) {
      if (extra[key] && typeof extra[key] === "object" && !Array.isArray(extra[key]) && next[key] && typeof next[key] === "object") {
        next[key] = Object.assign({}, next[key], extra[key]);
      } else {
        next[key] = extra[key];
      }
    });
    return next;
  }

  function guardedStore(extra) {
    return emptyStore(Object.assign({
      executionConfig: {
        executionMode: "guarded",
        providerGuardsReady: true,
        writersConverted: true,
        mutationIdempotencyReady: true,
        availabilityWritersAudited: true,
        availabilityWritersAtomic: true,
        resourceSystemReady: false,
        resourceEnforcementStartDateKey: "",
        callableExecutorReady: true,
        concurrencyTestsGreen: false,
        configRevision: 1
      },
      availabilityEpochs: { locA: { version: 1 } }
    }, extra || {}));
  }

  function evaluateGuardedCutoverReadiness(store) {
    var cfg = (store && store.executionConfig) || {};
    var missing = [];
    if (cfg.executionMode !== "guarded") missing.push("executionMode");
    READY_FLAGS.forEach(function (flag) {
      if (cfg[flag] !== true) missing.push(flag);
    });
    if (cfg.concurrencyTestsGreen !== true) missing.push("concurrencyTestsGreen");
    return { ready: missing.length === 0, missing: missing };
  }

  function evaluateGuardedReadiness(store, mutation) {
    var cfg = (store && store.executionConfig) || {};
    var reasons = [];
    if (cfg.executionMode !== "guarded") reasons.push("guard_not_ready");
    READY_FLAGS.forEach(function (flag) {
      if (cfg[flag] !== true) reasons.push("guard_not_ready");
    });
    var unique = [];
    reasons.forEach(function (code) {
      if (unique.indexOf(code) === -1) unique.push(code);
    });
    var resourceReservations = mutation && mutation.resourceReservations || [];
    if (resourceReservations.length) {
      if (cfg.resourceSystemReady !== true) unique.push("resource_system_not_ready");
      var start = trimText(cfg.resourceEnforcementStartDateKey);
      var dateKey = trimText(mutation.dateKey || (mutation.appointmentPayload && mutation.appointmentPayload.dateKey));
      if (start && dateKey && dateKey < start) unique.push("resource_system_not_ready");
    }
    return {
      ready: unique.length === 0,
      reasonCodes: unique,
      cutover: evaluateGuardedCutoverReadiness(store)
    };
  }

  function canonLine(line) {
    return [
      trimText(line && line.lineId),
      trimText(line && line.serviceId),
      trimText(line && line.providerId),
      Number(line && line.startMin),
      Number(line && line.endMin),
      Number(line && line.durationMinutes) || 0,
      line && line.requested === true ? 1 : 0
    ];
  }

  function canonProviderRes(row) {
    return [
      trimText(row && row.providerId),
      trimText(row && row.lineId),
      Number(row && row.startMin),
      Number(row && row.endMin),
      trimText(row && row.locationId),
      trimText(row && row.dateKey)
    ];
  }

  function canonResourceRes(row) {
    return [
      trimText(row && row.resourceId),
      trimText(row && row.lineId),
      trimText(row && row.requirementKey),
      Number(row && row.reservationStartMin),
      Number(row && row.reservationEndMin),
      trimText(row && row.locationId),
      trimText(row && row.dateKey)
    ];
  }

  function mutationFingerprint(mutation) {
    var row = mutation && typeof mutation === "object" ? mutation : {};
    var payload = row.appointmentPayload || {};
    var versions = normalizeAvailabilityVersions(row.availabilityVersions).versions;
    return JSON.stringify([
      trimText(row.mutationType),
      trimText(row.mutationId),
      trimText(row.salonId),
      trimText(row.appointmentId),
      row.expectedAppointmentRevision == null ? "" : Number(row.expectedAppointmentRevision),
      trimText(row.targetStatus),
      versions,
      row.smartScheduling && row.smartScheduling.acceptanceFingerprint || "",
      trimText(payload.clientId),
      trimText(payload.locationId),
      trimText(payload.dateKey),
      (payload.serviceLines || []).map(canonLine),
      (row.providerReservations || []).map(canonProviderRes),
      (row.resourceReservations || []).map(canonResourceRes)
    ]);
  }

  function sealAtomicMutation(mutation) {
    var next = copyJson(mutation || {});
    next.mutationFingerprint = mutationFingerprint(next);
    next.mutationIdempotencyKey = mutationIdempotencyKey(next.salonId, next.mutationType, next.mutationId);
    next.persistentStorageKeyStrategy = "sha256_required_in_firestore";
    return next;
  }

  function outsideCivilDay(start, end) {
    var a = Number(start);
    var b = Number(end);
    return !(Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b <= 1440 && b > a);
  }

  function fitsWorking(intervals, startMin, endMin) {
    var list = Array.isArray(intervals) ? intervals : [];
    var i;
    for (i = 0; i < list.length; i += 1) {
      if (Number(list[i].startMin) <= startMin && endMin <= Number(list[i].endMin)) return true;
    }
    return false;
  }

  function recordRead(readSet, kind, key, token) {
    readSet.push({ kind: kind, key: String(key || ""), token: token == null ? "missing" : token });
  }

  function providerAvailOf(store, mutation, providerId, locationId, dateKey) {
    var fromMut = mutation.providerAvailability && mutation.providerAvailability[providerId];
    if (fromMut && fromMut.workingIntervals) return fromMut;
    var fromStore = store.providerAvailability && store.providerAvailability[providerId];
    if (fromStore && fromStore.workingIntervals) return fromStore;
    return { locationId: locationId, dateKey: dateKey, workingIntervals: [] };
  }

  function emptyGuard(kind, salonId, locationId, dateKey, id) {
    var row = {
      schemaVersion: SCHEMA,
      salonId: salonId,
      locationId: locationId,
      dateKey: dateKey,
      revision: 0,
      occupancies: []
    };
    if (kind === "provider") row.providerId = id;
    else row.resourceId = id;
    return row;
  }

  function occupanciesWithoutAppointment(list, appointmentId) {
    return (list || []).filter(function (row) {
      return trimText(row && row.appointmentId) !== trimText(appointmentId);
    });
  }

  function providerConflicts(occupancies, startMin, endMin, allowed, excludeAppointmentId) {
    var i;
    for (i = 0; i < (occupancies || []).length; i += 1) {
      var row = occupancies[i];
      if (excludeAppointmentId && trimText(row.appointmentId) === trimText(excludeAppointmentId)) continue;
      if (overlapMinutes(startMin, endMin, row.startMin, row.endMin) > allowed) return true;
    }
    return false;
  }

  function resourceConflicts(occupancies, startMin, endMin, excludeAppointmentId) {
    var i;
    for (i = 0; i < (occupancies || []).length; i += 1) {
      var row = occupancies[i];
      if (excludeAppointmentId && trimText(row.appointmentId) === trimText(excludeAppointmentId)) continue;
      if (overlapMinutes(startMin, endMin, row.reservationStartMin, row.reservationEndMin) > 0) return true;
    }
    return false;
  }

  function sameVisitProviderOverlap(reservations) {
    var list = reservations || [];
    var i;
    var j;
    for (i = 0; i < list.length; i += 1) {
      for (j = i + 1; j < list.length; j += 1) {
        if (list[i].providerId !== list[j].providerId) continue;
        if (overlapMinutes(list[i].startMin, list[i].endMin, list[j].startMin, list[j].endMin) > 0) return true;
      }
    }
    return false;
  }

  function sameVisitResourceOverlap(reservations) {
    var list = reservations || [];
    var i;
    var j;
    for (i = 0; i < list.length; i += 1) {
      for (j = i + 1; j < list.length; j += 1) {
        if (list[i].resourceId !== list[j].resourceId) continue;
        if (overlapMinutes(list[i].reservationStartMin, list[i].reservationEndMin, list[j].reservationStartMin, list[j].reservationEndMin) > 0) {
          return true;
        }
      }
    }
    return false;
  }

  function hasReservationIntent(list) {
    return Array.isArray(list) && list.length > 0;
  }

  function payloadAttemptsOccupancyChange(payload) {
    if (!payload || typeof payload !== "object") return false;
    if (Array.isArray(payload.serviceLines) && payload.serviceLines.length) return true;
    if (trimText(payload.locationId) || trimText(payload.dateKey) || trimText(payload.clientId)) return true;
    if (payload.startMin != null || payload.endMin != null || payload.startAt != null || payload.endAt != null) return true;
    return false;
  }

  function validateMutationAuthority(store, mutation) {
    var type = trimText(mutation && mutation.mutationType);
    var payload = mutation && mutation.appointmentPayload && typeof mutation.appointmentPayload === "object"
      ? mutation.appointmentPayload
      : {};
    var proposedStatus = trimText(payload.status);

    if (type === "create") {
      if (proposedStatus === "cancelled") {
        return failResult(mutation.smartScheduling ? "command_invalid" : "mutation_invalid", {
          reasonCodes: ["invalid_create_status"]
        });
      }
      if (mutation.smartScheduling && proposedStatus && proposedStatus !== "scheduled") {
        return failResult("command_invalid", { reasonCodes: ["invalid_create_status"] });
      }
      return null;
    }

    if (type === "update") {
      var existing = store.appointments[trimText(mutation.appointmentId)];
      if (existing) {
        if (trimText(existing.salonId) && trimText(mutation.salonId) !== trimText(existing.salonId)) {
          return failResult("mutation_invalid", { reasonCodes: ["appointment_identity_change_not_allowed"] });
        }
        if (payload.salonId != null && trimText(payload.salonId) !== "" && trimText(payload.salonId) !== trimText(existing.salonId)) {
          return failResult("mutation_invalid", { reasonCodes: ["appointment_identity_change_not_allowed"] });
        }
        if (payload.appointmentId && trimText(payload.appointmentId) !== trimText(existing.appointmentId)) {
          return failResult("mutation_invalid", { reasonCodes: ["appointment_identity_change_not_allowed"] });
        }
        if (payload.clientId != null && trimText(payload.clientId) !== "" && trimText(payload.clientId) !== trimText(existing.clientId)) {
          return failResult("mutation_invalid", { reasonCodes: ["appointment_identity_change_not_allowed"] });
        }
        if (proposedStatus && proposedStatus !== trimText(existing.status)) {
          if (proposedStatus === "cancelled") {
            return failResult("mutation_invalid", { reasonCodes: ["use_cancel_mutation"] });
          }
          return failResult("mutation_invalid", { reasonCodes: ["use_status_mutation"] });
        }
      }
      return null;
    }

    if (type === "status") {
      if (trimText(mutation.targetStatus) === "cancelled") {
        return failResult("mutation_invalid", { reasonCodes: ["use_cancel_mutation"] });
      }
      if (hasReservationIntent(mutation.providerReservations)
        || hasReservationIntent(mutation.resourceReservations)
        || payloadAttemptsOccupancyChange(payload)) {
        return failResult("mutation_invalid", { reasonCodes: ["status_mutation_contains_occupancy_change"] });
      }
      return null;
    }

    if (type === "cancel") {
      if (hasReservationIntent(mutation.providerReservations)
        || hasReservationIntent(mutation.resourceReservations)
        || payloadAttemptsOccupancyChange(payload)) {
        return failResult("mutation_invalid", { reasonCodes: ["cancel_mutation_contains_appointment_change"] });
      }
      return null;
    }
    return null;
  }

  function alreadyCompletedResult(record) {
    return {
      status: "already_completed",
      appointmentId: record.appointmentId,
      appointmentRevision: record.appointmentRevision,
      resultStatus: record.resultStatus,
      mutationId: record.mutationId,
      mutationFingerprint: record.mutationFingerprint
    };
  }

  function failResult(status, extras) {
    return Object.assign({ status: status, writes: null }, extras || {});
  }

  function collectTouchedKeys(mutation, appointment) {
    var providers = {};
    var resources = {};
    function addProvider(row) {
      if (!row) return;
      var key = providerDayGuardKey(row.locationId, row.dateKey, row.providerId);
      providers[key] = { locationId: row.locationId, dateKey: row.dateKey, providerId: row.providerId };
    }
    function addResource(row) {
      if (!row) return;
      var key = resourceDayGuardKey(row.locationId, row.dateKey, row.resourceId);
      resources[key] = { locationId: row.locationId, dateKey: row.dateKey, resourceId: row.resourceId };
    }
    (mutation.providerReservations || []).forEach(addProvider);
    (mutation.resourceReservations || []).forEach(addResource);
    if (appointment) {
      (appointment.providerReservations || []).forEach(addProvider);
      (appointment.resourceReservations || []).forEach(addResource);
    }
    return { providers: providers, resources: resources };
  }

  function evaluateMutation(store, mutation) {
    var readSet = [];
    var cfg = store.executionConfig || {};
    recordRead(readSet, "executionConfig", "executionConfig", cfg.configRevision != null ? cfg.configRevision : 1);
    recordRead(readSet, "settings", "allowedOverlapMinutes", normalizeOverlap(store.settings && store.settings.allowedOverlapMinutes) + ":" + Number((store.settings && store.settings.overlapPolicyRevision) || 1));

    if (!mutation || typeof mutation !== "object") {
      return { result: failResult("mutation_invalid"), readSet: readSet };
    }
    recordRead(readSet, "bookingMutation", mutation.mutationIdempotencyKey || mutationIdempotencyKey(mutation.salonId, mutation.mutationType, mutation.mutationId), store.bookingMutations[mutation.mutationIdempotencyKey] ? store.bookingMutations[mutation.mutationIdempotencyKey].mutationFingerprint : "missing");

    if (!trimText(mutation.mutationId) || !trimText(mutation.salonId) || !trimText(mutation.mutationType)) {
      return { result: failResult("mutation_invalid"), readSet: readSet };
    }
    var expectedFp = mutationFingerprint(mutation);
    if (!mutation.mutationFingerprint || mutation.mutationFingerprint !== expectedFp) {
      return {
        result: failResult(mutation.smartScheduling ? "command_invalid" : "mutation_invalid", {
          reasonCodes: ["mutation_integrity_mismatch"]
        }),
        readSet: readSet
      };
    }

    var existingMut = store.bookingMutations[mutation.mutationIdempotencyKey];
    if (existingMut) {
      if (existingMut.mutationFingerprint === mutation.mutationFingerprint) {
        return { result: alreadyCompletedResult(existingMut), readSet: readSet };
      }
      return { result: failResult("idempotency_identity_mismatch"), readSet: readSet };
    }

    var authority = validateMutationAuthority(store, mutation);
    if (authority) return { result: authority, readSet: readSet };

    var ready = evaluateGuardedReadiness(store, mutation);
    if (!ready.ready) {
      return {
        result: failResult(ready.reasonCodes.indexOf("resource_system_not_ready") !== -1 && ready.reasonCodes.indexOf("guard_not_ready") === -1
          ? "resource_system_not_ready"
          : "guard_not_ready", { reasonCodes: ready.reasonCodes }),
        readSet: readSet
      };
    }

    var versions = normalizeAvailabilityVersions(mutation.availabilityVersions, mutation.mutationType === "create" && mutation.smartScheduling ? mutation.locationId : "");
    if (mutation.availabilityVersions && !versions.ok) {
      return { result: failResult("mutation_invalid", { reasonCodes: [versions.reason] }), readSet: readSet };
    }
    var vi;
    for (vi = 0; vi < versions.versions.length; vi += 1) {
      var loc = versions.versions[vi].locationId;
      var live = store.availabilityEpochs[loc];
      recordRead(readSet, "epoch", loc, live ? live.version : "missing");
      if (!live || Number(live.version) !== Number(versions.versions[vi].version)) {
        return { result: failResult("availability_version_changed"), readSet: readSet };
      }
    }

    if (mutation.mutationType === "create") return evaluateCreate(store, mutation, readSet);
    if (mutation.mutationType === "update") return evaluateUpdate(store, mutation, readSet);
    if (mutation.mutationType === "cancel") return evaluateCancel(store, mutation, readSet);
    if (mutation.mutationType === "status") return evaluateStatus(store, mutation, readSet);
    return { result: failResult("mutation_invalid"), readSet: readSet };
  }

  function validateReservations(store, mutation, workingProviders, workingResources, excludeAppointmentId, readSet) {
    var allowed = normalizeOverlap(store.settings && store.settings.allowedOverlapMinutes);
    var i;
    var providers = mutation.providerReservations || [];
    var resources = mutation.resourceReservations || [];
    if (sameVisitProviderOverlap(providers)) return failResult("provider_conflict", { reasonCodes: ["same_visit_provider_overlap"] });
    if (sameVisitResourceOverlap(resources)) return failResult("resource_conflict", { reasonCodes: ["same_visit_resource_overlap"] });

    for (i = 0; i < providers.length; i += 1) {
      var pres = providers[i];
      if (outsideCivilDay(pres.startMin, pres.endMin)) return failResult("overnight_not_supported");
      var avail = providerAvailOf(store, mutation, pres.providerId, pres.locationId, pres.dateKey);
      if (!fitsWorking(avail.workingIntervals, pres.startMin, pres.endMin)) {
        return failResult("provider_schedule_changed");
      }
      var pKey = providerDayGuardKey(pres.locationId, pres.dateKey, pres.providerId);
      var pGuard = workingProviders[pKey];
      if (providerConflicts(pGuard.occupancies, pres.startMin, pres.endMin, allowed, excludeAppointmentId)) {
        return failResult("provider_conflict");
      }
    }
    for (i = 0; i < resources.length; i += 1) {
      var rres = resources[i];
      if (outsideCivilDay(rres.reservationStartMin, rres.reservationEndMin)) return failResult("overnight_not_supported");
      var def = store.resourceDefinitions[rres.resourceId];
      recordRead(readSet, "resourceDefinition", rres.resourceId, def
        ? [def.active === true ? 1 : 0, def.locationId, JSON.stringify(def.workingIntervals || [])].join("|")
        : "missing");
      if (!def) return failResult("resource_system_not_ready");
      if (def.active !== true || trimText(def.locationId) !== trimText(rres.locationId || mutation.locationId)) {
        return failResult("resource_schedule_changed");
      }
      if (!fitsWorking(def.workingIntervals, rres.reservationStartMin, rres.reservationEndMin)) {
        return failResult("resource_schedule_changed");
      }
      var rKey = resourceDayGuardKey(rres.locationId, rres.dateKey, rres.resourceId);
      var rGuard = workingResources[rKey];
      if (resourceConflicts(rGuard.occupancies, rres.reservationStartMin, rres.reservationEndMin, excludeAppointmentId)) {
        return failResult("resource_conflict");
      }
    }
    return null;
  }

  function snapshotGuards(store, mutation, appointment, readSet) {
    var keys = collectTouchedKeys(mutation, appointment);
    var providers = {};
    var resources = {};
    Object.keys(keys.providers).forEach(function (key) {
      var meta = keys.providers[key];
      var existing = store.providerDays[key];
      recordRead(readSet, "providerGuard", key, existing ? existing.revision : "missing");
      providers[key] = existing
        ? copyJson(existing)
        : emptyGuard("provider", mutation.salonId, meta.locationId, meta.dateKey, meta.providerId);
    });
    Object.keys(keys.resources).forEach(function (key) {
      var meta = keys.resources[key];
      var existing = store.resourceDays[key];
      recordRead(readSet, "resourceGuard", key, existing ? existing.revision : "missing");
      resources[key] = existing
        ? copyJson(existing)
        : emptyGuard("resource", mutation.salonId, meta.locationId, meta.dateKey, meta.resourceId);
    });
    return { providers: providers, resources: resources, keys: keys };
  }

  function applyReservations(guards, mutation, appointmentId) {
    (mutation.providerReservations || []).forEach(function (row) {
      var key = providerDayGuardKey(row.locationId, row.dateKey, row.providerId);
      guards.providers[key].occupancies.push({
        appointmentId: appointmentId,
        lineId: row.lineId,
        startMin: row.startMin,
        endMin: row.endMin
      });
    });
    (mutation.resourceReservations || []).forEach(function (row) {
      var key = resourceDayGuardKey(row.locationId, row.dateKey, row.resourceId);
      guards.resources[key].occupancies.push({
        appointmentId: appointmentId,
        lineId: row.lineId,
        requirementKey: row.requirementKey,
        reservationStartMin: row.reservationStartMin,
        reservationEndMin: row.reservationEndMin
      });
    });
  }

  function bumpGuardRevisions(guards) {
    Object.keys(guards.providers).forEach(function (key) {
      guards.providers[key].revision = Number(guards.providers[key].revision || 0) + 1;
    });
    Object.keys(guards.resources).forEach(function (key) {
      guards.resources[key].revision = Number(guards.resources[key].revision || 0) + 1;
    });
  }

  function stripAppointmentFromGuards(guards, appointmentId) {
    Object.keys(guards.providers).forEach(function (key) {
      guards.providers[key].occupancies = occupanciesWithoutAppointment(guards.providers[key].occupancies, appointmentId);
    });
    Object.keys(guards.resources).forEach(function (key) {
      guards.resources[key].occupancies = occupanciesWithoutAppointment(guards.resources[key].occupancies, appointmentId);
    });
  }

  function buildAppointment(mutation, appointmentId, revision, status) {
    var payload = mutation.appointmentPayload || {};
    return {
      appointmentId: appointmentId,
      salonId: mutation.salonId,
      clientId: payload.clientId,
      locationId: payload.locationId || mutation.locationId,
      dateKey: payload.dateKey || mutation.dateKey,
      status: status || payload.status || "scheduled",
      revision: revision,
      serviceLines: copyJson(payload.serviceLines || []),
      providerReservations: copyJson(mutation.providerReservations || []),
      resourceReservations: copyJson(mutation.resourceReservations || []),
      smartScheduling: mutation.smartScheduling ? copyJson(mutation.smartScheduling) : null
    };
  }

  function mutationRecord(mutation, appointmentId, revision, resultStatus) {
    return {
      mutationId: mutation.mutationId,
      mutationIdempotencyKey: mutation.mutationIdempotencyKey,
      mutationType: mutation.mutationType,
      mutationFingerprint: mutation.mutationFingerprint,
      appointmentId: appointmentId,
      appointmentRevision: revision,
      resultStatus: resultStatus,
      persistentStorageKeyStrategy: "sha256_required_in_firestore"
    };
  }

  function evaluateCreate(store, mutation, readSet) {
    var appointmentId = trimText(mutation.candidateAppointmentId) || ("appt_" + trimText(mutation.mutationId));
    if (store.appointments[appointmentId]) {
      recordRead(readSet, "appointment", appointmentId, store.appointments[appointmentId].revision);
      return { result: failResult("mutation_invalid", { reasonCodes: ["appointment_id_taken"] }), readSet: readSet };
    }
    recordRead(readSet, "appointment", appointmentId, "missing");
    var guards = snapshotGuards(store, mutation, null, readSet);
    var invalid = validateReservations(store, mutation, guards.providers, guards.resources, "", readSet);
    if (invalid) return { result: invalid, readSet: readSet };
    applyReservations(guards, mutation, appointmentId);
    bumpGuardRevisions(guards);
    var appointment = buildAppointment(mutation, appointmentId, 1, "scheduled");
    return {
      result: {
        status: "created",
        appointmentId: appointmentId,
        appointmentRevision: 1,
        mutationId: mutation.mutationId,
        mutationFingerprint: mutation.mutationFingerprint,
        touchedProviderGuards: Object.keys(guards.providers).sort(),
        touchedResourceGuards: Object.keys(guards.resources).sort(),
        writes: {
          appointment: appointment,
          providerDays: guards.providers,
          resourceDays: guards.resources,
          bookingMutation: mutationRecord(mutation, appointmentId, 1, "created")
        }
      },
      readSet: readSet
    };
  }

  function evaluateUpdate(store, mutation, readSet) {
    var appointmentId = trimText(mutation.appointmentId);
    var existing = store.appointments[appointmentId];
    recordRead(readSet, "appointment", appointmentId, existing ? existing.revision : "missing");
    if (!existing) return { result: failResult("mutation_invalid", { reasonCodes: ["appointment_missing"] }), readSet: readSet };
    if (existing.status === "cancelled") return { result: failResult("mutation_invalid", { reasonCodes: ["appointment_cancelled"] }), readSet: readSet };
    if (mutation.expectedAppointmentRevision == null || Number(mutation.expectedAppointmentRevision) !== Number(existing.revision)) {
      return { result: failResult("appointment_revision_mismatch"), readSet: readSet };
    }
    var guards = snapshotGuards(store, mutation, existing, readSet);
    stripAppointmentFromGuards(guards, appointmentId);
    var invalid = validateReservations(store, mutation, guards.providers, guards.resources, appointmentId, readSet);
    if (invalid) return { result: invalid, readSet: readSet };
    applyReservations(guards, mutation, appointmentId);
    bumpGuardRevisions(guards);
    var nextRev = Number(existing.revision) + 1;
    var appointment = buildAppointment(mutation, appointmentId, nextRev, existing.status);
    return {
      result: {
        status: "updated",
        appointmentId: appointmentId,
        appointmentRevision: nextRev,
        mutationId: mutation.mutationId,
        mutationFingerprint: mutation.mutationFingerprint,
        touchedProviderGuards: Object.keys(guards.providers).sort(),
        touchedResourceGuards: Object.keys(guards.resources).sort(),
        writes: {
          appointment: appointment,
          providerDays: guards.providers,
          resourceDays: guards.resources,
          bookingMutation: mutationRecord(mutation, appointmentId, nextRev, "updated")
        }
      },
      readSet: readSet
    };
  }

  function evaluateCancel(store, mutation, readSet) {
    var appointmentId = trimText(mutation.appointmentId);
    var existing = store.appointments[appointmentId];
    recordRead(readSet, "appointment", appointmentId, existing ? existing.revision : "missing");
    if (!existing) return { result: failResult("mutation_invalid", { reasonCodes: ["appointment_missing"] }), readSet: readSet };
    if (existing.status === "cancelled") {
      return { result: failResult("already_cancelled", { appointmentId: appointmentId, appointmentRevision: existing.revision }), readSet: readSet };
    }
    if (mutation.expectedAppointmentRevision != null && Number(mutation.expectedAppointmentRevision) !== Number(existing.revision)) {
      return { result: failResult("appointment_revision_mismatch"), readSet: readSet };
    }
    var cancelMutation = Object.assign({}, mutation, {
      providerReservations: [],
      resourceReservations: []
    });
    var guards = snapshotGuards(store, cancelMutation, existing, readSet);
    stripAppointmentFromGuards(guards, appointmentId);
    bumpGuardRevisions(guards);
    var nextRev = Number(existing.revision) + 1;
    var appointment = copyJson(existing);
    appointment.status = "cancelled";
    appointment.revision = nextRev;
    appointment.providerReservations = [];
    appointment.resourceReservations = [];
    return {
      result: {
        status: "cancelled",
        appointmentId: appointmentId,
        appointmentRevision: nextRev,
        mutationId: mutation.mutationId,
        mutationFingerprint: mutation.mutationFingerprint,
        touchedProviderGuards: Object.keys(guards.providers).sort(),
        touchedResourceGuards: Object.keys(guards.resources).sort(),
        writes: {
          appointment: appointment,
          providerDays: guards.providers,
          resourceDays: guards.resources,
          bookingMutation: mutationRecord(mutation, appointmentId, nextRev, "cancelled")
        }
      },
      readSet: readSet
    };
  }

  function evaluateStatus(store, mutation, readSet) {
    var appointmentId = trimText(mutation.appointmentId);
    var existing = store.appointments[appointmentId];
    recordRead(readSet, "appointment", appointmentId, existing ? existing.revision : "missing");
    if (!existing) return { result: failResult("mutation_invalid", { reasonCodes: ["appointment_missing"] }), readSet: readSet };
    var target = trimText(mutation.targetStatus);
    if (target === "cancelled") return { result: failResult("mutation_invalid", { reasonCodes: ["use_cancel_mutation"] }), readSet: readSet };
    if (STATUS_ALLOWED.indexOf(target) === -1) return { result: failResult("mutation_invalid", { reasonCodes: ["invalid_status"] }), readSet: readSet };
    if (existing.status === "cancelled") return { result: failResult("mutation_invalid", { reasonCodes: ["appointment_cancelled"] }), readSet: readSet };
    if (mutation.expectedAppointmentRevision == null || Number(mutation.expectedAppointmentRevision) !== Number(existing.revision)) {
      return { result: failResult("appointment_revision_mismatch"), readSet: readSet };
    }
    var nextRev = Number(existing.revision) + 1;
    var appointment = copyJson(existing);
    appointment.status = target;
    appointment.revision = nextRev;
    return {
      result: {
        status: "status_updated",
        appointmentId: appointmentId,
        appointmentRevision: nextRev,
        mutationId: mutation.mutationId,
        mutationFingerprint: mutation.mutationFingerprint,
        touchedProviderGuards: [],
        touchedResourceGuards: [],
        writes: {
          appointment: appointment,
          providerDays: {},
          resourceDays: {},
          bookingMutation: mutationRecord(mutation, appointmentId, nextRev, "status_updated")
        }
      },
      readSet: readSet
    };
  }

  function applyWrites(store, writes) {
    var next = copyJson(store);
    if (!writes) return next;
    if (writes.appointment) next.appointments[writes.appointment.appointmentId] = writes.appointment;
    Object.keys(writes.providerDays || {}).forEach(function (key) {
      next.providerDays[key] = writes.providerDays[key];
    });
    Object.keys(writes.resourceDays || {}).forEach(function (key) {
      next.resourceDays[key] = writes.resourceDays[key];
    });
    if (writes.bookingMutation) {
      next.bookingMutations[writes.bookingMutation.mutationIdempotencyKey] = writes.bookingMutation;
    }
    return next;
  }

  function readSetChanged(store, readSet) {
    var i;
    for (i = 0; i < (readSet || []).length; i += 1) {
      var item = readSet[i];
      var live = "missing";
      if (item.kind === "executionConfig") {
        live = store.executionConfig && store.executionConfig.configRevision != null ? store.executionConfig.configRevision : 1;
      } else if (item.kind === "settings") {
        live = normalizeOverlap(store.settings && store.settings.allowedOverlapMinutes) + ":" + Number((store.settings && store.settings.overlapPolicyRevision) || 1);
      } else if (item.kind === "epoch") {
        live = store.availabilityEpochs[item.key] ? store.availabilityEpochs[item.key].version : "missing";
      } else if (item.kind === "providerGuard") {
        live = store.providerDays[item.key] ? store.providerDays[item.key].revision : "missing";
      } else if (item.kind === "resourceGuard") {
        live = store.resourceDays[item.key] ? store.resourceDays[item.key].revision : "missing";
      } else if (item.kind === "appointment") {
        live = store.appointments[item.key] ? store.appointments[item.key].revision : "missing";
      } else if (item.kind === "bookingMutation") {
        live = store.bookingMutations[item.key] ? store.bookingMutations[item.key].mutationFingerprint : "missing";
      } else if (item.kind === "resourceDefinition") {
        var def = store.resourceDefinitions[item.key];
        live = def
          ? [def.active === true ? 1 : 0, def.locationId, JSON.stringify(def.workingIntervals || [])].join("|")
          : "missing";
      }
      if (String(live) !== String(item.token)) return true;
    }
    return false;
  }

  function publicResult(result, state) {
    var out = {
      status: result.status,
      appointmentId: result.appointmentId || null,
      appointmentRevision: result.appointmentRevision != null ? result.appointmentRevision : null,
      mutationId: result.mutationId || null,
      mutationFingerprint: result.mutationFingerprint || null,
      resultStatus: result.resultStatus || result.status,
      reasonCodes: result.reasonCodes || [],
      touchedProviderGuards: result.touchedProviderGuards || [],
      touchedResourceGuards: result.touchedResourceGuards || [],
      state: state,
      productionAppointmentIdStrategy: "firestore_auto_id_preallocated_before_transaction",
      persistentStorageKeyStrategy: "sha256_required_in_firestore",
      frontDeskOvernightGuardSplit: "front_desk_overnight_guard_split_not_simulated"
    };
    return out;
  }

  function prepareSimulatedTransaction(store, mutation) {
    var snapshot = copyJson(store);
    var sealed = mutation && mutation.mutationFingerprint ? copyJson(mutation) : sealAtomicMutation(mutation);
    var evaluated = evaluateMutation(snapshot, sealed);
    return {
      mutation: sealed,
      readSet: evaluated.readSet,
      planned: evaluated.result,
      snapshotEpoch: copyJson(snapshot.availabilityEpochs)
    };
  }

  function commitSimulatedTransaction(currentStore, prepared) {
    var store = currentStore;
    if (!prepared || !prepared.readSet) {
      return publicResult(failResult("mutation_invalid"), store);
    }
    if (readSetChanged(store, prepared.readSet)) {
      return {
        status: "transaction_retry_required",
        appointmentId: null,
        appointmentRevision: null,
        mutationId: prepared.mutation && prepared.mutation.mutationId || null,
        mutationFingerprint: prepared.mutation && prepared.mutation.mutationFingerprint || null,
        resultStatus: "transaction_retry_required",
        reasonCodes: ["read_set_changed"],
        touchedProviderGuards: [],
        touchedResourceGuards: [],
        state: store,
        productionAppointmentIdStrategy: "firestore_auto_id_preallocated_before_transaction",
        persistentStorageKeyStrategy: "sha256_required_in_firestore"
      };
    }
    if (!prepared.planned || !prepared.planned.writes) {
      return publicResult(prepared.planned || failResult("mutation_invalid"), store);
    }
    return publicResult(prepared.planned, applyWrites(store, prepared.planned.writes));
  }

  function executeAtomicMutation(store, mutation) {
    var prepared = prepareSimulatedTransaction(store, mutation);
    return commitSimulatedTransaction(store, prepared);
  }

  function simulateConcurrentMutations(initialStore, mutationA, mutationB) {
    var prepA = prepareSimulatedTransaction(initialStore, mutationA);
    var prepB = prepareSimulatedTransaction(initialStore, mutationB);
    var first = commitSimulatedTransaction(initialStore, prepA);
    var secondAttempt = commitSimulatedTransaction(first.state, prepB);
    var retried = null;
    var second = secondAttempt;
    if (secondAttempt.status === "transaction_retry_required") {
      retried = prepareSimulatedTransaction(first.state, mutationB);
      second = commitSimulatedTransaction(first.state, retried);
    }
    return {
      first: first,
      secondAttempt: secondAttempt,
      second: second,
      retried: !!retried,
      state: second.state
    };
  }

  function applyAvailabilityMutationAtomically(store, patch) {
    var original = store;
    var req = patch && typeof patch === "object" ? patch : {};
    var locationIds = Array.isArray(req.locationIds) ? req.locationIds.map(trimText).filter(Boolean) : [];
    if (!locationIds.length) {
      return { status: "mutation_invalid", state: original, reasonCodes: ["location_ids_required"] };
    }
    var next = copyJson(store);
    locationIds.forEach(function (locationId) {
      if (!next.availabilityConfig[locationId] || typeof next.availabilityConfig[locationId] !== "object") {
        next.availabilityConfig[locationId] = {};
      }
      var cfg = next.availabilityConfig[locationId];
      var incoming = req.availabilityConfig && req.availabilityConfig[locationId];
      if (incoming && typeof incoming === "object") {
        Object.keys(incoming).forEach(function (field) {
          cfg[field] = copyJson(incoming[field]);
        });
      }
      var epoch = next.availabilityEpochs[locationId] || { version: 0 };
      next.availabilityEpochs[locationId] = { version: Number(epoch.version || 0) + 1 };
    });
    if (req.providerAvailability && typeof req.providerAvailability === "object") {
      Object.keys(req.providerAvailability).forEach(function (providerId) {
        next.providerAvailability[providerId] = copyJson(req.providerAvailability[providerId]);
      });
    }
    if (req.resourceDefinitions && typeof req.resourceDefinitions === "object") {
      Object.keys(req.resourceDefinitions).forEach(function (resourceId) {
        next.resourceDefinitions[resourceId] = Object.assign(
          {},
          next.resourceDefinitions[resourceId] || {},
          copyJson(req.resourceDefinitions[resourceId])
        );
      });
    }
    return {
      status: "availability_updated",
      locationIds: locationIds.slice().sort(),
      epochs: copyJson(next.availabilityEpochs),
      state: next
    };
  }

  function buildSmartSchedulingAtomicCreateMutation(
    bookingCommand,
    transactionPreconditions,
    adapterContext,
    mutationId,
    availabilityVersions
  ) {
    var api = ns();
    var reasons = [];
    if (!bookingCommand || typeof bookingCommand !== "object") {
      return { ok: false, status: "command_invalid", reasonCodes: ["command_integrity_mismatch"] };
    }
    if (typeof api.acceptanceFingerprintForCommand === "function") {
      var expected = api.acceptanceFingerprintForCommand(bookingCommand);
      if (!expected || expected !== String(bookingCommand.acceptanceFingerprint || "")) {
        return { ok: false, status: "command_invalid", reasonCodes: ["command_integrity_mismatch"] };
      }
      if (transactionPreconditions && transactionPreconditions.acceptanceFingerprint
        && transactionPreconditions.acceptanceFingerprint !== expected) {
        return { ok: false, status: "command_invalid", reasonCodes: ["command_integrity_mismatch"] };
      }
    }
    var ctx = adapterContext && typeof adapterContext === "object" ? adapterContext : {};
    if (transactionPreconditions && ctx.transactionPreconditions == null) {
      ctx.transactionPreconditions = transactionPreconditions;
    }
    if (typeof api.adaptAcceptanceCommandToBookingCreateInput !== "function") {
      return { ok: false, status: "mutation_invalid", reasonCodes: ["adapter_unavailable"] };
    }
    var adapted = api.adaptAcceptanceCommandToBookingCreateInput(bookingCommand, ctx);
    if (!adapted || adapted.valid !== true) {
      return {
        ok: false,
        status: "mutation_invalid",
        reasonCodes: (adapted && adapted.reasonCodes) || ["adapter_invalid"],
        adapter: adapted || null
      };
    }
    var versions = normalizeAvailabilityVersions(availabilityVersions, bookingCommand.locationId);
    if (!versions.ok) {
      return { ok: false, status: "mutation_invalid", reasonCodes: [versions.reason] };
    }
    var providerReservations = (bookingCommand.serviceLines || []).map(function (line) {
      return {
        providerId: line.providerId,
        lineId: adapted.smartSchedulingProvenance.lineKeyToLineId[line.lineKey],
        startMin: line.startMin,
        endMin: line.endMin,
        locationId: bookingCommand.locationId,
        dateKey: bookingCommand.dateKey
      };
    });
    var resourceReservations = [];
    (adapted.physicalResourceReservations || []).forEach(function (row) {
      resourceReservations.push({
        resourceId: row.resourceId,
        lineId: row.lineId,
        requirementKey: row.requirementKey,
        reservationStartMin: row.reservationStartMin,
        reservationEndMin: row.reservationEndMin,
        locationId: bookingCommand.locationId,
        dateKey: bookingCommand.dateKey
      });
    });
    var payload = adapted.bookingCreateInput;
    var serviceLines = (payload.serviceLines || []).map(function (line, index) {
      var commandLine = bookingCommand.serviceLines[index] || {};
      return {
        lineId: line.lineId,
        serviceId: line.serviceId,
        providerId: line.providerId,
        startMin: commandLine.startMin,
        endMin: commandLine.endMin,
        durationMinutes: line.durationMinutes,
        requested: line.requested === true
      };
    });
    var mutation = sealAtomicMutation({
      mutationType: "create",
      mutationId: mutationId,
      salonId: ctx.salonId,
      candidateAppointmentId: ctx.candidateAppointmentId || ("appt_" + trimText(mutationId)),
      locationId: bookingCommand.locationId,
      dateKey: bookingCommand.dateKey,
      availabilityVersions: versions.versions,
      appointmentPayload: {
        clientId: payload.clientId,
        locationId: payload.locationId,
        dateKey: bookingCommand.dateKey,
        status: payload.status,
        serviceLines: serviceLines
      },
      providerReservations: providerReservations,
      resourceReservations: resourceReservations,
      providerAvailability: ctx.providerAvailability || {},
      smartScheduling: adapted.smartSchedulingProvenance
    });
    void reasons;
    return { ok: true, mutation: mutation, adapter: adapted };
  }

  var api = ns();
  api.createEmptyAtomicStore = emptyStore;
  api.createGuardedAtomicStore = guardedStore;
  api.providerDayGuardKey = providerDayGuardKey;
  api.resourceDayGuardKey = resourceDayGuardKey;
  api.mutationIdempotencyKey = mutationIdempotencyKey;
  api.normalizeAvailabilityVersions = normalizeAvailabilityVersions;
  api.atomicMutationFingerprint = mutationFingerprint;
  api.sealAtomicMutation = sealAtomicMutation;
  api.evaluateGuardedReadiness = evaluateGuardedReadiness;
  api.evaluateGuardedCutoverReadiness = evaluateGuardedCutoverReadiness;
  api.buildSmartSchedulingAtomicCreateMutation = buildSmartSchedulingAtomicCreateMutation;
  api.applyAvailabilityMutationAtomically = applyAvailabilityMutationAtomically;
  api.prepareSimulatedTransaction = prepareSimulatedTransaction;
  api.commitSimulatedTransaction = commitSimulatedTransaction;
  api.executeAtomicMutation = executeAtomicMutation;
  api.simulateConcurrentMutations = simulateConcurrentMutations;
  api.ATOMIC_BOOKING_SIMULATOR = {
    SCHEMA_VERSION: SCHEMA,
    PRODUCTION_APPOINTMENT_ID_STRATEGY: "firestore_auto_id_preallocated_before_transaction",
    PERSISTENT_STORAGE_KEY_STRATEGY: "sha256_required_in_firestore",
    FRONT_DESK_OVERNIGHT: "front_desk_overnight_guard_split_not_simulated"
  };
})();
