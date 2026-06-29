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
} from "./chat-helpers.js?v=20260626_chat_helpers_split";
import { chatState } from "./chat-state.js?v=20260627_chat_state_split";

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

window._chatFlowAddStep = function() {
  if (!_chatManageAllowed()) return;
  _syncFlowDraftFromUI();
  chatState.chatFlowDraft = addFlowStep(chatState.chatFlowDraft, { title: '', category: '', allowedSenders: [] });
  _renderFlowBuilder();
};

window._chatFlowRemoveStep = function(idx) {
  if (!_chatManageAllowed()) return;
  _syncFlowDraftFromUI();
  chatState.chatFlowDraft = removeFlowStepAt(chatState.chatFlowDraft, idx, { title: '', category: '', allowedSenders: [] });
  _renderFlowBuilder();
};

window._chatFlowRemoveStepById = function(stepId) {
  if (!_chatManageAllowed()) return;
  _syncFlowDraftFromUI();
  chatState.chatFlowDraft = removeFlowStepById(chatState.chatFlowDraft, stepId, { title: '', category: '', allowedSenders: [] });
  _renderFlowBuilder();
};

window._chatFlowAddOption = function(stepIdx) {
  if (!_chatManageAllowed()) return;
  _syncFlowDraftFromUI();
  chatState.chatFlowDraft = addFlowOptionAt(chatState.chatFlowDraft, stepIdx, { title: '', category: '', allowedSenders: [] });
  _renderFlowBuilder();
};

window._chatFlowAddOptionById = function(stepId) {
  if (!_chatManageAllowed()) return;
  _syncFlowDraftFromUI();
  chatState.chatFlowDraft = addFlowOptionByStepId(chatState.chatFlowDraft, stepId, { title: '', category: '', allowedSenders: [] });
  _renderFlowBuilder();
};

window._chatFlowRemoveOption = function(stepIdx, optIdx) {
  if (!_chatManageAllowed()) return;
  _syncFlowDraftFromUI();
  chatState.chatFlowDraft = removeFlowOptionAt(chatState.chatFlowDraft, stepIdx, optIdx, { title: '', category: '', allowedSenders: [] });
  _renderFlowBuilder();
};

window._chatFlowRemoveOptionByIdx = function(stepId, optIdx) {
  if (!_chatManageAllowed()) return;
  _syncFlowDraftFromUI();
  chatState.chatFlowDraft = removeFlowOptionByStepId(chatState.chatFlowDraft, stepId, optIdx, { title: '', category: '', allowedSenders: [] });
  _renderFlowBuilder();
};

// Add a new step and link the given option to it (for branching)
window._chatFlowAddStepAndLink = function(stepIdx, optIdx) {
  if (!_chatManageAllowed()) return;
  _syncFlowDraftFromUI();
  chatState.chatFlowDraft = addFlowStepAndLinkAt(chatState.chatFlowDraft, stepIdx, optIdx, { title: '', category: '', allowedSenders: [] });
  _renderFlowBuilder();
};

window._chatFlowAddStepAndLinkById = function(stepId, optIdx) {
  _syncFlowDraftFromUI();
  chatState.chatFlowDraft = addFlowStepAndLinkByStepId(chatState.chatFlowDraft, stepId, optIdx, { title: '', category: '', allowedSenders: [] });
  _renderFlowBuilder();
};

window._chatFlowUnlinkStep = function(stepId, optIdx) {
  if (!_chatManageAllowed()) return;
  _syncFlowDraftFromUI();
  chatState.chatFlowDraft = unlinkFlowOption(chatState.chatFlowDraft, stepId, optIdx, { title: '', category: '', allowedSenders: [] });
  _renderFlowBuilder();
};

// Collect steps from the flat builder DOM, preserving the visible question order.
function _collectStepsFromTreeDOM() {
  return collectFlowStepsFromDom({
    nodeSelector: '#chatFlowStepsList > .chat-flow-node',
    stepIdAttr: 'data-step-id',
    promptSelector: '.chat-flow-step-prompt',
    optionsContainerClass: 'chat-flow-options',
    optionBlockClass: 'chat-flow-answer-block',
    optionLabelSelector: '.chat-flow-opt-label',
    optionNextSelector: '.chat-flow-next-select',
    draft: chatState.chatFlowDraft
  });
}

