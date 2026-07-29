/**
 * Chat — Compose module (Phase: chat split).
 * Verbatim move of the "Conversation View + Send/Reply/Confirm" block out of
 * chat.js: inline free-text sender, thread reply, mark-read, the New-Message
 * modal, the shared flow-wizard renderer, and the confirm-send pipeline.
 *
 * Imports presentation/data/subscription helpers from the existing chat-*
 * modules. Two chat.js-resident permission helpers are injected via
 * initChatCompose to avoid a circular import:
 *   _chatFreeTextAllowed, _getChatFreeTextTrimmed.
 * chat.js imports _sendFreeTextDirect + markThreadRead back (training reminder /
 * thread-open / subscriptions injection). The window.* handlers self-register.
 */
import { collection, doc, setDoc, updateDoc, writeBatch, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import { chatState } from "./chat-state.js?v=20260627_chat_state_split";
import { isMgrPlus, buildConvId, _trimStr, _memberDisplayNameFromRow, _otherUidFromParticipants } from "./chat-helpers.js?v=20260626_chat_helpers_split";
import { _chatEffectiveLocKey, loadChatUserProfile } from "./chat-data.js?v=20260628_chat_data_b0";
import { renderThreadList, renderConversation, _conversationById, _nameForUid, _nameForUidForSend, _staffDisplayNameForUid, _rememberConversationForList, _openChatModal, _chatRenderFlowWizard, _updateChatSendBtn, _buildFlowRenderedText } from "./chat-ui.js?v=20260728_reactions";
import { _unreadCountForUid, _computeChatNavUnreadFromSnapDocs, _paintChatNavBadge } from "./chat-subscriptions.js?v=20260628_chat_subs_split";

let _chatFreeTextAllowed, _getChatFreeTextTrimmed;
export function initChatCompose(deps) {
  _chatFreeTextAllowed = deps._chatFreeTextAllowed;
  _getChatFreeTextTrimmed = deps._getChatFreeTextTrimmed;
}

// ─── Conversation View (bubbles) ───────────────────────────────────────────────



/** Show inline free-text row only with permission and an open 1:1 thread. */


/**
 * Send one free-text chat message (title + message only). Used by inline composer and modal.
 * @param {string|null} conversationIdOverride - when set (reply), use this conv id instead of deriving from uids.
 */
async function _sendFreeTextDirect(recipientUid, recipientName, conversationIdOverride, bodyTrimmed) {
  if (!chatState.chatUserProfile?.salonId || !recipientUid) throw new Error('missing_context');
  const trimmed = String(bodyTrimmed || '').trim();
  if (!trimmed) throw new Error('empty_message');
  const maxFree = 8000;
  if (trimmed.length > maxFree) throw new Error('message_too_long');

  const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const title = (lines[0] || 'Message').slice(0, 120);
  const message = trimmed;

  const salonId = chatState.chatUserProfile.salonId;
  const senderUid = chatState.chatUserProfile.uid;
  const senderName =
    _trimStr(chatState.chatUserProfile.displayName) ||
    _trimStr(chatState.chatUserProfile.name) ||
    (auth.currentUser && (_trimStr(auth.currentUser.displayName) || _trimStr(auth.currentUser.email))) ||
    '';
  const senderRole = chatState.chatUserProfile.role || '';
  const rUid = recipientUid;
  const rName = recipientName || _nameForUidForSend(rUid);
  const locKey = _chatEffectiveLocKey();
  const convId = conversationIdOverride || buildConvId(senderUid, rUid, locKey);

  const convRef = doc(db, `salons/${salonId}/conversations`, convId);
  await setDoc(
    convRef,
    { participants: [senderUid, rUid].sort(), createdAt: serverTimestamp(), locationId: locKey },
    { merge: true }
  );

  const msgRef = doc(collection(db, `salons/${salonId}/conversations/${convId}/messages`));
  const batch = writeBatch(db);
  const msgData = {
    senderUid,
    senderName,
    senderRole,
    recipientUid: rUid,
    recipientName: rName,
    sentAt: serverTimestamp(),
    readBy: [senderUid],
    title,
    message
  };
  batch.set(msgRef, msgData);
  batch.set(
    convRef,
    {
      lastMessageAt: serverTimestamp(),
      lastMessageAtMs: Date.now(),
      lastTitle: title,
      lastMessage: message,
      lastSenderUid: senderUid,
      lastSenderName: senderName,
      lastSenderRole: senderRole,
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now(),
      unreadFor: { [rUid]: increment(1) }
    },
    { merge: true }
  );
  await batch.commit();
  return convId;
}

window.sendChatConvFreeText = async function() {
  if (!_chatFreeTextAllowed() || !chatState.chatUserProfile) return;
  const ta = document.getElementById('chatConvFreeTextInput');
  const body = String(ta?.value || '').trim();
  if (!body) {
    alert('Please type a message.');
    return;
  }
  if (!chatState.currentConvId) {
    alert('Select a conversation first.');
    return;
  }
  const replyBtn = document.getElementById('chatConvReplyBtn');
  const otherUid = replyBtn?.getAttribute('data-other-uid') || '';
  if (!otherUid) {
    alert('Select a conversation first.');
    return;
  }
  const otherName = replyBtn?.getAttribute('data-other-name') || _nameForUidForSend(otherUid);
  const sendBtn = document.getElementById('chatConvFreeTextSendBtn');
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';
  }
  try {
    await _sendFreeTextDirect(otherUid, otherName, chatState.currentConvId, body);
    if (ta) ta.value = '';
    renderConversation(chatState.currentConvId);
  } catch (e) {
    if (e && e.message === 'message_too_long') {
      alert('Message is too long (max 8000 characters).');
    } else {
      console.error('[Chat] inline free-text send', e);
      alert('Failed to send: ' + (e?.code || e?.message || 'unknown'));
    }
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send';
    }
  }
};

