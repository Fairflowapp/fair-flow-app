/**
 * Staff Cloud Sync — Firestore Always Wins
 *
 * Architecture (per user spec):
 *  - onSnapshot() → real-time listener, updates localStorage + UI on every change
 *  - Add/Edit/Delete → write to Firestore ONLY, let onSnapshot confirm the result
 *  - localStorage → display cache ONLY (never primary source)
 *  - On login → Firestore loads first, overrides localStorage
 *
 * Collection: salons/{salonId}/staff/{staffId}
 */

import {
  collection, doc, getDocs, getDoc,
  setDoc, writeBatch, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { db, auth } from "./app.js?v=20260501_points";

// ─── State ────────────────────────────────────────────────────────────────────
let _salonId  = null;
let _unsub    = null;
let _migrated = false;

// Debug logging (off by default)
const STAFF_CLOUD_DEBUG = false;
function dlog(...args) {
  if (STAFF_CLOUD_DEBUG) console.log(...args);
}

/**
 * When true, staging merges missing SP permission keys into Firestore via batch.update.
 * Must stay false: `update({ permissions })` replaces the whole map and races with the
 * Permissions tab + causes perceived "UI ≠ Firestore" on staging.
 */
const STAGING_SP_WRITE_DEFAULTS_TO_FIRESTORE = false;

/** Staging-only: fair-flow-staging Firestore gets explicit permission patches for line staff (never production). */
function _isFairFlowStagingProject() {
  try {
    return String(getApp().options.projectId || '') === 'fair-flow-staging';
  } catch (_) {
    return false;
  }
}

/**
 * Keys merged only when `permissions[key] === undefined` so explicit false from an owner is never overwritten.
 * Scope: non-owner line staff (technicians / non-manager desk roles), not archived.
 */
const _STAGING_SP_PERMISSION_DEFAULTS = Object.freeze({
  tickets_view: true,
  tickets_summary: true,
  tasks_view: true,
  tasks_use: true,
  inbox_view: true,
  inbox_send: true,
  queue_view: true,
  queue_join: true,
  /** Line staff often has no schedule_* keys; board would stay blocked while other tabs work. */
  schedule_view_own: true,
});

function _stagingStaffRowEligibleForSpDefaults(staff) {
  if (!staff || typeof staff !== 'object' || staff.isArchived === true) return false;
  if (staff.isAdmin === true) return false;
  const r = String(staff.role || 'technician').toLowerCase().trim();
  if (r === 'owner' || r === 'admin' || r === 'manager') return false;
  // Production: desk "manager" flag skips auto defaults. Staging: still patch (bad isManager data is common on test salons).
  if (staff.isManager === true && !_isFairFlowStagingProject()) return false;
  try {
    const ou = String(typeof window !== 'undefined' ? window.__ff_salon_owner_uid || '' : '').trim();
    const uid = String(staff.uid || staff.firebaseUid || '').trim();
    if (ou && uid === ou) return false;
  } catch (_) {}
  return true;
}

/**
 * @returns {{ staff: Array, patches: Array<{ id: string, permissions: object }> }}
 */
function _applyStagingTechnicianPermissionDefaults(staffList) {
  if (!_isFairFlowStagingProject() || !Array.isArray(staffList)) {
    return { staff: staffList, patches: [] };
  }
  const patches = [];
  const staff = staffList.map(s => {
    if (!_stagingStaffRowEligibleForSpDefaults(s)) return s;
    const prev = s.permissions && typeof s.permissions === 'object' ? s.permissions : {};
    let changed = false;
    const next = { ...prev };
    for (const [key, val] of Object.entries(_STAGING_SP_PERMISSION_DEFAULTS)) {
      if (next[key] === undefined) {
        next[key] = val;
        changed = true;
      }
    }
    if (!changed) return s;
    const id = String(s.id || '').trim();
    const cleanedPerms = _sanitize(next) || next;
    if (id) patches.push({ id, permissions: cleanedPerms });
    return { ...s, permissions: cleanedPerms };
  });
  return { staff, patches };
}

async function _persistStagingTechPermissionPatches(patches) {
  if (!_salonId || !patches.length) return;
  try {
    for (let i = 0; i < patches.length; i += 400) {
      const batch = writeBatch(db);
      patches.slice(i, i + 400).forEach(({ id, permissions }) => {
        if (!id || !permissions) return;
        batch.update(doc(db, `salons/${_salonId}/staff`, id), {
          permissions,
          _syncedAt: serverTimestamp(),
        });
      });
      await batch.commit();
    }
    console.log('[StaffCloud][Staging] Persisted SP permission defaults for', patches.length, 'row(s).');
  } catch (e) {
    console.warn('[StaffCloud][Staging] Permission patch persist failed:', e?.code, e?.message);
  }
}

// Firestore does NOT allow undefined. Sanitize recursively.
function _sanitize(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map(v => _sanitize(v)).filter(v => v !== undefined);
  }
  if (t === 'object') {
    const out = {};
    Object.keys(value).forEach(k => {
      const v = _sanitize(value[k]);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }
  return undefined;
}

// ─── Toast (global Fair Flow API: window.ffToast — see ff-toast.js) ─────────────
function _toast(msg, variant = 'info') {
  if (typeof window !== 'undefined' && window.ffToast && typeof window.ffToast.show === 'function') {
    window.ffToast.show(msg, { variant: variant || 'info', durationMs: 7000 });
    return;
  }
  console.warn('[StaffCloud]', msg);
}

// Collapse rapid consecutive saves into one write (e.g. save staff + save invite status)
let _saveTimer = null;
let _queuedStaffData = null;
let _staffIdRetryTimer = null;
/** When true, we are waiting for membership/users.staffId before single-doc sync can attach. */
let _singleStaffListenWaitingForId = false;

const STAFF_CLOUD_HYDRATED_KEY = 'ff_staff_cloud_hydrated_v1';

function _clearStaffIdRetryTimer() {
  if (_staffIdRetryTimer) {
    clearTimeout(_staffIdRetryTimer);
    _staffIdRetryTimer = null;
  }
}

if (typeof document !== 'undefined' && !globalThis.__ffStaffCloudStaffIdEventBound) {
  globalThis.__ffStaffCloudStaffIdEventBound = true;
  document.addEventListener('ff-authed-staff-id-changed', () => {
    try {
      const u = auth.currentUser;
      if (!u || !_salonId) return;
      let staffEmpty = true;
      try {
        const st = JSON.parse(localStorage.getItem('ff_staff_v1') || '{}');
        staffEmpty = !Array.isArray(st.staff) || st.staff.length === 0;
      } catch (_) {}
      if (!staffEmpty && !_singleStaffListenWaitingForId) return;
      _clearStaffIdRetryTimer();
      void _startSingleStaffDocListener(u, 0);
    } catch (e) {
      console.warn('[StaffCloud] ff-authed-staff-id-changed handler failed', e);
    }
  });
}

function _markStaffCloudHydrated() {
  try {
    sessionStorage.setItem(STAFF_CLOUD_HYDRATED_KEY, String(Date.now()));
  } catch (_) {}
}

/** Same shape as collection snapshot mapping (works with QueryDocumentSnapshot or DocumentSnapshot). */
function _normaliseStaffSnapshotDoc(d) {
  const data = d.data();
  const x = { ...data, id: d.id };
  delete x._syncedAt;
  if (data.technicianTypes !== undefined) {
    x.technicianTypes = Array.isArray(data.technicianTypes) ? data.technicianTypes : [];
  } else if (data.technicianType !== undefined) {
    x.technicianTypes = Array.isArray(data.technicianType) ? data.technicianType : [data.technicianType].filter(Boolean);
  }
  return x;
}

/**
 * Write staff array to ff_staff_v1, sync legacy workers, optional staging patches, dispatch ff-staff-cloud-updated.
 * @param {object} [options]
 * @param {boolean} [options.skipHydrate] If true, do not set ff_staff_cloud_hydrated_v1 (still "loading" for permissions).
 *        Use when staffId is not known yet so we never flip to staff_unresolved with an empty cache.
 */
function _commitStaffArrayToCache(rawStaff, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const skipHydrate = !!opts.skipHydrate;
  const rawStaffSorted = (rawStaff || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const { staff, patches } = _applyStagingTechnicianPermissionDefaults(rawStaffSorted);
  localStorage.setItem('ff_staff_v1', JSON.stringify({ staff }));
  dlog('[StaffCloud] localStorage updated with', staff.length, 'staff from Firestore');
  try {
    if (typeof globalThis.ffSyncLegacyWorkersFromStaffStore === 'function') {
      globalThis.ffSyncLegacyWorkersFromStaffStore({ staff }, true);
    }
  } catch (eSync) {
    console.warn('[StaffCloud] ffSyncLegacyWorkersFromStaffStore after snapshot:', eSync);
  }
  if (STAGING_SP_WRITE_DEFAULTS_TO_FIRESTORE && patches.length) {
    void _persistStagingTechPermissionPatches(patches);
  }
  if (!skipHydrate) {
    _markStaffCloudHydrated();
  } else {
    try {
      sessionStorage.removeItem(STAFF_CLOUD_HYDRATED_KEY);
    } catch (_) {}
  }
  try {
    const ev = new CustomEvent('ff-staff-cloud-updated', {
      bubbles: true,
      detail: { provisional: skipHydrate },
    });
    document.dispatchEvent(ev);
    window.dispatchEvent(ev);
  } catch (eEv) {
    try {
      document.dispatchEvent(
        new CustomEvent('ff-staff-cloud-updated', { detail: { provisional: skipHydrate } })
      );
    } catch (_) {}
  }
}

async function _resolveOwnStaffIdForListener(user) {
  if (!user || !user.uid || !_salonId) return '';
  let sid = String(
    (typeof window !== 'undefined' && window.__ff_authedStaffId) ||
      (typeof localStorage !== 'undefined' ? localStorage.getItem('ff_authedStaffId_v1') : '') ||
      ''
  ).trim();
  if (sid) return sid;
  try {
    const mref = doc(db, 'users', user.uid, 'memberships', _salonId);
    const ms = await getDoc(mref);
    if (ms.exists()) {
      sid = String((ms.data() || {}).staffId || '').trim();
      if (sid) return sid;
    }
  } catch (e) {
    dlog('[StaffCloud] membership staffId read failed', e);
  }
  try {
    const uref = doc(db, 'users', user.uid);
    const us = await getDoc(uref);
    if (us.exists()) {
      sid = String((us.data() || {}).staffId || '').trim();
      if (sid) return sid;
    }
  } catch (e2) {
    dlog('[StaffCloud] users/{uid} staffId read failed', e2);
  }
  return '';
}

/**
 * Line staff cannot list salons/{id}/staff (rules allow only their doc). Fallback: single-doc listener.
 * Retries resolving staffId — app.js often writes membership/staffId shortly after staff-cloud starts.
 */
async function _startSingleStaffDocListener(user, attempt) {
  _clearStaffIdRetryTimer();
  const n = typeof attempt === 'number' ? attempt : 0;
  if (!_salonId || !user) {
    _singleStaffListenWaitingForId = false;
    _commitStaffArrayToCache([]);
    return;
  }
  const staffId = await _resolveOwnStaffIdForListener(user);
  if (staffId) {
    _singleStaffListenWaitingForId = false;
    if (_unsub) {
      try {
        _unsub();
      } catch (_) {}
      _unsub = null;
    }
    const dref = doc(db, `salons/${_salonId}/staff`, staffId);
    dlog('[StaffCloud] onSnapshot → single doc', staffId);

    _unsub = onSnapshot(
      dref,
      snap => {
        const rawStaff = [];
        if (snap.exists()) {
          rawStaff.push(_normaliseStaffSnapshotDoc(snap));
        }
        _commitStaffArrayToCache(rawStaff);
      },
      err => {
        console.error('[StaffCloud] single-staff onSnapshot error:', err.code, err.message, err);
        _commitStaffArrayToCache([]);
        _toast('❌ Firestore error: ' + (err.code || err.message), 'error');
      }
    );
    return;
  }

  _singleStaffListenWaitingForId = true;
  if (n === 0) {
    console.warn(
      '[StaffCloud] staffId not ready yet — will retry (app membership often loads after this module); attempt',
      n
    );
    _commitStaffArrayToCache([], { skipHydrate: true });
  }

  const maxAttempts = 48;
  if (n >= maxAttempts) {
    _singleStaffListenWaitingForId = false;
    console.warn('[StaffCloud] Giving up single-doc sync: no staffId after', maxAttempts, 'attempts');
    _commitStaffArrayToCache([]);
    return;
  }

  _staffIdRetryTimer = setTimeout(() => {
    void _startSingleStaffDocListener(user, n + 1);
  }, 220);
}

// ─── Auth listener ─────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (_unsub) { _unsub(); _unsub = null; }
  _clearStaffIdRetryTimer();
  _singleStaffListenWaitingForId = false;
  if (!user) {
    _salonId = null;
    _migrated = false;
    try {
      sessionStorage.removeItem(STAFF_CLOUD_HYDRATED_KEY);
    } catch (_) {}
    return;
  }

  // Wait for window.currentSalonId (set by app.js auth listener, async)
  for (let i = 0; i < 40; i++) {
    if (window.currentSalonId) break;
    await new Promise(r => setTimeout(r, 250));
  }

  _salonId = window.currentSalonId;
  if (!_salonId) { console.warn('[StaffCloud] No salonId — aborting'); return; }

  dlog('[StaffCloud] Starting. salonId:', _salonId,
       'path: salons/' + _salonId + '/staff');

  _startListener(user);
});

// ─── Real-time listener ────────────────────────────────────────────────────────
function _startListener(user) {
  const path = `salons/${_salonId}/staff`;
  const authedUser = user || auth.currentUser;
  dlog('[StaffCloud] onSnapshot → ' + path + ' (collection)');

  _unsub = onSnapshot(
    collection(db, path),
    snap => {
      dlog('[StaffCloud] onSnapshot received. docs:', snap.size);

      // NOTE: We deliberately do NOT auto-migrate localStorage → Firestore here.
      // An empty snapshot means a genuinely empty salon (e.g. a brand-new owner account).
      // Auto-migrating would leak the previous tenant's cached staff into the new salon
      // (multi-tenant data bleed). Empty salons must stay empty until the owner adds staff.
      if (snap.empty) {
        dlog('[StaffCloud] Salon is empty — cleared local staff cache');
        _commitStaffArrayToCache([]);
        return;
      }

      const rawStaff = snap.docs.map(d => _normaliseStaffSnapshotDoc(d));
      _commitStaffArrayToCache(rawStaff);
    },
    err => {
      console.warn('[StaffCloud] collection onSnapshot error:', err.code, err.message, err);
      const code = String(err.code || '');
      if (_unsub) {
        try { _unsub(); } catch (_) {}
        _unsub = null;
      }
      if (code === 'permission-denied' || code === 'failed-precondition') {
        void _startSingleStaffDocListener(authedUser);
        return;
      }
      _toast('❌ Firestore error: ' + (code || err.message), 'error');
    }
  );
}

// ─── (Removed: _migrateLocalToCloud) ──────────────────────────────────────────
// Previous versions auto-migrated localStorage staff into any empty salon on login.
// That leaked staff across tenants when the same browser logged into a new account.
// See comment inside _startListener() above.

// ─── Public: purge every staff doc from the current salon (one-click cleanup) ─
// Intended for the recovery case where previous auto-migration leaked data into
// a fresh salon. Use via the browser console: await window.ffClearAllStaffFromCloud();
window.ffClearAllStaffFromCloud = async function() {
  if (!_salonId) {
    console.warn('[StaffCloud] Cannot clear — no salonId.');
    return { deleted: 0 };
  }
  try {
    const snap = await getDocs(collection(db, `salons/${_salonId}/staff`));
    if (snap.empty) {
      console.log('[StaffCloud] Nothing to clear — salon has no staff.');
      return { deleted: 0 };
    }
    let deleted = 0;
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + 400).forEach(d => {
        batch.delete(doc(db, `salons/${_salonId}/staff`, d.id));
        deleted += 1;
      });
      await batch.commit();
    }
    localStorage.setItem('ff_staff_v1', JSON.stringify({ staff: [] }));
    _toast('🗑️ Cleared ' + deleted + ' staff from this salon', 'success');
    return { deleted };
  } catch (e) {
    console.error('[StaffCloud] ffClearAllStaffFromCloud error:', e);
    _toast('❌ Clear failed: ' + (e.code || e.message), 'error');
    throw e;
  }
};

