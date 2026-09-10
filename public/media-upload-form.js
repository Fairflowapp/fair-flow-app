/**
 * media-upload-form.js — Upload Work modal: file/category selection, validation, Firestore
 * upload via media-cloud, points awarding, and modal wiring. Extracted verbatim from
 * media-upload.js (M4).
 */
import { getDocs, query, collection, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import {
  mediaState,
  MEDIA_UPLOAD_POINTS_DAILY_CAP,
  MEDIA_MAX_IMAGES_PER_UPLOAD,
} from "./media-state.js?v=20260910_media_seen";
import { loadUserProfile } from "./media-profile.js?v=20260910_media_seen";
import {
  createWorkWithMedia,
  createWorkWithMediaBestEffort,
  addMediaToExistingWork,
  addMediaToExistingWorkBestEffort,
  getContentWork,
  mediaItemMatchesActiveLocation,
} from "./media-cloud.js?v=20260910_media_seen";

// Injected from media-upload.js (setupModalBackdrops closes sibling modals).
let closeWorkDetails = () => {};
let closeMarkPostedModal = () => {};
export function initMediaUploadForm(deps) {
  if (deps && typeof deps.closeWorkDetails === "function") closeWorkDetails = deps.closeWorkDetails;
  if (deps && typeof deps.closeMarkPostedModal === "function") closeMarkPostedModal = deps.closeMarkPostedModal;
}

// =====================
// Upload Modal
// =====================

function getUploadMode() {
  return document.querySelector('input[name="uploadMode"]:checked')?.value || "new";
}

function getMediaType() {
  return document.querySelector('input[name="mediaType"]:checked')?.value || "photo";
}

function showUploadMessage(text, isError) {
  const el = document.getElementById("uploadWorkMessage");
  if (!el) return;
  el.style.display = "block";
  el.textContent = text;
  el.style.background = isError ? "#fef2f2" : "#f0fdf4";
  el.style.color = isError ? "#b91c1c" : "#166534";
}

function hideUploadMessage() {
  const el = document.getElementById("uploadWorkMessage");
  if (el) el.style.display = "none";
}

function getUploadSelectedFiles(mediaType = getMediaType()) {
  if (mediaType === "before_after") {
    return [
      document.getElementById("uploadWorkFileBefore")?.files?.[0],
      document.getElementById("uploadWorkFileAfter")?.files?.[0],
    ].filter(Boolean);
  }
  const input = document.getElementById("uploadWorkFileInput");
  const files = Array.from(input?.files || []).filter(Boolean);
  return mediaType === "photo" ? files : files.slice(0, 1);
}

function buildMediaUploadSummary(successCount, failureCount) {
  if (failureCount > 0 && successCount > 0) {
    return `Upload complete: ${successCount} succeeded, ${failureCount} failed.`;
  }
  if (failureCount > 0) {
    return `Upload failed: 0 succeeded, ${failureCount} failed.`;
  }
  return `Success! ${successCount} media item(s) added.`;
}

function getMediaPointsAccountId() {
  const candidates = [
    typeof window !== "undefined" ? window.currentSalonId : "",
    mediaState.currentUserProfile?.salonId,
    typeof window !== "undefined" ? window.currentAccountId : "",
    typeof window !== "undefined" ? window.accountId : "",
  ];
  for (const value of candidates) {
    const clean = String(value || "").trim();
    if (clean) return clean;
  }
  return "";
}

function getMediaPointsLocationId(work) {
  const fromWork = String(work?.locationId || "").trim();
  if (fromWork) return fromWork;
  try {
    if (typeof window !== "undefined" && typeof window.ffGetActiveLocationId === "function") {
      const value = window.ffGetActiveLocationId();
      const clean = String(value || "").trim();
      if (clean) return clean;
    }
  } catch (_) {}
  return typeof window !== "undefined" && typeof window.__ff_active_location_id === "string"
    ? window.__ff_active_location_id.trim()
    : "";
}

function resolveMediaPointsType(mediaType) {
  if (mediaType === "before_after") return { key: "beforeAfterUpload", eventType: "image", beforeAfter: true };
  if (mediaType === "video") return { key: "videoUpload", eventType: "video", beforeAfter: false };
  return { key: "photoUpload", eventType: "image", beforeAfter: false };
}

async function sha256File(file) {
  if (!file || !window.crypto?.subtle) return "";
  const buffer = await file.arrayBuffer();
  const hash = await window.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashMediaPointFiles(files, mediaType) {
  const fileList = Array.isArray(files) ? files : [files].filter(Boolean);
  if (mediaType === "before_after") {
    const hashes = await Promise.all(fileList.map((file) => sha256File(file)));
    return [hashes.filter(Boolean).join(":")].filter(Boolean);
  }
  return Promise.all(fileList.map((file) => sha256File(file)));
}

function mediaPointsTodayKey(date = new Date()) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function mediaPointsWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil((((d.getTime() - yearStart) / 86400000) + 1) / 7);
  return year + "-W" + String(week).padStart(2, "0");
}

function mediaPointsTimestampDayKey(value) {
  try {
    const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    return mediaPointsTodayKey(date);
  } catch (_) {
    return "";
  }
}

async function getTodayMediaUploadPointEvents(accountId, staffId) {
  const now = new Date();
  const todayKey = mediaPointsTodayKey(now);
  const snap = await getDocs(query(
    collection(db, `accounts/${accountId}/pointsEvents`),
    where("weekKey", "==", mediaPointsWeekKey(now))
  ));
  return snap.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
    .filter((event) => {
      if (event.voided === true) return false;
      if (String(event.type || "") !== "media_upload") return false;
      if (String(event.sourceModule || "") !== "media") return false;
      if (String(event.staffId || "") !== staffId) return false;
      return mediaPointsTimestampDayKey(event.createdAt) === todayKey;
    });
}

async function awardMediaUploadPoints({ mediaIds, mediaType, work, fileHashes }) {
  try {
    const ids = Array.isArray(mediaIds) ? mediaIds.filter(Boolean) : [mediaIds].filter(Boolean);
    if (!ids.length) return;
    const accountId = getMediaPointsAccountId();
    const locationId = getMediaPointsLocationId(work);
    const staffId = String(mediaState.currentUserProfile?.staffId || "").trim();
    const staffName = String(mediaState.currentUserProfile?.staffName || "").trim();
    if (!accountId || !locationId || !staffId) return;
    if (typeof window.ffGetPointsSettings !== "function" || typeof window.ffCreatePointsEvent !== "function") return;

    console.log("[Points] media upload detected", { mediaIds: ids, staffId, locationId });
    const resolved = resolveMediaPointsType(mediaType);
    console.log("[Points] media type resolved", resolved);
    const settings = await window.ffGetPointsSettings(accountId, locationId);
    const points = Number(settings?.[resolved.key]);
    const awardIds = resolved.beforeAfter ? ids.slice(0, 1) : ids;
    const todayEvents = await getTodayMediaUploadPointEvents(accountId, staffId);
    const existingHashes = new Set(todayEvents.map((event) => String(event.fileHash || "")).filter(Boolean));
    const hashList = Array.isArray(fileHashes) ? fileHashes : [];
    const awardPairs = awardIds.map((mediaId, idx) => ({
      mediaId,
      fileHash: String(hashList[idx] || "").trim(),
    })).filter((pair) => {
      if (pair.fileHash && existingHashes.has(pair.fileHash)) {
        console.log("[Points] media duplicate skipped", { mediaId: pair.mediaId, fileHash: pair.fileHash });
        return false;
      }
      return true;
    });
    const todayCount = todayEvents.length;
    const remaining = Math.max(0, MEDIA_UPLOAD_POINTS_DAILY_CAP - todayCount);
    if (remaining <= 0) {
      console.log("[Points AntiSpam] daily cap reached", { staffId, cap: MEDIA_UPLOAD_POINTS_DAILY_CAP });
      return;
    }
    const cappedAwardPairs = awardPairs.slice(0, remaining);
    if (cappedAwardPairs.length < awardPairs.length) {
      console.log("[Points AntiSpam] daily cap reached", { staffId, cap: MEDIA_UPLOAD_POINTS_DAILY_CAP });
    }

    await Promise.all(cappedAwardPairs.map(async ({ mediaId, fileHash }) => {
      const result = await window.ffCreatePointsEvent({
        accountId,
        staffId,
        staffName,
        locationId,
        type: "media_upload",
        sourceModule: "media",
        sourceId: String(mediaId),
        points: Number.isFinite(points) ? points : 0,
        uniquePerSource: true,
        fileHash,
        sourceMeta: {
          mediaType: resolved.eventType,
          beforeAfter: resolved.beforeAfter,
        },
      });
      if (result?.duplicate) {
        console.log("[Points] media duplicate skipped", { mediaId });
      } else if (result?.created) {
        console.log("[Points] media points added", { mediaId, points: Number.isFinite(points) ? points : 0 });
      }
    }));
  } catch (err) {
    console.warn("[Points] media upload failed", err);
  }
}

function toggleFileInputs() {
  const mediaType = getMediaType();
  const single = document.getElementById("uploadWorkFileSingle");
  const beforeAfter = document.getElementById("uploadWorkFileBeforeAfter");
  const fileInput = document.getElementById("uploadWorkFileInput");
  const hint = document.getElementById("uploadWorkFileHint");
  if (!single || !beforeAfter || !fileInput) return;
  if (mediaType === "before_after") {
    single.style.display = "none";
    beforeAfter.style.display = "block";
    fileInput.accept = "";
    fileInput.multiple = false;
    if (hint) hint.textContent = "Choose one Before image and one After image.";
  } else {
    single.style.display = "block";
    beforeAfter.style.display = "none";
    fileInput.accept = mediaType === "photo" ? "image/*" : "video/*";
    fileInput.multiple = mediaType === "photo";
    if (hint) hint.textContent = mediaType === "photo"
      ? `You can choose up to ${MEDIA_MAX_IMAGES_PER_UPLOAD} images at once.`
      : "Choose one video.";
  }
}

function toggleNewFieldsAndExisting() {
  const mode = getUploadMode();
  const newWrap = document.getElementById("uploadWorkNewFields");
  const existingWrap = document.getElementById("uploadWorkExistingWrap");
  if (newWrap) newWrap.style.display = mode === "new" ? "block" : "none";
  if (existingWrap) existingWrap.style.display = mode === "add" ? "block" : "none";
}

function updateUploadCategoryTriggerText() {
  const triggerText = document.getElementById("uploadWorkCategoryTriggerText");
  if (!triggerText) return;
  const checked = document.querySelectorAll('input[name="uploadWorkCategory"]:checked');
  const names = [...checked].map((el) => el.dataset?.name || el.value || "").filter(Boolean);
  triggerText.textContent = names.length ? names.join(", ") : "Choose categories...";
}

function populateMediaCategoriesDropdown() {
  const dropdown = document.getElementById("uploadWorkCategoryDropdown");
  const trigger = document.getElementById("uploadWorkCategoryTrigger");
  if (!dropdown || !trigger) return;
  const active = mediaState.mediaCategories.filter((c) => c.active !== false).sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
  dropdown.innerHTML = "";
  if (!active.length) {
    const empty = document.createElement("div");
    empty.style.cssText = "font-size:10px;color:#6b7280;padding:12px 14px;line-height:1.35;background:#fff;";
    empty.textContent = "No media categories yet. Add categories in Settings > Media Categories.";
    dropdown.appendChild(empty);
    updateUploadCategoryTriggerText();
    return;
  }
  active.forEach((c) => {
    const label = document.createElement("label");
    label.style.cssText = "display:flex;align-items:center;gap:8px;cursor:pointer;font-size:10px;padding:10px 14px;border-bottom:1px solid #f3f4f6;";
    label.onmouseover = () => { label.style.background = "#f9fafb"; };
    label.onmouseout = () => { label.style.background = ""; };
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.name = "uploadWorkCategory";
    cb.value = c.id;
    cb.dataset.name = c.name || "";
    cb.style.accentColor = "#7c3aed";
    cb.onchange = updateUploadCategoryTriggerText;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(c.name || c.id || "—"));
    dropdown.appendChild(label);
  });
  const lastLabel = dropdown.querySelector("label:last-child");
  if (lastLabel) lastLabel.style.borderBottom = "none";
  updateUploadCategoryTriggerText();
}