// ─── Reply from inside thread ──────────────────────────────────────────────────
window.openThreadReply = async function() {
  if (chatState._chatSendModalOpening) return;
  const btn = document.getElementById('chatConvReplyBtn');
  let otherUid = btn?.getAttribute('data-other-uid') || '';
  const convId = btn?.getAttribute('data-conv-id') || chatState.currentConvId;
  if (!otherUid && convId && chatState.chatUserProfile?.uid) {
    const conv = _conversationById(convId);
    otherUid = _otherUidFromParticipants(conv?.participants, chatState.chatUserProfile.uid) || '';
  }
  if (btn) {
    btn.disabled = true;
    btn.dataset.ffOriginalText = btn.dataset.ffOriginalText || btn.textContent || 'Reply';
    btn.textContent = 'Loading...';
  }
  chatState._chatSendModalOpening = true;
  try {
    if (!chatState.chatUserProfile) {
      await loadChatUserProfile();
    }
    if (!otherUid && convId && chatState.chatUserProfile?.uid) {
      const conv = _conversationById(convId);
      otherUid = _otherUidFromParticipants(conv?.participants, chatState.chatUserProfile.uid) || '';
    }
    if (!otherUid || !chatState.chatUserProfile) {
      console.warn('[Chat] openThreadReply: missing profile or recipient after load', { otherUid, convId });
      return;
    }
    const resolvedOtherName = btn?.getAttribute('data-other-name') || _nameForUidForSend(otherUid);
    chatState.chatReplyContext = { uid: otherUid, name: resolvedOtherName, conversationId: convId };
    await _openChatModal({
      title: `↩ Reply to ${_nameForUid(otherUid) || 'Someone'}`,
      showSendTo: false
    });
  } finally {
    chatState._chatSendModalOpening = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset.ffOriginalText || 'Reply';
    }
  }
};

