/**
 * Compact Day Calendar provider filter popover.
 * View-only: toggles calendar-state visibility. Does not write data.
 */
(function () {
  var MENU_ID = "ffBookingCalFilterMenu";
  var open = false;
  var bound = false;

  function state() { return window.ffBookingCalState || null; }
  function data() { return window.ffBookingCalData || null; }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function displayName(emp) {
    var dt = data();
    if (dt && typeof dt.displayNameOf === "function") return dt.displayNameOf(emp);
    return String((emp && (emp.displayName || emp.name || emp.firstName)) || "").trim() || "Staff";
  }

  function buttonLabel() {
    var st = state();
    if (!st || !st.isProviderFilterActive || !st.isProviderFilterActive()) return "Filters";
    var visible = st.getVisibleEmployees ? st.getVisibleEmployees() : [];
    if (visible.length === 1) return displayName(visible[0]);
    return visible.length + " providers";
  }

  function isChecked(emp, st) {
    if (!st.isProviderFilterActive()) return true;
    return st.getVisibleProviderIds().indexOf(emp.id) !== -1;
  }

  function avatarHtml(emp) {
    var name = displayName(emp);
    var initial = name.charAt(0).toUpperCase() || "S";
    var src = String((emp && emp.photoURL) || "").trim();
    if (!src) {
      return '<span class="ff-cal-filter-avatar">' + escapeHtml(initial) + "</span>";
    }
    return '<span class="ff-cal-filter-avatar">' +
      '<img src="' + escapeHtml(src) + '" alt="" onerror="this.style.display=\'none\';">' +
      "</span>";
  }

  function rowHtml(emp, st) {
    var checked = isChecked(emp, st);
    return '<button type="button" class="ff-cal-filter-row' + (checked ? " is-on" : "") +
      '" role="menuitemcheckbox" aria-checked="' + (checked ? "true" : "false") +
      '" data-ff-cal-filter-provider="' + escapeHtml(emp.id) + '">' +
      '<span class="ff-cal-filter-check" aria-hidden="true">' + (checked ? "✓" : "") + "</span>" +
      avatarHtml(emp) +
      '<span class="ff-cal-filter-name">' + escapeHtml(displayName(emp)) + "</span>" +
      "</button>";
  }

  function ensureMenu() {
    var el = document.getElementById(MENU_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = MENU_ID;
    el.className = "ff-cal-menu ff-cal-filter-menu";
    el.setAttribute("hidden", "");
    el.setAttribute("role", "menu");
    document.body.appendChild(el);
    return el;
  }

  function close() {
    open = false;
    var el = document.getElementById(MENU_ID);
    if (el) {
      el.setAttribute("hidden", "");
      el.innerHTML = "";
    }
    document.querySelectorAll(".ff-cal-filters[aria-expanded='true']").forEach(function (btn) {
      btn.setAttribute("aria-expanded", "false");
    });
  }

  function place(el, anchor) {
    if (!el || !anchor) return;
    var rect = anchor.getBoundingClientRect();
    var menuW = el.offsetWidth || 240;
    var menuH = el.offsetHeight || 0;
    var pad = 8;
    var left = rect.right - menuW;
    var top = rect.bottom + 6;
    if (left < pad) left = pad;
    if (left + menuW > window.innerWidth - pad) left = window.innerWidth - menuW - pad;
    if (top + menuH > window.innerHeight - pad) top = Math.max(pad, rect.top - menuH - 6);
    el.style.position = "fixed";
    el.style.left = Math.round(left) + "px";
    el.style.top = Math.round(top) + "px";
  }

  function paint(anchor) {
    var st = state();
    var el = ensureMenu();
    if (!st) return;
    var employees = st.getEmployees() || [];
    el.innerHTML =
      '<button type="button" class="ff-cal-filter-all" data-ff-cal-filter-all="1">All providers</button>' +
      employees.map(function (emp) { return rowHtml(emp, st); }).join("");
    el.removeAttribute("hidden");
    if (anchor) anchor.setAttribute("aria-expanded", "true");
    place(el, anchor);
  }

  function toggle(anchor) {
    if (open) {
      close();
      return;
    }
    if (window.ffBookingCalMenu && typeof window.ffBookingCalMenu.close === "function") {
      window.ffBookingCalMenu.close();
    }
    if (window.ffBookingCalWeek && typeof window.ffBookingCalWeek.closePicker === "function") {
      window.ffBookingCalWeek.closePicker();
    }
    open = true;
    paint(anchor);
  }

  function refreshCalendar() {
    if (typeof window.ffRefreshBookingCalendar === "function") window.ffRefreshBookingCalendar();
  }

  function toggleProvider(providerId) {
    var st = state();
    if (!st || !providerId) return;
    var known = (st.getEmployees() || []).map(function (emp) { return emp.id; });
    var current = st.isProviderFilterActive() ? st.getVisibleProviderIds().slice() : known.slice();
    var idx = current.indexOf(providerId);
    if (idx === -1) current.push(providerId);
    else current.splice(idx, 1);
    st.setVisibleProviderIds(current);
    refreshCalendar();
    var btn = document.querySelector(".ff-cal-filters");
    if (open) paint(btn);
  }

  function showAll() {
    var st = state();
    if (!st) return;
    st.clearVisibleProviders();
    refreshCalendar();
    close();
  }

  function bind() {
    if (bound || typeof document === "undefined") return;
    bound = true;
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== "function") return;
      if (t.closest("[data-ff-cal-filter-all]")) {
        ev.preventDefault();
        showAll();
        return;
      }
      var row = t.closest("[data-ff-cal-filter-provider]");
      if (row) {
        ev.preventDefault();
        toggleProvider(row.getAttribute("data-ff-cal-filter-provider"));
        return;
      }
      if (t.closest("#" + MENU_ID) || t.closest(".ff-cal-filters")) return;
      close();
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") close();
    });
    window.addEventListener("resize", close);
  }

  window.ffBookingCalFilters = {
    toggle: toggle,
    close: close,
    isOpen: function () { return open; },
    buttonLabel: buttonLabel,
    toggleProvider: toggleProvider,
    showAll: showAll
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
    else bind();
  }
})();