function toggleUploadCategoryDropdown() {
  const dropdown = document.getElementById("uploadWorkCategoryDropdown");
  const trigger = document.getElementById("uploadWorkCategoryTrigger");
  if (!dropdown) return;
  const isOpen = dropdown.style.display === "block";
  if (isOpen) {
    closeUploadCategoryDropdown();
    return;
  }
  if (dropdown.parentElement !== document.body) {
    document.body.appendChild(dropdown);
  }
  positionUploadCategoryDropdown(dropdown, trigger);
  dropdown.style.display = "block";
}

function closeUploadCategoryDropdown() {
  const dropdown = document.getElementById("uploadWorkCategoryDropdown");
  if (dropdown) {
    dropdown.style.display = "none";
    clearUploadCategoryDropdownPosition(dropdown);
  }
}

function clearUploadCategoryDropdownPosition(dropdown) {
  if (!dropdown) return;
  dropdown.style.position = "";
  dropdown.style.top = "";
  dropdown.style.left = "";
  dropdown.style.right = "";
  dropdown.style.width = "";
  dropdown.style.maxHeight = "";
  dropdown.style.zIndex = "";
}

function positionUploadCategoryDropdown(dropdown, trigger) {
  if (!dropdown || !trigger) return;
  try {
    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const width = Math.max(180, Math.min(rect.width, vw - margin * 2));
    let left = rect.left;
    if (left + width > vw - margin) left = vw - margin - width;
    if (left < margin) left = margin;

    const below = Math.max(120, vh - rect.bottom - margin);
    const above = Math.max(120, rect.top - margin);
    const openAbove = below < 180 && above > below;
    const maxHeight = Math.min(260, openAbove ? above : below);

    dropdown.style.position = "fixed";
    dropdown.style.left = `${Math.round(left)}px`;
    dropdown.style.right = "auto";
    dropdown.style.width = `${Math.round(width)}px`;
    dropdown.style.maxHeight = `${Math.round(maxHeight)}px`;
    dropdown.style.zIndex = "100500";
    if (openAbove) {
      dropdown.style.top = `${Math.round(Math.max(margin, rect.top - maxHeight - 4))}px`;
    } else {
      dropdown.style.top = `${Math.round(rect.bottom + 4)}px`;
    }
  } catch (_) {
    clearUploadCategoryDropdownPosition(dropdown);
  }
}

