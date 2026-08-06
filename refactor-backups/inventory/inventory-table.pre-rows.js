/**
 * Inventory — Table sub-app (rows/groups grid: rendering, cell editing,
 * columns + mobile layout, drag-and-drop, undo, Firestore persistence,
 * order-cell breakdown). Extracted verbatim from inventory.js.
 *
 * Shared state lives in inventory-state.js (single instance). Orchestrator spine
 * (salon/location/permissions, event-hub, render-orchestrator) is injected via
 * initInventoryTable() to break the orchestrator<->table import cycle.
 */
import { db } from "/app.js?v=20260610_force_lp_ios";

import {
  doc,
  updateDoc,
  serverTimestamp,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

import { invState } from "./inventory-state.js?v=20260627_inventory_split";

import {
  escapeHtml,
  newRowId,
  newGroupId,
  sharedInvSort,
  isProductsInventorySub,
  normalizeRowFromFirestore,
  serializeInventoryRowForFirestore,
  defaultInvColWidthsObj,
  cloneInvRowForUndo,
  parseNum,
  getItemOrderQty,
  computeOrder,
  getCellApprovedInfo,
  formatOrderDisplay,
  formatInventoryOrderCreatedAt,
  invCellKey,
  hrefForUrl,
  renderOrderCellTd,
  thResizeHandle,
  isProductsInventorySubId,
  productCategoryIdFromProductsSub,
  productSubcategoryIdFromProductsSub,
  productToInvRow,
  SHARED_INV_DEFAULT_GROUP_ID,
  INV_PRODUCTS_GENERAL_SUB,
} from "./inventory-helpers.js?v=20260627_inventory_split";

import { getCategoryTree } from "./inventory-catalog.js?v=20260627_inventory_catalog";

import {
  inventoryOrderDraftToast,
  scheduleInventoryOrderDraftSave,
} from "./inventory-orders.js?v=20260627_inventory_orders_split";

import { refreshInventoryInsightsAsync } from "./inventory-insights.js?v=20260627_inventory_insights";

import {
  initInventoryTablePersist,
  clearInventoryTableSaveTimer,
  importSharedItemsIntoCurrentInventorySub,
  fetchSubcategoryInventoryDoc,
  findCategoryAndSubForSubId,
  flushInventoryTableToFirestore,
  loadInventoryTableForSub,
  prepareInventoryTableStateForMount,
  scheduleInventoryTablePersist,
  ensureTableReadyForEdits,
  startInventoryUndo,
  commitPendingInventoryDeleteIfAny,
  persistColumnWidthsToFirestore,
} from "./inventory-table-persist.js?v=20260701_inventory_table_persist_split";

import {
  applyInvMobileColumnClasses,
  bindInvColumnResizeOnce,
  ensureInvMobileColHeaderBindOnce,
  getInvColWidths,
  invMobileAnyOptionalColumnHidden,
  isInvMobileNarrow,
  renderColgroup,
  resetInvMobileOptionalColumns,
  scheduleSyncInvColWidthsAfterLayout,
} from "./inventory-table-layout.js?v=20260701_inventory_table_layout_split";

export function initInventoryTable(deps) {
  initInventoryTablePersist({
    ...deps,
    getInvColWidths,
    ensureGroupCellsForRows,
    findSubMeta,
  });
}

function renderInventoryTableCardHtml() {
  let sharedBtnLabel = "+ Add from Shared";
  let narrow = false;
  try {
    if (typeof matchMedia !== "undefined" && matchMedia("(max-width: 767.98px)").matches) {
      sharedBtnLabel = "+ Shared";
      narrow = true;
    }
  } catch (_) {}
  const colsBtn =
    narrow
      ? `<button type="button" class="ff-inv2-btn ff-inv2-btn--toolbar-cols" id="ff-inv2-mobile-cols-reset" title="Bring back #, Code, Supplier, URL, or drag column after hiding them (double-tap a header to hide).">Columns</button>`
      : "";
  const meta = getSelectedSubMeta();
  const productsMode = meta && isProductsInventorySub(meta.sub);
  const toolbar = productsMode
    ? `<div class="ff-inv2-toolbar">
        <span class="ff-inv2-products-hint" style="font-size:12px;color:#6b7280;line-height:1.45;padding:2px 0;">Stock saves to Products. Add or edit products in the Products app.</span>
        ${colsBtn}
      </div>`
    : `<div class="ff-inv2-toolbar">
        <button type="button" class="ff-inv2-btn" id="ff-inv2-add-row">+ Add Row</button>
        <button type="button" class="ff-inv2-btn" id="ff-inv2-add-group">+ Add Group</button>
        ${colsBtn}
        <button type="button" class="ff-inv2-btn ff-inv2-btn--toolbar-shared" id="ff-inv2-add-from-shared">${escapeHtml(
          sharedBtnLabel
        )}</button>
      </div>`;
  return `<div class="ff-inv2-table-card">
      ${toolbar}
      <div class="ff-inv2-table-scroll">
        <table class="ff-inv2-table">
          ${renderTableHeaderHtml()}
          <tbody>${renderTableBodyHtml()}</tbody>
        </table>
      </div>
    </div>`;
}

function getInvCellKeyFromEl(el) {
  const inv = el.getAttribute("data-inv");
  const rowId = el.getAttribute("data-row-id");
  const gid = el.getAttribute("data-group-id");
  if (!inv || !rowId) return "";
  return invCellKey(inv, rowId, gid || null);
}

/**
 * @param {HTMLElement | null} root
 * @param {string} editKey
 */
function findInvEditInput(root, editKey) {
  if (!root || !editKey) return null;
  const list = root.querySelectorAll("input[data-edit-key]");
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    if (el.getAttribute("data-edit-key") === editKey) return el;
  }
  return null;
}

/**
 * @param {string} inv
 * @param {string} rowId
 * @param {string | number} value
 * @param {{ groupId?: string | null, mono?: boolean, classNames?: string, inputMode?: "decimal" | "numeric" }} opts
 */
