// Navigation function to return to Queue view
function goToQueue() {
  try {
    document.body.classList.add('ff-queue-route-active', 'ff-queue-ui-visible', 'ff-ui-ready');
    document.body.classList.remove('ff-auth-resolving', 'ff-staff-members-open', 'ff-dashboard-open', 'ff-dashboard-analytics-open');
  } catch (e) {}
  if (typeof window.ffCloseGlobalBlockingOverlays === 'function') {
    try {
      window.ffCloseGlobalBlockingOverlays();
    } catch (e) {}
  }
  try {
    document.body.classList.add('ff-queue-route-active', 'ff-queue-ui-visible', 'ff-ui-ready');
  } catch (e) {}
  // Close inbox screen if open
  const inboxScreen = document.getElementById('inboxScreen');
  if (inboxScreen) inboxScreen.style.display = 'none';

  // Close training screen if open
  const trainingScreen = document.getElementById('trainingScreen');
  if (trainingScreen) trainingScreen.style.display = 'none';

  // Close chat screen if open
  const chatScreen = document.getElementById('chatScreen');
  if (chatScreen) chatScreen.style.display = 'none';
  
  // Exit reorder mode when navigating to Queue (ensures clean state)
  if (typeof exitReorderMode === 'function' && reorderMode) {
    exitReorderMode();
  }
  
  // ALWAYS close Settings modal if open
  const settingsDlg = document.getElementById('settingsDlg');
  if (settingsDlg && settingsDlg.open) {
    settingsDlg.close();
  }
  
  // Hide History full-screen module if open
  const historyScreenQueue = document.getElementById('historyScreen');
  if (historyScreenQueue) {
    historyScreenQueue.style.display = 'none';
    try {
      if (typeof window.ffCollapseHistoryMobileFiltersPanel === 'function') {
        window.ffCollapseHistoryMobileFiltersPanel();
      }
    } catch (_) {}
  }
  
  // ALWAYS close Tasks modal if open (check for common task modal IDs/classes)
  const tasksModal = document.querySelector('#tasksModal, .tasks-modal');
  if (tasksModal) {
    if (tasksModal.close && typeof tasksModal.close === 'function') {
      tasksModal.close();
    } else {
      tasksModal.classList.add('hidden');
      tasksModal.style.display = 'none';
    }
  }
  
  // ALWAYS hide TASKS screen - regardless of current state
  const tasksScreen = document.getElementById('tasksScreen');
  if (tasksScreen) {
    tasksScreen.style.display = 'none';
    tasksScreen.style.pointerEvents = 'none';
  }
  
  // Hide User Profile screen if visible
  const userProfileScreen = document.getElementById('userProfileScreen');
  if (userProfileScreen) {
    userProfileScreen.style.display = 'none';
  }

  const myProfileScreenQueue = document.getElementById('myProfileScreen');
  if (myProfileScreenQueue) {
    myProfileScreenQueue.style.display = 'none';
  }
  
  // Hide Media screen if visible
  const mediaScreen = document.getElementById('mediaScreen');
  if (mediaScreen) {
    mediaScreen.style.display = 'none';
  }

  const inventoryScreenQueue = document.getElementById('inventoryScreen');
  if (inventoryScreenQueue) {
    inventoryScreenQueue.style.display = 'none';
  }

  const floorScreenQueue = document.getElementById('floorScreen');
  if (floorScreenQueue) {
    floorScreenQueue.style.display = 'none';
  }

  const pointsAppScreenQueue = document.getElementById('pointsAppScreen');
  if (pointsAppScreenQueue) {
    pointsAppScreenQueue.style.display = 'none';
  }

  // Must hide every screen that ffIsFullscreenModuleCoveringQueue() treats as "covering" the queue;
  // otherwise ffApplyQueueViewGate() defers restoring #joinBar + .wrap and the queue stays blank.
  const ticketsScreenQueue = document.getElementById('ticketsScreen');
  if (ticketsScreenQueue) ticketsScreenQueue.style.display = 'none';
  const servicesScreenQueue = document.getElementById('servicesScreen');
  if (servicesScreenQueue) servicesScreenQueue.style.display = 'none';
  const productsScreenQueue = document.getElementById('productsScreen');
  if (productsScreenQueue) productsScreenQueue.style.display = 'none';
  const scheduleScreenQueue = document.getElementById('scheduleScreen');
  if (scheduleScreenQueue) scheduleScreenQueue.style.display = 'none';
  const timeClockScreenQueue = document.getElementById('timeClockScreen');
  if (timeClockScreenQueue) timeClockScreenQueue.style.display = 'none';
  ['dashboardScreen','queueAnalyticsScreen','ticketsAnalyticsScreen','timeAnalyticsScreen','tasksAnalyticsScreen']
    .forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  
  // Hide Manage Queue screen if visible
  const manageQueueScreen = document.getElementById('manageQueueScreen');
  if (manageQueueScreen) {
    manageQueueScreen.style.display = 'none';
  }
  
  // Close Staff Members if open
  if (typeof closeStaffMembersModal === 'function') {
    closeStaffMembersModal();
  }

  // Close Apps panel overlay - same z-index issue as Inbox (backdrop can block main UI)
  try {
    var _appsBd = document.getElementById('appsOverlayBackdrop');
    var _appsPn = document.getElementById('appsPanel');
    if (_appsBd) _appsBd.style.display = 'none';
    if (_appsPn) _appsPn.style.display = 'none';
  } catch (e) {}
  
  // ALWAYS show owner-view shell; queue lists + join row gated by queue_view or join-only partial
  const ownerView = document.getElementById('owner-view');
  if (ownerView) {
    ownerView.style.display = 'block';
    ownerView.style.visibility = 'visible';
  }
  // Mobile: open Queue with filter "All" so compact dropdown + lists stay in sync
  try {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches) {
      window._ffQueueFilter = 'all';
    }
  } catch (e) {}
  ffApplyQueueViewGate();

  // Show/hide Queue management controls (ffApplyQueueViewGate already calls this when allowed; repeat for consistency)
  updateQueueManagementUiVisibility();

  if (typeof renderSelect === 'function') {
    renderSelect();
  }

  // Initialize Manage Queue button handler if needed
  const manageQueueBtn = document.getElementById('manageQueueBtn');
  if (manageQueueBtn) {
    if (!manageQueueBtn.hasAttribute('data-handler-attached')) {
      manageQueueBtn.setAttribute('data-handler-attached', 'true');
      manageQueueBtn.onclick = function(e) {
        e.preventDefault();
        openManageQueue();
      };
    }
  }
  
  // Initialize back button handler
  const manageQueueBackBtn = document.getElementById('manageQueueBackBtn');
  if (manageQueueBackBtn && !manageQueueBackBtn.hasAttribute('data-handler-attached')) {
    manageQueueBackBtn.setAttribute('data-handler-attached', 'true');
    manageQueueBackBtn.onclick = function(e) {
      e.preventDefault();
      closeManageQueue();
    };
  }
  
  // Update active state for navigation tabs (highlight Queue if full or join-only queue access)
  document.querySelectorAll('.btn-pill').forEach(b => b.classList.remove('active'));
  var queueNavEl = document.getElementById('queueBtn');
  if (queueNavEl && typeof ffCurrentUserHasQueueScreenAccess === 'function' && ffCurrentUserHasQueueScreenAccess()) {
    queueNavEl.classList.add('active');
  }
  if (typeof ffUpdateMainNavTabVisibility === 'function') ffUpdateMainNavTabVisibility();

  // Show queue filter bar
  if (typeof ffRenderQueueFilterChips === 'function') ffRenderQueueFilterChips();
  if (typeof renderQueue === 'function') renderQueue();
  if (typeof renderService === 'function') renderService();
  if (typeof window.ffSyncJoinMoreToggle === 'function') window.ffSyncJoinMoreToggle();

  // iOS route recovery: after leaving another fixed module, a stale display:none can leave Queue blank.
  const restoreQueueChrome = function() {
    try {
      document.body.classList.add('ff-queue-route-active', 'ff-queue-ui-visible', 'ff-ui-ready');
      const allowed =
        (typeof ffCurrentUserHasQueueScreenAccess === 'function' && ffCurrentUserHasQueueScreenAccess()) ||
        (typeof ffCurrentUserHasQueueViewPermission === 'function' && ffCurrentUserHasQueueViewPermission()) ||
        (typeof ffCurrentUserIsQueueJoinOnlyPartialAccess === 'function' && ffCurrentUserIsQueueJoinOnlyPartialAccess()) ||
        (typeof ffCurrentUserHasQueueLockedViewPermission === 'function' && ffCurrentUserHasQueueLockedViewPermission());
      if (!allowed) return;
      if (typeof ffIsFullscreenModuleCoveringQueue === 'function' && ffIsFullscreenModuleCoveringQueue()) return;
      const ov = document.getElementById('owner-view');
      const jb = document.getElementById('joinBar');
      const wr = document.querySelector('.wrap');
      const qc = document.getElementById('queueControls');
      if (ov) {
        ov.style.setProperty('display', 'block', 'important');
        ov.style.setProperty('visibility', 'visible', 'important');
      }
      if (jb) {
        jb.style.setProperty('display', 'flex', 'important');
        jb.style.setProperty('visibility', 'visible', 'important');
      }
      if (wr) {
        wr.style.setProperty('display', 'block', 'important');
        wr.style.setProperty('visibility', 'visible', 'important');
      }
      if (qc) {
        qc.style.setProperty('visibility', 'visible', 'important');
      }
      if (typeof updateQueueManagementUiVisibility === 'function') updateQueueManagementUiVisibility();
      if (typeof window.ffSyncJoinMoreToggle === 'function') window.ffSyncJoinMoreToggle();
      if (typeof window.ffSyncMobileBottomNavViewportLock === 'function') window.ffSyncMobileBottomNavViewportLock();
      if (typeof renderQueue === 'function') renderQueue();
      if (typeof renderService === 'function') renderService();
    } catch (e) {}
  };
  requestAnimationFrame(function() {
    restoreQueueChrome();
    if (typeof window.ffSyncMobileBottomNavViewportLock === 'function') window.ffSyncMobileBottomNavViewportLock();
    setTimeout(restoreQueueChrome, 120);
    setTimeout(function () {
      if (typeof window.ffSyncMobileBottomNavViewportLock === 'function') window.ffSyncMobileBottomNavViewportLock();
    }, 180);
  });

  try {
    if (typeof window.ffSyncShellHeaderInset === 'function') {
      window.ffSyncShellHeaderInset();
    }
    if (typeof ffMarkUiReady === 'function' && document.body && !document.body.classList.contains('ff-logged-out')) {
      if (!document.body.classList.contains('ff-queue-ui-visible')) {
        ffMarkUiReady();
      }
    }
  } catch (e) {}
}

function goToFloor() {
  if (typeof window.ffCloseGlobalBlockingOverlays === 'function') {
    try { window.ffCloseGlobalBlockingOverlays(); } catch (e) {}
  }
  if (typeof window.closeStaffMembersModal === 'function') window.closeStaffMembersModal();

  try {
    document.body.classList.remove('ff-queue-route-active', 'ff-queue-ui-visible', 'ff-staff-members-open', 'ff-dashboard-open', 'ff-dashboard-analytics-open');
    document.body.classList.add('ff-ui-ready');
    if (typeof window.ffDismissQueueBootSkeleton === 'function') window.ffDismissQueueBootSkeleton();
  } catch (e) {}

  const screenIdsToHide = [
    'owner-view',
    'tasksScreen',
    'chatScreen',
    'inboxScreen',
    'mediaScreen',
    'ticketsScreen',
    'servicesScreen',
    'productsScreen',
    'trainingScreen',
    'scheduleScreen',
    'timeClockScreen',
    'inventoryScreen',
    'pointsAppScreen',
    'userProfileScreen',
    'myProfileScreen',
    'manageQueueScreen',
    'historyScreen',
    'dashboardScreen',
    'queueAnalyticsScreen',
    'ticketsAnalyticsScreen',
    'timeAnalyticsScreen',
    'tasksAnalyticsScreen'
  ];
  screenIdsToHide.forEach(function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'none';
    if (el.style.pointerEvents) el.style.pointerEvents = 'none';
  });

  ['joinBar', 'joinError', 'queueControls'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const wrap = document.querySelector('.wrap');
  if (wrap) wrap.style.display = 'none';

  const floorScreen = document.getElementById('floorScreen');
  if (floorScreen) {
    floorScreen.style.display = 'flex';
    floorScreen.style.pointerEvents = 'auto';
  }

  try {
    const appsBackdrop = document.getElementById('appsOverlayBackdrop');
    const appsPanel = document.getElementById('appsPanel');
    if (appsBackdrop) appsBackdrop.style.display = 'none';
    if (appsPanel) appsPanel.style.display = 'none';
  } catch (e) {}

  document.querySelectorAll('.btn-pill').forEach(function (b) { b.classList.remove('active'); });
  const floorNavBtn = document.getElementById('floorBtn');
  if (floorNavBtn) floorNavBtn.classList.add('active');
  document.querySelectorAll('.apps-panel-item').forEach(function (item) {
    item.classList.toggle('is-active', item.getAttribute('data-app') === 'floor');
  });
  if (typeof window.ffApplyFloorPermissionUi === 'function') window.ffApplyFloorPermissionUi();
  if (typeof window.ffSetFloorTab === 'function') window.ffSetFloorTab('open', { silent: true });
  if (typeof window.ffUpdateMobileHeaderTitle === 'function') window.ffUpdateMobileHeaderTitle();
}
window.goToFloor = goToFloor;

function ffHideFloorScreenForNavigation() {
  const floorOrderModal = document.getElementById('floorOrderModal');
  if (floorOrderModal) floorOrderModal.style.display = 'none';
  const floorScreen = document.getElementById('floorScreen');
  if (floorScreen) {
    floorScreen.style.display = 'none';
    floorScreen.style.pointerEvents = 'none';
  }
  const floorNavBtn = document.getElementById('floorBtn');
  if (floorNavBtn) floorNavBtn.classList.remove('active');
  document.querySelectorAll('.apps-panel-item[data-app="floor"]').forEach(function (item) {
    item.classList.remove('is-active');
  });
}
window.ffHideFloorScreenForNavigation = ffHideFloorScreenForNavigation;

function ffBindFloorNavigationExitGuards() {
  [
    'queueBtn',
    'ticketsBtn',
    'tasksBtn',
    'chatBtn',
    'inboxBtn',
    'mediaBtn',
    'inventoryNavBtn',
    'scheduleBtn',
    'trainingBtn'
  ].forEach(function (id) {
    const btn = document.getElementById(id);
    if (!btn || btn.__ffFloorNavigationExitGuardBound) return;
    btn.__ffFloorNavigationExitGuardBound = true;
    btn.addEventListener('click', function () {
      if (id !== 'floorBtn') ffHideFloorScreenForNavigation();
    }, true);
  });
}
ffBindFloorNavigationExitGuards();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ffBindFloorNavigationExitGuards, { once: true });
}

function ffSetFloorTab(tab, options) {
  const canReceive = typeof window.ffCurrentUserCanReceiveFloorOrders === 'function'
    ? window.ffCurrentUserCanReceiveFloorOrders()
    : true;
  const activeTab = tab === 'closed' && canReceive ? 'closed' : 'open';
  document.querySelectorAll('[data-floor-tab]').forEach(function (btn) {
    const isActive = btn.getAttribute('data-floor-tab') === activeTab;
    btn.classList.toggle('active', isActive);
  });
  const emptyTitle = document.getElementById('floorEmptyTitle');
  const emptyDesc = document.getElementById('floorEmptyDesc');
  const demoGrid = document.getElementById('floorDemoGrid');
  const emptyState = document.getElementById('floorEmptyState');
  if (demoGrid) demoGrid.style.display = 'grid';
  if (emptyState) emptyState.style.display = activeTab === 'closed' ? 'flex' : 'none';
  if (emptyTitle) emptyTitle.textContent = activeTab === 'closed' ? 'No closed floor orders yet' : 'No open floor orders yet';
  if (emptyDesc) emptyDesc.textContent = activeTab === 'closed'
    ? 'Closed floor orders will appear here later.'
    : 'New floor orders will appear here in a later phase.';
  if (!(options && options.silent)) {
    try { window.__ffFloorActiveTab = activeTab; } catch (e) {}
  }
  if (typeof window.ffRenderFloorOrders === 'function') window.ffRenderFloorOrders();
}
window.ffSetFloorTab = ffSetFloorTab;

function ffApplyFloorPermissionUi() {
  const canSend = typeof window.ffCurrentUserCanSendFloorOrders === 'function'
    ? window.ffCurrentUserCanSendFloorOrders()
    : true;
  const canReceive = typeof window.ffCurrentUserCanReceiveFloorOrders === 'function'
    ? window.ffCurrentUserCanReceiveFloorOrders()
    : true;
  const canManage = typeof window.ffCurrentUserCanManageFloorSettings === 'function'
    ? window.ffCurrentUserCanManageFloorSettings()
    : true;
  const newBtn = document.getElementById('floorNewBtn');
  if (newBtn) newBtn.style.display = canSend ? 'flex' : 'none';
  const settingsBtn = document.getElementById('floorSettingsGearBtn');
  if (settingsBtn) settingsBtn.style.display = canManage ? 'flex' : 'none';
  const closedTab = document.querySelector('[data-floor-tab="closed"]');
  if (closedTab) closedTab.style.display = canReceive ? '' : 'none';
  const openTab = document.querySelector('[data-floor-tab="open"]');
  if (openTab && !canReceive && canSend) openTab.classList.add('active');
  const ordersList = document.getElementById('floorOrdersList');
  if (ordersList) ordersList.style.display = (canReceive || canSend) ? '' : 'none';
  if (!canReceive && window.__ffFloorActiveTab === 'closed') {
    try { window.__ffFloorActiveTab = 'open'; } catch (e) {}
  }
}
window.ffApplyFloorPermissionUi = ffApplyFloorPermissionUi;
document.addEventListener('ff-staff-cloud-updated', function () {
  if (typeof window.ffApplyFloorPermissionUi === 'function') window.ffApplyFloorPermissionUi();
  if (typeof window.ffRenderFloorOrders === 'function') window.ffRenderFloorOrders();
});

function ffOpenFloorOrderModal() {
  if (typeof window.ffCurrentUserCanSendFloorOrders === 'function' && !window.ffCurrentUserCanSendFloorOrders()) return;
  const modal = document.getElementById('floorOrderModal');
  if (!modal) return;
  window.__ffFloorSelectedOrderRequest = null;
  const clientInput = document.getElementById('floorOrderClientNameInput');
  if (clientInput) clientInput.value = '';
  if (typeof window.ffRenderFloorOrderPicker === 'function') window.ffRenderFloorOrderPicker();
  modal.style.display = 'flex';
  if (clientInput) {
    try { clientInput.focus(); } catch (e) {}
  } else {
    const firstToggle = modal.querySelector('[data-floor-order-category-toggle]');
    if (firstToggle) {
      try { firstToggle.focus(); } catch (e) {}
    }
  }
}
window.ffOpenFloorOrderModal = ffOpenFloorOrderModal;

function ffCloseFloorOrderModal() {
  const modal = document.getElementById('floorOrderModal');
  if (modal) modal.style.display = 'none';
  const clientInput = document.getElementById('floorOrderClientNameInput');
  if (clientInput) clientInput.value = '';
}
window.ffCloseFloorOrderModal = ffCloseFloorOrderModal;

function ffOpenFloorSettingsModal() {
  if (typeof window.ffCurrentUserCanManageFloorSettings === 'function' && !window.ffCurrentUserCanManageFloorSettings()) return;
  const modal = document.getElementById('floorSettingsModal');
  if (!modal) return;
  modal.style.display = 'flex';
  if (typeof window.ffFloorRefreshCategoryOptions === 'function') window.ffFloorRefreshCategoryOptions();
  if (typeof window.ffFloorSettingsTab === 'function') window.ffFloorSettingsTab('regular');
}
window.ffOpenFloorSettingsModal = ffOpenFloorSettingsModal;

function ffCloseFloorSettingsModal() {
  const modal = document.getElementById('floorSettingsModal');
  if (modal) modal.style.display = 'none';
}
window.ffCloseFloorSettingsModal = ffCloseFloorSettingsModal;

function ffFloorSettingsTab(tab) {
  const activeTab = tab === 'flow' ? 'flow' : (tab === 'categories' ? 'categories' : 'regular');
  document.querySelectorAll('.floor-settings-tab').forEach(function (btn) {
    btn.classList.toggle('active', btn.getAttribute('data-floor-settings-tab') === activeTab);
  });
  const regularPane = document.getElementById('floorSettingsRegularPane');
  const flowPane = document.getElementById('floorSettingsFlowPane');
  const categoriesPane = document.getElementById('floorSettingsCategoriesPane');
  if (regularPane) regularPane.style.display = activeTab === 'regular' ? 'flex' : 'none';
  if (flowPane) flowPane.style.display = activeTab === 'flow' ? 'flex' : 'none';
  if (categoriesPane) categoriesPane.style.display = activeTab === 'categories' ? 'flex' : 'none';
  if (typeof window.ffFloorRefreshCategoryOptions === 'function') window.ffFloorRefreshCategoryOptions();
  if (activeTab === 'flow') {
    if (typeof window.ffFloorFlowEnsureBuilder === 'function') {
      window.ffFloorFlowEnsureBuilder();
    } else {
      import('/floor-flows.js?v=20260616_floor_flow_save_state_fix').then(function () {
        if (typeof window.ffFloorFlowEnsureBuilder === 'function') window.ffFloorFlowEnsureBuilder();
      }).catch(function (err) {
        console.warn('[Floor] Could not load Floor Flow builder UI', err);
      });
    }
  }
}
window.ffFloorSettingsTab = ffFloorSettingsTab;

function ffFloorEscapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function ffFloorGetCategories() {
  if (!Array.isArray(window.__ffFloorCategories)) {
    window.__ffFloorCategories = [];
  }
  return window.__ffFloorCategories;
}
window.ffFloorGetCategories = ffFloorGetCategories;

function ffFloorIconButton(kind, onClick, label) {
  const isDelete = kind === 'delete';
  const color = isDelete ? '#dc2626' : '#7c3aed';
  const svg = isDelete
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path></svg>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
  return '<button type="button" onclick="' + onClick + '" title="' + label + '" aria-label="' + label + '" style="border:0;background:transparent;color:' + color + ';display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;padding:0;">' + svg + '</button>';
}

function ffFloorGetRegularRequests() {
  if (!Array.isArray(window.__ffFloorRegularRequests)) {
    window.__ffFloorRegularRequests = [];
  }
  return window.__ffFloorRegularRequests;
}
window.ffFloorGetRegularRequests = ffFloorGetRegularRequests;

function ffFloorRefreshRegularRequests() {
  const list = document.getElementById('floorRegularRequestsList');
  if (!list) return;
  const requests = ffFloorGetRegularRequests();
  if (!requests.length) {
    list.innerHTML = '<div style="padding:14px;color:#9ca3af;font-size:13px;">No regular requests yet.</div>';
    return;
  }
  list.innerHTML = requests.map(function (item, idx) {
    return '<div style="display:grid;grid-template-columns:minmax(150px,1fr) minmax(130px,1fr) 72px;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#111827;">'
      + '<div style="font-weight:600;">' + ffFloorEscapeHtml(item.name) + '</div>'
      + '<div style="color:#6b7280;">' + ffFloorEscapeHtml(item.category) + '</div>'
      + '<div style="display:flex;gap:6px;justify-content:flex-end;">'
      + ffFloorIconButton('edit', 'window.ffEditFloorRegularRequestUiOnly && window.ffEditFloorRegularRequestUiOnly(' + idx + ')', 'Edit request')
      + ffFloorIconButton('delete', 'window.ffDeleteFloorRegularRequestUiOnly && window.ffDeleteFloorRegularRequestUiOnly(' + idx + ')', 'Delete request')
      + '</div>'
      + '</div>';
  }).join('');
}
window.ffFloorRefreshRegularRequests = ffFloorRefreshRegularRequests;

function ffAddFloorRegularRequestUiOnly() {
  const nameInput = document.getElementById('floorRegularRequestNameInput');
  const categoryInput = document.getElementById('floorRegularCategoryInput');
  const name = (nameInput && nameInput.value ? nameInput.value : '').trim();
  const category = (categoryInput && categoryInput.value ? categoryInput.value : '').trim();
  if (!name) return;
  ffFloorGetRegularRequests().push({ name: name, category: category || '' });
  if (nameInput) nameInput.value = '';
  if (categoryInput) categoryInput.value = '';
  ffFloorRefreshRegularRequests();
}
window.ffAddFloorRegularRequestUiOnly = ffAddFloorRegularRequestUiOnly;

function ffEditFloorRegularRequestUiOnly(idx) {
  const requests = ffFloorGetRegularRequests();
  const current = requests[idx];
  if (!current) return;
  const name = prompt('Edit request name', current.name);
  if (name === null || !name.trim()) return;
  const category = prompt('Edit category', current.category || '');
  if (category === null) return;
  requests[idx] = { name: name.trim(), category: category.trim() || '' };
  ffFloorRefreshRegularRequests();
}
window.ffEditFloorRegularRequestUiOnly = ffEditFloorRegularRequestUiOnly;

function ffDeleteFloorRegularRequestUiOnly(idx) {
  const requests = ffFloorGetRegularRequests();
  if (!requests[idx]) return;
  requests.splice(idx, 1);
  ffFloorRefreshRegularRequests();
}
window.ffDeleteFloorRegularRequestUiOnly = ffDeleteFloorRegularRequestUiOnly;

function ffFloorOrderGroups() {
  const categories = ffFloorGetCategories();
  const regularRequests = ffFloorGetRegularRequests().map(function (item) {
    return { id: item.id, name: item.name, category: item.category, kind: 'regular' };
  });
  const flowRequests = (Array.isArray(window.__ffFloorFlowDocs) ? window.__ffFloorFlowDocs : []).map(function (item) {
    return { id: item.id, name: item.title || 'Untitled flow', category: item.category || '', kind: 'flow', steps: Array.isArray(item.steps) ? item.steps : [] };
  });
  const requests = regularRequests.concat(flowRequests);
  const categoryNames = categories.slice();
  requests.forEach(function (item) {
    const category = String(item.category || '').trim();
    if (category && !categoryNames.some(function (existing) { return existing === category; })) {
      categoryNames.push(category);
    }
  });
  return categoryNames.map(function (category) {
    return {
      category: category,
      requests: requests.filter(function (item) {
        return String(item.category || '') === String(category || '');
      })
    };
  });
}

function ffFloorOrderFlowRunnerHtml(item) {
  const state = window.__ffFloorOrderFlowState || {};
  if (!item || item.kind !== 'flow') return '';
  if (state.loading && state.flowId === item.id) {
    return '<div style="margin-top:8px;padding:12px;border:1px dashed #ddd6fe;border-radius:10px;color:#7c3aed;font-size:12px;background:#faf5ff;">Loading flow questions...</div>';
  }
  if (state.error && state.flowId === item.id) {
    return '<div style="margin-top:8px;padding:12px;border:1px solid #fecaca;border-radius:10px;color:#b91c1c;font-size:12px;background:#fef2f2;">Could not load this flow. Try again.</div>';
  }
  const draft = state.flowId === item.id && state.draft
    ? state.draft
    : (Array.isArray(item.steps) && item.steps.length ? { steps: item.steps } : null);
  if (!draft || !Array.isArray(draft.steps) || !draft.steps.length) {
    return '<div style="margin-top:8px;padding:12px;border:1px dashed #d1d5db;border-radius:10px;color:#9ca3af;font-size:12px;background:#fff;">This flow has no questions configured yet. Edit it in Floor Settings - Flow Requests.</div>';
  }
  const answers = Array.isArray(state.answers) ? state.answers : [];
  const answersSummary = answers.length
    ? '<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px;">'
      + answers.map(function (answer) {
        return '<div style="display:flex;align-items:flex-start;gap:6px;font-size:11px;color:#6b7280;background:#fff;border:1px solid #ede9fe;border-radius:8px;padding:6px 8px;">'
          + '<span style="color:#7c3aed;font-weight:800;">✓</span>'
          + '<span><strong style="color:#374151;">' + ffFloorEscapeHtml(answer.question || 'Question') + ':</strong> ' + ffFloorEscapeHtml(answer.answer || '') + '</span>'
          + '</div>';
      }).join('')
      + '</div>'
    : '';
  if (state.completed) {
    return '<div style="margin-top:8px;padding:12px;border:1px solid #bbf7d0;border-radius:10px;background:#ecfdf5;">'
      + answersSummary
      + '<div style="color:#047857;font-size:12px;font-weight:700;">Flow complete. You can send this floor order.</div>'
      + '</div>';
  }
  const currentStep = draft.steps.find(function (step) {
    return String(step.id) === String(state.currentStepId);
  }) || draft.steps[0];
  const options = Array.isArray(currentStep.options) ? currentStep.options : [];
  const answersHtml = options.length
    ? options.map(function (option, idx) {
      const isChosen = String(state.lastSelectedStepId || '') === String(currentStep.id) && state.lastSelectedOptionIdx === idx;
      return '<button type="button" onclick="event.stopPropagation(); window.ffFloorOrderSelectFlowAnswer && window.ffFloorOrderSelectFlowAnswer(' + idx + ')" style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid ' + (isChosen ? '#7c3aed' : '#e5e7eb') + ';background:' + (isChosen ? '#f5f3ff' : '#fff') + ';color:#111827;border-radius:9px;padding:9px 10px;font-size:12px;font-weight:600;cursor:pointer;text-align:left;">'
        + '<span>'
        + ffFloorEscapeHtml(option.label || 'Answer')
        + '</span>'
        + (isChosen ? '<span style="font-size:10px;color:#7c3aed;font-weight:800;">Selected</span>' : '')
        + '</button>';
    }).join('')
    : '<div style="color:#9ca3af;font-size:12px;">No answers in this question.</div>';
  return '<div style="margin-top:8px;padding:12px;border:1px solid #ddd6fe;border-radius:12px;background:#faf5ff;">'
    + answersSummary
    + '<div style="font-size:11px;font-weight:800;color:#7c3aed;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;">Flow Question</div>'
    + '<div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:10px;">' + ffFloorEscapeHtml(currentStep.prompt || 'Question') + '</div>'
    + '<div style="display:flex;flex-direction:column;gap:7px;">' + answersHtml + '</div>'
    + '</div>';
}
window.ffFloorOrderFlowRunnerHtml = ffFloorOrderFlowRunnerHtml;

