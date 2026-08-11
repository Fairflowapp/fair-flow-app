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
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import {
  ffNormalizeOnboardingTaskConfig,
  ffValidateOnboardingTaskConfig,
  ffOnboardingV1TaskTypes,
  ffOnboardingEsignAllowsInternalSign,
} from "./task-registry.js?v=20260809_esign_e2";
import { ffNormalizeOnboardingAudience } from "./audience.js?v=20260808_onboarding_hardening";

let _salonId = null;
let _unsubCategories = null;
let _unsubTemplates = null;
let _unsubPackages = null;
let _subscribeRefCount = 0;
let _cacheReady = false;

let _cacheCategories = [];
let _cacheTemplates = [];
let _cachePackages = [];

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
  return collection(db, `salons/${salonId}/onboardingCategories`);
}
function categoryDoc(salonId, id) {
  return doc(db, `salons/${salonId}/onboardingCategories`, id);
}
function templatesRef(salonId) {
  return collection(db, `salons/${salonId}/onboardingTaskTemplates`);
}
function templateDoc(salonId, id) {
  return doc(db, `salons/${salonId}/onboardingTaskTemplates`, id);
}
function packagesRef(salonId) {
  return collection(db, `salons/${salonId}/onboardingPackages`);
}
function packageDoc(salonId, id) {
  return doc(db, `salons/${salonId}/onboardingPackages`, id);
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
      _emit("ff-onboarding-categories-updated", _cacheCategories);
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
      _emit("ff-onboarding-templates-updated", _cacheTemplates);
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
      _emit("ff-onboarding-packages-updated", _cachePackages);
    },
    (err) => console.warn("[OnboardingSettings] packages subscribe error", err)
  );
}

/** Lazy: start/retain Settings catalog listeners (ref-counted). */
export async function ffEnsureOnboardingSettingsSubscribed() {
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

onAuthStateChanged(auth, () => {
  tryConnect();
});
tryConnect();

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
  if (_unsubCategories) return _cacheCategories.slice();
  try {
    const snap = await getDocs(categoriesRef(_salonId));
    _cacheCategories = _sortByOrderThenName(
      snap.docs.map((d) => ({ ...d.data(), id: d.id }))
    );
    return _cacheCategories.slice();
  } catch (e) {
    console.warn("[OnboardingSettings] get categories failed", e);
    return [];
  }
}

