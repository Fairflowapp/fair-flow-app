/**
 * Chat Data Layer — Firestore reads + per-location scoping.
 * Extracted verbatim from chat.js. Pure data access: writes to chatState or
 * returns values; no DOM, no back-edges into chat.js. (Message writers and the
 * realtime subscriptions stay in chat.js for now — they couple to core helpers.)
 */

import {
  collection, query, orderBy, getDocs, getDoc, doc
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import {
  CHAT_DEFAULT_LOC_KEY,
  _chatSortByOrder,
  _convLocKey,
} from "./chat-helpers.js?v=20260901_chat_iso";
import { chatState } from "./chat-state.js?v=20260901_chat_iso";

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
function _activeLocKey() {
  const raw = _readActiveLocationId();
  return raw ? raw : CHAT_DEFAULT_LOC_KEY;
}

/**
 * Branch key for filtering conversations, badge, and toasts.
 * Always follows the header location switcher — never fall back to "default"
 * while staff is hydrating, or default-location threads leak into every branch.
 */
function _chatEffectiveLocKey() {
  return _activeLocKey();
}

function _chatUserHasMultipleLocations() {
  try {
    if (typeof window !== 'undefined' && typeof window.ffUserHasMultipleLocations === 'function') {
      if (window.ffUserHasMultipleLocations()) return true;
    }
    if (typeof window !== 'undefined' && typeof window.ffGetLocations === 'function') {
      const locs = (window.ffGetLocations() || []).filter(l => l && l.isActive !== false);
      if (locs.length > 1) return true;
    }
  } catch (_) {}
  return false;
}

function _chatHasActiveLocationForWrite() {
  if (!_chatUserHasMultipleLocations()) return true;
  return !!_readActiveLocationId();
}

function _chatPrimaryLocationId() {
  try {
    const w = typeof window !== 'undefined' ? window : {};
    if (typeof w.ffResolveCurrentStaff === 'function' && typeof w.ffEnsureStaffLocationFields === 'function') {
      const row = w.ffResolveCurrentStaff();
      if (row) {
        const f = w.ffEnsureStaffLocationFields(row);
        const primary = typeof f.primaryLocationId === 'string' ? f.primaryLocationId.trim() : '';
        if (primary) return primary;
      }
    }
    if (typeof w.ffGetUserAllowedLocations === 'function') {
      const locs = w.ffGetUserAllowedLocations();
      if (Array.isArray(locs) && locs[0] && locs[0].id) return String(locs[0].id).trim();
    }
  } catch (_) {}
  return '';
}

/** Unstamped / salon-default items stay on the primary branch only. */
function _legacyDefaultVisibleAt(locKey) {
  const k = typeof locKey === 'string' && locKey.trim() ? locKey.trim() : CHAT_DEFAULT_LOC_KEY;
  if (!_chatUserHasMultipleLocations()) return true;
  if (k === CHAT_DEFAULT_LOC_KEY) return true;
  const primary = _chatPrimaryLocationId();
  return !!primary && k === primary;
}

function getChatAccountId() {
  const candidates = [
    chatState.chatUserProfile?.accountId,
    chatState.chatUserProfile?.accountID,
    chatState.chatUserProfile?.account_id,
    chatState.chatUserProfile?.salonId,
    (typeof window !== 'undefined' ? window.currentAccountId : null),
    (typeof window !== 'undefined' ? window.accountId : null),
    (typeof window !== 'undefined' ? window.currentSalonId : null)
  ];
  for (const v of candidates) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

async function loadSharedChatShareEnabled() {
  const accountId = getChatAccountId();
  if (!accountId) return false;
  try {
    const snap = await getDoc(doc(db, `accounts/${accountId}/shared/chatTemplates`));
    const data = snap.exists() ? (snap.data() || {}) : {};
    return data.shareEnabled === true || data.enabled === true;
  } catch (e) {
    console.warn('[SharedChat] share flag load failed', e);
    return false;
  }
}

async function loadSharedChatTemplates() {
  const accountId = getChatAccountId();
  if (!accountId) return [];
  if (!(await loadSharedChatShareEnabled())) return [];
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
  if (!(await loadSharedChatShareEnabled())) return [];
  try {
    const snap = await getDocs(collection(db, `accounts/${accountId}/shared/chatFlows/items`));
    return snap.docs
      .map(d => ({ id: `shared:${d.id}`, sharedFlowId: d.id, isSharedFlow: true, ...d.data() }))
      .filter(f => f.active !== false && (f.status || 'active') !== 'archived')
      .map(f => ({
        ...f,
        steps: Array.isArray(f.steps)
          ? _chatSortByOrder(f.steps.map(s => ({
              ...s,
              options: Array.isArray(s.options) ? _chatSortByOrder(s.options) : []
            })))
          : []
      }))
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  } catch (e) {
    console.warn('[SharedChat] load flows failed', e);
    return [];
  }
}

// ─── Profile / Users / Templates ──────────────────────────────────────────────
async function loadChatUserProfile() {
  const user = auth.currentUser;
  if (!user) {
    console.error('[Chat] loadChatUserProfile failed — no auth.currentUser. Gear hidden.');
    chatState.chatUserProfile = null;
    return;
  }
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (snap.exists()) {
      const data = snap.data() || {};
      // Multi-salon: prefer the salon the user picked from Choose Salon (or the
      // single auto-selected membership) over the legacy users/{uid}.salonId.
      // Without this override, a user who picked test_salon_001 from Choose
      // Salon would still see conversations / templates / flows from their
      // legacy primary salon (data.salonId), since every chat query below
      // composes paths from chatUserProfile.salonId.
      // staffId and role also need to be overridden — chat header rendering
      // and "allowed senders" gating use chatUserProfile.role, which differs
      // between salons (e.g. owner here, technician there).
      const w = (typeof window !== 'undefined') ? window : {};
      const activeSalonId = w.currentSalonId ? String(w.currentSalonId).trim() : '';
      const activeStaffId = w.__ff_authedStaffId ? String(w.__ff_authedStaffId).trim() : '';
      const activeRole = w.__ff_user_role ? String(w.__ff_user_role).trim() : '';
      const resolvedSalonId = activeSalonId || data.salonId || null;
      const resolvedStaffId = activeStaffId || data.staffId || null;
      chatState.chatUserProfile = {
        uid: user.uid,
        ...data,
        salonId: resolvedSalonId,
        staffId: resolvedStaffId,
        role: activeRole || data.role || '',
      };
      // Multi-salon: pull the display name from the staff doc in the chosen
      // salon. Otherwise messages sent from test_salon_001 are stored with
      // chatUserProfile.name = the legacy primary-salon user name (e.g.
      // "Test Multi") instead of the salon-scoped staff name (e.g. "TEST TECH"),
      // and recipients see the wrong sender label.
      if (resolvedSalonId && resolvedStaffId) {
        try {
          const staffSnap = await getDoc(doc(db, `salons/${resolvedSalonId}/staff`, resolvedStaffId));
          if (staffSnap.exists()) {
            const st = staffSnap.data() || {};
            const staffName = String(st.name || '').trim();
            if (staffName) chatState.chatUserProfile.name = staffName;
            // Also merge permissions so per-salon access controls work in chat.
            chatState.chatUserProfile.permissions = { ...(chatState.chatUserProfile.permissions || {}), ...(st.permissions || {}) };
            if (st.managerType) chatState.chatUserProfile.managerType = st.managerType;
          }
        } catch (mergeErr) {
          console.warn('[Chat] Failed to merge staff doc into profile', mergeErr);
        }
      }
    } else {
      console.error('[Chat] loadChatUserProfile failed — Firestore doc users/' + user.uid + ' not found. Gear hidden.');
      chatState.chatUserProfile = null;
    }
  } catch (e) {
    console.error('[Chat] loadChatUserProfile failed — Firestore error:', e);
    chatState.chatUserProfile = null;
  }
}

async function loadChatSalonUsers(options = {}) {
  if (!chatState.chatUserProfile?.salonId) {
    chatState.chatSalonUsers = [];
    chatState._chatMembersLoaded = true;
    return;
  }
  const key = `${chatState.chatUserProfile.salonId}::${chatState.chatUserProfile.uid || ''}`;
  if (!options.force && chatState._chatMembersLoaded && chatState._chatUsersLoadKey === key) return;
  if (!options.force && chatState._chatUsersLoadPromise && chatState._chatUsersLoadKey === key) return chatState._chatUsersLoadPromise;
  chatState._chatUsersLoadKey = key;
  chatState._chatMembersLoaded = false;
  chatState._chatUsersLoadPromise = (async () => {
    try {
      const snap = await getDocs(collection(db, `salons/${chatState.chatUserProfile.salonId}/members`));
      chatState.chatSalonUsers = snap.docs
        .map(d => ({ ...d.data(), uid: d.id }))
        .filter(u => u.uid !== chatState.chatUserProfile.uid);
    } catch (e) {
      chatState.chatSalonUsers = [];
    } finally {
      chatState._chatMembersLoaded = true;
      chatState._chatUsersLoadPromise = null;
    }
  })();
  return chatState._chatUsersLoadPromise;
}

async function loadChatTemplates(options = {}) {
  if (!chatState.chatUserProfile?.salonId) return;
  const locKey = _chatEffectiveLocKey();
  const key = `${chatState.chatUserProfile.salonId}::${locKey}`;
  if (!options.force && chatState._chatTemplatesLoadKey === key && chatState.chatTemplates.length) return;
  if (!options.force && chatState._chatTemplatesLoadPromise && chatState._chatTemplatesLoadKey === key) return chatState._chatTemplatesLoadPromise;
  chatState._chatTemplatesLoadKey = key;
  chatState._chatTemplatesLoadPromise = (async () => {
    const sharedTemplates = await loadSharedChatTemplates();
    try {
      const snap = await getDocs(query(
        collection(db, `salons/${chatState.chatUserProfile.salonId}/chatTemplates`),
        orderBy('order','asc')
      ));
      const localTemplates = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(t => _itemVisibleAtLocation(t, locKey));
      chatState.chatTemplates = [...sharedTemplates, ...localTemplates];
    } catch (e) {
      console.warn('[Chat] loadChatTemplates orderBy failed, retrying without order', e?.code, e?.message);
      try {
        const snap = await getDocs(collection(db, `salons/${chatState.chatUserProfile.salonId}/chatTemplates`));
        const localTemplates = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(t => _itemVisibleAtLocation(t, locKey))
          .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        chatState.chatTemplates = [...sharedTemplates, ...localTemplates];
      } catch (e2) {
        console.error('[Chat] loadChatTemplates error', e2);
        chatState.chatTemplates = sharedTemplates;
      }
    } finally {
      chatState._chatTemplatesLoadPromise = null;
    }
  })();
  return chatState._chatTemplatesLoadPromise;
}

async function loadChatFlows(options = {}) {
  if (!chatState.chatUserProfile?.salonId) return;
  const locKey = _chatEffectiveLocKey();
  const key = `${chatState.chatUserProfile.salonId}::${locKey}`;
  if (!options.force && chatState._chatFlowsLoadKey === key && chatState.chatFlows.length) return;
  if (!options.force && chatState._chatFlowsLoadPromise && chatState._chatFlowsLoadKey === key) return chatState._chatFlowsLoadPromise;
  chatState._chatFlowsLoadKey = key;
  chatState._chatFlowsLoadPromise = (async () => {
    const sharedFlows = await loadSharedChatFlows();
    try {
      const flowsSnap = await getDocs(collection(db, `salons/${chatState.chatUserProfile.salonId}/chatFlows`));
      const flows = (await Promise.all(flowsSnap.docs.map(async (fd) => {
        const flowData = { id: fd.id, ...fd.data() };
        if (!_itemVisibleAtLocation(flowData, locKey)) return null;
        try {
          const stepsSnap = await getDocs(collection(db, `salons/${chatState.chatUserProfile.salonId}/chatFlows/${fd.id}/steps`));
          flowData.steps = await Promise.all(stepsSnap.docs.map(async (sd) => {
            const stepData = { id: sd.id, ...sd.data() };
            try {
              const optsSnap = await getDocs(collection(db, `salons/${chatState.chatUserProfile.salonId}/chatFlows/${fd.id}/steps/${sd.id}/options`));
              stepData.options = _chatSortByOrder(optsSnap.docs.map(od => ({ id: od.id, ...od.data() })));
            } catch (optErr) {
              console.warn('[Chat] flow option load failed', {
                salonId: chatState.chatUserProfile.salonId,
                flowId: fd.id,
                stepId: sd.id,
                code: optErr?.code,
                message: optErr?.message
              });
              stepData.options = [];
            }
            return stepData;
          }));
        } catch (stepErr) {
          console.warn('[Chat] flow step load failed; showing flow shell', {
            salonId: chatState.chatUserProfile.salonId,
            flowId: fd.id,
            title: flowData.title,
            code: stepErr?.code,
            message: stepErr?.message
          });
          flowData.steps = [];
        }
        flowData.steps = _chatSortByOrder(flowData.steps);
        return (flowData.status || 'active') !== 'archived' ? flowData : null;
      }))).filter(Boolean);
      chatState.chatFlows = [...sharedFlows, ...flows];
    } catch(e) {
      console.error('[Chat] loadChatFlows top-level failed', e?.code, e?.message, e);
      chatState.chatFlows = sharedFlows;
    } finally {
      chatState._chatFlowsLoadPromise = null;
    }
  })();
  return chatState._chatFlowsLoadPromise;
}

// ─── Conversation location scoping + cache (shared by core + subscriptions) ─────
function _itemVisibleAtLocation(item, locKey) {
  const k = typeof locKey === 'string' && locKey.trim() ? locKey.trim() : CHAT_DEFAULT_LOC_KEY;
  if (!item || typeof item !== 'object') return _legacyDefaultVisibleAt(k);
  const v = typeof item.locationId === 'string' ? item.locationId.trim() : '';
  const itemKey = v || CHAT_DEFAULT_LOC_KEY;
  if (itemKey === k) return true;
  if (itemKey === CHAT_DEFAULT_LOC_KEY) return _legacyDefaultVisibleAt(k);
  return false;
}

/** True when a conversation belongs to the given location. Never mix branches. */
function _convMatchesLocation(conv, locKey) {
  const k = typeof locKey === 'string' && locKey.trim() ? locKey.trim() : CHAT_DEFAULT_LOC_KEY;
  const convKey = _convLocKey(conv);
  if (convKey === k) return true;
  if (convKey === CHAT_DEFAULT_LOC_KEY) return _legacyDefaultVisibleAt(k);
  return false;
}

function _cacheConversations(list) {
  if (!Array.isArray(list)) return;
  list.forEach(c => {
    if (c && c.id) chatState.cachedConversationsById[c.id] = c;
  });
}

export {
  _readActiveLocationId,
  _activeLocKey,
  _chatEffectiveLocKey,
  _chatHasActiveLocationForWrite,
  _convMatchesLocation,
  _cacheConversations,
  getChatAccountId,
  loadSharedChatTemplates,
  loadSharedChatFlows,
  loadChatUserProfile,
  loadChatSalonUsers,
  loadChatTemplates,
  loadChatFlows,
};
