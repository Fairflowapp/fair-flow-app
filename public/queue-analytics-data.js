/**
 * Queue Analytics — data readers.
 *
 * Self-contained access to the live data sources (window globals + localStorage)
 * the analytics screen reads from. No DOM, no Firestore, no logic — extracted
 * verbatim from queue-analytics.js. The orchestrator imports these.
 */

export function _qaActiveLocationId() {
  try {
    if (typeof window.ffGetActiveLocationId === "function") {
      const v = window.ffGetActiveLocationId();
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  } catch (_) {}
  try {
    const raw = typeof window.__ff_active_location_id === "string" ? window.__ff_active_location_id.trim() : "";
    return raw || "";
  } catch (_) {
    return "";
  }
}

export function _qaLocationScope() {
  const id = _qaActiveLocationId();
  let name = "";
  try {
    const lists = [
      typeof window.ffGetActiveLocations === "function" ? window.ffGetActiveLocations() : null,
      typeof window.ffGetLocations === "function" ? window.ffGetLocations() : null,
      window.ffLocationsState?.locations,
    ];
    for (const list of lists) {
      const match = (Array.isArray(list) ? list : []).find((loc) => String(loc?.id || loc?.locationId || "").trim() === id);
      if (match) {
        name = String(match.name || match.label || match.title || id).trim();
        break;
      }
    }
  } catch (_) {}
  return {
    id,
    name: name || id || "",
    hasLocation: !!id,
    label: id ? `${name || id}` : "Select location",
  };
}

export function _qaReadSettingsBusinessHours() {
  try {
    const fromWindow = window.settings && typeof window.settings.businessHours === "object"
      ? window.settings.businessHours
      : null;
    if (fromWindow) return { source: "window.settings.businessHours", value: fromWindow };
  } catch (_) {}
  try {
    const stored = JSON.parse(localStorage.getItem("ffv24_settings") || "{}");
    if (stored && typeof stored.businessHours === "object") {
      return { source: "localStorage.ffv24_settings.businessHours", value: stored.businessHours };
    }
  } catch (_) {}
  return null;
}

export function _qaReadRawLog() {
  try {
    if (Array.isArray(window.log) && window.log.length) return window.log;
  } catch (_) {}
  try {
    const raw = localStorage.getItem("ffv24_log");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (_) {}
  return null;
}

export function _qaReadStaffList() {
  try {
    if (typeof window.ffGetStaffStore === "function") {
      const store = window.ffGetStaffStore();
      if (Array.isArray(store?.staff)) return store.staff.filter(Boolean);
    }
  } catch (_) {}
  try {
    const store = JSON.parse(localStorage.getItem("ff_staff_v1") || "{}");
    if (Array.isArray(store?.staff)) return store.staff.filter(Boolean);
  } catch (_) {}
  return [];
}
