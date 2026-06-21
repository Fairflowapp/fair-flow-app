import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";

let floorSalonId = null;
let floorUser = null;
let floorCategoriesUnsub = null;
let floorRegularRequestsUnsub = null;
let floorFlowsUnsub = null;
let floorOrdersUnsub = null;
let floorCategories = [];
let floorRegularRequests = [];
let floorFlows = [];
let floorOrders = [];
let floorEditingFlowId = null;

// Live Desk reads current floor orders (who sent what) for its overview.
if (typeof window !== 'undefined') {
  window.ffGetFloorOrders = function () {
    return Array.isArray(floorOrders) ? floorOrders.slice() : [];
  };
}

function toast(message) {
  if (typeof window.ffToast === 'object' && window.ffToast && typeof window.ffToast.show === 'function') {
    window.ffToast.show(message, { variant: 'info', durationMs: 2200 });
  }
}

function reportFloorWriteError(action, err) {
  console.warn(`[Floor] ${action} failed`, err);
  const message = `${action} failed. Please refresh and try again.`;
  if (typeof window.ffToast === 'object' && window.ffToast && typeof window.ffToast.show === 'function') {
    window.ffToast.show(message, { variant: 'error', durationMs: 3200 });
  } else {
    alert(message);
  }
}

async function resolveFloorSalonId(user) {
  const activeSalonId = typeof window !== 'undefined' && window.currentSalonId
    ? String(window.currentSalonId).trim()
    : '';
  if (activeSalonId) return activeSalonId;
  if (!user) return '';
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    return snap.exists() ? String(snap.data()?.salonId || '').trim() : '';
  } catch (err) {
    console.warn('[Floor] resolve salon failed', err);
    return '';
  }
}

function sortByOrderThenName(items) {
  return items.slice().sort((a, b) => {
    const ao = Number.isFinite(Number(a.order)) ? Number(a.order) : 999999;
    const bo = Number.isFinite(Number(b.order)) ? Number(b.order) : 999999;
    if (ao !== bo) return ao - bo;
    return String(a.name || a.title || '').localeCompare(String(b.name || b.title || ''));
  });
}

function buildPersistedFlowSteps(draft, stepIdMap) {
  return (draft.steps || []).map((step, idx) => ({
    id: stepIdMap[step.id] || step.id,
    prompt: step.prompt,
    order: idx,
    options: (step.options || []).map((option, oidx) => ({
      id: option.id,
      label: option.label,
      order: oidx,
      nextStepId: option.nextStepId ? (stepIdMap[option.nextStepId] || null) : null,
      finish: !option.nextStepId
    }))
  }));
}

