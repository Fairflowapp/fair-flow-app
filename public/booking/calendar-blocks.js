/**
 * Calendar Block Time cache and paint.
 * Persistence lives in ffBookingBlocks (salons/{salonId}/calendarBlocks).
 * A block is a one-off provider range on one location/date.
 */
(function () {
  var REASONS = ["lunch", "break", "meeting", "training", "personal", "other"];
  var LABELS = {
    lunch: "Lunch Break",
    break: "Break",
    meeting: "Meeting",
    training: "Training",
    personal: "Personal",
    other: "Other"
  };
  var REASON_LABELS = {
    lunch: true,
    "lunch break": true,
    break: true,
    meeting: true,
    training: true,
    personal: true,
    other: true,
    "block time": true,
    "time block": true,
    blocked: true,
    unavailable: true,
    "time off": true
  };
  var items = [];
  var writeGen = 0;
  var pendingIds = {};
  var tombstones = {};

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function collapse(value) {
    return trim(value).replace(/\s+/g, " ");
  }

  function labelForReason(reason) {
    if (window.ffBookingBlockModel && typeof window.ffBookingBlockModel.labelForReason === "function") {
      return window.ffBookingBlockModel.labelForReason(reason);
    }
    return LABELS[reason] || LABELS.other;
  }

  function isReasonLabel(value) {
    if (window.ffBookingBlockModel && typeof window.ffBookingBlockModel.isReasonLabel === "function") {
      return window.ffBookingBlockModel.isReasonLabel(value);
    }
    var key = collapse(value).toLowerCase();
    return !!(key && REASON_LABELS[key]);
  }

  function displayNote(raw) {
    if (window.ffBookingBlockModel && typeof window.ffBookingBlockModel.displayNote === "function") {
      return window.ffBookingBlockModel.displayNote(raw);
    }
    if (!raw || typeof raw !== "object") return collapse(raw);
    var note = collapse(raw.note);
    if (note) return note;
    var legacy = collapse(raw.label);
    if (legacy && !isReasonLabel(legacy)) return legacy;
    return "";
  }

  function formatMinutes(total) {
    if (window.ffBookingBlockModel && typeof window.ffBookingBlockModel.formatMinutes === "function") {
      return window.ffBookingBlockModel.formatMinutes(total);
    }
    var m = ((Number(total) % 1440) + 1440) % 1440;
    if (!Number.isFinite(Number(total))) return "";
    var hour = Math.floor(m / 60);
    var min = m % 60;
    var suffix = hour >= 12 ? "PM" : "AM";
    var hour12 = hour % 12;
    if (hour12 === 0) hour12 = 12;
    return hour12 + ":" + String(min).padStart(2, "0") + " " + suffix;
  }

  function formatTimeRange(startMin, endMin) {
    if (window.ffBookingBlockModel && typeof window.ffBookingBlockModel.formatTimeRange === "function") {
      return window.ffBookingBlockModel.formatTimeRange(startMin, endMin);
    }
    var start = formatMinutes(startMin);
    var end = formatMinutes(endMin);
    if (!start || !end) return "";
    return start + " – " + end;
  }

  function cardLines(block) {
    if (window.ffBookingBlockModel && typeof window.ffBookingBlockModel.cardLines === "function") {
      return window.ffBookingBlockModel.cardLines(block);
    }
    if (!block) return { reason: "", time: "", note: "" };
    return {
      reason: labelForReason(block.reason),
      time: formatTimeRange(block.startMin, block.endMin),
      note: displayNote(block)
    };
  }

  function normalizeReason(value) {
    if (window.ffBookingBlockModel && typeof window.ffBookingBlockModel.normalizeReason === "function") {
      return window.ffBookingBlockModel.normalizeReason(value);
    }
    var key = trim(value).toLowerCase().replace(/\s+/g, "_");
    if (key === "lunch_break" || key === "lunchbreak") key = "lunch";
    if (key === "time_off" || key === "block" || key === "blocked" || key === "unavailable") key = "other";
    return REASONS.indexOf(key) !== -1 ? key : "other";
  }

  function normalize(raw) {
    if (window.ffBookingBlockModel && typeof window.ffBookingBlockModel.normalize === "function") {
      var row = window.ffBookingBlockModel.normalize(raw);
      if (!row) return null;
      if (!row.blockId) {
        row.blockId = "blk_" + row.providerId + "_" + row.dateKey + "_" + row.startMin + "_" + row.endMin;
      }
      return row;
    }
    if (!raw || typeof raw !== "object") return null;
    var providerId = trim(raw.providerId || raw.staffId);
    var locationId = trim(raw.locationId);
    var dateKey = trim(raw.dateKey);
    var startMin = Number(raw.startMin);
    var endMin = Number(raw.endMin);
    if (!providerId || !locationId || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || !(endMin > startMin)) return null;
    var reason = normalizeReason(raw.reason || raw.kind || raw.type);
    var note = displayNote(raw);
    var label = note || labelForReason(reason);
    return {
      blockId: trim(raw.blockId || raw.id) || ("blk_" + providerId + "_" + dateKey + "_" + startMin + "_" + endMin),
      providerId: providerId,
      locationId: locationId,
      dateKey: dateKey,
      startMin: startMin,
      endMin: endMin,
      reason: reason,
      label: label,
      note: note
    };
  }

  function noteLocalWrite(blockId, kind) {
    writeGen += 1;
    var id = trim(blockId);
    if (!id) return writeGen;
    if (kind === "delete") {
      delete pendingIds[id];
      tombstones[id] = writeGen;
    } else {
      pendingIds[id] = writeGen;
      delete tombstones[id];
    }
    return writeGen;
  }

  function beginLoad() {
    return writeGen;
  }

  function applyLoaded(list, startedWriteGen) {
    var started = Number(startedWriteGen);
    if (!Number.isFinite(started)) started = writeGen;
    var incoming = (Array.isArray(list) ? list : []).map(normalize).filter(Boolean).filter(function (row) {
      var cut = tombstones[row.blockId];
      return !cut || cut <= started;
    });
    incoming.forEach(function (row) {
      delete pendingIds[row.blockId];
    });
    Object.keys(pendingIds).forEach(function (id) {
      if (incoming.some(function (row) { return row.blockId === id; })) return;
      var row = items.find(function (item) { return item.blockId === id; });
      if (row) incoming.push(row);
    });
    items = incoming;
    return items.slice();
  }

  function setAll(list) {
    items = (Array.isArray(list) ? list : []).map(normalize).filter(Boolean);
    return items.slice();
  }

  function getAll() {
    return items.slice();
  }

  function clear() {
    items = [];
    writeGen = 0;
    pendingIds = {};
    tombstones = {};
    return items;
  }

  function upsert(raw) {
    var row = normalize(raw);
    if (!row) return null;
    noteLocalWrite(row.blockId, "upsert");
    items = items.filter(function (item) { return item.blockId !== row.blockId; }).concat([row]);
    return row;
  }

  function remove(blockId) {
    var id = trim(blockId);
    noteLocalWrite(id, "delete");
    items = items.filter(function (item) { return item.blockId !== id; });
    return items.slice();
  }

  function getById(blockId) {
    var id = trim(blockId);
    return items.find(function (item) { return item.blockId === id; }) || null;
  }

  function forView(dateKey, locationId) {
    var day = trim(dateKey);
    var loc = trim(locationId);
    return items.filter(function (row) {
      if (row.dateKey !== day) return false;
      if (!loc) return true;
      return row.locationId === loc;
    });
  }

  function forProvider(dateKey, locationId, providerId) {
    var id = trim(providerId);
    return forView(dateKey, locationId).filter(function (row) {
      return row.providerId === id;
    });
  }

  function windowsForProvider(dateKey, locationId, providerId) {
    return forProvider(dateKey, locationId, providerId).map(function (row) {
      return {
        startMin: row.startMin,
        endMin: row.endMin,
        label: row.label,
        reason: row.reason,
        blockId: row.blockId
      };
    });
  }

  function rangeOverlaps(startMin, endMin, otherStart, otherEnd) {
    return Number(startMin) < Number(otherEnd) && Number(endMin) > Number(otherStart);
  }

  function overlaps(dateKey, locationId, providerId, startMin, endMin, excludeId) {
    var start = Number(startMin);
    var end = Number(endMin);
    var skip = trim(excludeId);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return false;
    return forProvider(dateKey, locationId, providerId).some(function (row) {
      if (skip && row.blockId === skip) return false;
      return rangeOverlaps(start, end, row.startMin, row.endMin);
    });
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cardTitle(block) {
    var lines = cardLines(block);
    var parts = [lines.reason, lines.time];
    if (lines.note) parts.push(lines.note);
    return parts.filter(Boolean).join(" · ");
  }

  function blockDensityClass(startMin, endMin) {
    var n = Number(endMin) - Number(startMin);
    if (n > 0 && n <= 15) return " is-tight";
    if (n > 0 && n <= 30) return " is-compact";
    return "";
  }

  function blockHtml(block, rect) {
    if (!block || !rect) return "";
    var lines = cardLines(block);
    var duration = Math.max(15, Number(block.endMin) - Number(block.startMin));
    var noteAttr = lines.note ? ' data-ff-cal-block-note="' + escapeHtml(lines.note) + '"' : "";
    var noteHtml = lines.note
      ? '<span class="ff-cal-block-note">' + escapeHtml(lines.note) + "</span>"
      : "";
    var moved = !!(block.movedFromPreferred && Number.isFinite(Number(block.preferredStartMin))
      && Number(block.startMin) !== Number(block.preferredStartMin));
    var movedHtml = moved
      ? '<span class="ff-cal-block-moved">Moved from ' + escapeHtml(formatMinutes(block.preferredStartMin)) + "</span>"
      : "";
    var seriesAttr = block.seriesId
      ? ' data-ff-cal-block-series="' + escapeHtml(block.seriesId) + '"'
      : "";
    var flexAttr = block.flexibilityMode
      ? ' data-ff-cal-block-flex="' + escapeHtml(block.flexibilityMode) + '"'
      : "";
    var title = cardTitle(block);
    if (moved) title = title + " · Moved from " + formatMinutes(block.preferredStartMin);
    return '<div class="ff-cal-block' + blockDensityClass(block.startMin, block.endMin) +
      (moved ? " is-moved" : "") +
      '" data-ff-cal-block="' + escapeHtml(block.blockId) +
      '" data-ff-cal-block-reason="' + escapeHtml(block.reason) +
      '" data-ff-cal-start="' + Number(block.startMin) +
      '" data-ff-cal-end="' + Number(block.endMin) +
      '" data-ff-cal-duration="' + duration +
      '" data-ff-cal-block-provider="' + escapeHtml(block.providerId) +
      '" data-ff-cal-block-date="' + escapeHtml(block.dateKey) + '"' +
      seriesAttr + flexAttr +
      noteAttr +
      ' title="' + escapeHtml(title) +
      '" style="top:' + rect.top + "px;height:" + Math.max(rect.height, 16) + 'px">' +
      '<span class="ff-cal-block-reason">' + escapeHtml(lines.reason) + "</span>" +
      '<span class="ff-cal-block-time">' + escapeHtml(lines.time) + "</span>" +
      noteHtml +
      movedHtml +
      "</div>";
  }

  function clearPaint(root) {
    if (!root) return;
    root.querySelectorAll("[data-ff-cal-block]").forEach(function (el) { el.remove(); });
  }

  function paint(root) {
    root = root || (typeof document !== "undefined" ? document.getElementById("ffBookingCalendarRoot") : null);
    var st = window.ffBookingCalState;
    var lay = window.ffBookingCalLayout;
    if (!root || !st || !lay) return;
    clearPaint(root);
    var locationId = st.getLocationId();
    if (st.isWeek && st.isWeek()) {
      var weekAxis = window.ffBookingCalWeek && typeof window.ffBookingCalWeek.sharedAxis === "function"
        ? window.ffBookingCalWeek.sharedAxis()
        : st.getAxis();
      var weekProviderId = st.getWeekProviderId ? st.getWeekProviderId() : "";
      (st.getWeekDateKeys ? st.getWeekDateKeys() : []).forEach(function (dateKey) {
        var col = root.querySelector('[data-ff-cal-day="' + dateKey + '"]');
        if (!col) return;
        forProvider(dateKey, locationId, weekProviderId).forEach(function (block) {
          var rect = lay.windowToRect(block.startMin, block.endMin, weekAxis.startMin, weekAxis.endMin);
          if (!rect) return;
          col.insertAdjacentHTML("beforeend", blockHtml(block, rect));
        });
      });
      return;
    }
    var axis = st.getAxis();
    var dateKey = st.getSelectedDateKey();
    forView(dateKey, locationId).forEach(function (block) {
      var col = root.querySelector('[data-ff-cal-emp="' + block.providerId + '"]');
      if (!col) return;
      var rect = lay.windowToRect(block.startMin, block.endMin, axis.startMin, axis.endMin);
      if (!rect) return;
      col.insertAdjacentHTML("beforeend", blockHtml(block, rect));
    });
  }

  window.ffBookingCalBlocks = {
    REASONS: REASONS,
    normalize: normalize,
    setAll: setAll,
    applyLoaded: applyLoaded,
    beginLoad: beginLoad,
    noteLocalWrite: noteLocalWrite,
    getAll: getAll,
    clear: clear,
    upsert: upsert,
    remove: remove,
    getById: getById,
    forView: forView,
    forProvider: forProvider,
    windowsForProvider: windowsForProvider,
    overlaps: overlaps,
    rangeOverlaps: rangeOverlaps,
    labelForReason: labelForReason,
    displayNote: displayNote,
    formatMinutes: formatMinutes,
    formatTimeRange: formatTimeRange,
    cardLines: cardLines,
    blockDensityClass: blockDensityClass,
    blockHtml: blockHtml,
    paint: paint,
    clearPaint: clearPaint
  };
})();
