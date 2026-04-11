/**
 * Staff Documents (Phase 1) — read-only list from
 * salons/{salonId}/staff/{staffId}/documents/{documentId}
 *
 * Phase 2 — inbox approval sync helpers (used by inbox.js).
 */
import { getApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  deleteField,
  increment,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
import { db, auth, storage } from "./app.js?v=20260411_chat_reminder_attrfix";

// --- Phase 2: Inbox → staff /documents sync (approve / reject) ---

function trimStr(v) {
  return v == null ? "" : String(v).trim();
}

function stripUndefined(obj) {
  const out = {};
  Object.keys(obj).forEach((k) => {
    if (obj[k] !== undefined) out[k] = obj[k];
  });
  return out;
}

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
  const direct = ffResolveStaffDocumentOwnerStaffId(inboxItem);
  if (direct) return direct;

  const fromPath = await ffResolveStaffDocumentOwnerFromUploadPath(dbConn, salonId, inboxItem);
  if (fromPath) return fromPath;

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

function parseExpirationForStaffDoc(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw.toDate === "function") return raw;
  if (raw instanceof Timestamp) return raw;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(`${s.slice(0, 10)}T12:00:00`);
    if (!Number.isNaN(d.getTime())) return Timestamp.fromDate(d);
  }
  return null;
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
      import("./staff-doc-expiry-inbox.js?v=20260411_trigger_sync")
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

let _unsub = null;
let _mountedKey = "";
let _mountCtx = { salonId: "", staffId: "" };
/** After a successful send, ignore duplicate sends for the same doc briefly (double-click / dual handlers). */
let _ffExpiryNotifyDedupe = { key: "", at: 0 };
let _ffExpiryNotifyInFlight = false;
let _ffBoundContainer = null;
let _onDocActionClick = null;
/** @type {Array<Record<string, unknown>> | null} */
let _lastDocList = null;

/** Staff Member > Documents filter chip (Phase 9). Default "all". */
let _staffDocumentsFilter = "all";

const STAFF_DOC_FILTER_IDS = new Set([
  "all",
  "expired",
  "expiring_soon",
  "active",
  "archived",
]);

/** Phase 10: search query (raw); empty = no search filter. */
let _staffDocumentsSearchQuery = "";

let _onStaffDocSearchInput = null;

const _functions = getFunctions(getApp(), "us-central1");
let _getMediaDownloadUrlCallable = null;
function getMediaDownloadUrlCallable() {
  if (!_getMediaDownloadUrlCallable) {
    _getMediaDownloadUrlCallable = httpsCallable(_functions, "getMediaDownloadUrl");
  }
  return _getMediaDownloadUrlCallable;
}

/** Whole calendar days from local "today" to the expiration date (same clock as users see in the UI). */
function calendarDaysUntilExpiry(expirationMs) {
  const exp = new Date(expirationMs);
  const expDay = new Date(exp.getFullYear(), exp.getMonth(), exp.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((expDay.getTime() - today.getTime()) / 86400000);
}

/** Expired / expiring_soon (≤30d) / active — derived from expiration date only. */
export function ffComputeLifecycleFromExpiration(expirationRaw) {
  const d = toDateMaybe(expirationRaw);
  if (!d) return "active";
  const diff = calendarDaysUntilExpiry(d.getTime());
  if (diff < 0) return "expired";
  if (diff <= 30) return "expiring_soon";
  return "active";
}

function ffToast(msg, kind) {
  const text = String(msg ?? "");
  const isErr = kind === "error";
  const isInfo = kind === "info";
  const ch = typeof document !== "undefined" ? document.getElementById("chatToastContainer") : null;
  const pushToastEl = (t) => {
    if (isErr) {
      t.style.borderColor = "#fecaca";
      t.style.background = "#fef2f2";
    } else if (isInfo) {
      t.style.borderColor = "#bfdbfe";
      t.style.background = "#eff6ff";
    }
    const header = document.createElement("div");
    header.className = "chat-toast-header";
    const sender = document.createElement("div");
    sender.className = "chat-toast-sender";
    sender.textContent = "Documents";
    header.appendChild(sender);
    const preview = document.createElement("div");
    preview.className = "chat-toast-preview";
    preview.textContent = text;
    t.appendChild(header);
    t.appendChild(preview);
  };

  if (ch) {
    const t = document.createElement("div");
    t.className = "chat-toast";
    pushToastEl(t);
    ch.appendChild(t);
    setTimeout(() => {
      try {
        t.remove();
      } catch (_) {}
    }, isInfo ? 3500 : 6000);
  } else if (typeof document !== "undefined" && document.body) {
    const fb = document.createElement("div");
    fb.setAttribute("data-ff-staffdoc-toast", "1");
    fb.style.cssText =
      "position:fixed;left:50%;top:24px;transform:translateX(-50%);z-index:2147483647;max-width:min(92vw,420px);padding:12px 16px;border-radius:12px;font:600 14px system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,0.2);pointer-events:none;border:1px solid " +
      (isErr ? "#fecaca" : isInfo ? "#bfdbfe" : "#a7f3d0") +
      ";background:" +
      (isErr ? "#fef2f2" : isInfo ? "#eff6ff" : "#ecfdf5") +
      ";color:" +
      (isErr ? "#991b1b" : isInfo ? "#1e3a8a" : "#065f46") +
      ";";
    fb.textContent = text;
    try {
      document.body.appendChild(fb);
    } catch (_) {}
    setTimeout(() => {
      try {
        fb.remove();
      } catch (_) {}
    }, isInfo ? 3500 : 6000);
  } else if (typeof window.showToast === "function") {
    try {
      window.showToast(text, isErr ? 5500 : 4000);
    } catch (_) {}
  }
  if (isErr) console.warn("[staff-documents]", text);
  else console.log("[staff-documents]", text);
}

/**
 * Centered confirm dialog (matches app purple / white styling; avoids browser confirm()).
 * Resolves true if user confirms.
 */
function ffStaffDocumentsConfirm({ title, message, confirmLabel, cancelLabel = "Cancel" }) {
  return new Promise((resolve) => {
    const rid = `ffstaffdoc_confirm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const overlay = document.createElement("div");
    overlay.id = rid;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.style.cssText =
      "position:fixed;left:0;top:0;right:0;bottom:0;width:100%;min-height:100vh;min-height:100dvh;background:rgba(0,0,0,0.45);z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;overflow-y:auto;overflow-x:hidden;";
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:24px 26px;max-width:420px;width:100%;box-shadow:0 25px 50px -12px rgba(0,0,0,0.28);margin:auto;flex-shrink:0;">
        <div style="font-size:18px;font-weight:700;color:#111827;margin-bottom:10px;line-height:1.3;">${escapeHtml(title)}</div>
        <p style="margin:0 0 22px 0;font-size:14px;color:#4b5563;line-height:1.55;">${escapeHtml(message)}</p>
        <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;">
          <button type="button" data-ff-cancel style="padding:10px 18px;border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-weight:600;cursor:pointer;font-size:14px;font-family:inherit;">${escapeHtml(
            cancelLabel,
          )}</button>
          <button type="button" data-ff-ok style="padding:10px 18px;border-radius:10px;border:none;background:#7c3aed;color:#fff;font-weight:600;cursor:pointer;font-size:14px;font-family:inherit;box-shadow:0 1px 2px rgba(124,58,237,0.25);">${escapeHtml(
            confirmLabel,
          )}</button>
        </div>
      </div>`;
    const finish = (v) => {
      try {
        overlay.remove();
      } catch (_) {}
      document.removeEventListener("keydown", onKey);
      resolve(v);
    };
    const onKey = (ev) => {
      if (ev.key === "Escape") finish(false);
    };
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) finish(false);
    });
    overlay.querySelector("[data-ff-cancel]").onclick = () => finish(false);
    overlay.querySelector("[data-ff-ok]").onclick = () => finish(true);
    document.body.appendChild(overlay);
  });
}

