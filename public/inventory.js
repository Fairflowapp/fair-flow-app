/**
 * Inventory — categories/subcategories from Firestore (salon inventoryCategories).
 * Table rows/groups persist on the selected subcategory Firestore document.
 */
import { db, auth, storage } from "./app.js?v=20260411_chat_reminder_attrfix";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  writeBatch,
  updateDoc,
  addDoc,
  setDoc,
  serverTimestamp,
  query,
  orderBy,
  where,
  deleteDoc,
  onSnapshot,
  runTransaction,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";

const SALON_ID_CACHE_KEY = "ff_salonId_v1";

/**
 * Resolve the currently active location id (for multi-branch salons).
 * Returns an empty string when no location context exists (e.g. single-branch
 * salons or before the active-location bootstrap has run). Callers should treat
 * an empty value as "no filter" so single-branch accounts keep working.
 *
 * Resolution order:
 *   1. window.ffGetActiveLocationId()           — canonical helper
 *   2. window.__ff_active_location_id           — direct global
 *   3. localStorage.ff_active_location_id       — persisted selection
 * The localStorage fallback is important: on the very first frame after a
 * full refresh the helper module may not have wired yet, but the selection
 * from the previous session is already available in storage.
 */
function _ffInvActiveLocId() {
  try {
    if (typeof window !== "undefined" && typeof window.ffGetActiveLocationId === "function") {
      const v = window.ffGetActiveLocationId();
      const s = typeof v === "string" ? v.trim() : (v != null ? String(v).trim() : "");
      if (s) return s;
    }
  } catch (_) {}
  try {
    const raw = (typeof window !== "undefined" && typeof window.__ff_active_location_id === "string")
      ? window.__ff_active_location_id.trim()
      : "";
    if (raw) return raw;
  } catch (_) {}
  try {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("ff_active_location_id");
      if (typeof stored === "string" && stored.trim()) return stored.trim();
    }
  } catch (_) {}
  return "";
}

/** True when the current user has more than one location available. */
function _ffInvUserHasMultipleLocations() {
  try {
    if (typeof window !== "undefined" && typeof window.ffUserHasMultipleLocations === "function") {
      return !!window.ffUserHasMultipleLocations();
    }
  } catch (_) {}
  return false;
}

/**
 * Return true when the given Firestore doc payload belongs to the active
 * branch.
 *
 * Rules (simple + strict):
 *   - No active locationId resolved → show everything (single-branch accounts
 *     or the brief frame before the active-location helper bootstraps).
 *   - Active locationId resolved → require the doc's `locationId` to match
 *     exactly. Docs with missing or different `locationId` are hidden — no
 *     "legacy default" bucket, because that's what keeps leaking between
 *     branches.
 *
 * Note: we intentionally do NOT consult `ffUserHasMultipleLocations()` here.
 * If that helper returns false during startup for a legitimately multi-branch
 * account, we were falling back to "show everything" and the filter did
 * nothing. The active-location id is the single source of truth.
 */
function _ffInvDocInActiveLoc(data) {
  const active = _ffInvActiveLocId();
  if (!active) return true;
  const raw = data && typeof data.locationId === "string" ? data.locationId.trim() : "";
  if (!raw) return false;
  return raw === active;
}

/** @type {Set<string>} */
let _expandedCategoryIds = new Set();
/** @type {string | null} */
let _selectedSubcategoryId = null;

/** Categories tree from Firestore (sidebar + modal draft base). */
let _categoryTree = [];
/** Last tree successfully loaded or saved (for Firestore diff on Save). */
let _persistedCategoryTree = [];
let _invCategoriesLoading = false;
let _invCatLoadError = null;
let _catSaveBusy = false;

/** Table groups for the selected subcategory (`label` in UI maps to `name` in Firestore). */
/** @type {{ id: string, label: string }[] | null} */
let _groups = null;

/**
 * @typedef {{ id: string, rowNo: string, code: string, name: string, url: string, supplier: string, byGroup: Record<string, { stock: number, current: number, price: string }> }} InvRow
 * @type {InvRow[] | null}
 */
let _rows = null;

/** When set, that group id shows remove confirmation (not one-click delete). */
let _groupRemoveConfirmId = null;

/** Second step: centered modal before actual delete (local only). */
let _groupRemoveModalGroupId = null;

/** Deep clone of category tree while Manage Categories modal is open (reorder / edits until Save). */
let _catManageDraftTree = null;
/** @type {{ kind: 'cat' | 'sub', catId: string, subId?: string } | null} */
let _catDndPayload = null;

/** Manage Categories modal */
let _manageCategoriesOpen = false;
let _renameCatId = null;
/** `${catId}:${subId}` when renaming a subcategory */
let _renameSubKey = null;
/** Open ⋯ menu: `cat:${id}` or `sub:${catId}:${subId}` */
let _catMenuKey = null;
/** Delete confirm modal: { kind, catId, subId?, name } */
let _catDeleteModal = null;
let _inlineNewCat = false;
let _inlineNewSubCatId = null;

/** When set, one inventory table cell is in edit mode: `${inv}:${rowId}` or `${inv}:${rowId}:${groupId}` */
let _editCellKey = null;

/** Local UI-only column widths (px). `groupSubById` = width per Stock/Current/Order/Price under that group id. */
let _invColWidths = null;

/** Row context menu (right-click or ⋯): local UI only */
let _invRowMenu = null; // { rowId: string, left: number, top: number } | null
/** Delete row confirmation modal */
let _invRowDeleteModalRowId = null;

/** Firestore table sync for `salons/.../inventorySubcategories/{subId}` (groups + rows fields). */
let _invTableLoading = false;
/** `${categoryId}:${subId}` when _groups/_rows match that sub; null if none loaded. */
let _invTableLoadedForSubId = null;
let _invTableLoadSeq = 0;
let _invTableSaveTimer = null;
/** Row drag-reorder: row id being dragged (HTML5 DnD). */
let _invRowDndDragId = null;

const STYLE_ID = "ff-inv2-mock-styles-v123";

/** One-step undo for row/group delete: delayed Firestore write + toast. */
const INV_UNDO_MS = 5000;
const INV_UNDO_TOAST_ID = "ff-inv-undo-toast";
/** @type {ReturnType<typeof setTimeout> | null} */
let _invUndoTimer = null;
/** @type {{ kind: "row"; row: object; index: number } | { kind: "group"; group: { id: string; label: string }; groupIndex: number; perRowCells: Record<string, { stock: number; current: number; price: string }>; groupColWidth: number | null } | null} */
let _invUndoPayload = null;

/** Saving draft inventory order to Firestore (UI feedback only). */
let _invSaveOrderDraftBusy = false;

/** Main workspace tab inside Inventory screen: table vs order builder vs orders list (placeholder). */
let _invMainTab = "inventory";

/** Saved inventory orders list (Orders tab). */
let _invOrdersList = [];
let _invOrdersLoading = false;
/** @type {string | null} */
let _invOrdersLoadError = null;
/** @type {string | null} */
let _invOrdersDetailOrderId = null;
/** Open ⋯ menu for an order row: { orderId, left, top } */
let _invOrdersMenu = null;
/** @type {string | null} */
let _invOrdersDeleteConfirmOrderId = null;
/** @type {string | null} */
let _invOrdersMarkOrderedConfirmOrderId = null;
/** Orders tab: Edit name modal state. */
/** @type {{ orderId: string, draftName: string, busy: boolean } | null} */
let _invOrdersRenameModal = null;
/** Orders tab: status filter (display only). */
/** @type {"all" | "open" | "in_progress" | "done"} */
let _invOrdersStatusFilter = "all";
/** Orders tab: search query (display filter only). */
let _invOrdersSearchQuery = "";
/** Order detail: per-line receive draft (checkbox + qty this batch). Used to seed shopping UI for ordered lines. */
/** @type {Record<string, { checked: boolean[], qty: string[] }>} */
let _invDetailReceiveDraft = {};
/** Order detail: shopping list (checkbox + qty bought in store). Local only — not persisted to Firestore yet. */
/** @type {Record<string, { checked: boolean[], qtyBought: string[] }>} */
let _invOrderShoppingDraft = {};
let _invOrderReceiveBusy = false;
/** Order Details: Confirm Purchase (draft shopping → inventory) in flight. */
let _invOrderPurchaseBusy = false;

function isInvOrderDetailCommitBusy() {
  return _invOrderReceiveBusy || _invOrderPurchaseBusy;
}
/** Order Details line filter (display only). Open = not fully received (includes partial lines). */
/** @type {"all" | "open" | "received"} */
let _invOrderDetailFilter = "all";
/** Order Builder: name for next Save as Order (local only until saved). */
let _invOrderSaveNameDraft = "";

/** Order detail: receipts subcollection live listener */
let _invOrderReceiptsUnsub = null;
/** @type {string | null} */
let _invOrderReceiptsBoundOrderId = null;
let _invOrderReceiptsList = [];
let _invOrderReceiptsLoading = false;
let _invOrderReceiptUploadBusy = false;
/** Next receipt upload: note / supplier / amount per order (same payload fields as before; in-memory only). */
/** @type {Record<string, { note: string, supplierName: string, amount: string }>} */
let _invOrderReceiptUploadFieldsByOrderId = {};
/** @type {string | null} */
let _invReceiptInfoModalOrderId = null;
/** Order Details: read-only line detail modal (index into order.items); opened via long-press on row. */
let _invOrderDetailLineViewIdx = null;

/** Order Builder: scope for generated preview (not persisted). */
/** @deprecated kept only to avoid breakage in older cached references; always "custom" now. */
let _invOrderBuilderSourceMode = "custom";
/** Order Builder tree: which category blocks are expanded. Default = collapsed (closed). */
/** @type {Set<string>} */
let _invOrderBuilderExpandedCatIds = new Set();
/** @type {Set<string>} */
let _invOrderBuilderCustomSubIds = new Set();
/** @type {Array<Record<string, unknown>>} */
let _invOrderBuilderPreviewLines = [];
let _invOrderBuilderPreviewLoading = false;
let _invOrderBuilderPreviewSeq = 0;
/** Order Builder: locally-added manual items (mirror of Firestore draft doc). */
/** @type {Array<Record<string, unknown>>} */
let _invOrderBuilderManualLines = [];

/** Doc id used for the legacy single-draft (migrated on first load). */
const INVENTORY_LEGACY_DRAFT_DOC_ID = "active";
/** Doc id of the currently-active Create Order draft, or null when none exists yet. */
/** @type {string | null} */
let _invActiveDraftId = null;
/** Whether the active draft has been loaded into memory since entering Inventory. */
let _invOrderDraftLoaded = false;
/** Whether a draft load is currently in flight. */
let _invOrderDraftLoading = false;
/** Debounce timer for persisting draft changes. */
let _invOrderDraftSaveTimer = null;
/** In-flight guard (for Save as Order to flush before create). */
let _invOrderDraftSaveInFlight = false;
/** Draft save status for the UI indicator. */
/** @type {"idle" | "saving" | "saved"} */
let _invOrderDraftSaveStatus = "idle";
/** When the last successful draft save happened (ms). */
let _invOrderDraftLastSavedAt = 0;
/** One-shot "Resumed unfinished draft" toast — show only on the first load per session that actually had items. */
let _invOrderDraftResumeToastShown = false;
/** Drafts picker modal state. */
/** @type {{ open: boolean, loading: boolean, error: string | null, drafts: Array<{ id: string, isActive: boolean, manualItems: Array<Record<string, unknown>>, orderName: string, createdAt: number, updatedAt: number }> }} */
let _invDraftsPicker = { open: false, loading: false, error: null, drafts: [] };
/** Inventory: Order cell breakdown modal state (long-press). */
/** @type {{ rowId: string, groupId: string, busy: boolean } | null} */
let _invOrderCellBreakdownModal = null;

/** Order Builder: Add Item modal state. Optional link to an existing inventory item via tree picker. */
/**
 * @type {{
 *   draftName: string,
 *   draftQty: string,
 *   linkedItemId: string | null,
 *   linkedItemMeta: Record<string, unknown> | null,
 *   picker: {
 *     step: "category" | "subcategory" | "items",
 *     catId: string | null,
 *     subId: string | null,
 *     items: Array<Record<string, unknown>> | null,
 *     loading: boolean,
 *     error: string | null,
 *   },
 * } | null}
 */
let _invOrderBuilderAddModal = null;

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function newRowId() {
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function newGroupId() {
  return `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function newCategoryId() {
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function newSubcategoryId() {
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function getSalonId() {
  const user = auth.currentUser;
  let salonId = null;
  if (user) {
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        salonId = data.salonId || null;
      }
    } catch (e) {
      console.warn("[Inventory] getSalonId from user doc failed", e);
    }
  }
  if (!salonId && typeof window !== "undefined" && window.currentSalonId) {
    salonId = window.currentSalonId;
  }
  if (!salonId && typeof localStorage !== "undefined") {
    try {
      const cached = localStorage.getItem(SALON_ID_CACHE_KEY);
      if (cached && cached.trim()) salonId = cached.trim();
    } catch (e) {}
  }
  if (salonId && typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(SALON_ID_CACHE_KEY, salonId);
    } catch (e) {}
  }
  return salonId || null;
}

async function loadInventoryCategoriesFromFirestore() {
  const salonId = await getSalonId();
  if (!salonId) {
    _invCatLoadError = "No salon — sign in or select a salon.";
    _categoryTree = [];
    _persistedCategoryTree = [];
    return;
  }
  _invCatLoadError = null;
  const catSnap = await getDocs(collection(db, `salons/${salonId}/inventoryCategories`));
  const rawCatsAll = catSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const rawCats = rawCatsAll.filter(_ffInvDocInActiveLoc);
  // Optional diagnostic log — only prints when the user explicitly opts in via
  //   localStorage.setItem('ff_inv_debug', 'true')
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem("ff_inv_debug") === "true") {
      console.log(
        "[Inventory/loc] load categories — active=%o total=%d visible=%d",
        _ffInvActiveLocId() || "(none)",
        rawCatsAll.length,
        rawCats.length,
        rawCatsAll.map((c) => ({ id: c.id, name: c.name, locationId: c.locationId ?? null })),
      );
    }
  } catch (_) {}
  rawCats.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const tree = await Promise.all(
    rawCats.map(async (c) => {
      const subCol = collection(db, `salons/${salonId}/inventoryCategories/${c.id}/inventorySubcategories`);
      const subSnap = await getDocs(subCol);
      const subs = subSnap.docs
        .map((d) => {
          const data = d.data();
          return { id: d.id, name: data.name, order: data.order ?? 0, locationId: data.locationId };
        })
        .filter(_ffInvDocInActiveLoc);
      subs.sort((a, b) => a.order - b.order);
      return {
        id: c.id,
        name: c.name,
        subcategories: subs.map(({ id, name }) => ({ id, name })),
      };
    })
  );
  _categoryTree = tree;
  _persistedCategoryTree = cloneCategoryTree(tree);
  _expandedCategoryIds = new Set(tree.map((c) => c.id));
  ensureValidSubcategorySelection();
}

/**
 * Persist full category tree from Manage modal Save. Diff vs _persistedCategoryTree.
 * @param {ReturnType<typeof cloneCategoryTree>} desiredTree
 */
async function persistInventoryCategoryTree(desiredTree) {
  const salonId = await getSalonId();
  if (!salonId) throw new Error("No salon");

  const oldTree = _persistedCategoryTree || [];
  const oldCatIds = new Set(oldTree.map((c) => c.id));
  const desiredCatIds = new Set(desiredTree.map((c) => c.id));

  const oldSubById = new Map();
  for (const c of oldTree) {
    for (const s of c.subcategories || []) {
      oldSubById.set(s.id, { catId: c.id, sub: s });
    }
  }

  const newSubById = new Map();
  for (const c of desiredTree) {
    for (const s of c.subcategories || []) {
      newSubById.set(s.id, { catId: c.id, sub: s });
    }
  }

  const movedReads = [];
  for (const [subId, nw] of newSubById) {
    const old = oldSubById.get(subId);
    if (old && old.catId !== nw.catId) {
      const ref = doc(db, `salons/${salonId}/inventoryCategories/${old.catId}/inventorySubcategories/${subId}`);
      movedReads.push(getDoc(ref).then((snap) => ({ subId, snap })));
    }
  }
  const movedSnaps = await Promise.all(movedReads);
  const movedCreatedAt = new Map();
  /** Preserve table fields when moving sub to another category (batch.set replaces the whole doc). */
  const movedTableData = new Map();
  for (const { subId, snap } of movedSnaps) {
    if (snap.exists()) {
      const d = snap.data();
      const ca = d.createdAt;
      if (ca) movedCreatedAt.set(subId, ca);
      movedTableData.set(subId, {
        groups: Array.isArray(d.groups) ? d.groups : [],
        rows: Array.isArray(d.rows) ? d.rows : [],
      });
    }
  }

  let batch = writeBatch(db);
  let n = 0;
  const commits = [];

  function flush() {
    if (n === 0) return;
    commits.push(batch.commit());
    batch = writeBatch(db);
    n = 0;
  }
  function bump() {
    n++;
    if (n >= 450) flush();
  }

  for (const [subId, { catId }] of oldSubById) {
    const nw = newSubById.get(subId);
    if (!nw) {
      batch.delete(doc(db, `salons/${salonId}/inventoryCategories/${catId}/inventorySubcategories/${subId}`));
      bump();
    } else if (nw.catId !== catId) {
      batch.delete(doc(db, `salons/${salonId}/inventoryCategories/${catId}/inventorySubcategories/${subId}`));
      bump();
    }
  }

  for (const c of oldTree) {
    if (!desiredCatIds.has(c.id)) {
      batch.delete(doc(db, `salons/${salonId}/inventoryCategories/${c.id}`));
      bump();
    }
  }

  const activeLocId = _ffInvActiveLocId();
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem("ff_inv_debug") === "true") {
      console.log("[Inventory/loc] save categories — active=%o newCount=%d", activeLocId || "(none)", desiredTree.filter((c) => !oldCatIds.has(c.id)).length);
    }
  } catch (_) {}
  if (!activeLocId) {
    // Loud warning: stamping null here means the new doc will be invisible in
    // any explicitly-named branch. Almost always the wrong thing for a
    // multi-branch salon, but we still write so single-location accounts keep
    // working during onboarding.
    try {
      console.warn("[Inventory/loc] saving categories without an active locationId — new rows will fall back to the 'default' branch bucket.");
    } catch (_) {}
  }

  for (let ci = 0; ci < desiredTree.length; ci++) {
    const c = desiredTree[ci];
    const ref = doc(db, `salons/${salonId}/inventoryCategories/${c.id}`);
    if (!oldCatIds.has(c.id)) {
      batch.set(ref, {
        name: c.name,
        order: ci,
        locationId: activeLocId || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(ref, { name: c.name, order: ci, updatedAt: serverTimestamp() });
    }
    bump();
  }

  for (let ci = 0; ci < desiredTree.length; ci++) {
    const c = desiredTree[ci];
    for (let si = 0; si < c.subcategories.length; si++) {
      const s = c.subcategories[si];
      const order = si;
      const ref = doc(db, `salons/${salonId}/inventoryCategories/${c.id}/inventorySubcategories/${s.id}`);
      const old = oldSubById.get(s.id);
      const isNew = !oldSubById.has(s.id);
      const wasMoved = old && old.catId !== c.id;

      if (isNew) {
        batch.set(ref, {
          name: s.name,
          order,
          locationId: activeLocId || null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (wasMoved) {
        const ca = movedCreatedAt.get(s.id);
        const tbl = movedTableData.get(s.id);
        batch.set(ref, {
          name: s.name,
          order,
          locationId: activeLocId || null,
          createdAt: ca || serverTimestamp(),
          updatedAt: serverTimestamp(),
          groups: tbl ? tbl.groups : [],
          rows: tbl ? tbl.rows : [],
        });
      } else {
        batch.update(ref, { name: s.name, order, updatedAt: serverTimestamp() });
      }
      bump();
    }
  }

  flush();
  await Promise.all(commits);
}

function getCategoryTree() {
  return _categoryTree || [];
}

function cloneCategoryTree(tree) {
  return tree.map((c) => ({
    id: c.id,
    name: c.name,
    subcategories: (c.subcategories || []).map((s) => ({ id: s.id, name: s.name })),
  }));
}

function getManageCategoryTree() {
  if (_manageCategoriesOpen && _catManageDraftTree) return _catManageDraftTree;
  return getCategoryTree();
}

function ensureCatManageDraft() {
  if (!_catManageDraftTree) {
    _catManageDraftTree = cloneCategoryTree(_categoryTree || []);
  }
}

function reorderCatInDraft(dragCatId, targetCatId, placeBefore) {
  const tree = getManageCategoryTree();
  const fi = tree.findIndex((c) => c.id === dragCatId);
  const ti = tree.findIndex((c) => c.id === targetCatId);
  if (fi < 0 || ti < 0 || dragCatId === targetCatId) return;
  const [item] = tree.splice(fi, 1);
  let insertIdx = ti;
  if (fi < ti) insertIdx--;
  if (!placeBefore) insertIdx++;
  tree.splice(insertIdx, 0, item);
}

/** Move sub between categories or reorder within one category. targetSubId null = append to end of target category. */
function moveSubInDraft(dragCatId, dragSubId, targetCatId, targetSubId, placeBefore) {
  if (dragSubId === targetSubId && dragCatId === targetCatId) return;
  const tree = getManageCategoryTree();
  const sourceCat = tree.find((c) => c.id === dragCatId);
  if (!sourceCat) return;
  const fi = sourceCat.subcategories.findIndex((s) => s.id === dragSubId);
  if (fi < 0) return;
  const targetCat = tree.find((c) => c.id === targetCatId);
  if (!targetCat) return;

  const [item] = sourceCat.subcategories.splice(fi, 1);

  if (targetSubId == null) {
    targetCat.subcategories.push(item);
    return;
  }

  let ti = targetCat.subcategories.findIndex((s) => s.id === targetSubId);
  if (ti < 0) {
    targetCat.subcategories.push(item);
    return;
  }
  if (dragCatId === targetCatId && fi < ti) ti--;
  const insertIdx = placeBefore ? ti : ti + 1;
  targetCat.subcategories.splice(insertIdx, 0, item);
}

function bindCatManageDnDOnce(root) {
  if (root.dataset.ffCatManageDnd === "1") return;
  root.dataset.ffCatManageDnd = "1";
  let overEl = null;
  let overBlockEl = null;

  function clearOver() {
    if (overEl && overEl.isConnected) overEl.classList.remove("ff-inv2-cat-dnd-over");
    if (overBlockEl && overBlockEl.isConnected) overBlockEl.classList.remove("ff-inv2-cat-dnd-over-block");
    overEl = null;
    overBlockEl = null;
  }

  root.addEventListener("dragstart", (ev) => {
    const h = ev.target && ev.target.closest && ev.target.closest("[data-cat-dnd]");
    if (!h || !root.contains(h)) return;
    const kind = h.getAttribute("data-cat-dnd");
    const catId = h.getAttribute("data-cat-id");
    if (!catId) return;
    if (kind === "cat") {
      _catDndPayload = { kind: "cat", catId };
      try {
        ev.dataTransfer.setData("text/plain", `cat:${catId}`);
        ev.dataTransfer.effectAllowed = "move";
      } catch (e) {}
      const block = h.closest("[data-cat-manage-block]");
      if (block) block.classList.add("ff-inv2-cat-dnd-dragging");
    } else if (kind === "sub") {
      const subId = h.getAttribute("data-sub-id");
      if (!subId) return;
      _catDndPayload = { kind: "sub", catId, subId };
      try {
        ev.dataTransfer.setData("text/plain", `sub:${catId}:${subId}`);
        ev.dataTransfer.effectAllowed = "move";
      } catch (e) {}
      const row = h.closest("[data-cat-manage-sub]");
      if (row) row.classList.add("ff-inv2-cat-dnd-dragging");
    }
  });

  root.addEventListener("dragend", () => {
    _catDndPayload = null;
    clearOver();
    root.querySelectorAll(".ff-inv2-cat-dnd-dragging").forEach((el) => el.classList.remove("ff-inv2-cat-dnd-dragging"));
  });

  root.addEventListener("dragover", (ev) => {
    if (!_manageCategoriesOpen || !_catDndPayload) return;
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const pay = _catDndPayload;
    if (pay.kind === "cat") {
      const block = t.closest("[data-cat-manage-block]");
      if (!block || !root.contains(block)) return;
      ev.preventDefault();
      try {
        ev.dataTransfer.dropEffect = "move";
      } catch (e) {}
      if (block !== overEl) {
        clearOver();
        overEl = block;
        overEl.classList.add("ff-inv2-cat-dnd-over");
      }
      return;
    }
    if (pay.kind === "sub") {
      const block = t.closest("[data-cat-manage-block]");
      if (!block || !root.contains(block)) return;
      ev.preventDefault();
      try {
        ev.dataTransfer.dropEffect = "move";
      } catch (e) {}
      const subEl = t.closest("[data-cat-manage-sub]");
      const nextSub = subEl && root.contains(subEl) ? subEl : null;
      if (block !== overBlockEl || nextSub !== overEl) {
        clearOver();
        overBlockEl = block;
        overBlockEl.classList.add("ff-inv2-cat-dnd-over-block");
        if (nextSub) {
          overEl = nextSub;
          overEl.classList.add("ff-inv2-cat-dnd-over");
        }
      }
    }
  });

  root.addEventListener("drop", (ev) => {
    if (!_manageCategoriesOpen || !_catDndPayload) return;
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const pay = _catDndPayload;
    clearOver();
    ev.preventDefault();
    if (pay.kind === "cat") {
      const block = t.closest("[data-cat-manage-block]");
      if (!block || !root.contains(block)) return;
      const targetCatId = block.getAttribute("data-cat-id");
      if (!targetCatId || targetCatId === pay.catId) return;
      const rect = block.getBoundingClientRect();
      const placeBefore = ev.clientY < rect.top + rect.height / 2;
      reorderCatInDraft(pay.catId, targetCatId, placeBefore);
      mountOrRefreshMockUi();
      return;
    }
    if (pay.kind === "sub") {
      const block = t.closest("[data-cat-manage-block]");
      if (!block || !root.contains(block)) return;
      const targetCatId = block.getAttribute("data-cat-id");
      if (!targetCatId) return;

      const subEl = t.closest("[data-cat-manage-sub]");
      if (subEl && root.contains(subEl)) {
        const catId = subEl.getAttribute("data-cat-id");
        const targetSubId = subEl.getAttribute("data-sub-id");
        if (!catId || !targetSubId) return;
        if (targetSubId === pay.subId && catId === pay.catId) return;
        const rect = subEl.getBoundingClientRect();
        const placeBefore = ev.clientY < rect.top + rect.height / 2;
        moveSubInDraft(pay.catId, pay.subId, catId, targetSubId, placeBefore);
        mountOrRefreshMockUi();
        return;
      }

      const rows = block.querySelectorAll("[data-cat-manage-sub]");
      if (rows.length === 0) {
        moveSubInDraft(pay.catId, pay.subId, targetCatId, null, false);
        mountOrRefreshMockUi();
        return;
      }
      const firstTop = rows[0].getBoundingClientRect().top;
      if (ev.clientY < firstTop) {
        moveSubInDraft(pay.catId, pay.subId, targetCatId, rows[0].getAttribute("data-sub-id"), true);
        mountOrRefreshMockUi();
        return;
      }
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const r = row.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        if (ev.clientY < mid) {
          moveSubInDraft(pay.catId, pay.subId, targetCatId, row.getAttribute("data-sub-id"), true);
          mountOrRefreshMockUi();
          return;
        }
      }
      moveSubInDraft(pay.catId, pay.subId, targetCatId, null, false);
      mountOrRefreshMockUi();
    }
  });
}

function resetCatModalTransientState() {
  _renameCatId = null;
  _renameSubKey = null;
  _catMenuKey = null;
  _catDeleteModal = null;
  _inlineNewCat = false;
  _inlineNewSubCatId = null;
}

function ensureValidSubcategorySelection() {
  const tree = getCategoryTree();
  if (!tree.length) {
    _selectedSubcategoryId = null;
    return;
  }
  if (findSubMeta(_selectedSubcategoryId)) return;
  for (const c of tree) {
    if (c.subcategories && c.subcategories.length) {
      _selectedSubcategoryId = c.subcategories[0].id;
      return;
    }
  }
  _selectedSubcategoryId = null;
}

function clearInventoryTableSaveTimer() {
  if (_invTableSaveTimer) {
    clearTimeout(_invTableSaveTimer);
    _invTableSaveTimer = null;
  }
}

/** Normalize an approvedRequests[] entry from Firestore (defensive) — keeps required fields only. */
function normalizeApprovedRequestEntry(x) {
  if (!x || typeof x !== "object") return null;
  const requestId = x.requestId != null ? String(x.requestId).trim() : "";
  if (!requestId) return null;
  const qty = typeof x.qty === "number" ? x.qty : parseNum(x.qty);
  if (!Number.isFinite(qty) || qty === 0) return null;
  /** @type {Record<string, unknown>} */
  const out = { requestId, qty };
  if (x.at) out.at = x.at;
  if (x.by != null) out.by = String(x.by);
  if (x.byName != null) out.byName = String(x.byName);
  if (x.itemName != null) out.itemName = String(x.itemName);
  if (x.note != null) out.note = String(x.note);
  if (x.unit != null) out.unit = String(x.unit);
  return out;
}

function normalizeRowFromFirestore(r) {
  const byGroup = {};
  const raw = r && r.byGroup && typeof r.byGroup === "object" ? r.byGroup : {};
  for (const gid of Object.keys(raw)) {
    const cell = raw[gid];
    if (!cell || typeof cell !== "object") continue;
    const approvedRequestsRaw = Array.isArray(cell.approvedRequests) ? cell.approvedRequests : [];
    const approvedRequests = [];
    for (const entry of approvedRequestsRaw) {
      const ne = normalizeApprovedRequestEntry(entry);
      if (ne) approvedRequests.push(ne);
    }
    let approved =
      typeof cell.approved === "number"
        ? cell.approved
        : cell.approved != null
          ? parseNum(cell.approved)
          : 0;
    if (!Number.isFinite(approved)) approved = 0;
    if (approvedRequests.length > 0) {
      const sum = approvedRequests.reduce((acc, e) => acc + (Number(e.qty) || 0), 0);
      if (Math.abs(sum - approved) > 0.0001) approved = sum;
    }
    byGroup[gid] = {
      stock: typeof cell.stock === "number" ? cell.stock : parseNum(cell.stock),
      current: typeof cell.current === "number" ? cell.current : parseNum(cell.current),
      price: cell.price != null ? String(cell.price) : "",
      approved,
      approvedRequests,
    };
  }
  return {
    id: r.id || newRowId(),
    rowNo: r.rowNo != null ? String(r.rowNo) : "",
    code: r.code != null ? String(r.code) : "",
    name: r.name != null ? String(r.name) : "",
    supplier: r.supplier != null ? String(r.supplier) : "",
    url: r.url != null ? String(r.url) : "",
    byGroup,
  };
}

/** Serialize a normalized row to Firestore `rows[]` shape (matches `buildFirestoreRowsFromUi`). */
function serializeInventoryRowForFirestore(r) {
  const byGroup = {};
  for (const gid of Object.keys(r.byGroup || {})) {
    const c = r.byGroup[gid];
    if (!c) continue;
    const approvedRequestsIn = Array.isArray(c.approvedRequests) ? c.approvedRequests : [];
    const approvedRequests = [];
    for (const entry of approvedRequestsIn) {
      const ne = normalizeApprovedRequestEntry(entry);
      if (ne) approvedRequests.push(ne);
    }
    const approved = approvedRequests.reduce((acc, e) => acc + (Number(e.qty) || 0), 0);
    /** @type {Record<string, unknown>} */
    const out = {
      stock: typeof c.stock === "number" ? c.stock : parseNum(c.stock),
      current: typeof c.current === "number" ? c.current : parseNum(c.current),
      price: c.price != null ? String(c.price) : "",
    };
    if (approved > 0) out.approved = approved;
    if (approvedRequests.length > 0) out.approvedRequests = approvedRequests;
    byGroup[gid] = out;
  }
  return {
    id: r.id,
    rowNo: r.rowNo != null ? String(r.rowNo) : "",
    code: r.code != null ? String(r.code) : "",
    name: r.name != null ? String(r.name) : "",
    supplier: r.supplier != null ? String(r.supplier) : "",
    url: r.url != null ? String(r.url) : "",
    byGroup,
  };
}

function buildFirestoreGroupsFromUi() {
  if (!_groups) return [];
  return _groups.map((g, i) => ({ id: g.id, name: g.label, order: i }));
}

function defaultInvColWidthsObj() {
  return {
    rowDnd: 28,
    hash: 52,
    code: 76,
    name: 192,
    supplier: 96,
    url: 96,
    groupSubById: {},
  };
}

/** Build Firestore `columnWidths` map (group_<id> for each group block width). */
function buildColumnWidthsForFirestore() {
  const w = getInvColWidths();
  const o = {
    rowDnd: w.rowDnd ?? 28,
    hash: w.hash,
    code: w.code,
    name: w.name,
    supplier: w.supplier,
    url: w.url,
  };
  for (const gid of Object.keys(w.groupSubById || {})) {
    o[`group_${gid}`] = w.groupSubById[gid];
  }
  return o;
}

/**
 * Apply saved widths from subcategory doc; missing groups use default from getInvColWidths.
 * @param {Record<string, unknown> | null | undefined} data subcategory document data
 */
function applyColumnWidthsFromFirestore(data) {
  const base = defaultInvColWidthsObj();
  _invColWidths = base;
  const cw = data && data.columnWidths && typeof data.columnWidths === "object" ? data.columnWidths : null;
  if (!cw) return;
  const num = (v) => {
    const x = typeof v === "number" ? v : Number(v);
    return Number.isFinite(x) && x >= 20 ? Math.round(x) : null;
  };
  if (num(cw.rowDnd) != null) _invColWidths.rowDnd = num(cw.rowDnd);
  if (num(cw.hash) != null) _invColWidths.hash = num(cw.hash);
  if (num(cw.code) != null) _invColWidths.code = num(cw.code);
  if (num(cw.name) != null) _invColWidths.name = num(cw.name);
  if (num(cw.supplier) != null) _invColWidths.supplier = num(cw.supplier);
  if (num(cw.url) != null) _invColWidths.url = num(cw.url);
  for (const g of _groups || []) {
    const k = `group_${g.id}`;
    if (cw[k] != null && num(cw[k]) != null) _invColWidths.groupSubById[g.id] = num(cw[k]);
  }
}

async function persistColumnWidthsToFirestore() {
  if (!ensureTableReadyForEdits()) return;
  if (_invUndoPayload) {
    await flushInventoryTableToFirestore();
    return;
  }
  const meta = findSubMeta(_selectedSubcategoryId);
  if (!meta) return;
  const key = `${meta.category.id}:${meta.sub.id}`;
  if (_invTableLoadedForSubId !== key) return;
  const salonId = await getSalonId();
  if (!salonId) return;
  const ref = doc(db, `salons/${salonId}/inventoryCategories/${meta.category.id}/inventorySubcategories/${meta.sub.id}`);
  await updateDoc(ref, {
    columnWidths: buildColumnWidthsForFirestore(),
    updatedAt: serverTimestamp(),
  });
}

function buildFirestoreRowsFromUi() {
  if (!_rows) return [];
  return _rows.map((r) => {
    const byGroup = {};
    for (const gid of Object.keys(r.byGroup || {})) {
      const c = r.byGroup[gid];
      if (!c) continue;
      byGroup[gid] = {
        stock: typeof c.stock === "number" ? c.stock : parseNum(c.stock),
        current: typeof c.current === "number" ? c.current : parseNum(c.current),
        price: c.price != null ? String(c.price) : "",
      };
    }
    return {
      id: r.id,
      rowNo: r.rowNo != null ? String(r.rowNo) : "",
      code: r.code != null ? String(r.code) : "",
      name: r.name != null ? String(r.name) : "",
      supplier: r.supplier != null ? String(r.supplier) : "",
      url: r.url != null ? String(r.url) : "",
      byGroup,
    };
  });
}

function clearInventoryUndoAfterSuccess() {
  if (_invUndoTimer) {
    clearTimeout(_invUndoTimer);
    _invUndoTimer = null;
  }
  _invUndoPayload = null;
  removeInventoryUndoToastEl();
}

function removeInventoryUndoToastEl() {
  const el = document.getElementById(INV_UNDO_TOAST_ID);
  if (el) el.remove();
}

function showInventoryUndoToast(message) {
  removeInventoryUndoToastEl();
  const wrap = document.createElement("div");
  wrap.id = INV_UNDO_TOAST_ID;
  wrap.setAttribute("role", "status");
  const span = document.createElement("span");
  span.className = "ff-inv-undo-toast-msg";
  span.textContent = message;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ff-inv-undo-toast-btn";
  btn.textContent = "Undo";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleInventoryUndoClick();
  });
  wrap.appendChild(span);
  wrap.appendChild(btn);
  document.body.appendChild(wrap);
}

/** Deep clone a row for undo restore (all group cells). */
function cloneInvRowForUndo(r) {
  const byGroup = {};
  for (const k of Object.keys(r.byGroup || {})) {
    const c = r.byGroup[k];
    if (!c) continue;
    byGroup[k] = {
      stock: typeof c.stock === "number" ? c.stock : parseNum(c.stock),
      current: typeof c.current === "number" ? c.current : parseNum(c.current),
      price: String(c.price ?? ""),
    };
  }
  return {
    id: r.id,
    rowNo: String(r.rowNo ?? ""),
    code: String(r.code ?? ""),
    name: String(r.name ?? ""),
    supplier: String(r.supplier ?? ""),
    url: String(r.url ?? ""),
    byGroup,
  };
}

function handleInventoryUndoClick() {
  if (!_invUndoPayload || !_rows || !_groups) return;
  if (_invUndoTimer) {
    clearTimeout(_invUndoTimer);
    _invUndoTimer = null;
  }
  const p = _invUndoPayload;
  _invUndoPayload = null;
  removeInventoryUndoToastEl();
  if (p.kind === "row") {
    _rows.splice(p.index, 0, p.row);
  } else {
    _groups.splice(p.groupIndex, 0, { id: p.group.id, label: p.group.label });
    for (const row of _rows) {
      const cell = p.perRowCells[row.id];
      row.byGroup[p.group.id] = cell
        ? { stock: cell.stock, current: cell.current, price: cell.price }
        : { stock: 0, current: 0, price: "" };
    }
    if (p.groupColWidth != null) {
      getInvColWidths().groupSubById[p.group.id] = p.groupColWidth;
    }
  }
  ensureGroupCellsForRows();
  void flushInventoryTableToFirestore().catch((e) => console.error("[Inventory] undo restore flush failed", e));
  mountOrRefreshMockUi();
}

function startInventoryUndo(payload) {
  _invUndoPayload = payload;
  if (_invUndoTimer) {
    clearTimeout(_invUndoTimer);
    _invUndoTimer = null;
  }
  const msg = payload.kind === "row" ? "Row deleted" : "Group deleted";
  showInventoryUndoToast(msg);
  _invUndoTimer = setTimeout(() => {
    _invUndoTimer = null;
    void (async () => {
      try {
        await flushInventoryTableToFirestore();
      } catch (e) {
        console.error("[Inventory] undo window flush failed", e);
        if (_invUndoPayload) {
          showInventoryUndoToast(_invUndoPayload.kind === "row" ? "Row deleted" : "Group deleted");
        }
      }
    })();
  }, INV_UNDO_MS);
}

/** Commit a pending delete to Firestore before another destructive action. */
async function commitPendingInventoryDeleteIfAny() {
  if (!_invUndoPayload) return;
  if (_invUndoTimer) {
    clearTimeout(_invUndoTimer);
    _invUndoTimer = null;
  }
  removeInventoryUndoToastEl();
  try {
    await flushInventoryTableToFirestore();
  } catch (e) {
    showInventoryUndoToast(_invUndoPayload.kind === "row" ? "Row deleted" : "Group deleted");
    throw e;
  }
}

async function flushInventoryTableToFirestore() {
  clearInventoryTableSaveTimer();
  const meta = findSubMeta(_selectedSubcategoryId);
  if (!meta) return;
  const key = `${meta.category.id}:${meta.sub.id}`;
  if (_invTableLoadedForSubId !== key) return;
  if (!_groups || !_rows) return;
  const salonId = await getSalonId();
  if (!salonId) return;
  const ref = doc(db, `salons/${salonId}/inventoryCategories/${meta.category.id}/inventorySubcategories/${meta.sub.id}`);
  await updateDoc(ref, {
    groups: buildFirestoreGroupsFromUi(),
    rows: buildFirestoreRowsFromUi(),
    columnWidths: buildColumnWidthsForFirestore(),
    updatedAt: serverTimestamp(),
  });
  clearInventoryUndoAfterSuccess();
}

function scheduleInventoryTablePersist() {
  if (_invTableSaveTimer) clearTimeout(_invTableSaveTimer);
  _invTableSaveTimer = setTimeout(() => {
    _invTableSaveTimer = null;
    void flushInventoryTableToFirestore().catch((e) => console.error("[Inventory] table save failed", e));
  }, 400);
}

function ensureTableReadyForEdits() {
  return !_invTableLoading && !!_invTableLoadedForSubId && _groups !== null && _rows !== null;
}

async function loadInventoryTableForSub(catId, subId, seq, key) {
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    const ref = doc(db, `salons/${salonId}/inventoryCategories/${catId}/inventorySubcategories/${subId}`);
    const snap = await getDoc(ref);
    if (seq !== _invTableLoadSeq) return;
    if (!snap.exists()) {
      _groups = [];
      _rows = [];
      _invColWidths = null;
    } else {
      const data = snap.data();
      const groupsRaw = Array.isArray(data.groups) ? data.groups : [];
      groupsRaw.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      _groups = groupsRaw.map((g) => ({
        id: g.id,
        label: g.name != null ? String(g.name) : "",
      }));
      const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
      _rows = rowsRaw.map((r) => normalizeRowFromFirestore(r));
      applyColumnWidthsFromFirestore(data);
    }
    if (seq !== _invTableLoadSeq) return;
    _invTableLoadedForSubId = key;
    ensureGroupCellsForRows();
  } catch (e) {
    console.error("[Inventory] table load failed", e);
    if (seq !== _invTableLoadSeq) return;
    _groups = [];
    _rows = [];
    _invColWidths = null;
    _invTableLoadedForSubId = key;
  } finally {
    if (seq === _invTableLoadSeq) {
      _invTableLoading = false;
      mountOrRefreshMockUi();
    }
  }
}

function prepareInventoryTableStateForMount() {
  const meta = findSubMeta(_selectedSubcategoryId);
  if (!meta) {
    _groups = null;
    _rows = null;
    _invColWidths = null;
    _invTableLoadedForSubId = null;
    _invTableLoading = false;
    return;
  }
  const key = `${meta.category.id}:${meta.sub.id}`;
  if (_invTableLoadedForSubId === key && !_invTableLoading && Array.isArray(_groups) && Array.isArray(_rows)) {
    ensureGroupCellsForRows();
    return;
  }
  if (_invTableLoading) return;
  clearInventoryTableSaveTimer();
  _invTableLoading = true;
  _invTableLoadedForSubId = null;
  _invColWidths = null;
  _groups = [];
  _rows = [];
  const seq = ++_invTableLoadSeq;
  void loadInventoryTableForSub(meta.category.id, meta.sub.id, seq, key);
}

function parseNum(v) {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

/** Order line `itemId` is `subId:rowId:groupId`; older data may be a plain row id. */
function parseRowIdFromInventoryItemId(itemId) {
  const s = String(itemId ?? "").trim();
  if (!s) return "";
  const parts = s.split(":");
  if (parts.length >= 3) {
    return parts.slice(1, -1).join(":");
  }
  return s;
}

function getItemOrderQty(it) {
  if (it == null || typeof it !== "object") return 0;
  return typeof it.orderQty === "number" ? it.orderQty : parseNum(it.orderQty);
}

function getItemReceivedCumulative(it) {
  if (it == null || typeof it !== "object") return 0;
  if (it.receivedCumulative != null) return parseNum(it.receivedCumulative);
  return 0;
}

function getOrderLinePrice(it) {
  if (it == null || typeof it !== "object") return 0;
  if (it.price == null || it.price === "") return 0;
  return typeof it.price === "number" ? it.price : parseNum(it.price);
}

function getOrderDetailTotals(items) {
  const arr = Array.isArray(items) ? items : [];
  let orderedQty = 0;
  let receivedQty = 0;
  let estimatedCost = 0;
  for (const it of arr) {
    const oq = getItemOrderQty(it);
    const cum = getItemReceivedCumulative(it);
    const price = getOrderLinePrice(it);
    orderedQty += oq;
    receivedQty += cum;
    estimatedCost += oq * price;
  }
  const r = Math.round(estimatedCost * 100) / 100;
  return { lineCount: arr.length, orderedQty, receivedQty, estimatedCost: r };
}

/** Per-line effective progress: cumulative received + applied purchase quantity (treated as received). */
function getItemEffectiveReceivedQty(it) {
  const cum = getItemReceivedCumulative(it);
  const applied = isItemPurchaseAppliedToInventory(it) ? getItemStoredQtyBought(it) : 0;
  return Math.max(cum, applied);
}

/** Unified order progress computed from items: open (no B yet) / in_progress (some) / done (B ≥ N for all). */
function computeUnifiedStatusFromItems(items) {
  const arr = Array.isArray(items) ? items : [];
  if (arr.length === 0) return "open";
  let hasAny = false;
  let allFull = true;
  for (const it of arr) {
    const oq = getItemOrderQty(it);
    const b = getItemEffectiveReceivedQty(it);
    if (b > 0) hasAny = true;
    if (oq <= 0) continue;
    if (b < oq) allFull = false;
  }
  if (!hasAny) return "open";
  if (allFull) return "done";
  return "in_progress";
}

/** Back-compat shim (legacy name). Same result as computeUnifiedStatusFromItems. */
function computeReceiveStatusFromItems(items) {
  return computeUnifiedStatusFromItems(items);
}

/** Auto-computed status for an order: always derived from items (unified for shopping + delivery). */
function getEffectiveInventoryOrderStatus(o) {
  if (!o || typeof o !== "object") return "open";
  const items = Array.isArray(o.items) ? o.items : [];
  return computeUnifiedStatusFromItems(items);
}

/** True if any item already applied to inventory (either via Confirm Purchase or Confirm Receive history). */
function orderHasAppliedInventoryImpact(o) {
  if (!o || typeof o !== "object") return false;
  const items = Array.isArray(o.items) ? o.items : [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    if (it.appliedToInventory === true) return true;
    if (getItemReceivedCumulative(it) > 0) return true;
  }
  return false;
}

/** UI-only: per-line receive state for Order Details row styling. Treats applied purchases (draft → Confirm Purchase) as received progress too. */
function getOrderLineReceiveVisualState(it) {
  const oq = getItemOrderQty(it);
  const progress = getItemEffectiveReceivedQty(it);
  if (progress === 0) {
    return {
      kind: "open",
      rowClass: "ff-inv2-od-tr--open",
      label: "Open",
      badgeClass: "ff-inv2-od-line-badge--open",
    };
  }
  if (oq > 0 && progress >= oq) {
    return {
      kind: "received",
      rowClass: "ff-inv2-od-tr--recv-full",
      label: "Received",
      badgeClass: "ff-inv2-od-line-badge--full",
    };
  }
  return {
    kind: "partial",
    rowClass: "ff-inv2-od-tr--recv-partial",
    label: "Partial",
    badgeClass: "ff-inv2-od-line-badge--partial",
  };
}

function orderDetailLineMatchesFilter(it) {
  if (_invOrderDetailFilter === "all") return true;
  const { kind } = getOrderLineReceiveVisualState(it);
  if (_invOrderDetailFilter === "open") return kind === "open" || kind === "partial";
  if (_invOrderDetailFilter === "received") return kind === "received";
  return true;
}

const _invOrderDetailKindRank = { open: 0, partial: 1, received: 2 };

/**
 * Receiving list: open / partial lines first, then received; stable within each band.
 * @param {{ it: unknown, idx: number }[]} filteredPairs
 * @returns {{ it: unknown, idx: number }[]}
 */
function sortOrderDetailPairsOpenFirst(filteredPairs) {
  return [...filteredPairs].sort((a, b) => {
    const ka = getOrderLineReceiveVisualState(a.it).kind;
    const kb = getOrderLineReceiveVisualState(b.it).kind;
    const ra = _invOrderDetailKindRank[ka] ?? 99;
    const rb = _invOrderDetailKindRank[kb] ?? 99;
    if (ra !== rb) return ra - rb;
    return a.idx - b.idx;
  });
}

function getOrderDetailDisplayPairsForExport(o) {
  const items = Array.isArray(o.items) ? o.items : [];
  const filteredPairs = items
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => orderDetailLineMatchesFilter(it));
  return sortOrderDetailPairsOpenFirst(filteredPairs);
}

function escapeCsvCell(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Group label from order line (`groupName`), trimmed — UI/export only; no schema change. */
function getOrderItemGroupLabel(it) {
  if (!it || it.groupName == null) return "";
  return String(it.groupName).trim();
}

function sanitizeOrderExportFilenamePart(s) {
  return (
    String(s ?? "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 80) || "order"
  );
}

function getOrderDetailExportFilename(o) {
  const name = sanitizeOrderExportFilenamePart(getInventoryOrderDisplayName(o));
  const st = sanitizeOrderExportFilenamePart(formatInventoryOrderStatusDisplay(o));
  return `${name}_${st}.csv`;
}

function buildOrderDetailCsvContent(o) {
  const pairs = getOrderDetailDisplayPairsForExport(o);
  const st = o.status != null ? String(o.status) : "draft";
  const showExtra = st !== "draft" && Array.isArray(o.items) && o.items.length > 0;
  ensureShoppingDraft(o.id);
  const shop = _invOrderShoppingDraft[o.id];
  const header = showExtra
    ? ["Checked", "Item", "K", "N", "B", "Recv total"]
    : ["Checked", "Item", "K", "N", "B"];
  const lines = [header.map(escapeCsvCell).join(",")];
  for (const { it, idx } of pairs) {
    const ordQ = formatOrderDisplay(getItemOrderQty(it));
    const cumStr = formatOrderDisplay(getItemReceivedCumulative(it));
    const nm = it.itemName != null ? String(it.itemName) : "";
    const gLbl = getOrderItemGroupLabel(it);
    const itemCsv = gLbl ? `${nm}\n(${gLbl})` : nm;
    const cd = it.code != null ? String(it.code) : "";
    const chk = shop && shop.checked[idx] ? "Yes" : "";
    const qb = shop && shop.qtyBought[idx] != null ? String(shop.qtyBought[idx]) : "";
    if (showExtra) {
      lines.push([chk, itemCsv, cd, ordQ, qb, cumStr].map(escapeCsvCell).join(","));
    } else {
      lines.push([chk, itemCsv, cd, ordQ, qb].map(escapeCsvCell).join(","));
    }
  }
  return lines.join("\r\n");
}

function buildOrderDetailPrintDocumentHtml(o) {
  const src = formatInventoryOrderSourceLabel(o);
  const created = formatInventoryOrderCreatedAt(o.createdAt);
  const statusLabel = formatInventoryOrderStatusDisplay(o);
  const orderedAt = o.orderedAt ? formatInventoryOrderCreatedAt(o.orderedAt) : "";
  const orderedBy = o.orderedAt ? formatInventoryOrderOrderedByDisplay(o.orderedBy) : "";
  const n = typeof o.itemCount === "number" ? o.itemCount : Array.isArray(o.items) ? o.items.length : 0;
  const items = Array.isArray(o.items) ? o.items : [];
  const st = o.status != null ? String(o.status) : "draft";
  const showExtra = st !== "draft" && items.length > 0;
  const pairs = getOrderDetailDisplayPairsForExport(o);
  ensureShoppingDraft(o.id);
  const shop = _invOrderShoppingDraft[o.id];
  const title = getInventoryOrderDisplayName(o);
  let metaHtml = `<div class="meta">`;
  metaHtml += `<div><strong>Source:</strong> ${escapeHtml(src)}</div>`;
  metaHtml += `<div><strong>Status:</strong> ${escapeHtml(statusLabel)}</div>`;
  metaHtml += `<div><strong>Created:</strong> ${escapeHtml(created)}</div>`;
  if (orderedAt) {
    metaHtml += `<div><strong>Ordered:</strong> ${escapeHtml(orderedAt)}</div>`;
    metaHtml += `<div><strong>Ordered by:</strong> ${escapeHtml(orderedBy)}</div>`;
  }
  metaHtml += `<div><strong>Items:</strong> ${escapeHtml(String(n))}</div>`;
  metaHtml += `</div>`;
  let thead = "";
  let tbody = "";
  if (showExtra) {
    thead = `<thead><tr><th>✓</th><th>Item</th><th>K</th><th>N</th><th>B</th><th>Recv total</th></tr></thead>`;
    for (const { it, idx } of pairs) {
      const ordQ = formatOrderDisplay(getItemOrderQty(it));
      const cumStr = formatOrderDisplay(getItemReceivedCumulative(it));
      const chk = shop && shop.checked[idx] ? "Yes" : "";
      const qb = shop && shop.qtyBought[idx] != null ? String(shop.qtyBought[idx]) : "";
      const gP = getOrderItemGroupLabel(it);
      const itemPrint =
        gP !== ""
          ? `<span class="print-item-name">${escapeHtml(it.itemName != null ? String(it.itemName) : "")}</span><span class="print-item-group">(${escapeHtml(gP)})</span>`
          : `<span class="print-item-name">${escapeHtml(it.itemName != null ? String(it.itemName) : "")}</span>`;
      tbody += `<tr>
  <td>${escapeHtml(chk)}</td>
  <td>${itemPrint}</td>
  <td>${escapeHtml(it.code != null ? String(it.code) : "")}</td>
  <td>${escapeHtml(ordQ)}</td>
  <td>${escapeHtml(qb)}</td>
  <td>${escapeHtml(cumStr)}</td>
</tr>`;
    }
  } else {
    thead = `<thead><tr><th>✓</th><th>Item</th><th>K</th><th>N</th><th>B</th></tr></thead>`;
    for (const { it, idx } of pairs) {
      const ordQ = formatOrderDisplay(getItemOrderQty(it));
      const chk = shop && shop.checked[idx] ? "Yes" : "";
      const qb = shop && shop.qtyBought[idx] != null ? String(shop.qtyBought[idx]) : "";
      const gP = getOrderItemGroupLabel(it);
      const itemPrint =
        gP !== ""
          ? `<span class="print-item-name">${escapeHtml(it.itemName != null ? String(it.itemName) : "")}</span><span class="print-item-group">(${escapeHtml(gP)})</span>`
          : `<span class="print-item-name">${escapeHtml(it.itemName != null ? String(it.itemName) : "")}</span>`;
      tbody += `<tr>
  <td>${escapeHtml(chk)}</td>
  <td>${itemPrint}</td>
  <td>${escapeHtml(it.code != null ? String(it.code) : "")}</td>
  <td>${escapeHtml(ordQ)}</td>
  <td>${escapeHtml(qb)}</td>
</tr>`;
    }
  }
  const titleSafe = escapeHtml(title);
  const emptyColspan = showExtra ? 6 : 5;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${titleSafe}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0.4in; color: #0f172a; font-size: 12px; line-height: 1.4; }
  h1 { font-size: 18px; margin: 0 0 12px; font-weight: 700; }
  .meta { margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0; }
  .meta div { margin: 3px 0; }
  table { border-collapse: collapse; width: 100%; font-size: 11px; }
  th, td { border: 1px solid #cbd5e1; padding: 5px 7px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; font-weight: 600; color: #334155; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  @media print {
    body { margin: 0.25in; }
    th { background: #f8fafc !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  .print-item-name { display: block; font-weight: 400; color: #0f172a; }
  .print-item-group { display: block; font-size: 10px; font-weight: 400; color: #64748b; margin-top: 2px; line-height: 1.2; }
</style>
</head>
<body>
  <h1>${titleSafe}</h1>
  ${metaHtml}
  <table>
  ${thead}
  <tbody>${tbody ? tbody : `<tr><td colspan="${emptyColspan}">No lines match the current filter.</td></tr>`}</tbody>
  </table>
</body>
</html>`;
}

function triggerOrderDetailExportCsv() {
  if (isInvOrderDetailCommitBusy()) return;
  const id = _invOrdersDetailOrderId;
  if (!id) return;
  const o = _invOrdersList.find((x) => x.id === id);
  if (!o) return;
  const csv = `\ufeff${buildOrderDetailCsvContent(o)}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = getOrderDetailExportFilename(o);
  a.click();
  URL.revokeObjectURL(url);
}

function triggerOrderDetailPrint() {
  if (isInvOrderDetailCommitBusy()) return;
  const id = _invOrdersDetailOrderId;
  if (!id) return;
  const o = _invOrdersList.find((x) => x.id === id);
  if (!o) return;
  const html = buildOrderDetailPrintDocumentHtml(o);
  const w = window.open("", "_blank", "noopener,noreferrer");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    try {
      w.print();
    } catch (e) {
      /* ignore */
    }
    w.close();
  }, 200);
}

function getOrderReceiveSummaryCounts(items) {
  let open = 0;
  let partial = 0;
  let received = 0;
  let remainingQty = 0;
  for (const it of items) {
    const { kind } = getOrderLineReceiveVisualState(it);
    if (kind === "open") open += 1;
    else if (kind === "partial") partial += 1;
    else if (kind === "received") received += 1;
    const oq = getItemOrderQty(it);
    const cum = getItemReceivedCumulative(it);
    remainingQty += Math.max(0, oq - cum);
  }
  return { open, partial, received, remainingQty };
}

function ensureDetailReceiveDraft(orderId) {
  const o = _invOrdersList.find((x) => x.id === orderId);
  if (!o) return;
  const st = o.status != null ? String(o.status) : "draft";
  if (st !== "ordered" && st !== "partially_received") {
    delete _invDetailReceiveDraft[orderId];
    return;
  }
  const items = Array.isArray(o.items) ? o.items : [];
  const existing = _invDetailReceiveDraft[orderId];
  if (existing && existing.checked.length === items.length) return;
  const checked = items.map(() => false);
  const qty = items.map((it) => {
    const oq = getItemOrderQty(it);
    const cum = getItemReceivedCumulative(it);
    const rem = Math.max(0, oq - cum);
    return formatOrderDisplay(rem);
  });
  _invDetailReceiveDraft[orderId] = { checked, qty };
}

/** Qty bought persisted on order line (Confirm Purchase). */
function getItemStoredQtyBought(it) {
  if (!it || typeof it !== "object" || it.qtyBought == null) return 0;
  return parseNum(it.qtyBought);
}

function isItemPurchaseAppliedToInventory(it) {
  return !!(it && typeof it === "object" && it.appliedToInventory === true);
}

/**
 * Ensures local shopping-list state for Order Details (all statuses). Seeds from receive draft when present.
 * Local draft wins over Firestore when the user is editing; otherwise seeds qty/check from order.items (qtyBought, appliedToInventory).
 * @param {string} orderId
 */
function ensureShoppingDraft(orderId) {
  const o = _invOrdersList.find((x) => x.id === orderId);
  if (!o) return;
  const items = Array.isArray(o.items) ? o.items : [];
  const prev = _invOrderShoppingDraft[orderId];
  ensureDetailReceiveDraft(orderId);
  const recv = _invDetailReceiveDraft[orderId];
  const n = items.length;
  const checked = [];
  const qtyBought = [];
  for (let i = 0; i < n; i++) {
    const it = items[i];
    const storedQtyRaw =
      it && typeof it === "object" && it.qtyBought != null ? String(it.qtyBought).trim() : "";
    const applied = isItemPurchaseAppliedToInventory(it);

    const prevQtyRaw =
      prev && prev.qtyBought[i] != null ? String(prev.qtyBought[i]).trim() : "";
    const prevHadQty = prev && prev.qtyBought[i] !== undefined && prevQtyRaw !== "";
    const recvQtyRaw = recv && recv.qty[i] != null ? String(recv.qty[i]).trim() : "";

    if (prevHadQty) {
      qtyBought[i] = String(prev.qtyBought[i]);
    } else if (applied && storedQtyRaw !== "") {
      qtyBought[i] = storedQtyRaw;
    } else if (recvQtyRaw !== "") {
      qtyBought[i] = recvQtyRaw;
    } else if (storedQtyRaw !== "") {
      qtyBought[i] = storedQtyRaw;
    } else {
      qtyBought[i] = "";
    }

    if (applied) {
      checked[i] = true;
    } else if (prev && prev.checked[i] !== undefined) {
      checked[i] = !!prev.checked[i];
    } else if (recv && recv.checked[i] != null) {
      checked[i] = !!recv.checked[i];
    } else if (storedQtyRaw !== "") {
      checked[i] = parseNum(storedQtyRaw) > 0;
    } else {
      checked[i] = false;
    }
  }
  _invOrderShoppingDraft[orderId] = { checked, qtyBought };
}

/** Order = max(Stock - Current, 0) + max(Approved, 0). Approved is the sum of applied Supply Requests. */
function computeOrder(stock, current, approved) {
  const s = typeof stock === "number" ? stock : parseNum(stock);
  const c = typeof current === "number" ? current : parseNum(current);
  const a = approved == null ? 0 : typeof approved === "number" ? approved : parseNum(approved);
  return Math.max(0, s - c) + Math.max(0, a);
}

/** Extract approved qty + contributions from a normalized cell (back-compat defaults). */
function getCellApprovedInfo(cell) {
  if (!cell || typeof cell !== "object") return { approved: 0, approvedRequests: [] };
  const approvedRequests = Array.isArray(cell.approvedRequests) ? cell.approvedRequests : [];
  const approved =
    approvedRequests.length > 0
      ? approvedRequests.reduce((acc, e) => acc + (typeof e?.qty === "number" ? e.qty : parseNum(e?.qty)), 0)
      : typeof cell.approved === "number"
        ? cell.approved
        : cell.approved != null
          ? parseNum(cell.approved)
          : 0;
  return { approved: Number.isFinite(approved) ? approved : 0, approvedRequests };
}

function formatOrderDisplay(n) {
  if (Number.isInteger(n)) return String(n);
  const r = Math.round(n * 100) / 100;
  return String(r);
}

function formatOrderDetailEstimatedCost(n) {
  const v = Number(n);
  const amount = Number.isFinite(v) ? v : 0;
  if (typeof window !== "undefined" && typeof window.ffFormatCurrency === "function") {
    return window.ffFormatCurrency(amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const r = Math.round(amount * 100) / 100;
  try {
    return r.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch (e) {
    return r.toFixed(2);
  }
}

function ensureGroupCellsForLocal(groups, rows) {
  if (!groups || !rows) return;
  for (const row of rows) {
    if (row.rowNo === undefined) row.rowNo = "";
    for (const g of groups) {
      if (!row.byGroup[g.id]) {
        row.byGroup[g.id] = { stock: 0, current: 0, price: "" };
      }
    }
  }
}

/** Parse Firestore subcategory doc into local groups/rows without touching global table state. */
function parseSubcategoryDocToTable(data) {
  const groupsRaw = Array.isArray(data.groups) ? data.groups : [];
  groupsRaw.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const groups = groupsRaw.map((g) => ({
    id: g.id,
    label: g.name != null ? String(g.name) : "",
  }));
  const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
  const rows = rowsRaw.map((r) => normalizeRowFromFirestore(r));
  ensureGroupCellsForLocal(groups, rows);
  return { groups, rows };
}

function findCategoryAndSubForSubId(subId) {
  if (!subId) return null;
  for (const c of getCategoryTree()) {
    const sub = (c.subcategories || []).find((s) => s.id === subId);
    if (sub) return { category: c, sub };
  }
  return null;
}

/**
 * One line per row×group where Stock − Current > 0.
 * itemId is unique across subcategories when subId is included.
 */
function buildOrderLinesFromGroupsRows(groups, rows, subId, subName, categoryId, categoryName) {
  if (!groups || !rows) return [];
  const lines = [];
  const subLabel = subName != null ? String(subName) : "";
  const catId = categoryId != null ? String(categoryId) : null;
  const catNm = categoryName != null ? String(categoryName) : null;
  for (const row of rows) {
    for (const g of groups) {
      const cell = row.byGroup[g.id];
      if (!cell) continue;
      const { approved } = getCellApprovedInfo(cell);
      const oq = computeOrder(cell.stock, cell.current, approved);
      if (oq <= 0) continue;
      lines.push({
        itemId: `${subId}:${row.id}:${g.id}`,
        rowNo: String(row.rowNo ?? ""),
        code: String(row.code ?? ""),
        itemName: String(row.name ?? ""),
        supplier: String(row.supplier ?? ""),
        url: String(row.url ?? ""),
        groupId: g.id,
        groupName: String(g.label ?? ""),
        orderQty: oq,
        price: String(cell.price ?? ""),
        categoryId: catId,
        categoryName: catNm,
        subcategoryId: subId,
        subcategoryName: subLabel,
      });
    }
  }
  return lines;
}

function sortOrderBuilderLines(lines) {
  lines.sort((a, b) => {
    const sa = String(a.subcategoryName || "");
    const sb = String(b.subcategoryName || "");
    if (sa !== sb) return sa.localeCompare(sb);
    const ca = String(a.code || "");
    const cb = String(b.code || "");
    if (ca !== cb) return ca.localeCompare(cb);
    return String(a.itemName || "").localeCompare(String(b.itemName || ""));
  });
}

async function fetchSubcategoryInventoryDoc(salonId, catId, subId) {
  const ref = doc(db, `salons/${salonId}/inventoryCategories/${catId}/inventorySubcategories/${subId}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data();
}

async function buildOrderPreviewLinesForSubIds(salonId, catId, subList, categoryName) {
  const subs = Array.isArray(subList) ? subList : [];
  const catNm = categoryName != null ? String(categoryName) : null;
  const tasks = subs.map(async (sub) => {
    const data = await fetchSubcategoryInventoryDoc(salonId, catId, sub.id);
    if (!data) return [];
    const { groups, rows } = parseSubcategoryDocToTable(data);
    return buildOrderLinesFromGroupsRows(groups, rows, sub.id, sub.name, catId, catNm);
  });
  const chunks = await Promise.all(tasks);
  return chunks.flat();
}

async function buildOrderPreviewLinesForCustomSubIds(salonId, subIds) {
  const ids = Array.isArray(subIds) ? subIds : [];
  const tasks = ids.map(async (sid) => {
    const m = findCategoryAndSubForSubId(sid);
    if (!m) return [];
    const data = await fetchSubcategoryInventoryDoc(salonId, m.category.id, sid);
    if (!data) return [];
    const { groups, rows } = parseSubcategoryDocToTable(data);
    return buildOrderLinesFromGroupsRows(
      groups,
      rows,
      m.sub.id,
      m.sub.name,
      m.category.id,
      m.category.name != null ? String(m.category.name) : null
    );
  });
  const chunks = await Promise.all(tasks);
  return chunks.flat();
}

function syncOrderBuilderPreviewFromCurrentSub() {
  const meta = getSelectedSubMeta();
  if (!meta || !_groups || !_rows) {
    _invOrderBuilderPreviewLines = [];
    _invOrderBuilderPreviewLoading = false;
    return;
  }
  _invOrderBuilderPreviewLines = buildOrderLinesFromGroupsRows(
    _groups,
    _rows,
    meta.sub.id,
    meta.sub.name,
    meta.category.id,
    meta.category.name != null ? String(meta.category.name) : null
  );
  _invOrderBuilderPreviewLoading = false;
}

/** No auto-seeding — user starts with a clean tree and explicitly picks what to include. */
function seedOrderBuilderSelectionIfEmpty() {
  // intentionally empty
}

/** Make sure any category that contains a checked subcategory stays expanded so the selection is visible. */
function expandOrderBuilderCatsForCurrentSelection() {
  if (_invOrderBuilderCustomSubIds.size === 0) return;
  for (const c of getCategoryTree()) {
    const subs = c.subcategories || [];
    if (subs.some((s) => _invOrderBuilderCustomSubIds.has(s.id))) {
      _invOrderBuilderExpandedCatIds.add(c.id);
    }
  }
}

function prepareOrderBuilderPreviewForMount() {
  if (_invMainTab !== "orderBuilder") return;
}

async function refreshOrderBuilderPreviewAsync() {
  if (_invMainTab !== "orderBuilder") return;
  seedOrderBuilderSelectionIfEmpty();
  const seq = ++_invOrderBuilderPreviewSeq;
  _invOrderBuilderPreviewLoading = true;
  mountOrRefreshMockUi();
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    const ids = Array.from(_invOrderBuilderCustomSubIds);
    let lines = [];
    if (ids.length > 0) {
      lines = await buildOrderPreviewLinesForCustomSubIds(salonId, ids);
    }
    sortOrderBuilderLines(lines);
    if (seq !== _invOrderBuilderPreviewSeq) return;
    _invOrderBuilderPreviewLines = lines;
  } catch (e) {
    console.error("[Inventory] order builder preview failed", e);
    if (seq !== _invOrderBuilderPreviewSeq) return;
    _invOrderBuilderPreviewLines = [];
    inventoryOrderDraftToast("Could not load inventory for this selection.", "error");
  } finally {
    if (seq === _invOrderBuilderPreviewSeq) {
      _invOrderBuilderPreviewLoading = false;
      mountOrRefreshMockUi();
    }
  }
}

function renderOrderBuilderCustomTreeHtml() {
  const tree = getCategoryTree();
  if (!tree.length) {
    return `<p class="ff-inv2-ob-tree-empty">No categories yet.</p>`;
  }
  const parts = [];
  for (const c of tree) {
    const subs = c.subcategories || [];
    const isOpen = _invOrderBuilderExpandedCatIds.has(c.id);
    const someChecked = subs.length > 0 && subs.some((s) => _invOrderBuilderCustomSubIds.has(s.id));
    const allChecked = subs.length > 0 && subs.every((s) => _invOrderBuilderCustomSubIds.has(s.id));
    const subsHtml = subs.length
      ? subs
          .map((s) => {
            const checked = _invOrderBuilderCustomSubIds.has(s.id);
            return `<label class="ff-inv2-ob-sub-label">
  <input type="checkbox" data-inv-ob-sub="${escapeHtml(c.id)}:${escapeHtml(s.id)}"${checked ? " checked" : ""} />
  <span>${escapeHtml(s.name)}</span>
</label>`;
          })
          .join("")
      : `<span class="ff-inv2-ob-tree-empty">No subcategories</span>`;
    const countLabel = subs.length
      ? someChecked
        ? `${subs.filter((s) => _invOrderBuilderCustomSubIds.has(s.id)).length}/${subs.length}`
        : `${subs.length}`
      : "0";
    parts.push(`<div class="ff-inv2-ob-cat-block${isOpen ? " ff-inv2-ob-cat-block--open" : ""}" data-inv-ob-cat-block="${escapeHtml(c.id)}">
  <div class="ff-inv2-ob-cat-row">
    <button type="button" class="ff-inv2-ob-cat-toggle" data-inv-ob-cat-toggle="${escapeHtml(c.id)}" aria-expanded="${isOpen ? "true" : "false"}" aria-label="${isOpen ? "Collapse" : "Expand"} ${escapeHtml(c.name)}">
      <span class="ff-inv2-ob-cat-chev" aria-hidden="true">${isOpen ? "▾" : "▸"}</span>
    </button>
    <label class="ff-inv2-ob-cat-label">
      <input type="checkbox" data-inv-ob-cat="${escapeHtml(c.id)}"${allChecked ? " checked" : ""} />
      <span class="ff-inv2-ob-cat-name">${escapeHtml(c.name)}</span>
    </label>
    <span class="ff-inv2-ob-cat-count" aria-hidden="true">${escapeHtml(countLabel)}</span>
  </div>
  ${isOpen ? `<div class="ff-inv2-ob-subs">${subsHtml}</div>` : ""}
</div>`);
  }
  return `<div class="ff-inv2-ob-tree" role="group" aria-label="Subcategories">${parts.join("")}</div>`;
}

function renderOrderBuilderSourceHtml() {
  seedOrderBuilderSelectionIfEmpty();
  expandOrderBuilderCatsForCurrentSelection();
  return `<div class="ff-inv2-ob-source">
  <p class="ff-inv2-ob-source-title">Create Order</p>
  <p class="ff-inv2-ob-source-hint">Pick categories or subcategories to include, then review below.</p>
  <div class="ff-inv2-ob-custom">${renderOrderBuilderCustomTreeHtml()}</div>
</div>`;
}

function syncOrderBuilderCategoryCheckboxIndeterminate(root) {
  root.querySelectorAll("[data-inv-ob-cat-block]").forEach((block) => {
    const catId = block.getAttribute("data-inv-ob-cat-block");
    if (!catId) return;
    const cat = getCategoryTree().find((c) => c.id === catId);
    if (!cat) return;
    const subs = cat.subcategories || [];
    const inp = block.querySelector("input[data-inv-ob-cat]");
    if (!(inp instanceof HTMLInputElement)) return;
    const checkedCount = subs.filter((s) => _invOrderBuilderCustomSubIds.has(s.id)).length;
    if (checkedCount === 0) {
      inp.checked = false;
      inp.indeterminate = false;
    } else if (subs.length && checkedCount === subs.length) {
      inp.checked = true;
      inp.indeterminate = false;
    } else {
      inp.checked = false;
      inp.indeterminate = true;
    }
  });
}

function inventoryOrderDraftToast(message, variant) {
  if (typeof window !== "undefined" && window.ffToast && typeof window.ffToast.show === "function") {
    window.ffToast.show(String(message), { variant: variant || "info", durationMs: 3800 });
  }
}

/** Fill category/subcategory on a preview line from the category tree when missing. */
function enrichOrderLineWithCategoryContext(L) {
  if (
    L.categoryId != null &&
    L.categoryName != null &&
    L.subcategoryId != null &&
    L.subcategoryName != null
  ) {
    return L;
  }
  const m = findCategoryAndSubForSubId(L.subcategoryId);
  if (!m) return L;
  return {
    ...L,
    categoryId: L.categoryId != null ? L.categoryId : m.category.id,
    categoryName:
      L.categoryName != null ? L.categoryName : m.category.name != null ? String(m.category.name) : null,
    subcategoryId: L.subcategoryId != null ? L.subcategoryId : m.sub.id,
    subcategoryName:
      L.subcategoryName != null ? L.subcategoryName : m.sub.name != null ? String(m.sub.name) : null,
  };
}

/**
 * Draft document source fields from current Order Builder mode (not sidebar alone).
 * @returns {{ sourceType: string, sourceSelection: object, categoryId: string | null, categoryName: string | null, subcategoryId: string | null, subcategoryName: string | null } | null}
 */
function buildInventoryOrderDraftSourcePayload() {
  const ids = Array.from(_invOrderBuilderCustomSubIds).sort();
  const categoryIdsSet = new Set();
  const subcategoryIds = [];
  const subcategoryNames = [];
  for (const sid of ids) {
    const m = findCategoryAndSubForSubId(sid);
    if (!m) continue;
    categoryIdsSet.add(m.category.id);
    subcategoryIds.push(m.sub.id);
    subcategoryNames.push(m.sub.name != null ? String(m.sub.name) : "");
  }
  const categoryIds = Array.from(categoryIdsSet).sort();
  const sourceSelection = {
    categoryIds,
    subcategoryIds,
    subcategoryNames,
  };
  let categoryId = null;
  let categoryName = null;
  if (categoryIds.length === 1) {
    const cat = getCategoryTree().find((c) => c.id === categoryIds[0]);
    categoryId = categoryIds[0];
    categoryName = cat && cat.name != null ? String(cat.name) : null;
  }
  return {
    sourceType: "custom",
    sourceSelection,
    categoryId,
    categoryName,
    subcategoryId: null,
    subcategoryName: null,
  };
}

async function saveInventoryOrderDraft() {
  if (_invSaveOrderDraftBusy) return;
  const autoLines = Array.isArray(_invOrderBuilderPreviewLines) ? _invOrderBuilderPreviewLines : [];
  const manualLines = Array.isArray(_invOrderBuilderManualLines) ? _invOrderBuilderManualLines : [];
  const linesRaw = [...autoLines, ...manualLines];
  if (linesRaw.length === 0) return;
  const salonId = await getSalonId();
  if (!salonId) {
    inventoryOrderDraftToast("Could not resolve salon. Try again.", "error");
    return;
  }
  const src = buildInventoryOrderDraftSourcePayload();
  if (!src) {
    inventoryOrderDraftToast("Could not resolve order source. Try again.", "error");
    return;
  }
  const uid = auth.currentUser?.uid ? String(auth.currentUser.uid) : "";

  _invSaveOrderDraftBusy = true;
  mountOrRefreshMockUi();
  try {
    const lines = linesRaw.map((L) => (L && L.isManual ? L : enrichOrderLineWithCategoryContext(L)));
    const orderNameRaw = String(_invOrderSaveNameDraft ?? "").trim();
    const items = lines.map((L) => {
      if (L && L.isManual) {
        /** @type {Record<string, unknown>} */
        const out = {
          itemId: L.linkedInventoryItemId != null ? String(L.linkedInventoryItemId) : null,
          rowNo: null,
          code: L.code != null ? String(L.code) : null,
          itemName: L.itemName != null ? String(L.itemName) : "",
          supplier: null,
          url: null,
          groupId: L.groupId != null ? String(L.groupId) : null,
          groupName: L.groupName != null ? String(L.groupName) : null,
          orderQty: typeof L.orderQty === "number" ? L.orderQty : parseNum(L.orderQty),
          price: null,
          categoryId: L.categoryId != null ? String(L.categoryId) : null,
          categoryName: L.categoryName != null ? String(L.categoryName) : null,
          subcategoryId: L.subcategoryId != null ? String(L.subcategoryId) : null,
          subcategoryName: L.subcategoryName != null ? String(L.subcategoryName) : null,
          isManual: true,
        };
        if (L.linkedInventoryItemId != null) {
          out.linkedInventoryItemId = String(L.linkedInventoryItemId);
        }
        return out;
      }
      return {
        itemId: L.itemId,
        rowNo: L.rowNo,
        code: L.code,
        itemName: L.itemName,
        supplier: L.supplier,
        url: L.url,
        groupId: L.groupId,
        groupName: L.groupName,
        orderQty: L.orderQty,
        price: L.price,
        categoryId: L.categoryId != null ? String(L.categoryId) : null,
        categoryName: L.categoryName != null ? String(L.categoryName) : null,
        subcategoryId: L.subcategoryId != null ? String(L.subcategoryId) : null,
        subcategoryName: L.subcategoryName != null ? String(L.subcategoryName) : null,
      };
    });
    await addDoc(collection(db, `salons/${salonId}/inventoryOrders`), {
      status: "draft",
      ...(orderNameRaw !== "" ? { orderName: orderNameRaw } : {}),
      sourceType: src.sourceType,
      sourceSelection: src.sourceSelection,
      categoryId: src.categoryId,
      categoryName: src.categoryName,
      subcategoryId: src.subcategoryId,
      subcategoryName: src.subcategoryName,
      locationId: _ffInvActiveLocId() || null,
      createdAt: serverTimestamp(),
      createdBy: uid,
      itemCount: items.length,
      items,
    });
    // Clear the persistent active-draft doc so the next Create Order starts fresh.
    await clearInventoryOrderDraft();
    inventoryOrderDraftToast("Order saved", "success");
  } catch (e) {
    console.error("[Inventory] save order draft failed", e);
    inventoryOrderDraftToast("Could not save draft order. Try again.", "error");
  } finally {
    _invSaveOrderDraftBusy = false;
    mountOrRefreshMockUi();
  }
}

function renderOrderListSectionHtml() {
  const autoLines = Array.isArray(_invOrderBuilderPreviewLines) ? _invOrderBuilderPreviewLines : [];
  const manualLines = Array.isArray(_invOrderBuilderManualLines) ? _invOrderBuilderManualLines : [];
  const lines = [...autoLines, ...manualLines];
  const loading = _invOrderBuilderPreviewLoading;
  const hasRows = lines.length > 0;
  const busy = _invSaveOrderDraftBusy;
  // Always show Subcategory column — selections can span multiple subs now.
  const showSubCol = true;
  const saveDisabled = busy || loading || !hasRows;
  const saveBtn = hasRows && !loading
    ? `<button type="button" class="ff-inv2-btn" id="ff-inv2-save-order-draft"${saveDisabled ? " disabled" : ""}>${busy ? "Saving…" : "Save as Order"}</button>`
    : "";
  const addItemBtn = !loading
    ? `<button type="button" class="ff-inv2-btn" data-inv-ob-add-item="1"${busy ? " disabled" : ""}>+ Add Item</button>`
    : "";
  const nameInput = hasRows && !loading
    ? `<div class="ff-inv2-order-save-name-row">
  <label class="ff-inv2-order-save-name-label" for="ff-inv2-order-save-name">Order name</label>
  <input type="text" id="ff-inv2-order-save-name" class="ff-inv2-order-save-name-input" placeholder="e.g. Weekly restock" maxlength="120" value="${escapeHtml(_invOrderSaveNameDraft)}" data-inv-order-save-name-input="1" autocomplete="off" />
</div>`
    : "";
  const subTh = showSubCol ? `<th class="ff-inv2-ol-th">Subcategory</th>` : "";
  const rowsHtml = hasRows
    ? lines
        .map((l) => {
          const isManual = !!(l && l.isManual);
          if (isManual) {
            const lidEsc = escapeHtml(String(l.id ?? ""));
            const linkedBadge = l.linkedInventoryItemId
              ? ` <span class="ff-inv2-ol-linked-tag" title="Linked to inventory item">🔗</span>`
              : "";
            const nameHtml = `<span class="ff-inv2-ol-item-name">${escapeHtml(l.itemName)}</span>${linkedBadge} <span class="ff-inv2-ol-manual-tag">Manual</span>`;
            const removeBtn = `<button type="button" class="ff-inv2-ol-manual-remove" data-inv-ob-manual-remove="${lidEsc}" aria-label="Remove manual item" title="Remove">×</button>`;
            const subTd = showSubCol
              ? `<td class="ff-inv2-ol-td">${escapeHtml(l.subcategoryName != null ? String(l.subcategoryName) : "—")}</td>`
              : "";
            const qtyInputHtml = `<input type="number" min="1" step="1" class="ff-inv2-ol-qty-input" data-inv-ob-manual-qty="${lidEsc}" value="${escapeHtml(String(typeof l.orderQty === "number" ? l.orderQty : Number(l.orderQty) || 0))}" aria-label="Order qty" />`;
            return `<tr class="ff-inv2-ol-tr ff-inv2-ol-tr--manual">
  <td class="ff-inv2-ol-td">—</td>
  <td class="ff-inv2-ol-td">${escapeHtml(l.code != null && String(l.code) !== "" ? String(l.code) : "—")}</td>
  <td class="ff-inv2-ol-td">${nameHtml}</td>
  ${subTd}
  <td class="ff-inv2-ol-td">${escapeHtml(l.groupName != null && String(l.groupName) !== "" ? String(l.groupName) : "—")}</td>
  <td class="ff-inv2-ol-td ff-inv2-num">${qtyInputHtml}</td>
  <td class="ff-inv2-ol-td">—</td>
  <td class="ff-inv2-ol-td">—</td>
  <td class="ff-inv2-ol-td ff-inv2-ol-url-wrap">${removeBtn}</td>
</tr>`;
          }
          const subTd = showSubCol
            ? `<td class="ff-inv2-ol-td">${escapeHtml(l.subcategoryName != null ? String(l.subcategoryName) : "")}</td>`
            : "";
          return `<tr>
  <td class="ff-inv2-ol-td">${escapeHtml(l.rowNo)}</td>
  <td class="ff-inv2-ol-td">${escapeHtml(l.code)}</td>
  <td class="ff-inv2-ol-td">${escapeHtml(l.itemName)}</td>
  ${subTd}
  <td class="ff-inv2-ol-td">${escapeHtml(l.groupName)}</td>
  <td class="ff-inv2-ol-td ff-inv2-num">${escapeHtml(formatOrderDisplay(l.orderQty))}</td>
  <td class="ff-inv2-ol-td">${escapeHtml(l.price)}</td>
  <td class="ff-inv2-ol-td">${escapeHtml(l.supplier)}</td>
  <td class="ff-inv2-ol-td ff-inv2-ol-url-wrap"><span class="ff-inv2-ol-url">${escapeHtml(l.url)}</span></td>
</tr>`;
        })
        .join("")
    : "";
  let body;
  if (loading) {
    body = `<p class="ff-inv2-order-list-loading">Loading inventory for the selected source…</p>`;
  } else if (hasRows) {
    body = `<div class="ff-inv2-order-list-scroll"><table class="ff-inv2-order-list-table">
<thead><tr>
<th class="ff-inv2-ol-th">#</th>
<th class="ff-inv2-ol-th">Code</th>
<th class="ff-inv2-ol-th">Item</th>
${subTh}
<th class="ff-inv2-ol-th">Group</th>
<th class="ff-inv2-ol-th">Qty</th>
<th class="ff-inv2-ol-th">Price</th>
<th class="ff-inv2-ol-th">Supplier</th>
<th class="ff-inv2-ol-th">URL</th>
</tr></thead>
<tbody>${rowsHtml}</tbody>
</table></div>`;
  } else {
    body = `<p class="ff-inv2-order-list-empty">No line items with positive order quantity (Stock − Current).</p>`;
  }
  // Banner: highlight how many manual items are in the active draft (so the user knows where Inbox-added items went).
  const manualCount = manualLines.length;
  const fromSuggestions = manualLines.filter((L) => L && L.fromSuggestionId).length;
  const draftBanner = manualCount > 0
    ? `<div class="ff-inv2-draft-banner" role="status">
  <span class="ff-inv2-draft-banner-icon" aria-hidden="true">📋</span>
  <span class="ff-inv2-draft-banner-text">
    <strong>${manualCount}</strong> item${manualCount === 1 ? "" : "s"} in your active draft${fromSuggestions > 0 ? ` · <strong>${fromSuggestions}</strong> from Inbox suggestions` : ""}
  </span>
</div>`
    : "";

  // Status chip next to the "Order list" title — always visible so the user sees it's a Draft with auto-save.
  const statusText = _invOrderDraftSaveStatus === "saving"
    ? "Saving…"
    : _invOrderDraftSaveStatus === "saved"
      ? "Saved"
      : "Auto-save enabled";
  const draftChipHtml = `<button type="button" class="ff-inv2-draft-chip ff-inv2-draft-chip--btn" aria-label="Open drafts list" data-inv-drafts-picker-open="1" title="View and switch drafts">
  <span class="ff-inv2-draft-chip-dot" aria-hidden="true"></span>
  <span class="ff-inv2-draft-chip-label">Draft</span>
  <span class="ff-inv2-draft-chip-sep" aria-hidden="true">·</span>
  <span class="ff-inv2-draft-chip-status" data-inv-draft-status data-state="${_invOrderDraftSaveStatus}">${escapeHtml(statusText)}</span>
  <span class="ff-inv2-draft-chip-caret" aria-hidden="true">▾</span>
</button>`;
  // "+ New" starts a fresh draft, deactivating (but not deleting) the current one.
  const newDraftBtn = !loading
    ? `<button type="button" class="ff-inv2-draft-new-btn" data-inv-ob-new-draft="1"${busy ? " disabled" : ""} title="Start a new draft">+ New</button>`
    : "";

  return `<div class="ff-inv2-order-list-card">
  ${renderOrderBuilderSourceHtml()}
  ${draftBanner}
  <div class="ff-inv2-order-list-head">
    <div class="ff-inv2-order-list-title-row">
      <h3 class="ff-inv2-order-list-title">Order list</h3>
      ${draftChipHtml}
      ${newDraftBtn}
    </div>
    <div class="ff-inv2-order-list-head-actions">
      ${addItemBtn}
      ${saveBtn}
    </div>
  </div>
  ${nameInput}
  ${body}
</div>`;
}

/** Async: load items (row × group) for a subcategory for the link picker. */
async function loadLinkPickerItemsForSub(catId, subId) {
  if (!_invOrderBuilderAddModal) return;
  _invOrderBuilderAddModal.picker.items = null;
  _invOrderBuilderAddModal.picker.loading = true;
  _invOrderBuilderAddModal.picker.error = null;
  mountOrRefreshMockUi();
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    const m = findCategoryAndSubForSubId(subId);
    if (!m) throw new Error("Subcategory not found");
    const data = await fetchSubcategoryInventoryDoc(salonId, catId, subId);
    const { groups, rows } = data ? parseSubcategoryDocToTable(data) : { groups: [], rows: [] };
    const items = [];
    for (const row of rows) {
      if (!row || !row.byGroup) continue;
      const name = row.name != null ? String(row.name).trim() : "";
      if (name === "") continue;
      for (const g of groups) {
        items.push({
          id: `${subId}:${row.id}:${g.id}`,
          rowId: String(row.id),
          groupId: String(g.id),
          itemName: name,
          code: row.code != null ? String(row.code) : "",
          groupName: g.label != null ? String(g.label) : "",
          categoryId: String(catId),
          categoryName: m.category.name != null ? String(m.category.name) : "",
          subcategoryId: String(subId),
          subcategoryName: m.sub.name != null ? String(m.sub.name) : "",
        });
      }
    }
    if (!_invOrderBuilderAddModal) return;
    _invOrderBuilderAddModal.picker.items = items;
    _invOrderBuilderAddModal.picker.loading = false;
  } catch (e) {
    console.error("[Inventory] link picker load failed", e);
    if (!_invOrderBuilderAddModal) return;
    _invOrderBuilderAddModal.picker.items = [];
    _invOrderBuilderAddModal.picker.loading = false;
    _invOrderBuilderAddModal.picker.error = "Could not load items.";
  }
  mountOrRefreshMockUi();
}

function renderOrderBuilderLinkPickerHtml(modal) {
  const p = modal.picker;
  const tree = getCategoryTree();

  if (p.step === "category") {
    if (!Array.isArray(tree) || tree.length === 0) {
      return `<p class="ff-inv2-ob-link-hint">No categories yet.</p>`;
    }
    const items = tree
      .map((c) => {
        const subs = Array.isArray(c.subcategories) ? c.subcategories : [];
        return `<button type="button" class="ff-inv2-ob-link-option" data-inv-ob-add-link-step="subcategory" data-cat-id="${escapeHtml(String(c.id))}">
  <span class="ff-inv2-ob-link-option-name">${escapeHtml(c.name != null ? String(c.name) : "")}</span>
  <span class="ff-inv2-ob-link-option-meta">${subs.length} subcategor${subs.length === 1 ? "y" : "ies"}</span>
  <span class="ff-inv2-ob-link-option-chev" aria-hidden="true">›</span>
</button>`;
      })
      .join("");
    return `<div class="ff-inv2-ob-link-head"><span class="ff-inv2-ob-link-head-label">Pick a category</span></div>
<div class="ff-inv2-ob-link-list">${items}</div>`;
  }

  if (p.step === "subcategory") {
    const cat = tree.find((c) => String(c.id) === String(p.catId));
    const subs = cat && Array.isArray(cat.subcategories) ? cat.subcategories : [];
    const items = subs.length
      ? subs
          .map((s) => `<button type="button" class="ff-inv2-ob-link-option" data-inv-ob-add-link-step="items" data-sub-id="${escapeHtml(String(s.id))}">
  <span class="ff-inv2-ob-link-option-name">${escapeHtml(s.name != null ? String(s.name) : "")}</span>
  <span class="ff-inv2-ob-link-option-chev" aria-hidden="true">›</span>
</button>`)
          .join("")
      : `<p class="ff-inv2-ob-link-hint">No subcategories in this category.</p>`;
    return `<div class="ff-inv2-ob-link-head">
  <button type="button" class="ff-inv2-ob-link-back" data-inv-ob-add-link-step="category" aria-label="Back">‹ Back</button>
  <span class="ff-inv2-ob-link-head-label">${escapeHtml(cat && cat.name != null ? String(cat.name) : "")}</span>
</div>
${subs.length ? `<div class="ff-inv2-ob-link-list">${items}</div>` : items}`;
  }

  // items step
  const cat = tree.find((c) => String(c.id) === String(p.catId));
  const sub = cat && Array.isArray(cat.subcategories) ? cat.subcategories.find((s) => String(s.id) === String(p.subId)) : null;
  let body;
  if (p.loading) {
    body = `<p class="ff-inv2-ob-link-hint">Loading items…</p>`;
  } else if (p.error) {
    body = `<p class="ff-inv2-ob-link-hint">${escapeHtml(p.error)}</p>`;
  } else if (!Array.isArray(p.items) || p.items.length === 0) {
    body = `<p class="ff-inv2-ob-link-hint">No items in this subcategory.</p>`;
  } else {
    const rows = p.items
      .map((it) => {
        const codeLabel = it.code ? `${it.code} · ` : "";
        const grp = it.groupName ? ` (${it.groupName})` : "";
        return `<button type="button" class="ff-inv2-ob-link-option" data-inv-ob-add-link-select="${escapeHtml(String(it.id))}">
  <span class="ff-inv2-ob-link-option-name">${escapeHtml(it.itemName)}${escapeHtml(grp)}</span>
  <span class="ff-inv2-ob-link-option-meta">${escapeHtml(codeLabel)}${escapeHtml(it.subcategoryName != null ? String(it.subcategoryName) : "")}</span>
</button>`;
      })
      .join("");
    body = `<div class="ff-inv2-ob-link-list">${rows}</div>`;
  }
  return `<div class="ff-inv2-ob-link-head">
  <button type="button" class="ff-inv2-ob-link-back" data-inv-ob-add-link-step="subcategory" aria-label="Back">‹ Back</button>
  <span class="ff-inv2-ob-link-head-label">${escapeHtml(cat && cat.name != null ? String(cat.name) : "")} · ${escapeHtml(sub && sub.name != null ? String(sub.name) : "")}</span>
</div>
${body}`;
}

function renderInventoryOrderBuilderAddItemModal() {
  if (!_invOrderBuilderAddModal) return "";
  const m = _invOrderBuilderAddModal;
  const nameVal = escapeHtml(m.draftName);
  const qtyVal = escapeHtml(m.draftQty);
  const nameOk = String(m.draftName).trim() !== "";
  const qtyOk = parseNum(m.draftQty) > 0;
  const canAdd = nameOk && qtyOk;
  const hint = !nameOk
    ? "Enter an item name."
    : !qtyOk
      ? "Quantity must be greater than 0."
      : "";

  let linkBlockHtml;
  if (m.linkedItemId && m.linkedItemMeta) {
    const lm = m.linkedItemMeta;
    const labelParts = [lm.itemName];
    if (lm.groupName) labelParts.push(`(${lm.groupName})`);
    const subLabel = lm.subcategoryName ? `${lm.categoryName || ""} · ${lm.subcategoryName}` : "";
    linkBlockHtml = `<div class="ff-inv2-ob-link-selected">
  <div class="ff-inv2-ob-link-selected-text">
    <span class="ff-inv2-ob-link-selected-name">🔗 ${escapeHtml(labelParts.join(" "))}</span>
    ${subLabel ? `<span class="ff-inv2-ob-link-selected-sub">${escapeHtml(subLabel)}</span>` : ""}
  </div>
  <button type="button" class="ff-inv2-ob-link-clear" data-inv-ob-add-link-clear="1" aria-label="Clear link" title="Clear">×</button>
</div>`;
  } else {
    linkBlockHtml = `<div class="ff-inv2-ob-link-wrap">${renderOrderBuilderLinkPickerHtml(m)}</div>`;
  }

  return `<div class="ff-inv2-modal-backdrop" id="ff-inv-ob-add-item-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv-ob-add-item-title">
  <div class="ff-inv2-modal-card ff-inv2-ob-add-card">
    <h3 id="ff-inv-ob-add-item-title" class="ff-inv2-modal-title">Add item</h3>
    <label class="ff-inv2-modal-field">
      <span class="ff-inv2-modal-field-label">Item name</span>
      <input type="text" class="ff-inv2-modal-input" data-inv-ob-add-input="name" value="${nameVal}" placeholder="e.g. Hand soap" maxlength="120" autocomplete="off" />
    </label>
    <label class="ff-inv2-modal-field">
      <span class="ff-inv2-modal-field-label">Quantity</span>
      <input type="number" class="ff-inv2-modal-input" data-inv-ob-add-input="qty" value="${qtyVal}" placeholder="0" min="0" step="any" inputmode="decimal" autocomplete="off" />
    </label>
    <div class="ff-inv2-modal-field">
      <span class="ff-inv2-modal-field-label">Link to inventory item <span class="ff-inv2-modal-field-optional">(optional)</span></span>
      ${linkBlockHtml}
    </div>
    ${hint ? `<p class="ff-inv2-ob-add-hint">${escapeHtml(hint)}</p>` : ""}
    <div class="ff-inv2-modal-actions">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-inv-ob-add-cancel="1">Cancel</button>
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-primary" data-inv-ob-add-commit="1"${canAdd ? "" : " disabled"} title="${escapeHtml(hint || "Add item")}">Add</button>
    </div>
  </div>
</div>`;
}

function commitInventoryOrderBuilderAddItem() {
  if (!_invOrderBuilderAddModal) return;
  const m = _invOrderBuilderAddModal;
  const name = String(m.draftName ?? "").trim();
  const qty = parseNum(m.draftQty);
  if (!name || !(qty > 0)) return;
  const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  /** @type {Record<string, unknown>} */
  const entry = { id, itemName: name, orderQty: qty, isManual: true };
  if (m.linkedItemId && m.linkedItemMeta) {
    const lm = m.linkedItemMeta;
    entry.linkedInventoryItemId = m.linkedItemId;
    if (lm.code) entry.code = lm.code;
    if (lm.groupId) entry.groupId = lm.groupId;
    if (lm.groupName) entry.groupName = lm.groupName;
    if (lm.categoryId) entry.categoryId = lm.categoryId;
    if (lm.categoryName) entry.categoryName = lm.categoryName;
    if (lm.subcategoryId) entry.subcategoryId = lm.subcategoryId;
    if (lm.subcategoryName) entry.subcategoryName = lm.subcategoryName;
  }
  _invOrderBuilderManualLines.push(entry);
  _invOrderBuilderAddModal = null;
  scheduleInventoryOrderDraftSave();
  mountOrRefreshMockUi();
}

/** Sanitize a manual item so it's safe to persist (no functions/undefineds). */
function sanitizeManualItemForDraft(item) {
  if (!item || typeof item !== "object") return null;
  /** @type {Record<string, unknown>} */
  const out = {};
  const copyKeys = [
    "id",
    "itemName",
    "orderQty",
    "isManual",
    "linkedInventoryItemId",
    "code",
    "groupId",
    "groupName",
    "categoryId",
    "categoryName",
    "subcategoryId",
    "subcategoryName",
    "fromSuggestionId",
  ];
  for (const k of copyKeys) {
    const v = item[k];
    if (v === undefined) continue;
    out[k] = v;
  }
  if (typeof out.orderQty !== "number") {
    const n = Number(out.orderQty);
    out.orderQty = Number.isFinite(n) ? n : 0;
  }
  if (!out.id) out.id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return out;
}

/**
 * Apply a draft doc snapshot into local state.
 * @param {string} docId Firestore doc id
 * @param {Record<string, unknown>} d Doc data
 */
function ffApplyDraftSnapshotToLocalState(docId, d) {
  _invActiveDraftId = docId;
  const rawManual = Array.isArray(d.manualItems) ? d.manualItems : [];
  _invOrderBuilderManualLines = rawManual
    .map(sanitizeManualItemForDraft)
    .filter((x) => x && x.itemName);
  _invOrderBuilderCustomSubIds = Array.isArray(d.selectedSubcategoryIds)
    ? new Set(d.selectedSubcategoryIds.map(String))
    : new Set();
  _invOrderSaveNameDraft = typeof d.orderName === "string" ? d.orderName : "";
  if (d.updatedAt && typeof d.updatedAt.toMillis === "function") {
    _invOrderDraftLastSavedAt = d.updatedAt.toMillis();
    _invOrderDraftSaveStatus = "saved";
  } else {
    _invOrderDraftLastSavedAt = 0;
    _invOrderDraftSaveStatus = "idle";
  }
}

/** Load the active Create Order draft from Firestore into local state. Called on tab entry. */
async function loadInventoryOrderDraft(forceReload) {
  if (_invOrderDraftLoading) return;
  if (_invOrderDraftLoaded && !forceReload) return;
  _invOrderDraftLoading = true;
  try {
    const salonId = await getSalonId();
    if (!salonId) return;

    // Find the active draft (any doc id) by the isActive flag.
    // Multi-branch salons may have one active draft per location, so we also
    // filter by the current locationId client-side after the query returns.
    let activeId = null;
    /** @type {Record<string, unknown> | null} */
    let activeData = null;
    try {
      const qActive = query(
        collection(db, `salons/${salonId}/inventoryDrafts`),
        where("isActive", "==", true)
      );
      const snap = await getDocs(qActive);
      if (!snap.empty) {
        const rows = snap.docs
          .map((d) => ({ id: d.id, data: d.data() }))
          .filter((r) => _ffInvDocInActiveLoc(r.data));
        if (rows.length > 0) {
          const first = rows[0];
          activeId = first.id;
          activeData = first.data;
        }
      }
    } catch (e) {
      console.warn("[Inventory] query active drafts failed", e);
    }

    // Legacy fallback: a doc pinned at id='active' from before multi-draft support.
    if (!activeId) {
      try {
        const legacyRef = doc(db, `salons/${salonId}/inventoryDrafts`, INVENTORY_LEGACY_DRAFT_DOC_ID);
        const legacySnap = await getDoc(legacyRef);
        if (legacySnap.exists()) {
          activeId = legacySnap.id;
          activeData = legacySnap.data();
          // Promote to isActive for future queries.
          try {
            await setDoc(legacyRef, { isActive: true, status: "draft" }, { merge: true });
          } catch (mErr) {
            console.warn("[Inventory] migrate legacy draft failed", mErr);
          }
        }
      } catch (e) {
        console.warn("[Inventory] legacy draft check failed", e);
      }
    }

    let loadedItemCount = 0;
    if (activeId && activeData) {
      ffApplyDraftSnapshotToLocalState(activeId, activeData);
      loadedItemCount = _invOrderBuilderManualLines.length;
    } else {
      // No draft found — keep local empty state. A new draft is created lazily on first write.
      _invActiveDraftId = null;
      _invOrderBuilderManualLines = [];
      _invOrderBuilderCustomSubIds = new Set();
      _invOrderSaveNameDraft = "";
      _invOrderDraftLastSavedAt = 0;
      _invOrderDraftSaveStatus = "idle";
    }

    _invOrderDraftLoaded = true;
    if (!_invOrderDraftResumeToastShown && loadedItemCount > 0) {
      _invOrderDraftResumeToastShown = true;
      inventoryOrderDraftToast(`Resumed unfinished draft · ${loadedItemCount} item${loadedItemCount === 1 ? "" : "s"}`, "info");
    }
    mountOrRefreshMockUi();
    void refreshOrderBuilderPreviewAsync();
  } catch (e) {
    console.error("[Inventory] load active draft failed", e && (e.code || e.message) ? (e.code || e.message) : e);
  } finally {
    _invOrderDraftLoading = false;
  }
}

/** Debounced save of the active draft. Called after every local mutation. */
function scheduleInventoryOrderDraftSave() {
  if (_invOrderDraftSaveTimer) {
    clearTimeout(_invOrderDraftSaveTimer);
    _invOrderDraftSaveTimer = null;
  }
  // Indicate pending save in the UI without re-rendering (we only re-render when the status actually flips).
  if (_invOrderDraftSaveStatus !== "saving") {
    _invOrderDraftSaveStatus = "saving";
    updateInventoryOrderDraftStatusIndicator();
  }
  _invOrderDraftSaveTimer = setTimeout(() => {
    _invOrderDraftSaveTimer = null;
    void flushInventoryOrderDraftSave();
  }, 600);
}

/** Update the Draft status chip in-place without re-rendering the whole Create Order tab. */
function updateInventoryOrderDraftStatusIndicator() {
  const el = document.querySelector("[data-inv-draft-status]");
  if (!(el instanceof HTMLElement)) return;
  const st = _invOrderDraftSaveStatus;
  el.setAttribute("data-state", st);
  if (st === "saving") el.textContent = "Saving…";
  else if (st === "saved") {
    const secs = _invOrderDraftLastSavedAt > 0
      ? Math.max(0, Math.round((Date.now() - _invOrderDraftLastSavedAt) / 1000))
      : null;
    el.textContent = secs != null && secs < 10 ? "Saved just now" : "Auto-saved";
  } else {
    el.textContent = "Auto-save enabled";
  }
}

/** Immediate write of current state to the active draft doc. Creates a new draft on first write. */
async function flushInventoryOrderDraftSave() {
  if (_invOrderDraftSaveTimer) {
    clearTimeout(_invOrderDraftSaveTimer);
    _invOrderDraftSaveTimer = null;
  }
  if (_invOrderDraftSaveInFlight) return;
  _invOrderDraftSaveInFlight = true;
  try {
    const salonId = await getSalonId();
    if (!salonId) return;
    const uid = auth.currentUser && auth.currentUser.uid ? String(auth.currentUser.uid) : null;
    const manualItems = _invOrderBuilderManualLines
      .map(sanitizeManualItemForDraft)
      .filter((x) => x && x.itemName);
    const payload = {
      status: "draft",
      isActive: true,
      manualItems,
      selectedSubcategoryIds: Array.from(_invOrderBuilderCustomSubIds),
      orderName: String(_invOrderSaveNameDraft ?? ""),
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    };
    if (_invActiveDraftId) {
      const ref = doc(db, `salons/${salonId}/inventoryDrafts`, _invActiveDraftId);
      await setDoc(ref, payload, { merge: true });
    } else {
      // First write — create the draft doc. Auto-id avoids collisions.
      const newRef = await addDoc(collection(db, `salons/${salonId}/inventoryDrafts`), {
        ...payload,
        locationId: _ffInvActiveLocId() || null,
        createdAt: serverTimestamp(),
        createdBy: uid,
      });
      _invActiveDraftId = newRef.id;
    }
    _invOrderDraftLastSavedAt = Date.now();
    _invOrderDraftSaveStatus = "saved";
    updateInventoryOrderDraftStatusIndicator();
  } catch (e) {
    console.warn("[Inventory] save active draft failed", e);
    _invOrderDraftSaveStatus = "idle";
    updateInventoryOrderDraftStatusIndicator();
  } finally {
    _invOrderDraftSaveInFlight = false;
  }
}

/** Format a draft entry for the picker. */
function renderDraftsPickerRowHtml(draft) {
  const idEsc = escapeHtml(draft.id);
  const isActive = draft.isActive;
  const itemCount = Array.isArray(draft.manualItems) ? draft.manualItems.length : 0;
  const name = draft.orderName && draft.orderName.trim() ? draft.orderName.trim() : "Untitled draft";
  const updated = draft.updatedAt
    ? new Date(draft.updatedAt).toLocaleString()
    : draft.createdAt
      ? new Date(draft.createdAt).toLocaleString()
      : "—";
  const switchBtn = isActive
    ? `<span class="ff-inv2-drafts-picker-current">Current</span>`
    : `<button type="button" class="ff-inv2-drafts-picker-switch" data-inv-drafts-picker-switch="${idEsc}">Switch</button>`;
  return `<li class="ff-inv2-drafts-picker-row${isActive ? " ff-inv2-drafts-picker-row--active" : ""}">
  <div class="ff-inv2-drafts-picker-main">
    <div class="ff-inv2-drafts-picker-name">${escapeHtml(name)}</div>
    <div class="ff-inv2-drafts-picker-meta">${itemCount} item${itemCount === 1 ? "" : "s"} · ${escapeHtml(updated)}</div>
  </div>
  <div class="ff-inv2-drafts-picker-actions">
    ${switchBtn}
    <button type="button" class="ff-inv2-drafts-picker-delete" data-inv-drafts-picker-delete="${idEsc}" aria-label="Delete draft" title="Delete draft">🗑</button>
  </div>
</li>`;
}

/** Modal listing all drafts — clicking the Draft chip opens this. */
function renderInventoryDraftsPickerModal() {
  if (!_invDraftsPicker.open) return "";
  let body;
  if (_invDraftsPicker.loading) {
    body = `<p class="ff-inv2-drafts-picker-empty">Loading…</p>`;
  } else if (_invDraftsPicker.error) {
    body = `<p class="ff-inv2-drafts-picker-empty">${escapeHtml(_invDraftsPicker.error)}</p>`;
  } else if (!_invDraftsPicker.drafts.length) {
    body = `<p class="ff-inv2-drafts-picker-empty">No drafts yet. Add an item to create one.</p>`;
  } else {
    body = `<ul class="ff-inv2-drafts-picker-list">${_invDraftsPicker.drafts.map(renderDraftsPickerRowHtml).join("")}</ul>`;
  }
  return `<div class="ff-inv2-modal-backdrop ff-inv2-drafts-picker-backdrop" data-inv-drafts-picker-close-backdrop="1" role="dialog" aria-modal="true" aria-labelledby="ff-inv2-drafts-picker-title">
  <div class="ff-inv2-modal-card ff-inv2-drafts-picker-card" data-inv-drafts-picker-card="1">
    <div class="ff-inv2-drafts-picker-head">
      <h3 id="ff-inv2-drafts-picker-title" class="ff-inv2-modal-title">Your drafts</h3>
      <button type="button" class="ff-inv2-drafts-picker-close" data-inv-drafts-picker-close="1" aria-label="Close">×</button>
    </div>
    <p class="ff-inv2-modal-hint">Switch between unfinished drafts or delete ones you don't need.</p>
    ${body}
    <div class="ff-inv2-modal-actions ff-inv2-drafts-picker-actions-row">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-inv-drafts-picker-close="1">Close</button>
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-primary" data-inv-drafts-picker-new="1">+ New draft</button>
    </div>
  </div>
</div>`;
}

/** Open the drafts picker and fetch the list. */
async function openInventoryDraftsPicker() {
  _invDraftsPicker = { open: true, loading: true, error: null, drafts: [] };
  mountOrRefreshMockUi();
  try {
    const salonId = await getSalonId();
    if (!salonId) {
      _invDraftsPicker.error = "No salon context";
      _invDraftsPicker.loading = false;
      mountOrRefreshMockUi();
      return;
    }
    const snap = await getDocs(collection(db, `salons/${salonId}/inventoryDrafts`));
    const drafts = [];
    snap.forEach((d) => {
      const data = d.data() || {};
      if (data.status === "cleared") return;
      if (!_ffInvDocInActiveLoc(data)) return;
      const manualItems = Array.isArray(data.manualItems) ? data.manualItems : [];
      drafts.push({
        id: d.id,
        isActive: data.isActive === true || d.id === _invActiveDraftId,
        manualItems,
        orderName: typeof data.orderName === "string" ? data.orderName : "",
        createdAt: data.createdAt && typeof data.createdAt.toMillis === "function" ? data.createdAt.toMillis() : 0,
        updatedAt: data.updatedAt && typeof data.updatedAt.toMillis === "function" ? data.updatedAt.toMillis() : 0,
      });
    });
    drafts.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    _invDraftsPicker = { open: true, loading: false, error: null, drafts };
    mountOrRefreshMockUi();
  } catch (e) {
    console.warn("[Inventory] drafts picker load failed", e);
    _invDraftsPicker = { open: true, loading: false, error: "Could not load drafts", drafts: [] };
    mountOrRefreshMockUi();
  }
}

function closeInventoryDraftsPicker() {
  _invDraftsPicker = { open: false, loading: false, error: null, drafts: [] };
  mountOrRefreshMockUi();
}

/** Switch the active draft to the given doc id. */
async function switchActiveInventoryDraft(draftId) {
  if (!draftId || draftId === _invActiveDraftId) {
    closeInventoryDraftsPicker();
    return;
  }
  if (_invOrderDraftSaveTimer) {
    await flushInventoryOrderDraftSave();
  }
  try {
    const salonId = await getSalonId();
    if (!salonId) return;
    const uid = auth.currentUser && auth.currentUser.uid ? String(auth.currentUser.uid) : null;
    // Deactivate current
    if (_invActiveDraftId && _invActiveDraftId !== draftId) {
      try {
        const oldRef = doc(db, `salons/${salonId}/inventoryDrafts`, _invActiveDraftId);
        await setDoc(
          oldRef,
          { isActive: false, updatedAt: serverTimestamp(), updatedBy: uid },
          { merge: true }
        );
      } catch (e) {
        console.warn("[Inventory] deactivate previous draft (switch) failed", e);
      }
    }
    // Activate the chosen one
    const newRef = doc(db, `salons/${salonId}/inventoryDrafts`, draftId);
    const snap = await getDoc(newRef);
    if (!snap.exists()) {
      inventoryOrderDraftToast("That draft is gone", "error");
      closeInventoryDraftsPicker();
      return;
    }
    await setDoc(
      newRef,
      { isActive: true, updatedAt: serverTimestamp(), updatedBy: uid },
      { merge: true }
    );
    ffApplyDraftSnapshotToLocalState(draftId, snap.data() || {});
    _invOrderDraftLoaded = true;
    _invOrderDraftResumeToastShown = true;
    inventoryOrderDraftToast("Switched draft", "info");
    closeInventoryDraftsPicker();
    void refreshOrderBuilderPreviewAsync();
  } catch (e) {
    console.error("[Inventory] switchActiveInventoryDraft failed", e);
    inventoryOrderDraftToast("Could not switch draft", "error");
  }
}

/** Delete a draft from Firestore. If it was the active one, reset local state. */
async function deleteInventoryDraftFromPicker(draftId) {
  if (!draftId) return;
  try {
    const salonId = await getSalonId();
    if (!salonId) return;
    const ref = doc(db, `salons/${salonId}/inventoryDrafts`, draftId);
    await deleteDoc(ref);
    if (draftId === _invActiveDraftId) {
      _invActiveDraftId = null;
      _invOrderBuilderManualLines = [];
      _invOrderBuilderCustomSubIds = new Set();
      _invOrderSaveNameDraft = "";
      _invOrderDraftLastSavedAt = 0;
      _invOrderDraftSaveStatus = "idle";
    }
    inventoryOrderDraftToast("Draft deleted", "success");
    // Refresh list in place
    void openInventoryDraftsPicker();
    void refreshOrderBuilderPreviewAsync();
  } catch (e) {
    console.error("[Inventory] delete draft failed", e);
    inventoryOrderDraftToast("Could not delete draft", "error");
  }
}

/**
 * Start a fresh draft: deactivate the current one (if any) so it remains in Firestore
 * as a non-active draft, and clear local state. A new Firestore doc is created lazily
 * on the first mutation via flushInventoryOrderDraftSave().
 */
async function createNewInventoryOrderDraft() {
  // Flush any pending save so we don't clobber the soon-to-be-deactivated draft.
  if (_invOrderDraftSaveTimer) {
    await flushInventoryOrderDraftSave();
  }
  try {
    const salonId = await getSalonId();
    if (salonId && _invActiveDraftId) {
      const uid = auth.currentUser && auth.currentUser.uid ? String(auth.currentUser.uid) : null;
      const oldRef = doc(db, `salons/${salonId}/inventoryDrafts`, _invActiveDraftId);
      await setDoc(
        oldRef,
        { isActive: false, updatedAt: serverTimestamp(), updatedBy: uid },
        { merge: true }
      );
    }
  } catch (e) {
    console.warn("[Inventory] deactivate previous draft failed", e);
  }
  // Reset local state. New draft doc will be created on first mutation.
  _invActiveDraftId = null;
  _invOrderBuilderManualLines = [];
  _invOrderBuilderCustomSubIds = new Set();
  _invOrderSaveNameDraft = "";
  _invOrderDraftLastSavedAt = 0;
  _invOrderDraftSaveStatus = "idle";
  _invOrderDraftResumeToastShown = true;
  _invOrderDraftLoaded = true;
  inventoryOrderDraftToast("Started a new draft", "info");
  mountOrRefreshMockUi();
  void refreshOrderBuilderPreviewAsync();
}

/** Remove the active draft entirely (after Save as Order). Other drafts are untouched. */
async function clearInventoryOrderDraft() {
  const draftIdToDelete = _invActiveDraftId;
  _invOrderBuilderManualLines = [];
  _invOrderBuilderCustomSubIds = new Set();
  _invOrderSaveNameDraft = "";
  _invActiveDraftId = null;
  _invOrderDraftLastSavedAt = 0;
  _invOrderDraftSaveStatus = "idle";
  _invOrderDraftLoaded = true;
  if (_invOrderDraftSaveTimer) {
    clearTimeout(_invOrderDraftSaveTimer);
    _invOrderDraftSaveTimer = null;
  }
  if (!draftIdToDelete) return;
  try {
    const salonId = await getSalonId();
    if (!salonId) return;
    const ref = doc(db, `salons/${salonId}/inventoryDrafts`, draftIdToDelete);
    await deleteDoc(ref).catch((e) => {
      console.warn("[Inventory] clear draft delete failed; falling back to empty overwrite", e);
      return setDoc(
        ref,
        {
          status: "cleared",
          isActive: false,
          manualItems: [],
          selectedSubcategoryIds: [],
          orderName: "",
          updatedAt: serverTimestamp(),
        },
        { merge: false }
      );
    });
  } catch (e) {
    console.warn("[Inventory] clear active draft failed", e);
  }
}

function renderInventoryTableCardHtml() {
  return `<div class="ff-inv2-table-card">
      <div class="ff-inv2-toolbar">
        <button type="button" class="ff-inv2-btn" id="ff-inv2-add-row">+ Add Row</button>
        <button type="button" class="ff-inv2-btn" id="ff-inv2-add-group">+ Add Group</button>
      </div>
      <div class="ff-inv2-table-scroll">
        <table class="ff-inv2-table">
          ${renderTableHeaderHtml()}
          <tbody>${renderTableBodyHtml()}</tbody>
        </table>
      </div>
    </div>`;
}

function renderInvMainTabsHtml() {
  const tabs = [
    { id: "inventory", label: "Inventory" },
    { id: "orderBuilder", label: "Create Order" },
    { id: "orders", label: "Orders" },
    { id: "insights", label: "Insights" },
  ];
  return `<div class="ff-inv2-main-tabs" role="tablist" aria-label="Inventory workspace">
${tabs
  .map((x) => {
    const active = _invMainTab === x.id;
    return `    <button type="button" role="tab" class="ff-inv2-main-tab${active ? " ff-inv2-main-tab--active" : ""}" aria-selected="${active ? "true" : "false"}" data-inv-main-tab="${escapeHtml(x.id)}">${escapeHtml(x.label)}</button>`;
  })
  .join("\n")}
  </div>`;
}

/** Readable source label for a saved inventory order document. */
function formatInventoryOrderSourceLabel(data) {
  if (!data || typeof data !== "object") return "—";
  const st = data.sourceType;
  const sel = data.sourceSelection;
  if (st && sel && typeof sel === "object") {
    if (st === "subcategory") {
      const cat = sel.categoryName != null ? String(sel.categoryName) : "";
      const sub =
        Array.isArray(sel.subcategoryNames) && sel.subcategoryNames.length
          ? String(sel.subcategoryNames[0])
          : "";
      if (cat && sub) return `${cat} > ${sub}`;
      if (cat) return sub ? `${cat} > ${sub}` : cat;
      return sub || "—";
    }
    if (st === "category") {
      return sel.categoryName != null ? String(sel.categoryName) : sel.categoryId != null ? String(sel.categoryId) : "—";
    }
    if (st === "custom") {
      const n = Array.isArray(sel.subcategoryIds) ? sel.subcategoryIds.length : 0;
      return `Custom (${n} subcategories)`;
    }
  }
  const cat = data.categoryName != null ? String(data.categoryName) : "";
  const sub = data.subcategoryName != null ? String(data.subcategoryName) : "";
  if (sub) return cat ? `${cat} > ${sub}` : sub;
  return cat || "—";
}

function getInventoryOrderDisplayName(o) {
  if (!o || typeof o !== "object") return "Order";
  const raw = o.orderName != null ? String(o.orderName).trim() : "";
  if (raw !== "") return raw;
  const lbl = formatInventoryOrderSourceLabel(o);
  return lbl !== "—" ? lbl : "Order";
}

function formatInventoryOrderCreatedAt(ts) {
  if (!ts) return "—";
  let d = null;
  if (typeof ts.toDate === "function") {
    try {
      d = ts.toDate();
    } catch (e) {
      d = null;
    }
  }
  if (!d && ts.seconds != null) {
    d = new Date(Number(ts.seconds) * 1000);
  }
  if (!d || Number.isNaN(d.getTime())) return "—";
  try {
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch (e) {
    return d.toISOString();
  }
}

function formatInventoryOrderStatusDisplay(o) {
  const s = getEffectiveInventoryOrderStatus(o);
  if (s === "open") return "open";
  if (s === "in_progress") return "in progress";
  if (s === "done") return "done";
  return s;
}

function getInventoryOrderStatusKey(o) {
  const s = getEffectiveInventoryOrderStatus(o);
  if (s === "open" || s === "in_progress" || s === "done") return s;
  return "open";
}

function orderMatchesInventoryStatusFilter(o) {
  if (_invOrdersStatusFilter === "all") return true;
  return getInventoryOrderStatusKey(o) === _invOrdersStatusFilter;
}

function getOrderSearchHaystack(o) {
  const parts = [getInventoryOrderDisplayName(o), formatInventoryOrderSourceLabel(o)];
  const items = Array.isArray(o.items) ? o.items : [];
  for (const it of items) {
    if (it && typeof it === "object") {
      if (it.itemName != null) parts.push(String(it.itemName));
      if (it.supplier != null) parts.push(String(it.supplier));
    }
  }
  return parts.join(" ").toLowerCase();
}

function orderMatchesInventorySearchQuery(o) {
  const q = _invOrdersSearchQuery.trim().toLowerCase();
  if (!q) return true;
  return getOrderSearchHaystack(o).includes(q);
}

function formatInventoryOrderOrderedByDisplay(uid) {
  if (uid == null || String(uid).trim() === "") return "—";
  return String(uid);
}

/**
 * @param {{ silent?: boolean } | undefined} opts
 * If silent, skip full-screen loading state (e.g. after duplicate/delete).
 */
async function loadInventoryOrdersList(opts) {
  const silent = opts && opts.silent === true;
  if (!silent) {
    _invOrdersLoading = true;
    _invOrdersLoadError = null;
    mountOrRefreshMockUi();
  }
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    const q = query(collection(db, `salons/${salonId}/inventoryOrders`), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    _invOrdersList = snap.docs
      .map((d) => {
        const x = d.data();
        return { id: d.id, ...x };
      })
      .filter(_ffInvDocInActiveLoc);
    _invOrdersLoadError = null;
  } catch (e) {
    console.error("[Inventory] orders list load failed", e);
    if (silent) {
      inventoryOrderDraftToast("Could not refresh orders.", "error");
    } else {
      _invOrdersLoadError = (e && e.message) || "Failed to load orders";
      _invOrdersList = [];
    }
  } finally {
    _invOrdersLoading = false;
    mountOrRefreshMockUi();
  }
}

function clonePlainForFirestoreOrderPayload(obj) {
  if (obj == null || typeof obj !== "object") return obj;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (e) {
    return obj;
  }
}

async function duplicateInventoryOrderDraft(orderId) {
  const o = _invOrdersList.find((x) => x.id === orderId);
  if (!o) {
    inventoryOrderDraftToast("Order not found.", "error");
    return;
  }
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    const uid = auth.currentUser?.uid ? String(auth.currentUser.uid) : "";
    const rawItems = Array.isArray(o.items) ? o.items : [];
    const items = rawItems.map((it) => {
      if (!it || typeof it !== "object") return it;
      const { receivedCumulative: _rc, qtyBought: _qb, appliedToInventory: _ai, appliedAt: _aa, ...rest } = it;
      return rest;
    });
    const itemCount = typeof o.itemCount === "number" ? o.itemCount : items.length;
    const sourceSelection = clonePlainForFirestoreOrderPayload(o.sourceSelection);
    const dupName =
      o.orderName != null && String(o.orderName).trim() !== ""
        ? `${String(o.orderName).trim()} (copy)`
        : null;
    await addDoc(collection(db, `salons/${salonId}/inventoryOrders`), {
      status: "draft",
      ...(dupName ? { orderName: dupName } : {}),
      sourceType: o.sourceType ?? null,
      sourceSelection: sourceSelection != null ? sourceSelection : null,
      categoryId: o.categoryId ?? null,
      categoryName: o.categoryName ?? null,
      subcategoryId: o.subcategoryId ?? null,
      subcategoryName: o.subcategoryName ?? null,
      locationId: _ffInvActiveLocId() || (typeof o.locationId === "string" ? o.locationId : null),
      itemCount,
      items,
      createdAt: serverTimestamp(),
      createdBy: uid,
      copiedFromOrderId: orderId,
    });
    inventoryOrderDraftToast("Order duplicated.", "success");
    void loadInventoryOrdersList({ silent: true });
  } catch (e) {
    console.error("[Inventory] duplicate order failed", e);
    inventoryOrderDraftToast("Could not duplicate order.", "error");
  }
}

async function deleteInventoryOrderDraftConfirmed(orderId) {
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    await deleteDoc(doc(db, `salons/${salonId}/inventoryOrders`, orderId));
    _invOrdersDeleteConfirmOrderId = null;
    delete _invOrderReceiptUploadFieldsByOrderId[orderId];
    delete _invOrderShoppingDraft[orderId];
    if (_invReceiptInfoModalOrderId === orderId) _invReceiptInfoModalOrderId = null;
    if (_invOrdersDetailOrderId === orderId) {
      _invOrdersDetailOrderId = null;
      _invOrderDetailLineViewIdx = null;
    }
    if (_invOrdersMenu && _invOrdersMenu.orderId === orderId) _invOrdersMenu = null;
    inventoryOrderDraftToast("Order deleted.", "success");
    void loadInventoryOrdersList({ silent: true });
  } catch (e) {
    console.error("[Inventory] delete order failed", e);
    inventoryOrderDraftToast("Could not delete order.", "error");
  }
}

async function markInventoryOrderOrderedConfirmed(orderId) {
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    const uid = auth.currentUser?.uid ? String(auth.currentUser.uid) : "";
    const ref = doc(db, `salons/${salonId}/inventoryOrders`, orderId);
    await updateDoc(ref, {
      status: "ordered",
      orderedAt: serverTimestamp(),
      orderedBy: uid,
    });
    _invOrdersMarkOrderedConfirmOrderId = null;
    if (_invOrdersMenu && _invOrdersMenu.orderId === orderId) _invOrdersMenu = null;
    inventoryOrderDraftToast("Order marked as ordered.", "success");
    void loadInventoryOrdersList({ silent: true });
  } catch (e) {
    console.error("[Inventory] mark ordered failed", e);
    inventoryOrderDraftToast("Could not update order.", "error");
  }
}

/**
 * Confirm receive from Order Details: checked lines only; updates `items[].receivedCumulative`, status, inventory `current`.
 * @param {string} orderId
 */
async function confirmInventoryOrderReceived(orderId) {
  if (_invOrderReceiveBusy || _invOrderPurchaseBusy) return;
  ensureShoppingDraft(orderId);
  const shop = _invOrderShoppingDraft[orderId];
  const o = _invOrdersList.find((x) => x.id === orderId);
  if (!o) {
    inventoryOrderDraftToast("Order not found.", "error");
    return;
  }
  const ost = o.status != null ? String(o.status) : "draft";
  if (ost !== "ordered" && ost !== "partially_received") {
    inventoryOrderDraftToast("This order cannot receive inventory from here.", "error");
    return;
  }
  const items = Array.isArray(o.items) ? o.items : [];
  if (!shop || items.length === 0) {
    inventoryOrderDraftToast("Nothing to receive.", "error");
    return;
  }
  let hasLine = false;
  for (let i = 0; i < items.length; i++) {
    if (!shop.checked[i]) continue;
    if (parseNum(shop.qtyBought[i]) !== 0) hasLine = true;
  }
  if (!hasLine) {
    inventoryOrderDraftToast("Select at least one line and enter a non-zero quantity.", "error");
    return;
  }

  const checked = shop.checked.slice();
  const qtyDraft = shop.qtyBought.map((q) => String(q ?? ""));

  const salonId = await getSalonId();
  if (!salonId) {
    inventoryOrderDraftToast("Could not resolve salon. Try again.", "error");
    return;
  }
  const uid = auth.currentUser?.uid ? String(auth.currentUser.uid) : "";
  const orderRef = doc(db, `salons/${salonId}/inventoryOrders`, orderId);

  _invOrderReceiveBusy = true;
  mountOrRefreshMockUi();
  const affectedSubs = new Set();
  try {
    await runTransaction(db, async (transaction) => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists()) throw new Error("ORDER_MISSING");
      const ordData = orderSnap.data();
      const curSt = ordData.status != null ? String(ordData.status) : "draft";
      if (curSt !== "ordered" && curSt !== "partially_received") {
        throw new Error("ORDER_BAD_STATUS");
      }

      const itemsFromDb = Array.isArray(ordData.items) ? ordData.items : [];
      const nextItems = itemsFromDb.map((it) => (it && typeof it === "object" ? { ...it } : {}));

      /** @type {{ catId: string, subId: string, rowId: string, groupId: string, qty: number }[]} */
      const deltas = [];
      for (let i = 0; i < nextItems.length; i++) {
        if (!checked[i]) continue;
        const add = parseNum(qtyDraft[i]);
        if (add === 0) continue;
        const it = itemsFromDb[i];
        if (!it || typeof it !== "object") continue;
        const prev = getItemReceivedCumulative(it);
        nextItems[i] = { ...nextItems[i], receivedCumulative: prev + add };
        const catId = it.categoryId != null ? String(it.categoryId).trim() : "";
        const subId = it.subcategoryId != null ? String(it.subcategoryId).trim() : "";
        const rowId = parseRowIdFromInventoryItemId(it.itemId);
        const groupId = it.groupId != null ? String(it.groupId).trim() : "";
        if (!catId || !subId || !rowId || !groupId) continue;
        deltas.push({ catId, subId, rowId, groupId, qty: add });
      }

      const newStatus = computeReceiveStatusFromItems(nextItems);

      const subDocMap = new Map();
      for (const d of deltas) {
        const key = `${d.catId}:${d.subId}`;
        let entry = subDocMap.get(key);
        if (!entry) {
          entry = {
            ref: doc(db, `salons/${salonId}/inventoryCategories/${d.catId}/inventorySubcategories/${d.subId}`),
            catId: d.catId,
            subId: d.subId,
            deltas: [],
          };
          subDocMap.set(key, entry);
        }
        entry.deltas.push(d);
      }

      const subReads = [];
      for (const [, entry] of subDocMap) {
        const snap = await transaction.get(entry.ref);
        subReads.push({ entry, snap });
      }

      for (const { entry, snap } of subReads) {
        if (!snap.exists()) continue;
        const data = snap.data();
        const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
        const rowsNorm = rowsRaw.map((raw) => normalizeRowFromFirestore(raw));
        let changed = false;
        for (const d of entry.deltas) {
          const row = rowsNorm.find((r) => r.id === d.rowId);
          if (!row) continue;
          const cell = row.byGroup[d.groupId];
          if (!cell) continue;
          cell.current = parseNum(cell.current) + d.qty;
          changed = true;
        }
        if (changed) {
          const rowsPayload = rowsNorm.map((r) => serializeInventoryRowForFirestore(r));
          transaction.update(entry.ref, {
            rows: rowsPayload,
            updatedAt: serverTimestamp(),
          });
          affectedSubs.add(`${entry.catId}:${entry.subId}`);
        }
      }

      /** @type {Record<string, unknown>} */
      const orderUpdate = {
        items: nextItems,
        status: newStatus,
        lastReceiveAt: serverTimestamp(),
        lastReceiveBy: uid,
      };
      if (newStatus === "received" && curSt !== "received") {
        orderUpdate.receivedAt = serverTimestamp();
        orderUpdate.receivedBy = uid;
      }
      transaction.update(orderRef, orderUpdate);
    });

    delete _invOrderShoppingDraft[orderId];
    inventoryOrderDraftToast("Receive recorded.", "success");
    void loadInventoryOrdersList({ silent: true });

    const meta = getSelectedSubMeta();
    if (meta && affectedSubs.has(`${meta.category.id}:${meta.sub.id}`)) {
      const key = `${meta.category.id}:${meta.sub.id}`;
      if (_invTableLoadedForSubId === key) {
        const seq = ++_invTableLoadSeq;
        _invTableLoading = true;
        mountOrRefreshMockUi();
        void loadInventoryTableForSub(meta.category.id, meta.sub.id, seq, key);
      }
    }
  } catch (e) {
    console.error("[Inventory] receive order failed", e);
    const code = e && typeof e.message === "string" ? e.message : "";
    if (code === "ORDER_BAD_STATUS") {
      inventoryOrderDraftToast("This order was already updated. Refresh and try again.", "error");
    } else if (code === "ORDER_MISSING") {
      inventoryOrderDraftToast("Order no longer exists.", "error");
    } else {
      inventoryOrderDraftToast("Could not record receive. Try again.", "error");
    }
  } finally {
    _invOrderReceiveBusy = false;
    mountOrRefreshMockUi();
  }
}

/**
 * Draft orders only: apply shopping-list "Qty bought" to inventory `current` + persist qtyBought / appliedToInventory on order lines.
 * Skips inventory when already applied and qty unchanged; applies delta when qty changed after apply.
 * @param {string} orderId
 */
async function confirmInventoryOrderPurchase(orderId) {
  if (_invOrderPurchaseBusy || _invOrderReceiveBusy) return;
  ensureShoppingDraft(orderId);
  const shop = _invOrderShoppingDraft[orderId];
  const o = _invOrdersList.find((x) => x.id === orderId);
  if (!o) {
    inventoryOrderDraftToast("Order not found.", "error");
    return;
  }
  const items = Array.isArray(o.items) ? o.items : [];
  if (!shop || items.length === 0) {
    inventoryOrderDraftToast("Nothing to apply.", "error");
    return;
  }

  const salonId = await getSalonId();
  if (!salonId) {
    inventoryOrderDraftToast("Could not resolve salon. Try again.", "error");
    return;
  }

  const orderRef = doc(db, `salons/${salonId}/inventoryOrders`, orderId);
  _invOrderPurchaseBusy = true;
  mountOrRefreshMockUi();
  const affectedSubs = new Set();
  try {
    await runTransaction(db, async (transaction) => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists()) throw new Error("ORDER_MISSING");
      const ordData = orderSnap.data();

      const itemsFromDb = Array.isArray(ordData.items) ? ordData.items : [];
      const nextItems = itemsFromDb.map((it) => (it && typeof it === "object" ? { ...it } : {}));

      /** @type {{ lineIndex: number, uiQty: number, invDelta: number, catId: string, subId: string, rowId: string, groupId: string }[]} */
      const pending = [];

      const nLines = nextItems.length;
      for (let i = 0; i < nLines; i++) {
        const uiQty = parseNum(shop.qtyBought[i]);
        const it = nextItems[i];
        if (!it || typeof it !== "object") continue;
        if (uiQty <= 0) continue;

        const oldQty = it.qtyBought != null ? parseNum(it.qtyBought) : 0;
        const applied = it.appliedToInventory === true;

        let invDelta = 0;
        if (!applied) {
          invDelta = uiQty;
        } else if (uiQty !== oldQty) {
          invDelta = uiQty - oldQty;
        } else {
          continue;
        }
        if (invDelta === 0) continue;

        const catId = it.categoryId != null ? String(it.categoryId).trim() : "";
        const subId = it.subcategoryId != null ? String(it.subcategoryId).trim() : "";
        const rowId = parseRowIdFromInventoryItemId(it.itemId);
        const groupId = it.groupId != null ? String(it.groupId).trim() : "";
        if (!catId || !subId || !rowId || !groupId) continue;

        pending.push({ lineIndex: i, uiQty, invDelta, catId, subId, rowId, groupId });
      }

      if (pending.length === 0) {
        throw new Error("NO_PURCHASE_CHANGES");
      }

      const subDocMap = new Map();
      for (const p of pending) {
        const key = `${p.catId}:${p.subId}`;
        let entry = subDocMap.get(key);
        if (!entry) {
          entry = {
            ref: doc(db, `salons/${salonId}/inventoryCategories/${p.catId}/inventorySubcategories/${p.subId}`),
            catId: p.catId,
            subId: p.subId,
            pending: [],
          };
          subDocMap.set(key, entry);
        }
        entry.pending.push(p);
      }

      /** @type {Map<string, { rowsNorm: ReturnType<typeof normalizeRowFromFirestore>[] }>} */
      const subRowsByKey = new Map();
      for (const [, entry] of subDocMap) {
        const snap = await transaction.get(entry.ref);
        const key = `${entry.catId}:${entry.subId}`;
        if (!snap.exists()) {
          throw new Error("SUB_MISSING");
        }
        const data = snap.data();
        const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
        const rowsNorm = rowsRaw.map((raw) => normalizeRowFromFirestore(raw));
        subRowsByKey.set(key, { rowsNorm });
      }

      for (const p of pending) {
        const key = `${p.catId}:${p.subId}`;
        const pack = subRowsByKey.get(key);
        if (!pack) throw new Error("INV_LINE_MISSING");
        const row = pack.rowsNorm.find((r) => r.id === p.rowId);
        const cell = row && row.byGroup[p.groupId];
        if (!row || !cell) {
          throw new Error("INV_LINE_MISSING");
        }
      }

      for (const [, entry] of subDocMap) {
        const key = `${entry.catId}:${entry.subId}`;
        const pack = subRowsByKey.get(key);
        if (!pack) continue;
        const { rowsNorm } = pack;
        let changed = false;
        for (const p of entry.pending) {
          const row = rowsNorm.find((r) => r.id === p.rowId);
          if (!row) continue;
          const cell = row.byGroup[p.groupId];
          if (!cell) continue;
          cell.current = parseNum(cell.current) + p.invDelta;
          changed = true;
        }
        if (changed) {
          const rowsPayload = rowsNorm.map((r) => serializeInventoryRowForFirestore(r));
          transaction.update(entry.ref, {
            rows: rowsPayload,
            updatedAt: serverTimestamp(),
          });
          affectedSubs.add(`${entry.catId}:${entry.subId}`);
        }
      }

      const appliedAtTs = Timestamp.now();
      for (const p of pending) {
        nextItems[p.lineIndex] = {
          ...nextItems[p.lineIndex],
          qtyBought: p.uiQty,
          appliedToInventory: true,
          appliedAt: appliedAtTs,
        };
      }

      transaction.update(orderRef, { items: nextItems });
    });

    delete _invOrderShoppingDraft[orderId];
    delete _invDetailReceiveDraft[orderId];
    inventoryOrderDraftToast("Inventory updated", "success");
    await loadInventoryOrdersList({ silent: true });
    delete _invOrderShoppingDraft[orderId];

    const meta = getSelectedSubMeta();
    if (meta && affectedSubs.has(`${meta.category.id}:${meta.sub.id}`)) {
      const key = `${meta.category.id}:${meta.sub.id}`;
      if (_invTableLoadedForSubId === key) {
        const seq = ++_invTableLoadSeq;
        _invTableLoading = true;
        mountOrRefreshMockUi();
        void loadInventoryTableForSub(meta.category.id, meta.sub.id, seq, key);
      }
    }
  } catch (e) {
    console.error("[Inventory] confirm purchase failed", e);
    const code = e && typeof e.message === "string" ? e.message : "";
    if (code === "NO_PURCHASE_CHANGES") {
      inventoryOrderDraftToast("No inventory changes to apply (already applied or no quantity edits).", "error");
    } else if (code === "ORDER_BAD_STATUS") {
      inventoryOrderDraftToast("This order was already updated. Refresh and try again.", "error");
    } else if (code === "ORDER_MISSING") {
      inventoryOrderDraftToast("Order no longer exists.", "error");
    } else if (code === "SUB_MISSING") {
      inventoryOrderDraftToast("Inventory subcategory not found. Refresh and try again.", "error");
    } else if (code === "INV_LINE_MISSING") {
      inventoryOrderDraftToast("This line no longer matches inventory. Refresh and try again.", "error");
    } else {
      const fc = e && typeof e.code === "string" ? e.code : "";
      if (fc === "permission-denied") {
        inventoryOrderDraftToast("Permission denied. Check Firestore rules.", "error");
      } else {
        console.error("[Inventory] confirm purchase detail", fc, e);
        inventoryOrderDraftToast("Could not update inventory. Try again.", "error");
      }
    }
  } finally {
    _invOrderPurchaseBusy = false;
    mountOrRefreshMockUi();
  }
}

function teardownInventoryOrderReceiptsListener() {
  if (_invOrderReceiptsUnsub) {
    try {
      _invOrderReceiptsUnsub();
    } catch (e) {
      /* ignore */
    }
    _invOrderReceiptsUnsub = null;
  }
  _invOrderReceiptsBoundOrderId = null;
  _invOrderReceiptsList = [];
  _invOrderReceiptsLoading = false;
}

function getActiveReceiptSubscriptionOrderId() {
  return _invOrdersDetailOrderId;
}

function ensureInventoryOrderReceiptsSubscription() {
  const oid = getActiveReceiptSubscriptionOrderId();
  if (!oid) {
    teardownInventoryOrderReceiptsListener();
    return;
  }
  if (_invOrderReceiptsBoundOrderId === oid && _invOrderReceiptsUnsub) {
    return;
  }
  teardownInventoryOrderReceiptsListener();
  _invOrderReceiptsBoundOrderId = oid;
  _invOrderReceiptsLoading = true;
  void (async () => {
    const salonId = await getSalonId();
    if (!salonId || getActiveReceiptSubscriptionOrderId() !== oid) {
      _invOrderReceiptsLoading = false;
      mountOrRefreshMockUi();
      return;
    }
    const q = query(
      collection(db, "salons", salonId, "inventoryOrders", oid, "receipts"),
      orderBy("uploadedAt", "desc")
    );
    _invOrderReceiptsUnsub = onSnapshot(
      q,
      (snap) => {
        if (getActiveReceiptSubscriptionOrderId() !== oid) return;
        _invOrderReceiptsList = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        _invOrderReceiptsLoading = false;
        mountOrRefreshMockUi();
      },
      (err) => {
        console.error("[Inventory] receipts snapshot", err);
        if (getActiveReceiptSubscriptionOrderId() !== oid) return;
        _invOrderReceiptsList = [];
        _invOrderReceiptsLoading = false;
        mountOrRefreshMockUi();
      }
    );
  })();
}

function sanitizeReceiptStorageFileName(name) {
  const raw = String(name || "file")
    .replace(/[/\\]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return raw.slice(0, 180) || "file";
}

function getReceiptUploadFieldsForOrder(orderId) {
  const e = _invOrderReceiptUploadFieldsByOrderId[orderId];
  if (!e) return { note: "", supplierName: "", amount: "" };
  return {
    note: String(e.note ?? "").trim(),
    supplierName: String(e.supplierName ?? "").trim(),
    amount: String(e.amount ?? "").trim(),
  };
}

function getOrderReceiptUploadOptions(root, orderId) {
  if (root) {
    const backdrop = root.querySelector("#ff-inv-receipt-info-backdrop");
    if (backdrop) {
      const card = backdrop.querySelector("[data-inv-receipt-info-card]");
      if (card) {
        const n = card.querySelector('[data-inv-receipt-info-field="note"]');
        const s = card.querySelector('[data-inv-receipt-info-field="supplierName"]');
        const a = card.querySelector('[data-inv-receipt-info-field="amount"]');
        return {
          note: n instanceof HTMLInputElement ? n.value.trim() : "",
          supplierName: s instanceof HTMLInputElement ? s.value.trim() : "",
          amount: a instanceof HTMLInputElement ? a.value.trim() : "",
        };
      }
    }
  }
  return getReceiptUploadFieldsForOrder(orderId);
}

async function handleInventoryOrderReceiptFileSelected(root, orderId, file) {
  if (_invOrderReceiptUploadBusy || isInvOrderDetailCommitBusy()) return;
  _invOrderReceiptUploadBusy = true;
  mountOrRefreshMockUi();
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    const uid = auth.currentUser?.uid ? String(auth.currentUser.uid) : "";
    const opts = getOrderReceiptUploadOptions(root, orderId);
    const receiptsCol = collection(db, "salons", salonId, "inventoryOrders", orderId, "receipts");
    const newReceiptRef = doc(receiptsCol);
    const receiptId = newReceiptRef.id;
    const safeName = sanitizeReceiptStorageFileName(file.name);
    const storagePath = `salons/${salonId}/inventoryOrders/${orderId}/receipts/${receiptId}/${safeName}`;
    const sref = storageRef(storage, storagePath);
    await uploadBytes(sref, file);
    const fileUrl = await getDownloadURL(sref);
    /** @type {Record<string, unknown>} */
    const payload = {
      fileName: file.name,
      fileUrl,
      filePath: storagePath,
      uploadedAt: serverTimestamp(),
      uploadedBy: uid,
    };
    if (opts.note) payload.note = opts.note;
    if (opts.supplierName) payload.supplierName = opts.supplierName;
    if (opts.amount) payload.amount = opts.amount;
    await setDoc(newReceiptRef, payload);
    inventoryOrderDraftToast("Receipt uploaded.", "success");
  } catch (e) {
    console.error("[Inventory] receipt upload failed", e);
    const code = e && typeof e.code === "string" ? e.code : "";
    const msg = e && typeof e.message === "string" ? e.message : "";
    if (code === "storage/unauthorized" || /permission|unauthorized/i.test(msg)) {
      inventoryOrderDraftToast(
        "Receipt upload blocked by permissions. Make sure your user has manager/admin/owner role with a matching salonId.",
        "error"
      );
    } else if (code === "permission-denied") {
      inventoryOrderDraftToast("Permission denied saving receipt metadata.", "error");
    } else {
      inventoryOrderDraftToast(`Could not upload receipt${code ? ` (${code})` : ""}.`, "error");
    }
  } finally {
    _invOrderReceiptUploadBusy = false;
    mountOrRefreshMockUi();
  }
}

/** Pick a small emoji based on file extension for quick visual cue. */
function getReceiptFileTypeEmoji(fileName) {
  const s = String(fileName ?? "").toLowerCase();
  const dot = s.lastIndexOf(".");
  const ext = dot >= 0 ? s.slice(dot + 1) : "";
  if (ext === "pdf") return "📄";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic", "heif", "svg"].includes(ext)) return "🖼️";
  if (["txt", "csv", "log"].includes(ext)) return "📝";
  if (["doc", "docx", "rtf", "odt"].includes(ext)) return "📄";
  if (["xls", "xlsx", "ods"].includes(ext)) return "📊";
  return "📎";
}

/** Receipt list block for Receipt information modal only (uses live receipts listener). */
function buildReceiptsListBlockHtml() {
  const loading = _invOrderReceiptsLoading;
  const list = _invOrderReceiptsList;
  const oidEsc = escapeHtml(_invReceiptInfoModalOrderId || "");
  const rows =
    !loading && list.length
      ? list
          .map((r) => {
            const fn = r.fileName != null ? String(r.fileName) : "";
            const emoji = getReceiptFileTypeEmoji(fn);
            const uploaded = formatInventoryOrderCreatedAt(r.uploadedAt);
            const url = r.fileUrl != null ? String(r.fileUrl) : "";
            const rid = escapeHtml(String(r.id ?? ""));
            return `<tr class="ff-inv2-or-tr">
  <td class="ff-inv2-or-td"><span class="ff-inv2-or-filetype" aria-hidden="true">${emoji}</span> <span class="ff-inv2-or-filename">${escapeHtml(fn)}</span></td>
  <td class="ff-inv2-or-td ff-inv2-or-td--muted">${escapeHtml(uploaded)}</td>
  <td class="ff-inv2-or-td ff-inv2-or-td--icon"><a class="ff-inv2-or-link ff-inv2-or-icon-btn" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="Open receipt" title="Open"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7"></path><path d="M10 14 21 3"></path><path d="M21 14v7H3V3h7"></path></svg></a></td>
  <td class="ff-inv2-or-td ff-inv2-or-td--icon"><button type="button" class="ff-inv2-or-delete ff-inv2-or-icon-btn" data-inv-order-receipt-delete="1" data-order-id="${oidEsc}" data-receipt-id="${rid}" aria-label="Delete receipt" title="Delete"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></button></td>
</tr>`;
          })
          .join("")
      : "";
  if (loading && !list.length) {
    return `<p class="ff-inv2-or-loading">Loading receipts…</p>`;
  }
  if (!loading && list.length) {
    return `<div class="ff-inv2-or-scroll ff-inv2-or-scroll--modal"><table class="ff-inv2-or-table">
  <thead><tr>
    <th class="ff-inv2-or-th">File</th>
    <th class="ff-inv2-or-th">Uploaded</th>
    <th class="ff-inv2-or-th ff-inv2-or-th--icon" aria-label="Open"></th>
    <th class="ff-inv2-or-th ff-inv2-or-th--icon" aria-label="Delete"></th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table></div>`;
  }
  return `<p class="ff-inv2-or-empty">No receipts yet.</p>`;
}

async function deleteInventoryOrderReceipt(orderId, receiptId) {
  if (!orderId || !receiptId) return;
  if (!window.confirm("Delete this receipt? This cannot be undone.")) return;
  const entry = _invOrderReceiptsList.find((x) => x.id === receiptId);
  if (!entry) {
    inventoryOrderDraftToast("Receipt not found.", "error");
    return;
  }
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    const path = entry.filePath != null ? String(entry.filePath) : "";
    if (path) {
      try {
        await deleteObject(storageRef(storage, path));
      } catch (storageErr) {
        console.warn("[Inventory] receipt file delete failed (continuing to remove metadata)", storageErr);
      }
    }
    await deleteDoc(doc(db, "salons", salonId, "inventoryOrders", orderId, "receipts", receiptId));
    inventoryOrderDraftToast("Receipt deleted.", "success");
  } catch (e) {
    console.error("[Inventory] receipt delete failed", e);
    const code = e && typeof e.code === "string" ? e.code : "";
    inventoryOrderDraftToast(`Could not delete receipt${code ? ` (${code})` : ""}.`, "error");
  }
}

function renderReceiptInfoModal() {
  if (!_invReceiptInfoModalOrderId) return "";
  const oid = _invReceiptInfoModalOrderId;
  const o = _invOrdersList.find((x) => x.id === oid);
  if (!o) return "";
  const fields = getReceiptUploadFieldsForOrder(oid);
  const oidEsc = escapeHtml(oid);
  const busy = _invOrderReceiptUploadBusy;
  const receiveBusy = _invOrderReceiveBusy;
  const purchaseBusy = _invOrderPurchaseBusy;
  const uploadDisabled = busy || receiveBusy || purchaseBusy ? " disabled" : "";
  const listBlock = buildReceiptsListBlockHtml();
  return `<div class="ff-inv2-modal-backdrop ff-inv2-modal-backdrop--nested" id="ff-inv-receipt-info-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv-receipt-info-title">
  <div class="ff-inv2-modal-card ff-inv2-receipt-info-card" data-inv-receipt-info-card="1" data-order-id="${oidEsc}">
    <div class="ff-inv2-receipt-info-head">
      <h3 id="ff-inv-receipt-info-title" class="ff-inv2-modal-title">Receipt Information</h3>
      <button type="button" class="ff-inv2-receipt-info-close" data-inv-receipt-info-close="1" aria-label="Close">×</button>
    </div>
    <p class="ff-inv2-modal-hint ff-inv2-receipt-info-hint">Note, supplier, and amount apply to the next upload.</p>
    <div class="ff-inv2-receipt-info-fields">
      <label class="ff-inv2-receipt-info-field">
        <span class="ff-inv2-receipt-info-label">Note</span>
        <input type="text" class="ff-inv2-receipt-info-input" data-inv-receipt-info-field="note" value="${escapeHtml(fields.note)}" placeholder="Note (optional)" autocomplete="off" />
      </label>
      <label class="ff-inv2-receipt-info-field">
        <span class="ff-inv2-receipt-info-label">Supplier</span>
        <input type="text" class="ff-inv2-receipt-info-input" data-inv-receipt-info-field="supplierName" value="${escapeHtml(fields.supplierName)}" placeholder="Supplier (optional)" autocomplete="off" />
      </label>
      <label class="ff-inv2-receipt-info-field">
        <span class="ff-inv2-receipt-info-label">Amount</span>
        <input type="text" class="ff-inv2-receipt-info-input" data-inv-receipt-info-field="amount" value="${escapeHtml(fields.amount)}" placeholder="Amount (optional)" autocomplete="off" />
      </label>
    </div>
    <div class="ff-inv2-receipt-info-upload-row">
      <input type="file" class="ff-inv2-sr-only" data-inv-order-receipt-file="1" data-order-id="${oidEsc}" tabindex="-1" />
      <button type="button" class="ff-inv2-btn ff-inv2-btn--sm" data-inv-order-receipt-open="1" data-order-id="${oidEsc}"${uploadDisabled}>+ Upload receipt</button>
    </div>
    <div class="ff-inv2-receipt-info-uploaded">
      <p class="ff-inv2-receipt-info-section-label">Uploaded receipts</p>
      ${listBlock}
    </div>
    <div class="ff-inv2-modal-actions ff-inv2-receipt-info-footer">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-inv-receipt-info-cancel="1">Close</button>
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-primary" data-inv-receipt-info-save="1" data-order-id="${oidEsc}">Save</button>
    </div>
  </div>
</div>`;
}

function renderOrderDetailLineViewModal() {
  if (_invOrderDetailLineViewIdx == null || !_invOrdersDetailOrderId) return "";
  const oid = _invOrdersDetailOrderId;
  const idx = _invOrderDetailLineViewIdx;
  const o = _invOrdersList.find((x) => x.id === oid);
  if (!o) return "";
  const items = Array.isArray(o.items) ? o.items : [];
  const it = items[idx];
  if (!it) return "";
  const name = escapeHtml(it.itemName != null ? String(it.itemName) : "");
  const codeRaw = it.code != null ? String(it.code).trim() : "";
  const code = codeRaw !== "" ? escapeHtml(codeRaw) : "—";
  const gLine = getOrderItemGroupLabel(it);
  const group = gLine !== "" ? escapeHtml(gLine) : "—";
  const need = escapeHtml(formatOrderDisplay(getItemOrderQty(it)));
  ensureShoppingDraft(oid);
  const shop = _invOrderShoppingDraft[oid];
  const qb =
    shop && shop.qtyBought[idx] != null && String(shop.qtyBought[idx]).trim() !== ""
      ? String(shop.qtyBought[idx])
      : "";
  const bought = qb !== "" ? escapeHtml(qb) : "—";
  return `<div class="ff-inv2-modal-backdrop ff-inv2-modal-backdrop--nested" id="ff-inv-od-line-view-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv-od-line-view-title">
  <div class="ff-inv2-modal-card ff-inv2-od-line-view-card">
    <h3 id="ff-inv-od-line-view-title" class="ff-inv2-modal-title">Line</h3>
    <dl class="ff-inv2-od-line-view-dl">
      <div class="ff-inv2-od-line-view-row"><dt>Item</dt><dd>${name}</dd></div>
      <div class="ff-inv2-od-line-view-row"><dt>Code</dt><dd>${code}</dd></div>
      <div class="ff-inv2-od-line-view-row"><dt>Group</dt><dd>${group}</dd></div>
      <div class="ff-inv2-od-line-view-row"><dt>Needed</dt><dd>${need}</dd></div>
      <div class="ff-inv2-od-line-view-row"><dt>Bought</dt><dd>${bought}</dd></div>
    </dl>
    <div class="ff-inv2-modal-actions">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-primary" data-inv-od-line-view-close="1">Close</button>
    </div>
  </div>
</div>`;
}

// ---- Inventory Insights ----------------------------------------------------

/** @type {"30d" | "60d" | "120d" | "year" | "all" | "custom"} */
let _invInsightsRange = "30d";
/** @type {"overview" | "purchases" | "forecast" | "health"} */
let _invInsightsSubTab = "overview";
let _invInsightsCustomFrom = "";
let _invInsightsCustomTo = "";
let _invInsightsLoading = false;
/** @type {Array<{ key: string, name: string, totalQty: number }>} */
let _invInsightsRows = [];
let _invInsightsLoadSeq = 0;
let _invInsightsError = null;
/** KPI summary for the selected range. */
let _invInsightsKpis = { totalSpend: 0, doneOrders: 0, totalOrders: 0, uniqueItems: 0, prevSpend: 0, spendPctChange: null };
/** Per-cell usage + days-left forecast, sorted ascending by daysLeft. */
/** @type {Array<{ catId: string, subId: string, rowId: string, groupId: string, itemName: string, groupName: string, categoryName: string, subcategoryName: string, current: number, stock: number, dailyRate: number, daysLeft: number, level: "critical" | "low" | "ok" }>} */
let _invInsightsUsage = [];
/** Smart reorder suggestions — subset of usage with daysLeft ≤ threshold. */
let _invInsightsReorder = [];
const INV_INSIGHTS_REORDER_DAYS = 7;
const INV_INSIGHTS_CRITICAL_DAYS = 7;
const INV_INSIGHTS_LOW_DAYS = 14;
/** Spend grouped by categoryName for the selected range. */
/** @type {Array<{ name: string, spend: number, percent: number }>} */
let _invInsightsCategorySpend = [];
/** Running-low cells: current ≤ threshold × stock (requires stock > 0). */
/** @type {Array<{ catId: string, subId: string, rowId: string, groupId: string, itemName: string, groupName: string, subcategoryName: string, categoryName: string, stock: number, current: number, pctLeft: number }>} */
let _invInsightsRunningLow = [];
/** Dead stock cells: current > 0 but no purchase activity in range. */
/** @type {Array<{ catId: string, subId: string, rowId: string, groupId: string, itemName: string, groupName: string, subcategoryName: string, categoryName: string, current: number }>} */
let _invInsightsDeadStock = [];
const INV_INSIGHTS_LOW_THRESHOLD = 0.3;
const INV_INSIGHTS_DEAD_STOCK_MIN_CURRENT = 1;

/** Convert local YYYY-MM-DD input value to a JS Date (start of day local time). */
function ffParseDateInputStart(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

/** Convert local YYYY-MM-DD input value to end of day. */
function ffParseDateInputEnd(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
}

/** Resolve the active range to absolute { from, to } JS Dates. `all` returns from=null. */
function getInventoryInsightsDateRange() {
  const now = new Date();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  if (_invInsightsRange === "all") return { from: null, to: null };
  if (_invInsightsRange === "custom") {
    return {
      from: ffParseDateInputStart(_invInsightsCustomFrom),
      to: ffParseDateInputEnd(_invInsightsCustomTo) || to,
    };
  }
  let days = 30;
  if (_invInsightsRange === "60d") days = 60;
  else if (_invInsightsRange === "120d") days = 120;
  else if (_invInsightsRange === "year") days = 365;
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1), 0, 0, 0, 0);
  return { from, to };
}

/** Best-effort timestamp resolution for an order item event (purchase apply / receive). */
function ffResolveItemEventDate(it, order) {
  const candidates = [it && it.appliedAt, it && it.lastReceivedAt, order && order.updatedAt, order && order.orderedAt, order && order.createdAt];
  for (const ts of candidates) {
    if (!ts) continue;
    if (typeof ts.toDate === "function") {
      try {
        return ts.toDate();
      } catch (e) {
        /* ignore */
      }
    }
    if (typeof ts === "object" && ts && typeof ts.seconds === "number") {
      return new Date(ts.seconds * 1000 + (typeof ts.nanoseconds === "number" ? ts.nanoseconds / 1e6 : 0));
    }
    if (typeof ts === "number") return new Date(ts);
    if (typeof ts === "string") {
      const d = new Date(ts);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

/** Compute the previous comparison period [from, to] matching the currently-selected range. */
function getInventoryInsightsPrevRange() {
  const cur = getInventoryInsightsDateRange();
  if (!cur.from || !cur.to) return { from: null, to: null };
  const durationMs = cur.to.getTime() - cur.from.getTime();
  if (!(durationMs > 0)) return { from: null, to: null };
  const prevTo = new Date(cur.from.getTime() - 1);
  const prevFrom = new Date(cur.from.getTime() - durationMs - 1);
  return { from: prevFrom, to: prevTo };
}

/** One-shot guard so the suggestion scan runs only once per app session. */
let _invSuggestionsScannedThisSession = false;

/**
 * Smart Inventory Suggestions — scans all items, and creates an Inbox alert
 * (type="inventory_suggestion") whenever a cell is forecast to run out within 3 days
 * based on purchase rate over the last ≤ 60 days.
 *
 * Rules:
 *   - lookbackDays = min(60, daysWithData)
 *   - totalUsed = sum(qtyBought|receivedCumulative) in lookback window
 *   - dailyUsage = totalUsed / lookbackDays
 *   - Fire an alert only when dailyUsage > 0 AND daysLeft < 3
 *   - suggestedQty = ceil(dailyUsage * 7)
 *   - Skip if an open alert already exists for the same rowId:groupId.
 */
async function scanInventorySuggestionsOnce() {
  if (_invSuggestionsScannedThisSession) return;
  _invSuggestionsScannedThisSession = true;
  try {
    const salonId = await getSalonId();
    if (!salonId) return;
    const user = auth.currentUser;
    if (!user) return;

    // Read the current user profile to satisfy inboxItems create rules.
    let userData = {};
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) userData = snap.data() || {};
    } catch (e) {
      console.warn("[Inventory] suggestion scan: user doc read failed", e);
      return;
    }
    const role = userData.role != null ? String(userData.role) : "";
    const roleLower = role.toLowerCase();
    // Only managers/admins/owners create system alerts — technicians would hit permission checks.
    if (!["manager", "admin", "owner"].includes(roleLower)) return;

    const uid = user.uid;
    const staffId = userData.staffId != null ? String(userData.staffId) : "";
    const displayName = userData.displayName || userData.name || "System";

    // Load existing inventory_suggestion items — dedup against ALL statuses.
    // Rationale: if a suggestion was already acted on (archived after Add to Order) or dismissed,
    // don't create a duplicate. The scanner re-enables re-alerts only after the user-facing doc
    // is fully removed (e.g. via archive-tab delete).
    const existingKeys = new Set();
    try {
      const existingSnap = await getDocs(
        query(
          collection(db, `salons/${salonId}/inboxItems`),
          where("type", "==", "inventory_suggestion")
        )
      );
      existingSnap.forEach((d) => {
        const data = d.data() || {};
        const nested = (data.data && typeof data.data === "object") ? data.data : {};
        const rowId = nested.rowId != null ? String(nested.rowId) : "";
        const groupId = nested.groupId != null ? String(nested.groupId) : "";
        if (rowId && groupId) existingKeys.add(`${rowId}:${groupId}`);
      });
    } catch (e) {
      console.warn("[Inventory] suggestion scan: existing alerts query failed", e);
      return;
    }

    // Fetch categories + subcategories in parallel. Scope to the active
    // location so suggestions are generated per-branch only.
    const catSnap = await getDocs(collection(db, `salons/${salonId}/inventoryCategories`));
    const cats = catSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter(_ffInvDocInActiveLoc);
    const perCatPromises = cats.map((c) =>
      getDocs(collection(db, `salons/${salonId}/inventoryCategories/${c.id}/inventorySubcategories`))
        .then((s) => ({
          cat: c,
          subs: s.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter(_ffInvDocInActiveLoc),
        }))
        .catch((e) => {
          console.warn("[Inventory] suggestion scan: sub load failed", c.id, e);
          return { cat: c, subs: [] };
        })
    );
    // Fetch orders in parallel (all orders — we filter dates/locations client-side).
    const ordersPromise = getDocs(collection(db, `salons/${salonId}/inventoryOrders`)).catch((e) => {
      console.warn("[Inventory] suggestion scan: orders load failed", e);
      return null;
    });
    const [perCat, ordersSnap] = await Promise.all([Promise.all(perCatPromises), ordersPromise]);
    if (!ordersSnap) return;

    // Build per-cell usage in the last ≤60 days.
    const now = Date.now();
    const cutoff = now - 60 * 86400000;
    /** @type {Map<string, { total: number, oldestMs: number }>} */
    const cellUsage = new Map();
    ordersSnap.forEach((d) => {
      const order = { id: d.id, ...d.data() };
      if (!_ffInvDocInActiveLoc(order)) return;
      const items = Array.isArray(order.items) ? order.items : [];
      for (const it of items) {
        if (!it || typeof it !== "object") continue;
        const purchaseQty = it.appliedToInventory === true ? Number(it.qtyBought) : NaN;
        const receiveQty = Number(it.receivedCumulative);
        const purchaseValid = Number.isFinite(purchaseQty) && purchaseQty > 0;
        const receiveValid = Number.isFinite(receiveQty) && receiveQty > 0;
        if (!purchaseValid && !receiveValid) continue;
        const eventDate = ffResolveItemEventDate(it, order);
        if (!eventDate) continue;
        const ms = eventDate.getTime();
        if (!(ms >= cutoff)) continue;
        const rowId = it.itemId && String(it.itemId).includes(":")
          ? String(it.itemId).split(":")[1] || ""
          : "";
        const groupId = it.groupId != null ? String(it.groupId).trim() : "";
        if (!rowId || !groupId) continue;
        const key = `${rowId}:${groupId}`;
        const qty = Math.max(purchaseValid ? purchaseQty : 0, receiveValid ? receiveQty : 0);
        const prev = cellUsage.get(key) || { total: 0, oldestMs: now };
        prev.total += qty;
        if (ms < prev.oldestMs) prev.oldestMs = ms;
        cellUsage.set(key, prev);
      }
    });

    let createdCount = 0;
    for (const { cat, subs } of perCat) {
      for (const sub of subs) {
        let groups;
        let rows;
        try {
          const parsed = parseSubcategoryDocToTable(sub);
          groups = parsed.groups;
          rows = parsed.rows;
        } catch (e) {
          console.warn("[Inventory] suggestion scan: parse sub failed", sub.id, e);
          continue;
        }
        for (const r of rows) {
          for (const g of groups) {
            const cell = r.byGroup && r.byGroup[g.id];
            if (!cell) continue;
            const current = typeof cell.current === "number" ? cell.current : parseNum(cell.current);
            if (!Number.isFinite(current) || current < 0) continue;
            const key = `${String(r.id)}:${String(g.id)}`;
            if (existingKeys.has(key)) continue;
            const usage = cellUsage.get(key);
            if (!usage || !(usage.total > 0)) continue;
            const daysWithData = Math.max(1, Math.ceil((now - usage.oldestMs) / 86400000));
            const lookbackDays = Math.min(60, daysWithData);
            const dailyUsage = usage.total / lookbackDays;
            if (!(dailyUsage > 0)) continue;
            const daysLeft = current > 0 ? current / dailyUsage : 0;
            if (!(daysLeft < 3)) continue;
            const suggestedQty = Math.max(1, Math.ceil(dailyUsage * 7));
            const itemName = r.name != null ? String(r.name).trim() : "";
            const groupName = g.label != null ? String(g.label) : "";
            // Stamp the suggestion with the active branch so it only
            // surfaces in the Inbox of the location where the scan ran.
            // Falls back to null for single-location salons (Inbox filter
            // treats null as "no filter" in that case).
            let suggestionLocationId = null;
            try {
              if (typeof window !== "undefined" && typeof window.ffGetActiveLocationId === "function") {
                const v = window.ffGetActiveLocationId();
                if (typeof v === "string" && v.trim()) suggestionLocationId = v.trim();
              }
              if (!suggestionLocationId && typeof window !== "undefined"
                  && typeof window.__ff_active_location_id === "string"
                  && window.__ff_active_location_id.trim()) {
                suggestionLocationId = window.__ff_active_location_id.trim();
              }
            } catch (_) {}
            const payload = {
              tenantId: salonId,
              locationId: suggestionLocationId,
              type: "inventory_suggestion",
              status: "open",
              priority: "high",
              assignedTo: null,
              sentToStaffIds: [],
              sentToNames: [],
              managerNotes: null,
              responseNote: null,
              decidedBy: null,
              decidedAt: null,
              needsInfoQuestion: null,
              staffReply: null,
              visibility: "managers_only",
              unreadForManagers: true,
              createdByUid: uid,
              createdByStaffId: staffId,
              createdByName: displayName,
              createdByRole: role,
              forUid: uid,
              forStaffId: staffId,
              forStaffName: displayName,
              createdAt: serverTimestamp(),
              lastActivityAt: serverTimestamp(),
              updatedAt: null,
              data: {
                itemName,
                groupName,
                categoryId: String(cat.id),
                categoryName: cat.name != null ? String(cat.name) : "",
                subcategoryId: String(sub.id),
                subcategoryName: sub.name != null ? String(sub.name) : "",
                rowId: String(r.id),
                groupId: String(g.id),
                current: Math.round(current * 100) / 100,
                dailyUsage: Math.round(dailyUsage * 100) / 100,
                daysLeft: Math.round(daysLeft * 10) / 10,
                suggestedQty,
                lookbackDays,
                totalUsed: usage.total,
              },
            };
            try {
              await addDoc(collection(db, `salons/${salonId}/inboxItems`), payload);
              existingKeys.add(key);
              createdCount += 1;
            } catch (e) {
              console.warn("[Inventory] suggestion scan: create failed", { cat: cat.id, sub: sub.id, row: r.id, group: g.id }, e);
            }
          }
        }
      }
    }
    if (createdCount > 0) {
      console.log(`[Inventory] Smart Suggestion scan — created ${createdCount} alert(s)`);
    } else {
      console.log("[Inventory] Smart Suggestion scan — no new alerts");
    }
  } catch (e) {
    console.warn("[Inventory] suggestion scan failed", e);
  }
}

async function refreshInventoryInsightsAsync() {
  if (_invMainTab !== "insights") return;
  const seq = ++_invInsightsLoadSeq;
  _invInsightsLoading = true;
  _invInsightsError = null;
  mountOrRefreshMockUi();
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    // Fetch orders (for purchases) and every subcategory doc (for stock health) in parallel.
    const ordersPromise = getDocs(collection(db, `salons/${salonId}/inventoryOrders`));
    const tree = getCategoryTree();
    const subFetches = [];
    for (const c of tree) {
      const subs = Array.isArray(c.subcategories) ? c.subcategories : [];
      for (const s of subs) {
        subFetches.push(
          fetchSubcategoryInventoryDoc(salonId, c.id, s.id)
            .then((data) => ({
              catId: String(c.id),
              catName: c.name != null ? String(c.name) : "",
              subId: String(s.id),
              subName: s.name != null ? String(s.name) : "",
              data,
            }))
            .catch((e) => {
              console.warn("[Inventory] insights sub fetch failed", c.id, s.id, e);
              return null;
            })
        );
      }
    }
    const [ordersSnap, subResults] = await Promise.all([ordersPromise, Promise.all(subFetches)]);
    if (seq !== _invInsightsLoadSeq) return;

    const { from, to } = getInventoryInsightsDateRange();
    const prevRange = getInventoryInsightsPrevRange();

    /** @type {Map<string, { name: string, totalQty: number }>} */
    const buckets = new Map();
    /** key = `${catId}:${subId}:${rowId}:${groupId}` → summed purchased qty in range */
    const activityByCell = new Map();
    /** key = categoryName → spend */
    const spendByCategory = new Map();
    const ordersWithActivity = new Set();
    let totalSpend = 0;
    let prevSpend = 0;

    ordersSnap.forEach((d) => {
      const order = { id: d.id, ...d.data() };
      if (!_ffInvDocInActiveLoc(order)) return;
      const items = Array.isArray(order.items) ? order.items : [];
      for (const it of items) {
        if (!it || typeof it !== "object") continue;
        const purchaseQty = it.appliedToInventory === true ? Number(it.qtyBought) : NaN;
        const receiveQty = Number(it.receivedCumulative);
        const purchaseValid = Number.isFinite(purchaseQty) && purchaseQty > 0;
        const receiveValid = Number.isFinite(receiveQty) && receiveQty > 0;
        if (!purchaseValid && !receiveValid) continue;
        const eventDate = ffResolveItemEventDate(it, order);
        // Previous-period tally for MoM comparison
        if (prevRange.from && prevRange.to && eventDate && eventDate >= prevRange.from && eventDate <= prevRange.to) {
          const qtyPrev = Math.max(purchaseValid ? purchaseQty : 0, receiveValid ? receiveQty : 0);
          const pricePrev = Number(it.price);
          if (Number.isFinite(pricePrev) && pricePrev > 0) {
            prevSpend += qtyPrev * pricePrev;
          }
        }
        if (from && eventDate && eventDate < from) continue;
        if (to && eventDate && eventDate > to) continue;
        if (!eventDate && _invInsightsRange !== "all") continue;
        const itemName = it.itemName != null ? String(it.itemName).trim() : "";
        if (!itemName) continue;
        const groupName = it.groupName != null ? String(it.groupName).trim() : "";
        const qty = Math.max(purchaseValid ? purchaseQty : 0, receiveValid ? receiveQty : 0);
        // Most Purchased bucket
        const keyName = `${itemName}__${groupName}`;
        const displayName = groupName ? `${itemName} (${groupName})` : itemName;
        const prevB = buckets.get(keyName) || { name: displayName, totalQty: 0 };
        prevB.totalQty += qty;
        buckets.set(keyName, prevB);
        // Activity by cell (for Dead Stock detection)
        const catId = it.categoryId != null ? String(it.categoryId).trim() : "";
        const subId = it.subcategoryId != null ? String(it.subcategoryId).trim() : "";
        const rowId = it.itemId != null && String(it.itemId).includes(":")
          ? String(it.itemId).split(":")[1] || ""
          : "";
        const groupId = it.groupId != null ? String(it.groupId).trim() : "";
        if (catId && subId && rowId && groupId) {
          const cellKey = `${catId}:${subId}:${rowId}:${groupId}`;
          activityByCell.set(cellKey, (activityByCell.get(cellKey) || 0) + qty);
        }
        // Category spend
        const price = Number(it.price);
        if (Number.isFinite(price) && price > 0) {
          const spend = qty * price;
          totalSpend += spend;
          const cn = it.categoryName != null && String(it.categoryName).trim() !== ""
            ? String(it.categoryName).trim()
            : "Uncategorized";
          spendByCategory.set(cn, (spendByCategory.get(cn) || 0) + spend);
        }
        ordersWithActivity.add(order.id);
      }
    });

    const rows = [];
    for (const [key, v] of buckets) {
      if (v.totalQty > 0) rows.push({ key, name: v.name, totalQty: v.totalQty });
    }
    rows.sort((a, b) => b.totalQty - a.totalQty || a.name.localeCompare(b.name));

    const categoryRows = Array.from(spendByCategory.entries())
      .map(([name, spend]) => ({ name, spend }))
      .sort((a, b) => b.spend - a.spend);
    const spendSum = categoryRows.reduce((acc, r) => acc + r.spend, 0) || 0;
    for (const r of categoryRows) {
      r.percent = spendSum > 0 ? Math.round((r.spend / spendSum) * 1000) / 10 : 0;
    }

    /** @type {typeof _invInsightsRunningLow} */
    const runningLow = [];
    /** @type {typeof _invInsightsDeadStock} */
    const deadStock = [];
    /** @type {typeof _invInsightsUsage} */
    const usage = [];
    // Determine the number of days used to compute the daily consumption rate.
    // For "all time", fall back to 90 days so the rate remains meaningful.
    let rateDays = 30;
    if (from && to) {
      const ms = to.getTime() - from.getTime();
      rateDays = Math.max(1, Math.round(ms / 86400000));
    } else {
      rateDays = 90;
    }
    for (const res of subResults) {
      if (!res || !res.data) continue;
      const { groups, rows: subRows } = parseSubcategoryDocToTable(res.data);
      for (const r of subRows) {
        for (const g of groups) {
          const cell = r.byGroup && r.byGroup[g.id];
          if (!cell) continue;
          const stock = typeof cell.stock === "number" ? cell.stock : parseNum(cell.stock);
          const current = typeof cell.current === "number" ? cell.current : parseNum(cell.current);
          const rowName = r.name != null ? String(r.name).trim() : "";
          if (!rowName) continue;
          const groupName = g.label != null ? String(g.label) : "";
          const base = {
            catId: res.catId,
            subId: res.subId,
            rowId: String(r.id),
            groupId: String(g.id),
            itemName: rowName,
            groupName,
            subcategoryName: res.subName,
            categoryName: res.catName,
          };
          if (stock > 0) {
            const pctLeft = current / stock;
            if (pctLeft <= INV_INSIGHTS_LOW_THRESHOLD) {
              runningLow.push({ ...base, stock, current, pctLeft });
            }
          }
          const cellKey = `${res.catId}:${res.subId}:${String(r.id)}:${String(g.id)}`;
          if (
            current >= INV_INSIGHTS_DEAD_STOCK_MIN_CURRENT &&
            !activityByCell.has(cellKey) &&
            _invInsightsRange !== "all"
          ) {
            deadStock.push({ ...base, current });
          }
          // Days of Stock Left — compute only when we have any activity or stock target to work from.
          const activityQty = activityByCell.get(cellKey) || 0;
          const dailyRate = activityQty > 0 ? activityQty / rateDays : 0;
          let daysLeft = Infinity;
          if (current <= 0) {
            daysLeft = 0;
          } else if (dailyRate > 0) {
            daysLeft = current / dailyRate;
          }
          const isFinite = Number.isFinite(daysLeft);
          // Only track cells that either have any activity, have a stock target, or are out of stock.
          if (activityQty > 0 || stock > 0 || current <= 0) {
            let level = "ok";
            if (isFinite) {
              if (daysLeft <= INV_INSIGHTS_CRITICAL_DAYS) level = "critical";
              else if (daysLeft <= INV_INSIGHTS_LOW_DAYS) level = "low";
            }
            usage.push({
              ...base,
              stock,
              current,
              dailyRate,
              daysLeft,
              level,
            });
          }
        }
      }
    }
    runningLow.sort((a, b) => a.pctLeft - b.pctLeft || b.stock - a.stock);
    deadStock.sort((a, b) => b.current - a.current || a.itemName.localeCompare(b.itemName));
    usage.sort((a, b) => {
      const ad = Number.isFinite(a.daysLeft) ? a.daysLeft : Number.POSITIVE_INFINITY;
      const bd = Number.isFinite(b.daysLeft) ? b.daysLeft : Number.POSITIVE_INFINITY;
      if (ad !== bd) return ad - bd;
      return b.dailyRate - a.dailyRate || a.itemName.localeCompare(b.itemName);
    });
    // Smart reorder suggestions = items forecast to run out within the reorder window AND have actual demand signal.
    const reorder = usage.filter(
      (u) => u.dailyRate > 0 && Number.isFinite(u.daysLeft) && u.daysLeft <= INV_INSIGHTS_REORDER_DAYS
    );

    // Count "Done" orders separately — only fully received/bought orders count as real purchases.
    let doneOrders = 0;
    ordersSnap.forEach((d) => {
      if (!ordersWithActivity.has(d.id)) return;
      const effStatus = getEffectiveInventoryOrderStatus({ id: d.id, ...d.data() });
      if (effStatus === "done") doneOrders += 1;
    });

    if (seq !== _invInsightsLoadSeq) return;
    let spendPctChange = null;
    if (prevSpend > 0) {
      spendPctChange = ((totalSpend - prevSpend) / prevSpend) * 100;
    } else if (totalSpend > 0) {
      spendPctChange = null; // No baseline — can't compare.
    }
    _invInsightsRows = rows;
    _invInsightsKpis = {
      totalSpend,
      doneOrders,
      totalOrders: ordersWithActivity.size,
      uniqueItems: rows.length,
      prevSpend,
      spendPctChange,
    };
    _invInsightsCategorySpend = categoryRows;
    _invInsightsRunningLow = runningLow;
    _invInsightsDeadStock = deadStock;
    _invInsightsUsage = usage;
    _invInsightsReorder = reorder;
  } catch (e) {
    console.error("[Inventory] insights load failed", e);
    if (seq !== _invInsightsLoadSeq) return;
    _invInsightsRows = [];
    _invInsightsKpis = { totalSpend: 0, doneOrders: 0, totalOrders: 0, uniqueItems: 0, prevSpend: 0, spendPctChange: null };
    _invInsightsCategorySpend = [];
    _invInsightsRunningLow = [];
    _invInsightsDeadStock = [];
    _invInsightsUsage = [];
    _invInsightsReorder = [];
    _invInsightsError = "Could not load insights data.";
  } finally {
    if (seq === _invInsightsLoadSeq) {
      _invInsightsLoading = false;
      mountOrRefreshMockUi();
    }
  }
}

/** Fixed palette for donut slices. Shared across charts so colors stay consistent. */
const INV_INSIGHTS_CHART_COLORS = [
  "#7c3aed", // purple
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ec4899", // pink
  "#14b8a6", // teal
  "#ef4444", // red
  "#6366f1", // indigo
  "#84cc16", // lime
  "#64748b", // slate (reserved for "Other")
];

/** Build an SVG donut chart from [{ name, spend, percent }] rows. Returns "" when empty. */
function renderInsightsDonutSvg(rows, totalSpend) {
  const sum = rows.reduce((acc, r) => acc + (Number(r.spend) || 0), 0);
  if (!(sum > 0) || !rows.length) return "";
  const cx = 70;
  const cy = 70;
  const rOuter = 60;
  const rInner = 40;
  // Single-slice edge case: draw two half-arc slices so SVG renders correctly.
  if (rows.length === 1) {
    const color = INV_INSIGHTS_CHART_COLORS[0];
    const ring = `<circle cx="${cx}" cy="${cy}" r="${(rOuter + rInner) / 2}" fill="none" stroke="${color}" stroke-width="${rOuter - rInner}" />`;
    const totalText = formatInsightsCurrency(totalSpend);
    return `<svg class="ff-inv2-insights-donut-svg" viewBox="0 0 140 140" width="140" height="140" role="img" aria-label="Spend by category donut chart">
  ${ring}
  <text class="ff-inv2-insights-donut-total" x="${cx}" y="${cy - 4}" text-anchor="middle">${escapeHtml(totalText)}</text>
  <text class="ff-inv2-insights-donut-sub" x="${cx}" y="${cy + 12}" text-anchor="middle">Total spend</text>
</svg>`;
  }
  let angle = -Math.PI / 2; // Start at top.
  const slices = rows
    .map((r, i) => {
      const frac = (Number(r.spend) || 0) / sum;
      if (!(frac > 0)) return "";
      const start = angle;
      const end = angle + frac * 2 * Math.PI;
      angle = end;
      const largeArc = end - start > Math.PI ? 1 : 0;
      const x1o = cx + rOuter * Math.cos(start);
      const y1o = cy + rOuter * Math.sin(start);
      const x2o = cx + rOuter * Math.cos(end);
      const y2o = cy + rOuter * Math.sin(end);
      const x1i = cx + rInner * Math.cos(end);
      const y1i = cy + rInner * Math.sin(end);
      const x2i = cx + rInner * Math.cos(start);
      const y2i = cy + rInner * Math.sin(start);
      const d = [
        `M ${x1o.toFixed(2)} ${y1o.toFixed(2)}`,
        `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2o.toFixed(2)} ${y2o.toFixed(2)}`,
        `L ${x1i.toFixed(2)} ${y1i.toFixed(2)}`,
        `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x2i.toFixed(2)} ${y2i.toFixed(2)}`,
        "Z",
      ].join(" ");
      const color = INV_INSIGHTS_CHART_COLORS[i % INV_INSIGHTS_CHART_COLORS.length];
      const title = `${r.name}: ${formatInsightsCurrency(r.spend)} (${r.percent}%)`;
      return `<path d="${d}" fill="${color}" stroke="#fff" stroke-width="1.5"><title>${escapeHtml(title)}</title></path>`;
    })
    .join("");
  const totalText = formatInsightsCurrency(totalSpend);
  return `<svg class="ff-inv2-insights-donut-svg" viewBox="0 0 140 140" width="140" height="140" role="img" aria-label="Spend by category donut chart">
  ${slices}
  <text class="ff-inv2-insights-donut-total" x="${cx}" y="${cy - 4}" text-anchor="middle">${escapeHtml(totalText)}</text>
  <text class="ff-inv2-insights-donut-sub" x="${cx}" y="${cy + 12}" text-anchor="middle">Total spend</text>
</svg>`;
}

function formatInsightsCurrency(n) {
  const v = Number(n);
  const amount = Number.isFinite(v) ? v : 0;
  if (typeof window !== "undefined" && typeof window.ffFormatCurrency === "function") {
    return window.ffFormatCurrency(amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const r = Math.round(amount * 100) / 100;
  try {
    return `$${r.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } catch (e) {
    return `$${r.toFixed(2)}`;
  }
}

function renderInventoryInsightsTabHtml() {
  const ranges = [
    { id: "30d", label: "Last 30 days" },
    { id: "60d", label: "Last 60 days" },
    { id: "120d", label: "Last 120 days" },
    { id: "year", label: "Last year" },
    { id: "all", label: "All time" },
    { id: "custom", label: "Custom range…" },
  ];
  const options = ranges
    .map((r) => {
      const sel = _invInsightsRange === r.id ? " selected" : "";
      return `<option value="${r.id}"${sel}>${escapeHtml(r.label)}</option>`;
    })
    .join("");
  const rangeControl = `<label class="ff-inv2-insights-range-label">Range
  <select class="ff-inv2-insights-range-select" data-inv-insights-range-select aria-label="Date range">${options}</select>
</label>`;
  const customRow =
    _invInsightsRange === "custom"
      ? `<div class="ff-inv2-insights-custom">
  <label class="ff-inv2-insights-date-label">From <input type="date" data-inv-insights-from value="${escapeHtml(_invInsightsCustomFrom)}" /></label>
  <label class="ff-inv2-insights-date-label">To <input type="date" data-inv-insights-to value="${escapeHtml(_invInsightsCustomTo)}" /></label>
</div>`
      : "";
  const kpis = _invInsightsKpis;
  const inProgress = Math.max(0, (kpis.totalOrders || 0) - (kpis.doneOrders || 0));
  const doneSubtitle = kpis.totalOrders > 0
    ? `${kpis.doneOrders} of ${kpis.totalOrders} · ${inProgress} in progress`
    : "No activity yet";
  // Month-over-Month delta for Total spend.
  let spendDeltaHtml = `<span class="ff-inv2-insights-kpi-sub">Based on items actually bought</span>`;
  const pct = kpis.spendPctChange;
  if (_invInsightsRange !== "all" && typeof pct === "number" && Number.isFinite(pct)) {
    const rounded = Math.round(pct * 10) / 10;
    const up = rounded > 0;
    const flat = Math.abs(rounded) < 0.05;
    // For spend, UP is bad (red) and DOWN is good (green). Flat stays neutral.
    const cls = flat ? "ff-inv2-insights-delta--flat" : up ? "ff-inv2-insights-delta--up" : "ff-inv2-insights-delta--down";
    const arrow = flat ? "≈" : up ? "▲" : "▼";
    const label = flat
      ? "No change vs previous period"
      : `${Math.abs(rounded)}% vs previous (${escapeHtml(formatInsightsCurrency(kpis.prevSpend || 0))})`;
    spendDeltaHtml = `<span class="ff-inv2-insights-delta ${cls}"><span class="ff-inv2-insights-delta-arrow">${arrow}</span>${escapeHtml(label)}</span>`;
  } else if (_invInsightsRange !== "all" && (kpis.prevSpend || 0) === 0 && (kpis.totalSpend || 0) > 0) {
    spendDeltaHtml = `<span class="ff-inv2-insights-kpi-sub">No prior-period spend</span>`;
  }
  const kpiBlock = `<div class="ff-inv2-insights-kpis">
  <div class="ff-inv2-insights-kpi">
    <span class="ff-inv2-insights-kpi-label">Total spend</span>
    <span class="ff-inv2-insights-kpi-value">${escapeHtml(formatInsightsCurrency(kpis.totalSpend))}</span>
    ${spendDeltaHtml}
  </div>
  <div class="ff-inv2-insights-kpi">
    <span class="ff-inv2-insights-kpi-label">Done orders</span>
    <span class="ff-inv2-insights-kpi-value">${escapeHtml(String(kpis.doneOrders))}</span>
    <span class="ff-inv2-insights-kpi-sub">${escapeHtml(doneSubtitle)}</span>
  </div>
  <div class="ff-inv2-insights-kpi">
    <span class="ff-inv2-insights-kpi-label">Unique items</span>
    <span class="ff-inv2-insights-kpi-value">${escapeHtml(String(kpis.uniqueItems))}</span>
    <span class="ff-inv2-insights-kpi-sub">Distinct SKUs purchased</span>
  </div>
</div>`;

  let mostPurchasedBody;
  if (_invInsightsLoading) {
    mostPurchasedBody = `<p class="ff-inv2-insights-empty">Loading…</p>`;
  } else if (_invInsightsError) {
    mostPurchasedBody = `<p class="ff-inv2-insights-empty">${escapeHtml(_invInsightsError)}</p>`;
  } else if (_invInsightsRows.length === 0) {
    mostPurchasedBody = `<p class="ff-inv2-insights-empty">No purchases in this range.</p>`;
  } else {
    mostPurchasedBody = `<ol class="ff-inv2-insights-list">${_invInsightsRows
      .map(
        (r, i) => `<li class="ff-inv2-insights-row">
  <span class="ff-inv2-insights-rank">${i + 1}.</span>
  <span class="ff-inv2-insights-name">${escapeHtml(r.name)}</span>
  <span class="ff-inv2-insights-qty">${escapeHtml(formatOrderDisplay(r.totalQty))}</span>
</li>`
      )
      .join("")}</ol>`;
  }

  // Spend by Category
  const categoryRows = _invInsightsCategorySpend || [];
  const spendBlock = !_invInsightsLoading && categoryRows.length > 0
    ? `<div class="ff-inv2-insights-card">
  <div class="ff-inv2-insights-card-head">
    <h4 class="ff-inv2-insights-card-title">Spend by Category</h4>
  </div>
  <div class="ff-inv2-insights-spend-list">${categoryRows
    .map((r) => `<div class="ff-inv2-insights-spend-row">
  <div class="ff-inv2-insights-spend-name-row">
    <span class="ff-inv2-insights-spend-name">${escapeHtml(r.name)}</span>
    <span class="ff-inv2-insights-spend-amount">${escapeHtml(formatInsightsCurrency(r.spend))}</span>
    <span class="ff-inv2-insights-spend-pct">${escapeHtml(String(r.percent))}%</span>
  </div>
  <div class="ff-inv2-insights-spend-bar" aria-hidden="true"><span style="width:${Math.max(2, r.percent)}%"></span></div>
</div>`)
    .join("")}</div>
</div>`
    : "";

  // Running Low
  const runningLow = _invInsightsRunningLow || [];
  const lowList = runningLow.slice(0, 8);
  const lowBlock = !_invInsightsLoading && lowList.length > 0
    ? `<div class="ff-inv2-insights-card ff-inv2-insights-card--warn">
  <div class="ff-inv2-insights-card-head">
    <h4 class="ff-inv2-insights-card-title">⚠ Running Low (${runningLow.length})</h4>
    <span class="ff-inv2-insights-card-hint">Below ${Math.round(INV_INSIGHTS_LOW_THRESHOLD * 100)}% of stock target</span>
  </div>
  <ul class="ff-inv2-insights-low-list">${lowList
    .map((e) => {
      const pct = Math.max(0, Math.round(e.pctLeft * 100));
      const name = e.groupName ? `${e.itemName} (${e.groupName})` : e.itemName;
      const path = [e.categoryName, e.subcategoryName].filter(Boolean).join(" › ");
      return `<li class="ff-inv2-insights-low-row">
  <div class="ff-inv2-insights-low-main">
    <div class="ff-inv2-insights-low-name">${escapeHtml(name)}</div>
    <div class="ff-inv2-insights-low-path">${escapeHtml(path)}</div>
  </div>
  <div class="ff-inv2-insights-low-qty">
    <span class="ff-inv2-insights-low-current">${escapeHtml(formatOrderDisplay(e.current))}</span>
    <span class="ff-inv2-insights-low-sep">/</span>
    <span class="ff-inv2-insights-low-stock">${escapeHtml(formatOrderDisplay(e.stock))}</span>
    <span class="ff-inv2-insights-low-pct">${pct}%</span>
  </div>
</li>`;
    })
    .join("")}</ul>
</div>`
    : "";

  // Dead Stock
  const deadStock = _invInsightsDeadStock || [];
  const deadList = deadStock.slice(0, 8);
  const rangeLabelForDead = _invInsightsRange === "all" ? "" : (
    _invInsightsRange === "custom"
      ? "in selected range"
      : _invInsightsRange === "year"
        ? "in the past year"
        : `in last ${_invInsightsRange.replace("d", " days")}`
  );
  const deadBlock = !_invInsightsLoading && deadList.length > 0 && _invInsightsRange !== "all"
    ? `<div class="ff-inv2-insights-card ff-inv2-insights-card--dead">
  <div class="ff-inv2-insights-card-head">
    <h4 class="ff-inv2-insights-card-title">Dead Stock (${deadStock.length})</h4>
    <span class="ff-inv2-insights-card-hint">In stock · no activity ${escapeHtml(rangeLabelForDead)}</span>
  </div>
  <ul class="ff-inv2-insights-low-list">${deadList
    .map((e) => {
      const name = e.groupName ? `${e.itemName} (${e.groupName})` : e.itemName;
      const path = [e.categoryName, e.subcategoryName].filter(Boolean).join(" › ");
      return `<li class="ff-inv2-insights-low-row">
  <div class="ff-inv2-insights-low-main">
    <div class="ff-inv2-insights-low-name">${escapeHtml(name)}</div>
    <div class="ff-inv2-insights-low-path">${escapeHtml(path)}</div>
  </div>
  <div class="ff-inv2-insights-low-qty">
    <span class="ff-inv2-insights-low-current">${escapeHtml(formatOrderDisplay(e.current))}</span>
    <span class="ff-inv2-insights-low-sep">in stock</span>
  </div>
</li>`;
    })
    .join("")}</ul>
</div>`
    : "";

  // Smart Reorder Suggestions — forecast-driven, showing items likely to run out soon.
  const reorder = _invInsightsReorder || [];
  const reorderList = reorder.slice(0, 10);
  const reorderBlock = !_invInsightsLoading && reorderList.length > 0
    ? `<div class="ff-inv2-insights-card ff-inv2-insights-card--warn">
  <div class="ff-inv2-insights-card-head">
    <h4 class="ff-inv2-insights-card-title">⏰ Reorder Suggestions (${reorder.length})</h4>
    <span class="ff-inv2-insights-card-hint">Will run out within ${INV_INSIGHTS_REORDER_DAYS} days at current pace</span>
  </div>
  <ul class="ff-inv2-insights-low-list">${reorderList
    .map((u) => {
      const name = u.groupName ? `${u.itemName} (${u.groupName})` : u.itemName;
      const path = [u.categoryName, u.subcategoryName].filter(Boolean).join(" › ");
      const days = Math.max(0, Math.round(u.daysLeft));
      const target = u.stock > 0 ? u.stock : Math.max(1, Math.round(u.dailyRate * (INV_INSIGHTS_LOW_DAYS * 2)));
      const suggest = Math.max(1, Math.ceil(target - u.current));
      const ratePerWeek = Math.round(u.dailyRate * 7 * 10) / 10;
      const rateLabel = ratePerWeek >= 1 ? `${ratePerWeek}/wk` : `${Math.round(u.dailyRate * 30 * 10) / 10}/mo`;
      return `<li class="ff-inv2-insights-low-row">
  <div class="ff-inv2-insights-low-main">
    <div class="ff-inv2-insights-low-name">${escapeHtml(name)}</div>
    <div class="ff-inv2-insights-low-path">${escapeHtml(path)} · ${escapeHtml(rateLabel)}</div>
  </div>
  <div class="ff-inv2-insights-reorder-qty">
    <span class="ff-inv2-insights-reorder-days">${days}d left</span>
    <span class="ff-inv2-insights-reorder-suggest">Order ${escapeHtml(formatOrderDisplay(suggest))}</span>
  </div>
</li>`;
    })
    .join("")}</ul>
</div>`
    : "";

  // Days of Stock Left — forecast card (usage-driven view only).
  // Only include items with meaningful forecast signal:
  // - dailyRate > 0 (real usage history) → a proper forecast
  // - current > 0 && some signal on stock target → shows how long stock will last
  // Exclude items with current=0 AND no usage — those are "inactive", not a forecast.
  const usage = _invInsightsUsage || [];
  const usageList = usage
    .filter((u) => u.dailyRate > 0 || (u.current > 0 && u.stock > 0))
    .slice(0, 12);
  const totalAtRisk = usage.filter((u) => (u.level === "critical" || u.level === "low") && u.dailyRate > 0).length;
  const usageBlock = !_invInsightsLoading && usageList.length > 0
    ? `<div class="ff-inv2-insights-card">
  <div class="ff-inv2-insights-card-head">
    <h4 class="ff-inv2-insights-card-title">Days of Stock Left</h4>
    <span class="ff-inv2-insights-card-hint">${totalAtRisk > 0 ? `${totalAtRisk} at risk` : "Based on usage in the selected range"}</span>
  </div>
  <ul class="ff-inv2-insights-usage-list">${usageList
    .map((u) => {
      const name = u.groupName ? `${u.itemName} (${u.groupName})` : u.itemName;
      const path = [u.categoryName, u.subcategoryName].filter(Boolean).join(" › ");
      const hasUsage = u.dailyRate > 0;
      // Only show a numeric days label when we have real usage data.
      // Without usage, the forecast is meaningless — show "—" instead of a fake "0d".
      let daysLabel;
      let levelForBadge = u.level;
      if (hasUsage) {
        daysLabel = Number.isFinite(u.daysLeft) ? `${Math.max(0, Math.round(u.daysLeft))}d` : "∞";
      } else if (u.current <= 0) {
        daysLabel = "Empty";
        levelForBadge = "critical";
      } else {
        daysLabel = "—";
        levelForBadge = "ok";
      }
      const ratePerWeek = Math.round(u.dailyRate * 7 * 10) / 10;
      const rateLabel = hasUsage
        ? (ratePerWeek >= 1 ? `${ratePerWeek}/wk` : `${Math.round(u.dailyRate * 30 * 10) / 10}/mo`)
        : "no recent usage";
      const levelCls = `ff-inv2-insights-usage-badge--${levelForBadge}`;
      return `<li class="ff-inv2-insights-usage-row">
  <div class="ff-inv2-insights-usage-main">
    <div class="ff-inv2-insights-usage-name">${escapeHtml(name)}</div>
    <div class="ff-inv2-insights-usage-path">${escapeHtml(path)} · ${escapeHtml(rateLabel)}</div>
  </div>
  <div class="ff-inv2-insights-usage-meta">
    <span class="ff-inv2-insights-usage-current">${escapeHtml(formatOrderDisplay(u.current))} left</span>
    <span class="ff-inv2-insights-usage-badge ${levelCls}">${escapeHtml(daysLabel)}</span>
  </div>
</li>`;
    })
    .join("")}</ul>
  ${usage.length > usageList.length ? `<div class="ff-inv2-insights-usage-more">+ ${usage.length - usageList.length} more tracked</div>` : ""}
</div>`
    : "";

  // Wrap Most Purchased as a standalone card so we can place it inside a sub-tab.
  const mostPurchasedCard = `<div class="ff-inv2-insights-card">
    <div class="ff-inv2-insights-card-head">
      <h4 class="ff-inv2-insights-card-title">Most Purchased</h4>
    </div>
    <div class="ff-inv2-insights-body">${mostPurchasedBody}</div>
  </div>`;

  // ---- Sub-tabs inside Insights ------------------------------------------
  const subTabs = [
    { id: "overview", label: "Overview" },
    { id: "purchases", label: "Purchases" },
    { id: "forecast", label: "Forecast" },
    { id: "health", label: "Stock Health" },
  ];
  const activeSub = subTabs.some((t) => t.id === _invInsightsSubTab) ? _invInsightsSubTab : "overview";
  const subTabBar = `<div class="ff-inv2-insights-subtabs" role="tablist" aria-label="Insights sections">${subTabs
    .map((t) => {
      const active = t.id === activeSub ? " ff-inv2-insights-subtab--active" : "";
      return `<button type="button" class="ff-inv2-insights-subtab${active}" role="tab" aria-selected="${t.id === activeSub}" data-inv-insights-subtab="${t.id}">${escapeHtml(t.label)}</button>`;
    })
    .join("")}</div>`;

  const emptyState = (msg) => `<div class="ff-inv2-insights-card"><p class="ff-inv2-insights-empty">${escapeHtml(msg)}</p></div>`;

  // Donut chart (Spend by Category) for Overview.
  const categoryRowsForDonut = _invInsightsCategorySpend || [];
  // Collapse categories beyond the palette size into "Other" so the chart stays readable.
  const maxSlices = INV_INSIGHTS_CHART_COLORS.length - 1; // reserve last color for "Other"
  let donutRows = categoryRowsForDonut;
  if (categoryRowsForDonut.length > maxSlices) {
    const top = categoryRowsForDonut.slice(0, maxSlices);
    const rest = categoryRowsForDonut.slice(maxSlices);
    const restSpend = rest.reduce((acc, r) => acc + (r.spend || 0), 0);
    const totalSpendSum = categoryRowsForDonut.reduce((acc, r) => acc + (r.spend || 0), 0) || 0;
    const restPct = totalSpendSum > 0 ? Math.round((restSpend / totalSpendSum) * 1000) / 10 : 0;
    donutRows = [...top, { name: `Other (${rest.length})`, spend: restSpend, percent: restPct }];
  }
  const donutSvg = renderInsightsDonutSvg(donutRows, kpis.totalSpend || 0);
  const donutBlock = donutSvg
    ? `<div class="ff-inv2-insights-card">
  <div class="ff-inv2-insights-card-head">
    <h4 class="ff-inv2-insights-card-title">Spend by Category</h4>
    <span class="ff-inv2-insights-card-hint">${donutRows.length} ${donutRows.length === 1 ? "category" : "categories"}</span>
  </div>
  <div class="ff-inv2-insights-donut-wrap">
    <div class="ff-inv2-insights-donut-chart">${donutSvg}</div>
    <ul class="ff-inv2-insights-donut-legend">${donutRows
      .map((r, i) => {
        const color = INV_INSIGHTS_CHART_COLORS[i % INV_INSIGHTS_CHART_COLORS.length];
        return `<li class="ff-inv2-insights-donut-legend-row">
  <span class="ff-inv2-insights-donut-dot" style="background:${color}" aria-hidden="true"></span>
  <span class="ff-inv2-insights-donut-legend-name">${escapeHtml(r.name)}</span>
  <span class="ff-inv2-insights-donut-legend-amount">${escapeHtml(formatInsightsCurrency(r.spend))}</span>
  <span class="ff-inv2-insights-donut-legend-pct">${escapeHtml(String(r.percent))}%</span>
</li>`;
      })
      .join("")}</ul>
  </div>
</div>`
    : "";

  let subContent = "";
  if (_invInsightsLoading) {
    subContent = `<div class="ff-inv2-insights-card"><p class="ff-inv2-insights-empty">Loading…</p></div>`;
  } else if (_invInsightsError) {
    subContent = `<div class="ff-inv2-insights-card"><p class="ff-inv2-insights-empty">${escapeHtml(_invInsightsError)}</p></div>`;
  } else if (activeSub === "overview") {
    subContent = `${kpiBlock}${donutBlock}`;
  } else if (activeSub === "purchases") {
    const hasMost = (_invInsightsRows || []).length > 0;
    const hasSpend = (_invInsightsCategorySpend || []).length > 0;
    if (!hasMost && !hasSpend) {
      subContent = emptyState("No purchases in this range yet.");
    } else {
      subContent = `${mostPurchasedCard}${spendBlock}`;
    }
  } else if (activeSub === "forecast") {
    const forecastIntro = `<div class="ff-inv2-insights-subtab-intro">
      <span class="ff-inv2-insights-subtab-intro-icon" aria-hidden="true">🔮</span>
      <div>
        <div class="ff-inv2-insights-subtab-intro-title">Forecast — predicted stock behavior</div>
        <div class="ff-inv2-insights-subtab-intro-hint">Based on your purchase rate in the selected range. Items you haven't bought recently are excluded.</div>
      </div>
    </div>`;
    if (!reorderBlock && !usageBlock) {
      subContent = `${forecastIntro}${emptyState("Not enough purchase history to forecast yet. Buy more items or widen the date range.")}`;
    } else {
      subContent = `${forecastIntro}${reorderBlock}${usageBlock}`;
    }
  } else if (activeSub === "health") {
    if (!lowBlock && !deadBlock) {
      subContent = emptyState("All good — nothing running low or sitting unused.");
    } else {
      subContent = `${lowBlock}${deadBlock}`;
    }
  }

  return `<div class="ff-inv2-insights-wrap">
  <div class="ff-inv2-insights-head">
    <div class="ff-inv2-insights-head-row">
      <h3 class="ff-inv2-insights-title">Inventory Insights</h3>
      ${rangeControl}
    </div>
    ${customRow}
  </div>
  ${subTabBar}
  ${subContent}
</div>`;
}

function renderOrdersTabHtml() {
  if (_invOrdersLoading) {
    return `<div class="ff-inv2-orders-wrap">
  <div class="ff-inv2-orders-head">
    <h3 class="ff-inv2-orders-title">Orders</h3>
  </div>
  <p class="ff-inv2-orders-loading">Loading orders…</p>
</div>`;
  }
  if (_invOrdersLoadError) {
    return `<div class="ff-inv2-orders-wrap">
  <div class="ff-inv2-orders-head">
    <h3 class="ff-inv2-orders-title">Orders</h3>
  </div>
  <p class="ff-inv2-orders-error">${escapeHtml(_invOrdersLoadError)}</p>
</div>`;
  }
  const rows = _invOrdersList;
  if (!rows.length) {
    return `<div class="ff-inv2-orders-wrap">
  <div class="ff-inv2-orders-head">
    <h3 class="ff-inv2-orders-title">Orders</h3>
  </div>
  <p class="ff-inv2-orders-empty">No saved orders yet. Use Create Order to save a draft.</p>
</div>`;
  }
  const fil = _invOrdersStatusFilter;
  const statusFiltered = rows.filter(orderMatchesInventoryStatusFilter);
  const filteredRows = statusFiltered.filter(orderMatchesInventorySearchQuery);
  const statusFilterBar = `<div class="ff-inv2-orders-status-filter" role="toolbar" aria-label="Filter orders by status">
  <span class="ff-inv2-order-detail-filter-label">Status</span>
  <button type="button" class="ff-inv2-od-filter-chip${fil === "open" ? " ff-inv2-od-filter--active" : ""}" data-inv-orders-status-filter="open">Open</button>
  <button type="button" class="ff-inv2-od-filter-chip${fil === "in_progress" ? " ff-inv2-od-filter--active" : ""}" data-inv-orders-status-filter="in_progress">In progress</button>
  <button type="button" class="ff-inv2-od-filter-chip${fil === "done" ? " ff-inv2-od-filter--active" : ""}" data-inv-orders-status-filter="done">Done</button>
  <button type="button" class="ff-inv2-od-filter-chip${fil === "all" ? " ff-inv2-od-filter--active" : ""}" data-inv-orders-status-filter="all">All</button>
</div>`;
  const hasSearchClear = _invOrdersSearchQuery.trim() !== "";
  const searchClearBtn = hasSearchClear
    ? `<button type="button" class="ff-inv2-orders-search-clear" data-inv-orders-search-clear="1" aria-label="Clear search">×</button>`
    : "";
  const ordersToolbar = `<div class="ff-inv2-orders-toolbar">
  <div class="ff-inv2-orders-search-wrap${hasSearchClear ? " ff-inv2-orders-search-wrap--has-clear" : ""}">
    <input type="search" enterkeyhint="search" class="ff-inv2-orders-search-input" placeholder="Search orders..." value="${escapeHtml(_invOrdersSearchQuery)}" data-inv-orders-search-input="1" autocomplete="off" />
    ${searchClearBtn}
  </div>
  ${statusFilterBar}
</div>`;
  if (!statusFiltered.length) {
    return `<div class="ff-inv2-orders-wrap">
  <div class="ff-inv2-orders-head">
    <h3 class="ff-inv2-orders-title">Orders</h3>
  </div>
  ${ordersToolbar}
  <p class="ff-inv2-orders-filter-empty">No orders match this filter.</p>
</div>`;
  }
  if (!filteredRows.length) {
    return `<div class="ff-inv2-orders-wrap">
  <div class="ff-inv2-orders-head">
    <h3 class="ff-inv2-orders-title">Orders</h3>
  </div>
  ${ordersToolbar}
  <p class="ff-inv2-orders-filter-empty">No orders match your search.</p>
</div>`;
  }
  const body = filteredRows
    .map((o) => {
      const name = getInventoryOrderDisplayName(o);
      const src = formatInventoryOrderSourceLabel(o);
      const status = formatInventoryOrderStatusDisplay(o);
      const created = formatInventoryOrderCreatedAt(o.createdAt);
      const n = typeof o.itemCount === "number" ? o.itemCount : Array.isArray(o.items) ? o.items.length : 0;
      const oid = escapeHtml(o.id);
      return `<tr class="ff-inv2-orders-tr" tabindex="0" data-inv-order-row="1" data-inv-order-id="${oid}">
  <td class="ff-inv2-orders-td ff-inv2-orders-td--name">${escapeHtml(name)}</td>
  <td class="ff-inv2-orders-td ff-inv2-orders-td--muted ff-inv2-orders-td--src">${escapeHtml(src)}</td>
  <td class="ff-inv2-orders-td">${escapeHtml(status)}</td>
  <td class="ff-inv2-orders-td ff-inv2-orders-td--muted">${escapeHtml(created)}</td>
  <td class="ff-inv2-orders-td ff-inv2-orders-td--num">${escapeHtml(String(n))}</td>
  <td class="ff-inv2-orders-td ff-inv2-orders-td--actions" data-inv-orders-actions="1">
    <button type="button" class="ff-inv2-orders-kebab" data-inv-orders-menu-trigger="${oid}" aria-label="Order actions" title="Order actions">⋯</button>
  </td>
</tr>`;
    })
    .join("");
  return `<div class="ff-inv2-orders-wrap">
  <div class="ff-inv2-orders-head">
    <h3 class="ff-inv2-orders-title">Orders</h3>
  </div>
  ${ordersToolbar}
  <div class="ff-inv2-orders-scroll">
    <table class="ff-inv2-orders-table">
      <thead>
        <tr>
          <th class="ff-inv2-orders-th">Name</th>
          <th class="ff-inv2-orders-th">Source</th>
          <th class="ff-inv2-orders-th">Status</th>
          <th class="ff-inv2-orders-th">Created</th>
          <th class="ff-inv2-orders-th ff-inv2-orders-th--num">Items</th>
          <th class="ff-inv2-orders-th ff-inv2-orders-th--narrow" aria-label="Actions"></th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  </div>
</div>`;
}

function renderInventoryOrderDetailModal() {
  if (!_invOrdersDetailOrderId) return "";
  const o = _invOrdersList.find((x) => x.id === _invOrdersDetailOrderId);
  if (!o) {
    return `<div class="ff-inv2-modal-backdrop" id="ff-inv-order-detail-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv-order-detail-title">
  <div class="ff-inv2-modal-card ff-inv2-order-detail-card">
    <h3 id="ff-inv-order-detail-title" class="ff-inv2-modal-title">Order</h3>
    <p class="ff-inv2-order-detail-missing">This order is no longer in the list.</p>
    <div class="ff-inv2-modal-actions">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-inv-order-detail-close="1">Close</button>
    </div>
  </div>
</div>`;
  }
  const src = formatInventoryOrderSourceLabel(o);
  const created = formatInventoryOrderCreatedAt(o.createdAt);
  const statusLabel = formatInventoryOrderStatusDisplay(o);
  const orderedAt = o.orderedAt ? formatInventoryOrderCreatedAt(o.orderedAt) : "";
  const orderedBy = o.orderedAt ? formatInventoryOrderOrderedByDisplay(o.orderedBy) : "";
  const n = typeof o.itemCount === "number" ? o.itemCount : Array.isArray(o.items) ? o.items.length : 0;
  const items = Array.isArray(o.items) ? o.items : [];
  const oidEsc = escapeHtml(o.id);
  ensureShoppingDraft(o.id);
  const shop = _invOrderShoppingDraft[o.id];
  const receiveBusy = _invOrderReceiveBusy;
  const purchaseBusy = _invOrderPurchaseBusy;
  const detailCommitBusy = receiveBusy || purchaseBusy;
  const receiveDisabled = detailCommitBusy ? " disabled" : "";
  const orderTitle = escapeHtml(getInventoryOrderDisplayName(o));
  const fil = _invOrderDetailFilter;
  const filteredPairs = items
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => orderDetailLineMatchesFilter(it));
  const displayPairs = sortOrderDetailPairsOpenFirst(filteredPairs);
  const lineFilterBar =
    items.length > 0
      ? `<div class="ff-inv2-order-detail-line-filter" role="toolbar" aria-label="Filter lines">
  <button type="button" class="ff-inv2-od-filter-chip${fil === "all" ? " ff-inv2-od-filter--active" : ""}" data-inv-order-detail-filter="all"${receiveDisabled}>All</button>
  <button type="button" class="ff-inv2-od-filter-chip${fil === "open" ? " ff-inv2-od-filter--active" : ""}" data-inv-order-detail-filter="open"${receiveDisabled}>Open</button>
  <button type="button" class="ff-inv2-od-filter-chip${fil === "received" ? " ff-inv2-od-filter--active" : ""}" data-inv-order-detail-filter="received"${receiveDisabled}>Done</button>
</div>`
      : "";
  const itemRows = displayPairs
    .map(({ it, idx }) => {
      const vis = getOrderLineReceiveVisualState(it);
      const ordQNum = getItemOrderQty(it);
      const ordQ = formatOrderDisplay(ordQNum);
      const qb =
        shop && shop.qtyBought[idx] != null && String(shop.qtyBought[idx]).trim() !== ""
          ? String(shop.qtyBought[idx])
          : "";
      const qbNum = parseNum(qb);
      const derivedChecked = qbNum > 0 && (ordQNum <= 0 || qbNum >= ordQNum);
      const chk = derivedChecked ? " checked" : "";
      const name = escapeHtml(it.itemName != null ? String(it.itemName) : "");
      const gLine = getOrderItemGroupLabel(it);
      const groupSpan =
        gLine !== "" ? `<span class="ff-inv2-od-item-group">(${escapeHtml(gLine)})</span>` : "";
      const codeRaw = it.code != null ? String(it.code) : "";
      const code = escapeHtml(codeRaw);
      const itemCell = `<td class="ff-inv2-od-td ff-inv2-od-td--item"><div class="ff-inv2-od-item-stack"><span class="ff-inv2-od-item-name" title="${name}">${name}</span>${groupSpan}</div></td>`;
      const codeCell = `<td class="ff-inv2-od-td ff-inv2-od-td--code"><span class="ff-inv2-od-item-code${codeRaw === "" ? " ff-inv2-od-item-code--empty" : ""}">${codeRaw !== "" ? code : "—"}</span></td>`;
      const qbAttr = qb !== "" ? escapeHtml(qb) : "";
      return `<tr class="ff-inv2-od-tr ${vis.rowClass}" data-inv-detail-shopping-row="1" data-line-idx="${idx}">
  <td class="ff-inv2-od-td ff-inv2-od-td--center ff-inv2-od-td--check"><label class="ff-inv2-od-shopping-check-label">
  <input type="checkbox" class="ff-inv2-od-shopping-check" data-inv-shopping-check="1" data-order-id="${oidEsc}" data-line-idx="${idx}"${chk}${receiveDisabled} aria-label="Got this item" />
  <span class="ff-inv2-od-shopping-check-fake" aria-hidden="true"></span>
</label></td>
  ${itemCell}
  ${codeCell}
  <td class="ff-inv2-od-td ff-inv2-od-td--num ff-inv2-od-td--qty"><span class="ff-inv2-od-qty-need-value">${escapeHtml(ordQ)}</span></td>
  <td class="ff-inv2-od-td ff-inv2-od-td--num ff-inv2-od-td--input ff-inv2-od-td--qty-bought"><div class="ff-inv2-od-qty-bought-wrap"><div class="ff-inv2-od-qty-bought-input-row"><input type="number" class="ff-inv2-od-recv-qty ff-inv2-od-qty-bought" data-inv-shopping-qty-bought="1" data-order-id="${oidEsc}" data-line-idx="${idx}" value="${qbAttr}" min="0" step="any" inputmode="decimal" autocomplete="off"${receiveDisabled} title="Bought" /></div></div></td>
</tr>`;
    })
    .join("");
  const theadChecklist = `<thead><tr>
<th class="ff-inv2-od-th ff-inv2-od-th--narrow ff-inv2-od-th--center" aria-label="Got it"></th>
<th class="ff-inv2-od-th ff-inv2-od-th--item">Item</th>
<th class="ff-inv2-od-th ff-inv2-od-th--code ff-inv2-od-th--letter" title="Code">K</th>
<th class="ff-inv2-od-th ff-inv2-od-th--num ff-inv2-od-th--letter" title="Needed">N</th>
<th class="ff-inv2-od-th ff-inv2-od-th--num ff-inv2-od-th--letter" title="Bought">B</th>
</tr></thead>`;
  const itemsTableBody = items.length
    ? filteredPairs.length === 0
      ? `${lineFilterBar}<p class="ff-inv2-order-detail-no-items">No lines match this filter.</p>`
      : `${lineFilterBar}<div class="ff-inv2-order-detail-list-scroll">
<table class="ff-inv2-order-detail-items ff-inv2-order-detail-items--checklist">
${theadChecklist}
<tbody>${itemRows}</tbody>
</table></div>`
    : `<p class="ff-inv2-order-detail-no-items">No line items.</p>`;
  const orderedMeta =
    o.orderedAt != null
      ? `<div class="ff-inv2-order-detail-meta-row"><dt>Ordered</dt><dd>${escapeHtml(orderedAt)}</dd></div>
  <div class="ff-inv2-order-detail-meta-row"><dt>Ordered by</dt><dd>${escapeHtml(orderedBy)}</dd></div>`
      : "";
  const detailTotals = getOrderDetailTotals(items);
  const receiveSummaryCounts = getOrderReceiveSummaryCounts(items);
  const extrasBlock = `<details class="ff-inv2-order-detail-extras ff-inv2-order-detail-extras--minimal">
  <summary class="ff-inv2-order-detail-extras-summary">Source &amp; details</summary>
  <div class="ff-inv2-order-detail-extras-body">
    <dl class="ff-inv2-order-detail-meta ff-inv2-order-detail-meta--compact">
      <div class="ff-inv2-order-detail-meta-row"><dt>Source</dt><dd>${escapeHtml(src)}</dd></div>
      <div class="ff-inv2-order-detail-meta-row"><dt>Created</dt><dd>${escapeHtml(created)}</dd></div>
      ${orderedMeta}
      <div class="ff-inv2-order-detail-meta-row"><dt>Lines</dt><dd>${escapeHtml(String(n))}</dd></div>
    </dl>
    <p class="ff-inv2-order-detail-totals-line" role="status">Ordered ${escapeHtml(formatOrderDisplay(detailTotals.orderedQty))} · Received ${escapeHtml(formatOrderDisplay(detailTotals.receivedQty))} · Est. ${escapeHtml(formatOrderDetailEstimatedCost(detailTotals.estimatedCost))}</p>
    <p class="ff-inv2-order-detail-totals-line ff-inv2-order-detail-totals-line--sub">Open ${receiveSummaryCounts.open} · Partial ${receiveSummaryCounts.partial} · Done ${receiveSummaryCounts.received} · Remaining qty ${escapeHtml(formatOrderDisplay(receiveSummaryCounts.remainingQty))}</p>
  </div>
</details>`;
  const shoppingHint = "";
  const purchaseCommitBtn =
    items.length > 0
      ? `<button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-primary ff-inv2-order-detail-purchase-btn" data-inv-order-detail-confirm-purchase="1" data-order-id="${oidEsc}"${receiveDisabled}>${purchaseBusy ? "Updating…" : "Confirm Purchase"}</button>`
      : "";
  return `<div class="ff-inv2-modal-backdrop" id="ff-inv-order-detail-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv-order-detail-title">
  <div class="ff-inv2-modal-card ff-inv2-order-detail-card">
    <header class="ff-inv2-order-detail-hero">
      <div class="ff-inv2-order-detail-hero-main">
        <h2 id="ff-inv-order-detail-title" class="ff-inv2-order-detail-title">${orderTitle}</h2>
        <span class="ff-inv2-order-detail-status-pill">${escapeHtml(statusLabel)}</span>
      </div>
      <div class="ff-inv2-order-detail-head-actions">
        <button type="button" class="ff-inv2-od-detail-action" data-inv-order-detail-print="1"${receiveDisabled}>Print</button>
        <button type="button" class="ff-inv2-od-detail-action" data-inv-order-detail-export-csv="1"${receiveDisabled}>Export CSV</button>
      </div>
    </header>
    ${extrasBlock}
    <div class="ff-inv2-order-detail-main">
    ${itemsTableBody}
    </div>
    ${shoppingHint}
    <div class="ff-inv2-modal-actions ff-inv2-order-detail-footer">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-inv-order-detail-close="1"${receiveDisabled}>Close</button>
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel ff-inv2-order-detail-receipt-btn" data-inv-order-receipt-info="1" data-order-id="${oidEsc}"${receiveDisabled}>Receipt Information</button>
      <span class="ff-inv2-order-detail-footer-spacer" aria-hidden="true"></span>
      ${purchaseCommitBtn}
    </div>
  </div>
</div>`;
}

function renderInventoryOrdersMenu() {
  if (!_invOrdersMenu) return "";
  const m = _invOrdersMenu;
  const oid = escapeHtml(m.orderId);
  const editNameBtn = `<button type="button" class="ff-inv2-row-menu-item" role="menuitem" data-inv-orders-action="editName" data-order-id="${oid}">Edit name</button>`;
  const dupBtn = `<button type="button" class="ff-inv2-row-menu-item" role="menuitem" data-inv-orders-action="duplicate" data-order-id="${oid}">Duplicate</button>`;
  const deleteBtn = `<button type="button" class="ff-inv2-row-menu-item ff-inv2-row-menu-item--danger" role="menuitem" data-inv-orders-action="delete" data-order-id="${oid}">Delete</button>`;
  const inner = `${editNameBtn}${dupBtn}${deleteBtn}`;
  return `<div class="ff-inv2-row-menu-backdrop" data-inv-orders-menu-dismiss="1" aria-hidden="true"></div>
<div class="ff-inv2-row-menu" role="menu" style="left:${m.left}px;top:${m.top}px">
  ${inner}
</div>`;
}

function renderInventoryOrdersRenameModal() {
  if (!_invOrdersRenameModal) return "";
  const m = _invOrdersRenameModal;
  const oid = escapeHtml(m.orderId);
  const val = escapeHtml(m.draftName);
  const busy = !!m.busy;
  const disabled = busy ? " disabled" : "";
  return `<div class="ff-inv2-modal-backdrop" id="ff-inv-orders-rename-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv-orders-rename-title">
  <div class="ff-inv2-modal-card">
    <h3 id="ff-inv-orders-rename-title" class="ff-inv2-modal-title">Edit name</h3>
    <label class="ff-inv2-modal-field">
      <span class="ff-inv2-modal-field-label">Order name</span>
      <input type="text" class="ff-inv2-modal-input" data-inv-orders-rename-input="1" value="${val}" placeholder="e.g. Weekly restock" maxlength="120" autocomplete="off"${disabled} />
    </label>
    <div class="ff-inv2-modal-actions">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-inv-orders-rename-cancel="1"${disabled}>Cancel</button>
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-primary" data-inv-orders-rename-save="1" data-order-id="${oid}"${disabled}>${busy ? "Saving…" : "Save"}</button>
    </div>
  </div>
</div>`;
}

async function renameInventoryOrderConfirmed(orderId, rawName) {
  if (!_invOrdersRenameModal || _invOrdersRenameModal.orderId !== orderId) return;
  const name = String(rawName ?? "").trim().slice(0, 120);
  _invOrdersRenameModal = { ..._invOrdersRenameModal, draftName: name, busy: true };
  mountOrRefreshMockUi();
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    const ref = doc(db, `salons/${salonId}/inventoryOrders`, orderId);
    await updateDoc(ref, { orderName: name, updatedAt: serverTimestamp() });
    _invOrdersRenameModal = null;
    inventoryOrderDraftToast("Name updated.", "success");
    void loadInventoryOrdersList({ silent: true });
  } catch (e) {
    console.error("[Inventory] rename order failed", e);
    _invOrdersRenameModal = _invOrdersRenameModal ? { ..._invOrdersRenameModal, busy: false } : null;
    inventoryOrderDraftToast("Could not rename order.", "error");
    mountOrRefreshMockUi();
  }
}

function renderInventoryOrdersDeleteModal() {
  if (!_invOrdersDeleteConfirmOrderId) return "";
  const oid = escapeHtml(_invOrdersDeleteConfirmOrderId);
  const o = _invOrdersList.find((x) => x.id === _invOrdersDeleteConfirmOrderId);
  const impacted = orderHasAppliedInventoryImpact(o);
  const warningHtml = impacted
    ? `<p class="ff-inv2-modal-hint">This order has already updated your inventory. Deleting it will <strong>not</strong> remove those items from stock.</p>`
    : `<p class="ff-inv2-modal-hint">This order has not touched inventory yet.</p>`;
  return `<div class="ff-inv2-modal-backdrop" id="ff-inv-orders-delete-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv-orders-delete-title">
  <div class="ff-inv2-modal-card">
    <h3 id="ff-inv-orders-delete-title" class="ff-inv2-modal-title">Delete this order?</h3>
    ${warningHtml}
    <div class="ff-inv2-modal-actions">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-inv-orders-delete-cancel="1">Cancel</button>
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-danger" data-inv-orders-delete-commit="1" data-order-id="${oid}">Delete</button>
    </div>
  </div>
</div>`;
}

function renderInventoryOrdersMarkOrderedModal() {
  if (!_invOrdersMarkOrderedConfirmOrderId) return "";
  const oid = escapeHtml(_invOrdersMarkOrderedConfirmOrderId);
  return `<div class="ff-inv2-modal-backdrop" id="ff-inv-orders-mark-ordered-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv-orders-mark-ordered-title">
  <div class="ff-inv2-modal-card">
    <h3 id="ff-inv-orders-mark-ordered-title" class="ff-inv2-modal-title">Mark this order as ordered?</h3>
    <div class="ff-inv2-modal-actions">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-inv-orders-mark-ordered-cancel="1">Cancel</button>
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-primary" data-inv-orders-mark-ordered-commit="1" data-order-id="${oid}">Mark as ordered</button>
    </div>
  </div>
</div>`;
}

function renderInvMainTabPanelsHtml() {
  if (_invMainTab === "orderBuilder") {
    return `<div class="ff-inv2-main-tab-body ff-inv2-main-tab-body--order">
      <div class="ff-inv2-order-builder-wrap">${renderOrderListSectionHtml()}</div>
    </div>`;
  }
  if (_invMainTab === "orders") {
    return `<div class="ff-inv2-main-tab-body ff-inv2-main-tab-body--orders">${renderOrdersTabHtml()}</div>`;
  }
  if (_invMainTab === "insights") {
    return `<div class="ff-inv2-main-tab-body ff-inv2-main-tab-body--insights">${renderInventoryInsightsTabHtml()}</div>`;
  }
  return `<div class="ff-inv2-main-tab-body ff-inv2-main-tab-body--inventory">${renderInventoryTableCardHtml()}</div>`;
}

function invCellKey(inv, rowId, groupId) {
  if (groupId != null && groupId !== "") return `${inv}:${rowId}:${groupId}`;
  return `${inv}:${rowId}`;
}

function getInvCellKeyFromEl(el) {
  const inv = el.getAttribute("data-inv");
  const rowId = el.getAttribute("data-row-id");
  const gid = el.getAttribute("data-group-id");
  if (!inv || !rowId) return "";
  return invCellKey(inv, rowId, gid || null);
}

/**
 * @param {HTMLElement | null} root
 * @param {string} editKey
 */
function findInvEditInput(root, editKey) {
  if (!root || !editKey) return null;
  const list = root.querySelectorAll("input[data-edit-key]");
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    if (el.getAttribute("data-edit-key") === editKey) return el;
  }
  return null;
}

/**
 * @param {string} inv
 * @param {string} rowId
 * @param {string | number} value
 * @param {{ groupId?: string | null, mono?: boolean, classNames?: string, inputMode?: "decimal" | "numeric" }} opts
 */
function renderEditableCell(inv, rowId, value, opts) {
  opts = opts || {};
  const groupId = opts.groupId != null ? opts.groupId : null;
  const key = invCellKey(inv, rowId, groupId);
  const isEditing = _editCellKey === key;
  const extra = String(opts.classNames || "").trim();
  const monoCls = opts.mono ? " ff-inv2-mono" : "";
  const gAttr = groupId != null ? ` data-group-id="${escapeHtml(groupId)}"` : "";
  let inputModeAttr = "";
  if (opts.inputMode === "decimal") inputModeAttr = ` inputmode="decimal" autocomplete="off"`;
  else if (opts.inputMode === "numeric") inputModeAttr = ` inputmode="numeric" autocomplete="off"`;
  if (isEditing) {
    const cls = `ff-inv2-cell-input ff-inv2-cell-input--editing${monoCls}${extra ? ` ${extra}` : ""}`;
    return `<input class="${cls}" type="text"${inputModeAttr} data-inv="${escapeHtml(inv)}" data-row-id="${escapeHtml(rowId)}"${gAttr} data-edit-key="${escapeHtml(key)}" value="${escapeHtml(String(value))}" />`;
  }
  const cls = `ff-inv2-cell-view${extra ? ` ${extra}` : ""}${monoCls}`;
  return `<span class="${cls}" tabindex="0" role="button" data-inv-cell="1" data-inv="${escapeHtml(inv)}" data-row-id="${escapeHtml(rowId)}"${gAttr}>${escapeHtml(String(value))}</span>`;
}

function hrefForUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

function renderUrlCell(rowId, value) {
  const key = invCellKey("url", rowId);
  const isEditing = _editCellKey === key;
  const raw = value != null ? String(value) : "";
  if (isEditing) {
    return `<input class="ff-inv2-cell-input ff-inv2-cell-input--editing" type="text" data-inv="url" data-row-id="${escapeHtml(rowId)}" data-edit-key="${escapeHtml(key)}" value="${escapeHtml(raw)}" autocomplete="url" />`;
  }
  const href = hrefForUrl(raw);
  const hasLink = href !== "";
  const linkBlock = hasLink
    ? `<a class="ff-inv2-url-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(raw)}">${escapeHtml(raw)}</a>`
    : `<span class="ff-inv2-url-empty" title="No URL">—</span>`;
  const pen = `<button type="button" class="ff-inv2-url-edit" data-inv-url-edit="1" data-row-id="${escapeHtml(rowId)}" aria-label="Edit URL"><svg class="ff-inv2-url-edit-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>`;
  return `<div class="ff-inv2-url-cell">${linkBlock}${pen}</div>`;
}

function renderOrderCellTd(rowId, groupId, order, approved) {
  const pos = order > 0;
  const hasApproved = (approved || 0) > 0;
  const classes = [
    "ff-inv2-order-cell",
    pos ? "ff-inv2-order-cell--positive" : "",
    hasApproved ? "ff-inv2-order-cell--has-approved" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<td class="${classes}" data-order-for-row="${escapeHtml(rowId)}" data-order-for-group="${escapeHtml(groupId)}" data-order-approved="${escapeHtml(String(approved || 0))}" title="${hasApproved ? "Includes approved supply requests — long-press for details" : ""}"><span class="ff-inv2-order-val">${escapeHtml(formatOrderDisplay(order))}</span></td>`;
}

function handleInvEditOutsideClick(ev) {
  if (!_editCellKey) return;
  const invScreen = document.getElementById("inventoryScreen");
  if (!invScreen || invScreen.style.display === "none") return;
  if (!invScreen.contains(ev.target)) {
    _editCellKey = null;
    mountOrRefreshMockUi();
    return;
  }
  const t = ev.target;
  if (t.closest("[data-inv-cell]")) return;
  if (t.closest("[data-inv-url-edit]")) return;
  if (t.closest("input.ff-inv2-cell-input")) return;
  /** Not the main inventory grid: remount on capture runs before checkbox change — breaks Order Details / receipt UI. */
  if (
    t.closest("#ff-inv-order-detail-backdrop") ||
    t.closest("#ff-inv-receipt-info-backdrop") ||
    t.closest("#ff-inv-od-line-view-backdrop")
  )
    return;
  const inTbody = t.closest(".ff-inv2-table tbody");
  if (!inTbody) {
    _editCellKey = null;
    mountOrRefreshMockUi();
    return;
  }
  _editCellKey = null;
  mountOrRefreshMockUi();
}

function ensureInvEditDocListenerOnce() {
  if (document.documentElement.dataset.ffInvEditDoc === "1") return;
  document.documentElement.dataset.ffInvEditDoc = "1";
  document.addEventListener("click", handleInvEditOutsideClick, true);
}

function getInvColWidths() {
  if (!_invColWidths) {
    _invColWidths = {
      rowDnd: 28,
      hash: 52,
      code: 76,
      name: 192,
      groupSubById: {},
      url: 96,
      supplier: 96,
    };
  }
  if (_groups) {
    for (const g of _groups) {
      if (_invColWidths.groupSubById[g.id] == null) {
        _invColWidths.groupSubById[g.id] = 72;
      }
    }
    const ids = new Set(_groups.map((x) => x.id));
    for (const k of Object.keys(_invColWidths.groupSubById)) {
      if (!ids.has(k)) delete _invColWidths.groupSubById[k];
    }
  }
  if (_invColWidths.rowDnd == null) _invColWidths.rowDnd = 28;
  return _invColWidths;
}

function renderColgroup() {
  if (_groups === null) return "";
  const w = getInvColWidths();
  const rd = w.rowDnd ?? 28;
  const parts = [];
  parts.push(`<col style="width:${rd}px;min-width:${rd}px" />`);
  parts.push(`<col style="width:${w.hash}px;min-width:${w.hash}px" />`);
  parts.push(`<col style="width:${w.code}px;min-width:${w.code}px" />`);
  parts.push(`<col style="width:${w.name}px;min-width:${w.name}px" />`);
  for (const g of _groups) {
    const cw = w.groupSubById[g.id] ?? 72;
    for (let c = 0; c < 4; c++) {
      parts.push(`<col style="width:${cw}px;min-width:${cw}px" />`);
    }
  }
  parts.push(`<col style="width:${w.supplier}px;min-width:${w.supplier}px" />`);
  parts.push(`<col style="width:${w.url}px;min-width:${w.url}px" />`);
  return `<colgroup>${parts.join("")}</colgroup>`;
}

function syncInvColWidthsToDom() {
  const root = document.getElementById("inventoryScreen");
  if (!root) return;
  const table = root.querySelector(".ff-inv2-table");
  if (!table || _groups === null) return;
  const w = getInvColWidths();
  const cols = table.querySelectorAll("colgroup col");
  if (!cols.length) return;
  const rd = w.rowDnd ?? 28;
  table.style.setProperty("--inv-sticky-hash-left", `${rd}px`);
  table.style.setProperty("--inv-sticky-code-left", `${rd + w.hash}px`);
  table.style.setProperty("--inv-sticky-name-left", `${rd + w.hash + w.code}px`);
  let i = 0;
  cols[i].style.width = `${rd}px`;
  cols[i].style.minWidth = `${rd}px`;
  i++;
  cols[i].style.width = `${w.hash}px`;
  cols[i].style.minWidth = `${w.hash}px`;
  i++;
  cols[i].style.width = `${w.code}px`;
  cols[i].style.minWidth = `${w.code}px`;
  i++;
  cols[i].style.width = `${w.name}px`;
  cols[i].style.minWidth = `${w.name}px`;
  i++;
  for (const g of _groups) {
    const cw = w.groupSubById[g.id] ?? 72;
    for (let c = 0; c < 4; c++) {
      cols[i].style.width = `${cw}px`;
      cols[i].style.minWidth = `${cw}px`;
      i++;
    }
  }
  if (cols[i]) {
    cols[i].style.width = `${w.supplier}px`;
    cols[i].style.minWidth = `${w.supplier}px`;
    i++;
  }
  if (cols[i]) {
    cols[i].style.width = `${w.url}px`;
    cols[i].style.minWidth = `${w.url}px`;
  }
}

function thResizeHandle(kind, extraAttrs) {
  const ex = extraAttrs ? ` ${extraAttrs}` : "";
  return `<div class="col-resize-handle" data-inv-resize="${escapeHtml(kind)}"${ex} aria-hidden="true"></div>`;
}

function bindInvColumnResizeOnce() {
  if (document.documentElement.dataset.ffInvColResizeBound === "1") return;
  document.documentElement.dataset.ffInvColResizeBound = "1";
  let drag = null;

  function onMove(e) {
    if (!drag) return;
    e.preventDefault();
    const dx = e.clientX - drag.startX;
    const st = getInvColWidths();
    if (drag.kind === "hash") st.hash = Math.max(60, Math.round(drag.startWidth + dx));
    else if (drag.kind === "code") st.code = Math.max(60, Math.round(drag.startWidth + dx));
    else if (drag.kind === "name") st.name = Math.max(120, Math.round(drag.startWidth + dx));
    else if (drag.kind === "url") st.url = Math.max(60, Math.round(drag.startWidth + dx));
    else if (drag.kind === "supplier") st.supplier = Math.max(60, Math.round(drag.startWidth + dx));
    else if (drag.kind === "group" && drag.groupId) {
      st.groupSubById[drag.groupId] = Math.max(60, Math.round(drag.startWidth + dx));
    }
    syncInvColWidthsToDom();
  }

  function onUp() {
    const hadDrag = !!drag;
    if (drag) {
      drag = null;
      document.body.style.userSelect = "";
    }
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    if (hadDrag) {
      void persistColumnWidthsToFirestore().catch((e) => console.error("[Inventory] column widths save failed", e));
    }
  }

  document.addEventListener(
    "mousedown",
    (e) => {
      const h = e.target.closest("#inventoryScreen .ff-inv2-table .col-resize-handle");
      if (!h) return;
      e.preventDefault();
      e.stopPropagation();
      const kind = h.getAttribute("data-inv-resize");
      const st = getInvColWidths();
      const startX = e.clientX;
      let startWidth = 0;
      if (kind === "hash") startWidth = st.hash;
      else if (kind === "code") startWidth = st.code;
      else if (kind === "name") startWidth = st.name;
      else if (kind === "url") startWidth = st.url;
      else if (kind === "supplier") startWidth = st.supplier;
      else if (kind === "group") {
        const gid = h.getAttribute("data-group-id");
        startWidth = st.groupSubById[gid] ?? 72;
      } else return;
      drag = { kind, startX, startWidth, groupId: h.getAttribute("data-group-id") };
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    true
  );
}

function ensureGroupCellsForRows() {
  if (!_groups || !_rows) return;
  for (const row of _rows) {
    if (row.rowNo === undefined) row.rowNo = "";
    for (const g of _groups) {
      if (!row.byGroup[g.id]) {
        row.byGroup[g.id] = { stock: 0, current: 0, price: "" };
      }
    }
  }
}

function addInventoryRow() {
  if (!ensureTableReadyForEdits()) return;
  _manageCategoriesOpen = false;
  _catManageDraftTree = null;
  resetCatModalTransientState();
  _groupRemoveConfirmId = null;
  _groupRemoveModalGroupId = null;
  const row = {
    id: newRowId(),
    rowNo: "",
    code: "",
    name: "",
    url: "",
    supplier: "",
    byGroup: {},
  };
  for (const g of _groups) {
    row.byGroup[g.id] = { stock: 0, current: 0, price: "" };
  }
  _rows.push(row);
  void flushInventoryTableToFirestore().catch((e) => console.error("[Inventory] table save failed", e));
}

function duplicateInventoryRow(rowId) {
  if (!ensureTableReadyForEdits()) return;
  const idx = _rows.findIndex((r) => r.id === rowId);
  if (idx < 0) return;
  const src = _rows[idx];
  const byGroup = {};
  for (const g of _groups) {
    const c = src.byGroup[g.id] || { stock: 0, current: 0, price: "" };
    byGroup[g.id] = {
      stock: typeof c.stock === "number" ? c.stock : parseNum(c.stock),
      current: typeof c.current === "number" ? c.current : parseNum(c.current),
      price: String(c.price ?? ""),
    };
  }
  const row = {
    id: newRowId(),
    rowNo: "",
    code: String(src.code ?? ""),
    name: String(src.name ?? ""),
    url: String(src.url ?? ""),
    supplier: String(src.supplier ?? ""),
    byGroup,
  };
  _rows.splice(idx + 1, 0, row);
  void flushInventoryTableToFirestore().catch((e) => console.error("[Inventory] table save failed", e));
}

function deleteInventoryRow(rowId) {
  void (async () => {
    if (!_rows) return;
    const idx = _rows.findIndex((r) => r.id === rowId);
    if (idx < 0) return;
    try {
      await commitPendingInventoryDeleteIfAny();
    } catch (e) {
      console.error("[Inventory] commit pending delete failed", e);
      return;
    }
    const rowClone = cloneInvRowForUndo(_rows[idx]);
    _rows = _rows.filter((r) => r.id !== rowId);
    startInventoryUndo({ kind: "row", row: rowClone, index: idx });
    mountOrRefreshMockUi();
  })();
}

/** Reorder _rows only; does not touch rowNo. */
function reorderInventoryRowsInPlace(dragRowId, targetRowId, placeBefore) {
  if (dragRowId === targetRowId || !_rows) return;
  const fi = _rows.findIndex((r) => r.id === dragRowId);
  const ti = _rows.findIndex((r) => r.id === targetRowId);
  if (fi < 0 || ti < 0) return;
  const [item] = _rows.splice(fi, 1);
  let insertIdx = ti;
  if (fi < ti) insertIdx--;
  if (!placeBefore) insertIdx++;
  _rows.splice(insertIdx, 0, item);
}

function bindInvRowDnDOnce(root) {
  if (root.dataset.ffInvRowDnd === "1") return;
  root.dataset.ffInvRowDnd = "1";
  let overTr = null;

  function clearOver() {
    if (overTr && overTr.isConnected) overTr.classList.remove("ff-inv2-row-dnd-over");
    overTr = null;
  }

  root.addEventListener("dragstart", (ev) => {
    const h = ev.target && ev.target.closest && ev.target.closest("[data-inv-row-dnd]");
    if (!h || !root.contains(h)) return;
    if (!ensureTableReadyForEdits()) return;
    const rowId = h.getAttribute("data-row-id");
    if (!rowId) return;
    _invRowDndDragId = rowId;
    try {
      ev.dataTransfer.setData("text/plain", `row:${rowId}`);
      ev.dataTransfer.effectAllowed = "move";
    } catch (e) {}
    const tr = h.closest("tr[data-inv-row-id]");
    if (tr) tr.classList.add("ff-inv2-row-dnd-dragging");
  });

  root.addEventListener("dragend", () => {
    _invRowDndDragId = null;
    clearOver();
    root.querySelectorAll(".ff-inv2-row-dnd-dragging").forEach((el) => el.classList.remove("ff-inv2-row-dnd-dragging"));
  });

  root.addEventListener("dragover", (ev) => {
    if (!_invRowDndDragId) return;
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const tr = t.closest("tbody tr[data-inv-row-id]");
    if (!tr || !root.contains(tr)) return;
    const tid = tr.getAttribute("data-inv-row-id");
    if (!tid || tid === _invRowDndDragId) return;
    ev.preventDefault();
    try {
      ev.dataTransfer.dropEffect = "move";
    } catch (e) {}
    if (overTr !== tr) {
      clearOver();
      overTr = tr;
      overTr.classList.add("ff-inv2-row-dnd-over");
    }
  });

  root.addEventListener("drop", (ev) => {
    if (!_invRowDndDragId || !_rows) return;
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const tr = t.closest("tbody tr[data-inv-row-id]");
    if (!tr || !root.contains(tr)) return;
    const tid = tr.getAttribute("data-inv-row-id");
    if (!tid || tid === _invRowDndDragId) {
      clearOver();
      ev.preventDefault();
      return;
    }
    ev.preventDefault();
    clearOver();
    const rect = tr.getBoundingClientRect();
    const placeBefore = ev.clientY < rect.top + rect.height / 2;
    reorderInventoryRowsInPlace(_invRowDndDragId, tid, placeBefore);
    _invRowDndDragId = null;
    root.querySelectorAll(".ff-inv2-row-dnd-dragging").forEach((el) => el.classList.remove("ff-inv2-row-dnd-dragging"));
    void flushInventoryTableToFirestore().catch((e) => console.error("[Inventory] table save after reorder failed", e));
    mountOrRefreshMockUi();
  });
}

function addInventoryGroup() {
  if (!ensureTableReadyForEdits()) return;
  _manageCategoriesOpen = false;
  _catManageDraftTree = null;
  resetCatModalTransientState();
  _groupRemoveConfirmId = null;
  _groupRemoveModalGroupId = null;
  const gid = newGroupId();
  _groups.push({ id: gid, label: "New group" });
  for (const row of _rows) {
    row.byGroup[gid] = { stock: 0, current: 0, price: "" };
  }
  void flushInventoryTableToFirestore().catch((e) => console.error("[Inventory] table save failed", e));
}

function removeInventoryGroup(groupId) {
  void (async () => {
    if (!ensureTableReadyForEdits() || !groupId) return;
    const gi = _groups.findIndex((g) => g.id === groupId);
    if (gi < 0) return;
    try {
      await commitPendingInventoryDeleteIfAny();
    } catch (e) {
      console.error("[Inventory] commit pending delete failed", e);
      return;
    }
    const group = { id: _groups[gi].id, label: _groups[gi].label };
    const perRowCells = {};
    for (const row of _rows) {
      const c = row.byGroup[groupId];
      if (c) {
        perRowCells[row.id] = {
          stock: typeof c.stock === "number" ? c.stock : parseNum(c.stock),
          current: typeof c.current === "number" ? c.current : parseNum(c.current),
          price: String(c.price ?? ""),
        };
      }
    }
    const w = getInvColWidths();
    const groupColWidth = w.groupSubById[groupId] != null ? w.groupSubById[groupId] : null;

    _groups = _groups.filter((g) => g.id !== groupId);
    for (const row of _rows) {
      try {
        delete row.byGroup[groupId];
      } catch (e) {}
    }
    if (_groupRemoveConfirmId === groupId) _groupRemoveConfirmId = null;
    if (_groupRemoveModalGroupId === groupId) _groupRemoveModalGroupId = null;
    startInventoryUndo({ kind: "group", group, groupIndex: gi, perRowCells, groupColWidth });
    mountOrRefreshMockUi();
  })();
}

/** True if any row has non-zero stock/current or non-empty price in this group. */
function groupHasAnyValues(groupId) {
  if (!_rows) return false;
  for (const row of _rows) {
    const c = row.byGroup[groupId];
    if (!c) continue;
    if (parseNum(c.stock) !== 0 || parseNum(c.current) !== 0) return true;
    if (String(c.price ?? "").trim() !== "") return true;
  }
  return false;
}

function updateOrderCellEl(rowId, groupId) {
  const row = _rows?.find((r) => r.id === rowId);
  if (!row) return;
  const gcell = row.byGroup[groupId];
  if (!gcell) return;
  const root = document.getElementById("inventoryScreen");
  if (!root) return;
  const { approved } = getCellApprovedInfo(gcell);
  const order = computeOrder(gcell.stock, gcell.current, approved);
  const cells = root.querySelectorAll("td[data-order-for-row]");
  for (let i = 0; i < cells.length; i++) {
    const el = cells[i];
    if (el.getAttribute("data-order-for-row") === rowId && el.getAttribute("data-order-for-group") === groupId) {
      const span = el.querySelector(".ff-inv2-order-val");
      if (span) span.textContent = formatOrderDisplay(order);
      el.classList.toggle("ff-inv2-order-cell--positive", order > 0);
      el.classList.toggle("ff-inv2-order-cell--has-approved", approved > 0);
      el.setAttribute("data-order-approved", String(approved || 0));
      return;
    }
  }
}

function handleInventoryInput(ev) {
  const t = ev.target;
  if (!(t instanceof HTMLInputElement)) return;
  if (t.hasAttribute("data-inv-order-save-name-input")) {
    _invOrderSaveNameDraft = t.value;
    scheduleInventoryOrderDraftSave();
    return;
  }
  // Inline qty editing for a manual Order-list line.
  if (t.hasAttribute("data-inv-ob-manual-qty")) {
    const lid = t.getAttribute("data-inv-ob-manual-qty");
    if (lid) {
      const idx = _invOrderBuilderManualLines.findIndex((L) => L && L.id === lid);
      if (idx >= 0) {
        const n = Number(t.value);
        _invOrderBuilderManualLines[idx].orderQty = Number.isFinite(n) && n > 0 ? n : 0;
        scheduleInventoryOrderDraftSave();
      }
    }
    return;
  }
  if (t.hasAttribute("data-inv-ob-add-input")) {
    if (!_invOrderBuilderAddModal) return;
    const field = t.getAttribute("data-inv-ob-add-input");
    if (field === "name") {
      _invOrderBuilderAddModal.draftName = t.value;
      const root = document.getElementById("inventoryScreen");
      const addBtn = root && root.querySelector("[data-inv-ob-add-commit]");
      if (addBtn instanceof HTMLButtonElement) {
        const can =
          String(_invOrderBuilderAddModal.draftName).trim() !== "" &&
          parseNum(_invOrderBuilderAddModal.draftQty) > 0;
        addBtn.disabled = !can;
      }
    } else if (field === "qty") {
      _invOrderBuilderAddModal.draftQty = t.value;
      const root = document.getElementById("inventoryScreen");
      const addBtn = root && root.querySelector("[data-inv-ob-add-commit]");
      if (addBtn instanceof HTMLButtonElement) {
        const can =
          String(_invOrderBuilderAddModal.draftName).trim() !== "" &&
          parseNum(_invOrderBuilderAddModal.draftQty) > 0;
        addBtn.disabled = !can;
      }
    }
    return;
  }
  if (t.hasAttribute("data-inv-orders-rename-input")) {
    if (_invOrdersRenameModal) _invOrdersRenameModal.draftName = t.value;
    return;
  }
  if (t.hasAttribute("data-inv-orders-search-input")) {
    const selStart = t.selectionStart;
    const selEnd = t.selectionEnd;
    _invOrdersSearchQuery = t.value;
    mountOrRefreshMockUi();
    const root = document.getElementById("inventoryScreen");
    const inp = root && root.querySelector("[data-inv-orders-search-input]");
    if (inp instanceof HTMLInputElement) {
      inp.focus();
      try {
        if (typeof selStart === "number" && typeof selEnd === "number") {
          inp.setSelectionRange(selStart, selEnd);
        }
      } catch (e) {
        /* ignore */
      }
    }
    return;
  }
  if (t.hasAttribute("data-inv-insights-from")) {
    _invInsightsCustomFrom = t.value;
    if (_invInsightsRange === "custom") void refreshInventoryInsightsAsync();
    return;
  }
  if (t.hasAttribute("data-inv-insights-to")) {
    _invInsightsCustomTo = t.value;
    if (_invInsightsRange === "custom") void refreshInventoryInsightsAsync();
    return;
  }
  if (t.hasAttribute("data-inv-insights-range-select")) {
    const v = t.value;
    const allowed = ["30d", "60d", "120d", "year", "all", "custom"];
    if (allowed.includes(v) && _invInsightsRange !== v) {
      _invInsightsRange = v;
      if (v !== "custom") {
        void refreshInventoryInsightsAsync();
      } else {
        mountOrRefreshMockUi();
      }
    }
    return;
  }
  if (t.hasAttribute("data-inv-shopping-qty-bought")) {
    const oid = t.getAttribute("data-order-id");
    const idxStr = t.getAttribute("data-line-idx");
    if (oid != null && idxStr != null) {
      const idx = Number(idxStr);
      if (!_invOrderShoppingDraft[oid]) _invOrderShoppingDraft[oid] = { checked: [], qtyBought: [] };
      if (!_invOrderShoppingDraft[oid].qtyBought) _invOrderShoppingDraft[oid].qtyBought = [];
      if (!_invOrderShoppingDraft[oid].checked) _invOrderShoppingDraft[oid].checked = [];
      _invOrderShoppingDraft[oid].qtyBought[idx] = t.value;
      // Checkbox is derived from B vs N: check only when B >= N (qty fully met).
      const order = _invOrdersList.find((x) => x.id === oid);
      const items = order && Array.isArray(order.items) ? order.items : [];
      const it = items[idx];
      const N = it ? getItemOrderQty(it) : 0;
      const B = parseNum(t.value);
      const derivedChecked = B > 0 && (N <= 0 || B >= N);
      _invOrderShoppingDraft[oid].checked[idx] = derivedChecked;
      const root = document.getElementById("inventoryScreen");
      if (root) {
        const cb = root.querySelector(
          `input[data-inv-shopping-check][data-order-id="${CSS.escape(oid)}"][data-line-idx="${CSS.escape(idxStr)}"]`
        );
        if (cb instanceof HTMLInputElement && cb.checked !== derivedChecked) {
          cb.checked = derivedChecked;
        }
      }
    }
    return;
  }
  const inv = t.getAttribute("data-inv");
  if (!inv) return;
  if (!ensureTableReadyForEdits()) return;

  if (inv === "group-label") {
    const gid = t.getAttribute("data-group-id");
    const g = _groups.find((x) => x.id === gid);
    if (g) g.label = t.value;
    scheduleInventoryTablePersist();
    return;
  }

  const rowId = t.getAttribute("data-row-id");
  const row = _rows.find((r) => r.id === rowId);
  if (!row) return;

  if (inv === "rowNo") {
    row.rowNo = t.value;
    scheduleInventoryTablePersist();
    return;
  }
  if (inv === "code") {
    row.code = t.value;
    scheduleInventoryTablePersist();
    return;
  }
  if (inv === "name") {
    row.name = t.value;
    scheduleInventoryTablePersist();
    return;
  }
  if (inv === "url") {
    row.url = t.value;
    scheduleInventoryTablePersist();
    return;
  }
  if (inv === "supplier") {
    row.supplier = t.value;
    scheduleInventoryTablePersist();
    return;
  }

  const gid = t.getAttribute("data-group-id");
  if (!gid) return;
  const gcell = row.byGroup[gid];
  if (!gcell) return;

  if (inv === "stock") {
    gcell.stock = parseNum(t.value);
    updateOrderCellEl(rowId, gid);
    scheduleInventoryTablePersist();
    return;
  }
  if (inv === "current") {
    gcell.current = parseNum(t.value);
    updateOrderCellEl(rowId, gid);
    scheduleInventoryTablePersist();
    return;
  }
  if (inv === "price") {
    gcell.price = t.value;
    scheduleInventoryTablePersist();
  }
}

function injectMockStylesOnce() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `
#inventoryScreen.ff-inv2-screen {
  font-family: 'Avenir Next', 'Open Sans', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: #0f172a;
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
}
#inventoryScreen .ff-inv2-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
#inventoryScreen .ff-inv2-aside {
  width: 280px;
  min-width: 280px;
  max-width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #e2e8f0;
  background: #fff;
  box-shadow: 2px 0 12px rgba(15, 23, 42, 0.04);
}
#inventoryScreen .ff-inv2-aside-head {
  padding: 18px 16px 12px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #64748b;
  border-bottom: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-aside-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px 16px;
}
#inventoryScreen .ff-inv2-aside-loading,
#inventoryScreen .ff-inv2-aside-error {
  margin: 12px 8px;
  font-size: 13px;
  line-height: 1.4;
  color: #64748b;
}
#inventoryScreen .ff-inv2-aside-error {
  color: #b45309;
}
#inventoryScreen .ff-inv2-cat-manage-save:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}
#inventoryScreen .ff-inv2-table-loading-row td {
  padding: 20px 16px;
  text-align: center;
  color: #64748b;
  font-size: 13px;
}
#inventoryScreen .ff-inv2-cat {
  margin-top: 4px;
}
#inventoryScreen .ff-inv2-cat-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 8px;
  border-radius: 8px;
  cursor: pointer;
  user-select: none;
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
}
#inventoryScreen .ff-inv2-cat-row:hover {
  background: #f8fafc;
}
#inventoryScreen .ff-inv2-chevron {
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  transition: transform 0.18s ease;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-cat.is-open .ff-inv2-chevron {
  transform: rotate(90deg);
}
#inventoryScreen .ff-inv2-sub-list {
  padding: 2px 0 6px 8px;
}
#inventoryScreen .ff-inv2-sub {
  padding: 7px 10px 7px 22px;
  margin: 2px 0;
  border-radius: 8px;
  font-size: 13px;
  color: #475569;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: background 0.15s ease, border-color 0.15s ease;
}
#inventoryScreen .ff-inv2-sub:hover {
  background: #f8fafc;
}
#inventoryScreen .ff-inv2-sub.is-active {
  background: #f5f3ff;
  color: #5b21b6;
  font-weight: 600;
  border-left-color: #7c3aed;
}
#inventoryScreen .ff-inv2-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 20px 24px 24px;
  gap: 12px;
  overflow: hidden;
}
#inventoryScreen .ff-inv2-main-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-main-tabs {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 12px;
  flex-shrink: 0;
  border-bottom: 1px solid #e5e7eb;
  background: transparent;
  padding: 2px 0 0;
  margin: 0 0 8px;
}
#inventoryScreen .ff-inv2-main-tab {
  padding: 8px 14px;
  margin: 0 0 -1px;
  border: none;
  border-bottom: 2px solid transparent;
  background: none;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  box-shadow: none;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 0;
  transition: color 0.15s ease, border-color 0.15s ease;
}
#inventoryScreen .ff-inv2-main-tab:hover {
  color: #5b21b6;
  background: transparent;
}
#inventoryScreen .ff-inv2-main-tab--active {
  color: #7c3aed;
  border-bottom-color: #7c3aed;
  font-weight: 500;
  z-index: 1;
  background: transparent;
  box-shadow: none;
}
#inventoryScreen .ff-inv2-main-tab:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: -2px;
}
#inventoryScreen .ff-inv2-main-tab-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
#inventoryScreen .ff-inv2-order-builder-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
#inventoryScreen .ff-inv2-order-builder-wrap .ff-inv2-order-list-card {
  flex: 1;
  min-height: 0;
  max-height: none;
}
#inventoryScreen .ff-inv2-orders-placeholder-card {
  flex: 1;
  min-height: 120px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 8px;
  padding: 28px 24px;
  border-radius: 12px;
  border: 1px dashed #c4b5fd;
  background: linear-gradient(180deg, #faf5ff 0%, #fff 100%);
}
#inventoryScreen .ff-inv2-orders-placeholder-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #5b21b6;
}
#inventoryScreen .ff-inv2-orders-placeholder-hint {
  margin: 0;
  font-size: 14px;
  color: #64748b;
  line-height: 1.45;
  max-width: 420px;
}
#inventoryScreen .ff-inv2-main-tab-body--orders {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
#inventoryScreen .ff-inv2-orders-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  overflow: hidden;
}
#inventoryScreen .ff-inv2-orders-head {
  padding: 14px 18px;
  border-bottom: 1px solid #f1f5f9;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-orders-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-orders-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 10px 14px;
  margin: 0 0 10px;
  padding: 0 18px;
  box-sizing: border-box;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-orders-search-wrap {
  position: relative;
  flex: 1 1 200px;
  min-width: 160px;
  max-width: 360px;
}
#inventoryScreen .ff-inv2-orders-search-input {
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 6px 10px;
  font-size: 13px;
  line-height: 1.35;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-orders-search-wrap--has-clear .ff-inv2-orders-search-input {
  padding-right: 30px;
}
#inventoryScreen .ff-inv2-orders-search-input::placeholder {
  color: #94a3b8;
}
#inventoryScreen .ff-inv2-orders-search-input:focus {
  outline: 2px solid #c4b5fd;
  outline-offset: 1px;
  border-color: #a78bfa;
}
#inventoryScreen .ff-inv2-orders-search-clear {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 26px;
  height: 26px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
#inventoryScreen .ff-inv2-orders-search-clear:hover {
  background: #f1f5f9;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-orders-status-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-orders-loading,
#inventoryScreen .ff-inv2-orders-error,
#inventoryScreen .ff-inv2-orders-empty,
#inventoryScreen .ff-inv2-orders-filter-empty {
  margin: 0;
  padding: 20px 18px;
  font-size: 14px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-orders-error {
  color: #b45309;
}
#inventoryScreen .ff-inv2-orders-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}
#inventoryScreen .ff-inv2-orders-table {
  width: 100%;
  min-width: 640px;
  border-collapse: collapse;
  font-size: 13px;
}
#inventoryScreen .ff-inv2-orders-td--name {
  font-weight: 600;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-orders-td--src {
  font-size: 12px;
  max-width: 200px;
}
#inventoryScreen .ff-inv2-orders-th {
  position: sticky;
  top: 0;
  z-index: 1;
  text-align: left;
  padding: 10px 14px;
  font-weight: 600;
  color: #475569;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-orders-th--num {
  text-align: right;
}
#inventoryScreen .ff-inv2-orders-td {
  padding: 10px 14px;
  border-bottom: 1px solid #f1f5f9;
  color: #0f172a;
  vertical-align: top;
}
#inventoryScreen .ff-inv2-orders-td--muted {
  color: #64748b;
  font-size: 12px;
}
#inventoryScreen .ff-inv2-orders-td--num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
#inventoryScreen .ff-inv2-orders-tr {
  cursor: pointer;
  transition: background 0.12s ease;
}
#inventoryScreen .ff-inv2-orders-tr:hover td {
  background: #fafafa;
}
#inventoryScreen .ff-inv2-orders-tr:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: -2px;
}
#inventoryScreen .ff-inv2-orders-th--narrow {
  width: 44px;
  padding-left: 8px;
  padding-right: 8px;
}
#inventoryScreen .ff-inv2-orders-td--actions {
  text-align: right;
  vertical-align: middle;
  padding: 6px 10px;
}
#inventoryScreen .ff-inv2-orders-kebab {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #64748b;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}
#inventoryScreen .ff-inv2-orders-kebab:hover {
  background: #f8fafc;
  border-color: #c4b5fd;
  color: #5b21b6;
}
#inventoryScreen .ff-inv2-order-detail-card {
  max-width: min(960px, 96vw);
  width: 100%;
  max-height: min(92vh, 920px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
#inventoryScreen .ff-inv2-order-detail-hero {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px 12px;
  margin: 0 0 4px;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-order-detail-hero-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  min-width: 0;
}
#inventoryScreen .ff-inv2-order-detail-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.2;
}
#inventoryScreen .ff-inv2-order-detail-status-pill {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  background: #f1f5f9;
  color: #475569;
  text-transform: lowercase;
}
#inventoryScreen .ff-inv2-order-detail-extras {
  margin: 0 0 10px;
  font-size: 12px;
  color: #64748b;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-order-detail-extras--minimal {
  margin: 0 0 4px;
  font-size: 10px;
}
#inventoryScreen .ff-inv2-order-detail-extras--minimal .ff-inv2-order-detail-extras-summary {
  font-size: 10px;
  font-weight: 600;
}
#inventoryScreen .ff-inv2-order-detail-extras--minimal .ff-inv2-order-detail-extras-body {
  margin-top: 4px;
  padding-top: 4px;
}
#inventoryScreen .ff-inv2-order-detail-receive-hint--compact {
  margin: 4px 0 0;
  font-size: 10px;
  line-height: 1.35;
  color: #64748b;
}
#inventoryScreen .ff-inv2-order-detail-extras-summary {
  cursor: pointer;
  font-weight: 600;
  color: #64748b;
  list-style: none;
}
#inventoryScreen .ff-inv2-order-detail-extras-summary::-webkit-details-marker {
  display: none;
}
#inventoryScreen .ff-inv2-order-detail-extras-body {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-order-detail-meta--compact {
  font-size: 12px;
  gap: 4px;
}
#inventoryScreen .ff-inv2-order-detail-totals-line {
  margin: 6px 0 0;
  font-size: 11px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-order-detail-totals-line--sub {
  font-size: 10px;
  opacity: 0.95;
}
#inventoryScreen .ff-inv2-order-detail-line-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin: 0 0 4px;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-order-detail-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin: 0 0 6px;
}
#inventoryScreen .ff-inv2-order-detail-list-scroll {
  flex: 1;
  min-height: 140px;
  max-height: min(72vh, 760px);
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  padding-bottom: 10px;
  box-sizing: border-box;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist {
  width: 100%;
  min-width: 0;
  table-layout: fixed;
  color-scheme: light;
}
#inventoryScreen .ff-inv2-order-detail-items.ff-inv2-order-detail-items--checklist {
  min-width: 0;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-th,
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-td {
  padding: 1px 2px;
  font-size: 10px;
  line-height: 1.1;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-td {
  min-width: 0;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-th {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #64748b;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-th--item {
  text-transform: none;
  letter-spacing: 0.01em;
  font-size: 10px;
  font-weight: 700;
  color: #475569;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-th--letter {
  text-transform: none;
  letter-spacing: 0.02em;
  font-size: 11px;
  font-weight: 800;
  color: #475569;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-th--narrow {
  width: 24px;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-th:nth-child(2) {
  width: 46%;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-th--code,
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-th:nth-child(3) {
  width: 10%;
  text-align: center;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-th:nth-child(4) {
  width: 11%;
  text-align: center;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-th:nth-child(5) {
  width: 11%;
  text-align: center;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-th:nth-child(5),
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-td--qty-bought {
  border-left: 1px solid #e8ecf1;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-item-stack {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-td--item {
  min-width: 0;
  padding-right: 2px;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-td--code {
  min-width: 0;
  padding-left: 0;
  padding-right: 2px;
  text-align: center;
  vertical-align: middle;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-item-name {
  display: block;
  font-weight: 500;
  font-size: 11px;
  color: #0f172a;
  line-height: 1.15;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-item-group {
  display: block;
  font-size: 9px;
  font-weight: 500;
  color: #94a3b8;
  line-height: 1.15;
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-item-code {
  display: block;
  font-size: 9px;
  font-weight: 500;
  color: #64748b;
  word-break: break-word;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-item-code--empty {
  color: #94a3b8;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-qty-value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-td--qty {
  vertical-align: middle;
  padding-top: 2px;
  padding-right: 2px;
  padding-left: 2px;
  text-align: center;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-qty-need-value {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 18px;
  min-width: 2.5ch;
  font-weight: 600;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: #334155;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-td--qty-bought {
  vertical-align: middle;
  min-width: 0;
  padding-left: 2px;
  padding-right: 2px;
  padding-top: 2px;
  text-align: center;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-td--check {
  vertical-align: middle;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-shopping-check-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  width: 16px;
  height: 16px;
  margin: 0 auto;
  cursor: pointer;
  vertical-align: middle;
  flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist input.ff-inv2-od-shopping-check {
  position: absolute;
  /* iOS Safari often ignores taps on fully transparent controls */
  opacity: 0.02;
  width: 100%;
  height: 100%;
  margin: 0;
  inset: 0;
  cursor: pointer;
  z-index: 2;
  -webkit-appearance: none;
  appearance: none;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-shopping-check-fake {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 14px;
  height: 14px;
  box-sizing: border-box;
  border: 1.5px solid #64748b;
  border-radius: 2px;
  background: #fff;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 800;
  color: #7c3aed;
  line-height: 1;
  z-index: 0;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-shopping-check:checked + .ff-inv2-od-shopping-check-fake::after {
  content: "✓";
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-shopping-check:focus-visible + .ff-inv2-od-shopping-check-fake {
  outline: 2px solid #a78bfa;
  outline-offset: 2px;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-shopping-check:disabled {
  cursor: not-allowed;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-shopping-check:disabled + .ff-inv2-od-shopping-check-fake {
  opacity: 0.5;
  border-color: #cbd5e1;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-qty-bought-input-row {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 18px;
  width: 100%;
  min-width: 0;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-qty-bought {
  width: 100%;
  max-width: 5.5rem;
  min-width: 3rem;
  min-height: 22px;
  margin: 0 auto;
  display: block;
  box-sizing: border-box;
  padding: 2px 4px;
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: center;
  color: #334155;
  border: 1px solid transparent;
  border-radius: 4px;
  background: #f8fafc;
  box-shadow: none;
  -moz-appearance: textfield;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-qty-bought::-webkit-outer-spin-button,
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-qty-bought::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-qty-bought:focus {
  outline: none;
  background: #fff;
  border-color: #c4b5fd;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-qty-bought::placeholder {
  color: #cbd5e1;
  font-weight: 400;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-qty-bought-wrap {
  display: block;
  min-width: 0;
  width: 100%;
  max-width: 5.5rem;
  margin: 0 auto;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist tbody tr[data-inv-detail-shopping-row] td {
  overflow: visible;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist tbody tr[data-inv-detail-shopping-row] {
  cursor: pointer;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist tbody tr[data-inv-detail-shopping-row]:hover td {
  background: rgba(248, 250, 252, 0.95);
}
#inventoryScreen .ff-inv2-order-detail-items--checklist tbody tr:has(.ff-inv2-od-shopping-check:checked) td {
  background: rgba(243, 232, 255, 0.55);
}
#inventoryScreen .ff-inv2-order-detail-items--checklist tbody tr:has(.ff-inv2-od-shopping-check:checked):hover td {
  background: rgba(237, 233, 254, 0.75);
}
#inventoryScreen .ff-inv2-order-save-name-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin: 0 0 12px;
}
#inventoryScreen .ff-inv2-order-save-name-label {
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
}
#inventoryScreen .ff-inv2-order-save-name-input {
  flex: 1;
  min-width: 160px;
  max-width: 360px;
  padding: 6px 10px;
  font-size: 13px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}
#inventoryScreen .ff-inv2-order-save-name-input:focus {
  outline: 2px solid #c4b5fd;
  outline-offset: 1px;
  border-color: #a78bfa;
}
#inventoryScreen .ff-inv2-order-detail-head-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 14px;
  margin: 0 0 10px;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-order-detail-head-row .ff-inv2-modal-title {
  margin: 0;
}
#inventoryScreen .ff-inv2-order-detail-head-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
#inventoryScreen .ff-inv2-od-detail-action {
  margin: 0;
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  border: 1px solid #ddd6fe;
  background: #faf5ff;
  color: #5b21b6;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
}
#inventoryScreen .ff-inv2-od-detail-action:hover:not(:disabled) {
  background: #f3e8ff;
  border-color: #c4b5fd;
}
#inventoryScreen .ff-inv2-od-detail-action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
#inventoryScreen .ff-inv2-order-detail-meta {
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}
#inventoryScreen .ff-inv2-order-detail-meta-row {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 8px;
  align-items: baseline;
}
#inventoryScreen .ff-inv2-order-detail-meta-row dt {
  margin: 0;
  font-weight: 600;
  color: #64748b;
}
#inventoryScreen .ff-inv2-order-detail-meta-row dd {
  margin: 0;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-order-detail-items-scroll {
  flex: 1;
  min-height: 120px;
  overflow: auto;
  margin: 0 -4px 12px;
  padding: 0 4px;
  -webkit-overflow-scrolling: touch;
}
#inventoryScreen .ff-inv2-order-detail-items {
  width: 100%;
  min-width: 1240px;
  border-collapse: collapse;
  font-size: 12px;
  background: #fff;
}
#inventoryScreen .ff-inv2-od-tr--recv-full > td {
  background: rgba(236, 253, 245, 0.55);
}
#inventoryScreen .ff-inv2-od-tr--recv-partial > td {
  background: rgba(250, 245, 255, 0.65);
}
#inventoryScreen .ff-inv2-od-th--status {
  width: 76px;
}
#inventoryScreen .ff-inv2-od-td--status {
  vertical-align: middle;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-od-line-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.2;
  padding: 3px 7px;
  border-radius: 999px;
  border: 1px solid transparent;
}
#inventoryScreen .ff-inv2-od-line-badge--full {
  color: #166534;
  background: rgba(220, 252, 231, 0.95);
  border-color: rgba(34, 197, 94, 0.28);
}
#inventoryScreen .ff-inv2-od-line-badge--partial {
  color: #6b21a8;
  background: rgba(243, 232, 255, 0.95);
  border-color: rgba(167, 139, 250, 0.32);
}
#inventoryScreen .ff-inv2-od-line-badge--open {
  color: #64748b;
  background: rgba(241, 245, 249, 0.92);
  border-color: rgba(148, 163, 184, 0.35);
}
#inventoryScreen .ff-inv2-od-th--narrow {
  width: 36px;
}
#inventoryScreen .ff-inv2-od-th--center {
  text-align: center;
}
#inventoryScreen .ff-inv2-od-td--center {
  text-align: center;
  vertical-align: middle;
}
#inventoryScreen .ff-inv2-od-recv-check {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: #7c3aed;
}
#inventoryScreen .ff-inv2-od-recv-qty {
  width: 72px;
  max-width: 100%;
  box-sizing: border-box;
  padding: 4px 6px;
  font-size: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  text-align: right;
}
#inventoryScreen .ff-inv2-od-recv-qty:focus {
  outline: 2px solid #c4b5fd;
  outline-offset: 1px;
  border-color: #a78bfa;
}
#inventoryScreen .ff-inv2-order-detail-receive-hint {
  margin: 0 0 6px;
  font-size: 11px;
  color: #64748b;
  line-height: 1.35;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-order-detail-view-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0 0 8px;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-order-detail-items--receiving {
  min-width: 420px;
}
#inventoryScreen .ff-inv2-order-detail-items-scroll--receiving {
  max-width: 100%;
}
#inventoryScreen .ff-inv2-order-detail-totals {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0 0 12px;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-od-summary-chip--cost {
  border-color: #ddd6fe;
  background: #faf5ff;
}
#inventoryScreen .ff-inv2-order-detail-receive-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0 0 8px;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-od-summary-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #64748b;
  line-height: 1.2;
}
#inventoryScreen .ff-inv2-od-summary-chip strong {
  font-weight: 700;
  color: #5b21b6;
}
#inventoryScreen .ff-inv2-od-summary-chip--remaining {
  border-color: #ddd6fe;
  background: #faf5ff;
}
#inventoryScreen .ff-inv2-order-detail-lines-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 18px;
  margin: 0 0 8px;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-order-detail-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-order-detail-sort {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-order-detail-filter-label {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  letter-spacing: 0.02em;
  margin-right: 2px;
}
#inventoryScreen .ff-inv2-od-filter-chip {
  margin: 0;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #64748b;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
#inventoryScreen .ff-inv2-od-filter-chip:hover:not(:disabled) {
  background: #faf5ff;
  border-color: #ddd6fe;
  color: #5b21b6;
}
#inventoryScreen .ff-inv2-od-filter-chip:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
#inventoryScreen .ff-inv2-od-filter--active {
  background: #7c3aed;
  border-color: #7c3aed;
  color: #fff;
}
#inventoryScreen .ff-inv2-od-filter--active:hover:not(:disabled) {
  background: #6d28d9;
  border-color: #6d28d9;
  color: #fff;
}
#inventoryScreen .ff-inv2-order-detail-line-filter .ff-inv2-od-filter-chip {
  padding: 2px 8px;
  font-size: 10px;
}
#inventoryScreen .ff-inv2-od-line-view-card {
  max-width: min(400px, 92vw);
}
#inventoryScreen .ff-inv2-od-line-view-dl {
  margin: 0 0 8px;
  font-size: 12px;
}
#inventoryScreen .ff-inv2-od-line-view-row {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  align-items: flex-start;
  padding: 6px 0;
  border-bottom: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-od-line-view-row:last-child {
  border-bottom: none;
}
#inventoryScreen .ff-inv2-od-line-view-row dt {
  font-weight: 600;
  color: #64748b;
  flex-shrink: 0;
  font-size: 11px;
}
#inventoryScreen .ff-inv2-od-line-view-row dd {
  margin: 0;
  text-align: right;
  color: #0f172a;
  word-break: break-word;
  font-size: 12px;
}
#inventoryScreen .ff-inv2-od-th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px 8px;
  text-align: left;
  font-weight: 600;
  color: #475569;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-od-td {
  padding: 8px 8px;
  border-bottom: 1px solid #f1f5f9;
  color: #0f172a;
  vertical-align: top;
}
#inventoryScreen .ff-inv2-od-td--num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
#inventoryScreen .ff-inv2-od-url-wrap {
  max-width: 120px;
}
#inventoryScreen .ff-inv2-od-url {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-order-detail-no-items,
#inventoryScreen .ff-inv2-order-detail-missing {
  margin: 0 0 12px;
  font-size: 13px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-receive-modal-card .ff-inv2-modal-title {
  flex-shrink: 0;
  margin-bottom: 12px;
}
#inventoryScreen .ff-inv2-receive-items-scroll {
  flex: 0 1 auto;
  max-height: min(38vh, 320px);
  min-height: 0;
  overflow: auto;
  margin: 0 0 12px;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
  background: #fff;
  -webkit-overflow-scrolling: touch;
}
#inventoryScreen .ff-inv2-receive-items {
  width: 100%;
  min-width: 480px;
  border-collapse: collapse;
  font-size: 12px;
}
#inventoryScreen .ff-inv2-rcv-th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px 10px;
  text-align: left;
  font-weight: 600;
  color: #475569;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-rcv-th--num {
  text-align: right;
}
#inventoryScreen .ff-inv2-rcv-td {
  padding: 8px 10px;
  border-bottom: 1px solid #f1f5f9;
  color: #0f172a;
  vertical-align: middle;
}
#inventoryScreen .ff-inv2-rcv-td--num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
#inventoryScreen .ff-inv2-rcv-td--input {
  padding: 6px 8px;
}
#inventoryScreen .ff-inv2-rcv-input {
  width: 100%;
  max-width: 100px;
  box-sizing: border-box;
  padding: 5px 8px;
  font-size: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  text-align: right;
}
#inventoryScreen .ff-inv2-rcv-input:focus {
  outline: 2px solid #c4b5fd;
  outline-offset: 1px;
  border-color: #a78bfa;
}
#inventoryScreen .ff-inv2-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
#inventoryScreen .ff-inv2-btn--sm {
  padding: 6px 12px;
  font-size: 11px;
}
#inventoryScreen .ff-inv2-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  pointer-events: none;
}
#inventoryScreen .ff-inv2-order-detail-footer {
  justify-content: flex-start;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 10px;
  margin-top: 4px;
  flex-shrink: 0;
  border-top: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-order-detail-footer-spacer {
  flex: 1 1 auto;
  min-width: 8px;
}
#inventoryScreen .ff-inv2-order-detail-receipt-btn {
  font-weight: 600;
}
#inventoryScreen .ff-inv2-receipt-info-card {
  max-width: min(440px, 94vw);
  max-height: min(88vh, 720px);
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 8px;
}
#inventoryScreen .ff-inv2-receipt-info-upload-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
}
#inventoryScreen .ff-inv2-receipt-info-section-label {
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
}
#inventoryScreen .ff-inv2-receipt-info-uploaded {
  margin-bottom: 12px;
}
#inventoryScreen .ff-inv2-or-scroll--modal {
  max-height: min(220px, 36vh);
  overflow: auto;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #fff;
}
#inventoryScreen .ff-inv2-receipt-info-footer {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-receipt-info-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 4px;
}
#inventoryScreen .ff-inv2-receipt-info-head .ff-inv2-modal-title {
  margin: 0;
  flex: 1;
  min-width: 0;
}
#inventoryScreen .ff-inv2-receipt-info-hint {
  margin-bottom: 14px;
}
#inventoryScreen .ff-inv2-receipt-info-close {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  margin: -4px -6px 0 0;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #64748b;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
#inventoryScreen .ff-inv2-receipt-info-close:hover {
  background: #f1f5f9;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-receipt-info-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 6px;
}
#inventoryScreen .ff-inv2-receipt-info-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
}
#inventoryScreen .ff-inv2-receipt-info-label {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
#inventoryScreen .ff-inv2-receipt-info-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  font-size: 13px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}
#inventoryScreen .ff-inv2-receipt-info-input:focus {
  outline: 2px solid #c4b5fd;
  outline-offset: 1px;
  border-color: #a78bfa;
}
#inventoryScreen .ff-inv2-or-loading,
#inventoryScreen .ff-inv2-or-empty {
  margin: 0;
  font-size: 12px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-or-scroll {
  max-height: min(200px, 28vh);
  overflow: auto;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #fff;
}
#inventoryScreen .ff-inv2-or-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
#inventoryScreen .ff-inv2-or-th {
  position: sticky;
  top: 0;
  padding: 8px 10px;
  text-align: left;
  font-weight: 600;
  color: #475569;
  background: #f1f5f9;
  border-bottom: 1px solid #e2e8f0;
}
#inventoryScreen .ff-inv2-or-td {
  padding: 8px 10px;
  border-bottom: 1px solid #f1f5f9;
  color: #0f172a;
  vertical-align: top;
  word-break: break-word;
}
#inventoryScreen .ff-inv2-or-td--muted {
  color: #64748b;
  font-size: 11px;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-or-link {
  font-weight: 600;
  color: #5b21b6;
  text-decoration: none;
}
#inventoryScreen .ff-inv2-or-link:hover {
  text-decoration: underline;
}
#inventoryScreen .ff-inv2-or-th--icon {
  width: 32px;
  text-align: center;
  padding-left: 2px;
  padding-right: 2px;
}
#inventoryScreen .ff-inv2-or-td--icon {
  width: 32px;
  text-align: center;
  padding-left: 2px;
  padding-right: 2px;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-or-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  text-decoration: none;
}
#inventoryScreen .ff-inv2-or-icon-btn svg {
  pointer-events: none;
}
#inventoryScreen a.ff-inv2-or-icon-btn {
  color: #5b21b6;
}
#inventoryScreen a.ff-inv2-or-icon-btn:hover {
  background: #faf5ff;
  border-color: #ddd6fe;
}
#inventoryScreen button.ff-inv2-or-delete.ff-inv2-or-icon-btn {
  color: #b91c1c;
}
#inventoryScreen button.ff-inv2-or-delete.ff-inv2-or-icon-btn:hover {
  background: #fef2f2;
  border-color: #fecaca;
}
#inventoryScreen .ff-inv2-or-filetype {
  display: inline-block;
  margin-right: 4px;
  font-size: 14px;
  line-height: 1;
  vertical-align: -1px;
}
#inventoryScreen .ff-inv2-or-filename {
  word-break: break-word;
}
#inventoryScreen .ff-inv2-crumb {
  font-size: 13px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-crumb strong {
  color: #0f172a;
  font-weight: 600;
}
#inventoryScreen .ff-inv2-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid #e2e8f0;
  background: #fafafa;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  color: #5b21b6;
  background: #fff;
  border: 1px solid #ddd6fe;
  border-radius: 8px;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
}
#inventoryScreen .ff-inv2-btn:hover {
  background: #faf5ff;
  border-color: #c4b5fd;
}
#inventoryScreen .ff-inv2-btn--outline {
  background: #fff;
  border-color: #e2e8f0;
  color: #5b21b6;
  box-shadow: none;
}
#inventoryScreen .ff-inv2-btn--outline:hover {
  background: #faf5ff;
  border-color: #c4b5fd;
}
#inventoryScreen .ff-inv2-table-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  overflow: hidden;
}
#inventoryScreen .ff-inv2-table-scroll {
  flex: 1;
  min-height: 0;
  overflow-x: auto;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
#inventoryScreen .ff-inv2-order-list-card {
  flex: 0 1 auto;
  max-height: min(38vh, 300px);
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  overflow: hidden;
}
#inventoryScreen .ff-inv2-order-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #e2e8f0;
  background: #fafafa;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-draft-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: linear-gradient(180deg, #faf5ff 0%, #f5f3ff 100%);
  border-bottom: 1px solid #e9d5ff;
  font-size: 12px;
  color: #5b21b6;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-order-list-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}
/* Always-visible "Draft · Saved" chip next to the Order list title */
#inventoryScreen .ff-inv2-draft-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 10px;
  font-size: 11px;
  font-weight: 600;
  color: #5b21b6;
  background: #ede9fe;
  border: 1px solid #ddd6fe;
  border-radius: 999px;
  line-height: 1.4;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-draft-chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #7c3aed;
  display: inline-block;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-draft-chip-label {
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-size: 10px;
  font-weight: 700;
}
#inventoryScreen .ff-inv2-draft-chip-sep {
  color: #c4b5fd;
  opacity: 0.8;
}
#inventoryScreen .ff-inv2-draft-chip-status {
  color: #6d28d9;
  font-weight: 500;
}
#inventoryScreen .ff-inv2-draft-chip-status[data-state="saving"] {
  color: #9ca3af;
  font-style: italic;
}
#inventoryScreen .ff-inv2-draft-chip-status[data-state="saved"] {
  color: #047857;
}
#inventoryScreen .ff-inv2-draft-chip-status[data-state="saving"]::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  margin-right: 4px;
  animation: ff-inv2-draft-pulse 1s ease-in-out infinite;
}
@keyframes ff-inv2-draft-pulse {
  0%, 100% { opacity: 0.2; }
  50% { opacity: 1; }
}
/* "+ New" button next to the Draft chip — small, subtle, doesn't steal attention from Save as Order. */
#inventoryScreen .ff-inv2-draft-new-btn {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 600;
  color: #5b21b6;
  background: #fff;
  border: 1px solid #ddd6fe;
  border-radius: 999px;
  cursor: pointer;
  font-family: inherit;
  line-height: 1.4;
  transition: background 0.12s ease, border-color 0.12s ease;
}
#inventoryScreen .ff-inv2-draft-new-btn:hover:not(:disabled) {
  background: #f5f3ff;
  border-color: #c4b5fd;
}
#inventoryScreen .ff-inv2-draft-new-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
/* Draft chip becomes a clickable button — same visual, adds caret + hover affordance */
#inventoryScreen .ff-inv2-draft-chip--btn {
  cursor: pointer;
  font-family: inherit;
  user-select: none;
}
#inventoryScreen .ff-inv2-draft-chip--btn:hover {
  background: #ddd6fe;
  border-color: #c4b5fd;
}
#inventoryScreen .ff-inv2-draft-chip-caret {
  margin-left: 2px;
  font-size: 9px;
  opacity: 0.7;
}
/* Drafts picker modal */
#inventoryScreen .ff-inv2-drafts-picker-backdrop {
  z-index: 2147483645;
}
#inventoryScreen .ff-inv2-drafts-picker-card {
  max-width: 520px;
  width: 100%;
}
#inventoryScreen .ff-inv2-drafts-picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
#inventoryScreen .ff-inv2-drafts-picker-close {
  background: none;
  border: none;
  font-size: 22px;
  line-height: 1;
  color: #94a3b8;
  cursor: pointer;
  padding: 0 4px;
}
#inventoryScreen .ff-inv2-drafts-picker-close:hover {
  color: #0f172a;
}
#inventoryScreen .ff-inv2-drafts-picker-list {
  list-style: none;
  margin: 10px 0 16px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 60vh;
  overflow-y: auto;
}
#inventoryScreen .ff-inv2-drafts-picker-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
}
#inventoryScreen .ff-inv2-drafts-picker-row--active {
  border-color: #c4b5fd;
  background: #faf5ff;
}
#inventoryScreen .ff-inv2-drafts-picker-main {
  flex: 1;
  min-width: 0;
}
#inventoryScreen .ff-inv2-drafts-picker-name {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-drafts-picker-meta {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 2px;
}
#inventoryScreen .ff-inv2-drafts-picker-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-drafts-picker-current {
  font-size: 11px;
  font-weight: 700;
  color: #5b21b6;
  background: #ede9fe;
  padding: 3px 10px;
  border-radius: 999px;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
#inventoryScreen .ff-inv2-drafts-picker-switch {
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: #7c3aed;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-family: inherit;
}
#inventoryScreen .ff-inv2-drafts-picker-switch:hover {
  background: #6d28d9;
}
#inventoryScreen .ff-inv2-drafts-picker-delete {
  padding: 4px 8px;
  font-size: 13px;
  color: #94a3b8;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
}
#inventoryScreen .ff-inv2-drafts-picker-delete:hover {
  color: #b91c1c;
  border-color: #fecaca;
  background: #fef2f2;
}
#inventoryScreen .ff-inv2-drafts-picker-empty {
  color: #64748b;
  font-size: 13px;
  text-align: center;
  padding: 24px 0;
  margin: 0;
}
#inventoryScreen .ff-inv2-drafts-picker-actions-row {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
#inventoryScreen .ff-inv2-draft-banner-icon {
  font-size: 14px;
  line-height: 1;
}
#inventoryScreen .ff-inv2-draft-banner-text {
  flex: 1;
  min-width: 0;
}
#inventoryScreen .ff-inv2-draft-banner-text strong {
  color: #6d28d9;
  font-weight: 700;
}
#inventoryScreen .ff-inv2-draft-banner-hint {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #7c3aed;
  background: #ede9fe;
  padding: 2px 8px;
  border-radius: 999px;
  flex-shrink: 0;
}
/* Inline editable qty input for manual Order-list rows — matches the "plain cell" look
 * from the Inventory table. Transparent by default; hover / focus reveal the edit state. */
#inventoryScreen .ff-inv2-ol-qty-input {
  width: 100%;
  max-width: 64px;
  padding: 2px 4px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: #0f172a;
  text-align: right;
  font-family: inherit;
  line-height: 1.3;
  box-sizing: border-box;
  -moz-appearance: textfield;
  cursor: text;
  transition: background 0.12s ease, border-color 0.12s ease;
}
#inventoryScreen .ff-inv2-ol-qty-input::-webkit-outer-spin-button,
#inventoryScreen .ff-inv2-ol-qty-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
#inventoryScreen .ff-inv2-ol-qty-input:hover {
  background: #f8fafc;
  border-color: #e2e8f0;
}
#inventoryScreen .ff-inv2-ol-qty-input:focus {
  outline: none;
  background: #fff;
  border-color: #a78bfa;
  box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.12);
}
#inventoryScreen .ff-inv2-order-list-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-order-list-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
#inventoryScreen .ff-inv2-ol-tr--manual td {
  background: #faf5ff;
}
#inventoryScreen .ff-inv2-ol-manual-tag {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #5b21b6;
  background: #ede9fe;
  border-radius: 999px;
  vertical-align: middle;
}
#inventoryScreen .ff-inv2-ol-manual-remove {
  width: 22px;
  height: 22px;
  padding: 0;
  font-size: 14px;
  line-height: 1;
  color: #94a3b8;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
}
#inventoryScreen .ff-inv2-ol-manual-remove:hover {
  color: #b91c1c;
  background: #fef2f2;
  border-color: #fecaca;
}
#inventoryScreen .ff-inv2-ol-linked-tag {
  display: inline-block;
  font-size: 10px;
  margin-left: 2px;
  vertical-align: middle;
}
#inventoryScreen .ff-inv2-ob-add-card {
  max-width: 420px;
}
#inventoryScreen .ff-inv2-ob-add-hint {
  margin: 0 0 8px;
  font-size: 11px;
  color: #b45309;
  background: #fef3c7;
  padding: 6px 10px;
  border-radius: 6px;
}
#inventoryScreen .ff-inv2-modal-field-optional {
  font-weight: 400;
  font-size: 10px;
  color: #94a3b8;
  text-transform: none;
  letter-spacing: 0;
}
#inventoryScreen .ff-inv2-ob-link-wrap {
  display: block;
}
#inventoryScreen .ff-inv2-ob-link-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0 6px;
}
#inventoryScreen .ff-inv2-ob-link-head-label {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-ob-link-back {
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  color: #5b21b6;
  background: transparent;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
}
#inventoryScreen .ff-inv2-ob-link-back:hover {
  background: #faf5ff;
  border-color: #ddd6fe;
}
#inventoryScreen .ff-inv2-ob-link-option-chev {
  margin-left: auto;
  padding-left: 8px;
  font-size: 14px;
  color: #cbd5e1;
}
#inventoryScreen .ff-inv2-ob-link-option {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
#inventoryScreen .ff-inv2-ob-link-hint {
  margin: 6px 0 0;
  padding: 8px 10px;
  font-size: 11px;
  color: #94a3b8;
  background: #f8fafc;
  border-radius: 6px;
}
#inventoryScreen .ff-inv2-ob-link-list {
  margin-top: 6px;
  max-height: 180px;
  overflow: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}
#inventoryScreen .ff-inv2-ob-link-option {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  border: none;
  background: #fff;
  cursor: pointer;
  border-bottom: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-ob-link-option:last-child {
  border-bottom: none;
}
#inventoryScreen .ff-inv2-ob-link-option:hover {
  background: #faf5ff;
}
#inventoryScreen .ff-inv2-ob-link-option-name {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-ob-link-option-meta {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-ob-link-selected {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: #ede9fe;
  border: 1px solid #c4b5fd;
  border-radius: 8px;
}
#inventoryScreen .ff-inv2-ob-link-selected-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
#inventoryScreen .ff-inv2-ob-link-selected-name {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #5b21b6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-ob-link-selected-sub {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  color: #7c3aed;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-ob-link-clear {
  width: 24px;
  height: 24px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #6d28d9;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}
#inventoryScreen .ff-inv2-ob-link-clear:hover {
  background: #ddd6fe;
}
#inventoryScreen .ff-inv2-order-list-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}
#inventoryScreen .ff-inv2-order-list-table {
  width: 100%;
  min-width: 880px;
  border-collapse: collapse;
  font-size: 12px;
  background: #fff;
}
#inventoryScreen .ff-inv2-order-list-table th.ff-inv2-ol-th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px 10px;
  text-align: left;
  font-weight: 600;
  color: #475569;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-order-list-table td.ff-inv2-ol-td {
  padding: 8px 10px;
  border-bottom: 1px solid #f1f5f9;
  color: #0f172a;
  vertical-align: top;
}
#inventoryScreen .ff-inv2-order-list-table tbody tr:hover td {
  background: #fafafa;
}
#inventoryScreen .ff-inv2-ol-url-wrap {
  max-width: 140px;
}
#inventoryScreen .ff-inv2-ol-url {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-order-list-empty {
  margin: 0;
  padding: 14px 16px;
  font-size: 13px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-order-list-loading {
  margin: 0;
  padding: 20px 16px;
  font-size: 13px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-ob-source {
  padding: 12px 16px;
  border-bottom: 1px solid #e2e8f0;
  background: #fafafa;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-main-tab-body--insights {
  padding: 12px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
#inventoryScreen .ff-inv2-insights-wrap {
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-insights-wrap > .ff-inv2-insights-head {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px 16px;
  gap: 8px;
}
#inventoryScreen .ff-inv2-insights-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}
#inventoryScreen .ff-inv2-insights-kpi {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
#inventoryScreen .ff-inv2-insights-kpi-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #64748b;
}
#inventoryScreen .ff-inv2-insights-kpi-value {
  font-size: 22px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
#inventoryScreen .ff-inv2-insights-kpi-sub {
  margin-top: 2px;
  font-size: 11px;
  color: #94a3b8;
}
#inventoryScreen .ff-inv2-insights-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px 16px;
}
#inventoryScreen .ff-inv2-insights-card--warn {
  border-color: #fde68a;
  background: #fffbeb;
}
#inventoryScreen .ff-inv2-insights-card--dead {
  border-color: #e2e8f0;
  background: #f8fafc;
}
#inventoryScreen .ff-inv2-insights-card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
#inventoryScreen .ff-inv2-insights-card-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-insights-card-hint {
  font-size: 11px;
  color: #94a3b8;
}
#inventoryScreen .ff-inv2-insights-spend-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
#inventoryScreen .ff-inv2-insights-spend-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
#inventoryScreen .ff-inv2-insights-spend-name-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 13px;
}
#inventoryScreen .ff-inv2-insights-spend-name {
  flex: 1;
  font-weight: 600;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-insights-spend-amount {
  font-weight: 700;
  color: #5b21b6;
  font-variant-numeric: tabular-nums;
}
#inventoryScreen .ff-inv2-insights-spend-pct {
  font-size: 11px;
  color: #64748b;
  font-variant-numeric: tabular-nums;
  min-width: 40px;
  text-align: right;
}
#inventoryScreen .ff-inv2-insights-spend-bar {
  height: 6px;
  border-radius: 999px;
  background: #f1f5f9;
  overflow: hidden;
}
#inventoryScreen .ff-inv2-insights-spend-bar > span {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #a78bfa 0%, #7c3aed 100%);
  border-radius: 999px;
}
#inventoryScreen .ff-inv2-insights-low-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
#inventoryScreen .ff-inv2-insights-low-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-insights-low-row:last-child {
  border-bottom: none;
}
#inventoryScreen .ff-inv2-insights-low-main {
  flex: 1;
  min-width: 0;
}
#inventoryScreen .ff-inv2-insights-low-name {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-insights-low-path {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 2px;
}
#inventoryScreen .ff-inv2-insights-low-qty {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-variant-numeric: tabular-nums;
}
#inventoryScreen .ff-inv2-insights-low-current {
  font-weight: 700;
  font-size: 14px;
  color: #b45309;
}
#inventoryScreen .ff-inv2-insights-card--dead .ff-inv2-insights-low-current {
  color: #64748b;
}
#inventoryScreen .ff-inv2-insights-low-sep {
  font-size: 11px;
  color: #94a3b8;
}
#inventoryScreen .ff-inv2-insights-low-stock {
  font-size: 13px;
  color: #475569;
}
#inventoryScreen .ff-inv2-insights-low-pct {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 700;
  color: #b45309;
  background: #fef3c7;
  border-radius: 999px;
  padding: 2px 8px;
}
/* Month-over-Month delta pill on Total spend KPI */
#inventoryScreen .ff-inv2-insights-delta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  width: fit-content;
  margin-top: 4px;
}
#inventoryScreen .ff-inv2-insights-delta-arrow {
  font-size: 10px;
  line-height: 1;
}
#inventoryScreen .ff-inv2-insights-delta--up {
  color: #b91c1c;
  background: #fee2e2;
}
#inventoryScreen .ff-inv2-insights-delta--down {
  color: #047857;
  background: #d1fae5;
}
#inventoryScreen .ff-inv2-insights-delta--flat {
  color: #64748b;
  background: #f1f5f9;
}
/* Smart Reorder Suggestions */
#inventoryScreen .ff-inv2-insights-reorder-qty {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  font-variant-numeric: tabular-nums;
}
#inventoryScreen .ff-inv2-insights-reorder-days {
  font-size: 11px;
  font-weight: 700;
  color: #b91c1c;
  background: #fee2e2;
  border-radius: 999px;
  padding: 2px 8px;
}
#inventoryScreen .ff-inv2-insights-reorder-suggest {
  font-size: 11px;
  font-weight: 600;
  color: #0f172a;
  background: #ede9fe;
  border-radius: 999px;
  padding: 2px 8px;
}
/* Days of Stock Left — usage list */
#inventoryScreen .ff-inv2-insights-usage-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
#inventoryScreen .ff-inv2-insights-usage-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-insights-usage-row:last-child {
  border-bottom: none;
}
#inventoryScreen .ff-inv2-insights-usage-main {
  flex: 1;
  min-width: 0;
}
#inventoryScreen .ff-inv2-insights-usage-name {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-insights-usage-path {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 2px;
}
#inventoryScreen .ff-inv2-insights-usage-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  font-variant-numeric: tabular-nums;
}
#inventoryScreen .ff-inv2-insights-usage-current {
  font-size: 11px;
  color: #64748b;
  font-weight: 500;
}
#inventoryScreen .ff-inv2-insights-usage-badge {
  font-size: 11px;
  font-weight: 700;
  border-radius: 999px;
  padding: 2px 10px;
  background: #f1f5f9;
  color: #475569;
  min-width: 44px;
  text-align: center;
}
#inventoryScreen .ff-inv2-insights-usage-badge--critical {
  color: #b91c1c;
  background: #fee2e2;
}
#inventoryScreen .ff-inv2-insights-usage-badge--low {
  color: #b45309;
  background: #fef3c7;
}
#inventoryScreen .ff-inv2-insights-usage-badge--ok {
  color: #047857;
  background: #d1fae5;
}
#inventoryScreen .ff-inv2-insights-usage-more {
  font-size: 11px;
  color: #94a3b8;
  padding-top: 8px;
  text-align: center;
  font-style: italic;
}
/* Donut chart — Spend by Category (Overview) */
#inventoryScreen .ff-inv2-insights-donut-wrap {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}
#inventoryScreen .ff-inv2-insights-donut-chart {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}
#inventoryScreen .ff-inv2-insights-donut-svg {
  display: block;
}
#inventoryScreen .ff-inv2-insights-donut-total {
  font-family: inherit;
  font-size: 15px;
  font-weight: 700;
  fill: #0f172a;
}
#inventoryScreen .ff-inv2-insights-donut-sub {
  font-family: inherit;
  font-size: 9px;
  fill: #94a3b8;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
#inventoryScreen .ff-inv2-insights-donut-legend {
  flex: 1;
  min-width: 220px;
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
#inventoryScreen .ff-inv2-insights-donut-legend-row {
  display: grid;
  grid-template-columns: 12px 1fr auto auto;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #f1f5f9;
  font-size: 12px;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-insights-donut-legend-row:last-child {
  border-bottom: none;
}
#inventoryScreen .ff-inv2-insights-donut-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  display: inline-block;
}
#inventoryScreen .ff-inv2-insights-donut-legend-name {
  font-weight: 600;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
#inventoryScreen .ff-inv2-insights-donut-legend-amount {
  font-variant-numeric: tabular-nums;
  color: #475569;
}
#inventoryScreen .ff-inv2-insights-donut-legend-pct {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: #0f172a;
  font-size: 11px;
  background: #f1f5f9;
  padding: 2px 8px;
  border-radius: 999px;
  min-width: 42px;
  text-align: center;
}
/* Intro banner for sub-tabs (e.g. Forecast explanation) */
#inventoryScreen .ff-inv2-insights-subtab-intro {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  background: linear-gradient(180deg, #faf5ff 0%, #f5f3ff 100%);
  border: 1px solid #e9d5ff;
  border-radius: 10px;
}
#inventoryScreen .ff-inv2-insights-subtab-intro-icon {
  font-size: 18px;
  line-height: 1.2;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-insights-subtab-intro-title {
  font-size: 12px;
  font-weight: 700;
  color: #5b21b6;
  letter-spacing: 0.02em;
}
#inventoryScreen .ff-inv2-insights-subtab-intro-hint {
  font-size: 11px;
  color: #6b21a8;
  margin-top: 2px;
  line-height: 1.4;
}
/* Insights sub-tabs (Overview / Purchases / Forecast / Stock Health) */
#inventoryScreen .ff-inv2-insights-subtabs {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid #e2e8f0;
  margin: 2px 0 4px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
#inventoryScreen .ff-inv2-insights-subtabs::-webkit-scrollbar {
  display: none;
}
#inventoryScreen .ff-inv2-insights-subtab {
  flex: 0 0 auto;
  background: transparent;
  border: none;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 500;
  color: #64748b;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  white-space: nowrap;
  transition: color 120ms ease, border-color 120ms ease;
  font-family: inherit;
}
#inventoryScreen .ff-inv2-insights-subtab:hover {
  color: #0f172a;
}
#inventoryScreen .ff-inv2-insights-subtab--active {
  color: #7c3aed;
  font-weight: 600;
  border-bottom-color: #7c3aed;
}
#inventoryScreen .ff-inv2-insights-subtab:focus-visible {
  outline: 2px solid #c4b5fd;
  outline-offset: 2px;
  border-radius: 4px;
}
#inventoryScreen .ff-inv2-insights-head {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
#inventoryScreen .ff-inv2-insights-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
#inventoryScreen .ff-inv2-insights-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-insights-range-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
}
#inventoryScreen .ff-inv2-insights-range-select {
  padding: 6px 28px 6px 10px;
  font-size: 13px;
  font-weight: 500;
  color: #0f172a;
  background: #fff
    url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%2364748b' d='M5 6 0 0h10z'/%3E%3C/svg%3E")
    no-repeat right 10px center;
  background-size: 9px 5px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
}
#inventoryScreen .ff-inv2-insights-range-select:focus {
  outline: 2px solid #c4b5fd;
  outline-offset: 1px;
  border-color: #a78bfa;
}
#inventoryScreen .ff-inv2-insights-custom {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
#inventoryScreen .ff-inv2-insights-date-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #475569;
}
#inventoryScreen .ff-inv2-insights-date-label input[type="date"] {
  padding: 5px 8px;
  font-size: 13px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  color: #0f172a;
  background: #fff;
}
#inventoryScreen .ff-inv2-insights-empty {
  margin: 0;
  padding: 24px 12px;
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
}
#inventoryScreen .ff-inv2-insights-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
#inventoryScreen .ff-inv2-insights-row {
  display: grid;
  grid-template-columns: 28px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 10px 4px;
  border-bottom: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-insights-row:last-child {
  border-bottom: none;
}
#inventoryScreen .ff-inv2-insights-rank {
  color: #94a3b8;
  font-weight: 600;
  font-size: 12px;
  text-align: right;
}
#inventoryScreen .ff-inv2-insights-name {
  color: #0f172a;
  font-weight: 500;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
}
#inventoryScreen .ff-inv2-insights-qty {
  color: #5b21b6;
  font-weight: 700;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  background: #ede9fe;
  border-radius: 999px;
  padding: 2px 12px;
  min-width: 56px;
  text-align: center;
}
#inventoryScreen .ff-inv2-ob-source-title {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: none;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-ob-source-hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-ob-source-radios {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
#inventoryScreen .ff-inv2-ob-radio {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  color: #0f172a;
  cursor: pointer;
}
#inventoryScreen .ff-inv2-ob-radio input {
  margin-top: 3px;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-ob-muted {
  color: #64748b;
  font-weight: 400;
}
#inventoryScreen .ff-inv2-ob-custom {
  margin-top: 0;
  max-height: min(32vh, 260px);
  overflow: auto;
  padding: 0;
  -webkit-overflow-scrolling: touch;
}
#inventoryScreen .ff-inv2-ob-tree {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
#inventoryScreen .ff-inv2-ob-cat-block {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
}
#inventoryScreen .ff-inv2-ob-cat-block--open {
  border-color: #c4b5fd;
  background: #faf5ff;
}
#inventoryScreen .ff-inv2-ob-cat-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
}
#inventoryScreen .ff-inv2-ob-cat-toggle {
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background 0.12s ease, color 0.12s ease;
}
#inventoryScreen .ff-inv2-ob-cat-toggle:hover {
  background: #ede9fe;
  color: #5b21b6;
}
#inventoryScreen .ff-inv2-ob-cat-chev {
  font-size: 12px;
  line-height: 1;
}
#inventoryScreen .ff-inv2-ob-cat-label {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: 13px;
  color: #1e293b;
  cursor: pointer;
}
#inventoryScreen .ff-inv2-ob-cat-name {
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-ob-cat-count {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: #7c3aed;
  background: #ede9fe;
  border-radius: 999px;
  padding: 2px 8px;
  min-width: 28px;
  text-align: center;
}
#inventoryScreen .ff-inv2-ob-subs {
  margin: 0;
  padding: 4px 12px 8px 36px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid #e9d5ff;
  background: #ffffff;
}
#inventoryScreen .ff-inv2-ob-sub-label {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  color: #475569;
  cursor: pointer;
}
#inventoryScreen .ff-inv2-ob-tree-empty {
  font-size: 12px;
  color: #94a3b8;
}
#inventoryScreen .ff-inv2-table {
  width: max-content;
  min-width: 100%;
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
  background: #fff;
  --inv-sticky-hash-left: 28px;
  --inv-sticky-code-left: 80px;
  --inv-sticky-name-left: 204px;
  --inv-header-row1-height: 40px;
}
#inventoryScreen .ff-inv2-table thead tr:nth-child(1) th.ff-inv2-th-dnd {
  position: sticky;
  left: 0;
  top: 0;
  z-index: 30;
  width: 28px;
  min-width: 28px;
  max-width: 28px;
  padding: 0 !important;
  background: #fff;
  box-shadow: 2px 0 0 0 #e2e8f0;
}
#inventoryScreen .ff-inv2-table thead tr:nth-child(1) th.ff-inv2-th-num {
  position: sticky;
  left: var(--inv-sticky-hash-left);
  top: 0;
  z-index: 30;
  background: #fff;
  box-shadow: 2px 0 0 0 #e2e8f0;
}
#inventoryScreen .ff-inv2-table thead tr:nth-child(1) th.ff-inv2-th-code {
  position: sticky;
  left: var(--inv-sticky-code-left);
  top: 0;
  z-index: 30;
  background: #fff;
  box-shadow: 2px 0 0 0 #e2e8f0;
}
#inventoryScreen .ff-inv2-table thead tr:nth-child(1) th.ff-inv2-th-name {
  position: sticky;
  left: var(--inv-sticky-name-left);
  top: 0;
  z-index: 30;
  background: #fff;
  box-shadow: 2px 0 0 0 #e2e8f0;
}
#inventoryScreen .ff-inv2-td-dnd {
  position: sticky;
  left: 0;
  z-index: 4;
  width: 28px;
  min-width: 28px;
  max-width: 28px;
  padding: 2px 0 !important;
  vertical-align: middle !important;
  text-align: center !important;
  background: #fff;
  box-shadow: 2px 0 0 0 #e2e8f0;
}
#inventoryScreen .ff-inv2-row-dnd-handle {
  display: block;
  width: 22px;
  height: 26px;
  margin: 0 auto;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: grab;
  color: #cbd5e1;
  opacity: 0.85;
  transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
}
#inventoryScreen .ff-inv2-row-dnd-handle::before {
  content: "";
  display: block;
  width: 6px;
  height: 12px;
  margin: 6px auto 0;
  background: linear-gradient(currentColor, currentColor) 0 0/2px 100% no-repeat,
    linear-gradient(currentColor, currentColor) 4px 0/2px 100% no-repeat;
  opacity: 0.9;
}
#inventoryScreen .ff-inv2-row-dnd-handle:hover {
  color: #94a3b8;
  background: rgba(148, 163, 184, 0.1);
}
#inventoryScreen .ff-inv2-row-dnd-handle:active {
  cursor: grabbing;
}
#inventoryScreen .ff-inv2-data-row.ff-inv2-row-dnd-dragging {
  opacity: 0.55;
}
#inventoryScreen .ff-inv2-data-row.ff-inv2-row-dnd-over {
  outline: 1px solid rgba(124, 58, 237, 0.35);
  outline-offset: -1px;
  background: rgba(245, 243, 255, 0.65);
}
#inventoryScreen .ff-inv2-td-no {
  position: sticky;
  left: var(--inv-sticky-hash-left);
  z-index: 3;
  background: #fff;
  box-shadow: 2px 0 0 0 #e2e8f0;
}
#inventoryScreen .ff-inv2-td-code {
  position: sticky;
  left: var(--inv-sticky-code-left);
  z-index: 3;
  background: #fff;
  box-shadow: 2px 0 0 0 #e2e8f0;
}
#inventoryScreen .ff-inv2-td-name {
  position: sticky;
  left: var(--inv-sticky-name-left);
  z-index: 3;
  background: #fff;
  box-shadow: 2px 0 0 0 #e2e8f0;
}
#inventoryScreen .ff-inv2-table .col-resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 6;
  touch-action: none;
}
#inventoryScreen .ff-inv2-th-num,
#inventoryScreen .ff-inv2-td-num {
  width: auto;
  min-width: 0;
  max-width: none;
  padding-left: 4px !important;
  padding-right: 4px !important;
  text-align: center !important;
  vertical-align: middle !important;
}
#inventoryScreen .ff-inv2-td-no-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 0;
  width: 100%;
  min-height: 28px;
}
#inventoryScreen .ff-inv2-td-no .ff-inv2-cell-view,
#inventoryScreen .ff-inv2-td-no .ff-inv2-cell-input--editing {
  text-align: center;
}
#inventoryScreen .ff-inv2-td-no .ff-inv2-cell-view.ff-inv2-no-input {
  flex: 1 1 auto;
  min-width: 2rem;
  min-height: 24px;
  display: block;
  box-sizing: border-box;
  padding: 4px 2px;
  border-radius: 4px;
  cursor: pointer;
  line-height: 1.3;
}
#inventoryScreen .ff-inv2-td-no .ff-inv2-cell-view.ff-inv2-no-input:hover,
#inventoryScreen .ff-inv2-td-no .ff-inv2-cell-view.ff-inv2-no-input:focus-visible {
  background: rgba(124, 58, 237, 0.06);
  outline: none;
}
#inventoryScreen .ff-inv2-td-no .ff-inv2-cell-view.ff-inv2-no-input,
#inventoryScreen .ff-inv2-td-no .ff-inv2-cell-input--editing.ff-inv2-no-input {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
#inventoryScreen .ff-inv2-td-no .ff-inv2-cell-input--editing.ff-inv2-no-input {
  width: 100%;
  min-width: 2rem;
  box-sizing: border-box;
}
#inventoryScreen .ff-inv2-th-num {
  font-size: 10px;
  letter-spacing: 0.02em;
}
#inventoryScreen .ff-inv2-th-code,
#inventoryScreen .ff-inv2-td-code {
  width: auto;
  min-width: 0;
  max-width: none;
  padding-left: 4px !important;
  padding-right: 6px !important;
  vertical-align: middle !important;
}
#inventoryScreen .ff-inv2-th-name,
#inventoryScreen .ff-inv2-td-name {
  width: auto;
  min-width: 0;
  max-width: none;
  padding-left: 6px !important;
  padding-right: 8px !important;
  vertical-align: middle !important;
}
#inventoryScreen .ff-inv2-cell-view.ff-inv2-code-input,
#inventoryScreen .ff-inv2-cell-input--editing.ff-inv2-code-input {
  min-width: 3rem;
}
#inventoryScreen .ff-inv2-cell-view.ff-inv2-name-input,
#inventoryScreen .ff-inv2-cell-input--editing.ff-inv2-name-input {
  min-width: 0;
  width: 100%;
  max-width: 100%;
  display: block;
  font-size: 13px;
}
#inventoryScreen .ff-inv2-td-supplier {
  vertical-align: middle !important;
  padding-left: 6px !important;
  padding-right: 8px !important;
  position: relative;
  z-index: 0;
}
#inventoryScreen .ff-inv2-td-supplier .ff-inv2-cell-view,
#inventoryScreen .ff-inv2-td-supplier .ff-inv2-cell-input--editing {
  position: relative;
  z-index: 1;
}
#inventoryScreen .ff-inv2-td-url {
  vertical-align: middle !important;
  padding-left: 6px !important;
  padding-right: 8px !important;
}
#inventoryScreen .ff-inv2-url-cell {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
#inventoryScreen .ff-inv2-url-link {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #2563eb;
  text-decoration: none;
  font-size: 12px;
}
#inventoryScreen .ff-inv2-url-link:hover {
  text-decoration: underline;
}
#inventoryScreen .ff-inv2-url-empty {
  flex: 1;
  min-width: 0;
  color: #94a3b8;
  font-size: 12px;
}
#inventoryScreen .ff-inv2-url-edit {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.12s ease, color 0.12s ease;
}
#inventoryScreen .ff-inv2-td-url:hover .ff-inv2-url-edit,
#inventoryScreen .ff-inv2-url-edit:focus-visible {
  opacity: 1;
}
#inventoryScreen .ff-inv2-url-edit:hover {
  color: #64748b;
}
#inventoryScreen .ff-inv2-url-edit:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: 1px;
}
#inventoryScreen .ff-inv2-td-url .ff-inv2-cell-input--editing {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}
#inventoryScreen .ff-inv2-table thead tr:nth-child(1) th:nth-last-child(1),
#inventoryScreen .ff-inv2-table thead tr:nth-child(1) th:nth-last-child(2) {
  min-width: 5rem;
}
#inventoryScreen .ff-inv2-table tbody td:nth-last-child(2),
#inventoryScreen .ff-inv2-table tbody td:last-child {
  min-width: 4.5rem;
}
#inventoryScreen .ff-inv2-table thead th {
  position: sticky;
  background: #fff;
  color: #475569;
  font-weight: 600;
  text-align: left;
  padding: 8px 10px 8px 8px;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
  vertical-align: middle;
}
#inventoryScreen .ff-inv2-table thead th.ff-inv2-gh {
  background: linear-gradient(180deg, #faf5ff 0%, #f5f3ff 100%);
}
#inventoryScreen .ff-inv2-table thead tr:nth-child(1) th {
  top: 0;
  z-index: 20;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
#inventoryScreen .ff-inv2-table thead tr:nth-child(2) th {
  top: var(--inv-header-row1-height);
  z-index: 19;
  background: #fff;
}
#inventoryScreen .ff-inv2-gh {
  text-align: center !important;
  background: linear-gradient(180deg, #faf5ff 0%, #f5f3ff 100%);
  color: #6d28d9 !important;
  border-left: 1px solid #ede9fe;
  padding: 4px 6px !important;
  vertical-align: middle !important;
}
#inventoryScreen .ff-inv2-gh-inner {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  width: 100%;
}
#inventoryScreen .ff-inv2-gh-inner .ff-inv2-gh-input {
  flex: 1 1 auto;
  min-width: 0;
}
#inventoryScreen .ff-inv2-gh-remove {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin: 0;
  padding: 0;
  border: 1px solid transparent;
  background: rgba(255,255,255,0.65);
  color: #94a3b8;
  border-radius: 6px;
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
  line-height: 1;
}
#inventoryScreen .ff-inv2-gh-remove:hover {
  background: #fee2e2;
  border-color: #fecaca;
  color: #b91c1c;
}
#inventoryScreen .ff-inv2-gh-remove:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: 1px;
}
#inventoryScreen .ff-inv2-gh--confirming {
  white-space: normal !important;
}
#inventoryScreen .ff-inv2-gh-inner--confirm {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}
#inventoryScreen .ff-inv2-gh-confirm-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: stretch;
}
#inventoryScreen .ff-inv2-gh-warn {
  font-size: 10px;
  font-weight: 500;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 6px;
  padding: 6px 8px;
  line-height: 1.35;
  text-align: left;
}
#inventoryScreen .ff-inv2-gh-confirm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}
#inventoryScreen .ff-inv2-gh-btn {
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
}
#inventoryScreen .ff-inv2-gh-btn-cancel {
  background: #fff;
  border-color: #e2e8f0;
  color: #475569;
}
#inventoryScreen .ff-inv2-gh-btn-cancel:hover {
  background: #f8fafc;
}
#inventoryScreen .ff-inv2-gh-btn-danger {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}
#inventoryScreen .ff-inv2-gh-btn-danger:hover {
  background: #fee2e2;
}
#inventoryScreen .ff-inv2-gh-input {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  margin: 0;
  padding: 6px 8px;
  font: inherit;
  font-weight: 700;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  text-align: center;
  color: #5b21b6;
  background: rgba(255,255,255,0.5);
  border: 1px solid #e9d5ff;
  border-radius: 8px;
}
#inventoryScreen .ff-inv2-gh-input:focus {
  outline: none;
  border-color: #a78bfa;
  background: #fff;
}
#inventoryScreen .ff-inv2-subh {
  text-align: center !important;
  font-size: 10px !important;
  color: #64748b !important;
  background: #fafafa !important;
  font-weight: 600 !important;
}
#inventoryScreen .ff-inv2-table tbody td {
  padding: 8px 10px;
  border-bottom: 1px solid #eef2f7;
  border-right: 1px solid #f1f5f9;
  color: #334155;
  vertical-align: middle;
}
#inventoryScreen .ff-inv2-table tbody td:last-child {
  border-right: none;
}
#inventoryScreen .ff-inv2-table tbody tr:hover td {
  background: rgba(248, 250, 252, 0.85);
}
#inventoryScreen .ff-inv2-row-no-wrap {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
#inventoryScreen .ff-inv2-row-kebab {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #94a3b8;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease, color 0.12s ease, background 0.12s ease;
}
#inventoryScreen .ff-inv2-data-row:hover .ff-inv2-row-kebab,
#inventoryScreen .ff-inv2-row-kebab:focus-visible {
  opacity: 1;
  pointer-events: auto;
}
#inventoryScreen .ff-inv2-row-kebab:hover {
  color: #64748b;
  background: rgba(148, 163, 184, 0.15);
}
#inventoryScreen .ff-inv2-row-kebab:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: 1px;
}
#inventoryScreen .ff-inv2-row-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 48;
  background: transparent;
}
#inventoryScreen .ff-inv2-row-menu {
  position: fixed;
  z-index: 49;
  min-width: 168px;
  padding: 4px 0;
  margin: 0;
  list-style: none;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.06);
}
#inventoryScreen .ff-inv2-row-menu-item {
  display: block;
  width: 100%;
  margin: 0;
  padding: 8px 14px;
  border: none;
  background: transparent;
  text-align: left;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  color: #334155;
  cursor: pointer;
}
#inventoryScreen .ff-inv2-row-menu-item:hover {
  background: #f1f5f9;
}
#inventoryScreen .ff-inv2-row-menu-item--danger {
  color: #b91c1c;
}
#inventoryScreen .ff-inv2-row-menu-item--danger:hover {
  background: #fef2f2;
}
#inventoryScreen .ff-inv2-num { font-variant-numeric: tabular-nums; font-weight: 600; color: #0f172a; }
#inventoryScreen .ff-inv2-td-numcell {
  text-align: right;
  font-variant-numeric: tabular-nums;
  min-width: 4.75rem;
}
#inventoryScreen .ff-inv2-td-price {
  position: relative;
}
#inventoryScreen .ff-inv2-price-symbol {
  position: absolute;
  left: 6px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 11px;
  color: #94a3b8;
  pointer-events: none;
  font-weight: 600;
}
#inventoryScreen .ff-inv2-td-price .ff-inv2-cell-view,
#inventoryScreen .ff-inv2-td-price .ff-inv2-cell-input--editing {
  padding-left: 18px;
}
#inventoryScreen .ff-inv2-td-numcell .ff-inv2-cell-view,
#inventoryScreen .ff-inv2-td-numcell .ff-inv2-cell-input--editing {
  text-align: right;
}
#inventoryScreen .ff-inv2-td-text {
  min-width: 6rem;
}
#inventoryScreen .ff-inv2-cell-view {
  display: block;
  width: 100%;
  min-height: 1.35em;
  margin: 0;
  padding: 4px 2px;
  font: inherit;
  font-size: 12px;
  line-height: 1.4;
  color: #0f172a;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: default;
  box-sizing: border-box;
  transition: background 0.12s ease;
}
#inventoryScreen .ff-inv2-table tbody td:hover .ff-inv2-cell-view {
  background: rgba(124, 58, 237, 0.04);
}
#inventoryScreen .ff-inv2-cell-view:focus {
  outline: none;
}
#inventoryScreen .ff-inv2-cell-view:focus-visible {
  outline: 2px solid rgba(124, 58, 237, 0.35);
  outline-offset: 1px;
}
#inventoryScreen .ff-inv2-cell-input--editing {
  width: 100%;
  max-width: 100%;
  min-width: 3rem;
  box-sizing: border-box;
  margin: 0;
  padding: 5px 8px;
  font: inherit;
  font-size: 12px;
  color: #0f172a;
  background: #fff;
  border: 1px solid #c4b5fd;
  border-radius: 6px;
  box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.12);
}
#inventoryScreen .ff-inv2-cell-input--editing:focus {
  outline: none;
  border-color: #7c3aed;
  box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.18);
}
#inventoryScreen .ff-inv2-cell-input--editing.ff-inv2-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
#inventoryScreen .ff-inv2-order-cell {
  text-align: center;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: #64748b;
  background: transparent;
}
#inventoryScreen .ff-inv2-order-cell--positive {
  color: #5b21b6;
  font-weight: 700;
  background: rgba(124, 58, 237, 0.06);
}
#inventoryScreen .ff-inv2-order-cell--positive .ff-inv2-order-val {
  color: inherit;
}
#inventoryScreen .ff-inv2-order-cell--has-approved {
  color: #0369a1;
  background: rgba(14, 165, 233, 0.12);
  cursor: help;
  position: relative;
}
#inventoryScreen .ff-inv2-order-cell--has-approved .ff-inv2-order-val {
  color: inherit;
}
#inventoryScreen .ff-inv2-order-cell--has-approved::after {
  content: "";
  position: absolute;
  top: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #0ea5e9;
}
#inventoryScreen .ff-inv2-ord-breakdown-dl {
  margin: 0 0 12px;
  font-size: 13px;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 14px;
}
#inventoryScreen .ff-inv2-ord-breakdown-dl dt {
  color: #64748b;
  font-weight: 600;
}
#inventoryScreen .ff-inv2-ord-breakdown-dl dd {
  margin: 0;
  text-align: right;
  color: #0f172a;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
#inventoryScreen .ff-inv2-ord-breakdown-dl dd.ff-inv2-ord-breakdown-total {
  color: #5b21b6;
}
#inventoryScreen .ff-inv2-ord-breakdown-section {
  margin: 0 0 12px;
}
#inventoryScreen .ff-inv2-ord-breakdown-section-title {
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #64748b;
}
#inventoryScreen .ff-inv2-ord-breakdown-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  overflow: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}
#inventoryScreen .ff-inv2-ord-breakdown-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-ord-breakdown-entry:last-child {
  border-bottom: none;
}
#inventoryScreen .ff-inv2-ord-breakdown-entry-main {
  flex: 1;
  min-width: 0;
}
#inventoryScreen .ff-inv2-ord-breakdown-entry-qty {
  font-weight: 700;
  color: #0369a1;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
}
#inventoryScreen .ff-inv2-ord-breakdown-entry-meta {
  margin-top: 2px;
  font-size: 11px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-ord-breakdown-remove {
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #b91c1c;
  cursor: pointer;
  font-size: 14px;
  padding: 0;
}
#inventoryScreen .ff-inv2-ord-breakdown-remove:hover {
  background: #fef2f2;
  border-color: #fecaca;
}
#inventoryScreen .ff-inv2-ord-breakdown-empty {
  margin: 0;
  padding: 10px;
  background: #f8fafc;
  border-radius: 6px;
  font-size: 12px;
  color: #94a3b8;
  text-align: center;
}
#inventoryScreen .ff-inv2-mock-pill {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #7c3aed;
  background: #f3e8ff;
  padding: 3px 8px;
  border-radius: 999px;
  margin-left: 8px;
}
#inventoryScreen .ff-inv2-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483640;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 72px 24px 24px;
  background: rgba(15, 23, 42, 0.35);
  backdrop-filter: blur(2px);
}
#inventoryScreen .ff-inv2-modal-backdrop--nested {
  z-index: 2147483645;
  background: rgba(15, 23, 42, 0.45);
}
#inventoryScreen .ff-inv2-modal-card {
  width: 100%;
  max-width: 360px;
  padding: 20px 22px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #e2e8f0;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.12);
}
#inventoryScreen .ff-inv2-modal-card.ff-inv2-order-detail-card {
  padding: 16px 14px;
}
#inventoryScreen .ff-inv2-modal-title {
  margin: 0 0 8px 0;
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.35;
}
#inventoryScreen .ff-inv2-modal-hint {
  margin: 0 0 18px 0;
  font-size: 12px;
  color: #64748b;
  line-height: 1.45;
}
#inventoryScreen .ff-inv2-modal-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
#inventoryScreen .ff-inv2-modal-field {
  display: block;
  margin: 0 0 16px;
}
#inventoryScreen .ff-inv2-modal-field-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  margin: 0 0 6px;
}
#inventoryScreen .ff-inv2-modal-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  font-size: 13px;
  color: #0f172a;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}
#inventoryScreen .ff-inv2-modal-input:focus {
  outline: 2px solid #c4b5fd;
  outline-offset: 1px;
  border-color: #a78bfa;
}
#inventoryScreen .ff-inv2-modal-btn {
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
}
#inventoryScreen .ff-inv2-modal-btn-cancel {
  background: #fff;
  border-color: #e2e8f0;
  color: #475569;
}
#inventoryScreen .ff-inv2-modal-btn-cancel:hover {
  background: #f8fafc;
}
#inventoryScreen .ff-inv2-modal-btn-danger {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}
#inventoryScreen .ff-inv2-modal-btn-danger:hover {
  background: #fee2e2;
}
#inventoryScreen .ff-inv2-modal-btn-primary {
  background: #7c3aed;
  border-color: #6d28d9;
  color: #fff;
}
#inventoryScreen .ff-inv2-modal-btn-primary:hover {
  background: #6d28d9;
}
#inventoryScreen .ff-inv2-modal-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  pointer-events: none;
}
#inventoryScreen .ff-inv2-aside-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
#inventoryScreen .ff-inv2-aside-add {
  flex-shrink: 0;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 700;
  color: #5b21b6;
  background: #faf5ff;
  border: 1px solid #e9d5ff;
  border-radius: 6px;
  cursor: pointer;
}
#inventoryScreen .ff-inv2-aside-add:hover {
  background: #f3e8ff;
  border-color: #ddd6fe;
}
#inventoryScreen .ff-inv2-cat-manage-backdrop {
  z-index: 450;
}
#inventoryScreen .ff-inv2-cat-manage-card {
  max-width: 440px;
  max-height: min(85vh, 640px);
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}
#inventoryScreen .ff-inv2-cat-manage-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 0;
}
#inventoryScreen .ff-inv2-cat-manage-head-main {
  flex: 1;
  min-width: 0;
}
#inventoryScreen .ff-inv2-cat-manage-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
}
#inventoryScreen .ff-inv2-cat-manage-h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-cat-manage-add-head {
  flex-shrink: 0;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: #7c3aed;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(124, 58, 237, 0.25);
}
#inventoryScreen .ff-inv2-cat-manage-add-head:hover {
  background: #6d28d9;
}
#inventoryScreen .ff-inv2-cat-manage-add-head:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: 2px;
}
#inventoryScreen .ff-inv2-cat-manage-close {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  margin: 0;
  padding: 0;
  border: none;
  background: #f1f5f9;
  color: #64748b;
  border-radius: 8px;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
#inventoryScreen .ff-inv2-cat-manage-close:hover {
  background: #e2e8f0;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-cat-manage-subtitle {
  margin: 6px 20px 12px;
  font-size: 11px;
  color: #94a3b8;
}
#inventoryScreen .ff-inv2-cat-manage-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 20px 12px;
  border-top: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-cat-manage-empty {
  margin: 12px 0;
  font-size: 13px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-cat-manage-block {
  margin-bottom: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-cat-manage-block:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}
#inventoryScreen .ff-inv2-cat-manage-cat-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 8px;
}
#inventoryScreen .ff-inv2-cat-manage-cat-drag {
  flex: 1;
  min-width: 0;
  cursor: grab;
  border-radius: 8px;
  padding: 4px 6px;
  margin: -4px -6px;
  transition: background 0.12s ease, box-shadow 0.12s ease;
}
#inventoryScreen .ff-inv2-cat-manage-cat-drag:hover {
  background: rgba(124, 58, 237, 0.06);
  box-shadow: inset 0 0 0 1px rgba(124, 58, 237, 0.12);
}
#inventoryScreen .ff-inv2-cat-manage-cat-drag:active {
  cursor: grabbing;
}
#inventoryScreen .ff-inv2-cat-manage-block.ff-inv2-cat-dnd-dragging,
#inventoryScreen .ff-inv2-cat-manage-sub.ff-inv2-cat-dnd-dragging {
  opacity: 0.55;
}
#inventoryScreen .ff-inv2-cat-manage-block.ff-inv2-cat-dnd-over {
  outline: 1px solid rgba(124, 58, 237, 0.35);
  outline-offset: 1px;
  border-radius: 10px;
  background: rgba(245, 243, 255, 0.65);
}
#inventoryScreen .ff-inv2-cat-manage-block.ff-inv2-cat-dnd-over-block {
  outline: 1px solid rgba(124, 58, 237, 0.28);
  outline-offset: 2px;
  border-radius: 10px;
  background: rgba(245, 243, 255, 0.45);
  box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.2);
}
#inventoryScreen .ff-inv2-cat-manage-sub.ff-inv2-cat-dnd-over {
  outline: 1px solid rgba(124, 58, 237, 0.4);
  outline-offset: 1px;
  border-radius: 8px;
  background: rgba(245, 243, 255, 0.75);
}
#inventoryScreen .ff-inv2-cat-manage-sub {
  margin: 0;
  border-radius: 8px;
  transition: background 0.12s ease, box-shadow 0.12s ease;
}
#inventoryScreen .ff-inv2-cat-manage-sub:not(.ff-inv2-cat-dnd-dragging):hover {
  background: rgba(124, 58, 237, 0.04);
  box-shadow: inset 0 0 0 1px rgba(124, 58, 237, 0.1);
  cursor: grab;
}
#inventoryScreen .ff-inv2-cat-manage-sub:not(.ff-inv2-cat-dnd-dragging):active {
  cursor: grabbing;
}
#inventoryScreen .ff-inv2-cat-manage-sub .ff-inv2-cat-manage-sub-row {
  flex: 1;
  min-width: 0;
}
#inventoryScreen .ff-inv2-cat-manage-cat-name {
  flex: 1;
  min-width: 0;
}
#inventoryScreen .ff-inv2-cat-manage-cat-text {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-cat-manage-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
  align-items: center;
  justify-content: flex-end;
}
#inventoryScreen .ff-inv2-cat-manage-mini {
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #475569;
}
#inventoryScreen .ff-inv2-cat-manage-mini:hover {
  background: #f8fafc;
}
#inventoryScreen .ff-inv2-cat-manage-mini-danger {
  border-color: #fecaca;
  color: #b91c1c;
  background: #fff;
}
#inventoryScreen .ff-inv2-cat-manage-mini-danger:hover {
  background: #fef2f2;
}
#inventoryScreen .ff-inv2-cat-manage-input {
  width: 100%;
  max-width: 220px;
  box-sizing: border-box;
  padding: 6px 10px;
  font-size: 13px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}
#inventoryScreen .ff-inv2-cat-manage-input:focus {
  outline: none;
  border-color: #a78bfa;
  box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.12);
}
#inventoryScreen .ff-inv2-cat-manage-subs {
  margin-top: 10px;
  padding-left: 10px;
  border-left: 2px solid #ede9fe;
  display: flex;
  flex-direction: column;
  gap: 0;
}
#inventoryScreen .ff-inv2-cat-manage-sub + .ff-inv2-cat-manage-inline {
  margin-top: 6px;
}
#inventoryScreen .ff-inv2-cat-manage-sub + .ff-inv2-cat-manage-sub {
  margin-top: 0;
}
#inventoryScreen .ff-inv2-cat-manage-sub-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  margin: 0;
  padding: 1px 4px 1px 8px;
  min-height: unset;
  box-sizing: border-box;
  border-radius: 6px;
  transition: background 0.14s ease;
}
#inventoryScreen .ff-inv2-cat-manage-sub-row:hover {
  background: rgba(124, 58, 237, 0.07);
}
#inventoryScreen .ff-inv2-cat-manage-sub-name {
  font-size: 13px;
  color: #475569;
}
#inventoryScreen .ff-inv2-cat-manage-sub-name span {
  line-height: 1.1;
}
#inventoryScreen .ff-inv2-cat-manage-sub .ff-inv2-cat-manage-actions {
  gap: 2px 4px;
}
#inventoryScreen .ff-inv2-cat-manage-sub-row:hover .ff-inv2-cat-menu-trigger--sub {
  color: #5b21b6;
}
#inventoryScreen .ff-inv2-cat-menu-trigger--sub[aria-expanded="true"] {
  color: #5b21b6;
}
#inventoryScreen .ff-inv2-cat-manage-confirm {
  margin-top: 8px;
  padding: 8px 10px;
  font-size: 11px;
  color: #92400e;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
#inventoryScreen .ff-inv2-cat-manage-inline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
#inventoryScreen .ff-inv2-cat-manage-footer {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  padding: 12px 20px 18px;
  border-top: 1px solid #f1f5f9;
  background: #fafafa;
}
#inventoryScreen .ff-inv2-cat-manage-inline-newcat {
  margin-top: 0;
}
#inventoryScreen .ff-inv2-cat-manage-save {
  width: 100%;
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: #7c3aed;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(124, 58, 237, 0.2);
}
#inventoryScreen .ff-inv2-cat-manage-save:hover {
  background: #6d28d9;
}
#inventoryScreen .ff-inv2-cat-manage-save:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: 2px;
}
#inventoryScreen #ff-inv2-cat-delete-backdrop {
  z-index: 460;
}
#inventoryScreen .ff-inv2-cat-delete-modal-card {
  max-width: 400px;
}
#inventoryScreen .ff-inv2-cat-delete-extra {
  margin-top: 0;
}
#inventoryScreen .ff-inv2-cat-menu-wrap {
  position: relative;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-cat-menu-trigger {
  padding: 0;
  margin: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #94a3b8;
  font-size: 16px;
  line-height: 1;
  letter-spacing: 0.08em;
  cursor: pointer;
}
#inventoryScreen button.ff-inv2-cat-menu-trigger {
  width: 28px;
  height: 28px;
}
#inventoryScreen .ff-inv2-cat-menu-trigger--sub {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  min-width: 1.25em;
  padding: 2px 4px;
  border-radius: 4px;
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0.1em;
  color: #94a3b8;
  background: transparent;
  box-shadow: none;
  outline: none;
  transition: color 0.12s ease;
}
#inventoryScreen .ff-inv2-cat-menu-trigger--sub:focus {
  outline: none;
}
#inventoryScreen .ff-inv2-cat-menu-trigger--sub:focus-visible {
  outline: 2px solid rgba(124, 58, 237, 0.45);
  outline-offset: 1px;
}
#inventoryScreen .ff-inv2-cat-menu-trigger:hover:not(.ff-inv2-cat-menu-trigger--sub) {
  color: #64748b;
  background: transparent;
}
#inventoryScreen .ff-inv2-cat-menu-dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  min-width: 148px;
  padding: 4px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.12);
  z-index: 20;
}
#inventoryScreen .ff-inv2-cat-menu-item {
  display: block;
  width: 100%;
  padding: 8px 12px;
  margin: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  color: #334155;
  cursor: pointer;
}
#inventoryScreen .ff-inv2-cat-menu-item:hover {
  background: #f1f5f9;
}
#inventoryScreen .ff-inv2-cat-menu-item-danger {
  color: #b91c1c;
}
#inventoryScreen .ff-inv2-cat-menu-item-danger:hover {
  background: #fef2f2;
}
#ff-inv-undo-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 999999;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px 12px 20px;
  border-radius: 10px;
  background: #111827;
  color: #f8fafc;
  font-size: 14px;
  font-weight: 600;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.35);
  max-width: min(420px, 92vw);
  line-height: 1.35;
  pointer-events: auto;
}
#ff-inv-undo-toast .ff-inv-undo-toast-msg {
  flex: 1;
  min-width: 0;
}
#ff-inv-undo-toast .ff-inv-undo-toast-btn {
  flex-shrink: 0;
  margin: 0;
  padding: 6px 14px;
  border: none;
  border-radius: 8px;
  background: #e2e8f0;
  color: #0f172a;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
#ff-inv-undo-toast .ff-inv-undo-toast-btn:hover {
  background: #fff;
}
#ff-inv-undo-toast .ff-inv-undo-toast-btn:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: 2px;
}
`;
  document.head.appendChild(el);
}

function findSubMeta(subId) {
  if (!subId) return null;
  for (const c of getCategoryTree()) {
    for (const s of c.subcategories) {
      if (s.id === subId) return { category: c, sub: s };
    }
  }
  return null;
}

function getSelectedSubMeta() {
  const tree = getCategoryTree();
  const m = findSubMeta(_selectedSubcategoryId);
  if (m) return m;
  for (const c of tree) {
    const first = c.subcategories[0];
    if (first) {
      _selectedSubcategoryId = first.id;
      return { category: c, sub: first };
    }
  }
  return null;
}

function renderSidebarHtml() {
  if (_invCategoriesLoading) {
    return `<p class="ff-inv2-aside-loading">Loading categories…</p>`;
  }
  if (_invCatLoadError) {
    return `<p class="ff-inv2-aside-error">${escapeHtml(_invCatLoadError)}</p>`;
  }
  return getCategoryTree().map((cat) => {
    const open = _expandedCategoryIds.has(cat.id);
    const subs = cat.subcategories
      .map((sub) => {
        const active = sub.id === _selectedSubcategoryId;
        return `<div class="ff-inv2-sub${active ? " is-active" : ""}" data-sub-id="${escapeHtml(sub.id)}" role="button" tabindex="0">${escapeHtml(sub.name)}</div>`;
      })
      .join("");
    return `
<div class="ff-inv2-cat${open ? " is-open" : ""}" data-cat-id="${escapeHtml(cat.id)}">
  <div class="ff-inv2-cat-row" data-cat-toggle="${escapeHtml(cat.id)}">
    <span class="ff-inv2-chevron" aria-hidden="true">&#8250;</span>
    <span>${escapeHtml(cat.name)}</span>
  </div>
  <div class="ff-inv2-sub-list" style="display:${open ? "block" : "none"}">${subs}</div>
</div>`;
  }).join("");
}

function renderGroupHeaderTh(g) {
  const gid = g.id;
  const confirming = _groupRemoveConfirmId === gid;
  if (confirming) {
    const hasData = groupHasAnyValues(gid);
    const warn = hasData
      ? `<span class="ff-inv2-gh-warn">This will remove all values in this group</span>`
      : "";
    return `<th colspan="4" class="ff-inv2-gh ff-inv2-gh--confirming"><div class="ff-inv2-gh-inner ff-inv2-gh-inner--confirm">
  <input class="ff-inv2-gh-input" type="text" data-inv="group-label" data-group-id="${escapeHtml(gid)}" value="${escapeHtml(g.label)}" aria-label="Group name" />
  <div class="ff-inv2-gh-confirm-bar">
    ${warn}
    <div class="ff-inv2-gh-confirm-actions">
      <button type="button" class="ff-inv2-gh-btn ff-inv2-gh-btn-cancel" data-inv-remove-cancel="1">Cancel</button>
      <button type="button" class="ff-inv2-gh-btn ff-inv2-gh-btn-danger" data-inv-remove-modal="${escapeHtml(gid)}">Remove group</button>
    </div>
  </div>
</div>${thResizeHandle("group", `data-group-id="${escapeHtml(gid)}"`)}</th>`;
  }
  return `<th colspan="4" class="ff-inv2-gh"><div class="ff-inv2-gh-inner"><input class="ff-inv2-gh-input" type="text" data-inv="group-label" data-group-id="${escapeHtml(gid)}" value="${escapeHtml(g.label)}" aria-label="Group name" /><button type="button" class="ff-inv2-gh-remove" data-inv-remove-start="${escapeHtml(gid)}" title="Remove group" aria-label="Start removing group">×</button></div>${thResizeHandle("group", `data-group-id="${escapeHtml(gid)}"`)}</th>`;
}

function renderRemoveGroupModal() {
  const gid = _groupRemoveModalGroupId;
  if (!gid) return "";
  return `<div class="ff-inv2-modal-backdrop" id="ff-inv2-group-remove-modal" role="dialog" aria-modal="true" aria-labelledby="ff-inv2-group-remove-title">
  <div class="ff-inv2-modal-card">
    <h3 id="ff-inv2-group-remove-title" class="ff-inv2-modal-title">Are you sure you want to remove this group?</h3>
    <p class="ff-inv2-modal-hint">This action cannot be undone.</p>
    <div class="ff-inv2-modal-actions">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-inv-modal-cancel="1">Cancel</button>
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-danger" data-inv-modal-commit="${escapeHtml(gid)}">Yes, remove group</button>
    </div>
  </div>
</div>`;
}

function renderCategoryRowMenu(catId, subId) {
  const isSub = subId != null && subId !== "";
  const key = isSub ? `sub:${catId}:${subId}` : `cat:${catId}`;
  const open = _catMenuKey === key;
  const trig = isSub
    ? `data-cat-menu-trigger="sub" data-cat-id="${escapeHtml(catId)}" data-sub-id="${escapeHtml(subId)}"`
    : `data-cat-menu-trigger="cat" data-cat-id="${escapeHtml(catId)}"`;
  const ren = isSub
    ? `data-cat-menu-rename="sub" data-cat-id="${escapeHtml(catId)}" data-sub-id="${escapeHtml(subId)}"`
    : `data-cat-menu-rename="cat" data-cat-id="${escapeHtml(catId)}"`;
  const del = isSub
    ? `data-cat-menu-delete="sub" data-cat-id="${escapeHtml(catId)}" data-sub-id="${escapeHtml(subId)}"`
    : `data-cat-menu-delete="cat" data-cat-id="${escapeHtml(catId)}"`;
  const trigger = isSub
    ? `<span role="button" tabindex="0" draggable="false" class="ff-inv2-cat-menu-trigger ff-inv2-cat-menu-trigger--sub" aria-label="More actions" aria-expanded="${open ? "true" : "false"}" ${trig}>⋯</span>`
    : `<button type="button" draggable="false" class="ff-inv2-cat-menu-trigger" aria-label="More actions" aria-expanded="${open ? "true" : "false"}" ${trig}>⋯</button>`;
  return `<div class="ff-inv2-cat-menu-wrap">
  ${trigger}
  <div class="ff-inv2-cat-menu-dropdown" style="display:${open ? "block" : "none"}" role="menu">
    <button type="button" draggable="false" class="ff-inv2-cat-menu-item" role="menuitem" ${ren}>Rename</button>
    <button type="button" draggable="false" class="ff-inv2-cat-menu-item ff-inv2-cat-menu-item-danger" role="menuitem" ${del}>Delete</button>
  </div>
</div>`;
}

function renderManageSubRow(cat, sub) {
  const key = `${cat.id}:${sub.id}`;
  const subRenaming = _renameSubKey === key;
  const openRenameSub = `data-cat-id="${escapeHtml(cat.id)}" data-sub-id="${escapeHtml(sub.id)}"`;
  const dragAttr = subRenaming ? `draggable="false"` : `draggable="true"`;
  return `<div class="ff-inv2-cat-manage-sub" ${dragAttr} data-cat-dnd="sub" data-cat-manage-sub="1" data-cat-id="${escapeHtml(cat.id)}" data-sub-id="${escapeHtml(sub.id)}">
  <div class="ff-inv2-cat-manage-sub-row">
    <div class="ff-inv2-cat-manage-sub-name">
      ${
        subRenaming
          ? `<input type="text" draggable="false" class="ff-inv2-cat-manage-input" data-cat-rename-input="sub" ${openRenameSub} value="${escapeHtml(sub.name)}" />`
          : `<span>${escapeHtml(sub.name)}</span>`
      }
    </div>
    <div class="ff-inv2-cat-manage-actions">
      ${
        subRenaming
          ? `<button type="button" draggable="false" class="ff-inv2-cat-manage-mini" data-cat-rename-save="sub" ${openRenameSub}>Save</button><button type="button" draggable="false" class="ff-inv2-cat-manage-mini" data-cat-rename-cancel="sub">Cancel</button>`
          : renderCategoryRowMenu(cat.id, sub.id)
      }
    </div>
  </div>
</div>`;
}

function renderInlineNewSub(catId) {
  return `<div class="ff-inv2-cat-manage-inline">
  <input type="text" class="ff-inv2-cat-manage-input" placeholder="Subcategory name" data-cat-new-sub-input="${escapeHtml(catId)}" />
  <button type="button" class="ff-inv2-cat-manage-mini" data-cat-new-sub-commit="${escapeHtml(catId)}">Add</button>
  <button type="button" class="ff-inv2-cat-manage-mini" data-cat-new-sub-cancel="1">Cancel</button>
</div>`;
}

function renderManageCategoryBlock(cat) {
  const catId = cat.id;
  const renameCat = _renameCatId === catId;
  const showSubInput = _inlineNewSubCatId === catId;
  const subsHtml = cat.subcategories.map((s) => renderManageSubRow(cat, s)).join("");
  return `<div class="ff-inv2-cat-manage-block" data-cat-manage-block="1" data-cat-id="${escapeHtml(catId)}">
  <div class="ff-inv2-cat-manage-cat-row">
    <div class="ff-inv2-cat-manage-cat-name">
      ${
        renameCat
          ? `<input type="text" draggable="false" class="ff-inv2-cat-manage-input" data-cat-rename-input="cat" data-cat-id="${escapeHtml(catId)}" value="${escapeHtml(cat.name)}" />`
          : `<div class="ff-inv2-cat-manage-cat-drag" draggable="true" data-cat-dnd="cat" data-cat-id="${escapeHtml(catId)}" title="Drag to reorder category"><span class="ff-inv2-cat-manage-cat-text">${escapeHtml(cat.name)}</span></div>`
      }
    </div>
    <div class="ff-inv2-cat-manage-actions">
      ${
        renameCat
          ? `<button type="button" draggable="false" class="ff-inv2-cat-manage-mini" data-cat-rename-save="cat" data-cat-id="${escapeHtml(catId)}">Save</button><button type="button" draggable="false" class="ff-inv2-cat-manage-mini" data-cat-rename-cancel="cat">Cancel</button>`
          : `${renderCategoryRowMenu(catId, null)}<button type="button" draggable="false" class="ff-inv2-cat-manage-mini" data-cat-add-sub-open="${escapeHtml(catId)}">+ Add Subcategory</button>`
      }
    </div>
  </div>
  <div class="ff-inv2-cat-manage-subs">${subsHtml}${showSubInput ? renderInlineNewSub(catId) : ""}</div>
</div>`;
}

function renderManageCategoriesFooter() {
  const inlineNewCat = _inlineNewCat
    ? `<div class="ff-inv2-cat-manage-inline ff-inv2-cat-manage-inline-newcat">
    <input type="text" class="ff-inv2-cat-manage-input" placeholder="Category name" data-cat-new-cat-input="1" />
    <button type="button" class="ff-inv2-cat-manage-mini" data-cat-new-cat-commit="1">Add</button>
    <button type="button" class="ff-inv2-cat-manage-mini" data-cat-new-cat-cancel="1">Cancel</button>
  </div>`
    : "";
  const saveBusy = _catSaveBusy ? " disabled" : "";
  const saveLabel = _catSaveBusy ? "Saving…" : "Save";
  return `<div class="ff-inv2-cat-manage-footer">
  ${inlineNewCat}
  <button type="button" class="ff-inv2-cat-manage-save" data-cat-manage-save="1"${saveBusy}>${saveLabel}</button>
</div>`;
}

function renderManageCategoriesModal() {
  if (!_manageCategoriesOpen) return "";
  ensureCatManageDraft();
  const tree = _catManageDraftTree || getCategoryTree();
  const blocks = tree.map((c) => renderManageCategoryBlock(c)).join("");
  return `<div class="ff-inv2-modal-backdrop ff-inv2-cat-manage-backdrop" id="ff-inv2-cat-manage-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv2-cat-manage-title">
  <div class="ff-inv2-modal-card ff-inv2-cat-manage-card">
    <div class="ff-inv2-cat-manage-head">
      <div class="ff-inv2-cat-manage-head-main">
        <div class="ff-inv2-cat-manage-title-row">
          <h2 id="ff-inv2-cat-manage-title" class="ff-inv2-cat-manage-h2">Manage Categories</h2>
          <button type="button" class="ff-inv2-cat-manage-add-head" data-cat-inline-newcat="1">+ Add Category</button>
        </div>
      </div>
      <button type="button" class="ff-inv2-cat-manage-close" data-cat-manage-close="1" aria-label="Close">×</button>
    </div>
    <p class="ff-inv2-cat-manage-subtitle">Save to sync categories and subcategories to the cloud for this salon.</p>
    <div class="ff-inv2-cat-manage-body">${blocks || `<p class="ff-inv2-cat-manage-empty">No categories yet. Use + Add Category above.</p>`}</div>
    ${renderManageCategoriesFooter()}
  </div>
</div>`;
}

function renderCategoryDeleteConfirmModal() {
  if (!_catDeleteModal) return "";
  const d = _catDeleteModal;
  const extra =
    d.kind === "cat"
      ? `<p class="ff-inv2-modal-hint ff-inv2-cat-delete-extra">This will also remove all subcategories inside it.</p>`
      : "";
  return `<div class="ff-inv2-modal-backdrop" id="ff-inv2-cat-delete-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv2-cat-delete-title">
  <div class="ff-inv2-modal-card ff-inv2-cat-delete-modal-card">
    <h3 id="ff-inv2-cat-delete-title" class="ff-inv2-modal-title">Delete ${escapeHtml(d.name)}?</h3>
    <p class="ff-inv2-modal-hint">This will permanently remove this item and all related data. This action cannot be undone.</p>
    ${extra}
    <div class="ff-inv2-modal-actions">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-cat-delete-modal-cancel="1">Cancel</button>
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-danger" data-cat-delete-modal-commit="1">Delete</button>
    </div>
  </div>
</div>`;
}

function renderTableHeaderHtml() {
  if (_groups === null) return "";
  const w = getInvColWidths();
  const groupCells = _groups.map((g) => renderGroupHeaderTh(g)).join("");
  const subHeaders = _groups
    .map((g) => {
      const cw = w.groupSubById[g.id] ?? 72;
      return `<th class="ff-inv2-subh" style="width:${cw}px;min-width:${cw}px">Stock</th><th class="ff-inv2-subh" style="width:${cw}px;min-width:${cw}px">Current</th><th class="ff-inv2-subh" style="width:${cw}px;min-width:${cw}px">Order</th><th class="ff-inv2-subh" style="width:${cw}px;min-width:${cw}px">Price</th>`;
    })
    .join("");
  return `
${renderColgroup()}
<thead>
  <tr>
    <th rowspan="2" class="ff-inv2-th-dnd" aria-hidden="true"></th>
    <th rowspan="2" class="ff-inv2-th-num" title="#"><span class="ff-inv2-th-inner">#</span>${thResizeHandle("hash")}</th>
    <th rowspan="2" class="ff-inv2-th-code">Code${thResizeHandle("code")}</th>
    <th rowspan="2" class="ff-inv2-th-name">Name${thResizeHandle("name")}</th>
    ${groupCells}
    <th rowspan="2" class="ff-inv2-th-supplier">Supplier${thResizeHandle("supplier")}</th>
    <th rowspan="2" class="ff-inv2-th-url">URL${thResizeHandle("url")}</th>
  </tr>
  <tr>${subHeaders}</tr>
</thead>`;
}

function rowGroupCells(row) {
  if (_groups === null) return "";
  return _groups
    .map((g) => {
      const v = row.byGroup[g.id] || { stock: 0, current: 0, price: "", approved: 0, approvedRequests: [] };
      const { approved } = getCellApprovedInfo(v);
      const order = computeOrder(v.stock, v.current, approved);
      const rid = row.id;
      const gid = g.id;
      return `<td class="ff-inv2-td-numcell">${renderEditableCell("stock", rid, v.stock, { groupId: gid, inputMode: "decimal" })}</td>
<td class="ff-inv2-td-numcell">${renderEditableCell("current", rid, v.current, { groupId: gid, inputMode: "decimal" })}</td>
${renderOrderCellTd(rid, gid, order, approved)}
<td class="ff-inv2-td-numcell ff-inv2-td-price"><span class="ff-inv2-price-symbol" aria-hidden="true">${escapeHtml(typeof window !== "undefined" && typeof window.ffGetCurrencySymbol === "function" ? window.ffGetCurrencySymbol() : "$")}</span>${renderEditableCell("price", rid, v.price, { groupId: gid, inputMode: "decimal" })}</td>`;
    })
    .join("");
}

function renderTableBodyHtml() {
  if (_invTableLoading) {
    return `<tr class="ff-inv2-data-row ff-inv2-table-loading-row"><td colspan="99" class="ff-inv2-td-num">Loading table…</td></tr>`;
  }
  if (_rows === null) return "";
  return _rows
    .map((row) => {
      const rid = row.id;
      const noVal = row.rowNo != null ? String(row.rowNo) : "";
      return `<tr class="ff-inv2-data-row" data-inv-row-id="${escapeHtml(rid)}">
  <td class="ff-inv2-td-dnd">
    <button type="button" class="ff-inv2-row-dnd-handle" draggable="true" data-inv-row-dnd="1" data-row-id="${escapeHtml(rid)}" aria-label="Drag to reorder row" title="Drag to reorder"></button>
  </td>
  <td class="ff-inv2-num ff-inv2-td-num ff-inv2-td-no">
    <div class="ff-inv2-td-no-inner">
    <button type="button" draggable="false" class="ff-inv2-row-kebab" data-inv-row-menu-trigger="${escapeHtml(rid)}" aria-label="Row actions" title="Row actions">⋯</button>
    <span class="ff-inv2-row-no-wrap">${renderEditableCell("rowNo", rid, noVal, { classNames: "ff-inv2-no-input", inputMode: "numeric" })}</span>
    </div>
  </td>
  <td class="ff-inv2-td-code">${renderEditableCell("code", rid, row.code, { mono: true, classNames: "ff-inv2-code-input" })}</td>
  <td class="ff-inv2-td-name">${renderEditableCell("name", rid, row.name, { classNames: "ff-inv2-name-input" })}</td>
  ${rowGroupCells(row)}
  <td class="ff-inv2-td-text ff-inv2-td-supplier">${renderEditableCell("supplier", rid, row.supplier, {})}</td>
  <td class="ff-inv2-td-text ff-inv2-td-url">${renderUrlCell(rid, row.url)}</td>
</tr>`;
    })
    .join("");
}

function renderInventoryOrderCellBreakdownModal() {
  if (!_invOrderCellBreakdownModal) return "";
  const { rowId, groupId, busy } = _invOrderCellBreakdownModal;
  const row = Array.isArray(_rows) ? _rows.find((r) => r.id === rowId) : null;
  const group = Array.isArray(_groups) ? _groups.find((g) => g.id === groupId) : null;
  if (!row || !group) return "";
  const cell = row.byGroup && row.byGroup[groupId] ? row.byGroup[groupId] : null;
  if (!cell) return "";
  const stock = typeof cell.stock === "number" ? cell.stock : parseNum(cell.stock);
  const current = typeof cell.current === "number" ? cell.current : parseNum(cell.current);
  const auto = Math.max(0, stock - current);
  const { approved, approvedRequests } = getCellApprovedInfo(cell);
  const total = auto + Math.max(0, approved);
  const subMeta = getSelectedSubMeta();
  const contextParts = [];
  if (subMeta && subMeta.category && subMeta.category.name != null) contextParts.push(String(subMeta.category.name));
  if (subMeta && subMeta.sub && subMeta.sub.name != null) contextParts.push(String(subMeta.sub.name));
  if (row.name) contextParts.push(String(row.name));
  if (group.label) contextParts.push(String(group.label));
  const contextLabel = contextParts.join(" · ");
  const disabled = busy ? " disabled" : "";

  const entries =
    approvedRequests.length === 0
      ? `<p class="ff-inv2-ord-breakdown-empty">No approved supply requests yet.</p>`
      : `<div class="ff-inv2-ord-breakdown-list">${approvedRequests
          .map((e, idx) => {
            const qtyLabel = `+${escapeHtml(formatOrderDisplay(e.qty))}${e.unit ? ` ${escapeHtml(String(e.unit))}` : ""}`;
            const who = e.byName ? String(e.byName) : e.by ? `UID ${String(e.by).slice(0, 6)}…` : "Manager";
            const itemDisp = e.itemName ? String(e.itemName) : "Supply request";
            const whenDisp =
              e.at && typeof e.at.toDate === "function"
                ? formatInventoryOrderCreatedAt(e.at)
                : typeof e.at === "object" && e.at && "seconds" in e.at
                  ? formatInventoryOrderCreatedAt(e.at)
                  : "";
            const noteHtml = e.note ? `<div class="ff-inv2-ord-breakdown-entry-meta">"${escapeHtml(String(e.note))}"</div>` : "";
            return `<div class="ff-inv2-ord-breakdown-entry" data-idx="${idx}">
  <div class="ff-inv2-ord-breakdown-entry-main">
    <div><span class="ff-inv2-ord-breakdown-entry-qty">${qtyLabel}</span> <span style="color:#0f172a;font-weight:500;">${escapeHtml(itemDisp)}</span></div>
    <div class="ff-inv2-ord-breakdown-entry-meta">By ${escapeHtml(who)}${whenDisp ? ` · ${escapeHtml(whenDisp)}` : ""}</div>
    ${noteHtml}
  </div>
  <button type="button" class="ff-inv2-ord-breakdown-remove" data-inv-ord-breakdown-remove="${escapeHtml(String(e.requestId))}" aria-label="Remove contribution" title="Remove"${disabled}>🗑</button>
</div>`;
          })
          .join("")}</div>`;

  return `<div class="ff-inv2-modal-backdrop" id="ff-inv-ord-breakdown-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv-ord-breakdown-title">
  <div class="ff-inv2-modal-card">
    <h3 id="ff-inv-ord-breakdown-title" class="ff-inv2-modal-title">Order breakdown</h3>
    ${contextLabel ? `<p class="ff-inv2-modal-hint" style="margin-bottom:12px;">${escapeHtml(contextLabel)}</p>` : ""}
    <dl class="ff-inv2-ord-breakdown-dl">
      <dt>Auto (Stock − Current)</dt><dd>${escapeHtml(formatOrderDisplay(auto))}</dd>
      <dt>Approved (supply requests)</dt><dd>${escapeHtml(formatOrderDisplay(Math.max(0, approved)))}</dd>
      <dt>Total order</dt><dd class="ff-inv2-ord-breakdown-total">${escapeHtml(formatOrderDisplay(total))}</dd>
    </dl>
    <div class="ff-inv2-ord-breakdown-section">
      <p class="ff-inv2-ord-breakdown-section-title">Approved contributions</p>
      ${entries}
    </div>
    <div class="ff-inv2-modal-actions">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-primary" data-inv-ord-breakdown-close="1">Close</button>
    </div>
  </div>
</div>`;
}

async function removeApprovedContributionForCell(rowId, groupId, requestId) {
  if (!rowId || !groupId || !requestId) return;
  const subMeta = getSelectedSubMeta();
  if (!subMeta) {
    inventoryOrderDraftToast("No subcategory selected.", "error");
    return;
  }
  const catId = String(subMeta.category.id);
  const subId = String(subMeta.sub.id);
  if (_invOrderCellBreakdownModal) {
    _invOrderCellBreakdownModal = { ..._invOrderCellBreakdownModal, busy: true };
    mountOrRefreshMockUi();
  }
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    const subRef = doc(db, `salons/${salonId}/inventoryCategories/${catId}/inventorySubcategories/${subId}`);
    let touchedRequestIds = [];
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(subRef);
      if (!snap.exists()) throw new Error("SUB_MISSING");
      const data = snap.data();
      const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
      const rowsNorm = rowsRaw.map((r) => normalizeRowFromFirestore(r));
      const row = rowsNorm.find((r) => r.id === rowId);
      if (!row) throw new Error("ROW_MISSING");
      const cell = row.byGroup && row.byGroup[groupId];
      if (!cell) throw new Error("CELL_MISSING");
      const before = Array.isArray(cell.approvedRequests) ? cell.approvedRequests.slice() : [];
      cell.approvedRequests = before.filter((e) => String(e.requestId) !== String(requestId));
      touchedRequestIds = before
        .filter((e) => String(e.requestId) === String(requestId))
        .map((e) => String(e.requestId));
      if (touchedRequestIds.length === 0) return;
      cell.approved = cell.approvedRequests.reduce((acc, e) => acc + (Number(e.qty) || 0), 0);
      const rowsPayload = rowsNorm.map((r) => serializeInventoryRowForFirestore(r));
      transaction.update(subRef, { rows: rowsPayload, updatedAt: serverTimestamp() });
    });

    for (const rid of touchedRequestIds) {
      try {
        const ref = doc(db, `salons/${salonId}/inboxItems`, rid);
        await updateDoc(ref, { appliedToInventory: false, appliedToInventoryAt: null, updatedAt: serverTimestamp() });
      } catch (e) {
        console.warn("[Inventory] clear applied flag on inbox item failed", rid, e);
      }
    }

    inventoryOrderDraftToast("Contribution removed.", "success");
    _invOrderCellBreakdownModal = null;
    const key = `${catId}:${subId}`;
    if (_invTableLoadedForSubId === key) {
      const seq = ++_invTableLoadSeq;
      _invTableLoading = true;
      mountOrRefreshMockUi();
      void loadInventoryTableForSub(catId, subId, seq, key);
    } else {
      mountOrRefreshMockUi();
    }
  } catch (e) {
    console.error("[Inventory] remove approved contribution failed", e);
    inventoryOrderDraftToast("Could not remove contribution.", "error");
    if (_invOrderCellBreakdownModal) {
      _invOrderCellBreakdownModal = { ..._invOrderCellBreakdownModal, busy: false };
      mountOrRefreshMockUi();
    }
  }
}

function renderInvRowMenu() {
  if (!_invRowMenu) return "";
  const m = _invRowMenu;
  const rid = escapeHtml(m.rowId);
  return `<div class="ff-inv2-row-menu-backdrop" data-inv-row-menu-dismiss="1" aria-hidden="true"></div>
<div class="ff-inv2-row-menu" role="menu" style="left:${m.left}px;top:${m.top}px">
  <button type="button" class="ff-inv2-row-menu-item" role="menuitem" data-inv-row-action="edit" data-row-id="${rid}">Edit row</button>
  <button type="button" class="ff-inv2-row-menu-item" role="menuitem" data-inv-row-action="duplicate" data-row-id="${rid}">Duplicate row</button>
  <button type="button" class="ff-inv2-row-menu-item ff-inv2-row-menu-item--danger" role="menuitem" data-inv-row-action="delete" data-row-id="${rid}">Delete row</button>
</div>`;
}

/**
 * Toggle the Bought (B) quantity for a shopping row driven by its checkbox.
 * "Got exactly what's needed" — B = 0 → N (check), B = N or complete → 0 (uncheck),
 * partial B (0 < B < N) → complete to N.
 */
function toggleShoppingRowQty(oid, idx) {
  const o = _invOrdersList.find((x) => x.id === oid);
  if (!o) return;
  const items = Array.isArray(o.items) ? o.items : [];
  const it = items[idx];
  if (!it) return;
  const N = getItemOrderQty(it);
  ensureShoppingDraft(oid);
  const shop = _invOrderShoppingDraft[oid];
  if (!shop) return;
  if (!Array.isArray(shop.qtyBought)) shop.qtyBought = [];
  if (!Array.isArray(shop.checked)) shop.checked = [];
  const B = parseNum(shop.qtyBought[idx]);
  let newB;
  if (B === 0) {
    newB = N > 0 ? N : 0;
  } else if (N > 0 && B >= N) {
    newB = 0;
  } else {
    newB = N > 0 ? N : 0;
  }
  shop.qtyBought[idx] = newB > 0 ? String(newB) : "";
  shop.checked[idx] = newB > 0;
  mountOrRefreshMockUi();
}

function handleOrderBuilderSourceChange(ev) {
  const root = document.getElementById("inventoryScreen");
  const t = ev.target;
  if (!(t instanceof HTMLInputElement) || !root || !root.contains(t)) return;
  if (t.hasAttribute("data-inv-shopping-check")) {
    const oid = t.getAttribute("data-order-id");
    const idxStr = t.getAttribute("data-line-idx");
    if (oid != null && idxStr != null) {
      toggleShoppingRowQty(oid, Number(idxStr));
    }
    return;
  }
  if (t.hasAttribute("data-inv-order-receipt-file")) {
    const oid = t.getAttribute("data-order-id");
    const f = t.files && t.files[0];
    t.value = "";
    if (oid && f) {
      void handleInventoryOrderReceiptFileSelected(root, oid, f);
    }
    return;
  }
  if (t.hasAttribute("data-inv-ob-cat")) {
    const catId = t.getAttribute("data-inv-ob-cat");
    if (!catId) return;
    const cat = getCategoryTree().find((c) => c.id === catId);
    if (!cat) return;
    const subs = cat.subcategories || [];
    if (t.checked) {
      for (const s of subs) _invOrderBuilderCustomSubIds.add(s.id);
    } else {
      for (const s of subs) _invOrderBuilderCustomSubIds.delete(s.id);
    }
    scheduleInventoryOrderDraftSave();
    mountOrRefreshMockUi();
    void refreshOrderBuilderPreviewAsync();
    return;
  }
  if (t.hasAttribute("data-inv-ob-sub")) {
    const val = t.getAttribute("data-inv-ob-sub");
    if (!val) return;
    const colon = val.indexOf(":");
    if (colon < 0) return;
    const subId = val.slice(colon + 1);
    if (t.checked) _invOrderBuilderCustomSubIds.add(subId);
    else _invOrderBuilderCustomSubIds.delete(subId);
    scheduleInventoryOrderDraftSave();
    mountOrRefreshMockUi();
    void refreshOrderBuilderPreviewAsync();
  }
}

function renderDeleteRowModal() {
  if (!_invRowDeleteModalRowId) return "";
  const rid = escapeHtml(_invRowDeleteModalRowId);
  return `<div class="ff-inv2-modal-backdrop" id="ff-inv2-row-delete-modal" role="dialog" aria-modal="true" aria-labelledby="ff-inv2-row-delete-title">
  <div class="ff-inv2-modal-card">
    <h3 id="ff-inv2-row-delete-title" class="ff-inv2-modal-title">Delete row?</h3>
    <p class="ff-inv2-modal-hint">This will remove all values in this row.</p>
    <div class="ff-inv2-modal-actions">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-inv-row-delete-cancel="1">Cancel</button>
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-danger" data-inv-row-delete-commit="1" data-row-id="${rid}">Delete</button>
    </div>
  </div>
</div>`;
}

/**
 * Long-press (~500ms) on an Order Details row opens Line details. Normal tap still toggles ✓ via row click.
 * Eats the next click on that row so the release after long-press does not toggle the checkbox.
 */
function bindOrderDetailRowLongPressOnce(root) {
  if (root.dataset.ffInvOdLongPress === "1") return;
  root.dataset.ffInvOdLongPress = "1";
  /** @type {{ timer: ReturnType<typeof setTimeout>, x: number, y: number } | null } */
  let state = null;

  function clear() {
    if (state && state.timer) clearTimeout(state.timer);
    state = null;
  }

  root.addEventListener(
    "pointerdown",
    (ev) => {
      const tgt =
        ev.target instanceof Element ? ev.target : ev.target instanceof Text ? ev.target.parentElement : null;
      if (!tgt) return;
      const tr = tgt.closest("[data-inv-detail-shopping-row]");
      if (!tr || !root.contains(tr)) return;
      if (tgt.closest("input,label,button,a,textarea,select")) return;
      if (ev.button !== 0) return;
      const idxStr = tr.getAttribute("data-line-idx");
      if (idxStr == null || _invOrdersDetailOrderId == null) return;
      clear();
      const x = ev.clientX;
      const y = ev.clientY;
      const timer = window.setTimeout(() => {
        state = null;
        _invOrderDetailLineViewIdx = Number(idxStr);
        const kill = (cev) => {
          document.removeEventListener("click", kill, true);
          const el =
            cev.target instanceof Element
              ? cev.target
              : cev.target instanceof Text
                ? cev.target.parentElement
                : null;
          if (!el) return;
          const row = el.closest("[data-inv-detail-shopping-row]");
          if (row && row.getAttribute("data-line-idx") === idxStr) {
            cev.preventDefault();
            cev.stopPropagation();
            cev.stopImmediatePropagation();
          }
        };
        document.addEventListener("click", kill, true);
        window.setTimeout(() => {
          document.removeEventListener("click", kill, true);
        }, 900);
        mountOrRefreshMockUi();
      }, 500);
      state = { timer, x, y };
    },
    true
  );

  root.addEventListener(
    "pointermove",
    (ev) => {
      if (!state) return;
      const d = Math.hypot(ev.clientX - state.x, ev.clientY - state.y);
      if (d > 14) clear();
    },
    true
  );

  root.addEventListener("pointerup", () => clear(), true);
  root.addEventListener("pointercancel", () => clear(), true);
}

/**
 * Long-press (~500ms) on an inventory Order cell opens the breakdown modal.
 * Eats the next click so short release doesn't bubble up.
 */
function bindInventoryOrderCellLongPressOnce(root) {
  if (root.dataset.ffInvOrdCellLongPress === "1") return;
  root.dataset.ffInvOrdCellLongPress = "1";
  /** @type {{ timer: ReturnType<typeof setTimeout>, x: number, y: number } | null} */
  let state = null;

  function clear() {
    if (state && state.timer) clearTimeout(state.timer);
    state = null;
  }

  root.addEventListener(
    "pointerdown",
    (ev) => {
      const tgt =
        ev.target instanceof Element ? ev.target : ev.target instanceof Text ? ev.target.parentElement : null;
      if (!tgt) return;
      const td = tgt.closest("td.ff-inv2-order-cell");
      if (!td || !root.contains(td)) return;
      if (ev.button !== 0) return;
      const rowId = td.getAttribute("data-order-for-row");
      const groupId = td.getAttribute("data-order-for-group");
      if (!rowId || !groupId) return;
      clear();
      const x = ev.clientX;
      const y = ev.clientY;
      const timer = window.setTimeout(() => {
        state = null;
        _invOrderCellBreakdownModal = { rowId, groupId, busy: false };
        const kill = (cev) => {
          document.removeEventListener("click", kill, true);
          const el =
            cev.target instanceof Element
              ? cev.target
              : cev.target instanceof Text
                ? cev.target.parentElement
                : null;
          if (!el) return;
          const cellAgain = el.closest("td.ff-inv2-order-cell");
          if (
            cellAgain &&
            cellAgain.getAttribute("data-order-for-row") === rowId &&
            cellAgain.getAttribute("data-order-for-group") === groupId
          ) {
            cev.preventDefault();
            cev.stopPropagation();
            cev.stopImmediatePropagation();
          }
        };
        document.addEventListener("click", kill, true);
        window.setTimeout(() => {
          document.removeEventListener("click", kill, true);
        }, 900);
        mountOrRefreshMockUi();
      }, 500);
      state = { timer, x, y };
    },
    true
  );

  root.addEventListener(
    "pointermove",
    (ev) => {
      if (!state) return;
      const d = Math.hypot(ev.clientX - state.x, ev.clientY - state.y);
      if (d > 14) clear();
    },
    true
  );

  root.addEventListener("pointerup", () => clear(), true);
  root.addEventListener("pointercancel", () => clear(), true);
}

function ensureInventoryScreenDelegates(root) {
  if (root.dataset.ffInvDelegates === "1") return;
  root.dataset.ffInvDelegates = "1";
  ensureInvEditDocListenerOnce();
  bindInvColumnResizeOnce();
  bindCatManageDnDOnce(root);
  bindInvRowDnDOnce(root);
  bindOrderDetailRowLongPressOnce(root);
  bindInventoryOrderCellLongPressOnce(root);
  /** Order Details: one reliable path for checkbox taps (iOS often fails on invisible native input). */
  root.addEventListener(
    "click",
    (ev) => {
      const t = ev.target;
      if (!(t instanceof Node)) return;
      const label = typeof t.closest === "function" ? t.closest(".ff-inv2-od-shopping-check-label") : null;
      if (!label || !root.contains(label)) return;
      const cb = label.querySelector("input[data-inv-shopping-check]");
      if (!(cb instanceof HTMLInputElement) || cb.disabled) return;
      ev.preventDefault();
      ev.stopPropagation();
      const oid = cb.getAttribute("data-order-id");
      const idxStr = cb.getAttribute("data-line-idx");
      if (oid != null && idxStr != null) {
        toggleShoppingRowQty(oid, Number(idxStr));
      }
    },
    true
  );
  root.addEventListener("input", handleInventoryInput);
  root.addEventListener("change", handleOrderBuilderSourceChange);
  root.addEventListener("keydown", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const row = t.closest("[data-inv-order-row]");
    if (!row || !root.contains(row)) return;
    if (t.closest("[data-inv-orders-actions]") || t.closest("[data-inv-orders-menu-trigger]")) return;
    if (ev.key !== "Enter" && ev.key !== " ") return;
    ev.preventDefault();
    const oid = row.getAttribute("data-inv-order-id");
    if (oid) {
      if (_invOrdersDetailOrderId != null && _invOrdersDetailOrderId !== oid) {
        _invOrderDetailFilter = "all";
      }
      _invOrdersDetailOrderId = oid;
      mountOrRefreshMockUi();
    }
  });
  root.addEventListener("contextmenu", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const tr = t.closest("tbody tr[data-inv-row-id]");
    if (!tr || !root.contains(tr)) return;
    const rowId = tr.getAttribute("data-inv-row-id");
    if (!rowId) return;
    ev.preventDefault();
    const menuW = 180;
    const menuH = 120;
    let left = ev.clientX;
    let top = ev.clientY;
    left = Math.min(left, window.innerWidth - menuW - 8);
    top = Math.min(top, window.innerHeight - menuH - 8);
    left = Math.max(8, left);
    top = Math.max(8, top);
    _invRowMenu = { rowId, left, top };
    mountOrRefreshMockUi();
  });
  root.addEventListener("mousedown", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const btn = t.closest("[data-inv-url-edit]");
    if (!btn || !root.contains(btn)) return;
    ev.preventDefault();
  });
  root.addEventListener("focusout", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (t.getAttribute("data-inv") !== "url") return;
    if (!t.classList.contains("ff-inv2-cell-input--editing")) return;
    const key = t.getAttribute("data-edit-key");
    if (!key) return;
    const rel = ev.relatedTarget;
    if (rel instanceof HTMLElement) {
      const pen = rel.closest("[data-inv-url-edit]");
      if (pen && pen.getAttribute("data-row-id") === t.getAttribute("data-row-id")) return;
    }
    setTimeout(() => {
      if (_editCellKey !== key) return;
      if (document.activeElement === t) return;
      handleInventoryInput({ target: t });
      _editCellKey = null;
      mountOrRefreshMockUi();
    }, 0);
  });
  root.addEventListener("keydown", (ev) => {
    if (
      ev.key === "Enter" &&
      ev.target instanceof HTMLInputElement &&
      ev.target.hasAttribute("data-inv-orders-rename-input") &&
      _invOrdersRenameModal &&
      !_invOrdersRenameModal.busy
    ) {
      ev.preventDefault();
      void renameInventoryOrderConfirmed(_invOrdersRenameModal.orderId, ev.target.value);
      return;
    }
    if (
      ev.key === "Enter" &&
      ev.target instanceof HTMLInputElement &&
      ev.target.hasAttribute("data-inv-ob-add-input") &&
      _invOrderBuilderAddModal
    ) {
      ev.preventDefault();
      commitInventoryOrderBuilderAddItem();
      return;
    }
    if (ev.key === "Enter" && ev.target instanceof HTMLInputElement && ev.target.classList.contains("ff-inv2-cell-input--editing")) {
      ev.preventDefault();
      handleInventoryInput({ target: ev.target });
      _editCellKey = null;
      mountOrRefreshMockUi();
      return;
    }
    if (ev.key === "Enter" || ev.key === " ") {
      const t = ev.target;
      if (t instanceof HTMLElement) {
        const trig = t.closest('[data-cat-menu-trigger][role="button"]');
        if (trig) {
          ev.preventDefault();
          trig.click();
          return;
        }
        if (t.hasAttribute("data-inv-cell")) {
          ev.preventDefault();
          t.click();
          return;
        }
      }
    }
    if (ev.key !== "Escape") return;
    if (_catDeleteModal) {
      ev.preventDefault();
      _catDeleteModal = null;
      mountOrRefreshMockUi();
      return;
    }
    if (_catMenuKey) {
      ev.preventDefault();
      _catMenuKey = null;
      mountOrRefreshMockUi();
      return;
    }
    if (_invRowMenu) {
      ev.preventDefault();
      _invRowMenu = null;
      mountOrRefreshMockUi();
      return;
    }
    if (_invRowDeleteModalRowId) {
      ev.preventDefault();
      _invRowDeleteModalRowId = null;
      mountOrRefreshMockUi();
      return;
    }
    if (_manageCategoriesOpen) {
      ev.preventDefault();
      _manageCategoriesOpen = false;
      _catManageDraftTree = null;
      resetCatModalTransientState();
      mountOrRefreshMockUi();
      return;
    }
    if (_editCellKey) {
      ev.preventDefault();
      _editCellKey = null;
      mountOrRefreshMockUi();
      return;
    }
    if (_invOrderDetailLineViewIdx != null) {
      ev.preventDefault();
      _invOrderDetailLineViewIdx = null;
      mountOrRefreshMockUi();
      return;
    }
    if (_invOrdersRenameModal && !_invOrdersRenameModal.busy) {
      ev.preventDefault();
      _invOrdersRenameModal = null;
      mountOrRefreshMockUi();
      return;
    }
    if (_invOrderBuilderAddModal) {
      ev.preventDefault();
      _invOrderBuilderAddModal = null;
      mountOrRefreshMockUi();
      return;
    }
    if (_invOrderCellBreakdownModal && !_invOrderCellBreakdownModal.busy) {
      ev.preventDefault();
      _invOrderCellBreakdownModal = null;
      mountOrRefreshMockUi();
      return;
    }
    if (_invReceiptInfoModalOrderId) {
      ev.preventDefault();
      _invReceiptInfoModalOrderId = null;
      mountOrRefreshMockUi();
      return;
    }
    if (_invOrdersDetailOrderId) {
      ev.preventDefault();
      if (isInvOrderDetailCommitBusy()) return;
      _invOrderDetailLineViewIdx = null;
      _invOrdersDetailOrderId = null;
      mountOrRefreshMockUi();
      return;
    }
    if (!_groupRemoveModalGroupId) return;
    ev.preventDefault();
    _groupRemoveModalGroupId = null;
    mountOrRefreshMockUi();
  });
  root.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;

    const invMainTabBtn = t.closest("[data-inv-main-tab]");
    if (invMainTabBtn && root.contains(invMainTabBtn)) {
      ev.preventDefault();
      const tab = invMainTabBtn.getAttribute("data-inv-main-tab");
      if (tab === "inventory" || tab === "orderBuilder" || tab === "orders" || tab === "insights") {
        if (_invMainTab !== tab) {
          _invMainTab = tab;
          if (tab !== "orders") {
            _invOrdersDetailOrderId = null;
            _invReceiptInfoModalOrderId = null;
            _invOrderDetailLineViewIdx = null;
            _invOrdersMenu = null;
            _invOrdersDeleteConfirmOrderId = null;
            _invOrdersMarkOrderedConfirmOrderId = null;
            _invOrdersRenameModal = null;
          }
          if (tab === "orderBuilder") {
            _invOrderBuilderPreviewLoading = true;
          }
          mountOrRefreshMockUi();
          if (tab === "orderBuilder") {
            void loadInventoryOrderDraft();
            void refreshOrderBuilderPreviewAsync();
          }
          if (tab === "orders") {
            void loadInventoryOrdersList();
          }
          if (tab === "insights") {
            void refreshInventoryInsightsAsync();
          }
        }
      }
      return;
    }

    const insightsSubTabBtn = t.closest("[data-inv-insights-subtab]");
    if (insightsSubTabBtn && root.contains(insightsSubTabBtn)) {
      ev.preventDefault();
      const sub = insightsSubTabBtn.getAttribute("data-inv-insights-subtab");
      const allowedSub = ["overview", "purchases", "forecast", "health"];
      if (sub && allowedSub.includes(sub) && _invInsightsSubTab !== sub) {
        _invInsightsSubTab = sub;
        mountOrRefreshMockUi();
      }
      return;
    }

    const ordersKebab = t.closest("[data-inv-orders-menu-trigger]");
    if (ordersKebab && root.contains(ordersKebab)) {
      ev.preventDefault();
      ev.stopPropagation();
      const oid = ordersKebab.getAttribute("data-inv-orders-menu-trigger");
      if (oid) {
        const rect = ordersKebab.getBoundingClientRect();
        const menuW = 200;
        const menuH = 152;
        let left = rect.right + 4;
        let top = rect.top;
        left = Math.min(left, window.innerWidth - menuW - 8);
        top = Math.min(top, window.innerHeight - menuH - 8);
        left = Math.max(8, left);
        top = Math.max(8, top);
        _invOrdersMenu = { orderId: oid, left, top };
        mountOrRefreshMockUi();
      }
      return;
    }
    const ordersMenuAction = t.closest("[data-inv-orders-action]");
    if (ordersMenuAction && root.contains(ordersMenuAction)) {
      ev.preventDefault();
      ev.stopPropagation();
      const oid = ordersMenuAction.getAttribute("data-order-id");
      const act = ordersMenuAction.getAttribute("data-inv-orders-action");
      if (!oid || !act) return;
      if (act === "editName") {
        const o = _invOrdersList.find((x) => x.id === oid);
        const cur = o && o.orderName != null ? String(o.orderName) : "";
        _invOrdersMenu = null;
        _invOrdersRenameModal = { orderId: oid, draftName: cur, busy: false };
        mountOrRefreshMockUi();
        const root = document.getElementById("inventoryScreen");
        const inp = root && root.querySelector("[data-inv-orders-rename-input]");
        if (inp instanceof HTMLInputElement) {
          inp.focus();
          inp.select();
        }
        return;
      }
      if (act === "duplicate") {
        _invOrdersMenu = null;
        void duplicateInventoryOrderDraft(oid);
        return;
      }
      if (act === "delete") {
        _invOrdersMenu = null;
        _invOrdersDeleteConfirmOrderId = oid;
        mountOrRefreshMockUi();
        return;
      }
      if (act === "markOrdered") {
        _invOrdersMenu = null;
        _invOrdersMarkOrderedConfirmOrderId = oid;
        mountOrRefreshMockUi();
        return;
      }
      return;
    }
    if (t.closest("[data-inv-orders-menu-dismiss]")) {
      ev.preventDefault();
      _invOrdersMenu = null;
      mountOrRefreshMockUi();
      return;
    }
    const ordersDelCommit = t.closest("[data-inv-orders-delete-commit]");
    if (ordersDelCommit && root.contains(ordersDelCommit)) {
      ev.preventDefault();
      const oid = ordersDelCommit.getAttribute("data-order-id");
      if (oid && _invOrdersDeleteConfirmOrderId === oid) {
        void deleteInventoryOrderDraftConfirmed(oid);
      }
      return;
    }
    if (t.closest("[data-inv-orders-delete-cancel]") || t.id === "ff-inv-orders-delete-backdrop") {
      ev.preventDefault();
      _invOrdersDeleteConfirmOrderId = null;
      mountOrRefreshMockUi();
      return;
    }
    const ordersMarkOrdCommit = t.closest("[data-inv-orders-mark-ordered-commit]");
    if (ordersMarkOrdCommit && root.contains(ordersMarkOrdCommit)) {
      ev.preventDefault();
      const oid = ordersMarkOrdCommit.getAttribute("data-order-id");
      if (oid && _invOrdersMarkOrderedConfirmOrderId === oid) {
        void markInventoryOrderOrderedConfirmed(oid);
      }
      return;
    }
    if (t.closest("[data-inv-orders-mark-ordered-cancel]") || t.id === "ff-inv-orders-mark-ordered-backdrop") {
      ev.preventDefault();
      _invOrdersMarkOrderedConfirmOrderId = null;
      mountOrRefreshMockUi();
      return;
    }

    const ordersRenameSave = t.closest("[data-inv-orders-rename-save]");
    if (ordersRenameSave && root.contains(ordersRenameSave)) {
      ev.preventDefault();
      if (ordersRenameSave instanceof HTMLButtonElement && ordersRenameSave.disabled) return;
      const oid = ordersRenameSave.getAttribute("data-order-id");
      const inp = root.querySelector("[data-inv-orders-rename-input]");
      const val = inp instanceof HTMLInputElement ? inp.value : "";
      if (oid && _invOrdersRenameModal && _invOrdersRenameModal.orderId === oid) {
        void renameInventoryOrderConfirmed(oid, val);
      }
      return;
    }
    if (
      t.closest("[data-inv-orders-rename-cancel]") ||
      t.id === "ff-inv-orders-rename-backdrop"
    ) {
      ev.preventDefault();
      if (_invOrdersRenameModal && _invOrdersRenameModal.busy) return;
      _invOrdersRenameModal = null;
      mountOrRefreshMockUi();
      return;
    }

    const ordBreakdownRemove = t.closest("[data-inv-ord-breakdown-remove]");
    if (ordBreakdownRemove && root.contains(ordBreakdownRemove)) {
      ev.preventDefault();
      if (ordBreakdownRemove instanceof HTMLButtonElement && ordBreakdownRemove.disabled) return;
      if (!_invOrderCellBreakdownModal) return;
      const rid = ordBreakdownRemove.getAttribute("data-inv-ord-breakdown-remove");
      if (!rid) return;
      const { rowId, groupId } = _invOrderCellBreakdownModal;
      void removeApprovedContributionForCell(rowId, groupId, rid);
      return;
    }
    if (
      t.closest("[data-inv-ord-breakdown-close]") ||
      t.id === "ff-inv-ord-breakdown-backdrop"
    ) {
      ev.preventDefault();
      if (_invOrderCellBreakdownModal && _invOrderCellBreakdownModal.busy) return;
      _invOrderCellBreakdownModal = null;
      mountOrRefreshMockUi();
      return;
    }

    const ordersStatusFilterChip = t.closest("[data-inv-orders-status-filter]");
    if (ordersStatusFilterChip && root.contains(ordersStatusFilterChip)) {
      ev.preventDefault();
      const v = ordersStatusFilterChip.getAttribute("data-inv-orders-status-filter");
      if (v === "all" || v === "open" || v === "in_progress" || v === "done") {
        _invOrdersStatusFilter = v;
        mountOrRefreshMockUi();
      }
      return;
    }

    const ordersSearchClear = t.closest("[data-inv-orders-search-clear]");
    if (ordersSearchClear && root.contains(ordersSearchClear)) {
      ev.preventDefault();
      _invOrdersSearchQuery = "";
      mountOrRefreshMockUi();
      const inp = root.querySelector("[data-inv-orders-search-input]");
      if (inp instanceof HTMLInputElement) inp.focus();
      return;
    }

    const odPrintBtn = t.closest("[data-inv-order-detail-print]");
    if (odPrintBtn && root.contains(odPrintBtn)) {
      ev.preventDefault();
      if (isInvOrderDetailCommitBusy()) return;
      triggerOrderDetailPrint();
      return;
    }
    const odCsvBtn = t.closest("[data-inv-order-detail-export-csv]");
    if (odCsvBtn && root.contains(odCsvBtn)) {
      ev.preventDefault();
      if (isInvOrderDetailCommitBusy()) return;
      triggerOrderDetailExportCsv();
      return;
    }

    const odPurchaseCommit = t.closest("[data-inv-order-detail-confirm-purchase]");
    if (odPurchaseCommit && root.contains(odPurchaseCommit)) {
      ev.preventDefault();
      if (isInvOrderDetailCommitBusy()) return;
      const oid = odPurchaseCommit.getAttribute("data-order-id");
      if (oid && _invOrdersDetailOrderId === oid) {
        void confirmInventoryOrderPurchase(oid);
      }
      return;
    }

    const odReceiveCommit = t.closest("[data-inv-order-detail-receive-commit]");
    if (odReceiveCommit && root.contains(odReceiveCommit)) {
      ev.preventDefault();
      if (isInvOrderDetailCommitBusy()) return;
      const oid = odReceiveCommit.getAttribute("data-order-id");
      if (oid && _invOrdersDetailOrderId === oid) {
        void confirmInventoryOrderReceived(oid);
      }
      return;
    }

    const detailFilterChip = t.closest("[data-inv-order-detail-filter]");
    if (detailFilterChip && root.contains(detailFilterChip)) {
      ev.preventDefault();
      if (isInvOrderDetailCommitBusy()) return;
      const v = detailFilterChip.getAttribute("data-inv-order-detail-filter");
      if (v === "all" || v === "open" || v === "received") {
        _invOrderDetailFilter = v;
        mountOrRefreshMockUi();
      }
      return;
    }

    const odLineViewClose = t.closest("[data-inv-od-line-view-close]");
    if (odLineViewClose && root.contains(odLineViewClose)) {
      ev.preventDefault();
      _invOrderDetailLineViewIdx = null;
      mountOrRefreshMockUi();
      return;
    }
    if (t.id === "ff-inv-od-line-view-backdrop") {
      ev.preventDefault();
      _invOrderDetailLineViewIdx = null;
      mountOrRefreshMockUi();
      return;
    }

    const shopRow = t.closest("[data-inv-detail-shopping-row]");
    if (shopRow && root.contains(shopRow)) {
      if (t.closest(".ff-inv2-od-shopping-check-label")) return;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "BUTTON" || tag === "A" || tag === "LABEL" || tag === "TEXTAREA" || tag === "SELECT")
        return;
      ev.preventDefault();
      if (isInvOrderDetailCommitBusy()) return;
      const cb = shopRow.querySelector("input[data-inv-shopping-check]");
      if (cb instanceof HTMLInputElement && !cb.disabled) {
        const oid = cb.getAttribute("data-order-id");
        const idxStr = cb.getAttribute("data-line-idx");
        if (oid != null && idxStr != null) {
          toggleShoppingRowQty(oid, Number(idxStr));
        }
      }
      return;
    }

    const receiptInfoBackdrop = root.querySelector("#ff-inv-receipt-info-backdrop");
    if (receiptInfoBackdrop) {
      const receiptInfoSave = t.closest("[data-inv-receipt-info-save]");
      if (receiptInfoSave && root.contains(receiptInfoSave)) {
        ev.preventDefault();
        const oid = receiptInfoSave.getAttribute("data-order-id");
        if (!oid || oid !== _invReceiptInfoModalOrderId) return;
        const card = receiptInfoBackdrop.querySelector("[data-inv-receipt-info-card]");
        if (!card) return;
        const n = card.querySelector('[data-inv-receipt-info-field="note"]');
        const s = card.querySelector('[data-inv-receipt-info-field="supplierName"]');
        const a = card.querySelector('[data-inv-receipt-info-field="amount"]');
        _invOrderReceiptUploadFieldsByOrderId[oid] = {
          note: n instanceof HTMLInputElement ? n.value.trim() : "",
          supplierName: s instanceof HTMLInputElement ? s.value.trim() : "",
          amount: a instanceof HTMLInputElement ? a.value.trim() : "",
        };
        _invReceiptInfoModalOrderId = null;
        inventoryOrderDraftToast("Receipt details saved.", "success");
        mountOrRefreshMockUi();
        return;
      }
      if (
        t.id === "ff-inv-receipt-info-backdrop" ||
        t.closest("[data-inv-receipt-info-cancel]") ||
        t.closest("[data-inv-receipt-info-close]")
      ) {
        ev.preventDefault();
        _invReceiptInfoModalOrderId = null;
        mountOrRefreshMockUi();
        return;
      }
    }

    const receiptInfoOpen = t.closest("[data-inv-order-receipt-info]");
    if (receiptInfoOpen && root.contains(receiptInfoOpen)) {
      ev.preventDefault();
      if (receiptInfoOpen instanceof HTMLButtonElement && receiptInfoOpen.disabled) return;
      const oid = receiptInfoOpen.getAttribute("data-order-id");
      if (oid && _invOrdersDetailOrderId === oid) {
        _invReceiptInfoModalOrderId = oid;
        mountOrRefreshMockUi();
      }
      return;
    }

    const receiptOpenBtn = t.closest("[data-inv-order-receipt-open]");
    if (receiptOpenBtn && root.contains(receiptOpenBtn)) {
      ev.preventDefault();
      ev.stopPropagation();
      if (receiptOpenBtn instanceof HTMLButtonElement && receiptOpenBtn.disabled) return;
      const oid = receiptOpenBtn.getAttribute("data-order-id");
      const card = receiptOpenBtn.closest("[data-inv-receipt-info-card]");
      const scope = card || root.querySelector("#ff-inv-receipt-info-backdrop");
      const inp =
        scope && oid
          ? Array.from(scope.querySelectorAll("input[data-inv-order-receipt-file]")).find(
              (el) => el.getAttribute("data-order-id") === oid
            )
          : null;
      if (inp instanceof HTMLInputElement) inp.click();
      return;
    }

    const receiptDeleteBtn = t.closest("[data-inv-order-receipt-delete]");
    if (receiptDeleteBtn && root.contains(receiptDeleteBtn)) {
      ev.preventDefault();
      ev.stopPropagation();
      const oid = receiptDeleteBtn.getAttribute("data-order-id");
      const rid = receiptDeleteBtn.getAttribute("data-receipt-id");
      if (oid && rid && oid === _invReceiptInfoModalOrderId) {
        void deleteInventoryOrderReceipt(oid, rid);
      }
      return;
    }

    const orderRow = t.closest("[data-inv-order-row]");
    if (orderRow && root.contains(orderRow)) {
      if (t.closest("[data-inv-orders-actions]") || t.closest(".ff-inv2-row-menu")) return;
      ev.preventDefault();
      const oid = orderRow.getAttribute("data-inv-order-id");
      if (oid) {
        if (_invOrdersDetailOrderId != null && _invOrdersDetailOrderId !== oid) {
          _invOrderDetailFilter = "all";
        }
        _invOrderDetailLineViewIdx = null;
        _invOrdersDetailOrderId = oid;
        mountOrRefreshMockUi();
      }
      return;
    }
    if (t.closest("[data-inv-order-detail-close]") || t.id === "ff-inv-order-detail-backdrop") {
      ev.preventDefault();
      if (isInvOrderDetailCommitBusy()) return;
      _invReceiptInfoModalOrderId = null;
      _invOrderDetailLineViewIdx = null;
      _invOrdersDetailOrderId = null;
      mountOrRefreshMockUi();
      return;
    }

    const urlEditBtn = t.closest("[data-inv-url-edit]");
    if (urlEditBtn && root.contains(urlEditBtn)) {
      ev.preventDefault();
      ev.stopPropagation();
      const rid = urlEditBtn.getAttribute("data-row-id");
      if (rid) {
        const key = invCellKey("url", rid);
        if (_editCellKey === key) {
          queueMicrotask(() => {
            const inp = findInvEditInput(root, key);
            if (inp instanceof HTMLInputElement) {
              inp.focus();
              inp.select();
            }
          });
          return;
        }
        _editCellKey = key;
        mountOrRefreshMockUi();
        queueMicrotask(() => {
          const inp = findInvEditInput(root, key);
          if (inp instanceof HTMLInputElement) {
            inp.focus();
            inp.select();
          }
        });
      }
      return;
    }

    const rowMenuKebab = t.closest("[data-inv-row-menu-trigger]");
    if (rowMenuKebab && root.contains(rowMenuKebab)) {
      ev.preventDefault();
      ev.stopPropagation();
      const rid = rowMenuKebab.getAttribute("data-inv-row-menu-trigger");
      if (rid) {
        const rect = rowMenuKebab.getBoundingClientRect();
        const menuW = 180;
        const menuH = 120;
        let left = rect.right + 4;
        let top = rect.top;
        left = Math.min(left, window.innerWidth - menuW - 8);
        top = Math.min(top, window.innerHeight - menuH - 8);
        left = Math.max(8, left);
        top = Math.max(8, top);
        _invRowMenu = { rowId: rid, left, top };
        mountOrRefreshMockUi();
      }
      return;
    }
    const rowMenuAction = t.closest("[data-inv-row-action]");
    if (rowMenuAction && root.contains(rowMenuAction)) {
      ev.preventDefault();
      ev.stopPropagation();
      const rid = rowMenuAction.getAttribute("data-row-id");
      const act = rowMenuAction.getAttribute("data-inv-row-action");
      if (!rid) return;
      if (act === "edit") {
        _invRowMenu = null;
        _editCellKey = invCellKey("code", rid);
        mountOrRefreshMockUi();
        queueMicrotask(() => {
          const invRoot = document.getElementById("inventoryScreen");
          if (!invRoot) return;
          const inp = findInvEditInput(invRoot, invCellKey("code", rid));
          if (inp instanceof HTMLInputElement) {
            inp.focus();
            inp.select();
          }
        });
        return;
      }
      if (act === "duplicate") {
        _invRowMenu = null;
        duplicateInventoryRow(rid);
        mountOrRefreshMockUi();
        return;
      }
      if (act === "delete") {
        _invRowMenu = null;
        _invRowDeleteModalRowId = rid;
        mountOrRefreshMockUi();
        return;
      }
      return;
    }
    if (t.closest("[data-inv-row-menu-dismiss]")) {
      ev.preventDefault();
      _invRowMenu = null;
      mountOrRefreshMockUi();
      return;
    }
    const rowDelCommit = t.closest("[data-inv-row-delete-commit]");
    if (rowDelCommit && root.contains(rowDelCommit)) {
      ev.preventDefault();
      const rid = rowDelCommit.getAttribute("data-row-id");
      if (rid && _invRowDeleteModalRowId === rid) {
        deleteInventoryRow(rid);
        _invRowDeleteModalRowId = null;
        _editCellKey = null;
        mountOrRefreshMockUi();
      }
      return;
    }
    if (t.closest("[data-inv-row-delete-cancel]") || t.id === "ff-inv2-row-delete-modal") {
      ev.preventDefault();
      _invRowDeleteModalRowId = null;
      mountOrRefreshMockUi();
      return;
    }

    const cellView = t.closest("[data-inv-cell]");
    if (cellView && root.contains(cellView)) {
      const key = getInvCellKeyFromEl(cellView);
      if (key && key !== _editCellKey) {
        _editCellKey = key;
        mountOrRefreshMockUi();
        queueMicrotask(() => {
          const inp = findInvEditInput(root, key);
          if (inp instanceof HTMLInputElement) {
            inp.focus();
            inp.select();
          }
        });
      }
      return;
    }

    if (t.closest("[data-cat-manage-open]")) {
      ev.preventDefault();
      resetCatModalTransientState();
      _manageCategoriesOpen = true;
      // Safety net: if the in-memory tree is empty (e.g. because a location
      // switch wiped it before the screen fully remounted), force a fresh
      // Firestore load before building the draft so the modal shows the real
      // categories instead of "No categories yet".
      const treeIsEmpty = !Array.isArray(_categoryTree) || _categoryTree.length === 0;
      if (treeIsEmpty && !_invCategoriesLoading) {
        _invCategoriesLoading = true;
        mountOrRefreshMockUi();
        loadInventoryCategoriesFromFirestore()
          .catch((e) => {
            console.warn("[Inventory] Manage Categories open: reload failed", e);
            _invCatLoadError = (e && e.message) || "Failed to load categories";
          })
          .finally(() => {
            _invCategoriesLoading = false;
            _catManageDraftTree = null;
            ensureCatManageDraft();
            mountOrRefreshMockUi();
          });
      } else {
        ensureCatManageDraft();
        mountOrRefreshMockUi();
      }
      return;
    }
    if (t.closest("[data-cat-manage-close]")) {
      ev.preventDefault();
      _manageCategoriesOpen = false;
      _catManageDraftTree = null;
      resetCatModalTransientState();
      mountOrRefreshMockUi();
      return;
    }
    if (t.closest("[data-cat-manage-save]")) {
      ev.preventDefault();
      if (_catSaveBusy) return;
      const draft = _catManageDraftTree ? cloneCategoryTree(_catManageDraftTree) : cloneCategoryTree(getCategoryTree());
      const runSave = async () => {
        _catSaveBusy = true;
        mountOrRefreshMockUi();
        try {
          await persistInventoryCategoryTree(draft);
          await loadInventoryCategoriesFromFirestore();
          _catManageDraftTree = null;
          _manageCategoriesOpen = false;
          resetCatModalTransientState();
          ensureValidSubcategorySelection();
        } catch (e) {
          console.error("[Inventory] save categories failed", e);
          alert("Failed to save categories: " + (e && e.message ? e.message : String(e)));
        } finally {
          _catSaveBusy = false;
          mountOrRefreshMockUi();
        }
      };
      void runSave();
      return;
    }
    if (t.id === "ff-inv2-cat-manage-backdrop") {
      ev.preventDefault();
      _manageCategoriesOpen = false;
      _catManageDraftTree = null;
      resetCatModalTransientState();
      mountOrRefreshMockUi();
      return;
    }
    if (t.closest("[data-cat-delete-modal-commit]")) {
      ev.preventDefault();
      if (_catDeleteModal) {
        const { kind, catId, subId } = _catDeleteModal;
        if (kind === "cat" && catId) {
          const tree = getManageCategoryTree();
          const i = tree.findIndex((c) => c.id === catId);
          if (i !== -1) tree.splice(i, 1);
          _expandedCategoryIds.delete(catId);
        } else if (kind === "sub" && catId && subId) {
          const cat = getManageCategoryTree().find((c) => c.id === catId);
          if (cat) cat.subcategories = cat.subcategories.filter((s) => s.id !== subId);
        }
        _catDeleteModal = null;
        ensureValidSubcategorySelection();
      }
      mountOrRefreshMockUi();
      return;
    }
    if (t.closest("[data-cat-delete-modal-cancel]")) {
      ev.preventDefault();
      _catDeleteModal = null;
      mountOrRefreshMockUi();
      return;
    }
    if (t.id === "ff-inv2-cat-delete-backdrop") {
      ev.preventDefault();
      _catDeleteModal = null;
      mountOrRefreshMockUi();
      return;
    }
    const menuTrigger = t.closest("[data-cat-menu-trigger]");
    if (menuTrigger) {
      ev.preventDefault();
      const kind = menuTrigger.getAttribute("data-cat-menu-trigger");
      const catId = menuTrigger.getAttribute("data-cat-id");
      const subId = menuTrigger.getAttribute("data-sub-id");
      const key = kind === "cat" ? `cat:${catId}` : `sub:${catId}:${subId}`;
      _catMenuKey = _catMenuKey === key ? null : key;
      mountOrRefreshMockUi();
      return;
    }
    const menuRename = t.closest("[data-cat-menu-rename]");
    if (menuRename) {
      ev.preventDefault();
      const kind = menuRename.getAttribute("data-cat-menu-rename");
      _catMenuKey = null;
      if (kind === "cat") {
        const cid = menuRename.getAttribute("data-cat-id");
        _renameCatId = cid;
        _renameSubKey = null;
      } else {
        const cid = menuRename.getAttribute("data-cat-id");
        const sid = menuRename.getAttribute("data-sub-id");
        _renameCatId = null;
        _renameSubKey = cid && sid ? `${cid}:${sid}` : null;
      }
      ensureCatManageDraft();
      _manageCategoriesOpen = true;
      mountOrRefreshMockUi();
      return;
    }
    const menuDelete = t.closest("[data-cat-menu-delete]");
    if (menuDelete) {
      ev.preventDefault();
      const kind = menuDelete.getAttribute("data-cat-menu-delete");
      const catId = menuDelete.getAttribute("data-cat-id");
      _catMenuKey = null;
      if (kind === "cat") {
        const cat = catId ? getManageCategoryTree().find((c) => c.id === catId) : null;
        if (catId && cat) _catDeleteModal = { kind: "cat", catId, name: cat.name };
      } else {
        const sid = menuDelete.getAttribute("data-sub-id");
        const cat = catId ? getManageCategoryTree().find((c) => c.id === catId) : null;
        const sub = cat && sid ? cat.subcategories.find((s) => s.id === sid) : null;
        if (catId && sid && sub) _catDeleteModal = { kind: "sub", catId, subId: sid, name: sub.name };
      }
      mountOrRefreshMockUi();
      return;
    }
    if (t.closest("[data-cat-inline-newcat]")) {
      ev.preventDefault();
      _inlineNewCat = true;
      mountOrRefreshMockUi();
      return;
    }
    if (t.closest("[data-cat-new-cat-cancel]")) {
      ev.preventDefault();
      _inlineNewCat = false;
      mountOrRefreshMockUi();
      return;
    }
    if (t.closest("[data-cat-new-cat-commit]")) {
      ev.preventDefault();
      const inp = root.querySelector("input[data-cat-new-cat-input]");
      const name = (inp && inp.value.trim()) || "New category";
      const ncid = newCategoryId();
      getManageCategoryTree().push({ id: ncid, name, subcategories: [] });
      _expandedCategoryIds.add(ncid);
      _inlineNewCat = false;
      mountOrRefreshMockUi();
      return;
    }
    if (t.closest("[data-cat-rename-cancel='cat']") || t.closest("[data-cat-rename-cancel='sub']")) {
      ev.preventDefault();
      _renameCatId = null;
      _renameSubKey = null;
      mountOrRefreshMockUi();
      return;
    }
    const saveRenameCat = t.closest("[data-cat-rename-save='cat']");
    if (saveRenameCat) {
      ev.preventDefault();
      const cid = saveRenameCat.getAttribute("data-cat-id");
      const cat = cid ? getManageCategoryTree().find((c) => c.id === cid) : null;
      const inp = cid ? root.querySelector(`input[data-cat-rename-input="cat"][data-cat-id="${cid}"]`) : null;
      if (cat && inp) cat.name = inp.value.trim() || cat.name;
      _renameCatId = null;
      mountOrRefreshMockUi();
      return;
    }
    const saveRenameSub = t.closest("[data-cat-rename-save='sub']");
    if (saveRenameSub) {
      ev.preventDefault();
      const cid = saveRenameSub.getAttribute("data-cat-id");
      const sid = saveRenameSub.getAttribute("data-sub-id");
      const cat = cid ? getManageCategoryTree().find((c) => c.id === cid) : null;
      const inp =
        cid && sid
          ? root.querySelector(`input[data-cat-rename-input="sub"][data-cat-id="${cid}"][data-sub-id="${sid}"]`)
          : null;
      const sub = cat && sid ? cat.subcategories.find((s) => s.id === sid) : null;
      if (sub && inp) sub.name = inp.value.trim() || sub.name;
      _renameSubKey = null;
      mountOrRefreshMockUi();
      return;
    }
    const addSubOpen = t.closest("[data-cat-add-sub-open]");
    if (addSubOpen) {
      ev.preventDefault();
      const cid = addSubOpen.getAttribute("data-cat-add-sub-open");
      _inlineNewSubCatId = _inlineNewSubCatId === cid ? null : cid;
      mountOrRefreshMockUi();
      return;
    }
    if (t.closest("[data-cat-new-sub-cancel]")) {
      ev.preventDefault();
      _inlineNewSubCatId = null;
      mountOrRefreshMockUi();
      return;
    }
    if (t.closest("[data-cat-new-sub-commit]")) {
      ev.preventDefault();
      const btn = t.closest("[data-cat-new-sub-commit]");
      const cid = btn && btn.getAttribute("data-cat-new-sub-commit");
      const cat = cid ? getManageCategoryTree().find((c) => c.id === cid) : null;
      const inp = cid ? root.querySelector(`input[data-cat-new-sub-input="${cid}"]`) : null;
      const name = (inp && inp.value.trim()) || "New subcategory";
      if (cat) {
        const ns = { id: newSubcategoryId(), name };
        cat.subcategories.push(ns);
        if (!_selectedSubcategoryId) _selectedSubcategoryId = ns.id;
      }
      _inlineNewSubCatId = null;
      mountOrRefreshMockUi();
      return;
    }

    if (_catMenuKey && !t.closest(".ff-inv2-cat-menu-wrap")) {
      _catMenuKey = null;
      mountOrRefreshMockUi();
      return;
    }

    const start = t.closest("[data-inv-remove-start]");
    if (start) {
      ev.preventDefault();
      const gid = start.getAttribute("data-inv-remove-start");
      if (gid) {
        _groupRemoveConfirmId = gid;
        mountOrRefreshMockUi();
      }
      return;
    }
    if (t.closest("[data-inv-remove-cancel]")) {
      ev.preventDefault();
      _groupRemoveConfirmId = null;
      mountOrRefreshMockUi();
      return;
    }
    const openRmModal = t.closest("[data-inv-remove-modal]");
    if (openRmModal) {
      ev.preventDefault();
      const gid = openRmModal.getAttribute("data-inv-remove-modal");
      if (gid) {
        _groupRemoveModalGroupId = gid;
        mountOrRefreshMockUi();
      }
      return;
    }
    if (t.closest("[data-inv-modal-cancel]")) {
      ev.preventDefault();
      _groupRemoveModalGroupId = null;
      mountOrRefreshMockUi();
      return;
    }
    if (t.id === "ff-inv2-group-remove-modal") {
      ev.preventDefault();
      _groupRemoveModalGroupId = null;
      mountOrRefreshMockUi();
      return;
    }
    const modalCommit = t.closest("[data-inv-modal-commit]");
    if (modalCommit) {
      ev.preventDefault();
      const gid = modalCommit.getAttribute("data-inv-modal-commit");
      if (gid) {
        removeInventoryGroup(gid);
        _groupRemoveModalGroupId = null;
        _groupRemoveConfirmId = null;
        mountOrRefreshMockUi();
      }
      return;
    }
    if (t.id === "ff-inv2-save-order-draft") {
      ev.preventDefault();
      void saveInventoryOrderDraft();
      return;
    }
    const obCatToggle = t.closest("[data-inv-ob-cat-toggle]");
    if (obCatToggle && root.contains(obCatToggle)) {
      ev.preventDefault();
      const cid = obCatToggle.getAttribute("data-inv-ob-cat-toggle");
      if (cid) {
        if (_invOrderBuilderExpandedCatIds.has(cid)) _invOrderBuilderExpandedCatIds.delete(cid);
        else _invOrderBuilderExpandedCatIds.add(cid);
        mountOrRefreshMockUi();
      }
      return;
    }
    const obAddItemBtn = t.closest("[data-inv-ob-add-item]");
    if (obAddItemBtn && root.contains(obAddItemBtn)) {
      ev.preventDefault();
      if (obAddItemBtn instanceof HTMLButtonElement && obAddItemBtn.disabled) return;
      _invOrderBuilderAddModal = {
        draftName: "",
        draftQty: "",
        linkedItemId: null,
        linkedItemMeta: null,
        picker: {
          step: "category",
          catId: null,
          subId: null,
          items: null,
          loading: false,
          error: null,
        },
      };
      mountOrRefreshMockUi();
      const rootEl = document.getElementById("inventoryScreen");
      const inp = rootEl && rootEl.querySelector('[data-inv-ob-add-input="name"]');
      if (inp instanceof HTMLInputElement) {
        inp.focus();
      }
      return;
    }
    const obAddCommit = t.closest("[data-inv-ob-add-commit]");
    if (obAddCommit && root.contains(obAddCommit)) {
      ev.preventDefault();
      if (obAddCommit instanceof HTMLButtonElement && obAddCommit.disabled) return;
      commitInventoryOrderBuilderAddItem();
      return;
    }
    if (
      t.closest("[data-inv-ob-add-cancel]") ||
      t.id === "ff-inv-ob-add-item-backdrop"
    ) {
      ev.preventDefault();
      _invOrderBuilderAddModal = null;
      mountOrRefreshMockUi();
      return;
    }
    const obLinkStep = t.closest("[data-inv-ob-add-link-step]");
    if (obLinkStep && root.contains(obLinkStep) && _invOrderBuilderAddModal) {
      ev.preventDefault();
      ev.stopPropagation();
      const step = obLinkStep.getAttribute("data-inv-ob-add-link-step");
      if (step === "category") {
        _invOrderBuilderAddModal.picker.step = "category";
        _invOrderBuilderAddModal.picker.catId = null;
        _invOrderBuilderAddModal.picker.subId = null;
        _invOrderBuilderAddModal.picker.items = null;
        _invOrderBuilderAddModal.picker.loading = false;
        _invOrderBuilderAddModal.picker.error = null;
        mountOrRefreshMockUi();
      } else if (step === "subcategory") {
        const catId = obLinkStep.getAttribute("data-cat-id") || _invOrderBuilderAddModal.picker.catId;
        _invOrderBuilderAddModal.picker.step = "subcategory";
        _invOrderBuilderAddModal.picker.catId = catId;
        _invOrderBuilderAddModal.picker.subId = null;
        _invOrderBuilderAddModal.picker.items = null;
        _invOrderBuilderAddModal.picker.loading = false;
        _invOrderBuilderAddModal.picker.error = null;
        mountOrRefreshMockUi();
      } else if (step === "items") {
        const subId = obLinkStep.getAttribute("data-sub-id") || _invOrderBuilderAddModal.picker.subId;
        const catId = _invOrderBuilderAddModal.picker.catId;
        _invOrderBuilderAddModal.picker.step = "items";
        _invOrderBuilderAddModal.picker.subId = subId;
        mountOrRefreshMockUi();
        if (catId && subId) void loadLinkPickerItemsForSub(catId, subId);
      }
      return;
    }
    const obLinkSelect = t.closest("[data-inv-ob-add-link-select]");
    if (obLinkSelect && root.contains(obLinkSelect) && _invOrderBuilderAddModal) {
      ev.preventDefault();
      ev.stopPropagation();
      const pickId = obLinkSelect.getAttribute("data-inv-ob-add-link-select");
      if (pickId) {
        const pool = Array.isArray(_invOrderBuilderAddModal.picker.items)
          ? _invOrderBuilderAddModal.picker.items
          : [];
        const picked = pool.find((x) => x.id === pickId);
        if (picked) {
          _invOrderBuilderAddModal.linkedItemId = picked.id;
          _invOrderBuilderAddModal.linkedItemMeta = picked;
          if (String(_invOrderBuilderAddModal.draftName ?? "").trim() === "") {
            _invOrderBuilderAddModal.draftName = picked.itemName;
          }
          if (!(parseNum(_invOrderBuilderAddModal.draftQty) > 0)) {
            _invOrderBuilderAddModal.draftQty = "1";
          }
          mountOrRefreshMockUi();
          const rootEl = document.getElementById("inventoryScreen");
          const qtyInp = rootEl && rootEl.querySelector('[data-inv-ob-add-input="qty"]');
          if (qtyInp instanceof HTMLInputElement) {
            qtyInp.focus();
            qtyInp.select();
          }
        }
      }
      return;
    }
    if (t.closest("[data-inv-ob-add-link-clear]") && _invOrderBuilderAddModal) {
      ev.preventDefault();
      ev.stopPropagation();
      _invOrderBuilderAddModal.linkedItemId = null;
      _invOrderBuilderAddModal.linkedItemMeta = null;
      if (_invOrderBuilderAddModal.picker) {
        _invOrderBuilderAddModal.picker.step = "category";
        _invOrderBuilderAddModal.picker.catId = null;
        _invOrderBuilderAddModal.picker.subId = null;
        _invOrderBuilderAddModal.picker.items = null;
        _invOrderBuilderAddModal.picker.loading = false;
        _invOrderBuilderAddModal.picker.error = null;
      }
      mountOrRefreshMockUi();
      return;
    }
    const obNewDraft = t.closest("[data-inv-ob-new-draft]");
    if (obNewDraft && root.contains(obNewDraft)) {
      ev.preventDefault();
      void createNewInventoryOrderDraft();
      return;
    }
    // Drafts picker: open
    const draftsPickerOpenBtn = t.closest("[data-inv-drafts-picker-open]");
    if (draftsPickerOpenBtn && root.contains(draftsPickerOpenBtn)) {
      ev.preventDefault();
      void openInventoryDraftsPicker();
      return;
    }
    // Drafts picker: close (any close button or backdrop)
    if (t.hasAttribute("data-inv-drafts-picker-close") || t.hasAttribute("data-inv-drafts-picker-close-backdrop")) {
      ev.preventDefault();
      closeInventoryDraftsPicker();
      return;
    }
    // Drafts picker: switch to another draft
    const draftsPickerSwitch = t.closest("[data-inv-drafts-picker-switch]");
    if (draftsPickerSwitch && root.contains(draftsPickerSwitch)) {
      ev.preventDefault();
      const did = draftsPickerSwitch.getAttribute("data-inv-drafts-picker-switch");
      if (did) void switchActiveInventoryDraft(did);
      return;
    }
    // Drafts picker: delete a draft
    const draftsPickerDelete = t.closest("[data-inv-drafts-picker-delete]");
    if (draftsPickerDelete && root.contains(draftsPickerDelete)) {
      ev.preventDefault();
      const did = draftsPickerDelete.getAttribute("data-inv-drafts-picker-delete");
      if (did) void deleteInventoryDraftFromPicker(did);
      return;
    }
    // Drafts picker: "+ New draft" button inside picker
    if (t.hasAttribute("data-inv-drafts-picker-new")) {
      ev.preventDefault();
      closeInventoryDraftsPicker();
      void createNewInventoryOrderDraft();
      return;
    }
    const obManualRemove = t.closest("[data-inv-ob-manual-remove]");
    if (obManualRemove && root.contains(obManualRemove)) {
      ev.preventDefault();
      const lid = obManualRemove.getAttribute("data-inv-ob-manual-remove");
      if (lid) {
        _invOrderBuilderManualLines = _invOrderBuilderManualLines.filter((x) => x.id !== lid);
        scheduleInventoryOrderDraftSave();
        mountOrRefreshMockUi();
      }
      return;
    }
    if (t.id === "ff-inv2-add-row") {
      ev.preventDefault();
      _editCellKey = null;
      addInventoryRow();
      mountOrRefreshMockUi();
    } else if (t.id === "ff-inv2-add-group") {
      ev.preventDefault();
      _editCellKey = null;
      addInventoryGroup();
      mountOrRefreshMockUi();
    }
  });
}

/**
 * External hook: force-reload a subcategory's inventory data so live changes (e.g. approved supply
 * requests contributing to Order) appear without a manual page refresh. Safe to call with any
 * (catId, subId); no-op if that sub isn't currently selected.
 */
function ffInventoryReloadSub(catId, subId) {
  const cat = String(catId ?? "").trim();
  const sub = String(subId ?? "").trim();
  if (!cat || !sub) return;
  const key = `${cat}:${sub}`;
  if (_invTableLoadedForSubId === key) {
    // If this sub is currently loaded, refetch from Firestore and rerender.
    const seq = ++_invTableLoadSeq;
    _invTableLoading = true;
    mountOrRefreshMockUi();
    void loadInventoryTableForSub(cat, sub, seq, key);
    return;
  }
  // Otherwise invalidate cache so next navigation refetches.
  if (!_invTableLoading) _invTableLoadedForSubId = null;
}
if (typeof window !== "undefined") {
  window.ffInventoryReloadSub = ffInventoryReloadSub;
  // Re-render the Inventory screen when the salon currency changes so price cells + Insights reflect it.
  window.addEventListener("ff-currency-changed", () => {
    try {
      const root = document.getElementById("inventoryScreen");
      if (root) mountOrRefreshMockUi();
    } catch (_) {
      /* ignore */
    }
  });
  // Re-load the entire inventory module when the active branch changes.
  // Each location owns its own categories/subcategories/orders/drafts, so we
  // wipe the in-memory caches and re-fetch from Firestore against the new
  // `locationId` filter. The listener is lightweight — it only does real work
  // when the Inventory screen is currently mounted.
  const _ffInvHandleLocationChanged = () => {
    try {
      _categoryTree = [];
      _persistedCategoryTree = [];
      _invOrdersList = [];
      _invOrdersLoadError = null;
      _invOrderDraftLoaded = false;
      _invActiveDraftId = null;
      _invOrderBuilderManualLines = [];
      _invOrderBuilderCustomSubIds = new Set();
      _invOrderSaveNameDraft = "";
      _invOrderDraftLastSavedAt = 0;
      _invOrderDraftSaveStatus = "idle";
      _invOrderDraftResumeToastShown = false;
      _invSuggestionsScannedThisSession = false;
      _invTableLoadedForSubId = null;
      _selectedSubcategoryId = null;
      // Always re-load categories from Firestore with the new location filter,
      // even if the Inventory screen is not the active view right now. Skipping
      // the load when `isMounted` was false created a race where the tree
      // stayed empty after a location switch and Manage Categories showed
      // "No categories yet" even though the sidebar had stale HTML.
      _invCategoriesLoading = true;
      mountOrRefreshMockUi();
      loadInventoryCategoriesFromFirestore()
        .catch((e) => {
          console.warn("[Inventory] category reload on location change failed", e);
          _invCatLoadError = (e && e.message) || "Failed to load categories";
        })
        .finally(() => {
          _invCategoriesLoading = false;
          mountOrRefreshMockUi();
          if (_invMainTab === "orders") {
            void loadInventoryOrdersList({ silent: true });
          } else if (_invMainTab === "orderBuilder") {
            void loadInventoryOrderDraft(true);
          } else if (_invMainTab === "insights") {
            void refreshInventoryInsightsAsync();
          }
          void scanInventorySuggestionsOnce();
        });
    } catch (e) {
      console.warn("[Inventory] location change handler failed", e);
    }
  };
  document.addEventListener("ff-active-location-changed", _ffInvHandleLocationChanged);
  window.addEventListener("ff-active-location-changed", _ffInvHandleLocationChanged);
}

function mountOrRefreshMockUi() {
  const root = document.getElementById("inventoryScreen");
  if (!root) return;

  prepareInventoryTableStateForMount();
  ensureGroupCellsForRows();
  prepareOrderBuilderPreviewForMount();
  if (_groupRemoveModalGroupId && _groups && !_groups.some((g) => g.id === _groupRemoveModalGroupId)) {
    _groupRemoveModalGroupId = null;
  }
  if (_invRowMenu && _rows && !_rows.some((r) => r.id === _invRowMenu.rowId)) _invRowMenu = null;
  if (_invRowDeleteModalRowId && _rows && !_rows.some((r) => r.id === _invRowDeleteModalRowId)) _invRowDeleteModalRowId = null;
  if (_invOrdersMenu && !_invOrdersList.some((o) => o.id === _invOrdersMenu.orderId)) _invOrdersMenu = null;
  if (
    _invOrdersDeleteConfirmOrderId &&
    !_invOrdersList.some((o) => o.id === _invOrdersDeleteConfirmOrderId)
  ) {
    _invOrdersDeleteConfirmOrderId = null;
  }
  if (
    _invOrdersMarkOrderedConfirmOrderId &&
    !_invOrdersList.some((o) => o.id === _invOrdersMarkOrderedConfirmOrderId)
  ) {
    _invOrdersMarkOrderedConfirmOrderId = null;
  }
  if (
    _invOrdersRenameModal &&
    !_invOrdersList.some((o) => o.id === _invOrdersRenameModal.orderId)
  ) {
    _invOrdersRenameModal = null;
  }
  if (_invOrderDetailLineViewIdx != null && _invOrdersDetailOrderId) {
    const ord = _invOrdersList.find((x) => x.id === _invOrdersDetailOrderId);
    const nItems = ord && Array.isArray(ord.items) ? ord.items.length : 0;
    if (!ord || _invOrderDetailLineViewIdx < 0 || _invOrderDetailLineViewIdx >= nItems) {
      _invOrderDetailLineViewIdx = null;
    }
  }
  if (_invOrderCellBreakdownModal) {
    const row = Array.isArray(_rows) ? _rows.find((r) => r.id === _invOrderCellBreakdownModal.rowId) : null;
    const group = Array.isArray(_groups) ? _groups.find((g) => g.id === _invOrderCellBreakdownModal.groupId) : null;
    if (!row || !group) _invOrderCellBreakdownModal = null;
  }
  injectMockStylesOnce();
  root.classList.add("ff-inv2-screen");

  const meta = getSelectedSubMeta();
  const crumb = meta
    ? `<span class="ff-inv2-crumb"><strong>${escapeHtml(meta.category.name)}</strong> · ${escapeHtml(meta.sub.name)}</span>`
    : `<span class="ff-inv2-crumb">Select a subcategory</span>`;

  if (_invOrdersDetailOrderId) {
    ensureShoppingDraft(_invOrdersDetailOrderId);
  }
  if (
    _invReceiptInfoModalOrderId &&
    (!_invOrdersList.some((x) => x.id === _invReceiptInfoModalOrderId) ||
      _invReceiptInfoModalOrderId !== _invOrdersDetailOrderId ||
      !_invOrdersDetailOrderId)
  ) {
    _invReceiptInfoModalOrderId = null;
  }

  ensureInventoryOrderReceiptsSubscription();

  // Inline diagnostic banner removed — multi-branch isolation is confirmed
  // working end-to-end. Set `localStorage.setItem('ff_inv_debug', 'true')` in
  // the console to re-enable the banner for future debugging.
  let _ffInvDebugBanner = "";
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem("ff_inv_debug") === "true") {
      const activeLoc = _ffInvActiveLocId();
      const hasMulti = _ffInvUserHasMultipleLocations();
      _ffInvDebugBanner = `<div style="padding:6px 10px;margin:6px 8px 0;border-radius:6px;font:11px/1.3 system-ui;background:${activeLoc ? "#f1f5f9" : "#fef3c7"};color:#475569;">
         <strong>Branch:</strong> <code>${escapeHtml(activeLoc || "(NONE — filter is bypassed)")}</code>
         · <span>${getCategoryTree().length} cat(s)</span>
         · <span>multi=${hasMulti ? "yes" : "no"}</span>
       </div>`;
    }
  } catch (_) {}

  root.innerHTML = `
<div class="ff-inv2-layout">
  <aside class="ff-inv2-aside" aria-label="Categories">
    <div class="ff-inv2-aside-head ff-inv2-aside-head-row">
      <span>Categories</span>
      <button type="button" class="ff-inv2-aside-add" data-cat-manage-open="1">+ Add</button>
    </div>
    ${_ffInvDebugBanner}
    <div class="ff-inv2-aside-body" id="ff-inv2-aside-body">${renderSidebarHtml()}</div>
  </aside>
  <main class="ff-inv2-main" id="ff-inv2-main">
    <div class="ff-inv2-main-head">${crumb}</div>
    ${renderInvMainTabsHtml()}
    ${renderInvMainTabPanelsHtml()}
  </main>
</div>
${renderRemoveGroupModal()}
${renderManageCategoriesModal()}
${renderCategoryDeleteConfirmModal()}
${renderDeleteRowModal()}
${renderInvRowMenu()}
${renderInventoryOrderDetailModal()}
${renderOrderDetailLineViewModal()}
${renderReceiptInfoModal()}
${renderInventoryOrdersMenu()}
${renderInventoryOrdersDeleteModal()}
${renderInventoryOrdersMarkOrderedModal()}
${renderInventoryOrdersRenameModal()}
${renderInventoryOrderBuilderAddItemModal()}
${renderInventoryOrderCellBreakdownModal()}
${renderInventoryDraftsPickerModal()}`;

  ensureInventoryScreenDelegates(root);
  syncInvColWidthsToDom();
  syncOrderBuilderCategoryCheckboxIndeterminate(root);

  const asideBody = root.querySelector("#ff-inv2-aside-body");
  if (!asideBody) return;

  asideBody.querySelectorAll("[data-cat-toggle]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = el.getAttribute("data-cat-toggle");
      if (!id) return;
      if (_expandedCategoryIds.has(id)) _expandedCategoryIds.delete(id);
      else _expandedCategoryIds.add(id);
      mountOrRefreshMockUi();
    });
  });

  asideBody.querySelectorAll(".ff-inv2-sub[data-sub-id]").forEach((el) => {
    const go = async () => {
      const id = el.getAttribute("data-sub-id");
      if (!id) return;
      clearInventoryTableSaveTimer();
      try {
        await flushInventoryTableToFirestore();
      } catch (e) {
        console.error("[Inventory] table flush before sub change", e);
      }
      _editCellKey = null;
      _invRowMenu = null;
      _invRowDeleteModalRowId = null;
      _manageCategoriesOpen = false;
      _catManageDraftTree = null;
      resetCatModalTransientState();
      _groupRemoveConfirmId = null;
      _groupRemoveModalGroupId = null;
      _selectedSubcategoryId = id;
      _invMainTab = "inventory";
      _invOrdersDetailOrderId = null;
      _invReceiptInfoModalOrderId = null;
      _invOrderDetailLineViewIdx = null;
      _invOrdersMenu = null;
      _invOrdersDeleteConfirmOrderId = null;
      _invOrdersMarkOrderedConfirmOrderId = null;
      _invOrdersRenameModal = null;
      _invOrderCellBreakdownModal = null;
      mountOrRefreshMockUi();
    };
    el.addEventListener("click", go);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    });
  });
}

function hideFullscreenPeersForInventory() {
  const ids = [
    "tasksScreen",
    "inboxScreen",
    "chatScreen",
    "mediaScreen",
    "ticketsScreen",
    "trainingScreen",
    "scheduleScreen",
    "timeClockScreen",
    "userProfileScreen",
    "myProfileScreen",
    "manageQueueScreen",
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  const ownerView = document.getElementById("owner-view");
  const joinBar = document.getElementById("joinBar");
  const wrap = document.querySelector(".wrap");
  const queueControls = document.getElementById("queueControls");
  if (ownerView) ownerView.style.display = "none";
  if (joinBar) joinBar.style.display = "none";
  if (wrap) wrap.style.display = "none";
  if (queueControls) queueControls.style.display = "none";
}

export async function goToInventory() {
  if (typeof window.ffCloseGlobalBlockingOverlays === "function") {
    try {
      window.ffCloseGlobalBlockingOverlays();
    } catch (e) {}
  }
  if (typeof window.closeStaffMembersModal === "function") {
    window.closeStaffMembersModal();
  }

  hideFullscreenPeersForInventory();

  const screen = document.getElementById("inventoryScreen");
  if (!screen) return;

  // Invalidate active-draft cache so the next Create Order entry reads fresh from Firestore.
  _invOrderDraftLoaded = false;

  _invCategoriesLoading = true;
  try {
    await loadInventoryCategoriesFromFirestore();
  } catch (e) {
    console.error("[Inventory] category load failed", e);
    _invCatLoadError = (e && e.message) || "Failed to load categories";
    _categoryTree = [];
    _persistedCategoryTree = [];
  } finally {
    _invCategoriesLoading = false;
  }

  // If the user lands directly on the Create Order tab, load its draft before first paint.
  if (_invMainTab === "orderBuilder") {
    void loadInventoryOrderDraft();
  }

  mountOrRefreshMockUi();

  screen.style.display = "flex";
  screen.style.flexDirection = "column";

  document.querySelectorAll(".btn-pill").forEach((b) => b.classList.remove("active"));
  const invBtn = document.getElementById("inventoryNavBtn");
  if (invBtn) invBtn.classList.add("active");

  // Smart Inventory Suggestions — run once per session, fire-and-forget.
  // Silently creates Inbox alerts for items forecast to run out within 3 days.
  void scanInventorySuggestionsOnce();

  try {
    const bd = document.getElementById("appsOverlayBackdrop");
    const pn = document.getElementById("appsPanel");
    if (bd) bd.style.display = "none";
    if (pn) pn.style.display = "none";
  } catch (e) {}

  if (typeof window.ffUpdateMainNavTabVisibility === "function") {
    try {
      window.ffUpdateMainNavTabVisibility();
    } catch (e) {}
  }
  if (typeof window.ffApplyQueueViewGate === "function") {
    try {
      window.ffApplyQueueViewGate();
    } catch (e) {}
  }
}

/**
 * Add a Smart Inventory Suggestion (from Inbox) as a manual line in Create Order.
 * - Navigates to Inventory → Create Order tab
 * - Pushes a linked manual line (rowId:groupId) with the suggested quantity
 * - Avoids duplicates: if the same linked item is already in the manual list, just bumps qty.
 * Returns true on success.
 */
async function ffAddInventorySuggestionToOrder(suggestion, opts) {
  if (!suggestion || !suggestion.data) return false;
  const d = suggestion.data;
  const rowId = d.rowId != null ? String(d.rowId) : "";
  const groupId = d.groupId != null ? String(d.groupId) : "";
  const subId = d.subcategoryId != null ? String(d.subcategoryId) : "";
  const catId = d.categoryId != null ? String(d.categoryId) : "";
  // Accept a user-edited qty override from the Inbox modal; fall back to suggestedQty.
  const overrideQtyRaw = opts && opts.qtyOverride;
  const overrideQty = overrideQtyRaw != null
    ? (typeof overrideQtyRaw === "number" ? overrideQtyRaw : Number(overrideQtyRaw))
    : NaN;
  const suggestedQty = typeof d.suggestedQty === "number" ? d.suggestedQty : Number(d.suggestedQty);
  const qty = Number.isFinite(overrideQty) && overrideQty > 0 ? overrideQty : suggestedQty;
  console.log("[Inventory] Add to Order — qty resolution", { overrideQtyRaw, overrideQty, suggestedQty, finalQty: qty });
  if (!rowId || !groupId || !subId || !catId || !(qty > 0)) return false;
  const salonId = await getSalonId();
  if (!salonId) return false;

  // Step 1: ensure the active draft is loaded (so we know its Firestore id).
  // This also picks up any draft created from a previous session.
  await loadInventoryOrderDraft();

  // Step 2: read-modify-write the active draft (or create one if none exists).
  const uid = auth.currentUser && auth.currentUser.uid ? String(auth.currentUser.uid) : null;
  const linkedId = `${subId}:${rowId}:${groupId}`;
  /** @type {Array<Record<string, unknown>>} */
  let existing = [];
  /** @type {import("firebase/firestore").DocumentReference | null} */
  let ref = null;
  if (_invActiveDraftId) {
    ref = doc(db, `salons/${salonId}/inventoryDrafts`, _invActiveDraftId);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data() || {};
        if (Array.isArray(data.manualItems)) {
          existing = data.manualItems.map(sanitizeManualItemForDraft).filter((x) => x && x.itemName);
        }
      }
    } catch (e) {
      console.warn("[Inventory] draft fetch (add suggestion) failed", e);
    }
  }
  const existingIdx = existing.findIndex((L) => L && L.linkedInventoryItemId === linkedId);
  if (existingIdx >= 0) {
    // User explicitly chose this qty in the modal — respect it, even if it lowers a previous value.
    existing[existingIdx].orderQty = qty;
    if (!existing[existingIdx].fromSuggestionId && suggestion.id) {
      existing[existingIdx].fromSuggestionId = suggestion.id;
    }
  } else {
    /** @type {Record<string, unknown>} */
    const entry = {
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      itemName: d.itemName != null ? String(d.itemName) : "Suggested item",
      orderQty: qty,
      isManual: true,
      linkedInventoryItemId: linkedId,
      groupId,
      groupName: d.groupName != null ? String(d.groupName) : "",
      categoryId: catId,
      categoryName: d.categoryName != null ? String(d.categoryName) : "",
      subcategoryId: subId,
      subcategoryName: d.subcategoryName != null ? String(d.subcategoryName) : "",
      fromSuggestionId: suggestion.id || null,
    };
    existing.push(entry);
  }
  try {
    const payload = {
      status: "draft",
      isActive: true,
      manualItems: existing,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    };
    if (ref) {
      await setDoc(ref, payload, { merge: true });
    } else {
      // No active draft exists — create one now.
      const newRef = await addDoc(collection(db, `salons/${salonId}/inventoryDrafts`), {
        ...payload,
        selectedSubcategoryIds: [],
        orderName: "",
        createdAt: serverTimestamp(),
        createdBy: uid,
      });
      _invActiveDraftId = newRef.id;
    }
  } catch (e) {
    console.error("[Inventory] Add to Order — draft save failed:", e && (e.code || e.message) ? (e.code || e.message) : e);
    try {
      if (typeof window !== "undefined" && typeof window.alert === "function") {
        window.alert("Could not save item to Create Order draft:\n" + (e && (e.code || e.message) ? (e.code || e.message) : String(e)));
      }
    } catch (_) {}
    return false;
  }

  // Step 3: navigate to Inventory → Create Order. The tab will reload the draft (now containing the new item).
  _invOrderDraftLoaded = false;
  await goToInventory();
  _invMainTab = "orderBuilder";
  _invOrderBuilderPreviewLoading = true;
  mountOrRefreshMockUi();
  await loadInventoryOrderDraft(true);
  void refreshOrderBuilderPreviewAsync();
  return true;
}

if (typeof window !== "undefined") {
  window.goToInventory = goToInventory;
  window.ffAddInventorySuggestionToOrder = ffAddInventorySuggestionToOrder;
  // Lightweight diagnostic helper — run `ffInventoryDumpLocations()` from the
  // browser console to see every category & subcategory in Firestore grouped
  // by their stamped `locationId`. Useful when verifying multi-branch
  // separation end-to-end after bulk deletes/edits.
  /**
   * One-shot cleanup utility — removes inventory categories that have no
   * `locationId` stamp (and all of their subcategories). These are leftovers
   * from before multi-branch separation was wired up and are currently
   * invisible in every branch, so deleting them is a safe housekeeping step.
   * Returns `{ deletedCategories, deletedSubcategories }` for confirmation.
   */
  window.ffInventoryDeleteUnstampedCategories = async function ffInventoryDeleteUnstampedCategories() {
    try {
      const salonId = await getSalonId();
      if (!salonId) { alert("No salonId — cannot clean up."); return; }
      const catSnap = await getDocs(collection(db, `salons/${salonId}/inventoryCategories`));
      const orphans = catSnap.docs.filter((d) => {
        const lid = d.data()?.locationId;
        return !(typeof lid === "string" && lid.trim());
      });
      if (orphans.length === 0) { alert("Nothing to clean up — no unstamped categories found."); return { deletedCategories: 0, deletedSubcategories: 0 }; }

      const names = orphans.map((d) => d.data()?.name || "(unnamed)").join(", ");
      const ok = confirm(`Delete ${orphans.length} unstamped category(ies) and all of their subcategories?\n\n${names}\n\nThis cannot be undone.`);
      if (!ok) return "CANCELLED";

      let batch = writeBatch(db);
      let n = 0;
      const commits = [];
      let deletedSubs = 0;
      for (const c of orphans) {
        const subSnap = await getDocs(collection(db, `salons/${salonId}/inventoryCategories/${c.id}/inventorySubcategories`));
        for (const s of subSnap.docs) {
          batch.delete(s.ref);
          deletedSubs++;
          if (++n >= 450) { commits.push(batch.commit()); batch = writeBatch(db); n = 0; }
        }
        batch.delete(c.ref);
        if (++n >= 450) { commits.push(batch.commit()); batch = writeBatch(db); n = 0; }
      }
      if (n > 0) commits.push(batch.commit());
      await Promise.all(commits);
      alert(`Cleanup done.\n\nDeleted ${orphans.length} category(ies) and ${deletedSubs} subcategory(ies).`);
      try { document.dispatchEvent(new CustomEvent("ff-active-location-changed")); } catch (_) {}
      return { deletedCategories: orphans.length, deletedSubcategories: deletedSubs };
    } catch (e) {
      console.error("[Inventory/cleanup] failed", e);
      alert("Cleanup failed: " + ((e && e.message) || e));
      return "ERROR";
    }
  };

  window.ffInventoryDumpLocations = async function ffInventoryDumpLocations() {
    try {
      const salonId = await getSalonId();
      if (!salonId) {
        console.warn("[Inventory/dump] No salonId resolved.");
        return "NO_SALON";
      }
      const active = _ffInvActiveLocId() || "(none)";
      const catSnap = await getDocs(collection(db, `salons/${salonId}/inventoryCategories`));
      const cats = catSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      const buckets = {};
      const detailed = [];
      for (const c of cats) {
        const key = typeof c.locationId === "string" && c.locationId.trim() ? c.locationId.trim() : "(unstamped)";
        if (!buckets[key]) buckets[key] = 0;
        buckets[key] += 1;
        detailed.push({ id: c.id, name: c.name || "(unnamed)", locationId: key });
      }

      const lines = [];
      lines.push(`active=${active}`);
      lines.push(`firestoreTotal=${cats.length}`);
      lines.push(`memoryTree=${(_categoryTree || []).length} cats (what the sidebar renders)`);
      lines.push(`bucketCount=${Object.keys(buckets).length}`);
      lines.push("--- by bucket ---");
      for (const [k, v] of Object.entries(buckets)) {
        lines.push(`  ${k}: ${v}`);
      }
      lines.push("--- in-memory tree (sidebar) ---");
      for (const c of (_categoryTree || [])) {
        lines.push(`  ${c.name || "(unnamed)"}  (id=${c.id}, subs=${(c.subcategories || []).length})`);
      }
      lines.push("--- firestore detailed ---");
      for (const d of detailed) {
        lines.push(`  ${d.locationId}  →  ${d.name}  (id=${d.id})`);
      }
      const report = lines.join("\n");
      // Alert guarantees visibility regardless of console filter levels
      try { alert("Inventory dump:\n\n" + report); } catch (_) {}
      console.warn("[Inventory/dump] " + report);
      return { active, total: cats.length, buckets, detailed };
    } catch (e) {
      console.error("[Inventory/dump] failed", e);
      try { alert("Inventory dump failed: " + ((e && e.message) || e)); } catch (_) {}
      return "ERROR";
    }
  };
}
