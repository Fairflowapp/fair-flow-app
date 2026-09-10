/**
 * Media Module – MY UPLOADS / TO HANDLE tabs, Upload Work modal, Work Details, Mark as Posted.
 * Connects to media-cloud.js.
 */

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { auth } from "/app.js?v=20260610_force_lp_ios";
import { mediaState } from "./media-state.js?v=20260910_media_seen";
import {
  subscribeContentWorks,
  fetchContentWorks,
  getMediaCategories,
  subscribeMediaCategories,
  createMediaCategory,
  updateMediaCategory,
  deleteMediaCategory,
} from "./media-cloud.js?v=20260910_media_seen";
import { loadUserProfile, canHandleMediaWork } from "./media-profile.js?v=20260910_media_seen";
import { initMediaNativeShare } from "./media-native-share.js?v=20260910_media_seen";
import {
  initMediaUploadForm,
  populateWorksDropdown,
  populateMediaCategoriesDropdown,
  openUploadModal,
  closeUploadModal,
  setupUploadModalListeners,
  setupModalBackdrops,
  toggleFileInputs,
  toggleNewFieldsAndExisting,
} from "./media-upload-form.js?v=20260910_media_seen";
import {
  initMediaWorkDetails,
  closeWorkDetails,
  closeMarkPostedModal,
  setupWorkDetailsListeners,
  setupMarkPostedListeners,
} from "./media-work-details.js?v=20260910_media_seen";
import {
  setMediaTab,
  renderMediaFilters,
  renderMediaList,
  applyToHandleVisibility,
  showMediaMessage,
  showMediaConfirm,
  enrichWorkWithPreview,
  formatDate,
  getStatusLabels,
  isSelfDeleteEligible,
  canShowSelfDeleteButton,
  updateMediaUploadWorkButtonVisibility,
  closeMediaDropdowns,
  _positionMediaDropdownPanel,
} from "./media-view.js?v=20260910_media_seen";




// =====================
// Navigation
// =====================

export async function goToMedia() {
  try {
    if (typeof window.ffDismissQueueBootSkeleton === "function") window.ffDismissQueueBootSkeleton();
  } catch (_) {}
  if (typeof window.ffCloseGlobalBlockingOverlays === "function") {
    try {
      window.ffCloseGlobalBlockingOverlays();
    } catch (e) {}
  }
  const tasksScreen = document.getElementById("tasksScreen");
  const inboxScreen = document.getElementById("inboxScreen");
  const chatScreen = document.getElementById("chatScreen");
  const ticketsScreen = document.getElementById("ticketsScreen");
  const trainingScreen = document.getElementById("trainingScreen");
  const scheduleScreen = document.getElementById("scheduleScreen");
  const timeClockScreen = document.getElementById("timeClockScreen");
  const inventoryScreen = document.getElementById("inventoryScreen");
  const pointsAppScreen = document.getElementById("pointsAppScreen");
  const userProfileScreen = document.getElementById("userProfileScreen");
  const myProfileScreen = document.getElementById("myProfileScreen");
  const manageQueueScreen = document.getElementById("manageQueueScreen");
  const ownerView = document.getElementById("owner-view");
  const joinBar = document.getElementById("joinBar");
  const queueControls = document.getElementById("queueControls");
  const wrapEl = document.querySelector(".wrap");

  if (tasksScreen) tasksScreen.style.display = "none";
  if (inboxScreen) inboxScreen.style.display = "none";
  if (chatScreen) chatScreen.style.display = "none";
  if (ticketsScreen) ticketsScreen.style.display = "none";
  if (trainingScreen) trainingScreen.style.display = "none";
  if (scheduleScreen) scheduleScreen.style.display = "none";
  if (timeClockScreen) timeClockScreen.style.display = "none";
  if (inventoryScreen) inventoryScreen.style.display = "none";
  if (pointsAppScreen) pointsAppScreen.style.display = "none";
  if (userProfileScreen) userProfileScreen.style.display = "none";
  if (myProfileScreen) myProfileScreen.style.display = "none";
  if (manageQueueScreen) manageQueueScreen.style.display = "none";
  if (ownerView) ownerView.style.display = "none";
  if (joinBar) joinBar.style.display = "none";
  if (queueControls) queueControls.style.display = "none";
  if (wrapEl) wrapEl.style.display = "none";

  const screen = document.getElementById("mediaScreen");
  if (screen) {
    screen.style.display = "flex";
    screen.setAttribute("data-media-tab", mediaState.currentMediaTab);
    document.querySelectorAll(".btn-pill").forEach((b) => b.classList.remove("active"));
    const btn = document.getElementById("mediaBtn");
    if (btn) btn.classList.add("active");
  }
  applyToHandleVisibility();
  updateMediaUploadWorkButtonVisibility();
  try { renderMediaFilters(); } catch (e) { console.warn("[Media] renderMediaFilters", e); }
  ffMediaMarkSeenNow();
  paintMediaHandleBadge();
  if (!auth.currentUser) {
    mediaState.mediaMyWorksHydrated = true;
    mediaState.mediaAllWorksHydrated = true;
  }
  try { renderMediaList(); } catch (e) { console.warn("[Media] renderMediaList", e); }

  try { setupMediaWorkListSubscriptions(); } catch (e) { console.warn("[Media] setup subs", e); }

  if (auth.currentUser) {
    void loadUserProfile().then(() => {
      applyToHandleVisibility();
      setupMediaWorkListSubscriptions();
      updateMediaUploadWorkButtonVisibility();
      renderMediaFilters();
      renderMediaList();
    }).catch((e) => {
      console.warn("[Media] goToMedia profile/subscriptions", e);
      mediaState.mediaMyWorksHydrated = true;
      mediaState.mediaAllWorksHydrated = true;
      applyToHandleVisibility();
      renderMediaList();
    });
  }

  try {
    if (typeof window.ffApplyQueueViewGate === "function") window.ffApplyQueueViewGate();
  } catch (_) {}
}

