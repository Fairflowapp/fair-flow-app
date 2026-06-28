/**
 * Inventory — categories/subcategories from Firestore (salon inventoryCategories).
 * Table rows/groups persist on the selected subcategory Firestore document.
 */
import { db, auth, storage } from "/app.js?v=20260610_force_lp_ios";
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
import { INVENTORY_STYLES } from "./inventory-styles.js?v=20260627_inventory_split";
import { invState } from "./inventory-state.js?v=20260627_inventory_split";
import {
  escapeHtml,
  newRowId,
  newGroupId,
  newCategoryId,
  newSubcategoryId,
  sharedInvSort,
  isProductsInventorySub,
  getProductStockForInventoryRow,
  getProductTargetStockForInventoryRow,
  getProductCatSubsList,
  cloneCategoryTree,
  normalizeRowFromFirestore,
  serializeInventoryRowForFirestore,
  defaultInvColWidthsObj,
  cloneInvRowForUndo,
  parseNum,
  parseRowIdFromInventoryItemId,
  getItemOrderQty,
  getItemReceivedCumulative,
  getOrderDetailTotals,
  computeUnifiedStatusFromItems,
  computeReceiveStatusFromItems,
  getEffectiveInventoryOrderStatus,
  orderHasAppliedInventoryImpact,
  getOrderLineReceiveVisualState,
  escapeCsvCell,
  getOrderItemGroupLabel,
  getOrderDetailExportFilename,
  getOrderReceiveSummaryCounts,
  isItemPurchaseAppliedToInventory,
  computeOrder,
  getCellApprovedInfo,
  formatOrderDisplay,
  parseSubcategoryDocToTable,
  buildOrderLinesFromGroupsRows,
  sortOrderBuilderLines,
  seedOrderBuilderSelectionIfEmpty,
  sanitizeManualItemForDraft,
  renderDraftsPickerRowHtml,
  formatInventoryOrderSourceLabel,
  getInventoryOrderDisplayName,
  formatInventoryOrderCreatedAt,
  formatInventoryOrderStatusDisplay,
  getInventoryOrderStatusKey,
  getOrderSearchHaystack,
  formatInventoryOrderOrderedByDisplay,
  clonePlainForFirestoreOrderPayload,
  sanitizeReceiptStorageFileName,
  getReceiptFileTypeEmoji,
  ffParseDateInputStart,
  ffParseDateInputEnd,
  ffResolveItemEventDate,
  invCellKey,
  hrefForUrl,
  renderOrderCellTd,
  thResizeHandle,
  renderInlineNewSub,
  productsInventorySubId,
  isProductsInventorySubId,
  productCategoryIdFromProductsSub,
  productSubcategoryIdFromProductsSub,
  productToInvRow,
  buildProductsInventorySubsForCat,
  sortOrderDetailPairsOpenFirst,
  SHARED_INV_DEFAULT_GROUP_ID,
  INV_PRODUCTS_GENERAL_SUB,
} from "./inventory-helpers.js?v=20260627_inventory_split";

import {
  initInventoryCatalog,
  sharedInvCategoriesRef,
  sharedInvSubcategoriesRef,
  loadInventoryCategoriesFromFirestore,
  persistInventoryCategoryTree,
  importSharedCatalogIntoCurrentBranch,
  getCategoryTree,
  getLegacyCategoryTreeForManage,
  getManageCategoryTree,
  ensureCatManageDraft,
  bindCatManageDnDOnce,
  resetCatModalTransientState,
  ensureValidSubcategorySelection,
  renderSidebarHtml,
  renderManageCategoriesModal,
  renderCategoryDeleteConfirmModal,
} from "./inventory-catalog.js?v=20260627_inventory_catalog";

// Wire inventory.js internals into the Catalog sub-app (breaks the import cycle).
initInventoryCatalog({
  getSalonId,
  mountOrRefreshMockUi,
  _ffInvActiveLocId,
  _ffInvDocInActiveLoc,
  ffCanManageInventory,
  findSubMeta,
  prepareInventoryTableStateForMount,
  sharedInvItemsRef,
  inventoryOrderDraftToast,
});

import {
  initInventoryInsights,
  refreshInventoryInsightsAsync,
  renderInventoryInsightsTabHtml,
  scanInventorySuggestionsOnce,
  scanProductReorderAlertsOnce,
} from "./inventory-insights.js?v=20260627_inventory_insights";

// Wire inventory.js internals into the Insights sub-app (breaks the import
// cycle: orchestrator <-> insights). All five are hoisted function decls.
initInventoryInsights({
  getSalonId,
  getCategoryTree,
  fetchSubcategoryInventoryDoc,
  _ffInvDocInActiveLoc,
  mountOrRefreshMockUi,
});


import {
  initInventoryOrders,
  bindOrderDetailRowLongPressOnce,
  closeInventoryDraftsPicker,
  commitInventoryOrderBuilderAddItem,
  commitOrderLineInventoryPrice,
  confirmInventoryOrderPurchase,
  confirmInventoryOrderReceived,
  createNewInventoryOrderDraft,
  deleteInventoryDraftFromPicker,
  deleteInventoryOrderDraftConfirmed,
  deleteInventoryOrderReceipt,
  duplicateInventoryOrderDraft,
  ensureInventoryOrderReceiptsSubscription,
  ensureShoppingDraft,
  ffAddInventorySuggestionToOrder,
  handleOrderBuilderSourceChange,
  inventoryOrderDraftToast,
  isInvOrderDetailCommitBusy,
  loadInventoryOrderDraft,
  loadInventoryOrdersList,
  loadLinkPickerItemsForSub,
  markInventoryOrderOrderedConfirmed,
  openInventoryDraftsPicker,
  prepareOrderBuilderPreviewForMount,
  refreshOrderBuilderPreviewAsync,
  renameInventoryOrderConfirmed,
  renderInventoryDraftsPickerModal,
  renderInventoryOrderBuilderAddItemModal,
  renderInventoryOrderDetailModal,
  renderInventoryOrdersDeleteModal,
  renderInventoryOrdersMarkOrderedModal,
  renderInventoryOrdersMenu,
  renderInventoryOrdersRenameModal,
  renderOrderDetailLineViewModal,
  renderOrderListSectionHtml,
  renderOrdersTabHtml,
  renderReceiptInfoModal,
  saveInventoryOrderDraft,
  scheduleInventoryOrderDraftSave,
  switchActiveInventoryDraft,
  syncOrderBuilderCategoryCheckboxIndeterminate,
  toggleShoppingRowQty,
  triggerOrderDetailExportCsv,
  triggerOrderDetailPrint,
} from "./inventory-orders.js?v=20260627_inventory_orders2";

// Wire inventory.js internals into the Orders sub-app (breaks the orchestrator
// <-> orders import cycle). inventoryOrderDraftToast now lives in Orders and is
// re-imported above (also passed into initInventoryCatalog).
initInventoryOrders({
  getSalonId,
  mountOrRefreshMockUi,
  _ffInvActiveLocId,
  _ffInvDocInActiveLoc,
  getSelectedSubMeta,
  isInvMobileNarrow,
  loadInventoryTableForSub,
  fetchSubcategoryInventoryDoc,
  findCategoryAndSubForSubId,
});

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
// Permission gate for editing inventory (add/edit/remove items). Defaults to
// allow when the helper isn't available yet so the owner is never hard-blocked.
function ffCanManageInventory() {
  try {
    if (typeof window !== "undefined" && typeof window.ffCurrentUserHasInventoryManagePermission === "function") {
      return window.ffCurrentUserHasInventoryManagePermission();
    }
  } catch (e) {}
  return true;
}

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
/** @type {string | null} */
/** Mobile: full categories panel open (false = compact strip after picking a subcategory). */
/** Create Order: category checkbox panel — hidden until +START NEW ORDER LIST (Inventory tab sidebar unchanged). */

/** Categories tree from Firestore (sidebar + modal draft base). */
/** Last tree successfully loaded or saved (for Firestore diff on Save). */
/** True when the screen is reading account-level shared inventory catalog. */
/** Products mirrored in Inventory (from salons/.../products). */
/** catId -> [{ id, name }] of valid product subcategories (for grouping/general detection). */

/** Table groups for the selected subcategory (`label` in UI maps to `name` in Firestore). */
/** @type {{ id: string, label: string }[] | null} */

/**
 * @typedef {{ id: string, rowNo: string, code: string, name: string, url: string, supplier: string, byGroup: Record<string, { stock: number, current: number, price: string }> }} InvRow
 * @type {InvRow[] | null}
 */

/** When set, that group id shows remove confirmation (not one-click delete). */

/** Second step: centered modal before actual delete (local only). */

/** Deep clone of category tree while Manage Categories modal is open (reorder / edits until Save). */
/** @type {{ kind: 'cat' | 'sub', catId: string, subId?: string } | null} */

/** Manage Categories modal */
/** `${catId}:${subId}` when renaming a subcategory */
/** Open ⋯ menu: `cat:${id}` or `sub:${catId}:${subId}` */
/** Delete confirm modal: { kind, catId, subId?, name } */

/** When set, one inventory table cell is in edit mode: `${inv}:${rowId}` or `${inv}:${rowId}:${groupId}` */

/** Local UI-only column widths (px). `groupSubById` = width per Stock/Current/Order/Price under that group id. */

const INV_MOBILE_COL_HIDE_SS_KEY = "ff_inv_mobile_col_hide_v1";
/** Narrow screens only: hide optional columns to free horizontal space. Stock/Current/Order/Price + Name always stay. */
/** @type {ReturnType<typeof setTimeout> | null} */

/** Row context menu (right-click or ⋯): local UI only */
/** Delete row confirmation modal */

/** Firestore table sync for `salons/.../inventorySubcategories/{subId}` (groups + rows fields). */
/** `${categoryId}:${subId}` when invState._groups/invState._rows match that sub; null if none loaded. */
/** Row drag-reorder: row id being dragged (HTML5 DnD). */

const STYLE_ID = "ff-inv2-mock-styles-v152-order-detail-footer-one-row";

/** One-step undo for row/group delete: delayed Firestore write + toast. */
const INV_UNDO_MS = 5000;
const INV_UNDO_TOAST_ID = "ff-inv-undo-toast";
/** @type {ReturnType<typeof setTimeout> | null} */
/** @type {{ kind: "row"; row: object; index: number } | { kind: "group"; group: { id: string; label: string }; groupIndex: number; perRowCells: Record<string, { stock: number; current: number; price: string }>; groupColWidth: number | null } | null} */

/** Saving draft inventory order to Firestore (UI feedback only). */

/** Main workspace tab inside Inventory screen: table vs order builder vs orders list (placeholder). */

/** Saved inventory orders list (Orders tab). */
/** @type {string | null} */
/** @type {string | null} */
/** Open ⋯ menu for an order row: { orderId, left, top } */
/** @type {string | null} */
/** @type {string | null} */
/** Orders tab: Edit name modal state. */
/** @type {{ orderId: string, draftName: string, busy: boolean } | null} */
/** Orders tab: status filter (display only). */
/** @type {"all" | "open" | "in_progress" | "done"} */
/** Orders tab: search query (display filter only). */
/** Order detail: per-line receive draft (checkbox + qty this batch). Used to seed shopping UI for ordered lines. */
/** @type {Record<string, { checked: boolean[], qty: string[] }>} */
/** Order detail: shopping list (checkbox + qty bought in store). Local only — not persisted to Firestore yet. */
/** @type {Record<string, { checked: boolean[], qtyBought: string[] }>} */
/** Order Details: Confirm Purchase (draft shopping → inventory) in flight. */
/** In flight: order detail line → inventory unit price update. */

/** Order Details line filter (display only). Open = not fully received (includes partial lines). */
/** @type {"all" | "open" | "received"} */
/** Order Builder: name for next Save as Order (local only until saved). */

/** Order detail: receipts subcollection live listener */
/** @type {string | null} */
/** Next receipt upload: note / supplier / amount per order (same payload fields as before; in-memory only). */
/** @type {Record<string, { note: string, supplierName: string, amount: string }>} */
/** @type {string | null} */
/** Order Details: read-only line detail modal (index into order.items); opened via long-press on row. */

/** Order Builder: scope for generated preview (not persisted). */
/** @deprecated kept only to avoid breakage in older cached references; always "custom" now. */
/** Order Builder tree: which category blocks are expanded. Default = collapsed (closed). */
/** @type {Set<string>} */
/** @type {Set<string>} */
/** @type {Array<Record<string, unknown>>} */
/** Order Builder: locally-added manual items (mirror of Firestore draft doc). */
/** @type {Array<Record<string, unknown>>} */
/** Create Order: user overrides for auto-fill line quantities (key = preview line itemId). */
/** @type {Record<string, number>} */

/** Doc id used for the legacy single-draft (migrated on first load). */
const INVENTORY_LEGACY_DRAFT_DOC_ID = "active";
/** Doc id of the currently-active Create Order draft, or null when none exists yet. */
/** @type {string | null} */
/** Whether the active draft has been loaded into memory since entering Inventory. */
/** Whether a draft load is currently in flight. */
/** Debounce timer for persisting draft changes. */
/** In-flight guard (for Save as Order to flush before create). */
/** Draft save status for the UI indicator. */
/** @type {"idle" | "saving" | "saved"} */
/** When the last successful draft save happened (ms). */
/** One-shot "Resumed unfinished draft" toast — show only on the first load per session that actually had items. */
/** Drafts picker modal state. */
/** @type {{ open: boolean, loading: boolean, error: string | null, drafts: Array<{ id: string, isActive: boolean, manualItems: Array<Record<string, unknown>>, orderName: string, createdAt: number, updatedAt: number }> }} */
/** Inventory: Order cell breakdown modal state (long-press). */
/** @type {{ rowId: string, groupId: string, busy: boolean } | null} */

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

