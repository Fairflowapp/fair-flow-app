/**
 * Inbox/Requests System
 * Request-based communication system (not chat)
 * 
 * Structure: salons/{salonId}/inboxItems/{itemId}
 * Permissions: Technician (own requests), Manager (all requests), Admin (approve/deny)
 */

import { 
  collection, 
  query, 
  where, 
  orderBy, 
  limit,
  addDoc,
  updateDoc,
  setDoc,
  doc,
  getDoc,
  getDocs,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  increment,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth, storage } from "./app.js?v=20260408_inbox_upload_deeplink";
import {
  ffSyncStaffDocumentOnInboxApprove,
  ffSyncStaffDocumentOnInboxReject,
  ffSendExpiryChatReminderForStaffDocContext,
  ffStaffDocumentTypeSelectOptionsHtml,
  ffExpirationTimestampToYmdInput,
} from "./staff-documents.js";

// Category order for display (Schedule → Payments → Operations → Documents → Other at end)
const REQUEST_CATEGORY_ORDER = ['schedule', 'payments', 'operations', 'documents', 'other'];
const REQUEST_CATEGORY_LABELS = {
  schedule: '🗓️ Schedule',
  payments: '💰 Payments',
  operations: '🛠️ Operations',
  documents: '📄 Documents',
  other: '⭐ Other'
};

// Built-in request types (id, icon, label, description, category)
const BUILTIN_TYPES = [
  // Schedule
  { id: 'vacation', icon: '🏖️', label: 'Vacation Request', description: 'PTO — one day or a date range (same start & end = single day)', category: 'schedule' },
  { id: 'late_start', icon: '⏰', label: 'Late Start', description: 'Request to start later', category: 'schedule' },
  { id: 'early_leave', icon: '🏃', label: 'Early Leave', description: 'Request to leave early', category: 'schedule' },
  { id: 'schedule_change', icon: '📅', label: 'Schedule Change', description: 'Request schedule modification', category: 'schedule' },
  { id: 'extra_shift', icon: '✅', label: 'Extra Shift / Pick Up Shift', description: 'Request to work on a day you\'re not scheduled', category: 'schedule' },
  { id: 'swap_shift', icon: '🔄', label: 'Swap Shift', description: 'Swap a shift with another staff member', category: 'schedule' },
  { id: 'break_change', icon: '☕', label: 'Break Change', description: 'Request to change break time', category: 'schedule' },
  // Payments
  { id: 'commission_review', icon: '💰', label: 'Commission Review', description: 'Question about commission or payment', category: 'payments' },
  { id: 'tip_adjustment', icon: '💵', label: 'Tip Adjustment', description: 'Change tip after a service', category: 'payments' },
  { id: 'payment_issue', icon: '📋', label: 'Payment Issue', description: 'Report a payment problem', category: 'payments' },
  // Operations
  { id: 'supplies', icon: '📦', label: 'Supplies', description: 'Request supplies or materials', category: 'operations' },
  { id: 'maintenance', icon: '🔧', label: 'Maintenance', description: 'Report maintenance issue', category: 'operations' },
  { id: 'client_issue', icon: '👤', label: 'Client Issue', description: 'Report or discuss a client-related matter', category: 'operations' },
  { id: 'staff_birthday_reminder', icon: '🎂', label: 'Staff birthday reminder', description: 'Automated — upcoming staff birthday (management only)', category: 'operations' },
  // Documents
  { id: 'document_request', icon: '📄', label: 'Request a Document', description: 'Request a document from management (1099, employment letter, contract, etc.)', category: 'documents' },
  {
    id: 'document_renewal_request',
    icon: '📩',
    label: 'Request a new document (from staff)',
    description: 'Ask a service provider to upload a renewed document (e.g. insurance or license before it expires).',
    category: 'documents',
  },
  { id: 'document_upload', icon: '📤', label: 'Upload a Document', description: 'Upload a document to the business (license, insurance, certification)', category: 'documents' },
  { id: 'document_expiring_soon', icon: '⏳', label: 'Document expiring soon', description: 'Automated — staff document expires within 30 days (management only)', category: 'documents' },
  { id: 'document_expired', icon: '⚠️', label: 'Document expired', description: 'Automated — staff document past expiration (management only)', category: 'documents' },
  // Other (always last)
  { id: 'other', icon: '📝', label: 'Other', description: 'Other request', category: 'other' }
];

/** Old inbox items only — not offered in “New request”. */
const LEGACY_INBOX_TYPE_INFO = {
  day_off: { id: 'day_off', icon: '📴', label: 'Day off', description: 'Legacy request', category: 'schedule' },
  time_off: { id: 'time_off', icon: '🕐', label: 'Time off', description: 'Legacy request', category: 'schedule' },
};

/** Normalize Firestore/string date to YYYY-MM-DD for &lt;input type="date"&gt;. */
function ffInboxYmdFromRaw(v) {
  if (v == null || v === "") return "";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return ffExpirationTimestampToYmdInput(v);
}

/** Inclusive YYYY-MM-DD list — same shape schedule-availability expects for ranges / affectedDates. */
function enumerateInclusiveDateKeysForInbox(startDateStr, endDateStr) {
  const start = String(startDateStr || "").trim();
  const end = String(endDateStr || start || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return [];
  const a = new Date(`${start}T12:00:00`);
  const b = new Date(`${end}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || a > b) return [];
  const out = [];
  for (let d = new Date(a.getTime()); d <= b; d.setDate(d.getDate() + 1)) {
    out.push([
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0"),
    ].join("-"));
  }
  return out;
}

// =====================
// State
// =====================
let currentInboxTab = 'open';
let inboxViewMode = 'to_handle'; // 'mine' | 'to_handle' — only for admin/manager
let inboxUnsubscribe = null;
let currentUserProfile = null;
/** Technicians: merge outgoing (createdByUid) + incoming (forUid) inbox queries. */
let _techInboxOutgoing = [];
let _techInboxIncoming = [];

/** Automated inbox items for management ("To handle") only — never list for technicians. */
const MANAGER_ONLY_INBOX_TYPES = new Set(["staff_birthday_reminder", "document_expiring_soon", "document_expired"]);

function inboxExpiringDateToMillis(v) {
  if (v == null) return null;
  try {
    if (typeof v.toMillis === "function") return v.toMillis();
    if (typeof v.toDate === "function") return v.toDate().getTime();
  } catch (_) {}
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    const s = v.trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T12:00:00.000Z`).getTime();
  }
  return null;
}

/** document_expiring_soon rows past expiration → group under document_expired (To handle). */
function inboxEffectiveTypeForGrouping(req) {
  const t = String(req?.type || "").trim();
  if (t !== "document_expiring_soon") return t || "other";
  const expRaw = req?.expirationDate ?? req?.data?.expirationDate;
  const expMs = inboxExpiringDateToMillis(expRaw);
  if (expMs != null && Date.now() > expMs) return "document_expired";
  return "document_expiring_soon";
}

/** True if this doc-alert row should show as "expired" in the card (type or past expiry date). */
function inboxDocAlertIsExpiredForUi(request) {
  const t = String(request?.type || "").trim();
  if (t === "document_expired") return true;
  if (t !== "document_expiring_soon") return false;
  const expMs = inboxExpiringDateToMillis(request?.expirationDate ?? request?.data?.expirationDate);
  return expMs != null && Date.now() > expMs;
}

/** Mistaken "Other" rows (e.g. staff-call noise) — hide from admin My Requests and from technicians' Inbox. */
function ffInboxIsStaffCallOtherNoise(r) {
  const t = String(r?.type || "").trim();
  if (t !== "other") return false;
  const d = r?.data || {};
  const msg = String(r?.message || "").toLowerCase();
  const subj = String(r?.title || r?.subject || d.subject || d.title || "").toLowerCase();
  const det = String(d.details || "").toLowerCase();
  if (String(d.source || "").toLowerCase() === "staff_call") return true;
  if (msg.includes("staff call") || subj.includes("staff call") || det.includes("staff call")) return true;
  return false;
}

/** Rows technicians should not see in Inbox (manager automations + misrouted staff-call "Other" items). */
function inboxTechnicianNoiseFilter(rows) {
  return (rows || [])
    .filter((r) => !MANAGER_ONLY_INBOX_TYPES.has(String(r.type || "").trim()))
    .filter((r) => !ffInboxIsStaffCallOtherNoise(r));
}

function inboxItemActivityMs(r) {
  const la = r && r.lastActivityAt;
  const ca = r && r.createdAt;
  if (la && typeof la.toMillis === 'function') return la.toMillis();
  if (ca && typeof ca.toMillis === 'function') return ca.toMillis();
  return 0;
}

function applyTechInboxMerge(loadingEl) {
  const map = new Map();
  _techInboxOutgoing.forEach((row) => map.set(row.id, row));
  _techInboxIncoming.forEach((row) => map.set(row.id, row));
  currentRequests = Array.from(map.values()).sort((a, b) => inboxItemActivityMs(b) - inboxItemActivityMs(a));
  currentRequests = inboxTechnicianNoiseFilter(currentRequests);
  if (loadingEl) loadingEl.style.display = 'none';
  console.log('[Inbox] Loaded (technician merged)', currentRequests.length, 'requests');
  updateInboxStaffFilterOptions();
  updateInboxBadges();
  renderInboxList();
}

function inboxUserRoleLc() {
  return String((currentUserProfile && currentUserProfile.role) || "").toLowerCase();
}

/** Roles that historically had full inbox access before per-staff permission flags. */
function inboxLegacyDeskRoleLc(roleLc) {
  return ["manager", "admin", "owner", "front_desk", "assistant_manager"].includes(roleLc);
}

/** Merge salons/{salonId}/staff/{staffId} (permissions, managerType) into a user profile object. */
async function mergeSalonStaffIntoUserProfile(profile) {
  if (!profile?.salonId) return profile;
  const sid = String(profile.staffId || "").trim();
  if (!sid) return profile;
  try {
    const snap = await getDoc(doc(db, `salons/${profile.salonId}/staff`, sid));
    if (snap.exists()) {
      const st = snap.data() || {};
      profile.permissions = { ...(profile.permissions || {}), ...(st.permissions || {}) };
      if (st.managerType) profile.managerType = st.managerType;
    }
  } catch (e) {
    console.warn("[Inbox] merge salon staff", e.message);
  }
  return profile;
}

function inboxCanViewInboxEval(profile) {
  if (!profile) return false;
  const p = profile.permissions || {};
  return p.inbox_view === true;
}

function inboxCanManageInboxEval(profile) {
  if (!profile) return false;
  const role = String(profile.role || "").toLowerCase();
  const p = profile.permissions || {};
  if (p.inbox_manage === false) return false;
  if (p.inbox_manage === true) return true;
  return inboxLegacyDeskRoleLc(role);
}

function inboxCanSendRequestsEval(profile) {
  if (!profile) return false;
  const role = String(profile.role || "").toLowerCase();
  const p = profile.permissions || {};
  if (inboxCanManageInboxEval(profile)) return true;
  if (p.inbox_send === false) return false;
  if (p.inbox_send === true) return true;
  if (role === "technician") {
    return true;
  }
  if (p.inbox_manage === false) return false;
  return inboxLegacyDeskRoleLc(role);
}

function inboxCanViewInbox() {
  return inboxCanViewInboxEval(currentUserProfile);
}

function inboxCanManageInbox() {
  return inboxCanManageInboxEval(currentUserProfile);
}

function inboxCanSendRequests() {
  return inboxCanSendRequestsEval(currentUserProfile);
}

/** Hide INBOX nav when the signed-in user has no inbox access (uses users + staff permissions). */
export async function ffRefreshInboxNavVisibility() {
  const user = auth.currentUser;
  const btn = document.getElementById("inboxBtn");
  if (!btn) return;
  if (!user) {
    btn.style.display = "";
    return;
  }
  if (typeof window.ffUpdateMainNavTabVisibility === "function") {
    window.ffUpdateMainNavTabVisibility();
    return;
  }
  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists()) return;
    let profile = { uid: user.uid, ...userDoc.data() };
    profile = await mergeSalonStaffIntoUserProfile(profile);
    btn.style.display = inboxCanViewInboxEval(profile) ? "" : "none";
  } catch (e) {
    console.warn("[Inbox] ffRefreshInboxNavVisibility", e.message);
  }
}

let currentRequests = [];
let customRequestTypes = [];
let inboxStaffFilterUid = '';
let inboxHiddenTypes = []; // loaded from salons/{salonId}/requestTypes
let _inboxUsersCache = null; // { uid, name, staffId, role }[] — loaded from Firestore users

/** Load same-salon users from Firestore (managers/admins/owners can read via updated rules). Cached per session. */
async function loadSalonUsersForRecipients() {
  if (_inboxUsersCache !== null) return _inboxUsersCache;
  if (!currentUserProfile?.salonId) return [];
  try {
    // Read from salons/{salonId}/members — readable by any salon member, no complex rules
    const snap = await getDocs(collection(db, `salons/${currentUserProfile.salonId}/members`));
    _inboxUsersCache = snap.docs
      .filter(d => d.id !== currentUserProfile.uid)
      .map(d => {
        const u = d.data() || {};
        return {
          uid: d.id,
          name: (u.name || '').trim(),
          staffId: u.staffId || '',
          role: (u.role || '').toLowerCase()
        };
      })
      .filter(u => u.name);
    console.log('[Inbox] members loaded:', _inboxUsersCache.length, '| managers/admins:', _inboxUsersCache.filter(u => ['manager','admin','owner'].includes(u.role)).length);
    return _inboxUsersCache;
  } catch (e) {
    console.error('[Inbox] loadSalonUsersForRecipients failed:', e.code, e.message);
    _inboxUsersCache = [];
    return [];
  }
}

/** Recipients for "Send to": managers/admins from Firestore users cache, falling back to ff_staff_v1. */
function getInboxRecipientsList() {
  // Prefer Firestore cache (has real Firebase UIDs)
  if (_inboxUsersCache && _inboxUsersCache.length > 0) {
    return _inboxUsersCache
      .filter(u => ['manager', 'admin', 'owner'].includes(u.role))
      .map(u => ({ uid: u.uid, id: u.staffId || u.uid, name: u.name }));
  }
  // Fallback: ff_staff_v1 (no uid, just staffId)
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('ff_staff_v1') : null;
    const store = raw ? JSON.parse(raw) : {};
    const staff = Array.isArray(store.staff) ? store.staff : [];
    const currentStaffId = (currentUserProfile?.staffId || currentUserProfile?.id) || '';
    const currentName = (currentUserProfile?.name) || '';
    return staff
      .filter(s => s && !s.isArchived && (s.isAdmin || s.isManager) && s.id !== currentStaffId && s.name !== currentName)
      .map(s => ({ uid: '', id: s.id || '', name: (s.name || '').trim() }));
  } catch (e) {
    return [];
  }
}

/** Selected recipients in create-request modal. Returns { uids: string[], staffIds: string[], names: string[] }. */
function getCreateRequestSelectedRecipients() {
  const modal = document.getElementById('createRequestModal');
  if (!modal) return { uids: [], staffIds: [], names: [] };
  const checked = modal.querySelectorAll('.create-request-send-to-cb:checked');
  const uids = []; const staffIds = []; const names = [];
  checked.forEach(cb => {
    const uid = cb.getAttribute('data-uid') || '';
    const id = cb.getAttribute('data-staff-id') || '';
    const n = cb.getAttribute('data-staff-name') || '';
    uids.push(uid); staffIds.push(id); if (n) names.push(n);
  });
  return { uids, staffIds, names };
}

// =====================
// Navigation
// =====================
export function goToInbox(onReady) {
  console.log('[Inbox] Opening inbox');

  if (typeof window.ffCurrentUserHasInboxViewPermission === 'function' && !window.ffCurrentUserHasInboxViewPermission()) {
    if (typeof window.ffUpdateMainNavTabVisibility === 'function') window.ffUpdateMainNavTabVisibility();
    return;
  }

  // Staff Members modal uses z-index above main screens — close it so the Inbox view is actually visible
  if (typeof window.closeStaffMembersModal === 'function') {
    window.closeStaffMembersModal();
  }
  // Close Settings, History, Tasks info, Media upload, password modal, Apps, orphaned inbox modals, etc.
  if (typeof window.ffCloseGlobalBlockingOverlays === 'function') {
    window.ffCloseGlobalBlockingOverlays();
  } else {
    try {
      const appsBd = document.getElementById('appsOverlayBackdrop');
      const appsPn = document.getElementById('appsPanel');
      if (appsBd) appsBd.style.display = 'none';
      if (appsPn) appsPn.style.display = 'none';
    } catch (_) {}
  }

  const tasksScreen = document.getElementById('tasksScreen');
  const ownerView = document.getElementById('owner-view');
  const joinBar = document.querySelector('.joinBar');
  const queueControls = document.getElementById('queueControls');
  const userProfileScreen = document.getElementById('userProfileScreen');
  const wrap = document.querySelector('.wrap');
  const inboxScreen = document.getElementById('inboxScreen');
  const inboxContent = document.getElementById('inboxContent');
  
  // Hide other screens first
  if (tasksScreen) tasksScreen.style.display = 'none';
  if (ownerView) ownerView.style.display = 'none';
  if (joinBar) joinBar.style.display = 'none';
  if (queueControls) queueControls.style.display = 'none';
  if (userProfileScreen) userProfileScreen.style.display = 'none';
  if (wrap) wrap.style.display = 'none';
  const manageQueueScreen = document.getElementById('manageQueueScreen');
  if (manageQueueScreen) manageQueueScreen.style.display = 'none';

  // Hide chat screen if open
  const chatScreen = document.getElementById('chatScreen');
  if (chatScreen) chatScreen.style.display = 'none';

  const mediaScreen = document.getElementById('mediaScreen');
  if (mediaScreen) mediaScreen.style.display = 'none';
  const trainingScreen = document.getElementById('trainingScreen');
  if (trainingScreen) trainingScreen.style.display = 'none';
  const ticketsScreenNav = document.getElementById('ticketsScreen');
  if (ticketsScreenNav) ticketsScreenNav.style.display = 'none';
  const scheduleScreenNav = document.getElementById('scheduleScreen');
  if (scheduleScreenNav) scheduleScreenNav.style.display = 'none';
  
  // Show inbox shell but hide content until ready (avoids flash of empty "My Requests")
  if (inboxScreen) {
    inboxScreen.style.display = 'flex';
    /* Undo stuck inline pointer-events:none from logout (app.js); without this, toolbars work but list area does not. */
    inboxScreen.style.pointerEvents = '';
  }
  if (inboxContent) inboxContent.style.opacity = '0';
  
  document.querySelectorAll('.btn-pill').forEach(btn => btn.classList.remove('active'));
  const inboxBtn = document.getElementById('inboxBtn');
  if (inboxBtn && typeof window.ffCurrentUserHasInboxViewPermission === 'function' && window.ffCurrentUserHasInboxViewPermission()) {
    inboxBtn.classList.add('active');
  }

  loadCurrentUserProfile().then(() => {
    if (!inboxCanViewInbox()) {
      if (typeof showToast === "function") {
        showToast("You do not have permission to open Inbox.", "error");
      } else {
        console.warn("[Inbox] Blocked: inbox_view is not enabled for this profile");
      }
      if (inboxScreen) inboxScreen.style.display = "none";
      if (inboxContent) inboxContent.style.opacity = "1";
      if (inboxBtn) inboxBtn.classList.remove("active");
      if (typeof window.ffUpdateMainNavTabVisibility === 'function') window.ffUpdateMainNavTabVisibility();
      return;
    }
    if (!inboxCanManageInbox() && inboxCanSendRequests()) {
      inboxViewMode = "mine";
    }
    loadCustomTypes().then(() => {
      loadInboxSettings().then(() => {
        setupInboxUI();
        loadInboxItems();
        // Show content when UI is ready and loading has started
        if (inboxContent) inboxContent.style.opacity = '1';
        if (typeof window.ffUpdateMainNavTabVisibility === 'function') window.ffUpdateMainNavTabVisibility();
        if (typeof onReady === 'function') {
          try {
            onReady();
          } catch (e) {
            console.warn('[Inbox] goToInbox onReady', e);
          }
        }
      });
    });
  });
}

async function loadCustomTypes() {
  if (!currentUserProfile?.salonId) return;
  try {
    const snap = await getDocs(collection(db, `salons/${currentUserProfile.salonId}/requestTypes`));
    customRequestTypes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    console.log('[Inbox] Custom request types loaded', customRequestTypes.length);
  } catch (err) {
    console.warn('[Inbox] Failed to load custom types', err);
    customRequestTypes = [];
  }
}

const INBOX_SETTINGS_DOC_ID = 'visibility';

async function loadInboxSettings() {
  if (!currentUserProfile?.salonId) return;
  try {
    const ref = doc(db, 'salons', currentUserProfile.salonId, 'inboxSettings', INBOX_SETTINGS_DOC_ID);
    const snap = await getDoc(ref);
    inboxHiddenTypes = Array.isArray(snap.data()?.hiddenRequestTypes) ? snap.data().hiddenRequestTypes : [];
  } catch (err) {
    console.warn('[Inbox] Failed to load inbox settings', err);
    inboxHiddenTypes = [];
  }
}

async function setInboxTypeVisibility(typeId, hidden) {
  if (!currentUserProfile?.salonId) return;
  if (hidden) {
    if (!inboxHiddenTypes.includes(typeId)) inboxHiddenTypes = [...inboxHiddenTypes, typeId];
  } else {
    inboxHiddenTypes = inboxHiddenTypes.filter(id => id !== typeId);
  }
  const salonId = currentUserProfile.salonId;
  const ref = doc(db, 'salons', salonId, 'inboxSettings', INBOX_SETTINGS_DOC_ID);
  await setDoc(ref, { hiddenRequestTypes: inboxHiddenTypes }, { merge: true });
}

