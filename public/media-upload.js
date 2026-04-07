/**
 * Media Module – MY UPLOADS / TO HANDLE tabs, Upload Work modal, Work Details, Mark as Posted.
 * Connects to media-cloud.js.
 */

import { getDoc, getDocs, doc, collection, setDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth } from "./app.js?v=20260412_storage_bucket_explicit";
import {
  createWorkWithMedia,
  addMediaToExistingWork,
  subscribeContentWorks,
  getContentWork,
  getMediaItems,
  getPostedHistory,
  addPostedHistory,
  updateContentWork,
  archiveContentWork,
  deleteContentWork,
  deleteMediaItem,
  deleteAllMediaFromWork,
  selfDeleteContentWork,
  getMediaCategories,
  subscribeMediaCategories,
  createMediaCategory,
  updateMediaCategory,
} from "./media-cloud.js?v=20260402_firebase_sdk_align";

let currentUserProfile = null;
let userWorks = [];
let allWorks = [];
let unsubMyWorks = null;
let unsubAllWorks = null;
let currentMediaTab = "my_uploads";
let selectedWorkId = null;
let currentMediaFilter = "all";
let currentMediaSort = "newest";
let currentMediaEmployeeFilter = "all"; // staffId or "all"; only used in TO HANDLE
let currentMediaCategoryFilter = "all"; // categoryId or "all"; filter by category
let mediaCategories = [];
let unsubMediaCategories = null;

/** Same defaults as Staff → Permissions → Media → "To handle" in index.html */
function legacyMediaHandleFromStaffDoc(st) {
  if (!st) return false;
  if (st.isAdmin === true || st.isManager === true) return true;
  const r = String(st.role || "").toLowerCase();
  return (
    r === "manager" ||
    r === "admin" ||
    r === "owner" ||
    r === "front_desk" ||
    r === "assistant_manager"
  );
}

/** Same rules as Staff → Permissions → Media → "To handle" (index.html getValue) + users.role if no staff doc */
function computeMediaHandleAllowed(staffData, roleLower) {
  const p = staffData?.permissions;
  if (p && typeof p === "object" && Object.prototype.hasOwnProperty.call(p, "media_handle")) {
    const v = p.media_handle;
    return v === true || v === "true" || v === 1;
  }
  if (legacyMediaHandleFromStaffDoc(staffData)) return true;
  return ["manager", "admin", "owner"].includes(String(roleLower || "").toLowerCase());
}

/**
 * Staff docs are keyed by salon staff id, not always Firebase uid. Match app.js / PIN: staffId, __ff_authedStaffId, firebaseUid, email.
 */
async function waitForSalonId(maxMs = 3500) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const sid = typeof window !== "undefined" && window.currentSalonId;
    if (sid) return sid;
    await new Promise((r) => setTimeout(r, 90));
  }
  return typeof window !== "undefined" ? window.currentSalonId : null;
}

async function resolveSalonStaffDoc(salonId, user, userData) {
  if (!salonId) {
    return { data: null, docId: userData?.staffId || user.uid };
  }
  const tryIds = [];
  try {
    const memSnap = await getDoc(doc(db, `salons/${salonId}/members`, user.uid));
    if (memSnap.exists()) {
      const mid = memSnap.data()?.staffId;
      if (mid && typeof mid === "string") tryIds.push(mid);
    }
  } catch (_) {}
  if (userData?.staffId) tryIds.push(userData.staffId);
  if (typeof window !== "undefined" && window.__ff_authedStaffId) tryIds.push(window.__ff_authedStaffId);
  try {
    const ls = typeof localStorage !== "undefined" ? localStorage.getItem("ff_authedStaffId_v1") : "";
    if (ls) tryIds.push(ls);
  } catch (_) {}
  tryIds.push(user.uid);
  const seen = new Set();
  for (const id of tryIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    try {
      const staffSnap = await getDoc(doc(db, `salons/${salonId}/staff`, id));
      if (staffSnap.exists()) {
        return { data: staffSnap.data(), docId: staffSnap.id };
      }
    } catch (_) {}
  }
  try {
    const staffColl = await getDocs(collection(db, `salons/${salonId}/staff`));
    const userEmail = (user.email || "").toLowerCase();
    for (const docSnap of staffColl.docs) {
      const s = docSnap.data();
      if (s.firebaseUid && s.firebaseUid === user.uid) {
        return { data: s, docId: docSnap.id };
      }
      if (s.uid && s.uid === user.uid) {
        return { data: s, docId: docSnap.id };
      }
      if (userEmail && (s.email || "").toLowerCase() === userEmail) {
        return { data: s, docId: docSnap.id };
      }
    }
  } catch (_) {}
  return { data: null, docId: userData?.staffId || user.uid };
}

/** When direct paths miss, one full scan — must attach full doc for permissions.media_handle */
async function enrichStaffDocIfMissing(salonId, user, userData, existing) {
  if (existing || !salonId) return null;
  try {
    const staffColl = await getDocs(collection(db, `salons/${salonId}/staff`));
    const userEmail = (user.email || "").toLowerCase();
    for (const docSnap of staffColl.docs) {
      const s = docSnap.data();
      if (s.firebaseUid && s.firebaseUid === user.uid) return { data: s, docId: docSnap.id };
      if (s.uid && s.uid === user.uid) return { data: s, docId: docSnap.id };
      if (userEmail && (s.email || "").toLowerCase() === userEmail) return { data: s, docId: docSnap.id };
      if (userData?.staffId && (docSnap.id === userData.staffId || s.staffId === userData.staffId)) {
        return { data: s, docId: docSnap.id };
      }
    }
  } catch (_) {}
  return null;
}

async function loadUserProfile() {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    let d;
    if (snap.exists()) {
      d = snap.data();
    } else {
      console.warn("[Media] users/" + user.uid + " missing — using salon/globals (PIN / partial account)");
      const gRole = typeof window !== "undefined" ? window.__ff_user_role : "";
      d = {
        salonId: typeof window !== "undefined" ? window.currentSalonId : null,
        role: gRole != null && String(gRole).trim() !== "" ? String(gRole).toLowerCase() : "technician",
        staffId:
          (typeof window !== "undefined" && window.__ff_authedStaffId) ||
          (typeof localStorage !== "undefined" ? localStorage.getItem("ff_authedStaffId_v1") : null) ||
          user.uid,
        name: user.displayName || user.email || "User",
      };
    }

    let salonId = d.salonId || (typeof window !== "undefined" ? window.currentSalonId : null);
    if (!salonId) {
      salonId = await waitForSalonId();
    }
    let role = (d.role || "technician").toLowerCase();

    let { data: staffDocData, docId: staffId } = await resolveSalonStaffDoc(salonId, user, d);
    const enriched = await enrichStaffDocIfMissing(salonId, user, d, staffDocData);
    if (enriched) {
      staffDocData = enriched.data;
      staffId = enriched.docId;
    }

    if (staffDocData) {
      if (staffDocData.isAdmin === true) role = "admin";
      else if (staffDocData.isManager === true) role = "manager";
      else {
        const sr = String(staffDocData.role || "").toLowerCase();
        if (["manager", "admin", "owner"].includes(sr)) role = sr;
      }
    }

    if (salonId && ["technician", ""].includes(role)) {
      try {
        const memberSnap = await getDoc(doc(db, `salons/${salonId}/members`, user.uid));
        if (memberSnap.exists()) {
          const mr = ((memberSnap.data().role || "") + "").toLowerCase();
          if (["manager", "admin", "owner"].includes(mr)) role = mr;
        }
      } catch (_) {}
    }

    const mediaHandleAllowed = computeMediaHandleAllowed(staffDocData, role);

    currentUserProfile = {
      uid: user.uid,
      staffId,
      staffName: d.name || d.displayName || user.email || "User",
      createdByRole: role,
      salonId,
      mediaHandleAllowed,
    };
    if (salonId) {
      setDoc(doc(db, `salons/${salonId}/members`, user.uid), {
        name: currentUserProfile.staffName,
        role: currentUserProfile.createdByRole,
      }, { merge: true }).catch(() => {});
    }
    return currentUserProfile;
  } catch (e) {
    console.warn("[Media] loadUserProfile failed", e);
  }
  return null;
}