// ─── Mark Thread Read ──────────────────────────────────────────────────────────
async function markThreadRead(convId) {
  if (!chatState.chatUserProfile?.salonId || !chatState.chatUserProfile?.uid || !convId) return;
  const conv = chatState.cachedConversationsById[convId] || chatState.allConversations.find(c => c.id === convId) || null;
  if (conv && Array.isArray(conv.participants) && !conv.participants.includes(chatState.chatUserProfile.uid)) return;
  const currentUnread = _unreadCountForUid(conv || {}, chatState.chatUserProfile.uid);
  if (currentUnread <= 0) return;
  try {
    await updateDoc(doc(db, `salons/${chatState.chatUserProfile.salonId}/conversations`, convId), {
      [`unreadFor.${chatState.chatUserProfile.uid}`]: 0
    });
    if (conv) {
      conv.unreadFor = { ...(conv.unreadFor || {}), [chatState.chatUserProfile.uid]: 0 };
      _paintChatNavBadge(_computeChatNavUnreadFromSnapDocs(chatState.allConversations.map(c => ({ data: () => c })), chatState.chatUserProfile.uid));
    }
  } catch (err) {
    console.warn('[Chat] markThreadRead failed', err);
  }
}

// ─── Send Modal (new message from main screen) ────────────────────────────────
window.openSendMessageModal = async function() {
  if (chatState._chatSendModalOpening) return;
  chatState._chatSendModalOpening = true;
  const btn = document.getElementById('chatSendBtn');
  const originalBtnHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Loading...';
  }
  try {
    chatState.chatReplyContext = null;
    // Make sure profile is ready — the Chat top bar is rendered as soon as the
    // screen becomes visible, which means the New Message button can be clicked
    // before initChatScreen() finishes. _openChatModal silently returns when
    // chatUserProfile is null, which looks like "button does nothing".
    if (!chatState.chatUserProfile) {
      await loadChatUserProfile();
    }
    if (!chatState.chatUserProfile) {
      console.warn('[Chat] openSendMessageModal: no chatUserProfile after load; aborting.');
      if (typeof window.ffStyledAlert === 'function') {
        window.ffStyledAlert('Unable to open New Message — please refresh and try again.');
      }
      return;
    }
    await _openChatModal({ title: 'New Message', showSendTo: true });
  } catch (e) {
    console.error('[Chat] openSendMessageModal error', e);
  } finally {
    chatState._chatSendModalOpening = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalBtnHtml || 'New Message';
    }
  }
};

// ─── Shared Modal Renderer ─────────────────────────────────────────────────────

// Legacy: mode buttons removed; selection is via unified chatMessageRadio list
window._chatSendMode = function(mode) {
  chatState.chatSendMode = mode;
  chatState.chatSelectedFlow = null;
  chatState.chatFlowAnswers = [];
  document.querySelectorAll('.chat-flow-accordion').forEach(acc => { acc.style.display = 'none'; acc.innerHTML = ''; });
  document.querySelectorAll('.chat-option-caret').forEach(c => { c.textContent = '▼'; });
  _updateChatSendBtn();
};



window._chatFlowBack = function() { chatState.chatFlowAnswers.pop(); _chatRenderFlowWizard(); _updateChatSendBtn(); };
window._chatFlowResetWizard = function() {
  chatState.chatFlowAnswers = [];
  _chatRenderFlowWizard();
  _updateChatSendBtn();
};


window._chatToggleAllRecipients = function(checked) {
  document.querySelectorAll('input[name="chatRecipient"]').forEach(cb => { cb.checked = checked; });
  _updateChatSendBtn();
};


window.closeSendMessageModal = function() {
  const modal = document.getElementById('chatSendModal');
  if (modal) modal.style.display = 'none';
  const panel = document.getElementById('chatRecipientPanel');
  if (panel) panel.style.display = 'none';
  const freeIn = document.getElementById('chatSendFreeTextInput');
  if (freeIn) freeIn.value = '';
  chatState.chatReplyContext = null;
};


