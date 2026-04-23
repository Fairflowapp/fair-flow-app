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
import { db, auth } from "./app.js?v=20260411_chat_reminder_attrfix";

// ─── State ────────────────────────────────────────────────────────────────────
let _salonId  = null;
let _unsub    = null;
let _migrated = false;

// Debug logging (off by default)
const STAFF_CLOUD_DEBUG = false;
function dlog(...args) {
  if (STAFF_CLOUD_DEBUG) console.log(...args);
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

// ─── Auth listener ─────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (_unsub) { _unsub(); _unsub = null; }
  if (!user) { _salonId = null; _migrated = false; return; }

  // Wait for window.currentSalonId (set by app.js auth listener, async)
  for (let i = 0; i < 40; i++) {
    if (window.currentSalonId) break;
    await new Promise(r => setTimeout(r, 250));
  }

  _salonId = window.currentSalonId;
  if (!_salonId) { console.warn('[StaffCloud] No salonId — aborting'); return; }

  dlog('[StaffCloud] Starting. salonId:', _salonId,
       'path: salons/' + _salonId + '/staff');

  _startListener();
});

// ─── Real-time listener ────────────────────────────────────────────────────────
function _startListener() {
  const path = `salons/${_salonId}/staff`;
  dlog('[StaffCloud] onSnapshot → ' + path);

  _unsub = onSnapshot(
    collection(db, path),
    async snap => {
      dlog('[StaffCloud] onSnapshot received. docs:', snap.size);

      // NOTE: We deliberately do NOT auto-migrate localStorage → Firestore here.
      // An empty snapshot means a genuinely empty salon (e.g. a brand-new owner account).
      // Auto-migrating would leak the previous tenant's cached staff into the new salon
      // (multi-tenant data bleed). Empty salons must stay empty until the owner adds staff.
      if (snap.empty) {
        // Overwrite local cache with an empty list so stale data can't leak into the UI.
        localStorage.setItem('ff_staff_v1', JSON.stringify({ staff: [] }));
        dlog('[StaffCloud] Salon is empty — cleared local staff cache');
        document.dispatchEvent(new CustomEvent('ff-staff-cloud-updated'));
        return;
      }

      // Build staff from Firestore docs (explicit technicianTypes to handle any naming)
      const staff = snap.docs.map(d => {
        const data = d.data();
        const x = { ...data, id: d.id };
        delete x._syncedAt;
        // Ensure technicianTypes is preserved (Firestore may have it as technicianTypes or technicianType)
        if (data.technicianTypes !== undefined) {
          x.technicianTypes = Array.isArray(data.technicianTypes) ? data.technicianTypes : [];
        } else if (data.technicianType !== undefined) {
          x.technicianTypes = Array.isArray(data.technicianType) ? data.technicianType : [data.technicianType].filter(Boolean);
        }
        return x;
      }).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

      // ✅ Firestore wins: overwrite localStorage
      localStorage.setItem('ff_staff_v1', JSON.stringify({ staff }));
      dlog('[StaffCloud] localStorage updated with', staff.length, 'staff from Firestore');

      // Refresh UI
      document.dispatchEvent(new CustomEvent('ff-staff-cloud-updated'));
    },
    err => {
      _toast('❌ Firestore error: ' + (err.code || err.message), 'error');
      console.error('[StaffCloud] onSnapshot error:', err.code, err.message, err);
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
    const staff = snap.docs.map(d => { const x = {...d.data(), id: d.id}; delete x._syncedAt; return x; })
                           .sort((a, b) => (a.createdAt||0)-(b.createdAt||0));
    localStorage.setItem('ff_staff_v1', JSON.stringify({ staff }));
    dlog('[StaffCloud] ForceLoad: updated localStorage with', staff.length, 'from Firestore');
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
    await Promise.all([
      updateDoc(doc(db, `salons/${_salonId}/members`, md.id), { name: newName }),
      updateDoc(doc(db, 'users', md.id), { name: newName })
    ]);
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
    const results = await Promise.allSettled([
      updateDoc(memberRef, { role }),
      updateDoc(userRef, { role }),
    ]);
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length) {
      console.warn('[StaffCloud] role sync partial failure', failed.map(f => f.reason?.code || f.reason?.message));
    }
  } catch (e) {
    console.warn('[StaffCloud] role sync error', e?.code, e?.message);
  }
};