function populateWorksDropdown() {
  const select = document.getElementById("uploadWorkExistingSelect");
  if (!select) return;
  select.innerHTML = '<option value="">-- Choose a work --</option>';
  mediaState.userWorks
    .filter((w) => w.status === "active" || w.status === "archived")
    .forEach((w) => {
      const opt = document.createElement("option");
      opt.value = w.id;
      opt.textContent = [Array.isArray(w.categoryNames) ? w.categoryNames.join(", ") : w.categoryName || w.serviceType || "Work", w.caption || ""].filter(Boolean).join(" – ") || w.id;
      select.appendChild(opt);
    });
}

function validateUpload() {
  const mode = getUploadMode();
  const mediaType = getMediaType();
  if (mode === "new" && !mediaType) {
    showUploadMessage("Please select a media type.", true);
    return false;
  }
  if (mediaType === "photo" || mediaType === "video") {
    const files = getUploadSelectedFiles(mediaType);
    if (!files.length) {
      showUploadMessage(mediaType === "photo" ? "Please choose an image." : "Please choose a video.", true);
      return false;
    }
    if (mediaType === "photo" && files.length > MEDIA_MAX_IMAGES_PER_UPLOAD) {
      showUploadMessage(`Please choose up to ${MEDIA_MAX_IMAGES_PER_UPLOAD} images per upload. You selected ${files.length}.`, true);
      return false;
    }
  }
  if (mediaType === "before_after") {
    const before = document.getElementById("uploadWorkFileBefore")?.files?.[0];
    const after = document.getElementById("uploadWorkFileAfter")?.files?.[0];
    if (!before || !after) {
      showUploadMessage("Please choose both Before and After images.", true);
      return false;
    }
  }
  if (mode === "new") {
    const checked = document.querySelectorAll('input[name="uploadWorkCategory"]:checked');
    const activeCategories = mediaState.mediaCategories.filter((c) => c.active !== false);
    if (activeCategories.length === 0) {
      showUploadMessage("No media categories yet. Add categories in Settings > Media Categories.", true);
      return false;
    }
    if (!checked.length) {
      showUploadMessage("Please select at least one category.", true);
      return false;
    }
  }
  if (mode === "add") {
    const workId = document.getElementById("uploadWorkExistingSelect")?.value?.trim();
    if (!workId) {
      showUploadMessage("Please select an existing work.", true);
      return false;
    }
  }
  return true;
}

