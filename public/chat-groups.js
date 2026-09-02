/**
 * Chat groups — admin-created named conversations (v1).
 * Create only; members are fixed after create (participants stay immutable).
 */
import { doc, setDoc, updateDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { db, auth, storage } from "/app.js?v=20260610_force_lp_ios";
import { chatState } from "./chat-state.js?v=20260901_chat_iso";
import { isMgrPlus, escHtml, _trimStr, _memberDisplayNameFromRow, roleLabel, isChatGroup, chatGroupTitle, chatGroupPhotoUrl, buildConvId } from "./chat-helpers.js?v=20260901_chat_iso";
import { _chatEffectiveLocKey, _chatHasActiveLocationForWrite, loadChatUserProfile, loadChatSalonUsers } from "./chat-data.js?v=20260901_chat_iso";
import {
  _userAllowedInActiveLocation,
  _staffDisplayNameForUid,
  _nameForUid,
  _avatarUrlForUid,
  _conversationById,
  _rememberConversationForList,
  renderThreadList,
  _setConversationHeader,
} from "./chat-ui.js?v=20260901_chat_iso";

const MAX_GROUP_NAME = 80;
const MAX_GROUP_MEMBERS = 40;
const MAX_GROUP_PHOTO_BYTES = 5 * 1024 * 1024;

let _pendingGroupPhotoFile = null;
let _pendingGroupPhotoPreviewUrl = '';
let _photoTargetConvId = '';
let _infoConvId = '';

function _canCreateGroup() {
  return typeof window.ffCurrentUserHasChatManagePermission === 'function'
    && window.ffCurrentUserHasChatManagePermission();
}

function _isManagerLikeMember(u) {
  if (!u) return false;
  const role = String(u.role || '').toLowerCase();
  if (isMgrPlus(role)) return true;
  if (role === 'front_desk' || role === 'assistant_manager') return true;
  if (u.isAdmin === true || u.isManager === true) return true;
  return false;
}

function _memberLabel(u) {
  if (!u) return 'Someone';
  return (
    _memberDisplayNameFromRow(u) ||
    _staffDisplayNameForUid(u.uid) ||
    _trimStr(u.email) ||
    'Someone'
  );
}

function _currentUserAsMember() {
  const p = chatState.chatUserProfile;
  if (!p?.uid) return null;
  return {
    uid: p.uid,
    role: p.role || '',
    displayName: p.displayName || p.name || '',
    name: p.name || p.displayName || '',
    email: p.email || (auth.currentUser && auth.currentUser.email) || '',
  };
}

function _groupMemberPool() {
  const me = _currentUserAsMember();
  const others = (chatState.chatSalonUsers || []).filter(u => u && u.uid && (!me || u.uid !== me.uid));
  const visible = others.filter(u => _userAllowedInActiveLocation(u));
  return me ? [me, ...visible] : visible;
}

function _newGroupId() {
  return `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function _setGroupModalOpen(open) {
  const modal = document.getElementById('chatNewGroupModal');
  if (modal) modal.style.display = open ? 'flex' : 'none';
}

function _imageExt(file) {
  const type = String(file?.type || '').toLowerCase();
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  return 'jpg';
}

function _clearPendingGroupPhoto() {
  _pendingGroupPhotoFile = null;
  if (_pendingGroupPhotoPreviewUrl) {
    try { URL.revokeObjectURL(_pendingGroupPhotoPreviewUrl); } catch (_) {}
    _pendingGroupPhotoPreviewUrl = '';
  }
  const btn = document.getElementById('chatGroupPhotoPickBtn');
  if (btn) {
    btn.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>';
  }
  const input = document.getElementById('chatGroupPhotoInput');
  if (input) input.value = '';
}

function _showPendingGroupPhotoPreview(file) {
  const btn = document.getElementById('chatGroupPhotoPickBtn');
  if (!btn || !file) return;
  if (_pendingGroupPhotoPreviewUrl) {
    try { URL.revokeObjectURL(_pendingGroupPhotoPreviewUrl); } catch (_) {}
  }
  _pendingGroupPhotoPreviewUrl = URL.createObjectURL(file);
  btn.innerHTML = `<img src="${_pendingGroupPhotoPreviewUrl}" alt="Group photo">`;
}

async function _uploadGroupPhoto(salonId, convId, file) {
  if (!salonId || !convId || !file) throw new Error('missing_photo_context');
  if (!file.type || !file.type.startsWith('image/')) throw new Error('invalid_image');
  if (file.size > MAX_GROUP_PHOTO_BYTES) throw new Error('photo_too_large');
  const ext = _imageExt(file);
  const path = `salons/${salonId}/chatGroups/${convId}/photo.${ext}`;
  const fileRef = storageRef(storage, path);
  await uploadBytes(fileRef, file);
  const url = await getDownloadURL(fileRef);
  return { url, path };
}

function _renderGroupMemberList() {
  const list = document.getElementById('chatGroupMemberList');
  if (!list) return;
  const meUid = chatState.chatUserProfile?.uid || '';
  const q = String(document.getElementById('chatGroupMemberSearch')?.value || '').trim().toLowerCase();
  const pool = _groupMemberPool().filter(u => {
    if (!q) return true;
    const hay = `${_memberLabel(u)} ${u.email || ''} ${u.role || ''}`.toLowerCase();
    return hay.includes(q);
  });
  if (!pool.length) {
    list.innerHTML = '<div style="padding:16px 10px;color:#9ca3af;font-size:13px;text-align:center;">No staff found.</div>';
    return;
  }
  list.innerHTML = pool.map(u => {
    const mine = u.uid === meUid;
    const label = _memberLabel(u);
    const role = roleLabel(u.role) || '';
    return `
      <label style="display:flex;align-items:center;gap:10px;padding:8px 6px;border-radius:8px;cursor:${mine ? 'default' : 'pointer'};">
        <input type="checkbox" name="chatGroupMember" value="${escHtml(u.uid)}"
          data-name="${escHtml(label)}" ${mine ? 'checked disabled' : ''}
          style="accent-color:#7c3aed;">
        <span style="min-width:0;flex:1;">
          <span style="display:block;font-size:13px;font-weight:600;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(label)}${mine ? ' (you)' : ''}</span>
          ${role ? `<span style="display:block;font-size:11px;color:#9ca3af;">${escHtml(role)}</span>` : ''}
        </span>
      </label>
    `;
  }).join('');
}

function _selectedGroupUids() {
  const meUid = chatState.chatUserProfile?.uid || '';
  const uids = new Set(meUid ? [meUid] : []);
  document.querySelectorAll('input[name="chatGroupMember"]:checked').forEach(cb => {
    if (cb.value) uids.add(cb.value);
  });
  return [...uids];
}

window.closeChatNewGroupModal = function() {
  _setGroupModalOpen(false);
  const nameEl = document.getElementById('chatGroupNameInput');
  if (nameEl) nameEl.value = '';
  const search = document.getElementById('chatGroupMemberSearch');
  if (search) search.value = '';
  _clearPendingGroupPhoto();
};

window._chatGroupSelectManagers = function() {
  const managers = new Set(
    _groupMemberPool().filter(_isManagerLikeMember).map(u => u.uid)
  );
  const meUid = chatState.chatUserProfile?.uid || '';
  if (meUid) managers.add(meUid);
  document.querySelectorAll('input[name="chatGroupMember"]').forEach(cb => {
    if (cb.disabled) return;
    cb.checked = managers.has(cb.value);
  });
};

window.openChatNewGroupModal = async function() {
  if (!_canCreateGroup()) return;
  if (!chatState.chatUserProfile) await loadChatUserProfile();
  if (!chatState.chatUserProfile) {
    if (typeof window.ffStyledAlert === 'function') {
      window.ffStyledAlert('Unable to open New Group — please refresh and try again.');
    } else {
      alert('Unable to open New Group — please refresh and try again.');
    }
    return;
  }
  await loadChatSalonUsers();
  _renderGroupMemberList();
  _setGroupModalOpen(true);
  const nameEl = document.getElementById('chatGroupNameInput');
  if (nameEl) {
    nameEl.value = '';
    setTimeout(() => nameEl.focus(), 50);
  }
};

window.confirmCreateChatGroup = async function() {
  if (!_canCreateGroup() || !chatState.chatUserProfile?.salonId) return;
  const name = String(document.getElementById('chatGroupNameInput')?.value || '').trim();
  if (!name) {
    alert('Please enter a group name.');
    return;
  }
  if (name.length > MAX_GROUP_NAME) {
    alert(`Group name is too long (max ${MAX_GROUP_NAME} characters).`);
    return;
  }
  const participants = _selectedGroupUids();
  if (participants.length < 2) {
    alert('Select at least one other member.');
    return;
  }
  if (participants.length > MAX_GROUP_MEMBERS) {
    alert(`Groups can have at most ${MAX_GROUP_MEMBERS} members.`);
    return;
  }
  if (!_chatHasActiveLocationForWrite()) {
    alert('Choose a location before creating a group.');
    return;
  }

  const btn = document.getElementById('chatGroupCreateBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Creating…';
  }

  const salonId = chatState.chatUserProfile.salonId;
  const uid = chatState.chatUserProfile.uid;
  const senderName =
    _trimStr(chatState.chatUserProfile.displayName) ||
    _trimStr(chatState.chatUserProfile.name) ||
    (auth.currentUser && (_trimStr(auth.currentUser.displayName) || _trimStr(auth.currentUser.email))) ||
    '';
  const locKey = _chatEffectiveLocKey();
  const convId = _newGroupId();
  const photoFile = _pendingGroupPhotoFile;

  try {
    let photo = null;
    if (photoFile) {
      photo = await _uploadGroupPhoto(salonId, convId, photoFile);
    }
    const photoAt = Date.now();
    await setDoc(doc(db, `salons/${salonId}/conversations`, convId), {
      kind: 'group',
      groupName: name,
      participants,
      createdByUid: uid,
      locationId: locKey,
      unreadFor: {},
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now(),
      lastMessageAt: serverTimestamp(),
      lastMessageAtMs: Date.now(),
      lastTitle: name,
      lastMessage: 'Group created',
      lastSenderUid: uid,
      lastSenderName: senderName,
      lastSenderRole: chatState.chatUserProfile.role || '',
      ...(photo ? {
        groupPhotoUrl: photo.url,
        groupPhotoPath: photo.path,
        groupPhotoUpdatedAtMs: photoAt,
      } : {}),
    });
    _rememberConversationForList({
      id: convId,
      kind: 'group',
      groupName: name,
      participants,
      createdByUid: uid,
      locationId: locKey,
      unreadFor: {},
      lastTitle: name,
      lastMessage: 'Group created',
      lastSenderUid: uid,
      lastSenderName: senderName,
      lastSenderRole: chatState.chatUserProfile.role || '',
      lastMessageAtMs: Date.now(),
      updatedAtMs: Date.now(),
      ...(photo ? {
        groupPhotoUrl: photo.url,
        groupPhotoPath: photo.path,
        groupPhotoUpdatedAtMs: photoAt,
      } : {}),
    });
    window.closeChatNewGroupModal();
    renderThreadList();
    if (typeof window._openThread === 'function') window._openThread(convId);
  } catch (e) {
    console.error('[Chat] create group', e);
    alert('Failed to create group: ' + (e?.code || e?.message || 'unknown'));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Create Group';
    }
  }
};

window.pickNewChatGroupPhoto = function() {
  _photoTargetConvId = '';
  const input = document.getElementById('chatGroupPhotoInput');
  if (input) input.click();
};

window.pickChatGroupPhoto = function(convId) {
  if (!_canCreateGroup()) return;
  const id = String(convId || '').trim();
  if (!id) return;
  _photoTargetConvId = id;
  const input = document.getElementById('chatGroupPhotoInput');
  if (input) input.click();
};

async function _onGroupPhotoPicked(file) {
  if (!file) return;
  if (!file.type || !file.type.startsWith('image/')) {
    alert('Please choose a photo.');
    return;
  }
  if (file.size > MAX_GROUP_PHOTO_BYTES) {
    alert('Photo is too large (max 5MB).');
    return;
  }
  if (!_photoTargetConvId) {
    _pendingGroupPhotoFile = file;
    _showPendingGroupPhotoPreview(file);
    return;
  }
  if (!chatState.chatUserProfile?.salonId) return;
  const convId = _photoTargetConvId;
  _photoTargetConvId = '';
  try {
    const photo = await _uploadGroupPhoto(chatState.chatUserProfile.salonId, convId, file);
    const photoAt = Date.now();
    await updateDoc(doc(db, `salons/${chatState.chatUserProfile.salonId}/conversations`, convId), {
      groupPhotoUrl: photo.url,
      groupPhotoPath: photo.path,
      groupPhotoUpdatedAtMs: photoAt,
      updatedAt: serverTimestamp(),
      updatedAtMs: photoAt,
    });
    _rememberConversationForList({
      id: convId,
      groupPhotoUrl: photo.url,
      groupPhotoPath: photo.path,
      groupPhotoUpdatedAtMs: photoAt,
    });
    renderThreadList();
    if (chatState.currentConvId === convId) _setConversationHeader(convId);
    const infoOpen = document.getElementById('chatGroupInfoModal');
    if (infoOpen && infoOpen.style.display === 'flex') _renderGroupInfo(convId);
  } catch (e) {
    console.error('[Chat] group photo', e);
    alert('Failed to save group photo: ' + (e?.code || e?.message || 'unknown'));
  }
}

function _memberRowForUid(uid) {
  if (!uid) return null;
  if (uid === chatState.chatUserProfile?.uid) return _currentUserAsMember();
  return (chatState.chatSalonUsers || []).find(u => u && u.uid === uid) || { uid };
}

function _paintGroupInfoPhoto(conv) {
  const btn = document.getElementById('chatGroupInfoPhotoBtn');
  if (!btn) return;
  const name = chatGroupTitle(conv);
  const url = chatGroupPhotoUrl(conv);
  const canEdit = _canCreateGroup();
  btn.title = canEdit ? (url ? 'Change group photo' : 'Add group photo') : 'Group photo';
  btn.onclick = canEdit
    ? () => { if (typeof window.pickChatGroupPhoto === 'function') window.pickChatGroupPhoto(conv.id); }
    : null;
  btn.style.cursor = canEdit ? 'pointer' : 'default';
  if (url) {
    btn.innerHTML = `<img src="${escHtml(url)}" alt="">`;
  } else {
    btn.innerHTML = '';
    btn.textContent = (name.charAt(0) || 'G').toUpperCase();
  }
}

function _confirmAction(message, title) {
  if (typeof window.ffStyledConfirm === 'function') return window.ffStyledConfirm(message, title);
  return Promise.resolve(window.confirm(message));
}

function _groupRef(convId) {
  return doc(db, `salons/${chatState.chatUserProfile.salonId}/conversations`, convId);
}

async function _saveGroupFields(convId, fields) {
  const now = Date.now();
  await updateDoc(_groupRef(convId), {
    ...fields,
    updatedAt: serverTimestamp(),
    updatedAtMs: now,
  });
  _rememberConversationForList({ id: convId, ...fields, updatedAtMs: now });
  if (chatState.currentConvId === convId) _setConversationHeader(convId);
  renderThreadList();
}

function _hideGroupAddPanel() {
  const panel = document.getElementById('chatGroupAddPanel');
  if (panel) panel.style.display = 'none';
  const search = document.getElementById('chatGroupAddSearch');
  if (search) search.value = '';
}

function _addableMembers(conv) {
  const existing = new Set((conv?.participants || []).filter(Boolean));
  return _groupMemberPool().filter(u => u && u.uid && !existing.has(u.uid));
}

function _renderGroupAddList() {
  const list = document.getElementById('chatGroupAddList');
  if (!list) return;
  const conv = _conversationById(_infoConvId);
  const q = String(document.getElementById('chatGroupAddSearch')?.value || '').trim().toLowerCase();
  const pool = _addableMembers(conv).filter(u => {
    if (!q) return true;
    return `${_memberLabel(u)} ${u.email || ''} ${u.role || ''}`.toLowerCase().includes(q);
  });
  if (!pool.length) {
    list.innerHTML = '<div style="padding:12px 8px;color:#9ca3af;font-size:13px;text-align:center;">No staff to add.</div>';
    return;
  }
  list.innerHTML = pool.map(u => {
    const label = _memberLabel(u);
    const role = roleLabel(u.role) || '';
    return `
      <label class="chat-group-info-row" style="cursor:pointer;border-bottom:1px solid #f3f4f6;">
        <input type="checkbox" name="chatGroupAddMember" value="${escHtml(u.uid)}" style="accent-color:#7c3aed;">
        <span class="chat-group-info-meta">
          <span class="chat-group-info-name">${escHtml(label)}</span>
          ${role ? `<span class="chat-group-info-role">${escHtml(role)}</span>` : ''}
        </span>
      </label>
    `;
  }).join('');
}

function _renderGroupInfo(convId) {
  const conv = _conversationById(convId);
  if (!isChatGroup(conv)) return;
  _infoConvId = conv.id;
  const meUid = chatState.chatUserProfile?.uid || '';
  const canEdit = _canCreateGroup();
  const nameEl = document.getElementById('chatGroupInfoName');
  const nameInput = document.getElementById('chatGroupInfoNameInput');
  const countEl = document.getElementById('chatGroupInfoCount');
  const list = document.getElementById('chatGroupInfoList');
  const addBtn = document.getElementById('chatGroupInfoAddBtn');
  const deleteBtn = document.getElementById('chatGroupDeleteBtn');
  const name = chatGroupTitle(conv);
  const uids = (conv.participants || []).filter(Boolean);
  if (nameEl) {
    nameEl.textContent = name;
    nameEl.style.display = canEdit ? 'none' : 'block';
  }
  if (nameInput) {
    nameInput.value = name;
    nameInput.style.display = canEdit ? 'block' : 'none';
  }
  if (countEl) countEl.textContent = uids.length === 1 ? '1 participant' : `${uids.length} participants`;
  if (addBtn) addBtn.style.display = canEdit ? 'inline-flex' : 'none';
  if (deleteBtn) deleteBtn.style.display = canEdit ? 'block' : 'none';
  _paintGroupInfoPhoto(conv);
  if (!list) return;
  const orderedUids = [...uids].sort((a, b) => {
    if (a === conv.createdByUid) return -1;
    if (b === conv.createdByUid) return 1;
    if (a === meUid) return -1;
    if (b === meUid) return 1;
    const na = _nameForUid(a) || '';
    const nb = _nameForUid(b) || '';
    return na.localeCompare(nb);
  });
  list.innerHTML = orderedUids.map(uid => {
    const row = _memberRowForUid(uid);
    const label = _nameForUid(uid) || _memberLabel(row) || 'Someone';
    const role = roleLabel(row?.role || (uid === meUid ? chatState.chatUserProfile?.role : '') || '');
    const photo = _avatarUrlForUid(uid);
    const initial = (label.charAt(0) || '?').toUpperCase();
    const isYou = uid === meUid;
    const isCreator = uid && uid === conv.createdByUid;
    const canRemove = canEdit && !isYou && uids.length > 2;
    const badges = [
      isYou ? '<span class="chat-group-info-badge">You</span>' : '',
      isCreator ? '<span class="chat-group-info-badge is-admin">Group admin</span>' : '',
    ].filter(Boolean).join('');
    const avatar = photo
      ? `<span class="chat-group-info-avatar"><img src="${escHtml(photo)}" alt=""></span>`
      : `<span class="chat-group-info-avatar">${escHtml(initial)}</span>`;
    const removeBtn = canRemove
      ? `<button type="button" class="chat-group-info-remove" data-remove-uid="${escHtml(uid)}" aria-label="Remove">Remove</button>`
      : '';
    return `
      <div class="chat-group-info-row${isYou ? '' : ' is-clickable'}" data-member-uid="${escHtml(uid)}">
        ${avatar}
        <span class="chat-group-info-meta">
          <span class="chat-group-info-name">${escHtml(label)} ${badges}</span>
          ${role ? `<span class="chat-group-info-role">${escHtml(role)}</span>` : ''}
        </span>
        ${removeBtn}
      </div>
    `;
  }).join('');
}

window.closeChatGroupInfo = function() {
  const modal = document.getElementById('chatGroupInfoModal');
  if (modal) modal.style.display = 'none';
  _hideGroupAddPanel();
};

window.openChatGroupInfo = async function(convId) {
  const id = String(convId || chatState.currentConvId || '').trim();
  const conv = _conversationById(id);
  if (!isChatGroup(conv)) return;
  if (!chatState.chatUserProfile) await loadChatUserProfile();
  await loadChatSalonUsers();
  _hideGroupAddPanel();
  _renderGroupInfo(id);
  const modal = document.getElementById('chatGroupInfoModal');
  if (modal) modal.style.display = 'flex';
};

window.openChatGroupAddMembers = async function() {
  if (!_canCreateGroup() || !_infoConvId) return;
  await loadChatSalonUsers();
  const panel = document.getElementById('chatGroupAddPanel');
  if (panel) panel.style.display = 'block';
  _renderGroupAddList();
};

window.confirmChatGroupAddMembers = async function() {
  if (!_canCreateGroup() || !_infoConvId || !chatState.chatUserProfile?.salonId) return;
  const conv = _conversationById(_infoConvId);
  if (!isChatGroup(conv)) return;
  const next = new Set((conv.participants || []).filter(Boolean));
  document.querySelectorAll('input[name="chatGroupAddMember"]:checked').forEach(cb => {
    if (cb.value) next.add(cb.value);
  });
  const participants = [...next];
  if (participants.length === (conv.participants || []).length) {
    alert('Select at least one person to add.');
    return;
  }
  if (participants.length > MAX_GROUP_MEMBERS) {
    alert(`Groups can have at most ${MAX_GROUP_MEMBERS} members.`);
    return;
  }
  try {
    await _saveGroupFields(_infoConvId, { participants });
    _hideGroupAddPanel();
    _renderGroupInfo(_infoConvId);
  } catch (e) {
    console.error('[Chat] add group members', e);
    alert('Failed to add members: ' + (e?.code || e?.message || 'unknown'));
  }
};

window.saveChatGroupName = async function() {
  if (!_canCreateGroup() || !_infoConvId) return;
  const name = String(document.getElementById('chatGroupInfoNameInput')?.value || '').trim();
  if (!name) {
    alert('Please enter a group name.');
    return;
  }
  if (name.length > MAX_GROUP_NAME) {
    alert(`Group name is too long (max ${MAX_GROUP_NAME} characters).`);
    return;
  }
  const conv = _conversationById(_infoConvId);
  if (chatGroupTitle(conv) === name) return;
  try {
    await _saveGroupFields(_infoConvId, { groupName: name });
    _renderGroupInfo(_infoConvId);
  } catch (e) {
    console.error('[Chat] rename group', e);
    alert('Failed to rename group: ' + (e?.code || e?.message || 'unknown'));
  }
};

window.openChatWithGroupMember = function(uid) {
  const otherUid = String(uid || '').trim();
  const meUid = chatState.chatUserProfile?.uid || '';
  if (!otherUid || otherUid === meUid) return;
  window.closeChatGroupInfo();
  const convId = buildConvId(meUid, otherUid, _chatEffectiveLocKey());
  if (typeof window._openThread === 'function') window._openThread(convId);
};

window.removeChatGroupMember = async function(uid) {
  if (!_canCreateGroup() || !_infoConvId) return;
  const removeUid = String(uid || '').trim();
  const conv = _conversationById(_infoConvId);
  if (!isChatGroup(conv) || !removeUid) return;
  const label = _nameForUid(removeUid) || 'this person';
  const ok = await _confirmAction(`Remove ${label} from the group?`, 'Remove member');
  if (!ok) return;
  const participants = (conv.participants || []).filter(u => u && u !== removeUid);
  if (participants.length < 2) {
    alert('A group needs at least 2 members.');
    return;
  }
  try {
    await _saveGroupFields(_infoConvId, { participants });
    _renderGroupInfo(_infoConvId);
  } catch (e) {
    console.error('[Chat] remove group member', e);
    alert('Failed to remove member: ' + (e?.code || e?.message || 'unknown'));
  }
};

window.leaveChatGroup = async function() {
  const convId = _infoConvId || chatState.currentConvId;
  const conv = _conversationById(convId);
  const meUid = chatState.chatUserProfile?.uid || '';
  if (!isChatGroup(conv) || !meUid) return;
  const ok = await _confirmAction('Leave this group?', 'Leave group');
  if (!ok) return;
  const participants = (conv.participants || []).filter(u => u && u !== meUid);
  try {
    await _saveGroupFields(convId, { participants });
    window.closeChatGroupInfo();
    if (typeof window.closeConversation === 'function') window.closeConversation();
  } catch (e) {
    console.error('[Chat] leave group', e);
    alert('Failed to leave group: ' + (e?.code || e?.message || 'unknown'));
  }
};

window.deleteChatGroup = async function() {
  if (!_canCreateGroup() || !_infoConvId || !chatState.chatUserProfile?.salonId) return;
  const conv = _conversationById(_infoConvId);
  if (!isChatGroup(conv)) return;
  const ok = await _confirmAction(`Delete "${chatGroupTitle(conv)}"? This cannot be undone.`, 'Delete group');
  if (!ok) return;
  const convId = _infoConvId;
  try {
    await deleteDoc(_groupRef(convId));
    chatState.allConversations = (chatState.allConversations || []).filter(c => c && c.id !== convId);
    chatState.lastNonEmptyConversations = (chatState.lastNonEmptyConversations || []).filter(c => c && c.id !== convId);
    chatState.lastRenderedConversations = (chatState.lastRenderedConversations || []).filter(c => c && c.id !== convId);
    if (chatState.cachedConversationsById) delete chatState.cachedConversationsById[convId];
    window.closeChatGroupInfo();
    if (chatState.currentConvId === convId && typeof window.closeConversation === 'function') {
      window.closeConversation();
    }
    renderThreadList();
  } catch (e) {
    console.error('[Chat] delete group', e);
    alert('Failed to delete group: ' + (e?.code || e?.message || 'unknown'));
  }
};

function _bindGroupModal() {
  const search = document.getElementById('chatGroupMemberSearch');
  if (search && !search.__ffGroupBound) {
    search.__ffGroupBound = true;
    search.addEventListener('input', _renderGroupMemberList);
  }
  const nameEl = document.getElementById('chatGroupNameInput');
  if (nameEl && !nameEl.__ffGroupBound) {
    nameEl.__ffGroupBound = true;
    nameEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (typeof window.confirmCreateChatGroup === 'function') window.confirmCreateChatGroup();
      }
    });
  }
  const photoInput = document.getElementById('chatGroupPhotoInput');
  if (photoInput && !photoInput.__ffGroupBound) {
    photoInput.__ffGroupBound = true;
    photoInput.addEventListener('change', () => {
      const file = photoInput.files && photoInput.files[0];
      photoInput.value = '';
      if (file) _onGroupPhotoPicked(file);
    });
  }
  const nameInput = document.getElementById('chatGroupInfoNameInput');
  if (nameInput && !nameInput.__ffGroupBound) {
    nameInput.__ffGroupBound = true;
    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        nameInput.blur();
      }
    });
    nameInput.addEventListener('blur', () => {
      if (typeof window.saveChatGroupName === 'function') window.saveChatGroupName();
    });
  }
  const addSearch = document.getElementById('chatGroupAddSearch');
  if (addSearch && !addSearch.__ffGroupBound) {
    addSearch.__ffGroupBound = true;
    addSearch.addEventListener('input', _renderGroupAddList);
  }
  const infoList = document.getElementById('chatGroupInfoList');
  if (infoList && !infoList.__ffGroupBound) {
    infoList.__ffGroupBound = true;
    infoList.addEventListener('click', e => {
      const removeBtn = e.target && e.target.closest && e.target.closest('[data-remove-uid]');
      if (removeBtn) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.removeChatGroupMember === 'function') {
          window.removeChatGroupMember(removeBtn.getAttribute('data-remove-uid'));
        }
        return;
      }
      const row = e.target && e.target.closest && e.target.closest('[data-member-uid]');
      const uid = row && row.getAttribute('data-member-uid');
      if (uid && uid !== (chatState.chatUserProfile?.uid || '')) {
        if (typeof window.openChatWithGroupMember === 'function') window.openChatWithGroupMember(uid);
      }
    });
  }
}

export function initChatGroups() {
  _bindGroupModal();
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bindGroupModal, { once: true });
  }
}
