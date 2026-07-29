/**
 * Chat Module — Structured Messages System
 * WhatsApp-style Thread List → Conversation View
 * Messages are normally sent via admin-defined templates/flows; staff with
 * permissions.chat_free_text (or owner/admin session) may type freely.
 *
 * Firestore:
 *   salons/{salonId}/chatTemplates/{templateId}
 *   salons/{salonId}/conversations/{conversationId}
 *     - participants: [uidA, uidB]
 *     - unreadFor: { [uid]: number }
 *     - lastMessageAt / lastTitle / lastMessage
 *   salons/{salonId}/conversations/{conversationId}/messages/{messageId}
 */

import {
  collection, query, where, orderBy, limit,
  addDoc, setDoc, updateDoc, doc, getDoc, getDocs, deleteDoc, writeBatch, increment,
  onSnapshot, serverTimestamp, arrayUnion
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import "./format-utils.js";
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
  CHAT_DEFAULT_LOC_KEY,
  isMgrPlus,
  escHtml,
  roleLabel,
  buildConvId,
  _chatOrderValue,
  _chatSortByOrder,
  _chatCategoryValue,
  _chatGroupByCategory,
  _chatUserMatchesAllowedSenders,
  linkifyMessageHtml,
  _convLocKey,
  _itemMatchesLocation,
  _trimStr,
  _memberDisplayNameFromRow,
  _otherUidFromParticipants,
  timeAgo,
  _chatDayKey,
  _chatDaySeparatorLabel,
} from "./chat-helpers.js?v=20260626_chat_helpers_split";
import { chatState } from "./chat-state.js?v=20260627_chat_state_split";

// ─── Data layer (Firestore reads + location scoping) — extracted to chat-data.js
import {
  _readActiveLocationId,
  _activeLocKey,
  _chatEffectiveLocKey,
  _convMatchesLocation,
  _cacheConversations,
  loadChatUserProfile,
  loadChatSalonUsers,
  loadChatTemplates,
  loadChatFlows,
} from "./chat-data.js?v=20260628_chat_data_b0";

// ─── UI module (presentation helpers + small renderers) — extracted to chat-ui.js
import {
  initChatUi,
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
} from "./chat-ui.js?v=20260701_chat_ui_modal_split";
initChatUi({ _chatFreeTextAllowed, _getChatFreeTextTrimmed });

// ─── Subscriptions module (realtime listeners) — extracted to chat-subscriptions.js
import {
  initChatSubscriptions,
  subscribeToConversationList,
  _subscribeToMessages,
  _unreadCountForUid,
  _computeChatNavUnreadFromSnapDocs,
  _paintChatNavBadge,
  subscribeToChatBadge,
  subscribeToChatToastNotifications,
} from "./chat-subscriptions.js?v=20260628_chat_subs_split";
export { subscribeToChatBadge, subscribeToChatToastNotifications };
initChatSubscriptions({
  renderThreadList,
  renderConversation,
  _renderEmptyConversation,
  markThreadRead,
  goToChat,
});

// ─── Admin module (templates + flows) — extracted to chat-admin.js ──────────────
import { initChatAdmin, _renderTmplList, _renderFlowsAdminList } from "./chat-admin.js?v=20260701_chat_admin_flows_split";
initChatAdmin({
  _chatManageAllowed,
  _chatWaitForManagePermission,
  loadChatUserProfile,
  loadChatTemplates,
  loadChatFlows,
  _chatEffectiveLocKey,
  renderSendOptions: (typeof window !== 'undefined' ? window.renderSendOptions : undefined),
});

// ─── Compose module (conversation view + send/reply/confirm flow) — extracted to chat-compose.js
import { initChatCompose, _sendFreeTextDirect, markThreadRead } from "./chat-compose.js?v=20260701_chat_compose_split";
initChatCompose({ _chatFreeTextAllowed, _getChatFreeTextTrimmed });

// Delegated click binding — belt-and-suspenders with _bindChatSendBtn. Runs at
// window level in capture phase to beat any other handler that might
// stopPropagation. Idempotent.
if (typeof document !== 'undefined' && !window.__ff_chatSendBtnDelegated) {
  window.__ff_chatSendBtnDelegated = true;
  window.addEventListener('click', function (ev) {
    const btn = ev.target && ev.target.closest && ev.target.closest('#chatSendBtn');
    if (!btn) return;
    if (typeof window.openSendMessageModal === 'function') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      try { window.openSendMessageModal(); } catch (e) { console.error('[Chat] delegated openSendMessageModal threw', e); }
    }
  }, true);
}

