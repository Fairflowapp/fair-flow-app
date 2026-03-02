/**
 * Settings Cloud – sync UI settings to Firestore.
 * Firestore: salons/{salonId}/settings/ui  →  { historyRange, updatedAt }
 *
 * Step 1 (minimal): historyRange only.
 * Falls back to localStorage if user not logged in or Firestore unavailable.
 */

import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { db, auth } from "./app.js";

const SETTINGS_UI_DOC = "ui";
let _salonId = null;
let _unsubscribe = null;

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

function settingsUiRef(salonId) {
  return doc(db, `salons/${salonId}/settings`, SETTINGS_UI_DOC);
}

function subscribe(salonId) {
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }
  const ref = settingsUiRef(salonId);
  _unsubscribe = onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.historyRange) {
      window.__ff_historyRange = data.historyRange;
      // Keep localStorage in sync as fallback
      try { localStorage.setItem('ff_history_range_v1', data.historyRange); } catch (_) {}
    }
  }, (err) => console.warn("[SettingsCloud] subscribe error", err));
}

function tryConnect() {
  getSalonId().then((sid) => {
    if (sid && sid !== _salonId) {
      _salonId = sid;
      subscribe(sid);
      console.log("[SettingsCloud] Subscribed to salon", sid);
    } else if (!sid) {
      _salonId = null;
      if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
    }
  });
}

/**
 * Save historyRange to Firestore (and window + localStorage as fallback).
 * Called from index.html when user changes the dropdown.
 */
function ffSaveHistoryRange(value) {
  window.__ff_historyRange = value;
  // Always keep localStorage as fallback
  try { localStorage.setItem('ff_history_range_v1', value); } catch (_) {}
  if (!_salonId) return;
  setDoc(settingsUiRef(_salonId), { historyRange: value, updatedAt: serverTimestamp() }, { merge: true })
    .catch((e) => console.warn("[SettingsCloud] save historyRange failed", e));
}

onAuthStateChanged(auth, () => { tryConnect(); });
tryConnect();

if (typeof window !== "undefined") {
  window.ffSaveHistoryRange = ffSaveHistoryRange;
}
