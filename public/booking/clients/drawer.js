/**
 * Clients add/details drawer. Writes only through ffBookingClients.
 */
(function () {
  var ROOT_ID = "ffBookingClientDrawer";
  var mode = "add";
  var clientId = "";
  var saving = false;

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
        '<label class="ff-cli-field"><span>Notes</span><textarea id="ffCliNotes" rows="3" maxlength="2000"></textarea></label>' +
        '<div id="ffCliDrawerMsg" class="ff-cli-msg" hidden></div>' +
      "</form>" +
      '<footer class="ff-cli-drawer-foot">' +
        '<button type="button" class="ff-cli-ghost" data-ff-cli-drawer="close">Cancel</button>' +
        '<button type="button" class="ff-cli-primary" id="ffCliSave" data-ff-cli-drawer="save">Save Client</button>' +
      "</footer>";
    host().appendChild(aside);
    bind(aside);
    return aside;
  }

  function els() {
    return {
      root: document.getElementById(ROOT_ID),
      title: document.getElementById("ffCliDrawerTitle"),
      first: document.getElementById("ffCliFirst"),
      last: document.getElementById("ffCliLast"),
      phone: document.getElementById("ffCliPhone"),
      email: document.getElementById("ffCliEmail"),
      notes: document.getElementById("ffCliNotes"),
      msg: document.getElementById("ffCliDrawerMsg"),
      save: document.getElementById("ffCliSave")
    };
  }

  function showMsg(text, isError) {
    var ui = els();
    if (!ui.msg) return;
    ui.msg.hidden = !text;
    ui.msg.textContent = text || "";
    ui.msg.classList.toggle("is-error", !!isError);
  }

  function fill(client) {
    var ui = els();
    ui.first.value = client && client.firstName || "";
    ui.last.value = client && client.lastName || "";
    ui.phone.value = client && client.phone || "";
    ui.email.value = client && client.email || "";
    ui.notes.value = client && client.notes || "";
  }

  function values() {
    return {
      firstName: document.getElementById("ffCliFirst").value,
      lastName: document.getElementById("ffCliLast").value,
      phone: document.getElementById("ffCliPhone").value,
      email: document.getElementById("ffCliEmail").value,
      notes: document.getElementById("ffCliNotes").value
    };
  }

  function setMode(next, id) {
    mode = next;
    clientId = id || "";
    var ui = els();
    ui.title.textContent = next === "details" ? "Client Details" : "Add Client";
    ui.save.textContent = next === "details" ? "Save Changes" : "Save Client";
    ui.save.disabled = saving;
  }

  function close() {
    var ui = els();
    if (!ui.root) return;
    ui.root.hidden = true;
    ui.root.classList.remove("is-open");
    mode = "add";
    clientId = "";
    saving = false;
    showMsg("", false);
  }

  function openPanel() {
    var ui = els();
    ui.root.hidden = false;
    ui.root.classList.add("is-open");
    setTimeout(function () { ui.first.focus(); }, 20);
  }

  function openAdd() {
    if (!canOpen()) return;
    ensureDom();
    setMode("add", "");
    fill(null);
    showMsg("", false);
    openPanel();
  }

  async function openDetails(idOrClient) {
    if (!canOpen()) return;
    ensureDom();
    var api = repo();
    var client = idOrClient && idOrClient.clientId ? idOrClient : null;
    var id = client ? client.clientId : String(idOrClient || "").trim();
    if (!client && api && id) client = await api.getClientById(id);
    if (!client) return;
    setMode("details", client.clientId);
    fill(client);
    showMsg("", false);
    openPanel();
  }

  async function save() {
    var api = repo();
    var ui = els();
    if (!api || saving) return;
    saving = true;
    ui.save.disabled = true;
    showMsg("", false);
    var result;
    try {
      if (mode === "add") result = await api.createClient(values());
      else result = await api.updateClient(clientId, values());
    } catch (err) {
      result = { ok: false, error: err && err.message ? err.message : "Could not save client." };
    }
    saving = false;
    ui.save.disabled = false;
    if (!result) return;
    if (mode === "add" && result.duplicate && result.client) {
      showMsg("This client already exists.", true);
      setMode("details", result.client.clientId);
      fill(result.client);
      if (window.ffBookingClientsUi) window.ffBookingClientsUi.showClient(result.client);
      return;
    }
    if (!result.ok) {
      showMsg(result.error || "Could not save client.", true);
      return;
    }
    if (window.ffBookingClientsUi) {
      if (mode === "add") window.ffBookingClientsUi.showClient(result.client);
      else window.ffBookingClientsUi.replaceClient(result.client);
    }
    toast(mode === "details" ? "Client updated" : "Client saved");
    close();
  }

  function bind(root) {
    root.addEventListener("click", function (ev) {
      var act = ev.target && ev.target.closest ? ev.target.closest("[data-ff-cli-drawer]") : null;
      if (!act) return;
      var name = act.getAttribute("data-ff-cli-drawer");
      if (name === "close") close();
      else if (name === "save") save();
    });
    root.addEventListener("submit", function (ev) {
      ev.preventDefault();
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape" || !isOpen()) return;
      if (document.getElementById("ffLiveFloorDrawer") && document.getElementById("ffLiveFloorDrawer").classList.contains("is-open")) return;
      ev.preventDefault();
      close();
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
