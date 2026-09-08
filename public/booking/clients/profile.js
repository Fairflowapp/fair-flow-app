/**
 * Booking Client Profile drawer. Reads/writes only through repositories.
 */
(function () {
  var ROOT_ID = "ffBookingClientProfile";
  var tab = "sales";
  var mode = "view";
  var clientId = "";
  var currentClient = null;
  var saving = false;
  var bound = false;
  var apptLoadedFor = "";
  var pendingFile = null;
  var pendingPreviewUrl = "";
  var pendingRemove = false;
  var cameraStream = null;

  function clients() { return window.ffBookingClients || null; }
  function apptsUi() { return window.ffBookingClientProfileAppointments || null; }
  function salesUi() { return window.ffBookingClientProfileSales || null; }
  function memsUi() { return window.ffBookingClientProfileMemberships || null; }
  function paysUi() { return window.ffBookingClientProfilePayments || null; }
  function defaultTab() {
    var api = salesUi();
    return (api && api.DEFAULT_TAB) || "sales";
  }

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

  function avatarHtml(client) {
    var url = String(client && client.photoUrl || "").trim();
    if (url) return '<img class="ff-clip-avatar" src="' + escapeHtml(url) + '" alt="">';
    return '<span class="ff-clip-avatar ff-clip-initials">' + escapeHtml(initials(client)) + "</span>";
  }

  function ensureDom() {
    var existing = document.getElementById(ROOT_ID);
    if (existing && (!existing.querySelector('[data-ff-clip-tab="payments"]') || !existing.querySelector("[data-ff-clip=conversations]") || !existing.querySelector("#ffClipCamera"))) {
      existing.parentNode.removeChild(existing);
      existing = null;
      bound = false;
    }
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
          '<div class="ff-clip-avatar-wrap" id="ffClipAvatarWrap">' +
            '<div id="ffClipAvatar"></div>' +
            '<button type="button" class="ff-clip-photo-btn" data-ff-clip="photo" hidden aria-label="Change photo">' +
              '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1.2 2H20a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3.8L9 3zm3 5.2A4.8 4.8 0 1 0 16.8 13 4.8 4.8 0 0 0 12 8.2z"/></svg>' +
            "</button>" +
            '<div id="ffClipPhotoMenu" class="ff-clip-photo-menu" hidden>' +
              '<button type="button" data-ff-clip-photo="camera">Take photo</button>' +
              '<button type="button" data-ff-clip-photo="upload">Upload photo</button>' +
              '<button type="button" data-ff-clip-photo="remove" hidden>Remove photo</button>' +
            "</div>" +
          "</div>" +
          '<input id="ffClipPhotoFile" class="ff-clip-sr-file" type="file" accept="image/*">' +
          '<input id="ffClipPhotoCamera" class="ff-clip-sr-file" type="file" accept="image/*" capture="environment">' +
          '<div class="ff-clip-id">' +
            '<h2 id="ffClipName">Client</h2>' +
            '<div id="ffClipPhone" class="ff-clip-sub"></div>' +
            '<div id="ffClipEmail" class="ff-clip-sub"></div>' +
          "</div>" +
        "</div>" +
        '<div class="ff-clip-head-actions">' +
          '<div class="ff-clip-conv-wrap">' +
            '<button type="button" class="ff-clip-icon-btn" data-ff-clip="conversations" aria-label="Conversations" title="Conversations">' +
              '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 3.2V5a2 2 0 0 1 2-2zm3.2 5.2v1.4h9.6V8.2H7.2zm0 3.2v1.4h7.2v-1.4H7.2z"/></svg>' +
            "</button>" +
            '<div id="ffClipConvMenu" class="ff-clip-conv-menu" hidden>' +
              '<button type="button" data-ff-clip-conv="sms">Text client</button>' +
              '<button type="button" data-ff-clip-conv="call">Call</button>' +
              '<button type="button" data-ff-clip-conv="email">Email</button>' +
            "</div>" +
          "</div>" +
          '<button type="button" class="ff-clip-edit" data-ff-clip="edit">Edit</button>' +
          '<button type="button" class="ff-clip-x" data-ff-clip="close" aria-label="Close">×</button>' +
        "</div>" +
      "</header>" +
      '<nav class="ff-clip-tabs" aria-label="Client profile">' +
        '<button type="button" class="ff-clip-tab is-active" data-ff-clip-tab="sales">Sales</button>' +
        '<button type="button" class="ff-clip-tab" data-ff-clip-tab="appointments">Appointments</button>' +
        '<button type="button" class="ff-clip-tab" data-ff-clip-tab="memberships">Memberships</button>' +
        '<button type="button" class="ff-clip-tab" data-ff-clip-tab="payments">Payments</button>' +
        '<button type="button" class="ff-clip-tab" data-ff-clip-tab="notes">Notes</button>' +
      "</nav>" +
      '<div class="ff-clip-body">' +
        '<div id="ffClipTabSales" class="ff-clip-panel"></div>' +
        '<div id="ffClipTabAppointments" class="ff-clip-panel" hidden></div>' +
        '<div id="ffClipTabMemberships" class="ff-clip-panel" hidden></div>' +
        '<div id="ffClipTabPayments" class="ff-clip-panel" hidden></div>' +
        '<div id="ffClipTabNotes" class="ff-clip-panel" hidden></div>' +
        '<form id="ffClipEditForm" class="ff-clip-form" hidden novalidate>' +
          '<div class="ff-clip-row2">' +
            '<label class="ff-clip-field"><span>First name</span><input id="ffClipFirst" type="text"></label>' +
            '<label class="ff-clip-field"><span>Last name</span><input id="ffClipLast" type="text"></label>' +
          "</div>" +
          '<label class="ff-clip-field"><span>Phone</span><input id="ffClipPhoneIn" type="tel"></label>' +
          '<label class="ff-clip-field"><span>Email</span><input id="ffClipEmailIn" type="email"></label>' +
          '<label class="ff-clip-field"><span>Notes</span><textarea id="ffClipNotesIn" rows="4" maxlength="2000"></textarea></label>' +
          '<button type="button" class="ff-clip-more" data-ff-clip-more="social">Social media</button>' +
          '<div id="ffClipMoreSocial" class="ff-clip-more-body" hidden>' +
            '<label class="ff-clip-field"><span>Instagram</span><input id="ffClipInstagram" type="text" placeholder="@username"></label>' +
          "</div>" +
          '<button type="button" class="ff-clip-more" data-ff-clip-more="details">Additional details</button>' +
          '<div id="ffClipMoreDetails" class="ff-clip-more-body" hidden>' +
            '<label class="ff-clip-field"><span>Birthday</span><input id="ffClipBirthday" type="date"></label>' +
            '<label class="ff-clip-field"><span>Referral source</span><input id="ffClipReferral" type="text"></label>' +
          "</div>" +
          '<button type="button" class="ff-clip-more" data-ff-clip-more="address">Address</button>' +
          '<div id="ffClipMoreAddress" class="ff-clip-more-body" hidden>' +
            '<label class="ff-clip-field"><span>Street</span><input id="ffClipStreet" type="text"></label>' +
            '<div class="ff-clip-row2">' +
              '<label class="ff-clip-field"><span>City</span><input id="ffClipCity" type="text"></label>' +
              '<label class="ff-clip-field"><span>State</span><input id="ffClipState" type="text"></label>' +
            "</div>" +
            '<label class="ff-clip-field"><span>ZIP</span><input id="ffClipZip" type="text"></label>' +
          "</div>" +
          '<button type="button" class="ff-clip-more" data-ff-clip-more="messaging">Messaging preferences</button>' +
          '<div id="ffClipMoreMessaging" class="ff-clip-more-body" hidden>' +
            '<label class="ff-clip-check"><input id="ffClipAllowSms" type="checkbox" checked><span>Allow text messages</span></label>' +
            '<label class="ff-clip-check"><input id="ffClipAllowEmail" type="checkbox" checked><span>Allow emails</span></label>' +
          "</div>" +
        "</form>" +
        '<div id="ffClipCamera" class="ff-clip-camera" hidden>' +
          '<video id="ffClipCameraVideo" autoplay playsinline muted></video>' +
          '<div class="ff-clip-camera-acts">' +
            '<button type="button" class="ff-clip-ghost" data-ff-clip-photo="camera-cancel">Cancel</button>' +
            '<button type="button" class="ff-clip-primary" data-ff-clip-photo="snap">Take photo</button>' +
          "</div>" +
        "</div>" +
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
      sales: document.getElementById("ffClipTabSales"),
      memberships: document.getElementById("ffClipTabMemberships"),
      payments: document.getElementById("ffClipTabPayments"),
      form: document.getElementById("ffClipEditForm"),
      first: document.getElementById("ffClipFirst"),
      last: document.getElementById("ffClipLast"),
      phoneIn: document.getElementById("ffClipPhoneIn"),
      emailIn: document.getElementById("ffClipEmailIn"),
      notesIn: document.getElementById("ffClipNotesIn"),
      instagram: document.getElementById("ffClipInstagram"),
      birthday: document.getElementById("ffClipBirthday"),
      referral: document.getElementById("ffClipReferral"),
      street: document.getElementById("ffClipStreet"),
      city: document.getElementById("ffClipCity"),
      state: document.getElementById("ffClipState"),
      zip: document.getElementById("ffClipZip"),
      allowSms: document.getElementById("ffClipAllowSms"),
      allowEmail: document.getElementById("ffClipAllowEmail"),
      convMenu: document.getElementById("ffClipConvMenu"),
      photoMenu: document.getElementById("ffClipPhotoMenu"),
      photoBtn: document.querySelector("[data-ff-clip=photo]"),
      photoFile: document.getElementById("ffClipPhotoFile"),
      photoCamera: document.getElementById("ffClipPhotoCamera"),
      photoRemove: document.querySelector("[data-ff-clip-photo=remove]"),
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

  function paintSales() {
    var ui = els();
    var api = salesUi();
    if (!ui.sales) return;
    if (!api || typeof api.render !== "function") {
      ui.sales.innerHTML = '<div class="ff-clip-empty">Sales are unavailable.</div>';
      return;
    }
    api.render(ui.sales, currentClient && currentClient.clientId);
  }

  function paintMemberships() {
    var ui = els();
    var api = memsUi();
    if (!ui.memberships) return;
    if (!api || typeof api.render !== "function") {
      ui.memberships.innerHTML = '<div class="ff-clip-empty">Memberships are unavailable.</div>';
      return;
    }
    api.render(ui.memberships);
  }

  function paintPayments() {
    var ui = els();
    var api = paysUi();
    if (!ui.payments) return;
    if (!api || typeof api.render !== "function") {
      ui.payments.innerHTML = '<div class="ff-clip-empty">Payments are unavailable.</div>';
      return;
    }
    api.render(ui.payments);
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
    if (!ui.first) return;
    ui.first.value = client && client.firstName || "";
    ui.last.value = client && client.lastName || "";
    ui.phoneIn.value = client && client.phone || "";
    ui.emailIn.value = client && client.email || "";
    ui.notesIn.value = client && client.notes || "";
    if (ui.instagram) ui.instagram.value = client && client.instagram || "";
    if (ui.birthday) ui.birthday.value = client && client.birthday || "";
    if (ui.referral) ui.referral.value = client && client.referralSource || "";
    if (ui.street) ui.street.value = client && client.addressStreet || "";
    if (ui.city) ui.city.value = client && client.addressCity || "";
    if (ui.state) ui.state.value = client && client.addressState || "";
    if (ui.zip) ui.zip.value = client && client.addressZip || "";
    if (ui.allowSms) ui.allowSms.checked = !client || client.allowSms !== false;
    if (ui.allowEmail) ui.allowEmail.checked = !client || client.allowEmail !== false;
  }

  function editValues() {
    var notesTab = document.getElementById("ffClipNotesTabIn");
    var ui = els();
    return {
      firstName: ui.first.value,
      lastName: ui.last.value,
      phone: ui.phoneIn.value,
      email: ui.emailIn.value,
      notes: notesTab && mode === "notes" ? notesTab.value : ui.notesIn.value,
      instagram: ui.instagram ? ui.instagram.value : "",
      birthday: ui.birthday ? ui.birthday.value : "",
      referralSource: ui.referral ? ui.referral.value : "",
      addressStreet: ui.street ? ui.street.value : "",
      addressCity: ui.city ? ui.city.value : "",
      addressState: ui.state ? ui.state.value : "",
      addressZip: ui.zip ? ui.zip.value : "",
      allowSms: ui.allowSms ? ui.allowSms.checked : true,
      allowEmail: ui.allowEmail ? ui.allowEmail.checked : true
    };
  }

  function clearPendingPhoto() {
    if (pendingPreviewUrl) {
      try { URL.revokeObjectURL(pendingPreviewUrl); } catch (_) {}
    }
    pendingFile = null;
    pendingPreviewUrl = "";
    pendingRemove = false;
    stopCamera();
    hidePhotoMenu();
  }

  function displayClient() {
    if (!currentClient) return null;
    if (pendingPreviewUrl) return Object.assign({}, currentClient, { photoUrl: pendingPreviewUrl });
    if (pendingRemove) return Object.assign({}, currentClient, { photoUrl: "" });
    return currentClient;
  }

  function hasPhotoToShow() {
    var client = displayClient();
    return !!(client && String(client.photoUrl || "").trim());
  }

  function hidePhotoMenu() {
    var menu = els().photoMenu;
    if (menu) menu.hidden = true;
  }

  function togglePhotoMenu() {
    if (mode !== "edit") return;
    var menu = els().photoMenu;
    if (!menu) return;
    menu.hidden = !menu.hidden;
  }

  function clickPhotoInput(kind) {
    var ui = els();
    var input = kind === "camera" ? ui.photoCamera : ui.photoFile;
    if (input) input.click();
  }

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(function (track) {
        try { track.stop(); } catch (_) {}
      });
      cameraStream = null;
    }
    var video = document.getElementById("ffClipCameraVideo");
    if (video) video.srcObject = null;
    var panel = document.getElementById("ffClipCamera");
    if (panel) panel.hidden = true;
    var form = document.getElementById("ffClipEditForm");
    if (form && mode === "edit") form.hidden = false;
  }

  function applyPendingFile(file) {
    if (!file) return;
    if (pendingPreviewUrl) {
      try { URL.revokeObjectURL(pendingPreviewUrl); } catch (_) {}
    }
    pendingFile = file;
    pendingRemove = false;
    pendingPreviewUrl = URL.createObjectURL(file);
    paintHeader(displayClient());
    paintPhotoControls();
    showMsg("", false);
  }

  function snapCamera() {
    var video = document.getElementById("ffClipCameraVideo");
    if (!video || !video.videoWidth) return;
    var canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob(function (blob) {
      stopCamera();
      if (!blob) {
        showMsg("Could not take that photo.", true);
        return;
      }
      applyPendingFile(new File([blob], "photo.jpg", { type: "image/jpeg" }));
    }, "image/jpeg", 0.9);
  }

  async function startLiveCamera() {
    hidePhotoMenu();
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      clickPhotoInput("camera");
      return;
    }
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
    } catch (_) {
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (err) {
        clickPhotoInput("upload");
        return;
      }
    }
    var panel = document.getElementById("ffClipCamera");
    var video = document.getElementById("ffClipCameraVideo");
    if (!panel || !video) {
      stopCamera();
      clickPhotoInput("upload");
      return;
    }
    video.srcObject = cameraStream;
    panel.hidden = false;
    var form = document.getElementById("ffClipEditForm");
    if (form) form.hidden = true;
    try { await video.play(); } catch (_) {}
  }

  function takeOrUploadPhoto(kind) {
    if (kind === "camera") startLiveCamera();
    else {
      hidePhotoMenu();
      clickPhotoInput("upload");
    }
  }

  function onPhotoPicked(ev) {
    var file = ev.target && ev.target.files && ev.target.files[0];
    if (ev.target) ev.target.value = "";
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) {
      showMsg("Choose a photo.", true);
      return;
    }
    applyPendingFile(file);
  }

  function markPhotoRemoved() {
    if (pendingPreviewUrl) {
      try { URL.revokeObjectURL(pendingPreviewUrl); } catch (_) {}
    }
    pendingFile = null;
    pendingPreviewUrl = "";
    pendingRemove = true;
    hidePhotoMenu();
    paintHeader(displayClient());
    paintPhotoControls();
  }

  function paintPhotoControls() {
    var ui = els();
    if (ui.photoBtn) ui.photoBtn.hidden = mode !== "edit";
    if (ui.photoRemove) ui.photoRemove.hidden = mode !== "edit" || !hasPhotoToShow();
    var wrap = document.getElementById("ffClipAvatarWrap");
    if (wrap) wrap.classList.toggle("is-edit", mode === "edit");
  }

  function paintHeader(client) {
    var ui = els();
    ui.avatar.innerHTML = avatarHtml(client);
    ui.name.textContent = (client && client.displayName) || "Client";
    ui.phone.textContent = dash(client && client.phone);
    ui.email.textContent = dash(client && client.email);
    paintPhotoControls();
  }

  function paintTabs() {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.querySelectorAll("[data-ff-clip-tab]").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-ff-clip-tab") === tab);
    });
    var editing = mode === "edit";
    var salesEl = document.getElementById("ffClipTabSales");
    var apptsEl = document.getElementById("ffClipTabAppointments");
    var memsEl = document.getElementById("ffClipTabMemberships");
    var paysEl = document.getElementById("ffClipTabPayments");
    var notesEl = document.getElementById("ffClipTabNotes");
    if (salesEl) salesEl.hidden = editing || tab !== "sales";
    if (apptsEl) apptsEl.hidden = editing || tab !== "appointments";
    if (memsEl) memsEl.hidden = editing || tab !== "memberships";
    if (paysEl) paysEl.hidden = editing || tab !== "payments";
    if (notesEl) notesEl.hidden = editing || tab !== "notes";
  }

  function paint() {
    var ui = els();
    paintHeader(displayClient());
    paintSales();
    paintMemberships();
    paintPayments();
    fillEdit(currentClient);
    paintNotes(currentClient);
    var editing = mode === "edit" || mode === "notes";
    ui.root.classList.toggle("is-editing", mode === "edit");
    paintPhotoControls();
    ui.form.hidden = mode !== "edit";
    ui.foot.hidden = !editing;
    var tabs = ui.root.querySelector(".ff-clip-tabs");
    if (tabs) tabs.hidden = mode === "edit";
    var editBtn = ui.root.querySelector("[data-ff-clip=edit]");
    if (editBtn) editBtn.hidden = editing;
    if (ui.convMenu && mode === "edit") ui.convMenu.hidden = true;
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
    tab = next || defaultTab();
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
    ui.root.classList.remove("is-editing");
    hideConvMenu();
    clearPendingPhoto();
    tab = defaultTab();
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
    clearPendingPhoto();
    tab = defaultTab();
    mode = "view";
    apptLoadedFor = "";
    showMsg("", false);
    paint();
    openPanel();
  }

  function startEdit() {
    if (!currentClient) return;
    clearPendingPhoto();
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
    clearPendingPhoto();
    mode = "view";
    fillEdit(currentClient);
    showMsg("", false);
    paint();
  }

  function hideConvMenu() {
    var menu = els().convMenu;
    if (menu) menu.hidden = true;
  }

  function toggleConvMenu() {
    var menu = els().convMenu;
    if (!menu) return;
    menu.hidden = !menu.hidden;
  }

  function phoneHref(kind) {
    var model = window.ffBookingClientModel;
    var digits = model && currentClient ? model.phoneDigits(currentClient.phone) : "";
    if (!digits) return "";
    return kind === "sms" ? "sms:" + digits : "tel:" + digits;
  }

  function openConversation(kind) {
    hideConvMenu();
    if (kind === "email") {
      var email = currentClient && String(currentClient.email || "").trim();
      if (!email) {
        showMsg("This client has no email.", true);
        return;
      }
      window.location.href = "mailto:" + email;
      return;
    }
    var href = phoneHref(kind);
    if (!href) {
      showMsg("This client has no phone number.", true);
      return;
    }
    window.location.href = href;
  }

  function toggleMore(name) {
    var map = {
      social: "ffClipMoreSocial",
      details: "ffClipMoreDetails",
      address: "ffClipMoreAddress",
      messaging: "ffClipMoreMessaging"
    };
    var el = document.getElementById(map[name] || "");
    var btn = document.querySelector('[data-ff-clip-more="' + name + '"]');
    if (!el) return;
    el.hidden = !el.hidden;
    if (btn) btn.classList.toggle("is-open", !el.hidden);
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
      if (pendingFile && typeof api.uploadClientPhoto === "function") {
        var uploaded = await api.uploadClientPhoto(clientId, pendingFile);
        if (!uploaded || !uploaded.ok) {
          result = uploaded || { ok: false, error: "Could not save the photo." };
        }
      } else if (pendingRemove && typeof api.clearClientPhoto === "function") {
        var cleared = await api.clearClientPhoto(clientId);
        if (!cleared || !cleared.ok) {
          result = cleared || { ok: false, error: "Could not remove the photo." };
        }
      }
      if (!result || result.ok !== false) {
        result = await api.updateClient(clientId, editValues());
      }
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
    clearPendingPhoto();
    mode = "view";
    if (tab !== "notes") tab = tab || defaultTab();
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
        setTab(tabBtn.getAttribute("data-ff-clip-tab") || defaultTab());
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
      var more = ev.target && ev.target.closest ? ev.target.closest("[data-ff-clip-more]") : null;
      if (more) {
        ev.preventDefault();
        toggleMore(more.getAttribute("data-ff-clip-more") || "");
        return;
      }
      var conv = ev.target && ev.target.closest ? ev.target.closest("[data-ff-clip-conv]") : null;
      if (conv) {
        ev.preventDefault();
        openConversation(conv.getAttribute("data-ff-clip-conv") || "");
        return;
      }
      var photoAct = ev.target && ev.target.closest ? ev.target.closest("[data-ff-clip-photo]") : null;
      if (photoAct) {
        ev.preventDefault();
        var photoKind = photoAct.getAttribute("data-ff-clip-photo") || "";
        if (photoKind === "remove") markPhotoRemoved();
        else if (photoKind === "snap") snapCamera();
        else if (photoKind === "camera-cancel") stopCamera();
        else takeOrUploadPhoto(photoKind);
        return;
      }
      if (mode === "edit" && ev.target.closest && ev.target.closest("#ffClipAvatarWrap")) {
        ev.preventDefault();
        togglePhotoMenu();
        return;
      }
      var act = ev.target && ev.target.closest ? ev.target.closest("[data-ff-clip]") : null;
      if (!act) return;
      var name = act.getAttribute("data-ff-clip");
      if (name === "close") close();
      else if (name === "conversations") toggleConvMenu();
      else if (name === "edit") startEdit();
      else if (name === "edit-notes") startNotesEdit();
      else if (name === "cancel") cancelEdit();
      else if (name === "save") save();
      else if (name === "photo") togglePhotoMenu();
    });
    var photoFile = document.getElementById("ffClipPhotoFile");
    var photoCamera = document.getElementById("ffClipPhotoCamera");
    if (photoFile) photoFile.addEventListener("change", onPhotoPicked);
    if (photoCamera) photoCamera.addEventListener("change", onPhotoPicked);
    document.addEventListener("click", function (ev) {
      var menu = els().convMenu;
      if (menu && !menu.hidden && !(ev.target && ev.target.closest && ev.target.closest(".ff-clip-conv-wrap"))) {
        hideConvMenu();
      }
      var photoMenu = els().photoMenu;
      if (photoMenu && !photoMenu.hidden && !(ev.target && ev.target.closest && ev.target.closest("#ffClipAvatarWrap"))) {
        hidePhotoMenu();
      }
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
