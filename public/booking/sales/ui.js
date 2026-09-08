/**
 * Booking Sales screen. Lists checkout tickets and shows one sale at a time.
 */
(function () {
  var ROOT_ID = "ffBookingSalesRoot";
  var bound = false;
  var queryText = "";
  var rows = [];
  var selectedId = "";
  var status = "idle";
  var loadGen = 0;
  var lastFilterLoc = "";
  var extra = { saleId: "", client: null };

  function model() { return window.ffBookingSalesModel || null; }
  function repo() { return window.ffBookingSales || null; }
  function checkout() { return window.ffBookingSalesCheckout || null; }
  function options() { return window.ffBookingSalesOptions || null; }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isVisible() {
    var shell = window.ffBookingState;
    if (!shell || !shell.isBooking() || shell.getSection() !== "sales") return false;
    return !!document.getElementById(ROOT_ID);
  }

  function dateKey() {
    try {
      if (window.ffBookingCalState && typeof window.ffBookingCalState.getSelectedDateKey === "function") {
        return String(window.ffBookingCalState.getSelectedDateKey() || "").trim();
      }
    } catch (_) {}
    try {
      if (window.ffBookingTime && typeof window.ffBookingTime.todayDateKey === "function") {
        return String(window.ffBookingTime.todayDateKey() || "").trim();
      }
    } catch (_) {}
    return "";
  }

  function locationId() {
    try {
      if (window.ffBookingCalState && typeof window.ffBookingCalState.getLocationId === "function") {
        var fromCal = String(window.ffBookingCalState.getLocationId() || "").trim();
        if (fromCal) return fromCal;
      }
    } catch (_) {}
    try {
      if (typeof window.ffGetActiveLocationId === "function") {
        return String(window.ffGetActiveLocationId() || "").trim();
      }
    } catch (_) {}
    return String(window.__ff_active_location_id || "").trim();
  }

  function locations() {
    var list = [];
    try {
      if (typeof window.ffGetLocations === "function") list = window.ffGetLocations() || [];
    } catch (_) {}
    if (!list.length && Array.isArray(window.__ff_locations)) list = window.__ff_locations;
    return list || [];
  }

  function locationName(id) {
    var loc = String(id || locationId() || "").trim();
    var hit = locations().find(function (row) {
      return row && (String(row.id || "") === loc || String(row.locationId || "") === loc);
    });
    return (hit && (hit.name || hit.locationName)) || "";
  }

  function lookupStaffName(staffId, uid) {
    var id = String(staffId || "").trim();
    var authUid = String(uid || "").trim();
    if (!id && !authUid) return "";
    var list = [];
    try {
      if (typeof window.ffGetStaffStore === "function") {
        var store = window.ffGetStaffStore();
        if (store && Array.isArray(store.staff)) list = store.staff;
      }
    } catch (_) {}
    var hit = list.find(function (row) {
      if (!row) return false;
      return (id && (String(row.id || "") === id || String(row.staffId || "") === id))
        || (authUid && (String(row.uid || "") === authUid || String(row.firebaseUid || "") === authUid));
    });
    if (!hit) return "";
    return [hit.firstName, hit.lastName].filter(Boolean).join(" ").trim()
      || String(hit.displayName || hit.name || "").trim();
  }

  function staffName(sale) {
    var named = sale && sale.createdByName ? String(sale.createdByName).trim() : "";
    if (named) return named;
    return lookupStaffName(sale && sale.createdByStaffId, sale && sale.createdByUid);
  }

  function historyActorName(entry) {
    var named = entry && entry.byName ? String(entry.byName).trim() : "";
    if (named && named !== "Staff") return named;
    return lookupStaffName(entry && entry.byStaffId, entry && entry.byUid) || named || "Staff";
  }

  function loadClient(sale) {
    var id = sale && sale.clientId ? String(sale.clientId).trim() : "";
    if (!sale || extra.saleId === sale.saleId) return;
    extra = { saleId: sale.saleId, client: null };
    var api = window.ffBookingClients;
    if (!api || !id || typeof api.getClientById !== "function") return;
    api.getClientById(id).then(function (client) {
      if (extra.saleId !== sale.saleId) return;
      extra.client = client || null;
      if (isVisible()) paint();
    }).catch(function () {});
  }

  function visibleRows() {
    var api = model();
    if (!api || typeof api.matchesQuery !== "function") return rows;
    var list = rows.filter(function (row) { return api.matchesQuery(row, queryText); });
    if (api.matchesFilters && options() && options().getFilters) {
      var f = options().getFilters();
      list = list.filter(function (row) { return api.matchesFilters(row, f); });
    }
    return list;
  }

  function selectedSale() {
    return rows.find(function (row) { return row && row.saleId === selectedId; }) || null;
  }

  function emptyCopy() {
    if (status === "loading") return "Loading sales…";
    if (queryText) return "No sales match this search.";
    if (options() && options().hasActiveFilters && options().hasActiveFilters()) return "No sales match these filters.";
    return "No sales yet. Check out a visit or start a new checkout.";
  }

  function listHtml() {
    var api = model();
    var list = visibleRows();
    if (status === "loading" || !list.length) {
      return '<div class="ff-sale-empty">' + escapeHtml(emptyCopy()) + "</div>";
    }
    return (
      '<table class="ff-sale-table">' +
        "<thead><tr><th>#</th><th>Status</th><th>Date</th><th>Client</th><th>Total</th></tr></thead>" +
        "<tbody>" +
        list.map(function (row) {
          var on = row.saleId === selectedId;
          return '<tr class="ff-sale-row' + (on ? " is-selected" : "") + '" data-ff-sale-id="' + escapeHtml(row.saleId) + '">' +
            "<td>" + escapeHtml(api.saleLabel(row)) + "</td>" +
            '<td><span class="ff-sale-status is-' + escapeHtml(row.status) + '">' + escapeHtml(api.statusLabel(row.status)) + "</span></td>" +
            "<td>" + escapeHtml(api.formatDate(row.closedAt || row.createdAt)) + "</td>" +
            "<td>" + escapeHtml(api.clientName(row)) + "</td>" +
            '<td class="ff-sale-amt">' + escapeHtml(api.money(row.total)) + "</td>" +
          "</tr>";
        }).join("") +
        "</tbody></table>"
    );
  }

  function historyHtml(sale) {
    var api = model();
    var events = sale && sale.history ? sale.history : [];
    if (!api || typeof api.historyLabel !== "function" || !events.length) return "";
    var lines = events.map(function (row) {
      var text = api.historyLabel(Object.assign({}, row, { byName: historyActorName(row) }), sale.locationId);
      return text ? "<li>" + escapeHtml(text) + "</li>" : "";
    }).join("");
    if (!lines) return "";
    return (
      '<div class="ff-sale-history">' +
        '<span class="ff-sale-field-label">History</span>' +
        '<ul class="ff-sale-history-list">' + lines + "</ul>" +
      "</div>"
    );
  }

  function fieldHtml(label, value) {
    if (!value) return "";
    return (
      '<div class="ff-sale-field">' +
        '<span class="ff-sale-field-label">' + escapeHtml(label) + "</span>" +
        '<div class="ff-sale-field-value">' + value + "</div>" +
      "</div>"
    );
  }

  function initialsFor(client, fallbackName) {
    if (client && window.ffBookingClientsUi && typeof window.ffBookingClientsUi.initials === "function") {
      return window.ffBookingClientsUi.initials(client);
    }
    var name = String((client && client.displayName) || fallbackName || "").trim();
    var parts = name.split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function clientBlockHtml(sale) {
    var api = model();
    var name = api.clientName(sale);
    var client = extra.saleId === sale.saleId ? extra.client : null;
    var url = client && client.photoUrl ? String(client.photoUrl).trim() : "";
    var since = client && client.createdAt ? api.clientSinceLabel(client.createdAt) : "";
    var avatar = url
      ? '<img class="ff-sale-avatar" src="' + escapeHtml(url) + '" alt="">'
      : '<span class="ff-sale-avatar is-initials">' + escapeHtml(initialsFor(client, name)) + "</span>";
    return (
      '<div class="ff-sale-field">' +
        '<span class="ff-sale-field-label">Client</span>' +
        '<div class="ff-sale-client">' +
          avatar +
          '<div class="ff-sale-client-copy">' +
            "<strong>" + escapeHtml(name) + "</strong>" +
            (since ? "<em>" + escapeHtml(since) + "</em>" : "") +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  function detailHtml() {
    var api = model();
    var sale = selectedSale();
    if (!sale) {
      return (
        '<div class="ff-sale-detail-empty">' +
          "<p>Create a new checkout or select an existing sale to view details.</p>" +
        "</div>"
      );
    }
    loadClient(sale);
    var loc = locationName(sale.locationId);
    var createdBy = staffName(sale);
    var createdWhen = api.formatWhen(sale.createdAt || sale.closedAt, sale.locationId);
    var items = (sale.items || []).map(function (item) {
      return (
        '<li class="ff-sale-item">' +
          "<span>" + escapeHtml(item.name) +
            (item.providerName ? '<em>' + escapeHtml(item.providerName) + "</em>" : "") +
          "</span>" +
          '<span class="ff-sale-item-amt">' + escapeHtml(api.money(item.amount)) + "</span>" +
        "</li>"
      );
    }).join("");
    return (
      '<div class="ff-sale-detail">' +
        '<header class="ff-sale-detail-head">' +
          '<div class="ff-sale-detail-title">' +
            "<h2>" + escapeHtml(api.saleLabel(sale)) + "</h2>" +
            '<span class="ff-sale-status is-' + escapeHtml(sale.status) + '">' + escapeHtml(api.statusLabel(sale.status)) + "</span>" +
          "</div>" +
          (window.ffBookingSalesMenu && window.ffBookingSalesMenu.html ? window.ffBookingSalesMenu.html() : "") +
        "</header>" +
        clientBlockHtml(sale) +
        fieldHtml("Location", escapeHtml(loc || "—")) +
        '<div class="ff-sale-field">' +
          '<span class="ff-sale-field-label">Services</span>' +
          '<ul class="ff-sale-items">' + items + "</ul>" +
          (Number(sale.tip) > 0 ? '<div class="ff-sale-tip"><span>Tip</span><span>' + escapeHtml(api.money(sale.tip)) + "</span></div>" : "") +
          '<div class="ff-sale-total"><span>Total</span><strong>' + escapeHtml(api.money(sale.total)) + "</strong></div>" +
        "</div>" +
        (sale.notes ? fieldHtml("Notes", escapeHtml(sale.notes)) : "") +
        fieldHtml("Sale details", "<strong>" + escapeHtml(createdWhen) + "</strong>" +
          (createdBy ? "<em>Created by " + escapeHtml(createdBy) + "</em>" : "<em>Created by staff</em>")) +
        historyHtml(sale) +
      "</div>"
    );
  }

  function paint() {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    if (!root.querySelector(".ff-sale")) {
      root.innerHTML =
        '<div class="ff-sale">' +
          '<div class="ff-sale-main">' +
            '<div class="ff-sale-toolbar">' +
              '<div class="ff-sale-toolbar-left">' +
                '<button type="button" class="ff-sale-add" data-ff-sale-act="new">+ New Checkout</button>' +
                '<input id="ffSaleSearch" class="ff-sale-search" type="text" inputmode="search" autocomplete="off" placeholder="Search by number or client">' +
              "</div>" +
              '<div class="ff-sale-toolbar-right">' +
                '<div class="ff-sale-loc" id="ffSaleLoc"></div>' +
                '<button type="button" class="ff-sale-filters" data-ff-sale-act="filters">' +
                  '<span class="ff-sale-filters-icon" aria-hidden="true">' +
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                      '<line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line>' +
                      '<line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line>' +
                      '<line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line>' +
                      '<line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line>' +
                      '<line x1="17" y1="16" x2="23" y2="16"></line>' +
                    "</svg></span>Filters</button>" +
              "</div>" +
            "</div>" +
            '<div class="ff-sale-body"></div>' +
          "</div>" +
          '<aside class="ff-sale-pane" id="ffSalePane"></aside>' +
        "</div>";
    }
    var input = document.getElementById("ffSaleSearch");
    if (input && document.activeElement !== input) input.value = queryText;
    var loc = document.getElementById("ffSaleLoc");
    var f = options() && options().getFilters ? options().getFilters() : {};
    if (loc) {
      loc.textContent = f.locationId === "all" ? "All locations" : locationName(f.locationId || locationId());
    }
    var filterBtn = root.querySelector("[data-ff-sale-act='filters']");
    if (filterBtn) filterBtn.classList.toggle("is-on", !!(options() && options().hasActiveFilters && options().hasActiveFilters()));
    var body = root.querySelector(".ff-sale-body");
    var pane = document.getElementById("ffSalePane");
    if (body) body.innerHTML = listHtml();
    if (pane) pane.innerHTML = detailHtml();
  }

  async function loadRows() {
    var api = repo();
    var f = options() && options().getFilters ? options().getFilters() : {};
    lastFilterLoc = f.locationId || "";
    var loc = f.locationId === "all" ? "" : (f.locationId || locationId());
    var gen = ++loadGen;
    status = "loading";
    paint();
    var next = [];
    try {
      if (api && typeof api.backfillCompletedForDate === "function" && (loc || locationId())) {
        await api.backfillCompletedForDate(dateKey(), loc || locationId());
      }
      if (f.locationId === "all" && api && typeof api.listForSalon === "function") {
        next = await api.listForSalon();
      } else if (api && typeof api.listForLocation === "function" && loc) {
        next = await api.listForLocation(loc);
      }
    } catch (_) {
      next = [];
    }
    if (gen !== loadGen) return;
    rows = next || [];
    if (selectedId && !rows.some(function (row) { return row.saleId === selectedId; })) selectedId = "";
    status = "idle";
    paint();
  }

  function onSearch(ev) {
    var input = ev.target && ev.target.closest ? ev.target.closest("#ffSaleSearch") : null;
    if (!input) return;
    queryText = input.value || "";
    paint();
  }

  function onClick(ev) {
    var t = ev.target;
    if (!t || typeof t.closest !== "function") return;
    var root = document.getElementById(ROOT_ID);
    if (!root || !root.contains(t)) return;
    if (t.closest("[data-ff-sale-act='filters']")) {
      ev.preventDefault();
      if (options() && options().open) options().open();
      return;
    }
    if (t.closest("[data-ff-sale-act='new']")) {
      ev.preventDefault();
      var ck = checkout();
      if (ck && typeof ck.open === "function") ck.open({ locationId: locationId() });
      return;
    }
    var row = t.closest("[data-ff-sale-id]");
    if (!row) return;
    selectedId = row.getAttribute("data-ff-sale-id") || "";
    if (window.ffBookingSalesMenu && window.ffBookingSalesMenu.close) window.ffBookingSalesMenu.close();
    paint();
  }

  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener("input", onSearch);
    document.addEventListener("click", onClick);
    document.addEventListener("ff-booking-sale-created", function (ev) {
      var sale = ev && ev.detail && ev.detail.sale;
      if (sale && sale.saleId) selectedId = sale.saleId;
      if (isVisible()) loadRows();
    });
    document.addEventListener("ff-booking-sale-updated", function (ev) {
      var sale = ev && ev.detail && ev.detail.sale;
      if (!sale || !sale.saleId) return;
      rows = rows.map(function (row) { return row && row.saleId === sale.saleId ? sale : row; });
      if (isVisible()) paint();
    });
  }

  function refresh() {
    bind();
    if (options() && typeof options().setOnChange === "function") {
      options().setOnChange(function () {
        if (!isVisible()) return;
        var next = options().getFilters();
        var locKey = next.locationId || "";
        if (locKey !== lastFilterLoc) {
          lastFilterLoc = locKey;
          loadRows();
          return;
        }
        paint();
      });
    }
    paint();
    loadRows();
  }

  window.ffRefreshBookingSales = refresh;
  window.ffBookingSalesUi = {
    refresh: refresh,
    select: function (saleId) {
      selectedId = String(saleId || "").trim();
      if (isVisible()) paint();
    },
    getSelected: selectedSale,
    getSelectedClient: function () {
      return extra && extra.saleId === selectedId ? extra.client : null;
    }
  };
})();
