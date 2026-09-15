/**
 * Booking Calendar view state. One in-memory store — do not copy
 * selected date / location / axis into other Calendar modules.
 *
 * Provider filters are view-only Day state. Week provider/range are
 * isolated and must not replace Day filters. Session only.
 */
(function () {
  var VIEW_DAY = "day";
  var VIEW_WEEK = "week";

  var selectedDateKey = "";
  var view = VIEW_DAY;
  var locationId = "";
  var employees = [];
  var focusProviderId = "";
  var visibleProviderIds = [];
  var weekProviderId = "";
  var weekAnchorKey = "";
  var businessHours = null;
  var axisStartMin = 8 * 60;
  var axisEndMin = 19 * 60;
  var salonStartMin = 9 * 60;
  var salonEndMin = 18 * 60;
  var salonOpen = true;
  var salonIntervals = [];

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
    return view === VIEW_WEEK ? VIEW_WEEK : VIEW_DAY;
  }

  function isWeek() {
    return getView() === VIEW_WEEK;
  }

  function getWeekAnchorKey() {
    if (!weekAnchorKey) weekAnchorKey = getSelectedDateKey();
    return weekAnchorKey;
  }

  function setWeekAnchorKey(next) {
    var key = String(next || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return getWeekAnchorKey();
    weekAnchorKey = key;
    return weekAnchorKey;
  }

  function getWeekStartKey() {
    var tm = time();
    if (tm && typeof tm.startOfWeek === "function") return tm.startOfWeek(getWeekAnchorKey());
    return getWeekAnchorKey();
  }

  function getWeekDateKeys() {
    var tm = time();
    if (tm && typeof tm.weekDateKeys === "function") return tm.weekDateKeys(getWeekAnchorKey());
    return [getWeekAnchorKey()];
  }

  function shiftWeek(deltaWeeks) {
    var tm = time();
    if (!tm) return getWeekStartKey();
    return setWeekAnchorKey(tm.addDays(getWeekStartKey(), 7 * Number(deltaWeeks || 0)));
  }

  function goThisWeek() {
    var tm = time();
    if (!tm) return getWeekStartKey();
    return setWeekAnchorKey(tm.todayDateKey());
  }

  function isThisWeek() {
    var tm = time();
    if (!tm || typeof tm.startOfWeek !== "function") return false;
    return getWeekStartKey() === tm.startOfWeek(tm.todayDateKey());
  }

  function pruneWeekProvider() {
    var known = knownProviderIds();
    if (weekProviderId && known.indexOf(weekProviderId) === -1) weekProviderId = "";
    return weekProviderId;
  }

  function getWeekProviderId() {
    return weekProviderId || "";
  }

  function setWeekProviderId(next) {
    weekProviderId = String(next || "").trim();
    return pruneWeekProvider();
  }

  function clearWeekProvider() {
    weekProviderId = "";
    return weekProviderId;
  }

  function getWeekEmployee() {
    if (!weekProviderId) return null;
    var hit = employees.find(function (emp) { return emp && emp.id === weekProviderId; });
    return hit || null;
  }

  function weekNeedsProvider() {
    return isWeek() && !getWeekEmployee();
  }

  function ensureWeekProvider() {
    pruneWeekProvider();
    if (weekProviderId) return weekProviderId;
    var visible = getVisibleEmployees();
    if (visible.length === 1 && visible[0] && visible[0].id) {
      weekProviderId = String(visible[0].id);
    }
    return weekProviderId;
  }

  function setView(next) {
    var target = String(next || "").trim() === VIEW_WEEK ? VIEW_WEEK : VIEW_DAY;
    if (target === VIEW_WEEK) {
      if (!weekAnchorKey) weekAnchorKey = getSelectedDateKey();
      ensureWeekProvider();
    }
    view = target;
    return view;
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

  function uniqueIds(list) {
    var seen = {};
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (value) {
      var id = String(value || "").trim();
      if (!id || seen[id]) return;
      seen[id] = true;
      out.push(id);
    });
    return out;
  }

  function knownProviderIds() {
    return employees.map(function (emp) {
      return emp && emp.id ? String(emp.id) : "";
    }).filter(Boolean);
  }

  function pruneVisibleProviders() {
    var known = knownProviderIds();
    var next = visibleProviderIds.filter(function (id) { return known.indexOf(id) !== -1; });
    if (!next.length || next.length === known.length) {
      visibleProviderIds = [];
      focusProviderId = "";
      return visibleProviderIds;
    }
    visibleProviderIds = next;
    focusProviderId = next.length === 1 ? next[0] : "";
    return visibleProviderIds;
  }

  function setEmployees(list) {
    employees = Array.isArray(list) ? list : [];
    pruneVisibleProviders();
    pruneWeekProvider();
    return employees;
  }

  function getVisibleProviderIds() {
    return visibleProviderIds.slice();
  }

  function setVisibleProviderIds(ids) {
    visibleProviderIds = uniqueIds(ids);
    return pruneVisibleProviders();
  }

  function clearVisibleProviders() {
    visibleProviderIds = [];
    focusProviderId = "";
    return visibleProviderIds;
  }

  function isProviderFilterActive() {
    return visibleProviderIds.length > 0;
  }

  function getFocusProviderId() {
    return focusProviderId || "";
  }

  function setFocusProviderId(next) {
    var id = String(next || "").trim();
    if (!id) return clearVisibleProviders();
    setVisibleProviderIds([id]);
    return focusProviderId;
  }

  function clearFocusProvider() {
    return clearVisibleProviders();
  }

  function getVisibleEmployees() {
    if (!visibleProviderIds.length && !focusProviderId) return employees;
    var allow = {};
    if (visibleProviderIds.length) {
      visibleProviderIds.forEach(function (id) { allow[id] = true; });
    } else if (focusProviderId) {
      allow[focusProviderId] = true;
    }
    var visible = employees.filter(function (emp) { return emp && allow[emp.id]; });
    return visible.length ? visible : employees;
  }

  function getBusinessHours() {
    return businessHours;
  }

  function setBusinessDay(next) {
    businessHours = next && typeof next === "object" ? next : null;
    salonOpen = !!(businessHours && businessHours.isOpen);
    salonStartMin = Number.isFinite(next && next.salonStartMin) ? next.salonStartMin : 9 * 60;
    salonEndMin = Number.isFinite(next && next.salonEndMin) ? next.salonEndMin : 18 * 60;
    salonIntervals = Array.isArray(next && next.intervals) ? next.intervals : [];
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
      salonEndMin: salonEndMin,
      intervals: salonIntervals,
      source: businessHours && businessHours.source ? businessHours.source : "",
      note: businessHours && businessHours.note ? businessHours.note : "",
      dateKey: selectedDateKey || "",
      locationId: locationId || ""
    };
  }

  window.ffBookingCalState = {
    VIEW_DAY: VIEW_DAY,
    VIEW_WEEK: VIEW_WEEK,
    getSelectedDateKey: getSelectedDateKey,
    setSelectedDateKey: setSelectedDateKey,
    goToday: goToday,
    shiftDay: shiftDay,
    isToday: isToday,
    getView: getView,
    setView: setView,
    isWeek: isWeek,
    getWeekAnchorKey: getWeekAnchorKey,
    setWeekAnchorKey: setWeekAnchorKey,
    getWeekStartKey: getWeekStartKey,
    getWeekDateKeys: getWeekDateKeys,
    shiftWeek: shiftWeek,
    goThisWeek: goThisWeek,
    isThisWeek: isThisWeek,
    getWeekProviderId: getWeekProviderId,
    setWeekProviderId: setWeekProviderId,
    clearWeekProvider: clearWeekProvider,
    getWeekEmployee: getWeekEmployee,
    weekNeedsProvider: weekNeedsProvider,
    ensureWeekProvider: ensureWeekProvider,
    getLocationId: getLocationId,
    setLocationId: setLocationId,
    getEmployees: getEmployees,
    setEmployees: setEmployees,
    getVisibleEmployees: getVisibleEmployees,
    getVisibleProviderIds: getVisibleProviderIds,
    setVisibleProviderIds: setVisibleProviderIds,
    clearVisibleProviders: clearVisibleProviders,
    isProviderFilterActive: isProviderFilterActive,
    getFocusProviderId: getFocusProviderId,
    setFocusProviderId: setFocusProviderId,
    clearFocusProvider: clearFocusProvider,
    getBusinessHours: getBusinessHours,
    setBusinessDay: setBusinessDay,
    getAxis: getAxis
  };
})();
