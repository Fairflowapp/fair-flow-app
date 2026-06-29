/**
 * Chat UI Module — presentation helpers + small renderers (extracted from chat.js, U1)
 * Pure view layer: name/display helpers, thread-card HTML, header gear, flow text.
 * No Firestore access here; reads chatState + helpers only.
 */
import {
  isMgrPlus,
  escHtml,
  roleLabel,
  linkifyMessageHtml,
  _chatSortByOrder,
  _chatGroupByCategory,
  _chatUserMatchesAllowedSenders,
  timeAgo,
  _otherUidFromParticipants,
  _trimStr,
  _memberDisplayNameFromRow,
  _chatDayKey,
  _chatDaySeparatorLabel,
} from "./chat-helpers.js?v=20260626_chat_helpers_split";
import { chatState } from "./chat-state.js?v=20260627_chat_state_split";
import {
  _readActiveLocationId,
  _chatEffectiveLocKey,
  _convMatchesLocation,
  _cacheConversations,
  loadChatTemplates,
  loadChatFlows,
  loadChatSalonUsers,
} from "./chat-data.js?v=20260628_chat_data_b0";

// Local copies of trivial predicates also used by chat.js (kept self-contained).
const CHAT_NAME_LOADING = 'Loading...';
const isAdmin   = r => ['admin','owner'].includes((r||'').toLowerCase());

// Injected from chat.js (orchestrator owns permission logic).
let _chatFreeTextAllowed = () => false;
let _getChatFreeTextTrimmed = () => '';
export function initChatUi(deps) {
  if (deps && typeof deps._chatFreeTextAllowed === 'function') _chatFreeTextAllowed = deps._chatFreeTextAllowed;
  if (deps && typeof deps._getChatFreeTextTrimmed === 'function') _getChatFreeTextTrimmed = deps._getChatFreeTextTrimmed;
}

function ffBuildChatThreadCardHTML(conv, opts) {
  opts = opts || {};
  const forLive = !!opts.forLive;
  const uid = (opts.uid != null && opts.uid !== '') ? opts.uid : (chatState.chatUserProfile?.uid || '');
  const convId = conv.id;
  const otherUid = _otherUidFromParticipants(conv.participants, uid);
  const otherName = _nameForUid(otherUid) || 'Unknown';
  const unread = (conv.unreadFor && conv.unreadFor[uid]) ? Number(conv.unreadFor[uid]) : 0;
  const myInitial = (_trimStr(chatState.chatUserProfile?.displayName) || _trimStr(chatState.chatUserProfile?.name) || '?').charAt(0).toUpperCase();
  const otherInitial = otherName.charAt(0).toUpperCase();
  const myAvatarUrl = _avatarUrlForUid(uid);
  const otherAvatarUrl = _avatarUrlForUid(otherUid);
  const myAvatarHtml = myAvatarUrl
    ? `<span class="ctc-avatar ctc-avatar-me" style="overflow:hidden;"><img src="${String(myAvatarUrl).replace(/"/g, '&quot;')}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;"></span>`
    : `<span class="ctc-avatar ctc-avatar-me">${escHtml(myInitial)}</span>`;
  const otherAvatarHtml = otherAvatarUrl
    ? `<span class="ctc-avatar ctc-avatar-other" style="overflow:hidden;"><img src="${String(otherAvatarUrl).replace(/"/g, '&quot;')}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;"></span>`
    : `<span class="ctc-avatar ctc-avatar-other">${escHtml(otherInitial)}</span>`;
  const selected = (!forLive && typeof chatState.currentConvId !== 'undefined' && chatState.currentConvId === convId) ? 'is-selected' : '';
  const onclickAttr = forLive ? '' : ` onclick="window._openThread('${escHtml(convId)}', this)"`;
  return `
      <div class="chat-thread-card ${selected} ${unread > 0 ? 'chat-thread-card-unread' : ''}"
           data-conv-id="${escHtml(convId)}"
           data-other-uid="${escHtml(otherUid)}"
           data-other-name="${escHtml(otherName)}"${onclickAttr}>
        <div class="ctc-avatars">
          ${myAvatarHtml}
          ${otherAvatarHtml}
        </div>
        <div class="ctc-body">
          <div class="ctc-top">
            <span class="ctc-name">${escHtml(otherName)}</span>
            <span class="ctc-time">${timeAgo(conv?.lastMessageAt)}</span>
          </div>
          <div class="ctc-preview">
            ${conv?.lastSenderUid === uid ? '<span class="ctc-you">You: </span>' : ''}
            ${escHtml(conv?.lastTitle || conv?.lastMessage || '')}
          </div>
        </div>
        ${unread > 0 ? `<span class="ctc-badge">${unread}</span>` : ''}
      </div>
    `;
}

