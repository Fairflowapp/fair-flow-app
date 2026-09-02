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
  isChatGroup,
  chatGroupTitle,
  chatGroupPhotoUrl,
  _trimStr,
  _memberDisplayNameFromRow,
  _chatDayKey,
  _chatDaySeparatorLabel,
} from "./chat-helpers.js?v=20260901_chat_iso";
import { chatState } from "./chat-state.js?v=20260901_chat_iso";
import {
  _readActiveLocationId,
  _chatEffectiveLocKey,
  _convMatchesLocation,
  _cacheConversations,
  loadChatTemplates,
  loadChatFlows,
  loadChatSalonUsers,
} from "./chat-data.js?v=20260901_chat_iso";
import { initChatUiModal, _openChatModal, _chatGetFlowAccordion, _chatRenderFlowWizard, _updateChatSendBtn, _updateRecipientSummary } from "./chat-ui-modal.js?v=20260901_chat_iso";

// Local copies of trivial predicates also used by chat.js (kept self-contained).
const CHAT_NAME_LOADING = 'Loading...';
const isAdmin   = r => ['admin','owner'].includes((r||'').toLowerCase());

// Injected from chat.js (orchestrator owns permission logic).
let _chatFreeTextAllowed = () => false;
let _getChatFreeTextTrimmed = () => '';
export function initChatUi(deps) {
  if (deps && typeof deps._chatFreeTextAllowed === 'function') _chatFreeTextAllowed = deps._chatFreeTextAllowed;
  if (deps && typeof deps._getChatFreeTextTrimmed === 'function') _getChatFreeTextTrimmed = deps._getChatFreeTextTrimmed;
  // Fan-out: the send-modal / flow-wizard half (chat-ui-modal.js) needs the two
  // permission helpers plus the display/name helpers that live in this module.
  initChatUiModal({
    _chatFreeTextAllowed, _getChatFreeTextTrimmed,
    _avatarUrlForUid, _buildFlowRenderedText, _nameForUidForSend,
    _staffDisplayNameForUid, _userAllowedInActiveLocation,
  });
}

function _fixedAvatarImg(url, size) {
  const src = String(url || '').replace(/"/g, '&quot;');
  return `<img src="${src}" alt="" width="${size}" height="${size}" decoding="async">`;
}

function _threadCardPhotoUrl(conv, uid) {
  if (isChatGroup(conv)) return chatGroupPhotoUrl(conv);
  const otherUid = _otherUidFromParticipants(conv.participants, uid);
  return _avatarUrlForUid(otherUid) || '';
}

function _threadCardAvatarHtml(conv, uid, forLive) {
  const group = isChatGroup(conv);
  const name = group ? chatGroupTitle(conv) : (_nameForUid(_otherUidFromParticipants(conv.participants, uid)) || 'Unknown');
  const initial = (name.charAt(0) || '?').toUpperCase();
  const photoUrl = _threadCardPhotoUrl(conv, uid);
  const groupPickAttr = (!forLive && group)
    ? ` onclick="event.stopPropagation(); window.pickChatGroupPhoto && window.pickChatGroupPhoto('${escHtml(conv.id)}')"`
    : '';
  const extraClass = group ? ' ctc-avatar-group' : ' ctc-avatar-single';
  const title = group ? (photoUrl ? 'Change group photo' : 'Add group photo') : '';
  const titleAttr = title ? ` title="${escHtml(title)}"` : '';
  if (photoUrl) {
    return `<span class="ctc-avatar${extraClass}"${titleAttr}${groupPickAttr}>${_fixedAvatarImg(photoUrl, 40)}</span>`;
  }
  return `<span class="ctc-avatar${extraClass}"${titleAttr}${groupPickAttr}>${escHtml(initial)}</span>`;
}

function _applyThreadCardState(card, conv, uid) {
  if (!card || !conv) return;
  const unread = (conv.unreadFor && conv.unreadFor[uid]) ? Number(conv.unreadFor[uid]) : 0;
  const group = isChatGroup(conv);
  const otherUid = group ? '' : _otherUidFromParticipants(conv.participants, uid);
  const otherName = group ? chatGroupTitle(conv) : (_nameForUid(otherUid) || 'Unknown');
  card.classList.toggle('is-selected', chatState.currentConvId === conv.id);
  card.classList.toggle('chat-thread-card-unread', unread > 0);
  card.setAttribute('data-other-uid', otherUid);
  card.setAttribute('data-other-name', otherName);
  card.setAttribute('data-is-group', group ? '1' : '0');
  const nameEl = card.querySelector('.ctc-name');
  if (nameEl) nameEl.textContent = otherName;
  const timeEl = card.querySelector('.ctc-time');
  if (timeEl) timeEl.textContent = timeAgo(conv?.lastMessageAt);
  const previewEl = card.querySelector('.ctc-preview');
  if (previewEl) {
    const you = conv?.lastSenderUid === uid ? '<span class="ctc-you">You: </span>' : '';
    previewEl.innerHTML = `${you}${escHtml(conv?.lastTitle || conv?.lastMessage || '')}`;
  }
  let badge = card.querySelector('.ctc-badge');
  if (unread > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'ctc-badge';
      card.appendChild(badge);
    }
    badge.textContent = String(unread);
  } else if (badge) {
    badge.remove();
  }
  const wrap = card.querySelector('.ctc-avatars');
  const photoUrl = _threadCardPhotoUrl(conv, uid);
  const img = wrap && wrap.querySelector('img');
  if (img && photoUrl) {
    if (img.getAttribute('src') !== photoUrl) img.setAttribute('src', photoUrl);
  } else if (wrap) {
    wrap.innerHTML = _threadCardAvatarHtml(conv, uid, false);
  }
}

