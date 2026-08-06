import {
  addFlowOptionByStepId,
  addFlowStep,
  addFlowStepAndLinkByStepId,
  collectFlowStepsFromDom,
  ensureFlowDraft,
  removeFlowOptionByStepId,
  removeFlowStepById
} from "./flow-builder.js";

let floorFlowDraft = null;

function escHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function ensureFloorFlowDraft() {
  floorFlowDraft = ensureFlowDraft(floorFlowDraft, {
    title: '',
    category: '',
    allowedSenders: []
  });
  return floorFlowDraft;
}

function syncFloorFlowDraftFromUI() {
  const draft = ensureFloorFlowDraft();
  draft.title = document.getElementById('floorFlowTitle')?.value ?? '';
  draft.category = document.getElementById('floorFlowCategory')?.value ?? '';
  draft.allowedSenders = ['technician', 'manager', 'admin'].filter((_, i) =>
    document.getElementById(['floorFlowSenderTech', 'floorFlowSenderMgr', 'floorFlowSenderAdmin'][i])?.checked
  );
  if (document.querySelectorAll('#floorFlowStepsList > .chat-flow-node').length) {
    draft.steps = collectFlowStepsFromDom({
      nodeSelector: '#floorFlowStepsList > .chat-flow-node',
      stepIdAttr: 'data-step-id',
      promptSelector: '.chat-flow-step-prompt',
      optionsContainerClass: 'chat-flow-options',
      optionBlockClass: 'chat-flow-answer-block',
      optionLabelSelector: '.chat-flow-opt-label',
      optionNextSelector: '.chat-flow-next-select',
      draft
    });
  }
}

