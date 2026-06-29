/**
 * Chat UI Module — presentation helpers + small renderers (extracted from chat.js, U1)
 * Pure view layer: name/display helpers, thread-card HTML, header gear, flow text.
 * No Firestore access here; reads chatState + helpers only.
 */
import {
  escHtml,
  roleLabel,
  linkifyMessageHtml,
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
} from "./chat-data.js?v=20260628_chat_data_b0";

// Local copies of trivial predicates also used by chat.js (kept self-contained).
const CHAT_NAME_LOADING = 'Loading...';
const isAdmin   = r => ['admin','owner'].includes((r||'').toLowerCase());

// Injected from chat.js (orchestrator owns permission logic).
let _chatFreeTextAllowed = () => false;
export function initChatUi(deps) {
  if (deps && typeof deps._chatFreeTextAllowed === 'function') _chatFreeTextAllowed = deps._chatFreeTextAllowed;
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
};