function getAllRequestTypes() {
  const hidden = new Set(inboxHiddenTypes || []);
  const custom = (customRequestTypes || []).map(t => ({
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
  return [...withoutOther, ...customVisible, ...otherOnly];
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

async function loadCurrentUserProfile() {
  const user = auth.currentUser;
  if (!user) return null;
  _inboxUsersCache = null; // reset recipients cache on each profile load
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (userDoc.exists()) {
      currentUserProfile = { uid: user.uid, ...userDoc.data() };
      await mergeSalonStaffIntoUserProfile(currentUserProfile);
      console.log('[Inbox] User profile loaded', { role: currentUserProfile.role, permissions: currentUserProfile.permissions });
      // Register in members directory so others can find this user in "Send to"
      if (currentUserProfile.salonId) {
        const memberData = {
          name: currentUserProfile.name || currentUserProfile.displayName || user.email || '',
          role: currentUserProfile.role || '',
          staffId: currentUserProfile.staffId || '',
          email: user.email || ''
        };
        // Include avatarUrl so Chat, Tickets, Staff Members show the correct photo
        if (currentUserProfile.avatarUrl) {
          memberData.avatarUrl = currentUserProfile.avatarUrl;
          if (currentUserProfile.avatarUpdatedAtMs) {
            memberData.avatarUpdatedAtMs = currentUserProfile.avatarUpdatedAtMs;
          }
        }
        setDoc(doc(db, `salons/${currentUserProfile.salonId}/members`, user.uid), memberData, { merge: true })
          .catch(e => console.warn('[Inbox] Could not write member doc', e.message));
        // Birthday Inbox items depend on members + settings; run after directory row exists.
        setTimeout(() => {
          try {
            if (typeof window.ffRunBirthdayChatRemindersSoon === 'function') {
              window.ffRunBirthdayChatRemindersSoon();
            }
          } catch (e) {
            console.warn('[Inbox] ffRunBirthdayChatRemindersSoon', e);
          }
        }, 600);
      }
      return currentUserProfile;
    }
  } catch (err) {
    console.error('[Inbox] Failed to load user profile', err);
  }
  return null;
}

function setupInboxUI() {
  if (!currentUserProfile) return;

  const role = inboxUserRoleLc();
  const canManageInbox = inboxCanManageInbox();
  const canSend = inboxCanSendRequests();
  const sendOnlyDesk = !canManageInbox && canSend && role !== 'technician';

  // "New Request" — #inboxCreateRequestBtn lives in #inboxContentHeaderRow (visible for technicians; switcher is hidden for them)
  const headerNewBtn = document.getElementById('inboxCreateRequestBtn');
  const headerRow = document.getElementById('inboxContentHeaderRow');
  const emptyStateBtn  = document.getElementById('emptyStateNewRequestBtn');
  const emptyStateMsg  = document.getElementById('emptyStateMessage');
  const inboxTabs      = document.getElementById('inboxTabs');
  const listTitle      = document.getElementById('inboxListTitle');

  const canCreateRequests = canSend;
  const isAdminOrOwner = (role === 'admin' || role === 'owner');
  const manageTypesBtn = document.getElementById('btnManageRequestTypes');
  const settingsBtn = document.getElementById('inboxSettingsBtn');

  // New Request: show only when inbox_send (or manage) allows; hide in "To handle"
  const showNewRequest =
    canCreateRequests &&
    (role === 'technician' || sendOnlyDesk || inboxViewMode === 'mine');
  if (headerNewBtn) headerNewBtn.style.display = showNewRequest ? '' : 'none';
  // Hide empty-state New Request — only the header button is used
  if (emptyStateBtn) emptyStateBtn.style.display = 'none';
  if (manageTypesBtn) manageTypesBtn.style.display = 'none'; // use gear only
  // Gear settings button — ONLY for admin/owner with manage inbox, after Archived tab
  if (settingsBtn) {
    settingsBtn.style.display = isAdminOrOwner && canManageInbox ? 'flex' : 'none';
    settingsBtn.onclick = () => window.openInboxSettingsModal();
  }

  const filterRow = document.getElementById('inboxFilterRow');
  const staffFilterSelect = document.getElementById('inboxStaffFilterSelect');
  if (filterRow) filterRow.style.display = (role === 'technician') ? 'none' : 'flex';
  if (staffFilterSelect) {
    staffFilterSelect.onchange = () => {
      inboxStaffFilterUid = staffFilterSelect.value || '';
      renderInboxList();
    };
  }

  if (role === 'technician') {
    // Technicians see their own requests only — hide status tabs and view switcher
    const viewSwitcher = document.getElementById('inboxViewSwitcher');
    if (viewSwitcher) viewSwitcher.style.display = 'none';
    if (headerRow) headerRow.style.display = '';
    if (inboxTabs) inboxTabs.classList.add('hidden');
    if (listTitle) listTitle.textContent = canSend ? 'My Requests' : 'Inbox';
    if (emptyStateMsg) emptyStateMsg.textContent = canSend ? 'No requests yet' : 'No updates yet';
    currentInboxTab = 'my_requests';
  } else if (sendOnlyDesk) {
    inboxViewMode = 'mine';
    const viewSwitcher = document.getElementById('inboxViewSwitcher');
    if (viewSwitcher) viewSwitcher.style.display = 'none';
    if (filterRow) filterRow.style.display = 'none';
    if (headerRow) headerRow.style.display = '';
    if (listTitle) {
      listTitle.style.display = '';
      listTitle.textContent = 'My Requests';
    }
    if (inboxTabs) {
      inboxTabs.classList.add('hidden');
      inboxTabs.style.display = 'none';
    }
    if (emptyStateBtn) emptyStateBtn.style.display = 'none';
    currentInboxTab = 'my_requests';
    if (emptyStateMsg) emptyStateMsg.textContent = 'No requests yet';
  } else if (canManageInbox) {
    // Manager / Admin / Owner — show view switcher (My Requests | To handle)
    const viewSwitcher = document.getElementById('inboxViewSwitcher');
    if (viewSwitcher) viewSwitcher.style.display = 'flex';
    document.querySelectorAll('.inbox-view-btn').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.inboxView || '') === inboxViewMode);
    });
    if (filterRow) filterRow.style.display = inboxViewMode === 'mine' ? 'none' : 'flex';
    if (listTitle) listTitle.style.display = inboxViewMode === 'mine' ? '' : 'none';
    if (listTitle) listTitle.textContent = 'My Requests';
    if (headerRow) headerRow.style.display = inboxViewMode === 'mine' ? '' : 'none';
    // In "My Requests": hide status tabs (Open/Needs Info/etc) and center New Request button
    if (inboxViewMode === 'mine') {
      if (inboxTabs) { inboxTabs.classList.add('hidden'); inboxTabs.style.display = 'none'; }
    } else {
      if (inboxTabs) { inboxTabs.classList.remove('hidden'); inboxTabs.style.display = ''; }
    }
    if (emptyStateBtn) emptyStateBtn.style.display = 'none';
    currentInboxTab = currentInboxTab || 'open';
    if (emptyStateMsg) emptyStateMsg.textContent = 'No requests in this category';
    document.querySelectorAll('.inbox-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.inboxTab === currentInboxTab);
    });
  } else {
    // View inbox without send/manage — minimal UI
    const viewSwitcher = document.getElementById('inboxViewSwitcher');
    if (viewSwitcher) viewSwitcher.style.display = 'none';
    if (filterRow) filterRow.style.display = 'none';
    if (headerRow) headerRow.style.display = 'none';
    if (inboxTabs) {
      inboxTabs.classList.add('hidden');
      inboxTabs.style.display = 'none';
    }
    if (listTitle) {
      listTitle.style.display = '';
      listTitle.textContent = 'Inbox';
    }
    if (emptyStateBtn) emptyStateBtn.style.display = 'none';
    if (emptyStateMsg) emptyStateMsg.textContent = 'No access to requests for this account';
  }
}

// =====================
// View Mode (My Requests | To handle) — called from HTML onclick
// =====================
window.setInboxViewMode = function(mode) {
  if (!currentUserProfile || inboxUserRoleLc() === "technician") return;
  if (mode === "to_handle" && !inboxCanManageInbox()) return;
  inboxViewMode = mode;
  document.querySelectorAll('.inbox-view-btn').forEach(b => {
    b.classList.toggle('active', (b.dataset.inboxView || '') === mode);
  });
  const listTitle = document.getElementById('inboxListTitle');
  const filterRow = document.getElementById('inboxFilterRow');
  const inboxTabs = document.getElementById('inboxTabs');
  const emptyStateBtn = document.getElementById('emptyStateNewRequestBtn');
  const headerNewBtn = document.getElementById('inboxCreateRequestBtn');
  const headerRow = document.getElementById('inboxContentHeaderRow');
  if (listTitle) listTitle.style.display = mode === 'mine' ? '' : 'none';
  if (listTitle) listTitle.textContent = 'My Requests';
  if (headerRow) headerRow.style.display = mode === 'mine' ? '' : 'none';
  if (filterRow) filterRow.style.display = mode === 'mine' ? 'none' : 'flex';
  if (mode === 'mine') {
    if (inboxTabs) { inboxTabs.classList.add('hidden'); inboxTabs.style.display = 'none'; }
  } else {
    if (inboxTabs) { inboxTabs.classList.remove('hidden'); inboxTabs.style.display = ''; }
  }
  if (emptyStateBtn) emptyStateBtn.style.display = 'none';
  if (headerNewBtn) headerNewBtn.style.display = mode === 'mine' && inboxCanSendRequests() ? '' : 'none';
  loadInboxItems();
};

// =====================
// Tab Management
// =====================
window.setInboxTab = function(tab) {
  currentInboxTab = tab;
  // Update active tab
  document.querySelectorAll('.inbox-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.inboxTab === tab);
  });
  loadInboxItems();
};

