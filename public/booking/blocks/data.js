/**
 * Persistent Time Block repository.
 * One-off: salons/{salonId}/calendarBlocks/{blockId}
 * Recurring: salons/{salonId}/calendarBlockSeries/{seriesId}
 * Per-date exceptions: salons/{salonId}/calendarBlockExceptions/{seriesId}__{dateKey}
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";

function model() {
  return window.ffBookingBlockModel || null;
}

function seriesModel() {
  return window.ffBookingBlockSeriesModel || null;
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

function seriesRef(salonId) {
  return collection(db, `salons/${salonId}/calendarBlockSeries`);
}

function exceptionsRef(salonId) {
  return collection(db, `salons/${salonId}/calendarBlockExceptions`);
}

function emitChanged(detail) {
  try {
    document.dispatchEvent(new CustomEvent("ff-booking-calendar-blocks-changed", {
      detail: detail || {},
    }));
  } catch (_) {}
}

function applyList(rows, startedWriteGen) {
  const api = cache();
  if (api && typeof api.applyLoaded === "function") {
    return api.applyLoaded(rows, startedWriteGen);
  }
  if (api && typeof api.setAll === "function") api.setAll(rows);
  return rows;
}

function toBlock(docSnap) {
  const api = model();
  return api && typeof api.fromDoc === "function"
    ? api.fromDoc(docSnap.id, docSnap.data())
    : null;
}

function uniqueById(rows) {
  const seen = {};
  const out = [];
  (rows || []).forEach((row) => {
    const id = String(row && row.blockId || "").trim();
    if (!id || seen[id]) return;
    seen[id] = true;
    out.push(row);
  });
  return out;
}

function visibleDateKeys() {
  const st = window.ffBookingCalState;
  if (st && st.isWeek && st.isWeek() && typeof st.getWeekDateKeys === "function") {
    return st.getWeekDateKeys() || [];
  }
  if (st && typeof st.getSelectedDateKey === "function") {
    const key = st.getSelectedDateKey();
    return key ? [key] : [];
  }
  return [];
}

function paintCache() {
  const api = cache();
  if (api && typeof api.paint === "function") {
    try { api.paint(); } catch (_) {}
  }
}

function upsertCache(row) {
  if (row && cache() && typeof cache().upsert === "function") cache().upsert(row);
}

async function querySafe(fn) {
  try {
    return await fn();
  } catch (err) {
    const code = String(err && err.code || "");
    if (code.indexOf("permission") !== -1 || code.indexOf("not-found") !== -1) return null;
    throw err;
  }
}

async function loadSeriesAndExceptions(salonId, loc, start, end) {
  const sm = seriesModel();
  const seriesSnap = await querySafe(() => getDocs(query(
    seriesRef(salonId),
    where("locationId", "==", loc)
  )));
  const exSnap = await querySafe(() => getDocs(query(
    exceptionsRef(salonId),
    where("occurrenceDateKey", ">=", start),
    where("occurrenceDateKey", "<=", end)
  )));
  const seriesRows = [];
  if (seriesSnap && sm && typeof sm.fromSeriesDoc === "function") {
    seriesSnap.forEach((docSnap) => {
      const row = sm.fromSeriesDoc(docSnap.id, docSnap.data());
      if (row) seriesRows.push(row);
    });
  }
  const exceptions = [];
  if (exSnap && sm && typeof sm.normalizeException === "function") {
    exSnap.forEach((docSnap) => {
      const row = sm.normalizeException(Object.assign({ exceptionId: docSnap.id }, docSnap.data() || {}));
      if (row) exceptions.push(row);
    });
  }
  return { seriesRows, exceptions };
}

async function loadForDates(dateKeys, locationId) {
  const salonId = requireSalon();
  const api = cache();
  const started = api && typeof api.beginLoad === "function" ? api.beginLoad() : 0;
  const keys = (dateKeys || []).map((key) => String(key || "").trim()).filter(Boolean);
  const loc = String(locationId || "").trim();
  if (!keys.length || !loc) {
    return api && typeof api.getAll === "function" ? api.getAll() : [];
  }
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
  const extra = await loadSeriesAndExceptions(salonId, loc, start, end);
  const sm = seriesModel();
  const generated = sm && typeof sm.generateOccurrences === "function"
    ? sm.generateOccurrences(extra.seriesRows, keys, extra.exceptions)
    : [];
  return applyList(uniqueById(rows.concat(generated)), started);
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
    flexibilityMode: row.flexibilityMode || "fixed",
    preferredStartMin: Number.isFinite(Number(row.preferredStartMin)) ? row.preferredStartMin : row.startMin,
    earliestStartMin: Number.isFinite(Number(row.earliestStartMin)) ? row.earliestStartMin : row.startMin,
    latestEndMin: Number.isFinite(Number(row.latestEndMin)) ? row.latestEndMin : row.endMin,
    requiredDurationMinutes: Number(row.requiredDurationMinutes) > 0
      ? row.requiredDurationMinutes
      : (row.endMin - row.startMin),
    updatedAt: serverTimestamp(),
  };
  if (isCreate) {
    body.createdByUid = actor.uid;
    body.createdByStaffId = actor.staffId;
    body.createdAt = serverTimestamp();
  }
  return body;
}

function seriesPayloadFrom(spec, actor, isCreate) {
  const sm = seriesModel();
  const row = sm && typeof sm.normalizeSeries === "function" ? sm.normalizeSeries(spec) : spec;
  if (!row || row.repeatFrequency === "none") throw new Error("That repeating Time Block is not valid.");
  const body = {
    locationId: row.locationId,
    providerId: row.providerId,
    reason: row.reason,
    label: row.label,
    note: row.note || "",
    preferredStartMin: row.preferredStartMin,
    durationMinutes: row.durationMinutes,
    repeatFrequency: row.repeatFrequency,
    daysOfWeek: row.daysOfWeek || [],
    startDateKey: row.startDateKey,
    endDateKey: row.endDateKey || "",
    flexibilityMode: row.flexibilityMode || "fixed",
    earliestStartMin: row.earliestStartMin,
    latestEndMin: row.latestEndMin,
    requiredDurationMinutes: row.requiredDurationMinutes,
    updatedAt: serverTimestamp(),
  };
  if (isCreate) {
    body.createdByUid = actor.uid;
    body.createdByStaffId = actor.staffId;
    body.createdAt = serverTimestamp();
  }
  return { row, body };
}

function refreshGenerated(seriesRow, exception) {
  const sm = seriesModel();
  const keys = visibleDateKeys();
  if (!sm || typeof sm.generateOccurrences !== "function" || !keys.length) return;
  const generated = sm.generateOccurrences([seriesRow], keys, exception ? [exception] : []);
  generated.forEach(upsertCache);
  paintCache();
}

async function createSeries(spec) {
  const salonId = requireSalon();
  const actor = currentActor();
  if (!actor.uid) throw new Error("You need to be signed in.");
  const packed = seriesPayloadFrom(spec, actor, true);
  const ref = await addDoc(seriesRef(salonId), packed.body);
  const sm = seriesModel();
  const row = sm && typeof sm.normalizeSeries === "function"
    ? sm.normalizeSeries(Object.assign({}, packed.row, packed.body, {
      seriesId: ref.id,
      createdByUid: actor.uid,
      createdByStaffId: actor.staffId,
    }))
    : Object.assign({}, packed.row, { seriesId: ref.id });
  refreshGenerated(row);
  emitChanged({ action: "create-series", series: row });
  return row;
}

async function updateSeries(seriesId, spec) {
  const salonId = requireSalon();
  const id = String(seriesId || "").trim();
  if (!id) throw new Error("Missing series.");
  const packed = seriesPayloadFrom(Object.assign({}, spec, { seriesId: id }), currentActor(), false);
  await updateDoc(doc(db, `salons/${salonId}/calendarBlockSeries/${id}`), packed.body);
  const sm = seriesModel();
  const row = sm && typeof sm.normalizeSeries === "function"
    ? sm.normalizeSeries(Object.assign({}, packed.row, packed.body, { seriesId: id }))
    : Object.assign({}, packed.row, { seriesId: id });
  refreshGenerated(row);
  emitChanged({ action: "update-series", series: row });
  return row;
}

async function writeException(seriesId, dateKey, fields) {
  const salonId = requireSalon();
  const actor = currentActor();
  if (!actor.uid) throw new Error("You need to be signed in.");
  const sm = seriesModel();
  const id = sm && typeof sm.exceptionDocId === "function"
    ? sm.exceptionDocId(seriesId, dateKey)
    : String(seriesId) + "__" + String(dateKey);
  const body = Object.assign({
    seriesId: String(seriesId || "").trim(),
    occurrenceDateKey: String(dateKey || "").trim(),
    kind: fields && fields.kind === "skip" ? "skip" : "override",
    updatedAt: serverTimestamp(),
  }, fields || {});
  body.createdByUid = actor.uid;
  body.createdByStaffId = actor.staffId;
  if (!body.createdAt) body.createdAt = serverTimestamp();
  await setDoc(doc(db, `salons/${salonId}/calendarBlockExceptions/${id}`), body, { merge: true });
  const exception = sm && typeof sm.normalizeException === "function"
    ? sm.normalizeException(Object.assign({ exceptionId: id }, body))
    : Object.assign({ exceptionId: id }, body);
  const occId = sm && typeof sm.occurrenceId === "function" ? sm.occurrenceId(seriesId, dateKey) : "";
  if (exception && exception.kind === "skip") {
    if (occId && cache() && typeof cache().remove === "function") cache().remove(occId);
  } else if (exception && exception.kind === "override") {
    const current = cache() && typeof cache().getById === "function" && occId
      ? cache().getById(occId)
      : null;
    const occ = sm && typeof sm.occurrenceFrom === "function" && current
      ? sm.occurrenceFrom(Object.assign({}, current, { seriesId: seriesId }), dateKey, exception)
      : null;
    if (occ) upsertCache(occ);
  }
  paintCache();
  emitChanged({ action: "exception", exception });
  return exception;
}

async function overrideOccurrence(seriesId, dateKey, spec) {
  const startMin = Number(spec && spec.startMin);
  const endMin = Number(spec && spec.endMin);
  return writeException(seriesId, dateKey, {
    kind: "override",
    startMin,
    endMin,
    providerId: spec && spec.providerId ? String(spec.providerId).trim() : "",
    reason: spec && spec.reason ? String(spec.reason).trim() : "",
    note: spec && spec.note != null ? String(spec.note) : "",
  });
}

async function skipOccurrence(seriesId, dateKey) {
  return writeException(seriesId, dateKey, { kind: "skip" });
}

async function deleteSeries(seriesId) {
  const salonId = requireSalon();
  const id = String(seriesId || "").trim();
  if (!id) throw new Error("Missing series.");
  const sm = seriesModel();
  const snap = await querySafe(() => getDocs(query(
    exceptionsRef(salonId),
    where("seriesId", "==", id)
  )));
  const batch = writeBatch(db);
  if (snap) {
    snap.forEach((docSnap) => batch.delete(docSnap.ref));
  }
  batch.delete(doc(db, `salons/${salonId}/calendarBlockSeries/${id}`));
  await batch.commit();
  if (cache() && typeof cache().getAll === "function") {
    cache().getAll().forEach((row) => {
      if (row && row.seriesId === id && typeof cache().remove === "function") cache().remove(row.blockId);
    });
  }
  paintCache();
  emitChanged({ action: "delete-series", seriesId: id });
  return id;
}

async function splitSeriesFrom(seriesId, dateKey, spec) {
  const sm = seriesModel();
  const id = String(seriesId || "").trim();
  const day = String(dateKey || "").trim();
  if (!id || !day) throw new Error("Missing series.");
  const current = cache() && typeof cache().getById === "function"
    ? cache().getById(sm.occurrenceId(id, day))
    : null;
  const prev = sm.previousDateKey(day);
  const startKey = current && current.startDateKey ? current.startDateKey : day;
  if (startKey === day) {
    return updateSeries(id, Object.assign({}, current, spec, {
      seriesId: id,
      startDateKey: day,
      dateKey: day,
    }));
  }
  await updateSeries(id, Object.assign({}, current, {
    seriesId: id,
    endDateKey: prev,
    startDateKey: startKey,
    preferredStartMin: current && current.preferredStartMin,
    durationMinutes: current && current.durationMinutes,
    repeatFrequency: current && current.repeatFrequency,
    daysOfWeek: current && current.daysOfWeek,
    flexibilityMode: current && current.flexibilityMode,
    earliestStartMin: current && current.earliestStartMin,
    latestEndMin: current && current.latestEndMin,
    providerId: current && current.providerId,
    locationId: current && current.locationId,
    reason: current && current.reason,
    note: current && current.note,
  }));
  return createSeries(Object.assign({}, current, spec, {
    seriesId: "",
    startDateKey: day,
    dateKey: day,
    blockId: "",
  }));
}

async function create(spec) {
  const sm = seriesModel();
  const frequency = sm && typeof sm.normalizeFrequency === "function"
    ? sm.normalizeFrequency(spec && spec.repeatFrequency)
    : "none";
  if (frequency && frequency !== "none") return createSeries(spec);
  const salonId = requireSalon();
  const actor = currentActor();
  if (!actor.uid) throw new Error("You need to be signed in.");
  const body = payloadFrom(spec, actor, true);
  const ref = await addDoc(blocksRef(salonId), body);
  const api = model();
  const row = api && typeof api.normalize === "function"
    ? api.normalize(Object.assign({}, spec, body, {
      blockId: ref.id,
      createdByUid: actor.uid,
      createdByStaffId: actor.staffId,
    }))
    : Object.assign({}, spec, { blockId: ref.id });
  upsertCache(row);
  emitChanged({ action: "create", block: row });
  return row;
}

async function update(blockId, spec) {
  const sm = seriesModel();
  const parsed = sm && typeof sm.parseOccurrenceId === "function" ? sm.parseOccurrenceId(blockId) : null;
  if (parsed) {
    return overrideOccurrence(parsed.seriesId, parsed.dateKey, spec);
  }
  const salonId = requireSalon();
  const id = String(blockId || "").trim();
  if (!id) throw new Error("Missing block.");
  const body = payloadFrom(spec, currentActor(), false);
  await updateDoc(doc(db, `salons/${salonId}/calendarBlocks/${id}`), body);
  const api = model();
  const row = api && typeof api.normalize === "function"
    ? api.normalize(Object.assign({}, spec, body, { blockId: id }))
    : Object.assign({}, spec, { blockId: id });
  upsertCache(row);
  emitChanged({ action: "update", block: row });
  return row;
}

async function remove(blockId) {
  const sm = seriesModel();
  const parsed = sm && typeof sm.parseOccurrenceId === "function" ? sm.parseOccurrenceId(blockId) : null;
  if (parsed) return skipOccurrence(parsed.seriesId, parsed.dateKey);
  const salonId = requireSalon();
  const id = String(blockId || "").trim();
  if (!id) throw new Error("Missing block.");
  await deleteDoc(doc(db, `salons/${salonId}/calendarBlocks/${id}`));
  if (cache() && typeof cache().remove === "function") cache().remove(id);
  emitChanged({ action: "delete", blockId: id });
  return id;
}

async function applyRelocations(relocations) {
  const moves = Array.isArray(relocations) ? relocations.filter((row) => row && row.moved) : [];
  const applied = [];
  try {
    for (const move of moves) {
      if (move.seriesId && move.occurrenceDateKey) {
        await overrideOccurrence(move.seriesId, move.occurrenceDateKey, {
          startMin: move.toStartMin,
          endMin: move.toEndMin,
          providerId: move.providerId,
        });
      } else if (move.blockId) {
        const current = cache() && typeof cache().getById === "function"
          ? cache().getById(move.blockId)
          : null;
        await update(move.blockId, Object.assign({}, current, {
          startMin: move.toStartMin,
          endMin: move.toEndMin,
          preferredStartMin: current && current.preferredStartMin != null
            ? current.preferredStartMin
            : move.preferredStartMin,
        }));
      }
      applied.push(move);
    }
    return applied;
  } catch (err) {
    for (const move of applied.slice().reverse()) {
      try {
        if (move.seriesId && move.occurrenceDateKey) {
          await overrideOccurrence(move.seriesId, move.occurrenceDateKey, {
            startMin: move.fromStartMin,
            endMin: move.fromEndMin,
          });
        } else if (move.blockId) {
          const current = cache() && typeof cache().getById === "function"
            ? cache().getById(move.blockId)
            : null;
          await update(move.blockId, Object.assign({}, current, {
            startMin: move.fromStartMin,
            endMin: move.fromEndMin,
          }));
        }
      } catch (_) {}
    }
    throw err;
  }
}

window.ffBookingBlocks = {
  loadForView,
  loadForDates,
  create,
  update,
  remove,
  createSeries,
  updateSeries,
  overrideOccurrence,
  skipOccurrence,
  deleteSeries,
  splitSeriesFrom,
  applyRelocations,
};

export {
  loadForView,
  loadForDates,
  create,
  update,
  remove,
  createSeries,
  updateSeries,
  overrideOccurrence,
  skipOccurrence,
  deleteSeries,
  splitSeriesFrom,
  applyRelocations,
};
