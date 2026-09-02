/**
 * Tickets Analytics — data readers.
 *
 * Best-effort access to ticket/staff/settings data from window globals and
 * localStorage (this screen never touches Firestore). Extracted verbatim from
 * tickets-analytics.js. Also owns the shared low-level primitives (LOG,
 * cleanString) used across the tickets-analytics modules. No DOM.
 */

export const LOG = "[TicketsAnalytics]";

export function cleanString(value) {
  return value == null ? "" : String(value).trim();
}

function getActiveLocationId() {
  try {
    if (typeof window.ffGetActiveLocationId === "function") {
      const id = cleanString(window.ffGetActiveLocationId());
      if (id) return id;
    }
  } catch (err) {
    console.warn(LOG, "active location helper failed", err);
  }
  try {
    const id = cleanString(window.__ff_active_location_id || window.activeLocationId || window.currentLocationId);
    if (id) return id;
  } catch (_) {}
  return "";
}

export function getLocationScope() {
  const id = getActiveLocationId();
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
        name = cleanString(match.name || match.label || match.title || id);
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

export function readStaffNames() {
  const byId = new Map();
  try {
    const store = typeof window.ffGetStaffStore === "function" ? window.ffGetStaffStore() : null;
    const staff = Array.isArray(store?.staff) ? store.staff : [];
    staff.forEach((s) => {
      const id = cleanString(s?.id || s?.staffId || s?.uid);
      const name = cleanString(s?.name || s?.staffName || s?.displayName || s?.email);
      if (id && name) byId.set(id, name);
    });
  } catch (err) {
    console.warn(LOG, "staff helper failed", err);
  }
  try {
    const store = JSON.parse(localStorage.getItem("ff_staff_v1") || "{}");
    const staff = Array.isArray(store?.staff) ? store.staff : [];
    staff.forEach((s) => {
      const id = cleanString(s?.id || s?.staffId || s?.uid);
      const name = cleanString(s?.name || s?.staffName || s?.displayName || s?.email);
      if (id && name && !byId.has(id)) byId.set(id, name);
    });
  } catch (_) {}
  return byId;
}

export async function readCandidateArrays(range) {
  try {
    if (typeof window.ffLoadTicketsForAnalytics === "function") {
      const loaded = await window.ffLoadTicketsForAnalytics({
        fromMs: range?.fromMs,
        toMs: range?.toMs,
      });
      if (Array.isArray(loaded) && loaded.length) {
        console.log(LOG, "data source detected", "window.ffLoadTicketsForAnalytics()", {
          fromMs: range?.fromMs || null,
          toMs: range?.toMs || null,
          count: loaded.length,
        });
        return { name: "window.ffLoadTicketsForAnalytics()", list: loaded };
      }
    }
  } catch (err) {
    console.warn(LOG, "analytics ticket loader failed", err);
  }

  const candidates = [];
  const addCandidate = (name, value) => {
    try {
      if (Array.isArray(value)) candidates.push({ name, list: value });
    } catch (_) {}
  };

  addCandidate("window.currentTickets", window.currentTickets);
  addCandidate("window.allTickets", window.allTickets);
  addCandidate("window.ticketsCache", window.ticketsCache);
  addCandidate("window.ticketSummaries", window.ticketSummaries);
  addCandidate("window.ticketSummariesCache", window.ticketSummariesCache);

  [
    "getCurrentTickets",
    "getAllTickets",
    "getTicketsCache",
    "getTicketSummaries",
    "ffGetCurrentTickets",
    "ffGetTicketSummaries",
  ].forEach((fnName) => {
    try {
      if (typeof window[fnName] === "function") {
        const value = window[fnName]();
        addCandidate(`window.${fnName}()`, value);
      }
    } catch (err) {
      console.warn(LOG, "data helper failed", fnName, err);
    }
  });

  const selected = candidates.find((c) => c.list.length) || candidates[0] || null;
  console.log(LOG, "data source detected", selected ? selected.name : "none");
  return selected || { name: "none", list: [] };
}

export function readSettingsBusinessHours() {
  try {
    if (window.settings && typeof window.settings.businessHours === "object") {
      return { source: "window.settings.businessHours", value: window.settings.businessHours };
    }
  } catch (_) {}
  try {
    const stored = JSON.parse(localStorage.getItem("ffv24_settings") || "{}");
    if (stored && typeof stored.businessHours === "object") {
      return { source: "localStorage.ffv24_settings.businessHours", value: stored.businessHours };
    }
  } catch (_) {}
  return null;
}
