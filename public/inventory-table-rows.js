// inventory-table-rows.js
// Cell edit helpers, row/group CRUD, row DnD, and order-cell DOM updates.
// Extracted verbatim from inventory-table.js (Phase T3). Spine injected via init.

import { invState } from "./inventory-state.js?v=20260728_inv_mobile_unstick";

import {
  escapeHtml,
  newRowId,
  newGroupId,
  cloneInvRowForUndo,
  parseNum,
  computeOrder,
  getCellApprovedInfo,
  formatOrderDisplay,
  invCellKey,
  hrefForUrl,
} from "./inventory-helpers.js?v=20260728_inv_mobile_unstick";

import { resetCatModalTransientState } from "./inventory-catalog.js?v=20260728_inv_mobile_unstick";

import {
  ensureTableReadyForEdits,
  flushInventoryTableToFirestore,
  commitPendingInventoryDeleteIfAny,
  startInventoryUndo,
} from "./inventory-table-persist.js?v=20260728_inv_mobile_unstick";

import { getInvColWidths } from "./inventory-table-layout.js?v=20260728_inv_mobile_unstick";

let mountOrRefreshMockUi, ffCanManageInventory;

export function initInventoryTableRows(deps) {
  ({ mountOrRefreshMockUi, ffCanManageInventory } = deps);
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

export {
  addInventoryGroup,
  addInventoryRow,
  bindInvRowDnDOnce,
  deleteInventoryRow,
  duplicateInventoryRow,
  ensureGroupCellsForRows,
  ensureInvEditDocListenerOnce,
  findInvEditInput,
  getInvCellKeyFromEl,
  groupHasAnyValues,
  removeInventoryGroup,
  renderEditableCell,
  renderUrlCell,
  updateOrderCellEl,
};
