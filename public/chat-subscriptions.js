/**
 * Chat Subscriptions — Firestore realtime listeners (conversation list, nav
 * badge, toast notifications, in-conversation messages) extracted from chat.js.
 *
 * These listeners drive UI, so they depend on core render/orchestration
 * functions. To avoid an import cycle, chat.js injects those via
 * initChatSubscriptions(); this module imports back nothing from chat.js.
 */

import {
  collection, query, where, orderBy, limit, getDocs, onSnapshot
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { chatState } from "./chat-state.js?v=20260627_chat_state_split";
import { roleLabel, escHtml, _convLocKey } from "./chat-helpers.js?v=20260626_chat_helpers_split";
import {
  _chatEffectiveLocKey,
  _convMatchesLocation,
  _cacheConversations,
} from "./chat-data.js?v=20260628_chat_data_b0";

// ─── Injected core dependencies (set by initChatSubscriptions) ──────────────────
let renderThreadList = () => {};
let renderConversation = () => {};
let _renderEmptyConversation = () => {};
let markThreadRead = async () => {};
let goToChat = async () => {};

export function initChatSubscriptions(deps) {
  deps = deps || {};
  if (deps.renderThreadList) renderThreadList = deps.renderThreadList;
  if (deps.renderConversation) renderConversation = deps.renderConversation;
  if (deps._renderEmptyConversation) _renderEmptyConversation = deps._renderEmptyConversation;
  if (deps.markThreadRead) markThreadRead = deps.markThreadRead;
  if (deps.goToChat) goToChat = deps.goToChat;
}

// ─── Conversation List Subscription (PRIVATE) ──────────────────────────────────
function subscribeToConversationList() {
  if (!chatState.chatUserProfile?.salonId) return;
  if (chatState.chatConvsUnsub) { chatState.chatConvsUnsub(); chatState.chatConvsUnsub = null; }
  if (chatState.chatMsgsUnsub) { chatState.chatMsgsUnsub(); chatState.chatMsgsUnsub = null; }

  const uid  = chatState.chatUserProfile.uid;

  console.log('[ChatBadgePerf] subscribe-start', performance.now(), Date.now(), 'loc=', _chatEffectiveLocKey());
  chatState._chatConvFirstSnapLogged = false;

  chatState.chatConvsUnsub = onSnapshot(
    query(
      collection(db, `salons/${chatState.chatUserProfile.salonId}/conversations`),
      where('participants', 'array-contains', uid)
    ),
    snap => {
      if (!chatState._chatConvFirstSnapLogged) {
        chatState._chatConvFirstSnapLogged = true;
        console.log('[ChatBadgePerf] first-snapshot', performance.now(), Date.now());
      }
      const locKey = _chatEffectiveLocKey();
      const allDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const nextConversations = allDocs.filter(c => _convMatchesLocation(c, locKey));
      if (nextConversations.length > 0) {
        chatState.allConversations = nextConversations;
        chatState.lastNonEmptyConversations = nextConversations;
      } else if (allDocs.length > 0) {
        // If location metadata is stale/missing, do not show an empty chat list.
        chatState.allConversations = allDocs;
        chatState.lastNonEmptyConversations = allDocs;
      } else if (chatState.lastNonEmptyConversations.length > 0) {
        const staleForLoc = chatState.lastNonEmptyConversations.filter(c => _convMatchesLocation(c, locKey));
        chatState.allConversations = staleForLoc.length > 0 ? staleForLoc : [];
      } else {
        chatState.allConversations = nextConversations;
      }
      _cacheConversations(allDocs);
      _cacheConversations(chatState.allConversations);
      console.log(
        '[Chat] threads snapshot: locKey=', locKey,
        'totalDocs=', allDocs.length,
        'matchLocation=', nextConversations.length,
        'rendered=', chatState.allConversations.length,
        'sample=', allDocs.slice(0, 8).map(d => ({
          id: d.id,
          locationId: d.locationId || '(none)',
          resolvedLoc: _convLocKey(d),
          matches: _convMatchesLocation(d, locKey)
        }))
      );
      // Sort client-side (avoid composite index requirements)
      chatState.allConversations.sort((a, b) => {
        const aMs = a.lastMessageAt?.toMillis?.()
          || (typeof a.lastMessageAtMs === 'number' ? a.lastMessageAtMs : 0)
          || a.updatedAt?.toMillis?.()
          || (typeof a.updatedAtMs === 'number' ? a.updatedAtMs : 0)
          || a.createdAt?.toMillis?.()
          || 0;
        const bMs = b.lastMessageAt?.toMillis?.()
          || (typeof b.lastMessageAtMs === 'number' ? b.lastMessageAtMs : 0)
          || b.updatedAt?.toMillis?.()
          || (typeof b.updatedAtMs === 'number' ? b.updatedAtMs : 0)
          || b.createdAt?.toMillis?.()
          || 0;
        return bMs - aMs;
      });

      renderThreadList();
      _applyChatNavBadgeFromConversationSnap(snap, uid);
      if (!chatState._chatBadgePerfRenderLogged && chatState._chatBadgePerfOpenMs) {
        chatState._chatBadgePerfRenderLogged = true;
        console.log('[ChatBadgePerf] render-done', performance.now(), Date.now());
      }
      if (chatState.currentConvId) renderConversation(chatState.currentConvId);
      else _renderEmptyConversation();
    },
    err => console.error('[Chat] conversations snapshot error', err)
  );
}

// ─── Nav unread badge (top nav “Chat”) ───────────────────────────────────────
function _unreadCountForUid(data, uid) {
  const ur = data && data.unreadFor;
  if (!ur || typeof ur !== 'object') return 0;
  let raw = ur[uid];
  if (raw == null && typeof uid === 'string') raw = ur[String(uid)];
  const n = Number(raw);
  return isNaN(n) ? 0 : n;
}

/**
 * Total unread for the bottom/top nav badge.
 * Intentionally does NOT filter by active location: that filter is for the in-chat
 * thread list only. Including location here caused the badge to flash then drop to
 * 0 after staff + location hydration (~1s) even though unreadFor was unchanged.
 * Scope is already limited by Firestore: this salon’s conversations + participant uid.
 */
function _computeChatNavUnreadFromSnapDocs(snapDocs, uid) {
  if (!uid || !snapDocs || !snapDocs.length) return 0;
  return snapDocs.reduce((sum, d) => {
    const data = d.data() || {};
    return sum + _unreadCountForUid(data, uid);
  }, 0);
}

function _paintChatNavBadge(unread) {
  const badge = document.getElementById('chatNavBadge');
  if (!badge) return;
  if (unread > 0) {
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.style.setProperty('display', 'inline-flex', 'important');
    badge.style.setProperty('visibility', 'visible', 'important');
  } else {
    badge.textContent = '';
    badge.style.removeProperty('display');
    badge.style.removeProperty('visibility');
  }
}

function _applyChatNavBadgeFromConversationSnap(snap, uid) {
  if (!snap || !uid) return;
  const unread = _computeChatNavUnreadFromSnapDocs(snap.docs, uid);
  _paintChatNavBadge(unread);
}

// ─── Badge ─────────────────────────────────────────────────────────────────────
// Remember last auth context so the location-change listener can re-subscribe.

export function subscribeToChatBadge(uid, salonId) {
  if (!uid || !salonId) return;
  // Avoid churn: auth + chat module both call this with the same context on load.
  // Unsub/resub leaves the badge blank until the next snapshot arrives.
  if (chatState.chatBadgeUnsub && chatState._chatAuthUid === uid && chatState._chatAuthSalonId === salonId) {
    return;
  }
  chatState._chatAuthUid = uid;
  chatState._chatAuthSalonId = salonId;
  if (chatState.chatBadgeUnsub) { chatState.chatBadgeUnsub(); chatState.chatBadgeUnsub = null; }
  chatState._chatNavBadgeFirstSnapLogged = false;
  chatState._chatNavBadgeRenderDoneLogged = false;
  console.log('[ChatBadgePerf] subscribe-start nav-badge', performance.now(), Date.now(), 'loc=', _chatEffectiveLocKey());
  chatState.chatBadgeUnsub = onSnapshot(
    query(
      collection(db, `salons/${salonId}/conversations`),
      where('participants', 'array-contains', uid)
    ),
    snap => {
      if (!chatState._chatNavBadgeFirstSnapLogged) {
        chatState._chatNavBadgeFirstSnapLogged = true;
        console.log('[ChatBadgePerf] first-snapshot nav-badge', performance.now(), Date.now());
      }
      _applyChatNavBadgeFromConversationSnap(snap, uid);
      if (!chatState._chatNavBadgeRenderDoneLogged) {
        chatState._chatNavBadgeRenderDoneLogged = true;
        console.log('[ChatBadgePerf] render-done nav-badge', performance.now(), Date.now());
      }
    },
    err => console.error('[Chat] nav badge snapshot error', err)
  );
}

// ─── Toast Notifications ───────────────────────────────────────────────────────
const CHAT_TOAST_DURATION_MS = 5000;
/** Per-conversation last lastMessageAtMs we already surfaced — avoids duplicate toasts when Firestore emits the same update twice (e.g. two commits on one send). */

function isChatScreenVisible() {
  const cs = document.getElementById('chatScreen');
  return !!(cs && (cs.style.display === 'flex' || (cs.style.display === '' && getComputedStyle(cs).display === 'flex')));
}

function showChatToast({ senderName, role, preview, convId }) {
  const container = document.getElementById('chatToastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'chat-toast';
  toast.setAttribute('data-conv-id', convId);
  const roleText = roleLabel(role) || role || '';
  const previewText = (preview || '').trim().slice(0, 80) || 'New message';
  const senderLine = roleText ? `${escHtml(senderName || 'Someone')} · ${escHtml(roleText)}` : escHtml(senderName || 'Someone');
  toast.innerHTML = `
    <div class="chat-toast-header">
      <div class="chat-toast-sender">${senderLine}</div>
      <button type="button" class="chat-toast-close" aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
    <div class="chat-toast-preview">${escHtml(previewText)}</div>
  `;
  let timeoutId = null;
  const dismiss = () => {
    if (timeoutId) clearTimeout(timeoutId);
    toast.classList.add('chat-toast-dismissing');
    setTimeout(() => toast.remove(), 220);
  };
  const openThread = async () => {
    dismiss();
    await goToChat();
    if (typeof window._openThread === 'function') window._openThread(convId);
  };
  toast.querySelector('.chat-toast-close').onclick = e => { e.stopPropagation(); dismiss(); };
  toast.onclick = () => openThread();
  container.appendChild(toast);
  timeoutId = setTimeout(dismiss, CHAT_TOAST_DURATION_MS);
}

export function subscribeToChatToastNotifications(myUid, salonId) {
  if (!myUid || !salonId) return;
  chatState._chatAuthUid = myUid;
  chatState._chatAuthSalonId = salonId;
  if (chatState.chatToastUnsub) { chatState.chatToastUnsub(); chatState.chatToastUnsub = null; }
  chatState.chatToastUnsub = onSnapshot(
    query(
      collection(db, `salons/${salonId}/conversations`),
      where('participants', 'array-contains', myUid)
    ),
    snap => {
      const locKey = _chatEffectiveLocKey();
      snap.docChanges().forEach(change => {
        if (change.type !== 'modified') return;
        const data = change.doc.data() || {};
        data.id = change.doc.id;
        if (!_convMatchesLocation(data, locKey)) return;
        const convId = change.doc.id;
        const lastMs = Number(data.lastMessageAtMs) || 0;
        const prevShown = chatState._lastChatToastLastMsgMsByConv.get(convId);
        if (lastMs && prevShown !== undefined && lastMs <= prevShown) return;
        const lastSenderUid = data.lastSenderUid;
        if (!lastSenderUid || lastSenderUid === myUid) return;
        if (chatState.currentConvId === convId && isChatScreenVisible()) return;
        if (lastMs) chatState._lastChatToastLastMsgMsByConv.set(convId, lastMs);
        showChatToast({
          senderName: data.lastSenderName || 'Someone',
          role: data.lastSenderRole || '',
          preview: data.lastTitle || data.lastMessage || '',
          convId
        });
      });
    },
    err => console.error('[Chat] toast snapshot error', err)
  );
}

function _subscribeToMessages(convId) {
  if (!chatState.chatUserProfile?.salonId) return;
  if (chatState.chatMsgsUnsub) { chatState.chatMsgsUnsub(); chatState.chatMsgsUnsub = null; }

  const msgQuery = query(
    collection(db, `salons/${chatState.chatUserProfile.salonId}/conversations/${convId}/messages`),
    orderBy('sentAt','asc'),
    limit(300)
  );

  chatState.chatMsgsUnsub = onSnapshot(
    msgQuery,
    snap => {
      chatState.currentMessages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      chatState.chatMessagesLoading = false;
      if (chatState.currentConvId === convId) {
        renderConversation(convId);
        if (isChatScreenVisible()) markThreadRead(convId);
      }
    },
    err => {
      chatState.chatMessagesLoading = false;
      console.error('[Chat] messages snapshot error', err);
      if (chatState.currentConvId === convId) renderConversation(convId);
    }
  );

  setTimeout(async () => {
    if (chatState.currentConvId !== convId || !chatState.chatMessagesLoading) return;
    try {
      const snap = await getDocs(msgQuery);
      if (chatState.currentConvId !== convId) return;
      chatState.currentMessages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      chatState.chatMessagesLoading = false;
      renderConversation(convId);
      if (isChatScreenVisible()) markThreadRead(convId);
    } catch (e) {
      if (chatState.currentConvId !== convId) return;
      chatState.chatMessagesLoading = false;
      console.error('[Chat] messages fallback load error', e);
      renderConversation(convId);
    }
  }, 900);
}

export {
  subscribeToConversationList,
  _subscribeToMessages,
  _unreadCountForUid,
  _computeChatNavUnreadFromSnapDocs,
  _paintChatNavBadge,
};
