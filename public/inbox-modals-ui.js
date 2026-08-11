/**
 * Inbox — modals + settings UI (extracted from inbox.js).
 * Create Request modal, Inbox Settings modal, and custom request-type management.
 *
 * Pure window.* UI handlers + two module-internal helpers
 * (renderCustomTypesList, openAddCustomTypeForm). No injection needed:
 * all dependencies come from stable leaf modules.
 */

import {
  collection,
  addDoc,
  updateDoc,
  doc,
  deleteDoc,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import {
  inboxState,
  REQUEST_CATEGORY_LABELS,
  BUILTIN_TYPES,
  CUSTOM_TYPE_EMOJIS,
} from "./inbox-state.js?v=20260810_owner_inbox_load_v5";
import {
  loadCustomTypes,
  setInboxTypeVisibility,
  getRequestTypesGroupedByCategory,
} from "./inbox-types.js?v=20260810_owner_inbox_load_v5";
import { escapeHtml, showToast } from "./inbox-utils.js?v=20260630_inbox_utils_split";
import { inboxUserRoleLc, inboxCanSendRequests } from "./inbox-data.js?v=20260810_owner_inbox_load_v5";

// =====================
// Create Request Modal
// =====================
function removeAllCreateRequestModals() {
  document.querySelectorAll("#createRequestModal").forEach((el) => el.remove());
}

window.openCreateRequestModal = function() {
  if (!inboxCanSendRequests()) {
    if (typeof showToast === "function") showToast("You do not have permission to create requests.", "error");
    return;
  }
  console.log('[Inbox] Opening create request modal');

  // Prevent stacking: drop any leftover overlays (and their onclick handlers) first.
  removeAllCreateRequestModals();
  
  // Create modal
  const modal = document.createElement('div');
  modal.id = 'createRequestModal';
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
    max-width: 500px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
  `;
  
  const grouped = getRequestTypesGroupedByCategory();
  const renderTypeBtn = (t) => `
    <button class="request-type-btn" data-type="${t.id}" onclick="selectRequestType('${t.id}')" style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;cursor:pointer;text-align:left;transition:all 0.2s;display:flex;align-items:center;gap:10px;">
      <span style="font-size:20px;">${t.icon}</span>
      <div>
        <div style="font-weight:500;font-size:14px;">${t.label}</div>
      </div>
    </button>
  `;
  const categoryOrder = ['schedule', 'payments', 'operations', 'documents', 'custom', 'other'];
  const sectionLabels = { ...REQUEST_CATEGORY_LABELS, custom: '📌 Custom' };
  let typeSectionsHtml = '';
  categoryOrder.forEach((cat) => {
    const types = grouped[cat];
    if (!types || types.length === 0) return;
    const label = sectionLabels[cat] || cat;
    typeSectionsHtml += `
      <div class="request-type-section" data-category="${cat}" style="margin-bottom:8px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <div class="request-category-header" role="button" tabindex="0" onclick="window.toggleRequestCategory('${cat}')" style="display:flex;align-items:center;gap:8px;padding:12px 14px;cursor:pointer;user-select:none;font-size:13px;font-weight:600;color:#374151;background:#f9fafb;">
          <span class="request-category-arrow" style="font-size:10px;transition:transform 0.2s;color:#6b7280;">▶</span>
          <span>${label}</span>
        </div>
        <div class="request-category-body" style="display:none;flex-direction:column;gap:8px;padding:12px 14px 14px 32px;background:#fff;border-top:1px solid #e5e7eb;">${types.map(renderTypeBtn).join('')}</div>
      </div>
    `;
  });

  content.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
      <h2 style="margin:0;font-size:18px;font-weight:600;">New Request</h2>
      <button onclick="closeCreateRequestModal()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#9ca3af;">&times;</button>
    </div>
    <div id="createRequestForm">
      <div id="stepSelectType" style="display:block;">
        <label style="display:block;margin-bottom:12px;font-size:14px;font-weight:500;color:#374151;">Request Type</label>
        <div style="display:flex;flex-direction:column;gap:4px;">${typeSectionsHtml}</div>
      </div>
      <div id="stepRequestForm" style="display:none;">
        <button onclick="backToTypeSelection()" style="margin-bottom:16px;background:none;border:none;color:#6b7280;cursor:pointer;font-size:14px;">← Back to request types</button>
        <div id="requestFormContainer"></div>
      </div>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  // Click outside to close — bound on this element only; remove() drops the handler with the node.
  modal.onclick = (e) => {
    if (e.target === modal) {
      window.closeCreateRequestModal();
    }
  };
};

window.closeCreateRequestModal = function() {
  removeAllCreateRequestModals();
};

window.toggleRequestCategory = function(cat) {
  const modal = document.getElementById('createRequestModal');
  if (!modal) return;
  const section = modal.querySelector(`.request-type-section[data-category="${cat}"]`);
  if (!section) return;
  const body = section.querySelector('.request-category-body');
  const arrow = section.querySelector('.request-category-arrow');
  if (!body || !arrow) return;
  const isOpen = body.style.display === 'flex';
  body.style.display = isOpen ? 'none' : 'flex';
  arrow.textContent = isOpen ? '▶' : '▼';
};

// =====================
// Inbox Settings Modal (admin/owner only) — custom request types
// =====================
window.openInboxSettingsModal = function() {
  if (!inboxState.currentUserProfile?.salonId || !["admin", "owner"].includes(inboxUserRoleLc())) return;
  const modal = document.createElement('div');
  modal.id = 'inboxSettingsModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:999999;padding:20px;';
  const content = document.createElement('div');
  content.style.cssText = 'background:#fff;border-radius:12px;padding:24px;max-width:480px;width:100%;max-height:90vh;overflow-y:auto;';

  const categoryOrder = ['schedule', 'payments', 'operations', 'documents', 'other'];
  const categoryLabels = { ...REQUEST_CATEGORY_LABELS };
  let systemSectionsHtml = '';
  categoryOrder.forEach(cat => {
    const types = BUILTIN_TYPES.filter(t => (t.category || 'other') === cat);
    if (types.length === 0) return;
    const label = categoryLabels[cat] || cat;
    const rows = types.map(t => {
      const hidden = (inboxState.inboxHiddenTypes || []).includes(t.id);
      return `<div class="inbox-visibility-row" data-type-id="${t.id}" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:6px;">
        <span style="font-size:18px;">${t.icon || '📝'}</span>
        <span style="flex:1;margin-left:10px;font-size:14px;font-weight:500;">${escapeHtml(t.label)}</span>
        <button type="button" class="inbox-visibility-toggle" data-type-id="${t.id}" data-hidden="${hidden}" style="padding:6px 12px;border-radius:6px;cursor:pointer;font-size:13px;border:1px solid #e5e7eb;background:${hidden ? '#fef2f2;color:#dc2626' : '#f0fdf4;color:#16a34a'};">${hidden ? '🚫 Hidden' : '👁 Enabled'}</button>
      </div>`;
    }).join('');
    systemSectionsHtml += `
      <div class="settings-category-section" data-category="${cat}" style="margin-bottom:8px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <div class="settings-category-header" role="button" tabindex="0" style="display:flex;align-items:center;gap:8px;padding:12px 14px;cursor:pointer;user-select:none;font-size:13px;font-weight:600;color:#374151;background:#f9fafb;">
          <span class="settings-category-arrow" style="font-size:10px;transition:transform 0.2s;color:#6b7280;">▶</span>
          <span>${label}</span>
        </div>
        <div class="settings-category-body" style="display:none;padding:12px 14px 14px 20px;background:#fff;border-top:1px solid #e5e7eb;">${rows}</div>
      </div>
    `;
  });

  content.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
      <h2 style="margin:0;font-size:18px;font-weight:600;">Inbox Settings</h2>
      <button type="button" onclick="closeInboxSettingsModal()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#9ca3af;">&times;</button>
    </div>
    <div style="margin-bottom:20px;">
      <h3 style="margin:0 0 10px;font-size:13px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.03em;">System Request Types</h3>
      <p style="margin:0 0 12px;font-size:12px;color:#9ca3af;">Control which types staff can see in New Request.</p>
      <div id="systemTypesVisibilityList">${systemSectionsHtml}</div>
    </div>
    <div style="margin-bottom:16px;">
      <h3 style="margin:0 0 10px;font-size:13px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.03em;">Custom Request Types</h3>
      <p style="margin:0 0 12px;font-size:12px;color:#9ca3af;">Add types and control visibility.</p>
      <div id="customTypesList" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;"></div>
      <button type="button" id="btnAddCustomType" style="padding:8px 14px;border:1px solid #d1d5db;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;color:#374151;">+ Add custom type</button>
    </div>
  `;
  modal.appendChild(content);
  document.body.appendChild(modal);
  modal.onclick = (e) => { if (e.target === modal) closeInboxSettingsModal(); };

  content.querySelectorAll('.settings-category-header').forEach(header => {
    header.onclick = () => {
      const section = header.closest('.settings-category-section');
      const body = section.querySelector('.settings-category-body');
      const arrow = header.querySelector('.settings-category-arrow');
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : 'block';
      if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(90deg)';
    };
  });

  content.querySelectorAll('.inbox-visibility-toggle').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const typeId = btn.dataset.typeId;
      const hidden = btn.dataset.hidden !== 'true';
      try {
        await setInboxTypeVisibility(typeId, hidden);
        btn.dataset.hidden = String(hidden);
        btn.textContent = hidden ? '🚫 Hidden' : '👁 Enabled';
        btn.style.background = hidden ? '#fef2f2' : '#f0fdf4';
        btn.style.color = hidden ? '#dc2626' : '#16a34a';
        showToast(hidden ? 'Hidden from staff' : 'Visible to staff', 'success');
      } catch (err) {
        console.error('[Inbox] setInboxTypeVisibility', err);
        showToast('Failed to update: ' + (err.message || 'check console'), 'error');
      }
    };
  });
  renderCustomTypesList(document.getElementById('customTypesList'));
  document.getElementById('btnAddCustomType').onclick = () => openAddCustomTypeForm(content);
};

