/**
 * Calendar Block Time slot chooser and open helpers.
 * Day and Week reuse the same create/edit editor.
 */
(function () {
  var CHOOSER_ID = "ffBookingCalSlotChooser";
  var pendingHit = null;
  var bound = false;
  var openedAt = 0;

  function editor() { return window.ffBookingBlockEditor || null; }
  function cache() { return window.ffBookingCalBlocks || null; }

  function closeChooser() {
    pendingHit = null;
    var el = document.getElementById(CHOOSER_ID);
    if (el) {
      el.setAttribute("hidden", "");
      el.innerHTML = "";
    }
  }

  function ensureChooser() {
    var el = document.getElementById(CHOOSER_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = CHOOSER_ID;
    el.className = "ff-cal-menu ff-cal-slot-chooser";
    el.setAttribute("hidden", "");
    el.setAttribute("role", "menu");
    document.body.appendChild(el);
    return el;
  }

  function place(el, clientX, clientY) {
    if (!el) return;
    var pad = 8;
    var left = Number(clientX) || 0;
    var top = Number(clientY) || 0;
    el.style.position = "fixed";
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.left = Math.round(left) + "px";
    el.style.top = Math.round(top) + "px";
    var menuW = el.offsetWidth || 200;
    var menuH = el.offsetHeight || 0;
    if (left + menuW > window.innerWidth - pad) left = window.innerWidth - menuW - pad;
    if (top + menuH > window.innerHeight - pad) top = window.innerHeight - menuH - pad;
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    el.style.left = Math.round(left) + "px";
    el.style.top = Math.round(top) + "px";
  }

  function hitToCreateSpec(hit) {
    if (!hit || !hit.slot) return null;
    return {
      providerId: hit.slot.providerId,
      locationId: hit.locationId,
      dateKey: hit.slot.dateKey,
      startMin: hit.slot.startMin,
      durationMinutes: 30,
      reason: "lunch"
    };
  }

  function openCreateFromHit(hit) {
    closeChooser();
    var api = editor();
    var spec = hitToCreateSpec(hit);
    if (!api || !spec) return null;
    return api.openCreate(spec);
  }

  function openCreateFromMenu(ctx) {
    closeChooser();
    var st = window.ffBookingCalState;
    var last = window.ffBookingCalLastSlot;
    var providerId = String((ctx && ctx.providerId) || "").trim();
    var locationId = String((ctx && ctx.locationId) || (st && st.getLocationId && st.getLocationId()) || "").trim();
    var dateKey = String((ctx && ctx.dateKey) || (st && st.getSelectedDateKey && st.getSelectedDateKey()) || "").trim();
    var startMin = 12 * 60;
    if (last && last.providerId === providerId && last.dateKey === dateKey && Number.isFinite(Number(last.startMin))) {
      startMin = Number(last.startMin);
    }
    var api = editor();
    if (!api || !providerId || !locationId || !dateKey) return null;
    return api.openCreate({
      providerId: providerId,
      locationId: locationId,
      dateKey: dateKey,
      startMin: startMin,
      durationMinutes: 30,
      reason: "lunch"
    });
  }

  function openEdit(blockOrId) {
    closeChooser();
    var row = blockOrId;
    if (typeof blockOrId === "string") {
      row = cache() && typeof cache().getById === "function" ? cache().getById(blockOrId) : null;
    }
    var api = editor();
    if (!api || !row) return null;
    return api.openEdit(row);
  }

  function openChooser(hit, ev) {
    if (!hit || !hit.slot) return null;
    var el = ensureChooser();
    pendingHit = hit;
    el.innerHTML =
      '<button type="button" class="ff-cal-menu-item" role="menuitem" data-ff-cal-slot="appointment">New Appointment</button>' +
      '<button type="button" class="ff-cal-menu-item" role="menuitem" data-ff-cal-slot="block">Block Time</button>';
    el.removeAttribute("hidden");
    openedAt = Date.now();
    place(el, ev && ev.clientX, ev && ev.clientY);
    requestAnimationFrame(function () {
      place(el, ev && ev.clientX, ev && ev.clientY);
    });
    return hit;
  }

  function chooseAppointment() {
    var hit = pendingHit;
    closeChooser();
    var cal = window.ffBookingCalendarCreate;
    if (hit && cal && typeof cal.openAppointmentFromHit === "function") {
      cal.openAppointmentFromHit(hit);
    }
  }

  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== "function") return;
      var item = t.closest("[data-ff-cal-slot]");
      if (item && pendingHit) {
        ev.preventDefault();
        var kind = item.getAttribute("data-ff-cal-slot");
        if (kind === "appointment") chooseAppointment();
        else if (kind === "block") openCreateFromHit(pendingHit);
        return;
      }
      if (Date.now() - openedAt < 80) return;
      if (!t.closest("#" + CHOOSER_ID)) closeChooser();
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") closeChooser();
    });
  }

  window.ffBookingCalBlockUi = {
    openChooser: openChooser,
    closeChooser: closeChooser,
    openCreateFromHit: openCreateFromHit,
    openCreateFromMenu: openCreateFromMenu,
    openEdit: openEdit,
    hitToCreateSpec: hitToCreateSpec
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
