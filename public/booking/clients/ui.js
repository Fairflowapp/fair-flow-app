/**
 * Booking Clients V2 screen. Bounded browse + targeted search via ffBookingClients.
 */
(function () {
  var ROOT_ID = "ffBookingClientsRoot";
  var PAGE_SIZE = 50;
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var searchTimer = null;
  var bound = false;
  var queryText = "";
  var rows = [];
  var status = "idle";
  var searchGen = 0;
  var pageIndex = 0;
  var cursorStack = [];
  var hasMore = false;
  var totalCount = null;
  var mode = "browse";

  function repo() { return window.ffBookingClients || null; }
  function options() { return window.ffBookingClientsOptions || null; }

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

  function daysAgo(days) {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  function startOfThisYear() {
    var tm = window.ffBookingTime;
    if (tm && typeof tm.now === "function" && typeof tm.zonedDateKey === "function") {
      var key = tm.zonedDateKey(tm.now());
      var y = parseInt(String(key || "").slice(0, 4), 10);
      if (y) return new Date(y, 0, 1);
    }
    return new Date(new Date().getFullYear(), 0, 1);
  }

  function rangeFrom(kind) {
    if (kind === "30") return daysAgo(30);
    if (kind === "90") return daysAgo(90);
    if (kind === "year") return startOfThisYear();
    return null;
  }

  function browseSpec(cursor) {
    var f = options() && options().getFilters ? options().getFilters() : { created: "all", updated: "all", sort: "updated_desc" };
    return {
      sort: f.sort || "updated_desc",
      createdFrom: rangeFrom(f.created),
      updatedFrom: rangeFrom(f.updated),
      cursor: cursor || null,
      pageSize: PAGE_SIZE
    };
  }

  function filtersActive() {
    return !!(options() && options().hasActiveFilters && options().hasActiveFilters());
  }

  function emptyCopy() {
    if (status === "loading") return "Loading...";
    if (status === "searching") return "Searching...";
    if (mode === "search") return "No clients found";
    if (filtersActive()) return "No clients match these filters";
    return "No clients yet";
  }

  function avatarHtml(row) {
    var url = String(row && row.photoUrl || "").trim();
    if (url) {
      return '<img class="ff-cli-avatar" src="' + escapeHtml(url) + '" alt="">';
    }
    return '<span class="ff-cli-initials">' + escapeHtml(initials(row)) + "</span>";
  }

  function bodyHtml() {
    if (status === "loading" || status === "searching" || !rows.length) {
      return '<div class="ff-cli-empty">' + escapeHtml(emptyCopy()) + "</div>";
    }
    return (
      '<table class="ff-cli-table">' +
        "<thead><tr><th>Client</th><th>Email</th><th>Phone</th><th>Last updated</th></tr></thead>" +
        "<tbody>" +
        rows.map(function (row) {
          return '<tr class="ff-cli-row" data-ff-cli-id="' + escapeHtml(row.clientId) + '">' +
            '<td><span class="ff-cli-who">' + avatarHtml(row) +
            '<span class="ff-cli-name">' + escapeHtml(row.displayName || "Client") + "</span></span></td>" +
            '<td class="ff-cli-email">' + escapeHtml(dash(row.email)) + "</td>" +
            '<td class="ff-cli-phone">' + escapeHtml(dash(row.phone)) + "</td>" +
            '<td class="ff-cli-updated">' + escapeHtml(formatUpdated(row.updatedAt || row.createdAt)) + "</td>" +
          "</tr>";
        }).join("") +
        "</tbody></table>"
    );
  }

  function countHtml() {
    if (mode === "search") {
      if (!rows.length) return "";
      return '<span class="ff-cli-count">' + rows.length + (rows.length === 1 ? " result" : " results") + "</span>";
    }
    if (totalCount == null) return "";
    return '<span class="ff-cli-count">' + totalCount + (totalCount === 1 ? " client" : " clients") + "</span>";
  }

  function pagerHtml() {
    if (mode !== "browse") return "";
    if (pageIndex === 0 && !hasMore && rows.length < PAGE_SIZE && totalCount != null && totalCount <= PAGE_SIZE) return "";
    if (pageIndex === 0 && !hasMore && !rows.length) return "";
    return (
      '<div class="ff-cli-pager">' +
        '<button type="button" class="ff-cli-page-btn" data-ff-cli-page="prev"' + (pageIndex <= 0 ? " disabled" : "") + ">Previous</button>" +
        '<button type="button" class="ff-cli-page-btn" data-ff-cli-page="next"' + (hasMore ? "" : " disabled") + ">Next</button>" +
      "</div>"
    );
  }

  function slidersIcon() {
    return (
      '<span class="ff-cli-opt-icon" aria-hidden="true">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' +
          '<line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line>' +
          '<line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line>' +
          '<line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line>' +
          '<line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line>' +
          '<line x1="17" y1="16" x2="23" y2="16"></line>' +
        "</svg>" +
      "</span>"
    );
  }

  function paint() {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    if (!root.querySelector(".ff-cli")) {
      root.innerHTML =
        '<div class="ff-cli">' +
          '<div class="ff-cli-toolbar">' +
            '<div class="ff-cli-toolbar-left">' +
              '<button type="button" class="ff-cli-add" data-ff-cli-act="add">+ Add Client</button>' +
              '<input id="ffCliSearch" class="ff-cli-search-input" type="text" inputmode="search" autocomplete="off" placeholder="Search by name, email, or phone" value="' +
              escapeHtml(queryText) + '">' +
            "</div>" +
            '<button type="button" class="ff-cli-options" data-ff-cli-act="options">' + slidersIcon() + "Options</button>" +
          "</div>" +
          '<div class="ff-cli-meta"></div>' +
          '<div class="ff-cli-body"></div>' +
          '<div class="ff-cli-pager-slot"></div>' +
        "</div>";
    }
    var input = document.getElementById("ffCliSearch");
    if (input && document.activeElement !== input) input.value = queryText;
    var meta = root.querySelector(".ff-cli-meta");
    var body = root.querySelector(".ff-cli-body");
    var pagerSlot = root.querySelector(".ff-cli-pager-slot");
    if (meta) meta.innerHTML = countHtml();
    if (body) body.innerHTML = bodyHtml();
    if (pagerSlot) pagerSlot.innerHTML = pagerHtml();
  }

  function resetPaging() {
    pageIndex = 0;
    cursorStack = [];
    hasMore = false;
  }

  async function loadCount() {
    var api = repo();
    if (!api || typeof api.countClients !== "function") {
      totalCount = null;
      return;
    }
    try {
      totalCount = await api.countClients(browseSpec(null));
    } catch (_) {
      totalCount = null;
    }
  }

  async function loadBrowse(cursor) {
    var api = repo();
    var gen = ++searchGen;
    mode = "browse";
    status = "loading";
    paint();
    var page = { clients: [], cursor: null, hasMore: false };
    try {
      page = api && typeof api.listClientsPage === "function"
        ? await api.listClientsPage(browseSpec(cursor))
        : { clients: await api.getRecentClients(PAGE_SIZE), cursor: null, hasMore: false };
    } catch (_) {
      page = { clients: [], cursor: null, hasMore: false };
    }
    if (gen !== searchGen) return;
    rows = page.clients || [];
    hasMore = !!page.hasMore;
    if (cursorStack.length === pageIndex) cursorStack.push(page.cursor || null);
    else cursorStack[pageIndex] = page.cursor || null;
    status = rows.length ? "browse" : "empty";
    await loadCount();
    if (gen !== searchGen) return;
    paint();
  }

  async function runSearch(raw) {
    var api = repo();
    var q = String(raw || "").trim();
    queryText = q;
    if (!q) {
      resetPaging();
      await loadBrowse(null);
      return;
    }
    if (options()) options().close();
    var gen = ++searchGen;
    mode = "search";
    status = "searching";
    paint();
    var found = [];
    try {
      found = api ? await api.searchClients(q) : [];
    } catch (err) {
      found = [];
      try { console.error("Client search failed", err); } catch (_) {}
    }
    if (gen !== searchGen) return;
    rows = found || [];
    totalCount = null;
    status = rows.length ? "results" : "empty";
    paint();
  }

  function scheduleSearch(raw) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { runSearch(raw); }, 300);
  }

  function showClient(client) {
    queryText = "";
    resetPaging();
    if (client) {
      rows = [client];
      status = "browse";
      mode = "browse";
      paint();
    }
    loadBrowse(null);
  }

  function replaceClient(client) {
    if (!client || !client.clientId) return;
    var next = rows.slice();
    var idx = next.findIndex(function (row) { return row.clientId === client.clientId; });
    if (idx >= 0) next[idx] = client;
    else next = [client].concat(next);
    rows = next;
    status = rows.length ? (mode === "search" ? "results" : "browse") : "empty";
    paint();
  }

  function goNext() {
    if (!hasMore) return;
    pageIndex += 1;
    loadBrowse(cursorStack[pageIndex - 1] || null);
  }

  function goPrev() {
    if (pageIndex <= 0) return;
    pageIndex -= 1;
    cursorStack.length = pageIndex + 1;
    var prevCursor = pageIndex === 0 ? null : cursorStack[pageIndex - 1];
    loadBrowse(prevCursor);
  }

  function onFiltersChanged() {
    if (String(queryText || "").trim()) return;
    resetPaging();
    loadBrowse(null);
  }

  function bind() {
    if (bound) return;
    bound = true;
    if (options() && typeof options().setOnChange === "function") {
      options().setOnChange(onFiltersChanged);
    }
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== "function") return;
      var root = document.getElementById(ROOT_ID);
      if (!root || !root.contains(t)) return;
      if (t.closest("[data-ff-cli-act=add]")) {
        ev.preventDefault();
        if (options()) options().close();
        if (window.ffBookingClientsDrawer) window.ffBookingClientsDrawer.openAdd();
        return;
      }
      if (t.closest("[data-ff-cli-act=options]")) {
        ev.preventDefault();
        if (options()) options().open();
        return;
      }
      if (t.closest("[data-ff-cli-page=next]")) {
        ev.preventDefault();
        goNext();
        return;
      }
      if (t.closest("[data-ff-cli-page=prev]")) {
        ev.preventDefault();
        goPrev();
        return;
      }
      var row = t.closest("[data-ff-cli-id]");
      if (row && window.ffBookingClientsDrawer) {
        ev.preventDefault();
        if (options()) options().close();
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
      resetPaging();
      loadBrowse(null);
    });
  }

  function refresh() {
    bind();
    if (!isVisible()) return;
    if (String(queryText || "").trim()) runSearch(queryText);
    else {
      resetPaging();
      loadBrowse(null);
    }
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