function renderEditableCell(inv, rowId, value, opts) {
  opts = opts || {};
  const groupId = opts.groupId != null ? opts.groupId : null;
  const key = invCellKey(inv, rowId, groupId);
  const isEditing = invState._editCellKey === key;
  const extra = String(opts.classNames || "").trim();
  const monoCls = opts.mono ? " ff-inv2-mono" : "";
  const gAttr = groupId != null ? ` data-group-id="${escapeHtml(groupId)}"` : "";
  let inputModeAttr = "";
  if (opts.inputMode === "decimal") inputModeAttr = ` inputmode="decimal" autocomplete="off"`;
  else if (opts.inputMode === "numeric") inputModeAttr = ` inputmode="numeric" autocomplete="off"`;
  if (isEditing) {
    const cls = `ff-inv2-cell-input ff-inv2-cell-input--editing${monoCls}${extra ? ` ${extra}` : ""}`;
    return `<input class="${cls}" type="text"${inputModeAttr} data-inv="${escapeHtml(inv)}" data-row-id="${escapeHtml(rowId)}"${gAttr} data-edit-key="${escapeHtml(key)}" value="${escapeHtml(String(value))}" />`;
  }
  const cls = `ff-inv2-cell-view${extra ? ` ${extra}` : ""}${monoCls}`;
  return `<span class="${cls}" tabindex="0" role="button" data-inv-cell="1" data-inv="${escapeHtml(inv)}" data-row-id="${escapeHtml(rowId)}"${gAttr}>${escapeHtml(String(value))}</span>`;
}

function renderUrlCell(rowId, value) {
  const key = invCellKey("url", rowId);
  const isEditing = invState._editCellKey === key;
  const raw = value != null ? String(value) : "";
  if (isEditing) {
    return `<input class="ff-inv2-cell-input ff-inv2-cell-input--editing" type="text" data-inv="url" data-row-id="${escapeHtml(rowId)}" data-edit-key="${escapeHtml(key)}" value="${escapeHtml(raw)}" autocomplete="url" />`;
  }
  const href = hrefForUrl(raw);
  const hasLink = href !== "";
  const linkBlock = hasLink
    ? `<a class="ff-inv2-url-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(raw)}">${escapeHtml(raw)}</a>`
    : `<span class="ff-inv2-url-empty" title="No URL">—</span>`;
  const pen = `<button type="button" class="ff-inv2-url-edit" data-inv-url-edit="1" data-row-id="${escapeHtml(rowId)}" aria-label="Edit URL"><svg class="ff-inv2-url-edit-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>`;
  return `<div class="ff-inv2-url-cell">${linkBlock}${pen}</div>`;
}

function handleInvEditOutsideClick(ev) {
  if (!invState._editCellKey) return;
  const invScreen = document.getElementById("inventoryScreen");
  if (!invScreen || invScreen.style.display === "none") return;
  if (!invScreen.contains(ev.target)) {
    invState._editCellKey = null;
    mountOrRefreshMockUi();
    return;
  }
  const t = ev.target;
  if (t.closest("[data-inv-cell]")) return;
  if (t.closest("[data-inv-url-edit]")) return;
  if (t.closest("input.ff-inv2-cell-input")) return;
  /** Not the main inventory grid: remount on capture runs before checkbox change — breaks Order Details / receipt UI. */
  if (
    t.closest("#ff-inv-order-detail-backdrop") ||
    t.closest("#ff-inv-receipt-info-backdrop") ||
    t.closest("#ff-inv-od-line-view-backdrop")
  )
    return;
  const inTbody = t.closest(".ff-inv2-table tbody");
  if (!inTbody) {
    invState._editCellKey = null;
    mountOrRefreshMockUi();
    return;
  }
  invState._editCellKey = null;
  mountOrRefreshMockUi();
}

function ensureInvEditDocListenerOnce() {
  if (document.documentElement.dataset.ffInvEditDoc === "1") return;
  document.documentElement.dataset.ffInvEditDoc = "1";
  document.addEventListener("click", handleInvEditOutsideClick, true);
}


function ensureGroupCellsForRows() {
  if (!invState._groups || !invState._rows) return;
  for (const row of invState._rows) {
    if (row.rowNo === undefined) row.rowNo = "";
    for (const g of invState._groups) {
      if (!row.byGroup[g.id]) {
        row.byGroup[g.id] = { stock: 0, current: 0, price: "" };
      }
    }
  }
}

function addInventoryRow() {
  if (!ffCanManageInventory()) return;
  if (!ensureTableReadyForEdits()) return;
  invState._manageCategoriesOpen = false;
  invState._catManageDraftTree = null;
  resetCatModalTransientState();
  invState._groupRemoveConfirmId = null;
  invState._groupRemoveModalGroupId = null;
  const row = {
    id: newRowId(),
    rowNo: "",
    code: "",
    name: "",
    url: "",
    supplier: "",
    byGroup: {},
  };
  for (const g of invState._groups) {
    row.byGroup[g.id] = { stock: 0, current: 0, price: "" };
  }
  invState._rows.push(row);
  void flushInventoryTableToFirestore().catch((e) => console.error("[Inventory] table save failed", e));
}

function duplicateInventoryRow(rowId) {
  if (!ffCanManageInventory()) return;
  if (!ensureTableReadyForEdits()) return;
  const idx = invState._rows.findIndex((r) => r.id === rowId);
  if (idx < 0) return;
  const src = invState._rows[idx];
  const byGroup = {};
  for (const g of invState._groups) {
    const c = src.byGroup[g.id] || { stock: 0, current: 0, price: "" };
    byGroup[g.id] = {
      stock: typeof c.stock === "number" ? c.stock : parseNum(c.stock),
      current: typeof c.current === "number" ? c.current : parseNum(c.current),
      price: String(c.price ?? ""),
    };
  }
  const row = {
    id: newRowId(),
    rowNo: "",
    code: String(src.code ?? ""),
    name: String(src.name ?? ""),
    url: String(src.url ?? ""),
    supplier: String(src.supplier ?? ""),
    byGroup,
  };
  invState._rows.splice(idx + 1, 0, row);
  void flushInventoryTableToFirestore().catch((e) => console.error("[Inventory] table save failed", e));
}

