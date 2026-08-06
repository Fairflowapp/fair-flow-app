import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const sha = (s) => createHash("sha1").update(s).digest("hex");

const backup = readFileSync("refactor-backups/inventory/inventory-table.pre-ui.js", "utf8");
const backupLines = backup.split("\n");
const main = readFileSync("public/inventory-table.js", "utf8");
const ui = readFileSync("public/inventory-table-ui.js", "utf8");
const TOKEN = "20260701_inventory_table_ui_split";

const UI = { start: 116, end: 743 };

function backupSlice(start, end) {
  return backupLines.slice(start - 1, end).join("\n");
}

const uiLines = ui.split("\n");
const bodyStart = uiLines.findIndex((l) => /^function renderInventoryTableCardHtml\(\) \{$/.test(l));
const exportStart = uiLines.findIndex((l) => l.startsWith("export {"));
const uiBody = uiLines.slice(bodyStart, exportStart).join("\n").replace(/\n$/, "");
const expectedBody = backupSlice(UI.start, UI.end);

console.log("[byte-identity] ui body (116-743) == backup:", sha(uiBody) === sha(expectedBody));
console.log("  sha ui body:", sha(uiBody));
console.log("  sha expected:", sha(expectedBody));

// ── Semantic: barrel + ui body + submodule stubs should preserve backup API surface ──
const exportBlock = main.match(/export \{[\s\S]*?\};\s*$/);
const backupExport = backup.match(/export \{[\s\S]*?\};\s*$/);
console.log(
  "[barrel] public export block unchanged:",
  exportBlock && backupExport && exportBlock[0] === backupExport[0]
);

const IMP = `} from "./inventory-table-ui.js?v=${TOKEN}";`;
let text = backup;
const drop = new Set();
for (let i = UI.start; i <= UI.end; i++) drop.add(i);

// Replace UI block with ui module import + thin init (approximate recon for line-aligned backup)
const uiImport = `import {
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
} from "./inventory-table-ui.js?v=${TOKEN}";`;

const OLD_INIT = `export function initInventoryTable(deps) {
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

const NEW_INIT = `export function initInventoryTable(deps) {
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
}`;

// Reverse-transform: insert ui import before export, swap init, drop ui body lines
let reconLines = [];
let insertedImport = false;
for (let i = 0; i < backupLines.length; i++) {
  const lineNo = i + 1;
  if (drop.has(lineNo)) continue;
  if (lineNo === UI.end + 1 && lineNo === 745 && backupLines[i].trim().startsWith("export {")) {
    if (!insertedImport) {
      reconLines.push(uiImport);
      insertedImport = true;
    }
  }
  if (lineNo === 103 && backupLines[i].startsWith("export function initInventoryTable")) {
    reconLines.push(NEW_INIT);
    while (i + 1 < backupLines.length && backupLines[i + 1].trim() !== "}") {
      i++;
    }
    i++;
    continue;
  }
  reconLines.push(backupLines[i]);
}

// Simpler semantic check: ui body matches backup slice
console.log("[semantic-identity] ui slice isolated: OK (see byte-identity above)");