function hideMediaScreen() {
  const screen = document.getElementById("mediaScreen");
  if (screen) screen.style.display = "none";
  const btn = document.getElementById("mediaBtn");
  if (btn) btn.classList.remove("active");
}

function switchMediaTab(tab) {
  const next = tab === "to_handle" ? "to_handle" : "my_uploads";
  setMediaTab(next);
  try { setupMediaWorkListSubscriptions(); } catch (_) {}
}

function bindMediaTabButtons() {
  const tabMy = document.getElementById("mediaTabMyUploads");
  const tabToHandle = document.getElementById("mediaTabToHandle");
  if (tabMy) {
    tabMy.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      switchMediaTab("my_uploads");
    };
  }
  if (tabToHandle) {
    tabToHandle.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      switchMediaTab("to_handle");
    };
  }
}

// Expose immediately so MEDIA button works for all users (including Admin) before auth callback
if (typeof window !== "undefined") {
  window.goToMedia = goToMedia;
  window.__ffSetMediaTabReal = switchMediaTab;
  window.setMediaTab = switchMediaTab;
  window.hideUploadWorkScreen = hideMediaScreen;
  window.__ffMediaOnBootWorks = (works) => {
    const rows = Array.isArray(works) ? works : [];
    if (!rows.length) return;
    window.__ffMediaBootWorks = rows;
    mediaState.mediaAllWorksHydrated = true;
    mediaState.allWorks = mergeWorkPreviewCache(mediaState.allWorks, rows);
    const staffId = String(mediaState.currentUserProfile?.staffId || window.__ff_authedStaffId || "").trim();
    const uid = String(mediaState.currentUserProfile?.uid || auth.currentUser?.uid || "").trim();
    const own = rows.filter((w) => {
      if (!w || w.status === "deleted") return false;
      const ws = String(w.staffId || "").trim();
      const wu = String(w.createdByUid || "").trim();
      return (staffId && ws === staffId) || (uid && wu === uid);
    });
    mediaState.userWorks = mergeWorkPreviewCache(mediaState.userWorks, own);
    mediaState.mediaMyWorksHydrated = true;
    try { paintMediaHandleBadge(); } catch (_) {}
    try { renderMediaFilters(); } catch (_) {}
    try { renderMediaList(); } catch (_) {}
  };
  // Direct binding so button works even if inline onclick fails
  const mediaBtn = document.getElementById("mediaBtn");
  if (mediaBtn) mediaBtn.onclick = goToMedia;
  bindMediaTabButtons();
}