// ─── Batch write helper ────────────────────────────────────────────────────────
async function _batchWrite(staff) {
  for (let i = 0; i < staff.length; i += 400) {
    const batch = writeBatch(db);
    staff.slice(i, i + 400).forEach(s => {
      if (!s.id) return;
      const { _syncedAt, ...cleanRaw } = { ...s };
      const clean = _sanitize(cleanRaw) || {};
      // Ensure technicianTypes is always written for technicians (task filter needs it)
      const isTechnician = s.role === 'technician' || (!s.isAdmin && !s.isManager);
      if (isTechnician) {
        clean.technicianTypes = Array.isArray(s.technicianTypes) ? s.technicianTypes : [];
      }
      dlog('[StaffCloud] Writing staff doc:', s.id, s.name,
           'to salons/' + _salonId + '/staff/' + s.id);
      batch.set(
        doc(db, `salons/${_salonId}/staff`, s.id),
        { ...clean, _syncedAt: serverTimestamp() },
        { merge: true }
      );
    });
    await batch.commit();
    dlog('[StaffCloud] Batch committed:', staff.slice(i, i+400).length, 'docs');
  }
}

// ─── Public: force a fresh getDocs from Firestore (called on modal open) ────────
window.ffStaffForceLoad = async function() {
  if (!_salonId) return;
  try {
    const snap  = await getDocs(collection(db, `salons/${_salonId}/staff`));
    if (snap.empty) return;
    const rawStaff = snap.docs.map(d => { const x = {...d.data(), id: d.id}; delete x._syncedAt; return x; })
                           .sort((a, b) => (a.createdAt||0)-(b.createdAt||0));
    const { staff, patches } = _applyStagingTechnicianPermissionDefaults(rawStaff);
    localStorage.setItem('ff_staff_v1', JSON.stringify({ staff }));
    dlog('[StaffCloud] ForceLoad: updated localStorage with', staff.length, 'from Firestore');
    try {
      if (typeof globalThis.ffSyncLegacyWorkersFromStaffStore === 'function') {
        globalThis.ffSyncLegacyWorkersFromStaffStore({ staff }, true);
      }
    } catch (_) {}
    if (STAGING_SP_WRITE_DEFAULTS_TO_FIRESTORE && patches.length) {
      void _persistStagingTechPermissionPatches(patches);
    }
  } catch(e) {
    console.warn('[StaffCloud] ForceLoad error:', e.code, e.message);
  }
};

