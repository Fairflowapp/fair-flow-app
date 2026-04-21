/**
 * Location Helpers — single source of truth for all client-side location logic.
 *
 * This file replaces the previous split between `active-location.js` (state +
 * reactive selection) and the ad-hoc helper that used to live inline in
 * index.html. It is loaded BEFORE any consumer (location-switcher.js,
 * renderLocationsTab, renderStaffList, etc.) so all helper calls resolve to
 * the canonical implementation below — no duplicated logic anywhere else.
 *
 * Public API (attached to window):
 *   ffEnsureStaffLocationFields(staff) → {primaryLocationId, allowedLocationIds, ...staff}
 *   ffResolveCurrentStaff()            → staff doc for signed-in user (or null)
 *   ffGetActiveLocationId()            → string | null
 *   ffSetActiveLocationId(id)          → string | null (validated; persisted)
 *   ffUserHasMultipleLocations()       → boolean
 *   ffGetUserAllowedLocations()        → array of full location docs the user may access
 *
 * Reactive state:
 *   window.__ff_active_location_id
 *   localStorage.ff_active_location_id
 *
 * Events listened: ff-staff-cloud-updated, ff-locations-updated
 * Events fired:    ff-active-location-changed ({ id, previousId, reason })
 */
(function () {
  "use strict";

  var STORAGE_KEY = "ff_active_location_id";
  var DEBUG = false;

  function dlog() {
    if (!DEBUG) return;
    try {
      console.log.apply(console, ["[LocationHelpers]"].concat([].slice.call(arguments)));
    } catch (e) {}
  }

  /**
   * Dev-mode detector for the "[Location] ..." logs.
   *
   * Returns true in any of these cases (any signal wins):
   *   - hostname is localhost / 127.0.0.1 / *.local
   *   - window.__FF_DEBUG_LOCATIONS === true (runtime opt-in)
   *   - localStorage.ff_debug_locations === "true" (persistent opt-in)
   *
   * On production hosts you can flip it on live with:
   *   localStorage.setItem('ff_debug_locations', 'true')
   */
  function isLocationDevMode() {
    try {
      if (window.__FF_DEBUG_LOCATIONS === true) return true;
    } catch (e) {}
    try {
      if (localStorage.getItem("ff_debug_locations") === "true") return true;
    } catch (e) {}
    try {
      var host = (window.location && window.location.hostname) || "";
      if (host === "localhost" || host === "127.0.0.1") return true;
      if (/\.local$/i.test(host)) return true;
    } catch (e) {}
    return false;
  }
  window.ffLocationDevMode = isLocationDevMode;

  function locLog() {
    if (!isLocationDevMode()) return;
    try {
      console.log.apply(console, [].slice.call(arguments));
    } catch (e) {}
  }

  // Remember last reported available-locations signature so repeated recomputes
  // don't spam the console with identical lines.
  var _lastAvailableSig = "__unset__";

  // ───────────────────────────────────────────────────────────────────────────
  // Low-level auth / storage helpers
  // ───────────────────────────────────────────────────────────────────────────

  function readStored() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      return typeof v === "string" && v.trim() ? v.trim() : null;
    } catch (e) {
      return null;
    }
  }

  function writeStored(id) {
    try {
      if (id && typeof id === "string") localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

  function isAuthed() {
    return !!(
      (window.ffAuth && window.ffAuth.currentUser) ||
      (window.auth && window.auth.currentUser) ||
      (window.ffCurrentUser && window.ffCurrentUser.uid)
    );
  }

  function getAuthEmail() {
    try {
      return String(
        (window.ffCurrentUser && window.ffCurrentUser.email) ||
          (window.ffAuth && window.ffAuth.currentUser && window.ffAuth.currentUser.email) ||
          (window.auth && window.auth.currentUser && window.auth.currentUser.email) ||
          "",
      )
        .trim()
        .toLowerCase();
    } catch (e) {
      return "";
    }
  }

  function getAuthUid() {
    try {
      return String(
        (window.ffCurrentUser && window.ffCurrentUser.uid) ||
          (window.ffAuth && window.ffAuth.currentUser && window.ffAuth.currentUser.uid) ||
          (window.auth && window.auth.currentUser && window.auth.currentUser.uid) ||
          "",
      ).trim();
    } catch (e) {
      return "";
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ffResolveCurrentStaff — canonical "current staff" resolver used by all
  // other helpers. Tries id → email → uid, in that order.
  // ───────────────────────────────────────────────────────────────────────────

  function ffResolveCurrentStaff() {
    if (typeof window.ffGetStaffStore !== "function") return null;
    var store;
    try {
      store = window.ffGetStaffStore();
    } catch (e) {
      return null;
    }
    var list = store && Array.isArray(store.staff) ? store.staff : [];
    if (!list.length) return null;

    var directId = String(
      window.__ff_authedStaffId ||
        (typeof localStorage !== "undefined" ? localStorage.getItem("ff_authedStaffId_v1") : null) ||
        "",
    ).trim();
    if (directId) {
      var byId = list.find(function (s) {
        return String((s && (s.id || s.staffId)) || "").trim() === directId;
      });
      if (byId) return byId;
    }

    var email = getAuthEmail();
    if (email) {
      var byEmail = list.find(function (s) {
        return String((s && s.email) || "").trim().toLowerCase() === email;
      });
      if (byEmail) return byEmail;
    }

    var uid = getAuthUid();
    if (uid) {
      var byUid = list.find(function (s) {
        return String((s && (s.uid || s.userUid)) || "").trim() === uid;
      });
      if (byUid) return byUid;
    }

    return null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ffEnsureStaffLocationFields — normalizes the two location fields on a
  // staff object WITHOUT deleting any existing fields. Returns a NEW object.
  //
  // Rules:
  //   - If allowedLocationIds is missing/invalid → create from [primaryLocationId] (or []).
  //   - Dedupe while preserving order.
  //   - If primaryLocationId is missing or not in allowed → use allowed[0] (or null).
  // ───────────────────────────────────────────────────────────────────────────

  function ffEnsureStaffLocationFields(staff) {
    if (!staff || typeof staff !== "object") return staff;

    var rawAllowed = Array.isArray(staff.allowedLocationIds)
      ? staff.allowedLocationIds.filter(function (x) {
          return typeof x === "string" && x.trim();
        })
      : null;

    var rawPrimary =
      typeof staff.primaryLocationId === "string" && staff.primaryLocationId.trim()
        ? String(staff.primaryLocationId).trim()
        : null;

    var allowed;
    if (rawAllowed && rawAllowed.length) {
      var seen = {};
      allowed = [];
      rawAllowed.forEach(function (id) {
        if (!seen[id]) {
          seen[id] = true;
          allowed.push(id);
        }
      });
    } else if (rawPrimary) {
      allowed = [rawPrimary];
    } else {
      allowed = [];
    }

    var primary;
    if (rawPrimary && allowed.indexOf(rawPrimary) !== -1) {
      primary = rawPrimary;
    } else if (allowed.length > 0) {
      primary = allowed[0];
    } else {
      primary = null;
    }

    return Object.assign({}, staff, {
      primaryLocationId: primary,
      allowedLocationIds: allowed,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ffGetUserAllowedLocations / ffUserHasMultipleLocations
  // ───────────────────────────────────────────────────────────────────────────

  // Owner bypass: owners always have access to every active location, even if
  // their staff doc's allowedLocationIds hasn't been updated after a new
  // location was created. This mirrors the permission bypass used elsewhere.
  function isOwnerBypass() {
    try {
      if (typeof window.ffCurrentUserSalonOwnerPermissionBypass === "function") {
        return !!window.ffCurrentUserSalonOwnerPermissionBypass();
      }
    } catch (e) {}
    try {
      var role = String(window.__ff_user_role || "").toLowerCase();
      if (role === "owner") return true;
    } catch (e) {}
    return false;
  }

  function getAllActiveLocations() {
    try {
      var all = typeof window.ffGetLocations === "function" ? window.ffGetLocations() : [];
      return (all || []).filter(function (loc) {
        return loc && loc.isActive !== false;
      });
    } catch (e) {
      return [];
    }
  }

  function ffGetUserAllowedLocations() {
    // Owner sees every active location regardless of staff doc. This prevents
    // the common confusion where the owner adds a new location in Settings
    // but the Location Switcher doesn't list it because her own staff doc's
    // allowedLocationIds wasn't touched.
    if (isOwnerBypass()) {
      var activeForOwner = getAllActiveLocations();
      if (activeForOwner.length > 0) return activeForOwner;
      // fall through to normal path if owner has no locations created yet
    }

    var staff = ffResolveCurrentStaff();
    if (!staff) return [];
    var normalized = ffEnsureStaffLocationFields(staff);
    var allowedIds = Array.isArray(normalized.allowedLocationIds) ? normalized.allowedLocationIds : [];
    if (!allowedIds.length) return [];

    var nameMap = {};
    try {
      var all = typeof window.ffGetLocations === "function" ? window.ffGetLocations() : [];
      (all || []).forEach(function (loc) {
        if (loc && loc.id) nameMap[loc.id] = loc;
      });
    } catch (e) {}

    return allowedIds.map(function (id) {
      return nameMap[id] || { id: id, name: id };
    });
  }

  function ffUserHasMultipleLocations() {
    if (isOwnerBypass()) {
      return getAllActiveLocations().length > 1;
    }
    var staff = ffResolveCurrentStaff();
    if (!staff) return false;
    var normalized = ffEnsureStaffLocationFields(staff);
    return Array.isArray(normalized.allowedLocationIds) && normalized.allowedLocationIds.length > 1;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ffGetActiveLocationId / ffSetActiveLocationId + reactive selection
  // ───────────────────────────────────────────────────────────────────────────

  function ffGetActiveLocationId() {
    return typeof window.__ff_active_location_id === "string" && window.__ff_active_location_id
      ? window.__ff_active_location_id
      : null;
  }

  function setActive(id, opts) {
    var options = opts || {};
    var nextId = typeof id === "string" && id.trim() ? id.trim() : null;
    var prevId = ffGetActiveLocationId();

    if (nextId === prevId) {
      dlog("setActive (unchanged):", nextId);
      return nextId;
    }

    window.__ff_active_location_id = nextId;
    writeStored(nextId);

    dlog("active changed:", prevId, "→", nextId, "reason:", options.reason || "auto");
    locLog("[Location] Active location set:", nextId);

    try {
      document.dispatchEvent(
        new CustomEvent("ff-active-location-changed", {
          detail: { id: nextId, previousId: prevId, reason: options.reason || "auto" },
        }),
      );
    } catch (e) {}

    return nextId;
  }

  function pickActiveId(allowed, primary) {
    if (!Array.isArray(allowed) || allowed.length === 0) return null;
    var stored = readStored();
    if (stored && allowed.indexOf(stored) !== -1) return stored;
    if (allowed.length === 1) return allowed[0];
    if (primary && allowed.indexOf(primary) !== -1) return primary;
    return allowed[0];
  }

  function ffSetActiveLocationId(id) {
    var normalizedId = typeof id === "string" ? id.trim() : null;
    locLog("[Location] Switching to:", normalizedId);
    // Owner bypass: allow switching to any active location even if the owner's
    // own staff doc doesn't list it.
    if (isOwnerBypass()) {
      var activeIds = getAllActiveLocations().map(function (loc) { return loc && loc.id; });
      if (normalizedId && activeIds.indexOf(normalizedId) === -1) {
        console.warn("[LocationHelpers] Rejected set — id not an active location:", id);
        return ffGetActiveLocationId();
      }
      return setActive(normalizedId, { reason: "manual" });
    }
    var staff = ffResolveCurrentStaff();
    if (staff) {
      var fields = ffEnsureStaffLocationFields(staff);
      if (normalizedId && fields.allowedLocationIds.indexOf(normalizedId) === -1) {
        console.warn("[LocationHelpers] Rejected set — id not in allowedLocationIds:", id);
        return ffGetActiveLocationId();
      }
    }
    return setActive(normalizedId, { reason: "manual" });
  }

  function recompute(reason) {
    if (!isAuthed()) {
      // Signed-out — clear runtime, keep localStorage for next sign-in.
      if (window.__ff_active_location_id) {
        window.__ff_active_location_id = null;
        try {
          document.dispatchEvent(
            new CustomEvent("ff-active-location-changed", {
              detail: { id: null, reason: "signed-out" },
            }),
          );
        } catch (e) {}
      }
      return;
    }

    // Owner bypass: allowed list = every active location, primary = first.
    // Non-owner: allowed list comes from staff doc.
    var allowedIdsForActive;
    var primaryIdForActive;
    if (isOwnerBypass()) {
      var active = getAllActiveLocations();
      allowedIdsForActive = active.map(function (loc) { return loc && loc.id; }).filter(Boolean);
      primaryIdForActive = allowedIdsForActive.length ? allowedIdsForActive[0] : null;
      if (!allowedIdsForActive.length) {
        var staffForOwnerFallback = ffResolveCurrentStaff();
        if (staffForOwnerFallback) {
          var ownerFields = ffEnsureStaffLocationFields(staffForOwnerFallback);
          allowedIdsForActive = ownerFields.allowedLocationIds || [];
          primaryIdForActive = ownerFields.primaryLocationId || null;
        }
      }
    } else {
      var staff = ffResolveCurrentStaff();
      if (!staff) {
        dlog("recompute skipped — staff not resolved yet (reason:", reason, ")");
        return;
      }
      var fields = ffEnsureStaffLocationFields(staff);
      allowedIdsForActive = fields.allowedLocationIds || [];
      primaryIdForActive = fields.primaryLocationId || null;
    }

    // Log available locations (name + id) only when the list actually changes.
    if (isLocationDevMode()) {
      try {
        var available = ffGetUserAllowedLocations();
        var summary = available.map(function (loc) {
          return { id: loc && loc.id, name: (loc && loc.name) || null };
        });
        var sig = JSON.stringify(summary);
        if (sig !== _lastAvailableSig) {
          _lastAvailableSig = sig;
          console.log("[Location] Available locations:", summary);
        }
      } catch (e) {}
    }

    var nextId = pickActiveId(allowedIdsForActive, primaryIdForActive);
    setActive(nextId, { reason: reason || "recompute" });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Expose + wire reactive triggers
  // ───────────────────────────────────────────────────────────────────────────

  window.ffEnsureStaffLocationFields = ffEnsureStaffLocationFields;
  window.ffResolveCurrentStaff = ffResolveCurrentStaff;
  window.ffGetActiveLocationId = ffGetActiveLocationId;
  window.ffSetActiveLocationId = ffSetActiveLocationId;
  window.ffUserHasMultipleLocations = ffUserHasMultipleLocations;
  window.ffGetUserAllowedLocations = ffGetUserAllowedLocations;

  document.addEventListener("ff-staff-cloud-updated", function () {
    recompute("staff-updated");
  });
  document.addEventListener("ff-locations-updated", function () {
    recompute("locations-updated");
  });

  // One-shot initial pass once the current call stack finishes. Safe even if
  // staff / locations haven't loaded yet — recompute is a no-op in that case.
  setTimeout(function () {
    recompute("initial");
  }, 0);
})();
