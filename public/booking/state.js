/**
 * In-memory Booking area/section state.
 * Switching areas does not reload the app or reset Operations listeners.
 */
(function () {
  var AREA_OPS = "operations";
  var AREA_BOOKING = "booking";
  var SECTIONS = { calendar: true, clients: true, services: true };

  var area = AREA_OPS;
  var section = "calendar";

  function getArea() {
    return area === AREA_BOOKING ? AREA_BOOKING : AREA_OPS;
  }

  function setArea(next) {
    var value = next === AREA_BOOKING ? AREA_BOOKING : AREA_OPS;
    if (area === value) return area;
    area = value;
    return area;
  }

  function getSection() {
    return SECTIONS[section] ? section : "calendar";
  }

  function setSection(next) {
    var value = SECTIONS[next] ? next : "calendar";
    section = value;
    return section;
  }

  function isBooking() {
    return getArea() === AREA_BOOKING;
  }

  window.ffBookingState = {
    AREA_OPS: AREA_OPS,
    AREA_BOOKING: AREA_BOOKING,
    getArea: getArea,
    setArea: setArea,
    getSection: getSection,
    setSection: setSection,
    isBooking: isBooking
  };
})();
