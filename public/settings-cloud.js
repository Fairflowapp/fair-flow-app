/**
 * Settings Cloud – sync UI settings + app settings to Firestore.
 *
 * Firestore docs:
 *   salons/{salonId}/settings/ui   → { historyRange, updatedAt }
 *   salons/{salonId}/settings/main → { ownerUid (Firebase Auth uid of salon owner; immutable after set),
 *                                      adminPin (existing), brandName, brandPalette, managers,
 *                                      staffCallTemplates,
 *                                      taskSettings: { taskReminders, taskNotes, showIncompleteTasksBadge },
 *                                      updatedAt }
 */

import { doc, getDoc, setDoc, onSnapshot, serverTimestamp, collection, getDocs, addDoc, updateDoc, deleteDoc, deleteField } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth } from "./app.js?v=20260412_salon_owner_uid";
import {
  cloneDefaultBusinessHours,
  cloneDefaultDayShiftSegments,
  cloneDefaultCoverageRules,
  cloneDefaultSpecialBusinessDays,
  cloneDefaultRolesHierarchy,
  cloneDefaultScheduleRules,
  normalizeBusinessHours,
  normalizeDayShiftSegments,
  normalizeCoverageRules,
  normalizeSpecialBusinessDays,
  normalizeRolesHierarchy,
  normalizeScheduleRules,
} from "./schedule-helpers.js?v=20260409_coverage_plain_cards";

let _salonId = null;
let _unsubUi = null;
let _unsubMain = null;
let _unsubTechnicianTypes = null;
// Cached last snapshot of settings/main. Used so we can re-apply schedule
// fields (which are now per-location) when the active location changes
// WITHOUT doing another round-trip to Firestore.
let _lastMainSnapshot = null;

