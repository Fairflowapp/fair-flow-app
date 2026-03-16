/**
 * Settings Cloud – sync UI settings + app settings to Firestore.
 *
 * Firestore docs:
 *   salons/{salonId}/settings/ui   → { historyRange, updatedAt }
 *   salons/{salonId}/settings/main → { adminPin (existing), brandName, brandPalette, managers,
 *                                      staffCallTemplates,
 *                                      taskSettings: { taskReminders, taskNotes, showIncompleteTasksBadge },
 *                                      updatedAt }
 */

import { doc, getDoc, setDoc, onSnapshot, serverTimestamp, collection, getDocs, addDoc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { db, auth } from "./app.js?v=20260312_fix2";

let _salonId = null;
let _unsubUi = null;
let _unsubMain = null;
let _unsubTechnicianTypes = null;

async function getSalonId() {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) {
      const data = userDoc.data();
      return data.salonId || (typeof window !== "undefined" ? window.currentSalonId : null) || null;
    }
  } catch (e) {
    console.warn("[SettingsCloud] getSalonId failed", e);
  }
  return typeof window !== "undefined" ? window.currentSalonId : null;
}

// ─── UI Settings (historyRange) ───────────────────────────────────────────────

function settingsUiRef(salonId) {
  return doc(db, `salons/${salonId}/settings`, "ui");
}

function subscribeUi(salonId) {
  if (_unsubUi) { _unsubUi(); _unsubUi = null; }
  _unsubUi = onSnapshot(settingsUiRef(salonId), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.historyRange) {
      window.__ff_historyRange = data.historyRange;
      try { localStorage.setItem('ff_history_range_v1', data.historyRange); } catch (_) {}
    }
  }, (err) => console.warn("[SettingsCloud] ui subscribe error", err));
}

function ffSaveHistoryRange(value) {
  window.__ff_historyRange = value;
  try { localStorage.setItem('ff_history_range_v1', value); } catch (_) {}
  if (!_salonId) return;
  setDoc(settingsUiRef(_salonId), { historyRange: value, updatedAt: serverTimestamp() }, { merge: true })
    .catch((e) => console.warn("[SettingsCloud] save historyRange failed", e));
}

// ─── App Settings (brand name, palette, managers) ────────────────────────────

function settingsMainRef(salonId) {
  return doc(db, `salons/${salonId}/settings`, "main");
}

function normalizeStaffCallTemplates(value) {
  if (typeof window !== "undefined" && typeof window.ffNormalizeStaffCallTemplates === "function") {
    return window.ffNormalizeStaffCallTemplates(value);
  }
  const raw = value && typeof value === "object" ? value : {};
  return {
    available: {
      presetId: String(raw?.available?.presetId || "available_default"),
      message: String(raw?.available?.message || "Your client is waiting"),
      detail: String(raw?.available?.detail || "Please return to the queue.")
    },
    inService: {
      presetId: String(raw?.inService?.presetId || "inservice_default"),
      message: String(raw?.inService?.message || "Reception is calling you"),
      detail: String(raw?.inService?.detail || "Please come to reception.")
    }
  };
}

function normalizeStaffCallTimeoutSeconds(value) {
  if (typeof window !== "undefined" && typeof window.ffGetStaffCallTimeoutSeconds === "function" && value === undefined) {
    return window.ffGetStaffCallTimeoutSeconds();
  }
  const numericValue = Math.round(Number(value || 0));
  if (!Number.isFinite(numericValue)) return 30;
  return Math.min(3600, Math.max(10, numericValue));
}

