import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const sha = (s) => createHash("sha1").update(s).digest("hex");

const backupLines = readFileSync("refactor-backups/inventory/inventory.pre-nav.js", "utf8").split("\n");
const modLines = readFileSync("public/inventory-nav.js", "utf8").split("\n");

function backupSlice(start, end) {
  return backupLines.slice(start - 1, end).join("\n");
}

function assertSha(label, body, start, end) {
  const ok = sha(body.trimEnd()) === sha(backupSlice(start, end));
  console.log(`[byte-identity] ${label}:`, ok);
  if (!ok) process.exitCode = 1;
}

const reloadStart = modLines.findIndex((l, i) => l === backupLines[866] && modLines[i + 5]?.startsWith("function ffInventoryReloadSub"));
const reloadEnd = modLines.findIndex((l) => l.startsWith("function hideFullscreenPeersForInventory"));
const hideEnd = modLines.findIndex((l) => l.startsWith("export async function goToInventory"));
const goEnd = modLines.findIndex((l, i) => i > hideEnd && l === "}" && modLines[i + 1] === "" && modLines[i + 2]?.startsWith('if (typeof window !== "undefined") {'));

assertSha("reload block", modLines.slice(reloadStart, reloadEnd).join("\n"), 867, 955);
assertSha("hideFullscreenPeersForInventory", modLines.slice(reloadEnd, hideEnd).join("\n"), 963, 992);
assertSha("goToInventory", modLines.slice(hideEnd, goEnd + 1).join("\n"), 994, 1076);
console.log(
  "[byte-identity] window.goToInventory binding:",
  modLines.some((l) => l.includes("window.goToInventory = goToInventory"))
);