// =====================
// Load & Render Requests
// =====================
async function loadInboxItems() {
  if (!currentUserProfile) return;
  
  const salonId = currentUserProfile.salonId;
  const role = inboxUserRoleLc();
  const uid = currentUserProfile.uid;

  console.log('[Inbox] loadInboxItems', { salonId, role, uid });

  // Guard: salonId must exist, otherwise rules will always deny
  if (!salonId) {
    console.error('[Inbox] salonId is missing from user profile', currentUserProfile);
    const emptyEl = document.getElementById('inboxEmpty');
    const loadingEl = document.getElementById('inboxLoading');
    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl) {
      emptyEl.style.display = 'block';
      emptyEl.innerHTML = `
        <div style="color:#ef4444;">
          <div style="font-size:16px;font-weight:500;margin-bottom:8px;">Setup required</div>
          <div style="font-size:14px;">Your account is not linked to a salon. Please contact support.</div>
        </div>
      `;
    }
    return;
  }
  
  // Unsubscribe from previous listener
  if (inboxUnsubscribe) {
    inboxUnsubscribe();
    inboxUnsubscribe = null;
  }
  
  // Show loading
  const loadingEl = document.getElementById('inboxLoading');
  const emptyEl = document.getElementById('inboxEmpty');
  const listEl = document.getElementById('inboxList');
  
  if (loadingEl) loadingEl.style.display = 'block';
  if (emptyEl) emptyEl.style.display = 'none';
  if (listEl) {
    listEl.querySelectorAll('.inbox-group-header, .inbox-group-body').forEach(el => el.remove());
  }
  
  try {
    // Build query based on role and tab
    let q;
    
    if (role === 'technician') {
      // Technicians: outgoing (to managers) + incoming (e.g. document renewal directed to them)
      _techInboxOutgoing = [];
      _techInboxIncoming = [];
      const qOut = query(
        collection(db, `salons/${salonId}/inboxItems`),
        where('createdByUid', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(50)
      );
      const qIn = query(
        collection(db, `salons/${salonId}/inboxItems`),
        where('forUid', '==', uid),
        orderBy('lastActivityAt', 'desc'),
        limit(50)
      );
      const unsubOut = onSnapshot(
        qOut,
        (snapshot) => {
          _techInboxOutgoing = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          applyTechInboxMerge(loadingEl);
        },
        (error) => {
          console.error('[Inbox] Technician outgoing query error', error);
          if (loadingEl) loadingEl.style.display = 'none';
          currentRequests = [];
          if (listEl) listEl.querySelectorAll('.inbox-group-header, .inbox-group-body').forEach((el) => el.remove());
          if (emptyEl) {
            emptyEl.style.display = 'block';
            emptyEl.innerHTML = `
          <div style="color:#ef4444;">
            <div style="font-size:16px;font-weight:500;margin-bottom:8px;">Error loading requests</div>
            <div style="font-size:14px;">${error.message || 'Please try again'}</div>
          </div>
        `;
          }
        }
      );
      const unsubIn = onSnapshot(
        qIn,
        (snapshot) => {
          _techInboxIncoming = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          applyTechInboxMerge(loadingEl);
        },
        (error) => {
          console.error('[Inbox] Technician incoming query error', error);
          if (loadingEl) loadingEl.style.display = 'none';
          currentRequests = [];
          if (listEl) listEl.querySelectorAll('.inbox-group-header, .inbox-group-body').forEach((el) => el.remove());
          if (emptyEl) {
            emptyEl.style.display = 'block';
            emptyEl.innerHTML = `
          <div style="color:#ef4444;">
            <div style="font-size:16px;font-weight:500;margin-bottom:8px;">Error loading requests</div>
            <div style="font-size:14px;">${error.message || 'Please try again'}</div>
          </div>
        `;
          }
        }
      );
      inboxUnsubscribe = () => {
        unsubOut();
        unsubIn();
      };
      return;
    } else if (role !== "technician" && !inboxCanManageInbox() && !inboxCanSendRequests()) {
      if (loadingEl) loadingEl.style.display = "none";
      currentRequests = [];
      updateInboxStaffFilterOptions();
      updateInboxBadges();
      renderInboxList();
      return;
    } else if (inboxViewMode === "mine" || !inboxCanManageInbox()) {
      // "My Requests" (created by me) — send-only staff use this path only
      q = query(
        collection(db, `salons/${salonId}/inboxItems`),
        where('createdByUid', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(50)
      );
    } else {
      // "To handle" — full inbox managers only
      if (currentInboxTab === 'open') {
        q = query(
          collection(db, `salons/${salonId}/inboxItems`),
          where('forUid', '==', uid),
          where('status', 'in', ['open', 'pending']),
          orderBy('lastActivityAt', 'desc'),
          limit(50)
        );
      } else if (currentInboxTab === 'needs_info') {
        q = query(
          collection(db, `salons/${salonId}/inboxItems`),
          where('forUid', '==', uid),
          where('status', '==', 'needs_info'),
          orderBy('lastActivityAt', 'desc'),
          limit(50)
        );
      } else if (currentInboxTab === 'approved') {
        q = query(
          collection(db, `salons/${salonId}/inboxItems`),
          where('forUid', '==', uid),
          where('status', 'in', ['approved', 'done']),
          orderBy('lastActivityAt', 'desc'),
          limit(50)
        );
      } else if (currentInboxTab === 'denied') {
        q = query(
          collection(db, `salons/${salonId}/inboxItems`),
          where('forUid', '==', uid),
          where('status', '==', 'denied'),
          orderBy('lastActivityAt', 'desc'),
          limit(50)
        );
      } else if (currentInboxTab === 'archived') {
        q = query(
          collection(db, `salons/${salonId}/inboxItems`),
          where('forUid', '==', uid),
          where('status', '==', 'archived'),
          orderBy('lastActivityAt', 'desc'),
          limit(50)
        );
      } else {
        q = query(
          collection(db, `salons/${salonId}/inboxItems`),
          where('forUid', '==', uid),
          where('status', 'in', ['open', 'pending']),
          orderBy('lastActivityAt', 'desc'),
          limit(50)
        );
      }
    }
    
    // Listen for changes
    inboxUnsubscribe = onSnapshot(q, (snapshot) => {
      if (loadingEl) loadingEl.style.display = 'none';

      currentRequests = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      console.log('[Inbox] Loaded', currentRequests.length, 'requests');
      updateInboxStaffFilterOptions();
      updateInboxBadges();
      // Always call renderInboxList — it cleans up old DOM elements even when empty
      renderInboxList();
    }, (error) => {
      console.error('[Inbox] Query error', error);
      if (loadingEl) loadingEl.style.display = 'none';
      currentRequests = [];
      if (listEl) listEl.querySelectorAll('.inbox-group-header, .inbox-group-body').forEach(el => el.remove());
      if (emptyEl) {
        emptyEl.style.display = 'block';
        emptyEl.innerHTML = `
          <div style="color:#ef4444;">
            <div style="font-size:16px;font-weight:500;margin-bottom:8px;">Error loading requests</div>
            <div style="font-size:14px;">${error.message || 'Please try again'}</div>
          </div>
        `;
      }
    });
    
  } catch (error) {
    console.error('[Inbox] Load error', error);
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

/** Update red badges: Open tab + INBOX nav button */
/** Update unread badges on tabs and nav INBOX button. */
function updateInboxBadges() {
  if (!inboxCanManageInbox()) return;

  const uid = currentUserProfile.uid;

  // Open: new requests not yet seen by recipient
  const openCount = currentRequests.filter(
    (r) =>
      r.forUid === uid &&
      (r.status === "open" || r.status === "pending") &&
      r.unreadForManagers === true
  ).length;

  // Needs Info: requests where staff replied but recipient hasn't seen it yet
  const needsInfoCount = currentRequests.filter(
    r => r.forUid === uid && r.status === 'needs_info' && r.unreadForManagers === true
  ).length;

  const totalCount = openCount + needsInfoCount;

  // Badge on Open tab
  const openBadge = document.getElementById('inboxOpenBadge');
  if (openBadge) openBadge.textContent = openCount > 0 ? openCount : '';

  // Badge on Needs Info tab
  const needsInfoBadge = document.getElementById('inboxNeedsInfoBadge');
  if (needsInfoBadge) needsInfoBadge.textContent = needsInfoCount > 0 ? needsInfoCount : '';

  // Nav INBOX badge = total unread (Open + Needs Info)
  const navBadge = document.querySelector('#inboxBtn .ff-inbox-badge');
  if (navBadge) navBadge.textContent = totalCount > 0 ? totalCount : '';
}

function updateInboxStaffFilterOptions() {
  const sel = document.getElementById('inboxStaffFilterSelect');
  if (!sel) return;
  const role = inboxUserRoleLc();
  if (role === "technician") return;

  const seen = new Map();
  currentRequests.forEach(req => {
    const uid = req.forUid || req.createdByUid || '';
    const name = (req.forStaffName || req.createdByName || '').trim() || uid || 'Unknown';
    if (uid && !seen.has(uid)) seen.set(uid, name);
  });
  const options = [['', 'ALL STAFF']];
  seen.forEach((name, uid) => options.push([uid, name]));
  const current = inboxStaffFilterUid;
  if (!options.some(([v]) => v === current)) inboxStaffFilterUid = '';

  sel.innerHTML = '';
  for (const [val, lab] of options) {
    const o = document.createElement('option');
    o.value = val;
    o.textContent = lab;
    sel.appendChild(o);
  }
  sel.value = inboxStaffFilterUid;
}

function renderInboxList() {
  try {
    _renderInboxListInner();
  } catch (e) {
    console.error('[Inbox] renderInboxList failed', e);
    const loadingEl = document.getElementById('inboxLoading');
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

function _renderInboxListInner() {
  const listEl = document.getElementById('inboxList');
  if (!listEl) return;

  // Title by role and view: technician = "My Requests"; manager "mine" / "To handle"
  const listTitle = document.getElementById('inboxListTitle');
  const role = inboxUserRoleLc();
  if (listTitle) {
    if (role === "technician") listTitle.textContent = inboxCanSendRequests() ? "My Requests" : "Inbox";
    else {
      listTitle.style.display = inboxViewMode === 'mine' ? '' : 'none';
      listTitle.textContent = 'My Requests';
    }
  }

  // Remove only dynamically-added group elements (preserve loading/empty state divs)
  listEl.querySelectorAll('.inbox-group-header, .inbox-group-body').forEach(el => el.remove());

  const emptyEl = document.getElementById('inboxEmpty');
  const loadingEl = document.getElementById('inboxLoading');

  let requestsToShow = currentRequests;

  // Technician merged list is already noise-filtered in applyTechInboxMerge; keep filter here if data came from elsewhere.
  if (role === "technician") {
    requestsToShow = inboxTechnicianNoiseFilter(requestsToShow);
  }

  // Admin/manager "My Requests": createdByUid query can still return automated rows (scanner uid) + staff-call noise
  if (role !== "technician" && inboxViewMode === "mine" && inboxCanManageInbox()) {
    requestsToShow = requestsToShow.filter((r) => !MANAGER_ONLY_INBOX_TYPES.has(String(r.type || "").trim()));
    requestsToShow = requestsToShow.filter((r) => !ffInboxIsStaffCallOtherNoise(r));
  }

  // Client-side status filter to prevent flicker when Firestore sends intermediate snapshots
  if (inboxViewMode === 'to_handle' || role === 'technician') {
    if (currentInboxTab === 'open') {
      requestsToShow = requestsToShow.filter((r) => r.status === "open" || r.status === "pending");
    } else if (currentInboxTab === 'needs_info') {
      requestsToShow = requestsToShow.filter(r => r.status === 'needs_info');
    } else if (currentInboxTab === 'approved') {
      requestsToShow = requestsToShow.filter(r => r.status === 'approved' || r.status === 'done');
    } else if (currentInboxTab === 'denied') {
      requestsToShow = requestsToShow.filter(r => r.status === 'denied');
    } else if (currentInboxTab === 'archived') {
      requestsToShow = requestsToShow.filter(r => r.status === 'archived');
    }
  }

  if (role !== 'technician' && inboxViewMode !== 'mine' && inboxStaffFilterUid) {
    requestsToShow = requestsToShow.filter(r => (r.forUid || r.createdByUid) === inboxStaffFilterUid);
  }

  if (requestsToShow.length === 0) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl) {
      emptyEl.style.display = 'block';
      const msgEl = emptyEl.querySelector('#emptyStateMessage');
      if (msgEl) {
        msgEl.textContent = inboxStaffFilterUid ? 'No requests from this staff in this tab' : 'No requests in this category';
      }
    }
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  if (loadingEl) loadingEl.style.display = 'none';

  const showMgrUnread = inboxCanManageInbox();

  // Group requests by type (use filtered list)
  const groups = {};
  requestsToShow.forEach(req => {
    const key = inboxEffectiveTypeForGrouping(req) || 'other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(req);
  });

  // Order: by category (schedule → payments → operations), then custom type ids, then other last
  const typeOrder = [
    'vacation','day_off','time_off','late_start','early_leave','schedule_change','extra_shift','swap_shift','break_change',
    'commission_review','tip_adjustment','payment_issue',
    'supplies','maintenance','client_issue','staff_birthday_reminder',
    'document_request','document_renewal_request','document_upload','document_expiring_soon','document_expired',
    'other'
  ];
  const sortedKeys = Object.keys(groups).sort((a, b) => {
    const ai = typeOrder.indexOf(a);
    const bi = typeOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  sortedKeys.forEach(type => {
    const requests = groups[type];
    const typeInfo = getRequestTypeInfo(type);
    const unreadCount = showMgrUnread ? requests.filter(r => r.unreadForManagers === true).length : 0;
    const hasUnread = unreadCount > 0;

    // Left: icon + label. Right: (total) grey, unread count red when > 0, then arrow
    const header = document.createElement('div');
    header.className = 'inbox-group-header';
    header.style.cssText = `
      display:flex; align-items:center; justify-content:space-between;
      padding:12px 16px; background:#fff; border:1px solid #e5e7eb;
      border-radius:8px; cursor:pointer; margin-bottom:4px; user-select:none;
    `;
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:18px;">${typeInfo.icon}</span>
        <span style="font-weight:600;font-size:14px;color:#111;">${typeInfo.label}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="color:#6b7280;font-size:13px;font-weight:500;">(${requests.length})</span>
        ${hasUnread ? `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;background:#ef4444;color:#fff;font-size:11px;font-weight:600;border-radius:50%;" title="Not yet opened">${unreadCount}</span>` : ''}
        <span class="inbox-group-arrow" style="color:#9ca3af;font-size:11px;transition:transform 0.2s;">▼</span>
      </div>
    `;

    // Group body — collapsed by default
    const body = document.createElement('div');
    body.className = 'inbox-group-body';
    body.style.cssText = 'flex-direction:column;gap:8px;margin-bottom:8px;';
    body.style.display = 'none';

    requests.forEach(req => {
      const card = createRequestCard(req);
      body.appendChild(card);
    });

    // Toggle on click
    header.addEventListener('click', () => {
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : 'flex';
      const arrow = header.querySelector('.inbox-group-arrow');
      if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(180deg)';
    });

    listEl.appendChild(header);
    listEl.appendChild(body);
  });
}

function createRequestCard(request) {
  const card = document.createElement('div');
  card.className = 'inbox-item-card';
  card.onclick = () => showRequestDetails(request.id);

  const typeInfo = getRequestTypeInfo(request.type);
  const statusStr = String(request.status != null ? request.status : "open");
  const statusDisplay = inboxSupplyStatusDisplayLabel(request) || statusStr.replace(/_/g, " ");
  const statusClass = `inbox-status-${statusStr.replace(/_/g, "-")}`;
  const createdDate = request.createdAt?.toDate ? request.createdAt.toDate() : new Date();
  const dateStr = formatRelativeDate(createdDate);

  if (request.type === 'document_expiring_soon' || request.type === 'document_expired') {
    const isSoon = !inboxDocAlertIsExpiredForUi(request);
    const he = ffDocAlertIsHebrewUI();
    const badgeLabel = isSoon ? (he ? 'יפוג בקרוב' : 'Expiring soon') : (he ? 'פג תוקף' : 'Expired');
    const boxStyle = isSoon
      ? 'border-left:4px solid #d97706;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;'
      : 'border-left:4px solid #b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px 14px;';
    const badgeBg = isSoon ? '#fef3c7' : '#fee2e2';
    const badgeColor = isSoon ? '#92400e' : '#991b1b';
    const msg = (request.message || request.data?.message || '').trim();
    card.innerHTML = `
      <div style="${boxStyle}">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <div style="font-size:26px;line-height:1;">${typeInfo.icon}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
              <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;background:${badgeBg};color:${badgeColor};">${escapeHtml(badgeLabel)}</span>
              <span class="inbox-status-badge ${statusClass}">${statusStr.replace(/_/g, ' ')}</span>
            </div>
            <div style="font-size:14px;font-weight:600;color:#111827;line-height:1.45;margin-bottom:6px;">
              ${escapeHtml(ffDocAlertHumanSummary(request))}
            </div>
            <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:12px;color:#4b5563;">
              <span style="color:#9ca3af;">${he ? 'עובד' : 'Employee'}</span><span style="font-weight:500;">${escapeHtml(ffDocAlertStaffName(request))}</span>
              <span style="color:#9ca3af;">${he ? 'מסמך' : 'Document'}</span><span style="font-weight:500;word-break:break-word;">${escapeHtml(ffDocAlertDocTitle(request))}</span>
              <span style="color:#9ca3af;">${he ? 'תפוגה' : 'Expires'}</span><span>${escapeHtml(ffDocAlertExpFormattedLong(request) || '—')}</span>
            </div>
            ${msg ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(0,0,0,0.06);font-size:12px;color:#374151;line-height:1.4;">${escapeHtml(msg)}</div>` : ''}
            <div style="margin-top:8px;font-size:11px;color:#9ca3af;">${he ? 'נוצר' : 'Logged'} · ${escapeHtml(dateStr)}</div>
          </div>
        </div>
      </div>
    `;
    return card;
  }

  card.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:12px;">
      <div style="font-size:24px;">${typeInfo.icon}</div>
      <div style="flex:1;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="font-weight:600;font-size:14px;color:#111;">${typeInfo.label}</span>
          <span class="inbox-status-badge ${statusClass}">${statusDisplay}</span>
          ${request.priority === 'urgent' ? '<span style="color:#ef4444;font-size:12px;">🔥 Urgent</span>' : ''}
        </div>
        <div style="font-size:13px;color:#6b7280;margin-bottom:8px;">
          ${request.type === 'staff_birthday_reminder' && request.data?.subjectStaffName
            ? escapeHtml(request.data.subjectStaffName) + ' • ' + dateStr
            : `${request.forStaffName} • ${dateStr}`}
        </div>
        <div style="font-size:13px;color:#374151;">
          ${getRequestSummary(request)}
        </div>
      </div>
    </div>
  `;

  return card;
}

function getRequestTypeInfo(type) {
  const all = getAllRequestTypes();
  const found = all.find(t => t.id === type);
  if (found) return found;
  if (type && LEGACY_INBOX_TYPE_INFO[type]) return LEGACY_INBOX_TYPE_INFO[type];
  const builtinOnly = BUILTIN_TYPES.find(t => t.id === type);
  return builtinOnly || { icon: '📝', label: type || 'Request', description: '', fields: [] };
}

function escapeHtml(s) {
  if (!s) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/** Supply requests use pending → approved | denied; legacy supplies may still be status open. */
function inboxSupplyRequestIsPending(request) {
  if (!request || String(request.type || "").trim() !== "supplies") return false;
  const s = String(request.status || "").trim();
  return s === "pending" || s === "open";
}

/** Human-readable decision label for supply requests (modal + cards + details). */
function inboxSupplyStatusDisplayLabel(request) {
  if (!request || String(request.type || "").trim() !== "supplies") return null;
  const s = String(request.status || "").trim();
  if (s === "pending" || s === "open") return "Pending";
  if (s === "approved") return "Approved";
  if (s === "denied") return "Denied";
  return s.replace(/_/g, " ");
}

const FF_INVENTORY_SUPPLY_VARIANT_KEYS = new Set(["dip", "gel", "regular"]);

function parseApprovedSupplyLineQty(line) {
  const q = line?.qty;
  if (q == null || q === "") return null;
  const n = typeof q === "number" ? q : Number(String(q).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function parseApprovedSupplyLineUnit(line) {
  const u = line?.unit;
  if (u == null || u === "") return null;
  const t = String(u).trim();
  return t === "" ? null : t.slice(0, 80);
}

/**
 * For each line item with a valid inventory item id, increment approval metadata on that doc.
 * When variantKey is dip|gel|regular, also updates variants.[key].approvedRequestsCount (+ timestamps / request id).
 * When qty is a valid positive integer, accumulates approved requested qty metadata (item + variant when applicable).
 * Does not change targetStock, currentStock, or order quantities.
 */
async function applyApprovedSupplyRequestToInventory(requestId, requestData) {
  const salonId = currentUserProfile?.salonId;
  if (!salonId) return;
  const rid = String(requestId || "").trim();
  if (!rid) return;
  const items = Array.isArray(requestData?.items) ? requestData.items : [];
  for (const line of items) {
    const itemId = String(line?.itemId || "").trim();
    if (!itemId) continue;
    const vkRaw = String(line?.variantKey ?? "").trim().toLowerCase();
    const variantKey = FF_INVENTORY_SUPPLY_VARIANT_KEYS.has(vkRaw) ? vkRaw : null;
    const qty = parseApprovedSupplyLineQty(line);
    const unit = parseApprovedSupplyLineUnit(line);

    const ref = doc(db, `salons/${salonId}/inventoryItems`, itemId);
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) continue;
      const patch = {
        approvedRequestsCount: increment(1),
        lastApprovedRequestAt: serverTimestamp(),
        lastApprovedRequestId: rid,
        updatedAt: serverTimestamp(),
      };
      if (qty != null) {
        patch.approvedRequestedQtyTotal = increment(qty);
        patch.lastApprovedRequestedQty = qty;
        patch.lastApprovedRequestedUnit = unit;
      }
      if (variantKey) {
        patch[`variants.${variantKey}.approvedRequestsCount`] = increment(1);
        patch[`variants.${variantKey}.lastApprovedRequestAt`] = serverTimestamp();
        patch[`variants.${variantKey}.lastApprovedRequestId`] = rid;
      }
      if (variantKey && qty != null) {
        patch[`variants.${variantKey}.approvedRequestedQtyTotal`] = increment(qty);
        patch[`variants.${variantKey}.lastApprovedRequestedQty`] = qty;
        patch[`variants.${variantKey}.lastApprovedRequestedUnit`] = unit;
      }
      await updateDoc(ref, patch);
    } catch (e) {
      console.warn("[Inbox] applyApprovedSupplyRequestToInventory skip", itemId, e);
    }
  }
}

async function approveSupplyRequest(requestId, requestData) {
  const salonId = currentUserProfile.salonId;
  const inboxRef = doc(db, `salons/${salonId}/inboxItems`, requestId);
  await applyApprovedSupplyRequestToInventory(requestId, requestData);
  await updateDoc(inboxRef, {
    status: "approved",
    approvedAt: serverTimestamp(),
    approvedBy: currentUserProfile.uid,
    decidedAt: serverTimestamp(),
    decidedBy: currentUserProfile.uid,
    lastActivityAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    unreadForManagers: false,
  });
}

async function denySupplyRequest(requestId, responseNote) {
  const salonId = currentUserProfile.salonId;
  const inboxRef = doc(db, `salons/${salonId}/inboxItems`, requestId);
  await updateDoc(inboxRef, {
    status: "denied",
    deniedAt: serverTimestamp(),
    deniedBy: currentUserProfile.uid,
    decidedAt: serverTimestamp(),
    decidedBy: currentUserProfile.uid,
    responseNote: responseNote != null && String(responseNote).trim() !== "" ? String(responseNote).trim() : null,
    lastActivityAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    unreadForManagers: false,
  });
}

// --- Supplies request form: inventory master (categories → subcategories → items) ---

const SUPPLIES_VARIANT_LABELS = { dip: "Dip", gel: "Gel", regular: "Regular" };

/** Heuristic: category/subcategory names suggest dip/gel/regular inventory. */
function suppliesCategorySubcategoryVariantsRelevant(categoryName, subcategoryName) {
  const s = `${categoryName || ""} ${subcategoryName || ""}`.toLowerCase();
  if (!s.trim()) return false;
  return /(dip|gel|powder|acrylic|lacquer|polish|color|nail)/.test(s);
}

function suppliesRowRequiresVariant(row) {
  const itemSel = row.querySelector(".supplies-item-select");
  const itemId = (itemSel?.value || "").trim();
  if (!itemId) return false;
  const itemOpt = itemSel?.selectedOptions?.[0];
  const hasVariants = itemOpt?.getAttribute("data-has-variants") === "1";
  const catOpt = row.querySelector(".supplies-cat-select")?.selectedOptions?.[0];
  const subOpt = row.querySelector(".supplies-sub-select")?.selectedOptions?.[0];
  const catName = catOpt?.getAttribute("data-category-name") || "";
  const subName = subOpt?.getAttribute("data-subcategory-name") || "";
  return hasVariants || suppliesCategorySubcategoryVariantsRelevant(catName, subName);
}

function syncSuppliesRowVariantUi(row) {
  const itemSel = row.querySelector(".supplies-item-select");
  const varWrap = row.querySelector(".supplies-variant-wrap");
  const varSel = row.querySelector(".supplies-variant-select");
  if (!varWrap || !varSel) return;
  const itemId = (itemSel?.value || "").trim();
  if (!itemId) {
    varWrap.style.display = "none";
    varSel.disabled = true;
    varSel.value = "";
    return;
  }
  const need = suppliesRowRequiresVariant(row);
  if (need) {
    varWrap.style.display = "block";
    varSel.disabled = false;
  } else {
    varWrap.style.display = "none";
    varSel.disabled = true;
    varSel.value = "";
  }
}

const SUPPLIES_ITEM_ROW_INNER_HTML = `
  <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;">
    <div style="flex:1;min-width:140px;">
      <span style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px;">Category</span>
      <select class="supplies-cat-select" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;">
        <option value="">Select…</option>
      </select>
    </div>
    <div style="flex:1;min-width:140px;">
      <span style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px;">Subcategory</span>
      <select class="supplies-sub-select" disabled style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;opacity:0.88;">
        <option value="">Select…</option>
      </select>
    </div>
    <div style="flex:1.2;min-width:180px;">
      <span style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px;">Item</span>
      <select class="supplies-item-select" disabled style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;opacity:0.88;">
        <option value="">Select…</option>
      </select>
    </div>
    <div class="supplies-variant-wrap" style="display:none;min-width:108px;">
      <span style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px;">Variant</span>
      <select class="supplies-variant-select" disabled style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;opacity:0.88;">
        <option value="">Select…</option>
        <option value="dip">Dip</option>
        <option value="gel">Gel</option>
        <option value="regular">Regular</option>
      </select>
    </div>
    <div style="width:76px;">
      <span style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px;">Qty</span>
      <input type="number" class="supplies-item-quantity" min="0" step="1" placeholder="—" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;" />
    </div>
    <div style="min-width:104px;">
      <span style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px;">Unit</span>
      <select class="supplies-item-unit" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;">
        <option value="pcs">pcs</option>
        <option value="box">box</option>
        <option value="bottle">bottle</option>
        <option value="case">case</option>
        <option value="roll">roll</option>
        <option value="pack">pack</option>
        <option value="lb">lb</option>
        <option value="oz">oz</option>
        <option value="ml">ml</option>
        <option value="gal">gal</option>
      </select>
    </div>
    <button type="button" class="supplies-item-remove" title="Remove line" style="padding:8px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;cursor:pointer;align-self:flex-end;">🗑️</button>
  </div>
`.trim();

async function ffFetchInventoryCategoriesForSupplies() {
  const salonId = currentUserProfile?.salonId;
  if (!salonId) return [];
  const q = query(
    collection(db, `salons/${salonId}/inventoryCategories`),
    orderBy("order", "asc"),
    orderBy("name", "asc")
  );
  const snap = await getDocs(q);
  const arr = [];
  snap.forEach((d) => {
    const data = d.data();
    arr.push({
      id: d.id,
      name: String(data.name || "").trim() || "Untitled",
    });
  });
  return arr;
}

async function ffFetchInventorySubcategoriesForSupplies(categoryId) {
  const cid = String(categoryId || "").trim();
  const salonId = currentUserProfile?.salonId;
  if (!cid || !salonId) return [];
  const q = query(
    collection(db, `salons/${salonId}/inventoryCategories/${cid}/inventorySubcategories`),
    orderBy("order", "asc"),
    orderBy("name", "asc")
  );
  const snap = await getDocs(q);
  const arr = [];
  snap.forEach((d) => {
    const data = d.data();
    arr.push({
      id: d.id,
      name: String(data.name || "").trim() || "Untitled",
    });
  });
  return arr;
}

async function ffFetchInventoryItemsForSupplies(categoryId, subcategoryId) {
  const cid = String(categoryId || "").trim();
  const sid = String(subcategoryId || "").trim();
  const salonId = currentUserProfile?.salonId;
  if (!cid || !sid || !salonId) return [];
  const q = query(
    collection(db, `salons/${salonId}/inventoryItems`),
    where("categoryId", "==", cid),
    where("subcategoryId", "==", sid),
    orderBy("order", "asc"),
    orderBy("name", "asc")
  );
  const snap = await getDocs(q);
  const arr = [];
  snap.forEach((d) => {
    const data = d.data();
    let internalNumber = null;
    if (data.internalNumber != null && data.internalNumber !== "") {
      const n = typeof data.internalNumber === "number" ? data.internalNumber : Number(data.internalNumber);
      internalNumber = Number.isFinite(n) ? n : null;
    }
    const name = String(data.name || "").trim() || "Untitled";
    const label = internalNumber != null ? `#${internalNumber} ${name}` : name;
    arr.push({
      id: d.id,
      name,
      label,
      internalNumber,
      hasVariants: data.hasVariants === true,
      brand: data.brand != null && String(data.brand).trim() !== "" ? String(data.brand).trim() : null,
      brandCode: data.brandCode != null && String(data.brandCode).trim() !== "" ? String(data.brandCode).trim() : null,
    });
  });
  return arr;
}

function wireSuppliesItemRow(row, categories) {
  const catSel = row.querySelector(".supplies-cat-select");
  const subSel = row.querySelector(".supplies-sub-select");
  const itemSel = row.querySelector(".supplies-item-select");
  if (!catSel || !subSel || !itemSel) return;

  catSel.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = "Select…";
  catSel.appendChild(ph);
  for (const c of categories) {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = c.name;
    o.setAttribute("data-category-name", c.name);
    catSel.appendChild(o);
  }

  const onCatChange = async () => {
    const cid = catSel.value.trim();
    subSel.innerHTML = "";
    const sph = document.createElement("option");
    sph.value = "";
    sph.textContent = "Select…";
    subSel.appendChild(sph);
    itemSel.innerHTML = "";
    const iph = document.createElement("option");
    iph.value = "";
    iph.textContent = "Select…";
    itemSel.appendChild(iph);
    itemSel.disabled = true;
    if (!cid) {
      subSel.disabled = true;
      syncSuppliesRowVariantUi(row);
      return;
    }
    subSel.disabled = false;
    let subs = [];
    try {
      subs = await ffFetchInventorySubcategoriesForSupplies(cid);
    } catch (e) {
      console.error("[Inbox] supplies subcategories", e);
    }
    for (const s of subs) {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.name;
      o.setAttribute("data-subcategory-name", s.name);
      subSel.appendChild(o);
    }
    syncSuppliesRowVariantUi(row);
  };

  const onSubChange = async () => {
    const cid = catSel.value.trim();
    const sid = subSel.value.trim();
    itemSel.innerHTML = "";
    const iph = document.createElement("option");
    iph.value = "";
    iph.textContent = "Select…";
    itemSel.appendChild(iph);
    if (!cid || !sid) {
      itemSel.disabled = true;
      syncSuppliesRowVariantUi(row);
      return;
    }
    itemSel.disabled = false;
    let items = [];
    try {
      items = await ffFetchInventoryItemsForSupplies(cid, sid);
    } catch (e) {
      console.error("[Inbox] supplies items", e);
    }
    for (const it of items) {
      const o = document.createElement("option");
      o.value = it.id;
      o.textContent = it.label;
      o.setAttribute("data-item-name", it.name);
      o.setAttribute("data-has-variants", it.hasVariants ? "1" : "0");
      if (it.internalNumber != null && it.internalNumber !== "") {
        o.setAttribute("data-internal-number", String(it.internalNumber));
      }
      if (it.brand) o.setAttribute("data-brand", it.brand);
      if (it.brandCode) o.setAttribute("data-brand-code", it.brandCode);
      itemSel.appendChild(o);
    }
    syncSuppliesRowVariantUi(row);
  };

  catSel.addEventListener("change", () => {
    void onCatChange();
  });
  subSel.addEventListener("change", () => {
    void onSubChange();
  });
  itemSel.addEventListener("change", () => {
    syncSuppliesRowVariantUi(row);
  });

  const rm = row.querySelector(".supplies-item-remove");
  rm?.addEventListener("click", () => {
    row.remove();
  });

  syncSuppliesRowVariantUi(row);
}

function classifySuppliesRow(row) {
  const cat = (row.querySelector(".supplies-cat-select")?.value || "").trim();
  const sub = (row.querySelector(".supplies-sub-select")?.value || "").trim();
  const item = (row.querySelector(".supplies-item-select")?.value || "").trim();
  if (!cat && !sub && !item) return "empty";
  if (cat && sub && item) return "ok";
  return "incomplete";
}

function readSuppliesRowSnapshot(row) {
  const cat = row.querySelector(".supplies-cat-select");
  const sub = row.querySelector(".supplies-sub-select");
  const item = row.querySelector(".supplies-item-select");
  const qtyIn = row.querySelector(".supplies-item-quantity");
  const unitIn = row.querySelector(".supplies-item-unit");
  const catOpt = cat?.selectedOptions?.[0];
  const subOpt = sub?.selectedOptions?.[0];
  const itemOpt = item?.selectedOptions?.[0];
  const categoryId = (cat?.value || "").trim();
  const subcategoryId = (sub?.value || "").trim();
  const itemId = (item?.value || "").trim();
  if (!categoryId || !subcategoryId || !itemId) return null;

  const categoryName = catOpt?.getAttribute("data-category-name") || "";
  const subcategoryName = subOpt?.getAttribute("data-subcategory-name") || "";
  const itemName = itemOpt?.getAttribute("data-item-name") || "";
  let internalNumber = null;
  const ins = itemOpt?.getAttribute("data-internal-number");
  if (ins != null && ins !== "") {
    const n = Number(ins);
    internalNumber = Number.isFinite(n) ? n : null;
  }
  const brandRaw = itemOpt?.getAttribute("data-brand");
  const brandCodeRaw = itemOpt?.getAttribute("data-brand-code");
  const brand = brandRaw ? String(brandRaw) : null;
  const brandCode = brandCodeRaw ? String(brandCodeRaw) : null;

  const qtyRaw = qtyIn?.value;
  let qty = null;
  if (qtyRaw != null && String(qtyRaw).trim() !== "") {
    const q = parseInt(String(qtyRaw).trim(), 10);
    qty = Number.isFinite(q) ? q : null;
  }
  const unit = (unitIn?.value ?? "").trim() || "pcs";

  const varSel = row.querySelector(".supplies-variant-select");
  const vkRaw = (varSel?.value || "").trim();
  let variantKey = null;
  let variantLabel = null;
  if (vkRaw === "dip" || vkRaw === "gel" || vkRaw === "regular") {
    variantKey = vkRaw;
    variantLabel = SUPPLIES_VARIANT_LABELS[vkRaw] || null;
  }

  return {
    categoryId,
    categoryName,
    subcategoryId,
    subcategoryName,
    itemId,
    itemName,
    internalNumber,
    brand,
    brandCode,
    qty,
    unit,
    variantKey,
    variantLabel,
  };
}

async function initSuppliesRequestForm(fieldsContainer) {
  const list = fieldsContainer.querySelector("#suppliesItemsList");
  const hint = fieldsContainer.querySelector("#suppliesInventoryEmptyHint");
  if (!list) return;
  let categories = [];
  try {
    categories = await ffFetchInventoryCategoriesForSupplies();
  } catch (e) {
    console.error("[Inbox] supplies categories", e);
    if (typeof showToast === "function") showToast("Could not load inventory categories.", "error");
  }
  if (typeof window !== "undefined") {
    window._suppliesFormCategoriesCache = categories;
  }
  if (hint) hint.style.display = categories.length === 0 ? "block" : "none";
  list.querySelectorAll(".supplies-item-row").forEach((row) => wireSuppliesItemRow(row, categories));
}

// --- Staff document Inbox alerts (document_expiring_soon / document_expired) — Phase 4 UI ---

function ffDocAlertIsHebrewUI() {
  if (typeof document === 'undefined') return false;
  const lang = (document.documentElement.getAttribute('lang') || '').toLowerCase();
  return lang.startsWith('he');
}

function ffDocAlertStaffName(request) {
  const rd = request.data || {};
  const s = (rd.subjectStaffName || '').trim();
  if (s) return s;
  return ffDocAlertIsHebrewUI() ? 'עובד לא ידוע' : 'Unknown employee';
}

function ffDocAlertDocTitle(request) {
  const rd = request.data || {};
  const s = (request.documentTitle || rd.documentTitle || '').trim();
  if (s) return s;
  return ffDocAlertIsHebrewUI() ? 'מסמך ללא שם' : 'Untitled document';
}

function ffDocAlertDocType(request) {
  const rd = request.data || {};
  const s = (request.documentType || rd.documentType || '').trim();
  if (s) return s;
  return '—';
}

function ffDocAlertExpirationDate(request) {
  const rd = request.data || {};
  const ex = request.expirationDate || rd.expirationDate;
  try {
    if (ex && typeof ex.toDate === 'function') return ex.toDate();
  } catch (_) {}
  return null;
}

function ffDocAlertExpFormattedLong(request) {
  const d = ffDocAlertExpirationDate(request);
  if (!d) return '';
  const locale = ffDocAlertIsHebrewUI() ? 'he-IL' : undefined;
  try {
    return d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
  } catch (_) {
    return d.toLocaleDateString();
  }
}

function ffDocAlertHumanSummary(request) {
  const kind = request.type === 'document_expired' ? 'expired' : 'soon';
  const staff = ffDocAlertStaffName(request);
  const docName = ffDocAlertDocTitle(request);
  const expStr = ffDocAlertExpFormattedLong(request);
  const he = ffDocAlertIsHebrewUI();
  if (kind === 'expired') {
    return he
      ? `מסמך "${docName}" של ${staff} פג תוקף${expStr ? ` בתאריך ${expStr}` : ''}.`
      : `Document "${docName}" for ${staff} expired${expStr ? ` on ${expStr}` : ''}.`;
  }
  return he
    ? `המסמך "${docName}" של ${staff} יפוג${expStr ? ` בתאריך ${expStr}` : ''}.`
    : `Document "${docName}" for ${staff} expires${expStr ? ` on ${expStr}` : ''}.`;
}

function ffDocAlertStaffId(request) {
  const rd = request.data || {};
  return String(request.staffId || rd.staffId || '').trim();
}

function ffDocAlertWhatToDoLine() {
  return ffDocAlertIsHebrewUI()
    ? 'בדקו את המסמך בפרופיל העובד, ועדכנו או חדשו לפי הצורך.'
    : 'Review the document on the staff profile, then renew or update as needed.';
}

function ffDocAlertModalFooterIds(request) {
  const rd = request.data || {};
  const did = String(request.documentId || rd.documentId || '').trim();
  const sid = ffDocAlertStaffId(request);
  if (!did && !sid) return '';
  const he = ffDocAlertIsHebrewUI();
  const parts = [];
  if (sid) parts.push(`${he ? 'עובד' : 'Staff'} ID: ${escapeHtml(sid)}`);
  if (did) parts.push(`${he ? 'מסמך' : 'Document'} ID: ${escapeHtml(did)}`);
  return `<div style="font-size:11px;color:#9ca3af;line-height:1.45;">${parts.join(' · ')}</div>`;
}

/** Returns Promise<boolean> - true if confirmed, false if cancelled */
function showConfirmModal(options) {
  const { title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = options;
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.id = 'inboxConfirmModal';
    modal.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;
      z-index:999999;padding:20px;backdrop-filter:blur(3px);
    `;
    modal.innerHTML = `
      <div style="
        background:#fff;border-radius:16px;padding:28px;max-width:400px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.2);
        text-align:center;
      ">
        <div style="font-size:40px;margin-bottom:16px;">${danger ? '🗑️' : '❓'}</div>
        <h3 style="margin:0 0 12px;font-size:18px;font-weight:600;color:#111;">${escapeHtml(title)}</h3>
        <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.5;">${escapeHtml(message)}</p>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
          <button class="inbox-confirm-cancel" style="
            padding:12px 24px;border:1px solid #d1d5db;background:#fff;color:#374151;border-radius:10px;
            cursor:pointer;font-size:14px;font-weight:500;
          ">${escapeHtml(cancelLabel)}</button>
          <button class="inbox-confirm-ok" style="
            padding:12px 24px;border:none;background:${danger ? '#dc2626' : '#111'};color:#fff;border-radius:10px;
            cursor:pointer;font-size:14px;font-weight:600;
          ">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    const remove = () => { modal.remove(); };
    modal.querySelector('.inbox-confirm-ok').onclick = () => { remove(); resolve(true); };
    modal.querySelector('.inbox-confirm-cancel').onclick = () => { remove(); resolve(false); };
    modal.onclick = (e) => { if (e.target === modal) { remove(); resolve(false); } };
    document.body.appendChild(modal);
  });
}

/** Returns Promise<string | null> - the input value if confirmed, null if cancelled */
function showPromptModal(options) {
  const {
    title,
    message,
    placeholder = '',
    confirmLabel = 'OK',
    cancelLabel = 'Cancel',
    required = false
  } = options;
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.id = 'inboxPromptModal';
    modal.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;
      z-index:999999;padding:20px;backdrop-filter:blur(3px);
    `;
    modal.innerHTML = `
      <div style="
        background:#fff;border-radius:16px;padding:28px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.2);
      ">
        <div style="font-size:40px;margin-bottom:16px;text-align:center;">❓</div>
        <h3 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#111;text-align:center;">${escapeHtml(title)}</h3>
        <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.5;text-align:center;">${escapeHtml(message)}</p>
        <textarea id="inboxPromptInput" rows="3" placeholder="${escapeHtml(placeholder)}" style="
          width:100%;padding:12px 14px;border:1px solid #d1d5db;border-radius:10px;font-size:14px;resize:vertical;min-height:80px;box-sizing:border-box;
        "></textarea>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:20px;">
          <button class="inbox-prompt-cancel" style="
            padding:12px 24px;border:1px solid #d1d5db;background:#fff;color:#374151;border-radius:10px;
            cursor:pointer;font-size:14px;font-weight:500;
          ">${escapeHtml(cancelLabel)}</button>
          <button class="inbox-prompt-ok" style="
            padding:12px 24px;border:none;background:#111;color:#fff;border-radius:10px;
            cursor:pointer;font-size:14px;font-weight:600;
          ">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    const input = modal.querySelector('#inboxPromptInput');
    const remove = () => { modal.remove(); };
    modal.querySelector('.inbox-prompt-ok').onclick = () => {
      const val = (input.value || '').trim();
      if (required && !val) {
        input.style.borderColor = '#ef4444';
        return;
      }
      remove();
      resolve(required ? (val || null) : val);
    };
    input.oninput = () => { input.style.borderColor = ''; };
    modal.querySelector('.inbox-prompt-cancel').onclick = () => { remove(); resolve(null); };
    modal.onclick = (e) => { if (e.target === modal) { remove(); resolve(null); } };
    document.body.appendChild(modal);
    input.focus();
  });
}

function getRequestSummary(request) {
  const data = request.data || {};
  
  switch (request.type) {
    case 'vacation':
      return `${data.startDate || ''} to ${data.endDate || ''} (${data.daysCount || 0} days)`;
    case 'late_start':
    case 'early_leave':
      return `${data.date || ''} - ${data.requestedTime || ''}`;
    case 'day_off':
      return data.date ? `Day off · ${data.date}` : 'Day off';
    case 'time_off':
      return data.startDate && data.endDate
        ? `Time off · ${data.startDate} → ${data.endDate}`
        : (data.startDate || 'Time off');
    case 'schedule_change':
      if (data.startDate && data.endDate) {
        return `Schedule change · ${data.startDate}→${data.endDate}${data.requestedSchedule ? ` · ${String(data.requestedSchedule).slice(0, 40)}` : ''}`;
      }
      return data.reason || 'Schedule change request';
    case 'extra_shift':
    case 'swap_shift':
    case 'break_change':
      return data.date ? `${data.date} – ${(data.details || '').substring(0, 50)}` : (data.details || 'View details').substring(0, 80);
    case 'commission_review':
    case 'tip_adjustment':
    case 'payment_issue':
    case 'client_issue':
      return data.subject || (data.details || 'View details').substring(0, 60);
    case 'supplies': {
      const arr = data.items || [];
      const itemCount = arr.length;
      const first = arr[0];
      let label = "";
      if (first && (first.itemName || first.name)) {
        const base = String(first.itemName || first.name).slice(0, 32);
        const vl = first.variantLabel && String(first.variantLabel).trim();
        label = vl ? `${base} — ${String(vl).slice(0, 14)}` : base.slice(0, 36);
      }
      return itemCount
        ? `${itemCount} item${itemCount !== 1 ? "s" : ""}${label ? `: ${label}` : ""} · ${data.urgency || "routine"}`
        : `${data.urgency || "routine"}`;
    }
    case 'maintenance':
      return `${data.area || 'Unknown area'} - ${data.severity || 'minor'} issue`;
    case 'staff_birthday_reminder':
      return data.details || `${data.subjectStaffName || 'Staff'} · ${data.birthdayDisplay || ''}`;
    case 'document_request':
      return `${data.documentType || 'Document'} – ${(data.reason || '').substring(0, 40)}`;
    case 'document_renewal_request':
      return `${data.documentType || 'Document'} – ${(data.message || '').substring(0, 40)}`;
    case 'document_upload':
      return `${data.documentType || 'Document'}${data.expirationDate ? ` · Expires ${data.expirationDate}` : ''}`;
    case 'document_expiring_soon':
    case 'document_expired':
      return ffDocAlertHumanSummary(request);
    case 'other':
      return data.subject || data.details?.substring(0, 60) || 'Request details';
    default:
      if (data.details) return data.details.substring(0, 80);
      const keys = Object.keys(data || {}).filter(k => data[k]);
      if (keys.length) return keys.map(k => String(data[k])).join(' · ').substring(0, 80);
      return 'View details';
  }
}

function formatRelativeDate(date) {
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  return date.toLocaleDateString();
}

// =====================
// Create Request Modal
// =====================
window.openCreateRequestModal = function() {
  if (!inboxCanSendRequests()) {
    if (typeof showToast === "function") showToast("You do not have permission to create requests.", "error");
    return;
  }
  console.log('[Inbox] Opening create request modal');
  
  // Create modal
  const modal = document.createElement('div');
  modal.id = 'createRequestModal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999999;
    padding: 20px;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: #fff;
    border-radius: 12px;
    padding: 24px;
    max-width: 500px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
  `;
  
  const grouped = getRequestTypesGroupedByCategory();
  const renderTypeBtn = (t) => `
    <button class="request-type-btn" data-type="${t.id}" onclick="selectRequestType('${t.id}')" style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;cursor:pointer;text-align:left;transition:all 0.2s;display:flex;align-items:center;gap:10px;">
      <span style="font-size:20px;">${t.icon}</span>
      <div>
        <div style="font-weight:500;font-size:14px;">${t.label}</div>
      </div>
    </button>
  `;
  const categoryOrder = ['schedule', 'payments', 'operations', 'documents', 'custom', 'other'];
  const sectionLabels = { ...REQUEST_CATEGORY_LABELS, custom: '📌 Custom' };
  let typeSectionsHtml = '';
  categoryOrder.forEach((cat) => {
    const types = grouped[cat];
    if (!types || types.length === 0) return;
    const label = sectionLabels[cat] || cat;
    typeSectionsHtml += `
      <div class="request-type-section" data-category="${cat}" style="margin-bottom:8px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <div class="request-category-header" role="button" tabindex="0" onclick="window.toggleRequestCategory('${cat}')" style="display:flex;align-items:center;gap:8px;padding:12px 14px;cursor:pointer;user-select:none;font-size:13px;font-weight:600;color:#374151;background:#f9fafb;">
          <span class="request-category-arrow" style="font-size:10px;transition:transform 0.2s;color:#6b7280;">▶</span>
          <span>${label}</span>
        </div>
        <div class="request-category-body" style="display:none;flex-direction:column;gap:8px;padding:12px 14px 14px 32px;background:#fff;border-top:1px solid #e5e7eb;">${types.map(renderTypeBtn).join('')}</div>
      </div>
    `;
  });

  content.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
      <h2 style="margin:0;font-size:18px;font-weight:600;">New Request</h2>
      <button onclick="closeCreateRequestModal()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#9ca3af;">&times;</button>
    </div>
    <div id="createRequestForm">
      <div id="stepSelectType" style="display:block;">
        <label style="display:block;margin-bottom:12px;font-size:14px;font-weight:500;color:#374151;">Request Type</label>
        <div style="display:flex;flex-direction:column;gap:4px;">${typeSectionsHtml}</div>
      </div>
      <div id="stepRequestForm" style="display:none;">
        <button onclick="backToTypeSelection()" style="margin-bottom:16px;background:none;border:none;color:#6b7280;cursor:pointer;font-size:14px;">← Back to request types</button>
        <div id="requestFormContainer"></div>
      </div>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  // Click outside to close
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeCreateRequestModal();
    }
  };
};

window.closeCreateRequestModal = function() {
  const modal = document.getElementById('createRequestModal');
  if (modal) modal.remove();
};

window.toggleRequestCategory = function(cat) {
  const modal = document.getElementById('createRequestModal');
  if (!modal) return;
  const section = modal.querySelector(`.request-type-section[data-category="${cat}"]`);
  if (!section) return;
  const body = section.querySelector('.request-category-body');
  const arrow = section.querySelector('.request-category-arrow');
  if (!body || !arrow) return;
  const isOpen = body.style.display === 'flex';
  body.style.display = isOpen ? 'none' : 'flex';
  arrow.textContent = isOpen ? '▶' : '▼';
};

// =====================
// Inbox Settings Modal (admin/owner only) — custom request types
// =====================
window.openInboxSettingsModal = function() {
  if (!currentUserProfile?.salonId || !["admin", "owner"].includes(inboxUserRoleLc())) return;
  const modal = document.createElement('div');
  modal.id = 'inboxSettingsModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:999999;padding:20px;';
  const content = document.createElement('div');
  content.style.cssText = 'background:#fff;border-radius:12px;padding:24px;max-width:480px;width:100%;max-height:90vh;overflow-y:auto;';

  const categoryOrder = ['schedule', 'payments', 'operations', 'documents', 'other'];
  const categoryLabels = { ...REQUEST_CATEGORY_LABELS };
  let systemSectionsHtml = '';
  categoryOrder.forEach(cat => {
    const types = BUILTIN_TYPES.filter(t => (t.category || 'other') === cat);
    if (types.length === 0) return;
    const label = categoryLabels[cat] || cat;
    const rows = types.map(t => {
      const hidden = (inboxHiddenTypes || []).includes(t.id);
      return `<div class="inbox-visibility-row" data-type-id="${t.id}" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:6px;">
        <span style="font-size:18px;">${t.icon || '📝'}</span>
        <span style="flex:1;margin-left:10px;font-size:14px;font-weight:500;">${escapeHtml(t.label)}</span>
        <button type="button" class="inbox-visibility-toggle" data-type-id="${t.id}" data-hidden="${hidden}" style="padding:6px 12px;border-radius:6px;cursor:pointer;font-size:13px;border:1px solid #e5e7eb;background:${hidden ? '#fef2f2;color:#dc2626' : '#f0fdf4;color:#16a34a'};">${hidden ? '🚫 Hidden' : '👁 Enabled'}</button>
      </div>`;
    }).join('');
    systemSectionsHtml += `
      <div class="settings-category-section" data-category="${cat}" style="margin-bottom:8px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <div class="settings-category-header" role="button" tabindex="0" style="display:flex;align-items:center;gap:8px;padding:12px 14px;cursor:pointer;user-select:none;font-size:13px;font-weight:600;color:#374151;background:#f9fafb;">
          <span class="settings-category-arrow" style="font-size:10px;transition:transform 0.2s;color:#6b7280;">▶</span>
          <span>${label}</span>
        </div>
        <div class="settings-category-body" style="display:none;padding:12px 14px 14px 20px;background:#fff;border-top:1px solid #e5e7eb;">${rows}</div>
      </div>
    `;
  });

  content.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
      <h2 style="margin:0;font-size:18px;font-weight:600;">Inbox Settings</h2>
      <button type="button" onclick="closeInboxSettingsModal()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#9ca3af;">&times;</button>
    </div>
    <div style="margin-bottom:20px;">
      <h3 style="margin:0 0 10px;font-size:13px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.03em;">System Request Types</h3>
      <p style="margin:0 0 12px;font-size:12px;color:#9ca3af;">Control which types staff can see in New Request.</p>
      <div id="systemTypesVisibilityList">${systemSectionsHtml}</div>
    </div>
    <div style="margin-bottom:16px;">
      <h3 style="margin:0 0 10px;font-size:13px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.03em;">Custom Request Types</h3>
      <p style="margin:0 0 12px;font-size:12px;color:#9ca3af;">Add types and control visibility.</p>
      <div id="customTypesList" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;"></div>
      <button type="button" id="btnAddCustomType" style="padding:8px 14px;border:1px solid #d1d5db;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;color:#374151;">+ Add custom type</button>
    </div>
  `;
  modal.appendChild(content);
  document.body.appendChild(modal);
  modal.onclick = (e) => { if (e.target === modal) closeInboxSettingsModal(); };

  content.querySelectorAll('.settings-category-header').forEach(header => {
    header.onclick = () => {
      const section = header.closest('.settings-category-section');
      const body = section.querySelector('.settings-category-body');
      const arrow = header.querySelector('.settings-category-arrow');
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : 'block';
      if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(90deg)';
    };
  });

  content.querySelectorAll('.inbox-visibility-toggle').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const typeId = btn.dataset.typeId;
      const hidden = btn.dataset.hidden !== 'true';
      try {
        await setInboxTypeVisibility(typeId, hidden);
        btn.dataset.hidden = String(hidden);
        btn.textContent = hidden ? '🚫 Hidden' : '👁 Enabled';
        btn.style.background = hidden ? '#fef2f2' : '#f0fdf4';
        btn.style.color = hidden ? '#dc2626' : '#16a34a';
        showToast(hidden ? 'Hidden from staff' : 'Visible to staff', 'success');
      } catch (err) {
        console.error('[Inbox] setInboxTypeVisibility', err);
        showToast('Failed to update: ' + (err.message || 'check console'), 'error');
      }
    };
  });
  renderCustomTypesList(document.getElementById('customTypesList'));
  document.getElementById('btnAddCustomType').onclick = () => openAddCustomTypeForm(content);
};

window.closeInboxSettingsModal = function() {
  const m = document.getElementById('inboxSettingsModal');
  if (m) m.remove();
};

function renderCustomTypesList(container) {
  if (!container) return;
  container.innerHTML = '';
  const hiddenSet = new Set(inboxHiddenTypes || []);
  (customRequestTypes || []).forEach(t => {
    const hidden = hiddenSet.has(t.id);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:6px;';
    row.innerHTML = `
      <span style="font-size:18px;">${t.icon || '📝'}</span>
      <span style="flex:1;margin-left:10px;font-size:14px;font-weight:500;">${escapeHtml(t.label || t.id)}</span>
      <button type="button" class="custom-type-visibility-toggle" data-type-id="${t.id}" data-hidden="${hidden}" style="padding:6px 10px;border-radius:6px;cursor:pointer;font-size:12px;margin-right:6px;border:1px solid #e5e7eb;background:${hidden ? '#fef2f2;color:#dc2626' : '#f0fdf4;color:#16a34a'};">${hidden ? '🚫' : '👁'}</button>
      <button type="button" onclick="editCustomType('${t.id}')" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:12px;margin-right:6px;">Edit</button>
      <button type="button" onclick="deleteCustomType('${t.id}')" style="padding:6px 10px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:6px;cursor:pointer;font-size:12px;">Delete</button>
    `;
    container.appendChild(row);
  });
  container.querySelectorAll('.custom-type-visibility-toggle').forEach(btn => {
    btn.onclick = async () => {
      const typeId = btn.dataset.typeId;
      const hidden = btn.dataset.hidden !== 'true';
      try {
        await setInboxTypeVisibility(typeId, hidden);
        btn.dataset.hidden = String(hidden);
        btn.textContent = hidden ? '🚫' : '👁';
        btn.style.background = hidden ? '#fef2f2' : '#f0fdf4';
        btn.style.color = hidden ? '#dc2626' : '#16a34a';
        showToast(hidden ? 'Hidden from staff' : 'Visible to staff', 'success');
      } catch (err) {
        console.error('[Inbox] setInboxTypeVisibility (custom)', err);
        showToast('Failed to update: ' + (err.message || 'check console'), 'error');
      }
    };
  });
  if ((customRequestTypes || []).length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:13px;color:#9ca3af;padding:12px;';
    empty.textContent = 'No custom types yet. Add one below.';
    container.appendChild(empty);
  }
}

window.editCustomType = function(typeId) {
  const t = (customRequestTypes || []).find(x => x.id === typeId);
  if (!t || !currentUserProfile?.salonId) return;
  const modal = document.getElementById('inboxSettingsModal');
  const content = modal?.firstElementChild;
  openAddCustomTypeForm(content, typeId, t);
};

// Emojis the admin can pick from (no typing needed)
const CUSTOM_TYPE_EMOJIS = ['📝', '📚', '📋', '📅', '⏰', '📦', '🔧', '✅', '🎯', '🪴', '📌', '🔔', '🏖️', '🏃', '💡', '📎'];

function openAddCustomTypeForm(settingsContent, editTypeId, editData) {
  if (!settingsContent) return;
  const existing = settingsContent.querySelector('#addCustomTypeForm');
  if (existing) existing.remove();
  const isEdit = !!editTypeId;
  const form = document.createElement('div');
  form.id = 'addCustomTypeForm';
  form.style.cssText = 'margin-top:16px;padding:16px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;';
  const emojiRow = CUSTOM_TYPE_EMOJIS.map(e => `<button type="button" class="custom-type-emoji-btn" data-emoji="${e}" style="width:36px;height:36px;padding:0;border:1px solid #e5e7eb;border-radius:8px;background:#fff;cursor:pointer;font-size:18px;line-height:1;">${e}</button>`).join('');
  form.innerHTML = `
    <div style="margin-bottom:10px;">
      <label style="display:block;margin-bottom:4px;font-size:13px;font-weight:500;color:#374151;">Name</label>
      <input type="text" id="customTypeLabel" placeholder="e.g. Training Request" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;">
    </div>
    <div style="margin-bottom:10px;">
      <label style="display:block;margin-bottom:4px;font-size:13px;font-weight:500;color:#374151;">Instructions for staff</label>
      <p style="margin:0 0 6px;font-size:12px;color:#6b7280;">What should staff write in the request? This text will appear under the type name.</p>
      <textarea id="customTypeDescription" rows="2" placeholder="e.g. Write the course name, desired date, and why you need this training" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;resize:vertical;"></textarea>
    </div>
    <div style="margin-bottom:12px;">
      <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Icon — choose one</label>
      <div id="customTypeEmojiRow" style="display:flex;flex-wrap:wrap;gap:6px;">${emojiRow}</div>
      <input type="hidden" id="customTypeIcon" value="📝">
    </div>
    <div style="display:flex;gap:8px;">
      <button type="button" id="btnSaveCustomType" style="padding:8px 16px;background:#111;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">Save</button>
      <button type="button" onclick="document.getElementById('addCustomTypeForm').remove()" style="padding:8px 16px;border:1px solid #d1d5db;background:#fff;border-radius:6px;cursor:pointer;font-size:13px;">Cancel</button>
    </div>
  `;
  settingsContent.appendChild(form);
  const iconInput = document.getElementById('customTypeIcon');
  form.querySelectorAll('.custom-type-emoji-btn').forEach(btn => {
    btn.onclick = () => {
      const em = btn.dataset.emoji;
      iconInput.value = em;
      form.querySelectorAll('.custom-type-emoji-btn').forEach(b => { b.style.background = '#fff'; b.style.borderColor = '#e5e7eb'; });
      btn.style.background = '#ede9fe';
      btn.style.borderColor = '#7c3aed';
    };
  });
  if (isEdit && editData) {
    document.getElementById('customTypeLabel').value = editData.label || '';
    document.getElementById('customTypeDescription').value = editData.description || '';
    const icon = (editData.icon || '📝').slice(0, 2);
    iconInput.value = icon;
    const firstMatch = form.querySelector(`.custom-type-emoji-btn[data-emoji="${icon}"]`);
    if (firstMatch) { firstMatch.style.background = '#ede9fe'; firstMatch.style.borderColor = '#7c3aed'; }
  } else {
    const firstBtn = form.querySelector('.custom-type-emoji-btn[data-emoji="📝"]');
    if (firstBtn) { firstBtn.style.background = '#ede9fe'; firstBtn.style.borderColor = '#7c3aed'; }
  }
  document.getElementById('btnSaveCustomType').textContent = isEdit ? 'Update' : 'Save';
  document.getElementById('btnSaveCustomType').onclick = async () => {
    const label = document.getElementById('customTypeLabel')?.value?.trim();
    const icon = (document.getElementById('customTypeIcon')?.value?.trim() || '📝').slice(0, 2);
    const description = document.getElementById('customTypeDescription')?.value?.trim() || '';
    if (!label) { showToast('Enter a name', 'error'); return; }
    try {
      const payload = { label, icon, description };
      if (isEdit) {
        await updateDoc(doc(db, `salons/${currentUserProfile.salonId}/requestTypes`, editTypeId), payload);
        showToast('Updated', 'success');
      } else {
        await addDoc(collection(db, `salons/${currentUserProfile.salonId}/requestTypes`), payload);
        showToast('Custom type added', 'success');
      }
      await loadCustomTypes();
      document.getElementById('addCustomTypeForm')?.remove();
      renderCustomTypesList(document.getElementById('customTypesList'));
    } catch (err) {
      console.error(err);
      showToast('Failed: ' + (err.message || ''), 'error');
    }
  };
}

window.deleteCustomType = async function(typeId) {
  if (!currentUserProfile?.salonId || !confirm('Delete this request type? Existing requests of this type will keep their label.')) return;
  try {
    await deleteDoc(doc(db, `salons/${currentUserProfile.salonId}/requestTypes`, typeId));
    await loadCustomTypes();
    const listEl = document.getElementById('customTypesList');
    if (listEl) renderCustomTypesList(listEl);
    showToast('Type removed', 'success');
  } catch (err) {
    console.error(err);
    showToast('Failed to delete: ' + (err.message || ''), 'error');
  }
};

window.backToTypeSelection = function() {
  document.getElementById('stepSelectType').style.display = 'block';
  document.getElementById('stepRequestForm').style.display = 'none';
};

/**
 * Match `salons/{salonId}/staff/{docId}` by firebaseUid or email (same id as Staff modal).
 * Kept in inbox.js so a stale cached staff-documents.js cannot break the whole app.
 */
async function ffResolveStaffFirestoreIdByScanInbox(salonId, uid, emailHint) {
  const sid = String(salonId || "").trim();
  const u = String(uid || "").trim();
  if (!sid || !u) return "";
  let em = String(emailHint || "").trim().toLowerCase();
  if (!em) {
    try {
      const uSnap = await getDoc(doc(db, "users", u));
      if (uSnap.exists()) em = String(uSnap.data()?.email || "").trim().toLowerCase();
    } catch (e) {
      console.warn("[Inbox] scan: users email", e);
    }
  }
  try {
    const snap = await getDocs(collection(db, `salons/${sid}/staff`));
    for (const d of snap.docs) {
      const row = d.data() || {};
      const fid = String(row.firebaseUid || row.firebaseAuthUid || row.authUid || "").trim();
      if (fid && fid === u) return d.id;
    }
    if (em) {
      for (const d of snap.docs) {
        const row = d.data() || {};
        const mail = String(row.email || "").trim().toLowerCase();
        if (mail && mail === em) return d.id;
      }
    }
  } catch (e) {
    console.warn("[Inbox] scan staff collection", e);
  }
  return "";
}

/** Firestore staff doc id for the signed-in uploader (scan uid/email first, then profile/members/users). */
async function resolveSubmittingStaffIdForDocumentUpload(salonId) {
  const sid = String(salonId || "").trim();
  const uid = String(auth?.currentUser?.uid || currentUserProfile?.uid || "").trim();
  if (!sid || !uid) return "";
  const emailHint = String(currentUserProfile?.email || "").trim();
  const scanned = await ffResolveStaffFirestoreIdByScanInbox(sid, uid, emailHint);
  if (scanned) return scanned;
  let id = String(currentUserProfile?.staffId || "").trim();
  if (id) return id;
  try {
    const mSnap = await getDoc(doc(db, "salons", sid, "members", uid));
    if (mSnap.exists()) {
      const ms = String(mSnap.data()?.staffId || "").trim();
      if (ms) return ms;
    }
  } catch (e) {
    console.warn("[Inbox] uploader members", e);
  }
  try {
    const uSnap = await getDoc(doc(db, "users", uid));
    if (uSnap.exists()) {
      const us = String(uSnap.data()?.staffId || "").trim();
      if (us) return us;
    }
  } catch (e) {
    console.warn("[Inbox] uploader users", e);
  }
  return "";
}

window.selectRequestType = async function(type) {
  console.log('[Inbox] Selected type:', type);

  if (!inboxCanSendRequests()) {
    if (typeof showToast === "function") showToast("You do not have permission to create requests.", "error");
    return;
  }

  document.getElementById('stepSelectType').style.display = 'none';
  document.getElementById('stepRequestForm').style.display = 'block';
  
  const formContainer = document.getElementById('requestFormContainer');
  if (!formContainer) return;

  // Pre-load salon users so recipient list has Firebase UIDs
  await loadSalonUsersForRecipients();
  
  // Render form based on type
  const form = createRequestForm(type);
  formContainer.innerHTML = '';
  formContainer.appendChild(form);
  if (type === 'document_request') {
    const emailEl = document.getElementById('doc_req_email');
    if (emailEl && auth.currentUser?.email) emailEl.value = auth.currentUser.email;
  }
  if (type === 'document_upload') {
    const p = window.__ffDocUploadPrefill;
    if (p) {
      if (p.documentType) {
        const sel = document.getElementById('doc_up_type');
        const val = String(p.documentType || '').trim();
        if (sel && val && Array.from(sel.options).some((o) => o.value === val)) {
          sel.value = val;
        }
      }
      if (p.renewForDocId) {
        const hid = document.getElementById('doc_up_renew_for_doc_id');
        if (hid) hid.value = String(p.renewForDocId).trim();
      }
    }
    window.__ffDocUploadPrefill = null;
  }
  if (type === 'document_renewal_request') {
    const p = window.__ffDocRenewalPrefill;
    if (p && (p.staffId || p.documentType || p.documentId)) {
      if (p.staffId) {
        const sel = document.getElementById('doc_renew_staff');
        if (sel) {
          const opt = Array.from(sel.options).find((o) => (o.getAttribute('data-staff-id') || '') === p.staffId);
          if (opt) sel.value = opt.value;
        }
      }
      const dt = document.getElementById('doc_renew_type');
      if (dt && p.documentType) {
        const val = p.documentType;
        if (Array.from(dt.options).some((o) => o.value === val)) dt.value = val;
      }
      const hid = document.getElementById('doc_renew_related_document_id');
      if (hid && p.documentId) hid.value = p.documentId;
    }
    window.__ffDocRenewalPrefill = null;
  }
};

function createRequestForm(type) {
  const form = document.createElement('div');
  const typeInfo = getRequestTypeInfo(type);
  const recipientsList = getInboxRecipientsList();
  const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const instructionsHtml = (typeInfo.description && typeInfo.description.trim())
    ? `<p style="margin:8px 0 0;font-size:13px;color:#6b7280;text-align:center;max-width:400px;margin-left:auto;margin-right:auto;">${esc(typeInfo.description.trim())}</p>`
    : '';
  const isRenewal = type === 'document_renewal_request';
  const technicians = isRenewal ? (_inboxUsersCache || []).filter((u) => u.role === 'technician') : [];
  const renewalStaffHtml =
    technicians.length === 0
      ? `<div style="margin-bottom:16px;padding:10px 12px;border:1px solid #fecaca;border-radius:8px;font-size:13px;color:#b91c1c;">No service providers in the directory. Staff must sign in once so they appear under members.</div>`
      : `
    <div style="margin-bottom:16px;">
      <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Who should upload the document?</label>
      <select id="doc_renew_staff" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;">
        <option value="">Select staff member…</option>
        ${technicians.map((u) => {
          const id = esc(u.uid || '');
          const sid = esc(u.staffId || '');
          const nm = esc(u.name || '');
          return `<option value="${id}" data-uid="${id}" data-staff-id="${sid}" data-name="${nm}">${nm}</option>`;
        }).join('')}
      </select>
      <input type="hidden" id="doc_renew_related_document_id" value="" />
    </div>
  `;
  const sendToRowHtml = isRenewal
    ? renewalStaffHtml
    : recipientsList.length === 0
    ? `<div style="margin-bottom:16px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#6b7280;">Send to: No managers or admins in list.</div>`
    : `
    <div id="sendToFilterRow" role="button" tabindex="0" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;cursor:pointer;background:#f9fafb;font-size:13px;">
      <span><span style="font-weight:500;color:#374151;">Send to:</span> <span id="sendToSummary">Choose who receives this request</span></span>
      <span id="sendToArrow" style="color:#6b7280;font-size:10px;">▶</span>
    </div>
    <div id="sendToPanel" style="display:none;margin-bottom:16px;padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;max-height:180px;overflow-y:auto;">
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${recipientsList.map(s => `
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
            <input type="checkbox" class="create-request-send-to-cb" data-uid="${esc(s.uid || '')}" data-staff-id="${esc(s.id)}" data-staff-name="${esc(s.name)}" style="width:14px;height:14px;">
            <span>${esc(s.name)}</span>
          </label>
        `).join('')}
      </div>
    </div>
  `;
  form.innerHTML = `
    <div style="text-align:center;margin-bottom:20px;">
      <div style="font-size:32px;margin-bottom:8px;">${typeInfo.icon}</div>
      <h3 style="margin:0;font-size:16px;font-weight:600;">${typeInfo.label}</h3>
      ${instructionsHtml}
    </div>
    <div style="margin-bottom:16px;">
      ${sendToRowHtml}
    </div>
  `;
  
  if (!isRenewal && recipientsList.length > 0) {
    const row = form.querySelector('#sendToFilterRow');
    const panel = form.querySelector('#sendToPanel');
    const summary = form.querySelector('#sendToSummary');
    const arrow = form.querySelector('#sendToArrow');
    const updateSummary = () => {
      const { names } = getCreateRequestSelectedRecipients();
      if (summary) summary.textContent = names.length > 0 ? names.join(', ') : 'Choose who receives this request';
    };
    row.addEventListener('click', () => {
      const open = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : 'block';
      if (arrow) arrow.textContent = open ? '▶' : '▼';
    });
    form.querySelectorAll('.create-request-send-to-cb').forEach(cb => {
      cb.addEventListener('change', updateSummary);
    });
  }
  
  const fieldsContainer = document.createElement('div');
  fieldsContainer.style.cssText = 'display:flex;flex-direction:column;gap:16px;';
  
  // Build form fields based on type
  if (type === 'vacation') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Start Date</label>
        <input type="date" id="vacation_startDate" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">End Date</label>
        <input type="date" id="vacation_endDate" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Reason (optional)</label>
        <textarea id="vacation_note" rows="3" placeholder="e.g., Family vacation planned months ago" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else if (type === 'late_start') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Date</label>
        <input type="date" id="latestart_date" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Requested Start Time</label>
        <input type="time" id="latestart_time" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Reason</label>
        <textarea id="latestart_reason" rows="2" required placeholder="e.g., Doctor appointment" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else if (type === 'early_leave') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Date</label>
        <input type="date" id="earlyleave_date" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Requested Leave Time</label>
        <input type="time" id="earlyleave_time" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Reason</label>
        <textarea id="earlyleave_reason" rows="2" required placeholder="e.g., Family emergency" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else if (type === 'day_off') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Date</label>
        <input type="date" id="dayoff_date" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Note (optional)</label>
        <textarea id="dayoff_note" rows="2" placeholder="Optional context" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else if (type === 'time_off') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">First day off</label>
        <input type="date" id="timeoff_startDate" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Last day off (same as first for one day)</label>
        <input type="date" id="timeoff_endDate" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Note (optional)</label>
        <textarea id="timeoff_note" rows="2" placeholder="Optional context" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else if (type === 'schedule_change') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Current Schedule</label>
        <input type="text" id="schedchange_current" placeholder="e.g., Mon-Fri 9-5" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Requested Schedule</label>
        <input type="text" id="schedchange_requested" required placeholder="e.g., Tue-Sat 10-6" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Reason</label>
        <textarea id="schedchange_reason" rows="2" required placeholder="Why do you need this change?" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
      <div style="font-size:12px;color:#4b5563;line-height:1.45;padding:8px 10px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
        <strong>Calendar impact (when approved):</strong> dates below map to availability. Single day = same start and end date.
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">First date this change applies to</label>
        <input type="date" id="schedchange_startDate" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Last date (optional; defaults to first date)</label>
        <input type="date" id="schedchange_endDate" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="schedchange_temporary" style="width:16px;height:16px;">
          <span style="font-size:13px;color:#374151;">Temporary change</span>
        </label>
      </div>
    `;
  } else if (type === 'extra_shift') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Date (optional)</label>
        <input type="date" id="extra_shift_date" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Details</label>
        <textarea id="extra_shift_details" rows="3" required placeholder="Which day(s) and shift you want to pick up" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else if (type === 'swap_shift') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Date (optional)</label>
        <input type="date" id="swap_shift_date" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Details</label>
        <textarea id="swap_shift_details" rows="3" required placeholder="Who to swap with, which shift, and any details" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else if (type === 'break_change') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Date</label>
        <input type="date" id="break_change_date" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Details</label>
        <textarea id="break_change_details" rows="3" required placeholder="Requested break time and reason" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else if (type === 'commission_review' || type === 'tip_adjustment' || type === 'payment_issue' || type === 'client_issue') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Subject (optional)</label>
        <input type="text" id="${type}_subject" placeholder="Brief description" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Details</label>
        <textarea id="${type}_details" rows="4" required placeholder="Explain your request" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else if (type === 'document_renewal_request') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Document type</label>
        <select id="doc_renew_type" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
          ${ffStaffDocumentTypeSelectOptionsHtml()}
        </select>
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Message to staff</label>
        <textarea id="doc_renew_message" rows="3" required placeholder="e.g. Please upload a renewed certificate before the current one expires." style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Due date (optional)</label>
        <input type="date" id="doc_renew_due" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
    `;
  } else if (type === 'document_request') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Document type</label>
        <select id="doc_req_type" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
          ${ffStaffDocumentTypeSelectOptionsHtml()}
        </select>
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Reason / Notes</label>
        <textarea id="doc_req_reason" rows="2" required placeholder="e.g. For bank, taxes, apartment" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Due date (optional)</label>
        <input type="date" id="doc_req_due" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Delivery method</label>
        <select id="doc_req_delivery" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
          <option value="Email">Email</option>
          <option value="Download in app">Download in app</option>
          <option value="Printed pickup">Printed pickup</option>
        </select>
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Contact email</label>
        <input type="email" id="doc_req_email" placeholder="Email to receive the document" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
    `;
  } else if (type === 'document_upload') {
    fieldsContainer.innerHTML = `
      <input type="hidden" id="doc_up_renew_for_doc_id" value="" />
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Document type</label>
        <select id="doc_up_type" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
          ${ffStaffDocumentTypeSelectOptionsHtml()}
        </select>
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Expiration date</label>
        <input type="date" id="doc_up_expiry" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">File (PDF, JPG or PNG)</label>
        <input type="file" id="doc_up_file" accept=".pdf,.jpg,.jpeg,.png" required style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Notes (optional)</label>
        <textarea id="doc_up_notes" rows="2" placeholder="Additional details" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else if (type === 'supplies') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Items needed</label>
        <p id="suppliesInventoryEmptyHint" style="display:none;margin:0 0 8px;font-size:12px;color:#b45309;">No inventory categories yet. Add categories in Inventory.</p>
        <div id="suppliesItemsList" style="display:flex;flex-direction:column;gap:10px;margin-bottom:8px;">
          <div class="supplies-item-row" style="display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa;">
            ${SUPPLIES_ITEM_ROW_INNER_HTML}
          </div>
        </div>
        <button type="button" onclick="addSuppliesItem()" style="padding:6px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:12px;">+ Add Item</button>
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Urgency</label>
        <select id="supplies_urgency" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
          <option value="routine">Routine</option>
          <option value="urgent">Urgent</option>
          <option value="critical">Critical</option>
        </select>
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Additional details</label>
        <textarea id="supplies_note" rows="2" placeholder="Additional details" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
    void initSuppliesRequestForm(fieldsContainer);
  } else if (type === 'maintenance') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Issue</label>
        <input type="text" id="maintenance_issue" required placeholder="e.g., Sink is leaking" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Area/Location</label>
        <input type="text" id="maintenance_area" required placeholder="e.g., Station 3, Break room" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Severity</label>
        <select id="maintenance_severity" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
          <option value="minor">Minor</option>
          <option value="moderate">Moderate</option>
          <option value="urgent">Urgent</option>
        </select>
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Additional Details (optional)</label>
        <textarea id="maintenance_note" rows="3" placeholder="More details about the issue" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else if (type === 'other') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Subject</label>
        <input type="text" id="other_subject" required placeholder="Brief description" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Details</label>
        <textarea id="other_details" rows="4" required placeholder="Explain your request" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
  } else {
    // Custom request type: dynamic fields from admin definition, or single Details
    const customType = getRequestTypeInfo(type);
    const fields = (customType.fields || []);
    if (fields.length > 0) {
      const inputStyle = 'width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;';
      fields.forEach(f => {
        const div = document.createElement('div');
        const id = 'custom_field_' + f.id;
        const req = f.required ? 'required' : '';
        if (f.type === 'textarea') {
          div.innerHTML = `<label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label><textarea id="${id}" rows="3" ${req} placeholder="${escapeHtml(f.label)}" style="${inputStyle}resize:vertical;"></textarea>`;
        } else if (f.type === 'date') {
          div.innerHTML = `<label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label><input type="date" id="${id}" ${req} style="${inputStyle}">`;
        } else if (f.type === 'number') {
          div.innerHTML = `<label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label><input type="number" id="${id}" ${req} style="${inputStyle}">`;
        } else {
          div.innerHTML = `<label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label><input type="text" id="${id}" ${req} placeholder="${escapeHtml(f.label)}" style="${inputStyle}">`;
        }
        fieldsContainer.appendChild(div);
      });
    } else {
      const placeholder = (customType.description && customType.description.trim())
        ? customType.description.trim().slice(0, 120) + (customType.description.trim().length > 120 ? '…' : '')
        : 'Describe your request...';
      fieldsContainer.innerHTML = `
        <div>
          <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Details</label>
          <textarea id="custom_details" rows="4" required placeholder="${esc(placeholder)}" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
        </div>
      `;
    }
  }
  
  // Add submit button
  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Submit Request';
  submitBtn.onclick = () => submitRequest(type);
  submitBtn.style.cssText = `
    width: 100%;
    padding: 12px;
    background: #111;
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    margin-top: 20px;
  `;
  
  form.appendChild(fieldsContainer);
  form.appendChild(submitBtn);
  
  return form;
}

window.addSuppliesItem = function() {
  const list = document.getElementById("suppliesItemsList");
  if (!list) return;
  const categories = (typeof window !== "undefined" && window._suppliesFormCategoriesCache) || [];
  const row = document.createElement("div");
  row.className = "supplies-item-row";
  row.style.cssText = "display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa;";
  row.innerHTML = SUPPLIES_ITEM_ROW_INNER_HTML;
  list.appendChild(row);
  wireSuppliesItemRow(row, categories);
};

async function submitRequest(type) {
  console.log('[Inbox] Submitting request:', type);
  
  if (!currentUserProfile) {
    showToast('User profile not loaded', 'error');
    return;
  }

  if (!inboxCanSendRequests()) {
    showToast('You do not have permission to create requests.', 'error');
    return;
  }
  
  try {
    // Collect form data
    let data = {};
    
    if (type === 'vacation') {
      const startDate = document.getElementById('vacation_startDate')?.value;
      const endDate = document.getElementById('vacation_endDate')?.value;
      const note = document.getElementById('vacation_note')?.value || null;
      
      if (!startDate || !endDate) {
        showToast('Please fill in all required fields', 'error');
        return;
      }
      
      // Calculate days
      const start = new Date(startDate);
      const end = new Date(endDate);
      const daysCount = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
      
      data = {
        startDate,
        endDate,
        daysCount,
        note,
        subjectUid: currentUserProfile.uid,
        subjectStaffId: currentUserProfile.staffId || '',
      };
      
    } else if (type === 'late_start') {
      const date = document.getElementById('latestart_date')?.value;
      const time = document.getElementById('latestart_time')?.value;
      const reason = document.getElementById('latestart_reason')?.value;
      
      if (!date || !time || !reason) {
        showToast('Please fill in all required fields', 'error');
        return;
      }
      
      data = {
        date,
        requestedTime: time,
        startTime: time,
        reason,
        normalTime: null,
        subjectUid: currentUserProfile.uid,
        subjectStaffId: currentUserProfile.staffId || '',
      };
      
    } else if (type === 'early_leave') {
      const date = document.getElementById('earlyleave_date')?.value;
      const time = document.getElementById('earlyleave_time')?.value;
      const reason = document.getElementById('earlyleave_reason')?.value;
      
      if (!date || !time || !reason) {
        showToast('Please fill in all required fields', 'error');
        return;
      }
      
      data = {
        date,
        requestedTime: time,
        endTime: time,
        reason,
        normalTime: null,
        subjectUid: currentUserProfile.uid,
        subjectStaffId: currentUserProfile.staffId || '',
      };
      
    } else if (type === 'day_off') {
      const date = document.getElementById('dayoff_date')?.value;
      const note = document.getElementById('dayoff_note')?.value?.trim() || null;
      if (!date) {
        showToast('Please select a date', 'error');
        return;
      }
      data = {
        date,
        note,
        affectedDates: [date],
        subjectUid: currentUserProfile.uid,
        subjectStaffId: currentUserProfile.staffId || '',
      };

    } else if (type === 'time_off') {
      const startDate = document.getElementById('timeoff_startDate')?.value;
      const endDate = document.getElementById('timeoff_endDate')?.value || startDate;
      const note = document.getElementById('timeoff_note')?.value?.trim() || null;
      if (!startDate) {
        showToast('Please select the first day off', 'error');
        return;
      }
      const affectedDates = enumerateInclusiveDateKeysForInbox(startDate, endDate);
      data = {
        startDate,
        endDate: endDate || startDate,
        note,
        affectedDates,
        subjectUid: currentUserProfile.uid,
        subjectStaffId: currentUserProfile.staffId || '',
      };

    } else if (type === 'schedule_change') {
      const current = document.getElementById('schedchange_current')?.value || '';
      const requested = document.getElementById('schedchange_requested')?.value;
      const reason = document.getElementById('schedchange_reason')?.value;
      const isTemporary = document.getElementById('schedchange_temporary')?.checked || false;
      const startDate = document.getElementById('schedchange_startDate')?.value || '';
      const endDate = document.getElementById('schedchange_endDate')?.value || startDate;
      
      if (!requested || !reason) {
        showToast('Please fill in all required fields', 'error');
        return;
      }
      if (!startDate) {
        showToast('Please select the first date this change applies to.', 'error');
        return;
      }
      const affectedDates = enumerateInclusiveDateKeysForInbox(startDate, endDate);
      data = {
        currentSchedule: current,
        requestedSchedule: requested,
        reason,
        isTemporary,
        startDate,
        endDate: endDate || startDate,
        affectedDates,
        subjectUid: currentUserProfile.uid,
        subjectStaffId: currentUserProfile.staffId || '',
      };
      
    } else if (type === 'extra_shift') {
      const date = document.getElementById('extra_shift_date')?.value || null;
      const details = document.getElementById('extra_shift_details')?.value?.trim();
      if (!details) { showToast('Please enter details', 'error'); return; }
      data = { date, details };
    } else if (type === 'swap_shift') {
      const date = document.getElementById('swap_shift_date')?.value || null;
      const details = document.getElementById('swap_shift_details')?.value?.trim();
      if (!details) { showToast('Please enter details', 'error'); return; }
      data = { date, details };
    } else if (type === 'break_change') {
      const date = document.getElementById('break_change_date')?.value;
      const details = document.getElementById('break_change_details')?.value?.trim();
      if (!date || !details) { showToast('Please fill in date and details', 'error'); return; }
      data = { date, details };
    } else if (type === 'commission_review' || type === 'tip_adjustment' || type === 'payment_issue' || type === 'client_issue') {
      const subject = document.getElementById(type + '_subject')?.value?.trim() || null;
      const details = document.getElementById(type + '_details')?.value?.trim();
      if (!details) { showToast('Please enter details', 'error'); return; }
      data = { subject, details };

    } else if (type === 'document_renewal_request') {
      const documentType = document.getElementById('doc_renew_type')?.value;
      const message = document.getElementById('doc_renew_message')?.value?.trim();
      const dueDate = document.getElementById('doc_renew_due')?.value || null;
      const relatedDocumentId = (document.getElementById('doc_renew_related_document_id')?.value || '').trim();
      if (!documentType || !message) {
        showToast('Please select document type and enter a message', 'error');
        return;
      }
      data = { documentType, message, dueDate, relatedDocumentId: relatedDocumentId || null, promptKind: 'renewal' };

    } else if (type === 'document_request') {
      const documentType = document.getElementById('doc_req_type')?.value;
      const reason = document.getElementById('doc_req_reason')?.value?.trim();
      const dueDate = document.getElementById('doc_req_due')?.value || null;
      const deliveryMethod = document.getElementById('doc_req_delivery')?.value || 'Email';
      const contactEmail = document.getElementById('doc_req_email')?.value?.trim() || auth.currentUser?.email || currentUserProfile?.email || null;
      if (!documentType || !reason) { showToast('Please select document type and enter reason', 'error'); return; }
      data = { documentType, reason, dueDate, deliveryMethod, contactEmail };

    } else if (type === 'document_upload') {
      const documentType = document.getElementById('doc_up_type')?.value;
      const expirationDate = document.getElementById('doc_up_expiry')?.value || null;
      const renewForDocId = (document.getElementById('doc_up_renew_for_doc_id')?.value || '').trim();
      const fileInput = document.getElementById('doc_up_file');
      const notes = document.getElementById('doc_up_notes')?.value?.trim() || null;
      const salonId = currentUserProfile.salonId;
      const ownerStaffId = await resolveSubmittingStaffIdForDocumentUpload(salonId);
      if (!ownerStaffId) {
        showToast(
          'Your login is not linked to a staff profile in this salon. Ask a manager to link your account, then try again.',
          'error'
        );
        return;
      }
      if (!documentType || !fileInput?.files?.length) { showToast('Please select document type and choose a file', 'error'); return; }
      const file = fileInput.files[0];
      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) { showToast('File must be under 10 MB', 'error'); return; }
      const yyyyMm = new Date().toISOString().slice(0, 7);
      const fileId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const safeName = (file.name || 'file').replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 80);
      const path = `salons/${salonId}/staff/${ownerStaffId}/documents/${documentType}/${yyyyMm}/${fileId}_${safeName}`;
      showToast('Uploading file...', 'info');
      const fileRef = storageRef(storage, path);
      await uploadBytes(fileRef, file);
      const fileUrl = await getDownloadURL(fileRef);
      data = {
        documentType,
        expirationDate,
        filePath: path,
        fileUrl,
        fileName: file.name,
        notes,
        documentOwnerStaffId: ownerStaffId,
        ...(renewForDocId ? { staffDocumentId: renewForDocId } : {}),
      };
      
    } else if (type === 'supplies') {
      const rows = document.querySelectorAll(".supplies-item-row");
      const items = [];
      for (const row of rows) {
        const st = classifySuppliesRow(row);
        if (st === "empty") continue;
        if (st === "incomplete") {
          showToast("Each line with a selection needs category, subcategory, and item.", "error");
          return;
        }
        if (suppliesRowRequiresVariant(row)) {
          const vk = (row.querySelector(".supplies-variant-select")?.value || "").trim();
          if (vk !== "dip" && vk !== "gel" && vk !== "regular") {
            showToast("Select a variant (Dip, Gel, or Regular) for each line that uses variants.", "error");
            return;
          }
        }
        const snap = readSuppliesRowSnapshot(row);
        if (snap) items.push(snap);
      }
      if (items.length === 0) {
        showToast("Add at least one complete line (category, subcategory, and item).", "error");
        return;
      }
      const urgency = document.getElementById("supplies_urgency")?.value || "routine";
      const note = document.getElementById("supplies_note")?.value || null;
      data = { items, urgency, note };
      
    } else if (type === 'maintenance') {
      const issue = document.getElementById('maintenance_issue')?.value;
      const area = document.getElementById('maintenance_area')?.value;
      const severity = document.getElementById('maintenance_severity')?.value || 'minor';
      const note = document.getElementById('maintenance_note')?.value || null;
      
      if (!issue || !area) {
        showToast('Please fill in all required fields', 'error');
        return;
      }
      
      data = { issue, area, severity, note };
      
    } else if (type === 'other') {
      const subject = document.getElementById('other_subject')?.value;
      const details = document.getElementById('other_details')?.value;
      
      if (!subject || !details) {
        showToast('Please fill in all required fields', 'error');
        return;
      }
      
      data = { subject, details };
    } else {
      // Custom request type: either dynamic fields or single Details
      const customType = getRequestTypeInfo(type);
      const fields = (customType.fields || []);
      if (fields.length > 0) {
        data = {};
        for (const f of fields) {
          const el = document.getElementById('custom_field_' + f.id);
          const val = el?.value != null ? (el.type === 'number' ? (parseFloat(el.value) || null) : String(el.value).trim()) : '';
          if (f.required && !val) {
            showToast('Please fill in: ' + (f.label || f.id), 'error');
            return;
          }
          data[f.id] = val;
        }
      } else {
        const details = document.getElementById('custom_details')?.value?.trim();
        if (!details) {
          showToast('Please enter details', 'error');
          return;
        }
        data = { details };
      }
    }
    
    let sentToUids = [];
    let sentToStaffIds = [];
    let sentToNames = [];

    if (type === 'document_renewal_request') {
      const sel = document.getElementById('doc_renew_staff');
      const opt = sel?.selectedOptions?.[0];
      const uid = opt?.getAttribute('data-uid') || '';
      const sid = opt?.getAttribute('data-staff-id') || '';
      const nm = (opt?.getAttribute('data-name') || '').trim() || (opt?.textContent || '').trim();
      if (!uid) {
        showToast('Please select a staff member', 'error');
        return;
      }
      sentToUids = [uid];
      sentToStaffIds = [sid];
      sentToNames = [nm];
    } else {
      const sel = getCreateRequestSelectedRecipients();
      sentToUids = sel.uids;
      sentToStaffIds = sel.staffIds;
      sentToNames = sel.names;
    }

    const hasAnySelected = (sentToUids && sentToUids.length > 0) || (sentToNames && sentToNames.length > 0);
    const hasValidUid = sentToUids && sentToUids.some(u => u && u.trim());
    if (type !== 'document_renewal_request' && getInboxRecipientsList().length > 0 && !hasAnySelected) {
      showToast('Please choose who receives this request', 'error');
      return;
    }
    if (type !== 'document_renewal_request' && hasAnySelected && !hasValidUid) {
      // Recipient selected but uid not known — try one more time to load from members
      await loadSalonUsersForRecipients();
      const recipName = sentToNames[0] || '';
      const found = (_inboxUsersCache || []).find(u =>
        u.name && recipName && u.name.toLowerCase().trim() === recipName.toLowerCase().trim()
      );
      if (found && found.uid) {
        sentToUids[0] = found.uid;
      } else {
        const recipNameDisplay = sentToNames[0] || 'the selected recipient';
        showToast(`${recipNameDisplay} needs to log in to the app at least once before they can receive requests.`, 'error');
        return;
      }
    }
    
    const salonId = currentUserProfile.salonId;

    const docUploadOwnerExtra =
      type === 'document_upload' && data && data.documentOwnerStaffId
        ? { documentOwnerStaffId: String(data.documentOwnerStaffId).trim() }
        : {};

    const baseDoc = {
      tenantId: salonId,
      locationId: null,
      type: type,
      status: type === "supplies" ? "pending" : "open",
      priority: 'normal',
      assignedTo: null,
      sentToStaffIds: Array.isArray(sentToStaffIds) ? sentToStaffIds : [],
      sentToNames: Array.isArray(sentToNames) ? sentToNames : [],
      data: data,
      managerNotes: null,
      responseNote: null,
      decidedBy: null,
      decidedAt: null,
      needsInfoQuestion: null,
      staffReply: null,
      visibility: 'managers_only',
      unreadForManagers: true,
      ...docUploadOwnerExtra,
    };
    
    const hasRecipients = sentToUids && sentToUids.some(u => u && u.trim());
    if (hasRecipients) {
      // forUid comes directly from data-uid (Firebase UID) — no lookup needed
      const forUid = sentToUids.find(u => u && u.trim()) || sentToUids[0];
      const forStaffId = sentToStaffIds[0] || '';
      const forStaffName = sentToNames[0] || '';

      console.log('[Inbox] Sending request: createdByUid=', currentUserProfile.uid, 'forUid=', forUid, 'forName=', forStaffName);

      if (forUid === currentUserProfile.uid) {
        showToast('Cannot send a request to yourself', 'error');
        return;
      }

      const requestDoc = {
        ...baseDoc,
        createdByUid: currentUserProfile.uid,
        createdByStaffId: currentUserProfile.staffId || '',
        createdByName: currentUserProfile.name || '',
        createdByRole: currentUserProfile.role || '',
        forUid,
        forStaffId,
        forStaffName,
        createdAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
        updatedAt: null
      };
      const docRef = await addDoc(collection(db, `salons/${salonId}/inboxItems`), requestDoc);
      console.log('[Inbox] Request created with forUid=', forUid, 'docId=', docRef.id);
    } else {
      // Technician creating for self — direct Firestore (forUid = creator)
      const requestDoc = {
        ...baseDoc,
        createdByUid: currentUserProfile.uid,
        createdByStaffId: currentUserProfile.staffId || '',
        createdByName: currentUserProfile.name || '',
        createdByRole: currentUserProfile.role || '',
        forUid: currentUserProfile.uid,
        forStaffId: currentUserProfile.staffId || '',
        forStaffName: currentUserProfile.name || '',
        createdAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
        updatedAt: null
      };
      const docRef = await addDoc(collection(db, `salons/${salonId}/inboxItems`), requestDoc);
      console.log('[Inbox] Request created', docRef.id);
    }
    
    // Close modal
    closeCreateRequestModal();
    
    // Show success toast
    showToast('Request submitted successfully!', 'success');
    
    // Reload list
    loadInboxItems();
    
  } catch (error) {
    console.error('[Inbox] Submit error', error);
    let msg = error?.details || error?.message || String(error);
    if (msg === 'internal' || msg === 'Request creation failed.') {
      msg = 'Server error. Try again later or check Firebase Functions logs.';
    }
    if (msg.includes('Recipient has not signed in') || msg.includes('failed-precondition') || msg.includes('not found')) {
      msg = 'The selected recipient has not signed in yet. They need to accept their invite and create an account first.';
    }
    showToast(msg, 'error');
  }
}

