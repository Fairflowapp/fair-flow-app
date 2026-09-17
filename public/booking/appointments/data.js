/**
 * Booking Appointment repository.
 * All Appointment Firestore reads/writes go through here.
 * Path: salons/{salonId}/appointments/{appointmentId}
 */
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";

const CONFLICT_LOOKBACK_MS = 36 * 60 * 60 * 1000;
const RANGE_LOOKBACK_MS = 24 * 60 * 60 * 1000;

function model() {
  return window.ffBookingAppointmentModel || null;
}

function requireModel() {
  const api = model();
  if (!api) throw new Error("Appointment model is not loaded.");
  return api;
}

function currentSalonId() {
  return String(window.currentSalonId || "").trim();
}

function requireSalon() {
  const salonId = currentSalonId();
  if (!salonId) throw new Error("No salon is selected.");
  return salonId;
}

function currentActor() {
  let uid = "";
  try {
    const auth = window.ffAuth || window.auth || null;
    uid = auth && auth.currentUser && auth.currentUser.uid
      ? String(auth.currentUser.uid).trim()
      : "";
  } catch (_) {}
  const staffId = String(
    window.__ff_authedStaffId
    || (window.currentUserProfile && window.currentUserProfile.staffId)
    || ""
  ).trim();
  return { uid, staffId };
}

function appointmentsRef(salonId) {
  return collection(db, `salons/${salonId}/appointments`);
}

function toAppointment(docSnap) {
  return requireModel().fromDoc(docSnap.id, docSnap.data());
}

function emitAppointmentCreated(appointment) {
  try {
    document.dispatchEvent(new CustomEvent("ff-booking-appointment-created", {
      detail: { appointment: appointment || null },
    }));
  } catch (_) {}
}

function emitAppointmentUpdated(appointment) {
  try {
    document.dispatchEvent(new CustomEvent("ff-booking-appointment-updated", {
      detail: { appointment: appointment || null },
    }));
  } catch (_) {}
}

function emitAppointmentCancelled(appointment) {
  try {
    document.dispatchEvent(new CustomEvent("ff-booking-appointment-cancelled", {
      detail: { appointment: appointment || null },
    }));
  } catch (_) {}
}

function asTimestamp(value) {
  const date = requireModel().toDate(value);
  return date ? Timestamp.fromDate(date) : null;
}

function findStaff(providerId) {
  const id = String(providerId || "").trim();
  if (!id) return null;
  let list = [];
  try {
    if (typeof window.ffGetStaffStore === "function") {
      const store = window.ffGetStaffStore();
      if (store && Array.isArray(store.staff)) list = store.staff;
    }
  } catch (_) {}
  return list.find((staff) => {
    if (!staff) return false;
    return String(staff.id || "") === id
      || String(staff.staffId || "") === id
      || String(staff.uid || "") === id;
  }) || null;
}

