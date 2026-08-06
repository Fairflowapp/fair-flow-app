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
import { initChatAdmin, _renderTmplList, _renderFlowsAdminList } from "./chat-admin.js?v=20260628_chat_admin_split";
initChatAdmin({
  _chatManageAllowed,
  _chatWaitForManagePermission,
  loadChatUserProfile,
  loadChatTemplates,
  loadChatFlows,
  _chatEffectiveLocKey,
  renderSendOptions: (typeof window !== 'undefined' ? window.renderSendOptions : undefined),
});

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

// Shared thread-card builder used by both the Chat module list and the Live Desk
// so the two always look identical.
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

/**
 * Build the deterministic conversation id for a 1:1 chat between two users,
 * scoped to a location. The "default" branch keeps the legacy `a__b` format
 * so existing conversations (created before multi-location rollout) remain
 * visible to users viewing the primary/default branch; all non-default
 * locations use a prefixed id so the same pair gets a fresh thread per branch.
 */
/** displayName → name on a salon/members row (or similar). */
/** Staff store row: displayName / name for a Firebase uid. */
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

/**
 * Human-readable label for UI (never raw uid). While salon members are still loading, show CHAT_NAME_LOADING for others.
 * Order: displayName → name → staff (ff_staff_v1) → email (members row only).
 */
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

/** For persisted message fields: never use uid; avoid "Loading..." when possible. */
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

/** Local calendar day key for grouping (YYYY-MM-DD). */
/** WhatsApp-style separator: TODAY / YESTERDAY / weekday or date. */
// ─── Header (gear): ffCurrentUserHasChatManagePermission (staff chat_manage + admin session) ───
function renderChatHeaderForRole(role) {
  const gear = document.getElementById('chatSettingsGearBtn');
  if (!gear) return;
  const showGear =
    typeof window.ffCurrentUserHasChatManagePermission === 'function'
      ? window.ffCurrentUserHasChatManagePermission()
      : isAdmin(role) || (role == null && window.ff_is_admin_cached === true);
  gear.style.display = showGear ? 'flex' : 'none';
}

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

// ─── Conversation View (bubbles) ───────────────────────────────────────────────
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

/** Show inline free-text row only with permission and an open 1:1 thread. */
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

// Legacy: mode buttons removed; selection is via unified chatMessageRadio list
window._chatSendMode = function(mode) {
  chatState.chatSendMode = mode;
  chatState.chatSelectedFlow = null;
  chatState.chatFlowAnswers = [];
  document.querySelectorAll('.chat-flow-accordion').forEach(acc => { acc.style.display = 'none'; acc.innerHTML = ''; });
  document.querySelectorAll('.chat-option-caret').forEach(c => { c.textContent = '▼'; });
  _updateChatSendBtn();
};

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

window._chatFlowBack = function() { chatState.chatFlowAnswers.pop(); _chatRenderFlowWizard(); _updateChatSendBtn(); };
window._chatFlowResetWizard = function() {
  chatState.chatFlowAnswers = [];
  _chatRenderFlowWizard();
  _updateChatSendBtn();
};

function _buildFlowRenderedText(flow, answers) {
  if (!answers?.length) return '';
  const lines = answers.map(a => {
    const q = (a.prompt || '').trim();
    const a2 = (a.label || '').trim();
    return q ? `${q}: ${a2}` : a2;
  }).filter(Boolean);
  return lines.join('\n');
}

window._chatToggleAllRecipients = function(checked) {
  document.querySelectorAll('input[name="chatRecipient"]').forEach(cb => { cb.checked = checked; });
  _updateChatSendBtn();
};

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

window.closeSendMessageModal = function() {
  const modal = document.getElementById('chatSendModal');
  if (modal) modal.style.display = 'none';
  const panel = document.getElementById('chatRecipientPanel');
  if (panel) panel.style.display = 'none';
  const freeIn = document.getElementById('chatSendFreeTextInput');
  if (freeIn) freeIn.value = '';
  chatState.chatReplyContext = null;
};

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

// ─── Global Exports (no export keywords - avoids parse errors in some envs) ───
window.goToChat = goToChat;
window.initChatSettingsSection = initChatSettingsSection;