// =====================
// Toast Notifications (global Fair Flow API — public/ff-toast.js)
// =====================
function showToast(message, type = 'success') {
  if (typeof window !== 'undefined' && window.ffToast && typeof window.ffToast.show === 'function') {
    const v =
      type === 'success' ? 'success' : type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info';
    const ms = type === 'error' ? 6500 : 4500;
    window.ffToast.show(String(message), { variant: v, durationMs: ms });
    return;
  }
  console.warn('[Inbox]', message, type);
}

// =====================
// Request Details Modal
// =====================
function showRequestDetails(requestId) {
  const request = currentRequests.find(r => r.id === requestId);
  if (!request) return;
  
  console.log('[Inbox] Showing request details', requestId);

  // Mark as read only if the current user IS the recipient (forUid), not the sender
  const isManagerRole = inboxCanManageInbox();
  const isRecipientViewing = isManagerRole && request.forUid === currentUserProfile.uid;
  if (isRecipientViewing && request.unreadForManagers === true && currentUserProfile.salonId) {
    // Optimistic: update local state immediately
    const idx = currentRequests.findIndex(r => r.id === requestId);
    if (idx !== -1) currentRequests[idx] = { ...currentRequests[idx], unreadForManagers: false };
    updateInboxBadges();
    // Persist to Firestore in background (no lastActivityAt change to avoid reorder)
    updateDoc(doc(db, `salons/${currentUserProfile.salonId}/inboxItems`, requestId), {
      unreadForManagers: false
    }).catch(err => console.warn('[Inbox] Mark read failed', err));
  }
  
  const modal = document.createElement('div');
  modal.id = 'requestDetailsModal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999999;
    padding: 20px;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: #fff;
    border-radius: 12px;
    padding: 24px;
    max-width: 600px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
  `;
  
  const typeInfo = getRequestTypeInfo(request.type);
  const statusStrModal = String(request.status != null ? request.status : "open");
  const statusModalDisplay = inboxSupplyStatusDisplayLabel(request) || statusStrModal.replace(/_/g, " ");
  const statusClass = `inbox-status-${statusStrModal.replace(/_/g, "-")}`;
  const createdDate = request.createdAt?.toDate ? request.createdAt.toDate() : new Date();
  const rd = request.data || {};
  const isDocAlert = request.type === 'document_expiring_soon' || request.type === 'document_expired';

  // Role checks
  const isManager = inboxCanManageInbox();
  const isTechnician = currentUserProfile && inboxUserRoleLc() === "technician";
  const isMyRequest = currentUserProfile && request.forUid === currentUserProfile.uid;

  let docAlertPanelHtml = '';
  if (isDocAlert) {
    const isSoon = !inboxDocAlertIsExpiredForUi(request);
    const he = ffDocAlertIsHebrewUI();
    const badgeLabel = isSoon ? (he ? 'יפוג בקרוב' : 'Expiring soon') : (he ? 'פג תוקף' : 'Expired');
    const panelStyle = isSoon
      ? 'border-left:4px solid #d97706;background:linear-gradient(180deg,#fffbeb 0%,#ffffff 100%);border:1px solid #fde68a;border-radius:12px;padding:18px 18px 16px;margin-bottom:20px;'
      : 'border-left:4px solid #b91c1c;background:linear-gradient(180deg,#fef2f2 0%,#ffffff 100%);border:1px solid #fecaca;border-radius:12px;padding:18px 18px 16px;margin-bottom:20px;';
    const badgeBg = isSoon ? '#fef3c7' : '#fee2e2';
    const badgeColor = isSoon ? '#92400e' : '#991b1b';
    const msg = (request.message || rd.message || '').trim();
    const docAlertMgmtNote = isManager
      ? `<span style="font-size:11px;color:#6b7280;">${he ? 'העובד לא קיבל התראה · נראה למנהלים בלבד' : 'Employee not notified · managers only'}</span>`
      : '';
    docAlertPanelHtml = `
    <div style="${panelStyle}">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;background:${badgeBg};color:${badgeColor};">${escapeHtml(badgeLabel)}</span>
        ${docAlertMgmtNote}
      </div>
      <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:#111827;line-height:1.45;">${escapeHtml(ffDocAlertHumanSummary(request))}</p>
      <p style="margin:0 0 14px;font-size:13px;color:#4b5563;line-height:1.5;">${escapeHtml(ffDocAlertWhatToDoLine())}</p>
      <div style="display:grid;gap:10px;font-size:13px;color:#374151;margin-bottom:8px;">
        <div style="display:flex;gap:8px;align-items:flex-start;"><span style="min-width:108px;color:#9ca3af;flex-shrink:0;">${he ? 'שם העובד' : 'Employee'}</span><strong style="font-weight:600;">${escapeHtml(ffDocAlertStaffName(request))}</strong></div>
        <div style="display:flex;gap:8px;align-items:flex-start;"><span style="min-width:108px;color:#9ca3af;flex-shrink:0;">${he ? 'שם המסמך' : 'Document name'}</span><span style="word-break:break-word;">${escapeHtml(ffDocAlertDocTitle(request))}</span></div>
        <div style="display:flex;gap:8px;align-items:flex-start;"><span style="min-width:108px;color:#9ca3af;flex-shrink:0;">${he ? 'סוג המסמך' : 'Document type'}</span><span>${escapeHtml(ffDocAlertDocType(request))}</span></div>
        <div style="display:flex;gap:8px;align-items:flex-start;"><span style="min-width:108px;color:#9ca3af;flex-shrink:0;">${he ? 'תאריך תפוגה' : 'Expiration date'}</span><span>${escapeHtml(ffDocAlertExpFormattedLong(request) || '—')}</span></div>
        ${msg ? `<div style="display:flex;gap:8px;align-items:flex-start;"><span style="min-width:108px;color:#9ca3af;flex-shrink:0;">${he ? 'הודעה' : 'Message'}</span><span style="flex:1;line-height:1.45;">${escapeHtml(msg)}</span></div>` : ''}
      </div>
      <div style="font-size:11px;color:#9ca3af;margin-top:4px;">${he ? 'מקור' : 'Source'}: ${escapeHtml(rd.source || request.source || 'staff_documents')} · ${he ? 'נוצר' : 'Logged'} ${escapeHtml(createdDate.toLocaleString())}</div>
    </div>`;
  }

  const birthdayMeta =
    request.type === 'staff_birthday_reminder'
      ? `
    <div style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:20px;">
      <div style="font-size:13px;color:#374151;line-height:1.55;">
        <div style="font-weight:600;margin-bottom:6px;color:#111;">Automated salon reminder</div>
        <p style="margin:0 0 12px;color:#6b7280;font-size:12px;">The employee is not notified. Visible to management only.</p>
        <div style="display:grid;gap:8px;font-size:13px;">
          <div><span style="color:#6b7280;">Staff member:</span> <strong>${escapeHtml(rd.subjectStaffName || '')}</strong></div>
          <div><span style="color:#6b7280;">Birthday:</span> ${escapeHtml(rd.birthdayDisplay || '')}</div>
          <div><span style="color:#6b7280;">When:</span> ${rd.daysUntil === 0 ? 'Today' : `In ${Number(rd.daysUntil) || 0} day(s)`}</div>
          <div><span style="color:#6b7280;">Logged:</span> ${createdDate.toLocaleString()}</div>
        </div>
      </div>
    </div>`
      : request.type === 'document_renewal_request'
      ? `
    <div style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:20px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px;">
        <div>
          <div style="color:#6b7280;margin-bottom:4px;">From</div>
          <div style="font-weight:500;">${escapeHtml(request.createdByName || '')}</div>
        </div>
        <div>
          <div style="color:#6b7280;margin-bottom:4px;">Asked to upload</div>
          <div style="font-weight:500;">${escapeHtml(request.forStaffName || '')}</div>
        </div>
        <div>
          <div style="color:#6b7280;margin-bottom:4px;">Created</div>
          <div style="font-weight:500;">${createdDate.toLocaleDateString()} ${createdDate.toLocaleTimeString()}</div>
        </div>
      </div>
    </div>`
      : isDocAlert
      ? docAlertPanelHtml
      : `
    <div style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:20px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px;">
        <div>
          <div style="color:#6b7280;margin-bottom:4px;">Requested by</div>
          <div style="font-weight:500;">${request.forStaffName}</div>
        </div>
        <div>
          <div style="color:#6b7280;margin-bottom:4px;">Created</div>
          <div style="font-weight:500;">${createdDate.toLocaleDateString()} ${createdDate.toLocaleTimeString()}</div>
        </div>
      </div>
      ${(request.sentToNames && request.sentToNames.length > 0) ? `
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:13px;">
        <div style="color:#6b7280;margin-bottom:4px;">Sent to</div>
        <div style="font-weight:500;">${escapeHtml(request.sentToNames.join(', '))}</div>
      </div>
      ` : ''}
    </div>`;
  
  let detailsHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <span style="font-size:28px;">${typeInfo.icon}</span>
        <div>
          <h2 style="margin:0;font-size:18px;font-weight:600;">${typeInfo.label}</h2>
          <span class="inbox-status-badge ${statusClass}">${statusModalDisplay}</span>
        </div>
      </div>
      <button onclick="closeRequestDetailsModal()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#9ca3af;">&times;</button>
    </div>
    
    ${birthdayMeta}
    
    <div style="margin-bottom:20px;">
      ${isDocAlert ? '' : `<h3 style="font-size:14px;font-weight:600;margin-bottom:12px;color:#374151;">${request.type === 'staff_birthday_reminder' ? 'Summary' : 'Request Details'}</h3>`}
      ${isDocAlert ? ffDocAlertModalFooterIds(request) : renderRequestData(request)}
    </div>
    
    ${request.needsInfoQuestion ? `
      <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:16px;margin-bottom:20px;">
        <div style="font-size:13px;font-weight:600;color:#92400e;margin-bottom:8px;">❓ Manager Question:</div>
        <div style="font-size:13px;color:#78350f;">${request.needsInfoQuestion}</div>
        ${request.staffReply ? `
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid #fbbf24;">
            <div style="font-size:13px;font-weight:600;color:#92400e;margin-bottom:8px;">✓ Your Reply:</div>
            <div style="font-size:13px;color:#78350f;">${request.staffReply}</div>
          </div>
        ` : ''}
      </div>
    ` : ''}
  `;
  
  // Reply box: shown to the REQUEST CREATOR when status is needs_info (any role)
  const isCreator = currentUserProfile && request.createdByUid === currentUserProfile.uid;
  if (isCreator && request.status === 'needs_info' && !request.staffReply) {
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;color:#374151;">Your Reply</h3>
        <textarea id="staffReplyInput" rows="3" placeholder="Answer the question..." style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;margin-bottom:12px;box-sizing:border-box;"></textarea>
        <button onclick="submitStaffReply('${requestId}')" style="width:100%;padding:10px;background:#111;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">
          Submit Reply
        </button>
      </div>
    `;
  }

  if (
    isTechnician &&
    isMyRequest &&
    request.type === 'document_renewal_request' &&
    request.status === 'open' &&
    inboxCanSendRequests()
  ) {
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;color:#374151;">Your action</h3>
        <p style="font-size:13px;color:#6b7280;margin-bottom:12px;">Upload a renewed document for management to review.</p>
        <button type="button" onclick="closeRequestDetailsModal(); openCreateRequestModal(); selectRequestType('document_upload');" style="width:100%;padding:12px;background:#111;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;">
          📤 Upload a Document
        </button>
      </div>
    `;
  }

  const isRenewalCreator =
    inboxCanSendRequests() &&
    currentUserProfile &&
    request.createdByUid === currentUserProfile.uid &&
    request.type === 'document_renewal_request' &&
    request.createdByUid !== request.forUid;
  if (isRenewalCreator && (request.status === 'open' || request.status === 'needs_info')) {
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;color:#374151;">Follow-up</h3>
        <p style="font-size:13px;color:#6b7280;margin-bottom:12px;">Archive this when the staff member has uploaded or you no longer need the reminder.</p>
        <button type="button" onclick="archiveRequest('${requestId}')" style="width:100%;padding:10px;border:1px solid #9ca3af;background:#fff;color:#374151;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500;">
          📦 Archive
        </button>
      </div>
    `;
  }
  
  // Manager actions — only for the RECIPIENT (who the request was sent TO), not the creator
  const isRecipient = currentUserProfile && request.forUid === currentUserProfile.uid;
  if (isManager && isRecipient && request.status === 'open' && request.type === 'staff_birthday_reminder') {
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <button type="button" onclick="markBirthdayReminderDone('${requestId}')" style="width:100%;padding:12px;background:#7c3aed;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;">
          ✓ Mark done &amp; archive
        </button>
      </div>
    `;
  } else if (isManager && isRecipient && request.status === 'open' && isDocAlert) {
    const docAlertBtnBase =
      'display:inline-flex;align-items:center;justify-content:center;min-height:32px;padding:6px 12px;font-size:12px;font-weight:600;border-radius:999px;line-height:1.2;font-family:inherit;box-sizing:border-box;white-space:nowrap;';
    const docAlertBtnOutline = `${docAlertBtnBase}background:#fff;color:#374151;border:1px solid #d1d5db;cursor:pointer;`;
    const docAlertBtnChat = `${docAlertBtnBase}cursor:pointer;border:1px solid #7c3aed;background:#ede9fe;color:#5b21b6;touch-action:manipulation;`;
    const docAlertBtnDone = `${docAlertBtnBase}background:#7c3aed;color:#fff;border:none;cursor:pointer;`;
    const sid = ffDocAlertStaffId(request);
    const openStaffBtn = sid && typeof window.openStaffMembersModal === 'function'
      ? `<button type="button" data-ff-doc-alert-open-staff="${encodeURIComponent(sid)}" style="${docAlertBtnOutline}">
          ${ffDocAlertIsHebrewUI() ? 'פתח עובד' : 'Open Staff Member'}
        </button>`
      : '';
    const renewPayload = {
      staffId: ffDocAlertStaffId(request),
      documentType: (rd.documentType || request.documentType || '').trim(),
      documentId: (rd.documentId || request.documentId || '').trim(),
    };
    const chatPayload = {
      salonId: currentUserProfile.salonId,
      staffId: renewPayload.staffId,
      documentId: renewPayload.documentId,
    };
    const chatPayloadAttr =
      renewPayload.staffId && renewPayload.documentId
        ? encodeURIComponent(JSON.stringify(chatPayload))
        : '';
    const chatBtn =
      chatPayloadAttr
        ? `<button type="button" data-ff-doc-alert-chat="1" data-payload="${chatPayloadAttr}" style="${docAlertBtnChat}" title="${ffDocAlertIsHebrewUI() ? 'שליחת תזכורת בצ׳אט לעובד' : 'Send this staff member a chat reminder'}">
          ${ffDocAlertIsHebrewUI() ? 'שלח תזכורת בצ׳אט' : 'Send chat reminder'}
        </button>`
        : '';
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;color:#374151;">${ffDocAlertIsHebrewUI() ? 'פעולות' : 'Actions'}</h3>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          ${openStaffBtn}
          ${chatBtn}
          <button type="button" onclick="markBirthdayReminderDone('${requestId}')" style="${docAlertBtnDone}">
            ✓ ${ffDocAlertIsHebrewUI() ? 'סמן כבוצע וארכב' : 'Mark done &amp; archive'}
          </button>
        </div>
      </div>
    `;
  } else if (isManager && isRecipient && request.type === "supplies" && inboxSupplyRequestIsPending(request)) {
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;color:#374151;">Manager Actions</h3>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <button type="button" onclick="approveRequest('${requestId}')" style="padding:10px;border:1px solid #10b981;background:#10b981;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;width:100%;">
            ✓ Approve
          </button>
          <button type="button" onclick="denyRequest('${requestId}')" style="padding:10px;border:1px solid #ef4444;background:#ef4444;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;width:100%;">
            ✗ Deny
          </button>
        </div>
      </div>
    `;
  } else if (isManager && isRecipient && request.status === "open") {
    const isDocRequest = request.type === 'document_request';
    const isDocMeta = request.type === 'document_upload' || request.type === 'document_request';
    const docMetaEditBtn = isDocMeta
      ? `<button type="button" onclick="ffInboxOpenDocumentMetadataEdit('${requestId}')" title="Edit document type, expiration, etc. before approving" style="min-width:44px;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;background:#fff;cursor:pointer;font-size:16px;line-height:1;flex-shrink:0;">✏️</button>`
      : '';
    const approveRow = isDocMeta
      ? `<div style="display:flex;align-items:stretch;gap:8px;margin-bottom:12px;">
          <button onclick="approveRequest('${requestId}')" style="flex:1;padding:10px;border:1px solid #10b981;background:#10b981;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">
            ✓ Approve
          </button>
          ${docMetaEditBtn}
        </div>`
      : `<button onclick="approveRequest('${requestId}')" style="padding:10px;border:1px solid #10b981;background:#10b981;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;width:100%;margin-bottom:12px;">
            ✓ Approve
          </button>`;
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;color:#374151;">Manager Actions</h3>
        ${isDocRequest ? `
        <div style="margin-bottom:16px;padding:12px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;">
          <div style="font-size:13px;font-weight:600;color:#166534;margin-bottom:8px;">📄 Upload response document</div>
          <input type="file" id="docResponseFile_${requestId}" accept=".pdf,.jpg,.jpeg,.png" style="width:100%;padding:8px;margin-bottom:8px;border:1px solid #d1d5db;border-radius:6px;">
          <button onclick="uploadDocumentResponse('${requestId}')" style="width:100%;padding:10px;background:#059669;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">
            Upload file & mark Done
          </button>
        </div>
        <div style="font-size:12px;color:#6b7280;margin-bottom:12px;">— or —</div>
        ` : ''}
        <div style="display:flex;flex-direction:column;gap:12px;">
          <button onclick="needsMoreInfo('${requestId}')" style="padding:10px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:14px;font-weight:500;">
            ❓ Request More Info
          </button>
          
          ${approveRow}
          
          <button onclick="denyRequest('${requestId}')" style="padding:10px;border:1px solid #ef4444;background:#ef4444;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">
            ✗ Deny
          </button>
        </div>
      </div>
    `;
  }
  
  // Manager actions for needs_info status — only for recipient
  if (isManager && isRecipient && request.status === 'needs_info') {
    const isDocMetaNi = request.type === 'document_upload' || request.type === 'document_request';
    const docMetaEditBtnNi = isDocMetaNi
      ? `<button type="button" onclick="ffInboxOpenDocumentMetadataEdit('${requestId}')" title="Edit document details" style="min-width:44px;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;background:#fff;cursor:pointer;font-size:16px;line-height:1;flex-shrink:0;">✏️</button>`
      : '';
    const approveAnywayRow = isDocMetaNi
      ? `<div style="display:flex;align-items:stretch;gap:8px;margin-bottom:8px;">
          <button onclick="approveRequest('${requestId}')" style="flex:1;padding:10px;border:1px solid #10b981;background:#10b981;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">
            ✓ Approve Anyway
          </button>
          ${docMetaEditBtnNi}
        </div>`
      : `<button onclick="approveRequest('${requestId}')" style="padding:10px;border:1px solid #10b981;background:#10b981;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;width:100%;margin-bottom:8px;">
          ✓ Approve Anyway
        </button>`;
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;color:#374151;">Manager Actions</h3>
        <div style="font-size:13px;color:#6b7280;margin-bottom:12px;">
          Waiting for staff response...
        </div>
        ${approveAnywayRow}
        <button onclick="denyRequest('${requestId}')" style="padding:10px;border:1px solid #ef4444;background:#ef4444;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;width:100%;">
          ✗ Deny
        </button>
      </div>
    `;
  }
  
  // Archive button (for approved/denied/done requests) — only for recipient
  if (isManager && isRecipient && (request.status === 'approved' || request.status === 'denied' || request.status === 'done')) {
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <button onclick="archiveRequest('${requestId}')" style="padding:10px;border:1px solid #9ca3af;background:#fff;color:#374151;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500;width:100%;">
          📦 Move to Archive
        </button>
      </div>
    `;
  }
  
  // Delete button (only for archived requests — permanent delete) — only for recipient
  if (isManager && isRecipient && request.status === 'archived') {
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <button onclick="deleteArchivedRequest('${requestId}')" style="padding:10px;border:1px solid #ef4444;background:#fef2f2;color:#dc2626;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500;width:100%;">
          🗑 Delete permanently
        </button>
      </div>
    `;
  }
  
  content.innerHTML = detailsHTML;
  try {
    const openStaffEl = content.querySelector('[data-ff-doc-alert-open-staff]');
    if (openStaffEl) {
      openStaffEl.addEventListener('click', () => {
        const raw = openStaffEl.getAttribute('data-ff-doc-alert-open-staff') || '';
        const id = decodeURIComponent(raw);
        if (typeof window.openDocumentAlertStaffMember === 'function') {
          window.openDocumentAlertStaffMember(id);
        }
      });
    }
    const chatEl = content.querySelector('[data-ff-doc-alert-chat]');
    if (chatEl) {
      chatEl.addEventListener('click', async () => {
        if (chatEl.disabled) return;
        const raw = chatEl.getAttribute('data-payload');
        if (!raw) return;
        try {
          const payload = JSON.parse(decodeURIComponent(raw));
          if (typeof window.ffDocAlertSendChatReminder !== 'function') return;
          chatEl.disabled = true;
          chatEl.style.opacity = '0.65';
          chatEl.style.pointerEvents = 'none';
          try {
            await window.ffDocAlertSendChatReminder(payload);
          } finally {
            chatEl.disabled = false;
            chatEl.style.opacity = '';
            chatEl.style.pointerEvents = '';
          }
        } catch (err) {
          console.warn('[Inbox] doc alert chat payload', err);
        }
      });
    }
  } catch (e) {
    console.warn('[Inbox] doc alert action wiring', e);
  }
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  // Click outside to close
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeRequestDetailsModal();
    }
  };
}

