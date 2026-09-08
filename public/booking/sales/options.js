/**
 * Sales Filters drawer. Query stays in the Sales repository / list.
 */
(function () {
  var ROOT_ID = "ffBookingSaleOptions";
  var OVERLAY_ID = "ffBookingSaleOptionsOverlay";
  var filters = null;
  var onChange = null;
  var bound = false;

  function model() { return window.ffBookingSalesModel || null; }

  function defaults() {
    return model() && model().defaultFilters ? model().defaultFilters() : {
      locationId: "", saleNumber: "", amountFrom: "", amountTo: "",
      date: "all", customFrom: "", customTo: "", status: "all",
      method: "all", processor: "all", channel: "all"
    };
  }

  function current() {
    if (!filters) filters = defaults();
    return filters;
  }

  function host() {
    return document.getElementById("ffBookingWorkspace") || document.body;
  }

  function canOpen() {
    var workspace = document.getElementById("ffBookingWorkspace");
    if (workspace && workspace.hasAttribute("hidden")) return false;
    var shell = window.ffBookingState;
    if (shell && !shell.isBooking()) return false;
    return !!document.getElementById("ffBookingSalesRoot");
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function locations() {
    var list = [];
    try {
      if (typeof window.ffGetLocations === "function") list = window.ffGetLocations() || [];
    } catch (_) {}
    if (!list.length && Array.isArray(window.__ff_locations)) list = window.__ff_locations;
    return list || [];
  }

  function option(value, label, selected) {
    return '<option value="' + escapeHtml(value) + '"' + (selected ? " selected" : "") + ">" + escapeHtml(label) + "</option>";
  }

  function field(label, body) {
    return (
      '<label class="ff-sale-opt-field"><span>' + escapeHtml(label) + "</span>" + body + "</label>"
    );
  }

  function html() {
    var f = current();
    var locOpts = option("", "This location", !f.locationId) +
      option("all", "All locations", f.locationId === "all") +
      locations().map(function (row) {
        var id = String(row && (row.id || row.locationId) || "");
        var name = String(row && (row.name || row.locationName) || id);
        return option(id, name, f.locationId === id);
      }).join("");
    return (
      '<header class="ff-sale-opt-head">' +
        "<h2>Filters</h2>" +
        '<button type="button" class="ff-sale-opt-x" data-ff-sale-opt="close" aria-label="Close">×</button>' +
      "</header>" +
      '<div class="ff-sale-opt-body">' +
        field("Location", '<select name="locationId">' + locOpts + "</select>") +
        field("Sale #", '<input name="saleNumber" type="text" inputmode="numeric" placeholder="e.g. 2" value="' + escapeHtml(f.saleNumber) + '">') +
        '<div class="ff-sale-opt-row">' +
          field("From amount", '<input name="amountFrom" type="number" min="0" step="0.01" placeholder="e.g. 20" value="' + escapeHtml(f.amountFrom) + '">') +
          field("To amount", '<input name="amountTo" type="number" min="0" step="0.01" placeholder="e.g. 100" value="' + escapeHtml(f.amountTo) + '">') +
        "</div>" +
        field("Date",
          '<select name="date">' +
            option("all", "All time", f.date === "all") +
            option("today", "Today", f.date === "today") +
            option("yesterday", "Yesterday", f.date === "yesterday") +
            option("this_week", "This week", f.date === "this_week") +
            option("last_week", "Last week", f.date === "last_week") +
            option("last_two_weeks", "Last two weeks", f.date === "last_two_weeks") +
            (model() && model().recentMonthPresets ? model().recentMonthPresets() : []).map(function (row) {
              return option(row.value, row.label, f.date === row.value);
            }).join("") +
            option("custom", "Custom period", f.date === "custom") +
          "</select>"
        ) +
        '<div class="ff-sale-opt-row' + (f.date === "custom" ? "" : " is-hidden") + '" data-ff-sale-opt-custom>' +
          field("From date", '<input name="customFrom" type="date" value="' + escapeHtml(f.customFrom) + '">') +
          field("To date", '<input name="customTo" type="date" value="' + escapeHtml(f.customTo) + '">') +
        "</div>" +
        field("Status",
          '<select name="status">' +
            option("all", "All", f.status === "all") +
            option("closed", "Closed", f.status === "closed") +
            option("open", "Open", f.status === "open") +
            option("refunded", "Refunded", f.status === "refunded") +
            option("reversed", "Reversed", f.status === "reversed") +
          "</select>"
        ) +
        field("Method",
          '<select name="method">' +
            option("all", "All", f.method === "all") +
            option("card", "Credit Card", f.method === "card") +
            option("cash", "Cash", f.method === "cash") +
            option("check", "Check", f.method === "check") +
            option("gift_card", "Gift Card", f.method === "gift_card") +
            option("house_discount", "House Discount", f.method === "house_discount") +
            option("other", "Other", f.method === "other") +
            option("none", "No method yet", f.method === "none") +
          "</select>"
        ) +
        field("Processor",
          '<select name="processor">' +
            option("all", "All", f.processor === "all") +
            option("fairflow", "Fair Flow", f.processor === "fairflow") +
            option("none", "No processor", f.processor === "none") +
          "</select>"
        ) +
        field("Channel",
          '<select name="channel">' +
            option("all", "All", f.channel === "all") +
            option("staff", "Staff member", f.channel === "staff") +
            option("self_checkout", "Self checkout", f.channel === "self_checkout") +
            option("automatic", "Automatic charge", f.channel === "automatic") +
            option("online", "Online booking", f.channel === "online") +
          "</select>"
        ) +
      "</div>"
    );
  }

  function emit() {
    if (typeof onChange === "function") onChange(getFilters());
  }

  function applyInput(input) {
    if (!input || !input.name) return;
    current()[input.name] = input.value;
    var custom = document.querySelector("[data-ff-sale-opt-custom]");
    if (custom) custom.classList.toggle("is-hidden", current().date !== "custom");
    emit();
  }

  function ensureDom() {
    var overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.className = "ff-sale-opt-overlay";
      overlay.hidden = true;
      host().appendChild(overlay);
    }
    var existing = document.getElementById(ROOT_ID);
    if (!existing) {
      existing = document.createElement("aside");
      existing.id = ROOT_ID;
      existing.className = "ff-sale-opt-drawer";
      existing.setAttribute("role", "dialog");
      existing.setAttribute("aria-label", "Sales filters");
      existing.hidden = true;
      host().appendChild(existing);
    }
    existing.innerHTML = html();
    if (!bound) {
      bound = true;
      overlay.addEventListener("click", close);
      existing.addEventListener("click", function (ev) {
        if (ev.target && ev.target.closest && ev.target.closest("[data-ff-sale-opt=close]")) close();
      });
      existing.addEventListener("change", function (ev) {
        applyInput(ev.target);
      });
      existing.addEventListener("input", function (ev) {
        var t = ev.target;
        if (!t || (t.name !== "saleNumber" && t.name !== "amountFrom" && t.name !== "amountTo")) return;
        applyInput(t);
      });
      document.addEventListener("keydown", function (ev) {
        if (ev.key !== "Escape" || !isOpen()) return;
        ev.preventDefault();
        close();
      });
    }
    return existing;
  }

  function open() {
    if (!canOpen()) return;
    if (window.ffBookingSalesMenu && window.ffBookingSalesMenu.close) window.ffBookingSalesMenu.close();
    if (window.ffBookingSalesCheckout && window.ffBookingSalesCheckout.forceClose) window.ffBookingSalesCheckout.forceClose();
    ensureDom();
    var overlay = document.getElementById(OVERLAY_ID);
    var root = document.getElementById(ROOT_ID);
    if (overlay) {
      overlay.hidden = false;
      overlay.classList.add("is-open");
    }
    if (root) {
      root.hidden = false;
      root.classList.add("is-open");
    }
  }

  function close() {
    var overlay = document.getElementById(OVERLAY_ID);
    var root = document.getElementById(ROOT_ID);
    if (overlay) {
      overlay.hidden = true;
      overlay.classList.remove("is-open");
    }
    if (root) {
      root.hidden = true;
      root.classList.remove("is-open");
    }
  }

  function isOpen() {
    var root = document.getElementById(ROOT_ID);
    return !!(root && !root.hidden && root.classList.contains("is-open"));
  }

  function getFilters() {
    return Object.assign({}, current());
  }

  function hasActiveFilters() {
    return !!(model() && model().filtersAreActive && model().filtersAreActive(current()));
  }

  window.ffBookingSalesOptions = {
    open: open,
    close: close,
    forceClose: close,
    isOpen: isOpen,
    getFilters: getFilters,
    hasActiveFilters: hasActiveFilters,
    setOnChange: function (fn) { onChange = fn; }
  };
})();
