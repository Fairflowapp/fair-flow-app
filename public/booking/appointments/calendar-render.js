/**
 * Paint appointment service-lines onto the Calendar columns.
 * Uses calendar-layout minute math. Does not edit appointments.
 */
(function () {
  function layout() { return window.ffBookingCalLayout || null; }
  function data() { return window.ffBookingCalAppointments || null; }
  function calState() { return window.ffBookingCalState || null; }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function clock(min) {
    var m = ((Number(min) % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60);
    var mm = m % 60;
    var h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return h12 + ":" + String(mm).padStart(2, "0");
  }

  function overlapLanes(cards) {
    var byProvider = {};
    (cards || []).forEach(function (card) {
      var id = card.providerId;
      if (!byProvider[id]) byProvider[id] = [];
      byProvider[id].push(card);
    });
    Object.keys(byProvider).forEach(function (id) {
      var list = byProvider[id].slice().sort(function (a, b) {
        return a.startMin - b.startMin || a.endMin - b.endMin;
      });
      var ends = [];
      list.forEach(function (card) {
        var lane = 0;
        while (lane < ends.length && card.startMin < ends[lane]) lane += 1;
        ends[lane] = card.endMin;
        card.lane = lane;
      });
    });
    return cards;
  }

  function clear(root) {
    if (!root) return;
    root.querySelectorAll("[data-ff-cal-card]").forEach(function (el) { el.remove(); });
  }

  function paint(root) {
    root = root || document.getElementById("ffBookingCalendarRoot");
    var st = calState();
    var lay = layout();
    var api = data();
    if (!root || !st || !lay || !api) return;
    clear(root);
    var axis = st.getAxis();
    var cards = overlapLanes(api.cardsForView(st.getSelectedDateKey(), st.getLocationId()));
    cards.forEach(function (card) {
      var col = root.querySelector('[data-ff-cal-emp="' + card.providerId + '"]');
      if (!col) return;
      var rect = lay.windowToRect(card.startMin, card.endMin, axis.startMin, axis.endMin);
      if (!rect) return;
      var el = document.createElement("button");
      el.type = "button";
      el.className = "ff-cal-card";
      el.setAttribute("data-ff-cal-card", card.appointmentId);
      el.setAttribute("data-ff-cal-line", card.lineId);
      el.style.top = rect.top + "px";
      el.style.height = Math.max(rect.height, 18) + "px";
      el.style.left = (4 + (card.lane || 0) * 10) + "px";
      el.style.zIndex = String(4 + (card.lane || 0));
      el.innerHTML =
        '<span class="ff-cal-card-name">' + escapeHtml(card.clientName) + "</span>" +
        '<span class="ff-cal-card-svc">' + escapeHtml(card.serviceName) + "</span>" +
        '<span class="ff-cal-card-time">' + escapeHtml(clock(card.startMin) + " – " + clock(card.endMin)) + "</span>";
      col.appendChild(el);
    });
  }

  window.ffBookingCalCardRender = {
    paint: paint,
    clear: clear,
    overlapLanes: overlapLanes,
    clock: clock
  };
})();
