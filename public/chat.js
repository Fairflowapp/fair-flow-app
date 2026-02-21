/**
 * Chat Module — Structured Messages System
 * WhatsApp-style Thread List → Conversation View
 * Messages sent via Admin-defined templates only (no free text).
 *
 * Firestore:
 *   salons/{salonId}/chatTemplates/{templateId}
 *   salons/{salonId}/chatEvents/{eventId}  (+ conversationId field)
 */

import {
  collection, query, orderBy, limit,
  addDoc, updateDoc, doc, getDoc, getDocs, deleteDoc,
  onSnapshot, serverTimestamp, arrayUnion
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { db, auth } from "./app.js";

// ─── State ────────────────────────────────────────────────────────────────────
let chatUserProfile    = null;
let chatTemplates      = [];
let chatSalonUsers     = [];
let chatEventsUnsub    = null;
let chatBadgeUnsub     = null;
let chatEditingTmplId  = null;
let chatReplyContext   = null;   // { uid, name, conversationId }
let allChatEvents      = [];     // kept in sync by onSnapshot
let currentConvId      = null;   // currently open thread

// ─── Helpers ──────────────────────────────────────────────────────────────────
const isAdmin   = r => ['admin','owner'].includes((r||'').toLowerCase());
const isMgrPlus = r => ['manager','admin','owner'].includes((r||'').toLowerCase());
const escHtml   = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const roleLabel = r => ({technician:'Technician',manager:'Manager',admin:'Admin',owner:'Owner'}[(r||'').toLowerCase()] || r || '');
const convIdOf  = ev => {
  if (ev.conversationId) return ev.conversationId;
  if (Array.isArray(ev.recipientUids) && ev.recipientUids.length === 1)
    return [ev.senderUid, ev.recipientUids[0]].sort().join('_');
  return `bc_${ev.id}`;
};
const buildConvId = (a, b) => [a, b].sort().join('_');

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

  document.querySelectorAll('.btn-pill').forEach(b => b.classList.remove('active'));
  document.getElementById('chatBtn')?.classList.add('active');

  currentConvId = null;
  showThreadList();
  initChatScreen();
}

