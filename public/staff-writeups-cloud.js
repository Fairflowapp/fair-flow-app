/**
 * staff-writeups-cloud.js — Firestore + Storage access for the Employee
 * Write-Ups tab (Phase 1: incidents).
 *
 * Paths:
 *   incidents:   salons/{salonId}/staff/{staffId}/writeupIncidents/{incidentId}
 *   audit trail: .../writeupIncidents/{incidentId}/auditEvents/{eventId} (append-only)
 *   attachments: Storage salons/{salonId}/staffWriteups/{staffId}/incidents/{incidentId}/...
 *                (dedicated path — the generic staff/ storage path is readable by
 *                any signed-in user, which is not acceptable for this data)
 *   settings:    salons/{salonId}/settings/writeups (optional; local defaults apply)
 *
 * All timestamps use serverTimestamp(); incidentAt is a real Timestamp built
 * from the form's date+time so the repeated-incident window uses the incident
 * moment, not the recording moment.
 */
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { db, auth, storage } from "/app.js?v=20260610_force_lp_ios";
import {
  wuState,
  WRITEUP_DEFAULT_SETTINGS,
  WRITEUP_COUNTABLE_STATUSES,
  WRITEUP_MAX_FILE_BYTES,
} from "./staff-writeups-state.js?v=20260731_writeups_phase2";

function trimStr(v) {
  return String(v == null ? "" : v).trim();
}

export function toDateMaybe(v) {
  try {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v.toDate === "function") return v.toDate();
    if (typeof v === "number") return new Date(v);
    return null;
  } catch (_) {
    return null;
  }
}

function incidentsColRef(salonId, staffId) {
  return collection(db, "salons", salonId, "staff", staffId, "writeupIncidents");
}

function incidentDocRef(salonId, staffId, incidentId) {
  return doc(db, "salons", salonId, "staff", staffId, "writeupIncidents", incidentId);
}

/** Resolve the acting user's staff row (id + name) from the staff store. */
export function resolveActorStaff() {
  try {
    const sid = trimStr(
      window.__ff_authedStaffId ||
        (typeof localStorage !== "undefined" ? localStorage.getItem("ff_authedStaffId_v1") : "") ||
        "",
    );
    const store = typeof window.ffGetStaffStore === "function" ? window.ffGetStaffStore() : null;
    const list = store && Array.isArray(store.staff) ? store.staff : [];
    const me = sid
      ? list.find((s) => {
          const id = trimStr((s && (s.id || s.staffId)) || "");
          return id && (id === sid || id.toLowerCase() === sid.toLowerCase());
        })
      : null;
    return {
      staffId: sid || null,
      name: me ? trimStr(me.name || me.fullName || me.displayName || "") || null : null,
    };
  } catch (_) {
    return { staffId: null, name: null };
  }
}

// ---------- Settings ----------

/**
 * Load per-salon write-up settings; missing doc / bad values fall back to
 * local defaults ({ threshold: 3, windowDays: 30 }). Never throws.
 */
export async function loadWriteupSettings(salonId) {
  const sid = trimStr(salonId);
  if (wuState._settings && wuState._settingsSalonId === sid) return wuState._settings;
  let settings = { ...WRITEUP_DEFAULT_SETTINGS };
  try {
    const snap = await getDoc(doc(db, "salons", sid, "settings", "writeups"));
    if (snap.exists()) {
      const d = snap.data() || {};
      const th = Number(d.threshold);
      const wd = Number(d.windowDays);
      if (Number.isFinite(th) && th >= 1) settings.threshold = Math.floor(th);
      if (Number.isFinite(wd) && wd >= 1) settings.windowDays = Math.floor(wd);
    }
  } catch (_) {
    // permission/network problems: keep defaults, suggestion still works
  }
  wuState._settings = settings;
  wuState._settingsSalonId = sid;
  return settings;
}

// ---------- Live subscription ----------

