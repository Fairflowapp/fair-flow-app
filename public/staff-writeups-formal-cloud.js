/**
 * staff-writeups-formal-cloud.js — Firestore + callable access for formal
 * write-ups (Phase 2, admin side).
 *
 * Paths:
 *   drafts/workflow: salons/{salonId}/staff/{staffId}/writeups/{writeupId}
 *                    (owner/admin/writeups_manage; client-editable while draft)
 *   issued docs:     salons/{salonId}/staff/{staffId}/writeupDocuments/{writeupId}
 *                    (backend-only writes — immutable from the client)
 *   audit trail:     .../writeups/{writeupId}/auditEvents/{eventId} (append-only)
 *   email queue:     mail/writeup_{writeupId}_a{n} (backend-created; owner/admin
 *                    may read delivery state for the Queued / Send failed chip)
 *
 * Approve & Send / resume / resend / mark-declined all go through the
 * approveAndSendWriteup callable, which enforces Owner/Admin server-side.
 * permissions.writeups_manage alone can draft but can never send — the UI
 * hides the buttons, the backend is the real gate.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import { wuState } from "./staff-writeups-state.js?v=20260802_writeups_phase2d";
import { resolveActorStaff, toDateMaybe } from "./staff-writeups-cloud.js?v=20260802_writeups_phase2d";

function trimStr(v) {
  return String(v == null ? "" : v).trim();
}

function writeupsColRef(salonId, staffId) {
  return collection(db, "salons", salonId, "staff", staffId, "writeups");
}

function writeupDocRef(salonId, staffId, writeupId) {
  return doc(db, "salons", salonId, "staff", staffId, "writeups", writeupId);
}

// ---------- Live subscription (admin list) ----------

export function ensureFormalSubscription(salonId, staffId, onChange) {
  if (typeof wuState._formalUnsub === "function") {
    try {
      wuState._formalUnsub();
    } catch (_) {}
  }
  wuState._formalUnsub = null;
  wuState._formalList = null;
  wuState._formalError = "";

  const key = `${salonId}::${staffId}`;
  wuState._formalUnsub = onSnapshot(
    writeupsColRef(salonId, staffId),
    (snap) => {
      if (wuState._mountedKey !== key) return;
      const list = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => {
        const ta = toDateMaybe(a.createdAt)?.getTime() ?? 0;
        const tb = toDateMaybe(b.createdAt)?.getTime() ?? 0;
        return tb - ta;
      });
      wuState._formalList = list;
      wuState._formalError = "";
      if (typeof onChange === "function") onChange();
      void refreshMailStates(list, onChange);
    },
    (err) => {
      console.warn("[staff-writeups] formal list", err);
      if (wuState._mountedKey !== key) return;
      wuState._formalError = err && err.code === "permission-denied" ? "permission" : "error";
      if (typeof onChange === "function") onChange();
    },
  );
}

export function unsubscribeFormal() {
  if (typeof wuState._formalUnsub === "function") {
    try {
      wuState._formalUnsub();
    } catch (_) {}
  }
  wuState._formalUnsub = null;
  wuState._formalList = null;
  wuState._formalError = "";
  wuState._mailStates = {};
}

/**
 * Email chip data: 'queued' | 'failed'. Only statuses the infrastructure can
 * truly report — never "Delivered" or "Opened" (Trigger Email has no
 * open/delivery webhooks; delivery.state ERROR is the only failure signal).
 */
