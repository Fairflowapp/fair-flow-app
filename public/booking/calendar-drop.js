/**
 * Local Calendar unavailable-time guard. Shared by create-from-slot and
 * drag/drop so salon-closed and provider-off reject before persist.
 */
(function () {
  var MESSAGES = Object.freeze({
    salon_closed: "The salon is closed at that time.",
    provider_off: "This provider is not available at that time.",
    provider_blocked: "This time is blocked for this provider."
  });

  function availability() {
    return window.ffBookingCalAvailability || null;
  }

  function state() {
    return window.ffBookingCalState || null;
  }

  function rangeOverlaps(windows, startMin, endMin) {
    var start = Number(startMin);
    var end = Number(endMin);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return false;
    return (windows || []).some(function (win) {
      return Number(win.startMin) < end && Number(win.endMin) > start;
    });
  }

  function durationOf(action) {
    var n = Number(action && action.durationMinutes);
    if (n > 0) return n;
    n = Number(action && action.source && action.source.durationMinutes);
    return n > 0 ? n : 30;
  }

  function axisOf(action) {
    if (action && action.axis) return action.axis;
    var st = state();
    return st && typeof st.getAxis === "function" ? st.getAxis() : null;
  }

  function employeesOf() {
    var st = state();
    var list = [];
    try {
      if (st && typeof st.getEmployees === "function") list = st.getEmployees() || [];
      if ((!list || !list.length) && st && typeof st.getVisibleEmployees === "function") {
        list = st.getVisibleEmployees() || [];
      }
    } catch (_) {
      list = [];
    }
    return list || [];
  }

  function employeeOf(action) {
    if (action && action.employee) return action.employee;
    var id = String((action && action.providerId) || "").trim();
    if (!id) return null;
    return employeesOf().find(function (row) {
      return row && (String(row.id || "") === id || String(row.staffId || "") === id);
    }) || null;
  }

  function inspect(action) {
    if (!action || !String(action.providerId || "").trim()) return { ok: true };
    var startMin = Number(action.startMin);
    if (!Number.isFinite(startMin)) return { ok: true };
    var av = availability();
    var axis = axisOf(action);
    var emp = employeeOf(action);
    if (!av || typeof av.unavailableForProvider !== "function" || !axis) {
      return { ok: true };
    }
    if (!emp) return { ok: true };
    var endMin = startMin + durationOf(action);
    var regions = av.unavailableForProvider(emp, axis) || {};
    if (rangeOverlaps(regions.closed, startMin, endMin)) {
      return { ok: false, reason: "salon_closed", message: MESSAGES.salon_closed };
    }
    if (rangeOverlaps(regions.off, startMin, endMin)) {
      return { ok: false, reason: "provider_off", message: MESSAGES.provider_off };
    }
    if (rangeOverlaps(regions.blocked, startMin, endMin)) {
      return { ok: false, reason: "provider_blocked", message: MESSAGES.provider_blocked };
    }
    return { ok: true };
  }

  function inspectCreate(spec) {
    var next = spec && typeof spec === "object" ? spec : {};
    return inspect({
      providerId: next.providerId,
      startMin: next.startMin,
      durationMinutes: Number(next.durationMinutes) > 0 ? Number(next.durationMinutes) : 30,
      axis: next.axis,
      employee: next.employee,
      dateKey: next.dateKey,
      locationId: next.locationId
    });
  }

  window.ffBookingCalDrop = {
    inspect: inspect,
    inspectCreate: inspectCreate,
    rangeOverlaps: rangeOverlaps,
    MESSAGES: MESSAGES
  };
})();