// =====================
// Init
// =====================



function initMediaModule() {
  initMediaWorkDetails({
    showMediaMessage,
    showMediaConfirm,
    renderMediaList,
    enrichWorkWithPreview,
    formatDate,
    getStatusLabels,
    isSelfDeleteEligible,
    canShowSelfDeleteButton,
  });
  initMediaUploadForm({ closeWorkDetails, closeMarkPostedModal });
  const tabMy = document.getElementById("mediaTabMyUploads");
  const tabToHandle = document.getElementById("mediaTabToHandle");
  bindMediaTabButtons();

  const filterTrigger = document.getElementById("mediaFilterTrigger");
  const sortTrigger = document.getElementById("mediaSortTrigger");
  const filterDropdown = document.getElementById("mediaFilterDropdown");
  const sortDropdown = document.getElementById("mediaSortDropdown");
  if (filterTrigger && filterDropdown) {
    filterTrigger.onclick = (e) => {
      e.stopPropagation();
      const open = filterDropdown.style.display === "block";
      closeMediaDropdowns();
      if (!open) {
        _positionMediaDropdownPanel(filterDropdown, filterTrigger);
        filterDropdown.style.display = "block";
      }
    };
  }
  if (sortTrigger && sortDropdown) {
    sortTrigger.onclick = (e) => {
      e.stopPropagation();
      const open = sortDropdown.style.display === "block";
      closeMediaDropdowns();
      if (!open) {
        _positionMediaDropdownPanel(sortDropdown, sortTrigger);
        sortDropdown.style.display = "block";
      }
    };
  }
  const employeeTrigger = document.getElementById("mediaEmployeeFilterTrigger");
  const employeeDropdown = document.getElementById("mediaEmployeeFilterDropdown");
  if (employeeTrigger && employeeDropdown) {
    employeeTrigger.onclick = (e) => {
      e.stopPropagation();
      const open = employeeDropdown.style.display === "block";
      closeMediaDropdowns();
      if (!open && mediaState.currentMediaTab === "to_handle") {
        _positionMediaDropdownPanel(employeeDropdown, employeeTrigger);
        employeeDropdown.style.display = "block";
      }
    };
  }
  const categoryTrigger = document.getElementById("mediaCategoryFilterTrigger");
  const categoryDropdown = document.getElementById("mediaCategoryFilterDropdown");
  if (categoryTrigger && categoryDropdown) {
    categoryTrigger.onclick = (e) => {
      e.stopPropagation();
      const open = categoryDropdown.style.display === "block";
      closeMediaDropdowns();
      if (!open) {
        _positionMediaDropdownPanel(categoryDropdown, categoryTrigger);
        categoryDropdown.style.display = "block";
      }
    };
  }
  [filterDropdown, sortDropdown, employeeDropdown, categoryDropdown].forEach((el) => {
    if (el) el.onclick = (e) => e.stopPropagation();
  });
  document.addEventListener("click", () => closeMediaDropdowns());

  document.getElementById("mediaUploadWorkBtn")?.addEventListener("click", openUploadModal);
  setupUploadModalListeners();
  setupWorkDetailsListeners();
  setupMarkPostedListeners();
  setupModalBackdrops();

  document.addEventListener("click", (e) => {
    const dropdown = document.getElementById("uploadWorkCategoryDropdown");
    if (!dropdown || dropdown.style.display !== "block") return;
    const trigger = document.getElementById("uploadWorkCategoryTrigger");
    if (trigger?.contains(e.target) || dropdown.contains(e.target)) return;
    closeUploadCategoryDropdown();
  });

  toggleFileInputs();
  toggleNewFieldsAndExisting();
  renderMediaFilters();
}

/**
 * Key for the "I have seen the Media works up to here" marker.
 *
 * Deliberately NOT scoped by location: the active location id is only known once
 * the location modules have loaded, so a location-scoped key was written under one
 * name and read under another, the read came back 0, and the badge counted every
 * unposted work forever. Returns "" when the salon/user is not known yet, and
 * callers must then leave the badge alone rather than counting from zero.
 */
function ffMediaLastSeenStorageKey() {
  const uid = String(mediaState.currentUserProfile?.uid || auth.currentUser?.uid || "").trim();
  const salon = String(
    mediaState.currentUserProfile?.salonId
    || (typeof window !== "undefined" ? window.currentSalonId : "")
    || ""
  ).trim();
  if (!uid || !salon) return "";
  return `ff_media_last_seen_ms_${salon}_${uid}`;
}