window.closeRequestDetailsModal = function() {
  const modal = document.getElementById('requestDetailsModal');
  if (modal) modal.remove();
};

/**
 * Files live in Firebase Storage; the UI must use a download URL (link). The stored `fileName`
 * sometimes matches the storage basename (`{generatedId}_{sanitizedOriginal}`) — strip a long
 * generated first segment so the link label looks like the real filename.
 */
function inboxDisplayUploadedFileLinkLabel(data) {
  const d = data || {};
  let name = d.fileName != null ? String(d.fileName).trim() : "";
  const base = (d.filePath || "").split("/").filter(Boolean).pop() || "";
  if (!name) name = base;
  if (name) {
    const parts = name.split("_");
    if (parts.length >= 2) {
      const first = parts[0];
      if (first.length >= 12 && /^[a-zA-Z0-9.-]+$/.test(first)) {
        name = parts.slice(1).join("_");
      }
    }
  }
  if (!name) name = "View file";
  if (name.length > 72) name = `${name.slice(0, 69)}…`;
  return name;
}

/** True when filename/path/url suggests an image (thumbnail + lightbox in inbox). */
function inboxUploadedFileLooksLikeImage(data) {
  const d = data || {};
  const hint = `${d.fileName || ""} ${d.fileUrl || ""} ${d.filePath || ""}`.toLowerCase();
  return /\.(jpg|jpeg|png|gif|webp|heic|heif)(\?|#|$)/i.test(hint);
}

window.ffInboxOverlayPreviewImage = function (url) {
  try {
    const safe = String(url || "").trim();
    if (!/^https?:\/\//i.test(safe)) return;
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "position:fixed;inset:0;z-index:1000000;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;padding:20px;cursor:zoom-out;";
    const img = document.createElement("img");
    img.src = safe;
    img.alt = "";
    img.style.cssText =
      "max-width:96vw;max-height:92vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.45);cursor:default;";
    wrap.appendChild(img);
    wrap.onclick = () => wrap.remove();
    document.body.appendChild(wrap);
  } catch (_) {}
};

function renderRequestData(request) {
  const data = request.data || {};
  
  switch (request.type) {
    case 'vacation':
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          <div>
            <span style="color:#6b7280;">Start Date:</span>
            <span style="font-weight:500;margin-left:8px;">${data.startDate || 'N/A'}</span>
          </div>
          <div>
            <span style="color:#6b7280;">End Date:</span>
            <span style="font-weight:500;margin-left:8px;">${data.endDate || 'N/A'}</span>
          </div>
          <div>
            <span style="color:#6b7280;">Duration:</span>
            <span style="font-weight:500;margin-left:8px;">${data.daysCount || 0} days</span>
          </div>
          ${data.note ? `<div><span style="color:#6b7280;">Note:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${data.note}</div></div>` : ''}
        </div>
      `;
      
    case 'late_start':
    case 'early_leave':
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          <div>
            <span style="color:#6b7280;">Date:</span>
            <span style="font-weight:500;margin-left:8px;">${data.date || 'N/A'}</span>
          </div>
          <div>
            <span style="color:#6b7280;">Time:</span>
            <span style="font-weight:500;margin-left:8px;">${data.requestedTime || 'N/A'}</span>
          </div>
          <div>
            <span style="color:#6b7280;">Reason:</span>
            <div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${data.reason || 'N/A'}</div>
          </div>
        </div>
      `;
      
    case 'day_off':
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          <div><span style="color:#6b7280;">Date:</span><span style="font-weight:500;margin-left:8px;">${data.date || 'N/A'}</span></div>
          ${data.note ? `<div><span style="color:#6b7280;">Note:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${data.note}</div></div>` : ''}
        </div>
      `;
    case 'time_off':
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          <div><span style="color:#6b7280;">Range:</span><span style="font-weight:500;margin-left:8px;">${data.startDate || 'N/A'} → ${data.endDate || data.startDate || 'N/A'}</span></div>
          ${Array.isArray(data.affectedDates) && data.affectedDates.length ? `<div><span style="color:#6b7280;">Days (${data.affectedDates.length}):</span><span style="font-weight:500;margin-left:8px;">${data.affectedDates.join(', ')}</span></div>` : ''}
          ${data.note ? `<div><span style="color:#6b7280;">Note:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${data.note}</div></div>` : ''}
        </div>
      `;
    case 'schedule_change':
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          ${data.startDate ? `<div><span style="color:#6b7280;">Applies:</span><span style="font-weight:500;margin-left:8px;">${data.startDate}${data.endDate && data.endDate !== data.startDate ? ` → ${data.endDate}` : ''}</span></div>` : ''}
          ${Array.isArray(data.affectedDates) && data.affectedDates.length ? `<div><span style="color:#6b7280;">Affected dates:</span><span style="font-weight:500;margin-left:8px;font-size:12px;">${data.affectedDates.join(', ')}</span></div>` : ''}
          ${data.currentSchedule ? `<div><span style="color:#6b7280;">Current:</span><span style="font-weight:500;margin-left:8px;">${data.currentSchedule}</span></div>` : ''}
          <div>
            <span style="color:#6b7280;">Requested:</span>
            <span style="font-weight:500;margin-left:8px;">${data.requestedSchedule || 'N/A'}</span>
          </div>
          <div>
            <span style="color:#6b7280;">Type:</span>
            <span style="font-weight:500;margin-left:8px;">${data.isTemporary ? 'Temporary' : 'Permanent'}</span>
          </div>
          <div>
            <span style="color:#6b7280;">Reason:</span>
            <div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${data.reason || 'N/A'}</div>
          </div>
        </div>
      `;
      
    case 'supplies': {
      const decision = escapeHtml(inboxSupplyStatusDisplayLabel(request) || "—");
      const itemsHTML = (data.items || [])
        .map((item) => {
          if (item.itemId && item.itemName) {
            const path = [item.categoryName, item.subcategoryName].filter(Boolean).join(" › ");
            const meta = [
              item.internalNumber != null && item.internalNumber !== "" ? `#${item.internalNumber}` : "",
              item.brand || "",
              item.brandCode || "",
            ]
              .filter(Boolean)
              .join(" · ");
            const qtyDisp = item.qty != null && item.qty !== "" ? String(item.qty) : "—";
            const unitDisp = escapeHtml(item.unit || "pcs");
            const titleLine =
              item.variantLabel && String(item.variantLabel).trim()
                ? `${escapeHtml(item.itemName)} — ${escapeHtml(String(item.variantLabel).trim())}`
                : escapeHtml(item.itemName);
            return `<li style="margin-bottom:10px;">
              <div style="font-weight:600;color:#111827;">${titleLine}</div>
              ${meta ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">${escapeHtml(meta)}</div>` : ""}
              ${path ? `<div style="font-size:12px;color:#9ca3af;margin-top:2px;">${escapeHtml(path)}</div>` : ""}
              <div style="font-size:13px;margin-top:4px;">Qty: <strong>${escapeHtml(qtyDisp)}</strong> ${unitDisp}</div>
            </li>`;
          }
          const legacyQty = item.quantity != null ? item.quantity : item.qty;
          return `<li>${escapeHtml(item.name || "")} — ${escapeHtml(String(legacyQty ?? "—"))} ${escapeHtml(item.unit || "pcs")}</li>`;
        })
        .join("");
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          <div style="padding:10px 12px;border-radius:8px;background:#f9fafb;border:1px solid #e5e7eb;">
            <span style="color:#6b7280;font-size:12px;">Decision status</span>
            <div style="font-weight:600;font-size:15px;margin-top:4px;color:#111827;">${decision}</div>
          </div>
          <div>
            <span style="color:#6b7280;">Items:</span>
            <ul style="margin:8px 0;padding-left:20px;list-style:disc;">${itemsHTML}</ul>
          </div>
          <div>
            <span style="color:#6b7280;">Urgency:</span>
            <span style="font-weight:500;margin-left:8px;text-transform:capitalize;">${escapeHtml(data.urgency || "routine")}</span>
          </div>
          ${data.note ? `<div><span style="color:#6b7280;">Additional details:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${escapeHtml(data.note)}</div></div>` : ""}
        </div>
      `;
    }
      
    case 'maintenance':
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          <div>
            <span style="color:#6b7280;">Issue:</span>
            <div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;font-weight:500;">${data.issue || 'N/A'}</div>
          </div>
          <div>
            <span style="color:#6b7280;">Area:</span>
            <span style="font-weight:500;margin-left:8px;">${data.area || 'N/A'}</span>
          </div>
          <div>
            <span style="color:#6b7280;">Severity:</span>
            <span style="font-weight:500;margin-left:8px;text-transform:capitalize;">${data.severity || 'minor'}</span>
          </div>
          ${data.note ? `<div><span style="color:#6b7280;">Details:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${data.note}</div></div>` : ''}
        </div>
      `;
      
    case 'other':
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          <div>
            <span style="color:#6b7280;">Subject:</span>
            <div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;font-weight:500;">${data.subject || 'N/A'}</div>
          </div>
          <div>
            <span style="color:#6b7280;">Details:</span>
            <div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${data.details || 'N/A'}</div>
          </div>
        </div>
      `;

    case 'extra_shift':
    case 'swap_shift':
    case 'break_change':
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          ${data.date ? `<div><span style="color:#6b7280;">Date:</span><span style="font-weight:500;margin-left:8px;">${data.date}</span></div>` : ''}
          ${data.subject ? `<div><span style="color:#6b7280;">Subject:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${escapeHtml(data.subject)}</div></div>` : ''}
          <div>
            <span style="color:#6b7280;">Details:</span>
            <div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${escapeHtml(data.details || 'N/A')}</div>
          </div>
        </div>
      `;

    case 'commission_review':
    case 'tip_adjustment':
    case 'payment_issue':
    case 'client_issue':
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          ${data.subject ? `<div><span style="color:#6b7280;">Subject:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${escapeHtml(data.subject)}</div></div>` : ''}
          <div>
            <span style="color:#6b7280;">Details:</span>
            <div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${escapeHtml(data.details || 'N/A')}</div>
          </div>
        </div>
      `;

    case 'document_renewal_request':
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          <div><span style="color:#6b7280;">Document type:</span><span style="font-weight:500;margin-left:8px;">${escapeHtml(data.documentType || 'N/A')}</span></div>
          <div><span style="color:#6b7280;">Message:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${escapeHtml(data.message || 'N/A')}</div></div>
          ${data.dueDate ? `<div><span style="color:#6b7280;">Due date:</span><span style="font-weight:500;margin-left:8px;">${escapeHtml(data.dueDate)}</span></div>` : ''}
          ${data.relatedDocumentId ? `<div><span style="color:#6b7280;">Related document ID:</span><span style="font-weight:500;margin-left:8px;word-break:break-all;">${escapeHtml(String(data.relatedDocumentId))}</span></div>` : ''}
        </div>
      `;

    case 'document_request': {
      const respThumb = (() => {
        const u = data.responseFileUrl;
        if (!u) return "";
        const faux = { fileUrl: u, fileName: data.responseFileName, filePath: data.responseFilePath };
        if (!inboxUploadedFileLooksLikeImage(faux)) return "";
        const esc = escapeHtml(u);
        const jsEsc = JSON.stringify(u);
        return `
        <div style="margin-top:4px;">
          <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">Preview</div>
          <button type="button" onclick="window.ffInboxOverlayPreviewImage(${jsEsc})" style="padding:0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;background:#fff;cursor:zoom-in;max-width:min(240px,100%);display:block;">
            <img src="${esc}" alt="" style="display:block;width:100%;max-height:200px;object-fit:contain;background:#f9fafb;" loading="lazy" />
          </button>
        </div>`;
      })();
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          <div><span style="color:#6b7280;">Document type:</span><span style="font-weight:500;margin-left:8px;">${escapeHtml(data.documentType || 'N/A')}</span></div>
          <div><span style="color:#6b7280;">Reason / Notes:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${escapeHtml(data.reason || 'N/A')}</div></div>
          ${data.dueDate ? `<div><span style="color:#6b7280;">Due date:</span><span style="font-weight:500;margin-left:8px;">${data.dueDate}</span></div>` : ''}
          <div><span style="color:#6b7280;">Delivery:</span><span style="font-weight:500;margin-left:8px;">${escapeHtml(data.deliveryMethod || 'Email')}</span></div>
          ${data.contactEmail ? `<div><span style="color:#6b7280;">Contact email:</span><span style="font-weight:500;margin-left:8px;">${escapeHtml(data.contactEmail)}</span></div>` : ''}
          ${data.responseFileUrl ? `<div><span style="color:#6b7280;">Response file:</span> <a href="${escapeHtml(data.responseFileUrl)}" target="_blank" rel="noopener" style="color:#2563eb;">Download</a></div>${respThumb}` : ''}
        </div>
      `;
    }

    case 'document_upload': {
      const uploadThumb = (() => {
        const u = data.fileUrl;
        if (!u || !inboxUploadedFileLooksLikeImage(data)) return "";
        const esc = escapeHtml(u);
        const jsEsc = JSON.stringify(u);
        return `
        <div style="margin-top:4px;">
          <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">Preview</div>
          <button type="button" onclick="window.ffInboxOverlayPreviewImage(${jsEsc})" style="padding:0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;background:#fff;cursor:zoom-in;max-width:min(240px,100%);display:block;">
            <img src="${esc}" alt="" style="display:block;width:100%;max-height:200px;object-fit:contain;background:#f9fafb;" loading="lazy" />
          </button>
        </div>`;
      })();
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          <div><span style="color:#6b7280;">Document type:</span><span style="font-weight:500;margin-left:8px;">${escapeHtml(data.documentType || 'N/A')}</span></div>
          ${data.expirationDate ? `<div><span style="color:#6b7280;">Expiration date:</span><span style="font-weight:500;margin-left:8px;">${data.expirationDate}</span></div>` : ''}
          ${data.notes ? `<div><span style="color:#6b7280;">Notes:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${escapeHtml(data.notes)}</div></div>` : ''}
          ${data.fileUrl ? `<div><span style="color:#6b7280;">Uploaded file:</span> <a href="${escapeHtml(data.fileUrl)}" target="_blank" rel="noopener" title="${escapeHtml(String(data.fileName || data.filePath || '').trim() || 'Open in new tab')}" style="color:#2563eb;">${escapeHtml(inboxDisplayUploadedFileLinkLabel(data))}</a></div>${uploadThumb}` : ''}
        </div>
      `;
    }

    case 'staff_birthday_reminder':
      return `
        <div style="font-size:13px;line-height:1.5;color:#374151;">
          ${data.details ? `<div style="padding:10px;background:#f9fafb;border-radius:8px;">${escapeHtml(data.details)}</div>` : '<div style="color:#9ca3af;">—</div>'}
        </div>
      `;

    case 'document_expiring_soon':
    case 'document_expired':
      return `<div style="font-size:13px;color:#374151;line-height:1.5;">${escapeHtml(ffDocAlertHumanSummary(request))}</div>`;
      
    default:
      if (data.details) {
        return `<div style="font-size:13px;"><span style="color:#6b7280;">Details:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${escapeHtml(data.details)}</div></div>`;
      }
      const typeInfo = getRequestTypeInfo(request.type);
      const fieldLabels = (typeInfo.fields || []).reduce((acc, f) => { acc[f.id] = f.label; return acc; }, {});
      const entries = Object.entries(data || {}).filter(([, v]) => v != null && v !== '');
      if (entries.length === 0) return '<div style="color:#9ca3af;">No details available</div>';
      return `<div style="display:grid;gap:12px;font-size:13px;">${entries.map(([k, v]) => `<div><span style="color:#6b7280;">${escapeHtml(fieldLabels[k] || k)}:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${escapeHtml(String(v))}</div></div>`).join('')}</div>`;
  }
}

// =====================
// Manager Actions (will be Cloud Functions in final version)
// =====================
window.submitStaffReply = async function(requestId) {
  const replyInput = document.getElementById('staffReplyInput');
  const reply = replyInput?.value?.trim();
  if (!reply) { showToast('Please enter a reply', 'error'); return; }

  closeRequestDetailsModal();
  currentRequests = currentRequests.filter(r => r.id !== requestId);
  renderInboxList();

  try {
    const salonId = currentUserProfile.salonId;
    await updateDoc(doc(db, `salons/${salonId}/inboxItems`, requestId), {
      staffReply: reply,
      status: 'open',
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      unreadForManagers: true
    });
    showToast('Reply submitted! Request is back to Open status.', 'success');
  } catch (error) {
    console.error('[Inbox] submitStaffReply error', error);
    showToast(`Error: ${error.message}`, 'error');
    loadInboxItems();
  }
};

window.needsMoreInfo = async function(requestId) {
  if (!inboxCanManageInbox()) {
    if (typeof showToast === "function") showToast("You do not have permission to update requests.", "error");
    return;
  }
  const question = await showPromptModal({
    title: 'Request More Info',
    message: 'What information do you need from the staff member?',
    placeholder: 'e.g. Please provide the exact dates...',
    confirmLabel: 'Send',
    cancelLabel: 'Cancel',
    required: true
  });
  if (!question) return;

  closeRequestDetailsModal();
  currentRequests = currentRequests.filter(r => r.id !== requestId);
  renderInboxList();

  try {
    const salonId = currentUserProfile.salonId;
    await updateDoc(doc(db, `salons/${salonId}/inboxItems`, requestId), {
      status: 'needs_info',
      needsInfoQuestion: question,
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      unreadForManagers: false
    });
    showToast('Request updated - waiting for staff response', 'success');
  } catch (error) {
    console.error('[Inbox] needsMoreInfo error', error);
    showToast(`Error: ${error.message}`, 'error');
    loadInboxItems();
  }
};

window.uploadDocumentResponse = async function(requestId) {
  if (!inboxCanManageInbox()) {
    if (typeof showToast === "function") showToast("You do not have permission to upload a response.", "error");
    return;
  }
  const request = currentRequests.find(r => r.id === requestId);
  if (!request || request.type !== 'document_request') return;
  const fileInput = document.getElementById('docResponseFile_' + requestId);
  if (!fileInput?.files?.length) {
    showToast('Please select a file', 'error');
    return;
  }
  const file = fileInput.files[0];
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    showToast('File must be under 10 MB', 'error');
    return;
  }
  try {
    const salonId = currentUserProfile.salonId;
    const yyyyMm = new Date().toISOString().slice(0, 7);
    const fileId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const safeName = (file.name || 'response').replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 80);
    const path = `salons/${salonId}/inboxDocuments/${requestId}/${yyyyMm}/${fileId}_${safeName}`;
    showToast('Uploading...', 'info');
    const fileRef = storageRef(storage, path);
    await uploadBytes(fileRef, file);
    const responseFileUrl = await getDownloadURL(fileRef);
    const currentData = request.data || {};
    await updateDoc(doc(db, `salons/${salonId}/inboxItems`, requestId), {
      data: { ...currentData, responseFileUrl, responseFilePath: path },
      status: 'done',
      decidedBy: currentUserProfile.uid,
      decidedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      unreadForManagers: false
    });
    closeRequestDetailsModal();
    showToast('Response file uploaded and request marked Done!', 'success');
    loadInboxItems();
  } catch (err) {
    console.error('[Inbox] uploadDocumentResponse error', err);
    showToast('Upload failed: ' + err.message, 'error');
  }
};

window.markBirthdayReminderDone = async function(requestId) {
  if (!inboxCanManageInbox()) {
    if (typeof showToast === "function") showToast("You do not have permission to archive this item.", "error");
    return;
  }
  closeRequestDetailsModal();
  currentRequests = currentRequests.filter(r => r.id !== requestId);
  renderInboxList();
  try {
    const salonId = currentUserProfile.salonId;
    await updateDoc(doc(db, `salons/${salonId}/inboxItems`, requestId), {
      status: 'archived',
      decidedBy: currentUserProfile.uid,
      decidedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      unreadForManagers: false
    });
    showToast('Moved to Archive', 'success');
  } catch (error) {
    console.error('[Inbox] markBirthdayReminderDone error', error);
    showToast(`Error: ${error.message}`, 'error');
    loadInboxItems();
  }
};

/** Opens Staff Members modal on the given staff id (Documents tab). Uses global openStaffMembersModal from index.html. */
window.openDocumentAlertStaffMember = function(staffId) {
  const id = String(staffId || '').trim();
  if (!id) return;
  if (typeof window.closeRequestDetailsModal === 'function') window.closeRequestDetailsModal();
  if (typeof window.openStaffMembersModal === 'function') {
    window.openStaffMembersModal({ jumpToStaffId: id, jumpToTab: 'documents' });
  }
};

/** Same chat reminder as Staff → Documents (expiring soon). Payload: { salonId, staffId, documentId }. */
window.ffDocAlertSendChatReminder = async function (payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const salonId = String(p.salonId || currentUserProfile?.salonId || '').trim();
  const staffId = String(p.staffId || '').trim();
  const docId = String(p.documentId || '').trim();
  if (!salonId || !staffId || !docId) {
    if (typeof showToast === 'function') showToast('Missing staff or document.', 'error');
    return;
  }
  try {
    await ffSendExpiryChatReminderForStaffDocContext({ salonId, staffId, docId });
  } catch (e) {
    console.warn('[Inbox] ffDocAlertSendChatReminder', e);
  }
};

/** Opens New Request → "Request a new document (from staff)" with staff / type / related doc prefilled (e.g. from expiry alert). */
window.ffOpenDocumentRenewalFromAlert = function (opts) {
  if (!inboxCanSendRequests()) {
    if (typeof showToast === 'function') showToast('You do not have permission to create requests.', 'error');
    return;
  }
  const o = opts && typeof opts === 'object' ? opts : {};
  window.__ffDocRenewalPrefill = {
    staffId: String(o.staffId || '').trim(),
    documentType: String(o.documentType || '').trim(),
    documentId: String(o.documentId || '').trim(),
  };
  if (typeof window.closeRequestDetailsModal === 'function') window.closeRequestDetailsModal();
  if (typeof window.closeCreateRequestModal === 'function') window.closeCreateRequestModal();
  if (typeof window.openCreateRequestModal === 'function') window.openCreateRequestModal();
  if (typeof window.selectRequestType === 'function') window.selectRequestType('document_renewal_request');
};

/**
 * Manager: edit document type / expiration on inbox item before approving (document_upload / document_request).
 */
window.ffInboxOpenDocumentMetadataEdit = async function (requestId) {
  if (!inboxCanManageInbox()) {
    if (typeof showToast === "function") showToast("You do not have permission to edit this request.", "error");
    return;
  }
  const rid = String(requestId || "").trim();
  if (!rid || !currentUserProfile?.salonId) return;
  const salonId = currentUserProfile.salonId;
  const inboxRef = doc(db, `salons/${salonId}/inboxItems`, rid);
  let snap;
  try {
    snap = await getDoc(inboxRef);
  } catch (e) {
    console.warn("[Inbox] edit metadata get", e);
    showToast("Could not load request.", "error");
    return;
  }
  if (!snap.exists()) {
    showToast("Request not found.", "error");
    return;
  }
  const item = { id: rid, ...snap.data() };
  const t = String(item.type || "").trim();
  if (t !== "document_upload" && t !== "document_request") {
    showToast("Editing is only for document upload or request.", "info");
    return;
  }
  const d = item.data || {};
  const curType = String(d.documentType || "").trim();
  let curExp = "";
  if (t === "document_upload") {
    curExp =
      ffInboxYmdFromRaw(d.expirationDate) || ffInboxYmdFromRaw(d.expiryDate) || ffInboxYmdFromRaw(d.dueDate);
  } else {
    curExp = ffInboxYmdFromRaw(d.dueDate) || ffInboxYmdFromRaw(d.expirationDate);
  }

  const overlayRid = `ffinbox_editdoc_${Date.now()}`;
  const overlay = document.createElement("div");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000000;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;overflow-y:auto;";
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;max-width:420px;width:100%;box-shadow:0 25px 50px rgba(0,0,0,0.2);">
      <div style="font-size:18px;font-weight:700;margin-bottom:8px;color:#111827;">Edit document details</div>
      <p style="margin:0 0 16px;font-size:13px;color:#6b7280;">Updates what will be saved to the staff profile when you approve.</p>
      <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;">Document type</label>
      <select id="${overlayRid}_type" style="width:100%;padding:12px;margin-bottom:12px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;">${ffStaffDocumentTypeSelectOptionsHtml()}</select>
      <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;">Expiration / due date</label>
      <input type="date" id="${overlayRid}_exp" style="width:100%;padding:12px;margin-bottom:8px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;" />
      <p style="margin:0 0 16px;font-size:11px;color:#9ca3af;">Clear the date field if not applicable.</p>
      <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;">
        <button type="button" data-ff-cancel style="padding:10px 18px;border-radius:8px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-weight:600;cursor:pointer;font-size:14px;">Cancel</button>
        <button type="button" data-ff-save style="padding:10px 18px;border-radius:8px;border:none;background:#7c3aed;color:#fff;font-weight:600;cursor:pointer;font-size:14px;">Save</button>
      </div>
    </div>`;
  const sel = overlay.querySelector(`#${overlayRid}_type`);
  if (sel && curType) {
    try {
      sel.value = curType;
    } catch (_) {}
  }
  const expIn = overlay.querySelector(`#${overlayRid}_exp`);
  if (expIn) expIn.value = curExp;

  const remove = () => {
    try {
      overlay.remove();
    } catch (_) {}
  };
  const onKey = (ev) => {
    if (ev.key === "Escape") remove();
  };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) remove();
  });
  overlay.querySelector("[data-ff-cancel]").onclick = () => {
    document.removeEventListener("keydown", onKey);
    remove();
  };
  overlay.querySelector("[data-ff-save]").onclick = async () => {
    const ty = String(sel?.value || "").trim();
    const ex = String(expIn?.value || "").trim();
    if (!ty) {
      showToast("Select a document type.", "error");
      return;
    }
    const merged = { ...d };
    merged.documentType = ty;
    if (t === "document_upload") {
      if (ex) {
        merged.expirationDate = ex;
        merged.expiryDate = ex;
        merged.dueDate = ex;
      } else {
        merged.expirationDate = null;
        merged.expiryDate = null;
        merged.dueDate = null;
      }
    } else {
      if (ex) {
        merged.dueDate = ex;
        merged.expirationDate = ex;
      } else {
        merged.dueDate = null;
        merged.expirationDate = null;
      }
    }
    try {
      await updateDoc(inboxRef, {
        data: merged,
        updatedAt: serverTimestamp(),
      });
      const fresh = await getDoc(inboxRef);
      if (fresh.exists()) {
        const row = { id: rid, ...fresh.data() };
        const idx2 = currentRequests.findIndex((r) => r.id === rid);
        if (idx2 !== -1) currentRequests[idx2] = row;
      }
      showToast("Details saved.", "success");
      document.removeEventListener("keydown", onKey);
      remove();
      if (typeof closeRequestDetailsModal === "function") closeRequestDetailsModal();
      showRequestDetails(rid);
    } catch (err) {
      console.warn("[Inbox] save document metadata", err);
      showToast(String(err?.message || err || "Could not save."), "error");
    }
  };
  document.body.appendChild(overlay);
};

