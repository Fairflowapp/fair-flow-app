/**
 * Live Floor Drawer — reusable overlay for the existing Live/Floor data.
 *
 * Staging prototype only. Does not navigate, does not own Firestore listeners,
 * and does not duplicate Floor/Live business logic. It presents the same Live
 * cards (Queue, Tickets, Floor Requests) that `#liveScreen` already renders
 * via ffGetFloorOrders / ffRenderFloorOrderCardHTML / ffGetLiveQueueRows /
 * ffGetCurrentTickets.
 *
 * Later Booking (or any screen) can open this exact drawer:
 *   window.ffOpenLiveFloorDrawer()
 *   window.ffCloseLiveFloorDrawer()
 *   window.ffToggleLiveFloorDrawer()
 *   window.ffIsLiveFloorDrawerOpen()
 */
(function () {
  var BACKDROP_ID = "ffLiveFloorDrawerBackdrop";
  var DRAWER_ID = "ffLiveFloorDrawer";
  var TRIGGER_ID = "ffLiveFloorTrigger";
  var open = false;
  var escapeBound = false;
  var eventsBound = false;

  function isEnabledEnv() {
    if (typeof window.FF_ENV === "string" && window.FF_ENV === "staging") return true;
    var host = (window.location && window.location.hostname) || "";
    return host === "localhost" || host === "127.0.0.1";
  }

  function canUseLive() {
    if (typeof window.ffCurrentUserCanUseLiveDesk === "function") {
      try { return !!window.ffCurrentUserCanUseLiveDesk(); } catch (_) { return false; }
    }
    return false;
  }

  function isKiosk() {
    try { return !!(document.body && document.body.classList.contains("ff-kiosk-mode")); } catch (_) { return false; }
  }

  function drawerEl() { return document.getElementById(DRAWER_ID); }
  function backdropEl() { return document.getElementById(BACKDROP_ID); }
  function triggerEl() { return document.getElementById(TRIGGER_ID); }

  function isOpen() {
    return open && !!(drawerEl() && drawerEl().classList.contains("is-open"));
  }

  function paintLive() {
    if (typeof window.ffRenderLiveScreen === "function") {
      try { window.ffRenderLiveScreen(); } catch (_) {}
    }
  }

  function ensureDom() {
    if (!document.getElementById(BACKDROP_ID)) {
      var backdrop = document.createElement("div");
      backdrop.id = BACKDROP_ID;
      backdrop.className = "ff-lfd-backdrop";
      backdrop.setAttribute("hidden", "");
      backdrop.addEventListener("click", function () { closeDrawer(); });
      document.body.appendChild(backdrop);
    }
    if (!document.getElementById(DRAWER_ID)) {
      var aside = document.createElement("aside");
      aside.id = DRAWER_ID;
      aside.className = "ff-lfd";
      aside.setAttribute("data-ff-live-host", "drawer");
      aside.setAttribute("aria-hidden", "true");
      aside.setAttribute("role", "dialog");
      aside.setAttribute("aria-labelledby", "ffLiveFloorDrawerTitle");
      aside.innerHTML =
        '<div class="ff-lfd-head">' +
          '<span class="ff-lfd-title" id="ffLiveFloorDrawerTitle">' +
            '<span class="ff-lfd-dot" aria-hidden="true"></span>Live Floor' +
          '</span>' +
          '<button type="button" class="ff-lfd-close" id="ffLiveFloorDrawerClose" aria-label="Close Live Floor">&times;</button>' +
        '</div>' +
        '<div class="ff-lfd-body live-body">' +
          '<div class="live-card">' +
            '<div class="live-card-head live-q-head">' +
              '<span class="live-card-title">Queue</span>' +
              '<div class="live-q-head-right">' +
                '<div class="live-q-seg" role="tablist" aria-label="Queue view">' +
                  '<button type="button" class="live-q-seg-opt is-active" data-live-q-mode="available" role="tab" aria-selected="true">Available</button>' +
                  '<button type="button" class="live-q-seg-opt" data-live-q-mode="service" role="tab" aria-selected="false">In Service</button>' +
                '</div>' +
                '<span class="live-card-count" data-ff-live-count="liveQueueCount">0</span>' +
              '</div>' +
            '</div>' +
            '<div class="live-list" data-ff-live-list="liveQueueList"></div>' +
          '</div>' +
          '<div class="live-card">' +
            '<div class="live-card-head"><span class="live-card-title">Tickets</span><span class="live-card-count" data-ff-live-count="liveTicketsCount">0</span></div>' +
            '<div class="live-list" data-ff-live-list="liveTicketsList"></div>' +
          '</div>' +
          '<div class="live-card">' +
            '<div class="live-card-head"><span class="live-card-title">Floor Requests</span><span class="live-card-count" data-ff-live-count="liveFloorCount">0</span></div>' +
            '<div class="live-list" data-ff-live-list="liveFloorList"></div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(aside);
      var closeBtn = aside.querySelector("#ffLiveFloorDrawerClose");
      if (closeBtn) closeBtn.addEventListener("click", function () { closeDrawer(); });
    }
    bindDrawerEvents();
    return drawerEl();
  }

  function bindDrawerEvents() {
    if (eventsBound) return;
    eventsBound = true;
    document.addEventListener("click", function (ev) {
      var drawer = drawerEl();
      if (!drawer || !drawer.classList.contains("is-open")) return;
      var t = ev.target;
      if (!t || typeof t.closest !== "function") return;
      if (!t.closest("#" + DRAWER_ID)) return;

      var modeBtn = t.closest("[data-live-q-mode]");
      if (modeBtn) {
        ev.preventDefault();
        if (typeof window.ffSetLiveQueueMode === "function") {
          window.ffSetLiveQueueMode(modeBtn.getAttribute("data-live-q-mode"));
        }
        return;
      }

      var qBtn = t.closest("[data-live-q-start],[data-live-q-hold],[data-live-q-call],[data-live-s-finish],[data-live-s-call]");
      if (qBtn) {
        ev.preventDefault();
        var startKey = qBtn.getAttribute("data-live-q-start");
        var holdKey = qBtn.getAttribute("data-live-q-hold");
        var callKey = qBtn.getAttribute("data-live-q-call");
        var finishKey = qBtn.getAttribute("data-live-s-finish");
        var svcCallKey = qBtn.getAttribute("data-live-s-call");
        if (startKey != null && typeof window.ffLiveQueueStart === "function") window.ffLiveQueueStart(startKey);
        else if (holdKey != null && typeof window.ffLiveQueueHold === "function") window.ffLiveQueueHold(holdKey);
        else if (callKey != null && typeof window.ffLiveQueueCall === "function") {
          var callWrap = qBtn.closest(".live-q-call-wrap");
          var statusEl = callWrap ? callWrap.querySelector(".live-q-call-status") : null;
          window.ffLiveQueueCall(callKey, { statusEl: statusEl, buttonEl: qBtn });
        } else if (finishKey != null && typeof window.ffLiveServiceFinish === "function") {
          window.ffLiveServiceFinish(finishKey);
        } else if (svcCallKey != null && typeof window.ffLiveServiceCall === "function") {
          var svcCallWrap = qBtn.closest(".live-q-call-wrap");
          var svcStatusEl = svcCallWrap ? svcCallWrap.querySelector(".live-q-call-status") : null;
          window.ffLiveServiceCall(svcCallKey, { statusEl: svcStatusEl, buttonEl: qBtn });
        }
        return;
      }

      var ticketRow = t.closest("[data-live-ticket]");
      if (ticketRow) {
        var ticketId = ticketRow.getAttribute("data-live-ticket");
        if (ticketId && typeof window.ffOpenTicketModal === "function") window.ffOpenTicketModal(ticketId);
        return;
      }

      var floorRow = t.closest("[data-live-floor]");
      if (floorRow) {
        var floorId = floorRow.getAttribute("data-live-floor");
        if (floorId && typeof window.ffOpenFloorOrderDetails === "function") window.ffOpenFloorOrderDetails(floorId);
      }
    });
  }

  function bindEscape() {
    if (escapeBound) return;
    escapeBound = true;
    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape") return;
      if (!isOpen()) return;
      ev.preventDefault();
      closeDrawer();
    });
  }

  function setTriggerPressed(pressed) {
    var btn = triggerEl();
    if (!btn) return;
    btn.classList.toggle("is-open", !!pressed);
    btn.setAttribute("aria-pressed", pressed ? "true" : "false");
  }

  function openDrawer() {
    if (!isEnabledEnv() || !canUseLive()) return;
    ensureDom();
    var drawer = drawerEl();
    var backdrop = backdropEl();
    if (!drawer) return;
    if (typeof window.ffCloseLiveScreen === "function") {
      try { window.ffCloseLiveScreen(); } catch (_) {}
    }
    paintLive();
    if (backdrop) {
      backdrop.removeAttribute("hidden");
      backdrop.classList.add("is-open");
    }
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    open = true;
    setTriggerPressed(true);
    bindEscape();
    requestAnimationFrame(function () {
      drawer.classList.add("is-visible");
    });
  }

  function closeDrawer() {
    var drawer = drawerEl();
    var backdrop = backdropEl();
    if (drawer) {
      drawer.classList.remove("is-visible");
      drawer.classList.remove("is-open");
      drawer.setAttribute("aria-hidden", "true");
    }
    if (backdrop) {
      backdrop.classList.remove("is-open");
      backdrop.setAttribute("hidden", "");
    }
    open = false;
    setTriggerPressed(false);
  }

  function toggleDrawer() {
    if (isOpen()) closeDrawer();
    else openDrawer();
  }

  function mountHeaderTrigger() {
    if (!isEnabledEnv()) return null;
    var existing = document.getElementById(TRIGGER_ID);
    if (existing) return existing;
    var right = document.querySelector(".toolbar-nav-right");
    if (!right) return null;
    var btn = document.createElement("button");
    btn.id = TRIGGER_ID;
    btn.type = "button";
    btn.className = "ff-live-floor-trigger btn-pill";
    btn.setAttribute("aria-label", "Open Live Floor");
    btn.setAttribute("title", "Live Floor");
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-controls", DRAWER_ID);
    btn.innerHTML = '<span class="ff-live-floor-trigger-dot" aria-hidden="true"></span>LIVE';
    btn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      toggleDrawer();
    });
    var apps = document.getElementById("appsBtn");
    if (apps && apps.parentNode === right) right.insertBefore(btn, apps);
    else right.insertBefore(btn, right.firstChild);
    return btn;
  }

  function refreshVisibility() {
    var btn = mountHeaderTrigger();
    if (!btn) return;
    var show = isEnabledEnv() && canUseLive() && !isKiosk();
    btn.classList.toggle("is-ready", show);
    if (!show && isOpen()) closeDrawer();
  }

  window.ffOpenLiveFloorDrawer = openDrawer;
  window.ffCloseLiveFloorDrawer = closeDrawer;
  window.ffToggleLiveFloorDrawer = toggleDrawer;
  window.ffIsLiveFloorDrawerOpen = isOpen;
  window.ffRefreshLiveFloorDrawerVisibility = refreshVisibility;
  window.ffEnsureLiveFloorDrawer = ensureDom;

  function boot() {
    if (!isEnabledEnv()) return;
    mountHeaderTrigger();
    refreshVisibility();
    document.addEventListener("ff-staff-cloud-updated", refreshVisibility);
    // Staff + live_view load after this script; retry until the permission is known.
    setTimeout(refreshVisibility, 0);
    setTimeout(refreshVisibility, 800);
    setTimeout(refreshVisibility, 2500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
