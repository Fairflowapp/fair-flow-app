/**
 * Booking Combo appointment scheduling (Phase 2).
 *
 * A Combo is sold as ONE catalog item with ONE selling price, then expanded
 * into component serviceLines inside ONE appointment/visit. Components may
 * split BETWEEN providers. A single component stays atomic to one provider.
 *
 * Phase 1 catalog fields (unchanged): serviceType, components[], allocatedPrice.
 *
 * ---------------------------------------------------------------------------
 * Appointment serviceLine Combo schema (additive, omitted on Singles)
 * ---------------------------------------------------------------------------
 * Existing line fields stay the source of truth:
 *   lineId, serviceId, serviceNameSnapshot, providerId, providerNameSnapshot,
 *   startAt, endAt, durationMinutes, priceSnapshot, guestKey, guestName, requested
 *
 * Combo grouping (present only on expanded component lines):
 *   comboInstanceId              one id per expanded Combo in this appointment
 *   comboServiceId               parent Combo catalog id (snapshot, not live)
 *   comboNameSnapshot            sold Combo name
 *   comboSellingPriceSnapshot    sold Combo price (do not charge per component)
 *   comboComponentIndex          0-based sortOrder at booking time
 *   comboComponentCount          number of components in that instance
 *
 * serviceId / serviceNameSnapshot / durationMinutes are the UNDERLYING Single.
 * priceSnapshot is the Combo allocatedPrice for that component (not standalone).
 *
 * Historical appointments without these fields load exactly as before.
 * Booked Combos keep snapshots; catalog edits do not mutate them.
 *
 * ---------------------------------------------------------------------------
 * Add-on / French foundation (Phase 3 — do not build the product here)
 * ---------------------------------------------------------------------------
 * An add-on must belong to a specific serviceLine, never ambiguously to the
 * whole Combo, once the target component is known.
 *
 *   lineKind: "service" | "addon"   (omit / "service" on normal lines)
 *   addonTargetLineId               lineId of the component this add-on belongs to
 *   addonOfComboInstanceId          optional denormalized comboInstanceId
 *
 * Example: Gel Mani + Regular Pedi Combo + French on the manicure
 *   French line.addonTargetLineId = gel component lineId
 *   French line.comboInstanceId may match the parent Combo for grouping
 * Do not set addonTargetLineId to the Combo catalog id.
 *
 * ---------------------------------------------------------------------------
 * Smart Scheduling Phase 3 — what this structure already provides
 * ---------------------------------------------------------------------------
 * Each Combo component is already an independent serviceLine with:
 *   serviceId, providerId, durationMinutes, start/end, requested,
 *   comboInstanceId, comboComponentIndex, comboComponentCount
 *
 * Phase 3 can evaluate without rewriting this model:
 *   - per-component provider availability (capability = underlying service)
 *   - sequential placement: index order, start(i+1) = end(i)
 *   - parallel placement: same or overlapping start, different providerIds
 *   - gap optimization: idle between components of the same comboInstanceId
 *   - atomicity: never split one lineId / comboComponentIndex across providers
 *   - visit window: min(start) / max(end) of the instance (already appointment)
 *
 * Do not treat comboSellingPriceSnapshot as a bookable duration or extra line.
 *
 * ---------------------------------------------------------------------------
 * Checkout — REQUIRED future behavior (not optional)
 * ---------------------------------------------------------------------------
 * The client still buys ONE Combo at comboSellingPriceSnapshot.
 * Component priceSnapshot values are allocated amounts for provider
 * attribution, commissions, and reporting. They must sum to the Combo price.
 *
 * A later checkout phase MUST group a Combo into ONE customer-facing item
 * at the Combo selling price. Do not charge each component as its own
 * full-price product. Do not show two independent catalog prices.
 * Phase 2 does not redesign checkout; it only makes that grouping possible
 * and required.
 */
