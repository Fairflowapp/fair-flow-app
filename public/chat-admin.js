// chat-admin.js
// Chat Templates + Flows admin (settings modal). Extracted verbatim from
// chat.js. Core, non-pure dependencies (permission checks, data loaders,
// effective location key, send-options renderer) are injected via
// initChatAdmin() so the bodies stay unchanged and the core <-> admin cycle
// is broken. All window.* handlers remain global for HTML onclick bindings.

import {
  collection, addDoc, updateDoc, doc, getDocs, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import {
  addFlowOptionAt,
  addFlowOptionByStepId,
  addFlowStep,
  addFlowStepAndLinkAt,
  addFlowStepAndLinkByStepId,
  collectFlowStepsFromDom,
  ensureFlowDraft,
  removeFlowOptionAt,
  removeFlowOptionByStepId,
  removeFlowStepAt,
  removeFlowStepById,
  unlinkFlowOption
} from "./flow-builder.js";
import {
  escHtml,
  roleLabel,
  _chatOrderValue,
  _chatSortByOrder,
  _chatCategoryValue,
  _chatGroupByCategory
} from "./chat-helpers.js?v=20260901_chat_iso";
import { chatState } from "./chat-state.js?v=20260901_chat_iso";
import { initChatAdminFlows, _renderFlowsAdminList, _renderFlowBuilder } from "./chat-admin-flows.js?v=20260901_chat_iso";

// ─── Injected core dependencies (set by initChatAdmin) ──────────────────────────
let _deps = {};
let _chatManageAllowed = () => false;
let _chatWaitForManagePermission = () => Promise.resolve(false);
let loadChatUserProfile = async () => {};
let loadChatTemplates = async () => {};
let loadChatFlows = async () => {};
let _chatEffectiveLocKey = () => '';

export function initChatAdmin(deps) {
  _deps = deps || {};
  _chatManageAllowed = deps._chatManageAllowed;
  _chatWaitForManagePermission = deps._chatWaitForManagePermission;
  loadChatUserProfile = deps.loadChatUserProfile;
  loadChatTemplates = deps.loadChatTemplates;
  loadChatFlows = deps.loadChatFlows;
  _chatEffectiveLocKey = deps._chatEffectiveLocKey;
  // Fan-out to the flows half (chat-admin-flows.js): its injected core deps are
  // the manage-permission gate, effective-location key, flows loader, plus the
  // two category-field helpers that stay resident in this module.
  initChatAdminFlows({
    _chatManageAllowed, _chatEffectiveLocKey, loadChatFlows,
    _ensureChatCategoryFields, _chatRefreshCategorySuggestions,
  });
}

// ─── Category suggestion helpers (admin-only) ───────────────────────────────────
function _chatKnownCategories() {
  const names = new Map();
  [...chatState.chatTemplates, ...chatState.chatFlows].forEach(item => {
    const category = _chatCategoryValue(item?.category);
    if (!category) return;
    names.set(category.toLowerCase(), category);
  });
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

function _chatRefreshCategorySuggestions() {
  const list = document.getElementById('chatCategorySuggestions');
  if (!list) return;
  list.innerHTML = _chatKnownCategories()
    .map(category => `<option value="${escHtml(category)}"></option>`)
    .join('');
}

// ─── Admin Templates + Flows Settings ───────────────────────────────────────────
function _ensureChatCategoryFields() {
  const ensureField = ({ id, afterId, placeholder }) => {
    if (document.getElementById(id)) return;
    const anchor = document.getElementById(afterId);
    const anchorRow = anchor?.closest?.('.chat-tmpl-field-row');
    if (!anchorRow?.parentNode) return;
    const row = document.createElement('div');
    row.className = 'chat-tmpl-field-row';
    row.innerHTML = `<input id="${id}" type="text" list="chatCategorySuggestions" placeholder="${placeholder}" maxlength="40" class="chat-tmpl-input">`;
    anchorRow.parentNode.insertBefore(row, anchorRow.nextSibling);
  };
  ensureField({
    id: 'chatTmplCategory',
    afterId: 'chatTmplTitle',
    placeholder: 'Category (optional, e.g. Timing, Client, Drinks)'
  });
  ensureField({
    id: 'chatFlowCategory',
    afterId: 'chatFlowTitle',
    placeholder: 'Category (optional, e.g. Timing, Client, Drinks)'
  });
  if (!document.getElementById('chatCategorySuggestions')) {
    const datalist = document.createElement('datalist');
    datalist.id = 'chatCategorySuggestions';
    document.body.appendChild(datalist);
  }
  _chatRefreshCategorySuggestions();
}

window.openChatTemplatesSettings = async function() {
  if (!(await _chatWaitForManagePermission())) return;
  if (!chatState.chatUserProfile) await loadChatUserProfile();
  await Promise.all([loadChatTemplates(), loadChatFlows()]);
  _ensureChatCategoryFields();
  _chatRefreshCategorySuggestions();
  // Reset the compact form to its default "new" state each time we open
  chatState.chatEditingTmplId = null;
  const titleEl = document.getElementById('chatTmplTitle');
  const categoryEl = document.getElementById('chatTmplCategory');
  const msgEl   = document.getElementById('chatTmplMessage');
  if (titleEl) titleEl.value = '';
  if (categoryEl) categoryEl.value = '';
  if (msgEl)   msgEl.value   = '';
  ['Tech','Mgr','Admin'].forEach(s => {
    const cb = document.getElementById(`chatTmplSender${s}`);
    if (cb) cb.checked = false;
  });
  _setChatTmplSaveBtn('add');
  const label = document.getElementById('chatTmplFormLabel');
  if (label) label.textContent = 'New Template';
  _setChatTmplDetailsOpen(false);

  // Wire up the Options toggle (idempotent — uses a dataset flag so multiple opens don't stack listeners)
  const toggle = document.getElementById('chatTmplDetailsToggle');
  if (toggle && !toggle.dataset.ffBound) {
    toggle.addEventListener('click', function(e) {
      e.preventDefault();
      const currentlyOpen = toggle.getAttribute('aria-expanded') === 'true';
      _setChatTmplDetailsOpen(!currentlyOpen);
    });
    toggle.dataset.ffBound = '1';
  }

  _renderTmplList();
  _chatSettingsTab('templates');
  document.getElementById('chatTemplatesModal').style.display = 'flex';
};
window.closeChatTemplatesModal = function() {
  document.getElementById('chatTemplatesModal').style.display = 'none';
  chatState.chatEditingTmplId = null;
  chatState.chatEditingFlowId = null;
  chatState.chatFlowDraft = null;
  _setChatTmplDetailsOpen(false);
};

window._chatSettingsTab = function(tab) {
  if (!_chatManageAllowed()) return;
  _ensureChatCategoryFields();
  document.querySelectorAll('.chat-settings-tab').forEach(b => { b.classList.remove('active'); });
  const t = document.getElementById('chatSettingsTab' + (tab === 'templates' ? 'Templates' : 'Flows'));
  if (t) t.classList.add('active');
  document.getElementById('chatSettingsTemplatesPane').style.display = tab === 'templates' ? 'flex' : 'none';
  const fp = document.getElementById('chatSettingsFlowsPane');
  if (fp) {
    fp.style.display = tab === 'flows' ? 'flex' : 'none';
    if (tab === 'flows') {
      // Wire the flow options toggle once
      const flowToggle = document.getElementById('chatFlowDetailsToggle');
      if (flowToggle && !flowToggle.dataset.ffBound) {
        flowToggle.addEventListener('click', function(e) {
          e.preventDefault();
          const open = flowToggle.getAttribute('aria-expanded') === 'true';
          _setChatFlowDetailsOpen(!open);
        });
        flowToggle.dataset.ffBound = '1';
      }
      // If not editing, keep form collapsed and save button in "add" mode
      if (!chatState.chatEditingFlowId) {
        _setChatFlowSaveBtn('add');
        const label = document.getElementById('chatFlowFormLabel');
        if (label) label.textContent = 'New Flow';
      }
      _renderFlowsAdminList();
      _renderFlowBuilder();
    }
  }
};

function _renderTmplList() {
  _chatRefreshCategorySuggestions();
  const el = document.getElementById('chatTemplatesAdminList');
  const countEl = document.getElementById('chatTemplatesCountBadge');
  if (countEl) countEl.textContent = String(chatState.chatTemplates.length || 0);
  if (!el) return;

  if (chatState.chatTemplates.length === 0) {
    el.innerHTML = `
      <div class="chat-tmpl-bank-empty">
        No templates yet. Use the form above to add your first one.
      </div>`;
    return;
  }

  const editSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
  const delSvg  = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path></svg>';

  // Short role codes: Service Provider → SP, Manager → M, Admin → A
  const roleShort = r => ({ technician: 'SP', manager: 'M', admin: 'A' }[r] || (r || '').slice(0,2).toUpperCase());

  el.innerHTML = _chatGroupByCategory(chatState.chatTemplates).map(([categoryName, groupItems]) => `
    <div class="chat-category-section">
      <div class="chat-category-section-title">${escHtml(categoryName)}</div>
      <div class="chat-category-section-items">
        ${groupItems.map(t => {
    const idEsc = escHtml(t.id);
    const isEditing = chatState.chatEditingTmplId === t.id;
    const hasRoles = Array.isArray(t.allowedSenders) && t.allowedSenders.length > 0;
    const rolesInline = hasRoles
      ? `<span class="chat-tmpl-card-roles-inline" title="${escHtml(t.allowedSenders.map(roleLabel).join(', '))}">${escHtml(t.allowedSenders.map(roleShort).join(' · '))}</span>`
      : '<span class="chat-tmpl-card-roles-inline everyone" title="Everyone can send">ALL</span>';
    return `
      <div class="chat-tmpl-card${isEditing ? ' editing' : ''}" data-tmpl-id="${idEsc}">
        <div class="chat-tmpl-card-main">
          <div class="chat-tmpl-card-top">
            <span class="chat-tmpl-card-title">${escHtml(t.title)}</span>
            ${rolesInline}
          </div>
          ${t.message ? `<div class="chat-tmpl-card-message">${escHtml(t.message)}</div>` : ''}
        </div>
        <div class="chat-tmpl-card-actions">
          <button type="button" class="chat-tmpl-icon-btn" title="Edit" aria-label="Edit template"
            onclick="window.editChatTemplate('${idEsc}')">${editSvg}</button>
          <button type="button" class="chat-tmpl-icon-btn is-danger" title="Delete" aria-label="Delete template"
            onclick="window.deleteChatTemplate('${idEsc}')">${delSvg}</button>
        </div>
      </div>
    `;
        }).join('')}
      </div>
    </div>
  `).join('');
}
// Helpers for the compact form
function _setChatTmplSaveBtn(mode) {
  // mode: 'add' | 'update' | 'saving'
  const btn = document.getElementById('chatTmplSaveBtn');
  if (!btn) return;
  const plusSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
  const checkSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  if (mode === 'saving') {
    btn.innerHTML = '<span>Saving…</span>';
  } else if (mode === 'update') {
    btn.innerHTML = `${checkSvg}<span>Save</span>`;
  } else {
    btn.innerHTML = `${plusSvg}<span>Add</span>`;
  }
}
function _setChatTmplDetailsOpen(open) {
  const details = document.getElementById('chatTmplDetails');
  const toggle  = document.getElementById('chatTmplDetailsToggle');
  if (!details || !toggle) return;
  details.style.display = open ? 'flex' : 'none';
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}
window._setChatTmplDetailsOpen = _setChatTmplDetailsOpen;

window.editChatTemplate = function(id) {
  if (!_chatManageAllowed()) return;
  _ensureChatCategoryFields();
  if (String(id || '').startsWith('shared:')) {
    if (typeof window.ffStyledAlert === 'function') window.ffStyledAlert('Shared templates are managed in Settings → Shared Setup.');
    else alert('Shared templates are managed in Settings → Shared Setup.');
    return;
  }
  const t = chatState.chatTemplates.find(x => x.id === id);
  if (!t) return;
  chatState.chatEditingTmplId = id;
  document.getElementById('chatTmplTitle').value   = t.title   || '';
  const categoryEl = document.getElementById('chatTmplCategory');
  if (categoryEl) categoryEl.value = t.category || '';
  document.getElementById('chatTmplMessage').value = t.message || '';
  ['Tech','Mgr','Admin'].forEach((s,i) => {
    const cb = document.getElementById(`chatTmplSender${s}`);
    if (cb) cb.checked = Array.isArray(t.allowedSenders) && t.allowedSenders.includes(['technician','manager','admin'][i]);
  });
  _setChatTmplSaveBtn('update');
  const label = document.getElementById('chatTmplFormLabel');
  if (label) label.textContent = 'Edit Template';
  _setChatTmplDetailsOpen(true);
  document.getElementById('chatTmplForm')?.scrollIntoView({ behavior:'smooth', block:'start' });
  _renderTmplList();
};
window.cancelEditChatTemplate = function() {
  chatState.chatEditingTmplId = null;
  _ensureChatCategoryFields();
  const titleEl = document.getElementById('chatTmplTitle');
  const categoryEl = document.getElementById('chatTmplCategory');
  const msgEl   = document.getElementById('chatTmplMessage');
  if (titleEl) titleEl.value = '';
  if (categoryEl) categoryEl.value = '';
  if (msgEl)   msgEl.value   = '';
  ['Tech','Mgr','Admin'].forEach(s => {
    const cb = document.getElementById(`chatTmplSender${s}`);
    if (cb) cb.checked = false;
  });
  _setChatTmplSaveBtn('add');
  const label = document.getElementById('chatTmplFormLabel');
  if (label) label.textContent = 'New Template';
  _setChatTmplDetailsOpen(false);
  _renderTmplList();
};
window.saveChatTemplate = async function() {
  if (!_chatManageAllowed()) return;
  _ensureChatCategoryFields();
  const title   = document.getElementById('chatTmplTitle')?.value.trim();
  const category = _chatCategoryValue(document.getElementById('chatTmplCategory')?.value);
  const message = document.getElementById('chatTmplMessage')?.value.trim() || '';
  const allowedSenders = ['technician','manager','admin'].filter((_,i) => {
    return document.getElementById(`chatTmplSender${['Tech','Mgr','Admin'][i]}`)?.checked;
  });
  if (!title) {
    if (typeof window.ffStyledAlert === 'function') window.ffStyledAlert('Please enter a title.');
    else alert('Please enter a title.');
    return;
  }
  const btn = document.getElementById('chatTmplSaveBtn');
  const wasEditing = !!chatState.chatEditingTmplId;
  if (btn) { btn.disabled = true; }
  _setChatTmplSaveBtn('saving');
  const locKey = _chatEffectiveLocKey();
  try {
    if (chatState.chatEditingTmplId) {
      await updateDoc(doc(db, `salons/${chatState.chatUserProfile.salonId}/chatTemplates`, chatState.chatEditingTmplId),
        { title, category, message, allowedSenders, locationId: locKey, updatedAt: serverTimestamp() });
    } else {
      await addDoc(collection(db, `salons/${chatState.chatUserProfile.salonId}/chatTemplates`),
        { title, category, message, allowedSenders, locationId: locKey, order: chatState.chatTemplates.length, createdAt: serverTimestamp(), createdBy: chatState.chatUserProfile.uid });
    }
    window.cancelEditChatTemplate();
    await loadChatTemplates({ force: true });
    _renderTmplList();
  } catch(e) {
    console.error('[Chat] save template error', e?.code, e?.message, e);
    const msg = 'Failed to save: ' + (e?.code || e?.message || 'unknown');
    if (typeof window.ffStyledAlert === 'function') window.ffStyledAlert(msg);
    else alert(msg);
  }
  finally {
    if (btn) { btn.disabled = false; }
    _setChatTmplSaveBtn(chatState.chatEditingTmplId ? 'update' : 'add');
  }
};
window.deleteChatTemplate = async function(id) {
  if (!_chatManageAllowed()) return;
  if (String(id || '').startsWith('shared:')) {
    if (typeof window.ffStyledAlert === 'function') window.ffStyledAlert('Shared templates are managed in Settings → Shared Setup.');
    else alert('Shared templates are managed in Settings → Shared Setup.');
    return;
  }
  const tmpl = chatState.chatTemplates.find(x => x.id === id);
  const titleStr = tmpl?.title ? `"${tmpl.title}"` : 'this template';
  if (!confirm(`Delete ${titleStr}?`)) return;
  try {
    await deleteDoc(doc(db, `salons/${chatState.chatUserProfile.salonId}/chatTemplates`, id));
    if (chatState.chatEditingTmplId === id) window.cancelEditChatTemplate();
    await loadChatTemplates({ force: true });
    _renderTmplList();
  } catch(e) {
    console.error('[Chat] delete template error', e?.code, e?.message, e);
    const msg = 'Failed to delete: ' + (e?.code || e?.message || 'unknown');
    if (typeof window.ffStyledAlert === 'function') window.ffStyledAlert(msg);
    else alert(msg);
  }
};

window.ffReloadChatTemplates = async function() {
  await Promise.all([loadChatTemplates({ force: true }), loadChatFlows({ force: true })]);
  _renderTmplList();
  _renderFlowsAdminList();
  _deps.renderSendOptions?.();
};

export { _renderTmplList, _renderFlowsAdminList };
