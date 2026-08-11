/**
 * Inbox — Create Request Form
 * Type selection + dynamic request form builder + supplies item rows.
 * Extracted verbatim from inbox.js (M4).
 *
 * window globals (side-effect on load): selectRequestType, addSuppliesItem.
 * Injection: submitRequest (lives in inbox.js until M5 / inbox-submit.js).
 */

import { auth } from "/app.js?v=20260610_force_lp_ios";
import { inboxState } from "./inbox-state.js?v=20260810_owner_inbox_load_v5";
import { inboxNormalizeLineStaffRoleLc } from "./inbox-helpers.js?v=20260810_owner_inbox_load_v5";
import { getRequestTypeInfo } from "./inbox-types.js?v=20260810_owner_inbox_load_v5";
import { escapeHtml, showToast } from "./inbox-utils.js?v=20260630_inbox_utils_split";
import {
  inboxCanSendRequests,
  loadSalonUsersForRecipients,
  getInboxRecipientsList,
  getCreateRequestSelectedRecipients,
} from "./inbox-data.js?v=20260810_owner_inbox_load_v5";
import {
  SUPPLIES_ITEM_ROW_INNER_HTML,
  wireSuppliesItemRow,
  initSuppliesRequestForm,
} from "./inbox-supplies.js?v=20260629_inbox_supplies_split";
import { ffStaffDocumentTypeSelectOptionsHtml } from "./staff-documents.js?v=20260701_staffdoc_render_split";

// submitRequest is injected from inbox.js (function declaration) until M5 extraction.
let submitRequest = () => {};
export function initInboxCreateForm(deps = {}) {
  if (typeof deps.submitRequest === "function") submitRequest = deps.submitRequest;
}

window.selectRequestType = async function(type) {
  console.log('[Inbox] Selected type:', type);

  if (!inboxCanSendRequests()) {
    if (typeof showToast === "function") showToast("You do not have permission to create requests.", "error");
    return;
  }

  document.getElementById('stepSelectType').style.display = 'none';
  document.getElementById('stepRequestForm').style.display = 'block';
  
  const formContainer = document.getElementById('requestFormContainer');
  if (!formContainer) return;

  // Pre-load salon users so recipient list has Firebase UIDs
  await loadSalonUsersForRecipients();
  
  // Render form based on type
  const form = createRequestForm(type);
  formContainer.innerHTML = '';
  formContainer.appendChild(form);
  if (type === 'document_request') {
    const emailEl = document.getElementById('doc_req_email');
    if (emailEl && auth.currentUser?.email) emailEl.value = auth.currentUser.email;
  }
  if (type === 'document_upload') {
    const p = window.__ffDocUploadPrefill;
    if (p) {
      if (p.documentType) {
        const sel = document.getElementById('doc_up_type');
        const val = String(p.documentType || '').trim();
        if (sel && val && Array.from(sel.options).some((o) => o.value === val)) {
          sel.value = val;
        }
      }
      if (p.renewForDocId) {
        const hid = document.getElementById('doc_up_renew_for_doc_id');
        if (hid) hid.value = String(p.renewForDocId).trim();
      }
    }
    window.__ffDocUploadPrefill = null;
  }
  if (type === 'document_renewal_request') {
    const p = window.__ffDocRenewalPrefill;
    if (p && (p.staffId || p.documentType || p.documentId)) {
      if (p.staffId) {
        const sel = document.getElementById('doc_renew_staff');
        if (sel) {
          const opt = Array.from(sel.options).find((o) => (o.getAttribute('data-staff-id') || '') === p.staffId);
          if (opt) sel.value = opt.value;
        }
      }
      const dt = document.getElementById('doc_renew_type');
      if (dt && p.documentType) {
        const val = p.documentType;
        if (Array.from(dt.options).some((o) => o.value === val)) dt.value = val;
      }
      const hid = document.getElementById('doc_renew_related_document_id');
      if (hid && p.documentId) hid.value = p.documentId;
    }
    window.__ffDocRenewalPrefill = null;
  }
};

