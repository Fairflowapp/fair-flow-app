/**
 * In-progress visit hold on the Calendar. Not a saved appointment card.
 */
(function () {
  var draft = null;

  function time() { return window.ffBookingTime || null; }
  function layout() { return window.ffBookingCalLayout || null; }
  function calState() { return window.ffBookingCalState || null; }

  function formatTime(min) {
    var api = time();
    if (!api) return "";
    var h = Math.floor(((Number(min) % 1440) + 1440) % 1440 / 60);
    var m = ((Number(min) % 1440) + 1440) % 1440 % 60;
    var suffix = h >= 12 ? "PM" : "AM";
    var hour12 = h % 12;
    if (hour12 === 0) hour12 = 12;
    return hour12 + ":" + String(m).padStart(2, "0") + " " + suffix;
  }

  function labelOf(spec) {
    var clock = formatTime(spec.startMin);
    if (spec.title) return spec.title;
    return clock ? "Hold · " + clock : "Hold";
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
    el.textContent = labelOf(draft);
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
      title: spec.title ? String(spec.title) : ""
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
    get: function () { return draft; }
  };
})();