// Sync current form values from DOM into chatFlowDraft.
function _syncFlowDraftFromUI() {
  chatState.chatFlowDraft = ensureFlowDraft(chatState.chatFlowDraft, { title: '', category: '', allowedSenders: [] });
  chatState.chatFlowDraft.title = document.getElementById('chatFlowTitle')?.value ?? '';
  chatState.chatFlowDraft.category = _chatCategoryValue(document.getElementById('chatFlowCategory')?.value);
  chatState.chatFlowDraft.allowedSenders = ['technician','manager','admin'].filter((_, i) =>
    document.getElementById(['chatFlowSenderTech','chatFlowSenderMgr','chatFlowSenderAdmin'][i])?.checked);
  const treeNodes = document.querySelectorAll?.('#chatFlowStepsList > .chat-flow-node');
  if (treeNodes?.length) {
    chatState.chatFlowDraft.steps = _collectStepsFromTreeDOM();
  }
}

function _collectFlowDraftFromUI() {
  if (!chatState.chatFlowDraft) return null;
  const title = document.getElementById('chatFlowTitle')?.value?.trim();
  if (!title) return null;
  const category = _chatCategoryValue(document.getElementById('chatFlowCategory')?.value);
  const allowedSenders = ['technician','manager','admin'].filter((_,i) =>
    document.getElementById(['chatFlowSenderTech','chatFlowSenderMgr','chatFlowSenderAdmin'][i])?.checked);
  const treeNodes = document.querySelectorAll?.('#chatFlowStepsList > .chat-flow-node');
  if (!treeNodes?.length) return null;
  const steps = _collectStepsFromTreeDOM();
  if (steps.length === 0) return null;
  const root = steps[0];
  if (!root?.prompt?.trim()) { alert('Please fill in the first question.'); return null; }
  if (!root?.options?.length || root.options.every(o => !(o.label || '').trim())) { alert('Please add at least one answer to the first question.'); return null; }
  return { title, category, allowedSenders, steps };
}

// Helpers for the compact Flow form
function _setChatFlowSaveBtn(mode) {
  const btn = document.getElementById('chatFlowSaveBtn');
  if (!btn) return;
  const plusSvg  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
  const checkSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  if (mode === 'saving') btn.innerHTML = '<span>Saving…</span>';
  else if (mode === 'update') btn.innerHTML = `${checkSvg}<span>Save</span>`;
  else btn.innerHTML = `${plusSvg}<span>Add</span>`;
}
function _setChatFlowDetailsOpen(open) {
  const details = document.getElementById('chatFlowDetails');
  const toggle  = document.getElementById('chatFlowDetailsToggle');
  if (!details || !toggle) return;
  details.style.display = open ? 'flex' : 'none';
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}
window._setChatFlowDetailsOpen = _setChatFlowDetailsOpen;

