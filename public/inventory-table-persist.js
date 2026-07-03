// inventory-table-persist.js
// Firestore persistence, shared-catalog load/import, undo, and table state prep.
// Extracted verbatim from inventory-table.js (Phase T1). Spine + grid back-edges
// (getInvColWidths, ensureGroupCellsForRows, findSubMeta) injected via init.

import { db } from "/app.js?v=20260610_force_lp_ios";

import {
  doc,
  getDoc,
  getDocs,
  updateDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

import { invState } from "./inventory-state.js?v=20260627_inventory_split";

import {
  newRowId,
  sharedInvSort,
  isProductsInventorySub,
  normalizeRowFromFirestore,
  serializeInventoryRowForFirestore,
  defaultInvColWidthsObj,
  parseNum,
  isProductsInventorySubId,
  productCategoryIdFromProductsSub,
  productSubcategoryIdFromProductsSub,
  productToInvRow,
  SHARED_INV_DEFAULT_GROUP_ID,
  INV_PRODUCTS_GENERAL_SUB,
} from "./inventory-helpers.js?v=20260627_inventory_split";

import {
  sharedInvCategoriesRef,
  sharedInvSubcategoriesRef,
  getCategoryTree,
} from "./inventory-catalog.js?v=20260627_inventory_catalog";

import { inventoryOrderDraftToast } from "./inventory-orders.js?v=20260702_inventory_orders_detail_split";

import { scanProductReorderAlertsOnce } from "./inventory-insights.js?v=20260627_inventory_insights";

let _ffInvActiveLocId,
  ffCanManageInventory,
  getInventoryLocationStateId,
  getSalonId,
  mountOrRefreshMockUi,
  sharedInvItemsRef,
  sharedInvStateDocRef;
let getInvColWidths;
let ensureGroupCellsForRows;
let findSubMeta;

export function initInventoryTablePersist(deps) {
  ({
    _ffInvActiveLocId,
    ffCanManageInventory,
    getInventoryLocationStateId,
    getSalonId,
    mountOrRefreshMockUi,
    sharedInvItemsRef,
    sharedInvStateDocRef,
    getInvColWidths,
    ensureGroupCellsForRows,
    findSubMeta,
  } = deps);
}

/** One-step undo for row/group delete: delayed Firestore write + toast. */
const INV_UNDO_MS = 5000;
const INV_UNDO_TOAST_ID = "ff-inv-undo-toast";

function productsForInventorySub(productCategoryId, productSubId) {
  const catId = String(productCategoryId || "");
  const subId = String(productSubId || INV_PRODUCTS_GENERAL_SUB);
  let pool;
  if (catId === "__uncategorized__") {
    const known = new Set(
      getCategoryTree()
        .filter((c) => c.isProductCategory && c.id !== "__uncategorized__")
        .map((c) => c.id)
    );
    pool = invState._invProductsList.filter((p) => !p.categoryId || !known.has(String(p.categoryId)));
  } else {
    pool = invState._invProductsList.filter((p) => String(p.categoryId || "") === catId);
  }
  const validSubs = invState._invProductCatSubs.get(catId) || [];
  const validSubIds = new Set(validSubs.map((s) => String(s.id)));
  if (subId === INV_PRODUCTS_GENERAL_SUB) {
    return pool.filter((p) => !p.subcategoryId || !validSubIds.has(String(p.subcategoryId)));
  }
  return pool.filter((p) => String(p.subcategoryId || "") === subId);
}

async function flushProductsInventoryTableToFirestore(meta) {
  const salonId = await getSalonId();
  if (!salonId || !meta) return;
  const activeLoc = _ffInvActiveLocId();
  const productCategoryId = productCategoryIdFromProductsSub(meta.sub);
  const productSubId = productSubcategoryIdFromProductsSub(meta.sub);
  const allowedIds = new Set(productsForInventorySub(productCategoryId, productSubId).map((p) => p.id));
  for (const row of invState._rows || []) {
    const productId = row._productId || row.id;
    if (!allowedIds.has(productId)) continue;
    const cell = (row.byGroup || {})[SHARED_INV_DEFAULT_GROUP_ID] || {};
    // "Stock" column = target/par; "Current" column = on-hand.
    const targetVal = typeof cell.stock === "number" ? cell.stock : parseNum(cell.stock);
    const onHandVal = typeof cell.current === "number" ? cell.current : parseNum(cell.current);
    const target = Number.isFinite(targetVal) ? targetVal : 0;
    const onHand = Number.isFinite(onHandVal) ? onHandVal : 0;
    /** @type {Record<string, unknown>} */
    const updates = { updatedAt: serverTimestamp() };
    if (activeLoc) {
      updates[`locationOverrides.${activeLoc}.stock`] = onHand;
      updates[`locationOverrides.${activeLoc}.targetStock`] = target;
    } else {
      updates["inventory.stock"] = onHand;
      updates["inventory.targetStock"] = target;
    }
    await updateDoc(doc(db, `salons/${salonId}/products`, productId), updates);
    const prod = invState._invProductsList.find((p) => p.id === productId);
    if (prod) {
      if (activeLoc) {
        prod.locationOverrides = prod.locationOverrides || {};
        prod.locationOverrides[activeLoc] = { ...(prod.locationOverrides[activeLoc] || {}), stock: onHand, targetStock: target };
      } else {
        prod.inventory = { ...(prod.inventory || {}), stock: onHand, targetStock: target };
      }
    }
  }
}

function clearInventoryTableSaveTimer() {
  if (invState._invTableSaveTimer) {
    clearTimeout(invState._invTableSaveTimer);
    invState._invTableSaveTimer = null;
  }
}

function sharedInventoryStateItemsFromRows() {
  const items = {};
  for (const r of invState._rows || []) {
    const cell = (r.byGroup || {})[SHARED_INV_DEFAULT_GROUP_ID] || {};
    const defaultPrice = r._sharedDefaultPrice;
    const priceText = cell.price != null ? String(cell.price).trim() : "";
    const defaultPriceText = defaultPrice != null && defaultPrice !== "" ? String(defaultPrice) : "";
    const payload = {
      number: r.rowNo != null ? String(r.rowNo) : "",
      supplier: r.supplier != null ? String(r.supplier) : "",
      url: r.url != null ? String(r.url) : "",
      stock: typeof cell.stock === "number" ? cell.stock : parseNum(cell.stock),
      current: typeof cell.current === "number" ? cell.current : parseNum(cell.current),
    };
    if (r.code != null && String(r.code) !== String(r._sharedDefaultCode || "")) {
      payload.codeOverride = String(r.code);
    }
    if (priceText !== "" && priceText !== defaultPriceText) {
      payload.priceOverride = priceText;
    }
    items[r.id] = payload;
  }
  return items;
}

async function buildSharedInventoryTableData(accountId, catId, subId) {
  const itemSnap = await getDocs(sharedInvItemsRef(accountId, catId, subId));
  const items = itemSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((item) => item.active !== false)
    .sort(sharedInvSort);
  const locId = getInventoryLocationStateId();
  const stateSnap = await getDoc(sharedInvStateDocRef(accountId, locId, subId));
  const state = stateSnap.exists() ? stateSnap.data() : {};
  const localItems = state && state.items && typeof state.items === "object" ? state.items : {};
  const rows = items.map((item) => {
    const local = localItems[item.id] && typeof localItems[item.id] === "object" ? localItems[item.id] : {};
    const priceOverride = local.priceOverride != null && local.priceOverride !== "" ? String(local.priceOverride) : "";
    const defaultPrice = item.defaultPrice != null && item.defaultPrice !== "" ? String(item.defaultPrice) : "";
    return {
      id: item.id,
      rowNo: local.number != null ? String(local.number) : "",
      code: local.codeOverride != null ? String(local.codeOverride) : (item.code != null ? String(item.code) : ""),
      name: item.name != null ? String(item.name) : "",
      supplier: local.supplier != null ? String(local.supplier) : "",
      url: local.url != null ? String(local.url) : "",
      _sharedDefaultCode: item.code != null ? String(item.code) : "",
      _sharedDefaultPrice: item.defaultPrice != null ? item.defaultPrice : null,
      byGroup: {
        [SHARED_INV_DEFAULT_GROUP_ID]: {
          stock: typeof local.stock === "number" ? local.stock : parseNum(local.stock),
          current: typeof local.current === "number" ? local.current : parseNum(local.current),
          price: priceOverride || defaultPrice,
        },
      },
    };
  });
  return {
    groups: [{ id: SHARED_INV_DEFAULT_GROUP_ID, name: "Inventory", order: 0 }],
    rows: rows.map((r) => serializeInventoryRowForFirestore(r)),
    _rowsWithSharedMeta: rows,
  };
}

async function importSharedItemsIntoCurrentInventorySub() {
  if (!ffCanManageInventory()) return;
  if (!ensureTableReadyForEdits()) return;
  const meta = findSubMeta(invState._selectedSubcategoryId);
  if (!meta || !invState._rows || !invState._groups) return;
  const accountId = await getSalonId();
  if (!accountId) return;
  try {
    const sharedCatSnap = await getDocs(sharedInvCategoriesRef(accountId));
    const sharedCats = sharedCatSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => c.active !== false)
      .sort(sharedInvSort);
    if (!sharedCats.length) {
      inventoryOrderDraftToast("No shared inventory catalog yet.", "info");
      return;
    }

    let selectedCat = sharedCats.find((c) => String(c.name || "").trim().toLowerCase() === String(meta.category.name || "").trim().toLowerCase()) || sharedCats[0];
    let subSnap = await getDocs(sharedInvSubcategoriesRef(accountId, selectedCat.id));
    let sharedSubs = subSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => s.active !== false)
      .sort(sharedInvSort);
    if (!sharedSubs.length) {
      inventoryOrderDraftToast("No shared subcategories in that category.", "info");
      return;
    }

    let selectedSub = sharedSubs.find((s) => String(s.name || "").trim().toLowerCase() === String(meta.sub.name || "").trim().toLowerCase());
    if (!selectedSub) {
      const list = sharedSubs.map((s, i) => `${i + 1}. ${s.name || "Untitled"}`).join("\n");
      const raw = prompt(`Choose shared subcategory to import:\n${list}`, "1");
      const idx = Math.max(0, Math.min(sharedSubs.length - 1, (Number(raw) || 1) - 1));
      selectedSub = sharedSubs[idx];
    }
    if (!selectedSub) return;

    const itemSnap = await getDocs(sharedInvItemsRef(accountId, selectedCat.id, selectedSub.id));
    const sharedItems = itemSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => item.active !== false)
      .sort(sharedInvSort);
    if (!sharedItems.length) {
      inventoryOrderDraftToast("No shared items to import.", "info");
      return;
    }

    const existingKeys = new Set((invState._rows || []).map((r) => `${String(r.name || "").trim().toLowerCase()}|${String(r.code || "").trim().toLowerCase()}`));
    let added = 0;
    for (const item of sharedItems) {
      const name = String(item.name || "").trim();
      if (!name) continue;
      const code = String(item.code || "").trim();
      const key = `${name.toLowerCase()}|${code.toLowerCase()}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      const row = {
        id: newRowId(),
        rowNo: "",
        code,
        name,
        url: "",
        supplier: "",
        byGroup: {},
      };
      for (const g of invState._groups) {
        row.byGroup[g.id] = {
          stock: 0,
          current: 0,
          price: item.defaultPrice != null && item.defaultPrice !== "" ? String(item.defaultPrice) : "",
        };
      }
      invState._rows.push(row);
      added++;
    }
    if (!added) {
      inventoryOrderDraftToast("All shared items already exist in this subcategory.", "info");
      return;
    }
    await flushInventoryTableToFirestore();
    mountOrRefreshMockUi();
    inventoryOrderDraftToast(`Added ${added} shared item${added === 1 ? "" : "s"}.`, "success");
  } catch (e) {
    console.error("[Inventory] import shared items failed", e);
    inventoryOrderDraftToast("Could not import shared items.", "error");
  }
}

function buildFirestoreGroupsFromUi() {
  if (!invState._groups) return [];
  return invState._groups.map((g, i) => ({ id: g.id, name: g.label, order: i }));
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
  invState._invColWidths = base;
  const cw = data && data.columnWidths && typeof data.columnWidths === "object" ? data.columnWidths : null;
  if (!cw) return;
  const num = (v) => {
    const x = typeof v === "number" ? v : Number(v);
    return Number.isFinite(x) && x >= 20 ? Math.round(x) : null;
  };
  if (num(cw.rowDnd) != null) invState._invColWidths.rowDnd = num(cw.rowDnd);
  if (num(cw.hash) != null) invState._invColWidths.hash = num(cw.hash);
  if (num(cw.code) != null) invState._invColWidths.code = num(cw.code);
  if (num(cw.name) != null) invState._invColWidths.name = num(cw.name);
  if (num(cw.supplier) != null) invState._invColWidths.supplier = num(cw.supplier);
  if (num(cw.url) != null) invState._invColWidths.url = num(cw.url);
  for (const g of invState._groups || []) {
    const k = `group_${g.id}`;
    if (cw[k] != null && num(cw[k]) != null) invState._invColWidths.groupSubById[g.id] = num(cw[k]);
  }
}

async function persistColumnWidthsToFirestore() {
  if (!ensureTableReadyForEdits()) return;
  if (invState._invUndoPayload) {
    await flushInventoryTableToFirestore();
    return;
  }
  const meta = findSubMeta(invState._selectedSubcategoryId);
  if (!meta) return;
  const key = `${meta.category.id}:${meta.sub.id}`;
  if (invState._invTableLoadedForSubId !== key) return;
  const salonId = await getSalonId();
  if (!salonId) return;
  const ref = doc(db, `salons/${salonId}/inventoryCategories/${meta.category.id}/inventorySubcategories/${meta.sub.id}`);
  await updateDoc(ref, {
    columnWidths: buildColumnWidthsForFirestore(),
    updatedAt: serverTimestamp(),
  });
}

function buildFirestoreRowsFromUi() {
  if (!invState._rows) return [];
  return invState._rows.map((r) => {
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
  if (invState._invUndoTimer) {
    clearTimeout(invState._invUndoTimer);
    invState._invUndoTimer = null;
  }
  invState._invUndoPayload = null;
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

function handleInventoryUndoClick() {
  if (!invState._invUndoPayload || !invState._rows || !invState._groups) return;
  if (invState._invUndoTimer) {
    clearTimeout(invState._invUndoTimer);
    invState._invUndoTimer = null;
  }
  const p = invState._invUndoPayload;
  invState._invUndoPayload = null;
  removeInventoryUndoToastEl();
  if (p.kind === "row") {
    invState._rows.splice(p.index, 0, p.row);
  } else {
    invState._groups.splice(p.groupIndex, 0, { id: p.group.id, label: p.group.label });
    for (const row of invState._rows) {
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
  invState._invUndoPayload = payload;
  if (invState._invUndoTimer) {
    clearTimeout(invState._invUndoTimer);
    invState._invUndoTimer = null;
  }
  const msg = payload.kind === "row" ? "Row deleted" : "Group deleted";
  showInventoryUndoToast(msg);
  invState._invUndoTimer = setTimeout(() => {
    invState._invUndoTimer = null;
    void (async () => {
      try {
        await flushInventoryTableToFirestore();
      } catch (e) {
        console.error("[Inventory] undo window flush failed", e);
        if (invState._invUndoPayload) {
          showInventoryUndoToast(invState._invUndoPayload.kind === "row" ? "Row deleted" : "Group deleted");
        }
      }
    })();
  }, INV_UNDO_MS);
}

/** Commit a pending delete to Firestore before another destructive action. */
async function commitPendingInventoryDeleteIfAny() {
  if (!invState._invUndoPayload) return;
  if (invState._invUndoTimer) {
    clearTimeout(invState._invUndoTimer);
    invState._invUndoTimer = null;
  }
  removeInventoryUndoToastEl();
  try {
    await flushInventoryTableToFirestore();
  } catch (e) {
    showInventoryUndoToast(invState._invUndoPayload.kind === "row" ? "Row deleted" : "Group deleted");
    throw e;
  }
}

async function flushInventoryTableToFirestore() {
  clearInventoryTableSaveTimer();
  const meta = findSubMeta(invState._selectedSubcategoryId);
  if (!meta) return;
  const key = `${meta.category.id}:${meta.sub.id}`;
  if (invState._invTableLoadedForSubId !== key) return;
  if (!invState._groups || !invState._rows) return;
  const salonId = await getSalonId();
  if (!salonId) return;
  if (invState._invUsingSharedCatalog) {
    const ref = sharedInvStateDocRef(salonId, getInventoryLocationStateId(), meta.sub.id);
    await setDoc(ref, {
      categoryId: meta.category.id,
      subcategoryId: meta.sub.id,
      items: sharedInventoryStateItemsFromRows(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    clearInventoryUndoAfterSuccess();
    return;
  }
  if (isProductsInventorySub(meta.sub)) {
    await flushProductsInventoryTableToFirestore(meta);
    clearInventoryUndoAfterSuccess();
    // Stock changed from the Inventory side too — re-run the reorder-point scan
    // so a Low-Stock alert fires immediately, just like editing via the Product.
    void scanProductReorderAlertsOnce(true);
    return;
  }
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
  if (invState._invTableSaveTimer) clearTimeout(invState._invTableSaveTimer);
  invState._invTableSaveTimer = setTimeout(() => {
    invState._invTableSaveTimer = null;
    void flushInventoryTableToFirestore().catch((e) => console.error("[Inventory] table save failed", e));
  }, 400);
}

function ensureTableReadyForEdits() {
  return !invState._invTableLoading && !!invState._invTableLoadedForSubId && invState._groups !== null && invState._rows !== null;
}

async function loadInventoryTableForSub(catId, subId, seq, key) {
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    if (isProductsInventorySubId(subId)) {
      const meta = findSubMeta(subId);
      if (seq !== invState._invTableLoadSeq) return;
      invState._groups = [{ id: SHARED_INV_DEFAULT_GROUP_ID, label: "Inventory" }];
      const activeLoc = _ffInvActiveLocId();
      const prods = meta
        ? productsForInventorySub(
            productCategoryIdFromProductsSub(meta.sub),
            productSubcategoryIdFromProductsSub(meta.sub)
          )
        : [];
      invState._rows = prods.map((p, i) => productToInvRow(p, activeLoc, i));
      invState._invColWidths = null;
      invState._invTableLoadedForSubId = key;
      ensureGroupCellsForRows();
      return;
    }
    if (invState._invUsingSharedCatalog) {
      const data = await buildSharedInventoryTableData(salonId, catId, subId);
      if (seq !== invState._invTableLoadSeq) return;
      invState._groups = data.groups.map((g) => ({ id: g.id, label: g.name != null ? String(g.name) : "" }));
      invState._rows = Array.isArray(data._rowsWithSharedMeta) ? data._rowsWithSharedMeta : (data.rows || []).map((r) => normalizeRowFromFirestore(r));
      invState._invColWidths = null;
      if (seq !== invState._invTableLoadSeq) return;
      invState._invTableLoadedForSubId = key;
      ensureGroupCellsForRows();
      return;
    }
    const ref = doc(db, `salons/${salonId}/inventoryCategories/${catId}/inventorySubcategories/${subId}`);
    const snap = await getDoc(ref);
    if (seq !== invState._invTableLoadSeq) return;
    if (!snap.exists()) {
      invState._groups = [];
      invState._rows = [];
      invState._invColWidths = null;
    } else {
      const data = snap.data();
      const groupsRaw = Array.isArray(data.groups) ? data.groups : [];
      groupsRaw.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      invState._groups = groupsRaw.map((g) => ({
        id: g.id,
        label: g.name != null ? String(g.name) : "",
      }));
      const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
      invState._rows = rowsRaw.map((r) => normalizeRowFromFirestore(r));
      applyColumnWidthsFromFirestore(data);
    }
    if (seq !== invState._invTableLoadSeq) return;
    invState._invTableLoadedForSubId = key;
    ensureGroupCellsForRows();
  } catch (e) {
    console.error("[Inventory] table load failed", e);
    if (seq !== invState._invTableLoadSeq) return;
    invState._groups = [];
    invState._rows = [];
    invState._invColWidths = null;
    invState._invTableLoadedForSubId = key;
  } finally {
    if (seq === invState._invTableLoadSeq) {
      invState._invTableLoading = false;
      mountOrRefreshMockUi();
    }
  }
}

function prepareInventoryTableStateForMount() {
  const meta = findSubMeta(invState._selectedSubcategoryId);
  if (!meta) {
    invState._groups = null;
    invState._rows = null;
    invState._invColWidths = null;
    invState._invTableLoadedForSubId = null;
    invState._invTableLoading = false;
    return;
  }
  const key = `${meta.category.id}:${meta.sub.id}`;
  if (invState._invTableLoadedForSubId === key && !invState._invTableLoading && Array.isArray(invState._groups) && Array.isArray(invState._rows)) {
    ensureGroupCellsForRows();
    return;
  }
  if (invState._invTableLoading) return;
  clearInventoryTableSaveTimer();
  invState._invTableLoading = true;
  invState._invTableLoadedForSubId = null;
  invState._invColWidths = null;
  invState._groups = [];
  invState._rows = [];
  const seq = ++invState._invTableLoadSeq;
  void loadInventoryTableForSub(meta.category.id, meta.sub.id, seq, key);
}

function findCategoryAndSubForSubId(subId) {
  if (!subId) return null;
  for (const c of getCategoryTree()) {
    const sub = (c.subcategories || []).find((s) => s.id === subId);
    if (sub) return { category: c, sub };
  }
  return null;
}

async function fetchSubcategoryInventoryDoc(salonId, catId, subId) {
  if (invState._invUsingSharedCatalog) {
    const data = await buildSharedInventoryTableData(salonId, catId, subId);
    return {
      groups: data.groups,
      rows: data.rows,
    };
  }
  const ref = doc(db, `salons/${salonId}/inventoryCategories/${catId}/inventorySubcategories/${subId}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data();
}

export {
  clearInventoryTableSaveTimer,
  importSharedItemsIntoCurrentInventorySub,
  fetchSubcategoryInventoryDoc,
  findCategoryAndSubForSubId,
  flushInventoryTableToFirestore,
  loadInventoryTableForSub,
  prepareInventoryTableStateForMount,
  scheduleInventoryTablePersist,
  ensureTableReadyForEdits,
  startInventoryUndo,
  commitPendingInventoryDeleteIfAny,
  persistColumnWidthsToFirestore,
};
