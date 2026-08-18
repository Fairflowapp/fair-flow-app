/**
 * Tickets — Navigation (Phase 9a extraction).
 *
 * goToTickets / goToServices: screen-switching entry points that hide the other
 * app screens, activate the Tickets / Services screen, and kick off the relevant
 * data load + render. Verbatim move out of tickets.js; behaviour unchanged.
 *
 * Both are exported (inline) and re-imported by tickets.js so initTickets can keep
 * wiring window.goToTickets / window.goToServices. The window.__ffGoToTicketsReal
 * assignment moves here and runs at module-eval time (same as before).
 *
 * Six tickets.js-resident helpers are injected via initTicketsNav to avoid a cycle:
 *   showToast, loadCurrentUserProfile, enrichTicketsProfileFromMemberDoc,
 *   loadTicketsMembersForAvatars, setupTicketsUI, updateNewTicketButtonVisibility.
 */
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { subscribeTickets, updateTicketsNavBadge } from "./tickets-crud.js?v=20260721_ticket_soft_delete";
import { renderTicketsList } from "./tickets-list.js?v=20260721_ticket_soft_delete";
import { ffCanViewServices, loadServiceCategories, loadServices, loadSharedCatalogForManager, seedSharedServiceCatalogFromLocationCatalogIfEmpty, loadLocationCatalogForManager } from "./tickets-catalog-data.js?v=20260818_service_duration";
import { _ffEnsureCatalogEditorPortal, _ffServicesMobileShowList, renderServicesCatalogV2 } from "./tickets-catalog-ui.js?v=20260818_service_duration";

let showToast, loadCurrentUserProfile, enrichTicketsProfileFromMemberDoc, loadTicketsMembersForAvatars, setupTicketsUI, updateNewTicketButtonVisibility;
export function initTicketsNav(deps) {
  showToast = deps.showToast;
  loadCurrentUserProfile = deps.loadCurrentUserProfile;
  enrichTicketsProfileFromMemberDoc = deps.enrichTicketsProfileFromMemberDoc;
  loadTicketsMembersForAvatars = deps.loadTicketsMembersForAvatars;
  setupTicketsUI = deps.setupTicketsUI;
  updateNewTicketButtonVisibility = deps.updateNewTicketButtonVisibility;
}

// =====================
// Navigation
// =====================
export function goToTickets() {
  const _ticketsLoadState =
    typeof window.ffStaffPermissionLoadState === 'function' ? window.ffStaffPermissionLoadState() : 'ready';
  const _ticketsTrustPerm =
    _ticketsLoadState === 'staff_loading' || _ticketsLoadState === 'staff_unresolved';
  const _ticketsPermOk =
    _ticketsTrustPerm ||
    (typeof window.ffCurrentUserHasTicketsViewPermission === 'function' &&
      window.ffCurrentUserHasTicketsViewPermission());
  if (!_ticketsPermOk) {
    if (typeof window.ffUpdateMainNavTabVisibility === 'function') window.ffUpdateMainNavTabVisibility();
    return;
  }
  try {
    if (typeof window.ffDismissQueueBootSkeleton === 'function') window.ffDismissQueueBootSkeleton();
  } catch (_) {}
  if (typeof window.ffCloseGlobalBlockingOverlays === 'function') {
    try {
      window.ffCloseGlobalBlockingOverlays();
    } catch (e) {}
  }
  if (typeof window.closeStaffMembersModal === 'function') {
    window.closeStaffMembersModal();
  }
  const tasksScreen = document.getElementById('tasksScreen');
  const ownerView = document.getElementById('owner-view');
  const joinBar = document.querySelector('.joinBar');
  const queueControls = document.getElementById('queueControls');
  const userProfileScreen = document.getElementById('userProfileScreen');
  const wrap = document.querySelector('.wrap');
  const inboxScreen = document.getElementById('inboxScreen');
  const chatScreen = document.getElementById('chatScreen');
  const mediaScreen = document.getElementById('mediaScreen');
  const trainingScreen = document.getElementById('trainingScreen');
  const scheduleScreen = document.getElementById('scheduleScreen');
  const timeClockScreenTk = document.getElementById('timeClockScreen');
  const ticketsScreen = document.getElementById('ticketsScreen');
  const servicesScreen = document.getElementById('servicesScreen');

  const manageQueueScreen = document.getElementById('manageQueueScreen');
  [tasksScreen, ownerView, joinBar, queueControls, userProfileScreen, inboxScreen, chatScreen, mediaScreen, trainingScreen, scheduleScreen, timeClockScreenTk, servicesScreen, manageQueueScreen].forEach(el => {
    if (el) el.style.display = 'none';
  });
  if (wrap) wrap.style.display = 'none';

  try {
    if (typeof window.ffSyncShellHeaderInset === 'function') {
      window.ffSyncShellHeaderInset();
    } else {
      const headerEl = document.querySelector('.header');
      if (headerEl) {
        document.documentElement.style.setProperty('--header-h', `${headerEl.offsetHeight}px`);
      }
    }
  } catch (e) {}

  if (ticketsScreen) {
    ticketsScreen.style.display = 'flex';
    ticketsScreen.style.setProperty('pointer-events', 'auto', 'important');
  }

  // When any other nav button is clicked, hide the screen but keep subscription alive
  // so the red Tickets badge updates even while the user is in Queue/Tasks/Chat.
  const NAV_IDS = ['queueBtn','tasksBtn','chatBtn','inboxBtn','logBtn','appsBtn'];
  NAV_IDS.forEach(id => {
    const btn = document.getElementById(id);
    if (btn && !btn._ffTicketsHideHandler) {
      btn._ffTicketsHideHandler = () => {
        if (ticketsScreen) ticketsScreen.style.display = 'none';
        updateTicketsNavBadge();
      };
      btn.addEventListener('click', btn._ffTicketsHideHandler, { capture: true });
    }
  });

  document.querySelectorAll('.btn-pill').forEach(b => b.classList.remove('active'));
  const ticketsBtn = document.getElementById('ticketsBtn');
  if (ticketsBtn && _ticketsPermOk) {
    ticketsBtn.classList.add('active');
  }
  if (typeof window.ffUpdateMainNavTabVisibility === 'function') window.ffUpdateMainNavTabVisibility();
  updateNewTicketButtonVisibility();
  try {
    if (typeof window.ffSyncShellHeaderInset === 'function') window.ffSyncShellHeaderInset();
  } catch (e) {}

  if (ticketsState._ticketsDataReady && ticketsState.currentUserProfile) {
    enrichTicketsProfileFromMemberDoc()
      .then(() => {
        subscribeTickets({ resetLoading: true });
        renderTicketsList();
        updateTicketsNavBadge();
        return setupTicketsUI();
      })
      .then(() => loadTicketsMembersForAvatars())
      .then(() => {
        renderTicketsList();
        updateTicketsNavBadge();
      })
      .catch((err) => {
        console.error('[Tickets] setupTicketsUI failed', err);
      });
  } else {
    loadCurrentUserProfile()
      .then(async () => {
        await enrichTicketsProfileFromMemberDoc();
        subscribeTickets({ resetLoading: true });
        renderTicketsList();
        updateTicketsNavBadge();
        await loadServiceCategories();
        await loadServices();
        await setupTicketsUI();
        ticketsState._ticketsDataReady = true;
        await loadTicketsMembersForAvatars();
        renderTicketsList();
        updateTicketsNavBadge();
      })
      .catch((err) => {
        console.error('[Tickets] goToTickets init failed', err);
      });
  }
}