function _ffActiveLocationIdForSettings() {
  try {
    if (typeof window !== "undefined" && typeof window.ffGetActiveLocationId === "function") {
      const v = window.ffGetActiveLocationId();
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  } catch (_) {}
  try {
    const raw = typeof window !== "undefined" && typeof window.__ff_active_location_id === "string"
      ? window.__ff_active_location_id.trim()
      : "";
    return raw || null;
  } catch (_) { return null; }
}

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

function normalizeWeekStartsOn(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "sunday" ? "sunday" : "monday";
}

// Pick the per-location schedule bucket from a settings/main snapshot if it
// exists, otherwise return null so callers fall back to the legacy salon-wide
// top-level fields. Locations that haven't been saved yet simply inherit the
// legacy salon-wide values as their starting defaults.
function _pickLocationScheduleBucket(data, locationId) {
  if (!data || typeof data !== "object") return null;
  if (!locationId) return null;
  const buckets = data.locationSchedules;
  if (!buckets || typeof buckets !== "object") return null;
  const bucket = buckets[locationId];
  return bucket && typeof bucket === "object" ? bucket : null;
}

function subscribeMain(salonId) {
  if (_unsubMain) { _unsubMain(); _unsubMain = null; }
  _unsubMain = onSnapshot(settingsMainRef(salonId), (snap) => {
    const data = snap.exists() ? snap.data() : {};
    _lastMainSnapshot = data;
    _applyMainSnapshot(data);
  }, (err) => console.warn("[SettingsCloud] main subscribe error", err));
}

// Extracted body of the subscribeMain handler so we can re-apply when the
// active location changes (schedule fields now depend on which location
// is active).
function _applyMainSnapshot(data) {
  if (!data || typeof data !== "object") data = {};
  if (typeof window !== "undefined") {
    const ou = data.ownerUid != null ? String(data.ownerUid).trim() : "";
    window.__ff_salon_owner_uid = ou;
  }
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
    // Owner-only Preferences tab — weekStartsOn, salonTimeZone, currency,
    // timeFormat, defaultScreen, staffCallTemplates and staffCallTimeoutSeconds
    // are all PER-LOCATION (stored under `locationPreferences.{locationId}.*`).
    // The legacy salon-wide fields are kept as the fallback until each
    // location saves its own, so existing data still shows.
    const _prefsActiveLoc = _ffActiveLocationIdForSettings();
    const _prefsLocBucket = _prefsActiveLoc
      && data.locationPreferences
      && typeof data.locationPreferences === 'object'
      ? data.locationPreferences[_prefsActiveLoc]
      : null;
    const _locPrefs = _prefsLocBucket && typeof _prefsLocBucket === 'object' ? _prefsLocBucket : {};

    // Staff Call Messages — prefer per-location bucket, fallback to legacy
    // salon-wide top-level fields so existing data keeps working.
    {
      const locTpls = _locPrefs && _locPrefs.staffCallTemplates;
      if (locTpls && typeof locTpls === 'object') {
        window.settings.staffCallTemplates = normalizeStaffCallTemplates(locTpls);
        changed = true;
      } else if (data.staffCallTemplates && typeof data.staffCallTemplates === 'object') {
        window.settings.staffCallTemplates = normalizeStaffCallTemplates(data.staffCallTemplates);
        changed = true;
      }
      const locTimeout = _locPrefs ? _locPrefs.staffCallTimeoutSeconds : undefined;
      if (locTimeout !== undefined) {
        window.settings.staffCallTimeoutSeconds = normalizeStaffCallTimeoutSeconds(locTimeout);
        changed = true;
      } else if (data.staffCallTimeoutSeconds !== undefined) {
        window.settings.staffCallTimeoutSeconds = normalizeStaffCallTimeoutSeconds(data.staffCallTimeoutSeconds);
        changed = true;
      }
    }

    const _pickWeekStartsOn = Object.prototype.hasOwnProperty.call(_locPrefs, 'weekStartsOn')
      ? _locPrefs.weekStartsOn
      : (data.preferences ? data.preferences.weekStartsOn : undefined);

    const nextPreferences = {
      ...(window.settings.preferences && typeof window.settings.preferences === 'object' ? window.settings.preferences : {}),
      weekStartsOn: normalizeWeekStartsOn(_pickWeekStartsOn)
    };

    // salonTimeZone — prefer per-location, fallback to legacy top-level.
    {
      const hasLoc = Object.prototype.hasOwnProperty.call(_locPrefs, 'salonTimeZone');
      const hasLegacy = data.preferences && Object.prototype.hasOwnProperty.call(data.preferences, 'salonTimeZone');
      const raw = hasLoc ? _locPrefs.salonTimeZone : (hasLegacy ? data.preferences.salonTimeZone : undefined);
      if (raw != null && String(raw).trim() !== '') {
        nextPreferences.salonTimeZone = String(raw).trim();
      } else {
        delete nextPreferences.salonTimeZone;
      }
    }

    // currency — prefer per-location, fallback to legacy top-level.
    {
      const hasLoc = Object.prototype.hasOwnProperty.call(_locPrefs, 'currency');
      const hasLegacy = data.preferences && Object.prototype.hasOwnProperty.call(data.preferences, 'currency');
      const raw = hasLoc ? _locPrefs.currency : (hasLegacy ? data.preferences.currency : undefined);
      const cur = normalizeSalonCurrency(raw);
      if (cur) {
        nextPreferences.currency = cur;
      } else {
        delete nextPreferences.currency;
      }
    }

    // timeFormat — '12h' or '24h', per-location first, fallback to legacy.
    {
      const hasLoc = Object.prototype.hasOwnProperty.call(_locPrefs, 'timeFormat');
      const hasLegacy = data.preferences && Object.prototype.hasOwnProperty.call(data.preferences, 'timeFormat');
      const raw = hasLoc ? _locPrefs.timeFormat : (hasLegacy ? data.preferences.timeFormat : undefined);
      const tf = (raw === '24h' || raw === '24hour' || raw === 24) ? '24h'
               : (raw === '12h' || raw === '12hour' || raw === 12) ? '12h'
               : undefined;
      if (tf) {
        nextPreferences.timeFormat = tf;
      } else {
        delete nextPreferences.timeFormat;
      }
    }

    // defaultScreen — which screen the user lands on, per-location first.
    {
      const hasLoc = Object.prototype.hasOwnProperty.call(_locPrefs, 'defaultScreen');
      const hasLegacy = data.preferences && Object.prototype.hasOwnProperty.call(data.preferences, 'defaultScreen');
      const raw = hasLoc ? _locPrefs.defaultScreen : (hasLegacy ? data.preferences.defaultScreen : undefined);
      const s = typeof raw === 'string' ? raw.trim() : '';
      if (s) {
        nextPreferences.defaultScreen = s;
      } else {
        delete nextPreferences.defaultScreen;
      }
    }
    // Notifications → Birthday reminders "Days in advance" is PER-LOCATION.
    // Stored under `locationNotifications.{locationId}.birthdayReminderDaysBefore`.
    // Falls back to the legacy salon-wide `preferences.birthdayReminderDaysBefore`
    // so existing data keeps working until the Owner saves per-location.
    {
      const locId = _ffActiveLocationIdForSettings();
      const locBucket = locId
        && data.locationNotifications
        && typeof data.locationNotifications === 'object'
        ? data.locationNotifications[locId]
        : null;
      const locVal = locBucket && typeof locBucket === 'object'
        ? locBucket.birthdayReminderDaysBefore
        : undefined;
      const legacyVal = data.preferences && typeof data.preferences.birthdayReminderDaysBefore === 'number'
        ? data.preferences.birthdayReminderDaysBefore
        : undefined;
      const pick = (typeof locVal === 'number' && Number.isFinite(locVal))
        ? locVal
        : (typeof legacyVal === 'number' && Number.isFinite(legacyVal) ? legacyVal : undefined);
      if (pick !== undefined) {
        nextPreferences.birthdayReminderDaysBefore = Math.max(0, Math.min(90, Math.round(pick)));
      } else {
        delete nextPreferences.birthdayReminderDaysBefore;
      }
    }
    if (JSON.stringify(window.settings.preferences || {}) !== JSON.stringify(nextPreferences)) {
      window.settings.preferences = nextPreferences;
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
    if (Array.isArray(data.mediaCategories)) {
      const normalized = data.mediaCategories
        .map((c, i) => ({
          id: String(c?.id || "").trim() || `mc_${i}_${Date.now()}`,
          name: String(c?.name || "").trim(),
          active: c?.active !== false,
          sortOrder: typeof c?.sortOrder === "number" ? c.sortOrder : i,
        }))
        .filter((c) => c.name);
      if (JSON.stringify(window.settings.mediaCategories || []) !== JSON.stringify(normalized)) {
        window.settings.mediaCategories = normalized;
        changed = true;
      }
    }
    // Schedule fields (Owner-only Settings → Schedule tab) are PER-LOCATION.
    // Each branch has its own opening hours / shifts. We pick the bucket for
    // the active location first; if that branch hasn't been saved yet we
    // fall back to the legacy salon-wide top-level fields as defaults so
    // existing data keeps rendering. When the user then Saves at that
    // branch, ffSaveScheduleSettings writes to locationSchedules.{id}.
    const _activeLoc = _ffActiveLocationIdForSettings();
    const _locBucket = _pickLocationScheduleBucket(data, _activeLoc) || {};
    const _pickField = (key) => {
      if (Object.prototype.hasOwnProperty.call(_locBucket, key) &&
          _locBucket[key] && typeof _locBucket[key] === 'object') {
        return _locBucket[key];
      }
      return data[key];
    };
    const srcRolesHierarchy = _pickField('rolesHierarchy');
    const srcScheduleRules = _pickField('scheduleRules');
    const srcBusinessHours = _pickField('businessHours');
    const srcCoverageRules = _pickField('coverageRules');
    const srcSpecialBusinessDays = _pickField('specialBusinessDays');
    const srcDayShiftSegments = _pickField('dayShiftSegments');

    const nextRolesHierarchy = srcRolesHierarchy && typeof srcRolesHierarchy === 'object'
      ? normalizeRolesHierarchy(srcRolesHierarchy)
      : cloneDefaultRolesHierarchy();
    const nextScheduleRules = srcScheduleRules && typeof srcScheduleRules === 'object'
      ? normalizeScheduleRules(srcScheduleRules)
      : cloneDefaultScheduleRules();
    const nextBusinessHours = srcBusinessHours && typeof srcBusinessHours === 'object'
      ? normalizeBusinessHours(srcBusinessHours)
      : cloneDefaultBusinessHours();
    const nextCoverageRules = srcCoverageRules && typeof srcCoverageRules === 'object'
      ? normalizeCoverageRules(srcCoverageRules)
      : cloneDefaultCoverageRules();
    const nextSpecialBusinessDays = srcSpecialBusinessDays && typeof srcSpecialBusinessDays === 'object'
      ? normalizeSpecialBusinessDays(srcSpecialBusinessDays)
      : cloneDefaultSpecialBusinessDays();
    const nextDayShiftSegments = srcDayShiftSegments && typeof srcDayShiftSegments === 'object'
      ? normalizeDayShiftSegments(srcDayShiftSegments)
      : cloneDefaultDayShiftSegments();
    if (JSON.stringify(window.settings.rolesHierarchy || {}) !== JSON.stringify(nextRolesHierarchy)) {
      window.settings.rolesHierarchy = nextRolesHierarchy;
      changed = true;
    }
    if (JSON.stringify(window.settings.scheduleRules || {}) !== JSON.stringify(nextScheduleRules)) {
      window.settings.scheduleRules = nextScheduleRules;
      changed = true;
    }
    if (JSON.stringify(window.settings.businessHours || {}) !== JSON.stringify(nextBusinessHours)) {
      window.settings.businessHours = nextBusinessHours;
      changed = true;
    }
    if (JSON.stringify(window.settings.coverageRules || {}) !== JSON.stringify(nextCoverageRules)) {
      window.settings.coverageRules = nextCoverageRules;
      changed = true;
    }
    if (JSON.stringify(window.settings.specialBusinessDays || {}) !== JSON.stringify(nextSpecialBusinessDays)) {
      window.settings.specialBusinessDays = nextSpecialBusinessDays;
      changed = true;
    }
    if (JSON.stringify(window.settings.dayShiftSegments || {}) !== JSON.stringify(nextDayShiftSegments)) {
      window.settings.dayShiftSegments = nextDayShiftSegments;
      changed = true;
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
        stored.preferences = {
          ...(stored.preferences && typeof stored.preferences === 'object' ? stored.preferences : {}),
          weekStartsOn: nextPreferences.weekStartsOn
        };
        if (nextPreferences.salonTimeZone) {
          stored.preferences.salonTimeZone = nextPreferences.salonTimeZone;
        } else {
          delete stored.preferences.salonTimeZone;
        }
        if (data.taskSettings?.taskReminders !== undefined) stored.taskReminders = data.taskSettings.taskReminders;
        if (data.taskSettings?.taskNotes !== undefined) stored.taskNotes = data.taskSettings.taskNotes;
        if (data.taskSettings?.showIncompleteTasksBadge !== undefined) stored.showIncompleteTasksBadge = data.taskSettings.showIncompleteTasksBadge;
        stored.rolesHierarchy = nextRolesHierarchy;
        stored.scheduleRules = nextScheduleRules;
        stored.businessHours = nextBusinessHours;
        stored.coverageRules = nextCoverageRules;
        stored.specialBusinessDays = nextSpecialBusinessDays;
        stored.dayShiftSegments = nextDayShiftSegments;
        localStorage.setItem('ffv24_settings', JSON.stringify(stored));
      } catch (_) {}
      // Re-render brand if available
      if (typeof window.renderBrand === 'function') window.renderBrand();
      // Let the schedule UI (and anyone else watching salon/main settings)
      // know that the active location's schedule fields just changed, so
      // they can re-render from the fresh window.settings.* values.
      try {
        if (typeof document !== "undefined" && typeof CustomEvent === "function") {
          document.dispatchEvent(new CustomEvent('ff-schedule-settings-changed'));
        }
      } catch (_) {}
    }
}

// Re-apply the last known settings/main snapshot whenever the active
// location changes — schedule fields are per-location, so switching
// branches must re-populate window.settings.* without a Firestore read.
if (typeof document !== "undefined") {
  document.addEventListener('ff-active-location-changed', () => {
    try {
      if (_lastMainSnapshot) _applyMainSnapshot(_lastMainSnapshot);
    } catch (e) {
      console.warn("[SettingsCloud] re-apply on location change failed", e);
    }
  });
}

/**
 * Save the Birthday Reminder "Days in advance" for the current active
 * location. Writes `locationNotifications.{locationId}.birthdayReminderDaysBefore`.
 * If there's no active location (legacy / onboarding) falls back to the
 * salon-wide `preferences.birthdayReminderDaysBefore` path.
 */
function ffSaveBirthdayReminderDays(daysBefore) {
  if (!_salonId) return Promise.resolve(false);
  let n = Math.round(Number(daysBefore));
  if (!Number.isFinite(n)) n = 7;
  n = Math.max(0, Math.min(90, n));
  const locationId = _ffActiveLocationIdForSettings();
  const payload = { updatedAt: serverTimestamp() };
  if (locationId) {
    payload[`locationNotifications.${locationId}.birthdayReminderDaysBefore`] = n;
  } else {
    payload["preferences.birthdayReminderDaysBefore"] = n;
  }
  return updateDoc(settingsMainRef(_salonId), payload)
    .catch((e) => {
      if (e && e.code === 'not-found') {
        return setDoc(settingsMainRef(_salonId), payload, { merge: true });
      }
      console.warn("[SettingsCloud] save birthday reminder days failed", e);
      return Promise.reject(e);
    })
    .then(() => true);
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
  // Staff Call Messages are PER-LOCATION: when an active location is set we
  // route the write to `locationPreferences.{locationId}.*`. Without one we
  // keep the legacy salon-wide path so no data is lost during onboarding.
  const _locId = _ffActiveLocationIdForSettings();
  const _scBase = _locId ? `locationPreferences.${_locId}` : null;
  if (staffCallTemplates && typeof staffCallTemplates === 'object') {
    const tpls = normalizeStaffCallTemplates(staffCallTemplates);
    if (_scBase) payload[`${_scBase}.staffCallTemplates`] = tpls;
    else payload.staffCallTemplates = tpls;
  }
  if (staffCallTimeoutSeconds !== undefined) {
    const n = normalizeStaffCallTimeoutSeconds(staffCallTimeoutSeconds);
    if (_scBase) payload[`${_scBase}.staffCallTimeoutSeconds`] = n;
    else payload.staffCallTimeoutSeconds = n;
  }
  setDoc(settingsMainRef(_salonId), payload, { merge: true })
    .catch((e) => console.warn("[SettingsCloud] save app settings failed", e));
}

function normalizeSalonTimeZone(value) {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return "";
  if (s === "Etc/UTC" || s === "UTC") return "Etc/UTC";
  if (!/^[A-Za-z_]+\/[A-Za-z0-9_+\-]+$/.test(s)) return "";
  return s;
}

/** Curated list of salon currencies. Codes are ISO-4217. Sorted by region in the UI. */
const FF_SUPPORTED_CURRENCIES = [
  // Americas
  "USD", "CAD", "MXN", "BRL", "ARS", "CLP", "COP", "PEN", "UYU",
  // Europe
  "EUR", "GBP", "CHF", "NOK", "SEK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN", "RUB", "UAH",
  // Middle East & Africa
  "ILS", "AED", "SAR", "QAR", "KWD", "BHD", "OMR", "JOD", "LBP", "EGP", "TRY",
  "ZAR", "NGN", "KES", "GHS", "MAD", "TND", "DZD", "ETB",
  // Asia & Pacific
  "JPY", "CNY", "HKD", "TWD", "KRW", "SGD", "MYR", "THB", "VND", "IDR", "PHP",
  "INR", "PKR", "BDT", "LKR", "AUD", "NZD",
];

function normalizeSalonCurrency(value) {
  const s = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!s) return "";
  return FF_SUPPORTED_CURRENCIES.includes(s) ? s : "";
}

