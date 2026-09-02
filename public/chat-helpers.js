/**
 * Chat — pure stateless helpers.
 *
 * Self-contained utilities used across the chat module: ordering/category
 * grouping, role/sender-token matching, HTML escaping + linkify, pure
 * location-key derivation, conversation-id building, display-name trimming,
 * and timestamp formatting. No module state, no DOM, no Firestore, no window.
 * Extracted verbatim from chat.js.
 */

export const CHAT_DEFAULT_LOC_KEY = 'default';

export const isMgrPlus = r => ['manager','admin','owner'].includes((r||'').toLowerCase());

export const escHtml   = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const escapeAttr = s => String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');

export const roleLabel = r => ({technician:'Service Provider',manager:'Manager',admin:'Admin',owner:'Owner'}[(r||'').toLowerCase()] || r || '');

export const buildConvId = (a, b, locKey) => {
  const pair = [a, b].sort().join('__');
  const lk = typeof locKey === 'string' && locKey.trim() ? locKey.trim() : CHAT_DEFAULT_LOC_KEY;
  return lk === CHAT_DEFAULT_LOC_KEY ? pair : `loc_${lk}__${pair}`;
};

export function _chatOrderValue(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function _chatSortByOrder(items = []) {
  return [...items].sort((a, b) =>
    _chatOrderValue(a?.order, 0) - _chatOrderValue(b?.order, 0)
  );
}

export function _chatCategoryValue(value) {
  return String(value || '').trim().slice(0, 40);
}

function _chatCategoryLabel(value) {
  return _chatCategoryValue(value) || 'Uncategorized';
}

export function _chatGroupByCategory(items = []) {
  const groups = new Map();
  items.forEach(item => {
    const label = _chatCategoryLabel(item?.category);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(item);
  });
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === 'Uncategorized') return 1;
    if (b === 'Uncategorized') return -1;
    return a.localeCompare(b);
  });
}

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

export function _chatUserMatchesAllowedSenders(userRole, allowedSenders) {
  if (!Array.isArray(allowedSenders) || allowedSenders.length === 0) return true;
  const ur = _chatNormalizeUserRoleForSenders(userRole);
  return allowedSenders.some(tok => _chatExpandedRolesForAllowedToken(tok).has(ur));
}

export function linkifyMessageHtml(raw) {
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

function _convLocKeyFromId(id) {
  const s = String(id || '');
  if (s.startsWith('loc_')) {
    const sep = s.indexOf('__', 4);
    if (sep > 4) return s.substring(4, sep);
  }
  return CHAT_DEFAULT_LOC_KEY;
}

export function _convLocKey(conv) {
  if (!conv || typeof conv !== 'object') return CHAT_DEFAULT_LOC_KEY;
  const v = typeof conv.locationId === 'string' ? conv.locationId.trim() : '';
  if (conv.id && String(conv.id).startsWith('loc_')) return _convLocKeyFromId(conv.id);
  if (v) return v;
  if (conv.id) return _convLocKeyFromId(conv.id);
  return v ? v : CHAT_DEFAULT_LOC_KEY;
}

export function _itemMatchesLocation(item, locKey) {
  const k = typeof locKey === 'string' && locKey.trim() ? locKey.trim() : CHAT_DEFAULT_LOC_KEY;
  if (!item || typeof item !== 'object') return k === CHAT_DEFAULT_LOC_KEY;
  const v = typeof item.locationId === 'string' ? item.locationId.trim() : '';
  return (v || CHAT_DEFAULT_LOC_KEY) === k;
}

export function _trimStr(v) {
  if (v == null) return '';
  const s = String(v).trim();
  return s;
}

export function _memberDisplayNameFromRow(u) {
  if (!u || typeof u !== 'object') return '';
  const dn = _trimStr(u.displayName);
  if (dn) return dn;
  return _trimStr(u.name);
}

export function _otherUidFromParticipants(parts, myUid) {
  if (!Array.isArray(parts)) return '';
  return parts.find(u => u && u !== myUid) || '';
}

export function isChatGroup(conv) {
  if (!conv) return false;
  if (String(conv.kind || "").toLowerCase() === "group") return true;
  if (String(conv.groupName || "").trim()) return true;
  return Array.isArray(conv.participants) && conv.participants.length > 2;
}

export function chatGroupTitle(conv) {
  const name = String((conv && conv.groupName) || "").trim();
  return name || "Group";
}

export function chatGroupPhotoUrl(conv) {
  if (!conv) return '';
  const url = String(conv.groupPhotoUrl || '').trim();
  if (!url) return '';
  const at = conv.groupPhotoUpdatedAtMs != null ? String(conv.groupPhotoUpdatedAtMs) : '';
  if (!at) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${encodeURIComponent(at)}`;
}

export function isManagerLikeRole(role) {
  return isMgrPlus(role);
}

export function timeAgo(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60)    return 'Just now';
  if (s < 3600)  return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return d.toLocaleDateString('en-US', {month:'short', day:'numeric'});
}

export function _chatDayKey(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function _chatDaySeparatorLabel(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startD = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startToday - startD) / 86400000);
  if (diffDays === 0) return 'TODAY';
  if (diffDays === 1) return 'YESTERDAY';
  const yNow = today.getFullYear();
  if (d.getFullYear() !== yNow) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}
