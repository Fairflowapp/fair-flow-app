/**
 * Booking Settings screen. Owner/manager chooses staff overlap allowance.
 */
(function () {
  var ROOT_ID = "ffBookingSettingsRoot";
  var bound = false;
  var saving = false;
  var statusText = "";

  function model() { return window.ffBookingSettingsModel || null; }
  function repo() { return window.ffBookingSettings || null; }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isVisible() {
    var shell = window.ffBookingState;
    if (!shell || !shell.isBooking() || shell.getSection() !== "settings") return false;
    return !!document.getElementById(ROOT_ID);
  }

  function canEdit() {
    return !!(repo() && typeof repo().canEdit === "function" && repo().canEdit());
  }

  function currentMinutes() {
    if (repo() && typeof repo().allowedOverlapMinutes === "function") return repo().allowedOverlapMinutes();
    return model() ? model().allowedMinutes() : 0;
  }

  function optionHtml(minutes, selected, disabled) {
    var id = "ffBookingOverlap_" + minutes;
    var title = minutes === 0 ? "No overlap" : (minutes === 30 ? "30 minutes" : minutes + " minutes");
    var hint = minutes === 0
      ? "A staff member can finish one guest before the next one starts."
      : "Two bookings for the same staff member may share up to " + minutes + " minutes.";
    return (
      '<label class="ff-bk-set-choice' + (selected ? " is-selected" : "") + (disabled ? " is-locked" : "") + '" for="' + id + '">' +
        '<input id="' + id + '" type="radio" name="ff-booking-overlap" value="' + minutes + '"' +
          (selected ? " checked" : "") + (disabled ? " disabled" : "") + ">" +
        '<span class="ff-bk-set-choice-copy">' +
          "<strong>" + escapeHtml(title) + "</strong>" +
          "<span>" + escapeHtml(hint) + "</span>" +
        "</span>" +
      "</label>"
    );
  }

  function html() {
    var api = model();
    var choices = api && api.CHOICES ? api.CHOICES : [0, 15, 20, 30];
    var selected = currentMinutes();
    var locked = !canEdit();
    return (
      '<div class="ff-bk-set">' +
        '<header class="ff-bk-set-head">' +
          "<h1>Settings</h1>" +
          "<p>Salon-wide booking rules. These apply to every staff member on the calendar.</p>" +
        "</header>" +
        '<section class="ff-bk-set-card">' +
          "<h2>Staff overlap</h2>" +
          "<p>Choose how much two appointments for the same person may overlap. Use this when a service can start before the previous guest is fully finished.</p>" +
          '<div class="ff-bk-set-choices" role="radiogroup" aria-label="Allowed staff overlap">' +
            choices.map(function (n) { return optionHtml(n, n === selected, locked); }).join("") +
          "</div>" +
          (locked
            ? '<p class="ff-bk-set-note">Only an owner or manager can change this.</p>'
            : (statusText ? '<p class="ff-bk-set-status">' + escapeHtml(statusText) + "</p>" : "")) +
        "</section>" +
      "</div>"
    );
  }

  function paint() {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.innerHTML = html();
  }

  async function onChange(ev) {
    var input = ev.target && ev.target.closest ? ev.target.closest("input[name='ff-booking-overlap']") : null;
    if (!input || saving) return;
    if (!canEdit()) return;
    var minutes = Number(input.value);
    saving = true;
    statusText = "Saving…";
    paint();
    var result = repo() && typeof repo().saveAllowedOverlapMinutes === "function"
      ? await repo().saveAllowedOverlapMinutes(minutes)
      : { ok: false, error: "Booking settings are not ready." };
    saving = false;
    statusText = result && result.ok ? "Saved." : ((result && result.error) || "Could not save.");
    paint();
  }

  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener("change", function (ev) {
      var root = document.getElementById(ROOT_ID);
      if (!root || !root.contains(ev.target)) return;
      onChange(ev);
    });
    document.addEventListener("ff-booking-settings-changed", function () {
      if (isVisible()) paint();
    });
  }

  function refresh() {
    bind();
    if (repo() && typeof repo().hydrateFromWindow === "function") repo().hydrateFromWindow();
    paint();
  }

  window.ffRefreshBookingSettings = refresh;
  window.ffBookingSettingsUi = { refresh: refresh, paint: paint };
})();
