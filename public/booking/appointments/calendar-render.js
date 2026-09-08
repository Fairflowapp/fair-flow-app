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
    return h12 + ":" + String(mm).padStart(2, "0") + " " + (h >= 12 ? "PM" : "AM");
  }

  function rangeLabel(startMin, endMin) {
    return clock(startMin) + " – " + clock(endMin);
  }

  function densityClass(durationMinutes) {
    var n = Number(durationMinutes);
    if (n > 0 && n <= 15) return "is-tiny";
    if (n > 0 && n <= 30) return "is-compact";
    return "";
  }

  function moreLabel(count) {
    var n = Number(count) || 0;
    if (n < 1) return "";
    return n === 1 ? "1 service" : n + " services";
  }

  function segmentShare(seg, cardStart, cardEnd) {
    var total = Number(cardEnd) - Number(cardStart);
    var start = Number(seg && seg.startMin);
    var end = Number(seg && seg.endMin);
    if (!(total > 0) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return { top: 0, height: 0 };
    }
    return {
      top: ((start - Number(cardStart)) / total) * 100,
      height: ((end - start) / total) * 100
    };
  }

  function segmentDensity(durationMinutes) {
    var n = Number(durationMinutes);
    if (n > 0 && n <= 15) return " is-mini";
    if (n > 0 && n <= 30) return " is-tight";
    return "";
  }

  function stackHtml(card) {
    var segs = (card && card.segments) || [];
    var count = segs.length || ((card && card.serviceNames) || []).length || 1;
    var head =
      '<span class="ff-cal-card-name">' + escapeHtml(card.clientName) +
        ' <span class="ff-cal-card-count">· ' + escapeHtml(moreLabel(count)) + "</span></span>";
    var body = segs.map(function (seg, index) {
      var share = segmentShare(seg, card.startMin, card.endMin);
      var mins = Number(seg.durationMinutes);
      if (!(mins > 0)) mins = Number(seg.endMin) - Number(seg.startMin);
      return '<span class="ff-cal-card-seg' + (index ? " is-next" : " is-first") +
        segmentDensity(mins) +
        '" data-ff-cal-seg="' + escapeHtml(seg.lineId || "") +
        '" data-ff-cal-seg-start="' + String(seg.startMin) +
        '" data-ff-cal-seg-duration="' + String(mins) +
        '" data-ff-cal-seg-requested="' + (seg.requested ? "1" : "0") +
        '" style="top:' + share.top + "%;height:" + share.height + '%">' +
        (index ? "" : head) +
        '<span class="ff-cal-card-svc">' + escapeHtml(seg.serviceName) + "</span>" +
        '<span class="ff-cal-card-time">' + escapeHtml(rangeLabel(seg.startMin, seg.endMin)) + "</span>" +
      "</span>";
    }).join("");
    return '<span class="ff-cal-card-segs">' + body + "</span>";
  }

  function servicesHtml(card) {
    return '<span class="ff-cal-card-svc">' + escapeHtml(card && card.serviceName || "Service") + "</span>";
  }

  function board() { return window.ffBookingScheduleBoard || null; }
  function draftApi() { return window.ffBookingCalDraft || null; }

  function overlapLanes(cards) {
    var api = board();
    if (api && typeof api.applyLanes === "function") return api.applyLanes(cards);
    (cards || []).forEach(function (card) {
      card.lane = 0;
      card.laneCount = 1;
    });
    return cards;
  }

  function holdsFromDraft() {
    var snap = draftApi() && typeof draftApi().get === "function" ? draftApi().get() : null;
    if (!snap || !Array.isArray(snap.lines)) return [];
    return snap.lines.map(function (line) {
      var start = Number(line && line.startMin);
      var duration = Number(line && line.durationMinutes) > 0 ? Number(line.durationMinutes) : 30;
      return {
        key: line.lineKey ? "hold:" + line.lineKey : "",
        lineKey: line.lineKey || "",
        providerId: line.providerId,
        startMin: start,
        endMin: start + duration,
        durationMinutes: duration
      };
    });
  }

  function applyBoardBox(el, item) {
    if (!el || !item) return;
    el.style.left = item.left || "4px";
    el.style.width = item.width || "calc(100% - 10px)";
    el.style.right = "auto";
    el.style.zIndex = String(4 + (item.lane || 0));
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
    window.__ffPaintingBoard = true;
    try {
      clear(root);
      var axis = st.getAxis();
      var cards = api.cardsForView(st.getSelectedDateKey(), st.getLocationId());
      var built = board() && typeof board().build === "function"
        ? board().build({ cards: cards, holds: holdsFromDraft() })
        : { items: overlapLanes(cards) };
      built.items.forEach(function (item) {
        if (item.kind && item.kind !== "card") return;
        var card = item.source || item;
        var col = root.querySelector('[data-ff-cal-emp="' + item.providerId + '"]');
        if (!col) return;
        var rect = lay.windowToRect(item.startMin, item.endMin, axis.startMin, axis.endMin);
        if (!rect) return;
        var el = document.createElement("button");
        el.type = "button";
        var statusKey = String(card.status || "scheduled").trim() || "scheduled";
        var statusClass = window.ffBookingAppointmentStatus && typeof window.ffBookingAppointmentStatus.cardClass === "function"
          ? window.ffBookingAppointmentStatus.cardClass(statusKey)
          : "is-status-" + statusKey;
        var duration = card.durationMinutes || (item.endMin - item.startMin);
        var stacked = (card.serviceNames && card.serviceNames.length > 1) || (card.lineIds && card.lineIds.length > 1);
        el.className = ("ff-cal-card " + densityClass(duration) + " " + statusClass + (card.firstVisit ? " is-new-client" : "") + (card.requested ? " is-requested" : "") + (stacked ? " is-stack" : "")).trim();
        el.setAttribute("data-ff-cal-card", card.appointmentId || item.appointmentId);
        if (card.clientKey || card.clientId) {
          el.setAttribute("data-ff-cal-client", card.clientKey || card.clientId);
        }
        el.setAttribute("data-ff-cal-status", statusKey);
        el.setAttribute("data-ff-cal-line", card.lineId || item.lineId);
        if (card.lineIds && card.lineIds.length) {
          el.setAttribute("data-ff-cal-lines", card.lineIds.join(","));
        }
        if (card.requested) {
          el.setAttribute("data-ff-cal-requested", "1");
          el.setAttribute("title", "Requested for this provider");
          el.setAttribute("aria-label", "Requested for this provider");
        }
        el.setAttribute("data-ff-cal-start", String(item.startMin));
        el.setAttribute("data-ff-cal-duration", String(duration));
        el.style.top = rect.top + "px";
        el.style.height = Math.max(rect.height, 18) + "px";
        applyBoardBox(el, item);
        var party = Number(card.partySize) > 1
          ? '<span class="ff-cal-card-party">' + escapeHtml(String(card.partySize) + " people") + "</span>"
          : "";
        var newbie = card.firstVisit
          ? '<span class="ff-cal-card-new">New Client</span>'
          : "";
        el.innerHTML = stacked
          ? stackHtml(card) + party + newbie
          : '<span class="ff-cal-card-name">' + escapeHtml(card.clientName) + "</span>" +
            servicesHtml(card) +
            '<span class="ff-cal-card-time">' + escapeHtml(rangeLabel(item.startMin, item.endMin)) + "</span>" +
            party +
            newbie;
        col.appendChild(el);
      });
      if (draftApi() && typeof draftApi().paintFromBoard === "function") {
        draftApi().paintFromBoard(root, built);
      }
    } finally {
      window.__ffPaintingBoard = false;
    }
    if (pinnedClient) highlightClient(pinnedClient);
  }

  var pinnedClient = "";

  function highlightClient(clientKey) {
    var id = String(clientKey || "");
    var root = document.getElementById("ffBookingCalendarRoot") || document;
    root.querySelectorAll("[data-ff-cal-card]").forEach(function (el) {
      el.classList.toggle("is-client-on", !!(id && el.getAttribute("data-ff-cal-client") === id));
    });
  }

  function bindClientHighlight() {
    if (typeof document === "undefined" || !document.documentElement) return;
    if (document.documentElement.getAttribute("data-ff-cal-client-hi")) return;
    document.documentElement.setAttribute("data-ff-cal-client-hi", "1");
    document.addEventListener("pointerover", function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== "function") return;
      var card = t.closest("[data-ff-cal-card]");
      if (!card) return;
      highlightClient(card.getAttribute("data-ff-cal-client"));
    }, true);
    document.addEventListener("pointerout", function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== "function") return;
      var card = t.closest("[data-ff-cal-card]");
      if (!card) return;
      var next = ev.relatedTarget && ev.relatedTarget.closest
        ? ev.relatedTarget.closest("[data-ff-cal-card]")
        : null;
      if (next && next.getAttribute("data-ff-cal-client") === card.getAttribute("data-ff-cal-client")) return;
      highlightClient(pinnedClient);
    }, true);
    document.addEventListener("pointerdown", function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== "function") return;
      var card = t.closest("[data-ff-cal-card]");
      if (card) {
        pinnedClient = card.getAttribute("data-ff-cal-client") || "";
        highlightClient(pinnedClient);
        return;
      }
      if (t.closest && (t.closest(".ff-apd") || t.closest("#ffBookingApptDetails") || t.closest("[data-ff-apd]"))) {
        if (t.closest("[data-ff-apd-act=\"close\"]")) {
          pinnedClient = "";
          highlightClient("");
        }
        return;
      }
      pinnedClient = "";
      highlightClient("");
    }, true);
  }

  window.ffBookingCalCardRender = {
    paint: paint,
    clear: clear,
    overlapLanes: overlapLanes,
    densityClass: densityClass,
    moreLabel: moreLabel,
    segmentDensity: segmentDensity,
    segmentShare: segmentShare,
    stackHtml: stackHtml,
    servicesHtml: servicesHtml,
    clock: clock,
    rangeLabel: rangeLabel,
    highlightClient: highlightClient
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindClientHighlight);
    else bindClientHighlight();
  }
})();
