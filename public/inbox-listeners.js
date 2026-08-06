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
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { inboxState, MANAGER_ONLY_INBOX_TYPES } from "./inbox-state.js?v=20260629_inbox_state_split";
import {
  ffInboxIsStaffCallOtherNoise,
  inboxItemActivityMs,
  inboxErrorNeedsIndex,
} from "./inbox-helpers.js?v=20260626_inbox_helpers_split";
import {
  inboxUserRoleLc,
  inboxCanManageInbox,
  inboxCanSendRequests,
} from "./inbox-data.js?v=20260630_inbox_data_split";
import {
  updateInboxStaffFilterOptions,
  updateInboxBadges,
  renderInboxList,
  inboxGetStaffLocationMap,
  inboxItemMatchesActiveLocation,
} from "./inbox-list-render.js?v=20260630_inbox_list_render_split";

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

// =====================
// Load & Render Requests
// =====================
export async function loadInboxItems() {
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
