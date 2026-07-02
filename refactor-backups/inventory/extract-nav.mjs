import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const SRC = "public/inventory.js";
const OUT = "public/inventory-nav.js";
const BACKUP = "refactor-backups/inventory/inventory.pre-nav.js";
const TOKEN = "20260701_inventory_nav_split";
const sha = (s) => createHash("sha1").update(s).digest("hex");

const backup = readFileSync(BACKUP, "utf8");
const lines = backup.split("\n");

const RELOAD_BLOCK = { start: 867, end: 955 };
const HIDE_PEERS = { start: 963, end: 992 };
const GO_TO = { start: 994, end: 1076 };
const WINDOW_GOTO_LINE = 1087;

function sliceBlock({ start, end }) {
  return lines.slice(start - 1, end).join("\n");
}

const reloadBlock = sliceBlock(RELOAD_BLOCK);
const hidePeersBody = sliceBlock(HIDE_PEERS);
const goToBody = sliceBlock(GO_TO);
const windowGotoLine = lines[WINDOW_GOTO_LINE - 1];

if (!lines[871].startsWith("function ffInventoryReloadSub")) {
  console.error("reload fn mismatch", lines[871]);
  process.exit(1);
}
if (!lines[962].startsWith("function hideFullscreenPeersForInventory")) {
  console.error("hide peers mismatch", lines[962]);
  process.exit(1);
}
if (!lines[993].startsWith("export async function goToInventory")) {
  console.error("goTo mismatch", lines[993]);
  process.exit(1);
}
if (!windowGotoLine.includes("window.goToInventory = goToInventory")) {
  console.error("window goto mismatch", windowGotoLine);
  process.exit(1);
}

const mod = `// inventory-nav.js
// Navigation entry point and lifecycle listeners (currency/location changes).
// Extracted verbatim from inventory.js (Phase 15).

import { invState } from "./inventory-state.js?v=20260627_inventory_split";
import { mountOrRefreshMockUi } from "./inventory-shell.js?v=20260701_inventory_shell_split";
import { loadInventoryCategoriesFromFirestore } from "./inventory-catalog.js?v=20260627_inventory_catalog";
import { loadInventoryTableForSub } from "./inventory-table.js?v=20260627_inventory_table3";
import {
  loadInventoryOrdersList,
  loadInventoryOrderDraft,
} from "./inventory-orders.js?v=20260701_inventory_orders_split";
import {
  refreshInventoryInsightsAsync,
  scanInventorySuggestionsOnce,
  scanProductReorderAlertsOnce,
} from "./inventory-insights.js?v=20260627_inventory_insights";

${reloadBlock}

${hidePeersBody}

${goToBody}

if (typeof window !== "undefined") {
${windowGotoLine.trim()}
}
`;

writeFileSync(OUT, mod);

const drop = new Set();
for (const b of [RELOAD_BLOCK, HIDE_PEERS, GO_TO]) {
  for (let i = b.start; i <= b.end; i++) drop.add(i);
}
drop.add(WINDOW_GOTO_LINE);

const reducedLines = [];
for (let i = 0; i < lines.length; i++) {
  const n = i + 1;
  if (drop.has(n)) continue;
  reducedLines.push(lines[i]);
}

let reduced = reducedLines.join("\n");

const NAV_IMPORT = `import { goToInventory } from "./inventory-nav.js?v=${TOKEN}";\nexport { goToInventory };`;

const SHELL_IMPORT = 'import { initInventoryShell, mountOrRefreshMockUi } from "./inventory-shell.js?v=20260701_inventory_shell_split";';
if (!reduced.includes(SHELL_IMPORT)) {
  console.error("shell import anchor missing");
  process.exit(1);
}
reduced = reduced.replace(SHELL_IMPORT, SHELL_IMPORT + "\n" + NAV_IMPORT);

const ORDERS_INIT = `initInventoryOrders({
  getSalonId,
  mountOrRefreshMockUi,
  _ffInvActiveLocId,
  _ffInvDocInActiveLoc,
  getSelectedSubMeta,
  isInvMobileNarrow,
  loadInventoryTableForSub,
  fetchSubcategoryInventoryDoc,
  findCategoryAndSubForSubId,
});`;
const ORDERS_INIT_WITH_NAV = ORDERS_INIT.replace(
  "findCategoryAndSubForSubId,\n});",
  "findCategoryAndSubForSubId,\n  goToInventory,\n});"
);
if (!reduced.includes(ORDERS_INIT)) {
  console.error("orders init missing");
  process.exit(1);
}
reduced = reduced.replace(ORDERS_INIT, ORDERS_INIT_WITH_NAV);

writeFileSync(SRC, reduced);

console.log("inventory-nav.js lines:", mod.split("\n").length);
console.log("main:", lines.length, "->", reduced.split("\n").length);
console.log("sha(goToInventory):", sha(goToBody));
console.log("sha(reload block):", sha(reloadBlock));