function ffRenderFloorOrderPicker() {
  const list = document.getElementById('floorOrderCategoryList');
  const sendBtn = document.getElementById('floorSendOrderBtn');
  if (!list) return;
  const groups = ffFloorOrderGroups();
  const selected = window.__ffFloorSelectedOrderRequest || null;
  const hasContent = groups.some(function (group) { return group.requests.length > 0; });
  if (!groups.length || !hasContent) {
    list.innerHTML = '<div style="padding:18px;border:1px dashed #d1d5db;border-radius:14px;color:#9ca3af;font-size:13px;text-align:center;">No floor requests yet. Add Categories and Regular Requests in Floor Settings first.</div>';
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.style.opacity = '0.5';
      sendBtn.style.cursor = 'not-allowed';
    }
    return;
  }
  if (typeof window.__ffFloorOpenOrderCategoryIdx !== 'number' && groups[0]) {
    window.__ffFloorOpenOrderCategoryIdx = 0;
  }
  list.innerHTML = groups.map(function (group, groupIdx) {
    const isOpen = window.__ffFloorOpenOrderCategoryIdx === groupIdx;
    const safeCategory = ffFloorEscapeHtml(group.category);
    const requestsHtml = group.requests.length
      ? group.requests.map(function (item, idx) {
        const requestKey = group.category + '::' + item.kind + '::' + item.name + '::' + idx;
        const isSelected = selected && selected.key === requestKey;
        return '<div>'
          + '<button type="button" aria-pressed="' + (isSelected ? 'true' : 'false') + '" onclick="window.ffSelectFloorOrderRequestByIdx && window.ffSelectFloorOrderRequestByIdx(' + groupIdx + ',' + idx + ')" style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid ' + (isSelected ? '#7c3aed' : '#e5e7eb') + ';background:' + (isSelected ? '#f5f3ff' : '#fff') + ';color:#111827;border-radius:10px;padding:10px 12px;font-size:13px;font-weight:600;cursor:pointer;text-align:left;">'
          + '<span style="display:flex;align-items:center;gap:8px;"><span>' + ffFloorEscapeHtml(item.name) + '</span><span style="font-size:10px;color:' + (item.kind === 'flow' ? '#7c3aed' : '#6b7280') + ';background:' + (item.kind === 'flow' ? '#f5f3ff' : '#f9fafb') + ';border:1px solid ' + (item.kind === 'flow' ? '#ddd6fe' : '#e5e7eb') + ';border-radius:999px;padding:2px 6px;font-weight:700;">' + (item.kind === 'flow' ? 'Flow' : 'Regular') + '</span></span>'
          + (isSelected ? '<span style="font-size:11px;color:#7c3aed;font-weight:700;">Selected</span>' : '')
          + '</button>'
          + (isSelected && item.kind === 'flow' ? ffFloorOrderFlowRunnerHtml(item) : '')
          + '</div>';
      }).join('')
      : '<div style="padding:10px 12px;color:#9ca3af;font-size:12px;">No requests in this category yet.</div>';
    return '<div style="border:1px solid #e5e7eb;border-radius:14px;background:#fff;overflow:hidden;">'
      + '<button type="button" data-floor-order-category-toggle="' + groupIdx + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '" onclick="window.ffToggleFloorOrderCategory && window.ffToggleFloorOrderCategory(' + groupIdx + ')" style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;border:0;background:#f9fafb;color:#111827;padding:12px 14px;font-size:13px;font-weight:700;cursor:pointer;text-align:left;">'
      + '<span>' + safeCategory + '</span>'
      + '<span aria-hidden="true" style="color:#7c3aed;font-size:14px;">' + (isOpen ? '^' : 'v') + '</span>'
      + '</button>'
      + '<div style="display:' + (isOpen ? 'flex' : 'none') + ';flex-direction:column;gap:8px;padding:10px;background:#fff;">' + requestsHtml + '</div>'
      + '</div>';
  }).join('');
  if (sendBtn) {
    const flowState = window.__ffFloorOrderFlowState || {};
    const flowReady = selected && selected.kind === 'flow'
      ? flowState.flowId === selected.id && flowState.completed === true
      : true;
    const canSend = !!selected && flowReady;
    sendBtn.disabled = !canSend;
    sendBtn.style.opacity = canSend ? '1' : '0.5';
    sendBtn.style.cursor = canSend ? 'pointer' : 'not-allowed';
  }
}
window.ffRenderFloorOrderPicker = ffRenderFloorOrderPicker;

function ffToggleFloorOrderCategory(idx) {
  window.__ffFloorOpenOrderCategoryIdx = window.__ffFloorOpenOrderCategoryIdx === idx ? -1 : idx;
  ffRenderFloorOrderPicker();
}
window.ffToggleFloorOrderCategory = ffToggleFloorOrderCategory;

async function ffSelectFloorOrderRequestByIdx(groupIdx, requestIdx) {
  const groups = ffFloorOrderGroups();
  const group = groups[groupIdx];
  const item = group && group.requests && group.requests[requestIdx];
  if (!group || !item) return;
  window.__ffFloorSelectedOrderRequest = {
    key: group.category + '::' + item.kind + '::' + item.name + '::' + requestIdx,
    id: item.id || '',
    name: item.name,
    category: group.category,
    kind: item.kind
  };
  ffRenderFloorOrderPicker();
  if (item.kind === 'flow') {
    if (Array.isArray(item.steps) && item.steps.length) {
      window.__ffFloorOrderFlowState = {
        flowId: item.id,
        loading: false,
        completed: false,
        draft: { steps: item.steps },
        currentStepId: item.steps[0].id,
        answers: []
      };
      ffRenderFloorOrderPicker();
      return;
    }
    window.__ffFloorOrderFlowState = { flowId: item.id, loading: true, completed: false, draft: null, currentStepId: null };
    ffRenderFloorOrderPicker();
    try {
      const draft = typeof window.ffFloorLoadFlowTreeForOrder === 'function'
        ? await window.ffFloorLoadFlowTreeForOrder(item.id)
        : null;
      const firstStep = draft && Array.isArray(draft.steps) ? draft.steps[0] : null;
      window.__ffFloorOrderFlowState = {
        flowId: item.id,
        loading: false,
        completed: false,
        draft: draft,
        currentStepId: firstStep ? firstStep.id : null,
        answers: []
      };
    } catch (err) {
      console.warn('[Floor] load order flow failed', err);
      window.__ffFloorOrderFlowState = { flowId: item.id, loading: false, error: true, completed: false };
    }
    ffRenderFloorOrderPicker();
  } else {
    window.__ffFloorOrderFlowState = null;
  }
}
window.ffSelectFloorOrderRequestByIdx = ffSelectFloorOrderRequestByIdx;

function ffFloorOrderSelectFlowAnswer(optionIdx) {
  const state = window.__ffFloorOrderFlowState || {};
  const draft = state.draft;
  if (!draft || !Array.isArray(draft.steps)) return;
  const currentStep = draft.steps.find(function (step) {
    return String(step.id) === String(state.currentStepId);
  }) || draft.steps[0];
  const option = currentStep && currentStep.options && currentStep.options[optionIdx];
  if (!option) return;
  const nextStepId = option.nextStepId || option.nextQuestionId || option.nextId || option.nextStep || null;
  state.answers = Array.isArray(state.answers) ? state.answers : [];
  const existingCurrentIdx = state.answers.findIndex(function (answer) {
    return answer.questionId === currentStep.id;
  });
  if (existingCurrentIdx >= 0) {
    state.answers = state.answers.slice(0, existingCurrentIdx);
  }
  state.answers.push({
    questionId: currentStep.id,
    question: currentStep.prompt || '',
    optionId: option.id || '',
    answer: option.label || '',
    nextStepId: nextStepId || null
  });
  state.lastSelectedStepId = currentStep.id;
  state.lastSelectedOptionIdx = optionIdx;
  window.__ffFloorOrderDraft = {
    selectedRequest: window.__ffFloorSelectedOrderRequest || null,
    answers: state.answers.slice(),
    completed: !nextStepId
  };
  if (nextStepId) {
    state.currentStepId = nextStepId;
    state.lastSelectedStepId = null;
    state.lastSelectedOptionIdx = null;
    state.completed = false;
  } else {
    state.completed = true;
  }
  window.__ffFloorOrderFlowState = state;
  ffRenderFloorOrderPicker();
}
window.ffFloorOrderSelectFlowAnswer = ffFloorOrderSelectFlowAnswer;

function ffFloorRefreshCategoryOptions() {
  const categories = ffFloorGetCategories();
  const selectOptions = '<option value="">Choose from Categories</option>' + categories.map(function (name) {
    return '<option value="' + ffFloorEscapeHtml(name) + '">' + ffFloorEscapeHtml(name) + '</option>';
  }).join('');
  const datalist = document.getElementById('floorCategorySuggestions');
  if (datalist) {
    datalist.innerHTML = categories.map(function (name) {
      return '<option value="' + ffFloorEscapeHtml(name) + '"></option>';
    }).join('');
  }
  ['floorRegularCategoryInput', 'floorFlowCategory'].forEach(function (id) {
    const select = document.getElementById(id);
    if (!select || String(select.tagName || '').toLowerCase() !== 'select') return;
    const current = select.value;
    select.innerHTML = selectOptions;
    if (current && categories.some(function (name) { return name === current; })) {
      select.value = current;
    }
  });
  const list = document.getElementById('floorCategoriesList');
  if (list) {
    if (!categories.length) {
      list.innerHTML = '<div style="padding:14px;color:#9ca3af;font-size:13px;">No categories yet.</div>';
    } else {
    list.innerHTML = categories.map(function (name, idx) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 14px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#111827;">'
        + '<span style="font-weight:600;">' + ffFloorEscapeHtml(name) + '</span>'
        + '<span style="display:flex;gap:6px;align-items:center;">'
        + ffFloorIconButton('edit', 'window.ffEditFloorCategoryUiOnly && window.ffEditFloorCategoryUiOnly(' + idx + ')', 'Edit category')
        + ffFloorIconButton('delete', 'window.ffDeleteFloorCategoryUiOnly && window.ffDeleteFloorCategoryUiOnly(' + idx + ')', 'Delete category')
        + '</span>'
        + '</div>';
    }).join('');
    }
  }
  ffFloorRefreshRegularRequests();
}
window.ffFloorRefreshCategoryOptions = ffFloorRefreshCategoryOptions;

function ffEditFloorCategoryUiOnly(idx) {
  const categories = ffFloorGetCategories();
  const current = categories[idx];
  if (!current) return;
  const next = prompt('Edit category name', current);
  if (next === null) return;
  const name = next.trim();
  if (!name) return;
  categories[idx] = name;
  ffFloorRefreshCategoryOptions();
}
window.ffEditFloorCategoryUiOnly = ffEditFloorCategoryUiOnly;

function ffDeleteFloorCategoryUiOnly(idx) {
  const categories = ffFloorGetCategories();
  if (!categories[idx]) return;
  categories.splice(idx, 1);
  ffFloorRefreshCategoryOptions();
}
window.ffDeleteFloorCategoryUiOnly = ffDeleteFloorCategoryUiOnly;

function ffAddFloorCategoryUiOnly() {
  const input = document.getElementById('floorNewCategoryName');
  const name = (input && input.value ? input.value : '').trim();
  if (!name) return;
  const categories = ffFloorGetCategories();
  const exists = categories.some(function (category) {
    return category.toLowerCase() === name.toLowerCase();
  });
  if (!exists) categories.push(name);
  if (input) input.value = '';
  ffFloorRefreshCategoryOptions();
  if (typeof window.ffToast === 'object' && window.ffToast && typeof window.ffToast.show === 'function') {
    window.ffToast.show('Category added locally for this UI preview only.', { variant: 'info', durationMs: 2200 });
  }
}
window.ffAddFloorCategoryUiOnly = ffAddFloorCategoryUiOnly;

function ffCreateFloorOrderPlaceholder() {
  const selected = window.__ffFloorSelectedOrderRequest || null;
  if (!selected) {
    if (typeof window.ffToast === 'object' && window.ffToast && typeof window.ffToast.show === 'function') {
      window.ffToast.show('Choose a floor request first.', { variant: 'info', durationMs: 2000 });
    }
    return;
  }
  if (selected.kind === 'flow') {
    const flowState = window.__ffFloorOrderFlowState || {};
    if (flowState.flowId !== selected.id || flowState.completed !== true) {
      if (typeof window.ffToast === 'object' && window.ffToast && typeof window.ffToast.show === 'function') {
        window.ffToast.show('Complete the flow questions first.', { variant: 'info', durationMs: 2200 });
      }
      return;
    }
  }
  if (typeof window.ffSendFloorOrder === 'function') {
    const clientNameInput = document.getElementById('floorOrderClientNameInput');
    const clientName = clientNameInput ? String(clientNameInput.value || '').trim() : '';
    Promise.resolve(window.ffSendFloorOrder(selected, window.__ffFloorOrderFlowState || {}, { clientName: clientName })).then(function (sent) {
      if (sent) ffCloseFloorOrderModal();
    });
    return;
  }
  if (typeof window.ffToast === 'object' && window.ffToast && typeof window.ffToast.show === 'function') {
    window.ffToast.show('Floor order sender is still loading. Try again in a moment.', { variant: 'info', durationMs: 2200 });
  }
}
window.ffCreateFloorOrderPlaceholder = ffCreateFloorOrderPlaceholder;

/**
 * Time Clock - full-screen route (peer to Schedule / Tasks). Not part of Settings.
 */
function goToTimeClock() {
  try {
    if (typeof window.ffDismissQueueBootSkeleton === 'function') window.ffDismissQueueBootSkeleton();
  } catch (_) {}
  if (typeof window.ffCloseGlobalBlockingOverlays === 'function') {
    try { window.ffCloseGlobalBlockingOverlays(); } catch (e) {}
  }
  if (typeof window.closeStaffMembersModal === 'function') window.closeStaffMembersModal();
  // Time Clock is now a PIN-gated kiosk: anyone at the screen can clock in/out
  // by entering their own PIN, so the current account does NOT need to be
  // linked to a staff profile. The Manage view is still admin/owner only and
  // is gated inside the renderer.
  // Ensure admin status is resolved so the "Manage Time Cards" link is
  // rendered on first paint for owner/admin accounts.
  try {
    if (window.ff_is_admin_cached === null && typeof window.isCurrentUserOwner === 'function') {
      window.isCurrentUserOwner().then((isAdmin) => {
        window.ff_is_admin_cached = isAdmin === true;
        if (document.getElementById('timeClockScreen')
            && document.getElementById('timeClockScreen').style.display !== 'none'
            && typeof window.ffInitTimeClockUI === 'function'
            && window.__ffTCState && window.__ffTCState.view === 'clock') {
          window.ffInitTimeClockUI();
        }
      }).catch(() => {});
    }
  } catch (_) {}
  if (window.__ffTCState) {
    // Always enter through the PIN view - never land straight in Confirm.
    if (window.__ffTCState.view !== 'manage') window.__ffTCState.view = 'clock';
    window.__ffTCState.confirmStaff = null;
    window.__ffTCState.confirmOpenEntry = null;
  }
  const screenIds = [
    'tasksScreen', 'inboxScreen', 'chatScreen', 'mediaScreen', 'ticketsScreen', 'servicesScreen', 'productsScreen', 'trainingScreen',
    'userProfileScreen', 'myProfileScreen', 'manageQueueScreen', 'scheduleScreen', 'inventoryScreen', 'pointsAppScreen',
    'historyScreen'
  ];
  screenIds.forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const ownerView = document.getElementById('owner-view');
  const joinBar = document.getElementById('joinBar');
  const queueControls = document.getElementById('queueControls');
  const wrap = document.querySelector('.wrap');
  if (ownerView) ownerView.style.display = 'none';
  if (joinBar) joinBar.style.display = 'none';
  if (queueControls) queueControls.style.display = 'none';
  if (wrap) wrap.style.display = 'none';
  const screen = document.getElementById('timeClockScreen');
  if (screen) screen.style.display = 'flex';
  document.querySelectorAll('.btn-pill').forEach(function (b) { b.classList.remove('active'); });
  const tcb = document.getElementById('timeClockBtn');
  if (tcb) tcb.classList.add('active');
  if (typeof window.ffInitTimeClockUI === 'function') window.ffInitTimeClockUI();
  if (typeof window.ffUpdateMobileHeaderTitle === 'function') window.ffUpdateMobileHeaderTitle();
}
window.goToTimeClock = goToTimeClock;

function hideTimeClockScreen() {
  const s = document.getElementById('timeClockScreen');
  if (s) s.style.display = 'none';
  const tcb = document.getElementById('timeClockBtn');
  if (tcb) tcb.classList.remove('active');
  if (typeof window.ffUpdateMobileHeaderTitle === 'function') window.ffUpdateMobileHeaderTitle();
  if (window.__ffTCClockTick) { try { clearInterval(window.__ffTCClockTick); } catch (e) {} window.__ffTCClockTick = null; }
  if (window.__ffTCKbHandler) { try { document.removeEventListener('keydown', window.__ffTCKbHandler); } catch (e) {} window.__ffTCKbHandler = null; }
  if (window.__ffTCMgEscHandler) { try { document.removeEventListener('keydown', window.__ffTCMgEscHandler); } catch (e) {} window.__ffTCMgEscHandler = null; }
}
window.hideTimeClockScreen = hideTimeClockScreen;

// Training Library (MVP): local state only, no Firestore yet.
const trainingItems = [];
let selectedTrainingItemId = null;
let editingTrainingItemId = null;
let trainingDraftBlocks = [];
let trainingDraftQuizQuestions = [];
let trainingLoading = false;
let trainingError = '';
let trainingSearchQuery = '';
let trainingCategoryFilter = 'all';
let trainingRoleFilter = 'all';
let trainingRequiredFilter = 'all';
let trainingViewMode = 'all';
let trainingProgressMap = {};
let trainingReportsMode = 'library';
let trainingReportsSubMode = 'byTraining';
let trainingAllProgressList = [];
let trainingVideoProgressMap = {};
let trainingVideoProgressCache = {};
let trainingQuizDraftAnswers = {};
let trainingReminderSendState = {};
let trainingNotificationsList = [];
let trainingNotificationsByTrainingId = {};
let trainingNotificationsUnsub = null;
let trainingNotificationsSubKey = '';
let trainingNotificationToastStateById = {};
let trainingNotificationsPrimed = false;
let trainingItemsUnsub = null;
let trainingItemsSubKey = '';
let trainingItemsLoadedOnce = false;

const FF_TRAINING_TOAST_SEEN_STORAGE_KEY = 'ff_training_notification_toasts_seen_v2';
const FF_TRAINING_TOAST_MAX_AGE_MS = 10 * 60 * 1000;

function getSeenTrainingToastKeys() {
  let values = [];
  try {
    const raw = localStorage.getItem(FF_TRAINING_TOAST_SEEN_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      values = parsed.map((id) => String(id || '')).filter(Boolean);
    }
  } catch (_) { values = []; }
  if (!values.length) {
    try {
      const legacy = sessionStorage.getItem('ff_training_notification_toasts_seen_v1');
      const parsedLegacy = legacy ? JSON.parse(legacy) : [];
      if (Array.isArray(parsedLegacy)) {
        values = parsedLegacy.map((id) => String(id || '')).filter(Boolean);
      }
    } catch (_) {}
  }
  return values;
}

function getTrainingToastSeenKey(notification) {
  const id = String(notification?.id || '').trim();
  const version = getSortTime(notification?.updatedAt || notification?.createdAt);
  return id ? `${id}:${version}` : '';
}

function markTrainingToastSeen(notification) {
  const seenKey = getTrainingToastSeenKey(notification);
  if (!seenKey) return;
  const next = Array.from(new Set([...getSeenTrainingToastKeys(), seenKey].filter(Boolean))).slice(-500);
  try { localStorage.setItem(FF_TRAINING_TOAST_SEEN_STORAGE_KEY, JSON.stringify(next)); } catch (_) {}
}

function markManyTrainingToastsSeen(notifications) {
  if (!Array.isArray(notifications) || !notifications.length) return;
  const current = new Set(getSeenTrainingToastKeys());
  notifications.forEach((n) => {
    const k = getTrainingToastSeenKey(n);
    if (k) current.add(k);
  });
  const next = Array.from(current).slice(-500);
  try { localStorage.setItem(FF_TRAINING_TOAST_SEEN_STORAGE_KEY, JSON.stringify(next)); } catch (_) {}
}

async function waitForTrainingSalonId(maxWaitMs = 10000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < maxWaitMs) {
    const salonId = String((typeof window !== 'undefined' ? window.currentSalonId : '') || '').trim();
    if (salonId) return salonId;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return String((typeof window !== 'undefined' ? window.currentSalonId : '') || '').trim();
}

async function ffMaybeConsumePendingTrainingDeepLink() {
  var id = String((typeof window !== 'undefined' && window.__ffPendingTrainingDeepLinkId) || '').trim();
  if (!id) return;
  if (window.__ffTrainingDeepLinkConsumeInFlight === true) return;
  if (typeof document !== 'undefined' && document.body && document.body.classList.contains('ff-logged-out')) return;
  if (window.__ff_waiting_for_salon_choice === true) return;

  window.__ffTrainingDeepLinkConsumeInFlight = true;
  try {
    var salonId = await waitForTrainingSalonId(15000);
    if (!salonId) return;
    if (typeof goToTraining === 'function') await goToTraining();
    var found = typeof trainingItems !== 'undefined' && Array.isArray(trainingItems)
      ? trainingItems.some(function (x) { return String(x && x.id || '') === id; })
      : false;
    if (!found) return;
    if (typeof openTrainingDetails === 'function') await openTrainingDetails(id);
    window.__ffPendingTrainingDeepLinkId = '';
  } catch (eDl) {
    console.warn('[Training] Deep-link consume failed', eDl);
  } finally {
    window.__ffTrainingDeepLinkConsumeInFlight = false;
  }
}

function resolveCurrentTrainingStaffRecord() {
  const authUser =
    (window.auth && window.auth.currentUser) ||
    (window.ffAuth && window.ffAuth.currentUser) ||
    null;
  const directStaffId = String(
    window.__ff_authedStaffId ||
    (typeof localStorage !== 'undefined' ? localStorage.getItem('ff_authedStaffId_v1') : null) ||
    ''
  ).trim();
  const directName = String(
    window.__ff_authedStaffName ||
    (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('ff_actor_name') : null) ||
    ''
  ).trim();
  const authEmail = String(
    (window.ffCurrentUser && window.ffCurrentUser.email) ||
    (window.ffAuth && window.ffAuth.currentUser && window.ffAuth.currentUser.email) ||
    (window.auth && window.auth.currentUser && window.auth.currentUser.email) ||
    ''
  ).trim().toLowerCase();
  if (typeof window.ffGetStaffStore !== 'function') {
    return directStaffId ? { id: directStaffId, name: directName || '', email: authEmail || '' } : null;
  }
  try {
    const staffStore = window.ffGetStaffStore();
    const staffList = Array.isArray(staffStore?.staff) ? staffStore.staff : [];
    let currentStaff = null;

    if (directStaffId) {
      const byId = staffList.find((staff) => String(staff?.id || staff?.staffId || '').trim() === directStaffId) || null;
      const linkageConflict =
        byId &&
        authUser &&
        typeof ffStaffRowAuthLinkageConflicts === 'function' &&
        ffStaffRowAuthLinkageConflicts(byId, authUser);
      if (byId && !linkageConflict) {
        return byId;
      }
      // Stale ff_authedStaffId_v1, wrong row, or id not yet in store — resolve by Auth below (avoids staffNotifications permission-denied).
    }

    if (authUser && typeof ffStaffRowMatchesAuthUid === 'function') {
      const uid = String(authUser.uid || '').trim();
      if (uid) {
        currentStaff = staffList.find((s) => s != null && ffStaffRowMatchesAuthUid(s, uid)) || null;
      }
    }
    if (!currentStaff && authEmail) {
      currentStaff = staffList.find((staff) => String(staff?.email || '').trim().toLowerCase() === authEmail) || null;
    }
    if (!currentStaff && directName) {
      const normalizedName = directName.toLowerCase();
      currentStaff = staffList.find((staff) => String(staff?.name || staff?.fullName || '').trim().toLowerCase() === normalizedName) || null;
    }
    if (currentStaff?.id) {
      if (typeof ffSyncAuthedStaffIdFromRow === 'function') {
        ffSyncAuthedStaffIdFromRow(currentStaff);
      } else {
        window.__ff_authedStaffId = currentStaff.id;
        try {
          localStorage.setItem('ff_authedStaffId_v1', currentStaff.id);
        } catch (_) {}
      }
    }
    if (currentStaff?.name && !window.__ff_authedStaffName) {
      window.__ff_authedStaffName = currentStaff.name;
    }
    if (currentStaff) return currentStaff;

    if (directStaffId) return { id: directStaffId, name: directName || '', email: authEmail || '' };
    return null;
  } catch (err) {
    console.warn('[Training] Failed resolving current staff record', err);
    return directStaffId ? { id: directStaffId, name: directName || '', email: authEmail || '' } : null;
  }
}

function getCurrentTrainingStaffId() {
  return String(resolveCurrentTrainingStaffRecord()?.id || '').trim();
}