function closePopupIfOpen(w) {
  try {
    if (w && !w.closed) w.close();
  } catch (_) {}
}

/** Open a blank tab synchronously (preserves user gesture); then assign URL after async work. */
function openBlankTabForLaterNavigation() {
  try {
    const w = window.open("about:blank", "_blank");
    if (w) {
      try {
        w.opener = null;
      } catch (_) {}
    }
    return w;
  } catch (_) {
    return null;
  }
}

function assignUrlToTabOrOpenFresh(url, tab) {
  if (!url) return false;
  if (tab && !tab.closed) {
    try {
      tab.location.href = url;
      return true;
    } catch (_) {
      closePopupIfOpen(tab);
    }
  }
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}

/** Small modal: optional YYYY-MM-DD expiration + file picker. Resolves { file, expirationYmd } or null. */
function ffOpenReplaceDocumentModal() {
  return new Promise((resolve) => {
    const rid = `ffrep_${Date.now()}`;
    const overlay = document.createElement("div");
    overlay.id = rid;
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:1000000;display:flex;align-items:center;justify-content:center;padding:16px;";
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:20px;max-width:420px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,0.2);">
        <div style="font-weight:700;font-size:15px;margin-bottom:4px;color:#111827;">Replace document file</div>
        <p style="margin:0 0 14px;font-size:12px;color:#6b7280;line-height:1.45;">Upload a new file for this document. The same record is updated — no duplicate document.</p>
        <label style="display:block;font-size:12px;color:#6b7280;margin-bottom:4px;">New expiration date (optional)</label>
        <input type="date" id="${rid}_exp" style="width:100%;padding:8px;margin-bottom:12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;" />
        <label style="display:block;font-size:12px;color:#6b7280;margin-bottom:4px;">File (max 10 MB)</label>
        <input type="file" id="${rid}_file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif" style="width:100%;margin-bottom:16px;font-size:13px;" />
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
          <button type="button" id="${rid}_cancel" style="padding:8px 14px;border:1px solid #d1d5db;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;">Cancel</button>
          <button type="button" id="${rid}_ok" style="padding:8px 14px;border:none;border-radius:8px;background:#7c3aed;color:#fff;font-weight:600;cursor:pointer;font-size:13px;">Upload</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const cleanup = () => {
      try {
        overlay.remove();
      } catch (_) {}
    };
    overlay.querySelector(`#${rid}_cancel`).onclick = () => {
      cleanup();
      resolve(null);
    };
    overlay.querySelector(`#${rid}_ok`).onclick = () => {
      const f = overlay.querySelector(`#${rid}_file`)?.files?.[0];
      if (!f) {
        ffToast("Choose a file.", "error");
        return;
      }
      if (f.size > 10 * 1024 * 1024) {
        ffToast("File must be under 10 MB.", "error");
        return;
      }
      const expVal = (overlay.querySelector(`#${rid}_exp`)?.value || "").trim();
      cleanup();
      resolve({ file: f, expirationYmd: expVal || null });
    };
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) {
        cleanup();
        resolve(null);
      }
    });
  });
}

async function ffReplaceStaffDocumentVersion({ salonId, staffId, docId, file, expirationYmd }) {
  const ref = doc(db, "salons", salonId, "staff", staffId, "documents", docId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    ffToast("Document not found.", "error");
    return;
  }
  const prev = snap.data() || {};
  if (String(prev.lifecycleStatus || "").toLowerCase() === "archived") {
    ffToast("Unarchive this document before replacing the file.", "error");
    return;
  }
  const life = String(prev.lifecycleStatus || "").toLowerCase();
  if (life !== "expired" && life !== "expiring_soon") {
    ffToast("Replace is only available for expired or expiring-soon documents.", "error");
    return;
  }
  if (!auth.currentUser) {
    ffToast("Sign in required.", "error");
    return;
  }

  const prevFileName = prev.fileName != null ? String(prev.fileName) : "";
  const prevStoragePath = trimStr(prev.storagePath || prev.filePath || "");

  const yyyyMm = new Date().toISOString().slice(0, 7);
  const fileId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const safeName = (file.name || "file").replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 80);
  const newPath = `salons/${salonId}/staff/${staffId}/documents/${docId}/versions/${yyyyMm}/${fileId}_${safeName}`;

  ffToast("Uploading file…", "info");
  const fileRef = storageRef(storage, newPath);
  await uploadBytes(fileRef, file);

  let nextExpiration = prev.expirationDate;
  let newExpParsed = null;
  if (expirationYmd && /^\d{4}-\d{2}-\d{2}$/.test(expirationYmd)) {
    newExpParsed = parseExpirationForStaffDoc(expirationYmd);
    if (newExpParsed) nextExpiration = newExpParsed;
  }

  const newLifecycle = ffComputeLifecycleFromExpiration(nextExpiration);

  const payload = {
    fileName: file.name,
    storagePath: newPath,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser.uid,
    approvalStatus: "approved",
    lifecycleStatus: newLifecycle,
    thirtyDayReminderSentAt: deleteField(),
    expiredReminderSentAt: deleteField(),
    fileUrl: deleteField(),
    versionCount: increment(1),
  };
  if (prevFileName) payload.previousFileName = prevFileName;
  if (prevStoragePath) payload.previousStoragePath = prevStoragePath;
  if (newExpParsed) payload.expirationDate = newExpParsed;

  await updateDoc(ref, payload);
  ffToast("Document replaced successfully.", "success");
}

/** Clicks on button *text* can yield a Text node (no .closest) — normalize to an Element. */
function ffStaffDocClickTargetEl(e) {
  const t = e && e.target;
  if (!t) return null;
  if (t.nodeType === 1) return /** @type {Element} */ (t);
  if (t.nodeType === 3 && t.parentElement) return t.parentElement;
  return null;
}

