/**
 * Booking shell: product switch and workspace. Internal screens live in
 * the left sidebar (sidebar.js). Does not own Live Floor, auth, or Operations.
 */
(function () {
  var SWITCH_ID = "ffProductSwitch";
  var SECTION_NAV_ID = "ffBookingSectionNav";
  var WORKSPACE_ID = "ffBookingWorkspace";
  var COPY = {
    calendar: { title: "Booking Calendar", body: "Calendar workspace coming next." },
    clients: { title: "Clients", body: "Client management coming soon." },
    services: { title: "Services", body: "Service management coming soon." }
  };
  var ICON_SCHEDULE =
    '<rect x="3" y="4" width="18" height="18" rx="2"></rect>' +
    '<line x1="16" y1="2" x2="16" y2="6"></line>' +
    '<line x1="8" y1="2" x2="8" y2="6"></line>' +
    '<line x1="3" y1="10" x2="21" y2="10"></line>';
  var opsServicesOpen = false;

  function navIcon(paths) {
    return (
      '<span class="ff-booking-nav-icon" aria-hidden="true">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
          paths +
        "</svg>" +
      "</span>"
    );
  }

  function state() {
    return window.ffBookingState || null;
  }

  function canAccess() {
    return typeof window.ffCanAccessBooking === "function" && !!window.ffCanAccessBooking();
  }

  function ensureSwitch() {
    var existing = document.getElementById(SWITCH_ID);
    if (existing) return existing;
    var rest = document.querySelector(".header-toolbar-rest");
    if (!rest) return null;
    var wrap = document.createElement("div");
    wrap.id = SWITCH_ID;
    wrap.className = "ff-product-switch";
    wrap.setAttribute("role", "tablist");
    wrap.setAttribute("aria-label", "Fair Flow product area");
    wrap.innerHTML =
      '<button type="button" class="ff-product-switch-btn is-active" data-ff-area="operations" role="tab" aria-selected="true">Operations</button>' +
      '<button type="button" class="ff-product-switch-btn" data-ff-area="booking" role="tab" aria-selected="false">' +
        navIcon(ICON_SCHEDULE) + "Booking</button>";
    wrap.addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest("[data-ff-area]") : null;
      if (!btn) return;
      ev.preventDefault();
      setArea(btn.getAttribute("data-ff-area"));
    });
    rest.insertBefore(wrap, rest.firstChild);
    return wrap;
  }

  function removeTopSectionNav() {
    var leftover = document.getElementById(SECTION_NAV_ID);
    if (leftover && leftover.parentNode) leftover.parentNode.removeChild(leftover);
  }

  function ensureMain(workspace) {
    var main = document.getElementById("ffBookingMain");
    if (main) return main;
    main = document.createElement("div");
    main.id = "ffBookingMain";
    main.className = "ff-booking-main";
    var pages = workspace.querySelectorAll("[data-ff-booking-page]");
    if (pages.length) {
      pages.forEach(function (page) { main.appendChild(page); });
    } else {
      main.innerHTML = pageHtml("calendar") + pageHtml("clients") + pageHtml("services");
    }
    workspace.appendChild(main);
    return main;
  }

  function pageHtml(id) {
    if (id === "calendar") {
      return (
        '<section class="ff-booking-page ff-booking-page-calendar" data-ff-booking-page="calendar">' +
          '<div id="ffBookingCalendarRoot"></div>' +
        "</section>"
      );
    }
    if (id === "clients") {
      return (
        '<section class="ff-booking-page ff-booking-page-clients" data-ff-booking-page="clients">' +
          '<div id="ffBookingClientsRoot"></div>' +
        "</section>"
      );
    }
    var copy = COPY[id] || COPY.calendar;
    return (
      '<section class="ff-booking-page" data-ff-booking-page="' + id + '">' +
        '<h1 class="ff-booking-page-title">' + copy.title + "</h1>" +
        '<p class="ff-booking-page-body">' + copy.body + "</p>" +
      "</section>"
    );
  }

  function ensureWorkspace() {
    var existing = document.getElementById(WORKSPACE_ID);
    if (!existing) {
      existing = document.createElement("div");
      existing.id = WORKSPACE_ID;
      existing.className = "ff-booking-workspace";
      existing.setAttribute("hidden", "");
      document.body.appendChild(existing);
    }
    removeTopSectionNav();
    if (window.ffBookingSidebar && typeof window.ffBookingSidebar.ensure === "function") {
      window.ffBookingSidebar.ensure(existing, setSection);
    }
    ensureMain(existing);
    return existing;
  }

  function paintSwitch(area) {
    var wrap = document.getElementById(SWITCH_ID);
    if (!wrap) return;
    wrap.querySelectorAll("[data-ff-area]").forEach(function (btn) {
      var on = btn.getAttribute("data-ff-area") === area;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function setWorkspaceVisible(show) {
    var workspace = document.getElementById(WORKSPACE_ID);
    if (!workspace) return;
    if (show) workspace.removeAttribute("hidden");
    else workspace.setAttribute("hidden", "");
  }

  function restoreOpsChromeAfterServices() {
    var ov = document.getElementById("owner-view");
    if (ov) {
      ov.style.display = "";
      ov.style.pointerEvents = "";
    }
    [document.querySelector(".joinBar"), document.querySelector(".wrap"), document.getElementById("queueControls")].forEach(function (el) {
      if (el) el.style.display = "";
    });
  }

  function hideOpsServices() {
    var el = document.getElementById("servicesScreen");
    if (!el) return;
    el.style.display = "none";
    el.style.pointerEvents = "none";
    el.style.zIndex = "";
  }

  function showServicesScreen() {
    var el = document.getElementById("servicesScreen");
    if (!el) return false;
    el.style.display = "block";
    el.style.pointerEvents = "auto";
    el.style.zIndex = "9866";
    restoreOpsChromeAfterServices();
    return true;
  }

  function openOpsServices() {
    if (state() && state().isBooking()) setWorkspaceVisible(true);
    showServicesScreen();
    if (opsServicesOpen) return;
    if (typeof window.goToServices !== "function") return;
    opsServicesOpen = true;
    Promise.resolve(window.goToServices()).then(function () {
      if (!showServicesScreen()) opsServicesOpen = false;
    }).catch(function () {
      opsServicesOpen = false;
    });
  }

  function paintSection(section) {
    if (window.ffBookingSidebar && typeof window.ffBookingSidebar.paint === "function") {
      window.ffBookingSidebar.paint(section);
    }
    var root = document.getElementById(WORKSPACE_ID);
    if (root) {
      root.querySelectorAll("[data-ff-booking-page]").forEach(function (page) {
        var id = page.getAttribute("data-ff-booking-page");
        page.classList.toggle("is-active", id === section && id !== "services");
      });
    }
    if (section === "services") {
      openOpsServices();
      return;
    }
    hideOpsServices();
    if (state() && state().isBooking()) setWorkspaceVisible(true);
    if (section === "calendar" && typeof window.ffRefreshBookingCalendar === "function") {
      window.ffRefreshBookingCalendar();
    }
    if (section === "clients" && typeof window.ffRefreshBookingClients === "function") {
      window.ffRefreshBookingClients();
    }
  }

  function closeAppointmentDrawer() {
    try {
      if (window.ffBookingAppointmentDrawer && typeof window.ffBookingAppointmentDrawer.forceClose === "function") {
        window.ffBookingAppointmentDrawer.forceClose();
      }
    } catch (_) {}
    try {
      if (window.ffBookingAppointmentDetails && typeof window.ffBookingAppointmentDetails.forceClose === "function") {
        window.ffBookingAppointmentDetails.forceClose();
      }
    } catch (_) {}
  }

  function closeClientsDrawer() {
    try {
      if (window.ffBookingClientsDrawer && typeof window.ffBookingClientsDrawer.forceClose === "function") {
        window.ffBookingClientsDrawer.forceClose();
      }
    } catch (_) {}
    try {
      if (window.ffBookingClientsOptions && typeof window.ffBookingClientsOptions.forceClose === "function") {
        window.ffBookingClientsOptions.forceClose();
      }
    } catch (_) {}
    try {
      if (window.ffBookingClientProfile && typeof window.ffBookingClientProfile.forceClose === "function") {
        window.ffBookingClientProfile.forceClose();
      }
    } catch (_) {}
  }

  function applyArea(area) {
    var inBooking = area === "booking";
    if (!inBooking) {
      closeAppointmentDrawer();
      closeClientsDrawer();
    }
    if (document.body) document.body.classList.toggle("ff-booking-area", inBooking);
    if (window.ffBookingSidebar && typeof window.ffBookingSidebar.setVisible === "function") {
      window.ffBookingSidebar.setVisible(inBooking);
    }
    if (!inBooking) {
      hideOpsServices();
      setWorkspaceVisible(false);
    }
    paintSwitch(area);
    if (inBooking) paintSection(state() ? state().getSection() : "calendar");
  }

  function setArea(next) {
    var st = state();
    if (!st) return;
    if (next === "booking" && !canAccess()) {
      st.setArea("operations");
      applyArea("operations");
      refreshVisibility();
      return;
    }
    var area = st.setArea(next);
    applyArea(area);
  }

  function setSection(next) {
    var st = state();
    if (!st || !st.isBooking()) return;
    if (next !== "calendar") closeAppointmentDrawer();
    if (next !== "clients") closeClientsDrawer();
    paintSection(st.setSection(next));
  }

  function goToBooking() {
    setArea("booking");
  }

  function goToOperations() {
    setArea("operations");
  }

  function refreshVisibility() {
    var allowed = canAccess();
    ensureSwitch();
    removeTopSectionNav();
    ensureWorkspace();
    var wrap = document.getElementById(SWITCH_ID);
    if (wrap) wrap.classList.toggle("is-ready", allowed);
    if (!allowed && state() && state().isBooking()) {
      state().setArea("operations");
      applyArea("operations");
    } else if (state()) {
      applyArea(state().getArea());
    }
  }

  function bindOpsEscape() {
    if (window.__ffBookingOpsNavBound) return;
    window.__ffBookingOpsNavBound = true;
    document.addEventListener("click", function (ev) {
      var st = state();
      if (!st || !st.isBooking()) return;
      var t = ev.target;
      if (!t || typeof t.closest !== "function") return;
      if (t.closest("#" + SWITCH_ID) || t.closest("#" + WORKSPACE_ID) || t.closest("#servicesScreen")) return;
      if (t.closest(".nav-item, .apps-panel-item, [data-app]")) {
        goToOperations();
      }
    }, true);
  }

  window.ffGoToBooking = goToBooking;
  window.ffGoToOperations = goToOperations;
  window.ffSetBookingSection = setSection;
  window.ffRefreshBookingShell = refreshVisibility;

  function boot() {
    ensureSwitch();
    removeTopSectionNav();
    ensureWorkspace();
    bindOpsEscape();
    refreshVisibility();
    document.addEventListener("ff-staff-cloud-updated", refreshVisibility);
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
