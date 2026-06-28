// inventory-orders-detail.js
// Orders sub-app — detail. Extracted verbatim from inventory-orders.js.
// Shared state in inventory-state.js; orchestrator/back-edge deps injected via initOrdersDetail().

import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  runTransaction,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
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
  getOrderLineReceiveVisualState,
  escapeCsvCell,
  getOrderItemGroupLabel,
  getOrderDetailExportFilename,
  getOrderReceiveSummaryCounts,
  isItemPurchaseAppliedToInventory,
  formatOrderDisplay,
  formatInventoryOrderSourceLabel,
  getInventoryOrderDisplayName,
  formatInventoryOrderCreatedAt,
  formatInventoryOrderStatusDisplay,
  formatInventoryOrderOrderedByDisplay,
  sortOrderDetailPairsOpenFirst,
} from "./inventory-helpers.js?v=20260627_inventory_split";
import { inventoryOrderDraftToast } from "./inventory-orders-core.js?v=20260627_inventory_orders_split";
import { loadInventoryOrdersList } from "./inventory-orders-list.js?v=20260627_inventory_orders_split";

// ── injected by initOrdersDetail() (orchestrator spine + builder back-edges) ──
let getSalonId, mountOrRefreshMockUi, getSelectedSubMeta, loadInventoryTableForSub, findCategoryAndSubForSubId;
export function initOrdersDetail(deps) {
  ({ getSalonId, mountOrRefreshMockUi, getSelectedSubMeta, loadInventoryTableForSub, findCategoryAndSubForSubId } = deps);
}


export function isInvOrderDetailCommitBusy() {
  return invState._invOrderReceiveBusy || invState._invOrderPurchaseBusy || invState._invOrderInvPriceBusy;
}

/**
 * Resolve Firestore inventory cell coordinates from a saved order line (auto, linked, or legacy).
 * @returns {{ catId: string, subId: string, rowId: string, groupId: string } | null}
 */
export function parseInventoryCellRefFromOrderLine(it) {
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
export async function commitOrderLineInventoryPrice(orderId, lineIdx, rawVal) {
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

export function orderDetailLineMatchesFilter(it) {
  if (invState._invOrderDetailFilter === "all") return true;
  const { kind } = getOrderLineReceiveVisualState(it);
  if (invState._invOrderDetailFilter === "open") return kind === "open" || kind === "partial";
  if (invState._invOrderDetailFilter === "received") return kind === "received";
  return true;
}

export function getOrderDetailDisplayPairsForExport(o) {
  const items = Array.isArray(o.items) ? o.items : [];
  const filteredPairs = items
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => orderDetailLineMatchesFilter(it));
  return sortOrderDetailPairsOpenFirst(filteredPairs);
}

export function buildOrderDetailCsvContent(o) {
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

export function buildOrderDetailPrintDocumentHtml(o) {
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

export function triggerOrderDetailExportCsv() {
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

export function triggerOrderDetailPrint() {
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

export function ensureDetailReceiveDraft(orderId) {
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
export function ensureShoppingDraft(orderId) {
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

export function formatOrderDetailEstimatedCost(n) {
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

/**
 * Confirm receive from Order Details: checked lines only; updates `items[].receivedCumulative`, status, inventory `current`.
 * @param {string} orderId
 */
export async function confirmInventoryOrderReceived(orderId) {
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
export async function confirmInventoryOrderPurchase(orderId) {
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

export function renderOrderDetailLineViewModal() {
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

export function renderInventoryOrderDetailModal() {
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

/**
 * Toggle the Bought (B) quantity for a shopping row driven by its checkbox.
 * "Got exactly what's needed" — B = 0 → N (check), B = N or complete → 0 (uncheck),
 * partial B (0 < B < N) → complete to N.
 */
export function toggleShoppingRowQty(oid, idx) {
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

/**
 * Long-press (~500ms) on an Order Details row opens Line details. Normal tap still toggles ✓ via row click.
 * Eats the next click on that row so the release after long-press does not toggle the checkbox.
 */
export function bindOrderDetailRowLongPressOnce(root) {
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
