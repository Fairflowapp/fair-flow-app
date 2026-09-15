/**
 * Smart Scheduling Phase 18B — pure Booking execution adapter / simulator.
 *
 * Proves a Phase 17 bookingCommand can be mapped losslessly into the current
 * Fair Flow Booking appointment create shape. Zero writes. No Firebase.
 *
 * Does not call createAppointment, validateAppointment, or Firestore.
 * Does not invent appointment IDs, clients, names, prices, or timestamps.
 *
 * Service-line array order is the accepted Phase 17 command order
 * (bookingCreateInput.serviceLines[i] === bookingCommand.serviceLines[i]).
 * Client waits are not service lines. Appointment span is min start / max end.
 *
 * assignmentType defaults to specific_provider because the accepted command
 * binds exact named providerIds (same default as current Booking create).
 * That is not the same as per-line requested (client-asked technician).
 * Optimizer assignment never implies requested=true.
 *
 * source defaults to internal. Never writes source = "smart_scheduling".
 *
 * lineKey stays in Smart Scheduling provenance. lineId is a deterministic
 * adapter mapping for preview only — production Booking still uses makeLineId.
 *
 * Persistence-ready mapping requires caller-supplied salon/client/service/staff
 * snapshots. Missing names or prices are adapter errors, not empty/$0 warnings.
 * Explicit numeric 0 is a valid complimentary price; missing/NaN is not.
 *
 * Phase 17 availabilityVersions stay on the command / transaction /
 * smartSchedulingProvenance contract. They are not persisted as ordinary
 * Booking appointment fields and are not copied onto bookingCreateInput.
 */
