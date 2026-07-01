/**
 * Inbox — Manager / staff action handlers
 * approve / deny / archive / delete / staff-reply / needs-info / doc-response /
 * supply-apply / doc-metadata-edit, plus doc-alert helpers. All are window.*
 * handlers invoked from rendered onclick markup. Extracted verbatim from inbox.js (M7).
 *
 * Injection: loadInboxItems (stays in inbox.js — many other callers).
 */

import {
  doc,
  updateDoc,
  serverTimestamp,
  getDoc,
  deleteDoc,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { db, storage } from "/app.js?v=20260610_force_lp_ios";
import { inboxState } from "./inbox-state.js?v=20260629_inbox_state_split";
import { showToast, showConfirmModal, showPromptModal } from "./inbox-utils.js?v=20260630_inbox_utils_split";
import { inboxCanManageInbox, inboxCanSendRequests } from "./inbox-data.js?v=20260630_inbox_data_split";
import { ffInboxYmdFromRaw, inboxSupplyRequestIsPending } from "./inbox-helpers.js?v=20260626_inbox_helpers_split";
import { renderInboxList } from "./inbox-list-render.js?v=20260630_inbox_list_render_split";
import { showRequestDetails } from "./inbox-details.js?v=20260630_inbox_details_split";
import {
  approveSupplyRequest,
  denySupplyRequest,
  applyApprovedSupplyRequestToInventory,
} from "./inbox-supplies.js?v=20260629_inbox_supplies_split";
import {
  ffSyncStaffDocumentOnInboxApprove,
  ffSyncStaffDocumentOnInboxReject,
  ffSendExpiryChatReminderForStaffDocContext,
  ffStaffDocumentTypeSelectOptionsHtml,
} from "./staff-documents.js?v=20260701_staffdoc_render_split";

// loadInboxItems lives in inbox.js (many callers); injected here.
let loadInboxItems = () => {};
export function initInboxActions(deps = {}) {
  if (typeof deps.loadInboxItems === "function") loadInboxItems = deps.loadInboxItems;
}

// =====================
// Manager Actions (will be Cloud Functions in final version)
// =====================
window.submitStaffReply = async function(requestId) {
  const replyInput = document.getElementById('staffReplyInput');
  const reply = replyInput?.value?.trim();
  if (!reply) { showToast('Please enter a reply', 'error'); return; }

  closeRequestDetailsModal();
  inboxState.currentRequests = inboxState.currentRequests.filter(r => r.id !== requestId);
  renderInboxList();

  try {
    const salonId = inboxState.currentUserProfile.salonId;
    await updateDoc(doc(db, `salons/${salonId}/inboxItems`, requestId), {
      staffReply: reply,
      status: 'open',
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      unreadForManagers: true
    });
    showToast('Reply submitted! Request is back to Open status.', 'success');
  } catch (error) {
    console.error('[Inbox] submitStaffReply error', error);
    showToast(`Error: ${error.message}`, 'error');
    loadInboxItems();
  }
};

window.needsMoreInfo = async function(requestId) {
  if (!inboxCanManageInbox()) {
    if (typeof showToast === "function") showToast("You do not have permission to update requests.", "error");
    return;
  }
  const question = await showPromptModal({
    title: 'Request More Info',
    message: 'What information do you need from the staff member?',
    placeholder: 'e.g. Please provide the exact dates...',
    confirmLabel: 'Send',
    cancelLabel: 'Cancel',
    required: true
  });
  if (!question) return;

  closeRequestDetailsModal();
  inboxState.currentRequests = inboxState.currentRequests.filter(r => r.id !== requestId);
  renderInboxList();

  try {
    const salonId = inboxState.currentUserProfile.salonId;
    await updateDoc(doc(db, `salons/${salonId}/inboxItems`, requestId), {
      status: 'needs_info',
      needsInfoQuestion: question,
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      unreadForManagers: false
    });
    showToast('Request updated - waiting for staff response', 'success');
  } catch (error) {
    console.error('[Inbox] needsMoreInfo error', error);
    showToast(`Error: ${error.message}`, 'error');
    loadInboxItems();
  }
};

window.uploadDocumentResponse = async function(requestId) {
  if (!inboxCanManageInbox()) {
    if (typeof showToast === "function") showToast("You do not have permission to upload a response.", "error");
    return;
  }
  const request = inboxState.currentRequests.find(r => r.id === requestId);
  if (!request || request.type !== 'document_request') return;
  const fileInput = document.getElementById('docResponseFile_' + requestId);
  if (!fileInput?.files?.length) {
    showToast('Please select a file', 'error');
    return;
  }
  const file = fileInput.files[0];
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    showToast('File must be under 10 MB', 'error');
    return;
  }
  try {
    const salonId = inboxState.currentUserProfile.salonId;
    const yyyyMm = new Date().toISOString().slice(0, 7);
    const fileId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const safeName = (file.name || 'response').replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 80);
    const path = `salons/${salonId}/inboxDocuments/${requestId}/${yyyyMm}/${fileId}_${safeName}`;
    showToast('Uploading...', 'info');
    const fileRef = storageRef(storage, path);
    await uploadBytes(fileRef, file);
    const responseFileUrl = await getDownloadURL(fileRef);
    const currentData = request.data || {};
    await updateDoc(doc(db, `salons/${salonId}/inboxItems`, requestId), {
      data: { ...currentData, responseFileUrl, responseFilePath: path },
      status: 'done',
      decidedBy: inboxState.currentUserProfile.uid,
      decidedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      unreadForManagers: false
    });
    closeRequestDetailsModal();
    showToast('Response file uploaded and request marked Done!', 'success');
    loadInboxItems();
  } catch (err) {
    console.error('[Inbox] uploadDocumentResponse error', err);
    showToast('Upload failed: ' + err.message, 'error');
  }
};