function deleteInventoryRow(rowId) {
  if (!ffCanManageInventory()) return;
  void (async () => {
    if (!invState._rows) return;
    const idx = invState._rows.findIndex((r) => r.id === rowId);
    if (idx < 0) return;
    if (invState._rows[idx]._isProductRow) return;
    try {
      await commitPendingInventoryDeleteIfAny();
    } catch (e) {
      console.error("[Inventory] commit pending delete failed", e);
      return;
    }
    const rowClone = cloneInvRowForUndo(invState._rows[idx]);
    invState._rows = invState._rows.filter((r) => r.id !== rowId);
    startInventoryUndo({ kind: "row", row: rowClone, index: idx });
    mountOrRefreshMockUi();
  })();
}

/** Reorder invState._rows only; does not touch rowNo. */
function reorderInventoryRowsInPlace(dragRowId, targetRowId, placeBefore) {
  if (!ffCanManageInventory()) return;
  if (dragRowId === targetRowId || !invState._rows) return;
  const fi = invState._rows.findIndex((r) => r.id === dragRowId);
  const ti = invState._rows.findIndex((r) => r.id === targetRowId);
  if (fi < 0 || ti < 0) return;
  const [item] = invState._rows.splice(fi, 1);
  let insertIdx = ti;
  if (fi < ti) insertIdx--;
  if (!placeBefore) insertIdx++;
  invState._rows.splice(insertIdx, 0, item);
}

function bindInvRowDnDOnce(root) {
  if (root.dataset.ffInvRowDnd === "1") return;
  root.dataset.ffInvRowDnd = "1";
  let overTr = null;

  function clearOver() {
    if (overTr && overTr.isConnected) overTr.classList.remove("ff-inv2-row-dnd-over");
    overTr = null;
  }

  root.addEventListener("dragstart", (ev) => {
    const h = ev.target && ev.target.closest && ev.target.closest("[data-inv-row-dnd]");
    if (!h || !root.contains(h)) return;
    if (!ensureTableReadyForEdits()) return;
    const rowId = h.getAttribute("data-row-id");
    if (!rowId) return;
    invState._invRowDndDragId = rowId;
    try {
      ev.dataTransfer.setData("text/plain", `row:${rowId}`);
      ev.dataTransfer.effectAllowed = "move";
    } catch (e) {}
    const tr = h.closest("tr[data-inv-row-id]");
    if (tr) tr.classList.add("ff-inv2-row-dnd-dragging");
  });

  root.addEventListener("dragend", () => {
    invState._invRowDndDragId = null;
    clearOver();
    root.querySelectorAll(".ff-inv2-row-dnd-dragging").forEach((el) => el.classList.remove("ff-inv2-row-dnd-dragging"));
  });

  root.addEventListener("dragover", (ev) => {
    if (!invState._invRowDndDragId) return;
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const tr = t.closest("tbody tr[data-inv-row-id]");
    if (!tr || !root.contains(tr)) return;
    const tid = tr.getAttribute("data-inv-row-id");
    if (!tid || tid === invState._invRowDndDragId) return;
    ev.preventDefault();
    try {
      ev.dataTransfer.dropEffect = "move";
    } catch (e) {}
    if (overTr !== tr) {
      clearOver();
      overTr = tr;
      overTr.classList.add("ff-inv2-row-dnd-over");
    }
  });

  root.addEventListener("drop", (ev) => {
    if (!invState._invRowDndDragId || !invState._rows) return;
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const tr = t.closest("tbody tr[data-inv-row-id]");
    if (!tr || !root.contains(tr)) return;
    const tid = tr.getAttribute("data-inv-row-id");
    if (!tid || tid === invState._invRowDndDragId) {
      clearOver();
      ev.preventDefault();
      return;
    }
    ev.preventDefault();
    clearOver();
    const rect = tr.getBoundingClientRect();
    const placeBefore = ev.clientY < rect.top + rect.height / 2;
    reorderInventoryRowsInPlace(invState._invRowDndDragId, tid, placeBefore);
    invState._invRowDndDragId = null;
    root.querySelectorAll(".ff-inv2-row-dnd-dragging").forEach((el) => el.classList.remove("ff-inv2-row-dnd-dragging"));
    void flushInventoryTableToFirestore().catch((e) => console.error("[Inventory] table save after reorder failed", e));
    mountOrRefreshMockUi();
  });
}

function addInventoryGroup() {
  if (!ffCanManageInventory()) return;
  if (!ensureTableReadyForEdits()) return;
  invState._manageCategoriesOpen = false;
  invState._catManageDraftTree = null;
  resetCatModalTransientState();
  invState._groupRemoveConfirmId = null;
  invState._groupRemoveModalGroupId = null;
  const gid = newGroupId();
  invState._groups.push({ id: gid, label: "New group" });
  for (const row of invState._rows) {
    row.byGroup[gid] = { stock: 0, current: 0, price: "" };
  }
  void flushInventoryTableToFirestore().catch((e) => console.error("[Inventory] table save failed", e));
}

function removeInventoryGroup(groupId) {
  if (!ffCanManageInventory()) return;
  void (async () => {
    if (!ensureTableReadyForEdits() || !groupId) return;
    const gi = invState._groups.findIndex((g) => g.id === groupId);
    if (gi < 0) return;
    try {
      await commitPendingInventoryDeleteIfAny();
    } catch (e) {
      console.error("[Inventory] commit pending delete failed", e);
      return;
    }
    const group = { id: invState._groups[gi].id, label: invState._groups[gi].label };
    const perRowCells = {};
    for (const row of invState._rows) {
      const c = row.byGroup[groupId];
      if (c) {
        perRowCells[row.id] = {
          stock: typeof c.stock === "number" ? c.stock : parseNum(c.stock),
          current: typeof c.current === "number" ? c.current : parseNum(c.current),
          price: String(c.price ?? ""),
        };
      }
    }
    const w = getInvColWidths();
    const groupColWidth = w.groupSubById[groupId] != null ? w.groupSubById[groupId] : null;

    invState._groups = invState._groups.filter((g) => g.id !== groupId);
    for (const row of invState._rows) {
      try {
        delete row.byGroup[groupId];
      } catch (e) {}
    }
    if (invState._groupRemoveConfirmId === groupId) invState._groupRemoveConfirmId = null;
    if (invState._groupRemoveModalGroupId === groupId) invState._groupRemoveModalGroupId = null;
    startInventoryUndo({ kind: "group", group, groupIndex: gi, perRowCells, groupColWidth });
    mountOrRefreshMockUi();
  })();
}

