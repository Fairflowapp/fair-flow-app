/**
 * One-shot: replace JSON.parse(localStorage.getItem(...)) patterns in index.html
 * with ffSafeParseJSON(...). Requires ffSafeParseJSON() to exist earlier in the file.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const p = path.join(__dirname, "..", "public", "index.html");
let s = fs.readFileSync(p, "utf8");
const n0 = s.length;

let n1 = 0;
s = s.replace(
  /JSON\.parse\(localStorage\.getItem\(([^)]+)\)\s*\|\|\s*'(\[\]|\{\})'\)/g,
  (_, keyExpr, fb) => {
    n1++;
    const literal = fb === "[]" ? "[]" : "{}";
    return `ffSafeParseJSON(localStorage.getItem(${keyExpr}), ${literal})`;
  }
);
console.log("single-quoted fallback:", n1);

let n2 = 0;
s = s.replace(
  /JSON\.parse\(localStorage\.getItem\(([^)]+)\)\s*\|\|\s*"(\[\]|\{\})"\)/g,
  (_, keyExpr, fb) => {
    n2++;
    const literal = fb === "[]" ? "[]" : "{}";
    return `ffSafeParseJSON(localStorage.getItem(${keyExpr}), ${literal})`;
  }
);
console.log("double-quoted fallback:", n2);

let n3 = 0;
s = s.replace(
  /JSON\.parse\(localStorage\.getItem\(([^)]+)\)\)/g,
  (_, keyExpr) => {
    n3++;
    return `ffSafeParseJSON(localStorage.getItem(${keyExpr}), null)`;
  }
);
console.log("no-fallback -> null:", n3);

fs.writeFileSync(p, s);
console.log("bytes", n0, "->", s.length);