async function loadStaff(salonId, providerId) {
  const fromStore = findStaff(providerId);
  if (fromStore) return fromStore;
  const id = String(providerId || "").trim();
  if (!salonId || !id) return null;
  const snap = await getDoc(doc(db, `salons/${salonId}/staff/${id}`));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function loadService(salonId, serviceId) {
  const id = String(serviceId || "").trim();
  if (!salonId || !id) return null;
  const local = await getDoc(doc(db, `salons/${salonId}/services/${id}`));
  if (local.exists()) return { id: local.id, ...local.data() };
  const shared = await getDoc(doc(db, `accounts/${salonId}/shared/serviceCatalog/items/${id}`));
  if (shared.exists()) return { id: shared.id, ...shared.data() };
  return null;
}

async function loadClient(salonId, clientId) {
  const id = String(clientId || "").trim();
  if (!salonId || !id) return null;
  try {
    if (window.ffBookingClients && typeof window.ffBookingClients.getClientById === "function") {
      const client = await window.ffBookingClients.getClientById(id, salonId);
      if (client) return client;
    }
  } catch (_) {}
  const snap = await getDoc(doc(db, `salons/${salonId}/clients/${id}`));
  if (!snap.exists()) return null;
  if (window.ffBookingClientModel && typeof window.ffBookingClientModel.fromDoc === "function") {
    return window.ffBookingClientModel.fromDoc(snap.id, snap.data());
  }
  return { clientId: snap.id, ...snap.data() };
}

async function clientHasOtherActiveAppointment(salonId, clientId, excludeId) {
  const id = String(clientId || "").trim();
  if (!salonId || !id) return false;
  const skip = String(excludeId || "").trim();
  const snap = await getDocs(query(
    appointmentsRef(salonId),
    where("clientId", "==", id),
    orderBy("startAt", "asc"),
    limit(8)
  ));
  return snap.docs.some((row) => {
    if (skip && row.id === skip) return false;
    const appt = toAppointment(row);
    return !!(appt && appt.status && appt.status !== "cancelled");
  });
}

function availabilityCode(api, providerId, startAt, durationMinutes, locationId) {
  const engine = window.ffBookingAvailability;
  if (!engine || typeof engine.canProviderFitDuration !== "function") {
    return { ok: false, code: api.CODES.PROVIDER_NOT_WORKING, error: "Availability engine is not loaded." };
  }
  const details = typeof engine.fitProviderDuration === "function"
    ? engine.fitProviderDuration(providerId, startAt, durationMinutes, locationId)
    : { ok: engine.canProviderFitDuration(providerId, startAt, durationMinutes, locationId) };
  if (details && details.ok) {
    return { ok: true, relocations: details.relocations || [] };
  }
  const hours = typeof engine.getEffectiveBusinessHours === "function"
    ? engine.getEffectiveBusinessHours(startAt, locationId)
    : { isOpen: false, intervals: [] };
  let startMin = null;
  try {
    if (window.ffBookingTime && typeof window.ffBookingTime.zonedMinutes === "function") {
      startMin = window.ffBookingTime.zonedMinutes(startAt, locationId);
    }
  } catch (_) {}
  const endMin = Number(startMin) + Number(durationMinutes);
  const bizFit = Number.isFinite(startMin) && (hours.intervals || []).some((win) => (
    startMin >= win.startMin && endMin <= win.endMin
  ));
  if (!hours.isOpen || !bizFit) {
    return {
      ok: false,
      code: api.CODES.OUTSIDE_BUSINESS_HOURS,
      error: "This time is outside business hours.",
    };
  }
  return {
    ok: false,
    code: api.CODES.PROVIDER_NOT_WORKING,
    error: "This provider is not working at that time.",
  };
}

async function getAppointmentById(appointmentId, salonId) {
  const id = String(appointmentId || "").trim();
  const sid = String(salonId || currentSalonId() || "").trim();
  if (!id || !sid) return null;
  const snap = await getDoc(doc(db, `salons/${sid}/appointments/${id}`));
  return snap.exists() ? toAppointment(snap) : null;
}

async function queryStartRange(salonId, startAt, endAt, extras) {
  const api = requireModel();
  const start = api.toDate(startAt);
  const end = api.toDate(endAt);
  if (!start || !end) return [];
  const lookback = new Date(start.getTime() - (extras && extras.lookbackMs != null ? extras.lookbackMs : RANGE_LOOKBACK_MS));
  const snap = await getDocs(query(
    appointmentsRef(salonId),
    where("startAt", ">=", Timestamp.fromDate(lookback)),
    where("startAt", "<", Timestamp.fromDate(end)),
    limit(500)
  ));
  return snap.docs.map(toAppointment).filter((row) => {
    if (extras && extras.locationId && row.locationId !== extras.locationId) return false;
    if (extras && extras.providerId && !(row.providerIds || []).includes(extras.providerId)) return false;
    return api.intervalsOverlap(start, end, row.startAt, row.endAt);
  });
}

function allowedOverlapMinutes() {
  const settings = window.ffBookingSettingsModel;
  if (settings && typeof settings.allowedMinutes === "function") return settings.allowedMinutes();
  return 0;
}

function providerTimesConflict(start, end, otherStart, otherEnd) {
  const settings = window.ffBookingSettingsModel;
  if (settings && typeof settings.isConflictDates === "function") {
    return settings.isConflictDates(start, end, otherStart, otherEnd, allowedOverlapMinutes());
  }
  return requireModel().intervalsOverlap(start, end, otherStart, otherEnd);
}

async function checkProviderConflict(providerId, startAt, endAt, locationId, excludeAppointmentId) {
  const api = requireModel();
  const salonId = requireSalon();
  const id = String(providerId || "").trim();
  const start = api.toDate(startAt);
  const end = api.toDate(endAt);
  if (!id || !start || !end) {
    return { conflict: false, appointment: null, line: null };
  }
  const rows = await queryStartRange(salonId, start, end, {
    providerId: id,
    lookbackMs: CONFLICT_LOOKBACK_MS,
  });
  const ignore = String(excludeAppointmentId || "").trim();
  for (const row of rows) {
    if (row.appointmentId === ignore) continue;
    if (!api.isActiveStatus(row.status)) continue;
    for (const line of row.serviceLines || []) {
      if (String(line.providerId || "") !== id) continue;
      if (providerTimesConflict(start, end, line.startAt, line.endAt)) {
        return { conflict: true, appointment: row, line };
      }
    }
  }
  return { conflict: false, appointment: null, line: null };
}

async function buildServiceLine(salonId, locationId, rawLine) {
  const api = requireModel();
  const serviceId = String(rawLine && rawLine.serviceId || "").trim();
  const providerId = String(rawLine && rawLine.providerId || "").trim();
  if (!serviceId) {
    return { ok: false, code: api.CODES.INVALID_SERVICE, error: "A service is required." };
  }
  if (!providerId) {
    return { ok: false, code: api.CODES.INVALID_LINE, error: "A provider is required." };
  }
  const service = await loadService(salonId, serviceId);
  if (!service || service.active === false) {
    return { ok: false, code: api.CODES.INVALID_SERVICE, error: "Service was not found.", serviceId };
  }
  if (!api.isProviderCapable(service, providerId)) {
    return {
      ok: false,
      code: api.CODES.PROVIDER_INCAPABLE,
      error: "This provider cannot perform that service.",
      serviceId,
      providerId,
    };
  }
  const startAt = api.toDate(rawLine && rawLine.startAt);
  const durationMinutes = api.resolveDurationMinutes(service, providerId, rawLine && rawLine.durationMinutes);
  if (!startAt || durationMinutes < 1) {
    return { ok: false, code: api.CODES.INVALID_LINE, error: "Each service line needs a start time and duration." };
  }
  let endAt = rawLine && rawLine.endAt ? api.toDate(rawLine.endAt) : null;
  if (!endAt || endAt.getTime() <= startAt.getTime()) {
    endAt = new Date(startAt.getTime() + durationMinutes * 60000);
  }
  if (!endAt || endAt.getTime() <= startAt.getTime()) {
    return { ok: false, code: api.CODES.INVALID_LINE, error: "Service line end must be after start." };
  }
  const staff = await loadStaff(salonId, providerId);
  const fit = availabilityCode(api, providerId, startAt, durationMinutes, locationId);
  if (!fit.ok) {
    return { ...fit, serviceId, providerId };
  }
  const preservePrice = !!(rawLine && rawLine.preservePriceSnapshot);
  const preserveName = !!(rawLine && rawLine.preserveNameSnapshot);
  const comboApi = window.ffBookingAppointmentCombo;
  const comboFields = comboApi && typeof comboApi.readComboFields === "function"
    ? comboApi.readComboFields(rawLine)
    : (rawLine && String(rawLine.comboInstanceId || "").trim()
      ? {
        comboInstanceId: String(rawLine.comboInstanceId).trim(),
        comboServiceId: String(rawLine.comboServiceId || "").trim(),
        comboNameSnapshot: String(rawLine.comboNameSnapshot || "").trim(),
        comboSellingPriceSnapshot: Number(rawLine.comboSellingPriceSnapshot) || 0,
        comboComponentIndex: Number(rawLine.comboComponentIndex) || 0,
        comboComponentCount: Number(rawLine.comboComponentCount) || 0,
      }
      : null);
  const useAllocated = !!(comboFields && Number.isFinite(Number(rawLine && rawLine.priceSnapshot)));
  const line = {
    lineId: String(rawLine && rawLine.lineId || "").trim() || api.makeLineId(),
    serviceId,
    serviceNameSnapshot: preserveName && String(rawLine.serviceNameSnapshot || "").trim()
      ? String(rawLine.serviceNameSnapshot).trim()
      : String(service.name || "").trim(),
    providerId,
    providerNameSnapshot: api.providerNameFrom(staff),
    startAt,
    endAt,
    durationMinutes,
    priceSnapshot: (preservePrice || useAllocated) && Number.isFinite(Number(rawLine.priceSnapshot))
      ? Number(rawLine.priceSnapshot)
      : api.resolvePriceSnapshot(service, providerId),
    guestKey: String(rawLine && rawLine.guestKey || "").trim(),
    guestName: String(rawLine && rawLine.guestName || "").trim(),
    requested: rawLine && rawLine.requested === true,
  };
  if (comboFields) {
    Object.keys(comboFields).forEach((key) => { line[key] = comboFields[key]; });
  }
  if (comboApi && typeof comboApi.readAddonFields === "function") {
    const addon = comboApi.readAddonFields(rawLine);
    if (addon) Object.keys(addon).forEach((key) => { line[key] = addon[key]; });
  } else if (rawLine && String(rawLine.addonTargetLineId || "").trim()) {
    line.lineKind = String(rawLine.lineKind || "addon").trim();
    line.addonTargetLineId = String(rawLine.addonTargetLineId).trim();
    line.addonOfComboInstanceId = String(rawLine.addonOfComboInstanceId || "").trim();
  }
  return { ok: true, line, relocations: fit.relocations || [] };
}

async function validateAppointment(data, options) {
  const api = requireModel();
  const salonId = String(options && options.salonId || "").trim() || requireSalon();
  const checked = api.normalizeCreateInput(data || {});
  if (!checked.ok) return checked;
  const excludeId = String(options && options.excludeAppointmentId || "").trim();
  const client = await loadClient(salonId, checked.fields.clientId);
  if (!client) {
    return { ok: false, code: api.CODES.INVALID_CLIENT, error: "Client was not found." };
  }
  const lines = [];
  const relocations = [];
  for (let i = 0; i < checked.fields.serviceLines.length; i += 1) {
    const built = await buildServiceLine(salonId, checked.fields.locationId, checked.fields.serviceLines[i]);
    if (!built.ok) {
      built.lineIndex = i;
      return built;
    }
    lines.push(built.line);
    (built.relocations || []).forEach((move) => {
      if (move) relocations.push(move);
    });
  }
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const conflict = await checkProviderConflict(
      line.providerId,
      line.startAt,
      line.endAt,
      checked.fields.locationId,
      excludeId
    );
    if (conflict.conflict) {
      return {
        ok: false,
        code: api.CODES.APPOINTMENT_CONFLICT,
        error: "This provider already has an overlapping appointment.",
        providerId: line.providerId,
        appointmentId: conflict.appointment && conflict.appointment.appointmentId,
        lineId: line.lineId,
        lineIndex: i,
      };
    }
    for (let j = i + 1; j < lines.length; j += 1) {
      const other = lines[j];
      if (line.providerId === other.providerId && providerTimesConflict(line.startAt, line.endAt, other.startAt, other.endAt)) {
        return {
          ok: false,
          code: api.CODES.APPOINTMENT_CONFLICT,
          error: "Service lines for the same provider overlap.",
          providerId: line.providerId,
          lineId: other.lineId,
          lineIndex: j,
        };
      }
    }
  }
  const comboApi = window.ffBookingAppointmentCombo;
  if (comboApi && typeof comboApi.validateComboAtomicity === "function") {
    const atomic = comboApi.validateComboAtomicity(lines);
    if (!atomic.ok) return atomic;
  }
  if (comboApi && typeof comboApi.validateComboPrices === "function") {
    const priced = comboApi.validateComboPrices(lines);
    if (!priced.ok) return priced;
  }
  if (api.clientIdleGaps && api.clientIdleGaps(lines).length && !data.gapsAcknowledged) {
    return {
      ok: false,
      code: api.CODES.UNRESOLVED_GAP || "UNRESOLVED_GAP",
      error: "Choose whether to keep the gap or make the times consecutive."
    };
  }
  const windowTimes = api.deriveWindow(lines);
  const dateKey = api.dateKeyOf(windowTimes.startAt, checked.fields.locationId);
  const endKey = api.dateKeyOf(windowTimes.endAt, checked.fields.locationId);
  return {
    ok: true,
    relocations,
    appointment: {
      clientId: checked.fields.clientId,
      clientSnapshot: api.clientSnapshotFrom(client),
      locationId: checked.fields.locationId,
      status: checked.fields.status,
      source: checked.fields.source,
      assignmentType: checked.fields.assignmentType,
      notes: checked.fields.notes,
      serviceLines: lines,
      providerIds: [...new Set(lines.map((line) => line.providerId))],
      startAt: windowTimes.startAt,
      endAt: windowTimes.endAt,
      dateKey,
      dateKeys: api.dateKeysBetween(dateKey, endKey),
    },
  };
}

