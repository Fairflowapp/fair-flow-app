/**
 * media-view.js — Media list UI: tab switching, filters/sort dropdowns, work grid
 * rendering, and shared toast/confirm helpers. Extracted verbatim from media-upload.js (M3).
 */
import { auth } from "/app.js?v=20260610_force_lp_ios";
import {
  mediaState,
  MEDIA_DROPDOWN_FLOAT_MQ,
  MY_UPLOADS_FILTERS,
  TO_HANDLE_FILTERS,
  SORT_OPTIONS,
} from "./media-state.js?v=20260910_media_seen";
import { canHandleMediaWork } from "./media-profile.js?v=20260910_media_seen";
import { resolveWorkCardPreviewUrl } from "./media-cloud.js?v=20260910_media_seen";
import { openUploadModal } from "./media-upload-form.js?v=20260910_media_seen";
import { openWorkDetails } from "./media-work-details.js?v=20260910_media_seen";
import { paintMediaInto, MEDIA_THUMB_PX, isVideoMedia, safeHttpUrl } from "./media-thumbs.js?v=20260910_media_seen";

// =====================
// Tab switching
// =====================

function setMediaTab(tab) {
  mediaState.currentMediaTab = tab;
  mediaState.currentMediaFilter = "all";
  mediaState.currentMediaEmployeeFilter = "all";
  const screenEl = document.getElementById("mediaScreen");
  if (screenEl) screenEl.setAttribute("data-media-tab", tab);
  const myBtn = document.getElementById("mediaTabMyUploads");
  const toHandleBtn = document.getElementById("mediaTabToHandle");
  if (myBtn) {
    myBtn.classList.toggle("active", tab === "my_uploads");
    myBtn.style.background = tab === "my_uploads" ? "#7c3aed" : "#f9fafb";
    myBtn.style.color = tab === "my_uploads" ? "#fff" : "#6b7280";
  }
  if (toHandleBtn) {
    toHandleBtn.classList.toggle("active", tab === "to_handle");
    toHandleBtn.style.background = tab === "to_handle" ? "#7c3aed" : "#f9fafb";
    toHandleBtn.style.color = tab === "to_handle" ? "#fff" : "#6b7280";
  }
  updateMediaUploadWorkButtonVisibility();
  renderMediaFilters();
  renderMediaList();
}

// =====================
// Filters & Sorting
// =====================


function applyEmployeeFilter(works, staffIdOrAll) {
  if (staffIdOrAll === "all" || !staffIdOrAll) return works;
  return works.filter((w) => {
    const id = w.staffId || w.createdByUid;
    return id === staffIdOrAll;
  });
}

function applyCategoryFilter(works, categoryIdOrAll) {
  if (categoryIdOrAll === "all" || !categoryIdOrAll) return works;
  const category = mediaState.mediaCategories.find((c) => c.id === categoryIdOrAll);
  const categoryName = category?.name || "";
  return works.filter((w) => {
    if (Array.isArray(w.categoryIds) && w.categoryIds.includes(categoryIdOrAll)) return true;
    if (w.categoryId) return w.categoryId === categoryIdOrAll;
    if (Array.isArray(w.categoryNames) && w.categoryNames.includes(categoryName)) return true;
    if (w.categoryName) return w.categoryName === categoryName;
    if (w.serviceType && categoryName) return w.serviceType === categoryName;
    return false;
  });
}

function applyFilter(works, filterId) {
  if (filterId === "all") return works;
  if (mediaState.currentMediaTab === "my_uploads") {
    switch (filterId) {
      case "active": return works.filter((w) => w.status === "active");
      case "posted": return works.filter((w) => (w.postedCount || 0) > 0);
      case "featured": return works.filter((w) => w.featured === true);
      case "archived": return works.filter((w) => w.status === "archived");
      default: return works;
    }
  }
  switch (filterId) {
    case "not_posted": return works.filter((w) => (w.postedCount || 0) === 0);
    case "posted": return works.filter((w) => (w.postedCount || 0) > 0);
    case "featured": return works.filter((w) => w.featured === true);
    case "archived": return works.filter((w) => w.status === "archived");
    case "duplicate": return works.filter((w) => w.duplicate === true);
    default: return works;
  }
}