window.markBirthdayReminderDone = async function(requestId) {
  if (!inboxCanManageInbox()) {
    if (typeof showToast === "function") showToast("You do not have permission to archive this item.", "error");
    return;
  }
  closeRequestDetailsModal();
  inboxState.currentRequests = inboxState.currentRequests.filter(r => r.id !== requestId);
  renderInboxList();
  try {
    const salonId = inboxState.currentUserProfile.salonId;
    await updateDoc(doc(db, `salons/${salonId}/inboxItems`, requestId), {
      status: 'archived',
      decidedBy: inboxState.currentUserProfile.uid,
      decidedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      unreadForManagers: false
    });
    showToast('Moved to Archive', 'success');
  } catch (error) {
    console.error('[Inbox] markBirthdayReminderDone error', error);
    showToast(`Error: ${error.message}`, 'error');
    loadInboxItems();
  }
};

/** Opens Staff Members modal on the given staff id (Documents tab). Uses global openStaffMembersModal from index.html. */
window.openDocumentAlertStaffMember = function(staffId) {
  const id = String(staffId || '').trim();
  if (!id) return;
  if (typeof window.closeRequestDetailsModal === 'function') window.closeRequestDetailsModal();
  if (typeof window.openStaffMembersModal === 'function') {
    window.openStaffMembersModal({ jumpToStaffId: id, jumpToTab: 'documents' });
  }
};

/** Same chat reminder as Staff → Documents (expiring soon). Payload: { salonId, staffId, documentId }. */
window.ffDocAlertSendChatReminder = async function (payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const salonId = String(p.salonId || inboxState.currentUserProfile?.salonId || '').trim();
  const staffId = String(p.staffId || '').trim();
  const docId = String(p.documentId || '').trim();
  if (!salonId || !staffId || !docId) {
    if (typeof showToast === 'function') showToast('Missing staff or document.', 'error');
    return;
  }
  try {
    await ffSendExpiryChatReminderForStaffDocContext({ salonId, staffId, docId });
  } catch (e) {
    console.warn('[Inbox] ffDocAlertSendChatReminder', e);
  }
};