function canHandleMediaWork() {
  if (currentUserProfile?.mediaHandleAllowed === true) return true;
  if (currentUserProfile && currentUserProfile.mediaHandleAllowed === false) return false;
  const wr =
    typeof window !== "undefined" && window.__ff_user_role
      ? String(window.__ff_user_role).toLowerCase().trim()
      : "";
  if (["manager", "admin", "owner"].includes(wr)) return true;
  return false;
}

function isAdmin() {
  const r = (currentUserProfile?.createdByRole || "").toLowerCase();
  return ["admin", "owner"].includes(r);
}

// =====================
// Tab switching
// =====================

function setMediaTab(tab) {
  currentMediaTab = tab;
  currentMediaFilter = "all";
  currentMediaEmployeeFilter = "all";
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

const MY_UPLOADS_FILTERS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "posted", label: "Posted" },
  { id: "featured", label: "Featured" },
  { id: "archived", label: "Archived" },
];

const TO_HANDLE_FILTERS = [
  { id: "all", label: "All" },
  { id: "not_posted", label: "Not Posted" },
  { id: "posted", label: "Posted" },
  { id: "featured", label: "Featured" },
  { id: "archived", label: "Archived" },
  { id: "duplicate", label: "Duplicate" },
];

const SORT_OPTIONS = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "most_posted", label: "Most Posted" },
  { id: "featured_first", label: "Featured First" },
];

function applyEmployeeFilter(works, staffIdOrAll) {
  if (staffIdOrAll === "all" || !staffIdOrAll) return works;
  return works.filter((w) => {
    const id = w.staffId || w.createdByUid;
    return id === staffIdOrAll;
  });
}