async function ffHandleStaffDocumentActionClick(e) {
  const el = ffStaffDocClickTargetEl(e);
  const filterBtn = el && el.closest && el.closest("button[data-ff-doc-filter]");
  if (filterBtn && !filterBtn.disabled) {
    e.preventDefault();
    e.stopPropagation();
    const id = filterBtn.getAttribute("data-ff-doc-filter");
    if (id && STAFF_DOC_FILTER_IDS.has(id) && _staffDocumentsFilter !== id) {
      _staffDocumentsFilter = id;
      if (_lastDocList !== null && _ffBoundContainer) {
        renderListIntoContainer(_ffBoundContainer, _lastDocList);
      }
    }
    return;
  }

  const clearSearchBtn = el && el.closest && el.closest("button[data-ff-doc-search-clear]");
  if (clearSearchBtn && !clearSearchBtn.disabled) {
    e.preventDefault();
    e.stopPropagation();
    if (_staffDocumentsSearchQuery !== "") {
      _staffDocumentsSearchQuery = "";
      if (_lastDocList !== null && _ffBoundContainer) {
        renderListIntoContainer(_ffBoundContainer, _lastDocList);
        const inp = _ffBoundContainer.querySelector("input[data-ff-doc-search]");
        if (inp) inp.focus();
      }
    }
    return;
  }

  const btn = el && el.closest && el.closest("button[data-ff-doc-action]");
  if (!btn || btn.disabled) return;
  e.preventDefault();
  e.stopPropagation();
  const action = btn.getAttribute("data-ff-doc-action");
  const docId = btn.getAttribute("data-doc-id");
  const { salonId, staffId } = _mountCtx;
  if (!salonId || !staffId || !docId) {
    ffToast("Missing context. Refresh the page.", "error");
    return;
  }

  const ref = doc(db, "salons", salonId, "staff", staffId, "documents", docId);

  if (action === "view") {
    const tab = openBlankTabForLaterNavigation();
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        closePopupIfOpen(tab);
        ffToast("Document not found.", "error");
        return;
      }
      const d = snap.data() || {};
      const storagePath = trimStr(d.storagePath || d.filePath || "");
      const fileUrl = trimStr(d.fileUrl || "");
      const fileNameHint = trimStr(d.fileName || "");
      // Inbox-approved docs usually have a Firebase download URL; open before Cloud Function path.
      if (fileUrl.startsWith("https://") || fileUrl.startsWith("http://")) {
        assignUrlToTabOrOpenFresh(fileUrl, tab);
        return;
      }
      if (storagePath) {
        if (!auth.currentUser) {
          closePopupIfOpen(tab);
          ffToast("Sign in to view files.", "error");
          return;
        }
        let url = "";
        try {
          url = await getDownloadURL(storageRef(storage, storagePath));
        } catch (gerr) {
          console.warn("[staff-documents] getDownloadURL", gerr);
        }
        if (!url) {
          try {
            const fn = getMediaDownloadUrlCallable();
            const res = await fn({ storagePath, fileName: fileNameHint });
            url = res?.data?.url || "";
          } catch (cerr) {
            console.warn("[staff-documents] getMediaDownloadUrl", cerr);
          }
        }
        if (url) {
          assignUrlToTabOrOpenFresh(url, tab);
        } else {
          closePopupIfOpen(tab);
          ffToast("Could not open file.", "error");
        }
      } else {
        closePopupIfOpen(tab);
        ffToast("No file is attached to this document.", "error");
      }
    } catch (err) {
      closePopupIfOpen(tab);
      console.warn("[staff-documents] view", err);
      ffToast(String(err?.message || err || "Could not open file."), "error");
    }
    return;
  }

  if (action === "archive") {
    const ok = await ffStaffDocumentsConfirm({
      title: "Archive this document?",
      message:
        "It will move to Archived. You can restore it later. Nothing is permanently deleted from storage.",
      confirmLabel: "Archive",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    if (!auth.currentUser) {
      ffToast("Sign in required.", "error");
      return;
    }
    try {
      await updateDoc(ref, {
        lifecycleStatus: "archived",
        archivedAt: serverTimestamp(),
        archivedBy: auth.currentUser.uid,
        updatedAt: serverTimestamp(),
      });
      ffToast("Document archived.", "success");
    } catch (err) {
      console.warn("[staff-documents] archive", err);
      ffToast(String(err?.message || err || "Could not archive."), "error");
    }
    return;
  }

  if (action === "unarchive") {
    const okRestore = await ffStaffDocumentsConfirm({
      title: "Restore this document?",
      message: "It will return to your active documents list with the correct expiry status.",
      confirmLabel: "Restore",
      cancelLabel: "Cancel",
    });
    if (!okRestore) return;
    if (!auth.currentUser) {
      ffToast("Sign in required.", "error");
      return;
    }
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        ffToast("Document not found.", "error");
        return;
      }
      const d = snap.data() || {};
      const nextLife = ffComputeLifecycleFromExpiration(d.expirationDate);
      await updateDoc(ref, {
        lifecycleStatus: nextLife,
        archivedAt: deleteField(),
        archivedBy: deleteField(),
        updatedAt: serverTimestamp(),
      });
      ffToast("Document restored.", "success");
    } catch (err) {
      console.warn("[staff-documents] unarchive", err);
      ffToast(String(err?.message || err || "Could not restore."), "error");
    }
    return;
  }

  if (action === "replace") {
    if (!auth.currentUser) {
      ffToast("Sign in required.", "error");
      return;
    }
    try {
      const choice = await ffOpenReplaceDocumentModal();
      if (!choice || !choice.file) return;
      await ffReplaceStaffDocumentVersion({
        salonId,
        staffId,
        docId,
        file: choice.file,
        expirationYmd: choice.expirationYmd,
      });
    } catch (err) {
      console.warn("[staff-documents] replace", err);
      ffToast(String(err?.message || err || "Replace failed."), "error");
    }
    return;
  }

  if (action === "expiry_chat_notify") {
    try {
      await ffRunExpiryChatNotify(docId);
    } catch (_) {
      /* errors already surfaced via ffToast + console */
    }
    return;
  }
}

/** Align with media-upload / schedule: managers, assistant managers, front desk, admins, owners. */
function ffUserCanSendExpiryChatReminder(roleLc) {
  return ["manager", "admin", "owner", "front_desk", "assistant_manager"].includes(roleLc);
}

function ffStaffDocAbortWithToast(msg) {
  ffToast(msg, "error");
  const e = new Error(String(msg));
  e.ffToastShown = true;
  return e;
}

/**
 * Firebase uid for chat: staff row may omit firebaseUid while salons/{sid}/members/{uid}
 * has staffId (written when the user opens Inbox / profile).
 */
async function ffResolveRecipientUidForChat(dbConn, salonId, staffFirestoreId, srow) {
  let uid = trimStr(srow.firebaseUid || srow.firebaseAuthUid || srow.authUid);
  if (uid) return uid;
  const sid = trimStr(salonId);
  const stid = trimStr(staffFirestoreId);
  if (!sid || !stid) return "";
  try {
    const q = query(
      collection(dbConn, "salons", sid, "members"),
      where("staffId", "==", stid),
      limit(3),
    );
    const snap = await getDocs(q);
    if (snap.empty) return "";
    if (snap.docs.length === 1) return trimStr(snap.docs[0].id);
    const byEmail = trimStr(srow.email || "").toLowerCase();
    if (byEmail) {
      for (const d of snap.docs) {
        const em = String(d.data()?.email || "")
          .trim()
          .toLowerCase();
        if (em && em === byEmail) return trimStr(d.id);
      }
    }
    return trimStr(snap.docs[0].id);
  } catch (e) {
    console.warn("[staff-documents] members lookup for recipient uid", e);
    return "";
  }
}

/**
 * Sends a 1:1 chat message to the staff member (Firebase uid on staff doc) reminding them
 * their document is expiring soon and to upload via Inbox.
 */
