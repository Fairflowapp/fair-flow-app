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
  runTransaction,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth, storage } from "/app.js?v=20260610_force_lp_ios";
import {
  ffSyncStaffDocumentOnInboxApprove,
  ffSyncStaffDocumentOnInboxReject,
  ffSendExpiryChatReminderForStaffDocContext,
  ffStaffDocumentTypeSelectOptionsHtml,
  ffExpirationTimestampToYmdInput,
} from "./staff-documents.js?v=20260505_full_specialist_doc_type";
import {
  ffInboxYmdFromRaw,
  enumerateInclusiveDateKeysForInbox,
  inboxEffectiveTypeForGrouping,
  inboxDocAlertIsExpiredForUi,
  ffInboxIsStaffCallOtherNoise,
  inboxItemActivityMs,
  inboxErrorNeedsIndex,
  inboxNormalizeLineStaffRoleLc,
  inboxCanViewInboxEval,
  inboxCanManageInboxEval,
  inboxCanSendRequestsEval,
  ffInboxRuleString,
  ffSuggestionFmtDays,
  ffSuggestionFmtRate,
  inboxSupplyRequestIsPending,
  inboxSupplyStatusDisplayLabel,
  suppliesRowRequiresVariant,
  formatRelativeDate,
} from "./inbox-helpers.js?v=20260626_inbox_helpers_split";

// ── Module state + config tables — extracted to inbox-state.js
import {
  inboxState,
  REQUEST_CATEGORY_ORDER,
  REQUEST_CATEGORY_LABELS,
  BUILTIN_TYPES,
  LEGACY_INBOX_TYPE_INFO,
  MANAGER_ONLY_INBOX_TYPES,
  INBOX_SETTINGS_DOC_ID,
  FF_INVENTORY_SUPPLY_VARIANT_KEYS,
  SUPPLIES_VARIANT_LABELS,
  CUSTOM_TYPE_EMOJIS,
} from "./inbox-state.js?v=20260629_inbox_state_split";

// ── Smart Inventory Suggestion feature — extracted to inbox-inventory-suggestion.js
import {
  initInboxInventorySuggestion,
  ffShowInventorySuggestionModal,
  ffRenderInventorySuggestionCard,
} from "./inbox-inventory-suggestion.js?v=20260629_inbox_invsugg_split";
initInboxInventorySuggestion({ escapeHtml, showToast, renderInboxList, updateInboxBadges });

// ── Supplies request feature — extracted to inbox-supplies.js
import {
  initInboxSupplies,
  applyApprovedSupplyRequestToInventory,
  approveSupplyRequest,
  denySupplyRequest,
  SUPPLIES_ITEM_ROW_INNER_HTML,
  wireSuppliesItemRow,
  classifySuppliesRow,
  readSuppliesRowSnapshot,
  initSuppliesRequestForm,
} from "./inbox-supplies.js?v=20260629_inbox_supplies_split";
initInboxSupplies({ showToast });

// ── Staff document alert presentation helpers — extracted to inbox-documents.js
import {
  initInboxDocuments,
  ffDocAlertIsHebrewUI,
  ffDocAlertStaffName,
  ffDocAlertDocTitle,
  ffDocAlertDocType,
  ffDocAlertExpFormattedLong,
  ffDocAlertHumanSummary,
  ffDocAlertStaffId,
  ffDocAlertWhatToDoLine,
  ffDocAlertModalFooterIds,
} from "./inbox-documents.js?v=20260629_inbox_documents_split";
initInboxDocuments({ escapeHtml });

// ── Request types registry — extracted to inbox-types.js
import {
  initInboxTypes,
  loadCustomTypes,
  loadInboxSettings,
  setInboxTypeVisibility,
  getRequestTypesGroupedByCategory,
  getRequestTypeInfo,
} from "./inbox-types.js?v=20260630_inbox_types_split";
initInboxTypes({ inboxUserRoleLc });

// ── Shared UI utilities — extracted to inbox-utils.js
import {
  escapeHtml,
  showConfirmModal,
  showPromptModal,
  showToast,
} from "./inbox-utils.js?v=20260630_inbox_utils_split";