/** True if any row has non-zero stock/current or non-empty price in this group. */
function groupHasAnyValues(groupId) {
  if (!invState._rows) return false;
  for (const row of invState._rows) {
    const c = row.byGroup[groupId];
    if (!c) continue;
    if (parseNum(c.stock) !== 0 || parseNum(c.current) !== 0) return true;
    if (String(c.price ?? "").trim() !== "") return true;
  }
  return false;
}

function updateOrderCellEl(rowId, groupId) {
  const row = invState._rows?.find((r) => r.id === rowId);
  if (!row) return;
  const gcell = row.byGroup[groupId];
  if (!gcell) return;
  const root = document.getElementById("inventoryScreen");
  if (!root) return;
  const { approved } = getCellApprovedInfo(gcell);
  const order = computeOrder(gcell.stock, gcell.current, approved);
  const cells = root.querySelectorAll("td[data-order-for-row]");
  for (let i = 0; i < cells.length; i++) {
    const el = cells[i];
    if (el.getAttribute("data-order-for-row") === rowId && el.getAttribute("data-order-for-group") === groupId) {
      const span = el.querySelector(".ff-inv2-order-val");
      if (span) span.textContent = formatOrderDisplay(order);
      el.classList.toggle("ff-inv2-order-cell--positive", order > 0);
      el.classList.toggle("ff-inv2-order-cell--has-approved", approved > 0);
      el.setAttribute("data-order-approved", String(approved || 0));
      return;
    }
  }
}

function handleInventoryInput(ev) {
  const t = ev.target;
  if (!(t instanceof HTMLInputElement)) return;
  if (t.hasAttribute("data-inv-order-save-name-input")) {
    invState._invOrderSaveNameDraft = t.value;
    scheduleInventoryOrderDraftSave();
    return;
  }
  // Inline qty editing for a manual Order-list line.
  if (t.hasAttribute("data-inv-ob-manual-qty")) {
    const lid = t.getAttribute("data-inv-ob-manual-qty");
    if (lid) {
      const idx = invState._invOrderBuilderManualLines.findIndex((L) => L && L.id === lid);
      if (idx >= 0) {
        const n = Number(t.value);
        invState._invOrderBuilderManualLines[idx].orderQty = Number.isFinite(n) && n > 0 ? n : 0;
        scheduleInventoryOrderDraftSave();
      }
    }
    return;
  }
  if (t.hasAttribute("data-inv-ob-auto-qty")) {
    const iid = t.getAttribute("data-inv-ob-auto-qty");
    if (iid) {
      const n = Number(t.value);
      const q = Number.isFinite(n) && n >= 0 ? n : 0;
      invState._invOrderBuilderAutoQtyOverrides[iid] = q;
      const idx = invState._invOrderBuilderPreviewLines.findIndex((L) => L && String(L.itemId) === iid);
      if (idx >= 0) invState._invOrderBuilderPreviewLines[idx].orderQty = q;
      scheduleInventoryOrderDraftSave();
    }
    return;
  }
  if (t.hasAttribute("data-inv-ob-add-input")) {
    if (!invState._invOrderBuilderAddModal) return;
    const field = t.getAttribute("data-inv-ob-add-input");
    if (field === "name") {
      invState._invOrderBuilderAddModal.draftName = t.value;
      const root = document.getElementById("inventoryScreen");
      const addBtn = root && root.querySelector("[data-inv-ob-add-commit]");
      if (addBtn instanceof HTMLButtonElement) {
        const can =
          String(invState._invOrderBuilderAddModal.draftName).trim() !== "" &&
          parseNum(invState._invOrderBuilderAddModal.draftQty) > 0;
        addBtn.disabled = !can;
      }
    } else if (field === "qty") {
      invState._invOrderBuilderAddModal.draftQty = t.value;
      const root = document.getElementById("inventoryScreen");
      const addBtn = root && root.querySelector("[data-inv-ob-add-commit]");
      if (addBtn instanceof HTMLButtonElement) {
        const can =
          String(invState._invOrderBuilderAddModal.draftName).trim() !== "" &&
          parseNum(invState._invOrderBuilderAddModal.draftQty) > 0;
        addBtn.disabled = !can;
      }
    }
    return;
  }
  if (t.hasAttribute("data-inv-orders-rename-input")) {
    if (invState._invOrdersRenameModal) invState._invOrdersRenameModal.draftName = t.value;
    return;
  }
  if (t.hasAttribute("data-inv-orders-search-input")) {
    const selStart = t.selectionStart;
    const selEnd = t.selectionEnd;
    invState._invOrdersSearchQuery = t.value;
    mountOrRefreshMockUi();
    const root = document.getElementById("inventoryScreen");
    const inp = root && root.querySelector("[data-inv-orders-search-input]");
    if (inp instanceof HTMLInputElement) {
      inp.focus();
      try {
        if (typeof selStart === "number" && typeof selEnd === "number") {
          inp.setSelectionRange(selStart, selEnd);
        }
      } catch (e) {
        /* ignore */
      }
    }
    return;
  }
  if (t.hasAttribute("data-inv-insights-from")) {
    invState._invInsightsCustomFrom = t.value;
    if (invState._invInsightsRange === "custom") void refreshInventoryInsightsAsync();
    return;
  }
  if (t.hasAttribute("data-inv-insights-to")) {
    invState._invInsightsCustomTo = t.value;
    if (invState._invInsightsRange === "custom") void refreshInventoryInsightsAsync();
    return;
  }
  if (t.hasAttribute("data-inv-insights-range-select")) {
    const v = t.value;
    const allowed = ["30d", "60d", "120d", "year", "all", "custom"];
    if (allowed.includes(v) && invState._invInsightsRange !== v) {
      invState._invInsightsRange = v;
      if (v !== "custom") {
        void refreshInventoryInsightsAsync();
      } else {
        mountOrRefreshMockUi();
      }
    }
    return;
  }
  if (t.hasAttribute("data-inv-shopping-qty-bought")) {
    const oid = t.getAttribute("data-order-id");
    const idxStr = t.getAttribute("data-line-idx");
    if (oid != null && idxStr != null) {
      const idx = Number(idxStr);
      if (!invState._invOrderShoppingDraft[oid]) invState._invOrderShoppingDraft[oid] = { checked: [], qtyBought: [] };
      if (!invState._invOrderShoppingDraft[oid].qtyBought) invState._invOrderShoppingDraft[oid].qtyBought = [];
      if (!invState._invOrderShoppingDraft[oid].checked) invState._invOrderShoppingDraft[oid].checked = [];
      invState._invOrderShoppingDraft[oid].qtyBought[idx] = t.value;
      // Checkbox is derived from B vs N: check only when B >= N (qty fully met).
      const order = invState._invOrdersList.find((x) => x.id === oid);
      const items = order && Array.isArray(order.items) ? order.items : [];
      const it = items[idx];
      const N = it ? getItemOrderQty(it) : 0;
      const B = parseNum(t.value);
      const derivedChecked = B > 0 && (N <= 0 || B >= N);
      invState._invOrderShoppingDraft[oid].checked[idx] = derivedChecked;
      const root = document.getElementById("inventoryScreen");
      if (root) {
        const cb = root.querySelector(
          `input[data-inv-shopping-check][data-order-id="${CSS.escape(oid)}"][data-line-idx="${CSS.escape(idxStr)}"]`
        );
        if (cb instanceof HTMLInputElement && cb.checked !== derivedChecked) {
          cb.checked = derivedChecked;
        }
      }
    }
    return;
  }
  const inv = t.getAttribute("data-inv");
  if (!inv) return;
  if (!ffCanManageInventory()) return;
  if (!ensureTableReadyForEdits()) return;

  if (inv === "group-label") {
    const gid = t.getAttribute("data-group-id");
    const g = invState._groups.find((x) => x.id === gid);
    if (g) g.label = t.value;
    scheduleInventoryTablePersist();
    return;
  }

  const rowId = t.getAttribute("data-row-id");
  const row = invState._rows.find((r) => r.id === rowId);
  if (!row) return;

  if (inv === "rowNo") {
    row.rowNo = t.value;
    scheduleInventoryTablePersist();
    return;
  }
  if (inv === "code") {
    row.code = t.value;
    scheduleInventoryTablePersist();
    return;
  }
  if (inv === "name") {
    row.name = t.value;
    scheduleInventoryTablePersist();
    return;
  }
  if (inv === "url") {
    row.url = t.value;
    scheduleInventoryTablePersist();
    return;
  }
  if (inv === "supplier") {
    row.supplier = t.value;
    scheduleInventoryTablePersist();
    return;
  }

  const gid = t.getAttribute("data-group-id");
  if (!gid) return;
  const gcell = row.byGroup[gid];
  if (!gcell) return;

  if (inv === "stock") {
    gcell.stock = parseNum(t.value);
    updateOrderCellEl(rowId, gid);
    scheduleInventoryTablePersist();
    return;
  }
  if (inv === "current") {
    gcell.current = parseNum(t.value);
    updateOrderCellEl(rowId, gid);
    scheduleInventoryTablePersist();
    return;
  }
  if (inv === "price") {
    gcell.price = t.value;
    scheduleInventoryTablePersist();
  }
}

