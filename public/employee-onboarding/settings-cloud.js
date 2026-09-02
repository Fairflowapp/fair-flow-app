/**
 * Employee Onboarding Settings Cloud (Stage A)
 *
 * Collections:
 *   salons/{salonId}/onboardingCategories/{id}
 *   salons/{salonId}/onboardingTaskTemplates/{id}
 *   salons/{salonId}/onboardingPackages/{id}
 */

import {
  collection,
  doc,
  getDocs,
  getDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  ffNormalizeOnboardingTaskConfig,
  ffValidateOnboardingTaskConfig,
  ffOnboardingV1TaskTypes,
  ffOnboardingEsignAllowsInternalSign,
} from "./task-registry.js?v=20260816_od_link";
import { ffNormalizeOnboardingAudience } from "./audience.js?v=20260808_onboarding_hardening";
import {
  ffOnboardingCall,
  ffOnboardingCallError,
} from "./onboarding-cf.js?v=20260815_od_fast";

let _salonId = null;
let _unsubCategories = null;
let _unsubTemplates = null;
let _unsubPackages = null;
let _subscribeRefCount = 0;
let _cacheReady = false;

let _cacheCategories = [];
let _cacheTemplates = [];
let _cachePackages = [];

function getDb() {
  try {
    return (typeof window !== "undefined" && (window.ffDb || window.db)) || null;
  } catch (_) {
    return null;
  }
}

function getAuthInst() {
  try {
    return (typeof window !== "undefined" && window.auth) || null;
  } catch (_) {
    return null;
  }
}

async function getSalonId() {
  try {
    if (typeof window !== "undefined" && window.currentSalonId) {
      const s = String(window.currentSalonId).trim();
      if (s) return s;
    }
  } catch (_) {}
  return null;
}

function nameToId(name) {
  if (!name || typeof name !== "string") return "";
  const s = name.trim().toLowerCase();
  if (!s) return "";
  const latin = s
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (latin) return latin;
  const unicode = s
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return unicode || "";
}

function categoriesRef(salonId) {
  return collection(getDb(), `salons/${salonId}/onboardingCategories`);
}
function categoryDoc(salonId, id) {
  return doc(getDb(), `salons/${salonId}/onboardingCategories`, id);
}
function templatesRef(salonId) {
  return collection(getDb(), `salons/${salonId}/onboardingTaskTemplates`);
}
function templateDoc(salonId, id) {
  return doc(getDb(), `salons/${salonId}/onboardingTaskTemplates`, id);
}
function packagesRef(salonId) {
  return collection(getDb(), `salons/${salonId}/onboardingPackages`);
}

function _sortByOrderThenName(arr) {
  return (arr || []).slice().sort((a, b) => {
    const oa = a.sortOrder !== undefined ? a.sortOrder : 999;
    const ob = b.sortOrder !== undefined ? b.sortOrder : 999;
    if (oa !== ob) return oa - ob;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

function _emit(name, detail) {
  try {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  } catch (_) {}
}

function _clearCaches() {
  _cacheCategories = [];
  _cacheTemplates = [];
  _cachePackages = [];
  _cacheReady = false;
}

function _ffOnboardingUserHasMultipleLocations() {
  try {
    if (typeof window !== "undefined" && typeof window.ffUserHasMultipleLocations === "function") {
      if (window.ffUserHasMultipleLocations()) return true;
    }
    if (typeof window !== "undefined" && typeof window.ffGetLocations === "function") {
      const locs = (window.ffGetLocations() || []).filter((l) => l && l.isActive !== false);
      if (locs.length > 1) return true;
    }
  } catch (_) {}
  return false;
}

function _ffOnboardingPrimaryLocationId() {
  try {
    const w = typeof window !== "undefined" ? window : {};
    if (typeof w.ffResolveCurrentStaff === "function" && typeof w.ffEnsureStaffLocationFields === "function") {
      const row = w.ffResolveCurrentStaff();
      if (row) {
        const f = w.ffEnsureStaffLocationFields(row);
        const primary = typeof f.primaryLocationId === "string" ? f.primaryLocationId.trim() : "";
        if (primary) return primary;
      }
    }
    if (typeof w.ffGetUserAllowedLocations === "function") {
      const locs = w.ffGetUserAllowedLocations();
      if (Array.isArray(locs) && locs[0] && locs[0].id) return String(locs[0].id).trim();
    }
  } catch (_) {}
  return "";
}

function _ffActiveLocationIdForOnboarding() {
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
    return raw || "";
  } catch (_) {
    return "";
  }
}

function _ffFilterOnboardingByLocation(items) {
  if (!Array.isArray(items)) return [];
  const multi = _ffOnboardingUserHasMultipleLocations();
  const active = _ffActiveLocationIdForOnboarding();
  if (!active) return multi ? [] : items.slice();
  const primary = _ffOnboardingPrimaryLocationId();
  return items.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const lid = row.locationId != null && row.locationId !== "" ? String(row.locationId).trim() : "";
    if (lid) return lid === active;
    if (!multi) return true;
    return !!primary && active === primary;
  });
}

