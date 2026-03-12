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
  Timestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { db, auth, storage } from "./app.js?v=20260312_fix2";

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
  { id: 'vacation', icon: '🏖️', label: 'Vacation Request', description: 'Request time off', category: 'schedule' },
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
  // Documents
  { id: 'document_request', icon: '📄', label: 'Request a Document', description: 'Request a document from management (1099, employment letter, contract, etc.)', category: 'documents' },
  { id: 'document_upload', icon: '📤', label: 'Upload a Document', description: 'Upload a document to the business (license, insurance, certification)', category: 'documents' },
  // Other (always last)
  { id: 'other', icon: '📝', label: 'Other', description: 'Other request', category: 'other' }
];

// =====================
// State
// =====================
let currentInboxTab = 'open';
let inboxViewMode = 'to_handle'; // 'mine' | 'to_handle' — only for admin/manager
let inboxUnsubscribe = null;
let currentUserProfile = null;
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
export function goToInbox() {
  console.log('[Inbox] Opening inbox');
  
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

  // Hide chat screen if open
  const chatScreen = document.getElementById('chatScreen');
  if (chatScreen) chatScreen.style.display = 'none';
  
  // Show inbox shell but hide content until ready (avoids flash of empty "My Requests")
  if (inboxScreen) inboxScreen.style.display = 'flex';
  if (inboxContent) inboxContent.style.opacity = '0';
  
  document.querySelectorAll('.btn-pill').forEach(btn => btn.classList.remove('active'));
  const inboxBtn = document.getElementById('inboxBtn');
  if (inboxBtn) inboxBtn.classList.add('active');
  
  loadCurrentUserProfile().then(() => {
    loadCustomTypes().then(() => {
      loadInboxSettings().then(() => {
        setupInboxUI();
        loadInboxItems();
        // Show content when UI is ready and loading has started
        if (inboxContent) inboxContent.style.opacity = '1';
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
  const withoutOther = BUILTIN_TYPES.filter(t => t.category !== 'other' && !hidden.has(t.id));
  const otherOnly = BUILTIN_TYPES.filter(t => t.category === 'other' && !hidden.has(t.id));
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
      console.log('[Inbox] User profile loaded', { role: currentUserProfile.role });
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

  const role = currentUserProfile.role || '';

  // "New Request" buttons — show for technician, manager, admin, owner
  const contentNewBtn  = document.querySelector('#inboxContentContainer button[onclick="openCreateRequestModal()"]');
  const emptyStateBtn  = document.getElementById('emptyStateNewRequestBtn');
  const emptyStateMsg  = document.getElementById('emptyStateMessage');
  const inboxTabs      = document.getElementById('inboxTabs');
  const listTitle      = document.getElementById('inboxListTitle');

  const canCreateRequests = ['technician', 'manager', 'admin', 'owner'].includes(role);
  const isAdminOrOwner = (role === 'admin' || role === 'owner');
  const manageTypesBtn = document.getElementById('btnManageRequestTypes');
  const settingsBtn = document.getElementById('inboxSettingsBtn');

  // New Request: show only in "My Requests" (or always for technician); hide in "To handle"
  const showNewRequest = canCreateRequests && (role === 'technician' || inboxViewMode === 'mine');
  if (contentNewBtn) contentNewBtn.style.display = showNewRequest ? '' : 'none';
  // Hide empty-state New Request — only the header button is used
  if (emptyStateBtn) emptyStateBtn.style.display = 'none';
  if (manageTypesBtn) manageTypesBtn.style.display = 'none'; // use gear only
  // Gear settings button — ONLY for admin/owner, after Archived tab
  if (settingsBtn) {
    settingsBtn.style.display = isAdminOrOwner ? 'flex' : 'none';
    settingsBtn.onclick = () => window.openInboxSettingsModal();
  }

  const filterRow = document.getElementById('inboxFilterRow');
  const staffFilterTrigger = document.getElementById('inboxStaffFilterTrigger');
  const staffFilterPanel = document.getElementById('inboxStaffFilterPanel');
  if (filterRow) filterRow.style.display = (role === 'technician') ? 'none' : 'flex';
  if (staffFilterTrigger && staffFilterPanel) {
    staffFilterTrigger.onclick = (e) => {
      e.stopPropagation();
      const open = staffFilterPanel.style.display === 'block';
      staffFilterPanel.style.display = open ? 'none' : 'block';
      staffFilterTrigger.setAttribute('aria-expanded', !open);
    };
    document.addEventListener('click', function closeStaffFilterPanel(e) {
      const wrap = document.getElementById('inboxStaffFilterWrap');
      if (staffFilterPanel.style.display === 'block' && wrap && !wrap.contains(e.target)) {
        staffFilterPanel.style.display = 'none';
        staffFilterTrigger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  if (role === 'technician') {
    // Technicians see their own requests only — hide status tabs and view switcher
    const viewSwitcher = document.getElementById('inboxViewSwitcher');
    if (viewSwitcher) viewSwitcher.style.display = 'none';
    if (inboxTabs) inboxTabs.classList.add('hidden');
    if (listTitle) listTitle.textContent = 'My Requests';
    currentInboxTab = 'my_requests';
  } else {
    // Manager / Admin / Owner — show view switcher (My Requests | To handle)
    const viewSwitcher = document.getElementById('inboxViewSwitcher');
    if (viewSwitcher) viewSwitcher.style.display = 'flex';
    document.querySelectorAll('.inbox-view-btn').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.inboxView || '') === inboxViewMode);
    });
    // Handlers are in HTML onclick; setInboxViewMode() does the work
    if (filterRow) filterRow.style.display = inboxViewMode === 'mine' ? 'none' : 'flex';
    if (listTitle) listTitle.textContent = inboxViewMode === 'mine' ? 'My Requests' : 'To handle';
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
  }
}

// =====================
// View Mode (My Requests | To handle) — called from HTML onclick
// =====================
window.setInboxViewMode = function(mode) {
  if (!currentUserProfile || ['technician'].includes(currentUserProfile.role || '')) return;
  inboxViewMode = mode;
  document.querySelectorAll('.inbox-view-btn').forEach(b => {
    b.classList.toggle('active', (b.dataset.inboxView || '') === mode);
  });
  const listTitle = document.getElementById('inboxListTitle');
  const filterRow = document.getElementById('inboxFilterRow');
  const inboxTabs = document.getElementById('inboxTabs');
  const emptyStateBtn = document.getElementById('emptyStateNewRequestBtn');
  const contentNewBtn = document.querySelector('#inboxContentContainer button[onclick="openCreateRequestModal()"]');
  if (listTitle) listTitle.textContent = mode === 'mine' ? 'My Requests' : 'To handle';
  if (filterRow) filterRow.style.display = mode === 'mine' ? 'none' : 'flex';
  if (mode === 'mine') {
    if (inboxTabs) { inboxTabs.classList.add('hidden'); inboxTabs.style.display = 'none'; }
  } else {
    if (inboxTabs) { inboxTabs.classList.remove('hidden'); inboxTabs.style.display = ''; }
  }
  if (emptyStateBtn) emptyStateBtn.style.display = 'none';
  if (contentNewBtn) contentNewBtn.style.display = (mode === 'mine') ? '' : 'none';
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
  
  // Reload items
  loadInboxItems();
};

// =====================
// Load & Render Requests
// =====================
async function loadInboxItems() {
  if (!currentUserProfile) return;
  
  const salonId = currentUserProfile.salonId;
  const role = currentUserProfile.role || '';
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
      // Technicians see requests they created (sent to a manager)
      q = query(
        collection(db, `salons/${salonId}/inboxItems`),
        where('createdByUid', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(50)
      );
    } else if (inboxViewMode === 'mine') {
      // Admin/Manager "My Requests": ordered by createdAt (stable — doesn't reorder when status changes)
      q = query(
        collection(db, `salons/${salonId}/inboxItems`),
        where('createdByUid', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(50)
      );
    } else {
      // Admin/Manager "To handle": only requests sent TO me (forUid)
      if (currentInboxTab === 'open') {
        q = query(
          collection(db, `salons/${salonId}/inboxItems`),
          where('forUid', '==', uid),
          where('status', '==', 'open'),
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
          where('status', '==', 'open'),
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
  const role = (currentUserProfile && currentUserProfile.role) || '';
  const isManager = ['manager', 'admin', 'owner'].includes(role);
  if (!isManager) return;

  const uid = currentUserProfile.uid;

  // Open: new requests not yet seen by recipient
  const openCount = currentRequests.filter(
    r => r.forUid === uid && r.status === 'open' && r.unreadForManagers === true
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
  const trigger = document.getElementById('inboxStaffFilterTrigger');
  const labelEl = document.getElementById('inboxStaffFilterLabel');
  const panel = document.getElementById('inboxStaffFilterPanel');
  if (!trigger || !labelEl || !panel) return;
  const role = (currentUserProfile && currentUserProfile.role) || '';
  if (role === 'technician') return;

  const seen = new Map();
  currentRequests.forEach(req => {
    const uid = req.forUid || req.createdByUid || '';
    const name = (req.forStaffName || req.createdByName || '').trim() || uid || 'Unknown';
    if (uid && !seen.has(uid)) seen.set(uid, name);
  });
  const options = [['', 'All staff']];
  seen.forEach((name, uid) => options.push([uid, name]));
  const current = inboxStaffFilterUid;
  if (!options.some(([v]) => v === current)) inboxStaffFilterUid = '';

  const currentLabel = options.find(([v]) => v === inboxStaffFilterUid)?.[1] || 'All staff';
  labelEl.textContent = currentLabel;

  panel.innerHTML = options.map(([val, lab]) => {
    const isSelected = val === inboxStaffFilterUid;
    const style = 'padding:10px 14px;cursor:pointer;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6;' + (isSelected ? 'background:#f9fafb;font-weight:500;' : '');
    return `<div role="option" data-value="${escapeHtml(val)}" aria-selected="${isSelected}" style="${style}">${isSelected ? '✓ ' : ''}${escapeHtml(lab)}</div>`;
  }).join('');

  panel.querySelectorAll('[role="option"]').forEach(opt => {
    opt.onclick = (e) => {
      e.stopPropagation();
      inboxStaffFilterUid = opt.dataset.value || '';
      labelEl.textContent = opt.textContent.replace(/^✓\s*/, '').trim();
      panel.style.display = 'none';
      trigger.setAttribute('aria-expanded', 'false');
      renderInboxList();
    };
  });
}

function renderInboxList() {
  const listEl = document.getElementById('inboxList');
  if (!listEl) return;

  // Title by role and view: technician = "My Requests"; manager "mine" = "My Requests", "to_handle" = "To handle"
  const listTitle = document.getElementById('inboxListTitle');
  const role = (currentUserProfile && currentUserProfile.role) || '';
  if (listTitle) {
    if (role === 'technician') listTitle.textContent = 'My Requests';
    else listTitle.textContent = inboxViewMode === 'mine' ? 'My Requests' : 'To handle';
  }

  // Remove only dynamically-added group elements (preserve loading/empty state divs)
  listEl.querySelectorAll('.inbox-group-header, .inbox-group-body').forEach(el => el.remove());

  const emptyEl = document.getElementById('inboxEmpty');
  const loadingEl = document.getElementById('inboxLoading');

  let requestsToShow = currentRequests;

  // Client-side status filter to prevent flicker when Firestore sends intermediate snapshots
  if (inboxViewMode === 'to_handle' || role === 'technician') {
    if (currentInboxTab === 'open') {
      requestsToShow = requestsToShow.filter(r => r.status === 'open');
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
    if (emptyEl) {
      emptyEl.style.display = 'block';
      emptyEl.querySelector('#emptyStateMessage').textContent = inboxStaffFilterUid ? 'No requests from this staff in this tab' : 'No requests in this category';
    }
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  if (loadingEl) loadingEl.style.display = 'none';

  const isManager = currentUserProfile && ['manager','admin','owner'].includes(currentUserProfile.role);

  // Group requests by type (use filtered list)
  const groups = {};
  requestsToShow.forEach(req => {
    const key = req.type || 'other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(req);
  });

  // Order: by category (schedule → payments → operations), then custom type ids, then other last
  const typeOrder = [
    'vacation','late_start','early_leave','schedule_change','extra_shift','swap_shift','break_change',
    'commission_review','tip_adjustment','payment_issue',
    'supplies','maintenance','client_issue',
    'document_request','document_upload',
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
    const unreadCount = isManager ? requests.filter(r => r.unreadForManagers === true).length : 0;
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
    body.style.cssText = 'display:none; margin-bottom:8px; display:flex; flex-direction:column; gap:8px;';
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
  
  // Type icon & label
  const typeInfo = getRequestTypeInfo(request.type);
  
  // Status badge
  const statusClass = `inbox-status-${request.status.replace('_', '-')}`;
  
  // Format date
  const createdDate = request.createdAt?.toDate ? request.createdAt.toDate() : new Date();
  const dateStr = formatRelativeDate(createdDate);
  
  card.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:12px;">
      <div style="font-size:24px;">${typeInfo.icon}</div>
      <div style="flex:1;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="font-weight:600;font-size:14px;color:#111;">${typeInfo.label}</span>
          <span class="inbox-status-badge ${statusClass}">${request.status.replace('_', ' ')}</span>
          ${request.priority === 'urgent' ? '<span style="color:#ef4444;font-size:12px;">🔥 Urgent</span>' : ''}
        </div>
        <div style="font-size:13px;color:#6b7280;margin-bottom:8px;">
          ${request.forStaffName} • ${dateStr}
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
  return found || { icon: '📝', label: type || 'Request', description: '', fields: [] };
}

function escapeHtml(s) {
  if (!s) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
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
    case 'schedule_change':
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
    case 'supplies':
      const itemCount = data.items?.length || 0;
      return `${itemCount} item${itemCount !== 1 ? 's' : ''} - ${data.urgency || 'routine'}`;
    case 'maintenance':
      return `${data.area || 'Unknown area'} - ${data.severity || 'minor'} issue`;
    case 'document_request':
      return `${data.documentType || 'Document'} – ${(data.reason || '').substring(0, 40)}`;
    case 'document_upload':
      return `${data.documentType || 'Document'}${data.expirationDate ? ` · Expires ${data.expirationDate}` : ''}`;
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
        ${t.description ? `<div style="font-size:12px;color:#6b7280;">${t.description}</div>` : ''}
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
  if (!currentUserProfile?.salonId || !['admin', 'owner'].includes(currentUserProfile.role)) return;
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

window.selectRequestType = async function(type) {
  console.log('[Inbox] Selected type:', type);
  
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
};

function createRequestForm(type) {
  const form = document.createElement('div');
  const typeInfo = getRequestTypeInfo(type);
  const recipientsList = getInboxRecipientsList();
  const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const instructionsHtml = (typeInfo.description && typeInfo.description.trim())
    ? `<p style="margin:8px 0 0;font-size:13px;color:#6b7280;text-align:center;max-width:400px;margin-left:auto;margin-right:auto;">${esc(typeInfo.description.trim())}</p>`
    : '';
  const sendToRowHtml = recipientsList.length === 0
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
  
  if (recipientsList.length > 0) {
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
  } else if (type === 'document_request') {
    fieldsContainer.innerHTML = `
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Document type</label>
        <select id="doc_req_type" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
          <option value="">Select...</option>
          <option value="1099">1099</option>
          <option value="W-2">W-2</option>
          <option value="Employment Letter">Employment Letter</option>
          <option value="Contract">Contract</option>
          <option value="Insurance">Insurance</option>
          <option value="Other">Other</option>
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
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Document type</label>
        <select id="doc_up_type" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;">
          <option value="">Select...</option>
          <option value="License">License</option>
          <option value="Insurance">Insurance</option>
          <option value="Certification">Certification</option>
          <option value="Other">Other</option>
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
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Items Needed</label>
        <div id="suppliesItemsList" style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px;">
          <div class="supplies-item-row" style="display:flex;gap:8px;">
            <input type="text" placeholder="Item name" class="supplies-item-name" style="flex:2;padding:8px;border:1px solid #d1d5db;border-radius:6px;">
            <input type="number" placeholder="Qty" class="supplies-item-quantity" min="1" style="flex:1;padding:8px;border:1px solid #d1d5db;border-radius:6px;">
            <input type="text" placeholder="Unit" class="supplies-item-unit" value="pcs" style="flex:1;padding:8px;border:1px solid #d1d5db;border-radius:6px;">
          </div>
        </div>
        <button onclick="addSuppliesItem()" type="button" style="padding:6px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:12px;">+ Add Item</button>
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
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:#374151;">Note (optional)</label>
        <textarea id="supplies_note" rows="2" placeholder="Additional details" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;"></textarea>
      </div>
    `;
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
  const list = document.getElementById('suppliesItemsList');
  if (!list) return;
  
  const row = document.createElement('div');
  row.className = 'supplies-item-row';
  row.style.cssText = 'display:flex;gap:8px;';
  row.innerHTML = `
    <input type="text" placeholder="Item name" class="supplies-item-name" style="flex:2;padding:8px;border:1px solid #d1d5db;border-radius:6px;">
    <input type="number" placeholder="Qty" class="supplies-item-quantity" min="1" style="flex:1;padding:8px;border:1px solid #d1d5db;border-radius:6px;">
    <input type="text" placeholder="Unit" class="supplies-item-unit" value="pcs" style="flex:1;padding:8px;border:1px solid #d1d5db;border-radius:6px;">
    <button onclick="this.parentElement.remove()" type="button" style="padding:8px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;cursor:pointer;">🗑️</button>
  `;
  list.appendChild(row);
};

async function submitRequest(type) {
  console.log('[Inbox] Submitting request:', type);
  
  if (!currentUserProfile) {
    showToast('User profile not loaded', 'error');
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
      
      data = { startDate, endDate, daysCount, note };
      
    } else if (type === 'late_start') {
      const date = document.getElementById('latestart_date')?.value;
      const time = document.getElementById('latestart_time')?.value;
      const reason = document.getElementById('latestart_reason')?.value;
      
      if (!date || !time || !reason) {
        showToast('Please fill in all required fields', 'error');
        return;
      }
      
      data = { date, requestedTime: time, reason, normalTime: null };
      
    } else if (type === 'early_leave') {
      const date = document.getElementById('earlyleave_date')?.value;
      const time = document.getElementById('earlyleave_time')?.value;
      const reason = document.getElementById('earlyleave_reason')?.value;
      
      if (!date || !time || !reason) {
        showToast('Please fill in all required fields', 'error');
        return;
      }
      
      data = { date, requestedTime: time, reason, normalTime: null };
      
    } else if (type === 'schedule_change') {
      const current = document.getElementById('schedchange_current')?.value || '';
      const requested = document.getElementById('schedchange_requested')?.value;
      const reason = document.getElementById('schedchange_reason')?.value;
      const isTemporary = document.getElementById('schedchange_temporary')?.checked || false;
      
      if (!requested || !reason) {
        showToast('Please fill in all required fields', 'error');
        return;
      }
      
      data = { 
        currentSchedule: current, 
        requestedSchedule: requested, 
        reason, 
        isTemporary,
        affectedDates: []
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
      const fileInput = document.getElementById('doc_up_file');
      const notes = document.getElementById('doc_up_notes')?.value?.trim() || null;
      if (!documentType || !fileInput?.files?.length) { showToast('Please select document type and choose a file', 'error'); return; }
      const file = fileInput.files[0];
      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) { showToast('File must be under 10 MB', 'error'); return; }
      const salonId = currentUserProfile.salonId;
      const staffId = auth.currentUser?.uid || currentUserProfile.uid;
      const yyyyMm = new Date().toISOString().slice(0, 7);
      const fileId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const safeName = (file.name || 'file').replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 80);
      const ext = (file.name && file.name.includes('.')) ? file.name.split('.').pop().toLowerCase() : 'pdf';
      const path = `salons/${salonId}/staff/${staffId}/documents/${documentType}/${yyyyMm}/${fileId}_${safeName}`;
      showToast('Uploading file...', 'info');
      const fileRef = storageRef(storage, path);
      await uploadBytes(fileRef, file);
      const fileUrl = await getDownloadURL(fileRef);
      data = { documentType, expirationDate, filePath: path, fileUrl, fileName: file.name, notes };
      
    } else if (type === 'supplies') {
      const rows = document.querySelectorAll('.supplies-item-row');
      const items = [];
      
      rows.forEach(row => {
        const name = row.querySelector('.supplies-item-name')?.value?.trim();
        const quantity = parseInt(row.querySelector('.supplies-item-quantity')?.value) || 0;
        const unit = row.querySelector('.supplies-item-unit')?.value?.trim() || 'pcs';
        
        if (name && quantity > 0) {
          items.push({ name, quantity, unit });
        }
      });
      
      if (items.length === 0) {
        showToast('Please add at least one item', 'error');
        return;
      }
      
      const urgency = document.getElementById('supplies_urgency')?.value || 'routine';
      const note = document.getElementById('supplies_note')?.value || null;
      
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
    
    const { uids: sentToUids, staffIds: sentToStaffIds, names: sentToNames } = getCreateRequestSelectedRecipients();
    const hasAnySelected = (sentToUids && sentToUids.length > 0) || (sentToNames && sentToNames.length > 0);
    const hasValidUid = sentToUids && sentToUids.some(u => u && u.trim());
    if (getInboxRecipientsList().length > 0 && !hasAnySelected) {
      showToast('Please choose who receives this request', 'error');
      return;
    }
    if (hasAnySelected && !hasValidUid) {
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

    const baseDoc = {
      tenantId: salonId,
      locationId: null,
      type: type,
      status: 'open',
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
      unreadForManagers: true
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
// Toast Notifications
// =====================
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 80px;
    right: 20px;
    background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
    color: #fff;
    padding: 16px 24px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 999999;
    font-size: 14px;
    font-weight: 500;
    max-width: 400px;
    animation: slideIn 0.3s ease-out;
  `;
  
  const icon = type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ';
  toast.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;">
      <span style="font-size:18px;">${icon}</span>
      <span>${message}</span>
    </div>
  `;
  
  document.body.appendChild(toast);
  
  // Auto-remove after 3 seconds
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-in';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Add animation styles if not exists
if (!document.getElementById('toastAnimations')) {
  const style = document.createElement('style');
  style.id = 'toastAnimations';
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(400px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(400px); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

// =====================
// Request Details Modal
// =====================
function showRequestDetails(requestId) {
  const request = currentRequests.find(r => r.id === requestId);
  if (!request) return;
  
  console.log('[Inbox] Showing request details', requestId);

  // Mark as read only if the current user IS the recipient (forUid), not the sender
  const isManagerRole = currentUserProfile && ['manager', 'admin', 'owner'].includes(currentUserProfile.role);
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
  const statusClass = `inbox-status-${request.status.replace('_', '-')}`;
  const createdDate = request.createdAt?.toDate ? request.createdAt.toDate() : new Date();
  
  // Role checks
  const isManager = currentUserProfile && ['manager', 'admin', 'owner'].includes(currentUserProfile.role);
  const isTechnician = currentUserProfile && currentUserProfile.role === 'technician';
  const isMyRequest = currentUserProfile && request.forUid === currentUserProfile.uid;
  
  let detailsHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <span style="font-size:28px;">${typeInfo.icon}</span>
        <div>
          <h2 style="margin:0;font-size:18px;font-weight:600;">${typeInfo.label}</h2>
          <span class="inbox-status-badge ${statusClass}">${request.status.replace('_', ' ')}</span>
        </div>
      </div>
      <button onclick="closeRequestDetailsModal()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#9ca3af;">&times;</button>
    </div>
    
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
    </div>
    
    <div style="margin-bottom:20px;">
      <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;color:#374151;">Request Details</h3>
      ${renderRequestData(request)}
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
  
  // Manager actions — only for the RECIPIENT (who the request was sent TO), not the creator
  const isRecipient = currentUserProfile && request.forUid === currentUserProfile.uid;
  if (isManager && isRecipient && request.status === 'open') {
    const isDocRequest = request.type === 'document_request';
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
          
          <button onclick="approveRequest('${requestId}')" style="padding:10px;border:1px solid #10b981;background:#10b981;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">
            ✓ Approve
          </button>
          
          <button onclick="denyRequest('${requestId}')" style="padding:10px;border:1px solid #ef4444;background:#ef4444;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">
            ✗ Deny
          </button>
        </div>
      </div>
    `;
  }
  
  // Manager actions for needs_info status — only for recipient
  if (isManager && isRecipient && request.status === 'needs_info') {
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;color:#374151;">Manager Actions</h3>
        <div style="font-size:13px;color:#6b7280;margin-bottom:12px;">
          Waiting for staff response...
        </div>
        <button onclick="approveRequest('${requestId}')" style="padding:10px;border:1px solid #10b981;background:#10b981;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;width:100%;margin-bottom:8px;">
          ✓ Approve Anyway
        </button>
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
      
    case 'schedule_change':
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
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
      
    case 'supplies':
      const itemsHTML = (data.items || []).map(item => 
        `<li>${item.name} - ${item.quantity} ${item.unit || 'pcs'}</li>`
      ).join('');
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          <div>
            <span style="color:#6b7280;">Items:</span>
            <ul style="margin:8px 0;padding-left:20px;">${itemsHTML}</ul>
          </div>
          <div>
            <span style="color:#6b7280;">Urgency:</span>
            <span style="font-weight:500;margin-left:8px;text-transform:capitalize;">${data.urgency || 'routine'}</span>
          </div>
          ${data.note ? `<div><span style="color:#6b7280;">Note:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${data.note}</div></div>` : ''}
        </div>
      `;
      
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

    case 'document_request':
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          <div><span style="color:#6b7280;">Document type:</span><span style="font-weight:500;margin-left:8px;">${escapeHtml(data.documentType || 'N/A')}</span></div>
          <div><span style="color:#6b7280;">Reason / Notes:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${escapeHtml(data.reason || 'N/A')}</div></div>
          ${data.dueDate ? `<div><span style="color:#6b7280;">Due date:</span><span style="font-weight:500;margin-left:8px;">${data.dueDate}</span></div>` : ''}
          <div><span style="color:#6b7280;">Delivery:</span><span style="font-weight:500;margin-left:8px;">${escapeHtml(data.deliveryMethod || 'Email')}</span></div>
          ${data.contactEmail ? `<div><span style="color:#6b7280;">Contact email:</span><span style="font-weight:500;margin-left:8px;">${escapeHtml(data.contactEmail)}</span></div>` : ''}
          ${data.responseFileUrl ? `<div><span style="color:#6b7280;">Response file:</span> <a href="${escapeHtml(data.responseFileUrl)}" target="_blank" rel="noopener" style="color:#2563eb;">Download</a></div>` : ''}
        </div>
      `;

    case 'document_upload':
      return `
        <div style="display:grid;gap:12px;font-size:13px;">
          <div><span style="color:#6b7280;">Document type:</span><span style="font-weight:500;margin-left:8px;">${escapeHtml(data.documentType || 'N/A')}</span></div>
          ${data.expirationDate ? `<div><span style="color:#6b7280;">Expiration date:</span><span style="font-weight:500;margin-left:8px;">${data.expirationDate}</span></div>` : ''}
          ${data.notes ? `<div><span style="color:#6b7280;">Notes:</span><div style="margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px;">${escapeHtml(data.notes)}</div></div>` : ''}
          ${data.fileUrl ? `<div><span style="color:#6b7280;">Uploaded file:</span> <a href="${escapeHtml(data.fileUrl)}" target="_blank" rel="noopener" style="color:#2563eb;">${escapeHtml(data.fileName || 'Download')}</a></div>` : ''}
        </div>
      `;
      
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

window.approveRequest = async function(requestId) {
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
    await updateDoc(doc(db, `salons/${salonId}/inboxItems`, requestId), {
      status: 'approved',
      decidedBy: currentUserProfile.uid,
      decidedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      unreadForManagers: false
    });
    showToast('Request approved!', 'success');
  } catch (error) {
    console.error('[Inbox] approve error', error);
    showToast(`Error: ${error.message}`, 'error');
    loadInboxItems(); // restore on failure
  }
};

window.denyRequest = async function(requestId) {
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
    await updateDoc(doc(db, `salons/${salonId}/inboxItems`, requestId), {
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

window.archiveRequest = async function(requestId) {
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
    await updateDoc(doc(db, `salons/${salonId}/inboxItems`, requestId), {
      status: 'archived',
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    showToast('Request archived', 'success');
  } catch (error) {
    console.error('[Inbox] archive error', error);
    showToast(`Error: ${error.message}`, 'error');
    loadInboxItems();
  }
};

window.deleteArchivedRequest = async function(requestId) {
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
        const inboxBtn = document.getElementById('inboxBtn');
        if (inboxBtn) {
          inboxBtn.classList.remove('active');
        }
      }
    }
  }, true); // Capture phase to run before other handlers
  
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

function startBgBadgeListener(uid, salonId) {
  if (_bgBadgeUnsubscribe) { _bgBadgeUnsubscribe(); _bgBadgeUnsubscribe = null; }
  const q = query(
    collection(db, `salons/${salonId}/inboxItems`),
    where('forUid', '==', uid),
    where('unreadForManagers', '==', true)
  );
  _bgBadgeUnsubscribe = onSnapshot(q, (snap) => {
    const openCount = snap.docs.filter(d => d.data().status === 'open').length;
    const needsInfoCount = snap.docs.filter(d => d.data().status === 'needs_info').length;
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
    return;
  }
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return;
    const data = userDoc.data() || {};
    const role = (data.role || '').toLowerCase();
    if (['manager', 'admin', 'owner'].includes(role) && data.salonId) {
      startBgBadgeListener(user.uid, data.salonId);
    }
  } catch (e) {
    console.warn('[Inbox] bg badge listener error', e.message);
  }
});
