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
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import { db, auth } from "./app.js";

// =====================
// State
// =====================
let currentInboxTab = 'open';
let inboxUnsubscribe = null;
let currentUserProfile = null;
let currentRequests = [];

// =====================
// Navigation
// =====================
export function goToInbox() {
  console.log('[Inbox] Opening inbox');
  
  // Hide other screens
  const tasksScreen = document.getElementById('tasksScreen');
  const ownerView = document.getElementById('owner-view');
  const joinBar = document.querySelector('.joinBar');
  const queueControls = document.getElementById('queueControls');
  const userProfileScreen = document.getElementById('userProfileScreen');
  
  if (tasksScreen) tasksScreen.style.display = 'none';
  if (ownerView) ownerView.style.display = 'none';
  if (joinBar) joinBar.style.display = 'none';
  if (queueControls) queueControls.style.display = 'none';
  if (userProfileScreen) userProfileScreen.style.display = 'none';
  
  // Show inbox
  const inboxScreen = document.getElementById('inboxScreen');
  if (inboxScreen) {
    inboxScreen.style.display = 'flex';
  }
  
  // Update active button (CSS only - no inline styles)
  document.querySelectorAll('.btn-pill').forEach(btn => btn.classList.remove('active'));
  const inboxBtn = document.getElementById('inboxBtn');
  if (inboxBtn) inboxBtn.classList.add('active');
  
  // Load current user profile and requests
  loadCurrentUserProfile().then(() => {
    setupInboxUI();
    loadInboxItems();
  });
}

async function loadCurrentUserProfile() {
  const user = auth.currentUser;
  if (!user) return null;
  
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (userDoc.exists()) {
      currentUserProfile = { uid: user.uid, ...userDoc.data() };
      console.log('[Inbox] User profile loaded', { role: currentUserProfile.role });
      return currentUserProfile;
    }
  } catch (err) {
    console.error('[Inbox] Failed to load user profile', err);
  }
  return null;
}