function formatMediaUploadError(err) {
  const raw = err && (err.message || err.code) ? `${err.code || ""} ${err.message || err}`.trim() : String(err || "");
  return raw || "Upload failed";
}

async function doUpload() {
  if (auth.currentUser && !mediaState.currentUserProfile) {
    try {
      await loadUserProfile();
    } catch (_) {}
  }
  if (!mediaState.currentUserProfile) {
    showUploadMessage("Please sign in first.", true);
    return;
  }
  hideUploadMessage();
  if (!validateUpload()) return;

  const mode = getUploadMode();
  const mediaType = getMediaType();
  const submitBtn = document.getElementById("uploadWorkSubmitBtn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Uploading...";
  }

  try {
    if (mode === "new") {
      const checked = document.querySelectorAll('input[name="uploadWorkCategory"]:checked');
      const categoryIds = [...checked].map((el) => el.value?.trim()).filter(Boolean);
      const categoryNames = [...checked].map((el) => el.dataset?.name || el.value || "").filter(Boolean);
      const caption = document.getElementById("uploadWorkCaption")?.value?.trim() || "";
      const files = getUploadSelectedFiles(mediaType);
      const workPayload = {
        staffId: mediaState.currentUserProfile.staffId,
        staffName: mediaState.currentUserProfile.staffName,
        createdByRole: mediaState.currentUserProfile.createdByRole,
        categoryIds,
        categoryNames,
        serviceType: categoryNames[0] || "", // backward compat
        caption,
        locationId: typeof window.ffGetActiveLocationId === "function" ? String(window.ffGetActiveLocationId() || "").trim() : "",
      };
      showUploadMessage(`Uploading 0/${files.length}...`, false);
      const uploadResult = mediaType === "photo"
        ? await createWorkWithMediaBestEffort(workPayload, files, mediaType, ({ done, total }) => {
          showUploadMessage(`Uploading ${done}/${total}...`, false);
        })
        : {
          ...(await createWorkWithMedia(workPayload, mediaType === "before_after" ? files : files[0], mediaType)),
          failures: [],
          successfulFiles: files,
        };
      const { workId, mediaIds, successfulFiles = [], failures = [] } = uploadResult;
      if (!mediaIds.length) {
        showUploadMessage(buildMediaUploadSummary(0, failures.length || files.length), true);
        return;
      }
      const fileHashes = await hashMediaPointFiles(successfulFiles.length ? successfulFiles : files, mediaType);
      void awardMediaUploadPoints({
        mediaIds,
        mediaType,
        fileHashes,
        work: { locationId: typeof window !== "undefined" && typeof window.ffGetActiveLocationId === "function" ? window.ffGetActiveLocationId() : "" },
      });
      showUploadMessage(`Work created. ${buildMediaUploadSummary(mediaIds.length, failures.length)}`, failures.length > 0);
      mediaState.userWorks.unshift({ id: workId, categoryIds, categoryNames, categoryId: categoryIds[0], categoryName: categoryNames[0], serviceType: categoryNames[0], caption, status: "active" });
      populateWorksDropdown();
      document.getElementById("uploadWorkFileInput").value = "";
      document.getElementById("uploadWorkFileBefore").value = "";
      document.getElementById("uploadWorkFileAfter").value = "";
      if (!failures.length) setTimeout(() => closeUploadModal(), 1500);
    } else {
      const workId = document.getElementById("uploadWorkExistingSelect")?.value?.trim();
      const existing = workId ? await getContentWork(workId) : null;
      if (!existing || !mediaItemMatchesActiveLocation(existing)) {
        showUploadMessage("This work belongs to another location.", true);
        return;
      }
      const files = getUploadSelectedFiles(mediaType);
      showUploadMessage(`Uploading 0/${files.length}...`, false);
      const uploadResult = mediaType === "photo"
        ? await addMediaToExistingWorkBestEffort(workId, files, mediaType, ({ done, total }) => {
          showUploadMessage(`Uploading ${done}/${total}...`, false);
        })
        : {
          mediaIds: await addMediaToExistingWork(workId, mediaType === "before_after" ? files : files[0], mediaType),
          failures: [],
          successfulFiles: files,
        };
      const { mediaIds, successfulFiles = [], failures = [] } = uploadResult;
      if (!mediaIds.length) {
        showUploadMessage(buildMediaUploadSummary(0, failures.length || files.length), true);
        return;
      }
      const fileHashes = await hashMediaPointFiles(successfulFiles.length ? successfulFiles : files, mediaType);
      getContentWork(workId)
        .then((work) => awardMediaUploadPoints({ mediaIds, mediaType, work, fileHashes }))
        .catch(() => awardMediaUploadPoints({ mediaIds, mediaType, work: null, fileHashes }));
      showUploadMessage(buildMediaUploadSummary(mediaIds.length, failures.length), failures.length > 0);
      document.getElementById("uploadWorkFileInput").value = "";
      document.getElementById("uploadWorkFileBefore").value = "";
      document.getElementById("uploadWorkFileAfter").value = "";
      if (!failures.length) setTimeout(() => closeUploadModal(), 1500);
    }
  } catch (e) {
    console.error("[Media] Upload failed", e);
    const msg = formatMediaUploadError(e);
    showUploadMessage(msg, true);
    if (/storage|owner|upgrade|נפח/i.test(msg)) {
      if (typeof window.ffStyledAlert === "function") {
        window.ffStyledAlert(msg, "Storage");
      } else {
        alert(msg);
      }
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Upload";
    }
  }
}

