/**
 * In-progress visit hold on the Calendar. Not a saved appointment card.
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

  function clearDom(root) {
    if (!root) return;
    root.querySelectorAll("[data-ff-cal-hold]").forEach(function (el) { el.remove(); });
  }

  function sync(root) {
    root = root || document.getElementById("ffBookingCalendarRoot");
    if (!root) return;
    clearDom(root);
    if (!draft) return;
    var st = calState();
    var lay = layout();
    if (!st || !lay) return;
    if (st.getSelectedDateKey() !== draft.dateKey) return;
    var axis = st.getAxis();
    var col = root.querySelector('[data-ff-cal-emp="' + draft.providerId + '"]');
    if (!col || !axis) return;
    var duration = Number(draft.durationMinutes) > 0 ? Number(draft.durationMinutes) : 30;
    var rect = lay.windowToRect(draft.startMin, draft.startMin + duration, axis.startMin, axis.endMin);
    if (!rect) return;
    var el = document.createElement("div");
    el.className = "ff-cal-hold";
    el.setAttribute("data-ff-cal-hold", "");
    el.style.top = rect.top + "px";
    el.style.height = Math.max(rect.height, 28) + "px";
    el.innerHTML = bodyHtml(draft);
    col.appendChild(el);
  }

  function set(spec) {
    if (!spec || !spec.providerId || !spec.dateKey || !Number.isFinite(Number(spec.startMin))) {
      draft = null;
      sync();
      return;
    }
    draft = {
      providerId: String(spec.providerId),
      dateKey: String(spec.dateKey),
      startMin: Number(spec.startMin),
      durationMinutes: Number(spec.durationMinutes) > 0 ? Number(spec.durationMinutes) : 30,
      title: spec.title ? String(spec.title) : "",
      clientName: spec.clientName ? String(spec.clientName) : ""
    };
    sync();
  }

  function clear() {
    draft = null;
    sync();
  }

  window.ffBookingCalDraft = {
    set: set,
    clear: clear,
    sync: sync,
    get: function () { return draft; },
    bodyHtml: bodyHtml,
    formatTime: formatTime
  };
})();
