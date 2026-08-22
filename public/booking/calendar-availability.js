/**
 * Booking Calendar availability — one query surface for shading and later booking.
 * Hours come from calendar-data (salon businessHours + staff defaultSchedule).
 * Do not parse schedules here.
 */
(function () {
  function data() {
    return window.ffBookingCalData || null;
  }

  function axisOf(axis) {
    return axis || {};
  }

  function salonClosedWindows(axis) {
    var dt = data();
    var ax = axisOf(axis);
    if (!dt || typeof dt.salonClosedWindows !== "function") return [];
    return dt.salonClosedWindows(
      ax.startMin,
      ax.endMin,
      ax.salonStartMin,
      ax.salonEndMin,
      ax.salonOpen
    ) || [];
  }

  function providerOffWindows(working, axis) {
    var dt = data();
    var ax = axisOf(axis);
    if (!dt || typeof dt.employeeOffWindows !== "function") return [];
    return dt.employeeOffWindows(
      working,
      ax.salonStartMin,
      ax.salonEndMin,
      ax.salonOpen
    ) || [];
  }

  function covers(windows, minutes) {
    var m = Number(minutes);
    if (!Number.isFinite(m)) return false;
    return (windows || []).some(function (win) {
      return m >= Number(win.startMin) && m < Number(win.endMin);
    });
  }

  function unavailableForProvider(emp, axis) {
    return {
      closed: salonClosedWindows(axis),
      off: providerOffWindows(emp && emp.working, axis)
    };
  }

  function reasonAt(emp, axis, minutes) {
    if (covers(salonClosedWindows(axis), minutes)) return "salon_closed";
    if (covers(providerOffWindows(emp && emp.working, axis), minutes)) return "provider_off";
    return "available";
  }

  function isBookableAt(emp, axis, minutes) {
    return reasonAt(emp, axis, minutes) === "available";
  }

  window.ffBookingCalAvailability = {
    unavailableForProvider: unavailableForProvider,
    reasonAt: reasonAt,
    isBookableAt: isBookableAt
  };
})();
