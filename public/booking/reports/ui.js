/**
 * Booking Reports home. Navigation chrome only — no report numbers yet.
 */
(function () {
  var ROOT_ID = "ffBookingReportsRoot";
  var bound = false;

  function isVisible() {
    var shell = window.ffBookingState;
    if (!shell || !shell.isBooking() || shell.getSection() !== "reports") return false;
    return !!document.getElementById(ROOT_ID);
  }

  function html() {
    return (
      '<div class="ff-rpt">' +
        '<header class="ff-rpt-head">' +
          "<h1>Reports</h1>" +
          "<p>Numbers from checkout sales for this salon.</p>" +
        "</header>" +
        '<section class="ff-rpt-card" aria-live="polite">' +
          "<h2>No reports yet</h2>" +
          "<p>This tab is the home for salon reports. The first one will be a sales summary — totals by day and location.</p>" +
        "</section>" +
      "</div>"
    );
  }

  function paint() {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.innerHTML = html();
  }

  function bind() {
    if (bound) return;
    bound = true;
  }

  function refresh() {
    bind();
    if (!isVisible()) return;
    paint();
  }

  window.ffRefreshBookingReports = refresh;
  window.ffBookingReportsUi = { refresh: refresh, paint: paint };
})();