// ─── State ────────────────────────────────────────────────────────────────────
/** Set true after first `loadChatSalonUsers` completes (success or empty). Used to show "Loading..." until members exist. */
const CHAT_NAME_LOADING = 'Loading...';
/** Perf: Chat screen open → first thread list paint (see [ChatBadgePerf] logs). */


window._chatToggleSendCategory = function(categoryIdx) {
  const section = document.querySelector(`[data-chat-send-category="${String(categoryIdx)}"]`);
  if (!section) return;
  const items = section.querySelector('.chat-category-section-items');
  const arrow = section.querySelector('.chat-send-category-arrow');
  const isOpen = items && items.style.display !== 'none';
  if (items) items.style.display = isOpen ? 'none' : 'flex';
  if (arrow) arrow.textContent = isOpen ? '▼' : '▲';
};
// Live Desk reads the most recent conversations for its Chat card.
// Returns the FULL conversation objects so the Live card can render the exact
// same thread card as the Chat module (avatars, name, time, preview, unread).
if (typeof window !== 'undefined') {
  window.ffGetRecentConversations = function (limitN) {
    var n = Number(limitN) > 0 ? Number(limitN) : 8;
    var arr = Array.isArray(chatState.allConversations) ? chatState.allConversations.slice() : [];
    arr.sort(function (a, b) {
      var am = (a && (a.lastMessageAtMs || (a.lastMessageAt && a.lastMessageAt.toMillis && a.lastMessageAt.toMillis()))) || 0;
      var bm = (b && (b.lastMessageAtMs || (b.lastMessageAt && b.lastMessageAt.toMillis && b.lastMessageAt.toMillis()))) || 0;
      return bm - am;
    });
    return arr.slice(0, n);
  };
  // Build a single chat thread card with the EXACT same look as the Chat module.
  window.ffRenderChatThreadCardHTML = function (conv) {
    try { return conv ? ffBuildChatThreadCardHTML(conv, { forLive: true }) : ''; }
    catch (_) { return ''; }
  };
  // Open a conversation from the Live Desk: switch to the Chat screen and open the thread.
  window.ffOpenChatConversation = async function (convId) {
    if (!convId) return;
    try { if (typeof goToChat === 'function') await goToChat(); } catch (_) {}
    try { if (typeof window._openThread === 'function') window._openThread(convId); } catch (_) {}
  };
}

// ─── Live Desk: in-place conversation popup ─────────────────────────────────
// Clicking a thread on the Live CHAT card opens the conversation in a small
// popup ABOVE the Live screen (reply included) instead of leaving Live for the
// Chat module. Own snapshot listener + state so the Chat tab is untouched.
let _livePopupUnsub = null;
let _livePopupConvId = null;
let _livePopupMsgs = [];
let _livePopupLoading = false;

function _livePopupOtherUid() {
  const uid = chatState.chatUserProfile?.uid || '';
  const conv = _conversationById(_livePopupConvId);
  return _otherUidFromParticipants(conv?.participants, uid) || '';
}

function _renderLivePopupMessages() {
  const box = document.getElementById('liveChatPopupMessages');
  if (!box) return;
  const msgs = _livePopupMsgs;
  if (!msgs.length) {
    box.innerHTML = `<div style="text-align:center;padding:40px;color:#9ca3af;font-size:14px;">${_livePopupLoading ? 'Loading messages...' : 'No messages yet.'}</div>`;
    return;
  }
  const uid = chatState.chatUserProfile?.uid || '';
  const otherAvatarUrl = _avatarUrlForUid(_livePopupOtherUid());
  // Bubble markup mirrors renderConversation() in chat-ui.js so the popup
  // looks identical to the full Chat thread view.
  let lastDayKey = '';
  const parts = [];
  for (let i = 0; i < msgs.length; i++) {
    const ev = msgs[i];
    const dk = _chatDayKey(ev.sentAt);
    if (dk && dk !== lastDayKey) {
      lastDayKey = dk;
      const lab = _chatDaySeparatorLabel(ev.sentAt);
      if (lab) parts.push(`<div class="cb-day-sep" role="separator" aria-label="${escHtml(lab)}"><span>${escHtml(lab)}</span></div>`);
    }
    const mine = ev.senderUid === uid;
    const senderInitial = (ev.senderName || '?').charAt(0).toUpperCase();
    const otherAvatarHtml = !mine && otherAvatarUrl
      ? `<span class="cb-avatar" style="overflow:hidden;padding:0;"><img src="${String(otherAvatarUrl).replace(/"/g, '&quot;')}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;"></span>`
      : (!mine ? `<span class="cb-avatar">${escHtml(senderInitial)}</span>` : '');
    parts.push(`
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
    `);
  }
  box.innerHTML = parts.join('');
  setTimeout(() => { box.scrollTop = box.scrollHeight; }, 30);
}

