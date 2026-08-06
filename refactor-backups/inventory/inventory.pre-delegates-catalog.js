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

import {
  ffCanManageInventory,
  _ffInvActiveLocId,
  _ffInvUserHasMultipleLocations,
  _ffInvDocInActiveLoc,
  getSalonId,
  getInventoryLocationStateId,
  sharedInvItemsRef,
  sharedInvStateDocRef,
} from "./inventory-spine.js?v=20260701_inventory_spine_split";
import { initInventoryShell, mountOrRefreshMockUi } from "./inventory-shell.js?v=20260701_inventory_shell_split";

import {
  initInventoryInsights,
  refreshInventoryInsightsAsync,
  renderInventoryInsightsTabHtml,
  scanInventorySuggestionsOnce,
  scanProductReorderAlertsOnce,
} from "./inventory-insights.js?v=20260627_inventory_insights";


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
} from "./inventory-orders.js?v=20260627_inventory_orders_split";


import {
  initInventoryTable,
  addInventoryGroup,
  addInventoryRow,
  applyInvMobileColumnClasses,
  bindInvColumnResizeOnce,
  bindInvRowDnDOnce,
  bindInventoryOrderCellLongPressOnce,
  clearInventoryTableSaveTimer,
  deleteInventoryRow,
  duplicateInventoryRow,
  ensureGroupCellsForRows,
  ensureInvEditDocListenerOnce,
  ensureInvMobileColHeaderBindOnce,
  fetchSubcategoryInventoryDoc,
  findCategoryAndSubForSubId,
  findInvEditInput,
  findSubMeta,
  flushInventoryTableToFirestore,
  getInvCellKeyFromEl,
  getSelectedSubMeta,
  handleInventoryInput,
  importSharedItemsIntoCurrentInventorySub,
  invMobileAnyOptionalColumnHidden,
  isInvMobileNarrow,
  loadInventoryTableForSub,
  prepareInventoryTableStateForMount,
  removeApprovedContributionForCell,
  removeInventoryGroup,
  renderDeleteRowModal,
  renderInvRowMenu,
  renderInventoryOrderCellBreakdownModal,
  renderInventoryTableCardHtml,
  renderRemoveGroupModal,
  resetInvMobileOptionalColumns,
  scheduleSyncInvColWidthsAfterLayout,
} from "./inventory-table.js?v=20260627_inventory_table3";

initInventoryShell({
  ensureInventoryScreenDelegates,
  prepareInventoryTableStateForMount,
  ensureGroupCellsForRows,
  prepareOrderBuilderPreviewForMount,
  getSelectedSubMeta,
  getCategoryTree,
  resetCatModalTransientState,
  renderSidebarHtml,
  renderOrderListSectionHtml,
  renderOrdersTabHtml,
  renderInventoryInsightsTabHtml,
  renderInventoryTableCardHtml,
  renderRemoveGroupModal,
  renderManageCategoriesModal,
  renderCategoryDeleteConfirmModal,
  renderDeleteRowModal,
  renderInvRowMenu,
  renderInventoryOrderDetailModal,
  renderOrderDetailLineViewModal,
  renderReceiptInfoModal,
  renderInventoryOrdersMenu,
  renderInventoryOrdersDeleteModal,
  renderInventoryOrdersMarkOrderedModal,
  renderInventoryOrdersRenameModal,
  renderInventoryOrderBuilderAddItemModal,
  renderInventoryOrderCellBreakdownModal,
  renderInventoryDraftsPickerModal,
  ensureShoppingDraft,
  ensureInventoryOrderReceiptsSubscription,
  ensureInvMobileColHeaderBindOnce,
  applyInvMobileColumnClasses,
  scheduleSyncInvColWidthsAfterLayout,
  syncOrderBuilderCategoryCheckboxIndeterminate,
  clearInventoryTableSaveTimer,
  flushInventoryTableToFirestore,
});

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

// Wire inventory.js internals into the Insights sub-app (breaks the import
// cycle: orchestrator <-> insights). All five are hoisted function decls.
initInventoryInsights({
  getSalonId,
  getCategoryTree,
  fetchSubcategoryInventoryDoc,
  _ffInvDocInActiveLoc,
  mountOrRefreshMockUi,
});

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