function persistableLines(lines) {
  return (lines || []).map((line) => {
    const row = {
      lineId: line.lineId,
      serviceId: line.serviceId,
      serviceNameSnapshot: line.serviceNameSnapshot,
      providerId: line.providerId,
      providerNameSnapshot: line.providerNameSnapshot,
      startAt: asTimestamp(line.startAt),
      endAt: asTimestamp(line.endAt),
      durationMinutes: line.durationMinutes,
      priceSnapshot: line.priceSnapshot,
      guestKey: line.guestKey || "",
      guestName: line.guestName || "",
      requested: line.requested === true,
    };
    const comboApi = window.ffBookingAppointmentCombo;
    if (comboApi && typeof comboApi.applyComboFields === "function") {
      comboApi.applyComboFields(row, line);
    } else if (line && String(line.comboInstanceId || "").trim()) {
      row.comboInstanceId = String(line.comboInstanceId).trim();
      row.comboServiceId = String(line.comboServiceId || "").trim();
      row.comboNameSnapshot = String(line.comboNameSnapshot || "").trim();
      row.comboSellingPriceSnapshot = Number(line.comboSellingPriceSnapshot) || 0;
      row.comboComponentIndex = Number(line.comboComponentIndex) || 0;
      row.comboComponentCount = Number(line.comboComponentCount) || 0;
    }
    if (line && String(line.addonTargetLineId || "").trim()) {
      row.lineKind = String(line.lineKind || "addon").trim();
      row.addonTargetLineId = String(line.addonTargetLineId).trim();
      if (line.addonOfComboInstanceId) row.addonOfComboInstanceId = String(line.addonOfComboInstanceId).trim();
    }
    return row;
  });
}