function subscribeMain(salonId) {
  if (_unsubMain) { _unsubMain(); _unsubMain = null; }
  _unsubMain = onSnapshot(settingsMainRef(salonId), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    // Apply to global settings object
    if (typeof window.settings !== 'object' || !window.settings) return;
    let changed = false;
    if (data.brandName && typeof data.brandName === 'string') {
      if (!window.settings.brand) window.settings.brand = {};
      window.settings.brand.name = data.brandName;
      changed = true;
    }
    if (Array.isArray(data.brandPalette) && data.brandPalette.length) {
      window.settings.brandPalette = data.brandPalette;
      changed = true;
    }
    if (Array.isArray(data.managers)) {
      window.settings.managers = data.managers;
      changed = true;
    }
    if (data.staffCallTemplates && typeof data.staffCallTemplates === 'object') {
      window.settings.staffCallTemplates = normalizeStaffCallTemplates(data.staffCallTemplates);
      changed = true;
    }
    if (data.staffCallTimeoutSeconds !== undefined) {
      window.settings.staffCallTimeoutSeconds = normalizeStaffCallTimeoutSeconds(data.staffCallTimeoutSeconds);
      changed = true;
    }
    // Task settings
    if (data.taskSettings && typeof data.taskSettings === 'object') {
      if (data.taskSettings.taskReminders !== undefined) {
        window.settings.taskReminders = data.taskSettings.taskReminders;
        changed = true;
      }
      if (data.taskSettings.taskNotes !== undefined) {
        window.settings.taskNotes = data.taskSettings.taskNotes;
        changed = true;
      }
      if (data.taskSettings.showIncompleteTasksBadge !== undefined) {
        window.settings.showIncompleteTasksBadge = data.taskSettings.showIncompleteTasksBadge;
        changed = true;
      }
    }
    if (changed) {
      // Keep localStorage in sync as cache
      try {
        const stored = JSON.parse(localStorage.getItem('ffv24_settings') || '{}');
        if (data.brandName) { if (!stored.brand) stored.brand = {}; stored.brand.name = data.brandName; }
        if (data.brandPalette?.length) stored.brandPalette = data.brandPalette;
        if (data.managers) stored.managers = data.managers;
        if (data.staffCallTemplates && typeof data.staffCallTemplates === 'object') stored.staffCallTemplates = normalizeStaffCallTemplates(data.staffCallTemplates);
        if (data.staffCallTimeoutSeconds !== undefined) stored.staffCallTimeoutSeconds = normalizeStaffCallTimeoutSeconds(data.staffCallTimeoutSeconds);
        if (data.taskSettings?.taskReminders !== undefined) stored.taskReminders = data.taskSettings.taskReminders;
        if (data.taskSettings?.taskNotes !== undefined) stored.taskNotes = data.taskSettings.taskNotes;
        if (data.taskSettings?.showIncompleteTasksBadge !== undefined) stored.showIncompleteTasksBadge = data.taskSettings.showIncompleteTasksBadge;
        localStorage.setItem('ffv24_settings', JSON.stringify(stored));
      } catch (_) {}
      // Re-render brand if available
      if (typeof window.renderBrand === 'function') window.renderBrand();
    }
  }, (err) => console.warn("[SettingsCloud] main subscribe error", err));
}

/**
 * Save app settings (brand name, palette, managers, staff call templates) to Firestore.
 * Called from index.html settings panel save.
 */
function ffSaveAppSettings(brandName, brandPalette, managers, staffCallTemplates, staffCallTimeoutSeconds) {
  if (!_salonId) return;
  const payload = { updatedAt: serverTimestamp() };
  if (brandName !== undefined) payload.brandName = brandName || '';
  if (Array.isArray(brandPalette)) payload.brandPalette = brandPalette;
  if (Array.isArray(managers)) payload.managers = managers;
  if (staffCallTemplates && typeof staffCallTemplates === 'object') payload.staffCallTemplates = normalizeStaffCallTemplates(staffCallTemplates);
  if (staffCallTimeoutSeconds !== undefined) payload.staffCallTimeoutSeconds = normalizeStaffCallTimeoutSeconds(staffCallTimeoutSeconds);
  setDoc(settingsMainRef(_salonId), payload, { merge: true })
    .catch((e) => console.warn("[SettingsCloud] save app settings failed", e));
}

/**
 * Save task settings (reminders, notes, badge) to Firestore.
 * Called from index.html saveSettings().
 */
function ffSaveTaskSettings(taskReminders, taskNotes, showIncompleteTasksBadge) {
  if (!_salonId) return;
  const taskSettings = {};
  if (taskReminders !== undefined) taskSettings.taskReminders = taskReminders;
  if (taskNotes !== undefined) taskSettings.taskNotes = taskNotes;
  if (showIncompleteTasksBadge !== undefined) taskSettings.showIncompleteTasksBadge = showIncompleteTasksBadge;
  if (Object.keys(taskSettings).length === 0) return;
  setDoc(settingsMainRef(_salonId), { taskSettings, updatedAt: serverTimestamp() }, { merge: true })
    .catch((e) => console.warn("[SettingsCloud] save task settings failed", e));
}

// ─── Technician Types ───────────────────────────────────────────────────────────

/**
 * Convert display name to stable ID (supports Hebrew and Unicode)
 * Latin names: kebab-case. Hebrew/Unicode: keep letters, collapse spaces to hyphen
 */
function nameToId(name) {
  if (!name || typeof name !== 'string') return '';
  const s = name.trim().toLowerCase();
  if (!s) return '';
  // First try: Latin-only (original behavior)
  const latin = s.replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (latin) return latin;
  // Fallback: keep Unicode letters and digits (Hebrew, etc.)
  const unicode = s.replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return unicode || '';
}

function technicianTypesCollectionRef(salonId) {
  // Firestore requires even number of segments, so we use salons/{salonId}/technicianTypes instead of salons/{salonId}/settings/technicianTypes
  return collection(db, `salons/${salonId}/technicianTypes`);
}

function technicianTypeDocRef(salonId, technicianTypeId) {
  // Firestore requires even number of segments, so we use salons/{salonId}/technicianTypes instead of salons/{salonId}/settings/technicianTypes
  return doc(db, `salons/${salonId}/technicianTypes`, technicianTypeId);
}

/**
 * Subscribe to technician types changes
 */
