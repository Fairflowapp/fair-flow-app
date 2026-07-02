import { readFileSync, writeFileSync } from "node:fs";

const SRC = "public/inventory.js";
const BACKUP = "refactor-backups/inventory/inventory.pre-jsdoc-cleanup.js";

const lines = readFileSync(BACKUP, "utf8").split("\n");

const tableInitStart = lines.findIndex((l) => l.startsWith("initInventoryTable({"));
let tableInitClose = -1;
for (let i = tableInitStart; i < lines.length; i++) {
  if (lines[i] === "});") {
    tableInitClose = i;
    break;
  }
}

const delegatesStart = lines.findIndex((l) => l.startsWith("function ensureInventoryScreenDelegates("));
let delegatesEnd = -1;
for (let i = delegatesStart; i < lines.length; i++) {
  if (lines[i] === "}") {
    delegatesEnd = i;
    break;
  }
}

const windowBlockStart = lines.findIndex(
  (l, i) => i > delegatesEnd && l === 'if (typeof window !== "undefined") {' && lines[i + 1]?.includes("ffAddInventorySuggestionToOrder")
);

const reorderScanIdx = lines.findIndex((l) => l.includes("window.ffScanProductReorderAlerts"));
let reorderScanBlock = [];
if (reorderScanIdx >= 0) {
  let start = reorderScanIdx;
  while (start > 0 && lines[start] !== "try {") start--;
  let end = reorderScanIdx;
  while (end < lines.length && lines[end] !== "} catch (_) {}") end++;
  reorderScanBlock = lines.slice(start, end + 1);
}

if (tableInitClose < 0 || delegatesStart < 0 || delegatesEnd < 0 || windowBlockStart < 0) {
  console.error("anchors missing", { tableInitClose, delegatesStart, delegatesEnd, windowBlockStart });
  process.exit(1);
}

const head = lines.slice(0, tableInitClose + 1);
const delegates = lines.slice(delegatesStart, delegatesEnd + 1);
const tail = lines.slice(windowBlockStart);

const cleaned = [...head, "", ...reorderScanBlock, "", ...delegates, "", ...tail].join("\n");

writeFileSync(SRC, cleaned);

const before = lines.length;
const after = cleaned.split("\n").length;
console.log("inventory.js:", before, "->", after, "(removed", before - after, "lines)");
console.log("kept reorder scan block:", reorderScanBlock.length, "lines");
