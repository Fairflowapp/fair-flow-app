/**
 * Inventory — Table sub-app (rows/groups grid: rendering, cell editing,
 * columns + mobile layout, drag-and-drop, undo, Firestore persistence,
 * order-cell breakdown). Extracted verbatim from inventory.js.
 *
 * Shared state lives in inventory-state.js (single instance). Orchestrator spine
 * (salon/location/permissions, event-hub, render-orchestrator) is injected via
 * initInventoryTable() to break the orchestrator<->table import cycle.
 */
import {
  initInventoryTablePersist,
  clearInventoryTableSaveTimer,
  importSharedItemsIntoCurrentInventorySub,
  fetchSubcategoryInventoryDoc,
  findCategoryAndSubForSubId,
  flushInventoryTableToFirestore,
  loadInventoryTableForSub,
  prepareInventoryTableStateForMount,
} from "./inventory-table-persist.js?v=20260902_inv_iso";

import {
  applyInvMobileColumnClasses,
  bindInvColumnResizeOnce,
  ensureInvMobileColHeaderBindOnce,
  getInvColWidths,
  invMobileAnyOptionalColumnHidden,
  isInvMobileNarrow,
  resetInvMobileOptionalColumns,
  scheduleSyncInvColWidthsAfterLayout,
} from "./inventory-table-layout.js?v=20260902_inv_iso";

import {
  initInventoryTableRows,
  addInventoryGroup,
  addInventoryRow,
  bindInvRowDnDOnce,
  deleteInventoryRow,
  duplicateInventoryRow,
  ensureGroupCellsForRows,
  ensureInvEditDocListenerOnce,
  findInvEditInput,
  getInvCellKeyFromEl,
  removeInventoryGroup,
} from "./inventory-table-rows.js?v=20260902_inv_iso";

import {
  initInventoryTableUi,
  bindInventoryOrderCellLongPressOnce,
  findSubMeta,
  getSelectedSubMeta,
  handleInventoryInput,
  removeApprovedContributionForCell,
  renderDeleteRowModal,
  renderInvRowMenu,
  renderInventoryOrderCellBreakdownModal,
  renderInventoryTableCardHtml,
  renderRemoveGroupModal,
} from "./inventory-table-ui.js?v=20260902_inv_iso";

export function initInventoryTable(deps) {
  initInventoryTableUi({
    mountOrRefreshMockUi: deps.mountOrRefreshMockUi,
    ffCanManageInventory: deps.ffCanManageInventory,
    getSalonId: deps.getSalonId,
  });
  initInventoryTableRows({
    mountOrRefreshMockUi: deps.mountOrRefreshMockUi,
    ffCanManageInventory: deps.ffCanManageInventory,
  });
  initInventoryTablePersist({
    ...deps,
    getInvColWidths,
    ensureGroupCellsForRows,
    findSubMeta,
  });
}

export {
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
};