async function ffSendExpiryChatReminderFromStaffDoc({ salonId, staffId, docId }) {
  const sid = trimStr(salonId);
  const stid = trimStr(staffId);
  const did = trimStr(docId);
  const senderUid = auth.currentUser?.uid;
  if (!sid || !stid || !did || !senderUid) {
    throw ffStaffDocAbortWithToast("Missing context.");
  }

  const userSnap = await getDoc(doc(db, "users", senderUid));
  const role = String(userSnap.data()?.role || "").toLowerCase();
  if (!ffUserCanSendExpiryChatReminder(role)) {
    throw ffStaffDocAbortWithToast("Only managers can send this reminder.");
  }

  const staffSnap = await getDoc(doc(db, "salons", sid, "staff", stid));
  if (!staffSnap.exists()) {
    throw ffStaffDocAbortWithToast("Staff member not found.");
  }
  const srow = staffSnap.data() || {};
  let recipientUid = await ffResolveRecipientUidForChat(db, sid, stid, srow);
  recipientUid = trimStr(recipientUid);
  const recipientName = trimStr(srow.name) || "Staff";
  if (!recipientUid) {
    throw ffStaffDocAbortWithToast(
      "This person has not linked their login yet. They must sign in once before you can message them in chat.",
    );
  }
  if (recipientUid === senderUid) {
    throw ffStaffDocAbortWithToast("You cannot send this reminder to yourself.");
  }

  const docSnap = await getDoc(doc(db, "salons", sid, "staff", stid, "documents", did));
  if (!docSnap.exists()) {
    throw ffStaffDocAbortWithToast("Document not found.");
  }
  const d = docSnap.data() || {};
  const docType = trimStr(d.type) || "document";
  const expDate = toDateMaybe(d.expirationDate);
  const daysUntil = expDate ? calendarDaysUntilExpiry(expDate.getTime()) : 0;
  const dayLabel = daysUntil === 1 ? "day" : "days";
  const title = `${docType} — expiring soon`;
  const message = `Your ${docType} is expiring in ${daysUntil} ${dayLabel}. Please upload a new version through Inbox (Requests → Upload a Document).`;

  const senderName =
    trimStr(userSnap.data()?.name || userSnap.data()?.displayName) || "Manager";
  const senderRole = trimStr(userSnap.data()?.role) || "";

  // Same shape as chat.js template sends — Firestore rules allow templateId+title (and message body).
  const STAFF_DOC_EXPIRY_TEMPLATE_ID = "ff_staff_doc_expiry_reminder";

  const convId = [senderUid, recipientUid].sort().join("__");
  const convRef = doc(db, `salons/${sid}/conversations`, convId);
  const msgRef = doc(collection(db, `salons/${sid}/conversations/${convId}/messages`));

  // Security rules evaluate each batch op against DB state *before* the batch runs.
  // Message create uses get(conversation).participants — so the conversation doc must
  // exist in a prior committed write, not in the same batch as the first message.
  const convSnap = await getDoc(convRef);
  if (!convSnap.exists()) {
    await setDoc(
      convRef,
      { participants: [senderUid, recipientUid].sort(), createdAt: serverTimestamp() },
      { merge: true },
    );
  }

  const batch = writeBatch(db);
  batch.set(msgRef, {
    templateId: STAFF_DOC_EXPIRY_TEMPLATE_ID,
    senderUid,
    senderName: String(senderName),
    senderRole: String(senderRole),
    recipientUid,
    recipientName: String(recipientName),
    sentAt: serverTimestamp(),
    readBy: [senderUid],
    title: String(title),
    message: String(message),
  });
  batch.set(
    convRef,
    {
      lastMessageAt: serverTimestamp(),
      lastMessageAtMs: Date.now(),
      lastTitle: title,
      lastMessage: message,
      lastSenderUid: senderUid,
      lastSenderName: senderName,
      lastSenderRole: senderRole,
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now(),
      unreadFor: { [recipientUid]: increment(1) },
    },
    { merge: true },
  );
  await batch.commit();
  ffToast("Chat reminder sent.", "success");
}

async function ffRunExpiryChatNotify(docId) {
  const did = trimStr(docId);
  const { salonId: sid0, staffId: st0 } = _mountCtx;
  const dk = `${sid0}|${st0}|${did}`;
  const now0 = Date.now();
  if (dk === _ffExpiryNotifyDedupe.key && now0 - _ffExpiryNotifyDedupe.at < 1500) {
    ffToast("Reminder just sent. Try again in a moment.", "info");
    return;
  }
  if (_ffExpiryNotifyInFlight) {
    ffToast("Still sending the previous reminder…", "info");
    return;
  }
  // Set immediately after checks — otherwise two parallel calls can both pass the guard and send twice.
  _ffExpiryNotifyInFlight = true;
  try {
    ffToast("Sending reminder…", "info");
    if (!auth.currentUser) {
      ffToast("Sign in required.", "error");
      return;
    }
    const { salonId, staffId } = _mountCtx;
    if (!salonId || !staffId || !did) {
      ffToast("Missing context. Refresh the page.", "error");
      return;
    }

    await ffSendExpiryChatReminderFromStaffDoc({ salonId, staffId, docId: did });
    _ffExpiryNotifyDedupe = { key: dk, at: Date.now() };
    console.log("[staff-documents] Chat reminder flow finished (check toast + Chat).");
  } catch (err) {
    console.warn("[staff-documents] expiry_chat_notify", err);
    if (!err?.ffToastShown) {
      const code = String(err?.code || "");
      const hint =
        code === "permission-denied"
          ? "Permission denied (chat). If this persists after refresh, contact support."
          : String(err?.message || err || "Could not send chat message.");
      ffToast(hint, "error");
    }
  } finally {
    _ffExpiryNotifyInFlight = false;
  }
}