async function getSalonId() {
  // Multi-salon: when the user has chosen a salon (single membership auto-
  // selected, or one explicitly picked from Choose Salon), that selection is
  // the source of truth. Reading users/{uid}.salonId first would leak data
  // from the legacy primary salon into whichever salon the user picked.
  if (typeof window !== "undefined" && window.currentSalonId) {
    return String(window.currentSalonId).trim();
  }
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

function getInventoryLocationStateId() {
  return _ffInvActiveLocId() || "default";
}



function sharedInvItemsRef(accountId, catId, subId) {
  return collection(db, `accounts/${accountId}/shared/inventoryCatalog/categories/${catId}/subcategories/${subId}/items`);
}

function sharedInvStateDocRef(accountId, locationId, subId) {
  return doc(db, `accounts/${accountId}/locations/${locationId}/inventoryState/${subId}`);
}


// Target / par level (how many the salon wants to keep). Drives the "Stock"
// column and the Order calculation (Order = Stock - Current).


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



/**
 * Persist full category tree from Manage modal Save. Diff vs invState._persistedCategoryTree.
 * @param {ReturnType<typeof cloneCategoryTree>} desiredTree
 */






/** Move sub between categories or reorder within one category. targetSubId null = append to end of target category. */




function clearInventoryTableSaveTimer() {
  if (invState._invTableSaveTimer) {
    clearTimeout(invState._invTableSaveTimer);
    invState._invTableSaveTimer = null;
  }
}

/** Normalize an approvedRequests[] entry from Firestore (defensive) — keeps required fields only. */

/** Serialize a normalized row to Firestore `rows[]` shape (matches `buildFirestoreRowsFromUi`). */

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

/** Deep clone a row for undo restore (all group cells). */

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

/** Order line `itemId` is `subId:rowId:groupId`; older data may be a plain row id. */

/**
 * Resolve Firestore inventory cell coordinates from a saved order line (auto, linked, or legacy).
 * @returns {{ catId: string, subId: string, rowId: string, groupId: string } | null}
 */

/**
 * Persist a unit price from Order Details to the inventory subcategory row cell + mirror on the order line.
 */

/** Per-line effective progress: cumulative received + applied purchase quantity (treated as received). */

/** Unified order progress computed from items: open (no B yet) / in_progress (some) / done (B ≥ N for all). */

/** Back-compat shim (legacy name). Same result as computeUnifiedStatusFromItems. */

/** Auto-computed status for an order: always derived from items (unified for shopping + delivery). */

/** True if any item already applied to inventory (either via Confirm Purchase or Confirm Receive history). */

/** UI-only: per-line receive state for Order Details row styling. Treats applied purchases (draft → Confirm Purchase) as received progress too. */


/**
 * Receiving list: open / partial lines first, then received; stable within each band.
 * @param {{ it: unknown, idx: number }[]} filteredPairs
 * @returns {{ it: unknown, idx: number }[]}
 */


/** Group label from order line (`groupName`), trimmed — UI/export only; no schema change. */






/** Qty bought persisted on order line (Confirm Purchase). */

/**
 * Ensures local shopping-list state for Order Details (all statuses). Seeds from receive draft when present.
 * Local draft wins over Firestore when the user is editing; otherwise seeds qty/check from order.items (qtyBought, appliedToInventory).
 * @param {string} orderId
 */

/** Order = max(Stock - Current, 0) + max(Approved, 0). Approved is the sum of applied Supply Requests. */

/** Extract approved qty + contributions from a normalized cell (back-compat defaults). */


/** Parse Firestore subcategory doc into local groups/rows without touching global table state. */

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

/** Apply persisted user edits to auto-generated preview line quantities. */

/** Drop override keys that no longer match any preview line (after category changes / refresh). */

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




/** No auto-seeding — user starts with a clean tree and explicitly picks what to include. */

/** Make sure any category that contains a checked subcategory stays expanded so the selection is visible. */







/** Fill category/subcategory on a preview line from the category tree when missing. */

/**
 * Draft document source fields from current Order Builder mode (not sidebar alone).
 * @returns {{ sourceType: string, sourceSelection: object, categoryId: string | null, categoryName: string | null, subcategoryId: string | null, subcategoryName: string | null } | null}
 */



/** Async: load items (row × group) for a subcategory for the link picker. */




/** Sanitize a manual item so it's safe to persist (no functions/undefineds). */

/**
 * Apply a draft doc snapshot into local state.
 * @param {string} docId Firestore doc id
 * @param {Record<string, unknown>} d Doc data
 */

/** Load the active Create Order draft from Firestore into local state. Called on tab entry. */

/** Debounced save of the active draft. Called after every local mutation. */

/** Update the Draft status chip in-place without re-rendering the whole Create Order tab. */

/** Immediate write of current state to the active draft doc. Creates a new draft on first write. */

/** Format a draft entry for the picker. */

/** Modal listing all drafts — clicking the Draft chip opens this. */

/** Open the drafts picker and fetch the list. */


/** Switch the active draft to the given doc id. */

/** Delete a draft from Firestore. If it was the active one, reset local state. */

/**
 * Start a fresh draft: deactivate the current one (if any) so it remains in Firestore
 * as a non-active draft, and clear local state. A new Firestore doc is created lazily
 * on the first mutation via flushInventoryOrderDraftSave().
 */

/** Remove the active draft entirely (after Save as Order). Other drafts are untouched. */

function renderInventoryTableCardHtml() {
  let sharedBtnLabel = "+ Add from Shared";
  let narrow = false;
  try {
    if (typeof matchMedia !== "undefined" && matchMedia("(max-width: 767.98px)").matches) {
      sharedBtnLabel = "+ Shared";
      narrow = true;
    }
  } catch (_) {}
  const colsBtn =
    narrow
      ? `<button type="button" class="ff-inv2-btn ff-inv2-btn--toolbar-cols" id="ff-inv2-mobile-cols-reset" title="Bring back #, Code, Supplier, URL, or drag column after hiding them (double-tap a header to hide).">Columns</button>`
      : "";
  const meta = getSelectedSubMeta();
  const productsMode = meta && isProductsInventorySub(meta.sub);
  const toolbar = productsMode
    ? `<div class="ff-inv2-toolbar">
        <span class="ff-inv2-products-hint" style="font-size:12px;color:#6b7280;line-height:1.45;padding:2px 0;">Stock saves to Products. Add or edit products in the Products app.</span>
        ${colsBtn}
      </div>`
    : `<div class="ff-inv2-toolbar">
        <button type="button" class="ff-inv2-btn" id="ff-inv2-add-row">+ Add Row</button>
        <button type="button" class="ff-inv2-btn" id="ff-inv2-add-group">+ Add Group</button>
        ${colsBtn}
        <button type="button" class="ff-inv2-btn ff-inv2-btn--toolbar-shared" id="ff-inv2-add-from-shared">${escapeHtml(
          sharedBtnLabel
        )}</button>
      </div>`;
  return `<div class="ff-inv2-table-card">
      ${toolbar}
      <div class="ff-inv2-table-scroll">
        <table class="ff-inv2-table">
          ${renderTableHeaderHtml()}
          <tbody>${renderTableBodyHtml()}</tbody>
        </table>
      </div>
    </div>`;
}

function renderInvMainTabsHtml() {
  let tabs = [
    { id: "inventory", label: "Inventory" },
    { id: "orderBuilder", label: "Create Order" },
    { id: "orders", label: "Orders" },
    { id: "insights", label: "Insights" },
  ];
  // View-only users only get the read-only Inventory tab. Create Order, Orders
  // and Insights are management surfaces and stay hidden for them.
  if (!ffCanManageInventory()) {
    tabs = tabs.filter((x) => x.id === "inventory");
  }
  return `<div class="ff-inv2-main-tabs" role="tablist" aria-label="Inventory workspace">
${tabs
  .map((x) => {
    const active = invState._invMainTab === x.id;
    return `    <button type="button" role="tab" class="ff-inv2-main-tab${active ? " ff-inv2-main-tab--active" : ""}" aria-selected="${active ? "true" : "false"}" data-inv-main-tab="${escapeHtml(x.id)}">${escapeHtml(x.label)}</button>`;
  })
  .join("\n")}
  </div>`;
}

/** Readable source label for a saved inventory order document. */



/**
 * @param {{ silent?: boolean } | undefined} opts
 * If silent, skip full-screen loading state (e.g. after duplicate/delete).
 */




/**
 * Confirm receive from Order Details: checked lines only; updates `items[].receivedCumulative`, status, inventory `current`.
 * @param {string} orderId
 */

/**
 * Draft orders only: apply shopping-list "Qty bought" to inventory `current` + persist qtyBought / appliedToInventory on order lines.
 * Skips inventory when already applied and qty unchanged; applies delta when qty changed after apply.
 * @param {string} orderId
 */







/** Pick a small emoji based on file extension for quick visual cue. */

/** Receipt list block for Receipt information modal only (uses live receipts listener). */




// ---- Inventory Insights ----------------------------------------------------

/** @type {"30d" | "60d" | "120d" | "year" | "all" | "custom"} */
/** @type {"overview" | "purchases" | "forecast" | "health"} */
/** @type {Array<{ key: string, name: string, totalQty: number }>} */
/** KPI summary for the selected range. */
/** Per-cell usage + days-left forecast, sorted ascending by daysLeft. */
/** @type {Array<{ catId: string, subId: string, rowId: string, groupId: string, itemName: string, groupName: string, categoryName: string, subcategoryName: string, current: number, stock: number, dailyRate: number, daysLeft: number, level: "critical" | "low" | "ok" }>} */
/** Smart reorder suggestions — subset of usage with daysLeft ≤ threshold. */
/** Spend grouped by categoryName for the selected range. */
/** @type {Array<{ name: string, spend: number, percent: number }>} */
/** Running-low cells: current ≤ threshold × stock (requires stock > 0). */
/** @type {Array<{ catId: string, subId: string, rowId: string, groupId: string, itemName: string, groupName: string, subcategoryName: string, categoryName: string, stock: number, current: number, pctLeft: number }>} */
/** Dead stock cells: current > 0 but no purchase activity in range. */
/** @type {Array<{ catId: string, subId: string, rowId: string, groupId: string, itemName: string, groupName: string, subcategoryName: string, categoryName: string, current: number }>} */

/** Convert local YYYY-MM-DD input value to a JS Date (start of day local time). */

/** Convert local YYYY-MM-DD input value to end of day. */

/** Resolve the active range to absolute { from, to } JS Dates. `all` returns from=null. */

/** Best-effort timestamp resolution for an order item event (purchase apply / receive). */

/** Compute the previous comparison period [from, to] matching the currently-selected range. */

/** One-shot guard so the suggestion scan runs only once per app session. */

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

/** One-shot guard so the product reorder-point scan runs only once per session. */

/**
 * Product Reorder-Point Alerts — scans the Products catalog and creates an Inbox
 * alert (type="inventory_suggestion", data.kind="reorder_point") whenever a
 * product's current stock is at or below its Reorder Point.
 *
 * Rules:
 *   - Only products with a Reorder Point > 0 are considered.
 *   - Current stock & reorder point honor the active location override.
 *   - Fire when current <= reorderPoint.
 *   - suggestedQty = (target - current) when a target is set above current,
 *     otherwise the reorder point. Always >= 1.
 *   - Skip if any reorder-point alert (any status) already exists for the product.
 */

// Exposed so the Products app can trigger an immediate reorder-point re-scan
// right after a stock edit (force=true bypasses the once-per-session guard).
try {
  if (typeof window !== "undefined") {
    window.ffScanProductReorderAlerts = (force) => { void scanProductReorderAlertsOnce(force !== false); };
  }
} catch (_) {}


/** Fixed palette for donut slices. Shared across charts so colors stay consistent. */

/** Build an SVG donut chart from [{ name, spend, percent }] rows. Returns "" when empty. */










function renderInvMainTabPanelsHtml() {
  if (invState._invMainTab === "orderBuilder") {
    return `<div class="ff-inv2-main-tab-body ff-inv2-main-tab-body--order">
      <div class="ff-inv2-order-builder-wrap">${renderOrderListSectionHtml()}</div>
    </div>`;
  }
  if (invState._invMainTab === "orders") {
    return `<div class="ff-inv2-main-tab-body ff-inv2-main-tab-body--orders">${renderOrdersTabHtml()}</div>`;
  }
  if (invState._invMainTab === "insights") {
    return `<div class="ff-inv2-main-tab-body ff-inv2-main-tab-body--insights">${renderInventoryInsightsTabHtml()}</div>`;
  }
  return `<div class="ff-inv2-main-tab-body ff-inv2-main-tab-body--inventory">${renderInventoryTableCardHtml()}</div>`;
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
  const isEditing = invState._editCellKey === key;
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

function renderUrlCell(rowId, value) {
  const key = invCellKey("url", rowId);
  const isEditing = invState._editCellKey === key;
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

function handleInvEditOutsideClick(ev) {
  if (!invState._editCellKey) return;
  const invScreen = document.getElementById("inventoryScreen");
  if (!invScreen || invScreen.style.display === "none") return;
  if (!invScreen.contains(ev.target)) {
    invState._editCellKey = null;
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
    invState._editCellKey = null;
    mountOrRefreshMockUi();
    return;
  }
  invState._editCellKey = null;
  mountOrRefreshMockUi();
}

function ensureInvEditDocListenerOnce() {
  if (document.documentElement.dataset.ffInvEditDoc === "1") return;
  document.documentElement.dataset.ffInvEditDoc = "1";
  document.addEventListener("click", handleInvEditOutsideClick, true);
}

function getInvColWidths() {
  if (!invState._invColWidths) {
    invState._invColWidths = {
      rowDnd: 28,
      hash: 52,
      code: 76,
      name: 192,
      groupSubById: {},
      url: 96,
      supplier: 96,
    };
  }
  if (invState._groups) {
    for (const g of invState._groups) {
      if (invState._invColWidths.groupSubById[g.id] == null) {
        invState._invColWidths.groupSubById[g.id] = 72;
      }
    }
    const ids = new Set(invState._groups.map((x) => x.id));
    for (const k of Object.keys(invState._invColWidths.groupSubById)) {
      if (!ids.has(k)) delete invState._invColWidths.groupSubById[k];
    }
  }
  if (invState._invColWidths.rowDnd == null) invState._invColWidths.rowDnd = 28;
  return invState._invColWidths;
}

function isInvMobileNarrow() {
  try {
    return typeof matchMedia !== "undefined" && matchMedia("(max-width: 767.98px)").matches;
  } catch (_) {
    return false;
  }
}

function loadInvMobileColHideFromStorage() {
  try {
    const s = sessionStorage.getItem(INV_MOBILE_COL_HIDE_SS_KEY);
    if (!s) return;
    const o = JSON.parse(s);
    if (o && typeof o === "object") {
      invState._invMobileColHide = {
        ...invState._invMobileColHide,
        dnd: !!o.dnd,
        num: !!o.num,
        code: !!o.code,
        supplier: !!o.supplier,
        url: !!o.url,
        nameExpanded: !!o.nameExpanded,
      };
    }
  } catch (_) {}
}

function persistInvMobileColHide() {
  try {
    sessionStorage.setItem(INV_MOBILE_COL_HIDE_SS_KEY, JSON.stringify(invState._invMobileColHide));
  } catch (_) {}
}

function applyInvMobileColumnClasses() {
  const root = document.getElementById("inventoryScreen");
  if (!root) return;
  loadInvMobileColHideFromStorage();
  if (!isInvMobileNarrow()) {
    root.classList.remove(
      "ff-inv-mobile-hide-dnd",
      "ff-inv-mobile-hide-num",
      "ff-inv-mobile-hide-code",
      "ff-inv-mobile-hide-supplier",
      "ff-inv-mobile-hide-url",
      "ff-inv-mobile-name-expanded"
    );
  } else {
    root.classList.toggle("ff-inv-mobile-hide-dnd", !!invState._invMobileColHide.dnd);
    root.classList.toggle("ff-inv-mobile-hide-num", !!invState._invMobileColHide.num);
    root.classList.toggle("ff-inv-mobile-hide-code", !!invState._invMobileColHide.code);
    root.classList.toggle("ff-inv-mobile-hide-supplier", !!invState._invMobileColHide.supplier);
    root.classList.toggle("ff-inv-mobile-hide-url", !!invState._invMobileColHide.url);
    root.classList.toggle("ff-inv-mobile-name-expanded", !!invState._invMobileColHide.nameExpanded);
  }
  syncInvColWidthsToDom();
}

function toggleInvMobileOptionalCol(key) {
  if (key === "dnd") invState._invMobileColHide.dnd = !invState._invMobileColHide.dnd;
  else if (key === "num") invState._invMobileColHide.num = !invState._invMobileColHide.num;
  else if (key === "code") invState._invMobileColHide.code = !invState._invMobileColHide.code;
  else if (key === "supplier") invState._invMobileColHide.supplier = !invState._invMobileColHide.supplier;
  else if (key === "url") invState._invMobileColHide.url = !invState._invMobileColHide.url;
  else return;
  persistInvMobileColHide();
  applyInvMobileColumnClasses();
}

/** Mobile: restore #, Code, drag, Supplier, URL after hiding via double-tap header. */
function resetInvMobileOptionalColumns() {
  invState._invMobileColHide.dnd = false;
  invState._invMobileColHide.num = false;
  invState._invMobileColHide.code = false;
  invState._invMobileColHide.supplier = false;
  invState._invMobileColHide.url = false;
  persistInvMobileColHide();
  applyInvMobileColumnClasses();
}

function invMobileAnyOptionalColumnHidden() {
  const h = invState._invMobileColHide;
  return !!(h.dnd || h.num || h.code || h.supplier || h.url);
}


function ensureInvMobileColHeaderBindOnce() {
  if (document.documentElement.dataset.ffInvMobileColBind === "1") return;
  document.documentElement.dataset.ffInvMobileColBind = "1";
  let resizeT = null;
  window.addEventListener(
    "resize",
    () => {
      if (resizeT) clearTimeout(resizeT);
      resizeT = setTimeout(() => applyInvMobileColumnClasses(), 150);
    },
    { passive: true }
  );

  document.addEventListener(
    "touchend",
    (ev) => {
      if (!isInvMobileNarrow()) return;
      const th = ev.target && ev.target.closest && ev.target.closest("#inventoryScreen th[data-inv-mobile-col]");
      if (!th) return;
      if (ev.target.closest && ev.target.closest(".col-resize-handle")) return;
      const key = th.getAttribute("data-inv-mobile-col");
      if (!key) return;

      if (key === "name") {
        if (invState._invNameHeaderTapTimer) {
          clearTimeout(invState._invNameHeaderTapTimer);
          invState._invNameHeaderTapTimer = null;
          invState._invMobileColHide.nameExpanded = false;
          persistInvMobileColHide();
          applyInvMobileColumnClasses();
        } else {
          invState._invNameHeaderTapTimer = setTimeout(() => {
            invState._invNameHeaderTapTimer = null;
            invState._invMobileColHide.nameExpanded = true;
            persistInvMobileColHide();
            applyInvMobileColumnClasses();
          }, 320);
        }
        return;
      }

      const now = ev.timeStamp || Date.now();
      const touch = ev.changedTouches && ev.changedTouches[0];
      const x = touch ? touch.clientX : 0;
      const y = touch ? touch.clientY : 0;
      const dt = now - invState._invMobColLastTouch.t;
      const same =
        invState._invMobColLastTouch.key === key &&
        dt < 420 &&
        dt > 30 &&
        Math.abs(x - invState._invMobColLastTouch.x) < 48 &&
        Math.abs(y - invState._invMobColLastTouch.y) < 48;
      if (same) {
        toggleInvMobileOptionalCol(key);
        invState._invMobColLastTouch = { t: 0, key: "", x: 0, y: 0 };
      } else {
        invState._invMobColLastTouch = { t: now, key, x, y };
      }
    },
    { passive: true, capture: true }
  );

  document.addEventListener(
    "dblclick",
    (ev) => {
      if (!isInvMobileNarrow()) return;
      const th = ev.target && ev.target.closest && ev.target.closest("#inventoryScreen th[data-inv-mobile-col]");
      if (!th) return;
      if (ev.target.closest && ev.target.closest(".col-resize-handle")) return;
      const key = th.getAttribute("data-inv-mobile-col");
      if (!key) return;
      ev.preventDefault();
      if (key === "name") {
        if (invState._invNameHeaderTapTimer) {
          clearTimeout(invState._invNameHeaderTapTimer);
          invState._invNameHeaderTapTimer = null;
        }
        invState._invMobileColHide.nameExpanded = false;
        persistInvMobileColHide();
        applyInvMobileColumnClasses();
        return;
      }
      toggleInvMobileOptionalCol(key);
    },
    true
  );
}

/**
 * Mobile only: tight widths per Stock / Current / Order / Price from longest cell in each
 * logical column (so a wide Price does not widen Current). Desktop: one width for all four.
 * @returns {[number, number, number, number]}
 */
function getInvMobileGroupSubColWidthsPx(w, groupId) {
  const base = w.groupSubById[groupId] ?? 72;
  const one = () => {
    const b = base;
    return /** @type {[number, number, number, number]} */ ([b, b, b, b]);
  };
  if (!isInvMobileNarrow()) return one();

  const capNum = Math.min(72, base);
  const capPrice = Math.min(112, base + 32);
  const tightLen = (maxLen, minPx, capPx) => {
    const t = Math.ceil(12 + maxLen * 8);
    return Math.max(minPx, Math.min(capPx, t));
  };

  if (!Array.isArray(invState._rows) || invState._rows.length === 0) {
    return /** @type {[number, number, number, number]} */ ([
      Math.min(capNum, 46),
      Math.min(capNum, 46),
      Math.min(capNum, 46),
      Math.min(capPrice, 56),
    ]);
  }

  let maxStock = 1;
  let maxCur = 1;
  let maxOrd = 1;
  let maxPrice = 1;
  for (const row of invState._rows) {
    const v = row.byGroup && row.byGroup[groupId];
    if (!v) continue;
    const { approved } = getCellApprovedInfo(v);
    const order = computeOrder(v.stock, v.current, approved);
    const stockN = typeof v.stock === "number" ? v.stock : parseNum(v.stock);
    const curN = typeof v.current === "number" ? v.current : parseNum(v.current);
    const stockS = String(formatOrderDisplay(stockN) || "").replace(/\s/g, "");
    const curS = String(formatOrderDisplay(curN) || "").replace(/\s/g, "");
    const ordS = String(formatOrderDisplay(order) || "").replace(/\s/g, "");
    const priceS = String(v.price != null ? v.price : "")
      .trim()
      .replace(/\s/g, "");
    if (stockS.length > maxStock) maxStock = stockS.length;
    if (curS.length > maxCur) maxCur = curS.length;
    if (ordS.length > maxOrd) maxOrd = ordS.length;
    if (priceS.length > maxPrice) maxPrice = priceS.length;
  }

  return /** @type {[number, number, number, number]} */ ([
    tightLen(maxStock, 32, capNum),
    tightLen(maxCur, 32, capNum),
    tightLen(maxOrd, 32, capNum),
    tightLen(maxPrice, 38, capPrice),
  ]);
}

function computeInvTableScrollClientWidth(root) {
  const sc = root && root.querySelector && root.querySelector(".ff-inv2-table-scroll");
  let cw = sc && sc.clientWidth ? sc.clientWidth : 0;
  if (!cw) {
    try {
      cw = Math.max(280, Math.floor(window.innerWidth));
    } catch (_) {
      cw = 360;
    }
  }
  return cw;
}

/** After mount, horizontal layout may be 0 until flex finishes — sync col widths again. */
function scheduleSyncInvColWidthsAfterLayout() {
  if (typeof requestAnimationFrame !== "undefined") {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        syncInvColWidthsToDom();
      });
    });
  } else {
    setTimeout(() => syncInvColWidthsToDom(), 0);
  }
}

