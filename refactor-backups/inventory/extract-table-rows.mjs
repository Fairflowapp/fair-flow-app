import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const SRC = "public/inventory-table.js";
const OUT = "public/inventory-table-rows.js";
const BACKUP = "refactor-backups/inventory/inventory-table.pre-rows.js";
const TOKEN = "20260701_inventory_table_rows_split";
const sha = (s) => createHash("sha1").update(s).digest("hex");

const backup = readFileSync(BACKUP, "utf8");
const lines = backup.split("\n");

const ROWS = { start: 134, end: 495 };

function sliceBlock({ start, end }) {
  return lines.slice(start - 1, end).join("\n");
}

const rowsBody = sliceBlock(ROWS);

if (!/^function getInvCellKeyFromEl\(el\) \{$/.test(lines[ROWS.start - 1])) {
  console.error("ROWS start mismatch:", lines[ROWS.start - 1]);
  process.exit(1);
}
if (lines[ROWS.end - 1].trim() !== "}") {
  console.error("ROWS end mismatch:", lines[ROWS.end - 1]);
  process.exit(1);
}
if (!/^function handleInventoryInput\(ev\) \{$/.test(lines[ROWS.end + 1])) {
  console.error("ROWS after-end mismatch:", lines[ROWS.end + 1]);
  process.exit(1);
}

const rowsMod = `// inventory-table-rows.js
// Cell edit helpers, row/group CRUD, row DnD, and order-cell DOM updates.
// Extracted verbatim from inventory-table.js (Phase T3). Spine injected via init.

import { invState } from "./inventory-state.js?v=20260627_inventory_split";

import {
  escapeHtml,
  newRowId,
  newGroupId,
  cloneInvRowForUndo,
  parseNum,
  computeOrder,
  getCellApprovedInfo,
  formatOrderDisplay,
  invCellKey,
  hrefForUrl,
} from "./inventory-helpers.js?v=20260627_inventory_split";

import { resetCatModalTransientState } from "./inventory-catalog.js?v=20260627_inventory_catalog";

import {
  ensureTableReadyForEdits,
  flushInventoryTableToFirestore,
  commitPendingInventoryDeleteIfAny,
  startInventoryUndo,
} from "./inventory-table-persist.js?v=20260701_inventory_table_persist_split";

import { getInvColWidths } from "./inventory-table-layout.js?v=20260701_inventory_table_layout_split";

let mountOrRefreshMockUi, ffCanManageInventory;

export function initInventoryTableRows(deps) {
  ({ mountOrRefreshMockUi, ffCanManageInventory } = deps);
}

${rowsBody}

export {
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
  renderEditableCell,
  renderUrlCell,
  updateOrderCellEl,
};
`;

writeFileSync(OUT, rowsMod);

const drop = new Set();
for (let i = ROWS.start; i <= ROWS.end; i++) drop.add(i);

const reducedLines = lines.filter((_, i) => !drop.has(i + 1));
let reduced = reducedLines.join("\n");

const ROWS_IMPORT = `import {
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
  renderEditableCell,
  renderUrlCell,
  updateOrderCellEl,
} from "./inventory-table-rows.js?v=${TOKEN}";`;

const LAYOUT_ANCHOR =
  '} from "./inventory-table-layout.js?v=20260701_inventory_table_layout_split";';
if (!reduced.includes(LAYOUT_ANCHOR)) {
  console.error("layout import anchor missing");
  process.exit(1);
}
reduced = reduced.replace(LAYOUT_ANCHOR, LAYOUT_ANCHOR + "\n\n" + ROWS_IMPORT);

const OLD_INIT = `export function initInventoryTable(deps) {
  initInventoryTablePersist({
    ...deps,
    getInvColWidths,
    ensureGroupCellsForRows,
    findSubMeta,
  });
}`;
const NEW_INIT = `export function initInventoryTable(deps) {
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
}`;
if (!reduced.includes(OLD_INIT)) {
  console.error("initInventoryTable block not found");
  process.exit(1);
}
reduced = reduced.replace(OLD_INIT, NEW_INIT);

writeFileSync(SRC, reduced);

console.log("inventory-table-rows.js lines:", rowsMod.split("\n").length);
console.log("inventory-table.js:", lines.length, "->", reduced.split("\n").length);
console.log("sha(rows body):", sha(rowsBody));
