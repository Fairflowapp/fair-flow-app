/**
 * Booking Client Profile drawer. Reads/writes only through repositories.
 */
(function () {
  var ROOT_ID = "ffBookingClientProfile";
  var tab = "overview";
  var mode = "view";
  var clientId = "";
  var currentClient = null;
  var saving = false;
  var bound = false;
  var apptLoadedFor = "";

  function clients() { return window.ffBookingClients || null; }
  function apptsUi() { return window.ffBookingClientProfileAppointments || null; }

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

  function toast(message) {
    if (window.ffToast && typeof window.ffToast.show === "function") {
      window.ffToast.show(message, { variant: "success", durationMs: 2200 });
    }
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
    if (window.ffBookingClientsUi && window.ffBookingClientsUi.initials) {
      return window.ffBookingClientsUi.initials(client);
    }
    var name = String(client && client.displayName || "").trim();
    return name ? name.charAt(0).toUpperCase() : "?";
  }

  function formatDate(value) {
    if (window.ffBookingClientsUi && window.ffBookingClientsUi.formatUpdated) {
      return window.ffBookingClientsUi.formatUpdated(value);
    }
    return "—";
  }

  function avatarHtml(client) {
    var url = String(client && client.photoUrl || "").trim();
    if (url) return '<img class="ff-clip-avatar" src="' + escapeHtml(url) + '" alt="">';
    return '<span class="ff-clip-avatar ff-clip-initials">' + escapeHtml(initials(client)) + "</span>";
  }

  function ensureDom() {
    var existing = document.getElementById(ROOT_ID);
    if (existing && existing.parentNode !== host()) host().appendChild(existing);
    if (existing) return existing;
    var aside = document.createElement("aside");
    aside.id = ROOT_ID;
    aside.className = "ff-clip-drawer";
    aside.setAttribute("role", "dialog");
    aside.setAttribute("aria-labelledby", "ffClipName");
    aside.hidden = true;
    aside.innerHTML =
      '<header class="ff-clip-head">' +
        '<div class="ff-clip-head-main">' +
          '<div id="ffClipAvatar"></div>' +
          '<div class="ff-clip-id">' +
            '<h2 id="ffClipName">Client</h2>' +
            '<div id="ffClipPhone" class="ff-clip-sub"></div>' +
            '<div id="ffClipEmail" class="ff-clip-sub"></div>' +
          "</div>" +
        "</div>" +
        '<div class="ff-clip-head-actions">' +
          '<button type="button" class="ff-clip-edit" data-ff-clip="edit">Edit</button>' +
          '<button type="button" class="ff-clip-x" data-ff-clip="close" aria-label="Close">×</button>' +
        "</div>" +
      "</header>" +
      '<nav class="ff-clip-tabs" aria-label="Client profile">' +
        '<button type="button" class="ff-clip-tab is-active" data-ff-clip-tab="overview">Overview</button>' +
        '<button type="button" class="ff-clip-tab" data-ff-clip-tab="appointments">Appointments</button>' +
        '<button type="button" class="ff-clip-tab" data-ff-clip-tab="notes">Notes</button>' +
      "</nav>" +
      '<div class="ff-clip-body">' +
        '<div id="ffClipTabOverview" class="ff-clip-panel">' +
          '<div id="ffClipOverviewView"></div>' +
          '<form id="ffClipEditForm" class="ff-clip-form" hidden novalidate>' +
            '<div class="ff-clip-row2">' +
              '<label class="ff-clip-field"><span>First name</span><input id="ffClipFirst" type="text"></label>' +
              '<label class="ff-clip-field"><span>Last name</span><input id="ffClipLast" type="text"></label>' +
            "</div>" +
            '<label class="ff-clip-field"><span>Phone</span><input id="ffClipPhoneIn" type="tel"></label>' +
            '<label class="ff-clip-field"><span>Email</span><input id="ffClipEmailIn" type="email"></label>' +
            '<label class="ff-clip-field"><span>Notes</span><textarea id="ffClipNotesIn" rows="4" maxlength="2000"></textarea></label>' +
          "</form>" +
        "</div>" +
        '<div id="ffClipTabAppointments" class="ff-clip-panel" hidden></div>' +
        '<div id="ffClipTabNotes" class="ff-clip-panel" hidden></div>' +
        '<div id="ffClipMsg" class="ff-clip-msg" hidden></div>' +
      "</div>" +
      '<footer id="ffClipFoot" class="ff-clip-foot" hidden>' +
        '<button type="button" class="ff-clip-ghost" data-ff-clip="cancel">Cancel</button>' +
        '<button type="button" class="ff-clip-primary" id="ffClipSave" data-ff-clip="save">Save Changes</button>' +
      "</footer>";
    host().appendChild(aside);
    bind(aside);
    return aside;
  }

  function els() {
    return {
      root: document.getElementById(ROOT_ID),
      avatar: document.getElementById("ffClipAvatar"),
      name: document.getElementById("ffClipName"),
      phone: document.getElementById("ffClipPhone"),
      email: document.getElementById("ffClipEmail"),
      overview: document.getElementById("ffClipOverviewView"),
      form: document.getElementById("ffClipEditForm"),
      first: document.getElementById("ffClipFirst"),
      last: document.getElementById("ffClipLast"),
      phoneIn: document.getElementById("ffClipPhoneIn"),
      emailIn: document.getElementById("ffClipEmailIn"),
      notesIn: document.getElementById("ffClipNotesIn"),
      appts: document.getElementById("ffClipTabAppointments"),
      notes: document.getElementById("ffClipTabNotes"),
      msg: document.getElementById("ffClipMsg"),
      foot: document.getElementById("ffClipFoot"),
      save: document.getElementById("ffClipSave")
    };
  }

  function showMsg(text, isError) {
    var msg = els().msg;
    if (!msg) return;
    msg.hidden = !text;
    msg.textContent = text || "";
    msg.classList.toggle("is-error", !!isError);
    msg.classList.toggle("is-ok", !!text && !isError);
  }

  function field(label, value) {
    return '<div class="ff-clip-row"><dt>' + label + "</dt><dd>" + escapeHtml(value) + "</dd></div>";
  }

  function paintOverview(client) {
    var notes = String(client && client.notes || "").trim();
    els().overview.innerHTML =
      '<section class="ff-clip-section"><h3>Contact Information</h3><dl>' +
        field("First name", dash(client && client.firstName)) +
        field("Last name", dash(client && client.lastName)) +
        field("Phone", dash(client && client.phone)) +
        field("Email", dash(client && client.email)) +
      "</dl></section>" +
      '<section class="ff-clip-section"><h3>Client Information</h3><dl>' +
        field("Client since", formatDate(client && client.createdAt)) +
        field("Last updated", formatDate(client && (client.updatedAt || client.createdAt))) +
      "</dl></section>" +
      '<section class="ff-clip-section"><h3>Notes preview</h3>' +
        '<p class="ff-clip-notes-preview">' + escapeHtml(notes || "No notes") + "</p>" +
      "</section>";
  }

  function paintNotes(client) {
    var notes = String(client && client.notes || "").trim();
    var ui = els();
    if (mode === "notes") {
      ui.notes.innerHTML =
        '<form class="ff-clip-form" novalidate>' +
          '<label class="ff-clip-field"><span>Notes</span><textarea id="ffClipNotesTabIn" rows="6" maxlength="2000">' +
          escapeHtml(client && client.notes || "") + "</textarea></label>" +
        "</form>";
      return;
    }
    ui.notes.innerHTML =
      '<p class="ff-clip-notes-body">' + escapeHtml(notes || "No notes for this client.") + "</p>" +
      '<button type="button" class="ff-clip-link" data-ff-clip="edit-notes">Edit Notes</button>';
  }

  function fillEdit(client) {
    var ui = els();
    ui.first.value = client && client.firstName || "";
    ui.last.value = client && client.lastName || "";
    ui.phoneIn.value = client && client.phone || "";
    ui.emailIn.value = client && client.email || "";
    ui.notesIn.value = client && client.notes || "";
  }

  function editValues() {
    var notesTab = document.getElementById("ffClipNotesTabIn");
    return {
      firstName: document.getElementById("ffClipFirst").value,
      lastName: document.getElementById("ffClipLast").value,
      phone: document.getElementById("ffClipPhoneIn").value,
      email: document.getElementById("ffClipEmailIn").value,
      notes: notesTab && mode === "notes" ? notesTab.value : document.getElementById("ffClipNotesIn").value
    };
  }

  function paintHeader(client) {
    var ui = els();
    ui.avatar.innerHTML = avatarHtml(client);
    ui.name.textContent = (client && client.displayName) || "Client";
    ui.phone.textContent = dash(client && client.phone);
    ui.email.textContent = dash(client && client.email);
  }

  function paintTabs() {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.querySelectorAll("[data-ff-clip-tab]").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-ff-clip-tab") === tab);
    });
    document.getElementById("ffClipTabOverview").hidden = tab !== "overview";
    document.getElementById("ffClipTabAppointments").hidden = tab !== "appointments";
    document.getElementById("ffClipTabNotes").hidden = tab !== "notes";
  }

  function paint() {
    var ui = els();
    paintHeader(currentClient);
    paintOverview(currentClient);
    fillEdit(currentClient);
    paintNotes(currentClient);
    var editing = mode === "edit" || mode === "notes";
    ui.overview.hidden = mode === "edit";
    ui.form.hidden = mode !== "edit";
    ui.foot.hidden = !editing;
    var editBtn = ui.root.querySelector("[data-ff-clip=edit]");
    if (editBtn) editBtn.hidden = editing;
    paintTabs();
  }

  async function loadAppointments() {
    var ui = els();
    if (!currentClient || !apptsUi()) {
      ui.appts.innerHTML = '<div class="ff-clip-empty">Appointments are unavailable.</div>';
      return;
    }
    if (apptLoadedFor === currentClient.clientId && ui.appts.childNodes.length) return;
    ui.appts.innerHTML = '<div class="ff-clip-empty">Loading appointments…</div>';
    var data;
    try {
      data = await apptsUi().load(currentClient.clientId);
    } catch (err) {
      ui.appts.innerHTML = '<div class="ff-clip-empty">Could not load appointments.</div>';
      return;
    }
    apptLoadedFor = currentClient.clientId;
    apptsUi().render(ui.appts, data);
  }

  async function setTab(next) {
    tab = next || "overview";
    if (mode === "edit" || mode === "notes") {
      mode = "view";
      fillEdit(currentClient);
    }
    showMsg("", false);
    paint();
    if (tab === "appointments") await loadAppointments();
  }

  function close() {
    var ui = els();
    if (!ui.root) return;
    ui.root.hidden = true;
    ui.root.classList.remove("is-open");
    tab = "overview";
    mode = "view";
    clientId = "";
    currentClient = null;
    saving = false;
    apptLoadedFor = "";
    showMsg("", false);
  }

  function openPanel() {
    var ui = els();
    ui.root.hidden = false;
    ui.root.classList.add("is-open");
  }

  async function open(idOrClient) {
    if (!canOpen()) return;
    if (window.ffBookingAppointmentDetails && window.ffBookingAppointmentDetails.forceClose) {
      window.ffBookingAppointmentDetails.forceClose();
    }
    if (window.ffBookingClientsOptions) window.ffBookingClientsOptions.close();
    ensureDom();
    var id = idOrClient && idOrClient.clientId ? idOrClient.clientId : String(idOrClient || "").trim();
    var api = clients();
    var client = api && id ? await api.getClientById(id) : null;
    if (!client) return;
    clientId = client.clientId;
    currentClient = client;
    tab = "overview";
    mode = "view";
    apptLoadedFor = "";
    showMsg("", false);
    paint();
    openPanel();
  }

  function startEdit() {
    if (!currentClient) return;
    tab = "overview";
    mode = "edit";
    fillEdit(currentClient);
    showMsg("", false);
    paint();
    setTimeout(function () {
      var first = document.getElementById("ffClipFirst");
      if (first) first.focus();
    }, 20);
  }

  function startNotesEdit() {
    if (!currentClient) return;
    tab = "notes";
    mode = "notes";
    showMsg("", false);
    paint();
    setTimeout(function () {
      var field = document.getElementById("ffClipNotesTabIn");
      if (field) field.focus();
    }, 20);
  }

  function cancelEdit() {
    mode = "view";
    fillEdit(currentClient);
    showMsg("", false);
    paint();
  }

  async function save() {
    var api = clients();
    var ui = els();
    if (!api || saving || !clientId) return;
    saving = true;
    if (ui.save) ui.save.disabled = true;
    showMsg("", false);
    var result;
    try {
      result = await api.updateClient(clientId, editValues());
    } catch (err) {
      result = { ok: false, error: err && err.message ? err.message : "Could not save client." };
    }
    saving = false;
    if (ui.save) ui.save.disabled = false;
    if (!result || !result.ok) {
      showMsg((result && result.error) || "Could not save client.", true);
      return;
    }
    if (window.ffBookingClientsUi && window.ffBookingClientsUi.replaceClient) {
      window.ffBookingClientsUi.replaceClient(result.client);
    }
    var refreshed = await api.getClientById(clientId);
    currentClient = refreshed || result.client;
    mode = "view";
    tab = tab === "notes" ? "notes" : "overview";
    paint();
    showMsg("Client updated", false);
    toast("Client updated");
  }

  function bind(root) {
    if (bound) return;
    bound = true;
    root.addEventListener("click", function (ev) {
      var tabBtn = ev.target && ev.target.closest ? ev.target.closest("[data-ff-clip-tab]") : null;
      if (tabBtn) {
        ev.preventDefault();
        setTab(tabBtn.getAttribute("data-ff-clip-tab") || "overview");
        return;
      }
      var toggle = ev.target && ev.target.closest ? ev.target.closest("[data-ff-cli-appt-toggle]") : null;
      if (toggle) {
        ev.preventDefault();
        var apptId = toggle.getAttribute("data-ff-cli-appt-toggle");
        if (window.ffBookingAppointmentDetails && typeof window.ffBookingAppointmentDetails.open === "function") {
          window.ffBookingAppointmentDetails.open({ appointmentId: apptId });
        } else if (apptsUi()) {
          apptsUi().toggle(els().appts, apptId);
        }
        return;
      }
      var act = ev.target && ev.target.closest ? ev.target.closest("[data-ff-clip]") : null;
      if (!act) return;
      var name = act.getAttribute("data-ff-clip");
      if (name === "close") close();
      else if (name === "edit") startEdit();
      else if (name === "edit-notes") startNotesEdit();
      else if (name === "cancel") cancelEdit();
      else if (name === "save") save();
    });
    root.addEventListener("submit", function (ev) { ev.preventDefault(); });
    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape" || !isOpen()) return;
      if (document.getElementById("ffLiveFloorDrawer") && document.getElementById("ffLiveFloorDrawer").classList.contains("is-open")) return;
      ev.preventDefault();
      if (mode === "edit" || mode === "notes") cancelEdit();
      else close();
    });
  }

  function isOpen() {
    var root = document.getElementById(ROOT_ID);
    return !!(root && !root.hidden && root.classList.contains("is-open"));
  }

  window.ffBookingClientProfile = {
    open: open,
    close: close,
    forceClose: close,
    isOpen: isOpen
  };
})();