function renderFloorFlowBuilder() {
  const list = document.getElementById('floorFlowStepsList');
  if (!list) return;
  const draft = ensureFloorFlowDraft();
  const steps = draft.steps || [];
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

  function renderStepNode(step, idx) {
    const answersHtml = (step.options || []).map((option, oidx) => {
      if (mobileFlow) {
        return `
          <div class="chat-flow-answer-block chat-flow-answer-block--mobile" data-step-id="${escHtml(step.id)}" data-opt-idx="${oidx}">
            <input type="text" class="chat-flow-opt-label" data-step-id="${escHtml(step.id)}" data-opt-idx="${oidx}" placeholder="Answer" value="${escHtml(option.label || '')}" style="min-width:0;width:100%;padding:7px 8px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;background:#fff;box-sizing:border-box;">
            <div class="chat-flow-answer-actions">
              <select class="chat-flow-next-select" title="Next step after this answer (END = finish here)">
                ${stepOptionsHtml(step.id, option.nextStepId || '')}
              </select>
              <button type="button" class="chat-flow-next-q-btn" onclick="window._floorFlowAddStepAndLinkById('${escHtml(step.id)}',${oidx})" title="Add next question and link this answer">+ Next</button>
              <button type="button" class="chat-flow-remove-opt-btn" onclick="window._floorFlowRemoveOptionByIdx('${escHtml(step.id)}',${oidx})" title="Remove answer" aria-label="Remove answer">x</button>
            </div>
          </div>
        `;
      }
      return `
        <div class="chat-flow-answer-block" data-step-id="${escHtml(step.id)}" data-opt-idx="${oidx}" style="display:grid;grid-template-columns:minmax(150px,1fr) minmax(140px,190px) auto auto;gap:6px;align-items:center;">
          <input type="text" class="chat-flow-opt-label" data-step-id="${escHtml(step.id)}" data-opt-idx="${oidx}" placeholder="Answer" value="${escHtml(option.label || '')}" style="min-width:0;padding:7px 8px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;background:#fff;">
          <select class="chat-flow-next-select" style="min-width:0;padding:7px 8px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;background:#fff;">
            ${stepOptionsHtml(step.id, option.nextStepId || '')}
          </select>
          <button type="button" class="chat-flow-next-q-btn" onclick="window._floorFlowAddStepAndLinkById('${escHtml(step.id)}',${oidx})" style="padding:6px 8px;font-size:11px;font-weight:800;color:#7c3aed;background:#ede9fe;border:none;border-radius:7px;cursor:pointer;white-space:nowrap;">+ Next question</button>
          <button type="button" class="chat-flow-remove-opt-btn" onclick="window._floorFlowRemoveOptionByIdx('${escHtml(step.id)}',${oidx})" title="Remove answer" style="padding:6px 8px;color:#9ca3af;cursor:pointer;font-size:12px;background:#fff;border:none;border-radius:7px;">x</button>
        </div>
      `;
    }).join('');

    return `
      <div class="chat-flow-node" data-step-id="${escHtml(step.id)}" data-depth="0" style="margin-bottom:10px;padding:10px;border:1px solid #ede9fe;border-radius:12px;background:#faf5ff;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;${mobileFlow ? 'min-width:0;' : ''}">
          <span style="font-size:12px;font-weight:800;color:#7c3aed;">Question ${idx + 1}</span>
          <button type="button" class="chat-flow-remove-step-btn" onclick="window._floorFlowRemoveStepById('${escHtml(step.id)}')" title="Remove question" style="padding:3px 7px;font-size:12px;color:#b91c1c;background:#fef2f2;border:none;border-radius:6px;cursor:pointer;${mobileFlow ? 'flex-shrink:0;' : ''}">Remove</button>
        </div>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;${mobileFlow ? 'min-width:0;' : ''}">
          <input type="text" class="chat-flow-step-prompt" data-step-id="${escHtml(step.id)}" placeholder="Question..." value="${escHtml(step.prompt || '')}"
            style="flex:1;min-width:0;padding:7px 8px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;background:#fff;${mobileFlow ? 'box-sizing:border-box;' : ''}">
        </div>
        <div class="chat-flow-options" data-step-id="${escHtml(step.id)}" style="display:flex;flex-direction:column;gap:6px;${mobileFlow ? 'min-width:0;' : ''}">
          ${answersHtml}
          <button type="button" class="chat-flow-add-opt" data-step-id="${escHtml(step.id)}" onclick="window._floorFlowAddOptionById('${escHtml(step.id)}')" style="align-self:flex-start;padding:5px 8px;font-size:11px;font-weight:800;color:#7c3aed;background:#ede9fe;border:none;border-radius:7px;cursor:pointer;">+ Add answer</button>
        </div>
      </div>
    `;
  }

  list.innerHTML = steps.length
    ? steps.map(renderStepNode).join('')
    : '<div style="color:#9ca3af;font-size:12px;padding:8px;">No questions yet. Click "+ Add first question" below.</div>';

  const addBtn = document.getElementById('floorFlowAddStepBtn');
  if (addBtn) {
    addBtn.textContent = steps.length ? '+ Add question' : '+ Add first question';
  }
}

window.ffFloorFlowEnsureBuilder = function() {
  ensureFloorFlowDraft();
  renderFloorFlowBuilder();
};

window._floorFlowAddStep = function() {
  syncFloorFlowDraftFromUI();
  floorFlowDraft = addFlowStep(floorFlowDraft, { title: '', category: '', allowedSenders: [] });
  renderFloorFlowBuilder();
};

window._floorFlowAddOptionById = function(stepId) {
  syncFloorFlowDraftFromUI();
  floorFlowDraft = addFlowOptionByStepId(floorFlowDraft, stepId, { title: '', category: '', allowedSenders: [] });
  renderFloorFlowBuilder();
};

window._floorFlowRemoveStepById = function(stepId) {
  syncFloorFlowDraftFromUI();
  floorFlowDraft = removeFlowStepById(floorFlowDraft, stepId, { title: '', category: '', allowedSenders: [] });
  renderFloorFlowBuilder();
};

