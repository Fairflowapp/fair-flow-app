#!/usr/bin/env node
import fs from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = path.resolve(import.meta.dirname, "../..");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const slice = (lines, start, end) => lines.slice(start - 1, end).join("\n");

const backupPath = path.join(ROOT, "refactor-backups/tickets/tickets-catalog-data.pre-split.js");
const backup = fs.readFileSync(backupPath, "utf8");
const backupLines = backup.split("\n");

const shared = fs.readFileSync(path.join(ROOT, "public/tickets-catalog-data-shared.js"), "utf8");
const local = fs.readFileSync(path.join(ROOT, "public/tickets-catalog-data-local.js"), "utf8");
const entry = fs.readFileSync(path.join(ROOT, "public/tickets-catalog-data.js"), "utf8");

let pass = true;
const fail = (msg) => {
  console.error("FAIL:", msg);
  pass = false;
};
const ok = (msg) => console.log("PASS:", msg);

const checkContains = (label, haystack, needle) => {
  if (haystack.includes(needle)) ok(`byte-identity ${label} (${needle.split("\n").length} lines)`);
  else fail(`byte-identity ${label} (${needle.split("\n").length} lines)`);
};

console.log("=== BYTE-IDENTITY (blocks verbatim in modules) ===");

const sharedBlocks = [
  ["shared L23-116", 23, 116],
  ["shared L650-655", 650, 655],
  ["shared L118-348", 118, 348],
  ["shared L362-502", 362, 502],
  ["shared L586-611", 586, 611],
];
for (const [label, start, end] of sharedBlocks) {
  checkContains(label, shared, slice(backupLines, start, end));
}

const localBlocks = [
  ["local L17-21 (init)", 17, 21],
  ["local L349-360", 349, 360],
  ["local L504-584", 504, 584],
  ["local L613-649", 613, 649],
  ["local L656-887", 656, 887],
];
for (const [label, start, end] of localBlocks) {
  checkContains(label, local, slice(backupLines, start, end));
}

console.log("\n=== RECONSTRUCTION ===");
const header = backupLines.slice(0, 16).join("\n");
const bodyRanges = [
  [17, 21],
  [23, 116],
  [118, 348],
  [349, 360],
  [362, 502],
  [504, 584],
  [586, 611],
  [613, 649],
  [650, 655],
  [656, 887],
];
const bodyLines = [];
let prevEnd = 16;
for (const [start, end] of bodyRanges) {
  for (let ln = prevEnd + 1; ln < start; ln++) bodyLines.push(backupLines[ln - 1]);
  for (let ln = start; ln <= end; ln++) bodyLines.push(backupLines[ln - 1]);
  prevEnd = end;
}
const body = bodyLines.join("\n");
const exportBlock = backupLines.slice(888).join("\n");
const reconstructed = `${header}\n${body}\n\n${exportBlock}`;
const backupNorm = backup.replace(/\n?$/, "\n");

if (sha(reconstructed) === sha(backupNorm)) ok("reconstruction matches backup (sha256)");
else {
  fail("reconstruction matches backup (sha256)");
  const a = backupNorm.split("\n");
  const b = reconstructed.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      console.error(`  first diff at line ${i + 1}:`);
      console.error(`    backup: ${JSON.stringify(a[i])}`);
      console.error(`    recon:  ${JSON.stringify(b[i])}`);
      break;
    }
  }
}

const parseExportNames = (src) => {
  const block = src.slice(src.lastIndexOf("export {"));
  return [...block.matchAll(/^\s{2}([A-Za-z_$][\w$]*),?\s*$/gm)].map((m) => m[1]);
};

console.log("\n=== EXPORT COUNT ===");
const blockExports = parseExportNames(backup);
const hasInlineInit = /export function initTicketsCatalogData/.test(backup);
const backupPublicApi = blockExports.length + (hasInlineInit ? 1 : 0);
const allEntryExports = [];
for (const m of entry.matchAll(/export \{([^}]+)\}/gs)) {
  for (const line of m[1].split("\n")) {
    const name = line.trim().replace(/,$/, "");
    if (/^[A-Za-z_$][\w$]*$/.test(name)) allEntryExports.push(name);
  }
}
console.log("  backup export block:", blockExports.length, hasInlineInit ? "+ inline init" : "");
console.log("  backup public API:", backupPublicApi);
console.log("  entry re-exports:", allEntryExports.length);
if (backupPublicApi === 42) ok("backup public API has 42 symbols");
else fail(`backup public API expected 42, got ${backupPublicApi}`);
if (allEntryExports.length === 42) ok("entry re-exports 42 symbols");
else fail(`entry export count expected 42, got ${allEntryExports.length}`);

const backupAllNames = [...blockExports, ...(hasInlineInit ? ["initTicketsCatalogData"] : [])];
const missing = backupAllNames.filter((n) => !allEntryExports.includes(n));
const extra = allEntryExports.filter((n) => !backupAllNames.includes(n));
if (missing.length === 0 && extra.length === 0) ok("entry export set matches backup");
else {
  fail("entry export set mismatch");
  if (missing.length) console.error("  missing:", missing);
  if (extra.length) console.error("  extra:", extra);
}

console.log("\n=== ENTRY WIRING ===");
if (entry.includes('import "./tickets-catalog-data-shared.js?v=20260704_tickets_catalog_data_local_fix";')) {
  ok("entry side-effect import shared");
} else fail("entry missing side-effect import shared");
if (entry.includes('import "./tickets-catalog-data-local.js?v=20260704_tickets_catalog_data_local_fix";')) {
  ok("entry side-effect import local");
} else fail("entry missing side-effect import local");

console.log("\nLine counts:");
console.log("  backup:", backupLines.length);
console.log("  shared:", shared.split("\n").length);
console.log("  local:", local.split("\n").length);
console.log("  entry:", entry.split("\n").length);

process.exit(pass ? 0 : 1);
