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
import { goToInventory } from "./inventory-nav.js?v=20260701_inventory_nav_split";
export { goToInventory };
import "./inventory-devtools.js?v=20260701_inventory_devtools_split";
import {
  initInventoryDelegatesCatalog,
  bindInventoryDelegatesCatalogOnce,
  handleInventoryCatalogDelegateClick,
  handleInventoryCatalogDelegateKeydownActivate,
  handleInventoryCatalogDelegateKeydownEscape,
} from "./inventory-delegates-catalog.js?v=20260701_inventory_delegates_catalog_split";
import {
  initInventoryDelegatesOrders,
  bindInventoryDelegatesOrdersOnce,
  bindInventoryOrdersDelegateOrderRowKeydown,
  handleInventoryOrdersDelegateFocusout,
  handleInventoryOrdersDelegateKeydown,
  handleInventoryOrdersDelegateKeydownEscape,
  handleInventoryOrdersDelegateClick,
} from "./inventory-delegates-orders.js?v=20260701_inventory_delegates_orders_split";
import {
  initInventoryDelegatesWorkspace,
  bindInventoryDelegatesWorkspaceOnce,
} from "./inventory-delegates-workspace.js?v=20260701_inventory_delegates_workspace_split";

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

initInventoryDelegatesCatalog({ mountOrRefreshMockUi });
initInventoryDelegatesOrders({ mountOrRefreshMockUi });
initInventoryDelegatesWorkspace({ mountOrRefreshMockUi });




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
  goToInventory,
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
  bindInventoryDelegatesCatalogOnce(root);
  bindInventoryDelegatesOrdersOnce(root);
  bindInventoryOrdersDelegateOrderRowKeydown(root);
  bindInventoryDelegatesWorkspaceOnce(root);
}



// When the current user lacks "Manage inventory" permission, lock the screen to
// read-only: hide all add/edit/remove affordances and make every table cell
// input non-editable. Write paths are also guarded individually, so this is a
// UI affordance layer on top of those hard guards.



/**
 * Add a Smart Inventory Suggestion (from Inbox) as a manual line in Create Order.
 * - Navigates to Inventory → Create Order tab
 * - Pushes a linked manual line (rowId:groupId) with the suggested quantity
 * - Avoids duplicates: if the same linked item is already in the manual list, just bumps qty.
 * Returns true on success.
 */

if (typeof window !== "undefined") {
  window.ffAddInventorySuggestionToOrder = ffAddInventorySuggestionToOrder;
}
