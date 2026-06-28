/**
 * Inventory — Orders sub-app (purchase-order drafts, orders list, order detail,
 * order builder, receipts). Extracted verbatim from inventory.js.
 *
 * Shared module state lives in inventory-state.js (single instance). Orchestrator
 * / Table internals are injected via initInventoryOrders() to break the import cycle.
 */
import { db, auth, storage } from "/app.js?v=20260610_force_lp_ios";

import {
  doc,
  getDoc,
  getDocs,
  collection,
  updateDoc,
  addDoc,
  setDoc,
  serverTimestamp,
  query,
  orderBy,
  where,
  deleteDoc,
  onSnapshot,
  runTransaction,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";

import { invState } from "./inventory-state.js?v=20260627_inventory_split";

import {
  escapeHtml,
  normalizeRowFromFirestore,
  serializeInventoryRowForFirestore,
  parseNum,
  parseRowIdFromInventoryItemId,
  getItemOrderQty,
  getItemReceivedCumulative,
  getOrderDetailTotals,
  computeReceiveStatusFromItems,
  orderHasAppliedInventoryImpact,
  getOrderLineReceiveVisualState,
  escapeCsvCell,
  getOrderItemGroupLabel,
  getOrderDetailExportFilename,
  getOrderReceiveSummaryCounts,
  isItemPurchaseAppliedToInventory,
  formatOrderDisplay,
  parseSubcategoryDocToTable,
  buildOrderLinesFromGroupsRows,
  sortOrderBuilderLines,
  seedOrderBuilderSelectionIfEmpty,
  sanitizeManualItemForDraft,
  renderDraftsPickerRowHtml,
  formatInventoryOrderSourceLabel,
  getInventoryOrderDisplayName,
  formatInventoryOrderCreatedAt,
  formatInventoryOrderStatusDisplay,
  getInventoryOrderStatusKey,
  getOrderSearchHaystack,
  formatInventoryOrderOrderedByDisplay,
  clonePlainForFirestoreOrderPayload,
  sanitizeReceiptStorageFileName,
  getReceiptFileTypeEmoji,
  sortOrderDetailPairsOpenFirst,
} from "./inventory-helpers.js?v=20260627_inventory_split";

import {
  getCategoryTree,
} from "./inventory-catalog.js?v=20260627_inventory_catalog";

// ── injected inventory.js internals (orchestrator / Table) ──────────────────
// Set by initInventoryOrders() from inventory.js to break the orchestrator<->
// orders import cycle.
let getSalonId, mountOrRefreshMockUi, _ffInvActiveLocId, _ffInvDocInActiveLoc, getSelectedSubMeta, isInvMobileNarrow, loadInventoryTableForSub, fetchSubcategoryInventoryDoc, findCategoryAndSubForSubId;
export function initInventoryOrders(deps) {
  ({
    getSalonId,
    mountOrRefreshMockUi,
    _ffInvActiveLocId,
    _ffInvDocInActiveLoc,
    getSelectedSubMeta,
    isInvMobileNarrow,
    loadInventoryTableForSub,
    fetchSubcategoryInventoryDoc,
    findCategoryAndSubForSubId,
  } = deps);
}

function isInvOrderDetailCommitBusy() {
  return invState._invOrderReceiveBusy || invState._invOrderPurchaseBusy || invState._invOrderInvPriceBusy;
}

/**
 * Resolve Firestore inventory cell coordinates from a saved order line (auto, linked, or legacy).
 * @returns {{ catId: string, subId: string, rowId: string, groupId: string } | null}
 */
function parseInventoryCellRefFromOrderLine(it) {
  if (!it || typeof it !== "object") return null;
  let catId = it.categoryId != null ? String(it.categoryId).trim() : "";
  let subId = it.subcategoryId != null ? String(it.subcategoryId).trim() : "";
  let groupId = it.groupId != null ? String(it.groupId).trim() : "";
  const iid = String(it.itemId ?? "").trim();
  const lid = String(it.linkedInventoryItemId ?? "").trim();
  for (const cand of [iid, lid]) {
    if (!cand || !cand.includes(":")) continue;
    const parts = cand.split(":");
    if (parts.length >= 3) {
      if (!subId) subId = parts[0] || "";
      if (!groupId) groupId = parts[parts.length - 1] || "";
    }
  }
  const rowId = parseRowIdFromInventoryItemId(iid || lid);
  if (!subId || !rowId || !groupId) return null;
  if (!catId) {
    const m = findCategoryAndSubForSubId(subId);
    if (m) catId = String(m.category.id);
  }
  if (!catId) return null;
  return { catId, subId, rowId, groupId };
}

/**
 * Persist a unit price from Order Details to the inventory subcategory row cell + mirror on the order line.
 */
async function commitOrderLineInventoryPrice(orderId, lineIdx, rawVal) {
  if (invState._invOrderInvPriceBusy) return;
  const o = invState._invOrdersList.find((x) => x.id === orderId);
  if (!o || !Array.isArray(o.items)) return;
  const it = o.items[lineIdx];
  if (!it || typeof it !== "object") return;
  const ref = parseInventoryCellRefFromOrderLine(it);
  if (!ref) {
    inventoryOrderDraftToast("This line is not linked to inventory.", "error");
    return;
  }
  const priceStr = String(rawVal ?? "").trim().replace(/,/g, "");
  if (priceStr === "") {
    inventoryOrderDraftToast("Enter a price.", "info");
    return;
  }
  const priceNum = parseNum(priceStr);
  if (!Number.isFinite(priceNum) || priceNum < 0) {
    inventoryOrderDraftToast("Invalid price.", "error");
    return;
  }
  const prevRaw = it.price != null ? String(it.price).replace(/,/g, "").trim() : "";
  if (prevRaw !== "" && Math.abs(parseNum(prevRaw) - priceNum) < 1e-9 && prevRaw === priceStr) {
    return;
  }

  const salonId = await getSalonId();
  if (!salonId) {
    inventoryOrderDraftToast("Could not resolve salon.", "error");
    return;
  }

  invState._invOrderInvPriceBusy = true;
  mountOrRefreshMockUi();
  try {
    const subRef = doc(
      db,
      `salons/${salonId}/inventoryCategories/${ref.catId}/inventorySubcategories/${ref.subId}`
    );
    const snap = await getDoc(subRef);
    if (!snap.exists()) throw new Error("SUB_MISSING");
    const data = snap.data();
    const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
    const rowsNorm = rowsRaw.map((raw) => normalizeRowFromFirestore(raw));
    const row = rowsNorm.find((r) => r.id === ref.rowId);
    if (!row) throw new Error("ROW_MISSING");
    const cell = row.byGroup[ref.groupId];
    if (!cell) throw new Error("CELL_MISSING");
    cell.price = priceStr;
    const rowsPayload = rowsNorm.map((r) => serializeInventoryRowForFirestore(r));
    await updateDoc(subRef, { rows: rowsPayload, updatedAt: serverTimestamp() });

    const orderRef = doc(db, `salons/${salonId}/inventoryOrders`, orderId);
    const ordSnap = await getDoc(orderRef);
    if (ordSnap.exists()) {
      const od = ordSnap.data();
      const itemsNext = Array.isArray(od.items)
        ? od.items.map((x) => (x && typeof x === "object" ? { ...x } : {}))
        : [];
      if (itemsNext[lineIdx]) {
        itemsNext[lineIdx] = { ...itemsNext[lineIdx], price: priceStr };
        await updateDoc(orderRef, { items: itemsNext, updatedAt: serverTimestamp() });
      }
    }

    const localO = invState._invOrdersList.find((x) => x.id === orderId);
    if (localO && Array.isArray(localO.items) && localO.items[lineIdx]) {
      localO.items[lineIdx] = { ...localO.items[lineIdx], price: priceStr };
    }
    inventoryOrderDraftToast("Inventory price updated.", "success");

    const meta = getSelectedSubMeta();
    if (meta && meta.category.id === ref.catId && meta.sub.id === ref.subId) {
      const key = `${ref.catId}:${ref.subId}`;
      if (invState._invTableLoadedForSubId === key) {
        const seq = ++invState._invTableLoadSeq;
        invState._invTableLoading = true;
        mountOrRefreshMockUi();
        void loadInventoryTableForSub(meta.category.id, meta.sub.id, seq, key);
      }
    }
  } catch (e) {
    console.error("[Inventory] order line inventory price failed", e);
    inventoryOrderDraftToast("Could not update inventory price.", "error");
  } finally {
    invState._invOrderInvPriceBusy = false;
    mountOrRefreshMockUi();
  }
}

function orderDetailLineMatchesFilter(it) {
  if (invState._invOrderDetailFilter === "all") return true;
  const { kind } = getOrderLineReceiveVisualState(it);
  if (invState._invOrderDetailFilter === "open") return kind === "open" || kind === "partial";
  if (invState._invOrderDetailFilter === "received") return kind === "received";
  return true;
}

function getOrderDetailDisplayPairsForExport(o) {
  const items = Array.isArray(o.items) ? o.items : [];
  const filteredPairs = items
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => orderDetailLineMatchesFilter(it));
  return sortOrderDetailPairsOpenFirst(filteredPairs);
}

function buildOrderDetailCsvContent(o) {
  const pairs = getOrderDetailDisplayPairsForExport(o);
  const st = o.status != null ? String(o.status) : "draft";
  const showExtra = st !== "draft" && Array.isArray(o.items) && o.items.length > 0;
  ensureShoppingDraft(o.id);
  const shop = invState._invOrderShoppingDraft[o.id];
  const header = showExtra
    ? ["Checked", "Item", "Code", "QTY", "Buy", "Recv total"]
    : ["Checked", "Item", "Code", "QTY", "Buy"];
  const lines = [header.map(escapeCsvCell).join(",")];
  for (const { it, idx } of pairs) {
    const ordQ = formatOrderDisplay(getItemOrderQty(it));
    const cumStr = formatOrderDisplay(getItemReceivedCumulative(it));
    const nm = it.itemName != null ? String(it.itemName) : "";
    const gLbl = getOrderItemGroupLabel(it);
    const itemCsv = gLbl ? `${nm}\n(${gLbl})` : nm;
    const cd = it.code != null ? String(it.code) : "";
    const chk = shop && shop.checked[idx] ? "Yes" : "";
    const qb = shop && shop.qtyBought[idx] != null ? String(shop.qtyBought[idx]) : "";
    if (showExtra) {
      lines.push([chk, itemCsv, cd, ordQ, qb, cumStr].map(escapeCsvCell).join(","));
    } else {
      lines.push([chk, itemCsv, cd, ordQ, qb].map(escapeCsvCell).join(","));
    }
  }
  return lines.join("\r\n");
}

