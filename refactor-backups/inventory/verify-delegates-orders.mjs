import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const sha = (s) => createHash("sha1").update(s).digest("hex");

const backup = readFileSync("refactor-backups/inventory/inventory.pre-delegates-orders.js", "utf8");
const backupLines = backup.split("\n");
const main = readFileSync("public/inventory.js", "utf8");
const mod = readFileSync("public/inventory-delegates-orders.js", "utf8");
const TOKEN = "20260701_inventory_delegates_orders_split";

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

function backupSlice(start, end) {
  return backupLines.slice(start - 1, end).join("\n");
}

function normalizeHandlerReturns(body) {
  return body.replace(/^(\s+)return true;$/gm, "$1return;");
}

function fnBody(modLines, exportPrefix) {
  const start = modLines.findIndex((l) => l.startsWith(exportPrefix));
  const end = modLines.findIndex((l, i) => i > start && l === "  return false;");
  return normalizeHandlerReturns(modLines.slice(start + 1, end).join("\n").trimEnd());
}

const modLines = mod.split("\n");

console.log("[byte-identity] click block:", sha(fnBody(modLines, "export function handleInventoryOrdersDelegateClick")) === sha(backupSlice(CLICK_BLOCK.start, CLICK_BLOCK.end)));

const shoppingMod = modLines.slice(
  modLines.findIndex((l) => l.startsWith("export function bindInventoryDelegatesOrdersOnce")),
  modLines.findIndex((l) => l.startsWith("export function bindInventoryOrdersDelegateOrderRowKeydown"))
);
const shoppingStart = shoppingMod.findIndex((l) => l.includes("Order Details: one reliable path"));
const shoppingEnd = shoppingMod.findIndex((l, i) => i > shoppingStart && l.trim() === ");");
const shoppingBody = shoppingMod.slice(shoppingStart, shoppingEnd + 1).join("\n");
console.log("[byte-identity] shopping listener:", sha(shoppingBody) === sha(backupSlice(SHOPPING_LISTENER.start, SHOPPING_LISTENER.end)));

const orderRowStart = modLines.findIndex((l) => l.startsWith("export function bindInventoryOrdersDelegateOrderRowKeydown"));
const orderRowClose = modLines.findIndex((l, i) => i > orderRowStart && l.trim() === "});");
const orderRowBody = modLines.slice(orderRowStart + 1, orderRowClose + 1).join("\n");
console.log("[byte-identity] order row keydown:", sha(orderRowBody) === sha(backupSlice(ORDER_ROW_KD.start, ORDER_ROW_KD.end)));

console.log("[byte-identity] focusout price:", sha(fnBody(modLines, "export function handleInventoryOrdersDelegateFocusout")) === sha(backupSlice(FOCUSOUT_PRICE.start, FOCUSOUT_PRICE.end)));
console.log("[byte-identity] keydown rename:", sha(fnBody(modLines, "export function handleInventoryOrdersDelegateKeydown")) === sha(backupSlice(KD_RENAME.start, KD_RENAME.end)));
console.log(
  "[byte-identity] keydown escape:",
  sha(fnBody(modLines, "export function handleInventoryOrdersDelegateKeydownEscape")) ===
    sha(KD_ESC_BLOCKS.map((b) => backupSlice(b.start, b.end)).join("\n"))
);
