/**
 * staff-documents-ui.js — Staff Documents UI layer split out of staff-documents.js:
 * toasts, confirm dialog, edit-metadata modal, file viewers (incl. iOS), the replace-file
 * modal + writer, and the delegated document action-click handler. Reads/writes the shared
 * sdState; render + expiry-chat callbacks are injected (named identically to the originals)
 * so the moved code is byte-verbatim and the module graph stays acyclic.
 */
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  deleteField,
  increment,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { db, auth, storage } from "/app.js?v=20260610_force_lp_ios";
import {
  ffOpenInAppDocumentOverlay,
  ffIsPhoneDocViewer,
} from "/inapp-pdf-viewer.js?v=20260825_od_iospdf";
import { sdState, STAFF_DOC_FILTER_IDS, getMediaDownloadUrlCallable } from "./staff-documents-state.js?v=20260701_staffdoc_state_split";
import {
  trimStr,
  parseExpirationForStaffDoc,
  ffComputeLifecycleFromExpiration,
  escapeHtml,
  escapeAttr,
  ffExpirationTimestampToYmdInput,
  ffStaffDocumentTypeSelectOptionsHtml,
  isPortalEsignDocument,
} from "./staff-documents-format.js?v=20260809_esign_e5";

// Injected from staff-documents.js (render + expiry-chat still live there until C3/C4).
// Kept under the original names so the moved code below stays byte-verbatim.
let renderListIntoContainer = () => {};
let ffRunExpiryChatNotify = async () => false;
export function initStaffDocumentsUi(deps) {
  if (deps && typeof deps.renderListIntoContainer === "function") renderListIntoContainer = deps.renderListIntoContainer;
  if (deps && typeof deps.ffRunExpiryChatNotify === "function") ffRunExpiryChatNotify = deps.ffRunExpiryChatNotify;
}

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
  const isBlob = /^(blob:|data:)/i.test(String(url || ""));
  if (isBlob || ffStaffDocsIsImageDocument(url, fileName)) {
    return ffOpenInAppDocumentOverlay(url, fileName || "Document");
  }
  const rid = `ffstaffdoc_view_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const safeTitle = escapeHtml(fileName || "Document");
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
      <iframe src="${escapeAttr(url)}" title="${safeTitle}" style="width:100%;height:100%;border:0;background:#fff;"></iframe>
    </div>`;
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
  const isBlob = /^(blob:|data:)/i.test(String(url || ""));
  const phone = ffStaffDocsIsIosMobile() || ffIsPhoneDocViewer();
  if (ffStaffDocsIsIosMobile() || (isBlob && phone)) {
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

/** S1 sealed paths — client Storage read denied; use getOnboardingArtifactReadUrl. */
function isSealedOnboardingStoragePath(storagePath) {
  const p = trimStr(storagePath);
  if (!p) return false;
  if (p.startsWith("onboardingArtifacts/")) return true;
  if (p.includes("/onboarding-portal/") || p.includes("/onboarding-signature-library/")) {
    return true;
  }
  return /_signed\.pdf$/i.test(p) || /_certificate\.pdf$/i.test(p);
}

function isOnboardingLinkedDoc(d, storagePath) {
  if (isPortalEsignDocument(d)) return true;
  if (isSealedOnboardingStoragePath(storagePath)) return true;
  if (trimStr(d && d.onboardingRunId) || trimStr(d && d.onboardingTaskId)) return true;
  return false;
}

function onboardingReadKind(d, storagePath) {
  const path = trimStr(storagePath);
  if (String((d && d.esignKind) || "").toLowerCase() === "certificate") {
    return "certificate";
  }
  if (/_certificate\.pdf$/i.test(path)) return "certificate";
  if (isPortalEsignDocument(d) || /_signed\.pdf$/i.test(path)) return "signed";
  return "upload";
}

async function resolveOnboardingArtifactReadUrl(storagePath, staffId, docData) {
  const d = docData || {};
  const getter =
    typeof window !== "undefined" &&
    typeof window.ffGetOnboardingArtifactReadUrl === "function"
      ? window.ffGetOnboardingArtifactReadUrl
      : null;
  if (!getter) {
    throw new Error("Onboarding read module not loaded yet. Refresh and try again.");
  }
  const meta = await getter({
    storagePath: trimStr(storagePath),
    staffId: trimStr(staffId),
    runId: trimStr(d.onboardingRunId),
    taskId: trimStr(d.onboardingTaskId),
    kind: onboardingReadKind(d, storagePath),
  });
  return trimStr(meta && (meta.readUrl || meta.url));
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

  // Sealed e-sign docs: view only (no edit / archive / replace / delete)
  if (
    action &&
    action !== "view" &&
    ["edit_meta", "archive", "unarchive", "delete_permanent", "replace"].includes(
      action
    )
  ) {
    try {
      const snapGate = await getDoc(ref);
      if (snapGate.exists() && isPortalEsignDocument(snapGate.data() || {})) {
        ffToast("E-signed documents are sealed and can’t be changed.", "error");
        return;
      }
    } catch (_) {}
  }

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
      const onboardingLinked = isOnboardingLinkedDoc(d, storagePath);

      // S7: onboarding files — never getDownloadURL / stored fileUrl.
      // Use short-lived getOnboardingArtifactReadUrl only.
      if (
        onboardingLinked &&
        (storagePath ||
          (trimStr(d.onboardingRunId) && trimStr(d.onboardingTaskId)))
      ) {
        if (!auth.currentUser) {
          closePopupIfOpen(tab);
          ffToast("Sign in to view files.", "error");
          return;
        }
        const url = await resolveOnboardingArtifactReadUrl(
          storagePath,
          staffId,
          d
        );
        if (url) {
          openStaffDocumentResolvedUrl(url, tab, fileNameHint);
        } else {
          closePopupIfOpen(tab);
          ffToast("Could not open onboarding document.", "error");
        }
        return;
      }

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
        // Fallback: path may be an onboarding artifact without via=portal_esign
        if (!url && isSealedOnboardingStoragePath(storagePath)) {
          try {
            url = await resolveOnboardingArtifactReadUrl(
              storagePath,
              staffId,
              d
            );
          } catch (aerr) {
            console.warn("[staff-documents] artifact readUrl", aerr);
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

export {
  ffToast,
  ffStaffDocumentsConfirm,
  refreshStaffDocViewerEditMeta,
  ffOpenStaffDocumentEditMetadataModal,
  closePopupIfOpen,
  openBlankTabForLaterNavigation,
  assignUrlToTabOrOpenFresh,
  ffStaffDocsIsIosMobile,
  ffStaffDocsIsImageDocument,
  ffOpenStaffDocumentIosViewer,
  openStaffDocumentResolvedUrl,
  ffOpenReplaceDocumentModal,
  ffReplaceStaffDocumentVersion,
  ffStaffDocClickTargetEl,
  ffHandleStaffDocumentActionClick,
};
