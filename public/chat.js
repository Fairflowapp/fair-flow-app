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
import { db, auth } from "./app.js?v=20260408_inbox_upload_deeplink";

// Delegated click binding — belt-and-suspenders with _bindChatSendBtn. Runs at
// window level in capture phase to beat any other handler that might
// stopPropagation. Idempotent.
if (typeof document !== 'undefined' && !window.__ff_chatSendBtnDelegated) {
  window.__ff_chatSendBtnDelegated = true;
  window.addEventListener('click', function (ev) {
    const btn = ev.target && ev.target.closest && ev.target.closest('#chatSendBtn');
    if (!btn) return;
    if (typeof window.openSendMessageModal === 'function') {
      try { window.openSendMessageModal(); } catch (e) { console.error('[Chat] delegated openSendMessageModal threw', e); }
    }
  }, true);
}

// ─── State ────────────────────────────────────────────────────────────────────
let chatUserProfile    = null;
let chatTemplates      = [];
let chatFlows          = [];     // { id, title, allowedSenders, startStepId, steps: [{id,prompt,order,options:[{id,label,nextStepId,finish}]}] }
let chatSalonUsers     = [];
/** Set true after first `loadChatSalonUsers` completes (success or empty). Used to show "Loading..." until members exist. */
let _chatMembersLoaded = false;
const CHAT_NAME_LOADING = 'Loading...';
let chatConvsUnsub     = null;
let _chatInitialized   = false;  // cache flag — skip re-fetching on repeat visits
let chatMsgsUnsub      = null;
let chatBadgeUnsub     = null;
let chatToastUnsub     = null;
/** Perf: Chat screen open → first thread list paint (see [ChatBadgePerf] logs). */
let _chatBadgePerfOpenMs = 0;
let _chatBadgePerfRenderLogged = false;
let _chatConvFirstSnapLogged = false;
let _chatNavBadgeFirstSnapLogged = false;
let _chatNavBadgeRenderDoneLogged = false;
let chatEditingTmplId  = null;
let chatEditingFlowId  = null;
let chatFlowDraft      = null;   // { title, allowedSenders, steps } for builder
let chatReplyContext   = null;   // { uid, name, conversationId }
let allConversations   = [];     // kept in sync by onSnapshot
let currentMessages    = [];     // kept in sync by onSnapshot for open conversation
let currentConvId      = null;   // currently open thread
let chatSendMode       = 'template'; // 'template' | 'flow' (free text uses textarea, not this flag)
let chatSelectedFlow   = null;
let chatFlowAnswers    = [];     // during wizard: [{ stepId, prompt, optionId, label }]

// ─── Helpers ──────────────────────────────────────────────────────────────────
const isAdmin   = r => ['admin','owner'].includes((r||'').toLowerCase());
const isMgrPlus = r => ['manager','admin','owner'].includes((r||'').toLowerCase());

/**
 * Match users/{uid}.role to chat template/flow allowedSenders (checkbox values are
 * technician | manager | admin). Owners are excluded unless we map owner↔admin.
 */
function _chatNormalizeUserRoleForSenders(role) {
  const r = (role || '').toLowerCase();
  if (r === 'staff') return 'technician';
  return r;
}

function _chatExpandedRolesForAllowedToken(token) {
  const t = String(token || '').toLowerCase().trim();
  const set = new Set([t]);
  if (t === 'owner') set.add('admin');
  if (t === 'admin') set.add('owner');
  if (t === 'manager') {
    set.add('front_desk');
    set.add('assistant_manager');
  }
  if (t === 'front_desk' || t === 'assistant_manager') set.add('manager');
  return set;
}

function _chatUserMatchesAllowedSenders(userRole, allowedSenders) {
  if (!Array.isArray(allowedSenders) || allowedSenders.length === 0) return true;
  const ur = _chatNormalizeUserRoleForSenders(userRole);
  return allowedSenders.some(tok => _chatExpandedRolesForAllowedToken(tok).has(ur));
}
const escHtml   = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const escapeAttr = s => String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
/** Plain text with https URLs → safe HTML with clickable links (expiry reminders, etc.). */
function linkifyMessageHtml(raw) {
  const s = String(raw ?? '');
  const parts = s.split(/(https?:\/\/[^\s]+)/g);
  return parts.map(p => {
    if (/^https?:\/\//.test(p)) {
      const href = escapeAttr(p);
      return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;word-break:break-all;">${escHtml(p)}</a>`;
    }
    return escHtml(p);
  }).join('');
}
const roleLabel = r => ({technician:'Service Provider',manager:'Manager',admin:'Admin',owner:'Owner'}[(r||'').toLowerCase()] || r || '');

// ─── Location helpers (per-location chat isolation) ────────────────────────────
/**
 * Resolve the currently active location id from the header switcher.
 * Returns the trimmed location id string, or "" when nothing is active
 * (single-location salon, or locations not loaded yet).
 */
