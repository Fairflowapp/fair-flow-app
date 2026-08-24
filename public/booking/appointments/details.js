/**
 * Read-only Appointment Details drawer. Opens from a persisted calendar card.
 * Does not edit, cancel, reschedule, or write appointments.
 */
(function () {
  var ROOT_ID = "ffBookingApptDetails";
  var STATUS_LABELS = {
    scheduled: "Scheduled",
    confirmed: "Confirmed",
    checked_in: "Checked In",
    in_service: "In Service",
    completed: "Completed",
    cancelled: "Cancelled",
    no_show: "No Show"
  };
  var current = null;

  function live() { return window.ffBookingDrawerLive || null; }
  function calAppts() { return window.ffBookingCalAppointments || null; }
  function repo() { return window.ffBookingAppointments || null; }
  function model() { return window.ffBookingAppointmentModel || null; }

  function host() {
    return document.getElementById("ffBookingWorkspace") || document.body;
  }

  function canOpen() {
    var workspace = document.getElementById("ffBookingWorkspace");
    if (workspace && workspace.hasAttribute("hidden")) return false;
    var shell = window.ffBookingState;
    if (shell && !shell.isBooking()) return false;
    return !!document.getElementById("ffBookingCalendarRoot");
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function initials(name) {
    var parts = trim(name).split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function money(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = 0;
    return "$" + (Math.round(n * 100) / 100).toFixed(n % 1 ? 2 : 0);
  }

  function formatMinutes(total) {
    if (window.ffBookingAppointmentForm && window.ffBookingAppointmentForm.formatMinutes) {
      return window.ffBookingAppointmentForm.formatMinutes(total);
    }
    var m = ((Number(total) % 1440) + 1440) % 1440;
    var hour = Math.floor(m / 60);
    var min = m % 60;
    var suffix = hour >= 12 ? "PM" : "AM";
    var hour12 = hour % 12;
    if (hour12 === 0) hour12 = 12;
    return hour12 + ":" + String(min).padStart(2, "0") + " " + suffix;
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

  function minutesOf(value, locationId) {
    var date = toDate(value);
    var tm = window.ffBookingTime;
    if (!date || !tm || typeof tm.zonedMinutes !== "function") return null;
    var min = tm.zonedMinutes(date, locationId);
    return Number.isFinite(min) ? min : null;
  }

  function pickLine(appointment, lineId) {
    var lines = appointment && Array.isArray(appointment.serviceLines) ? appointment.serviceLines : [];
    var id = trim(lineId);
    var hit = id ? lines.find(function (line) { return line && trim(line.lineId) === id; }) : null;
    return hit || lines[0] || null;
  }

  function findProvider(providerId) {
    var id = trim(providerId);
    if (!id) return null;
    var st = window.ffBookingCalState;
    var list = [];
    try {
      if (st && typeof st.getEmployees === "function") list = st.getEmployees() || [];
    } catch (_) {}
    var emp = list.find(function (row) {
      return row && (String(row.id || "") === id || String(row.staffId || "") === id);
    });
    if (emp) return emp;
    try {
      if (typeof window.ffGetStaffStore === "function") {
        var store = window.ffGetStaffStore();
        list = store && Array.isArray(store.staff) ? store.staff : [];
      }
    } catch (_) { list = []; }
    return list.find(function (row) {
      return row && (String(row.id || "") === id || String(row.staffId || "") === id);
    }) || null;
  }

  function locationLabel(locationId) {
    try {
      var list = typeof window.ffGetLocations === "function" ? window.ffGetLocations() : [];
      var row = (list || []).find(function (loc) {
        return loc && (String(loc.id || "") === String(locationId) || String(loc.locationId || "") === String(locationId));
      });
      if (row && (row.name || row.label || row.title)) return row.name || row.label || row.title;
    } catch (_) {}
    return "";
  }

  function statusLabel(status) {
    var key = trim(status);
    if (STATUS_LABELS[key]) return STATUS_LABELS[key];
    if (!key) return "";
    return key.replace(/_/g, " ").replace(/\b\w/g, function (ch) { return ch.toUpperCase(); });
  }

  function viewFrom(appointment, lineId) {
    var snap = appointment && appointment.clientSnapshot && typeof appointment.clientSnapshot === "object"
      ? appointment.clientSnapshot
      : {};
    var line = pickLine(appointment, lineId);
    var locationId = appointment && appointment.locationId ? appointment.locationId : "";
    var startMin = line ? minutesOf(line.startAt, locationId) : null;
    var endMin = line ? minutesOf(line.endAt, locationId) : null;
    var duration = line && Number(line.durationMinutes) > 0 ? Number(line.durationMinutes) : 0;
    if (!duration && startMin != null && endMin != null && endMin > startMin) duration = endMin - startMin;
    if (startMin != null && (endMin == null || endMin <= startMin) && duration) endMin = startMin + duration;
    var provider = line ? findProvider(line.providerId) : null;
    var providerName = trim(line && line.providerNameSnapshot)
      || trim(provider && (provider.firstName || provider.name || provider.displayName))
      || "Provider";
    var photo = trim(provider && (provider.photoURL || provider.avatarUrl || provider.photoUrl || provider.imageUrl));
    var dateKey = trim(appointment && appointment.dateKey);
    if (!dateKey && window.ffBookingTime && appointment && appointment.startAt) {
      var startDate = toDate(appointment.startAt);
      if (startDate && typeof window.ffBookingTime.zonedDateKey === "function") {
        dateKey = window.ffBookingTime.zonedDateKey(startDate, locationId) || "";
      }
    }
    var dateLabel = "";
    if (dateKey && window.ffBookingTime && typeof window.ffBookingTime.formatDisplayDate === "function") {
      dateLabel = window.ffBookingTime.formatDisplayDate(dateKey);
    }
    var notes = trim(appointment && appointment.notes);
    var clientName = trim(snap.displayName) || "Client";
    var clientPhone = trim(snap.phone);
    var clientEmail = trim(snap.email);
    return {
      appointmentId: trim(appointment && appointment.appointmentId),
      clientName: clientName,
      clientPhone: clientPhone,
      clientEmail: clientEmail,
      clientSecondary: clientPhone || clientEmail,
      clientInitials: initials(clientName),
      serviceName: trim(line && line.serviceNameSnapshot) || "Service",
      durationLabel: duration ? duration + " min" : "—",
      startLabel: startMin != null ? formatMinutes(startMin) : "—",
      endLabel: endMin != null ? formatMinutes(endMin) : "—",
      priceLabel: money(line && line.priceSnapshot),
      providerName: providerName,
      providerPhoto: photo,
      dateLabel: dateLabel || "—",
      locationLabel: locationLabel(locationId) || "—",
      notes: notes,
      notesEmpty: !notes,
      statusLabel: statusLabel(appointment && appointment.status)
    };
  }

  function clientHtml(view) {
    return (
      '<div class="ff-apd-client">' +
        '<span class="ff-apd-avatar ff-apd-initials">' + escapeHtml(view.clientInitials) + "</span>" +
        '<div class="ff-apd-client-id">' +
          "<strong>" + escapeHtml(view.clientName) + "</strong>" +
          (view.clientSecondary ? "<span>" + escapeHtml(view.clientSecondary) + "</span>" : "") +
        "</div>" +
      "</div>"
    );
  }

  function providerHtml(view) {
    var avatar = view.providerPhoto
      ? '<img class="ff-apd-avatar" src="' + escapeHtml(view.providerPhoto) + '" alt="">'
      : '<span class="ff-apd-avatar ff-apd-initials">' + escapeHtml(initials(view.providerName)) + "</span>";
    return (
      '<div class="ff-apd-provider">' +
        avatar +
        '<div class="ff-apd-value">' + escapeHtml(view.providerName) + "</div>" +
      "</div>"
    );
  }

  function paint() {
    var ui = els();
    if (!ui.root || !current || !current.appointment) return;
    var view = viewFrom(current.appointment, current.lineId);
    ui.client.innerHTML = clientHtml(view);
    ui.service.textContent = view.serviceName;
    ui.dur.textContent = view.durationLabel;
    ui.start.textContent = view.startLabel;
    ui.end.textContent = view.endLabel;
    ui.price.textContent = view.priceLabel;
    ui.provider.innerHTML = providerHtml(view);
    ui.date.textContent = view.dateLabel;
    ui.location.textContent = view.locationLabel;
    ui.notes.textContent = view.notesEmpty ? "No notes" : view.notes;
    ui.notes.classList.toggle("is-empty", view.notesEmpty);
    ui.statusRow.hidden = !view.statusLabel;
    ui.status.textContent = view.statusLabel;
  }

  function els() {
    return {
      root: document.getElementById(ROOT_ID),
      client: document.getElementById("ffApdClient"),
      service: document.getElementById("ffApdService"),
      dur: document.getElementById("ffApdDur"),
      start: document.getElementById("ffApdStart"),
      end: document.getElementById("ffApdEnd"),
      price: document.getElementById("ffApdPrice"),
      provider: document.getElementById("ffApdProvider"),
      date: document.getElementById("ffApdDate"),
      location: document.getElementById("ffApdLocation"),
      notes: document.getElementById("ffApdNotes"),
      statusRow: document.getElementById("ffApdStatusRow"),
      status: document.getElementById("ffApdStatus")
    };
  }

  function ensureDom() {
    var existing = document.getElementById(ROOT_ID);
    if (existing && existing.parentNode !== host()) host().appendChild(existing);
    if (existing) return existing;
    var aside = document.createElement("aside");
    aside.id = ROOT_ID;
    aside.className = "ff-apd";
    aside.setAttribute("role", "dialog");
    aside.setAttribute("aria-labelledby", "ffApdTitle");
    aside.setAttribute("aria-hidden", "true");
    aside.hidden = true;
    aside.innerHTML =
      '<header class="ff-apd-head">' +
        '<h2 id="ffApdTitle">Appointment Details</h2>' +
        '<button type="button" class="ff-apd-x" data-ff-apd-act="close" aria-label="Close">×</button>' +
      "</header>" +
      '<div class="ff-apd-body">' +
        '<div class="ff-apd-field"><span class="ff-apd-label">Client</span><div id="ffApdClient"></div></div>' +
        '<div class="ff-apd-field"><span class="ff-apd-label">Service</span><div id="ffApdService" class="ff-apd-value"></div></div>' +
        '<div class="ff-apd-metrics">' +
          '<div class="ff-apd-metric"><span>Duration</span><strong id="ffApdDur"></strong></div>' +
          '<div class="ff-apd-metric"><span>Start time</span><strong id="ffApdStart"></strong></div>' +
          '<div class="ff-apd-metric"><span>End time</span><strong id="ffApdEnd"></strong></div>' +
          '<div class="ff-apd-metric"><span>Price</span><strong id="ffApdPrice"></strong></div>' +
        "</div>" +
        '<div class="ff-apd-field"><span class="ff-apd-label">Provider</span><div id="ffApdProvider"></div></div>' +
        '<div class="ff-apd-field"><span class="ff-apd-label">Date</span><div id="ffApdDate" class="ff-apd-value"></div></div>' +
        '<div class="ff-apd-field"><span class="ff-apd-label">Location</span><div id="ffApdLocation" class="ff-apd-value"></div></div>' +
        '<div class="ff-apd-field"><span class="ff-apd-label">Notes</span><div id="ffApdNotes" class="ff-apd-notes"></div></div>' +
        '<div id="ffApdStatusRow" class="ff-apd-field"><span class="ff-apd-label">Status</span><div id="ffApdStatus" class="ff-apd-value"></div></div>' +
      "</div>" +
      '<footer class="ff-apd-foot">' +
        '<button type="button" class="ff-apd-ghost" data-ff-apd-act="close">Close</button>' +
        '<button type="button" class="ff-apd-primary" disabled aria-disabled="true">Edit Appointment</button>' +
      "</footer>";
    host().appendChild(aside);
    aside.addEventListener("click", function (ev) {
      var act = ev.target && ev.target.closest ? ev.target.closest("[data-ff-apd-act]") : null;
      if (act && act.getAttribute("data-ff-apd-act") === "close") close();
    });
    return aside;
  }

  function closeSiblingDrawers() {
    try {
      if (window.ffBookingAppointmentDrawer && window.ffBookingAppointmentDrawer.forceClose) {
        window.ffBookingAppointmentDrawer.forceClose();
      }
    } catch (_) {}
    try {
      if (window.ffBookingClientsOptions && window.ffBookingClientsOptions.forceClose) {
        window.ffBookingClientsOptions.forceClose();
      }
    } catch (_) {}
    try {
      if (window.ffBookingClientProfile && window.ffBookingClientProfile.forceClose) {
        window.ffBookingClientProfile.forceClose();
      }
    } catch (_) {}
    try {
      if (window.ffBookingClientsDrawer && window.ffBookingClientsDrawer.forceClose) {
        window.ffBookingClientsDrawer.forceClose();
      }
    } catch (_) {}
  }

  function placeLive() {
    var api = live();
    var root = document.getElementById(ROOT_ID);
    if (api && root) api.place(root);
  }

  function restoreLive() {
    if (live()) live().restore();
  }

  function isOpen() {
    var root = document.getElementById(ROOT_ID);
    return !!(root && !root.hidden && root.classList.contains("is-open"));
  }

  function close() {
    var ui = els();
    current = null;
    if (ui.root) {
      ui.root.hidden = true;
      ui.root.classList.remove("is-open");
      ui.root.setAttribute("aria-hidden", "true");
    }
    restoreLive();
  }

  function forceClose() {
    close();
  }

  async function resolveAppointment(appointmentId) {
    var id = trim(appointmentId);
    var cached = calAppts() && typeof calAppts().getCachedById === "function"
      ? calAppts().getCachedById(id)
      : null;
    if (cached && trim(cached.appointmentId) === id) return cached;
    if (repo() && typeof repo().getAppointmentById === "function") {
      try { return await repo().getAppointmentById(id); } catch (_) { return null; }
    }
    return null;
  }

  async function open(spec) {
    var appointmentId = trim(spec && spec.appointmentId);
    if (!appointmentId || !canOpen()) return;
    closeSiblingDrawers();
    var appointment = await resolveAppointment(appointmentId);
    if (!appointment || trim(appointment.appointmentId) !== appointmentId) return;
    current = {
      appointment: appointment,
      lineId: trim(spec && spec.lineId)
    };
    ensureDom();
    var ui = els();
    ui.root.hidden = false;
    ui.root.classList.add("is-open");
    ui.root.setAttribute("aria-hidden", "false");
    paint();
    placeLive();
    requestAnimationFrame(placeLive);
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape" || !isOpen()) return;
    if (document.getElementById("ffLiveFloorDrawer") && document.getElementById("ffLiveFloorDrawer").classList.contains("is-open")) return;
    if (document.getElementById("ffLiveDeskPanel") && document.getElementById("ffLiveDeskPanel").classList.contains("is-open")) return;
    ev.preventDefault();
    close();
  });

  window.addEventListener("resize", function () {
    if (isOpen()) placeLive();
  });

  document.addEventListener("ff-active-location-changed", function () {
    if (isOpen()) close();
  });

  window.ffBookingAppointmentDetails = {
    open: open,
    close: close,
    forceClose: forceClose,
    isOpen: isOpen,
    viewFrom: viewFrom,
    getCurrentId: function () {
      return current && current.appointment ? current.appointment.appointmentId : "";
    }
  };
})();