function syncWindowState() {
  window.__ffFloorCategories = floorCategories.map((category) => category.name).filter(Boolean);
  window.__ffFloorCategoryDocs = floorCategories.slice();
  window.__ffFloorRegularRequests = floorRegularRequests.map((request) => ({
    id: request.id,
    name: request.name,
    category: request.category || ''
  }));
  window.__ffFloorRegularRequestDocs = floorRegularRequests.slice();
  window.__ffFloorFlowDocs = floorFlows.slice();
  if (typeof window.ffFloorRefreshCategoryOptions === 'function') window.ffFloorRefreshCategoryOptions();
  renderFloorFlowsList();
  if (typeof window.ffRenderFloorOrderPicker === 'function') window.ffRenderFloorOrderPicker();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function renderFloorFlowsList() {
  const list = document.getElementById('floorFlowsList');
  if (!list) return;
  if (!floorFlows.length) {
    list.innerHTML = '<div style="padding:14px;color:#9ca3af;font-size:13px;">No flow requests yet.</div>';
    return;
  }
  list.innerHTML = floorFlows.map((flow, idx) => (
    '<div style="display:grid;grid-template-columns:minmax(150px,1fr) minmax(130px,1fr) 72px;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#111827;">'
    + '<div style="font-weight:600;">' + escapeHtml(flow.title || 'Untitled flow') + '</div>'
    + '<div style="color:#6b7280;">' + escapeHtml(flow.category || '') + '</div>'
    + '<div style="display:flex;gap:6px;justify-content:flex-end;">'
    + floorFlowIconButton('edit', 'window.ffEditFloorFlowRequest && window.ffEditFloorFlowRequest(' + idx + ')', 'Edit flow request')
    + floorFlowIconButton('delete', 'window.ffDeleteFloorFlowRequest && window.ffDeleteFloorFlowRequest(' + idx + ')', 'Delete flow request')
    + '</div>'
    + '</div>'
  )).join('');
}

function initialsForName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'F';
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function formatOrderTime(order) {
  const value = order.createdAt?.toDate ? order.createdAt.toDate() : (order.createdAtMs ? new Date(order.createdAtMs) : new Date());
  try {
    return value.toLocaleString([], { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (_) {
    return '';
  }
}

function cleanFloorText(value) {
  return String(value || '').trim();
}

function floorStaffName(row) {
  return cleanFloorText(row?.name || row?.staffName || row?.displayName || row?.fullName);
}

function currentFloorStaffRow() {
  try {
    if (typeof window.ffResolveCurrentStaffRowFromFfStaffV1 === 'function') {
      const row = window.ffResolveCurrentStaffRowFromFfStaffV1();
      if (row) return row;
    }
  } catch (_) {}
  try {
    if (typeof window.ffGetStaffStore !== 'function') return null;
    const store = window.ffGetStaffStore();
    const staff = Array.isArray(store?.staff) ? store.staff : [];
    const staffId = cleanFloorText(window.__ff_authedStaffId || localStorage.getItem('ff_authedStaffId_v1'));
    const email = cleanFloorText(floorUser?.email).toLowerCase();
    return staff.find((row) => {
      const rowId = cleanFloorText(row?.id || row?.staffId);
      const rowEmail = cleanFloorText(row?.email).toLowerCase();
      return (staffId && rowId === staffId) || (email && rowEmail === email);
    }) || null;
  } catch (_) {
    return null;
  }
}

function resolveFloorOrderCreatorName(order) {
  const savedName = cleanFloorText(order.createdByName);
  if (savedName) return savedName;

  try {
    if (typeof window.ffGetStaffStore === 'function') {
      const store = window.ffGetStaffStore();
      const staff = Array.isArray(store?.staff) ? store.staff : [];
      const staffId = cleanFloorText(order.createdByStaffId);
      const uid = cleanFloorText(order.createdByUid);
      const email = cleanFloorText(order.createdByEmail).toLowerCase();
      const row = staff.find((item) => {
        const rowId = cleanFloorText(item?.id || item?.staffId);
        const rowUid = cleanFloorText(item?.uid || item?.authUid || item?.firebaseUid || item?.userId);
        const rowEmail = cleanFloorText(item?.email).toLowerCase();
        return (staffId && rowId === staffId) || (uid && rowUid === uid) || (email && rowEmail === email);
      });
      const name = floorStaffName(row);
      if (name) return name;
    }
  } catch (_) {}

  return cleanFloorText(order.createdByEmail) || 'Team';
}

function resolveFloorOrderActorName(order, prefix) {
  return cleanFloorText(order?.[`${prefix}ByName`]) || cleanFloorText(order?.[`${prefix}ByEmail`]) || '';
}

function currentFloorOrderCreatorName() {
  const staffName = floorStaffName(currentFloorStaffRow());
  return staffName || cleanFloorText(window.__ff_authedStaffName || sessionStorage.getItem('ff_actor_name') || floorUser?.displayName);
}

function currentFloorStaffId() {
  const staffRow = currentFloorStaffRow();
  return cleanFloorText(staffRow?.id || staffRow?.staffId || window.__ff_authedStaffId || localStorage.getItem('ff_authedStaffId_v1'));
}

function floorOrderBelongsToCurrentUser(order) {
  const uid = cleanFloorText(floorUser?.uid);
  const staffId = currentFloorStaffId();
  const email = cleanFloorText(floorUser?.email).toLowerCase();
  const createdByUid = cleanFloorText(order?.createdByUid);
  const createdByStaffId = cleanFloorText(order?.createdByStaffId);
  const createdByEmail = cleanFloorText(order?.createdByEmail).toLowerCase();
  return !!(
    (uid && createdByUid === uid) ||
    (staffId && createdByStaffId === staffId) ||
    (email && createdByEmail === email)
  );
}

function normalizeFloorOrderStatus(status) {
  const value = cleanFloorText(status || 'open').toLowerCase();
  if (value === 'in_progress' || value === 'closed') return value;
  return 'open';
}

function floorOrderStatusLabel(status) {
  const normalized = normalizeFloorOrderStatus(status);
  if (normalized === 'in_progress') return 'In Progress';
  if (normalized === 'closed') return 'Closed';
  return 'Open';
}

function floorOrderDetails(order) {
  const details = Array.isArray(order?.details) && order.details.length
    ? order.details
    : (Array.isArray(order?.flowAnswers) ? order.flowAnswers : []);
  return details
    .map((item) => ({
      question: cleanFloorText(item?.question || item?.label || item?.title),
      answer: cleanFloorText(item?.answer || item?.value || item?.name)
    }))
    .filter((item) => item.question || item.answer);
}

function floorOrderDetailsSummary(order) {
  const details = floorOrderDetails(order);
  if (details.length) {
    return details.map((item) => `${item.question || 'Detail'}: ${item.answer}`).join(' · ');
  }
  return '';
}

function floorOrderBadgeClass(status) {
  const normalized = normalizeFloorOrderStatus(status);
  return `floor-demo-badge floor-demo-badge--${normalized.replace('_', '-')}`;
}

function updateFloorNavBadge() {
  const badge = document.getElementById('floorNavBadge');
  if (!badge) return;
  const canReceive = typeof window.ffCurrentUserCanReceiveFloorOrders === 'function'
    ? window.ffCurrentUserCanReceiveFloorOrders()
    : true;
  if (!floorUser || !canReceive) {
    badge.textContent = '';
    badge.style.display = 'none';
    return;
  }
  const openOrders = (floorOrders || []).filter((order) => normalizeFloorOrderStatus(order.status) === 'open');
  badge.textContent = openOrders.length > 0 ? String(openOrders.length) : '';
  badge.style.display = openOrders.length > 0 ? '' : 'none';
}
window.ffUpdateFloorNavBadge = updateFloorNavBadge;

// Build a single floor-order card with the EXACT same look as the Floor module.
// Shared by the Floor grid and the Live Desk so both look identical.
function ffBuildFloorOrderCardHTML(order) {
  const name = resolveFloorOrderCreatorName(order);
  const status = normalizeFloorOrderStatus(order.status);
  const details = floorOrderDetailsSummary(order)
    ? '<div class="floor-demo-line"><strong>Details:</strong> ' + escapeHtml(floorOrderDetailsSummary(order)) + '</div>'
    : '';
  const client = cleanFloorText(order.clientName)
    ? '<div class="floor-demo-client">\uD83D\uDC64 ' + escapeHtml(order.clientName) + '</div>'
    : '';
  const handledStatus = status === 'in_progress'
    ? '<div class="floor-demo-status-by">' + (cleanFloorText(order.handledByName) ? 'by ' + escapeHtml(order.handledByName) : 'In progress') + '</div>'
    : '';
  return '<div class="floor-demo-card">'
    + '<div class="floor-demo-card-header">'
    + '<div class="floor-demo-person">'
    + '<div class="floor-demo-avatar" aria-hidden="true">' + escapeHtml(initialsForName(name)) + '</div>'
    + '<div>'
    + '<div class="floor-demo-employee">' + escapeHtml(name) + '</div>'
    + client
    + '<div class="floor-demo-time">' + escapeHtml(formatOrderTime(order)) + '</div>'
    + '</div>'
    + '</div>'
    + '<div class="floor-demo-status"><div class="' + floorOrderBadgeClass(status) + '">' + floorOrderStatusLabel(status) + '</div>' + handledStatus + '</div>'
    + '</div>'
    + '<div class="floor-demo-line"><strong>Request:</strong> ' + escapeHtml(order.requestName || 'Floor request') + '</div>'
    + '<div class="floor-demo-line"><strong>Category:</strong> ' + escapeHtml(order.category || '') + '</div>'
    + details
    + '</div>';
}
window.ffRenderFloorOrderCardHTML = function (order) {
  try { return order ? ffBuildFloorOrderCardHTML(order) : ''; } catch (_) { return ''; }
};

function renderFloorOrders() {
  // Keep the Live Desk floor card in sync in real time (it reads from ffGetFloorOrders).
  if (typeof window.ffLiveRefreshFloorCard === 'function') {
    try { window.ffLiveRefreshFloorCard(); } catch (_eLive) {}
  }
  const canReceive = typeof window.ffCurrentUserCanReceiveFloorOrders === 'function'
    ? window.ffCurrentUserCanReceiveFloorOrders()
    : true;
  const canSend = typeof window.ffCurrentUserCanSendFloorOrders === 'function'
    ? window.ffCurrentUserCanSendFloorOrders()
    : false;
  if (!canReceive && !canSend) {
    const ordersList = document.getElementById('floorOrdersList');
    if (ordersList) ordersList.style.display = 'none';
    updateFloorNavBadge();
    return;
  }
  const ordersList = document.getElementById('floorOrdersList');
  if (ordersList) ordersList.style.display = '';
  const grid = document.getElementById('floorDemoGrid');
  const emptyState = document.getElementById('floorEmptyState');
  const emptyTitle = document.getElementById('floorEmptyTitle');
  const emptyDesc = document.getElementById('floorEmptyDesc');
  if (!grid) {
    updateFloorNavBadge();
    return;
  }
  const activeTab = window.__ffFloorActiveTab === 'closed' ? 'closed' : 'open';
  const visibleOrders = floorOrders.filter((order) => {
    const status = normalizeFloorOrderStatus(order.status);
    if (!canReceive) return floorOrderBelongsToCurrentUser(order) && (status === 'open' || status === 'in_progress');
    return activeTab === 'closed' ? status === 'closed' : status === 'open' || status === 'in_progress';
  });
  if (!visibleOrders.length) {
    grid.innerHTML = '';
    grid.style.display = 'none';
    if (emptyState) emptyState.style.display = 'flex';
    const sendOnlyEmptyTitle = !canReceive && canSend ? 'No open floor orders sent yet' : 'No open floor orders yet';
    if (emptyTitle) emptyTitle.textContent = activeTab === 'closed' && canReceive ? 'No closed floor orders yet' : sendOnlyEmptyTitle;
    if (emptyDesc) emptyDesc.textContent = activeTab === 'closed' && canReceive
      ? 'Closed floor orders will appear here.'
      : (!canReceive && canSend ? 'Your sent floor orders will appear here until they are closed.' : 'New floor orders will appear here.');
    updateFloorNavBadge();
    return;
  }
  grid.style.display = 'grid';
  if (emptyState) emptyState.style.display = 'none';
  grid.innerHTML = visibleOrders.map((order) => ffBuildFloorOrderCardHTML(order)).join('');
  grid.querySelectorAll('.floor-demo-card').forEach((card, idx) => {
    const order = visibleOrders[idx];
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Open floor order ${order?.requestName || ''}`);
    card.addEventListener('click', () => window.ffOpenFloorOrderDetails && window.ffOpenFloorOrderDetails(order.id));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        window.ffOpenFloorOrderDetails && window.ffOpenFloorOrderDetails(order.id);
      }
    });
  });
  updateFloorNavBadge();
}
window.ffRenderFloorOrders = renderFloorOrders;

function floorOrderDate(order) {
  const value = order?.createdAt?.toDate ? order.createdAt.toDate() : (order?.createdAtMs ? new Date(order.createdAtMs) : null);
  if (!value) return '';
  try {
    return value.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: 'numeric' });
  } catch (_) {
    return '';
  }
}

function floorOrderClock(order) {
  const value = order?.createdAt?.toDate ? order.createdAt.toDate() : (order?.createdAtMs ? new Date(order.createdAtMs) : null);
  if (!value) return '';
  try {
    return value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch (_) {
    return '';
  }
}

function ensureFloorOrderDetailsModal() {
  let modal = document.getElementById('floorOrderDetailsModal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'floorOrderDetailsModal';
  modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:9885;background:rgba(15,23,42,0.55);align-items:center;justify-content:center;padding:18px;';
  modal.innerHTML = '<div style="width:min(560px,96vw);max-height:88vh;background:#fff;border-radius:16px;box-shadow:0 18px 60px rgba(15,23,42,0.28);overflow:hidden;display:flex;flex-direction:column;">'
    + '<div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;gap:12px;">'
    + '<div><h3 style="margin:0;color:#111827;font-size:15px;font-weight:800;">Request Information</h3></div>'
    + '<button type="button" id="floorOrderDetailsCloseBtn" aria-label="Close" style="border:none;background:none;color:#6b7280;font-size:24px;line-height:1;cursor:pointer;">x</button>'
    + '</div>'
    + '<div id="floorOrderDetailsBody" style="padding:18px 20px 20px;overflow-y:auto;flex:1 1 auto;min-height:0;"></div>'
    + '<div id="floorOrderDetailsFooter" style="padding:14px 20px;border-top:1px solid #e5e7eb;background:#f9fafb;display:flex;justify-content:flex-end;gap:10px;"></div>'
    + '</div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) window.ffCloseFloorOrderDetails && window.ffCloseFloorOrderDetails();
  });
  const closeBtn = modal.querySelector('#floorOrderDetailsCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', () => window.ffCloseFloorOrderDetails && window.ffCloseFloorOrderDetails());
  return modal;
}

function ensureFloorOrderDeleteConfirmModal() {
  let modal = document.getElementById('floorOrderDeleteConfirmModal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'floorOrderDeleteConfirmModal';
  modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:9895;background:rgba(15,23,42,0.55);align-items:center;justify-content:center;padding:18px;';
  modal.innerHTML = '<div style="width:min(380px,94vw);max-height:92vh;background:#fff;border-radius:16px;box-shadow:0 18px 60px rgba(15,23,42,0.28);overflow-y:auto;">'
    + '<div style="padding:18px 20px 10px;">'
    + '<h3 style="margin:0;color:#111827;font-size:16px;font-weight:800;">Delete Order?</h3>'
    + '<p style="margin:8px 0 0;color:#6b7280;font-size:13px;line-height:1.45;">This action cannot be undone.</p>'
    + '</div>'
    + '<div style="padding:14px 20px 18px;display:flex;justify-content:flex-end;gap:10px;">'
    + '<button type="button" id="floorCancelDeleteOrderBtn" style="border:1px solid #e5e7eb;background:#fff;color:#374151;border-radius:999px;padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>'
    + '<button type="button" id="floorConfirmDeleteOrderBtn" style="border:0;background:#dc2626;color:#fff;border-radius:999px;padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer;">Delete</button>'
    + '</div>'
    + '</div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) window.ffCloseFloorOrderDeleteConfirm && window.ffCloseFloorOrderDeleteConfirm();
  });
  const cancelBtn = modal.querySelector('#floorCancelDeleteOrderBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', () => window.ffCloseFloorOrderDeleteConfirm && window.ffCloseFloorOrderDeleteConfirm());
  const confirmBtn = modal.querySelector('#floorConfirmDeleteOrderBtn');
  if (confirmBtn) confirmBtn.addEventListener('click', () => {
    const orderId = modal.getAttribute('data-order-id') || '';
    window.ffConfirmDeleteFloorOrder && window.ffConfirmDeleteFloorOrder(orderId);
  });
  return modal;
}

function detailsRow(label, value) {
  return '<div style="display:grid;grid-template-columns:150px 1fr;gap:12px;padding:9px 0;border-bottom:1px solid #f3f4f6;font-size:13px;">'
    + '<div style="color:#6b7280;font-weight:500;">' + escapeHtml(label) + '</div>'
    + '<div style="color:#111827;font-weight:500;">' + escapeHtml(value || '-') + '</div>'
    + '</div>';
}

function floorOrderDetailsHtml(order) {
  const details = floorOrderDetails(order);
  if (!details.length) {
    return '<div style="padding:12px;border:1px dashed #d1d5db;border-radius:12px;color:#9ca3af;font-size:13px;">No additional details were collected.</div>';
  }
  return '<div style="display:flex;flex-direction:column;gap:8px;">'
    + details.map((item) => (
      '<div style="padding:11px 12px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;">'
      + '<div style="font-size:12px;font-weight:500;color:#374151;line-height:1.35;">' + escapeHtml(item.question || 'Detail') + '</div>'
      + '<div style="font-size:13px;font-weight:500;color:#111827;line-height:1.35;margin-top:5px;">' + escapeHtml(item.answer || '-') + '</div>'
      + '</div>'
    )).join('')
    + '</div>';
}

function currentFloorOrderActorPayload(prefix) {
  return {
    [`${prefix}ByUid`]: floorUser?.uid || null,
    [`${prefix}ByName`]: currentFloorOrderCreatorName(),
    [`${prefix}At`]: serverTimestamp()
  };
}

async function updateFloorOrderStatus(orderId, patch, optimisticPatch = {}) {
  if (!requireFloorContext()) return false;
  if (!orderId) return false;
  try {
    await updateDoc(doc(db, `salons/${floorSalonId}/floorOrders`, orderId), patch);
    floorOrders = floorOrders.map((order) => (
      order.id === orderId ? { ...order, ...optimisticPatch } : order
    ));
    renderFloorOrders();
    return true;
  } catch (err) {
    reportFloorWriteError('Update floor order', err);
    return false;
  }
}

window.ffTakeFloorOrder = async function(orderId) {
  const actorName = currentFloorOrderCreatorName();
  const ok = await updateFloorOrderStatus(
    orderId,
    { status: 'in_progress', ...currentFloorOrderActorPayload('handled') },
    { status: 'in_progress', handledByUid: floorUser?.uid || null, handledByName: actorName }
  );
  if (ok) window.ffCloseFloorOrderDetails();
};

window.ffCloseFloorOrder = async function(orderId) {
  const actorName = currentFloorOrderCreatorName();
  const deleteAt = new Date(Date.now() + (24 * 60 * 60 * 1000));
  const ok = await updateFloorOrderStatus(
    orderId,
    { status: 'closed', ...currentFloorOrderActorPayload('closed'), deleteAt },
    { status: 'closed', closedByUid: floorUser?.uid || null, closedByName: actorName, deleteAt }
  );
  if (ok) {
    window.ffCloseFloorOrderDetails();
  }
};

window.ffCloseFloorOrderDetails = function() {
  const modal = document.getElementById('floorOrderDetailsModal');
  if (modal) modal.style.display = 'none';
};

window.ffCloseFloorOrderDeleteConfirm = function() {
  const modal = document.getElementById('floorOrderDeleteConfirmModal');
  if (modal) {
    modal.style.display = 'none';
    modal.removeAttribute('data-order-id');
  }
};

window.ffPromptDeleteFloorOrder = function(orderId) {
  const order = floorOrders.find((item) => item.id === orderId);
  if (!order || normalizeFloorOrderStatus(order.status) !== 'closed') return;
  const modal = ensureFloorOrderDeleteConfirmModal();
  modal.setAttribute('data-order-id', orderId);
  modal.style.display = 'flex';
};

window.ffConfirmDeleteFloorOrder = async function(orderId) {
  if (!requireFloorContext()) return;
  if (!orderId) return;
  const confirmBtn = document.getElementById('floorConfirmDeleteOrderBtn');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.style.opacity = '0.7';
    confirmBtn.textContent = 'Deleting...';
  }
  try {
    await deleteDoc(doc(db, `salons/${floorSalonId}/floorOrders`, orderId));
    floorOrders = floorOrders.filter((order) => order.id !== orderId);
    window.ffCloseFloorOrderDeleteConfirm();
    window.ffCloseFloorOrderDetails();
    renderFloorOrders();
    toast('Floor order deleted.');
  } catch (err) {
    reportFloorWriteError('Delete floor order', err);
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.style.opacity = '1';
      confirmBtn.textContent = 'Delete';
    }
  }
};

window.ffOpenFloorOrderDetails = function(orderId) {
  const order = floorOrders.find((item) => item.id === orderId);
  if (!order) return;
  const canReceive = typeof window.ffCurrentUserCanReceiveFloorOrders === 'function'
    ? window.ffCurrentUserCanReceiveFloorOrders()
    : true;
  if (!canReceive && !floorOrderBelongsToCurrentUser(order)) return;
  const modal = ensureFloorOrderDetailsModal();
  const body = modal.querySelector('#floorOrderDetailsBody');
  const footer = modal.querySelector('#floorOrderDetailsFooter');
  const status = normalizeFloorOrderStatus(order.status);
  const requestedBy = resolveFloorOrderCreatorName(order);
  const handledBy = resolveFloorOrderActorName(order, 'handled');

  if (body) {
    body.innerHTML = '<div style="display:flex;flex-direction:column;gap:18px;">'
      + '<div style="border:1px solid #e5e7eb;border-radius:14px;padding:4px 14px;background:#fff;">'
      + detailsRow('Requested By', requestedBy)
      + detailsRow('Date', floorOrderDate(order))
      + detailsRow('Time', floorOrderClock(order))
      + detailsRow('Request Name', order.requestName || 'Floor request')
      + detailsRow('Category', order.category || '')
      + (cleanFloorText(order.clientName) ? detailsRow('Client Name', order.clientName) : '')
      + detailsRow('Status', floorOrderStatusLabel(status))
      + (status === 'in_progress' ? detailsRow('Handled By', handledBy || '-') : '')
      + '</div>'
      + '<div>'
      + '<div style="font-size:12px;font-weight:800;color:#111827;margin-bottom:8px;">Request Details</div>'
      + floorOrderDetailsHtml(order)
      + '</div>'
      + '<div>'
      + '<div style="font-size:12px;font-weight:800;color:#111827;margin-bottom:8px;">Status</div>'
      + '<div style="padding:11px 12px;border:1px solid #e5e7eb;border-radius:12px;background:#f9fafb;color:#374151;font-size:13px;font-weight:500;">' + escapeHtml(floorOrderStatusLabel(status)) + '</div>'
      + '</div>'
      + '</div>';
  }

  if (footer) {
    if (!canReceive) {
      footer.innerHTML = '<div style="margin-right:auto;color:#6b7280;font-size:12px;font-weight:500;align-self:center;">Status: ' + escapeHtml(floorOrderStatusLabel(status)) + '</div>';
    } else if (status === 'open') {
      footer.innerHTML = '<button type="button" onclick="window.ffTakeFloorOrder && window.ffTakeFloorOrder(\'' + escapeHtml(order.id) + '\')" style="border:0;background:#7c3aed;color:#fff;border-radius:999px;padding:9px 15px;font-size:13px;font-weight:600;cursor:pointer;">Take Order</button>';
    } else if (status === 'in_progress') {
      footer.innerHTML = '<div style="margin-right:auto;color:#6b7280;font-size:12px;font-weight:500;align-self:center;">Handled by ' + escapeHtml(handledBy || 'Team') + '</div>'
        + '<button type="button" onclick="window.ffCloseFloorOrder && window.ffCloseFloorOrder(\'' + escapeHtml(order.id) + '\')" style="border:0;background:#7c3aed;color:#fff;border-radius:999px;padding:9px 15px;font-size:13px;font-weight:600;cursor:pointer;">Close Order</button>';
    } else {
      footer.innerHTML = '<div style="margin-right:auto;color:#6b7280;font-size:12px;font-weight:500;align-self:center;">Closed order</div>'
        + '<button type="button" onclick="window.ffPromptDeleteFloorOrder && window.ffPromptDeleteFloorOrder(\'' + escapeHtml(order.id) + '\')" style="border:0;background:#dc2626;color:#fff;border-radius:999px;padding:9px 15px;font-size:13px;font-weight:600;cursor:pointer;">🗑 Delete Order</button>';
    }
  }
  modal.style.display = 'flex';
};

function floorFlowIconButton(kind, onClick, label) {
  const isDelete = kind === 'delete';
  const color = isDelete ? '#dc2626' : '#7c3aed';
  const svg = isDelete
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path></svg>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
  return '<button type="button" onclick="' + onClick + '" title="' + label + '" aria-label="' + label + '" style="border:0;background:transparent;color:' + color + ';display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;padding:0;">' + svg + '</button>';
}

function subscribeFloorCollections() {
  if (!floorSalonId) return;
  if (floorCategoriesUnsub) floorCategoriesUnsub();
  if (floorRegularRequestsUnsub) floorRegularRequestsUnsub();
  if (floorFlowsUnsub) floorFlowsUnsub();
  if (floorOrdersUnsub) floorOrdersUnsub();

  floorCategoriesUnsub = onSnapshot(
    query(collection(db, `salons/${floorSalonId}/floorCategories`), orderBy('order', 'asc')),
    (snap) => {
      floorCategories = sortByOrderThenName(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      syncWindowState();
    },
    (err) => console.warn('[Floor] categories subscription failed', err)
  );

  floorRegularRequestsUnsub = onSnapshot(
    query(collection(db, `salons/${floorSalonId}/floorRegularRequests`), orderBy('order', 'asc')),
    (snap) => {
      floorRegularRequests = sortByOrderThenName(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      syncWindowState();
    },
    (err) => console.warn('[Floor] regular requests subscription failed', err)
  );

  floorFlowsUnsub = onSnapshot(
    query(collection(db, `salons/${floorSalonId}/floorFlows`), orderBy('order', 'asc')),
    (snap) => {
      const baseFlows = sortByOrderThenName(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      floorFlows = baseFlows;
      syncWindowState();
    },
    (err) => console.warn('[Floor] flows subscription failed', err)
  );

  floorOrdersUnsub = onSnapshot(
    query(collection(db, `salons/${floorSalonId}/floorOrders`), orderBy('createdAtMs', 'desc')),
    (snap) => {
      floorOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderFloorOrders();
    },
    (err) => console.warn('[Floor] orders subscription failed', err)
  );
}

function requireFloorContext() {
  if (!floorSalonId) {
    toast('Floor settings are still loading. Try again in a moment.');
    return false;
  }
  return true;
}

window.ffAddFloorCategoryUiOnly = async function() {
  if (!requireFloorContext()) return;
  const input = document.getElementById('floorNewCategoryName');
  const name = String(input?.value || '').trim();
  if (!name) return;
  const exists = floorCategories.some((category) => String(category.name || '').toLowerCase() === name.toLowerCase());
  if (exists) {
    if (input) input.value = '';
    return;
  }
  try {
    await addDoc(collection(db, `salons/${floorSalonId}/floorCategories`), {
      name,
      order: floorCategories.length,
      createdAt: serverTimestamp(),
      createdBy: floorUser?.uid || null,
      updatedAt: serverTimestamp()
    });
    if (input) input.value = '';
  } catch (err) {
    reportFloorWriteError('Add category', err);
  }
};

window.ffEditFloorCategoryUiOnly = async function(idx) {
  if (!requireFloorContext()) return;
  const category = floorCategories[idx];
  if (!category?.id) return;
  const next = prompt('Edit category name', category.name || '');
  if (next === null) return;
  const name = next.trim();
  if (!name) return;
  try {
    await updateDoc(doc(db, `salons/${floorSalonId}/floorCategories`, category.id), {
      name,
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    reportFloorWriteError('Edit category', err);
  }
};

window.ffDeleteFloorCategoryUiOnly = async function(idx) {
  if (!requireFloorContext()) return;
  const category = floorCategories[idx];
  if (!category?.id) return;
  try {
    await deleteDoc(doc(db, `salons/${floorSalonId}/floorCategories`, category.id));
  } catch (err) {
    reportFloorWriteError('Delete category', err);
  }
};

window.ffAddFloorRegularRequestUiOnly = async function() {
  if (!requireFloorContext()) return;
  const nameInput = document.getElementById('floorRegularRequestNameInput');
  const categoryInput = document.getElementById('floorRegularCategoryInput');
  const name = String(nameInput?.value || '').trim();
  const category = String(categoryInput?.value || '').trim();
  if (!name) return;
  if (!category) {
    alert('Please choose a category first.');
    return;
  }
  try {
    await addDoc(collection(db, `salons/${floorSalonId}/floorRegularRequests`), {
      name,
      category,
      order: floorRegularRequests.length,
      createdAt: serverTimestamp(),
      createdBy: floorUser?.uid || null,
      updatedAt: serverTimestamp()
    });
    if (nameInput) nameInput.value = '';
    if (categoryInput) categoryInput.value = '';
  } catch (err) {
    reportFloorWriteError('Add regular request', err);
  }
};

window.ffEditFloorRegularRequestUiOnly = async function(idx) {
  if (!requireFloorContext()) return;
  const request = floorRegularRequests[idx];
  if (!request?.id) return;
  const nameRaw = prompt('Edit request name', request.name || '');
  if (nameRaw === null) return;
  const name = nameRaw.trim();
  if (!name) return;
  const categoryRaw = prompt('Edit category', request.category || '');
  if (categoryRaw === null) return;
  try {
    await updateDoc(doc(db, `salons/${floorSalonId}/floorRegularRequests`, request.id), {
      name,
      category: categoryRaw.trim(),
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    reportFloorWriteError('Edit regular request', err);
  }
};

window.ffDeleteFloorRegularRequestUiOnly = async function(idx) {
  if (!requireFloorContext()) return;
  const request = floorRegularRequests[idx];
  if (!request?.id) return;
  try {
    await deleteDoc(doc(db, `salons/${floorSalonId}/floorRegularRequests`, request.id));
  } catch (err) {
    reportFloorWriteError('Delete regular request', err);
  }
};

async function loadFloorFlowTree(flow) {
  const stepsSnap = await getDocs(collection(db, `salons/${floorSalonId}/floorFlows/${flow.id}/steps`));
  if (stepsSnap.empty && Array.isArray(flow.steps)) {
    return {
      title: flow.title || '',
      category: flow.category || '',
      allowedSenders: Array.isArray(flow.allowedSenders) ? flow.allowedSenders : [],
      steps: sortByOrderThenName(flow.steps)
    };
  }
  const steps = await Promise.all(stepsSnap.docs.map(async (stepDoc) => {
    const step = { id: stepDoc.id, ...stepDoc.data() };
    const optionsSnap = await getDocs(collection(db, `salons/${floorSalonId}/floorFlows/${flow.id}/steps/${stepDoc.id}/options`));
    step.options = sortByOrderThenName(optionsSnap.docs.map((optionDoc) => ({ id: optionDoc.id, ...optionDoc.data() })));
    return step;
  }));
  return {
    title: flow.title || '',
    category: flow.category || '',
    allowedSenders: Array.isArray(flow.allowedSenders) ? flow.allowedSenders : [],
    steps: sortByOrderThenName(steps)
  };
}

async function deleteFloorFlowTree(flowId) {
  const stepsSnap = await getDocs(collection(db, `salons/${floorSalonId}/floorFlows/${flowId}/steps`));
  const batch = writeBatch(db);
  for (const stepDoc of stepsSnap.docs) {
    const optionsSnap = await getDocs(collection(db, `salons/${floorSalonId}/floorFlows/${flowId}/steps/${stepDoc.id}/options`));
    optionsSnap.docs.forEach((optionDoc) => batch.delete(optionDoc.ref));
    batch.delete(stepDoc.ref);
  }
  batch.delete(doc(db, `salons/${floorSalonId}/floorFlows`, flowId));
  await batch.commit();
}

async function clearFloorFlowChildren(flowId) {
  const stepsSnap = await getDocs(collection(db, `salons/${floorSalonId}/floorFlows/${flowId}/steps`));
  const batch = writeBatch(db);
  for (const stepDoc of stepsSnap.docs) {
    const optionsSnap = await getDocs(collection(db, `salons/${floorSalonId}/floorFlows/${flowId}/steps/${stepDoc.id}/options`));
    optionsSnap.docs.forEach((optionDoc) => batch.delete(optionDoc.ref));
    batch.delete(stepDoc.ref);
  }
  await batch.commit();
}

window.ffEditFloorFlowRequest = async function(idx) {
  if (!requireFloorContext()) return;
  const flow = floorFlows[idx];
  if (!flow?.id) return;
  try {
    const draft = await loadFloorFlowTree(flow);
    floorEditingFlowId = flow.id;
    if (typeof window.ffFloorFlowSetDraft === 'function') window.ffFloorFlowSetDraft(draft);
    const saveBtn = document.getElementById('floorFlowSaveBtn');
    if (saveBtn) saveBtn.textContent = 'Update Flow';
    const cancelBtn = document.getElementById('floorFlowCancelEditBtn');
    if (cancelBtn) cancelBtn.style.display = 'inline-block';
  } catch (err) {
    reportFloorWriteError('Load floor flow', err);
  }
};

window.ffDeleteFloorFlowRequest = async function(idx) {
  if (!requireFloorContext()) return;
  const flow = floorFlows[idx];
  if (!flow?.id) return;
  try {
    await deleteFloorFlowTree(flow.id);
    if (floorEditingFlowId === flow.id) {
      floorEditingFlowId = null;
      if (typeof window.ffFloorFlowResetDraft === 'function') window.ffFloorFlowResetDraft();
    }
  } catch (err) {
    reportFloorWriteError('Delete floor flow', err);
  }
};

window.ffCancelFloorFlowEdit = function() {
  floorEditingFlowId = null;
  if (typeof window.ffFloorFlowResetDraft === 'function') window.ffFloorFlowResetDraft();
  const saveBtn = document.getElementById('floorFlowSaveBtn');
  if (saveBtn) saveBtn.textContent = 'Save Flow';
  const cancelBtn = document.getElementById('floorFlowCancelEditBtn');
  if (cancelBtn) cancelBtn.style.display = 'none';
};

window.ffFloorLoadFlowTreeForOrder = async function(flowId) {
  if (!requireFloorContext()) return null;
  const flow = floorFlows.find((item) => item.id === flowId);
  if (!flow) return null;
  return loadFloorFlowTree(flow);
};

window.ffSendFloorOrder = async function(selected, flowState = {}, options = {}) {
  if (!requireFloorContext()) return false;
  if (!selected) return false;
  const answers = Array.isArray(flowState.answers) ? flowState.answers : [];
  const details = selected.kind === 'flow'
    ? answers
    : [{ question: 'Request', answer: selected.name || 'Floor request' }];
  const clientName = cleanFloorText(options.clientName);
  const staffRow = currentFloorStaffRow();
  try {
    const payload = {
      requestId: selected.id || null,
      requestName: selected.name || 'Floor request',
      requestKind: selected.kind || 'regular',
      category: selected.category || '',
      status: 'open',
      flowAnswers: answers,
      details,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now(),
      createdByUid: floorUser?.uid || null,
      createdByStaffId: cleanFloorText(staffRow?.id || staffRow?.staffId || window.__ff_authedStaffId || localStorage.getItem('ff_authedStaffId_v1')),
      createdByName: currentFloorOrderCreatorName(),
      createdByEmail: floorUser?.email || ''
    };
    if (clientName) payload.clientName = clientName;
    await addDoc(collection(db, `salons/${floorSalonId}/floorOrders`), payload);
    toast('Floor order sent.');
    return true;
  } catch (err) {
    reportFloorWriteError('Send floor order', err);
    return false;
  }
};

window.ffFloorFlowUiOnlySave = async function() {
  if (!requireFloorContext()) return;
  if (typeof window.ffFloorFlowGetDraftForSave !== 'function') {
    toast('Floor flow builder is still loading.');
    return;
  }
  const draft = window.ffFloorFlowGetDraftForSave();
  if (!draft.title) {
    alert('Please enter a flow title.');
    return;
  }
  if (!draft.steps.length) {
    alert('Please add at least one question.');
    return;
  }
  const first = draft.steps[0];
  if (!first.prompt) {
    alert('Please fill in the first question.');
    return;
  }
  if (!first.options.length || first.options.every((option) => !String(option.label || '').trim())) {
    alert('Please add at least one answer to the first question.');
    return;
  }

  try {
    let flowRef;
    const isEditing = !!floorEditingFlowId;
    if (floorEditingFlowId) {
      flowRef = doc(db, `salons/${floorSalonId}/floorFlows`, floorEditingFlowId);
      await clearFloorFlowChildren(floorEditingFlowId);
    } else {
      flowRef = doc(collection(db, `salons/${floorSalonId}/floorFlows`));
    }

    const stepIdMap = {};
    draft.steps.forEach((step) => {
      stepIdMap[step.id] = doc(collection(db, `salons/${floorSalonId}/floorFlows/${flowRef.id}/steps`)).id;
    });

    const batch = writeBatch(db);
    const persistedSteps = buildPersistedFlowSteps(draft, stepIdMap);
    const flowPayload = {
      title: draft.title,
      category: draft.category,
      allowedSenders: draft.allowedSenders,
      steps: persistedSteps,
      startStepId: persistedSteps[0]?.id || null,
      updatedAt: serverTimestamp()
    };
    if (isEditing) {
      batch.update(flowRef, flowPayload);
    } else {
      batch.set(flowRef, {
        ...flowPayload,
        order: floorFlows.length,
        createdAt: serverTimestamp(),
        createdBy: floorUser?.uid || null
      });
    }
    draft.steps.forEach((step, idx) => {
      const stepRef = doc(db, `salons/${floorSalonId}/floorFlows/${flowRef.id}/steps`, stepIdMap[step.id]);
      batch.set(stepRef, {
        prompt: step.prompt,
        order: idx
      });
      (step.options || []).forEach((option, oidx) => {
        const optionRef = doc(collection(db, `salons/${floorSalonId}/floorFlows/${flowRef.id}/steps/${stepIdMap[step.id]}/options`));
        batch.set(optionRef, {
          label: option.label,
          order: oidx,
          nextStepId: option.nextStepId ? (stepIdMap[option.nextStepId] || null) : null,
          finish: !option.nextStepId
        });
      });
    });
    await batch.commit();

    if (typeof window.ffFloorFlowResetDraft === 'function') window.ffFloorFlowResetDraft();
    floorEditingFlowId = null;
    const saveBtn = document.getElementById('floorFlowSaveBtn');
    if (saveBtn) saveBtn.textContent = 'Save Flow';
    const cancelBtn = document.getElementById('floorFlowCancelEditBtn');
    if (cancelBtn) cancelBtn.style.display = 'none';
    toast('Floor flow saved.');
  } catch (err) {
    reportFloorWriteError('Save floor flow', err);
  }
};

onAuthStateChanged(auth, async (user) => {
  floorUser = user || null;
  if (!user) {
    floorSalonId = null;
    floorCategories = [];
    floorRegularRequests = [];
    floorFlows = [];
    syncWindowState();
    return;
  }
  const salonId = await resolveFloorSalonId(user);
  if (!salonId) return;
  if (floorSalonId === salonId) return;
  floorSalonId = salonId;
  subscribeFloorCollections();
});

setTimeout(async () => {
  if (floorSalonId || !auth.currentUser) return;
  const salonId = await resolveFloorSalonId(auth.currentUser);
  if (!salonId) return;
  floorUser = auth.currentUser;
  floorSalonId = salonId;
  subscribeFloorCollections();
}, 2500);