/** Opens New Request → "Request a new document (from staff)" with staff / type / related doc prefilled (e.g. from expiry alert). */
window.ffOpenDocumentRenewalFromAlert = function (opts) {
  if (!inboxCanSendRequests()) {
    if (typeof showToast === 'function') showToast('You do not have permission to create requests.', 'error');
    return;
  }
  const o = opts && typeof opts === 'object' ? opts : {};
  window.__ffDocRenewalPrefill = {
    staffId: String(o.staffId || '').trim(),
    documentType: String(o.documentType || '').trim(),
    documentId: String(o.documentId || '').trim(),
  };
  if (typeof window.closeRequestDetailsModal === 'function') window.closeRequestDetailsModal();
  if (typeof window.closeCreateRequestModal === 'function') window.closeCreateRequestModal();
  if (typeof window.openCreateRequestModal === 'function') window.openCreateRequestModal();
  if (typeof window.selectRequestType === 'function') window.selectRequestType('document_renewal_request');
};

/**
 * Manager: edit document type / expiration on inbox item before approving (document_upload / document_request).
 */
window.ffInboxOpenDocumentMetadataEdit = async function (requestId) {
  if (!inboxCanManageInbox()) {
    if (typeof showToast === "function") showToast("You do not have permission to edit this request.", "error");
    return;
  }
  const rid = String(requestId || "").trim();
  if (!rid || !inboxState.currentUserProfile?.salonId) return;
  const salonId = inboxState.currentUserProfile.salonId;
  const inboxRef = doc(db, `salons/${salonId}/inboxItems`, rid);
  let snap;
  try {
    snap = await getDoc(inboxRef);
  } catch (e) {
    console.warn("[Inbox] edit metadata get", e);
    showToast("Could not load request.", "error");
    return;
  }
  if (!snap.exists()) {
    showToast("Request not found.", "error");
    return;
  }
  const item = { id: rid, ...snap.data() };
  const t = String(item.type || "").trim();
  if (t !== "document_upload" && t !== "document_request") {
    showToast("Editing is only for document upload or request.", "info");
    return;
  }
  const d = item.data || {};
  const curType = String(d.documentType || "").trim();
  let curExp = "";
  if (t === "document_upload") {
    curExp =
      ffInboxYmdFromRaw(d.expirationDate) || ffInboxYmdFromRaw(d.expiryDate) || ffInboxYmdFromRaw(d.dueDate);
  } else {
    curExp = ffInboxYmdFromRaw(d.dueDate) || ffInboxYmdFromRaw(d.expirationDate);
  }

  const overlayRid = `ffinbox_editdoc_${Date.now()}`;
  const overlay = document.createElement("div");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000000;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;overflow-y:auto;";
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;max-width:420px;width:100%;box-shadow:0 25px 50px rgba(0,0,0,0.2);">
      <div style="font-size:18px;font-weight:700;margin-bottom:8px;color:#111827;">Edit document details</div>
      <p style="margin:0 0 16px;font-size:13px;color:#6b7280;">Updates what will be saved to the staff profile when you approve.</p>
      <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;">Document type</label>
      <select id="${overlayRid}_type" style="width:100%;padding:12px;margin-bottom:12px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;">${ffStaffDocumentTypeSelectOptionsHtml()}</select>
      <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;">Expiration / due date</label>
      <input type="date" id="${overlayRid}_exp" style="width:100%;padding:12px;margin-bottom:8px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;" />
      <p style="margin:0 0 16px;font-size:11px;color:#9ca3af;">Clear the date field if not applicable.</p>
      <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;">
        <button type="button" data-ff-cancel style="padding:10px 18px;border-radius:8px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-weight:600;cursor:pointer;font-size:14px;">Cancel</button>
        <button type="button" data-ff-save style="padding:10px 18px;border-radius:8px;border:none;background:#7c3aed;color:#fff;font-weight:600;cursor:pointer;font-size:14px;">Save</button>
      </div>
    </div>`;
  const sel = overlay.querySelector(`#${overlayRid}_type`);
  if (sel && curType) {
    try {
      sel.value = curType;
    } catch (_) {}
  }
  const expIn = overlay.querySelector(`#${overlayRid}_exp`);
  if (expIn) expIn.value = curExp;

  const remove = () => {
    try {
      overlay.remove();
    } catch (_) {}
  };
  const onKey = (ev) => {
    if (ev.key === "Escape") remove();
  };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) remove();
  });
  overlay.querySelector("[data-ff-cancel]").onclick = () => {
    document.removeEventListener("keydown", onKey);
    remove();
  };
  overlay.querySelector("[data-ff-save]").onclick = async () => {
    const ty = String(sel?.value || "").trim();
    const ex = String(expIn?.value || "").trim();
    if (!ty) {
      showToast("Select a document type.", "error");
      return;
    }
    const merged = { ...d };
    merged.documentType = ty;
    if (t === "document_upload") {
      if (ex) {
        merged.expirationDate = ex;
        merged.expiryDate = ex;
        merged.dueDate = ex;
      } else {
        merged.expirationDate = null;
        merged.expiryDate = null;
        merged.dueDate = null;
      }
    } else {
      if (ex) {
        merged.dueDate = ex;
        merged.expirationDate = ex;
      } else {
        merged.dueDate = null;
        merged.expirationDate = null;
      }
    }
    try {
      await updateDoc(inboxRef, {
        data: merged,
        updatedAt: serverTimestamp(),
      });
      const fresh = await getDoc(inboxRef);
      if (fresh.exists()) {
        const row = { id: rid, ...fresh.data() };
        const idx2 = inboxState.currentRequests.findIndex((r) => r.id === rid);
        if (idx2 !== -1) inboxState.currentRequests[idx2] = row;
      }
      showToast("Details saved.", "success");
      document.removeEventListener("keydown", onKey);
      remove();
      if (typeof closeRequestDetailsModal === "function") closeRequestDetailsModal();
      showRequestDetails(rid);
    } catch (err) {
      console.warn("[Inbox] save document metadata", err);
      showToast(String(err?.message || err || "Could not save."), "error");
    }
  };
  document.body.appendChild(overlay);
};

