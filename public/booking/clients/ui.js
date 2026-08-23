/**
 * Booking Clients V1 screen. Recent 50 + targeted search via ffBookingClients.
 * Does not load the clients collection.
 */
(function () {
  var ROOT_ID = "ffBookingClientsRoot";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var searchTimer = null;
  var bound = false;
  var queryText = "";
  var rows = [];
  var status = "idle";
  var searchGen = 0;

  function repo() { return window.ffBookingClients || null; }

  function isVisible() {
    var shell = window.ffBookingState;
    if (!shell || !shell.isBooking() || shell.getSection() !== "clients") return false;
    return !!document.getElementById(ROOT_ID);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function dash(value) {
    var text = String(value == null ? "" : value).trim();
    return text || "—";
  }

  function initials(client) {
    var first = String(client && client.firstName || "").trim();
    var last = String(client && client.lastName || "").trim();
    var pair = (first.charAt(0) + last.charAt(0)).toUpperCase();
    if (pair) return pair;
    var name = String(client && client.displayName || "").trim();
    return name ? name.charAt(0).toUpperCase() : "?";
  }

  function coerceDate(value) {
    if (!value) return null;
    if (typeof value.toDate === "function") {
      try { return value.toDate(); } catch (_) { return null; }
    }
    if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
    if (value instanceof Date) return value;
    return null;
  }

  function formatUpdated(value) {
    var date = coerceDate(value);
    if (!date || Number.isNaN(date.getTime())) return "—";
    var tm = window.ffBookingTime;
    var key = tm && typeof tm.zonedDateKey === "function" ? tm.zonedDateKey(date) : "";
    var parts = tm && typeof tm.parseDateKey === "function" && key ? tm.parseDateKey(key) : null;
    if (parts) return MONTHS[parts.m - 1] + " " + parts.d + ", " + parts.y;
    return MONTHS[date.getMonth()] + " " + date.getDate() + ", " + date.getFullYear();
  }

  function bodyHtml() {
    if (status === "loading") return '<div class="ff-cli-empty">Loading...</div>';
    if (status === "searching") return '<div class="ff-cli-empty">Searching...</div>';
    if (status === "empty") return '<div class="ff-cli-empty">No clients found.</div>';
    if (!rows.length) return '<div class="ff-cli-empty">No clients yet.</div>';
    return (
      '<table class="ff-cli-table">' +
        "<thead><tr><th>Client</th><th>Phone</th><th>Email</th><th>Last updated</th></tr></thead>" +
        "<tbody>" +
        rows.map(function (row) {
          return '<tr class="ff-cli-row" data-ff-cli-id="' + escapeHtml(row.clientId) + '">' +
            '<td><span class="ff-cli-who"><span class="ff-cli-initials">' + escapeHtml(initials(row)) +
            "</span>" + escapeHtml(row.displayName || "Client") + "</span></td>" +
            '<td class="ff-cli-muted">' + escapeHtml(dash(row.phone)) + "</td>" +
            '<td class="ff-cli-muted">' + escapeHtml(dash(row.email)) + "</td>" +
            '<td class="ff-cli-muted">' + escapeHtml(formatUpdated(row.updatedAt || row.createdAt)) + "</td>" +
          "</tr>";
        }).join("") +
        "</tbody></table>"
    );
  }

  function paint() {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.innerHTML =
      '<div class="ff-cli">' +
        '<div class="ff-cli-toolbar">' +
          "<h1>Clients</h1>" +
          '<button type="button" class="ff-cli-add" data-ff-cli-act="add">+ Add Client</button>' +
        "</div>" +
        '<div class="ff-cli-search">' +
          '<input id="ffCliSearch" type="search" autocomplete="off" placeholder="Search clients by name, phone or email" value="' +
          escapeHtml(queryText) + '">' +
        "</div>" +
        '<div class="ff-cli-body">' + bodyHtml() + "</div>" +
      "</div>";
    var input = document.getElementById("ffCliSearch");
    if (input && document.activeElement === input) {
      var end = input.value.length;
      input.setSelectionRange(end, end);
    }
  }

  async function loadRecent() {
    var api = repo();
    var gen = ++searchGen;
    status = "loading";
    paint();
    var found = [];
    try {
      found = api && typeof api.getRecentClients === "function" ? await api.getRecentClients(50) : [];
    } catch (_) {
      found = [];
    }
    if (gen !== searchGen) return;
    rows = found || [];
    status = "recent";
    paint();
  }

  async function runSearch(raw) {
    var api = repo();
    var q = String(raw || "").trim();
    queryText = q;
    if (!q) {
      await loadRecent();
      return;
    }
    if (!api) {
      rows = [];
      status = "empty";
      paint();
      return;
    }
    var gen = ++searchGen;
    status = "searching";
    paint();
    var found = [];
    try {
      found = await api.searchClients(q);
    } catch (_) {
      found = [];
    }
    if (gen !== searchGen) return;
    rows = found || [];
    status = rows.length ? "results" : "empty";
    paint();
  }

  function scheduleSearch(raw) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { runSearch(raw); }, 300);
  }

  function showClient(client) {
    rows = client ? [client] : [];
    status = client ? "results" : "idle";
    paint();
  }

  function replaceClient(client) {
    if (!client || !client.clientId) return;
    var next = rows.slice();
    var idx = next.findIndex(function (row) { return row.clientId === client.clientId; });
    if (idx >= 0) next[idx] = client;
    else next = [client];
    rows = next;
    status = "results";
    paint();
  }

  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== "function") return;
      var root = document.getElementById(ROOT_ID);
      if (!root || !root.contains(t)) return;
      if (t.closest("[data-ff-cli-act=add]")) {
        ev.preventDefault();
        if (window.ffBookingClientsDrawer) window.ffBookingClientsDrawer.openAdd();
        return;
      }
      var row = t.closest("[data-ff-cli-id]");
      if (row && window.ffBookingClientsDrawer) {
        ev.preventDefault();
        window.ffBookingClientsDrawer.openDetails(row.getAttribute("data-ff-cli-id"));
      }
    });
    document.addEventListener("input", function (ev) {
      if (!ev.target || ev.target.id !== "ffCliSearch") return;
      queryText = ev.target.value;
      scheduleSearch(ev.target.value);
    });
    document.addEventListener("ff-booking-client-created", function () {
      if (!isVisible()) return;
      if (String(queryText || "").trim()) return;
      loadRecent();
    });
  }

  function refresh() {
    bind();
    if (!isVisible()) return;
    if (String(queryText || "").trim()) runSearch(queryText);
    else loadRecent();
  }

  window.ffRefreshBookingClients = refresh;
  window.ffBookingClientsUi = {
    refresh: refresh,
    showClient: showClient,
    replaceClient: replaceClient,
    initials: initials,
    formatUpdated: formatUpdated,
    dash: dash
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
    else bind();
  }
})();
