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
      var partySize = api && typeof api.partySizeForVisit === "function"
        ? api.partySizeForVisit(appt.serviceLines)
        : (api && typeof api.uniquePeopleFromLines === "function" ? api.uniquePeopleFromLines(appt.serviceLines) : 1);
      var grouped = {};
      var groupOrder = [];
      (appt.serviceLines || []).forEach(function (line) {
        if (!line || !line.providerId) return;
        var startMin = minutesOf(line.startAt, locationId);
        var endMin = minutesOf(line.endAt, locationId);
        if (startMin == null) return;
        if (endMin == null || endMin <= startMin) {
          endMin = startMin + (Number(line.durationMinutes) > 0 ? Number(line.durationMinutes) : 15);
        }
        if (endMin <= startMin) endMin = startMin + 15;
        var person = api && typeof api.personKey === "function" ? api.personKey(line) : "booker";
        var key = String(appt.appointmentId || "") + "|" + String(line.providerId) + "|" + String(person);
        if (!grouped[key]) {
          grouped[key] = [];
          groupOrder.push(key);
        }
        grouped[key].push({
          appointmentId: appt.appointmentId,
          clientId: String(appt.clientId || "").trim(),
          clientKey: (function () {
            var client = String(appt.clientId || "").trim() || String(appt.appointmentId || "");
            return person === "booker" ? client : client + ":" + person;
          }()),
          lineId: line.lineId || appt.appointmentId,
          providerId: line.providerId,
          startMin: startMin,
          endMin: endMin,
          durationMinutes: endMin - startMin,
          clientName: (line.guestName && String(line.guestName).trim())
            || (appt.clientSnapshot && appt.clientSnapshot.displayName)
            || "Client",
          serviceName: line.serviceNameSnapshot || "Service",
          status: appt.status,
          partySize: partySize,
          firstVisit: !!(appt.firstVisit),
          requested: !!(line.requested),
          personKey: person
        });
      });
      groupOrder.forEach(function (key) {
        var rows = grouped[key].slice().sort(function (a, b) {
          return a.startMin - b.startMin || String(a.lineId).localeCompare(String(b.lineId));
        });
        var first = rows[0];
        var startMin = first.startMin;
        var endMin = first.endMin;
        var names = [];
        var lineIds = [];
        var requested = false;
        rows.forEach(function (row) {
          if (row.startMin < startMin) startMin = row.startMin;
          if (row.endMin > endMin) endMin = row.endMin;
          if (row.serviceName && names.indexOf(row.serviceName) === -1) names.push(row.serviceName);
          lineIds.push(row.lineId);
          if (row.requested) requested = true;
        });
        out.push(Object.assign({}, first, {
          startMin: startMin,
          endMin: endMin,
          durationMinutes: endMin - startMin,
          serviceName: names.join(" · "),
          serviceNames: names,
          segments: rows.map(function (row) {
            return {
              lineId: row.lineId,
              serviceName: row.serviceName,
              startMin: row.startMin,
              endMin: row.endMin,
              durationMinutes: row.durationMinutes,
              requested: !!(row.requested)
            };
          }),
          lineId: first.lineId,
          lineIds: lineIds,
          requested: requested
        }));
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

  function getCachedById(appointmentId) {
    var id = String(appointmentId || "").trim();
    if (!id) return null;
    var hit = cache.rows.find(function (row) {
      return row && String(row.appointmentId || "") === id;
    });
    return hit || null;
  }

  window.ffBookingCalAppointments = {
    loadForView: loadForView,
    cardsForView: cardsForView,
    cardsFrom: cardsFrom,
    getCached: function () { return cache.rows.slice(); },
    getCachedById: getCachedById
  };
})();
