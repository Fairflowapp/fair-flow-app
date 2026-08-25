/**
 * New Appointment Bottom Composer. Calendar stays full width; Details/Edit
 * remain a right drawer. Form state and Temporary Holds are unchanged.
 */
(function () {
  var ROOT_ID = "ffBookingApptDrawer";
  var UI_VERSION = "composer-v1.1";
  var MIN_COMPOSER_H = 200;
  var MAX_COMPOSER_VH = 0.72;
  var HEIGHT_KEY = "ff-appt-composer-h";
  var searchTimer = null;
  var closeTimer = null;
  var searchGen = 0;
  var state = null;
  var lastScroll = null;
  var composerHeight = 0;
  var resizing = false;
  var uiState = {
    servicePickerKey: "",
    providerPickerKey: "",
    serviceQ: "",
    providerQ: "",
    editingKey: "",
    notesOpen: false
  };

  function resetUiState() {
    uiState = {
      servicePickerKey: "",
      providerPickerKey: "",
      serviceQ: "",
      providerQ: "",
      editingKey: "",
      notesOpen: !!(state && state.notes && String(state.notes).trim())
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
    return document.querySelector("[data-ff-booking-page='calendar']")
      || document.getElementById("ffBookingWorkspace")
      || document.body;
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

  function contextLabel(current) {
    var bits = [locationLabel(current && current.locationId), formatContextDate(current && current.dateKey)].filter(Boolean);
    var lines = (current && current.lines) || [];
    var api = form();
    if (lines.length === 1 && !lines[0].serviceId && Number.isFinite(Number(lines[0].startMin)) && api) {
      bits.push(api.formatMinutes(lines[0].startMin));
    }
    return bits.join(" · ");
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
      hideClientResults();
      if (ui.newBox) ui.newBox.hidden = true;
    }
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

  function findLine(key) {
    var id = String(key || "");
    return ((state && state.lines) || []).find(function (line) {
      return line && (line.key === id || line.lineId === id);
    }) || null;
  }

  function paintPicker() {
    var ui = els();
    var api = form();
    if (!ui.float || !api) return;
    var key = uiState.servicePickerKey || uiState.providerPickerKey;
    var line = key ? findLine(key) : null;
    var providers = state ? providersForLocation(state.locationId) : [];
    if (line && line.providerId && !providers.some(function (emp) { return emp.id === line.providerId; })) {
      providers = providers.concat([{ id: line.providerId, firstName: api.providerName(line.providerId) }]);
    }
    if (uiState.servicePickerKey && line && typeof api.servicePickerHtml === "function") {
      ui.float.hidden = false;
      ui.float.innerHTML = api.servicePickerHtml(state, line, uiState);
      return;
    }
    if (uiState.providerPickerKey && line && typeof api.providerPickerHtml === "function") {
      ui.float.hidden = false;
      ui.float.innerHTML = api.providerPickerHtml(line, providers, uiState);
      return;
    }
    ui.float.hidden = true;
    ui.float.innerHTML = "";
  }

  function maxComposerHeight() {
    return Math.max(MIN_COMPOSER_H, Math.round(window.innerHeight * MAX_COMPOSER_VH));
  }

  function readSavedHeight() {
    try {
      var raw = sessionStorage.getItem(HEIGHT_KEY);
      var n = Number(raw);
      return Number.isFinite(n) && n >= MIN_COMPOSER_H ? n : 0;
    } catch (_) {
      return 0;
    }
  }

  function applyComposerHeight(px, persist) {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    var next = Math.max(MIN_COMPOSER_H, Math.min(maxComposerHeight(), Math.round(px)));
    composerHeight = next;
    root.style.height = next + "px";
    root.style.maxHeight = "none";
    root.classList.add("is-resized");
    if (persist) {
      try { sessionStorage.setItem(HEIGHT_KEY, String(next)); } catch (_) {}
    }
    syncComposerChrome();
    placeLiveFab();
  }

  function restoreComposerHeight(root) {
    var saved = readSavedHeight();
    if (!saved) return;
    applyComposerHeight(saved, false);
  }

  function bindResize(root) {
    var handle = root.querySelector("[data-ff-appt-resize]");
    if (!handle || handle.getAttribute("data-ff-bound") === "1") return;
    handle.setAttribute("data-ff-bound", "1");
    handle.addEventListener("pointerdown", function (ev) {
      if (ev.button != null && ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      resizing = true;
      root.classList.add("is-dragging");
      var startY = ev.clientY;
      var startH = root.getBoundingClientRect().height;
      function move(e) {
        applyComposerHeight(startH + (startY - e.clientY), false);
      }
      function up() {
        resizing = false;
        root.classList.remove("is-dragging");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        applyComposerHeight(root.getBoundingClientRect().height, true);
      }
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  }

  function syncComposerChrome() {
    var root = document.getElementById(ROOT_ID);
    if (!root || !isOpen()) {
      document.body.classList.remove("ff-appt-composer-open");
      document.documentElement.style.removeProperty("--ff-appt-composer-h");
      return;
    }
    var height = Math.round(root.getBoundingClientRect().height || composerHeight || 248);
    document.documentElement.style.setProperty("--ff-appt-composer-h", height + "px");
    document.body.classList.add("ff-appt-composer-open");
  }

  function placeLiveFab() {
    var api = window.ffBookingDrawerLive;
    var drawer = document.getElementById(ROOT_ID);
    if (!api || !drawer || !isOpen()) return;
    api.place(drawer);
  }

  function restoreLiveFab() {
    document.body.classList.remove("ff-appt-composer-open");
    document.documentElement.style.removeProperty("--ff-appt-composer-h");
    if (window.ffBookingDrawerLive) window.ffBookingDrawerLive.restore();
  }

  function ensureDom() {
    var existing = document.getElementById(ROOT_ID);
    if (existing && existing.getAttribute("data-ff-appt-ui") !== UI_VERSION) {
      existing.parentNode.removeChild(existing);
      existing = null;
    }
    if (existing && existing.parentNode !== host()) host().appendChild(existing);
    if (existing) {
      bindResize(existing);
      return;
    }
    var aside = document.createElement("aside");
    aside.id = ROOT_ID;
    aside.className = "ff-appt";
    aside.setAttribute("data-ff-appt-ui", UI_VERSION);
    aside.setAttribute("role", "dialog");
    aside.setAttribute("aria-labelledby", "ffApptTitle");
    aside.setAttribute("aria-hidden", "true");
    aside.hidden = true;
    aside.innerHTML =
      '<div class="ff-appt-resize" data-ff-appt-resize role="separator" aria-orientation="horizontal" aria-label="Resize composer"></div>' +
      '<header class="ff-appt-head">' +
        '<div class="ff-appt-head-left">' +
          '<h2 id="ffApptTitle">New Appointment</h2>' +
          '<button type="button" class="ff-appt-context" id="ffApptContext" data-ff-appt-act="edit-date"></button>' +
          '<input id="ffApptDate" class="ff-appt-date-input" type="date" tabindex="-1" aria-label="Appointment date">' +
        "</div>" +
        '<button type="button" class="ff-appt-x" data-ff-appt-act="close" aria-label="Close">×</button>' +
      "</header>" +
      '<form class="ff-appt-body" id="ffApptForm" novalidate>' +
        '<div class="ff-appt-main">' +
          '<section class="ff-appt-client-col" aria-label="Client">' +
            '<div class="ff-appt-kicker">Client</div>' +
            '<div id="ffApptClientField" class="ff-appt-client">' +
              '<div id="ffApptClientSearchWrap">' +
                '<input id="ffApptClientQ" type="text" inputmode="search" autocomplete="off" placeholder="Search or create client" aria-autocomplete="list" aria-controls="ffApptClientResults">' +
                '<button type="button" class="ff-appt-link" data-ff-appt-act="new-client">Create new client</button>' +
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
          '<section class="ff-appt-journey-col" aria-label="Service Journey">' +
            '<div class="ff-appt-kicker">Service Journey</div>' +
            '<div class="ff-appt-journey-scroll">' +
              '<div id="ffApptLines" class="ff-appt-journey"></div>' +
              '<button type="button" class="ff-appt-add-line" id="ffApptAddLine" data-ff-appt-act="add-line" hidden>+ Add Service</button>' +
            "</div>" +
          "</section>" +
        "</div>" +
        '<div id="ffApptFloat" class="ff-appt-float" hidden></div>' +
      "</form>" +
      '<footer class="ff-appt-foot">' +
        '<div class="ff-appt-foot-left">' +
          '<button type="button" class="ff-appt-note-toggle" id="ffApptNoteToggle" data-ff-appt-act="add-note">+ Add note</button>' +
          '<textarea id="ffApptNotes" class="ff-appt-note-input" rows="1" maxlength="2000" placeholder="Add a note" hidden></textarea>' +
          '<div id="ffApptError" class="ff-appt-error" hidden></div>' +
        "</div>" +
        '<div class="ff-appt-cta">' +
          '<div class="ff-appt-total"><span>Total</span><strong id="ffApptTotal">$0</strong></div>' +
          '<button type="button" class="ff-appt-primary" data-ff-appt-act="create" id="ffApptCreate">Book Appointment</button>' +
        "</div>" +
      "</footer>" +
      '<div id="ffApptClientResults" class="ff-appt-client-pop" hidden></div>';
    host().appendChild(aside);
    bindDrawer(aside);
    bindResize(aside);
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
      float: document.getElementById("ffApptFloat"),
      date: document.getElementById("ffApptDate"),
      notes: document.getElementById("ffApptNotes"),
      noteToggle: document.getElementById("ffApptNoteToggle"),
      error: document.getElementById("ffApptError"),
      total: document.getElementById("ffApptTotal"),
      create: document.getElementById("ffApptCreate")
    };
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
      var hasBlock = ((state.lines || []).some(function (line) { return line && line.serviceId; }));
      ui.addLine.hidden = !hasBlock;
    }
    if (ui.total) {
      var total = typeof api.linesTotal === "function" ? api.linesTotal(state) : 0;
      ui.total.textContent = money(total);
    }
    paintClientState();
    paintPicker();
    var lineError = !!(state.error && state.errorLineKey);
    ui.error.hidden = !state.error || lineError;
    ui.error.textContent = lineError ? "" : (state.error || "");
    ui.create.disabled = !api.canCreate(state) || state.creating;
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
    syncComposerChrome();
    placeLiveFab();
  }

  function showClientResults(rows, kind) {
    var ui = els();
    if (!ui.results) return;
    var list = rows || [];
    ui.results.hidden = false;
    if (!list.length) {
      ui.results.innerHTML = '<div class="ff-appt-picker-empty">' +
        (kind === "loading" ? "Loading clients…" : "No matching clients") +
        "</div>";
      return;
    }
    ui.results.innerHTML =
      (kind === "recent" ? '<div class="ff-appt-picker-cat">Recent clients</div>' : "") +
      list.map(function (row) {
        return '<button type="button" class="ff-appt-hit" data-ff-appt-client="' + escapeHtml(row.clientId) + '">' +
          '<span class="ff-appt-hit-avatar">' + escapeHtml(initials(row)) + "</span>" +
          '<span class="ff-appt-hit-id">' +
            "<strong>" + escapeHtml(row.displayName || "Client") + "</strong>" +
            "<span>" + escapeHtml(row.phone || row.email || "") + "</span>" +
          "</span>" +
        "</button>";
      }).join("");
  }

  function hideClientResults() {
    var ui = els();
    if (!ui.results) return;
    ui.results.hidden = true;
    ui.results.innerHTML = "";
  }

  async function searchClients(query) {
    var api = clients();
    var ui = els();
    if (!ui.results) return;
    var q = String(query || "").trim();
    var gen = ++searchGen;
    if (!api) {
      showClientResults([], q ? "results" : "recent");
      return;
    }
    showClientResults([], "loading");
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
    if (!ui.clientQ) return;
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

  function close() {
    var ui = els();
    if (!ui.root) return;
    ui.root.classList.remove("is-open");
    ui.root.setAttribute("aria-hidden", "true");
    state = null;
    resetUiState();
    hideClientResults();
    restoreLiveFab();
    if (window.ffBookingCalDraft) window.ffBookingCalDraft.clear();
    var root = ui.root;
    if (closeTimer) window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(function () {
      if (root && !root.classList.contains("is-open")) root.hidden = true;
    }, 200);
  }

  function isOpen() {
    var root = document.getElementById(ROOT_ID);
    return !!(root && root.classList.contains("is-open"));
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
    if (closeTimer) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
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
    ui.root.setAttribute("aria-hidden", "false");
    ui.clientQ.value = "";
    ui.newBox.hidden = true;
    hideClientResults();
    restoreComposerHeight(ui.root);
    syncHold();
    await api.refreshServices(state);
    requestAnimationFrame(function () {
      ui.root.classList.add("is-open");
      paint();
      placeLiveFab();
    });
    setTimeout(function () {
      if (ui.clientQ) {
        ui.clientQ.focus();
        openClientList();
      }
    }, 20);
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
        if (
          ev.target.closest && ev.target.closest("#ffApptClientQ, #ffApptClientSearchWrap")
        ) {
          openClientList();
          return;
        }
        if (
          ev.target.closest && !ev.target.closest("#ffApptClientResults")
        ) {
          hideClientResults();
        }
        else if (
          (uiState.servicePickerKey || uiState.providerPickerKey) &&
          !ev.target.closest(".ff-appt-picker, .ff-appt-float, .ff-appt-node-name, .ff-appt-node-prov, .ff-appt-node-empty, .ff-appt-add-line")
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
      } else if (name === "edit-line") {
        if (ev.target.closest("[data-ff-line-act], [data-ff-appt-act='open-service-picker'], [data-ff-appt-act='open-provider-picker'], select")) return;
        var editKey = act.getAttribute("data-ff-line") || "";
        uiState.editingKey = uiState.editingKey === editKey ? "" : editKey;
        uiState.servicePickerKey = "";
        uiState.providerPickerKey = "";
        paint();
      } else if (name === "open-service-picker") {
        uiState.servicePickerKey = act.getAttribute("data-ff-line") || "";
        uiState.providerPickerKey = "";
        uiState.editingKey = uiState.servicePickerKey;
        uiState.serviceQ = "";
        paint();
      } else if (name === "open-provider-picker") {
        uiState.providerPickerKey = act.getAttribute("data-ff-line") || "";
        uiState.servicePickerKey = "";
        uiState.editingKey = uiState.providerPickerKey;
        uiState.providerQ = "";
        paint();
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
          uiState.editingKey = last.key;
        } else {
          state = api.addLine(state);
          last = state.lines[state.lines.length - 1];
          uiState.servicePickerKey = last ? last.key : "";
          uiState.providerPickerKey = "";
          uiState.serviceQ = "";
          uiState.editingKey = last ? last.key : "";
        }
        paint();
      } else if (name === "new-client") {
        hideClientResults();
        els().newBox.hidden = !els().newBox.hidden;
        if (!els().newBox.hidden) document.getElementById("ffApptFirst").focus();
      } else if (name === "save-client") saveNewClient();
    });
    root.addEventListener("focusin", function (ev) {
      if (ev.target && ev.target.id === "ffApptClientQ") openClientList();
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
      if (ev.key === "Enter" && ev.target && ev.target.id !== "ffApptNotes") {
        ev.preventDefault();
      }
    });
    document.getElementById("ffApptForm").addEventListener("submit", function (ev) {
      ev.preventDefault();
    });
  }

  document.addEventListener("mousedown", function (ev) {
    if (!isOpen()) return;
    var target = ev.target;
    if (!target || !target.closest) return;
    if (target.closest("#ffApptClientResults, #ffApptClientQ, #ffApptClientSearchWrap")) return;
    hideClientResults();
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape" || !isOpen()) return;
    if (document.getElementById("ffLiveFloorDrawer") && document.getElementById("ffLiveFloorDrawer").classList.contains("is-open")) return;
    if (document.getElementById("ffLiveDeskPanel") && document.getElementById("ffLiveDeskPanel").classList.contains("is-open")) return;
    ev.preventDefault();
    requestClose();
  });

  window.addEventListener("resize", function () {
    if (!isOpen()) return;
    if (composerHeight) applyComposerHeight(composerHeight, true);
    syncComposerChrome();
    placeLiveFab();
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
