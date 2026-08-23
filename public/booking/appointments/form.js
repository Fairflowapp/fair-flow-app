/**
 * New Appointment V1 form state.
 * One service line. Repository remains the authority for create/conflicts.
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
    INVALID_LINE: "Please complete the appointment details."
  };

  function trim(value) {
    return String(value == null ? "" : value).trim();
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

  function emptyState(seed) {
    return {
      locationId: trim(seed && seed.locationId),
      dateKey: trim(seed && seed.dateKey),
      startMin: Number(seed && seed.startMin),
      providerId: trim(seed && seed.providerId),
      clientId: "",
      client: null,
      serviceId: "",
      service: null,
      notes: "",
      durationMinutes: 0,
      endMin: 0,
      price: 0,
      services: [],
      capabilityMessage: "",
      error: "",
      creating: false
    };
  }

  function derive(state) {
    var duration = 0;
    var price = 0;
    if (state.service) {
      var svc = window.ffBookingAppointmentServices;
      duration = svc ? svc.effectiveDuration(state.service.raw || state.service, state.providerId) : Number(state.service.durationMinutes) || 0;
      price = svc ? svc.effectivePrice(state.service.raw || state.service) : Number(state.service.price) || 0;
    }
    state.durationMinutes = duration;
    state.price = price;
    state.endMin = Number.isFinite(state.startMin) && duration > 0 ? state.startMin + duration : 0;
    return state;
  }

  function isDirty(state) {
    if (!state) return false;
    return !!(state.clientId || state.serviceId || trim(state.notes) || state.client);
  }

  function canCreate(state) {
    return !!(
      state
      && state.locationId
      && state.dateKey
      && Number.isFinite(state.startMin)
      && state.providerId
      && state.clientId
      && state.serviceId
      && state.durationMinutes > 0
    );
  }

  async function refreshServices(state) {
    var api = window.ffBookingAppointmentServices;
    state.services = api ? await api.listForProvider(state.providerId) : [];
    if (state.serviceId) {
      var next = state.services.find(function (row) { return row.id === state.serviceId; }) || null;
      if (!next) {
        state.serviceId = "";
        state.service = null;
        state.capabilityMessage = "This service is not available with this provider.";
      } else {
        state.service = next;
        state.capabilityMessage = "";
      }
    }
    return derive(state);
  }

  function setService(state, serviceId) {
    var id = trim(serviceId);
    state.serviceId = id;
    state.service = state.services.find(function (row) { return row.id === id; }) || null;
    state.capabilityMessage = "";
    state.error = "";
    return derive(state);
  }

  async function setProvider(state, providerId) {
    state.providerId = trim(providerId);
    state.error = "";
    return refreshServices(state);
  }

  function setDate(state, dateKey) {
    state.dateKey = trim(dateKey);
    state.error = "";
    return state;
  }

  function setStart(state, startMin) {
    state.startMin = Number(startMin);
    state.error = "";
    return derive(state);
  }

  function setClient(state, client) {
    state.client = client || null;
    state.clientId = client && client.clientId ? String(client.clientId) : "";
    state.error = "";
    return state;
  }

  function startAtDate(state) {
    var model = window.ffBookingAppointmentModel;
    if (!model || typeof model.civilToDate !== "function") return null;
    return model.civilToDate(state.dateKey, state.startMin, state.locationId);
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
    try {
      var result = await repo.createAppointment({
        clientId: state.clientId,
        locationId: state.locationId,
        source: "front_desk",
        assignmentType: "specific_provider",
        notes: state.notes,
        serviceLines: [{
          serviceId: state.serviceId,
          providerId: state.providerId,
          startAt: startAtDate(state),
          durationMinutes: state.durationMinutes
        }]
      });
      if (!result || !result.ok) {
        state.error = friendlyError(result && result.code, state.providerId);
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

  window.ffBookingAppointmentForm = {
    emptyState: emptyState,
    derive: derive,
    isDirty: isDirty,
    canCreate: canCreate,
    refreshServices: refreshServices,
    setService: setService,
    setProvider: setProvider,
    setDate: setDate,
    setStart: setStart,
    setClient: setClient,
    startAtDate: startAtDate,
    create: create,
    formatMinutes: formatMinutes,
    providerName: providerName,
    friendlyError: friendlyError
  };
})();
