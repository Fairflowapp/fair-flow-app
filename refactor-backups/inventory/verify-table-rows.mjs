import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const sha = (s) => createHash("sha1").update(s).digest("hex");

const backup = readFileSync("refactor-backups/inventory/inventory-table.pre-rows.js", "utf8");
const backupLines = backup.split("\n");
const main = readFileSync("public/inventory-table.js", "utf8");
const rows = readFileSync("public/inventory-table-rows.js", "utf8");
const TOKEN = "20260701_inventory_table_rows_split";

const ROWS = { start: 134, end: 495 };

function backupSlice(start, end) {
  return backupLines.slice(start - 1, end).join("\n");
}

const rowsLines = rows.split("\n");
const bodyStart = rowsLines.findIndex((l) => /^function getInvCellKeyFromEl\(el\) \{$/.test(l));
const exportStart = rowsLines.findIndex((l) => l.startsWith("export {"));
const rowsBody = rowsLines.slice(bodyStart, exportStart).join("\n").replace(/\n$/, "");
const expectedBody = backupSlice(ROWS.start, ROWS.end);

console.log("[byte-identity] rows body (134-495) == backup:", sha(rowsBody) === sha(expectedBody));
console.log("  sha rows body:", sha(rowsBody));
console.log("  sha expected  :", sha(expectedBody));

const IMP = `import {
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

let text = main;
if (!text.includes(IMP)) {
  console.log("[!] rows import block not found in main");
} else {
  text = text.replace("\n\n" + IMP, "");
}

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
const OLD_INIT = `export function initInventoryTable(deps) {
  initInventoryTablePersist({
    ...deps,
    getInvColWidths,
    ensureGroupCellsForRows,
    findSubMeta,
  });
}`;
if (text.includes(NEW_INIT)) {
  text = text.replace(NEW_INIT, OLD_INIT);
}

const drop = new Set();
for (let i = ROWS.start; i <= ROWS.end; i++) drop.add(i);

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
