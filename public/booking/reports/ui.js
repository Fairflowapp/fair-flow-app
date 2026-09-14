/**
 * Booking Reports workspace: inner Sales tabs and the selected report.
 */
(function () {
  var ROOT_ID = "ffBookingReportsRoot";

  function nav() { return window.ffBookingReportsNav || null; }

  function isVisible() {
    var shell = window.ffBookingState;
    if (!shell || !shell.isBooking() || shell.getSection() !== "reports") return false;
    return !!document.getElementById(ROOT_ID);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function navHtml() {
    var api = nav();
    var selected = api && api.getSelectedId ? api.getSelectedId() : "booking-intelligence";
    var groups = (api && api.GROUPS) || [];
    return groups.map(function (group) {
      var items = (group.items || []).map(function (item) {
        var on = item.id === selected;
        return (
          '<button type="button" class="ff-rpt-nav-item' + (on ? " is-active" : "") + '"' +
            ' data-ff-rpt="' + escapeHtml(item.id) + '"' +
            (on ? ' aria-current="page"' : "") + ">" +
            escapeHtml(item.label) +
          "</button>"
        );
      }).join("");
      var heading = groups.length > 1
        ? "<h2>" + escapeHtml(group.label) + "</h2>"
        : "";
      return (
        '<section class="ff-rpt-nav-group">' +
          heading +
          items +
        "</section>"
      );
    }).join("");
  }

  function laterHtml(report) {
    return (
      '<p class="ff-rpt-empty">' +
        escapeHtml((report && report.blurb) || "This report comes next.") +
      "</p>"
    );
  }

  var SERVICE_SALES_SCRIPTS = [
    "/booking/reports/service-sales-compute.js?v=20260914_svcsales",
    "/booking/reports/service-sales.js?v=20260914_svcsales"
  ];
  var INTEL_SCRIPTS = [
    "/booking/reports/intelligence-compute.js?v=20260913_ui1",
    "/booking/reports/capacity-patterns.js?v=20260913_ui1",
    "/booking/reports/service-demand.js?v=20260913_ui1",
    "/booking/reports/client-behavior.js?v=20260913_ui1",
    "/booking/reports/insight-priority.js?v=20260913_ui1",
    "/booking/reports/intelligence.js?v=20260913_ui1"
  ];

  function intelReady() {
    return !!(window.ffBookingReportsIntelligenceCompute && window.ffBookingReportsIntelligence);
  }

  function serviceSalesReady() {
    return !!(window.ffBookingReportsServiceSalesCompute && window.ffBookingReportsServiceSales);
  }

  function loadScripts(list, done) {
    if (typeof document === "undefined" || !document.head) {
      done();
      return;
    }
    function loadOne(src, cb) {
      var existing = document.querySelector('script[src="' + src + '"]');
      if (existing) {
        cb();
        return;
      }
      var el = document.createElement("script");
      el.async = false;
      el.src = src;
      el.onload = cb;
      el.onerror = cb;
      document.head.appendChild(el);
    }
    function loadAll(i) {
      if (i >= list.length) {
        done();
        return;
      }
      loadOne(list[i], function () {
        loadAll(i + 1);
      });
    }
    loadAll(0);
  }

  function ensureIntelScripts(done) {
    if (intelReady()) {
      done();
      return;
    }
    loadScripts(INTEL_SCRIPTS, done);
  }

  function ensureServiceSalesScripts(done) {
    if (serviceSalesReady()) {
      done();
      return;
    }
    loadScripts(SERVICE_SALES_SCRIPTS, done);
  }

  function paintMain() {
    var main = document.getElementById("ffRptMain");
    if (!main) return;
    var report = nav() && nav().getSelected();
    var id = report && report.id;
    if (id === "booking-intelligence") {
      if (window.ffBookingReportsIntelligence) {
        window.ffBookingReportsIntelligence.paint();
        return;
      }
      main.innerHTML = '<p class="ff-rpt-empty">Loading Booking Intelligence…</p>';
      ensureIntelScripts(function () {
        if (window.ffBookingReportsIntelligence) window.ffBookingReportsIntelligence.paint();
        else {
          var host = document.getElementById("ffRptMain");
          if (host) host.innerHTML = laterHtml(report);
        }
      });
      return;
    }
    if (id === "sales-summary" && window.ffBookingReportsSalesSummary) {
      window.ffBookingReportsSalesSummary.paint();
      return;
    }
    if (id === "service-sales") {
      if (window.ffBookingReportsServiceSales) {
        window.ffBookingReportsServiceSales.paint();
        return;
      }
      main.innerHTML = '<p class="ff-rpt-empty">Loading Service Sales…</p>';
      ensureServiceSalesScripts(function () {
        if (window.ffBookingReportsServiceSales) window.ffBookingReportsServiceSales.paint();
        else {
          var host = document.getElementById("ffRptMain");
          if (host) host.innerHTML = laterHtml(report);
        }
      });
      return;
    }
    main.innerHTML = laterHtml(report);
  }

  function html() {
    return (
      '<div class="ff-rpt">' +
        '<aside class="ff-rpt-nav" aria-label="Booking reports">' + navHtml() + "</aside>" +
        '<div class="ff-rpt-main" id="ffRptMain" aria-label="' + escapeHtml((nav() && nav().getSelected() && nav().getSelected().label) || "Report") + '"></div>' +
      "</div>"
    );
  }

  function paint() {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.innerHTML = html();
    paintMain();
  }

  function onClick(ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest("[data-ff-rpt]") : null;
    if (!btn) return;
    ev.preventDefault();
    var api = nav();
    if (!api || typeof api.setSelectedId !== "function") return;
    api.setSelectedId(btn.getAttribute("data-ff-rpt"));
    paint();
  }

  function bind() {
    var root = document.getElementById(ROOT_ID);
    if (!root || root.getAttribute("data-ff-rpt-bound")) return;
    root.setAttribute("data-ff-rpt-bound", "1");
    root.addEventListener("click", onClick);
  }

  function refresh() {
    bind();
    if (!isVisible()) return;
    paint();
  }

  window.ffRefreshBookingReports = refresh;
  window.ffBookingReportsUi = { refresh: refresh, paint: paint };
})();