function ffBuildChatThreadCardHTML(conv, opts) {
  opts = opts || {};
  const forLive = !!opts.forLive;
  const uid = (opts.uid != null && opts.uid !== '') ? opts.uid : (chatState.chatUserProfile?.uid || '');
  const convId = conv.id;
  const group = isChatGroup(conv);
  const otherUid = group ? '' : _otherUidFromParticipants(conv.participants, uid);
  const otherName = group ? chatGroupTitle(conv) : (_nameForUid(otherUid) || 'Unknown');
  const unread = (conv.unreadFor && conv.unreadFor[uid]) ? Number(conv.unreadFor[uid]) : 0;
  const selected = (!forLive && typeof chatState.currentConvId !== 'undefined' && chatState.currentConvId === convId) ? 'is-selected' : '';
  const onclickAttr = forLive ? '' : ` onclick="window._openThread('${escHtml(convId)}', this)"`;
  return `
      <div class="chat-thread-card ${selected} ${unread > 0 ? 'chat-thread-card-unread' : ''}"
           data-conv-id="${escHtml(convId)}"
           data-other-uid="${escHtml(otherUid)}"
           data-other-name="${escHtml(otherName)}"
           data-is-group="${group ? '1' : '0'}"${onclickAttr}>
        <div class="ctc-avatars">
          ${_threadCardAvatarHtml(conv, uid, forLive)}
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
  let multi = false;
  try {
    multi = typeof window.ffUserHasMultipleLocations === 'function' && !!window.ffUserHasMultipleLocations();
  } catch (_) {}
  if (!activeLoc) return !multi;

  const roleLc = String(u.role || '').toLowerCase().trim();

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

  if (staffRow && typeof window.ffEnsureStaffLocationFields === 'function') {
    try {
      const f = window.ffEnsureStaffLocationFields(staffRow);
      const allowed = Array.isArray(f.allowedLocationIds)
        ? f.allowedLocationIds.map(id => String(id || '').trim()).filter(Boolean)
        : [];
      if (allowed.length) return allowed.indexOf(activeLoc) !== -1;
      const primary = typeof f.primaryLocationId === 'string' ? f.primaryLocationId.trim() : '';
      if (primary) return primary === activeLoc;
    } catch (_) {}
  }

  if (staffRow) {
    if (Array.isArray(staffRow.allowedLocationIds) && staffRow.allowedLocationIds.length) {
      return staffRow.allowedLocationIds.indexOf(activeLoc) !== -1;
    }
    if (typeof staffRow.primaryLocationId === 'string' && staffRow.primaryLocationId.trim()) {
      return staffRow.primaryLocationId.trim() === activeLoc;
    }
  }

  if (Array.isArray(u.allowedLocationIds) && u.allowedLocationIds.length) {
    return u.allowedLocationIds.indexOf(activeLoc) !== -1;
  }
  if (typeof u.primaryLocationId === 'string' && u.primaryLocationId.trim()) {
    return u.primaryLocationId.trim() === activeLoc;
  }
  // Owner with no staff row can message at every branch they can switch to.
  if (roleLc === 'owner') return true;
  return !multi;
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
  const showGear =
    typeof window.ffCurrentUserHasChatManagePermission === 'function'
      ? window.ffCurrentUserHasChatManagePermission()
      : isAdmin(role) || (role == null && window.ff_is_admin_cached === true);
  const gear = document.getElementById('chatSettingsGearBtn');
  if (gear) gear.style.display = showGear ? 'flex' : 'none';
  const newGroup = document.getElementById('chatNewGroupBtn');
  if (newGroup) newGroup.style.display = showGear ? 'flex' : 'none';
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
  const currentForLoc = Array.isArray(chatState.allConversations)
    ? chatState.allConversations.filter(c => _convMatchesLocation(c, locKey))
    : [];
  const conversationsToRender = currentForLoc.length > 0
    ? currentForLoc
    : lastNonEmptyForLoc.length > 0
      ? lastNonEmptyForLoc
      : lastRenderedForLoc.length > 0
        ? lastRenderedForLoc
        : [];

  if (conversationsToRender.length === 0) {
    if (empty) empty.style.display = 'block';
    list.innerHTML = '';
    chatState.lastRenderedThreadListHtml = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  chatState.lastRenderedConversations = conversationsToRender.slice();
  _cacheConversations(conversationsToRender);

  const existingCards = list.querySelectorAll(':scope > .chat-thread-card');
  const sameOrder = existingCards.length === conversationsToRender.length
    && [...existingCards].every((el, i) => el.getAttribute('data-conv-id') === String(conversationsToRender[i].id || ''));
  if (sameOrder) {
    conversationsToRender.forEach((conv, i) => _applyThreadCardState(existingCards[i], conv, uid));
    chatState.lastRenderedThreadListHtml = list.innerHTML;
    return;
  }

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

/**
 * WhatsApp-style reaction chips under a message bubble. `reactions` on the
 * message doc is a { uid: emoji } map (one reaction per user). Chip clicks are
 * handled by the delegated listener in chat.js (data-ff-react-chip).
 */
function ffReactionChipsHtml(ev, uid, mine) {
  const r = ev && ev.reactions && typeof ev.reactions === 'object' ? ev.reactions : null;
  if (!r) return '';
  const counts = {};
  Object.keys(r).forEach(u => {
    const e = String(r[u] || '').trim();
    if (e) counts[e] = (counts[e] || 0) + 1;
  });
  const emojis = Object.keys(counts);
  if (!emojis.length) return '';
  const myEmoji = String(r[uid] || '').trim();
  const chips = emojis.map(e => {
    const isMine = e === myEmoji;
    const style = `display:inline-flex;align-items:center;gap:3px;border:1px solid ${isMine ? '#7c3aed' : '#e5e7eb'};background:${isMine ? '#f5f3ff' : '#fff'};border-radius:999px;padding:1px 7px;font-size:12px;line-height:18px;cursor:pointer;`;
    return `<button type="button" data-ff-react-chip="${escHtml(e)}" style="${style}">${escHtml(e)}${counts[e] > 1 ? `<span style="font-size:11px;color:#6b7280;">${counts[e]}</span>` : ''}</button>`;
  }).join('');
  return `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:2px;${mine ? 'justify-content:flex-end;' : ''}">${chips}</div>`;
}

