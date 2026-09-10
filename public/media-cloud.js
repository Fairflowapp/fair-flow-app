/**
 * Media Cloud – Firestore logic for Media module (content works, media items, posted history).
 * Handles upload to Storage, mediaItem creation, before/after support.
 *
 * Firestore paths:
 *   salons/{salonId}/contentWorks/{workId}
 *   salons/{salonId}/contentWorks/{workId}/mediaItems/{mediaId}
 *   salons/{salonId}/contentWorks/{workId}/postedHistory/{historyId}
 *
 * Storage: salons/{salonId}/media/{workId}/{mediaId}-{fileName}
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  increment,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { db, auth, storage } from "/app.js?v=20260610_force_lp_ios";
import { makeThumbnailBlob } from "./media-thumbs.js?v=20260910_media_seen";

const FUNCTIONS_REGION = "us-central1";
const INCLUDED_STORAGE_BYTES = 5 * 1024 * 1024 * 1024;
const STORAGE_BLOCK_BYTES = 10 * 1024 * 1024 * 1024;

// =====================
// Paths
// =====================

/** @param {string} salonId @param {string} workId */
export function contentWorksRef(salonId, workId = null) {
  const base = collection(db, `salons/${salonId}/contentWorks`);
  return workId ? doc(base, workId) : base;
}

/** @param {string} salonId @param {string} workId @param {string} mediaId */
export function mediaItemsRef(salonId, workId, mediaId = null) {
  const base = collection(db, `salons/${salonId}/contentWorks/${workId}/mediaItems`);
  return mediaId ? doc(base, mediaId) : base;
}

/** @param {string} salonId @param {string} workId @param {string} historyId */
export function postedHistoryRef(salonId, workId, historyId = null) {
  const base = collection(db, `salons/${salonId}/contentWorks/${workId}/postedHistory`);
  return historyId ? doc(base, historyId) : base;
}

/** @param {string} salonId @param {string} categoryId */
export function mediaCategoriesRef(salonId, categoryId = null) {
  const base = collection(db, `salons/${salonId}/mediaCategories`);
  return categoryId ? doc(base, categoryId) : base;
}