function buildOrderDetailPrintDocumentHtml(o) {
  const src = formatInventoryOrderSourceLabel(o);
  const created = formatInventoryOrderCreatedAt(o.createdAt);
  const statusLabel = formatInventoryOrderStatusDisplay(o);
  const orderedAt = o.orderedAt ? formatInventoryOrderCreatedAt(o.orderedAt) : "";
  const orderedBy = o.orderedAt ? formatInventoryOrderOrderedByDisplay(o.orderedBy) : "";
  const n = typeof o.itemCount === "number" ? o.itemCount : Array.isArray(o.items) ? o.items.length : 0;
  const items = Array.isArray(o.items) ? o.items : [];
  const st = o.status != null ? String(o.status) : "draft";
  const showExtra = st !== "draft" && items.length > 0;
  const pairs = getOrderDetailDisplayPairsForExport(o);
  ensureShoppingDraft(o.id);
  const shop = invState._invOrderShoppingDraft[o.id];
  const title = getInventoryOrderDisplayName(o);
  let metaHtml = `<div class="meta">`;
  metaHtml += `<div><strong>Source:</strong> ${escapeHtml(src)}</div>`;
  metaHtml += `<div><strong>Status:</strong> ${escapeHtml(statusLabel)}</div>`;
  metaHtml += `<div><strong>Created:</strong> ${escapeHtml(created)}</div>`;
  if (orderedAt) {
    metaHtml += `<div><strong>Ordered:</strong> ${escapeHtml(orderedAt)}</div>`;
    metaHtml += `<div><strong>Ordered by:</strong> ${escapeHtml(orderedBy)}</div>`;
  }
  metaHtml += `<div><strong>Items:</strong> ${escapeHtml(String(n))}</div>`;
  metaHtml += `</div>`;
  let thead = "";
  let tbody = "";
  if (showExtra) {
    thead = `<thead><tr><th>✓</th><th>Item</th><th>Code</th><th>QTY</th><th>Buy</th><th>Recv total</th></tr></thead>`;
    for (const { it, idx } of pairs) {
      const ordQ = formatOrderDisplay(getItemOrderQty(it));
      const cumStr = formatOrderDisplay(getItemReceivedCumulative(it));
      const chk = shop && shop.checked[idx] ? "Yes" : "";
      const qb = shop && shop.qtyBought[idx] != null ? String(shop.qtyBought[idx]) : "";
      const gP = getOrderItemGroupLabel(it);
      const itemPrint =
        gP !== ""
          ? `<span class="print-item-name">${escapeHtml(it.itemName != null ? String(it.itemName) : "")}</span><span class="print-item-group">(${escapeHtml(gP)})</span>`
          : `<span class="print-item-name">${escapeHtml(it.itemName != null ? String(it.itemName) : "")}</span>`;
      tbody += `<tr>
  <td>${escapeHtml(chk)}</td>
  <td>${itemPrint}</td>
  <td>${escapeHtml(it.code != null ? String(it.code) : "")}</td>
  <td>${escapeHtml(ordQ)}</td>
  <td>${escapeHtml(qb)}</td>
  <td>${escapeHtml(cumStr)}</td>
</tr>`;
    }
  } else {
    thead = `<thead><tr><th>✓</th><th>Item</th><th>Code</th><th>QTY</th><th>Buy</th></tr></thead>`;
    for (const { it, idx } of pairs) {
      const ordQ = formatOrderDisplay(getItemOrderQty(it));
      const chk = shop && shop.checked[idx] ? "Yes" : "";
      const qb = shop && shop.qtyBought[idx] != null ? String(shop.qtyBought[idx]) : "";
      const gP = getOrderItemGroupLabel(it);
      const itemPrint =
        gP !== ""
          ? `<span class="print-item-name">${escapeHtml(it.itemName != null ? String(it.itemName) : "")}</span><span class="print-item-group">(${escapeHtml(gP)})</span>`
          : `<span class="print-item-name">${escapeHtml(it.itemName != null ? String(it.itemName) : "")}</span>`;
      tbody += `<tr>
  <td>${escapeHtml(chk)}</td>
  <td>${itemPrint}</td>
  <td>${escapeHtml(it.code != null ? String(it.code) : "")}</td>
  <td>${escapeHtml(ordQ)}</td>
  <td>${escapeHtml(qb)}</td>
</tr>`;
    }
  }
  const titleSafe = escapeHtml(title);
  const emptyColspan = showExtra ? 6 : 5;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${titleSafe}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0.4in; color: #0f172a; font-size: 12px; line-height: 1.4; }
  h1 { font-size: 18px; margin: 0 0 12px; font-weight: 700; }
  .meta { margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0; }
  .meta div { margin: 3px 0; }
  table { border-collapse: collapse; width: 100%; font-size: 11px; }
  th, td { border: 1px solid #cbd5e1; padding: 5px 7px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; font-weight: 600; color: #334155; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  @media print {
    body { margin: 0.25in; }
    th { background: #f8fafc !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  .print-item-name { display: block; font-weight: 400; color: #0f172a; }
  .print-item-group { display: block; font-size: 10px; font-weight: 400; color: #64748b; margin-top: 2px; line-height: 1.2; }
</style>
</head>
<body>
  <h1>${titleSafe}</h1>
  ${metaHtml}
  <table>
  ${thead}
  <tbody>${tbody ? tbody : `<tr><td colspan="${emptyColspan}">No lines match the current filter.</td></tr>`}</tbody>
  </table>
</body>
</html>`;
}

function triggerOrderDetailExportCsv() {
  if (isInvOrderDetailCommitBusy()) return;
  const id = invState._invOrdersDetailOrderId;
  if (!id) return;
  const o = invState._invOrdersList.find((x) => x.id === id);
  if (!o) return;
  const csv = `\ufeff${buildOrderDetailCsvContent(o)}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = getOrderDetailExportFilename(o);
  a.click();
  URL.revokeObjectURL(url);
}

function triggerOrderDetailPrint() {
  if (isInvOrderDetailCommitBusy()) return;
  const id = invState._invOrdersDetailOrderId;
  if (!id) return;
  const o = invState._invOrdersList.find((x) => x.id === id);
  if (!o) return;
  const html = buildOrderDetailPrintDocumentHtml(o);
  const w = window.open("", "_blank", "noopener,noreferrer");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    try {
      w.print();
    } catch (e) {
      /* ignore */
    }
    w.close();
  }, 200);
}

function ensureDetailReceiveDraft(orderId) {
  const o = invState._invOrdersList.find((x) => x.id === orderId);
  if (!o) return;
  const st = o.status != null ? String(o.status) : "draft";
  if (st !== "ordered" && st !== "partially_received") {
    delete invState._invDetailReceiveDraft[orderId];
    return;
  }
  const items = Array.isArray(o.items) ? o.items : [];
  const existing = invState._invDetailReceiveDraft[orderId];
  if (existing && existing.checked.length === items.length) return;
  const checked = items.map(() => false);
  const qty = items.map((it) => {
    const oq = getItemOrderQty(it);
    const cum = getItemReceivedCumulative(it);
    const rem = Math.max(0, oq - cum);
    return formatOrderDisplay(rem);
  });
  invState._invDetailReceiveDraft[orderId] = { checked, qty };
}

/**
 * Ensures local shopping-list state for Order Details (all statuses). Seeds from receive draft when present.
 * Local draft wins over Firestore when the user is editing; otherwise seeds qty/check from order.items (qtyBought, appliedToInventory).
 * @param {string} orderId
 */
function ensureShoppingDraft(orderId) {
  const o = invState._invOrdersList.find((x) => x.id === orderId);
  if (!o) return;
  const items = Array.isArray(o.items) ? o.items : [];
  const prev = invState._invOrderShoppingDraft[orderId];
  ensureDetailReceiveDraft(orderId);
  const recv = invState._invDetailReceiveDraft[orderId];
  const n = items.length;
  const checked = [];
  const qtyBought = [];
  for (let i = 0; i < n; i++) {
    const it = items[i];
    const storedQtyRaw =
      it && typeof it === "object" && it.qtyBought != null ? String(it.qtyBought).trim() : "";
    const applied = isItemPurchaseAppliedToInventory(it);

    const prevQtyRaw =
      prev && prev.qtyBought[i] != null ? String(prev.qtyBought[i]).trim() : "";
    const prevHadQty = prev && prev.qtyBought[i] !== undefined && prevQtyRaw !== "";
    const recvQtyRaw = recv && recv.qty[i] != null ? String(recv.qty[i]).trim() : "";

    if (prevHadQty) {
      qtyBought[i] = String(prev.qtyBought[i]);
    } else if (applied && storedQtyRaw !== "") {
      qtyBought[i] = storedQtyRaw;
    } else if (recvQtyRaw !== "") {
      qtyBought[i] = recvQtyRaw;
    } else if (storedQtyRaw !== "") {
      qtyBought[i] = storedQtyRaw;
    } else {
      qtyBought[i] = "";
    }

    if (applied) {
      checked[i] = true;
    } else if (prev && prev.checked[i] !== undefined) {
      checked[i] = !!prev.checked[i];
    } else if (recv && recv.checked[i] != null) {
      checked[i] = !!recv.checked[i];
    } else if (storedQtyRaw !== "") {
      checked[i] = parseNum(storedQtyRaw) > 0;
    } else {
      checked[i] = false;
    }
  }
  invState._invOrderShoppingDraft[orderId] = { checked, qtyBought };
}

function formatOrderDetailEstimatedCost(n) {
  const v = Number(n);
  const amount = Number.isFinite(v) ? v : 0;
  if (typeof window !== "undefined" && typeof window.ffFormatCurrency === "function") {
    return window.ffFormatCurrency(amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const r = Math.round(amount * 100) / 100;
  try {
    return r.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch (e) {
    return r.toFixed(2);
  }
}

/** Apply persisted user edits to auto-generated preview line quantities. */
function applyAutoQtyOverridesToLines(lines) {
  if (!Array.isArray(lines)) return lines;
  const ov = invState._invOrderBuilderAutoQtyOverrides;
  if (!ov || typeof ov !== "object") return lines;
  for (const line of lines) {
    if (!line || line.itemId == null) continue;
    const key = String(line.itemId);
    if (Object.prototype.hasOwnProperty.call(ov, key)) {
      const n = Number(ov[key]);
      if (Number.isFinite(n) && n >= 0) line.orderQty = n;
    }
  }
  return lines;
}

/** Drop override keys that no longer match any preview line (after category changes / refresh). */
function pruneAutoQtyOverridesToExistingLines(lines) {
  if (!Array.isArray(lines) || !invState._invOrderBuilderAutoQtyOverrides) return;
  const ids = new Set(
    lines.map((l) => (l && l.itemId != null ? String(l.itemId) : "")).filter(Boolean)
  );
  for (const k of Object.keys(invState._invOrderBuilderAutoQtyOverrides)) {
    if (!ids.has(k)) delete invState._invOrderBuilderAutoQtyOverrides[k];
  }
}

async function buildOrderPreviewLinesForSubIds(salonId, catId, subList, categoryName) {
  const subs = Array.isArray(subList) ? subList : [];
  const catNm = categoryName != null ? String(categoryName) : null;
  const tasks = subs.map(async (sub) => {
    const data = await fetchSubcategoryInventoryDoc(salonId, catId, sub.id);
    if (!data) return [];
    const { groups, rows } = parseSubcategoryDocToTable(data);
    return buildOrderLinesFromGroupsRows(groups, rows, sub.id, sub.name, catId, catNm);
  });
  const chunks = await Promise.all(tasks);
  return chunks.flat();
}

async function buildOrderPreviewLinesForCustomSubIds(salonId, subIds) {
  const ids = Array.isArray(subIds) ? subIds : [];
  const tasks = ids.map(async (sid) => {
    const m = findCategoryAndSubForSubId(sid);
    if (!m) return [];
    const data = await fetchSubcategoryInventoryDoc(salonId, m.category.id, sid);
    if (!data) return [];
    const { groups, rows } = parseSubcategoryDocToTable(data);
    return buildOrderLinesFromGroupsRows(
      groups,
      rows,
      m.sub.id,
      m.sub.name,
      m.category.id,
      m.category.name != null ? String(m.category.name) : null
    );
  });
  const chunks = await Promise.all(tasks);
  return chunks.flat();
}

function syncOrderBuilderPreviewFromCurrentSub() {
  const meta = getSelectedSubMeta();
  if (!meta || !invState._groups || !invState._rows) {
    invState._invOrderBuilderPreviewLines = [];
    pruneAutoQtyOverridesToExistingLines([]);
    invState._invOrderBuilderPreviewLoading = false;
    return;
  }
  const built = buildOrderLinesFromGroupsRows(
    invState._groups,
    invState._rows,
    meta.sub.id,
    meta.sub.name,
    meta.category.id,
    meta.category.name != null ? String(meta.category.name) : null
  );
  sortOrderBuilderLines(built);
  invState._invOrderBuilderPreviewLines = applyAutoQtyOverridesToLines(built);
  pruneAutoQtyOverridesToExistingLines(invState._invOrderBuilderPreviewLines);
  invState._invOrderBuilderPreviewLoading = false;
}

/** Make sure any category that contains a checked subcategory stays expanded so the selection is visible. */
function expandOrderBuilderCatsForCurrentSelection() {
  if (invState._invOrderBuilderCustomSubIds.size === 0) return;
  for (const c of getCategoryTree()) {
    const subs = c.subcategories || [];
    if (subs.some((s) => invState._invOrderBuilderCustomSubIds.has(s.id))) {
      invState._invOrderBuilderExpandedCatIds.add(c.id);
    }
  }
}

function prepareOrderBuilderPreviewForMount() {
  if (invState._invMainTab !== "orderBuilder") return;
}

async function refreshOrderBuilderPreviewAsync() {
  if (invState._invMainTab !== "orderBuilder") return;
  seedOrderBuilderSelectionIfEmpty();
  const seq = ++invState._invOrderBuilderPreviewSeq;
  invState._invOrderBuilderPreviewLoading = true;
  mountOrRefreshMockUi();
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    const ids = Array.from(invState._invOrderBuilderCustomSubIds);
    let lines = [];
    if (ids.length > 0) {
      lines = await buildOrderPreviewLinesForCustomSubIds(salonId, ids);
    }
    sortOrderBuilderLines(lines);
    if (seq !== invState._invOrderBuilderPreviewSeq) return;
    const merged = applyAutoQtyOverridesToLines(lines);
    invState._invOrderBuilderPreviewLines = merged;
    pruneAutoQtyOverridesToExistingLines(merged);
  } catch (e) {
    console.error("[Inventory] order builder preview failed", e);
    if (seq !== invState._invOrderBuilderPreviewSeq) return;
    invState._invOrderBuilderPreviewLines = [];
    pruneAutoQtyOverridesToExistingLines([]);
    inventoryOrderDraftToast("Could not load inventory for this selection.", "error");
  } finally {
    if (seq === invState._invOrderBuilderPreviewSeq) {
      invState._invOrderBuilderPreviewLoading = false;
      mountOrRefreshMockUi();
    }
  }
}

function renderOrderBuilderCustomTreeHtml() {
  const tree = getCategoryTree();
  if (!tree.length) {
    return `<p class="ff-inv2-ob-tree-empty">No categories yet.</p>`;
  }
  const parts = [];
  for (const c of tree) {
    const subs = c.subcategories || [];
    const isOpen = invState._invOrderBuilderExpandedCatIds.has(c.id);
    const someChecked = subs.length > 0 && subs.some((s) => invState._invOrderBuilderCustomSubIds.has(s.id));
    const allChecked = subs.length > 0 && subs.every((s) => invState._invOrderBuilderCustomSubIds.has(s.id));
    const subsHtml = subs.length
      ? subs
          .map((s) => {
            const checked = invState._invOrderBuilderCustomSubIds.has(s.id);
            return `<label class="ff-inv2-ob-sub-label">
  <input type="checkbox" data-inv-ob-sub="${escapeHtml(c.id)}:${escapeHtml(s.id)}"${checked ? " checked" : ""} />
  <span>${escapeHtml(s.name)}</span>
</label>`;
          })
          .join("")
      : `<span class="ff-inv2-ob-tree-empty">No subcategories</span>`;
    const countLabel = subs.length
      ? someChecked
        ? `${subs.filter((s) => invState._invOrderBuilderCustomSubIds.has(s.id)).length}/${subs.length}`
        : `${subs.length}`
      : "0";
    parts.push(`<div class="ff-inv2-ob-cat-block${isOpen ? " ff-inv2-ob-cat-block--open" : ""}" data-inv-ob-cat-block="${escapeHtml(c.id)}">
  <div class="ff-inv2-ob-cat-row">
    <button type="button" class="ff-inv2-ob-cat-toggle" data-inv-ob-cat-toggle="${escapeHtml(c.id)}" aria-expanded="${isOpen ? "true" : "false"}" aria-label="${isOpen ? "Collapse" : "Expand"} ${escapeHtml(c.name)}">
      <span class="ff-inv2-ob-cat-chev" aria-hidden="true">${isOpen ? "▾" : "▸"}</span>
    </button>
    <label class="ff-inv2-ob-cat-label">
      <input type="checkbox" data-inv-ob-cat="${escapeHtml(c.id)}"${allChecked ? " checked" : ""} />
      <span class="ff-inv2-ob-cat-name">${escapeHtml(c.name)}</span>
    </label>
    <span class="ff-inv2-ob-cat-count" aria-hidden="true">${escapeHtml(countLabel)}</span>
  </div>
  ${isOpen ? `<div class="ff-inv2-ob-subs">${subsHtml}</div>` : ""}
</div>`);
  }
  return `<div class="ff-inv2-ob-tree" role="group" aria-label="Subcategories">${parts.join("")}</div>`;
}

function renderOrderBuilderSourceHtml() {
  seedOrderBuilderSelectionIfEmpty();
  expandOrderBuilderCatsForCurrentSelection();
  if (!invState._invObPickPanelOpen) {
    return "";
  }
  const doneBtn = `<button type="button" class="ff-inv2-ob-mobile-done" data-inv-ob-mobile-collapse-source="1" aria-label="Done choosing categories">Done</button>`;
  return `<div class="ff-inv2-ob-source" id="ff-inv2-ob-source">
  <div class="ff-inv2-ob-source-top">
    <div class="ff-inv2-ob-source-copy">
  <p class="ff-inv2-ob-source-title">Create Order</p>
  <p class="ff-inv2-ob-source-hint">Pick categories or subcategories to include, then review below.</p>
    </div>
    ${doneBtn}
  </div>
  <div class="ff-inv2-ob-custom">${renderOrderBuilderCustomTreeHtml()}</div>
</div>`;
}

function syncOrderBuilderCategoryCheckboxIndeterminate(root) {
  root.querySelectorAll("[data-inv-ob-cat-block]").forEach((block) => {
    const catId = block.getAttribute("data-inv-ob-cat-block");
    if (!catId) return;
    const cat = getCategoryTree().find((c) => c.id === catId);
    if (!cat) return;
    const subs = cat.subcategories || [];
    const inp = block.querySelector("input[data-inv-ob-cat]");
    if (!(inp instanceof HTMLInputElement)) return;
    const checkedCount = subs.filter((s) => invState._invOrderBuilderCustomSubIds.has(s.id)).length;
    if (checkedCount === 0) {
      inp.checked = false;
      inp.indeterminate = false;
    } else if (subs.length && checkedCount === subs.length) {
      inp.checked = true;
      inp.indeterminate = false;
    } else {
      inp.checked = false;
      inp.indeterminate = true;
    }
  });
}

function inventoryOrderDraftToast(message, variant) {
  if (typeof window !== "undefined" && window.ffToast && typeof window.ffToast.show === "function") {
    window.ffToast.show(String(message), { variant: variant || "info", durationMs: 3800 });
  }
}

/** Fill category/subcategory on a preview line from the category tree when missing. */
function enrichOrderLineWithCategoryContext(L) {
  if (
    L.categoryId != null &&
    L.categoryName != null &&
    L.subcategoryId != null &&
    L.subcategoryName != null
  ) {
    return L;
  }
  const m = findCategoryAndSubForSubId(L.subcategoryId);
  if (!m) return L;
  return {
    ...L,
    categoryId: L.categoryId != null ? L.categoryId : m.category.id,
    categoryName:
      L.categoryName != null ? L.categoryName : m.category.name != null ? String(m.category.name) : null,
    subcategoryId: L.subcategoryId != null ? L.subcategoryId : m.sub.id,
    subcategoryName:
      L.subcategoryName != null ? L.subcategoryName : m.sub.name != null ? String(m.sub.name) : null,
  };
}

/**
 * Draft document source fields from current Order Builder mode (not sidebar alone).
 * @returns {{ sourceType: string, sourceSelection: object, categoryId: string | null, categoryName: string | null, subcategoryId: string | null, subcategoryName: string | null } | null}
 */
function buildInventoryOrderDraftSourcePayload() {
  const ids = Array.from(invState._invOrderBuilderCustomSubIds).sort();
  const categoryIdsSet = new Set();
  const subcategoryIds = [];
  const subcategoryNames = [];
  for (const sid of ids) {
    const m = findCategoryAndSubForSubId(sid);
    if (!m) continue;
    categoryIdsSet.add(m.category.id);
    subcategoryIds.push(m.sub.id);
    subcategoryNames.push(m.sub.name != null ? String(m.sub.name) : "");
  }
  const categoryIds = Array.from(categoryIdsSet).sort();
  const sourceSelection = {
    categoryIds,
    subcategoryIds,
    subcategoryNames,
  };
  let categoryId = null;
  let categoryName = null;
  if (categoryIds.length === 1) {
    const cat = getCategoryTree().find((c) => c.id === categoryIds[0]);
    categoryId = categoryIds[0];
    categoryName = cat && cat.name != null ? String(cat.name) : null;
  }
  return {
    sourceType: "custom",
    sourceSelection,
    categoryId,
    categoryName,
    subcategoryId: null,
    subcategoryName: null,
  };
}

async function saveInventoryOrderDraft() {
  if (invState._invSaveOrderDraftBusy) return;
  const autoLines = Array.isArray(invState._invOrderBuilderPreviewLines) ? invState._invOrderBuilderPreviewLines : [];
  const manualLines = Array.isArray(invState._invOrderBuilderManualLines) ? invState._invOrderBuilderManualLines : [];
  const linesRaw = [...autoLines, ...manualLines].filter((L) => {
    if (!L) return false;
    const q = typeof L.orderQty === "number" ? L.orderQty : parseNum(L.orderQty);
    return q > 0;
  });
  if (linesRaw.length === 0) return;
  const salonId = await getSalonId();
  if (!salonId) {
    inventoryOrderDraftToast("Could not resolve salon. Try again.", "error");
    return;
  }
  const src = buildInventoryOrderDraftSourcePayload();
  if (!src) {
    inventoryOrderDraftToast("Could not resolve order source. Try again.", "error");
    return;
  }
  const uid = auth.currentUser?.uid ? String(auth.currentUser.uid) : "";

  invState._invSaveOrderDraftBusy = true;
  mountOrRefreshMockUi();
  try {
    const lines = linesRaw.map((L) => (L && L.isManual ? L : enrichOrderLineWithCategoryContext(L)));
    const orderNameRaw = String(invState._invOrderSaveNameDraft ?? "").trim();
    const items = lines.map((L) => {
      if (L && L.isManual) {
        /** @type {Record<string, unknown>} */
        const out = {
          itemId: L.linkedInventoryItemId != null ? String(L.linkedInventoryItemId) : null,
          rowNo: null,
          code: L.code != null ? String(L.code) : null,
          itemName: L.itemName != null ? String(L.itemName) : "",
          supplier: null,
          url: null,
          groupId: L.groupId != null ? String(L.groupId) : null,
          groupName: L.groupName != null ? String(L.groupName) : null,
          orderQty: typeof L.orderQty === "number" ? L.orderQty : parseNum(L.orderQty),
          price: null,
          categoryId: L.categoryId != null ? String(L.categoryId) : null,
          categoryName: L.categoryName != null ? String(L.categoryName) : null,
          subcategoryId: L.subcategoryId != null ? String(L.subcategoryId) : null,
          subcategoryName: L.subcategoryName != null ? String(L.subcategoryName) : null,
          isManual: true,
        };
        if (L.linkedInventoryItemId != null) {
          out.linkedInventoryItemId = String(L.linkedInventoryItemId);
        }
        return out;
      }
      return {
        itemId: L.itemId,
        rowNo: L.rowNo,
        code: L.code,
        itemName: L.itemName,
        supplier: L.supplier,
        url: L.url,
        groupId: L.groupId,
        groupName: L.groupName,
        orderQty: L.orderQty,
        price: L.price,
        categoryId: L.categoryId != null ? String(L.categoryId) : null,
        categoryName: L.categoryName != null ? String(L.categoryName) : null,
        subcategoryId: L.subcategoryId != null ? String(L.subcategoryId) : null,
        subcategoryName: L.subcategoryName != null ? String(L.subcategoryName) : null,
      };
    });
    await addDoc(collection(db, `salons/${salonId}/inventoryOrders`), {
      status: "draft",
      ...(orderNameRaw !== "" ? { orderName: orderNameRaw } : {}),
      sourceType: src.sourceType,
      sourceSelection: src.sourceSelection,
      categoryId: src.categoryId,
      categoryName: src.categoryName,
      subcategoryId: src.subcategoryId,
      subcategoryName: src.subcategoryName,
      locationId: _ffInvActiveLocId() || null,
      createdAt: serverTimestamp(),
      createdBy: uid,
      itemCount: items.length,
      items,
    });
    // Clear the persistent active-draft doc so the next Create Order starts fresh.
    await clearInventoryOrderDraft();
    invState._invObPickPanelOpen = false;
    inventoryOrderDraftToast("Order saved", "success");
  } catch (e) {
    console.error("[Inventory] save order draft failed", e);
    inventoryOrderDraftToast("Could not save draft order. Try again.", "error");
  } finally {
    invState._invSaveOrderDraftBusy = false;
    mountOrRefreshMockUi();
  }
}

function renderOrderListSectionHtml() {
  const autoLines = Array.isArray(invState._invOrderBuilderPreviewLines) ? invState._invOrderBuilderPreviewLines : [];
  const manualLines = Array.isArray(invState._invOrderBuilderManualLines) ? invState._invOrderBuilderManualLines : [];
  const lines = [...autoLines, ...manualLines];
  const loading = invState._invOrderBuilderPreviewLoading;
  const hasRows = lines.length > 0;
  const busy = invState._invSaveOrderDraftBusy;
  // Always show Subcategory column — selections can span multiple subs now.
  const showSubCol = true;
  const saveDisabled = busy || loading || !hasRows;
  const saveBtn = hasRows && !loading
    ? `<button type="button" class="ff-inv2-btn" id="ff-inv2-save-order-draft"${saveDisabled ? " disabled" : ""}>${busy ? "Saving…" : "Save as Order"}</button>`
    : "";
  const addItemBtn = !loading
    ? `<button type="button" class="ff-inv2-btn ff-inv2-ob-add-item-btn" data-inv-ob-add-item="1"${busy ? " disabled" : ""}>+ Add Item</button>`
    : "";
  const nameInput = hasRows && !loading
    ? `<div class="ff-inv2-order-save-name-row">
  <label class="ff-inv2-order-save-name-label" for="ff-inv2-order-save-name">Order name</label>
  <input type="text" id="ff-inv2-order-save-name" class="ff-inv2-order-save-name-input" placeholder="e.g. Weekly restock" maxlength="120" value="${escapeHtml(invState._invOrderSaveNameDraft)}" data-inv-order-save-name-input="1" autocomplete="off" />
</div>`
    : "";
  const subTh = showSubCol ? `<th class="ff-inv2-ol-th">Subcategory</th>` : "";
  const rowsHtml = hasRows
    ? lines
        .map((l) => {
          const isManual = !!(l && l.isManual);
          if (isManual) {
            const lidEsc = escapeHtml(String(l.id ?? ""));
            const linkedBadge = l.linkedInventoryItemId
              ? ` <span class="ff-inv2-ol-linked-tag" title="Linked to inventory item">🔗</span>`
              : "";
            const nameHtml = `<span class="ff-inv2-ol-item-name">${escapeHtml(l.itemName)}</span>${linkedBadge} <span class="ff-inv2-ol-manual-tag">Manual</span>`;
            const removeBtn = `<button type="button" class="ff-inv2-ol-manual-remove" data-inv-ob-manual-remove="${lidEsc}" aria-label="Remove manual item" title="Remove">×</button>`;
            const subTd = showSubCol
              ? `<td class="ff-inv2-ol-td">${escapeHtml(l.subcategoryName != null ? String(l.subcategoryName) : "—")}</td>`
              : "";
            const qtyInputHtml = `<input type="number" min="1" step="1" class="ff-inv2-ol-qty-input" data-inv-ob-manual-qty="${lidEsc}" value="${escapeHtml(String(typeof l.orderQty === "number" ? l.orderQty : Number(l.orderQty) || 0))}" aria-label="Order qty" />`;
            return `<tr class="ff-inv2-ol-tr ff-inv2-ol-tr--manual">
  <td class="ff-inv2-ol-td">—</td>
  <td class="ff-inv2-ol-td">${escapeHtml(l.code != null && String(l.code) !== "" ? String(l.code) : "—")}</td>
  <td class="ff-inv2-ol-td">${nameHtml}</td>
  ${subTd}
  <td class="ff-inv2-ol-td">${escapeHtml(l.groupName != null && String(l.groupName) !== "" ? String(l.groupName) : "—")}</td>
  <td class="ff-inv2-ol-td ff-inv2-num ff-inv2-ol-td--qty">${qtyInputHtml}</td>
  <td class="ff-inv2-ol-td">—</td>
  <td class="ff-inv2-ol-td">—</td>
  <td class="ff-inv2-ol-td ff-inv2-ol-url-wrap">${removeBtn}</td>
</tr>`;
          }
          const subTd = showSubCol
            ? `<td class="ff-inv2-ol-td">${escapeHtml(l.subcategoryName != null ? String(l.subcategoryName) : "")}</td>`
            : "";
          const iidEsc = escapeHtml(String(l.itemId ?? ""));
          const oq =
            typeof l.orderQty === "number" ? l.orderQty : Number(l.orderQty) || 0;
          const qtyInputHtml = `<input type="number" min="0" step="1" class="ff-inv2-ol-qty-input" data-inv-ob-auto-qty="${iidEsc}" value="${escapeHtml(String(oq))}" aria-label="Order qty" />`;
          return `<tr>
  <td class="ff-inv2-ol-td">${escapeHtml(l.rowNo)}</td>
  <td class="ff-inv2-ol-td">${escapeHtml(l.code)}</td>
  <td class="ff-inv2-ol-td">${escapeHtml(l.itemName)}</td>
  ${subTd}
  <td class="ff-inv2-ol-td">${escapeHtml(l.groupName)}</td>
  <td class="ff-inv2-ol-td ff-inv2-num ff-inv2-ol-td--qty">${qtyInputHtml}</td>
  <td class="ff-inv2-ol-td">${escapeHtml(l.price)}</td>
  <td class="ff-inv2-ol-td">${escapeHtml(l.supplier)}</td>
  <td class="ff-inv2-ol-td ff-inv2-ol-url-wrap"><span class="ff-inv2-ol-url">${escapeHtml(l.url)}</span></td>
</tr>`;
        })
        .join("")
    : "";
  let body;
  if (loading) {
    body = `<p class="ff-inv2-order-list-loading">Loading inventory for the selected source…</p>`;
  } else if (hasRows) {
    const olSwipeHint = isInvMobileNarrow()
      ? `<p class="ff-inv2-order-list-table-hint" role="note">Swipe sideways to see Qty, Price, and other columns.</p>`
      : "";
    body = `<div class="ff-inv2-order-list-scroll"><table class="ff-inv2-order-list-table">
<thead><tr>
<th class="ff-inv2-ol-th">#</th>
<th class="ff-inv2-ol-th">Code</th>
<th class="ff-inv2-ol-th">Item</th>
${subTh}
<th class="ff-inv2-ol-th">Group</th>
<th class="ff-inv2-ol-th ff-inv2-ol-th--qty">Qty</th>
<th class="ff-inv2-ol-th">Price</th>
<th class="ff-inv2-ol-th">Supplier</th>
<th class="ff-inv2-ol-th">URL</th>
</tr></thead>
<tbody>${rowsHtml}</tbody>
</table></div>${olSwipeHint}`;
  } else {
    body = `<p class="ff-inv2-order-list-empty">No line items with positive order quantity (Stock − Current).</p>`;
  }
  // Banner: highlight how many manual items are in the active draft (so the user knows where Inbox-added items went).
  const manualCount = manualLines.length;
  const fromSuggestions = manualLines.filter((L) => L && L.fromSuggestionId).length;
  const draftBanner = manualCount > 0
    ? `<div class="ff-inv2-draft-banner" role="status">
  <span class="ff-inv2-draft-banner-icon" aria-hidden="true">📋</span>
  <span class="ff-inv2-draft-banner-text">
    <strong>${manualCount}</strong> item${manualCount === 1 ? "" : "s"} in your active draft${fromSuggestions > 0 ? ` · <strong>${fromSuggestions}</strong> from Inbox suggestions` : ""}
  </span>
</div>`
    : "";

  // Status chip next to the "Order list" title — always visible so the user sees it's a Draft with auto-save.
  const statusText = invState._invOrderDraftSaveStatus === "saving"
    ? "Saving…"
    : invState._invOrderDraftSaveStatus === "saved"
      ? "Saved"
      : "Auto-save enabled";
  const draftChipHtml = `<button type="button" class="ff-inv2-draft-chip ff-inv2-draft-chip--btn" aria-label="Open drafts list" data-inv-drafts-picker-open="1" title="View and switch drafts">
  <span class="ff-inv2-draft-chip-dot" aria-hidden="true"></span>
  <span class="ff-inv2-draft-chip-label">Draft</span>
  <span class="ff-inv2-draft-chip-sep" aria-hidden="true">·</span>
  <span class="ff-inv2-draft-chip-status" data-inv-draft-status data-state="${invState._invOrderDraftSaveStatus}">${escapeHtml(statusText)}</span>
  <span class="ff-inv2-draft-chip-caret" aria-hidden="true">▾</span>
</button>`;
  // New order list: starts a fresh draft, deactivating (but not deleting) the current one.
  const newDraftBtn = !loading
    ? `<button type="button" class="ff-inv2-draft-new-btn" data-inv-ob-new-draft="1"${busy ? " disabled" : ""} title="Start a new order list (current draft is kept under Drafts)">+START NEW ORDER LIST</button>`
    : "";

  return `<div class="ff-inv2-order-list-card">
  ${renderOrderBuilderSourceHtml()}
  ${draftBanner}
  <div class="ff-inv2-order-list-head">
    <div class="ff-inv2-order-list-title-row">
      <h3 class="ff-inv2-order-list-title">Order list</h3>
      ${draftChipHtml}
      ${newDraftBtn}
    </div>
    <div class="ff-inv2-order-list-head-actions">
      ${addItemBtn}
      ${saveBtn}
    </div>
  </div>
  ${nameInput}
  ${body}
</div>`;
}

/** Async: load items (row × group) for a subcategory for the link picker. */
async function loadLinkPickerItemsForSub(catId, subId) {
  if (!invState._invOrderBuilderAddModal) return;
  invState._invOrderBuilderAddModal.picker.items = null;
  invState._invOrderBuilderAddModal.picker.loading = true;
  invState._invOrderBuilderAddModal.picker.error = null;
  mountOrRefreshMockUi();
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    const m = findCategoryAndSubForSubId(subId);
    if (!m) throw new Error("Subcategory not found");
    const data = await fetchSubcategoryInventoryDoc(salonId, catId, subId);
    const { groups, rows } = data ? parseSubcategoryDocToTable(data) : { groups: [], rows: [] };
    const items = [];
    for (const row of rows) {
      if (!row || !row.byGroup) continue;
      const name = row.name != null ? String(row.name).trim() : "";
      if (name === "") continue;
      for (const g of groups) {
        items.push({
          id: `${subId}:${row.id}:${g.id}`,
          rowId: String(row.id),
          groupId: String(g.id),
          itemName: name,
          code: row.code != null ? String(row.code) : "",
          groupName: g.label != null ? String(g.label) : "",
          categoryId: String(catId),
          categoryName: m.category.name != null ? String(m.category.name) : "",
          subcategoryId: String(subId),
          subcategoryName: m.sub.name != null ? String(m.sub.name) : "",
        });
      }
    }
    if (!invState._invOrderBuilderAddModal) return;
    invState._invOrderBuilderAddModal.picker.items = items;
    invState._invOrderBuilderAddModal.picker.loading = false;
  } catch (e) {
    console.error("[Inventory] link picker load failed", e);
    if (!invState._invOrderBuilderAddModal) return;
    invState._invOrderBuilderAddModal.picker.items = [];
    invState._invOrderBuilderAddModal.picker.loading = false;
    invState._invOrderBuilderAddModal.picker.error = "Could not load items.";
  }
  mountOrRefreshMockUi();
}

function renderOrderBuilderLinkPickerHtml(modal) {
  const p = modal.picker;
  const tree = getCategoryTree();

  if (p.step === "category") {
    if (!Array.isArray(tree) || tree.length === 0) {
      return `<p class="ff-inv2-ob-link-hint">No categories yet.</p>`;
    }
    const items = tree
      .map((c) => {
        const subs = Array.isArray(c.subcategories) ? c.subcategories : [];
        return `<button type="button" class="ff-inv2-ob-link-option" data-inv-ob-add-link-step="subcategory" data-cat-id="${escapeHtml(String(c.id))}">
  <span class="ff-inv2-ob-link-option-name">${escapeHtml(c.name != null ? String(c.name) : "")}</span>
  <span class="ff-inv2-ob-link-option-meta">${subs.length} subcategor${subs.length === 1 ? "y" : "ies"}</span>
  <span class="ff-inv2-ob-link-option-chev" aria-hidden="true">›</span>
</button>`;
      })
      .join("");
    return `<div class="ff-inv2-ob-link-head"><span class="ff-inv2-ob-link-head-label">Pick a category</span></div>
<div class="ff-inv2-ob-link-list">${items}</div>`;
  }

  if (p.step === "subcategory") {
    const cat = tree.find((c) => String(c.id) === String(p.catId));
    const subs = cat && Array.isArray(cat.subcategories) ? cat.subcategories : [];
    const items = subs.length
      ? subs
          .map((s) => `<button type="button" class="ff-inv2-ob-link-option" data-inv-ob-add-link-step="items" data-sub-id="${escapeHtml(String(s.id))}">
  <span class="ff-inv2-ob-link-option-name">${escapeHtml(s.name != null ? String(s.name) : "")}</span>
  <span class="ff-inv2-ob-link-option-chev" aria-hidden="true">›</span>
</button>`)
          .join("")
      : `<p class="ff-inv2-ob-link-hint">No subcategories in this category.</p>`;
    return `<div class="ff-inv2-ob-link-head">
  <button type="button" class="ff-inv2-ob-link-back" data-inv-ob-add-link-step="category" aria-label="Back">‹ Back</button>
  <span class="ff-inv2-ob-link-head-label">${escapeHtml(cat && cat.name != null ? String(cat.name) : "")}</span>
</div>
${subs.length ? `<div class="ff-inv2-ob-link-list">${items}</div>` : items}`;
  }

  // items step
  const cat = tree.find((c) => String(c.id) === String(p.catId));
  const sub = cat && Array.isArray(cat.subcategories) ? cat.subcategories.find((s) => String(s.id) === String(p.subId)) : null;
  let body;
  if (p.loading) {
    body = `<p class="ff-inv2-ob-link-hint">Loading items…</p>`;
  } else if (p.error) {
    body = `<p class="ff-inv2-ob-link-hint">${escapeHtml(p.error)}</p>`;
  } else if (!Array.isArray(p.items) || p.items.length === 0) {
    body = `<p class="ff-inv2-ob-link-hint">No items in this subcategory.</p>`;
  } else {
    const rows = p.items
      .map((it) => {
        const codeLabel = it.code ? `${it.code} · ` : "";
        const grp = it.groupName ? ` (${it.groupName})` : "";
        return `<button type="button" class="ff-inv2-ob-link-option" data-inv-ob-add-link-select="${escapeHtml(String(it.id))}">
  <span class="ff-inv2-ob-link-option-name">${escapeHtml(it.itemName)}${escapeHtml(grp)}</span>
  <span class="ff-inv2-ob-link-option-meta">${escapeHtml(codeLabel)}${escapeHtml(it.subcategoryName != null ? String(it.subcategoryName) : "")}</span>
</button>`;
      })
      .join("");
    body = `<div class="ff-inv2-ob-link-list">${rows}</div>`;
  }
  return `<div class="ff-inv2-ob-link-head">
  <button type="button" class="ff-inv2-ob-link-back" data-inv-ob-add-link-step="subcategory" aria-label="Back">‹ Back</button>
  <span class="ff-inv2-ob-link-head-label">${escapeHtml(cat && cat.name != null ? String(cat.name) : "")} · ${escapeHtml(sub && sub.name != null ? String(sub.name) : "")}</span>
</div>
${body}`;
}

function renderInventoryOrderBuilderAddItemModal() {
  if (!invState._invOrderBuilderAddModal) return "";
  const m = invState._invOrderBuilderAddModal;
  const nameVal = escapeHtml(m.draftName);
  const qtyVal = escapeHtml(m.draftQty);
  const nameOk = String(m.draftName).trim() !== "";
  const qtyOk = parseNum(m.draftQty) > 0;
  const canAdd = nameOk && qtyOk;
  const hint = !nameOk
    ? "Enter an item name."
    : !qtyOk
      ? "Quantity must be greater than 0."
      : "";

  let linkBlockHtml;
  if (m.linkedItemId && m.linkedItemMeta) {
    const lm = m.linkedItemMeta;
    const labelParts = [lm.itemName];
    if (lm.groupName) labelParts.push(`(${lm.groupName})`);
    const subLabel = lm.subcategoryName ? `${lm.categoryName || ""} · ${lm.subcategoryName}` : "";
    linkBlockHtml = `<div class="ff-inv2-ob-link-selected">
  <div class="ff-inv2-ob-link-selected-text">
    <span class="ff-inv2-ob-link-selected-name">🔗 ${escapeHtml(labelParts.join(" "))}</span>
    ${subLabel ? `<span class="ff-inv2-ob-link-selected-sub">${escapeHtml(subLabel)}</span>` : ""}
  </div>
  <button type="button" class="ff-inv2-ob-link-clear" data-inv-ob-add-link-clear="1" aria-label="Clear link" title="Clear">×</button>
</div>`;
  } else {
    linkBlockHtml = `<div class="ff-inv2-ob-link-wrap">${renderOrderBuilderLinkPickerHtml(m)}</div>`;
  }

  return `<div class="ff-inv2-modal-backdrop" id="ff-inv-ob-add-item-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv-ob-add-item-title">
  <div class="ff-inv2-modal-card ff-inv2-ob-add-card">
    <h3 id="ff-inv-ob-add-item-title" class="ff-inv2-modal-title">Add item</h3>
    <label class="ff-inv2-modal-field">
      <span class="ff-inv2-modal-field-label">Item name</span>
      <input type="text" class="ff-inv2-modal-input" data-inv-ob-add-input="name" value="${nameVal}" placeholder="e.g. Hand soap" maxlength="120" autocomplete="off" />
    </label>
    <label class="ff-inv2-modal-field">
      <span class="ff-inv2-modal-field-label">Quantity</span>
      <input type="number" class="ff-inv2-modal-input" data-inv-ob-add-input="qty" value="${qtyVal}" placeholder="0" min="0" step="any" inputmode="decimal" autocomplete="off" />
    </label>
    <div class="ff-inv2-modal-field">
      <span class="ff-inv2-modal-field-label">Link to inventory item <span class="ff-inv2-modal-field-optional">(optional)</span></span>
      ${linkBlockHtml}
    </div>
    ${hint ? `<p class="ff-inv2-ob-add-hint">${escapeHtml(hint)}</p>` : ""}
    <div class="ff-inv2-modal-actions">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-inv-ob-add-cancel="1">Cancel</button>
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-primary" data-inv-ob-add-commit="1"${canAdd ? "" : " disabled"} title="${escapeHtml(hint || "Add item")}">Add</button>
    </div>
  </div>
</div>`;
}

function commitInventoryOrderBuilderAddItem() {
  if (!invState._invOrderBuilderAddModal) return;
  const m = invState._invOrderBuilderAddModal;
  const name = String(m.draftName ?? "").trim();
  const qty = parseNum(m.draftQty);
  if (!name || !(qty > 0)) return;
  const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  /** @type {Record<string, unknown>} */
  const entry = { id, itemName: name, orderQty: qty, isManual: true };
  if (m.linkedItemId && m.linkedItemMeta) {
    const lm = m.linkedItemMeta;
    entry.linkedInventoryItemId = m.linkedItemId;
    if (lm.code) entry.code = lm.code;
    if (lm.groupId) entry.groupId = lm.groupId;
    if (lm.groupName) entry.groupName = lm.groupName;
    if (lm.categoryId) entry.categoryId = lm.categoryId;
    if (lm.categoryName) entry.categoryName = lm.categoryName;
    if (lm.subcategoryId) entry.subcategoryId = lm.subcategoryId;
    if (lm.subcategoryName) entry.subcategoryName = lm.subcategoryName;
  }
  invState._invOrderBuilderManualLines.push(entry);
  invState._invOrderBuilderAddModal = null;
  scheduleInventoryOrderDraftSave();
  mountOrRefreshMockUi();
}

/**
 * Apply a draft doc snapshot into local state.
 * @param {string} docId Firestore doc id
 * @param {Record<string, unknown>} d Doc data
 */
function ffApplyDraftSnapshotToLocalState(docId, d) {
  invState._invActiveDraftId = docId;
  const rawManual = Array.isArray(d.manualItems) ? d.manualItems : [];
  invState._invOrderBuilderManualLines = rawManual
    .map(sanitizeManualItemForDraft)
    .filter((x) => x && x.itemName);
  invState._invOrderBuilderCustomSubIds = Array.isArray(d.selectedSubcategoryIds)
    ? new Set(d.selectedSubcategoryIds.map(String))
    : new Set();
  invState._invOrderBuilderAutoQtyOverrides = {};
  const rawOv = d.autoQtyOverrides;
  if (rawOv && typeof rawOv === "object" && !Array.isArray(rawOv)) {
    for (const [k, v] of Object.entries(rawOv)) {
      if (!k) continue;
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) invState._invOrderBuilderAutoQtyOverrides[k] = n;
    }
  }
  invState._invObPickPanelOpen = false;
  invState._invOrderSaveNameDraft = typeof d.orderName === "string" ? d.orderName : "";
  if (d.updatedAt && typeof d.updatedAt.toMillis === "function") {
    invState._invOrderDraftLastSavedAt = d.updatedAt.toMillis();
    invState._invOrderDraftSaveStatus = "saved";
  } else {
    invState._invOrderDraftLastSavedAt = 0;
    invState._invOrderDraftSaveStatus = "idle";
  }
}

/** Load the active Create Order draft from Firestore into local state. Called on tab entry. */
async function loadInventoryOrderDraft(forceReload) {
  if (invState._invOrderDraftLoading) return;
  if (invState._invOrderDraftLoaded && !forceReload) return;
  invState._invOrderDraftLoading = true;
  try {
    const salonId = await getSalonId();
    if (!salonId) return;

    // Find the active draft (any doc id) by the isActive flag.
    // Multi-branch salons may have one active draft per location, so we also
    // filter by the current locationId client-side after the query returns.
    let activeId = null;
    /** @type {Record<string, unknown> | null} */
    let activeData = null;
    try {
      const qActive = query(
        collection(db, `salons/${salonId}/inventoryDrafts`),
        where("isActive", "==", true)
      );
      const snap = await getDocs(qActive);
      if (!snap.empty) {
        const rows = snap.docs
          .map((d) => ({ id: d.id, data: d.data() }))
          .filter((r) => _ffInvDocInActiveLoc(r.data));
        if (rows.length > 0) {
          const first = rows[0];
          activeId = first.id;
          activeData = first.data;
        }
      }
    } catch (e) {
      console.warn("[Inventory] query active drafts failed", e);
    }

    // Legacy fallback: a doc pinned at id='active' from before multi-draft support.
    if (!activeId) {
      try {
        const legacyRef = doc(db, `salons/${salonId}/inventoryDrafts`, INVENTORY_LEGACY_DRAFT_DOC_ID);
        const legacySnap = await getDoc(legacyRef);
        if (legacySnap.exists()) {
          activeId = legacySnap.id;
          activeData = legacySnap.data();
          // Promote to isActive for future queries.
          try {
            await setDoc(legacyRef, { isActive: true, status: "draft" }, { merge: true });
          } catch (mErr) {
            console.warn("[Inventory] migrate legacy draft failed", mErr);
          }
        }
      } catch (e) {
        console.warn("[Inventory] legacy draft check failed", e);
      }
    }

    let loadedItemCount = 0;
    if (activeId && activeData) {
      ffApplyDraftSnapshotToLocalState(activeId, activeData);
      loadedItemCount = invState._invOrderBuilderManualLines.length;
    } else {
      // No draft found — keep local empty state. A new draft is created lazily on first write.
      invState._invActiveDraftId = null;
      invState._invOrderBuilderManualLines = [];
      invState._invOrderBuilderCustomSubIds = new Set();
      invState._invOrderBuilderAutoQtyOverrides = {};
      invState._invOrderSaveNameDraft = "";
      invState._invOrderDraftLastSavedAt = 0;
      invState._invOrderDraftSaveStatus = "idle";
    }

    invState._invOrderDraftLoaded = true;
    if (!invState._invOrderDraftResumeToastShown && loadedItemCount > 0) {
      invState._invOrderDraftResumeToastShown = true;
      inventoryOrderDraftToast(`Resumed unfinished draft · ${loadedItemCount} item${loadedItemCount === 1 ? "" : "s"}`, "info");
    }
    mountOrRefreshMockUi();
    void refreshOrderBuilderPreviewAsync();
  } catch (e) {
    console.error("[Inventory] load active draft failed", e && (e.code || e.message) ? (e.code || e.message) : e);
  } finally {
    invState._invOrderDraftLoading = false;
  }
}

/** Debounced save of the active draft. Called after every local mutation. */
function scheduleInventoryOrderDraftSave() {
  if (invState._invOrderDraftSaveTimer) {
    clearTimeout(invState._invOrderDraftSaveTimer);
    invState._invOrderDraftSaveTimer = null;
  }
  // Indicate pending save in the UI without re-rendering (we only re-render when the status actually flips).
  if (invState._invOrderDraftSaveStatus !== "saving") {
    invState._invOrderDraftSaveStatus = "saving";
    updateInventoryOrderDraftStatusIndicator();
  }
  invState._invOrderDraftSaveTimer = setTimeout(() => {
    invState._invOrderDraftSaveTimer = null;
    void flushInventoryOrderDraftSave();
  }, 600);
}

/** Update the Draft status chip in-place without re-rendering the whole Create Order tab. */
function updateInventoryOrderDraftStatusIndicator() {
  const el = document.querySelector("[data-inv-draft-status]");
  if (!(el instanceof HTMLElement)) return;
  const st = invState._invOrderDraftSaveStatus;
  el.setAttribute("data-state", st);
  if (st === "saving") el.textContent = "Saving…";
  else if (st === "saved") {
    const secs = invState._invOrderDraftLastSavedAt > 0
      ? Math.max(0, Math.round((Date.now() - invState._invOrderDraftLastSavedAt) / 1000))
      : null;
    el.textContent = secs != null && secs < 10 ? "Saved just now" : "Auto-saved";
  } else {
    el.textContent = "Auto-save enabled";
  }
}

/** Immediate write of current state to the active draft doc. Creates a new draft on first write. */
async function flushInventoryOrderDraftSave() {
  if (invState._invOrderDraftSaveTimer) {
    clearTimeout(invState._invOrderDraftSaveTimer);
    invState._invOrderDraftSaveTimer = null;
  }
  if (invState._invOrderDraftSaveInFlight) return;
  invState._invOrderDraftSaveInFlight = true;
  try {
    const salonId = await getSalonId();
    if (!salonId) return;
    const uid = auth.currentUser && auth.currentUser.uid ? String(auth.currentUser.uid) : null;
    const manualItems = invState._invOrderBuilderManualLines
      .map(sanitizeManualItemForDraft)
      .filter((x) => x && x.itemName);
    /** @type {Record<string, number>} */
    const autoQtyOverrides = {};
    if (invState._invOrderBuilderAutoQtyOverrides && typeof invState._invOrderBuilderAutoQtyOverrides === "object") {
      for (const [k, v] of Object.entries(invState._invOrderBuilderAutoQtyOverrides)) {
        if (!k) continue;
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) autoQtyOverrides[k] = n;
      }
    }
    const payload = {
      status: "draft",
      isActive: true,
      manualItems,
      selectedSubcategoryIds: Array.from(invState._invOrderBuilderCustomSubIds),
      orderName: String(invState._invOrderSaveNameDraft ?? ""),
      autoQtyOverrides,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    };
    if (invState._invActiveDraftId) {
      const ref = doc(db, `salons/${salonId}/inventoryDrafts`, invState._invActiveDraftId);
      await setDoc(ref, payload, { merge: true });
    } else {
      // First write — create the draft doc. Auto-id avoids collisions.
      const newRef = await addDoc(collection(db, `salons/${salonId}/inventoryDrafts`), {
        ...payload,
        locationId: _ffInvActiveLocId() || null,
        createdAt: serverTimestamp(),
        createdBy: uid,
      });
      invState._invActiveDraftId = newRef.id;
    }
    invState._invOrderDraftLastSavedAt = Date.now();
    invState._invOrderDraftSaveStatus = "saved";
    updateInventoryOrderDraftStatusIndicator();
  } catch (e) {
    console.warn("[Inventory] save active draft failed", e);
    invState._invOrderDraftSaveStatus = "idle";
    updateInventoryOrderDraftStatusIndicator();
  } finally {
    invState._invOrderDraftSaveInFlight = false;
  }
}