function _userAllowedInActiveLocation(u) {
  if (!u) return false;
  const activeLoc = _readActiveLocationId();
  if (!activeLoc) return true;
  const roleLc = String(u.role || '').toLowerCase().trim();
  if (roleLc === 'owner' || roleLc === 'admin' || roleLc === 'manager') return true;

  // Cross-reference the staff store for primaryLocationId / allowedLocationIds.
  let staffRow = null;
  try {
    const store = typeof window.ffGetStaffStore === 'function' ? window.ffGetStaffStore() : null;
    const staff = store && Array.isArray(store.staff) ? store.staff : [];
    staffRow = staff.find(
      s =>
        s &&
        (String(s.uid || '').trim() === u.uid ||
          String(s.firebaseUid || '').trim() === u.uid)
    ) || null;
  } catch (_) {}

  if (staffRow) {
    if (staffRow.isAdmin === true || staffRow.isManager === true) return true;
    const sRole = String(staffRow.role || '').toLowerCase().trim();
    if (sRole === 'owner' || sRole === 'admin' || sRole === 'manager') return true;
    if (Array.isArray(staffRow.allowedLocationIds) && staffRow.allowedLocationIds.length) {
      return staffRow.allowedLocationIds.indexOf(activeLoc) !== -1;
    }
    if (typeof staffRow.primaryLocationId === 'string' && staffRow.primaryLocationId.trim()) {
      return staffRow.primaryLocationId.trim() === activeLoc;
    }
    return false;
  }

  // Fallback: member row itself.
  if (Array.isArray(u.allowedLocationIds) && u.allowedLocationIds.length) {
    return u.allowedLocationIds.indexOf(activeLoc) !== -1;
  }
  if (typeof u.primaryLocationId === 'string' && u.primaryLocationId.trim()) {
    return u.primaryLocationId.trim() === activeLoc;
  }
  // No staff row AND no location hints on the member — treat as unscoped and
  // allow (prevents hiding the salon owner who may not be in the staff store).
  return true;
}

function _staffDisplayNameForUid(uid) {
  if (!uid) return '';
  try {
    const store = typeof window.ffGetStaffStore === 'function' ? window.ffGetStaffStore() : null;
    const staff = store && Array.isArray(store.staff) ? store.staff : [];
    const row = staff.find(
      s =>
        s &&
        (String(s.uid || '').trim() === uid ||
          String(s.firebaseUid || '').trim() === uid)
    );
    if (!row) return '';
    return _trimStr(row.displayName) || _trimStr(row.name);
  } catch (e) {
    return '';
  }
}

function _nameForUid(uid) {
  if (!uid) return '';
  if (uid === chatState.chatUserProfile?.uid) {
    const p = chatState.chatUserProfile;
    const dn = _trimStr(p?.displayName);
    if (dn) return dn;
    const nm = _trimStr(p?.name);
    if (nm) return nm;
    return _trimStr(p?.email);
  }
  const u = chatState.chatSalonUsers.find(x => x.uid === uid);
  if (u) {
    const nm = _memberDisplayNameFromRow(u);
    if (nm) return nm;
    const staffNm = _staffDisplayNameForUid(uid);
    if (staffNm) return staffNm;
    const em = _trimStr(u.email);
    if (em) return em;
  } else if (!chatState._chatMembersLoaded) {
    return CHAT_NAME_LOADING;
  }
  const staffOnly = _staffDisplayNameForUid(uid);
  if (staffOnly) return staffOnly;
  return 'Unknown';
}

