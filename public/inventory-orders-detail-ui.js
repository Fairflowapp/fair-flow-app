// inventory-orders-detail-ui.js
// Orders detail — UI (modal render, export/print, row interactions). Extracted verbatim from inventory-orders-detail.js.
// Firestore commits & local drafts live in inventory-orders-detail-commit.js.

import { invState } from "./inventory-state.js?v=20260627_inventory_split";
import {
  escapeHtml,
  parseNum,
  getItemOrderQty,
  getItemReceivedCumulative,
  getOrderDetailTotals,
  getOrderLineReceiveVisualState,
  escapeCsvCell,
  getOrderItemGroupLabel,
  getOrderDetailExportFilename,
  getOrderReceiveSummaryCounts,
  formatOrderDisplay,
  formatInventoryOrderSourceLabel,
  getInventoryOrderDisplayName,
  formatInventoryOrderCreatedAt,
  formatInventoryOrderStatusDisplay,
  formatInventoryOrderOrderedByDisplay,
  sortOrderDetailPairsOpenFirst,
} from "./inventory-helpers.js?v=20260627_inventory_split";
import {
  isInvOrderDetailCommitBusy,
  parseInventoryCellRefFromOrderLine,
  ensureShoppingDraft,
} from "./inventory-orders-detail-commit.js?v=20260702_inventory_orders_detail_split";

// ── injected by initOrdersDetailUi() (orchestrator spine) ──
let mountOrRefreshMockUi;
export function initOrdersDetailUi(deps) {
  ({ mountOrRefreshMockUi } = deps);
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
