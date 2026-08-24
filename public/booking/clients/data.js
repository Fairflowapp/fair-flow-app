/**
 * Booking Client repository.
 * All Client Firestore reads/writes go through here.
 * Path: salons/{salonId}/clients/{clientId}
 */
import {
  addDoc,
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  Timestamp,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";

function model() {
  return window.ffBookingClientModel || null;
}

function currentSalonId() {
  return String(window.currentSalonId || "").trim();
}

function currentLocationId() {
  try {
    if (typeof window.ffGetActiveLocationId === "function") {
      const value = String(window.ffGetActiveLocationId() || "").trim();
      if (value) return value;
    }
  } catch (_) {}
  return String(window.__ff_active_location_id || "").trim();
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

function clientsRef(salonId) {
  return collection(db, `salons/${salonId}/clients`);
}

function toClient(docSnap) {
  return model().fromDoc(docSnap.id, docSnap.data());
}

function requireSalon() {
  const salonId = currentSalonId();
  if (!salonId) throw new Error("No salon is selected.");
  return salonId;
}

function requireModel() {
  const api = model();
  if (!api) throw new Error("Client model is not loaded.");
  return api;
}

function emitClientCreated(client) {
  try {
    document.dispatchEvent(new CustomEvent("ff-booking-client-created", { detail: { client: client || null } }));
  } catch (_) {}
}

async function getClientById(clientId, salonId) {
  const id = String(clientId || "").trim();
  const sid = String(salonId || currentSalonId() || "").trim();
  if (!id || !sid) return null;
  const snap = await getDoc(doc(db, `salons/${sid}/clients/${id}`));
  if (!snap.exists()) return null;
  return toClient(snap);
}

async function searchPhone(salonId, rawPhone) {
  const api = requireModel();
  const sid = String(salonId || "").trim();
  const keys = api.phoneKeys(rawPhone);
  if (!sid || !keys.length) return [];
  const cap = api.SEARCH_LIMIT;
  const ref = clientsRef(sid);
  const byId = new Map();

  function addSnap(snap) {
    if (!snap) return;
    snap.docs.forEach((docSnap) => {
      if (!byId.has(docSnap.id)) byId.set(docSnap.id, toClient(docSnap));
    });
  }

  try {
    addSnap(await getDocs(query(
      ref,
      where("phoneKeys", "array-contains-any", keys.slice(0, 10)),
      limit(cap)
    )));
  } catch (_) {}

  if (!byId.size) {
    await Promise.all(keys.map(async (key) => {
      try {
        addSnap(await getDocs(query(ref, where("phoneDigits", "==", key), limit(cap))));
      } catch (_) {}
    }));
  }

  return [...byId.values()].slice(0, cap);
}

async function findClientByPhone(phone, salonId) {
  const rows = await searchPhone(String(salonId || currentSalonId() || "").trim(), phone);
  return rows[0] || null;
}

async function findClientByEmail(email, salonId) {
  const api = requireModel();
  const sid = String(salonId || currentSalonId() || "").trim();
  const normalized = api.normalizeEmail(email);
  if (!sid || !normalized) return null;
  const snap = await getDocs(query(
    clientsRef(sid),
    where("emailNormalized", "==", normalized),
    limit(5)
  ));
  if (snap.empty) return null;
  return toClient(snap.docs[0]);
}

async function findDuplicate(fields, salonId, ignoreClientId) {
  const ignore = String(ignoreClientId || "").trim();
  if (fields.phoneKeys && fields.phoneKeys.length) {
    const byPhone = await findClientByPhone(fields.phone || fields.phoneDigits, salonId);
    if (byPhone && byPhone.clientId !== ignore) {
      return { matchBy: "phone", client: byPhone };
    }
  }
  if (fields.emailNormalized) {
    const byEmail = await findClientByEmail(fields.emailNormalized, salonId);
    if (byEmail && byEmail.clientId !== ignore) {
      return { matchBy: "email", client: byEmail };
    }
  }
  return null;
}

async function searchName(salonId, nameQuery) {
  const api = requireModel();
  const q = String(nameQuery || "").trim();
  if (!q) return [];
  const end = q + "\uf8ff";
  const cap = api.SEARCH_LIMIT;
  const ref = clientsRef(salonId);
  const [firstSnap, lastSnap, fullSnap] = await Promise.all([
    getDocs(query(ref, where("firstNameNormalized", ">=", q), where("firstNameNormalized", "<=", end), limit(cap))),
    getDocs(query(ref, where("lastNameNormalized", ">=", q), where("lastNameNormalized", "<=", end), limit(cap))),
    getDocs(query(ref, where("displayNameNormalized", ">=", q), where("displayNameNormalized", "<=", end), limit(cap))),
  ]);
  const byId = new Map();
  firstSnap.docs.concat(lastSnap.docs, fullSnap.docs).forEach((docSnap) => {
    if (!byId.has(docSnap.id)) byId.set(docSnap.id, toClient(docSnap));
  });
  return [...byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)).slice(0, cap);
}

async function searchClients(rawQuery, salonId) {
  const api = requireModel();
  const sid = String(salonId || currentSalonId() || "").trim();
  if (!sid) return [];
  const classified = api.classifyQuery(rawQuery);
  if (classified.kind === "empty") return [];
  if (classified.kind === "email") {
    const hit = await findClientByEmail(classified.value, sid);
    return hit ? [hit] : [];
  }
  if (classified.kind === "phone") {
    return searchPhone(sid, classified.value);
  }
  return searchName(sid, classified.value);
}

async function createClient(input) {
  const api = requireModel();
  const salonId = requireSalon();
  const checked = api.validateCreate(input || {});
  if (!checked.ok) {
    return { ok: false, created: false, error: checked.error };
  }
  const duplicate = await findDuplicate(checked.fields, salonId);
  if (duplicate) {
    return {
      ok: true,
      created: false,
      duplicate: true,
      matchBy: duplicate.matchBy,
      client: duplicate.client,
    };
  }
  const actor = currentActor();
  if (!actor.uid) {
    return { ok: false, created: false, error: "You must be signed in to create a client." };
  }
  const payload = {
    firstName: checked.fields.firstName,
    lastName: checked.fields.lastName,
    phone: checked.fields.phone,
    email: checked.fields.email,
    notes: checked.fields.notes,
    firstNameNormalized: checked.fields.firstNameNormalized,
    lastNameNormalized: checked.fields.lastNameNormalized,
    displayNameNormalized: checked.fields.displayNameNormalized,
    emailNormalized: checked.fields.emailNormalized,
    phoneDigits: checked.fields.phoneDigits,
    phoneKeys: checked.fields.phoneKeys,
    createdAtLocationId: currentLocationId(),
    createdByUid: actor.uid,
    createdByStaffId: actor.staffId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const ref = await addDoc(clientsRef(salonId), payload);
  const client = await getClientById(ref.id, salonId);
  emitClientCreated(client);
  return { ok: true, created: true, duplicate: false, client };
}

const PAGE_SIZE = 50;
const SORTS = {
  updated_desc: { field: "updatedAt", dir: "desc" },
  created_desc: { field: "createdAt", dir: "desc" },
  name_asc: { field: "displayNameNormalized", dir: "asc" },
  name_desc: { field: "displayNameNormalized", dir: "desc" },
};

function toTimestamp(value) {
  if (!value) return null;
  if (value instanceof Timestamp) return value;
  if (typeof value.toDate === "function") return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Timestamp.fromDate(date);
}

function browseConstraints(opts) {
  const createdFrom = toTimestamp(opts && opts.createdFrom);
  const updatedFrom = toTimestamp(opts && opts.updatedFrom);
  const sort = SORTS[(opts && opts.sort) || ""] || SORTS.updated_desc;
  const constraints = [];
  if (createdFrom) constraints.push(where("createdAt", ">=", createdFrom));
  if (updatedFrom) constraints.push(where("updatedAt", ">=", updatedFrom));

  const ineq = [];
  if (createdFrom) ineq.push("createdAt");
  if (updatedFrom) ineq.push("updatedAt");

  if (!ineq.length) {
    constraints.push(orderBy(sort.field, sort.dir));
  } else if (ineq.indexOf(sort.field) >= 0) {
    constraints.push(orderBy(sort.field, sort.dir));
    const other = ineq.find((field) => field !== sort.field);
    if (other) constraints.push(orderBy(other, "desc"));
  } else {
    constraints.push(orderBy(ineq[0], "desc"));
    if (ineq[1]) constraints.push(orderBy(ineq[1], "desc"));
    constraints.push(orderBy(sort.field, sort.dir));
  }
  return constraints;
}

async function listClientsPage(opts) {
  const salonId = requireSalon();
  const spec = opts && typeof opts === "object" ? opts : {};
  const cap = Math.min(PAGE_SIZE, Math.max(1, Number(spec.pageSize) || PAGE_SIZE));
  const constraints = browseConstraints(spec);
  if (spec.cursor) constraints.push(startAfter(spec.cursor));
  constraints.push(limit(cap + 1));
  const snap = await getDocs(query(clientsRef(salonId), ...constraints));
  const hasMore = snap.docs.length > cap;
  const pageDocs = hasMore ? snap.docs.slice(0, cap) : snap.docs;
  return {
    clients: pageDocs.map(toClient),
    cursor: pageDocs.length ? pageDocs[pageDocs.length - 1] : null,
    hasMore,
    pageSize: cap,
  };
}

async function countClients(opts) {
  const salonId = requireSalon();
  try {
    const snap = await getCountFromServer(query(clientsRef(salonId), ...browseConstraints(opts || {})));
    const n = snap && snap.data ? Number(snap.data().count) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch (_) {
    return null;
  }
}

async function getRecentClients(max) {
  const page = await listClientsPage({
    sort: "updated_desc",
    pageSize: Math.min(50, Math.max(1, Number(max) || 50)),
  });
  return page.clients;
}

async function updateClient(clientId, patch) {
  const api = requireModel();
  const salonId = requireSalon();
  const id = String(clientId || "").trim();
  if (!id) return { ok: false, error: "Missing clientId." };
  const existing = await getClientById(id, salonId);
  if (!existing) return { ok: false, error: "Client not found." };
  const merged = api.buildSearchFields({
    firstName: patch && patch.firstName != null ? patch.firstName : existing.firstName,
    lastName: patch && patch.lastName != null ? patch.lastName : existing.lastName,
    phone: patch && patch.phone != null ? patch.phone : existing.phone,
    email: patch && patch.email != null ? patch.email : existing.email,
    notes: patch && patch.notes != null ? patch.notes : existing.notes,
  });
  if (!merged.firstName && !merged.lastName) {
    return { ok: false, error: "A first or last name is required." };
  }
  if (merged.email && !api.isEmailLike(merged.email)) {
    return { ok: false, error: "Email looks invalid." };
  }
  const duplicate = await findDuplicate(merged, salonId, id);
  if (duplicate) {
    return {
      ok: false,
      duplicate: true,
      matchBy: duplicate.matchBy,
      client: duplicate.client,
      error: "Another client already uses that phone or email.",
    };
  }
  await updateDoc(doc(db, `salons/${salonId}/clients/${id}`), {
    firstName: merged.firstName,
    lastName: merged.lastName,
    phone: merged.phone,
    email: merged.email,
    notes: merged.notes,
    firstNameNormalized: merged.firstNameNormalized,
    lastNameNormalized: merged.lastNameNormalized,
    displayNameNormalized: merged.displayNameNormalized,
    emailNormalized: merged.emailNormalized,
    phoneDigits: merged.phoneDigits,
    phoneKeys: merged.phoneKeys,
    updatedAt: serverTimestamp(),
  });
  const client = await getClientById(id, salonId);
  return { ok: true, client };
}

const api = {
  createClient,
  getClientById,
  getRecentClients,
  listClientsPage,
  countClients,
  searchClients,
  findClientByPhone,
  findClientByEmail,
  updateClient,
  currentSalonId,
  currentLocationId,
  PAGE_SIZE,
};

window.ffBookingClients = api;
export {
  createClient,
  getClientById,
  getRecentClients,
  listClientsPage,
  countClients,
  searchClients,
  findClientByPhone,
  findClientByEmail,
  updateClient,
};
