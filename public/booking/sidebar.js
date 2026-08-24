/**
 * Booking left sidebar. Navigation chrome only — routes through
 * window.ffSetBookingSection. Does not own Calendar, Clients, or Services.
 */
(function () {
  var ID = "ffBookingSidebar";
  var KEY = "ff-booking-sidebar-collapsed";
  var EXPANDED_W = 200;
  var COLLAPSED_W = 58;
  var NARROW_PX = 1180;
  var ICON_SCHEDULE =
    '<rect x="3" y="4" width="18" height="18" rx="2"></rect>' +
    '<line x1="16" y1="2" x2="16" y2="6"></line>' +
    '<line x1="8" y1="2" x2="8" y2="6"></line>' +
    '<line x1="3" y1="10" x2="21" y2="10"></line>';
  var ICON_PERSON =
    '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>' +
    '<circle cx="12" cy="7" r="4"></circle>';
  var ICON_SERVICES =
    '<path d="M4 7h16"></path><path d="M4 12h16"></path>' +
    '<path d="M4 17h10"></path><circle cx="18" cy="17" r="2"></circle>';
  var ICON_CHEVRON_LEFT =
    '<polyline points="15 18 9 12 15 6"></polyline>';
  var ICON_CHEVRON_RIGHT =
    '<polyline points="9 18 15 12 9 6"></polyline>';
  var onSelect = null;
  var resizeBound = false;

  function icon(paths) {
    return (
      '<span class="ff-booking-sidebar-icon" aria-hidden="true">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
          paths +
        "</svg>" +
      "</span>"
    );
  }

  function storedCollapsed() {
    try {
      var value = sessionStorage.getItem(KEY);
      if (value === "1") return true;
      if (value === "0") return false;
    } catch (_) {}
    return null;
  }

  function isNarrow() {
    return window.innerWidth < NARROW_PX;
  }

  function isCollapsed() {
    var stored = storedCollapsed();
    if (stored !== null) return stored;
    return isNarrow();
  }

  function persist(collapsed) {
    try {
      sessionStorage.setItem(KEY, collapsed ? "1" : "0");
    } catch (_) {}
  }

  function applyWidth(collapsed) {
    var width = collapsed ? COLLAPSED_W : EXPANDED_W;
    document.documentElement.style.setProperty("--ff-booking-sidebar-w", width + "px");
    var el = document.getElementById(ID);
    if (!el) return;
    el.classList.toggle("is-collapsed", collapsed);
    var toggle = el.querySelector("[data-ff-booking-sidebar-toggle]");
    if (toggle) {
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      toggle.setAttribute("aria-label", collapsed ? "Expand booking menu" : "Collapse booking menu");
      toggle.setAttribute("title", collapsed ? "Expand menu" : "Collapse menu");
      toggle.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          (collapsed ? ICON_CHEVRON_RIGHT : ICON_CHEVRON_LEFT) +
        "</svg>" +
        (collapsed ? "" : '<span class="ff-booking-sidebar-toggle-label">Collapse</span>');
    }
    el.querySelectorAll("[data-ff-booking-section]").forEach(function (btn) {
      var label = btn.getAttribute("data-ff-booking-label") || btn.textContent || "";
      if (collapsed) btn.setAttribute("title", label);
      else btn.removeAttribute("title");
    });
  }

  function clearWidth() {
    document.documentElement.style.removeProperty("--ff-booking-sidebar-w");
  }

  function itemHtml(section, label, paths) {
    return (
      '<button type="button" class="ff-booking-sidebar-item" data-ff-booking-section="' + section + '" data-ff-booking-label="' + label + '" aria-label="' + label + '">' +
        icon(paths) +
        '<span class="ff-booking-sidebar-label">' + label + "</span>" +
      "</button>"
    );
  }

  function html() {
    return (
      '<nav class="ff-booking-sidebar-nav" aria-label="Booking screens">' +
        itemHtml("calendar", "Calendar", ICON_SCHEDULE) +
        itemHtml("clients", "Clients", ICON_PERSON) +
        itemHtml("services", "Services", ICON_SERVICES) +
      "</nav>" +
      '<button type="button" class="ff-booking-sidebar-toggle" data-ff-booking-sidebar-toggle aria-expanded="true" aria-label="Collapse booking menu" title="Collapse menu">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          ICON_CHEVRON_LEFT +
        "</svg>" +
        '<span class="ff-booking-sidebar-toggle-label">Collapse</span>' +
      "</button>"
    );
  }

  function toggleCollapsed() {
    var next = !isCollapsed();
    persist(next);
    applyWidth(next);
  }

  function onClick(ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest("[data-ff-booking-sidebar-toggle], [data-ff-booking-section]") : null;
    if (!t) return;
    ev.preventDefault();
    if (t.getAttribute("data-ff-booking-sidebar-toggle") !== null) {
      toggleCollapsed();
      return;
    }
    var section = t.getAttribute("data-ff-booking-section");
    if (!section) return;
    if (typeof onSelect === "function") onSelect(section);
    else if (typeof window.ffSetBookingSection === "function") window.ffSetBookingSection(section);
  }

  function bindResize() {
    if (resizeBound) return;
    resizeBound = true;
    window.addEventListener("resize", function () {
      if (!document.body || !document.body.classList.contains("ff-booking-area")) return;
      if (storedCollapsed() !== null) return;
      applyWidth(isNarrow());
    });
  }

  function ensure(workspace, selectFn) {
    if (typeof selectFn === "function") onSelect = selectFn;
    var existing = document.getElementById(ID);
    if (!existing && workspace) {
      existing = document.createElement("aside");
      existing.id = ID;
      existing.className = "ff-booking-sidebar";
      existing.setAttribute("aria-label", "Booking");
      existing.innerHTML = html();
      existing.addEventListener("click", onClick);
      workspace.insertBefore(existing, workspace.firstChild);
    }
    bindResize();
    applyWidth(isCollapsed());
    return existing;
  }

  function paint(section) {
    var el = document.getElementById(ID);
    if (!el) return;
    el.querySelectorAll("[data-ff-booking-section]").forEach(function (btn) {
      var on = btn.getAttribute("data-ff-booking-section") === section;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-current", on ? "page" : "false");
    });
  }

  function setVisible(show) {
    var el = document.getElementById(ID);
    if (show) {
      applyWidth(isCollapsed());
      if (el) el.removeAttribute("hidden");
    } else {
      clearWidth();
      if (el) el.setAttribute("hidden", "");
    }
  }

  window.ffBookingSidebar = {
    ensure: ensure,
    paint: paint,
    setVisible: setVisible,
    isCollapsed: isCollapsed,
    expandedWidth: EXPANDED_W,
    collapsedWidth: COLLAPSED_W
  };
})();
