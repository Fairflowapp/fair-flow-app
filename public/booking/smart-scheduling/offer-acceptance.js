/**
 * Smart Scheduling Phase 17 — atomic offer-acceptance command preparation.
 *
 * Pure contract only. Reuses Phase 16 to decide whether THIS exact offer is
 * still valid, then builds an immutable booking command and transaction
 * preconditions for a future executor.
 *
 * Does not write, reserve, hold, book, or call Firebase.
 * advisoryOnly = true, writesPerformed = false.
 *
 * Caller snapshot contract for availabilityVersions:
 * 1. read epoch V1
 * 2. load availability inputs (providerDays / resourceDays)
 * 3. read epoch V2
 * 4. require V1 === V2
 * 5. Phase 16 revalidate against those exact inputs
 * 6. Phase 17 prepare with V1 via options.availabilityVersions
 * 7. acceptanceFingerprint binds V1
 *
 * Phase 17 cannot independently prove steps 1–4. It only guarantees the
 * version token is structurally valid, fingerprint-bound, and copied onto
 * both bookingCommand and transactionPreconditions. Live epoch recheck is
 * the atomic executor / Phase 18D responsibility.
 *
 * Availability version is acceptance/execution intent, not Phase 15 offer
 * identity. It changes acceptanceFingerprint, not offerId or sourcePlanKey.
 */