// ─── Public: called by ffSaveStaffStore after every local save ─────────────────
window.ffStaffSyncToCloud = async function(staffData) {
  _queuedStaffData = staffData;
  if (_saveTimer) clearTimeout(_saveTimer);

  // Write once after short delay (captures bursts of ffSaveStaffStore calls)
  _saveTimer = setTimeout(async () => {
    _saveTimer = null;
    const staff = Array.isArray(_queuedStaffData?.staff) ? _queuedStaffData.staff : [];

    dlog('[StaffCloud] Debounced save →',
         'salonId:', _salonId, 'staff count:', staff.length);

    if (!_salonId) {
      _toast('⚠️ Cloud sync skipped — salonId not ready', 'warning');
      return;
    }

    try {
      await _batchWrite(staff);
      _toast('✅ Staff saved to cloud (' + staff.length + ')', 'success');
    } catch(e) {
      _toast('❌ Save FAILED: ' + (e.code || e.message), 'error');
      console.error('[StaffCloud] Save error:', e.code, e.message, e);
    }
  }, 450);
};

// ─── Public: sync name change to users/{uid} + members/{uid} ──────────────────
window.ffStaffSyncNameToFirestore = async function(email, newName) {
  if (!_salonId || !email || !newName) return;
  try {
    const snap = await getDocs(collection(db, `salons/${_salonId}/members`));
    const md   = snap.docs.find(d => d.data().email === email);
    if (!md) { console.log('[StaffCloud] No member found for', email); return; }
    const results = await Promise.allSettled([
      updateDoc(doc(db, `salons/${_salonId}/members`, md.id), { name: newName }),
      updateDoc(doc(db, 'users', md.id), { name: newName }),
      setDoc(doc(db, `users/${md.id}/memberships`, _salonId), {
        salonId: _salonId,
        name: newName,
        status: 'active',
        updatedAt: serverTimestamp()
      }, { merge: true })
    ]);
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length) {
      console.warn('[StaffCloud] name sync partial failure', failed.map(f => f.reason?.code || f.reason?.message));
    }
    _toast('✅ Name updated: ' + newName, 'success');
  } catch(e) {
    console.warn('[StaffCloud] Name sync error', e.code, e.message);
  }
};