export async function goToServices() {
  if (!ffCanViewServices()) {
    if (typeof showToast === 'function') showToast('You do not have permission to view Services.', 'error');
    return;
  }
  if (typeof window.ffCloseGlobalBlockingOverlays === 'function') {
    try { window.ffCloseGlobalBlockingOverlays(); } catch (e) {}
  }
  if (typeof window.closeStaffMembersModal === 'function') {
    try { window.closeStaffMembersModal(); } catch (e) {}
  }

  const servicesScreen = document.getElementById('servicesScreen');
  if (!servicesScreen) return;

  [
    'owner-view',
    'ticketsScreen',
    'tasksScreen',
    'chatScreen',
    'inboxScreen',
    'mediaScreen',
    'inventoryScreen',
    'trainingScreen',
    'scheduleScreen',
    'timeClockScreen',
    'pointsAppScreen',
    'userProfileScreen',
    'myProfileScreen',
    'manageQueueScreen',
    'dashboardScreen',
    'queueAnalyticsScreen',
    'ticketsAnalyticsScreen',
    'timeAnalyticsScreen',
    'tasksAnalyticsScreen',
    'historyScreen'
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = 'none';
      el.style.pointerEvents = 'none';
    }
  });
  const joinBar = document.querySelector('.joinBar');
  const wrap = document.querySelector('.wrap');
  const queueControls = document.getElementById('queueControls');
  [joinBar, wrap, queueControls].forEach((el) => {
    if (el) el.style.display = 'none';
  });

  document.querySelectorAll('.btn-pill').forEach((b) => b.classList.remove('active'));
  servicesScreen.style.display = 'block';
  servicesScreen.style.pointerEvents = 'auto';
  _ffEnsureCatalogEditorPortal();
  ticketsState._ffCatalogRenderRootId = 'servicesScreen';
  ticketsState._ffCatalogModalMode = 'shared';
  ticketsState._ffOpenCats.clear();
  ticketsState._ffCatalogRenderedOnce = false;
  // Mobile: always open at the top level (the services list).
  ticketsState._ffSelectedServiceId = null;
  ticketsState._ffSelectedCategoryId = null;
  _ffServicesMobileShowList();

  try {
    if (typeof window.ffSyncShellHeaderInset === 'function') window.ffSyncShellHeaderInset();
  } catch (e) {}

  try {
    await loadCurrentUserProfile();
    await enrichTicketsProfileFromMemberDoc();
    let sharedCatalog = await loadSharedCatalogForManager();
    const backfillResult = await seedSharedServiceCatalogFromLocationCatalogIfEmpty();
    if (backfillResult && backfillResult.seeded) {
      sharedCatalog = await loadSharedCatalogForManager();
      ticketsState._ffCatalogModalMode = 'shared';
    }
    if (!sharedCatalog || ((sharedCatalog.services || []).length === 0 && (sharedCatalog.categories || []).length === 0)) {
      ticketsState._ffCatalogModalMode = 'location';
      await loadLocationCatalogForManager();
    }
    renderServicesCatalogV2();
  } catch (err) {
    console.error('[Services] Failed opening Services screen', err);
    if (typeof showToast === 'function') showToast('Service Catalog is still loading. Try again in a moment.', 'error');
  }
}

try {
  window.__ffGoToTicketsReal = goToTickets;
} catch (e) {}