function ffSavePreferencesSettings(preferences) {
  if (!_salonId) return;
  const nextPreferences = preferences && typeof preferences === "object" ? preferences : {};
  const wk = normalizeWeekStartsOn(nextPreferences.weekStartsOn);

  // Owner-only Preferences are PER-LOCATION. When an active location is set
  // we write under `locationPreferences.{locationId}.*`. Without one (legacy
  // / onboarding before any location exists) we keep the old salon-wide
  // path so no data is lost.
  const locationId = _ffActiveLocationIdForSettings();
  const basePath = locationId ? `locationPreferences.${locationId}` : 'preferences';

  const payload = {
    updatedAt: serverTimestamp(),
    [`${basePath}.weekStartsOn`]: wk
  };
  if (Object.prototype.hasOwnProperty.call(nextPreferences, "salonTimeZone")) {
    const tz = normalizeSalonTimeZone(nextPreferences.salonTimeZone);
    if (tz) {
      payload[`${basePath}.salonTimeZone`] = tz;
    } else {
      payload[`${basePath}.salonTimeZone`] = deleteField();
    }
  }
  if (Object.prototype.hasOwnProperty.call(nextPreferences, "currency")) {
    const cur = normalizeSalonCurrency(nextPreferences.currency);
    if (cur) {
      payload[`${basePath}.currency`] = cur;
    } else {
      payload[`${basePath}.currency`] = deleteField();
    }
  }
  if (Object.prototype.hasOwnProperty.call(nextPreferences, "timeFormat")) {
    const raw = nextPreferences.timeFormat;
    const tf = (raw === '24h' || raw === '24hour' || raw === 24) ? '24h'
             : (raw === '12h' || raw === '12hour' || raw === 12) ? '12h'
             : '';
    if (tf) {
      payload[`${basePath}.timeFormat`] = tf;
    } else {
      payload[`${basePath}.timeFormat`] = deleteField();
    }
  }
  if (Object.prototype.hasOwnProperty.call(nextPreferences, "defaultScreen")) {
    const s = typeof nextPreferences.defaultScreen === 'string'
      ? nextPreferences.defaultScreen.trim()
      : '';
    if (s) {
      payload[`${basePath}.defaultScreen`] = s;
    } else {
      payload[`${basePath}.defaultScreen`] = deleteField();
    }
  }
  updateDoc(settingsMainRef(_salonId), payload).catch((e) => {
    // When the parent map doesn't exist yet updateDoc rejects; fall back to
    // a merge-setDoc which transparently creates the nested structure.
    if (e && e.code === 'not-found') {
      return setDoc(settingsMainRef(_salonId), payload, { merge: true });
    }
    console.warn("[SettingsCloud] save preferences settings failed", e);
  });
}