function applySort(works, sortId) {
  const getCreatedAt = (w) => w.createdAt?.toDate ? w.createdAt.toDate().getTime() : (w.createdAt ? new Date(w.createdAt).getTime() : 0);
  const getPostedCount = (w) => w.postedCount || 0;
  const arr = [...works];
  switch (sortId) {
    case "oldest":
      arr.sort((a, b) => getCreatedAt(a) - getCreatedAt(b));
      break;
    case "most_posted":
      arr.sort((a, b) => getPostedCount(b) - getPostedCount(a));
      break;
    case "featured_first":
      arr.sort((a, b) => {
        const fa = a.featured === true ? 1 : 0;
        const fb = b.featured === true ? 1 : 0;
        if (fb !== fa) return fb - fa;
        return getCreatedAt(b) - getCreatedAt(a);
      });
      break;
    case "newest":
    default:
      arr.sort((a, b) => getCreatedAt(b) - getCreatedAt(a));
      break;
  }
  return arr;
}

function getFilterLabel(id) {
  const all = [...MY_UPLOADS_FILTERS, ...TO_HANDLE_FILTERS];
  return all.find((f) => f.id === id)?.label || "Filters";
}

function getSortLabel(id) {
  return SORT_OPTIONS.find((s) => s.id === id)?.label || "Sort";
}


function _clearMediaDropdownPanelPosition(panel) {
  if (!panel) return;
  panel.style.position = "";
  panel.style.top = "";
  panel.style.left = "";
  panel.style.right = "";
  panel.style.width = "";
  panel.style.minWidth = "";
  panel.style.maxWidth = "";
  panel.style.zIndex = "";
}

/** Narrow viewports: use fixed + viewport clamp so menus aren’t clipped when the toolbar overflows horizontally. */
function _positionMediaDropdownPanel(panel, trigger) {
  if (!panel || !trigger) return;
  try {
    if (typeof window.matchMedia === "function" && window.matchMedia(MEDIA_DROPDOWN_FLOAT_MQ).matches) {
      const rect = trigger.getBoundingClientRect();
      const vw = window.innerWidth;
      const margin = 10;
      const desiredW = Math.min(260, Math.max(140, vw - margin * 2));
      let left = rect.left;
      if (left + desiredW > vw - margin) left = vw - margin - desiredW;
      if (left < margin) left = margin;
      panel.style.position = "fixed";
      panel.style.top = `${Math.round(rect.bottom + 4)}px`;
      panel.style.left = `${Math.round(left)}px`;
      panel.style.right = "auto";
      panel.style.width = `${Math.round(desiredW)}px`;
      panel.style.minWidth = "";
      panel.style.maxWidth = "";
      panel.style.zIndex = "5000";
    } else {
      _clearMediaDropdownPanelPosition(panel);
    }
  } catch (_) {
    _clearMediaDropdownPanelPosition(panel);
  }
}

function closeMediaDropdowns() {
  const fd = document.getElementById("mediaFilterDropdown");
  const sd = document.getElementById("mediaSortDropdown");
  const ed = document.getElementById("mediaEmployeeFilterDropdown");
  const cd = document.getElementById("mediaCategoryFilterDropdown");
  [fd, sd, ed, cd].forEach(_clearMediaDropdownPanelPosition);
  if (fd) fd.style.display = "none";
  if (sd) sd.style.display = "none";
  if (ed) ed.style.display = "none";
  if (cd) cd.style.display = "none";
}