window._floorFlowRemoveOptionByIdx = function(stepId, optIdx) {
  syncFloorFlowDraftFromUI();
  floorFlowDraft = removeFlowOptionByStepId(floorFlowDraft, stepId, optIdx, { title: '', category: '', allowedSenders: [] });
  renderFloorFlowBuilder();
};

window._floorFlowAddStepAndLinkById = function(stepId, optIdx) {
  syncFloorFlowDraftFromUI();
  floorFlowDraft = addFlowStepAndLinkByStepId(floorFlowDraft, stepId, optIdx, { title: '', category: '', allowedSenders: [] });
  renderFloorFlowBuilder();
};

window.ffFloorFlowUiOnlySave = function() {
  syncFloorFlowDraftFromUI();
  if (typeof window.ffToast === 'object' && window.ffToast && typeof window.ffToast.show === 'function') {
    window.ffToast.show('Floor Flow Requests are UI-only in this phase. No data was saved.', {
      variant: 'info',
      durationMs: 2400
    });
  } else {
    alert('Floor Flow Requests are UI-only in this phase. No data was saved.');
  }
};

window.ffFloorFlowGetDraftForSave = function() {
  syncFloorFlowDraftFromUI();
  const draft = ensureFloorFlowDraft();
  return {
    title: String(draft.title || '').trim(),
    category: String(draft.category || '').trim(),
    allowedSenders: Array.isArray(draft.allowedSenders) ? draft.allowedSenders.slice() : [],
    steps: Array.isArray(draft.steps) ? draft.steps.map((step, idx) => ({
      id: step.id,
      prompt: String(step.prompt || '').trim(),
      order: idx,
      options: (step.options || []).map((option, oidx) => ({
        id: option.id,
        label: String(option.label || '').trim(),
        order: oidx,
        nextStepId: option.nextStepId || null,
        finish: !option.nextStepId
      }))
    })) : []
  };
};

window.ffFloorFlowResetDraft = function() {
  floorFlowDraft = { title: '', category: '', allowedSenders: [], steps: [] };
  const titleEl = document.getElementById('floorFlowTitle');
  const categoryEl = document.getElementById('floorFlowCategory');
  if (titleEl) titleEl.value = '';
  if (categoryEl) categoryEl.value = '';
  ['floorFlowSenderTech', 'floorFlowSenderMgr', 'floorFlowSenderAdmin'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.checked = false;
  });
  renderFloorFlowBuilder();
};

window.ffFloorFlowSetDraft = function(draft = {}) {
  floorFlowDraft = {
    title: draft.title || '',
    category: draft.category || '',
    allowedSenders: Array.isArray(draft.allowedSenders) ? draft.allowedSenders.slice() : [],
    steps: Array.isArray(draft.steps) ? draft.steps.map((step, idx) => ({
      id: step.id || `s_loaded_${idx}`,
      prompt: step.prompt || '',
      order: idx,
      options: (step.options || []).map((option, oidx) => ({
        id: option.id || `o_loaded_${idx}_${oidx}`,
        label: option.label || '',
        order: oidx,
        nextStepId: option.nextStepId || null,
        finish: !option.nextStepId
      }))
    })) : []
  };
  const titleEl = document.getElementById('floorFlowTitle');
  const categoryEl = document.getElementById('floorFlowCategory');
  if (titleEl) titleEl.value = floorFlowDraft.title;
  if (categoryEl) categoryEl.value = floorFlowDraft.category;
  const allowed = new Set(floorFlowDraft.allowedSenders);
  [
    ['floorFlowSenderTech', 'technician'],
    ['floorFlowSenderMgr', 'manager'],
    ['floorFlowSenderAdmin', 'admin']
  ].forEach(([id, role]) => {
    const el = document.getElementById(id);
    if (el) el.checked = allowed.has(role);
  });
  renderFloorFlowBuilder();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', window.ffFloorFlowEnsureBuilder, { once: true });
} else {
  window.ffFloorFlowEnsureBuilder();
}
