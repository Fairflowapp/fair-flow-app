/**
 * Clients add form + Client Profile drawer. Reads/writes only through ffBookingClients.
 */
(function () {
  var ROOT_ID = "ffBookingClientDrawer";
  var mode = "add";
  var tab = "overview";
  var editing = false;
  var clientId = "";
  var currentClient = null;
  var saving = false;
  var bound = false;

  function repo() { return window.ffBookingClients || null; }

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

  function avatarHtml(client, cls) {
    var url = String(client && client.photoUrl || "").trim();
    if (url) return '<img class="' + cls + '" src="' + escapeHtml(url) + '" alt="">';
    return '<span class="' + cls + ' ff-cli-profile-initials">' + escapeHtml(initials(client)) + "</span>";
  }

  function ensureDom() {
    var existing = document.getElementById(ROOT_ID);
    if (existing && existing.parentNode !== host()) host().appendChild(existing);
    if (existing) return existing;
    var aside = document.createElement("aside");
    aside.id = ROOT_ID;
    aside.className = "ff-cli-drawer";
    aside.setAttribute("role", "dialog");
    aside.setAttribute("aria-labelledby", "ffCliDrawerTitle");
    aside.hidden = true;
    aside.innerHTML =
      '<div id="ffCliAddPane">' +
        '<header class="ff-cli-drawer-head">' +
          '<h2 id="ffCliDrawerTitle">Add Client</h2>' +
          '<button type="button" class="ff-cli-x" data-ff-cli-drawer="close" aria-label="Close">×</button>' +
        "</header>" +
        '<form class="ff-cli-drawer-body" id="ffCliDrawerForm" novalidate>' +
          '<div class="ff-cli-row2">' +
            '<label class="ff-cli-field"><span>First name</span><input id="ffCliFirst" type="text"></label>' +
            '<label class="ff-cli-field"><span>Last name</span><input id="ffCliLast" type="text"></label>' +
          "</div>" +
          '<label class="ff-cli-field"><span>Phone</span><input id="ffCliPhone" type="tel"></label>' +
          '<label class="ff-cli-field"><span>Email</span><input id="ffCliEmail" type="email"></label>' +
          '<label class="ff-cli-field"><span>Internal notes</span><textarea id="ffCliNotes" rows="3" maxlength="2000"></textarea></label>' +
          '<div id="ffCliDrawerMsg" class="ff-cli-msg" hidden></div>' +
        "</form>" +
        '<footer class="ff-cli-drawer-foot">' +
          '<button type="button" class="ff-cli-ghost" data-ff-cli-drawer="close">Cancel</button>' +
          '<button type="button" class="ff-cli-primary" id="ffCliSave" data-ff-cli-drawer="save">Save Client</button>' +
        "</footer>" +
      "</div>" +
      '<div id="ffCliProfilePane" hidden>' +
        '<header class="ff-cli-profile-head">' +
          '<div class="ff-cli-profile-head-main">' +
            '<div id="ffCliProfileAvatar"></div>' +
            '<div class="ff-cli-profile-id">' +
              '<h2 id="ffCliProfileName">Client</h2>' +
              '<div id="ffCliProfilePhone" class="ff-cli-profile-sub"></div>' +
              '<div id="ffCliProfileEmail" class="ff-cli-profile-sub"></div>' +
            "</div>" +
          "</div>" +
          '<div class="ff-cli-profile-head-actions">' +
            '<button type="button" class="ff-cli-edit-btn" data-ff-cli-drawer="edit">Edit</button>' +
            '<button type="button" class="ff-cli-x" data-ff-cli-drawer="close" aria-label="Close">×</button>' +
          "</div>" +
        "</header>" +
        '<nav class="ff-cli-profile-tabs" aria-label="Client profile">' +
          '<button type="button" class="ff-cli-tab is-active" data-ff-cli-tab="overview">Overview</button>' +
          '<button type="button" class="ff-cli-tab" data-ff-cli-tab="appointments">Appointments</button>' +
          '<button type="button" class="ff-cli-tab" data-ff-cli-tab="notes">Notes</button>' +
        "</nav>" +
        '<div class="ff-cli-profile-body">' +
          '<div id="ffCliTabOverview" class="ff-cli-tab-panel">' +
            '<dl id="ffCliOverviewView" class="ff-cli-overview"></dl>' +
            '<form id="ffCliOverviewEdit" class="ff-cli-drawer-body ff-cli-overview-edit" hidden novalidate>' +
              '<div class="ff-cli-row2">' +
                '<label class="ff-cli-field"><span>First name</span><input id="ffCliEditFirst" type="text"></label>' +
                '<label class="ff-cli-field"><span>Last name</span><input id="ffCliEditLast" type="text"></label>' +
              "</div>" +
              '<label class="ff-cli-field"><span>Phone</span><input id="ffCliEditPhone" type="tel"></label>' +
              '<label class="ff-cli-field"><span>Email</span><input id="ffCliEditEmail" type="email"></label>' +
              '<label class="ff-cli-field"><span>Internal notes</span><textarea id="ffCliEditNotes" rows="3" maxlength="2000"></textarea></label>' +
            "</form>" +
          "</div>" +
          '<div id="ffCliTabAppointments" class="ff-cli-tab-panel" hidden>' +
            '<div class="ff-cli-soon">Coming soon</div>' +
          "</div>" +
          '<div id="ffCliTabNotes" class="ff-cli-tab-panel" hidden>' +
            '<div class="ff-cli-soon">Coming soon</div>' +
          "</div>" +
          '<div id="ffCliProfileMsg" class="ff-cli-msg" hidden></div>' +
        "</div>" +
        '<footer id="ffCliProfileFoot" class="ff-cli-drawer-foot" hidden>' +
          '<button type="button" class="ff-cli-ghost" data-ff-cli-drawer="cancel-edit">Cancel</button>' +
          '<button type="button" class="ff-cli-primary" id="ffCliProfileSave" data-ff-cli-drawer="save">Save Changes</button>' +
        "</footer>" +
      "</div>";
    host().appendChild(aside);
    bind(aside);
    return aside;
  }

  function els() {
    return {
      root: document.getElementById(ROOT_ID),
      addPane: document.getElementById("ffCliAddPane"),
      profilePane: document.getElementById("ffCliProfilePane"),
      title: document.getElementById("ffCliDrawerTitle"),
      first: document.getElementById("ffCliFirst"),
      last: document.getElementById("ffCliLast"),
      phone: document.getElementById("ffCliPhone"),
      email: document.getElementById("ffCliEmail"),
      notes: document.getElementById("ffCliNotes"),
      msg: document.getElementById("ffCliDrawerMsg"),
      save: document.getElementById("ffCliSave"),
      profileMsg: document.getElementById("ffCliProfileMsg"),
      profileSave: document.getElementById("ffCliProfileSave"),
      overviewView: document.getElementById("ffCliOverviewView"),
      overviewEdit: document.getElementById("ffCliOverviewEdit"),
      foot: document.getElementById("ffCliProfileFoot"),
      avatar: document.getElementById("ffCliProfileAvatar"),
      name: document.getElementById("ffCliProfileName"),
      profilePhone: document.getElementById("ffCliProfilePhone"),
      profileEmail: document.getElementById("ffCliProfileEmail"),
      editFirst: document.getElementById("ffCliEditFirst"),
      editLast: document.getElementById("ffCliEditLast"),
      editPhone: document.getElementById("ffCliEditPhone"),
      editEmail: document.getElementById("ffCliEditEmail"),
      editNotes: document.getElementById("ffCliEditNotes")
    };
  }

  function showMsg(target, text, isError) {
    if (!target) return;
    target.hidden = !text;
    target.textContent = text || "";
    target.classList.toggle("is-error", !!isError);
    target.classList.toggle("is-ok", !!text && !isError);
  }

  function fillAdd(client) {
    var ui = els();
    ui.first.value = client && client.firstName || "";
    ui.last.value = client && client.lastName || "";
    ui.phone.value = client && client.phone || "";
    ui.email.value = client && client.email || "";
    ui.notes.value = client && client.notes || "";
  }

  function fillEdit(client) {
    var ui = els();
    ui.editFirst.value = client && client.firstName || "";
    ui.editLast.value = client && client.lastName || "";
    ui.editPhone.value = client && client.phone || "";
    ui.editEmail.value = client && client.email || "";
    ui.editNotes.value = client && client.notes || "";
  }

  function addValues() {
    return {
      firstName: document.getElementById("ffCliFirst").value,
      lastName: document.getElementById("ffCliLast").value,
      phone: document.getElementById("ffCliPhone").value,
      email: document.getElementById("ffCliEmail").value,
      notes: document.getElementById("ffCliNotes").value
    };
  }

  function editValues() {
    return {
      firstName: document.getElementById("ffCliEditFirst").value,
      lastName: document.getElementById("ffCliEditLast").value,
      phone: document.getElementById("ffCliEditPhone").value,
      email: document.getElementById("ffCliEditEmail").value,
      notes: document.getElementById("ffCliEditNotes").value
    };
  }

  function row(label, value) {
    return '<div class="ff-cli-overview-row"><dt>' + label + "</dt><dd>" + escapeHtml(value) + "</dd></div>";
  }

  function paintOverview(client) {
    var ui = els();
    var notes = String(client && client.notes || "").trim();
    ui.overviewView.innerHTML =
      row("First name", dash(client && client.firstName)) +
      row("Last name", dash(client && client.lastName)) +
      row("Phone", dash(client && client.phone)) +
      row("Email", dash(client && client.email)) +
      row("Created", formatDate(client && client.createdAt)) +
      row("Last updated", formatDate(client && (client.updatedAt || client.createdAt))) +
      (notes ? row("Internal notes", notes) : "");
  }

  function paintHeader(client) {
    var ui = els();
    ui.avatar.innerHTML = avatarHtml(client, "ff-cli-profile-avatar");
    ui.name.textContent = (client && client.displayName) || "Client";
    ui.profilePhone.textContent = dash(client && client.phone);
    ui.profileEmail.textContent = dash(client && client.email);
  }

  function paintTabs() {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.querySelectorAll("[data-ff-cli-tab]").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-ff-cli-tab") === tab);
    });
    document.getElementById("ffCliTabOverview").hidden = tab !== "overview";
    document.getElementById("ffCliTabAppointments").hidden = tab !== "appointments";
    document.getElementById("ffCliTabNotes").hidden = tab !== "notes";
  }

  function paintProfile() {
    var ui = els();
    paintHeader(currentClient);
    paintOverview(currentClient);
    fillEdit(currentClient);
    ui.overviewView.hidden = editing;
    ui.overviewEdit.hidden = !editing;
    ui.foot.hidden = !editing;
    var editBtn = ui.root.querySelector("[data-ff-cli-drawer=edit]");
    if (editBtn) editBtn.hidden = editing;
    paintTabs();
  }

  function showAdd() {
    var ui = els();
    mode = "add";
    editing = false;
    clientId = "";
    currentClient = null;
    ui.addPane.hidden = false;
    ui.profilePane.hidden = true;
    ui.title.textContent = "Add Client";
    ui.save.textContent = "Save Client";
    ui.save.disabled = saving;
  }

  function showProfile() {
    var ui = els();
    mode = "profile";
    ui.addPane.hidden = true;
    ui.profilePane.hidden = false;
    paintProfile();
  }

  function close() {
    var ui = els();
    if (!ui.root) return;
    ui.root.hidden = true;
    ui.root.classList.remove("is-open");
    mode = "add";
    tab = "overview";
    editing = false;
    clientId = "";
    currentClient = null;
    saving = false;
    showMsg(ui.msg, "", false);
    showMsg(ui.profileMsg, "", false);
  }

  function openPanel() {
    var ui = els();
    ui.root.hidden = false;
    ui.root.classList.add("is-open");
  }

  function openAdd() {
    if (!canOpen()) return;
    ensureDom();
    showAdd();
    fillAdd(null);
    showMsg(els().msg, "", false);
    openPanel();
    setTimeout(function () {
      var first = document.getElementById("ffCliFirst");
      if (first) first.focus();
    }, 20);
  }

  async function loadClient(id) {
    var api = repo();
    var clientIdValue = String(id || "").trim();
    if (!api || !clientIdValue) return null;
    return api.getClientById(clientIdValue);
  }

  async function openDetails(idOrClient) {
    if (!canOpen()) return;
    ensureDom();
    var id = idOrClient && idOrClient.clientId ? idOrClient.clientId : String(idOrClient || "").trim();
    var client = await loadClient(id);
    if (!client) return;
    clientId = client.clientId;
    currentClient = client;
    tab = "overview";
    editing = false;
    showMsg(els().profileMsg, "", false);
    showProfile();
    openPanel();
  }

  function startEdit() {
    if (mode !== "profile" || !currentClient) return;
    tab = "overview";
    editing = true;
    fillEdit(currentClient);
    showMsg(els().profileMsg, "", false);
    paintProfile();
    setTimeout(function () {
      var first = document.getElementById("ffCliEditFirst");
      if (first) first.focus();
    }, 20);
  }

  function cancelEdit() {
    editing = false;
    fillEdit(currentClient);
    showMsg(els().profileMsg, "", false);
    paintProfile();
  }

  async function save() {
    var api = repo();
    var ui = els();
    if (!api || saving) return;
    saving = true;
    if (ui.save) ui.save.disabled = true;
    if (ui.profileSave) ui.profileSave.disabled = true;
    showMsg(ui.msg, "", false);
    showMsg(ui.profileMsg, "", false);
    var result;
    try {
      if (mode === "add") result = await api.createClient(addValues());
      else result = await api.updateClient(clientId, editValues());
    } catch (err) {
      result = { ok: false, error: err && err.message ? err.message : "Could not save client." };
    }
    saving = false;
    if (ui.save) ui.save.disabled = false;
    if (ui.profileSave) ui.profileSave.disabled = false;
    if (!result) return;
    if (mode === "add" && result.duplicate && result.client) {
      showMsg(ui.msg, "This client already exists.", true);
      if (window.ffBookingClientsUi) window.ffBookingClientsUi.showClient(result.client);
      await openDetails(result.client.clientId);
      return;
    }
    if (!result.ok) {
      showMsg(mode === "add" ? ui.msg : ui.profileMsg, result.error || "Could not save client.", true);
      return;
    }
    if (window.ffBookingClientsUi) {
      if (mode === "add") window.ffBookingClientsUi.showClient(result.client);
      else window.ffBookingClientsUi.replaceClient(result.client);
    }
    toast(mode === "add" ? "Client saved" : "Client updated");
    if (mode === "add") {
      await openDetails(result.client && result.client.clientId);
      return;
    }
    var refreshed = await loadClient(clientId);
    currentClient = refreshed || result.client;
    editing = false;
    showProfile();
    showMsg(els().profileMsg, "Client updated", false);
  }

  function bind(root) {
    if (bound) return;
    bound = true;
    root.addEventListener("click", function (ev) {
      var tabBtn = ev.target && ev.target.closest ? ev.target.closest("[data-ff-cli-tab]") : null;
      if (tabBtn) {
        ev.preventDefault();
        if (editing) return;
        tab = tabBtn.getAttribute("data-ff-cli-tab") || "overview";
        paintTabs();
        return;
      }
      var act = ev.target && ev.target.closest ? ev.target.closest("[data-ff-cli-drawer]") : null;
      if (!act) return;
      var name = act.getAttribute("data-ff-cli-drawer");
      if (name === "close") close();
      else if (name === "save") save();
      else if (name === "edit") startEdit();
      else if (name === "cancel-edit") cancelEdit();
    });
    root.addEventListener("submit", function (ev) {
      ev.preventDefault();
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape" || !isOpen()) return;
      if (document.getElementById("ffLiveFloorDrawer") && document.getElementById("ffLiveFloorDrawer").classList.contains("is-open")) return;
      ev.preventDefault();
      if (editing) cancelEdit();
      else close();
    });
  }

  function isOpen() {
    var root = document.getElementById(ROOT_ID);
    return !!(root && !root.hidden && root.classList.contains("is-open"));
  }

  window.ffBookingClientsDrawer = {
    openAdd: openAdd,
    openDetails: openDetails,
    close: close,
    forceClose: close,
    isOpen: isOpen
  };
})();
