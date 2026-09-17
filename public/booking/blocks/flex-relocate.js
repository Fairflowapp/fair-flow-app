/**
 * Flexible Time Block relocation.
 * Fixed blocks stay hard unavailable time. Flexible required blocks may move
 * inside their allowed window without shrinking duration.
 */
(function () {
  var SNAP = 15;

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function overlaps(startA, endA, startB, endB) {
    return Number(startA) < Number(endB) && Number(endA) > Number(startB);
  }

  function isFlexible(block) {
    if (!block) return false;
    return trim(block.flexibilityMode).toLowerCase() === "flexible";
  }

  function requiredDuration(block) {
    var required = Number(block && block.requiredDurationMinutes);
    if (required > 0) return required;
    var n = Number(block && block.endMin) - Number(block && block.startMin);
    return n > 0 ? n : 0;
  }

  function preferredStart(block) {
    var n = Number(block && block.preferredStartMin);
    if (Number.isFinite(n)) return n;
    return Number(block && block.startMin);
  }

  function windowOf(block) {
    var duration = requiredDuration(block);
    var earliest = Number(block && block.earliestStartMin);
    var latest = Number(block && block.latestEndMin);
    var start = Number(block && block.startMin);
    var end = Number(block && block.endMin);
    if (!Number.isFinite(earliest)) earliest = start;
    if (!Number.isFinite(latest)) latest = end;
    return {
      earliestStartMin: earliest,
      latestEndMin: latest,
      durationMinutes: duration
    };
  }

  function insideWorking(startMin, endMin, intervals) {
    return (intervals || []).some(function (win) {
      return win && startMin >= Number(win.startMin) && endMin <= Number(win.endMin);
    });
  }

  function blockedBy(startMin, endMin, rows, skip) {
    var ignore = skip || {};
    return (rows || []).some(function (row) {
      if (!row) return false;
      var id = trim(row.blockId || row.appointmentId || row.lineId);
      if (id && ignore[id]) return false;
      return overlaps(startMin, endMin, row.startMin, row.endMin);
    });
  }

  function snapFloor(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.floor(n / SNAP) * SNAP;
  }

  function collectSkip(block, incoming) {
    var skip = {};
    if (block && block.blockId) skip[trim(block.blockId)] = true;
    if (incoming) {
      ["appointmentId", "lineId", "excludeAppointmentId", "excludeBlockId"].forEach(function (key) {
        var id = trim(incoming[key]);
        if (id) skip[id] = true;
      });
    }
    return skip;
  }

  function classifyBlock(block) {
    return isFlexible(block) ? "movable" : "hard";
  }

  function findRelocation(block, incoming, context) {
    var ctx = context || {};
    var duration = requiredDuration(block);
    if (!block || !(duration > 0)) return { ok: false, reason: "invalid" };
    var incomingStart = Number(incoming && incoming.startMin);
    var incomingEnd = Number(incoming && incoming.endMin);
    if (!Number.isFinite(incomingEnd) && Number.isFinite(Number(incoming && incoming.durationMinutes))) {
      incomingEnd = incomingStart + Number(incoming.durationMinutes);
    }
    var currentStart = Number(block.startMin);
    var currentEnd = Number(block.endMin);
    if (!isFlexible(block)) {
      if (Number.isFinite(incomingStart) && Number.isFinite(incomingEnd)
          && overlaps(incomingStart, incomingEnd, currentStart, currentEnd)) {
        return { ok: false, reason: "fixed" };
      }
      return {
        ok: true,
        moved: false,
        startMin: currentStart,
        endMin: currentEnd,
        durationMinutes: duration
      };
    }
    if (!(Number.isFinite(incomingStart) && Number.isFinite(incomingEnd)
        && overlaps(incomingStart, incomingEnd, currentStart, currentEnd))) {
      return {
        ok: true,
        moved: false,
        startMin: currentStart,
        endMin: currentEnd,
        preferredStartMin: preferredStart(block),
        durationMinutes: duration
      };
    }
    var win = windowOf(block);
    if (win.latestEndMin - win.earliestStartMin < duration) {
      return { ok: false, reason: "window" };
    }
    var skip = collectSkip(block, incoming);
    var preferred = preferredStart(block);
    var appointments = ctx.appointments || [];
    var otherBlocks = ctx.blocks || [];
    var working = ctx.workingIntervals;
    var candidates = [];
    var start = snapFloor(win.earliestStartMin);
    if (start < win.earliestStartMin) start += SNAP;
    for (; start + duration <= win.latestEndMin; start += SNAP) {
      var end = start + duration;
      if (end > win.latestEndMin || start < win.earliestStartMin) continue;
      if (overlaps(start, end, incomingStart, incomingEnd)) continue;
      if (working && working.length && !insideWorking(start, end, working)) continue;
      if (blockedBy(start, end, appointments, skip)) continue;
      if (blockedBy(start, end, otherBlocks, skip)) continue;
      candidates.push({
        startMin: start,
        endMin: end,
        distance: Math.abs(start - preferred)
      });
    }
    if (!candidates.length) return { ok: false, reason: "no_slot" };
    candidates.sort(function (a, b) {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return a.startMin - b.startMin;
    });
    var best = candidates[0];
    return {
      ok: true,
      moved: best.startMin !== currentStart,
      startMin: best.startMin,
      endMin: best.endMin,
      preferredStartMin: preferred,
      durationMinutes: duration,
      fromStartMin: currentStart,
      fromEndMin: currentEnd
    };
  }

  function proposalFrom(block, relocation) {
    if (!block || !relocation || !relocation.ok) return null;
    return {
      blockId: trim(block.blockId),
      seriesId: trim(block.seriesId),
      occurrenceDateKey: trim(block.occurrenceDateKey || block.dateKey),
      reason: block.reason || "",
      label: block.label || "",
      fromStartMin: relocation.fromStartMin != null ? relocation.fromStartMin : block.startMin,
      fromEndMin: relocation.fromEndMin != null ? relocation.fromEndMin : block.endMin,
      toStartMin: relocation.startMin,
      toEndMin: relocation.endMin,
      preferredStartMin: relocation.preferredStartMin != null
        ? relocation.preferredStartMin
        : preferredStart(block),
      durationMinutes: relocation.durationMinutes,
      moved: !!relocation.moved
    };
  }

  function overlappingBlocks(blocks, startMin, endMin, excludeId) {
    var skip = trim(excludeId);
    return (blocks || []).filter(function (row) {
      if (!row) return false;
      if (skip && trim(row.blockId) === skip) return false;
      return overlaps(startMin, endMin, row.startMin, row.endMin);
    });
  }

  function tryFitAppointment(spec, context) {
    var startMin = Number(spec && spec.startMin);
    var endMin = Number(spec && spec.endMin);
    if (!Number.isFinite(endMin) && Number.isFinite(Number(spec && spec.durationMinutes))) {
      endMin = startMin + Number(spec.durationMinutes);
    }
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || !(endMin > startMin)) {
      return { ok: false, reason: "invalid" };
    }
    var hits = overlappingBlocks(context && context.blocks, startMin, endMin, spec && spec.excludeBlockId);
    if (!hits.length) return { ok: true, relocations: [] };
    if (hits.some(function (row) { return !isFlexible(row); })) {
      return { ok: false, reason: "fixed" };
    }
    var relocations = [];
    var i;
    for (i = 0; i < hits.length; i += 1) {
      var found = findRelocation(hits[i], {
        startMin: startMin,
        endMin: endMin,
        appointmentId: spec && spec.appointmentId,
        excludeAppointmentId: spec && spec.excludeAppointmentId
      }, context);
      if (!found || !found.ok) return { ok: false, reason: found && found.reason || "no_slot" };
      if (found.moved) relocations.push(proposalFrom(hits[i], found));
    }
    return { ok: true, relocations: relocations };
  }

  function contextFromCalendar(providerId, dateKey, locationId) {
    var cache = window.ffBookingCalBlocks;
    var store = window.ffBookingCalAppointments;
    var engine = window.ffBookingAvailability;
    var loc = trim(locationId);
    var day = trim(dateKey);
    var id = trim(providerId);
    var blocks = cache && typeof cache.forProvider === "function"
      ? cache.forProvider(day, loc, id)
      : [];
    var appointments = [];
    if (store && typeof store.cardsForProvider === "function") {
      appointments = (store.cardsForProvider(day, loc, id) || []).map(function (card) {
        return {
          appointmentId: card.appointmentId,
          startMin: card.startMin,
          endMin: card.endMin
        };
      });
    }
    var workingIntervals = [];
    if (engine && typeof engine.getEffectiveProviderAvailability === "function") {
      var hours = engine.getEffectiveProviderAvailability(id, day, loc);
      workingIntervals = (hours && hours.intervals) || [];
    }
    return {
      blocks: blocks,
      appointments: appointments,
      workingIntervals: workingIntervals
    };
  }

  function tryFitFromCalendar(spec) {
    return tryFitAppointment(spec, contextFromCalendar(
      spec && spec.providerId,
      spec && spec.dateKey,
      spec && spec.locationId
    ));
  }

  window.ffBookingFlexRelocate = {
    SNAP: SNAP,
    isFlexible: isFlexible,
    classifyBlock: classifyBlock,
    requiredDuration: requiredDuration,
    windowOf: windowOf,
    preferredStart: preferredStart,
    overlaps: overlaps,
    findRelocation: findRelocation,
    proposalFrom: proposalFrom,
    tryFitAppointment: tryFitAppointment,
    tryFitFromCalendar: tryFitFromCalendar,
    contextFromCalendar: contextFromCalendar
  };
})();
