/**
 * Server availability / capability resolver for Phase 18F.
 *
 * Reuses the generated runtime copy of public/booking/availability.js.
 * Does not trust caller workingIntervals. Never reads repository public/.
 */
"use strict";

const { filesForGroup } = require("./runtime-manifest");
const { readRuntimeSource } = require("./runtime-paths");
const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const SCHEDULE_TYPES = {
  vacation: true,
  day_off: true,
  time_off: true,
  late_start: true,
  early_leave: true,
  schedule_change: true
};

function trimText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeDefaultSchedule(value) {
  const source = value && typeof value === "object" ? value : {};
  const out = {};
  DAY_KEYS.forEach(function (dayKey) {
    const day = source[dayKey] && typeof source[dayKey] === "object" ? source[dayKey] : {};
    const enabled = day.enabled === true || day.enabled === 1 || String(day.enabled).toLowerCase() === "true";
    out[dayKey] = {
      enabled: enabled,
      startTime: day.startTime || null,
      endTime: day.endTime || null
    };
  });
  return out;
}

function scheduleHasEnabledDay(sched) {
  return DAY_KEYS.some(function (dayKey) {
    return sched && sched[dayKey] && sched[dayKey].enabled === true;
  });
}

function getStaffDefaultScheduleForLocation(staff, locationId) {
  const locKey = trimText(locationId);
  const globalSchedule = normalizeDefaultSchedule(staff && staff.defaultSchedule);
  const mapRaw = staff && staff.locationScheduleAvailability;
  if (locKey && mapRaw && typeof mapRaw === "object") {
    const entry = mapRaw[locKey];
    if (entry && entry.defaultSchedule && typeof entry.defaultSchedule === "object") {
      const perLoc = normalizeDefaultSchedule(entry.defaultSchedule);
      if (scheduleHasEnabledDay(perLoc)) return perLoc;
      return globalSchedule;
    }
    return globalSchedule;
  }
  return globalSchedule;
}

function buildHelpersShim() {
  return {
    normalizeDefaultSchedule: normalizeDefaultSchedule,
    getStaffDefaultScheduleForLocation: getStaffDefaultScheduleForLocation,
    parseScheduleTimeToMinutes: function (value) {
      const raw = String(value || "").trim();
      const m24 = /^(\d{1,2}):(\d{2})$/.exec(raw);
      if (m24) return Number(m24[1]) * 60 + Number(m24[2]);
      return null;
    },
    getDayNameFromDateKey: function (dateKey) {
      const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || "").trim());
      if (!parts) return "";
      const utc = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 12, 0, 0));
      return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][utc.getUTCDay()] || "";
    }
  };
}

let cachedEngine = null;
let cachedWindow = null;

function loadAvailabilityEngine(settings) {
  if (cachedEngine && cachedWindow) {
    cachedWindow.settings = Object.assign({
      preferences: { salonTimeZone: "America/New_York" }
    }, settings || {});
    return cachedEngine;
  }
  const windowObj = {
    settings: Object.assign({
      preferences: { salonTimeZone: "America/New_York" }
    }, settings || {}),
    ffScheduleHelpers: buildHelpersShim()
  };
  filesForGroup("availabilityEngine").forEach(function (rel) {
    new Function("window", readRuntimeSource(rel))(windowObj);
  });
  if (!windowObj.ffBookingAvailability || typeof windowObj.ffBookingAvailability.resolveEffectiveProviderAvailability !== "function") {
    throw new Error("Booking availability engine failed to load.");
  }
  cachedWindow = windowObj;
  cachedEngine = windowObj.ffBookingAvailability;
  return cachedEngine;
}

function isApprovedScheduleRequest(request) {
  const type = trimText(request && request.type).toLowerCase().replace(/[\s-]+/g, "_");
  const normalized = type === "time_off" ? "day_off" : type;
  if (!SCHEDULE_TYPES[normalized] && !SCHEDULE_TYPES[type]) return false;
  const status = trimText(request && request.status).toLowerCase();
  if (status === "approved" || status === "done") return true;
  if (status === "archived") {
    const prev = trimText(request && request.previousStatus).toLowerCase();
    if (prev === "approved" || prev === "done") return true;
    if (!prev) return true;
  }
  return false;
}

function providerBookableAtLocation(staff, locationId) {
  if (!staff) return { ok: false, status: "provider_snapshot_required" };
  if (staff.isArchived === true || staff.archived === true) {
    return { ok: false, status: "provider_not_bookable" };
  }
  if (staff.active === false || staff.isActive === false) {
    return { ok: false, status: "provider_not_bookable" };
  }
  const loc = trimText(locationId);
  const allowed = Array.isArray(staff.allowedLocationIds)
    ? staff.allowedLocationIds.map(function (id) { return trimText(id); }).filter(Boolean)
    : [];
  if (loc && allowed.length && allowed.indexOf(loc) === -1) {
    return { ok: false, status: "provider_not_bookable_at_location" };
  }
  return { ok: true };
}