async function createAppointment(data) {
  const salonId = requireSalon();
  const actor = currentActor();
  if (!actor.uid) {
    return { ok: false, created: false, error: "You must be signed in to create an appointment." };
  }
  const checked = await validateAppointment(data, { salonId });
  if (!checked.ok) return { ...checked, created: false };
  const row = checked.appointment;
  const blocks = window.ffBookingBlocks;
  let moved = [];
  if (checked.relocations && checked.relocations.length
      && blocks && typeof blocks.applyRelocations === "function") {
    try {
      moved = await blocks.applyRelocations(checked.relocations);
    } catch (err) {
      return {
        ok: false,
        created: false,
        error: (err && err.message) || "Could not move the required Time Block.",
      };
    }
  }
  const payload = {
    clientId: row.clientId,
    clientSnapshot: row.clientSnapshot,
    locationId: row.locationId,
    status: row.status,
    source: row.source,
    assignmentType: row.assignmentType,
    notes: row.notes,
    serviceLines: persistableLines(row.serviceLines),
    providerIds: row.providerIds,
    startAt: asTimestamp(row.startAt),
    endAt: asTimestamp(row.endAt),
    dateKey: row.dateKey,
    dateKeys: row.dateKeys,
    firstVisit: !(await clientHasOtherActiveAppointment(salonId, row.clientId)),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdByUid: actor.uid,
    createdByStaffId: actor.staffId,
    cancelledAt: null,
    cancelledByUid: "",
    cancellationReason: "",
  };
  let ref;
  try {
    ref = await addDoc(appointmentsRef(salonId), payload);
  } catch (err) {
    if (moved.length && blocks && typeof blocks.applyRelocations === "function") {
      try {
        await blocks.applyRelocations(moved.map((move) => Object.assign({}, move, {
          toStartMin: move.fromStartMin,
          toEndMin: move.fromEndMin,
          fromStartMin: move.toStartMin,
          fromEndMin: move.toEndMin,
          moved: true,
        })));
      } catch (_) {}
    }
    return {
      ok: false,
      created: false,
      error: (err && err.message) || "Could not save this appointment.",
    };
  }
  const appointment = await getAppointmentById(ref.id, salonId);
  emitAppointmentCreated(appointment);
  return { ok: true, created: true, appointment, relocations: moved };
}

