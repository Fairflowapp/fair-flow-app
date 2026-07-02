import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const sha = (s) => createHash("sha1").update(s).digest("hex");

const backupLines = readFileSync("refactor-backups/inventory/inventory.pre-delegates-workspace.js", "utf8").split("\n");
const modLines = readFileSync("public/inventory-delegates-workspace.js", "utf8").split("\n");

const CLICK_NAV = { start: 975, end: 1069 };
const CLICK_WORKSPACE = { start: 1073, end: 1479 };
const LISTENERS = [
  ["focusout listener", 888, 908, "focusout"],
  ["keydown listener", 909, 970, "keydown"],
  ["contextmenu listener", 862, 880, "contextmenu"],
  ["mousedown listener", 881, 887, "mousedown"],
];
const SETUP_LINES = [855, 857, 860, 861];

function backupSlice(start, end) {
  return backupLines.slice(start - 1, end).join("\n");
}

function normalizeHandlerReturns(body) {
  return body.replace(/^(\s+)return true;$/gm, "$1return;");
}

function handlerBody(signature) {
  const start = modLines.findIndex((l) => l.startsWith(`function ${signature}`));
  const end = modLines.findIndex((l, i) => i > start && l === "  return false;");
  return normalizeHandlerReturns(modLines.slice(start + 1, end).join("\n").trimEnd());
}

function bindListenerBody(eventName) {
  const bindStart = modLines.findIndex((l) => l.startsWith("export function bindInventoryDelegatesWorkspaceOnce"));
  const bindLines = modLines.slice(bindStart + 1);
  const start = bindLines.findIndex((l) => l.includes(`addEventListener("${eventName}"`));
  const end = bindLines.findIndex((l, i) => i > start && l.trim() === "});");
  return bindLines.slice(start, end + 1).join("\n");
}

function assert(label, got, expected) {
  const ok = got === expected;
  console.log(`[byte-identity] ${label}:`, ok);
  if (!ok) process.exitCode = 1;
}

assert(
  "click nav",
  sha(handlerBody("handleInventoryWorkspaceDelegateClickNav(ev, root, t)")),
  sha(backupSlice(CLICK_NAV.start, CLICK_NAV.end))
);
assert(
  "click workspace",
  sha(handlerBody("handleInventoryWorkspaceDelegateClick(ev, root, t)")),
  sha(backupSlice(CLICK_WORKSPACE.start, CLICK_WORKSPACE.end))
);

for (const [label, start, end, eventName] of LISTENERS) {
  assert(label, sha(bindListenerBody(eventName)), sha(backupSlice(start, end)));
}

const bindStart = modLines.findIndex((l) => l.startsWith("export function bindInventoryDelegatesWorkspaceOnce"));
const bindSection = modLines.slice(bindStart + 1).join("\n");
for (const n of SETUP_LINES) {
  if (!bindSection.includes(backupLines[n - 1].trim())) {
    console.log(`[byte-identity] setup line ${n}: false`);
    process.exitCode = 1;
  }
}
console.log("[byte-identity] setup lines: true");