function findSubMeta(subId) {
  if (!subId) return null;
  for (const c of getCategoryTree()) {
    for (const s of c.subcategories) {
      if (s.id === subId) return { category: c, sub: s };
    }
  }
  return null;
}

function getSelectedSubMeta() {
  const tree = getCategoryTree();
  const m = findSubMeta(invState._selectedSubcategoryId);
  if (m) return m;
  for (const c of tree) {
    const first = c.subcategories[0];
    if (first) {
      invState._selectedSubcategoryId = first.id;
      return { category: c, sub: first };
    }
  }
  return null;
}

function renderGroupHeaderTh(g) {
  const gid = g.id;
  const confirming = invState._groupRemoveConfirmId === gid;
  if (confirming) {
    const hasData = groupHasAnyValues(gid);
    const warn = hasData
      ? `<span class="ff-inv2-gh-warn">This will remove all values in this group</span>`
      : "";
    return `<th colspan="4" class="ff-inv2-gh ff-inv2-gh--confirming"><div class="ff-inv2-gh-inner ff-inv2-gh-inner--confirm">
  <input class="ff-inv2-gh-input" type="text" data-inv="group-label" data-group-id="${escapeHtml(gid)}" value="${escapeHtml(g.label)}" aria-label="Group name" />
  <div class="ff-inv2-gh-confirm-bar">
    ${warn}
    <div class="ff-inv2-gh-confirm-actions">
      <button type="button" class="ff-inv2-gh-btn ff-inv2-gh-btn-cancel" data-inv-remove-cancel="1">Cancel</button>
      <button type="button" class="ff-inv2-gh-btn ff-inv2-gh-btn-danger" data-inv-remove-modal="${escapeHtml(gid)}">Remove group</button>
    </div>
  </div>
</div>${thResizeHandle("group", `data-group-id="${escapeHtml(gid)}"`)}</th>`;
  }
  return `<th colspan="4" class="ff-inv2-gh"><div class="ff-inv2-gh-inner"><input class="ff-inv2-gh-input" type="text" data-inv="group-label" data-group-id="${escapeHtml(gid)}" value="${escapeHtml(g.label)}" aria-label="Group name" /><button type="button" class="ff-inv2-gh-remove" data-inv-remove-start="${escapeHtml(gid)}" title="Remove group" aria-label="Start removing group">×</button></div>${thResizeHandle("group", `data-group-id="${escapeHtml(gid)}"`)}</th>`;
}

function renderRemoveGroupModal() {
  const gid = invState._groupRemoveModalGroupId;
  if (!gid) return "";
  return `<div class="ff-inv2-modal-backdrop" id="ff-inv2-group-remove-modal" role="dialog" aria-modal="true" aria-labelledby="ff-inv2-group-remove-title">
  <div class="ff-inv2-modal-card">
    <h3 id="ff-inv2-group-remove-title" class="ff-inv2-modal-title">Are you sure you want to remove this group?</h3>
    <p class="ff-inv2-modal-hint">This action cannot be undone.</p>
    <div class="ff-inv2-modal-actions">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-inv-modal-cancel="1">Cancel</button>
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-danger" data-inv-modal-commit="${escapeHtml(gid)}">Yes, remove group</button>
    </div>
  </div>
</div>`;
}

