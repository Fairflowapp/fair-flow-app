/**
 * New / Edit Appointment form state.
 * N independent service lines. Repository remains the authority for create/conflicts.
 */
(function () {
  var CODES = {
    APPOINTMENT_CONFLICT: "This provider already has an appointment during this time.",
    PROVIDER_NOT_WORKING: "This provider is not scheduled to work at this time.",
    OUTSIDE_BUSINESS_HOURS: "This appointment falls outside business hours.",
    PROVIDER_INCAPABLE: "This provider is not available for this service.",
    INVALID_CLIENT: "Please select a valid client.",
    INVALID_SERVICE: "Please select a valid service.",
    MISSING_LOCATION: "A location is required.",
    INVALID_LINE: "Please complete every service."
  };

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function money(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return "$0";
    return "$" + n.toFixed(n % 1 ? 2 : 0);
  }

  function makeLineKey() {
    return "k_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }

  function staffList() {
    try {
      if (typeof window.ffGetStaffStore === "function") {
        var store = window.ffGetStaffStore();
        if (store && Array.isArray(store.staff)) return store.staff;
      }
    } catch (_) {}
    return [];
  }

  function providerName(providerId) {
    var id = trim(providerId);
    var staff = staffList().find(function (row) {
      return row && (String(row.id || "") === id || String(row.staffId || "") === id);
    });
    if (!staff) return "This provider";
    var name = trim(staff.name || staff.displayName || staff.firstName);
    return name ? name.split(/\s+/)[0] : "This provider";
  }

  function friendlyError(code, providerId) {
    var first = providerName(providerId);
    if (code === "APPOINTMENT_CONFLICT") return first + " already has an appointment during this time.";
    if (code === "PROVIDER_NOT_WORKING") return first + " is not scheduled to work at this time.";
    if (code === "PROVIDER_INCAPABLE") return first + " is not available for this service.";
    return CODES[code] || "This appointment could not be created.";
  }

  function formatMinutes(total) {
    var m = ((Number(total) % 1440) + 1440) % 1440;
    var hour = Math.floor(m / 60);
    var min = m % 60;
    var suffix = hour >= 12 ? "PM" : "AM";
    var hour12 = hour % 12;
    if (hour12 === 0) hour12 = 12;
    return hour12 + ":" + String(min).padStart(2, "0") + " " + suffix;
  }

  // Same rules as tickets-service-duration.formatServiceDurationLabel.
  function formatDurationLabel(totalMinutes) {
    var n = Number(totalMinutes);
    if (!Number.isInteger(n) || n < 1) return "";
    var hours = Math.floor(n / 60);
    var minutes = n % 60;
    if (hours > 0 && minutes > 0) return hours + " hr " + minutes + " min";
    if (hours > 0) return hours + " hr";
    return minutes + " min";
  }

  function emptyLine(seed) {
    var storedPrice = seed && seed.storedPrice != null ? seed.storedPrice : seed && seed.price;
    return {
      key: trim(seed && seed.key) || makeLineKey(),
      lineId: trim(seed && seed.lineId),
      providerId: trim(seed && seed.providerId),
      serviceId: trim(seed && seed.serviceId),
      service: seed && seed.service || null,
      services: Array.isArray(seed && seed.services) ? seed.services : [],
      startMin: Number.isFinite(Number(seed && seed.startMin)) ? Number(seed.startMin) : NaN,
      durationMinutes: 0,
      endMin: 0,
      price: 0,
      capabilityMessage: trim(seed && seed.capabilityMessage),
      originalServiceId: trim(seed && (seed.originalServiceId || seed.serviceId)),
      originalServiceName: trim(seed && (seed.originalServiceName || seed.serviceName)),
      storedDurationMinutes: Number(seed && (seed.storedDurationMinutes != null ? seed.storedDurationMinutes : seed.durationMinutes)) || 0,
      storedPrice: Number.isFinite(Number(storedPrice)) ? Number(storedPrice) : null,
      keepStoredSnapshots: !!(seed && seed.keepStoredSnapshots)
    };
  }

  function syncHead(state) {
    var line = state && state.lines && state.lines[0];
    if (!state || !line) return state;
    state.providerId = line.providerId;
    state.serviceId = line.serviceId;
    state.service = line.service;
    state.services = line.services;
    state.startMin = line.startMin;
    state.durationMinutes = line.durationMinutes;
    state.endMin = line.endMin;
    state.price = line.price;
    state.capabilityMessage = line.capabilityMessage;
    state.lineId = line.lineId;
    return state;
  }

  function ensureLines(state) {
    if (!state) return state;
    if (!Array.isArray(state.lines) || !state.lines.length) {
      state.lines = [emptyLine(state)];
    }
    return state;
  }

  function findLine(state, key) {
    var id = trim(key);
    return ((state && state.lines) || []).find(function (line) {
      return line && (line.key === id || line.lineId === id);
    }) || null;
  }

  function deriveLine(line) {
    if (!line) return line;
    var duration = 0;
    var price = 0;
    if (line.service) {
      var svc = window.ffBookingAppointmentServices;
      duration = svc ? svc.effectiveDuration(line.service.raw || line.service, line.providerId) : Number(line.service.durationMinutes) || 0;
      price = svc ? svc.effectivePrice(line.service.raw || line.service) : Number(line.service.price) || 0;
    }
    if (line.keepStoredSnapshots && trim(line.serviceId) && trim(line.serviceId) === trim(line.originalServiceId)) {
      if (Number(line.storedDurationMinutes) > 0) duration = Number(line.storedDurationMinutes);
      if (line.storedPrice != null && Number.isFinite(Number(line.storedPrice))) price = Number(line.storedPrice);
    }
    line.durationMinutes = duration;
    line.price = price;
    line.endMin = Number.isFinite(line.startMin) && duration > 0 ? line.startMin + duration : 0;
    return line;
  }

  function derive(state) {
    if (!state) return state;
    if (Array.isArray(state.lines) && state.lines.length) {
      state.lines.forEach(deriveLine);
      return syncHead(state);
    }
    var duration = 0;
    var price = 0;
    if (state.service) {
      var svc = window.ffBookingAppointmentServices;
      duration = svc ? svc.effectiveDuration(state.service.raw || state.service, state.providerId) : Number(state.service.durationMinutes) || 0;
      price = svc ? svc.effectivePrice(state.service.raw || state.service) : Number(state.service.price) || 0;
    }
    if (state.keepStoredSnapshots && trim(state.serviceId) && trim(state.serviceId) === trim(state.originalServiceId)) {
      if (Number(state.storedDurationMinutes) > 0) duration = Number(state.storedDurationMinutes);
      if (state.storedPrice != null && Number.isFinite(Number(state.storedPrice))) price = Number(state.storedPrice);
    }
    state.durationMinutes = duration;
    state.price = price;
    state.endMin = Number.isFinite(state.startMin) && duration > 0 ? state.startMin + duration : 0;
    return state;
  }

  function emptyState(seed) {
    var state = {
      locationId: trim(seed && seed.locationId),
      dateKey: trim(seed && seed.dateKey),
      clientId: "",
      client: null,
      notes: "",
      lines: [emptyLine(seed)],
      error: "",
      errorLineKey: "",
      catalogServices: [],
      creating: false
    };
    return derive(state);
  }

  function lineComplete(line) {
    return !!(
      line
      && trim(line.providerId)
      && trim(line.serviceId)
      && Number.isFinite(Number(line.startMin))
      && Number(line.durationMinutes) > 0
    );
  }

  function isDirty(state) {
    if (!state) return false;
    if (state.clientId || state.client || trim(state.notes)) return true;
    return ((state.lines || []).some(function (line) {
      return !!(line && (line.serviceId || line.service));
    }));
  }

  function canCreate(state) {
    return !!(
      state
      && state.locationId
      && state.dateKey
      && state.clientId
      && state.lines
      && state.lines.length
      && state.lines.every(lineComplete)
    );
  }

  async function refreshLineServices(state, line) {
    var api = window.ffBookingAppointmentServices;
    line.services = api && line.providerId ? await api.listForProvider(line.providerId) : [];
    if (line.serviceId) {
      var next = line.services.find(function (row) { return row.id === line.serviceId; }) || null;
      if (!next) {
        line.serviceId = "";
        line.service = null;
        line.capabilityMessage = "This service is not available with this provider.";
      } else {
        line.service = next;
        line.capabilityMessage = "";
      }
    }
    deriveLine(line);
    return syncHead(state);
  }

  async function refreshCatalog(state) {
    var api = window.ffBookingAppointmentServices;
    if (!state) return state;
    try {
      state.catalogServices = api && typeof api.listAll === "function" ? await api.listAll() : [];
    } catch (_) {
      state.catalogServices = [];
    }
    return state;
  }

  function findServiceRow(state, line, serviceId) {
    var id = trim(serviceId);
    if (!id) return null;
    return (line && line.services || []).find(function (row) { return row.id === id; })
      || (state && state.catalogServices || []).find(function (row) { return row.id === id; })
      || null;
  }

  async function refreshServices(state) {
    ensureLines(state);
    await refreshCatalog(state);
    for (var i = 0; i < state.lines.length; i += 1) {
      await refreshLineServices(state, state.lines[i]);
    }
    return derive(state);
  }

  function setLineService(state, key, serviceId) {
    ensureLines(state);
    var line = findLine(state, key) || state.lines[0];
    if (!line) return derive(state);
    var id = trim(serviceId);
    line.serviceId = id;
    line.service = findServiceRow(state, line, id);
    line.capabilityMessage = "";
    if (line.service && line.providerId) {
      var svcApi = window.ffBookingAppointmentServices;
      if (svcApi && typeof svcApi.isCapable === "function" && !svcApi.isCapable(line.service.raw || line.service, line.providerId)) {
        line.capabilityMessage = "This provider is not available for this service.";
      }
    }
    state.error = "";
    state.errorLineKey = "";
    return derive(state);
  }

  async function setLineProvider(state, key, providerId) {
    ensureLines(state);
    var line = findLine(state, key) || state.lines[0];
    if (!line) return derive(state);
    line.providerId = trim(providerId);
    state.error = "";
    state.errorLineKey = "";
    await refreshLineServices(state, line);
    return derive(state);
  }

  function setLineStart(state, key, startMin) {
    ensureLines(state);
    var line = findLine(state, key) || state.lines[0];
    if (!line) return derive(state);
    line.startMin = Number(startMin);
    state.error = "";
    state.errorLineKey = "";
    return derive(state);
  }

  function setService(state, serviceId) {
    ensureLines(state);
    return setLineService(state, state.lines[0] && state.lines[0].key, serviceId);
  }

  async function setProvider(state, providerId) {
    ensureLines(state);
    return setLineProvider(state, state.lines[0] && state.lines[0].key, providerId);
  }

  function setStart(state, startMin) {
    ensureLines(state);
    return setLineStart(state, state.lines[0] && state.lines[0].key, startMin);
  }

  function setDate(state, dateKey) {
    state.dateKey = trim(dateKey);
    state.error = "";
    state.errorLineKey = "";
    return state;
  }

  function setClient(state, client) {
    state.client = client || null;
    state.clientId = client && client.clientId ? String(client.clientId) : "";
    state.error = "";
    return state;
  }

  function addLine(state) {
    ensureLines(state);
    var prev = state.lines[state.lines.length - 1];
    var startMin = prev && Number(prev.endMin) > 0
      ? Number(prev.endMin)
      : (prev && Number.isFinite(Number(prev.startMin)) ? Number(prev.startMin) : NaN);
    state.lines.push(emptyLine({ startMin: startMin }));
    state.error = "";
    state.errorLineKey = "";
    return derive(state);
  }

  function removeLine(state, key) {
    ensureLines(state);
    if (state.lines.length <= 1) return state;
    var id = trim(key);
    var next = state.lines.filter(function (line) {
      return line && line.key !== id && line.lineId !== id;
    });
    if (!next.length) return state;
    state.lines = next;
    state.error = "";
    state.errorLineKey = "";
    return derive(state);
  }

  function startAtDateForLine(state, line) {
    var model = window.ffBookingAppointmentModel;
    if (!model || typeof model.civilToDate !== "function" || !line) return null;
    return model.civilToDate(state.dateKey, line.startMin, state.locationId);
  }

  function startAtDate(state) {
    ensureLines(state);
    return startAtDateForLine(state, state.lines[0]);
  }

  function applyRepoError(state, result) {
    var providerId = result && result.providerId;
    state.errorLineKey = "";
    if (Number.isInteger(result && result.lineIndex) && state.lines && state.lines[result.lineIndex]) {
      state.errorLineKey = state.lines[result.lineIndex].key;
      providerId = providerId || state.lines[result.lineIndex].providerId;
    } else if (result && result.lineId && state.lines) {
      var hit = state.lines.find(function (line) { return line && line.lineId === result.lineId; });
      if (hit) {
        state.errorLineKey = hit.key;
        providerId = providerId || hit.providerId;
      }
    }
    state.error = friendlyError(result && result.code, providerId);
    if (!(result && result.code)) state.error = (result && result.error) || state.error;
    return state;
  }

  function linePayload(state, line) {
    var sameService = line.keepStoredSnapshots && trim(line.serviceId) === trim(line.originalServiceId);
    return {
      lineId: line.lineId,
      serviceId: line.serviceId,
      providerId: line.providerId,
      startAt: startAtDateForLine(state, line),
      durationMinutes: line.durationMinutes,
      priceSnapshot: line.price,
      serviceNameSnapshot: sameService ? line.originalServiceName : (line.service && line.service.name) || "",
      preservePriceSnapshot: sameService,
      preserveNameSnapshot: sameService
    };
  }

  async function create(state) {
    if (!canCreate(state)) {
      state.error = !state.clientId ? CODES.INVALID_CLIENT : CODES.INVALID_SERVICE;
      return { ok: false, error: state.error };
    }
    var repo = window.ffBookingAppointments;
    if (!repo) return { ok: false, error: "Appointments are not ready." };
    state.creating = true;
    state.error = "";
    state.errorLineKey = "";
    try {
      var result = await repo.createAppointment({
        clientId: state.clientId,
        locationId: state.locationId,
        source: "front_desk",
        assignmentType: "specific_provider",
        notes: state.notes,
        serviceLines: state.lines.map(function (line) { return linePayload(state, line); })
      });
      if (!result || !result.ok) {
        applyRepoError(state, result);
        return { ok: false, code: result && result.code, error: state.error, result: result };
      }
      return { ok: true, appointment: result.appointment };
    } catch (err) {
      state.error = err && err.message ? err.message : "This appointment could not be created.";
      return { ok: false, error: state.error };
    } finally {
      state.creating = false;
    }
  }

  function timeOptionsHtml(selected) {
    var value = Number(selected);
    var out = [];
    if (Number.isFinite(value) && value % 15 !== 0) {
      out.push('<option value="' + value + '" selected>' + formatMinutes(value) + "</option>");
    }
    for (var m = 6 * 60; m < 22 * 60; m += 15) {
      out.push(
        '<option value="' + m + '"' + (m === value ? " selected" : "") + ">" +
        formatMinutes(m) + "</option>"
      );
    }
    return out.join("");
  }

  function fingerprint(state) {
    return [
      trim(state && state.dateKey),
      trim(state && state.notes),
      ((state && state.lines) || []).map(function (line) {
        return [trim(line.lineId), trim(line.serviceId), trim(line.providerId), Number(line.startMin)].join("|");
      }).join(";")
    ].join("::");
  }

  function editStateFrom(seed) {
    var rows = Array.isArray(seed && seed.lines) && seed.lines.length ? seed.lines : [seed];
    var state = emptyState(seed);
    state.appointmentId = trim(seed && seed.appointmentId);
    state.clientId = trim(seed && seed.clientId);
    state.notes = seed && seed.notes != null ? String(seed.notes) : "";
    state.saving = false;
    state.keepStoredSnapshots = true;
    state.lines = rows.map(function (row) {
      var line = emptyLine({
        lineId: row && row.lineId,
        providerId: row && row.providerId,
        serviceId: row && row.serviceId,
        startMin: row && row.startMin,
        serviceName: row && (row.serviceName || row.originalServiceName),
        durationMinutes: row && row.durationMinutes,
        price: row && row.price,
        keepStoredSnapshots: true
      });
      if (line.serviceId) {
        line.service = {
          id: line.serviceId,
          name: line.originalServiceName || "Service",
          durationMinutes: line.storedDurationMinutes,
          price: line.storedPrice || 0,
          raw: {
            durationMinutes: line.storedDurationMinutes,
            defaultPrice: line.storedPrice || 0
          }
        };
      }
      return deriveLine(line);
    });
    derive(state);
    state.originalServiceId = state.serviceId;
    state.originalServiceName = state.lines[0] && state.lines[0].originalServiceName || "";
    state.storedDurationMinutes = state.durationMinutes;
    state.storedPrice = state.price;
    state.original = {
      dateKey: state.dateKey,
      notes: trim(state.notes),
      fingerprint: fingerprint(state)
    };
    return state;
  }

  function isEditDirty(state) {
    if (!state || !state.original) return false;
    return trim(state.dateKey) !== trim(state.original.dateKey)
      || trim(state.notes) !== trim(state.original.notes)
      || fingerprint(state) !== state.original.fingerprint;
  }

  function canSave(state) {
    return !!(
      state
      && isEditDirty(state)
      && state.appointmentId
      && state.locationId
      && state.dateKey
      && state.lines
      && state.lines.length
      && state.lines.every(lineComplete)
    );
  }

  function editPatch(state) {
    return {
      notes: state.notes,
      serviceLines: (state.lines || []).map(function (line) { return linePayload(state, line); })
    };
  }

  async function update(state) {
    if (!canSave(state)) {
      state.error = state && !(state.lines || []).every(lineComplete) ? CODES.INVALID_SERVICE : "No changes to save.";
      return { ok: false, error: state.error };
    }
    var repo = window.ffBookingAppointments;
    if (!repo || typeof repo.updateAppointment !== "function") {
      return { ok: false, error: "Appointments are not ready." };
    }
    state.saving = true;
    state.error = "";
    state.errorLineKey = "";
    try {
      var result = await repo.updateAppointment(state.appointmentId, editPatch(state));
      if (!result || !result.ok) {
        applyRepoError(state, result);
        if (!result || !result.code) state.error = (result && result.error) || "This time is no longer available.";
        return { ok: false, code: result && result.code, error: state.error, result: result };
      }
      return { ok: true, appointment: result.appointment };
    } catch (err) {
      state.error = err && err.message ? err.message : "This appointment could not be saved.";
      return { ok: false, error: state.error };
    } finally {
      state.saving = false;
    }
  }

  function holdSpec(state) {
    if (!state || !state.dateKey) return null;
    var clientName = state.client && state.client.displayName ? String(state.client.displayName) : "";
    var lines = (state.lines || []).filter(function (line) {
      return line && trim(line.providerId) && Number.isFinite(Number(line.startMin));
    }).map(function (line) {
      return {
        providerId: line.providerId,
        startMin: Number(line.startMin),
        durationMinutes: Number(line.durationMinutes) > 0 ? Number(line.durationMinutes) : 30,
        title: line.service && line.service.name ? String(line.service.name) : "",
        clientName: clientName
      };
    });
    if (!lines.length) return null;
    return { dateKey: state.dateKey, clientName: clientName, lines: lines };
  }

  function pickerServices(state, line) {
    if (line && trim(line.providerId) && (line.services || []).length) return line.services;
    return (state && state.catalogServices) || [];
  }

  function servicePickerHtml(state, line, options) {
    var query = trim(options && options.serviceQ).toLowerCase();
    var rows = pickerServices(state, line).filter(function (svc) {
      if (!svc || !svc.name) return false;
      if (!query) return true;
      return String(svc.name).toLowerCase().indexOf(query) !== -1
        || String(svc.category || "").toLowerCase().indexOf(query) !== -1;
    });
    var groups = [];
    var seen = {};
    rows.forEach(function (svc) {
      var cat = trim(svc.category) || "Services";
      if (!seen[cat]) {
        seen[cat] = groups.length;
        groups.push({ name: cat, services: [] });
      }
      groups[seen[cat]].services.push(svc);
    });
    var list = groups.map(function (group) {
      return '<div class="ff-appt-picker-cat">' + escapeHtml(group.name) + "</div>" +
        group.services.map(function (svc) {
          return '<button type="button" class="ff-appt-svc-row" data-ff-appt-act="pick-service" data-ff-line="' +
            escapeHtml(line.key) + '" data-ff-service="' + escapeHtml(svc.id) + '">' +
            "<span>" + escapeHtml(svc.name) + "</span>" +
            "<strong>" + escapeHtml(money(svc.price)) + "</strong>" +
            "</button>";
        }).join("");
    }).join("");
    return (
      '<div class="ff-appt-picker" data-ff-picker="service">' +
        '<input type="search" class="ff-appt-picker-q" data-ff-service-q placeholder="Search..." value="' +
          escapeHtml(options && options.serviceQ || "") + '" autocomplete="off">' +
        '<div class="ff-appt-picker-list">' +
          (list || '<div class="ff-appt-picker-empty">No services found</div>') +
        "</div>" +
      "</div>"
    );
  }

  function providerPickerHtml(line, providers, options) {
    var query = trim(options && options.providerQ).toLowerCase();
    var rows = (providers || []).filter(function (emp) {
      if (!emp || !emp.id) return false;
      var name = trim(emp.firstName || emp.name);
      return !query || name.toLowerCase().indexOf(query) !== -1;
    });
    var list = rows.map(function (emp) {
      var name = trim(emp.firstName || emp.name) || "Provider";
      var photo = trim(emp.photoURL || emp.photoUrl || emp.avatarUrl);
      var avatar = photo
        ? '<img src="' + escapeHtml(photo) + '" alt="">'
        : "<span>" + escapeHtml(name.charAt(0).toUpperCase()) + "</span>";
      return '<button type="button" class="ff-appt-prov-row" data-ff-appt-act="pick-provider" data-ff-line="' +
        escapeHtml(line.key) + '" data-ff-provider="' + escapeHtml(emp.id) + '">' +
        '<span class="ff-appt-prov-avatar">' + avatar + "</span>" +
        "<span>" + escapeHtml(name) + "</span>" +
        "</button>";
    }).join("");
    return (
      '<div class="ff-appt-picker" data-ff-picker="provider">' +
        '<input type="search" class="ff-appt-picker-q" data-ff-provider-q placeholder="Search..." value="' +
          escapeHtml(options && options.providerQ || "") + '" autocomplete="off">' +
        '<div class="ff-appt-picker-list">' +
          (list || '<div class="ff-appt-picker-empty">No providers found</div>') +
        "</div>" +
      "</div>"
    );
  }

  function createLinesHtml(state, providers, options) {
    var rows = (state && state.lines) || [];
    var list = Array.isArray(providers) ? providers : [];
    var ui = options || {};
    var canRemove = rows.length > 1;
    var showError = ui.showError !== false;
    return rows.map(function (line) {
      var lineProviders = list.slice();
      if (line.providerId && !lineProviders.some(function (emp) { return emp && emp.id === line.providerId; })) {
        lineProviders = lineProviders.concat([{ id: line.providerId, firstName: providerName(line.providerId) }]);
      }
      var err = showError && state.errorLineKey === line.key && state.error;
      var pickingService = ui.servicePickerKey === line.key;
      var pickingProvider = ui.providerPickerKey === line.key;
      if (!trim(line.serviceId)) {
        return (
          '<div class="ff-appt-block is-empty' + (err ? " is-error" : "") + '" data-ff-line="' + escapeHtml(line.key) + '">' +
            '<button type="button" class="ff-appt-search-row" data-ff-appt-act="open-service-picker" data-ff-line="' +
              escapeHtml(line.key) + '">Search or select service</button>' +
            (pickingService ? servicePickerHtml(state, line, ui) : "") +
            (err ? '<div class="ff-appt-error">' + escapeHtml(state.error) + "</div>" : "") +
          "</div>"
        );
      }
      var withName = line.providerId ? providerName(line.providerId) : "Select provider";
      return (
        '<div class="ff-appt-block' + (err ? " is-error" : "") + '" data-ff-line="' + escapeHtml(line.key) + '">' +
          '<div class="ff-appt-block-top">' +
            "<strong>" + escapeHtml((line.service && line.service.name) || "Service") + "</strong>" +
            (canRemove
              ? '<button type="button" class="ff-appt-block-x" data-ff-line-act="remove" data-ff-line="' +
                escapeHtml(line.key) + '" aria-label="Remove service">×</button>'
              : "") +
          "</div>" +
          '<div class="ff-appt-block-meta">' +
            '<div><span>with</span>' +
              '<button type="button" class="ff-appt-inline" data-ff-appt-act="open-provider-picker" data-ff-line="' +
                escapeHtml(line.key) + '">' + escapeHtml(withName) + "</button>" +
            "</div>" +
            (pickingProvider ? providerPickerHtml(line, lineProviders, ui) : "") +
            '<div><span>at</span>' +
              '<select data-ff-line-field="start">' + timeOptionsHtml(line.startMin) + "</select>" +
            "</div>" +
            '<div><span>for</span><strong>' + escapeHtml(formatDurationLabel(line.durationMinutes) || "—") + "</strong></div>" +
            "<div><span></span><strong>" + escapeHtml(money(line.price)) + "</strong></div>" +
          "</div>" +
          '<div class="ff-appt-cap"' + (line.capabilityMessage ? "" : " hidden") + ">" + escapeHtml(line.capabilityMessage) + "</div>" +
          (err ? '<div class="ff-appt-error">' + escapeHtml(state.error) + "</div>" : "") +
        "</div>"
      );
    }).join("");
  }

  function linesHtml(state, providers, options) {
    var rows = (state && state.lines) || [];
    var list = Array.isArray(providers) ? providers : [];
    var canRemove = rows.length > 1;
    var showError = options && options.showError !== false;
    return rows.map(function (line, index) {
      var lineProviders = list.slice();
      if (line.providerId && !lineProviders.some(function (emp) { return emp && emp.id === line.providerId; })) {
        lineProviders = lineProviders.concat([{ id: line.providerId, firstName: providerName(line.providerId) }]);
      }
      var err = showError && state.errorLineKey === line.key && state.error;
      return (
        '<div class="ff-appt-line' + (err ? " is-error" : "") + '" data-ff-line="' + escapeHtml(line.key) + '">' +
          '<div class="ff-appt-line-head">' +
            "<strong>Service " + (index + 1) + "</strong>" +
            (canRemove
              ? '<button type="button" class="ff-appt-line-remove" data-ff-line-act="remove" data-ff-line="' + escapeHtml(line.key) + '">Remove</button>'
              : "") +
          "</div>" +
          '<label class="ff-appt-field"><span>Service</span>' +
            '<select data-ff-line-field="service">' +
              '<option value="">Select a service</option>' +
              (line.services || []).map(function (svc) {
                return '<option value="' + escapeHtml(svc.id) + '"' + (svc.id === line.serviceId ? " selected" : "") + ">" +
                  escapeHtml(svc.name) + " · " + svc.durationMinutes + " min · " + money(svc.price) +
                  "</option>";
              }).join("") +
            "</select>" +
          "</label>" +
          '<label class="ff-appt-field"><span>Provider</span>' +
            '<select data-ff-line-field="provider">' +
              '<option value="">Select a provider</option>' +
              lineProviders.map(function (emp) {
                return '<option value="' + escapeHtml(emp.id) + '"' + (emp.id === line.providerId ? " selected" : "") + ">" +
                  escapeHtml(emp.firstName || emp.name || "Provider") + "</option>";
              }).join("") +
            "</select>" +
          "</label>" +
          '<label class="ff-appt-field"><span>Start time</span>' +
            '<select data-ff-line-field="start">' + timeOptionsHtml(line.startMin) + "</select>" +
          "</label>" +
          '<div class="ff-appt-summary"' + (line.service ? "" : " hidden") + ">" +
            "<div><span>Duration</span><strong>" + escapeHtml(line.durationMinutes ? line.durationMinutes + " min" : "—") + "</strong></div>" +
            "<div><span>End time</span><strong>" + escapeHtml(line.endMin ? formatMinutes(line.endMin) : "—") + "</strong></div>" +
            "<div><span>Price</span><strong>" + escapeHtml(money(line.price)) + "</strong></div>" +
          "</div>" +
          '<div class="ff-appt-cap"' + (line.capabilityMessage ? "" : " hidden") + ">" + escapeHtml(line.capabilityMessage) + "</div>" +
          (err ? '<div class="ff-appt-error">' + escapeHtml(state.error) + "</div>" : "") +
        "</div>"
      );
    }).join("");
  }

  window.ffBookingAppointmentForm = {
    emptyState: emptyState,
    emptyLine: emptyLine,
    derive: derive,
    isDirty: isDirty,
    canCreate: canCreate,
    refreshServices: refreshServices,
    setService: setService,
    setProvider: setProvider,
    setDate: setDate,
    setStart: setStart,
    setClient: setClient,
    addLine: addLine,
    removeLine: removeLine,
    setLineService: setLineService,
    setLineProvider: setLineProvider,
    setLineStart: setLineStart,
    startAtDate: startAtDate,
    create: create,
    timeOptionsHtml: timeOptionsHtml,
    editStateFrom: editStateFrom,
    isEditDirty: isEditDirty,
    canSave: canSave,
    editPatch: editPatch,
    update: update,
    formatMinutes: formatMinutes,
    providerName: providerName,
    friendlyError: friendlyError,
    holdSpec: holdSpec,
    linesHtml: linesHtml,
    createLinesHtml: createLinesHtml,
    formatDurationLabel: formatDurationLabel,
    lineComplete: lineComplete,
    applyRepoError: applyRepoError
  };
})();