function renderColgroup() {
  if (invState._groups === null) return "";
  const w = getInvColWidths();
  const rd = w.rowDnd ?? 28;
  let nameColW = w.name;
  if (isInvMobileNarrow()) {
    try {
      nameColW = Math.min(w.name, Math.max(92, Math.floor(window.innerWidth * 0.34)));
    } catch (_) {
      nameColW = Math.min(w.name, 140);
    }
  }
  const parts = [];
  parts.push(`<col style="width:${rd}px;min-width:${rd}px" />`);
  parts.push(`<col style="width:${w.hash}px;min-width:${w.hash}px" />`);
  parts.push(`<col style="width:${w.code}px;min-width:${w.code}px" />`);
  parts.push(`<col style="width:${nameColW}px;min-width:${nameColW}px" />`);
  for (const g of invState._groups) {
    const w4 = getInvMobileGroupSubColWidthsPx(w, g.id);
    for (let c = 0; c < 4; c++) {
      const cw = w4[c];
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
  if (!table || invState._groups === null) return;
  const w = getInvColWidths();
  const cols = table.querySelectorAll("colgroup col");
  if (!cols.length) return;
  const mobile = isInvMobileNarrow();
  const mh = invState._invMobileColHide;
  const rdFull = w.rowDnd ?? 28;
  const rd = mobile && mh.dnd ? 0 : rdFull;
  const hashW = mobile && mh.num ? 0 : w.hash;
  const codeW = mobile && mh.code ? 0 : w.code;
  const supW = mobile && mh.supplier ? 0 : w.supplier;
  const urlW = mobile && mh.url ? 0 : w.url;

  let sumFixedAfterName = rd + hashW + codeW;
  for (const g of invState._groups) {
    const w4 = getInvMobileGroupSubColWidthsPx(w, g.id);
    for (const cw of w4) sumFixedAfterName += cw;
  }
  sumFixedAfterName += supW + urlW;

  const pad = 20;
  let namePx = w.name;
  if (mobile) {
    const cw = computeInvTableScrollClientWidth(root);
    const rem = Math.max(92, cw - sumFixedAfterName - pad);
    const capped = Math.max(92, Math.min(w.name, rem));
    namePx = w.name >= rem - 2 ? rem : capped;
  }

  table.style.setProperty("--inv-sticky-hash-left", `${rd}px`);
  table.style.setProperty("--inv-sticky-code-left", `${rd + hashW}px`);
  table.style.setProperty("--inv-sticky-name-left", `${rd + hashW + codeW}px`);
  let i = 0;
  cols[i].style.width = `${rd}px`;
  cols[i].style.minWidth = `${rd}px`;
  i++;
  cols[i].style.width = `${hashW}px`;
  cols[i].style.minWidth = `${hashW}px`;
  i++;
  cols[i].style.width = `${codeW}px`;
  cols[i].style.minWidth = `${codeW}px`;
  i++;
  cols[i].style.width = `${namePx}px`;
  cols[i].style.minWidth = mobile ? "92px" : `${Math.max(120, w.name)}px`;
  i++;
  for (const g of invState._groups) {
    const w4 = getInvMobileGroupSubColWidthsPx(w, g.id);
    for (let c = 0; c < 4; c++) {
      const cw = w4[c];
      cols[i].style.width = `${cw}px`;
      cols[i].style.minWidth = `${cw}px`;
      i++;
    }
  }
  if (cols[i]) {
    cols[i].style.width = `${supW}px`;
    cols[i].style.minWidth = `${supW}px`;
    i++;
  }
  if (cols[i]) {
    cols[i].style.width = `${urlW}px`;
    cols[i].style.minWidth = `${urlW}px`;
  }
}

function bindInvColumnResizeOnce() {
  if (document.documentElement.dataset.ffInvColResizeBound === "1") return;
  document.documentElement.dataset.ffInvColResizeBound = "1";
  let drag = null;

  function onMove(e) {
    if (!drag) return;
    if (e.pointerId != null && drag.pointerId != null && e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    const dx = e.clientX - drag.startX;
    const st = getInvColWidths();
    if (drag.kind === "hash") st.hash = Math.max(60, Math.round(drag.startWidth + dx));
    else if (drag.kind === "code") st.code = Math.max(60, Math.round(drag.startWidth + dx));
    else if (drag.kind === "name")
      st.name = Math.max(isInvMobileNarrow() ? 92 : 120, Math.round(drag.startWidth + dx));
    else if (drag.kind === "url") st.url = Math.max(60, Math.round(drag.startWidth + dx));
    else if (drag.kind === "supplier") st.supplier = Math.max(60, Math.round(drag.startWidth + dx));
    else if (drag.kind === "group" && drag.groupId) {
      st.groupSubById[drag.groupId] = Math.max(60, Math.round(drag.startWidth + dx));
    }
    syncInvColWidthsToDom();
  }

  function onUp(e) {
    if (e && e.pointerId != null && drag && drag.pointerId != null && e.pointerId !== drag.pointerId) return;
    const hadDrag = !!drag;
    const el = drag && drag.handleEl;
    const pid = drag && drag.pointerId;
    if (el && pid != null) {
      try {
        el.releasePointerCapture(pid);
      } catch (_) {}
    }
    if (drag) {
      drag = null;
      document.body.style.userSelect = "";
    }
    document.removeEventListener("pointermove", onMove, true);
    document.removeEventListener("pointerup", onUp, true);
    document.removeEventListener("pointercancel", onUp, true);
    if (hadDrag) {
      void persistColumnWidthsToFirestore().catch((err) => console.error("[Inventory] column widths save failed", err));
      scheduleSyncInvColWidthsAfterLayout();
    }
  }

  function startDrag(h, clientX, pointerId) {
    const kind = h.getAttribute("data-inv-resize");
    const st = getInvColWidths();
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
    drag = {
      kind,
      startX: clientX,
      startWidth,
      groupId: h.getAttribute("data-group-id"),
      pointerId: pointerId != null ? pointerId : undefined,
      handleEl: h,
    };
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
  }

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.isPrimary === false) return;
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const h = e.target.closest("#inventoryScreen .ff-inv2-table .col-resize-handle");
      if (!h) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        h.setPointerCapture(e.pointerId);
      } catch (_) {}
      startDrag(h, e.clientX, e.pointerId);
    },
    true
  );
}

