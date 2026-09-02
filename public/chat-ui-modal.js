/**
 * Chat UI — Send-modal & flow-wizard half (split of chat-ui.js).
 * Verbatim move of _openChatModal + the flow-wizard renderer, send-button and
 * recipient-summary updaters out of chat-ui.js.
 *
 * Depends one-way on chat-ui.js display/name helpers, which are injected via
 * initChatUiModal (fanned out from chat-ui.js's initChatUi) to keep the two
 * halves free of a circular import. The two permission predicates
 * (_chatFreeTextAllowed / _getChatFreeTextTrimmed) are injected the same way.
 */
import { chatState } from "./chat-state.js?v=20260901_chat_iso";
import { _chatGroupByCategory, _chatSortByOrder, _chatUserMatchesAllowedSenders, _memberDisplayNameFromRow, _trimStr, escHtml, isMgrPlus, roleLabel } from "./chat-helpers.js?v=20260901_chat_iso";
import { loadChatFlows, loadChatSalonUsers, loadChatTemplates } from "./chat-data.js?v=20260901_chat_iso";

let _chatFreeTextAllowed = () => false;
let _getChatFreeTextTrimmed = () => '';
let _avatarUrlForUid, _buildFlowRenderedText, _nameForUidForSend, _staffDisplayNameForUid, _userAllowedInActiveLocation;
export function initChatUiModal(deps) {
  if (deps && typeof deps._chatFreeTextAllowed === 'function') _chatFreeTextAllowed = deps._chatFreeTextAllowed;
  if (deps && typeof deps._getChatFreeTextTrimmed === 'function') _getChatFreeTextTrimmed = deps._getChatFreeTextTrimmed;
  _avatarUrlForUid = deps._avatarUrlForUid;
  _buildFlowRenderedText = deps._buildFlowRenderedText;
  _nameForUidForSend = deps._nameForUidForSend;
  _staffDisplayNameForUid = deps._staffDisplayNameForUid;
  _userAllowedInActiveLocation = deps._userAllowedInActiveLocation;
}

