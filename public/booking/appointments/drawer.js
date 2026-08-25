/**
 * New Appointment right panel. Guided Client → Services → Summary flow.
 * Form state, Multi-Service lines, and Temporary Holds stay unchanged.
 */
(function () {
  var ROOT_ID = "ffBookingApptDrawer";
  var UI_VERSION = "guided-v2";
  var searchTimer = null;
  var searchGen = 0;
  var state = null;
  var lastScroll = null;
  var uiState = { servicePickerKey: "", providerPickerKey: "", serviceQ: "", providerQ: "", notesOpen: false, expandedCats: {} };

  function resetUiState() {
    uiState = {
      servicePickerKey: "",
      providerPickerKey: "",
      serviceQ: "",
      providerQ: "",
      notesOpen: !!(state && state.notes && String(state.notes).trim()),
      expandedCats: {}
    };
  }
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

  function formatContextDate(dateKey) {
    var parts = String(dateKey || "").split("-");
    if (parts.length !== 3) return dateKey || "";
    var dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(dt.getTime())) return dateKey || "";
    return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  function formatPhone(raw) {
    var digits = String(raw || "").replace(/\D/g, "");
    if (digits.length === 11 && digits.charAt(0) === "1") digits = digits.slice(1);
    if (digits.length === 10) return digits.slice(0, 3) + " " + digits.slice(3, 6) + " " + digits.slice(6);
    return String(raw || "").trim();
  }

  function contextLabel(current) {
    return [locationLabel(current && current.locationId), formatContextDate(current && current.dateKey)]
      .filter(Boolean)
      .join(" · ");
  }

  function syncHold() {
    if (!window.ffBookingCalDraft) return;
    var api = form();
    var spec = state && api && typeof api.holdSpec === "function" ? api.holdSpec(state) : null;
    if (!spec) {
      window.ffBookingCalDraft.clear();
      return;
    }
    window.ffBookingCalDraft.set(spec);
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
    var phone = formatPhone(client && client.phone) || String(client && client.email || "").trim();
    return (
      '<div class="ff-appt-picked">' +
        avatar +
        '<div class="ff-appt-picked-id">' +
          "<strong>" + escapeHtml((client && client.displayName) || "Client") + "</strong>" +
          (phone ? "<span>" + escapeHtml(phone) + "</span>" : "") +
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
      hideClientResults();
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

  function ensureDom() {
    var existing = document.getElementById(ROOT_ID);
    if (existing && existing.getAttribute("data-ff-appt-ui") !== UI_VERSION) {
      existing.parentNode.removeChild(existing);
      existing = null;
    }
    if (existing && existing.parentNode !== host()) host().appendChild(existing);
    if (existing) return;
    var aside = document.createElement("aside");
    aside.id = ROOT_ID;
    aside.className = "ff-appt";
    aside.setAttribute("data-ff-appt-ui", UI_VERSION);
    aside.setAttribute("role", "dialog");
    aside.setAttribute("aria-labelledby", "ffApptTitle");
    aside.setAttribute("aria-hidden", "true");
    aside.hidden = true;
    aside.innerHTML =
      '<header class="ff-appt-head">' +
        '<div class="ff-appt-head-copy">' +
          '<h2 id="ffApptTitle">New Appointment</h2>' +
          '<button type="button" class="ff-appt-context" id="ffApptContext" data-ff-appt-act="edit-date"></button>' +
          '<input id="ffApptDate" class="ff-appt-date-input" type="date" tabindex="-1" aria-label="Appointment date">' +
        "</div>" +
        '<button type="button" class="ff-appt-x" data-ff-appt-act="close" aria-label="Close">×</button>' +
      "</header>" +
      '<form class="ff-appt-body" id="ffApptForm" novalidate>' +
        '<section class="ff-appt-step" aria-label="Client">' +
          '<div class="ff-appt-step-h"><span>01</span> Client</div>' +
          '<div id="ffApptClientField" class="ff-appt-client">' +
            '<div id="ffApptClientSearchWrap">' +
              '<input id="ffApptClientQ" type="text" inputmode="search" autocomplete="off" placeholder="Search or create client">' +
              '<div id="ffApptClientResults" class="ff-appt-suggest" hidden></div>' +
            "</div>" +
            '<div id="ffApptClientChosen" class="ff-appt-chosen" hidden></div>' +
          "</div>" +
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
        "</section>" +
        '<section class="ff-appt-step" aria-label="Services">' +
          '<div class="ff-appt-step-h"><span>02</span> Services</div>' +
          '<div id="ffApptLines" class="ff-appt-svcs"></div>' +
          '<button type="button" class="ff-appt-add-line" id="ffApptAddLine" data-ff-appt-act="add-line" hidden>+ Add another service</button>' +
        "</section>" +
        '<div class="ff-appt-notes-wrap">' +
          '<button type="button" class="ff-appt-note-toggle" id="ffApptNoteToggle" data-ff-appt-act="add-note">+ Add note</button>' +
          '<textarea id="ffApptNotes" class="ff-appt-note-input" rows="2" maxlength="2000" placeholder="Add a note" hidden></textarea>' +
        "</div>" +
        '<div id="ffApptError" class="ff-appt-error" hidden></div>' +
      "</form>" +
      '<footer class="ff-appt-foot">' +
        '<div id="ffApptMeta" class="ff-appt-foot-meta" hidden></div>' +
        '<div class="ff-appt-foot-total"><span>Total</span><strong id="ffApptTotal">$0</strong></div>' +
        '<button type="button" class="ff-appt-primary" data-ff-appt-act="create" id="ffApptCreate">Book Appointment</button>' +
      "</footer>";
    host().appendChild(aside);
    bindDrawer(aside);
  }

  function els() {
    return {
      root: document.getElementById(ROOT_ID),
      context: document.getElementById("ffApptContext"),
      clientQ: document.getElementById("ffApptClientQ"),
      searchWrap: document.getElementById("ffApptClientSearchWrap"),
      results: document.getElementById("ffApptClientResults"),
      chosen: document.getElementById("ffApptClientChosen"),
      newBox: document.getElementById("ffApptNewClient"),
      clientMsg: document.getElementById("ffApptClientMsg"),
      lines: document.getElementById("ffApptLines"),
      addLine: document.getElementById("ffApptAddLine"),
      date: document.getElementById("ffApptDate"),
      notes: document.getElementById("ffApptNotes"),
      noteToggle: document.getElementById("ffApptNoteToggle"),
      meta: document.getElementById("ffApptMeta"),
      error: document.getElementById("ffApptError"),
      total: document.getElementById("ffApptTotal"),
      create: document.getElementById("ffApptCreate")
    };
  }

  function paintSummary() {
    var api = form();
    var ui = els();
    if (!api) return;
    var lines = (state.lines || []).filter(function (line) { return line && line.serviceId; });
    var total = typeof api.linesTotal === "function" ? api.linesTotal(state) : 0;
    if (ui.total) ui.total.textContent = money(total);
    if (!ui.meta) return;
    if (!lines.length) {
      ui.meta.hidden = true;
      ui.meta.textContent = "";
      return;
    }
    var names = [];
    var seen = {};
    lines.forEach(function (line) {
      var name = api.providerName(line.providerId);
      if (name && !seen[name]) {
        seen[name] = true;
        names.push(name);
      }
    });
    var starts = lines.map(function (line) { return Number(line.startMin); }).filter(Number.isFinite);
    var ends = lines.map(function (line) { return Number(line.endMin); }).filter(Number.isFinite);
    var start = starts.length ? Math.min.apply(null, starts) : null;
    var end = ends.length ? Math.max.apply(null, ends) : null;
    var who = lines.length + (lines.length === 1 ? " service" : " services") +
      (names.length ? " · " + names.join(" + ") : "");
    var when = start != null && end != null ? api.formatMinutes(start) + " – " + api.formatMinutes(end) : "";
    ui.meta.hidden = false;
    ui.meta.textContent = when ? who + "\n" + when : who;
  }

  function paint() {
    var api = form();
    var ui = els();
    if (!api || !ui.root || !state) return;
    var providers = providersForLocation(state.locationId);
    (state.lines || []).forEach(function (line) {
      if (line && line.providerId && !providers.some(function (emp) { return emp.id === line.providerId; })) {
        providers = providers.concat([{ id: line.providerId, firstName: api.providerName(line.providerId) }]);
      }
    });
    ui.date.value = state.dateKey || "";
    if (ui.context) ui.context.textContent = contextLabel(state);
    if (document.activeElement !== ui.notes) ui.notes.value = state.notes || "";
    var notesOpen = uiState.notesOpen || !!(state.notes && String(state.notes).trim());
    uiState.notesOpen = notesOpen;
    if (ui.notes) {
      ui.notes.hidden = !notesOpen;
      ui.notes.classList.toggle("is-open", notesOpen);
    }
    if (ui.noteToggle) ui.noteToggle.hidden = notesOpen;
    var active = document.activeElement;
    var keepServiceQ = active && active.hasAttribute && active.hasAttribute("data-ff-service-q") ? active.value : uiState.serviceQ;
    var keepProviderQ = active && active.hasAttribute && active.hasAttribute("data-ff-provider-q") ? active.value : uiState.providerQ;
    uiState.serviceQ = keepServiceQ;
    uiState.providerQ = keepProviderQ;
    if (ui.lines && typeof api.createLinesHtml === "function") {
      ui.lines.innerHTML = api.createLinesHtml(state, providers, uiState);
    }
    if (ui.addLine) {
      ui.addLine.hidden = !((state.lines || []).some(function (line) { return line && line.serviceId; }));
    }
    paintClientState();
    paintSummary();
    var lineError = !!(state.error && state.errorLineKey);
    var ready = api.canCreate(state) && !state.creating;
    ui.error.hidden = !state.error || lineError;
    ui.error.textContent = lineError ? "" : (state.error || "");
    ui.create.disabled = !!state.creating;
    ui.create.classList.toggle("is-wait", !ready);
    ui.create.setAttribute("aria-disabled", ready ? "false" : "true");
    ui.create.textContent = state.creating ? "Booking…" : "Book Appointment";
    if (active && active.hasAttribute) {
      var sel = null;
      if (active.hasAttribute("data-ff-service-q")) sel = ui.root.querySelector("[data-ff-service-q]");
      if (active.hasAttribute("data-ff-provider-q")) sel = ui.root.querySelector("[data-ff-provider-q]");
      if (sel) {
        sel.focus();
        try { sel.setSelectionRange(sel.value.length, sel.value.length); } catch (_) {}
      }
    }
    syncHold();
    placeLiveFab();
  }

  function showClientResults(rows, kind) {
    var ui = els();
    if (!ui.results) return;
    var list = rows || [];
    ui.results.hidden = false;
    var create = '<button type="button" class="ff-appt-hit ff-appt-hit-create" data-ff-appt-act="new-client">+ Create new client</button>';
    if (kind === "loading") {
      ui.results.innerHTML = '<div class="ff-appt-picker-empty">Loading clients…</div>' + create;
      return;
    }
    ui.results.innerHTML =
      (kind === "recent" ? '<div class="ff-appt-picker-cat">Recent</div>' : "") +
      (list.length
        ? list.map(function (row) {
          return '<button type="button" class="ff-appt-hit" data-ff-appt-client="' + escapeHtml(row.clientId) + '">' +
            "<strong>" + escapeHtml(row.displayName || "Client") + "</strong>" +
            "<span>" + escapeHtml(formatPhone(row.phone) || row.email || "") + "</span>" +
            "</button>";
        }).join("")
        : '<div class="ff-appt-picker-empty">No matching clients</div>') +
      create;
  }

  function hideClientResults() {
    var ui = els();
    if (!ui.results) return;
    ui.results.hidden = true;
    ui.results.innerHTML = "";
  }

  async function searchClients(query) {
    var api = clients();
    var q = String(query || "").trim();
    var gen = ++searchGen;
    if (!api) {
      showClientResults([]);
      return;
    }
    if (!q) showClientResults([], "loading");
    var rows = [];
    try {
      rows = q
        ? await api.searchClients(q)
        : (typeof api.getRecentClients === "function" ? await api.getRecentClients(20) : []);
    } catch (err) {
      try { console.error("Client search failed", err); } catch (_) {}
    }
    if (gen !== searchGen) return;
    showClientResults(rows || [], q ? "results" : "recent");
  }

  function openClientList() {
    var ui = els();
    if (!ui.clientQ || (ui.searchWrap && ui.searchWrap.hidden)) return;
    searchClients(ui.clientQ.value);
  }

  async function chooseClient(clientId, client) {
    var api = form();
    var repo = clients();
    var row = client || (repo ? await repo.getClientById(clientId) : null);
    if (!row) return;
    state = api.setClient(state, row);
    els().clientQ.value = "";
    hideClientResults();
    els().newBox.hidden = true;
    paint();
  }

  function clearClient() {
    var api = form();
    if (!api || !state) return;
    state = api.setClient(state, null);
    var ui = els();
    ui.clientQ.value = "";
    hideClientResults();
    ui.newBox.hidden = true;
    paint();
    setTimeout(function () {
      if (ui.clientQ) {
        ui.clientQ.focus();
        openClientList();
      }
    }, 20);
  }

  async function saveNewClient() {
    var repo = clients();
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

  function firstIncompleteLine() {
    return ((state && state.lines) || []).find(function (line) {
      return line && !line.serviceId;
    }) || null;
  }

  function guideCreate() {
    hideClientResults();
    if (!state || !state.clientId) {
      state.error = "Select a client to book this appointment.";
      paint();
      var q = els().clientQ;
      if (q) q.focus();
      openClientList();
      return;
    }
    var line = firstIncompleteLine();
    if (line) {
      state.error = "Select a service to book this appointment.";
      uiState.servicePickerKey = line.key;
      uiState.providerPickerKey = "";
      uiState.serviceQ = "";
      paint();
      return;
    }
    state.error = "Complete the appointment before booking.";
    paint();
  }

  async function createAppointment() {
    var api = form();
    if (!api || !state || state.creating) return;
    if (!api.canCreate(state)) {
      guideCreate();
      return;
    }
    var result = await api.create(state);
    paint();
    if (result && result.ok) {
      close();
      restoreScroll();
      toast("Appointment created");
    }
  }

  function requestClose() {
    var api = form();
    if (state && api && api.isDirty(state)) {
      if (!window.confirm("Discard this unsaved appointment?")) return;
    }
    close();
  }

  function close() {
    var ui = els();
    if (!ui.root) return;
    ui.root.hidden = true;
    ui.root.setAttribute("aria-hidden", "true");
    ui.root.classList.remove("is-open");
    state = null;
    resetUiState();
    hideClientResults();
    restoreLiveFab();
    if (window.ffBookingCalDraft) window.ffBookingCalDraft.clear();
    requestAnimationFrame(function () {
      window.dispatchEvent(new Event("resize"));
    });
  }

  function isOpen() {
    var root = document.getElementById(ROOT_ID);
    return !!(root && !root.hidden && root.classList.contains("is-open"));
  }

  function forceClose() {
    close();
  }

  async function open(seed) {
    var api = form();
    if (!api || !canOpenOnCalendar()) return;
    if (window.ffBookingAppointmentDetails && window.ffBookingAppointmentDetails.forceClose) {
      window.ffBookingAppointmentDetails.forceClose();
    }
    ensureDom();
    captureScroll();
    resetUiState();
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
    hideClientResults();
    syncHold();
    await api.refreshServices(state);
    paint();
    placeLiveFab();
    requestAnimationFrame(function () {
      placeLiveFab();
      window.dispatchEvent(new Event("resize"));
    });
  }

  function bindDrawer(root) {
    root.addEventListener("click", function (ev) {
      var api = form();
      var remove = ev.target && ev.target.closest ? ev.target.closest("[data-ff-line-act='remove']") : null;
      if (remove && api && state) {
        ev.preventDefault();
        ev.stopPropagation();
        state = api.removeLine(state, remove.getAttribute("data-ff-line"));
        resetUiState();
        paint();
        return;
      }
      var act = ev.target && ev.target.closest ? ev.target.closest("[data-ff-appt-act]") : null;
      if (!act) {
        var hit = ev.target && ev.target.closest ? ev.target.closest("[data-ff-appt-client]") : null;
        if (hit) {
          chooseClient(hit.getAttribute("data-ff-appt-client"));
          return;
        }
        if (ev.target.closest && ev.target.closest("#ffApptClientQ, #ffApptClientSearchWrap")) {
          openClientList();
          return;
        }
        if (
          (uiState.servicePickerKey || uiState.providerPickerKey) &&
          !ev.target.closest(".ff-appt-picker, .ff-appt-search-row, .ff-appt-chip, .ff-appt-card-name")
        ) {
          uiState.servicePickerKey = "";
          uiState.providerPickerKey = "";
          paint();
        }
        return;
      }
      var name = act.getAttribute("data-ff-appt-act");
      if (name === "close") requestClose();
      else if (name === "create") createAppointment();
      else if (name === "clear-client") clearClient();
      else if (name === "edit-date") {
        var date = document.getElementById("ffApptDate");
        if (date && typeof date.showPicker === "function") {
          try { date.showPicker(); } catch (_) { date.focus(); }
        } else if (date) date.focus();
      } else if (name === "add-note") {
        uiState.notesOpen = true;
        paint();
        setTimeout(function () {
          var notes = document.getElementById("ffApptNotes");
          if (notes) notes.focus();
        }, 20);
      } else if (name === "open-service-picker") {
        uiState.servicePickerKey = act.getAttribute("data-ff-line") || "";
        uiState.providerPickerKey = "";
        uiState.serviceQ = "";
        paint();
      } else if (name === "open-provider-picker") {
        uiState.providerPickerKey = act.getAttribute("data-ff-line") || "";
        uiState.servicePickerKey = "";
        uiState.providerQ = "";
        paint();
      } else if (name === "toggle-service-cat") {
        var cat = act.getAttribute("data-ff-cat") || "";
        if (!cat) return;
        if (!uiState.expandedCats) uiState.expandedCats = {};
        uiState.expandedCats[cat] = !uiState.expandedCats[cat];
        var group = act.closest(".ff-appt-picker-group");
        if (group) group.classList.toggle("is-collapsed", !uiState.expandedCats[cat]);
        act.setAttribute("aria-expanded", uiState.expandedCats[cat] ? "true" : "false");
      } else if (name === "pick-service" && api && state) {
        state = api.setLineService(state, act.getAttribute("data-ff-line"), act.getAttribute("data-ff-service"));
        uiState.servicePickerKey = "";
        uiState.serviceQ = "";
        paint();
      } else if (name === "pick-provider" && api && state) {
        api.setLineProvider(state, act.getAttribute("data-ff-line"), act.getAttribute("data-ff-provider")).then(function (next) {
          state = next;
          uiState.providerPickerKey = "";
          uiState.providerQ = "";
          paint();
        });
      } else if (name === "add-line" && api && state) {
        var last = state.lines && state.lines[state.lines.length - 1];
        if (last && !last.serviceId) {
          uiState.servicePickerKey = last.key;
          uiState.providerPickerKey = "";
          uiState.serviceQ = "";
        } else {
          state = api.addLine(state);
          last = state.lines[state.lines.length - 1];
          uiState.servicePickerKey = last ? last.key : "";
          uiState.providerPickerKey = "";
          uiState.serviceQ = "";
        }
        paint();
      } else if (name === "new-client") {
        hideClientResults();
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
        ev.target.classList.toggle("is-open", !!(state.notes && String(state.notes).trim()));
      } else if (ev.target.hasAttribute && ev.target.hasAttribute("data-ff-service-q")) {
        uiState.serviceQ = ev.target.value;
        paint();
      } else if (ev.target.hasAttribute && ev.target.hasAttribute("data-ff-provider-q")) {
        uiState.providerQ = ev.target.value;
        paint();
      }
    });
    root.addEventListener("change", async function (ev) {
      var api = form();
      if (!api || !state) return;
      var field = ev.target && ev.target.closest ? ev.target.closest("[data-ff-line-field]") : null;
      var wrap = ev.target && ev.target.closest ? ev.target.closest("[data-ff-line]") : null;
      if (field && wrap) {
        var key = wrap.getAttribute("data-ff-line");
        var kind = field.getAttribute("data-ff-line-field");
        if (kind === "service") state = api.setLineService(state, key, ev.target.value);
        else if (kind === "provider") state = await api.setLineProvider(state, key, ev.target.value);
        else if (kind === "start") state = api.setLineStart(state, key, ev.target.value);
      } else if (ev.target.id === "ffApptDate") {
        state = api.setDate(state, ev.target.value);
      }
      paint();
    });
    root.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && ev.target && ev.target.id !== "ffApptNotes") ev.preventDefault();
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
    close();
  });

  window.ffBookingAppointmentDrawer = {
    open: open,
    close: requestClose,
    forceClose: forceClose,
    isOpen: isOpen,
    getState: function () { return state; }
  };
})();