(function () {
  var APPOINTMENT_ID_STRATEGY = "firestore_auto_id_currently";
  var SERVER_TIMESTAMP_REQUIRED = "server_timestamp_required";
  var DEFAULT_SOURCE = "internal";
  var DEFAULT_ASSIGNMENT_TYPE = "specific_provider";
  var DEFAULT_STATUS = "scheduled";

  var BLOCKER_PROVIDER_ATOMIC = "provider_atomic_guard_missing";
  var BLOCKER_IDEMPOTENCY = "idempotency_persistence_missing";
  var BLOCKER_PHYSICAL_RESOURCE = "physical_resource_persistence_missing";
  var BLOCKER_CLIENT = "client_required_for_booking";
  var REASON_CLIENT_MISMATCH = "client_context_mismatch";
  var REASON_CLIENT_SNAPSHOT = "client_snapshot_required";
  var REASON_SALON_CONTEXT = "salon_context_required";
  var REASON_SERVICE_REQUIRED = "service_required_for_booking";
  var REASON_SERVICE_SNAPSHOT = "service_snapshot_required";
  var REASON_SERVICE_PRICE = "service_price_snapshot_required";
  var REASON_PROVIDER_SNAPSHOT = "provider_snapshot_required";
  var WARNING_PROVENANCE_READBACK = "provenance_readback_requires_model_change";

  var HARD_BLOCKERS = [
    BLOCKER_PROVIDER_ATOMIC,
    BLOCKER_IDEMPOTENCY,
    BLOCKER_PHYSICAL_RESOURCE,
    BLOCKER_CLIENT
  ];

  function ns() {
    return window.ffBookingSmartScheduling || (window.ffBookingSmartScheduling = {});
  }

  function bookingModel() {
    return window.ffBookingAppointmentModel || null;
  }

  function helpers() {
    return ns().helpers || {};
  }

  function trimText(value) {
    var h = helpers();
    if (h.trimText) return h.trimText(value);
    var model = bookingModel();
    if (model && typeof value === "string") return String(value).trim();
    return String(value == null ? "" : value).trim();
  }

  function copyJson(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function addCode(list, code) {
    if (!code || list.indexOf(code) !== -1) return;
    list.push(code);
  }

  function isHardBlocker(code) {
    return HARD_BLOCKERS.indexOf(code) !== -1;
  }

  function encodePart(value) {
    return encodeURIComponent(String(value == null ? "" : value));
  }

  function lookupMap(raw) {
    return raw && typeof raw === "object" ? raw : {};
  }

  /**
   * Deterministic Booking lineId for simulator preview only.
   * Namespace: smart_{idempotencyKey}_{lineKey}
   * lineKey is NOT treated as lineId.
   */
  function deterministicBookingLineId(command, lineKey) {
    return "smart_" + encodePart(command && command.idempotencyKey) + "_" + encodePart(lineKey);
  }

  function commandFingerprint(command) {
    var api = ns();
    if (typeof api.acceptanceFingerprintForCommand !== "function") return "";
    return api.acceptanceFingerprintForCommand(command);
  }

  function commandIntegrityReasons(command, preconditions) {
    var reasons = [];
    if (!command || typeof command !== "object") {
      addCode(reasons, "command_integrity_mismatch");
      return reasons;
    }
    var expected = commandFingerprint(command);
    if (!expected || expected !== String(command.acceptanceFingerprint || "")) {
      addCode(reasons, "command_integrity_mismatch");
      return reasons;
    }
    if (preconditions && preconditions.acceptanceFingerprint
      && String(preconditions.acceptanceFingerprint) !== expected) {
      addCode(reasons, "command_integrity_mismatch");
    }
    if (preconditions && Object.prototype.hasOwnProperty.call(preconditions, "availabilityVersions")) {
      var commandVersions = JSON.stringify((command && command.availabilityVersions) || []);
      var preVersions = JSON.stringify(preconditions.availabilityVersions || []);
      if (commandVersions !== preVersions) addCode(reasons, "command_integrity_mismatch");
    }
    return reasons;
  }

  function resolveSource(context, model) {
    var raw = trimText(context && context.source);
    if (raw && model && model.isSource && model.isSource(raw)) return raw;
    if (raw && (!model || !model.isSource)) {
      if (["front_desk", "phone", "online", "walk_in", "internal"].indexOf(raw) !== -1) return raw;
    }
    return DEFAULT_SOURCE;
  }

  function resolveAssignmentType(context, model) {
    var raw = trimText(context && context.assignmentType);
    if (raw && model && model.isAssignmentType && model.isAssignmentType(raw)) return raw;
    if (raw && (!model || !model.isAssignmentType)) {
      if (raw === "specific_provider" || raw === "any_provider") return raw;
    }
    return DEFAULT_ASSIGNMENT_TYPE;
  }

  function lineWasRequested(line, context) {
    if (line && line.requested === true) return true;
    var map = context && context.requestedByLineKey;
    return !!(map && line && line.lineKey && map[line.lineKey] === true);
  }

  function recordInMap(map, id) {
    var key = trimText(id);
    var rows = lookupMap(map);
    if (!key || !Object.prototype.hasOwnProperty.call(rows, key)) return null;
    var row = rows[key];
    return row && typeof row === "object" ? row : null;
  }

  function serviceOf(context, serviceId) {
    return recordInMap(context && context.servicesById, serviceId);
  }

  function staffOf(context, providerId) {
    return recordInMap(context && context.staffById, providerId);
  }

  function serviceNameFrom(service) {
    if (!service || typeof service !== "object") return "";
    return trimText(service.name || service.displayName || service.serviceNameSnapshot);
  }

  /**
   * Same sources as Booking resolvePriceSnapshot (staff override.price, then
   * service.defaultPrice). Does not apply the model's missing-price → 0 fallback.
   */
  function explicitPriceSource(service, providerId) {
    var id = trimText(providerId);
    var overrides = service && service.staffOverrides && typeof service.staffOverrides === "object"
      ? service.staffOverrides
      : {};
    var override = id && overrides[id] && typeof overrides[id] === "object" ? overrides[id] : null;
    if (override && override.price != null) {
      var overPrice = Number(override.price);
      return Number.isFinite(overPrice) ? { ok: true, value: overPrice } : { ok: false };
    }
    if (service && service.defaultPrice != null) {
      var price = Number(service.defaultPrice);
      return Number.isFinite(price) ? { ok: true, value: price } : { ok: false };
    }
    return { ok: false };
  }

  function collectPhysicalReservations(command, lineIdByKey) {
    var out = [];
    (command && command.serviceLines || []).forEach(function (line) {
      (line && line.resourceAssignments || []).forEach(function (row) {
        if (!row) return;
        out.push({
          lineKey: line.lineKey,
          lineId: lineIdByKey[line.lineKey] || "",
          requirementKey: row.requirementKey,
          resourceId: row.resourceId,
          resourceType: row.resourceType,
          serviceStartMin: row.serviceStartMin != null ? row.serviceStartMin : line.startMin,
          serviceEndMin: row.serviceEndMin != null ? row.serviceEndMin : line.endMin,
          reservationStartMin: row.reservationStartMin,
          reservationEndMin: row.reservationEndMin,
          bufferBeforeMinutes: Number(row.bufferBeforeMinutes) || 0,
          bufferAfterMinutes: Number(row.bufferAfterMinutes) || 0
        });
      });
    });
    return out;
  }

  function emptyAdapterResult(reasons, extras) {
    var extra = extras || {};
    var blockers = (extra.blockers || []).slice();
    var warnings = (extra.warnings || []).slice();
    (reasons || []).forEach(function (code) {
      if (isHardBlocker(code)) addCode(blockers, code);
    });
    return {
      valid: false,
      bookingCreateInput: null,
      persistencePreview: null,
      smartSchedulingProvenance: extra.smartSchedulingProvenance || null,
      physicalResourceReservations: extra.physicalResourceReservations || [],
      requiresResourcePersistence: extra.requiresResourcePersistence === true,
      provenancePersistenceCompatible: true,
      provenanceReadbackRequiresModelChange: true,
      appointmentIdStrategy: APPOINTMENT_ID_STRATEGY,
      blockers: blockers,
      warnings: warnings,
      reasonCodes: (reasons || []).slice()
    };
  }

  function adaptAcceptanceCommandToBookingCreateInput(bookingCommand, context) {
    var ctx = context && typeof context === "object" ? context : {};
    var reasons = commandIntegrityReasons(bookingCommand, ctx.transactionPreconditions);
    if (reasons.length) return emptyAdapterResult(reasons);

    var model = bookingModel();
    if (!model || typeof model.civilToDate !== "function" || typeof model.normalizeCreateInput !== "function") {
      addCode(reasons, "booking_model_unavailable");
      return emptyAdapterResult(reasons);
    }

    var commandClientId = trimText(bookingCommand.clientId);
    if (!commandClientId) {
      addCode(reasons, BLOCKER_CLIENT);
      return emptyAdapterResult(reasons);
    }

    var salonId = trimText(ctx.salonId);
    if (!salonId) {
      addCode(reasons, REASON_SALON_CONTEXT);
      return emptyAdapterResult(reasons);
    }

    var suppliedClient = ctx.client && typeof ctx.client === "object" ? ctx.client : null;
    if (!suppliedClient) {
      addCode(reasons, BLOCKER_CLIENT);
      return emptyAdapterResult(reasons);
    }
    var suppliedClientId = trimText(suppliedClient.clientId);
    if (!suppliedClientId || suppliedClientId !== commandClientId) {
      addCode(reasons, REASON_CLIENT_MISMATCH);
      return emptyAdapterResult(reasons);
    }
    var clientSnapshot = typeof model.clientSnapshotFrom === "function"
      ? model.clientSnapshotFrom(suppliedClient)
      : { displayName: trimText(suppliedClient.displayName), phone: "", email: "" };
    if (!trimText(clientSnapshot && clientSnapshot.displayName)) {
      addCode(reasons, REASON_CLIENT_SNAPSHOT);
      return emptyAdapterResult(reasons);
    }

    var locationId = trimText(bookingCommand.locationId);
    var dateKey = trimText(bookingCommand.dateKey);
    if (!locationId) {
      addCode(reasons, "command_location_missing");
      return emptyAdapterResult(reasons);
    }
    if (!dateKey) {
      addCode(reasons, "command_date_key_missing");
      return emptyAdapterResult(reasons);
    }

    var visitStartMin = Number(bookingCommand.visitStartMin);
    var visitEndMin = Number(bookingCommand.visitEndMin);
    if (!Number.isFinite(visitStartMin) || !Number.isFinite(visitEndMin)) {
      addCode(reasons, "command_visit_window_mismatch");
      return emptyAdapterResult(reasons);
    }
    if (visitEndMin < visitStartMin) {
      addCode(reasons, "overnight_visit_not_safely_expressible");
      return emptyAdapterResult(reasons);
    }

    var commandLines = Array.isArray(bookingCommand.serviceLines) ? bookingCommand.serviceLines : [];
    if (!commandLines.length) {
      addCode(reasons, "command_service_lines_missing");
      return emptyAdapterResult(reasons);
    }

    var minStart = null;
    var maxEnd = null;
    var lineIdByKey = {};
    var warnings = [];
    var serviceLines = [];

    for (var i = 0; i < commandLines.length; i += 1) {
      var line = commandLines[i];
      if (!line || Array.isArray(line.providerId) || !trimText(line.providerId)) {
        addCode(reasons, "command_service_line_not_atomic");
        return emptyAdapterResult(reasons);
      }
      var startMin = Number(line.startMin);
      var endMin = Number(line.endMin);
      var durationMinutes = Number(line.durationMinutes);
      if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin !== startMin + durationMinutes) {
        addCode(reasons, "command_service_line_not_atomic");
        return emptyAdapterResult(reasons);
      }
      if (minStart == null || startMin < minStart) minStart = startMin;
      if (maxEnd == null || endMin > maxEnd) maxEnd = endMin;

      var startAt = model.civilToDate(dateKey, startMin, locationId);
      var endAt = model.civilToDate(dateKey, endMin, locationId);
      if (!startAt || !endAt || endAt.getTime() <= startAt.getTime()) {
        addCode(reasons, "civil_time_conversion_failed");
        return emptyAdapterResult(reasons);
      }

      var serviceId = trimText(line.serviceId);
      var providerId = trimText(line.providerId);
      if (!serviceId) {
        addCode(reasons, REASON_SERVICE_REQUIRED);
        return emptyAdapterResult(reasons, { warnings: warnings });
      }
      var service = serviceOf(ctx, serviceId);
      if (!service) {
        addCode(reasons, REASON_SERVICE_SNAPSHOT);
        return emptyAdapterResult(reasons, { warnings: warnings });
      }
      var serviceName = serviceNameFrom(service);
      if (!serviceName) {
        addCode(reasons, REASON_SERVICE_SNAPSHOT);
        return emptyAdapterResult(reasons, { warnings: warnings });
      }
      var priced = explicitPriceSource(service, providerId);
      if (!priced.ok) {
        addCode(reasons, REASON_SERVICE_PRICE);
        return emptyAdapterResult(reasons, { warnings: warnings });
      }
      var priceSnapshot = priced.value;
      var staff = staffOf(ctx, providerId);
      var providerName = staff && typeof model.providerNameFrom === "function"
        ? model.providerNameFrom(staff)
        : "";
      if (!staff || !providerName) {
        addCode(reasons, REASON_PROVIDER_SNAPSHOT);
        return emptyAdapterResult(reasons, { warnings: warnings });
      }

      var lineKey = trimText(line.lineKey);
      var lineId = deterministicBookingLineId(bookingCommand, lineKey);
      lineIdByKey[lineKey] = lineId;

      serviceLines.push({
        lineId: lineId,
        serviceId: serviceId,
        providerId: providerId,
        startAt: startAt,
        endAt: endAt,
        durationMinutes: durationMinutes,
        priceSnapshot: priceSnapshot,
        serviceNameSnapshot: serviceName,
        providerNameSnapshot: providerName,
        guestKey: trimText(line.guestKey || ctx.guestKey),
        guestName: trimText(line.guestName || ctx.guestName),
        requested: lineWasRequested(line, ctx),
        preservePriceSnapshot: !!service,
        preserveNameSnapshot: !!serviceName
      });
    }

    if (minStart !== visitStartMin || maxEnd !== visitEndMin) {
      addCode(reasons, "command_visit_window_mismatch");
      return emptyAdapterResult(reasons, { warnings: warnings });
    }

    var visitStartAt = model.civilToDate(dateKey, visitStartMin, locationId);
    var visitEndAt = model.civilToDate(dateKey, visitEndMin, locationId);
    var windowTimes = typeof model.deriveWindow === "function"
      ? model.deriveWindow(serviceLines)
      : { startAt: visitStartAt, endAt: visitEndAt };
    if (!visitStartAt || !visitEndAt || !windowTimes.startAt || !windowTimes.endAt
      || windowTimes.startAt.getTime() !== visitStartAt.getTime()
      || windowTimes.endAt.getTime() !== visitEndAt.getTime()) {
      addCode(reasons, "command_visit_window_mismatch");
      return emptyAdapterResult(reasons, { warnings: warnings });
    }

    var derivedDateKey = typeof model.dateKeyOf === "function"
      ? model.dateKeyOf(windowTimes.startAt, locationId)
      : dateKey;
    if (derivedDateKey && derivedDateKey !== dateKey) {
      addCode(reasons, "command_date_key_mismatch");
      return emptyAdapterResult(reasons, { warnings: warnings });
    }

    var endDateKey = typeof model.dateKeyOf === "function"
      ? model.dateKeyOf(windowTimes.endAt, locationId)
      : dateKey;
    var dateKeys = typeof model.dateKeysBetween === "function"
      ? model.dateKeysBetween(dateKey, endDateKey || dateKey)
      : [dateKey];
    if (visitEndMin >= 1440) addCode(warnings, "single_dateKey_overnight_uses_civil_rollover");

    var source = resolveSource(ctx, model);
    var assignmentType = resolveAssignmentType(ctx, model);
    var notes = typeof model.normalizeNotes === "function"
      ? model.normalizeNotes(ctx.notes)
      : trimText(ctx.notes);

    var providerIds = [];
    var seenProviders = {};
    serviceLines.forEach(function (line) {
      if (!line.providerId || seenProviders[line.providerId]) return;
      seenProviders[line.providerId] = true;
      providerIds.push(line.providerId);
    });

    var bookingCreateInput = {
      clientId: commandClientId,
      locationId: locationId,
      status: DEFAULT_STATUS,
      source: source,
      assignmentType: assignmentType,
      notes: notes,
      gapsAcknowledged: true,
      serviceLines: serviceLines
    };

    var structural = model.normalizeCreateInput(bookingCreateInput);
    if (!structural || structural.ok !== true) {
      addCode(reasons, "booking_create_input_invalid");
      if (structural && structural.code) addCode(reasons, structural.code);
      return emptyAdapterResult(reasons, { warnings: warnings });
    }

    var reservations = collectPhysicalReservations(bookingCommand, lineIdByKey);
    var requiresResource = reservations.length > 0;
    var blockers = [BLOCKER_PROVIDER_ATOMIC, BLOCKER_IDEMPOTENCY];
    if (requiresResource) addCode(blockers, BLOCKER_PHYSICAL_RESOURCE);
    addCode(warnings, WARNING_PROVENANCE_READBACK);

    var provenance = {
      offerId: bookingCommand.offerId,
      sourcePlanKey: bookingCommand.sourcePlanKey,
      acceptanceId: bookingCommand.acceptanceId,
      idempotencyKey: bookingCommand.idempotencyKey,
      acceptanceFingerprint: bookingCommand.acceptanceFingerprint,
      availabilityVersions: copyJson(bookingCommand.availabilityVersions || []),
      lineKeyToLineId: lineIdByKey
    };

    var persistencePreview = {
      appointmentIdStrategy: APPOINTMENT_ID_STRATEGY,
      salonId: salonId,
      clientId: commandClientId,
      clientSnapshot: clientSnapshot,
      locationId: locationId,
      status: DEFAULT_STATUS,
      source: source,
      assignmentType: assignmentType,
      notes: notes,
      serviceLines: serviceLines.map(function (line) {
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
      }),
      providerIds: providerIds.slice(),
      startAt: windowTimes.startAt,
      endAt: windowTimes.endAt,
      dateKey: dateKey,
      dateKeys: dateKeys,
      firstVisit: "requires_client_history_io",
      createdAt: SERVER_TIMESTAMP_REQUIRED,
      updatedAt: SERVER_TIMESTAMP_REQUIRED,
      createdByUid: trimText(ctx.createdByUid),
      createdByStaffId: trimText(ctx.createdByStaffId),
      cancelledAt: null,
      cancelledByUid: "",
      cancellationReason: "",
      firestoreTimestampConversion: "required_at_real_write",
      smartSchedulingNotIncluded: true
    };

    return {
      valid: true,
      bookingCreateInput: bookingCreateInput,
      persistencePreview: persistencePreview,
      smartSchedulingProvenance: provenance,
      physicalResourceReservations: reservations,
      requiresResourcePersistence: requiresResource,
      provenancePersistenceCompatible: true,
      provenanceReadbackRequiresModelChange: true,
      appointmentIdStrategy: APPOINTMENT_ID_STRATEGY,
      blockers: blockers,
      warnings: warnings,
      reasonCodes: []
    };
  }

  function bookingPayloadPreview(bookingCommand, context) {
    var adapted = adaptAcceptanceCommandToBookingCreateInput(bookingCommand, context);
    return {
      valid: adapted.valid,
      bookingCreateInput: adapted.bookingCreateInput,
      persistencePreview: adapted.persistencePreview,
      smartSchedulingProvenance: adapted.smartSchedulingProvenance,
      physicalResourceReservations: adapted.physicalResourceReservations,
      blockers: adapted.blockers,
      warnings: adapted.warnings
    };
  }

  function emptySimulation(status, reasons, extras) {
    var extra = extras || {};
    return {
      status: status,
      validMapping: false,
      readyForAtomicExecution: false,
      writesPerformed: false,
      advisoryOnly: true,
      bookingCreateInput: null,
      persistencePreview: null,
      smartSchedulingProvenance: extra.smartSchedulingProvenance || null,
      physicalResourceReservations: extra.physicalResourceReservations || [],
      requiresResourcePersistence: extra.requiresResourcePersistence === true,
      provenancePersistenceCompatible: true,
      provenanceReadbackRequiresModelChange: true,
      appointmentIdStrategy: APPOINTMENT_ID_STRATEGY,
      blockers: extra.blockers || [],
      warnings: extra.warnings || [],
      reasonCodes: (reasons || []).slice(),
      acceptanceEvaluation: extra.acceptanceEvaluation || null,
      adapter: extra.adapter || null
    };
  }

  function simulateBookingExecution(
    providerDays,
    resourceDays,
    bookingCommand,
    transactionPreconditions,
    context,
    executionState
  ) {
    var api = ns();
    var evaluation = typeof api.evaluateAcceptancePreconditions === "function"
      ? api.evaluateAcceptancePreconditions(
        providerDays,
        resourceDays,
        bookingCommand,
        transactionPreconditions,
        executionState
      )
      : { status: "command_invalid", reasonCodes: ["command_integrity_mismatch"], advisoryOnly: true, writesPerformed: false };

    if (evaluation.status === "already_completed") {
      return emptySimulation("already_completed", evaluation.reasonCodes || ["already_completed"], {
        acceptanceEvaluation: evaluation
      });
    }
    if (evaluation.status === "command_invalid") {
      return emptySimulation("command_invalid", evaluation.reasonCodes || ["command_integrity_mismatch"], {
        acceptanceEvaluation: evaluation
      });
    }
    if (evaluation.status !== "can_create") {
      return emptySimulation("precondition_failed", evaluation.reasonCodes || ["offer_stale"], {
        acceptanceEvaluation: evaluation
      });
    }

    var ctx = context && typeof context === "object" ? Object.assign({}, context) : {};
    if (transactionPreconditions && ctx.transactionPreconditions == null) {
      ctx.transactionPreconditions = transactionPreconditions;
    }
    var adapted = adaptAcceptanceCommandToBookingCreateInput(bookingCommand, ctx);
    if (!adapted.valid) {
      return emptySimulation("adapter_invalid", adapted.reasonCodes, {
        acceptanceEvaluation: evaluation,
        adapter: adapted,
        blockers: adapted.blockers,
        warnings: adapted.warnings,
        physicalResourceReservations: adapted.physicalResourceReservations,
        requiresResourcePersistence: adapted.requiresResourcePersistence,
        smartSchedulingProvenance: adapted.smartSchedulingProvenance
      });
    }

    return {
      status: "blocked_by_missing_persistence",
      validMapping: true,
      readyForAtomicExecution: false,
      writesPerformed: false,
      advisoryOnly: true,
      bookingCreateInput: adapted.bookingCreateInput,
      persistencePreview: adapted.persistencePreview,
      smartSchedulingProvenance: adapted.smartSchedulingProvenance,
      physicalResourceReservations: adapted.physicalResourceReservations,
      requiresResourcePersistence: adapted.requiresResourcePersistence,
      provenancePersistenceCompatible: adapted.provenancePersistenceCompatible,
      provenanceReadbackRequiresModelChange: adapted.provenanceReadbackRequiresModelChange,
      appointmentIdStrategy: adapted.appointmentIdStrategy,
      blockers: adapted.blockers.slice(),
      warnings: adapted.warnings.slice(),
      reasonCodes: adapted.blockers.slice(),
      acceptanceEvaluation: evaluation,
      adapter: adapted
    };
  }

  var api = ns();
  api.adaptAcceptanceCommandToBookingCreateInput = adaptAcceptanceCommandToBookingCreateInput;
  api.simulateBookingExecution = simulateBookingExecution;
  api.bookingPayloadPreview = bookingPayloadPreview;
  api.deterministicBookingLineId = deterministicBookingLineId;
  api.BOOKING_EXECUTION_ADAPTER = {
    ADVISORY_ONLY: true,
    WRITES_PERFORMED: false,
    APPOINTMENT_ID_STRATEGY: APPOINTMENT_ID_STRATEGY,
    SERVER_TIMESTAMP_REQUIRED: SERVER_TIMESTAMP_REQUIRED,
    DEFAULT_SOURCE: DEFAULT_SOURCE,
    DEFAULT_ASSIGNMENT_TYPE: DEFAULT_ASSIGNMENT_TYPE,
    STATUS_READY_FOR_PERSISTENCE_LAYER: "ready_for_persistence_layer",
    STATUS_ALREADY_COMPLETED: "already_completed",
    STATUS_PRECONDITION_FAILED: "precondition_failed",
    STATUS_COMMAND_INVALID: "command_invalid",
    STATUS_ADAPTER_INVALID: "adapter_invalid",
    STATUS_BLOCKED_BY_MISSING_PERSISTENCE: "blocked_by_missing_persistence",
    BLOCKER_PROVIDER_ATOMIC: BLOCKER_PROVIDER_ATOMIC,
    BLOCKER_IDEMPOTENCY: BLOCKER_IDEMPOTENCY,
    BLOCKER_PHYSICAL_RESOURCE: BLOCKER_PHYSICAL_RESOURCE,
    BLOCKER_CLIENT: BLOCKER_CLIENT,
    REASON_CLIENT_MISMATCH: REASON_CLIENT_MISMATCH,
    REASON_CLIENT_SNAPSHOT: REASON_CLIENT_SNAPSHOT,
    REASON_SALON_CONTEXT: REASON_SALON_CONTEXT,
    REASON_SERVICE_REQUIRED: REASON_SERVICE_REQUIRED,
    REASON_SERVICE_SNAPSHOT: REASON_SERVICE_SNAPSHOT,
    REASON_SERVICE_PRICE: REASON_SERVICE_PRICE,
    REASON_PROVIDER_SNAPSHOT: REASON_PROVIDER_SNAPSHOT,
    WARNING_PROVENANCE_READBACK: WARNING_PROVENANCE_READBACK
  };
})();