function _stopSnapshots() {
  if (_unsubCategories) {
    _unsubCategories();
    _unsubCategories = null;
  }
  if (_unsubTemplates) {
    _unsubTemplates();
    _unsubTemplates = null;
  }
  if (_unsubPackages) {
    _unsubPackages();
    _unsubPackages = null;
  }
}

function _subscribeAll(salonId) {
  _stopSnapshots();

  _unsubCategories = onSnapshot(
    categoriesRef(salonId),
    (snap) => {
      _cacheCategories = _sortByOrderThenName(
        snap.docs.map((d) => ({ ...d.data(), id: d.id }))
      );
      _cacheReady = true;
      _emit("ff-onboarding-categories-updated", _ffFilterOnboardingByLocation(_cacheCategories));
    },
    (err) => console.warn("[OnboardingSettings] categories subscribe error", err)
  );

  _unsubTemplates = onSnapshot(
    templatesRef(salonId),
    (snap) => {
      _cacheTemplates = _sortByOrderThenName(
        snap.docs.map((d) => ({ ...d.data(), id: d.id }))
      );
      _cacheReady = true;
      _emit("ff-onboarding-templates-updated", _ffFilterOnboardingByLocation(_cacheTemplates));
    },
    (err) => console.warn("[OnboardingSettings] templates subscribe error", err)
  );

  _unsubPackages = onSnapshot(
    packagesRef(salonId),
    (snap) => {
      _cachePackages = _sortByOrderThenName(
        snap.docs.map((d) => ({ ...d.data(), id: d.id }))
      );
      _cacheReady = true;
      _emit("ff-onboarding-packages-updated", _ffFilterOnboardingByLocation(_cachePackages));
    },
    (err) => console.warn("[OnboardingSettings] packages subscribe error", err)
  );
}

/** Lazy: start/retain Settings catalog listeners (ref-counted). */
export async function ffEnsureOnboardingSettingsSubscribed() {
  if (!getDb()) return false;
  const sid = await getSalonId();
  if (!sid) return false;
  if (sid !== _salonId) {
    _salonId = sid;
    _clearCaches();
    _stopSnapshots();
    _subscribeRefCount = 0;
  }
  _subscribeRefCount += 1;
  if (!_unsubCategories) {
    _subscribeAll(sid);
    console.log("[OnboardingSettings] Lazy subscribe", sid);
  }
  return true;
}

/** Lazy: release one Settings subscriber; stop snapshots at 0. */
export function ffReleaseOnboardingSettingsSubscribed() {
  _subscribeRefCount = Math.max(0, _subscribeRefCount - 1);
  if (_subscribeRefCount === 0) {
    _stopSnapshots();
    console.log("[OnboardingSettings] Lazy unsubscribe");
  }
}

