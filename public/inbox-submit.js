/**
 * Inbox — Submit Request (create flow)
 * Builds per-type request data, uploads document files, writes inboxItems docs.
 * Includes uploader staff-id resolution helpers. Extracted verbatim from inbox.js (M5).
 *
 * Export: submitRequest (consumed by inbox-create-form.js).
 * Injection: loadInboxItems (stays in inbox.js — many other callers).
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { db, auth, storage } from "/app.js?v=20260610_force_lp_ios";
import { inboxState } from "./inbox-state.js?v=20260810_owner_inbox_load_v5";
import { showToast } from "./inbox-utils.js?v=20260630_inbox_utils_split";
import { getRequestTypeInfo } from "./inbox-types.js?v=20260810_owner_inbox_load_v5";
import {
  enumerateInclusiveDateKeysForInbox,
  ffInboxRuleString,
  suppliesRowRequiresVariant,
} from "./inbox-helpers.js?v=20260810_owner_inbox_load_v5";
import {
  classifySuppliesRow,
  readSuppliesRowSnapshot,
} from "./inbox-supplies.js?v=20260629_inbox_supplies_split";
import {
  loadCurrentUserProfile,
  mergeSalonStaffIntoUserProfile,
  inboxCanSendRequests,
  getCreateRequestSelectedRecipients,
  getInboxRecipientsList,
  loadSalonUsersForRecipients,
  resolveCurrentInboxActorName,
} from "./inbox-data.js?v=20260810_owner_inbox_load_v5";

// loadInboxItems lives in inbox.js (many callers); injected here.
let loadInboxItems = () => {};
export function initInboxSubmit(deps = {}) {
  if (typeof deps.loadInboxItems === "function") loadInboxItems = deps.loadInboxItems;
}

/** Prevents duplicate inboxItem creates from rapid Submit clicks. */
let submitRequestInFlight = false;

/**
 * Match `salons/{salonId}/staff/{docId}` by firebaseUid or email (same id as Staff modal).
 * Kept in inbox.js so a stale cached staff-documents.js cannot break the whole app.
 */
