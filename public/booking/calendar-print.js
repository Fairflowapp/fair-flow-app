/**
 * Browser print for the Booking Calendar.
 * Day prints the visible Day providers. Week prints the selected Week
 * provider's Monday–Sunday board. Does not mutate filters, appointments,
 * blocks, schedules, or location.
 */
(function () {
  var PRINTING_CLASS = "ff-cal-printing";
  var printing = false;
  var printScopeId = "";
  var afterBound = false;

  function state() { return window.ffBookingCalState || null; }
  function time() { return window.ffBookingTime || null; }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isWeekView() {
    var st = state();
    return !!(st && st.isWeek && st.isWeek());
  }

  function weekdayLabel(dateKey) {
    var tm = time();
    if (tm && typeof tm.weekdayKey === "function") {
      var key = String(tm.weekdayKey(dateKey) || "").trim();
      if (key) return key.charAt(0).toUpperCase() + key.slice(1);
    }
    var display = tm && typeof tm.formatDisplayDate === "function" ? tm.formatDisplayDate(dateKey) : "";
    return String(display).split(",")[0] || "";
  }

  function locationList() {
    var list = [];
    try {
      if (typeof window.ffGetActiveLocations === "function") list = window.ffGetActiveLocations() || [];
    } catch (_) {}
    if (!list.length) {
      try {
        if (typeof window.ffGetLocations === "function") list = window.ffGetLocations() || [];
      } catch (_) {}
    }
    if (!list.length && Array.isArray(window.__ff_locations)) list = window.__ff_locations;
    return list || [];
  }

  function locationNameOf(locationId) {
    var loc = String(locationId || "").trim();
    if (!loc) return "";
    var hit = locationList().find(function (row) {
      return row && (String(row.id || "") === loc || String(row.locationId || "") === loc);
    });
    return String((hit && (hit.name || hit.locationName)) || "").trim() || loc;
  }

  function providerDisplayName(emp, fallback) {
    var name = String((emp && (emp.displayName || emp.name || emp.firstName)) || "").trim();
    return name || String(fallback || "").trim();
  }

  function dayHeaderMeta() {
    var st = state();
    var tm = time();
    var dateKey = st && typeof st.getSelectedDateKey === "function" ? st.getSelectedDateKey() : "";
    var locationId = st && typeof st.getLocationId === "function" ? st.getLocationId() : "";
    return {
      brand: "Fair Flow",
      title: "Booking Day Schedule",
      locationId: locationId,
      locationName: locationNameOf(locationId),
      dateKey: dateKey,
      dateLabel: tm && typeof tm.formatDisplayDate === "function" ? tm.formatDisplayDate(dateKey) : dateKey,
      weekday: weekdayLabel(dateKey)
    };
  }

  function weekHeaderMeta() {
    var st = state();
    var tm = time();
    var locationId = st && typeof st.getLocationId === "function" ? st.getLocationId() : "";
    var providerId = st && typeof st.getWeekProviderId === "function" ? st.getWeekProviderId() : "";
    var emp = st && typeof st.getWeekEmployee === "function" ? st.getWeekEmployee() : null;
    var keys = st && typeof st.getWeekDateKeys === "function" ? st.getWeekDateKeys() : [];
    var range = tm && typeof tm.formatWeekRange === "function"
      ? tm.formatWeekRange(st.getWeekAnchorKey ? st.getWeekAnchorKey() : keys[0])
      : "";
    return {
      brand: "Fair Flow",
      title: "Booking Week Schedule",
      locationId: locationId,
      locationName: locationNameOf(locationId),
      providerId: providerId,
      providerName: providerDisplayName(emp, providerId),
      weekStartKey: keys[0] || "",
      weekEndKey: keys.length ? keys[keys.length - 1] : "",
      weekDateKeys: keys.slice(),
      weekRange: range,
      dateKey: keys[0] || "",
      dateLabel: range,
      weekday: ""
    };
  }

  function headerMeta() {
    return isWeekView() ? weekHeaderMeta() : dayHeaderMeta();
  }

  function visibleEmployees() {
    var st = state();
    if (!st) return [];
    if (typeof st.getVisibleEmployees === "function") return st.getVisibleEmployees() || [];
    return st.getEmployees ? st.getEmployees() || [] : [];
  }

  function providersToPrint(scopeProviderId) {
    var visible = visibleEmployees();
    var scope = String(scopeProviderId || "").trim();
    if (scope) {
      var hit = visible.filter(function (emp) { return emp && emp.id === scope; });
      return hit.length ? hit : visible;
    }
    return visible;
  }

  function providerIdsToPrint(scopeProviderId) {
    return providersToPrint(scopeProviderId).map(function (emp) {
      return emp && emp.id ? String(emp.id) : "";
    }).filter(Boolean);
  }

  function rootEl() {
    if (typeof document === "undefined" || !document.getElementById) return null;
    return document.getElementById("ffBookingCalendarRoot");
  }

  function closePopovers() {
    try {
      if (window.ffBookingCalMenu && typeof window.ffBookingCalMenu.close === "function") {
        window.ffBookingCalMenu.close();
      }
    } catch (_) {}
    try {
      if (window.ffBookingCalFilters && typeof window.ffBookingCalFilters.close === "function") {
        window.ffBookingCalFilters.close();
      }
    } catch (_) {}
    try {
      if (window.ffBookingCalWeek && typeof window.ffBookingCalWeek.closePicker === "function") {
        window.ffBookingCalWeek.closePicker();
      }
    } catch (_) {}
  }

  function markPrintKeep(root, scopeId) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll(".is-print-keep").forEach(function (el) {
      if (el.classList) el.classList.remove("is-print-keep");
    });
    if (!scopeId) return;
    var col = root.querySelector('[data-ff-cal-emp="' + scopeId + '"]');
    var btn = root.querySelector('[data-ff-cal-provider="' + scopeId + '"]');
    if (col && col.classList) col.classList.add("is-print-keep");
    if (btn && btn.classList) btn.classList.add("is-print-keep");
  }

  function headerHtml(meta) {
    var bits = ['<span data-ff-cal-print-location>' + escapeHtml(meta.locationName) + "</span>"];
    if (meta.providerName) {
      bits.push('<span data-ff-cal-print-provider>' + escapeHtml(meta.providerName) + "</span>");
    }
    if (meta.weekday) {
      bits.push('<span data-ff-cal-print-weekday>' + escapeHtml(meta.weekday) + "</span>");
    }
    if (meta.dateLabel) {
      bits.push('<span data-ff-cal-print-date>' + escapeHtml(meta.dateLabel) + "</span>");
    }
    return '<div class="ff-cal-print-brand">' + escapeHtml(meta.brand) +
      ' / ' + escapeHtml(meta.title) + "</div>" +
      '<div class="ff-cal-print-meta">' + bits.join("") + "</div>";
  }

  function ensureHeader(cal) {
    if (!cal) return null;
    var meta = headerMeta();
    var el = cal.querySelector ? cal.querySelector("[data-ff-cal-print-header]") : null;
    if (!el && typeof document !== "undefined" && document.createElement) {
      el = document.createElement("div");
      el.className = "ff-cal-print-header";
      el.setAttribute("data-ff-cal-print-header", "");
      if (cal.firstChild) cal.insertBefore(el, cal.firstChild);
      else if (cal.appendChild) cal.appendChild(el);
    }
    if (el) el.innerHTML = headerHtml(meta);
    return el;
  }

  function applyDom(scopeId, week) {
    if (typeof document !== "undefined" && document.body && document.body.classList) {
      document.body.classList.add(PRINTING_CLASS);
    }
    var root = rootEl();
    if (!root) return;
    var cal = root.querySelector ? root.querySelector(".ff-cal") : null;
    if (cal && cal.classList) cal.classList.add("is-printing");
    if (cal && cal.setAttribute) {
      if (week) {
        cal.setAttribute("data-ff-cal-print-view", "week");
        cal.removeAttribute("data-ff-cal-print-only");
      } else {
        cal.removeAttribute("data-ff-cal-print-view");
        if (scopeId) cal.setAttribute("data-ff-cal-print-only", scopeId);
        else cal.removeAttribute("data-ff-cal-print-only");
      }
    }
    markPrintKeep(root, week ? "" : scopeId);
    ensureHeader(cal || root);
  }

  function clearDom() {
    if (typeof document !== "undefined" && document.body && document.body.classList) {
      document.body.classList.remove(PRINTING_CLASS);
    }
    var root = rootEl();
    if (!root) return;
    var cal = root.querySelector ? root.querySelector(".ff-cal") : null;
    if (cal && cal.classList) cal.classList.remove("is-printing");
    if (cal && cal.removeAttribute) {
      cal.removeAttribute("data-ff-cal-print-only");
      cal.removeAttribute("data-ff-cal-print-view");
    }
    markPrintKeep(root, "");
  }

  function exitPrintMode() {
    printing = false;
    printScopeId = "";
    clearDom();
    return { printing: false, printScopeId: "" };
  }

  function weekProviderIds() {
    var st = state();
    var id = st && typeof st.getWeekProviderId === "function" ? String(st.getWeekProviderId() || "").trim() : "";
    return id ? [id] : [];
  }

  function enterPrintMode(opts) {
    var options = opts && typeof opts === "object" ? opts : {};
    var week = options.view === "week" || (options.view == null && isWeekView());
    closePopovers();
    printing = true;
    printScopeId = week
      ? (weekProviderIds()[0] || "")
      : String(options.providerId || "").trim();
    applyDom(printScopeId, week);
    var snap = {
      printing: true,
      printScopeId: printScopeId,
      header: headerMeta(),
      providerIds: week ? weekProviderIds() : providerIdsToPrint(printScopeId)
    };
    if (week) {
      snap.view = "week";
      snap.weekDateKeys = snap.header.weekDateKeys || [];
      snap.locationId = snap.header.locationId || "";
    }
    return snap;
  }

  function bindAfterPrint() {
    if (afterBound || typeof window === "undefined") return;
    afterBound = true;
    window.addEventListener("afterprint", function () {
      exitPrintMode();
    });
    if (typeof window.matchMedia === "function") {
      try {
        var mql = window.matchMedia("print");
        if (mql && typeof mql.addEventListener === "function") {
          mql.addEventListener("change", function (ev) {
            if (ev && ev.matches === false) exitPrintMode();
          });
        }
      } catch (_) {}
    }
  }

  function triggerBrowserPrint() {
    bindAfterPrint();
    if (typeof window.print !== "function") return;
    try { window.print(); } catch (_) {}
  }

  function canPrintDay() {
    return !isWeekView();
  }

  function canPrintWeek() {
    var st = state();
    return !!(isWeekView() && st && st.getWeekEmployee && st.getWeekEmployee());
  }

  function printButtonLabel() {
    return isWeekView() ? "Print Week" : "Print Day";
  }

  function printCurrent() {
    if (isWeekView()) {
      if (!canPrintWeek()) return { ok: false, reason: "week_provider", printing: false };
      var weekSnap = enterPrintMode({ view: "week" });
      triggerBrowserPrint();
      return weekSnap;
    }
    var snapshot = enterPrintMode({});
    triggerBrowserPrint();
    return snapshot;
  }

  function printProvider(providerId) {
    if (isWeekView()) return { ok: false, reason: "week_view", printing: false };
    var snapshot = enterPrintMode({ providerId: providerId });
    triggerBrowserPrint();
    return snapshot;
  }

  window.ffBookingCalPrint = {
    printCurrent: printCurrent,
    printProvider: printProvider,
    canPrintDay: canPrintDay,
    canPrintWeek: canPrintWeek,
    printButtonLabel: printButtonLabel,
    enterPrintMode: enterPrintMode,
    exitPrintMode: exitPrintMode,
    isPrintMode: function () { return printing; },
    printScopeId: function () { return printScopeId; },
    headerMeta: headerMeta,
    providersToPrint: providersToPrint,
    providerIdsToPrint: providerIdsToPrint,
    locationNameOf: locationNameOf
  };
})();
