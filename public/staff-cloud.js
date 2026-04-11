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

// ─── Toast helper ─────────────────────────────────────────────────────────────
function _toast(msg, color) {
  // Replace any previous toast (avoid stacking)
  const existing = document.getElementById('ffToast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'ffToast';
  t.textContent = msg;
  t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:999999;
    padding:13px 20px;border-radius:10px;background:${color};color:#fff;
    font-size:14px;font-weight:700;box-shadow:0 6px 24px rgba(0,0,0,0.3);
    max-width:360px;line-height:1.4;pointer-events:none;`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 7000);
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

      // If Firestore is empty → migrate localStorage to Firestore (first time only)
      if (snap.empty && !_migrated) {
        _migrated = true;
        await _migrateLocalToCloud();
        return; // migration will trigger another snapshot
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
      _toast('❌ Firestore error: ' + (err.code || err.message), '#ef4444');
      console.error('[StaffCloud] onSnapshot error:', err.code, err.message, err);
    }
  );
}

// ─── First-time migration: localStorage → Firestore ───────────────────────────
async function _migrateLocalToCloud() {
  const raw   = localStorage.getItem('ff_staff_v1');
  const staff = raw ? (JSON.parse(raw).staff || []) : [];
  if (staff.length === 0) {
    console.log('[StaffCloud] No local staff to migrate');
    return;
  }
  console.log('[StaffCloud] Migrating', staff.length, 'staff to Firestore...');
  try {
    await _batchWrite(staff);
    _toast('☁️ Staff uploaded to cloud (' + staff.length + ')', '#7c3aed');
    console.log('[StaffCloud] Migration complete');
  } catch(e) {
    _toast('❌ Migration failed: ' + (e.code || e.message), '#ef4444');
    console.error('[StaffCloud] Migration error:', e.code, e.message, e);
    _migrated = false; // allow retry
  }
}

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
      _toast('⚠️ Cloud sync skipped — salonId not ready', '#f59e0b');
      return;
    }

    try {
      await _batchWrite(staff);
      _toast('✅ Staff saved to cloud (' + staff.length + ')', '#10b981');
    } catch(e) {
      _toast('❌ Save FAILED: ' + (e.code || e.message), '#ef4444');
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
    _toast('✅ Name updated: ' + newName, '#10b981');
  } catch(e) {
    console.warn('[StaffCloud] Name sync error', e.code, e.message);
  }
};

// ─── Public: delete a staff document from Firestore ────────────────────────────
window.ffStaffDeleteFromCloud = async function(staffId) {
  if (!_salonId || !staffId) throw new Error('Missing salonId or staffId');
  await deleteDoc(doc(db, `salons/${_salonId}/staff`, staffId));
  _toast('🗑️ Staff deleted', '#111827');
};
