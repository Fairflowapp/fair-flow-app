import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const sha = (s) => createHash("sha1").update(s).digest("hex");

const backup = readFileSync("refactor-backups/inventory/inventory-table.pre-layout.js", "utf8");
const backupLines = backup.split("\n");
const main = readFileSync("public/inventory-table.js", "utf8");
const layout = readFileSync("public/inventory-table-layout.js", "utf8");
const TOKEN = "20260701_inventory_table_layout_split";

const MOBILE_CONST = 84;
const LAYOUT = { start: 225, end: 697 };

function backupSlice(start, end) {
  return backupLines.slice(start - 1, end).join("\n");
}

const layoutLines = layout.split("\n");
const bodyStart = layoutLines.findIndex((l) => /^function getInvColWidths\(\) \{$/.test(l));
const exportStart = layoutLines.findIndex((l) => l.startsWith("export {"));
const layoutBody = layoutLines.slice(bodyStart, exportStart).join("\n").replace(/\n$/, "");
const expectedBody = backupSlice(LAYOUT.start, LAYOUT.end);

console.log("[byte-identity] layout body (225-697) == backup:", sha(layoutBody) === sha(expectedBody));
console.log("  sha layout body:", sha(layoutBody));
console.log("  sha expected   :", sha(expectedBody));

const mobileLine = layoutLines.findIndex((l) => /^const INV_MOBILE_COL_HIDE_SS_KEY = /.test(l));
console.log(
  "[byte-identity] mobile const (84) == backup:",
  layoutLines[mobileLine] === backupLines[MOBILE_CONST - 1]
);

const IMP = `import {
  applyInvMobileColumnClasses,
  bindInvColumnResizeOnce,
  ensureInvMobileColHeaderBindOnce,
  getInvColWidths,
  invMobileAnyOptionalColumnHidden,
  isInvMobileNarrow,
  renderColgroup,
  resetInvMobileOptionalColumns,
  scheduleSyncInvColWidthsAfterLayout,
} from "./inventory-table-layout.js?v=${TOKEN}";`;

let text = main;
if (!text.includes(IMP)) {
  console.log("[!] layout import block not found in main");
} else {
  text = text.replace("\n\n" + IMP, "");
}

const drop = new Set([MOBILE_CONST]);
for (let i = LAYOUT.start; i <= LAYOUT.end; i++) drop.add(i);

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