/** Newest marker written under the old location-scoped keys, so existing state carries over. */
function ffMediaLegacyLastSeenMs(baseKey) {
  let best = 0;
  try {
    const prefix = `${baseKey}_`;
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k || k.indexOf(prefix) !== 0) continue;
      const n = Number(localStorage.getItem(k) || 0);
      if (Number.isFinite(n) && n > best) best = n;
    }
  } catch (_) {}
  return best;
}

/** @returns {number} marker in ms, or -1 when it cannot be determined yet. */
function ffMediaGetLastSeenMs() {
  const key = ffMediaLastSeenStorageKey();
  if (!key) return -1;
  try {
    const n = Number(localStorage.getItem(key) || 0);
    if (Number.isFinite(n) && n > 0) return n;
    return ffMediaLegacyLastSeenMs(key);
  } catch (_) {
    return -1;
  }
}

function ffMediaMarkSeenNow() {
  const key = ffMediaLastSeenStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, String(Date.now()));
  } catch (_) {}
}

function ffMediaWorkCreatedMs(work) {
  const c = work && work.createdAt;
  if (!c) return 0;
  try {
    if (typeof c.toMillis === "function") return Number(c.toMillis()) || 0;
    if (typeof c.toDate === "function") return c.toDate().getTime() || 0;
  } catch (_) {}
  const n = new Date(c).getTime();
  return Number.isFinite(n) ? n : 0;
}

function paintMediaHandleBadge() {
  let n = 0;
  if (canHandleMediaWork()) {
    const seenMs = ffMediaGetLastSeenMs();
    // Marker not resolvable yet — leave whatever is on screen instead of counting
    // everything as unseen.
    if (seenMs < 0) return;
    n = (mediaState.allWorks || []).filter((w) => {
      if (!w || w.status === "archived" || w.status === "deleted") return false;
      if (Number(w.postedCount || 0) > 0) return false;
      return ffMediaWorkCreatedMs(w) > seenMs;
    }).length;
  }
  if (typeof window.ffPaintAppsModuleBadge === "function") {
    window.ffPaintAppsModuleBadge("media", n);
  } else {
    const nav = document.getElementById("mediaNavBadge");
    if (nav) {
      nav.textContent = n > 0 ? (n > 99 ? "99+" : String(n)) : "";
    }
  }
}

function mediaWorkListSubKey() {
  const canAll = canHandleMediaWork();
  return `${mediaState.currentUserProfile?.uid || ""}|${mediaState.currentUserProfile?.staffId || ""}|${mediaState.currentUserProfile?.salonId || ""}|${canAll ? "1" : "0"}`;
}

function mergeWorkPreviewCache(prevList, nextList) {
  const prevById = new Map((Array.isArray(prevList) ? prevList : []).map((w) => [w && w.id, w]));
  return (Array.isArray(nextList) ? nextList : []).map((w) => {
    if (!w || !w.id) return w;
    const prev = prevById.get(w.id);
    if (!prev) return w;
    const cached = prev._firstMediaUrl != null ? String(prev._firstMediaUrl).trim() : "";
    if (cached && /^https?:\/\//i.test(cached) && !w._firstMediaUrl) {
      return { ...w, _firstMediaUrl: cached };
    }
    return w;
  });
}