async function getAppointmentsForDate(date, locationId) {
  const api = requireModel();
  const salonId = requireSalon();
  const loc = String(locationId || "").trim();
  if (!loc) return [];
  const dateKey = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())
    ? date.trim()
    : api.dateKeyOf(date, loc);
  if (!dateKey) return [];
  const snap = await getDocs(query(
    appointmentsRef(salonId),
    where("dateKey", "==", dateKey),
    limit(500)
  ));
  return snap.docs.map(toAppointment).filter((row) => row.locationId === loc);
}

async function getAppointmentsForRange(startDateTime, endDateTime, locationId) {
  const loc = String(locationId || "").trim();
  if (!loc) return [];
  return queryStartRange(requireSalon(), startDateTime, endDateTime, { locationId: loc });
}

function reportsRangeApi() {
  return window.ffBookingReportsAppointmentRange || null;
}

function reportsRangeUnavailable() {
  const api = reportsRangeApi();
  if (api && typeof api.failResult === "function") {
    return api.failResult("Appointment range lookup is not available.");
  }
  return {
    appointments: [],
    complete: false,
    fetchedCount: 0,
    truncated: false,
    error: "Appointment range lookup is not available.",
  };
}

async function listAppointmentsForLocationRange(locationId, fromKey, toKey, options) {
  const api = reportsRangeApi();
  if (!api || typeof api.paginateRange !== "function" || typeof api.boundsForLocation !== "function") {
    return reportsRangeUnavailable();
  }
  const loc = String(locationId || "").trim();
  if (!loc) return api.failResult("Choose a location.");
  const bounds = api.boundsForLocation(fromKey, toKey, loc);
  if (!bounds) return api.failResult("Choose a start and end date.");
  const sid = requireSalon();
  const startTs = Timestamp.fromDate(bounds.start);
  const endTs = Timestamp.fromDate(bounds.endExclusive);
  async function fetchPage(cursor, pageSize) {
    const parts = [
      where("locationId", "==", loc),
      where("startAt", ">=", startTs),
      where("startAt", "<", endTs),
      orderBy("startAt", "asc"),
    ];
    if (cursor) parts.push(startAfter(cursor));
    parts.push(limit(pageSize));
    const snap = await getDocs(query(appointmentsRef(sid), ...parts));
    return {
      rows: snap.docs.map((docSnap) => ({
        appointment: toAppointment(docSnap),
        cursor: docSnap,
      })),
    };
  }
  return api.paginateRange(fetchPage, options);
}

