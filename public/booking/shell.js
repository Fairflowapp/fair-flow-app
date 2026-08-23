/**
 * Booking shell: product switch, section nav, and placeholder workspaces.
 * Does not own Live Floor, auth, salon, or Operations screens.
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
      '<button type="button" class="ff-product-switch-btn" data-ff-area="booking" role="tab" aria-selected="false">Booking</button>';
    wrap.addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest("[data-ff-area]") : null;
      if (!btn) return;
      ev.preventDefault();
      setArea(btn.getAttribute("data-ff-area"));
    });
    rest.insertBefore(wrap, rest.firstChild);
    return wrap;
  }

  function ensureSectionNav() {
    var existing = document.getElementById(SECTION_NAV_ID);
    if (existing) return existing;
    var rest = document.querySelector(".header-toolbar-rest");
    if (!rest) return null;
    var nav = document.createElement("nav");
    nav.id = SECTION_NAV_ID;
    nav.className = "ff-booking-section-nav";
    nav.setAttribute("aria-label", "Booking");
    nav.innerHTML =
      '<button type="button" class="ff-booking-section-btn is-active" data-ff-booking-section="calendar">Calendar</button>' +
      '<button type="button" class="ff-booking-section-btn" data-ff-booking-section="clients">Clients</button>' +
      '<button type="button" class="ff-booking-section-btn" data-ff-booking-section="services">Services</button>';
    nav.addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest("[data-ff-booking-section]") : null;
      if (!btn) return;
      ev.preventDefault();
      setSection(btn.getAttribute("data-ff-booking-section"));
    });
    var opsNav = rest.querySelector(".toolbar-nav-main");
    if (opsNav) rest.insertBefore(nav, opsNav);
    else rest.appendChild(nav);
    return nav;
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
    if (existing) return existing;
    var root = document.createElement("div");
    root.id = WORKSPACE_ID;
    root.className = "ff-booking-workspace";
    root.setAttribute("hidden", "");
    root.innerHTML = pageHtml("calendar") + pageHtml("clients") + pageHtml("services");
    document.body.appendChild(root);
    return root;
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

  function paintSection(section) {
    var nav = document.getElementById(SECTION_NAV_ID);
    if (nav) {
      nav.querySelectorAll("[data-ff-booking-section]").forEach(function (btn) {
        btn.classList.toggle("is-active", btn.getAttribute("data-ff-booking-section") === section);
      });
    }
    var root = document.getElementById(WORKSPACE_ID);
    if (!root) return;
    root.querySelectorAll("[data-ff-booking-page]").forEach(function (page) {
      page.classList.toggle("is-active", page.getAttribute("data-ff-booking-page") === section);
    });
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
  }

  function closeClientsDrawer() {
    try {
      if (window.ffBookingClientsDrawer && typeof window.ffBookingClientsDrawer.forceClose === "function") {
        window.ffBookingClientsDrawer.forceClose();
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
    var workspace = document.getElementById(WORKSPACE_ID);
    if (workspace) {
      if (inBooking) workspace.removeAttribute("hidden");
      else workspace.setAttribute("hidden", "");
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
    ensureSectionNav();
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
      if (t.closest("#" + SWITCH_ID) || t.closest("#" + SECTION_NAV_ID) || t.closest("#" + WORKSPACE_ID)) return;
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
    ensureSectionNav();
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