function setupMediaWorkListSubscriptions() {
  const canAll = canHandleMediaWork();
  const subKey = mediaWorkListSubKey();
  if (mediaState.unsubMyWorks && mediaState._mediaWorkListSubKey === subKey) {
    applyToHandleVisibility();
    renderMediaList();
    paintMediaHandleBadge();
    return;
  }
  mediaState._mediaWorkListSubKey = subKey;

  if (mediaState.unsubMyWorks) {
    mediaState.unsubMyWorks();
    mediaState.unsubMyWorks = null;
  }
  if (mediaState.unsubAllWorks) {
    mediaState.unsubAllWorks();
    mediaState.unsubAllWorks = null;
  }

  if (!(mediaState.userWorks || []).length && !(typeof window !== "undefined" && (window.__ffMediaBootWorks || []).length)) {
    mediaState.mediaMyWorksHydrated = false;
  }
  if (!(mediaState.allWorks || []).length && !(typeof window !== "undefined" && (window.__ffMediaBootWorks || []).length)) {
    mediaState.mediaAllWorksHydrated = false;
  }

  if (mediaState.currentUserProfile?.staffId || mediaState.currentUserProfile?.uid) {
    const staffIdForQuery = String(mediaState.currentUserProfile?.staffId || "").trim();
    mediaState.unsubMyWorks = subscribeContentWorks(staffIdForQuery ? { staffId: staffIdForQuery } : {}, async (works) => {
      const uid = String(mediaState.currentUserProfile?.uid || "").trim();
      const staffId = String(mediaState.currentUserProfile?.staffId || "").trim();
      const ownWorks = (Array.isArray(works) ? works : []).filter((work) => {
        const workStaffId = String(work?.staffId || "").trim();
        const workCreatedByUid = String(work?.createdByUid || "").trim();
        return (staffId && workStaffId === staffId) || (uid && workCreatedByUid === uid);
      });
      mediaState.mediaMyWorksHydrated = true;
      mediaState.userWorks = mergeWorkPreviewCache(mediaState.userWorks, ownWorks);
      populateWorksDropdown();
      renderMediaList();
      const toEnrich = ownWorks.filter((w) => {
        const pre = w && w.previewMediaUrl != null ? String(w.previewMediaUrl).trim() : "";
        const cached = w && w._firstMediaUrl != null ? String(w._firstMediaUrl).trim() : "";
        return !(/^https?:\/\//i.test(pre) || /^https?:\/\//i.test(cached));
      }).slice(0, 8);
      if (!toEnrich.length) return;
      const enriched = await Promise.all(toEnrich.map((w) => enrichWorkWithPreview({ ...w })));
      const byId = new Map(enriched.map((w) => [w.id, w]));
      mediaState.userWorks = mergeWorkPreviewCache(
        mediaState.userWorks,
        ownWorks.map((w) => byId.get(w.id) || w)
      );
      populateWorksDropdown();
      renderMediaList();
    });
  } else if (!auth.currentUser) {
    mediaState.mediaMyWorksHydrated = true;
    mediaState.userWorks = [];
  }

  applyToHandleVisibility();
  if (typeof window !== "undefined" && Array.isArray(window.__ffMediaBootWorks) && window.__ffMediaBootWorks.length) {
    mediaState.mediaAllWorksHydrated = true;
    mediaState.allWorks = mergeWorkPreviewCache(mediaState.allWorks, window.__ffMediaBootWorks);
    paintMediaHandleBadge();
    renderMediaFilters();
    renderMediaList();
  }
  void fetchContentWorks({}).then((arr) => {
    if (arr == null) return;
    mediaState.mediaAllWorksHydrated = true;
    mediaState.allWorks = mergeWorkPreviewCache(mediaState.allWorks, arr);
    paintMediaHandleBadge();
    renderMediaFilters();
    renderMediaList();
  }).catch(() => {});
  if (canHandleMediaWork()) {
    mediaState.unsubAllWorks = subscribeContentWorks({}, async (works) => {
      const arr = Array.isArray(works) ? works : [];
      mediaState.mediaAllWorksHydrated = true;
      mediaState.allWorks = mergeWorkPreviewCache(mediaState.allWorks, arr);
      paintMediaHandleBadge();
      renderMediaFilters();
      renderMediaList();
      const toEnrich = arr.filter((w) => {
        const pre = w && w.previewMediaUrl != null ? String(w.previewMediaUrl).trim() : "";
        const cached = w && w._firstMediaUrl != null ? String(w._firstMediaUrl).trim() : "";
        return !(/^https?:\/\//i.test(pre) || /^https?:\/\//i.test(cached));
      }).slice(0, 8);
      if (!toEnrich.length) return;
      const enriched = await Promise.all(toEnrich.map((w) => enrichWorkWithPreview({ ...w })));
      const byId = new Map(enriched.map((w) => [w.id, w]));
      mediaState.allWorks = mergeWorkPreviewCache(
        mediaState.allWorks,
        arr.map((w) => byId.get(w.id) || w)
      );
      paintMediaHandleBadge();
      renderMediaFilters();
      renderMediaList();
    });
  } else {
    mediaState.mediaAllWorksHydrated = true;
    mediaState.allWorks = [];
    paintMediaHandleBadge();
  }
}

export function initMediaUpload() {
  initMediaNativeShare({ showMediaMessage });
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      hideMediaScreen();
      mediaState.currentUserProfile = null;
      mediaState._mediaWorkListSubKey = "";
      mediaState.mediaMyWorksHydrated = true;
      mediaState.mediaAllWorksHydrated = true;
      mediaState.userWorks = [];
      mediaState.allWorks = [];
      paintMediaHandleBadge();
      if (mediaState.unsubMyWorks) {
        mediaState.unsubMyWorks();
        mediaState.unsubMyWorks = null;
      }
    if (mediaState.unsubAllWorks) {
      mediaState.unsubAllWorks();
      mediaState.unsubAllWorks = null;
    }
    if (mediaState.unsubMediaCategories) {
      mediaState.unsubMediaCategories();
      mediaState.unsubMediaCategories = null;
    }
    return;
  }
  try { initMediaModule(); } catch (e) { console.warn("[Media] initMediaModule", e); }
    try { setupMediaWorkListSubscriptions(); } catch (e) { console.warn("[Media] setup subs", e); }
    await loadUserProfile();
    applyToHandleVisibility();
    try { setupMediaWorkListSubscriptions(); } catch (_) {}

    if (mediaState.unsubMediaCategories) {
      mediaState.unsubMediaCategories();
      mediaState.unsubMediaCategories = null;
    }
    mediaState.unsubMediaCategories = subscribeMediaCategories((cats) => {
      mediaState.mediaCategories = cats || [];
      populateMediaCategoriesDropdown();
    });

    // app.js sets window.__ff_user_role after user doc load — retry so "To handle" matches salon role
    setTimeout(async () => {
      try {
        await loadUserProfile();
        applyToHandleVisibility();
        setupMediaWorkListSubscriptions();
        if (document.getElementById("mediaScreen")?.style.display === "flex") {
          renderMediaFilters();
          renderMediaList();
        }
      } catch (_) {}
    }, 700);

    if (document.getElementById("mediaScreen")?.style.display === "flex") {
      applyToHandleVisibility();
      renderMediaFilters();
      renderMediaList();
    }
  });
}

