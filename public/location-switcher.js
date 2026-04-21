/**
 * Location Switcher — compact control in the Management header.
 *
 * Behavior:
 *   - 0 allowed locations → hidden.
 *   - 1 allowed location  → small read-only label: "📍 Brickell".
 *   - 2+ allowed          → custom dropdown (popover). Rendered as a real
 *                          `<button>` trigger so we can fully style the menu
 *                          (native `<select>` popups inherit OS styling and
 *                          always looked out of place next to the purple
 *                          header).
 *
 * The popover lives on `document.body` (portal-style) so it floats above
 * everything — no z-index wars with sticky navs, modal overlays, etc.
 *
 * Public surface unchanged:
 *   - Reads window.ffGetUserAllowedLocations() / window.ffGetActiveLocationId()
 *   - Writes via window.ffSetActiveLocationId() (fires ff-active-location-changed)
 */
(function () {
  "use strict";

  var MOUNT_ID = "ffLocationSwitcher";
  var POPOVER_ID = "ffLocationSwitcherPopover";
  var TRIGGER_ID = "ffLocationSwitcherTrigger";

  function getMount() { return document.getElementById(MOUNT_ID); }
  function getPopover() { return document.getElementById(POPOVER_ID); }
  function getTrigger() { return document.getElementById(TRIGGER_ID); }

  function getAuthed() {
    return !!(
      (window.ffAuth && window.ffAuth.currentUser) ||
      (window.auth && window.auth.currentUser) ||
      (window.ffCurrentUser && window.ffCurrentUser.uid)
    );
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function hide(mount) {
    if (!mount) return;
    mount.style.display = "none";
    mount.innerHTML = "";
    closePopover();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Popover (custom dropdown menu) — portaled to document.body so it floats
  // above sticky navs and modals.
  // ───────────────────────────────────────────────────────────────────────────

  function ensurePopoverHost() {
    var pop = getPopover();
    if (pop) return pop;
    pop = document.createElement("div");
    pop.id = POPOVER_ID;
    pop.setAttribute("role", "menu");
    pop.style.cssText = [
      "position:fixed",
      "display:none",
      "z-index:2147483600",
      "min-width:220px",
      "max-width:280px",
      "background:#ffffff",
      "border:1px solid #e5e7eb",
      "border-radius:10px",
      "box-shadow:0 10px 24px rgba(17,24,39,0.12), 0 2px 6px rgba(17,24,39,0.06)",
      "padding:4px 0 6px 0",
      "font-family:inherit",
      "color:#111827",
      "overflow:hidden",
    ].join(";");
    document.body.appendChild(pop);
    return pop;
  }

  function positionPopover() {
    var trigger = getTrigger();
    var pop = getPopover();
    if (!trigger || !pop || pop.style.display === "none") return;
    var rect = trigger.getBoundingClientRect();
    var GAP = 8;
    var popWidth = pop.offsetWidth || 240;
    var left = Math.min(Math.max(8, rect.left), window.innerWidth - popWidth - 8);
    var top = rect.bottom + GAP;
    // If overflow bottom, flip above.
    if (top + pop.offsetHeight + 8 > window.innerHeight) {
      top = Math.max(8, rect.top - pop.offsetHeight - GAP);
    }
    pop.style.left = Math.round(left) + "px";
    pop.style.top = Math.round(top) + "px";
  }

  function openPopover() {
    var pop = ensurePopoverHost();
    renderPopoverBody();
    pop.style.display = "block";
    positionPopover();
    var trigger = getTrigger();
    if (trigger) trigger.setAttribute("aria-expanded", "true");
    // Bind outside-click / escape / resize once per open session.
    setTimeout(function () {
      document.addEventListener("mousedown", onOutsideMouseDown, true);
      document.addEventListener("keydown", onEscKey, true);
      window.addEventListener("resize", positionPopover);
      window.addEventListener("scroll", positionPopover, true);
    }, 0);
  }

  function closePopover() {
    var pop = getPopover();
    if (pop) pop.style.display = "none";
    var trigger = getTrigger();
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", onOutsideMouseDown, true);
    document.removeEventListener("keydown", onEscKey, true);
    window.removeEventListener("resize", positionPopover);
    window.removeEventListener("scroll", positionPopover, true);
  }

  function onOutsideMouseDown(e) {
    var pop = getPopover();
    var trigger = getTrigger();
    if (!pop) return;
    if (pop.contains(e.target) || (trigger && trigger.contains(e.target))) return;
    closePopover();
  }

  function onEscKey(e) {
    if (e.key === "Escape") {
      closePopover();
      var trigger = getTrigger();
      if (trigger) try { trigger.focus(); } catch (_) {}
    }
  }

  function renderPopoverBody() {
    var pop = ensurePopoverHost();
    var locations =
      typeof window.ffGetUserAllowedLocations === "function"
        ? window.ffGetUserAllowedLocations()
        : [];
    var currentActive =
      typeof window.ffGetActiveLocationId === "function"
        ? window.ffGetActiveLocationId()
        : (window.__ff_active_location_id || null);

    // MangoMint-style: sentence-case label at the top, items are plain text
    // rows with a small dot on the right for the active one. No checkmarks, no
    // address subline, no footer actions. Generous whitespace.
    var header =
      '<div style="padding:12px 16px 8px 16px;font-size:12px;font-weight:400;color:#6b7280;">Select a location</div>';

    var items = locations
      .map(function (loc) {
        var id = loc && loc.id ? loc.id : "";
        var name = loc && loc.name ? loc.name : id;
        var isActive = id === currentActive;
        var dot = isActive
          ? '<span aria-hidden="true" style="flex-shrink:0;width:8px;height:8px;border-radius:50%;background:#7c3aed;margin-left:12px;"></span>'
          : '<span aria-hidden="true" style="flex-shrink:0;width:8px;height:8px;margin-left:12px;"></span>';
        return (
          '<button type="button" class="ff-loc-menu-item" data-id="' + escapeHtml(id) + '" ' +
          'style="' +
          "width:100%;display:flex;align-items:center;padding:10px 16px;" +
          "border:none;background:transparent;cursor:pointer;text-align:left;" +
          "font-family:inherit;font-size:14px;color:#111827;font-weight:400;" +
          "transition:background 0.12s ease;" +
          '">' +
          '<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
          escapeHtml(name) +
          "</span>" +
          dot +
          "</button>"
        );
      })
      .join("");

    pop.innerHTML = header + items;

    pop.querySelectorAll(".ff-loc-menu-item").forEach(function (btn) {
      btn.addEventListener("mouseenter", function () { btn.style.background = "#f9fafb"; });
      btn.addEventListener("mouseleave", function () { btn.style.background = "transparent"; });
      btn.addEventListener("click", function () {
        var nextId = btn.getAttribute("data-id");
        if (!nextId) return;
        if (typeof window.ffSetActiveLocationId === "function") {
          window.ffSetActiveLocationId(nextId);
        } else {
          window.__ff_active_location_id = nextId;
          try { localStorage.setItem("ff_active_location_id", nextId); } catch (e) {}
          try {
            document.dispatchEvent(new CustomEvent("ff-active-location-changed", {
              detail: { id: nextId, reason: "manual" },
            }));
          } catch (e) {}
        }
        closePopover();
      });
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Trigger (rendered into the header mount)
  // ───────────────────────────────────────────────────────────────────────────

  function render() {
    var mount = getMount();
    if (!mount) return;

    if (!getAuthed()) {
      hide(mount);
      return;
    }

    var allowedLocations =
      typeof window.ffGetUserAllowedLocations === "function"
        ? window.ffGetUserAllowedLocations()
        : [];

    if (!Array.isArray(allowedLocations) || allowedLocations.length === 0) {
      hide(mount);
      return;
    }

    var currentActive =
      typeof window.ffGetActiveLocationId === "function"
        ? window.ffGetActiveLocationId()
        : (window.__ff_active_location_id || null);

    var PIN_SVG =
      '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:0.9;">' +
      '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>' +
      '<circle cx="12" cy="10" r="3"></circle>' +
      '</svg>';

    var BASE_TEXT_STYLE =
      "display:inline-flex;align-items:center;gap:6px;" +
      "font-size:13px;font-weight:500;color:#ffffff;line-height:1.2;" +
      "white-space:nowrap;letter-spacing:0.02em;";

    // Single location → plain read-only label, no trigger, no popover.
    if (allowedLocations.length === 1) {
      closePopover();
      var onlyLoc = allowedLocations[0];
      var onlyName = onlyLoc && onlyLoc.name ? onlyLoc.name : (onlyLoc && onlyLoc.id) || "";
      mount.style.display = "inline-flex";
      mount.style.alignItems = "center";
      mount.innerHTML =
        '<span style="' + BASE_TEXT_STYLE + '" title="Your current location. Add more in Settings → Locations.">' +
        PIN_SVG +
        '<span>' + escapeHtml(onlyName) + '</span>' +
        "</span>";
      return;
    }

    // Multiple → custom button trigger; popover lives on document.body.
    var activeLoc = allowedLocations.find(function (l) { return l && l.id === currentActive; })
                 || allowedLocations[0];
    var activeName = activeLoc && activeLoc.name ? activeLoc.name : (activeLoc && activeLoc.id) || "";

    var CHEVRON_SVG =
      '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="2.5" ' +
      'stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:0.75;margin-left:1px;">' +
      '<polyline points="6 9 12 15 18 9"></polyline>' +
      '</svg>';

    mount.style.display = "inline-flex";
    mount.style.alignItems = "center";
    mount.innerHTML =
      '<button id="' + TRIGGER_ID + '" type="button" ' +
      'aria-haspopup="menu" aria-expanded="false" ' +
      'title="Switch active location" ' +
      'style="' + BASE_TEXT_STYLE +
      "background:transparent;border:none;padding:2px 0;cursor:pointer;" +
      'font-family:inherit;">' +
      PIN_SVG +
      '<span style="max-width:140px;overflow:hidden;text-overflow:ellipsis;">' +
      escapeHtml(activeName) +
      "</span>" +
      CHEVRON_SVG +
      "</button>";

    var trigger = getTrigger();
    if (trigger) {
      trigger.addEventListener("click", function (e) {
        e.stopPropagation();
        var pop = getPopover();
        if (pop && pop.style.display === "block") {
          closePopover();
        } else {
          openPopover();
        }
      });
      // Subtle hover feedback — slight opacity shift, no pill.
      trigger.addEventListener("mouseenter", function () {
        trigger.style.opacity = "0.85";
      });
      trigger.addEventListener("mouseleave", function () {
        trigger.style.opacity = "1";
      });
    }

    // If popover is already open when data changes, refresh its contents.
    var pop = getPopover();
    if (pop && pop.style.display === "block") {
      renderPopoverBody();
      positionPopover();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Event wiring
  // ───────────────────────────────────────────────────────────────────────────

  document.addEventListener("ff-staff-cloud-updated", render);
  document.addEventListener("ff-locations-updated", render);
  document.addEventListener("ff-active-location-changed", function () {
    render();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(render, 0);
    });
  } else {
    setTimeout(render, 0);
  }
})();
