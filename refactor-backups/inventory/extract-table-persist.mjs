import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const SRC = "public/inventory-table.js";
const OUT = "public/inventory-table-persist.js";
const BACKUP = "refactor-backups/inventory/inventory-table.pre-persist.js";
const TOKEN = "20260701_inventory_table_persist_split";
const sha = (s) => createHash("sha1").update(s).digest("hex");

const backup = readFileSync(BACKUP, "utf8");
const lines = backup.split("\n");

const UNDO_CONSTS = { start: 85, end: 87 };
const PERSIST = { start: 89, end: 669 };

function sliceBlock({ start, end }) {
  return lines.slice(start - 1, end).join("\n");
}

const undoConsts = sliceBlock(UNDO_CONSTS);
const persistBody = sliceBlock(PERSIST);

if (!lines[UNDO_CONSTS.start - 1].includes("One-step undo for row/group delete")) {
  console.error("UNDO_CONSTS start mismatch:", lines[UNDO_CONSTS.start - 1]);
  process.exit(1);
}
if (!/^const INV_UNDO_TOAST_ID = "ff-inv-undo-toast";$/.test(lines[UNDO_CONSTS.end - 1])) {
  console.error("UNDO_CONSTS end mismatch:", lines[UNDO_CONSTS.end - 1]);
  process.exit(1);
}
if (!/^function productsForInventorySub\(productCategoryId, productSubId\) \{$/.test(lines[PERSIST.start - 1])) {
  console.error("PERSIST start mismatch:", lines[PERSIST.start - 1]);
  process.exit(1);
}
if (!/^  return snap\.data\(\);$/.test(lines[PERSIST.end - 2]) || lines[PERSIST.end - 1].trim() !== "}") {
  console.error("PERSIST end mismatch:", lines[PERSIST.end - 2], lines[PERSIST.end - 1]);
  process.exit(1);
}

const persistMod = `// inventory-table-persist.js
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

import { inventoryOrderDraftToast } from "./inventory-orders.js?v=20260627_inventory_orders_split";

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

${undoConsts}

${persistBody}

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
`;

writeFileSync(OUT, persistMod);

// ── Reduce inventory-table.js: drop undo consts + persist block, add import ──
const drop = new Set();
for (let i = UNDO_CONSTS.start; i <= UNDO_CONSTS.end; i++) drop.add(i);
for (let i = PERSIST.start; i <= PERSIST.end; i++) drop.add(i);

const reducedLines = lines.filter((_, i) => !drop.has(i + 1));
let reduced = reducedLines.join("\n");

const PERSIST_IMPORT = `import {
  initInventoryTablePersist,
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
} from "./inventory-table-persist.js?v=${TOKEN}";`;

const INSIGHTS_ANCHOR =
  '} from "./inventory-insights.js?v=20260627_inventory_insights";';
if (!reduced.includes(INSIGHTS_ANCHOR)) {
  console.error("insights import anchor missing");
  process.exit(1);
}
reduced = reduced.replace(INSIGHTS_ANCHOR, INSIGHTS_ANCHOR + "\n\n" + PERSIST_IMPORT);

const OLD_INIT = `export function initInventoryTable(deps) {
  ({
    _ffInvActiveLocId,
    ffCanManageInventory,
    getInventoryLocationStateId,
    getSalonId,
    mountOrRefreshMockUi,
    sharedInvItemsRef,
    sharedInvStateDocRef,
  } = deps);
}`;
const NEW_INIT = `export function initInventoryTable(deps) {
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

// Remove spine lets now owned by persist module (keep in table only if still referenced).
reduced = reduced.replace(
  /\/\/ ── injected orchestrator spine \(set by initInventoryTable from inventory\.js\) ──\nlet _ffInvActiveLocId, ffCanManageInventory, getInventoryLocationStateId, getSalonId, mountOrRefreshMockUi, sharedInvItemsRef, sharedInvStateDocRef;\n/,
  ""
);

// Trim firestore imports only used by persist.
reduced = reduced.replace(
  `import {
  doc,
  getDoc,
  getDocs,
  updateDoc,
  setDoc,
  serverTimestamp,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";`,
  `import {
  doc,
  updateDoc,
  serverTimestamp,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";`
);

// Trim catalog imports only used by persist block.
reduced = reduced.replace(
  `import {
  sharedInvCategoriesRef,
  sharedInvSubcategoriesRef,
  getCategoryTree,
  resetCatModalTransientState,
} from "./inventory-catalog.js?v=20260627_inventory_catalog";`,
  `import { getCategoryTree } from "./inventory-catalog.js?v=20260627_inventory_catalog";`
);

// scanProductReorderAlertsOnce only in persist flush path.
reduced = reduced.replace(
  `import {
  refreshInventoryInsightsAsync,
  scanProductReorderAlertsOnce,
} from "./inventory-insights.js?v=20260627_inventory_insights";`,
  `import { refreshInventoryInsightsAsync } from "./inventory-insights.js?v=20260627_inventory_insights";`
);

writeFileSync(SRC, reduced);

console.log("inventory-table-persist.js lines:", persistMod.split("\n").length);
console.log("inventory-table.js:", lines.length, "->", reduced.split("\n").length);
console.log("sha(persist body 89-670):", sha(persistBody));
console.log("sha(undo consts):", sha(undoConsts));
