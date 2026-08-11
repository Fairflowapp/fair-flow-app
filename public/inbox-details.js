/**
 * Inbox — request details modal (extracted from inbox.js).
 * showRequestDetails (full details modal + role-based action buttons),
 * renderRequestData (per-type detail body), uploaded-file label/preview helpers.
 *
 * No injection: updateInboxBadges is imported from inbox-list-render.js
 * (one-directional M6 → M2). All action handlers are referenced only inside
 * onclick HTML strings and resolve at click-time via window.*.
 */

import { updateDoc, doc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { inboxState } from "./inbox-state.js?v=20260810_owner_inbox_load_v5";
import {
  inboxSupplyStatusDisplayLabel,
  inboxDocAlertIsExpiredForUi,
  inboxSupplyRequestIsPending,
} from "./inbox-helpers.js?v=20260810_owner_inbox_load_v5";
import { escapeHtml } from "./inbox-utils.js?v=20260630_inbox_utils_split";
import {
  inboxUserRoleLc,
  inboxCanManageInbox,
  inboxCanSendRequests,
} from "./inbox-data.js?v=20260810_owner_inbox_load_v5";
import { getRequestTypeInfo } from "./inbox-types.js?v=20260810_owner_inbox_load_v5";
import { ffShowInventorySuggestionModal } from "./inbox-inventory-suggestion.js?v=20260629_inbox_invsugg_split";
import {
  ffDocAlertIsHebrewUI,
  ffDocAlertHumanSummary,
  ffDocAlertWhatToDoLine,
  ffDocAlertStaffName,
  ffDocAlertDocTitle,
  ffDocAlertDocType,
  ffDocAlertExpFormattedLong,
  ffDocAlertStaffId,
  ffDocAlertModalFooterIds,
} from "./inbox-documents.js?v=20260629_inbox_documents_split";
import { updateInboxBadges } from "./inbox-list-render.js?v=20260810_owner_inbox_load_v5";

// =====================
// Request Details Modal
// =====================
function showRequestDetails(requestId) {
  const request = inboxState.currentRequests.find(r => r.id === requestId);
  if (!request) return;
  
  console.log('[Inbox] Showing request details', requestId);

  // Mark as read only if the current user IS the recipient (forUid), not the sender
  const isManagerRole = inboxCanManageInbox();
  const isRecipientViewing = isManagerRole && request.forUid === inboxState.currentUserProfile.uid;
  if (isRecipientViewing && request.unreadForManagers === true && inboxState.currentUserProfile.salonId) {
    // Optimistic: update local state immediately
    const idx = inboxState.currentRequests.findIndex(r => r.id === requestId);
    if (idx !== -1) inboxState.currentRequests[idx] = { ...inboxState.currentRequests[idx], unreadForManagers: false };
    updateInboxBadges();
    // Persist to Firestore in background (no lastActivityAt change to avoid reorder)
    updateDoc(doc(db, `salons/${inboxState.currentUserProfile.salonId}/inboxItems`, requestId), {
      unreadForManagers: false
    }).catch(err => console.warn('[Inbox] Mark read failed', err));
  }

  // Smart Inventory Suggestion — dedicated smart-card modal (no raw data dump).
  if (request.type === 'inventory_suggestion') {
    ffShowInventorySuggestionModal(request);
    return;
  }
  
  const modal = document.createElement('div');
  modal.id = 'requestDetailsModal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999999;
    padding: 20px;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: #fff;
    border-radius: 12px;
    padding: 24px;
    max-width: 600px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
  `;
  
  const typeInfo = getRequestTypeInfo(request.type);
  const statusStrModal = String(request.status != null ? request.status : "open");
  const statusModalDisplay = inboxSupplyStatusDisplayLabel(request) || statusStrModal.replace(/_/g, " ");
  const statusClass = `inbox-status-${statusStrModal.replace(/_/g, "-")}`;
  const createdDate = request.createdAt?.toDate ? request.createdAt.toDate() : new Date();
  const rd = request.data || {};
  const isDocAlert = request.type === 'document_expiring_soon' || request.type === 'document_expired';

  // Role checks
  const isManager = inboxCanManageInbox();
  const isTechnician = inboxState.currentUserProfile && inboxUserRoleLc() === "technician";
  const isMyRequest = inboxState.currentUserProfile && request.forUid === inboxState.currentUserProfile.uid;

  let docAlertPanelHtml = '';
  if (isDocAlert) {
    const isSoon = !inboxDocAlertIsExpiredForUi(request);
    const he = ffDocAlertIsHebrewUI();
    const badgeLabel = isSoon ? (he ? 'יפוג בקרוב' : 'Expiring soon') : (he ? 'פג תוקף' : 'Expired');
    const panelStyle = isSoon
      ? 'border-left:4px solid #d97706;background:linear-gradient(180deg,#fffbeb 0%,#ffffff 100%);border:1px solid #fde68a;border-radius:12px;padding:18px 18px 16px;margin-bottom:20px;'
      : 'border-left:4px solid #b91c1c;background:linear-gradient(180deg,#fef2f2 0%,#ffffff 100%);border:1px solid #fecaca;border-radius:12px;padding:18px 18px 16px;margin-bottom:20px;';
    const badgeBg = isSoon ? '#fef3c7' : '#fee2e2';
    const badgeColor = isSoon ? '#92400e' : '#991b1b';
    const msg = (request.message || rd.message || '').trim();
    const docAlertMgmtNote = isManager
      ? `<span style="font-size:11px;color:#6b7280;">${he ? 'העובד לא קיבל התראה · נראה למנהלים בלבד' : 'Employee not notified · managers only'}</span>`
      : '';
    docAlertPanelHtml = `
    <div style="${panelStyle}">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;background:${badgeBg};color:${badgeColor};">${escapeHtml(badgeLabel)}</span>
        ${docAlertMgmtNote}
      </div>
      <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:#111827;line-height:1.45;">${escapeHtml(ffDocAlertHumanSummary(request))}</p>
      <p style="margin:0 0 14px;font-size:13px;color:#4b5563;line-height:1.5;">${escapeHtml(ffDocAlertWhatToDoLine())}</p>
      <div style="display:grid;gap:10px;font-size:13px;color:#374151;margin-bottom:8px;">
        <div style="display:flex;gap:8px;align-items:flex-start;"><span style="min-width:108px;color:#9ca3af;flex-shrink:0;">${he ? 'שם העובד' : 'Employee'}</span><strong style="font-weight:600;">${escapeHtml(ffDocAlertStaffName(request))}</strong></div>
        <div style="display:flex;gap:8px;align-items:flex-start;"><span style="min-width:108px;color:#9ca3af;flex-shrink:0;">${he ? 'שם המסמך' : 'Document name'}</span><span style="word-break:break-word;">${escapeHtml(ffDocAlertDocTitle(request))}</span></div>
        <div style="display:flex;gap:8px;align-items:flex-start;"><span style="min-width:108px;color:#9ca3af;flex-shrink:0;">${he ? 'סוג המסמך' : 'Document type'}</span><span>${escapeHtml(ffDocAlertDocType(request))}</span></div>
        <div style="display:flex;gap:8px;align-items:flex-start;"><span style="min-width:108px;color:#9ca3af;flex-shrink:0;">${he ? 'תאריך תפוגה' : 'Expiration date'}</span><span>${escapeHtml(ffDocAlertExpFormattedLong(request) || '—')}</span></div>
        ${msg ? `<div style="display:flex;gap:8px;align-items:flex-start;"><span style="min-width:108px;color:#9ca3af;flex-shrink:0;">${he ? 'הודעה' : 'Message'}</span><span style="flex:1;line-height:1.45;">${escapeHtml(msg)}</span></div>` : ''}
      </div>
      <div style="font-size:11px;color:#9ca3af;margin-top:4px;">${he ? 'מקור' : 'Source'}: ${escapeHtml(rd.source || request.source || 'staff_documents')} · ${he ? 'נוצר' : 'Logged'} ${escapeHtml(createdDate.toLocaleString())}</div>
    </div>`;
  }

  const birthdayMeta =
    request.type === 'staff_birthday_reminder'
      ? `
    <div style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:20px;">
      <div style="font-size:13px;color:#374151;line-height:1.55;">
        <div style="font-weight:600;margin-bottom:6px;color:#111;">Automated salon reminder</div>
        <p style="margin:0 0 12px;color:#6b7280;font-size:12px;">The employee is not notified. Visible to management only.</p>
        <div style="display:grid;gap:8px;font-size:13px;">
          <div><span style="color:#6b7280;">Staff member:</span> <strong>${escapeHtml(rd.subjectStaffName || '')}</strong></div>
          <div><span style="color:#6b7280;">Birthday:</span> ${(() => { const s = String(rd.birthdayDisplay || '').trim(); return s && !/[\u0590-\u05FF\u0600-\u06FF]/.test(s) ? escapeHtml(s) : '—'; })()}</div>
          <div><span style="color:#6b7280;">When:</span> ${rd.daysUntil === 0 ? 'Today' : `In ${Number(rd.daysUntil) || 0} day(s)`}</div>
          <div><span style="color:#6b7280;">Logged:</span> ${createdDate.toLocaleString()}</div>
        </div>
      </div>
    </div>`
      : request.type === 'onboarding_incomplete'
      ? `
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin-bottom:20px;">
      <div style="font-size:13px;color:#374151;line-height:1.55;">
        <div style="font-weight:600;margin-bottom:6px;color:#111;">Onboarding still incomplete</div>
        <p style="margin:0 0 12px;color:#6b7280;font-size:12px;">Automated alert after 7 days. The employee is not notified by this Inbox item — send a reminder from their Onboarding tab if needed.</p>
        <div style="display:grid;gap:8px;font-size:13px;">
          <div><span style="color:#6b7280;">Staff member:</span> <strong>${escapeHtml(rd.subjectStaffName || '')}</strong></div>
          <div><span style="color:#6b7280;">Package:</span> ${escapeHtml(rd.packageName || '—')}</div>
          <div><span style="color:#6b7280;">Progress:</span> ${
            Number(rd.progressRequiredTotal) > 0
              ? `${Number(rd.progressRequiredCompleted || 0)}/${Number(rd.progressRequiredTotal)} required`
              : escapeHtml(String(rd.runStatus || '—'))
          }</div>
          <div><span style="color:#6b7280;">Logged:</span> ${createdDate.toLocaleString()}</div>
        </div>
      </div>
    </div>`
      : request.type === 'document_renewal_request'
      ? `
    <div style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:20px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px;">
        <div>
          <div style="color:#6b7280;margin-bottom:4px;">From</div>
          <div style="font-weight:500;">${escapeHtml(request.createdByName || '')}</div>
        </div>
        <div>
          <div style="color:#6b7280;margin-bottom:4px;">Asked to upload</div>
          <div style="font-weight:500;">${escapeHtml(request.forStaffName || '')}</div>
        </div>
        <div>
          <div style="color:#6b7280;margin-bottom:4px;">Created</div>
          <div style="font-weight:500;">${createdDate.toLocaleDateString()} ${createdDate.toLocaleTimeString()}</div>
        </div>
      </div>
    </div>`
      : isDocAlert
      ? docAlertPanelHtml
      : `
    <div style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:20px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px;">
        <div>
          <div style="color:#6b7280;margin-bottom:4px;">Requested by</div>
          <div style="font-weight:500;">${escapeHtml(request.createdByName || request.createdByUid || '')}</div>
        </div>
        <div>
          <div style="color:#6b7280;margin-bottom:4px;">Created</div>
          <div style="font-weight:500;">${createdDate.toLocaleDateString()} ${createdDate.toLocaleTimeString()}</div>
        </div>
      </div>
      ${(request.sentToNames && request.sentToNames.length > 0) ? `
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:13px;">
        <div style="color:#6b7280;margin-bottom:4px;">Sent to</div>
        <div style="font-weight:500;">${escapeHtml(request.sentToNames.join(', '))}</div>
      </div>
      ` : ''}
    </div>`;
  
  let detailsHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <span style="font-size:28px;">${typeInfo.icon}</span>
        <div>
          <h2 style="margin:0;font-size:18px;font-weight:600;">${typeInfo.label}</h2>
          <span class="inbox-status-badge ${statusClass}">${statusModalDisplay}</span>
        </div>
      </div>
      <button onclick="closeRequestDetailsModal()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#9ca3af;">&times;</button>
    </div>
    
    ${birthdayMeta}
    
    <div style="margin-bottom:20px;">
      ${isDocAlert ? '' : `<h3 style="font-size:14px;font-weight:600;margin-bottom:12px;color:#374151;">${request.type === 'staff_birthday_reminder' ? 'Summary' : 'Request Details'}</h3>`}
      ${isDocAlert ? ffDocAlertModalFooterIds(request) : renderRequestData(request)}
    </div>
    
    ${request.needsInfoQuestion ? `
      <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:16px;margin-bottom:20px;">
        <div style="font-size:13px;font-weight:600;color:#92400e;margin-bottom:8px;">❓ Manager Question:</div>
        <div style="font-size:13px;color:#78350f;">${request.needsInfoQuestion}</div>
        ${request.staffReply ? `
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid #fbbf24;">
            <div style="font-size:13px;font-weight:600;color:#92400e;margin-bottom:8px;">✓ Your Reply:</div>
            <div style="font-size:13px;color:#78350f;">${request.staffReply}</div>
          </div>
        ` : ''}
      </div>
    ` : ''}
  `;
  
  // Reply box: shown to the REQUEST CREATOR when status is needs_info (any role)
  const isCreator = inboxState.currentUserProfile && request.createdByUid === inboxState.currentUserProfile.uid;
  if (isCreator && request.status === 'needs_info' && !request.staffReply) {
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;color:#374151;">Your Reply</h3>
        <textarea id="staffReplyInput" rows="3" placeholder="Answer the question..." style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;margin-bottom:12px;box-sizing:border-box;"></textarea>
        <button onclick="submitStaffReply('${requestId}')" style="width:100%;padding:10px;background:#7c3aed;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">
          Submit Reply
        </button>
      </div>
    `;
  }

  if (
    isTechnician &&
    isMyRequest &&
    request.type === 'document_renewal_request' &&
    request.status === 'open' &&
    inboxCanSendRequests()
  ) {
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;color:#374151;">Your action</h3>
        <p style="font-size:13px;color:#6b7280;margin-bottom:12px;">Upload a renewed document for management to review.</p>
        <button type="button" onclick="closeRequestDetailsModal(); openCreateRequestModal(); selectRequestType('document_upload');" style="width:100%;padding:12px;background:#7c3aed;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;">
          📤 Upload a Document
        </button>
      </div>
    `;
  }

  const isRenewalCreator =
    inboxCanSendRequests() &&
    inboxState.currentUserProfile &&
    request.createdByUid === inboxState.currentUserProfile.uid &&
    request.type === 'document_renewal_request' &&
    request.createdByUid !== request.forUid;
  if (isRenewalCreator && (request.status === 'open' || request.status === 'needs_info')) {
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;color:#374151;">Follow-up</h3>
        <p style="font-size:13px;color:#6b7280;margin-bottom:12px;">Archive this when the staff member has uploaded or you no longer need the reminder.</p>
        <button type="button" onclick="archiveRequest('${requestId}')" style="width:100%;padding:10px;border:1px solid #9ca3af;background:#fff;color:#374151;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500;">
          📦 Archive
        </button>
      </div>
    `;
  }
  
  // Manager actions — only for the RECIPIENT (who the request was sent TO), not the creator
  const isRecipient = inboxState.currentUserProfile && request.forUid === inboxState.currentUserProfile.uid;
  if (
    isManager &&
    isRecipient &&
    request.status === 'open' &&
    (request.type === 'staff_birthday_reminder' || request.type === 'onboarding_incomplete')
  ) {
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <button type="button" onclick="markBirthdayReminderDone('${requestId}')" style="width:100%;padding:12px;background:#7c3aed;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;">
          ✓ Mark done &amp; archive
        </button>
      </div>
    `;
  } else if (isManager && isRecipient && request.status === 'open' && isDocAlert) {
    const docAlertBtnBase =
      'display:inline-flex;align-items:center;justify-content:center;min-height:32px;padding:6px 12px;font-size:12px;font-weight:600;border-radius:999px;line-height:1.2;font-family:inherit;box-sizing:border-box;white-space:nowrap;';
    const docAlertBtnOutline = `${docAlertBtnBase}background:#fff;color:#374151;border:1px solid #d1d5db;cursor:pointer;`;
    const docAlertBtnChat = `${docAlertBtnBase}cursor:pointer;border:1px solid #7c3aed;background:#ede9fe;color:#5b21b6;touch-action:manipulation;`;
    const docAlertBtnDone = `${docAlertBtnBase}background:#7c3aed;color:#fff;border:none;cursor:pointer;`;
    const sid = ffDocAlertStaffId(request);
    const openStaffBtn = sid && typeof window.openStaffMembersModal === 'function'
      ? `<button type="button" data-ff-doc-alert-open-staff="${encodeURIComponent(sid)}" style="${docAlertBtnOutline}">
          ${ffDocAlertIsHebrewUI() ? 'פתח עובד' : 'Open Staff Member'}
        </button>`
      : '';
    const renewPayload = {
      staffId: ffDocAlertStaffId(request),
      documentType: (rd.documentType || request.documentType || '').trim(),
      documentId: (rd.documentId || request.documentId || '').trim(),
    };
    const chatPayload = {
      salonId: inboxState.currentUserProfile.salonId,
      staffId: renewPayload.staffId,
      documentId: renewPayload.documentId,
    };
    const chatPayloadAttr =
      renewPayload.staffId && renewPayload.documentId
        ? encodeURIComponent(JSON.stringify(chatPayload))
        : '';
    const chatBtn =
      chatPayloadAttr
        ? `<button type="button" data-ff-doc-alert-chat="1" data-payload="${chatPayloadAttr}" style="${docAlertBtnChat}" title="${ffDocAlertIsHebrewUI() ? 'שליחת תזכורת בצ׳אט לעובד' : 'Send this staff member a chat reminder'}">
          ${ffDocAlertIsHebrewUI() ? 'שלח תזכורת בצ׳אט' : 'Send chat reminder'}
        </button>`
        : '';
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;color:#374151;">${ffDocAlertIsHebrewUI() ? 'פעולות' : 'Actions'}</h3>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          ${openStaffBtn}
          ${chatBtn}
          <button type="button" onclick="markBirthdayReminderDone('${requestId}')" style="${docAlertBtnDone}">
            ✓ ${ffDocAlertIsHebrewUI() ? 'סמן כבוצע וארכב' : 'Mark done &amp; archive'}
          </button>
        </div>
      </div>
    `;
  } else if (isManager && isRecipient && request.type === "supplies" && inboxSupplyRequestIsPending(request)) {
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;color:#374151;">Manager Actions</h3>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <button type="button" onclick="approveRequest('${requestId}')" style="padding:10px;border:1px solid #10b981;background:#10b981;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;width:100%;">
            ✓ Approve
          </button>
          <button type="button" onclick="denyRequest('${requestId}')" style="padding:10px;border:1px solid #ef4444;background:#ef4444;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;width:100%;">
            ✗ Deny
          </button>
        </div>
      </div>
    `;
  } else if (isManager && isRecipient && request.status === "open") {
    const isDocRequest = request.type === 'document_request';
    const isDocMeta = request.type === 'document_upload' || request.type === 'document_request';
    const docMetaEditBtn = isDocMeta
      ? `<button type="button" onclick="ffInboxOpenDocumentMetadataEdit('${requestId}')" title="Edit document type, expiration, etc. before approving" style="min-width:44px;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;background:#fff;cursor:pointer;font-size:16px;line-height:1;flex-shrink:0;">✏️</button>`
      : '';
    const approveRow = isDocMeta
      ? `<div style="display:flex;align-items:stretch;gap:8px;margin-bottom:12px;">
          <button onclick="approveRequest('${requestId}')" style="flex:1;padding:10px;border:1px solid #10b981;background:#10b981;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">
            ✓ Approve
          </button>
          ${docMetaEditBtn}
        </div>`
      : `<button onclick="approveRequest('${requestId}')" style="padding:10px;border:1px solid #10b981;background:#10b981;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;width:100%;margin-bottom:12px;">
            ✓ Approve
          </button>`;
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;color:#374151;">Manager Actions</h3>
        ${isDocRequest ? `
        <div style="margin-bottom:16px;padding:12px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;">
          <div style="font-size:13px;font-weight:600;color:#166534;margin-bottom:8px;">📄 Upload response document</div>
          <input type="file" id="docResponseFile_${requestId}" accept=".pdf,.jpg,.jpeg,.png" style="width:100%;padding:8px;margin-bottom:8px;border:1px solid #d1d5db;border-radius:6px;">
          <button onclick="uploadDocumentResponse('${requestId}')" style="width:100%;padding:10px;background:#059669;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">
            Upload file & mark Done
          </button>
        </div>
        <div style="font-size:12px;color:#6b7280;margin-bottom:12px;">— or —</div>
        ` : ''}
        <div style="display:flex;flex-direction:column;gap:12px;">
          <button onclick="needsMoreInfo('${requestId}')" style="padding:10px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:14px;font-weight:500;">
            ❓ Request More Info
          </button>
          
          ${approveRow}
          
          <button onclick="denyRequest('${requestId}')" style="padding:10px;border:1px solid #ef4444;background:#ef4444;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">
            ✗ Deny
          </button>
        </div>
      </div>
    `;
  }
  
  // Manager actions for needs_info status — only for recipient
  if (isManager && isRecipient && request.status === 'needs_info') {
    const isDocMetaNi = request.type === 'document_upload' || request.type === 'document_request';
    const docMetaEditBtnNi = isDocMetaNi
      ? `<button type="button" onclick="ffInboxOpenDocumentMetadataEdit('${requestId}')" title="Edit document details" style="min-width:44px;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;background:#fff;cursor:pointer;font-size:16px;line-height:1;flex-shrink:0;">✏️</button>`
      : '';
    const approveAnywayRow = isDocMetaNi
      ? `<div style="display:flex;align-items:stretch;gap:8px;margin-bottom:8px;">
          <button onclick="approveRequest('${requestId}')" style="flex:1;padding:10px;border:1px solid #10b981;background:#10b981;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">
            ✓ Approve Anyway
          </button>
          ${docMetaEditBtnNi}
        </div>`
      : `<button onclick="approveRequest('${requestId}')" style="padding:10px;border:1px solid #10b981;background:#10b981;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;width:100%;margin-bottom:8px;">
          ✓ Approve Anyway
        </button>`;
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;color:#374151;">Manager Actions</h3>
        <div style="font-size:13px;color:#6b7280;margin-bottom:12px;">
          Waiting for staff response...
        </div>
        ${approveAnywayRow}
        <button onclick="denyRequest('${requestId}')" style="padding:10px;border:1px solid #ef4444;background:#ef4444;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;width:100%;">
          ✗ Deny
        </button>
      </div>
    `;
  }
  
  // Archive button (for approved/denied/done requests) — only for recipient
  if (isManager && isRecipient && (request.status === 'approved' || request.status === 'denied' || request.status === 'done')) {
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <button onclick="archiveRequest('${requestId}')" style="padding:10px;border:1px solid #9ca3af;background:#fff;color:#374151;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500;width:100%;">
          📦 Move to Archive
        </button>
      </div>
    `;
  }
  
  // Delete button (only for archived requests — permanent delete) — only for recipient
  if (isManager && isRecipient && request.status === 'archived') {
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <button onclick="deleteArchivedRequest('${requestId}')" style="padding:10px;border:1px solid #ef4444;background:#fef2f2;color:#dc2626;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500;width:100%;">
          🗑 Delete permanently
        </button>
      </div>
    `;
  }
  
  content.innerHTML = detailsHTML;
  try {
    const openStaffEl = content.querySelector('[data-ff-doc-alert-open-staff]');
    if (openStaffEl) {
      openStaffEl.addEventListener('click', () => {
        const raw = openStaffEl.getAttribute('data-ff-doc-alert-open-staff') || '';
        const id = decodeURIComponent(raw);
        if (typeof window.openDocumentAlertStaffMember === 'function') {
          window.openDocumentAlertStaffMember(id);
        }
      });
    }
    const chatEl = content.querySelector('[data-ff-doc-alert-chat]');
    if (chatEl) {
      chatEl.addEventListener('click', async () => {
        if (chatEl.disabled) return;
        const raw = chatEl.getAttribute('data-payload');
        if (!raw) return;
        try {
          const payload = JSON.parse(decodeURIComponent(raw));
          if (typeof window.ffDocAlertSendChatReminder !== 'function') return;
          chatEl.disabled = true;
          chatEl.style.opacity = '0.65';
          chatEl.style.pointerEvents = 'none';
          try {
            await window.ffDocAlertSendChatReminder(payload);
          } finally {
            chatEl.disabled = false;
            chatEl.style.opacity = '';
            chatEl.style.pointerEvents = '';
          }
        } catch (err) {
          console.warn('[Inbox] doc alert chat payload', err);
        }
      });
    }
  } catch (e) {
    console.warn('[Inbox] doc alert action wiring', e);
  }
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  // Click outside to close
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeRequestDetailsModal();
    }
  };
}