/** Resolve the current salon currency code (defaults to USD). Reads from window.settings.preferences.currency. */
function ffGetSalonCurrencyCode() {
  try {
    const raw =
      (typeof window !== "undefined" &&
        window.settings &&
        window.settings.preferences &&
        window.settings.preferences.currency) ||
      "";
    const norm = normalizeSalonCurrency(raw);
    return norm || "USD";
  } catch (e) {
    return "USD";
  }
}

/** Symbol for the current currency (best-effort; used for input prefix and compact UI labels). */
function ffGetCurrencySymbol(code) {
  const c = normalizeSalonCurrency(code) || ffGetSalonCurrencyCode();
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: c,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).formatToParts(0);
    const sym = parts.find((p) => p.type === "currency");
    if (sym && sym.value) return sym.value;
  } catch (e) {
    /* ignore */
  }
  const map = {
    USD: "$", CAD: "C$", MXN: "MX$", BRL: "R$", ARS: "AR$", CLP: "CLP$", COP: "COL$", PEN: "S/", UYU: "UY$",
    EUR: "€", GBP: "£", CHF: "CHF", NOK: "kr", SEK: "kr", DKK: "kr", PLN: "zł", CZK: "Kč", HUF: "Ft", RON: "lei", BGN: "лв", RUB: "₽", UAH: "₴",
    ILS: "₪", AED: "د.إ", SAR: "﷼", QAR: "QR", KWD: "KD", BHD: "BD", OMR: "OR", JOD: "JD", LBP: "ل.ل", EGP: "E£", TRY: "₺",
    ZAR: "R", NGN: "₦", KES: "KSh", GHS: "₵", MAD: "د.م", TND: "د.ت", DZD: "د.ج", ETB: "Br",
    JPY: "¥", CNY: "¥", HKD: "HK$", TWD: "NT$", KRW: "₩", SGD: "S$", MYR: "RM", THB: "฿", VND: "₫", IDR: "Rp", PHP: "₱",
    INR: "₹", PKR: "₨", BDT: "৳", LKR: "Rs", AUD: "A$", NZD: "NZ$",
  };
  return map[c] || c;
}