function applyCategoryFilter(works, categoryIdOrAll) {
  if (categoryIdOrAll === "all" || !categoryIdOrAll) return works;
  const category = mediaCategories.find((c) => c.id === categoryIdOrAll);
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
  if (currentMediaTab === "my_uploads") {
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

function closeMediaDropdowns() {
  const fd = document.getElementById("mediaFilterDropdown");
  const sd = document.getElementById("mediaSortDropdown");
  const ed = document.getElementById("mediaEmployeeFilterDropdown");
  const cd = document.getElementById("mediaCategoryFilterDropdown");
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

  const filters = currentMediaTab === "my_uploads" ? MY_UPLOADS_FILTERS : TO_HANDLE_FILTERS;
  filterDropdown.innerHTML = "";
  filters.forEach((f) => {
    const opt = document.createElement("div");
    opt.style.cssText = `padding:10px 14px;font-size:10px;cursor:pointer;border-bottom:1px solid #f3f4f6;${currentMediaFilter === f.id ? "background:#ede9fe;color:#7c3aed;font-weight:600;" : ""}`;
    opt.textContent = f.label;
    opt.dataset.filter = f.id;
    opt.onclick = (e) => {
      e.stopPropagation();
      currentMediaFilter = f.id;
      filterTrigger.innerHTML = `Filters: ${f.label} <span style="font-size:10px;">▼</span>`;
      closeMediaDropdowns();
      renderMediaList();
    };
    filterDropdown.appendChild(opt);
  });

  sortDropdown.innerHTML = "";
  SORT_OPTIONS.forEach((s) => {
    const opt = document.createElement("div");
    opt.style.cssText = `padding:10px 14px;font-size:10px;cursor:pointer;border-bottom:1px solid #f3f4f6;${currentMediaSort === s.id ? "background:#ede9fe;color:#7c3aed;font-weight:600;" : ""}`;
    opt.textContent = s.label;
    opt.dataset.sort = s.id;
    opt.onclick = (e) => {
      e.stopPropagation();
      currentMediaSort = s.id;
      sortTrigger.innerHTML = `Sort: ${s.label} <span style="font-size:10px;">▼</span>`;
      closeMediaDropdowns();
      renderMediaList();
    };
    sortDropdown.appendChild(opt);
  });

  filterTrigger.innerHTML = `Filters: ${getFilterLabel(currentMediaFilter)} <span style="font-size:10px;">▼</span>`;
  sortTrigger.innerHTML = `Sort: ${getSortLabel(currentMediaSort)} <span style="font-size:10px;">▼</span>`;

  const employeeWrap = document.getElementById("mediaEmployeeFilterWrap");
  const employeeTrigger = document.getElementById("mediaEmployeeFilterTrigger");
  const employeeDropdown = document.getElementById("mediaEmployeeFilterDropdown");
  if (employeeWrap && employeeTrigger && employeeDropdown) {
    employeeWrap.style.setProperty("display", currentMediaTab === "to_handle" ? "block" : "none", "important");
    if (currentMediaTab === "to_handle") {
      const worksForList = allWorks.filter((w) => w.status !== "deleted");
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
      allOpt.style.cssText = `padding:10px 14px;font-size:10px;cursor:pointer;border-bottom:1px solid #f3f4f6;${currentMediaEmployeeFilter === "all" ? "background:#ede9fe;color:#7c3aed;font-weight:600;" : ""}`;
      allOpt.textContent = "All Employees";
      allOpt.dataset.staffId = "all";
      allOpt.onclick = (e) => {
        e.stopPropagation();
        currentMediaEmployeeFilter = "all";
        employeeTrigger.innerHTML = `Employee: All Employees <span style="font-size:10px;">▼</span>`;
        closeMediaDropdowns();
        renderMediaList();
      };
      employeeDropdown.appendChild(allOpt);
      staffList.forEach(([staffId, staffName]) => {
        const opt = document.createElement("div");
        opt.style.cssText = `padding:10px 14px;font-size:10px;cursor:pointer;border-bottom:1px solid #f3f4f6;${currentMediaEmployeeFilter === staffId ? "background:#ede9fe;color:#7c3aed;font-weight:600;" : ""}`;
        opt.textContent = staffName || staffId || "—";
        opt.dataset.staffId = staffId;
        opt.onclick = (e) => {
          e.stopPropagation();
          currentMediaEmployeeFilter = staffId;
          employeeTrigger.innerHTML = `Employee: ${staffName || staffId} <span style="font-size:10px;">▼</span>`;
          closeMediaDropdowns();
          renderMediaList();
        };
        employeeDropdown.appendChild(opt);
      });
      const label = currentMediaEmployeeFilter === "all" ? "All Employees" : (staffMap.get(currentMediaEmployeeFilter) || currentMediaEmployeeFilter || "All Employees");
      employeeTrigger.innerHTML = `Employee: ${label} <span style="font-size:10px;">▼</span>`;
    }
  }

  const categoryWrap = document.getElementById("mediaCategoryFilterWrap");
  const categoryTrigger = document.getElementById("mediaCategoryFilterTrigger");
  const categoryDropdown = document.getElementById("mediaCategoryFilterDropdown");
  if (categoryWrap && categoryTrigger && categoryDropdown) {
    categoryWrap.style.setProperty("display", currentMediaTab === "to_handle" ? "block" : "none", "important");
    if (currentMediaTab === "to_handle") {
      const activeCategories = mediaCategories.filter((c) => c.active !== false).sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
      categoryDropdown.innerHTML = "";
      const allOpt = document.createElement("div");
      allOpt.style.cssText = `padding:10px 14px;font-size:10px;cursor:pointer;border-bottom:1px solid #f3f4f6;${currentMediaCategoryFilter === "all" ? "background:#ede9fe;color:#7c3aed;font-weight:600;" : ""}`;
      allOpt.textContent = "All Categories";
      allOpt.dataset.categoryId = "all";
      allOpt.onclick = (e) => {
        e.stopPropagation();
        currentMediaCategoryFilter = "all";
        categoryTrigger.innerHTML = `Category: All Categories <span style="font-size:10px;">▼</span>`;
        closeMediaDropdowns();
        renderMediaList();
      };
      categoryDropdown.appendChild(allOpt);
      activeCategories.forEach((c) => {
        const opt = document.createElement("div");
        opt.style.cssText = `padding:10px 14px;font-size:10px;cursor:pointer;border-bottom:1px solid #f3f4f6;${currentMediaCategoryFilter === c.id ? "background:#ede9fe;color:#7c3aed;font-weight:600;" : ""}`;
        opt.textContent = c.name || c.id || "—";
        opt.dataset.categoryId = c.id || "";
        opt.onclick = (e) => {
          e.stopPropagation();
          currentMediaCategoryFilter = c.id || "all";
          categoryTrigger.innerHTML = `Category: ${c.name || c.id || "—"} <span style="font-size:10px;">▼</span>`;
          closeMediaDropdowns();
          renderMediaList();
        };
        categoryDropdown.appendChild(opt);
      });
      const catLabel = currentMediaCategoryFilter === "all"
        ? "All Categories"
        : (activeCategories.find((c) => c.id === currentMediaCategoryFilter)?.name || currentMediaCategoryFilter || "All Categories");
      categoryTrigger.innerHTML = `Category: ${catLabel} <span style="font-size:10px;">▼</span>`;
    }
  }
}

// =====================
// Card rendering
// =====================

function getPreviewUrl(work) {
  return work._firstMediaUrl || null;
}

async function enrichWorkWithPreview(work) {
  if (work._firstMediaUrl) return work;
  try {
    const items = await getMediaItems(work.id);
    const first = items[0];
    if (first?.mediaUrl) work._firstMediaUrl = first.mediaUrl;
  } catch (_) {}
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
  const isOwner = work.createdByUid === uid || work.staffId === currentUserProfile?.staffId;
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
  const r = (currentUserProfile?.createdByRole || "").toLowerCase();
  return r === "technician" || r === "manager";
}

/** "+ Upload Work" only on My Uploads — not on To handle (manager queue). */
function updateMediaUploadWorkButtonVisibility() {
  const uploadBtn = document.getElementById("mediaUploadWorkBtn");
  if (uploadBtn) {
    const show = currentMediaTab === "my_uploads";
    uploadBtn.style.setProperty("display", show ? "inline-flex" : "none", "important");
  }
}

/** Apply tab visibility – Everyone sees My Uploads; Manager/Admin/Owner also see To Handle. */
function applyToHandleVisibility() {
  const showToHandle = canHandleMediaWork();
  if (!showToHandle) currentMediaTab = "my_uploads";
  const tabsWrap = document.getElementById("mediaTabsWrap");
  if (tabsWrap) {
    tabsWrap.style.setProperty("display", "flex", "important");
  }
  const toHandleBtn = document.getElementById("mediaTabToHandle");
  if (toHandleBtn) {
    toHandleBtn.style.setProperty("display", showToHandle ? "flex" : "none", "important");
    if (showToHandle) toHandleBtn.style.borderLeft = "none";
  }
  const myUploadsBtn = document.getElementById("mediaTabMyUploads");
  if (myUploadsBtn) myUploadsBtn.style.borderRadius = showToHandle ? "8px 0 0 8px" : "8px";
  updateMediaUploadWorkButtonVisibility();
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

function renderMediaList() {
  const list = document.getElementById("mediaList");
  const empty = document.getElementById("mediaListEmpty");
  const loading = document.getElementById("mediaListLoading");
  if (!list || !empty) return;

  const works = currentMediaTab === "my_uploads" ? userWorks : allWorks;
  const filtered = works.filter((w) => w.status !== "deleted");
  const filteredByFilter = applyFilter(filtered, currentMediaFilter);
  const filteredByEmployee = currentMediaTab === "to_handle"
    ? applyEmployeeFilter(filteredByFilter, currentMediaEmployeeFilter)
    : filteredByFilter;
  const filteredByCategory = applyCategoryFilter(filteredByEmployee, currentMediaCategoryFilter);
  const sorted = applySort(filteredByCategory, currentMediaSort);

  if (works.length === 0 && currentMediaTab === "my_uploads") {
    loading.style.display = "none";
    list.style.display = "none";
    empty.style.display = "block";
    const emptyBtn = document.getElementById("mediaEmptyUploadBtn");
    if (emptyBtn) emptyBtn.onclick = openUploadModal;
    updateMediaUploadWorkButtonVisibility();
    return;
  }

  loading.style.display = "none";
  empty.style.display = "none";
  list.style.display = "grid";
  list.innerHTML = "";

  sorted.forEach((work) => {
    const card = document.createElement("div");
    card.className = "media-work-card";
    card.style.cssText = "background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;cursor:pointer;transition:box-shadow 0.2s;";
    card.onclick = () => openWorkDetails(work.id);

    const previewUrl = work._firstMediaUrl || "";
    const preview = previewUrl
      ? `<div style="aspect-ratio:1;background:#f3f4f6;overflow:hidden;"><img src="${previewUrl}" alt="" style="width:100%;height:100%;object-fit:cover;"></div>`
      : `<div style="aspect-ratio:1;background:#f3f4f6;display:flex;align-items:center;justify-content:center;color:#9ca3af;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        </div>`;

    const labels = getStatusLabels(work);
    const labelsHtml = labels.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:2px;margin-top:4px;">${labels.map((l) => `<span style="font-size:9px;padding:1px 4px;background:#e5e7eb;border-radius:3px;color:#6b7280;">${l}</span>`).join("")}</div>`
      : "";

    const byLine = currentMediaTab === "to_handle" ? `<div style="font-size:9px;color:#6b7280;margin-top:2px;">by ${work.staffName || "—"}</div>` : "";

    card.innerHTML = `
      ${preview}
      <div style="padding:6px;font-size:9px;">
        <div style="font-size:9px;font-weight:600;color:#111;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${(Array.isArray(work.categoryNames) ? work.categoryNames.join(", ") : work.categoryName || work.serviceType || "Work").slice(0, 30)}</div>
        ${work.caption ? `<div style="font-size:9px;color:#6b7280;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${String(work.caption).slice(0, 25)}</div>` : ""}
        ${byLine}
        <div style="font-size:9px;color:#9ca3af;margin-top:2px;">${formatDate(work.createdAt)}</div>
        ${currentMediaTab === "to_handle" && (work.postedCount || 0) > 0 ? `<div style="font-size:9px;color:#166534;margin-top:1px;">Posted ${work.postedCount}x</div>` : ""}
        ${labelsHtml}
      </div>
    `;
    list.appendChild(card);
  });
  updateMediaUploadWorkButtonVisibility();
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

function toggleFileInputs() {
  const mediaType = getMediaType();
  const single = document.getElementById("uploadWorkFileSingle");
  const beforeAfter = document.getElementById("uploadWorkFileBeforeAfter");
  const fileInput = document.getElementById("uploadWorkFileInput");
  if (!single || !beforeAfter || !fileInput) return;
  if (mediaType === "before_after") {
    single.style.display = "none";
    beforeAfter.style.display = "block";
    fileInput.accept = "";
  } else {
    single.style.display = "block";
    beforeAfter.style.display = "none";
    fileInput.accept = mediaType === "photo" ? "image/*" : "video/*";
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
  const active = mediaCategories.filter((c) => c.active !== false).sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
  dropdown.innerHTML = "";
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
  if (!dropdown) return;
  const isOpen = dropdown.style.display === "block";
  dropdown.style.display = isOpen ? "none" : "block";
}

function closeUploadCategoryDropdown() {
  const dropdown = document.getElementById("uploadWorkCategoryDropdown");
  if (dropdown) dropdown.style.display = "none";
}

function populateWorksDropdown() {
  const select = document.getElementById("uploadWorkExistingSelect");
  if (!select) return;
  select.innerHTML = '<option value="">-- Choose a work --</option>';
  userWorks
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
    const file = document.getElementById("uploadWorkFileInput")?.files?.[0];
    if (!file) {
      showUploadMessage(mediaType === "photo" ? "Please choose an image." : "Please choose a video.", true);
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
    const activeCategories = mediaCategories.filter((c) => c.active !== false);
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

async function doUpload() {
  if (auth.currentUser && !currentUserProfile) {
    try {
      await loadUserProfile();
    } catch (_) {}
  }
  if (!currentUserProfile) {
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
      let files;
      if (mediaType === "before_after") {
        files = [
          document.getElementById("uploadWorkFileBefore")?.files?.[0],
          document.getElementById("uploadWorkFileAfter")?.files?.[0],
        ].filter(Boolean);
      } else {
        files = document.getElementById("uploadWorkFileInput")?.files?.[0];
      }
      const { workId, mediaIds } = await createWorkWithMedia(
        {
          staffId: currentUserProfile.staffId,
          staffName: currentUserProfile.staffName,
          createdByRole: currentUserProfile.createdByRole,
          categoryIds,
          categoryNames,
          serviceType: categoryNames[0] || "", // backward compat
          caption,
        },
        files,
        mediaType
      );
      showUploadMessage(`Success! Work created. ${mediaIds.length} media item(s) added.`, false);
      userWorks.unshift({ id: workId, categoryIds, categoryNames, categoryId: categoryIds[0], categoryName: categoryNames[0], serviceType: categoryNames[0], caption, status: "active" });
      populateWorksDropdown();
      document.getElementById("uploadWorkFileInput").value = "";
      document.getElementById("uploadWorkFileBefore").value = "";
      document.getElementById("uploadWorkFileAfter").value = "";
      setTimeout(() => closeUploadModal(), 1500);
    } else {
      const workId = document.getElementById("uploadWorkExistingSelect")?.value?.trim();
      let files;
      if (mediaType === "before_after") {
        files = [
          document.getElementById("uploadWorkFileBefore")?.files?.[0],
          document.getElementById("uploadWorkFileAfter")?.files?.[0],
        ].filter(Boolean);
      } else {
        files = document.getElementById("uploadWorkFileInput")?.files?.[0];
      }
      const mediaIds = await addMediaToExistingWork(workId, files, mediaType);
      showUploadMessage(`Success! ${mediaIds.length} media item(s) added.`, false);
      document.getElementById("uploadWorkFileInput").value = "";
      document.getElementById("uploadWorkFileBefore").value = "";
      document.getElementById("uploadWorkFileAfter").value = "";
      setTimeout(() => closeUploadModal(), 1500);
    }
  } catch (e) {
    console.error("[Media] Upload failed", e);
    showUploadMessage(`Error: ${e.message || "Upload failed"}`, true);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Upload";
    }
  }
}

function openUploadModal() {
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

// =====================
// Work Details Modal
// =====================

/** Firebase Storage download URLs use /o/ENCODED_PATH? — extract path for storageRef. */
function extractStoragePathFromMediaUrl(mediaUrl) {
  if (!mediaUrl || typeof mediaUrl !== "string") return null;
  const m = mediaUrl.match(/\/o\/([^?]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, " "));
  } catch {
    return null;
  }
}

/** Firestore sometimes stores gs://bucket/object — storageRef() needs object path only. */
function normalizeStoragePath(p) {
  if (!p || typeof p !== "string") return null;
  let s = p.trim();
  if (s.startsWith("gs://")) {
    const rest = s.slice(5);
    const i = rest.indexOf("/");
    if (i === -1) return null;
    s = rest.slice(i + 1);
  }
  return s.replace(/^\/+/, "") || null;
}

/** Cloud Function `mediaDownloadFile` via Hosting rewrite — no direct Storage URL fetch. */
async function fetchBlobViaHttpProxy(storagePath) {
  if (!storagePath || !auth.currentUser) {
    throw new Error("Download failed");
  }
  const idToken = await auth.currentUser.getIdToken();
  const url = `/api/mediaDownloadFile?path=${encodeURIComponent(storagePath)}&token=${encodeURIComponent(idToken)}`;
  const urlForLog = `/api/mediaDownloadFile?path=${encodeURIComponent(storagePath)}&token=<redacted>`;
  console.log("[MediaDownload] fetch url", urlForLog);
  const res = await fetch(url);
  console.log("[MediaDownload] res.status", res.status);
  if (!res.ok) {
    const errText = await res.text();
    console.log("[MediaDownload] error response text", errText);
    throw new Error("Download failed");
  }
  const blob = await res.blob();
  console.log("[MediaDownload] blob size", blob.size);
  return blob;
}

/**
 * Saves a blob as a file. iOS Safari often ignores <a download>; uses Share sheet or assigns blob URL to a tab
 * opened synchronously on click (async window.open is usually blocked).
 * @param {{ iosTab?: Window | null }} [opts] — Tab from sync window.open("about:blank") on same click (iOS).
 */
async function triggerMediaFileDownload(blob, fileName, mediaUrlFallback, opts = {}) {
  const iosTab = opts.iosTab;

  const closeIosTabIfUnused = () => {
    try {
      if (iosTab && !iosTab.closed) iosTab.close();
    } catch (_) {}
  };

  if (!blob || blob.size === 0) {
    closeIosTabIfUnused();
    if (mediaUrlFallback && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(mediaUrlFallback).catch(() => {});
    }
    return;
  }
  const isIOS =
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) {
    const url = URL.createObjectURL(blob);
    if (iosTab && !iosTab.closed) {
      try {
        iosTab.location.href = url;
        setTimeout(() => URL.revokeObjectURL(url), 120000);
        showMediaMessage("Long-press the image → Save to Photos, or tap Share.");
        return;
      } catch (e) {
        console.warn("[Media] ios tab location failed", e);
      }
    }
    const w = window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    if (!w) {
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 2500);
    }
    closeIosTabIfUnused();
    showMediaMessage("If it didn’t save: long-press the image → Save to Photos, or use Share.");
    return;
  }

  closeIosTabIfUnused();

  // Primary: classic download (works after async; showSaveFilePicker often loses user activation or Cancel = no file).
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 2500);
}

async function openWorkDetails(workId) {
  selectedWorkId = workId;
  const modal = document.getElementById("workDetailsModal");
  const content = document.getElementById("workDetailsContent");
  const actions = document.getElementById("workDetailsActions");
  if (!modal || !content || !actions) return;

  const work = await getContentWork(workId);
  if (!work) return;

  const items = await getMediaItems(workId);
  const history = await getPostedHistory(workId);
  await enrichWorkWithPreview(work);
  const canHandleMedia = canHandleMediaWork();
  const isAdminUser = isAdmin();
  const inToHandleView = currentMediaTab === "to_handle";
  const showManagerRow = inToHandleView && canHandleMedia;
  const showAdminRow = inToHandleView && isAdminUser;

  const previewsHtml = items
    .map((m) => {
      const isVideo = (m.mediaType || "").includes("video");
      const delBtn = showAdminRow
        ? `<button type="button" style="position:absolute;top:4px;right:4px;font-size:12px;padding:2px 6px;background:rgba(0,0,0,0.5);color:#fff;border:none;border-radius:4px;cursor:pointer;" data-media-id="${m.id}">×</button>`
        : "";
      if (isVideo) {
        return `<div style="flex:0 0 120px;aspect-ratio:1;background:#f3f4f6;border-radius:8px;overflow:hidden;position:relative;"><video src="${m.mediaUrl}" style="width:100%;height:100%;object-fit:cover;" muted playsinline></video>${delBtn}</div>`;
      }
      return `<div style="flex:0 0 120px;aspect-ratio:1;background:#f3f4f6;border-radius:8px;overflow:hidden;position:relative;"><img src="${m.mediaUrl}" alt="" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='<div style=width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#9ca3af>📷</div>'">${delBtn}</div>`;
    })
    .join("");

  const statusLabels = getStatusLabels(work);
  const statusBadges = statusLabels.map((l) => `<span style="font-size:10px;padding:2px 6px;background:#f3f4f6;border-radius:4px;color:#6b7280;">${l}</span>`).join(" ");

  content.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px;">${statusBadges}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">${previewsHtml || `<div style="aspect-ratio:1;width:120px;background:#f3f4f6;border-radius:8px;"></div>`}</div>
    <div style="display:grid;gap:6px;font-size:11px;">
      <div><span style="color:#6b7280;">Categories</span> <span style="color:#111827;">${Array.isArray(work.categoryNames) ? work.categoryNames.join(", ") : work.categoryName || work.serviceType || "—"}</span></div>
      ${work.caption ? `<div><span style="color:#6b7280;">Caption</span> <span style="color:#111827;">${work.caption}</span></div>` : ""}
      <div><span style="color:#6b7280;">By</span> <span style="color:#111827;">${work.staffName || "—"}</span></div>
      <div><span style="color:#6b7280;">Created</span> <span style="color:#111827;">${formatDate(work.createdAt)}</span></div>
      ${history.length ? `<div style="margin-top:6px;"><span style="color:#6b7280;">Posted history</span><ul style="margin:4px 0 0 14px;font-size:11px;color:#374151;">${history.map((h) => `<li>${h.platform} ${h.format} – ${h.postedDate || ""}</li>`).join("")}</ul></div>` : ""}
    </div>
  `;

  actions.innerHTML = "";

  const firstMedia = items[0];

  const btnStyle = "font-size:11px;padding:5px 10px;border-radius:6px;border:1px solid #d1d5db;background:#fff;color:#374151;cursor:pointer;";
  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.className = "btn-pill media-action-btn";
  downloadBtn.textContent = "Download";
  downloadBtn.style.cssText = btnStyle + "min-width:96px;white-space:nowrap;box-sizing:border-box;";
  downloadBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!firstMedia?.mediaUrl && !firstMedia?.storagePath) {
      alert("No media to download");
      return;
    }
    const isIOSDevice =
      /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    /** Must open before any await — iOS blocks async window.open (lost user activation). */
    let iosDownloadTab = null;
    if (isIOSDevice) {
      try {
        iosDownloadTab = window.open("about:blank", "_blank");
      } catch (_) {}
    }
    downloadBtn.disabled = true;
    downloadBtn.textContent = "Loading…";
    const dlOpts = { iosTab: iosDownloadTab };
    let storagePath =
      normalizeStoragePath(firstMedia.storagePath) || extractStoragePathFromMediaUrl(firstMedia.mediaUrl);
    const ext =
      (storagePath || "").match(/\.(jpe?g|png|gif|webp|mp4|webm|mov|pdf|heic|heif)$/i)?.[1] ||
      (firstMedia.mediaUrl || "").match(/\.(jpe?g|png|gif|webp|mp4|webm|mov|pdf)(?:\?|$)/i)?.[1] ||
      "jpg";
    const fileName = `work-${workId}.${ext}`;
    try {
      let blob = null;
      if (storagePath && auth.currentUser) {
        blob = await fetchBlobViaHttpProxy(storagePath);
      }
      if (blob && blob.size > 0) {
        await triggerMediaFileDownload(blob, fileName, undefined, dlOpts);
      } else {
        showMediaMessage("Download failed");
      }
    } catch (err) {
      console.warn("[Media] download", err);
      showMediaMessage("Download failed");
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.textContent = "Download";
      try {
        if (iosDownloadTab && !iosDownloadTab.closed) {
          const h = iosDownloadTab.location.href;
          if (h === "about:blank" || h === "") iosDownloadTab.close();
        }
      } catch (_) {
        try {
          if (iosDownloadTab && !iosDownloadTab.closed) iosDownloadTab.close();
        } catch (__) {}
      }
    }
  };
  actions.appendChild(downloadBtn);

  const shareBtn = document.createElement("button");
  shareBtn.className = "btn-pill";
  shareBtn.textContent = "Share";
  shareBtn.style.cssText = btnStyle;
  shareBtn.onclick = async () => {
    if (firstMedia?.mediaUrl && navigator.share) {
      try {
        await navigator.share({ title: Array.isArray(work.categoryNames) ? work.categoryNames.join(", ") : work.categoryName || work.serviceType || "Work", url: firstMedia.mediaUrl, text: work.caption || "" });
      } catch (e) {
        if (e.name !== "AbortError") alert("Share failed: " + (e.message || "Unknown error"));
      }
    } else if (firstMedia?.mediaUrl) {
      navigator.clipboard?.writeText(firstMedia.mediaUrl).then(() => alert("Link copied"));
    } else alert("No media to share");
  };
  actions.appendChild(shareBtn);

  const role = (currentUserProfile?.createdByRole || "").toLowerCase();
  const uid = auth.currentUser?.uid;
  const createdDate = work?.createdAt?.toDate ? work.createdAt.toDate() : (work?.createdAt ? new Date(work.createdAt) : null);
  const hoursSinceCreated = createdDate ? (Date.now() - createdDate.getTime()) / (1000 * 60 * 60) : null;
  const isOwner = work?.createdByUid === uid || work?.staffId === currentUserProfile?.staffId;
  const within24h = hoursSinceCreated !== null && hoursSinceCreated < 24;
  const canShowBtn = canShowSelfDeleteButton();
  const isEligible = isSelfDeleteEligible(work);
  const canSelfDelete = canShowBtn && isEligible;

  if (canShowBtn && isOwner) {
    const selfDeleteBtn = document.createElement("button");
    selfDeleteBtn.type = "button";
    selfDeleteBtn.className = "btn-pill btn-danger";
    selfDeleteBtn.textContent = "Delete My Work";
    selfDeleteBtn.style.cssText = btnStyle + "background:#dc2626;color:#fff;cursor:pointer;pointer-events:auto;";
    if (!isEligible) {
      selfDeleteBtn.style.opacity = "0.7";
      selfDeleteBtn.title = "You can only delete your own active work within 24 hours, before it is posted or featured.";
    }
    selfDeleteBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isEligible) {
        let reason = "";
        if ((work?.postedCount || 0) > 0) {
          reason = "This work has been posted. You can only delete before it is posted.";
        } else if (work?.featured === true) {
          reason = "This work is featured. You can only delete before it is featured.";
        } else if (!within24h && hoursSinceCreated !== null) {
          const hrs = Math.round(hoursSinceCreated * 10) / 10;
          reason = `This work was uploaded ${hrs} hours ago. You can only delete within 24 hours of upload.`;
        } else if (work?.status !== "active") {
          reason = "This work is no longer active.";
        } else {
          reason = "You can only delete your own active work within 24 hours, before it is posted or featured.";
        }
        showMediaMessage(reason);
        return;
      }
      showMediaConfirm("This will delete your uploaded work and remove its media files. Continue?", async () => {
        try {
          selfDeleteBtn.disabled = true;
          selfDeleteBtn.textContent = "…";
          await selfDeleteContentWork(workId);
          closeWorkDetails();
          renderMediaList();
        } catch (err) {
          selfDeleteBtn.disabled = false;
          selfDeleteBtn.textContent = "Delete My Work";
          showMediaMessage("Failed: " + (err?.message || "Unknown error"));
        }
      });
    };
    actions.appendChild(selfDeleteBtn);
    if (!isEligible) {
      let hintText = "";
      if ((work?.postedCount || 0) > 0) hintText = "Posted – you can only delete before posting.";
      else if (work?.featured === true) hintText = "Featured – you can only delete before featuring.";
      else if (!within24h && hoursSinceCreated !== null) hintText = `Uploaded ${Math.round(hoursSinceCreated * 10) / 10}h ago – delete within 24h only.`;
      else hintText = "You can only delete your own active work within 24 hours, before it is posted or featured.";
      const hint = document.createElement("div");
      hint.className = "action-hint";
      hint.style.cssText = "font-size:10px;color:#9ca3af;margin-top:4px;";
      hint.textContent = hintText;
      actions.appendChild(hint);
    }
  }

  if (showManagerRow) {
    const markPostedBtn = document.createElement("button");
    markPostedBtn.className = "btn-pill media-action-btn";
    markPostedBtn.textContent = "Mark as Posted";
    markPostedBtn.style.cssText = btnStyle;
    markPostedBtn.onclick = () => openMarkPostedModal(workId);
    actions.appendChild(markPostedBtn);

    const featuredBtn = document.createElement("button");
    featuredBtn.className = "btn-pill media-action-btn";
    featuredBtn.textContent = work.featured ? "Remove Featured" : "Mark as Featured";
    featuredBtn.style.cssText = btnStyle;
    featuredBtn.onclick = async () => {
      await updateContentWork(workId, { featured: !work.featured });
      openWorkDetails(workId);
      renderMediaList();
    };
    actions.appendChild(featuredBtn);
  }

  if (showAdminRow) {
    const archiveBtn = document.createElement("button");
    archiveBtn.className = "btn-pill";
    archiveBtn.textContent = "Archive Work";
    archiveBtn.onclick = async () => {
      await archiveContentWork(workId);
      closeWorkDetails();
      renderMediaList();
    };
    actions.appendChild(archiveBtn);

    const deleteMediaBtn = document.createElement("button");
    deleteMediaBtn.className = "btn-pill media-action-btn";
    deleteMediaBtn.textContent = "Delete Media";
    deleteMediaBtn.style.cssText = btnStyle;
    deleteMediaBtn.disabled = items.length === 0;
    if (items.length === 0) deleteMediaBtn.title = "No media to delete";
    deleteMediaBtn.onclick = async () => {
      if (items.length === 0) return;
      if (confirm("This will remove the uploaded media files but keep the work record and history.")) {
        try {
          await deleteAllMediaFromWork(workId);
          openWorkDetails(workId);
          renderMediaList();
        } catch (e) {
          alert("Failed: " + (e.message || "Unknown error"));
        }
      }
    };
    actions.appendChild(deleteMediaBtn);

    const duplicateBtn = document.createElement("button");
    duplicateBtn.className = "btn-pill media-action-btn";
    duplicateBtn.textContent = work.duplicate ? "Remove Duplicate" : "Mark Duplicate";
    duplicateBtn.style.cssText = btnStyle;
    duplicateBtn.onclick = async () => {
      await updateContentWork(workId, { duplicate: !work.duplicate });
      openWorkDetails(workId);
      renderMediaList();
    };
    actions.appendChild(duplicateBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-pill btn-danger media-action-btn";
    deleteBtn.style.cssText = btnStyle + "color:#dc2626;border-color:#fecaca;";
    deleteBtn.textContent = "Delete Work";
    deleteBtn.onclick = async () => {
      if (confirm("This will remove this work from active use. Continue?")) {
        await deleteContentWork(workId);
        closeWorkDetails();
        renderMediaList();
      }
    };
    actions.appendChild(deleteBtn);
  }

  content.onclick = async (e) => {
    const mediaId = e.target?.closest?.("[data-media-id]")?.dataset?.mediaId;
    if (mediaId && showAdminRow && confirm("Delete this media item?")) {
      try {
        await deleteMediaItem(workId, mediaId);
        openWorkDetails(workId);
        renderMediaList();
      } catch (err) {
        alert("Failed to delete: " + (err.message || "Unknown error"));
      }
    }
  };

  modal.style.display = "flex";
}

function closeWorkDetails() {
  const modal = document.getElementById("workDetailsModal");
  if (modal) modal.style.display = "none";
  selectedWorkId = null;
}

// =====================
// Mark as Posted Modal
// =====================

const MARK_POSTED_PLATFORM_OPTIONS = [
  { value: "Instagram", label: "Instagram" },
  { value: "Facebook", label: "Facebook" },
  { value: "Pinterest", label: "Pinterest" },
  { value: "TikTok", label: "TikTok" },
  { value: "Google Business", label: "Google Business" },
  { value: "Website", label: "Website" },
  { value: "Other", label: "Other" },
];

const MARK_POSTED_FORMAT_OPTIONS = [
  { value: "Post", label: "Post" },
  { value: "Reel", label: "Reel" },
  { value: "Story", label: "Story" },
  { value: "Pin", label: "Pin" },
  { value: "Video", label: "Video" },
  { value: "Other", label: "Other" },
];

function renderMarkPostedPlatformCheckboxes(selectedValues = ["Instagram"]) {
  const wrap = document.getElementById("markPostedPlatformCheckboxes");
  if (!wrap) return;
  wrap.innerHTML = "";
  const selected = new Set(selectedValues);
  MARK_POSTED_PLATFORM_OPTIONS.forEach((opt) => {
    const label = document.createElement("label");
    label.style.cssText = "display:flex;align-items:center;gap:10px;cursor:pointer;font-size:10px;color:#374151;";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.name = "markPostedPlatform";
    cb.value = opt.value;
    cb.checked = selected.has(opt.value);
    cb.style.cssText = "width:18px;height:18px;accent-color:#7c3aed;cursor:pointer;";
    label.appendChild(cb);
    label.appendChild(document.createTextNode(opt.label));
    wrap.appendChild(label);
  });
}

function getMarkPostedSelectedPlatforms() {
  return Array.from(document.querySelectorAll('input[name="markPostedPlatform"]:checked')).map((el) => el.value);
}

function renderMarkPostedFormatDropdown(selectedValue) {
  const dropdown = document.getElementById("markPostedFormatDropdown");
  const hidden = document.getElementById("markPostedFormat");
  const label = document.getElementById("markPostedFormatLabel");
  if (!dropdown || !hidden || !label) return;
  dropdown.innerHTML = "";
  MARK_POSTED_FORMAT_OPTIONS.forEach((opt) => {
    const row = document.createElement("div");
    const isSelected = (hidden.value || selectedValue) === opt.value;
    row.style.cssText = `padding:10px 12px;font-size:10px;cursor:pointer;display:flex;align-items:center;gap:10px;border-bottom:1px solid #f3f4f6;${isSelected ? "background:#ede9fe;color:#7c3aed;font-weight:500;" : ""}`;
    row.innerHTML = (isSelected ? "✓ " : "<span style='opacity:0'>✓ </span>") + opt.label;
    row.onclick = () => {
      hidden.value = opt.value;
      label.textContent = opt.label;
      dropdown.style.display = "none";
    };
    dropdown.appendChild(row);
  });
}

function openMarkPostedModal(workId) {
  const modal = document.getElementById("markPostedModal");
  if (!modal) return;
  modal.dataset.workId = workId;
  renderMarkPostedPlatformCheckboxes(["Instagram"]);
  const formatHidden = document.getElementById("markPostedFormat");
  const formatLabel = document.getElementById("markPostedFormatLabel");
  if (formatHidden) formatHidden.value = "Post";
  if (formatLabel) formatLabel.textContent = "Post";
  document.getElementById("markPostedNotes").value = "";
  renderMarkPostedFormatDropdown("Post");
  modal.style.display = "flex";
}

function closeMarkPostedModal() {
  const modal = document.getElementById("markPostedModal");
  const formatDropdown = document.getElementById("markPostedFormatDropdown");
  if (formatDropdown) formatDropdown.style.display = "none";
  if (modal) {
    modal.style.display = "none";
    delete modal.dataset.workId;
  }
}

async function saveMarkPosted() {
  const modal = document.getElementById("markPostedModal");
  const workId = modal?.dataset?.workId;
  if (!workId || !currentUserProfile) return;

  const platforms = getMarkPostedSelectedPlatforms();
  if (platforms.length === 0) {
    alert("Please select at least one platform.");
    return;
  }
  const format = document.getElementById("markPostedFormat")?.value || "Post";
  const notes = document.getElementById("markPostedNotes")?.value || "";
  const postedDate = new Date().toISOString().slice(0, 10);

  try {
    for (const platform of platforms) {
      await addPostedHistory(workId, {
        platform,
        format,
        postedDate,
        markedByStaffId: currentUserProfile.staffId,
        markedByName: currentUserProfile.staffName,
        notes,
      });
    }
    closeMarkPostedModal();
    if (selectedWorkId === workId) openWorkDetails(workId);
    renderMediaList();
  } catch (e) {
    console.error("[Media] addPostedHistory failed", e);
    alert("Failed to save: " + (e.message || "Unknown error"));
  }
}

// =====================
// Navigation
// =====================

export async function goToMedia() {
  const tasksScreen = document.getElementById("tasksScreen");
  const inboxScreen = document.getElementById("inboxScreen");
  const chatScreen = document.getElementById("chatScreen");
  const ownerView = document.getElementById("owner-view");
  const joinBar = document.getElementById("joinBar");
  const queueControls = document.getElementById("queueControls");

  if (tasksScreen) tasksScreen.style.display = "none";
  if (inboxScreen) inboxScreen.style.display = "none";
  if (chatScreen) chatScreen.style.display = "none";
  if (ownerView) ownerView.style.display = "none";
  if (joinBar) joinBar.style.display = "none";
  if (queueControls) queueControls.style.display = "none";

  if (auth.currentUser) {
    try {
      await loadUserProfile();
      setupMediaWorkListSubscriptions();
    } catch (e) {
      console.warn("[Media] goToMedia profile/subscriptions", e);
    }
  } else {
    applyToHandleVisibility();
  }

  const screen = document.getElementById("mediaScreen");
  if (screen) {
    screen.style.display = "flex";
    document.querySelectorAll(".btn-pill").forEach((b) => b.classList.remove("active"));
    const btn = document.getElementById("mediaBtn");
    if (btn) btn.classList.add("active");
  }
  updateMediaUploadWorkButtonVisibility();
  renderMediaFilters();
  renderMediaList();
}

function hideMediaScreen() {
  const screen = document.getElementById("mediaScreen");
  if (screen) screen.style.display = "none";
  const btn = document.getElementById("mediaBtn");
  if (btn) btn.classList.remove("active");
}

// Expose immediately so MEDIA button works for all users (including Admin) before auth callback
if (typeof window !== "undefined") {
  window.goToMedia = goToMedia;
  window.hideUploadWorkScreen = hideMediaScreen;
  // Direct binding so button works even if inline onclick fails
  const mediaBtn = document.getElementById("mediaBtn");
  if (mediaBtn) mediaBtn.onclick = goToMedia;
}

// =====================
// Init
// =====================

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
  document.getElementById("uploadWorkSubmitBtn")?.addEventListener("click", doUpload);

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

function setupWorkDetailsListeners() {
  document.getElementById("workDetailsModalClose")?.addEventListener("click", closeWorkDetails);
}

function setupMarkPostedListeners() {
  document.getElementById("markPostedModalClose")?.addEventListener("click", closeMarkPostedModal);
  document.getElementById("markPostedCancel")?.addEventListener("click", closeMarkPostedModal);
  document.getElementById("markPostedSave")?.addEventListener("click", saveMarkPosted);

  const formatTrigger = document.getElementById("markPostedFormatTrigger");
  const formatDropdown = document.getElementById("markPostedFormatDropdown");
  if (formatTrigger && formatDropdown) {
    formatTrigger.onclick = (e) => {
      e.stopPropagation();
      const open = formatDropdown.style.display === "block";
      formatDropdown.style.display = open ? "none" : "block";
      if (!open) renderMarkPostedFormatDropdown(document.getElementById("markPostedFormat")?.value || "Post");
    };
    formatDropdown.onclick = (e) => e.stopPropagation();
  }

  document.getElementById("markPostedModal")?.addEventListener("click", (e) => {
    const formatTrig = document.getElementById("markPostedFormatTrigger");
    const formatDd = document.getElementById("markPostedFormatDropdown");
    const inFormat = formatTrig?.contains(e.target) || formatDd?.contains(e.target);
    if (e.target.id === "markPostedModal" || !inFormat) {
      if (formatDd) formatDd.style.display = "none";
    }
  });
}

function initMediaModule() {
  const tabMy = document.getElementById("mediaTabMyUploads");
  const tabToHandle = document.getElementById("mediaTabToHandle");
  if (tabMy) tabMy.onclick = () => setMediaTab("my_uploads");
  if (tabToHandle) tabToHandle.onclick = () => setMediaTab("to_handle");

  const filterTrigger = document.getElementById("mediaFilterTrigger");
  const sortTrigger = document.getElementById("mediaSortTrigger");
  const filterDropdown = document.getElementById("mediaFilterDropdown");
  const sortDropdown = document.getElementById("mediaSortDropdown");
  if (filterTrigger && filterDropdown) {
    filterTrigger.onclick = (e) => {
      e.stopPropagation();
      const open = filterDropdown.style.display === "block";
      closeMediaDropdowns();
      if (!open) filterDropdown.style.display = "block";
    };
  }
  if (sortTrigger && sortDropdown) {
    sortTrigger.onclick = (e) => {
      e.stopPropagation();
      const open = sortDropdown.style.display === "block";
      closeMediaDropdowns();
      if (!open) sortDropdown.style.display = "block";
    };
  }
  const employeeTrigger = document.getElementById("mediaEmployeeFilterTrigger");
  const employeeDropdown = document.getElementById("mediaEmployeeFilterDropdown");
  if (employeeTrigger && employeeDropdown) {
    employeeTrigger.onclick = (e) => {
      e.stopPropagation();
      const open = employeeDropdown.style.display === "block";
      closeMediaDropdowns();
      if (!open && currentMediaTab === "to_handle") employeeDropdown.style.display = "block";
    };
  }
  const categoryTrigger = document.getElementById("mediaCategoryFilterTrigger");
  const categoryDropdown = document.getElementById("mediaCategoryFilterDropdown");
  if (categoryTrigger && categoryDropdown) {
    categoryTrigger.onclick = (e) => {
      e.stopPropagation();
      const open = categoryDropdown.style.display === "block";
      closeMediaDropdowns();
      if (!open) categoryDropdown.style.display = "block";
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

function setupMediaWorkListSubscriptions() {
  if (unsubMyWorks) {
    unsubMyWorks();
    unsubMyWorks = null;
  }
  if (unsubAllWorks) {
    unsubAllWorks();
    unsubAllWorks = null;
  }

  if (currentUserProfile?.staffId) {
    unsubMyWorks = subscribeContentWorks({ staffId: currentUserProfile.staffId }, async (works) => {
      const toEnrich = works.slice(0, 20);
      const enriched = await Promise.all(toEnrich.map((w) => enrichWorkWithPreview({ ...w })));
      userWorks = [...enriched, ...works.slice(20)];
      populateWorksDropdown();
      renderMediaList();
    });
  }

  applyToHandleVisibility();
  if (canHandleMediaWork()) {
    unsubAllWorks = subscribeContentWorks({}, async (works) => {
      const toEnrich = works.slice(0, 20);
      const enriched = await Promise.all(toEnrich.map((w) => enrichWorkWithPreview({ ...w })));
      allWorks = [...enriched, ...works.slice(20)];
      renderMediaFilters();
      renderMediaList();
    });
  }
}

export function initMediaUpload() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      hideMediaScreen();
      if (unsubMyWorks) {
        unsubMyWorks();
        unsubMyWorks = null;
      }
    if (unsubAllWorks) {
      unsubAllWorks();
      unsubAllWorks = null;
    }
    if (unsubMediaCategories) {
      unsubMediaCategories();
      unsubMediaCategories = null;
    }
    return;
  }
  await loadUserProfile();
    initMediaModule();

    setupMediaWorkListSubscriptions();

    if (unsubMediaCategories) {
      unsubMediaCategories();
      unsubMediaCategories = null;
    }
    unsubMediaCategories = subscribeMediaCategories((cats) => {
      mediaCategories = cats || [];
      populateMediaCategoriesDropdown();
    });

    // app.js sets window.__ff_user_role after user doc load — retry so "To handle" matches salon role
    setTimeout(async () => {
      try {
        await loadUserProfile();
        setupMediaWorkListSubscriptions();
      } catch (_) {}
    }, 700);
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

    item.appendChild(dragHandle);
    item.appendChild(statusIndicator);
    item.appendChild(nameContainer);
    item.appendChild(toggleBtn);
    item.appendChild(editBtn);

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
  const input = document.getElementById("userProfileAddMediaCategoryInput");
  if (!input) return;
  const name = input.value.trim();
  if (!name) {
    alert("Please enter a category name.");
    return;
  }
  try {
    await createMediaCategory({ name });
    input.value = "";
    await renderMediaCategoriesSettings();
  } catch (e) {
    console.error("[Media] createMediaCategory failed", e);
    const msg =
      e && e.message
        ? String(e.message)
        : "Could not save category. If you use Media “To handle”, you need permission to manage media categories.";
    alert(msg + "\n\nIf this is a permission error, ask an owner to set your role to Manager/Admin or enable Media → To handle for your staff profile.");
  }
}

function initMediaCategoriesSettingsListeners() {
  const addBtn = document.getElementById("userProfileAddMediaCategoryBtn");
  if (addBtn && !addBtn.__mediaCatBound) {
    addBtn.__mediaCatBound = true;
    addBtn.addEventListener("click", addMediaCategoryFromSettings);
  }
  const input = document.getElementById("userProfileAddMediaCategoryInput");
  if (input && !input.__mediaCatBound) {
    input.__mediaCatBound = true;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addMediaCategoryFromSettings();
      }
    });
  }
}

if (typeof window !== "undefined") {
  window.renderMediaCategoriesSettings = renderMediaCategoriesSettings;
  window.addMediaCategoryFromSettings = addMediaCategoryFromSettings;
  window.initMediaCategoriesSettingsListeners = initMediaCategoriesSettingsListeners;
}

initMediaUpload();