/** Modal listing all drafts — clicking the Draft chip opens this. */
function renderInventoryDraftsPickerModal() {
  if (!invState._invDraftsPicker.open) return "";
  let body;
  if (invState._invDraftsPicker.loading) {
    body = `<p class="ff-inv2-drafts-picker-empty">Loading…</p>`;
  } else if (invState._invDraftsPicker.error) {
    body = `<p class="ff-inv2-drafts-picker-empty">${escapeHtml(invState._invDraftsPicker.error)}</p>`;
  } else if (!invState._invDraftsPicker.drafts.length) {
    body = `<p class="ff-inv2-drafts-picker-empty">No drafts yet. Add an item to create one.</p>`;
  } else {
    body = `<ul class="ff-inv2-drafts-picker-list">${invState._invDraftsPicker.drafts.map(renderDraftsPickerRowHtml).join("")}</ul>`;
  }
  return `<div class="ff-inv2-modal-backdrop ff-inv2-drafts-picker-backdrop" data-inv-drafts-picker-close-backdrop="1" role="dialog" aria-modal="true" aria-labelledby="ff-inv2-drafts-picker-title">
  <div class="ff-inv2-modal-card ff-inv2-drafts-picker-card" data-inv-drafts-picker-card="1">
    <div class="ff-inv2-drafts-picker-head">
      <h3 id="ff-inv2-drafts-picker-title" class="ff-inv2-modal-title">Your drafts</h3>
      <button type="button" class="ff-inv2-drafts-picker-close" data-inv-drafts-picker-close="1" aria-label="Close">×</button>
    </div>
    <p class="ff-inv2-modal-hint">Switch between unfinished drafts or delete ones you don't need.</p>
    ${body}
    <div class="ff-inv2-modal-actions ff-inv2-drafts-picker-actions-row">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-inv-drafts-picker-close="1">Close</button>
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-primary" data-inv-drafts-picker-new="1">+ New draft</button>
    </div>
  </div>
</div>`;
}