// =====================
// Media Categories Settings (User Profile)
// =====================

let _editingMediaCategoryId = null;

async function renderMediaCategoriesSettings() {
  const listContainer = document.getElementById("userProfileMediaCategoriesList");
  const emptyState = document.getElementById("userProfileMediaCategoriesEmptyState");
  if (!listContainer) return;

  const existingItems = listContainer.querySelectorAll(".media-category-item");
  existingItems.forEach((item) => item.remove());

  const cats = await getMediaCategories();

  if (cats.length === 0) {
    if (emptyState) emptyState.style.display = "block";
    return;
  }

  if (emptyState) emptyState.style.display = "none";

  cats.sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));

  cats.forEach((cat) => {
    const item = document.createElement("div");
    item.className = "media-category-item";
    item.style.cssText = "display:flex;align-items:center;gap:12px;padding:12px 16px;margin-bottom:8px;background:#f9fafb;border:1px solid var(--border);border-radius:8px;transition:background 0.15s, opacity 0.15s;";
    item.dataset.categoryId = cat.id;

    const statusIndicator = document.createElement("div");
    statusIndicator.style.cssText = `width:10px;height:10px;border-radius:50%;background:${cat.active !== false ? "#10b981" : "#9ca3af"};flex-shrink:0;`;
    statusIndicator.title = cat.active !== false ? "Active" : "Inactive";

    const nameContainer = document.createElement("div");
    nameContainer.style.cssText = "flex:1;min-width:0;";

    if (_editingMediaCategoryId === cat.id) {
      const editInput = document.createElement("input");
      editInput.type = "text";
      editInput.value = cat.name || "";
      editInput.style.cssText = "width:100%;padding:6px 10px;border:1px solid #a78bfa;border-radius:6px;font-size:14px;";
      editInput.addEventListener("keydown", async (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          await saveMediaCategoryEdit(cat.id, editInput.value.trim());
        } else if (e.key === "Escape") {
          _editingMediaCategoryId = null;
          renderMediaCategoriesSettings();
        }
      });
      editInput.addEventListener("blur", async () => {
        await saveMediaCategoryEdit(cat.id, editInput.value.trim());
      });
      nameContainer.appendChild(editInput);
      setTimeout(() => editInput.focus(), 0);
    } else {
      const nameSpan = document.createElement("span");
      nameSpan.textContent = cat.name || "";
      nameSpan.style.cssText = `font-size:14px;color:${cat.active !== false ? "#111827" : "#9ca3af"};font-weight:500;`;
      if (cat.active === false) nameSpan.style.textDecoration = "line-through";
      nameContainer.appendChild(nameSpan);
    }

    const dragHandle = document.createElement("div");
    dragHandle.innerHTML = "⋮⋮";
    dragHandle.style.cssText = "cursor:grab;color:#9ca3af;font-size:14px;padding:4px;user-select:none;flex-shrink:0;";
    dragHandle.title = "Drag to reorder";
    dragHandle.draggable = true;
    dragHandle.dataset.categoryId = cat.id;
    dragHandle.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", cat.id);
      e.dataTransfer.effectAllowed = "move";
      item.style.opacity = "0.6";
      item.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
      dragHandle.style.cursor = "grabbing";
    });
    dragHandle.addEventListener("dragend", () => {
      item.style.opacity = "1";
      item.style.boxShadow = "";
      dragHandle.style.cursor = "grab";
    });

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.textContent = cat.active !== false ? "Active" : "Inactive";
    toggleBtn.style.cssText = `padding:6px 12px;border:1px solid ${cat.active !== false ? "#10b981" : "#9ca3af"};border-radius:6px;background:${cat.active !== false ? "#d1fae5" : "#f3f4f6"};color:${cat.active !== false ? "#065f46" : "#6b7280"};cursor:pointer;font-size:12px;font-weight:600;`;
    toggleBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await updateMediaCategory(cat.id, { active: !cat.active });
      renderMediaCategoriesSettings();
    });

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.style.cssText = "padding:6px 12px;border:1px solid #a78bfa;border-radius:6px;background:#ede9fe;color:#7c3aed;cursor:pointer;font-size:12px;font-weight:600;";
    editBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      _editingMediaCategoryId = cat.id;
      renderMediaCategoriesSettings();
    });

    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const draggedId = e.dataTransfer.getData("text/plain");
      if (draggedId && draggedId !== cat.id) item.style.background = "#e5e7eb";
    });
    item.addEventListener("dragleave", (e) => {
      if (!item.contains(e.relatedTarget)) item.style.background = "#f9fafb";
    });
    item.addEventListener("drop", async (e) => {
      e.preventDefault();
      item.style.background = "#f9fafb";
      const draggedId = e.dataTransfer.getData("text/plain");
      if (!draggedId || draggedId === cat.id) return;
      const fromIdx = cats.findIndex((c) => c.id === draggedId);
      const toIdx = cats.findIndex((c) => c.id === cat.id);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
      const draggedEl = listContainer.querySelector(`[data-category-id="${draggedId}"]`);
      if (draggedEl && toIdx < listContainer.children.length) {
        const refEl = listContainer.children[toIdx];
        listContainer.insertBefore(draggedEl, fromIdx < toIdx ? refEl.nextSibling : refEl);
      }
      await reorderMediaCategories(cats, fromIdx, toIdx);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.textContent = "×";
    deleteBtn.title = "Remove";
    deleteBtn.style.cssText = "padding:0 6px;border:1px solid #fecaca;border-radius:4px;background:#fff;color:#b91c1c;cursor:pointer;font-size:14px;font-weight:600;line-height:1.4;flex-shrink:0;";
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const confirmed = typeof showDeleteConfirm === "function"
        ? await showDeleteConfirm(cat.name || "category")
        : window.confirm(`Remove "${cat.name}"?\nThis cannot be undone.`);
      if (!confirmed) return;
      try {
        await deleteMediaCategory(cat.id);
        await renderMediaCategoriesSettings();
      } catch (err) {
        alert("Error removing category: " + (err.message || err));
      }
    });

    item.appendChild(dragHandle);
    item.appendChild(statusIndicator);
    item.appendChild(nameContainer);
    item.appendChild(toggleBtn);
    item.appendChild(editBtn);
    item.appendChild(deleteBtn);

    listContainer.appendChild(item);
  });
}