async function initChatScreen() {
  await loadChatUserProfile();
  if (!chatUserProfile) return;
  await Promise.all([loadChatSalonUsers(), loadChatTemplates()]);
  setupChatUI();
  subscribeToChatFeed();
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

// ─── Live Feed Subscription ────────────────────────────────────────────────────
function subscribeToChatFeed() {
  if (!chatUserProfile?.salonId) return;
  if (chatEventsUnsub) { chatEventsUnsub(); chatEventsUnsub = null; }

  const uid  = chatUserProfile.uid;
  const role = chatUserProfile.role || '';

  chatEventsUnsub = onSnapshot(
    query(collection(db, `salons/${chatUserProfile.salonId}/chatEvents`),
          orderBy('sentAt','asc'), limit(300)),
    snap => {
      let evs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (!isMgrPlus(role)) {
        evs = evs.filter(ev =>
          ev.senderUid === uid ||
          (Array.isArray(ev.recipientUids) && ev.recipientUids.includes(uid))
        );
      }
      allChatEvents = evs;
      if (currentConvId) {
        renderConversation(currentConvId);
      } else {
        renderThreadList();
      }
    },
    err => console.error('[Chat] snapshot error', err)
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

  // Group events by convId
  const threadMap = new Map();
  allChatEvents.forEach(ev => {
    const cid = convIdOf(ev);
    if (!threadMap.has(cid)) threadMap.set(cid, []);
    threadMap.get(cid).push(ev);
  });

  if (threadMap.size === 0) {
    if (empty) empty.style.display = 'block';
    list.innerHTML = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  // Sort threads by latest message descending
  const threads = Array.from(threadMap.entries()).sort(([,a],[,b]) => {
    const aMs = a[a.length-1]?.sentAt?.toMillis?.() || 0;
    const bMs = b[b.length-1]?.sentAt?.toMillis?.() || 0;
    return bMs - aMs;
  });

  list.innerHTML = threads.map(([convId, msgs]) => {
    const last    = msgs[msgs.length - 1];
    const unread  = msgs.filter(ev =>
      ev.senderUid !== uid &&
      Array.isArray(ev.recipientUids) && ev.recipientUids.includes(uid) &&
      (!Array.isArray(ev.readBy) || !ev.readBy.includes(uid))
    ).length;

    // Participants: unique senders/recipients names (excluding me)
    const names = new Set();
    msgs.forEach(ev => {
      if (ev.senderUid !== uid) names.add(ev.senderName || 'Unknown');
      if (Array.isArray(ev.recipientNames)) {
        ev.recipientNames.forEach((n, i) => {
          if (ev.recipientUids?.[i] !== uid) names.add(n);
        });
      }
    });
    const otherNames = [...names].filter(Boolean).slice(0, 2).join(', ') || 'Unknown';
    const myInitial  = (chatUserProfile?.name || '?').charAt(0).toUpperCase();
    const otherInitial = otherNames.charAt(0).toUpperCase();

    return `
      <div class="chat-thread-card ${unread > 0 ? 'chat-thread-card-unread' : ''}"
           onclick="window._openThread('${escHtml(convId)}')">
        <div class="ctc-avatars">
          <span class="ctc-avatar ctc-avatar-me">${escHtml(myInitial)}</span>
          <span class="ctc-avatar ctc-avatar-other">${escHtml(otherInitial)}</span>
        </div>
        <div class="ctc-body">
          <div class="ctc-top">
            <span class="ctc-name">${escHtml(otherNames)}</span>
            <span class="ctc-time">${timeAgo(last?.sentAt)}</span>
          </div>
          <div class="ctc-preview">
            ${last?.senderUid === uid ? '<span class="ctc-you">You: </span>' : ''}
            ${escHtml(last?.title || last?.message || '')}
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
  showConversationView(convId);
  renderConversation(convId);
  await markThreadRead(convId);
};

function showThreadList() {
  currentConvId = null;
  const threadList = document.getElementById('chatThreadListWrap');
  const convView   = document.getElementById('chatConvView');
  const topBar     = document.getElementById('chatTopBar');
  if (threadList) threadList.style.display = 'flex';
  if (convView)   convView.style.display   = 'none';
  if (topBar)     topBar.style.display     = 'flex';
}

function showConversationView(convId) {
  const threadList = document.getElementById('chatThreadListWrap');
  const convView   = document.getElementById('chatConvView');
  const topBar     = document.getElementById('chatTopBar');
  if (threadList) threadList.style.display = 'none';
  if (convView)   convView.style.display   = 'flex';
  if (topBar)     topBar.style.display     = 'none';

  // Set header title
  const msgs = allChatEvents.filter(ev => convIdOf(ev) === convId);
  const uid  = chatUserProfile?.uid || '';
  const names = new Set();
  msgs.forEach(ev => {
    if (ev.senderUid !== uid) names.add(ev.senderName || 'Unknown');
  });
  const title = document.getElementById('chatConvTitle');
  if (title) title.textContent = [...names].join(' & ') || 'Conversation';
}

window.closeConversation = function() {
  showThreadList();
  renderThreadList();
};

// ─── Conversation View (bubbles) ───────────────────────────────────────────────
function renderConversation(convId) {
  const msgs = allChatEvents
    .filter(ev => convIdOf(ev) === convId)
    .slice(); // already asc by sentAt from Firestore

  const uid      = chatUserProfile?.uid || '';
  const container= document.getElementById('chatConvMessages');
  if (!container) return;

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
  const otherMsg = msgs.find(ev => ev.senderUid !== uid);
  const otherUid  = otherMsg ? otherMsg.senderUid  : (msgs[0]?.recipientUids?.[0] || '');
  const otherName = otherMsg ? (otherMsg.senderName || '') : (msgs[0]?.recipientNames?.[0] || '');
  const replyBtn  = document.getElementById('chatConvReplyBtn');
  if (replyBtn) {
    replyBtn.setAttribute('data-other-uid',  otherUid);
    replyBtn.setAttribute('data-other-name', otherName);
    replyBtn.setAttribute('data-conv-id',    convId);
  }
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
  const toUpdate = allChatEvents.filter(ev =>
    convIdOf(ev) === convId &&
    Array.isArray(ev.recipientUids) && ev.recipientUids.includes(uid) &&
    (!Array.isArray(ev.readBy) || !ev.readBy.includes(uid))
  );
  await Promise.all(
    toUpdate.map(ev => updateDoc(
      doc(db, `salons/${chatUserProfile.salonId}/chatEvents`, ev.id),
      { readBy: arrayUnion(uid) }
    ).catch(() => {}))
  );
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
  if (!modal || !templateList || !recipientList) return;

  modal.querySelector('.chat-modal-title').textContent = title;
  if (sendToSection) sendToSection.style.display = showSendTo ? 'block' : 'none';

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
    recipientList.innerHTML = pool.length === 0
      ? '<div style="padding:12px;color:#6b7280;font-size:13px;">No recipients available.</div>'
      : `
        <label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;color:#374151;border-bottom:1px solid #f3f4f6;margin-bottom:4px;">
          <input type="checkbox" id="chatRecipientAll" style="accent-color:#7c3aed;" onchange="window._chatToggleAllRecipients(this.checked)">
          Everyone
        </label>
        ${pool.map(u => `
          <label class="chat-recipient-row" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;cursor:pointer;font-size:13px;color:#374151;">
            <input type="checkbox" name="chatRecipient" value="${escHtml(u.uid)}" data-name="${escHtml(u.name||'')}" style="accent-color:#7c3aed;">
            <span class="chat-rcpt-avatar-sm">${escHtml((u.name||'?').charAt(0).toUpperCase())}</span>
            <span style="font-weight:500;">${escHtml(u.name||u.uid)}</span>
            <span style="color:#9ca3af;font-size:12px;">${roleLabel(u.role)}</span>
          </label>
        `).join('')}
      `;
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
}

window.closeSendMessageModal = function() {
  const modal = document.getElementById('chatSendModal');
  if (modal) modal.style.display = 'none';
  chatReplyContext = null;
};

// ─── Confirm Send ──────────────────────────────────────────────────────────────
window.confirmSendChatMessage = async function() {
  if (!chatUserProfile) return;
  const radio    = document.querySelector('input[name="chatTemplateRadio"]:checked');
  if (!radio) { alert('Please select a message.'); return; }
  const template = chatTemplates.find(t => t.id === radio.value);
  if (!template) return;

  let recipientUids = [], recipientNames = [], conversationId;

  if (chatReplyContext) {
    recipientUids  = [chatReplyContext.uid];
    recipientNames = [chatReplyContext.name];
    conversationId = chatReplyContext.conversationId
                  || buildConvId(chatUserProfile.uid, chatReplyContext.uid);
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
    conversationId = recipientUids.length === 1
      ? buildConvId(chatUserProfile.uid, recipientUids[0])
      : `bc_${chatUserProfile.uid}_${Date.now()}`;
  }

  const btn = document.getElementById('chatSendConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

  try {
    await addDoc(collection(db, `salons/${chatUserProfile.salonId}/chatEvents`), {
      templateId:     template.id,
      title:          template.title,
      message:        template.message || '',
      senderUid:      chatUserProfile.uid,
      senderName:     chatUserProfile.name || chatUserProfile.displayName || '',
      senderRole:     chatUserProfile.role || '',
      recipientUids,
      recipientNames,
      conversationId,
      sentAt:         serverTimestamp(),
      readBy:         [chatUserProfile.uid]
    });
    window.closeSendMessageModal();
    // If we're inside a thread, re-open it so bubble appears immediately
    if (conversationId && currentConvId === conversationId) {
      renderConversation(conversationId);
    }
  } catch(e) {
    console.error('[Chat] send error', e);
    alert('Failed to send. Please try again.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
  }
};

// ─── Badge ─────────────────────────────────────────────────────────────────────
export function subscribeToChatBadge(uid, salonId) {
  if (!uid || !salonId) return;
  if (chatBadgeUnsub) { chatBadgeUnsub(); chatBadgeUnsub = null; }
  chatBadgeUnsub = onSnapshot(
    query(collection(db, `salons/${salonId}/chatEvents`),
          orderBy('sentAt','desc'), limit(100)),
    snap => {
      const unread = snap.docs.filter(d => {
        const data = d.data();
        return Array.isArray(data.recipientUids)
          && data.recipientUids.includes(uid)
          && (!Array.isArray(data.readBy) || !data.readBy.includes(uid));
      }).length;
      const badge = document.getElementById('chatNavBadge');
      if (!badge) return;
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.style.display = unread > 0 ? 'inline-flex' : 'none';
    }
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
  } catch(e) { alert('Failed to save.'); }
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
  } catch(e) { alert('Failed to delete.'); }
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
