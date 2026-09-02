// inventory-spine.js
// Inventory spine: salon/location resolution, permission gates, shared-catalog refs.
// Extracted verbatim from inventory.js (Phase 10). Injected into Catalog/Insights/Orders/Table
// via init* in inventory.js orchestrator.

import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import {
  doc,
  getDoc,
  collection,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const SALON_ID_CACHE_KEY = "ff_salonId_v1";

/**
 * Resolve the currently active location id (for multi-branch salons).
 * Returns an empty string when no location context exists (e.g. single-branch
 * salons or before the active-location bootstrap has run). Callers should treat
 * an empty value as "no filter" so single-branch accounts keep working.
 *
 * Resolution order:
 *   1. window.ffGetActiveLocationId()           — canonical helper
 *   2. window.__ff_active_location_id           — direct global
 *   3. localStorage.ff_active_location_id       — persisted selection
 * The localStorage fallback is important: on the very first frame after a
 * full refresh the helper module may not have wired yet, but the selection
 * from the previous session is already available in storage.
 */
// Permission gate for editing inventory (add/edit/remove items). Defaults to
// allow when the helper isn't available yet so the owner is never hard-blocked.
function ffCanManageInventory() {
  try {
    if (typeof window !== "undefined" && typeof window.ffCurrentUserHasInventoryManagePermission === "function") {
      return window.ffCurrentUserHasInventoryManagePermission();
    }
  } catch (e) {}
  return true;
}

function _ffInvActiveLocId() {
  try {
    if (typeof window !== "undefined" && typeof window.ffGetActiveLocationId === "function") {
      const v = window.ffGetActiveLocationId();
      const s = typeof v === "string" ? v.trim() : (v != null ? String(v).trim() : "");
      if (s) return s;
    }
  } catch (_) {}
  try {
    const raw = (typeof window !== "undefined" && typeof window.__ff_active_location_id === "string")
      ? window.__ff_active_location_id.trim()
      : "";
    if (raw) return raw;
  } catch (_) {}
  try {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("ff_active_location_id");
      if (typeof stored === "string" && stored.trim()) return stored.trim();
    }
  } catch (_) {}
  return "";
}

/** True when the current user has more than one location available. */
function _ffInvUserHasMultipleLocations() {
  try {
    if (typeof window !== "undefined" && typeof window.ffUserHasMultipleLocations === "function") {
      if (window.ffUserHasMultipleLocations()) return true;
    }
    if (typeof window !== "undefined" && typeof window.ffGetLocations === "function") {
      const locs = (window.ffGetLocations() || []).filter((l) => l && l.isActive !== false);
      if (locs.length > 1) return true;
    }
  } catch (_) {}
  return false;
}

function _ffInvPrimaryLocationId() {
  try {
    const w = typeof window !== "undefined" ? window : {};
    if (typeof w.ffResolveCurrentStaff === "function" && typeof w.ffEnsureStaffLocationFields === "function") {
      const row = w.ffResolveCurrentStaff();
      if (row) {
        const f = w.ffEnsureStaffLocationFields(row);
        const primary = typeof f.primaryLocationId === "string" ? f.primaryLocationId.trim() : "";
        if (primary) return primary;
      }
    }
    if (typeof w.ffGetUserAllowedLocations === "function") {
      const locs = w.ffGetUserAllowedLocations();
      if (Array.isArray(locs) && locs[0] && locs[0].id) return String(locs[0].id).trim();
    }
  } catch (_) {}
  return "";
}

function _ffInvHasActiveLocationForWrite() {
  if (!_ffInvUserHasMultipleLocations()) return true;
  return !!_ffInvActiveLocId();
}

/**
 * Return true when the given Firestore doc payload belongs to the active
 * branch.
 *
 * Stamped `locationId` must match the active header location.
 * Unstamped/legacy docs: single-location accounts, or the primary location
 * only when multi-location — never every branch.
 * No active location on a multi-location account: hide everything.
 */
function _ffInvDocInActiveLoc(data) {
  const multi = _ffInvUserHasMultipleLocations();
  const active = _ffInvActiveLocId();
  const raw = data && typeof data.locationId === "string" ? data.locationId.trim() : "";
  if (!active) return !multi;
  if (raw) return raw === active;
  if (!multi) return true;
  const primary = _ffInvPrimaryLocationId();
  return !!primary && active === primary;
}

const STYLE_ID = "ff-inv2-mock-styles-v152-order-detail-footer-one-row";

const INVENTORY_LEGACY_DRAFT_DOC_ID = "active";

async function getSalonId() {
  // Multi-salon: when the user has chosen a salon (single membership auto-
  // selected, or one explicitly picked from Choose Salon), that selection is
  // the source of truth. Reading users/{uid}.salonId first would leak data
  // from the legacy primary salon into whichever salon the user picked.
  if (typeof window !== "undefined" && window.currentSalonId) {
    return String(window.currentSalonId).trim();
  }
  const user = auth.currentUser;
  let salonId = null;
  if (user) {
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        salonId = data.salonId || null;
      }
    } catch (e) {
      console.warn("[Inventory] getSalonId from user doc failed", e);
    }
  }
  if (!salonId && typeof localStorage !== "undefined") {
    try {
      const cached = localStorage.getItem(SALON_ID_CACHE_KEY);
      if (cached && cached.trim()) salonId = cached.trim();
    } catch (e) {}
  }
  if (salonId && typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(SALON_ID_CACHE_KEY, salonId);
    } catch (e) {}
  }
  return salonId || null;
}

function getInventoryLocationStateId() {
  const active = _ffInvActiveLocId();
  if (active) return active;
  if (!_ffInvUserHasMultipleLocations()) return "default";
  return "";
}



function sharedInvItemsRef(accountId, catId, subId) {
  return collection(db, `accounts/${accountId}/shared/inventoryCatalog/categories/${catId}/subcategories/${subId}/items`);
}

function sharedInvStateDocRef(accountId, locationId, subId) {
  return doc(db, `accounts/${accountId}/locations/${locationId}/inventoryState/${subId}`);
}

export {
  STYLE_ID,
  INVENTORY_LEGACY_DRAFT_DOC_ID,
  ffCanManageInventory,
  _ffInvActiveLocId,
  _ffInvUserHasMultipleLocations,
  _ffInvPrimaryLocationId,
  _ffInvHasActiveLocationForWrite,
  _ffInvDocInActiveLoc,
  getSalonId,
  getInventoryLocationStateId,
  sharedInvItemsRef,
  sharedInvStateDocRef,
};
