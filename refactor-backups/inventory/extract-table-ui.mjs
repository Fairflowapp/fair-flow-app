import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const SRC = "public/inventory-table.js";
const OUT = "public/inventory-table-ui.js";
const BACKUP = "refactor-backups/inventory/inventory-table.pre-ui.js";
const TOKEN = "20260701_inventory_table_ui_split";
const PERSIST_TOKEN = "20260701_inventory_table_persist_split";
const LAYOUT_TOKEN = "20260701_inventory_table_layout_split";
const ROWS_TOKEN = "20260701_inventory_table_rows_split";
const sha = (s) => createHash("sha1").update(s).digest("hex");

const backup = readFileSync(BACKUP, "utf8");
const lines = backup.split("\n");

const UI = { start: 116, end: 743 };

function sliceBlock({ start, end }) {
  return lines.slice(start - 1, end).join("\n");
}

const uiBody = sliceBlock(UI);

if (!/^function renderInventoryTableCardHtml\(\) \{$/.test(lines[UI.start - 1])) {
  console.error("UI start mismatch:", lines[UI.start - 1]);
  process.exit(1);
}
if (lines[UI.end - 1].trim() !== "}") {
  console.error("UI end mismatch:", lines[UI.end - 1]);
  process.exit(1);
}
if (!lines[UI.end + 1].trim().startsWith("export {")) {
  console.error("UI after-end mismatch:", lines[UI.end + 1]);
  process.exit(1);
}

const uiMod = `// inventory-table-ui.js
// Table card shell, HTML renderers, handleInventoryInput, modals, and long-press.
// Extracted verbatim from inventory-table.js (Phase T4). Spine injected via init.

import { db } from "/app.js?v=20260610_force_lp_ios";

import {
  doc,
  updateDoc,
  serverTimestamp,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

import { invState } from "./inventory-state.js?v=20260627_inventory_split";

import {
  escapeHtml,
  parseNum,
  isProductsInventorySub,
  normalizeRowFromFirestore,
  serializeInventoryRowForFirestore,
  computeOrder,
  getCellApprovedInfo,
  formatOrderDisplay,
  formatInventoryOrderCreatedAt,
  renderOrderCellTd,
  thResizeHandle,
  getItemOrderQty,
} from "./inventory-helpers.js?v=20260627_inventory_split";

import { getCategoryTree } from "./inventory-catalog.js?v=20260627_inventory_catalog";

import {
  inventoryOrderDraftToast,
  scheduleInventoryOrderDraftSave,
} from "./inventory-orders.js?v=20260627_inventory_orders_split";

import { refreshInventoryInsightsAsync } from "./inventory-insights.js?v=20260627_inventory_insights";

import {
  scheduleInventoryTablePersist,
  ensureTableReadyForEdits,
  loadInventoryTableForSub,
} from "./inventory-table-persist.js?v=${PERSIST_TOKEN}";

import {
  getInvColWidths,
  getInvMobileGroupSubColWidthsPx,
  renderColgroup,
} from "./inventory-table-layout.js?v=${LAYOUT_TOKEN}";

import {
  groupHasAnyValues,
  renderEditableCell,
  renderUrlCell,
  updateOrderCellEl,
} from "./inventory-table-rows.js?v=${ROWS_TOKEN}";

let mountOrRefreshMockUi, ffCanManageInventory, getSalonId;

export function initInventoryTableUi(deps) {
  ({ mountOrRefreshMockUi, ffCanManageInventory, getSalonId } = deps);
}

${uiBody}

export {
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
};
`;

writeFileSync(OUT, uiMod);

const barrel = `/**
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
} from "./inventory-table-persist.js?v=${PERSIST_TOKEN}";

import {
  applyInvMobileColumnClasses,
  bindInvColumnResizeOnce,
  ensureInvMobileColHeaderBindOnce,
  getInvColWidths,
  invMobileAnyOptionalColumnHidden,
  isInvMobileNarrow,
  resetInvMobileOptionalColumns,
  scheduleSyncInvColWidthsAfterLayout,
} from "./inventory-table-layout.js?v=${LAYOUT_TOKEN}";

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
} from "./inventory-table-rows.js?v=${ROWS_TOKEN}";

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
} from "./inventory-table-ui.js?v=${TOKEN}";

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
`;

writeFileSync(SRC, barrel);

console.log("inventory-table-ui.js lines:", uiMod.split("\n").length);
console.log("inventory-table.js barrel lines:", barrel.split("\n").length);
console.log("sha(ui body):", sha(uiBody));
