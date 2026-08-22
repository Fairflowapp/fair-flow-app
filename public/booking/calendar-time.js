/**
 * Booking Calendar timezone + civil-date helpers.
 * All Calendar date/time reads go through here — do not scatter new Date()
 * assumptions in render code.
 *
 * Timezone source: settings.preferences.salonTimeZone when valid IANA,
 * otherwise the browser zone. Isolated so a later location-level zone
 * can replace this without touching the grid.
 */
(function () {
  var FALLBACK_ZONE = "America/New_York";
  var WEEKDAY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function isValidTimeZone(zone) {
    if (!zone) return false;
    try {
      Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
      return true;
    } catch (_) {
      return false;
    }
  }

  function getTimeZone() {
    try {
      var raw = window.settings && window.settings.preferences && window.settings.preferences.salonTimeZone;
      var zone = String(raw || "").trim();
      if (isValidTimeZone(zone)) return zone;
    } catch (_) {}
    try {
      var browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (isValidTimeZone(browser)) return browser;
    } catch (_) {}
    return FALLBACK_ZONE;
  }

  function zonedParts(date, timeZone) {
    var fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || getTimeZone(),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
    var map = {};
    fmt.formatToParts(date).forEach(function (part) {
      if (part.type !== "literal") map[part.type] = part.value;
    });
    return map;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function todayDateKey() {
    var p = zonedParts(new Date(), getTimeZone());
    return p.year + "-" + p.month + "-" + p.day;
  }

  function parseDateKey(dateKey) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || "").trim());
    if (!m) return null;
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }

  function addDays(dateKey, delta) {
    var p = parseDateKey(dateKey) || parseDateKey(todayDateKey());
    var utc = new Date(Date.UTC(p.y, p.m - 1, p.d + Number(delta || 0)));
    return utc.getUTCFullYear() + "-" + pad2(utc.getUTCMonth() + 1) + "-" + pad2(utc.getUTCDate());
  }

  function weekdayKey(dateKey) {
    var p = parseDateKey(dateKey);
    if (!p) return "monday";
    var utc = new Date(Date.UTC(p.y, p.m - 1, p.d, 12, 0, 0));
    return WEEKDAY[utc.getUTCDay()] || "monday";
  }

  function formatDisplayDate(dateKey) {
    var p = parseDateKey(dateKey);
    if (!p) return "";
    var utc = new Date(Date.UTC(p.y, p.m - 1, p.d, 12, 0, 0));
    return WEEKDAYS_LONG[utc.getUTCDay()] + ", " + MONTHS[utc.getUTCMonth()] + " " + p.d + ", " + p.y;
  }

  function nowMinutes() {
    var p = zonedParts(new Date(), getTimeZone());
    return Number(p.hour) * 60 + Number(p.minute);
  }

  function formatHourLabel(totalMinutes) {
    var h = Math.floor(totalMinutes / 60) % 24;
    var suffix = h >= 12 ? "PM" : "AM";
    var hour12 = h % 12;
    if (hour12 === 0) hour12 = 12;
    return hour12 + " " + suffix;
  }

  window.ffBookingTime = {
    getTimeZone: getTimeZone,
    todayDateKey: todayDateKey,
    addDays: addDays,
    weekdayKey: weekdayKey,
    formatDisplayDate: formatDisplayDate,
    nowMinutes: nowMinutes,
    formatHourLabel: formatHourLabel,
    parseDateKey: parseDateKey
  };
})();