function _readActiveLocationId() {
  if (typeof window === 'undefined') return '';
  try {
    if (typeof window.ffGetActiveLocationId === 'function') {
      const v = window.ffGetActiveLocationId();
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  } catch (_) {}
  const raw = typeof window.__ff_active_location_id === 'string' ? window.__ff_active_location_id.trim() : '';
  return raw || '';
}

/** Normalized key used to scope conversations: "default" when no active location. */
const CHAT_DEFAULT_LOC_KEY = 'default';
function _activeLocKey() {
  const raw = _readActiveLocationId();
  return raw ? raw : CHAT_DEFAULT_LOC_KEY;
}
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
function _convLocKeyFromId(id) {
  const s = String(id || '');
  if (s.startsWith('loc_')) {
    const sep = s.indexOf('__', 4);
    if (sep > 4) return s.substring(4, sep);
  }
  return CHAT_DEFAULT_LOC_KEY;
}
/**
 * Resolve the location a conversation doc belongs to.
 *
 * Prefers the ID prefix (immutable, authoritative). Falls back to the
 * `locationId` field only if we do not have the document ID on hand (e.g.
 * when only a snapshot of the data was passed in).
 */
function _convLocKey(conv) {
  if (!conv || typeof conv !== 'object') return CHAT_DEFAULT_LOC_KEY;
  if (conv.id) return _convLocKeyFromId(conv.id);
  const v = typeof conv.locationId === 'string' ? conv.locationId.trim() : '';
  return v ? v : CHAT_DEFAULT_LOC_KEY;
}
/** True when a conversation doc belongs to the given location key. */
function _convMatchesLocation(conv, locKey) {
  const k = typeof locKey === 'string' && locKey.trim() ? locKey.trim() : CHAT_DEFAULT_LOC_KEY;
  return _convLocKey(conv) === k;
}

/**
 * True when a salon-scoped item (chat template, flow, …) belongs to the
 * active location. Items without a `locationId` field are treated as
 * belonging to the "default" (primary) location so legacy data stays
 * visible where it originally lived.
 */
function _itemMatchesLocation(item, locKey) {
  const k = typeof locKey === 'string' && locKey.trim() ? locKey.trim() : CHAT_DEFAULT_LOC_KEY;
  if (!item || typeof item !== 'object') return k === CHAT_DEFAULT_LOC_KEY;
  const v = typeof item.locationId === 'string' ? item.locationId.trim() : '';
  return (v || CHAT_DEFAULT_LOC_KEY) === k;
}

function getChatAccountId() {
  const candidates = [
    chatUserProfile?.accountId,
    chatUserProfile?.accountID,
    chatUserProfile?.account_id,
    chatUserProfile?.salonId,
    (typeof window !== 'undefined' ? window.currentAccountId : null),
    (typeof window !== 'undefined' ? window.accountId : null),
    (typeof window !== 'undefined' ? window.currentSalonId : null)
  ];
  for (const v of candidates) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

async function loadSharedChatTemplates() {
  const accountId = getChatAccountId();
  if (!accountId) return [];
  try {
    const snap = await getDocs(collection(db, `accounts/${accountId}/shared/chatTemplates/items`));
    return snap.docs
      .map(d => ({ id: `shared:${d.id}`, sharedTemplateId: d.id, isSharedTemplate: true, ...d.data() }))
      .filter(t => t.active !== false)
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  } catch (e) {
    console.warn('[SharedChat] load templates failed', e);
    return [];
  }
}

async function loadSharedChatFlows() {
  const accountId = getChatAccountId();
  if (!accountId) return [];
  try {
    const snap = await getDocs(collection(db, `accounts/${accountId}/shared/chatFlows/items`));
    return snap.docs
      .map(d => ({ id: `shared:${d.id}`, sharedFlowId: d.id, isSharedFlow: true, ...d.data() }))
      .filter(f => f.active !== false && (f.status || 'active') !== 'archived')
      .map(f => ({
        ...f,
        steps: Array.isArray(f.steps)
          ? f.steps
              .map(s => ({ ...s, options: Array.isArray(s.options) ? s.options : [] }))
              .sort((a, b) => (a.order || 0) - (b.order || 0))
          : []
      }))
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  } catch (e) {
    console.warn('[SharedChat] load flows failed', e);
    return [];
  }
}

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
const buildConvId = (a, b, locKey) => {
  const pair = [a, b].sort().join('__');
  const lk = typeof locKey === 'string' && locKey.trim() ? locKey.trim() : CHAT_DEFAULT_LOC_KEY;
  return lk === CHAT_DEFAULT_LOC_KEY ? pair : `loc_${lk}__${pair}`;
};

function _trimStr(v) {
  if (v == null) return '';
  const s = String(v).trim();
  return s;
}

/** displayName → name on a salon/members row (or similar). */
function _memberDisplayNameFromRow(u) {
  if (!u || typeof u !== 'object') return '';
  const dn = _trimStr(u.displayName);
  if (dn) return dn;
  return _trimStr(u.name);
}

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
  if (uid === chatUserProfile?.uid) {
    const p = chatUserProfile;
    const dn = _trimStr(p?.displayName);
    if (dn) return dn;
    const nm = _trimStr(p?.name);
    if (nm) return nm;
    return _trimStr(p?.email);
  }
  const u = chatSalonUsers.find(x => x.uid === uid);
  if (u) {
    const nm = _memberDisplayNameFromRow(u);
    if (nm) return nm;
    const staffNm = _staffDisplayNameForUid(uid);
    if (staffNm) return staffNm;
    const em = _trimStr(u.email);
    if (em) return em;
  } else if (!_chatMembersLoaded) {
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
  const u = chatSalonUsers.find(x => x.uid === uid);
  if (u) {
    const em = _trimStr(u.email);
    if (em) return em;
  }
  return 'Someone';
}
function _avatarUrlForUid(uid) {
  if (!uid) return null;
  if (uid === chatUserProfile?.uid) return (typeof window.ffGetCurrentUserAvatarUrl === 'function') ? window.ffGetCurrentUserAvatarUrl() : null;
  const u = chatSalonUsers.find(x => x.uid === uid);
  if (!u || !u.avatarUrl) return null;
  const v = u.avatarUpdatedAtMs != null ? String(u.avatarUpdatedAtMs) : '';
  const sep = u.avatarUrl.includes('?') ? '&' : '?';
  return `${u.avatarUrl}${sep}v=${encodeURIComponent(v)}`;
}
function _otherUidFromParticipants(parts, myUid) {
  if (!Array.isArray(parts)) return '';
  return parts.find(u => u && u !== myUid) || '';
}

function timeAgo(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60)    return 'Just now';
  if (s < 3600)  return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return d.toLocaleDateString('en-US', {month:'short', day:'numeric'});
}
function fmtTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'});
}

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
  _chatBadgePerfOpenMs = performance.now();
  _chatBadgePerfRenderLogged = false;
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
  ['.joinBar', '.wrap'].forEach((sel) => {
    const el = document.querySelector(sel);
    if (el) el.style.display = 'none';
  });
  ['queueControls', 'userProfileScreen', 'manageQueueScreen'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  const chatScreen = document.getElementById('chatScreen');
  if (chatScreen) chatScreen.style.display = 'flex';
  chatScreen?.classList.remove('chat-mobile-open');

  document.querySelectorAll('.btn-pill').forEach(b => b.classList.remove('active'));
  document.getElementById('chatBtn')?.classList.add('active');

  currentConvId = null;
  _renderEmptyConversation();

  // Deterministic: await profile before any Admin UI decisions
  await initChatScreen();
}

async function initChatScreen() {
  // Skip full re-init if already loaded — just re-render header & ensure listener
  if (_chatInitialized && chatUserProfile) {
    renderChatHeaderForRole(chatUserProfile.role);
    if (!chatConvsUnsub) subscribeToConversationList();
    _bindChatConvFreeTextComposer();
    _syncChatConvFreeTextComposer();
    return;
  }
  await loadChatUserProfile();
  if (!chatUserProfile) {
    console.error('[Chat] No profile loaded — Gear hidden. Reason: auth.currentUser missing, Firestore doc not found, or load error. See loadChatUserProfile logs.');
    renderChatHeaderForRole(null);
    return;
  }
  subscribeToConversationList();
  await Promise.all([loadChatSalonUsers(), loadChatTemplates(), loadChatFlows()]);
  renderChatHeaderForRole(chatUserProfile.role);
  if (allConversations.length) renderThreadList();
  _bindChatConvFreeTextComposer();
  _syncChatConvFreeTextComposer();
  _chatInitialized = true;
}

// ─── Profile / Users / Templates ──────────────────────────────────────────────
async function loadChatUserProfile() {
  const user = auth.currentUser;
  if (!user) {
    console.error('[Chat] loadChatUserProfile failed — no auth.currentUser. Gear hidden.');
    chatUserProfile = null;
    return;
  }
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (snap.exists()) {
      chatUserProfile = { uid: user.uid, ...snap.data() };
    } else {
      console.error('[Chat] loadChatUserProfile failed — Firestore doc users/' + user.uid + ' not found. Gear hidden.');
      chatUserProfile = null;
    }
  } catch (e) {
    console.error('[Chat] loadChatUserProfile failed — Firestore error:', e);
    chatUserProfile = null;
  }
}

async function loadChatSalonUsers() {
  if (!chatUserProfile?.salonId) {
    chatSalonUsers = [];
    _chatMembersLoaded = true;
    return;
  }
  _chatMembersLoaded = false;
  try {
    const snap = await getDocs(collection(db, `salons/${chatUserProfile.salonId}/members`));
    chatSalonUsers = snap.docs
      .map(d => ({ ...d.data(), uid: d.id }))
      .filter(u => u.uid !== chatUserProfile.uid);
  } catch (e) {
    chatSalonUsers = [];
  } finally {
    _chatMembersLoaded = true;
  }
}

async function loadChatTemplates() {
  if (!chatUserProfile?.salonId) return;
  const locKey = _activeLocKey();
  const sharedTemplates = await loadSharedChatTemplates();
  try {
    const snap = await getDocs(query(
      collection(db, `salons/${chatUserProfile.salonId}/chatTemplates`),
      orderBy('order','asc')
    ));
    const localTemplates = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(t => _itemMatchesLocation(t, locKey));
    chatTemplates = [...sharedTemplates, ...localTemplates];
  } catch (e) {
    console.warn('[Chat] loadChatTemplates orderBy failed, retrying without order', e?.code, e?.message);
    try {
      const snap = await getDocs(collection(db, `salons/${chatUserProfile.salonId}/chatTemplates`));
      const localTemplates = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(t => _itemMatchesLocation(t, locKey))
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
      chatTemplates = [...sharedTemplates, ...localTemplates];
    } catch (e2) {
      console.error('[Chat] loadChatTemplates error', e2);
      chatTemplates = sharedTemplates;
    }
  }
}

