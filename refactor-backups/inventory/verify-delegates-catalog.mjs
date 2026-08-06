import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const sha = (s) => createHash("sha1").update(s).digest("hex");

const backup = readFileSync("refactor-backups/inventory/inventory.pre-delegates-catalog.js", "utf8");
const backupLines = backup.split("\n");
const main = readFileSync("public/inventory.js", "utf8");
const mod = readFileSync("public/inventory-delegates-catalog.js", "utf8");
const TOKEN = "20260701_inventory_delegates_catalog_split";

const CLICK_BLOCK = { start: 1632, end: 1883 };
const KD_ACTIVATE = { start: 965, end: 970 };
const KD_ESC_DELETE = { start: 979, end: 984 };
const KD_ESC_MENU = { start: 985, end: 990 };
const KD_ESC_MANAGE = { start: 1003, end: 1010 };

function backupSlice(start, end) {
  return backupLines.slice(start - 1, end).join("\n");
}

function normalizeHandlerReturns(body) {
  return body.replace(/^(\s+)return true;$/gm, "$1return;");
}

const modLines = mod.split("\n");
const clickStart = modLines.findIndex((l) => l.startsWith("export function handleInventoryCatalogDelegateClick"));
const clickEnd = modLines.findIndex((l, i) => i > clickStart && l === "  return false;");
const clickFnBody = modLines.slice(clickStart + 1, clickEnd).join("\n");
const clickBody = normalizeHandlerReturns(clickFnBody.trimEnd());

const actStart = modLines.findIndex((l) => l.startsWith("export function handleInventoryCatalogDelegateKeydownActivate"));
const actEnd = modLines.findIndex((l, i) => i > actStart && l === "  return false;");
const actBody = normalizeHandlerReturns(modLines.slice(actStart + 1, actEnd).join("\n").trimEnd());

const escStart = modLines.findIndex((l) => l.startsWith("export function handleInventoryCatalogDelegateKeydownEscape"));
const escEnd = modLines.findIndex((l, i) => i > escStart && l === "  return false;");
const escBody = normalizeHandlerReturns(modLines.slice(escStart + 1, escEnd).join("\n").trimEnd());

console.log("[byte-identity] click block:", sha(clickBody) === sha(backupSlice(CLICK_BLOCK.start, CLICK_BLOCK.end)));
console.log("[byte-identity] keydown activate:", sha(actBody) === sha(backupSlice(KD_ACTIVATE.start, KD_ACTIVATE.end)));
console.log(
  "[byte-identity] keydown escape:",
  sha(escBody) === sha([KD_ESC_DELETE, KD_ESC_MENU, KD_ESC_MANAGE].map((b) => backupSlice(b.start, b.end)).join("\n"))
);

const drop = new Set();
for (let i = CLICK_BLOCK.start; i <= CLICK_BLOCK.end; i++) drop.add(i);
for (const b of [KD_ACTIVATE, KD_ESC_DELETE, KD_ESC_MENU, KD_ESC_MANAGE]) {
  for (let i = b.start; i <= b.end; i++) drop.add(i);
}

const DELEG_IMPORT = `import {
  initInventoryDelegatesCatalog,
  bindInventoryDelegatesCatalogOnce,
  handleInventoryCatalogDelegateClick,
  handleInventoryCatalogDelegateKeydownActivate,
  handleInventoryCatalogDelegateKeydownEscape,
} from "./inventory-delegates-catalog.js?v=${TOKEN}";`;

const INIT_DELEG = "initInventoryDelegatesCatalog({ mountOrRefreshMockUi });\n";

let text = main;
text = text.replace("\n" + DELEG_IMPORT, "");
text = text.replace("\n\n" + INIT_DELEG, "\n");
text = text.replace("  bindInventoryDelegatesCatalogOnce(root);", "  bindCatManageDnDOnce(root);");
text = text.replace(
  "    if (handleInventoryCatalogDelegateClick(ev, root, t)) return;",
  backupLines[CLICK_BLOCK.start - 1]
);
text = text.replace(
  "        if (handleInventoryCatalogDelegateKeydownActivate(ev, t)) return;",
  backupSlice(KD_ACTIVATE.start, KD_ACTIVATE.end)
);
text = text.replace(
  "    if (handleInventoryCatalogDelegateKeydownEscape(ev)) return;",
  [KD_ESC_DELETE, KD_ESC_MENU, KD_ESC_MANAGE].map((b) => backupSlice(b.start, b.end)).join("\n")
);

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
console.log("[wiring-identity] reverse-transform == backup:", sha(reconStr) === sha(backup));
if (ri !== reducedLines.length) {
  console.log("  WARN leftover reduced lines:", reducedLines.length - ri);
}
