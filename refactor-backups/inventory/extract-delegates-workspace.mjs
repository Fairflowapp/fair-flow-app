import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const SRC = "public/inventory.js";
const OUT = "public/inventory-delegates-workspace.js";
const BACKUP = "refactor-backups/inventory/inventory.pre-delegates-workspace.js";
const TOKEN = "20260701_inventory_delegates_workspace_split";
const sha = (s) => createHash("sha1").update(s).digest("hex");

const backup = readFileSync(BACKUP, "utf8");
const lines = backup.split("\n");

const SETUP_LINES = [855, 857, 860, 861];
const CONTEXTMENU = { start: 862, end: 880 };
const MOUSEDOWN = { start: 881, end: 887 };
const FOCUSOUT = { start: 888, end: 908 };
const KEYDOWN = { start: 909, end: 970 };
const CLICK_LISTENER = { start: 971, end: 1480 };
const CLICK_NAV = { start: 975, end: 1069 };
const CLICK_WORKSPACE = { start: 1073, end: 1479 };
const MOBILE_COL_BIND = 1481;

function sliceBlock({ start, end }) {
  return lines.slice(start - 1, end).join("\n");
}

function toHandlerBody(block) {
  return block
    .split("\n")
    .map((l) => l.replace(/^(\s+)return;$/, "$1return true;"))
    .join("\n");
}

const clickNavBody = sliceBlock(CLICK_NAV);
const clickWorkspaceBody = sliceBlock(CLICK_WORKSPACE);
const focusoutBody = sliceBlock(FOCUSOUT);
const keydownBody = sliceBlock(KEYDOWN);
const contextmenuBody = sliceBlock(CONTEXTMENU);
const mousedownBody = sliceBlock(MOUSEDOWN);
const setupBody = SETUP_LINES.map((n) => lines[n - 1]).join("\n");
const mobileColBindLine = lines[MOBILE_COL_BIND - 1];

if (!lines[854].includes("bindInvColumnResizeOnce")) {
  console.error("setup mismatch", lines[854]);
  process.exit(1);
}

const mod = `// inventory-delegates-workspace.js
// Workspace delegates: table/edit, order builder, drafts picker, nav tabs, and shared
// listeners (contextmenu, mousedown, focusout, keydown). Extracted verbatim from
// ensureInventoryScreenDelegates in inventory.js (Phase 14).

import { invState } from "./inventory-state.js?v=20260627_inventory_split";
import { parseNum, invCellKey } from "./inventory-helpers.js?v=20260627_inventory_split";
import { ffCanManageInventory } from "./inventory-spine.js?v=20260701_inventory_spine_split";
import {
  handleInventoryCatalogDelegateClick,
  handleInventoryCatalogDelegateKeydownActivate,
  handleInventoryCatalogDelegateKeydownEscape,
} from "./inventory-delegates-catalog.js?v=20260701_inventory_delegates_catalog_split";
import {
  handleInventoryOrdersDelegateClick,
  handleInventoryOrdersDelegateFocusout,
  handleInventoryOrdersDelegateKeydown,
  handleInventoryOrdersDelegateKeydownEscape,
} from "./inventory-delegates-orders.js?v=20260701_inventory_delegates_orders_split";
import {
  bindInvColumnResizeOnce,
  bindInvRowDnDOnce,
  handleInventoryInput,
  findInvEditInput,
  getInvCellKeyFromEl,
  duplicateInventoryRow,
  deleteInventoryRow,
  addInventoryRow,
  addInventoryGroup,
  removeInventoryGroup,
  importSharedItemsIntoCurrentInventorySub,
  invMobileAnyOptionalColumnHidden,
  resetInvMobileOptionalColumns,
  ensureInvMobileColHeaderBindOnce,
} from "./inventory-table.js?v=20260627_inventory_table3";
import {
  handleOrderBuilderSourceChange,
  commitInventoryOrderBuilderAddItem,
  saveInventoryOrderDraft,
  createNewInventoryOrderDraft,
  scheduleInventoryOrderDraftSave,
  openInventoryDraftsPicker,
  closeInventoryDraftsPicker,
  switchActiveInventoryDraft,
  deleteInventoryDraftFromPicker,
  loadLinkPickerItemsForSub,
  loadInventoryOrderDraft,
  loadInventoryOrdersList,
  refreshOrderBuilderPreviewAsync,
} from "./inventory-orders.js?v=20260701_inventory_orders_split";
import { refreshInventoryInsightsAsync } from "./inventory-insights.js?v=20260627_inventory_insights";

let mountOrRefreshMockUi;

export function initInventoryDelegatesWorkspace(deps) {
  ({ mountOrRefreshMockUi } = deps);
}

/** @returns {boolean} */
function handleInventoryWorkspaceDelegateClickNav(ev, root, t) {
${toHandlerBody(clickNavBody)}
  return false;
}

/** @returns {boolean} */
function handleInventoryWorkspaceDelegateClick(ev, root, t) {
${toHandlerBody(clickWorkspaceBody)}
  return false;
}

export function bindInventoryDelegatesWorkspaceOnce(root) {
${setupBody}
${contextmenuBody}
${mousedownBody}
${focusoutBody}
${keydownBody}
  root.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    if (handleInventoryWorkspaceDelegateClickNav(ev, root, t)) return;
    if (handleInventoryOrdersDelegateClick(ev, root, t)) return;
    if (handleInventoryWorkspaceDelegateClick(ev, root, t)) return;
  });
${mobileColBindLine}
}
`;

writeFileSync(OUT, mod);

function inRange(n, { start, end }) {
  return n >= start && n <= end;
}

const drop = new Set(SETUP_LINES);
for (const b of [CONTEXTMENU, MOUSEDOWN, FOCUSOUT, KEYDOWN, CLICK_LISTENER]) {
  for (let i = b.start; i <= b.end; i++) drop.add(i);
}
drop.add(MOBILE_COL_BIND);

const reducedLines = [];
for (let i = 0; i < lines.length; i++) {
  const n = i + 1;
  if (n === 859) {
    reducedLines.push(lines[i]);
    reducedLines.push("  bindInventoryDelegatesWorkspaceOnce(root);");
    continue;
  }
  if (drop.has(n)) continue;
  reducedLines.push(lines[i]);
}

let reduced = reducedLines.join("\n");

const WS_IMPORT = `import {
  initInventoryDelegatesWorkspace,
  bindInventoryDelegatesWorkspaceOnce,
} from "./inventory-delegates-workspace.js?v=${TOKEN}";`;

const ORDERS_ANCHOR = '} from "./inventory-delegates-orders.js?v=20260701_inventory_delegates_orders_split";';
if (!reduced.includes(ORDERS_ANCHOR)) {
  console.error("orders anchor missing");
  process.exit(1);
}
reduced = reduced.replace(ORDERS_ANCHOR, ORDERS_ANCHOR + "\n" + WS_IMPORT);

const INIT_BLOCK = "initInventoryDelegatesWorkspace({ mountOrRefreshMockUi });\n";
const INIT_ORDERS = "initInventoryDelegatesOrders({ mountOrRefreshMockUi });";
if (!reduced.includes(INIT_ORDERS)) {
  console.error("init orders missing");
  process.exit(1);
}
reduced = reduced.replace(INIT_ORDERS, INIT_ORDERS + "\n" + INIT_BLOCK);

writeFileSync(SRC, reduced);

console.log("inventory-delegates-workspace.js lines:", mod.split("\n").length);
console.log("main:", lines.length, "->", reduced.split("\n").length);
console.log("sha(click workspace):", sha(clickWorkspaceBody));