async function listAppointmentsForLocationsRange(locationIds, fromKey, toKey, options) {
  const api = reportsRangeApi();
  if (!api || typeof api.combineLocationResults !== "function") {
    return reportsRangeUnavailable();
  }
  const ids = typeof api.uniqueLocationIds === "function"
    ? api.uniqueLocationIds(locationIds)
    : (Array.isArray(locationIds) ? locationIds : []).map((id) => String(id || "").trim()).filter(Boolean);
  if (!ids.length) return api.failResult("Choose a location.");
  const parts = await Promise.all(ids.map((id) => listAppointmentsForLocationRange(id, fromKey, toKey, options)));
  return api.combineLocationResults(parts);
}

const CLIENT_HISTORY_LIMIT = 20;

async function getClientAppointments(clientId, options) {
  const salonId = requireSalon();
  const id = String(clientId || "").trim();
  if (!id) return { upcoming: [], past: [] };
  const cap = Math.min(CLIENT_HISTORY_LIMIT, Math.max(1, Number(options && options.limit) || CLIENT_HISTORY_LIMIT));
  const now = Timestamp.now();
  const ref = appointmentsRef(salonId);
  const [upSnap, pastSnap] = await Promise.all([
    getDocs(query(
      ref,
      where("clientId", "==", id),
      where("startAt", ">=", now),
      orderBy("startAt", "asc"),
      limit(cap)
    )),
    getDocs(query(
      ref,
      where("clientId", "==", id),
      where("startAt", "<", now),
      orderBy("startAt", "desc"),
      limit(cap)
    )),
  ]);
  return {
    upcoming: upSnap.docs.map(toAppointment),
    past: pastSnap.docs.map(toAppointment),
    limit: cap,
  };
}

