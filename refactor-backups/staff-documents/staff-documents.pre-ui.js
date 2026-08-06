/**
 * Staff Documents (Phase 1) — read-only list from
 * salons/{salonId}/staff/{staffId}/documents/{documentId}
 *
 * Phase 2 — inbox approval sync helpers (used by inbox.js).
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  deleteDoc,
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
  deleteObject,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { db, auth, storage } from "/app.js?v=20260610_force_lp_ios";
import { sdState, STAFF_DOC_FILTER_IDS, getMediaDownloadUrlCallable } from "./staff-documents-state.js?v=20260701_staffdoc_state_split";
import {
  trimStr,
  stripUndefined,
  ffStaffDocumentTypeSelectOptionsHtml,
  ffExpirationTimestampToYmdInput,
  parseExpirationForStaffDoc,
  calendarDaysUntilExpiry,
  ffComputeLifecycleFromExpiration,
  escapeHtml,
  escapeAttr,
  toDateMaybe,
  formatWhen,
  formatDay,
  formatDocumentTitle,
  formatApprovalLabel,
  formatLifecycleLabel,
  staffDocsEmptyMessageHtml,
  staffDocsShellStyle,
  expiryBadgeState,
  badgeHtml,
  groupDocument,
  tierForActiveSectionDoc,
  sortActiveDocuments,
  sortArchivedDocuments,
  renderActiveSubheader,
  filterDocumentsByChip,
  normalizeStaffDocSearch,
  docMatchesSearch,
  sortDocumentsForFilterChip,
  renderFilterChipsHtml,
} from "./staff-documents-format.js?v=20260701_staffdoc_format_split";
import {
  ffResyncStaffDocumentFromInbox,
} from "./staff-documents-inbox-sync.js?v=20260701_staffdoc_inbox_sync_split";
export {
  ffResolveLinkedStaffDocumentId,
  ffResolveStaffDocumentOwnerStaffId,
  ffResolveStaffDocumentOwnerStaffIdWithFallback,
  ffResyncStaffDocumentFromInbox,
  ffSyncStaffDocumentOnInboxApprove,
  ffSyncStaffDocumentOnInboxReject,
} from "./staff-documents-inbox-sync.js?v=20260701_staffdoc_inbox_sync_split";
export {
  ffStaffDocumentTypeSelectOptionsHtml,
  ffExpirationTimestampToYmdInput,
  ffComputeLifecycleFromExpiration,
} from "./staff-documents-format.js?v=20260701_staffdoc_format_split";

// --- Phase 2: Inbox → staff /documents sync (approve / reject) ---



/**
 * Manager-facing edit of type / title / expiration on an existing staff document (no file change).
 */
export async function ffUpdateStaffDocumentMetadata({ salonId, staffId, documentId, type, expirationYmd, title }) {
  const sid = trimStr(salonId);
  const stid = trimStr(staffId);
  const did = trimStr(documentId);
  const docType = trimStr(type);
  if (!sid || !stid || !did || !docType) {
    ffToast("Choose a document type.", "error");
    return;
  }
  if (!auth.currentUser) {
    ffToast("Sign in required.", "error");
    return;
  }
  const ref = doc(db, "salons", sid, "staff", stid, "documents", did);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    ffToast("Document not found.", "error");
    return;
  }
  const prev = snap.data() || {};
  const wasArchived = trimStr(String(prev.lifecycleStatus || "")).toLowerCase() === "archived";

  const expStr = expirationYmd == null ? "" : String(expirationYmd).trim();
  const clearExp = expStr === "";

  let nextTitle = trimStr(title);
  if (!nextTitle) {
    const fn = trimStr(prev.fileName || "");
    nextTitle = [docType, fn].filter(Boolean).join(" — ") || docType;
  }

  /** @type {Record<string, unknown>} */
  const payload = {
    type: docType,
    title: nextTitle,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser.uid,
  };

  if (clearExp) {
    payload.expirationDate = deleteField();
    if (!wasArchived) {
      payload.lifecycleStatus = "active";
    }
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(expStr)) {
    const parsed = parseExpirationForStaffDoc(expStr);
    if (parsed) {
      payload.expirationDate = parsed;
      if (!wasArchived) {
        payload.lifecycleStatus = ffComputeLifecycleFromExpiration(parsed);
      }
    }
  }

  try {
    await updateDoc(ref, payload);
    ffToast("Document details updated.", "success");
  } catch (err) {
    console.warn("[staff-documents] ffUpdateStaffDocumentMetadata", err);
    ffToast(String(err?.message || err || "Could not update document."), "error");
  }
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
 * @param {object} opts
 * @param {boolean} [opts.destructive] — red confirm button (irreversible actions)
 */
