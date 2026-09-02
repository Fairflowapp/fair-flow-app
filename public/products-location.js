// products-location.js
// Location gate for the Products catalog. No Firestore / no app.js import so
// Tickets and Inventory can filter without creating a circular module graph.

let _productShareEnabled = false;

export function setProductCatalogShareEnabledCache(enabled) {
  _productShareEnabled = enabled === true;
}

export function isProductCatalogShareEnabled() {
  return _productShareEnabled === true;
}

export function ffProductsActiveLocId() {
  try {
    if (typeof window !== "undefined" && typeof window.ffGetActiveLocationId === "function") {
      const v = window.ffGetActiveLocationId();
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    if (typeof window !== "undefined"
        && typeof window.__ff_active_location_id === "string"
        && window.__ff_active_location_id.trim()) {
      return window.__ff_active_location_id.trim();
    }
  } catch (_) {}
  return null;
}

export function productsUserHasMultipleLocations() {
  try {
    if (typeof window.ffUserHasMultipleLocations === "function" && window.ffUserHasMultipleLocations()) return true;
    if (typeof window.ffGetLocations === "function") {
      const locs = (window.ffGetLocations() || []).filter((l) => l && l.isActive !== false);
      if (locs.length > 1) return true;
    }
  } catch (_) {}
  return false;
}

export function productsHasActiveLocationForWrite() {
  if (!productsUserHasMultipleLocations()) return true;
  return !!ffProductsActiveLocId();
}

function productRecordLocationId(record) {
  if (!record || typeof record !== "object") return "";
  return String(record.locationId || record.locId || "").trim();
}

/**
 * Products: share on → full catalog. Stamped product → owning location only.
 * Unstamped / legacy products stay visible everywhere (old salon-wide catalog).
 * Categories are always shared — they are the folder list for the whole salon.
 */
export function productDocInActiveLoc(record) {
  if (isProductCatalogShareEnabled()) return true;
  const multi = productsUserHasMultipleLocations();
  const active = String(ffProductsActiveLocId() || "").trim();
  if (!active) return !multi;
  const stamped = productRecordLocationId(record);
  if (stamped) return stamped === active;
  return true;
}

export function filterProductCatalogDocs(list) {
  return (Array.isArray(list) ? list : []).filter(productDocInActiveLoc);
}

export function filterProductCategoryDocs(list) {
  return Array.isArray(list) ? list.slice() : [];
}

if (typeof window !== "undefined") {
  window.ffProductDocInActiveLoc = productDocInActiveLoc;
  window.ffIsProductCatalogShareEnabled = isProductCatalogShareEnabled;
  window.ffFilterProductCatalogDocs = filterProductCatalogDocs;
}