// ─── Public: delete a staff document from Firestore ────────────────────────────
window.ffStaffDeleteFromCloud = async function(staffId) {
  if (!_salonId || !staffId) throw new Error('Missing salonId or staffId');
  await deleteDoc(doc(db, `salons/${_salonId}/staff`, staffId));
  _toast('🗑️ Staff deleted', 'neutral');
};

// ─── Public: sync role from staff record → users/{uid} + members/{uid} ─────────
/**
 * Keeps `users/{uid}.role` and `salons/{salonId}/members/{uid}.role` in sync
 * with the staff record's role flags. Without this, a staff member demoted
 * from "manager" to "technician" in the staff editor would still pass
 * `isManager(salonId)` checks in firestore.rules (which read `users.role`),
 * and a promotion would fail the same check until the user signs out.
 *
 * Accepts the staff record (needs id + uid/email + new role fields) and
 * returns a promise that resolves when both docs are updated (or quietly
 * no-ops if the staff isn't linked to a Firebase Auth user yet).
 */
/**
 * Diagnostic console helper: scans staff/{id} ⟷ users/{uid} ⟷ members/{uid}
 * for role drift and prints a table. Run from DevTools:
 *   await ffAuditStaffRoleDrift();
 *
 * Returns the drift rows; optional `fix: true` argument will push the staff
 * record's role to users + members to resolve the drift.
 */
