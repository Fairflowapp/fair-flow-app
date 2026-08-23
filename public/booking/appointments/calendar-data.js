/**
 * Bounded Calendar appointment reads. Uses ffBookingAppointments only.
 */
(function () {
  var cache = { key: "", rows: [] };

  function repo() { return window.ffBookingAppointments || null; }
  function model() { return window.ffBookingAppointmentModel || null; }
  function time() { return window.ffBookingTime || null; }

  function viewKey(dateKey, locationId) {
    return String(dateKey || "") + "|" + String(locationId || "");
  }

  function minutesOf(value, locationId) {
    var api = model();
    var tm = time();
    var date = api && typeof api.toDate === "function" ? api.toDate(value) : null;
    if (!date || !tm || typeof tm.zonedMinutes !== "function") return null;
    var min = tm.zonedMinutes(date, locationId);
    return Number.isFinite(min) ? min : null;
  }

  function cardsFrom(rows, locationId) {
    var api = model();
    var out = [];
    (rows || []).forEach(function (appt) {
      if (!appt || (api && typeof api.isActiveStatus === "function" && !api.isActiveStatus(appt.status))) return;
      if (appt.status === "cancelled") return;
      (appt.serviceLines || []).forEach(function (line) {
        if (!line || !line.providerId) return;
        var startMin = minutesOf(line.startAt, locationId);
        var endMin = minutesOf(line.endAt, locationId);
        if (startMin == null) return;
        if (endMin == null || endMin <= startMin) {
          endMin = startMin + (Number(line.durationMinutes) > 0 ? Number(line.durationMinutes) : 15);
        }
        if (endMin <= startMin) endMin = startMin + 15;
        out.push({
          appointmentId: appt.appointmentId,
          lineId: line.lineId || appt.appointmentId,
          providerId: line.providerId,
          startMin: startMin,
          endMin: endMin,
          durationMinutes: endMin - startMin,
          clientName: appt.clientSnapshot && appt.clientSnapshot.displayName
            ? appt.clientSnapshot.displayName
            : "Client",
          serviceName: line.serviceNameSnapshot || "Service",
          status: appt.status
        });
      });
    });
    return out;
  }

  async function loadForView(dateKey, locationId) {
    var api = repo();
    var key = viewKey(dateKey, locationId);
    if (!api || !dateKey || !locationId) {
      cache = { key: "", rows: [] };
      return [];
    }
    var rows = [];
    try {
      rows = await api.getAppointmentsForDate(dateKey, locationId);
    } catch (_) {
      rows = [];
    }
    cache = { key: key, rows: rows || [] };
    return cache.rows;
  }

  function cardsForView(dateKey, locationId) {
    if (cache.key !== viewKey(dateKey, locationId)) return [];
    return cardsFrom(cache.rows, locationId);
  }

  window.ffBookingCalAppointments = {
    loadForView: loadForView,
    cardsForView: cardsForView,
    cardsFrom: cardsFrom,
    getCached: function () { return cache.rows.slice(); }
  };
})();