function setupInboxUI() {
  if (!currentUserProfile) return;
  
  const inboxTabs = document.getElementById('inboxTabs');
  const newRequestBtn = document.querySelector('#inboxContentContainer button[onclick="openCreateRequestModal()"]');
  const emptyStateBtn = document.getElementById('emptyStateNewRequestBtn');
  const emptyStateMsg = document.getElementById('emptyStateMessage');
  const role = currentUserProfile.role || '';
  
  // Technicians see "My Requests" instead of status tabs
  if (role === 'technician') {
    if (inboxTabs) {
      inboxTabs.innerHTML = `
        <div style="padding:12px 0;font-size:14px;font-weight:600;color:#374151;">My Requests</div>
      `;
    }
    currentInboxTab = 'my_requests';
    // Technician can create requests
    if (newRequestBtn) newRequestBtn.style.display = 'inline-block';
    if (emptyStateBtn) emptyStateBtn.style.display = 'inline-block';
  } else if (role === 'manager') {
    // Managers see status tabs and can create requests
    currentInboxTab = 'open';
    if (newRequestBtn) newRequestBtn.style.display = 'inline-block';
    if (emptyStateBtn) emptyStateBtn.style.display = 'inline-block';
  } else if (role === 'admin' || role === 'owner') {
    // Admins/Owners see status tabs but DON'T create requests (only approve/deny)
    currentInboxTab = 'open';
    if (newRequestBtn) newRequestBtn.style.display = 'none';
    if (emptyStateBtn) emptyStateBtn.style.display = 'none';
    if (emptyStateMsg) emptyStateMsg.textContent = 'No requests in this category';
  } else {
    // Default
    currentInboxTab = 'open';
  }
}

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
    const items = listEl.querySelectorAll('.inbox-item-card');
    items.forEach(item => item.remove());
  }
  
  try {
    // Build query based on role and tab
    let q;
    
    if (role === 'technician') {
      // Technicians see only their own requests
      q = query(
        collection(db, `salons/${salonId}/inboxItems`),
        where('forUid', '==', uid),
        orderBy('lastActivityAt', 'desc'),
        limit(50)
      );
    } else {
      // Managers/Admins see all, filtered by status
      if (currentInboxTab === 'open') {
        q = query(
          collection(db, `salons/${salonId}/inboxItems`),
          where('status', '==', 'open'),
          orderBy('lastActivityAt', 'desc'),
          limit(50)
        );
      } else if (currentInboxTab === 'needs_info') {
        q = query(
          collection(db, `salons/${salonId}/inboxItems`),
          where('status', '==', 'needs_info'),
          orderBy('lastActivityAt', 'desc'),
          limit(50)
        );
      } else if (currentInboxTab === 'approved') {
        q = query(
          collection(db, `salons/${salonId}/inboxItems`),
          where('status', '==', 'approved'),
          orderBy('lastActivityAt', 'desc'),
          limit(50)
        );
      } else if (currentInboxTab === 'denied') {
        q = query(
          collection(db, `salons/${salonId}/inboxItems`),
          where('status', '==', 'denied'),
          orderBy('lastActivityAt', 'desc'),
          limit(50)
        );
      } else if (currentInboxTab === 'archived') {
        q = query(
          collection(db, `salons/${salonId}/inboxItems`),
          where('status', '==', 'archived'),
          orderBy('lastActivityAt', 'desc'),
          limit(50)
        );
      } else {
        // Default: open
        q = query(
          collection(db, `salons/${salonId}/inboxItems`),
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
      
      if (currentRequests.length === 0) {
        if (emptyEl) emptyEl.style.display = 'block';
      } else {
        if (emptyEl) emptyEl.style.display = 'none';
        renderInboxList();
      }
    }, (error) => {
      console.error('[Inbox] Query error', error);
      if (loadingEl) loadingEl.style.display = 'none';
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

function renderInboxList() {
  const listEl = document.getElementById('inboxList');
  if (!listEl) return;
  
  // Remove existing cards
  const existing = listEl.querySelectorAll('.inbox-item-card');
  existing.forEach(el => el.remove());
  
  // Render each request
  currentRequests.forEach(request => {
    const card = createRequestCard(request);
    listEl.appendChild(card);
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
  const types = {
    vacation: { icon: '🏖️', label: 'Vacation Request' },
    late_start: { icon: '⏰', label: 'Late Start' },
    early_leave: { icon: '🏃', label: 'Early Leave' },
    schedule_change: { icon: '📅', label: 'Schedule Change' },
    supplies: { icon: '📦', label: 'Supplies Request' },
    maintenance: { icon: '🔧', label: 'Maintenance' },
    other: { icon: '📝', label: 'Other Request' }
  };
  return types[type] || { icon: '📝', label: 'Request' };
}

function getRequestSummary(request) {
  const data = request.data || {};
  
  switch (request.type) {
    case 'vacation':
      return `${data.startDate || ''} to ${data.endDate || ''} (${data.daysCount || 0} days)`;
    case 'late_start':
      return `${data.date || ''} - Start at ${data.requestedTime || ''}`;
    case 'early_leave':
      return `${data.date || ''} - Leave at ${data.requestedTime || ''}`;
    case 'schedule_change':
      return data.reason || 'Schedule change request';
    case 'supplies':
      const itemCount = data.items?.length || 0;
      return `${itemCount} item${itemCount !== 1 ? 's' : ''} - ${data.urgency || 'routine'}`;
    case 'maintenance':
      return `${data.area || 'Unknown area'} - ${data.severity || 'minor'} issue`;
    case 'other':
      return data.subject || data.details?.substring(0, 60) || 'Request details';
    default:
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
  
  content.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
      <h2 style="margin:0;font-size:18px;font-weight:600;">New Request</h2>
      <button onclick="closeCreateRequestModal()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#9ca3af;">&times;</button>
    </div>
    
    <div id="createRequestForm">
      <!-- Step 1: Select type -->
      <div id="stepSelectType" style="display:block;">
        <label style="display:block;margin-bottom:12px;font-size:14px;font-weight:500;color:#374151;">Request Type</label>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button class="request-type-btn" data-type="vacation" onclick="selectRequestType('vacation')" style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;cursor:pointer;text-align:left;transition:all 0.2s;display:flex;align-items:center;gap:10px;">
            <span style="font-size:20px;">🏖️</span>
            <div>
              <div style="font-weight:500;font-size:14px;">Vacation</div>
              <div style="font-size:12px;color:#6b7280;">Request time off</div>
            </div>
          </button>
          
          <button class="request-type-btn" data-type="late_start" onclick="selectRequestType('late_start')" style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;cursor:pointer;text-align:left;transition:all 0.2s;display:flex;align-items:center;gap:10px;">
            <span style="font-size:20px;">⏰</span>
            <div>
              <div style="font-weight:500;font-size:14px;">Late Start</div>
              <div style="font-size:12px;color:#6b7280;">Request to start later</div>
            </div>
          </button>
          
          <button class="request-type-btn" data-type="early_leave" onclick="selectRequestType('early_leave')" style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;cursor:pointer;text-align:left;transition:all 0.2s;display:flex;align-items:center;gap:10px;">
            <span style="font-size:20px;">🏃</span>
            <div>
              <div style="font-weight:500;font-size:14px;">Early Leave</div>
              <div style="font-size:12px;color:#6b7280;">Request to leave early</div>
            </div>
          </button>
          
          <button class="request-type-btn" data-type="schedule_change" onclick="selectRequestType('schedule_change')" style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;cursor:pointer;text-align:left;transition:all 0.2s;display:flex;align-items:center;gap:10px;">
            <span style="font-size:20px;">📅</span>
            <div>
              <div style="font-weight:500;font-size:14px;">Schedule Change</div>
              <div style="font-size:12px;color:#6b7280;">Request schedule modification</div>
            </div>
          </button>
          
          <button class="request-type-btn" data-type="supplies" onclick="selectRequestType('supplies')" style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;cursor:pointer;text-align:left;transition:all 0.2s;display:flex;align-items:center;gap:10px;">
            <span style="font-size:20px;">📦</span>
            <div>
              <div style="font-weight:500;font-size:14px;">Supplies</div>
              <div style="font-size:12px;color:#6b7280;">Request supplies or materials</div>
            </div>
          </button>
          
          <button class="request-type-btn" data-type="maintenance" onclick="selectRequestType('maintenance')" style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;cursor:pointer;text-align:left;transition:all 0.2s;display:flex;align-items:center;gap:10px;">
            <span style="font-size:20px;">🔧</span>
            <div>
              <div style="font-weight:500;font-size:14px;">Maintenance</div>
              <div style="font-size:12px;color:#6b7280;">Report maintenance issue</div>
            </div>
          </button>
          
          <button class="request-type-btn" data-type="other" onclick="selectRequestType('other')" style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;cursor:pointer;text-align:left;transition:all 0.2s;display:flex;align-items:center;gap:10px;">
            <span style="font-size:20px;">📝</span>
            <div>
              <div style="font-weight:500;font-size:14px;">Other</div>
              <div style="font-size:12px;color:#6b7280;">Other request</div>
            </div>
          </button>
        </div>
      </div>
      
      <!-- Step 2: Form for selected type (initially hidden) -->
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

window.backToTypeSelection = function() {
  document.getElementById('stepSelectType').style.display = 'block';
  document.getElementById('stepRequestForm').style.display = 'none';
};

window.selectRequestType = function(type) {
  console.log('[Inbox] Selected type:', type);
  
  document.getElementById('stepSelectType').style.display = 'none';
  document.getElementById('stepRequestForm').style.display = 'block';
  
  const formContainer = document.getElementById('requestFormContainer');
  if (!formContainer) return;
  
  // Render form based on type
  const form = createRequestForm(type);
  formContainer.innerHTML = '';
  formContainer.appendChild(form);
};

function createRequestForm(type) {
  const form = document.createElement('div');
  const typeInfo = getRequestTypeInfo(type);
  
  form.innerHTML = `
    <div style="text-align:center;margin-bottom:20px;">
      <div style="font-size:32px;margin-bottom:8px;">${typeInfo.icon}</div>
      <h3 style="margin:0;font-size:16px;font-weight:600;">${typeInfo.label}</h3>
    </div>
  `;
  
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
    }
    
    // Create request document
    const salonId = currentUserProfile.salonId;
    const requestDoc = {
      tenantId: salonId,
      locationId: null,
      type: type,
      status: 'open',
      priority: 'normal',
      
      // Identity
      createdByUid: currentUserProfile.uid,
      createdByStaffId: currentUserProfile.staffId || '',
      createdByName: currentUserProfile.name || '',
      createdByRole: currentUserProfile.role || '',
      forUid: currentUserProfile.uid,  // For themselves (on-behalf comes later)
      forStaffId: currentUserProfile.staffId || '',
      forStaffName: currentUserProfile.name || '',
      assignedTo: null,
      
      // Timestamps
      createdAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
      updatedAt: null,
      
      // Data
      data: data,
      
      // Manager fields (null on create)
      managerNotes: null,
      responseNote: null,
      decidedBy: null,
      decidedAt: null,
      needsInfoQuestion: null,
      staffReply: null,
      
      // Visibility
      visibility: 'managers_only',
      unreadForManagers: true
    };
    
    console.log('[Inbox] Creating request', requestDoc);
    
    const docRef = await addDoc(
      collection(db, `salons/${salonId}/inboxItems`),
      requestDoc
    );
    
    console.log('[Inbox] Request created', docRef.id);
    
    // Close modal
    closeCreateRequestModal();
    
    // Show success toast
    showToast('Request submitted successfully!', 'success');
    
    // Reload list
    loadInboxItems();
    
  } catch (error) {
    console.error('[Inbox] Submit error', error);
    showToast(`Failed to submit request: ${error.message}`, 'error');
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
  
  // Technician reply (if needs_info and it's their request)
  if (isTechnician && isMyRequest && request.status === 'needs_info' && !request.staffReply) {
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;color:#374151;">Your Reply</h3>
        <textarea id="staffReplyInput" rows="3" placeholder="Answer the manager's question..." style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;margin-bottom:12px;"></textarea>
        <button onclick="submitStaffReply('${requestId}')" style="width:100%;padding:10px;background:#111;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">
          Submit Reply
        </button>
      </div>
    `;
  }
  
  // Manager actions (only for managers/admins)
  if (isManager && request.status === 'open') {
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;color:#374151;">Manager Actions</h3>
        
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
  
  // Manager actions for needs_info status
  if (isManager && request.status === 'needs_info') {
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
  
  // Archive button (for approved/denied requests)
  if (isManager && (request.status === 'approved' || request.status === 'denied')) {
    detailsHTML += `
      <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">
        <button onclick="archiveRequest('${requestId}')" style="padding:10px;border:1px solid #9ca3af;background:#fff;color:#374151;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500;width:100%;">
          📦 Move to Archive
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
      
    default:
      return '<div style="color:#9ca3af;">No details available</div>';
  }
}

// =====================
// Manager Actions (will be Cloud Functions in final version)
// =====================
window.submitStaffReply = async function(requestId) {
  const replyInput = document.getElementById('staffReplyInput');
  const reply = replyInput?.value?.trim();
  
  if (!reply) {
    showToast('Please enter a reply', 'error');
    return;
  }
  
  try {
    const salonId = currentUserProfile.salonId;
    await updateDoc(doc(db, `salons/${salonId}/inboxItems`, requestId), {
      staffReply: reply,
      status: 'open',  // Back to open after reply
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      unreadForManagers: true
    });
    
    closeRequestDetailsModal();
    showToast('Reply submitted! Request is back to Open status.', 'success');
  } catch (error) {
    console.error('[Inbox] submitStaffReply error', error);
    showToast(`Error: ${error.message}`, 'error');
  }
};

window.needsMoreInfo = async function(requestId) {
  const question = prompt('What information do you need from the staff member?');
  if (!question) return;
  
  try {
    const salonId = currentUserProfile.salonId;
    await updateDoc(doc(db, `salons/${salonId}/inboxItems`, requestId), {
      status: 'needs_info',
      needsInfoQuestion: question,
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      unreadForManagers: false
    });
    
    closeRequestDetailsModal();
    showToast('Request updated - waiting for staff response', 'success');
  } catch (error) {
    console.error('[Inbox] needsMoreInfo error', error);
    showToast(`Error: ${error.message}`, 'error');
  }
};

window.approveRequest = async function(requestId) {
  // TODO: This will be a Cloud Function call in final version
  // For now, direct Firestore update for testing
  
  const confirmed = confirm('Approve this request?');
  if (!confirmed) return;
  
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
    
    closeRequestDetailsModal();
    showToast('Request approved!', 'success');
  } catch (error) {
    console.error('[Inbox] approve error', error);
    showToast(`Error: ${error.message}`, 'error');
  }
};

window.denyRequest = async function(requestId) {
  // TODO: This will be a Cloud Function call in final version
  
  const reason = prompt('Why is this request denied? (optional)');
  
  const confirmed = confirm('Deny this request?');
  if (!confirmed) return;
  
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
    
    closeRequestDetailsModal();
    showToast('Request denied', 'success');
  } catch (error) {
    console.error('[Inbox] deny error', error);
    showToast(`Error: ${error.message}`, 'error');
  }
};

window.archiveRequest = async function(requestId) {
  const confirmed = confirm('Move this request to archive?');
  if (!confirmed) return;
  
  try {
    const salonId = currentUserProfile.salonId;
    await updateDoc(doc(db, `salons/${salonId}/inboxItems`, requestId), {
      status: 'archived',
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    
    closeRequestDetailsModal();
    showToast('Request archived', 'success');
  } catch (error) {
    console.error('[Inbox] archive error', error);
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
  
  // Wire up back button
  const backBtn = document.getElementById('btnInboxBack');
  if (backBtn) {
    backBtn.onclick = () => {
      const inboxScreen = document.getElementById('inboxScreen');
      if (inboxScreen) inboxScreen.style.display = 'none';
      
      // Go back to queue (or wherever)
      if (typeof window.goToQueue === 'function') {
        window.goToQueue();
      }
    };
  }
  
  // Wire up new request button
  const newRequestBtn = document.getElementById('btnNewRequest');
  if (newRequestBtn) {
    newRequestBtn.onclick = window.openCreateRequestModal;
  }
  
  // Global listener: close inbox when clicking ANY nav button (except inbox itself)
  document.addEventListener('click', (e) => {
    const navBtn = e.target.closest('.btn-pill');
    if (navBtn && navBtn.id !== 'inboxBtn' && navBtn !== inboxBtn) {
      const inboxScreen = document.getElementById('inboxScreen');
      if (inboxScreen && inboxScreen.style.display === 'flex') {
        console.log('[Inbox] Closing inbox - nav button clicked:', navBtn.id || navBtn.textContent);
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