// Wire inventory.js orchestrator spine into the Table sub-app (breaks the
// orchestrator <-> table import cycle). The Table fns re-imported above are also
// injected into Catalog/Insights/Orders (resolved automatically via these imports).
initInventoryTable({
  _ffInvActiveLocId,
  ffCanManageInventory,
  getInventoryLocationStateId,
  getSalonId,
  mountOrRefreshMockUi,
  sharedInvItemsRef,
  sharedInvStateDocRef,
});



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

/** Narrow screens only: hide optional columns to free horizontal space. Stock/Current/Order/Price + Name always stay. */
/** @type {ReturnType<typeof setTimeout> | null} */

/** Row context menu (right-click or ⋯): local UI only */
/** Delete row confirmation modal */

/** Firestore table sync for `salons/.../inventorySubcategories/{subId}` (groups + rows fields). */
/** `${categoryId}:${subId}` when invState._groups/invState._rows match that sub; null if none loaded. */
/** Row drag-reorder: row id being dragged (HTML5 DnD). */


/** One-step undo for row/group delete: delayed Firestore write + toast. */
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



// Target / par level (how many the salon wants to keep). Drives the "Stock"
// column and the Order calculation (Order = Stock - Current).






/**
 * Persist full category tree from Manage modal Save. Diff vs invState._persistedCategoryTree.
 * @param {ReturnType<typeof cloneCategoryTree>} desiredTree
 */






/** Move sub between categories or reorder within one category. targetSubId null = append to end of target category. */





/** Normalize an approvedRequests[] entry from Firestore (defensive) — keeps required fields only. */

/** Serialize a normalized row to Firestore `rows[]` shape (matches `buildFirestoreRowsFromUi`). */






/** Build Firestore `columnWidths` map (group_<id> for each group block width). */

/**
 * Apply saved widths from subcategory doc; missing groups use default from getInvColWidths.
 * @param {Record<string, unknown> | null | undefined} data subcategory document data
 */






/** Deep clone a row for undo restore (all group cells). */



/** Commit a pending delete to Firestore before another destructive action. */






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


/**
 * One line per row×group where Stock − Current > 0.
 * itemId is unique across subcategories when subId is included.
 */

/** Apply persisted user edits to auto-generated preview line quantities. */

/** Drop override keys that no longer match any preview line (after category changes / refresh). */





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












/**
 * @param {HTMLElement | null} root
 * @param {string} editKey
 */

/**
 * @param {string} inv
 * @param {string} rowId
 * @param {string | number} value
 * @param {{ groupId?: string | null, mono?: boolean, classNames?: string, inputMode?: "decimal" | "numeric" }} opts
 */










/** Mobile: restore #, Code, drag, Supplier, URL after hiding via double-tap header. */




/**
 * Mobile only: tight widths per Stock / Current / Order / Price from longest cell in each
 * logical column (so a wide Price does not widen Current). Desktop: one width for all four.
 * @returns {[number, number, number, number]}
 */


/** After mount, horizontal layout may be 0 until flex finishes — sync col widths again. */








/** Reorder invState._rows only; does not touch rowNo. */




/** True if any row has non-zero stock/current or non-empty price in this group. */





















/**
 * Toggle the Bought (B) quantity for a shopping row driven by its checkbox.
 * "Got exactly what's needed" — B = 0 → N (check), B = N or complete → 0 (uncheck),
 * partial B (0 < B < N) → complete to N.
 */



/**
 * Long-press (~500ms) on an Order Details row opens Line details. Normal tap still toggles ✓ via row click.
 * Eats the next click on that row so the release after long-press does not toggle the checkbox.
 */

/**
 * Long-press (~500ms) on an inventory Order cell opens the breakdown modal.
 * Eats the next click so short release doesn't bubble up.
 */

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


// When the current user lacks "Manage inventory" permission, lock the screen to
// read-only: hide all add/edit/remove affordances and make every table cell
// input non-editable. Write paths are also guarded individually, so this is a
// UI affordance layer on top of those hard guards.

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
