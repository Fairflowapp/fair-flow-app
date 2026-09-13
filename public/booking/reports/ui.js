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
    var selected = api && api.getSelectedId ? api.getSelectedId() : "sales-summary";
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

  function paintMain() {
    var main = document.getElementById("ffRptMain");
    if (!main) return;
    var report = nav() && nav().getSelected();
    var id = report && report.id;
    if (id === "sales-summary" && window.ffBookingReportsSalesSummary) {
      window.ffBookingReportsSalesSummary.paint();
      return;
    }
    main.innerHTML = laterHtml(report);
  }

  function html() {
    return (
      '<div class="ff-rpt">' +
        '<aside class="ff-rpt-nav" aria-label="Sales reports">' + navHtml() + "</aside>" +
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
