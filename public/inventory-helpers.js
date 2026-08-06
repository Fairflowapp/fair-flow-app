// inventory-helpers.js
// Pure, stateless helpers extracted verbatim from inventory.js (step 2 of the
// gradual split): id generators, parsers, data transforms, order/receive math,
// display formatters, and a few pure HTML builders. No DOM, no Firestore, no
// module state, no window. One-way dependency: inventory.js -> inventory-helpers.js.

export const INV_PRODUCTS_SUB_SUFFIX = "::products::";

export const SHARED_INV_DEFAULT_GROUP_ID = "default";

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function newRowId() {
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function newGroupId() {
  return `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function newCategoryId() {
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function newSubcategoryId() {
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function sharedInvSort(a, b) {
  return (Number(a.sortOrder ?? a.order) || 0) - (Number(b.sortOrder ?? b.order) || 0)
    || String(a.name || "").localeCompare(String(b.name || ""));
}

export const INV_PRODUCTS_GENERAL_SUB = "__general__";

export function productsInventorySubId(categoryId, productSubId) {
  return `${String(categoryId)}${INV_PRODUCTS_SUB_SUFFIX}${String(productSubId || INV_PRODUCTS_GENERAL_SUB)}`;
}

export function isProductsInventorySub(sub) {
  return !!(sub && sub.isProductsSub);
}

export function isProductsInventorySubId(subId) {
  return typeof subId === "string" && subId.includes(INV_PRODUCTS_SUB_SUFFIX);
}

export function productCategoryIdFromProductsSub(sub) {
  if (sub && sub.productCategoryId) return String(sub.productCategoryId);
  const id = sub && sub.id ? String(sub.id) : "";
  const idx = id.indexOf(INV_PRODUCTS_SUB_SUFFIX);
  return idx >= 0 ? id.slice(0, idx) : "";
}

export function productSubcategoryIdFromProductsSub(sub) {
  if (sub && sub.productSubcategoryId != null) return String(sub.productSubcategoryId);
  const id = sub && sub.id ? String(sub.id) : "";
  const idx = id.indexOf(INV_PRODUCTS_SUB_SUFFIX);
  return idx >= 0 ? id.slice(idx + INV_PRODUCTS_SUB_SUFFIX.length) : INV_PRODUCTS_GENERAL_SUB;
}

export function getProductStockForInventoryRow(product, activeLoc) {
  const inv = product.inventory && typeof product.inventory === "object" ? product.inventory : {};
  const locO =
    activeLoc && product.locationOverrides && product.locationOverrides[activeLoc]
      ? product.locationOverrides[activeLoc]
      : null;
  if (locO && Number.isFinite(Number(locO.stock))) return Number(locO.stock);
  if (Number.isFinite(Number(inv.stock))) return Number(inv.stock);
  return 0;
}

export function getProductTargetStockForInventoryRow(product, activeLoc) {
  const inv = product.inventory && typeof product.inventory === "object" ? product.inventory : {};
  const locO =
    activeLoc && product.locationOverrides && product.locationOverrides[activeLoc]
      ? product.locationOverrides[activeLoc]
      : null;
  if (locO && Number.isFinite(Number(locO.targetStock))) return Number(locO.targetStock);
  if (Number.isFinite(Number(inv.targetStock))) return Number(inv.targetStock);
  // No target set yet → fall back to on-hand so Order shows 0 (no false demand).
  return getProductStockForInventoryRow(product, activeLoc);
}

export function getProductPriceForInventoryRow(product, activeLoc) {
  const locO =
    activeLoc && product.locationOverrides && product.locationOverrides[activeLoc]
      ? product.locationOverrides[activeLoc]
      : null;
  if (locO && Number.isFinite(Number(locO.price))) return Number(locO.price);
  return Number.isFinite(Number(product.retailPrice)) ? Number(product.retailPrice) : 0;
}

export function productToInvRow(product, activeLoc, rowNo) {
  const onHand = getProductStockForInventoryRow(product, activeLoc);
  const target = getProductTargetStockForInventoryRow(product, activeLoc);
  const price = getProductPriceForInventoryRow(product, activeLoc);
  const inv = product.inventory && typeof product.inventory === "object" ? product.inventory : {};
  const supplier = String(product.vendor || inv.vendor || product.brand || "").trim();
  return {
    id: product.id,
    rowNo: String(rowNo + 1),
    code: "",
    name: String(product.name || "").trim(),
    supplier,
    url: "",
    _isProductRow: true,
    _productId: product.id,
    byGroup: {
      [SHARED_INV_DEFAULT_GROUP_ID]: {
        stock: target,
        current: onHand,
        price: price > 0 ? String(price) : "",
        approved: 0,
        approvedRequests: [],
      },
    },
  };
}

export function getProductCatSubsList(cat) {
  const arr = cat && Array.isArray(cat.subcategories) ? cat.subcategories : [];
  return arr
    .slice()
    .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0))
    .map((s) => ({ id: String(s.id), name: s.name || "Subcategory" }));
}

export function buildProductsInventorySubsForCat(cat, catProducts) {
  const catId = String(cat.id);
  const subs = getProductCatSubsList(cat);
  const subIds = new Set(subs.map((s) => s.id));
  const result = subs.map((s) => ({
    id: productsInventorySubId(catId, s.id),
    name: s.name,
    isProductsSub: true,
    productCategoryId: catId,
    productSubcategoryId: s.id,
  }));
  const hasGeneral = catProducts.some((p) => !p.subcategoryId || !subIds.has(String(p.subcategoryId)));
  if (hasGeneral || !subs.length) {
    result.push({
      id: productsInventorySubId(catId, INV_PRODUCTS_GENERAL_SUB),
      name: subs.length ? "General" : "Products",
      isProductsSub: true,
      productCategoryId: catId,
      productSubcategoryId: INV_PRODUCTS_GENERAL_SUB,
    });
  }
  return { subs: result, subIds };
}

export function cloneCategoryTree(tree) {
  return tree.map((c) => ({
    id: c.id,
    name: c.name,
    ...(c.isProductCategory ? { isProductCategory: true } : {}),
    subcategories: (c.subcategories || []).map((s) => ({
      id: s.id,
      name: s.name,
      ...(s.isProductsSub ? { isProductsSub: true, productCategoryId: s.productCategoryId } : {}),
    })),
  }));
}

export function normalizeApprovedRequestEntry(x) {
  if (!x || typeof x !== "object") return null;
  const requestId = x.requestId != null ? String(x.requestId).trim() : "";
  if (!requestId) return null;
  const qty = typeof x.qty === "number" ? x.qty : parseNum(x.qty);
  if (!Number.isFinite(qty) || qty === 0) return null;
  /** @type {Record<string, unknown>} */
  const out = { requestId, qty };
  if (x.at) out.at = x.at;
  if (x.by != null) out.by = String(x.by);
  if (x.byName != null) out.byName = String(x.byName);
  if (x.itemName != null) out.itemName = String(x.itemName);
  if (x.note != null) out.note = String(x.note);
  if (x.unit != null) out.unit = String(x.unit);
  return out;
}

export function normalizeRowFromFirestore(r) {
  const byGroup = {};
  const raw = r && r.byGroup && typeof r.byGroup === "object" ? r.byGroup : {};
  for (const gid of Object.keys(raw)) {
    const cell = raw[gid];
    if (!cell || typeof cell !== "object") continue;
    const approvedRequestsRaw = Array.isArray(cell.approvedRequests) ? cell.approvedRequests : [];
    const approvedRequests = [];
    for (const entry of approvedRequestsRaw) {
      const ne = normalizeApprovedRequestEntry(entry);
      if (ne) approvedRequests.push(ne);
    }
    let approved =
      typeof cell.approved === "number"
        ? cell.approved
        : cell.approved != null
          ? parseNum(cell.approved)
          : 0;
    if (!Number.isFinite(approved)) approved = 0;
    if (approvedRequests.length > 0) {
      const sum = approvedRequests.reduce((acc, e) => acc + (Number(e.qty) || 0), 0);
      if (Math.abs(sum - approved) > 0.0001) approved = sum;
    }
    byGroup[gid] = {
      stock: typeof cell.stock === "number" ? cell.stock : parseNum(cell.stock),
      current: typeof cell.current === "number" ? cell.current : parseNum(cell.current),
      price: cell.price != null ? String(cell.price) : "",
      approved,
      approvedRequests,
    };
  }
  return {
    id: r.id || newRowId(),
    rowNo: r.rowNo != null ? String(r.rowNo) : "",
    code: r.code != null ? String(r.code) : "",
    name: r.name != null ? String(r.name) : "",
    supplier: r.supplier != null ? String(r.supplier) : "",
    url: r.url != null ? String(r.url) : "",
    byGroup,
  };
}

export function serializeInventoryRowForFirestore(r) {
  const byGroup = {};
  for (const gid of Object.keys(r.byGroup || {})) {
    const c = r.byGroup[gid];
    if (!c) continue;
    const approvedRequestsIn = Array.isArray(c.approvedRequests) ? c.approvedRequests : [];
    const approvedRequests = [];
    for (const entry of approvedRequestsIn) {
      const ne = normalizeApprovedRequestEntry(entry);
      if (ne) approvedRequests.push(ne);
    }
    const approved = approvedRequests.reduce((acc, e) => acc + (Number(e.qty) || 0), 0);
    /** @type {Record<string, unknown>} */
    const out = {
      stock: typeof c.stock === "number" ? c.stock : parseNum(c.stock),
      current: typeof c.current === "number" ? c.current : parseNum(c.current),
      price: c.price != null ? String(c.price) : "",
    };
    if (approved > 0) out.approved = approved;
    if (approvedRequests.length > 0) out.approvedRequests = approvedRequests;
    byGroup[gid] = out;
  }
  return {
    id: r.id,
    rowNo: r.rowNo != null ? String(r.rowNo) : "",
    code: r.code != null ? String(r.code) : "",
    name: r.name != null ? String(r.name) : "",
    supplier: r.supplier != null ? String(r.supplier) : "",
    url: r.url != null ? String(r.url) : "",
    byGroup,
  };
}

export function defaultInvColWidthsObj() {
  return {
    rowDnd: 28,
    hash: 52,
    code: 76,
    name: 192,
    supplier: 96,
    url: 96,
    groupSubById: {},
  };
}

export function cloneInvRowForUndo(r) {
  const byGroup = {};
  for (const k of Object.keys(r.byGroup || {})) {
    const c = r.byGroup[k];
    if (!c) continue;
    byGroup[k] = {
      stock: typeof c.stock === "number" ? c.stock : parseNum(c.stock),
      current: typeof c.current === "number" ? c.current : parseNum(c.current),
      price: String(c.price ?? ""),
    };
  }
  return {
    id: r.id,
    rowNo: String(r.rowNo ?? ""),
    code: String(r.code ?? ""),
    name: String(r.name ?? ""),
    supplier: String(r.supplier ?? ""),
    url: String(r.url ?? ""),
    byGroup,
  };
}

export function parseNum(v) {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

export function parseRowIdFromInventoryItemId(itemId) {
  const s = String(itemId ?? "").trim();
  if (!s) return "";
  const parts = s.split(":");
  if (parts.length >= 3) {
    return parts.slice(1, -1).join(":");
  }
  return s;
}

export function getItemOrderQty(it) {
  if (it == null || typeof it !== "object") return 0;
  return typeof it.orderQty === "number" ? it.orderQty : parseNum(it.orderQty);
}

export function getItemReceivedCumulative(it) {
  if (it == null || typeof it !== "object") return 0;
  if (it.receivedCumulative != null) return parseNum(it.receivedCumulative);
  return 0;
}

export function getOrderLinePrice(it) {
  if (it == null || typeof it !== "object") return 0;
  if (it.price == null || it.price === "") return 0;
  return typeof it.price === "number" ? it.price : parseNum(it.price);
}

export function getOrderDetailTotals(items) {
  const arr = Array.isArray(items) ? items : [];
  let orderedQty = 0;
  let receivedQty = 0;
  let estimatedCost = 0;
  for (const it of arr) {
    const oq = getItemOrderQty(it);
    const cum = getItemReceivedCumulative(it);
    const price = getOrderLinePrice(it);
    orderedQty += oq;
    receivedQty += cum;
    estimatedCost += oq * price;
  }
  const r = Math.round(estimatedCost * 100) / 100;
  return { lineCount: arr.length, orderedQty, receivedQty, estimatedCost: r };
}

export function getItemEffectiveReceivedQty(it) {
  const cum = getItemReceivedCumulative(it);
  const applied = isItemPurchaseAppliedToInventory(it) ? getItemStoredQtyBought(it) : 0;
  return Math.max(cum, applied);
}

export function computeUnifiedStatusFromItems(items) {
  const arr = Array.isArray(items) ? items : [];
  if (arr.length === 0) return "open";
  let hasAny = false;
  let allFull = true;
  for (const it of arr) {
    const oq = getItemOrderQty(it);
    const b = getItemEffectiveReceivedQty(it);
    if (b > 0) hasAny = true;
    if (oq <= 0) continue;
    if (b < oq) allFull = false;
  }
  if (!hasAny) return "open";
  if (allFull) return "done";
  return "in_progress";
}

export function computeReceiveStatusFromItems(items) {
  return computeUnifiedStatusFromItems(items);
}

export function getEffectiveInventoryOrderStatus(o) {
  if (!o || typeof o !== "object") return "open";
  const items = Array.isArray(o.items) ? o.items : [];
  return computeUnifiedStatusFromItems(items);
}

export function orderHasAppliedInventoryImpact(o) {
  if (!o || typeof o !== "object") return false;
  const items = Array.isArray(o.items) ? o.items : [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    if (it.appliedToInventory === true) return true;
    if (getItemReceivedCumulative(it) > 0) return true;
  }
  return false;
}

export function getOrderLineReceiveVisualState(it) {
  const oq = getItemOrderQty(it);
  const progress = getItemEffectiveReceivedQty(it);
  if (progress === 0) {
    return {
      kind: "open",
      rowClass: "ff-inv2-od-tr--open",
      label: "Open",
      badgeClass: "ff-inv2-od-line-badge--open",
    };
  }
  if (oq > 0 && progress >= oq) {
    return {
      kind: "received",
      rowClass: "ff-inv2-od-tr--recv-full",
      label: "Received",
      badgeClass: "ff-inv2-od-line-badge--full",
    };
  }
  return {
    kind: "partial",
    rowClass: "ff-inv2-od-tr--recv-partial",
    label: "Partial",
    badgeClass: "ff-inv2-od-line-badge--partial",
  };
}

export const _invOrderDetailKindRank = { open: 0, partial: 1, received: 2 };

export function sortOrderDetailPairsOpenFirst(filteredPairs) {
  return [...filteredPairs].sort((a, b) => {
    const ka = getOrderLineReceiveVisualState(a.it).kind;
    const kb = getOrderLineReceiveVisualState(b.it).kind;
    const ra = _invOrderDetailKindRank[ka] ?? 99;
    const rb = _invOrderDetailKindRank[kb] ?? 99;
    if (ra !== rb) return ra - rb;
    return a.idx - b.idx;
  });
}

export function escapeCsvCell(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function getOrderItemGroupLabel(it) {
  if (!it || it.groupName == null) return "";
  return String(it.groupName).trim();
}

export function sanitizeOrderExportFilenamePart(s) {
  return (
    String(s ?? "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 80) || "order"
  );
}

export function getOrderDetailExportFilename(o) {
  const name = sanitizeOrderExportFilenamePart(getInventoryOrderDisplayName(o));
  const st = sanitizeOrderExportFilenamePart(formatInventoryOrderStatusDisplay(o));
  return `${name}_${st}.csv`;
}

export function getOrderReceiveSummaryCounts(items) {
  let open = 0;
  let partial = 0;
  let received = 0;
  let remainingQty = 0;
  for (const it of items) {
    const { kind } = getOrderLineReceiveVisualState(it);
    if (kind === "open") open += 1;
    else if (kind === "partial") partial += 1;
    else if (kind === "received") received += 1;
    const oq = getItemOrderQty(it);
    const cum = getItemReceivedCumulative(it);
    remainingQty += Math.max(0, oq - cum);
  }
  return { open, partial, received, remainingQty };
}

export function getItemStoredQtyBought(it) {
  if (!it || typeof it !== "object" || it.qtyBought == null) return 0;
  return parseNum(it.qtyBought);
}

export function isItemPurchaseAppliedToInventory(it) {
  return !!(it && typeof it === "object" && it.appliedToInventory === true);
}

export function computeOrder(stock, current, approved) {
  const s = typeof stock === "number" ? stock : parseNum(stock);
  const c = typeof current === "number" ? current : parseNum(current);
  const a = approved == null ? 0 : typeof approved === "number" ? approved : parseNum(approved);
  return Math.max(0, s - c) + Math.max(0, a);
}

export function getCellApprovedInfo(cell) {
  if (!cell || typeof cell !== "object") return { approved: 0, approvedRequests: [] };
  const approvedRequests = Array.isArray(cell.approvedRequests) ? cell.approvedRequests : [];
  const approved =
    approvedRequests.length > 0
      ? approvedRequests.reduce((acc, e) => acc + (typeof e?.qty === "number" ? e.qty : parseNum(e?.qty)), 0)
      : typeof cell.approved === "number"
        ? cell.approved
        : cell.approved != null
          ? parseNum(cell.approved)
          : 0;
  return { approved: Number.isFinite(approved) ? approved : 0, approvedRequests };
}

export function formatOrderDisplay(n) {
  if (Number.isInteger(n)) return String(n);
  const r = Math.round(n * 100) / 100;
  return String(r);
}

export function ensureGroupCellsForLocal(groups, rows) {
  if (!groups || !rows) return;
  for (const row of rows) {
    if (row.rowNo === undefined) row.rowNo = "";
    for (const g of groups) {
      if (!row.byGroup[g.id]) {
        row.byGroup[g.id] = { stock: 0, current: 0, price: "" };
      }
    }
  }
}

export function parseSubcategoryDocToTable(data) {
  const groupsRaw = Array.isArray(data.groups) ? data.groups : [];
  groupsRaw.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const groups = groupsRaw.map((g) => ({
    id: g.id,
    label: g.name != null ? String(g.name) : "",
  }));
  const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
  const rows = rowsRaw.map((r) => normalizeRowFromFirestore(r));
  ensureGroupCellsForLocal(groups, rows);
  return { groups, rows };
}

export function buildOrderLinesFromGroupsRows(groups, rows, subId, subName, categoryId, categoryName) {
  if (!groups || !rows) return [];
  const lines = [];
  const subLabel = subName != null ? String(subName) : "";
  const catId = categoryId != null ? String(categoryId) : null;
  const catNm = categoryName != null ? String(categoryName) : null;
  for (const row of rows) {
    for (const g of groups) {
      const cell = row.byGroup[g.id];
      if (!cell) continue;
      const { approved } = getCellApprovedInfo(cell);
      const oq = computeOrder(cell.stock, cell.current, approved);
      if (oq <= 0) continue;
      lines.push({
        itemId: `${subId}:${row.id}:${g.id}`,
        rowNo: String(row.rowNo ?? ""),
        code: String(row.code ?? ""),
        itemName: String(row.name ?? ""),
        supplier: String(row.supplier ?? ""),
        url: String(row.url ?? ""),
        groupId: g.id,
        groupName: String(g.label ?? ""),
        orderQty: oq,
        price: String(cell.price ?? ""),
        categoryId: catId,
        categoryName: catNm,
        subcategoryId: subId,
        subcategoryName: subLabel,
      });
    }
  }
  return lines;
}

export function sortOrderBuilderLines(lines) {
  lines.sort((a, b) => {
    const sa = String(a.subcategoryName || "");
    const sb = String(b.subcategoryName || "");
    if (sa !== sb) return sa.localeCompare(sb);
    const ca = String(a.code || "");
    const cb = String(b.code || "");
    if (ca !== cb) return ca.localeCompare(cb);
    return String(a.itemName || "").localeCompare(String(b.itemName || ""));
  });
}

export function seedOrderBuilderSelectionIfEmpty() {
  // intentionally empty
}

export function sanitizeManualItemForDraft(item) {
  if (!item || typeof item !== "object") return null;
  /** @type {Record<string, unknown>} */
  const out = {};
  const copyKeys = [
    "id",
    "itemName",
    "orderQty",
    "isManual",
    "linkedInventoryItemId",
    "code",
    "groupId",
    "groupName",
    "categoryId",
    "categoryName",
    "subcategoryId",
    "subcategoryName",
    "fromSuggestionId",
  ];
  for (const k of copyKeys) {
    const v = item[k];
    if (v === undefined) continue;
    out[k] = v;
  }
  if (typeof out.orderQty !== "number") {
    const n = Number(out.orderQty);
    out.orderQty = Number.isFinite(n) ? n : 0;
  }
  if (!out.id) out.id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return out;
}

export function renderDraftsPickerRowHtml(draft) {
  const idEsc = escapeHtml(draft.id);
  const isActive = draft.isActive;
  const itemCount = Array.isArray(draft.manualItems) ? draft.manualItems.length : 0;
  const name = draft.orderName && draft.orderName.trim() ? draft.orderName.trim() : "Untitled draft";
  const updated = draft.updatedAt
    ? new Date(draft.updatedAt).toLocaleString()
    : draft.createdAt
      ? new Date(draft.createdAt).toLocaleString()
      : "—";
  const switchBtn = isActive
    ? `<span class="ff-inv2-drafts-picker-current">Current</span>`
    : `<button type="button" class="ff-inv2-drafts-picker-switch" data-inv-drafts-picker-switch="${idEsc}">Switch</button>`;
  return `<li class="ff-inv2-drafts-picker-row${isActive ? " ff-inv2-drafts-picker-row--active" : ""}">
  <div class="ff-inv2-drafts-picker-main">
    <div class="ff-inv2-drafts-picker-name">${escapeHtml(name)}</div>
    <div class="ff-inv2-drafts-picker-meta">${itemCount} item${itemCount === 1 ? "" : "s"} · ${escapeHtml(updated)}</div>
  </div>
  <div class="ff-inv2-drafts-picker-actions">
    ${switchBtn}
    <button type="button" class="ff-inv2-drafts-picker-delete" data-inv-drafts-picker-delete="${idEsc}" aria-label="Delete draft" title="Delete draft">🗑</button>
  </div>
</li>`;
}

export function formatInventoryOrderSourceLabel(data) {
  if (!data || typeof data !== "object") return "—";
  const st = data.sourceType;
  const sel = data.sourceSelection;
  if (st && sel && typeof sel === "object") {
    if (st === "subcategory") {
      const cat = sel.categoryName != null ? String(sel.categoryName) : "";
      const sub =
        Array.isArray(sel.subcategoryNames) && sel.subcategoryNames.length
          ? String(sel.subcategoryNames[0])
          : "";
      if (cat && sub) return `${cat} > ${sub}`;
      if (cat) return sub ? `${cat} > ${sub}` : cat;
      return sub || "—";
    }
    if (st === "category") {
      return sel.categoryName != null ? String(sel.categoryName) : sel.categoryId != null ? String(sel.categoryId) : "—";
    }
    if (st === "custom") {
      const n = Array.isArray(sel.subcategoryIds) ? sel.subcategoryIds.length : 0;
      return `Custom (${n} subcategories)`;
    }
  }
  const cat = data.categoryName != null ? String(data.categoryName) : "";
  const sub = data.subcategoryName != null ? String(data.subcategoryName) : "";
  if (sub) return cat ? `${cat} > ${sub}` : sub;
  return cat || "—";
}

export function getInventoryOrderDisplayName(o) {
  if (!o || typeof o !== "object") return "Order";
  const raw = o.orderName != null ? String(o.orderName).trim() : "";
  if (raw !== "") return raw;
  const lbl = formatInventoryOrderSourceLabel(o);
  return lbl !== "—" ? lbl : "Order";
}

export function formatInventoryOrderCreatedAt(ts) {
  if (!ts) return "—";
  let d = null;
  if (typeof ts.toDate === "function") {
    try {
      d = ts.toDate();
    } catch (e) {
      d = null;
    }
  }
  if (!d && ts.seconds != null) {
    d = new Date(Number(ts.seconds) * 1000);
  }
  if (!d || Number.isNaN(d.getTime())) return "—";
  try {
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch (e) {
    return d.toISOString();
  }
}

export function formatInventoryOrderStatusDisplay(o) {
  const s = getEffectiveInventoryOrderStatus(o);
  if (s === "open") return "open";
  if (s === "in_progress") return "in progress";
  if (s === "done") return "done";
  return s;
}

export function getInventoryOrderStatusKey(o) {
  const s = getEffectiveInventoryOrderStatus(o);
  if (s === "open" || s === "in_progress" || s === "done") return s;
  return "open";
}

export function getOrderSearchHaystack(o) {
  const parts = [getInventoryOrderDisplayName(o), formatInventoryOrderSourceLabel(o)];
  const items = Array.isArray(o.items) ? o.items : [];
  for (const it of items) {
    if (it && typeof it === "object") {
      if (it.itemName != null) parts.push(String(it.itemName));
      if (it.supplier != null) parts.push(String(it.supplier));
    }
  }
  return parts.join(" ").toLowerCase();
}

export function formatInventoryOrderOrderedByDisplay(uid) {
  if (uid == null || String(uid).trim() === "") return "—";
  return String(uid);
}

export function clonePlainForFirestoreOrderPayload(obj) {
  if (obj == null || typeof obj !== "object") return obj;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (e) {
    return obj;
  }
}

export function sanitizeReceiptStorageFileName(name) {
  const raw = String(name || "file")
    .replace(/[/\\]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return raw.slice(0, 180) || "file";
}

export function getReceiptFileTypeEmoji(fileName) {
  const s = String(fileName ?? "").toLowerCase();
  const dot = s.lastIndexOf(".");
  const ext = dot >= 0 ? s.slice(dot + 1) : "";
  if (ext === "pdf") return "📄";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic", "heif", "svg"].includes(ext)) return "🖼️";
  if (["txt", "csv", "log"].includes(ext)) return "📝";
  if (["doc", "docx", "rtf", "odt"].includes(ext)) return "📄";
  if (["xls", "xlsx", "ods"].includes(ext)) return "📊";
  return "📎";
}

export function ffParseDateInputStart(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

export function ffParseDateInputEnd(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
}

export function ffResolveItemEventDate(it, order) {
  const candidates = [it && it.appliedAt, it && it.lastReceivedAt, order && order.updatedAt, order && order.orderedAt, order && order.createdAt];
  for (const ts of candidates) {
    if (!ts) continue;
    if (typeof ts.toDate === "function") {
      try {
        return ts.toDate();
      } catch (e) {
        /* ignore */
      }
    }
    if (typeof ts === "object" && ts && typeof ts.seconds === "number") {
      return new Date(ts.seconds * 1000 + (typeof ts.nanoseconds === "number" ? ts.nanoseconds / 1e6 : 0));
    }
    if (typeof ts === "number") return new Date(ts);
    if (typeof ts === "string") {
      const d = new Date(ts);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

export function invCellKey(inv, rowId, groupId) {
  if (groupId != null && groupId !== "") return `${inv}:${rowId}:${groupId}`;
  return `${inv}:${rowId}`;
}

export function hrefForUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

export function renderOrderCellTd(rowId, groupId, order, approved) {
  const pos = order > 0;
  const hasApproved = (approved || 0) > 0;
  const classes = [
    "ff-inv2-order-cell",
    pos ? "ff-inv2-order-cell--positive" : "",
    hasApproved ? "ff-inv2-order-cell--has-approved" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<td class="${classes}" data-order-for-row="${escapeHtml(rowId)}" data-order-for-group="${escapeHtml(groupId)}" data-order-approved="${escapeHtml(String(approved || 0))}" title="${hasApproved ? "Includes approved supply requests — long-press for details" : ""}"><span class="ff-inv2-order-val">${escapeHtml(formatOrderDisplay(order))}</span></td>`;
}

export function thResizeHandle(kind, extraAttrs) {
  const ex = extraAttrs ? ` ${extraAttrs}` : "";
  return `<div class="col-resize-handle" data-inv-resize="${escapeHtml(kind)}"${ex} aria-hidden="true"></div>`;
}

export function renderInlineNewSub(catId) {
  return `<div class="ff-inv2-cat-manage-inline">
  <input type="text" class="ff-inv2-cat-manage-input" placeholder="Subcategory name" data-cat-new-sub-input="${escapeHtml(catId)}" />
  <button type="button" class="ff-inv2-cat-manage-mini" data-cat-new-sub-commit="${escapeHtml(catId)}">Add</button>
  <button type="button" class="ff-inv2-cat-manage-mini" data-cat-new-sub-cancel="1">Cancel</button>
</div>`;
}