window.ffAuditStaffRoleDrift = async function ffAuditStaffRoleDrift(opts = {}) {
  const shouldFix = opts && opts.fix === true;
  if (!_salonId) {
    console.warn('[StaffCloud] Role drift audit requires an active salonId.');
    return [];
  }
  try {
    const [staffSnap, membersSnap] = await Promise.all([
      getDocs(collection(db, `salons/${_salonId}/staff`)),
      getDocs(collection(db, `salons/${_salonId}/members`)),
    ]);
    const membersByUid = new Map(membersSnap.docs.map(d => [d.id, d.data() || {}]));
    const drift = [];
    for (const sDoc of staffSnap.docs) {
      const s = sDoc.data() || {};
      if (s.isArchived === true) continue;
      const uid = String(s.uid || '').trim();
      if (!uid) continue; // unlinked (invite not yet finalized)
      const staffRole = s.isAdmin === true ? 'admin'
        : s.isManager === true ? 'manager'
        : String(s.role || 'technician').toLowerCase();
      const memberRole = String((membersByUid.get(uid) || {}).role || '').toLowerCase();
      let userRole = '';
      try {
        const uSnap = await getDoc(doc(db, 'users', uid));
        if (uSnap.exists()) userRole = String(uSnap.data().role || '').toLowerCase();
      } catch (e) {
        userRole = `(read failed: ${e.code || e.message})`;
      }
      if (staffRole !== memberRole || staffRole !== userRole) {
        drift.push({
          staffId: sDoc.id,
          name: s.name || '(unknown)',
          uid,
          staffRole,
          memberRole,
          userRole,
        });
      }
    }
    if (!drift.length) {
      console.info('[StaffCloud] No role drift detected.');
      return [];
    }
    console.group('[StaffCloud] Role drift detected');
    console.table(drift);
    console.groupEnd();
    if (shouldFix) {
      console.info('[StaffCloud] Syncing', drift.length, 'drifted record(s)…');
      for (const row of drift) {
        const staffDoc = await getDoc(doc(db, `salons/${_salonId}/staff`, row.staffId));
        if (!staffDoc.exists()) continue;
        await window.ffStaffSyncRoleToFirestore({ id: row.staffId, ...staffDoc.data() });
      }
      console.info('[StaffCloud] Sync complete. Re-run ffAuditStaffRoleDrift() to verify.');
    } else {
      console.info('[StaffCloud] Pass { fix: true } to ffAuditStaffRoleDrift to resolve drift.');
    }
    return drift;
  } catch (e) {
    console.error('[StaffCloud] Role drift audit failed', e);
    return [];
  }
};

