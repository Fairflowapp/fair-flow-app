/**
 * Client Profile Appointments tab. Reads only through ffBookingAppointments.
 */
(function () {
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var STATUS_LABELS = {
    scheduled: "Waiting for confirmation",
    confirmed: "Confirmed",
    checked_in: "Checked In",
    in_service: "In Service",
    completed: "Checked Out",
    cancelled: "Cancelled",
    no_show: "No Show"
  };

  function repo() { return window.ffBookingAppointments || null; }
  function model() { return window.ffBookingAppointmentModel || null; }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toDate(value) {
    if (model() && typeof model().toDate === "function") return model().toDate(value);
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === "function") {
      try { return value.toDate(); } catch (_) { return null; }
    }
    if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
    return null;
  }

  function formatClock(date, locationId) {
    var tm = window.ffBookingTime;
    var minutes = tm && typeof tm.zonedMinutes === "function"
      ? tm.zonedMinutes(date, locationId)
      : (date.getHours() * 60 + date.getMinutes());
    var h = Math.floor(Number(minutes) / 60) % 24;
    var m = ((Number(minutes) % 60) + 60) % 60;
    var suffix = h >= 12 ? "PM" : "AM";
    var hour12 = h % 12;
    if (hour12 === 0) hour12 = 12;
    return hour12 + ":" + String(m).padStart(2, "0") + " " + suffix;
  }

  function formatDay(date, locationId) {
    var tm = window.ffBookingTime;
    var key = tm && typeof tm.zonedDateKey === "function" ? tm.zonedDateKey(date, locationId) : "";
    var parts = tm && typeof tm.parseDateKey === "function" && key ? tm.parseDateKey(key) : null;
    if (parts) {
      var utc = new Date(Date.UTC(parts.y, parts.m - 1, parts.d, 12, 0, 0));
      return DAYS[utc.getUTCDay()] + ", " + MONTHS[utc.getUTCMonth()] + " " + parts.d;
    }
    return DAYS[date.getDay()] + ", " + MONTHS[date.getMonth()] + " " + date.getDate();
  }

  function statusLabel(status) {
    var flow = window.ffBookingAppointmentStatus;
    if (flow && typeof flow.label === "function") return flow.label(status);
    var key = String(status || "").trim();
    return STATUS_LABELS[key] || key || "Waiting for confirmation";
  }

  function serviceNames(appt) {
    var lines = appt && Array.isArray(appt.serviceLines) ? appt.serviceLines : [];
    var names = [];
    lines.forEach(function (line) {
      var name = String(line && line.serviceNameSnapshot || "").trim();
      if (name && names.indexOf(name) === -1) names.push(name);
    });
    return names.join(" + ") || "Service";
  }

  function providerNames(appt) {
    var lines = appt && Array.isArray(appt.serviceLines) ? appt.serviceLines : [];
    var names = [];
    lines.forEach(function (line) {
      var name = String(line && line.providerNameSnapshot || "").trim();
      if (name && names.indexOf(name) === -1) names.push(name);
    });
    return names.join(", ") || "—";
  }

  function rowHtml(appt) {
    var start = toDate(appt && appt.startAt);
    var end = toDate(appt && appt.endAt);
    var loc = appt && appt.locationId || "";
    var day = start ? formatDay(start, loc) : "—";
    var time = start && end
      ? formatClock(start, loc) + " – " + formatClock(end, loc)
      : (start ? formatClock(start, loc) : "—");
    var status = String(appt && appt.status || "scheduled");
    return (
      '<article class="ff-cli-appt" data-ff-cli-appt="' + escapeHtml(appt.appointmentId) + '">' +
        '<button type="button" class="ff-cli-appt-main" data-ff-cli-appt-toggle="' + escapeHtml(appt.appointmentId) + '">' +
          '<div class="ff-cli-appt-when">' +
            '<strong>' + escapeHtml(day) + "</strong>" +
            "<span>" + escapeHtml(time) + "</span>" +
          "</div>" +
          '<div class="ff-cli-appt-what">' +
            "<strong>" + escapeHtml(serviceNames(appt)) + "</strong>" +
            "<span>" + escapeHtml(providerNames(appt)) + "</span>" +
          "</div>" +
          '<span class="ff-cli-appt-status is-' + escapeHtml(status) + '">' + escapeHtml(statusLabel(status)) + "</span>" +
        "</button>" +
        '<div class="ff-cli-appt-more" hidden>' +
          (appt.notes ? "<p>" + escapeHtml(appt.notes) + "</p>" : "<p>No appointment notes.</p>") +
          (loc ? '<p class="ff-cli-appt-loc">Location ID: ' + escapeHtml(loc) + "</p>" : "") +
        "</div>" +
      "</article>"
    );
  }

  function sectionHtml(title, rows, emptyCopy) {
    return (
      '<section class="ff-cli-appt-section">' +
        "<h3>" + title + "</h3>" +
        (rows.length ? rows.map(rowHtml).join("") : '<div class="ff-cli-appt-empty">' + escapeHtml(emptyCopy) + "</div>") +
      "</section>"
    );
  }

  async function load(clientId) {
    var api = repo();
    var id = String(clientId || "").trim();
    if (!api || !id || typeof api.getClientAppointments !== "function") {
      return { upcoming: [], past: [] };
    }
    return api.getClientAppointments(id, { limit: 20 });
  }

  function render(host, data) {
    if (!host) return;
    var upcoming = data && data.upcoming ? data.upcoming : [];
    var past = data && data.past ? data.past : [];
    host.innerHTML =
      sectionHtml("Upcoming", upcoming, "No upcoming appointments") +
      sectionHtml("Past", past, "No past appointments");
  }

  function toggle(host, appointmentId) {
    if (!host) return;
    var id = String(appointmentId || "").trim();
    host.querySelectorAll(".ff-cli-appt").forEach(function (card) {
      var open = card.getAttribute("data-ff-cli-appt") === id && !card.classList.contains("is-open");
      card.classList.toggle("is-open", open);
      var more = card.querySelector(".ff-cli-appt-more");
      if (more) more.hidden = !open;
    });
  }

  window.ffBookingClientProfileAppointments = {
    load: load,
    render: render,
    toggle: toggle,
    statusLabel: statusLabel
  };
})();