window.closeInboxSettingsModal = function() {
  const m = document.getElementById('inboxSettingsModal');
  if (m) m.remove();
};

function renderCustomTypesList(container) {
  if (!container) return;
  container.innerHTML = '';
  const hiddenSet = new Set(inboxState.inboxHiddenTypes || []);
  (inboxState.customRequestTypes || []).forEach(t => {
    const hidden = hiddenSet.has(t.id);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:6px;';
    row.innerHTML = `
      <span style="font-size:18px;">${t.icon || '📝'}</span>
      <span style="flex:1;margin-left:10px;font-size:14px;font-weight:500;">${escapeHtml(t.label || t.id)}</span>
      <button type="button" class="custom-type-visibility-toggle" data-type-id="${t.id}" data-hidden="${hidden}" style="padding:6px 10px;border-radius:6px;cursor:pointer;font-size:12px;margin-right:6px;border:1px solid #e5e7eb;background:${hidden ? '#fef2f2;color:#dc2626' : '#f0fdf4;color:#16a34a'};">${hidden ? '🚫' : '👁'}</button>
      <button type="button" onclick="editCustomType('${t.id}')" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:12px;margin-right:6px;">Edit</button>
      <button type="button" onclick="deleteCustomType('${t.id}')" style="padding:6px 10px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:6px;cursor:pointer;font-size:12px;">Delete</button>
    `;
    container.appendChild(row);
  });
  container.querySelectorAll('.custom-type-visibility-toggle').forEach(btn => {
    btn.onclick = async () => {
      const typeId = btn.dataset.typeId;
      const hidden = btn.dataset.hidden !== 'true';
      try {
        await setInboxTypeVisibility(typeId, hidden);
        btn.dataset.hidden = String(hidden);
        btn.textContent = hidden ? '🚫' : '👁';
        btn.style.background = hidden ? '#fef2f2' : '#f0fdf4';
        btn.style.color = hidden ? '#dc2626' : '#16a34a';
        showToast(hidden ? 'Hidden from staff' : 'Visible to staff', 'success');
      } catch (err) {
        console.error('[Inbox] setInboxTypeVisibility (custom)', err);
        showToast('Failed to update: ' + (err.message || 'check console'), 'error');
      }
    };
  });
  if ((inboxState.customRequestTypes || []).length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:13px;color:#9ca3af;padding:12px;';
    empty.textContent = 'No custom types yet. Add one below.';
    container.appendChild(empty);
  }
}