/** Open the drafts picker and fetch the list. */
async function openInventoryDraftsPicker() {
  invState._invDraftsPicker = { open: true, loading: true, error: null, drafts: [] };
  mountOrRefreshMockUi();
  try {
    const salonId = await getSalonId();
    if (!salonId) {
      invState._invDraftsPicker.error = "No salon context";
      invState._invDraftsPicker.loading = false;
      mountOrRefreshMockUi();
      return;
    }
    const snap = await getDocs(collection(db, `salons/${salonId}/inventoryDrafts`));
    const drafts = [];
    snap.forEach((d) => {
      const data = d.data() || {};
      if (data.status === "cleared") return;
      if (!_ffInvDocInActiveLoc(data)) return;
      const manualItems = Array.isArray(data.manualItems) ? data.manualItems : [];
      drafts.push({
        id: d.id,
        isActive: data.isActive === true || d.id === invState._invActiveDraftId,
        manualItems,
        orderName: typeof data.orderName === "string" ? data.orderName : "",
        createdAt: data.createdAt && typeof data.createdAt.toMillis === "function" ? data.createdAt.toMillis() : 0,
        updatedAt: data.updatedAt && typeof data.updatedAt.toMillis === "function" ? data.updatedAt.toMillis() : 0,
      });
    });
    drafts.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    invState._invDraftsPicker = { open: true, loading: false, error: null, drafts };
    mountOrRefreshMockUi();
  } catch (e) {
    console.warn("[Inventory] drafts picker load failed", e);
    invState._invDraftsPicker = { open: true, loading: false, error: "Could not load drafts", drafts: [] };
    mountOrRefreshMockUi();
  }
}

function closeInventoryDraftsPicker() {
  invState._invDraftsPicker = { open: false, loading: false, error: null, drafts: [] };
  mountOrRefreshMockUi();
}

/** Switch the active draft to the given doc id. */
async function switchActiveInventoryDraft(draftId) {
  if (!draftId || draftId === invState._invActiveDraftId) {
    closeInventoryDraftsPicker();
    return;
  }
  if (invState._invOrderDraftSaveTimer) {
    await flushInventoryOrderDraftSave();
  }
  try {
    const salonId = await getSalonId();
    if (!salonId) return;
    const uid = auth.currentUser && auth.currentUser.uid ? String(auth.currentUser.uid) : null;
    // Deactivate current
    if (invState._invActiveDraftId && invState._invActiveDraftId !== draftId) {
      try {
        const oldRef = doc(db, `salons/${salonId}/inventoryDrafts`, invState._invActiveDraftId);
        await setDoc(
          oldRef,
          { isActive: false, updatedAt: serverTimestamp(), updatedBy: uid },
          { merge: true }
        );
      } catch (e) {
        console.warn("[Inventory] deactivate previous draft (switch) failed", e);
      }
    }
    // Activate the chosen one
    const newRef = doc(db, `salons/${salonId}/inventoryDrafts`, draftId);
    const snap = await getDoc(newRef);
    if (!snap.exists()) {
      inventoryOrderDraftToast("That draft is gone", "error");
      closeInventoryDraftsPicker();
      return;
    }
    await setDoc(
      newRef,
      { isActive: true, updatedAt: serverTimestamp(), updatedBy: uid },
      { merge: true }
    );
    ffApplyDraftSnapshotToLocalState(draftId, snap.data() || {});
    invState._invOrderDraftLoaded = true;
    invState._invOrderDraftResumeToastShown = true;
    inventoryOrderDraftToast("Switched draft", "info");
    closeInventoryDraftsPicker();
    void refreshOrderBuilderPreviewAsync();
  } catch (e) {
    console.error("[Inventory] switchActiveInventoryDraft failed", e);
    inventoryOrderDraftToast("Could not switch draft", "error");
  }
}

/** Delete a draft from Firestore. If it was the active one, reset local state. */
async function deleteInventoryDraftFromPicker(draftId) {
  if (!draftId) return;
  try {
    const salonId = await getSalonId();
    if (!salonId) return;
    const ref = doc(db, `salons/${salonId}/inventoryDrafts`, draftId);
    await deleteDoc(ref);
    if (draftId === invState._invActiveDraftId) {
      invState._invActiveDraftId = null;
      invState._invOrderBuilderManualLines = [];
      invState._invOrderBuilderCustomSubIds = new Set();
      invState._invOrderBuilderAutoQtyOverrides = {};
      invState._invOrderSaveNameDraft = "";
      invState._invOrderDraftLastSavedAt = 0;
      invState._invOrderDraftSaveStatus = "idle";
    }
    inventoryOrderDraftToast("Draft deleted", "success");
    // Refresh list in place
    void openInventoryDraftsPicker();
    void refreshOrderBuilderPreviewAsync();
  } catch (e) {
    console.error("[Inventory] delete draft failed", e);
    inventoryOrderDraftToast("Could not delete draft", "error");
  }
}

/**
 * Start a fresh draft: deactivate the current one (if any) so it remains in Firestore
 * as a non-active draft, and clear local state. A new Firestore doc is created lazily
 * on the first mutation via flushInventoryOrderDraftSave().
 */
