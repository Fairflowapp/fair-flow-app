import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const SRC = "public/inventory.js";
const OUT = "public/inventory-shell.js";
const BACKUP = "refactor-backups/inventory/inventory.pre-shell.js";
const TOKEN = "20260701_inventory_shell_split";
const sha = (s) => createHash("sha1").update(s).digest("hex");

const backup = readFileSync(BACKUP, "utf8");
const lines = backup.split("\n");

const BLOCKS = [
  { start: 587, end: 607, label: "renderInvMainTabsHtml" },
  { start: 725, end: 738, label: "renderInvMainTabPanelsHtml" },
  { start: 792, end: 799, label: "injectMockStylesOnce" },
  { start: 2267, end: 2496, label: "mountOrRefreshMockUi" },
  { start: 2502, end: 2532, label: "_ffApplyInventoryReadonlyState" },
];

function sliceBlock({ start, end }) {
  return lines.slice(start - 1, end).join("\n");
}

// Boundary checks
if (!/^function renderInvMainTabsHtml\(\) \{$/.test(lines[586])) {
  console.error("tabs start", lines[586]);
  process.exit(1);
}
if (!/^function renderInvMainTabPanelsHtml\(\) \{$/.test(lines[724])) {
  console.error("panels start", lines[724]);
  process.exit(1);
}
if (!/^function injectMockStylesOnce\(\) \{$/.test(lines[791])) {
  console.error("styles start", lines[791]);
  process.exit(1);
}
if (!/^function mountOrRefreshMockUi\(\) \{$/.test(lines[2266])) {
  console.error("mount start", lines[2266]);
  process.exit(1);
}
if (!/^function _ffApplyInventoryReadonlyState\(root\) \{$/.test(lines[2501])) {
  console.error("readonly start", lines[2501]);
  process.exit(1);
}

const shellBody = BLOCKS.map((b, i) => sliceBlock(b) + (i < BLOCKS.length - 1 ? "\n" : "")).join("\n");

const INJECTED = [
  "ensureInventoryScreenDelegates",
  "prepareInventoryTableStateForMount",
  "ensureGroupCellsForRows",
  "prepareOrderBuilderPreviewForMount",
  "getSelectedSubMeta",
  "getCategoryTree",
  "resetCatModalTransientState",
  "renderSidebarHtml",
  "renderOrderListSectionHtml",
  "renderOrdersTabHtml",
  "renderInventoryInsightsTabHtml",
  "renderInventoryTableCardHtml",
  "renderRemoveGroupModal",
  "renderManageCategoriesModal",
  "renderCategoryDeleteConfirmModal",
  "renderDeleteRowModal",
  "renderInvRowMenu",
  "renderInventoryOrderDetailModal",
  "renderOrderDetailLineViewModal",
  "renderReceiptInfoModal",
  "renderInventoryOrdersMenu",
  "renderInventoryOrdersDeleteModal",
  "renderInventoryOrdersMarkOrderedModal",
  "renderInventoryOrdersRenameModal",
  "renderInventoryOrderBuilderAddItemModal",
  "renderInventoryOrderCellBreakdownModal",
  "renderInventoryDraftsPickerModal",
  "ensureShoppingDraft",
  "ensureInventoryOrderReceiptsSubscription",
  "ensureInvMobileColHeaderBindOnce",
  "applyInvMobileColumnClasses",
  "scheduleSyncInvColWidthsAfterLayout",
  "syncOrderBuilderCategoryCheckboxIndeterminate",
  "clearInventoryTableSaveTimer",
  "flushInventoryTableToFirestore",
];

const injectDecls = INJECTED.map((n) => `let ${n};`).join("\n");
const injectDestructure = INJECTED.map((n) => `    ${n},`).join("\n");

const shellMod = `// inventory-shell.js
// Inventory screen shell: main tabs/panels HTML, style injection, full layout mount,
// and read-only UI affordances. Extracted verbatim from inventory.js (Phase 11).
// Cross-module render/helpers are injected via initInventoryShell() from the orchestrator.

import { invState } from "./inventory-state.js?v=20260627_inventory_split";
import { escapeHtml } from "./inventory-helpers.js?v=20260627_inventory_split";
import { INVENTORY_STYLES } from "./inventory-styles.js?v=20260627_inv_css_quad";
import {
  STYLE_ID,
  ffCanManageInventory,
  _ffInvActiveLocId,
  _ffInvUserHasMultipleLocations,
} from "./inventory-spine.js?v=20260701_inventory_spine_split";

// ── injected by initInventoryShell() (orchestrator spine + sub-app render fns) ──
${injectDecls}

export function initInventoryShell(deps) {
  ({
${injectDestructure}
  } = deps);
}

${shellBody}

export { mountOrRefreshMockUi };
`;

writeFileSync(OUT, shellMod);

// Drop extracted lines from main.
const drop = new Set();
for (const b of BLOCKS) {
  for (let i = b.start; i <= b.end; i++) drop.add(i);
}
let reducedLines = lines.filter((_, i) => !drop.has(i + 1));

// Remove early init* blocks (re-added after initInventoryShell below table import).
const initPatterns = [
  /^\/\/ Wire inventory\.js internals into the Catalog sub-app/,
  /^\/\/ Wire inventory\.js internals into the Insights sub-app/,
  /^\/\/ Wire inventory\.js internals into the Orders sub-app/,
  /^\/\/ Wire inventory\.js orchestrator spine into the Table sub-app/,
];
const withoutInits = [];
let skipUntilBlank = false;
for (let i = 0; i < reducedLines.length; i++) {
  const l = reducedLines[i];
  if (initPatterns.some((p) => p.test(l))) {
    skipUntilBlank = true;
    continue;
  }
  if (skipUntilBlank) {
    if (l.trim() === "" && reducedLines[i + 1]?.trim() === "") {
      skipUntilBlank = false;
      continue;
    }
    if (l.trim() === "" && !reducedLines[i + 1]?.startsWith("initInventory")) {
      skipUntilBlank = false;
    }
    continue;
  }
  withoutInits.push(l);
}
reducedLines = withoutInits;

let reduced = reducedLines.join("\n");

const SPINE_ANCHOR = '} from "./inventory-spine.js?v=20260701_inventory_spine_split";';
const SHELL_IMPORT = `import { initInventoryShell, mountOrRefreshMockUi } from "./inventory-shell.js?v=${TOKEN}";`;
if (!reduced.includes(SPINE_ANCHOR)) {
  console.error("spine anchor missing");
  process.exit(1);
}
reduced = reduced.replace(SPINE_ANCHOR, SPINE_ANCHOR + "\n" + SHELL_IMPORT);

const TABLE_ANCHOR = '} from "./inventory-table.js?v=20260627_inventory_table3";';
const INIT_SHELL = `initInventoryShell({
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
`;

if (!reduced.includes(TABLE_ANCHOR)) {
  console.error("table anchor missing");
  process.exit(1);
}
reduced = reduced.replace(TABLE_ANCHOR, TABLE_ANCHOR + "\n\n" + INIT_SHELL);

writeFileSync(SRC, reduced);

console.log("inventory-shell.js lines:", shellMod.split("\n").length);
console.log("main:", lines.length, "->", reduced.split("\n").length);
console.log("sha(shell body):", sha(shellBody));
