/**
 * Recurring Time Block series + per-date exceptions.
 * Occurrences are generated for the visible date range only — never persisted
 * as one document per future day.
 */
(function () {
  var FREQUENCIES = ["none", "daily", "weekdays", "custom"];
  var FLEX_MODES = ["fixed", "flexible"];
  var WEEKDAY_LABELS = [
    { value: 1, label: "Mon" },
    { value: 2, label: "Tue" },
    { value: 3, label: "Wed" },
    { value: 4, label: "Thu" },
    { value: 5, label: "Fri" },
    { value: 6, label: "Sat" },
    { value: 0, label: "Sun" }
  ];
  var WEEKDAYS = [1, 2, 3, 4, 5];
  var EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var OCCURRENCE_RE = /^series:([^:]+):(\d{4}-\d{2}-\d{2})$/;

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function isDateKey(value) {
    return DATE_RE.test(trim(value));
  }

  function weekdayOf(dateKey) {
    if (!isDateKey(dateKey)) return -1;
    var p = dateKey.split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay();
  }

  function formatDateKey(date) {
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
  }

  function addDays(dateKey, days) {
    if (!isDateKey(dateKey)) return "";
    var p = dateKey.split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + Number(days || 0));
    return formatDateKey(d);
  }

  function previousDateKey(dateKey) {
    return addDays(dateKey, -1);
  }

  function uniqueDays(list) {
    var seen = {};
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (raw) {
      var n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 6 || seen[n]) return;
      seen[n] = true;
      out.push(n);
    });
    return out.sort(function (a, b) { return a - b; });
  }

  function normalizeFrequency(value) {
    var key = trim(value).toLowerCase();
    if (key === "every_day" || key === "every day" || key === "day") key = "daily";
    if (key === "weekday" || key === "week_days") key = "weekdays";
    return FREQUENCIES.indexOf(key) !== -1 ? key : "none";
  }

  function daysForFrequency(frequency, daysOfWeek) {
    var freq = normalizeFrequency(frequency);
    if (freq === "daily") return EVERY_DAY.slice();
    if (freq === "weekdays") return WEEKDAYS.slice();
    if (freq === "custom") {
      var days = uniqueDays(daysOfWeek);
      return days.length ? days : WEEKDAYS.slice();
    }
    return [];
  }

  function normalizeFlexMode(value) {
    var key = trim(value).toLowerCase();
    return key === "flexible" ? "flexible" : "fixed";
  }

  function positiveMin(value, fallback) {
    var n = Number(value);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.round(n);
  }

  function occurrenceId(seriesId, dateKey) {
    var id = trim(seriesId);
    var day = trim(dateKey);
    if (!id || !isDateKey(day)) return "";
    return "series:" + id + ":" + day;
  }

  function parseOccurrenceId(blockId) {
    var m = OCCURRENCE_RE.exec(trim(blockId));
    if (!m) return null;
    return { seriesId: m[1], dateKey: m[2] };
  }

  function isOccurrenceId(blockId) {
    return !!parseOccurrenceId(blockId);
  }

  function exceptionDocId(seriesId, dateKey) {
    var id = trim(seriesId);
    var day = trim(dateKey);
    if (!id || !isDateKey(day)) return "";
    return id + "__" + day;
  }

  function matchesRecurrence(series, dateKey) {
    if (!series || !isDateKey(dateKey)) return false;
    var start = trim(series.startDateKey);
    var end = trim(series.endDateKey);
    if (start && dateKey < start) return false;
    if (end && dateKey > end) return false;
    var freq = normalizeFrequency(series.repeatFrequency || series.frequency);
    if (freq === "none") return dateKey === start;
    var days = daysForFrequency(freq, series.daysOfWeek);
    return days.indexOf(weekdayOf(dateKey)) !== -1;
  }

  function normalizeException(raw) {
    if (!raw || typeof raw !== "object") return null;
    var seriesId = trim(raw.seriesId);
    var dateKey = trim(raw.occurrenceDateKey || raw.dateKey);
    var kind = trim(raw.kind).toLowerCase() === "skip" ? "skip" : "override";
    if (!seriesId || !isDateKey(dateKey)) return null;
    var startMin = Number(raw.startMin);
    var endMin = Number(raw.endMin);
    var row = {
      exceptionId: trim(raw.exceptionId || raw.id) || exceptionDocId(seriesId, dateKey),
      seriesId: seriesId,
      occurrenceDateKey: dateKey,
      kind: kind,
      providerId: trim(raw.providerId),
      reason: trim(raw.reason),
      note: trim(raw.note),
      startMin: Number.isFinite(startMin) ? startMin : null,
      endMin: Number.isFinite(endMin) ? endMin : null
    };
    if (kind === "override" && !(row.endMin > row.startMin)) return null;
    return row;
  }

  function normalizeSeries(raw) {
    if (!raw || typeof raw !== "object") return null;
    var blocks = window.ffBookingBlockModel;
    var providerId = trim(raw.providerId || raw.staffId);
    var locationId = trim(raw.locationId);
    var startDateKey = trim(raw.startDateKey || raw.dateKey);
    var preferredStartMin = Number(raw.preferredStartMin != null ? raw.preferredStartMin : raw.startMin);
    var durationMinutes = Number(raw.durationMinutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      durationMinutes = Number(raw.endMin) - preferredStartMin;
    }
    if (!providerId || !locationId || !isDateKey(startDateKey)) return null;
    if (!Number.isFinite(preferredStartMin) || !(durationMinutes > 0)) return null;
    var frequency = normalizeFrequency(raw.repeatFrequency || (raw.recurrence && raw.recurrence.frequency));
    var daysOfWeek = daysForFrequency(
      frequency,
      raw.daysOfWeek || (raw.recurrence && raw.recurrence.daysOfWeek)
    );
    var endDateKey = trim(raw.endDateKey || (raw.recurrence && raw.recurrence.endDateKey));
    if (endDateKey && !isDateKey(endDateKey)) endDateKey = "";
    if (endDateKey && endDateKey < startDateKey) return null;
    var reason = blocks && typeof blocks.normalizeReason === "function"
      ? blocks.normalizeReason(raw.reason)
      : "other";
    var note = blocks && typeof blocks.displayNote === "function"
      ? blocks.displayNote(raw)
      : trim(raw.note);
    var label = note || (blocks && typeof blocks.labelForReason === "function"
      ? blocks.labelForReason(reason)
      : reason);
    var flexMode = normalizeFlexMode(
      raw.flexibilityMode || (raw.flexibility && raw.flexibility.mode)
    );
    var requiredDurationMinutes = positiveMin(
      raw.requiredDurationMinutes || (raw.flexibility && raw.flexibility.requiredDurationMinutes),
      durationMinutes
    );
    if (requiredDurationMinutes !== durationMinutes) requiredDurationMinutes = durationMinutes;
    var preferredEnd = preferredStartMin + durationMinutes;
    var earliestStartMin = positiveMin(
      raw.earliestStartMin != null ? raw.earliestStartMin : (raw.flexibility && raw.flexibility.earliestStartMin),
      preferredStartMin
    );
    var latestEndMin = positiveMin(
      raw.latestEndMin != null ? raw.latestEndMin : (raw.flexibility && raw.flexibility.latestEndMin),
      preferredEnd
    );
    if (flexMode === "flexible") {
      if (latestEndMin - earliestStartMin < durationMinutes) return null;
      if (preferredStartMin < earliestStartMin || preferredEnd > latestEndMin) return null;
    } else {
      earliestStartMin = preferredStartMin;
      latestEndMin = preferredEnd;
    }
    return {
      seriesId: trim(raw.seriesId || raw.id),
      providerId: providerId,
      locationId: locationId,
      reason: reason,
      note: note,
      label: label,
      preferredStartMin: preferredStartMin,
      durationMinutes: durationMinutes,
      repeatFrequency: frequency,
      daysOfWeek: daysOfWeek,
      startDateKey: startDateKey,
      endDateKey: endDateKey,
      flexibilityMode: flexMode,
      earliestStartMin: earliestStartMin,
      latestEndMin: latestEndMin,
      requiredDurationMinutes: requiredDurationMinutes,
      createdByUid: trim(raw.createdByUid),
      createdByStaffId: trim(raw.createdByStaffId),
      createdAt: raw.createdAt || null,
      updatedAt: raw.updatedAt || null
    };
  }

  function fromSeriesDoc(id, data) {
    return normalizeSeries(Object.assign({ seriesId: id, id: id }, data || {}));
  }

  function occurrenceFrom(series, dateKey, exception) {
    var row = series && typeof series === "object" ? series : normalizeSeries(series);
    if (!row || !isDateKey(dateKey) || !matchesRecurrence(row, dateKey)) return null;
    var ex = exception && exception.kind ? exception : normalizeException(exception);
    if (ex && ex.kind === "skip") return null;
    var startMin = row.preferredStartMin;
    var endMin = startMin + row.durationMinutes;
    var providerId = row.providerId;
    var reason = row.reason;
    var note = row.note;
    var isOverride = false;
    if (ex && ex.kind === "override") {
      isOverride = true;
      if (Number.isFinite(ex.startMin) && Number.isFinite(ex.endMin) && ex.endMin > ex.startMin) {
        startMin = ex.startMin;
        endMin = ex.endMin;
      }
      if (ex.providerId) providerId = ex.providerId;
      if (ex.reason) reason = ex.reason;
      if (ex.note != null && String(ex.note)) note = trim(ex.note);
    }
    var duration = endMin - startMin;
    if (duration !== row.requiredDurationMinutes && duration !== row.durationMinutes) {
      endMin = startMin + row.durationMinutes;
      duration = row.durationMinutes;
    }
    var label = note || (window.ffBookingBlockModel && window.ffBookingBlockModel.labelForReason
      ? window.ffBookingBlockModel.labelForReason(reason)
      : row.label);
    return {
      blockId: occurrenceId(row.seriesId, dateKey),
      seriesId: row.seriesId,
      occurrenceDateKey: dateKey,
      isOccurrence: true,
      isOverride: isOverride,
      providerId: providerId,
      locationId: row.locationId,
      dateKey: dateKey,
      startMin: startMin,
      endMin: endMin,
      actualStartMin: startMin,
      actualEndMin: endMin,
      preferredStartMin: row.preferredStartMin,
      durationMinutes: duration,
      reason: reason,
      note: note,
      label: label,
      flexibilityMode: row.flexibilityMode,
      earliestStartMin: row.earliestStartMin,
      latestEndMin: row.latestEndMin,
      requiredDurationMinutes: row.requiredDurationMinutes,
      repeatFrequency: row.repeatFrequency,
      daysOfWeek: row.daysOfWeek.slice(),
      startDateKey: row.startDateKey,
      endDateKey: row.endDateKey,
      movedFromPreferred: startMin !== row.preferredStartMin
    };
  }

  function exceptionsByDate(list) {
    var map = {};
    (Array.isArray(list) ? list : []).forEach(function (raw) {
      var row = normalizeException(raw);
      if (!row) return;
      var key = row.seriesId + ":" + row.occurrenceDateKey;
      map[key] = row;
    });
    return map;
  }

  function generateOccurrences(seriesList, dateKeys, exceptionList) {
    var days = (Array.isArray(dateKeys) ? dateKeys : []).map(trim).filter(isDateKey);
    var seen = {};
    var out = [];
    var exMap = exceptionsByDate(exceptionList);
    (Array.isArray(seriesList) ? seriesList : []).forEach(function (raw) {
      var series = normalizeSeries(raw);
      if (!series || !series.seriesId || series.repeatFrequency === "none") return;
      days.forEach(function (dateKey) {
        var occ = occurrenceFrom(series, dateKey, exMap[series.seriesId + ":" + dateKey]);
        if (!occ || seen[occ.blockId]) return;
        seen[occ.blockId] = true;
        out.push(occ);
      });
    });
    return out;
  }

  window.ffBookingBlockSeriesModel = {
    FREQUENCIES: FREQUENCIES,
    FLEX_MODES: FLEX_MODES,
    WEEKDAY_LABELS: WEEKDAY_LABELS,
    WEEKDAYS: WEEKDAYS,
    EVERY_DAY: EVERY_DAY,
    normalizeFrequency: normalizeFrequency,
    normalizeFlexMode: normalizeFlexMode,
    daysForFrequency: daysForFrequency,
    weekdayOf: weekdayOf,
    addDays: addDays,
    previousDateKey: previousDateKey,
    isDateKey: isDateKey,
    occurrenceId: occurrenceId,
    parseOccurrenceId: parseOccurrenceId,
    isOccurrenceId: isOccurrenceId,
    exceptionDocId: exceptionDocId,
    matchesRecurrence: matchesRecurrence,
    normalizeException: normalizeException,
    normalizeSeries: normalizeSeries,
    fromSeriesDoc: fromSeriesDoc,
    occurrenceFrom: occurrenceFrom,
    generateOccurrences: generateOccurrences
  };
})();
