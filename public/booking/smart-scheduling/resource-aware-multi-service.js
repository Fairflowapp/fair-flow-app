/**
 * Smart Scheduling Phase 13 — physical resource constraints.
 *
 * Recommendation-only. Named resource units are hard feasibility
 * constraints during visit search, not a post-filter of Phase 12 winners.
 * Requests with no resourceRequirements reuse Phase 12 results.
 *
 * Resource overlap: any overlapMinutes > 0 is a conflict.
 * No allowedOverlapMinutes for physical resources.
 * Resource choice does not enter the visit score.
 */
(function () {
  var RESERVATION_PREFIX = "__smart_resource__";
  var DEFAULT_MAX_LINES = 4;
  var DEFAULT_MAX_PARALLEL = 3;
  var DEFAULT_MAX_PROVIDERS = 5;
  var DEFAULT_MAX_RESOURCES = 5;
  var DEFAULT_MAX_REQUIREMENTS = 2;
  var DEFAULT_MAX_STARTS = 40;
  var DEFAULT_MAX_BLOCK = 150;
  var DEFAULT_MAX_EVALUATED = 5000;
  var DEFAULT_MAX_RETURNED = 10;
  var DEFAULT_SNAP = 15;

  function ns() {
    return window.ffBookingSmartScheduling || (window.ffBookingSmartScheduling = {});
  }

  function p12() {
    return ns().PHASE12_INTERNALS || {};
  }

  function helpers() {
    return ns().helpers || {};
  }

  function trimText(value) {
    var h = helpers();
    return h.trimText ? h.trimText(value) : String(value == null ? "" : value).trim();
  }

  function optionInt(opts, key, fallback) {
    if (p12().optionInt) return p12().optionInt(opts, key, fallback);
    if (!opts || opts[key] == null || opts[key] === "") return fallback;
    var n = Math.round(Number(opts[key]));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function overlapMinutes(a0, a1, b0, b1) {
    var h = helpers();
    if (h.overlapMinutes) return h.overlapMinutes(a0, a1, b0, b1);
    var n = Math.min(a1, b1) - Math.max(a0, b0);
    return n > 0 ? n : 0;
  }

  function parseLines(request) {
    var lines = typeof p12().parseLines === "function" ? p12().parseLines(request) : [];
    var raw = request && Array.isArray(request.serviceLines) ? request.serviceLines : [];
    return lines.map(function (line, idx) {
      var reqs = (raw[idx] && Array.isArray(raw[idx].resourceRequirements))
        ? raw[idx].resourceRequirements
        : [];
      return Object.assign({}, line, {
        resourceRequirements: reqs.map(function (row) {
          var before = row && row.bufferBeforeMinutes;
          var after = row && row.bufferAfterMinutes;
          return {
            requirementKey: trimText(row && row.requirementKey),
            eligibleResourceIds: (row && Array.isArray(row.eligibleResourceIds) ? row.eligibleResourceIds : []).map(trimText).filter(Boolean),
            specificResourceId: trimText(row && row.specificResourceId),
            bufferBeforeMinutes: before == null || before === "" ? 0 : Math.round(Number(before)),
            bufferAfterMinutes: after == null || after === "" ? 0 : Math.round(Number(after))
          };
        })
      });
    });
  }

  function hasResourceRequirements(lines) {
    return (lines || []).some(function (line) {
      return (line.resourceRequirements || []).length > 0;
    });
  }

  function intervalOk(row) {
    var start = Number(row && (row.startMin != null ? row.startMin : row.start));
    var end = Number(row && (row.endMin != null ? row.endMin : row.end));
    return Number.isFinite(start) && Number.isFinite(end) && end > start
      ? { startMin: Math.round(start), endMin: Math.round(end) }
      : null;
  }

  function mergeBusy(list) {
    var sorted = (list || []).slice().sort(function (a, b) {
      return a.startMin - b.startMin || a.endMin - b.endMin;
    });
    var out = [];
    sorted.forEach(function (item) {
      var last = out[out.length - 1];
      if (!last || item.startMin > last.endMin) {
        out.push({ startMin: item.startMin, endMin: item.endMin });
        return;
      }
      if (item.endMin > last.endMin) last.endMin = item.endMin;
    });
    return out;
  }

  function parseResourceDays(rawList) {
    var list = Array.isArray(rawList) ? rawList : [];
    var out = [];
    var seen = {};
    var i;
    for (i = 0; i < list.length; i += 1) {
      var raw = list[i] || {};
      var resourceId = trimText(raw.resourceId);
      if (!resourceId) return { error: "blank_resource_id" };
      if (seen[resourceId]) return { error: "duplicate_resource_id" };
      seen[resourceId] = true;
      var working = [];
      var w;
      for (w = 0; w < (Array.isArray(raw.workingIntervals) ? raw.workingIntervals : []).length; w += 1) {
        var win = intervalOk(raw.workingIntervals[w]);
        if (!win) return { error: "malformed_resource_working_interval" };
        working.push(win);
      }
      working.sort(function (a, b) { return a.startMin - b.startMin || a.endMin - b.endMin; });
      var occupied = [];
      var o;
      for (o = 0; o < (Array.isArray(raw.occupied) ? raw.occupied : []).length; o += 1) {
        var occ = intervalOk(raw.occupied[o]);
        if (!occ) return { error: "malformed_resource_occupied_interval" };
        occupied.push({
          occupancyId: trimText(raw.occupied[o] && raw.occupied[o].occupancyId),
          startMin: occ.startMin,
          endMin: occ.endMin
        });
      }
      out.push({
        resourceId: resourceId,
        resourceType: trimText(raw.resourceType),
        locationId: trimText(raw.locationId),
        dateKey: trimText(raw.dateKey),
        workingIntervals: working,
        occupied: occupied,
        busy: mergeBusy(occupied)
      });
    }
    return { days: out };
  }

  function validateResources(resourceDays, providerDays) {
    if (!resourceDays.length) return "";
    var locationId = trimText(providerDays[0] && providerDays[0].locationId);
    var dateKey = trimText(providerDays[0] && providerDays[0].dateKey);
    var i;
    for (i = 0; i < resourceDays.length; i += 1) {
      var day = resourceDays[i];
      if (day.locationId !== locationId || day.dateKey !== dateKey) return "mixed_resource_location_or_date";
    }
    return "";
  }

  function validateRequirements(lines, resourceById, maxReqs) {
    var i;
    var j;
    for (i = 0; i < lines.length; i += 1) {
      var reqs = lines[i].resourceRequirements || [];
      if (reqs.length > maxReqs) return "too_many_resource_requirements_for_phase13";
      var seen = {};
      for (j = 0; j < reqs.length; j += 1) {
        var req = reqs[j];
        if (!req.requirementKey) return "blank_requirement_key";
        if (seen[req.requirementKey]) return "duplicate_requirement_key";
        seen[req.requirementKey] = true;
        if (!req.eligibleResourceIds.length) return "empty_eligible_resource_ids";
        if (!(req.bufferBeforeMinutes >= 0)) return "negative_buffer_before";
        if (!(req.bufferAfterMinutes >= 0)) return "negative_buffer_after";
        if (req.eligibleResourceIds.some(function (id) { return !resourceById[id]; })) {
          return "unknown_resource";
        }
        if (req.specificResourceId) {
          if (!resourceById[req.specificResourceId]) return "invalid_specific_resource";
          if (req.eligibleResourceIds.indexOf(req.specificResourceId) === -1) {
            return "invalid_specific_resource";
          }
        }
      }
    }
    return "";
  }

  function reservationWindow(serviceStart, duration, req) {
    return {
      startMin: serviceStart - (req.bufferBeforeMinutes || 0),
      endMin: serviceStart + duration + (req.bufferAfterMinutes || 0)
    };
  }

  function reservationId(lineKey, requirementKey, resourceId) {
    return [RESERVATION_PREFIX, lineKey, requirementKey, resourceId].join("|");
  }

  function copyResourceDay(day) {
    return {
      resourceId: day.resourceId,
      resourceType: day.resourceType,
      locationId: day.locationId,
      dateKey: day.dateKey,
      workingIntervals: (day.workingIntervals || []).map(function (row) {
        return { startMin: row.startMin, endMin: row.endMin };
      }),
      occupied: (day.occupied || []).map(function (row) {
        return { occupancyId: row.occupancyId, startMin: row.startMin, endMin: row.endMin };
      }),
      busy: (day.busy || []).map(function (row) {
        return { startMin: row.startMin, endMin: row.endMin };
      })
    };
  }

  function copyResourceMap(map) {
    var out = {};
    Object.keys(map).forEach(function (id) { out[id] = copyResourceDay(map[id]); });
    return out;
  }

  function fitsWorking(day, startMin, endMin) {
    return (day.workingIntervals || []).some(function (win) {
      return startMin >= win.startMin && endMin <= win.endMin;
    });
  }

  function overlapsBusy(day, startMin, endMin) {
    return (day.busy || []).some(function (row) {
      return overlapMinutes(startMin, endMin, row.startMin, row.endMin) > 0;
    });
  }

  function containingWorking(day, startMin, endMin) {
    var i;
    for (i = 0; i < (day.workingIntervals || []).length; i += 1) {
      var win = day.workingIntervals[i];
      if (startMin >= win.startMin && endMin <= win.endMin) return win;
    }
    return null;
  }

  function rankResourcesForRequirement(resourceById, req, startMin, endMin) {
    var ids = req.specificResourceId ? [req.specificResourceId] : req.eligibleResourceIds;
    var ranked = [];
    ids.forEach(function (id) {
      var day = resourceById[id];
      if (!day || !fitsWorking(day, startMin, endMin) || overlapsBusy(day, startMin, endMin)) return;
      var win = containingWorking(day, startMin, endMin);
      var busy = (day.busy || []).filter(function (row) {
        return row.endMin > win.startMin && row.startMin < win.endMin;
      }).sort(function (a, b) { return a.startMin - b.startMin; });
      var gapStart = win.startMin;
      var gapEnd = win.endMin;
      var b;
      for (b = 0; b < busy.length; b += 1) {
        if (busy[b].endMin <= startMin) gapStart = Math.max(gapStart, busy[b].endMin);
        if (busy[b].startMin >= endMin) {
          gapEnd = Math.min(gapEnd, busy[b].startMin);
          break;
        }
      }
      var before = startMin - gapStart;
      var after = gapEnd - endMin;
      ranked.push({
        resourceId: day.resourceId,
        resourceType: day.resourceType,
        frag: before > 0 && after > 0 ? 1 : 0,
        pack: (before === 0 ? 1 : 0) + (after === 0 ? 1 : 0)
      });
    });
    ranked.sort(function (a, b) {
      if (a.frag !== b.frag) return a.frag - b.frag;
      if (a.pack !== b.pack) return b.pack - a.pack;
      return String(a.resourceId).localeCompare(String(b.resourceId));
    });
    return ranked;
  }

  function insertReservation(day, lineKey, req, resourceId, startMin, endMin) {
    var next = copyResourceDay(day);
    next.occupied.push({
      occupancyId: reservationId(lineKey, req.requirementKey, resourceId),
      startMin: startMin,
      endMin: endMin
    });
    next.busy = mergeBusy(next.occupied);
    return next;
  }

  function windowsOverlap(a, b) {
    return overlapMinutes(a.startMin, a.endMin, b.startMin, b.endMin) > 0;
  }

  function flattenRequirements(block, blockStart) {
    var out = [];
    block.lines.forEach(function (line) {
      (line.resourceRequirements || []).forEach(function (req) {
        out.push({
          line: line,
          req: req,
          window: reservationWindow(blockStart, line.durationMinutes, req)
        });
      });
    });
    return out;
  }

  function enumerateResourceAssignments(block, resourceById, blockStart, maxPerReq, maxCombos) {
    var jobs = flattenRequirements(block, blockStart);
    var rankedJobs = jobs.map(function (job) {
      var ranked = rankResourcesForRequirement(resourceById, job.req, job.window.startMin, job.window.endMin);
      var cut = ranked.length > maxPerReq;
      return { job: job, ranked: ranked.slice(0, maxPerReq), cut: cut };
    });
    if (jobs.length && rankedJobs.some(function (row) { return row.ranked.length === 0; })) {
      return {
        combos: [],
        truncated: false,
        cut: rankedJobs.some(function (row) { return row.cut; }),
        rankedJobs: rankedJobs
      };
    }
    if (!jobs.length) return { combos: [[]], truncated: false, cut: false, rankedJobs: [] };

    var combos = [];
    var truncated = false;
    function dfs(index, used, lineUsed, picks) {
      if (combos.length >= maxCombos) {
        truncated = true;
        return;
      }
      if (index >= rankedJobs.length) {
        combos.push(picks);
        return;
      }
      var row = rankedJobs[index];
      var r;
      for (r = 0; r < row.ranked.length; r += 1) {
        if (truncated) return;
        var pick = row.ranked[r];
        var lineKey = row.job.line.lineKey;
        if (lineUsed[lineKey] && lineUsed[lineKey][pick.resourceId]) continue;
        var conflict = (used[pick.resourceId] || []).some(function (win) {
          return windowsOverlap(win, row.job.window);
        });
        if (conflict) continue;
        var nextUsed = Object.assign({}, used);
        nextUsed[pick.resourceId] = (used[pick.resourceId] || []).concat([row.job.window]);
        var nextLine = Object.assign({}, lineUsed);
        nextLine[lineKey] = Object.assign({}, lineUsed[lineKey] || {});
        nextLine[lineKey][pick.resourceId] = true;
        dfs(index + 1, nextUsed, nextLine, picks.concat([{
          lineKey: lineKey,
          req: row.job.req,
          resourceId: pick.resourceId,
          resourceType: pick.resourceType,
          window: row.job.window
        }]));
      }
    }
    dfs(0, {}, {}, []);
    return {
      combos: combos,
      truncated: truncated,
      cut: rankedJobs.some(function (row) { return row.cut; }),
      rankedJobs: rankedJobs
    };
  }

  function attachResources(plan, assignments) {
    if (!plan || plan.valid === false) return plan;
    var byLine = {};
    var units = {};
    var minutes = 0;
    var keyParts = [];
    (assignments || []).forEach(function (row) {
      var serviceStart = row.serviceStartMin;
      var item = {
        requirementKey: row.req.requirementKey,
        resourceId: row.resourceId,
        resourceType: row.resourceType,
        serviceStartMin: serviceStart,
        serviceEndMin: row.serviceEndMin,
        reservationStartMin: row.window.startMin,
        reservationEndMin: row.window.endMin,
        bufferBeforeMinutes: row.req.bufferBeforeMinutes,
        bufferAfterMinutes: row.req.bufferAfterMinutes
      };
      if (!byLine[row.lineKey]) byLine[row.lineKey] = [];
      byLine[row.lineKey].push(item);
      units[row.resourceId] = true;
      minutes += row.window.endMin - row.window.startMin;
      keyParts.push([row.lineKey, row.req.requirementKey, row.resourceId].join("|"));
    });
    var serviceLines = (plan.serviceLines || []).map(function (line) {
      return Object.assign({}, line, { resourceAssignments: byLine[line.lineKey] || [] });
    });
    return Object.assign({}, plan, {
      serviceLines: serviceLines,
      resourceAssignmentsByLine: byLine,
      resourceUnitCountUsed: Object.keys(units).length,
      resourceReservationMinutes: minutes,
      resourceAssignmentKey: keyParts.join("||"),
      resourceAwareVisitPlanScore: plan.parallelVisitPlanScore
    });
  }

  function compareResourceAware(a, b) {
    var compare = p12().compareParallelPlans;
    var core = compare ? compare(a, b) : 0;
    if (core) return core;
    return String(a && a.resourceAssignmentKey || "").localeCompare(String(b && b.resourceAssignmentKey || ""));
  }

  function emptyMetadata(lines, blocks, opts, extras) {
    return Object.assign({
      serviceLineCount: (lines || []).length,
      blockCount: (blocks || []).length,
      visitStartCandidateCount: 0,
      providerCandidatesByLine: (lines || []).map(function () { return 0; }),
      resourceCandidatesByRequirement: [],
      evaluatedBlockAssignments: 0,
      evaluatedVisitPlans: 0,
      maxServiceLines: optionInt(opts, "maxServiceLines", DEFAULT_MAX_LINES),
      maxParallelLinesPerBlock: optionInt(opts, "maxParallelLinesPerBlock", DEFAULT_MAX_PARALLEL),
      maxProvidersPerLine: optionInt(opts, "maxProvidersPerLine", DEFAULT_MAX_PROVIDERS),
      maxResourcesPerRequirement: optionInt(opts, "maxResourcesPerRequirement", DEFAULT_MAX_RESOURCES),
      maxResourceRequirementsPerLine: optionInt(opts, "maxResourceRequirementsPerLine", DEFAULT_MAX_REQUIREMENTS),
      maxVisitStartCandidates: optionInt(opts, "maxVisitStartCandidates", DEFAULT_MAX_STARTS),
      maxBlockAssignments: optionInt(opts, "maxBlockAssignments", DEFAULT_MAX_BLOCK),
      maxEvaluatedVisitPlans: optionInt(opts, "maxEvaluatedVisitPlans", DEFAULT_MAX_EVALUATED),
      truncated: false,
      exhaustive: false
    }, extras || {});
  }

  function invalidPlan(reason, days, lines, blocks, opts) {
    var first = days && days[0];
    return {
      valid: false,
      reason: reason,
      dateKey: trimText(first && first.dateKey),
      locationId: trimText(first && first.locationId),
      blocks: [],
      serviceLines: [],
      resourceAwareVisitPlanScore: 0,
      reasons: [],
      searchMetadata: emptyMetadata(lines || [], blocks || [], opts)
    };
  }

  function wrapPhase12Plans(plans, lines, blocks, opts) {
    return (plans || []).map(function (plan) {
      if (!plan) return null;
      if (plan.valid === false) return invalidPlan(plan.reason || "invalid", [], lines, blocks, opts);
      var wrapped = attachResources(plan, []);
      var meta = plan.searchMetadata || {};
      wrapped.searchMetadata = emptyMetadata(lines, blocks, opts, {
        visitStartCandidateCount: meta.visitStartCandidateCount || 0,
        providerCandidatesByLine: meta.providerCandidatesByLine || lines.map(function () { return 0; }),
        evaluatedBlockAssignments: meta.evaluatedBlockAssignments || 0,
        evaluatedVisitPlans: meta.evaluatedVisitPlans || meta.evaluatedPlanCount || 0,
        truncated: !!meta.truncated,
        exhaustive: meta.exhaustive !== false && !meta.truncated
      });
      return wrapped;
    }).filter(Boolean);
  }

  function flattenChosenResources(chosen) {
    var out = [];
    (chosen || []).forEach(function (row) {
      (row.resources || []).forEach(function (res) {
        out.push({
          lineKey: row.line.lineKey,
          req: res.req,
          resourceId: res.resourceId,
          resourceType: res.resourceType,
          window: res.window,
          serviceStartMin: row.serviceStartMin,
          serviceEndMin: row.serviceStartMin + row.line.durationMinutes
        });
      });
    });
    return out;
  }

  function rankResourceAwareVisitPlans(providerDays, resourceDays, request, options) {
    var internals = p12();
    var opts = options && typeof options === "object" ? options : {};
    var req = request && typeof request === "object" ? request : {};
    var maxLines = optionInt(opts, "maxServiceLines", DEFAULT_MAX_LINES);
    var maxParallel = optionInt(opts, "maxParallelLinesPerBlock", DEFAULT_MAX_PARALLEL);
    var maxProviders = optionInt(opts, "maxProvidersPerLine", DEFAULT_MAX_PROVIDERS);
    var maxResources = optionInt(opts, "maxResourcesPerRequirement", DEFAULT_MAX_RESOURCES);
    var maxReqs = optionInt(opts, "maxResourceRequirementsPerLine", DEFAULT_MAX_REQUIREMENTS);
    var maxStarts = optionInt(opts, "maxVisitStartCandidates", DEFAULT_MAX_STARTS);
    var maxBlock = optionInt(opts, "maxBlockAssignments", DEFAULT_MAX_BLOCK);
    var maxEvaluated = optionInt(opts, "maxEvaluatedVisitPlans", DEFAULT_MAX_EVALUATED);
    var maxReturned = optionInt(opts, "maxReturnedPlans", DEFAULT_MAX_RETURNED);
    var snapMinutes = optionInt(opts, "snapMinutes", optionInt(req, "snapMinutes", DEFAULT_SNAP));
    var days = (Array.isArray(providerDays) ? providerDays : []).map(function (day) {
      return internals.asDay ? internals.asDay(day) : day;
    });
    var lines = parseLines(req);
    var blocks = internals.buildBlocks ? internals.buildBlocks(lines) : [];
    if (lines.length > maxLines) return [invalidPlan("too_many_service_lines_for_phase13", days, lines, blocks, opts)];
    var parsedRes = parseResourceDays(resourceDays);
    if (parsedRes.error) return [invalidPlan(parsedRes.error, days, lines, blocks, opts)];
    var resourceList = parsedRes.days || [];
    var resourceErr = validateResources(resourceList, days);
    if (resourceErr) return [invalidPlan(resourceErr, days, lines, blocks, opts)];
    var resourceById = {};
    resourceList.forEach(function (day) { resourceById[day.resourceId] = day; });
    var reqErr = validateRequirements(lines, resourceById, maxReqs);
    if (reqErr) return [invalidPlan(reqErr, days, lines, blocks, opts)];
    var providerErr = internals.validateRequest ? internals.validateRequest(days, lines, blocks, maxParallel) : "";
    if (providerErr) {
      return [invalidPlan(providerErr === "too_many_parallel_lines_for_phase12"
        ? "too_many_parallel_lines_for_phase13"
        : providerErr, days, lines, blocks, opts)];
    }

    if (!hasResourceRequirements(lines) && typeof ns().rankParallelMultiServiceVisitPlans === "function") {
      return wrapPhase12Plans(ns().rankParallelMultiServiceVisitPlans(providerDays, req, opts), lines, blocks, opts);
    }

    var daysById = {};
    days.forEach(function (day) { daysById[trimText(day.providerId)] = day; });
    var startInfo = internals.collectVisitStarts
      ? internals.collectVisitStarts(daysById, blocks[0], req, snapMinutes, maxStarts)
      : { allCount: 0, starts: [] };
    var evaluated = 0;
    var evaluatedBlocks = 0;
    var validPlans = [];
    var hitCap = false;
    var blockBoundHit = false;
    var providerBoundHit = false;
    var resourceBoundHit = false;
    var providerCandidatesByLine = lines.map(function () { return 0; });
    var resourceCandidates = [];
    var lineIndex = {};
    lines.forEach(function (line, idx) { lineIndex[line.lineKey] = idx; });

    function consider(chosen, visitStartMin, usedAlternative) {
      if (evaluated >= maxEvaluated) {
        hitCap = true;
        return;
      }
      evaluated += 1;
      var plan = internals.scoreCompleteVisit
        ? internals.scoreCompleteVisit(days, chosen, blocks, visitStartMin, req, opts, usedAlternative)
        : null;
      if (!plan) return;
      validPlans.push(attachResources(plan, flattenChosenResources(chosen)));
    }

    function search(blockIndex, visitStartMin, cursor, simulatedDays, simulatedRes, chosen, usedAlternative) {
      if (hitCap) return;
      if (blockIndex >= blocks.length) {
        consider(chosen, visitStartMin, usedAlternative);
        return;
      }
      var block = blocks[blockIndex];
      var providers = internals.enumerateBlockAssignments
        ? internals.enumerateBlockAssignments(block, simulatedDays, cursor, snapMinutes, maxProviders, maxBlock)
        : { combos: [], truncated: false, providerCut: false, rankedByLine: [] };
      if (providers.truncated) blockBoundHit = true;
      if (providers.providerCut) providerBoundHit = true;
      block.lines.forEach(function (line, idx) {
        var count = (providers.rankedByLine[idx] || []).length;
        var at = lineIndex[line.lineKey];
        if (count > providerCandidatesByLine[at]) providerCandidatesByLine[at] = count;
      });
      providers.combos.forEach(function (combo) {
        if (hitCap) return;
        var remaining = maxBlock - evaluatedBlocks;
        if (remaining <= 0) {
          blockBoundHit = true;
          return;
        }
        var resources = enumerateResourceAssignments(block, simulatedRes, cursor, maxResources, remaining);
        if (resources.truncated || resources.cut) resourceBoundHit = true;
        resources.rankedJobs.forEach(function (row) {
          resourceCandidates.push({
            lineKey: row.job.line.lineKey,
            requirementKey: row.job.req.requirementKey,
            count: row.ranked.length
          });
        });
        var alt = usedAlternative;
        combo.forEach(function (row, idx) {
          var ranked = providers.rankedByLine[idx] || [];
          if (ranked[0] && row.assignment.providerId !== ranked[0].providerId) alt = true;
        });
        resources.combos.forEach(function (resCombo) {
          if (hitCap) return;
          evaluatedBlocks += 1;
          var nextDays = internals.copyDaysMap ? internals.copyDaysMap(simulatedDays) : simulatedDays;
          var nextRes = copyResourceMap(simulatedRes);
          var ok = combo.every(function (row) {
            nextDays[row.assignment.providerId] = internals.insertVisitLine
              ? internals.insertVisitLine(nextDays[row.assignment.providerId], row.line, cursor)
              : nextDays[row.assignment.providerId];
            return true;
          });
          if (!ok) return;
          resCombo.forEach(function (res) {
            nextRes[res.resourceId] = insertReservation(
              nextRes[res.resourceId],
              res.lineKey,
              res.req,
              res.resourceId,
              res.window.startMin,
              res.window.endMin
            );
          });
          var chosenBlock = combo.map(function (row) {
            return Object.assign({}, row, {
              serviceStartMin: cursor,
              resources: resCombo.filter(function (res) { return res.lineKey === row.line.lineKey; })
            });
          });
          search(blockIndex + 1, visitStartMin, cursor + block.durationMinutes, nextDays, nextRes, chosen.concat(chosenBlock), alt);
        });
      });
    }

    startInfo.starts.forEach(function (startMin) {
      if (!hitCap) search(0, startMin, startMin, internals.copyDaysMap ? internals.copyDaysMap(daysById) : daysById, copyResourceMap(resourceById), [], false);
    });

    var truncated = hitCap || blockBoundHit || providerBoundHit || resourceBoundHit || startInfo.allCount > startInfo.starts.length;
    validPlans.sort(compareResourceAware);
    var returned = validPlans.slice(0, maxReturned);
    var metadata = emptyMetadata(lines, blocks, opts, {
      visitStartCandidateCount: startInfo.starts.length,
      providerCandidatesByLine: providerCandidatesByLine,
      resourceCandidatesByRequirement: resourceCandidates,
      evaluatedBlockAssignments: evaluatedBlocks,
      evaluatedVisitPlans: evaluated,
      truncated: truncated,
      exhaustive: !truncated
    });
    returned.forEach(function (plan) { plan.searchMetadata = metadata; });
    return returned;
  }

  function recommendResourceAwareVisit(providerDays, resourceDays, request, options) {
    var ranked = rankResourceAwareVisitPlans(providerDays, resourceDays, request, options);
    if (!ranked.length) return null;
    if (ranked[0] && ranked[0].valid === false) return ranked[0];
    return ranked[0] || null;
  }

  var api = ns();
  api.rankResourceAwareVisitPlans = rankResourceAwareVisitPlans;
  api.recommendResourceAwareVisit = recommendResourceAwareVisit;
  api.compareResourceAwareVisitPlans = compareResourceAware;
  api.RESOURCE_AWARE = {
    RESERVATION_PREFIX: RESERVATION_PREFIX,
    DEFAULT_MAX_SERVICE_LINES: DEFAULT_MAX_LINES,
    DEFAULT_MAX_PARALLEL_LINES_PER_BLOCK: DEFAULT_MAX_PARALLEL,
    DEFAULT_MAX_PROVIDERS_PER_LINE: DEFAULT_MAX_PROVIDERS,
    DEFAULT_MAX_RESOURCES_PER_REQUIREMENT: DEFAULT_MAX_RESOURCES,
    DEFAULT_MAX_RESOURCE_REQUIREMENTS_PER_LINE: DEFAULT_MAX_REQUIREMENTS,
    DEFAULT_MAX_VISIT_START_CANDIDATES: DEFAULT_MAX_STARTS,
    DEFAULT_MAX_BLOCK_ASSIGNMENTS: DEFAULT_MAX_BLOCK,
    DEFAULT_MAX_EVALUATED_VISIT_PLANS: DEFAULT_MAX_EVALUATED,
    DEFAULT_MAX_RETURNED_PLANS: DEFAULT_MAX_RETURNED
  };
})();
