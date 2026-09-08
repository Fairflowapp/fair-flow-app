/**
 * In-progress visit hold on the Calendar. Not a saved appointment card.
 * One temporary block per service line.
 */
(function () {
  var draft = null;

  function layout() { return window.ffBookingCalLayout || null; }
  function calState() { return window.ffBookingCalState || null; }

  function formatTime(min) {
    var h = Math.floor(((Number(min) % 1440) + 1440) % 1440 / 60);
    var m = ((Number(min) % 1440) + 1440) % 1440 % 60;
    var suffix = h >= 12 ? "PM" : "AM";
    var hour12 = h % 12;
    if (hour12 === 0) hour12 = 12;
    return hour12 + ":" + String(m).padStart(2, "0") + " " + suffix;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function holdLabel(spec) {
    var clock = formatTime(spec && spec.startMin);
    return clock ? "Hold · " + clock : "Hold";
  }

  function rangeLabel(spec) {
    var start = formatTime(spec && spec.startMin);
    var duration = Number(spec && spec.durationMinutes) > 0 ? Number(spec.durationMinutes) : 30;
    var end = formatTime(spec && spec.startMin + duration);
    if (!start || !end) return "";
    return start + " – " + end;
  }

  function bodyHtml(spec) {
    if (!spec) return "";
    var client = String(spec.clientName || "").trim();
    var service = String(spec.title || spec.serviceName || "").trim();
    var lines = [];
    if (client) {
      lines.push('<span class="ff-cal-hold-name">' + escapeHtml(client) + "</span>");
    }
    if (service) {
      lines.push('<span class="' + (client ? "ff-cal-hold-svc" : "ff-cal-hold-name") + '">' + escapeHtml(service) + "</span>");
      var range = rangeLabel(spec);
      if (range) lines.push('<span class="ff-cal-hold-time">' + escapeHtml(range) + "</span>");
    } else {
      lines.push('<span class="ff-cal-hold-meta">' + escapeHtml(holdLabel(spec)) + "</span>");
    }
    return lines.join("");
  }

  function normalizeLines(spec) {
    if (!spec) return [];
    var clientName = spec.clientName ? String(spec.clientName) : "";
    var raw = Array.isArray(spec.lines) && spec.lines.length
      ? spec.lines
      : (spec.providerId && Number.isFinite(Number(spec.startMin)) ? [spec] : []);
    return raw.filter(function (line) {
      return line && line.providerId && Number.isFinite(Number(line.startMin));
    }).map(function (line) {
      return {
        lineKey: line.lineKey || line.key ? String(line.lineKey || line.key) : "",
        providerId: String(line.providerId),
        startMin: Number(line.startMin),
        durationMinutes: Number(line.durationMinutes) > 0 ? Number(line.durationMinutes) : 30,
        title: line.title || line.serviceName ? String(line.title || line.serviceName) : "",
        clientName: line.clientName ? String(line.clientName) : clientName,
        guestKey: line.guestKey ? String(line.guestKey) : ""
      };
    });
  }

  function clearDom(root) {
    if (!root) return;
    root.querySelectorAll("[data-ff-cal-hold]").forEach(function (el) { el.remove(); });
  }

  function findCol(root, providerId) {
    var id = String(providerId || "");
    if (!root || !id) return null;
    var cols = root.querySelectorAll("[data-ff-cal-emp]");
    for (var i = 0; i < cols.length; i += 1) {
      if (cols[i].getAttribute("data-ff-cal-emp") === id) return cols[i];
    }
    return null;
  }

  function draftPartySize(lines) {
    var model = window.ffBookingAppointmentModel;
    var rows = (lines || []).map(function (line) {
      var start = Number(line && line.startMin);
      var duration = Number(line && line.durationMinutes) > 0 ? Number(line.durationMinutes) : 30;
      return { start: start, end: start + duration };
    });
    if (model && typeof model.partySizeForVisit === "function") {
      return model.partySizeForVisit(lines);
    }
    if (model && typeof model.partySizeFromIntervals === "function") {
      return model.partySizeFromIntervals(rows);
    }
    return 1;
  }

  function applyBoardBox(el, item) {
    if (!el) return;
    el.style.left = (item && item.left) || "4px";
    el.style.width = (item && item.width) || "calc(100% - 10px)";
    el.style.right = "auto";
    el.style.zIndex = String(5 + ((item && item.lane) || 0));
  }

  function paintLine(root, axis, lay, line, partySize, item) {
    var col = findCol(root, line.providerId);
    if (!col) return;
    var rect = lay.windowToRect(line.startMin, line.startMin + line.durationMinutes, axis.startMin, axis.endMin);
    if (!rect) return;
    var density = "";
    if (line.durationMinutes > 0 && line.durationMinutes <= 15) density = " is-tiny";
    else if (line.durationMinutes > 0 && line.durationMinutes <= 30) density = " is-compact";
    var el = document.createElement("div");
    el.className = "ff-cal-hold" + density;
    el.setAttribute("data-ff-cal-hold", "");
    el.setAttribute("data-ff-cal-hold-provider", line.providerId);
    if (line.lineKey) el.setAttribute("data-ff-cal-hold-line", line.lineKey);
    el.setAttribute("data-ff-cal-start", String(line.startMin));
    el.setAttribute("data-ff-cal-duration", String(line.durationMinutes));
    el.style.top = rect.top + "px";
    el.style.height = Math.max(rect.height, 28) + "px";
    applyBoardBox(el, item);
    var badge = Number(partySize) > 1
      ? '<span class="ff-cal-card-party">' + escapeHtml(String(partySize) + " people") + "</span>"
      : "";
    el.innerHTML = badge + bodyHtml(line);
    col.appendChild(el);
  }

  function paintFromBoard(root, built) {
    root = root || (typeof document !== "undefined" && document && document.getElementById
      ? document.getElementById("ffBookingCalendarRoot")
      : null);
    clearDom(root);
    if (!root || !draft || !draft.lines || !draft.lines.length) return;
    var st = calState();
    var lay = layout();
    if (!st || !lay) return;
    if (st.getSelectedDateKey() !== draft.dateKey) return;
    var axis = st.getAxis();
    if (!axis) return;
    var partySize = draftPartySize(draft.lines);
    var items = (built && built.items) || [];
    draft.lines.forEach(function (line) {
      var item = items.find(function (row) {
        if (row.kind !== "hold") return false;
        if (row.providerId !== String(line.providerId)) return false;
        if (row.startMin !== Number(line.startMin)) return false;
        if (!line.lineKey) return true;
        return row.lineId === String(line.lineKey) || row.key === "hold:" + String(line.lineKey);
      }) || items.find(function (row) {
        return row.kind === "hold"
          && row.providerId === String(line.providerId)
          && row.startMin === Number(line.startMin);
      }) || null;
      paintLine(root, axis, lay, line, partySize, item);
    });
  }

  function sync(root) {
    var render = window.ffBookingCalCardRender;
    if (render && typeof render.paint === "function" && !window.__ffPaintingBoard) {
      render.paint(root);
      return;
    }
    paintFromBoard(root, null);
  }

  function set(spec) {
    var lines = normalizeLines(spec);
    var dateKey = spec && spec.dateKey ? String(spec.dateKey) : "";
    if (!dateKey || !lines.length) {
      draft = null;
      sync();
      return;
    }
    draft = {
      dateKey: dateKey,
      clientName: spec.clientName ? String(spec.clientName) : "",
      lines: lines
    };
    sync();
  }

  function clear() {
    draft = null;
    sync();
  }

  function snapshot() {
    if (!draft) return null;
    var first = draft.lines[0] || {};
    return {
      providerId: first.providerId,
      dateKey: draft.dateKey,
      startMin: first.startMin,
      durationMinutes: first.durationMinutes,
      title: first.title,
      clientName: draft.clientName,
      lines: draft.lines.slice()
    };
  }

  window.ffBookingCalDraft = {
    set: set,
    clear: clear,
    sync: sync,
    get: snapshot,
    paintFromBoard: paintFromBoard,
    bodyHtml: bodyHtml,
    formatTime: formatTime
  };
})();