async function saveMediaCategoryEdit(categoryId, name) {
  if (!name) return;
  await updateMediaCategory(categoryId, { name });
  _editingMediaCategoryId = null;
  renderMediaCategoriesSettings();
}

async function reorderMediaCategories(cats, fromIdx, toIdx) {
  const arr = [...cats].sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
  const [moved] = arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, moved);
  await Promise.all(arr.map((c, i) => updateMediaCategory(c.id, { sortOrder: i })));
  renderMediaCategoriesSettings();
}

async function addMediaCategoryFromSettings() {
  // Kept as a programmatic helper (callable from the inline Add Category
  // form in index.html). The native alert was removed because the inline
  // form handles the empty-name case by simply returning, and shows styled
  // errors via ffStyledAlert instead of the browser's black popup.
  const input = document.getElementById("userProfileAddMediaCategoryInput");
  if (!input) return;
  const name = input.value.trim();
  if (!name) return;
  try {
    await createMediaCategory({ name });
    input.value = "";
    const form = document.getElementById("userProfileAddMediaCategoryForm");
    if (form) form.style.display = "none";
    await renderMediaCategoriesSettings();
  } catch (e) {
    console.error("[Media] createMediaCategory failed", e);
    const msg =
      e && e.message
        ? String(e.message)
        : "Could not save category. If you use Media “To handle”, you need permission to manage media categories.";
    if (typeof window !== "undefined" && typeof window.ffStyledAlert === "function") {
      window.ffStyledAlert(msg);
    } else {
      alert(msg);
    }
  }
}