// ── Data + permissions layer — extracted to inbox-data.js
import {
  inboxUserRoleLc,
  inboxCanViewInbox,
  inboxCanManageInbox,
  inboxCanSendRequests,
  mergeSalonStaffIntoUserProfile,
  resolveCurrentInboxActorName,
  loadSalonUsersForRecipients,
  loadCurrentUserProfile,
  getInboxRecipientsList,
  getCreateRequestSelectedRecipients,
} from "./inbox-data.js?v=20260630_inbox_data_split";

// ── Modals + settings UI — extracted to inbox-modals-ui.js
import "./inbox-modals-ui.js?v=20260630_inbox_modals_ui_split";

// ── List rendering — extracted to inbox-list-render.js
import {
  renderInboxList,
  updateInboxBadges,
  updateInboxStaffFilterOptions,
  inboxGetStaffLocationMap,
  inboxItemMatchesActiveLocation,
  initInboxListRender,
} from "./inbox-list-render.js?v=20260630_inbox_list_render_split";
initInboxListRender({ showRequestDetails, inboxTechnicianNoiseFilter });

// ── Request details modal — extracted to inbox-details.js
import { showRequestDetails } from "./inbox-details.js?v=20260630_inbox_details_split";

// ── Submit request (create) — extracted to inbox-submit.js
import { initInboxSubmit, submitRequest } from "./inbox-submit.js?v=20260630_inbox_submit_split";
initInboxSubmit({ loadInboxItems });

// ── Manager action handlers — extracted to inbox-actions.js
import { initInboxActions } from "./inbox-actions.js?v=20260630_inbox_actions_split";
initInboxActions({ loadInboxItems });

// ── Create request form — extracted to inbox-create-form.js
import { initInboxCreateForm } from "./inbox-create-form.js?v=20260630_inbox_create_form_split";
initInboxCreateForm({ submitRequest });

// Category order for display (Schedule → Payments → Operations → Documents → Other at end)




/** Rows technicians should not see in Inbox (manager automations + misrouted staff-call "Other" items). */
function inboxTechnicianNoiseFilter(rows) {
  return (rows || [])
    .filter((r) => !MANAGER_ONLY_INBOX_TYPES.has(String(r.type || "").trim()))
    .filter((r) => !ffInboxIsStaffCallOtherNoise(r));
}

function applyInboxSnapshotRows(snapshot, loadingEl) {
  if (loadingEl) loadingEl.style.display = 'none';
  inboxState.currentRequests = snapshot.docs
    .map(doc => ({
      id: doc.id,
      ...doc.data()
    }))
    .sort((a, b) => inboxItemActivityMs(b) - inboxItemActivityMs(a));

  console.log('[Inbox] Loaded', inboxState.currentRequests.length, 'requests');
  updateInboxStaffFilterOptions();
  updateInboxBadges();
  renderInboxList();
}

function showInboxLoadError(error, loadingEl, listEl, emptyEl) {
  if (loadingEl) loadingEl.style.display = 'none';
  inboxState.currentRequests = [];
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
}

function subscribeInboxIndexFallback({ salonId, uid, mode, loadingEl, listEl, emptyEl }) {
  const field = mode === "mine" ? "createdByUid" : "forUid";
  console.warn('[Inbox] Composite index not ready; using fallback query', { mode, field });
  const fallbackQuery = query(
    collection(db, `salons/${salonId}/inboxItems`),
    where(field, '==', uid),
    limit(100)
  );
  return onSnapshot(
    fallbackQuery,
    (snapshot) => applyInboxSnapshotRows(snapshot, loadingEl),
    (fallbackError) => {
      console.error('[Inbox] Fallback query error', fallbackError);
      showInboxLoadError(fallbackError, loadingEl, listEl, emptyEl);
    }
  );
}

