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
import { invState } from "./inventory-state.js?v=20260728_inv_mobile_unstick";
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
} from "./inventory-helpers.js?v=20260728_inv_mobile_unstick";

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
} from "./inventory-catalog.js?v=20260728_inv_mobile_unstick";

import {
  ffCanManageInventory,
  _ffInvActiveLocId,
  _ffInvUserHasMultipleLocations,
  _ffInvDocInActiveLoc,
  getSalonId,
  getInventoryLocationStateId,
  sharedInvItemsRef,
  sharedInvStateDocRef,
} from "./inventory-spine.js?v=20260728_inv_mobile_unstick";
import { initInventoryShell, mountOrRefreshMockUi } from "./inventory-shell.js?v=20260728_inv_mobile_unstick";
import { goToInventory } from "./inventory-nav.js?v=20260728_inv_mobile_unstick";
export { goToInventory };
import "./inventory-devtools.js?v=20260728_inv_mobile_unstick";
import {
  initInventoryDelegatesCatalog,
  bindInventoryDelegatesCatalogOnce,
  handleInventoryCatalogDelegateClick,
  handleInventoryCatalogDelegateKeydownActivate,
  handleInventoryCatalogDelegateKeydownEscape,
} from "./inventory-delegates-catalog.js?v=20260728_inv_mobile_unstick";
import {
  initInventoryDelegatesOrders,
  bindInventoryDelegatesOrdersOnce,
  bindInventoryOrdersDelegateOrderRowKeydown,
  handleInventoryOrdersDelegateFocusout,
  handleInventoryOrdersDelegateKeydown,
  handleInventoryOrdersDelegateKeydownEscape,
  handleInventoryOrdersDelegateClick,
} from "./inventory-delegates-orders.js?v=20260728_inv_mobile_unstick";
import {
  initInventoryDelegatesWorkspace,
  bindInventoryDelegatesWorkspaceOnce,
} from "./inventory-delegates-workspace.js?v=20260728_inv_mobile_unstick";

import {
  initInventoryInsights,
  refreshInventoryInsightsAsync,
  renderInventoryInsightsTabHtml,
  scanInventorySuggestionsOnce,
  scanProductReorderAlertsOnce,
} from "./inventory-insights.js?v=20260728_inv_mobile_unstick";


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
} from "./inventory-orders.js?v=20260728_inv_mobile_unstick";


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
} from "./inventory-table.js?v=20260728_inv_mobile_unstick";

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

try {
  if (typeof window !== "undefined") {
    window.ffScanProductReorderAlerts = (force) => { void scanProductReorderAlertsOnce(force !== false); };
  }
} catch (_) {}

function ensureInventoryScreenDelegates(root) {
  if (root.dataset.ffInvDelegates === "1") return;
  root.dataset.ffInvDelegates = "1";
  ensureInvEditDocListenerOnce();
  bindInventoryDelegatesCatalogOnce(root);
  bindInventoryDelegatesOrdersOnce(root);
  bindInventoryOrdersDelegateOrderRowKeydown(root);
  bindInventoryDelegatesWorkspaceOnce(root);
}

if (typeof window !== "undefined") {
  window.ffAddInventorySuggestionToOrder = ffAddInventorySuggestionToOrder;
}