function initMediaCategoriesSettingsListeners() {
  // NOTE: The inline form in index.html (openSettings + "+ Add category"
  // button, Save/Cancel + input with Enter) owns the UX. Binding this
  // function's own click+Enter here caused a second handler to fire on
  // "+ Add category" with an empty input, which popped the ugly native
  // alert. We intentionally no-op here and rely on index.html's
  // `window.initMediaCategoriesSettingsListeners` instead.
}

if (typeof window !== "undefined") {
  window.renderMediaCategoriesSettings = renderMediaCategoriesSettings;
  window.addMediaCategoryFromSettings = addMediaCategoryFromSettings;
  // Expose Firestore CRUD so index.html's inline Save handler can write
  // directly to the correct `salons/{salonId}/mediaCategories` subcollection
  // (the snapshot listener re-renders the list automatically).
  window.ffCreateMediaCategory = createMediaCategory;
  window.ffUpdateMediaCategory = updateMediaCategory;
  window.ffDeleteMediaCategory = deleteMediaCategory;
  // DO NOT overwrite index.html's own initMediaCategoriesSettingsListeners.
  // See note above. Keep this no-op reference only if nothing else set it,
  // so callers that guard with `typeof ... === "function"` still succeed.
  if (typeof window.initMediaCategoriesSettingsListeners !== "function") {
    window.initMediaCategoriesSettingsListeners = initMediaCategoriesSettingsListeners;
  }

  // Media Categories are PER-LOCATION. When the user switches locations,
  // re-run the list renderer if the Settings card is visible so the list
  // reflects only the active branch. The media-cloud subscribe helper also
  // re-emits filtered cats to the Upload Work dropdown consumer.
  if (typeof document !== "undefined" && !document.__ffMediaCatLocBound) {
    document.__ffMediaCatLocBound = true;
    document.addEventListener("ff-active-location-changed", () => {
      try { closeUploadModal(); } catch (_) {}
      try { closeWorkDetails(); } catch (_) {}
      try { closeMarkPostedModal(); } catch (_) {}
      try { renderMediaList(); } catch (_) {}
      try {
        const card = document.getElementById("userProfileCardMediaCategories");
        if (card && card.style.display !== "none") {
          renderMediaCategoriesSettings();
        }
      } catch (e) {
        console.warn("[Media] re-render categories on location change failed", e);
      }
    });
  }
}

initMediaUpload();
try {
  const screen = document.getElementById("mediaScreen");
  if (screen && screen.style.display === "flex") void goToMedia();
} catch (_) {}
