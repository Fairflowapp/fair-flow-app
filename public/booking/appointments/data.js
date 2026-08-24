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

function availabilityCode(api, providerId, startAt, durationMinutes, locationId) {
  const engine = window.ffBookingAvailability;
  if (!engine || typeof engine.canProviderFitDuration !== "function") {
    return { ok: false, code: api.CODES.PROVIDER_NOT_WORKING, error: "Availability engine is not loaded." };
  }
  if (engine.canProviderFitDuration(providerId, startAt, durationMinutes, locationId)) {
    return { ok: true };
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
      if (api.intervalsOverlap(start, end, line.startAt, line.endAt)) {
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
  const endAt = rawLine && rawLine.endAt
    ? api.toDate(rawLine.endAt)
    : new Date(startAt.getTime() + durationMinutes * 60000);
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
  return {
    ok: true,
    line: {
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
      priceSnapshot: preservePrice && Number.isFinite(Number(rawLine.priceSnapshot))
        ? Number(rawLine.priceSnapshot)
        : api.resolvePriceSnapshot(service, providerId),
    },
  };
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
  for (let i = 0; i < checked.fields.serviceLines.length; i += 1) {
    const built = await buildServiceLine(salonId, checked.fields.locationId, checked.fields.serviceLines[i]);
    if (!built.ok) {
      built.lineIndex = i;
      return built;
    }
    lines.push(built.line);
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
      if (line.providerId === other.providerId && api.intervalsOverlap(line.startAt, line.endAt, other.startAt, other.endAt)) {
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
  const windowTimes = api.deriveWindow(lines);
  const dateKey = api.dateKeyOf(windowTimes.startAt, checked.fields.locationId);
  const endKey = api.dateKeyOf(windowTimes.endAt, checked.fields.locationId);
  return {
    ok: true,
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
  return (lines || []).map((line) => ({
    lineId: line.lineId,
    serviceId: line.serviceId,
    serviceNameSnapshot: line.serviceNameSnapshot,
    providerId: line.providerId,
    providerNameSnapshot: line.providerNameSnapshot,
    startAt: asTimestamp(line.startAt),
    endAt: asTimestamp(line.endAt),
    durationMinutes: line.durationMinutes,
    priceSnapshot: line.priceSnapshot,
  }));
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
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdByUid: actor.uid,
    createdByStaffId: actor.staffId,
    cancelledAt: null,
    cancelledByUid: "",
    cancellationReason: "",
  };
  const ref = await addDoc(appointmentsRef(salonId), payload);
  const appointment = await getAppointmentById(ref.id, salonId);
  emitAppointmentCreated(appointment);
  return { ok: true, created: true, appointment };
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
  getClientAppointments,
  getProviderAppointments,
  updateAppointment,
  cancelAppointment,
  checkProviderConflict,
  validateAppointment,
};
