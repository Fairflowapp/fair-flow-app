/**
 * Calendar Block Time cache and paint.
 * Persistence lives in ffBookingBlocks (salons/{salonId}/calendarBlocks).
 * A block is a one-off provider range on one location/date.
 */
(function () {
  var REASONS = ["lunch", "break", "meeting", "training", "personal", "other"];
  var LABELS = {
    lunch: "Lunch",
    break: "Break",
    meeting: "Meeting",
    training: "Training",
    personal: "Personal",
    other: "Other"
  };
  var items = [];

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function collapse(value) {
    return trim(value).replace(/\s+/g, " ");
  }

  function labelForReason(reason) {
    return LABELS[reason] || LABELS.other;
  }

  function normalizeReason(value) {
    if (window.ffBookingBlockModel && typeof window.ffBookingBlockModel.normalizeReason === "function") {
      return window.ffBookingBlockModel.normalizeReason(value);
    }
    var key = trim(value).toLowerCase().replace(/\s+/g, "_");
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
    var note = collapse(raw.note);
    var label = note || labelForReason(reason);
    return {
      blockId: trim(raw.blockId || raw.id) || ("blk_" + providerId + "_" + dateKey + "_" + startMin + "_" + endMin),
      providerId: providerId,
      locationId: locationId,
      dateKey: dateKey,
      startMin: startMin,
      endMin: endMin,
      reason: reason,
      label: label
    };
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
    return items;
  }

  function upsert(raw) {
    var row = normalize(raw);
    if (!row) return null;
    items = items.filter(function (item) { return item.blockId !== row.blockId; }).concat([row]);
    return row;
  }

  function remove(blockId) {
    var id = trim(blockId);
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
      return row.dateKey === day && row.locationId === loc;
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

  function blockHtml(block, rect) {
    if (!block || !rect) return "";
    return '<div class="ff-cal-block" data-ff-cal-block="' + escapeHtml(block.blockId) +
      '" data-ff-cal-block-reason="' + escapeHtml(block.reason) +
      '" title="' + escapeHtml(block.label) +
      '" style="top:' + rect.top + "px;height:" + Math.max(rect.height, 16) + 'px">' +
      '<span class="ff-cal-block-label">' + escapeHtml(block.label) + "</span></div>";
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
    blockHtml: blockHtml,
    paint: paint,
    clearPaint: clearPaint
  };
})();
