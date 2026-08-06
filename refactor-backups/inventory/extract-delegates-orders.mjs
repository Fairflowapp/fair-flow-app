import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const SRC = "public/inventory.js";
const OUT = "public/inventory-delegates-orders.js";
const BACKUP = "refactor-backups/inventory/inventory.pre-delegates-orders.js";
const TOKEN = "20260701_inventory_delegates_orders_split";
const sha = (s) => createHash("sha1").update(s).digest("hex");

const backup = readFileSync(BACKUP, "utf8");
const lines = backup.split("\n");

const CLICK_BLOCK = { start: 1138, end: 1486 };
const SHOPPING_LISTENER = { start: 848, end: 867 };
const ORDER_ROW_KD = { start: 870, end: 886 };
const FOCUSOUT_PRICE = { start: 916, end: 923 };
const KD_RENAME = { start: 942, end: 951 };
const KD_ESC_BLOCKS = [
  { start: 1001, end: 1005 },
  { start: 1007, end: 1011 },
  { start: 1019, end: 1023 },
  { start: 1025, end: 1029 },
  { start: 1031, end: 1037 },
];
const SETUP_LINES = [846, 847];

function sliceBlock({ start, end }) {
  return lines.slice(start - 1, end).join("\n");
}

function toHandlerBody(block) {
  return block
    .split("\n")
    .map((l) => l.replace(/^(\s+)return;$/, "$1return true;"))
    .join("\n");
}

const clickBody = sliceBlock(CLICK_BLOCK);
const shoppingBody = sliceBlock(SHOPPING_LISTENER);
const orderRowKdBody = sliceBlock(ORDER_ROW_KD);
const focusoutBody = sliceBlock(FOCUSOUT_PRICE);
const kdRenameBody = sliceBlock(KD_RENAME);
const kdEscBody = KD_ESC_BLOCKS.map((b) => sliceBlock(b)).join("\n");

if (!lines[CLICK_BLOCK.start - 1].includes("data-inv-orders-menu-trigger")) {
  console.error("click start mismatch", lines[CLICK_BLOCK.start - 1]);
  process.exit(1);
}
if (!lines[CLICK_BLOCK.end - 1].trim().endsWith("}")) {
  console.error("click end mismatch", lines[CLICK_BLOCK.end - 1]);
  process.exit(1);
}

const mod = `// inventory-delegates-orders.js
// Orders tab + Order Detail click/keydown/focusout delegates extracted verbatim from
// ensureInventoryScreenDelegates in inventory.js (Phase 13).

import { invState } from "./inventory-state.js?v=20260627_inventory_split";
import { removeApprovedContributionForCell, bindInventoryOrderCellLongPressOnce } from "./inventory-table.js?v=20260627_inventory_table3";
import {
  bindOrderDetailRowLongPressOnce,
  toggleShoppingRowQty,
  duplicateInventoryOrderDraft,
  deleteInventoryOrderDraftConfirmed,
  markInventoryOrderOrderedConfirmed,
  renameInventoryOrderConfirmed,
  isInvOrderDetailCommitBusy,
  triggerOrderDetailPrint,
  triggerOrderDetailExportCsv,
  confirmInventoryOrderPurchase,
  confirmInventoryOrderReceived,
  deleteInventoryOrderReceipt,
  inventoryOrderDraftToast,
} from "./inventory-orders.js?v=20260627_inventory_orders_split";

let mountOrRefreshMockUi;

export function initInventoryDelegatesOrders(deps) {
  ({ mountOrRefreshMockUi } = deps);
}

export function bindInventoryDelegatesOrdersOnce(root) {
  bindOrderDetailRowLongPressOnce(root);
  bindInventoryOrderCellLongPressOnce(root);
${shoppingBody}
}

export function bindInventoryOrdersDelegateOrderRowKeydown(root) {
${orderRowKdBody}
}

/** @returns {boolean} */
export function handleInventoryOrdersDelegateFocusout(ev, root, t) {
${toHandlerBody(focusoutBody)}
  return false;
}

/** @returns {boolean} */
export function handleInventoryOrdersDelegateKeydown(ev) {
${toHandlerBody(kdRenameBody)}
  return false;
}

/** @returns {boolean} */
export function handleInventoryOrdersDelegateKeydownEscape(ev) {
${toHandlerBody(kdEscBody)}
  return false;
}

/** @returns {boolean} */
export function handleInventoryOrdersDelegateClick(ev, root, t) {
${toHandlerBody(clickBody)}
  return false;
}
`;