function _quoteSnippet(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 140);
}

function _canSeeGroupReads() {
  return typeof window.ffCurrentUserHasChatManagePermission === 'function'
    && window.ffCurrentUserHasChatManagePermission();
}

function _messageSearchText(ev) {
  return [
    ev?.senderName,
    ev?.title,
    ev?.message,
    ev?.replyToName,
    ev?.replyToText,
  ].filter(Boolean).join(' ');
}

function _quoteHtml(ev) {
  const id = String(ev?.replyToId || '').trim();
  if (!id) return '';
  const name = String(ev.replyToName || 'Message').trim() || 'Message';
  const text = _quoteSnippet(ev.replyToText || '');
  return `<button type="button" class="cb-quote" data-jump-msg="${escHtml(id)}">
    <span class="cb-quote-name">${escHtml(name)}</span>
    <span class="cb-quote-text">${escHtml(text)}</span>
  </button>`;
}

function _seenByHtml(ev, uid, conv) {
  if (!_canSeeGroupReads() || !isChatGroup(conv) || ev.senderUid !== uid) return '';
  const readBy = Array.isArray(ev.readBy) ? ev.readBy.filter(u => u && u !== ev.senderUid) : [];
  const n = readBy.length;
  const label = n === 0 ? 'Sent' : (n === 1 ? 'Seen' : `Seen ${n}`);
  return `<button type="button" class="cb-seen" data-ff-seen="${escHtml(ev.id || '')}">${escHtml(label)}</button>`;
}