window.approveRequest = async function(requestId) {
  if (!inboxCanManageInbox()) {
    if (typeof showToast === "function") showToast("You do not have permission to approve requests.", "error");
    return;
  }
  const confirmed = await showConfirmModal({
    title: 'Approve request?',
    message: 'This will mark the request as approved.',
    confirmLabel: 'Approve',
    cancelLabel: 'Cancel',
    danger: false
  });
  if (!confirmed) return;

  // Optimistic: remove immediately from UI before Firestore confirms
  closeRequestDetailsModal();
  currentRequests = currentRequests.filter(r => r.id !== requestId);
  renderInboxList();

  try {
    const salonId = currentUserProfile.salonId;
    const inboxRef = doc(db, `salons/${salonId}/inboxItems`, requestId);
    const snap = await getDoc(inboxRef);
    if (!snap.exists()) {
      showToast('Request not found.', 'error');
      loadInboxItems();
      return;
    }
    const item = snap.data();
    if (String(item.status || "").trim() === "approved") {
      showToast("Already approved.", "info");
      loadInboxItems();
      return;
    }

    if (String(item.type || "").trim() === "supplies") {
      if (!inboxSupplyRequestIsPending({ type: "supplies", status: item.status })) {
        showToast("This supply request is no longer pending.", "info");
        loadInboxItems();
        return;
      }
      await approveSupplyRequest(requestId, item.data || {});
      showToast("Request approved!", "success");
      return;
    }

    let staffDocumentId = null;
    if (item.type === 'document_upload' || item.type === 'document_request') {
      staffDocumentId = await ffSyncStaffDocumentOnInboxApprove(db, {
        salonId,
        inboxItemId: requestId,
        inboxItem: { id: requestId, ...item },
        approverUid: currentUserProfile.uid,
      });
      if (!staffDocumentId) {
        console.warn('[Inbox] Approve sync returned no staff document id', requestId, item.type, item.data);
        showToast(
          'Could not attach this file to a staff profile (missing staff link). Open the request details and check Document belongs to / staff fields, or contact support.',
          'error'
        );
        loadInboxItems();
        return;
      }
    }

    const approvePayload = {
      status: 'approved',
      decidedBy: currentUserProfile.uid,
      decidedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      unreadForManagers: false,
    };
    if (staffDocumentId) approvePayload.staffDocumentId = staffDocumentId;

    await updateDoc(inboxRef, approvePayload);
    showToast('Request approved!', 'success');
  } catch (error) {
    console.error('[Inbox] approve error', error);
    showToast(`Error: ${error.message}`, 'error');
    loadInboxItems(); // restore on failure
  }
};

