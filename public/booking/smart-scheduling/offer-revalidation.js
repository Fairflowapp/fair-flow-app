/**
 * Smart Scheduling Phase 16 — exact client-offer revalidation.
 *
 * Advisory only. Checks whether THIS offer is still feasible against a
 * newer provider/resource snapshot. Does not reschedule, substitute,
 * reserve, book, or write.
 *
 * advisoryOnly = true, holdsCapacity = false.
 */
(function () {
  var OFFER_PREFIX = "__smart_offer__";
  var SIM_LINE_PREFIX = "__smart_revalidate__";

  function ns() {
    return window.ffBookingSmartScheduling || (window.ffBookingSmartScheduling = {});
  }

  function p12() {
    return ns().PHASE12_INTERNALS || {};
  }

  function p13() {
    return ns().PHASE13_INTERNALS || {};
  }

  function p15() {
    return ns().PHASE15_INTERNALS || {};
  }

  function helpers() {
    return ns().helpers || {};
  }

  function trimText(value) {
    var h = helpers();
    return h.trimText ? h.trimText(value) : String(value == null ? "" : value).trim();
  }

  function overlapMinutes(a0, a1, b0, b1) {
    var h = helpers();
    if (h.overlapMinutes) return h.overlapMinutes(a0, a1, b0, b1);
    var n = Math.min(a1, b1) - Math.max(a0, b0);
    return n > 0 ? n : 0;
  }

  function allowedOverlapOf(day) {
    var h = helpers();
    var raw = day && day.allowedOverlapMinutes;
    return h.normalizeAllowedOverlap ? h.normalizeAllowedOverlap(raw) : (Number(raw) || 0);
  }

  function asDay(input) {
    if (p12().asDay) return p12().asDay(input);
    var api = ns();
    return typeof api.normalizeProviderDay === "function" ? api.normalizeProviderDay(input || {}) : input;
  }

  function addCode(list, code) {
    if (!code || list.indexOf(code) !== -1) return;
    list.push(code);
  }

  function uniqueSorted(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (item) {
      var key = String(item || "");
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(key);
    });
    out.sort();
    return out;
  }

  function offerIdFromKey(key) {
    if (p15().offerIdFromSourceKey) return p15().offerIdFromSourceKey(key);
    return (p15().OFFER_ID_PREFIX || OFFER_PREFIX) + "|" + String(key || "");
  }

  function assignmentKeyOf(offer) {
    if (offer && offer.assignmentKey) return String(offer.assignmentKey);
    return (offer && offer.serviceLines || []).map(function (row) {
      return String(row.lineKey || "") + "|" + String(row.providerId || "");
    }).join("||");
  }

  function resourceAssignmentKeyOf(offer) {
    if (offer && offer.resourceAssignmentKey) return String(offer.resourceAssignmentKey);
    return (offer && offer.serviceLines || []).reduce(function (parts, line) {
      (line.resourceAssignments || []).forEach(function (row) {
        parts.push([line.lineKey, row.requirementKey, row.resourceId].join("|"));
      });
      return parts;
    }, []).join("||");
  }

  function planLikeFromOffer(offer) {
    return {
      dateKey: offer && offer.dateKey,
      locationId: offer && offer.locationId,
      visitStartMin: offer.visitStartMin,
      visitEndMin: offer.visitEndMin,
      totalClientWaitMinutes: offer.totalClientWaitMinutes,
      visitElapsedMinutes: offer.visitElapsedMinutes,
      assignmentKey: assignmentKeyOf(offer),
      resourceAssignmentKey: resourceAssignmentKeyOf(offer),
      blocks: offer.blocks || [],
      serviceLines: offer.serviceLines || []
    };
  }

  function recomputeSourceKey(offer) {
    var sig = p15().exactSourceSignature;
    return sig ? sig(planLikeFromOffer(offer)) : "";
  }

  function emptyResult(offer, status, reasons) {
    return {
      offerId: offer && offer.offerId || "",
      validNow: status === "still_valid",
      stale: status === "stale",
      status: status,
      reasonCodes: (reasons || []).slice(),
      lineResults: [],
      resourceResults: [],
      providerConflictCount: 0,
      resourceConflictCount: 0,
      originalSourcePlanKey: offer && offer.sourcePlanKey || "",
      refreshRequired: status !== "still_valid",
      advisoryOnly: true,
      holdsCapacity: false
    };
  }

  function occupancyIdentities(row) {
    if (!row) return [];
    if (row.occupancyId) return [trimText(row.occupancyId)].filter(Boolean);
    var ids = [];
    var appointmentId = trimText(row.appointmentId);
    var lineId = trimText(row.lineId);
    if (appointmentId && appointmentId.indexOf(SIM_LINE_PREFIX) !== 0) ids.push(appointmentId);
    if (lineId && lineId.indexOf(SIM_LINE_PREFIX) !== 0 && ids.indexOf(lineId) === -1) ids.push(lineId);
    return ids;
  }

  function fitsWorking(intervals, startMin, endMin) {
    return (intervals || []).some(function (win) {
      var a = Number(win.startMin != null ? win.startMin : win.start);
      var b = Number(win.endMin != null ? win.endMin : win.end);
      return startMin >= a && endMin <= b;
    });
  }

  function validateOfferIntegrity(offer) {
    var reasons = [];
    if (!offer || typeof offer !== "object") {
      addCode(reasons, "offer_integrity_mismatch");
      return reasons;
    }
    if (!trimText(offer.offerId) || !trimText(offer.sourcePlanKey)
      || !trimText(offer.dateKey) || !trimText(offer.locationId)) {
      addCode(reasons, "offer_integrity_mismatch");
    }
    var lines = Array.isArray(offer.serviceLines) ? offer.serviceLines : [];
    if (!lines.length) addCode(reasons, "offer_timeline_invalid");
    var seen = {};
    var minStart = null;
    var maxEnd = null;
    lines.forEach(function (line) {
      var key = trimText(line && line.lineKey);
      if (!key) addCode(reasons, "offer_timeline_invalid");
      if (key && seen[key]) addCode(reasons, "offer_timeline_invalid");
      if (key) seen[key] = true;
      if (!trimText(line && line.providerId) || Array.isArray(line && line.providerId)) {
        addCode(reasons, "offer_timeline_invalid");
      }
      var start = Number(line && line.startMin);
      var end = Number(line && line.endMin);
      var dur = Number(line && line.durationMinutes);
      if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
        addCode(reasons, "offer_timeline_invalid");
      } else if (!Number.isFinite(dur) || dur !== end - start) {
        addCode(reasons, "offer_timeline_invalid");
      }
      if (Number.isFinite(start)) minStart = minStart == null ? start : Math.min(minStart, start);
      if (Number.isFinite(end)) maxEnd = maxEnd == null ? end : Math.max(maxEnd, end);
      var reqSeen = {};
      (line && line.resourceAssignments || []).forEach(function (row) {
        var reqKey = trimText(row && row.requirementKey);
        if (!reqKey || reqSeen[reqKey]) addCode(reasons, "resource_assignment_invalid");
        if (reqKey) reqSeen[reqKey] = true;
        if (!trimText(row && row.resourceId)) addCode(reasons, "resource_assignment_invalid");
        var rs = Number(row && row.reservationStartMin);
        var re = Number(row && row.reservationEndMin);
        if (!Number.isFinite(rs) || !Number.isFinite(re) || !(re > rs)) {
          addCode(reasons, "resource_assignment_invalid");
        }
      });
    });
    var visitStart = Number(offer.visitStartMin);
    var visitEnd = Number(offer.visitEndMin);
    if (!Number.isFinite(visitStart) || !Number.isFinite(visitEnd) || !(visitEnd > visitStart)) {
      addCode(reasons, "offer_timeline_invalid");
    } else if (minStart != null && maxEnd != null && (visitStart > minStart || visitEnd < maxEnd)) {
      addCode(reasons, "offer_timeline_invalid");
    }
    var blocks = Array.isArray(offer.blocks) ? offer.blocks : [];
    if (lines.length && !blocks.length) addCode(reasons, "offer_timeline_invalid");
    var inBlocks = {};
    var lineByKey = {};
    lines.forEach(function (line) {
      if (line && line.lineKey) lineByKey[line.lineKey] = line;
    });
    blocks.forEach(function (block, idx) {
      var bStart = Number(block && block.startMin);
      var bEnd = Number(block && block.endMin);
      if (!Number.isFinite(bStart) || !Number.isFinite(bEnd) || !(bEnd > bStart)) {
        addCode(reasons, "offer_timeline_invalid");
      }
      if (idx > 0) {
        var prev = blocks[idx - 1];
        var wait = Number(block.waitBeforeMinutes) || 0;
        if (Number(prev.endMin) + wait !== bStart) addCode(reasons, "offer_timeline_invalid");
      }
      var blockMin = null;
      var blockMax = null;
      (block.lineKeys || []).forEach(function (lineKey) {
        if (!seen[lineKey] || inBlocks[lineKey]) addCode(reasons, "offer_timeline_invalid");
        inBlocks[lineKey] = true;
        var member = lineByKey[lineKey];
        if (!member) return;
        blockMin = blockMin == null ? member.startMin : Math.min(blockMin, member.startMin);
        blockMax = blockMax == null ? member.endMin : Math.max(blockMax, member.endMin);
      });
      if (blockMin != null && (bStart !== blockMin || bEnd !== blockMax)) {
        addCode(reasons, "offer_timeline_invalid");
      }
    });
    lines.forEach(function (line) {
      if (line && line.lineKey && !inBlocks[line.lineKey]) addCode(reasons, "offer_timeline_invalid");
    });
    var expectedKey = recomputeSourceKey(offer);
    if (!expectedKey || expectedKey !== String(offer.sourcePlanKey || "")) {
      addCode(reasons, "offer_integrity_mismatch");
    }
    if (trimText(offer.offerId) && offer.offerId !== offerIdFromKey(offer.sourcePlanKey)) {
      addCode(reasons, "offer_integrity_mismatch");
    }
    return reasons;
  }

  function snapshotIdentities(providerDays, resourceList) {
    var reasons = [];
    var seenProv = {};
    (providerDays || []).forEach(function (day) {
      var id = trimText(day && day.providerId);
      if (!id || seenProv[id]) addCode(reasons, "snapshot_context_mismatch");
      if (id) seenProv[id] = true;
    });
    var seenRes = {};
    (resourceList || []).forEach(function (day) {
      var id = trimText(day && day.resourceId);
      if (!id || seenRes[id]) addCode(reasons, "snapshot_context_mismatch");
      if (id) seenRes[id] = true;
    });
    return reasons;
  }

  function snapshotContext(providerDays, resourceList, offer) {
    var reasons = snapshotIdentities(providerDays, resourceList);
    var locationId = trimText(offer && offer.locationId);
    var dateKey = trimText(offer && offer.dateKey);
    var days = providerDays || [];
    if (!days.length) {
      addCode(reasons, "snapshot_context_mismatch");
      return reasons;
    }
    days.forEach(function (day) {
      if (trimText(day.locationId) !== locationId || trimText(day.dateKey) !== dateKey) {
        addCode(reasons, "snapshot_context_mismatch");
      }
    });
    (resourceList || []).forEach(function (day) {
      if (trimText(day.locationId) !== locationId || trimText(day.dateKey) !== dateKey) {
        addCode(reasons, "snapshot_context_mismatch");
      }
    });
    return reasons;
  }

  function copyOccupied(list) {
    return (list || []).map(function (row) { return Object.assign({}, row); });
  }

  function copyDay(day) {
    return {
      dateKey: trimText(day && day.dateKey),
      locationId: trimText(day && day.locationId),
      providerId: trimText(day && day.providerId),
      allowedOverlapMinutes: day && day.allowedOverlapMinutes != null ? day.allowedOverlapMinutes : 0,
      workingIntervals: (day && day.workingIntervals || []).map(function (row) {
        return { startMin: row.startMin, endMin: row.endMin };
      }),
      occupied: copyOccupied(day && day.occupied)
    };
  }

  function existingConflicts(day, startMin, endMin) {
    var allowed = allowedOverlapOf(day);
    var ids = [];
    (day && day.occupied || []).forEach(function (row) {
      if (overlapMinutes(startMin, endMin, row.startMin, row.endMin) > allowed) {
        occupancyIdentities(row).forEach(function (id) { ids.push(id); });
      }
    });
    return uniqueSorted(ids);
  }

  function offerLinesOverlap(a, b) {
    return overlapMinutes(a.startMin, a.endMin, b.startMin, b.endMin) > 0;
  }

  function reservationOf(line, row) {
    var start = Number(row.reservationStartMin);
    var end = Number(row.reservationEndMin);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return { startMin: start, endMin: end };
    }
    var before = Number(row.bufferBeforeMinutes) || 0;
    var after = Number(row.bufferAfterMinutes) || 0;
    return {
      startMin: Number(line.startMin) - before,
      endMin: Number(line.endMin) + after
    };
  }

  function revalidateClientVisitOffer(providerDays, resourceDays, offer, options) {
    void options;
    var integrity = validateOfferIntegrity(offer);
    if (integrity.length) {
      return emptyResult(offer || {}, "invalid_offer", integrity);
    }

    var days = (Array.isArray(providerDays) ? providerDays : []).map(asDay);
    var parsedRes = p13().parseResourceDays
      ? p13().parseResourceDays(resourceDays)
      : { days: Array.isArray(resourceDays) ? resourceDays : [] };
    if (parsedRes.error) {
      return emptyResult(offer, "invalid_offer", ["snapshot_context_mismatch"]);
    }
    var resourceList = parsedRes.days || [];
    var context = snapshotContext(days, resourceList, offer);
    if (context.length) return emptyResult(offer, "invalid_offer", context);

    var daysById = {};
    days.forEach(function (day) { daysById[trimText(day.providerId)] = copyDay(day); });
    var resourceById = {};
    resourceList.forEach(function (day) { resourceById[day.resourceId] = day; });

    var lines = (offer.serviceLines || []).slice().sort(function (a, b) {
      return a.startMin - b.startMin || String(a.lineKey).localeCompare(String(b.lineKey));
    });
    var lineResults = [];
    var resourceResults = [];
    var reasons = [];
    var providerConflictCount = 0;
    var resourceConflictCount = 0;
    var placed = [];

    lines.forEach(function (line) {
      var lineReasons = [];
      var conflictIds = [];
      var providerId = trimText(line.providerId);
      var day = daysById[providerId];
      if (!day) {
        addCode(lineReasons, "provider_missing");
        addCode(reasons, "provider_missing");
      } else if (!fitsWorking(day.workingIntervals, line.startMin, line.endMin)) {
        addCode(lineReasons, "provider_schedule_changed");
        addCode(reasons, "provider_schedule_changed");
      } else {
        var sameVisit = placed.some(function (prev) {
          return prev.providerId === providerId && offerLinesOverlap(prev, line);
        });
        if (sameVisit) {
          addCode(lineReasons, "same_visit_provider_conflict");
          addCode(reasons, "same_visit_provider_conflict");
        }
        conflictIds = existingConflicts(day, line.startMin, line.endMin);
        if (conflictIds.length) {
          addCode(lineReasons, "provider_now_conflicted");
          addCode(reasons, "provider_now_conflicted");
          providerConflictCount += conflictIds.length;
        }
        day.occupied.push({
          lineId: SIM_LINE_PREFIX + "|" + line.lineKey,
          appointmentId: SIM_LINE_PREFIX + "|" + line.lineKey,
          providerId: providerId,
          startMin: line.startMin,
          endMin: line.endMin,
          durationMinutes: line.durationMinutes,
          status: "scheduled"
        });
      }
      placed.push(line);
      lineResults.push({
        lineKey: line.lineKey,
        providerId: providerId,
        startMin: line.startMin,
        endMin: line.endMin,
        validNow: lineReasons.length === 0,
        reasonCodes: lineReasons,
        providerConflictIds: conflictIds
      });
    });

    var api = ns();
    days.forEach(function (original) {
      var id = trimText(original.providerId);
      var simulated = daysById[id];
      if (!simulated || typeof api.newOrWorsenedOverlapConflict !== "function") return;
      var baseline = typeof api.baselineConflictMap === "function" ? api.baselineConflictMap(original) : {};
      if (api.newOrWorsenedOverlapConflict(simulated.occupied, allowedOverlapOf(original), baseline)) {
        addCode(reasons, "provider_now_conflicted");
      }
    });

    var reservations = [];
    lines.forEach(function (line) {
      (line.resourceAssignments || []).forEach(function (row) {
        reservations.push({
          line: line,
          row: row,
          window: reservationOf(line, row)
        });
      });
    });
    reservations.sort(function (a, b) {
      return a.window.startMin - b.window.startMin
        || String(a.line.lineKey).localeCompare(String(b.line.lineKey))
        || String(a.row.requirementKey).localeCompare(String(b.row.requirementKey));
    });
    var placedRes = [];
    var busyById = {};
    Object.keys(resourceById).forEach(function (id) {
      busyById[id] = (resourceById[id].occupied || []).map(function (row) {
        return { startMin: row.startMin, endMin: row.endMin, occupancyId: row.occupancyId };
      });
    });

    reservations.forEach(function (item) {
      var resReasons = [];
      var conflictIds = [];
      var resourceId = trimText(item.row.resourceId);
      var day = resourceById[resourceId];
      if (!day) {
        addCode(resReasons, "resource_missing");
        addCode(reasons, "resource_missing");
      } else if (!fitsWorking(day.workingIntervals, item.window.startMin, item.window.endMin)) {
        addCode(resReasons, "resource_schedule_changed");
        addCode(reasons, "resource_schedule_changed");
      } else {
        var sameVisit = placedRes.some(function (prev) {
          return prev.resourceId === resourceId
            && overlapMinutes(prev.startMin, prev.endMin, item.window.startMin, item.window.endMin) > 0;
        });
        if (sameVisit) {
          addCode(resReasons, "same_visit_resource_conflict");
          addCode(reasons, "same_visit_resource_conflict");
        }
        (busyById[resourceId] || []).forEach(function (occ) {
          if (overlapMinutes(item.window.startMin, item.window.endMin, occ.startMin, occ.endMin) > 0) {
            if (occ.occupancyId) conflictIds.push(occ.occupancyId);
          }
        });
        conflictIds = uniqueSorted(conflictIds);
        if (conflictIds.length) {
          addCode(resReasons, "resource_now_conflicted");
          addCode(reasons, "resource_now_conflicted");
          resourceConflictCount += conflictIds.length;
        }
        busyById[resourceId] = (busyById[resourceId] || []).concat([{
          startMin: item.window.startMin,
          endMin: item.window.endMin,
          occupancyId: ""
        }]);
      }
      placedRes.push({
        resourceId: resourceId,
        startMin: item.window.startMin,
        endMin: item.window.endMin
      });
      resourceResults.push({
        lineKey: item.line.lineKey,
        requirementKey: item.row.requirementKey,
        resourceId: resourceId,
        reservationStartMin: item.window.startMin,
        reservationEndMin: item.window.endMin,
        validNow: resReasons.length === 0,
        reasonCodes: resReasons,
        conflictOccupancyIds: conflictIds
      });
    });

    var finalStatus = reasons.length ? "stale" : "still_valid";
    if (!reasons.length) addCode(reasons, "still_valid");
    return {
      offerId: offer.offerId,
      validNow: finalStatus === "still_valid",
      stale: finalStatus === "stale",
      status: finalStatus,
      reasonCodes: reasons,
      lineResults: lineResults,
      resourceResults: resourceResults,
      providerConflictCount: providerConflictCount,
      resourceConflictCount: resourceConflictCount,
      originalSourcePlanKey: offer.sourcePlanKey,
      refreshRequired: finalStatus !== "still_valid",
      advisoryOnly: true,
      holdsCapacity: false
    };
  }

  function revalidateClientVisitOffers(providerDays, resourceDays, offers, options) {
    return (Array.isArray(offers) ? offers : []).map(function (offer) {
      return revalidateClientVisitOffer(providerDays, resourceDays, offer, options);
    });
  }

  var api = ns();
  api.revalidateClientVisitOffer = revalidateClientVisitOffer;
  api.revalidateClientVisitOffers = revalidateClientVisitOffers;
  api.OFFER_REVALIDATION = {
    ADVISORY_ONLY: true,
    HOLDS_CAPACITY: false,
    STATUS_STILL_VALID: "still_valid",
    STATUS_STALE: "stale",
    STATUS_INVALID_OFFER: "invalid_offer"
  };
})();
