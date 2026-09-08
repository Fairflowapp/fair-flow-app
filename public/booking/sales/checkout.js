/**
 * Walk-in checkout drawer. Creates a closed sale. Does not book a calendar slot.
 */
(function () {
  var ROOT_ID = "ffBookingSaleCheckout";
  var searchTimer = null;
  var searchGen = 0;
  var catalog = [];
  var state = null;

  function model() { return window.ffBookingSalesModel || null; }
  function repo() { return window.ffBookingSales || null; }
  function clients() { return window.ffBookingClients || null; }
  function services() { return window.ffBookingAppointmentServices || null; }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function host() {
    return document.getElementById("ffBookingWorkspace") || document.body;
  }

  function money(value) {
    return model() && model().money ? model().money(value) : "$0.00";
  }

  function emptyState(locationId) {
    return {
      locationId: String(locationId || "").trim(),
      client: null,
      clientQ: "",
      items: [],
      serviceQ: "",
      tip: "",
      appointment: null,
      locked: false,
      saving: false,
      error: ""
    };
  }

  function subtotal() {
    return (state && state.items || []).reduce(function (sum, item) {
      return sum + (Number(item && item.amount) || 0);
    }, 0);
  }

  function tipAmount() {
    var api = model();
    if (api && typeof api.normalizeTip === "function") return api.normalizeTip(state && state.tip);
    var n = Number(state && state.tip);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function total() {
    var api = model();
    if (api && typeof api.totalsFromItems === "function") return api.totalsFromItems(state && state.items, state && state.tip).total;
    return subtotal() + tipAmount();
  }

  function ensureDom() {
    var existing = document.getElementById(ROOT_ID);
    if (existing && !existing.querySelector("#ffSaleCkTip")) {
      existing.parentNode.removeChild(existing);
      existing = null;
    }
    if (existing) return existing;
    var aside = document.createElement("aside");
    aside.id = ROOT_ID;
    aside.className = "ff-sale-ck";
    aside.setAttribute("role", "dialog");
    aside.setAttribute("aria-labelledby", "ffSaleCkTitle");
    aside.hidden = true;
    aside.innerHTML =
      '<header class="ff-sale-ck-head">' +
        '<h2 id="ffSaleCkTitle">New Checkout</h2>' +
        '<button type="button" class="ff-sale-ck-x" data-ff-sale-ck="close" aria-label="Close">×</button>' +
      "</header>" +
      '<div class="ff-sale-ck-body">' +
        '<label class="ff-sale-ck-field"><span>Client</span>' +
          '<input id="ffSaleCkClientQ" type="text" inputmode="search" autocomplete="off" placeholder="Search or pick a client">' +
        "</label>" +
        '<div id="ffSaleCkClientHits" class="ff-sale-ck-hits" hidden></div>' +
        '<div id="ffSaleCkClient" class="ff-sale-ck-chosen" hidden></div>' +
        '<label class="ff-sale-ck-field"><span>Add a service</span>' +
          '<input id="ffSaleCkServiceQ" type="text" inputmode="search" autocomplete="off" placeholder="Search services">' +
        "</label>" +
        '<div id="ffSaleCkServiceHits" class="ff-sale-ck-hits" hidden></div>' +
        '<ul id="ffSaleCkItems" class="ff-sale-ck-items"></ul>' +
        '<div class="ff-sale-ck-tip">' +
          '<label class="ff-sale-ck-field"><span>Tip</span>' +
            '<input id="ffSaleCkTip" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00">' +
          "</label>" +
          '<div class="ff-sale-ck-tip-presets">' +
            '<button type="button" data-ff-sale-ck="tip" data-ff-sale-tip="0.15">15%</button>' +
            '<button type="button" data-ff-sale-ck="tip" data-ff-sale-tip="0.18">18%</button>' +
            '<button type="button" data-ff-sale-ck="tip" data-ff-sale-tip="0.20">20%</button>' +
            '<button type="button" data-ff-sale-ck="tip" data-ff-sale-tip="0">No tip</button>' +
          "</div>" +
        "</div>" +
        '<p id="ffSaleCkError" class="ff-sale-ck-error" hidden></p>' +
      "</div>" +
      '<footer class="ff-sale-ck-foot">' +
        '<div class="ff-sale-ck-sum" id="ffSaleCkSum"></div>' +
        '<div class="ff-sale-ck-total"><span>Total</span><strong id="ffSaleCkTotal">$0.00</strong></div>' +
        '<button type="button" class="ff-sale-ck-go" data-ff-sale-ck="complete">Complete Sale</button>' +
      "</footer>";
    host().appendChild(aside);
    return aside;
  }

  function els() {
    return {
      root: document.getElementById(ROOT_ID),
      clientQ: document.getElementById("ffSaleCkClientQ"),
      clientHits: document.getElementById("ffSaleCkClientHits"),
      client: document.getElementById("ffSaleCkClient"),
      serviceQ: document.getElementById("ffSaleCkServiceQ"),
      serviceHits: document.getElementById("ffSaleCkServiceHits"),
      items: document.getElementById("ffSaleCkItems"),
      error: document.getElementById("ffSaleCkError"),
      tip: document.getElementById("ffSaleCkTip"),
      sum: document.getElementById("ffSaleCkSum"),
      title: document.getElementById("ffSaleCkTitle"),
      total: document.getElementById("ffSaleCkTotal"),
      go: document.querySelector("#" + ROOT_ID + " [data-ff-sale-ck='complete']")
    };
  }

  function paint() {
    var ui = els();
    if (!ui.root || !state) return;
    if (ui.title) ui.title.textContent = state.appointment ? "Check Out" : "New Checkout";
    if (state.locked) {
      if (ui.clientHits) ui.clientHits.hidden = true;
      if (ui.serviceHits) ui.serviceHits.hidden = true;
    }
    if (ui.clientQ) {
      ui.clientQ.parentNode.hidden = !!state.locked;
      if (document.activeElement !== ui.clientQ) ui.clientQ.value = state.clientQ;
    }
    if (ui.serviceQ) {
      ui.serviceQ.parentNode.hidden = !!state.locked;
      if (document.activeElement !== ui.serviceQ) ui.serviceQ.value = state.serviceQ;
    }
    if (ui.client) {
      ui.client.hidden = !state.client;
      ui.client.innerHTML = state.client
        ? "<strong>" + escapeHtml(state.client.displayName || "Client") + "</strong>" +
          (state.locked ? "" : '<button type="button" data-ff-sale-ck="clear-client">Change</button>')
        : "";
    }
    if (ui.items) {
      ui.items.innerHTML = (state.items || []).map(function (item, index) {
        return '<li><span>' + escapeHtml(item.name) + "</span><strong>" + escapeHtml(money(item.amount)) +
          "</strong>" +
          (state.locked ? "" : '<button type="button" data-ff-sale-ck="remove" data-ff-sale-i="' + index + '" aria-label="Remove">×</button>') +
          "</li>";
      }).join("");
    }
    if (ui.tip && document.activeElement !== ui.tip) ui.tip.value = state.tip;
    if (ui.sum) {
      var tip = tipAmount();
      ui.sum.hidden = !(tip > 0);
      ui.sum.innerHTML = tip > 0
        ? "<span>Services " + escapeHtml(money(subtotal())) + "</span><span>Tip " + escapeHtml(money(tip)) + "</span>"
        : "";
    }
    if (ui.total) ui.total.textContent = money(total());
    if (ui.error) {
      ui.error.hidden = !state.error;
      ui.error.textContent = state.error || "";
    }
    if (ui.go) {
      ui.go.disabled = !!state.saving;
      ui.go.textContent = state.saving ? "Saving…" : "Complete Sale";
    }
  }

  function showHits(hostEl, rows, empty) {
    if (!hostEl) return;
    hostEl.hidden = false;
    if (!rows || !rows.length) {
      hostEl.innerHTML = '<div class="ff-sale-ck-empty">' + escapeHtml(empty) + "</div>";
      return;
    }
    hostEl.innerHTML = rows.map(function (row) {
      return '<button type="button" class="ff-sale-ck-hit" data-ff-sale-pick="' + escapeHtml(row.id) + '">' +
        "<strong>" + escapeHtml(row.name) + "</strong>" +
        (row.meta ? "<span>" + escapeHtml(row.meta) + "</span>" : "") +
      "</button>";
    }).join("");
  }

  async function searchClients(raw) {
    var api = clients();
    var gen = ++searchGen;
    var q = String(raw || "").trim();
    var ui = els();
    if (!q || !api || typeof api.searchClients !== "function") {
      if (ui.clientHits) ui.clientHits.hidden = true;
      return;
    }
    showHits(ui.clientHits, [], "Searching…");
    var found = [];
    try {
      found = await api.searchClients(q);
    } catch (_) {
      found = [];
    }
    if (gen !== searchGen) return;
    showHits(ui.clientHits, (found || []).slice(0, 8).map(function (row) {
      return {
        id: row.clientId,
        name: row.displayName || "Client",
        meta: row.phone || row.email || "",
        raw: row
      };
    }), "No clients found");
    ui.clientHits.querySelectorAll("[data-ff-sale-pick]").forEach(function (btn) {
      var id = btn.getAttribute("data-ff-sale-pick");
      var hit = (found || []).find(function (row) { return row.clientId === id; });
      btn.addEventListener("click", function () {
        if (!hit) return;
        state.client = hit;
        state.clientQ = "";
        ui.clientHits.hidden = true;
        paint();
      }, { once: true });
    });
  }

  function serviceHits(raw) {
    var q = String(raw || "").trim().toLowerCase();
    var ui = els();
    if (!q) {
      if (ui.serviceHits) ui.serviceHits.hidden = true;
      return;
    }
    var rows = catalog.filter(function (svc) {
      return String(svc.name || "").toLowerCase().indexOf(q) !== -1;
    }).slice(0, 8);
    showHits(ui.serviceHits, rows.map(function (svc) {
      return { id: svc.id, name: svc.name, meta: money(svc.price) };
    }), "No services found");
    ui.serviceHits.querySelectorAll("[data-ff-sale-pick]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-ff-sale-pick");
        var svc = catalog.find(function (row) { return row.id === id; });
        if (!svc) return;
        state.items.push({
          kind: "service",
          name: svc.name,
          serviceId: svc.id,
          amount: Number(svc.price) || 0
        });
        state.serviceQ = "";
        ui.serviceHits.hidden = true;
        paint();
      }, { once: true });
    });
  }

  async function loadCatalog() {
    var api = services();
    if (!api || typeof api.listAll !== "function") {
      catalog = [];
      return;
    }
    try {
      catalog = await api.listAll();
    } catch (_) {
      catalog = [];
    }
  }

  async function complete() {
    if (!state || state.saving) return;
    if (!state.client) {
      state.error = "Pick a client first.";
      paint();
      return;
    }
    if (!(state.items || []).length) {
      state.error = "Add at least one service.";
      paint();
      return;
    }
    var api = repo();
    if (!api || typeof api.createSale !== "function") {
      state.error = "Sales are not ready.";
      paint();
      return;
    }
    state.saving = true;
    state.error = "";
    paint();
    var result;
    try {
      var tip = tipAmount();
      if (state.appointment && typeof api.createFromAppointment === "function") {
        result = await api.createFromAppointment(state.appointment, { tip: tip });
        if (result && result.ok && window.ffBookingAppointments && typeof window.ffBookingAppointments.updateAppointment === "function") {
          await window.ffBookingAppointments.updateAppointment(state.appointment.appointmentId, { status: "completed" });
        }
      } else {
        result = await api.createSale({
          locationId: state.locationId,
          clientId: state.client.clientId,
          clientSnapshot: {
            displayName: state.client.displayName,
            phone: state.client.phone,
            email: state.client.email
          },
          status: "closed",
          source: "walk_in",
          items: state.items,
          tip: tip
        });
      }
    } catch (err) {
      result = { ok: false, error: err && err.message ? err.message : "This sale could not be saved." };
    }
    state.saving = false;
    if (!result || !result.ok) {
      state.error = (result && result.error) || "This sale could not be saved.";
      paint();
      return;
    }
    close();
  }

  function onClick(ev) {
    var t = ev.target;
    if (!t || typeof t.closest !== "function") return;
    var root = document.getElementById(ROOT_ID);
    if (!root || !root.contains(t)) return;
    var act = t.closest("[data-ff-sale-ck]");
    if (!act) return;
    var name = act.getAttribute("data-ff-sale-ck");
    if (name === "close") close();
    else if (name === "clear-client") {
      state.client = null;
      paint();
    } else if (name === "remove") {
      var i = Number(act.getAttribute("data-ff-sale-i"));
      if (Number.isFinite(i)) state.items.splice(i, 1);
      paint();
    } else if (name === "tip") {
      var pct = Number(act.getAttribute("data-ff-sale-tip"));
      state.tip = pct > 0 ? String((Math.round(subtotal() * pct * 100) / 100).toFixed(2)) : "";
      paint();
    } else if (name === "complete") complete();
  }

  function onInput(ev) {
    var t = ev.target;
    if (!state || !t) return;
    if (t.id === "ffSaleCkClientQ") {
      state.clientQ = t.value || "";
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { searchClients(state.clientQ); }, 180);
    } else if (t.id === "ffSaleCkServiceQ") {
      state.serviceQ = t.value || "";
      serviceHits(state.serviceQ);
    } else if (t.id === "ffSaleCkTip") {
      state.tip = t.value || "";
      paint();
    }
  }

  function bind() {
    if (document.documentElement.getAttribute("data-ff-sale-ck")) return;
    document.documentElement.setAttribute("data-ff-sale-ck", "1");
    document.addEventListener("click", onClick);
    document.addEventListener("input", onInput);
  }

  function open(opts) {
    if (window.ffBookingSalesOptions && window.ffBookingSalesOptions.forceClose) window.ffBookingSalesOptions.forceClose();
    bind();
    ensureDom();
    state = emptyState(opts && opts.locationId);
    var appointment = opts && opts.appointment;
    if (appointment) {
      var api = model();
      var snap = appointment.clientSnapshot && typeof appointment.clientSnapshot === "object" ? appointment.clientSnapshot : {};
      state.appointment = appointment;
      state.locked = true;
      state.locationId = appointment.locationId || state.locationId;
      state.client = {
        clientId: appointment.clientId,
        displayName: snap.displayName || "Client",
        phone: snap.phone || "",
        email: snap.email || ""
      };
      state.items = api && typeof api.itemsFromAppointment === "function"
        ? api.itemsFromAppointment(appointment)
        : [];
    }
    var root = document.getElementById(ROOT_ID);
    root.hidden = false;
    document.body.classList.add("ff-sale-ck-open");
    paint();
    if (!state.locked) loadCatalog();
    var focus = document.getElementById(state.locked ? "ffSaleCkTip" : "ffSaleCkClientQ");
    if (focus) focus.focus();
  }

  function close() {
    var root = document.getElementById(ROOT_ID);
    if (root) root.hidden = true;
    document.body.classList.remove("ff-sale-ck-open");
    state = null;
  }

  function forceClose() {
    close();
  }

  window.ffBookingSalesCheckout = {
    open: open,
    close: close,
    forceClose: forceClose
  };
})();
