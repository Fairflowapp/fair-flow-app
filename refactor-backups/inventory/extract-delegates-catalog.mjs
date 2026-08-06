import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const SRC = "public/inventory.js";
const OUT = "public/inventory-delegates-catalog.js";
const BACKUP = "refactor-backups/inventory/inventory.pre-delegates-catalog.js";
const TOKEN = "20260701_inventory_delegates_catalog_split";
const sha = (s) => createHash("sha1").update(s).digest("hex");

const backup = readFileSync(BACKUP, "utf8");
const lines = backup.split("\n");

const CLICK_BLOCK = { start: 1632, end: 1883 };
const KD_ACTIVATE = { start: 965, end: 970 };
const KD_ESC_DELETE = { start: 979, end: 984 };
const KD_ESC_MENU = { start: 985, end: 990 };
const KD_ESC_MANAGE = { start: 1003, end: 1010 };

function sliceBlock({ start, end }) {
  return lines.slice(start - 1, end).join("\n");
}

function toHandlerBody(block, indent = "  ") {
  return block
    .split("\n")
    .map((l) => l.replace(/^(\s+)return;$/, "$1return true;"))
    .join("\n");
}

const clickBody = sliceBlock(CLICK_BLOCK);
const kdActivate = sliceBlock(KD_ACTIVATE);
const kdEscDelete = sliceBlock(KD_ESC_DELETE);
const kdEscMenu = sliceBlock(KD_ESC_MENU);
const kdEscManage = sliceBlock(KD_ESC_MANAGE);

if (!lines[CLICK_BLOCK.start - 1].includes("data-inv-import-shared-catalog")) {
  console.error("click block start mismatch");
  process.exit(1);
}
if (!lines[CLICK_BLOCK.end - 1].trim().endsWith("}")) {
  console.error("click block end mismatch", lines[CLICK_BLOCK.end - 1]);
  process.exit(1);
}
if (lines[835].trim() !== "bindCatManageDnDOnce(root);") {
  console.error("setup line mismatch", lines[835]);
  process.exit(1);
}

const mod = `// inventory-delegates-catalog.js
// Catalog / Manage Categories click + keydown delegates extracted verbatim from
// ensureInventoryScreenDelegates in inventory.js (Phase 12).

import { invState } from "./inventory-state.js?v=20260627_inventory_split";
import {
  cloneCategoryTree,
  newCategoryId,
  newSubcategoryId,
} from "./inventory-helpers.js?v=20260627_inventory_split";
import {
  importSharedCatalogIntoCurrentBranch,
  loadInventoryCategoriesFromFirestore,
  persistInventoryCategoryTree,
  getLegacyCategoryTreeForManage,
  getManageCategoryTree,
  ensureCatManageDraft,
  ensureValidSubcategorySelection,
  resetCatModalTransientState,
  bindCatManageDnDOnce,
} from "./inventory-catalog.js?v=20260627_inventory_catalog";

let mountOrRefreshMockUi;

export function initInventoryDelegatesCatalog(deps) {
  ({ mountOrRefreshMockUi } = deps);
}

export function bindInventoryDelegatesCatalogOnce(root) {
  bindCatManageDnDOnce(root);
}

/** @returns {boolean} true when the event was handled */
export function handleInventoryCatalogDelegateClick(ev, root, t) {
${toHandlerBody(clickBody, "  ")}
  return false;
}

/** Enter/Space on category menu trigger (inside shared Enter/Space handler). */
export function handleInventoryCatalogDelegateKeydownActivate(ev, t) {
${toHandlerBody(kdActivate, "  ")}
  return false;
}

/** Escape key: catalog modals/menus (call after ev.key === "Escape" guard). */
export function handleInventoryCatalogDelegateKeydownEscape(ev) {
${toHandlerBody(kdEscDelete, "  ")}
${toHandlerBody(kdEscMenu, "  ")}
${toHandlerBody(kdEscManage, "  ")}
  return false;
}
`;

writeFileSync(OUT, mod);

function inRange(n, { start, end }) {
  return n >= start && n <= end;
}

const reducedLines = [];
for (let i = 0; i < lines.length; i++) {
  const n = i + 1;
  if (n === CLICK_BLOCK.start) {
    reducedLines.push("    if (handleInventoryCatalogDelegateClick(ev, root, t)) return;");
    continue;
  }
  if (inRange(n, CLICK_BLOCK)) continue;
  if (inRange(n, KD_ACTIVATE)) {
    if (n === KD_ACTIVATE.start) {
      reducedLines.push("        if (handleInventoryCatalogDelegateKeydownActivate(ev, t)) return;");
    }
    continue;
  }
  if (inRange(n, KD_ESC_DELETE)) {
    if (n === KD_ESC_DELETE.start) {
      reducedLines.push("    if (handleInventoryCatalogDelegateKeydownEscape(ev)) return;");
    }
    continue;
  }
  if (inRange(n, KD_ESC_MENU) || inRange(n, KD_ESC_MANAGE)) continue;
  if (n === 836) {
    reducedLines.push("  bindInventoryDelegatesCatalogOnce(root);");
    continue;
  }
  reducedLines.push(lines[i]);
}

let reduced = reducedLines.join("\n");

const DELEG_IMPORT = `import {
  initInventoryDelegatesCatalog,
  bindInventoryDelegatesCatalogOnce,
  handleInventoryCatalogDelegateClick,
  handleInventoryCatalogDelegateKeydownActivate,
  handleInventoryCatalogDelegateKeydownEscape,
} from "./inventory-delegates-catalog.js?v=${TOKEN}";`;

const SHELL_ANCHOR = 'import { initInventoryShell, mountOrRefreshMockUi } from "./inventory-shell.js?v=20260701_inventory_shell_split";';
if (!reduced.includes(SHELL_ANCHOR)) {
  console.error("shell anchor missing");
  process.exit(1);
}
reduced = reduced.replace(SHELL_ANCHOR, SHELL_ANCHOR + "\n" + DELEG_IMPORT);

const INIT_BLOCK = `initInventoryDelegatesCatalog({ mountOrRefreshMockUi });

`;
const TABLE_INIT = "initInventoryTable({";
const idx = reduced.indexOf(TABLE_INIT);
const closeIdx = reduced.indexOf("});", idx);
if (idx < 0 || closeIdx < 0) {
  console.error("initInventoryTable block missing");
  process.exit(1);
}
reduced = reduced.slice(0, closeIdx + 4) + "\n\n" + INIT_BLOCK + reduced.slice(closeIdx + 4);

writeFileSync(SRC, reduced);

console.log("inventory-delegates-catalog.js lines:", mod.split("\n").length);
console.log("main:", lines.length, "->", reduced.split("\n").length);
console.log("sha(click body):", sha(clickBody));
