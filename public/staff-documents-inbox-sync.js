/**
 * staff-documents-inbox-sync.js — Inbox -> staff /documents sync (split of staff-documents.js).
 * Verbatim move of the owner-resolution helpers plus approve/reject/resync writers used by
 * inbox.js when a manager approves or denies a document_request / document_upload item.
 * State-free: every function takes a Firestore connection (dbConn) as a parameter.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { auth } from "/app.js?v=20260610_force_lp_ios";
import { parseExpirationForStaffDoc, stripUndefined, trimStr } from "./staff-documents-format.js?v=20260701_staffdoc_format_split";

/**
 * Firestore staff id for the employee whose profile should receive this document.
 *
 * - **document_upload**: the uploader is the owner. `forStaffId` / `forUid` identify the *recipient*
 *   (manager), so we must prefer **createdBy*** fields.
 * - **document_request**: the recipient staff member fulfills the request; **for*** fields identify
 *   that employee (manager is the creator).
 */
export function ffResolveStaffDocumentOwnerStaffId(inboxItem) {
  if (!inboxItem) return "";
  const t = trimStr(inboxItem.type);
  const forStaff = trimStr(inboxItem.forStaffId);
  const created = trimStr(inboxItem.createdByStaffId);

  if (t === "document_upload") {
    const d = inboxItem.data || {};
    const explicit =
      trimStr(d.documentOwnerStaffId) ||
      trimStr(d.ownerStaffId) ||
      trimStr(inboxItem.documentOwnerStaffId);
    if (explicit) return explicit;
    if (created) return created;
    if (forStaff) return forStaff;
    return "";
  }
  if (t === "document_request") {
    if (forStaff) return forStaff;
    if (created) return created;
    return "";
  }
  if (forStaff) return forStaff;
  if (created) return created;
  return "";
}

/** Firebase uid of the staff document owner (for members/users lookup). */
function ffResolveStaffDocumentOwnerUidForFallback(inboxItem) {
  if (!inboxItem) return "";
  const t = trimStr(inboxItem.type);
  const forU = trimStr(inboxItem.forUid);
  const createdU = trimStr(inboxItem.createdByUid);
  if (t === "document_upload") {
    if (createdU) return createdU;
    return forU;
  }
  if (t === "document_request") {
    if (forU) return forU;
    return createdU;
  }
  return forU || createdU;
}

