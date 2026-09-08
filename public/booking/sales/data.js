/**
 * Booking Sales repository.
 * All Sale Firestore reads/writes go through here.
 * Path: salons/{salonId}/sales/{saleId}
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
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";

const LIST_LIMIT = 80;
const CLIENT_LIMIT = 40;

function model() {
  return window.ffBookingSalesModel || null;
}

function requireModel() {
  const api = model();
  if (!api) throw new Error("Sales model is not loaded.");
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

function staffNameFromStore(staffId, uid) {
  const id = String(staffId || "").trim();
  const authUid = String(uid || "").trim();
  let list = [];
  try {
    if (typeof window.ffGetStaffStore === "function") {
      const store = window.ffGetStaffStore();
      if (store && Array.isArray(store.staff)) list = store.staff;
    }
  } catch (_) {}
  const hit = list.find((row) => {
    if (!row) return false;
    return (id && (String(row.id || "") === id || String(row.staffId || "") === id))
      || (authUid && (String(row.uid || "") === authUid || String(row.firebaseUid || "") === authUid));
  });
  if (!hit) return "";
  return [hit.firstName, hit.lastName].filter(Boolean).join(" ").trim()
    || String(hit.displayName || hit.name || "").trim();
}

function currentActor() {
  let uid = "";
  try {
    const auth = window.ffAuth || window.auth || null;
    uid = auth && auth.currentUser && auth.currentUser.uid
      ? String(auth.currentUser.uid).trim()
      : "";
  } catch (_) {}
  const profile = window.currentUserProfile || window.__ff_authedStaff || {};
  const staffId = String(
    window.__ff_authedStaffId
    || profile.staffId
    || profile.id
    || ""
  ).trim();
  let sessionName = "";
  try { sessionName = String(sessionStorage.getItem("ff_actor_name") || "").trim(); } catch (_) {}
  const name = String(window.__ff_authedStaffName || "").trim()
    || sessionName
    || [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim()
    || String(profile.displayName || profile.name || "").trim()
    || staffNameFromStore(staffId, uid);
  return { uid, staffId, name };
}

function salesRef(salonId) {
  return collection(db, `salons/${salonId}/sales`);
}

function toSale(docSnap) {
  return requireModel().fromDoc(docSnap.id, docSnap.data());
}

function emitSaleCreated(sale) {
  try {
    document.dispatchEvent(new CustomEvent("ff-booking-sale-created", {
      detail: { sale: sale || null },
    }));
  } catch (_) {}
}

function closedTimestamp(value) {
  if (!value) return Timestamp.now();
  try {
    if (typeof value.toDate === "function") return Timestamp.fromDate(value.toDate());
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return Timestamp.fromDate(date);
  } catch (_) {}
  return Timestamp.now();
}

async function nextSaleNumber(salonId) {
  const ref = doc(db, `salons/${salonId}/counters/sales`);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? Number(snap.data().next) || 0 : 0;
    const next = current + 1;
    if (snap.exists()) tx.update(ref, { next, updatedAt: serverTimestamp() });
    else tx.set(ref, { next, updatedAt: serverTimestamp() });
    return next;
  });
}

async function getSaleById(saleId, salonId) {
  const id = String(saleId || "").trim();
  const sid = String(salonId || currentSalonId() || "").trim();
  if (!id || !sid) return null;
  const snap = await getDoc(doc(db, `salons/${sid}/sales/${id}`));
  return snap.exists() ? toSale(snap) : null;
}

async function findByAppointmentId(appointmentId, salonId) {
  const id = String(appointmentId || "").trim();
  const sid = String(salonId || currentSalonId() || "").trim();
  if (!id || !sid) return null;
  const snap = await getDocs(query(
    salesRef(sid),
    where("appointmentId", "==", id),
    limit(1)
  ));
  return snap.docs[0] ? toSale(snap.docs[0]) : null;
}

function sortClosedDesc(rows) {
  return (rows || []).slice().sort((a, b) => {
    const ta = a && a.closedAt && (a.closedAt.seconds || a.closedAt.getTime && a.closedAt.getTime() / 1000) || 0;
    const tb = b && b.closedAt && (b.closedAt.seconds || b.closedAt.getTime && b.closedAt.getTime() / 1000) || 0;
    return tb - ta;
  });
}

async function listForLocation(locationId, options) {
  const sid = requireSalon();
  const loc = String(locationId || "").trim();
  const cap = Math.min(LIST_LIMIT, Math.max(1, Number(options && options.limit) || LIST_LIMIT));
  if (!loc) return [];
  try {
    const snap = await getDocs(query(
      salesRef(sid),
      where("locationId", "==", loc),
      orderBy("closedAt", "desc"),
      limit(cap)
    ));
    return snap.docs.map(toSale);
  } catch (_) {
    const snap = await getDocs(query(
      salesRef(sid),
      where("locationId", "==", loc),
      limit(cap)
    ));
    return sortClosedDesc(snap.docs.map(toSale));
  }
}

async function listForSalon(options) {
  const sid = requireSalon();
  const cap = Math.min(LIST_LIMIT, Math.max(1, Number(options && options.limit) || LIST_LIMIT));
  try {
    const snap = await getDocs(query(
      salesRef(sid),
      orderBy("closedAt", "desc"),
      limit(cap)
    ));
    return snap.docs.map(toSale);
  } catch (_) {
    const snap = await getDocs(query(salesRef(sid), limit(cap)));
    return sortClosedDesc(snap.docs.map(toSale));
  }
}

async function listForClient(clientId, options) {
  const sid = requireSalon();
  const id = String(clientId || "").trim();
  const cap = Math.min(CLIENT_LIMIT, Math.max(1, Number(options && options.limit) || CLIENT_LIMIT));
  if (!id) return { orders: [] };
  const snap = await getDocs(query(
    salesRef(sid),
    where("clientId", "==", id),
    orderBy("closedAt", "desc"),
    limit(cap)
  ));
  return { orders: snap.docs.map(toSale) };
}

function persistableItems(items) {
  return requireModel().normalizeItems(items);
}

async function createSale(input) {
  const api = requireModel();
  const checked = api.normalizeCreate(input);
  if (!checked.ok) return checked;
  const salonId = requireSalon();
  const actor = currentActor();
  if (!actor.uid) return { ok: false, error: "Sign in to complete a sale." };
  if (checked.fields.appointmentId) {
    const existing = await findByAppointmentId(checked.fields.appointmentId, salonId);
    if (existing) return { ok: true, sale: existing, alreadyExisted: true };
  }
  const saleNumber = await nextSaleNumber(salonId);
  const now = Timestamp.now();
  const payload = {
    saleNumber,
    locationId: checked.fields.locationId,
    clientId: checked.fields.clientId,
    clientSnapshot: checked.fields.clientSnapshot,
    appointmentId: checked.fields.appointmentId || "",
    status: checked.fields.status,
    source: checked.fields.source,
    items: persistableItems(checked.fields.items),
    subtotal: checked.fields.subtotal,
    tax: checked.fields.tax,
    tip: checked.fields.tip || 0,
    total: checked.fields.total,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    closedAt: checked.fields.status === "closed" ? closedTimestamp(checked.fields.closedAt || now) : null,
    notes: "",
    history: [],
    method: "none",
    processor: "none",
    houseDiscount: 0,
    channel: requireModel().channelFromSource ? requireModel().channelFromSource(checked.fields.source) : "staff",
    createdByUid: actor.uid,
    createdByStaffId: actor.staffId,
    createdByName: actor.name || "",
  };
  const ref = await addDoc(salesRef(salonId), payload);
  const sale = await getSaleById(ref.id, salonId);
  emitSaleCreated(sale);
  return { ok: true, sale };
}

async function attachSaleToAppointment(appointmentId, saleId) {
  const salonId = requireSalon();
  const apptId = String(appointmentId || "").trim();
  const id = String(saleId || "").trim();
  if (!apptId || !id) return;
  try {
    await updateDoc(doc(db, `salons/${salonId}/appointments/${apptId}`), {
      saleId: id,
      updatedAt: serverTimestamp(),
    });
  } catch (_) {}
}

async function createFromAppointment(appointment, extras) {
  const api = requireModel();
  const built = api.fromAppointment(appointment, extras);
  if (!built.ok) return built;
  const result = await createSale(built.fields);
  if (result && result.ok && result.sale && appointment && appointment.appointmentId) {
    await attachSaleToAppointment(appointment.appointmentId, result.sale.saleId);
  }
  return result;
}

function emitSaleUpdated(sale) {
  try {
    document.dispatchEvent(new CustomEvent("ff-booking-sale-updated", {
      detail: { sale: sale || null },
    }));
  } catch (_) {}
}

async function updateSale(saleId, patch) {
  const api = requireModel();
  const salonId = requireSalon();
  const id = String(saleId || "").trim();
  if (!id) return { ok: false, error: "Missing sale." };
  const existing = await getSaleById(id, salonId);
  if (!existing) return { ok: false, error: "Sale not found." };
  const next = patch && typeof patch === "object" ? patch : {};
  const actor = currentActor();
  const payload = { updatedAt: serverTimestamp() };
  if (next.notes != null) payload.notes = api.normalizeNotes(next.notes);
  if (next.status != null) {
    if (!api.isStatus(next.status) || next.status === "void") {
      return { ok: false, error: "Invalid sale status." };
    }
    payload.status = next.status;
    if (next.status === "open") payload.closedAt = null;
    if (next.status === "closed" && !existing.closedAt) payload.closedAt = Timestamp.now();
  }
  if (next.closedAt != null) payload.closedAt = closedTimestamp(next.closedAt);
  const events = typeof api.historyFromPatch === "function"
    ? api.historyFromPatch(existing, next, actor)
    : [];
  if (events.length) {
    const now = Timestamp.now();
    payload.history = (existing.history || []).concat(events.map((row) => ({
      type: row.type || "",
      at: now,
      byName: row.byName || "",
      byStaffId: actor.staffId || "",
      byUid: actor.uid || "",
      from: row.from || "",
      to: row.to || "",
      fromWhen: row.fromWhen || null,
      fromBy: row.fromBy || "",
      amount: Number(row.amount) || 0,
      previousTotal: Number(row.previousTotal) || 0,
    })));
  }
  await updateDoc(doc(db, `salons/${salonId}/sales/${id}`), payload);
  const sale = await getSaleById(id, salonId);
  emitSaleUpdated(sale);
  return { ok: true, sale };
}

async function backfillCompletedForDate(dateKey, locationId) {
  const appts = window.ffBookingAppointments;
  const key = String(dateKey || "").trim();
  const loc = String(locationId || "").trim();
  if (!appts || typeof appts.getAppointmentsForDate !== "function" || !key || !loc) {
    return { created: 0 };
  }
  const rows = await appts.getAppointmentsForDate(key, loc);
  let created = 0;
  for (const appt of rows || []) {
    if (!appt || appt.status !== "completed" || appt.saleId) continue;
    const result = await createFromAppointment(appt);
    if (result && result.ok && !result.alreadyExisted) created += 1;
  }
  return { created };
}

const api = {
  getSaleById,
  findByAppointmentId,
  listForLocation,
  listForSalon,
  listForClient,
  createSale,
  createFromAppointment,
  updateSale,
  backfillCompletedForDate,
};

window.ffBookingSales = api;
window.ffBookingClientSales = {
  listForClient,
};
export {
  getSaleById,
  findByAppointmentId,
  listForLocation,
  listForSalon,
  listForClient,
  createSale,
  createFromAppointment,
  updateSale,
  backfillCompletedForDate,
};
