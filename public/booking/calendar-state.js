/**
 * Booking Calendar day-view state. One in-memory store — do not copy
 * selected date / location / axis into other Calendar modules.
 *
 * Future appointments / filters / drag can extend this object in place.
 */
(function () {
  var VIEW_DAY = "day";

  var selectedDateKey = "";
  var view = VIEW_DAY;
  var locationId = "";
  var employees = [];
  var businessHours = null;
  var axisStartMin = 9 * 60;
  var axisEndMin = 18 * 60;
  var salonOpen = true;

  function time() {
    return window.ffBookingTime || null;
  }

  function ensureDate() {
    if (!selectedDateKey && time()) selectedDateKey = time().todayDateKey();
    return selectedDateKey;
  }

  function getSelectedDateKey() {
    return ensureDate();
  }

  function setSelectedDateKey(next) {
    var key = String(next || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return getSelectedDateKey();
    selectedDateKey = key;
    return selectedDateKey;
  }

  function goToday() {
    if (!time()) return getSelectedDateKey();
    return setSelectedDateKey(time().todayDateKey());
  }

  function shiftDay(delta) {
    if (!time()) return getSelectedDateKey();
    return setSelectedDateKey(time().addDays(getSelectedDateKey(), delta));
  }

  function isToday() {
    if (!time()) return false;
    return getSelectedDateKey() === time().todayDateKey();
  }

  function getView() {
    return VIEW_DAY;
  }

  function getLocationId() {
    return locationId || "";
  }

  function setLocationId(next) {
    locationId = String(next || "").trim();
    return locationId;
  }

  function getEmployees() {
    return employees;
  }

  function setEmployees(list) {
    employees = Array.isArray(list) ? list : [];
    return employees;
  }

  function getBusinessHours() {
    return businessHours;
  }

  function setBusinessDay(next) {
    businessHours = next && typeof next === "object" ? next : null;
    salonOpen = !!(businessHours && businessHours.isOpen);
    axisStartMin = Number.isFinite(next && next.startMin) ? next.startMin : 9 * 60;
    axisEndMin = Number.isFinite(next && next.endMin) ? next.endMin : 18 * 60;
    if (axisEndMin <= axisStartMin) {
      axisStartMin = 9 * 60;
      axisEndMin = 18 * 60;
    }
  }

  function getAxis() {
    return { startMin: axisStartMin, endMin: axisEndMin, salonOpen: salonOpen };
  }

  window.ffBookingCalState = {
    VIEW_DAY: VIEW_DAY,
    getSelectedDateKey: getSelectedDateKey,
    setSelectedDateKey: setSelectedDateKey,
    goToday: goToday,
    shiftDay: shiftDay,
    isToday: isToday,
    getView: getView,
    getLocationId: getLocationId,
    setLocationId: setLocationId,
    getEmployees: getEmployees,
    setEmployees: setEmployees,
    getBusinessHours: getBusinessHours,
    setBusinessDay: setBusinessDay,
    getAxis: getAxis
  };
})();
