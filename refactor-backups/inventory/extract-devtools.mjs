import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const SRC = "public/inventory.js";
const OUT = "public/inventory-devtools.js";
const BACKUP = "refactor-backups/inventory/inventory.pre-devtools.js";
const TOKEN = "20260701_inventory_devtools_split";
const sha = (s) => createHash("sha1").update(s).digest("hex");

const backup = readFileSync(BACKUP, "utf8");
const lines = backup.split("\n");

const DEVTOOLS_BLOCK = { start: 889, end: 988 };

function sliceBlock({ start, end }) {
  return lines.slice(start - 1, end).join("\n");
}

const devtoolsBody = sliceBlock(DEVTOOLS_BLOCK);

if (!lines[887].includes("window.ffAddInventorySuggestionToOrder")) {
  console.error("window block anchor mismatch", lines[887]);
  process.exit(1);
}
if (!lines[899].includes("window.ffInventoryDeleteUnstampedCategories")) {
  console.error("delete fn mismatch", lines[899]);
  process.exit(1);
}
if (!lines[940].includes("window.ffInventoryDumpLocations")) {
  console.error("dump fn mismatch", lines[940]);
  process.exit(1);
}

const mod = `// inventory-devtools.js
// Browser-console diagnostic helpers for inventory multi-branch housekeeping.
// Extracted verbatim from inventory.js (Phase 16).

import { db } from "/app.js?v=20260610_force_lp_ios";
import { getDocs, collection, writeBatch } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { invState } from "./inventory-state.js?v=20260627_inventory_split";
import { getSalonId, _ffInvActiveLocId } from "./inventory-spine.js?v=20260701_inventory_spine_split";

if (typeof window !== "undefined") {
${devtoolsBody}
}
`;

writeFileSync(OUT, mod);

const drop = new Set();
for (let i = DEVTOOLS_BLOCK.start; i <= DEVTOOLS_BLOCK.end; i++) drop.add(i);

const reducedLines = [];
for (let i = 0; i < lines.length; i++) {
  const n = i + 1;
  if (drop.has(n)) continue;
  reducedLines.push(lines[i]);
}

let reduced = reducedLines.join("\n");

const DEVTOOLS_IMPORT = `import "./inventory-devtools.js?v=${TOKEN}";`;
const NAV_EXPORT = 'export { goToInventory };';
if (!reduced.includes(NAV_EXPORT)) {
  console.error("nav export anchor missing");
  process.exit(1);
}
reduced = reduced.replace(NAV_EXPORT, NAV_EXPORT + "\n" + DEVTOOLS_IMPORT);

writeFileSync(SRC, reduced);

console.log("inventory-devtools.js lines:", mod.split("\n").length);
console.log("main:", lines.length, "->", reduced.split("\n").length);
console.log("sha(devtools block):", sha(devtoolsBody));