/** Resolve owner from `data.filePath` segment `salons/.../staff/{id}/documents/...` (uid or staff doc id). */
async function ffResolveStaffDocumentOwnerFromUploadPath(dbConn, salonId, inboxItem) {
  const t = trimStr(inboxItem?.type);
  if (t !== "document_upload") return "";
  const d = inboxItem.data || {};
  const p = trimStr(d.filePath || d.storagePath || "");
  const m = p.match(/^salons\/[^/]+\/staff\/([^/]+)\//);
  if (!m) return "";
  const seg = trimStr(m[1]);
  if (!seg) return "";
  const sid = trimStr(salonId);
  try {
    const stSnap = await getDoc(doc(dbConn, "salons", sid, "staff", seg));
    if (stSnap.exists()) return seg;
  } catch (e) {
    console.warn("[staff-documents] staff path segment lookup", e);
  }
  try {
    const mSnap = await getDoc(doc(dbConn, "salons", sid, "members", seg));
    if (mSnap.exists()) {
      const ms = trimStr(mSnap.data()?.staffId);
      if (ms) return ms;
    }
  } catch (e) {
    console.warn("[staff-documents] members path segment lookup", e);
  }
  try {
    const uSnap = await getDoc(doc(dbConn, "users", seg));
    if (uSnap.exists()) {
      const us = trimStr(uSnap.data()?.staffId);
      if (us) return us;
    }
  } catch (e) {
    console.warn("[staff-documents] users path segment lookup", e);
  }
  return "";
}

/**
 * Find `salons/{salonId}/staff/{docId}` where the row matches this Firebase uid (firebaseUid) or email.
 * Prefer this over `users.staffId` when those fields are stale or point at the wrong doc id.
 */
async function ffResolveStaffFirestoreIdByScan(dbConn, salonId, uid, emailHint) {
  const sid = trimStr(salonId);
  const u = trimStr(uid);
  if (!sid || !u) return "";
  let em = trimStr(emailHint).toLowerCase();
  if (!em) {
    try {
      const uSnap = await getDoc(doc(dbConn, "users", u));
      if (uSnap.exists()) em = String(uSnap.data()?.email || "").trim().toLowerCase();
    } catch (e) {
      console.warn("[staff-documents] scan: users email", e);
    }
  }
  try {
    const snap = await getDocs(collection(dbConn, "salons", sid, "staff"));
    for (const d of snap.docs) {
      const row = d.data() || {};
      const fid = trimStr(row.firebaseUid || row.firebaseAuthUid || row.authUid);
      if (fid && fid === u) return d.id;
      const uidOnRow = trimStr(row.uid || row.userUid);
      if (uidOnRow && uidOnRow === u) return d.id;
    }
    if (em) {
      for (const d of snap.docs) {
        const row = d.data() || {};
        const mail = String(row.email || "").trim().toLowerCase();
        if (mail && mail === em) return d.id;
      }
    }
  } catch (e) {
    console.warn("[staff-documents] scan staff collection", e);
  }
  return "";
}

/**
 * Same as {@link ffResolveStaffDocumentOwnerStaffId}, but when inbox fields are empty loads
 * `salons/{salonId}/members/{uid}` or `users/{uid}` to read `staffId` (technicians often lack
 * `forStaffId` on the inbox row).
 */
export async function ffResolveStaffDocumentOwnerStaffIdWithFallback(dbConn, salonId, inboxItem) {
  const t = trimStr(inboxItem?.type);
  // document_upload: Storage path is authoritative (salons/{sid}/staff/{ownerId}/documents/...).
  // Staging often has users.staffId / createdByStaffId out of sync with the Staff Members row;
  // preferring those fields first wrote the approved doc under the wrong staff id.
  if (t === "document_upload") {
    const fromPath = await ffResolveStaffDocumentOwnerFromUploadPath(dbConn, salonId, inboxItem);
    if (fromPath) {
      const direct = ffResolveStaffDocumentOwnerStaffId(inboxItem);
      if (direct && direct !== fromPath) {
        console.warn("[staff-documents] Owner staff id mismatch (using filePath segment)", {
          fromPath,
          direct,
        });
      }
      return fromPath;
    }
  }

  const direct = ffResolveStaffDocumentOwnerStaffId(inboxItem);
  if (direct) return direct;

  const fromPathFallback = await ffResolveStaffDocumentOwnerFromUploadPath(dbConn, salonId, inboxItem);
  if (fromPathFallback) return fromPathFallback;

  const uid = ffResolveStaffDocumentOwnerUidForFallback(inboxItem);
  const sid = trimStr(salonId);
  if (!uid || !sid) return "";

  const scanned = await ffResolveStaffFirestoreIdByScan(dbConn, sid, uid, "");
  if (scanned) return scanned;

  try {
    const mSnap = await getDoc(doc(dbConn, "salons", sid, "members", uid));
    if (mSnap.exists()) {
      const ms = trimStr(mSnap.data()?.staffId);
      if (ms) return ms;
    }
  } catch (e) {
    console.warn("[staff-documents] members staffId lookup failed", e);
  }
  try {
    const uSnap = await getDoc(doc(dbConn, "users", uid));
    if (uSnap.exists()) {
      const us = trimStr(uSnap.data()?.staffId);
      if (us) return us;
    }
  } catch (e) {
    console.warn("[staff-documents] users staffId lookup failed", e);
  }
  return "";
}


/**
 * Linked staff document id from inbox (top-level or nested in data).
 * Older shapes may only set data.documentId.
 */
export function ffResolveLinkedStaffDocumentId(inboxItem) {
  if (!inboxItem) return "";
  const d = inboxItem.data || {};
  return (
    trimStr(inboxItem.staffDocumentId) ||
    trimStr(inboxItem.documentId) ||
    trimStr(d.staffDocumentId) ||
    trimStr(d.documentId) ||
    ""
  );
}

function staffDocumentRef(dbConn, salonId, staffMemberId, documentId) {
  return doc(dbConn, "salons", trimStr(salonId), "staff", trimStr(staffMemberId), "documents", trimStr(documentId));
}

function buildPayloadFromInbox(inboxItem, inboxItemId, approverUid, existingStaffDocSnap) {
  const data = inboxItem.data || {};
  const reqType = trimStr(inboxItem.type);
  const docType = trimStr(data.documentType) || "Document";

  let title = "";
  let fileName = null;
  let storagePath = null;
  let expirationDate = null;

  if (reqType === "document_upload") {
    const fn = data.fileName != null ? String(data.fileName) : "";
    title = [docType, fn].filter(Boolean).join(" — ") || docType || "Uploaded document";
    fileName = fn || null;
    storagePath = data.filePath || data.storagePath || null;
    expirationDate = data.expirationDate || data.expiryDate || data.dueDate || null;
  } else if (reqType === "document_request") {
    const reason = trimStr(data.reason);
    const shortReason = reason.length > 120 ? `${reason.slice(0, 117)}…` : reason;
    title = shortReason ? `${docType} — ${shortReason}` : docType || "Document request";
    if (data.responseFilePath || data.responseFileUrl) {
      storagePath = data.responseFilePath || null;
      fileName =
        trimStr(data.responseFileName) ||
        (trimStr(data.responseFileUrl).split("/").pop() || "response") ||
        "response";
    }
    expirationDate = data.dueDate || data.expirationDate || null;
  } else {
    title = docType || "Document";
  }

  const prev = existingStaffDocSnap && existingStaffDocSnap.exists() ? existingStaffDocSnap.data() : {};
  const prevLife = trimStr(prev.lifecycleStatus).toLowerCase();
  const lifecycleStatus = prevLife === "archived" ? "archived" : "active";

  const base = {
    title: title || "Document",
    type: docType,
    fileName,
    storagePath,
    uploadedByUid: inboxItem.createdByUid || inboxItem.forUid || null,
    sourceInboxItemId: inboxItemId,
    approvalStatus: "approved",
    approvedBy: approverUid || null,
    approvedAt: serverTimestamp(),
    lifecycleStatus,
    updatedAt: serverTimestamp(),
  };
  if (expirationDate) {
    const parsed = parseExpirationForStaffDoc(expirationDate);
    base.expirationDate = parsed != null ? parsed : expirationDate;
  }

  return stripUndefined(base);
}

/**
 * Create or update salons/{salonId}/staff/{staffId}/documents/{documentId} when a manager approves
 * a document_request or document_upload inbox item.
 *
 * @returns {Promise<string|null>} document id to persist on the inbox item, or null if skipped (no staff id).
 */
export async function ffSyncStaffDocumentOnInboxApprove(dbConn, params) {
  const { salonId, inboxItemId, inboxItem, approverUid } = params || {};
  const sid = trimStr(salonId);
  const iid = trimStr(inboxItemId);
  if (!sid || !iid || !inboxItem) return null;

  const t = trimStr(inboxItem.type);
  if (t !== "document_request" && t !== "document_upload") return null;

  const ownerStaffId = await ffResolveStaffDocumentOwnerStaffIdWithFallback(dbConn, sid, inboxItem);
  if (!ownerStaffId) {
    console.warn("[staff-documents] Approve sync skipped: missing staff id on inbox item", iid);
    return null;
  }

  const linked = ffResolveLinkedStaffDocumentId(inboxItem);
  const documentId = linked || iid;

  const ref = staffDocumentRef(dbConn, sid, ownerStaffId, documentId);
  const existingSnap = await getDoc(ref);
  const isNew = !existingSnap.exists();
  const payload = buildPayloadFromInbox(inboxItem, iid, approverUid, existingSnap);
  if (isNew) {
    payload.createdAt = serverTimestamp();
  }
  await setDoc(ref, stripUndefined(payload), { merge: true });

  try {
    const runExpiryInbox = () =>
      import("./staff-doc-expiry-inbox.js?v=20260409_created_by_subject")
        .then((m) => {
          if (typeof m.runStaffDocExpiryInboxRemindersOnce === "function") {
            return m.runStaffDocExpiryInboxRemindersOnce();
          }
          return undefined;
        })
        .catch((e) => console.warn("[staff-documents] doc expiry inbox after approve", e));
    if (typeof window !== "undefined") {
      setTimeout(runExpiryInbox, 300);
      setTimeout(runExpiryInbox, 2200);
    }
  } catch (_) {}

  return documentId;
}

/**
 * Re-run Inbox → staff /documents sync for an already-approved document row.
 * Use when an older bug attached metadata to the wrong `staff/{id}` (Documents tab empty).
 * Console (logged-in manager): `ffResyncStaffDocumentFromInbox('SALON_ID','INBOX_ITEM_ID')`
 */
export async function ffResyncStaffDocumentFromInbox(dbConn, salonId, inboxItemId) {
  const sid = trimStr(salonId);
  const iid = trimStr(inboxItemId);
  if (!sid || !iid) return null;
  const iref = doc(dbConn, "salons", sid, "inboxItems", iid);
  const snap = await getDoc(iref);
  if (!snap.exists()) return null;
  const data = snap.data() || {};
  const t = trimStr(data.type);
  if (t !== "document_upload" && t !== "document_request") return null;
  if (String(data.status || "").trim() !== "approved") return null;
  const approver = auth?.currentUser?.uid ? String(auth.currentUser.uid) : null;
  return ffSyncStaffDocumentOnInboxApprove(dbConn, {
    salonId: sid,
    inboxItemId: iid,
    inboxItem: { id: iid, ...data },
    approverUid: approver,
  });
}

/**
 * On deny: only set approvalStatus on an existing linked staff document (never create one).
 */
export async function ffSyncStaffDocumentOnInboxReject(dbConn, params) {
  const { salonId, inboxItem } = params || {};
  const sid = trimStr(salonId);
  if (!sid || !inboxItem) return;

  const t = trimStr(inboxItem.type);
  if (t !== "document_request" && t !== "document_upload") return;

  const linked = ffResolveLinkedStaffDocumentId(inboxItem);
  if (!linked) return;

  const ownerStaffId = await ffResolveStaffDocumentOwnerStaffIdWithFallback(dbConn, sid, inboxItem);
  if (!ownerStaffId) {
    console.warn("[staff-documents] Reject sync skipped: missing staff id on inbox item");
    return;
  }

  const ref = staffDocumentRef(dbConn, sid, ownerStaffId, linked);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  await updateDoc(ref, {
    approvalStatus: "rejected",
    updatedAt: serverTimestamp(),
  });
}