function tryConnect() {
  getSalonId().then((sid) => {
    if (sid && sid !== _salonId) {
      _salonId = sid;
      _clearCaches();
      _stopSnapshots();
      // Do NOT auto-subscribe for every signed-in user (Hardening).
      if (_subscribeRefCount > 0) {
        _subscribeAll(sid);
        console.log("[OnboardingSettings] Re-subscribed after salon change", sid);
      }
    } else if (!sid) {
      _salonId = null;
      _stopSnapshots();
      _clearCaches();
      _subscribeRefCount = 0;
    } else if (sid) {
      _salonId = sid;
    }
  });
}

function bindAuth() {
  const a = getAuthInst();
  if (a) {
    try {
      onAuthStateChanged(a, () => tryConnect());
    } catch (_) {}
    tryConnect();
    return;
  }
  let n = 0;
  const t = setInterval(() => {
    n += 1;
    const inst = getAuthInst();
    if (inst || n > 40) {
      clearInterval(t);
      if (inst) {
        try {
          onAuthStateChanged(inst, () => tryConnect());
        } catch (_) {}
      }
      tryConnect();
    }
  }, 250);
}
bindAuth();

try {
  if (typeof window !== "undefined") {
    window.addEventListener("ff-salon-changed", () => tryConnect());
  }
} catch (_) {}

// ─── Categories ──────────────────────────────────────────────────────────────

export async function ffGetOnboardingCategories() {
  if (!_salonId) {
    _salonId = await getSalonId();
  }
  if (!_salonId) return [];
  if (_unsubCategories) return _ffFilterOnboardingByLocation(_cacheCategories);
  try {
    const snap = await getDocs(categoriesRef(_salonId));
    _cacheCategories = _sortByOrderThenName(
      snap.docs.map((d) => ({ ...d.data(), id: d.id }))
    );
    return _ffFilterOnboardingByLocation(_cacheCategories);
  } catch (e) {
    console.warn("[OnboardingSettings] get categories failed", e);
    return [];
  }
}

export async function ffCreateOnboardingCategory(payload) {
  if (!_salonId) throw new Error("No salon selected");
  const name = String((payload && payload.name) || "").trim();
  if (!name) throw new Error("Name is required");
  try {
    const out = await ffOnboardingCall("createOnboardingCategory", {
      salonId: _salonId,
      name,
      active: payload && payload.active === false ? false : true,
      sortOrder: payload && payload.sortOrder,
      locationId: _ffActiveLocationIdForOnboarding() || null,
    });
    return { ...(out && out.category), id: out && out.id };
  } catch (e) {
    throw new Error(ffOnboardingCallError(e, "Could not create category"));
  }
}

export async function ffUpdateOnboardingCategory(categoryId, updates) {
  if (!_salonId || !categoryId) throw new Error("Category ID is required");
  try {
    await ffOnboardingCall("updateOnboardingCategory", {
      salonId: _salonId,
      categoryId,
      updates: updates || {},
    });
    return { id: categoryId, ...(updates || {}) };
  } catch (e) {
    throw new Error(ffOnboardingCallError(e, "Could not update category"));
  }
}

export async function ffDeleteOnboardingCategory(categoryId) {
  if (!_salonId || !categoryId) throw new Error("Category ID is required");
  try {
    await ffOnboardingCall("deleteOnboardingCategory", {
      salonId: _salonId,
      categoryId,
    });
  } catch (e) {
    throw new Error(ffOnboardingCallError(e, "Could not delete category"));
  }
}

// ─── Task Templates ──────────────────────────────────────────────────────────

export async function ffGetOnboardingTaskTemplates() {
  if (!_salonId) {
    _salonId = await getSalonId();
  }
  if (!_salonId) return [];
  if (_unsubTemplates && _cacheTemplates.length) return _ffFilterOnboardingByLocation(_cacheTemplates);
  try {
    const snap = await getDocs(templatesRef(_salonId));
    _cacheTemplates = _sortByOrderThenName(
      snap.docs.map((d) => ({ ...d.data(), id: d.id }))
    );
    return _ffFilterOnboardingByLocation(_cacheTemplates);
  } catch (e) {
    console.warn("[OnboardingSettings] get templates failed", e);
    return [];
  }
}