async function createNewInventoryOrderDraft() {
  // Flush any pending save so we don't clobber the soon-to-be-deactivated draft.
  if (invState._invOrderDraftSaveTimer) {
    await flushInventoryOrderDraftSave();
  }
  try {
    const salonId = await getSalonId();
    if (salonId && invState._invActiveDraftId) {
      const uid = auth.currentUser && auth.currentUser.uid ? String(auth.currentUser.uid) : null;
      const oldRef = doc(db, `salons/${salonId}/inventoryDrafts`, invState._invActiveDraftId);
      await setDoc(
        oldRef,
        { isActive: false, updatedAt: serverTimestamp(), updatedBy: uid },
        { merge: true }
      );
    }
  } catch (e) {
    console.warn("[Inventory] deactivate previous draft failed", e);
  }
  // Reset local state. New draft doc will be created on first mutation.
  invState._invActiveDraftId = null;
  invState._invOrderBuilderManualLines = [];
  invState._invOrderBuilderCustomSubIds = new Set();
  invState._invOrderBuilderAutoQtyOverrides = {};
  invState._invOrderSaveNameDraft = "";
  invState._invOrderDraftLastSavedAt = 0;
  invState._invOrderDraftSaveStatus = "idle";
  invState._invOrderDraftResumeToastShown = true;
  invState._invOrderDraftLoaded = true;
  invState._invOrderBuilderExpandedCatIds = new Set();
  invState._invObPickPanelOpen = true;
  inventoryOrderDraftToast("Started a new draft", "info");
  mountOrRefreshMockUi();
  void refreshOrderBuilderPreviewAsync();
  try {
    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(() => {
        const root = document.getElementById("inventoryScreen");
        const el = root && root.querySelector("#ff-inv2-ob-source");
        if (el && typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    }
  } catch (_) {
    /* ignore */
  }
}

/** Remove the active draft entirely (after Save as Order). Other drafts are untouched. */
async function clearInventoryOrderDraft() {
  const draftIdToDelete = invState._invActiveDraftId;
  invState._invOrderBuilderManualLines = [];
  invState._invOrderBuilderCustomSubIds = new Set();
  invState._invOrderBuilderAutoQtyOverrides = {};
  invState._invOrderSaveNameDraft = "";
  invState._invActiveDraftId = null;
  invState._invOrderDraftLastSavedAt = 0;
  invState._invOrderDraftSaveStatus = "idle";
  invState._invOrderDraftLoaded = true;
  if (invState._invOrderDraftSaveTimer) {
    clearTimeout(invState._invOrderDraftSaveTimer);
    invState._invOrderDraftSaveTimer = null;
  }
  if (!draftIdToDelete) return;
  try {
    const salonId = await getSalonId();
    if (!salonId) return;
    const ref = doc(db, `salons/${salonId}/inventoryDrafts`, draftIdToDelete);
    await deleteDoc(ref).catch((e) => {
      console.warn("[Inventory] clear draft delete failed; falling back to empty overwrite", e);
      return setDoc(
        ref,
        {
          status: "cleared",
          isActive: false,
          manualItems: [],
          selectedSubcategoryIds: [],
          orderName: "",
          autoQtyOverrides: {},
          updatedAt: serverTimestamp(),
        },
        { merge: false }
      );
    });
  } catch (e) {
    console.warn("[Inventory] clear active draft failed", e);
  }
}

function orderMatchesInventoryStatusFilter(o) {
  if (invState._invOrdersStatusFilter === "all") return true;
  return getInventoryOrderStatusKey(o) === invState._invOrdersStatusFilter;
}

function orderMatchesInventorySearchQuery(o) {
  const q = invState._invOrdersSearchQuery.trim().toLowerCase();
  if (!q) return true;
  return getOrderSearchHaystack(o).includes(q);
}

/**
 * @param {{ silent?: boolean } | undefined} opts
 * If silent, skip full-screen loading state (e.g. after duplicate/delete).
 */
async function loadInventoryOrdersList(opts) {
  const silent = opts && opts.silent === true;
  if (!silent) {
    invState._invOrdersLoading = true;
    invState._invOrdersLoadError = null;
    mountOrRefreshMockUi();
  }
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    const q = query(collection(db, `salons/${salonId}/inventoryOrders`), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    invState._invOrdersList = snap.docs
      .map((d) => {
        const x = d.data();
        return { id: d.id, ...x };
      })
      .filter(_ffInvDocInActiveLoc);
    invState._invOrdersLoadError = null;
  } catch (e) {
    console.error("[Inventory] orders list load failed", e);
    if (silent) {
      inventoryOrderDraftToast("Could not refresh orders.", "error");
    } else {
      invState._invOrdersLoadError = (e && e.message) || "Failed to load orders";
      invState._invOrdersList = [];
    }
  } finally {
    invState._invOrdersLoading = false;
    mountOrRefreshMockUi();
  }
}

async function duplicateInventoryOrderDraft(orderId) {
  const o = invState._invOrdersList.find((x) => x.id === orderId);
  if (!o) {
    inventoryOrderDraftToast("Order not found.", "error");
    return;
  }
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    const uid = auth.currentUser?.uid ? String(auth.currentUser.uid) : "";
    const rawItems = Array.isArray(o.items) ? o.items : [];
    const items = rawItems.map((it) => {
      if (!it || typeof it !== "object") return it;
      const { receivedCumulative: _rc, qtyBought: _qb, appliedToInventory: _ai, appliedAt: _aa, ...rest } = it;
      return rest;
    });
    const itemCount = typeof o.itemCount === "number" ? o.itemCount : items.length;
    const sourceSelection = clonePlainForFirestoreOrderPayload(o.sourceSelection);
    const dupName =
      o.orderName != null && String(o.orderName).trim() !== ""
        ? `${String(o.orderName).trim()} (copy)`
        : null;
    await addDoc(collection(db, `salons/${salonId}/inventoryOrders`), {
      status: "draft",
      ...(dupName ? { orderName: dupName } : {}),
      sourceType: o.sourceType ?? null,
      sourceSelection: sourceSelection != null ? sourceSelection : null,
      categoryId: o.categoryId ?? null,
      categoryName: o.categoryName ?? null,
      subcategoryId: o.subcategoryId ?? null,
      subcategoryName: o.subcategoryName ?? null,
      locationId: _ffInvActiveLocId() || (typeof o.locationId === "string" ? o.locationId : null),
      itemCount,
      items,
      createdAt: serverTimestamp(),
      createdBy: uid,
      copiedFromOrderId: orderId,
    });
    inventoryOrderDraftToast("Order duplicated.", "success");
    void loadInventoryOrdersList({ silent: true });
  } catch (e) {
    console.error("[Inventory] duplicate order failed", e);
    inventoryOrderDraftToast("Could not duplicate order.", "error");
  }
}

async function deleteInventoryOrderDraftConfirmed(orderId) {
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    await deleteDoc(doc(db, `salons/${salonId}/inventoryOrders`, orderId));
    invState._invOrdersDeleteConfirmOrderId = null;
    delete invState._invOrderReceiptUploadFieldsByOrderId[orderId];
    delete invState._invOrderShoppingDraft[orderId];
    if (invState._invReceiptInfoModalOrderId === orderId) invState._invReceiptInfoModalOrderId = null;
    if (invState._invOrdersDetailOrderId === orderId) {
      invState._invOrdersDetailOrderId = null;
      invState._invOrderDetailLineViewIdx = null;
    }
    if (invState._invOrdersMenu && invState._invOrdersMenu.orderId === orderId) invState._invOrdersMenu = null;
    inventoryOrderDraftToast("Order deleted.", "success");
    void loadInventoryOrdersList({ silent: true });
  } catch (e) {
    console.error("[Inventory] delete order failed", e);
    inventoryOrderDraftToast("Could not delete order.", "error");
  }
}

async function markInventoryOrderOrderedConfirmed(orderId) {
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    const uid = auth.currentUser?.uid ? String(auth.currentUser.uid) : "";
    const ref = doc(db, `salons/${salonId}/inventoryOrders`, orderId);
    await updateDoc(ref, {
      status: "ordered",
      orderedAt: serverTimestamp(),
      orderedBy: uid,
    });
    invState._invOrdersMarkOrderedConfirmOrderId = null;
    if (invState._invOrdersMenu && invState._invOrdersMenu.orderId === orderId) invState._invOrdersMenu = null;
    inventoryOrderDraftToast("Order marked as ordered.", "success");
    void loadInventoryOrdersList({ silent: true });
  } catch (e) {
    console.error("[Inventory] mark ordered failed", e);
    inventoryOrderDraftToast("Could not update order.", "error");
  }
}

/**
 * Confirm receive from Order Details: checked lines only; updates `items[].receivedCumulative`, status, inventory `current`.
 * @param {string} orderId
 */
async function confirmInventoryOrderReceived(orderId) {
  if (invState._invOrderReceiveBusy || invState._invOrderPurchaseBusy) return;
  ensureShoppingDraft(orderId);
  const shop = invState._invOrderShoppingDraft[orderId];
  const o = invState._invOrdersList.find((x) => x.id === orderId);
  if (!o) {
    inventoryOrderDraftToast("Order not found.", "error");
    return;
  }
  const ost = o.status != null ? String(o.status) : "draft";
  if (ost !== "ordered" && ost !== "partially_received") {
    inventoryOrderDraftToast("This order cannot receive inventory from here.", "error");
    return;
  }
  const items = Array.isArray(o.items) ? o.items : [];
  if (!shop || items.length === 0) {
    inventoryOrderDraftToast("Nothing to receive.", "error");
    return;
  }
  let hasLine = false;
  for (let i = 0; i < items.length; i++) {
    if (!shop.checked[i]) continue;
    if (parseNum(shop.qtyBought[i]) !== 0) hasLine = true;
  }
  if (!hasLine) {
    inventoryOrderDraftToast("Select at least one line and enter a non-zero quantity.", "error");
    return;
  }

  const checked = shop.checked.slice();
  const qtyDraft = shop.qtyBought.map((q) => String(q ?? ""));

  const salonId = await getSalonId();
  if (!salonId) {
    inventoryOrderDraftToast("Could not resolve salon. Try again.", "error");
    return;
  }
  const uid = auth.currentUser?.uid ? String(auth.currentUser.uid) : "";
  const orderRef = doc(db, `salons/${salonId}/inventoryOrders`, orderId);

  invState._invOrderReceiveBusy = true;
  mountOrRefreshMockUi();
  const affectedSubs = new Set();
  try {
    await runTransaction(db, async (transaction) => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists()) throw new Error("ORDER_MISSING");
      const ordData = orderSnap.data();
      const curSt = ordData.status != null ? String(ordData.status) : "draft";
      if (curSt !== "ordered" && curSt !== "partially_received") {
        throw new Error("ORDER_BAD_STATUS");
      }

      const itemsFromDb = Array.isArray(ordData.items) ? ordData.items : [];
      const nextItems = itemsFromDb.map((it) => (it && typeof it === "object" ? { ...it } : {}));

      /** @type {{ catId: string, subId: string, rowId: string, groupId: string, qty: number }[]} */
      const deltas = [];
      for (let i = 0; i < nextItems.length; i++) {
        if (!checked[i]) continue;
        const add = parseNum(qtyDraft[i]);
        if (add === 0) continue;
        const it = itemsFromDb[i];
        if (!it || typeof it !== "object") continue;
        const prev = getItemReceivedCumulative(it);
        nextItems[i] = { ...nextItems[i], receivedCumulative: prev + add };
        const catId = it.categoryId != null ? String(it.categoryId).trim() : "";
        const subId = it.subcategoryId != null ? String(it.subcategoryId).trim() : "";
        const rowId = parseRowIdFromInventoryItemId(it.itemId);
        const groupId = it.groupId != null ? String(it.groupId).trim() : "";
        if (!catId || !subId || !rowId || !groupId) continue;
        deltas.push({ catId, subId, rowId, groupId, qty: add });
      }

      const newStatus = computeReceiveStatusFromItems(nextItems);

      const subDocMap = new Map();
      for (const d of deltas) {
        const key = `${d.catId}:${d.subId}`;
        let entry = subDocMap.get(key);
        if (!entry) {
          entry = {
            ref: doc(db, `salons/${salonId}/inventoryCategories/${d.catId}/inventorySubcategories/${d.subId}`),
            catId: d.catId,
            subId: d.subId,
            deltas: [],
          };
          subDocMap.set(key, entry);
        }
        entry.deltas.push(d);
      }

      const subReads = [];
      for (const [, entry] of subDocMap) {
        const snap = await transaction.get(entry.ref);
        subReads.push({ entry, snap });
      }

      for (const { entry, snap } of subReads) {
        if (!snap.exists()) continue;
        const data = snap.data();
        const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
        const rowsNorm = rowsRaw.map((raw) => normalizeRowFromFirestore(raw));
        let changed = false;
        for (const d of entry.deltas) {
          const row = rowsNorm.find((r) => r.id === d.rowId);
          if (!row) continue;
          const cell = row.byGroup[d.groupId];
          if (!cell) continue;
          cell.current = parseNum(cell.current) + d.qty;
          changed = true;
        }
        if (changed) {
          const rowsPayload = rowsNorm.map((r) => serializeInventoryRowForFirestore(r));
          transaction.update(entry.ref, {
            rows: rowsPayload,
            updatedAt: serverTimestamp(),
          });
          affectedSubs.add(`${entry.catId}:${entry.subId}`);
        }
      }

      /** @type {Record<string, unknown>} */
      const orderUpdate = {
        items: nextItems,
        status: newStatus,
        lastReceiveAt: serverTimestamp(),
        lastReceiveBy: uid,
      };
      if (newStatus === "received" && curSt !== "received") {
        orderUpdate.receivedAt = serverTimestamp();
        orderUpdate.receivedBy = uid;
      }
      transaction.update(orderRef, orderUpdate);
    });

    delete invState._invOrderShoppingDraft[orderId];
    inventoryOrderDraftToast("Receive recorded.", "success");
    void loadInventoryOrdersList({ silent: true });

    const meta = getSelectedSubMeta();
    if (meta && affectedSubs.has(`${meta.category.id}:${meta.sub.id}`)) {
      const key = `${meta.category.id}:${meta.sub.id}`;
      if (invState._invTableLoadedForSubId === key) {
        const seq = ++invState._invTableLoadSeq;
        invState._invTableLoading = true;
        mountOrRefreshMockUi();
        void loadInventoryTableForSub(meta.category.id, meta.sub.id, seq, key);
      }
    }
  } catch (e) {
    console.error("[Inventory] receive order failed", e);
    const code = e && typeof e.message === "string" ? e.message : "";
    if (code === "ORDER_BAD_STATUS") {
      inventoryOrderDraftToast("This order was already updated. Refresh and try again.", "error");
    } else if (code === "ORDER_MISSING") {
      inventoryOrderDraftToast("Order no longer exists.", "error");
    } else {
      inventoryOrderDraftToast("Could not record receive. Try again.", "error");
    }
  } finally {
    invState._invOrderReceiveBusy = false;
    mountOrRefreshMockUi();
  }
}

/**
 * Draft orders only: apply shopping-list "Qty bought" to inventory `current` + persist qtyBought / appliedToInventory on order lines.
 * Skips inventory when already applied and qty unchanged; applies delta when qty changed after apply.
 * @param {string} orderId
 */
async function confirmInventoryOrderPurchase(orderId) {
  if (invState._invOrderPurchaseBusy || invState._invOrderReceiveBusy) return;
  ensureShoppingDraft(orderId);
  const shop = invState._invOrderShoppingDraft[orderId];
  const o = invState._invOrdersList.find((x) => x.id === orderId);
  if (!o) {
    inventoryOrderDraftToast("Order not found.", "error");
    return;
  }
  const items = Array.isArray(o.items) ? o.items : [];
  if (!shop || items.length === 0) {
    inventoryOrderDraftToast("Nothing to apply.", "error");
    return;
  }

  const salonId = await getSalonId();
  if (!salonId) {
    inventoryOrderDraftToast("Could not resolve salon. Try again.", "error");
    return;
  }

  const orderRef = doc(db, `salons/${salonId}/inventoryOrders`, orderId);
  invState._invOrderPurchaseBusy = true;
  mountOrRefreshMockUi();
  const affectedSubs = new Set();
  try {
    await runTransaction(db, async (transaction) => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists()) throw new Error("ORDER_MISSING");
      const ordData = orderSnap.data();

      const itemsFromDb = Array.isArray(ordData.items) ? ordData.items : [];
      const nextItems = itemsFromDb.map((it) => (it && typeof it === "object" ? { ...it } : {}));

      /** @type {{ lineIndex: number, uiQty: number, invDelta: number, catId: string, subId: string, rowId: string, groupId: string }[]} */
      const pending = [];

      const nLines = nextItems.length;
      for (let i = 0; i < nLines; i++) {
        const uiQty = parseNum(shop.qtyBought[i]);
        const it = nextItems[i];
        if (!it || typeof it !== "object") continue;
        if (uiQty <= 0) continue;

        const oldQty = it.qtyBought != null ? parseNum(it.qtyBought) : 0;
        const applied = it.appliedToInventory === true;

        let invDelta = 0;
        if (!applied) {
          invDelta = uiQty;
        } else if (uiQty !== oldQty) {
          invDelta = uiQty - oldQty;
        } else {
          continue;
        }
        if (invDelta === 0) continue;

        const catId = it.categoryId != null ? String(it.categoryId).trim() : "";
        const subId = it.subcategoryId != null ? String(it.subcategoryId).trim() : "";
        const rowId = parseRowIdFromInventoryItemId(it.itemId);
        const groupId = it.groupId != null ? String(it.groupId).trim() : "";
        if (!catId || !subId || !rowId || !groupId) continue;

        pending.push({ lineIndex: i, uiQty, invDelta, catId, subId, rowId, groupId });
      }

      if (pending.length === 0) {
        throw new Error("NO_PURCHASE_CHANGES");
      }

      const subDocMap = new Map();
      for (const p of pending) {
        const key = `${p.catId}:${p.subId}`;
        let entry = subDocMap.get(key);
        if (!entry) {
          entry = {
            ref: doc(db, `salons/${salonId}/inventoryCategories/${p.catId}/inventorySubcategories/${p.subId}`),
            catId: p.catId,
            subId: p.subId,
            pending: [],
          };
          subDocMap.set(key, entry);
        }
        entry.pending.push(p);
      }

      /** @type {Map<string, { rowsNorm: ReturnType<typeof normalizeRowFromFirestore>[] }>} */
      const subRowsByKey = new Map();
      for (const [, entry] of subDocMap) {
        const snap = await transaction.get(entry.ref);
        const key = `${entry.catId}:${entry.subId}`;
        if (!snap.exists()) {
          throw new Error("SUB_MISSING");
        }
        const data = snap.data();
        const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
        const rowsNorm = rowsRaw.map((raw) => normalizeRowFromFirestore(raw));
        subRowsByKey.set(key, { rowsNorm });
      }

      for (const p of pending) {
        const key = `${p.catId}:${p.subId}`;
        const pack = subRowsByKey.get(key);
        if (!pack) throw new Error("INV_LINE_MISSING");
        const row = pack.rowsNorm.find((r) => r.id === p.rowId);
        const cell = row && row.byGroup[p.groupId];
        if (!row || !cell) {
          throw new Error("INV_LINE_MISSING");
        }
      }

      for (const [, entry] of subDocMap) {
        const key = `${entry.catId}:${entry.subId}`;
        const pack = subRowsByKey.get(key);
        if (!pack) continue;
        const { rowsNorm } = pack;
        let changed = false;
        for (const p of entry.pending) {
          const row = rowsNorm.find((r) => r.id === p.rowId);
          if (!row) continue;
          const cell = row.byGroup[p.groupId];
          if (!cell) continue;
          cell.current = parseNum(cell.current) + p.invDelta;
          changed = true;
        }
        if (changed) {
          const rowsPayload = rowsNorm.map((r) => serializeInventoryRowForFirestore(r));
          transaction.update(entry.ref, {
            rows: rowsPayload,
            updatedAt: serverTimestamp(),
          });
          affectedSubs.add(`${entry.catId}:${entry.subId}`);
        }
      }

      const appliedAtTs = Timestamp.now();
      for (const p of pending) {
        nextItems[p.lineIndex] = {
          ...nextItems[p.lineIndex],
          qtyBought: p.uiQty,
          appliedToInventory: true,
          appliedAt: appliedAtTs,
        };
      }

      transaction.update(orderRef, { items: nextItems });
    });

    delete invState._invOrderShoppingDraft[orderId];
    delete invState._invDetailReceiveDraft[orderId];
    inventoryOrderDraftToast("Inventory updated", "success");
    await loadInventoryOrdersList({ silent: true });
    delete invState._invOrderShoppingDraft[orderId];

    const meta = getSelectedSubMeta();
    if (meta && affectedSubs.has(`${meta.category.id}:${meta.sub.id}`)) {
      const key = `${meta.category.id}:${meta.sub.id}`;
      if (invState._invTableLoadedForSubId === key) {
        const seq = ++invState._invTableLoadSeq;
        invState._invTableLoading = true;
        mountOrRefreshMockUi();
        void loadInventoryTableForSub(meta.category.id, meta.sub.id, seq, key);
      }
    }
  } catch (e) {
    console.error("[Inventory] confirm purchase failed", e);
    const code = e && typeof e.message === "string" ? e.message : "";
    if (code === "NO_PURCHASE_CHANGES") {
      inventoryOrderDraftToast("No inventory changes to apply (already applied or no quantity edits).", "error");
    } else if (code === "ORDER_BAD_STATUS") {
      inventoryOrderDraftToast("This order was already updated. Refresh and try again.", "error");
    } else if (code === "ORDER_MISSING") {
      inventoryOrderDraftToast("Order no longer exists.", "error");
    } else if (code === "SUB_MISSING") {
      inventoryOrderDraftToast("Inventory subcategory not found. Refresh and try again.", "error");
    } else if (code === "INV_LINE_MISSING") {
      inventoryOrderDraftToast("This line no longer matches inventory. Refresh and try again.", "error");
    } else {
      const fc = e && typeof e.code === "string" ? e.code : "";
      if (fc === "permission-denied") {
        inventoryOrderDraftToast("Permission denied. Check Firestore rules.", "error");
      } else {
        console.error("[Inventory] confirm purchase detail", fc, e);
        inventoryOrderDraftToast("Could not update inventory. Try again.", "error");
      }
    }
  } finally {
    invState._invOrderPurchaseBusy = false;
    mountOrRefreshMockUi();
  }
}