window.denyRequest = async function(requestId) {
  if (!inboxCanManageInbox()) {
    if (typeof showToast === "function") showToast("You do not have permission to deny requests.", "error");
    return;
  }
  const confirmed = await showConfirmModal({
    title: 'Deny request?',
    message: 'This will mark the request as denied. You can add a note below.',
    confirmLabel: 'Deny',
    cancelLabel: 'Cancel',
    danger: true
  });
  if (!confirmed) return;

  const reason = await showPromptModal({
    title: 'Add a note (optional)',
    message: 'Why is this request denied?',
    placeholder: 'Optional reason...',
    confirmLabel: 'Deny',
    cancelLabel: 'Back',
    required: false
  });
  if (reason === null) return;

  // Optimistic: remove immediately from UI before Firestore confirms
  closeRequestDetailsModal();
  currentRequests = currentRequests.filter(r => r.id !== requestId);
  renderInboxList();

  try {
    const salonId = currentUserProfile.salonId;
    const inboxRef = doc(db, `salons/${salonId}/inboxItems`, requestId);
    const snap = await getDoc(inboxRef);
    if (!snap.exists()) {
      showToast('Request not found.', 'error');
      loadInboxItems();
      return;
    }
    const item = snap.data();
    if (String(item.type || "").trim() === "supplies") {
      if (String(item.status || "").trim() === "denied") {
        showToast("Already denied.", "info");
        loadInboxItems();
        return;
      }
      await denySupplyRequest(requestId, reason || null);
      showToast("Request denied", "success");
      return;
    }

    if (item.type === 'document_upload' || item.type === 'document_request') {
      await ffSyncStaffDocumentOnInboxReject(db, { salonId, inboxItem: item });
    }

    await updateDoc(inboxRef, {
      status: 'denied',
      decidedBy: currentUserProfile.uid,
      decidedAt: serverTimestamp(),
      responseNote: reason || null,
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      unreadForManagers: false
    });
    showToast('Request denied', 'success');
  } catch (error) {
    console.error('[Inbox] deny error', error);
    showToast(`Error: ${error.message}`, 'error');
    loadInboxItems(); // restore on failure
  }
};

