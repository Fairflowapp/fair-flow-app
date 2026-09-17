/**
 * Smart Scheduling — Flexible Time Blocks as movable constraints.
 * Does not rewrite rankSlots unless the day includes timeBlocks.
 */
(function () {
  function ns() {
    return window.ffBookingSmartScheduling || (window.ffBookingSmartScheduling = {});
  }

  function flex() {
    return window.ffBookingFlexRelocate || null;
  }

  function classifyTimeBlock(block) {
    var api = flex();
    if (api && typeof api.classifyBlock === "function") return api.classifyBlock(block);
    return block && String(block.flexibilityMode || "").toLowerCase() === "flexible"
      ? "movable"
      : "hard";
  }

  function occupiedFrom(day) {
    return (day && Array.isArray(day.occupied) ? day.occupied : []).slice();
  }

  function hardOccupied(day) {
    var occupied = occupiedFrom(day);
    (day && day.timeBlocks || []).forEach(function (block) {
      if (!block || classifyTimeBlock(block) === "movable") return;
      occupied.push({
        lineId: block.blockId || ("fixed-" + block.startMin),
        startMin: block.startMin,
        endMin: block.endMin,
        kind: "fixed-block"
      });
    });
    return occupied;
  }

  function flexibleBlocks(day) {
    return (day && day.timeBlocks || []).filter(function (block) {
      return classifyTimeBlock(block) === "movable";
    });
  }

  function proposeRelocation(block, appointment, context) {
    var api = flex();
    if (!api || typeof api.findRelocation !== "function") return { ok: false, reason: "unavailable" };
    return api.findRelocation(block, appointment, context);
  }

  function relocationProposal(block, found) {
    var api = flex();
    if (api && typeof api.proposalFrom === "function") return api.proposalFrom(block, found);
    if (!found || !found.ok) return null;
    return {
      blockId: block.blockId,
      seriesId: block.seriesId || "",
      occurrenceDateKey: block.occurrenceDateKey || block.dateKey || "",
      fromStartMin: found.fromStartMin != null ? found.fromStartMin : block.startMin,
      fromEndMin: found.fromEndMin != null ? found.fromEndMin : block.endMin,
      toStartMin: found.startMin,
      toEndMin: found.endMin,
      preferredStartMin: found.preferredStartMin,
      durationMinutes: found.durationMinutes,
      moved: !!found.moved
    };
  }

  function contextFor(day, extraOccupied) {
    return {
      appointments: extraOccupied || occupiedFrom(day),
      blocks: (day && day.timeBlocks) || [],
      workingIntervals: (day && day.workingIntervals) || []
    };
  }

  function scoreRelocation(found) {
    if (!found || !found.ok) return -Infinity;
    if (!found.moved) return 300;
    var dist = Math.abs(Number(found.startMin) - Number(found.preferredStartMin || found.startMin));
    return 180 - dist;
  }

  function describeFlexibleSlot(day, request, startMin, durationMinutes) {
    var api = ns();
    var endMin = startMin + durationMinutes;
    var incoming = { startMin: startMin, endMin: endMin, durationMinutes: durationMinutes };
    var hardDay = Object.assign({}, day, { occupied: hardOccupied(day) });
    var describe = api.describePlacement;
    var base = typeof describe === "function" ? describe(hardDay, startMin, endMin) : {
      startMin: startMin,
      endMin: endMin,
      durationMinutes: durationMinutes
    };
    if (!base) return null;
    var relocations = [];
    var scoreBoost = 0;
    var i;
    var blocks = flexibleBlocks(day);
    var ctx = contextFor(day, (hardDay.occupied || []).concat([incoming]));
    for (i = 0; i < blocks.length; i += 1) {
      var block = blocks[i];
      var found = proposeRelocation(block, incoming, ctx);
      if (!found || !found.ok) return null;
      scoreBoost += scoreRelocation(found);
      if (found.moved) {
        var proposal = relocationProposal(block, found);
        if (proposal) relocations.push(proposal);
      }
    }
    base.flexibleRelocations = relocations;
    base.flexibleScoreBoost = scoreBoost;
    base.keepsPreferredBreak = relocations.length === 0;
    return base;
  }

  function enumerateValidSlotsWithFlexibleBlocks(day, request) {
    var durationMinutes = Number(request && request.durationMinutes);
    if (!(durationMinutes > 0)) return [];
    var snap = Number(request && request.snapMinutes) > 0 ? Number(request.snapMinutes) : 15;
    var allowed = day && day.allowedOverlapMinutes != null ? day.allowedOverlapMinutes : 0;
    var occupied = hardOccupied(day);
    var helpers = ns().helpers || {};
    var isConflict = helpers.isConflictMinutes;
    var intervals = day && Array.isArray(day.workingIntervals) ? day.workingIntervals : [];
    var slots = [];
    intervals.forEach(function (win) {
      if (!win || !(win.endMin > win.startMin)) return;
      var startMin = Math.ceil(Number(win.startMin) / snap) * snap;
      if (startMin < win.startMin) startMin += snap;
      while (startMin + durationMinutes <= win.endMin) {
        var endMin = startMin + durationMinutes;
        var blocked = (occupied || []).some(function (row) {
          if (typeof isConflict === "function") {
            return isConflict(startMin, endMin, row.startMin, row.endMin, allowed);
          }
          return startMin < row.endMin && endMin > row.startMin;
        });
        if (!blocked) {
          var extra = describeFlexibleSlot(day, request, startMin, durationMinutes);
          if (extra) slots.push(extra);
        }
        startMin += snap;
      }
    });
    return slots;
  }

  function rankSlotsWithFlexibleBlocks(day, request) {
    var api = ns();
    var slots = enumerateValidSlotsWithFlexibleBlocks(day, request);
    return slots.map(function (slot) {
      var scored = typeof api.scoreSlot === "function" ? api.scoreSlot(day, slot, request) : slot;
      var boost = Number(slot.flexibleScoreBoost) || (slot.keepsPreferredBreak ? 40 : 0);
      scored.score = (Number(scored.score) || 0) + boost;
      scored.flexibleRelocations = slot.flexibleRelocations || [];
      scored.keepsPreferredBreak = !!slot.keepsPreferredBreak;
      return scored;
    }).sort(api.compareScoredSlots || function (a, b) {
      return (b.score || 0) - (a.score || 0);
    });
  }

  var api = ns();
  var originalRank = api.rankSlots;
  api.classifyTimeBlock = classifyTimeBlock;
  api.proposeFlexibleTimeBlockRelocation = proposeRelocation;
  api.enumerateValidSlotsWithFlexibleBlocks = enumerateValidSlotsWithFlexibleBlocks;
  api.rankSlotsWithFlexibleBlocks = rankSlotsWithFlexibleBlocks;
  if (typeof originalRank === "function") {
    api.rankSlots = function (day, request) {
      if (day && Array.isArray(day.timeBlocks) && day.timeBlocks.length) {
        return rankSlotsWithFlexibleBlocks(day, request);
      }
      return originalRank(day, request);
    };
  }
})();