window.closeRequestDetailsModal = function() {
  const modal = document.getElementById('requestDetailsModal');
  if (modal) modal.remove();
};

/**
 * Files live in Firebase Storage; the UI must use a download URL (link). The stored `fileName`
 * sometimes matches the storage basename (`{generatedId}_{sanitizedOriginal}`) — strip a long
 * generated first segment so the link label looks like the real filename.
 */
function inboxDisplayUploadedFileLinkLabel(data) {
  const d = data || {};
  let name = d.fileName != null ? String(d.fileName).trim() : "";
  const base = (d.filePath || "").split("/").filter(Boolean).pop() || "";
  if (!name) name = base;
  if (name) {
    const parts = name.split("_");
    if (parts.length >= 2) {
      const first = parts[0];
      if (first.length >= 12 && /^[a-zA-Z0-9.-]+$/.test(first)) {
        name = parts.slice(1).join("_");
      }
    }
  }
  if (!name) name = "View file";
  if (name.length > 72) name = `${name.slice(0, 69)}…`;
  return name;
}

/** True when filename/path/url suggests an image (thumbnail + lightbox in inbox). */
function inboxUploadedFileLooksLikeImage(data) {
  const d = data || {};
  const hint = `${d.fileName || ""} ${d.fileUrl || ""} ${d.filePath || ""}`.toLowerCase();
  return /\.(jpg|jpeg|png|gif|webp|heic|heif)(\?|#|$)/i.test(hint);
}

window.ffInboxOverlayPreviewImage = function (url) {
  try {
    const safe = String(url || "").trim();
    if (!/^https?:\/\//i.test(safe)) return;
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "position:fixed;inset:0;z-index:1000000;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;padding:20px;cursor:zoom-out;";
    const img = document.createElement("img");
    img.src = safe;
    img.alt = "";
    img.style.cssText =
      "max-width:96vw;max-height:92vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.45);cursor:default;";
    wrap.appendChild(img);
    wrap.onclick = () => wrap.remove();
    document.body.appendChild(wrap);
  } catch (_) {}
};

function renderRequestData(request) {
  const data = request.data || {};
  
  switch (request.type) {
    case 'vacation':
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          <div>
            <span style="color:#6b7280;">Start Date:</span>
            <span style="font-weight:500;margin-left:8px;">${data.startDate || 'N/A'}</span>
          </div>
          <div>
            <span style="color:#6b7280;">End Date:</span>
            <span style="font-weight:500;margin-left:8px;">${data.endDate || 'N/A'}</span>
          </div>
          <div>
            <span style="color:#6b7280;">Duration:</span>
            <span style="font-weight:500;margin-left:8px;">${data.daysCount || 0} days</span>
          </div>
          ${data.note ? `<div><span style="color:#6b7280;">Note:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${data.note}</div></div>` : ''}
        </div>
      `;
      
    case 'late_start':
    case 'early_leave':
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          <div>
            <span style="color:#6b7280;">Date:</span>
            <span style="font-weight:500;margin-left:8px;">${data.date || 'N/A'}</span>
          </div>
          <div>
            <span style="color:#6b7280;">Time:</span>
            <span style="font-weight:500;margin-left:8px;">${data.requestedTime || 'N/A'}</span>
          </div>
          <div>
            <span style="color:#6b7280;">Reason:</span>
            <div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${data.reason || 'N/A'}</div>
          </div>
        </div>
      `;
      
    case 'day_off':
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          <div><span style="color:#6b7280;">Date:</span><span style="font-weight:500;margin-left:8px;">${data.date || 'N/A'}</span></div>
          ${data.note ? `<div><span style="color:#6b7280;">Note:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${data.note}</div></div>` : ''}
        </div>
      `;
    case 'time_off':
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          <div><span style="color:#6b7280;">Range:</span><span style="font-weight:500;margin-left:8px;">${data.startDate || 'N/A'} → ${data.endDate || data.startDate || 'N/A'}</span></div>
          ${Array.isArray(data.affectedDates) && data.affectedDates.length ? `<div><span style="color:#6b7280;">Days (${data.affectedDates.length}):</span><span style="font-weight:500;margin-left:8px;">${data.affectedDates.join(', ')}</span></div>` : ''}
          ${data.note ? `<div><span style="color:#6b7280;">Note:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${data.note}</div></div>` : ''}
        </div>
      `;
    case 'schedule_change':
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          ${data.startDate ? `<div><span style="color:#6b7280;">Applies:</span><span style="font-weight:500;margin-left:8px;">${data.startDate}${data.endDate && data.endDate !== data.startDate ? ` → ${data.endDate}` : ''}</span></div>` : ''}
          ${Array.isArray(data.affectedDates) && data.affectedDates.length ? `<div><span style="color:#6b7280;">Affected dates:</span><span style="font-weight:500;margin-left:8px;font-size:12px;">${data.affectedDates.join(', ')}</span></div>` : ''}
          ${data.currentSchedule ? `<div><span style="color:#6b7280;">Current:</span><span style="font-weight:500;margin-left:8px;">${data.currentSchedule}</span></div>` : ''}
          <div>
            <span style="color:#6b7280;">Requested:</span>
            <span style="font-weight:500;margin-left:8px;">${data.requestedSchedule || 'N/A'}</span>
          </div>
          <div>
            <span style="color:#6b7280;">Type:</span>
            <span style="font-weight:500;margin-left:8px;">${data.isTemporary ? 'Temporary' : 'Permanent'}</span>
          </div>
          <div>
            <span style="color:#6b7280;">Reason:</span>
            <div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${data.reason || 'N/A'}</div>
          </div>
        </div>
      `;
      
    case 'supplies': {
      const decision = escapeHtml(inboxSupplyStatusDisplayLabel(request) || "—");
      const itemsHTML = (data.items || [])
        .map((item) => {
          if (item.itemId && item.itemName) {
            const path = [item.categoryName, item.subcategoryName].filter(Boolean).join(" › ");
            const groupLabelRaw =
              item.groupName && String(item.groupName).trim() !== ""
                ? String(item.groupName).trim()
                : item.variantLabel && String(item.variantLabel).trim() !== ""
                  ? String(item.variantLabel).trim()
                  : "";
            const meta = [
              item.internalNumber != null && item.internalNumber !== "" ? `#${item.internalNumber}` : "",
              item.code ? String(item.code) : "",
              item.brand || "",
              item.brandCode || "",
            ]
              .filter(Boolean)
              .join(" · ");
            const qtyDisp = item.qty != null && item.qty !== "" ? String(item.qty) : "—";
            const unitDisp = escapeHtml(item.unit || "pcs");
            const titleLine = groupLabelRaw
              ? `${escapeHtml(item.itemName)} <span style="color:#6d28d9;font-weight:500;">(${escapeHtml(groupLabelRaw)})</span>`
              : escapeHtml(item.itemName);
            return `<li style="margin-bottom:10px;">
              <div style="font-weight:600;color:#111827;">${titleLine}</div>
              ${meta ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">${escapeHtml(meta)}</div>` : ""}
              ${path ? `<div style="font-size:12px;color:#9ca3af;margin-top:2px;">${escapeHtml(path)}</div>` : ""}
              <div style="font-size:13px;margin-top:4px;">Qty: <strong>${escapeHtml(qtyDisp)}</strong> ${unitDisp}</div>
            </li>`;
          }
          const legacyQty = item.quantity != null ? item.quantity : item.qty;
          return `<li>${escapeHtml(item.name || "")} — ${escapeHtml(String(legacyQty ?? "—"))} ${escapeHtml(item.unit || "pcs")}</li>`;
        })
        .join("");
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          <div style="padding:10px 12px;border-radius:8px;background:#f9fafb;border:1px solid #e5e7eb;">
            <span style="color:#6b7280;font-size:12px;">Decision status</span>
            <div style="font-weight:600;font-size:15px;margin-top:4px;color:#111827;">${decision}</div>
          </div>
          <div>
            <span style="color:#6b7280;">Items:</span>
            <ul style="margin:8px 0;padding-left:20px;list-style:disc;">${itemsHTML}</ul>
          </div>
          <div>
            <span style="color:#6b7280;">Urgency:</span>
            <span style="font-weight:500;margin-left:8px;text-transform:capitalize;">${escapeHtml(data.urgency || "routine")}</span>
          </div>
          ${data.note ? `<div><span style="color:#6b7280;">Additional details:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${escapeHtml(data.note)}</div></div>` : ""}
        </div>
      `;
    }
      
    case 'maintenance':
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          <div>
            <span style="color:#6b7280;">Issue:</span>
            <div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;font-weight:500;">${data.issue || 'N/A'}</div>
          </div>
          <div>
            <span style="color:#6b7280;">Area:</span>
            <span style="font-weight:500;margin-left:8px;">${data.area || 'N/A'}</span>
          </div>
          <div>
            <span style="color:#6b7280;">Severity:</span>
            <span style="font-weight:500;margin-left:8px;text-transform:capitalize;">${data.severity || 'minor'}</span>
          </div>
          ${data.note ? `<div><span style="color:#6b7280;">Details:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${data.note}</div></div>` : ''}
        </div>
      `;
      
    case 'other':
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          <div>
            <span style="color:#6b7280;">Subject:</span>
            <div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;font-weight:500;">${data.subject || 'N/A'}</div>
          </div>
          <div>
            <span style="color:#6b7280;">Details:</span>
            <div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${data.details || 'N/A'}</div>
          </div>
        </div>
      `;

    case 'extra_shift':
    case 'swap_shift':
    case 'break_change':
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          ${data.date ? `<div><span style="color:#6b7280;">Date:</span><span style="font-weight:500;margin-left:8px;">${data.date}</span></div>` : ''}
          ${data.subject ? `<div><span style="color:#6b7280;">Subject:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${escapeHtml(data.subject)}</div></div>` : ''}
          <div>
            <span style="color:#6b7280;">Details:</span>
            <div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${escapeHtml(data.details || 'N/A')}</div>
          </div>
        </div>
      `;

    case 'commission_review':
    case 'tip_adjustment':
    case 'payment_issue':
    case 'client_issue':
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          ${data.subject ? `<div><span style="color:#6b7280;">Subject:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${escapeHtml(data.subject)}</div></div>` : ''}
          <div>
            <span style="color:#6b7280;">Details:</span>
            <div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${escapeHtml(data.details || 'N/A')}</div>
          </div>
        </div>
      `;

    case 'document_renewal_request':
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          <div><span style="color:#6b7280;">Document type:</span><span style="font-weight:500;margin-left:8px;">${escapeHtml(data.documentType || 'N/A')}</span></div>
          <div><span style="color:#6b7280;">Message:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${escapeHtml(data.message || 'N/A')}</div></div>
          ${data.dueDate ? `<div><span style="color:#6b7280;">Due date:</span><span style="font-weight:500;margin-left:8px;">${escapeHtml(data.dueDate)}</span></div>` : ''}
          ${data.relatedDocumentId ? `<div><span style="color:#6b7280;">Related document ID:</span><span style="font-weight:500;margin-left:8px;word-break:break-all;">${escapeHtml(String(data.relatedDocumentId))}</span></div>` : ''}
        </div>
      `;

    case 'document_request': {
      const respThumb = (() => {
        const u = data.responseFileUrl;
        if (!u) return "";
        const faux = { fileUrl: u, fileName: data.responseFileName, filePath: data.responseFilePath };
        if (!inboxUploadedFileLooksLikeImage(faux)) return "";
        const esc = escapeHtml(u);
        const jsEsc = JSON.stringify(u);
        return `
        <div style="margin-top:4px;">
          <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">Preview</div>
          <button type="button" onclick="window.ffInboxOverlayPreviewImage(${jsEsc})" style="padding:0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;background:#fff;cursor:zoom-in;max-width:min(240px,100%);display:block;">
            <img src="${esc}" alt="" style="display:block;width:100%;max-height:200px;object-fit:contain;background:#f9fafb;" loading="lazy" />
          </button>
        </div>`;
      })();
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          <div><span style="color:#6b7280;">Document type:</span><span style="font-weight:500;margin-left:8px;">${escapeHtml(data.documentType || 'N/A')}</span></div>
          <div><span style="color:#6b7280;">Reason / Notes:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${escapeHtml(data.reason || 'N/A')}</div></div>
          ${data.dueDate ? `<div><span style="color:#6b7280;">Due date:</span><span style="font-weight:500;margin-left:8px;">${data.dueDate}</span></div>` : ''}
          <div><span style="color:#6b7280;">Delivery:</span><span style="font-weight:500;margin-left:8px;">${escapeHtml(data.deliveryMethod || 'Email')}</span></div>
          ${data.contactEmail ? `<div><span style="color:#6b7280;">Contact email:</span><span style="font-weight:500;margin-left:8px;">${escapeHtml(data.contactEmail)}</span></div>` : ''}
          ${data.responseFileUrl ? `<div><span style="color:#6b7280;">Response file:</span> <a href="${escapeHtml(data.responseFileUrl)}" target="_blank" rel="noopener" style="color:#2563eb;">Download</a></div>${respThumb}` : ''}
        </div>
      `;
    }

    case 'document_upload': {
      const artifactPath = String(data.storagePath || data.filePath || "").trim();
      const isOdArtifact =
        data.viaOnboardingArtifacts === true ||
        artifactPath.startsWith("onboardingArtifacts/") ||
        artifactPath.includes("/onboarding-portal/");
      const uploadThumb = (() => {
        const u = data.fileUrl;
        if (!u || isOdArtifact || !inboxUploadedFileLooksLikeImage(data)) return "";
        const esc = escapeHtml(u);
        const jsEsc = JSON.stringify(u);
        return `
        <div style="margin-top:4px;">
          <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">Preview</div>
          <button type="button" onclick="window.ffInboxOverlayPreviewImage(${jsEsc})" style="padding:0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;background:#fff;cursor:zoom-in;max-width:min(240px,100%);display:block;">
            <img src="${esc}" alt="" style="display:block;width:100%;max-height:200px;object-fit:contain;background:#f9fafb;" loading="lazy" />
          </button>
        </div>`;
      })();
      const fileLink = isOdArtifact && artifactPath
        ? `<div><span style="color:#6b7280;">Uploaded file:</span> <a href="#" data-od-artifact-path="${escapeHtml(artifactPath)}" data-od-artifact-staff="${escapeHtml(String(data.documentOwnerStaffId || data.onboardingStaffId || "").trim())}" data-od-artifact-run="${escapeHtml(String(data.onboardingRunId || "").trim())}" data-od-artifact-task="${escapeHtml(String(data.onboardingTaskId || "").trim())}" onclick="return window.ffInboxOpenOnboardingArtifact && window.ffInboxOpenOnboardingArtifact(event)" title="${escapeHtml(String(data.fileName || artifactPath).trim() || "Open")}" style="color:#2563eb;">${escapeHtml(inboxDisplayUploadedFileLinkLabel(data))}</a></div>`
        : data.fileUrl
          ? `<div><span style="color:#6b7280;">Uploaded file:</span> <a href="${escapeHtml(data.fileUrl)}" target="_blank" rel="noopener" title="${escapeHtml(String(data.fileName || data.filePath || '').trim() || 'Open in new tab')}" style="color:#2563eb;">${escapeHtml(inboxDisplayUploadedFileLinkLabel(data))}</a></div>${uploadThumb}`
          : "";
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          <div><span style="color:#6b7280;">Document type:</span><span style="font-weight:500;margin-left:8px;">${escapeHtml(data.documentType || 'N/A')}</span></div>
          ${data.expirationDate ? `<div><span style="color:#6b7280;">Expiration date:</span><span style="font-weight:500;margin-left:8px;">${data.expirationDate}</span></div>` : ''}
          ${data.notes ? `<div><span style="color:#6b7280;">Notes:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${escapeHtml(data.notes)}</div></div>` : ''}
          ${fileLink}
        </div>
      `;
    }

    case 'staff_birthday_reminder': {
      const bdName = String(data.subjectStaffName || 'Staff').trim();
      const bdDays = Number(data.daysUntil);
      const bdDaysPart = !Number.isFinite(bdDays)
        ? ''
        : bdDays === 0
          ? ' (today)'
          : ` in ${bdDays} day${bdDays === 1 ? '' : 's'}`;
      const bdDisplayRaw = String(data.birthdayDisplay || '').trim();
      const bdDisplaySafe = bdDisplayRaw && !/[\u0590-\u05FF\u0600-\u06FF]/.test(bdDisplayRaw);
      const bdDatePart = bdDisplaySafe ? ` ${bdDisplayRaw}` : '';
      const bdLine = `${bdName}'s birthday is${bdDatePart}${bdDaysPart}.`;
      return `
        <div style="font-size:13px;line-height:1.5;color:#374151;">
          <div style="padding:10px;background:#f9fafb;border-radius:8px;">${escapeHtml(bdLine)}</div>
        </div>
      `;
    }

    case 'onboarding_incomplete': {
      const who = String(data.subjectStaffName || 'Staff').trim();
      const pkg = String(data.packageName || 'onboarding').trim();
      const reqDone = Number(data.progressRequiredCompleted);
      const reqTotal = Number(data.progressRequiredTotal);
      const prog =
        Number.isFinite(reqTotal) && reqTotal > 0
          ? `${reqDone}/${reqTotal} required tasks done`
          : String(data.runStatus || 'in progress');
      const msg = String(data.message || `${who} has not finished ${pkg}.`).trim();
      return `
        <div style="font-size:13px;line-height:1.5;color:#374151;display:grid;gap:10px;">
          <div style="padding:10px;background:#fffbeb;border-radius:8px;">${escapeHtml(msg)}</div>
          <div><span style="color:#6b7280;">Progress:</span> <span style="font-weight:500;margin-left:6px;">${escapeHtml(prog)}</span></div>
        </div>
      `;
    }

    case 'document_expiring_soon':
    case 'document_expired':
      return `<div style="font-size:13px;color:#374151;line-height:1.5;">${escapeHtml(ffDocAlertHumanSummary(request))}</div>`;
      
    default:
      if (data.details) {
        return `<div style="font-size:13px;"><span style="color:#6b7280;">Details:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${escapeHtml(data.details)}</div></div>`;
      }
      const typeInfo = getRequestTypeInfo(request.type);
      const fieldLabels = (typeInfo.fields || []).reduce((acc, f) => { acc[f.id] = f.label; return acc; }, {});
      const entries = Object.entries(data || {}).filter(([, v]) => v != null && v !== '');
      if (entries.length === 0) return '<div style="color:#9ca3af;">No details available</div>';
      return `<div style="display:grid;gap:12px;font-size:13px;">${entries.map(([k, v]) => `<div><span style="color:#6b7280;">${escapeHtml(fieldLabels[k] || k)}:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${escapeHtml(String(v))}</div></div>`).join('')}</div>`;
  }
}

export { showRequestDetails };