function subscribeTechnicianTypes(salonId) {
  if (_unsubTechnicianTypes) { _unsubTechnicianTypes(); _unsubTechnicianTypes = null; }
  _unsubTechnicianTypes = onSnapshot(
    technicianTypesCollectionRef(salonId),
    (snap) => {
      const types = snap.docs.map(d => {
        const data = d.data();
        return { ...data, id: d.id };
      }).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      
      // Trigger UI update event
      document.dispatchEvent(new CustomEvent('ff-technician-types-updated', { detail: types }));
    },
    (err) => console.warn("[SettingsCloud] technician types subscribe error", err)
  );
}

/**
 * Get all technician types
 */
async function ffGetTechnicianTypes() {
  if (!_salonId) return [];
  try {
    const snap = await getDocs(technicianTypesCollectionRef(_salonId));
    return snap.docs.map(d => {
      const data = d.data();
      return { ...data, id: d.id };
    }).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  } catch (e) {
    console.warn("[SettingsCloud] get technician types failed", e);
    return [];
  }
}

/**
 * Check if technician type name/id already exists
 */
async function ffCheckTechnicianTypeExists(name, excludeId = null) {
  if (!_salonId) return false;
  try {
    const snap = await getDocs(technicianTypesCollectionRef(_salonId));
    const id = nameToId(name);
    return snap.docs.some(d => {
      if (excludeId && d.id === excludeId) return false;
      const data = d.data();
      return d.id === id || 
             (data.name && data.name.toLowerCase().trim() === name.toLowerCase().trim());
    });
  } catch (e) {
    console.warn("[SettingsCloud] check technician type exists failed", e);
    return false;
  }
}

/**
 * Create new technician type
 */
async function ffCreateTechnicianType(name) {
  if (!_salonId || !name || !name.trim()) {
    throw new Error("Name is required");
  }
  
  const trimmedName = name.trim();
  const id = nameToId(trimmedName);
  
  if (!id) {
    throw new Error("Invalid name - must contain at least one letter or number");
  }
  
  // Check for duplicates
  const exists = await ffCheckTechnicianTypeExists(trimmedName);
  if (exists) {
    throw new Error("A technician type with this name already exists");
  }
  
  // Get current max sortOrder
  const existing = await ffGetTechnicianTypes();
  const maxSortOrder = existing.length > 0 
    ? Math.max(...existing.map(t => t.sortOrder || 0))
    : -1;
  
  const newType = {
    id: id,
    name: trimmedName,
    active: true,
    sortOrder: maxSortOrder + 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  
  await setDoc(technicianTypeDocRef(_salonId, id), newType);
  return { ...newType, id };
}

/**
 * Update technician type (name or active status)
 */
async function ffUpdateTechnicianType(technicianTypeId, updates) {
  if (!_salonId || !technicianTypeId) {
    throw new Error("Technician type ID is required");
  }
  
  const docRef = technicianTypeDocRef(_salonId, technicianTypeId);
  const currentDoc = await getDoc(docRef);
  
  if (!currentDoc.exists()) {
    throw new Error("Technician type not found");
  }
  
  const updateData = { updatedAt: serverTimestamp() };
  
  // If updating name, check for duplicates
  if (updates.name !== undefined) {
    const trimmedName = updates.name.trim();
    if (!trimmedName) {
      throw new Error("Name cannot be empty");
    }
    
    const exists = await ffCheckTechnicianTypeExists(trimmedName, technicianTypeId);
    if (exists) {
      throw new Error("A technician type with this name already exists");
    }
    
    updateData.name = trimmedName;
    // Note: ID stays stable - we don't change it even if name changes
  }
  
  if (updates.active !== undefined) {
    updateData.active = updates.active === true;
  }
  
  if (updates.sortOrder !== undefined) {
    updateData.sortOrder = updates.sortOrder;
  }
  
  await updateDoc(docRef, updateData);
  return { id: technicianTypeId, ...updateData };
}

// ─── Connect ──────────────────────────────────────────────────────────────────

function tryConnect() {
  getSalonId().then((sid) => {
    if (sid && sid !== _salonId) {
      _salonId = sid;
      subscribeUi(sid);
      subscribeMain(sid);
      console.log("[SettingsCloud] Subscribed to salon", sid);
    } else if (!sid) {
      _salonId = null;
      if (_unsubUi) { _unsubUi(); _unsubUi = null; }
      if (_unsubMain) { _unsubMain(); _unsubMain = null; }
    }
  });
}

onAuthStateChanged(auth, () => { tryConnect(); });
tryConnect();

if (typeof window !== "undefined") {
  window.ffSaveHistoryRange = ffSaveHistoryRange;
  window.ffSaveAppSettings = ffSaveAppSettings;
  window.ffSaveTaskSettings = ffSaveTaskSettings;
  window.ffGetTechnicianTypes = ffGetTechnicianTypes;
  window.ffCreateTechnicianType = ffCreateTechnicianType;
  window.ffUpdateTechnicianType = ffUpdateTechnicianType;
  window.ffCheckTechnicianTypeExists = ffCheckTechnicianTypeExists;
}