writeFileSync(OUT, mod);

function inRange(n, { start, end }) {
  return n >= start && n <= end;
}

function inAnyRange(n, blocks) {
  return blocks.some((b) => inRange(n, b));
}

const reducedLines = [];
for (let i = 0; i < lines.length; i++) {
  const n = i + 1;
  if (SETUP_LINES.includes(n)) continue;
  if (n === SHOPPING_LISTENER.start) {
    reducedLines.push("  bindInventoryDelegatesOrdersOnce(root);");
    reducedLines.push("  bindInventoryOrdersDelegateOrderRowKeydown(root);");
    continue;
  }
  if (inRange(n, SHOPPING_LISTENER) || inRange(n, ORDER_ROW_KD)) continue;
  if (n === FOCUSOUT_PRICE.start) {
    reducedLines.push("    if (handleInventoryOrdersDelegateFocusout(ev, root, t)) return;");
    continue;
  }
  if (inRange(n, FOCUSOUT_PRICE)) continue;
  if (n === KD_RENAME.start) {
    reducedLines.push("    if (handleInventoryOrdersDelegateKeydown(ev)) return;");
    continue;
  }
  if (inRange(n, KD_RENAME)) continue;
  if (n === KD_ESC_BLOCKS[0].start) {
    reducedLines.push("    if (handleInventoryOrdersDelegateKeydownEscape(ev)) return;");
    continue;
  }
  if (inAnyRange(n, KD_ESC_BLOCKS)) continue;
  if (n === CLICK_BLOCK.start) {
    reducedLines.push("    if (handleInventoryOrdersDelegateClick(ev, root, t)) return;");
    continue;
  }
  if (inRange(n, CLICK_BLOCK)) continue;
  reducedLines.push(lines[i]);
}

let reduced = reducedLines.join("\n");

const DELEG_IMPORT = `import {
  initInventoryDelegatesOrders,
  bindInventoryDelegatesOrdersOnce,
  bindInventoryOrdersDelegateOrderRowKeydown,
  handleInventoryOrdersDelegateFocusout,
  handleInventoryOrdersDelegateKeydown,
  handleInventoryOrdersDelegateKeydownEscape,
  handleInventoryOrdersDelegateClick,
} from "./inventory-delegates-orders.js?v=${TOKEN}";`;

const CATALOG_ANCHOR = '} from "./inventory-delegates-catalog.js?v=20260701_inventory_delegates_catalog_split";';
if (!reduced.includes(CATALOG_ANCHOR)) {
  console.error("catalog import anchor missing");
  process.exit(1);
}
reduced = reduced.replace(CATALOG_ANCHOR, CATALOG_ANCHOR + "\n" + DELEG_IMPORT);

const INIT_BLOCK = `initInventoryDelegatesOrders({ mountOrRefreshMockUi });

`;
const INIT_CATALOG = "initInventoryDelegatesCatalog({ mountOrRefreshMockUi });";
if (!reduced.includes(INIT_CATALOG)) {
  console.error("initInventoryDelegatesCatalog missing");
  process.exit(1);
}
reduced = reduced.replace(INIT_CATALOG, INIT_CATALOG + "\n" + INIT_BLOCK);

writeFileSync(SRC, reduced);

console.log("inventory-delegates-orders.js lines:", mod.split("\n").length);
console.log("main:", lines.length, "->", reduced.split("\n").length);
console.log("sha(click body):", sha(clickBody));