function renderTableHeaderHtml() {
  if (invState._groups === null) return "";
  const w = getInvColWidths();
  const groupCells = invState._groups.map((g) => renderGroupHeaderTh(g)).join("");
  const subHeaders = invState._groups
    .map((g) => {
      const w4 = getInvMobileGroupSubColWidthsPx(w, g.id);
      const labels = ["Stock", "Current", "Order", "Price"];
      return w4
        .map(
          (cw, idx) =>
            `<th class="ff-inv2-subh" style="width:${cw}px;min-width:${cw}px">${labels[idx]}</th>`
        )
        .join("");
    })
    .join("");
  return `
${renderColgroup()}
<thead>
  <tr>
    <th rowspan="2" class="ff-inv2-th-dnd" data-inv-mobile-col="dnd" aria-hidden="true" title="Mobile: double-tap to hide/show. Toolbar: Columns — show all."></th>
    <th rowspan="2" class="ff-inv2-th-num" data-inv-mobile-col="num" title="# · Mobile: double-tap hide/show. Columns button restores."><span class="ff-inv2-th-inner">#</span>${thResizeHandle("hash")}</th>
    <th rowspan="2" class="ff-inv2-th-code" data-inv-mobile-col="code" title="Mobile: double-tap hide/show. Columns button — restore all.">Code${thResizeHandle("code")}</th>
    <th rowspan="2" class="ff-inv2-th-name" data-inv-mobile-col="name" title="Mobile: drag the thin line on the right edge of a header to resize · tap/double-tap name">Name${thResizeHandle("name")}</th>
    ${groupCells}
    <th rowspan="2" class="ff-inv2-th-supplier" data-inv-mobile-col="supplier" title="Mobile: double-tap · Columns shows all">Supplier${thResizeHandle("supplier")}</th>
    <th rowspan="2" class="ff-inv2-th-url" data-inv-mobile-col="url" title="Mobile: double-tap · Columns shows all">URL${thResizeHandle("url")}</th>
  </tr>
  <tr>${subHeaders}</tr>
</thead>`;
}

function rowGroupCells(row) {
  if (invState._groups === null) return "";
  return invState._groups
    .map((g) => {
      const v = row.byGroup[g.id] || { stock: 0, current: 0, price: "", approved: 0, approvedRequests: [] };
      const { approved } = getCellApprovedInfo(v);
      const order = computeOrder(v.stock, v.current, approved);
      const rid = row.id;
      const gid = g.id;
      return `<td class="ff-inv2-td-numcell">${renderEditableCell("stock", rid, v.stock, { groupId: gid, inputMode: "decimal" })}</td>
<td class="ff-inv2-td-numcell">${renderEditableCell("current", rid, v.current, { groupId: gid, inputMode: "decimal" })}</td>
${renderOrderCellTd(rid, gid, order, approved)}
<td class="ff-inv2-td-numcell ff-inv2-td-price"><span class="ff-inv2-price-symbol" aria-hidden="true">${escapeHtml(typeof window !== "undefined" && typeof window.ffGetCurrencySymbol === "function" ? window.ffGetCurrencySymbol() : "$")}</span>${renderEditableCell("price", rid, v.price, { groupId: gid, inputMode: "decimal" })}</td>`;
    })
    .join("");
}

function renderTableBodyHtml() {
  if (invState._invTableLoading) {
    return `<tr class="ff-inv2-data-row ff-inv2-table-loading-row"><td colspan="99" class="ff-inv2-td-num">Loading table…</td></tr>`;
  }
  if (invState._rows === null) return "";
  return invState._rows
    .map((row) => {
      const rid = row.id;
      const noVal = row.rowNo != null ? String(row.rowNo) : "";
      return `<tr class="ff-inv2-data-row" data-inv-row-id="${escapeHtml(rid)}">
  <td class="ff-inv2-td-dnd">
    <button type="button" class="ff-inv2-row-dnd-handle" draggable="true" data-inv-row-dnd="1" data-row-id="${escapeHtml(rid)}" aria-label="Drag to reorder row" title="Drag to reorder"></button>
  </td>
  <td class="ff-inv2-num ff-inv2-td-num ff-inv2-td-no">
    <div class="ff-inv2-td-no-inner">
    <button type="button" draggable="false" class="ff-inv2-row-kebab" data-inv-row-menu-trigger="${escapeHtml(rid)}" aria-label="Row actions" title="Row actions">⋯</button>
    <span class="ff-inv2-row-no-wrap">${renderEditableCell("rowNo", rid, noVal, { classNames: "ff-inv2-no-input", inputMode: "numeric" })}</span>
    </div>
  </td>
  <td class="ff-inv2-td-code">${renderEditableCell("code", rid, row.code, { mono: true, classNames: "ff-inv2-code-input" })}</td>
  <td class="ff-inv2-td-name">${renderEditableCell("name", rid, row.name, { classNames: "ff-inv2-name-input" })}</td>
  ${rowGroupCells(row)}
  <td class="ff-inv2-td-text ff-inv2-td-supplier">${renderEditableCell("supplier", rid, row.supplier, {})}</td>
  <td class="ff-inv2-td-text ff-inv2-td-url">${renderUrlCell(rid, row.url)}</td>
</tr>`;
    })
    .join("");
}

