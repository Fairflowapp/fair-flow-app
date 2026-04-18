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
  deleteDoc,
  onSnapshot,
  runTransaction,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";

const SALON_ID_CACHE_KEY = "ff_salonId_v1";

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

const STYLE_ID = "ff-inv2-mock-styles-v74";

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
/** @type {"all" | "draft" | "ordered" | "partially_received" | "received"} */
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
let _invOrderBuilderSourceMode = "currentSub"; // "currentSub" | "currentCat" | "custom"
/** @type {Set<string>} */
let _invOrderBuilderCustomSubIds = new Set();
/** @type {Array<Record<string, unknown>>} */
let _invOrderBuilderPreviewLines = [];
let _invOrderBuilderPreviewLoading = false;
let _invOrderBuilderPreviewSeq = 0;

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
  const rawCats = catSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  rawCats.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const tree = await Promise.all(
    rawCats.map(async (c) => {
      const subCol = collection(db, `salons/${salonId}/inventoryCategories/${c.id}/inventorySubcategories`);
      const subSnap = await getDocs(subCol);
      const subs = subSnap.docs.map((d) => {
        const data = d.data();
        return { id: d.id, name: data.name, order: data.order ?? 0 };
      });
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

  for (let ci = 0; ci < desiredTree.length; ci++) {
    const c = desiredTree[ci];
    const ref = doc(db, `salons/${salonId}/inventoryCategories/${c.id}`);
    if (!oldCatIds.has(c.id)) {
      batch.set(ref, { name: c.name, order: ci, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
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
        batch.set(ref, { name: s.name, order, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      } else if (wasMoved) {
        const ca = movedCreatedAt.get(s.id);
        const tbl = movedTableData.get(s.id);
        batch.set(ref, {
          name: s.name,
          order,
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

function normalizeRowFromFirestore(r) {
  const byGroup = {};
  const raw = r && r.byGroup && typeof r.byGroup === "object" ? r.byGroup : {};
  for (const gid of Object.keys(raw)) {
    const cell = raw[gid];
    if (!cell || typeof cell !== "object") continue;
    byGroup[gid] = {
      stock: typeof cell.stock === "number" ? cell.stock : parseNum(cell.stock),
      current: typeof cell.current === "number" ? cell.current : parseNum(cell.current),
      price: cell.price != null ? String(cell.price) : "",
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

/** Derive delivery status from items: hasAnyReceived vs allFullyReceived based on effective received qty (B). */
function computeReceiveStatusFromItems(items) {
  const arr = Array.isArray(items) ? items : [];
  if (arr.length === 0) return "ordered";
  let hasAnyReceived = false;
  let allFullyReceived = true;
  for (const it of arr) {
    const oq = getItemOrderQty(it);
    const b = getItemEffectiveReceivedQty(it);
    if (b > 0) hasAnyReceived = true;
    if (oq <= 0) continue;
    if (b < oq) allFullyReceived = false;
  }
  if (!hasAnyReceived) return "ordered";
  if (allFullyReceived) return "received";
  return "partially_received";
}

/** Auto-computed status for an order: draft stays draft; delivery orders (ordered/partial/received) derive from items. */
function getEffectiveInventoryOrderStatus(o) {
  if (!o || typeof o !== "object") return "draft";
  const raw = o.status != null ? String(o.status) : "draft";
  if (raw === "draft") return "draft";
  const items = Array.isArray(o.items) ? o.items : [];
  return computeReceiveStatusFromItems(items);
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

/** Order = max(Stock - Current, 0) */
function computeOrder(stock, current) {
  const s = typeof stock === "number" ? stock : parseNum(stock);
  const c = typeof current === "number" ? current : parseNum(current);
  return Math.max(0, s - c);
}

function formatOrderDisplay(n) {
  if (Number.isInteger(n)) return String(n);
  const r = Math.round(n * 100) / 100;
  return String(r);
}

function formatOrderDetailEstimatedCost(n) {
  const r = Math.round(Number(n) * 100) / 100;
  if (!Number.isFinite(r)) return "0.00";
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
      const oq = computeOrder(cell.stock, cell.current);
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

function prepareOrderBuilderPreviewForMount() {
  if (_invMainTab !== "orderBuilder") return;
  if (_invOrderBuilderSourceMode === "currentSub") {
    syncOrderBuilderPreviewFromCurrentSub();
  }
}

async function refreshOrderBuilderPreviewAsync() {
  if (_invMainTab !== "orderBuilder") return;
  const meta = getSelectedSubMeta();
  if (!meta) {
    _invOrderBuilderPreviewLines = [];
    _invOrderBuilderPreviewLoading = false;
    mountOrRefreshMockUi();
    return;
  }
  if (_invOrderBuilderSourceMode === "currentSub") {
    syncOrderBuilderPreviewFromCurrentSub();
    return;
  }
  const seq = ++_invOrderBuilderPreviewSeq;
  _invOrderBuilderPreviewLoading = true;
  mountOrRefreshMockUi();
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    let lines = [];
    if (_invOrderBuilderSourceMode === "currentCat") {
      lines = await buildOrderPreviewLinesForSubIds(
        salonId,
        meta.category.id,
        meta.category.subcategories || [],
        meta.category.name != null ? String(meta.category.name) : null
      );
    } else {
      const ids = Array.from(_invOrderBuilderCustomSubIds);
      if (ids.length === 0) {
        lines = [];
      } else {
        lines = await buildOrderPreviewLinesForCustomSubIds(salonId, ids);
      }
    }
    sortOrderBuilderLines(lines);
    if (seq !== _invOrderBuilderPreviewSeq) return;
    _invOrderBuilderPreviewLines = lines;
  } catch (e) {
    console.error("[Inventory] order builder preview failed", e);
    if (seq !== _invOrderBuilderPreviewSeq) return;
    _invOrderBuilderPreviewLines = [];
    inventoryOrderDraftToast("Could not load inventory for this source.", "error");
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
    const allChecked = subs.length > 0 && subs.every((s) => _invOrderBuilderCustomSubIds.has(s.id));
    parts.push(`<div class="ff-inv2-ob-cat-block" data-inv-ob-cat-block="${escapeHtml(c.id)}">
  <label class="ff-inv2-ob-cat-label">
    <input type="checkbox" data-inv-ob-cat="${escapeHtml(c.id)}"${allChecked ? " checked" : ""} />
    <span class="ff-inv2-ob-cat-name">${escapeHtml(c.name)}</span>
  </label>
  <div class="ff-inv2-ob-subs">${subsHtml}</div>
</div>`);
  }
  return `<div class="ff-inv2-ob-tree" role="group" aria-label="Subcategories">${parts.join("")}</div>`;
}

function renderOrderBuilderSourceHtml() {
  const meta = getSelectedSubMeta();
  const subLabel = meta && meta.sub.name != null ? String(meta.sub.name) : "—";
  const catLabel = meta && meta.category.name != null ? String(meta.category.name) : "—";
  const mode = _invOrderBuilderSourceMode;
  const customBlock =
    mode === "custom"
      ? `<div class="ff-inv2-ob-custom">${renderOrderBuilderCustomTreeHtml()}</div>`
      : "";
  return `<div class="ff-inv2-ob-source">
  <p class="ff-inv2-ob-source-title">Order list source</p>
  <div class="ff-inv2-ob-source-radios" role="radiogroup" aria-label="Order list source">
    <label class="ff-inv2-ob-radio">
      <input type="radio" name="ff-inv2-ob-source" value="currentSub"${mode === "currentSub" ? " checked" : ""} />
      <span>Current subcategory <span class="ff-inv2-ob-muted">(${escapeHtml(subLabel)})</span></span>
    </label>
    <label class="ff-inv2-ob-radio">
      <input type="radio" name="ff-inv2-ob-source" value="currentCat"${mode === "currentCat" ? " checked" : ""} />
      <span>Current category <span class="ff-inv2-ob-muted">(${escapeHtml(catLabel)})</span></span>
    </label>
    <label class="ff-inv2-ob-radio">
      <input type="radio" name="ff-inv2-ob-source" value="custom"${mode === "custom" ? " checked" : ""} />
      <span>Custom selection</span>
    </label>
  </div>
  ${customBlock}
</div>`;
}

function syncOrderBuilderCategoryCheckboxIndeterminate(root) {
  if (_invOrderBuilderSourceMode !== "custom") return;
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
  const mode = _invOrderBuilderSourceMode;
  const meta = getSelectedSubMeta();
  if (mode === "currentSub") {
    if (!meta) return null;
    const sourceSelection = {
      categoryId: meta.category.id,
      categoryName: meta.category.name != null ? String(meta.category.name) : "",
      subcategoryIds: [meta.sub.id],
      subcategoryNames: [meta.sub.name != null ? String(meta.sub.name) : ""],
    };
    return {
      sourceType: "subcategory",
      sourceSelection,
      categoryId: meta.category.id,
      categoryName: meta.category.name != null ? String(meta.category.name) : null,
      subcategoryId: meta.sub.id,
      subcategoryName: meta.sub.name != null ? String(meta.sub.name) : null,
    };
  }
  if (mode === "currentCat") {
    if (!meta) return null;
    const subs = meta.category.subcategories || [];
    const sourceSelection = {
      categoryId: meta.category.id,
      categoryName: meta.category.name != null ? String(meta.category.name) : "",
      subcategoryIds: subs.map((s) => s.id),
      subcategoryNames: subs.map((s) => (s.name != null ? String(s.name) : "")),
    };
    return {
      sourceType: "category",
      sourceSelection,
      categoryId: meta.category.id,
      categoryName: meta.category.name != null ? String(meta.category.name) : null,
      subcategoryId: null,
      subcategoryName: null,
    };
  }
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
  const linesRaw = Array.isArray(_invOrderBuilderPreviewLines) ? _invOrderBuilderPreviewLines : [];
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
    const lines = linesRaw.map((L) => enrichOrderLineWithCategoryContext(L));
    const orderNameRaw = String(_invOrderSaveNameDraft ?? "").trim();
    const items = lines.map((L) => ({
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
    }));
    await addDoc(collection(db, `salons/${salonId}/inventoryOrders`), {
      status: "draft",
      ...(orderNameRaw !== "" ? { orderName: orderNameRaw } : {}),
      sourceType: src.sourceType,
      sourceSelection: src.sourceSelection,
      categoryId: src.categoryId,
      categoryName: src.categoryName,
      subcategoryId: src.subcategoryId,
      subcategoryName: src.subcategoryName,
      createdAt: serverTimestamp(),
      createdBy: uid,
      itemCount: items.length,
      items,
    });
    _invOrderSaveNameDraft = "";
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
  const lines = Array.isArray(_invOrderBuilderPreviewLines) ? _invOrderBuilderPreviewLines : [];
  const loading = _invOrderBuilderPreviewLoading;
  const hasRows = lines.length > 0;
  const busy = _invSaveOrderDraftBusy;
  const showSubCol = _invOrderBuilderSourceMode !== "currentSub";
  const saveDisabled = busy || loading || !hasRows;
  const saveBtn = hasRows && !loading
    ? `<button type="button" class="ff-inv2-btn" id="ff-inv2-save-order-draft"${saveDisabled ? " disabled" : ""}>${busy ? "Saving…" : "Save as Order"}</button>`
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
  return `<div class="ff-inv2-order-list-card">
  ${renderOrderBuilderSourceHtml()}
  <div class="ff-inv2-order-list-head">
    <h3 class="ff-inv2-order-list-title">Order list</h3>
    ${saveBtn}
  </div>
  ${nameInput}
  ${body}
</div>`;
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
    { id: "orderBuilder", label: "Order Builder" },
    { id: "orders", label: "Orders" },
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
  if (s === "draft") return "shopping";
  if (s === "ordered") return "ordered";
  if (s === "partially_received") return "partially received";
  if (s === "received") return "received";
  return s;
}

function getInventoryOrderStatusKey(o) {
  const s = getEffectiveInventoryOrderStatus(o);
  if (s === "draft" || s === "ordered" || s === "partially_received" || s === "received") return s;
  return "draft";
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
    _invOrdersList = snap.docs.map((d) => {
      const x = d.data();
      return { id: d.id, ...x };
    });
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
  const ost = o.status != null ? String(o.status) : "draft";
  if (ost !== "draft") {
    inventoryOrderDraftToast("Confirm Purchase is only for draft orders.", "error");
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
      if (String(ordData.status ?? "draft") !== "draft") throw new Error("ORDER_BAD_STATUS");

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
    inventoryOrderDraftToast("Could not upload receipt.", "error");
  } finally {
    _invOrderReceiptUploadBusy = false;
    mountOrRefreshMockUi();
  }
}

/** Receipt list block for Receipt information modal only (uses live receipts listener). */
function buildReceiptsListBlockHtml() {
  const loading = _invOrderReceiptsLoading;
  const list = _invOrderReceiptsList;
  const rows =
    !loading && list.length
      ? list
          .map((r) => {
            const fn = r.fileName != null ? String(r.fileName) : "";
            const uploaded = formatInventoryOrderCreatedAt(r.uploadedAt);
            const url = r.fileUrl != null ? String(r.fileUrl) : "";
            return `<tr class="ff-inv2-or-tr">
  <td class="ff-inv2-or-td">${escapeHtml(fn)}</td>
  <td class="ff-inv2-or-td ff-inv2-or-td--muted">${escapeHtml(uploaded)}</td>
  <td class="ff-inv2-or-td"><a class="ff-inv2-or-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open</a></td>
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
    <th class="ff-inv2-or-th">Link</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table></div>`;
  }
  return `<p class="ff-inv2-or-empty">No receipts yet.</p>`;
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
  <p class="ff-inv2-orders-empty">No saved orders yet. Use Order Builder to save a draft.</p>
</div>`;
  }
  const fil = _invOrdersStatusFilter;
  const statusFiltered = rows.filter(orderMatchesInventoryStatusFilter);
  const filteredRows = statusFiltered.filter(orderMatchesInventorySearchQuery);
  const statusFilterBar = `<div class="ff-inv2-orders-status-filter" role="toolbar" aria-label="Filter orders by status">
  <span class="ff-inv2-order-detail-filter-label">Status</span>
  <button type="button" class="ff-inv2-od-filter-chip${fil === "draft" ? " ff-inv2-od-filter--active" : ""}" data-inv-orders-status-filter="draft">Shopping</button>
  <button type="button" class="ff-inv2-od-filter-chip${fil === "ordered" ? " ff-inv2-od-filter--active" : ""}" data-inv-orders-status-filter="ordered">Ordered</button>
  <button type="button" class="ff-inv2-od-filter-chip${fil === "partially_received" ? " ff-inv2-od-filter--active" : ""}" data-inv-orders-status-filter="partially_received">Partially received</button>
  <button type="button" class="ff-inv2-od-filter-chip${fil === "received" ? " ff-inv2-od-filter--active" : ""}" data-inv-orders-status-filter="received">Received</button>
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
  const st = o.status != null ? String(o.status) : "draft";
  const canEnterReceive = st === "ordered" || st === "partially_received";
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
  <button type="button" class="ff-inv2-od-filter-chip${fil === "received" ? " ff-inv2-od-filter--active" : ""}" data-inv-order-detail-filter="received"${receiveDisabled}>Bought</button>
</div>`
      : "";
  const itemRows = displayPairs
    .map(({ it, idx }) => {
      const vis = getOrderLineReceiveVisualState(it);
      const ordQ = formatOrderDisplay(getItemOrderQty(it));
      const chk = shop && shop.checked[idx] ? " checked" : "";
      const qb =
        shop && shop.qtyBought[idx] != null && String(shop.qtyBought[idx]).trim() !== ""
          ? String(shop.qtyBought[idx])
          : "";
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
  const shoppingHint =
    canEnterReceive && items.length > 0
      ? `<p class="ff-inv2-order-detail-receive-hint ff-inv2-order-detail-receive-hint--compact">Tap a row to check · enter <strong>B</strong> · Confirm receive.</p>`
      : st === "draft" && items.length > 0
        ? `<p class="ff-inv2-order-detail-receive-hint ff-inv2-order-detail-receive-hint--compact">Tap a row to check · enter <strong>B</strong> · <strong>Confirm Purchase</strong>.</p>`
        : "";
  const purchaseCommitBtn =
    st === "draft" && items.length > 0
      ? `<button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-primary ff-inv2-order-detail-purchase-btn" data-inv-order-detail-confirm-purchase="1" data-order-id="${oidEsc}"${receiveDisabled}>${purchaseBusy ? "Updating…" : "Confirm Purchase"}</button>`
      : "";
  const receiveCommitBtn =
    canEnterReceive && items.length > 0
      ? `<button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-primary" data-inv-order-detail-receive-commit="1" data-order-id="${oidEsc}"${receiveDisabled}>${receiveBusy ? "Saving…" : "Confirm receive"}</button>`
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
      ${purchaseCommitBtn}
      <span class="ff-inv2-order-detail-footer-spacer" aria-hidden="true"></span>
      ${receiveCommitBtn}
    </div>
  </div>
</div>`;
}

function renderInventoryOrdersMenu() {
  if (!_invOrdersMenu) return "";
  const m = _invOrdersMenu;
  const oid = escapeHtml(m.orderId);
  const o = _invOrdersList.find((x) => x.id === m.orderId);
  const st = o ? (o.status != null ? String(o.status) : "draft") : "draft";
  const isDraft = st === "draft";
  const editNameBtn = `<button type="button" class="ff-inv2-row-menu-item" role="menuitem" data-inv-orders-action="editName" data-order-id="${oid}">Edit name</button>`;
  const dupBtn = `<button type="button" class="ff-inv2-row-menu-item" role="menuitem" data-inv-orders-action="duplicate" data-order-id="${oid}">Duplicate</button>`;
  const markBtn = isDraft
    ? `<button type="button" class="ff-inv2-row-menu-item" role="menuitem" data-inv-orders-action="markOrdered" data-order-id="${oid}">Mark as Ordered</button>`
    : "";
  const deleteBtn = isDraft
    ? `<button type="button" class="ff-inv2-row-menu-item ff-inv2-row-menu-item--danger" role="menuitem" data-inv-orders-action="delete" data-order-id="${oid}">Delete</button>`
    : "";
  const inner = `${editNameBtn}${dupBtn}${markBtn}${deleteBtn}`;
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
  return `<div class="ff-inv2-modal-backdrop" id="ff-inv-orders-delete-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv-orders-delete-title">
  <div class="ff-inv2-modal-card">
    <h3 id="ff-inv-orders-delete-title" class="ff-inv2-modal-title">Delete this order?</h3>
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

function renderOrderCellTd(rowId, groupId, order) {
  const pos = order > 0;
  return `<td class="ff-inv2-order-cell${pos ? " ff-inv2-order-cell--positive" : ""}" data-order-for-row="${escapeHtml(rowId)}" data-order-for-group="${escapeHtml(groupId)}"><span class="ff-inv2-order-val">${escapeHtml(formatOrderDisplay(order))}</span></td>`;
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
  const order = computeOrder(gcell.stock, gcell.current);
  const cells = root.querySelectorAll("td[data-order-for-row]");
  for (let i = 0; i < cells.length; i++) {
    const el = cells[i];
    if (el.getAttribute("data-order-for-row") === rowId && el.getAttribute("data-order-for-group") === groupId) {
      const span = el.querySelector(".ff-inv2-order-val");
      if (span) span.textContent = formatOrderDisplay(order);
      el.classList.toggle("ff-inv2-order-cell--positive", order > 0);
      return;
    }
  }
}

function handleInventoryInput(ev) {
  const t = ev.target;
  if (!(t instanceof HTMLInputElement)) return;
  if (t.hasAttribute("data-inv-order-save-name-input")) {
    _invOrderSaveNameDraft = t.value;
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
  if (t.hasAttribute("data-inv-shopping-qty-bought")) {
    const oid = t.getAttribute("data-order-id");
    const idxStr = t.getAttribute("data-line-idx");
    if (oid != null && idxStr != null) {
      const idx = Number(idxStr);
      if (!_invOrderShoppingDraft[oid]) _invOrderShoppingDraft[oid] = { checked: [], qtyBought: [] };
      if (!_invOrderShoppingDraft[oid].qtyBought) _invOrderShoppingDraft[oid].qtyBought = [];
      if (!_invOrderShoppingDraft[oid].checked) _invOrderShoppingDraft[oid].checked = [];
      _invOrderShoppingDraft[oid].qtyBought[idx] = t.value;
      const shouldCheck = parseNum(t.value) > 0;
      if (shouldCheck) _invOrderShoppingDraft[oid].checked[idx] = true;
      const root = document.getElementById("inventoryScreen");
      if (root && shouldCheck) {
        const cb = root.querySelector(
          `input[data-inv-shopping-check][data-order-id="${CSS.escape(oid)}"][data-line-idx="${CSS.escape(idxStr)}"]`
        );
        if (cb instanceof HTMLInputElement && !cb.checked) cb.checked = true;
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
  font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
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
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-main-tab {
  margin: 0;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  border: 1px solid #ddd6fe;
  border-radius: 999px;
  background: #fff;
  color: #64748b;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}
#inventoryScreen .ff-inv2-main-tab:hover {
  background: #faf5ff;
  color: #5b21b6;
  border-color: #c4b5fd;
}
#inventoryScreen .ff-inv2-main-tab--active {
  background: #7c3aed;
  border-color: #7c3aed;
  color: #fff;
  box-shadow: 0 2px 8px rgba(124, 58, 237, 0.28);
}
#inventoryScreen .ff-inv2-main-tab:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: 2px;
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
#inventoryScreen .ff-inv2-order-list-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
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
#inventoryScreen .ff-inv2-ob-source-title {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
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
  margin-top: 10px;
  max-height: min(28vh, 220px);
  overflow: auto;
  padding: 8px 0 0;
  border-top: 1px solid #e2e8f0;
  -webkit-overflow-scrolling: touch;
}
#inventoryScreen .ff-inv2-ob-tree {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
#inventoryScreen .ff-inv2-ob-cat-label {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-weight: 600;
  font-size: 13px;
  color: #1e293b;
  cursor: pointer;
}
#inventoryScreen .ff-inv2-ob-cat-name {
  line-height: 1.35;
}
#inventoryScreen .ff-inv2-ob-subs {
  margin: 4px 0 0 22px;
  display: flex;
  flex-direction: column;
  gap: 4px;
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
  z-index: 400;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.35);
  backdrop-filter: blur(2px);
}
#inventoryScreen .ff-inv2-modal-backdrop--nested {
  z-index: 450;
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
      const v = row.byGroup[g.id] || { stock: 0, current: 0, price: "" };
      const order = computeOrder(v.stock, v.current);
      const rid = row.id;
      const gid = g.id;
      return `<td class="ff-inv2-td-numcell">${renderEditableCell("stock", rid, v.stock, { groupId: gid, inputMode: "decimal" })}</td>
<td class="ff-inv2-td-numcell">${renderEditableCell("current", rid, v.current, { groupId: gid, inputMode: "decimal" })}</td>
${renderOrderCellTd(rid, gid, order)}
<td class="ff-inv2-td-numcell">${renderEditableCell("price", rid, v.price, { groupId: gid })}</td>`;
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

/** Order Details shopping checkbox: keep draft + UI in sync (used from change + pointer handler). */
function syncShoppingDraftFromOrderDetailCheck(cb) {
  if (!(cb instanceof HTMLInputElement) || !cb.hasAttribute("data-inv-shopping-check")) return;
  const oid = cb.getAttribute("data-order-id");
  const idxStr = cb.getAttribute("data-line-idx");
  if (oid == null || idxStr == null) return;
  const idx = Number(idxStr);
  if (!_invOrderShoppingDraft[oid]) _invOrderShoppingDraft[oid] = { checked: [], qtyBought: [] };
  if (!_invOrderShoppingDraft[oid].checked) _invOrderShoppingDraft[oid].checked = [];
  _invOrderShoppingDraft[oid].checked[idx] = cb.checked;
  mountOrRefreshMockUi();
}

function handleOrderBuilderSourceChange(ev) {
  const root = document.getElementById("inventoryScreen");
  const t = ev.target;
  if (!(t instanceof HTMLInputElement) || !root || !root.contains(t)) return;
  if (t.hasAttribute("data-inv-shopping-check")) {
    syncShoppingDraftFromOrderDetailCheck(t);
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
  if (t.name === "ff-inv2-ob-source") {
    const v = t.value;
    if (v !== "currentSub" && v !== "currentCat" && v !== "custom") return;
    if (_invOrderBuilderSourceMode === v) return;
    _invOrderBuilderSourceMode = v;
    if (v === "custom" && _invOrderBuilderCustomSubIds.size === 0) {
      const meta = getSelectedSubMeta();
      if (meta) {
        for (const s of meta.category.subcategories || []) {
          _invOrderBuilderCustomSubIds.add(s.id);
        }
      }
    }
    if (v !== "currentSub") _invOrderBuilderPreviewLoading = true;
    mountOrRefreshMockUi();
    void refreshOrderBuilderPreviewAsync();
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

function ensureInventoryScreenDelegates(root) {
  if (root.dataset.ffInvDelegates === "1") return;
  root.dataset.ffInvDelegates = "1";
  ensureInvEditDocListenerOnce();
  bindInvColumnResizeOnce();
  bindCatManageDnDOnce(root);
  bindInvRowDnDOnce(root);
  bindOrderDetailRowLongPressOnce(root);
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
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
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
      if (tab === "inventory" || tab === "orderBuilder" || tab === "orders") {
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
          if (tab === "orderBuilder" && _invOrderBuilderSourceMode !== "currentSub") {
            _invOrderBuilderPreviewLoading = true;
          }
          mountOrRefreshMockUi();
          if (tab === "orderBuilder") {
            void refreshOrderBuilderPreviewAsync();
          }
          if (tab === "orders") {
            void loadInventoryOrdersList();
          }
        }
      }
      return;
    }

    const ordersKebab = t.closest("[data-inv-orders-menu-trigger]");
    if (ordersKebab && root.contains(ordersKebab)) {
      ev.preventDefault();
      ev.stopPropagation();
      const oid = ordersKebab.getAttribute("data-inv-orders-menu-trigger");
      if (oid) {
        const o = _invOrdersList.find((x) => x.id === oid);
        const st = o ? (o.status != null ? String(o.status) : "draft") : "draft";
        const rect = ordersKebab.getBoundingClientRect();
        const menuW = 200;
        const menuH = st === "draft" ? 196 : 104;
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

    const ordersStatusFilterChip = t.closest("[data-inv-orders-status-filter]");
    if (ordersStatusFilterChip && root.contains(ordersStatusFilterChip)) {
      ev.preventDefault();
      const v = ordersStatusFilterChip.getAttribute("data-inv-orders-status-filter");
      if (
        v === "all" ||
        v === "draft" ||
        v === "ordered" ||
        v === "partially_received" ||
        v === "received"
      ) {
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
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
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
      ensureCatManageDraft();
      mountOrRefreshMockUi();
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

  root.innerHTML = `
<div class="ff-inv2-layout">
  <aside class="ff-inv2-aside" aria-label="Categories">
    <div class="ff-inv2-aside-head ff-inv2-aside-head-row">
      <span>Categories</span>
      <button type="button" class="ff-inv2-aside-add" data-cat-manage-open="1">+ Add</button>
    </div>
    <div class="ff-inv2-aside-body" id="ff-inv2-aside-body">${renderSidebarHtml()}</div>
  </aside>
  <main class="ff-inv2-main" id="ff-inv2-main">
    <div class="ff-inv2-main-head">${crumb}<span class="ff-inv2-mock-pill">Categories &amp; table · Cloud (per subcategory)</span></div>
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
${renderInventoryOrdersRenameModal()}`;

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

  mountOrRefreshMockUi();

  screen.style.display = "flex";
  screen.style.flexDirection = "column";

  document.querySelectorAll(".btn-pill").forEach((b) => b.classList.remove("active"));
  const invBtn = document.getElementById("inventoryNavBtn");
  if (invBtn) invBtn.classList.add("active");

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

if (typeof window !== "undefined") {
  window.goToInventory = goToInventory;
}