window.approveRequest = async function(requestId) {
  if (!inboxCanManageInbox()) {
    if (typeof showToast === "function") showToast("You do not have permission to approve requests.", "error");
    return;
  }
  const confirmed = await showConfirmModal({
    title: 'Approve request?',
    message: 'This will mark the request as approved.',
    confirmLabel: 'Approve',
    cancelLabel: 'Cancel',
    danger: false
  });
  if (!confirmed) return;

  // Optimistic: remove immediately from UI before Firestore confirms
  closeRequestDetailsModal();
  inboxState.currentRequests = inboxState.currentRequests.filter(r => r.id !== requestId);
  renderInboxList();

  try {
    const salonId = inboxState.currentUserProfile.salonId;
    const inboxRef = doc(db, `salons/${salonId}/inboxItems`, requestId);
    const snap = await getDoc(inboxRef);
    if (!snap.exists()) {
      showToast('Request not found.', 'error');
      loadInboxItems();
      return;
    }
    const item = snap.data();
    if (String(item.status || "").trim() === "approved") {
      showToast("Already approved.", "info");
      loadInboxItems();
      return;
    }

    if (String(item.type || "").trim() === "supplies") {
      if (!inboxSupplyRequestIsPending({ type: "supplies", status: item.status })) {
        showToast("This supply request is no longer pending.", "info");
        loadInboxItems();
        return;
      }
      await approveSupplyRequest(requestId, item.data || {});
      showToast("Request approved!", "success");
      return;
    }

    let staffDocumentId = null;
    if (item.type === 'document_upload' || item.type === 'document_request') {
      staffDocumentId = await ffSyncStaffDocumentOnInboxApprove(db, {
        salonId,
        inboxItemId: requestId,
        inboxItem: { id: requestId, ...item },
        approverUid: inboxState.currentUserProfile.uid,
      });
      if (!staffDocumentId) {
        console.warn('[Inbox] Approve sync returned no staff document id', requestId, item.type, item.data);
        showToast(
          'Could not attach this file to a staff profile (missing staff link). Open the request details and check Document belongs to / staff fields, or contact support.',
          'error'
        );
        loadInboxItems();
        return;
      }
    }

    const approvePayload = {
      status: 'approved',
      decidedBy: inboxState.currentUserProfile.uid,
      decidedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      unreadForManagers: false,
    };
    if (staffDocumentId) approvePayload.staffDocumentId = staffDocumentId;

    await updateDoc(inboxRef, approvePayload);
    showToast('Request approved!', 'success');
  } catch (error) {
    console.error('[Inbox] approve error', error);
    showToast(`Error: ${error.message}`, 'error');
    loadInboxItems(); // restore on failure
  }
};