function renderMediaFilters() {
  const filterDropdown = document.getElementById("mediaFilterDropdown");
  const sortDropdown = document.getElementById("mediaSortDropdown");
  const filterTrigger = document.getElementById("mediaFilterTrigger");
  const sortTrigger = document.getElementById("mediaSortTrigger");
  if (!filterDropdown || !sortDropdown || !filterTrigger || !sortTrigger) return;

  const filters = mediaState.currentMediaTab === "my_uploads" ? MY_UPLOADS_FILTERS : TO_HANDLE_FILTERS;
  filterDropdown.innerHTML = "";
  filters.forEach((f) => {
    const opt = document.createElement("div");
    opt.style.cssText = `padding:10px 14px;font-size:10px;cursor:pointer;border-bottom:1px solid #f3f4f6;${mediaState.currentMediaFilter === f.id ? "background:#ede9fe;color:#7c3aed;font-weight:600;" : ""}`;
    opt.textContent = f.label;
    opt.dataset.filter = f.id;
    opt.onclick = (e) => {
      e.stopPropagation();
      mediaState.currentMediaFilter = f.id;
      filterTrigger.innerHTML = `Filters: ${f.label} <span style="font-size:10px;">▼</span>`;
      closeMediaDropdowns();
      renderMediaList();
    };
    filterDropdown.appendChild(opt);
  });

  sortDropdown.innerHTML = "";
  SORT_OPTIONS.forEach((s) => {
    const opt = document.createElement("div");
    opt.style.cssText = `padding:10px 14px;font-size:10px;cursor:pointer;border-bottom:1px solid #f3f4f6;${mediaState.currentMediaSort === s.id ? "background:#ede9fe;color:#7c3aed;font-weight:600;" : ""}`;
    opt.textContent = s.label;
    opt.dataset.sort = s.id;
    opt.onclick = (e) => {
      e.stopPropagation();
      mediaState.currentMediaSort = s.id;
      sortTrigger.innerHTML = `Sort: ${s.label} <span style="font-size:10px;">▼</span>`;
      closeMediaDropdowns();
      renderMediaList();
    };
    sortDropdown.appendChild(opt);
  });

  filterTrigger.innerHTML = `Filters: ${getFilterLabel(mediaState.currentMediaFilter)} <span style="font-size:10px;">▼</span>`;
  sortTrigger.innerHTML = `Sort: ${getSortLabel(mediaState.currentMediaSort)} <span style="font-size:10px;">▼</span>`;

  const employeeWrap = document.getElementById("mediaEmployeeFilterWrap");
  const employeeTrigger = document.getElementById("mediaEmployeeFilterTrigger");
  const employeeDropdown = document.getElementById("mediaEmployeeFilterDropdown");
  if (employeeWrap && employeeTrigger && employeeDropdown) {
    employeeWrap.style.setProperty("display", mediaState.currentMediaTab === "to_handle" ? "block" : "none", "important");
    if (mediaState.currentMediaTab === "to_handle") {
      const worksForList = (Array.isArray(mediaState.allWorks) ? mediaState.allWorks : []).filter((w) => w && w.status !== "deleted");
      const staffMap = new Map();
      worksForList.forEach((w) => {
        const id = w.staffId || w.createdByUid || "";
        if (id && !staffMap.has(id)) {
          staffMap.set(id, w.staffName || w.createdByName || id || "—");
        }
      });
      const staffList = [...staffMap.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
      employeeDropdown.innerHTML = "";
      const allOpt = document.createElement("div");
      allOpt.style.cssText = `padding:10px 14px;font-size:10px;cursor:pointer;border-bottom:1px solid #f3f4f6;${mediaState.currentMediaEmployeeFilter === "all" ? "background:#ede9fe;color:#7c3aed;font-weight:600;" : ""}`;
      allOpt.textContent = "All Employees";
      allOpt.dataset.staffId = "all";
      allOpt.onclick = (e) => {
        e.stopPropagation();
        mediaState.currentMediaEmployeeFilter = "all";
        employeeTrigger.innerHTML = `Employee: All Employees <span style="font-size:10px;">▼</span>`;
        closeMediaDropdowns();
        renderMediaList();
      };
      employeeDropdown.appendChild(allOpt);
      staffList.forEach(([staffId, staffName]) => {
        const opt = document.createElement("div");
        opt.style.cssText = `padding:10px 14px;font-size:10px;cursor:pointer;border-bottom:1px solid #f3f4f6;${mediaState.currentMediaEmployeeFilter === staffId ? "background:#ede9fe;color:#7c3aed;font-weight:600;" : ""}`;
        opt.textContent = staffName || staffId || "—";
        opt.dataset.staffId = staffId;
        opt.onclick = (e) => {
          e.stopPropagation();
          mediaState.currentMediaEmployeeFilter = staffId;
          employeeTrigger.innerHTML = `Employee: ${staffName || staffId} <span style="font-size:10px;">▼</span>`;
          closeMediaDropdowns();
          renderMediaList();
        };
        employeeDropdown.appendChild(opt);
      });
      const label = mediaState.currentMediaEmployeeFilter === "all" ? "All Employees" : (staffMap.get(mediaState.currentMediaEmployeeFilter) || mediaState.currentMediaEmployeeFilter || "All Employees");
      employeeTrigger.innerHTML = `Employee: ${label} <span style="font-size:10px;">▼</span>`;
    }
  }

  const categoryWrap = document.getElementById("mediaCategoryFilterWrap");
  const categoryTrigger = document.getElementById("mediaCategoryFilterTrigger");
  const categoryDropdown = document.getElementById("mediaCategoryFilterDropdown");
  if (categoryWrap && categoryTrigger && categoryDropdown) {
    categoryWrap.style.setProperty("display", mediaState.currentMediaTab === "to_handle" ? "block" : "none", "important");
    if (mediaState.currentMediaTab === "to_handle") {
      const activeCategories = (Array.isArray(mediaState.mediaCategories) ? mediaState.mediaCategories : []).filter((c) => c.active !== false).sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
      categoryDropdown.innerHTML = "";
      const allOpt = document.createElement("div");
      allOpt.style.cssText = `padding:10px 14px;font-size:10px;cursor:pointer;border-bottom:1px solid #f3f4f6;${mediaState.currentMediaCategoryFilter === "all" ? "background:#ede9fe;color:#7c3aed;font-weight:600;" : ""}`;
      allOpt.textContent = "All Categories";
      allOpt.dataset.categoryId = "all";
      allOpt.onclick = (e) => {
        e.stopPropagation();
        mediaState.currentMediaCategoryFilter = "all";
        categoryTrigger.innerHTML = `Category: All Categories <span style="font-size:10px;">▼</span>`;
        closeMediaDropdowns();
        renderMediaList();
      };
      categoryDropdown.appendChild(allOpt);
      activeCategories.forEach((c) => {
        const opt = document.createElement("div");
        opt.style.cssText = `padding:10px 14px;font-size:10px;cursor:pointer;border-bottom:1px solid #f3f4f6;${mediaState.currentMediaCategoryFilter === c.id ? "background:#ede9fe;color:#7c3aed;font-weight:600;" : ""}`;
        opt.textContent = c.name || c.id || "—";
        opt.dataset.categoryId = c.id || "";
        opt.onclick = (e) => {
          e.stopPropagation();
          mediaState.currentMediaCategoryFilter = c.id || "all";
          categoryTrigger.innerHTML = `Category: ${c.name || c.id || "—"} <span style="font-size:10px;">▼</span>`;
          closeMediaDropdowns();
          renderMediaList();
        };
        categoryDropdown.appendChild(opt);
      });
      const catLabel = mediaState.currentMediaCategoryFilter === "all"
        ? "All Categories"
        : (activeCategories.find((c) => c.id === mediaState.currentMediaCategoryFilter)?.name || mediaState.currentMediaCategoryFilter || "All Categories");
      categoryTrigger.innerHTML = `Category: ${catLabel} <span style="font-size:10px;">▼</span>`;
    }
  }
}

// =====================
// Card rendering
// =====================

async function enrichWorkWithPreview(work) {
  const cached = work && work._firstMediaUrl != null ? String(work._firstMediaUrl).trim() : "";
  if (cached && /^https?:\/\//i.test(cached)) return work;
  const pre = work && work.previewMediaUrl != null ? String(work.previewMediaUrl).trim() : "";
  if (pre && /^https?:\/\//i.test(pre)) {
    work._firstMediaUrl = pre;
    return work;
  }
  try {
    const url = await resolveWorkCardPreviewUrl(work);
    if (url) work._firstMediaUrl = url;
  } catch (e) {
    console.warn("[Media] enrichWorkWithPreview", work?.id, e);
  }
  return work;
}

function formatDate(ts) {
  if (!ts) return "";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function showMediaMessage(text) {
  const existing = document.getElementById("mediaMessageOverlay");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.id = "mediaMessageOverlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:100030;display:flex;align-items:center;justify-content:center;padding:20px;";
  const box = document.createElement("div");
  box.style.cssText = "background:#fff;border-radius:12px;padding:24px;max-width:360px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,0.2);font-size:10px;color:#374151;line-height:1.5;";
  const msg = document.createElement("div");
  msg.style.marginBottom = "20px";
  msg.textContent = text;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "OK";
  btn.style.cssText = "width:100%;padding:10px 16px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:10px;cursor:pointer;font-weight:500;";
  btn.onclick = () => overlay.remove();
  box.appendChild(msg);
  box.appendChild(btn);
  overlay.appendChild(box);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

function showMediaConfirm(text, onConfirm, confirmLabel = "Delete My Work") {
  const existing = document.getElementById("mediaConfirmOverlay");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.id = "mediaConfirmOverlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:100030;display:flex;align-items:center;justify-content:center;padding:20px;";
  const box = document.createElement("div");
  box.style.cssText = "background:#fff;border-radius:12px;padding:24px;max-width:360px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,0.2);font-size:10px;color:#374151;line-height:1.5;";
  const msg = document.createElement("div");
  msg.style.marginBottom = "20px";
  msg.textContent = text;
  const btns = document.createElement("div");
  btns.style.cssText = "display:flex;gap:10px;justify-content:flex-end;";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.cssText = "padding:8px 16px;background:#f3f4f6;color:#374151;border:1px solid #e5e7eb;border-radius:8px;font-size:10px;cursor:pointer;";
  cancelBtn.onclick = () => overlay.remove();
  const okBtn = document.createElement("button");
  okBtn.type = "button";
  okBtn.textContent = confirmLabel;
  okBtn.style.cssText = "padding:8px 16px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-size:10px;cursor:pointer;font-weight:500;";
  okBtn.onclick = () => { overlay.remove(); onConfirm(); };
  btns.appendChild(cancelBtn);
  btns.appendChild(okBtn);
  box.appendChild(msg);
  box.appendChild(btns);
  overlay.appendChild(box);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

/** Self Delete eligibility: own work, <24h, postedCount===0, !featured, status==="active" */
function isSelfDeleteEligible(work) {
  const uid = auth.currentUser?.uid;
  if (!uid || !work) return false;
  const isOwner = work.createdByUid === uid || work.staffId === mediaState.currentUserProfile?.staffId;
  if (!isOwner) return false;
  if ((work.postedCount || 0) > 0) return false;
  if (work.featured === true) return false;
  if (work.status !== "active") return false;
  const createdAt = work.createdAt?.toDate ? work.createdAt.toDate() : (work.createdAt ? new Date(work.createdAt) : null);
  if (!createdAt) return false;
  const hoursSince = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
  return hoursSince < 24;
}

/** Technician or Manager (not Admin) – eligible for Self Delete button */
function canShowSelfDeleteButton() {
  const r = (mediaState.currentUserProfile?.createdByRole || "").toLowerCase();
  return r === "technician" || r === "manager";
}

/** "+ Upload Work" only on My Uploads — not on To handle (manager queue). */
function updateMediaUploadWorkButtonVisibility() {
  const uploadBtn = document.getElementById("mediaUploadWorkBtn");
  if (uploadBtn) {
    const show = mediaState.currentMediaTab === "my_uploads";
    uploadBtn.style.setProperty("display", show ? "inline-flex" : "none", "important");
  }
}

/** Apply tab visibility – Everyone sees My Uploads; handlers also see To Handle. */
function applyToHandleVisibility() {
  const profile = mediaState.currentUserProfile;
  const canHandle = canHandleMediaWork();
  // Keep To handle visible until we know this user cannot receive media.
  const showToHandle = canHandle || !profile;
  if (!showToHandle && mediaState.currentMediaTab === "to_handle") {
    mediaState.currentMediaTab = "my_uploads";
  }
  const tabsWrap = document.getElementById("mediaTabsWrap");
  if (tabsWrap) tabsWrap.style.setProperty("display", "flex", "important");
  const toHandleBtn = document.getElementById("mediaTabToHandle");
  if (toHandleBtn) {
    toHandleBtn.classList.toggle("media-tab--hidden", !showToHandle);
    toHandleBtn.style.setProperty("display", showToHandle ? "flex" : "none", "important");
    if (showToHandle) toHandleBtn.style.borderLeft = "none";
  }
  const myUploadsBtn = document.getElementById("mediaTabMyUploads");
  if (myUploadsBtn) myUploadsBtn.style.borderRadius = showToHandle ? "8px 0 0 8px" : "8px";
  updateMediaUploadWorkButtonVisibility();
  const mediaScreenEl = document.getElementById("mediaScreen");
  if (mediaScreenEl) mediaScreenEl.setAttribute("data-media-tab", mediaState.currentMediaTab);
}

/**
 * Thumbnail for grid: stored thumbnail first (uploads since the thumbnail change),
 * then the enriched cache / denormalized preview on the work doc. No subcollection read.
 */
function syncCardPreviewUrlFromDoc(work) {
  if (!work) return "";
  const candidates = [work.previewThumbUrl, work._firstMediaUrl, work.previewMediaUrl];
  for (const c of candidates) {
    const u = safeHttpUrl(c);
    if (u) return u;
  }
  return "";
}

function getStatusLabels(work) {
  const labels = [];
  if (work.status === "archived") labels.push("Archived");
  else if (work.status === "deleted") labels.push("Deleted");
  else labels.push("Active");
  if (work.featured) labels.push("Featured");
  if (work.duplicate) labels.push("Duplicate");
  if ((work.postedCount || 0) > 0) labels.push(`Posted ${work.postedCount}x`);
  return labels;
}

const MEDIA_LIST_CAP = 48;
const MEDIA_THUMB_PLACEHOLDER =
  '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
let _mediaListRenderTimer = 0;
let _mediaThumbObserver = null;

function fillMediaThumb(wrap) {
  if (!wrap) return;
  const url = wrap.getAttribute("data-thumb-url") || "";
  wrap.removeAttribute("data-thumb-url");
  paintMediaInto(wrap, url, { px: MEDIA_THUMB_PX });
}

function observeMediaThumb(wrap) {
  if (!wrap) return;
  if (typeof IntersectionObserver === "undefined") {
    fillMediaThumb(wrap);
    return;
  }
  if (!_mediaThumbObserver) {
    _mediaThumbObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        _mediaThumbObserver.unobserve(entry.target);
        fillMediaThumb(entry.target);
      });
    }, { rootMargin: "180px 0px", threshold: 0.01 });
  }
  _mediaThumbObserver.observe(wrap);
}

function renderMediaList() {
  if (_mediaListRenderTimer) clearTimeout(_mediaListRenderTimer);
  _mediaListRenderTimer = setTimeout(() => {
    _mediaListRenderTimer = 0;
    renderMediaListNow();
  }, 50);
}

function applyBootWorksToState() {
  const boot = typeof window !== "undefined" && Array.isArray(window.__ffMediaBootWorks)
    ? window.__ffMediaBootWorks
    : null;
  if (!boot || !boot.length) return;
  const alive = boot.filter((w) => w && w.status !== "deleted");
  if (!alive.length) return;
  if (!(mediaState.allWorks || []).length) {
    mediaState.allWorks = alive;
  }
  mediaState.mediaAllWorksHydrated = true;
  if (!(mediaState.userWorks || []).length) {
    const staffId = String(
      mediaState.currentUserProfile?.staffId
      || (typeof window !== "undefined" ? window.__ff_authedStaffId : "")
      || ""
    ).trim();
    const uid = String(
      mediaState.currentUserProfile?.uid
      || auth.currentUser?.uid
      || ""
    ).trim();
    mediaState.userWorks = alive.filter((w) => {
      const ws = String(w.staffId || "").trim();
      const wu = String(w.createdByUid || "").trim();
      return (staffId && ws === staffId) || (uid && wu === uid);
    });
  }
  mediaState.mediaMyWorksHydrated = true;
}

function renderMediaListNow() {
  const list = document.getElementById("mediaList");
  const empty = document.getElementById("mediaListEmpty");
  const loading = document.getElementById("mediaListLoading");
  if (!list || !empty || !loading) return;

  applyBootWorksToState();

  const awaitingMy =
    mediaState.currentMediaTab === "my_uploads" && auth.currentUser && !mediaState.mediaMyWorksHydrated;
  const awaitingAll =
    mediaState.currentMediaTab === "to_handle" &&
    auth.currentUser &&
    canHandleMediaWork() &&
    !mediaState.mediaAllWorksHydrated;
  if (awaitingMy || awaitingAll) {
    loading.style.display = "block";
    list.style.display = "none";
    empty.style.display = "none";
    return;
  }

  const worksRaw = mediaState.currentMediaTab === "my_uploads" ? mediaState.userWorks : mediaState.allWorks;
  const works = Array.isArray(worksRaw) ? worksRaw : [];
  const filtered = works.filter((w) => w && w.status !== "deleted");
  const filteredByFilter = applyFilter(filtered, mediaState.currentMediaFilter);
  const filteredByEmployee = mediaState.currentMediaTab === "to_handle"
    ? applyEmployeeFilter(filteredByFilter, mediaState.currentMediaEmployeeFilter)
    : filteredByFilter;
  const filteredByCategory = applyCategoryFilter(filteredByEmployee, mediaState.currentMediaCategoryFilter);
  const sorted = applySort(filteredByCategory, mediaState.currentMediaSort);

  if (sorted.length === 0) {
    loading.style.display = "none";
    list.style.display = "none";
    list.setAttribute("data-ff-media-real", "1");
    empty.style.display = "block";
    const title = document.getElementById("mediaEmptyTitle");
    const sub = document.getElementById("mediaEmptySubtitle");
    const emptyBtn = document.getElementById("mediaEmptyUploadBtn");
    if (mediaState.currentMediaTab === "to_handle") {
      if (title) title.textContent = "No works in this view";
      if (sub) sub.textContent = "Works from the team will appear here.";
      if (emptyBtn) emptyBtn.style.display = "none";
    } else {
      if (title) title.textContent = "No works yet";
      if (sub) sub.textContent = "Upload your first work to get started";
      if (emptyBtn) {
        emptyBtn.style.display = "";
        emptyBtn.onclick = openUploadModal;
      }
    }
    updateMediaUploadWorkButtonVisibility();
    return;
  }

  loading.style.display = "none";
  empty.style.display = "none";
  list.style.display = "grid";
  list.innerHTML = "";
  list.setAttribute("data-ff-media-real", "1");

  const visible = sorted.slice(0, MEDIA_LIST_CAP);
  visible.forEach((work) => {
    const card = document.createElement("div");
    card.className = "media-work-card";
    card.setAttribute("data-work-id", String(work.id || ""));
    card.style.cssText = "background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;cursor:pointer;transition:box-shadow 0.2s;";

    const previewUrl = syncCardPreviewUrlFromDoc(work);
    const thumb = document.createElement("div");
    thumb.style.cssText = "aspect-ratio:1;background:#f3f4f6;overflow:hidden;display:flex;align-items:center;justify-content:center;color:#9ca3af;";
    // Videos are 20-70 MB each — never pull one just to draw a card.
    if (previewUrl && !isVideoMedia({ mediaUrl: previewUrl, mediaType: work.mediaType })) {
      thumb.setAttribute("data-thumb-url", previewUrl);
      observeMediaThumb(thumb);
    } else {
      thumb.innerHTML = MEDIA_THUMB_PLACEHOLDER;
    }
    card.appendChild(thumb);

    const meta = document.createElement("div");
    meta.style.cssText = "padding:6px;font-size:9px;";

    const title = document.createElement("div");
    title.style.cssText = "font-size:9px;font-weight:600;color:#111;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    title.textContent = (Array.isArray(work.categoryNames) ? work.categoryNames.join(", ") : work.categoryName || work.serviceType || "Work").slice(0, 30);
    meta.appendChild(title);

    if (work.caption) {
      const cap = document.createElement("div");
      cap.style.cssText = "font-size:9px;color:#6b7280;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      cap.textContent = String(work.caption).slice(0, 25);
      meta.appendChild(cap);
    }

    if (mediaState.currentMediaTab === "to_handle") {
      const by = document.createElement("div");
      by.style.cssText = "font-size:9px;color:#6b7280;margin-top:2px;";
      by.textContent = `by ${work.staffName || "—"}`;
      meta.appendChild(by);
    }

    const dateEl = document.createElement("div");
    dateEl.style.cssText = "font-size:9px;color:#9ca3af;margin-top:2px;";
    dateEl.textContent = formatDate(work.createdAt);
    meta.appendChild(dateEl);

    if (mediaState.currentMediaTab === "to_handle" && (work.postedCount || 0) > 0) {
      const posted = document.createElement("div");
      posted.style.cssText = "font-size:9px;color:#166534;margin-top:1px;";
      posted.textContent = `Posted ${work.postedCount}x`;
      meta.appendChild(posted);
    }

    const labels = getStatusLabels(work);
    if (labels.length) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;flex-wrap:wrap;gap:2px;margin-top:4px;";
      labels.forEach((l) => {
        const span = document.createElement("span");
        span.style.cssText = "font-size:9px;padding:1px 4px;background:#e5e7eb;border-radius:3px;color:#6b7280;";
        span.textContent = l;
        row.appendChild(span);
      });
      meta.appendChild(row);
    }

    card.appendChild(meta);
    list.appendChild(card);
  });

  if (sorted.length > MEDIA_LIST_CAP) {
    const more = document.createElement("div");
    more.style.cssText = "grid-column:1/-1;font-size:10px;color:#6b7280;padding:8px 4px;text-align:center;";
    more.textContent = `Showing the latest ${MEDIA_LIST_CAP} works`;
    list.appendChild(more);
  }
  updateMediaUploadWorkButtonVisibility();
}

export {
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
};