function applyTechInboxMerge(loadingEl) {
  const map = new Map();
  inboxState._techInboxOutgoing.forEach((row) => map.set(row.id, row));
  inboxState._techInboxIncoming.forEach((row) => map.set(row.id, row));
  inboxState.currentRequests = Array.from(map.values()).sort((a, b) => inboxItemActivityMs(b) - inboxItemActivityMs(a));
  inboxState.currentRequests = inboxTechnicianNoiseFilter(inboxState.currentRequests);
  if (loadingEl) loadingEl.style.display = 'none';
  console.log('[Inbox] Loaded (technician merged)', inboxState.currentRequests.length, 'requests');
  updateInboxStaffFilterOptions();
  updateInboxBadges();
  renderInboxList();
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



// =====================
// Navigation
// =====================
export function goToInbox(onReady) {
  console.log('[Inbox] Opening inbox');

  if (typeof window.ffCurrentUserHasInboxViewPermission === 'function' && !window.ffCurrentUserHasInboxViewPermission()) {
    if (typeof window.ffUpdateMainNavTabVisibility === 'function') window.ffUpdateMainNavTabVisibility();
    if (typeof showToast === 'function') {
      showToast('Inbox is turned off for this staff profile (enable View Inbox in permissions).', 'error');
    }
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
  const timeClockScreenInbox = document.getElementById('timeClockScreen');
  if (timeClockScreenInbox) timeClockScreenInbox.style.display = 'none';
  
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
      inboxState.inboxViewMode = "mine";
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



function setupInboxUI() {
  if (!inboxState.currentUserProfile) return;

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

  const canCreateRequests = canSend;
  const isAdminOrOwner = (role === 'admin' || role === 'owner');
  const manageTypesBtn = document.getElementById('btnManageRequestTypes');
  const settingsBtn = document.getElementById('inboxSettingsBtn');

  // New Request: show only when inbox_send (or manage) allows; hide in "To handle"
  const showNewRequest =
    canCreateRequests &&
    (role === 'technician' || sendOnlyDesk || inboxState.inboxViewMode === 'mine');
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
      inboxState.inboxStaffFilterUid = staffFilterSelect.value || '';
      renderInboxList();
    };
  }

  if (role === 'technician') {
    // Technicians see their own requests only — hide status tabs and view switcher
    const viewSwitcher = document.getElementById('inboxViewSwitcher');
    if (viewSwitcher) viewSwitcher.style.display = 'none';
    if (headerRow) headerRow.style.display = showNewRequest ? '' : 'none';
    if (inboxTabs) inboxTabs.classList.add('hidden');
    if (emptyStateMsg) emptyStateMsg.textContent = canSend ? 'No requests yet' : 'No updates yet';
    inboxState.currentInboxTab = 'my_requests';
  } else if (sendOnlyDesk) {
    inboxState.inboxViewMode = 'mine';
    const viewSwitcher = document.getElementById('inboxViewSwitcher');
    if (viewSwitcher) viewSwitcher.style.display = 'none';
    if (filterRow) filterRow.style.display = 'none';
    if (headerRow) headerRow.style.display = showNewRequest ? '' : 'none';
    if (inboxTabs) {
      inboxTabs.classList.add('hidden');
      inboxTabs.style.display = 'none';
    }
    if (emptyStateBtn) emptyStateBtn.style.display = 'none';
    inboxState.currentInboxTab = 'my_requests';
    if (emptyStateMsg) emptyStateMsg.textContent = 'No requests yet';
  } else if (canManageInbox) {
    // Manager / Admin / Owner — show view switcher (My Requests | To handle)
    const viewSwitcher = document.getElementById('inboxViewSwitcher');
    if (viewSwitcher) viewSwitcher.style.display = 'flex';
    document.querySelectorAll('.inbox-view-btn').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.inboxView || '') === inboxState.inboxViewMode);
    });
    if (filterRow) filterRow.style.display = inboxState.inboxViewMode === 'mine' ? 'none' : 'flex';
    if (headerRow) headerRow.style.display = inboxState.inboxViewMode === 'mine' && showNewRequest ? '' : 'none';
    // In "My Requests": hide status tabs (Open/Needs Info/etc) and center New Request button
    if (inboxState.inboxViewMode === 'mine') {
      if (inboxTabs) { inboxTabs.classList.add('hidden'); inboxTabs.style.display = 'none'; }
    } else {
      if (inboxTabs) { inboxTabs.classList.remove('hidden'); inboxTabs.style.display = ''; }
    }
    if (emptyStateBtn) emptyStateBtn.style.display = 'none';
    inboxState.currentInboxTab = inboxState.currentInboxTab || 'open';
    if (emptyStateMsg) emptyStateMsg.textContent = 'No requests in this category';
    document.querySelectorAll('.inbox-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.inboxTab === inboxState.currentInboxTab);
    });
    syncInboxStatusFilterSelect();
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
    if (emptyStateBtn) emptyStateBtn.style.display = 'none';
    if (emptyStateMsg) emptyStateMsg.textContent = 'No access to requests for this account';
  }
}

