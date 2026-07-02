import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const SRC = "public/inventory.js";
const OUT = "public/inventory-spine.js";
const BACKUP = "refactor-backups/inventory/inventory.pre-spine.js";
const TOKEN = "20260701_inventory_spine_split";
const sha = (s) => createHash("sha1").update(s).digest("hex");

const backup = readFileSync(BACKUP, "utf8");
const lines = backup.split("\n");

// Original line ranges (1-based, inclusive) — verbatim spine blocks.
const BLOCK_A = { start: 261, end: 344, label: "permissions + SALON_ID_CACHE_KEY" };
const BLOCK_STYLE = { start: 391, end: 391, label: "STYLE_ID" };
const BLOCK_LEGACY = { start: 442, end: 442, label: "INVENTORY_LEGACY_DRAFT_DOC_ID" };
const BLOCK_D = { start: 476, end: 523, label: "getSalonId + refs" };

function sliceBlock({ start, end }) {
  return lines.slice(start - 1, end).join("\n");
}

const blockA = sliceBlock(BLOCK_A);
const blockStyle = sliceBlock(BLOCK_STYLE);
const blockLegacy = sliceBlock(BLOCK_LEGACY);
const blockD = sliceBlock(BLOCK_D);

// Boundary sanity checks on backup.
if (!/^const SALON_ID_CACHE_KEY = "ff_salonId_v1";$/.test(lines[260])) {
  console.error("BLOCK_A start mismatch:", lines[260]);
  process.exit(1);
}
if (!/^}$/.test(lines[343])) {
  console.error("BLOCK_A end mismatch:", lines[343]);
  process.exit(1);
}
if (!/^const STYLE_ID = /.test(lines[390])) {
  console.error("STYLE_ID mismatch:", lines[390]);
  process.exit(1);
}
if (!/^const INVENTORY_LEGACY_DRAFT_DOC_ID = "active";$/.test(lines[441])) {
  console.error("LEGACY_DRAFT mismatch:", lines[441]);
  process.exit(1);
}
if (!/^async function getSalonId\(\) \{$/.test(lines[475])) {
  console.error("BLOCK_D start mismatch:", lines[475]);
  process.exit(1);
}
if (!/^function sharedInvStateDocRef\(accountId, locationId, subId\) \{$/.test(lines[520])) {
  console.error("BLOCK_D near-end mismatch:", lines[520]);
  process.exit(1);
}
if (lines[522].trim() !== "}") {
  console.error("BLOCK_D end mismatch:", lines[522]);
  process.exit(1);
}

const spineBody = [blockA, "", blockStyle, "", blockLegacy, "", blockD].join("\n");

const spineMod = `// inventory-spine.js
// Inventory spine: salon/location resolution, permission gates, shared-catalog refs.
// Extracted verbatim from inventory.js (Phase 10). Injected into Catalog/Insights/Orders/Table
// via init* in inventory.js orchestrator.

import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import {
  doc,
  getDoc,
  collection,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

${spineBody}

export {
  STYLE_ID,
  INVENTORY_LEGACY_DRAFT_DOC_ID,
  ffCanManageInventory,
  _ffInvActiveLocId,
  _ffInvUserHasMultipleLocations,
  _ffInvDocInActiveLoc,
  getSalonId,
  getInventoryLocationStateId,
  sharedInvItemsRef,
  sharedInvStateDocRef,
};
`;

writeFileSync(OUT, spineMod);

// Remove spine blocks from main and add import.
const drop = new Set();
for (let i = BLOCK_A.start; i <= BLOCK_A.end; i++) drop.add(i);
drop.add(BLOCK_STYLE.start);
drop.add(BLOCK_LEGACY.start);
for (let i = BLOCK_D.start; i <= BLOCK_D.end; i++) drop.add(i);

const reducedLines = lines.filter((_, i) => !drop.has(i + 1));
let reduced = reducedLines.join("\n");

const SPINE_IMPORT = `import {
  STYLE_ID,
  INVENTORY_LEGACY_DRAFT_DOC_ID,
  ffCanManageInventory,
  _ffInvActiveLocId,
  _ffInvUserHasMultipleLocations,
  _ffInvDocInActiveLoc,
  getSalonId,
  getInventoryLocationStateId,
  sharedInvItemsRef,
  sharedInvStateDocRef,
} from "./inventory-spine.js?v=${TOKEN}";`;

const ANCHOR = '} from "./inventory-catalog.js?v=20260627_inventory_catalog";';
if (!reduced.includes(ANCHOR)) {
  console.error("catalog import anchor missing");
  process.exit(1);
}
reduced = reduced.replace(ANCHOR, ANCHOR + "\n\n" + SPINE_IMPORT);

writeFileSync(SRC, reduced);

console.log("inventory-spine.js lines:", spineMod.split("\n").length);
console.log("main:", lines.length, "->", reduced.split("\n").length);
console.log("sha(spine body):", sha(spineBody));
console.log("sha(main reduced):", sha(reduced));