window.saveChatFlow = async function() {
  if (!_chatManageAllowed()) return;
  _ensureChatCategoryFields();

  // Specific, per-field validation so the user knows exactly what's missing
  const titleEl = document.getElementById('chatFlowTitle');
  const rawTitle = (titleEl?.value || '').trim();
  if (!rawTitle) {
    if (titleEl) {
      titleEl.focus();
      titleEl.style.borderColor = '#ef4444';
      titleEl.style.background = '#fef2f2';
      const clear = () => {
        titleEl.style.borderColor = '';
        titleEl.style.background = '';
        titleEl.removeEventListener('input', clear);
      };
      titleEl.addEventListener('input', clear);
    }
    const msg = 'Please enter a flow title first.';
    if (typeof window.ffStyledAlert === 'function') window.ffStyledAlert(msg);
    else alert(msg);
    return;
  }
  // Make sure the draft is up-to-date before validating the tree
  try { _syncFlowDraftFromUI(); } catch (_) {}
  const treeNodes = document.querySelectorAll('#chatFlowStepsList > .chat-flow-node');
  if (!treeNodes || !treeNodes.length) {
    const msg = 'Please add at least one question in the decision tree.';
    if (typeof window.ffStyledAlert === 'function') window.ffStyledAlert(msg);
    else alert(msg);
    const addBtn = document.getElementById('chatFlowAddStepBtn');
    if (addBtn) addBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const draft = _collectFlowDraftFromUI();
  if (!draft) {
    // Most common: questions or answers are blank
    const msg = 'Please fill in every question with at least one answer before saving.';
    if (typeof window.ffStyledAlert === 'function') window.ffStyledAlert(msg);
    else alert(msg);
    return;
  }
  const btn = document.getElementById('chatFlowSaveBtn');
  const wasEditing = !!chatState.chatEditingFlowId;
  if (btn) { btn.disabled = true; }
  _setChatFlowSaveBtn('saving');
  const locKey = _chatEffectiveLocKey();
  try {
    const salonId = chatState.chatUserProfile.salonId;
    const flowsRef = collection(db, `salons/${salonId}/chatFlows`);
    let flowId = chatState.chatEditingFlowId;
    if (flowId) {
      await updateDoc(doc(db, `salons/${salonId}/chatFlows`, flowId), {
        title: draft.title, category: draft.category, allowedSenders: draft.allowedSenders, locationId: locKey, updatedAt: serverTimestamp()
      });
      // Delete old steps/options and recreate (simplest)
      const oldSteps = await getDocs(collection(db, `salons/${salonId}/chatFlows/${flowId}/steps`));
      for (const sd of oldSteps.docs) {
        const opts = await getDocs(collection(db, `salons/${salonId}/chatFlows/${flowId}/steps/${sd.id}/options`));
        for (const od of opts.docs) await deleteDoc(od.ref);
        await deleteDoc(sd.ref);
      }
    } else {
      const ref = await addDoc(flowsRef, {
        title: draft.title, category: draft.category, allowedSenders: draft.allowedSenders, status: 'active', locationId: locKey,
        startStepId: draft.steps[0]?.id, createdAt: serverTimestamp(), createdBy: chatState.chatUserProfile.uid
      });
      flowId = ref.id;
    }
    const stepsRef = collection(db, `salons/${salonId}/chatFlows/${flowId}/steps`);
    const stepIdMap = {}; // draft step id -> firestore step id
    for (let i = 0; i < draft.steps.length; i++) {
      const s = draft.steps[i];
      const stepRef = await addDoc(stepsRef, { prompt: s.prompt, order: i });
      stepIdMap[s.id] = stepRef.id;
    }
    for (let i = 0; i < draft.steps.length; i++) {
      const s = draft.steps[i];
      const firestoreStepId = stepIdMap[s.id];
      const optsRef = collection(db, 'salons', salonId, 'chatFlows', flowId, 'steps', firestoreStepId, 'options');
      for (let oidx = 0; oidx < s.options.length; oidx++) {
        const o = s.options[oidx];
        const nextId = o.nextStepId ? (stepIdMap[o.nextStepId] || o.nextStepId) : null;
        await addDoc(optsRef, { label: o.label, order: oidx, nextStepId: nextId, finish: !!o.finish });
      }
      if (i === 0) await updateDoc(doc(db, `salons/${salonId}/chatFlows`, flowId), { startStepId: firestoreStepId });
    }
    window.cancelEditChatFlow();
    await loadChatFlows({ force: true });
    _renderFlowsAdminList();
    if (typeof window.showToast === 'function') window.showToast('Flow saved', 'success');
  } catch(e) {
    console.error('[Chat] save flow error', e);
    const msg = 'Failed to save: ' + (e?.code || e?.message || 'unknown');
    if (typeof window.ffStyledAlert === 'function') window.ffStyledAlert(msg);
    else alert(msg);
  } finally {
    if (btn) { btn.disabled = false; }
    _setChatFlowSaveBtn(chatState.chatEditingFlowId ? 'update' : 'add');
  }
};

window.cancelEditChatFlow = function() {
  chatState.chatEditingFlowId = null;
  _ensureChatCategoryFields();
  chatState.chatFlowDraft = { title: '', category: '', allowedSenders: [], steps: [] };
  const titleEl = document.getElementById('chatFlowTitle');
  const categoryEl = document.getElementById('chatFlowCategory');
  if (titleEl) titleEl.value = '';
  if (categoryEl) categoryEl.value = '';
  ['chatFlowSenderTech','chatFlowSenderMgr','chatFlowSenderAdmin'].forEach(id => {
    const cb = document.getElementById(id);
    if (cb) cb.checked = false;
  });
  const label = document.getElementById('chatFlowFormLabel');
  if (label) label.textContent = 'New Flow';
  _setChatFlowSaveBtn('add');
  const cancelBtn = document.getElementById('chatFlowCancelBtn');
  if (cancelBtn) cancelBtn.style.display = 'none';
  _setChatFlowDetailsOpen(false);
  _renderFlowBuilder();
  _renderFlowsAdminList();
};

window.editChatFlow = function(id) {
  if (!_chatManageAllowed()) return;
  _ensureChatCategoryFields();
  const f = chatState.chatFlows.find(x => x.id === id);
  if (!f) return;
  if (f.isSharedFlow) {
    alert('Shared flows are managed in Settings → Shared Setup.');
    return;
  }
  chatState.chatEditingFlowId = id;
  let stepList = (f.steps || []).map(s => ({
    id: s.id,
    prompt: s.prompt,
    order: s.order,
    options: _chatSortByOrder(s.options || []).map((o, oidx) => ({
      id: o.id,
      label: o.label,
      order: _chatOrderValue(o.order, oidx),
      nextStepId: o.nextStepId,
      finish: !!o.finish
    }))
  }));
  const rootId = f.startStepId;
  if (rootId && stepList.length > 1) {
    const rootIdx = stepList.findIndex(s => s.id === rootId);
    if (rootIdx > 0) {
      const [root] = stepList.splice(rootIdx, 1);
      stepList = [root, ...stepList];
    }
  }
  chatState.chatFlowDraft = { title: f.title, category: f.category || '', allowedSenders: f.allowedSenders || [], steps: stepList };
  document.getElementById('chatFlowTitle').value = f.title || '';
  const categoryEl = document.getElementById('chatFlowCategory');
  if (categoryEl) categoryEl.value = f.category || '';
  ['chatFlowSenderTech','chatFlowSenderMgr','chatFlowSenderAdmin'].forEach((id, i) => {
    const cb = document.getElementById(id);
    if (cb) cb.checked = Array.isArray(f.allowedSenders) && f.allowedSenders.includes(['technician','manager','admin'][i]);
  });
  const label = document.getElementById('chatFlowFormLabel');
  if (label) label.textContent = 'Edit Flow';
  _setChatFlowSaveBtn('update');
  const cancelBtn = document.getElementById('chatFlowCancelBtn');
  if (cancelBtn) cancelBtn.style.display = 'inline-block';
  _setChatFlowDetailsOpen(true);
  _renderFlowBuilder();
  _renderFlowsAdminList();
  document.getElementById('chatFlowForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.deleteChatFlow = async function(id) {
  if (!_chatManageAllowed()) return;
  const flow = chatState.chatFlows.find(x => x.id === id);
  if (flow?.isSharedFlow) {
    alert('Shared flows are managed in Settings → Shared Setup.');
    return;
  }
  const titleStr = flow?.title ? `"${flow.title}"` : 'this flow';
  if (!confirm(`Delete ${titleStr}?`)) return;
  try {
    if (flow?.steps) {
      for (const s of flow.steps) {
        if (s.options) for (const o of s.options) {
          const ref = doc(db, `salons/${chatState.chatUserProfile.salonId}/chatFlows/${id}/steps/${s.id}/options`, o.id);
          try { await deleteDoc(ref); } catch(_) {}
        }
        try { await deleteDoc(doc(db, `salons/${chatState.chatUserProfile.salonId}/chatFlows/${id}/steps`, s.id)); } catch(_) {}
      }
    }
    if (chatState.chatEditingFlowId === id) window.cancelEditChatFlow();
    await deleteDoc(doc(db, `salons/${chatState.chatUserProfile.salonId}/chatFlows`, id));
    await loadChatFlows({ force: true });
    _renderFlowsAdminList();
  } catch(e) {
    console.error('[Chat] delete flow error', e);
    const msg = 'Failed to delete: ' + (e?.code || e?.message || 'unknown');
    if (typeof window.ffStyledAlert === 'function') window.ffStyledAlert(msg);
    else alert(msg);
  }
};

function _renderFlowsAdminList() {
  _chatRefreshCategorySuggestions();
  const el = document.getElementById('chatFlowsAdminList');
  const countEl = document.getElementById('chatFlowsCountBadge');
  if (countEl) countEl.textContent = String(chatState.chatFlows.length || 0);
  if (!el) return;

  if (chatState.chatFlows.length === 0) {
    el.innerHTML = `
      <div class="chat-tmpl-bank-empty">
        No flows yet. Use the form above to add your first one.
      </div>`;
    return;
  }

  const editSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
  const delSvg  = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path></svg>';
  const roleShort = r => ({ technician: 'SP', manager: 'M', admin: 'A' }[r] || (r || '').slice(0,2).toUpperCase());

  el.innerHTML = _chatGroupByCategory(chatState.chatFlows).map(([categoryName, groupItems]) => `
    <div class="chat-category-section">
      <div class="chat-category-section-title">${escHtml(categoryName)}</div>
      <div class="chat-category-section-items">
        ${groupItems.map(f => {
    const idEsc = escHtml(f.id);
    const isEditing = chatState.chatEditingFlowId === f.id;
    const stepCount = (f.steps || []).length;
    const hasRoles = Array.isArray(f.allowedSenders) && f.allowedSenders.length > 0;
    const rolesInline = hasRoles
      ? `<span class="chat-tmpl-card-roles-inline" title="${escHtml(f.allowedSenders.map(roleLabel).join(', '))}">${escHtml(f.allowedSenders.map(roleShort).join(' · '))}</span>`
      : '<span class="chat-tmpl-card-roles-inline everyone" title="Everyone can use">ALL</span>';
    return `
      <div class="chat-tmpl-card${isEditing ? ' editing' : ''}" data-flow-id="${idEsc}">
        <div class="chat-tmpl-card-main">
          <div class="chat-tmpl-card-top">
            <span class="chat-tmpl-card-title">${escHtml(f.title)}</span>
            ${rolesInline}
          </div>
          <div class="chat-tmpl-card-message">${stepCount} ${stepCount === 1 ? 'question' : 'questions'}</div>
        </div>
        <div class="chat-tmpl-card-actions">
          <button type="button" class="chat-tmpl-icon-btn" title="Edit" aria-label="Edit flow"
            onclick="window.editChatFlow('${idEsc}')">${editSvg}</button>
          <button type="button" class="chat-tmpl-icon-btn is-danger" title="Delete" aria-label="Delete flow"
            onclick="window.deleteChatFlow('${idEsc}')">${delSvg}</button>
        </div>
      </div>
    `;
        }).join('')}
      </div>
    </div>
  `).join('');
}

function _renderFlowBuilder() {
  if (!chatState.chatFlowDraft && !chatState.chatEditingFlowId) chatState.chatFlowDraft = { title: '', category: '', allowedSenders: [], steps: [] };
  if (chatState.chatEditingFlowId && !chatState.chatFlowDraft) {
    const f = chatState.chatFlows.find(x => x.id === chatState.chatEditingFlowId);
    if (f) chatState.chatFlowDraft = { title: f.title, category: f.category || '', allowedSenders: f.allowedSenders || [], steps: (f.steps||[]).map(s => ({ ...s, options: s.options||[] })) };
  }
  const list = document.getElementById('chatFlowStepsList');
  if (!list) return;
  const steps = chatState.chatFlowDraft?.steps || [];
  const mobileFlow =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 768px)').matches;

  function stepOptionsHtml(currentStepId, selectedId) {
    if (mobileFlow) {
      let html = '<option value="" title="End flow here (no next question)">END</option>';
      steps.forEach((candidate, idx) => {
        if (candidate.id === currentStepId) return;
        const longLabel = `Question ${idx + 1}${candidate.prompt ? ': ' + candidate.prompt : ''}`;
        const shortLabel = `Q${idx + 1}`;
        html += `<option value="${escHtml(candidate.id)}" title="${escHtml(longLabel)}"${candidate.id === selectedId ? ' selected' : ''}>${escHtml(shortLabel)}</option>`;
      });
      return html;
    }
    let html = '<option value="">End flow</option>';
    steps.forEach((candidate, idx) => {
      if (candidate.id === currentStepId) return;
      const label = `Question ${idx + 1}${candidate.prompt ? ': ' + candidate.prompt : ''}`;
      html += `<option value="${escHtml(candidate.id)}"${candidate.id === selectedId ? ' selected' : ''}>${escHtml(label)}</option>`;
    });
    return html;
  }

  function renderStepNode(s, idx) {
    if (!s) return '';
    const opts = s.options || [];
    const answersHtml = opts.map((o, oidx) => {
      if (mobileFlow) {
        return `
          <div class="chat-flow-answer-block chat-flow-answer-block--mobile" data-step-id="${escHtml(s.id)}" data-opt-idx="${oidx}">
            <input type="text" class="chat-flow-opt-label" data-step-id="${escHtml(s.id)}" data-opt-idx="${oidx}" placeholder="Answer" value="${escHtml(o.label||'')}" style="min-width:0;width:100%;padding:7px 8px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;background:#fff;box-sizing:border-box;">
            <div class="chat-flow-answer-actions">
              <select class="chat-flow-next-select" title="Next step after this answer (END = finish here)">
                ${stepOptionsHtml(s.id, o.nextStepId || '')}
              </select>
              <button type="button" class="chat-flow-next-q-btn" onclick="window._chatFlowAddStepAndLinkById('${escHtml(s.id)}',${oidx})" title="Add next question and link this answer">+ Next</button>
              <button type="button" class="chat-flow-remove-opt-btn" onclick="window._chatFlowRemoveOptionByIdx('${escHtml(s.id)}',${oidx})" title="Remove answer" aria-label="Remove answer">×</button>
            </div>
          </div>
        `;
      }
      return `
          <div class="chat-flow-answer-block" data-step-id="${escHtml(s.id)}" data-opt-idx="${oidx}" style="display:grid;grid-template-columns:minmax(150px,1fr) minmax(140px,190px) auto auto;gap:6px;align-items:center;">
            <input type="text" class="chat-flow-opt-label" data-step-id="${escHtml(s.id)}" data-opt-idx="${oidx}" placeholder="Answer" value="${escHtml(o.label||'')}" style="min-width:0;padding:7px 8px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;background:#fff;">
            <select class="chat-flow-next-select" style="min-width:0;padding:7px 8px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;background:#fff;">
              ${stepOptionsHtml(s.id, o.nextStepId || '')}
            </select>
            <button type="button" class="chat-flow-next-q-btn" onclick="window._chatFlowAddStepAndLinkById('${escHtml(s.id)}',${oidx})" style="padding:6px 8px;font-size:11px;font-weight:800;color:#7c3aed;background:#ede9fe;border:none;border-radius:7px;cursor:pointer;white-space:nowrap;">+ Next question</button>
            <button type="button" class="chat-flow-remove-opt-btn" onclick="window._chatFlowRemoveOptionByIdx('${escHtml(s.id)}',${oidx})" title="Remove answer" style="padding:6px 8px;color:#9ca3af;cursor:pointer;font-size:12px;background:#fff;border:none;border-radius:7px;">×</button>
          </div>
        `;
    }).join('');

    return `
    <div class="chat-flow-node" data-step-id="${escHtml(s.id)}" data-depth="0" style="margin-bottom:10px;padding:10px;border:1px solid #ede9fe;border-radius:12px;background:#faf5ff;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;${mobileFlow ? 'min-width:0;' : ''}">
        <span style="font-size:12px;font-weight:800;color:#7c3aed;">Question ${idx + 1}</span>
        <button type="button" class="chat-flow-remove-step-btn" onclick="window._chatFlowRemoveStepById('${escHtml(s.id)}')" title="Remove question" style="padding:3px 7px;font-size:12px;color:#b91c1c;background:#fef2f2;border:none;border-radius:6px;cursor:pointer;${mobileFlow ? 'flex-shrink:0;' : ''}">Remove</button>
      </div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;${mobileFlow ? 'min-width:0;' : ''}">
        <input type="text" class="chat-flow-step-prompt" data-step-id="${escHtml(s.id)}" placeholder="Question..." value="${escHtml(s.prompt||'')}"
          style="flex:1;min-width:0;padding:7px 8px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;background:#fff;${mobileFlow ? 'box-sizing:border-box;' : ''}">
      </div>
      <div class="chat-flow-options" data-step-id="${escHtml(s.id)}" style="display:flex;flex-direction:column;gap:6px;${mobileFlow ? 'min-width:0;' : ''}">
        ${answersHtml}
        <button type="button" class="chat-flow-add-opt" data-step-id="${escHtml(s.id)}" onclick="window._chatFlowAddOptionById('${escHtml(s.id)}')" style="align-self:flex-start;padding:5px 8px;font-size:11px;font-weight:800;color:#7c3aed;background:#ede9fe;border:none;border-radius:7px;cursor:pointer;">+ Add answer</button>
      </div>
    </div>
    `;
  }

  list.innerHTML = steps.length
    ? steps.map(renderStepNode).join('')
    : '<div style="color:#9ca3af;font-size:12px;padding:8px;">No questions yet. Click "+ Add first question" below.</div>';

  const addBtn = document.getElementById('chatFlowAddStepBtn');
  if (addBtn) {
    addBtn.style.display = 'inline-block';
    addBtn.textContent = steps.length ? '+ Add question' : '+ Add first question';
  }
}

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