function _normalizeTemplatePayload(payload, { isCreate }) {
  const name = String((payload && payload.name) || "").trim();
  if (!name) throw new Error("Name is required");

  const taskType = String((payload && payload.taskType) || "").trim();
  const allowed = ffOnboardingV1TaskTypes();
  if (allowed.indexOf(taskType) === -1) {
    throw new Error(
      `taskType must be one of: ${allowed.join(", ")}`
    );
  }

  const config = ffNormalizeOnboardingTaskConfig(
    taskType,
    (payload && payload.config) || {}
  );
  const validation = ffValidateOnboardingTaskConfig(taskType, config);
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }

  const out = {
    name,
    taskType,
    categoryId:
      payload && payload.categoryId != null && String(payload.categoryId).trim()
        ? String(payload.categoryId).trim()
        : null,
    description: String((payload && payload.description) || "").trim(),
    active: payload && payload.active === false ? false : true,
    defaultRequired: payload && payload.defaultRequired === false ? false : true,
    config,
    sortOrder:
      payload && Number.isFinite(Number(payload.sortOrder))
        ? Number(payload.sortOrder)
        : undefined,
  };

  if (isCreate && out.sortOrder === undefined) {
    // filled by caller with max+1
  }
  return out;
}

export async function ffCreateOnboardingTaskTemplate(payload) {
  if (!_salonId) throw new Error("No salon selected");
  const normalized = _normalizeTemplatePayload(payload, { isCreate: true });
  try {
    const locationId = _ffActiveLocationIdForOnboarding();
    if (_ffOnboardingUserHasMultipleLocations() && !locationId) {
      throw new Error("Choose a location before adding an onboarding item.");
    }
    const out = await ffOnboardingCall("createOnboardingTaskTemplate", {
      salonId: _salonId,
      payload: { ...normalized, locationId: locationId || null },
    });
    const created = { ...(out && out.template), id: out && out.id };
    const without = _cacheTemplates.filter((t) => String(t.id) !== created.id);
    _cacheTemplates = _sortByOrderThenName([...without, created]);
    _emit("ff-onboarding-templates-updated", _ffFilterOnboardingByLocation(_cacheTemplates));
    return created;
  } catch (e) {
    throw new Error(ffOnboardingCallError(e, "Could not create item"));
  }
}

export async function ffUpdateOnboardingTaskTemplate(templateId, updates) {
  if (!_salonId || !templateId) throw new Error("Template ID is required");
  const currentSnap = await getDoc(templateDoc(_salonId, templateId));
  if (!currentSnap.exists()) throw new Error("Template not found");
  const current = currentSnap.data() || {};

  const merged = {
    name: updates && updates.name !== undefined ? updates.name : current.name,
    taskType:
      updates && updates.taskType !== undefined
        ? updates.taskType
        : current.taskType,
    categoryId:
      updates && updates.categoryId !== undefined
        ? updates.categoryId
        : current.categoryId,
    description:
      updates && updates.description !== undefined
        ? updates.description
        : current.description,
    active:
      updates && updates.active !== undefined ? updates.active : current.active,
    defaultRequired:
      updates && updates.defaultRequired !== undefined
        ? updates.defaultRequired
        : current.defaultRequired,
    config:
      updates && updates.config !== undefined ? updates.config : current.config,
    sortOrder:
      updates && updates.sortOrder !== undefined
        ? updates.sortOrder
        : current.sortOrder,
  };

  const normalized = _normalizeTemplatePayload(merged, { isCreate: false });
  try {
    await ffOnboardingCall("updateOnboardingTaskTemplate", {
      salonId: _salonId,
      templateId,
      updates: normalized,
    });
    return { id: templateId, ...normalized };
  } catch (e) {
    throw new Error(ffOnboardingCallError(e, "Could not update item"));
  }
}