async function loadChatFlows() {
  if (!chatUserProfile?.salonId) return;
  const locKey = _activeLocKey();
  const sharedFlows = await loadSharedChatFlows();
  try {
    const flowsSnap = await getDocs(collection(db, `salons/${chatUserProfile.salonId}/chatFlows`));
    const flows = [];
    for (const fd of flowsSnap.docs) {
      const flowData = { id: fd.id, ...fd.data() };
      if (!_itemMatchesLocation(flowData, locKey)) continue;
      const stepsSnap = await getDocs(collection(db, `salons/${chatUserProfile.salonId}/chatFlows/${fd.id}/steps`));
      flowData.steps = [];
      for (const sd of stepsSnap.docs) {
        const stepData = { id: sd.id, ...sd.data() };
        const optsSnap = await getDocs(collection(db, `salons/${chatUserProfile.salonId}/chatFlows/${fd.id}/steps/${sd.id}/options`));
        stepData.options = optsSnap.docs.map(od => ({ id: od.id, ...od.data() }));
        flowData.steps.push(stepData);
      }
      flowData.steps.sort((a,b) => (a.order||0) - (b.order||0));
      if ((flowData.status || 'active') !== 'archived') flows.push(flowData);
    }
    chatFlows = [...sharedFlows, ...flows];
  } catch(e) { chatFlows = sharedFlows; }
}

