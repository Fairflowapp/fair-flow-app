(function () {
  "use strict";

  function readTimeFormatPreference() {
    try {
      var pref = window.settings && window.settings.preferences && window.settings.preferences.timeFormat;
      if (pref === "24h" || pref === "24hour" || pref === 24) return "24h";
      if (pref === "12h" || pref === "12hour" || pref === 12) return "12h";
    } catch (_) {}

    try {
      var email = "";
      if (typeof window.ffGetCurrentUserInfo === "function") {
        var userInfo = window.ffGetCurrentUserInfo() || {};
        email = userInfo.email || "";
      }
      if (!email && window.firebaseAuth && window.firebaseAuth.currentUser) {
        email = window.firebaseAuth.currentUser.email || "";
      }
      var key = "ff_profile_prefs_v1::" + (email || "default");
      var raw = localStorage.getItem(key);
      if (raw) {
        var parsed = JSON.parse(raw);
        var stored = parsed && parsed.preferences && parsed.preferences.timeFormat;
        if (stored === "24h" || stored === "24hour" || stored === 24) return "24h";
        if (stored === "12h" || stored === "12hour" || stored === 12) return "12h";
      }
    } catch (_) {}

    return "12h";
  }

  function hhmmParts(value) {
    var raw = String(value == null ? "" : value).trim();
    var match = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    var hour = Number(match[1]);
    var minute = Number(match[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return { hour: hour, minute: minute, raw: raw };
  }

  function formatFromParts(parts, format, opts) {
    if (!parts) return "";
    var minute = String(parts.minute).padStart(2, "0");
    if (format === "24h") {
      return String(parts.hour).padStart(2, "0") + ":" + minute;
    }
    var suffix = parts.hour < 12 ? "AM" : "PM";
    var hour12 = parts.hour % 12;
    if (hour12 === 0) hour12 = 12;
    var compact = opts && opts.compact === true;
    var minutePart = compact && parts.minute === 0 ? "" : ":" + minute;
    return String(hour12) + minutePart + " " + suffix;
  }

  function dateFromValue(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
    if (typeof value.toDate === "function") {
      var fromTs = value.toDate();
      return fromTs instanceof Date && Number.isFinite(fromTs.getTime()) ? fromTs : null;
    }
    if (typeof value === "number" || typeof value === "string") {
      var d = new Date(value);
      return Number.isFinite(d.getTime()) ? d : null;
    }
    return null;
  }

  function ffFormatDisplayTime(value, options) {
    var opts = options || {};
    var fallback = opts.fallback != null ? String(opts.fallback) : String(value == null ? "" : value).trim();
    var format = opts.timeFormat === "24h" || opts.timeFormat === "12h"
      ? opts.timeFormat
      : readTimeFormatPreference();

    var parts = hhmmParts(value);
    if (parts) return formatFromParts(parts, format, opts);

    var d = dateFromValue(value);
    if (d) {
      try {
        return d.toLocaleTimeString("en-US", {
          hour: opts.hour || "numeric",
          minute: opts.minute || "2-digit",
          hour12: format !== "24h",
        });
      } catch (_) {}
    }

    return fallback;
  }

  function ffFormatDisplayTimeRange(start, end, options) {
    var opts = options || {};
    var startFallback = start == null ? "" : String(start).trim();
    var endFallback = end == null ? "" : String(end).trim();
    var s = ffFormatDisplayTime(start, Object.assign({}, opts, { fallback: startFallback }));
    var e = ffFormatDisplayTime(end, Object.assign({}, opts, { fallback: endFallback }));
    if (!s && !e) return "";
    if (!s) return e;
    if (!e) return s;
    return s + (opts.separator || " - ") + e;
  }

  window.ffGetDisplayTimeFormat = readTimeFormatPreference;
  window.ffFormatDisplayTime = ffFormatDisplayTime;
  window.ffFormatDisplayTimeRange = ffFormatDisplayTimeRange;
})();
