/**
 * Appointment visit flow: labels, calendar colors, and next-step actions.
 */
(function () {
  var LABELS = {
    scheduled: "Waiting for confirmation",
    confirmed: "Confirmed",
    checked_in: "Checked In",
    in_service: "In Service",
    completed: "Checked Out",
    cancelled: "Cancelled",
    no_show: "No Show"
  };
  var HINTS = {
    scheduled: "Booked in the system, not confirmed yet.",
    confirmed: "Confirmed and waiting for the client.",
    checked_in: "The client is here and waiting for the provider.",
    in_service: "Service is in progress.",
    completed: "This visit is finished."
  };

  function normalize(status) {
    var key = String(status == null ? "" : status).trim();
    return LABELS[key] ? key : "scheduled";
  }

  function label(status) {
    return LABELS[normalize(status)];
  }

  function hint(status) {
    return HINTS[normalize(status)] || "";
  }

  function cardClass(status) {
    return "is-status-" + normalize(status);
  }

  function actions(status) {
    var key = normalize(status);
    if (key === "scheduled") {
      return [
        { id: "confirm", next: "confirmed", label: "Confirm Appointment" },
        { id: "check-in", next: "checked_in", label: "Check In" }
      ];
    }
    if (key === "confirmed") {
      return [{ id: "check-in", next: "checked_in", label: "Check In" }];
    }
    if (key === "checked_in") {
      return [{ id: "start-service", next: "in_service", label: "Start Service" }];
    }
    if (key === "in_service") {
      return [{ id: "check-out", next: "completed", label: "Check Out" }];
    }
    return [];
  }

  function canAdvanceTo(fromStatus, nextStatus) {
    var next = String(nextStatus || "").trim();
    return actions(fromStatus).some(function (act) { return act.next === next; });
  }

  window.ffBookingAppointmentStatus = {
    LABELS: LABELS,
    HINTS: HINTS,
    normalize: normalize,
    label: label,
    hint: hint,
    cardClass: cardClass,
    actions: actions,
    canAdvanceTo: canAdvanceTo
  };
})();
