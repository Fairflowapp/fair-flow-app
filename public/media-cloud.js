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
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { db, auth, storage } from "./app.js?v=20260411_chat_reminder_attrfix";

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
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const { getDoc } = await import("https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js");
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      const data = snap.data();
      return data.salonId || (typeof window !== "undefined" ? window.currentSalonId : null) || null;
    }
  } catch (e) {
    console.warn("[MediaCloud] getSalonId failed", e);
  }
  return typeof window !== "undefined" ? window.currentSalonId : null;
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

/**
 * Filter content works to the active location. Legacy docs without a
 * `locationId` are treated as belonging to the Owner's "default" branch so
 * historical works don't vanish after the multi-location upgrade.
 */
function _ffFilterContentWorksByLocation(items) {
  const locId = _ffActiveLocationIdForMedia();
  if (!locId) return items; // no active location yet → show everything (onboarding)
  return items.filter((w) => {
    const raw = w && typeof w.locationId === "string" ? w.locationId.trim() : "";
    // Missing `locationId` = legacy work → only visible in the default branch.
    const effective = raw || "default";
    return effective === locId;
  });
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
    locationId: locId || null,
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
export async function getContentWork(workId) {
  const salonId = await getSalonId();
  if (!salonId) return null;
  const snap = await getDoc(contentWorksRef(salonId, workId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
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
    const salonId = await getSalonId();
    if (!salonId) {
      if (callback) callback([]);
      return;
    }
    const coll = contentWorksRef(salonId);
    let q;
    if (opts?.status) {
      q = query(coll, where("status", "==", opts.status), orderBy("createdAt", "desc"));
    } else if (opts?.staffId) {
      q = query(coll, where("staffId", "==", opts.staffId), orderBy("createdAt", "desc"));
    } else if (opts?.featured === true) {
      q = query(coll, where("featured", "==", true), orderBy("createdAt", "desc"));
    } else {
      q = query(coll, orderBy("createdAt", "desc"));
    }
    unsubSnapshot = onSnapshot(q, (snap) => {
      latestRaw = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      emit();
    }, (err) => console.warn("[MediaCloud] subscribeContentWorks error", err));
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

  const mediaId = genMediaId();
  const path = mediaStoragePath(salonId, workId, mediaId, file.name);
  const fileRef = storageRef(storage, path);
  await uploadBytes(fileRef, file);
  const mediaUrl = await getDownloadURL(fileRef);

  await addMediaItem(workId, {
    mediaId,
    mediaType,
    mediaUrl,
    storagePath: path,
    sortOrder,
  });
  return { mediaId, mediaUrl, storagePath: path };
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
 * Create a new work with media in one call.
 * @param {object} workData - { staffId, staffName, createdByRole, serviceType, caption?, ... }
 * @param {File|File[]} files - Single file or [before, after] for before_after
 * @param {string} mediaType - "photo" | "video" | "before_after"
 * @returns {Promise<{workId: string, mediaIds: string[]}>}
 */
export async function createWorkWithMedia(workData, files, mediaType) {
  const workId = await createContentWork(workData);
  const mediaIds = await addMediaToExistingWork(workId, files, mediaType);
  return { workId, mediaIds };
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

/**
 * Delete a media item (Firestore + Storage if storagePath exists).
 */
export async function deleteMediaItem(workId, mediaId) {
  const salonId = await getSalonId();
  if (!salonId) throw new Error("No salonId");
  const items = await getMediaItems(workId);
  const item = items.find((m) => m.id === mediaId);
  if (item?.storagePath) {
    try {
      const fileRef = storageRef(storage, item.storagePath);
      await deleteObject(fileRef);
    } catch (e) {
      console.warn("[MediaCloud] Storage delete failed, continuing with Firestore", e);
    }
  }
  await deleteDoc(mediaItemsRef(salonId, workId, mediaId));
}

/**
 * Delete all media from a work (Storage + Firestore mediaItems). Keeps Work record.
 */
export async function deleteAllMediaFromWork(workId) {
  const salonId = await getSalonId();
  if (!salonId) throw new Error("No salonId");
  const items = await getMediaItems(workId);
  for (const item of items) {
    if (item.storagePath) {
      try {
        const fileRef = storageRef(storage, item.storagePath);
        await deleteObject(fileRef);
      } catch (e) {
        console.warn("[MediaCloud] Storage delete failed for", item.id, e);
      }
    }
    await deleteDoc(mediaItemsRef(salonId, workId, item.id));
  }
  await updateContentWork(workId, { updatedAt: serverTimestamp() });
}

/**
 * Get all media items for a work.
 */
export async function getMediaItems(workId) {
  const salonId = await getSalonId();
  if (!salonId) return [];
  const snap = await getDocs(query(mediaItemsRef(salonId, workId), orderBy("sortOrder", "asc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
    const q = query(mediaItemsRef(salonId, workId), orderBy("sortOrder", "asc"));
    unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
export async function getPostedHistory(workId) {
  const salonId = await getSalonId();
  if (!salonId) return [];
  const snap = await getDocs(query(postedHistoryRef(salonId, workId), orderBy("createdAt", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
    const q = query(postedHistoryRef(salonId, workId), orderBy("createdAt", "desc"));
    unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
  const locId = _ffActiveLocationIdForMedia();
  if (!locId) return items; // no active location → show everything (onboarding)
  // STRICT per-location scoping: a category is visible in this branch only
  // when its `locationId` matches. Legacy docs without `locationId` are
  // hidden on purpose to prevent cross-branch leaks; the Owner re-adds the
  // ones they actually want in each location (quick and unambiguous).
  return items.filter((c) => {
    const raw = c && typeof c.locationId === "string" ? c.locationId.trim() : "";
    return raw === locId;
  });
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

  const docData = sanitize({
    name: String(data.name || "").trim() || "Unnamed",
    active: data.active !== false,
    sortOrder: data.sortOrder ?? maxOrder + 1,
    locationId: locId || null,
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