function toLabel(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

async function getTrainingFirestoreApi() {
  if (window.__trainingFirestoreApi) return window.__trainingFirestoreApi;
  const m = await import("https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js");
  window.__trainingFirestoreApi = m;
  return m;
}

function getTrainingDb() {
  if (window.db) return window.db;
  if (window.ffDb) return window.ffDb;
  throw new Error('Firestore is not initialized yet.');
}

function getCurrentTrainingSalonId() {
  const salonId = (typeof window !== 'undefined' && window.currentSalonId)
    ? String(window.currentSalonId).trim()
    : '';
  if (!salonId) throw new Error('Missing salonId');
  return salonId;
}

async function ensureTechnicianTypesForTraining() {
  let role = String(
    window.__ff_user_role ||
    window.__ff_actorRole ||
    sessionStorage.getItem('ff_actor_role') ||
    ''
  ).toLowerCase().trim();
  const staffId = window.__ff_authedStaffId || localStorage.getItem('ff_authedStaffId_v1') || '';
  const isTechnicianRole = role === 'tech' || role === 'staff' || role === 'technician';
  const needsStaffFetch = (isTechnicianRole || !role) && staffId;
  if (!needsStaffFetch) return;
  try {
    const salonId = getCurrentTrainingSalonId();
    const db = getTrainingDb();
    const { doc, getDoc } = await getTrainingFirestoreApi();
    if (staffId) {
      const staffRef = doc(db, 'salons', salonId, 'staff', staffId);
      const snap = await getDoc(staffRef);
      if (snap.exists()) {
        const data = snap.data() || {};
        const types = Array.isArray(data.technicianTypes) ? data.technicianTypes : [];
        window.__ff_authedTechnicianTypes = types;
        try { sessionStorage.setItem('ff_authed_technician_types', JSON.stringify(types)); } catch (_) {}
        if (!role && String(data.role || '').toLowerCase() === 'technician') {
          role = 'technician';
          window.__ff_actorRole = 'Tech';
          try { sessionStorage.setItem('ff_actor_role', 'Tech'); } catch (_) {}
        }
      }
    }
  } catch (_) {}
}

function getSortTime(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function mapTrainingItemDoc(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    salonId: data.salonId || '',
    title: data.title || '',
    category: data.category || '',
    description: data.description || '',
    visibleToRoles: Array.isArray(data.visibleToRoles) ? data.visibleToRoles : [],
    technicianTypes: Array.isArray(data.technicianTypes) ? data.technicianTypes : [],
    // locationIds: empty array or missing = visible at ALL locations (legacy
    // trainings have no locationIds field and should remain visible everywhere).
    // Non-empty array = visible only at the listed locations.
    locationIds: Array.isArray(data.locationIds)
      ? data.locationIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [],
    required: data.required === true,
    contentBlocks: Array.isArray(data.contentBlocks) ? data.contentBlocks : [],
    quizQuestions: Array.isArray(data.quizQuestions) ? data.quizQuestions : [],
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
  };
}

function replaceTrainingItems(rows) {
  const nextRows = Array.isArray(rows) ? [...rows] : [];
  nextRows.sort((a, b) => getSortTime(b.updatedAt) - getSortTime(a.updatedAt));
  trainingItems.splice(0, trainingItems.length, ...nextRows);
  trainingItemsLoadedOnce = true;
}

function hasTrainingItem(trainingId) {
  const key = String(trainingId || '').trim();
  return !!trainingItems.find((item) => String(item?.id || '').trim() === key);
}

function shouldDisplayTrainingNotification(notification) {
  if (!notification) return false;
  if (!trainingItemsLoadedOnce) return true;
  if (!hasTrainingItem(notification.trainingId)) return false;
  // Suppress notifications for trainings that are scoped to a different
  // location than the one the user is currently viewing. The notification
  // row still exists in Firestore (it was valid at send time), but we hide
  // it from the bell/badge so the count matches what the user can actually
  // see in the library.
  const item = trainingItems.find((t) => t.id === notification.trainingId);
  if (!item || !isTrainingVisibleAtCurrentLocation(item)) return false;
  /* Technicians see only "My" trainings (role + technician type). The Apps
     badge must use the same gate or they see "1" with an empty Library. */
  const userCtx = getCurrentTrainingUserContext();
  if (!isTrainingRelevantToCurrentUser(item, userCtx)) return false;
  return true;
}

function isTrainingNotificationNew(notification) {
  return !!notification && shouldDisplayTrainingNotification(notification) && !notification.openedAt;
}

async function fetchTrainingItems() {
  const salonId = getCurrentTrainingSalonId();
  const db = getTrainingDb();
  const { collection, query, where, getDocs } = await getTrainingFirestoreApi();
  const snap = await getDocs(query(collection(db, 'trainingItems'), where('salonId', '==', salonId)));
  return snap.docs.map(mapTrainingItemDoc).sort((a, b) => getSortTime(b.updatedAt) - getSortTime(a.updatedAt));
}

async function createTrainingItem(data) {
  const salonId = getCurrentTrainingSalonId();
  const db = getTrainingDb();
  const { collection, addDoc, serverTimestamp } = await getTrainingFirestoreApi();
  const docRef = await addDoc(collection(db, 'trainingItems'), {
    salonId,
    title: data.title,
    category: data.category,
    description: data.description || '',
    visibleToRoles: Array.isArray(data.visibleToRoles) ? data.visibleToRoles : [],
    technicianTypes: Array.isArray(data.technicianTypes) ? data.technicianTypes : [],
    locationIds: Array.isArray(data.locationIds) ? data.locationIds : [],
    required: data.required === true,
    contentBlocks: Array.isArray(data.contentBlocks) ? data.contentBlocks : [],
    quizQuestions: Array.isArray(data.quizQuestions) ? data.quizQuestions : [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

async function updateTrainingItem(id, data) {
  const salonId = getCurrentTrainingSalonId();
  const db = getTrainingDb();
  const { doc, getDoc, updateDoc, serverTimestamp } = await getTrainingFirestoreApi();
  const ref = doc(db, 'trainingItems', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Training item not found.');
  if (String(snap.data()?.salonId || '') !== salonId) throw new Error('Item does not belong to current salon.');
  await updateDoc(ref, {
    title: data.title,
    category: data.category,
    description: data.description || '',
    visibleToRoles: Array.isArray(data.visibleToRoles) ? data.visibleToRoles : [],
    technicianTypes: Array.isArray(data.technicianTypes) ? data.technicianTypes : [],
    locationIds: Array.isArray(data.locationIds) ? data.locationIds : [],
    required: data.required === true,
    contentBlocks: Array.isArray(data.contentBlocks) ? data.contentBlocks : [],
    quizQuestions: Array.isArray(data.quizQuestions) ? data.quizQuestions : [],
    updatedAt: serverTimestamp(),
  });
  return id;
}

function getTrainingNotificationDocId(trainingId, staffId) {
  const safe = (value) => String(value || '').replace(/[\/\\?#\[\]]+/g, '_');
  return `training_assigned_${safe(trainingId)}_${safe(staffId)}`;
}

function normalizeTrainingTechnicianTypes(types) {
  return Array.isArray(types)
    ? types.map((t) => String(t || '').toLowerCase().trim()).filter(Boolean)
    : [];
}

function getTrainingNotificationMessage(notification) {
  if (!notification) return '';
  if (notification.required === true && !notification.completedAt && notification.read === true) {
    return 'Required training pending';
  }
  return notification.required === true ? 'New required training assigned' : 'New training available';
}

function mapTrainingNotificationDoc(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    type: String(data.type || 'training_assigned'),
    trainingId: String(data.trainingId || '').trim(),
    trainingTitle: String(data.trainingTitle || '').trim(),
    forStaffId: String(data.forStaffId || '').trim(),
    read: data.read === true,
    required: data.required === true,
    createdAt: data.createdAt || null,
    openedAt: data.openedAt || null,
    completedAt: data.completedAt || null,
    updatedAt: data.updatedAt || null,
  };
}

function cacheTrainingNotifications(list) {
  trainingNotificationsList = Array.isArray(list) ? [...list] : [];
  trainingNotificationsList.sort((a, b) => getSortTime(b.createdAt) - getSortTime(a.createdAt));
  trainingNotificationsByTrainingId = {};
  trainingNotificationsList.forEach((notification) => {
    if (!notification?.trainingId) return;
    const current = trainingNotificationsByTrainingId[notification.trainingId];
    if (!current || getSortTime(notification.createdAt) >= getSortTime(current.createdAt)) {
      trainingNotificationsByTrainingId[notification.trainingId] = notification;
    }
  });
}

function getTrainingNotificationForItem(trainingId) {
  return trainingNotificationsByTrainingId[String(trainingId || '').trim()] || null;
}

function updateLocalTrainingNotification(trainingId, updates) {
  const key = String(trainingId || '').trim();
  if (!key) return;
  let changed = false;
  const next = trainingNotificationsList.map((notification) => {
    if (String(notification?.trainingId || '').trim() !== key) return notification;
    changed = true;
    return { ...notification, ...updates };
  });
  if (!changed) return;
  cacheTrainingNotifications(next);
  renderTrainingAppsBadge();
  renderTrainingNotificationSummary();
  const trainingScreen = document.getElementById('trainingScreen');
  const libraryView = document.getElementById('trainingLibraryView');
  if (trainingScreen && trainingScreen.style.display !== 'none' && libraryView && libraryView.style.display !== 'none') {
    renderTrainingLibrary();
  }
}

function renderTrainingAppsBadge() {
  const badge = document.getElementById('trainingAppsBadge');
  if (!badge) return;
  const uniqueNotifications = Object.values(trainingNotificationsByTrainingId || {});
  const newCount = uniqueNotifications.filter((notification) => isTrainingNotificationNew(notification)).length;
  if (newCount > 0) {
    badge.textContent = newCount > 99 ? '99+' : String(newCount);
    badge.style.display = 'inline-flex';
  } else {
    badge.textContent = '';
    badge.style.display = 'none';
  }
}

function renderTrainingNotificationSummary() {
  const wrap = document.getElementById('trainingNotificationSummary');
  if (!wrap) return;
  wrap.style.display = 'none';
  wrap.innerHTML = '';
}

function showTrainingAssignmentToast(notification) {
  if (!notification || notification.read === true) return;
  // Apply the same per-location gate we use for the badge count.
  // Without this, a multi-location staff member on location A would get a
  // visible toast for a training scoped to location B (even though the badge
  // correctly hides it). We only check trainings that are already loaded -
  // otherwise we let the toast through, and the "mark seen" step below
  // prevents repeat toasts once the items catch up.
  if (trainingItemsLoadedOnce && !shouldDisplayTrainingNotification(notification)) {
    return;
  }
  const seenKey = getTrainingToastSeenKey(notification);
  if (!seenKey) return;
  const seen = new Set(getSeenTrainingToastKeys());
  if (seen.has(seenKey)) return;
  markTrainingToastSeen(notification);
  const container = document.getElementById('chatToastContainer');
  const title = String(notification.trainingTitle || 'Training').trim() || 'Training';
  const senderLine = notification.required === true && !notification.completedAt
    ? 'Training · Required'
    : 'Training';
  const previewText = notification.required === true && !notification.completedAt
    ? `Please complete training: ${title}`
    : `New training available: ${title}`;
  if (!container) {
    if (typeof showToast === 'function') showToast(previewText, 7000);
    return;
  }
  const toast = document.createElement('div');
  toast.className = 'chat-toast';
  toast.setAttribute('data-training-id', String(notification.trainingId || ''));
  const header = document.createElement('div');
  header.className = 'chat-toast-header';
  const sender = document.createElement('div');
  sender.className = 'chat-toast-sender';
  sender.textContent = senderLine;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'chat-toast-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  header.appendChild(sender);
  header.appendChild(closeBtn);
  const preview = document.createElement('div');
  preview.className = 'chat-toast-preview';
  preview.textContent = previewText;
  toast.appendChild(header);
  toast.appendChild(preview);
  let timeoutId = null;
  const dismiss = () => {
    if (timeoutId) clearTimeout(timeoutId);
    toast.classList.add('chat-toast-dismissing');
    setTimeout(() => toast.remove(), 220);
  };
  const openTraining = async () => {
    dismiss();
    if (typeof goToTraining === 'function') await goToTraining();
    if (typeof openTrainingDetails === 'function') await openTrainingDetails(notification.trainingId);
  };
  if (closeBtn) closeBtn.onclick = (e) => { e.stopPropagation(); dismiss(); };
  toast.onclick = () => openTraining();
  container.appendChild(toast);
  timeoutId = setTimeout(dismiss, 9000);
}

function stopTrainingNotificationsSubscription() {
  if (typeof trainingNotificationsUnsub === 'function') {
    try { trainingNotificationsUnsub(); } catch (_) {}
  }
  trainingNotificationsUnsub = null;
  trainingNotificationsSubKey = '';
  trainingNotificationToastStateById = {};
  trainingNotificationsPrimed = false;
}

function stopTrainingItemsSubscription() {
  if (typeof trainingItemsUnsub === 'function') {
    try { trainingItemsUnsub(); } catch (_) {}
  }
  trainingItemsUnsub = null;
  trainingItemsSubKey = '';
}

// Re-render the Training Library whenever the user switches locations, so
// location-scoped trainings appear/disappear immediately. This listener is
// installed once on first subscription setup - subsequent calls are no-ops
// thanks to the `__ff_training_loc_listener_installed` flag.
function _ffInstallTrainingLocationListener() {
  if (typeof document === 'undefined') return;
  if (window.__ff_training_loc_listener_installed === true) return;
  window.__ff_training_loc_listener_installed = true;
  document.addEventListener('ff-active-location-changed', () => {
    try {
      const trainingScreen = document.getElementById('trainingScreen');
      if (trainingScreen && trainingScreen.style.display !== 'none') {
        const detailsView = document.getElementById('trainingDetailsView');
        const reportsView = document.getElementById('trainingReportsView');
        const reportDetailsView = document.getElementById('trainingReportDetailsView');
        if (detailsView && detailsView.style.display !== 'none' && selectedTrainingItemId && hasTrainingItem(selectedTrainingItemId)) {
          const item = trainingItems.find((entry) => entry.id === selectedTrainingItemId);
          // If the now-active location hides the currently-open training,
          // fall back to the library view instead of showing stale details.
          if (item && isTrainingVisibleAtCurrentLocation(item)) {
            renderTrainingDetails(item);
          } else {
            selectedTrainingItemId = null;
            if (typeof renderTrainingLibrary === 'function') renderTrainingLibrary();
          }
        } else if (reportDetailsView && reportDetailsView.style.display !== 'none') {
          // We're deep inside a training's report details. Bounce back to the
          // reports list so users don't see stale cross-branch completion
          // data when they switch locations.
          reportDetailsView.style.display = 'none';
          if (reportsView) reportsView.style.display = 'block';
          if (typeof renderTrainingReports === 'function') renderTrainingReports();
        } else if (reportsView && reportsView.style.display !== 'none') {
          if (typeof renderTrainingReports === 'function') renderTrainingReports();
        } else if (typeof renderTrainingLibrary === 'function') {
          renderTrainingLibrary();
        }
      }
      renderTrainingAppsBadge();
      renderTrainingNotificationSummary();
    } catch (err) {
      console.warn('[Training] location-change re-render failed', err);
    }
  });
}

async function ensureTrainingItemsSubscription() {
  const salonId = await waitForTrainingSalonId();
  if (!salonId) {
    console.warn('[Training] Items subscription skipped: salonId not ready');
    return;
  }
  _ffInstallTrainingLocationListener();
  if (trainingItemsSubKey === salonId && typeof trainingItemsUnsub === 'function') return;
  stopTrainingItemsSubscription();
  const db = getTrainingDb();
  const { collection, query, where, onSnapshot } = await getTrainingFirestoreApi();
  trainingItemsSubKey = salonId;
  trainingItemsUnsub = onSnapshot(
    query(collection(db, 'trainingItems'), where('salonId', '==', salonId)),
    (snap) => {
      replaceTrainingItems(snap.docs.map(mapTrainingItemDoc));
      if (selectedTrainingItemId && !hasTrainingItem(selectedTrainingItemId)) {
        selectedTrainingItemId = null;
      }
      const trainingScreen = document.getElementById('trainingScreen');
      if (trainingScreen && trainingScreen.style.display !== 'none') {
        const detailsView = document.getElementById('trainingDetailsView');
        if (detailsView && detailsView.style.display !== 'none' && selectedTrainingItemId && hasTrainingItem(selectedTrainingItemId)) {
          const item = trainingItems.find((entry) => entry.id === selectedTrainingItemId);
          if (item) renderTrainingDetails(item);
        } else if (typeof renderTrainingLibrary === 'function') {
          renderTrainingLibrary();
        }
      }
      renderTrainingAppsBadge();
      renderTrainingNotificationSummary();
    },
    (err) => {
      console.error('[Training] trainingItems snapshot error', err);
    }
  );
}

async function ensureTrainingNotificationsSubscription() {
  const salonId = await waitForTrainingSalonId();
  if (!salonId) {
    console.warn('[Training] Notifications subscription skipped: salonId not ready');
    return;
  }
  const staffId = String(getCurrentTrainingStaffId() || '').trim();
  if (!staffId) {
    console.warn('[Training] Notifications subscription skipped: staffId not ready');
    return;
  }
  /* Avoid permission-denied when ff_authedStaffId exists before ff_staff_v1 sync (rules need a row linked to Auth). */
  const authUser =
    (window.auth && window.auth.currentUser) ||
    (window.ffAuth && window.ffAuth.currentUser) ||
    null;
  if (authUser && typeof ffResolveCurrentStaffRowFromFfStaffV1 === 'function') {
    const row = ffResolveCurrentStaffRowFromFfStaffV1();
    const resolvedId = String((row && (row.id || row.staffId)) || '').trim();
    if (!resolvedId || resolvedId !== staffId) {
      console.warn('[Training] Notifications subscription deferred: staff row not aligned with session yet', {
        staffId,
        resolvedStaffId: resolvedId || null,
      });
      return;
    }
  }
  const subKey = `${salonId}__${staffId}`;
  if (trainingNotificationsSubKey === subKey && typeof trainingNotificationsUnsub === 'function') return;
  stopTrainingNotificationsSubscription();
  const db = getTrainingDb();
  const { collection, query, where, onSnapshot } = await getTrainingFirestoreApi();
  trainingNotificationsSubKey = subKey;
  trainingNotificationsUnsub = onSnapshot(
    query(
      collection(db, 'salons', salonId, 'staffNotifications'),
      where('forStaffId', '==', staffId)
    ),
    (snap) => {
      const list = snap.docs.map(mapTrainingNotificationDoc);
      cacheTrainingNotifications(list);
      renderTrainingAppsBadge();
      renderTrainingNotificationSummary();
      if (!trainingNotificationsPrimed) {
        markManyTrainingToastsSeen(list);
        list.forEach((notification) => {
          if (notification?.id) trainingNotificationToastStateById[notification.id] = notification;
        });
        trainingNotificationsPrimed = true;
        return;
      }
      const nowMs = Date.now();
      snap.docChanges().forEach((change) => {
        const notification = mapTrainingNotificationDoc(change.doc);
        const prev = trainingNotificationToastStateById[notification.id] || null;
        const prevTime = getSortTime(prev?.updatedAt || prev?.createdAt);
        const nextTime = getSortTime(notification.updatedAt || notification.createdAt);
        const becameUnread = !!prev && prev.read === true && notification.read !== true;
        const isNewerVersion = nextTime > prevTime;
        const ageMs = nextTime ? (nowMs - nextTime) : 0;
        const isRecent = !nextTime || ageMs <= FF_TRAINING_TOAST_MAX_AGE_MS;
        const shouldToast = notification.read !== true && isRecent && (
          change.type === 'added' ||
          becameUnread ||
          isNewerVersion
        );
        if (shouldToast) {
          showTrainingAssignmentToast(notification);
        } else {
          markTrainingToastSeen(notification);
        }
        trainingNotificationToastStateById[notification.id] = notification;
      });
      list.forEach((notification) => {
        if (notification?.id) trainingNotificationToastStateById[notification.id] = notification;
      });
    },
    (err) => {
      const hint =
        typeof window.ffDebugQueueAndStaffAccess === 'function'
          ? ' Run ffDebugQueueAndStaffAccess() in the console and share the output.'
          : '';
      /* Allow retry after staff sync; otherwise subKey blocks ff-staff-cloud-updated re-subscribe. */
      try {
        trainingNotificationsSubKey = '';
        if (typeof trainingNotificationsUnsub === 'function') trainingNotificationsUnsub();
      } catch (_) {}
      trainingNotificationsUnsub = null;
      console.error('[Training] staffNotifications snapshot error', {
        code: err && err.code,
        message: err && err.message,
        salonId,
        forStaffId: staffId,
        hint
      }, err);
    }
  );
}

function buildTrainingUserContextFromStaff(staff) {
  return {
    currentRole: getStaffRoleForTraining(staff),
    currentTechnicianTypes: normalizeTrainingTechnicianTypes(staff?.technicianTypes),
  };
}

/**
 * Whether a specific staff record can receive a training notification based
 * on the training's locationIds vs the staff's allowedLocationIds.
 *
 * This is the *staff-centric* counterpart to isTrainingVisibleAtCurrentLocation
 * (which is UI-centric and uses the owner's current active location). We need
 * both because an owner sending a notification from Brickell still wants to
 * notify a Key-Biscayne-only staff if the training is tagged for that branch.
 */
function isTrainingVisibleForStaff(trainingItem, staff) {
  const locIds = Array.isArray(trainingItem?.locationIds) ? trainingItem.locationIds : [];
  if (!locIds.length) return true;
  const staffAllowed = Array.isArray(staff?.allowedLocationIds)
    ? staff.allowedLocationIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  // Legacy staff without explicit location assignments shouldn't be blocked
  // from training - they pre-date the per-location model and are assumed to
  // work everywhere in the salon.
  if (!staffAllowed.length) return true;
  return staffAllowed.some((lid) => locIds.includes(lid));
}

function isStaffEligibleForTrainingNotification(trainingItem, staff) {
  if (!trainingItem || !staff) return false;
  if (staff.isArchived === true || staff.archived === true) return false;
  // Location gate is evaluated per-staff (not per-active-location) so that
  // notifications are routed correctly regardless of where the sender is
  // currently viewing from.
  if (!isTrainingVisibleForStaff(trainingItem, staff)) return false;
  // Run the rest of the relevance check (role + technician-type) without
  // re-applying the location gate - we already handled it above.
  const trainingWithoutLocationGate = { ...trainingItem, locationIds: [] };
  return isTrainingRelevantToCurrentUser(trainingWithoutLocationGate, buildTrainingUserContextFromStaff(staff));
}

async function fetchTrainingNotificationsForCurrentUser() {
  const salonId = getCurrentTrainingSalonId();
  const staffId = getCurrentTrainingStaffId();
  if (!staffId) return [];
  const db = getTrainingDb();
  const { collection, query, where, getDocs } = await getTrainingFirestoreApi();
  const snap = await getDocs(
    query(
      collection(db, 'salons', salonId, 'staffNotifications'),
      where('forStaffId', '==', staffId)
    )
  );
  return snap.docs.map(mapTrainingNotificationDoc);
}

async function refreshTrainingNotificationsForCurrentUser() {
  if (!getCurrentTrainingStaffId()) {
    cacheTrainingNotifications([]);
    renderTrainingAppsBadge();
    renderTrainingNotificationSummary();
    return [];
  }
  try {
    const notifications = await fetchTrainingNotificationsForCurrentUser();
    cacheTrainingNotifications(notifications);
  } catch (err) {
    console.error('[Training] Failed loading staff notifications', err);
    cacheTrainingNotifications([]);
  }
  renderTrainingAppsBadge();
  renderTrainingNotificationSummary();
  return trainingNotificationsList;
}

async function fetchCompletedTrainingNotificationMap(trainingId) {
  const salonId = getCurrentTrainingSalonId();
  const db = getTrainingDb();
  const { collection, query, where, getDocs } = await getTrainingFirestoreApi();
  const snap = await getDocs(
    query(
      collection(db, 'trainingProgress'),
      where('salonId', '==', salonId),
      where('trainingId', '==', trainingId)
    )
  );
  const completedAtByStaffId = {};
  snap.docs.forEach((entry) => {
    const data = entry.data() || {};
    if (data.blockId) return;
    if (String(data.status || '').toLowerCase() !== 'completed') return;
    const staffId = String(data.staffId || '').trim();
    if (!staffId) return;
    if (!completedAtByStaffId[staffId] || getSortTime(data.completedAt) >= getSortTime(completedAtByStaffId[staffId])) {
      completedAtByStaffId[staffId] = data.completedAt || null;
    }
  });
  return completedAtByStaffId;
}

async function sendTrainingAssignmentNotifications(trainingItem) {
  if (!trainingItem?.id) throw new Error('Training item ID is required for notifications.');
  const salonId = getCurrentTrainingSalonId();
  const db = getTrainingDb();
  const { collection, getDocs, doc, writeBatch, serverTimestamp } = await getTrainingFirestoreApi();
  const staffSnap = await getDocs(collection(db, 'salons', salonId, 'staff'));
  const staffRows = staffSnap.docs.map((staffDoc) => ({ id: staffDoc.id, ...(staffDoc.data() || {}) }));
  const eligibleStaff = staffRows.filter((staff) => isStaffEligibleForTrainingNotification(trainingItem, staff));
  if (!eligibleStaff.length) return { count: 0 };

  let completedAtByStaffId = {};
  try {
    completedAtByStaffId = await fetchCompletedTrainingNotificationMap(trainingItem.id);
  } catch (err) {
    console.warn('[Training] Failed loading completion snapshot for notifications', err);
  }

  for (let i = 0; i < eligibleStaff.length; i += 400) {
    const batch = writeBatch(db);
    eligibleStaff.slice(i, i + 400).forEach((staff) => {
      const notificationRef = doc(db, 'salons', salonId, 'staffNotifications', getTrainingNotificationDocId(trainingItem.id, staff.id));
      batch.set(notificationRef, {
        type: 'training_assigned',
        trainingId: trainingItem.id,
        trainingTitle: String(trainingItem.title || '').trim(),
        forStaffId: staff.id,
        read: false,
        required: trainingItem.required === true,
        createdAt: serverTimestamp(),
        openedAt: null,
        completedAt: completedAtByStaffId[staff.id] || null,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    });
    await batch.commit();
  }
  return { count: eligibleStaff.length };
}

async function markTrainingNotificationOpened(trainingId) {
  const staffId = getCurrentTrainingStaffId();
  const notification = getTrainingNotificationForItem(trainingId);
  if (!staffId || !notification || notification.read === true) return;
  const salonId = getCurrentTrainingSalonId();
  const db = getTrainingDb();
  const { doc, updateDoc, serverTimestamp } = await getTrainingFirestoreApi();
  await updateDoc(
    doc(db, 'salons', salonId, 'staffNotifications', getTrainingNotificationDocId(trainingId, staffId)),
    {
      read: true,
      openedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }
  );
  updateLocalTrainingNotification(trainingId, {
    read: true,
    openedAt: new Date(),
    updatedAt: new Date(),
  });
}

async function syncTrainingNotificationCompletion(trainingId, staffId, completedAtValue) {
  const targetStaffId = String(staffId || '').trim();
  if (!trainingId || !targetStaffId) return;
  const salonId = getCurrentTrainingSalonId();
  const db = getTrainingDb();
  const { doc, updateDoc, serverTimestamp } = await getTrainingFirestoreApi();
  try {
    await updateDoc(
      doc(db, 'salons', salonId, 'staffNotifications', getTrainingNotificationDocId(trainingId, targetStaffId)),
      {
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
    );
  } catch (err) {
    const msg = String(err?.message || '').toLowerCase();
    if (!msg.includes('no document') && !msg.includes('not-found')) {
      console.warn('[Training] Failed syncing notification completion', err);
    }
  }
  if (targetStaffId === getCurrentTrainingStaffId()) {
    updateLocalTrainingNotification(trainingId, {
      completedAt: completedAtValue || new Date(),
      updatedAt: new Date(),
    });
  }
}

async function deleteTrainingItem(id) {
  const salonId = getCurrentTrainingSalonId();
  const db = getTrainingDb();
  const { doc, getDoc, deleteDoc, collection, query, where, getDocs, writeBatch } = await getTrainingFirestoreApi();
  const ref = doc(db, 'trainingItems', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Training item not found.');
  if (String(snap.data()?.salonId || '') !== salonId) throw new Error('Item does not belong to current salon.');
  try {
    const notifSnap = await getDocs(
      query(
        collection(db, 'salons', salonId, 'staffNotifications'),
        where('trainingId', '==', id)
      )
    );
    if (!notifSnap.empty) {
      for (let i = 0; i < notifSnap.docs.length; i += 400) {
        const batch = writeBatch(db);
        notifSnap.docs.slice(i, i + 400).forEach((notifDoc) => {
          batch.delete(doc(db, 'salons', salonId, 'staffNotifications', notifDoc.id));
        });
        await batch.commit();
      }
    }
  } catch (err) {
    console.warn('[Training] Failed deleting linked staff notifications', err);
  }
  await deleteDoc(ref);
}

async function fetchTrainingProgressForUser() {
  const salonId = getCurrentTrainingSalonId();
  const staffId = getCurrentTrainingStaffId();
  if (!staffId) return {};
  const db = getTrainingDb();
  const { collection, query, where, getDocs } = await getTrainingFirestoreApi();
  const snap = await getDocs(
    query(
      collection(db, 'trainingProgress'),
      where('salonId', '==', salonId),
      where('staffId', '==', staffId)
    )
  );
  const map = {};
  snap.docs.forEach((d) => {
    const data = d.data() || {};
    if (data.blockId) return;
    const tid = data.trainingId || '';
    if (tid) map[tid] = { id: d.id, ...data };
  });
  return map;
}

async function fetchAllTrainingProgressForSalon() {
  if (!canViewTrainingReports()) return [];
  const salonId = getCurrentTrainingSalonId();
  const db = getTrainingDb();
  const { collection, query, where, getDocs } = await getTrainingFirestoreApi();
  const snap = await getDocs(
    query(collection(db, 'trainingProgress'), where('salonId', '==', salonId))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function fetchTrainingVideoProgressForUser() {
  const salonId = getCurrentTrainingSalonId();
  const staffId = getCurrentTrainingStaffId();
  if (!staffId) return {};
  const db = getTrainingDb();
  const { collection, query, where, getDocs } = await getTrainingFirestoreApi();
  const snap = await getDocs(
    query(
      collection(db, 'trainingProgress'),
      where('salonId', '==', salonId),
      where('staffId', '==', staffId)
    )
  );
  const map = {};
  snap.docs.forEach((d) => {
    const data = d.data() || {};
    if (!data.blockId) return;
    const key = getTrainingVideoProgressCacheKey(data.trainingId, data.blockId);
    map[key] = { id: d.id, ...data };
  });
  return map;
}

function canViewTrainingReports() {
  const accountRole = String(window.__ff_user_role || '').toLowerCase().trim();
  if (accountRole === 'owner' || accountRole === 'admin') return true;
  const actorRole = String(
    window.__ff_actorRole ||
    sessionStorage.getItem('ff_actor_role') ||
    ''
  ).toLowerCase().trim();
  if (actorRole === 'owner' || actorRole === 'admin') return true;
  if (['tech', 'technician', 'staff'].includes(actorRole)) return false;
  return typeof ffHasAdminAccess === 'function' && ffHasAdminAccess();
}

function getTrainingReportsStaffList() {
  try {
    const store = JSON.parse(localStorage.getItem('ff_staff_v1') || '{}');
    const list = Array.isArray(store.staff) ? store.staff : [];
    const active = list.filter((s) => s.isArchived !== true);
    // Scope the reports to staff who are actually assigned to the active
    // location. Without this a manager at Brickell would see completion
    // totals / "not completed" rosters that include Key-Biscayne-only staff,
    // which defeats the "each location is its own business" model.
    return active.filter(isStaffAtCurrentTrainingLocation);
  } catch (_) {
    return [];
  }
}

/**
 * Whether a staff record belongs to the currently-active location for the
 * purposes of Training reports.
 *
 * - If the salon has only one location, or the caller cannot resolve an
 *   active id, everyone passes (single-branch / legacy mode).
 * - Staff without any allowedLocationIds pre-date the multi-location model
 *   and are treated as "works everywhere" so they don't silently disappear
 *   from reports after a migration.
 * - Otherwise, the staff must have the active location in their
 *   allowedLocationIds list.
 */
function isStaffAtCurrentTrainingLocation(staff) {
  if (!staff) return false;
  const activeLocId = (typeof window !== 'undefined' && typeof window.ffGetActiveLocationId === 'function')
    ? String(window.ffGetActiveLocationId() || '').trim()
    : '';
  if (!activeLocId) return true;
  const allowed = Array.isArray(staff.allowedLocationIds)
    ? staff.allowedLocationIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  if (!allowed.length) return true;
  return allowed.includes(activeLocId);
}

function getStaffRoleForTraining(staff) {
  const r = String(staff?.role || 'technician').toLowerCase().trim();
  if (r === 'tech' || r === 'staff') return 'technician';
  return r || 'technician';
}

async function markTrainingCompleted(trainingId) {
  const salonId = getCurrentTrainingSalonId();
  const staffId = getCurrentTrainingStaffId();
  if (!staffId) throw new Error('Staff ID required to track progress.');
  const db = getTrainingDb();
  const { collection, query, where, getDocs, doc, updateDoc, addDoc, serverTimestamp } = await getTrainingFirestoreApi();
  const existing = await getDocs(
    query(
      collection(db, 'trainingProgress'),
      where('salonId', '==', salonId),
      where('staffId', '==', staffId),
      where('trainingId', '==', trainingId)
    )
  );
  const completionDoc = existing.docs.find((d) => !(d.data()?.blockId));
  const now = new Date();
  const payload = {
    trainingId,
    salonId,
    staffId,
    status: 'completed',
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (completionDoc) {
    await updateDoc(doc(db, 'trainingProgress', completionDoc.id), {
      status: 'completed',
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    await addDoc(collection(db, 'trainingProgress'), payload);
  }
  trainingProgressMap[trainingId] = { status: 'completed', completedAt: now };
  await syncTrainingNotificationCompletion(trainingId, staffId, now);
}

async function markTrainingCompletedForStaff(trainingId, targetStaffId) {
  const salonId = getCurrentTrainingSalonId();
  const staffId = String(targetStaffId || '').trim();
  if (!staffId) throw new Error('Target staff ID required.');
  if (!canOverrideTrainingCompletion()) throw new Error('Only admin or manager can mark another employee as completed.');
  const db = getTrainingDb();
  const { doc, setDoc, serverTimestamp } = await getTrainingFirestoreApi();
  const payload = {
    trainingId,
    salonId,
    staffId,
    blockId: null,
    status: 'completed',
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    markedByAdmin: true,
    markedByUid: (typeof window.__ffGetUid === 'function' ? window.__ffGetUid() : null) || null,
  };
  await setDoc(doc(db, 'trainingProgress', getTrainingCompletionProgressDocId(trainingId, staffId)), payload, { merge: true });
  await syncTrainingNotificationCompletion(trainingId, staffId, new Date());
}

function showTrainingAdminConfirm({ title, message, confirmLabel }) {
  return new Promise((resolve) => {
    const existing = document.getElementById('trainingAdminConfirmModal');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'trainingAdminConfirmModal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(17,24,39,0.45);z-index:100520;display:flex;align-items:center;justify-content:center;padding:20px;';
    const dialog = document.createElement('div');
    dialog.style.cssText = 'width:100%;max-width:420px;background:#fff;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,0.22);border:1px solid #ede9fe;padding:20px;display:grid;gap:14px;';
    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:16px;font-weight:600;color:#111827;';
    titleEl.textContent = title || 'Confirm action';
    const bodyEl = document.createElement('div');
    bodyEl.style.cssText = 'font-size:13px;line-height:1.6;color:#4b5563;';
    bodyEl.textContent = message || '';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:4px;';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-pill';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'font-size:12px;padding:8px 14px;background:#fff;color:#374151;border:1px solid #d1d5db;';
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'btn-pill';
    okBtn.textContent = confirmLabel || 'Confirm';
    okBtn.style.cssText = 'font-size:12px;padding:8px 14px;background:#7c3aed;color:#fff;border:1px solid #7c3aed;';
    const close = (value) => {
      overlay.remove();
      resolve(value);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });
    cancelBtn.onclick = () => close(false);
    okBtn.onclick = () => {
      okBtn.disabled = true;
      okBtn.style.opacity = '0.7';
      okBtn.style.cursor = 'wait';
      close(true);
    };
    dialog.onclick = (e) => e.stopPropagation();
    actions.append(cancelBtn, okBtn);
    dialog.append(titleEl, bodyEl, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  });
}

function showTrainingAdminNotice({ title, message, buttonLabel }) {
  return new Promise((resolve) => {
    const existing = document.getElementById('trainingAdminNoticeModal');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'trainingAdminNoticeModal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(17,24,39,0.45);z-index:100521;display:flex;align-items:center;justify-content:center;padding:20px;';
    const dialog = document.createElement('div');
    dialog.style.cssText = 'width:100%;max-width:420px;background:#fff;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,0.22);border:1px solid #ede9fe;padding:20px;display:grid;gap:14px;';
    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:16px;font-weight:600;color:#111827;';
    titleEl.textContent = title || 'Notice';
    const bodyEl = document.createElement('div');
    bodyEl.style.cssText = 'font-size:13px;line-height:1.6;color:#4b5563;';
    bodyEl.textContent = message || '';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:4px;';
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'btn-pill';
    okBtn.textContent = buttonLabel || 'OK';
    okBtn.style.cssText = 'font-size:12px;padding:8px 14px;background:#7c3aed;color:#fff;border:1px solid #7c3aed;';
    const close = () => {
      overlay.remove();
      resolve();
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    okBtn.onclick = close;
    dialog.onclick = (e) => e.stopPropagation();
    actions.append(okBtn);
    dialog.append(titleEl, bodyEl, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  });
}

function getTrainingVideoProgressDocId(trainingId, blockId, staffId) {
  return ['video', trainingId, blockId, staffId]
    .map((part) => String(part || '').replace(/[^a-zA-Z0-9_-]/g, '_'))
    .join('__');
}

function getTrainingCompletionProgressDocId(trainingId, staffId) {
  return ['completion', trainingId, staffId]
    .map((part) => String(part || '').replace(/[^a-zA-Z0-9_-]/g, '_'))
    .join('__');
}

function getTrainingQuizQuestions(item) {
  return Array.isArray(item?.quizQuestions) ? item.quizQuestions : [];
}

function hasTrainingQuiz(item) {
  return getTrainingQuizQuestions(item).length > 0;
}

function hasSubmittedTrainingQuiz(progress) {
  return !!(progress?.quizSubmittedAt || (Array.isArray(progress?.quizResponses) && progress.quizResponses.length));
}

function hasPassedTrainingQuiz(progress) {
  return progress?.quizPassed === true;
}

function getTrainingQuizDraftAnswerMap(trainingId) {
  const key = String(trainingId || '').trim();
  if (!key) return {};
  if (!trainingQuizDraftAnswers[key] || typeof trainingQuizDraftAnswers[key] !== 'object') {
    trainingQuizDraftAnswers[key] = {};
  }
  return trainingQuizDraftAnswers[key];
}

function setTrainingQuizDraftAnswer(trainingId, questionId, optionId) {
  const draft = getTrainingQuizDraftAnswerMap(trainingId);
  draft[String(questionId || '').trim()] = String(optionId || '').trim();
}

function evaluateTrainingQuiz(questions, answersByQuestion) {
  const responses = questions.map((question) => {
    const selectedOptionId = String(answersByQuestion?.[question.id] || '').trim();
    const selectedOption = (Array.isArray(question.options) ? question.options : []).find((option) => option.id === selectedOptionId);
    const correctOption = (Array.isArray(question.options) ? question.options : []).find((option) => option.id === question.correctOptionId);
    return {
      questionId: question.id,
      questionText: question.text || '',
      selectedOptionId,
      selectedOptionText: selectedOption?.text || '',
      correctOptionId: question.correctOptionId || '',
      correctOptionText: correctOption?.text || '',
      isCorrect: !!selectedOptionId && selectedOptionId === question.correctOptionId,
    };
  });
  const totalQuestions = questions.length;
  const correctCount = responses.filter((response) => response.isCorrect).length;
  const scorePercent = totalQuestions ? Math.round((correctCount / totalQuestions) * 100) : 0;
  return { responses, totalQuestions, correctCount, scorePercent };
}

async function submitTrainingQuiz(trainingId) {
  const item = trainingItems.find((entry) => entry.id === trainingId);
  if (!item) throw new Error('Training item not found.');
  const questions = getTrainingQuizQuestions(item);
  if (!questions.length) throw new Error('No quiz found for this training.');
  const answersByQuestion = getTrainingQuizDraftAnswerMap(trainingId);
  const missingQuestion = questions.find((question) => !String(answersByQuestion?.[question.id] || '').trim());
  if (missingQuestion) throw new Error('Please answer all quiz questions before submitting.');

  const result = evaluateTrainingQuiz(questions, answersByQuestion);
  const passed = result.totalQuestions > 0 && result.correctCount === result.totalQuestions;
  const salonId = getCurrentTrainingSalonId();
  const staffId = getCurrentTrainingStaffId();
  if (!staffId) throw new Error('Staff ID required to save quiz results.');
  const db = getTrainingDb();
  const { doc, setDoc, serverTimestamp } = await getTrainingFirestoreApi();
  const progressRef = doc(db, 'trainingProgress', getTrainingCompletionProgressDocId(trainingId, staffId));
  const existing = trainingProgressMap[trainingId] || {};
  const attemptsCount = Math.max(0, Number(existing.quizAttemptsCount || 0)) + 1;
  const bestScorePercent = Math.max(
    Math.max(0, Math.min(100, Math.round(Number(existing.quizBestScorePercent || 0)))),
    result.scorePercent
  );
  await setDoc(progressRef, {
    trainingId,
    salonId,
    staffId,
    blockId: null,
    status: passed ? 'completed' : 'in_progress',
    completedAt: passed ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
    quizSubmittedAt: serverTimestamp(),
    quizQuestionCount: result.totalQuestions,
    quizCorrectCount: result.correctCount,
    quizScorePercent: result.scorePercent,
    quizPassed: passed,
    quizAttemptsCount: attemptsCount,
    quizLastResult: passed ? 'passed' : 'failed',
    quizLastScorePercent: result.scorePercent,
    quizBestScorePercent: bestScorePercent,
    quizLastAttemptAt: serverTimestamp(),
    quizResponses: result.responses,
  }, { merge: true });
  trainingProgressMap = await fetchTrainingProgressForUser();
  if (passed) await syncTrainingNotificationCompletion(trainingId, staffId, new Date());
}

async function handleSubmitTrainingQuiz(trainingId) {
  const quizSection = document.getElementById('trainingQuizSection');
  const submitBtn = quizSection?.querySelector('#trainingSubmitQuizBtn');
  const msgEl = quizSection?.querySelector('#trainingQuizMessage');
  if (submitBtn) submitBtn.disabled = true;
  if (msgEl) msgEl.style.display = 'none';
  try {
    await submitTrainingQuiz(trainingId);
    const item = trainingItems.find((entry) => entry.id === trainingId);
    if (item) renderTrainingDetails(item);
  } catch (err) {
    console.error('[Training] Quiz submit failed', err);
    if (msgEl) {
      msgEl.textContent = err?.message || 'Failed to submit quiz.';
      msgEl.style.display = 'block';
    } else {
      alert(err?.message || 'Failed to submit quiz.');
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function getTrainingVideoProgressCacheKey(trainingId, blockId) {
  return `${String(trainingId || '')}::${String(blockId || '')}`;
}

function getTrainingBlockStableId(block, index) {
  if (block?.id) return String(block.id);
  return `legacy_${String(block?.type || 'block')}_${Number(index)}`;
}

async function saveTrainingVideoProgress(trainingId, blockId, metrics) {
  const salonId = getCurrentTrainingSalonId();
  const staffId = getCurrentTrainingStaffId();
  if (!salonId || !staffId || !trainingId || !blockId) return;
  const percentWatched = Math.max(0, Math.min(100, Math.round(Number(metrics?.percentWatched || 0))));
  const lastTimeSec = Math.max(0, Math.round(Number(metrics?.lastTimeSec || 0)));
  const durationSec = Math.max(0, Math.round(Number(metrics?.durationSec || 0)));
  const completed = percentWatched >= 80;
  const cacheKey = getTrainingVideoProgressCacheKey(trainingId, blockId);
  const prev = trainingVideoProgressCache[cacheKey];
  const nowMs = Date.now();
  const percentDiff = Math.abs((prev?.percentWatched || 0) - percentWatched);
  const timeDiff = Math.abs((prev?.lastTimeSec || 0) - lastTimeSec);
  const completedChanged = !!prev && !!prev.completed !== completed;
  const staleEnough = !prev || (nowMs - (prev.savedAtMs || 0) >= 5000);
  const changedEnough = !prev || percentDiff >= 5 || timeDiff >= 5 || completedChanged || completed;
  if (!changedEnough && !staleEnough) return;
  trainingVideoProgressCache[cacheKey] = { percentWatched, lastTimeSec, durationSec, completed, savedAtMs: nowMs };
  trainingVideoProgressMap[cacheKey] = {
    ...(trainingVideoProgressMap[cacheKey] || {}),
    trainingId,
    blockId,
    staffId,
    percentWatched,
    lastTimeSec,
    durationSec,
    completed,
  };
  updateTrainingVideoProgressUI(trainingId, blockId);
  try {
    const db = getTrainingDb();
    const { doc, setDoc, serverTimestamp } = await getTrainingFirestoreApi();
    const docId = getTrainingVideoProgressDocId(trainingId, blockId, staffId);
    await setDoc(doc(db, 'trainingProgress', docId), {
      progressType: 'video_progress',
      salonId,
      trainingId,
      blockId,
      staffId,
      // Firestore trainingProgress create rule requires status (string).
      status: completed ? 'completed' : 'in_progress',
      percentWatched,
      lastTimeSec,
      durationSec,
      completed,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.error('[Training] Video progress save failed', err);
  }
}

function formatTrainingVideoProgressText(progress) {
  if (!progress) return 'Watch progress: 0%';
  const percent = Math.max(0, Math.min(100, Math.round(Number(progress.percentWatched || 0))));
  const lastSec = Math.max(0, Math.round(Number(progress.lastTimeSec || 0)));
  const durationSec = Math.max(0, Math.round(Number(progress.durationSec || 0)));
  const parts = [`Watch progress: ${percent}%`];
  if (durationSec > 0) parts.push(`Last position: ${lastSec}s / ${durationSec}s`);
  if (progress.completed) parts.push('Completed');
  return parts.join(' - ');
}

function updateTrainingVideoProgressUI(trainingId, blockId) {
  const detailsView = document.getElementById('trainingDetailsView');
  if (!detailsView) return;
  const key = getTrainingVideoProgressCacheKey(trainingId, blockId);
  const progress = trainingVideoProgressMap[key];
  const statusEl = detailsView.querySelector(`[data-video-progress-for="${blockId}"]`);
  if (statusEl) {
    statusEl.textContent = formatTrainingVideoProgressText(progress);
    statusEl.style.color = progress?.completed ? '#059669' : '#6b7280';
  }
}

function renderTrainingVideoProgressMeta(trainingId, blockId) {
  const progress = trainingVideoProgressMap[getTrainingVideoProgressCacheKey(trainingId, blockId)];
  const color = progress?.completed ? '#059669' : '#6b7280';
  return `<div data-video-progress-for="${blockId}" style="margin-top:8px;font-size:12px;color:${color};">${formatTrainingVideoProgressText(progress)}</div>`;
}

function getTrainingReportStaffId(staff) {
  return String(staff?.id || staff?.staffId || staff?.name || '').trim();
}

/** Resolve the staff JSON row shown in Reports for admin actions (reminder / mark completed). Matches id, alternate keys, uid, email, or display name. */
function resolveStaffStoreRowForTrainingAdminAction(rawKey) {
  const key = String(rawKey || '').trim();
  if (!key) return null;
  let store = { staff: [] };
  try {
    if (typeof window.ffGetStaffStore === 'function') store = window.ffGetStaffStore() || { staff: [] };
  } catch (_) {}
  const rows = Array.isArray(store.staff) ? store.staff : [];
  const eq = (a, b) => String(a || '').trim() === String(b || '').trim();
  let row =
    rows.find((s) => eq(s?.id, key)) ||
    rows.find((s) => eq(s?.staffId, key)) ||
    rows.find((s) => eq(s?.firebaseUid, key)) ||
    rows.find((s) => eq(s?.uid, key)) ||
    null;
  if (!row) {
    const kl = key.toLowerCase();
    row = rows.find((s) => String(s?.email || '').trim().toLowerCase() === kl) || null;
  }
  if (!row) row = rows.find((s) => eq(s?.name, key)) || null;
  return row;
}

function getTrainingStaffFirestoreDocIdForActions(staffRow) {
  return String(staffRow?.id || staffRow?.staffId || '').trim();
}

function wireTrainingReportDetailActionButtons(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('.ff-training-report-action-btn[data-action]').forEach((btn) => {
    if (btn.dataset.ffTrainingActionWired === '1') return;
    btn.dataset.ffTrainingActionWired = '1';
    const fire = () => {
      const action = btn.getAttribute('data-action');
      let tid = btn.getAttribute('data-training-id') || '';
      let sk = btn.getAttribute('data-staff-key') || '';
      try {
        tid = decodeURIComponent(tid);
      } catch (_) {}
      try {
        sk = decodeURIComponent(sk);
      } catch (_) {}
      if (!tid || !sk) return;
      if (action === 'training-send-reminder') void sendTrainingReminderFromReport(tid, sk);
      else if (action === 'training-mark-complete') void markTrainingCompletedForStaffFromReport(tid, sk);
    };
    let lastFireAt = 0;
    const fireOnce = () => {
      const n = Date.now();
      if (n - lastFireAt < 600) return;
      lastFireAt = n;
      fire();
    };
    btn.addEventListener(
      'click',
      function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        fireOnce();
      },
      true
    );
    btn.addEventListener(
      'touchend',
      function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        fireOnce();
      },
      { capture: true, passive: false }
    );
  });
}

window.__ffTrainingReminderDiag = function () {
  const rd = document.getElementById('trainingReportDetailsView');
  let csDisp = '';
  let csPe = '';
  try {
    if (rd && window.getComputedStyle) {
      csDisp = getComputedStyle(rd).display || '';
      csPe = getComputedStyle(rd).pointerEvents || '';
    }
  } catch (_) {}
  return {
    paneExists: !!rd,
    paneInlineDisplay: rd ? rd.style.display : '',
    paneComputedDisplay: csDisp,
    panePointerEvents: csPe,
    reminderButtons:
      rd && rd.querySelectorAll ? rd.querySelectorAll('[data-action="training-send-reminder"]').length : 0,
    docDelegationBound: window.__ffTrainingReportDlgBound === true,
  };
};

function ensureTrainingReportDetailsAdminDelegation() {
  if (window.__ffTrainingReportDlgBound === true) return;
  window.__ffTrainingReportDlgBound = true;
  /** Dedupe rapid click + older iOS quirks */
  let lastKey = '';
  let lastTs = 0;
  const run = (ev) => {
    const rd = document.getElementById('trainingReportDetailsView');
    if (!rd) return false;
    if (rd.style.display === 'none') return false;
    const raw = ev.target;
    let el = raw && raw.nodeType === 1 ? raw : (raw && raw.parentElement ? raw.parentElement : null);
    if (!el || typeof el.closest !== 'function') return false;
    const btn = el.closest('[data-action="training-send-reminder"], [data-action="training-mark-complete"]');
    if (!btn || !rd.contains(btn)) return false;
    const action = btn.getAttribute('data-action');
    let tid = btn.getAttribute('data-training-id') || '';
    let sk = btn.getAttribute('data-staff-key') || '';
    try {
      tid = decodeURIComponent(tid);
    } catch (_) {}
    try {
      sk = decodeURIComponent(sk);
    } catch (_) {}
    if (!tid || !sk) return false;
    const now = Date.now();
    const k = `${action}::${tid}::${sk}`;
    if (k === lastKey && now - lastTs < 700) return true;
    lastKey = k;
    lastTs = now;
    if (action === 'training-send-reminder') void sendTrainingReminderFromReport(tid, sk);
    else if (action === 'training-mark-complete') void markTrainingCompletedForStaffFromReport(tid, sk);
    return true;
  };
  document.addEventListener(
    'click',
    function (ev) {
      try {
        run(ev);
      } catch (_) {}
    },
    true
  );
  document.addEventListener(
    'touchend',
    function (ev) {
      try {
        run(ev);
      } catch (_) {}
    },
    { capture: true, passive: true }
  );
}

function bindTrainingReportDetailsAdminActionsOnce() {
  ensureTrainingReportDetailsAdminDelegation();
}

function getTrainingCompletedEntries(trainingId) {
  return trainingAllProgressList.filter((p) => p.trainingId === trainingId && !p.blockId && p.status === 'completed');
}

function getTrainingLatestProgressEntry(trainingId, staffId) {
  return trainingAllProgressList.find((p) => {
    if (p.trainingId !== trainingId || p.blockId) return false;
    return String(p.staffId || '').trim() === String(staffId || '').trim();
  }) || null;
}

function getTrainingVideoProgressEntries(trainingId, staffId) {
  return trainingAllProgressList.filter((p) => {
    if (p.trainingId !== trainingId || !p.blockId) return false;
    return String(p.staffId || '').trim() === String(staffId || '').trim();
  });
}

function renderTrainingReportEmployeeCard(item, staff) {
  const staffId = getTrainingReportStaffId(staff);
  const progressEntry = getTrainingLatestProgressEntry(item.id, staffId);
  const completedEntry = progressEntry?.status === 'completed' ? progressEntry : null;
  const videoBlocks = (Array.isArray(item.contentBlocks) ? item.contentBlocks : []).filter((b) => b.type === 'video');
  const quizQuestions = getTrainingQuizQuestions(item);
  const videoProgressEntries = getTrainingVideoProgressEntries(item.id, staffId);
  const videoRows = videoBlocks.length
    ? videoBlocks.map((block, idx) => {
        const stableBlockId = getTrainingBlockStableId(block, idx);
        const progress = videoProgressEntries.find((p) => p.blockId === stableBlockId);
        const percent = Math.max(0, Math.min(100, Math.round(Number(progress?.percentWatched || 0))));
        const duration = Math.max(0, Math.round(Number(progress?.durationSec || 0)));
        const lastTime = Math.max(0, Math.round(Number(progress?.lastTimeSec || 0)));
        const watched = percent > 0;
        const statusText = progress?.completed ? 'Completed' : (watched ? 'In Progress' : 'Not Started');
        const statusColor = progress?.completed ? '#059669' : (watched ? '#b45309' : '#9ca3af');
        return `
          <div style="padding:8px 10px;border:1px solid #f3f4f6;border-radius:8px;background:#fafafa;display:grid;gap:4px;">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
              <div style="font-size:12px;font-weight:500;color:#111827;">${block.title || `Video ${idx + 1}`}</div>
              <span style="font-size:11px;color:${statusColor};font-weight:600;">${statusText}</span>
            </div>
            <div style="font-size:12px;color:#6b7280;">Watch progress: ${percent}%</div>
            <div style="font-size:12px;color:#6b7280;">Last position: ${lastTime}s / ${duration}s</div>
          </div>
        `;
      }).join('')
    : '<div style="font-size:12px;color:#9ca3af;">No video blocks in this training.</div>';
  const completedDate = completedEntry?.completedAt ? getSortTime(completedEntry.completedAt) : 0;
  const completionText = completedEntry
    ? `Completed${completedDate ? ` on ${new Date(completedDate).toLocaleDateString()}` : ''}`
    : 'Not Completed';
  const completionColor = completedEntry ? '#059669' : '#dc2626';
  const attemptsCount = Math.max(0, Math.round(Number(progressEntry?.quizAttemptsCount || 0)));
  const lastResultLabel = progressEntry?.quizLastResult === 'passed'
    ? 'Passed'
    : (progressEntry?.quizLastResult === 'failed' ? 'Failed' : 'Not Attempted');
  const lastAttemptAt = progressEntry?.quizLastAttemptAt ? getSortTime(progressEntry.quizLastAttemptAt) : 0;
  const lastAttemptText = lastAttemptAt ? new Date(lastAttemptAt).toLocaleDateString() : '';
  const encTid = encodeURIComponent(String(item.id || ''));
  const adminLookupToken = String(
    staffId ||
      String(staff?.email || '').trim() ||
      String(staff?.firebaseUid || staff?.uid || '').trim() ||
      ''
  ).trim();
  const encSk = encodeURIComponent(adminLookupToken);
  const quizStatusHtml = !quizQuestions.length
    ? '<div style="font-size:12px;color:#9ca3af;">No quiz in this training.</div>'
    : (progressEntry?.quizSubmittedAt
      ? `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;"><span style="font-size:12px;color:#111827;">Last result</span><span style="font-size:12px;color:${progressEntry?.quizPassed ? '#059669' : '#b45309'};font-weight:600;">${lastResultLabel}</span></div><div style="font-size:12px;color:#6b7280;">Attempts: ${attemptsCount}</div>${lastAttemptText ? `<div style="font-size:12px;color:#6b7280;">Last attempt: ${lastAttemptText}</div>` : ''}${progressEntry?.quizPassed ? '' : '<div style="font-size:12px;color:#b45309;">Employee still needs to retry the quiz.</div>'}`
      : (completedEntry?.markedByAdmin
        ? '<div style="font-size:12px;color:#6b7280;">Completed manually by admin without quiz submission.</div>'
        : '<div style="font-size:12px;color:#b45309;">Quiz not submitted yet.</div>'));
  const actionButtons = [];
  if (!completedEntry && adminLookupToken) {
    actionButtons.push(`<button type="button" class="btn-pill ff-training-report-action-btn" style="font-size:11px;padding:5px 10px;background:#ede9fe;color:#7c3aed;border-color:#c4b5fd;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:rgba(124,58,237,0.18);position:relative;z-index:2;" data-action="training-send-reminder" data-training-id="${encTid}" data-staff-key="${encSk}">Send Reminder</button>`);
  }
  if (!completedEntry && canOverrideTrainingCompletion() && adminLookupToken) {
    actionButtons.push(`<button type="button" class="btn-pill ff-training-report-action-btn" style="font-size:11px;padding:5px 10px;background:#7c3aed;color:#fff;border-color:#7c3aed;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:rgba(124,58,237,0.18);position:relative;z-index:2;" data-action="training-mark-complete" data-training-id="${encTid}" data-staff-key="${encSk}">Mark Completed</button>`);
  }
  const adminActionsHtml = actionButtons.length
    ? `<div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:4px;">${actionButtons.join('')}</div>`
    : '';
  return `
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;display:grid;gap:10px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
        <div style="font-size:14px;font-weight:600;color:#111827;">${staff.name || staffId || 'Unknown'}</div>
        <div style="font-size:12px;color:${completionColor};font-weight:600;">${completionText}</div>
      </div>
      <div style="display:grid;gap:8px;">
        <div style="font-size:12px;font-weight:600;color:#374151;">Video Activity</div>
        ${videoRows}
      </div>
      <div style="display:grid;gap:8px;">
        <div style="font-size:12px;font-weight:600;color:#374151;">Quiz</div>
        <div style="padding:8px 10px;border:1px solid #f3f4f6;border-radius:8px;background:#fafafa;display:grid;gap:4px;">
          ${quizStatusHtml}
        </div>
      </div>
      ${adminActionsHtml}
    </div>
  `;
}

async function markTrainingCompletedForStaffFromReport(trainingId, staffLookupKey) {
  if (!canOverrideTrainingCompletion()) return;
  const staffRow = resolveStaffStoreRowForTrainingAdminAction(staffLookupKey);
  const firestoreStaffId = staffRow ? getTrainingStaffFirestoreDocIdForActions(staffRow) : '';
  if (!firestoreStaffId) {
    await showTrainingAdminNotice({
      title: 'Could not mark completed',
      message: staffRow
        ? 'This employee record is missing a Staff ID in the roster. Edit the employee in Staff, ensure the profile is saved, then try again.'
        : 'Employee details were not found for this row.',
      buttonLabel: 'OK',
    });
    return;
  }
  const ok = await showTrainingAdminConfirm({
    title: 'Mark Training Completed',
    message: 'This will mark the employee as completed for this training, even if they have not finished all steps yet.',
    confirmLabel: 'Mark Completed',
  });
  if (!ok) return;
  try {
    await markTrainingCompletedForStaff(trainingId, firestoreStaffId);
    trainingAllProgressList = await fetchAllTrainingProgressForSalon();
    openReportTrainingDetails(trainingId);
  } catch (err) {
    console.error('[Training] Admin mark completed failed', err);
    await showTrainingAdminNotice({
      title: 'Could not mark completed',
      message: err?.message || 'Failed to mark employee as completed.',
      buttonLabel: 'OK',
    });
  }
}

async function sendTrainingReminderFromReport(trainingId, staffLookupKey) {
  const item = trainingItems.find((x) => x.id === trainingId);
  const staff = resolveStaffStoreRowForTrainingAdminAction(staffLookupKey);
  const firestoreStaffId = staff ? getTrainingStaffFirestoreDocIdForActions(staff) : '';
  if (!item || !staff) {
    await showTrainingAdminNotice({
      title: 'Could not send reminder',
      message: 'Training or employee details were not found.',
      buttonLabel: 'OK',
    });
    return;
  }
  if (!firestoreStaffId) {
    await showTrainingAdminNotice({
      title: 'Could not send reminder',
      message:
        'This employee record has no Staff ID in the roster, so we cannot resolve their login for Chat. Open Staff, open this employee, save the profile, then try again.',
      buttonLabel: 'OK',
    });
    return;
  }
  const ok = await showTrainingAdminConfirm({
    title: 'Send Training Reminder',
    message: `Send ${staff.name || 'this employee'} a reminder to finish "${item.title}"?`,
    confirmLabel: 'Send Reminder',
  });
  if (!ok) return;
  const reminderKey = `${trainingId}__${firestoreStaffId}`;
  const existingState = trainingReminderSendState[reminderKey];
  if (existingState?.inFlight) return;
  if (existingState?.lastSentAt && (Date.now() - existingState.lastSentAt) < 5000) return;
  trainingReminderSendState[reminderKey] = {
    inFlight: true,
    lastSentAt: existingState?.lastSentAt || 0
  };
  try {
    if (typeof window.ffSendTrainingReminderChat !== 'function') {
      try {
        await import('/chat.js?v=20260701_chat_compose_split');
      } catch (eImp) {
        console.warn('[Training] Could not load chat module for reminder', eImp);
      }
    }
    if (typeof window.ffSendTrainingReminderChat !== 'function') {
      throw new Error('Chat reminders are not available right now.');
    }
    await window.ffSendTrainingReminderChat({
      trainingId,
      staffId: firestoreStaffId,
      recipientUid: staff.uid || '',
      recipientFirebaseUid: staff.firebaseUid || '',
      recipientEmail: staff.email || '',
      recipientName: staff.name || '',
      staffName: staff.name || '',
      trainingTitle: item.title || 'this training'
    });
    trainingReminderSendState[reminderKey] = {
      inFlight: false,
      lastSentAt: Date.now()
    };
    await showTrainingAdminNotice({
      title: 'Reminder Sent',
      message: `${staff.name || 'The employee'} received a reminder to finish this training.`,
      buttonLabel: 'OK',
    });
  } catch (err) {
    trainingReminderSendState[reminderKey] = {
      inFlight: false,
      lastSentAt: existingState?.lastSentAt || 0
    };
    console.error('[Training] Send reminder failed', err);
    await showTrainingAdminNotice({
      title: 'Could not send reminder',
      message: err?.message || 'Failed to send the reminder.',
      buttonLabel: 'OK',
    });
  }
}

function bindTrainingVideoTracking(trainingId) {
  const detailsView = document.getElementById('trainingDetailsView');
  if (!detailsView || !trainingId) return;
  const videos = detailsView.querySelectorAll('video[data-training-video="1"]');
  videos.forEach((videoEl) => {
    if (videoEl.dataset.trackingBound === '1') return;
    videoEl.dataset.trackingBound = '1';
    const blockId = videoEl.dataset.blockId || '';
    if (!blockId) return;
    const key = getTrainingVideoProgressCacheKey(trainingId, blockId);
    const restorePosition = () => {
      const progress = trainingVideoProgressMap[key];
      const resumeSec = Number(progress?.lastTimeSec || 0);
      const durationSec = Number(videoEl.duration || 0);
      if (!resumeSec || !durationSec || !Number.isFinite(durationSec)) return;
      if (resumeSec >= durationSec) return;
      try { videoEl.currentTime = resumeSec; } catch (_) {}
    };
    videoEl.addEventListener('loadedmetadata', restorePosition, { once: true });
    const pushProgress = () => {
      const durationSec = Number(videoEl.duration || 0);
      const lastTimeSec = Number(videoEl.currentTime || 0);
      if (!durationSec || !Number.isFinite(durationSec)) return;
      const percentWatched = (lastTimeSec / durationSec) * 100;
      saveTrainingVideoProgress(trainingId, blockId, {
        percentWatched,
        lastTimeSec,
        durationSec,
      });
    };
    videoEl.addEventListener('timeupdate', pushProgress);
    videoEl.addEventListener('pause', pushProgress);
    videoEl.addEventListener('ended', pushProgress);
  });
}

async function loadTrainingItems() {
  trainingLoading = true;
  trainingError = '';
  renderTrainingLibrary();
  try {
    const rows = await fetchTrainingItems();
    replaceTrainingItems(rows);
  } catch (err) {
    console.error('[Training] Failed loading items', err);
    trainingError = err?.message || 'Failed to load training items.';
  } finally {
    trainingLoading = false;
    trainingItemsLoadedOnce = true;
  }
}

function createTrainingBlock(type) {
  const base = { id: `blk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, type, title: '' };
  if (type === 'text') return { ...base, body: '' };
  if (type === 'steps') return { ...base, steps: [''] };
  if (type === 'video') return { ...base, url: '' };
  if (type === 'image') return { ...base, imageUrls: [] };
  return base;
}

function createTrainingQuizOption() {
  return { id: `opt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, text: '' };
}

function createTrainingQuizQuestion() {
  const options = [createTrainingQuizOption(), createTrainingQuizOption()];
  return {
    id: `quiz_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    text: '',
    options,
    correctOptionId: options[0].id,
  };
}

function addTrainingQuizQuestion() {
  trainingDraftQuizQuestions.push(createTrainingQuizQuestion());
  renderTrainingQuizEditor();
}

function removeTrainingQuizQuestion(index) {
  if (index < 0 || index >= trainingDraftQuizQuestions.length) return;
  trainingDraftQuizQuestions.splice(index, 1);
  renderTrainingQuizEditor();
}

function updateTrainingQuizQuestionText(index, value) {
  const question = trainingDraftQuizQuestions[index];
  if (!question) return;
  question.text = value;
}

function addTrainingQuizOption(questionIndex) {
  const question = trainingDraftQuizQuestions[questionIndex];
  if (!question) return;
  question.options = Array.isArray(question.options) ? question.options : [];
  if (question.options.length >= 5) return;
  question.options.push(createTrainingQuizOption());
  renderTrainingQuizEditor();
}

function removeTrainingQuizOption(questionIndex, optionIndex) {
  const question = trainingDraftQuizQuestions[questionIndex];
  if (!question || !Array.isArray(question.options) || question.options.length <= 2) return;
  const removed = question.options.splice(optionIndex, 1)[0];
  if (removed && question.correctOptionId === removed.id) {
    question.correctOptionId = question.options[0]?.id || '';
  }
  renderTrainingQuizEditor();
}

function updateTrainingQuizOptionText(questionIndex, optionIndex, value) {
  const question = trainingDraftQuizQuestions[questionIndex];
  const option = question?.options?.[optionIndex];
  if (!option) return;
  option.text = value;
}

function setTrainingQuizCorrectOption(questionIndex, optionId) {
  const question = trainingDraftQuizQuestions[questionIndex];
  if (!question) return;
  question.correctOptionId = optionId;
}

function addTrainingBlock(type) {
  trainingDraftBlocks.push(createTrainingBlock(type));
  renderTrainingBlocksEditor();
}

function removeTrainingBlock(index) {
  if (index < 0 || index >= trainingDraftBlocks.length) return;
  trainingDraftBlocks.splice(index, 1);
  renderTrainingBlocksEditor();
}

function updateTrainingBlockField(index, field, value) {
  const block = trainingDraftBlocks[index];
  if (!block) return;
  block[field] = value;
  if (field === 'imageUrls' || field === 'imageUrl') renderTrainingBlocksEditor();
}

function setTrainingVideoOnBlock(index, url) {
  const block = trainingDraftBlocks[index];
  if (!block || block.type !== 'video') return;
  block.url = String(url || '').trim();
  renderTrainingBlocksEditor();
}

function clearTrainingVideoFromBlock(index) {
  const block = trainingDraftBlocks[index];
  if (!block || block.type !== 'video') return;
  block.url = '';
  renderTrainingBlocksEditor();
}

function addTrainingImageToBlock(index, url) {
  const block = trainingDraftBlocks[index];
  if (!block || block.type !== 'image') return;
  if (!Array.isArray(block.imageUrls)) block.imageUrls = (block.imageUrl ? [block.imageUrl] : []);
  block.imageUrls.push(url);
  if (block.imageUrl) delete block.imageUrl;
  renderTrainingBlocksEditor();
}

function removeTrainingImageFromBlock(index, imgIndex) {
  const block = trainingDraftBlocks[index];
  if (!block || block.type !== 'image' || !Array.isArray(block.imageUrls)) return;
  block.imageUrls.splice(imgIndex, 1);
  renderTrainingBlocksEditor();
}

function addStepToBlock(index) {
  const block = trainingDraftBlocks[index];
  if (!block || block.type !== 'steps') return;
  block.steps = Array.isArray(block.steps) ? block.steps : [];
  block.steps.push('');
  renderTrainingBlocksEditor();
}

function removeStepFromBlock(index, stepIdx) {
  const block = trainingDraftBlocks[index];
  if (!block || block.type !== 'steps' || !Array.isArray(block.steps)) return;
  block.steps.splice(stepIdx, 1);
  if (!block.steps.length) block.steps.push('');
  renderTrainingBlocksEditor();
}

function updateStepInBlock(index, stepIdx, value) {
  const block = trainingDraftBlocks[index];
  if (!block || block.type !== 'steps') return;
  block.steps = Array.isArray(block.steps) ? block.steps : [];
  if (stepIdx < 0 || stepIdx >= block.steps.length) return;
  block.steps[stepIdx] = value;
}

function renderTrainingBlocksEditor() {
  const wrap = document.getElementById('trainingBlocksEditor');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!trainingDraftBlocks.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:12px;color:#9ca3af;padding:10px 0;';
    empty.textContent = 'No content blocks added yet.';
    wrap.appendChild(empty);
    return;
  }

  trainingDraftBlocks.forEach((block, index) => {
    const card = document.createElement('div');
    card.style.cssText = 'border:1px solid #e5e7eb;border-radius:10px;padding:12px;background:#fff;display:grid;gap:10px;';
    const typeLabel = toLabel(block.type);
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;';
    header.innerHTML = `<span style="font-size:12px;font-weight:600;color:#7c3aed;">${typeLabel} Block</span>`;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-pill';
    removeBtn.textContent = 'Remove Block';
    removeBtn.style.cssText = 'font-size:11px;padding:4px 10px;color:#dc2626;border-color:#fecaca;background:#fff;';
    removeBtn.onclick = () => removeTrainingBlock(index);
    header.appendChild(removeBtn);
    card.appendChild(header);

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = 'Block Title';
    titleInput.value = block.title || '';
    titleInput.style.cssText = 'width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;';
    titleInput.oninput = (e) => updateTrainingBlockField(index, 'title', e.target.value);
    card.appendChild(titleInput);

    if (block.type === 'text') {
      const body = document.createElement('textarea');
      body.rows = 3;
      body.placeholder = 'Body';
      body.value = block.body || '';
      body.style.cssText = 'width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;resize:vertical;';
      body.oninput = (e) => updateTrainingBlockField(index, 'body', e.target.value);
      card.appendChild(body);
    } else if (block.type === 'steps') {
      const stepsWrap = document.createElement('div');
      stepsWrap.style.cssText = 'display:grid;gap:8px;';
      const steps = Array.isArray(block.steps) ? block.steps : [];
      steps.forEach((step, stepIdx) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;align-items:center;';
        const stepInput = document.createElement('input');
        stepInput.type = 'text';
        stepInput.placeholder = `Step ${stepIdx + 1}`;
        stepInput.value = step || '';
        stepInput.style.cssText = 'flex:1;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;';
        stepInput.oninput = (e) => updateStepInBlock(index, stepIdx, e.target.value);
        const removeStepBtn = document.createElement('button');
        removeStepBtn.type = 'button';
        removeStepBtn.className = 'btn-pill';
        removeStepBtn.textContent = 'Remove';
        removeStepBtn.style.cssText = 'font-size:11px;padding:4px 10px;';
        removeStepBtn.onclick = () => removeStepFromBlock(index, stepIdx);
        row.append(stepInput, removeStepBtn);
        stepsWrap.appendChild(row);
      });
      const addStepBtn = document.createElement('button');
      addStepBtn.type = 'button';
      addStepBtn.className = 'btn-pill';
      addStepBtn.textContent = 'Add Step';
      addStepBtn.style.cssText = 'font-size:11px;padding:5px 10px;justify-self:start;';
      addStepBtn.onclick = () => addStepToBlock(index);
      card.append(stepsWrap, addStepBtn);
    } else if (block.type === 'video') {
      const uploadWrap = document.createElement('div');
      uploadWrap.style.cssText = 'display:grid;gap:10px;';
      const uploadLabel = document.createElement('label');
      uploadLabel.style.cssText = 'display:block;font-size:11px;font-weight:600;color:#374151;margin-bottom:4px;';
      uploadLabel.textContent = 'Upload Video';
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'video/mp4,video/webm,video/*';
      fileInput.style.cssText = 'width:100%;padding:8px;border:1px dashed #d1d5db;border-radius:8px;font-size:12px;cursor:pointer;';
      fileInput.onchange = async (e) => {
        const file = e.target?.files?.[0];
        if (!file) return;
        if (!window.ffUploadTrainingVideo) { console.warn('[Training] ffUploadTrainingVideo not available'); return; }
        fileInput.disabled = true;
        try {
          const salonId = getCurrentTrainingSalonId();
          const trainingIdOrTempId = editingTrainingItemId || ('draft_' + (block.id || Date.now()));
          const { url } = await window.ffUploadTrainingVideo({ salonId, trainingIdOrTempId, file });
          setTrainingVideoOnBlock(index, url);
        } catch (err) {
          console.error('[Training] Video upload failed:', err);
          alert('Video upload failed. Please try again.');
        } finally {
          fileInput.disabled = false;
        }
        e.target.value = '';
      };
      uploadWrap.append(uploadLabel, fileInput);
      card.appendChild(uploadWrap);
      if (block.url) {
        const prevWrap = document.createElement('div');
        prevWrap.style.cssText = 'display:grid;gap:8px;margin-top:8px;';
        const video = document.createElement('video');
        video.src = block.url;
        video.controls = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.style.cssText = 'width:100%;max-height:260px;border-radius:8px;border:1px solid #e5e7eb;background:#000;';
        const actionsRow = document.createElement('div');
        actionsRow.style.cssText = 'display:flex;justify-content:flex-end;';
        const removeVideoBtn = document.createElement('button');
        removeVideoBtn.type = 'button';
        removeVideoBtn.className = 'btn-pill';
        removeVideoBtn.textContent = 'Remove Video';
        removeVideoBtn.style.cssText = 'font-size:11px;padding:4px 10px;color:#dc2626;border-color:#fecaca;background:#fff;';
        removeVideoBtn.onclick = () => clearTrainingVideoFromBlock(index);
        actionsRow.appendChild(removeVideoBtn);
        prevWrap.append(video, actionsRow);
        card.appendChild(prevWrap);
      }
    } else if (block.type === 'image') {
      const urls = Array.isArray(block.imageUrls) ? block.imageUrls : (block.imageUrl ? [block.imageUrl] : []);
      const uploadWrap = document.createElement('div');
      uploadWrap.style.cssText = 'display:grid;gap:10px;';
      const uploadLabel = document.createElement('label');
      uploadLabel.style.cssText = 'display:block;font-size:11px;font-weight:600;color:#374151;margin-bottom:4px;';
      uploadLabel.textContent = 'Upload Images';
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.multiple = true;
      fileInput.style.cssText = 'width:100%;padding:8px;border:1px dashed #d1d5db;border-radius:8px;font-size:12px;cursor:pointer;';
      fileInput.onchange = async (e) => {
        const files = Array.from(e.target?.files || []).filter((f) => f.type?.startsWith('image/'));
        if (!files.length) return;
        if (!window.ffUploadTrainingImage) { console.warn('[Training] ffUploadTrainingImage not available'); return; }
        fileInput.disabled = true;
        try {
          const salonId = getCurrentTrainingSalonId();
          const trainingIdOrTempId = editingTrainingItemId || ('draft_' + (trainingDraftBlocks[0]?.id || Date.now()));
          for (const file of files) {
            const { url } = await window.ffUploadTrainingImage({ salonId, trainingIdOrTempId, file });
            addTrainingImageToBlock(index, url);
          }
        } catch (err) {
          console.error('[Training] Image upload failed:', err);
          alert('Upload failed. Please try again.');
        } finally {
          fileInput.disabled = false;
        }
        e.target.value = '';
      };
      uploadWrap.append(uploadLabel, fileInput);
      card.appendChild(uploadWrap);
      if (urls.length) {
        const prevWrap = document.createElement('div');
        prevWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;';
        urls.forEach((url, imgIdx) => {
          const box = document.createElement('div');
          box.style.cssText = 'position:relative;flex-shrink:0;';
          const prevImg = document.createElement('img');
          prevImg.src = url;
          prevImg.alt = 'Preview';
          prevImg.style.cssText = 'max-width:100%;max-height:100px;width:auto;height:100px;border-radius:8px;border:1px solid #e5e7eb;object-fit:cover;';
          prevImg.onerror = () => { prevImg.style.display = 'none'; };
          const rmBtn = document.createElement('button');
          rmBtn.type = 'button';
          rmBtn.textContent = 'x';
          rmBtn.style.cssText = 'position:absolute;top:4px;right:4px;width:22px;height:22px;border:none;background:rgba(0,0,0,0.6);color:#fff;border-radius:50%;cursor:pointer;font-size:16px;line-height:1;padding:0;';
          rmBtn.onclick = () => removeTrainingImageFromBlock(index, imgIdx);
          box.append(prevImg, rmBtn);
          prevWrap.appendChild(box);
        });
        card.appendChild(prevWrap);
      }
    }

    wrap.appendChild(card);
  });
}

function renderTrainingQuizEditor() {
  const wrap = document.getElementById('trainingQuizEditor');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!trainingDraftQuizQuestions.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:12px;color:#9ca3af;padding:10px 0;';
    empty.textContent = 'No quiz questions yet.';
    wrap.appendChild(empty);
    return;
  }

  trainingDraftQuizQuestions.forEach((question, questionIndex) => {
    const card = document.createElement('div');
    card.style.cssText = 'border:1px solid #e5e7eb;border-radius:10px;padding:12px;background:#fff;display:grid;gap:10px;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;';
    header.innerHTML = `<span style="font-size:12px;font-weight:600;color:#7c3aed;">Question ${questionIndex + 1}</span>`;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-pill';
    removeBtn.textContent = 'Remove Question';
    removeBtn.style.cssText = 'font-size:11px;padding:4px 10px;color:#dc2626;border-color:#fecaca;background:#fff;';
    removeBtn.onclick = () => removeTrainingQuizQuestion(questionIndex);
    header.appendChild(removeBtn);
    card.appendChild(header);

    const textInput = document.createElement('textarea');
    textInput.rows = 2;
    textInput.placeholder = 'Question text';
    textInput.value = question.text || '';
    textInput.style.cssText = 'width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;resize:vertical;';
    textInput.oninput = (e) => updateTrainingQuizQuestionText(questionIndex, e.target.value);
    card.appendChild(textInput);

    const optionsWrap = document.createElement('div');
    optionsWrap.style.cssText = 'display:grid;gap:8px;';
    const options = Array.isArray(question.options) ? question.options : [];
    options.forEach((option, optionIndex) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `trainingQuizCorrect_${question.id}`;
      radio.checked = question.correctOptionId === option.id;
      radio.onchange = () => setTrainingQuizCorrectOption(questionIndex, option.id);

      const optionInput = document.createElement('input');
      optionInput.type = 'text';
      optionInput.placeholder = `Option ${optionIndex + 1}`;
      optionInput.value = option.text || '';
      optionInput.style.cssText = 'width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;';
      optionInput.oninput = (e) => updateTrainingQuizOptionText(questionIndex, optionIndex, e.target.value);

      const removeOptionBtn = document.createElement('button');
      removeOptionBtn.type = 'button';
      removeOptionBtn.className = 'btn-pill';
      removeOptionBtn.textContent = 'Remove';
      removeOptionBtn.style.cssText = 'font-size:11px;padding:4px 10px;';
      removeOptionBtn.disabled = options.length <= 2;
      removeOptionBtn.onclick = () => removeTrainingQuizOption(questionIndex, optionIndex);

      row.append(radio, optionInput, removeOptionBtn);
      optionsWrap.appendChild(row);
    });

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;';
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:11px;color:#6b7280;';
    hint.textContent = '2-5 options. Select one correct answer.';
    const addOptionBtn = document.createElement('button');
    addOptionBtn.type = 'button';
    addOptionBtn.className = 'btn-pill';
    addOptionBtn.textContent = 'Add Option';
    addOptionBtn.style.cssText = 'font-size:11px;padding:5px 10px;';
    addOptionBtn.disabled = options.length >= 5;
    addOptionBtn.onclick = () => addTrainingQuizOption(questionIndex);

    footer.append(hint, addOptionBtn);
    card.append(optionsWrap, footer);
    wrap.appendChild(card);
  });
}

function normalizeTrainingBlocks(blocks) {
  return (blocks || [])
    .map((block) => {
      if (!block || !block.type) return null;
      const base = { id: block.id || `blk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, type: block.type, title: (block.title || '').trim() };
      if (block.type === 'text') return { ...base, body: (block.body || '').trim() };
      if (block.type === 'steps') {
        const steps = (Array.isArray(block.steps) ? block.steps : []).map((s) => String(s || '').trim()).filter(Boolean);
        return { ...base, steps };
      }
      if (block.type === 'video') return { ...base, url: (block.url || '').trim() };
      if (block.type === 'image') {
        const urls = Array.isArray(block.imageUrls) ? block.imageUrls : (block.imageUrl ? [block.imageUrl] : []);
        return { ...base, imageUrls: urls.map((u) => String(u || '').trim()).filter(Boolean) };
      }
      return null;
    })
    .filter(Boolean)
    .filter((block) => {
      if (block.type === 'text') return !!(block.title || block.body);
      if (block.type === 'steps') return !!(block.steps && block.steps.length);
      if (block.type === 'video') return !!block.url;
      if (block.type === 'image') return !!(block.title || (block.imageUrls && block.imageUrls.length));
      return false;
    });
}

function normalizeTrainingQuizQuestions(questions) {
  return (questions || [])
    .map((question) => {
      const options = (Array.isArray(question?.options) ? question.options : [])
        .map((option) => ({
          id: option?.id || `opt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          text: String(option?.text || '').trim(),
        }))
        .filter((option) => option.text);
      const normalized = {
        id: question?.id || `quiz_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        text: String(question?.text || '').trim(),
        options,
        correctOptionId: String(question?.correctOptionId || '').trim(),
      };
      const hasContent = normalized.text || normalized.options.length || normalized.correctOptionId;
      return hasContent ? normalized : null;
    })
    .filter(Boolean);
}

function getFilteredTrainingItems() {
  const userCtx = getCurrentTrainingUserContext();
  // First apply the active-location gate to every item - no matter what tab
  // is selected. "My Training" and "Required" are further narrowed by role
  // and technician type below, but the location filter must precede them so
  // that the Library tab (visible to managers/owners) also respects the
  // active location. This matches how Inventory/Tasks/Queue behave.
  let scopedItems = trainingItems.filter((item) => isTrainingVisibleAtCurrentLocation(item));
  if (trainingViewMode === 'my') {
    scopedItems = scopedItems.filter((item) => isTrainingRelevantToCurrentUser(item, userCtx));
  } else if (trainingViewMode === 'required') {
    scopedItems = scopedItems.filter((item) => isTrainingRequiredForUser(item, userCtx));
  }
  const q = trainingSearchQuery.trim().toLowerCase();
  return scopedItems.filter((item) => {
    if (trainingCategoryFilter !== 'all' && item.category !== trainingCategoryFilter) return false;
    if (trainingRoleFilter !== 'all' && !(Array.isArray(item.visibleToRoles) && item.visibleToRoles.includes(trainingRoleFilter))) return false;
    if (trainingRequiredFilter === 'required' && item.required !== true) return false;
    if (trainingRequiredFilter === 'optional' && item.required !== false) return false;
    if (!q) return true;
    const haystack = [
      item.title || '',
      item.category || '',
      item.description || '',
    ].join(' ').toLowerCase();
    return haystack.includes(q);
  });
}

function canUseTrainingRequiredTab() {
  return !canManageTraining();
}

function canManageTraining() {
  // Branch managers now get to create/edit training so they can author
  // content for their own location (using the location chips in the
  // training modal). Owners and admins keep salon-wide authoring rights.
  // Read access is governed by the visibility rules (role/tech-type/loc),
  // not by this guard.
  const role = String(
    window.__ff_user_role ||
    window.__ff_actorRole ||
    sessionStorage.getItem('ff_actor_role') ||
    ''
  ).toLowerCase().trim();
  return role === 'owner' || role === 'admin' || role === 'manager';
}

function canOverrideTrainingCompletion() {
  const accountRole = String(window.__ff_user_role || '').toLowerCase().trim();
  if (accountRole === 'owner' || accountRole === 'admin' || accountRole === 'manager') return true;
  const actorRole = String(
    window.__ff_actorRole ||
    sessionStorage.getItem('ff_actor_role') ||
    ''
  ).toLowerCase().trim();
  if (actorRole === 'owner' || actorRole === 'admin' || actorRole === 'manager') return true;
  return typeof ffHasAdminAccess === 'function' && ffHasAdminAccess();
}

function canSeeTrainingTabs() {
  const accountRole = String(window.__ff_user_role || '').toLowerCase().trim();
  if (accountRole === 'owner' || accountRole === 'admin') return true;
  const role = String(
    window.__ff_actorRole ||
    sessionStorage.getItem('ff_actor_role') ||
    window.__ff_user_role ||
    ''
  ).toLowerCase().trim();
  return role === 'owner' || role === 'admin';
}

function getCurrentTrainingUserContext() {
  let currentRole = String(
    window.__ff_user_role ||
    window.__ff_actorRole ||
    sessionStorage.getItem('ff_actor_role') ||
    ''
  ).toLowerCase().trim();
  if (currentRole === 'tech' || currentRole === 'staff') currentRole = 'technician';
  const currentStaff = resolveCurrentTrainingStaffRecord();
  if ((!currentRole || currentRole === 'technician') && currentStaff) {
    if (currentStaff.isAdmin === true) currentRole = 'admin';
    else if (currentStaff.isManager === true || String(currentStaff.role || '').toLowerCase().trim() === 'manager') currentRole = 'manager';
    else currentRole = 'technician';
  }
  if (!currentRole && getCurrentTrainingStaffId()) currentRole = 'technician';

  let currentTechnicianTypes = [];
  if (Array.isArray(currentStaff?.technicianTypes) && currentStaff.technicianTypes.length) {
    currentTechnicianTypes = currentStaff.technicianTypes.map((t) => String(t || '').toLowerCase().trim()).filter(Boolean);
  } else if (Array.isArray(window.__ff_authedTechnicianTypes)) {
    currentTechnicianTypes = window.__ff_authedTechnicianTypes.map((t) => String(t || '').toLowerCase().trim()).filter(Boolean);
  } else {
    try {
      const raw = sessionStorage.getItem('ff_authed_technician_types');
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) currentTechnicianTypes = parsed.map((t) => String(t || '').toLowerCase().trim()).filter(Boolean);
    } catch (_) {}
  }

  let normRole = normalizeTrainingAudienceRole(currentRole) || String(currentRole || '').toLowerCase().trim();
  if (!normRole && getCurrentTrainingStaffId()) normRole = 'technician';

  return { currentRole: normRole, currentTechnicianTypes };
}

/**
 * Check whether a training item is visible at the currently active location.
 *
 * Rules:
 * - Training with empty/missing locationIds is "salon-wide" - always visible.
 * - Training with one or more locationIds is only visible when the user's
 *   active location matches one of them.
 * - If we can't determine an active location (single-location salon, or the
 *   location switcher hasn't initialized yet), we fall back to "visible" so
 *   we don't accidentally hide content from users who only operate in one
 *   salon.
 */
function isTrainingVisibleAtCurrentLocation(item) {
  const locIds = Array.isArray(item?.locationIds) ? item.locationIds : [];
  if (!locIds.length) return true;
  const activeLocId = (typeof window !== 'undefined' && typeof window.ffGetActiveLocationId === 'function')
    ? String(window.ffGetActiveLocationId() || '').trim()
    : '';
  if (!activeLocId) return true;
  return locIds.some((id) => String(id || '').trim() === activeLocId);
}

/** Map Firestore / legacy labels to canonical training audience roles */
function normalizeTrainingAudienceRole(raw) {
  const s = String(raw || '').toLowerCase().trim().replace(/[\s_-]+/g, '_');
  if (!s) return '';
  if (
    s === 'tech' ||
    s === 'staff' ||
    s === 'technician' ||
    s === 'specialist' ||
    s === 'service_provider' ||
    s === 'serviceprovider' ||
    s === 'service' ||
    s === 'artist' ||
    s === 'provider' ||
    s === 'employee' ||
    s === 'worker' ||
    s === 'liner' ||
    s === 'line_staff'
  ) return 'technician';
  if (s === 'mgr' || s === 'mgmt') return 'manager';
  if (s === 'administrator' || s === 'super_admin' || s === 'superadmin') return 'admin';
  return s;
}

/** Map stored technician-type tokens (IDs or labels) incl. human "All …" variants */
function normalizeTrainingTechTypeKey(raw) {
  const s = String(raw || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (!s) return '';
  if (
    s === 'all_technicians' ||
    s === 'alltechnicians' ||
    s === 'all_service_providers' ||
    s === 'allserviceproviders' ||
    s === 'everyone' ||
    s === 'all'
  ) return 'all_technicians';
  return s;
}

function isTrainingRelevantToCurrentUser(item, ctx) {
  const role = normalizeTrainingAudienceRole(ctx?.currentRole || '');
  if (!role) return false;
  const visibleSet = new Set(
    (Array.isArray(item?.visibleToRoles) ? item.visibleToRoles : []).map((r) => normalizeTrainingAudienceRole(r)).filter(Boolean)
  );
  if (!visibleSet.has(role)) return false;
  // Location gate: trainings targeted at specific locations only reach
  // staff who are currently working at one of those locations.
  if (!isTrainingVisibleAtCurrentLocation(item)) return false;
  if (role !== 'technician') return true;

  const techTypesRaw = Array.isArray(item?.technicianTypes) ? item.technicianTypes : [];
  const techNorm = techTypesRaw.map(normalizeTrainingTechTypeKey).filter(Boolean);
  if (!techNorm.length) return true;
  if (techNorm.includes('all_technicians')) return true;

  const myTypes = Array.isArray(ctx?.currentTechnicianTypes) ? ctx.currentTechnicianTypes : [];
  const myNorm = myTypes.map(normalizeTrainingTechTypeKey).filter(Boolean);
  // Profiles without technician types loaded yet: don't block "open to everyone" trainings
  // (fixes mobile where staff doc types hydrate later than Library render).
  if (!myNorm.length) return false;
  return techNorm.some((tid) => myNorm.includes(tid));
}

function isTrainingRequiredForUser(item, ctx) {
  return item.required === true && isTrainingRelevantToCurrentUser(item, ctx);
}

async function populateTrainingTechTypes() {
  const container = document.getElementById('trainingTechTypesCheckboxes');
  if (!container) return;
  // Keep "All Service Providers" checkbox, rebuild the rest
  const allLabel = container.querySelector('label');
  container.innerHTML = '';
  if (allLabel) container.appendChild(allLabel);
  if (typeof window.ffGetTechnicianTypes !== 'function') return;
  try {
    const types = await window.ffGetTechnicianTypes();
    const active = types.filter(t => t.active !== false);
    active.forEach(t => {
      const lbl = document.createElement('label');
      lbl.className = 'ttm-chip';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.name = 'trainingTechnicianType';
      cb.value = t.id;
      lbl.appendChild(cb);
      const dot = document.createElement('span');
      dot.className = 'ttm-chip-dot';
      dot.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      lbl.appendChild(dot);
      const txt = document.createElement('span');
      txt.textContent = t.name || t.id;
      lbl.appendChild(txt);
      container.appendChild(lbl);
    });
  } catch(e) { console.warn('[Training] Could not load service provider types', e); }
  syncTechnicianTypesUI();
}

function syncTechnicianTypesUI() {
  const roleTechnician = document.querySelector('input[name="trainingVisibleRole"][value="technician"]');
  const typesWrap = document.getElementById('trainingTechnicianTypesWrap');
  const allTechCb = document.querySelector('input[name="trainingTechnicianType"][value="all_technicians"]');
  const typeCheckboxes = Array.from(document.querySelectorAll('input[name="trainingTechnicianType"]')).filter((cb) => cb.value !== 'all_technicians');
  const technicianSelected = !!roleTechnician?.checked;

  if (typesWrap) typesWrap.style.display = technicianSelected ? 'block' : 'none';
  if (!technicianSelected) {
    document.querySelectorAll('input[name="trainingTechnicianType"]').forEach((cb) => { cb.checked = false; cb.disabled = false; });
    return;
  }

  const allSelected = !!allTechCb?.checked;
  typeCheckboxes.forEach((cb) => {
    cb.disabled = allSelected;
    if (allSelected) cb.checked = false;
  });
}

function resetTrainingForm() {
  const titleInput = document.getElementById('trainingTitleInput');
  const categorySelect = document.getElementById('trainingCategoryInput');
  const requiredInput = document.getElementById('trainingRequiredInput');
  const sendNotificationInput = document.getElementById('trainingSendNotificationInput');
  const descriptionInput = document.getElementById('trainingDescriptionInput');
  const validation = document.getElementById('trainingValidationMsg');
  if (titleInput) titleInput.value = '';
  if (categorySelect) categorySelect.value = '';
  if (requiredInput) requiredInput.checked = false;
  if (sendNotificationInput) sendNotificationInput.checked = false;
  if (descriptionInput) descriptionInput.value = '';
  document.querySelectorAll('input[name="trainingVisibleRole"]').forEach((cb) => { cb.checked = false; });
  document.querySelectorAll('input[name="trainingTechnicianType"]').forEach((cb) => { cb.checked = false; cb.disabled = false; });
  populateTrainingLocationCheckboxes([]);
  trainingDraftBlocks = [];
  trainingDraftQuizQuestions = [];
  if (validation) validation.style.display = 'none';
  syncTechnicianTypesUI();
  renderTrainingBlocksEditor();
  renderTrainingQuizEditor();
}

/**
 * Rebuild the "Visible At Locations" checkbox list inside the training modal.
 *
 * - If the salon has zero or one location we hide the whole section, because
 *   the concept of "per-location training" is meaningless there.
 * - An "All locations" master checkbox sits on top. When it's checked, the
 *   individual location checkboxes are cleared and disabled - this mirrors
 *   the "select all_technicians or specific types" pattern we use for
 *   Service Provider Types and keeps the UX consistent.
 * - `preSelected` is the array of locationIds already saved on the training
 *   (empty for new trainings or legacy salon-wide trainings).
 */
function populateTrainingLocationCheckboxes(preSelected) {
  const wrap = document.getElementById('trainingLocationsWrap');
  const container = document.getElementById('trainingLocationsCheckboxes');
  if (!wrap || !container) return;
  const locations = (typeof window !== 'undefined' && typeof window.ffGetActiveLocations === 'function')
    ? (window.ffGetActiveLocations() || [])
    : [];
  if (!Array.isArray(locations) || locations.length <= 1) {
    wrap.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  wrap.style.display = 'block';
  const selected = Array.isArray(preSelected)
    ? preSelected.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const isAllLocations = selected.length === 0;
  container.innerHTML = '';

  // Helper that builds a chip-styled label matching the modern modal design.
  // Each chip wraps a hidden native checkbox so the existing form logic (which
  // reads `input[name="trainingLocation"]:checked`) keeps working unchanged.
  const buildChip = (value, labelText, checked, disabled) => {
    const lbl = document.createElement('label');
    lbl.className = 'ttm-chip';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.name = 'trainingLocation';
    cb.value = value;
    cb.checked = !!checked;
    cb.disabled = !!disabled;
    lbl.appendChild(cb);
    const dot = document.createElement('span');
    dot.className = 'ttm-chip-dot';
    dot.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    lbl.appendChild(dot);
    const txt = document.createElement('span');
    txt.textContent = labelText;
    lbl.appendChild(txt);
    return { label: lbl, input: cb };
  };

  const { label: allLabel, input: allCb } = buildChip('__all__', 'All locations', isAllLocations, false);
  container.appendChild(allLabel);

  locations.forEach((loc) => {
    if (!loc || !loc.id) return;
    const { label: lbl } = buildChip(
      String(loc.id),
      loc.name || loc.id,
      selected.includes(String(loc.id)),
      isAllLocations
    );
    container.appendChild(lbl);
  });

  // Wire up the "All locations" toggle so it clears + disables the specific
  // checkboxes when re-activated. This prevents the user from saving an
  // inconsistent state like "All locations + Brickell only".
  allCb.addEventListener('change', () => {
    const specific = container.querySelectorAll('input[name="trainingLocation"]:not([value="__all__"])');
    if (allCb.checked) {
      specific.forEach((el) => { el.checked = false; el.disabled = true; });
    } else {
      specific.forEach((el) => { el.disabled = false; });
    }
  });
  // Unchecking every specific location auto-restores the "All" state.
  container.querySelectorAll('input[name="trainingLocation"]:not([value="__all__"])').forEach((el) => {
    el.addEventListener('change', () => {
      const anyChecked = Array.from(container.querySelectorAll('input[name="trainingLocation"]:not([value="__all__"])'))
        .some((c) => c.checked);
      if (anyChecked) {
        allCb.checked = false;
      }
    });
  });
}

function bindTrainingFormEvents() {
  document.querySelectorAll('input[name="trainingVisibleRole"]').forEach((cb) => {
    cb.onchange = () => {
      if (cb.value === 'technician' && cb.checked) {
        populateTrainingTechTypes();
      } else {
        syncTechnicianTypesUI();
      }
    };
  });
  const allTechCb = document.querySelector('input[name="trainingTechnicianType"][value="all_technicians"]');
  if (allTechCb) allTechCb.onchange = () => syncTechnicianTypesUI();
}

/**
 * Ensure the modal sits as a direct child of <body> and has a rock-solid
 * overlay style. We were seeing cases where the card collapsed to a tiny
 * strip at the top of the viewport - symptom of an ancestor clipping it
 * with overflow:hidden or breaking position:fixed with a transform. Moving
 * to body and forcing the critical styles defensively eliminates that.
 */
function _ffEnsureTrainingModalPortal() {
  const modal = document.getElementById('createTrainingModal');
  if (!modal) return null;
  if (modal.parentElement !== document.body) {
    try { document.body.appendChild(modal); } catch (_) {}
  }
  modal.style.setProperty('position', 'fixed', 'important');
  modal.style.setProperty('top', '0', 'important');
  modal.style.setProperty('left', '0', 'important');
  modal.style.setProperty('right', '0', 'important');
  modal.style.setProperty('bottom', '0', 'important');
  modal.style.setProperty('width', '100vw', 'important');
  modal.style.setProperty('height', '100vh', 'important');
  modal.style.setProperty('z-index', '2147483647', 'important');
  modal.style.setProperty('background', 'rgba(0,0,0,0.45)', 'important');
  modal.style.setProperty('isolation', 'isolate', 'important');
  modal.style.setProperty('align-items', 'flex-start', 'important');
  modal.style.setProperty('justify-content', 'center', 'important');
  modal.style.setProperty('padding', '40px 20px 20px', 'important');
  modal.style.setProperty('overflow-y', 'auto', 'important');
  modal.style.setProperty('overflow-x', 'hidden', 'important');
  modal.style.setProperty('margin', '0', 'important');
  modal.style.setProperty('transform', 'none', 'important');
  modal.style.setProperty('pointer-events', 'auto', 'important');
  // Also bulletproof the inner card so it gets a proper width and is never
  // collapsed to a tiny strip by some inherited CSS.
  const card = modal.firstElementChild;
  if (card && card.tagName === 'DIV') {
    card.style.setProperty('width', '100%', 'important');
    card.style.setProperty('max-width', '640px', 'important');
    card.style.setProperty('min-height', '200px', 'important');
    card.style.setProperty('max-height', 'calc(100vh - 80px)', 'important');
    card.style.setProperty('background', '#fff', 'important');
    card.style.setProperty('border-radius', '12px', 'important');
    card.style.setProperty('padding', '20px 20px 16px', 'important');
    card.style.setProperty('box-shadow', '0 12px 36px rgba(0,0,0,0.22)', 'important');
    card.style.setProperty('overflow-y', 'auto', 'important');
    card.style.setProperty('flex-shrink', '0', 'important');
    card.style.setProperty('margin', '0 auto', 'important');
    card.style.setProperty('position', 'relative', 'important');
    card.style.setProperty('z-index', '1', 'important');
  }
  return modal;
}

function openCreateTrainingModal() {
  try { console.log('TrainingModal opening'); } catch (_) {}
  const modal = _ffEnsureTrainingModalPortal();
  const modalTitle = document.getElementById('trainingModalTitle');
  const saveBtn = document.getElementById('trainingSaveBtn');
  if (!modal) return;
  editingTrainingItemId = null;
  try { resetTrainingForm(); } catch (err) { console.error('resetTrainingForm failed', err); }
  if (modalTitle) modalTitle.textContent = 'Create Training';
  if (saveBtn) saveBtn.textContent = 'Save';
  try { bindTrainingFormEvents(); } catch (err) { console.error('bindTrainingFormEvents failed', err); }
  modal.style.setProperty('display', 'flex', 'important');
}

function openEditTrainingModal(itemId) {
  const item = trainingItems.find((x) => x.id === itemId);
  const modal = _ffEnsureTrainingModalPortal();
  const modalTitle = document.getElementById('trainingModalTitle');
  const saveBtn = document.getElementById('trainingSaveBtn');
  const titleInput = document.getElementById('trainingTitleInput');
  const categorySelect = document.getElementById('trainingCategoryInput');
  const requiredInput = document.getElementById('trainingRequiredInput');
  const descriptionInput = document.getElementById('trainingDescriptionInput');
  if (!item || !modal) return;

  editingTrainingItemId = itemId;
  resetTrainingForm();
  if (titleInput) titleInput.value = item.title || '';
  if (categorySelect) categorySelect.value = item.category || '';
  if (requiredInput) requiredInput.checked = !!item.required;
  if (descriptionInput) descriptionInput.value = item.description || '';
  (item.visibleToRoles || []).forEach((r) => {
    const cb = document.querySelector(`input[name="trainingVisibleRole"][value="${r}"]`);
    if (cb) cb.checked = true;
  });
  (item.technicianTypes || []).forEach((t) => {
    const cb = document.querySelector(`input[name="trainingTechnicianType"][value="${t}"]`);
    if (cb) cb.checked = true;
  });
  populateTrainingLocationCheckboxes(Array.isArray(item.locationIds) ? item.locationIds : []);
  trainingDraftBlocks = (item.contentBlocks || []).map((b) => JSON.parse(JSON.stringify(b)));
  trainingDraftQuizQuestions = (item.quizQuestions || []).map((q) => JSON.parse(JSON.stringify(q)));
  syncTechnicianTypesUI();
  renderTrainingBlocksEditor();
  renderTrainingQuizEditor();
  if (modalTitle) modalTitle.textContent = 'Edit Training';
  if (saveBtn) saveBtn.textContent = 'Save Changes';
  bindTrainingFormEvents();
  modal.style.setProperty('display', 'flex', 'important');
}

function closeCreateTrainingModal() {
  const modal = document.getElementById('createTrainingModal');
  if (modal) modal.style.setProperty('display', 'none', 'important');
}

function ffCloseTrainingOverlaysForNavigation() {
  try {
    if (typeof closeCreateTrainingModal === 'function') closeCreateTrainingModal();
  } catch (_) {}
  try {
    ['createTrainingModal', 'addTechnicianTypeModal'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.setProperty('display', 'none', 'important');
        el.style.pointerEvents = 'none';
      }
    });
  } catch (_) {}
  try {
    ['trainingAdminConfirmModal', 'trainingAdminNoticeModal'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
  } catch (_) {}
  try {
    document.body.style.overflow = '';
  } catch (_) {}
}
window.ffCloseTrainingOverlaysForNavigation = ffCloseTrainingOverlaysForNavigation;

function collectTrainingFormData() {
  const titleInput = document.getElementById('trainingTitleInput');
  const categorySelect = document.getElementById('trainingCategoryInput');
  const requiredInput = document.getElementById('trainingRequiredInput');
  const sendNotificationInput = document.getElementById('trainingSendNotificationInput');
  const descriptionInput = document.getElementById('trainingDescriptionInput');
  // Collect selected locations. The "__all__" sentinel means "salon-wide" and
  // is persisted as an empty array (matches legacy trainings created before
  // per-location scoping existed). Any specific selection overrides "__all__"
  // even if both were somehow checked, to avoid an inconsistent record.
  const allLocCb = document.querySelector('input[name="trainingLocation"][value="__all__"]');
  const specificLocIds = Array.from(document.querySelectorAll('input[name="trainingLocation"]:checked'))
    .map((el) => el.value)
    .filter((v) => v && v !== '__all__');
  const locationIds = (allLocCb && allLocCb.checked && specificLocIds.length === 0)
    ? []
    : specificLocIds;
  return {
    title: titleInput?.value?.trim() || '',
    category: categorySelect?.value?.trim() || '',
    visibleToRoles: Array.from(document.querySelectorAll('input[name="trainingVisibleRole"]:checked')).map((el) => el.value),
    technicianTypes: Array.from(document.querySelectorAll('input[name="trainingTechnicianType"]:checked')).map((el) => el.value),
    locationIds,
    required: !!requiredInput?.checked,
    sendNotificationNow: !!sendNotificationInput?.checked,
    description: descriptionInput?.value?.trim() || '',
    contentBlocks: normalizeTrainingBlocks(trainingDraftBlocks),
    quizQuestions: normalizeTrainingQuizQuestions(trainingDraftQuizQuestions),
  };
}

function validateTrainingForm(data) {
  if (!data.title || !data.category) return 'Title and Category are required.';
  if (data.visibleToRoles.includes('technician')) {
    const hasAll = data.technicianTypes.includes('all_technicians');
    const hasSpecific = data.technicianTypes.some((t) => t !== 'all_technicians');
    if (!hasAll && !hasSpecific) return 'Select all_technicians or at least one technician type.';
  }
  for (let i = 0; i < data.quizQuestions.length; i += 1) {
    const question = data.quizQuestions[i];
    if (!question.text) return `Quiz question ${i + 1} needs question text.`;
    if (!Array.isArray(question.options) || question.options.length < 2 || question.options.length > 5) {
      return `Quiz question ${i + 1} must have 2-5 answers.`;
    }
    if (question.options.some((option) => !option.text)) {
      return `Quiz question ${i + 1} has an empty answer option.`;
    }
    if (!question.correctOptionId || !question.options.some((option) => option.id === question.correctOptionId)) {
      return `Quiz question ${i + 1} needs one correct answer.`;
    }
  }
  return '';
}

async function saveTrainingItemLocal() {
  const validation = document.getElementById('trainingValidationMsg');
  const data = collectTrainingFormData();
  const validationMsg = validateTrainingForm(data);
  if (validation) validation.style.display = 'none';
  if (validationMsg) {
    if (validation) {
      validation.textContent = validationMsg;
      validation.style.display = 'block';
    }
    return;
  }

  let savedTrainingId = '';
  let notificationResult = null;
  let notificationError = null;
  try {
    if (editingTrainingItemId) {
      savedTrainingId = await updateTrainingItem(editingTrainingItemId, data);
    } else {
      savedTrainingId = await createTrainingItem(data);
    }
  } catch (err) {
    console.error('[Training] Save failed', err);
    if (validation) {
      validation.textContent = err?.message || 'Failed to save training item.';
      validation.style.display = 'block';
    }
    return;
  }

  if (data.sendNotificationNow) {
    try {
      notificationResult = await sendTrainingAssignmentNotifications({
        ...data,
        id: savedTrainingId,
      });
    } catch (err) {
      notificationError = err;
      console.error('[Training] Notification send failed', err);
    }
  }

  closeCreateTrainingModal();
  editingTrainingItemId = null;
  selectedTrainingItemId = null;
  await loadTrainingItems();
  renderTrainingLibrary();
  if (data.sendNotificationNow) {
    if (notificationError) {
      await showTrainingAdminNotice({
        title: 'Training Saved',
        message: `Training was saved, but notifications could not be created: ${notificationError?.message || 'Unknown error.'}`,
        buttonLabel: 'OK',
      });
    } else {
      const count = Number(notificationResult?.count || 0);
      await showTrainingAdminNotice({
        title: 'Notifications Ready',
        message: count > 0
          ? `Training saved and notifications were created for ${count} assigned staff members.`
          : 'Training saved. No assigned staff matched the selected roles and technician types.',
        buttonLabel: 'OK',
      });
    }
  }
}

async function deleteTrainingItemLocal(itemId) {
  const confirmed = await showDeleteConfirm('this training item');
  if (!confirmed) return;
  try {
    await deleteTrainingItem(itemId);
  } catch (err) {
    console.error('[Training] Delete failed', err);
    alert(err?.message || 'Failed to delete training item.');
    return;
  }
  selectedTrainingItemId = null;
  await loadTrainingItems();
  renderTrainingLibrary();
}

function renderTrainingLibrary() {
  const listView = document.getElementById('trainingLibraryView');
  const detailsView = document.getElementById('trainingDetailsView');
  const listEl = document.getElementById('trainingList');
  const emptyEl = document.getElementById('trainingEmptyState');
  const noMatchEl = document.getElementById('trainingNoMatchState');
  const noRelevantEl = document.getElementById('trainingNoRelevantState');
  const noRequiredEl = document.getElementById('trainingNoRequiredState');
  const loadingEl = document.getElementById('trainingLoadingState');
  const errorEl = document.getElementById('trainingErrorState');
  if (!listEl || !emptyEl || !noMatchEl || !noRelevantEl || !listView || !detailsView || !loadingEl || !errorEl) return;
  renderTrainingAppsBadge();
  renderTrainingNotificationSummary();

  listView.style.display = 'block';
  detailsView.style.display = 'none';
  listEl.innerHTML = '';
  loadingEl.style.display = trainingLoading ? 'block' : 'none';
  errorEl.style.display = trainingError ? 'block' : 'none';
  errorEl.textContent = trainingError || '';
  noMatchEl.style.display = 'none';
  noRelevantEl.style.display = 'none';
  if (noRequiredEl) noRequiredEl.style.display = 'none';

  if (trainingLoading) {
    emptyEl.style.display = 'none';
    noMatchEl.style.display = 'none';
    noRelevantEl.style.display = 'none';
    if (noRequiredEl) noRequiredEl.style.display = 'none';
    listEl.style.display = 'none';
    return;
  }

  if (trainingError) {
    emptyEl.style.display = 'none';
    noMatchEl.style.display = 'none';
    noRelevantEl.style.display = 'none';
    if (noRequiredEl) noRequiredEl.style.display = 'none';
    listEl.style.display = 'none';
    return;
  }

  if (!trainingItems.length) {
    emptyEl.style.display = 'block';
    noMatchEl.style.display = 'none';
    noRelevantEl.style.display = 'none';
    if (noRequiredEl) noRequiredEl.style.display = 'none';
    listEl.style.display = 'none';
    return;
  }

  const userCtx = getCurrentTrainingUserContext();
  const locationGated = trainingItems.filter((item) => isTrainingVisibleAtCurrentLocation(item));
  const scopedItems = trainingViewMode === 'my'
    ? locationGated.filter((item) => isTrainingRelevantToCurrentUser(item, userCtx))
    : trainingViewMode === 'required'
      ? locationGated.filter((item) => isTrainingRequiredForUser(item, userCtx))
      : locationGated;

  const filteredItems = getFilteredTrainingItems();
  emptyEl.style.display = 'none';
  if (trainingViewMode === 'my' && !scopedItems.length) {
    noRelevantEl.style.display = 'block';
    noMatchEl.style.display = 'none';
    if (noRequiredEl) noRequiredEl.style.display = 'none';
    listEl.style.display = 'none';
    return;
  }

  if (trainingViewMode === 'required' && !scopedItems.length) {
    if (noRequiredEl) noRequiredEl.style.display = 'block';
    noMatchEl.style.display = 'none';
    noRelevantEl.style.display = 'none';
    listEl.style.display = 'none';
    return;
  }

  if (!filteredItems.length) {
    noMatchEl.style.display = 'block';
    noRelevantEl.style.display = 'none';
    if (noRequiredEl) noRequiredEl.style.display = 'none';
    listEl.style.display = 'none';
    return;
  }

  noMatchEl.style.display = 'none';
  noRelevantEl.style.display = 'none';
  if (noRequiredEl) noRequiredEl.style.display = 'none';
  listEl.style.display = 'flex';
  let itemsToRender = filteredItems;
  if (!canSeeTrainingTabs()) {
    itemsToRender = [...filteredItems].sort((a, b) => {
      const aCompleted = trainingProgressMap[a.id]?.status === 'completed';
      const bCompleted = trainingProgressMap[b.id]?.status === 'completed';
      const sa = a.required && !aCompleted ? 0 : !aCompleted ? 1 : 2;
      const sb = b.required && !bCompleted ? 0 : !bCompleted ? 1 : 2;
      return sa - sb;
    });
  }
  itemsToRender.forEach((item) => {
    const isCompleted = trainingProgressMap[item.id]?.status === 'completed';
    const isRequired = item.required === true;
    const notification = getTrainingNotificationForItem(item.id);
    const showNewBadge = isTrainingNotificationNew(notification);
    const showRequiredPendingBadge = isRequired && !isCompleted;
    const card = document.createElement('div');
    card.style.cssText = 'background:#fff;border:1px solid #eee;box-shadow:0 1px 2px rgba(0,0,0,0.04);border-radius:8px;padding:10px 12px;display:grid;gap:4px;cursor:pointer;';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:13px;font-weight:600;color:#111827;';
    title.textContent = item.title;

    const meta = document.createElement('div');
    meta.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;';
    const newBadge = showNewBadge
      ? '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:#ede9fe;border:1px solid #c4b5fd;color:#6d28d9;font-weight:700;">NEW</span>'
      : '';
    const requiredBadge = showRequiredPendingBadge
      ? '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:#fee2e2;border:1px solid #fecaca;color:#b91c1c;font-weight:700;">REQUIRED</span>'
      : (canManageTraining() && isRequired
        ? '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:#fef3c7;border:1px solid #f59e0b;color:#b45309;font-weight:600;">Required</span>'
        : '');
    const assignedBadge = notification
      ? `<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:#f5f3ff;border:1px solid #ddd6fe;color:#6d28d9;font-weight:600;">${getTrainingNotificationMessage(notification)}</span>`
      : '';
    const completedBadge = isCompleted
      ? '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:#d1fae5;border:1px solid #10b981;color:#059669;font-weight:600;">Completed -</span>'
      : '';
    // Location badge: tell managers at a glance which locations a training
    // is pinned to. Empty locationIds (the common case) = salon-wide, no
    // badge. Otherwise show the location name(s) so it's obvious when a
    // training will NOT appear at certain branches.
    let locationBadge = '';
    if (Array.isArray(item.locationIds) && item.locationIds.length > 0) {
      const allLocs = (typeof window !== 'undefined' && typeof window.ffGetActiveLocations === 'function')
        ? (window.ffGetActiveLocations() || [])
        : [];
      const nameById = new Map();
      allLocs.forEach((l) => { if (l && l.id) nameById.set(String(l.id), String(l.name || l.id)); });
      const labels = item.locationIds
        .map((id) => nameById.get(String(id)) || String(id))
        .filter(Boolean);
      if (labels.length) {
        locationBadge = `<span title="Training is visible only at these locations" style="font-size:10px;padding:2px 6px;border-radius:4px;background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;font-weight:600;">- ${labels.join(' - ')}</span>`;
      }
    }
    meta.innerHTML = `
      <span style="font-size:10px;padding:2px 5px;border-radius:4px;border:1px solid #d1d5db;color:#6b7280;">${toLabel(item.category)}</span>
      ${newBadge}
      ${requiredBadge}
      ${assignedBadge}
      ${completedBadge}
      ${locationBadge}
    `;

    const roles = Array.isArray(item.visibleToRoles) ? item.visibleToRoles : [];
    const techTypes = Array.isArray(item.technicianTypes) ? item.technicianTypes : [];
    const roleStr = roles.length ? roles.map(toLabel).join(', ') : 'None';
    const techStr = (roles.includes('technician') && techTypes.length) ? techTypes.map(toLabel).join(', ') : '';
    const metaLine = techStr ? `${roleStr} - ${techStr}` : roleStr;

    const metaLineEl = document.createElement('div');
    metaLineEl.style.cssText = 'font-size:11px;color:#9ca3af;';
    metaLineEl.textContent = metaLine;

    card.onclick = () => openTrainingDetails(item.id);
    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(metaLineEl);
    if (canManageTraining()) {
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:4px;justify-content:flex-end;margin-top:2px;';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Edit';
      editBtn.style.cssText = 'font-size:10px;padding:2px 6px;border:none;background:transparent;color:#6b7280;cursor:pointer;border-radius:4px;';
      editBtn.onmouseover = () => { editBtn.style.background = '#f3f4f6'; editBtn.style.color = '#374151'; };
      editBtn.onmouseout = () => { editBtn.style.background = 'transparent'; editBtn.style.color = '#6b7280'; };
      editBtn.onclick = (e) => {
        e.stopPropagation();
        openEditTrainingModal(item.id);
      };
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'Delete';
      deleteBtn.style.cssText = 'font-size:10px;padding:2px 6px;border:none;background:transparent;color:#9ca3af;cursor:pointer;border-radius:4px;';
      deleteBtn.onmouseover = () => { deleteBtn.style.background = '#fef2f2'; deleteBtn.style.color = '#dc2626'; };
      deleteBtn.onmouseout = () => { deleteBtn.style.background = 'transparent'; deleteBtn.style.color = '#9ca3af'; };
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        deleteTrainingItemLocal(item.id);
      };
      actions.append(editBtn, deleteBtn);
      card.appendChild(actions);
    }
    listEl.appendChild(card);
  });
}

async function handleMarkTrainingCompleted(trainingId) {
  const item = trainingItems.find((x) => x.id === trainingId);
  if (item && hasTrainingQuiz(item)) {
    const quizSection = document.getElementById('trainingQuizSection');
    if (quizSection) quizSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const btn = document.getElementById('trainingMarkCompletedBtn');
  if (btn) btn.disabled = true;
  try {
    await markTrainingCompleted(trainingId);
    if (item) renderTrainingDetails(item);
  } catch (err) {
    console.error('[Training] Mark completed failed', err);
    alert(err?.message || 'Failed to mark as completed.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderTrainingDetails(item) {
  const detailsView = document.getElementById('trainingDetailsView');
  if (!detailsView || !item) return;

  const techRow = item.technicianTypes?.length
    ? `<div style="font-size:13px;color:#374151;"><strong>Service Provider Types:</strong> ${item.technicianTypes.map(toLabel).join(', ')}</div>`
    : '';
  const contentBlocks = Array.isArray(item.contentBlocks) ? item.contentBlocks : [];

  let contentHtml = '<div style="font-size:13px;color:#9ca3af;">No content blocks yet.</div>';
  if (contentBlocks.length) {
    contentHtml = contentBlocks.map((block, idx) => {
      if (block.type === 'text') {
        return `
          <div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px;background:#fff;">
            <div style="font-size:11px;color:#7c3aed;font-weight:600;margin-bottom:6px;">Text</div>
            ${block.title ? `<div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:6px;">${block.title}</div>` : ''}
            <div style="font-size:13px;color:#374151;line-height:1.6;">${block.body || '-'}</div>
          </div>
        `;
      }
      if (block.type === 'steps') {
        const steps = Array.isArray(block.steps) ? block.steps : [];
        return `
          <div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px;background:#fff;">
            <div style="font-size:11px;color:#7c3aed;font-weight:600;margin-bottom:6px;">Steps</div>
            ${block.title ? `<div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:6px;">${block.title}</div>` : ''}
            <ol style="margin:0 0 0 18px;padding:0;color:#374151;font-size:13px;line-height:1.6;">${steps.map((s) => `<li>${s}</li>`).join('')}</ol>
          </div>
        `;
      }
      if (block.type === 'video') {
        const stableBlockId = getTrainingBlockStableId(block, idx);
        return `
          <div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px;background:#fff;">
            <div style="font-size:11px;color:#7c3aed;font-weight:600;margin-bottom:6px;">Video</div>
            ${block.title ? `<div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:6px;">${block.title}</div>` : ''}
            ${block.url ? `<video src="${block.url}" controls playsinline preload="metadata" data-training-video="1" data-block-id="${stableBlockId}" style="width:100%;max-height:420px;border-radius:8px;background:#000;"></video>${renderTrainingVideoProgressMeta(item.id, stableBlockId)}` : '<div style="font-size:13px;color:#9ca3af;">No video uploaded.</div>'}
          </div>
        `;
      }
      if (block.type === 'image') {
        const urls = Array.isArray(block.imageUrls) ? block.imageUrls : (block.imageUrl ? [block.imageUrl] : []);
        const imgsHtml = urls.length ? urls.map((u) => `<img src="${u}" alt="" style="max-width:100%;max-height:200px;border-radius:8px;object-fit:contain;margin:4px 4px 4px 0;" onerror="this.style.display='none'">`).join('') : '-';
        return `
          <div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px;background:#fff;">
            <div style="font-size:11px;color:#7c3aed;font-weight:600;margin-bottom:6px;">Image</div>
            ${block.title ? `<div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:6px;">${block.title}</div>` : ''}
            <div style="display:flex;flex-wrap:wrap;gap:8px;">${imgsHtml}</div>
          </div>
        `;
      }
      return '';
    }).join('');
  }

  const requiredBadgeHtml = item.required === true
    ? '<span style="font-size:12px;padding:4px 10px;border-radius:999px;background:#fee2e2;color:#dc2626;font-weight:600;">Required Training</span>'
    : '';
  detailsView.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
      <button type="button" onclick="backToTrainingLibrary()" class="btn-pill" style="font-size:13px;">Back</button>
      <h3 style="margin:0;font-size:18px;font-weight:600;color:#111827;">${item.title}</h3>
      ${requiredBadgeHtml}
    </div>

    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;display:grid;gap:10px;margin-bottom:14px;">
      <div style="font-size:13px;color:#374151;"><strong>Category:</strong> ${toLabel(item.category)}</div>
      <div style="font-size:13px;color:#374151;"><strong>Visible To Roles:</strong> ${item.visibleToRoles?.length ? item.visibleToRoles.map(toLabel).join(', ') : 'None'}</div>
      ${techRow}
      <div style="font-size:13px;color:#374151;"><strong>Type:</strong> ${item.required ? 'Required' : 'Optional'}</div>
    </div>

    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;">
      <div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:8px;">Description</div>
      <div style="font-size:13px;color:#374151;line-height:1.6;">${item.description || 'No description yet.'}</div>
    </div>

    <div style="margin-top:14px;">
      <div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:8px;">Content</div>
      <div style="display:grid;gap:10px;">${contentHtml}</div>
    </div>
    <div id="trainingQuizSection" style="margin-top:20px;"></div>
    <div id="trainingProgressSection" style="margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb;"></div>
  `;
  const quizSection = detailsView.querySelector('#trainingQuizSection');
  const progressSection = detailsView.querySelector('#trainingProgressSection');
  const staffId = getCurrentTrainingStaffId();
  const currentUserCtx = getCurrentTrainingUserContext();
  const isRelevantToCurrentUser = isTrainingRelevantToCurrentUser(item, currentUserCtx);
  const progress = trainingProgressMap[item.id];
  const isCompleted = progress && progress.status === 'completed';
  const quizQuestions = getTrainingQuizQuestions(item);
  const quizSubmitted = hasSubmittedTrainingQuiz(progress);
  const quizPassed = hasPassedTrainingQuiz(progress);

  if (quizSection) {
    if (!quizQuestions.length) {
      quizSection.style.display = 'none';
    } else if (!isRelevantToCurrentUser) {
      if (canManageTraining()) {
        quizSection.style.display = 'block';
        quizSection.innerHTML = `
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;display:grid;gap:6px;">
            <div style="font-size:13px;font-weight:600;color:#111827;">Quiz</div>
            <div style="font-size:12px;color:#6b7280;">This training includes ${quizQuestions.length} quiz ${quizQuestions.length === 1 ? 'question' : 'questions'} for assigned staff.</div>
          </div>
        `;
      } else {
        quizSection.style.display = 'none';
      }
    } else if (progress?.markedByAdmin === true && !quizSubmitted) {
      quizSection.style.display = 'block';
      quizSection.innerHTML = `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;display:grid;gap:6px;">
          <div style="font-size:13px;font-weight:600;color:#111827;">Quiz</div>
          <div style="font-size:12px;color:#6b7280;">This training was marked completed manually by admin, so the quiz was not submitted.</div>
        </div>
      `;
    } else if (quizSubmitted && quizPassed) {
      quizSection.style.display = 'block';
      quizSection.innerHTML = `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;display:grid;gap:12px;">
          <div style="font-size:13px;font-weight:600;color:#111827;">Quiz</div>
          <div style="padding:10px 12px;border:1px solid #bbf7d0;border-radius:10px;background:#f0fdf4;display:grid;gap:4px;">
            <div style="font-size:12px;font-weight:600;color:#166534;">Quiz passed successfully</div>
            <div style="font-size:12px;color:#6b7280;">Your training is now completed.</div>
          </div>
        </div>
      `;
    } else {
      const draftAnswers = getTrainingQuizDraftAnswerMap(item.id);
      const responses = Array.isArray(progress?.quizResponses) ? progress.quizResponses : [];
      const responseMap = Object.fromEntries(responses.map((response) => [response.questionId, response]));
      const retrySummary = quizSubmitted && !quizPassed
        ? `
          <div style="padding:10px 12px;border:1px solid #fde68a;border-radius:10px;background:#fffbeb;display:grid;gap:4px;">
            <div style="font-size:12px;font-weight:600;color:#92400e;">Quiz not passed yet</div>
            <div style="font-size:12px;color:#6b7280;">Please try again. The correct answers are not shown.</div>
          </div>
        `
        : '';
      const questionsHtml = quizQuestions.map((question, questionIndex) => {
        const options = Array.isArray(question.options) ? question.options : [];
        const response = responseMap[question.id] || {};
        const selectedOptionId = draftAnswers[question.id] || response.selectedOptionId || '';
        const optionRows = options.map((option) => {
          const isSelected = selectedOptionId === option.id;
          const bg = isSelected ? '#f5f3ff' : '#fff';
          const border = isSelected ? '#c4b5fd' : '#e5e7eb';
          const color = '#374151';
          return `
          <label style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border:1px solid ${border};border-radius:8px;background:${bg};cursor:pointer;">
            <input type="radio" name="trainingQuiz_${question.id}" value="${escapeHtml(option.id)}" ${isSelected ? 'checked' : ''} data-quiz-question-id="${escapeHtml(question.id)}" data-quiz-option-id="${escapeHtml(option.id)}" style="margin-top:2px;">
            <span style="font-size:12px;color:${color};flex:1;">${escapeHtml(option.text || '')}</span>
          </label>
        `;
        }).join('');
        return `
          <div style="border:1px solid #f3f4f6;border-radius:10px;padding:12px;background:#fafafa;display:grid;gap:8px;">
            <div style="font-size:12px;font-weight:600;color:#111827;">${questionIndex + 1}. ${escapeHtml(question.text || '')}</div>
            <div style="display:grid;gap:6px;">${optionRows}</div>
          </div>
        `;
      }).join('');
      quizSection.style.display = 'block';
      quizSection.innerHTML = `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;display:grid;gap:12px;">
          <div>
            <div style="font-size:13px;font-weight:600;color:#111827;">Quiz</div>
            <div style="font-size:12px;color:#6b7280;margin-top:4px;">Answer all questions to complete this training.</div>
          </div>
          ${retrySummary}
          <div style="display:grid;gap:10px;">${questionsHtml}</div>
          <div id="trainingQuizMessage" style="display:none;font-size:12px;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 10px;"></div>
          <div style="display:flex;justify-content:flex-end;">
            <button type="button" id="trainingSubmitQuizBtn" class="btn-pill" style="background:#7c3aed;color:#fff;padding:10px 20px;font-size:13px;border-color:#7c3aed;">${quizSubmitted ? 'Try Again' : 'Submit Quiz'}</button>
          </div>
        </div>
      `;
      quizSection.querySelectorAll('input[data-quiz-question-id]').forEach((input) => {
        input.onchange = (event) => {
          const questionId = event.target?.dataset?.quizQuestionId;
          const optionId = event.target?.dataset?.quizOptionId;
          if (questionId && optionId) setTrainingQuizDraftAnswer(item.id, questionId, optionId);
        };
      });
      const submitQuizBtn = quizSection.querySelector('#trainingSubmitQuizBtn');
      if (submitQuizBtn) submitQuizBtn.onclick = () => handleSubmitTrainingQuiz(item.id);
    }
  }

  if (progressSection) {
    if (!staffId || !isRelevantToCurrentUser) {
      progressSection.style.display = 'none';
    } else if (isCompleted) {
      const completedAt = progress.completedAt;
      let dateStr = '';
      if (completedAt) {
        const ts = typeof completedAt.toMillis === 'function' ? completedAt.toMillis() : (completedAt && completedAt.getTime ? completedAt.getTime() : null);
        if (ts) dateStr = new Date(ts).toLocaleDateString();
      }
      progressSection.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;color:#059669;font-size:14px;font-weight:500;flex-wrap:wrap;">
          <span>Completed -</span>
          ${dateStr ? `<span style="color:#6b7280;font-size:12px;">Completed on: ${dateStr}</span>` : ''}
          ${progress?.markedByAdmin === true ? '<span style="color:#6b7280;font-size:12px;">Marked manually by admin</span>' : ''}
        </div>
      `;
    } else {
      const requiredNote = item.required === true
        ? '<div style="font-size:12px;color:#b45309;margin-bottom:8px;">Required training - not yet completed.</div>'
        : '';
      const quizNote = quizQuestions.length
        ? '<div style="font-size:12px;color:#6b7280;">Status: In Progress. Complete the quiz above to finish this training.</div>'
        : '<button type="button" id="trainingMarkCompletedBtn" class="btn-pill" style="background:#7c3aed;color:#fff;padding:10px 20px;font-size:13px;border-color:#7c3aed;">Mark as Completed</button>';
      progressSection.innerHTML = `${requiredNote}${quizNote}`;
      const btn = progressSection.querySelector('#trainingMarkCompletedBtn');
      if (btn) btn.onclick = () => handleMarkTrainingCompleted(item.id);
    }
  }
  bindTrainingVideoTracking(item.id);
}

async function openTrainingDetails(itemId) {
  const listView = document.getElementById('trainingLibraryView');
  const detailsView = document.getElementById('trainingDetailsView');
  if (!listView || !detailsView) return;
  const item = trainingItems.find((x) => x.id === itemId);
  if (!item) return;
  selectedTrainingItemId = itemId;
  listView.style.display = 'none';
  detailsView.style.display = 'block';
  renderTrainingDetails(item);
  try {
    await markTrainingNotificationOpened(itemId);
  } catch (err) {
    console.warn('[Training] Failed opening notification state', err);
  }
}

function backToTrainingLibrary() {
  selectedTrainingItemId = null;
  renderTrainingLibrary();
}

function bindTrainingSearchAndFilters() {
  const viewAllBtn = document.getElementById('trainingViewAllBtn');
  const viewMyBtn = document.getElementById('trainingViewMyBtn');
  const viewRequiredBtn = document.getElementById('trainingViewRequiredBtn');
  const searchInput = document.getElementById('trainingSearchInput');
  const categoryFilter = document.getElementById('trainingCategoryFilter');
  const roleFilter = document.getElementById('trainingRoleFilter');
  const requiredFilter = document.getElementById('trainingRequiredFilter');
  const toggleWrap = document.getElementById('trainingViewToggleWrap');
  const canManage = canManageTraining();
  const canTabs = canSeeTrainingTabs();
  const canUseRequiredTab = canUseTrainingRequiredTab();
  if (toggleWrap) toggleWrap.style.display = canTabs ? 'flex' : 'none';
  if (viewAllBtn) viewAllBtn.style.display = (canManage && canTabs) ? 'inline-block' : 'none';
  if (viewRequiredBtn) viewRequiredBtn.style.display = (canTabs && canUseRequiredTab) ? 'inline-block' : 'none';
  if (!canUseRequiredTab && trainingViewMode === 'required') trainingViewMode = canManage ? 'all' : 'my';
  const updateTabs = () => {
    const activeStyle = 'border-bottom:2px solid #7c3aed;color:#111827;';
    const inactiveStyle = 'border-bottom:2px solid transparent;color:#6b7280;';
    if (viewAllBtn) viewAllBtn.style.cssText = `padding:6px 14px;font-size:12px;font-weight:500;border:none;border-bottom:2px solid;margin-bottom:-1px;background:transparent;cursor:pointer;${trainingViewMode === 'all' ? activeStyle : inactiveStyle}`;
    if (viewMyBtn) viewMyBtn.style.cssText = `padding:6px 14px;font-size:12px;font-weight:500;border:none;border-bottom:2px solid;margin-bottom:-1px;background:transparent;cursor:pointer;${trainingViewMode === 'my' ? activeStyle : inactiveStyle}`;
    if (viewRequiredBtn) viewRequiredBtn.style.cssText = `padding:6px 14px;font-size:12px;font-weight:500;border:none;border-bottom:2px solid;margin-bottom:-1px;background:transparent;cursor:pointer;display:${(canTabs && canUseRequiredTab) ? 'inline-block' : 'none'};${trainingViewMode === 'required' ? activeStyle : inactiveStyle}`;
  };
  updateTabs();
  if (viewAllBtn && !viewAllBtn.dataset.bound) { viewAllBtn.dataset.bound = '1'; viewAllBtn.onclick = () => { trainingViewMode = 'all'; updateTabs(); renderTrainingLibrary(); }; }
  if (viewMyBtn && !viewMyBtn.dataset.bound) { viewMyBtn.dataset.bound = '1'; viewMyBtn.onclick = () => { trainingViewMode = 'my'; updateTabs(); renderTrainingLibrary(); }; }
  if (viewRequiredBtn && !viewRequiredBtn.dataset.bound) { viewRequiredBtn.dataset.bound = '1'; viewRequiredBtn.onclick = () => { trainingViewMode = 'required'; updateTabs(); renderTrainingLibrary(); }; }

  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = '1';
    searchInput.addEventListener('input', (e) => {
      trainingSearchQuery = String(e.target.value || '');
      renderTrainingLibrary();
    });
  }
  if (categoryFilter && !categoryFilter.dataset.bound) {
    categoryFilter.dataset.bound = '1';
    categoryFilter.addEventListener('change', (e) => {
      trainingCategoryFilter = String(e.target.value || 'all');
      renderTrainingLibrary();
    });
  }
  if (roleFilter && !roleFilter.dataset.bound) {
    roleFilter.dataset.bound = '1';
    roleFilter.addEventListener('change', (e) => {
      trainingRoleFilter = String(e.target.value || 'all');
      renderTrainingLibrary();
    });
  }
  if (requiredFilter && !requiredFilter.dataset.bound) {
    requiredFilter.dataset.bound = '1';
    requiredFilter.addEventListener('change', (e) => {
      trainingRequiredFilter = String(e.target.value || 'all');
      renderTrainingLibrary();
    });
  }
}

function bindTrainingTopTabs() {
  const tabLibrary = document.getElementById('trainingTabLibrary');
  const tabReports = document.getElementById('trainingTabReports');
  const libraryView = document.getElementById('trainingLibraryView');
  const reportsView = document.getElementById('trainingReportsView');
  const detailsView = document.getElementById('trainingDetailsView');
  const reportDetailsView = document.getElementById('trainingReportDetailsView');
  const canReports = canViewTrainingReports();
  const updateTabs = () => {
    const activeStyle = 'border-bottom:2px solid #7c3aed;color:#111827;background:transparent;';
    const inactiveStyle = 'border-bottom:2px solid transparent;color:#6b7280;background:transparent;';
    if (tabLibrary) tabLibrary.style.cssText = `padding:8px 16px;font-size:13px;font-weight:500;border:none;border-bottom:2px solid;margin-bottom:-1px;cursor:pointer;${trainingReportsMode === 'library' ? activeStyle : inactiveStyle}`;
    if (tabReports) {
      tabReports.style.display = canReports ? 'inline-block' : 'none';
      if (canReports) tabReports.style.cssText = `padding:8px 16px;font-size:13px;font-weight:500;border:none;border-bottom:2px solid;margin-bottom:-1px;cursor:pointer;display:inline-block;${trainingReportsMode === 'reports' ? activeStyle : inactiveStyle}`;
    }
  };
  const showLibrary = () => {
    trainingReportsMode = 'library';
    updateTabs();
    if (libraryView) libraryView.style.display = 'block';
    if (reportsView) reportsView.style.display = 'none';
    if (detailsView) detailsView.style.display = 'none';
    if (reportDetailsView) reportDetailsView.style.display = 'none';
    renderTrainingLibrary();
  };
  const showReports = async () => {
    trainingReportsMode = 'reports';
    updateTabs();
    if (libraryView) libraryView.style.display = 'none';
    if (reportsView) reportsView.style.display = 'block';
    if (detailsView) detailsView.style.display = 'none';
    if (reportDetailsView) reportDetailsView.style.display = 'none';
    if (canViewTrainingReports()) {
      try {
        trainingAllProgressList = await fetchAllTrainingProgressForSalon();
      } catch (_) {
        trainingAllProgressList = [];
      }
    }
    renderTrainingReports();
  };
  if (tabLibrary && !tabLibrary.dataset.bound) {
    tabLibrary.dataset.bound = '1';
    tabLibrary.onclick = showLibrary;
  }
  if (tabReports && !tabReports.dataset.bound) {
    tabReports.dataset.bound = '1';
    tabReports.onclick = showReports;
  }
  updateTabs();
}

function bindTrainingReportsSubTabs() {
  const byTrainingBtn = document.getElementById('trainingReportsByTrainingBtn');
  const byEmployeeBtn = document.getElementById('trainingReportsByEmployeeBtn');
  const byTrainingContent = document.getElementById('trainingReportsByTrainingContent');
  const byEmployeeContent = document.getElementById('trainingReportsByEmployeeContent');
  const updateSubTabs = () => {
    const pillActive = 'background:#7c3aed;color:#fff;border-color:#7c3aed;';
    const pillInactive = 'background:transparent;color:#6b7280;border-color:#d1d5db;';
    if (byTrainingBtn) byTrainingBtn.style.cssText = `padding:6px 12px;font-size:12px;font-weight:500;border-radius:999px;border:1px solid;cursor:pointer;${trainingReportsSubMode === 'byTraining' ? pillActive : pillInactive}`;
    if (byEmployeeBtn) byEmployeeBtn.style.cssText = `padding:6px 12px;font-size:12px;font-weight:500;border-radius:999px;border:1px solid;cursor:pointer;${trainingReportsSubMode === 'byEmployee' ? pillActive : pillInactive}`;
    if (byTrainingContent) byTrainingContent.style.display = trainingReportsSubMode === 'byTraining' ? 'block' : 'none';
    if (byEmployeeContent) byEmployeeContent.style.display = trainingReportsSubMode === 'byEmployee' ? 'block' : 'none';
  };
  if (byTrainingBtn && !byTrainingBtn.dataset.bound) {
    byTrainingBtn.dataset.bound = '1';
    byTrainingBtn.onclick = () => { trainingReportsSubMode = 'byTraining'; updateSubTabs(); renderTrainingReports(); };
  }
  if (byEmployeeBtn && !byEmployeeBtn.dataset.bound) {
    byEmployeeBtn.dataset.bound = '1';
    byEmployeeBtn.onclick = () => { trainingReportsSubMode = 'byEmployee'; updateSubTabs(); renderTrainingReports(); };
  }
  updateSubTabs();
}

function renderTrainingReports() {
  ensureTrainingReportDetailsAdminDelegation();
  bindTrainingReportsSubTabs();
  if (trainingReportsSubMode === 'byTraining') {
    renderReportsByTraining();
  } else {
    renderReportsByEmployee();
  }
}

function renderReportsByTraining() {
  const listEl = document.getElementById('trainingReportsByTrainingList');
  const emptyEl = document.getElementById('trainingReportsByTrainingEmpty');
  if (!listEl || !emptyEl) return;
  listEl.innerHTML = '';
  // Only show trainings that are visible at the active location. Trainings
  // tagged exclusively for other branches should not appear in this branch's
  // reports at all.
  const itemsForLocation = trainingItems.filter(isTrainingVisibleAtCurrentLocation);
  if (!itemsForLocation.length) {
    listEl.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }
  listEl.style.display = 'flex';
  emptyEl.style.display = 'none';
  itemsForLocation.forEach((item) => {
    // getTrainingReportsStaffList() already filters by active location, so the
    // staff list here reflects only the current branch's roster.
    const relevantStaff = getTrainingReportsStaffList().filter((s) => {
      const ctx = { currentRole: getStaffRoleForTraining(s), currentTechnicianTypes: (s.technicianTypes || []).map((t) => String(t).toLowerCase()) };
      return isTrainingRelevantToCurrentUser(item, ctx);
    });
    // Restrict "completed" to entries belonging to staff at the active
    // location so the green count matches the branch roster shown below it.
    const relevantStaffIdSet = new Set(relevantStaff.map(getTrainingReportStaffId));
    const completed = getTrainingCompletedEntries(item.id).filter((p) => {
      return relevantStaffIdSet.has(String(p.staffId || '').trim());
    });
    const completedIds = new Set(completed.map((p) => String(p.staffId || '').trim()));
    const notCompleted = relevantStaff.filter((s) => !completedIds.has(getTrainingReportStaffId(s)));
    const card = document.createElement('div');
    card.style.cssText = 'background:#fff;border:1px solid #e5e7eb;box-shadow:0 1px 3px rgba(0,0,0,0.06);border-radius:10px;padding:12px 14px;display:grid;gap:8px;';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
        <div>
          <div style="font-size:14px;font-weight:600;color:#111827;">${item.title}</div>
          <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
            <span style="font-size:10px;padding:2px 6px;border-radius:999px;background:#ede9fe;color:#7c3aed;">${toLabel(item.category)}</span>
            <span style="font-size:10px;padding:2px 6px;border-radius:999px;background:${item.required ? '#fee2e2' : '#f3f4f6'};color:${item.required ? '#dc2626' : '#6b7280'};">${item.required ? 'Required' : 'Optional'}</span>
          </div>
        </div>
        <div style="text-align:right;font-size:12px;color:#6b7280;">
          <div><span style="color:#059669;font-weight:500;">${completed.length}</span> completed</div>
          <div><span style="color:#dc2626;font-weight:500;">${notCompleted.length}</span> not completed</div>
        </div>
      </div>
      <button type="button" class="btn-pill" style="font-size:11px;padding:5px 10px;align-self:flex-start;" onclick="openReportTrainingDetails('${item.id}')">View Details</button>
    `;
    listEl.appendChild(card);
  });
}

function renderReportsByEmployee() {
  const listEl = document.getElementById('trainingReportsByEmployeeList');
  const emptyEl = document.getElementById('trainingReportsByEmployeeEmpty');
  if (!listEl || !emptyEl) return;
  listEl.innerHTML = '';
  // Staff list is already scoped to the active location by
  // getTrainingReportsStaffList(); this keeps the Employee report showing
  // only this branch's roster.
  const staffList = getTrainingReportsStaffList();
  if (!staffList.length) {
    listEl.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }
  listEl.style.display = 'flex';
  emptyEl.style.display = 'none';
  staffList.forEach((staff) => {
    const staffId = getTrainingReportStaffId(staff);
    const completedForStaff = trainingAllProgressList.filter((p) => {
      const pid = String(p.staffId || '');
      return !p.blockId && (pid === staffId || pid === (staff.id || '') || pid === (staff.staffId || '')) && p.status === 'completed';
    });
    const staffCtx = { currentRole: getStaffRoleForTraining(staff), currentTechnicianTypes: (staff.technicianTypes || []).map((t) => String(t).toLowerCase()) };
    // Only count trainings that are actually visible to this staff member.
    // `isTrainingVisibleForStaff` is the staff-centric gate (uses the staff's
    // own allowedLocationIds rather than the viewer's active location) so
    // we don't overstate "open required" for a cross-branch staffer.
    const requiredForStaff = trainingItems.filter((item) => {
      return isTrainingVisibleForStaff(item, staff) && isTrainingRequiredForUser(item, staffCtx);
    });
    const completedRequiredIds = new Set(completedForStaff.map((p) => p.trainingId));
    const openRequired = requiredForStaff.filter((item) => !completedRequiredIds.has(item.id));
    let lastCompletedDate = '';
    if (completedForStaff.length) {
      const withDate = completedForStaff.filter((p) => p.completedAt).map((p) => getSortTime(p.completedAt));
      if (withDate.length) {
        const maxTs = Math.max(...withDate);
        lastCompletedDate = new Date(maxTs).toLocaleDateString();
      }
    }
    const card = document.createElement('div');
    card.style.cssText = 'background:#fff;border:1px solid #e5e7eb;box-shadow:0 1px 3px rgba(0,0,0,0.06);border-radius:10px;padding:12px 14px;display:grid;gap:6px;';
    card.innerHTML = `
      <div style="font-size:14px;font-weight:600;color:#111827;">${staff.name || staffId || 'Unknown'}</div>
      <div style="display:flex;gap:12px;font-size:12px;color:#6b7280;">
        <span><span style="color:#059669;font-weight:500;">${completedForStaff.length}</span> completed</span>
        <span><span style="color:#dc2626;font-weight:500;">${openRequired.length}</span> open required</span>
        ${lastCompletedDate ? `<span>Last: ${lastCompletedDate}</span>` : ''}
      </div>
    `;
    listEl.appendChild(card);
  });
}

function openReportTrainingDetails(trainingId) {
  const libraryView = document.getElementById('trainingLibraryView');
  const reportsView = document.getElementById('trainingReportsView');
  const detailsView = document.getElementById('trainingDetailsView');
  const reportDetailsView = document.getElementById('trainingReportDetailsView');
  if (!reportDetailsView) return;
  const item = trainingItems.find((x) => x.id === trainingId);
  if (!item) return;
  // Block deep-linking into a training that isn't visible at this branch -
  // bounce back to the reports list so the user doesn't see cross-branch
  // completion data by mistake.
  if (!isTrainingVisibleAtCurrentLocation(item)) {
    if (typeof window.showToast === 'function') {
      window.showToast('This training is not assigned to the current location.');
    }
    return;
  }
  const relevantStaff = getTrainingReportsStaffList().filter((s) => {
    const ctx = { currentRole: getStaffRoleForTraining(s), currentTechnicianTypes: (s.technicianTypes || []).map((t) => String(t).toLowerCase()) };
    return isTrainingRelevantToCurrentUser(item, ctx);
  });
  // Scope the "X completed" header to completions from staff at the active
  // location only, matching the Employee Actions cards below.
  const relevantStaffIdSet = new Set(relevantStaff.map(getTrainingReportStaffId));
  const completed = getTrainingCompletedEntries(item.id).filter((p) => {
    return relevantStaffIdSet.has(String(p.staffId || '').trim());
  });
  const employeeCards = relevantStaff.map((staff) => renderTrainingReportEmployeeCard(item, staff)).join('');
  reportDetailsView.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
      <button type="button" onclick="backFromReportTrainingDetails()" class="btn-pill" style="font-size:13px;">Back</button>
      <h3 style="margin:0;font-size:16px;font-weight:600;color:#111827;">${item.title}</h3>
    </div>
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div style="font-size:13px;font-weight:600;color:#111827;">Employee Actions</div>
        <div style="font-size:12px;color:#6b7280;"><span style="color:#059669;font-weight:600;">${completed.length}</span> completed</div>
      </div>
    </div>
    <div style="display:grid;gap:12px;">
      ${employeeCards || '<div style="font-size:12px;color:#9ca3af;">No employees assigned to this training.</div>'}
    </div>
  `;
  if (libraryView) libraryView.style.display = 'none';
  if (detailsView) detailsView.style.display = 'none';
  if (reportsView) reportsView.style.display = 'none';
  reportDetailsView.style.display = 'block';
  wireTrainingReportDetailActionButtons(reportDetailsView);
  bindTrainingReportDetailsAdminActionsOnce();
}

function backFromReportTrainingDetails() {
  const reportsView = document.getElementById('trainingReportsView');
  const reportDetailsView = document.getElementById('trainingReportDetailsView');
  if (reportsView) reportsView.style.display = 'block';
  if (reportDetailsView) reportDetailsView.style.display = 'none';
  renderTrainingReports();
}

window.openReportTrainingDetails = openReportTrainingDetails;
window.backFromReportTrainingDetails = backFromReportTrainingDetails;

async function goToTraining() {
  try {
    if (typeof window.ffDismissQueueBootSkeleton === 'function') window.ffDismissQueueBootSkeleton();
  } catch (_) {}
  if (typeof window.ffCloseGlobalBlockingOverlays === 'function') {
    try {
      window.ffCloseGlobalBlockingOverlays();
    } catch (e) {}
  }
  const tasksScreen = document.getElementById('tasksScreen');
  const inboxScreen = document.getElementById('inboxScreen');
  const chatScreen = document.getElementById('chatScreen');
  const mediaScreen = document.getElementById('mediaScreen');
  const ticketsScreen = document.getElementById('ticketsScreen');
  const servicesScreen = document.getElementById('servicesScreen');
  const productsScreen = document.getElementById('productsScreen');
  const scheduleScreen = document.getElementById('scheduleScreen');
  const timeClockScreenTc = document.getElementById('timeClockScreen');
  const inventoryScreenTc = document.getElementById('inventoryScreen');
  const pointsAppScreen = document.getElementById('pointsAppScreen');
  const userProfileScreen = document.getElementById('userProfileScreen');
  const manageQueueScreen = document.getElementById('manageQueueScreen');
  const ownerView = document.getElementById('owner-view');
  const joinBar = document.getElementById('joinBar');
  const queueControls = document.getElementById('queueControls');
  const wrap = document.querySelector('.wrap');
  const trainingScreen = document.getElementById('trainingScreen');

  if (tasksScreen) tasksScreen.style.display = 'none';
  if (inboxScreen) inboxScreen.style.display = 'none';
  if (chatScreen) chatScreen.style.display = 'none';
  if (mediaScreen) mediaScreen.style.display = 'none';
  if (ticketsScreen) ticketsScreen.style.display = 'none';
  if (servicesScreen) servicesScreen.style.display = 'none';
  if (productsScreen) productsScreen.style.display = 'none';
  if (scheduleScreen) scheduleScreen.style.display = 'none';
  if (timeClockScreenTc) timeClockScreenTc.style.display = 'none';
  if (inventoryScreenTc) inventoryScreenTc.style.display = 'none';
  if (pointsAppScreen) pointsAppScreen.style.display = 'none';
  if (userProfileScreen) userProfileScreen.style.display = 'none';
  if (manageQueueScreen) manageQueueScreen.style.display = 'none';
  if (ownerView) ownerView.style.display = 'none';
  if (joinBar) joinBar.style.display = 'none';
  if (queueControls) queueControls.style.display = 'none';
  if (wrap) wrap.style.display = 'none';
  if (trainingScreen) trainingScreen.style.display = 'flex';

  document.querySelectorAll('.btn-pill').forEach((b) => b.classList.remove('active'));
  const trainingBtn = document.getElementById('trainingBtn');
  if (trainingBtn) trainingBtn.classList.add('active');
  if (typeof window.ffUpdateMobileHeaderTitle === 'function') window.ffUpdateMobileHeaderTitle();
  const canManage = canManageTraining();
  trainingViewMode = canManage ? 'all' : 'my';
  if (!canSeeTrainingTabs()) trainingViewMode = 'my';
  trainingReportsMode = 'library';
  trainingReportsSubMode = 'byTraining';
  const createWrap = document.getElementById('trainingCreateBtnWrap');
  if (createWrap) createWrap.style.display = canManage ? 'inline' : 'none';
  const toggleWrap = document.getElementById('trainingViewToggleWrap');
  if (toggleWrap) toggleWrap.style.display = canSeeTrainingTabs() ? 'flex' : 'none';
  bindTrainingTopTabs();
  bindTrainingSearchAndFilters();
  try { await ensureTechnicianTypesForTraining(); } catch (_) {}
  await loadTrainingItems();
  await ensureTrainingItemsSubscription();
  try {
    trainingProgressMap = await fetchTrainingProgressForUser();
  } catch (_) {
    trainingProgressMap = {};
  }
  try {
    trainingVideoProgressMap = await fetchTrainingVideoProgressForUser();
  } catch (_) {
    trainingVideoProgressMap = {};
  }
  await refreshTrainingNotificationsForCurrentUser();
  await ensureTrainingNotificationsSubscription();
  if (canViewTrainingReports()) {
    try {
      trainingAllProgressList = await fetchAllTrainingProgressForSalon();
    } catch (_) {
      trainingAllProgressList = [];
    }
  }
  const libraryView = document.getElementById('trainingLibraryView');
  const reportsView = document.getElementById('trainingReportsView');
  const reportDetailsView = document.getElementById('trainingReportDetailsView');
  if (libraryView) libraryView.style.display = 'block';
  if (reportsView) reportsView.style.display = 'none';
  if (reportDetailsView) reportDetailsView.style.display = 'none';
  renderTrainingLibrary();
  if (typeof window.ffUpdateMobileHeaderTitle === 'function') window.ffUpdateMobileHeaderTitle();
}

window.goToTraining = goToTraining;
window.openCreateTrainingModal = openCreateTrainingModal;
window.openEditTrainingModal = openEditTrainingModal;
window.closeCreateTrainingModal = closeCreateTrainingModal;
window.saveTrainingItemLocal = saveTrainingItemLocal;
window.deleteTrainingItemLocal = deleteTrainingItemLocal;
window.openTrainingDetails = openTrainingDetails;
window.backToTrainingLibrary = backToTrainingLibrary;
window.refreshTrainingNotificationsForCurrentUser = refreshTrainingNotificationsForCurrentUser;
window.ensureTrainingNotificationsSubscription = ensureTrainingNotificationsSubscription;
window.ensureTrainingItemsSubscription = ensureTrainingItemsSubscription;
window.addTrainingBlock = addTrainingBlock;
window.addTrainingQuizQuestion = addTrainingQuizQuestion;

// Manage Queue Screen Functions
function checkQueueManagePermission() {
  return ffCurrentUserHasQueueManagePermission();
}

// Helper functions for queues structure (ff_queues_v1)
function getQueuesData() {
  const data = localStorage.getItem('ff_queues_v1');
  return data ? JSON.parse(data) : {};
}

function setQueuesData(data, skipCloudWrite) {
  localStorage.setItem('ff_queues_v1', JSON.stringify(data));
  if (!skipCloudWrite) {
    window.__ff_lastSaveTime = Date.now();
    if (typeof window.queueCloudWrite === 'function') window.queueCloudWrite();
    // Always persist settings via a dedicated merge write so Auto Reset /
    // location restriction survive reloads even when the queue is empty
    // (writeState's empty-overwrite guard can otherwise drop them).
    if (typeof window.queueCloudWriteSettings === 'function') window.queueCloudWriteSettings();
  }
}

// Return the active branch id used as the key inside ff_queues_v1. We key
// settings (Auto Reset, GeoFence, Runtime) per-branch so switching branches
// never leaks another branch's configuration through the shared localStorage
// blob, even if a previous session accidentally wrote under a different key.
function _ffQueueLocKey() {
  try {
    if (typeof window !== 'undefined' && typeof window.ffGetActiveLocationId === 'function') {
      const v = window.ffGetActiveLocationId();
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  } catch (_) {}
  const raw = typeof window !== 'undefined' && typeof window.__ff_active_location_id === 'string'
    ? window.__ff_active_location_id.trim()
    : '';
  return raw || 'default';
}

function getQueueAutoResetSettings() {
  const queues = getQueuesData();
  const locKey = _ffQueueLocKey();

  // Preferred: per-branch bucket
  if (queues[locKey] && queues[locKey].settings && queues[locKey].settings.autoReset) {
    return queues[locKey].settings.autoReset;
  }

  // Migrate from legacy single-branch bucket ('default') for the first branch only.
  // We DO NOT auto-copy settings to other branches - each branch must opt in via
  // its own "Enable queue auto reset" toggle, otherwise one location's schedule
  // would silently apply everywhere.
  if (locKey === 'default' && queues.default && queues.default.settings && queues.default.settings.autoReset) {
    return queues.default.settings.autoReset;
  }

  const oldSettings = JSON.parse(localStorage.getItem('ff_queue_settings_v1') || '{}');
  if (
    locKey === 'default' &&
    (oldSettings.autoResetEnabled !== undefined || oldSettings.autoResetTime || oldSettings.autoResetForce !== undefined)
  ) {
    const autoReset = {
      enabled: oldSettings.autoResetEnabled === true,
      time: oldSettings.autoResetTime || '04:00',
      resetWhileInService: oldSettings.autoResetForce === true
    };
    if (!queues.default) queues.default = {};
    if (!queues.default.settings) queues.default.settings = {};
    queues.default.settings.autoReset = autoReset;
    setQueuesData(queues);
    return autoReset;
  }

  // Default values for any branch that hasn't configured Auto Reset yet.
  return {
    enabled: false,
    time: '04:00',
    resetWhileInService: false
  };
}

function getQueueRuntime() {
  const queues = getQueuesData();
  const locKey = _ffQueueLocKey();

  if (queues[locKey] && queues[locKey].runtime) {
    return queues[locKey].runtime;
  }

  if (locKey === 'default' && queues.default && queues.default.runtime) {
    return queues.default.runtime;
  }

  const oldSettings = JSON.parse(localStorage.getItem('ff_queue_settings_v1') || '{}');
  if (locKey === 'default' && oldSettings.lastAutoResetDate !== undefined) {
    if (!queues.default) queues.default = {};
    if (!queues.default.runtime) queues.default.runtime = {};
    queues.default.runtime.lastAutoResetDate = oldSettings.lastAutoResetDate;
    setQueuesData(queues);
    return queues.default.runtime;
  }

  if (!queues[locKey]) queues[locKey] = {};
  if (!queues[locKey].runtime) queues[locKey].runtime = {};
  return queues[locKey].runtime;
}

function setQueueRuntime(runtime) {
  const queues = getQueuesData();
  const locKey = _ffQueueLocKey();
  if (!queues[locKey]) queues[locKey] = {};
  queues[locKey].runtime = runtime;
  setQueuesData(queues);
}

function getQueueLastAutoResetDate() {
  const runtime = getQueueRuntime();
  return runtime.lastAutoResetDate || null;
}

function setQueueLastAutoResetDate(dateKey) {
  const runtime = getQueueRuntime();
  runtime.lastAutoResetDate = dateKey;
  setQueueRuntime(runtime);
}

function clearQueueLastAutoResetDate() {
  const runtime = getQueueRuntime();
  runtime.lastAutoResetDate = null;
  setQueueRuntime(runtime);
}

function saveQueueAutoResetSettings(autoReset) {
  if (!ffCurrentUserHasQueueManagePermission()) return;
  const queues = getQueuesData();
  const locKey = _ffQueueLocKey();
  if (!queues[locKey]) queues[locKey] = {};
  if (!queues[locKey].settings) queues[locKey].settings = {};
  queues[locKey].settings.autoReset = autoReset;
  setQueuesData(queues);

  // Clear lastAutoResetDate when settings change so next scheduled check can run
  clearQueueLastAutoResetDate();

  // Persist immediately to the cloud (dedicated merge write) and protect this
  // (see ffPersistAutoResetToCloud below)
  ffPersistAutoResetToCloud();
}

// Cloud-persist the current queue settings (ff_queues_v1: Auto Reset + Location
// Restriction) and open a short grace window that protects this local edit from
// being reverted by an in-flight snapshot still carrying the previous value
// (the "toggle flips ON then OFF a second later" bug). Shared by the Auto Reset
// and Location Restriction inline handlers so saving never depends on the
// fragile addEventListener wiring.
function ffPersistQueueSettingsToCloud(label) {
  const what = label || 'Settings';
  try {
    window.__ff_queueSettingsLocalEditUntil = Date.now() + 10000;
    if (typeof window.queueCloudWriteSettings === 'function') {
      Promise.resolve(window.queueCloudWriteSettings()).then(function (res) {
        if (res && res.ok) {
          if (typeof window.showToast === 'function') window.showToast(what + ' saved', 2000);
        } else {
          const reason = (res && res.reason) || 'unknown';
          console.warn('[QueueSettings] cloud save did not land:', res);
          if (typeof window.showToast === 'function') window.showToast(what + ' NOT saved to cloud (' + reason + ')', 5000);
        }
      });
    } else {
      console.warn('[QueueSettings] queueCloudWriteSettings not available yet');
      if (typeof window.showToast === 'function') window.showToast('Cloud not ready — saved locally only', 4000);
    }
  } catch (_) {}
}
// Back-compat alias.
function ffPersistAutoResetToCloud() { ffPersistQueueSettingsToCloud('Auto-reset settings'); }

// Inline input handlers for the three Auto Reset controls. These are wired
// directly in the HTML (onchange=...) so saving NEVER depends on the
// addEventListener wiring in initManageQueueButtons attaching in time — that
// attach race is exactly why the toggle appeared to do nothing / reverted.
function ffOnAutoResetEnabledChange() {
  const el = document.getElementById('manageQueueAutoResetEnabled');
  if (!el) return;
  const autoReset = getQueueAutoResetSettings();
  autoReset.enabled = el.checked === true;
  saveQueueAutoResetSettings(autoReset);
  renderManageQueueAutoResetSettings();
}
window.ffOnAutoResetEnabledChange = ffOnAutoResetEnabledChange;

/** Parse HH:mm 24h → { hour12: 1-12, minute: 0-59, ampm: 'AM'|'PM', hour24 }. */
function ffParseHHMMToAmPmParts(hhmm) {
  const m = String(hhmm || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { hour12: 12, minute: 0, ampm: 'AM', hour24: 0 };
  let h = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(minute)) return { hour12: 12, minute: 0, ampm: 'AM', hour24: 0 };
  h = Math.min(23, Math.max(0, h));
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return { hour12, minute: Math.min(59, Math.max(0, minute)), ampm, hour24: h };
}

/** Build HH:mm 24h from 12h parts. */
function ffAmPmPartsToHHMM(hour12, minute, ampm) {
  let h = parseInt(hour12, 10);
  let min = parseInt(minute, 10);
  if (!Number.isFinite(h) || h < 1 || h > 12) h = 12;
  if (!Number.isFinite(min) || min < 0 || min > 59) min = 0;
  if (String(ampm).toUpperCase() === 'PM') {
    h = h === 12 ? 12 : h + 12;
  } else {
    h = h === 12 ? 0 : h;
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Respect Preferences → Business Format → Time format (12h / 24h). */
function ffPrefers24HourTime() {
  try {
    if (typeof window.ffGetDisplayTimeFormat === 'function') {
      return window.ffGetDisplayTimeFormat() === '24h';
    }
  } catch (_) {}
  try {
    const tf = window.settings && window.settings.preferences && window.settings.preferences.timeFormat;
    return tf === '24h' || tf === '24hour' || tf === 24;
  } catch (_) {
    return false;
  }
}
window.ffPrefers24HourTime = ffPrefers24HourTime;

const _ffAmPmSelectCss =
  'height:32px;padding:0 8px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;background:#fff;color:#111827;cursor:pointer;';

/**
 * Mount hour + minute (+ AM/PM only in 12h mode) for a hidden input that stores HH:mm 24h.
 * Follows Preferences time format. Host: <span data-ff-ampm-for="inputId"></span>
 */
function ffMountAmPmTimePicker(inputOrId) {
  const input = typeof inputOrId === 'string' ? document.getElementById(inputOrId) : inputOrId;
  if (!input || !input.id) return null;
  const host = document.querySelector(`[data-ff-ampm-for="${input.id}"]`);
  if (!host) return null;

  const prefers24h = ffPrefers24HourTime();
  const mode = prefers24h ? '24h' : '12h';

  if (host.__ffAmPmMounted) {
    if (host.__ffAmPmMode === mode) {
      if (typeof host.__ffAmPmPull === 'function') host.__ffAmPmPull();
      return host;
    }
    // Time-format preference changed — rebuild controls.
    host.innerHTML = '';
    host.__ffAmPmMounted = false;
    host.__ffAmPmPull = null;
  }

  host.__ffAmPmMounted = true;
  host.__ffAmPmMode = mode;
  if (input.type !== 'hidden') {
    input.type = 'hidden';
  }
  host.style.cssText = 'display:inline-flex;align-items:center;gap:6px;';

  const hourSel = document.createElement('select');
  hourSel.setAttribute('aria-label', 'Hour');
  hourSel.style.cssText = _ffAmPmSelectCss;
  if (prefers24h) {
    for (let h = 0; h <= 23; h++) {
      const opt = document.createElement('option');
      opt.value = String(h);
      opt.textContent = String(h).padStart(2, '0');
      hourSel.appendChild(opt);
    }
  } else {
    for (let h = 1; h <= 12; h++) {
      const opt = document.createElement('option');
      opt.value = String(h);
      opt.textContent = String(h);
      hourSel.appendChild(opt);
    }
  }

  const colon = document.createElement('span');
  colon.textContent = ':';
  colon.style.cssText = 'font-size:14px;font-weight:600;color:#374151;';

  const minSel = document.createElement('select');
  minSel.setAttribute('aria-label', 'Minute');
  minSel.style.cssText = _ffAmPmSelectCss;
  for (let m = 0; m < 60; m++) {
    const opt = document.createElement('option');
    opt.value = String(m);
    opt.textContent = String(m).padStart(2, '0');
    minSel.appendChild(opt);
  }

  let ampmSel = null;
  if (!prefers24h) {
    ampmSel = document.createElement('select');
    ampmSel.setAttribute('aria-label', 'AM or PM');
    ampmSel.style.cssText = _ffAmPmSelectCss + 'font-weight:600;min-width:4.5em;';
    ['AM', 'PM'].forEach((label) => {
      const opt = document.createElement('option');
      opt.value = label;
      opt.textContent = label;
      ampmSel.appendChild(opt);
    });
  }

  function pull() {
    const parts = ffParseHHMMToAmPmParts(input.value || '04:00');
    minSel.value = String(parts.minute);
    if (prefers24h) {
      hourSel.value = String(parts.hour24);
    } else {
      hourSel.value = String(parts.hour12);
      if (ampmSel) ampmSel.value = parts.ampm;
    }
  }

  function push() {
    let next;
    if (prefers24h) {
      let h = parseInt(hourSel.value, 10);
      let min = parseInt(minSel.value, 10);
      if (!Number.isFinite(h) || h < 0 || h > 23) h = 0;
      if (!Number.isFinite(min) || min < 0 || min > 59) min = 0;
      next = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    } else {
      next = ffAmPmPartsToHHMM(hourSel.value, minSel.value, ampmSel ? ampmSel.value : 'AM');
    }
    if (input.value === next) return;
    input.value = next;
    try {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (_) {}
  }

  hourSel.addEventListener('change', push);
  minSel.addEventListener('change', push);
  if (ampmSel) ampmSel.addEventListener('change', push);

  host.appendChild(hourSel);
  host.appendChild(colon);
  host.appendChild(minSel);
  if (ampmSel) host.appendChild(ampmSel);
  host.__ffAmPmPull = pull;
  pull();
  return host;
}
window.ffMountAmPmTimePicker = ffMountAmPmTimePicker;

function ffMountAllAmPmTimePickers(root) {
  const scope = root && root.querySelectorAll ? root : document;
  const hosts = scope.querySelectorAll ? scope.querySelectorAll('[data-ff-ampm-for]') : [];
  hosts.forEach((host) => {
    const id = host.getAttribute('data-ff-ampm-for');
    if (id) ffMountAmPmTimePicker(id);
  });
}
window.ffMountAllAmPmTimePickers = ffMountAllAmPmTimePickers;

function ffOnAutoResetTimeChange() {
  const el = document.getElementById('manageQueueAutoResetTime');
  if (!el) return;
  const autoReset = getQueueAutoResetSettings();
  autoReset.time = el.value || '04:00';
  saveQueueAutoResetSettings(autoReset);
  // If the configured time already passed today, mark today as "already reset"
  // so we don't trigger an immediate unintended reset.
  const now = new Date();
  const todayKey = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0');
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const parts = (autoReset.time || '04:00').split(':');
  const minutesReset = parseInt(parts[0] || 0) * 60 + parseInt(parts[1] || 0);
  if (minutesNow >= minutesReset) {
    const runtime = getQueueRuntime();
    if (runtime.lastAutoResetDate !== todayKey) {
      runtime.lastAutoResetDate = todayKey;
      setQueueRuntime(runtime);
    }
  }
}
window.ffOnAutoResetTimeChange = ffOnAutoResetTimeChange;

function ffOnAutoResetForceChange() {
  const el = document.getElementById('manageQueueAutoResetForce');
  if (!el) return;
  const autoReset = getQueueAutoResetSettings();
  autoReset.resetWhileInService = el.checked === true;
  saveQueueAutoResetSettings(autoReset);
}
window.ffOnAutoResetForceChange = ffOnAutoResetForceChange;

// Inline handler for the Location Restriction toggle. Mirrors the Auto Reset
// handlers so the save (incl. cloud persistence) never depends on the fragile
// addEventListener wiring. saveQueueGeoFenceSettings now pushes to the cloud.
function ffOnQueueGeoFenceEnabledChange(el) {
  const input = el || document.getElementById('manageQueueGeoFenceEnabled');
  if (!input) return;
  const queueGeoFence = getQueueGeoFenceSettings();
  queueGeoFence.enforceQueue = input.checked === true;
  const radiusEl = document.getElementById('manageQueueGeoFenceRadius');
  queueGeoFence.allowedRadiusMeters = sanitizeQueueGeoFenceRadius(
    (radiusEl && radiusEl.value) || queueGeoFence.allowedRadiusMeters
  );
  saveQueueGeoFenceSettings(queueGeoFence);
  if (typeof renderManageQueueGeoFenceSettings === 'function') renderManageQueueGeoFenceSettings();
}
window.ffOnQueueGeoFenceEnabledChange = ffOnQueueGeoFenceEnabledChange;

function getDefaultQueueGeoFenceSettings() {
  return {
    // Legacy: "enabled" historically meant "enforce for Queue actions".
    // New fields split that into per-feature toggles so the same geofence
    // data can be reused for Time Clock (and future features) without
    // forcing one feature's policy onto another.
    enabled: false,           // legacy back-compat alias - kept in sync with enforceQueue
    enforceQueue: false,      // require on-premises for queue join/leave
    enforceTimeClock: false,  // require on-premises for Time Clock kiosk PIN
    lat: null,
    lng: null,
    accuracy: null,
    allowedRadiusMeters: 100,
    updatedAt: null
  };
}

function sanitizeQueueGeoFenceRadius(value) {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num) || num <= 0) return 100;
  return num;
}

function getQueueGeoFenceSettings() {
  const queues = getQueuesData();
  const locKey = _ffQueueLocKey();
  // Only read the per-branch bucket. No fallback to 'default' for non-default
  // branches - this prevents a salon-wide GeoFence set under a legacy session
  // (or by a different user who only ever used the default bucket) from
  // polluting every other branch.
  const raw = queues?.[locKey]?.settings?.queueGeoFence;
  if (!raw || typeof raw !== 'object') return getDefaultQueueGeoFenceSettings();
  const defaults = getDefaultQueueGeoFenceSettings();
  // Migration: documents written before per-feature toggles only have
  // `enabled`. Treat that legacy value as "enforceQueue" (since it gated
  // Queue actions historically) and leave Time Clock enforcement off.
  const legacyEnabled = raw.enabled === true;
  const enforceQueue = Object.prototype.hasOwnProperty.call(raw, 'enforceQueue')
    ? raw.enforceQueue === true
    : legacyEnabled;
  const enforceTimeClock = raw.enforceTimeClock === true;
  return {
    enabled: enforceQueue, // keep `enabled` in sync with enforceQueue for any legacy readers
    enforceQueue,
    enforceTimeClock,
    lat: Number.isFinite(Number(raw.lat)) ? Number(raw.lat) : defaults.lat,
    lng: Number.isFinite(Number(raw.lng)) ? Number(raw.lng) : defaults.lng,
    accuracy: Number.isFinite(Number(raw.accuracy)) ? Math.round(Number(raw.accuracy)) : defaults.accuracy,
    allowedRadiusMeters: sanitizeQueueGeoFenceRadius(raw.allowedRadiusMeters),
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : defaults.updatedAt
  };
}

function saveQueueGeoFenceSettings(queueGeoFence) {
  // Permission: Queue-manage OR (now) Salon-Location managers have always
  // been Owner/Admin so the existing check is a safe superset. If we ever
  // split ownership, swap this for a dedicated permission.
  if (!ffCurrentUserHasQueueManagePermission()) return;
  const queues = getQueuesData();
  const locKey = _ffQueueLocKey();
  if (!queues[locKey]) queues[locKey] = {};
  if (!queues[locKey].settings) queues[locKey].settings = {};
  const current = getQueueGeoFenceSettings();
  // Resolve enforcement flags with priority:
  //   explicit enforceQueue/enforceTimeClock on the input ->
  //   legacy `enabled` on the input (treated as enforceQueue) ->
  //   current stored values.
  const hasEnforceQueueIn = queueGeoFence && Object.prototype.hasOwnProperty.call(queueGeoFence, 'enforceQueue');
  const hasEnabledIn = queueGeoFence && Object.prototype.hasOwnProperty.call(queueGeoFence, 'enabled');
  const enforceQueue = hasEnforceQueueIn
    ? queueGeoFence.enforceQueue === true
    : (hasEnabledIn ? queueGeoFence.enabled === true : current.enforceQueue === true);
  const enforceTimeClock = queueGeoFence && Object.prototype.hasOwnProperty.call(queueGeoFence, 'enforceTimeClock')
    ? queueGeoFence.enforceTimeClock === true
    : current.enforceTimeClock === true;
  queues[locKey].settings.queueGeoFence = {
    enabled: enforceQueue, // legacy alias kept in sync
    enforceQueue,
    enforceTimeClock,
    lat: Number.isFinite(Number(queueGeoFence?.lat)) ? Number(queueGeoFence.lat) : current.lat,
    lng: Number.isFinite(Number(queueGeoFence?.lng)) ? Number(queueGeoFence.lng) : current.lng,
    accuracy: Number.isFinite(Number(queueGeoFence?.accuracy)) ? Math.round(Number(queueGeoFence.accuracy)) : current.accuracy,
    allowedRadiusMeters: sanitizeQueueGeoFenceRadius(queueGeoFence?.allowedRadiusMeters ?? current.allowedRadiusMeters),
    updatedAt: Number.isFinite(Number(queueGeoFence?.updatedAt)) ? Number(queueGeoFence.updatedAt) : current.updatedAt
  };
  setQueuesData(queues);
  // Persist to the cloud (same path as Auto Reset) so the Location Restriction
  // toggle/radius survive refresh and don't get reverted by an in-flight
  // snapshot. ff_queues_v1 carries queueGeoFence, so the shared writer covers it.
  if (typeof ffPersistQueueSettingsToCloud === 'function') {
    ffPersistQueueSettingsToCloud('Location settings');
  }
}

function hasSavedQueueGeoFenceLocation(queueGeoFence) {
  return Number.isFinite(Number(queueGeoFence?.lat)) && Number.isFinite(Number(queueGeoFence?.lng));
}

function getActiveSalonLocationScopeLabel() {
  try {
    const locId = typeof window.ffGetActiveLocationId === 'function'
      ? String(window.ffGetActiveLocationId() || '').trim()
      : (typeof window.__ff_active_location_id === 'string' ? window.__ff_active_location_id.trim() : '');
    if (!locId) return 'Single-branch mode';
    if (typeof window.ffGetActiveLocations === 'function') {
      const locs = window.ffGetActiveLocations() || [];
      const match = Array.isArray(locs)
        ? locs.find((l) => String((l && l.id) || '').trim() === locId)
        : null;
      if (match && match.name) return `${String(match.name)} (${locId})`;
    }
    return locId;
  } catch (_) {
    return 'Active branch';
  }
}

function isQueueGeoFenceActive(queueGeoFence) {
  const settings = queueGeoFence || getQueueGeoFenceSettings();
  // enforceQueue is the new authoritative flag; `enabled` is its legacy
  // alias kept in sync by the getter/setter above, so either read is safe.
  return settings.enforceQueue === true && hasSavedQueueGeoFenceLocation(settings);
}

/** Time Clock mirror of isQueueGeoFenceActive - shares the same geofence
 *  data (per-branch salon location) but a separate enforcement flag. */
function isTimeClockGeoFenceActive(geoFence) {
  const settings = geoFence || getQueueGeoFenceSettings();
  return settings.enforceTimeClock === true && hasSavedQueueGeoFenceLocation(settings);
}
window.isTimeClockGeoFenceActive = isTimeClockGeoFenceActive;
window.getSalonLocationGeoFence = getQueueGeoFenceSettings;

function formatQueueGeoFenceUpdatedAt(updatedAt) {
  const ts = Number(updatedAt);
  if (!Number.isFinite(ts) || ts <= 0) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch (_) {
    return '';
  }
}

function renderManageQueueGeoFenceSettings() {
  const queueGeoFence = getQueueGeoFenceSettings();
  const enabledEl = document.getElementById('manageQueueGeoFenceEnabled');
  const radiusEl = document.getElementById('manageQueueGeoFenceRadius');
  const statusEl = document.getElementById('manageQueueGeoFenceStatus');
  if (enabledEl) enabledEl.checked = queueGeoFence.enforceQueue === true;
  if (radiusEl) radiusEl.value = String(sanitizeQueueGeoFenceRadius(queueGeoFence.allowedRadiusMeters));
  if (statusEl) {
    if (!hasSavedQueueGeoFenceLocation(queueGeoFence)) {
      statusEl.textContent = 'No salon location set';
      statusEl.style.color = '#6b7280';
    } else {
      const updatedLabel = formatQueueGeoFenceUpdatedAt(queueGeoFence.updatedAt);
      statusEl.textContent = updatedLabel
        ? `Salon location saved. Last updated: ${updatedLabel}`
        : 'Salon location saved';
      statusEl.style.color = '#166534';
    }
  }
  // Mirror into the Settings - Salon Location card whenever this is called,
  // so the two surfaces never drift while both are visible during the
  // deprecation window.
  try { renderSalonLocationCard(); } catch (_) {}
}

function renderManageQueueAutoResetSettings() {
  const enabledEl = document.getElementById('manageQueueAutoResetEnabled');
  const optionsEl = document.getElementById('manageQueueAutoResetOptions');
  const timeEl = document.getElementById('manageQueueAutoResetTime');
  const forceEl = document.getElementById('manageQueueAutoResetForce');
  // Reset time + "reset even if in service" appear ONLY while the master Auto
  // Reset toggle is on (the original, expected behaviour). Persistence is now
  // reliable (settings are stored in the cloud queueState doc and self-heal),
  // so when auto-reset is enabled this block shows correctly on open.
  const enabled = enabledEl && enabledEl.checked === true;
  if (optionsEl) {
    optionsEl.style.display = enabled ? 'flex' : 'none';
    optionsEl.style.opacity = '1';
  }
  if (timeEl) {
    timeEl.disabled = !enabled;
    ffMountAmPmTimePicker(timeEl);
    const host = document.querySelector('[data-ff-ampm-for="manageQueueAutoResetTime"]');
    if (host) {
      host.style.opacity = enabled ? '1' : '0.5';
      host.querySelectorAll('select').forEach((sel) => { sel.disabled = !enabled; });
    }
  }
  if (forceEl) forceEl.disabled = !enabled;
}

/**
 * Settings - Salon Location card.
 * Shares the same per-branch data as the (legacy) Queue settings card - see
 * getQueueGeoFenceSettings / saveQueueGeoFenceSettings. The two surfaces
 * stay in sync because all writers call renderManageQueueGeoFenceSettings /
 * renderSalonLocationCard after mutating state.
 */
function renderSalonLocationCard() {
  const geo = getQueueGeoFenceSettings();
  const statusEl = document.getElementById('salonLocationStatus');
  const scopeEl = document.getElementById('salonLocationBranchScope');
  const radiusEl = document.getElementById('salonLocationRadius');
  const enforceQEl = document.getElementById('salonLocationEnforceQueue');
  const enforceTCEl = document.getElementById('salonLocationEnforceTimeClock');
  if (radiusEl) radiusEl.value = String(sanitizeQueueGeoFenceRadius(geo.allowedRadiusMeters));
  if (enforceQEl) enforceQEl.checked = geo.enforceQueue === true;
  if (enforceTCEl) enforceTCEl.checked = geo.enforceTimeClock === true;
  if (scopeEl) {
    scopeEl.innerHTML = `<strong>Active branch:</strong> ${escapeHtml(getActiveSalonLocationScopeLabel())}. This GPS pin, radius, and enforcement toggles are saved only for this branch. Switch branch in the top bar before setting another salon location.`;
  }
  if (statusEl) {
    if (!hasSavedQueueGeoFenceLocation(geo)) {
      statusEl.textContent = 'No salon location set';
      statusEl.style.color = '#6b7280';
    } else {
      const updatedLabel = formatQueueGeoFenceUpdatedAt(geo.updatedAt);
      statusEl.textContent = updatedLabel
        ? `Saved. Last updated: ${updatedLabel}`
        : 'Saved';
      statusEl.style.color = '#166534';
    }
  }
}
window.renderSalonLocationCard = renderSalonLocationCard;

/**
 * Wire the Settings - Salon Location card once. Idempotent - re-entry is a
 * no-op via data-handler-attached sentinels (same pattern as
 * initManageQueueButtons).
 */
function initSalonLocationCardHandlers() {
  const setBtn = document.getElementById('salonLocationSetBtn');
  const radiusEl = document.getElementById('salonLocationRadius');
  const enforceQEl = document.getElementById('salonLocationEnforceQueue');
  const enforceTCEl = document.getElementById('salonLocationEnforceTimeClock');

  if (setBtn && !setBtn.hasAttribute('data-handler-attached')) {
    setBtn.setAttribute('data-handler-attached', 'true');
    setBtn.addEventListener('click', async function () {
      // Reuse the Queue flow - it already handles accuracy retries,
      // permission denial, and the "saved" confirmation modal. It writes
      // to the same underlying doc and flips enforceQueue on (legacy
      // behaviour) which is usually what the admin wants after pinning.
      try { await handleSetQueueSalonLocation(); } catch (_) {}
      renderSalonLocationCard();
      if (typeof renderManageQueueGeoFenceSettings === 'function') renderManageQueueGeoFenceSettings();
    });
  }

  if (radiusEl && !radiusEl.hasAttribute('data-handler-attached')) {
    radiusEl.setAttribute('data-handler-attached', 'true');
    radiusEl.addEventListener('change', function () {
      const geo = getQueueGeoFenceSettings();
      geo.allowedRadiusMeters = sanitizeQueueGeoFenceRadius(radiusEl.value);
      radiusEl.value = String(geo.allowedRadiusMeters);
      saveQueueGeoFenceSettings(geo);
      renderSalonLocationCard();
      if (typeof renderManageQueueGeoFenceSettings === 'function') renderManageQueueGeoFenceSettings();
    });
  }

  if (enforceQEl && !enforceQEl.hasAttribute('data-handler-attached')) {
    enforceQEl.setAttribute('data-handler-attached', 'true');
    enforceQEl.addEventListener('change', function () {
      const geo = getQueueGeoFenceSettings();
      geo.enforceQueue = enforceQEl.checked === true;
      saveQueueGeoFenceSettings(geo);
      renderSalonLocationCard();
      if (typeof renderManageQueueGeoFenceSettings === 'function') renderManageQueueGeoFenceSettings();
    });
  }

  if (enforceTCEl && !enforceTCEl.hasAttribute('data-handler-attached')) {
    enforceTCEl.setAttribute('data-handler-attached', 'true');
    enforceTCEl.addEventListener('change', function () {
      const geo = getQueueGeoFenceSettings();
      geo.enforceTimeClock = enforceTCEl.checked === true;
      saveQueueGeoFenceSettings(geo);
      renderSalonLocationCard();
    });
  }
}
window.initSalonLocationCardHandlers = initSalonLocationCardHandlers;

function openManageQueue() {
  if (typeof ffCurrentUserHasQueueLockedViewPermission === 'function' && ffCurrentUserHasQueueLockedViewPermission()) {
    ffQueueLockedViewToast();
    return;
  }
  if (!ffCurrentUserHasQueueManagePermission()) return;
  // Hide Queue view
  const ownerView = document.getElementById('owner-view');
  const joinBar = document.getElementById('joinBar');
  const wrapContent = document.querySelector('.wrap');
  const queueControls = document.getElementById('queueControls');
  
  if (ownerView) ownerView.style.display = 'none';
  if (joinBar) joinBar.style.display = 'none';
  if (wrapContent) wrapContent.style.display = 'none';
  if (queueControls) queueControls.style.display = 'none';
  
  // Load auto reset settings from new structure
  const autoReset = getQueueAutoResetSettings();
  const enabledEl = document.getElementById('manageQueueAutoResetEnabled');
  const timeEl = document.getElementById('manageQueueAutoResetTime');
  const forceEl = document.getElementById('manageQueueAutoResetForce');
  
  if (enabledEl) enabledEl.checked = autoReset.enabled === true;
  if (timeEl) timeEl.value = autoReset.time || '04:00';
  if (forceEl) forceEl.checked = autoReset.resetWhileInService === true;
  renderManageQueueAutoResetSettings();
  renderManageQueueGeoFenceSettings();
  
  // Show Manage Queue screen
  const manageQueueScreen = document.getElementById('manageQueueScreen');
  if (manageQueueScreen) {
    manageQueueScreen.style.display = 'block';
  }
}

function closeManageQueue() {
  // Hide Manage Queue screen
  const manageQueueScreen = document.getElementById('manageQueueScreen');
  if (manageQueueScreen) {
    manageQueueScreen.style.display = 'none';
  }
  
  // Show Queue view
  goToQueue();
}

// Initialize Manage Queue button handlers
function initManageQueueButtons() {
  // Manage Queue gear button
  const manageQueueBtn = document.getElementById('manageQueueBtn');
  if (manageQueueBtn && !manageQueueBtn.hasAttribute('data-handler-attached')) {
    manageQueueBtn.setAttribute('data-handler-attached', 'true');
    manageQueueBtn.onclick = function(e) {
      e.preventDefault();
      openManageQueue();
    };
  }
  
  // Back to Queue button
  const manageQueueBackBtn = document.getElementById('manageQueueBackBtn');
  if (manageQueueBackBtn && !manageQueueBackBtn.hasAttribute('data-handler-attached')) {
    manageQueueBackBtn.setAttribute('data-handler-attached', 'true');
    manageQueueBackBtn.onclick = function(e) {
      e.preventDefault();
      closeManageQueue();
    };
  }
  
  // Auto Reset input handlers are wired INLINE in the HTML (onchange=
  // ffOnAutoReset*Change) so saving never depends on this init running. Do not
  // re-attach them here or every change would save twice (double cloud write).
  const geoFenceRadiusEl = document.getElementById('manageQueueGeoFenceRadius');
  const geoFenceSetLocationBtn = document.getElementById('manageQueueSetSalonLocationBtn');

  // NOTE: the Location Restriction toggle is wired via an inline onchange
  // (ffOnQueueGeoFenceEnabledChange) for the same reason as Auto Reset - the
  // addEventListener path could fail to attach. Cloud persistence now lives in
  // saveQueueGeoFenceSettings, so no addEventListener is needed here.

  if (geoFenceRadiusEl && !geoFenceRadiusEl.hasAttribute('data-handler-attached')) {
    geoFenceRadiusEl.setAttribute('data-handler-attached', 'true');
    geoFenceRadiusEl.addEventListener('change', function() {
      const queueGeoFence = getQueueGeoFenceSettings();
      queueGeoFence.allowedRadiusMeters = sanitizeQueueGeoFenceRadius(geoFenceRadiusEl.value);
      geoFenceRadiusEl.value = String(queueGeoFence.allowedRadiusMeters);
      saveQueueGeoFenceSettings(queueGeoFence);
      renderManageQueueGeoFenceSettings();
    });
  }

  // "Open Salon Location settings" deep-link - opens the user profile modal
  // and jumps straight to the new shared card (owner/admin only).
  const openSalonBtn = document.getElementById('manageQueueOpenSalonLocationBtn');
  if (openSalonBtn && !openSalonBtn.hasAttribute('data-handler-attached')) {
    openSalonBtn.setAttribute('data-handler-attached', 'true');
    openSalonBtn.addEventListener('click', function () {
      if (typeof goToUserProfile === 'function') {
        try { goToUserProfile('salon-location'); return; } catch (_) {}
      }
      // Fallback: click the menu item if the modal is already open.
      const item = document.querySelector('.user-profile-menu-item[data-section="salon-location"]');
      if (item) item.click();
    });
  }

  if (geoFenceSetLocationBtn && !geoFenceSetLocationBtn.hasAttribute('data-handler-attached')) {
    geoFenceSetLocationBtn.setAttribute('data-handler-attached', 'true');
    geoFenceSetLocationBtn.addEventListener('click', async function() {
      if (typeof handleSetQueueSalonLocation === 'function') {
        await handleSetQueueSalonLocation();
      }
    });
  }
}

// Track previous view for User Profile back navigation
let previousView = 'queue'; // Default to queue

// Helper function to check if User Profile or My Profile screen is currently active
function isUserProfileActive() {
  const userProfileScreen = document.getElementById('userProfileScreen');
  const myProfileScreen = document.getElementById('myProfileScreen');
  const up = userProfileScreen && userProfileScreen.style.display !== 'none';
  const mp = myProfileScreen && myProfileScreen.style.display !== 'none';
  return !!(up || mp);
}

// Helper function to hide Queue UI elements when User Profile is active
function ensureQueueUIHiddenForUserProfile() {
  if (isUserProfileActive()) {
    const joinBar = document.getElementById('joinBar');
    if (joinBar) joinBar.style.display = 'none';
    const joinError = document.getElementById('joinError');
    if (joinError) joinError.style.display = 'none';
    const queueControls = document.getElementById('queueControls');
    if (queueControls) queueControls.style.display = 'none';
    const wrap = document.querySelector('.wrap');
    if (wrap) wrap.style.display = 'none';
    const ownerView = document.getElementById('owner-view');
    if (ownerView) ownerView.style.display = 'none';
  }
}

/**
 * Technicians and anyone with settings_view === false should not see the admin User Profile
 * (Staff Setup, Schedule, Media Categories, etc.). Send them to My Profile instead.
 * Managers/owners still use goToUserProfile (e.g. Settings - schedule) when this returns false.
 */
function ffUserShouldRouteToMyProfileOnly() {
  try {
    if (typeof ffCurrentUserSalonOwnerPermissionBypass === 'function' && ffCurrentUserSalonOwnerPermissionBypass()) {
      return false;
    }
    const staff = typeof ffResolveCurrentStaffRowFromFfStaffV1 === 'function' ? ffResolveCurrentStaffRowFromFfStaffV1() : null;
    if (staff) {
      const p = (staff.permissions) || {};
      if (p.settings_view === false) return true;
      const r = String(staff.role || '').toLowerCase();
      if (r === 'technician' || r === 'tech') return true;
    }
    if (typeof getCurrentQueueActorRole === 'function') {
      const sr = String(getCurrentQueueActorRole() || '').toLowerCase();
      if (sr === 'technician' || sr === 'tech') return true;
    }
  } catch (e) {}
  return false;
}
window.ffUserShouldRouteToMyProfileOnly = ffUserShouldRouteToMyProfileOnly;
