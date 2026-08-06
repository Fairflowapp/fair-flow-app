#!/usr/bin/env node
import fs from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = path.resolve(import.meta.dirname, "../..");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

const backup = fs.readFileSync(
  path.join(ROOT, "refactor-backups/schedule/schedule-nav-runtime.pre-split.js"),
  "utf8",
);
const backupLines = backup.split("\n");

const preview = fs.readFileSync(
  path.join(ROOT, "public/schedule-nav-runtime-preview.js"),
  "utf8",
);
const ui = fs.readFileSync(path.join(ROOT, "public/schedule-nav-runtime-ui.js"), "utf8");
const entry = fs.readFileSync(path.join(ROOT, "public/schedule-nav-runtime.js"), "utf8");

const previewLines = preview.split("\n");
const uiLines = ui.split("\n");

let pass = true;
const fail = (msg) => {
  console.error("FAIL:", msg);
  pass = false;
};
const ok = (msg) => console.log("PASS:", msg);

// --- byte-identity: preview block (backup lines 1-580) ---
const previewExpected = backupLines.slice(0, 580).join("\n");
const previewActual = previewLines
  .slice(4)
  .join("\n")
  .replace(/\n\nexport \{ refreshSchedulePreview \};\n?$/, "");
if (sha(previewActual) === sha(previewExpected)) {
  ok("byte-identity preview body (backup L1-580)");
} else {
  fail("byte-identity preview body (backup L1-580)");
  console.error("  expected lines:", 580, "actual body lines:", previewActual.split("\n").length);
}

// --- byte-identity: UI block (backup lines 582-1050) ---
const uiExpected = backupLines.slice(581, 1050).join("\n");
const uiImportEnd = uiLines.findIndex((l, i) => i > 0 && l.startsWith("function applyScheduleWeekFilter"));
const uiBodyEnd = uiLines.findIndex((l) => l === "export {");
const uiActual = uiLines.slice(uiImportEnd, uiBodyEnd).join("\n").replace(/\n$/, "");
if (sha(uiActual) === sha(uiExpected)) {
  ok("byte-identity ui body (backup L582-1050)");
} else {
  fail("byte-identity ui body (backup L582-1050)");
  console.error("  expected lines:", uiExpected.split("\n").length, "actual:", uiActual.split("\n").length);
  for (let i = 0; i < Math.max(uiExpected.split("\n").length, uiActual.split("\n").length); i++) {
    const e = uiExpected.split("\n")[i];
    const a = uiActual.split("\n")[i];
    if (e !== a) {
      console.error(`  first diff at line ${i + 1}:`);
      console.error(`    expected: ${JSON.stringify(e)}`);
      console.error(`    actual:   ${JSON.stringify(a)}`);
      break;
    }
  }
}

// --- reconstruction: preview body + ui body + blank lines + export block ---
const reconstructed =
  previewActual + "\n\n" + uiActual + "\n\n\nexport {\n  refreshSchedulePreview,\n  hideScheduleScreen,\n};\n";
const backupWithNormalizedEnd = backup.replace(/\n?$/, "\n");
if (sha(reconstructed) === sha(backupWithNormalizedEnd)) {
  ok("reconstruction (preview + ui + original export block)");
} else {
  fail("reconstruction (preview + ui + original export block)");
}

// --- entry exports ---
const entryExports = [
  'export { refreshSchedulePreview } from "./schedule-nav-runtime-preview.js?v=20260704_schedule_helpers_split";',
  'export { goToSchedule, hideScheduleScreen } from "./schedule-nav-runtime-ui.js?v=20260704_schedule_helpers_split";',
];
entryExports.forEach((line) => {
  if (entry.includes(line)) ok(`entry contains: ${line.slice(0, 50)}...`);
  else fail(`entry missing export line`);
});

// --- public API from backup ---
const publicFns = ["refreshSchedulePreview", "hideScheduleScreen", "goToSchedule"];
publicFns.forEach((fn) => {
  if (backup.includes(`function ${fn}`) || backup.includes(`function ${fn}(`) || backup.includes(`async function ${fn}`)) {
    // ok in backup
  }
  if (preview.includes(`function ${fn}`) || preview.includes(`async function ${fn}`)) ok(`preview defines ${fn}`);
  else if (ui.includes(`function ${fn}`) || ui.includes(`async function ${fn}`) || ui.includes(`export async function ${fn}`)) ok(`ui defines ${fn}`);
  else fail(`missing function ${fn} in split modules`);
});

// --- line counts ---
console.log("\nLine counts:");
console.log("  backup:", backupLines.length);
console.log("  preview:", previewLines.length);
console.log("  ui:", uiLines.length);
console.log("  entry:", entry.split("\n").length);

process.exit(pass ? 0 : 1);