(function () {
  var COMBO_FIELDS = [
    "comboInstanceId",
    "comboServiceId",
    "comboNameSnapshot",
    "comboSellingPriceSnapshot",
    "comboComponentIndex",
    "comboComponentCount"
  ];
  var ADDON_FIELDS = [
    "lineKind",
    "addonTargetLineId",
    "addonOfComboInstanceId"
  ];

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function collapseSpaces(value) {
    return trim(value).replace(/\s+/g, " ");
  }

  function moneyToCents(value) {
    var catalog = window.ffCatalogCombo;
    if (catalog && typeof catalog.moneyToCents === "function") return catalog.moneyToCents(value);
    var n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100);
  }

  function isComboService(service) {
    var catalog = window.ffCatalogCombo;
    if (catalog && typeof catalog.isComboService === "function") return catalog.isComboService(service);
    var raw = service && typeof service === "object" ? service : {};
    var type = trim(raw.serviceType || (raw.raw && raw.raw.serviceType)).toLowerCase();
    if (type === "combo") return true;
    var components = raw.components || (raw.raw && raw.raw.components);
    return Array.isArray(components) && components.length >= 2 && type !== "single";
  }

  function comboInstanceIdOf(line) {
    return trim(line && line.comboInstanceId);
  }

  function isComboLine(line) {
    return !!comboInstanceIdOf(line);
  }

  function makeComboInstanceId() {
    return "combo_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function copyNamedFields(target, source, names) {
    var out = target && typeof target === "object" ? target : {};
    var src = source && typeof source === "object" ? source : {};
    names.forEach(function (key) {
      if (src[key] != null && src[key] !== "") out[key] = src[key];
    });
    return out;
  }

  function readComboFields(source) {
    var src = source && typeof source === "object" ? source : {};
    if (!trim(src.comboInstanceId)) return null;
    return {
      comboInstanceId: trim(src.comboInstanceId),
      comboServiceId: trim(src.comboServiceId),
      comboNameSnapshot: collapseSpaces(src.comboNameSnapshot),
      comboSellingPriceSnapshot: Number(src.comboSellingPriceSnapshot) || 0,
      comboComponentIndex: Number.isInteger(Number(src.comboComponentIndex))
        ? Number(src.comboComponentIndex)
        : 0,
      comboComponentCount: Number(src.comboComponentCount) > 0 ? Number(src.comboComponentCount) : 0
    };
  }

  function readAddonFields(source) {
    var src = source && typeof source === "object" ? source : {};
    var targetId = trim(src.addonTargetLineId);
    var kind = trim(src.lineKind).toLowerCase();
    if (!targetId && kind !== "addon") return null;
    return {
      lineKind: kind || "addon",
      addonTargetLineId: targetId,
      addonOfComboInstanceId: trim(src.addonOfComboInstanceId)
    };
  }

  function applyComboFields(target, source) {
    var combo = readComboFields(source);
    var addon = readAddonFields(source);
    if (combo) {
      Object.keys(combo).forEach(function (key) { target[key] = combo[key]; });
    }
    if (addon) {
      Object.keys(addon).forEach(function (key) { target[key] = addon[key]; });
    }
    return target;
  }

  function mergeComboFields(prev, next) {
    var current = prev && typeof prev === "object" ? prev : {};
    var incoming = next && typeof next === "object" ? next : {};
    var incomingCombo = readComboFields(incoming);
    var keepPrev = readComboFields(current);
    if (incomingCombo) return incomingCombo;
    if (Object.prototype.hasOwnProperty.call(incoming, "comboInstanceId") && !trim(incoming.comboInstanceId)) {
      return null;
    }
    return keepPrev;
  }

  function comboComponentsOf(service) {
    var catalog = window.ffCatalogCombo;
    var raw = service && (service.raw || service) || {};
    var list = raw.components || service && service.components;
    if (catalog && typeof catalog.normalizeComboComponents === "function") {
      return catalog.normalizeComboComponents(list);
    }
    return (Array.isArray(list) ? list : []).map(function (row, index) {
      var item = row && typeof row === "object" ? row : {};
      return {
        serviceId: trim(item.serviceId),
        allocatedPrice: Number(item.allocatedPrice) || 0,
        sortOrder: Number.isInteger(Number(item.sortOrder)) ? Number(item.sortOrder) : index
      };
    }).filter(function (row) { return !!row.serviceId; }).sort(function (a, b) {
      return a.sortOrder - b.sortOrder;
    });
  }

  function findCatalogService(catalog, serviceId) {
    var id = trim(serviceId);
    if (!id) return null;
    return (catalog || []).find(function (row) { return row && trim(row.id) === id; }) || null;
  }

  function isProviderEligible(service, providerId) {
    var id = trim(providerId);
    if (!id) return false;
    var row = service && (service.raw || service) || {};
    var svc = window.ffBookingAppointmentServices;
    if (svc && typeof svc.isCapable === "function") return svc.isCapable(row, id);
    var model = window.ffBookingAppointmentModel;
    if (model && typeof model.isProviderCapable === "function") return model.isProviderCapable(row, id);
    return true;
  }

  function componentDuration(service, providerId) {
    var svc = window.ffBookingAppointmentServices;
    var row = service && (service.raw || service) || service;
    if (svc && typeof svc.effectiveDuration === "function" && row) {
      return svc.effectiveDuration(row, providerId);
    }
    var model = window.ffBookingAppointmentModel;
    if (model && typeof model.resolveDurationMinutes === "function" && row) {
      return model.resolveDurationMinutes(row, providerId);
    }
    var n = Number(service && (service.durationMinutes || service.duration));
    return Number.isFinite(n) && n >= 1 ? Math.round(n) : 30;
  }

  function sellingPrice(service) {
    var row = service && (service.raw || service) || {};
    var n = Number(service && service.price != null ? service.price : row.defaultPrice);
    return Number.isFinite(n) ? n : 0;
  }

  function allocatedPricesReconcile(lines, selling) {
    var comboCents = moneyToCents(selling);
    if (comboCents == null) return false;
    var sum = (lines || []).reduce(function (total, line) {
      var cents = moneyToCents(line && (line.price != null ? line.price : line.priceSnapshot));
      return cents == null ? total : total + cents;
    }, 0);
    return sum === comboCents;
  }

  function appointmentServiceTotal(lines) {
    return (lines || []).reduce(function (sum, line) {
      var n = Number(line && (line.price != null ? line.price : line.priceSnapshot));
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
  }

  function comboSellingTotal(lines) {
    var seen = {};
    var total = 0;
    (lines || []).forEach(function (line) {
      if (!isComboLine(line)) {
        total += Number(line && (line.price != null ? line.price : line.priceSnapshot)) || 0;
        return;
      }
      var id = comboInstanceIdOf(line);
      if (seen[id]) return;
      seen[id] = true;
      total += Number(line.comboSellingPriceSnapshot) || 0;
    });
    return total;
  }

  function validateComboAtomicity(lines) {
    var byKey = {};
    for (var i = 0; i < (lines || []).length; i += 1) {
      var line = lines[i];
      if (!isComboLine(line)) continue;
      var key = comboInstanceIdOf(line) + ":" + String(Number(line.comboComponentIndex));
      if (byKey[key] && trim(byKey[key].providerId) && trim(line.providerId)
        && trim(byKey[key].providerId) !== trim(line.providerId)) {
        return {
          ok: false,
          code: "COMBO_COMPONENT_SPLIT",
          error: "A Combo component cannot be split between two providers."
        };
      }
      byKey[key] = line;
      if (trim(line.providerId) && line.service && !isProviderEligible(line.service, line.providerId)
        && line.capabilityMessage) {
        return {
          ok: false,
          code: "PROVIDER_INCAPABLE",
          error: line.capabilityMessage,
          line: line
        };
      }
    }
    return { ok: true };
  }

  function validateComboPrices(lines) {
    var groups = {};
    (lines || []).forEach(function (line) {
      if (!isComboLine(line)) return;
      var id = comboInstanceIdOf(line);
      if (!groups[id]) groups[id] = [];
      groups[id].push(line);
    });
    var ids = Object.keys(groups);
    for (var i = 0; i < ids.length; i += 1) {
      var rows = groups[ids[i]];
      var selling = Number(rows[0] && rows[0].comboSellingPriceSnapshot);
      if (!allocatedPricesReconcile(rows, selling)) {
        return {
          ok: false,
          code: "COMBO_PRICE_MISMATCH",
          error: "Allocated component prices must add up to the Combo selling price."
        };
      }
    }
    return { ok: true };
  }

  function scheduleSequential(lines, startMin) {
    var cursor = Number(startMin);
    (lines || []).forEach(function (line) {
      if (!Number.isFinite(cursor)) return;
      line.startMin = cursor;
      var duration = Number(line.durationMinutes) > 0 ? Number(line.durationMinutes) : 0;
      line.endMin = duration > 0 ? cursor + duration : 0;
      if (duration > 0) cursor += duration;
    });
    return lines;
  }

  function scheduleParallel(lines, startMin) {
    var start = Number(startMin);
    (lines || []).forEach(function (line) {
      if (!Number.isFinite(start)) return;
      line.startMin = start;
      var duration = Number(line.durationMinutes) > 0 ? Number(line.durationMinutes) : 0;
      line.endMin = duration > 0 ? start + duration : 0;
    });
    return lines;
  }

  function groupFormLines(lines) {
    var groups = [];
    var seen = {};
    (lines || []).forEach(function (line, index) {
      if (!isComboLine(line)) {
        groups.push({ kind: "single", lines: [line], index: index });
        return;
      }
      var id = comboInstanceIdOf(line);
      if (seen[id]) {
        seen[id].lines.push(line);
        return;
      }
      var group = {
        kind: "combo",
        instanceId: id,
        lines: [line],
        index: index,
        comboServiceId: trim(line.comboServiceId),
        comboName: collapseSpaces(line.comboNameSnapshot) || "Combo",
        sellingPrice: Number(line.comboSellingPriceSnapshot) || 0
      };
      seen[id] = group;
      groups.push(group);
    });
    groups.forEach(function (group) {
      if (group.kind !== "combo") return;
      group.lines.sort(function (a, b) {
        return Number(a.comboComponentIndex) - Number(b.comboComponentIndex);
      });
    });
    return groups;
  }

  function pickerRowForComponent(componentService, allocatedPrice, duration) {
    var row = componentService && typeof componentService === "object" ? componentService : {};
    var raw = row.raw && typeof row.raw === "object" ? Object.assign({}, row.raw) : {};
    if (!raw.durationMinutes && duration) raw.durationMinutes = duration;
    raw.defaultPrice = allocatedPrice;
    return {
      id: trim(row.id),
      name: collapseSpaces(row.name) || "Service",
      durationMinutes: duration || Number(row.durationMinutes) || 30,
      price: allocatedPrice,
      category: row.category,
      categoryId: row.categoryId,
      staffOverrides: row.staffOverrides || raw.staffOverrides || {},
      serviceType: "single",
      components: [],
      raw: raw
    };
  }

  function buildExpandedLines(comboService, options) {
    var opts = options || {};
    var catalog = opts.catalog || [];
    var emptyLine = opts.emptyLine;
    var components = comboComponentsOf(comboService);
    if (components.length < 2 || typeof emptyLine !== "function") return [];
    var instanceId = trim(opts.comboInstanceId) || makeComboInstanceId();
    var selling = sellingPrice(comboService);
    var comboName = collapseSpaces(comboService && comboService.name) || "Combo";
    var comboId = trim(comboService && (comboService.id || comboService.serviceId));
    var startMin = Number(opts.startMin);
    var seedProvider = trim(opts.providerId);
    var built = components.map(function (comp, index) {
      var svc = findCatalogService(catalog, comp.serviceId) || { id: comp.serviceId, name: "Service" };
      var eligible = seedProvider ? isProviderEligible(svc, seedProvider) : false;
      var providerId = eligible ? seedProvider : "";
      var duration = componentDuration(svc, providerId);
      var allocated = Number(comp.allocatedPrice);
      if (!Number.isFinite(allocated)) allocated = 0;
      var line = emptyLine({
        providerId: providerId,
        serviceId: trim(comp.serviceId),
        startMin: startMin,
        guestKey: opts.guestKey,
        guestName: opts.guestName,
        requested: !!opts.requested,
        keepStoredSnapshots: true,
        originalServiceId: trim(comp.serviceId),
        originalServiceName: collapseSpaces(svc.name) || "Service",
        storedDurationMinutes: duration,
        storedPrice: allocated
      });
      line.service = pickerRowForComponent(svc, allocated, duration);
      line.services = opts.services || [];
      line.durationMinutes = duration;
      line.price = allocated;
      line.endMin = Number.isFinite(startMin) && duration > 0 ? startMin + duration : 0;
      line.capabilityMessage = seedProvider && !eligible
        ? "This provider is not available for this service."
        : "";
      applyComboFields(line, {
        comboInstanceId: instanceId,
        comboServiceId: comboId,
        comboNameSnapshot: comboName,
        comboSellingPriceSnapshot: selling,
        comboComponentIndex: index,
        comboComponentCount: components.length
      });
      return line;
    });
    if (opts.parallel) scheduleParallel(built, startMin);
    else scheduleSequential(built, startMin);
    return built;
  }

  function replaceLines(state, key, nextLines) {
    var id = trim(key);
    var current = (state && state.lines) || [];
    var index = current.findIndex(function (line) {
      return line && (line.key === id || line.lineId === id);
    });
    if (index < 0) return state;
    var removed = current[index];
    var dropIds = {};
    if (isComboLine(removed)) {
      current.forEach(function (line) {
        if (comboInstanceIdOf(line) === comboInstanceIdOf(removed)) {
          dropIds[line.key || line.lineId] = true;
        }
      });
    } else {
      dropIds[removed.key || removed.lineId] = true;
    }
    var head = [];
    var tail = [];
    var seenRemoved = false;
    current.forEach(function (line) {
      var lid = line && (line.key || line.lineId);
      if (dropIds[lid]) {
        seenRemoved = true;
        return;
      }
      if (!seenRemoved) head.push(line);
      else tail.push(line);
    });
    state.lines = head.concat(nextLines || []).concat(tail);
    return state;
  }

  function applySelectedService(state, line, serviceId, helpers) {
    var help = helpers || {};
    var findServiceRow = help.findServiceRow;
    var emptyLine = help.emptyLine;
    if (!line || typeof findServiceRow !== "function" || typeof emptyLine !== "function") return false;
    var picked = findServiceRow(state, line, serviceId);
    if (!picked) return false;
    if (isComboService(picked)) {
      var expanded = buildExpandedLines(picked, {
        catalog: (state && state.catalogServices) || [],
        emptyLine: emptyLine,
        startMin: line.startMin,
        providerId: line.providerId,
        guestKey: line.guestKey,
        guestName: line.guestName,
        requested: line.requested,
        services: line.services
      });
      if (expanded.length < 2) return false;
      replaceLines(state, line.key || line.lineId, expanded);
      return true;
    }
    if (isComboLine(line)) {
      var single = emptyLine({
        providerId: line.providerId,
        serviceId: trim(serviceId),
        startMin: line.startMin,
        guestKey: line.guestKey,
        guestName: line.guestName,
        requested: line.requested
      });
      single.service = picked;
      single.services = line.services;
      replaceLines(state, line.key || line.lineId, [single]);
      return true;
    }
    return false;
  }

  function removeComboOrLine(state, key, emptyLine) {
    var id = trim(key);
    var current = (state && state.lines) || [];
    var hit = current.find(function (line) {
      return line && (line.key === id || line.lineId === id);
    });
    if (!hit || !isComboLine(hit)) return false;
    var instanceId = comboInstanceIdOf(hit);
    var next = current.filter(function (line) {
      return !isComboLine(line) || comboInstanceIdOf(line) !== instanceId;
    });
    if (!next.length && typeof emptyLine === "function") {
      next = [emptyLine({
        startMin: hit.startMin,
        providerId: hit.providerId
      })];
    }
    state.lines = next;
    return true;
  }

  function filterProvidersForLine(line, providers) {
    var list = Array.isArray(providers) ? providers.slice() : [];
    if (!line || !line.service) return list;
    var eligible = list.filter(function (emp) {
      return emp && isProviderEligible(line.service, emp.id || emp.staffId);
    });
    var currentId = trim(line.providerId);
    if (currentId && !eligible.some(function (emp) { return trim(emp && emp.id) === currentId; })) {
      var current = list.find(function (emp) { return trim(emp && emp.id) === currentId; });
      if (current) eligible = [current].concat(eligible);
    }
    return eligible;
  }

  function keepComboServiceOnRefresh(line, catalog, listed) {
    if (!isComboLine(line) || !trim(line.serviceId)) return false;
    var found = (listed || []).find(function (row) { return row && row.id === line.serviceId; })
      || findCatalogService(catalog, line.serviceId)
      || line.service;
    if (found) {
      var allocated = line.storedPrice != null ? Number(line.storedPrice) : Number(line.price);
      if (!Number.isFinite(allocated)) allocated = Number(found.price) || 0;
      line.service = pickerRowForComponent(found, allocated, Number(line.durationMinutes) || componentDuration(found, line.providerId));
      if (!(listed || []).some(function (row) { return row && row.id === line.serviceId; })) {
        line.services = [line.service].concat(listed || []);
      } else {
        line.services = listed || line.services;
      }
    }
    if (line.providerId && line.service && !isProviderEligible(line.service, line.providerId)) {
      line.capabilityMessage = "This provider is not available for this service.";
    } else {
      line.capabilityMessage = "";
    }
    return true;
  }

  function decorateCalendarCard(card, segments) {
    var rows = Array.isArray(segments) && segments.length ? segments : (card && card.segments) || [];
    var comboNames = [];
    var instanceIds = [];
    rows.forEach(function (seg) {
      var name = collapseSpaces(seg && seg.comboName);
      var id = trim(seg && seg.comboInstanceId);
      if (name && comboNames.indexOf(name) === -1) comboNames.push(name);
      if (id && instanceIds.indexOf(id) === -1) instanceIds.push(id);
    });
    if (!card) return card;
    if (comboNames.length === 1) {
      card.comboName = comboNames[0];
      card.comboInstanceId = instanceIds[0] || "";
      card.isCombo = true;
    } else if (!comboNames.length) {
      card.comboName = "";
      card.comboInstanceId = "";
      card.isCombo = false;
    }
    return card;
  }

  function checkoutItemName(line) {
    var component = collapseSpaces(line && line.serviceNameSnapshot) || "Service";
    var comboName = collapseSpaces(line && line.comboNameSnapshot);
    if (!comboName) return component;
    return comboName + " — " + component;
  }

  function detailsGroups(appointment) {
    return groupFormLines(appointment && appointment.serviceLines);
  }

  window.ffBookingAppointmentCombo = {
    COMBO_FIELDS: COMBO_FIELDS.slice(),
    ADDON_FIELDS: ADDON_FIELDS.slice(),
    isComboService: isComboService,
    isComboLine: isComboLine,
    comboInstanceIdOf: comboInstanceIdOf,
    makeComboInstanceId: makeComboInstanceId,
    readComboFields: readComboFields,
    readAddonFields: readAddonFields,
    applyComboFields: applyComboFields,
    mergeComboFields: mergeComboFields,
    copyNamedFields: copyNamedFields,
    comboComponentsOf: comboComponentsOf,
    findCatalogService: findCatalogService,
    isProviderEligible: isProviderEligible,
    componentDuration: componentDuration,
    sellingPrice: sellingPrice,
    allocatedPricesReconcile: allocatedPricesReconcile,
    appointmentServiceTotal: appointmentServiceTotal,
    comboSellingTotal: comboSellingTotal,
    validateComboAtomicity: validateComboAtomicity,
    validateComboPrices: validateComboPrices,
    scheduleSequential: scheduleSequential,
    scheduleParallel: scheduleParallel,
    groupFormLines: groupFormLines,
    buildExpandedLines: buildExpandedLines,
    applySelectedService: applySelectedService,
    removeComboOrLine: removeComboOrLine,
    filterProvidersForLine: filterProvidersForLine,
    keepComboServiceOnRefresh: keepComboServiceOnRefresh,
    decorateCalendarCard: decorateCalendarCard,
    checkoutItemName: checkoutItemName,
    detailsGroups: detailsGroups
  };
})();
