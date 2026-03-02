/**
 * Chat Module — Structured Messages System
 * WhatsApp-style Thread List → Conversation View
 * Messages sent via Admin-defined templates only (no free text).
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
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { db, auth } from "./app.js";

// ─── State ────────────────────────────────────────────────────────────────────
let chatUserProfile    = null;
let chatTemplates      = [];
let chatFlows          = [];     // { id, title, allowedSenders, startStepId, steps: [{id,prompt,order,options:[{id,label,nextStepId,finish}]}] }
let chatSalonUsers     = [];
let chatConvsUnsub     = null;
let chatMsgsUnsub      = null;
let chatBadgeUnsub     = null;
let chatToastUnsub     = null;
let chatEditingTmplId  = null;
let chatEditingFlowId  = null;
let chatFlowDraft      = null;   // { title, allowedSenders, steps } for builder
let chatReplyContext   = null;   // { uid, name, conversationId }
let allConversations   = [];     // kept in sync by onSnapshot
let currentMessages    = [];     // kept in sync by onSnapshot for open conversation
let currentConvId      = null;   // currently open thread
let chatSendMode       = 'template';
let chatSelectedFlow   = null;
let chatFlowAnswers    = [];     // during wizard: [{ stepId, prompt, optionId, label }]

// ─── Helpers ──────────────────────────────────────────────────────────────────
const isAdmin   = r => ['admin','owner'].includes((r||'').toLowerCase());
const isMgrPlus = r => ['manager','admin','owner'].includes((r||'').toLowerCase());
const escHtml   = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const roleLabel = r => ({technician:'Technician',manager:'Manager',admin:'Admin',owner:'Owner'}[(r||'').toLowerCase()] || r || '');
const buildConvId = (a, b) => [a, b].sort().join('__');

function _nameForUid(uid) {
  if (!uid) return '';
  if (uid === chatUserProfile?.uid) return chatUserProfile?.name || chatUserProfile?.displayName || '';
  const u = chatSalonUsers.find(x => x.uid === uid);
  return (u && (u.name || u.email || u.uid)) || uid;
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

// ─── Header (gear) visibility by role ─────────────────────────────────────────
// Uses chatUserProfile.role (Firestore). Fallback: ff_is_admin_cached from app.js (set on login).
function renderChatHeaderForRole(role) {
  const gear = document.getElementById('chatSettingsGearBtn');
  if (!gear) return;
  const showGear = isAdmin(role) || (role == null && window.ff_is_admin_cached === true);
  gear.style.display = showGear ? 'flex' : 'none';
}

// ─── Navigation ───────────────────────────────────────────────────────────────
async function goToChat() {
  ['tasksScreen','inboxScreen','owner-view'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  ['.joinBar','.wrap'].forEach(sel => {
    const el = document.querySelector(sel);
    if (el) el.style.display = 'none';
  });
  ['queueControls','userProfileScreen'].forEach(id => {
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
  await loadChatUserProfile();
  if (!chatUserProfile) {
    console.error('[Chat] No profile loaded — Gear hidden. Reason: auth.currentUser missing, Firestore doc not found, or load error. See loadChatUserProfile logs.');
    renderChatHeaderForRole(null);
    return;
  }
  await Promise.all([loadChatSalonUsers(), loadChatTemplates(), loadChatFlows()]);
  renderChatHeaderForRole(chatUserProfile.role);
  subscribeToConversationList();
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
  if (!chatUserProfile?.salonId) return;
  try {
    const snap = await getDocs(collection(db, `salons/${chatUserProfile.salonId}/members`));
    chatSalonUsers = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
                              .filter(u => u.uid !== chatUserProfile.uid);
  } catch(e) { chatSalonUsers = []; }
}

async function loadChatTemplates() {
  if (!chatUserProfile?.salonId) return;
  try {
    const snap = await getDocs(query(
      collection(db, `salons/${chatUserProfile.salonId}/chatTemplates`),
      orderBy('order','asc')
    ));
    chatTemplates = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e) { chatTemplates = []; }
}

async function loadChatFlows() {
  if (!chatUserProfile?.salonId) return;
  try {
    const flowsSnap = await getDocs(collection(db, `salons/${chatUserProfile.salonId}/chatFlows`));
    const flows = [];
    for (const fd of flowsSnap.docs) {
      const flowData = { id: fd.id, ...fd.data() };
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
    chatFlows = flows;
  } catch(e) { chatFlows = []; }
}

// ─── Conversation List Subscription (PRIVATE) ──────────────────────────────────
function subscribeToConversationList() {
  if (!chatUserProfile?.salonId) return;
  if (chatConvsUnsub) { chatConvsUnsub(); chatConvsUnsub = null; }
  if (chatMsgsUnsub) { chatMsgsUnsub(); chatMsgsUnsub = null; }

  const uid  = chatUserProfile.uid;

  chatConvsUnsub = onSnapshot(
    query(
      collection(db, `salons/${chatUserProfile.salonId}/conversations`),
      where('participants', 'array-contains', uid)
    ),
    snap => {
      allConversations = snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
    const myInitial  = (chatUserProfile?.name || '?').charAt(0).toUpperCase();
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

  if (msgs.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af;font-size:14px;">No messages yet.</div>';
    return;
  }

  const conv = allConversations.find(c => c.id === convId);
  const otherUid = _otherUidFromParticipants(conv?.participants, uid);
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
            ${ev.message ? `<div class="cb-body">${escHtml(ev.message)}</div>` : ''}
          </div>
          <span class="cb-time">${fmtTime(ev.sentAt)}</span>
        </div>
      </div>
    `;
  }).join('');

  // Scroll to bottom
  setTimeout(() => { container.scrollTop = container.scrollHeight; }, 50);

  // Store other participant for reply (conv, otherUid already declared above)
  const otherName = _nameForUid(otherUid);
  const replyBtn  = document.getElementById('chatConvReplyBtn');
  if (replyBtn) {
    replyBtn.setAttribute('data-other-uid',  otherUid);
    replyBtn.setAttribute('data-other-name', otherName);
    replyBtn.setAttribute('data-conv-id',    convId);
  }
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
}

// ─── Reply from inside thread ──────────────────────────────────────────────────
window.openThreadReply = async function() {
  const btn      = document.getElementById('chatConvReplyBtn');
  const otherUid = btn?.getAttribute('data-other-uid')  || '';
  const otherName= btn?.getAttribute('data-other-name') || '';
  const convId   = btn?.getAttribute('data-conv-id')    || currentConvId;

  chatReplyContext = { uid: otherUid, name: otherName, conversationId: convId };
  await _openChatModal({ title: `↩ Reply to ${otherName || otherUid}`, showSendTo: false });
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
  chatReplyContext = null;
  await _openChatModal({ title: 'New Message', showSendTo: true });
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

  const role = (chatUserProfile.role || '').toLowerCase();
  const roleForFilter = role === 'staff' ? 'technician' : role;

  const sendableTemplates = chatTemplates.filter(t => {
    if (!Array.isArray(t.allowedSenders) || t.allowedSenders.length === 0) return true;
    return t.allowedSenders.some(s => s.toLowerCase() === roleForFilter);
  });
  const sendableFlows = chatFlows.filter(f => {
    if (!Array.isArray(f.allowedSenders) || f.allowedSenders.length === 0) return true;
    return f.allowedSenders.some(s => s.toLowerCase() === roleForFilter);
  });

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

  if (items.length === 0) {
    messageList.innerHTML = '<div style="padding:16px;color:#6b7280;text-align:center;font-size:14px;">No messages available.<br>Ask an Admin to add messages.</div>';
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
    const pool = isMgrPlus(role) ? chatSalonUsers : chatSalonUsers.filter(u => isMgrPlus(u.role));
    // Reset UI
    if (searchInput) searchInput.value = '';
    if (panel) panel.style.display = 'none';
    const allCb = document.getElementById('chatRecipientAll');
    if (allCb) allCb.checked = false;

    recipientList.innerHTML = pool.length === 0
      ? '<div style="padding:10px;color:#6b7280;font-size:13px;">No recipients available.</div>'
      : pool.map(u => {
          const displayName = (u.name || u.email || u.uid || '').trim();
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
  const radio = document.querySelector('input[name="chatMessageRadio"]:checked');
  if (chatSendMode === 'flow') {
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
  } else {
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
  const firstName = checked[0].getAttribute('data-name') || checked[0].value;
  label.textContent = checked.length === 1 ? firstName : `${firstName} +${checked.length - 1}`;
}

// ─── Confirm Send ──────────────────────────────────────────────────────────────
window.confirmSendChatMessage = async function() {
  if (!chatUserProfile) return;
  let title, message, templateId = null, flowId = null, flowTitle = null, flowAnswers = null, renderedText = null;

  if (chatSendMode === 'flow' && chatSelectedFlow && chatFlowAnswers?.length) {
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
      recipientNames = pool.map(u => u.name || u.uid);
    } else {
      document.querySelectorAll('input[name="chatRecipient"]:checked').forEach(cb => {
        recipientUids.push(cb.value);
        recipientNames.push(cb.getAttribute('data-name') || cb.value);
      });
    }
    if (!recipientUids.length) { alert('Please select at least one recipient.'); return; }
  }

  const btn = document.getElementById('chatSendConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

  try {
    const salonId = chatUserProfile.salonId;
    const senderUid  = chatUserProfile.uid;
    const senderName = chatUserProfile.name || chatUserProfile.displayName || '';
    const senderRole = chatUserProfile.role || '';

    for (let i = 0; i < recipientUids.length; i++) {
      const rUid  = recipientUids[i];
      const rName = recipientNames[i] || _nameForUid(rUid) || rUid;
      const convId = chatReplyContext?.conversationId || buildConvId(senderUid, rUid);

      const convRef = doc(db, `salons/${salonId}/conversations`, convId);
      // IMPORTANT: security rules for messages verify participants by reading the
      // conversation doc. So we must ensure the conversation exists BEFORE writing messages.
      await setDoc(
        convRef,
        { participants: [senderUid, rUid].sort(), createdAt: serverTimestamp() },
        { merge: true }
      );

      const msgRef  = doc(collection(db, `salons/${salonId}/conversations/${convId}/messages`));
      const batch   = writeBatch(db);

      const msgData = {
        senderUid, senderName, senderRole, recipientUid: rUid, recipientName: rName,
        sentAt: serverTimestamp(), readBy: [senderUid]
      };
      if (flowId) {
        msgData.flowId = flowId; msgData.flowTitle = flowTitle; msgData.renderedText = renderedText;
        msgData.flowAnswers = flowAnswers; msgData.title = title; msgData.message = renderedText;
      } else {
        msgData.templateId = templateId; msgData.title = title; msgData.message = message;
      }
      batch.set(msgRef, msgData);

      // Update conversation summary + unread count for recipient (merge-safe)
      batch.set(convRef, {
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
      }, { merge: true });

      await batch.commit();
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
export function subscribeToChatBadge(uid, salonId) {
  if (!uid || !salonId) return;
  if (chatBadgeUnsub) { chatBadgeUnsub(); chatBadgeUnsub = null; }
  chatBadgeUnsub = onSnapshot(
    query(
      collection(db, `salons/${salonId}/conversations`),
      where('participants', 'array-contains', uid)
    ),
    snap => {
      const unread = snap.docs.reduce((sum, d) => {
        const data = d.data() || {};
        const n = (data.unreadFor && data.unreadFor[uid]) ? Number(data.unreadFor[uid]) : 0;
        return sum + (isNaN(n) ? 0 : n);
      }, 0);
      const badge = document.getElementById('chatNavBadge');
      if (!badge) return;
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.style.display = unread > 0 ? 'inline-flex' : 'none';
    }
  );
}

// ─── Toast Notifications ───────────────────────────────────────────────────────
const CHAT_TOAST_DURATION_MS = 5000;

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
  if (chatToastUnsub) { chatToastUnsub(); chatToastUnsub = null; }
  chatToastUnsub = onSnapshot(
    query(
      collection(db, `salons/${salonId}/conversations`),
      where('participants', 'array-contains', myUid)
    ),
    snap => {
      snap.docChanges().forEach(change => {
        if (change.type !== 'modified') return;
        const data = change.doc.data() || {};
        const convId = change.doc.id;
        const lastSenderUid = data.lastSenderUid;
        if (!lastSenderUid || lastSenderUid === myUid) return;
        if (currentConvId === convId && isChatScreenVisible()) return;
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
  if (!chatUserProfile) await loadChatUserProfile();
  if (!isAdmin(chatUserProfile?.role)) return;
  await loadChatTemplates();
  await loadChatFlows();
  _renderTmplList();
  _chatSettingsTab('templates');
  document.getElementById('chatTemplatesModal').style.display = 'flex';
};
window.closeChatTemplatesModal = function() {
  document.getElementById('chatTemplatesModal').style.display = 'none';
  chatEditingTmplId = null;
  chatEditingFlowId = null;
  chatFlowDraft = null;
};

window._chatSettingsTab = function(tab) {
  document.querySelectorAll('.chat-settings-tab').forEach(b => { b.classList.remove('active'); });
  const t = document.getElementById('chatSettingsTab' + (tab === 'templates' ? 'Templates' : 'Flows'));
  if (t) t.classList.add('active');
  document.getElementById('chatSettingsTemplatesPane').style.display = tab === 'templates' ? 'flex' : 'none';
  const fp = document.getElementById('chatSettingsFlowsPane');
  if (fp) {
    fp.style.display = tab === 'flows' ? 'flex' : 'none';
    if (tab === 'flows') {
      _renderFlowsAdminList();
      _renderFlowBuilder();
    }
  }
};

window._chatFlowAddStep = function() {
  _syncFlowDraftFromUI();
  if (!chatFlowDraft) chatFlowDraft = { title: '', allowedSenders: [], steps: [] };
  if (!chatFlowDraft.steps) chatFlowDraft.steps = [];
  const id = 's' + Date.now();
  chatFlowDraft.steps.push({ id, prompt: '', order: 0, options: [{ id: 'o' + Date.now(), label: '', finish: true }] });
  _renderFlowBuilder();
};

window._chatFlowRemoveStep = function(idx) {
  _syncFlowDraftFromUI();
  if (chatFlowDraft?.steps?.[idx] === undefined) return;
  chatFlowDraft.steps.splice(idx, 1);
  _renderFlowBuilder();
};

window._chatFlowRemoveStepById = function(stepId) {
  _syncFlowDraftFromUI();
  const idx = chatFlowDraft?.steps?.findIndex(s => s.id === stepId);
  if (idx === undefined || idx < 0) return;
  chatFlowDraft.steps.splice(idx, 1);
  _renderFlowBuilder();
};

window._chatFlowAddOption = function(stepIdx) {
  _syncFlowDraftFromUI();
  if (!chatFlowDraft?.steps?.[stepIdx]) return;
  const step = chatFlowDraft.steps[stepIdx];
  if (!step.options) step.options = [];
  step.options.push({ id: 'o' + Date.now(), label: '', finish: true });
  _renderFlowBuilder();
};

window._chatFlowAddOptionById = function(stepId) {
  _syncFlowDraftFromUI();
  const step = chatFlowDraft?.steps?.find(s => s.id === stepId);
  if (!step) return;
  if (!step.options) step.options = [];
  step.options.push({ id: 'o' + Date.now(), label: '', finish: true });
  _renderFlowBuilder();
};

window._chatFlowRemoveOption = function(stepIdx, optIdx) {
  _syncFlowDraftFromUI();
  if (!chatFlowDraft?.steps?.[stepIdx]?.options) return;
  chatFlowDraft.steps[stepIdx].options.splice(optIdx, 1);
  _renderFlowBuilder();
};

window._chatFlowRemoveOptionByIdx = function(stepId, optIdx) {
  _syncFlowDraftFromUI();
  const step = chatFlowDraft?.steps?.find(s => s.id === stepId);
  if (!step?.options) return;
  step.options.splice(optIdx, 1);
  _renderFlowBuilder();
};

// Add a new step and link the given option to it (for branching)
window._chatFlowAddStepAndLink = function(stepIdx, optIdx) {
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
  _syncFlowDraftFromUI();
  const step = chatFlowDraft?.steps?.find(s => s.id === stepId);
  const opt = step?.options?.[optIdx];
  if (!opt) return;
  opt.nextStepId = null;
  opt.finish = true;
  _renderFlowBuilder();
};

// Collect steps from tree DOM (depth-first, root first)
function _collectStepsFromTreeDOM() {
  const steps = [];
  const seen = new Set();
  function collect(node) {
    if (!node || node.classList?.contains?.('chat-flow-answer-block')) return;
    const stepId = node.getAttribute?.('data-step-id');
    if (!stepId || seen.has(stepId)) return;
    seen.add(stepId);
    const promptEl = node.querySelector?.('.chat-flow-step-prompt');
    const prompt = (promptEl?.value ?? '').trim();
    const options = [];
    const nestedNodes = [];
    const optsContainer = node.querySelector?.('.chat-flow-options');
    if (optsContainer) {
      Array.from(optsContainer.children || []).filter(c => c.classList?.contains?.('chat-flow-answer-block')).forEach((block, oidx) => {
        const labelEl = block.querySelector?.('.chat-flow-opt-label');
        const label = (labelEl?.value ?? '').trim();
        const nestedNode = block.querySelector?.('.chat-flow-node');
        const nextStepId = nestedNode?.getAttribute?.('data-step-id') || null;
        const existingStep = chatFlowDraft?.steps?.find(s => s.id === stepId);
        const existingOpt = existingStep?.options?.[oidx];
        options.push({
          id: existingOpt?.id || 'o' + Date.now() + '_' + oidx,
          label,
          nextStepId: nextStepId || null,
          finish: !nextStepId
        });
        if (nestedNode) nestedNodes.push(nestedNode);
      });
    }
    steps.push({ id: stepId, prompt, order: steps.length, options });
    nestedNodes.forEach(n => collect(n));
  }
  document.querySelectorAll?.('#chatFlowStepsList > .chat-flow-node').forEach(collect);
  return steps;
}

// Sync current form values from DOM into chatFlowDraft (tree structure)
function _syncFlowDraftFromUI() {
  if (!chatFlowDraft) chatFlowDraft = { title: '', allowedSenders: [], steps: [] };
  chatFlowDraft.title = document.getElementById('chatFlowTitle')?.value ?? '';
  chatFlowDraft.allowedSenders = ['technician','manager','admin'].filter((_, i) =>
    document.getElementById(['chatFlowSenderTech','chatFlowSenderMgr','chatFlowSenderAdmin'][i])?.checked);
  const treeNodes = document.querySelectorAll?.('.chat-flow-node');
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
  const steps = [];
  const stepIds = new Set();
  function collect(node) {
    const stepId = node.getAttribute?.('data-step-id');
    if (!stepId || stepIds.has(stepId)) return;
    stepIds.add(stepId);
    const promptEl = node.querySelector?.('.chat-flow-step-prompt');
    const prompt = (promptEl?.value ?? '').trim();
    const options = [];
    const nestedNodes = [];
    const optsContainer = node.querySelector?.('.chat-flow-options');
    if (optsContainer) {
      Array.from(optsContainer.children || []).filter(c => c.classList?.contains?.('chat-flow-answer-block')).forEach((block) => {
        const labelEl = block.querySelector?.('.chat-flow-opt-label');
        const label = (labelEl?.value ?? '').trim();
        const nestedNode = block.querySelector?.('.chat-flow-node');
        const nextStepId = nestedNode?.getAttribute?.('data-step-id') || null;
        const step = chatFlowDraft.steps.find(s => s.id === stepId);
        const oidx = options.length;
        options.push({
          id: step?.options?.[oidx]?.id || 'o' + Date.now() + oidx,
          label,
          nextStepId: nextStepId || null,
          finish: !nextStepId
        });
        if (nestedNode) nestedNodes.push(nestedNode);
      });
    }
    steps.push({ id: stepId, prompt, order: steps.length, options });
    nestedNodes.forEach(n => collect(n));
  }
  treeNodes.forEach(n => collect(n));
  if (steps.length === 0) return null;
  const root = steps[0];
  if (!root?.prompt?.trim()) { alert('Please fill in the first question.'); return null; }
  if (!root?.options?.length || root.options.every(o => !(o.label || '').trim())) { alert('Please add at least one answer to the first question.'); return null; }
  return { title, allowedSenders, steps };
}

window.saveChatFlow = async function() {
  const draft = _collectFlowDraftFromUI();
  if (!draft) { alert('Please add at least one step with options, and fill flow title.'); return; }
  const btn = document.getElementById('chatFlowSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const salonId = chatUserProfile.salonId;
    const flowsRef = collection(db, `salons/${salonId}/chatFlows`);
    let flowId = chatEditingFlowId;
    if (flowId) {
      await updateDoc(doc(db, `salons/${salonId}/chatFlows`, flowId), {
        title: draft.title, allowedSenders: draft.allowedSenders, updatedAt: serverTimestamp()
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
        title: draft.title, allowedSenders: draft.allowedSenders, status: 'active',
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
    alert('Saved! Flow appears in the list above.');
    document.getElementById('chatFlowsSavedSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch(e) {
    console.error('[Chat] save flow error', e);
    alert('Failed to save: ' + (e?.code || e?.message || 'unknown'));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = chatEditingFlowId ? 'Update Flow' : 'Create Flow'; }
  }
};

window.cancelEditChatFlow = function() {
  chatEditingFlowId = null;
  chatFlowDraft = { title: '', allowedSenders: [], steps: [] };
  document.getElementById('chatFlowTitle').value = '';
  ['chatFlowSenderTech','chatFlowSenderMgr','chatFlowSenderAdmin'].forEach(id => {
    const cb = document.getElementById(id);
    if (cb) cb.checked = false;
  });
  document.getElementById('chatFlowFormLabel').textContent = 'Create Flow';
  document.getElementById('chatFlowSaveBtn').textContent = 'Create Flow';
  document.getElementById('chatFlowCancelBtn').style.display = 'none';
  _renderFlowBuilder();
  _renderFlowsAdminList();
};

window.editChatFlow = function(id) {
  const f = chatFlows.find(x => x.id === id);
  if (!f) return;
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
  document.getElementById('chatFlowFormLabel').textContent = 'Edit Flow';
  document.getElementById('chatFlowSaveBtn').textContent = 'Update Flow';
  document.getElementById('chatFlowCancelBtn').style.display = 'inline-block';
  _renderFlowBuilder();
};

window.deleteChatFlow = async function(id) {
  if (!confirm('Delete this flow?')) return;
  try {
    const flow = chatFlows.find(x => x.id === id);
    if (flow?.steps) {
      for (const s of flow.steps) {
        if (s.options) for (const o of s.options) {
          const ref = doc(db, `salons/${chatUserProfile.salonId}/chatFlows/${id}/steps/${s.id}/options`, o.id);
          try { await deleteDoc(ref); } catch(_) {}
        }
        try { await deleteDoc(doc(db, `salons/${chatUserProfile.salonId}/chatFlows/${id}/steps`, s.id)); } catch(_) {}
      }
    }
    await deleteDoc(doc(db, `salons/${chatUserProfile.salonId}/chatFlows`, id));
    await loadChatFlows();
    _renderFlowsAdminList();
  } catch(e) {
    console.error('[Chat] delete flow error', e);
    alert('Failed to delete: ' + (e?.code || e?.message || 'unknown'));
  }
};

function _renderFlowsAdminList() {
  const el = document.getElementById('chatFlowsAdminList');
  if (!el) return;
  el.innerHTML = chatFlows.length === 0
    ? '<div style="padding:12px;color:#6b7280;font-size:13px;">No saved flows. Fill in below and click Create Flow — it will appear here.</div>'
    : chatFlows.map(f => `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;background:#fff;">
          <div style="flex:1;">
            <div style="font-size:14px;font-weight:600;color:#111827;">${escHtml(f.title)}</div>
            <div style="font-size:11px;color:#9ca3af;">${(f.steps||[]).length} steps · Can use: ${Array.isArray(f.allowedSenders) && f.allowedSenders.length ? f.allowedSenders.map(roleLabel).join(', ') : 'Everyone'}</div>
          </div>
          <div style="display:flex;gap:6px;">
            <button type="button" onclick="window.editChatFlow('${escHtml(f.id)}')" style="padding:6px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:12px;">Edit</button>
            <button type="button" onclick="window.deleteChatFlow('${escHtml(f.id)}')" style="padding:6px 12px;border:1px solid #fca5a5;border-radius:6px;background:#fff;cursor:pointer;font-size:12px;color:#b91c1c;">Delete</button>
          </div>
        </div>
      `).join('');
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

  function renderStepNode(s, depth, parentStepId, parentOptIdx) {
    if (!s) return '';
    const indent = depth * 20;
    const opts = s.options || [];
    const isNested = parentStepId != null;
    return `
    <div class="chat-flow-node" data-step-id="${escHtml(s.id)}" data-depth="${depth}" style="margin-left:${indent}px;margin-bottom:1px;">
      <div style="display:flex;gap:4px;align-items:center;padding:3px 6px;border-left:2px solid #c4b5fd;border-radius:2px;background:#faf5ff;margin-bottom:2px;">
        <span style="font-size:10px;font-weight:600;color:#7c3aed;">Q</span>
        <input type="text" class="chat-flow-step-prompt" data-step-id="${escHtml(s.id)}" placeholder="Question..." value="${escHtml(s.prompt||'')}"
          style="flex:1;padding:2px 5px;border:1px solid #e5e7eb;border-radius:2px;font-size:11px;min-width:0;">
        ${isNested ? `<button type="button" onclick="window._chatFlowUnlinkStep('${escHtml(parentStepId)}',${parentOptIdx})" title="Remove branch" style="padding:1px 4px;font-size:9px;color:#6b7280;background:#f3f4f6;border:none;border-radius:2px;cursor:pointer;">−</button>` : `<button type="button" onclick="window._chatFlowRemoveStepById('${escHtml(s.id)}')" title="Delete" style="padding:1px 5px;font-size:9px;color:#b91c1c;background:#fef2f2;border:none;border-radius:2px;cursor:pointer;">×</button>`}
      </div>
      <div class="chat-flow-options" data-step-id="${escHtml(s.id)}" style="margin-left:12px;">
        ${opts.map((o, oidx) => {
          const nextStep = o.nextStepId ? steps.find(x => x.id === o.nextStepId) : null;
          return `
          <div class="chat-flow-answer-block" data-step-id="${escHtml(s.id)}" data-opt-idx="${oidx}" style="margin-bottom:1px;">
            <div class="chat-flow-option-row" style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;padding:2px 0;">
              <span style="color:#059669;font-size:10px;">→</span>
              <input type="text" class="chat-flow-opt-label" data-step-id="${escHtml(s.id)}" data-opt-idx="${oidx}" placeholder="Answer" value="${escHtml(o.label||'')}" style="min-width:70px;padding:2px 5px;border:1px solid #e5e7eb;border-radius:2px;font-size:11px;">
              ${nextStep
                ? `<button type="button" onclick="window._chatFlowUnlinkStep('${escHtml(s.id)}',${oidx})" title="Remove branch" style="padding:1px 4px;font-size:9px;color:#6b7280;background:#f3f4f6;border:none;border-radius:2px;cursor:pointer;">−</button>`
                : `<button type="button" onclick="window._chatFlowAddStepAndLinkById('${escHtml(s.id)}',${oidx})" style="padding:1px 5px;font-size:9px;color:#7c3aed;background:#ede9fe;border:none;border-radius:2px;cursor:pointer;">↳ Add next question</button>`}
              <button type="button" onclick="window._chatFlowRemoveOptionByIdx('${escHtml(s.id)}',${oidx})" title="Remove answer" style="padding:1px 4px;color:#9ca3af;cursor:pointer;font-size:9px;background:none;border:none;">×</button>
            </div>
            ${nextStep ? `<div style="margin-left:16px;margin-top:1px;border-left:1px solid #e5e7eb;">${renderStepNode(nextStep, depth + 1, s.id, oidx)}</div>` : ''}
          </div>
          `;
        }).join('')}
        <button type="button" class="chat-flow-add-opt" data-step-id="${escHtml(s.id)}" onclick="window._chatFlowAddOptionById('${escHtml(s.id)}')" style="margin:1px 0;padding:1px 5px;font-size:9px;color:#7c3aed;background:none;border:none;cursor:pointer;">+ Add answer</button>
      </div>
    </div>
    `;
  }

  const rootStep = steps[0];
  const stepHtml = rootStep ? renderStepNode(rootStep, 0, null, null) : '';
  list.innerHTML = stepHtml || '<div style="color:#9ca3af;font-size:12px;padding:8px;">No questions yet. Click "+ Add first question" below.</div>';

  const addBtn = document.getElementById('chatFlowAddStepBtn');
  if (addBtn) addBtn.style.display = steps.length ? 'none' : 'inline-block';
}

function _renderTmplList() {
  const el = document.getElementById('chatTemplatesAdminList');
  if (!el) return;
  el.innerHTML = chatTemplates.length === 0
    ? '<div style="padding:16px;text-align:center;color:#9ca3af;font-size:14px;">No templates yet.</div>'
    : chatTemplates.map(t => `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;background:#fff;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:600;color:#111827;">${escHtml(t.title)}</div>
            ${t.message ? `<div style="font-size:13px;color:#6b7280;margin-bottom:4px;">${escHtml(t.message)}</div>` : ''}
            <div style="font-size:11px;color:#9ca3af;">Can send: ${
              Array.isArray(t.allowedSenders) && t.allowedSenders.length
                ? t.allowedSenders.map(roleLabel).join(', ') : 'Everyone'
            }</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            <button type="button" onclick="window.editChatTemplate('${escHtml(t.id)}')"
              style="padding:6px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:12px;color:#374151;">Edit</button>
            <button type="button" onclick="window.deleteChatTemplate('${escHtml(t.id)}')"
              style="padding:6px 12px;border:1px solid #fca5a5;border-radius:6px;background:#fff;cursor:pointer;font-size:12px;color:#b91c1c;">Delete</button>
          </div>
        </div>
      `).join('');
}
window.editChatTemplate = function(id) {
  const t = chatTemplates.find(x => x.id === id);
  if (!t) return;
  chatEditingTmplId = id;
  document.getElementById('chatTmplTitle').value   = t.title   || '';
  document.getElementById('chatTmplMessage').value = t.message || '';
  ['Tech','Mgr','Admin'].forEach((s,i) => {
    const cb = document.getElementById(`chatTmplSender${s}`);
    if (cb) cb.checked = Array.isArray(t.allowedSenders) && t.allowedSenders.includes(['technician','manager','admin'][i]);
  });
  document.getElementById('chatTmplSaveBtn').textContent   = 'Update Template';
  document.getElementById('chatTmplFormLabel').textContent = 'Edit Template';
  document.getElementById('chatTmplForm')?.scrollIntoView({ behavior:'smooth' });
};
window.cancelEditChatTemplate = function() {
  chatEditingTmplId = null;
  document.getElementById('chatTmplTitle').value   = '';
  document.getElementById('chatTmplMessage').value = '';
  ['Tech','Mgr','Admin'].forEach(s => {
    const cb = document.getElementById(`chatTmplSender${s}`);
    if (cb) cb.checked = false;
  });
  document.getElementById('chatTmplSaveBtn').textContent   = 'Create Template';
  document.getElementById('chatTmplFormLabel').textContent = 'Create Structured Message Template';
};
window.saveChatTemplate = async function() {
  const title   = document.getElementById('chatTmplTitle')?.value.trim();
  const message = document.getElementById('chatTmplMessage')?.value.trim() || '';
  const allowedSenders = ['technician','manager','admin'].filter((_,i) => {
    return document.getElementById(`chatTmplSender${['Tech','Mgr','Admin'][i]}`)?.checked;
  });
  if (!title) { alert('Please enter a title.'); return; }
  const btn = document.getElementById('chatTmplSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    if (chatEditingTmplId) {
      await updateDoc(doc(db, `salons/${chatUserProfile.salonId}/chatTemplates`, chatEditingTmplId),
        { title, message, allowedSenders, updatedAt: serverTimestamp() });
    } else {
      await addDoc(collection(db, `salons/${chatUserProfile.salonId}/chatTemplates`),
        { title, message, allowedSenders, order: chatTemplates.length, createdAt: serverTimestamp(), createdBy: chatUserProfile.uid });
    }
    window.cancelEditChatTemplate();
    await loadChatTemplates();
    _renderTmplList();
  } catch(e) {
    console.error('[Chat] save template error', e?.code, e?.message, e);
    alert('Failed to save: ' + (e?.code || e?.message || 'unknown'));
  }
  finally {
    if (btn) { btn.disabled = false; btn.textContent = chatEditingTmplId ? 'Update Template' : 'Create Template'; }
  }
};
window.deleteChatTemplate = async function(id) {
  if (!confirm('Delete this template?')) return;
  try {
    await deleteDoc(doc(db, `salons/${chatUserProfile.salonId}/chatTemplates`, id));
    await loadChatTemplates();
    _renderTmplList();
  } catch(e) {
    console.error('[Chat] delete template error', e?.code, e?.message, e);
    alert('Failed to delete: ' + (e?.code || e?.message || 'unknown'));
  }
};

// ─── Settings Section ──────────────────────────────────────────────────────────
async function initChatSettingsSection() {
  if (!chatUserProfile) await loadChatUserProfile();
  const s = document.getElementById('chatSettingsSection');
  if (s) s.style.display = isAdmin(chatUserProfile?.role) ? 'block' : 'none';
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
    if (chatBadgeUnsub) { chatBadgeUnsub(); chatBadgeUnsub = null; }
    if (chatToastUnsub) { chatToastUnsub(); chatToastUnsub = null; }
    const badge = document.getElementById('chatNavBadge');
    if (badge) badge.style.display = 'none';
  }
});

// ─── Global Exports (no export keywords - avoids parse errors in some envs) ───
window.goToChat = goToChat;
window.initChatSettingsSection = initChatSettingsSection;