async function _openChatModal({ title, showSendTo }) {
  if (!chatState.chatUserProfile) return;
  const modal         = document.getElementById('chatSendModal');
  const messageList   = document.getElementById('chatSendMessageList');
  const recipientList = document.getElementById('chatSendRecipientList');
  const sendToSection = document.getElementById('chatSendToSection');
  const pickerBtn     = document.getElementById('chatRecipientPickerBtn');
  const pickerLabel   = document.getElementById('chatRecipientPickerLabel');
  const panel         = document.getElementById('chatRecipientPanel');
  const searchInput   = document.getElementById('chatRecipientSearch');
  if (!modal || !messageList || !recipientList) return;

  modal.querySelector('.chat-modal-title').textContent = title;
  if (sendToSection) sendToSection.style.display = showSendTo ? 'block' : 'none';
  if (panel) panel.style.display = 'none';
  const allCb = document.getElementById('chatRecipientAll');
  if (allCb) allCb.checked = false;
  if (!showSendTo) {
    recipientList.innerHTML = '';
    if (pickerLabel) pickerLabel.textContent = '';
  }
  messageList.innerHTML =
    '<div style="padding:18px;color:#6b7280;text-align:center;font-size:14px;">Loading message options...</div>';
  if (showSendTo) {
    recipientList.innerHTML =
      '<div style="padding:10px;color:#6b7280;font-size:13px;">Loading recipients...</div>';
  }
  modal.style.display = 'flex';
  const initialSendBtn = document.getElementById('chatSendConfirmBtn');
  if (initialSendBtn) initialSendBtn.disabled = true;

  await Promise.all([loadChatTemplates(), loadChatFlows(), loadChatSalonUsers()]);

  chatState.chatSendMode = 'template';
  chatState.chatSelectedFlow = null;
  chatState.chatFlowAnswers = [];

  const sendableTemplates = chatState.chatTemplates.filter(t =>
    _chatUserMatchesAllowedSenders(chatState.chatUserProfile.role, t.allowedSenders)
  );
  const sendableFlows = chatState.chatFlows.filter(f =>
    _chatUserMatchesAllowedSenders(chatState.chatUserProfile.role, f.allowedSenders)
  );

  const items = [];
  sendableTemplates.forEach(t => items.push({ type: 'template', id: t.id, title: t.title, category: t.category || '', preview: t.message }));
  sendableFlows.forEach(f => items.push({
    type: 'flow',
    id: f.id,
    title: f.title,
    category: f.category || '',
    preview: f.steps?.[0]?.prompt || ''
  }));

  const freeAllowed = _chatFreeTextAllowed();
  if (freeAllowed && chatState.chatReplyContext && items.length === 0) {
    modal.style.display = 'none';
    document.getElementById('chatConvFreeTextInput')?.focus();
    return;
  }
  const hideModalFreeComposer = !!(freeAllowed && chatState.chatReplyContext);
  const pickLabel = document.getElementById('chatSendPickLabel');
  const freeSec = document.getElementById('chatSendFreeTextSection');
  const freeIn = document.getElementById('chatSendFreeTextInput');
  const freeLbl = document.getElementById('chatSendFreeTextLabel');
  if (freeSec && freeIn) {
    if (freeAllowed && !hideModalFreeComposer) {
      freeSec.style.display = 'block';
      freeIn.value = '';
      if (!freeIn.__ffChatFreeBound) {
        freeIn.__ffChatFreeBound = true;
        freeIn.addEventListener('input', () => {
          const v = String(freeIn.value || '').trim();
          if (v) {
            document.querySelectorAll('input[name="chatMessageRadio"]').forEach(r => {
              r.checked = false;
            });
            chatState.chatSendMode = 'template';
            chatState.chatSelectedFlow = null;
            chatState.chatFlowAnswers = [];
            document.querySelectorAll('.chat-message-option-block .chat-flow-accordion').forEach(acc => {
              acc.style.display = 'none';
              acc.innerHTML = '';
            });
            document.querySelectorAll('.chat-option-caret').forEach(c => {
              c.textContent = '▼';
            });
          }
          _updateChatSendBtn();
        });
      }
      if (pickLabel) {
        pickLabel.textContent = items.length ? 'Templates & guided flows' : 'Message';
        pickLabel.style.display = items.length ? 'block' : 'none';
      }
      if (freeLbl) freeLbl.textContent = items.length ? 'Or type your own message' : 'Write your message';
    } else if (freeAllowed && hideModalFreeComposer) {
      freeSec.style.display = 'none';
      freeIn.value = '';
      if (pickLabel) {
        pickLabel.style.display = 'block';
        pickLabel.textContent = items.length ? 'Templates & guided flows' : 'Choose message to send';
      }
      if (freeLbl) freeLbl.textContent = items.length ? 'Or type your own message' : 'Write your message';
    } else {
      freeSec.style.display = 'none';
      freeIn.value = '';
      if (pickLabel) {
        pickLabel.style.display = 'block';
        pickLabel.textContent = 'Choose message to send';
      }
    }
  }

  if (items.length === 0) {
    if (freeAllowed) {
      messageList.innerHTML =
        '<div style="padding:12px 4px;color:#6b7280;font-size:13px;line-height:1.5;text-align:left;">No templates or guided flows are set up for your role. Use the box below to write your own message.</div>';
    } else {
      messageList.innerHTML =
        '<div style="padding:16px;color:#6b7280;text-align:center;font-size:14px;">No messages available.<br>Ask an Admin to add templates, or ask the owner to turn on <b>Free-text chat messages</b> for your account.</div>';
    }
  } else {
    const groupedItems = _chatGroupByCategory(items);
    messageList.innerHTML = groupedItems.map(([categoryName, groupItems], categoryIdx) => {
      const categoryOpen = groupedItems.length === 1;
      return `
      <div class="chat-category-section" data-chat-send-category="${categoryIdx}" style="margin-bottom:10px;">
        <button type="button" onclick="window._chatToggleSendCategory && window._chatToggleSendCategory(${categoryIdx})"
          class="chat-category-section-title"
          style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;border:none;background:transparent;cursor:pointer;text-align:left;padding:4px 2px;">
          <span>${escHtml(categoryName)} <span style="color:#9ca3af;font-weight:700;">(${groupItems.length})</span></span>
          <span class="chat-send-category-arrow" style="font-size:10px;color:#9ca3af;">${categoryOpen ? '▲' : '▼'}</span>
        </button>
        <div class="chat-category-section-items" style="display:${categoryOpen ? 'flex' : 'none'};">
          ${groupItems.map(it => {
      const isFlow = it.type === 'flow';
      const caretHtml = isFlow
        ? `<span class="chat-option-caret" aria-hidden="true" style="flex-shrink:0;font-size:10px;color:#9ca3af;transition:transform 0.2s;">▼</span>`
        : '';
      return `
        <div class="chat-message-option-block" data-type="${it.type}" data-id="${escHtml(it.id)}" style="margin-bottom:4px;">
          <label class="chat-message-option" style="display:flex;align-items:flex-start;gap:8px;padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;cursor:pointer;background:#fff;">
            <input type="radio" name="chatMessageRadio" value="${it.type}:${escHtml(it.id)}" style="margin-top:1px;accent-color:#7c3aed;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;font-weight:600;color:#111827;">${escHtml(it.title)}</div>
              ${it.preview ? `<div style="font-size:11px;color:#6b7280;margin-top:0;">${escHtml(it.preview)}</div>` : ''}
            </div>
            ${caretHtml}
          </label>
          ${isFlow ? `<div class="chat-flow-accordion" data-flow-id="${escHtml(it.id)}" style="display:none;margin-top:4px;margin-left:0;padding:12px 14px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;"></div>` : ''}
        </div>
      `;
          }).join('')}
        </div>
      </div>
    `;
    }).join('');

    messageList.querySelectorAll('input[name="chatMessageRadio"]').forEach(r => {
      r.addEventListener('change', () => {
        const ft = document.getElementById('chatSendFreeTextInput');
        if (ft) ft.value = '';
        const v = r.value;
        const [type, id] = v.includes(':') ? v.split(/:(.+)/).slice(0, 2) : ['template', v];
        const block = r.closest('.chat-message-option-block');
        document.querySelectorAll('.chat-message-option-block').forEach(b => {
          const acc = b.querySelector('.chat-flow-accordion');
          const caret = b.querySelector('.chat-option-caret');
          if (acc) {
            acc.style.display = 'none';
            acc.innerHTML = '';
            if (caret) caret.textContent = '▼';
          }
        });
        if (type === 'flow') {
          chatState.chatSendMode = 'flow';
          chatState.chatSelectedFlow = chatState.chatFlows.find(x => x.id === id) || null;
          chatState.chatFlowAnswers = [];
          const acc = block?.querySelector('.chat-flow-accordion');
          const caret = block?.querySelector('.chat-option-caret');
          if (acc) {
            acc.style.display = 'block';
            if (caret) caret.textContent = '▲';
            _chatRenderFlowWizard(acc);
            setTimeout(() => acc.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
          }
        } else {
          chatState.chatSendMode = 'template';
          chatState.chatSelectedFlow = null;
          chatState.chatFlowAnswers = [];
        }
        _updateChatSendBtn();
      });
    });
  }

  // Recipients
  if (showSendTo) {
    const myRole = chatState.chatUserProfile && chatState.chatUserProfile.role;
    // Base pool: leaders see everyone, non-leaders only see leadership they can
    // message (existing rule). Then apply STRICT location filter so each branch
    // only sees the staff actually assigned to it (mirrors the staff list and
    // queue behavior elsewhere in the app).
    const basePool = isMgrPlus(myRole) ? chatState.chatSalonUsers : chatState.chatSalonUsers.filter(u => isMgrPlus(u.role));
    const pool = basePool.filter(_userAllowedInActiveLocation);
    // Reset UI
    if (searchInput) searchInput.value = '';
    if (panel) panel.style.display = 'none';
    const allCb = document.getElementById('chatRecipientAll');
    if (allCb) allCb.checked = false;

    recipientList.innerHTML = pool.length === 0
      ? '<div style="padding:10px;color:#6b7280;font-size:13px;">No recipients available.</div>'
      : pool.map(u => {
          const displayName =
            _memberDisplayNameFromRow(u) ||
            _staffDisplayNameForUid(u.uid) ||
            _trimStr(u.email) ||
            'Unknown';
          const search = `${displayName} ${u.email || ''} ${roleLabel(u.role)}`.toLowerCase();
          const avatarUrl = _avatarUrlForUid(u.uid);
          const avatarHtml = avatarUrl
            ? `<span class="chat-rcpt-avatar-sm" style="overflow:hidden;padding:0;"><img src="${String(avatarUrl).replace(/"/g, '&quot;')}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;"></span>`
            : `<span class="chat-rcpt-avatar-sm">${escHtml((displayName||'?').charAt(0).toUpperCase())}</span>`;
          return `
            <label class="chat-recipient-row" data-search="${escHtml(search)}"
              style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;cursor:pointer;font-size:13px;color:#374151;">
              <input type="checkbox" name="chatRecipient" value="${escHtml(u.uid)}" data-name="${escHtml(displayName)}" style="accent-color:#7c3aed;">
              ${avatarHtml}
              <span style="font-weight:600;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(displayName)}</span>
              <span style="color:#9ca3af;font-size:12px;flex-shrink:0;">${roleLabel(u.role)}</span>
            </label>
          `;
        }).join('');

    // Bind picker behavior (once)
    if (pickerBtn && panel && !pickerBtn.__ffBound) {
      pickerBtn.__ffBound = true;
      pickerBtn.onclick = function(e) {
        e.preventDefault();
        const open = panel.style.display !== 'block';
        panel.style.display = open ? 'block' : 'none';
        if (open) setTimeout(() => searchInput?.focus(), 0);
      };
      // Close when clicking outside the picker
      document.addEventListener('click', function(ev) {
        const isOpen = panel.style.display === 'block';
        if (!isOpen) return;
        if (panel.contains(ev.target) || pickerBtn.contains(ev.target)) return;
        panel.style.display = 'none';
      });
    }

    // Search filter
    if (searchInput && !searchInput.__ffBound) {
      searchInput.__ffBound = true;
      searchInput.addEventListener('input', function() {
        const q = (searchInput.value || '').trim().toLowerCase();
        document.querySelectorAll('#chatSendRecipientList .chat-recipient-row').forEach(row => {
          const s = (row.getAttribute('data-search') || '').toLowerCase();
          row.style.display = (!q || s.includes(q)) ? 'flex' : 'none';
        });
      });
    }

    // Summary label
    _updateRecipientSummary();
    if (pickerLabel) pickerLabel.textContent = pickerLabel.textContent || 'Select recipients…';
  }

  modal.style.display = 'flex';
  const sendBtn = document.getElementById('chatSendConfirmBtn');
  if (sendBtn) sendBtn.disabled = true;

  if (showSendTo) {
    modal.querySelectorAll('input[name="chatRecipient"]').forEach(r =>
      r.addEventListener('change', _updateChatSendBtn)
    );
    document.getElementById('chatRecipientAll')?.addEventListener('change', _updateChatSendBtn);
  }
}

function _chatGetFlowAccordion() {
  if (!chatState.chatSelectedFlow?.id) return null;
  const block = document.querySelector(`.chat-message-option-block[data-type="flow"][data-id="${chatState.chatSelectedFlow.id}"]`);
  return block?.querySelector('.chat-flow-accordion') || null;
}

function _chatRenderFlowWizard(container) {
  const wizard = container || _chatGetFlowAccordion();
  if (!wizard || !chatState.chatSelectedFlow) return;
  const flow = chatState.chatSelectedFlow;
  const steps = flow.steps || [];
  const startId = flow.startStepId || steps[0]?.id;
  if (!startId || !steps.length) {
    wizard.innerHTML = '<div style="padding:12px;color:#6b7280;font-size:13px;">This flow has no questions yet.</div>';
    return;
  }
  let stepId = startId;
  for (const a of chatState.chatFlowAnswers) {
    const step = steps.find(s => String(s.id) === String(a.stepId));
    const opt = step?.options?.find(o => String(o.id) === String(a.optionId));
    if (!opt) { stepId = null; break; }
    if (opt.finish) { stepId = null; break; }
    stepId = opt.nextStepId || null;
  }
  if (!stepId) {
    const rendered = _buildFlowRenderedText(flow, chatState.chatFlowAnswers);
    wizard.innerHTML = `
      <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">✓ Summary</div>
      <div style="font-size:14px;color:#6b7280;white-space:pre-wrap;">${escHtml(rendered)}</div>
      <button type="button" onclick="window._chatFlowResetWizard && window._chatFlowResetWizard()" style="margin-top:10px;padding:6px 12px;font-size:12px;color:#7c3aed;background:none;border:none;cursor:pointer;">Change answers</button>
    `;
    _updateChatSendBtn();
    return;
  }
  const step = steps.find(s => String(s.id) === String(stepId));
  if (!step || !step.options?.length) {
    wizard.innerHTML = `<div style="padding:12px;color:#6b7280;font-size:13px;">No options for this step.</div>
      <button type="button" onclick="window._chatFlowResetWizard && window._chatFlowResetWizard()" style="margin-top:8px;padding:6px 12px;font-size:12px;color:#7c3aed;background:none;border:none;cursor:pointer;">Start over</button>`;
    return;
  }
  const orderedOptions = _chatSortByOrder(step.options);
  wizard.innerHTML = `
    <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:10px;">${escHtml(step.prompt || 'Choose an option:')}</div>
    <div style="display:flex;flex-direction:column;gap:6px;" id="chatFlowStepOptions">
      ${orderedOptions.map(o => `
        <button type="button" class="chat-flow-opt-btn" data-step-id="${escHtml(step.id)}" data-opt-id="${escHtml(o.id)}" data-opt-label="${escHtml(o.label || '')}"
          style="padding:10px 14px;text-align:left;border:1px solid #e5e7eb;border-radius:8px;background:#fff;cursor:pointer;font-size:14px;color:#111827;">${escHtml(o.label || '(no label)')}</button>
      `).join('')}
    </div>
    ${chatState.chatFlowAnswers.length ? '<button type="button" class="chat-flow-back-btn" style="margin-top:10px;padding:6px 12px;font-size:12px;color:#6b7280;background:none;border:none;cursor:pointer;">← Back</button>' : ''}
  `;
  wizard.querySelectorAll('.chat-flow-opt-btn').forEach(btn => {
    btn.onclick = () => {
      chatState.chatFlowAnswers.push({
        stepId: btn.getAttribute('data-step-id'),
        prompt: step.prompt || '',
        optionId: btn.getAttribute('data-opt-id'),
        label: btn.getAttribute('data-opt-label') || btn.textContent.trim()
      });
      _chatRenderFlowWizard();
      _updateChatSendBtn();
      setTimeout(() => wizard.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
    };
  });
  const backBtn = wizard.querySelector('.chat-flow-back-btn');
  if (backBtn) backBtn.onclick = () => { window._chatFlowBack && window._chatFlowBack(); };
  _updateChatSendBtn();
}

function _updateChatSendBtn() {
  let ready = false;
  const freeRaw = _getChatFreeTextTrimmed();
  if (freeRaw) {
    ready = true;
  }
  const radio = document.querySelector('input[name="chatMessageRadio"]:checked');
  if (!ready && chatState.chatSendMode === 'flow') {
    if (chatState.chatSelectedFlow && chatState.chatFlowAnswers.length) {
      const flow = chatState.chatSelectedFlow;
      const steps = flow.steps || [];
      const findStep = id => steps.find(s => String(s.id) === String(id));
      const findOpt = (step, id) => step?.options?.find(o => String(o.id) === String(id));
      let stepId = flow.startStepId || steps[0]?.id;
      for (const a of chatState.chatFlowAnswers) {
        const step = findStep(a.stepId);
        const opt = findOpt(step, a.optionId) || (step?.options && a.label ? step.options.find(o => String(o.label || '').trim() === String(a.label || '').trim()) : null);
        if (!opt || opt.finish) { stepId = null; break; }
        stepId = opt.nextStepId ?? null;
      }
      ready = !stepId;
    }
  } else if (!ready) {
    ready = !!(radio && String(radio.value || '').startsWith('template:'));
  }
  let rcpt = true;
  if (!chatState.chatReplyContext) {
    rcpt = document.getElementById('chatRecipientAll')?.checked
        || !!document.querySelector('input[name="chatRecipient"]:checked');
  }
  const btn = document.getElementById('chatSendConfirmBtn');
  if (btn) {
    btn.disabled = !ready;
    btn.title = '';
  }
  _updateRecipientSummary();
}

function _updateRecipientSummary() {
  const label = document.getElementById('chatRecipientPickerLabel');
  if (!label) return;
  // Reply flow has no send-to
  if (chatState.chatReplyContext) return;

  const all = document.getElementById('chatRecipientAll')?.checked;
  if (all) {
    label.textContent = 'Everyone';
    return;
  }
  const checked = Array.from(document.querySelectorAll('input[name="chatRecipient"]:checked'));
  if (checked.length === 0) {
    label.textContent = 'Select recipients…';
    return;
  }
  const firstName = checked[0].getAttribute('data-name') || _nameForUidForSend(checked[0].value);
  label.textContent = checked.length === 1 ? firstName : `${firstName} +${checked.length - 1}`;
}

export {
  _openChatModal,
  _chatGetFlowAccordion,
  _chatRenderFlowWizard,
  _updateChatSendBtn,
  _updateRecipientSummary,
};
