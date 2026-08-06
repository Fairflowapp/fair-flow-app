import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const sha = (s) => createHash("sha1").update(s).digest("hex");

const backup = readFileSync("refactor-backups/inventory/inventory.pre-spine.js", "utf8");
const backupLines = backup.split("\n");
const main = readFileSync("public/inventory.js", "utf8");
const spine = readFileSync("public/inventory-spine.js", "utf8");
const TOKEN = "20260701_inventory_spine_split";

const BLOCK_A = { start: 261, end: 344 };
const BLOCK_STYLE = 391;
const BLOCK_LEGACY = 442;
const BLOCK_D = { start: 476, end: 523 };

function backupSlice(start, end) {
  return backupLines.slice(start - 1, end).join("\n");
}

// ── 1) Byte-identity: each spine block vs backup ──
const spineLines = spine.split("\n");
const importEnd = spineLines.findIndex((l) => l.startsWith("const SALON_ID_CACHE_KEY"));
const exportStart = spineLines.findIndex((l) => l.startsWith("export {"));
const spineBody = spineLines.slice(importEnd, exportStart).join("\n").replace(/\n$/, "");

const expectedBody = [
  backupSlice(BLOCK_A.start, BLOCK_A.end),
  "",
  backupLines[BLOCK_STYLE - 1],
  "",
  backupLines[BLOCK_LEGACY - 1],
  "",
  backupSlice(BLOCK_D.start, BLOCK_D.end),
].join("\n");

console.log("[byte-identity] spine body == backup blocks:", sha(spineBody) === sha(expectedBody));
console.log("  sha spine body:", sha(spineBody));
console.log("  sha expected  :", sha(expectedBody));

console.log("[byte-identity] BLOCK_A:", sha(backupSlice(BLOCK_A.start, BLOCK_A.end)) === sha(
  spineBody.split("\n\n")[0]
));
console.log("[byte-identity] STYLE_ID line:", backupLines[BLOCK_STYLE - 1] === spineBody.split("\n\n")[1]);
console.log("[byte-identity] LEGACY line:", backupLines[BLOCK_LEGACY - 1] === spineBody.split("\n\n")[2]);
console.log("[byte-identity] BLOCK_D:", sha(backupSlice(BLOCK_D.start, BLOCK_D.end)) === sha(
  spineBody.split("\n\n")[3]
));

// ── 2) Semantic-identity: reverse import + reinsert blocks ──
const IMP = `import {
  STYLE_ID,
  ffCanManageInventory,
  _ffInvActiveLocId,
  _ffInvUserHasMultipleLocations,
  _ffInvDocInActiveLoc,
  getSalonId,
  getInventoryLocationStateId,
  sharedInvItemsRef,
  sharedInvStateDocRef,
} from "./inventory-spine.js?v=${TOKEN}";`;

let text = main;
if (!text.includes(IMP)) {
  console.log("[!] spine import block not found in main");
} else {
  text = text.replace("\n\n" + IMP, "");
}

const drop = new Set();
for (let i = BLOCK_A.start; i <= BLOCK_A.end; i++) drop.add(i);
drop.add(BLOCK_STYLE);
drop.add(BLOCK_LEGACY);
for (let i = BLOCK_D.start; i <= BLOCK_D.end; i++) drop.add(i);

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
console.log("  sha recon:", sha(reconStr));
console.log("  sha backup:", sha(backup));
if (ri !== reducedLines.length) {
  console.log("  WARN leftover reduced lines:", reducedLines.length - ri);
}