function renderInventoryOrderCellBreakdownModal() {
  if (!invState._invOrderCellBreakdownModal) return "";
  const { rowId, groupId, busy } = invState._invOrderCellBreakdownModal;
  const row = Array.isArray(invState._rows) ? invState._rows.find((r) => r.id === rowId) : null;
  const group = Array.isArray(invState._groups) ? invState._groups.find((g) => g.id === groupId) : null;
  if (!row || !group) return "";
  const cell = row.byGroup && row.byGroup[groupId] ? row.byGroup[groupId] : null;
  if (!cell) return "";
  const stock = typeof cell.stock === "number" ? cell.stock : parseNum(cell.stock);
  const current = typeof cell.current === "number" ? cell.current : parseNum(cell.current);
  const auto = Math.max(0, stock - current);
  const { approved, approvedRequests } = getCellApprovedInfo(cell);
  const total = auto + Math.max(0, approved);
  const subMeta = getSelectedSubMeta();
  const contextParts = [];
  if (subMeta && subMeta.category && subMeta.category.name != null) contextParts.push(String(subMeta.category.name));
  if (subMeta && subMeta.sub && subMeta.sub.name != null) contextParts.push(String(subMeta.sub.name));
  if (row.name) contextParts.push(String(row.name));
  if (group.label) contextParts.push(String(group.label));
  const contextLabel = contextParts.join(" · ");
  const disabled = busy ? " disabled" : "";

  const entries =
    approvedRequests.length === 0
      ? `<p class="ff-inv2-ord-breakdown-empty">No approved supply requests yet.</p>`
      : `<div class="ff-inv2-ord-breakdown-list">${approvedRequests
          .map((e, idx) => {
            const qtyLabel = `+${escapeHtml(formatOrderDisplay(e.qty))}${e.unit ? ` ${escapeHtml(String(e.unit))}` : ""}`;
            const who = e.byName ? String(e.byName) : e.by ? `UID ${String(e.by).slice(0, 6)}…` : "Manager";
            const itemDisp = e.itemName ? String(e.itemName) : "Supply request";
            const whenDisp =
              e.at && typeof e.at.toDate === "function"
                ? formatInventoryOrderCreatedAt(e.at)
                : typeof e.at === "object" && e.at && "seconds" in e.at
                  ? formatInventoryOrderCreatedAt(e.at)
                  : "";
            const noteHtml = e.note ? `<div class="ff-inv2-ord-breakdown-entry-meta">"${escapeHtml(String(e.note))}"</div>` : "";
            return `<div class="ff-inv2-ord-breakdown-entry" data-idx="${idx}">
  <div class="ff-inv2-ord-breakdown-entry-main">
    <div><span class="ff-inv2-ord-breakdown-entry-qty">${qtyLabel}</span> <span style="color:#0f172a;font-weight:500;">${escapeHtml(itemDisp)}</span></div>
    <div class="ff-inv2-ord-breakdown-entry-meta">By ${escapeHtml(who)}${whenDisp ? ` · ${escapeHtml(whenDisp)}` : ""}</div>
    ${noteHtml}
  </div>
  <button type="button" class="ff-inv2-ord-breakdown-remove" data-inv-ord-breakdown-remove="${escapeHtml(String(e.requestId))}" aria-label="Remove contribution" title="Remove"${disabled}>🗑</button>
</div>`;
          })
          .join("")}</div>`;

  return `<div class="ff-inv2-modal-backdrop" id="ff-inv-ord-breakdown-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv-ord-breakdown-title">
  <div class="ff-inv2-modal-card">
    <h3 id="ff-inv-ord-breakdown-title" class="ff-inv2-modal-title">Order breakdown</h3>
    ${contextLabel ? `<p class="ff-inv2-modal-hint" style="margin-bottom:12px;">${escapeHtml(contextLabel)}</p>` : ""}
    <dl class="ff-inv2-ord-breakdown-dl">
      <dt>Auto (Stock − Current)</dt><dd>${escapeHtml(formatOrderDisplay(auto))}</dd>
      <dt>Approved (supply requests)</dt><dd>${escapeHtml(formatOrderDisplay(Math.max(0, approved)))}</dd>
      <dt>Total order</dt><dd class="ff-inv2-ord-breakdown-total">${escapeHtml(formatOrderDisplay(total))}</dd>
    </dl>
    <div class="ff-inv2-ord-breakdown-section">
      <p class="ff-inv2-ord-breakdown-section-title">Approved contributions</p>
      ${entries}
    </div>
    <div class="ff-inv2-modal-actions">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-primary" data-inv-ord-breakdown-close="1">Close</button>
    </div>
  </div>
</div>`;
}

async function removeApprovedContributionForCell(rowId, groupId, requestId) {
  if (!rowId || !groupId || !requestId) return;
  const subMeta = getSelectedSubMeta();
  if (!subMeta) {
    inventoryOrderDraftToast("No subcategory selected.", "error");
    return;
  }
  const catId = String(subMeta.category.id);
  const subId = String(subMeta.sub.id);
  if (invState._invOrderCellBreakdownModal) {
    invState._invOrderCellBreakdownModal = { ...invState._invOrderCellBreakdownModal, busy: true };
    mountOrRefreshMockUi();
  }
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    const subRef = doc(db, `salons/${salonId}/inventoryCategories/${catId}/inventorySubcategories/${subId}`);
    let touchedRequestIds = [];
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(subRef);
      if (!snap.exists()) throw new Error("SUB_MISSING");
      const data = snap.data();
      const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
      const rowsNorm = rowsRaw.map((r) => normalizeRowFromFirestore(r));
      const row = rowsNorm.find((r) => r.id === rowId);
      if (!row) throw new Error("ROW_MISSING");
      const cell = row.byGroup && row.byGroup[groupId];
      if (!cell) throw new Error("CELL_MISSING");
      const before = Array.isArray(cell.approvedRequests) ? cell.approvedRequests.slice() : [];
      cell.approvedRequests = before.filter((e) => String(e.requestId) !== String(requestId));
      touchedRequestIds = before
        .filter((e) => String(e.requestId) === String(requestId))
        .map((e) => String(e.requestId));
      if (touchedRequestIds.length === 0) return;
      cell.approved = cell.approvedRequests.reduce((acc, e) => acc + (Number(e.qty) || 0), 0);
      const rowsPayload = rowsNorm.map((r) => serializeInventoryRowForFirestore(r));
      transaction.update(subRef, { rows: rowsPayload, updatedAt: serverTimestamp() });
    });

    for (const rid of touchedRequestIds) {
      try {
        const ref = doc(db, `salons/${salonId}/inboxItems`, rid);
        await updateDoc(ref, { appliedToInventory: false, appliedToInventoryAt: null, updatedAt: serverTimestamp() });
      } catch (e) {
        console.warn("[Inventory] clear applied flag on inbox item failed", rid, e);
      }
    }

    inventoryOrderDraftToast("Contribution removed.", "success");
    invState._invOrderCellBreakdownModal = null;
    const key = `${catId}:${subId}`;
    if (invState._invTableLoadedForSubId === key) {
      const seq = ++invState._invTableLoadSeq;
      invState._invTableLoading = true;
      mountOrRefreshMockUi();
      void loadInventoryTableForSub(catId, subId, seq, key);
    } else {
      mountOrRefreshMockUi();
    }
  } catch (e) {
    console.error("[Inventory] remove approved contribution failed", e);
    inventoryOrderDraftToast("Could not remove contribution.", "error");
    if (invState._invOrderCellBreakdownModal) {
      invState._invOrderCellBreakdownModal = { ...invState._invOrderCellBreakdownModal, busy: false };
      mountOrRefreshMockUi();
    }
  }
}

