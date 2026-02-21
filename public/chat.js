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
let chatSalonUsers     = [];
let chatConvsUnsub     = null;
let chatMsgsUnsub      = null;
let chatBadgeUnsub     = null;
let chatEditingTmplId  = null;
let chatReplyContext   = null;   // { uid, name, conversationId }
let allConversations   = [];     // kept in sync by onSnapshot
let currentMessages    = [];     // kept in sync by onSnapshot for open conversation
let currentConvId      = null;   // currently open thread

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

// ─── Navigation ───────────────────────────────────────────────────────────────
export function goToChat() {
  ['tasksScreen','inboxScreen'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  ['owner-view'].forEach(id => {
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

  // Split view: thread list stays visible (desktop). On mobile, we start on list.
  currentConvId = null;
  _renderEmptyConversation();
  initChatScreen();
}

async function initChatScreen() {
  await loadChatUserProfile();
  if (!chatUserProfile) return;
  await Promise.all([loadChatSalonUsers(), loadChatTemplates()]);
  setupChatUI();
  subscribeToConversationList();
}

// ─── Profile / Users / Templates ──────────────────────────────────────────────
async function loadChatUserProfile() {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (snap.exists()) chatUserProfile = { uid: user.uid, ...snap.data() };
  } catch(e) { console.warn('[Chat] profile load error', e); }
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

function setupChatUI() {
  const gear = document.getElementById('chatSettingsGearBtn');
  if (gear) gear.style.display = isAdmin(chatUserProfile?.role) ? 'flex' : 'none';
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

    const selected = (currentConvId === convId) ? 'is-selected' : '';
    return `
      <div class="chat-thread-card ${selected} ${unread > 0 ? 'chat-thread-card-unread' : ''}"
           onclick="window._openThread('${escHtml(convId)}')">
        <div class="ctc-avatars">
          <span class="ctc-avatar ctc-avatar-me">${escHtml(myInitial)}</span>
          <span class="ctc-avatar ctc-avatar-other">${escHtml(otherInitial)}</span>
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

  container.innerHTML = msgs.map(ev => {
    const mine = ev.senderUid === uid;
    return `
      <div class="cb-row ${mine ? 'cb-row-mine' : 'cb-row-other'}">
        ${!mine ? `<span class="cb-avatar">${escHtml((ev.senderName||'?').charAt(0).toUpperCase())}</span>` : ''}
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

  // Store other participant for reply
  const conv = allConversations.find(c => c.id === convId);
  const otherUid  = _otherUidFromParticipants(conv?.participants, uid);
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
  await loadChatSalonUsers();

  const role = chatUserProfile.role || '';

  const sendableTemplates = chatTemplates.filter(t => {
    if (!Array.isArray(t.allowedSenders) || t.allowedSenders.length === 0) return true;
    return t.allowedSenders.some(s => s.toLowerCase() === role.toLowerCase());
  });

  const modal         = document.getElementById('chatSendModal');
  const templateList  = document.getElementById('chatSendTemplateList');
  const recipientList = document.getElementById('chatSendRecipientList');
  const sendToSection = document.getElementById('chatSendToSection');
  const pickerBtn     = document.getElementById('chatRecipientPickerBtn');
  const pickerLabel   = document.getElementById('chatRecipientPickerLabel');
  const panel         = document.getElementById('chatRecipientPanel');
  const searchInput   = document.getElementById('chatRecipientSearch');
  if (!modal || !templateList || !recipientList) return;

  modal.querySelector('.chat-modal-title').textContent = title;
  if (sendToSection) sendToSection.style.display = showSendTo ? 'block' : 'none';
  if (!showSendTo && panel) panel.style.display = 'none';

  // Templates
  templateList.innerHTML = sendableTemplates.length === 0
    ? '<div style="padding:16px;color:#6b7280;text-align:center;font-size:14px;">No messages available.<br>Ask an Admin to add templates.</div>'
    : sendableTemplates.map(t => `
        <label class="chat-template-option"
          style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border:1px solid #e5e7eb;border-radius:8px;cursor:pointer;margin-bottom:8px;background:#fff;">
          <input type="radio" name="chatTemplateRadio" value="${escHtml(t.id)}" style="margin-top:3px;accent-color:#7c3aed;">
          <div>
            <div style="font-size:14px;font-weight:600;color:#111827;">${escHtml(t.title)}</div>
            ${t.message ? `<div style="font-size:13px;color:#6b7280;margin-top:2px;">${escHtml(t.message)}</div>` : ''}
          </div>
        </label>
      `).join('');

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
          return `
            <label class="chat-recipient-row" data-search="${escHtml(search)}"
              style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;cursor:pointer;font-size:13px;color:#374151;">
              <input type="checkbox" name="chatRecipient" value="${escHtml(u.uid)}" data-name="${escHtml(displayName)}" style="accent-color:#7c3aed;">
              <span class="chat-rcpt-avatar-sm">${escHtml((displayName||'?').charAt(0).toUpperCase())}</span>
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

  modal.querySelectorAll('input[name="chatTemplateRadio"]').forEach(r =>
    r.addEventListener('change', _updateChatSendBtn)
  );
  if (showSendTo) {
    modal.querySelectorAll('input[name="chatRecipient"]').forEach(r =>
      r.addEventListener('change', _updateChatSendBtn)
    );
    document.getElementById('chatRecipientAll')?.addEventListener('change', _updateChatSendBtn);
  }
}

window._chatToggleAllRecipients = function(checked) {
  document.querySelectorAll('input[name="chatRecipient"]').forEach(cb => { cb.checked = checked; });
  _updateChatSendBtn();
};

function _updateChatSendBtn() {
  const tmpl = !!document.querySelector('input[name="chatTemplateRadio"]:checked');
  let rcpt = true;
  if (!chatReplyContext) {
    rcpt = document.getElementById('chatRecipientAll')?.checked
        || !!document.querySelector('input[name="chatRecipient"]:checked');
  }
  const btn = document.getElementById('chatSendConfirmBtn');
  if (btn) btn.disabled = !(tmpl && rcpt);
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
  const radio    = document.querySelector('input[name="chatTemplateRadio"]:checked');
  if (!radio) { alert('Please select a message.'); return; }
  const template = chatTemplates.find(t => t.id === radio.value);
  if (!template) return;

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
    const title      = template.title;
    const message    = template.message || '';

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

      batch.set(msgRef, {
        templateId: template.id,
        title,
        message,
        senderUid,
        senderName,
        senderRole,
        recipientUid: rUid,
        recipientName: rName,
        sentAt: serverTimestamp(),
        readBy: [senderUid]
      });

      // Update conversation summary + unread count for recipient (merge-safe)
      batch.set(convRef, {
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

// ─── Admin Templates Settings ──────────────────────────────────────────────────
window.openChatTemplatesSettings = async function() {
  if (!chatUserProfile) await loadChatUserProfile();
  if (!isAdmin(chatUserProfile?.role)) return;
  await loadChatTemplates();
  _renderTmplList();
  document.getElementById('chatTemplatesModal').style.display = 'flex';
};
window.closeChatTemplatesModal = function() {
  document.getElementById('chatTemplatesModal').style.display = 'none';
  chatEditingTmplId = null;
};
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
export async function initChatSettingsSection() {
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
        if (p.salonId) subscribeToChatBadge(user.uid, p.salonId);
      }
    } catch(e) {}
  } else {
    if (chatBadgeUnsub) { chatBadgeUnsub(); chatBadgeUnsub = null; }
    const badge = document.getElementById('chatNavBadge');
    if (badge) badge.style.display = 'none';
  }
});

// ─── Global Exports ────────────────────────────────────────────────────────────
window.goToChat = goToChat;
window.initChatSettingsSection = initChatSettingsSection;