// =====================
// View Mode (My Requests | To handle) — called from HTML onclick
// =====================
window.setInboxViewMode = function(mode) {
  if (!inboxState.currentUserProfile || inboxUserRoleLc() === "technician") return;
  if (mode === "to_handle" && !inboxCanManageInbox()) return;
  inboxState.inboxViewMode = mode;
  document.querySelectorAll('.inbox-view-btn').forEach(b => {
    b.classList.toggle('active', (b.dataset.inboxView || '') === mode);
  });
  const filterRow = document.getElementById('inboxFilterRow');
  const inboxTabs = document.getElementById('inboxTabs');
  const emptyStateBtn = document.getElementById('emptyStateNewRequestBtn');
  const headerNewBtn = document.getElementById('inboxCreateRequestBtn');
  const headerRow = document.getElementById('inboxContentHeaderRow');
  if (headerRow) headerRow.style.display = mode === 'mine' && inboxCanSendRequests() ? '' : 'none';
  if (filterRow) filterRow.style.display = mode === 'mine' ? 'none' : 'flex';
  if (mode === 'mine') {
    if (inboxTabs) { inboxTabs.classList.add('hidden'); inboxTabs.style.display = 'none'; }
  } else {
    if (inboxTabs) { inboxTabs.classList.remove('hidden'); inboxTabs.style.display = ''; }
    syncInboxStatusFilterSelect();
  }
  if (emptyStateBtn) emptyStateBtn.style.display = 'none';
  if (headerNewBtn) headerNewBtn.style.display = mode === 'mine' && inboxCanSendRequests() ? '' : 'none';
  loadInboxItems();
};

function syncInboxStatusFilterSelect() {
  const statusSel = document.getElementById("inboxStatusFilterSelect");
  if (!statusSel) return;
  const t = String(inboxState.currentInboxTab || "").trim();
  if (statusSel.querySelector(`option[value="${t}"]`)) statusSel.value = t;
}

function ffWireInboxStatusFilterSelect() {
  const sel = document.getElementById("inboxStatusFilterSelect");
  if (!sel || sel.__ffInboxStatusBound) return;
  sel.__ffInboxStatusBound = true;
  sel.addEventListener("change", () => {
    const v = String(sel.value || "").trim();
    if (!v) return;
    if (typeof window.setInboxTab === "function") window.setInboxTab(v);
  });
}

// =====================
// Tab Management
// =====================
window.setInboxTab = function (tab) {
  inboxState.currentInboxTab = tab;
  // Update active tab
  document.querySelectorAll(".inbox-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.inboxTab === tab);
  });
  const statusSel = document.getElementById("inboxStatusFilterSelect");
  if (statusSel) {
    const opt = statusSel.querySelector(`option[value="${tab}"]`);
    if (opt) statusSel.value = tab;
  }
  loadInboxItems();
};