window.denyRequest = async function(requestId) {
  if (!inboxCanManageInbox()) {
    if (typeof showToast === "function") showToast("You do not have permission to deny requests.", "error");
    return;
  }
  const confirmed = await showConfirmModal({
    title: 'Deny request?',
    message: 'This will mark the request as denied. You can add a note below.',
    confirmLabel: 'Deny',
    cancelLabel: 'Cancel',
    danger: true
  });
  if (!confirmed) return;

  const reason = await showPromptModal({
    title: 'Add a note (optional)',
    message: 'Why is this request denied?',
    placeholder: 'Optional reason...',
    confirmLabel: 'Deny',
    cancelLabel: 'Back',
    required: false
  });
  if (reason === null) return;

  // Optimistic: remove immediately from UI before Firestore confirms
  closeRequestDetailsModal();
  inboxState.currentRequests = inboxState.currentRequests.filter(r => r.id !== requestId);
  renderInboxList();

  try {
    const salonId = inboxState.currentUserProfile.salonId;
    const inboxRef = doc(db, `salons/${salonId}/inboxItems`, requestId);
    const snap = await getDoc(inboxRef);
    if (!snap.exists()) {
      showToast('Request not found.', 'error');
      loadInboxItems();
      return;
    }
    const item = snap.data();
    if (String(item.type || "").trim() === "supplies") {
      if (String(item.status || "").trim() === "denied") {
        showToast("Already denied.", "info");
        loadInboxItems();
        return;
      }
      await denySupplyRequest(requestId, reason || null);
      showToast("Request denied", "success");
      return;
    }

    if (item.type === 'document_upload' || item.type === 'document_request') {
      await ffSyncStaffDocumentOnInboxReject(db, { salonId, inboxItem: item });
    }

    await updateDoc(inboxRef, {
      status: 'denied',
      decidedBy: inboxState.currentUserProfile.uid,
      decidedAt: serverTimestamp(),
      responseNote: reason || null,
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      unreadForManagers: false
    });
    showToast('Request denied', 'success');
  } catch (error) {
    console.error('[Inbox] deny error', error);
    showToast(`Error: ${error.message}`, 'error');
    loadInboxItems(); // restore on failure
  }
};

window.applyApprovedSupplyRequestToInventory = applyApprovedSupplyRequestToInventory;
window.approveSupplyRequest = approveSupplyRequest;
window.denySupplyRequest = denySupplyRequest;

