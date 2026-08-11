/**
 * Inbox — Listeners & data loading
 * Firestore subscriptions for the inbox list (role/tab-aware), snapshot
 * processing + index fallback, technician merge/noise filter, and the
 * background unread-badge listener. Extracted verbatim from inbox.js (M1).
 *
 * Pure module (no side effects): the badge listener REGISTRATION and auth
 * wiring stay in inbox.js (which owns ffRefreshInboxNavVisibility).
 * Exports: loadInboxItems, inboxTechnicianNoiseFilter, _bgBadgeRecompute,
 * startBgBadgeListener (the rest are module-internal).
 */

import {
  query,
  collection,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { inboxState, MANAGER_ONLY_INBOX_TYPES } from "./inbox-state.js?v=20260810_owner_inbox_load_v5";
import {
  ffInboxIsStaffCallOtherNoise,
  inboxItemActivityMs,
  inboxErrorNeedsIndex,
  inboxSessionIsSalonOwnerOrAdmin,
} from "./inbox-helpers.js?v=20260810_owner_inbox_load_v5";
import {
  inboxUserRoleLc,
  inboxCanManageInbox,
  inboxCanSendRequests,
} from "./inbox-data.js?v=20260810_owner_inbox_load_v5";
import {
  updateInboxStaffFilterOptions,
  updateInboxBadges,
  renderInboxList,
  inboxGetStaffLocationMap,
  inboxItemMatchesActiveLocation,
} from "./inbox-list-render.js?v=20260810_owner_inbox_load_v5";

/** Rows technicians should not see in Inbox (manager automations + misrouted staff-call "Other" items). */
export function inboxTechnicianNoiseFilter(rows) {
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

function subscribeInboxIndexFallback({ salonId, uid, mode, loadingEl, listEl, emptyEl, loadGen }) {
  const field = mode === "mine" ? "createdByUid" : "forUid";
  console.warn('[Inbox] Composite index not ready; using fallback query', { mode, field });
  const fallbackQuery = query(
    collection(db, `salons/${salonId}/inboxItems`),
    where(field, '==', uid),
    limit(100)
  );
  return onSnapshot(
    fallbackQuery,
    (snapshot) => {
      if (loadGen != null && !markInboxLoadSettled(loadGen)) return;
      applyInboxSnapshotRows(snapshot, loadingEl);
    },
    (fallbackError) => {
      if (loadGen != null && !markInboxLoadSettled(loadGen)) return;
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

// =====================
// Load & Render Requests
// =====================
function clearInboxLoadingWatchdog() {
  if (inboxState._inboxLoadWatchdog) {
    try { clearTimeout(inboxState._inboxLoadWatchdog); } catch (_) {}
    inboxState._inboxLoadWatchdog = null;
  }
}

function markInboxLoadSettled(loadGen) {
  if (loadGen != null && inboxState._inboxLoadGen !== loadGen) return false;
  clearInboxLoadingWatchdog();
  return true;
}

export async function loadInboxItems() {
  const loadingEl = document.getElementById('inboxLoading');
  const emptyEl = document.getElementById('inboxEmpty');
  const listEl = document.getElementById('inboxList');

  if (!inboxState.currentUserProfile) {
    console.warn('[Inbox] loadInboxItems: no currentUserProfile yet');
    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl) {
      emptyEl.style.display = 'block';
      const msgEl = emptyEl.querySelector('#emptyStateMessage');
      if (msgEl) msgEl.textContent = 'Could not load your profile. Try refreshing.';
    }
    return;
  }
  
  const salonId = inboxState.currentUserProfile.salonId;
  const role = inboxUserRoleLc();
  const uid = inboxState.currentUserProfile.uid;
  const canManage = inboxCanManageInbox() || inboxSessionIsSalonOwnerOrAdmin();

  console.log('[Inbox] loadInboxItems', { salonId, role, uid, canManage, view: inboxState.inboxViewMode });

  // Guard: salonId must exist, otherwise rules will always deny
  if (!salonId) {
    console.error('[Inbox] salonId is missing from user profile', inboxState.currentUserProfile);
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

  if (!uid) {
    console.error('[Inbox] uid is missing from user profile', inboxState.currentUserProfile);
    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl) {
      emptyEl.style.display = 'block';
      const msgEl = emptyEl.querySelector('#emptyStateMessage');
      if (msgEl) msgEl.textContent = 'Not signed in. Please refresh and sign in again.';
    }
    return;
  }
  
  // Unsubscribe from previous listener
  if (inboxState.inboxUnsubscribe) {
    try { inboxState.inboxUnsubscribe(); } catch (e) {
      console.warn('[Inbox] previous unsubscribe failed', e);
    }
    inboxState.inboxUnsubscribe = null;
  }
  clearInboxLoadingWatchdog();
  const loadGen = (inboxState._inboxLoadGen = (inboxState._inboxLoadGen || 0) + 1);
  
  // Show loading
  if (loadingEl) loadingEl.style.display = 'block';
  if (emptyEl) emptyEl.style.display = 'none';
  if (listEl) {
    listEl.querySelectorAll('.inbox-group-header, .inbox-group-body').forEach(el => el.remove());
  }

  // Never leave "Loading requests..." forever (Safari / flaky snapshot / rules stall).
  inboxState._inboxLoadWatchdog = setTimeout(() => {
    if (inboxState._inboxLoadGen !== loadGen) return;
    console.warn('[Inbox] load watchdog: snapshot still pending after 8s — forcing settle');
    if (loadingEl) loadingEl.style.display = 'none';
    if (!inboxState.currentRequests || inboxState.currentRequests.length === 0) {
      inboxState.currentRequests = inboxState.currentRequests || [];
      try {
        updateInboxStaffFilterOptions();
        updateInboxBadges();
        renderInboxList();
      } catch (e) {
        console.warn('[Inbox] watchdog render failed', e);
        if (emptyEl) {
          emptyEl.style.display = 'block';
          const msgEl = emptyEl.querySelector('#emptyStateMessage');
          if (msgEl) msgEl.textContent = 'Taking longer than usual. Try switching tabs or refreshing.';
        }
      }
    }
  }, 8000);
  
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
          if (!markInboxLoadSettled(loadGen)) return;
          inboxState._techInboxOutgoing = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          applyTechInboxMerge(loadingEl);
        },
        (error) => {
          if (!markInboxLoadSettled(loadGen)) return;
          console.error('[Inbox] Technician outgoing query error', error);
          showInboxLoadError(error, loadingEl, listEl, emptyEl);
        }
      );
      const unsubIn = onSnapshot(
        qIn,
        (snapshot) => {
          if (!markInboxLoadSettled(loadGen)) return;
          inboxState._techInboxIncoming = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          applyTechInboxMerge(loadingEl);
        },
        (error) => {
          if (!markInboxLoadSettled(loadGen)) return;
          console.error('[Inbox] Technician incoming query error', error);
          showInboxLoadError(error, loadingEl, listEl, emptyEl);
        }
      );
      inboxState.inboxUnsubscribe = () => {
        clearInboxLoadingWatchdog();
        unsubOut();
        unsubIn();
      };
      return;
    } else if (role !== "technician" && !canManage && !inboxCanSendRequests()) {
      if (!markInboxLoadSettled(loadGen)) return;
      if (loadingEl) loadingEl.style.display = "none";
      inboxState.currentRequests = [];
      updateInboxStaffFilterOptions();
      updateInboxBadges();
      renderInboxList();
      return;
    } else if (inboxState.inboxViewMode === "mine" || !canManage) {
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
      if (!markInboxLoadSettled(loadGen)) return;
      applyInboxSnapshotRows(snapshot, loadingEl);
    }, (error) => {
      if (inboxState._inboxLoadGen !== loadGen) return;
      console.error('[Inbox] Query error', error);
      if (inboxErrorNeedsIndex(error)) {
        try {
          if (typeof inboxState.inboxUnsubscribe === 'function') inboxState.inboxUnsubscribe();
        } catch (_) {}
        const mode = inboxState.inboxViewMode === "mine" || !canManage ? "mine" : "to_handle";
        inboxState.inboxUnsubscribe = subscribeInboxIndexFallback({
          salonId,
          uid,
          mode,
          loadingEl,
          listEl,
          emptyEl,
          loadGen,
        });
        // One-shot getDocs so we don't stay on "Loading…" if the fallback listener is slow.
        getDocs(query(
          collection(db, `salons/${salonId}/inboxItems`),
          where(mode === "mine" ? "createdByUid" : "forUid", "==", uid),
          limit(100)
        )).then((snap) => {
          if (!markInboxLoadSettled(loadGen)) return;
          applyInboxSnapshotRows(snap, loadingEl);
        }).catch((e) => {
          if (!markInboxLoadSettled(loadGen)) return;
          console.warn('[Inbox] getDocs fallback failed', e);
          showInboxLoadError(e, loadingEl, listEl, emptyEl);
        });
        return;
      }
      if (!markInboxLoadSettled(loadGen)) return;
      showInboxLoadError(error, loadingEl, listEl, emptyEl);
    });
    
  } catch (error) {
    console.error('[Inbox] Load error', error);
    markInboxLoadSettled(loadGen);
    if (loadingEl) loadingEl.style.display = 'none';
    showInboxLoadError(error, loadingEl, listEl, emptyEl);
  }
}

// =====================
// Background badge listener — runs regardless of which screen is visible
// =====================

export function _bgBadgeRecompute() {
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

export function startBgBadgeListener(uid, salonId, roleLc) {
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
