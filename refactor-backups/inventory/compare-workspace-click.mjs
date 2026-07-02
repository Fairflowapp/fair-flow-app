import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const sha = (s) => createHash("sha1").update(s).digest("hex");
const backup = readFileSync("refactor-backups/inventory/inventory.pre-delegates-workspace.js", "utf8").split("\n");
const mod = readFileSync("public/inventory-delegates-workspace.js", "utf8").split("\n");
const b = backup.slice(1072, 1479).join("\n");
const start = mod.findIndex((l) => l.includes("function handleInventoryWorkspaceDelegateClick(ev, root, t)"));
const end = mod.findIndex((l, i) => i > start && l === "  return false;");
const m = mod
  .slice(start + 1, end)
  .join("\n")
  .replace(/^(\s+)return true;$/gm, "$1return;");

console.log("backup len", b.length, "mod len", m.length);
console.log("backup sha", sha(b));
console.log("mod sha", sha(m));
console.log("match", b === m);
if (b !== m) {
  const bl = b.split("\n");
  const ml = m.split("\n");
  for (let i = 0; i < Math.max(bl.length, ml.length); i++) {
    if (bl[i] !== ml[i]) {
      console.log("first diff line", i + 1);
      console.log("B:", JSON.stringify(bl[i]));
      console.log("M:", JSON.stringify(ml[i]));
      break;
    }
  }
}
