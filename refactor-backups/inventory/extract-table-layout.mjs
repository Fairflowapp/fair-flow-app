import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const SRC = "public/inventory-table.js";
const OUT = "public/inventory-table-layout.js";
const BACKUP = "refactor-backups/inventory/inventory-table.pre-layout.js";
const TOKEN = "20260701_inventory_table_layout_split";
const sha = (s) => createHash("sha1").update(s).digest("hex");

const backup = readFileSync(BACKUP, "utf8");
const lines = backup.split("\n");

const MOBILE_CONST = 84;
const LAYOUT = { start: 225, end: 697 };

function sliceBlock({ start, end }) {
  return lines.slice(start - 1, end).join("\n");
}

const mobileConstLine = lines[MOBILE_CONST - 1];
const layoutBody = sliceBlock(LAYOUT);

if (!/^const INV_MOBILE_COL_HIDE_SS_KEY = /.test(mobileConstLine)) {
  console.error("MOBILE_CONST mismatch:", mobileConstLine);
  process.exit(1);
}
if (!/^function getInvColWidths\(\) \{$/.test(lines[LAYOUT.start - 1])) {
  console.error("LAYOUT start mismatch:", lines[LAYOUT.start - 1]);
  process.exit(1);
}
if (lines[LAYOUT.end - 1].trim() !== "}") {
  console.error("LAYOUT end mismatch:", lines[LAYOUT.end - 1]);
  process.exit(1);
}

const layoutMod = `// inventory-table-layout.js
// Mobile column hide, colgroup, width sync, and column resize for the inventory grid.
// Extracted verbatim from inventory-table.js (Phase T2).

import { invState } from "./inventory-state.js?v=20260627_inventory_split";

import { persistColumnWidthsToFirestore } from "./inventory-table-persist.js?v=20260701_inventory_table_persist_split";

${mobileConstLine}

${layoutBody}

export {
  applyInvMobileColumnClasses,
  bindInvColumnResizeOnce,
  ensureInvMobileColHeaderBindOnce,
  getInvColWidths,
  invMobileAnyOptionalColumnHidden,
  isInvMobileNarrow,
  renderColgroup,
  resetInvMobileOptionalColumns,
  scheduleSyncInvColWidthsAfterLayout,
  syncInvColWidthsToDom,
};
`;

writeFileSync(OUT, layoutMod);

const drop = new Set([MOBILE_CONST]);
for (let i = LAYOUT.start; i <= LAYOUT.end; i++) drop.add(i);

const reducedLines = lines.filter((_, i) => !drop.has(i + 1));
let reduced = reducedLines.join("\n");

const LAYOUT_IMPORT = `import {
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

const PERSIST_ANCHOR =
  '} from "./inventory-table-persist.js?v=20260701_inventory_table_persist_split";';
if (!reduced.includes(PERSIST_ANCHOR)) {
  console.error("persist import anchor missing");
  process.exit(1);
}
reduced = reduced.replace(PERSIST_ANCHOR, PERSIST_ANCHOR + "\n\n" + LAYOUT_IMPORT);

// Remove orphaned constants header (mobile key moved to layout module).
reduced = reduced.replace(
  /\/\/ ── Table-only module constants \(moved verbatim from inventory\.js\) ──\n\n/,
  ""
);

writeFileSync(SRC, reduced);

console.log("inventory-table-layout.js lines:", layoutMod.split("\n").length);
console.log("inventory-table.js:", lines.length, "->", reduced.split("\n").length);
console.log("sha(layout body):", sha(layoutBody));
console.log("sha(mobile const):", sha(mobileConstLine));