function ffStaffDocumentsConfirm({ title, message, confirmLabel, cancelLabel = "Cancel", destructive = false }) {
  const okStyle = destructive
    ? "padding:10px 18px;border-radius:10px;border:1px solid #b91c1c;background:#dc2626;color:#fff;font-weight:600;cursor:pointer;font-size:14px;font-family:inherit;box-shadow:0 1px 2px rgba(220,38,38,0.35);"
    : "padding:10px 18px;border-radius:10px;border:none;background:#7c3aed;color:#fff;font-weight:600;cursor:pointer;font-size:14px;font-family:inherit;box-shadow:0 1px 2px rgba(124,58,237,0.25);";
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
          <button type="button" data-ff-ok style="${okStyle}">${escapeHtml(confirmLabel)}</button>
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

async function refreshStaffDocViewerEditMeta() {
  sdState._staffDocsViewerCanEditMeta = false;
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    const u = await getDoc(doc(db, "users", uid));
    const role = String(u.data()?.role || "").toLowerCase();
    sdState._staffDocsViewerCanEditMeta = ["manager", "admin", "owner", "assistant_manager", "front_desk"].includes(role);
  } catch (_) {}
}

async function ffOpenStaffDocumentEditMetadataModal(docId) {
  const sid = trimStr(sdState._mountCtx.salonId);
  const stid = trimStr(sdState._mountCtx.staffId);
  const did = trimStr(docId);
  if (!sid || !stid || !did) {
    ffToast("Missing context.", "error");
    return;
  }
  if (!sdState._staffDocsViewerCanEditMeta) {
    ffToast("Only managers can edit document details.", "error");
    return;
  }
  const ref = doc(db, "salons", sid, "staff", stid, "documents", did);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    ffToast("Document not found.", "error");
    return;
  }
  const prev = snap.data() || {};
  if (trimStr(String(prev.lifecycleStatus || "")).toLowerCase() === "archived") {
    ffToast("Unarchive this document before editing details.", "error");
    return;
  }
  const rid = `ffstaffdoc_editmeta_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const overlay = document.createElement("div");
  overlay.id = rid;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.style.cssText =
    "position:fixed;left:0;top:0;right:0;bottom:0;width:100%;min-height:100vh;min-height:100dvh;background:rgba(0,0,0,0.45);z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;overflow-y:auto;overflow-x:hidden;";
  const curType = trimStr(prev.type || "");
  const curTitle = trimStr(prev.title != null ? String(prev.title) : "");
  const curExp = ffExpirationTimestampToYmdInput(prev.expirationDate);
  overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:24px 26px;max-width:420px;width:100%;box-shadow:0 25px 50px -12px rgba(0,0,0,0.28);margin:auto;flex-shrink:0;">
        <div style="font-size:18px;font-weight:700;color:#111827;margin-bottom:10px;line-height:1.3;">Edit document details</div>
        <p style="margin:0 0 16px 0;font-size:13px;color:#6b7280;line-height:1.45;">Change type, title, or expiration. The file is not replaced.</p>
        <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;">Document type</label>
        <select id="${rid}_type" style="width:100%;padding:12px;margin-bottom:12px;border:1px solid #d1d5db;border-radius:8px;font-size:12px;color:#111827;">${ffStaffDocumentTypeSelectOptionsHtml()}</select>
        <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;">Title (optional)</label>
        <input type="text" id="${rid}_title" placeholder="Auto from type if empty" style="width:100%;padding:12px;margin-bottom:12px;border:1px solid #d1d5db;border-radius:8px;font-size:12px;color:#111827;box-sizing:border-box;" />
        <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;">Expiration date</label>
        <input type="date" id="${rid}_exp" style="width:100%;padding:12px;margin-bottom:8px;border:1px solid #d1d5db;border-radius:8px;font-size:12px;color:#111827;box-sizing:border-box;" />
        <p style="margin:0 0 16px 0;font-size:11px;color:#9ca3af;">Clear the date to remove expiration.</p>
        <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;">
          <button type="button" data-ff-cancel style="padding:10px 18px;border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-weight:600;cursor:pointer;font-size:14px;font-family:inherit;">Cancel</button>
          <button type="button" data-ff-save style="padding:10px 18px;border-radius:10px;border:none;background:#7c3aed;color:#fff;font-weight:600;cursor:pointer;font-size:14px;font-family:inherit;">Save</button>
        </div>
      </div>`;
  const sel = overlay.querySelector(`#${rid}_type`);
  if (sel && curType) {
    try {
      sel.value = curType;
    } catch (_) {}
  }
  const titInp = overlay.querySelector(`#${rid}_title`);
  if (titInp) titInp.value = curTitle;
  const expInp = overlay.querySelector(`#${rid}_exp`);
  if (expInp) expInp.value = curExp;

  const finish = () => {
    try {
      overlay.remove();
    } catch (_) {}
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (ev) => {
    if (ev.key === "Escape") finish();
  };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) finish();
  });
  overlay.querySelector("[data-ff-cancel]").onclick = () => finish();
  overlay.querySelector("[data-ff-save]").onclick = async () => {
    const ty = trimStr(overlay.querySelector(`#${rid}_type`)?.value || "");
    const ti = trimStr(overlay.querySelector(`#${rid}_title`)?.value || "");
    const ex = trimStr(overlay.querySelector(`#${rid}_exp`)?.value || "");
    if (!ty) {
      ffToast("Select a document type.", "error");
      return;
    }
    await ffUpdateStaffDocumentMetadata({
      salonId: sid,
      staffId: stid,
      documentId: did,
      type: ty,
      expirationYmd: ex,
      title: ti,
    });
    finish();
  };
  document.body.appendChild(overlay);
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

