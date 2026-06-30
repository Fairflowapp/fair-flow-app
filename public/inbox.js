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
      // Firestore rules (staffDocUidMatches) also accept staff row `uid` / `userUid`
      const uidOnRow = String(row.uid || row.userUid || "").trim();
      if (uidOnRow && uidOnRow === u) return d.id;
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
  const uid = String(auth?.currentUser?.uid || inboxState.currentUserProfile?.uid || "").trim();
  if (!sid || !uid) return "";
  const emailHint = String(inboxState.currentUserProfile?.email || "").trim();
  const scanned = await ffResolveStaffFirestoreIdByScanInbox(sid, uid, emailHint);
  if (scanned) return scanned;
  let id = String(inboxState.currentUserProfile?.staffId || "").trim();
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
  const technicians = isRenewal
    ? (inboxState._inboxUsersCache || []).filter((u) => inboxNormalizeLineStaffRoleLc(u.role) === 'technician')
    : [];
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
    background: #7c3aed;
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

  await loadCurrentUserProfile();
  if (!inboxState.currentUserProfile) {
    showToast('User profile not loaded', 'error');
    return;
  }

  const salonIdForStaff = String(inboxState.currentUserProfile.salonId || '').trim();
  if (!salonIdForStaff) {
    showToast('No salon is selected for this account.', 'error');
    return;
  }

  let creatorStaffId = String(inboxState.currentUserProfile.staffId || '').trim();
  if (!creatorStaffId) {
    creatorStaffId = await resolveSubmittingStaffIdForDocumentUpload(salonIdForStaff);
  }
  if (!creatorStaffId) {
    showToast(
      'Your login is not linked to a staff profile in this salon. Ask a manager to link your account, then try again.',
      'error'
    );
    return;
  }
  if (String(inboxState.currentUserProfile.staffId || '').trim() !== creatorStaffId) {
    inboxState.currentUserProfile.staffId = creatorStaffId;
    await mergeSalonStaffIntoUserProfile(inboxState.currentUserProfile);
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
        subjectUid: inboxState.currentUserProfile.uid,
        subjectStaffId: inboxState.currentUserProfile.staffId || '',
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
        subjectUid: inboxState.currentUserProfile.uid,
        subjectStaffId: inboxState.currentUserProfile.staffId || '',
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
        subjectUid: inboxState.currentUserProfile.uid,
        subjectStaffId: inboxState.currentUserProfile.staffId || '',
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
        subjectUid: inboxState.currentUserProfile.uid,
        subjectStaffId: inboxState.currentUserProfile.staffId || '',
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
        subjectUid: inboxState.currentUserProfile.uid,
        subjectStaffId: inboxState.currentUserProfile.staffId || '',
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
        subjectUid: inboxState.currentUserProfile.uid,
        subjectStaffId: inboxState.currentUserProfile.staffId || '',
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
      const contactEmail = document.getElementById('doc_req_email')?.value?.trim() || auth.currentUser?.email || inboxState.currentUserProfile?.email || null;
      if (!documentType || !reason) { showToast('Please select document type and enter reason', 'error'); return; }
      data = { documentType, reason, dueDate, deliveryMethod, contactEmail };

    } else if (type === 'document_upload') {
      const documentType = document.getElementById('doc_up_type')?.value;
      const expirationDate = document.getElementById('doc_up_expiry')?.value || null;
      const renewForDocId = (document.getElementById('doc_up_renew_for_doc_id')?.value || '').trim();
      const fileInput = document.getElementById('doc_up_file');
      const notes = document.getElementById('doc_up_notes')?.value?.trim() || null;
      const salonId = inboxState.currentUserProfile.salonId;
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
      const found = (inboxState._inboxUsersCache || []).find(u =>
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
    
    const salonId = inboxState.currentUserProfile.salonId;
    const creatorName = await resolveCurrentInboxActorName();

    const docUploadOwnerExtra =
      type === 'document_upload' && data && data.documentOwnerStaffId
        ? { documentOwnerStaffId: String(data.documentOwnerStaffId).trim() }
        : {};

    // Stamp the active location on every user-created request so the Inbox
    // can keep it scoped to the branch where it was submitted. Without this
    // the item falls back to the subject staff's allowedLocationIds, which
    // makes requests leak into every branch the staff member is allowed in.
    let activeLocationIdForCreate = null;
    try {
      if (typeof window.ffGetActiveLocationId === 'function') {
        const v = window.ffGetActiveLocationId();
        if (typeof v === 'string' && v.trim()) activeLocationIdForCreate = v.trim();
      }
      if (!activeLocationIdForCreate && typeof window.__ff_active_location_id === 'string' && window.__ff_active_location_id.trim()) {
        activeLocationIdForCreate = window.__ff_active_location_id.trim();
      }
    } catch (_) {}

    const baseDoc = {
      tenantId: salonId,
      locationId: activeLocationIdForCreate,
      type: ffInboxRuleString(type),
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

      const forUidStr = ffInboxRuleString(forUid).trim();
      const forStaffIdStr = ffInboxRuleString(forStaffId);
      const forStaffNameStr = ffInboxRuleString(forStaffName);
      const createdByNameStr = ffInboxRuleString(
        creatorName || inboxState.currentUserProfile.name || inboxState.currentUserProfile.displayName
      );
      const createdByRoleStr = ffInboxRuleString(inboxState.currentUserProfile.role);

      console.log('[Inbox] Sending request: createdByUid=', inboxState.currentUserProfile.uid, 'forUid=', forUidStr, 'forName=', forStaffNameStr);

      if (forUidStr === inboxState.currentUserProfile.uid) {
        showToast('Cannot send a request to yourself', 'error');
        return;
      }

      const requestDoc = {
        ...baseDoc,
        createdByUid: inboxState.currentUserProfile.uid,
        createdByStaffId: creatorStaffId,
        createdByName: createdByNameStr,
        createdByRole: createdByRoleStr,
        forUid: forUidStr,
        forStaffId: forStaffIdStr,
        forStaffName: forStaffNameStr,
        createdAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
        updatedAt: null
      };
      const docRef = await addDoc(collection(db, `salons/${salonId}/inboxItems`), requestDoc);
      console.log('[Inbox] Request created with forUid=', forUidStr, 'docId=', docRef.id);
    } else {
      // Technician creating for self — direct Firestore (forUid = creator)
      const createdByNameStr = ffInboxRuleString(
        creatorName || inboxState.currentUserProfile.name || inboxState.currentUserProfile.displayName
      );
      const createdByRoleStr = ffInboxRuleString(inboxState.currentUserProfile.role);
      const requestDoc = {
        ...baseDoc,
        createdByUid: inboxState.currentUserProfile.uid,
        createdByStaffId: creatorStaffId,
        createdByName: createdByNameStr,
        createdByRole: createdByRoleStr,
        forUid: inboxState.currentUserProfile.uid,
        forStaffId: creatorStaffId,
        forStaffName: createdByNameStr,
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
// Manager Actions (will be Cloud Functions in final version)
// =====================
window.submitStaffReply = async function(requestId) {
  const replyInput = document.getElementById('staffReplyInput');
  const reply = replyInput?.value?.trim();
  if (!reply) { showToast('Please enter a reply', 'error'); return; }

  closeRequestDetailsModal();
  inboxState.currentRequests = inboxState.currentRequests.filter(r => r.id !== requestId);
  renderInboxList();

  try {
    const salonId = inboxState.currentUserProfile.salonId;
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
  inboxState.currentRequests = inboxState.currentRequests.filter(r => r.id !== requestId);
  renderInboxList();

  try {
    const salonId = inboxState.currentUserProfile.salonId;
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
  const request = inboxState.currentRequests.find(r => r.id === requestId);
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
    const salonId = inboxState.currentUserProfile.salonId;
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
      decidedBy: inboxState.currentUserProfile.uid,
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
  inboxState.currentRequests = inboxState.currentRequests.filter(r => r.id !== requestId);
  renderInboxList();
  try {
    const salonId = inboxState.currentUserProfile.salonId;
    await updateDoc(doc(db, `salons/${salonId}/inboxItems`, requestId), {
      status: 'archived',
      decidedBy: inboxState.currentUserProfile.uid,
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
  const salonId = String(p.salonId || inboxState.currentUserProfile?.salonId || '').trim();
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
  if (!rid || !inboxState.currentUserProfile?.salonId) return;
  const salonId = inboxState.currentUserProfile.salonId;
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
        const idx2 = inboxState.currentRequests.findIndex((r) => r.id === rid);
        if (idx2 !== -1) inboxState.currentRequests[idx2] = row;
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
  inboxState.currentRequests = inboxState.currentRequests.filter(r => r.id !== requestId);
  renderInboxList();

  try {
    const salonId = inboxState.currentUserProfile.salonId;
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
        approverUid: inboxState.currentUserProfile.uid,
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
      decidedBy: inboxState.currentUserProfile.uid,
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
  inboxState.currentRequests = inboxState.currentRequests.filter(r => r.id !== requestId);
  renderInboxList();

  try {
    const salonId = inboxState.currentUserProfile.salonId;
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
      decidedBy: inboxState.currentUserProfile.uid,
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

/** Retry path for already-approved supply requests that never hit Inventory. */
window.ffInboxApplySupplyToInventory = async function (requestId, btnEl) {
  try {
    if (!inboxCanManageInbox()) {
      if (typeof showToast === "function") showToast("You do not have permission.", "error");
      return;
    }
    const salonId = inboxState.currentUserProfile?.salonId;
    if (!salonId || !requestId) return;
    if (btnEl instanceof HTMLButtonElement) {
      btnEl.disabled = true;
      btnEl.textContent = "Applying…";
    }
    const snap = await getDoc(doc(db, `salons/${salonId}/inboxItems`, requestId));
    if (!snap.exists()) {
      if (typeof showToast === "function") showToast("Request not found.", "error");
      return;
    }
    const item = snap.data();
    if (String(item.status || "").trim() !== "approved") {
      if (typeof showToast === "function") showToast("Request is not approved yet.", "error");
      return;
    }
    if (item.appliedToInventory === true) {
      if (typeof showToast === "function") showToast("Already applied.", "info");
      if (typeof closeRequestDetailsModal === "function") closeRequestDetailsModal();
      showRequestDetails(requestId);
      return;
    }
    const result = await applyApprovedSupplyRequestToInventory(requestId, item.data || {});
    const n = result && typeof result.totalContributions === "number" ? result.totalContributions : 0;
    if (typeof showToast === "function") {
      showToast(
        n === 1 ? "Added 1 item to inventory Order." : `Added ${n} items to inventory Order.`,
        "success"
      );
    }
    if (typeof closeRequestDetailsModal === "function") closeRequestDetailsModal();
    showRequestDetails(requestId);
  } catch (e) {
    console.error("[Inbox] Apply to Inventory retry failed", e);
    if (btnEl instanceof HTMLButtonElement) {
      btnEl.disabled = false;
      btnEl.textContent = "Apply to Inventory";
    }
    const msg = e && typeof e.message === "string" ? e.message : "Unknown error";
    if (typeof showToast === "function") showToast(`Could not apply: ${msg}`, "error");
  }
};

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
  inboxState.currentRequests = inboxState.currentRequests.filter(r => r.id !== requestId);
  renderInboxList();

  try {
    const salonId = inboxState.currentUserProfile.salonId;
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
    const salonId = inboxState.currentUserProfile.salonId;
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