function genMediaId() {
  return crypto.randomUUID?.()?.slice(0, 8) || Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function safeFileName(name) {
  return (name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Storage path for media uploads: salons/{salonId}/media/{workId}/{mediaId}-{fileName} */
export function mediaStoragePath(salonId, workId, mediaId, fileName) {
  return `salons/${salonId}/media/${workId}/${mediaId}-${safeFileName(fileName)}`;
}

// =====================
// Salon ID
// =====================

async function getSalonId() {
  // Multi-salon: when the user has chosen a salon (single membership auto-
  // selected, or one explicitly picked from Choose Salon), that selection is
  // the source of truth. Reading users/{uid}.salonId first would leak data
  // from the legacy primary salon into whichever salon the user picked.
  if (typeof window !== "undefined" && window.currentSalonId) {
    return String(window.currentSalonId).trim() || null;
  }
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const { getDoc } = await import("https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js");
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      const data = snap.data();
      return data.salonId || null;
    }
  } catch (e) {
    console.warn("[MediaCloud] getSalonId failed", e);
  }
  return null;
}

// =====================
// Sanitize (remove undefined for Firestore)
// =====================

function sanitize(obj) {
  if (obj == null) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function storageBlockQuantityForBytes(bytes) {
  const n = Number(bytes || 0) - INCLUDED_STORAGE_BYTES;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n / STORAGE_BLOCK_BYTES);
}

function formatStorageGb(bytes) {
  const gb = Number(bytes || 0) / (1024 * 1024 * 1024);
  if (!Number.isFinite(gb) || gb <= 0) return "0GB";
  return `${gb >= 10 ? Math.ceil(gb) : Math.ceil(gb * 10) / 10}GB`;
}

function formatStorageSize(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return "0MB";
  if (n < 1024 * 1024 * 1024) return `${Math.ceil(n / (1024 * 1024))}MB`;
  return formatStorageGb(n);
}

async function getStorageBillingState(salonId) {
  const [usageSnap, billingSnap] = await Promise.all([
    getDoc(doc(db, `salons/${salonId}/usage/storage`)).catch((e) => {
      console.warn("[MediaCloud] storage usage read failed; assuming 0 bytes", e?.code, e?.message);
      return null;
    }),
    getDoc(doc(db, `salons/${salonId}/billing/stripe`)),
  ]);
  const usageData = usageSnap?.exists?.() ? usageSnap.data() || {} : {};
  const billingData = billingSnap.exists() ? billingSnap.data() || {} : {};
  const paidBlockQuantity = Number(billingData.items?.storage?.quantity || 0);
  const bytesUsed = Math.max(0, Number(usageData.bytesUsed || 0));
  return {
    bytesUsed: Number.isFinite(bytesUsed) ? bytesUsed : 0,
    paidBlockQuantity: Number.isFinite(paidBlockQuantity) ? paidBlockQuantity : 0,
  };
}

function showPaidStorageConfirm({ currentBlocks, requiredBlocks, projectedBytes, includedBytes }) {
  return new Promise((resolve) => {
    document.getElementById("ffPaidStorageConfirm")?.remove();

    const additionalBlocks = Math.max(requiredBlocks - currentBlocks, 0);
    const overlay = document.createElement("div");
    overlay.id = "ffPaidStorageConfirm";
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483500;background:rgba(15,23,42,.42);display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;";
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-labelledby="ffPaidStorageConfirmTitle" style="width:min(480px,100%);background:#fff;border-radius:18px;padding:24px;box-shadow:0 24px 70px rgba(15,23,42,.28);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
        <div id="ffPaidStorageConfirmTitle" style="font-size:18px;font-weight:800;margin-bottom:10px;">Add paid storage?</div>
        <div style="font-size:14px;line-height:1.55;color:#4b5563;margin-bottom:22px;">
          Your base plan includes ${formatStorageSize(includedBytes)} of storage. Additional storage is billed in 10GB blocks. Each 10GB costs $10/month.
          This upload will bring your salon storage to about ${formatStorageGb(projectedBytes)}.
          If you continue, ${additionalBlocks} additional storage ${additionalBlocks === 1 ? "block" : "blocks"} will be added to your subscription automatically.
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;">
          <button type="button" data-ff-paid-storage-cancel style="padding:10px 16px;border-radius:999px;border:1px solid #e5e7eb;background:#fff;color:#374151;font-size:13px;font-weight:800;cursor:pointer;">Cancel</button>
          <button type="button" data-ff-paid-storage-confirm style="padding:10px 16px;border-radius:999px;border:0;background:#7c3aed;color:#fff;font-size:13px;font-weight:800;cursor:pointer;">Confirm &amp; Add Storage</button>
        </div>
      </div>
    `;

    const finish = (value) => {
      overlay.remove();
      resolve(value);
    };
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(false);
    });
    overlay.querySelector("[data-ff-paid-storage-cancel]")?.addEventListener("click", () => finish(false));
    overlay.querySelector("[data-ff-paid-storage-confirm]")?.addEventListener("click", () => finish(true));
    document.body.appendChild(overlay);
    setTimeout(() => {
      try { overlay.querySelector("[data-ff-paid-storage-confirm]")?.focus(); } catch (_) {}
    }, 0);
  });
}

async function syncPaidStorageQuantityOrThrow(salonId, desiredStorageBlockQuantity) {
  const fn = httpsCallable(
    getFunctions(undefined, FUNCTIONS_REGION),
    "syncStripeStorageQuantity"
  );
  await fn({ salonId, desiredStorageBlockQuantity });
}

async function checkStorageUploadAllowance(salonId, uploadBytes) {
  const fn = httpsCallable(
    getFunctions(undefined, FUNCTIONS_REGION),
    "checkStorageUploadAllowance"
  );
  try {
    const res = await fn({ salonId, uploadBytes });
    return res?.data || {};
  } catch (err) {
    const code = String(err?.code || "").toLowerCase();
    const message = String(err?.message || err || "").toLowerCase();
    if (code.includes("internal") || message.includes("functions/internal") || message.includes("internal")) {
      console.warn("[MediaCloud] storage allowance callable failed; allowing upload to continue", err);
      return { allowed: true, skippedReason: "allowance_internal_error" };
    }
    throw err;
  }
}

async function ensureStorageCapacityForUpload(salonId, file) {
  const uploadBytesCount = Number(file?.size || 0);
  if (!Number.isFinite(uploadBytesCount) || uploadBytesCount <= 0) return;
  const allowance = await checkStorageUploadAllowance(salonId, uploadBytesCount);
  if (allowance.allowed) return;
  if (!allowance.isOwner) {
    throw new Error("This upload needs more storage. Please ask the salon owner to approve the storage upgrade.");
  }

  const confirmed = await showPaidStorageConfirm({
    currentBlocks: Number(allowance.paidBlockQuantity || 0),
    requiredBlocks: Number(allowance.requiredStorageBlockQuantity || 0),
    projectedBytes: Number(allowance.projectedBytes || uploadBytesCount),
    includedBytes: Number(allowance.includedBytes || INCLUDED_STORAGE_BYTES),
  });
  if (!confirmed) {
    throw new Error("Storage upgrade was canceled.");
  }
  await syncPaidStorageQuantityOrThrow(
    salonId,
    Number(allowance.requiredStorageBlockQuantity || 0)
  );
}

async function ensureStorageCapacityForFiles(salonId, files) {
  const fileList = (Array.isArray(files) ? files : [files]).filter(Boolean);
  const totalBytes = fileList.reduce((sum, file) => {
    const n = Number(file?.size || 0);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
  if (totalBytes <= 0) return;
  await ensureStorageCapacityForUpload(salonId, { size: totalBytes });
}

async function recordStorageUsageDelta(salonId, deltaBytes) {
  const n = Number(deltaBytes || 0);
  if (!Number.isFinite(n) || n === 0) return;
  await setDoc(
    doc(db, `salons/${salonId}/usage/storage`),
    {
      bytesUsed: increment(n),
      updatedAt: serverTimestamp(),
      source: "media",
    },
    { merge: true }
  );
}

// =====================
// Active-location helpers (defined early so createContentWork can use them)
// =====================

/**
 * Resolve the active location id. Mirrors the accessor used by
 * settings-cloud/queue-cloud so we don't race on first paint when
 * `window.__ff_active_location_id` hasn't been populated yet.
 */
function _ffActiveLocationIdForMedia() {
  try {
    if (typeof window !== "undefined" && typeof window.ffGetActiveLocationId === "function") {
      const v = window.ffGetActiveLocationId();
      const s = typeof v === "string" ? v.trim() : (v ? String(v).trim() : "");
      if (s) return s;
    }
  } catch (_) {}
  try {
    const raw = typeof window !== "undefined" && typeof window.__ff_active_location_id === "string"
      ? window.__ff_active_location_id.trim()
      : "";
    return raw;
  } catch (_) {
    return "";
  }
}

function _ffMediaUserHasMultipleLocations() {
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

function _ffMediaPrimaryLocationId() {
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

function _ffMediaHasActiveLocationForWrite() {
  if (!_ffMediaUserHasMultipleLocations()) return true;
  return !!_ffActiveLocationIdForMedia();
}

/** Work / category belongs to the active branch only. Legacy unstamped: primary branch. */
export function mediaItemMatchesActiveLocation(item) {
  const multi = _ffMediaUserHasMultipleLocations();
  const active = _ffActiveLocationIdForMedia();
  const explicit = item && typeof item.locationId === "string" ? item.locationId.trim() : "";
  if (!active) return !multi;
  if (explicit) return explicit === active;
  if (!multi) return true;
  const primary = _ffMediaPrimaryLocationId();
  return !!primary && active === primary;
}

function _ffFilterContentWorksByLocation(items) {
  const arr = Array.isArray(items) ? items : [];
  const filtered = arr.filter(mediaItemMatchesActiveLocation);
  if (filtered.length === 0 && arr.length > 0) return arr;
  return filtered;
}

// =====================
// contentWorks CRUD
// =====================

/**
 * Create a new content work.
 * @param {object} data - { staffId, staffName, createdByRole, serviceType, caption?, featured?, duplicate?, status?, locationId? }
 */
export async function createContentWork(data) {
  const salonId = await getSalonId();
  if (!salonId) throw new Error("No salonId");
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not signed in");

  const categoryIds = Array.isArray(data.categoryIds) ? data.categoryIds : (data.categoryId ? [data.categoryId] : []);
  const categoryNames = Array.isArray(data.categoryNames) ? data.categoryNames : (data.categoryName ? [data.categoryName] : []);

  // Stamp the active branch so every work is scoped per-location. Callers may
  // override by passing `locationId` explicitly (e.g. cloud jobs). Legacy rows
  // without `locationId` are treated as belonging to the "default" branch on
  // read — see `_ffFilterContentWorksByLocation` below.
  const locId = (typeof data.locationId === "string" && data.locationId.trim())
    ? data.locationId.trim()
    : _ffActiveLocationIdForMedia();
  if (!locId && !_ffMediaHasActiveLocationForWrite()) {
    throw new Error("Choose a location before uploading media.");
  }

  const docData = sanitize({
    salonId,
    staffId: data.staffId,
    staffName: data.staffName,
    createdByUid: uid,
    createdByRole: data.createdByRole,
    serviceType: data.serviceType ?? (categoryNames[0] || ""),
    categoryId: categoryIds[0] ?? "",
    categoryName: categoryNames[0] ?? "",
    categoryIds: categoryIds.length ? categoryIds : undefined,
    categoryNames: categoryNames.length ? categoryNames : undefined,
    caption: data.caption ?? "",
    featured: data.featured ?? false,
    duplicate: data.duplicate ?? false,
    status: data.status ?? "active",
    postedCount: 0,
    ...(locId ? { locationId: locId } : {}),
    createdAt: serverTimestamp(),
    updatedAt: null,
  });

  const ref = await addDoc(contentWorksRef(salonId), docData);
  return ref.id;
}

/**
 * Update a content work.
 * @param {string} workId
 * @param {object} updates - Partial fields to update
 */
export async function updateContentWork(workId, updates) {
  const salonId = await getSalonId();
  if (!salonId) throw new Error("No salonId");

  const allowed = [
    "staffId", "staffName", "serviceType", "categoryId", "categoryName", "categoryIds", "categoryNames",
    "caption", "featured", "duplicate", "status", "postedCount",
    "previewMediaUrl", "previewStoragePath",
    "previewThumbUrl", "previewThumbStoragePath",
    "updatedAt"
  ];
  const safe = {};
  for (const k of allowed) {
    if (updates[k] !== undefined) safe[k] = updates[k];
  }
  safe.updatedAt = serverTimestamp();

  const ref = contentWorksRef(salonId, workId);
  await updateDoc(ref, sanitize(safe));
}

/**
 * Get a single content work.
 */
export async function getContentWork(workId, opts) {
  const salonId = await getSalonId();
  if (!salonId) return null;
  const snap = await getDoc(contentWorksRef(salonId, workId));
  if (!snap.exists()) return null;
  const work = { id: snap.id, ...snap.data() };
  if (!opts?.skipLocation && !mediaItemMatchesActiveLocation(work)) return null;
  return work;
}

function buildContentWorksQuery(coll, opts, useOrder) {
  if (opts?.status) {
    return useOrder
      ? query(coll, where("status", "==", opts.status), orderBy("createdAt", "desc"))
      : query(coll, where("status", "==", opts.status));
  }
  if (opts?.staffId) {
    return useOrder
      ? query(coll, where("staffId", "==", opts.staffId), orderBy("createdAt", "desc"))
      : query(coll, where("staffId", "==", opts.staffId));
  }
  if (opts?.featured === true) {
    return useOrder
      ? query(coll, where("featured", "==", true), orderBy("createdAt", "desc"))
      : query(coll, where("featured", "==", true));
  }
  return useOrder ? query(coll, orderBy("createdAt", "desc")) : query(coll);
}

function sortWorksByCreatedAtDesc(arr) {
  return (Array.isArray(arr) ? arr : []).slice().sort((a, b) => {
    const ta = a && a.createdAt && typeof a.createdAt.toMillis === "function" ? a.createdAt.toMillis() : 0;
    const tb = b && b.createdAt && typeof b.createdAt.toMillis === "function" ? b.createdAt.toMillis() : 0;
    return tb - ta;
  });
}

/** One-shot read so Media is not stuck if onSnapshot never fires. Returns null on failure (do not treat as empty). */
export async function fetchContentWorks(opts) {
  const salonId =
    (typeof window !== "undefined" && window.currentSalonId && String(window.currentSalonId).trim())
    || await getSalonId();
  if (!salonId) return null;
  const coll = contentWorksRef(salonId);
  try {
    const snap = await Promise.race([
      getDocs(coll),
      new Promise((_, reject) => setTimeout(() => reject(new Error("fetchContentWorks timeout")), 10000)),
    ]);
    let arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (opts && opts.staffId) {
      const sid = String(opts.staffId);
      arr = arr.filter((w) => String(w.staffId || "") === sid);
    }
    return sortWorksByCreatedAtDesc(arr);
  } catch (e) {
    console.warn("[MediaCloud] fetchContentWorks failed", e);
    return null;
  }
}

/**
 * Subscribe to content works (optionally filtered).
 * @param {object} opts - { status?, staffId?, featured? } (use one filter at a time for index compatibility)
 * @param {function} callback - (works) => void
 * @returns {function} Unsubscribe
 */
export function subscribeContentWorks(opts, callback) {
  let unsubSnapshot = null;
  let latestRaw = [];
  const emit = () => {
    if (callback) callback(_ffFilterContentWorksByLocation(latestRaw));
  };
  const locHandler = () => emit();

  const unsubAuth = auth.onAuthStateChanged(async (user) => {
    if (unsubSnapshot) {
      unsubSnapshot();
      unsubSnapshot = null;
    }
    latestRaw = [];
    if (!user) {
      if (callback) callback([]);
      return;
    }
    const salonId =
      (typeof window !== "undefined" && window.currentSalonId && String(window.currentSalonId).trim())
      || await getSalonId();
    if (!salonId) {
      return;
    }
    const coll = contentWorksRef(salonId);
    const q = buildContentWorksQuery(coll, opts, false);
    unsubSnapshot = onSnapshot(q, (snap) => {
      latestRaw = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      emit();
    }, (err) => {
      console.warn("[MediaCloud] subscribeContentWorks error", err);
      void fetchContentWorks(opts).then((works) => {
        if (Array.isArray(works) && callback) callback(works);
      });
    });
    void fetchContentWorks(opts).then((works) => {
      if (latestRaw.length) return;
      if (Array.isArray(works) && callback) callback(works);
    });
  });

  // Re-emit cached list (filtered for the new branch) when the Owner
  // switches locations, so the Media screen flips instantly without
  // waiting for a fresh Firestore snapshot.
  if (typeof document !== "undefined") {
    document.addEventListener("ff-active-location-changed", locHandler);
  }

  return () => {
    unsubAuth();
    if (unsubSnapshot) unsubSnapshot();
    if (typeof document !== "undefined") {
      document.removeEventListener("ff-active-location-changed", locHandler);
    }
  };
}

/**
 * Soft delete: set status to 'deleted'.
 */
export async function deleteContentWork(workId) {
  return updateContentWork(workId, { status: "deleted" });
}

/**
 * Archive: set status to 'archived'.
 */
export async function archiveContentWork(workId) {
  return updateContentWork(workId, { status: "archived" });
}

/**
 * Self Delete: Technician/Manager deletes their own work within 24h.
 * Deletes all media from Storage, deletes mediaItems, sets status = "deleted".
 * Caller must verify eligibility before invoking.
 */
export async function selfDeleteContentWork(workId) {
  const salonId = await getSalonId();
  if (!salonId) throw new Error("No salonId");
  await deleteAllMediaFromWork(workId);
  return updateContentWork(workId, { status: "deleted" });
}

// =====================
// mediaItems CRUD
// =====================

/**
 * Add a media item to a work (low-level, no upload).
 * @param {string} workId
 * @param {object} data - { mediaType, mediaUrl, storagePath, sortOrder?, mediaId? }
 * @returns {string} mediaId
 */
export async function addMediaItem(workId, data) {
  const salonId = await getSalonId();
  if (!salonId) throw new Error("No salonId");

  const mediaId = data.mediaId ?? genMediaId();
  const docData = sanitize({
    mediaType: data.mediaType,
    mediaUrl: data.mediaUrl,
    storagePath: data.storagePath,
    thumbUrl: data.thumbUrl ?? null,
    thumbStoragePath: data.thumbStoragePath ?? null,
    sizeBytes: Number(data.sizeBytes || 0),
    sortOrder: data.sortOrder ?? 0,
    createdAt: serverTimestamp(),
  });

  const ref = mediaItemsRef(salonId, workId, mediaId);
  await setDoc(ref, docData);
  return mediaId;
}

/**
 * Upload a file to Storage and create a mediaItem.
 * @param {string} workId
 * @param {File} file
 * @param {string} mediaType - photo | video | before_after_before | before_after_after
 * @param {number} sortOrder
 * @returns {Promise<{mediaId: string, mediaUrl: string, storagePath: string}>}
 */
async function uploadAndCreateMediaItem(workId, file, mediaType, sortOrder) {
  const salonId = await getSalonId();
  if (!salonId) throw new Error("No salonId");

  const coll = mediaItemsRef(salonId, workId);
  let isFirst = true;
  try {
    const emptyCheck = await getDocs(coll);
    isFirst = emptyCheck.empty;
  } catch (_) {
    isFirst = true;
  }

  const mediaId = genMediaId();
  const path = mediaStoragePath(salonId, workId, mediaId, file.name);
  const fileRef = storageRef(storage, path);
  await ensureStorageCapacityForUpload(salonId, file);
  await uploadBytes(fileRef, file);
  const mediaUrl = await getDownloadURL(fileRef);

  // Store a small companion thumbnail so viewers never pull the full-size original
  // (~5 MB, ~48 MB once decoded) just to paint a card. Best-effort: a failure here
  // must never fail the upload.
  let thumbUrl = null;
  let thumbPath = null;
  let thumbBytes = 0;
  try {
    const thumbBlob = await makeThumbnailBlob(file);
    if (thumbBlob && thumbBlob.size) {
      thumbPath = `${path}.thumb.jpg`;
      const thumbRef = storageRef(storage, thumbPath);
      await uploadBytes(thumbRef, thumbBlob, { contentType: "image/jpeg" });
      thumbUrl = await getDownloadURL(thumbRef);
      thumbBytes = Number(thumbBlob.size || 0);
    }
  } catch (e) {
    console.warn("[MediaCloud] thumbnail upload failed", e?.code, e?.message);
    thumbUrl = null;
    thumbPath = null;
    thumbBytes = 0;
  }

  await addMediaItem(workId, {
    mediaId,
    mediaType,
    mediaUrl,
    storagePath: path,
    thumbUrl,
    thumbStoragePath: thumbPath,
    sizeBytes: Number(file?.size || 0),
    sortOrder,
  });
  await recordStorageUsageDelta(salonId, Number(file?.size || 0) + thumbBytes).catch((e) => {
    console.warn("[MediaCloud] storage usage increment failed", e?.code, e?.message);
  });

  if (isFirst) {
    await updateContentWork(workId, {
      previewMediaUrl: mediaUrl,
      previewStoragePath: path,
      previewThumbUrl: thumbUrl,
      previewThumbStoragePath: thumbPath,
    }).catch((e) => console.warn("[MediaCloud] preview denorm failed", workId, e));
  }

  return { mediaId, mediaUrl, storagePath: path, thumbUrl, thumbStoragePath: thumbPath };
}

/**
 * Add media to an existing work.
 * 1. Upload file(s) to Storage
 * 2. Create mediaItem(s)
 * 3. Update updatedAt on Work
 *
 * @param {string} workId
 * @param {File|File[]} files - Single file or array. For before_after: [beforeFile, afterFile]
 * @param {string} mediaType - "photo" | "video" | "before_after"
 * @returns {Promise<string[]>} Array of created mediaIds
 */
export async function addMediaToExistingWork(workId, files, mediaType) {
  const salonId = await getSalonId();
  if (!salonId) throw new Error("No salonId");

  const existing = await getMediaItems(workId);
  let nextSortOrder = existing.length > 0
    ? Math.max(...existing.map((m) => m.sortOrder ?? 0)) + 1
    : 0;

  const fileList = Array.isArray(files) ? files : [files];
  await ensureStorageCapacityForFiles(salonId, fileList);
  const createdIds = [];

  if (mediaType === "before_after") {
    if (fileList.length !== 2) {
      throw new Error("before_after requires exactly 2 files: [beforeFile, afterFile]");
    }
    const [beforeFile, afterFile] = fileList;
    const r1 = await uploadAndCreateMediaItem(workId, beforeFile, "before_after_before", nextSortOrder);
    createdIds.push(r1.mediaId);
    nextSortOrder++;
    const r2 = await uploadAndCreateMediaItem(workId, afterFile, "before_after_after", nextSortOrder);
    createdIds.push(r2.mediaId);
  } else {
    for (const file of fileList) {
      const r = await uploadAndCreateMediaItem(workId, file, mediaType, nextSortOrder);
      createdIds.push(r.mediaId);
      nextSortOrder++;
    }
  }

  await updateContentWork(workId, { updatedAt: serverTimestamp() });
  return createdIds;
}

/**
 * Add multiple regular media files without failing the full batch when one file fails.
 * before_after stays on the strict path because it must remain an exact before/after pair.
 *
 * @param {string} workId
 * @param {File[]} files
 * @param {string} mediaType - "photo" | "video"
 * @param {(info: { done: number, total: number, file: File, ok: boolean }) => void} onProgress
 * @returns {Promise<{mediaIds: string[], successfulFiles: File[], failures: Array<{fileName: string, error: string}>}>}
 */
export async function addMediaToExistingWorkBestEffort(workId, files, mediaType, onProgress) {
  const salonId = await getSalonId();
  if (!salonId) throw new Error("No salonId");
  if (mediaType === "before_after") {
    const mediaIds = await addMediaToExistingWork(workId, files, mediaType);
    return { mediaIds, successfulFiles: (Array.isArray(files) ? files : [files]).filter(Boolean), failures: [] };
  }

  const fileList = (Array.isArray(files) ? files : [files]).filter(Boolean);
  await ensureStorageCapacityForFiles(salonId, fileList);

  const existing = await getMediaItems(workId);
  let nextSortOrder = existing.length > 0
    ? Math.max(...existing.map((m) => m.sortOrder ?? 0)) + 1
    : 0;
  const mediaIds = [];
  const successfulFiles = [];
  const failures = [];

  for (let idx = 0; idx < fileList.length; idx++) {
    const file = fileList[idx];
    try {
      const result = await uploadAndCreateMediaItem(workId, file, mediaType, nextSortOrder);
      mediaIds.push(result.mediaId);
      successfulFiles.push(file);
      nextSortOrder++;
      if (typeof onProgress === "function") onProgress({ done: idx + 1, total: fileList.length, file, ok: true });
    } catch (err) {
      failures.push({
        fileName: file?.name || `File ${idx + 1}`,
        error: err?.message || err?.code || String(err || "Upload failed"),
      });
      if (typeof onProgress === "function") onProgress({ done: idx + 1, total: fileList.length, file, ok: false });
    }
  }

  if (mediaIds.length > 0) {
    await updateContentWork(workId, { updatedAt: serverTimestamp() });
  }
  return { mediaIds, successfulFiles, failures };
}

/**
 * Create a new work with media in one call.
 * @param {object} workData - { staffId, staffName, createdByRole, serviceType, caption?, ... }
 * @param {File|File[]} files - Single file or [before, after] for before_after
 * @param {string} mediaType - "photo" | "video" | "before_after"
 * @returns {Promise<{workId: string, mediaIds: string[]}>}
 */
export async function createWorkWithMedia(workData, files, mediaType) {
  const salonId = await getSalonId();
  if (!salonId) throw new Error("No salonId");
  await ensureStorageCapacityForFiles(salonId, files);
  const workId = await createContentWork(workData);
  try {
    const mediaIds = await addMediaToExistingWork(workId, files, mediaType);
    return { workId, mediaIds };
  } catch (err) {
    await deleteContentWork(workId).catch((cleanupErr) => {
      console.warn("[MediaCloud] cleanup empty work after upload failure failed", workId, cleanupErr);
    });
    throw err;
  }
}

/**
 * Create a new work and upload regular files best-effort.
 * Cleans up the work only if every file fails.
 */
export async function createWorkWithMediaBestEffort(workData, files, mediaType, onProgress) {
  const salonId = await getSalonId();
  if (!salonId) throw new Error("No salonId");
  if (mediaType === "before_after") {
    const result = await createWorkWithMedia(workData, files, mediaType);
    return { workId: result.workId, mediaIds: result.mediaIds, successfulFiles: (Array.isArray(files) ? files : [files]).filter(Boolean), failures: [] };
  }

  await ensureStorageCapacityForFiles(salonId, files);
  const workId = await createContentWork(workData);
  try {
    const result = await addMediaToExistingWorkBestEffort(workId, files, mediaType, onProgress);
    if (!result.mediaIds.length) {
      await deleteContentWork(workId).catch((cleanupErr) => {
        console.warn("[MediaCloud] cleanup empty best-effort work failed", workId, cleanupErr);
      });
    }
    return { workId, ...result };
  } catch (err) {
    await deleteContentWork(workId).catch((cleanupErr) => {
      console.warn("[MediaCloud] cleanup empty best-effort work failed", workId, cleanupErr);
    });
    throw err;
  }
}

/**
 * Update a media item (e.g. sortOrder).
 */
export async function updateMediaItem(workId, mediaId, updates) {
  const salonId = await getSalonId();
  if (!salonId) throw new Error("No salonId");
  const ref = mediaItemsRef(salonId, workId, mediaId);
  await updateDoc(ref, sanitize(updates));
}

/** Best-effort removal of the companion thumbnail object. */
async function deleteThumbObject(thumbStoragePath) {
  const p = thumbStoragePath != null ? String(thumbStoragePath).trim() : "";
  if (!p) return;
  try {
    await deleteObject(storageRef(storage, p));
  } catch (e) {
    console.warn("[MediaCloud] thumbnail delete failed", e?.code);
  }
}

/**
 * Delete a media item (Firestore + Storage if storagePath exists).
 */
export async function deleteMediaItem(workId, mediaId) {
  const salonId = await getSalonId();
  if (!salonId) throw new Error("No salonId");
  const items = await getMediaItems(workId);
  const item = items.find((m) => m.id === mediaId);
  let storageDeleted = false;
  if (item?.storagePath) {
    try {
      const fileRef = storageRef(storage, item.storagePath);
      await deleteObject(fileRef);
      storageDeleted = true;
    } catch (e) {
      console.warn("[MediaCloud] Storage delete failed, continuing with Firestore", e);
    }
  }
  await deleteThumbObject(item?.thumbStoragePath);
  await deleteDoc(mediaItemsRef(salonId, workId, mediaId));
  if (storageDeleted && Number(item?.sizeBytes || 0) > 0) {
    await recordStorageUsageDelta(salonId, -Number(item.sizeBytes || 0)).catch((e) => {
      console.warn("[MediaCloud] storage usage decrement failed", e);
    });
  }
}

/**
 * Delete all media from a work (Storage + Firestore mediaItems). Keeps Work record.
 */
export async function deleteAllMediaFromWork(workId) {
  const salonId = await getSalonId();
  if (!salonId) throw new Error("No salonId");
  const items = await getMediaItems(workId);
  for (const item of items) {
    let storageDeleted = false;
    if (item.storagePath) {
      try {
        const fileRef = storageRef(storage, item.storagePath);
        await deleteObject(fileRef);
        storageDeleted = true;
      } catch (e) {
        console.warn("[MediaCloud] Storage delete failed for", item.id, e);
      }
    }
    await deleteThumbObject(item.thumbStoragePath);
    await deleteDoc(mediaItemsRef(salonId, workId, item.id));
    if (storageDeleted && Number(item?.sizeBytes || 0) > 0) {
      await recordStorageUsageDelta(salonId, -Number(item.sizeBytes || 0)).catch((e) => {
        console.warn("[MediaCloud] storage usage decrement failed for", item.id, e);
      });
    }
  }
  await updateContentWork(workId, {
    previewMediaUrl: null,
    previewStoragePath: null,
    previewThumbUrl: null,
    previewThumbStoragePath: null,
  });
}

/**
 * Get all media items for a work.
 */
export async function getMediaItems(workId, salonIdOverride = null) {
  const salonId =
    salonIdOverride != null && String(salonIdOverride).trim() !== ""
      ? String(salonIdOverride).trim()
      : await getSalonId();
  if (!salonId || !workId) return [];
  // Avoid orderBy(): missing sortOrder / index / transport flakiness can yield empty or failed reads.
  const coll = mediaItemsRef(salonId, workId);
  const snap = await getDocs(coll);
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return items;
}

/**
 * First preview URL for list cards: prefers https mediaUrl, else refreshes from storagePath.
 * @param {string} workId
 * @param {string|null} [salonIdOverride] - use work.salonId when present (multi-account / stale window)
 * @returns {Promise<string>}
 */
export async function resolveFirstWorkPreviewUrl(workId, salonIdOverride = null) {
  const items = await getMediaItems(workId, salonIdOverride);
  const first = items[0];
  if (!first) return "";
  const raw = first.mediaUrl != null ? String(first.mediaUrl).trim() : "";
  if (raw && /^https?:\/\//i.test(raw)) return raw;
  const path = first.storagePath != null ? String(first.storagePath).trim() : "";
  if (path) {
    try {
      const fileRef = storageRef(storage, path);
      const u = await getDownloadURL(fileRef);
      return u && String(u).trim() ? String(u).trim() : "";
    } catch (e) {
      console.warn("[MediaCloud] resolveFirstWorkPreviewUrl getDownloadURL", workId, e);
    }
  }
  return raw || "";
}

/**
 * Best URL for grid thumbnails: denormalized preview on work doc, then subcollection / Storage.
 */
export async function resolveWorkCardPreviewUrl(work) {
  if (!work?.id) return "";
  const pre = work.previewMediaUrl != null ? String(work.previewMediaUrl).trim() : "";
  if (pre && /^https?:\/\//i.test(pre)) return pre;
  const pth = work.previewStoragePath != null ? String(work.previewStoragePath).trim() : "";
  if (pth) {
    try {
      const fileRef = storageRef(storage, pth);
      const u = await getDownloadURL(fileRef);
      if (u && String(u).trim()) return String(u).trim();
    } catch (e) {
      console.warn("[MediaCloud] resolveWorkCardPreviewUrl storagePath", work.id, e);
    }
  }
  const sid = work.salonId != null && String(work.salonId).trim() !== "" ? String(work.salonId).trim() : null;
  return resolveFirstWorkPreviewUrl(work.id, sid);
}

/** Ensure each item has an https mediaUrl when storagePath is available (modal / video src). */
export async function resolveMediaItemsForDisplay(items) {
  if (!Array.isArray(items) || !items.length) return items || [];
  return Promise.all(
    items.map(async (m) => {
      const raw = m.mediaUrl != null ? String(m.mediaUrl).trim() : "";
      if (raw && /^https?:\/\//i.test(raw)) return m;
      const path = m.storagePath != null ? String(m.storagePath).trim() : "";
      if (!path) return m;
      try {
        const fileRef = storageRef(storage, path);
        const u = await getDownloadURL(fileRef);
        if (u && String(u).trim()) return { ...m, mediaUrl: String(u).trim() };
      } catch (e) {
        console.warn("[MediaCloud] resolveMediaItemsForDisplay", m.id, e);
      }
      return m;
    })
  );
}

/**
 * Subscribe to media items for a work.
 */
export function subscribeMediaItems(workId, callback) {
  let unsub = null;
  (async () => {
    const salonId = await getSalonId();
    if (!salonId || !workId) {
      if (callback) callback([]);
      return;
    }
    const coll = mediaItemsRef(salonId, workId);
    unsub = onSnapshot(coll, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      if (callback) callback(items);
    });
  })();
  return () => {
    if (unsub) unsub();
  };
}

// =====================
// postedHistory CRUD
// =====================

/**
 * Add a posted history entry.
 * @param {string} workId
 * @param {object} data - { platform, format, postedDate, markedByStaffId, markedByName, notes? }
 */
export async function addPostedHistory(workId, data) {
  const salonId = await getSalonId();
  if (!salonId) throw new Error("No salonId");

  const docData = sanitize({
    platform: data.platform,
    format: data.format,
    postedDate: data.postedDate,
    markedByStaffId: data.markedByStaffId,
    markedByName: data.markedByName,
    notes: data.notes ?? "",
    createdAt: serverTimestamp(),
  });

  const ref = await addDoc(postedHistoryRef(salonId, workId), docData);

  // Sync postedCount = actual postedHistory count
  const history = await getPostedHistory(workId);
  await updateContentWork(workId, { postedCount: history.length });

  return ref.id;
}

/**
 * Get posted history for a work.
 */
export async function getPostedHistory(workId, salonIdOverride = null) {
  const salonId =
    salonIdOverride != null && String(salonIdOverride).trim() !== ""
      ? String(salonIdOverride).trim()
      : await getSalonId();
  if (!salonId || !workId) return [];
  const snap = await getDocs(postedHistoryRef(salonId, workId));
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  items.sort((a, b) => {
    const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
    const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
    return tb - ta;
  });
  return items;
}

/**
 * Subscribe to posted history for a work.
 */
export function subscribePostedHistory(workId, callback) {
  let unsub = null;
  (async () => {
    const salonId = await getSalonId();
    if (!salonId || !workId) {
      if (callback) callback([]);
      return;
    }
    const coll = postedHistoryRef(salonId, workId);
    unsub = onSnapshot(coll, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      items.sort((a, b) => {
        const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
        return tb - ta;
      });
      if (callback) callback(items);
    });
  })();
  return () => {
    if (unsub) unsub();
  };
}

// =====================
// mediaCategories CRUD
// =====================

/**
 * Media Categories are PER-LOCATION. Each category doc stores a `locationId`
 * so branches never cross-contaminate (Kibiscan vs Brickell keep separate
 * lists). Docs without `locationId` are legacy salon-wide and are shown in
 * every location for backward compatibility until the Owner re-saves them.
 */
function _ffFilterCategoriesByLocation(items) {
  return (Array.isArray(items) ? items : []).filter(mediaItemMatchesActiveLocation);
}

/**
 * Get all media categories for the active location (active + inactive,
 * sorted by sortOrder). Falls back to the full salon list when no active
 * location is set (legacy / onboarding).
 */
export async function getMediaCategories() {
  const salonId = await getSalonId();
  if (!salonId) return [];
  const snap = await getDocs(query(mediaCategoriesRef(salonId), orderBy("sortOrder", "asc")));
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return _ffFilterCategoriesByLocation(all);
}

/**
 * Subscribe to media categories for the active location. The callback is
 * re-invoked whenever Firestore fires a snapshot AND whenever the active
 * location changes (we cache the latest raw list and re-filter locally).
 * @param {function} callback - (categories) => void
 * @returns {function} Unsubscribe
 */
export function subscribeMediaCategories(callback) {
  let unsub = null;
  let latestRaw = [];
  const emit = () => {
    if (callback) callback(_ffFilterCategoriesByLocation(latestRaw));
  };
  const locHandler = () => emit();
  (async () => {
    const salonId = await getSalonId();
    if (!salonId) {
      if (callback) callback([]);
      return;
    }
    const q = query(mediaCategoriesRef(salonId), orderBy("sortOrder", "asc"));
    unsub = onSnapshot(q, (snap) => {
      latestRaw = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      emit();
    });
    if (typeof document !== "undefined") {
      document.addEventListener("ff-active-location-changed", locHandler);
    }
  })();
  return () => {
    if (unsub) unsub();
    if (typeof document !== "undefined") {
      document.removeEventListener("ff-active-location-changed", locHandler);
    }
  };
}

/**
 * Create a media category for the active location (stores `locationId` so
 * the doc is invisible in other branches).
 * @param {object} data - { name, active?, sortOrder?, locationId? }
 */
export async function createMediaCategory(data) {
  const salonId = await getSalonId();
  if (!salonId) throw new Error("No salonId");
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not signed in");

  // Order is computed from the filtered (per-location) list so each
  // location has its own sort sequence starting at 1.
  const existing = await getMediaCategories();
  const maxOrder = existing.reduce((m, c) => Math.max(m, c.sortOrder ?? 0), 0);

  const locId = (typeof data.locationId === "string" && data.locationId.trim())
    ? data.locationId.trim()
    : _ffActiveLocationIdForMedia();
  if (!locId && !_ffMediaHasActiveLocationForWrite()) {
    throw new Error("Choose a location before adding a media category.");
  }

  const docData = sanitize({
    name: String(data.name || "").trim() || "Unnamed",
    active: data.active !== false,
    sortOrder: data.sortOrder ?? maxOrder + 1,
    ...(locId ? { locationId: locId } : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdByUid: uid,
  });

  const ref = await addDoc(mediaCategoriesRef(salonId), docData);
  return ref.id;
}

/**
 * Update a media category.
 * @param {string} categoryId
 * @param {object} updates - { name?, active?, sortOrder? }
 */
export async function updateMediaCategory(categoryId, updates) {
  const salonId = await getSalonId();
  if (!salonId) throw new Error("No salonId");

  const allowed = ["name", "active", "sortOrder", "updatedAt"];
  const safe = {};
  for (const k of allowed) {
    if (updates[k] !== undefined) safe[k] = updates[k];
  }
  safe.updatedAt = serverTimestamp();

  await updateDoc(mediaCategoriesRef(salonId, categoryId), sanitize(safe));
}

export async function deleteMediaCategory(categoryId) {
  const salonId = await getSalonId();
  if (!salonId) throw new Error("No salonId");
  await deleteDoc(mediaCategoriesRef(salonId, categoryId));
}