window.applyApprovedSupplyRequestToInventory = applyApprovedSupplyRequestToInventory;
window.approveSupplyRequest = approveSupplyRequest;
window.denySupplyRequest = denySupplyRequest;

window.archiveRequest = async function(requestId) {
  if (!inboxCanManageInbox()) {
    if (typeof showToast === "function") showToast("You do not have permission to archive requests.", "error");
    return;
  }
  const confirmed = await showConfirmModal({
    title: 'Move to Archive?',
    message: 'This request will be moved to the archive. You can delete it later from there.',
    confirmLabel: 'Archive',
    cancelLabel: 'Cancel',
    danger: false
  });
  if (!confirmed) return;

  closeRequestDetailsModal();
  currentRequests = currentRequests.filter(r => r.id !== requestId);
  renderInboxList();

  try {
    const salonId = currentUserProfile.salonId;
    const ref = doc(db, `salons/${salonId}/inboxItems`, requestId);
    const prevSnap = await getDoc(ref);
    const previousStatus = String(prevSnap.data()?.status || "").trim() || null;
    await updateDoc(ref, {
      status: 'archived',
      previousStatus,
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    showToast('Request archived', 'success');
  } catch (error) {
    console.error('[Inbox] archive error', error);
    showToast(`Error: ${error.message}`, 'error');
    loadInboxItems();
  }
};

window.deleteArchivedRequest = async function(requestId) {
  if (!inboxCanManageInbox()) {
    if (typeof showToast === "function") showToast("You do not have permission to delete requests.", "error");
    return;
  }
  const confirmed = await showConfirmModal({
    title: 'Delete permanently?',
    message: 'This request will be deleted and cannot be recovered.',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    danger: true
  });
  if (!confirmed) return;
  
  try {
    const salonId = currentUserProfile.salonId;
    await deleteDoc(doc(db, `salons/${salonId}/inboxItems`, requestId));
    
    closeRequestDetailsModal();
    loadInboxItems();
    showToast('Request deleted', 'success');
  } catch (error) {
    console.error('[Inbox] delete error', error);
    showToast(`Error: ${error.message}`, 'error');
  }
};

// =====================
// Deep link: ?ffInboxUpload=1&docType=…&renewForDoc=… — open Inbox → New Request → Upload a Document
// =====================
function ffTryConsumeInboxUploadDeepLink() {
  if (window.__ffInboxUploadConsumed) return;
  const sp = new URLSearchParams(window.location.search);
  if (sp.get('ffInboxUpload') !== '1') return;
  window.__ffInboxUploadConsumed = true;
  const docType = String(sp.get('docType') || '').trim();
  const renewForDoc = String(sp.get('renewForDoc') || '').trim();
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('ffInboxUpload');
    url.searchParams.delete('docType');
    url.searchParams.delete('renewForDoc');
    const qs = url.searchParams.toString();
    window.history.replaceState({}, '', url.pathname + (qs ? '?' + qs : '') + (url.hash || ''));
  } catch (e) {
    console.warn('[Inbox] strip deep link params', e);
  }
  window.__ffDocUploadPrefill = {
    documentType: docType || null,
    renewForDocId: renewForDoc || null,
  };
  goToInbox(() => {
    setTimeout(() => {
      try {
        if (typeof window.openCreateRequestModal === 'function') window.openCreateRequestModal();
        setTimeout(() => {
          if (typeof window.selectRequestType === 'function') void window.selectRequestType('document_upload');
        }, 60);
      } catch (e) {
        console.warn('[Inbox] open upload from deep link', e);
      }
    }, 120);
  });
}
window.ffTryConsumeInboxUploadDeepLink = ffTryConsumeInboxUploadDeepLink;

// =====================
// Initialization
// =====================
export function initInbox() {
  console.log('[Inbox] Initializing');
  
  // Wire up inbox button
  const inboxBtn = document.getElementById('inboxBtn');
  if (inboxBtn) {
    inboxBtn.onclick = goToInbox;
  }
  
  // Global listener: close inbox when clicking a main-nav button (not when clicking inside inbox)
  // When a nav button is clicked, we MUST explicitly call the nav function — otherwise the event
  // may not reach the button (e.g. when modals/overlays block it), so switching tabs fails.
  document.addEventListener('click', (e) => {
    const inboxScreen = document.getElementById('inboxScreen');
    if (inboxScreen && inboxScreen.contains(e.target)) return; // don't close when clicking inside inbox
    const navBtn = e.target.closest('.btn-pill');
    if (navBtn && navBtn.id !== 'inboxBtn' && navBtn !== inboxBtn) {
      if (inboxScreen && inboxScreen.style.display === 'flex') {
        console.log('[Inbox] Closing inbox - nav button clicked:', navBtn.id || navBtn.textContent);
        const inboxContent = document.getElementById('inboxContent');
        if (inboxContent) inboxContent.style.opacity = '0';
        inboxScreen.style.display = 'none';
        // Remove active class from inbox button
        const inboxBtnEl = document.getElementById('inboxBtn');
        if (inboxBtnEl) inboxBtnEl.classList.remove('active');
        // Explicitly navigate to the target screen — ensures switching works even when
        // modals/overlays block the normal click from reaching the nav button
        const bid = navBtn.id || '';
        if (bid === 'queueBtn' && typeof window.goToQueue === 'function') window.goToQueue();
        else if (bid === 'ticketsBtn' && typeof window.goToTickets === 'function') window.goToTickets();
        else if (bid === 'tasksBtn' && typeof window.openTasks === 'function') window.openTasks();
        else if (bid === 'chatBtn' && typeof window.goToChat === 'function') window.goToChat();
        else if (bid === 'logBtn' && (typeof window.openLog === 'function' || typeof openLog === 'function')) (window.openLog || openLog)();
        else if (bid === 'appsBtn') { /* Apps panel handled by its own click */ }
      }
    }
  }, true); // Capture phase to run before other handlers
  
  window.ffRefreshInboxNavVisibility = ffRefreshInboxNavVisibility;

  console.log('[Inbox] Initialized');
}

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initInbox);
} else {
  initInbox();
}

// =====================
// Background badge listener — runs regardless of which screen is visible
// =====================
let _bgBadgeUnsubscribe = null;

function startBgBadgeListener(uid, salonId, roleLc) {
  if (_bgBadgeUnsubscribe) { _bgBadgeUnsubscribe(); _bgBadgeUnsubscribe = null; }
  const q = query(
    collection(db, `salons/${salonId}/inboxItems`),
    where('forUid', '==', uid),
    where('unreadForManagers', '==', true)
  );
  const isTech = String(roleLc || '').toLowerCase() === 'technician';
  _bgBadgeUnsubscribe = onSnapshot(q, (snap) => {
    let docs = snap.docs;
    if (isTech) {
      const rows = docs.map((d) => ({ id: d.id, ...d.data() }));
      const keep = new Set(inboxTechnicianNoiseFilter(rows).map((r) => r.id));
      docs = docs.filter((d) => keep.has(d.id));
    }
    const openCount = docs.filter((d) => {
      const s = d.data().status;
      return s === "open" || s === "pending";
    }).length;
    const needsInfoCount = docs.filter((d) => d.data().status === 'needs_info').length;
    const total = openCount + needsInfoCount;

    const navBadge = document.querySelector('#inboxBtn .ff-inbox-badge');
    if (navBadge) navBadge.textContent = total > 0 ? total : '';

    const openBadge = document.getElementById('inboxOpenBadge');
    if (openBadge) openBadge.textContent = openCount > 0 ? openCount : '';

    const needsInfoBadge = document.getElementById('inboxNeedsInfoBadge');
    if (needsInfoBadge) needsInfoBadge.textContent = needsInfoCount > 0 ? needsInfoCount : '';
  }, () => {});
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (_bgBadgeUnsubscribe) { _bgBadgeUnsubscribe(); _bgBadgeUnsubscribe = null; }
    void ffRefreshInboxNavVisibility();
    return;
  }
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return;
    let profile = { uid: user.uid, ...userDoc.data() };
    profile = await mergeSalonStaffIntoUserProfile(profile);
    void ffRefreshInboxNavVisibility();
    const roleLc = String(profile.role || '').toLowerCase();
    const runBadge =
      profile.salonId &&
      (inboxCanManageInboxEval(profile) || roleLc === 'technician');
    if (runBadge) {
      startBgBadgeListener(user.uid, profile.salonId, roleLc);
    } else if (_bgBadgeUnsubscribe) {
      _bgBadgeUnsubscribe();
      _bgBadgeUnsubscribe = null;
    }
  } catch (e) {
    console.warn('[Inbox] bg badge listener error', e.message);
  }
});
