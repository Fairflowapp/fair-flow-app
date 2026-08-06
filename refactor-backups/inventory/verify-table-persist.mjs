import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const sha = (s) => createHash("sha1").update(s).digest("hex");

const backup = readFileSync("refactor-backups/inventory/inventory-table.pre-persist.js", "utf8");
const backupLines = backup.split("\n");
const main = readFileSync("public/inventory-table.js", "utf8");
const persist = readFileSync("public/inventory-table-persist.js", "utf8");
const TOKEN = "20260701_inventory_table_persist_split";

const UNDO_CONSTS = { start: 85, end: 87 };
const PERSIST = { start: 89, end: 669 };

function backupSlice(start, end) {
  return backupLines.slice(start - 1, end).join("\n");
}

// ── 1) Byte-identity: persist body vs backup lines 89–670 ──
const persistLines = persist.split("\n");
const bodyStart = persistLines.findIndex((l) =>
  /^function productsForInventorySub\(productCategoryId, productSubId\) \{$/.test(l)
);
const exportStart = persistLines.findIndex((l) => l.startsWith("export {"));
const persistBody = persistLines.slice(bodyStart, exportStart).join("\n").replace(/\n$/, "");
const expectedBody = backupSlice(PERSIST.start, PERSIST.end);

console.log("[byte-identity] persist body (89-669) == backup:", sha(persistBody) === sha(expectedBody));
console.log("  sha persist body:", sha(persistBody));
console.log("  sha expected    :", sha(expectedBody));

const undoLine = persistLines.findIndex((l) => /^\/\*\* One-step undo for row\/group delete/.test(l));
console.log(
  "[byte-identity] undo consts (85-87) == backup:",
  persistLines[undoLine] === backupLines[UNDO_CONSTS.start - 1] &&
    persistLines[undoLine + 1] === backupLines[UNDO_CONSTS.start] &&
    persistLines[undoLine + 2] === backupLines[UNDO_CONSTS.end - 1]
);

// ── 2) Semantic-identity: reverse import + reinsert blocks into main ──
const IMP = `import {
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

let text = main;
if (!text.includes(IMP)) {
  console.log("[!] persist import block not found in main");
} else {
  text = text.replace("\n\n" + IMP, "");
}

const NEW_INIT = `export function initInventoryTable(deps) {
  initInventoryTablePersist({
    ...deps,
    getInvColWidths,
    ensureGroupCellsForRows,
    findSubMeta,
  });
}`;
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
if (text.includes(NEW_INIT)) {
  text = text.replace(NEW_INIT, OLD_INIT);
}

text = text.replace(
  /\/\/ ── Table-only module constants \(moved verbatim from inventory\.js\) ──\nconst INV_MOBILE_COL_HIDE_SS_KEY/,
  `// ── injected orchestrator spine (set by initInventoryTable from inventory.js) ──
let _ffInvActiveLocId, ffCanManageInventory, getInventoryLocationStateId, getSalonId, mountOrRefreshMockUi, sharedInvItemsRef, sharedInvStateDocRef;

export function initInventoryTable(deps) {
  ({
    _ffInvActiveLocId,
    ffCanManageInventory,
    getInventoryLocationStateId,
    getSalonId,
    mountOrRefreshMockUi,
    sharedInvItemsRef,
    sharedInvStateDocRef,
  } = deps);
}

// ── Table-only module constants (moved verbatim from inventory.js) ──
const INV_MOBILE_COL_HIDE_SS_KEY`
);

const drop = new Set();
for (let i = UNDO_CONSTS.start; i <= UNDO_CONSTS.end; i++) drop.add(i);
for (let i = PERSIST.start; i <= PERSIST.end; i++) drop.add(i);

const reducedLines = text.split("\n");
const recon = [];
let ri = 0;
for (let i = 1; i <= backupLines.length; i++) {
  if (drop.has(i)) {
    recon.push(backupLines[i - 1]);
  } else {
    recon.push(reducedLines[ri]);
    ri++;
  }
}
const reconStr = recon.join("\n");
console.log("[semantic-identity] reverse-transform == backup:", sha(reconStr) === sha(backup));
console.log("  sha recon :", sha(reconStr));
console.log("  sha backup:", sha(backup));
if (ri !== reducedLines.length) {
  console.log("  WARN leftover reduced lines:", reducedLines.length - ri);
}