function providerEligibleForService(bookingModel, service, providerId) {
  if (!service) return { ok: false, status: "service_snapshot_required" };
  if (service.active === false) return { ok: false, status: "service_snapshot_required" };
  if (bookingModel && typeof bookingModel.isProviderCapable === "function") {
    if (!bookingModel.isProviderCapable(service, providerId)) {
      return { ok: false, status: "provider_not_eligible_for_service" };
    }
  } else {
    const overrides = service.staffOverrides && typeof service.staffOverrides === "object"
      ? service.staffOverrides
      : {};
    const override = overrides[trimText(providerId)];
    if (override && override.enabled === false) {
      return { ok: false, status: "provider_not_eligible_for_service" };
    }
  }
  return { ok: true };
}

function deriveProviderAvailability(input) {
  const spec = input || {};
  const engine = loadAvailabilityEngine(spec.settings);
  const result = engine.resolveEffectiveProviderAvailability(
    spec.providerId,
    spec.dateKey,
    spec.locationId,
    {
      settings: spec.settings || {},
      staff: spec.staff,
      requests: Array.isArray(spec.requests) ? spec.requests : []
    }
  );
  return {
    locationId: spec.locationId,
    dateKey: spec.dateKey,
    workingIntervals: (result.intervals || []).map(function (win) {
      return { startMin: win.startMin, endMin: win.endMin };
    }),
    source: result.source,
    businessSource: result.businessSource,
    isBusinessOpen: result.isBusinessOpen === true
  };
}

async function readEpochVersion(db, salonId, locationId) {
  const loc = trimText(locationId);
  if (!loc) return 0;
  const snap = await db.collection("salons").doc(salonId).collection("bookingAvailabilityEpochs").doc(loc).get();
  return snap.exists ? Number(snap.data().version || 0) : 0;
}

async function loadScheduleInputs(db, salonId, locationId) {
  const epoch1 = await readEpochVersion(db, salonId, locationId);
  const settingsSnap = await db.collection("salons").doc(salonId).collection("settings").doc("main").get();
  const inboxSnap = await db.collection("salons").doc(salonId).collection("inboxItems").get();
  const epoch2 = await readEpochVersion(db, salonId, locationId);
  const requests = inboxSnap.docs.map(function (doc) {
    return Object.assign({ id: doc.id }, doc.data());
  }).filter(isApprovedScheduleRequest);
  return {
    epochVersion: epoch2,
    epochStable: epoch1 === epoch2,
    settings: settingsSnap.exists ? settingsSnap.data() : {},
    requests: requests
  };
}

function evaluateOccupancyAuthority(input) {
  const spec = input || {};
  const lines = Array.isArray(spec.lines) ? spec.lines : [];
  const staffById = spec.staffById || {};
  const servicesById = spec.servicesById || {};
  const locationId = trimText(spec.locationId);
  const dateKey = trimText(spec.dateKey);
  const bookingModel = spec.bookingModel;
  const settings = spec.settings || {};
  const requests = spec.requests || [];
  const providerAvailability = {};
  let i;
  for (i = 0; i < lines.length; i += 1) {
    const line = lines[i] || {};
    const providerId = trimText(line.providerId);
    const serviceId = trimText(line.serviceId);
    if (!providerId) return { ok: false, status: "provider_snapshot_required" };
    const staff = staffById[providerId];
    if (!staff) return { ok: false, status: "provider_snapshot_required" };
    const bookable = providerBookableAtLocation(staff, locationId);
    if (!bookable.ok) return bookable;
    if (serviceId) {
      const capable = providerEligibleForService(bookingModel, servicesById[serviceId], providerId);
      if (!capable.ok) return capable;
    }
    if (!providerAvailability[providerId]) {
      providerAvailability[providerId] = deriveProviderAvailability({
        settings: settings,
        staff: staff,
        requests: requests,
        locationId: locationId,
        dateKey: dateKey,
        providerId: providerId
      });
    }
    const startMin = line.startMin != null ? Number(line.startMin) : Number(line.reservationStartMin);
    const endMin = line.endMin != null ? Number(line.endMin) : Number(line.reservationEndMin);
    if (Number.isFinite(startMin) && Number.isFinite(endMin)) {
      const intervals = providerAvailability[providerId].workingIntervals || [];
      const fits = intervals.some(function (win) {
        return startMin >= win.startMin && endMin <= win.endMin;
      });
      if (!fits) {
        return { ok: false, status: "provider_schedule_changed", reasonCodes: ["provider_schedule_changed"] };
      }
    }
  }
  return { ok: true, providerAvailability: providerAvailability };
}

module.exports = {
  loadAvailabilityEngine: loadAvailabilityEngine,
  loadScheduleInputs: loadScheduleInputs,
  deriveProviderAvailability: deriveProviderAvailability,
  evaluateOccupancyAuthority: evaluateOccupancyAuthority,
  providerBookableAtLocation: providerBookableAtLocation,
  providerEligibleForService: providerEligibleForService,
  getStaffDefaultScheduleForLocation: getStaffDefaultScheduleForLocation,
  isApprovedScheduleRequest: isApprovedScheduleRequest
};