// ─── Confirm Send ──────────────────────────────────────────────────────────────
window.confirmSendChatMessage = async function() {
  if (!chatState.chatUserProfile) return;
  let title, message, templateId = null, flowId = null, flowTitle = null, flowAnswers = null, renderedText = null;

  const freeAllowed = _chatFreeTextAllowed();
  const freeRaw = freeAllowed ? _getChatFreeTextTrimmed() : '';
  if (freeRaw) {
    const maxFree = 8000;
    if (freeRaw.length > maxFree) {
      alert(`Message is too long (max ${maxFree} characters).`);
      return;
    }
    const lines = freeRaw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    title = (lines[0] || 'Message').slice(0, 120);
    message = freeRaw;
  } else if (chatState.chatSendMode === 'flow' && chatState.chatSelectedFlow && chatState.chatFlowAnswers?.length) {
    const flow = chatState.chatSelectedFlow;
    const steps = flow.steps || [];
    const findStep = id => steps.find(s => String(s.id) === String(id));
    const findOpt = (step, id) => step?.options?.find(o => String(o.id) === String(id));
    let stepId = flow.startStepId || steps[0]?.id;
    for (const a of chatState.chatFlowAnswers) {
      const step = findStep(a.stepId);
      const opt = findOpt(step, a.optionId) || (step?.options && a.label ? step.options.find(o => String(o.label || '').trim() === String(a.label || '').trim()) : null);
      if (opt?.finish) { stepId = null; break; }
      stepId = opt?.nextStepId ?? null;
    }
    if (stepId) { alert('Please complete the flow.'); return; }
    title = flow.title;
    renderedText = _buildFlowRenderedText(flow, chatState.chatFlowAnswers);
    flowId = flow.id;
    flowTitle = flow.title;
    flowAnswers = chatState.chatFlowAnswers;
    message = renderedText;
  } else {
    const radio = document.querySelector('input[name="chatMessageRadio"]:checked');
    if (!radio) { alert('Please select a message.'); return; }
    const val = String(radio.value || '');
    const templateIdRaw = val.startsWith('template:') ? val.slice(9) : val;
    const template = chatState.chatTemplates.find(t => t.id === templateIdRaw);
    if (!template) return;
    title = template.title; message = template.message || ''; templateId = template.id;
  }

  let recipientUids = [], recipientNames = [];

  if (chatState.chatReplyContext) {
    recipientUids  = [chatState.chatReplyContext.uid];
    recipientNames = [chatState.chatReplyContext.name];
    if (!recipientUids[0] || recipientUids.length !== 1) {
      console.warn('[Chat] blocked invalid reply recipient set', { recipientUids, chatReplyContext: chatState.chatReplyContext });
      return;
    }
  } else {
    const allChecked = document.getElementById('chatRecipientAll')?.checked;
    if (allChecked) {
      const pool = isMgrPlus(chatState.chatUserProfile.role)
        ? chatState.chatSalonUsers
        : chatState.chatSalonUsers.filter(u => isMgrPlus(u.role));
      recipientUids  = pool.map(u => u.uid);
      recipientNames = pool.map(
        u =>
          _memberDisplayNameFromRow(u) ||
          _staffDisplayNameForUid(u.uid) ||
          _trimStr(u.email) ||
          'Someone'
      );
    } else {
      document.querySelectorAll('input[name="chatRecipient"]:checked').forEach(cb => {
        recipientUids.push(cb.value);
        recipientNames.push(cb.getAttribute('data-name') || _nameForUidForSend(cb.value));
      });
    }
    if (!recipientUids.length) {
      const msg = 'Please select at least one recipient.';
      if (typeof window.ffStyledAlert === 'function') {
        await window.ffStyledAlert(msg, 'Choose recipient');
      } else {
        alert(msg);
      }
      return;
    }
  }

  const btn = document.getElementById('chatSendConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  let firstSentConvId = null;

  try {
    if (freeRaw) {
      const convOverride = chatState.chatReplyContext?.conversationId || null;
      for (let i = 0; i < recipientUids.length; i++) {
        const rUid = recipientUids[i];
        const rName = recipientNames[i] || _nameForUidForSend(rUid);
        const sentConvId = await _sendFreeTextDirect(rUid, rName, convOverride, freeRaw);
        if (!firstSentConvId) firstSentConvId = sentConvId;
      }
    } else {
      const salonId = chatState.chatUserProfile.salonId;
      const senderUid = chatState.chatUserProfile.uid;
      const senderName =
        _trimStr(chatState.chatUserProfile.displayName) ||
        _trimStr(chatState.chatUserProfile.name) ||
        (auth.currentUser && (_trimStr(auth.currentUser.displayName) || _trimStr(auth.currentUser.email))) ||
        '';
      const senderRole = chatState.chatUserProfile.role || '';
      const locKey = _chatEffectiveLocKey();

      for (let i = 0; i < recipientUids.length; i++) {
        const rUid = recipientUids[i];
        const rName = recipientNames[i] || _nameForUidForSend(rUid);
        const convId = chatState.chatReplyContext?.conversationId || buildConvId(senderUid, rUid, locKey);
        if (!firstSentConvId) firstSentConvId = convId;
        console.log('[Chat] send → locKey=', locKey, ' convId=', convId);

        const convRef = doc(db, `salons/${salonId}/conversations`, convId);
        await setDoc(
          convRef,
          { participants: [senderUid, rUid].sort(), createdAt: serverTimestamp(), locationId: locKey },
          { merge: true }
        );

        const msgRef = doc(collection(db, `salons/${salonId}/conversations/${convId}/messages`));
        const batch = writeBatch(db);

        const msgData = {
          senderUid,
          senderName,
          senderRole,
          recipientUid: rUid,
          recipientName: rName,
          sentAt: serverTimestamp(),
          readBy: [senderUid]
        };
        if (flowId) {
          msgData.flowId = flowId;
          msgData.flowTitle = flowTitle;
          msgData.renderedText = renderedText;
          msgData.flowAnswers = flowAnswers;
          msgData.title = title;
          msgData.message = renderedText;
        } else {
          msgData.templateId = templateId;
          msgData.title = title;
          msgData.message = message;
        }
        batch.set(msgRef, msgData);

        batch.set(
          convRef,
          {
            lastMessageAt: serverTimestamp(),
            lastMessageAtMs: Date.now(),
            lastTitle: title,
            lastMessage: message || renderedText,
            lastSenderUid: senderUid,
            lastSenderName: senderName,
            lastSenderRole: senderRole,
            updatedAt: serverTimestamp(),
            updatedAtMs: Date.now(),
            unreadFor: { [rUid]: increment(1) }
          },
          { merge: true }
        );

        await batch.commit();
      }
    }

    const replyConvId = chatState.chatReplyContext?.conversationId || null;
    window.closeSendMessageModal();
    if (replyConvId && chatState.currentConvId === replyConvId) {
      renderConversation(replyConvId);
    } else if (firstSentConvId && recipientUids.length === 1) {
      _rememberConversationForList({
        id: firstSentConvId,
        participants: [chatState.chatUserProfile.uid, recipientUids[0]].sort(),
        locationId: _chatEffectiveLocKey(),
        lastTitle: title,
        lastMessage: message || renderedText || freeRaw || '',
        lastSenderUid: chatState.chatUserProfile.uid,
        lastSenderName:
          _trimStr(chatState.chatUserProfile.displayName) ||
          _trimStr(chatState.chatUserProfile.name) ||
          (auth.currentUser && (_trimStr(auth.currentUser.displayName) || _trimStr(auth.currentUser.email))) ||
          '',
        lastSenderRole: chatState.chatUserProfile.role || '',
        lastMessageAtMs: Date.now(),
        updatedAtMs: Date.now()
      });
      renderThreadList();
      window._openThread(firstSentConvId);
    }
  } catch(e) {
    console.error('[Chat] send error', e);
    alert('Failed to send: ' + (e?.code || e?.message || 'unknown'));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
  }
};




export { _sendFreeTextDirect, markThreadRead };