function openUploadModal() {
  try {
    const multi = typeof window.ffUserHasMultipleLocations === "function" && window.ffUserHasMultipleLocations();
    const loc = typeof window.ffGetActiveLocationId === "function" ? String(window.ffGetActiveLocationId() || "").trim() : "";
    if (multi && !loc) {
      if (typeof window.showToast === "function") window.showToast("Choose a location before uploading media.", "error");
      else alert("Choose a location before uploading media.");
      return;
    }
  } catch (_) {}
  const modal = document.getElementById("uploadWorkModal");
  if (modal) {
    modal.style.display = "flex";
    closeUploadCategoryDropdown();
    populateMediaCategoriesDropdown();
    populateWorksDropdown();
    toggleFileInputs();
    toggleNewFieldsAndExisting();
    hideUploadMessage();
  }
}

function closeUploadModal() {
  closeUploadCategoryDropdown();
  const modal = document.getElementById("uploadWorkModal");
  if (modal) modal.style.display = "none";
}

function setupModalBackdrops() {
  ["uploadWorkModal", "workDetailsModal", "markPostedModal"].forEach((id) => {
    const modal = document.getElementById(id);
    if (modal) {
      modal.onclick = (e) => {
        if (e.target === modal) {
          if (id === "uploadWorkModal") closeUploadModal();
          else if (id === "workDetailsModal") closeWorkDetails();
          else if (id === "markPostedModal") closeMarkPostedModal();
        }
      };
    }
  });
}
function setupUploadModalListeners() {
  document.querySelectorAll('input[name="uploadMode"]').forEach((r) => {
    r.addEventListener("change", () => {
      toggleNewFieldsAndExisting();
    });
  });
  document.querySelectorAll('input[name="mediaType"]').forEach((r) => {
    r.addEventListener("change", () => {
      toggleFileInputs();
    });
  });
  document.getElementById("uploadWorkModalClose")?.addEventListener("click", closeUploadModal);
  document.getElementById("uploadWorkSubmitBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    void doUpload();
  });

  const categoryTrigger = document.getElementById("uploadWorkCategoryTrigger");
  const categoryDropdown = document.getElementById("uploadWorkCategoryDropdown");
  if (categoryTrigger && categoryDropdown) {
    categoryTrigger.onclick = (e) => {
      e.stopPropagation();
      toggleUploadCategoryDropdown();
    };
    categoryDropdown.onclick = (e) => e.stopPropagation();
  }
}

export {
  populateWorksDropdown,
  populateMediaCategoriesDropdown,
  openUploadModal,
  closeUploadModal,
  setupUploadModalListeners,
  setupModalBackdrops,
  toggleFileInputs,
  toggleNewFieldsAndExisting,
};