function _syncQuoteBar() {
  const bar = document.getElementById('chatQuoteBar');
  if (!bar) return;
  const q = chatState.quoteReply;
  const open = !!chatState.currentConvId && q && q.id;
  bar.style.display = open ? 'flex' : 'none';
  if (!open) return;
  const nameEl = document.getElementById('chatQuoteName');
  const textEl = document.getElementById('chatQuoteText');
  if (nameEl) nameEl.textContent = q.name || 'Message';
  if (textEl) textEl.textContent = q.text || '';
}

function _syncChatSearchUi(openConv) {
  const btn = document.getElementById('chatConvSearchBtn');
  const bar = document.getElementById('chatConvSearchBar');
  if (btn) btn.style.display = openConv ? 'flex' : 'none';
  if (!openConv && bar) {
    bar.style.display = 'none';
    const input = document.getElementById('chatConvSearchInput');
    if (input) input.value = '';
    const count = document.getElementById('chatConvSearchCount');
    if (count) count.textContent = '';
  }
}

function applyChatSearch(query) {
  const needle = String(query || '').trim().toLowerCase();
  const rows = document.querySelectorAll('#chatConvMessages .cb-row');
  let shown = 0;
  rows.forEach(row => {
    const hay = (row.getAttribute('data-search-text') || '').toLowerCase();
    const ok = !needle || hay.includes(needle);
    row.classList.toggle('is-search-hit', !!(ok && needle));
    row.style.display = ok ? '' : 'none';
    if (ok && needle) shown += 1;
  });
  const count = document.getElementById('chatConvSearchCount');
  if (count) count.textContent = needle ? (shown ? `${shown}` : '0') : '';
}

window.setChatQuoteReply = function(msg) {
  if (!msg || !msg.id) return;
  const text = _quoteSnippet(msg.message || msg.title || '');
  chatState.quoteReply = {
    id: msg.id,
    name: String(msg.senderName || 'Message').trim() || 'Message',
    text,
  };
  _syncQuoteBar();
  const ta = document.getElementById('chatConvFreeTextInput');
  if (ta && _chatFreeTextAllowed()) {
    ta.focus();
  }
};

window.clearChatQuoteReply = function() {
  chatState.quoteReply = null;
  _syncQuoteBar();
};