/** Format a number using the salon currency. */
function ffFormatCurrency(amount, opts) {
  const n = typeof amount === "number" ? amount : Number(amount);
  const v = Number.isFinite(n) ? n : 0;
  const code = (opts && typeof opts.currency === "string" && normalizeSalonCurrency(opts.currency)) || ffGetSalonCurrencyCode();
  const minF = opts && Number.isFinite(opts.minimumFractionDigits) ? opts.minimumFractionDigits : 2;
  const maxF = opts && Number.isFinite(opts.maximumFractionDigits) ? opts.maximumFractionDigits : 2;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      minimumFractionDigits: minF,
      maximumFractionDigits: maxF,
    }).format(v);
  } catch (e) {
    const sym = ffGetCurrencySymbol(code);
    return `${sym}${v.toLocaleString(undefined, { minimumFractionDigits: minF, maximumFractionDigits: maxF })}`;
  }
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

/** Media → category list for Upload Work dropdown (stored on settings/main). */
function ffSaveMediaCategories(mediaCategories) {
  if (!_salonId) return;
  const arr = Array.isArray(mediaCategories) ? mediaCategories : [];
  setDoc(settingsMainRef(_salonId), { mediaCategories: arr, updatedAt: serverTimestamp() }, { merge: true }).catch((e) =>
    console.warn("[SettingsCloud] save mediaCategories failed", e),
  );
}

