import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const sha = (s) => createHash("sha1").update(s).digest("hex");

const backup = readFileSync("refactor-backups/inventory/inventory.pre-shell.js", "utf8");
const backupLines = backup.split("\n");
const main = readFileSync("public/inventory.js", "utf8");
const shell = readFileSync("public/inventory-shell.js", "utf8");
const TOKEN = "20260701_inventory_shell_split";

const BLOCKS = [
  { start: 587, end: 607 },
  { start: 725, end: 738 },
  { start: 792, end: 799 },
  { start: 2267, end: 2496 },
  { start: 2502, end: 2532 },
];

function backupSlice(start, end) {
  return backupLines.slice(start - 1, end).join("\n");
}

const spineLines = shell.split("\n");
const bodyStart = spineLines.findIndex((l) => l.startsWith("function renderInvMainTabsHtml"));
const exportLine = spineLines.findIndex((l) => l.startsWith("export { mountOrRefreshMockUi"));
const shellBody = spineLines.slice(bodyStart, exportLine).join("\n").replace(/\n$/, "");

const expectedBody = BLOCKS.map((b, i) => backupSlice(b.start, b.end) + (i < BLOCKS.length - 1 ? "\n" : "")).join("\n");

console.log("[byte-identity] shell body == backup blocks:", sha(shellBody) === sha(expectedBody));
console.log("  sha shell body:", sha(shellBody));
console.log("  sha expected  :", sha(expectedBody));

for (const b of BLOCKS) {
  const slice = backupSlice(b.start, b.end);
  const fn = slice.match(/^function (\w+)/)?.[1] || slice.match(/^async function (\w+)/)?.[1];
  console.log(`[byte-identity] ${fn}:`, shellBody.includes(slice));
}

// ── wiring-identity: reverse shell import + initInventoryShell, restore early inits ──
const SHELL_IMPORT = `import { initInventoryShell, mountOrRefreshMockUi } from "./inventory-shell.js?v=${TOKEN}";`;
let text = main.replace("\n" + SHELL_IMPORT, "");

const initShellRe = /initInventoryShell\(\{[\s\S]*?\}\);\n\n/;
text = text.replace(initShellRe, "");

// Restore original init block positions from backup (lines 127-271 area).
const earlyInitBlock = backupLines.slice(126, 271).join("\n");
const catalogAnchor = '} from "./inventory-catalog.js?v=20260627_inventory_catalog";';
if (!text.includes(catalogAnchor)) {
  console.log("[!] catalog anchor missing for wiring reverse");
} else {
  text = text.replace(catalogAnchor, catalogAnchor + "\n\n" + earlyInitBlock);
}

// Remove the consolidated init block now duplicated at end of imports.
const lateInitRe = /\n\/\/ Wire inventory\.js internals into the Catalog sub-app[\s\S]*?initInventoryTable\(\{[\s\S]*?\}\);\n/;
text = text.replace(lateInitRe, "\n");

const drop = new Set();
for (const b of BLOCKS) {
  for (let i = b.start; i <= b.end; i++) drop.add(i);
}

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
console.log("  sha recon:", sha(reconStr));
console.log("  sha backup:", sha(backup));
if (ri !== reducedLines.length) {
  console.log("  WARN leftover reduced lines:", reducedLines.length - ri);
}