(function () {
  var COMMAND_TYPE = "create_appointment_from_smart_offer";

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

  function addCode(list, code) {
    if (!code || list.indexOf(code) !== -1) return;
    list.push(code);
  }

  function encodePart(value) {
    return encodeURIComponent(String(value == null ? "" : value));
  }

  function asDay(input) {
    var p12 = ns().PHASE12_INTERNALS || {};
    if (p12.asDay) return p12.asDay(input);
    var api = ns();
    return typeof api.normalizeProviderDay === "function" ? api.normalizeProviderDay(input || {}) : input;
  }

  function allowedOverlapOf(day) {
    var h = helpers();
    var raw = day && day.allowedOverlapMinutes;
    return h.normalizeAllowedOverlap ? h.normalizeAllowedOverlap(raw) : (Number(raw) || 0);
  }

  function reservationOf(line, row) {
    var start = Number(row && row.reservationStartMin);
    var end = Number(row && row.reservationEndMin);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return { startMin: start, endMin: end };
    }
    var before = Number(row && row.bufferBeforeMinutes) || 0;
    var after = Number(row && row.bufferAfterMinutes) || 0;
    return {
      startMin: Number(line && line.startMin) - before,
      endMin: Number(line && line.endMin) + after
    };
  }

  function copyResourceAssignment(line, row) {
    var window = reservationOf(line, row);
    return {
      requirementKey: row.requirementKey,
      resourceId: row.resourceId,
      resourceType: row.resourceType,
      serviceStartMin: row.serviceStartMin != null ? row.serviceStartMin : line.startMin,
      serviceEndMin: row.serviceEndMin != null ? row.serviceEndMin : line.endMin,
      reservationStartMin: window.startMin,
      reservationEndMin: window.endMin,
      bufferBeforeMinutes: Number(row.bufferBeforeMinutes) || 0,
      bufferAfterMinutes: Number(row.bufferAfterMinutes) || 0
    };
  }

  function copyServiceLine(line) {
    return {
      lineKey: line.lineKey,
      serviceId: line.serviceId,
      providerId: line.providerId,
      startMin: line.startMin,
      endMin: line.endMin,
      durationMinutes: line.durationMinutes,
      blockIndex: line.blockIndex,
      resourceAssignments: (line.resourceAssignments || []).map(function (row) {
        return copyResourceAssignment(line, row);
      })
    };
  }

  function lineAtomic(line) {
    if (!line || Array.isArray(line.providerId) || !trimText(line.providerId)) return false;
    var start = Number(line.startMin);
    var end = Number(line.endMin);
    var dur = Number(line.durationMinutes);
    return Number.isFinite(start) && Number.isFinite(end) && end > start && dur === end - start;
  }

  function validateAcceptance(offer, acceptance) {
    var reasons = [];
    if (!acceptance || typeof acceptance !== "object") {
      addCode(reasons, "acceptance_id_missing");
      addCode(reasons, "acceptance_offer_identity_mismatch");
      return reasons;
    }
    if (!trimText(acceptance.acceptanceId)) addCode(reasons, "acceptance_id_missing");
    if (!trimText(acceptance.offerId) || !trimText(acceptance.sourcePlanKey)) {
      addCode(reasons, "acceptance_offer_identity_mismatch");
    } else if (!offer || acceptance.offerId !== offer.offerId || acceptance.sourcePlanKey !== offer.sourcePlanKey) {
      addCode(reasons, "acceptance_offer_identity_mismatch");
    }
    if (Object.prototype.hasOwnProperty.call(acceptance, "clientId")) {
      if (acceptance.clientId == null || !trimText(acceptance.clientId)) {
        addCode(reasons, "acceptance_client_id_invalid");
      }
    }
    return reasons;
  }

  function idempotencyKeyOf(offer, acceptance) {
    return [
      "accept",
      encodePart(offer && offer.locationId),
      encodePart(offer && offer.dateKey),
      encodePart(offer && offer.offerId),
      encodePart(offer && offer.sourcePlanKey),
      encodePart(acceptance && acceptance.acceptanceId)
    ].join("|");
  }

  function canonText(value) {
    return value == null ? "" : String(value);
  }

  function canonNum(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : "";
  }

  function canonFlag(value) {
    return value ? 1 : 0;
  }

  function sortResourceAssignments(list) {
    return (list || []).slice().sort(function (a, b) {
      return canonText(a && a.requirementKey).localeCompare(canonText(b && b.requirementKey))
        || canonText(a && a.resourceId).localeCompare(canonText(b && b.resourceId));
    });
  }

  function canonicalResourceAssignment(row) {
    return [
      canonText(row && row.requirementKey),
      canonText(row && row.resourceId),
      canonText(row && row.resourceType),
      canonNum(row && row.serviceStartMin),
      canonNum(row && row.serviceEndMin),
      canonNum(row && row.reservationStartMin),
      canonNum(row && row.reservationEndMin),
      Number(row && row.bufferBeforeMinutes) || 0,
      Number(row && row.bufferAfterMinutes) || 0
    ];
  }

  function canonicalServiceLine(line) {
    return [
      canonText(line && line.lineKey),
      canonText(line && line.serviceId),
      canonText(line && line.providerId),
      canonNum(line && line.startMin),
      canonNum(line && line.endMin),
      canonNum(line && line.durationMinutes),
      canonNum(line && line.blockIndex),
      sortResourceAssignments(line && line.resourceAssignments).map(canonicalResourceAssignment)
    ];
  }

  function canonicalBlock(block) {
    return [
      canonNum(block && block.blockIndex),
      block && block.sourceBlockIndex != null && block.sourceBlockIndex !== ""
        ? canonNum(block.sourceBlockIndex)
        : "",
      canonNum(block && block.startMin),
      canonNum(block && block.endMin),
      Number(block && block.waitBeforeMinutes) || 0,
      canonFlag(block && block.parallel),
      canonText(block && block.parallelGroup),
      (block && block.lineKeys || []).map(canonText)
    ];
  }

  function canonAvailabilityVersion(value) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
    return ["noncanonical", value == null ? "" : String(value)];
  }

  function canonicalAvailabilityVersions(list) {
    return (Array.isArray(list) ? list.slice() : []).sort(function (a, b) {
      return canonText(a && a.locationId).localeCompare(canonText(b && b.locationId));
    }).map(function (row) {
      return [canonText(row && row.locationId), canonAvailabilityVersion(row && row.version)];
    });
  }

  function normalizeAvailabilityVersions(raw, requiredLocationId) {
    if (raw == null) {
      return { ok: false, reason: "availability_version_missing", versions: [] };
    }
    if (!Array.isArray(raw)) {
      return { ok: false, reason: "availability_version_invalid", versions: [] };
    }
    if (!raw.length) {
      return { ok: false, reason: "availability_version_missing", versions: [] };
    }
    var seen = {};
    var out = [];
    var i;
    for (i = 0; i < raw.length; i += 1) {
      var row = raw[i];
      var locationId = trimText(row && row.locationId);
      if (!locationId) {
        return { ok: false, reason: "availability_version_invalid", versions: [] };
      }
      if (!row || typeof row.version !== "number" || !Number.isInteger(row.version) || row.version < 0) {
        return { ok: false, reason: "availability_version_invalid", versions: [] };
      }
      if (seen[locationId]) {
        return { ok: false, reason: "availability_version_invalid", versions: [] };
      }
      seen[locationId] = true;
      out.push({ locationId: locationId, version: row.version });
    }
    out.sort(function (a, b) {
      return a.locationId.localeCompare(b.locationId);
    });
    var required = trimText(requiredLocationId);
    if (required && (out.length !== 1 || out[0].locationId !== required)) {
      return { ok: false, reason: "availability_version_location_mismatch", versions: [] };
    }
    return { ok: true, versions: out };
  }

  function versionsEqual(a, b) {
    return JSON.stringify(canonicalAvailabilityVersions(a)) === JSON.stringify(canonicalAvailabilityVersions(b));
  }

  function canonicalAcceptanceIntent(command) {
    if (!command || typeof command !== "object") return [];
    var snap = command.sourceOfferSnapshot || {};
    return [
      canonText(command.commandType),
      canonText(command.locationId),
      canonText(command.dateKey),
      canonicalAvailabilityVersions(command.availabilityVersions),
      canonText(command.offerId),
      canonText(command.sourcePlanKey),
      canonText(command.acceptanceId),
      canonText(command.idempotencyKey),
      command.clientId == null || command.clientId === "" ? "" : canonText(command.clientId),
      canonNum(command.visitStartMin),
      canonNum(command.visitEndMin),
      (command.blocks || []).map(canonicalBlock),
      (command.serviceLines || []).map(canonicalServiceLine),
      [
        Number(snap.totalClientWaitMinutes) || 0,
        Number(snap.visitElapsedMinutes) || 0,
        canonFlag(snap.orderChanged),
        Number(snap.parallelMinutesSaved) || 0
      ]
    ];
  }

  function acceptanceFingerprintForCommand(command) {
    return JSON.stringify(canonicalAcceptanceIntent(command));
  }

  function providerPreconditions(offer, providerDays) {
    var byId = {};
    (Array.isArray(providerDays) ? providerDays : []).map(asDay).forEach(function (day) {
      var id = trimText(day && day.providerId);
      if (id && !byId[id]) byId[id] = day;
    });
    return (offer.serviceLines || []).map(function (line) {
      var day = byId[trimText(line.providerId)];
      return {
        providerId: line.providerId,
        lineKey: line.lineKey,
        startMin: line.startMin,
        endMin: line.endMin,
        allowedOverlapMinutes: allowedOverlapOf(day)
      };
    });
  }

  function resourcePreconditions(offer) {
    var out = [];
    (offer.serviceLines || []).forEach(function (line) {
      (line.resourceAssignments || []).forEach(function (row) {
        var window = reservationOf(line, row);
        out.push({
          resourceId: row.resourceId,
          lineKey: line.lineKey,
          requirementKey: row.requirementKey,
          reservationStartMin: window.startMin,
          reservationEndMin: window.endMin
        });
      });
    });
    return out;
  }

  function buildPreconditions(offer, acceptance, key, providerDays, fingerprint, versions) {
    return {
      idempotency: {
        idempotencyKey: key,
        checkRequiredAtExecution: true
      },
      acceptanceFingerprint: fingerprint || "",
      availabilityVersions: copyJson(versions || []),
      availabilityVersionCheckRequiredAtExecution: true,
      offerIdentity: {
        offerId: offer.offerId,
        sourcePlanKey: offer.sourcePlanKey,
        locationId: offer.locationId,
        dateKey: offer.dateKey
      },
      providers: providerPreconditions(offer, providerDays),
      resources: resourcePreconditions(offer),
      sameVisitConstraints: {
        uniqueProviderPerOverlappingLine: true,
        uniqueResourcePerOverlappingReservation: true,
        serviceLineAtomicity: true
      }
    };
  }

  function buildCommand(offer, acceptance, key, versions) {
    var lines = (offer.serviceLines || []).map(copyServiceLine);
    var command = {
      commandType: COMMAND_TYPE,
      locationId: offer.locationId,
      dateKey: offer.dateKey,
      availabilityVersions: copyJson(versions || []),
      offerId: offer.offerId,
      sourcePlanKey: offer.sourcePlanKey,
      acceptanceId: acceptance.acceptanceId,
      idempotencyKey: key,
      visitStartMin: offer.visitStartMin,
      visitEndMin: offer.visitEndMin,
      assignmentKey: offer.assignmentKey,
      resourceAssignmentKey: offer.resourceAssignmentKey || "",
      serviceLines: lines,
      blocks: copyJson(offer.blocks || []),
      sourceOfferSnapshot: {
        totalClientWaitMinutes: Number(offer.totalClientWaitMinutes) || 0,
        visitElapsedMinutes: Number(offer.visitElapsedMinutes) || 0,
        orderChanged: !!offer.orderChanged,
        parallelMinutesSaved: Number(offer.parallelMinutesSaved) || 0
      }
    };
    if (acceptance.clientId != null && trimText(acceptance.clientId)) {
      command.clientId = trimText(acceptance.clientId);
    }
    command.acceptanceFingerprint = acceptanceFingerprintForCommand(command);
    return command;
  }

  function emptyAcceptanceResult(status, reasons, extras) {
    var extra = extras || {};
    return {
      status: status,
      readyForAtomicExecution: false,
      refreshRequired: status === "stale" || extra.refreshRequired === true,
      reasonCodes: (reasons || []).slice(),
      offerId: extra.offerId || "",
      sourcePlanKey: extra.sourcePlanKey || "",
      acceptanceId: extra.acceptanceId || "",
      idempotencyKey: extra.idempotencyKey || "",
      revalidation: extra.revalidation || null,
      idempotencyCheckRequiredAtExecution: true,
      advisoryOnly: true,
      writesPerformed: false,
      holdsCapacity: false
    };
  }

  function prepareOfferAcceptance(providerDays, resourceDays, offer, acceptance, options) {
    var acceptReasons = validateAcceptance(offer, acceptance);
    var identity = {
      offerId: offer && offer.offerId || acceptance && acceptance.offerId || "",
      sourcePlanKey: offer && offer.sourcePlanKey || acceptance && acceptance.sourcePlanKey || "",
      acceptanceId: acceptance && acceptance.acceptanceId || ""
    };
    if (acceptReasons.length) {
      return emptyAcceptanceResult("invalid_acceptance", acceptReasons, identity);
    }
    var versionNorm = normalizeAvailabilityVersions(
      options && Object.prototype.hasOwnProperty.call(options, "availabilityVersions")
        ? options.availabilityVersions
        : null,
      offer && offer.locationId
    );
    if (!versionNorm.ok) {
      return emptyAcceptanceResult("invalid_acceptance", [versionNorm.reason], identity);
    }
    var api = ns();
    var revalidation = typeof api.revalidateClientVisitOffer === "function"
      ? api.revalidateClientVisitOffer(providerDays, resourceDays, offer, options)
      : { status: "invalid_offer", validNow: false, reasonCodes: ["offer_invalid"] };
    identity.offerId = offer.offerId;
    identity.sourcePlanKey = offer.sourcePlanKey;
    identity.acceptanceId = acceptance.acceptanceId;
    identity.idempotencyKey = idempotencyKeyOf(offer, acceptance);
    identity.revalidation = revalidation;

    if (!revalidation || revalidation.status === "invalid_offer" || revalidation.validNow !== true && revalidation.status !== "stale") {
      var invalidReasons = (revalidation && revalidation.reasonCodes || []).slice();
      addCode(invalidReasons, "offer_invalid");
      return emptyAcceptanceResult("invalid_offer", invalidReasons, identity);
    }
    if (revalidation.status === "stale" || revalidation.validNow !== true) {
      var staleReasons = (revalidation.reasonCodes || []).slice();
      addCode(staleReasons, "offer_stale");
      return emptyAcceptanceResult("stale", staleReasons, identity);
    }
    if ((offer.serviceLines || []).some(function (line) { return !lineAtomic(line); })) {
      return emptyAcceptanceResult("invalid_offer", ["offer_invalid"], identity);
    }

    var command = buildCommand(offer, acceptance, identity.idempotencyKey, versionNorm.versions);
    var preconditions = buildPreconditions(
      offer,
      acceptance,
      identity.idempotencyKey,
      providerDays,
      command.acceptanceFingerprint,
      versionNorm.versions
    );
    return {
      status: "ready",
      readyForAtomicExecution: true,
      refreshRequired: false,
      reasonCodes: ["ready_for_atomic_execution"],
      offerId: offer.offerId,
      sourcePlanKey: offer.sourcePlanKey,
      acceptanceId: acceptance.acceptanceId,
      idempotencyKey: identity.idempotencyKey,
      acceptanceFingerprint: command.acceptanceFingerprint,
      bookingCommand: command,
      transactionPreconditions: preconditions,
      revalidation: revalidation,
      idempotencyCheckRequiredAtExecution: true,
      advisoryOnly: true,
      writesPerformed: false,
      holdsCapacity: false
    };
  }

  function prepareOfferAcceptances(providerDays, resourceDays, requests, options) {
    return (Array.isArray(requests) ? requests : []).map(function (row) {
      var merged = Object.assign({}, options || {}, row && row.options || {});
      return prepareOfferAcceptance(providerDays, resourceDays, row && row.offer, row && row.acceptance, merged);
    });
  }

  function flattenCommandResources(command) {
    var out = [];
    (command && command.serviceLines || []).forEach(function (line) {
      (line.resourceAssignments || []).forEach(function (row) {
        out.push({
          resourceId: row.resourceId,
          lineKey: line.lineKey,
          requirementKey: row.requirementKey,
          reservationStartMin: row.reservationStartMin,
          reservationEndMin: row.reservationEndMin
        });
      });
    });
    return out;
  }

  function commandMatchesPreconditions(command, pre) {
    if (!command || !pre || !pre.offerIdentity || !pre.idempotency) return false;
    if (command.offerId !== pre.offerIdentity.offerId) return false;
    if (command.sourcePlanKey !== pre.offerIdentity.sourcePlanKey) return false;
    if (command.locationId !== pre.offerIdentity.locationId) return false;
    if (command.dateKey !== pre.offerIdentity.dateKey) return false;
    if (command.idempotencyKey !== pre.idempotency.idempotencyKey) return false;
    if (!versionsEqual(command.availabilityVersions, pre.availabilityVersions)) return false;
    if (command.commandType !== COMMAND_TYPE) return false;
    var lines = command.serviceLines || [];
    var providers = pre.providers || [];
    if (lines.length !== providers.length) return false;
    var i;
    for (i = 0; i < lines.length; i += 1) {
      if (lines[i].lineKey !== providers[i].lineKey) return false;
      if (lines[i].providerId !== providers[i].providerId) return false;
      if (Number(lines[i].startMin) !== Number(providers[i].startMin)) return false;
      if (Number(lines[i].endMin) !== Number(providers[i].endMin)) return false;
      if (!lineAtomic(lines[i])) return false;
    }
    var cmdRes = flattenCommandResources(command);
    var preRes = pre.resources || [];
    if (cmdRes.length !== preRes.length) return false;
    for (i = 0; i < cmdRes.length; i += 1) {
      if (cmdRes[i].resourceId !== preRes[i].resourceId) return false;
      if (cmdRes[i].lineKey !== preRes[i].lineKey) return false;
      if (cmdRes[i].requirementKey !== preRes[i].requirementKey) return false;
      if (Number(cmdRes[i].reservationStartMin) !== Number(preRes[i].reservationStartMin)) return false;
      if (Number(cmdRes[i].reservationEndMin) !== Number(preRes[i].reservationEndMin)) return false;
    }
    return true;
  }

  function offerFromCommand(command) {
    return {
      offerId: command.offerId,
      sourcePlanKey: command.sourcePlanKey,
      dateKey: command.dateKey,
      locationId: command.locationId,
      visitStartMin: command.visitStartMin,
      visitEndMin: command.visitEndMin,
      totalClientWaitMinutes: command.sourceOfferSnapshot && command.sourceOfferSnapshot.totalClientWaitMinutes,
      visitElapsedMinutes: command.sourceOfferSnapshot && command.sourceOfferSnapshot.visitElapsedMinutes,
      assignmentKey: command.assignmentKey,
      resourceAssignmentKey: command.resourceAssignmentKey,
      blocks: command.blocks,
      serviceLines: command.serviceLines
    };
  }

  function evaluateAcceptancePreconditions(providerDays, resourceDays, bookingCommand, transactionPreconditions, executionState) {
    var reasons = [];
    if (!bookingCommand || typeof bookingCommand !== "object") {
      return {
        status: "command_invalid",
        reasonCodes: ["command_integrity_mismatch"],
        writesPerformed: false,
        advisoryOnly: true
      };
    }
    var expected = acceptanceFingerprintForCommand(bookingCommand);
    if (!expected || expected !== String(bookingCommand.acceptanceFingerprint || "")) {
      addCode(reasons, "command_integrity_mismatch");
      return {
        status: "command_invalid",
        reasonCodes: reasons,
        writesPerformed: false,
        advisoryOnly: true
      };
    }
    if (transactionPreconditions && transactionPreconditions.acceptanceFingerprint
      && transactionPreconditions.acceptanceFingerprint !== expected) {
      addCode(reasons, "command_integrity_mismatch");
      return {
        status: "command_invalid",
        reasonCodes: reasons,
        writesPerformed: false,
        advisoryOnly: true
      };
    }
    if (transactionPreconditions && !versionsEqual(bookingCommand.availabilityVersions, transactionPreconditions.availabilityVersions)) {
      addCode(reasons, "command_integrity_mismatch");
      return {
        status: "command_invalid",
        reasonCodes: reasons,
        writesPerformed: false,
        advisoryOnly: true
      };
    }
    if (!commandMatchesPreconditions(bookingCommand, transactionPreconditions)) {
      addCode(reasons, "command_integrity_mismatch");
      return {
        status: "command_invalid",
        reasonCodes: reasons,
        writesPerformed: false,
        advisoryOnly: true
      };
    }
    var completed = executionState && Array.isArray(executionState.completedIdempotencyKeys)
      ? executionState.completedIdempotencyKeys
      : [];
    if (completed.indexOf(bookingCommand.idempotencyKey) !== -1) {
      return {
        status: "already_completed",
        reasonCodes: ["already_completed"],
        idempotencyKey: bookingCommand.idempotencyKey,
        writesPerformed: false,
        advisoryOnly: true
      };
    }
    var api = ns();
    var revalidation = typeof api.revalidateClientVisitOffer === "function"
      ? api.revalidateClientVisitOffer(providerDays, resourceDays, offerFromCommand(bookingCommand))
      : { status: "invalid_offer", validNow: false, reasonCodes: ["offer_invalid"] };
    if (revalidation && revalidation.status === "still_valid" && revalidation.validNow === true) {
      return {
        status: "can_create",
        reasonCodes: ["ready_for_atomic_execution"],
        idempotencyKey: bookingCommand.idempotencyKey,
        revalidation: revalidation,
        writesPerformed: false,
        advisoryOnly: true
      };
    }
    var failReasons = (revalidation && revalidation.reasonCodes || []).slice();
    if (revalidation && revalidation.status === "stale") addCode(failReasons, "offer_stale");
    else addCode(failReasons, "offer_invalid");
    return {
      status: "precondition_failed",
      reasonCodes: failReasons,
      idempotencyKey: bookingCommand.idempotencyKey,
      revalidation: revalidation,
      writesPerformed: false,
      advisoryOnly: true
    };
  }

  var api = ns();
  api.prepareOfferAcceptance = prepareOfferAcceptance;
  api.prepareOfferAcceptances = prepareOfferAcceptances;
  api.evaluateAcceptancePreconditions = evaluateAcceptancePreconditions;
  api.acceptanceFingerprintForCommand = acceptanceFingerprintForCommand;
  api.canonicalAcceptanceIntent = canonicalAcceptanceIntent;
  api.normalizeAvailabilityVersions = normalizeAvailabilityVersions;
  api.OFFER_ACCEPTANCE = {
    ADVISORY_ONLY: true,
    WRITES_PERFORMED: false,
    HOLDS_CAPACITY: false,
    COMMAND_TYPE: COMMAND_TYPE,
    STATUS_READY: "ready",
    STATUS_STALE: "stale",
    STATUS_INVALID_OFFER: "invalid_offer",
    STATUS_INVALID_ACCEPTANCE: "invalid_acceptance",
    EVAL_CAN_CREATE: "can_create",
    EVAL_ALREADY_COMPLETED: "already_completed",
    EVAL_PRECONDITION_FAILED: "precondition_failed",
    EVAL_COMMAND_INVALID: "command_invalid"
  };
})();