window.toggleChatConvSearch = function(force) {
  const bar = document.getElementById('chatConvSearchBar');
  if (!bar || !chatState.currentConvId) return;
  const next = force === true || (force !== false && bar.style.display !== 'flex');
  bar.style.display = next ? 'flex' : 'none';
  const input = document.getElementById('chatConvSearchInput');
  if (next && input) {
    input.focus();
    applyChatSearch(input.value);
  } else {
    if (input) input.value = '';
    applyChatSearch('');
  }
};

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
  const group = isChatGroup(conv);
  const otherUid = group
    ? 'group'
    : (_otherUidFromParticipants(conv?.participants, uid) || (chatState.currentThreadFallback?.convId === convId ? chatState.currentThreadFallback.otherUid : ''));
  const otherName = group
    ? chatGroupTitle(conv)
    : _nameForUidForSend(otherUid);
  const replyBtn = document.getElementById('chatConvReplyBtn');
  if (replyBtn) {
    replyBtn.setAttribute('data-other-uid', otherUid);
    replyBtn.setAttribute('data-other-name', otherName);
    replyBtn.setAttribute('data-conv-id', convId);
    replyBtn.setAttribute('data-is-group', group ? '1' : '0');
  }

  const msgsBelongHere = chatState.currentMessagesConvId === convId;
  if (chatState.chatMessagesLoading || !msgsBelongHere) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af;font-size:14px;">Loading messages...</div>';
    _syncChatConvFreeTextComposer();
    return;
  }

  if (msgs.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af;font-size:14px;">No messages yet.</div>';
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
    const senderPhoto = !mine ? (_avatarUrlForUid(ev.senderUid) || otherAvatarUrl) : null;
    const otherAvatarHtml = !mine && senderPhoto
      ? `<span class="cb-avatar">${_fixedAvatarImg(senderPhoto, 28)}</span>`
      : (!mine ? `<span class="cb-avatar">${escHtml(senderInitial)}</span>` : '');
    // Free-text messages store title = first line of the message, so showing
    // both prints the text twice. Hide the title when the body repeats it.
    const titleText = String(ev.title || '').trim();
    const bodyText = String(ev.message || '').trim();
    const titleIsDup = !!titleText && !!bodyText &&
      (bodyText === titleText || (bodyText.split(/\r?\n/)[0] || '').trim() === titleText);
    return `
      <div class="cb-row ${mine ? 'cb-row-mine' : 'cb-row-other'}" data-ff-msg="${escHtml(ev.id || '')}" data-search-text="${escHtml(_messageSearchText(ev))}">
        ${otherAvatarHtml}
        <div class="cb-col">
          ${!mine ? `<span class="cb-sender-name">${escHtml(ev.senderName||'Unknown')} · ${roleLabel(ev.senderRole)}</span>` : ''}
          <div class="cb-bubble ${mine ? 'cb-bubble-mine' : 'cb-bubble-other'}" style="cursor:pointer;">
            ${_quoteHtml(ev)}
            ${titleText && !titleIsDup ? `<div class="cb-title">${escHtml(titleText)}</div>` : ''}
            ${ev.message ? `<div class="cb-body">${linkifyMessageHtml(ev.message)}</div>` : ''}
          </div>
          ${ffReactionChipsHtml(ev, uid, mine)}
          <span class="cb-meta">
            <span class="cb-time">${fmtTime(ev.sentAt)}</span>
            ${_seenByHtml(ev, uid, conv)}
          </span>
        </div>
      </div>
    `;
  }).join('');

  // Scroll to bottom
  setTimeout(() => { container.scrollTop = container.scrollHeight; }, 50);

  _syncChatConvFreeTextComposer();
  _syncQuoteBar();
  const searchInput = document.getElementById('chatConvSearchInput');
  const searchBar = document.getElementById('chatConvSearchBar');
  if (searchBar && searchBar.style.display === 'flex') applyChatSearch(searchInput?.value || '');
}

function _resetHeaderAvatar(av) {
  if (!av) return;
  av.classList.remove('chat-group-avatar-btn');
  av.removeAttribute('role');
  av.removeAttribute('title');
  av.onclick = null;
  av.innerHTML = '';
  av.textContent = '-';
}