// =====================
// Load & Render Requests
// =====================
async function loadInboxItems() {
  if (!inboxState.currentUserProfile) return;
  
  const salonId = inboxState.currentUserProfile.salonId;
  const role = inboxUserRoleLc();
  const uid = inboxState.currentUserProfile.uid;

  console.log('[Inbox] loadInboxItems', { salonId, role, uid });

  // Guard: salonId must exist, otherwise rules will always deny
  if (!salonId) {
    console.error('[Inbox] salonId is missing from user profile', inboxState.currentUserProfile);
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
  if (inboxState.inboxUnsubscribe) {
    inboxState.inboxUnsubscribe();
    inboxState.inboxUnsubscribe = null;
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
      inboxState._techInboxOutgoing = [];
      inboxState._techInboxIncoming = [];
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
          inboxState._techInboxOutgoing = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          applyTechInboxMerge(loadingEl);
        },
        (error) => {
          console.error('[Inbox] Technician outgoing query error', error);
          if (loadingEl) loadingEl.style.display = 'none';
          inboxState.currentRequests = [];
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
          inboxState._techInboxIncoming = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          applyTechInboxMerge(loadingEl);
        },
        (error) => {
          console.error('[Inbox] Technician incoming query error', error);
          if (loadingEl) loadingEl.style.display = 'none';
          inboxState.currentRequests = [];
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
      inboxState.inboxUnsubscribe = () => {
        unsubOut();
        unsubIn();
      };
      return;
    } else if (role !== "technician" && !inboxCanManageInbox() && !inboxCanSendRequests()) {
      if (loadingEl) loadingEl.style.display = "none";
      inboxState.currentRequests = [];
      updateInboxStaffFilterOptions();
      updateInboxBadges();
      renderInboxList();
      return;
    } else if (inboxState.inboxViewMode === "mine" || !inboxCanManageInbox()) {
      // "My Requests" (created by me) — send-only staff use this path only
      q = query(
        collection(db, `salons/${salonId}/inboxItems`),
        where('createdByUid', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(50)
      );
    } else {
      // "To handle" — full inbox managers only
      if (inboxState.currentInboxTab === 'open') {
        q = query(
          collection(db, `salons/${salonId}/inboxItems`),
          where('forUid', '==', uid),
          where('status', 'in', ['open', 'pending']),
          orderBy('lastActivityAt', 'desc'),
          limit(50)
        );
      } else if (inboxState.currentInboxTab === 'needs_info') {
        q = query(
          collection(db, `salons/${salonId}/inboxItems`),
          where('forUid', '==', uid),
          where('status', '==', 'needs_info'),
          orderBy('lastActivityAt', 'desc'),
          limit(50)
        );
      } else if (inboxState.currentInboxTab === 'approved') {
        q = query(
          collection(db, `salons/${salonId}/inboxItems`),
          where('forUid', '==', uid),
          where('status', 'in', ['approved', 'done']),
          orderBy('lastActivityAt', 'desc'),
          limit(50)
        );
      } else if (inboxState.currentInboxTab === 'denied') {
        q = query(
          collection(db, `salons/${salonId}/inboxItems`),
          where('forUid', '==', uid),
          where('status', '==', 'denied'),
          orderBy('lastActivityAt', 'desc'),
          limit(50)
        );
      } else if (inboxState.currentInboxTab === 'archived') {
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
    inboxState.inboxUnsubscribe = onSnapshot(q, (snapshot) => {
      applyInboxSnapshotRows(snapshot, loadingEl);
    }, (error) => {
      console.error('[Inbox] Query error', error);
      if (inboxErrorNeedsIndex(error)) {
        try {
          if (typeof inboxState.inboxUnsubscribe === 'function') inboxState.inboxUnsubscribe();
        } catch (_) {}
        inboxState.inboxUnsubscribe = subscribeInboxIndexFallback({
          salonId,
          uid,
          mode: inboxState.inboxViewMode === "mine" || !inboxCanManageInbox() ? "mine" : "to_handle",
          loadingEl,
          listEl,
          emptyEl
        });
        return;
      }
      showInboxLoadError(error, loadingEl, listEl, emptyEl);
    });
    
  } catch (error) {
    console.error('[Inbox] Load error', error);
    if (loadingEl) loadingEl.style.display = 'none';
  }
}







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
  window.goToInbox = goToInbox;
  ffWireInboxStatusFilterSelect();

  if (typeof window !== 'undefined' && window.__ffInboxInitV1) {
    console.log('[Inbox] Already initialized');
    return;
  }
  if (typeof window !== 'undefined') window.__ffInboxInitV1 = true;

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
        else if (bid === 'mediaBtn' && typeof window.goToMedia === 'function') window.goToMedia();
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

function _bgBadgeRecompute() {
  try {
    let rows = inboxState._bgBadgeLatestRows || [];

    // Scope the badges to the currently active branch. Use the same rule
    // set as the main inbox list (explicit locationId → subject staff
    // allowedLocationIds → fall-through). Without this, a request sent in
    // branch A would show "1" on the Open tab and on the nav Inbox icon
    // when viewing branch B.
    let activeLocId = null;
    try {
      if (typeof window !== 'undefined' && typeof window.ffGetActiveLocationId === 'function') {
        const v = window.ffGetActiveLocationId();
        if (typeof v === 'string' && v.trim()) activeLocId = v.trim();
      }
      if (!activeLocId && typeof window !== 'undefined'
          && typeof window.__ff_active_location_id === 'string'
          && window.__ff_active_location_id.trim()) {
        activeLocId = window.__ff_active_location_id.trim();
      }
    } catch (_) {}
    if (activeLocId) {
      const staffLocMap = (typeof inboxGetStaffLocationMap === 'function')
        ? inboxGetStaffLocationMap() : {};
      rows = rows.filter((r) => inboxItemMatchesActiveLocation(r, activeLocId, staffLocMap));
    }

    const openCount = rows.filter((r) => r.status === 'open' || r.status === 'pending').length;
    const needsInfoCount = rows.filter((r) => r.status === 'needs_info').length;
    const total = openCount + needsInfoCount;

    const navBadge = document.querySelector('#inboxBtn .ff-inbox-badge');
    if (navBadge) navBadge.textContent = total > 0 ? total : '';

    const openBadge = document.getElementById('inboxOpenBadge');
    if (openBadge) openBadge.textContent = openCount > 0 ? openCount : '';

    const needsInfoBadge = document.getElementById('inboxNeedsInfoBadge');
    if (needsInfoBadge) needsInfoBadge.textContent = needsInfoCount > 0 ? needsInfoCount : '';
  } catch (e) {
    console.warn('[Inbox] bg badge recompute failed', e);
  }
}

function startBgBadgeListener(uid, salonId, roleLc) {
  if (inboxState._bgBadgeUnsubscribe) { inboxState._bgBadgeUnsubscribe(); inboxState._bgBadgeUnsubscribe = null; }
  const q = query(
    collection(db, `salons/${salonId}/inboxItems`),
    where('forUid', '==', uid),
    where('unreadForManagers', '==', true)
  );
  inboxState._bgBadgeIsTech = String(roleLc || '').toLowerCase() === 'technician';
  inboxState._bgBadgeUnsubscribe = onSnapshot(q, (snap) => {
    let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (inboxState._bgBadgeIsTech) {
      rows = inboxTechnicianNoiseFilter(rows);
    }
    inboxState._bgBadgeLatestRows = rows;
    _bgBadgeRecompute();
  }, () => {});
}

// Recompute badges when the active branch changes, even if Firestore did
// not push a new snapshot (e.g. purely switching branches on the same set
// of cached items).
if (typeof document !== 'undefined' && !window.__ffInboxBadgeLocListener) {
  window.__ffInboxBadgeLocListener = true;
  document.addEventListener('ff-active-location-changed', () => {
    _bgBadgeRecompute();
  });
  document.addEventListener('ff-staff-cloud-updated', () => {
    _bgBadgeRecompute();
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (inboxState._bgBadgeUnsubscribe) { inboxState._bgBadgeUnsubscribe(); inboxState._bgBadgeUnsubscribe = null; }
    void ffRefreshInboxNavVisibility();
    return;
  }
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return;
    let profile = { uid: user.uid, ...userDoc.data() };
    profile = await mergeSalonStaffIntoUserProfile(profile);
    void ffRefreshInboxNavVisibility();
    const roleLc = inboxNormalizeLineStaffRoleLc(profile.role || '');
    const runBadge =
      profile.salonId &&
      (inboxCanManageInboxEval(profile) || roleLc === 'technician');
    if (runBadge) {
      startBgBadgeListener(user.uid, profile.salonId, roleLc);
    } else if (inboxState._bgBadgeUnsubscribe) {
      inboxState._bgBadgeUnsubscribe();
      inboxState._bgBadgeUnsubscribe = null;
    }
  } catch (e) {
    console.warn('[Inbox] bg badge listener error', e.message);
  }
});