export function ensureIncidentsSubscription(salonId, staffId, onChange) {
  const key = `${salonId}::${staffId}`;
  if (wuState._mountedKey === key && wuState._unsub) return;

  if (typeof wuState._unsub === "function") {
    try {
      wuState._unsub();
    } catch (_) {}
  }
  wuState._unsub = null;
  wuState._mountedKey = key;
  wuState._mountCtx = { salonId, staffId };
  wuState._lastIncidentList = null;
  wuState._loadError = "";
  wuState._statusFilter = "all";

  wuState._unsub = onSnapshot(
    incidentsColRef(salonId, staffId),
    (snap) => {
      if (wuState._mountedKey !== key) return;
      const list = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => {
        const ta = toDateMaybe(a.incidentAt)?.getTime() ?? 0;
        const tb = toDateMaybe(b.incidentAt)?.getTime() ?? 0;
        return tb - ta;
      });
      wuState._lastIncidentList = list;
      wuState._loadError = "";
      if (typeof onChange === "function") onChange();
    },
    (err) => {
      console.warn("[staff-writeups]", err);
      if (wuState._mountedKey !== key) return;
      wuState._loadError = err && err.code === "permission-denied" ? "permission" : "error";
      if (typeof onChange === "function") onChange();
    },
  );
}

export function unsubscribeIncidents() {
  if (typeof wuState._unsub === "function") {
    try {
      wuState._unsub();
    } catch (_) {}
  }
  wuState._unsub = null;
  wuState._mountedKey = "";
}

// ---------- Attachments ----------

/** Storage rules only accept PDF + images; some browsers report an empty
 *  File.type for HEIC/HEIF, so fall back to the extension. */
function attachmentContentType(file) {
  const t = trimStr(file.type).toLowerCase();
  if (t) return t;
  const ext = trimStr(file.name).toLowerCase().split(".").pop();
  const map = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
  };
  return map[ext] || "";
}

const WRITEUP_ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

/**
 * Upload incident attachments to the DEDICATED confidential Storage path.
 * Returns metadata entries; no download URL is persisted — files are resolved
 * on demand so Storage rules stay the single access gate.
 */
export async function uploadIncidentAttachments(salonId, staffId, incidentId, files) {
  const out = [];
  for (const file of files) {
    if (!file) continue;
    if (file.size > WRITEUP_MAX_FILE_BYTES) {
      throw new Error(`"${file.name}" is over 10 MB.`);
    }
    const contentType = attachmentContentType(file);
    if (!WRITEUP_ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new Error(`"${file.name}" is not a supported file type (PDF or image).`);
    }
    const fileId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const safeName = (file.name || "file").replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 80);
    const path = `salons/${salonId}/staffWriteups/${staffId}/incidents/${incidentId}/${fileId}_${safeName}`;
    await uploadBytes(storageRef(storage, path), file, { contentType });
    out.push({
      name: file.name || safeName,
      storagePath: path,
      size: file.size || 0,
      contentType,
    });
  }
  return out;
}

/** Resolve a short-lived view URL for an attachment (Storage rules enforce access). */
export async function resolveAttachmentUrl(storagePath) {
  return getDownloadURL(storageRef(storage, storagePath));
}

// ---------- Audit trail (append-only) ----------

async function appendAuditEvent(salonId, staffId, incidentId, action, meta) {
  const actor = resolveActorStaff();
  const payload = {
    action,
    performedByUid: auth.currentUser?.uid || null,
    performedByStaffId: actor.staffId,
    performedByName: actor.name,
    createdAt: serverTimestamp(),
    ...(meta && typeof meta === "object" ? meta : {}),
  };
  await addDoc(
    collection(db, "salons", salonId, "staff", staffId, "writeupIncidents", incidentId, "auditEvents"),
    payload,
  );
}

// ---------- Create / update ----------

/**
 * Create an incident. `fields` carries the sanitized form values; `files` is an
 * array of File objects. Attachments are uploaded first so a failed upload
 * never leaves a half-written incident. Nothing is sent to the employee.
 */