function teardownInventoryOrderReceiptsListener() {
  if (invState._invOrderReceiptsUnsub) {
    try {
      invState._invOrderReceiptsUnsub();
    } catch (e) {
      /* ignore */
    }
    invState._invOrderReceiptsUnsub = null;
  }
  invState._invOrderReceiptsBoundOrderId = null;
  invState._invOrderReceiptsList = [];
  invState._invOrderReceiptsLoading = false;
}

function getActiveReceiptSubscriptionOrderId() {
  return invState._invOrdersDetailOrderId;
}

function ensureInventoryOrderReceiptsSubscription() {
  const oid = getActiveReceiptSubscriptionOrderId();
  if (!oid) {
    teardownInventoryOrderReceiptsListener();
    return;
  }
  if (invState._invOrderReceiptsBoundOrderId === oid && invState._invOrderReceiptsUnsub) {
    return;
  }
  teardownInventoryOrderReceiptsListener();
  invState._invOrderReceiptsBoundOrderId = oid;
  invState._invOrderReceiptsLoading = true;
  void (async () => {
    const salonId = await getSalonId();
    if (!salonId || getActiveReceiptSubscriptionOrderId() !== oid) {
      invState._invOrderReceiptsLoading = false;
      mountOrRefreshMockUi();
      return;
    }
    const q = query(
      collection(db, "salons", salonId, "inventoryOrders", oid, "receipts"),
      orderBy("uploadedAt", "desc")
    );
    invState._invOrderReceiptsUnsub = onSnapshot(
      q,
      (snap) => {
        if (getActiveReceiptSubscriptionOrderId() !== oid) return;
        invState._invOrderReceiptsList = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        invState._invOrderReceiptsLoading = false;
        mountOrRefreshMockUi();
      },
      (err) => {
        console.error("[Inventory] receipts snapshot", err);
        if (getActiveReceiptSubscriptionOrderId() !== oid) return;
        invState._invOrderReceiptsList = [];
        invState._invOrderReceiptsLoading = false;
        mountOrRefreshMockUi();
      }
    );
  })();
}

function getReceiptUploadFieldsForOrder(orderId) {
  const e = invState._invOrderReceiptUploadFieldsByOrderId[orderId];
  if (!e) return { note: "", supplierName: "", amount: "" };
  return {
    note: String(e.note ?? "").trim(),
    supplierName: String(e.supplierName ?? "").trim(),
    amount: String(e.amount ?? "").trim(),
  };
}

function getOrderReceiptUploadOptions(root, orderId) {
  if (root) {
    const backdrop = root.querySelector("#ff-inv-receipt-info-backdrop");
    if (backdrop) {
      const card = backdrop.querySelector("[data-inv-receipt-info-card]");
      if (card) {
        const n = card.querySelector('[data-inv-receipt-info-field="note"]');
        const s = card.querySelector('[data-inv-receipt-info-field="supplierName"]');
        const a = card.querySelector('[data-inv-receipt-info-field="amount"]');
        return {
          note: n instanceof HTMLInputElement ? n.value.trim() : "",
          supplierName: s instanceof HTMLInputElement ? s.value.trim() : "",
          amount: a instanceof HTMLInputElement ? a.value.trim() : "",
        };
      }
    }
  }
  return getReceiptUploadFieldsForOrder(orderId);
}

async function handleInventoryOrderReceiptFileSelected(root, orderId, file) {
  if (invState._invOrderReceiptUploadBusy || isInvOrderDetailCommitBusy()) return;
  invState._invOrderReceiptUploadBusy = true;
  mountOrRefreshMockUi();
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    const uid = auth.currentUser?.uid ? String(auth.currentUser.uid) : "";
    const opts = getOrderReceiptUploadOptions(root, orderId);
    const receiptsCol = collection(db, "salons", salonId, "inventoryOrders", orderId, "receipts");
    const newReceiptRef = doc(receiptsCol);
    const receiptId = newReceiptRef.id;
    const safeName = sanitizeReceiptStorageFileName(file.name);
    const storagePath = `salons/${salonId}/inventoryOrders/${orderId}/receipts/${receiptId}/${safeName}`;
    const sref = storageRef(storage, storagePath);
    await uploadBytes(sref, file);
    const fileUrl = await getDownloadURL(sref);
    /** @type {Record<string, unknown>} */
    const payload = {
      fileName: file.name,
      fileUrl,
      filePath: storagePath,
      uploadedAt: serverTimestamp(),
      uploadedBy: uid,
    };
    if (opts.note) payload.note = opts.note;
    if (opts.supplierName) payload.supplierName = opts.supplierName;
    if (opts.amount) payload.amount = opts.amount;
    await setDoc(newReceiptRef, payload);
    inventoryOrderDraftToast("Receipt uploaded.", "success");
  } catch (e) {
    console.error("[Inventory] receipt upload failed", e);
    const code = e && typeof e.code === "string" ? e.code : "";
    const msg = e && typeof e.message === "string" ? e.message : "";
    if (code === "storage/unauthorized" || /permission|unauthorized/i.test(msg)) {
      inventoryOrderDraftToast(
        "Receipt upload blocked by permissions. Make sure your user has manager/admin/owner role with a matching salonId.",
        "error"
      );
    } else if (code === "permission-denied") {
      inventoryOrderDraftToast("Permission denied saving receipt metadata.", "error");
    } else {
      inventoryOrderDraftToast(`Could not upload receipt${code ? ` (${code})` : ""}.`, "error");
    }
  } finally {
    invState._invOrderReceiptUploadBusy = false;
    mountOrRefreshMockUi();
  }
}

/** Receipt list block for Receipt information modal only (uses live receipts listener). */
function buildReceiptsListBlockHtml() {
  const loading = invState._invOrderReceiptsLoading;
  const list = invState._invOrderReceiptsList;
  const oidEsc = escapeHtml(invState._invReceiptInfoModalOrderId || "");
  const rows =
    !loading && list.length
      ? list
          .map((r) => {
            const fn = r.fileName != null ? String(r.fileName) : "";
            const emoji = getReceiptFileTypeEmoji(fn);
            const uploaded = formatInventoryOrderCreatedAt(r.uploadedAt);
            const url = r.fileUrl != null ? String(r.fileUrl) : "";
            const rid = escapeHtml(String(r.id ?? ""));
            return `<tr class="ff-inv2-or-tr">
  <td class="ff-inv2-or-td"><span class="ff-inv2-or-filetype" aria-hidden="true">${emoji}</span> <span class="ff-inv2-or-filename">${escapeHtml(fn)}</span></td>
  <td class="ff-inv2-or-td ff-inv2-or-td--muted">${escapeHtml(uploaded)}</td>
  <td class="ff-inv2-or-td ff-inv2-or-td--icon"><a class="ff-inv2-or-link ff-inv2-or-icon-btn" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="Open receipt" title="Open"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7"></path><path d="M10 14 21 3"></path><path d="M21 14v7H3V3h7"></path></svg></a></td>
  <td class="ff-inv2-or-td ff-inv2-or-td--icon"><button type="button" class="ff-inv2-or-delete ff-inv2-or-icon-btn" data-inv-order-receipt-delete="1" data-order-id="${oidEsc}" data-receipt-id="${rid}" aria-label="Delete receipt" title="Delete"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></button></td>
</tr>`;
          })
          .join("")
      : "";
  if (loading && !list.length) {
    return `<p class="ff-inv2-or-loading">Loading receipts…</p>`;
  }
  if (!loading && list.length) {
    return `<div class="ff-inv2-or-scroll ff-inv2-or-scroll--modal"><table class="ff-inv2-or-table">
  <thead><tr>
    <th class="ff-inv2-or-th">File</th>
    <th class="ff-inv2-or-th">Uploaded</th>
    <th class="ff-inv2-or-th ff-inv2-or-th--icon" aria-label="Open"></th>
    <th class="ff-inv2-or-th ff-inv2-or-th--icon" aria-label="Delete"></th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table></div>`;
  }
  return `<p class="ff-inv2-or-empty">No receipts yet.</p>`;
}

async function deleteInventoryOrderReceipt(orderId, receiptId) {
  if (!orderId || !receiptId) return;
  if (!window.confirm("Delete this receipt? This cannot be undone.")) return;
  const entry = invState._invOrderReceiptsList.find((x) => x.id === receiptId);
  if (!entry) {
    inventoryOrderDraftToast("Receipt not found.", "error");
    return;
  }
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    const path = entry.filePath != null ? String(entry.filePath) : "";
    if (path) {
      try {
        await deleteObject(storageRef(storage, path));
      } catch (storageErr) {
        console.warn("[Inventory] receipt file delete failed (continuing to remove metadata)", storageErr);
      }
    }
    await deleteDoc(doc(db, "salons", salonId, "inventoryOrders", orderId, "receipts", receiptId));
    inventoryOrderDraftToast("Receipt deleted.", "success");
  } catch (e) {
    console.error("[Inventory] receipt delete failed", e);
    const code = e && typeof e.code === "string" ? e.code : "";
    inventoryOrderDraftToast(`Could not delete receipt${code ? ` (${code})` : ""}.`, "error");
  }
}

function renderReceiptInfoModal() {
  if (!invState._invReceiptInfoModalOrderId) return "";
  const oid = invState._invReceiptInfoModalOrderId;
  const o = invState._invOrdersList.find((x) => x.id === oid);
  if (!o) return "";
  const fields = getReceiptUploadFieldsForOrder(oid);
  const oidEsc = escapeHtml(oid);
  const busy = invState._invOrderReceiptUploadBusy;
  const receiveBusy = invState._invOrderReceiveBusy;
  const purchaseBusy = invState._invOrderPurchaseBusy;
  const uploadDisabled = busy || receiveBusy || purchaseBusy ? " disabled" : "";
  const listBlock = buildReceiptsListBlockHtml();
  return `<div class="ff-inv2-modal-backdrop ff-inv2-modal-backdrop--nested" id="ff-inv-receipt-info-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv-receipt-info-title">
  <div class="ff-inv2-modal-card ff-inv2-receipt-info-card" data-inv-receipt-info-card="1" data-order-id="${oidEsc}">
    <div class="ff-inv2-receipt-info-head">
      <h3 id="ff-inv-receipt-info-title" class="ff-inv2-modal-title">Receipt Information</h3>
      <button type="button" class="ff-inv2-receipt-info-close" data-inv-receipt-info-close="1" aria-label="Close">×</button>
    </div>
    <p class="ff-inv2-modal-hint ff-inv2-receipt-info-hint">Note, supplier, and amount apply to the next upload.</p>
    <div class="ff-inv2-receipt-info-fields">
      <label class="ff-inv2-receipt-info-field">
        <span class="ff-inv2-receipt-info-label">Note</span>
        <input type="text" class="ff-inv2-receipt-info-input" data-inv-receipt-info-field="note" value="${escapeHtml(fields.note)}" placeholder="Note (optional)" autocomplete="off" />
      </label>
      <label class="ff-inv2-receipt-info-field">
        <span class="ff-inv2-receipt-info-label">Supplier</span>
        <input type="text" class="ff-inv2-receipt-info-input" data-inv-receipt-info-field="supplierName" value="${escapeHtml(fields.supplierName)}" placeholder="Supplier (optional)" autocomplete="off" />
      </label>
      <label class="ff-inv2-receipt-info-field">
        <span class="ff-inv2-receipt-info-label">Amount</span>
        <input type="text" class="ff-inv2-receipt-info-input" data-inv-receipt-info-field="amount" value="${escapeHtml(fields.amount)}" placeholder="Amount (optional)" autocomplete="off" />
      </label>
    </div>
    <div class="ff-inv2-receipt-info-upload-row">
      <input type="file" class="ff-inv2-sr-only" data-inv-order-receipt-file="1" data-order-id="${oidEsc}" tabindex="-1" />
      <button type="button" class="ff-inv2-btn ff-inv2-btn--sm" data-inv-order-receipt-open="1" data-order-id="${oidEsc}"${uploadDisabled}>+ Upload receipt</button>
    </div>
    <div class="ff-inv2-receipt-info-uploaded">
      <p class="ff-inv2-receipt-info-section-label">Uploaded receipts</p>
      ${listBlock}
    </div>
    <div class="ff-inv2-modal-actions ff-inv2-receipt-info-footer">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-primary" data-inv-receipt-info-save="1" data-order-id="${oidEsc}">Save</button>
    </div>
  </div>
</div>`;
}

function renderOrderDetailLineViewModal() {
  if (invState._invOrderDetailLineViewIdx == null || !invState._invOrdersDetailOrderId) return "";
  const oid = invState._invOrdersDetailOrderId;
  const idx = invState._invOrderDetailLineViewIdx;
  const o = invState._invOrdersList.find((x) => x.id === oid);
  if (!o) return "";
  const items = Array.isArray(o.items) ? o.items : [];
  const it = items[idx];
  if (!it) return "";
  const name = escapeHtml(it.itemName != null ? String(it.itemName) : "");
  const codeRaw = it.code != null ? String(it.code).trim() : "";
  const code = codeRaw !== "" ? escapeHtml(codeRaw) : "—";
  const gLine = getOrderItemGroupLabel(it);
  const group = gLine !== "" ? escapeHtml(gLine) : "—";
  const need = escapeHtml(formatOrderDisplay(getItemOrderQty(it)));
  ensureShoppingDraft(oid);
  const shop = invState._invOrderShoppingDraft[oid];
  const qb =
    shop && shop.qtyBought[idx] != null && String(shop.qtyBought[idx]).trim() !== ""
      ? String(shop.qtyBought[idx])
      : "";
  const bought = qb !== "" ? escapeHtml(qb) : "—";
  return `<div class="ff-inv2-modal-backdrop ff-inv2-modal-backdrop--nested" id="ff-inv-od-line-view-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv-od-line-view-title">
  <div class="ff-inv2-modal-card ff-inv2-od-line-view-card">
    <h3 id="ff-inv-od-line-view-title" class="ff-inv2-modal-title">Line</h3>
    <dl class="ff-inv2-od-line-view-dl">
      <div class="ff-inv2-od-line-view-row"><dt>Item</dt><dd>${name}</dd></div>
      <div class="ff-inv2-od-line-view-row"><dt>Code</dt><dd>${code}</dd></div>
      <div class="ff-inv2-od-line-view-row"><dt>Group</dt><dd>${group}</dd></div>
      <div class="ff-inv2-od-line-view-row"><dt>Needed</dt><dd>${need}</dd></div>
      <div class="ff-inv2-od-line-view-row"><dt>Bought</dt><dd>${bought}</dd></div>
    </dl>
    <div class="ff-inv2-modal-actions">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-primary" data-inv-od-line-view-close="1">Close</button>
    </div>
  </div>
</div>`;
}