export async function ffCreateOnboardingCategory(payload) {
  if (!_salonId) throw new Error("No salon selected");
  const name = String((payload && payload.name) || "").trim();
  if (!name) throw new Error("Name is required");
  const baseId = nameToId(name) || `cat_${Date.now()}`;
  let id = baseId;
  let n = 1;
  while ((await getDoc(categoryDoc(_salonId, id))).exists()) {
    n += 1;
    id = `${baseId}_${n}`;
  }
  const existing = await ffGetOnboardingCategories();
  const maxSort =
    existing.length > 0
      ? Math.max(...existing.map((c) => c.sortOrder || 0))
      : -1;
  const row = {
    id,
    name,
    active: payload && payload.active === false ? false : true,
    sortOrder:
      payload && Number.isFinite(Number(payload.sortOrder))
        ? Number(payload.sortOrder)
        : maxSort + 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(categoryDoc(_salonId, id), row);
  return { ...row, id };
}

export async function ffUpdateOnboardingCategory(categoryId, updates) {
  if (!_salonId || !categoryId) throw new Error("Category ID is required");
  const updateData = { updatedAt: serverTimestamp() };
  if (updates && updates.name !== undefined) {
    const name = String(updates.name || "").trim();
    if (!name) throw new Error("Name cannot be empty");
    updateData.name = name;
  }
  if (updates && updates.active !== undefined) {
    updateData.active = updates.active === true;
  }
  if (updates && updates.sortOrder !== undefined) {
    updateData.sortOrder = Number(updates.sortOrder) || 0;
  }
  await updateDoc(categoryDoc(_salonId, categoryId), updateData);
  return { id: categoryId, ...updateData };
}

export async function ffDeleteOnboardingCategory(categoryId) {
  if (!_salonId || !categoryId) throw new Error("Category ID is required");
  const templates = await ffGetOnboardingTaskTemplates();
  const inUse = templates.some((t) => t.categoryId === categoryId);
  if (inUse) {
    throw new Error(
      "Cannot delete: one or more task templates still use this category. Reassign or deactivate them first."
    );
  }
  await deleteDoc(categoryDoc(_salonId, categoryId));
}

// ─── Task Templates ──────────────────────────────────────────────────────────

export async function ffGetOnboardingTaskTemplates() {
  if (!_salonId) {
    _salonId = await getSalonId();
  }
  if (!_salonId) return [];
  if (_unsubTemplates) return _cacheTemplates.slice();
  try {
    const snap = await getDocs(templatesRef(_salonId));
    _cacheTemplates = _sortByOrderThenName(
      snap.docs.map((d) => ({ ...d.data(), id: d.id }))
    );
    return _cacheTemplates.slice();
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
  const baseId = nameToId(normalized.name) || `tmpl_${Date.now()}`;
  let id = baseId;
  let n = 1;
  while ((await getDoc(templateDoc(_salonId, id))).exists()) {
    n += 1;
    id = `${baseId}_${n}`;
  }
  const existing = await ffGetOnboardingTaskTemplates();
  const maxSort =
    existing.length > 0
      ? Math.max(...existing.map((t) => t.sortOrder || 0))
      : -1;
  const row = {
    id,
    ...normalized,
    sortOrder:
      normalized.sortOrder !== undefined ? normalized.sortOrder : maxSort + 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(templateDoc(_salonId, id), row);
  const created = { ...row, id };
  const without = _cacheTemplates.filter((t) => String(t.id) !== id);
  _cacheTemplates = _sortByOrderThenName([...without, created]);
  _emit("ff-onboarding-templates-updated", _cacheTemplates.slice());
  return created;
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
  const updateData = {
    ...normalized,
    updatedAt: serverTimestamp(),
  };
  await updateDoc(templateDoc(_salonId, templateId), updateData);
  return { id: templateId, ...updateData };
}

export async function ffDeleteOnboardingTaskTemplate(templateId) {
  if (!_salonId || !templateId) throw new Error("Template ID is required");
  const packages = await ffGetOnboardingPackages();
  const inUse = packages.some(
    (p) =>
      Array.isArray(p.items) &&
      p.items.some((it) => it && it.templateId === templateId)
  );
  if (inUse) {
    throw new Error(
      "Cannot delete: this template is used in one or more packages. Remove it from packages first."
    );
  }
  const id = String(templateId);
  await deleteDoc(templateDoc(_salonId, id));
  // Optimistic cache: UI re-render can run before onSnapshot arrives.
  _cacheTemplates = _cacheTemplates.filter((t) => String(t.id) !== id);
  _emit("ff-onboarding-templates-updated", _cacheTemplates.slice());
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
  if (_unsubPackages) return _cachePackages.slice();
  try {
    const snap = await getDocs(packagesRef(_salonId));
    _cachePackages = _sortByOrderThenName(
      snap.docs.map((d) => ({ ...d.data(), id: d.id }))
    );
    return _cachePackages.slice();
  } catch (e) {
    console.warn("[OnboardingSettings] get packages failed", e);
    return [];
  }
}

export async function ffCreateOnboardingPackage(payload) {
  if (!_salonId) throw new Error("No salon selected");
  const name = String((payload && payload.name) || "").trim();
  if (!name) throw new Error("Name is required");

  const baseId = nameToId(name) || `pkg_${Date.now()}`;
  let id = baseId;
  let n = 1;
  while ((await getDoc(packageDoc(_salonId, id))).exists()) {
    n += 1;
    id = `${baseId}_${n}`;
  }

  const existing = await ffGetOnboardingPackages();
  const maxSort =
    existing.length > 0
      ? Math.max(...existing.map((p) => p.sortOrder || 0))
      : -1;

  const items = _normalizePackageItems(payload && payload.items);
  await _assertPackageItemsEsignAllowed(items);

  const row = {
    id,
    name,
    description: String((payload && payload.description) || "").trim(),
    active: payload && payload.active === false ? false : true,
    audience: ffNormalizeOnboardingAudience(payload && payload.audience),
    items,
    sortOrder:
      payload && Number.isFinite(Number(payload.sortOrder))
        ? Number(payload.sortOrder)
        : maxSort + 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(packageDoc(_salonId, id), row);
  return { ...row, id };
}

export async function ffUpdateOnboardingPackage(packageId, updates) {
  if (!_salonId || !packageId) throw new Error("Package ID is required");
  const currentSnap = await getDoc(packageDoc(_salonId, packageId));
  if (!currentSnap.exists()) throw new Error("Package not found");
  const current = currentSnap.data() || {};

  const updateData = { updatedAt: serverTimestamp() };
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

  // Keep unused vars lint-free; current reserved for future merge validation
  void current;

  await updateDoc(packageDoc(_salonId, packageId), updateData);
  return { id: packageId, ...updateData };
}

export async function ffDeleteOnboardingPackage(packageId) {
  if (!_salonId || !packageId) throw new Error("Package ID is required");
  const id = String(packageId);
  await deleteDoc(packageDoc(_salonId, id));
  _cachePackages = _cachePackages.filter((p) => String(p.id) !== id);
  _emit("ff-onboarding-packages-updated", _cachePackages.slice());
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
}