export async function ffDeleteOnboardingTaskTemplate(templateId) {
  if (!_salonId || !templateId) throw new Error("Template ID is required");
  const id = String(templateId);
  try {
    await ffOnboardingCall("deleteOnboardingTaskTemplate", {
      salonId: _salonId,
      templateId: id,
    });
  } catch (e) {
    throw new Error(ffOnboardingCallError(e, "Could not delete item"));
  }
  // Optimistic cache: UI re-render can run before onSnapshot arrives.
  _cacheTemplates = _cacheTemplates.filter((t) => String(t.id) !== id);
  _emit("ff-onboarding-templates-updated", _ffFilterOnboardingByLocation(_cacheTemplates));
}

// ─── Packages ────────────────────────────────────────────────────────────────

function _normalizePackageItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((it, idx) => {
      if (!it || typeof it !== "object") return null;
      const templateId = String(it.templateId || "").trim();
      if (!templateId) return null;
      const row = {
        templateId,
        required: it.required === false ? false : true,
        sortOrder:
          Number.isFinite(Number(it.sortOrder)) ? Number(it.sortOrder) : idx,
      };
      if (it.configOverrides && typeof it.configOverrides === "object") {
        row.configOverrides = { ...it.configOverrides };
      }
      return row;
    })
    .filter(Boolean)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
}

/** Reject packages that include regulated e-sign templates (generic flow blocked). */
async function _assertPackageItemsEsignAllowed(items) {
  const list = _normalizePackageItems(items);
  if (!list.length) return;
  const templates = await ffGetOnboardingTaskTemplates();
  const byId = {};
  templates.forEach((t) => {
    byId[t.id] = t;
  });
  for (const it of list) {
    const tmpl = byId[it.templateId];
    if (!tmpl || tmpl.taskType !== "electronic_signature") continue;
    const cfg = ffNormalizeOnboardingTaskConfig("electronic_signature", {
      ...(tmpl.config || {}),
      ...(it.configOverrides || {}),
    });
    const validation = ffValidateOnboardingTaskConfig("electronic_signature", cfg);
    if (!validation.ok) {
      throw new Error(
        `Package item "${tmpl.name || it.templateId}": ${validation.errors.join("; ")}`
      );
    }
    if (!ffOnboardingEsignAllowsInternalSign(cfg)) {
      throw new Error(
        `Package item "${tmpl.name || it.templateId}" uses a regulated e-sign classification and cannot be included in generic onboarding.`
      );
    }
  }
}

export async function ffGetOnboardingPackages() {
  if (!_salonId) {
    _salonId = await getSalonId();
  }
  if (!_salonId) return [];
  if (_unsubPackages) return _ffFilterOnboardingByLocation(_cachePackages);
  try {
    const snap = await getDocs(packagesRef(_salonId));
    _cachePackages = _sortByOrderThenName(
      snap.docs.map((d) => ({ ...d.data(), id: d.id }))
    );
    return _ffFilterOnboardingByLocation(_cachePackages);
  } catch (e) {
    console.warn("[OnboardingSettings] get packages failed", e);
    return [];
  }
}

export async function ffCreateOnboardingPackage(payload) {
  if (!_salonId) throw new Error("No salon selected");
  const name = String((payload && payload.name) || "").trim();
  if (!name) throw new Error("Name is required");
  const items = _normalizePackageItems(payload && payload.items);
  await _assertPackageItemsEsignAllowed(items);
  try {
    const locationId = _ffActiveLocationIdForOnboarding();
    if (_ffOnboardingUserHasMultipleLocations() && !locationId) {
      throw new Error("Choose a location before adding an onboarding package.");
    }
    const out = await ffOnboardingCall("createOnboardingPackage", {
      salonId: _salonId,
      payload: {
        name,
        description: String((payload && payload.description) || "").trim(),
        active: payload && payload.active === false ? false : true,
        audience: ffNormalizeOnboardingAudience(payload && payload.audience),
        items,
        sortOrder: payload && payload.sortOrder,
        locationId: locationId || null,
      },
    });
    return { ...(out && out.package), id: out && out.id };
  } catch (e) {
    throw new Error(ffOnboardingCallError(e, "Could not create package"));
  }
}

