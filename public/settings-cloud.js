/**
 * Settings Cloud – sync UI settings + app settings to Firestore.
 *
 * Firestore docs:
 *   salons/{salonId}/settings/ui   → { historyRange, updatedAt }
 *   salons/{salonId}/settings/main → { adminPin (existing), brandName, brandPalette, managers, updatedAt }
 */

import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { db, auth } from "./app.js";

let _salonId = null;
let _unsubUi = null;
let _unsubMain = null;

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
    if (changed) {
      // Keep localStorage in sync as cache
      try {
        const stored = JSON.parse(localStorage.getItem('ffv24_settings') || '{}');
        if (data.brandName) { if (!stored.brand) stored.brand = {}; stored.brand.name = data.brandName; }
        if (data.brandPalette?.length) stored.brandPalette = data.brandPalette;
        if (data.managers) stored.managers = data.managers;
        localStorage.setItem('ffv24_settings', JSON.stringify(stored));
      } catch (_) {}
      // Re-render brand if available
      if (typeof window.renderBrand === 'function') window.renderBrand();
    }
  }, (err) => console.warn("[SettingsCloud] main subscribe error", err));
}

/**
 * Save app settings (brand name, palette, managers) to Firestore.
 * Called from index.html settings panel save.
 */
function ffSaveAppSettings(brandName, brandPalette, managers) {
  if (!_salonId) return;
  const payload = { updatedAt: serverTimestamp() };
  if (brandName !== undefined) payload.brandName = brandName || '';
  if (Array.isArray(brandPalette)) payload.brandPalette = brandPalette;
  if (Array.isArray(managers)) payload.managers = managers;
  setDoc(settingsMainRef(_salonId), payload, { merge: true })
    .catch((e) => console.warn("[SettingsCloud] save app settings failed", e));
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
}