async function _livePopupSend() {
  if (!_chatFreeTextAllowed() || !chatState.chatUserProfile || !_livePopupConvId) return;
  const ta = document.getElementById('liveChatPopupInput');
  const body = String(ta?.value || '').trim();
  if (!body) return;
  const otherUid = _livePopupOtherUid();
  if (!otherUid) return;
  const btn = document.getElementById('liveChatPopupSend');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    await _sendFreeTextDirect(otherUid, _nameForUidForSend(otherUid), _livePopupConvId, body);
    if (ta) { ta.value = ''; ta.focus(); }
  } catch (e) {
    if (e && e.message === 'message_too_long') alert('Message is too long (max 8000 characters).');
    else {
      console.error('[Chat] live popup send failed', e);
      alert('Failed to send: ' + (e?.code || e?.message || 'unknown'));
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
  }
}

function _ensureLiveChatPopupDom() {
  let pop = document.getElementById('liveChatThreadPopup');
  if (pop) return pop;
  pop = document.createElement('div');
  pop.id = 'liveChatThreadPopup';
  // z-index: above the Live screen (9870), below full modals (100000+).
  pop.style.cssText = 'display:none;position:fixed;right:24px;bottom:24px;width:400px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 130px);background:#fff;border-radius:16px;box-shadow:0 18px 50px rgba(15,23,42,0.35);z-index:9940;flex-direction:column;overflow:hidden;';
  pop.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #eef0f4;background:#fafbfc;">
      <span id="liveChatPopupAvatar" class="cb-avatar" style="flex:none;overflow:hidden;"></span>
      <div style="flex:1;min-width:0;">
        <div id="liveChatPopupName" style="font-weight:800;font-size:14px;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Conversation</div>
        <button type="button" id="liveChatPopupOpenFull" style="background:none;border:none;padding:0;font-size:11px;color:#7c3aed;cursor:pointer;font-weight:700;">Open full chat</button>
      </div>
      <button type="button" id="liveChatPopupClose" aria-label="Close conversation" style="flex:none;background:none;border:none;font-size:24px;line-height:1;color:#6b7280;cursor:pointer;padding:2px 6px;">&times;</button>
    </div>
    <div id="liveChatPopupMessages" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:2px;padding:12px;background:#fff;"></div>
    <div id="liveChatPopupComposer" style="display:none;gap:8px;padding:10px 12px;border-top:1px solid #eef0f4;background:#fafbfc;align-items:flex-end;">
      <textarea id="liveChatPopupInput" rows="1" placeholder="Type a reply..." style="flex:1;resize:none;border:1px solid #e5e7eb;border-radius:10px;padding:9px 10px;font-size:13px;font-family:inherit;min-height:38px;max-height:96px;"></textarea>
      <button type="button" id="liveChatPopupSend" style="flex:none;background:#7c3aed;color:#fff;border:none;border-radius:10px;padding:10px 16px;font-size:13px;font-weight:800;cursor:pointer;">Send</button>
    </div>
    <div id="liveChatPopupNoPerm" style="display:none;padding:10px 12px;border-top:1px solid #eef0f4;background:#fafbfc;font-size:12px;color:#6b7280;text-align:center;">Replies use templates — tap "Open full chat" to reply.</div>
  `;
  document.body.appendChild(pop);
  pop.querySelector('#liveChatPopupClose').addEventListener('click', () => window.ffCloseLiveChatThread());
  pop.querySelector('#liveChatPopupOpenFull').addEventListener('click', () => {
    const convId = _livePopupConvId;
    window.ffCloseLiveChatThread();
    if (typeof window.ffCloseLiveScreen === 'function') window.ffCloseLiveScreen();
    if (convId && typeof window.ffOpenChatConversation === 'function') window.ffOpenChatConversation(convId);
  });
  pop.querySelector('#liveChatPopupSend').addEventListener('click', () => { void _livePopupSend(); });
  pop.querySelector('#liveChatPopupInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void _livePopupSend(); }
  });
  return pop;
}

window.ffOpenLiveChatThread = async function (convId) {
  if (!convId) return;
  try {
    if (!chatState.chatUserProfile) await loadChatUserProfile();
    const salonId = chatState.chatUserProfile?.salonId;
    if (!salonId) return;
    const pop = _ensureLiveChatPopupDom();
    if (_livePopupUnsub) { try { _livePopupUnsub(); } catch (_) {} _livePopupUnsub = null; }
    _livePopupConvId = convId;
    _livePopupMsgs = [];
    _livePopupLoading = true;

    const otherUid = _livePopupOtherUid();
    const nameEl = document.getElementById('liveChatPopupName');
    if (nameEl) nameEl.textContent = _nameForUid(otherUid) || 'Conversation';
    const avatarEl = document.getElementById('liveChatPopupAvatar');
    if (avatarEl) {
      const url = _avatarUrlForUid(otherUid);
      avatarEl.innerHTML = url
        ? `<img src="${String(url).replace(/"/g, '&quot;')}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`
        : escHtml((_nameForUid(otherUid) || '?').charAt(0).toUpperCase());
    }
    const composer = document.getElementById('liveChatPopupComposer');
    const noPerm = document.getElementById('liveChatPopupNoPerm');
    const canType = _chatFreeTextAllowed();
    if (composer) composer.style.display = canType ? 'flex' : 'none';
    if (noPerm) noPerm.style.display = canType ? 'none' : 'block';

    pop.style.display = 'flex';
    _renderLivePopupMessages();

    const msgQuery = query(
      collection(db, `salons/${salonId}/conversations/${convId}/messages`),
      orderBy('sentAt', 'asc'),
      limit(300)
    );
    _livePopupUnsub = onSnapshot(
      msgQuery,
      snap => {
        if (_livePopupConvId !== convId) return;
        _livePopupMsgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _livePopupLoading = false;
        _renderLivePopupMessages();
        markThreadRead(convId).catch(() => {});
      },
      err => {
        if (_livePopupConvId !== convId) return;
        _livePopupLoading = false;
        _renderLivePopupMessages();
        console.error('[Chat] live popup messages snapshot error', err);
      }
    );
  } catch (e) {
    console.error('[Chat] ffOpenLiveChatThread failed', e);
  }
};

window.ffCloseLiveChatThread = function () {
  if (_livePopupUnsub) { try { _livePopupUnsub(); } catch (_) {} _livePopupUnsub = null; }
  _livePopupConvId = null;
  _livePopupMsgs = [];
  const pop = document.getElementById('liveChatThreadPopup');
  if (pop) pop.style.display = 'none';
};

// Shared thread-card builder used by both the Chat module list and the Live Desk
// so the two always look identical.

// ─── Helpers ──────────────────────────────────────────────────────────────────
const isAdmin   = r => ['admin','owner'].includes((r||'').toLowerCase());
/**
 * Match users/{uid}.role to chat template/flow allowedSenders (checkbox values are
 * technician | manager | admin). Owners are excluded unless we map owner↔admin.
 */
/** Plain text with https URLs → safe HTML with clickable links (expiry reminders, etc.). */
/**
 * Derive the location from a conversation document ID.
 *
 * `buildConvId` encodes location into the ID itself:
 *   - default location → `{uidA}__{uidB}`
 *   - other location  → `loc_{locKey}__{uidA}__{uidB}`
 *
 * The ID is set at document creation and never mutates, so it is the
 * authoritative signal for which location the conversation belongs to.
 */
/**
 * Resolve the location a conversation doc belongs to.
 *
 * Prefers the ID prefix for newer location-scoped conversations. Legacy
 * conversation IDs have no prefix, so if Firestore has a locationId field,
 * use that instead of treating them as permanently "default".
 */

/**
 * True when a salon-scoped item (chat template, flow, …) belongs to the
 * active location. Items without a `locationId` field are treated as
 * belonging to the "default" (primary) location so legacy data stays
 * visible where it originally lived.
 */

/**
 * True when the given member/user row is allowed to work in the active location.
 *
 * Mirrors the staff list filter in index.html (search "STRICT client-side
 * location filter"):
 *   - No active location → allow everyone (initial load, single-location salons).
 *   - Owner / Admin / Manager → always visible everywhere ("leadership must be
 *     reachable in every branch").
 *   - Everyone else → must have `allowedLocationIds` that includes the active
 *     location id. Empty / missing means not assigned anywhere → hidden.
 *
 * Resolves the staff record for the member via `window.ffGetStaffStore()` and
 * falls back to the member row's own fields if no staff match exists (covers
 * the owner row which may not be in the staff store).
 */

/**
 * Build the deterministic conversation id for a 1:1 chat between two users,
 * scoped to a location. The "default" branch keeps the legacy `a__b` format
 * so existing conversations (created before multi-location rollout) remain
 * visible to users viewing the primary/default branch; all non-default
 * locations use a prefixed id so the same pair gets a fresh thread per branch.
 */
/** displayName → name on a salon/members row (or similar). */
/** Staff store row: displayName / name for a Firebase uid. */

/**
 * Human-readable label for UI (never raw uid). While salon members are still loading, show CHAT_NAME_LOADING for others.
 * Order: displayName → name → staff (ff_staff_v1) → email (members row only).
 */

/** For persisted message fields: never use uid; avoid "Loading..." when possible. */



/** Local calendar day key for grouping (YYYY-MM-DD). */
/** WhatsApp-style separator: TODAY / YESTERDAY / weekday or date. */
// ─── Header (gear): ffCurrentUserHasChatManagePermission (staff chat_manage + admin session) ───

function _chatManageAllowed() {
  return (
    typeof window.ffCurrentUserHasChatManagePermission === 'function' &&
    window.ffCurrentUserHasChatManagePermission()
  );
}

// chat_manage resolves false until the staff store hydrates (or the admin-access
// cache is set), so a first click on the gear used to silently no-op until the
// 2nd/3rd attempt. Wait for the permission predicate to settle — re-checking on
// each `ff-staff-cloud-updated` event plus a short poll — before deciding. The
// timeout still returns the real (likely false) value, so genuine no-permission
// users never open the modal.
function _chatWaitForManagePermission(timeoutMs = 2500) {
  if (_chatManageAllowed()) return Promise.resolve(true);
  return new Promise(resolve => {
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      document.removeEventListener('ff-staff-cloud-updated', onUpd);
      clearInterval(poll);
      clearTimeout(timer);
      resolve(val);
    };
    const check = () => { if (_chatManageAllowed()) finish(true); };
    const onUpd = () => check();
    document.addEventListener('ff-staff-cloud-updated', onUpd);
    const poll = setInterval(check, 150);
    const timer = setTimeout(() => finish(_chatManageAllowed()), timeoutMs);
  });
}

function _chatFreeTextAllowed() {
  return (
    typeof window.ffCurrentUserHasChatFreeTextPermission === 'function' &&
    window.ffCurrentUserHasChatFreeTextPermission()
  );
}

function _getChatFreeTextTrimmed() {
  if (!_chatFreeTextAllowed()) return '';
  const el = document.getElementById('chatSendFreeTextInput');
  return el ? String(el.value || '').trim() : '';
}

// ─── Navigation ───────────────────────────────────────────────────────────────
/**
 * Attach a direct click listener to the New Message button. Idempotent — the
 * flag on the element prevents double-binding. We also re-run this every time
 * the chat screen opens so we recover if a parent re-render swaps the node.
 */
function _bindChatSendBtn() {
  const btn = document.getElementById('chatSendBtn');
  if (!btn) return;
  if (btn.__ffSendBtnBound) return;
  btn.__ffSendBtnBound = true;
  btn.addEventListener('click', function (ev) {
    ev.preventDefault();
    if (typeof window.openSendMessageModal === 'function') {
      try { window.openSendMessageModal(); } catch (e) { console.error('[Chat] direct openSendMessageModal threw', e); }
    } else {
      setTimeout(() => {
        if (typeof window.openSendMessageModal === 'function') {
          try { window.openSendMessageModal(); } catch (e) { console.error('[Chat] retry openSendMessageModal threw', e); }
        }
      }, 50);
    }
  });
}

// Bind ASAP — the button is already in the DOM when chat.js executes because
// it's declared statically in index.html.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bindChatSendBtn, { once: true });
  } else {
    _bindChatSendBtn();
  }
}

async function goToChat() {
  console.log('[ChatBadgePerf] screen-open', performance.now(), Date.now());
  _bindChatSendBtn();
  chatState._chatBadgePerfOpenMs = performance.now();
  chatState._chatBadgePerfRenderLogged = false;
  if (typeof window.ffCloseGlobalBlockingOverlays === 'function') {
    try {
      window.ffCloseGlobalBlockingOverlays();
    } catch (e) {}
  }
  if (typeof window.closeStaffMembersModal === 'function') {
    window.closeStaffMembersModal();
  }
  ['tasksScreen', 'inboxScreen', 'owner-view', 'mediaScreen', 'trainingScreen', 'scheduleScreen', 'timeClockScreen', 'ticketsScreen'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  ['#joinBar', '.joinbar', '.wrap', '#queueControls'].forEach((sel) => {
    const el = document.querySelector(sel);
    if (el) el.style.display = 'none';
  });
  ['userProfileScreen', 'manageQueueScreen'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  const chatScreen = document.getElementById('chatScreen');
  if (chatScreen) chatScreen.style.display = 'flex';
  chatScreen?.classList.remove('chat-mobile-open');

  document.querySelectorAll('.btn-pill').forEach(b => b.classList.remove('active'));
  document.getElementById('chatBtn')?.classList.add('active');

  chatState.currentConvId = null;
  _renderEmptyConversation();

  // Deterministic: await profile before any Admin UI decisions
  await initChatScreen();
}

async function initChatScreen() {
  // Skip full re-init if already loaded — just re-render header & ensure listener
  if (chatState._chatInitialized && chatState.chatUserProfile) {
    renderChatHeaderForRole(chatState.chatUserProfile.role);
    if (!chatState.chatConvsUnsub) subscribeToConversationList();
    _bindChatConvFreeTextComposer();
    _syncChatConvFreeTextComposer();
    return;
  }
  await loadChatUserProfile();
  if (!chatState.chatUserProfile) {
    console.error('[Chat] No profile loaded — Gear hidden. Reason: auth.currentUser missing, Firestore doc not found, or load error. See loadChatUserProfile logs.');
    renderChatHeaderForRole(null);
    return;
  }
  renderChatHeaderForRole(chatState.chatUserProfile.role);
  subscribeToConversationList();
  _bindChatConvFreeTextComposer();
  _syncChatConvFreeTextComposer();
  chatState._chatInitialized = true;
  Promise.all([loadChatSalonUsers(), loadChatTemplates(), loadChatFlows()])
    .then(() => {
      if (chatState.allConversations.length) renderThreadList();
      _syncChatConvFreeTextComposer();
    })
    .catch((err) => console.warn('[Chat] background preload failed', err));
}



// ─── Thread List ───────────────────────────────────────────────────────────────




// ─── Open / Close Thread ───────────────────────────────────────────────────────
window._openThread = async function(convId, sourceEl) {
  _cacheVisibleThreadListHtml();
  if (Array.isArray(chatState.allConversations) && chatState.allConversations.length > 0) {
    chatState.lastNonEmptyConversations = chatState.allConversations.slice();
    chatState.lastRenderedConversations = chatState.allConversations.slice();
  }
  const sourceOtherUid = sourceEl && sourceEl.getAttribute ? sourceEl.getAttribute('data-other-uid') : '';
  const sourceOtherNameAttr = sourceEl && sourceEl.getAttribute ? sourceEl.getAttribute('data-other-name') : '';
  const sourceOtherNameText = sourceEl && sourceEl.querySelector ? (sourceEl.querySelector('.ctc-name')?.textContent || '') : '';
  const sourceOtherName = sourceOtherNameAttr && sourceOtherNameAttr !== CHAT_NAME_LOADING && sourceOtherNameAttr !== 'Unknown'
    ? sourceOtherNameAttr
    : sourceOtherNameText;
  const cachedConv = _conversationById(convId);
  chatState.currentThreadFallback = {
    convId,
    otherUid: sourceOtherUid || _otherUidFromParticipants(cachedConv?.participants, chatState.chatUserProfile?.uid || ''),
    otherName: sourceOtherName || '',
  };
  chatState.currentConvId = convId;
  // On narrow mobile screens, show the conversation view with a back button.
  // Desktop/tablet keeps the left conversation list visible.
  const shouldUseMobileChatView = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 860px)').matches;
  document.getElementById('chatScreen')?.classList.toggle('chat-mobile-open', shouldUseMobileChatView);
  // Update header title
  _setConversationHeader(convId);
  renderThreadList();
  chatState.currentMessages = [];
  chatState.chatMessagesLoading = true;
  _subscribeToMessages(convId);
  renderConversation(convId);
  markThreadRead(convId)
    .catch(() => {})
    .finally(() => {
      if (chatState.currentConvId === convId) renderThreadList();
    });
};

window.closeConversation = function() {
  if (chatState.chatMsgsUnsub) { chatState.chatMsgsUnsub(); chatState.chatMsgsUnsub = null; }
  chatState.currentMessages = [];
  chatState.currentConvId = null;
  chatState.currentThreadFallback = null;
  chatState.chatMessagesLoading = false;
  document.getElementById('chatScreen')?.classList.remove('chat-mobile-open');
  _restoreVisibleThreadListHtml();
  renderThreadList();
  _restoreVisibleThreadListHtml();
  _renderEmptyConversation();
  _syncChatConvFreeTextComposer();
};

// ─── Settings Section ──────────────────────────────────────────────────────────
async function initChatSettingsSection() {
  if (!chatState.chatUserProfile) await loadChatUserProfile();
  const s = document.getElementById('chatSettingsSection');
  if (s) {
    const show =
      typeof window.ffCurrentUserHasChatManagePermission === 'function'
        ? window.ffCurrentUserHasChatManagePermission()
        : isAdmin(chatState.chatUserProfile?.role);
    s.style.display = show ? 'block' : 'none';
  }
}

window.ffRefreshChatManageUi = function () {
  try {
    if (chatState.chatUserProfile) renderChatHeaderForRole(chatState.chatUserProfile.role);
    else renderChatHeaderForRole(null);
  } catch (e) {}
  void initChatSettingsSection();
};

if (typeof document !== 'undefined' && !window.__ff_chatStaffPermListener) {
  window.__ff_chatStaffPermListener = true;
  document.addEventListener('ff-staff-cloud-updated', function () {
    if (typeof window.ffRefreshChatManageUi === 'function') window.ffRefreshChatManageUi();
  });
}

// ─── Auth Listener ─────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (user) {
    // Defer chat badge subscriptions until salon is resolved. When the user has
    // multiple memberships, currentSalonId is null until they pick one in the
    // Choose Salon screen — subscribing here with the legacy users/{uid}.salonId
    // would race with the salon selection and could attach to the wrong salon.
    if (typeof window !== "undefined" && window.__ff_waiting_for_salon_choice === true) {
      return;
    }
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        const p = { uid: user.uid, ...snap.data() };
        // Multi-salon: same reason as loadChatUserProfile — prefer the salon
        // the user actively picked, otherwise badge/toast subscriptions point
        // at the legacy primary salon and cross-salon notifications leak in.
        const activeSalonId = (typeof window !== 'undefined' && window.currentSalonId)
          ? String(window.currentSalonId).trim()
          : '';
        const targetSalonId = activeSalonId || p.salonId || '';
        if (targetSalonId) {
          subscribeToChatBadge(user.uid, targetSalonId);
          subscribeToChatToastNotifications(user.uid, targetSalonId);
          void bootChatConversationList();
        }
      }
    } catch(e) {}
  } else {
    chatState._chatAuthUid = null;
    chatState._chatAuthSalonId = null;
    if (chatState.chatBadgeUnsub) { chatState.chatBadgeUnsub(); chatState.chatBadgeUnsub = null; }
    if (chatState.chatToastUnsub) { chatState.chatToastUnsub(); chatState.chatToastUnsub = null; }
    chatState._lastChatToastLastMsgMsByConv.clear();
    const badge = document.getElementById('chatNavBadge');
    if (badge) {
      badge.textContent = '';
      badge.style.removeProperty('display');
    }
  }
});

// ─── Location-change Listener (per-location chat isolation) ────────────────────
// When the active location changes, reset thread UI and re-attach listeners that
// depend on location filtering. The nav chat badge subscription is intentionally
// NOT restarted: it already sums unread for the whole salon participant set, and
// tearing it down + clearing the DOM produced a flash-then-empty badge after load.
if (typeof document !== 'undefined' && !window.__ff_chatLocationListener) {
  window.__ff_chatLocationListener = true;
  document.addEventListener('ff-active-location-changed', () => {
    try {
      console.log('[Chat] location changed → resetting chat state, new loc=', _activeLocKey());
      if (chatState.chatConvsUnsub) { chatState.chatConvsUnsub(); chatState.chatConvsUnsub = null; }
      if (chatState.chatMsgsUnsub)  { chatState.chatMsgsUnsub();  chatState.chatMsgsUnsub  = null; }
      if (chatState.chatToastUnsub) { chatState.chatToastUnsub(); chatState.chatToastUnsub = null; }
      chatState._lastChatToastLastMsgMsByConv.clear();

      chatState.allConversations = [];
      chatState.lastNonEmptyConversations = [];
      chatState.currentMessages  = [];
      chatState.currentConvId    = null;

      try { renderThreadList(); } catch (_) {}
      try { _renderEmptyConversation(); } catch (_) {}

      if (chatState._chatAuthUid && chatState._chatAuthSalonId) {
        subscribeToChatToastNotifications(chatState._chatAuthUid, chatState._chatAuthSalonId);
      }
      if (chatState.chatUserProfile?.salonId) {
        subscribeToConversationList();
        // Also reload per-location salon data (templates, flows) so the
        // settings modal and the "New Message" picker show only what the
        // currently active location has configured.
        (async () => {
          try {
            await loadChatTemplates();
            await loadChatFlows();
            try { if (typeof _renderTmplList === 'function') _renderTmplList(); } catch (_) {}
            try { if (typeof _renderFlowsAdminList === 'function') _renderFlowsAdminList(); } catch (_) {}
          } catch (err) {
            console.warn('[Chat] reload templates/flows after loc change failed', err);
          }
        })();
      }
    } catch (e) {
      console.warn('[Chat] location change handler error', e);
    }
  });
}

/**
 * Sends a Chat free-text reminder with a Training deep link (?ff_training=).
 * Wired from Training → Reports admin "Send Reminder" (index.html).
 */
window.ffSendTrainingReminderChat = async function (payload = {}) {
  await loadChatUserProfile();
  if (!chatState.chatUserProfile?.salonId || !chatState.chatUserProfile?.uid) {
    throw new Error(
      chatState.chatUserProfile == null
        ? 'Chat profile could not be loaded (users document missing or network error). Refresh and try again, or open the Chat tab once.'
        : 'Sign in is required to send chat reminders.'
    );
  }
  const salonId = chatState.chatUserProfile.salonId;

  let rUid = String(payload.recipientFirebaseUid || payload.recipientUid || '').trim();
  const staffId = String(payload.staffId || '').trim();

  if (!rUid && staffId) {
    try {
      const staffSnap = await getDoc(doc(db, `salons/${salonId}/staff`, staffId));
      if (staffSnap.exists()) {
        const d = staffSnap.data() || {};
        rUid = String(d.firebaseUid || d.uid || d.firebaseAuthUid || d.userUid || '').trim();
      }
    } catch (e) {
      console.warn('[Chat] Training reminder: staff lookup failed', e);
    }
  }

  if (!rUid && payload.recipientEmail) {
    const email = String(payload.recipientEmail || '').trim().toLowerCase();
    if (email && typeof window.ffGetStaffStore === 'function') {
      const row =
        (window.ffGetStaffStore()?.staff || []).find((s) => String(s.email || '').trim().toLowerCase() === email) ||
        null;
      if (row) rUid = String(row.firebaseUid || row.uid || '').trim();
    }
  }

  if (!rUid) {
    throw new Error(
      'This employee needs a Fair Flow login linked on their staff profile before Chat reminders work.'
    );
  }

  const trainingId = String(payload.trainingId || '').trim();
  const title = String(payload.trainingTitle || 'Training').trim() || 'Training';
  const recipientName =
    String(payload.recipientName || payload.staffName || '').trim() || _nameForUidForSend(rUid);

  let deepLink = '';
  try {
    const u = new URL(window.location.href);
    u.hash = '';
    if (trainingId) u.searchParams.set('ff_training', trainingId);
    deepLink = u.toString();
  } catch (_) {
    deepLink = window.location.href;
  }

  const intro = String(payload.leadInText || 'Please complete this assigned training when you can.').trim();
  const body = `${intro}\n\n${title}\n\nOpen training:\n${deepLink}`;

  await _sendFreeTextDirect(rUid, recipientName, null, body);
};

// Boot the conversation-list listener at app load — not only when the Chat tab
// is opened. The Live Desk CHAT card reads chatState.allConversations; before
// this boot it stayed empty after a page refresh until the user visited the
// Chat tab once ("No recent messages" on Live). Safe to call repeatedly: it
// no-ops when the listener is already attached. Privacy unchanged — the
// listener only returns conversations the signed-in user participates in.
export async function bootChatConversationList() {
  try {
    if (chatState.chatConvsUnsub) return;
    if (!chatState.chatUserProfile) await loadChatUserProfile();
    if (chatState.chatUserProfile?.salonId && !chatState.chatConvsUnsub) {
      subscribeToConversationList();
      // Names resolve via the salon members list (chatState.chatSalonUsers).
      // Without this, every card on the Live CHAT panel shows "Loading..."
      // until the user opens the Chat tab once (which is what loads members).
      if (!chatState._chatMembersLoaded) {
        loadChatSalonUsers()
          .then(() => {
            if (chatState.allConversations.length) renderThreadList();
            else if (typeof window.ffLiveRefreshChatCard === 'function') window.ffLiveRefreshChatCard();
          })
          .catch((err) => console.warn('[Chat] boot salon-users load failed', err));
      }
    }
  } catch (e) {
    console.warn('[Chat] bootChatConversationList failed', e);
  }
}

// ─── Global Exports (no export keywords - avoids parse errors in some envs) ───
window.goToChat = goToChat;
window.initChatSettingsSection = initChatSettingsSection;