async function refreshMailStates(list, onChange) {
  const wanted = (list || [])
    .filter((w) => trimStr(w.status) === "sent" && trimStr(w.lastMailId))
    .map((w) => ({
      mailId: trimStr(w.lastMailId),
      // Stamped by the backend (staging writes to writeupMailStaging so the
      // extension there never touches old `mail` test docs). Only the two
      // known collections are ever read — never a client-supplied name.
      mailCol:
        trimStr(w.lastMailCollection) === "writeupMailStaging" ? "writeupMailStaging" : "mail",
    }));
  let changed = false;
  for (const { mailId, mailCol } of wanted) {
    try {
      const snap = await getDoc(doc(db, mailCol, mailId));
      const state = trimStr(snap.exists() ? snap.data()?.delivery?.state : "").toUpperCase();
      const mapped = state === "ERROR" ? "failed" : "queued";
      if (wuState._mailStates[mailId] !== mapped) {
        wuState._mailStates[mailId] = mapped;
        changed = true;
      }
    } catch (_) {
      // No read access / not found — leave unknown, chip falls back to "Queued".
    }
  }
  if (changed && typeof onChange === "function") onChange();
}

/** The issued immutable snapshot (what the employee sees). Null if not sent yet. */
export async function loadIssuedDocument(salonId, staffId, writeupId) {
  try {
    const snap = await getDoc(
      doc(db, "salons", salonId, "staff", staffId, "writeupDocuments", writeupId),
    );
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (err) {
    console.warn("[staff-writeups] issued doc load failed", err);
    return null;
  }
}

// ---------- Locations (authoritative source of the employee-facing salon name) ----------

/**
 * Active locations of the salon — salons/{salonId}/locations/{locationId},
 * name field `name`, active = isActive !== false. Prefers the live list kept
 * by locations-cloud.js (window.ffGetActiveLocations) and falls back to a
 * direct Firestore read when it hasn't loaded. The employee-facing salon
 * name on a formal write-up is ALWAYS the selected location's saved name —
 * never the logged-in user's name and never the top-level salon doc name.
 */
export async function loadActiveLocations(salonId) {
  try {
    if (typeof window.ffGetActiveLocations === "function") {
      const live = window.ffGetActiveLocations();
      if (Array.isArray(live) && live.length) {
        return live.map((l) => ({ id: trimStr(l.id), name: trimStr(l.name) || trimStr(l.id) }));
      }
    }
  } catch (_) {}
  try {
    const snap = await getDocs(collection(db, "salons", trimStr(salonId), "locations"));
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() || {}) }))
      .filter((l) => l.isActive !== false)
      .map((l) => ({ id: trimStr(l.id), name: trimStr(l.name) || trimStr(l.id) }));
  } catch (_) {
    return [];
  }
}

/**
 * Optional parent brand (settings/main.brandName). Display-only extra — it
 * must NEVER be required and never blocks creating or sending a write-up.
 */
export async function loadOptionalParentBrand(salonId) {
  try {
    const snap = await getDoc(doc(db, "salons", trimStr(salonId), "settings", "main"));
    return snap.exists() ? trimStr(snap.data()?.brandName) : "";
  } catch (_) {
    return "";
  }
}

// ---------- Draft audit (client-side, append-only per rules) ----------

async function appendDraftAudit(salonId, staffId, writeupId, action, meta) {
  const actor = resolveActorStaff();
  const eventId = `${action}_${Date.now().toString(36)}`;
  await setDoc(
    doc(db, "salons", salonId, "staff", staffId, "writeups", writeupId, "auditEvents", eventId),
    {
      action,
      performedByUid: auth.currentUser?.uid || null,
      performedByStaffId: actor.staffId,
      performedByName: actor.name,
      createdAt: serverTimestamp(),
      ...(meta && typeof meta === "object" ? meta : {}),
    },
  );
}

// ---------- Draft CRUD ----------

