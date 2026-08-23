/**
 * New Appointment drawer. Calendar stays visible. LIVE can stack above.
 */
(function () {
  var ROOT_ID = "ffBookingApptDrawer";
  var BACKDROP_ID = "ffBookingApptBackdrop";
  var searchTimer = null;
  var state = null;
  var lastScroll = null;

  function form() { return window.ffBookingAppointmentForm || null; }
  function clients() { return window.ffBookingClients || null; }

  function isBookingCalendarVisible() {
    var shell = window.ffBookingState;
    if (!shell || !shell.isBooking() || shell.getSection() !== "calendar") return false;
    if (!document.body || !document.body.classList.contains("ff-booking-area")) return false;
    return !!document.getElementById("ffBookingCalendarRoot");
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function money(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = 0;
    return "$" + (Math.round(n * 100) / 100).toFixed(n % 1 ? 2 : 0);
  }

  function providersForLocation(locationId) {
    var data = window.ffBookingCalData;
    if (data && typeof data.loadCalendarEmployees === "function") {
      return data.loadCalendarEmployees((state && state.dateKey) || "", locationId);
    }
    return [];
  }

  function timeOptions(selected) {
    var out = [];
    for (var m = 6 * 60; m < 22 * 60; m += 15) {
      var api = form();
      out.push(
        '<option value="' + m + '"' + (m === selected ? " selected" : "") + ">" +
        escapeHtml(api ? api.formatMinutes(m) : String(m)) +
        "</option>"
      );
    }
    return out.join("");
  }

  function ensureDom() {
    if (!document.getElementById(BACKDROP_ID)) {
      var backdrop = document.createElement("div");
      backdrop.id = BACKDROP_ID;
      backdrop.className = "ff-appt-backdrop";
      backdrop.hidden = true;
      backdrop.addEventListener("click", function () { requestClose(); });
      document.body.appendChild(backdrop);
    }
    if (!document.getElementById(ROOT_ID)) {
      var aside = document.createElement("aside");
      aside.id = ROOT_ID;
      aside.className = "ff-appt";
      aside.setAttribute("role", "dialog");
      aside.setAttribute("aria-labelledby", "ffApptTitle");
      aside.setAttribute("aria-hidden", "true");
      aside.hidden = true;
      aside.innerHTML =
        '<header class="ff-appt-head">' +
          '<h2 id="ffApptTitle">New Appointment</h2>' +
          '<button type="button" class="ff-appt-x" data-ff-appt-act="close" aria-label="Close">×</button>' +
        "</header>" +
        '<form class="ff-appt-body" id="ffApptForm" novalidate>' +
          '<label class="ff-appt-field">' +
            '<span>Client</span>' +
            '<input id="ffApptClientQ" type="search" autocomplete="off" placeholder="Search name, phone, or email">' +
            '<div id="ffApptClientResults" class="ff-appt-suggest" hidden></div>' +
            '<button type="button" class="ff-appt-link" data-ff-appt-act="new-client">+ Add new client</button>' +
            '<div id="ffApptClientChosen" class="ff-appt-chosen" hidden></div>' +
          "</label>" +
          '<div id="ffApptNewClient" class="ff-appt-new" hidden>' +
            '<div class="ff-appt-row">' +
              '<label><span>First name</span><input id="ffApptFirst" type="text"></label>' +
              '<label><span>Last name</span><input id="ffApptLast" type="text"></label>' +
            "</div>" +
            '<label><span>Phone</span><input id="ffApptPhone" type="tel"></label>' +
            '<label><span>Email</span><input id="ffApptEmail" type="email"></label>' +
            '<button type="button" class="ff-appt-secondary" data-ff-appt-act="save-client">Save client</button>' +
            '<div id="ffApptClientMsg" class="ff-appt-note" hidden></div>' +
          "</div>" +
          '<label class="ff-appt-field">' +
            '<span>Service</span>' +
            '<select id="ffApptService"></select>' +
          "</label>" +
          '<label class="ff-appt-field">' +
            '<span>Provider</span>' +
            '<select id="ffApptProvider"></select>' +
          "</label>" +
          '<div class="ff-appt-row">' +
            '<label class="ff-appt-field"><span>Date</span><input id="ffApptDate" type="date"></label>' +
            '<label class="ff-appt-field"><span>Start time</span><select id="ffApptStart"></select></label>' +
          "</div>" +
          '<div class="ff-appt-meta" id="ffApptMeta"></div>' +
          '<label class="ff-appt-field">' +
            '<span>Notes</span>' +
            '<textarea id="ffApptNotes" rows="2" maxlength="2000"></textarea>' +
          "</label>" +
          '<div id="ffApptError" class="ff-appt-error" hidden></div>' +
        "</form>" +
        '<footer class="ff-appt-foot">' +
          '<button type="button" class="ff-appt-ghost" data-ff-appt-act="close">Cancel</button>' +
          '<button type="button" class="ff-appt-primary" data-ff-appt-act="create" id="ffApptCreate">Create Appointment</button>' +
        "</footer>";
      document.body.appendChild(aside);
      bindDrawer(aside);
    }
  }

  function els() {
    return {
      root: document.getElementById(ROOT_ID),
      backdrop: document.getElementById(BACKDROP_ID),
      clientQ: document.getElementById("ffApptClientQ"),
      results: document.getElementById("ffApptClientResults"),
      chosen: document.getElementById("ffApptClientChosen"),
      newBox: document.getElementById("ffApptNewClient"),
      clientMsg: document.getElementById("ffApptClientMsg"),
      service: document.getElementById("ffApptService"),
      provider: document.getElementById("ffApptProvider"),
      date: document.getElementById("ffApptDate"),
      start: document.getElementById("ffApptStart"),
      meta: document.getElementById("ffApptMeta"),
      notes: document.getElementById("ffApptNotes"),
      error: document.getElementById("ffApptError"),
      create: document.getElementById("ffApptCreate")
    };
  }

  function paint() {
    var api = form();
    var ui = els();
    if (!api || !ui.root || !state) return;
    var providers = providersForLocation(state.locationId);
    if (state.providerId && !providers.some(function (emp) { return emp.id === state.providerId; })) {
      providers = providers.concat([{ id: state.providerId, firstName: form().providerName(state.providerId) }]);
    }
    ui.provider.innerHTML = providers.map(function (emp) {
      return '<option value="' + escapeHtml(emp.id) + '"' + (emp.id === state.providerId ? " selected" : "") + ">" +
        escapeHtml(emp.firstName || emp.name || "Provider") + "</option>";
    }).join("");
    ui.service.innerHTML = '<option value="">Select a service</option>' + (state.services || []).map(function (svc) {
      return '<option value="' + escapeHtml(svc.id) + '"' + (svc.id === state.serviceId ? " selected" : "") + ">" +
        escapeHtml(svc.name) + " · " + svc.durationMinutes + " min · " + money(svc.price) +
        "</option>";
    }).join("");
    ui.date.value = state.dateKey || "";
    ui.start.innerHTML = timeOptions(state.startMin);
    ui.notes.value = state.notes || "";
    if (state.client) {
      ui.chosen.hidden = false;
      ui.chosen.textContent = (state.client.displayName || "Client") +
        (state.client.phone ? " · " + state.client.phone : "");
    } else {
      ui.chosen.hidden = true;
      ui.chosen.textContent = "";
    }
    var bits = [];
    if (state.durationMinutes) bits.push(state.durationMinutes + " min");
    if (state.endMin) bits.push("Ends " + api.formatMinutes(state.endMin));
    if (state.service) bits.push(money(state.price));
    ui.meta.textContent = bits.join(" · ");
    if (state.capabilityMessage) ui.meta.textContent = state.capabilityMessage + (bits.length ? " · " + bits.join(" · ") : "");
    ui.error.hidden = !state.error;
    ui.error.textContent = state.error || "";
    ui.create.disabled = !api.canCreate(state) || state.creating;
    ui.create.textContent = state.creating ? "Creating…" : "Create Appointment";
  }

  function showClientResults(rows) {
    var ui = els();
    if (!rows.length) {
      ui.results.hidden = true;
      ui.results.innerHTML = "";
      return;
    }
    ui.results.hidden = false;
    ui.results.innerHTML = rows.map(function (row) {
      return '<button type="button" class="ff-appt-hit" data-ff-appt-client="' + escapeHtml(row.clientId) + '">' +
        '<strong>' + escapeHtml(row.displayName || "Client") + "</strong>" +
        '<span>' + escapeHtml(row.phone || row.email || "") + "</span>" +
        "</button>";
    }).join("");
  }

  async function searchClients(query) {
    var api = clients();
    if (!api || !query) {
      showClientResults([]);
      return;
    }
    var rows = await api.searchClients(query);
    showClientResults(rows || []);
  }

  async function chooseClient(clientId, client) {
    var api = form();
    var repo = clients();
    var row = client || (repo ? await repo.getClientById(clientId) : null);
    if (!row) return;
    state = api.setClient(state, row);
    els().clientQ.value = "";
    showClientResults([]);
    els().newBox.hidden = true;
    paint();
  }

  async function saveNewClient() {
    var repo = clients();
    var api = form();
    var msg = els().clientMsg;
    if (!repo) return;
    var result = await repo.createClient({
      firstName: document.getElementById("ffApptFirst").value,
      lastName: document.getElementById("ffApptLast").value,
      phone: document.getElementById("ffApptPhone").value,
      email: document.getElementById("ffApptEmail").value
    });
    if (!result || !result.ok) {
      msg.hidden = false;
      msg.textContent = (result && result.error) || "Client could not be saved.";
      return;
    }
    if (result.duplicate) {
      msg.hidden = false;
      msg.textContent = "Existing client found";
      await chooseClient(result.client.clientId, result.client);
      return;
    }
    msg.hidden = true;
    await chooseClient(result.client.clientId, result.client);
  }

  function toast(message) {
    if (window.ffToast && typeof window.ffToast.show === "function") {
      window.ffToast.show(message, { variant: "success", durationMs: 2200 });
    }
  }

  function captureScroll() {
    var vp = document.querySelector("[data-ff-cal-viewport]");
    lastScroll = vp ? { left: vp.scrollLeft, top: vp.scrollTop } : null;
  }

  function restoreScroll() {
    var vp = document.querySelector("[data-ff-cal-viewport]");
    if (vp && lastScroll) {
      vp.scrollLeft = lastScroll.left;
      vp.scrollTop = lastScroll.top;
    }
  }

  async function createAppointment() {
    var api = form();
    if (!api || !state) return;
    var result = await api.create(state);
    paint();
    if (result && result.ok) {
      close(true);
      restoreScroll();
      toast("Appointment created");
    }
  }

  function requestClose() {
    var api = form();
    if (state && api && api.isDirty(state)) {
      if (!window.confirm("Discard this unsaved appointment?")) return;
    }
    close(false);
  }

  function close(success) {
    var ui = els();
    if (!ui.root) return;
    ui.root.hidden = true;
    ui.root.setAttribute("aria-hidden", "true");
    ui.root.classList.remove("is-open");
    if (ui.backdrop) {
      ui.backdrop.hidden = true;
      ui.backdrop.classList.remove("is-open");
    }
    if (!success) state = null;
    else state = null;
    showClientResults([]);
  }

  function isOpen() {
    var root = document.getElementById(ROOT_ID);
    return !!(root && !root.hidden && root.classList.contains("is-open"));
  }

  function forceClose() {
    close(false);
  }

  async function open(seed) {
    var api = form();
    if (!api || !isBookingCalendarVisible()) return;
    ensureDom();
    captureScroll();
    state = api.emptyState({
      locationId: seed && seed.locationId,
      dateKey: seed && seed.dateKey,
      startMin: seed && seed.startMin,
      providerId: seed && seed.providerId
    });
    var ui = els();
    ui.root.hidden = false;
    ui.root.classList.add("is-open");
    ui.root.setAttribute("aria-hidden", "false");
    ui.backdrop.hidden = false;
    ui.backdrop.classList.add("is-open");
    ui.clientQ.value = "";
    ui.newBox.hidden = true;
    showClientResults([]);
    await api.refreshServices(state);
    paint();
    setTimeout(function () { ui.clientQ.focus(); }, 20);
  }

  function bindDrawer(root) {
    root.addEventListener("click", function (ev) {
      var act = ev.target && ev.target.closest ? ev.target.closest("[data-ff-appt-act]") : null;
      if (!act) {
        var hit = ev.target && ev.target.closest ? ev.target.closest("[data-ff-appt-client]") : null;
        if (hit) chooseClient(hit.getAttribute("data-ff-appt-client"));
        return;
      }
      var name = act.getAttribute("data-ff-appt-act");
      if (name === "close") requestClose();
      else if (name === "create") createAppointment();
      else if (name === "new-client") {
        els().newBox.hidden = !els().newBox.hidden;
        if (!els().newBox.hidden) document.getElementById("ffApptFirst").focus();
      } else if (name === "save-client") saveNewClient();
    });
    root.addEventListener("input", function (ev) {
      if (!state) return;
      if (ev.target.id === "ffApptClientQ") {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { searchClients(ev.target.value); }, 180);
      } else if (ev.target.id === "ffApptNotes") {
        state.notes = ev.target.value;
      }
    });
    root.addEventListener("change", async function (ev) {
      var api = form();
      if (!api || !state) return;
      if (ev.target.id === "ffApptService") state = api.setService(state, ev.target.value);
      else if (ev.target.id === "ffApptProvider") state = await api.setProvider(state, ev.target.value);
      else if (ev.target.id === "ffApptDate") state = api.setDate(state, ev.target.value);
      else if (ev.target.id === "ffApptStart") state = api.setStart(state, ev.target.value);
      paint();
    });
    root.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && ev.target && ev.target.id !== "ffApptNotes") {
        ev.preventDefault();
      }
    });
    document.getElementById("ffApptForm").addEventListener("submit", function (ev) {
      ev.preventDefault();
    });
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape" || !isOpen()) return;
    if (document.getElementById("ffLiveFloorDrawer") && document.getElementById("ffLiveFloorDrawer").classList.contains("is-open")) return;
    if (document.getElementById("ffLiveDeskPanel") && document.getElementById("ffLiveDeskPanel").classList.contains("is-open")) return;
    ev.preventDefault();
    requestClose();
  });

  document.addEventListener("ff-active-location-changed", function () {
    if (!isOpen() || !state) return;
    var api = form();
    if (api && api.isDirty(state)) {
      window.alert("Location changed. The unsaved appointment was closed so it would not be saved to the wrong location.");
    }
    close(false);
  });

  window.ffBookingAppointmentDrawer = {
    open: open,
    close: requestClose,
    forceClose: forceClose,
    isOpen: isOpen,
    getState: function () { return state; }
  };
})();