window.ffStaffSyncRoleToFirestore = async function(staff) {
  if (!_salonId || !staff) return;
  const role = String(
    staff.isAdmin === true ? 'admin'
    : staff.isManager === true ? 'manager'
    : staff.role || 'technician'
  ).toLowerCase();

  try {
    // Prefer the uid cached on the staff record (set during invite
    // finalization). Fall back to looking up the member by email so older
    // records without a uid still sync.
    let memberUid = String(staff.uid || '').trim();
    let memberEmail = String(staff.email || '').trim().toLowerCase();
    if (!memberUid && memberEmail) {
      const snap = await getDocs(collection(db, `salons/${_salonId}/members`));
      const md = snap.docs.find(d => String(d.data().email || '').toLowerCase() === memberEmail);
      if (md) memberUid = md.id;
    }
    if (!memberUid) {
      // Unlinked staff (invite not yet accepted). Nothing to sync.
      return;
    }

    const memberRef = doc(db, `salons/${_salonId}/members`, memberUid);
    const userRef = doc(db, 'users', memberUid);
    const membershipRef = doc(db, `users/${memberUid}/memberships`, _salonId);
    const results = await Promise.allSettled([
      updateDoc(memberRef, { role }),
      updateDoc(userRef, { role }),
      setDoc(membershipRef, {
        salonId: _salonId,
        role,
        staffId: String(staff.id || staff.staffId || '').trim(),
        status: 'active',
        updatedAt: serverTimestamp()
      }, { merge: true }),
    ]);
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length) {
      console.warn('[StaffCloud] role sync partial failure', failed.map(f => f.reason?.code || f.reason?.message));
    }
  } catch (e) {
    console.warn('[StaffCloud] role sync error', e?.code, e?.message);
  }
};