export async function ffUpdateOnboardingPackage(packageId, updates) {
  if (!_salonId || !packageId) throw new Error("Package ID is required");

  const updateData = {};
  if (updates && updates.name !== undefined) {
    const name = String(updates.name || "").trim();
    if (!name) throw new Error("Name cannot be empty");
    updateData.name = name;
  }
  if (updates && updates.description !== undefined) {
    updateData.description = String(updates.description || "").trim();
  }
  if (updates && updates.active !== undefined) {
    updateData.active = updates.active === true;
  }
  if (updates && updates.audience !== undefined) {
    updateData.audience = ffNormalizeOnboardingAudience(updates.audience);
  }
  if (updates && updates.items !== undefined) {
    const items = _normalizePackageItems(updates.items);
    await _assertPackageItemsEsignAllowed(items);
    updateData.items = items;
  }
  if (updates && updates.sortOrder !== undefined) {
    updateData.sortOrder = Number(updates.sortOrder) || 0;
  }

  try {
    await ffOnboardingCall("updateOnboardingPackage", {
      salonId: _salonId,
      packageId,
      updates: updateData,
    });
    return { id: packageId, ...updateData };
  } catch (e) {
    throw new Error(ffOnboardingCallError(e, "Could not update package"));
  }
}

export async function ffDeleteOnboardingPackage(packageId) {
  if (!_salonId || !packageId) throw new Error("Package ID is required");
  const id = String(packageId);
  try {
    await ffOnboardingCall("deleteOnboardingPackage", {
      salonId: _salonId,
      packageId: id,
    });
  } catch (e) {
    throw new Error(ffOnboardingCallError(e, "Could not delete package"));
  }
  _cachePackages = _cachePackages.filter((p) => String(p.id) !== id);
  _emit("ff-onboarding-packages-updated", _ffFilterOnboardingByLocation(_cachePackages));
}

if (typeof document !== "undefined") {
  document.addEventListener("ff-active-location-changed", () => {
    try {
      _emit("ff-onboarding-categories-updated", _ffFilterOnboardingByLocation(_cacheCategories));
      _emit("ff-onboarding-templates-updated", _ffFilterOnboardingByLocation(_cacheTemplates));
      _emit("ff-onboarding-packages-updated", _ffFilterOnboardingByLocation(_cachePackages));
    } catch (_) {}
  });
}

if (typeof window !== "undefined") {
  window.ffEnsureOnboardingSettingsSubscribed = ffEnsureOnboardingSettingsSubscribed;
  window.ffReleaseOnboardingSettingsSubscribed = ffReleaseOnboardingSettingsSubscribed;
  window.ffGetOnboardingCategories = ffGetOnboardingCategories;
  window.ffCreateOnboardingCategory = ffCreateOnboardingCategory;
  window.ffUpdateOnboardingCategory = ffUpdateOnboardingCategory;
  window.ffDeleteOnboardingCategory = ffDeleteOnboardingCategory;

  window.ffGetOnboardingTaskTemplates = ffGetOnboardingTaskTemplates;
  window.ffCreateOnboardingTaskTemplate = ffCreateOnboardingTaskTemplate;
  window.ffUpdateOnboardingTaskTemplate = ffUpdateOnboardingTaskTemplate;
  window.ffDeleteOnboardingTaskTemplate = ffDeleteOnboardingTaskTemplate;

  window.ffGetOnboardingPackages = ffGetOnboardingPackages;
  window.ffCreateOnboardingPackage = ffCreateOnboardingPackage;
  window.ffUpdateOnboardingPackage = ffUpdateOnboardingPackage;
  window.ffDeleteOnboardingPackage = ffDeleteOnboardingPackage;
  window.ffFilterOnboardingByLocation = _ffFilterOnboardingByLocation;
}