async function getProviderAppointments(providerId, startDateTime, endDateTime, locationId) {
  const id = String(providerId || "").trim();
  if (!id) return [];
  const loc = String(locationId || "").trim();
  const rows = await queryStartRange(requireSalon(), startDateTime, endDateTime, {
    providerId: id,
    lookbackMs: CONFLICT_LOOKBACK_MS,
  });
  return loc ? rows.filter((row) => row.locationId === loc) : rows;
}

async function updateAppointment(appointmentId, patch) {
  const api = requireModel();
  const salonId = requireSalon();
  const id = String(appointmentId || "").trim();
  if (!id) return { ok: false, error: "Missing appointmentId." };
  const existing = await getAppointmentById(id, salonId);
  if (!existing) return { ok: false, error: "Appointment not found." };
  if (existing.status === "cancelled") {
    return { ok: false, code: api.CODES.INVALID_STATUS, error: "A cancelled appointment cannot be updated." };
  }
  const next = {
    clientId: existing.clientId,
    locationId: existing.locationId,
    status: patch && patch.status != null ? patch.status : existing.status,
    source: patch && patch.source != null ? patch.source : existing.source,
    assignmentType: patch && patch.assignmentType != null ? patch.assignmentType : existing.assignmentType,
    notes: patch && patch.notes != null ? patch.notes : existing.notes,
    serviceLines: api.mergeServiceLinePatch(
      existing.serviceLines,
      patch && patch.serviceLines != null ? patch.serviceLines : existing.serviceLines
    ),
    gapsAcknowledged: !!(patch && patch.gapsAcknowledged),
  };
  const checked = await validateAppointment(next, { salonId, excludeAppointmentId: id });
  if (!checked.ok) return checked;
  const row = checked.appointment;
  await updateDoc(doc(db, `salons/${salonId}/appointments/${id}`), {
    locationId: row.locationId,
    status: row.status,
    source: row.source,
    assignmentType: row.assignmentType,
    notes: row.notes,
    serviceLines: persistableLines(row.serviceLines),
    providerIds: row.providerIds,
    startAt: asTimestamp(row.startAt),
    endAt: asTimestamp(row.endAt),
    dateKey: row.dateKey,
    dateKeys: row.dateKeys,
    updatedAt: serverTimestamp(),
  });
  const appointment = await getAppointmentById(id, salonId);
  if (existing.status !== "completed" && row.status === "completed" && appointment && !appointment.saleId) {
    try {
      if (window.ffBookingSales && typeof window.ffBookingSales.createFromAppointment === "function") {
        await window.ffBookingSales.createFromAppointment(appointment);
      }
    } catch (_) {}
  }
  emitAppointmentUpdated(appointment);
  return { ok: true, appointment };
}

async function cancelAppointment(appointmentId, reason) {
  const api = requireModel();
  const salonId = requireSalon();
  const actor = currentActor();
  const id = String(appointmentId || "").trim();
  if (!id) return { ok: false, error: "Missing appointmentId." };
  const existing = await getAppointmentById(id, salonId);
  if (!existing) return { ok: false, error: "Appointment not found." };
  if (existing.status === "cancelled") {
    emitAppointmentCancelled(existing);
    return { ok: true, appointment: existing, alreadyCancelled: true };
  }
  await updateDoc(doc(db, `salons/${salonId}/appointments/${id}`), {
    status: "cancelled",
    cancelledAt: serverTimestamp(),
    cancelledByUid: actor.uid,
    cancellationReason: api.normalizeNotes(reason),
    updatedAt: serverTimestamp(),
  });
  const appointment = await getAppointmentById(id, salonId);
  emitAppointmentCancelled(appointment);
  return { ok: true, appointment };
}

const api = {
  createAppointment,
  getAppointmentById,
  getAppointmentsForDate,
  getAppointmentsForRange,
  listAppointmentsForLocationRange,
  listAppointmentsForLocationsRange,
  getClientAppointments,
  getProviderAppointments,
  updateAppointment,
  cancelAppointment,
  checkProviderConflict,
  validateAppointment,
};

window.ffBookingAppointments = api;
export {
  createAppointment,
  getAppointmentById,
  getAppointmentsForDate,
  getAppointmentsForRange,
  listAppointmentsForLocationRange,
  listAppointmentsForLocationsRange,
  getClientAppointments,
  getProviderAppointments,
  updateAppointment,
  cancelAppointment,
  checkProviderConflict,
  validateAppointment,
};
