/**
 * Clients Options drawer. Filter/sort chrome only — queries stay in ffBookingClients.
 */
(function () {
  var ROOT_ID = "ffBookingClientOptions";
  var OVERLAY_ID = "ffBookingClientOptionsOverlay";
  var filters = {
    created: "all",
    updated: "all",
    sort: "updated_desc"
  };
  var onChange = null;
  var bound = false;

  function host() {
    return document.getElementById("ffBookingWorkspace") || document.body;
  }

  function canOpen() {
    var workspace = document.getElementById("ffBookingWorkspace");
    if (workspace && workspace.hasAttribute("hidden")) return false;
    var shell = window.ffBookingState;
    if (shell && !shell.isBooking()) return false;
    return !!document.getElementById("ffBookingClientsRoot");
  }

  function radio(name, value, label, checked) {
    return (
      '<label class="ff-cli-opt-choice">' +
        '<input type="radio" name="' + name + '" value="' + value + '"' + (checked ? " checked" : "") + ">" +
        "<span>" + label + "</span>" +
      "</label>"
    );
  }

  function group(title, body) {
    return '<section class="ff-cli-opt-group"><h3>' + title + "</h3>" + body + "</section>";
  }

  function html() {
    return (
      '<button type="button" class="ff-cli-x ff-cli-opt-close" data-ff-cli-opt="close" aria-label="Close">×</button>' +
      '<div class="ff-cli-opt-body">' +
        group("Client created",
          radio("ffCliCreated", "all", "All time", filters.created === "all") +
          radio("ffCliCreated", "30", "Last 30 days", filters.created === "30") +
          radio("ffCliCreated", "90", "Last 90 days", filters.created === "90") +
          radio("ffCliCreated", "year", "This year", filters.created === "year")
        ) +
        group("Last updated",
          radio("ffCliUpdated", "all", "All time", filters.updated === "all") +
          radio("ffCliUpdated", "30", "Last 30 days", filters.updated === "30") +
          radio("ffCliUpdated", "90", "Last 90 days", filters.updated === "90")
        ) +
        group("Sort by",
          radio("ffCliSort", "updated_desc", "Recently Updated", filters.sort === "updated_desc") +
          radio("ffCliSort", "created_desc", "Recently Created", filters.sort === "created_desc") +
          radio("ffCliSort", "name_asc", "Name A–Z", filters.sort === "name_asc") +
          radio("ffCliSort", "name_desc", "Name Z–A", filters.sort === "name_desc")
        ) +
      "</div>"
    );
  }

  function ensureDom() {
    var overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.className = "ff-cli-opt-overlay";
      overlay.hidden = true;
      host().appendChild(overlay);
    } else if (overlay.parentNode !== host()) {
      host().appendChild(overlay);
    }
    var existing = document.getElementById(ROOT_ID);
    if (!existing) {
      existing = document.createElement("aside");
      existing.id = ROOT_ID;
      existing.className = "ff-cli-opt-drawer";
      existing.setAttribute("role", "dialog");
      existing.setAttribute("aria-label", "Client Options");
      existing.hidden = true;
      existing.innerHTML = html();
      host().appendChild(existing);
    } else if (existing.parentNode !== host()) {
      host().appendChild(existing);
    }
    if (!bound) {
      bound = true;
      overlay.addEventListener("click", close);
      existing.addEventListener("click", function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest("[data-ff-cli-opt=close]") : null;
        if (btn) close();
      });
      existing.addEventListener("change", function (ev) {
        var input = ev.target;
        if (!input || input.tagName !== "INPUT") return;
        if (input.name === "ffCliCreated") filters.created = input.value;
        if (input.name === "ffCliUpdated") filters.updated = input.value;
        if (input.name === "ffCliSort") filters.sort = input.value;
        if (typeof onChange === "function") onChange(getFilters());
      });
      document.addEventListener("keydown", function (ev) {
        if (ev.key !== "Escape" || !isOpen()) return;
        ev.preventDefault();
        close();
      });
    }
    return existing;
  }

  function paintChecked() {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.querySelectorAll("input[type=radio]").forEach(function (input) {
      if (input.name === "ffCliCreated") input.checked = input.value === filters.created;
      if (input.name === "ffCliUpdated") input.checked = input.value === filters.updated;
      if (input.name === "ffCliSort") input.checked = input.value === filters.sort;
    });
  }

  function open() {
    if (!canOpen()) return;
    if (window.ffBookingAppointmentDetails && window.ffBookingAppointmentDetails.forceClose) {
      window.ffBookingAppointmentDetails.forceClose();
    }
    if (window.ffBookingClientProfile) window.ffBookingClientProfile.close();
    ensureDom();
    paintChecked();
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
    return {
      created: filters.created,
      updated: filters.updated,
      sort: filters.sort
    };
  }

  function hasActiveFilters() {
    return filters.created !== "all" || filters.updated !== "all" || filters.sort !== "updated_desc";
  }

  window.ffBookingClientsOptions = {
    open: open,
    close: close,
    forceClose: close,
    isOpen: isOpen,
    getFilters: getFilters,
    hasActiveFilters: hasActiveFilters,
    setOnChange: function (fn) { onChange = fn; }
  };
})();