function _nameForUidForSend(uid) {
  const n = _nameForUid(uid);
  if (n && n !== CHAT_NAME_LOADING) return n;
  const staffNm = _staffDisplayNameForUid(uid);
  if (staffNm) return staffNm;
  const u = chatState.chatSalonUsers.find(x => x.uid === uid);
  if (u) {
    const em = _trimStr(u.email);
    if (em) return em;
  }
  return 'Someone';
}

function _avatarUrlForUid(uid) {
  if (!uid) return null;
  if (uid === chatState.chatUserProfile?.uid) return (typeof window.ffGetCurrentUserAvatarUrl === 'function') ? window.ffGetCurrentUserAvatarUrl() : null;
  const u = chatState.chatSalonUsers.find(x => x.uid === uid);
  if (!u || !u.avatarUrl) return null;
  const v = u.avatarUpdatedAtMs != null ? String(u.avatarUpdatedAtMs) : '';
  const sep = u.avatarUrl.includes('?') ? '&' : '?';
  return `${u.avatarUrl}${sep}v=${encodeURIComponent(v)}`;
}

function _conversationById(convId) {
  const id = String(convId || '');
  if (!id) return null;
  return (
    (Array.isArray(chatState.allConversations) && chatState.allConversations.find(c => c && c.id === id)) ||
    (Array.isArray(chatState.lastRenderedConversations) && chatState.lastRenderedConversations.find(c => c && c.id === id)) ||
    (Array.isArray(chatState.lastNonEmptyConversations) && chatState.lastNonEmptyConversations.find(c => c && c.id === id)) ||
    chatState.cachedConversationsById[id] ||
    null
  );
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  if (typeof window !== 'undefined' && typeof window.ffFormatDisplayTime === 'function') {
    return window.ffFormatDisplayTime(d, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function renderChatHeaderForRole(role) {
  const gear = document.getElementById('chatSettingsGearBtn');
  if (!gear) return;
  const showGear =
    typeof window.ffCurrentUserHasChatManagePermission === 'function'
      ? window.ffCurrentUserHasChatManagePermission()
      : isAdmin(role) || (role == null && window.ff_is_admin_cached === true);
  gear.style.display = showGear ? 'flex' : 'none';
}

function _buildFlowRenderedText(flow, answers) {
  if (!answers?.length) return '';
  const lines = answers.map(a => {
    const q = (a.prompt || '').trim();
    const a2 = (a.label || '').trim();
    return q ? `${q}: ${a2}` : a2;
  }).filter(Boolean);
  return lines.join('\n');
}

function renderThreadList() {
  // Keep the Live Desk chat card in sync in real time (it reads from ffGetRecentConversations).
  if (typeof window.ffLiveRefreshChatCard === 'function') {
    try { window.ffLiveRefreshChatCard(); } catch (_eLive) {}
  }
  const loading = document.getElementById('chatFeedLoading');
  const empty   = document.getElementById('chatFeedEmpty');
  const list    = document.getElementById('chatFeedList');
  if (!list) return;
  if (loading) loading.style.display = 'none';

  const uid = chatState.chatUserProfile?.uid || '';
  const locKey = _chatEffectiveLocKey();
  const lastNonEmptyForLoc = Array.isArray(chatState.lastNonEmptyConversations)
    ? chatState.lastNonEmptyConversations.filter(c => _convMatchesLocation(c, locKey))
    : [];
  const lastRenderedForLoc = Array.isArray(chatState.lastRenderedConversations)
    ? chatState.lastRenderedConversations.filter(c => _convMatchesLocation(c, locKey))
    : [];
  const conversationsToRender = (Array.isArray(chatState.allConversations) && chatState.allConversations.length > 0)
    ? chatState.allConversations
    : lastNonEmptyForLoc.length > 0
      ? lastNonEmptyForLoc
      : lastRenderedForLoc.length > 0
        ? lastRenderedForLoc
        : (Array.isArray(chatState.lastNonEmptyConversations) && chatState.lastNonEmptyConversations.length > 0)
          ? chatState.lastNonEmptyConversations
          : (Array.isArray(chatState.lastRenderedConversations) && chatState.lastRenderedConversations.length > 0)
            ? chatState.lastRenderedConversations
            : [];

  if (conversationsToRender.length === 0) {
    if (chatState.lastRenderedThreadListHtml) {
      if (empty) empty.style.display = 'none';
      list.innerHTML = chatState.lastRenderedThreadListHtml;
    } else {
      if (empty) empty.style.display = 'block';
      list.innerHTML = '';
    }
    return;
  }
  if (empty) empty.style.display = 'none';
  chatState.lastRenderedConversations = conversationsToRender.slice();
  _cacheConversations(conversationsToRender);

  const nextHtml = conversationsToRender.map(conv => ffBuildChatThreadCardHTML(conv, { uid })).join('');
  chatState.lastRenderedThreadListHtml = nextHtml;
  list.innerHTML = nextHtml;
}

function _rememberConversationForList(conv) {
  if (!conv || !conv.id) return;
  const mergeInto = (list) => {
    if (!Array.isArray(list)) return [conv];
    const idx = list.findIndex(c => c && c.id === conv.id);
    if (idx >= 0) {
      const next = list.slice();
      next[idx] = { ...next[idx], ...conv };
      return next;
    }
    return [conv, ...list];
  };
  chatState.allConversations = mergeInto(chatState.allConversations);
  chatState.lastNonEmptyConversations = mergeInto(chatState.lastNonEmptyConversations);
  chatState.lastRenderedConversations = mergeInto(chatState.lastRenderedConversations);
}

function _cacheVisibleThreadListHtml() {
  try {
    const list = document.getElementById('chatFeedList');
    const html = list && typeof list.innerHTML === 'string' ? list.innerHTML.trim() : '';
    if (html) chatState.lastRenderedThreadListHtml = list.innerHTML;
  } catch (_) {}
}

function _restoreVisibleThreadListHtml() {
  try {
    const list = document.getElementById('chatFeedList');
    if (!list || !chatState.lastRenderedThreadListHtml) return false;
    const empty = document.getElementById('chatFeedEmpty');
    if (empty) empty.style.display = 'none';
    list.innerHTML = chatState.lastRenderedThreadListHtml;
    return true;
  } catch (_) {
    return false;
  }
}

function renderConversation(convId) {
  _setConversationHeader(convId);
  const msgs = Array.isArray(chatState.currentMessages) ? chatState.currentMessages.slice() : [];

  const uid      = chatState.chatUserProfile?.uid || '';
  const container= document.getElementById('chatConvMessages');
  if (!container) return;

  if (!convId) {
    _renderEmptyConversation();
    return;
  }

  const conv = _conversationById(convId);
  const otherUid = _otherUidFromParticipants(conv?.participants, uid) || (chatState.currentThreadFallback?.convId === convId ? chatState.currentThreadFallback.otherUid : '');
  const replyBtn = document.getElementById('chatConvReplyBtn');
  if (replyBtn) {
    replyBtn.setAttribute('data-other-uid', otherUid);
    replyBtn.setAttribute('data-other-name', _nameForUidForSend(otherUid));
    replyBtn.setAttribute('data-conv-id', convId);
  }

  if (msgs.length === 0) {
    container.innerHTML = chatState.chatMessagesLoading
      ? '<div style="text-align:center;padding:40px;color:#9ca3af;font-size:14px;">Loading messages...</div>'
      : '<div style="text-align:center;padding:40px;color:#9ca3af;font-size:14px;">No messages yet.</div>';
    _syncChatConvFreeTextComposer();
    return;
  }

  const otherAvatarUrl = _avatarUrlForUid(otherUid);

  let lastDayKey = '';
  const segments = [];
  for (let i = 0; i < msgs.length; i++) {
    const ev = msgs[i];
    const dk = _chatDayKey(ev.sentAt);
    if (dk && dk !== lastDayKey) {
      lastDayKey = dk;
      segments.push({ kind: 'day', ts: ev.sentAt });
    }
    segments.push({ kind: 'msg', ev });
  }

  container.innerHTML = segments.map(seg => {
    if (seg.kind === 'day') {
      const lab = _chatDaySeparatorLabel(seg.ts);
      if (!lab) return '';
      return `<div class="cb-day-sep" role="separator" aria-label="${escHtml(lab)}"><span>${escHtml(lab)}</span></div>`;
    }
    const ev = seg.ev;
    const mine = ev.senderUid === uid;
    const senderInitial = (ev.senderName || '?').charAt(0).toUpperCase();
    const otherAvatarHtml = !mine && otherAvatarUrl
      ? `<span class="cb-avatar" style="overflow:hidden;padding:0;"><img src="${String(otherAvatarUrl).replace(/"/g, '&quot;')}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;"></span>`
      : (!mine ? `<span class="cb-avatar">${escHtml(senderInitial)}</span>` : '');
    return `
      <div class="cb-row ${mine ? 'cb-row-mine' : 'cb-row-other'}">
        ${otherAvatarHtml}
        <div class="cb-col">
          ${!mine ? `<span class="cb-sender-name">${escHtml(ev.senderName||'Unknown')} · ${roleLabel(ev.senderRole)}</span>` : ''}
          <div class="cb-bubble ${mine ? 'cb-bubble-mine' : 'cb-bubble-other'}">
            <div class="cb-title">${escHtml(ev.title||'')}</div>
            ${ev.message ? `<div class="cb-body">${linkifyMessageHtml(ev.message)}</div>` : ''}
          </div>
          <span class="cb-time">${fmtTime(ev.sentAt)}</span>
        </div>
      </div>
    `;
  }).join('');

  // Scroll to bottom
  setTimeout(() => { container.scrollTop = container.scrollHeight; }, 50);

  _syncChatConvFreeTextComposer();
}

function _setConversationHeader(convId) {
  const title = document.getElementById('chatConvTitle');
  if (!title) return;
  if (!convId) {
    title.textContent = 'Select a conversation';
    return;
  }
  const uid  = chatState.chatUserProfile?.uid || '';
  const conv = _conversationById(convId);
  const fallbackName = chatState.currentThreadFallback?.convId === convId ? chatState.currentThreadFallback.otherName : '';
  const otherUid = _otherUidFromParticipants(conv?.participants, uid) || (chatState.currentThreadFallback?.convId === convId ? chatState.currentThreadFallback.otherUid : '');
  title.textContent = _nameForUid(otherUid) || fallbackName || 'Conversation';
}

function _renderEmptyConversation() {
  _setConversationHeader(null);
  const container = document.getElementById('chatConvMessages');
  if (!container) return;
  container.innerHTML = `
    <div style="text-align:center;padding:60px 20px;color:#9ca3af;">
      <div style="font-size:15px;font-weight:700;color:#6b7280;margin-bottom:6px;">Select a chat</div>
      <div style="font-size:13px;color:#9ca3af;">Choose a name from the left to view messages.</div>
    </div>
  `;
  _syncChatConvFreeTextComposer();
}

function _syncChatConvFreeTextComposer() {
  const bar = document.getElementById('chatConvFreeTextBar');
  if (!bar) return;
  const allowed = _chatFreeTextAllowed();
  const open = !!chatState.currentConvId;
  bar.style.display = allowed && open ? 'flex' : 'none';
  if (!allowed || !open) {
    const ta = document.getElementById('chatConvFreeTextInput');
    if (ta) ta.value = '';
  }
}

function _bindChatConvFreeTextComposer() {
  const ta = document.getElementById('chatConvFreeTextInput');
  if (!ta || ta.__ffChatConvFreeBound) return;
  ta.__ffChatConvFreeBound = true;
  ta.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (typeof window.sendChatConvFreeText === 'function') window.sendChatConvFreeText();
    }
  });
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
  ffBuildChatThreadCardHTML,
  _userAllowedInActiveLocation,
  _staffDisplayNameForUid,
  _nameForUid,
  _nameForUidForSend,
  _avatarUrlForUid,
  _conversationById,
  fmtTime,
  renderChatHeaderForRole,
  _buildFlowRenderedText,
  renderThreadList,
  _rememberConversationForList,
  _cacheVisibleThreadListHtml,
  _restoreVisibleThreadListHtml,
  renderConversation,
  _setConversationHeader,
  _renderEmptyConversation,
  _syncChatConvFreeTextComposer,
  _bindChatConvFreeTextComposer,
  _openChatModal,
  _chatGetFlowAccordion,
  _chatRenderFlowWizard,
  _updateChatSendBtn,
  _updateRecipientSummary,
};