function ffStaffDocsIsIosMobile() {
  try {
    if (document.documentElement.classList.contains("ff-ios-capacitor-safe")) return true;
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    return /iPhone|iPad|iPod/i.test(ua) || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
  } catch (_) {
    return false;
  }
}

function ffStaffDocsIsImageDocument(url, fileName) {
  const source = `${fileName || ""} ${url || ""}`.toLowerCase();
  return /\.(png|jpe?g|webp|gif|bmp|heic|heif)(\?|#|$)/i.test(source);
}

function ffOpenStaffDocumentIosViewer(url, fileName) {
  if (!url) return false;
  const rid = `ffstaffdoc_view_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const safeTitle = escapeHtml(fileName || "Document");
  const isImage = ffStaffDocsIsImageDocument(url, fileName);
  const overlay = document.createElement("div");
  overlay.id = rid;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.style.cssText =
    "position:fixed;left:0;top:0;right:0;bottom:0;width:100%;height:100vh;height:100dvh;background:#0f172a;z-index:2147483647;display:flex;flex-direction:column;box-sizing:border-box;padding:calc(10px + env(safe-area-inset-top,0px)) 10px calc(10px + env(safe-area-inset-bottom,0px));";
  overlay.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 4px 12px;color:#fff;flex:0 0 auto;">
      <div style="min-width:0;font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${safeTitle}</div>
      <button type="button" data-ff-doc-view-close style="border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.12);color:#fff;border-radius:999px;padding:7px 12px;font-size:13px;font-weight:700;cursor:pointer;">Close</button>
    </div>
    <div style="flex:1 1 auto;min-height:0;background:#fff;border-radius:14px;overflow:hidden;display:flex;align-items:center;justify-content:center;">
      ${
        isImage
          ? `<img src="${escapeAttr(url)}" alt="${safeTitle}" style="display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;" />`
          : `<iframe src="${escapeAttr(url)}" title="${safeTitle}" style="width:100%;height:100%;border:0;background:#fff;"></iframe>`
      }
    </div>
  `;
  const close = () => {
    try {
      overlay.remove();
    } catch (_) {}
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (ev) => {
    if (ev.key === "Escape") close();
  };
  overlay.querySelector("[data-ff-doc-view-close]").addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  return true;
}

function openStaffDocumentResolvedUrl(url, tab, fileName) {
  if (ffStaffDocsIsIosMobile()) {
    closePopupIfOpen(tab);
    return ffOpenStaffDocumentIosViewer(url, fileName);
  }
  return assignUrlToTabOrOpenFresh(url, tab);
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
    if (id && STAFF_DOC_FILTER_IDS.has(id) && sdState._staffDocumentsFilter !== id) {
      sdState._staffDocumentsFilter = id;
      if (sdState._lastDocList !== null && sdState._ffBoundContainer) {
        renderListIntoContainer(sdState._ffBoundContainer, sdState._lastDocList);
      }
    }
    return;
  }

  const clearSearchBtn = el && el.closest && el.closest("button[data-ff-doc-search-clear]");
  if (clearSearchBtn && !clearSearchBtn.disabled) {
    e.preventDefault();
    e.stopPropagation();
    if (sdState._staffDocumentsSearchQuery !== "") {
      sdState._staffDocumentsSearchQuery = "";
      if (sdState._lastDocList !== null && sdState._ffBoundContainer) {
        renderListIntoContainer(sdState._ffBoundContainer, sdState._lastDocList);
        const inp = sdState._ffBoundContainer.querySelector("input[data-ff-doc-search]");
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
  const { salonId, staffId } = sdState._mountCtx;
  if (!salonId || !staffId || !docId) {
    ffToast("Missing context. Refresh the page.", "error");
    return;
  }

  const ref = doc(db, "salons", salonId, "staff", staffId, "documents", docId);

  if (action === "view") {
    const tab = ffStaffDocsIsIosMobile() ? null : openBlankTabForLaterNavigation();
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
        openStaffDocumentResolvedUrl(fileUrl, tab, fileNameHint);
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
          openStaffDocumentResolvedUrl(url, tab, fileNameHint);
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

  if (action === "edit_meta") {
    void ffOpenStaffDocumentEditMetadataModal(docId);
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

  if (action === "delete_permanent") {
    const okDel = await ffStaffDocumentsConfirm({
      title: "Delete this document permanently?",
      message:
        "This will remove the document from the system and delete the stored file. There is no way to recover it. Are you sure you want to continue?",
      confirmLabel: "Delete permanently",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!okDel) return;
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
      if (trimStr(String(d.lifecycleStatus || "")).toLowerCase() !== "archived") {
        ffToast("Only archived documents can be permanently deleted. Unarchive first if this was a mistake.", "error");
        return;
      }
      const storagePath = trimStr(d.storagePath || d.filePath || "");
      if (storagePath) {
        try {
          await deleteObject(storageRef(storage, storagePath));
        } catch (serr) {
          console.warn("[staff-documents] storage delete (continuing with Firestore)", serr);
        }
      }
      await deleteDoc(ref);
      ffToast("Document deleted permanently.", "success");
    } catch (err) {
      console.warn("[staff-documents] delete_permanent", err);
      ffToast(String(err?.message || err || "Could not delete document."), "error");
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
  let uploadLink = "";
  try {
    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "https://fairflowapp-db841.web.app";
    const u = new URL(origin);
    u.pathname = "/";
    u.searchParams.set("ffInboxUpload", "1");
    u.searchParams.set("docType", docType);
    u.searchParams.set("renewForDoc", did);
    uploadLink = u.toString();
  } catch (e) {
    console.warn("[staff-documents] upload deep link", e);
  }
  const message =
    `Your ${docType} is expiring in ${daysUntil} ${dayLabel}. Please upload a new version.` +
    (uploadLink ? `\n\nTap to open upload (same tab or new tab): ${uploadLink}` : "");

  const senderName =
    trimStr(userSnap.data()?.name || userSnap.data()?.displayName) || "Manager";
  const senderRole = trimStr(userSnap.data()?.role) || "";

  // Same shape as chat.js template sends — Firestore rules allow templateId+title (and message body).
  const STAFF_DOC_EXPIRY_TEMPLATE_ID = "ff_staff_doc_expiry_reminder";

  // Resolve the sender's current location so this reminder is scoped to the
  // same branch as the rest of their chat (mirrors chat.js _activeLocKey).
  let locKey = "default";
  try {
    if (typeof window !== "undefined") {
      if (typeof window.ffGetActiveLocationId === "function") {
        const v = window.ffGetActiveLocationId();
        if (typeof v === "string" && v.trim()) locKey = v.trim();
      } else if (typeof window.__ff_active_location_id === "string" && window.__ff_active_location_id.trim()) {
        locKey = window.__ff_active_location_id.trim();
      }
    }
  } catch (_) {}

  const pair = [senderUid, recipientUid].sort().join("__");
  const convId = locKey === "default" ? pair : `loc_${locKey}__${pair}`;
  const convRef = doc(db, `salons/${sid}/conversations`, convId);
  const msgRef = doc(collection(db, `salons/${sid}/conversations/${convId}/messages`));

  // Security rules evaluate each batch op against DB state *before* the batch runs.
  // Message create uses get(conversation).participants — so the conversation doc must
  // exist in a prior committed write, not in the same batch as the first message.
  const convSnap = await getDoc(convRef);
  if (!convSnap.exists()) {
    await setDoc(
      convRef,
      { participants: [senderUid, recipientUid].sort(), createdAt: serverTimestamp(), locationId: locKey },
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
  const { salonId: sid0, staffId: st0 } = sdState._mountCtx;
  const dk = `${sid0}|${st0}|${did}`;
  const now0 = Date.now();
  if (dk === sdState._ffExpiryNotifyDedupe.key && now0 - sdState._ffExpiryNotifyDedupe.at < 1500) {
    ffToast("Reminder just sent. Try again in a moment.", "info");
    return false;
  }
  if (sdState._ffExpiryNotifyInFlight) {
    ffToast("Still sending the previous reminder…", "info");
    return false;
  }
  // Set immediately after checks — otherwise two parallel calls can both pass the guard and send twice.
  sdState._ffExpiryNotifyInFlight = true;
  try {
    ffToast("Sending reminder…", "info");
    if (!auth.currentUser) {
      ffToast("Sign in required.", "error");
      return false;
    }
    const { salonId, staffId } = sdState._mountCtx;
    if (!salonId || !staffId || !did) {
      ffToast("Missing context. Refresh the page.", "error");
      return false;
    }

    await ffSendExpiryChatReminderFromStaffDoc({ salonId, staffId, docId: did });
    sdState._ffExpiryNotifyDedupe = { key: dk, at: Date.now() };
    console.log("[staff-documents] Chat reminder flow finished (check toast + Chat).");
    return true;
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
    return false;
  } finally {
    sdState._ffExpiryNotifyInFlight = false;
  }
}

/** Run the same expiry chat reminder as Staff → Documents, with explicit salon/staff (e.g. Inbox alert modal). */
export async function ffSendExpiryChatReminderForStaffDocContext({ salonId, staffId, docId }) {
  const sid = trimStr(salonId);
  const stid = trimStr(staffId);
  const did = trimStr(docId);
  const prevCtx = sdState._mountCtx;
  try {
    sdState._mountCtx = { salonId: sid, staffId: stid };
    await ffRunExpiryChatNotify(did);
  } finally {
    sdState._mountCtx = prevCtx;
  }
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


function renderFilteredSingleSection(docs, chip) {
  const sorted = sortDocumentsForFilterChip(docs, chip);
  return sorted.map(renderDocumentCard).join("");
}


function renderSearchRowHtml() {
  const v = escapeHtml(sdState._staffDocumentsSearchQuery);
  return `<div style="display:flex;align-items:stretch;gap:8px;">
  <input type="search" data-ff-doc-search placeholder="Search documents" value="${v}" autocomplete="off" style="flex:1;min-width:0;min-height:34px;padding:7px 11px;font-size:12px;border:1px solid #e5e7eb;border-radius:8px;box-sizing:border-box;font-family:inherit;color:#111827;background:#fff;" />
  <button type="button" data-ff-doc-search-clear title="Clear search" aria-label="Clear search" style="min-height:34px;padding:0 12px;font-size:11px;font-weight:600;border:1px solid #e5e7eb;border-radius:8px;background:#fff;color:#374151;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0;">Clear</button>
</div>`;
}

function renderListContentBody(list) {
  if (!STAFF_DOC_FILTER_IDS.has(sdState._staffDocumentsFilter)) {
    sdState._staffDocumentsFilter = "active";
  }
  const f = sdState._staffDocumentsFilter || "active";
  const q = normalizeStaffDocSearch(sdState._staffDocumentsSearchQuery);
  const chips = renderFilterChipsHtml(f, list);
  const searchRow = renderSearchRowHtml();
  const chipsWrap = `<div class="ff-staff-doc-filters" style="display:flex;align-items:center;gap:8px;">${chips}</div>`;
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
  if (!sdState._onStaffDocSearchInput) {
    sdState._onStaffDocSearchInput = function (e) {
      const t = e.target && e.target.closest && e.target.closest("input[data-ff-doc-search]");
      if (!t) return;
      sdState._staffDocumentsSearchQuery = t.value;
      if (sdState._lastDocList !== null && sdState._ffBoundContainer) {
        renderListIntoContainer(sdState._ffBoundContainer, sdState._lastDocList);
      }
    };
  }
  container.addEventListener("input", sdState._onStaffDocSearchInput);
  container.addEventListener("change", (e) => {
    const sel = e.target && e.target.closest && e.target.closest("select[data-ff-doc-filter-select]");
    if (!sel) return;
    const id = sel.value;
    if (id && STAFF_DOC_FILTER_IDS.has(id) && sdState._staffDocumentsFilter !== id) {
      sdState._staffDocumentsFilter = id;
      if (sdState._lastDocList !== null && sdState._ffBoundContainer) {
        renderListIntoContainer(sdState._ffBoundContainer, sdState._lastDocList);
      }
    }
  });
}

/** Direct handler on the button — does not rely on bubbling to the documents container. */
function wireStaffDocExpiryChatButtons(container) {
  if (!container || !container.querySelectorAll) return;
  container.querySelectorAll('button[data-ff-doc-action="expiry_chat_notify"]').forEach((btn) => {
    btn.onclick = async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (btn.disabled) return;
      const originalText = btn.textContent || "Send chat reminder";
      btn.disabled = true;
      btn.textContent = "Sending...";
      btn.style.opacity = "0.75";
      btn.style.cursor = "wait";
      const ok = await ffRunExpiryChatNotify(btn.getAttribute("data-doc-id"));
      if (ok) {
        btn.textContent = "Sent";
        btn.style.opacity = "1";
        btn.style.cursor = "default";
        setTimeout(() => {
          try {
            btn.disabled = false;
            btn.textContent = originalText;
            btn.style.cursor = "pointer";
          } catch (_) {}
        }, 2500);
      } else {
        btn.disabled = false;
        btn.textContent = originalText;
        btn.style.opacity = "1";
        btn.style.cursor = "pointer";
      }
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
    sdState._staffDocumentsSearchQuery = "";
    container.innerHTML = `<div style="${staffDocsShellStyle()}">${renderEmpty()}</div>`;
    return;
  }
  const body = renderListContentBody(list);
  container.innerHTML = `<div style="${staffDocsShellStyle()}">${body}</div>`;
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
  const sid = sdState._mountCtx.salonId;
  const stid = sdState._mountCtx.staffId;
  const key = `${sid}::${stid}`;
  if (sdState._mountedKey !== key) return;
  const list = sdState._lastDocList;
  if (list === null) return;
  if (sdState._ffBoundContainer) {
    renderListIntoContainer(sdState._ffBoundContainer, list);
  }
}

function ensureSubscription(sid, stid) {
  const key = `${sid}::${stid}`;
  if (sdState._mountedKey === key && sdState._unsub) return;

  if (typeof sdState._unsub === "function") {
    try {
      sdState._unsub();
    } catch (_) {}
  }
  sdState._unsub = null;
  sdState._mountedKey = key;
  sdState._mountCtx = { salonId: sid, staffId: stid };
  sdState._lastDocList = null;
  sdState._staffDocumentsFilter = "active";
  sdState._staffDocumentsSearchQuery = "";

  void refreshStaffDocViewerEditMeta().then(() => {
    if (sdState._mountedKey === key && sdState._lastDocList && sdState._ffBoundContainer) {
      applyDocumentsSnapshot();
    }
  });

  if (sdState._ffBoundContainer) {
    sdState._ffBoundContainer.innerHTML = `<div style="min-height:88px;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;"><p style="margin:0;font-size:13px;color:#6b7280;">Loading documents…</p></div>`;
  }

  const colRef = collection(db, "salons", sid, "staff", stid, "documents");
  sdState._unsub = onSnapshot(
    colRef,
    (snap) => {
      if (sdState._mountedKey !== key) return;
      const list = [];
      snap.forEach((d) => {
        list.push({ id: d.id, ...d.data() });
      });
      list.sort((a, b) => {
        const ta = toDateMaybe(a.createdAt)?.getTime() ?? 0;
        const tb = toDateMaybe(b.createdAt)?.getTime() ?? 0;
        return tb - ta;
      });
      sdState._lastDocList = list;
      applyDocumentsSnapshot();
    },
    (err) => {
      console.warn("[staff-documents]", err);
      if (sdState._mountedKey !== key) return;
      const errHtml = `<p style="margin:0;font-size:13px;color:#b91c1c;">Could not load documents.</p>`;
      if (sdState._ffBoundContainer) {
        sdState._ffBoundContainer.innerHTML = errHtml;
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
  const lifeLower = trimStr(String(doc.lifecycleStatus || "")).toLowerCase();
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

  // Pill-sized actions (same line as status badges; ~10px / 3px 9px padding)
  const editMetaPillBtn =
    sdState._staffDocsViewerCanEditMeta && !isArchived
      ? `<button type="button" data-ff-doc-action="edit_meta" data-doc-id="${escapeHtml(doc.id)}" title="Edit type, title, expiration" style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:0.02em;line-height:1.3;background:#faf5ff;color:#5b21b6;border:1px solid #c4b5fd;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent;flex-shrink:0;">✎ Edit</button>`
      : "";
  const deletePillBtn = isArchived
    ? `<button type="button" data-ff-doc-action="delete_permanent" data-doc-id="${escapeHtml(doc.id)}" title="Permanently delete this document and its file. This cannot be undone." style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:0.02em;line-height:1.3;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent;flex-shrink:0;">Delete</button>`
    : "";
  const badgeActions = [editMetaPillBtn, deletePillBtn].filter(Boolean).join("");

  const badgeRow =
    badges.length || badgeActions
      ? `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:10px;">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;flex:1;min-width:0;">${badges.join("")}</div>
          ${badgeActions ? `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;flex-shrink:0;">${badgeActions}</div>` : ""}
        </div>`
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
  if (typeof sdState._unsub === "function") {
    try {
      sdState._unsub();
    } catch (_) {}
  }
  sdState._unsub = null;
  sdState._mountedKey = "";
  sdState._mountCtx = { salonId: "", staffId: "" };
  sdState._lastDocList = null;
  sdState._staffDocumentsFilter = "active";
  sdState._staffDocumentsSearchQuery = "";
  sdState._staffDocsViewerCanEditMeta = false;
  if (sdState._ffBoundContainer && sdState._onDocActionClick) {
    try {
      sdState._ffBoundContainer.removeEventListener("click", sdState._onDocActionClick);
    } catch (_) {}
  }
  if (sdState._ffBoundContainer && sdState._onStaffDocSearchInput) {
    try {
      sdState._ffBoundContainer.removeEventListener("input", sdState._onStaffDocSearchInput);
    } catch (_) {}
  }
  if (sdState._ffBoundContainer) {
    try {
      delete sdState._ffBoundContainer.__ffStaffSearchBound;
    } catch (_) {}
  }
  sdState._ffBoundContainer = null;
  sdState._onDocActionClick = null;
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
  sdState._mountCtx = { salonId: sid, staffId: stid };

  if (sdState._ffBoundContainer && sdState._ffBoundContainer !== container && sdState._onDocActionClick) {
    try {
      sdState._ffBoundContainer.removeEventListener("click", sdState._onDocActionClick);
    } catch (_) {}
    if (sdState._onStaffDocSearchInput) {
      try {
        sdState._ffBoundContainer.removeEventListener("input", sdState._onStaffDocSearchInput);
      } catch (_) {}
    }
    try {
      delete sdState._ffBoundContainer.__ffStaffSearchBound;
    } catch (_) {}
    sdState._ffBoundContainer = null;
  }
  if (!sdState._onDocActionClick) {
    sdState._onDocActionClick = (e) => ffHandleStaffDocumentActionClick(e);
  }
  if (sdState._ffBoundContainer !== container) {
    container.addEventListener("click", sdState._onDocActionClick);
    sdState._ffBoundContainer = container;
  }
  ensureStaffDocSearchListeners(container);

  const key = `${sid}::${stid}`;
  if (sdState._mountedKey !== key) {
    container.innerHTML = `<p style="margin:0;font-size:13px;color:#6b7280;">Loading documents…</p>`;
    ensureSubscription(sid, stid);
    return;
  }

  sdState._mountCtx = { salonId: sid, staffId: stid };
  if (sdState._lastDocList !== null) {
    renderListIntoContainer(container, sdState._lastDocList);
  } else {
    container.innerHTML = `<p style="margin:0;font-size:13px;color:#6b7280;">Loading documents…</p>`;
  }
}

if (typeof window !== "undefined") {
  window.ffStaffDocumentsUnmount = ffStaffDocumentsUnmount;
  window.ffMountStaffDocuments = ffMountStaffDocuments;
  window.ffMountStaffDocumentsSummaryStrip = ffMountStaffDocumentsSummaryStrip;
  window.ffStaffDocToast = ffToast;
  window.ffResyncStaffDocumentFromInbox = (salonId, inboxItemId) =>
    ffResyncStaffDocumentFromInbox(db, salonId, inboxItemId);
  /** For console debugging: run `ffStaffDocDebugContext()` while Staff → Documents is open. */
  window.ffStaffDocDebugContext = function () {
    return {
      mountCtx: { salonId: sdState._mountCtx.salonId, staffId: sdState._mountCtx.staffId },
      mountedKey: sdState._mountedKey,
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