// ─── Conversation List Subscription (PRIVATE) ──────────────────────────────────
function subscribeToConversationList() {
  if (!chatUserProfile?.salonId) return;
  if (chatConvsUnsub) { chatConvsUnsub(); chatConvsUnsub = null; }
  if (chatMsgsUnsub) { chatMsgsUnsub(); chatMsgsUnsub = null; }

  const uid  = chatUserProfile.uid;
  const locKey = _activeLocKey();

  console.log('[ChatBadgePerf] subscribe-start', performance.now(), Date.now(), 'loc=', locKey);
  _chatConvFirstSnapLogged = false;

  chatConvsUnsub = onSnapshot(
    query(
      collection(db, `salons/${chatUserProfile.salonId}/conversations`),
      where('participants', 'array-contains', uid)
    ),
    snap => {
      if (!_chatConvFirstSnapLogged) {
        _chatConvFirstSnapLogged = true;
        console.log('[ChatBadgePerf] first-snapshot', performance.now(), Date.now());
      }
      const allDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      allConversations = allDocs.filter(c => _convMatchesLocation(c, locKey));
      console.log(
        '[Chat] threads snapshot: locKey=', locKey,
        'totalDocs=', allDocs.length,
        'matchLocation=', allConversations.length,
        'sample=', allDocs.slice(0, 8).map(d => ({
          id: d.id,
          locationId: d.locationId || '(none)',
          resolvedLoc: _convLocKey(d),
          matches: _convMatchesLocation(d, locKey)
        }))
      );
      // Sort client-side (avoid composite index requirements)
      allConversations.sort((a, b) => {
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
      if (!_chatBadgePerfRenderLogged && _chatBadgePerfOpenMs) {
        _chatBadgePerfRenderLogged = true;
        console.log('[ChatBadgePerf] render-done', performance.now(), Date.now());
      }
      if (currentConvId) renderConversation(currentConvId);
      else _renderEmptyConversation();
    },
    err => console.error('[Chat] conversations snapshot error', err)
  );
}

// ─── Thread List ───────────────────────────────────────────────────────────────
function renderThreadList() {
  const loading = document.getElementById('chatFeedLoading');
  const empty   = document.getElementById('chatFeedEmpty');
  const list    = document.getElementById('chatFeedList');
  if (!list) return;
  if (loading) loading.style.display = 'none';

  const uid = chatUserProfile?.uid || '';

  if (!Array.isArray(allConversations) || allConversations.length === 0) {
    if (empty) empty.style.display = 'block';
    list.innerHTML = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  list.innerHTML = allConversations.map(conv => {
    const convId = conv.id;
    const otherUid = _otherUidFromParticipants(conv.participants, uid);
    const otherName = _nameForUid(otherUid) || 'Unknown';
    const unread = (conv.unreadFor && conv.unreadFor[uid]) ? Number(conv.unreadFor[uid]) : 0;
    const myInitial  = (_trimStr(chatUserProfile?.displayName) || _trimStr(chatUserProfile?.name) || '?').charAt(0).toUpperCase();
    const otherInitial = otherName.charAt(0).toUpperCase();
    const myAvatarUrl = _avatarUrlForUid(uid);
    const otherAvatarUrl = _avatarUrlForUid(otherUid);
    const myAvatarHtml = myAvatarUrl
      ? `<span class="ctc-avatar ctc-avatar-me" style="overflow:hidden;"><img src="${String(myAvatarUrl).replace(/"/g, '&quot;')}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;"></span>`
      : `<span class="ctc-avatar ctc-avatar-me">${escHtml(myInitial)}</span>`;
    const otherAvatarHtml = otherAvatarUrl
      ? `<span class="ctc-avatar ctc-avatar-other" style="overflow:hidden;"><img src="${String(otherAvatarUrl).replace(/"/g, '&quot;')}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;"></span>`
      : `<span class="ctc-avatar ctc-avatar-other">${escHtml(otherInitial)}</span>`;

    const selected = (currentConvId === convId) ? 'is-selected' : '';
    return `
      <div class="chat-thread-card ${selected} ${unread > 0 ? 'chat-thread-card-unread' : ''}"
           onclick="window._openThread('${escHtml(convId)}')">
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
  }).join('');
}

// ─── Open / Close Thread ───────────────────────────────────────────────────────
window._openThread = async function(convId) {
  currentConvId = convId;
  // Mobile: open conversation view (hide list)
  document.getElementById('chatScreen')?.classList.add('chat-mobile-open');
  // Update header title
  _setConversationHeader(convId);
  _subscribeToMessages(convId);
  renderConversation(convId);
  await markThreadRead(convId);
  renderThreadList();
};

window.closeConversation = function() {
  if (chatMsgsUnsub) { chatMsgsUnsub(); chatMsgsUnsub = null; }
  currentMessages = [];
  currentConvId = null;
  document.getElementById('chatScreen')?.classList.remove('chat-mobile-open');
  renderThreadList();
  _renderEmptyConversation();
  _syncChatConvFreeTextComposer();
};

// ─── Conversation View (bubbles) ───────────────────────────────────────────────
function renderConversation(convId) {
  _setConversationHeader(convId);
  const msgs = Array.isArray(currentMessages) ? currentMessages.slice() : [];

  const uid      = chatUserProfile?.uid || '';
  const container= document.getElementById('chatConvMessages');
  if (!container) return;

  if (!convId) {
    _renderEmptyConversation();
    return;
  }

  const conv = allConversations.find(c => c.id === convId);
  const otherUid = _otherUidFromParticipants(conv?.participants, uid);
  const replyBtn = document.getElementById('chatConvReplyBtn');
  if (replyBtn) {
    replyBtn.setAttribute('data-other-uid', otherUid);
    replyBtn.setAttribute('data-other-name', _nameForUidForSend(otherUid));
    replyBtn.setAttribute('data-conv-id', convId);
  }

  if (msgs.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af;font-size:14px;">No messages yet.</div>';
    _syncChatConvFreeTextComposer();
    return;
  }

  const otherAvatarUrl = _avatarUrlForUid(otherUid);

  container.innerHTML = msgs.map(ev => {
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
  const uid  = chatUserProfile?.uid || '';
  const conv = allConversations.find(c => c.id === convId);
  const otherUid = _otherUidFromParticipants(conv?.participants, uid);
  title.textContent = _nameForUid(otherUid) || 'Conversation';
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
  const open = !!currentConvId;
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
  if (!chatUserProfile?.salonId || !recipientUid) throw new Error('missing_context');
  const trimmed = String(bodyTrimmed || '').trim();
  if (!trimmed) throw new Error('empty_message');
  const maxFree = 8000;
  if (trimmed.length > maxFree) throw new Error('message_too_long');

  const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const title = (lines[0] || 'Message').slice(0, 120);
  const message = trimmed;

  const salonId = chatUserProfile.salonId;
  const senderUid = chatUserProfile.uid;
  const senderName =
    _trimStr(chatUserProfile.displayName) ||
    _trimStr(chatUserProfile.name) ||
    (auth.currentUser && (_trimStr(auth.currentUser.displayName) || _trimStr(auth.currentUser.email))) ||
    '';
  const senderRole = chatUserProfile.role || '';
  const rUid = recipientUid;
  const rName = recipientName || _nameForUidForSend(rUid);
  const locKey = _activeLocKey();
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
}

window.sendChatConvFreeText = async function() {
  if (!_chatFreeTextAllowed() || !chatUserProfile) return;
  const ta = document.getElementById('chatConvFreeTextInput');
  const body = String(ta?.value || '').trim();
  if (!body) {
    alert('Please type a message.');
    return;
  }
  if (!currentConvId) {
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
    await _sendFreeTextDirect(otherUid, otherName, currentConvId, body);
    if (ta) ta.value = '';
    renderConversation(currentConvId);
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
  const btn = document.getElementById('chatConvReplyBtn');
  const otherUid = btn?.getAttribute('data-other-uid') || '';
  const otherName = btn?.getAttribute('data-other-name') || _nameForUidForSend(otherUid);
  const convId = btn?.getAttribute('data-conv-id') || currentConvId;
  if (!otherUid || !chatUserProfile) return;

  await loadChatTemplates();
  await loadChatFlows();
  const sendableTemplates = chatTemplates.filter(t =>
    _chatUserMatchesAllowedSenders(chatUserProfile.role, t.allowedSenders)
  );
  const sendableFlows = chatFlows.filter(f =>
    _chatUserMatchesAllowedSenders(chatUserProfile.role, f.allowedSenders)
  );
  const templateFlowCount = sendableTemplates.length + sendableFlows.length;

  if (_chatFreeTextAllowed() && templateFlowCount === 0) {
    document.getElementById('chatConvFreeTextInput')?.focus();
    return;
  }

  chatReplyContext = { uid: otherUid, name: otherName, conversationId: convId };
  await _openChatModal({
    title: `↩ Reply to ${_nameForUid(otherUid) || 'Someone'}`,
    showSendTo: false
  });
};

// ─── Mark Thread Read ──────────────────────────────────────────────────────────
async function markThreadRead(convId) {
  if (!chatUserProfile?.salonId || !chatUserProfile?.uid) return;
  const uid = chatUserProfile.uid;
  try {
    // Reset unread counter on conversation doc
    await updateDoc(
      doc(db, `salons/${chatUserProfile.salonId}/conversations`, convId),
      { [`unreadFor.${uid}`]: 0 }
    );
  } catch(e) {}

  // Best-effort: mark recent messages as read (last 60)
  try {
    const snap = await getDocs(query(
      collection(db, `salons/${chatUserProfile.salonId}/conversations/${convId}/messages`),
      orderBy('sentAt', 'desc'),
      limit(60)
    ));
    const batch = writeBatch(db);
    snap.docs.forEach(d => {
      const data = d.data() || {};
      const rb = Array.isArray(data.readBy) ? data.readBy : [];
      if (!rb.includes(uid)) {
        batch.update(d.ref, { readBy: arrayUnion(uid) });
      }
    });
    await batch.commit();
  } catch(e) {}
}

// ─── Send Modal (new message from main screen) ────────────────────────────────
window.openSendMessageModal = async function() {
  try {
    chatReplyContext = null;
    // Make sure profile is ready — the Chat top bar is rendered as soon as the
    // screen becomes visible, which means the New Message button can be clicked
    // before initChatScreen() finishes. _openChatModal silently returns when
    // chatUserProfile is null, which looks like "button does nothing".
    if (!chatUserProfile) {
      await loadChatUserProfile();
    }
    if (!chatUserProfile) {
      console.warn('[Chat] openSendMessageModal: no chatUserProfile after load; aborting.');
      if (typeof window.ffStyledAlert === 'function') {
        window.ffStyledAlert('Unable to open New Message — please refresh and try again.');
      }
      return;
    }
    await _openChatModal({ title: 'New Message', showSendTo: true });
  } catch (e) {
    console.error('[Chat] openSendMessageModal error', e);
  }
};

// ─── Shared Modal Renderer ─────────────────────────────────────────────────────
async function _openChatModal({ title, showSendTo }) {
  if (!chatUserProfile) return;
  await loadChatTemplates();
  await loadChatFlows();
  await loadChatSalonUsers();

  chatSendMode = 'template';
  chatSelectedFlow = null;
  chatFlowAnswers = [];

  const sendableTemplates = chatTemplates.filter(t =>
    _chatUserMatchesAllowedSenders(chatUserProfile.role, t.allowedSenders)
  );
  const sendableFlows = chatFlows.filter(f =>
    _chatUserMatchesAllowedSenders(chatUserProfile.role, f.allowedSenders)
  );

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
  if (!showSendTo && panel) panel.style.display = 'none';

  const items = [];
  sendableTemplates.forEach(t => items.push({ type: 'template', id: t.id, title: t.title, preview: t.message }));
  sendableFlows.forEach(f => items.push({
    type: 'flow',
    id: f.id,
    title: f.title,
    preview: f.steps?.[0]?.prompt || ''
  }));

  const freeAllowed = _chatFreeTextAllowed();
  const hideModalFreeComposer = !!(freeAllowed && chatReplyContext);
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
            chatSendMode = 'template';
            chatSelectedFlow = null;
            chatFlowAnswers = [];
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
    messageList.innerHTML = items.map(it => {
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
          chatSendMode = 'flow';
          chatSelectedFlow = chatFlows.find(x => x.id === id) || null;
          chatFlowAnswers = [];
          const acc = block?.querySelector('.chat-flow-accordion');
          const caret = block?.querySelector('.chat-option-caret');
          if (acc) {
            acc.style.display = 'block';
            if (caret) caret.textContent = '▲';
            _chatRenderFlowWizard(acc);
            setTimeout(() => acc.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
          }
        } else {
          chatSendMode = 'template';
          chatSelectedFlow = null;
          chatFlowAnswers = [];
        }
        _updateChatSendBtn();
      });
    });
  }

  // Recipients
  if (showSendTo) {
    const myRole = chatUserProfile && chatUserProfile.role;
    // Base pool: leaders see everyone, non-leaders only see leadership they can
    // message (existing rule). Then apply STRICT location filter so each branch
    // only sees the staff actually assigned to it (mirrors the staff list and
    // queue behavior elsewhere in the app).
    const basePool = isMgrPlus(myRole) ? chatSalonUsers : chatSalonUsers.filter(u => isMgrPlus(u.role));
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
  chatSendMode = mode;
  chatSelectedFlow = null;
  chatFlowAnswers = [];
  document.querySelectorAll('.chat-flow-accordion').forEach(acc => { acc.style.display = 'none'; acc.innerHTML = ''; });
  document.querySelectorAll('.chat-option-caret').forEach(c => { c.textContent = '▼'; });
  _updateChatSendBtn();
};

function _chatGetFlowAccordion() {
  if (!chatSelectedFlow?.id) return null;
  const block = document.querySelector(`.chat-message-option-block[data-type="flow"][data-id="${chatSelectedFlow.id}"]`);
  return block?.querySelector('.chat-flow-accordion') || null;
}

function _chatRenderFlowWizard(container) {
  const wizard = container || _chatGetFlowAccordion();
  if (!wizard || !chatSelectedFlow) return;
  const flow = chatSelectedFlow;
  const steps = flow.steps || [];
  const startId = flow.startStepId || steps[0]?.id;
  if (!startId || !steps.length) {
    wizard.innerHTML = '<div style="padding:12px;color:#6b7280;font-size:13px;">This flow has no questions yet.</div>';
    return;
  }
  let stepId = startId;
  for (const a of chatFlowAnswers) {
    const step = steps.find(s => String(s.id) === String(a.stepId));
    const opt = step?.options?.find(o => String(o.id) === String(a.optionId));
    if (!opt) { stepId = null; break; }
    if (opt.finish) { stepId = null; break; }
    stepId = opt.nextStepId || null;
  }
  if (!stepId) {
    const rendered = _buildFlowRenderedText(flow, chatFlowAnswers);
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
  wizard.innerHTML = `
    <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:10px;">${escHtml(step.prompt || 'Choose an option:')}</div>
    <div style="display:flex;flex-direction:column;gap:6px;" id="chatFlowStepOptions">
      ${step.options.map(o => `
        <button type="button" class="chat-flow-opt-btn" data-step-id="${escHtml(step.id)}" data-opt-id="${escHtml(o.id)}" data-opt-label="${escHtml(o.label || '')}"
          style="padding:10px 14px;text-align:left;border:1px solid #e5e7eb;border-radius:8px;background:#fff;cursor:pointer;font-size:14px;color:#111827;">${escHtml(o.label || '(no label)')}</button>
      `).join('')}
    </div>
    ${chatFlowAnswers.length ? '<button type="button" class="chat-flow-back-btn" style="margin-top:10px;padding:6px 12px;font-size:12px;color:#6b7280;background:none;border:none;cursor:pointer;">← Back</button>' : ''}
  `;
  wizard.querySelectorAll('.chat-flow-opt-btn').forEach(btn => {
    btn.onclick = () => {
      chatFlowAnswers.push({
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

window._chatFlowBack = function() { chatFlowAnswers.pop(); _chatRenderFlowWizard(); _updateChatSendBtn(); };
window._chatFlowResetWizard = function() {
  chatFlowAnswers = [];
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
  if (!ready && chatSendMode === 'flow') {
    if (chatSelectedFlow && chatFlowAnswers.length) {
      const flow = chatSelectedFlow;
      const steps = flow.steps || [];
      const findStep = id => steps.find(s => String(s.id) === String(id));
      const findOpt = (step, id) => step?.options?.find(o => String(o.id) === String(id));
      let stepId = flow.startStepId || steps[0]?.id;
      for (const a of chatFlowAnswers) {
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
  if (!chatReplyContext) {
    rcpt = document.getElementById('chatRecipientAll')?.checked
        || !!document.querySelector('input[name="chatRecipient"]:checked');
  }
  const btn = document.getElementById('chatSendConfirmBtn');
  if (btn) {
    btn.disabled = !ready;
    btn.title = ready && !rcpt ? 'Select at least one recipient' : '';
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
  chatReplyContext = null;
};

function _updateRecipientSummary() {
  const label = document.getElementById('chatRecipientPickerLabel');
  if (!label) return;
  // Reply flow has no send-to
  if (chatReplyContext) return;

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
  if (!chatUserProfile) return;
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
  } else if (chatSendMode === 'flow' && chatSelectedFlow && chatFlowAnswers?.length) {
    const flow = chatSelectedFlow;
    const steps = flow.steps || [];
    const findStep = id => steps.find(s => String(s.id) === String(id));
    const findOpt = (step, id) => step?.options?.find(o => String(o.id) === String(id));
    let stepId = flow.startStepId || steps[0]?.id;
    for (const a of chatFlowAnswers) {
      const step = findStep(a.stepId);
      const opt = findOpt(step, a.optionId) || (step?.options && a.label ? step.options.find(o => String(o.label || '').trim() === String(a.label || '').trim()) : null);
      if (opt?.finish) { stepId = null; break; }
      stepId = opt?.nextStepId ?? null;
    }
    if (stepId) { alert('Please complete the flow.'); return; }
    title = flow.title;
    renderedText = _buildFlowRenderedText(flow, chatFlowAnswers);
    flowId = flow.id;
    flowTitle = flow.title;
    flowAnswers = chatFlowAnswers;
    message = renderedText;
  } else {
    const radio = document.querySelector('input[name="chatMessageRadio"]:checked');
    if (!radio) { alert('Please select a message.'); return; }
    const val = String(radio.value || '');
    const templateIdRaw = val.startsWith('template:') ? val.slice(9) : val;
    const template = chatTemplates.find(t => t.id === templateIdRaw);
    if (!template) return;
    title = template.title; message = template.message || ''; templateId = template.id;
  }

  let recipientUids = [], recipientNames = [];

  if (chatReplyContext) {
    recipientUids  = [chatReplyContext.uid];
    recipientNames = [chatReplyContext.name];
  } else {
    const allChecked = document.getElementById('chatRecipientAll')?.checked;
    if (allChecked) {
      const pool = isMgrPlus(chatUserProfile.role)
        ? chatSalonUsers
        : chatSalonUsers.filter(u => isMgrPlus(u.role));
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
    if (!recipientUids.length) { alert('Please select at least one recipient.'); return; }
  }

  const btn = document.getElementById('chatSendConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

  try {
    if (freeRaw) {
      const convOverride = chatReplyContext?.conversationId || null;
      for (let i = 0; i < recipientUids.length; i++) {
        const rUid = recipientUids[i];
        const rName = recipientNames[i] || _nameForUidForSend(rUid);
        await _sendFreeTextDirect(rUid, rName, convOverride, freeRaw);
      }
    } else {
      const salonId = chatUserProfile.salonId;
      const senderUid = chatUserProfile.uid;
      const senderName =
        _trimStr(chatUserProfile.displayName) ||
        _trimStr(chatUserProfile.name) ||
        (auth.currentUser && (_trimStr(auth.currentUser.displayName) || _trimStr(auth.currentUser.email))) ||
        '';
      const senderRole = chatUserProfile.role || '';
      const locKey = _activeLocKey();

      for (let i = 0; i < recipientUids.length; i++) {
        const rUid = recipientUids[i];
        const rName = recipientNames[i] || _nameForUidForSend(rUid);
        const convId = chatReplyContext?.conversationId || buildConvId(senderUid, rUid, locKey);
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

    window.closeSendMessageModal();
    if (chatReplyContext?.conversationId && currentConvId === chatReplyContext.conversationId) {
      renderConversation(chatReplyContext.conversationId);
    }
  } catch(e) {
    console.error('[Chat] send error', e);
    alert('Failed to send: ' + (e?.code || e?.message || 'unknown'));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
  }
};

// ─── Badge ─────────────────────────────────────────────────────────────────────
// Remember last auth context so the location-change listener can re-subscribe.
let _chatAuthUid = null;
let _chatAuthSalonId = null;

export function subscribeToChatBadge(uid, salonId) {
  if (!uid || !salonId) return;
  _chatAuthUid = uid;
  _chatAuthSalonId = salonId;
  if (chatBadgeUnsub) { chatBadgeUnsub(); chatBadgeUnsub = null; }
  _chatNavBadgeFirstSnapLogged = false;
  _chatNavBadgeRenderDoneLogged = false;
  const locKey = _activeLocKey();
  console.log('[ChatBadgePerf] subscribe-start nav-badge', performance.now(), Date.now(), 'loc=', locKey);
  chatBadgeUnsub = onSnapshot(
    query(
      collection(db, `salons/${salonId}/conversations`),
      where('participants', 'array-contains', uid)
    ),
    snap => {
      if (!_chatNavBadgeFirstSnapLogged) {
        _chatNavBadgeFirstSnapLogged = true;
        console.log('[ChatBadgePerf] first-snapshot nav-badge', performance.now(), Date.now());
      }
      const unread = snap.docs.reduce((sum, d) => {
        const data = d.data() || {};
        data.id = d.id;
        if (!_convMatchesLocation(data, locKey)) return sum;
        const n = (data.unreadFor && data.unreadFor[uid]) ? Number(data.unreadFor[uid]) : 0;
        return sum + (isNaN(n) ? 0 : n);
      }, 0);
      const badge = document.getElementById('chatNavBadge');
      if (!badge) return;
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.style.display = unread > 0 ? 'inline-flex' : 'none';
      if (!_chatNavBadgeRenderDoneLogged) {
        _chatNavBadgeRenderDoneLogged = true;
        console.log('[ChatBadgePerf] render-done nav-badge', performance.now(), Date.now());
      }
    }
  );
}

// ─── Toast Notifications ───────────────────────────────────────────────────────
const CHAT_TOAST_DURATION_MS = 5000;
/** Per-conversation last lastMessageAtMs we already surfaced — avoids duplicate toasts when Firestore emits the same update twice (e.g. two commits on one send). */
const _lastChatToastLastMsgMsByConv = new Map();

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
  _chatAuthUid = myUid;
  _chatAuthSalonId = salonId;
  if (chatToastUnsub) { chatToastUnsub(); chatToastUnsub = null; }
  const locKey = _activeLocKey();
  chatToastUnsub = onSnapshot(
    query(
      collection(db, `salons/${salonId}/conversations`),
      where('participants', 'array-contains', myUid)
    ),
    snap => {
      snap.docChanges().forEach(change => {
        if (change.type !== 'modified') return;
        const data = change.doc.data() || {};
        data.id = change.doc.id;
        if (!_convMatchesLocation(data, locKey)) return;
        const convId = change.doc.id;
        const lastMs = Number(data.lastMessageAtMs) || 0;
        const prevShown = _lastChatToastLastMsgMsByConv.get(convId);
        if (lastMs && prevShown !== undefined && lastMs <= prevShown) return;
        const lastSenderUid = data.lastSenderUid;
        if (!lastSenderUid || lastSenderUid === myUid) return;
        if (currentConvId === convId && isChatScreenVisible()) return;
        if (lastMs) _lastChatToastLastMsgMsByConv.set(convId, lastMs);
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
  if (!chatUserProfile?.salonId) return;
  if (chatMsgsUnsub) { chatMsgsUnsub(); chatMsgsUnsub = null; }

  chatMsgsUnsub = onSnapshot(
    query(
      collection(db, `salons/${chatUserProfile.salonId}/conversations/${convId}/messages`),
      orderBy('sentAt','asc'),
      limit(300)
    ),
    snap => {
      currentMessages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (currentConvId === convId) renderConversation(convId);
    },
    err => console.error('[Chat] messages snapshot error', err)
  );
}

// ─── Admin Templates + Flows Settings ───────────────────────────────────────────
window.openChatTemplatesSettings = async function() {
  if (!_chatManageAllowed()) return;
  if (!chatUserProfile) await loadChatUserProfile();
  await loadChatTemplates();
  await loadChatFlows();
  // Reset the compact form to its default "new" state each time we open
  chatEditingTmplId = null;
  const titleEl = document.getElementById('chatTmplTitle');
  const msgEl   = document.getElementById('chatTmplMessage');
  if (titleEl) titleEl.value = '';
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
  chatEditingTmplId = null;
  chatEditingFlowId = null;
  chatFlowDraft = null;
  _setChatTmplDetailsOpen(false);
};

window._chatSettingsTab = function(tab) {
  if (!_chatManageAllowed()) return;
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
      if (!chatEditingFlowId) {
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
  if (!chatFlowDraft) chatFlowDraft = { title: '', allowedSenders: [], steps: [] };
  if (!chatFlowDraft.steps) chatFlowDraft.steps = [];
  const id = 's' + Date.now();
  chatFlowDraft.steps.push({ id, prompt: '', order: 0, options: [{ id: 'o' + Date.now(), label: '', finish: true }] });
  _renderFlowBuilder();
};

window._chatFlowRemoveStep = function(idx) {
  if (!_chatManageAllowed()) return;
  _syncFlowDraftFromUI();
  if (chatFlowDraft?.steps?.[idx] === undefined) return;
  chatFlowDraft.steps.splice(idx, 1);
  _renderFlowBuilder();
};

window._chatFlowRemoveStepById = function(stepId) {
  if (!_chatManageAllowed()) return;
  _syncFlowDraftFromUI();
  const idx = chatFlowDraft?.steps?.findIndex(s => s.id === stepId);
  if (idx === undefined || idx < 0) return;
  chatFlowDraft.steps.splice(idx, 1);
  _renderFlowBuilder();
};

window._chatFlowAddOption = function(stepIdx) {
  if (!_chatManageAllowed()) return;
  _syncFlowDraftFromUI();
  if (!chatFlowDraft?.steps?.[stepIdx]) return;
  const step = chatFlowDraft.steps[stepIdx];
  if (!step.options) step.options = [];
  step.options.push({ id: 'o' + Date.now(), label: '', finish: true });
  _renderFlowBuilder();
};

window._chatFlowAddOptionById = function(stepId) {
  if (!_chatManageAllowed()) return;
  _syncFlowDraftFromUI();
  const step = chatFlowDraft?.steps?.find(s => s.id === stepId);
  if (!step) return;
  if (!step.options) step.options = [];
  step.options.push({ id: 'o' + Date.now(), label: '', finish: true });
  _renderFlowBuilder();
};

window._chatFlowRemoveOption = function(stepIdx, optIdx) {
  if (!_chatManageAllowed()) return;
  _syncFlowDraftFromUI();
  if (!chatFlowDraft?.steps?.[stepIdx]?.options) return;
  chatFlowDraft.steps[stepIdx].options.splice(optIdx, 1);
  _renderFlowBuilder();
};

window._chatFlowRemoveOptionByIdx = function(stepId, optIdx) {
  if (!_chatManageAllowed()) return;
  _syncFlowDraftFromUI();
  const step = chatFlowDraft?.steps?.find(s => s.id === stepId);
  if (!step?.options) return;
  step.options.splice(optIdx, 1);
  _renderFlowBuilder();
};

// Add a new step and link the given option to it (for branching)
window._chatFlowAddStepAndLink = function(stepIdx, optIdx) {
  if (!_chatManageAllowed()) return;
  _syncFlowDraftFromUI();
  if (!chatFlowDraft) chatFlowDraft = { title: '', allowedSenders: [], steps: [] };
  if (!chatFlowDraft.steps) chatFlowDraft.steps = [];
  const newId = 's' + Date.now();
  const newStep = { id: newId, prompt: '', order: chatFlowDraft.steps.length, options: [{ id: 'o' + Date.now(), label: '', finish: true }] };
  chatFlowDraft.steps.push(newStep);
  const opt = chatFlowDraft.steps[stepIdx]?.options?.[optIdx];
  if (opt) {
    opt.nextStepId = newId;
    opt.finish = false;
  }
  _renderFlowBuilder();
};

window._chatFlowAddStepAndLinkById = function(stepId, optIdx) {
  _syncFlowDraftFromUI();
  if (!chatFlowDraft) chatFlowDraft = { title: '', allowedSenders: [], steps: [] };
  if (!chatFlowDraft.steps) chatFlowDraft.steps = [];
  const newId = 's' + Date.now();
  const newStep = { id: newId, prompt: '', order: chatFlowDraft.steps.length, options: [{ id: 'o' + Date.now(), label: '', finish: true }] };
  chatFlowDraft.steps.push(newStep);
  const step = chatFlowDraft.steps.find(s => s.id === stepId);
  const opt = step?.options?.[optIdx];
  if (opt) {
    opt.nextStepId = newId;
    opt.finish = false;
  }
  _renderFlowBuilder();
};

window._chatFlowUnlinkStep = function(stepId, optIdx) {
  if (!_chatManageAllowed()) return;
  _syncFlowDraftFromUI();
  const step = chatFlowDraft?.steps?.find(s => s.id === stepId);
  const opt = step?.options?.[optIdx];
  if (!opt) return;
  opt.nextStepId = null;
  opt.finish = true;
  _renderFlowBuilder();
};

function _chatDirectChildrenByClass(node, className) {
  return Array.from(node?.children || []).filter(child =>
    child.classList && child.classList.contains(className)
  );
}

function _chatDirectChildByClass(node, className) {
  return _chatDirectChildrenByClass(node, className)[0] || null;
}

// Collect steps from the flat builder DOM, preserving the visible question order.
function _collectStepsFromTreeDOM() {
  const steps = [];
  document.querySelectorAll?.('#chatFlowStepsList > .chat-flow-node').forEach(node => {
    const stepId = node.getAttribute?.('data-step-id');
    if (!stepId) return;
    const promptEl = node.querySelector?.('.chat-flow-step-prompt');
    const prompt = (promptEl?.value ?? '').trim();
    const options = [];
    const optsContainer = _chatDirectChildByClass(node, 'chat-flow-options');
    const existingStep = chatFlowDraft?.steps?.find(s => s.id === stepId);
    _chatDirectChildrenByClass(optsContainer, 'chat-flow-answer-block').forEach((block, oidx) => {
      const labelEl = block.querySelector?.('.chat-flow-opt-label');
      const nextEl = block.querySelector?.('.chat-flow-next-select');
      const label = (labelEl?.value ?? '').trim();
      const nextStepId = (nextEl?.value ?? '').trim();
      const existingOpt = existingStep?.options?.[oidx];
      options.push({
        id: existingOpt?.id || 'o' + Date.now() + '_' + oidx,
        label,
        nextStepId: nextStepId || null,
        finish: !nextStepId
      });
    });
    steps.push({ id: stepId, prompt, order: steps.length, options });
  });
  return steps;
}

// Sync current form values from DOM into chatFlowDraft.
function _syncFlowDraftFromUI() {
  if (!chatFlowDraft) chatFlowDraft = { title: '', allowedSenders: [], steps: [] };
  chatFlowDraft.title = document.getElementById('chatFlowTitle')?.value ?? '';
  chatFlowDraft.allowedSenders = ['technician','manager','admin'].filter((_, i) =>
    document.getElementById(['chatFlowSenderTech','chatFlowSenderMgr','chatFlowSenderAdmin'][i])?.checked);
  const treeNodes = document.querySelectorAll?.('#chatFlowStepsList > .chat-flow-node');
  if (treeNodes?.length) {
    chatFlowDraft.steps = _collectStepsFromTreeDOM();
  }
}

function _collectFlowDraftFromUI() {
  if (!chatFlowDraft) return null;
  const title = document.getElementById('chatFlowTitle')?.value?.trim();
  if (!title) return null;
  const allowedSenders = ['technician','manager','admin'].filter((_,i) =>
    document.getElementById(['chatFlowSenderTech','chatFlowSenderMgr','chatFlowSenderAdmin'][i])?.checked);
  const treeNodes = document.querySelectorAll?.('#chatFlowStepsList > .chat-flow-node');
  if (!treeNodes?.length) return null;
  const steps = _collectStepsFromTreeDOM();
  if (steps.length === 0) return null;
  const root = steps[0];
  if (!root?.prompt?.trim()) { alert('Please fill in the first question.'); return null; }
  if (!root?.options?.length || root.options.every(o => !(o.label || '').trim())) { alert('Please add at least one answer to the first question.'); return null; }
  return { title, allowedSenders, steps };
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
  const wasEditing = !!chatEditingFlowId;
  if (btn) { btn.disabled = true; }
  _setChatFlowSaveBtn('saving');
  const locKey = _activeLocKey();
  try {
    const salonId = chatUserProfile.salonId;
    const flowsRef = collection(db, `salons/${salonId}/chatFlows`);
    let flowId = chatEditingFlowId;
    if (flowId) {
      await updateDoc(doc(db, `salons/${salonId}/chatFlows`, flowId), {
        title: draft.title, allowedSenders: draft.allowedSenders, locationId: locKey, updatedAt: serverTimestamp()
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
        title: draft.title, allowedSenders: draft.allowedSenders, status: 'active', locationId: locKey,
        startStepId: draft.steps[0]?.id, createdAt: serverTimestamp(), createdBy: chatUserProfile.uid
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
      for (const o of s.options) {
        const nextId = o.nextStepId ? (stepIdMap[o.nextStepId] || o.nextStepId) : null;
        await addDoc(optsRef, { label: o.label, nextStepId: nextId, finish: !!o.finish });
      }
      if (i === 0) await updateDoc(doc(db, `salons/${salonId}/chatFlows`, flowId), { startStepId: firestoreStepId });
    }
    window.cancelEditChatFlow();
    await loadChatFlows();
    _renderFlowsAdminList();
    if (typeof window.showToast === 'function') window.showToast('Flow saved', 'success');
  } catch(e) {
    console.error('[Chat] save flow error', e);
    const msg = 'Failed to save: ' + (e?.code || e?.message || 'unknown');
    if (typeof window.ffStyledAlert === 'function') window.ffStyledAlert(msg);
    else alert(msg);
  } finally {
    if (btn) { btn.disabled = false; }
    _setChatFlowSaveBtn(chatEditingFlowId ? 'update' : 'add');
  }
};

window.cancelEditChatFlow = function() {
  chatEditingFlowId = null;
  chatFlowDraft = { title: '', allowedSenders: [], steps: [] };
  const titleEl = document.getElementById('chatFlowTitle');
  if (titleEl) titleEl.value = '';
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
  const f = chatFlows.find(x => x.id === id);
  if (!f) return;
  if (f.isSharedFlow) {
    alert('Shared flows are managed in Settings → Shared Setup.');
    return;
  }
  chatEditingFlowId = id;
  let stepList = (f.steps || []).map(s => ({
    id: s.id,
    prompt: s.prompt,
    order: s.order,
    options: (s.options || []).map(o => ({ id: o.id, label: o.label, nextStepId: o.nextStepId, finish: !!o.finish }))
  }));
  const rootId = f.startStepId;
  if (rootId && stepList.length > 1) {
    const rootIdx = stepList.findIndex(s => s.id === rootId);
    if (rootIdx > 0) {
      const [root] = stepList.splice(rootIdx, 1);
      stepList = [root, ...stepList];
    }
  }
  chatFlowDraft = { title: f.title, allowedSenders: f.allowedSenders || [], steps: stepList };
  document.getElementById('chatFlowTitle').value = f.title || '';
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
  const flow = chatFlows.find(x => x.id === id);
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
          const ref = doc(db, `salons/${chatUserProfile.salonId}/chatFlows/${id}/steps/${s.id}/options`, o.id);
          try { await deleteDoc(ref); } catch(_) {}
        }
        try { await deleteDoc(doc(db, `salons/${chatUserProfile.salonId}/chatFlows/${id}/steps`, s.id)); } catch(_) {}
      }
    }
    if (chatEditingFlowId === id) window.cancelEditChatFlow();
    await deleteDoc(doc(db, `salons/${chatUserProfile.salonId}/chatFlows`, id));
    await loadChatFlows();
    _renderFlowsAdminList();
  } catch(e) {
    console.error('[Chat] delete flow error', e);
    const msg = 'Failed to delete: ' + (e?.code || e?.message || 'unknown');
    if (typeof window.ffStyledAlert === 'function') window.ffStyledAlert(msg);
    else alert(msg);
  }
};

function _renderFlowsAdminList() {
  const el = document.getElementById('chatFlowsAdminList');
  const countEl = document.getElementById('chatFlowsCountBadge');
  if (countEl) countEl.textContent = String(chatFlows.length || 0);
  if (!el) return;

  if (chatFlows.length === 0) {
    el.innerHTML = `
      <div class="chat-tmpl-bank-empty">
        No flows yet. Use the form above to add your first one.
      </div>`;
    return;
  }

  const editSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
  const delSvg  = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path></svg>';
  const roleShort = r => ({ technician: 'SP', manager: 'M', admin: 'A' }[r] || (r || '').slice(0,2).toUpperCase());

  el.innerHTML = chatFlows.map(f => {
    const idEsc = escHtml(f.id);
    const isEditing = chatEditingFlowId === f.id;
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
  }).join('');
}

function _renderFlowBuilder() {
  if (!chatFlowDraft && !chatEditingFlowId) chatFlowDraft = { title: '', allowedSenders: [], steps: [] };
  if (chatEditingFlowId && !chatFlowDraft) {
    const f = chatFlows.find(x => x.id === chatEditingFlowId);
    if (f) chatFlowDraft = { title: f.title, allowedSenders: f.allowedSenders || [], steps: (f.steps||[]).map(s => ({ ...s, options: s.options||[] })) };
  }
  const list = document.getElementById('chatFlowStepsList');
  if (!list) return;
  const steps = chatFlowDraft?.steps || [];

  function stepOptionsHtml(currentStepId, selectedId) {
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
    return `
    <div class="chat-flow-node" data-step-id="${escHtml(s.id)}" data-depth="0" style="margin-bottom:10px;padding:10px;border:1px solid #ede9fe;border-radius:12px;background:#faf5ff;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;">
        <span style="font-size:12px;font-weight:800;color:#7c3aed;">Question ${idx + 1}</span>
        <button type="button" onclick="window._chatFlowRemoveStepById('${escHtml(s.id)}')" title="Remove question" style="padding:3px 7px;font-size:12px;color:#b91c1c;background:#fef2f2;border:none;border-radius:6px;cursor:pointer;">Remove</button>
      </div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">
        <input type="text" class="chat-flow-step-prompt" data-step-id="${escHtml(s.id)}" placeholder="Question..." value="${escHtml(s.prompt||'')}"
          style="flex:1;padding:7px 8px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;min-width:0;background:#fff;">
      </div>
      <div class="chat-flow-options" data-step-id="${escHtml(s.id)}" style="display:flex;flex-direction:column;gap:6px;">
        ${opts.map((o, oidx) => {
          return `
          <div class="chat-flow-answer-block" data-step-id="${escHtml(s.id)}" data-opt-idx="${oidx}" style="display:grid;grid-template-columns:minmax(150px,1fr) minmax(140px,190px) auto auto;gap:6px;align-items:center;">
            <input type="text" class="chat-flow-opt-label" data-step-id="${escHtml(s.id)}" data-opt-idx="${oidx}" placeholder="Answer" value="${escHtml(o.label||'')}" style="min-width:0;padding:7px 8px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;background:#fff;">
            <select class="chat-flow-next-select" style="min-width:0;padding:7px 8px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;background:#fff;">
              ${stepOptionsHtml(s.id, o.nextStepId || '')}
            </select>
            <button type="button" onclick="window._chatFlowAddStepAndLinkById('${escHtml(s.id)}',${oidx})" style="padding:6px 8px;font-size:11px;font-weight:800;color:#7c3aed;background:#ede9fe;border:none;border-radius:7px;cursor:pointer;white-space:nowrap;">+ Next question</button>
            <button type="button" onclick="window._chatFlowRemoveOptionByIdx('${escHtml(s.id)}',${oidx})" title="Remove answer" style="padding:6px 8px;color:#9ca3af;cursor:pointer;font-size:12px;background:#fff;border:none;border-radius:7px;">×</button>
          </div>
          `;
        }).join('')}
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
  const el = document.getElementById('chatTemplatesAdminList');
  const countEl = document.getElementById('chatTemplatesCountBadge');
  if (countEl) countEl.textContent = String(chatTemplates.length || 0);
  if (!el) return;

  if (chatTemplates.length === 0) {
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

  el.innerHTML = chatTemplates.map(t => {
    const idEsc = escHtml(t.id);
    const isEditing = chatEditingTmplId === t.id;
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
  }).join('');
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
  if (String(id || '').startsWith('shared:')) {
    if (typeof window.ffStyledAlert === 'function') window.ffStyledAlert('Shared templates are managed in Settings → Shared Setup.');
    else alert('Shared templates are managed in Settings → Shared Setup.');
    return;
  }
  const t = chatTemplates.find(x => x.id === id);
  if (!t) return;
  chatEditingTmplId = id;
  document.getElementById('chatTmplTitle').value   = t.title   || '';
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
  chatEditingTmplId = null;
  const titleEl = document.getElementById('chatTmplTitle');
  const msgEl   = document.getElementById('chatTmplMessage');
  if (titleEl) titleEl.value = '';
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
  const title   = document.getElementById('chatTmplTitle')?.value.trim();
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
  const wasEditing = !!chatEditingTmplId;
  if (btn) { btn.disabled = true; }
  _setChatTmplSaveBtn('saving');
  const locKey = _activeLocKey();
  try {
    if (chatEditingTmplId) {
      await updateDoc(doc(db, `salons/${chatUserProfile.salonId}/chatTemplates`, chatEditingTmplId),
        { title, message, allowedSenders, locationId: locKey, updatedAt: serverTimestamp() });
    } else {
      await addDoc(collection(db, `salons/${chatUserProfile.salonId}/chatTemplates`),
        { title, message, allowedSenders, locationId: locKey, order: chatTemplates.length, createdAt: serverTimestamp(), createdBy: chatUserProfile.uid });
    }
    window.cancelEditChatTemplate();
    await loadChatTemplates();
    _renderTmplList();
  } catch(e) {
    console.error('[Chat] save template error', e?.code, e?.message, e);
    const msg = 'Failed to save: ' + (e?.code || e?.message || 'unknown');
    if (typeof window.ffStyledAlert === 'function') window.ffStyledAlert(msg);
    else alert(msg);
  }
  finally {
    if (btn) { btn.disabled = false; }
    _setChatTmplSaveBtn(chatEditingTmplId ? 'update' : 'add');
  }
};
window.deleteChatTemplate = async function(id) {
  if (!_chatManageAllowed()) return;
  if (String(id || '').startsWith('shared:')) {
    if (typeof window.ffStyledAlert === 'function') window.ffStyledAlert('Shared templates are managed in Settings → Shared Setup.');
    else alert('Shared templates are managed in Settings → Shared Setup.');
    return;
  }
  const tmpl = chatTemplates.find(x => x.id === id);
  const titleStr = tmpl?.title ? `"${tmpl.title}"` : 'this template';
  if (!confirm(`Delete ${titleStr}?`)) return;
  try {
    await deleteDoc(doc(db, `salons/${chatUserProfile.salonId}/chatTemplates`, id));
    if (chatEditingTmplId === id) window.cancelEditChatTemplate();
    await loadChatTemplates();
    _renderTmplList();
  } catch(e) {
    console.error('[Chat] delete template error', e?.code, e?.message, e);
    const msg = 'Failed to delete: ' + (e?.code || e?.message || 'unknown');
    if (typeof window.ffStyledAlert === 'function') window.ffStyledAlert(msg);
    else alert(msg);
  }
};

window.ffReloadChatTemplates = async function() {
  await loadChatTemplates();
  await loadChatFlows();
  _renderTmplList();
  _renderFlowsAdminList();
  renderSendOptions();
};

// ─── Settings Section ──────────────────────────────────────────────────────────
async function initChatSettingsSection() {
  if (!chatUserProfile) await loadChatUserProfile();
  const s = document.getElementById('chatSettingsSection');
  if (s) {
    const show =
      typeof window.ffCurrentUserHasChatManagePermission === 'function'
        ? window.ffCurrentUserHasChatManagePermission()
        : isAdmin(chatUserProfile?.role);
    s.style.display = show ? 'block' : 'none';
  }
}

window.ffRefreshChatManageUi = function () {
  try {
    if (chatUserProfile) renderChatHeaderForRole(chatUserProfile.role);
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
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        const p = { uid: user.uid, ...snap.data() };
        if (p.salonId) {
          subscribeToChatBadge(user.uid, p.salonId);
          subscribeToChatToastNotifications(user.uid, p.salonId);
        }
      }
    } catch(e) {}
  } else {
    _chatAuthUid = null;
    _chatAuthSalonId = null;
    if (chatBadgeUnsub) { chatBadgeUnsub(); chatBadgeUnsub = null; }
    if (chatToastUnsub) { chatToastUnsub(); chatToastUnsub = null; }
    _lastChatToastLastMsgMsByConv.clear();
    const badge = document.getElementById('chatNavBadge');
    if (badge) badge.style.display = 'none';
  }
});

// ─── Location-change Listener (per-location chat isolation) ────────────────────
// When the active location changes, tear down every chat listener and
// re-subscribe so the thread list / badge / toasts only surface data that
// belongs to the new location. Legacy conversations (no `locationId`) are
// treated as belonging to the "default" branch so they remain visible there.
if (typeof document !== 'undefined' && !window.__ff_chatLocationListener) {
  window.__ff_chatLocationListener = true;
  document.addEventListener('ff-active-location-changed', () => {
    try {
      console.log('[Chat] location changed → resetting chat state, new loc=', _activeLocKey());
      if (chatConvsUnsub) { chatConvsUnsub(); chatConvsUnsub = null; }
      if (chatMsgsUnsub)  { chatMsgsUnsub();  chatMsgsUnsub  = null; }
      if (chatBadgeUnsub) { chatBadgeUnsub(); chatBadgeUnsub = null; }
      if (chatToastUnsub) { chatToastUnsub(); chatToastUnsub = null; }
      _lastChatToastLastMsgMsByConv.clear();

      allConversations = [];
      currentMessages  = [];
      currentConvId    = null;

      try { renderThreadList(); } catch (_) {}
      try { _renderEmptyConversation(); } catch (_) {}

      const navBadge = document.getElementById('chatNavBadge');
      if (navBadge) { navBadge.textContent = ''; navBadge.style.display = 'none'; }

      // Re-subscribe with the cached auth context (captured by the
      // subscribe* functions on first run). Each internally reads the new
      // active location via _activeLocKey() during the resubscribe.
      if (_chatAuthUid && _chatAuthSalonId) {
        subscribeToChatBadge(_chatAuthUid, _chatAuthSalonId);
        subscribeToChatToastNotifications(_chatAuthUid, _chatAuthSalonId);
      }
      if (chatUserProfile?.salonId) {
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

// ─── Global Exports (no export keywords - avoids parse errors in some envs) ───
window.goToChat = goToChat;
window.initChatSettingsSection = initChatSettingsSection;