export async function createIncident(salonId, staffId, fields, files) {
  const actor = resolveActorStaff();
  const ref = doc(incidentsColRef(salonId, staffId));
  const attachments = files && files.length
    ? await uploadIncidentAttachments(salonId, staffId, ref.id, files)
    : [];
  const payload = {
    salonId,
    employeeId: staffId,
    type: fields.type,
    incidentAt: Timestamp.fromDate(fields.incidentAt),
    minutesLate: fields.minutesLate,
    locationId: fields.locationId,
    locationName: fields.locationName,
    description: fields.description,
    employeeResponse: fields.employeeResponse,
    privateNotes: fields.privateNotes,
    attachments,
    status: fields.status,
    archived: false,
    recordedByUid: auth.currentUser?.uid || null,
    recordedByStaffId: actor.staffId,
    recordedByName: fields.recordedByName || actor.name,
    createdByUid: auth.currentUser?.uid || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, payload);
  await appendAuditEvent(salonId, staffId, ref.id, "created", {
    status: fields.status,
    incidentType: fields.type,
    attachmentCount: attachments.length,
  });
  return ref.id;
}

/**
 * Update an incident. `changes` = plain field changes, `changedFields` = names
 * for the audit event, `newFiles` = extra attachments to append (existing
 * attachments are never removed in Phase 1 — audit integrity).
 */
export async function updateIncident(salonId, staffId, incidentId, changes, changedFields, newFiles) {
  const patch = { ...changes, updatedAt: serverTimestamp() };
  if (changes.incidentAt instanceof Date) {
    patch.incidentAt = Timestamp.fromDate(changes.incidentAt);
  }
  let addedCount = 0;
  if (newFiles && newFiles.length) {
    const uploaded = await uploadIncidentAttachments(salonId, staffId, incidentId, newFiles);
    addedCount = uploaded.length;
    const current = (wuState._lastIncidentList || []).find((i) => i.id === incidentId);
    const existing = current && Array.isArray(current.attachments) ? current.attachments : [];
    patch.attachments = existing.concat(uploaded);
  }
  await updateDoc(incidentDocRef(salonId, staffId, incidentId), patch);
  await appendAuditEvent(salonId, staffId, incidentId, "updated", {
    changedFields: changedFields || Object.keys(changes),
    ...(addedCount ? { attachmentsAdded: addedCount } : {}),
  });
}

/** Status-only change (e.g. Mark as Excused) with its own audit action. */
export async function setIncidentStatus(salonId, staffId, incidentId, newStatus, prevStatus) {
  await updateDoc(incidentDocRef(salonId, staffId, incidentId), {
    status: newStatus,
    updatedAt: serverTimestamp(),
  });
  await appendAuditEvent(salonId, staffId, incidentId, "status_changed", {
    from: prevStatus || null,
    to: newStatus,
    changedFields: ["status"],
  });
}

// ---------- Repeated-incident suggestion (client-side, recommendation only) ----------

/**
 * "Related" (Phase 1) = same incident type for the same employee. Counts only
 * status documented / included_in_writeup, not archived, with incidentAt
 * inside the configured window. Returns [{ typeId, count }] for every type at
 * or over the threshold. This NEVER creates or sends anything by itself.
 */
export function computeRepeatSuggestions(incidents, settings, nowMs) {
  const s = settings || WRITEUP_DEFAULT_SETTINGS;
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  const windowStart = now - s.windowDays * 24 * 60 * 60 * 1000;
  const counts = {};
  (incidents || []).forEach((inc) => {
    if (!inc || inc.archived === true) return;
    if (!WRITEUP_COUNTABLE_STATUSES.has(String(inc.status || ""))) return;
    const at = toDateMaybe(inc.incidentAt)?.getTime();
    if (!at || at < windowStart || at > now + 24 * 60 * 60 * 1000) return;
    const t = trimStr(inc.type);
    if (!t) return;
    counts[t] = (counts[t] || 0) + 1;
  });
  return Object.keys(counts)
    .filter((t) => counts[t] >= s.threshold)
    .map((t) => ({ typeId: t, count: counts[t] }));
}