function renderInvRowMenu() {
  if (!invState._invRowMenu) return "";
  const m = invState._invRowMenu;
  const rid = escapeHtml(m.rowId);
  const row = Array.isArray(invState._rows) ? invState._rows.find((r) => r.id === m.rowId) : null;
  const isProduct = !!(row && row._isProductRow);
  const duplicateBtn = isProduct
    ? ""
    : `<button type="button" class="ff-inv2-row-menu-item" role="menuitem" data-inv-row-action="duplicate" data-row-id="${rid}">Duplicate row</button>`;
  const deleteBtn = isProduct
    ? ""
    : `<button type="button" class="ff-inv2-row-menu-item ff-inv2-row-menu-item--danger" role="menuitem" data-inv-row-action="delete" data-row-id="${rid}">Delete row</button>`;
  return `<div class="ff-inv2-row-menu-backdrop" data-inv-row-menu-dismiss="1" aria-hidden="true"></div>
<div class="ff-inv2-row-menu" role="menu" style="left:${m.left}px;top:${m.top}px">
  <button type="button" class="ff-inv2-row-menu-item" role="menuitem" data-inv-row-action="edit" data-row-id="${rid}">Edit row</button>
  ${duplicateBtn}
  ${deleteBtn}
</div>`;
}

function renderDeleteRowModal() {
  if (!invState._invRowDeleteModalRowId) return "";
  const rid = escapeHtml(invState._invRowDeleteModalRowId);
  return `<div class="ff-inv2-modal-backdrop" id="ff-inv2-row-delete-modal" role="dialog" aria-modal="true" aria-labelledby="ff-inv2-row-delete-title">
  <div class="ff-inv2-modal-card">
    <h3 id="ff-inv2-row-delete-title" class="ff-inv2-modal-title">Delete row?</h3>
    <p class="ff-inv2-modal-hint">This will remove all values in this row.</p>
    <div class="ff-inv2-modal-actions">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-inv-row-delete-cancel="1">Cancel</button>
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-danger" data-inv-row-delete-commit="1" data-row-id="${rid}">Delete</button>
    </div>
  </div>
</div>`;
}

/**
 * Long-press (~500ms) on an inventory Order cell opens the breakdown modal.
 * Eats the next click so short release doesn't bubble up.
 */
function bindInventoryOrderCellLongPressOnce(root) {
  if (root.dataset.ffInvOrdCellLongPress === "1") return;
  root.dataset.ffInvOrdCellLongPress = "1";
  /** @type {{ timer: ReturnType<typeof setTimeout>, x: number, y: number } | null} */
  let state = null;

  function clear() {
    if (state && state.timer) clearTimeout(state.timer);
    state = null;
  }

  root.addEventListener(
    "pointerdown",
    (ev) => {
      const tgt =
        ev.target instanceof Element ? ev.target : ev.target instanceof Text ? ev.target.parentElement : null;
      if (!tgt) return;
      const td = tgt.closest("td.ff-inv2-order-cell");
      if (!td || !root.contains(td)) return;
      if (ev.button !== 0) return;
      const rowId = td.getAttribute("data-order-for-row");
      const groupId = td.getAttribute("data-order-for-group");
      if (!rowId || !groupId) return;
      clear();
      const x = ev.clientX;
      const y = ev.clientY;
      const timer = window.setTimeout(() => {
        state = null;
        invState._invOrderCellBreakdownModal = { rowId, groupId, busy: false };
        const kill = (cev) => {
          document.removeEventListener("click", kill, true);
          const el =
            cev.target instanceof Element
              ? cev.target
              : cev.target instanceof Text
                ? cev.target.parentElement
                : null;
          if (!el) return;
          const cellAgain = el.closest("td.ff-inv2-order-cell");
          if (
            cellAgain &&
            cellAgain.getAttribute("data-order-for-row") === rowId &&
            cellAgain.getAttribute("data-order-for-group") === groupId
          ) {
            cev.preventDefault();
            cev.stopPropagation();
            cev.stopImmediatePropagation();
          }
        };
        document.addEventListener("click", kill, true);
        window.setTimeout(() => {
          document.removeEventListener("click", kill, true);
        }, 900);
        mountOrRefreshMockUi();
      }, 500);
      state = { timer, x, y };
    },
    true
  );

  root.addEventListener(
    "pointermove",
    (ev) => {
      if (!state) return;
      const d = Math.hypot(ev.clientX - state.x, ev.clientY - state.y);
      if (d > 14) clear();
    },
    true
  );

  root.addEventListener("pointerup", () => clear(), true);
  root.addEventListener("pointercancel", () => clear(), true);
}

export {
  addInventoryGroup,
  addInventoryRow,
  applyInvMobileColumnClasses,
  bindInvColumnResizeOnce,
  bindInvRowDnDOnce,
  bindInventoryOrderCellLongPressOnce,
  clearInventoryTableSaveTimer,
  deleteInventoryRow,
  duplicateInventoryRow,
  ensureGroupCellsForRows,
  ensureInvEditDocListenerOnce,
  ensureInvMobileColHeaderBindOnce,
  fetchSubcategoryInventoryDoc,
  findCategoryAndSubForSubId,
  findInvEditInput,
  findSubMeta,
  flushInventoryTableToFirestore,
  getInvCellKeyFromEl,
  getSelectedSubMeta,
  handleInventoryInput,
  importSharedItemsIntoCurrentInventorySub,
  invMobileAnyOptionalColumnHidden,
  isInvMobileNarrow,
  loadInventoryTableForSub,
  prepareInventoryTableStateForMount,
  removeApprovedContributionForCell,
  removeInventoryGroup,
  renderDeleteRowModal,
  renderInvRowMenu,
  renderInventoryOrderCellBreakdownModal,
  renderInventoryTableCardHtml,
  renderRemoveGroupModal,
  resetInvMobileOptionalColumns,
  scheduleSyncInvColWidthsAfterLayout,
};