function renderOrdersTabHtml() {
  if (invState._invOrdersLoading) {
    return `<div class="ff-inv2-orders-wrap">
  <div class="ff-inv2-orders-head">
    <h3 class="ff-inv2-orders-title">Orders</h3>
  </div>
  <p class="ff-inv2-orders-loading">Loading orders…</p>
</div>`;
  }
  if (invState._invOrdersLoadError) {
    return `<div class="ff-inv2-orders-wrap">
  <div class="ff-inv2-orders-head">
    <h3 class="ff-inv2-orders-title">Orders</h3>
  </div>
  <p class="ff-inv2-orders-error">${escapeHtml(invState._invOrdersLoadError)}</p>
</div>`;
  }
  const rows = invState._invOrdersList;
  if (!rows.length) {
    return `<div class="ff-inv2-orders-wrap">
  <div class="ff-inv2-orders-head">
    <h3 class="ff-inv2-orders-title">Orders</h3>
  </div>
  <p class="ff-inv2-orders-empty">No saved orders yet. Use Create Order to save a draft.</p>
</div>`;
  }
  const fil = invState._invOrdersStatusFilter;
  const statusFiltered = rows.filter(orderMatchesInventoryStatusFilter);
  const filteredRows = statusFiltered.filter(orderMatchesInventorySearchQuery);
  const statusFilterBar = `<div class="ff-inv2-orders-status-filter" role="toolbar" aria-label="Filter orders by status">
  <span class="ff-inv2-order-detail-filter-label">Status</span>
  <button type="button" class="ff-inv2-od-filter-chip${fil === "open" ? " ff-inv2-od-filter--active" : ""}" data-inv-orders-status-filter="open">Open</button>
  <button type="button" class="ff-inv2-od-filter-chip${fil === "in_progress" ? " ff-inv2-od-filter--active" : ""}" data-inv-orders-status-filter="in_progress">In progress</button>
  <button type="button" class="ff-inv2-od-filter-chip${fil === "done" ? " ff-inv2-od-filter--active" : ""}" data-inv-orders-status-filter="done">Done</button>
  <button type="button" class="ff-inv2-od-filter-chip${fil === "all" ? " ff-inv2-od-filter--active" : ""}" data-inv-orders-status-filter="all">All</button>
</div>`;
  const hasSearchClear = invState._invOrdersSearchQuery.trim() !== "";
  const searchClearBtn = hasSearchClear
    ? `<button type="button" class="ff-inv2-orders-search-clear" data-inv-orders-search-clear="1" aria-label="Clear search">×</button>`
    : "";
  const ordersToolbar = `<div class="ff-inv2-orders-toolbar">
  <div class="ff-inv2-orders-search-wrap${hasSearchClear ? " ff-inv2-orders-search-wrap--has-clear" : ""}">
    <input type="search" enterkeyhint="search" class="ff-inv2-orders-search-input" placeholder="Search orders..." value="${escapeHtml(invState._invOrdersSearchQuery)}" data-inv-orders-search-input="1" autocomplete="off" />
    ${searchClearBtn}
  </div>
  ${statusFilterBar}
</div>`;
  if (!statusFiltered.length) {
    return `<div class="ff-inv2-orders-wrap">
  <div class="ff-inv2-orders-head">
    <h3 class="ff-inv2-orders-title">Orders</h3>
  </div>
  ${ordersToolbar}
  <p class="ff-inv2-orders-filter-empty">No orders match this filter.</p>
</div>`;
  }
  if (!filteredRows.length) {
    return `<div class="ff-inv2-orders-wrap">
  <div class="ff-inv2-orders-head">
    <h3 class="ff-inv2-orders-title">Orders</h3>
  </div>
  ${ordersToolbar}
  <p class="ff-inv2-orders-filter-empty">No orders match your search.</p>
</div>`;
  }
  const body = filteredRows
    .map((o) => {
      const name = getInventoryOrderDisplayName(o);
      const src = formatInventoryOrderSourceLabel(o);
      const status = formatInventoryOrderStatusDisplay(o);
      const created = formatInventoryOrderCreatedAt(o.createdAt);
      const n = typeof o.itemCount === "number" ? o.itemCount : Array.isArray(o.items) ? o.items.length : 0;
      const oid = escapeHtml(o.id);
      return `<tr class="ff-inv2-orders-tr" tabindex="0" data-inv-order-row="1" data-inv-order-id="${oid}">
  <td class="ff-inv2-orders-td ff-inv2-orders-td--name">${escapeHtml(name)}</td>
  <td class="ff-inv2-orders-td ff-inv2-orders-td--muted ff-inv2-orders-td--src">${escapeHtml(src)}</td>
  <td class="ff-inv2-orders-td">${escapeHtml(status)}</td>
  <td class="ff-inv2-orders-td ff-inv2-orders-td--muted">${escapeHtml(created)}</td>
  <td class="ff-inv2-orders-td ff-inv2-orders-td--num">${escapeHtml(String(n))}</td>
  <td class="ff-inv2-orders-td ff-inv2-orders-td--actions" data-inv-orders-actions="1">
    <button type="button" class="ff-inv2-orders-kebab" data-inv-orders-menu-trigger="${oid}" aria-label="Order actions" title="Order actions">⋯</button>
  </td>
</tr>`;
    })
    .join("");
  return `<div class="ff-inv2-orders-wrap">
  <div class="ff-inv2-orders-head">
    <h3 class="ff-inv2-orders-title">Orders</h3>
  </div>
  ${ordersToolbar}
  <div class="ff-inv2-orders-scroll">
    <table class="ff-inv2-orders-table">
      <thead>
        <tr>
          <th class="ff-inv2-orders-th">Name</th>
          <th class="ff-inv2-orders-th">Source</th>
          <th class="ff-inv2-orders-th">Status</th>
          <th class="ff-inv2-orders-th">Created</th>
          <th class="ff-inv2-orders-th ff-inv2-orders-th--num">Items</th>
          <th class="ff-inv2-orders-th ff-inv2-orders-th--narrow" aria-label="Actions"></th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  </div>
</div>`;
}

function renderInventoryOrderDetailModal() {
  if (!invState._invOrdersDetailOrderId) return "";
  const o = invState._invOrdersList.find((x) => x.id === invState._invOrdersDetailOrderId);
  if (!o) {
    return `<div class="ff-inv2-modal-backdrop" id="ff-inv-order-detail-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv-order-detail-title">
  <div class="ff-inv2-modal-card ff-inv2-order-detail-card">
    <h3 id="ff-inv-order-detail-title" class="ff-inv2-modal-title">Order</h3>
    <p class="ff-inv2-order-detail-missing">This order is no longer in the list.</p>
    <div class="ff-inv2-modal-actions">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-inv-order-detail-close="1">Close</button>
    </div>
  </div>
</div>`;
  }
  const src = formatInventoryOrderSourceLabel(o);
  const created = formatInventoryOrderCreatedAt(o.createdAt);
  const statusLabel = formatInventoryOrderStatusDisplay(o);
  const orderedAt = o.orderedAt ? formatInventoryOrderCreatedAt(o.orderedAt) : "";
  const orderedBy = o.orderedAt ? formatInventoryOrderOrderedByDisplay(o.orderedBy) : "";
  const n = typeof o.itemCount === "number" ? o.itemCount : Array.isArray(o.items) ? o.items.length : 0;
  const items = Array.isArray(o.items) ? o.items : [];
  const oidEsc = escapeHtml(o.id);
  ensureShoppingDraft(o.id);
  const shop = invState._invOrderShoppingDraft[o.id];
  const receiveBusy = invState._invOrderReceiveBusy;
  const purchaseBusy = invState._invOrderPurchaseBusy;
  const detailCommitBusy = receiveBusy || purchaseBusy;
  const receiveDisabled = detailCommitBusy ? " disabled" : "";
  const orderTitle = escapeHtml(getInventoryOrderDisplayName(o));
  const fil = invState._invOrderDetailFilter;
  const filteredPairs = items
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => orderDetailLineMatchesFilter(it));
  const displayPairs = sortOrderDetailPairsOpenFirst(filteredPairs);
  const toolsDisabledClass = receiveDisabled ? " ff-inv2-od-tools-details--disabled" : "";
  const exportMenuBlock = `<details class="ff-inv2-od-export-menu ff-inv2-od-tools-details${toolsDisabledClass}">
  <summary class="ff-inv2-od-export-menu-trigger" title="Print or export CSV" aria-label="Print or export CSV"><span aria-hidden="true">▾</span></summary>
  <div class="ff-inv2-od-tools-menu ff-inv2-od-export-menu-popup" role="group" aria-label="Export options">
    <button type="button" class="ff-inv2-od-tools-menu-item" data-inv-order-detail-print="1"${receiveDisabled}>Print</button>
    <button type="button" class="ff-inv2-od-tools-menu-item" data-inv-order-detail-export-csv="1"${receiveDisabled}>Export CSV</button>
  </div>
</details>`;
  const lineFilterBar =
    items.length > 0
      ? `<div class="ff-inv2-order-detail-line-filter" role="toolbar" aria-label="Filter lines">
  <button type="button" class="ff-inv2-od-filter-chip${fil === "all" ? " ff-inv2-od-filter--active" : ""}" data-inv-order-detail-filter="all"${receiveDisabled}>All</button>
  <button type="button" class="ff-inv2-od-filter-chip${fil === "open" ? " ff-inv2-od-filter--active" : ""}" data-inv-order-detail-filter="open"${receiveDisabled}>Open</button>
  <button type="button" class="ff-inv2-od-filter-chip${fil === "received" ? " ff-inv2-od-filter--active" : ""}" data-inv-order-detail-filter="received"${receiveDisabled}>Done</button>
  ${exportMenuBlock}
</div>`
      : `<div class="ff-inv2-order-detail-line-filter ff-inv2-order-detail-line-filter--export-only" role="toolbar" aria-label="Export">${exportMenuBlock}</div>`;
  let odSalonCurCode = "USD";
  let odSalonCurSym = "";
  try {
    if (typeof window !== "undefined" && typeof window.ffGetSalonCurrencyCode === "function") {
      odSalonCurCode = String(window.ffGetSalonCurrencyCode()).trim() || "USD";
    }
    if (typeof window !== "undefined" && typeof window.ffGetCurrencySymbol === "function") {
      odSalonCurSym = String(window.ffGetCurrencySymbol(odSalonCurCode)).trim();
    }
  } catch (e) {
    odSalonCurSym = "";
  }
  if (!odSalonCurSym) odSalonCurSym = odSalonCurCode;
  const odSalonCurCodeEsc = escapeHtml(odSalonCurCode);
  const odSalonCurSymEsc = escapeHtml(odSalonCurSym);
  const itemRows = displayPairs
    .map(({ it, idx }) => {
      const vis = getOrderLineReceiveVisualState(it);
      const ordQNum = getItemOrderQty(it);
      const ordQ = formatOrderDisplay(ordQNum);
      const qb =
        shop && shop.qtyBought[idx] != null && String(shop.qtyBought[idx]).trim() !== ""
          ? String(shop.qtyBought[idx])
          : "";
      const qbNum = parseNum(qb);
      const derivedChecked = qbNum > 0 && (ordQNum <= 0 || qbNum >= ordQNum);
      const chk = derivedChecked ? " checked" : "";
      const name = escapeHtml(it.itemName != null ? String(it.itemName) : "");
      const gLine = getOrderItemGroupLabel(it);
      const groupSpan =
        gLine !== "" ? `<span class="ff-inv2-od-item-group">(${escapeHtml(gLine)})</span>` : "";
      const codeRaw = it.code != null ? String(it.code) : "";
      const code = escapeHtml(codeRaw);
      const invRef = parseInventoryCellRefFromOrderLine(it);
      const priceFieldBusy = detailCommitBusy || invState._invOrderInvPriceBusy;
      const priceFieldDisabled = priceFieldBusy ? " disabled" : "";
      const priceFieldVal =
        it.price != null && String(it.price).trim() !== ""
          ? escapeHtml(String(it.price).replace(/,/g, "").trim())
          : "";
      const invPriceInline = invRef
        ? `<span class="ff-inv2-od-inv-price-inline" title="Unit price (${odSalonCurCodeEsc}) — saves to inventory">
  <span class="ff-inv2-od-inv-price-cur" aria-hidden="true">${odSalonCurSymEsc}</span><input type="number" class="ff-inv2-od-inv-price-input ff-inv2-od-inv-price-input--inline" min="0" step="any" inputmode="decimal" autocomplete="off"
    data-inv-order-line-inv-price="1" data-order-id="${oidEsc}" data-line-idx="${idx}"
    value="${priceFieldVal}" placeholder="—"
    aria-label="Inventory unit price, ${odSalonCurCodeEsc}"${priceFieldDisabled} />
</span>`
        : "";
      const itemCell = `<td class="ff-inv2-od-td ff-inv2-od-td--item"><div class="ff-inv2-od-item-stack"><div class="ff-inv2-od-item-name-row"><span class="ff-inv2-od-item-name" title="${name}">${name}</span>${invPriceInline}</div>${groupSpan}</div></td>`;
      const codeCell = `<td class="ff-inv2-od-td ff-inv2-od-td--code"><span class="ff-inv2-od-item-code${codeRaw === "" ? " ff-inv2-od-item-code--empty" : ""}">${codeRaw !== "" ? code : "—"}</span></td>`;
      const qbAttr = qb !== "" ? escapeHtml(qb) : "";
      return `<tr class="ff-inv2-od-tr ${vis.rowClass}" data-inv-detail-shopping-row="1" data-line-idx="${idx}">
  <td class="ff-inv2-od-td ff-inv2-od-td--center ff-inv2-od-td--check"><label class="ff-inv2-od-shopping-check-label">
  <input type="checkbox" class="ff-inv2-od-shopping-check" data-inv-shopping-check="1" data-order-id="${oidEsc}" data-line-idx="${idx}"${chk}${receiveDisabled} aria-label="Got this item" />
  <span class="ff-inv2-od-shopping-check-fake" aria-hidden="true"></span>
</label></td>
  ${itemCell}
  ${codeCell}
  <td class="ff-inv2-od-td ff-inv2-od-td--num ff-inv2-od-td--qty"><span class="ff-inv2-od-qty-need-value">${escapeHtml(ordQ)}</span></td>
  <td class="ff-inv2-od-td ff-inv2-od-td--num ff-inv2-od-td--input ff-inv2-od-td--qty-bought"><div class="ff-inv2-od-qty-bought-wrap"><div class="ff-inv2-od-qty-bought-input-row"><input type="number" class="ff-inv2-od-recv-qty ff-inv2-od-qty-bought" data-inv-shopping-qty-bought="1" data-order-id="${oidEsc}" data-line-idx="${idx}" value="${qbAttr}" min="0" step="any" inputmode="decimal" autocomplete="off"${receiveDisabled} title="Bought" /></div></div></td>
</tr>`;
    })
    .join("");
  const theadChecklist = `<thead><tr>
<th class="ff-inv2-od-th ff-inv2-od-th--narrow ff-inv2-od-th--center" aria-label="Got it"></th>
<th class="ff-inv2-od-th ff-inv2-od-th--item">Item</th>
<th class="ff-inv2-od-th ff-inv2-od-th--code ff-inv2-od-th--col-head" scope="col" title="Product code">Code</th>
<th class="ff-inv2-od-th ff-inv2-od-th--num ff-inv2-od-th--col-head" scope="col" title="Quantity you need">QTY</th>
<th class="ff-inv2-od-th ff-inv2-od-th--num ff-inv2-od-th--col-head" scope="col" title="Quantity bought">Buy</th>
</tr></thead>`;
  const itemsTableBody = items.length
    ? filteredPairs.length === 0
      ? `${lineFilterBar}<p class="ff-inv2-order-detail-no-items">No lines match this filter.</p>`
      : `${lineFilterBar}<div class="ff-inv2-order-detail-list-scroll">
<table class="ff-inv2-order-detail-items ff-inv2-order-detail-items--checklist">
${theadChecklist}
<tbody>${itemRows}</tbody>
</table></div>`
    : `${lineFilterBar}<p class="ff-inv2-order-detail-no-items">No line items.</p>`;
  const orderedMeta =
    o.orderedAt != null
      ? `<div class="ff-inv2-order-detail-meta-row"><dt>Ordered</dt><dd>${escapeHtml(orderedAt)}</dd></div>
  <div class="ff-inv2-order-detail-meta-row"><dt>Ordered by</dt><dd>${escapeHtml(orderedBy)}</dd></div>`
      : "";
  const detailTotals = getOrderDetailTotals(items);
  const receiveSummaryCounts = getOrderReceiveSummaryCounts(items);
  const extrasBlock = `<details class="ff-inv2-order-detail-extras ff-inv2-order-detail-extras--minimal">
  <summary class="ff-inv2-order-detail-extras-summary">Source &amp; details</summary>
  <div class="ff-inv2-order-detail-extras-body">
    <dl class="ff-inv2-order-detail-meta ff-inv2-order-detail-meta--compact">
      <div class="ff-inv2-order-detail-meta-row"><dt>Source</dt><dd>${escapeHtml(src)}</dd></div>
      <div class="ff-inv2-order-detail-meta-row"><dt>Created</dt><dd>${escapeHtml(created)}</dd></div>
      ${orderedMeta}
      <div class="ff-inv2-order-detail-meta-row"><dt>Lines</dt><dd>${escapeHtml(String(n))}</dd></div>
    </dl>
    <p class="ff-inv2-order-detail-totals-line" role="status">Ordered ${escapeHtml(formatOrderDisplay(detailTotals.orderedQty))} · Received ${escapeHtml(formatOrderDisplay(detailTotals.receivedQty))} · Est. ${escapeHtml(formatOrderDetailEstimatedCost(detailTotals.estimatedCost))}</p>
    <p class="ff-inv2-order-detail-totals-line ff-inv2-order-detail-totals-line--sub">Open ${receiveSummaryCounts.open} · Partial ${receiveSummaryCounts.partial} · Done ${receiveSummaryCounts.received} · Remaining qty ${escapeHtml(formatOrderDisplay(receiveSummaryCounts.remainingQty))}</p>
  </div>
</details>`;
  const purchaseCommitBtn =
    items.length > 0
      ? `<button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-primary ff-inv2-order-detail-purchase-btn" data-inv-order-detail-confirm-purchase="1" data-order-id="${oidEsc}"${receiveDisabled}>${purchaseBusy ? "Updating…" : "Confirm Purchase"}</button>`
      : "";
  return `<div class="ff-inv2-modal-backdrop" id="ff-inv-order-detail-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv-order-detail-title">
  <div class="ff-inv2-modal-card ff-inv2-order-detail-card">
    <header class="ff-inv2-order-detail-hero">
      <div class="ff-inv2-order-detail-hero-main">
        <h2 id="ff-inv-order-detail-title" class="ff-inv2-order-detail-title">${orderTitle}</h2>
        <span class="ff-inv2-order-detail-status-pill">${escapeHtml(statusLabel)}</span>
      </div>
    </header>
    ${extrasBlock}
    <div class="ff-inv2-order-detail-main">
    ${itemsTableBody}
    </div>
    <div class="ff-inv2-modal-actions ff-inv2-order-detail-footer">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-inv-order-detail-close="1"${receiveDisabled}>Close</button>
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel ff-inv2-order-detail-receipt-btn" data-inv-order-receipt-info="1" data-order-id="${oidEsc}"${receiveDisabled}>Receipt Information</button>
      <span class="ff-inv2-order-detail-footer-spacer" aria-hidden="true"></span>
      ${purchaseCommitBtn}
    </div>
  </div>
</div>`;
}

