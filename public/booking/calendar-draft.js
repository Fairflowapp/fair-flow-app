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
        providerId: String(line.providerId),
        startMin: Number(line.startMin),
        durationMinutes: Number(line.durationMinutes) > 0 ? Number(line.durationMinutes) : 30,
        title: line.title || line.serviceName ? String(line.title || line.serviceName) : "",
        clientName: line.clientName ? String(line.clientName) : clientName
      };
    });
  }

  function clearDom(root) {
    if (!root) return;
    root.querySelectorAll("[data-ff-cal-hold]").forEach(function (el) { el.remove(); });
  }

  function paintLine(root, axis, lay, line) {
    var col = root.querySelector('[data-ff-cal-emp="' + line.providerId + '"]');
    if (!col) return;
    var rect = lay.windowToRect(line.startMin, line.startMin + line.durationMinutes, axis.startMin, axis.endMin);
    if (!rect) return;
    var el = document.createElement("div");
    el.className = "ff-cal-hold";
    el.setAttribute("data-ff-cal-hold", "");
    el.setAttribute("data-ff-cal-hold-provider", line.providerId);
    el.style.top = rect.top + "px";
    el.style.height = Math.max(rect.height, 28) + "px";
    el.innerHTML = bodyHtml(line);
    col.appendChild(el);
  }

  function sync(root) {
    root = root || (typeof document !== "undefined" && document && document.getElementById
      ? document.getElementById("ffBookingCalendarRoot")
      : null);
    if (!root) return;
    clearDom(root);
    if (!draft || !draft.lines || !draft.lines.length) return;
    var st = calState();
    var lay = layout();
    if (!st || !lay) return;
    if (st.getSelectedDateKey() !== draft.dateKey) return;
    var axis = st.getAxis();
    if (!axis) return;
    draft.lines.forEach(function (line) {
      paintLine(root, axis, lay, line);
    });
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
    bodyHtml: bodyHtml,
    formatTime: formatTime
  };
})();