function ensureGroupCellsForRows() {
  if (!invState._groups || !invState._rows) return;
  for (const row of invState._rows) {
    if (row.rowNo === undefined) row.rowNo = "";
    for (const g of invState._groups) {
      if (!row.byGroup[g.id]) {
        row.byGroup[g.id] = { stock: 0, current: 0, price: "" };
      }
    }
  }
}

function addInventoryRow() {
  if (!ffCanManageInventory()) return;
  if (!ensureTableReadyForEdits()) return;
  invState._manageCategoriesOpen = false;
  invState._catManageDraftTree = null;
  resetCatModalTransientState();
  invState._groupRemoveConfirmId = null;
  invState._groupRemoveModalGroupId = null;
  const row = {
    id: newRowId(),
    rowNo: "",
    code: "",
    name: "",
    url: "",
    supplier: "",
    byGroup: {},
  };
  for (const g of invState._groups) {
    row.byGroup[g.id] = { stock: 0, current: 0, price: "" };
  }
  invState._rows.push(row);
  void flushInventoryTableToFirestore().catch((e) => console.error("[Inventory] table save failed", e));
}

function duplicateInventoryRow(rowId) {
  if (!ffCanManageInventory()) return;
  if (!ensureTableReadyForEdits()) return;
  const idx = invState._rows.findIndex((r) => r.id === rowId);
  if (idx < 0) return;
  const src = invState._rows[idx];
  const byGroup = {};
  for (const g of invState._groups) {
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
  invState._rows.splice(idx + 1, 0, row);
  void flushInventoryTableToFirestore().catch((e) => console.error("[Inventory] table save failed", e));
}

function deleteInventoryRow(rowId) {
  if (!ffCanManageInventory()) return;
  void (async () => {
    if (!invState._rows) return;
    const idx = invState._rows.findIndex((r) => r.id === rowId);
    if (idx < 0) return;
    if (invState._rows[idx]._isProductRow) return;
    try {
      await commitPendingInventoryDeleteIfAny();
    } catch (e) {
      console.error("[Inventory] commit pending delete failed", e);
      return;
    }
    const rowClone = cloneInvRowForUndo(invState._rows[idx]);
    invState._rows = invState._rows.filter((r) => r.id !== rowId);
    startInventoryUndo({ kind: "row", row: rowClone, index: idx });
    mountOrRefreshMockUi();
  })();
}

/** Reorder invState._rows only; does not touch rowNo. */
function reorderInventoryRowsInPlace(dragRowId, targetRowId, placeBefore) {
  if (!ffCanManageInventory()) return;
  if (dragRowId === targetRowId || !invState._rows) return;
  const fi = invState._rows.findIndex((r) => r.id === dragRowId);
  const ti = invState._rows.findIndex((r) => r.id === targetRowId);
  if (fi < 0 || ti < 0) return;
  const [item] = invState._rows.splice(fi, 1);
  let insertIdx = ti;
  if (fi < ti) insertIdx--;
  if (!placeBefore) insertIdx++;
  invState._rows.splice(insertIdx, 0, item);
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
    invState._invRowDndDragId = rowId;
    try {
      ev.dataTransfer.setData("text/plain", `row:${rowId}`);
      ev.dataTransfer.effectAllowed = "move";
    } catch (e) {}
    const tr = h.closest("tr[data-inv-row-id]");
    if (tr) tr.classList.add("ff-inv2-row-dnd-dragging");
  });

  root.addEventListener("dragend", () => {
    invState._invRowDndDragId = null;
    clearOver();
    root.querySelectorAll(".ff-inv2-row-dnd-dragging").forEach((el) => el.classList.remove("ff-inv2-row-dnd-dragging"));
  });

  root.addEventListener("dragover", (ev) => {
    if (!invState._invRowDndDragId) return;
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const tr = t.closest("tbody tr[data-inv-row-id]");
    if (!tr || !root.contains(tr)) return;
    const tid = tr.getAttribute("data-inv-row-id");
    if (!tid || tid === invState._invRowDndDragId) return;
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
    if (!invState._invRowDndDragId || !invState._rows) return;
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const tr = t.closest("tbody tr[data-inv-row-id]");
    if (!tr || !root.contains(tr)) return;
    const tid = tr.getAttribute("data-inv-row-id");
    if (!tid || tid === invState._invRowDndDragId) {
      clearOver();
      ev.preventDefault();
      return;
    }
    ev.preventDefault();
    clearOver();
    const rect = tr.getBoundingClientRect();
    const placeBefore = ev.clientY < rect.top + rect.height / 2;
    reorderInventoryRowsInPlace(invState._invRowDndDragId, tid, placeBefore);
    invState._invRowDndDragId = null;
    root.querySelectorAll(".ff-inv2-row-dnd-dragging").forEach((el) => el.classList.remove("ff-inv2-row-dnd-dragging"));
    void flushInventoryTableToFirestore().catch((e) => console.error("[Inventory] table save after reorder failed", e));
    mountOrRefreshMockUi();
  });
}

function addInventoryGroup() {
  if (!ffCanManageInventory()) return;
  if (!ensureTableReadyForEdits()) return;
  invState._manageCategoriesOpen = false;
  invState._catManageDraftTree = null;
  resetCatModalTransientState();
  invState._groupRemoveConfirmId = null;
  invState._groupRemoveModalGroupId = null;
  const gid = newGroupId();
  invState._groups.push({ id: gid, label: "New group" });
  for (const row of invState._rows) {
    row.byGroup[gid] = { stock: 0, current: 0, price: "" };
  }
  void flushInventoryTableToFirestore().catch((e) => console.error("[Inventory] table save failed", e));
}