async function ffResolveStaffFirestoreIdByScanInbox(salonId, uid, emailHint) {
  const sid = String(salonId || "").trim();
  const u = String(uid || "").trim();
  if (!sid || !u) return "";
  let em = String(emailHint || "").trim().toLowerCase();
  if (!em) {
    try {
      const uSnap = await getDoc(doc(db, "users", u));
      if (uSnap.exists()) em = String(uSnap.data()?.email || "").trim().toLowerCase();
    } catch (e) {
      console.warn("[Inbox] scan: users email", e);
    }
  }
  try {
    const snap = await getDocs(collection(db, `salons/${sid}/staff`));
    for (const d of snap.docs) {
      const row = d.data() || {};
      const fid = String(row.firebaseUid || row.firebaseAuthUid || row.authUid || "").trim();
      if (fid && fid === u) return d.id;
      // Firestore rules (staffDocUidMatches) also accept staff row `uid` / `userUid`
      const uidOnRow = String(row.uid || row.userUid || "").trim();
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
    console.warn("[Inbox] scan staff collection", e);
  }
  return "";
}

/** Firestore staff doc id for the signed-in uploader (scan uid/email first, then profile/members/users). */
async function resolveSubmittingStaffIdForDocumentUpload(salonId) {
  const sid = String(salonId || "").trim();
  const uid = String(auth?.currentUser?.uid || inboxState.currentUserProfile?.uid || "").trim();
  if (!sid || !uid) return "";
  const emailHint = String(inboxState.currentUserProfile?.email || "").trim();
  const scanned = await ffResolveStaffFirestoreIdByScanInbox(sid, uid, emailHint);
  if (scanned) return scanned;
  let id = String(inboxState.currentUserProfile?.staffId || "").trim();
  if (id) return id;
  try {
    const mSnap = await getDoc(doc(db, "salons", sid, "members", uid));
    if (mSnap.exists()) {
      const ms = String(mSnap.data()?.staffId || "").trim();
      if (ms) return ms;
    }
  } catch (e) {
    console.warn("[Inbox] uploader members", e);
  }
  try {
    const uSnap = await getDoc(doc(db, "users", uid));
    if (uSnap.exists()) {
      const us = String(uSnap.data()?.staffId || "").trim();
      if (us) return us;
    }
  } catch (e) {
    console.warn("[Inbox] uploader users", e);
  }
  return "";
}


export async function submitRequest(type) {
  if (submitRequestInFlight) return;

  submitRequestInFlight = true;
  const submitBtn = Array.from(document.querySelectorAll("#createRequestModal button")).find(
    (b) => (b.textContent || "").trim() === "Submit Request"
  );
  if (submitBtn) submitBtn.disabled = true;

  let submitSucceeded = false;
  try {
  console.log('[Inbox] Submitting request:', type);

  await loadCurrentUserProfile();
  if (!inboxState.currentUserProfile) {
    showToast('User profile not loaded', 'error');
    return;
  }

  const salonIdForStaff = String(inboxState.currentUserProfile.salonId || '').trim();
  if (!salonIdForStaff) {
    showToast('No salon is selected for this account.', 'error');
    return;
  }

  let creatorStaffId = String(inboxState.currentUserProfile.staffId || '').trim();
  if (!creatorStaffId) {
    creatorStaffId = await resolveSubmittingStaffIdForDocumentUpload(salonIdForStaff);
  }
  if (!creatorStaffId) {
    showToast(
      'Your login is not linked to a staff profile in this salon. Ask a manager to link your account, then try again.',
      'error'
    );
    return;
  }
  if (String(inboxState.currentUserProfile.staffId || '').trim() !== creatorStaffId) {
    inboxState.currentUserProfile.staffId = creatorStaffId;
    await mergeSalonStaffIntoUserProfile(inboxState.currentUserProfile);
  }

  if (!inboxCanSendRequests()) {
    showToast('You do not have permission to create requests.', 'error');
    return;
  }

    // Collect form data
    let data = {};
    
    if (type === 'vacation') {
      const startDate = document.getElementById('vacation_startDate')?.value;
      const endDate = document.getElementById('vacation_endDate')?.value;
      const note = document.getElementById('vacation_note')?.value || null;
      
      if (!startDate || !endDate) {
        showToast('Please fill in all required fields', 'error');
        return;
      }
      
      // Calculate days
      const start = new Date(startDate);
      const end = new Date(endDate);
      const daysCount = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
      
      data = {
        startDate,
        endDate,
        daysCount,
        note,
        subjectUid: inboxState.currentUserProfile.uid,
        subjectStaffId: inboxState.currentUserProfile.staffId || '',
      };
      
    } else if (type === 'late_start') {
      const date = document.getElementById('latestart_date')?.value;
      const time = document.getElementById('latestart_time')?.value;
      const reason = document.getElementById('latestart_reason')?.value;
      
      if (!date || !time || !reason) {
        showToast('Please fill in all required fields', 'error');
        return;
      }
      
      data = {
        date,
        requestedTime: time,
        startTime: time,
        reason,
        normalTime: null,
        subjectUid: inboxState.currentUserProfile.uid,
        subjectStaffId: inboxState.currentUserProfile.staffId || '',
      };
      
    } else if (type === 'early_leave') {
      const date = document.getElementById('earlyleave_date')?.value;
      const time = document.getElementById('earlyleave_time')?.value;
      const reason = document.getElementById('earlyleave_reason')?.value;
      
      if (!date || !time || !reason) {
        showToast('Please fill in all required fields', 'error');
        return;
      }
      
      data = {
        date,
        requestedTime: time,
        endTime: time,
        reason,
        normalTime: null,
        subjectUid: inboxState.currentUserProfile.uid,
        subjectStaffId: inboxState.currentUserProfile.staffId || '',
      };
      
    } else if (type === 'day_off') {
      const date = document.getElementById('dayoff_date')?.value;
      const note = document.getElementById('dayoff_note')?.value?.trim() || null;
      if (!date) {
        showToast('Please select a date', 'error');
        return;
      }
      data = {
        date,
        note,
        affectedDates: [date],
        subjectUid: inboxState.currentUserProfile.uid,
        subjectStaffId: inboxState.currentUserProfile.staffId || '',
      };

    } else if (type === 'time_off') {
      const startDate = document.getElementById('timeoff_startDate')?.value;
      const endDate = document.getElementById('timeoff_endDate')?.value || startDate;
      const note = document.getElementById('timeoff_note')?.value?.trim() || null;
      if (!startDate) {
        showToast('Please select the first day off', 'error');
        return;
      }
      const affectedDates = enumerateInclusiveDateKeysForInbox(startDate, endDate);
      data = {
        startDate,
        endDate: endDate || startDate,
        note,
        affectedDates,
        subjectUid: inboxState.currentUserProfile.uid,
        subjectStaffId: inboxState.currentUserProfile.staffId || '',
      };

    } else if (type === 'schedule_change') {
      const current = document.getElementById('schedchange_current')?.value || '';
      const requested = document.getElementById('schedchange_requested')?.value;
      const reason = document.getElementById('schedchange_reason')?.value;
      const isTemporary = document.getElementById('schedchange_temporary')?.checked || false;
      const startDate = document.getElementById('schedchange_startDate')?.value || '';
      const endDate = document.getElementById('schedchange_endDate')?.value || startDate;
      
      if (!requested || !reason) {
        showToast('Please fill in all required fields', 'error');
        return;
      }
      if (!startDate) {
        showToast('Please select the first date this change applies to.', 'error');
        return;
      }
      const affectedDates = enumerateInclusiveDateKeysForInbox(startDate, endDate);
      data = {
        currentSchedule: current,
        requestedSchedule: requested,
        reason,
        isTemporary,
        startDate,
        endDate: endDate || startDate,
        affectedDates,
        subjectUid: inboxState.currentUserProfile.uid,
        subjectStaffId: inboxState.currentUserProfile.staffId || '',
      };
      
    } else if (type === 'extra_shift') {
      const date = document.getElementById('extra_shift_date')?.value || null;
      const details = document.getElementById('extra_shift_details')?.value?.trim();
      if (!details) { showToast('Please enter details', 'error'); return; }
      data = { date, details };
    } else if (type === 'swap_shift') {
      const date = document.getElementById('swap_shift_date')?.value || null;
      const details = document.getElementById('swap_shift_details')?.value?.trim();
      if (!details) { showToast('Please enter details', 'error'); return; }
      data = { date, details };
    } else if (type === 'break_change') {
      const date = document.getElementById('break_change_date')?.value;
      const details = document.getElementById('break_change_details')?.value?.trim();
      if (!date || !details) { showToast('Please fill in date and details', 'error'); return; }
      data = { date, details };
    } else if (type === 'commission_review' || type === 'tip_adjustment' || type === 'payment_issue' || type === 'client_issue') {
      const subject = document.getElementById(type + '_subject')?.value?.trim() || null;
      const details = document.getElementById(type + '_details')?.value?.trim();
      if (!details) { showToast('Please enter details', 'error'); return; }
      data = { subject, details };

    } else if (type === 'document_renewal_request') {
      const documentType = document.getElementById('doc_renew_type')?.value;
      const message = document.getElementById('doc_renew_message')?.value?.trim();
      const dueDate = document.getElementById('doc_renew_due')?.value || null;
      const relatedDocumentId = (document.getElementById('doc_renew_related_document_id')?.value || '').trim();
      if (!documentType || !message) {
        showToast('Please select document type and enter a message', 'error');
        return;
      }
      data = { documentType, message, dueDate, relatedDocumentId: relatedDocumentId || null, promptKind: 'renewal' };

    } else if (type === 'document_request') {
      const documentType = document.getElementById('doc_req_type')?.value;
      const reason = document.getElementById('doc_req_reason')?.value?.trim();
      const dueDate = document.getElementById('doc_req_due')?.value || null;
      const deliveryMethod = document.getElementById('doc_req_delivery')?.value || 'Email';
      const contactEmail = document.getElementById('doc_req_email')?.value?.trim() || auth.currentUser?.email || inboxState.currentUserProfile?.email || null;
      if (!documentType || !reason) { showToast('Please select document type and enter reason', 'error'); return; }
      data = { documentType, reason, dueDate, deliveryMethod, contactEmail };

    } else if (type === 'document_upload') {
      const documentType = document.getElementById('doc_up_type')?.value;
      const expirationDate = document.getElementById('doc_up_expiry')?.value || null;
      const renewForDocId = (document.getElementById('doc_up_renew_for_doc_id')?.value || '').trim();
      const fileInput = document.getElementById('doc_up_file');
      const notes = document.getElementById('doc_up_notes')?.value?.trim() || null;
      const salonId = inboxState.currentUserProfile.salonId;
      const ownerStaffId = await resolveSubmittingStaffIdForDocumentUpload(salonId);
      if (!ownerStaffId) {
        showToast(
          'Your login is not linked to a staff profile in this salon. Ask a manager to link your account, then try again.',
          'error'
        );
        return;
      }
      if (!documentType || !fileInput?.files?.length) { showToast('Please select document type and choose a file', 'error'); return; }
      const file = fileInput.files[0];
      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) { showToast('File must be under 10 MB', 'error'); return; }
      const yyyyMm = new Date().toISOString().slice(0, 7);
      const fileId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const safeName = (file.name || 'file').replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 80);
      const path = `salons/${salonId}/staff/${ownerStaffId}/documents/${documentType}/${yyyyMm}/${fileId}_${safeName}`;
      showToast('Uploading file...', 'info');
      const fileRef = storageRef(storage, path);
      await uploadBytes(fileRef, file);
      const fileUrl = await getDownloadURL(fileRef);
      data = {
        documentType,
        expirationDate,
        filePath: path,
        fileUrl,
        fileName: file.name,
        notes,
        documentOwnerStaffId: ownerStaffId,
        ...(renewForDocId ? { staffDocumentId: renewForDocId } : {}),
      };
      
    } else if (type === 'supplies') {
      const rows = document.querySelectorAll(".supplies-item-row");
      const items = [];
      for (const row of rows) {
        const st = classifySuppliesRow(row);
        if (st === "empty") continue;
        if (st === "incomplete") {
          showToast("Each line with a selection needs category, subcategory, and item.", "error");
          return;
        }
        if (suppliesRowRequiresVariant(row)) {
          const vk = (row.querySelector(".supplies-variant-select")?.value || "").trim();
          if (vk !== "dip" && vk !== "gel" && vk !== "regular") {
            showToast("Select a variant (Dip, Gel, or Regular) for each line that uses variants.", "error");
            return;
          }
        }
        const snap = readSuppliesRowSnapshot(row);
        if (snap) items.push(snap);
      }
      if (items.length === 0) {
        showToast("Add at least one complete line (category, subcategory, and item).", "error");
        return;
      }
      const urgency = document.getElementById("supplies_urgency")?.value || "routine";
      const note = document.getElementById("supplies_note")?.value || null;
      data = { items, urgency, note };
      
    } else if (type === 'maintenance') {
      const issue = document.getElementById('maintenance_issue')?.value;
      const area = document.getElementById('maintenance_area')?.value;
      const severity = document.getElementById('maintenance_severity')?.value || 'minor';
      const note = document.getElementById('maintenance_note')?.value || null;
      
      if (!issue || !area) {
        showToast('Please fill in all required fields', 'error');
        return;
      }
      
      data = { issue, area, severity, note };
      
    } else if (type === 'other') {
      const subject = document.getElementById('other_subject')?.value;
      const details = document.getElementById('other_details')?.value;
      
      if (!subject || !details) {
        showToast('Please fill in all required fields', 'error');
        return;
      }
      
      data = { subject, details };
    } else {
      // Custom request type: either dynamic fields or single Details
      const customType = getRequestTypeInfo(type);
      const fields = (customType.fields || []);
      if (fields.length > 0) {
        data = {};
        for (const f of fields) {
          const el = document.getElementById('custom_field_' + f.id);
          const val = el?.value != null ? (el.type === 'number' ? (parseFloat(el.value) || null) : String(el.value).trim()) : '';
          if (f.required && !val) {
            showToast('Please fill in: ' + (f.label || f.id), 'error');
            return;
          }
          data[f.id] = val;
        }
      } else {
        const details = document.getElementById('custom_details')?.value?.trim();
        if (!details) {
          showToast('Please enter details', 'error');
          return;
        }
        data = { details };
      }
    }
    
    let sentToUids = [];
    let sentToStaffIds = [];
    let sentToNames = [];

    if (type === 'document_renewal_request') {
      const sel = document.getElementById('doc_renew_staff');
      const opt = sel?.selectedOptions?.[0];
      const uid = opt?.getAttribute('data-uid') || '';
      const sid = opt?.getAttribute('data-staff-id') || '';
      const nm = (opt?.getAttribute('data-name') || '').trim() || (opt?.textContent || '').trim();
      if (!uid) {
        showToast('Please select a staff member', 'error');
        return;
      }
      sentToUids = [uid];
      sentToStaffIds = [sid];
      sentToNames = [nm];
    } else {
      const sel = getCreateRequestSelectedRecipients();
      sentToUids = sel.uids;
      sentToStaffIds = sel.staffIds;
      sentToNames = sel.names;
    }

    const hasAnySelected = (sentToUids && sentToUids.length > 0) || (sentToNames && sentToNames.length > 0);
    const hasValidUid = sentToUids && sentToUids.some(u => u && u.trim());
    if (type !== 'document_renewal_request' && getInboxRecipientsList().length > 0 && !hasAnySelected) {
      showToast('Please choose who receives this request', 'error');
      return;
    }
    if (type !== 'document_renewal_request' && hasAnySelected && !hasValidUid) {
      // Recipient selected but uid not known — try one more time to load from members
      await loadSalonUsersForRecipients();
      const recipName = sentToNames[0] || '';
      const found = (inboxState._inboxUsersCache || []).find(u =>
        u.name && recipName && u.name.toLowerCase().trim() === recipName.toLowerCase().trim()
      );
      if (found && found.uid) {
        sentToUids[0] = found.uid;
      } else {
        const recipNameDisplay = sentToNames[0] || 'the selected recipient';
        showToast(`${recipNameDisplay} needs to log in to the app at least once before they can receive requests.`, 'error');
        return;
      }
    }
    
    const salonId = inboxState.currentUserProfile.salonId;
    const creatorName = await resolveCurrentInboxActorName();

    const docUploadOwnerExtra =
      type === 'document_upload' && data && data.documentOwnerStaffId
        ? { documentOwnerStaffId: String(data.documentOwnerStaffId).trim() }
        : {};

    // Stamp the active location on every user-created request so the Inbox
    // can keep it scoped to the branch where it was submitted. Without this
    // the item falls back to the subject staff's allowedLocationIds, which
    // makes requests leak into every branch the staff member is allowed in.
    let activeLocationIdForCreate = null;
    try {
      if (typeof window.ffGetActiveLocationId === 'function') {
        const v = window.ffGetActiveLocationId();
        if (typeof v === 'string' && v.trim()) activeLocationIdForCreate = v.trim();
      }
      if (!activeLocationIdForCreate && typeof window.__ff_active_location_id === 'string' && window.__ff_active_location_id.trim()) {
        activeLocationIdForCreate = window.__ff_active_location_id.trim();
      }
    } catch (_) {}

    const baseDoc = {
      tenantId: salonId,
      locationId: activeLocationIdForCreate,
      type: ffInboxRuleString(type),
      status: "open",
      priority: 'normal',
      assignedTo: null,
      sentToStaffIds: Array.isArray(sentToStaffIds) ? sentToStaffIds : [],
      sentToNames: Array.isArray(sentToNames) ? sentToNames : [],
      data: data,
      managerNotes: null,
      responseNote: null,
      decidedBy: null,
      decidedAt: null,
      needsInfoQuestion: null,
      staffReply: null,
      visibility: 'managers_only',
      unreadForManagers: true,
      ...docUploadOwnerExtra,
    };
    
    const hasRecipients = sentToUids && sentToUids.some(u => u && u.trim());
    if (hasRecipients) {
      // forUid comes directly from data-uid (Firebase UID) — no lookup needed
      const forUid = sentToUids.find(u => u && u.trim()) || sentToUids[0];
      const forStaffId = sentToStaffIds[0] || '';
      const forStaffName = sentToNames[0] || '';

      const forUidStr = ffInboxRuleString(forUid).trim();
      const forStaffIdStr = ffInboxRuleString(forStaffId);
      const forStaffNameStr = ffInboxRuleString(forStaffName);
      const createdByNameStr = ffInboxRuleString(
        creatorName || inboxState.currentUserProfile.name || inboxState.currentUserProfile.displayName
      );
      const createdByRoleStr = ffInboxRuleString(inboxState.currentUserProfile.role);

      console.log('[Inbox] Sending request: createdByUid=', inboxState.currentUserProfile.uid, 'forUid=', forUidStr, 'forName=', forStaffNameStr);

      if (forUidStr === inboxState.currentUserProfile.uid) {
        showToast('Cannot send a request to yourself', 'error');
        return;
      }

      const requestDoc = {
        ...baseDoc,
        createdByUid: inboxState.currentUserProfile.uid,
        createdByStaffId: creatorStaffId,
        createdByName: createdByNameStr,
        createdByRole: createdByRoleStr,
        forUid: forUidStr,
        forStaffId: forStaffIdStr,
        forStaffName: forStaffNameStr,
        createdAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
        updatedAt: null
      };
      const docRef = await addDoc(collection(db, `salons/${salonId}/inboxItems`), requestDoc);
      console.log('[Inbox] Request created with forUid=', forUidStr, 'docId=', docRef.id);
    } else {
      // Technician creating for self — direct Firestore (forUid = creator)
      const createdByNameStr = ffInboxRuleString(
        creatorName || inboxState.currentUserProfile.name || inboxState.currentUserProfile.displayName
      );
      const createdByRoleStr = ffInboxRuleString(inboxState.currentUserProfile.role);
      const requestDoc = {
        ...baseDoc,
        createdByUid: inboxState.currentUserProfile.uid,
        createdByStaffId: creatorStaffId,
        createdByName: createdByNameStr,
        createdByRole: createdByRoleStr,
        forUid: inboxState.currentUserProfile.uid,
        forStaffId: creatorStaffId,
        forStaffName: createdByNameStr,
        createdAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
        updatedAt: null
      };
      const docRef = await addDoc(collection(db, `salons/${salonId}/inboxItems`), requestDoc);
      console.log('[Inbox] Request created', docRef.id);
    }
    
    // Close modal
    if (typeof window.closeCreateRequestModal === "function") {
      window.closeCreateRequestModal();
    }
    submitSucceeded = true;

    // Show success toast
    showToast('Request submitted successfully!', 'success');
    
    // Reload list
    loadInboxItems();
    
  } catch (error) {
    console.error('[Inbox] Submit error', error);
    let msg = error?.details || error?.message || String(error);
    if (msg === 'internal' || msg === 'Request creation failed.') {
      msg = 'Server error. Try again later or check Firebase Functions logs.';
    }
    if (msg.includes('Recipient has not signed in') || msg.includes('failed-precondition') || msg.includes('not found')) {
      msg = 'The selected recipient has not signed in yet. They need to accept their invite and create an account first.';
    }
    showToast(msg, 'error');
    submitRequestInFlight = false;
    if (submitBtn) submitBtn.disabled = false;
  } finally {
    // Early validation returns skip catch; release so the user can retry.
    if (!submitSucceeded) {
      submitRequestInFlight = false;
      if (submitBtn) submitBtn.disabled = false;
    }
  }
}
