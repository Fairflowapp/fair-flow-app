/**
 * Persistent Block Time repository.
 * Path: salons/{salonId}/calendarBlocks/{blockId}
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";

function model() {
  return window.ffBookingBlockModel || null;
}

function cache() {
  return window.ffBookingCalBlocks || null;
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

function blocksRef(salonId) {
  return collection(db, `salons/${salonId}/calendarBlocks`);
}

function emitChanged(detail) {
  try {
    document.dispatchEvent(new CustomEvent("ff-booking-calendar-blocks-changed", {
      detail: detail || {},
    }));
  } catch (_) {}
}

function applyList(rows) {
  const api = cache();
  if (api && typeof api.setAll === "function") api.setAll(rows);
  return rows;
}

function toBlock(docSnap) {
  const api = model();
  return api && typeof api.fromDoc === "function"
    ? api.fromDoc(docSnap.id, docSnap.data())
    : null;
}

async function loadForDates(dateKeys, locationId) {
  const salonId = requireSalon();
  const keys = (dateKeys || []).map((key) => String(key || "").trim()).filter(Boolean);
  const loc = String(locationId || "").trim();
  if (!keys.length || !loc) return applyList([]);
  const start = keys.slice().sort()[0];
  const end = keys.slice().sort()[keys.length - 1];
  const snap = await getDocs(query(
    blocksRef(salonId),
    where("dateKey", ">=", start),
    where("dateKey", "<=", end)
  ));
  const rows = [];
  snap.forEach((docSnap) => {
    const row = toBlock(docSnap);
    if (!row || row.locationId !== loc) return;
    if (keys.indexOf(row.dateKey) === -1) return;
    rows.push(row);
  });
  return applyList(rows);
}

async function loadForView(dateKey, locationId) {
  return loadForDates([dateKey], locationId);
}

function payloadFrom(spec, actor, isCreate) {
  const api = model();
  const row = api && typeof api.normalize === "function" ? api.normalize(spec) : spec;
  if (!row) throw new Error("That Time Block is not valid.");
  const body = {
    locationId: row.locationId,
    providerId: row.providerId,
    dateKey: row.dateKey,
    startMin: row.startMin,
    endMin: row.endMin,
    reason: row.reason,
    label: row.label,
    note: row.note || "",
    updatedAt: serverTimestamp(),
  };
  if (isCreate) {
    body.createdByUid = actor.uid;
    body.createdByStaffId = actor.staffId;
    body.createdAt = serverTimestamp();
  }
  return body;
}

async function create(spec) {
  const salonId = requireSalon();
  const actor = currentActor();
  if (!actor.uid) throw new Error("You need to be signed in.");
  const body = payloadFrom(spec, actor, true);
  const ref = await addDoc(blocksRef(salonId), body);
  const api = model();
  const row = api && typeof api.normalize === "function"
    ? api.normalize(Object.assign({ blockId: ref.id }, spec, body, {
      createdByUid: actor.uid,
      createdByStaffId: actor.staffId,
    }))
    : Object.assign({ blockId: ref.id }, spec);
  if (row && cache() && typeof cache().upsert === "function") cache().upsert(row);
  emitChanged({ action: "create", block: row });
  return row;
}

async function update(blockId, spec) {
  const salonId = requireSalon();
  const id = String(blockId || "").trim();
  if (!id) throw new Error("Missing block.");
  const body = payloadFrom(spec, currentActor(), false);
  await updateDoc(doc(db, `salons/${salonId}/calendarBlocks/${id}`), body);
  const api = model();
  const row = api && typeof api.normalize === "function"
    ? api.normalize(Object.assign({ blockId: id }, spec, body))
    : Object.assign({ blockId: id }, spec);
  if (row && cache() && typeof cache().upsert === "function") cache().upsert(row);
  emitChanged({ action: "update", block: row });
  return row;
}

async function remove(blockId) {
  const salonId = requireSalon();
  const id = String(blockId || "").trim();
  if (!id) throw new Error("Missing block.");
  await deleteDoc(doc(db, `salons/${salonId}/calendarBlocks/${id}`));
  if (cache() && typeof cache().remove === "function") cache().remove(id);
  emitChanged({ action: "delete", blockId: id });
  return id;
}

window.ffBookingBlocks = {
  loadForView,
  loadForDates,
  create,
  update,
  remove,
};

export {
  loadForView,
  loadForDates,
  create,
  update,
  remove,
};
