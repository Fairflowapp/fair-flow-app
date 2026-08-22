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
  var focusProviderId = "";
  var businessHours = null;
  var axisStartMin = 8 * 60;
  var axisEndMin = 19 * 60;
  var salonStartMin = 9 * 60;
  var salonEndMin = 18 * 60;
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
    if (focusProviderId && !employees.some(function (emp) { return emp.id === focusProviderId; })) {
      focusProviderId = "";
    }
    return employees;
  }

  function getFocusProviderId() {
    return focusProviderId || "";
  }

  function setFocusProviderId(next) {
    var id = String(next || "").trim();
    focusProviderId = id;
    return focusProviderId;
  }

  function clearFocusProvider() {
    focusProviderId = "";
    return focusProviderId;
  }

  function getVisibleEmployees() {
    if (!focusProviderId) return employees;
    var focused = employees.filter(function (emp) { return emp.id === focusProviderId; });
    return focused.length ? focused : employees;
  }

  function getBusinessHours() {
    return businessHours;
  }

  function setBusinessDay(next) {
    businessHours = next && typeof next === "object" ? next : null;
    salonOpen = !!(businessHours && businessHours.isOpen);
    salonStartMin = Number.isFinite(next && next.salonStartMin) ? next.salonStartMin : 9 * 60;
    salonEndMin = Number.isFinite(next && next.salonEndMin) ? next.salonEndMin : 18 * 60;
    axisStartMin = Number.isFinite(next && next.startMin) ? next.startMin : Math.max(0, salonStartMin - 60);
    axisEndMin = Number.isFinite(next && next.endMin) ? next.endMin : salonEndMin + 60;
    if (axisEndMin <= axisStartMin) {
      axisStartMin = Math.max(0, salonStartMin - 60);
      axisEndMin = salonEndMin + 60;
    }
  }

  function getAxis() {
    return {
      startMin: axisStartMin,
      endMin: axisEndMin,
      salonOpen: salonOpen,
      salonStartMin: salonStartMin,
      salonEndMin: salonEndMin
    };
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
    getVisibleEmployees: getVisibleEmployees,
    getFocusProviderId: getFocusProviderId,
    setFocusProviderId: setFocusProviderId,
    clearFocusProvider: clearFocusProvider,
    getBusinessHours: getBusinessHours,
    setBusinessDay: setBusinessDay,
    getAxis: getAxis
  };
})();