function ffSaveScheduleSettings(rolesHierarchy, scheduleRules, businessHours, coverageRules, specialBusinessDays, previousSpecialBusinessDays, dayShiftSegments) {
  if (!_salonId) return Promise.resolve(false);

  // Schedule fields are PER-LOCATION. If there's an active location we write
  // everything under `locationSchedules.{locationId}.*`; if not (legacy /
  // initial onboarding with no location yet), we keep the old top-level
  // schema so existing data doesn't get orphaned.
  const locationId = _ffActiveLocationIdForSettings();
  const basePath = locationId ? `locationSchedules.${locationId}` : '';
  const joinPath = (key) => (basePath ? `${basePath}.${key}` : key);

  const payload = { updatedAt: serverTimestamp() };
  if (rolesHierarchy && typeof rolesHierarchy === "object") payload[joinPath('rolesHierarchy')] = normalizeRolesHierarchy(rolesHierarchy);
  if (scheduleRules && typeof scheduleRules === "object") payload[joinPath('scheduleRules')] = normalizeScheduleRules(scheduleRules);
  if (businessHours && typeof businessHours === "object") payload[joinPath('businessHours')] = normalizeBusinessHours(businessHours);
  if (coverageRules && typeof coverageRules === "object") payload[joinPath('coverageRules')] = normalizeCoverageRules(coverageRules);
  if (specialBusinessDays && typeof specialBusinessDays === "object") payload[joinPath('specialBusinessDays')] = normalizeSpecialBusinessDays(specialBusinessDays);
  if (dayShiftSegments && typeof dayShiftSegments === "object") payload[joinPath('dayShiftSegments')] = normalizeDayShiftSegments(dayShiftSegments);
  if (Object.keys(payload).length === 1) return Promise.resolve(false);
  const previous = previousSpecialBusinessDays && typeof previousSpecialBusinessDays === "object"
    ? normalizeSpecialBusinessDays(previousSpecialBusinessDays)
    : {};
  const next = specialBusinessDays && typeof specialBusinessDays === "object"
    ? normalizeSpecialBusinessDays(specialBusinessDays)
    : {};
  const removedDateKeys = Object.keys(previous).filter((dateKey) => !(dateKey in next));

  // Use updateDoc for dotted-path writes (required for nested location
  // buckets). If the doc doesn't exist yet, fall back to setDoc with merge
  // which transparently creates the nested structure.
  const writer = basePath
    ? updateDoc(settingsMainRef(_salonId), payload).catch((e) => {
        // If the doc doesn't exist yet updateDoc rejects; try setDoc merge.
        if (e && e.code === 'not-found') {
          return setDoc(settingsMainRef(_salonId), payload, { merge: true });
        }
        throw e;
      })
    : setDoc(settingsMainRef(_salonId), payload, { merge: true });

  return writer
    .then(() => {
      if (!removedDateKeys.length) return true;
      const deletePayload = {};
      const prefix = basePath ? `${basePath}.specialBusinessDays.` : 'specialBusinessDays.';
      removedDateKeys.forEach((dateKey) => {
        deletePayload[`${prefix}${dateKey}`] = deleteField();
      });
      return updateDoc(settingsMainRef(_salonId), deletePayload).then(() => true);
    })
    .catch((e) => {
      console.warn("[SettingsCloud] save schedule settings failed", e);
      return Promise.reject(e);
    });
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

// Per-location scoping for technician types.
//   - New types are written with the current active locationId so they only
//     appear in that branch.
//   - Reads filter by active location by default; pass { all: true } to get
//     the raw salon-wide set.
//   - Legacy types (written before this change, with no locationId) remain
//     visible in every location so existing catalogs don't disappear.
function _ffActiveLocationIdForTypes() {
  try {
    if (typeof window !== "undefined" && typeof window.ffGetActiveLocationId === "function") {
      const v = window.ffGetActiveLocationId();
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  } catch (_) {}
  try {
    const raw = typeof window !== "undefined" && typeof window.__ff_active_location_id === "string"
      ? window.__ff_active_location_id.trim()
      : "";
    return raw || null;
  } catch (_) { return null; }
}

function _ffFilterTypesByLocation(types, locationId) {
  if (!Array.isArray(types)) return [];
  if (!locationId) return types.slice();
  return types.filter((t) => {
    if (!t || typeof t !== "object") return false;
    // Legacy: no locationId field => visible in every location.
    if (t.locationId == null || t.locationId === "") return true;
    return String(t.locationId) === String(locationId);
  });
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
      
      // Trigger UI update event. `detail` stays the full (salon-wide) list
      // so existing consumers that expect an array still work; callers that
      // care about location scope should call ffGetTechnicianTypes() which
      // applies the active-location filter.
      document.dispatchEvent(new CustomEvent('ff-technician-types-updated', { detail: types }));
    },
    (err) => console.warn("[SettingsCloud] technician types subscribe error", err)
  );
}