window.editCustomType = function(typeId) {
  const t = (inboxState.customRequestTypes || []).find(x => x.id === typeId);
  if (!t || !inboxState.currentUserProfile?.salonId) return;
  const modal = document.getElementById('inboxSettingsModal');
  const content = modal?.firstElementChild;
  openAddCustomTypeForm(content, typeId, t);
};

// Emojis the admin can pick from (no typing needed)

function openAddCustomTypeForm(settingsContent, editTypeId, editData) {
  if (!settingsContent) return;
  const existing = settingsContent.querySelector('#addCustomTypeForm');
  if (existing) existing.remove();
  const isEdit = !!editTypeId;
  const form = document.createElement('div');
  form.id = 'addCustomTypeForm';
  form.style.cssText = 'margin-top:16px;padding:16px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;';
  const emojiRow = CUSTOM_TYPE_EMOJIS.map(e => `<button type="button" class="custom-type-emoji-btn" data-emoji="${e}" style="width:36px;height:36px;padding:0;border:1px solid #e5e7eb;border-radius:8px;background:#fff;cursor:pointer;font-size:18px;line-height:1;">${e}</button>`).join('');
  form.innerHTML = `
    <div style="margin-bottom:10px;">
      <label style="display:block;margin-bottom:4px;font-size:13px;font-weight:500;color:#374151;">Name</label>
      <input type="text" id="customTypeLabel" placeholder="e.g. Training Request" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;">
    </div>
    <div style="margin-bottom:10px;">
      <label style="display:block;margin-bottom:4px;font-size:13px;font-weight:500;color:#374151;">Instructions for staff</label>
      <p style="margin:0 0 6px;font-size:12px;color:#6b7280;">What should staff write in the request? This text will appear under the type name.</p>
      <textarea id="customTypeDescription" rows="2" placeholder="e.g. Write the course name, desired date, and why you need this training" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;resize:vertical;"></textarea>
    </div>
    <div style="margin-bottom:12px;">
      <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Icon — choose one</label>
      <div id="customTypeEmojiRow" style="display:flex;flex-wrap:wrap;gap:6px;">${emojiRow}</div>
      <input type="hidden" id="customTypeIcon" value="📝">
    </div>
    <div style="display:flex;gap:8px;">
      <button type="button" id="btnSaveCustomType" style="padding:8px 16px;background:#7c3aed;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">Save</button>
      <button type="button" onclick="document.getElementById('addCustomTypeForm').remove()" style="padding:8px 16px;border:1px solid #d1d5db;background:#fff;border-radius:6px;cursor:pointer;font-size:13px;">Cancel</button>
    </div>
  `;
  settingsContent.appendChild(form);
  const iconInput = document.getElementById('customTypeIcon');
  form.querySelectorAll('.custom-type-emoji-btn').forEach(btn => {
    btn.onclick = () => {
      const em = btn.dataset.emoji;
      iconInput.value = em;
      form.querySelectorAll('.custom-type-emoji-btn').forEach(b => { b.style.background = '#fff'; b.style.borderColor = '#e5e7eb'; });
      btn.style.background = '#ede9fe';
      btn.style.borderColor = '#7c3aed';
    };
  });
  if (isEdit && editData) {
    document.getElementById('customTypeLabel').value = editData.label || '';
    document.getElementById('customTypeDescription').value = editData.description || '';
    const icon = (editData.icon || '📝').slice(0, 2);
    iconInput.value = icon;
    const firstMatch = form.querySelector(`.custom-type-emoji-btn[data-emoji="${icon}"]`);
    if (firstMatch) { firstMatch.style.background = '#ede9fe'; firstMatch.style.borderColor = '#7c3aed'; }
  } else {
    const firstBtn = form.querySelector('.custom-type-emoji-btn[data-emoji="📝"]');
    if (firstBtn) { firstBtn.style.background = '#ede9fe'; firstBtn.style.borderColor = '#7c3aed'; }
  }
  document.getElementById('btnSaveCustomType').textContent = isEdit ? 'Update' : 'Save';
  document.getElementById('btnSaveCustomType').onclick = async () => {
    const label = document.getElementById('customTypeLabel')?.value?.trim();
    const icon = (document.getElementById('customTypeIcon')?.value?.trim() || '📝').slice(0, 2);
    const description = document.getElementById('customTypeDescription')?.value?.trim() || '';
    if (!label) { showToast('Enter a name', 'error'); return; }
    try {
      const payload = { label, icon, description };
      if (isEdit) {
        await updateDoc(doc(db, `salons/${inboxState.currentUserProfile.salonId}/requestTypes`, editTypeId), payload);
        showToast('Updated', 'success');
      } else {
        await addDoc(collection(db, `salons/${inboxState.currentUserProfile.salonId}/requestTypes`), payload);
        showToast('Custom type added', 'success');
      }
      await loadCustomTypes();
      document.getElementById('addCustomTypeForm')?.remove();
      renderCustomTypesList(document.getElementById('customTypesList'));
    } catch (err) {
      console.error(err);
      showToast('Failed: ' + (err.message || ''), 'error');
    }
  };
}

window.deleteCustomType = async function(typeId) {
  if (!inboxState.currentUserProfile?.salonId || !confirm('Delete this request type? Existing requests of this type will keep their label.')) return;
  try {
    await deleteDoc(doc(db, `salons/${inboxState.currentUserProfile.salonId}/requestTypes`, typeId));
    await loadCustomTypes();
    const listEl = document.getElementById('customTypesList');
    if (listEl) renderCustomTypesList(listEl);
    showToast('Type removed', 'success');
  } catch (err) {
    console.error(err);
    showToast('Failed to delete: ' + (err.message || ''), 'error');
  }
};

window.backToTypeSelection = function() {
  document.getElementById('stepSelectType').style.display = 'block';
  document.getElementById('stepRequestForm').style.display = 'none';
};