function createRequestForm(type) {
  const form = document.createElement('div');
  const typeInfo = getRequestTypeInfo(type);
  const recipientsList = getInboxRecipientsList();
  const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const instructionsHtml = (typeInfo.description && typeInfo.description.trim())
    ? `<p style="margin:8px 0 0;font-size:13px;color:#6b7280;text-align:center;max-width:400px;margin-left:auto;margin-right:auto;">${esc(typeInfo.description.trim())}</p>`
    : '';
  const isRenewal = type === 'document_renewal_request';
  const technicians = isRenewal
    ? (inboxState._inboxUsersCache || []).filter((u) => inboxNormalizeLineStaffRoleLc(u.role) === 'technician')
    : [];
  const renewalStaffHtml =
    technicians.length === 0
      ? `<div style="margin-bottom:16px;padding:10px 12px;border:1px solid #fecaca;border-radius:8px;font-size:13px;color:#b91c1c;">No service providers in the directory. Staff must sign in once so they appear under members.</div>`
      : `
    <div style="margin-bottom:16px;">
      <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Who should upload the document?</label>
      <select id="doc_renew_staff" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;">
        <option value="">Select staff member…</option>
        ${technicians.map((u) => {
          const id = esc(u.uid || '');
          const sid = esc(u.staffId || '');
          const nm = esc(u.name || '');
          return `<option value="${id}" data-uid="${id}" data-staff-id="${sid}" data-name="${nm}">${nm}</option>`;
        }).join('')}
      </select>
      <input type="hidden" id="doc_renew_related_document_id" value="" />
    </div>
  `;
  const sendToRowHtml = isRenewal
    ? renewalStaffHtml
    : recipientsList.length === 0
    ? `<div style="margin-bottom:16px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#6b7280;">Send to: No managers or admins in list.</div>`
    : `
    <div id="sendToFilterRow" role="button" tabindex="0" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;cursor:pointer;background:#f9fafb;font-size:13px;">
      <span><span style="font-weight:500;color:#374151;">Send to:</span> <span id="sendToSummary">Choose who receives this request</span></span>
      <span id="sendToArrow" style="color:#6b7280;font-size:10px;">▶</span>
    </div>
    <div id="sendToPanel" style="display:none;margin-bottom:16px;padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;max-height:180px;overflow-y:auto;">
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${recipientsList.map(s => `
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
            <input type="checkbox" class="create-request-send-to-cb" data-uid="${esc(s.uid || '')}" data-staff-id="${esc(s.id)}" data-staff-name="${esc(s.name)}" style="width:14px;height:14px;">
            <span>${esc(s.name)}</span>
          </label>
        `).join('')}
      </div>
    </div>
  `;
  form.innerHTML = `
    <div style="text-align:center;margin-bottom:20px;">
      <div style="font-size:32px;margin-bottom:8px;">${typeInfo.icon}</div>
      <h3 style="margin:0;font-size:16px;font-weight:600;">${typeInfo.label}</h3>
      ${instructionsHtml}
    </div>
    <div style="margin-bottom:16px;">
      ${sendToRowHtml}
    </div>
  `;
  
  if (!isRenewal && recipientsList.length > 0) {
    const row = form.querySelector('#sendToFilterRow');
    const panel = form.querySelector('#sendToPanel');
    const summary = form.querySelector('#sendToSummary');
    const arrow = form.querySelector('#sendToArrow');
    const updateSummary = () => {
      const { names } = getCreateRequestSelectedRecipients();
      if (summary) summary.textContent = names.length > 0 ? names.join(', ') : 'Choose who receives this request';
    };
    row.addEventListener('click', () => {
      const open = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : 'block';
      if (arrow) arrow.textContent = open ? '▶' : '▼';
    });
    form.querySelectorAll('.create-request-send-to-cb').forEach(cb => {
      cb.addEventListener('change', updateSummary);
    });
  }
  
  const fieldsContainer = document.createElement('div');
  fieldsContainer.style.cssText = 'display:flex;flex-direction:column;gap:16px;';
  
  // Build form fields based on type
  if (type === 'vacation') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Start Date</label>
        <input type="date" id="vacation_startDate" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">End Date</label>
        <input type="date" id="vacation_endDate" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Reason (optional)</label>
        <textarea id="vacation_note" rows="3" placeholder="e.g., Family vacation planned months ago" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else if (type === 'late_start') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Date</label>
        <input type="date" id="latestart_date" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Requested Start Time</label>
        <input type="time" id="latestart_time" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Reason</label>
        <textarea id="latestart_reason" rows="2" required placeholder="e.g., Doctor appointment" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else if (type === 'early_leave') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Date</label>
        <input type="date" id="earlyleave_date" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Requested Leave Time</label>
        <input type="time" id="earlyleave_time" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Reason</label>
        <textarea id="earlyleave_reason" rows="2" required placeholder="e.g., Family emergency" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else if (type === 'day_off') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Date</label>
        <input type="date" id="dayoff_date" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Note (optional)</label>
        <textarea id="dayoff_note" rows="2" placeholder="Optional context" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else if (type === 'time_off') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">First day off</label>
        <input type="date" id="timeoff_startDate" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Last day off (same as first for one day)</label>
        <input type="date" id="timeoff_endDate" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Note (optional)</label>
        <textarea id="timeoff_note" rows="2" placeholder="Optional context" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else if (type === 'schedule_change') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Current Schedule</label>
        <input type="text" id="schedchange_current" placeholder="e.g., Mon-Fri 9-5" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Requested Schedule</label>
        <input type="text" id="schedchange_requested" required placeholder="e.g., Tue-Sat 10-6" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Reason</label>
        <textarea id="schedchange_reason" rows="2" required placeholder="Why do you need this change?" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
      <div style="font-size:12px;color:#4b5563;line-height:1.45;padding:8px 10px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
        <strong>Calendar impact (when approved):</strong> dates below map to availability. Single day = same start and end date.
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">First date this change applies to</label>
        <input type="date" id="schedchange_startDate" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Last date (optional; defaults to first date)</label>
        <input type="date" id="schedchange_endDate" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="schedchange_temporary" style="width:16px;height:16px;">
          <span style="font-size:13px;color:#374151;">Temporary change</span>
        </label>
      </div>
    `;
  } else if (type === 'extra_shift') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Date (optional)</label>
        <input type="date" id="extra_shift_date" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Details</label>
        <textarea id="extra_shift_details" rows="3" required placeholder="Which day(s) and shift you want to pick up" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else if (type === 'swap_shift') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Date (optional)</label>
        <input type="date" id="swap_shift_date" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Details</label>
        <textarea id="swap_shift_details" rows="3" required placeholder="Who to swap with, which shift, and any details" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else if (type === 'break_change') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Date</label>
        <input type="date" id="break_change_date" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Details</label>
        <textarea id="break_change_details" rows="3" required placeholder="Requested break time and reason" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else if (type === 'commission_review' || type === 'tip_adjustment' || type === 'payment_issue' || type === 'client_issue') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Subject (optional)</label>
        <input type="text" id="${type}_subject" placeholder="Brief description" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Details</label>
        <textarea id="${type}_details" rows="4" required placeholder="Explain your request" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else if (type === 'document_renewal_request') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Document type</label>
        <select id="doc_renew_type" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
          ${ffStaffDocumentTypeSelectOptionsHtml()}
        </select>
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Message to staff</label>
        <textarea id="doc_renew_message" rows="3" required placeholder="e.g. Please upload a renewed certificate before the current one expires." style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Due date (optional)</label>
        <input type="date" id="doc_renew_due" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
    `;
  } else if (type === 'document_request') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Document type</label>
        <select id="doc_req_type" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
          ${ffStaffDocumentTypeSelectOptionsHtml()}
        </select>
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Reason / Notes</label>
        <textarea id="doc_req_reason" rows="2" required placeholder="e.g. For bank, taxes, apartment" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Due date (optional)</label>
        <input type="date" id="doc_req_due" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Delivery method</label>
        <select id="doc_req_delivery" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
          <option value="Email">Email</option>
          <option value="Download in app">Download in app</option>
          <option value="Printed pickup">Printed pickup</option>
        </select>
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Contact email</label>
        <input type="email" id="doc_req_email" placeholder="Email to receive the document" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
    `;
  } else if (type === 'document_upload') {
    fieldsContainer.innerHTML = `
      <input type="hidden" id="doc_up_renew_for_doc_id" value="" />
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Document type</label>
        <select id="doc_up_type" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
          ${ffStaffDocumentTypeSelectOptionsHtml()}
        </select>
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Expiration date</label>
        <input type="date" id="doc_up_expiry" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">File (PDF, JPG or PNG)</label>
        <input type="file" id="doc_up_file" accept=".pdf,.jpg,.jpeg,.png" required style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Notes (optional)</label>
        <textarea id="doc_up_notes" rows="2" placeholder="Additional details" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else if (type === 'supplies') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Items needed</label>
        <p id="suppliesInventoryEmptyHint" style="display:none;margin:0 0 8px;font-size:12px;color:#b45309;">No inventory categories yet. Add categories in Inventory.</p>
        <div id="suppliesItemsList" style="display:flex;flex-direction:column;gap:10px;margin-bottom:8px;">
          <div class="supplies-item-row" style="display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa;">
            ${SUPPLIES_ITEM_ROW_INNER_HTML}
          </div>
        </div>
        <button type="button" onclick="addSuppliesItem()" style="padding:6px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:12px;">+ Add Item</button>
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Urgency</label>
        <select id="supplies_urgency" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
          <option value="routine">Routine</option>
          <option value="urgent">Urgent</option>
          <option value="critical">Critical</option>
        </select>
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Additional details</label>
        <textarea id="supplies_note" rows="2" placeholder="Additional details" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
    void initSuppliesRequestForm(fieldsContainer);
  } else if (type === 'maintenance') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Issue</label>
        <input type="text" id="maintenance_issue" required placeholder="e.g., Sink is leaking" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Area/Location</label>
        <input type="text" id="maintenance_area" required placeholder="e.g., Station 3, Break room" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Severity</label>
        <select id="maintenance_severity" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
          <option value="minor">Minor</option>
          <option value="moderate">Moderate</option>
          <option value="urgent">Urgent</option>
        </select>
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Additional Details (optional)</label>
        <textarea id="maintenance_note" rows="3" placeholder="More details about the issue" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else if (type === 'other') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Subject</label>
        <input type="text" id="other_subject" required placeholder="Brief description" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Details</label>
        <textarea id="other_details" rows="4" required placeholder="Explain your request" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else {
    // Custom request type: dynamic fields from admin definition, or single Details
    const customType = getRequestTypeInfo(type);
    const fields = (customType.fields || []);
    if (fields.length > 0) {
      const inputStyle = 'width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;';
      fields.forEach(f => {
        const div = document.createElement('div');
        const id = 'custom_field_' + f.id;
        const req = f.required ? 'required' : '';
        if (f.type === 'textarea') {
          div.innerHTML = `<label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label><textarea id="${id}" rows="3" ${req} placeholder="${escapeHtml(f.label)}" style="${inputStyle}resize:vertical;"></textarea>`;
        } else if (f.type === 'date') {
          div.innerHTML = `<label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label><input type="date" id="${id}" ${req} style="${inputStyle}">`;
        } else if (f.type === 'number') {
          div.innerHTML = `<label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label><input type="number" id="${id}" ${req} style="${inputStyle}">`;
        } else {
          div.innerHTML = `<label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label><input type="text" id="${id}" ${req} placeholder="${escapeHtml(f.label)}" style="${inputStyle}">`;
        }
        fieldsContainer.appendChild(div);
      });
    } else {
      const placeholder = (customType.description && customType.description.trim())
        ? customType.description.trim().slice(0, 120) + (customType.description.trim().length > 120 ? '…' : '')
        : 'Describe your request...';
      fieldsContainer.innerHTML = `
        <div>
          <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Details</label>
          <textarea id="custom_details" rows="4" required placeholder="${esc(placeholder)}" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
        </div>
      `;
    }
  }
  
  // Add submit button
  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Submit Request';
  submitBtn.onclick = () => submitRequest(type);
  submitBtn.style.cssText = `
    width: 100%;
    padding: 12px;
    background: #7c3aed;
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    margin-top: 20px;
  `;
  
  form.appendChild(fieldsContainer);
  form.appendChild(submitBtn);
  
  return form;
}

window.addSuppliesItem = function() {
  const list = document.getElementById("suppliesItemsList");
  if (!list) return;
  const categories = (typeof window !== "undefined" && window._suppliesFormCategoriesCache) || [];
  const row = document.createElement("div");
  row.className = "supplies-item-row";
  row.style.cssText = "display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa;";
  row.innerHTML = SUPPLIES_ITEM_ROW_INNER_HTML;
  list.appendChild(row);
  wireSuppliesItemRow(row, categories);
};