/**
 * Get technician types.
 * By default: filtered to the active location (plus legacy no-location types).
 * Pass { all: true } to get the raw salon-wide list regardless of branch.
 */
async function ffGetTechnicianTypes(opts) {
  if (!_salonId) return [];
  const wantAll = !!(opts && opts.all === true);
  try {
    const snap = await getDocs(technicianTypesCollectionRef(_salonId));
    const all = snap.docs.map(d => {
      const data = d.data();
      return { ...data, id: d.id };
    }).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    if (wantAll) return all;
    return _ffFilterTypesByLocation(all, _ffActiveLocationIdForTypes());
  } catch (e) {
    console.warn("[SettingsCloud] get technician types failed", e);
    return [];
  }
}

/**
 * Check if technician type name/id already exists IN THE ACTIVE LOCATION.
 * A type with the same name can exist in a different branch without colliding.
 * Legacy (no-location) types still collide with every location so we don't
 * silently duplicate old salon-wide entries.
 */
async function ffCheckTechnicianTypeExists(name, excludeId = null) {
  if (!_salonId) return false;
  try {
    const snap = await getDocs(technicianTypesCollectionRef(_salonId));
    const id = nameToId(name);
    const activeLoc = _ffActiveLocationIdForTypes();
    return snap.docs.some(d => {
      if (excludeId && d.id === excludeId) return false;
      const data = d.data();
      const nameMatches =
        d.id === id ||
        (data.name && data.name.toLowerCase().trim() === name.toLowerCase().trim());
      if (!nameMatches) return false;
      // Scope collision check to the active location (or legacy salon-wide).
      if (data.locationId == null || data.locationId === "") return true;
      if (!activeLoc) return true;
      return String(data.locationId) === String(activeLoc);
    });
  } catch (e) {
    console.warn("[SettingsCloud] check technician type exists failed", e);
    return false;
  }
}

