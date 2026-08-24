/**
 * New Appointment panel. Lives inside the Booking workspace so the calendar
 * stays visible and Operations never shows it. LIVE can stack above.
 */
(function () {
  var ROOT_ID = "ffBookingApptDrawer";
  var searchTimer = null;
  var state = null;
  var lastScroll = null;
  function form() { return window.ffBookingAppointmentForm || null; }
  function clients() { return window.ffBookingClients || null; }

  function canOpenOnCalendar() {
    var workspace = document.getElementById("ffBookingWorkspace");
    if (workspace && workspace.hasAttribute("hidden")) return false;
    var shell = window.ffBookingState;
    if (shell && !shell.isBooking()) return false;
    return !!document.getElementById("ffBookingCalendarRoot");
  }

  function host() {
    return document.getElementById("ffBookingWorkspace") || document.body;
  }

  function locationLabel(id) {
    try {
      var list = typeof window.ffGetLocations === "function" ? window.ffGetLocations() : [];
      var row = (list || []).find(function (loc) {
        return loc && (String(loc.id || "") === String(id) || String(loc.locationId || "") === String(id));
      });
      if (row && (row.name || row.label || row.title)) return row.name || row.label || row.title;
    } catch (_) {}
    return "This location";
  }

  function syncHold() {
    if (!window.ffBookingCalDraft) return;
    if (!state) {
      window.ffBookingCalDraft.clear();
      return;
    }
    window.ffBookingCalDraft.set({
      providerId: state.providerId,
      dateKey: state.dateKey,
      startMin: state.startMin,
      durationMinutes: state.durationMinutes || 30,
      title: state.service && state.service.name
        ? state.service.name
        : "",
      clientName: state.client && state.client.displayName
        ? state.client.displayName
        : ""
    });
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function initials(client) {
    if (window.ffBookingClientsUi && window.ffBookingClientsUi.initials) {
      return window.ffBookingClientsUi.initials(client);
    }
    var first = String(client && client.firstName || "").trim();
    var last = String(client && client.lastName || "").trim();
    var pair = (first.charAt(0) + last.charAt(0)).toUpperCase();
    if (pair) return pair;
    var name = String(client && client.displayName || "").trim();
    return name ? name.charAt(0).toUpperCase() : "?";
  }

  function selectedClientHtml(client) {
    var url = String(client && client.photoUrl || "").trim();
    var avatar = url
      ? '<img class="ff-appt-picked-avatar" src="' + escapeHtml(url) + '" alt="">'
      : '<span class="ff-appt-picked-avatar ff-appt-picked-initials">' + escapeHtml(initials(client)) + "</span>";
    var secondary = String(client && client.phone || "").trim() || String(client && client.email || "").trim();
    return (
      '<div class="ff-appt-picked">' +
        avatar +
        '<div class="ff-appt-picked-id">' +
          "<strong>" + escapeHtml((client && client.displayName) || "Client") + "</strong>" +
          (secondary ? "<span>" + escapeHtml(secondary) + "</span>" : "") +
        "</div>" +
        '<button type="button" class="ff-appt-picked-x" data-ff-appt-act="clear-client" aria-label="Change client">×</button>' +
      "</div>"
    );
  }

  function paintClientState() {
    var ui = els();
    var selected = !!(state && state.client && state.clientId);
    if (ui.searchWrap) ui.searchWrap.hidden = selected;
    if (ui.chosen) {
      ui.chosen.hidden = !selected;
      ui.chosen.innerHTML = selected ? selectedClientHtml(state.client) : "";
    }
    if (selected) {
      showClientResults([]);
      if (ui.newBox) ui.newBox.hidden = true;
    }
  }

  function placeLiveFab() {
    var api = window.ffBookingDrawerLive;
    var drawer = document.getElementById(ROOT_ID);
    if (!api || !drawer || !isOpen()) return;
    api.place(drawer);
  }

  function restoreLiveFab() {
    if (window.ffBookingDrawerLive) window.ffBookingDrawerLive.restore();
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
    var existing = document.getElementById(ROOT_ID);
    if (existing && existing.parentNode !== host()) host().appendChild(existing);
    if (existing) return;
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
          '<span>Location</span>' +
          '<input id="ffApptLocation" type="text" readonly>' +
        "</label>" +
        '<div class="ff-appt-row">' +
          '<label class="ff-appt-field"><span>Date</span><input id="ffApptDate" type="date"></label>' +
          '<label class="ff-appt-field"><span>Start time</span><select id="ffApptStart"></select></label>' +
        "</div>" +
        '<label class="ff-appt-field" id="ffApptClientField">' +
          "<span>Client</span>" +
          '<div id="ffApptClientSearchWrap">' +
            '<input id="ffApptClientQ" type="text" inputmode="search" autocomplete="off" placeholder="Search by name, phone or email">' +
            '<div id="ffApptClientResults" class="ff-appt-suggest" hidden></div>' +
            '<button type="button" class="ff-appt-link" data-ff-appt-act="new-client">+ Add new client</button>' +
          "</div>" +
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
        '<div id="ffApptSummary" class="ff-appt-summary" hidden>' +
          '<div><span>Duration</span><strong id="ffApptDur"></strong></div>' +
          '<div><span>End time</span><strong id="ffApptEnd"></strong></div>' +
          '<div><span>Price</span><strong id="ffApptPrice"></strong></div>' +
        "</div>" +
        '<div id="ffApptCap" class="ff-appt-cap" hidden></div>' +
        '<label class="ff-appt-field">' +
          '<span>Provider</span>' +
          '<div class="ff-appt-provider-row">' +
            '<span id="ffApptProviderAvatar" class="ff-appt-avatar" hidden></span>' +
            '<select id="ffApptProvider"></select>' +
          "</div>" +
        "</label>" +
        '<label class="ff-appt-field">' +
          '<span>Notes (optional)</span>' +
          '<textarea id="ffApptNotes" rows="2" maxlength="2000" placeholder="Add a note..."></textarea>' +
        "</label>" +
        '<div id="ffApptError" class="ff-appt-error" hidden></div>' +
      "</form>" +
      '<footer class="ff-appt-foot">' +
        '<button type="button" class="ff-appt-ghost" data-ff-appt-act="close">Cancel</button>' +
        '<button type="button" class="ff-appt-primary" data-ff-appt-act="create" id="ffApptCreate">Create Appointment</button>' +
      "</footer>";
    host().appendChild(aside);
    bindDrawer(aside);
  }

  function els() {
    return {
      root: document.getElementById(ROOT_ID),
      location: document.getElementById("ffApptLocation"),
      clientQ: document.getElementById("ffApptClientQ"),
      searchWrap: document.getElementById("ffApptClientSearchWrap"),
      results: document.getElementById("ffApptClientResults"),
      chosen: document.getElementById("ffApptClientChosen"),
      newBox: document.getElementById("ffApptNewClient"),
      clientMsg: document.getElementById("ffApptClientMsg"),
      service: document.getElementById("ffApptService"),
      provider: document.getElementById("ffApptProvider"),
      avatar: document.getElementById("ffApptProviderAvatar"),
      date: document.getElementById("ffApptDate"),
      start: document.getElementById("ffApptStart"),
      summary: document.getElementById("ffApptSummary"),
      dur: document.getElementById("ffApptDur"),
      end: document.getElementById("ffApptEnd"),
      price: document.getElementById("ffApptPrice"),
      cap: document.getElementById("ffApptCap"),
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
    if (ui.location) ui.location.value = locationLabel(state.locationId);
    var selected = providers.find(function (emp) { return emp.id === state.providerId; }) || null;
    if (ui.avatar) {
      var src = selected && selected.photoURL ? String(selected.photoURL).trim() : "";
      if (src) {
        ui.avatar.hidden = false;
        ui.avatar.innerHTML = '<img src="' + escapeHtml(src) + '" alt="">';
      } else {
        ui.avatar.hidden = true;
        ui.avatar.innerHTML = "";
      }
    }
    paintClientState();
    if (ui.summary) ui.summary.hidden = !state.service;
    if (state.service) {
      if (ui.dur) ui.dur.textContent = state.durationMinutes ? state.durationMinutes + " min" : "—";
      if (ui.end) ui.end.textContent = state.endMin ? api.formatMinutes(state.endMin) : "—";
      if (ui.price) ui.price.textContent = money(state.price);
    }
    if (ui.cap) {
      ui.cap.hidden = !state.capabilityMessage;
      ui.cap.textContent = state.capabilityMessage || "";
    }
    ui.error.hidden = !state.error;
    ui.error.textContent = state.error || "";
    ui.create.disabled = !api.canCreate(state) || state.creating;
    ui.create.textContent = state.creating ? "Creating…" : "Create Appointment";
    syncHold();
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
    var rows = [];
    try {
      rows = await api.searchClients(query);
    } catch (err) {
      try { console.error("Client search failed", err); } catch (_) {}
    }
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

  function clearClient() {
    var api = form();
    if (!api || !state) return;
    state = api.setClient(state, null);
    var ui = els();
    ui.clientQ.value = "";
    showClientResults([]);
    ui.newBox.hidden = true;
    paint();
    setTimeout(function () {
      if (ui.clientQ) ui.clientQ.focus();
    }, 20);
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
    state = null;
    showClientResults([]);
    restoreLiveFab();
    if (window.ffBookingCalDraft) window.ffBookingCalDraft.clear();
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
    if (!api || !canOpenOnCalendar()) return;
    if (window.ffBookingAppointmentDetails && window.ffBookingAppointmentDetails.forceClose) {
      window.ffBookingAppointmentDetails.forceClose();
    }
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
    ui.clientQ.value = "";
    ui.newBox.hidden = true;
    showClientResults([]);
    syncHold();
    await api.refreshServices(state);
    paint();
    placeLiveFab();
    requestAnimationFrame(placeLiveFab);
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
      else if (name === "clear-client") clearClient();
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

  window.addEventListener("resize", function () {
    if (isOpen()) placeLiveFab();
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