/** Run the same expiry chat reminder as Staff → Documents, with explicit salon/staff (e.g. Inbox alert modal). */
export async function ffSendExpiryChatReminderForStaffDocContext({ salonId, staffId, docId }) {
  const sid = trimStr(salonId);
  const stid = trimStr(staffId);
  const did = trimStr(docId);
  const prevCtx = _mountCtx;
  try {
    _mountCtx = { salonId: sid, staffId: stid };
    await ffRunExpiryChatNotify(did);
  } finally {
    _mountCtx = prevCtx;
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Double-quoted HTML attribute escape (e.g. href). */
function escapeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function toDateMaybe(v) {
  if (v == null) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function formatWhen(v) {
  const d = toDateMaybe(v);
  if (!d) return "—";
  try {
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch (_) {
    return d.toISOString();
  }
}

function formatDay(v) {
  const d = toDateMaybe(v);
  if (!d) return "—";
  try {
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch (_) {
    return "—";
  }
}

/** Display line for document title when missing or blank. */
function formatDocumentTitle(raw) {
  const s = raw != null ? String(raw).trim() : "";
  return s ? s : "Untitled document";
}

function formatApprovalLabel(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s || s === "—") return "—";
  const map = { pending: "Pending", approved: "Approved", rejected: "Rejected" };
  return map[s] || String(raw).trim();
}

function formatLifecycleLabel(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s || s === "—") return "—";
  const map = {
    active: "Active",
    archived: "Archived",
    expired: "Expired",
    expiring_soon: "Expiring soon",
  };
  return map[s] || String(raw).trim();
}

/** Unified empty / no-results copy in the Documents panel. */
function staffDocsEmptyMessageHtml(message) {
  return `<div class="ff-staff-doc-empty" style="margin:0;font-size:13px;line-height:1.45;color:#6b7280;text-align:center;padding:28px 16px;min-height:72px;box-sizing:border-box;">${escapeHtml(message)}</div>`;
}

function expiryBadgeState(expirationRaw) {
  const exp = toDateMaybe(expirationRaw);
  if (!exp) return null;
  const t = ffComputeLifecycleFromExpiration(expirationRaw);
  if (t === "expired") return "expired";
  if (t === "expiring_soon") return "expiring_soon";
  return null;
}

function badgeStyle(kind) {
  const map = {
    pending: {
      bg: "#fffbeb",
      color: "#a16207",
      label: "Pending",
      border: "1px solid #fcd34d",
      weight: "800",
    },
    approved: { bg: "#d1fae5", color: "#065f46", label: "Approved", border: "1px solid #a7f3d0" },
    rejected: { bg: "#fee2e2", color: "#991b1b", label: "Rejected", border: "1px solid #fecaca" },
    expiring_soon: {
      bg: "#ffedd5",
      color: "#c2410c",
      label: "Expiring soon",
      border: "1px solid #fdba74",
      weight: "700",
    },
    expired: {
      bg: "#fecaca",
      color: "#7f1d1d",
      label: "Expired",
      border: "1px solid #f87171",
      weight: "800",
    },
    archived: { bg: "#f3f4f6", color: "#6b7280", label: "Archived", border: "1px solid #e5e7eb", weight: "600" },
  };
  return map[kind] || {
    bg: "#e5e7eb",
    color: "#374151",
    label: String(kind),
    border: "1px solid #d1d5db",
    weight: "700",
  };
}

function badgeHtml(kind) {
  const s = badgeStyle(kind);
  const w = s.weight || "700";
  const b = s.border || "1px solid transparent";
  return `<span style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:10px;font-weight:${w};letter-spacing:0.02em;background:${s.bg};color:${s.color};border:${b};">${escapeHtml(s.label)}</span>`;
}

function groupDocument(doc) {
  const lifecycle = String(doc.lifecycleStatus || "").toLowerCase();
  if (lifecycle === "archived") return "archived";
  const approval = String(doc.approvalStatus || "").toLowerCase();
  if (approval === "pending") return "pending_review";
  return "active";
}

/** Lifecycle tier for documents in the main (non-archived) list. */
function tierForActiveSectionDoc(doc) {
  if (doc.expirationDate != null) {
    return ffComputeLifecycleFromExpiration(doc.expirationDate);
  }
  const ls = String(doc.lifecycleStatus || "").toLowerCase();
  if (ls === "expired" || ls === "expiring_soon" || ls === "active") return ls;
  return "active";
}

function docTimeMs(v) {
  const d = toDateMaybe(v);
  return d ? d.getTime() : null;
}

/**
 * Active section: expired → expiring_soon → active; within each tier by expiration urgency;
 * no expiration → createdAt descending.
 */
function sortActiveDocuments(list) {
  const tierRank = { expired: 0, expiring_soon: 1, active: 2 };
  function createdDesc(a, b) {
    const ca = docTimeMs(a.createdAt) ?? 0;
    const cb = docTimeMs(b.createdAt) ?? 0;
    return cb - ca;
  }
  return list.slice().sort((a, b) => {
    const ta = tierRank[tierForActiveSectionDoc(a)] ?? 2;
    const tb = tierRank[tierForActiveSectionDoc(b)] ?? 2;
    if (ta !== tb) return ta - tb;
    const tier = tierForActiveSectionDoc(a);
    const aExp = docTimeMs(a.expirationDate);
    const bExp = docTimeMs(b.expirationDate);
    if (aExp != null && bExp != null) {
      if (tier === "expired") {
        const cmp = bExp - aExp;
        return cmp !== 0 ? cmp : createdDesc(a, b);
      }
      const cmp = aExp - bExp;
      return cmp !== 0 ? cmp : createdDesc(a, b);
    }
    if (aExp != null && bExp == null) return -1;
    if (aExp == null && bExp != null) return 1;
    return createdDesc(a, b);
  });
}

/** Archived: newest archivedAt first; fallback updatedAt then createdAt. */
function sortArchivedDocuments(list) {
  return list.slice().sort((a, b) => {
    const ta = docTimeMs(a.archivedAt) ?? docTimeMs(a.updatedAt) ?? docTimeMs(a.createdAt) ?? 0;
    const tb = docTimeMs(b.archivedAt) ?? docTimeMs(b.updatedAt) ?? docTimeMs(b.createdAt) ?? 0;
    return tb - ta;
  });
}

function renderActiveSubheader(title, isFirst) {
  const mt = isFirst ? "0" : "14px";
  return `<h5 style="margin:${mt} 0 8px 0;font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(title)}</h5>`;
}

function renderActiveSectionWithSubheaders(sortedActive) {
  if (!sortedActive.length) return "";
  const expired = [];
  const expiring = [];
  const normal = [];
  sortedActive.forEach((d) => {
    const t = tierForActiveSectionDoc(d);
    if (t === "expired") expired.push(d);
    else if (t === "expiring_soon") expiring.push(d);
    else normal.push(d);
  });
  let html = "";
  let first = true;
  if (expired.length) {
    html += renderActiveSubheader("Expired", first) + expired.map(renderDocumentCard).join("");
    first = false;
  }
  if (expiring.length) {
    html += renderActiveSubheader("Expiring Soon", first) + expiring.map(renderDocumentCard).join("");
    first = false;
  }
  if (normal.length) {
    if (expired.length || expiring.length) {
      html += renderActiveSubheader("Active", first) + normal.map(renderDocumentCard).join("");
    } else {
      html += normal.map(renderDocumentCard).join("");
    }
  }
  return html;
}

/** Bucket for filters/counts: archived → pending → else derive from expiration when present. */
function bucketForSummary(doc) {
  const life = String(doc.lifecycleStatus || "").toLowerCase();
  if (life === "archived") return "archived";
  const approval = String(doc.approvalStatus || "").toLowerCase();
  if (approval === "pending") return "pending";
  if (doc.expirationDate != null) {
    return ffComputeLifecycleFromExpiration(doc.expirationDate);
  }
  const ls = String(doc.lifecycleStatus || "").toLowerCase();
  if (ls === "expired" || ls === "expiring_soon" || ls === "active") return ls;
  return "active";
}

/** Phase 9: filter list by chip id (uses groupDocument + bucketForSummary). */
function filterDocumentsByChip(docs, chip) {
  if (chip === "all") return docs.slice();
  if (chip === "archived") return docs.filter((d) => groupDocument(d) === "archived");
  if (chip === "expired") return docs.filter((d) => bucketForSummary(d) === "expired");
  if (chip === "expiring_soon") return docs.filter((d) => bucketForSummary(d) === "expiring_soon");
  if (chip === "active") {
    return docs.filter((d) => {
      const b = bucketForSummary(d);
      return b === "active" || b === "pending";
    });
  }
  return docs.slice();
}

function countForChipId(list, chipId) {
  if (chipId === "all") return list.length;
  return filterDocumentsByChip(list, chipId).length;
}

/** Phase 10: trim + collapse spaces; empty string = no search. */
function normalizeStaffDocSearch(q) {
  return String(q ?? "").trim().replace(/\s+/g, " ");
}

/** Case-insensitive partial match on title, type, fileName (missing fields safe). */
function docMatchesSearch(doc, qNorm) {
  if (!qNorm) return true;
  const n = qNorm.toLowerCase();
  const parts = [doc.title, doc.type, doc.fileName].map((x) =>
    x != null ? String(x).toLowerCase() : ""
  );
  return parts.some((p) => p.includes(n));
}

/** Phase 8 sort rules applied to a single-filter result set. */
function sortDocumentsForFilterChip(docs, chip) {
  if (chip === "archived") return sortArchivedDocuments(docs);
  if (chip === "expired" || chip === "expiring_soon" || chip === "active") {
    return sortActiveDocuments(docs);
  }
  return docs.slice();
}

function renderFilteredSingleSection(docs, chip) {
  const sorted = sortDocumentsForFilterChip(docs, chip);
  return sorted.map(renderDocumentCard).join("");
}

const STAFF_DOC_FILTER_CHIPS = [
  { id: "all", label: "All" },
  { id: "expired", label: "Expired" },
  { id: "expiring_soon", label: "Expiring Soon" },
  { id: "active", label: "Active" },
  { id: "archived", label: "Archived" },
];

function renderFilterChipsHtml(currentFilter, list) {
  const common =
    "font-size:11px;line-height:1.2;min-height:30px;padding:4px 11px;border-radius:999px;cursor:pointer;font-weight:600;font-family:inherit;box-sizing:border-box;";
  const ringSel = "box-shadow:0 0 0 2px rgba(124,58,237,0.45);";
  const palette = {
    all: {
      base: "border:1px solid #e5e7eb;background:#fff;color:#374151;",
      sel: "border:1px solid #7c3aed;background:#ede9fe;color:#5b21b6;" + ringSel,
    },
    expired: {
      base: "border:1px solid #f87171;background:#fecaca;color:#7f1d1d;",
      sel: "border:1px solid #7c3aed;background:#fecaca;color:#7f1d1d;" + ringSel,
    },
    expiring_soon: {
      base: "border:1px solid #fdba74;background:#ffedd5;color:#c2410c;",
      sel: "border:1px solid #7c3aed;background:#ffedd5;color:#c2410c;" + ringSel,
    },
    active: {
      base: "border:1px solid #a7f3d0;background:#d1fae5;color:#065f46;",
      sel: "border:1px solid #7c3aed;background:#d1fae5;color:#065f46;" + ringSel,
    },
    archived: {
      base: "border:1px solid #e5e7eb;background:#f3f4f6;color:#6b7280;",
      sel: "border:1px solid #7c3aed;background:#f3f4f6;color:#4b5563;" + ringSel,
    },
  };
  return STAFF_DOC_FILTER_CHIPS.map((c) => {
    const n = countForChipId(list, c.id);
    const isSel = currentFilter === c.id;
    const pal = palette[c.id] || palette.all;
    const style = common + (isSel ? pal.sel : pal.base);
    return `<button type="button" data-ff-doc-filter="${escapeHtml(c.id)}" style="${style}">${escapeHtml(c.label)} <span style="opacity:0.88;font-weight:700;">(${n})</span></button>`;
  }).join("");
}

function renderSearchRowHtml() {
  const v = escapeHtml(_staffDocumentsSearchQuery);
  return `<div style="display:flex;align-items:stretch;gap:8px;">
  <input type="search" data-ff-doc-search placeholder="Search documents" value="${v}" autocomplete="off" style="flex:1;min-width:0;min-height:34px;padding:7px 11px;font-size:12px;border:1px solid #e5e7eb;border-radius:8px;box-sizing:border-box;font-family:inherit;color:#111827;background:#fff;" />
  <button type="button" data-ff-doc-search-clear title="Clear search" aria-label="Clear search" style="min-height:34px;padding:0 12px;font-size:11px;font-weight:600;border:1px solid #e5e7eb;border-radius:8px;background:#fff;color:#374151;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0;">Clear</button>
</div>`;
}

function renderListContentBody(list) {
  if (!STAFF_DOC_FILTER_IDS.has(_staffDocumentsFilter)) {
    _staffDocumentsFilter = "all";
  }
  const f = _staffDocumentsFilter || "all";
  const q = normalizeStaffDocSearch(_staffDocumentsSearchQuery);
  const chips = renderFilterChipsHtml(f, list);
  const searchRow = renderSearchRowHtml();
  const chipsWrap = `<div class="ff-staff-doc-filters" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;">${chips}</div>`;
  const searchWrap = `<div style="margin-top:10px;">${searchRow}</div>`;
  const head = `<div class="ff-staff-doc-toolbar" style="margin:0 0 16px 0;padding-bottom:14px;border-bottom:1px solid #f3f4f6;">${chipsWrap}${searchWrap}</div>`;

  const afterChip = filterDocumentsByChip(list, f);
  const afterSearch = q ? afterChip.filter((d) => docMatchesSearch(d, q)) : afterChip;

  if (afterChip.length === 0) {
    return head + staffDocsEmptyMessageHtml("No documents match this filter.");
  }

  if (afterSearch.length === 0) {
    const msg =
      f !== "all" && q
        ? "No documents match this filter and search."
        : "No documents match this search.";
    return head + staffDocsEmptyMessageHtml(msg);
  }

  if (f === "all" && !q) {
    return head + renderGrouped(list);
  }
  if (f === "all" && q) {
    return head + renderGrouped(afterSearch);
  }
  return head + renderFilteredSingleSection(afterSearch, f);
}

function ensureStaffDocSearchListeners(container) {
  if (!container || container.__ffStaffSearchBound) return;
  container.__ffStaffSearchBound = true;
  if (!_onStaffDocSearchInput) {
    _onStaffDocSearchInput = function (e) {
      const t = e.target && e.target.closest && e.target.closest("input[data-ff-doc-search]");
      if (!t) return;
      _staffDocumentsSearchQuery = t.value;
      if (_lastDocList !== null && _ffBoundContainer) {
        renderListIntoContainer(_ffBoundContainer, _lastDocList);
      }
    };
  }
  container.addEventListener("input", _onStaffDocSearchInput);
}

/** Direct handler on the button — does not rely on bubbling to the documents container. */
function wireStaffDocExpiryChatButtons(container) {
  if (!container || !container.querySelectorAll) return;
  container.querySelectorAll('button[data-ff-doc-action="expiry_chat_notify"]').forEach((btn) => {
    btn.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void ffRunExpiryChatNotify(btn.getAttribute("data-doc-id"));
    };
  });
}

function renderListIntoContainer(container, list) {
  if (!container) return;
  const active = document.activeElement;
  const wasSearch =
    active &&
    active.getAttribute &&
    active.getAttribute("data-ff-doc-search") !== null &&
    container.contains(active);
  let selStart = 0;
  let selEnd = 0;
  if (wasSearch && active instanceof HTMLInputElement) {
    selStart = active.selectionStart ?? 0;
    selEnd = active.selectionEnd ?? 0;
  }

  if (!list.length) {
    _staffDocumentsSearchQuery = "";
    container.innerHTML = `<div style="padding:16px;background:#fff;border:1px solid var(--border);border-radius:12px;">${renderEmpty()}</div>`;
    return;
  }
  const body = renderListContentBody(list);
  container.innerHTML = `<div style="padding:16px;background:#fff;border:1px solid var(--border);border-radius:12px;">${body}</div>`;
  wireStaffDocExpiryChatButtons(container);

  if (wasSearch) {
    const inp = container.querySelector("input[data-ff-doc-search]");
    if (inp) {
      inp.focus();
      try {
        inp.setSelectionRange(selStart, selEnd);
      } catch (_) {}
    }
  }
}

function applyDocumentsSnapshot() {
  const sid = _mountCtx.salonId;
  const stid = _mountCtx.staffId;
  const key = `${sid}::${stid}`;
  if (_mountedKey !== key) return;
  const list = _lastDocList;
  if (list === null) return;
  if (_ffBoundContainer) {
    renderListIntoContainer(_ffBoundContainer, list);
  }
}

function ensureSubscription(sid, stid) {
  const key = `${sid}::${stid}`;
  if (_mountedKey === key && _unsub) return;

  if (typeof _unsub === "function") {
    try {
      _unsub();
    } catch (_) {}
  }
  _unsub = null;
  _mountedKey = key;
  _mountCtx = { salonId: sid, staffId: stid };
  _lastDocList = null;
  _staffDocumentsFilter = "all";
  _staffDocumentsSearchQuery = "";

  if (_ffBoundContainer) {
    _ffBoundContainer.innerHTML = `<div style="min-height:88px;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;"><p style="margin:0;font-size:13px;color:#6b7280;">Loading documents…</p></div>`;
  }

  const colRef = collection(db, "salons", sid, "staff", stid, "documents");
  _unsub = onSnapshot(
    colRef,
    (snap) => {
      if (_mountedKey !== key) return;
      const list = [];
      snap.forEach((d) => {
        list.push({ id: d.id, ...d.data() });
      });
      list.sort((a, b) => {
        const ta = toDateMaybe(a.createdAt)?.getTime() ?? 0;
        const tb = toDateMaybe(b.createdAt)?.getTime() ?? 0;
        return tb - ta;
      });
      _lastDocList = list;
      applyDocumentsSnapshot();
    },
    (err) => {
      console.warn("[staff-documents]", err);
      if (_mountedKey !== key) return;
      const errHtml = `<p style="margin:0;font-size:13px;color:#b91c1c;">Could not load documents.</p>`;
      if (_ffBoundContainer) {
        _ffBoundContainer.innerHTML = errHtml;
      }
    },
  );
}

function renderDocumentCard(doc) {
  const title = formatDocumentTitle(doc.title);
  const type =
    doc.type != null && String(doc.type).trim() !== "" ? String(doc.type).trim() : "—";
  const fileName =
    doc.fileName != null && String(doc.fileName).trim() !== "" ? String(doc.fileName).trim() : "—";
  const ap = String(doc.approvalStatus || "").toLowerCase();
  const approvalDisplay = formatApprovalLabel(doc.approvalStatus != null ? String(doc.approvalStatus) : "");
  const expirationDate = doc.expirationDate;
  const lifecycleRaw = doc.lifecycleStatus != null ? String(doc.lifecycleStatus) : "";
  const lifeLower = String(doc.lifecycleStatus || "").toLowerCase();
  const isArchived = lifeLower === "archived";
  const lifecycleDisplay = isArchived
    ? formatLifecycleLabel("archived")
    : doc.expirationDate != null
      ? formatLifecycleLabel(ffComputeLifecycleFromExpiration(doc.expirationDate))
      : formatLifecycleLabel(lifecycleRaw);
  const createdAt = doc.createdAt;

  const badges = [];
  if (ap === "pending") badges.push(badgeHtml("pending"));
  else if (ap === "approved" || ap === "rejected") badges.push(badgeHtml(ap));

  const expState = expiryBadgeState(expirationDate);
  if (expState) {
    badges.push(badgeHtml(expState));
  } else if (doc.expirationDate == null) {
    const life = String(doc.lifecycleStatus || "").toLowerCase();
    if (life === "expired") badges.push(badgeHtml("expired"));
    else if (life === "expiring_soon") badges.push(badgeHtml("expiring_soon"));
  }

  if (isArchived) {
    badges.push(badgeHtml("archived"));
  }

  const badgeRow = badges.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;align-items:center;">${badges.join("")}</div>`
    : "";

  const path = trimStr(doc.storagePath || doc.filePath || "");
  const fUrl = trimStr(doc.fileUrl || "");
  const canView = !!path || fUrl.startsWith("http://") || fUrl.startsWith("https://");
  const derivedForReplace =
    !isArchived && doc.expirationDate != null
      ? ffComputeLifecycleFromExpiration(doc.expirationDate)
      : lifeLower;
  const showExpiredReplace = !isArchived && derivedForReplace === "expired";
  const showExpiringSoonChat = !isArchived && derivedForReplace === "expiring_soon";

  const btnBase =
    "min-height:36px;padding:8px 14px;font-size:12px;font-weight:600;border-radius:999px;line-height:1.2;box-sizing:border-box;font-family:inherit;-webkit-tap-highlight-color:transparent;";
  // Same purple treatment as document filter chips (selected): border #7c3aed, tint #ede9fe
  const btnStyle = `${btnBase}cursor:pointer;border:1px solid #7c3aed;background:#ede9fe;color:#5b21b6;touch-action:manipulation;`;
  const btnDisabledStyle = `${btnBase}cursor:not-allowed;border:1px solid #e5e7eb;background:#f9fafb;color:#9ca3af;`;

  const hasDirectHttpUrl = fUrl.startsWith("http://") || fUrl.startsWith("https://");
  const viewBtn = !canView
    ? `<button type="button" disabled title="No file attached" style="${btnDisabledStyle}">View</button>`
    : hasDirectHttpUrl
    ? `<a href="${escapeAttr(fUrl)}" target="_blank" rel="noopener noreferrer" style="${btnStyle}text-decoration:none;display:inline-block;">View</a>`
    : `<button type="button" data-ff-doc-action="view" data-doc-id="${escapeHtml(doc.id)}" style="${btnStyle}">View</button>`;

  const archiveOrUnarchive = isArchived
    ? `<button type="button" data-ff-doc-action="unarchive" data-doc-id="${escapeHtml(doc.id)}" style="${btnStyle}">Unarchive</button>`
    : `<button type="button" data-ff-doc-action="archive" data-doc-id="${escapeHtml(doc.id)}" style="${btnStyle}">Archive</button>`;

  const uploadNewVersionBtn = showExpiredReplace
    ? `<button type="button" data-ff-doc-action="replace" data-doc-id="${escapeHtml(doc.id)}" title="Replace file on this document (same record)" style="${btnBase}cursor:pointer;border:1px dashed #7c3aed;background:#faf5ff;color:#6d28d9;">Upload New Version</button>`
    : "";
  const expiringSoonChatBtn = showExpiringSoonChat
    ? `<button type="button" data-ff-doc-action="expiry_chat_notify" data-doc-id="${escapeHtml(doc.id)}" title="Send this staff member a chat reminder" style="${btnBase}cursor:pointer;border:1px solid #7c3aed;background:#ede9fe;color:#5b21b6;pointer-events:auto !important;position:relative;z-index:2;touch-action:manipulation;">Send chat reminder</button>`
    : "";

  const actionsRow = `
    <div class="ff-staff-doc-actions" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid #f3f4f6;align-items:center;">
      ${viewBtn}
      ${archiveOrUnarchive}
      ${expiringSoonChatBtn}
      ${uploadNewVersionBtn}
    </div>`;

  return `
    <div class="ff-staff-doc-card" style="border:1px solid #e5e7eb;border-radius:10px;padding:13px 14px;background:#fff;margin-bottom:10px;">
      ${badgeRow}
      <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:8px;line-height:1.35;">${escapeHtml(title)}</div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:12px;color:#374151;line-height:1.4;">
        <span style="color:#9ca3af;">Type</span><span>${escapeHtml(type)}</span>
        <span style="color:#9ca3af;">File</span><span style="word-break:break-word;">${escapeHtml(fileName)}</span>
        <span style="color:#9ca3af;">Approval</span><span>${escapeHtml(approvalDisplay)}</span>
        <span style="color:#9ca3af;">Expires</span><span>${escapeHtml(formatDay(expirationDate))}</span>
        <span style="color:#9ca3af;">Lifecycle</span><span>${escapeHtml(lifecycleDisplay)}</span>
        <span style="color:#9ca3af;">Created</span><span>${escapeHtml(formatWhen(createdAt))}</span>
      </div>
      ${actionsRow}
    </div>
  `;
}

function renderGrouped(docs) {
  const active = [];
  const archived = [];
  docs.forEach((d) => {
    const g = groupDocument(d);
    if (g === "archived") archived.push(d);
    else active.push(d);
  });

  const activeSorted = sortActiveDocuments(active);
  const archivedSorted = sortArchivedDocuments(archived);

  function section(title, innerHtml) {
    if (!innerHtml) return "";
    return `
      <div style="margin-bottom:22px;">
        <h4 style="margin:0 0 12px 0;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(title)}</h4>
        ${innerHtml}
      </div>
    `;
  }

  return (
    section("Documents", renderActiveSectionWithSubheaders(activeSorted)) +
    section("Archived", archivedSorted.map(renderDocumentCard).join(""))
  );
}

function renderEmpty() {
  return staffDocsEmptyMessageHtml("No documents uploaded yet.");
}

/**
 * Unsubscribe from Firestore and clear listener state.
 */
export function ffStaffDocumentsUnmount() {
  if (typeof _unsub === "function") {
    try {
      _unsub();
    } catch (_) {}
  }
  _unsub = null;
  _mountedKey = "";
  _mountCtx = { salonId: "", staffId: "" };
  _lastDocList = null;
  _staffDocumentsFilter = "all";
  _staffDocumentsSearchQuery = "";
  if (_ffBoundContainer && _onDocActionClick) {
    try {
      _ffBoundContainer.removeEventListener("click", _onDocActionClick);
    } catch (_) {}
  }
  if (_ffBoundContainer && _onStaffDocSearchInput) {
    try {
      _ffBoundContainer.removeEventListener("input", _onStaffDocSearchInput);
    } catch (_) {}
  }
  if (_ffBoundContainer) {
    try {
      delete _ffBoundContainer.__ffStaffSearchBound;
    } catch (_) {}
  }
  _ffBoundContainer = null;
  _onDocActionClick = null;
}

/** Kept for compatibility; document counts/filters live only in the Documents tab. */
export function ffMountStaffDocumentsSummaryStrip(stripEl, salonId, staffId) {
  void stripEl;
  void salonId;
  void staffId;
}

/**
 * Subscribe to documents subcollection and render into container.
 */
export function ffMountStaffDocuments(container, salonId, staffId) {
  if (!container) return;
  const sid = String(salonId || "").trim();
  const stid = String(staffId || "").trim();
  if (!sid || !stid) {
    container.innerHTML = `<p style="margin:0;font-size:13px;color:#b91c1c;">Missing salon or staff.</p>`;
    return;
  }
  _mountCtx = { salonId: sid, staffId: stid };

  if (_ffBoundContainer && _ffBoundContainer !== container && _onDocActionClick) {
    try {
      _ffBoundContainer.removeEventListener("click", _onDocActionClick);
    } catch (_) {}
    if (_onStaffDocSearchInput) {
      try {
        _ffBoundContainer.removeEventListener("input", _onStaffDocSearchInput);
      } catch (_) {}
    }
    try {
      delete _ffBoundContainer.__ffStaffSearchBound;
    } catch (_) {}
    _ffBoundContainer = null;
  }
  if (!_onDocActionClick) {
    _onDocActionClick = (e) => ffHandleStaffDocumentActionClick(e);
  }
  if (_ffBoundContainer !== container) {
    container.addEventListener("click", _onDocActionClick);
    _ffBoundContainer = container;
  }
  ensureStaffDocSearchListeners(container);

  const key = `${sid}::${stid}`;
  if (_mountedKey !== key) {
    container.innerHTML = `<p style="margin:0;font-size:13px;color:#6b7280;">Loading documents…</p>`;
    ensureSubscription(sid, stid);
    return;
  }

  _mountCtx = { salonId: sid, staffId: stid };
  if (_lastDocList !== null) {
    renderListIntoContainer(container, _lastDocList);
  } else {
    container.innerHTML = `<p style="margin:0;font-size:13px;color:#6b7280;">Loading documents…</p>`;
  }
}

if (typeof window !== "undefined") {
  window.ffStaffDocumentsUnmount = ffStaffDocumentsUnmount;
  window.ffMountStaffDocuments = ffMountStaffDocuments;
  window.ffMountStaffDocumentsSummaryStrip = ffMountStaffDocumentsSummaryStrip;
  window.ffStaffDocToast = ffToast;
  /** For console debugging: run `ffStaffDocDebugContext()` while Staff → Documents is open. */
  window.ffStaffDocDebugContext = function () {
    return {
      mountCtx: { salonId: _mountCtx.salonId, staffId: _mountCtx.staffId },
      mountedKey: _mountedKey,
      signedIn: !!auth.currentUser,
      uid: auth.currentUser?.uid || null,
    };
  };
  window.ffStaffDocSendExpiryChatReminderFromEl = function (el) {
    const id = el && el.getAttribute && trimStr(el.getAttribute("data-doc-id"));
    return ffRunExpiryChatNotify(id);
  };
  /** Returns a Promise so the console can `await` or `.then/.catch` and see failures. */
  window.ffStaffDocSendExpiryChatReminder = function (docId) {
    return ffRunExpiryChatNotify(docId);
  };
  window.ffStaffDocSendExpiryChatReminderWithContext = ffSendExpiryChatReminderForStaffDocContext;
}