function _setHeaderMainClick(convId, isGroup) {
  const main = document.getElementById('chatConvHeaderMain');
  if (!main) return;
  main.classList.toggle('is-group', !!isGroup);
  main.onclick = (isGroup && convId)
    ? (e) => {
        e.preventDefault();
        if (typeof window.openChatGroupInfo === 'function') window.openChatGroupInfo(convId);
      }
    : null;
}

function _setConversationHeader(convId) {
  const title = document.getElementById('chatConvTitle');
  if (!title) return;
  const av = document.getElementById('chatConvHeaderAvatar');
  const sub = document.getElementById('chatConvSubtitle');
  if (!convId) {
    title.textContent = 'Select a conversation';
    if (sub) sub.textContent = '';
    _resetHeaderAvatar(av);
    _setHeaderMainClick(null, false);
    _syncChatSearchUi(false);
    return;
  }
  const uid  = chatState.chatUserProfile?.uid || '';
  const conv = _conversationById(convId);
  const fallbackName = chatState.currentThreadFallback?.convId === convId ? chatState.currentThreadFallback.otherName : '';
  if (isChatGroup(conv)) {
    const groupName = chatGroupTitle(conv);
    const photoUrl = chatGroupPhotoUrl(conv);
    const count = Array.isArray(conv.participants) ? conv.participants.filter(Boolean).length : 0;
    title.textContent = groupName;
    if (sub) sub.textContent = count === 1 ? '1 participant' : `${count} participants`;
    _setHeaderMainClick(conv.id, true);
    _syncChatSearchUi(true);
    if (av) {
      av.classList.add('chat-group-avatar-btn');
      if (photoUrl) {
        const img = av.querySelector('img');
        if (img && img.getAttribute('src') === photoUrl) {
          /* keep existing image so it does not reload */
        } else {
          av.innerHTML = _fixedAvatarImg(photoUrl, 32);
        }
      } else {
        av.innerHTML = '';
        av.textContent = (groupName.charAt(0) || 'G').toUpperCase();
      }
    }
    return;
  }
  if (sub) sub.textContent = '';
  _setHeaderMainClick(null, false);
  _syncChatSearchUi(true);
  const otherUid = _otherUidFromParticipants(conv?.participants, uid) || (chatState.currentThreadFallback?.convId === convId ? chatState.currentThreadFallback.otherUid : '');
  title.textContent = _nameForUid(otherUid) || fallbackName || 'Conversation';
  const otherPhoto = _avatarUrlForUid(otherUid);
  if (av) {
    av.classList.remove('chat-group-avatar-btn');
    av.removeAttribute('role');
    av.removeAttribute('title');
    av.onclick = null;
    if (otherPhoto) {
      const img = av.querySelector('img');
      if (!(img && img.getAttribute('src') === otherPhoto)) {
        av.innerHTML = _fixedAvatarImg(otherPhoto, 32);
      }
    } else {
      av.innerHTML = '';
      av.textContent = (title.textContent.charAt(0) || '?').toUpperCase();
    }
  }
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
  _syncQuoteBar();
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
  const searchBtn = document.getElementById('chatConvSearchBtn');
  if (searchBtn && !searchBtn.__ffChatSearchBound) {
    searchBtn.__ffChatSearchBound = true;
    searchBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof window.toggleChatConvSearch === 'function') window.toggleChatConvSearch();
    });
  }
  const searchClose = document.getElementById('chatConvSearchClose');
  if (searchClose && !searchClose.__ffChatSearchBound) {
    searchClose.__ffChatSearchBound = true;
    searchClose.addEventListener('click', () => {
      if (typeof window.toggleChatConvSearch === 'function') window.toggleChatConvSearch(false);
    });
  }
  const searchInput = document.getElementById('chatConvSearchInput');
  if (searchInput && !searchInput.__ffChatSearchBound) {
    searchInput.__ffChatSearchBound = true;
    searchInput.addEventListener('input', () => applyChatSearch(searchInput.value));
  }
}

export {
  ffReactionChipsHtml,
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