function draftPayloadFromFields(fields) {
  return {
    employeeName: trimStr(fields.employeeName),
    employeePosition: trimStr(fields.employeePosition) || null,
    // Required: which salon location this write-up belongs to. The backend
    // re-fetches this location server-side and uses ITS saved name — the
    // salonName/locationName stored here are display copies only.
    locationId: trimStr(fields.locationId),
    salonName: trimStr(fields.salonName),
    locationName: trimStr(fields.locationName) || null,
    warningLevel: trimStr(fields.warningLevel),
    writeupDate:
      fields.writeupDate instanceof Date ? Timestamp.fromDate(fields.writeupDate) : null,
    selectedIncidentIds: Array.isArray(fields.selectedIncidentIds)
      ? fields.selectedIncidentIds
      : [],
    incidentSummaries: Array.isArray(fields.incidentSummaries)
      ? fields.incidentSummaries.map((s) => ({
          incidentId: trimStr(s.incidentId),
          type: trimStr(s.type),
          incidentAt:
            s.incidentAt instanceof Date ? Timestamp.fromDate(s.incidentAt) : s.incidentAt || null,
          description: trimStr(s.description),
        }))
      : [],
    policyViolated: trimStr(fields.policyViolated) || null,
    requiredImprovement: trimStr(fields.requiredImprovement) || null,
    followUpDate: trimStr(fields.followUpDate) || null,
    potentialNextSteps: trimStr(fields.potentialNextSteps) || null,
    /** Shown to the employee in the issued document. */
    employeeFacingStatement: trimStr(fields.employeeFacingStatement) || null,
    /** Internal only — the backend NEVER copies this into the issued document. */
    managerComments: trimStr(fields.managerComments) || null,
    managerName: trimStr(fields.managerName) || null,
    emailSubject: trimStr(fields.emailSubject),
    emailBody: trimStr(fields.emailBody),
  };
}

export async function createWriteupDraft(salonId, staffId, fields, opts) {
  const ref = doc(writeupsColRef(salonId, staffId));
  const previousWriteupId = trimStr(opts && opts.previousWriteupId) || null;
  await setDoc(ref, {
    salonId,
    employeeId: staffId,
    status: "draft",
    version: Number(opts && opts.version) || 1,
    previousWriteupId,
    ...draftPayloadFromFields(fields),
    createdByUid: auth.currentUser?.uid || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await appendDraftAudit(salonId, staffId, ref.id, "draft_created", {
    ...(previousWriteupId ? { correctionOf: previousWriteupId } : {}),
  });
  return ref.id;
}

export async function updateWriteupDraft(salonId, staffId, writeupId, fields) {
  await updateDoc(writeupDocRef(salonId, staffId, writeupId), {
    ...draftPayloadFromFields(fields),
    updatedAt: serverTimestamp(),
  });
  await appendDraftAudit(salonId, staffId, writeupId, "draft_updated", {});
}

export async function deleteWriteupDraft(salonId, staffId, writeupId) {
  await deleteDoc(writeupDocRef(salonId, staffId, writeupId));
}

// ---------- Callables ----------

async function callWriteupFn(name, payload) {
  const { getFunctions, httpsCallable } = await import(
    "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js"
  );
  const fn = httpsCallable(getFunctions(undefined, "us-central1"), name);
  const res = await fn(payload);
  return res && res.data ? res.data : {};
}

/** Approve & Send (or resume a stuck "sending" state). Owner/Admin only. */
export async function approveAndSendWriteup(salonId, staffId, writeupId) {
  return callWriteupFn("approveAndSendWriteup", { salonId, staffId, writeupId });
}

/** Queue the next email attempt for an already-sent write-up. Owner/Admin only. */
export async function resendWriteupEmail(salonId, staffId, writeupId) {
  return callWriteupFn("approveAndSendWriteup", {
    salonId,
    staffId,
    writeupId,
    resendEmail: true,
  });
}

/**
 * Record "employee declined to acknowledge" on a SENT write-up. Runs entirely
 * in the trusted backend (Owner/Admin verified server-side): both the
 * workflow doc and the issued employee-facing document are updated with
 * server timestamps, an append-only audit event is written, and repeat calls
 * are idempotent. No client ever writes writeupDocuments directly.
 */
export async function markDeclinedToAcknowledge(salonId, staffId, writeupId, note) {
  return callWriteupFn("approveAndSendWriteup", {
    salonId,
    staffId,
    writeupId,
    markDeclined: true,
    ...(trimStr(note) ? { declineNote: trimStr(note) } : {}),
  });
}