/** Retry path for already-approved supply requests that never hit Inventory. */
window.ffInboxApplySupplyToInventory = async function (requestId, btnEl) {
  try {
    if (!inboxCanManageInbox()) {
      if (typeof showToast === "function") showToast("You do not have permission.", "error");
      return;
    }
    const salonId = inboxState.currentUserProfile?.salonId;
    if (!salonId || !requestId) return;
    if (btnEl instanceof HTMLButtonElement) {
      btnEl.disabled = true;
      btnEl.textContent = "Applying…";
    }
    const snap = await getDoc(doc(db, `salons/${salonId}/inboxItems`, requestId));
    if (!snap.exists()) {
      if (typeof showToast === "function") showToast("Request not found.", "error");
      return;
    }
    const item = snap.data();
    if (String(item.status || "").trim() !== "approved") {
      if (typeof showToast === "function") showToast("Request is not approved yet.", "error");
      return;
    }
    if (item.appliedToInventory === true) {
      if (typeof showToast === "function") showToast("Already applied.", "info");
      if (typeof closeRequestDetailsModal === "function") closeRequestDetailsModal();
      showRequestDetails(requestId);
      return;
    }
    const result = await applyApprovedSupplyRequestToInventory(requestId, item.data || {});
    const n = result && typeof result.totalContributions === "number" ? result.totalContributions : 0;
    if (typeof showToast === "function") {
      showToast(
        n === 1 ? "Added 1 item to inventory Order." : `Added ${n} items to inventory Order.`,
        "success"
      );
    }
    if (typeof closeRequestDetailsModal === "function") closeRequestDetailsModal();
    showRequestDetails(requestId);
  } catch (e) {
    console.error("[Inbox] Apply to Inventory retry failed", e);
    if (btnEl instanceof HTMLButtonElement) {
      btnEl.disabled = false;
      btnEl.textContent = "Apply to Inventory";
    }
    const msg = e && typeof e.message === "string" ? e.message : "Unknown error";
    if (typeof showToast === "function") showToast(`Could not apply: ${msg}`, "error");
  }
};

window.archiveRequest = async function(requestId) {
  if (!inboxCanManageInbox()) {
    if (typeof showToast === "function") showToast("You do not have permission to archive requests.", "error");
    return;
  }
  const confirmed = await showConfirmModal({
    title: 'Move to Archive?',
    message: 'This request will be moved to the archive. You can delete it later from there.',
    confirmLabel: 'Archive',
    cancelLabel: 'Cancel',
    danger: false
  });
  if (!confirmed) return;

  closeRequestDetailsModal();
  inboxState.currentRequests = inboxState.currentRequests.filter(r => r.id !== requestId);
  renderInboxList();

  try {
    const salonId = inboxState.currentUserProfile.salonId;
    const ref = doc(db, `salons/${salonId}/inboxItems`, requestId);
    const prevSnap = await getDoc(ref);
    const previousStatus = String(prevSnap.data()?.status || "").trim() || null;
    await updateDoc(ref, {
      status: 'archived',
      previousStatus,
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    showToast('Request archived', 'success');
  } catch (error) {
    console.error('[Inbox] archive error', error);
    showToast(`Error: ${error.message}`, 'error');
    loadInboxItems();
  }
};

window.deleteArchivedRequest = async function(requestId) {
  if (!inboxCanManageInbox()) {
    if (typeof showToast === "function") showToast("You do not have permission to delete requests.", "error");
    return;
  }
  const confirmed = await showConfirmModal({
    title: 'Delete permanently?',
    message: 'This request will be deleted and cannot be recovered.',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    danger: true
  });
  if (!confirmed) return;
  
  try {
    const salonId = inboxState.currentUserProfile.salonId;
    await deleteDoc(doc(db, `salons/${salonId}/inboxItems`, requestId));
    
    closeRequestDetailsModal();
    loadInboxItems();
    showToast('Request deleted', 'success');
  } catch (error) {
    console.error('[Inbox] delete error', error);
    showToast(`Error: ${error.message}`, 'error');
  }
};