/**
 * Create new technician type (scoped to the active location).
 * The same name may be used in a different branch because locationId is
 * part of the document identity via a "${rawId}--${locationId}" suffix.
 */
async function ffCreateTechnicianType(name) {
  if (!_salonId || !name || !name.trim()) {
    throw new Error("Name is required");
  }
  
  const trimmedName = name.trim();
  const rawId = nameToId(trimmedName);
  
  if (!rawId) {
    throw new Error("Invalid name - must contain at least one letter or number");
  }

  const locationId = _ffActiveLocationIdForTypes();
  // If we have an active location, namespace the doc id so the same name
  // can coexist in multiple branches (types are per-location by product
  // spec). If no active location is set, fall back to the salon-wide id
  // so legacy flows keep working.
  const docId = locationId ? `${rawId}--${locationId}` : rawId;

  // Check for duplicates within this location (ffCheckTechnicianTypeExists
  // already scopes to activeLocationId).
  const exists = await ffCheckTechnicianTypeExists(trimmedName);
  if (exists) {
    throw new Error("A technician type with this name already exists");
  }
  
  // Get current max sortOrder WITHIN THIS LOCATION so each branch has its
  // own ordering sequence (legacy types count too so new entries sort after
  // them instead of overlapping).
  const existing = await ffGetTechnicianTypes();
  const maxSortOrder = existing.length > 0 
    ? Math.max(...existing.map(t => t.sortOrder || 0))
    : -1;
  
  const newType = {
    id: docId,
    name: trimmedName,
    active: true,
    sortOrder: maxSortOrder + 1,
    locationId: locationId || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  
  await setDoc(technicianTypeDocRef(_salonId, docId), newType);
  return { ...newType, id: docId };
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

/**
 * Delete a technician type
 */
async function ffDeleteTechnicianType(technicianTypeId) {
  if (!_salonId || !technicianTypeId) {
    throw new Error("Technician type ID is required");
  }
  const docRef = technicianTypeDocRef(_salonId, technicianTypeId);
  await deleteDoc(docRef);
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
  window.ffSavePreferencesSettings = ffSavePreferencesSettings;
  window.ffSaveTaskSettings = ffSaveTaskSettings;
  window.ffSaveScheduleSettings = ffSaveScheduleSettings;
  window.ffSaveBirthdayReminderDays = ffSaveBirthdayReminderDays;
  window.ffSaveMediaCategories = ffSaveMediaCategories;
  window.ffGetTechnicianTypes = ffGetTechnicianTypes;
  window.ffCreateTechnicianType = ffCreateTechnicianType;
  window.ffUpdateTechnicianType = ffUpdateTechnicianType;
  window.ffCheckTechnicianTypeExists = ffCheckTechnicianTypeExists;
  window.ffDeleteTechnicianType = ffDeleteTechnicianType;
  window.ffGetSalonCurrencyCode = ffGetSalonCurrencyCode;
  window.ffGetCurrencySymbol = ffGetCurrencySymbol;
  window.ffFormatCurrency = ffFormatCurrency;
  window.ffSupportedCurrencies = FF_SUPPORTED_CURRENCIES.slice();
}
