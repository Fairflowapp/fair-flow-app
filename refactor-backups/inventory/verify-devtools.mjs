import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const sha = (s) => createHash("sha1").update(s).digest("hex");

const backupLines = readFileSync("refactor-backups/inventory/inventory.pre-devtools.js", "utf8").split("\n");
const modLines = readFileSync("public/inventory-devtools.js", "utf8").split("\n");

function backupSlice(start, end) {
  return backupLines.slice(start - 1, end).join("\n");
}

function assertSha(label, body, start, end) {
  const ok = sha(body.trimEnd()) === sha(backupSlice(start, end));
  console.log(`[byte-identity] ${label}:`, ok);
  if (!ok) process.exitCode = 1;
}

const blockStart = modLines.findIndex((l) => l.startsWith('if (typeof window !== "undefined") {'));
const blockLen = 988 - 889 + 1;
const blockBody = modLines.slice(blockStart + 1, blockStart + 1 + blockLen).join("\n");

assertSha("devtools window block", blockBody, 889, 988);
