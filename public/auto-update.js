/**
 * Auto-update watcher — no user ever has to be asked to refresh again.
 *
 * Every hosting deploy stamps a new value into /version.json (see
 * scripts/stamp-version.js, wired as a hosting predeploy hook). This script
 * polls that file in the background; when the value changes, the page reloads
 * itself at a SAFE moment only:
 *   - the moment the app goes to the background (tab hidden / phone locked),
 *   - the moment it comes back to the foreground (user just opened it,
 *     nothing is in progress),
 *   - or, for always-on screens like the kiosk, after 3 minutes with no touch.
 * It NEVER reloads within 2 minutes of a queue save (window.__ff_lastSaveTime)
 * or during the first minute after page load, and a sessionStorage marker
 * guarantees at most one reload per published version (no reload loops).
 */
(function () {
  "use strict";
  var POLL_MS = 5 * 60 * 1000;
  var IDLE_MS = 3 * 60 * 1000;
  var SAVE_GRACE_MS = 2 * 60 * 1000;
  var bootVersion = null;
  var newVersion = null;
  var lastActivity = Date.now();
  var loadedAt = Date.now();

  function fetchVersion() {
    return fetch("/version.json?nocache=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function recentQueueSave() {
    try {
      var t = Number(window.__ff_lastSaveTime || 0);
      return t > 0 && (Date.now() - t) < SAVE_GRACE_MS;
    } catch (_) { return false; }
  }

  function alreadyReloadedFor(v) {
    try { return sessionStorage.getItem("ff_autoupdate_done") === v; } catch (_) { return false; }
  }
  function markReloaded(v) {
    try { sessionStorage.setItem("ff_autoupdate_done", v); } catch (_) {}
  }

  // A reload while the user is looking at a photo / filling a modal loses their
  // place and reads as "the app crashed". Wait until nothing is open.
  function modalOpen() {
    try {
      if (document.getElementById("mediaLightboxOverlay")) return true;
      var ids = ["workDetailsModal", "uploadWorkModal", "markPostedModal"];
      for (var i = 0; i < ids.length; i++) {
        var el = document.getElementById(ids[i]);
        if (el && el.style && el.style.display && el.style.display !== "none") return true;
      }
    } catch (_) {}
    return false;
  }

  function safeNow() {
    if (Date.now() - loadedAt < 60000) return false;
    if (recentQueueSave()) return false;
    if (modalOpen()) return false;
    return true;
  }

  function tryReload(trigger) {
    if (!newVersion || alreadyReloadedFor(newVersion)) return;
    if (!safeNow()) return;
    var idle = Date.now() - lastActivity >= IDLE_MS;
    var ok = trigger === "hidden" || trigger === "wake" || document.hidden || idle;
    if (!ok) return;
    markReloaded(newVersion);
    try { console.log("[AutoUpdate] new version " + newVersion + " — reloading (" + trigger + ")"); } catch (_) {}
    location.reload();
  }

  function check(trigger) {
    fetchVersion().then(function (j) {
      var v = j && j.v ? String(j.v) : null;
      if (!v) return;
      if (bootVersion === null) { bootVersion = v; return; }
      if (v !== bootVersion) { newVersion = v; tryReload(trigger || "poll"); }
    });
  }

  ["click", "touchstart", "keydown", "pointerdown", "scroll"].forEach(function (ev) {
    window.addEventListener(ev, function () { lastActivity = Date.now(); }, { passive: true, capture: true });
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      tryReload("hidden");
    } else {
      // Small random delay so 50 devices waking together don't hit at once.
      setTimeout(function () { check("wake"); }, 1000 + Math.floor(Math.random() * 2000));
    }
  });

  setTimeout(function () { check("init"); }, 15000);
  setInterval(function () { check("poll"); }, POLL_MS);
  // Always-on screens (kiosk): once an update is known, retry at idle moments.
  setInterval(function () { tryReload("idle"); }, 30000);
})();
