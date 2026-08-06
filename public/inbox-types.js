/**
 * Inbox — Request types registry (extracted from inbox.js, Phase 2).
 * Loads built-in + custom request types, computes the visible/grouped type lists,
 * and resolves per-type display info. inboxUserRoleLc is injected from inbox.js.
 */
import {
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import {
  inboxState,
  BUILTIN_TYPES,
  LEGACY_INBOX_TYPE_INFO,
  INBOX_SETTINGS_DOC_ID,
} from "./inbox-state.js?v=20260629_inbox_state_split";

// Injected from inbox.js.
let inboxUserRoleLc = () => "";
export function initInboxTypes(deps) {
  if (deps && typeof deps.inboxUserRoleLc === 'function') inboxUserRoleLc = deps.inboxUserRoleLc;
}

async function loadCustomTypes() {
  if (!inboxState.currentUserProfile?.salonId) return;
  try {
    const snap = await getDocs(collection(db, `salons/${inboxState.currentUserProfile.salonId}/requestTypes`));
    inboxState.customRequestTypes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    console.log('[Inbox] Custom request types loaded', inboxState.customRequestTypes.length);
  } catch (err) {
    console.warn('[Inbox] Failed to load custom types', err);
    inboxState.customRequestTypes = [];
  }
}


async function loadInboxSettings() {
  if (!inboxState.currentUserProfile?.salonId) return;
  try {
    const ref = doc(db, 'salons', inboxState.currentUserProfile.salonId, 'inboxSettings', INBOX_SETTINGS_DOC_ID);
    const snap = await getDoc(ref);
    inboxState.inboxHiddenTypes = Array.isArray(snap.data()?.hiddenRequestTypes) ? snap.data().hiddenRequestTypes : [];
  } catch (err) {
    console.warn('[Inbox] Failed to load inbox settings', err);
    inboxState.inboxHiddenTypes = [];
  }
}

async function setInboxTypeVisibility(typeId, hidden) {
  if (!inboxState.currentUserProfile?.salonId) return;
  if (hidden) {
    if (!inboxState.inboxHiddenTypes.includes(typeId)) inboxState.inboxHiddenTypes = [...inboxState.inboxHiddenTypes, typeId];
  } else {
    inboxState.inboxHiddenTypes = inboxState.inboxHiddenTypes.filter(id => id !== typeId);
  }
  const salonId = inboxState.currentUserProfile.salonId;
  const ref = doc(db, 'salons', salonId, 'inboxSettings', INBOX_SETTINGS_DOC_ID);
  await setDoc(ref, { hiddenRequestTypes: inboxState.inboxHiddenTypes }, { merge: true });
}

function getAllRequestTypes() {
  const hidden = new Set(inboxState.inboxHiddenTypes || []);
  const custom = (inboxState.customRequestTypes || []).map(t => ({
    id: t.id,
    icon: t.icon || '📝',
    label: t.label || 'Request',
    description: t.description || '',
    category: 'custom',
    fields: Array.isArray(t.fields) ? t.fields : []
  }));
  const automatedInboxTypes = new Set(['staff_birthday_reminder', 'document_expiring_soon', 'document_expired']);
  const managerOnlyNewRequestTypes = new Set(['document_renewal_request']);
  const hideRenewalForStaff = inboxUserRoleLc() === 'technician';
  const withoutOther = BUILTIN_TYPES.filter(
    (t) =>
      t.category !== 'other' &&
      !hidden.has(t.id) &&
      !automatedInboxTypes.has(t.id) &&
      !(hideRenewalForStaff && managerOnlyNewRequestTypes.has(t.id))
  );
  const otherOnly = BUILTIN_TYPES.filter(
    (t) => t.category === 'other' && !hidden.has(t.id) && !automatedInboxTypes.has(t.id)
  );
  const customVisible = custom.filter(t => !hidden.has(t.id));
  const combined = [...withoutOther, ...customVisible, ...otherOnly];
  const seen = new Set();
  return combined.filter((t) => {
    const id = t && t.id != null ? String(t.id) : '';
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Returns types grouped by category for the New Request modal (Schedule, Payments, Operations, Documents, Custom, Other). */
function getRequestTypesGroupedByCategory() {
  const all = getAllRequestTypes();
  const groups = { schedule: [], payments: [], operations: [], documents: [], custom: [], other: [] };
  const categoryLabel = (t) => t.category || 'other';
  all.forEach(t => {
    const cat = categoryLabel(t);
    if (groups[cat]) groups[cat].push(t);
  });
  return groups;
}

function getRequestTypeInfo(type) {
  const all = getAllRequestTypes();
  const found = all.find(t => t.id === type);
  if (found) return found;
  if (type && LEGACY_INBOX_TYPE_INFO[type]) return LEGACY_INBOX_TYPE_INFO[type];
  const builtinOnly = BUILTIN_TYPES.find(t => t.id === type);
  return builtinOnly || { icon: '📝', label: type || 'Request', description: '', fields: [] };
}

export {
  loadCustomTypes,
  loadInboxSettings,
  setInboxTypeVisibility,
  getRequestTypesGroupedByCategory,
  getRequestTypeInfo,
};