function removeInventoryGroup(groupId) {
  if (!ffCanManageInventory()) return;
  void (async () => {
    if (!ensureTableReadyForEdits() || !groupId) return;
    const gi = invState._groups.findIndex((g) => g.id === groupId);
    if (gi < 0) return;
    try {
      await commitPendingInventoryDeleteIfAny();
    } catch (e) {
      console.error("[Inventory] commit pending delete failed", e);
      return;
    }
    const group = { id: invState._groups[gi].id, label: invState._groups[gi].label };
    const perRowCells = {};
    for (const row of invState._rows) {
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

    invState._groups = invState._groups.filter((g) => g.id !== groupId);
    for (const row of invState._rows) {
      try {
        delete row.byGroup[groupId];
      } catch (e) {}
    }
    if (invState._groupRemoveConfirmId === groupId) invState._groupRemoveConfirmId = null;
    if (invState._groupRemoveModalGroupId === groupId) invState._groupRemoveModalGroupId = null;
    startInventoryUndo({ kind: "group", group, groupIndex: gi, perRowCells, groupColWidth });
    mountOrRefreshMockUi();
  })();
}

/** True if any row has non-zero stock/current or non-empty price in this group. */
function groupHasAnyValues(groupId) {
  if (!invState._rows) return false;
  for (const row of invState._rows) {
    const c = row.byGroup[groupId];
    if (!c) continue;
    if (parseNum(c.stock) !== 0 || parseNum(c.current) !== 0) return true;
    if (String(c.price ?? "").trim() !== "") return true;
  }
  return false;
}

function updateOrderCellEl(rowId, groupId) {
  const row = invState._rows?.find((r) => r.id === rowId);
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
    invState._invOrderSaveNameDraft = t.value;
    scheduleInventoryOrderDraftSave();
    return;
  }
  // Inline qty editing for a manual Order-list line.
  if (t.hasAttribute("data-inv-ob-manual-qty")) {
    const lid = t.getAttribute("data-inv-ob-manual-qty");
    if (lid) {
      const idx = invState._invOrderBuilderManualLines.findIndex((L) => L && L.id === lid);
      if (idx >= 0) {
        const n = Number(t.value);
        invState._invOrderBuilderManualLines[idx].orderQty = Number.isFinite(n) && n > 0 ? n : 0;
        scheduleInventoryOrderDraftSave();
      }
    }
    return;
  }
  if (t.hasAttribute("data-inv-ob-auto-qty")) {
    const iid = t.getAttribute("data-inv-ob-auto-qty");
    if (iid) {
      const n = Number(t.value);
      const q = Number.isFinite(n) && n >= 0 ? n : 0;
      invState._invOrderBuilderAutoQtyOverrides[iid] = q;
      const idx = invState._invOrderBuilderPreviewLines.findIndex((L) => L && String(L.itemId) === iid);
      if (idx >= 0) invState._invOrderBuilderPreviewLines[idx].orderQty = q;
      scheduleInventoryOrderDraftSave();
    }
    return;
  }
  if (t.hasAttribute("data-inv-ob-add-input")) {
    if (!invState._invOrderBuilderAddModal) return;
    const field = t.getAttribute("data-inv-ob-add-input");
    if (field === "name") {
      invState._invOrderBuilderAddModal.draftName = t.value;
      const root = document.getElementById("inventoryScreen");
      const addBtn = root && root.querySelector("[data-inv-ob-add-commit]");
      if (addBtn instanceof HTMLButtonElement) {
        const can =
          String(invState._invOrderBuilderAddModal.draftName).trim() !== "" &&
          parseNum(invState._invOrderBuilderAddModal.draftQty) > 0;
        addBtn.disabled = !can;
      }
    } else if (field === "qty") {
      invState._invOrderBuilderAddModal.draftQty = t.value;
      const root = document.getElementById("inventoryScreen");
      const addBtn = root && root.querySelector("[data-inv-ob-add-commit]");
      if (addBtn instanceof HTMLButtonElement) {
        const can =
          String(invState._invOrderBuilderAddModal.draftName).trim() !== "" &&
          parseNum(invState._invOrderBuilderAddModal.draftQty) > 0;
        addBtn.disabled = !can;
      }
    }
    return;
  }
  if (t.hasAttribute("data-inv-orders-rename-input")) {
    if (invState._invOrdersRenameModal) invState._invOrdersRenameModal.draftName = t.value;
    return;
  }
  if (t.hasAttribute("data-inv-orders-search-input")) {
    const selStart = t.selectionStart;
    const selEnd = t.selectionEnd;
    invState._invOrdersSearchQuery = t.value;
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
    invState._invInsightsCustomFrom = t.value;
    if (invState._invInsightsRange === "custom") void refreshInventoryInsightsAsync();
    return;
  }
  if (t.hasAttribute("data-inv-insights-to")) {
    invState._invInsightsCustomTo = t.value;
    if (invState._invInsightsRange === "custom") void refreshInventoryInsightsAsync();
    return;
  }
  if (t.hasAttribute("data-inv-insights-range-select")) {
    const v = t.value;
    const allowed = ["30d", "60d", "120d", "year", "all", "custom"];
    if (allowed.includes(v) && invState._invInsightsRange !== v) {
      invState._invInsightsRange = v;
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
      if (!invState._invOrderShoppingDraft[oid]) invState._invOrderShoppingDraft[oid] = { checked: [], qtyBought: [] };
      if (!invState._invOrderShoppingDraft[oid].qtyBought) invState._invOrderShoppingDraft[oid].qtyBought = [];
      if (!invState._invOrderShoppingDraft[oid].checked) invState._invOrderShoppingDraft[oid].checked = [];
      invState._invOrderShoppingDraft[oid].qtyBought[idx] = t.value;
      // Checkbox is derived from B vs N: check only when B >= N (qty fully met).
      const order = invState._invOrdersList.find((x) => x.id === oid);
      const items = order && Array.isArray(order.items) ? order.items : [];
      const it = items[idx];
      const N = it ? getItemOrderQty(it) : 0;
      const B = parseNum(t.value);
      const derivedChecked = B > 0 && (N <= 0 || B >= N);
      invState._invOrderShoppingDraft[oid].checked[idx] = derivedChecked;
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
  if (!ffCanManageInventory()) return;
  if (!ensureTableReadyForEdits()) return;

  if (inv === "group-label") {
    const gid = t.getAttribute("data-group-id");
    const g = invState._groups.find((x) => x.id === gid);
    if (g) g.label = t.value;
    scheduleInventoryTablePersist();
    return;
  }

  const rowId = t.getAttribute("data-row-id");
  const row = invState._rows.find((r) => r.id === rowId);
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
  document.querySelectorAll('style[id^="ff-inv2-mock-styles-v"]').forEach((s) => s.remove());
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = INVENTORY_STYLES;
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
  const m = findSubMeta(invState._selectedSubcategoryId);
  if (m) return m;
  for (const c of tree) {
    const first = c.subcategories[0];
    if (first) {
      invState._selectedSubcategoryId = first.id;
      return { category: c, sub: first };
    }
  }
  return null;
}


function renderGroupHeaderTh(g) {
  const gid = g.id;
  const confirming = invState._groupRemoveConfirmId === gid;
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
  const gid = invState._groupRemoveModalGroupId;
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







function renderTableHeaderHtml() {
  if (invState._groups === null) return "";
  const w = getInvColWidths();
  const groupCells = invState._groups.map((g) => renderGroupHeaderTh(g)).join("");
  const subHeaders = invState._groups
    .map((g) => {
      const w4 = getInvMobileGroupSubColWidthsPx(w, g.id);
      const labels = ["Stock", "Current", "Order", "Price"];
      return w4
        .map(
          (cw, idx) =>
            `<th class="ff-inv2-subh" style="width:${cw}px;min-width:${cw}px">${labels[idx]}</th>`
        )
        .join("");
    })
    .join("");
  return `
${renderColgroup()}
<thead>
  <tr>
    <th rowspan="2" class="ff-inv2-th-dnd" data-inv-mobile-col="dnd" aria-hidden="true" title="Mobile: double-tap to hide/show. Toolbar: Columns — show all."></th>
    <th rowspan="2" class="ff-inv2-th-num" data-inv-mobile-col="num" title="# · Mobile: double-tap hide/show. Columns button restores."><span class="ff-inv2-th-inner">#</span>${thResizeHandle("hash")}</th>
    <th rowspan="2" class="ff-inv2-th-code" data-inv-mobile-col="code" title="Mobile: double-tap hide/show. Columns button — restore all.">Code${thResizeHandle("code")}</th>
    <th rowspan="2" class="ff-inv2-th-name" data-inv-mobile-col="name" title="Mobile: drag the thin line on the right edge of a header to resize · tap/double-tap name">Name${thResizeHandle("name")}</th>
    ${groupCells}
    <th rowspan="2" class="ff-inv2-th-supplier" data-inv-mobile-col="supplier" title="Mobile: double-tap · Columns shows all">Supplier${thResizeHandle("supplier")}</th>
    <th rowspan="2" class="ff-inv2-th-url" data-inv-mobile-col="url" title="Mobile: double-tap · Columns shows all">URL${thResizeHandle("url")}</th>
  </tr>
  <tr>${subHeaders}</tr>
</thead>`;
}

function rowGroupCells(row) {
  if (invState._groups === null) return "";
  return invState._groups
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
  if (invState._invTableLoading) {
    return `<tr class="ff-inv2-data-row ff-inv2-table-loading-row"><td colspan="99" class="ff-inv2-td-num">Loading table…</td></tr>`;
  }
  if (invState._rows === null) return "";
  return invState._rows
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
  if (!invState._invOrderCellBreakdownModal) return "";
  const { rowId, groupId, busy } = invState._invOrderCellBreakdownModal;
  const row = Array.isArray(invState._rows) ? invState._rows.find((r) => r.id === rowId) : null;
  const group = Array.isArray(invState._groups) ? invState._groups.find((g) => g.id === groupId) : null;
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
  if (invState._invOrderCellBreakdownModal) {
    invState._invOrderCellBreakdownModal = { ...invState._invOrderCellBreakdownModal, busy: true };
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
    invState._invOrderCellBreakdownModal = null;
    const key = `${catId}:${subId}`;
    if (invState._invTableLoadedForSubId === key) {
      const seq = ++invState._invTableLoadSeq;
      invState._invTableLoading = true;
      mountOrRefreshMockUi();
      void loadInventoryTableForSub(catId, subId, seq, key);
    } else {
      mountOrRefreshMockUi();
    }
  } catch (e) {
    console.error("[Inventory] remove approved contribution failed", e);
    inventoryOrderDraftToast("Could not remove contribution.", "error");
    if (invState._invOrderCellBreakdownModal) {
      invState._invOrderCellBreakdownModal = { ...invState._invOrderCellBreakdownModal, busy: false };
      mountOrRefreshMockUi();
    }
  }
}

function renderInvRowMenu() {
  if (!invState._invRowMenu) return "";
  const m = invState._invRowMenu;
  const rid = escapeHtml(m.rowId);
  const row = Array.isArray(invState._rows) ? invState._rows.find((r) => r.id === m.rowId) : null;
  const isProduct = !!(row && row._isProductRow);
  const duplicateBtn = isProduct
    ? ""
    : `<button type="button" class="ff-inv2-row-menu-item" role="menuitem" data-inv-row-action="duplicate" data-row-id="${rid}">Duplicate row</button>`;
  const deleteBtn = isProduct
    ? ""
    : `<button type="button" class="ff-inv2-row-menu-item ff-inv2-row-menu-item--danger" role="menuitem" data-inv-row-action="delete" data-row-id="${rid}">Delete row</button>`;
  return `<div class="ff-inv2-row-menu-backdrop" data-inv-row-menu-dismiss="1" aria-hidden="true"></div>
<div class="ff-inv2-row-menu" role="menu" style="left:${m.left}px;top:${m.top}px">
  <button type="button" class="ff-inv2-row-menu-item" role="menuitem" data-inv-row-action="edit" data-row-id="${rid}">Edit row</button>
  ${duplicateBtn}
  ${deleteBtn}
</div>`;
}

/**
 * Toggle the Bought (B) quantity for a shopping row driven by its checkbox.
 * "Got exactly what's needed" — B = 0 → N (check), B = N or complete → 0 (uncheck),
 * partial B (0 < B < N) → complete to N.
 */


function renderDeleteRowModal() {
  if (!invState._invRowDeleteModalRowId) return "";
  const rid = escapeHtml(invState._invRowDeleteModalRowId);
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
        invState._invOrderCellBreakdownModal = { rowId, groupId, busy: false };
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
      if (invState._invOrdersDetailOrderId != null && invState._invOrdersDetailOrderId !== oid) {
        invState._invOrderDetailFilter = "all";
      }
      invState._invOrdersDetailOrderId = oid;
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
    invState._invRowMenu = { rowId, left, top };
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
    if (t.hasAttribute("data-inv-order-line-inv-price") && root.contains(t)) {
      const oid = t.getAttribute("data-order-id");
      const idxStr = t.getAttribute("data-line-idx");
      if (oid != null && idxStr != null) {
        void commitOrderLineInventoryPrice(oid, Number(idxStr), t.value);
      }
      return;
    }
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
      if (invState._editCellKey !== key) return;
      if (document.activeElement === t) return;
      handleInventoryInput({ target: t });
      invState._editCellKey = null;
      mountOrRefreshMockUi();
    }, 0);
  });
  root.addEventListener("keydown", (ev) => {
    if (
      ev.key === "Enter" &&
      ev.target instanceof HTMLInputElement &&
      ev.target.hasAttribute("data-inv-orders-rename-input") &&
      invState._invOrdersRenameModal &&
      !invState._invOrdersRenameModal.busy
    ) {
      ev.preventDefault();
      void renameInventoryOrderConfirmed(invState._invOrdersRenameModal.orderId, ev.target.value);
      return;
    }
    if (
      ev.key === "Enter" &&
      ev.target instanceof HTMLInputElement &&
      ev.target.hasAttribute("data-inv-ob-add-input") &&
      invState._invOrderBuilderAddModal
    ) {
      ev.preventDefault();
      commitInventoryOrderBuilderAddItem();
      return;
    }
    if (ev.key === "Enter" && ev.target instanceof HTMLInputElement && ev.target.classList.contains("ff-inv2-cell-input--editing")) {
      ev.preventDefault();
      handleInventoryInput({ target: ev.target });
      invState._editCellKey = null;
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
    if (invState._catDeleteModal) {
      ev.preventDefault();
      invState._catDeleteModal = null;
      mountOrRefreshMockUi();
      return;
    }
    if (invState._catMenuKey) {
      ev.preventDefault();
      invState._catMenuKey = null;
      mountOrRefreshMockUi();
      return;
    }
    if (invState._invRowMenu) {
      ev.preventDefault();
      invState._invRowMenu = null;
      mountOrRefreshMockUi();
      return;
    }
    if (invState._invRowDeleteModalRowId) {
      ev.preventDefault();
      invState._invRowDeleteModalRowId = null;
      mountOrRefreshMockUi();
      return;
    }
    if (invState._manageCategoriesOpen) {
      ev.preventDefault();
      invState._manageCategoriesOpen = false;
      invState._catManageDraftTree = null;
      resetCatModalTransientState();
      mountOrRefreshMockUi();
      return;
    }
    if (invState._editCellKey) {
      ev.preventDefault();
      invState._editCellKey = null;
      mountOrRefreshMockUi();
      return;
    }
    if (invState._invOrderDetailLineViewIdx != null) {
      ev.preventDefault();
      invState._invOrderDetailLineViewIdx = null;
      mountOrRefreshMockUi();
      return;
    }
    if (invState._invOrdersRenameModal && !invState._invOrdersRenameModal.busy) {
      ev.preventDefault();
      invState._invOrdersRenameModal = null;
      mountOrRefreshMockUi();
      return;
    }
    if (invState._invOrderBuilderAddModal) {
      ev.preventDefault();
      invState._invOrderBuilderAddModal = null;
      mountOrRefreshMockUi();
      return;
    }
    if (invState._invOrderCellBreakdownModal && !invState._invOrderCellBreakdownModal.busy) {
      ev.preventDefault();
      invState._invOrderCellBreakdownModal = null;
      mountOrRefreshMockUi();
      return;
    }
    if (invState._invReceiptInfoModalOrderId) {
      ev.preventDefault();
      invState._invReceiptInfoModalOrderId = null;
      mountOrRefreshMockUi();
      return;
    }
    if (invState._invOrdersDetailOrderId) {
      ev.preventDefault();
      if (isInvOrderDetailCommitBusy()) return;
      invState._invOrderDetailLineViewIdx = null;
      invState._invOrdersDetailOrderId = null;
      mountOrRefreshMockUi();
      return;
    }
    if (!invState._groupRemoveModalGroupId) return;
    ev.preventDefault();
    invState._groupRemoveModalGroupId = null;
    mountOrRefreshMockUi();
  });
  root.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;

    // View-only access: block every add/edit/remove interaction. Navigation,
    // tab switching, and order viewing remain available.
    if (!ffCanManageInventory()) {
      if (
        t.closest("[data-inv-cell]") ||
        t.closest("[data-inv-url-edit]") ||
        t.closest("[data-inv-row-menu-trigger]") ||
        t.closest("[data-inv-row-action]") ||
        t.closest("[data-inv-row-dnd]") ||
        t.closest("[data-inv-row-delete-commit]") ||
        t.closest("#ff-inv2-add-row") ||
        t.closest("#ff-inv2-add-group") ||
        t.closest("#ff-inv2-add-from-shared") ||
        t.closest("[data-inv-import-shared-catalog]") ||
        t.closest("[data-cat-manage-open]")
      ) {
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof window !== "undefined" && typeof window.showToast === "function") {
          window.showToast("You have view-only access to Inventory.", "info");
        }
        return;
      }
    }

    const mobileCatStrip = t.closest("[data-inv-mobile-cat-strip]");
    if (mobileCatStrip && root.contains(mobileCatStrip)) {
      ev.preventDefault();
      invState._invMobileCatsPanelOpen = true;
      mountOrRefreshMockUi();
      return;
    }
    const mobileAsideCollapse = t.closest("[data-inv-mobile-aside-collapse]");
    if (mobileAsideCollapse && root.contains(mobileAsideCollapse)) {
      ev.preventDefault();
      invState._invMobileCatsPanelOpen = false;
      mountOrRefreshMockUi();
      return;
    }

    const invMainTabBtn = t.closest("[data-inv-main-tab]");
    if (invMainTabBtn && root.contains(invMainTabBtn)) {
      ev.preventDefault();
      const tab = invMainTabBtn.getAttribute("data-inv-main-tab");
      if (tab === "inventory" || tab === "orderBuilder" || tab === "orders" || tab === "insights") {
        if (invState._invMainTab !== tab) {
          if (tab === "orderBuilder") {
            invState._invObPickPanelOpen = false;
          }
          invState._invMainTab = tab;
          if (tab !== "orders") {
            invState._invOrdersDetailOrderId = null;
            invState._invReceiptInfoModalOrderId = null;
            invState._invOrderDetailLineViewIdx = null;
            invState._invOrdersMenu = null;
            invState._invOrdersDeleteConfirmOrderId = null;
            invState._invOrdersMarkOrderedConfirmOrderId = null;
            invState._invOrdersRenameModal = null;
          }
          if (tab === "orderBuilder") {
            invState._invOrderBuilderPreviewLoading = true;
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
      if (sub && allowedSub.includes(sub) && invState._invInsightsSubTab !== sub) {
        invState._invInsightsSubTab = sub;
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
        invState._invOrdersMenu = { orderId: oid, left, top };
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
        const o = invState._invOrdersList.find((x) => x.id === oid);
        const cur = o && o.orderName != null ? String(o.orderName) : "";
        invState._invOrdersMenu = null;
        invState._invOrdersRenameModal = { orderId: oid, draftName: cur, busy: false };
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
        invState._invOrdersMenu = null;
        void duplicateInventoryOrderDraft(oid);
        return;
      }
      if (act === "delete") {
        invState._invOrdersMenu = null;
        invState._invOrdersDeleteConfirmOrderId = oid;
        mountOrRefreshMockUi();
        return;
      }
      if (act === "markOrdered") {
        invState._invOrdersMenu = null;
        invState._invOrdersMarkOrderedConfirmOrderId = oid;
        mountOrRefreshMockUi();
        return;
      }
      return;
    }
    if (t.closest("[data-inv-orders-menu-dismiss]")) {
      ev.preventDefault();
      invState._invOrdersMenu = null;
      mountOrRefreshMockUi();
      return;
    }
    const ordersDelCommit = t.closest("[data-inv-orders-delete-commit]");
    if (ordersDelCommit && root.contains(ordersDelCommit)) {
      ev.preventDefault();
      const oid = ordersDelCommit.getAttribute("data-order-id");
      if (oid && invState._invOrdersDeleteConfirmOrderId === oid) {
        void deleteInventoryOrderDraftConfirmed(oid);
      }
      return;
    }
    if (t.closest("[data-inv-orders-delete-cancel]") || t.id === "ff-inv-orders-delete-backdrop") {
      ev.preventDefault();
      invState._invOrdersDeleteConfirmOrderId = null;
      mountOrRefreshMockUi();
      return;
    }
    const ordersMarkOrdCommit = t.closest("[data-inv-orders-mark-ordered-commit]");
    if (ordersMarkOrdCommit && root.contains(ordersMarkOrdCommit)) {
      ev.preventDefault();
      const oid = ordersMarkOrdCommit.getAttribute("data-order-id");
      if (oid && invState._invOrdersMarkOrderedConfirmOrderId === oid) {
        void markInventoryOrderOrderedConfirmed(oid);
      }
      return;
    }
    if (t.closest("[data-inv-orders-mark-ordered-cancel]") || t.id === "ff-inv-orders-mark-ordered-backdrop") {
      ev.preventDefault();
      invState._invOrdersMarkOrderedConfirmOrderId = null;
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
      if (oid && invState._invOrdersRenameModal && invState._invOrdersRenameModal.orderId === oid) {
        void renameInventoryOrderConfirmed(oid, val);
      }
      return;
    }
    if (
      t.closest("[data-inv-orders-rename-cancel]") ||
      t.id === "ff-inv-orders-rename-backdrop"
    ) {
      ev.preventDefault();
      if (invState._invOrdersRenameModal && invState._invOrdersRenameModal.busy) return;
      invState._invOrdersRenameModal = null;
      mountOrRefreshMockUi();
      return;
    }

    const ordBreakdownRemove = t.closest("[data-inv-ord-breakdown-remove]");
    if (ordBreakdownRemove && root.contains(ordBreakdownRemove)) {
      ev.preventDefault();
      if (ordBreakdownRemove instanceof HTMLButtonElement && ordBreakdownRemove.disabled) return;
      if (!invState._invOrderCellBreakdownModal) return;
      const rid = ordBreakdownRemove.getAttribute("data-inv-ord-breakdown-remove");
      if (!rid) return;
      const { rowId, groupId } = invState._invOrderCellBreakdownModal;
      void removeApprovedContributionForCell(rowId, groupId, rid);
      return;
    }
    if (
      t.closest("[data-inv-ord-breakdown-close]") ||
      t.id === "ff-inv-ord-breakdown-backdrop"
    ) {
      ev.preventDefault();
      if (invState._invOrderCellBreakdownModal && invState._invOrderCellBreakdownModal.busy) return;
      invState._invOrderCellBreakdownModal = null;
      mountOrRefreshMockUi();
      return;
    }

    const ordersStatusFilterChip = t.closest("[data-inv-orders-status-filter]");
    if (ordersStatusFilterChip && root.contains(ordersStatusFilterChip)) {
      ev.preventDefault();
      const v = ordersStatusFilterChip.getAttribute("data-inv-orders-status-filter");
      if (v === "all" || v === "open" || v === "in_progress" || v === "done") {
        invState._invOrdersStatusFilter = v;
        mountOrRefreshMockUi();
      }
      return;
    }

    const ordersSearchClear = t.closest("[data-inv-orders-search-clear]");
    if (ordersSearchClear && root.contains(ordersSearchClear)) {
      ev.preventDefault();
      invState._invOrdersSearchQuery = "";
      mountOrRefreshMockUi();
      const inp = root.querySelector("[data-inv-orders-search-input]");
      if (inp instanceof HTMLInputElement) inp.focus();
      return;
    }

    const odPrintBtn = t.closest("[data-inv-order-detail-print]");
    if (odPrintBtn && root.contains(odPrintBtn)) {
      ev.preventDefault();
      if (isInvOrderDetailCommitBusy()) return;
      const det = odPrintBtn.closest("details");
      if (det) det.open = false;
      triggerOrderDetailPrint();
      return;
    }
    const odCsvBtn = t.closest("[data-inv-order-detail-export-csv]");
    if (odCsvBtn && root.contains(odCsvBtn)) {
      ev.preventDefault();
      if (isInvOrderDetailCommitBusy()) return;
      const det = odCsvBtn.closest("details");
      if (det) det.open = false;
      triggerOrderDetailExportCsv();
      return;
    }

    const odPurchaseCommit = t.closest("[data-inv-order-detail-confirm-purchase]");
    if (odPurchaseCommit && root.contains(odPurchaseCommit)) {
      ev.preventDefault();
      if (isInvOrderDetailCommitBusy()) return;
      const oid = odPurchaseCommit.getAttribute("data-order-id");
      if (oid && invState._invOrdersDetailOrderId === oid) {
        void confirmInventoryOrderPurchase(oid);
      }
      return;
    }

    const odReceiveCommit = t.closest("[data-inv-order-detail-receive-commit]");
    if (odReceiveCommit && root.contains(odReceiveCommit)) {
      ev.preventDefault();
      if (isInvOrderDetailCommitBusy()) return;
      const oid = odReceiveCommit.getAttribute("data-order-id");
      if (oid && invState._invOrdersDetailOrderId === oid) {
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
        invState._invOrderDetailFilter = v;
        mountOrRefreshMockUi();
      }
      return;
    }

    const odLineViewClose = t.closest("[data-inv-od-line-view-close]");
    if (odLineViewClose && root.contains(odLineViewClose)) {
      ev.preventDefault();
      invState._invOrderDetailLineViewIdx = null;
      mountOrRefreshMockUi();
      return;
    }
    if (t.id === "ff-inv-od-line-view-backdrop") {
      ev.preventDefault();
      invState._invOrderDetailLineViewIdx = null;
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
        if (!oid || oid !== invState._invReceiptInfoModalOrderId) return;
        const card = receiptInfoBackdrop.querySelector("[data-inv-receipt-info-card]");
        if (!card) return;
        const n = card.querySelector('[data-inv-receipt-info-field="note"]');
        const s = card.querySelector('[data-inv-receipt-info-field="supplierName"]');
        const a = card.querySelector('[data-inv-receipt-info-field="amount"]');
        invState._invOrderReceiptUploadFieldsByOrderId[oid] = {
          note: n instanceof HTMLInputElement ? n.value.trim() : "",
          supplierName: s instanceof HTMLInputElement ? s.value.trim() : "",
          amount: a instanceof HTMLInputElement ? a.value.trim() : "",
        };
        invState._invReceiptInfoModalOrderId = null;
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
        invState._invReceiptInfoModalOrderId = null;
        mountOrRefreshMockUi();
        return;
      }
    }

    const receiptInfoOpen = t.closest("[data-inv-order-receipt-info]");
    if (receiptInfoOpen && root.contains(receiptInfoOpen)) {
      ev.preventDefault();
      if (receiptInfoOpen instanceof HTMLButtonElement && receiptInfoOpen.disabled) return;
      const oid = receiptInfoOpen.getAttribute("data-order-id");
      if (oid && invState._invOrdersDetailOrderId === oid) {
        invState._invReceiptInfoModalOrderId = oid;
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
      if (oid && rid && oid === invState._invReceiptInfoModalOrderId) {
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
        if (invState._invOrdersDetailOrderId != null && invState._invOrdersDetailOrderId !== oid) {
          invState._invOrderDetailFilter = "all";
        }
        invState._invOrderDetailLineViewIdx = null;
        invState._invOrdersDetailOrderId = oid;
        mountOrRefreshMockUi();
      }
      return;
    }
    if (t.closest("[data-inv-order-detail-close]") || t.id === "ff-inv-order-detail-backdrop") {
      ev.preventDefault();
      if (isInvOrderDetailCommitBusy()) return;
      invState._invReceiptInfoModalOrderId = null;
      invState._invOrderDetailLineViewIdx = null;
      invState._invOrdersDetailOrderId = null;
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
        if (invState._editCellKey === key) {
          queueMicrotask(() => {
            const inp = findInvEditInput(root, key);
            if (inp instanceof HTMLInputElement) {
              inp.focus();
              inp.select();
            }
          });
          return;
        }
        invState._editCellKey = key;
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
        invState._invRowMenu = { rowId: rid, left, top };
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
        invState._invRowMenu = null;
        invState._editCellKey = invCellKey("code", rid);
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
        invState._invRowMenu = null;
        duplicateInventoryRow(rid);
        mountOrRefreshMockUi();
        return;
      }
      if (act === "delete") {
        invState._invRowMenu = null;
        invState._invRowDeleteModalRowId = rid;
        mountOrRefreshMockUi();
        return;
      }
      return;
    }
    if (t.closest("[data-inv-row-menu-dismiss]")) {
      ev.preventDefault();
      invState._invRowMenu = null;
      mountOrRefreshMockUi();
      return;
    }
    const rowDelCommit = t.closest("[data-inv-row-delete-commit]");
    if (rowDelCommit && root.contains(rowDelCommit)) {
      ev.preventDefault();
      const rid = rowDelCommit.getAttribute("data-row-id");
      if (rid && invState._invRowDeleteModalRowId === rid) {
        deleteInventoryRow(rid);
        invState._invRowDeleteModalRowId = null;
        invState._editCellKey = null;
        mountOrRefreshMockUi();
      }
      return;
    }
    if (t.closest("[data-inv-row-delete-cancel]") || t.id === "ff-inv2-row-delete-modal") {
      ev.preventDefault();
      invState._invRowDeleteModalRowId = null;
      mountOrRefreshMockUi();
      return;
    }

    const cellView = t.closest("[data-inv-cell]");
    if (cellView && root.contains(cellView)) {
      const key = getInvCellKeyFromEl(cellView);
      if (key && key !== invState._editCellKey) {
        invState._editCellKey = key;
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

    if (t.closest("[data-inv-import-shared-catalog]")) {
      ev.preventDefault();
      invState._editCellKey = null;
      void importSharedCatalogIntoCurrentBranch();
      return;
    }

    if (t.closest("[data-cat-manage-open]")) {
      ev.preventDefault();
      resetCatModalTransientState();
      invState._manageCategoriesOpen = true;
      // Safety net: if the in-memory tree is empty (e.g. because a location
      // switch wiped it before the screen fully remounted), force a fresh
      // Firestore load before building the draft so the modal shows the real
      // categories instead of "No categories yet".
      const treeIsEmpty = !Array.isArray(invState._categoryTree) || invState._categoryTree.length === 0;
      if (treeIsEmpty && !invState._invCategoriesLoading) {
        invState._invCategoriesLoading = true;
        mountOrRefreshMockUi();
        loadInventoryCategoriesFromFirestore()
          .catch((e) => {
            console.warn("[Inventory] Manage Categories open: reload failed", e);
            invState._invCatLoadError = (e && e.message) || "Failed to load categories";
          })
          .finally(() => {
            invState._invCategoriesLoading = false;
            invState._catManageDraftTree = null;
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
      invState._manageCategoriesOpen = false;
      invState._catManageDraftTree = null;
      resetCatModalTransientState();
      mountOrRefreshMockUi();
      return;
    }
    if (t.closest("[data-cat-manage-save]")) {
      ev.preventDefault();
      if (invState._catSaveBusy) return;
      const draft = invState._catManageDraftTree
        ? cloneCategoryTree(invState._catManageDraftTree)
        : cloneCategoryTree(getLegacyCategoryTreeForManage());
      const runSave = async () => {
        invState._catSaveBusy = true;
        mountOrRefreshMockUi();
        try {
          await persistInventoryCategoryTree(draft);
          await loadInventoryCategoriesFromFirestore();
          invState._catManageDraftTree = null;
          invState._manageCategoriesOpen = false;
          resetCatModalTransientState();
          ensureValidSubcategorySelection();
        } catch (e) {
          console.error("[Inventory] save categories failed", e);
          alert("Failed to save categories: " + (e && e.message ? e.message : String(e)));
        } finally {
          invState._catSaveBusy = false;
          mountOrRefreshMockUi();
        }
      };
      void runSave();
      return;
    }
    if (t.id === "ff-inv2-cat-manage-backdrop") {
      ev.preventDefault();
      invState._manageCategoriesOpen = false;
      invState._catManageDraftTree = null;
      resetCatModalTransientState();
      mountOrRefreshMockUi();
      return;
    }
    if (t.closest("[data-cat-delete-modal-commit]")) {
      ev.preventDefault();
      if (invState._catDeleteModal) {
        const { kind, catId, subId } = invState._catDeleteModal;
        if (kind === "cat" && catId) {
          const tree = getManageCategoryTree();
          const i = tree.findIndex((c) => c.id === catId);
          if (i !== -1) tree.splice(i, 1);
          invState._expandedCategoryIds.delete(catId);
        } else if (kind === "sub" && catId && subId) {
          const cat = getManageCategoryTree().find((c) => c.id === catId);
          if (cat) cat.subcategories = cat.subcategories.filter((s) => s.id !== subId);
        }
        invState._catDeleteModal = null;
        ensureValidSubcategorySelection();
      }
      mountOrRefreshMockUi();
      return;
    }
    if (t.closest("[data-cat-delete-modal-cancel]")) {
      ev.preventDefault();
      invState._catDeleteModal = null;
      mountOrRefreshMockUi();
      return;
    }
    if (t.id === "ff-inv2-cat-delete-backdrop") {
      ev.preventDefault();
      invState._catDeleteModal = null;
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
      invState._catMenuKey = invState._catMenuKey === key ? null : key;
      mountOrRefreshMockUi();
      return;
    }
    const menuRename = t.closest("[data-cat-menu-rename]");
    if (menuRename) {
      ev.preventDefault();
      const kind = menuRename.getAttribute("data-cat-menu-rename");
      invState._catMenuKey = null;
      if (kind === "cat") {
        const cid = menuRename.getAttribute("data-cat-id");
        invState._renameCatId = cid;
        invState._renameSubKey = null;
      } else {
        const cid = menuRename.getAttribute("data-cat-id");
        const sid = menuRename.getAttribute("data-sub-id");
        invState._renameCatId = null;
        invState._renameSubKey = cid && sid ? `${cid}:${sid}` : null;
      }
      ensureCatManageDraft();
      invState._manageCategoriesOpen = true;
      mountOrRefreshMockUi();
      return;
    }
    const menuDelete = t.closest("[data-cat-menu-delete]");
    if (menuDelete) {
      ev.preventDefault();
      const kind = menuDelete.getAttribute("data-cat-menu-delete");
      const catId = menuDelete.getAttribute("data-cat-id");
      invState._catMenuKey = null;
      if (kind === "cat") {
        const cat = catId ? getManageCategoryTree().find((c) => c.id === catId) : null;
        if (catId && cat) invState._catDeleteModal = { kind: "cat", catId, name: cat.name };
      } else {
        const sid = menuDelete.getAttribute("data-sub-id");
        const cat = catId ? getManageCategoryTree().find((c) => c.id === catId) : null;
        const sub = cat && sid ? cat.subcategories.find((s) => s.id === sid) : null;
        if (catId && sid && sub) invState._catDeleteModal = { kind: "sub", catId, subId: sid, name: sub.name };
      }
      mountOrRefreshMockUi();
      return;
    }
    if (t.closest("[data-cat-inline-newcat]")) {
      ev.preventDefault();
      invState._inlineNewCat = true;
      mountOrRefreshMockUi();
      return;
    }
    if (t.closest("[data-cat-new-cat-cancel]")) {
      ev.preventDefault();
      invState._inlineNewCat = false;
      mountOrRefreshMockUi();
      return;
    }
    if (t.closest("[data-cat-new-cat-commit]")) {
      ev.preventDefault();
      const inp = root.querySelector("input[data-cat-new-cat-input]");
      const name = (inp && inp.value.trim()) || "New category";
      const ncid = newCategoryId();
      getManageCategoryTree().push({ id: ncid, name, subcategories: [] });
      invState._expandedCategoryIds.add(ncid);
      invState._inlineNewCat = false;
      mountOrRefreshMockUi();
      return;
    }
    if (t.closest("[data-cat-rename-cancel='cat']") || t.closest("[data-cat-rename-cancel='sub']")) {
      ev.preventDefault();
      invState._renameCatId = null;
      invState._renameSubKey = null;
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
      invState._renameCatId = null;
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
      invState._renameSubKey = null;
      mountOrRefreshMockUi();
      return;
    }
    const addSubOpen = t.closest("[data-cat-add-sub-open]");
    if (addSubOpen) {
      ev.preventDefault();
      const cid = addSubOpen.getAttribute("data-cat-add-sub-open");
      invState._inlineNewSubCatId = invState._inlineNewSubCatId === cid ? null : cid;
      mountOrRefreshMockUi();
      return;
    }
    if (t.closest("[data-cat-new-sub-cancel]")) {
      ev.preventDefault();
      invState._inlineNewSubCatId = null;
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
        if (!invState._selectedSubcategoryId) invState._selectedSubcategoryId = ns.id;
      }
      invState._inlineNewSubCatId = null;
      mountOrRefreshMockUi();
      return;
    }

    if (invState._catMenuKey && !t.closest(".ff-inv2-cat-menu-wrap")) {
      invState._catMenuKey = null;
      mountOrRefreshMockUi();
      return;
    }

    const start = t.closest("[data-inv-remove-start]");
    if (start) {
      ev.preventDefault();
      const gid = start.getAttribute("data-inv-remove-start");
      if (gid) {
        invState._groupRemoveConfirmId = gid;
        mountOrRefreshMockUi();
      }
      return;
    }
    if (t.closest("[data-inv-remove-cancel]")) {
      ev.preventDefault();
      invState._groupRemoveConfirmId = null;
      mountOrRefreshMockUi();
      return;
    }
    const openRmModal = t.closest("[data-inv-remove-modal]");
    if (openRmModal) {
      ev.preventDefault();
      const gid = openRmModal.getAttribute("data-inv-remove-modal");
      if (gid) {
        invState._groupRemoveModalGroupId = gid;
        mountOrRefreshMockUi();
      }
      return;
    }
    if (t.closest("[data-inv-modal-cancel]")) {
      ev.preventDefault();
      invState._groupRemoveModalGroupId = null;
      mountOrRefreshMockUi();
      return;
    }
    if (t.id === "ff-inv2-group-remove-modal") {
      ev.preventDefault();
      invState._groupRemoveModalGroupId = null;
      mountOrRefreshMockUi();
      return;
    }
    const modalCommit = t.closest("[data-inv-modal-commit]");
    if (modalCommit) {
      ev.preventDefault();
      const gid = modalCommit.getAttribute("data-inv-modal-commit");
      if (gid) {
        removeInventoryGroup(gid);
        invState._groupRemoveModalGroupId = null;
        invState._groupRemoveConfirmId = null;
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
        if (invState._invOrderBuilderExpandedCatIds.has(cid)) invState._invOrderBuilderExpandedCatIds.delete(cid);
        else invState._invOrderBuilderExpandedCatIds.add(cid);
        mountOrRefreshMockUi();
      }
      return;
    }
    const obAddItemBtn = t.closest("[data-inv-ob-add-item]");
    if (obAddItemBtn && root.contains(obAddItemBtn)) {
      ev.preventDefault();
      if (obAddItemBtn instanceof HTMLButtonElement && obAddItemBtn.disabled) return;
      invState._invOrderBuilderAddModal = {
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
      invState._invOrderBuilderAddModal = null;
      mountOrRefreshMockUi();
      return;
    }
    const obLinkStep = t.closest("[data-inv-ob-add-link-step]");
    if (obLinkStep && root.contains(obLinkStep) && invState._invOrderBuilderAddModal) {
      ev.preventDefault();
      ev.stopPropagation();
      const step = obLinkStep.getAttribute("data-inv-ob-add-link-step");
      if (step === "category") {
        invState._invOrderBuilderAddModal.picker.step = "category";
        invState._invOrderBuilderAddModal.picker.catId = null;
        invState._invOrderBuilderAddModal.picker.subId = null;
        invState._invOrderBuilderAddModal.picker.items = null;
        invState._invOrderBuilderAddModal.picker.loading = false;
        invState._invOrderBuilderAddModal.picker.error = null;
        mountOrRefreshMockUi();
      } else if (step === "subcategory") {
        const catId = obLinkStep.getAttribute("data-cat-id") || invState._invOrderBuilderAddModal.picker.catId;
        invState._invOrderBuilderAddModal.picker.step = "subcategory";
        invState._invOrderBuilderAddModal.picker.catId = catId;
        invState._invOrderBuilderAddModal.picker.subId = null;
        invState._invOrderBuilderAddModal.picker.items = null;
        invState._invOrderBuilderAddModal.picker.loading = false;
        invState._invOrderBuilderAddModal.picker.error = null;
        mountOrRefreshMockUi();
      } else if (step === "items") {
        const subId = obLinkStep.getAttribute("data-sub-id") || invState._invOrderBuilderAddModal.picker.subId;
        const catId = invState._invOrderBuilderAddModal.picker.catId;
        invState._invOrderBuilderAddModal.picker.step = "items";
        invState._invOrderBuilderAddModal.picker.subId = subId;
        mountOrRefreshMockUi();
        if (catId && subId) void loadLinkPickerItemsForSub(catId, subId);
      }
      return;
    }
    const obLinkSelect = t.closest("[data-inv-ob-add-link-select]");
    if (obLinkSelect && root.contains(obLinkSelect) && invState._invOrderBuilderAddModal) {
      ev.preventDefault();
      ev.stopPropagation();
      const pickId = obLinkSelect.getAttribute("data-inv-ob-add-link-select");
      if (pickId) {
        const pool = Array.isArray(invState._invOrderBuilderAddModal.picker.items)
          ? invState._invOrderBuilderAddModal.picker.items
          : [];
        const picked = pool.find((x) => x.id === pickId);
        if (picked) {
          invState._invOrderBuilderAddModal.linkedItemId = picked.id;
          invState._invOrderBuilderAddModal.linkedItemMeta = picked;
          if (String(invState._invOrderBuilderAddModal.draftName ?? "").trim() === "") {
            invState._invOrderBuilderAddModal.draftName = picked.itemName;
          }
          if (!(parseNum(invState._invOrderBuilderAddModal.draftQty) > 0)) {
            invState._invOrderBuilderAddModal.draftQty = "1";
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
    if (t.closest("[data-inv-ob-add-link-clear]") && invState._invOrderBuilderAddModal) {
      ev.preventDefault();
      ev.stopPropagation();
      invState._invOrderBuilderAddModal.linkedItemId = null;
      invState._invOrderBuilderAddModal.linkedItemMeta = null;
      if (invState._invOrderBuilderAddModal.picker) {
        invState._invOrderBuilderAddModal.picker.step = "category";
        invState._invOrderBuilderAddModal.picker.catId = null;
        invState._invOrderBuilderAddModal.picker.subId = null;
        invState._invOrderBuilderAddModal.picker.items = null;
        invState._invOrderBuilderAddModal.picker.loading = false;
        invState._invOrderBuilderAddModal.picker.error = null;
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
    if (t.closest("[data-inv-ob-mobile-collapse-source]") && root.contains(t.closest("[data-inv-ob-mobile-collapse-source]"))) {
      ev.preventDefault();
      invState._invObPickPanelOpen = false;
      mountOrRefreshMockUi();
      try {
        if (typeof requestAnimationFrame !== "undefined") {
          requestAnimationFrame(() => {
            const el = root.querySelector(".ff-inv2-order-list-head");
            if (el && typeof el.scrollIntoView === "function") {
              el.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          });
        }
      } catch (_) {
        /* ignore */
      }
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
        invState._invOrderBuilderManualLines = invState._invOrderBuilderManualLines.filter((x) => x.id !== lid);
        scheduleInventoryOrderDraftSave();
        mountOrRefreshMockUi();
      }
      return;
    }
    if (t.id === "ff-inv2-add-row") {
      ev.preventDefault();
      invState._editCellKey = null;
      addInventoryRow();
      mountOrRefreshMockUi();
    } else if (t.id === "ff-inv2-mobile-cols-reset") {
      ev.preventDefault();
      if (t instanceof HTMLElement) t.blur();
      const hadHidden = invMobileAnyOptionalColumnHidden();
      resetInvMobileOptionalColumns();
      if (typeof window !== "undefined" && window.ffToast && typeof window.ffToast.show === "function") {
        window.ffToast.show(hadHidden ? "All optional columns visible again." : "No columns were hidden.", {
          variant: "info",
          durationMs: 3200,
        });
      }
    } else if (t.id === "ff-inv2-add-from-shared") {
      ev.preventDefault();
      invState._editCellKey = null;
      void importSharedItemsIntoCurrentInventorySub();
    } else if (t.id === "ff-inv2-add-group") {
      ev.preventDefault();
      invState._editCellKey = null;
      addInventoryGroup();
      mountOrRefreshMockUi();
    }
  });
  ensureInvMobileColHeaderBindOnce();
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
  if (invState._invTableLoadedForSubId === key) {
    // If this sub is currently loaded, refetch from Firestore and rerender.
    const seq = ++invState._invTableLoadSeq;
    invState._invTableLoading = true;
    mountOrRefreshMockUi();
    void loadInventoryTableForSub(cat, sub, seq, key);
    return;
  }
  // Otherwise invalidate cache so next navigation refetches.
  if (!invState._invTableLoading) invState._invTableLoadedForSubId = null;
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
      invState._categoryTree = [];
      invState._persistedCategoryTree = [];
      invState._invOrdersList = [];
      invState._invOrdersLoadError = null;
      invState._invOrderDraftLoaded = false;
      invState._invActiveDraftId = null;
      invState._invOrderBuilderManualLines = [];
      invState._invOrderBuilderCustomSubIds = new Set();
      invState._invOrderBuilderAutoQtyOverrides = {};
      invState._invOrderSaveNameDraft = "";
      invState._invOrderDraftLastSavedAt = 0;
      invState._invOrderDraftSaveStatus = "idle";
      invState._invOrderDraftResumeToastShown = false;
      invState._invSuggestionsScannedThisSession = false;
      invState._invReorderScannedThisSession = false;
      invState._invObPickPanelOpen = false;
      invState._invTableLoadedForSubId = null;
      invState._selectedSubcategoryId = null;
      // Always re-load categories from Firestore with the new location filter,
      // even if the Inventory screen is not the active view right now. Skipping
      // the load when `isMounted` was false created a race where the tree
      // stayed empty after a location switch and Manage Categories showed
      // "No categories yet" even though the sidebar had stale HTML.
      invState._invCategoriesLoading = true;
      mountOrRefreshMockUi();
      loadInventoryCategoriesFromFirestore()
        .catch((e) => {
          console.warn("[Inventory] category reload on location change failed", e);
          invState._invCatLoadError = (e && e.message) || "Failed to load categories";
        })
        .finally(() => {
          invState._invCategoriesLoading = false;
          mountOrRefreshMockUi();
          if (invState._invMainTab === "orders") {
            void loadInventoryOrdersList({ silent: true });
          } else if (invState._invMainTab === "orderBuilder") {
            void loadInventoryOrderDraft(true);
          } else if (invState._invMainTab === "insights") {
            void refreshInventoryInsightsAsync();
          }
          void scanInventorySuggestionsOnce();
          void scanProductReorderAlertsOnce();
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
  if (invState._groupRemoveModalGroupId && invState._groups && !invState._groups.some((g) => g.id === invState._groupRemoveModalGroupId)) {
    invState._groupRemoveModalGroupId = null;
  }
  if (invState._invRowMenu && invState._rows && !invState._rows.some((r) => r.id === invState._invRowMenu.rowId)) invState._invRowMenu = null;
  if (invState._invRowDeleteModalRowId && invState._rows && !invState._rows.some((r) => r.id === invState._invRowDeleteModalRowId)) invState._invRowDeleteModalRowId = null;
  if (invState._invOrdersMenu && !invState._invOrdersList.some((o) => o.id === invState._invOrdersMenu.orderId)) invState._invOrdersMenu = null;
  if (
    invState._invOrdersDeleteConfirmOrderId &&
    !invState._invOrdersList.some((o) => o.id === invState._invOrdersDeleteConfirmOrderId)
  ) {
    invState._invOrdersDeleteConfirmOrderId = null;
  }
  if (
    invState._invOrdersMarkOrderedConfirmOrderId &&
    !invState._invOrdersList.some((o) => o.id === invState._invOrdersMarkOrderedConfirmOrderId)
  ) {
    invState._invOrdersMarkOrderedConfirmOrderId = null;
  }
  if (
    invState._invOrdersRenameModal &&
    !invState._invOrdersList.some((o) => o.id === invState._invOrdersRenameModal.orderId)
  ) {
    invState._invOrdersRenameModal = null;
  }
  if (invState._invOrderDetailLineViewIdx != null && invState._invOrdersDetailOrderId) {
    const ord = invState._invOrdersList.find((x) => x.id === invState._invOrdersDetailOrderId);
    const nItems = ord && Array.isArray(ord.items) ? ord.items.length : 0;
    if (!ord || invState._invOrderDetailLineViewIdx < 0 || invState._invOrderDetailLineViewIdx >= nItems) {
      invState._invOrderDetailLineViewIdx = null;
    }
  }
  if (invState._invOrderCellBreakdownModal) {
    const row = Array.isArray(invState._rows) ? invState._rows.find((r) => r.id === invState._invOrderCellBreakdownModal.rowId) : null;
    const group = Array.isArray(invState._groups) ? invState._groups.find((g) => g.id === invState._invOrderCellBreakdownModal.groupId) : null;
    if (!row || !group) invState._invOrderCellBreakdownModal = null;
  }
  injectMockStylesOnce();
  root.classList.add("ff-inv2-screen");

  // View-only users can never land on a management tab (Create Order / Orders /
  // Insights); snap them back to the read-only Inventory tab.
  if (!ffCanManageInventory() && invState._invMainTab !== "inventory") {
    invState._invMainTab = "inventory";
    invState._invOrdersDetailOrderId = null;
  }

  const meta = getSelectedSubMeta();
  const crumb =
    invState._invMainTab === "orders"
      ? `<span class="ff-inv2-crumb"><strong>Orders</strong></span>`
      : meta
        ? `<span class="ff-inv2-crumb"><strong>${escapeHtml(meta.category.name)}</strong> · ${escapeHtml(meta.sub.name)}</span>`
        : `<span class="ff-inv2-crumb">Select a subcategory</span>`;
  const invStripLabel = meta
    ? `${meta.category.name} · ${meta.sub.name}`
    : "Select a subcategory";
  const hideCategoryAside = invState._invMainTab === "orders";
  let invMobileCollapsed = false;
  if (!hideCategoryAside) {
    try {
      invMobileCollapsed =
        typeof matchMedia !== "undefined" &&
        matchMedia("(max-width: 767.98px)").matches &&
        !invState._invMobileCatsPanelOpen &&
        !!invState._selectedSubcategoryId;
    } catch (_) {}
  }

  let layoutMobileCreateOrder = "";
  try {
    if (
      typeof matchMedia !== "undefined" &&
      matchMedia("(max-width: 767.98px)").matches &&
      invState._invMainTab === "orderBuilder"
    ) {
      layoutMobileCreateOrder = " ff-inv2-layout--mobile-create-order";
    }
  } catch (_) {}
  const layoutNoCats = hideCategoryAside ? " ff-inv2-layout--no-category-aside" : "";

  if (invState._invOrdersDetailOrderId) {
    ensureShoppingDraft(invState._invOrdersDetailOrderId);
  }
  if (
    invState._invReceiptInfoModalOrderId &&
    (!invState._invOrdersList.some((x) => x.id === invState._invReceiptInfoModalOrderId) ||
      invState._invReceiptInfoModalOrderId !== invState._invOrdersDetailOrderId ||
      !invState._invOrdersDetailOrderId)
  ) {
    invState._invReceiptInfoModalOrderId = null;
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
<div class="ff-inv2-layout${invMobileCollapsed ? " ff-inv2-layout--mobile-cats-collapsed" : ""}${layoutMobileCreateOrder}${layoutNoCats}">
  ${
    hideCategoryAside
      ? ""
      : `<aside class="ff-inv2-aside" aria-label="Categories">
    <button type="button" class="ff-inv2-mobile-cat-strip" data-inv-mobile-cat-strip="1" aria-expanded="${invMobileCollapsed ? "false" : "true"}" aria-controls="ff-inv2-aside-panel">
      <span class="ff-inv2-mobile-cat-strip-text">${escapeHtml(invStripLabel)}</span>
      <span class="ff-inv2-mobile-cat-strip-chev" aria-hidden="true">▾</span>
    </button>
    <div class="ff-inv2-aside-panel" id="ff-inv2-aside-panel">
    <div class="ff-inv2-aside-head ff-inv2-aside-head-row">
      <span class="ff-inv2-aside-head-left">
        <button type="button" class="ff-inv2-mobile-aside-collapse" data-inv-mobile-aside-collapse="1" aria-label="Collapse category list">▲</button>
        <span>Categories</span>
      </span>
      <span class="ff-inv2-aside-head-actions" style="display:inline-flex;gap:6px;align-items:center;">
        <button type="button" class="ff-inv2-aside-add" data-inv-import-shared-catalog="1">Import Shared</button>
        <button type="button" class="ff-inv2-aside-add" data-cat-manage-open="1">+ Add</button>
      </span>
    </div>
    ${_ffInvDebugBanner}
    <div class="ff-inv2-aside-body" id="ff-inv2-aside-body">${renderSidebarHtml()}</div>
    </div>
  </aside>`
  }
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
  ensureInvMobileColHeaderBindOnce();
  applyInvMobileColumnClasses();
  scheduleSyncInvColWidthsAfterLayout();
  syncOrderBuilderCategoryCheckboxIndeterminate(root);
  _ffApplyInventoryReadonlyState(root);

  const asideBody = root.querySelector("#ff-inv2-aside-body");
  if (asideBody) {
    asideBody.querySelectorAll("[data-cat-toggle]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = el.getAttribute("data-cat-toggle");
        if (!id) return;
        if (invState._expandedCategoryIds.has(id)) invState._expandedCategoryIds.delete(id);
        else invState._expandedCategoryIds.add(id);
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
      invState._editCellKey = null;
      invState._invRowMenu = null;
      invState._invRowDeleteModalRowId = null;
      invState._manageCategoriesOpen = false;
      invState._catManageDraftTree = null;
      resetCatModalTransientState();
      invState._groupRemoveConfirmId = null;
      invState._groupRemoveModalGroupId = null;
      invState._selectedSubcategoryId = id;
      invState._invMainTab = "inventory";
      invState._invOrdersDetailOrderId = null;
      invState._invReceiptInfoModalOrderId = null;
      invState._invOrderDetailLineViewIdx = null;
      invState._invOrdersMenu = null;
      invState._invOrdersDeleteConfirmOrderId = null;
      invState._invOrdersMarkOrderedConfirmOrderId = null;
      invState._invOrdersRenameModal = null;
      invState._invOrderCellBreakdownModal = null;
      try {
        if (typeof matchMedia !== "undefined" && matchMedia("(max-width: 767.98px)").matches) {
          invState._invMobileCatsPanelOpen = false;
        }
      } catch (_) {}
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
}

// When the current user lacks "Manage inventory" permission, lock the screen to
// read-only: hide all add/edit/remove affordances and make every table cell
// input non-editable. Write paths are also guarded individually, so this is a
// UI affordance layer on top of those hard guards.
function _ffApplyInventoryReadonlyState(root) {
  try {
    if (!root) return;
    if (typeof document !== "undefined" && !document.getElementById("ff-inv2-readonly-style")) {
      const st = document.createElement("style");
      st.id = "ff-inv2-readonly-style";
      st.textContent =
        "#inventoryScreen.ff-inv2-readonly #ff-inv2-add-row," +
        "#inventoryScreen.ff-inv2-readonly #ff-inv2-add-group," +
        "#inventoryScreen.ff-inv2-readonly #ff-inv2-add-from-shared," +
        "#inventoryScreen.ff-inv2-readonly [data-inv-import-shared-catalog]," +
        "#inventoryScreen.ff-inv2-readonly [data-cat-manage-open]," +
        "#inventoryScreen.ff-inv2-readonly [data-inv-row-menu-trigger]," +
        "#inventoryScreen.ff-inv2-readonly .ff-inv2-row-kebab," +
        "#inventoryScreen.ff-inv2-readonly [data-inv-row-dnd]," +
        "#inventoryScreen.ff-inv2-readonly .ff-inv2-row-dnd-handle," +
        "#inventoryScreen.ff-inv2-readonly [data-inv-url-edit]{display:none !important;}";
      (document.head || document.documentElement).appendChild(st);
    }
    const canManage = ffCanManageInventory();
    root.classList.toggle("ff-inv2-readonly", !canManage);
    if (!canManage) {
      root.querySelectorAll("input[data-inv], textarea[data-inv]").forEach((el) => {
        try {
          el.readOnly = true;
          el.setAttribute("aria-readonly", "true");
        } catch (_) {}
      });
    }
  } catch (_) {}
}

function hideFullscreenPeersForInventory() {
  const ids = [
    "tasksScreen",
    "inboxScreen",
    "chatScreen",
    "mediaScreen",
    "ticketsScreen",
    "servicesScreen",
    "productsScreen",
    "trainingScreen",
    "scheduleScreen",
    "timeClockScreen",
    "pointsAppScreen",
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
  invState._invOrderDraftLoaded = false;

  invState._invCategoriesLoading = true;
  mountOrRefreshMockUi();

  screen.style.display = "flex";
  screen.style.flexDirection = "column";
  // Other screens (e.g. Products) set pointer-events:none on inventoryScreen
  // when they hide peers; restore it so the inventory UI stays clickable.
  screen.style.pointerEvents = "auto";

  document.querySelectorAll(".btn-pill").forEach((b) => b.classList.remove("active"));
  const invBtn = document.getElementById("inventoryNavBtn");
  if (invBtn) invBtn.classList.add("active");

  // Smart Inventory Suggestions — run once per session, fire-and-forget.
  // Silently creates Inbox alerts for items forecast to run out within 3 days.
  void scanInventorySuggestionsOnce();
  // Product reorder-point alerts — once per session, fire-and-forget.
  void scanProductReorderAlertsOnce();

  void (async () => {
    try {
      await loadInventoryCategoriesFromFirestore();
    } catch (e) {
      console.error("[Inventory] category load failed", e);
      invState._invCatLoadError = (e && e.message) || "Failed to load categories";
      invState._categoryTree = [];
      invState._persistedCategoryTree = [];
    } finally {
      invState._invCategoriesLoading = false;
      // Drop the cached table so it rebuilds from freshly-loaded data. This is
      // essential for product-backed subcategories: stock edited in the
      // Products app must be re-read here instead of showing stale rows.
      // Also clear the in-flight load flag (and bump the load sequence) so the
      // post-load mount can start a clean reload instead of being blocked by a
      // stale load that ran before the catalog refresh.
      invState._invTableLoadedForSubId = null;
      invState._invTableLoading = false;
      invState._invTableLoadSeq++;
      mountOrRefreshMockUi();
    }

    // If the user lands directly on the Create Order tab, load its draft after first paint.
    if (invState._invMainTab === "orderBuilder") {
      void loadInventoryOrderDraft();
    }
  })();

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
      lines.push(`memoryTree=${(invState._categoryTree || []).length} cats (what the sidebar renders)`);
      lines.push(`bucketCount=${Object.keys(buckets).length}`);
      lines.push("--- by bucket ---");
      for (const [k, v] of Object.entries(buckets)) {
        lines.push(`  ${k}: ${v}`);
      }
      lines.push("--- in-memory tree (sidebar) ---");
      for (const c of (invState._categoryTree || [])) {
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