function renderInventoryOrdersMenu() {
  if (!invState._invOrdersMenu) return "";
  const m = invState._invOrdersMenu;
  const oid = escapeHtml(m.orderId);
  const editNameBtn = `<button type="button" class="ff-inv2-row-menu-item" role="menuitem" data-inv-orders-action="editName" data-order-id="${oid}">Edit name</button>`;
  const dupBtn = `<button type="button" class="ff-inv2-row-menu-item" role="menuitem" data-inv-orders-action="duplicate" data-order-id="${oid}">Duplicate</button>`;
  const deleteBtn = `<button type="button" class="ff-inv2-row-menu-item ff-inv2-row-menu-item--danger" role="menuitem" data-inv-orders-action="delete" data-order-id="${oid}">Delete</button>`;
  const inner = `${editNameBtn}${dupBtn}${deleteBtn}`;
  return `<div class="ff-inv2-row-menu-backdrop" data-inv-orders-menu-dismiss="1" aria-hidden="true"></div>
<div class="ff-inv2-row-menu" role="menu" style="left:${m.left}px;top:${m.top}px">
  ${inner}
</div>`;
}

function renderInventoryOrdersRenameModal() {
  if (!invState._invOrdersRenameModal) return "";
  const m = invState._invOrdersRenameModal;
  const oid = escapeHtml(m.orderId);
  const val = escapeHtml(m.draftName);
  const busy = !!m.busy;
  const disabled = busy ? " disabled" : "";
  return `<div class="ff-inv2-modal-backdrop" id="ff-inv-orders-rename-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv-orders-rename-title">
  <div class="ff-inv2-modal-card">
    <h3 id="ff-inv-orders-rename-title" class="ff-inv2-modal-title">Edit name</h3>
    <label class="ff-inv2-modal-field">
      <span class="ff-inv2-modal-field-label">Order name</span>
      <input type="text" class="ff-inv2-modal-input" data-inv-orders-rename-input="1" value="${val}" placeholder="e.g. Weekly restock" maxlength="120" autocomplete="off"${disabled} />
    </label>
    <div class="ff-inv2-modal-actions">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-inv-orders-rename-cancel="1"${disabled}>Cancel</button>
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-primary" data-inv-orders-rename-save="1" data-order-id="${oid}"${disabled}>${busy ? "Saving…" : "Save"}</button>
    </div>
  </div>
</div>`;
}

async function renameInventoryOrderConfirmed(orderId, rawName) {
  if (!invState._invOrdersRenameModal || invState._invOrdersRenameModal.orderId !== orderId) return;
  const name = String(rawName ?? "").trim().slice(0, 120);
  invState._invOrdersRenameModal = { ...invState._invOrdersRenameModal, draftName: name, busy: true };
  mountOrRefreshMockUi();
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    const ref = doc(db, `salons/${salonId}/inventoryOrders`, orderId);
    await updateDoc(ref, { orderName: name, updatedAt: serverTimestamp() });
    invState._invOrdersRenameModal = null;
    inventoryOrderDraftToast("Name updated.", "success");
    void loadInventoryOrdersList({ silent: true });
  } catch (e) {
    console.error("[Inventory] rename order failed", e);
    invState._invOrdersRenameModal = invState._invOrdersRenameModal ? { ...invState._invOrdersRenameModal, busy: false } : null;
    inventoryOrderDraftToast("Could not rename order.", "error");
    mountOrRefreshMockUi();
  }
}

function renderInventoryOrdersDeleteModal() {
  if (!invState._invOrdersDeleteConfirmOrderId) return "";
  const oid = escapeHtml(invState._invOrdersDeleteConfirmOrderId);
  const o = invState._invOrdersList.find((x) => x.id === invState._invOrdersDeleteConfirmOrderId);
  const impacted = orderHasAppliedInventoryImpact(o);
  const warningHtml = impacted
    ? `<p class="ff-inv2-modal-hint">This order has already updated your inventory. Deleting it will <strong>not</strong> remove those items from stock.</p>`
    : `<p class="ff-inv2-modal-hint">This order has not touched inventory yet.</p>`;
  return `<div class="ff-inv2-modal-backdrop" id="ff-inv-orders-delete-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv-orders-delete-title">
  <div class="ff-inv2-modal-card">
    <h3 id="ff-inv-orders-delete-title" class="ff-inv2-modal-title">Delete this order?</h3>
    ${warningHtml}
    <div class="ff-inv2-modal-actions">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-inv-orders-delete-cancel="1">Cancel</button>
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-danger" data-inv-orders-delete-commit="1" data-order-id="${oid}">Delete</button>
    </div>
  </div>
</div>`;
}

function renderInventoryOrdersMarkOrderedModal() {
  if (!invState._invOrdersMarkOrderedConfirmOrderId) return "";
  const oid = escapeHtml(invState._invOrdersMarkOrderedConfirmOrderId);
  return `<div class="ff-inv2-modal-backdrop" id="ff-inv-orders-mark-ordered-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv-orders-mark-ordered-title">
  <div class="ff-inv2-modal-card">
    <h3 id="ff-inv-orders-mark-ordered-title" class="ff-inv2-modal-title">Mark this order as ordered?</h3>
    <div class="ff-inv2-modal-actions">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-inv-orders-mark-ordered-cancel="1">Cancel</button>
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-primary" data-inv-orders-mark-ordered-commit="1" data-order-id="${oid}">Mark as ordered</button>
    </div>
  </div>
</div>`;
}

/**
 * Toggle the Bought (B) quantity for a shopping row driven by its checkbox.
 * "Got exactly what's needed" — B = 0 → N (check), B = N or complete → 0 (uncheck),
 * partial B (0 < B < N) → complete to N.
 */
function toggleShoppingRowQty(oid, idx) {
  const o = invState._invOrdersList.find((x) => x.id === oid);
  if (!o) return;
  const items = Array.isArray(o.items) ? o.items : [];
  const it = items[idx];
  if (!it) return;
  const N = getItemOrderQty(it);
  ensureShoppingDraft(oid);
  const shop = invState._invOrderShoppingDraft[oid];
  if (!shop) return;
  if (!Array.isArray(shop.qtyBought)) shop.qtyBought = [];
  if (!Array.isArray(shop.checked)) shop.checked = [];
  const B = parseNum(shop.qtyBought[idx]);
  let newB;
  if (B === 0) {
    newB = N > 0 ? N : 0;
  } else if (N > 0 && B >= N) {
    newB = 0;
  } else {
    newB = N > 0 ? N : 0;
  }
  shop.qtyBought[idx] = newB > 0 ? String(newB) : "";
  shop.checked[idx] = newB > 0;
  mountOrRefreshMockUi();
}

function handleOrderBuilderSourceChange(ev) {
  const root = document.getElementById("inventoryScreen");
  const t = ev.target;
  if (!(t instanceof HTMLInputElement) || !root || !root.contains(t)) return;
  if (t.hasAttribute("data-inv-shopping-check")) {
    const oid = t.getAttribute("data-order-id");
    const idxStr = t.getAttribute("data-line-idx");
    if (oid != null && idxStr != null) {
      toggleShoppingRowQty(oid, Number(idxStr));
    }
    return;
  }
  if (t.hasAttribute("data-inv-order-receipt-file")) {
    const oid = t.getAttribute("data-order-id");
    const f = t.files && t.files[0];
    t.value = "";
    if (oid && f) {
      void handleInventoryOrderReceiptFileSelected(root, oid, f);
    }
    return;
  }
  if (t.hasAttribute("data-inv-ob-cat")) {
    const catId = t.getAttribute("data-inv-ob-cat");
    if (!catId) return;
    const cat = getCategoryTree().find((c) => c.id === catId);
    if (!cat) return;
    const subs = cat.subcategories || [];
    if (t.checked) {
      for (const s of subs) invState._invOrderBuilderCustomSubIds.add(s.id);
    } else {
      for (const s of subs) invState._invOrderBuilderCustomSubIds.delete(s.id);
    }
    scheduleInventoryOrderDraftSave();
    mountOrRefreshMockUi();
    void refreshOrderBuilderPreviewAsync();
    return;
  }
  if (t.hasAttribute("data-inv-ob-sub")) {
    const val = t.getAttribute("data-inv-ob-sub");
    if (!val) return;
    const colon = val.indexOf(":");
    if (colon < 0) return;
    const subId = val.slice(colon + 1);
    if (t.checked) invState._invOrderBuilderCustomSubIds.add(subId);
    else invState._invOrderBuilderCustomSubIds.delete(subId);
    scheduleInventoryOrderDraftSave();
    mountOrRefreshMockUi();
    void refreshOrderBuilderPreviewAsync();
  }
}

/**
 * Long-press (~500ms) on an Order Details row opens Line details. Normal tap still toggles ✓ via row click.
 * Eats the next click on that row so the release after long-press does not toggle the checkbox.
 */
function bindOrderDetailRowLongPressOnce(root) {
  if (root.dataset.ffInvOdLongPress === "1") return;
  root.dataset.ffInvOdLongPress = "1";
  /** @type {{ timer: ReturnType<typeof setTimeout>, x: number, y: number } | null } */
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
      const tr = tgt.closest("[data-inv-detail-shopping-row]");
      if (!tr || !root.contains(tr)) return;
      if (tgt.closest("input,label,button,a,textarea,select")) return;
      if (ev.button !== 0) return;
      const idxStr = tr.getAttribute("data-line-idx");
      if (idxStr == null || invState._invOrdersDetailOrderId == null) return;
      clear();
      const x = ev.clientX;
      const y = ev.clientY;
      const timer = window.setTimeout(() => {
        state = null;
        invState._invOrderDetailLineViewIdx = Number(idxStr);
        const kill = (cev) => {
          document.removeEventListener("click", kill, true);
          const el =
            cev.target instanceof Element
              ? cev.target
              : cev.target instanceof Text
                ? cev.target.parentElement
                : null;
          if (!el) return;
          const row = el.closest("[data-inv-detail-shopping-row]");
          if (row && row.getAttribute("data-line-idx") === idxStr) {
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

/**
 * Add a Smart Inventory Suggestion (from Inbox) as a manual line in Create Order.
 * - Navigates to Inventory → Create Order tab
 * - Pushes a linked manual line (rowId:groupId) with the suggested quantity
 * - Avoids duplicates: if the same linked item is already in the manual list, just bumps qty.
 * Returns true on success.
 */
async function ffAddInventorySuggestionToOrder(suggestion, opts) {
  if (!suggestion || !suggestion.data) return false;
  const d = suggestion.data;
  const rowId = d.rowId != null ? String(d.rowId) : "";
  const groupId = d.groupId != null ? String(d.groupId) : "";
  const subId = d.subcategoryId != null ? String(d.subcategoryId) : "";
  const catId = d.categoryId != null ? String(d.categoryId) : "";
  // Accept a user-edited qty override from the Inbox modal; fall back to suggestedQty.
  const overrideQtyRaw = opts && opts.qtyOverride;
  const overrideQty = overrideQtyRaw != null
    ? (typeof overrideQtyRaw === "number" ? overrideQtyRaw : Number(overrideQtyRaw))
    : NaN;
  const suggestedQty = typeof d.suggestedQty === "number" ? d.suggestedQty : Number(d.suggestedQty);
  const qty = Number.isFinite(overrideQty) && overrideQty > 0 ? overrideQty : suggestedQty;
  console.log("[Inventory] Add to Order — qty resolution", { overrideQtyRaw, overrideQty, suggestedQty, finalQty: qty });
  if (!rowId || !groupId || !subId || !catId || !(qty > 0)) return false;
  const salonId = await getSalonId();
  if (!salonId) return false;

  // Step 1: ensure the active draft is loaded (so we know its Firestore id).
  // This also picks up any draft created from a previous session.
  await loadInventoryOrderDraft();

  // Step 2: read-modify-write the active draft (or create one if none exists).
  const uid = auth.currentUser && auth.currentUser.uid ? String(auth.currentUser.uid) : null;
  const linkedId = `${subId}:${rowId}:${groupId}`;
  /** @type {Array<Record<string, unknown>>} */
  let existing = [];
  /** @type {import("firebase/firestore").DocumentReference | null} */
  let ref = null;
  if (invState._invActiveDraftId) {
    ref = doc(db, `salons/${salonId}/inventoryDrafts`, invState._invActiveDraftId);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data() || {};
        if (Array.isArray(data.manualItems)) {
          existing = data.manualItems.map(sanitizeManualItemForDraft).filter((x) => x && x.itemName);
        }
      }
    } catch (e) {
      console.warn("[Inventory] draft fetch (add suggestion) failed", e);
    }
  }
  const existingIdx = existing.findIndex((L) => L && L.linkedInventoryItemId === linkedId);
  if (existingIdx >= 0) {
    // User explicitly chose this qty in the modal — respect it, even if it lowers a previous value.
    existing[existingIdx].orderQty = qty;
    if (!existing[existingIdx].fromSuggestionId && suggestion.id) {
      existing[existingIdx].fromSuggestionId = suggestion.id;
    }
  } else {
    /** @type {Record<string, unknown>} */
    const entry = {
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      itemName: d.itemName != null ? String(d.itemName) : "Suggested item",
      orderQty: qty,
      isManual: true,
      linkedInventoryItemId: linkedId,
      groupId,
      groupName: d.groupName != null ? String(d.groupName) : "",
      categoryId: catId,
      categoryName: d.categoryName != null ? String(d.categoryName) : "",
      subcategoryId: subId,
      subcategoryName: d.subcategoryName != null ? String(d.subcategoryName) : "",
      fromSuggestionId: suggestion.id || null,
    };
    existing.push(entry);
  }
  try {
    const payload = {
      status: "draft",
      isActive: true,
      manualItems: existing,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    };
    if (ref) {
      await setDoc(ref, payload, { merge: true });
    } else {
      // No active draft exists — create one now.
      const newRef = await addDoc(collection(db, `salons/${salonId}/inventoryDrafts`), {
        ...payload,
        selectedSubcategoryIds: [],
        orderName: "",
        createdAt: serverTimestamp(),
        createdBy: uid,
      });
      invState._invActiveDraftId = newRef.id;
    }
  } catch (e) {
    console.error("[Inventory] Add to Order — draft save failed:", e && (e.code || e.message) ? (e.code || e.message) : e);
    try {
      if (typeof window !== "undefined" && typeof window.alert === "function") {
        window.alert("Could not save item to Create Order draft:\n" + (e && (e.code || e.message) ? (e.code || e.message) : String(e)));
      }
    } catch (_) {}
    return false;
  }

  // Step 3: navigate to Inventory → Create Order. The tab will reload the draft (now containing the new item).
  invState._invOrderDraftLoaded = false;
  await goToInventory();
  invState._invMainTab = "orderBuilder";
  invState._invObPickPanelOpen = false;
  invState._invOrderBuilderPreviewLoading = true;
  mountOrRefreshMockUi();
  await loadInventoryOrderDraft(true);
  void refreshOrderBuilderPreviewAsync();
  return true;
}

export {
  bindOrderDetailRowLongPressOnce,
  closeInventoryDraftsPicker,
  commitInventoryOrderBuilderAddItem,
  commitOrderLineInventoryPrice,
  confirmInventoryOrderPurchase,
  confirmInventoryOrderReceived,
  createNewInventoryOrderDraft,
  deleteInventoryDraftFromPicker,
  deleteInventoryOrderDraftConfirmed,
  deleteInventoryOrderReceipt,
  duplicateInventoryOrderDraft,
  ensureInventoryOrderReceiptsSubscription,
  ensureShoppingDraft,
  ffAddInventorySuggestionToOrder,
  handleOrderBuilderSourceChange,
  inventoryOrderDraftToast,
  isInvOrderDetailCommitBusy,
  loadInventoryOrderDraft,
  loadInventoryOrdersList,
  loadLinkPickerItemsForSub,
  markInventoryOrderOrderedConfirmed,
  openInventoryDraftsPicker,
  prepareOrderBuilderPreviewForMount,
  refreshOrderBuilderPreviewAsync,
  renameInventoryOrderConfirmed,
  renderInventoryDraftsPickerModal,
  renderInventoryOrderBuilderAddItemModal,
  renderInventoryOrderDetailModal,
  renderInventoryOrdersDeleteModal,
  renderInventoryOrdersMarkOrderedModal,
  renderInventoryOrdersMenu,
  renderInventoryOrdersRenameModal,
  renderOrderDetailLineViewModal,
  renderOrderListSectionHtml,
  renderOrdersTabHtml,
  renderReceiptInfoModal,
  saveInventoryOrderDraft,
  scheduleInventoryOrderDraftSave,
  switchActiveInventoryDraft,
  syncOrderBuilderCategoryCheckboxIndeterminate,
  toggleShoppingRowQty,
  triggerOrderDetailExportCsv,
  triggerOrderDetailPrint,
};
