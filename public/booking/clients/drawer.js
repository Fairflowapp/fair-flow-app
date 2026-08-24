/**
 * Add Client drawer. Profile lives in ffBookingClientProfile.
 */
(function () {
  var ROOT_ID = "ffBookingClientDrawer";
  var saving = false;
  var bound = false;

  function repo() { return window.ffBookingClients || null; }
  function profile() { return window.ffBookingClientProfile || null; }

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
        '<label class="ff-cli-field"><span>Internal notes</span><textarea id="ffCliNotes" rows="3" maxlength="2000"></textarea></label>' +
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

  function showMsg(text, isError) {
    var msg = document.getElementById("ffCliDrawerMsg");
    if (!msg) return;
    msg.hidden = !text;
    msg.textContent = text || "";
    msg.classList.toggle("is-error", !!isError);
    msg.classList.toggle("is-ok", !!text && !isError);
  }

  function fillEmpty() {
    document.getElementById("ffCliFirst").value = "";
    document.getElementById("ffCliLast").value = "";
    document.getElementById("ffCliPhone").value = "";
    document.getElementById("ffCliEmail").value = "";
    document.getElementById("ffCliNotes").value = "";
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

  function close() {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.hidden = true;
    root.classList.remove("is-open");
    saving = false;
    showMsg("", false);
  }

  function openAdd() {
    if (!canOpen()) return;
    if (window.ffBookingClientsOptions) window.ffBookingClientsOptions.close();
    if (profile()) profile().close();
    ensureDom();
    fillEmpty();
    showMsg("", false);
    var root = document.getElementById(ROOT_ID);
    root.hidden = false;
    root.classList.add("is-open");
    setTimeout(function () {
      var first = document.getElementById("ffCliFirst");
      if (first) first.focus();
    }, 20);
  }

  async function openDetails(idOrClient) {
    if (profile()) {
      close();
      await profile().open(idOrClient);
    }
  }

  async function save() {
    var api = repo();
    var btn = document.getElementById("ffCliSave");
    if (!api || saving) return;
    saving = true;
    if (btn) btn.disabled = true;
    showMsg("", false);
    var result;
    try {
      result = await api.createClient(values());
    } catch (err) {
      result = { ok: false, error: err && err.message ? err.message : "Could not save client." };
    }
    saving = false;
    if (btn) btn.disabled = false;
    if (!result) return;
    if (result.duplicate && result.client) {
      showMsg("This client already exists.", true);
      if (window.ffBookingClientsUi) window.ffBookingClientsUi.showClient(result.client);
      await openDetails(result.client.clientId);
      return;
    }
    if (!result.ok) {
      showMsg(result.error || "Could not save client.", true);
      return;
    }
    if (window.ffBookingClientsUi) window.ffBookingClientsUi.showClient(result.client);
    toast("Client saved");
    await openDetails(result.client && result.client.clientId);
  }

  function bind(root) {
    if (bound) return;
    bound = true;
    root.addEventListener("click", function (ev) {
      var act = ev.target && ev.target.closest ? ev.target.closest("[data-ff-cli-drawer]") : null;
      if (!act) return;
      var name = act.getAttribute("data-ff-cli-drawer");
      if (name === "close") close();
      else if (name === "save") save();
    });
    root.addEventListener("submit", function (ev) { ev.preventDefault(); });
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
