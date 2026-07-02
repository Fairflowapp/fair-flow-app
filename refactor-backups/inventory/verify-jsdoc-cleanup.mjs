import { readFileSync } from "node:fs";

const before = readFileSync("refactor-backups/inventory/inventory.pre-jsdoc-cleanup.js", "utf8").split("\n").length;
const after = readFileSync("public/inventory.js", "utf8").split("\n").length;
const src = readFileSync("public/inventory.js", "utf8");

const checks = [
  ["file header kept", src.startsWith("/**\n * Inventory —")],
  ["ensureInventoryScreenDelegates", src.includes("function ensureInventoryScreenDelegates(root)")],
  ["reorder scan hook", src.includes("window.ffScanProductReorderAlerts")],
  ["suggestion window binding", src.includes("window.ffAddInventorySuggestionToOrder")],
  ["devtools side import", src.includes('import "./inventory-devtools.js')],
  ["nav re-export", src.includes("export { goToInventory }")],
  ["no orphan /** @type stubs", !src.includes("/** @type {Set<string>} */")],
  ["removed >= 400 lines", before - after >= 400],
];

let ok = true;
for (const [label, pass] of checks) {
  console.log(`[cleanup] ${label}:`, pass);
  if (!pass) ok = false;
}
console.log(`[cleanup] lines: ${before} -> ${after} (removed ${before - after})`);
if (!ok) process.exitCode = 1;
