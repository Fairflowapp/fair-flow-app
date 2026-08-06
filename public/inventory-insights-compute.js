// inventory-insights-compute.js
// Inventory > Insights — analytics constants, date-range helpers, and the
// data load + compute pass. Extracted verbatim from inventory-insights.js.
// Results are written to invState._invInsights* for the UI module to render.

import { invState } from "./inventory-state.js?v=20260728_inv_mobile_unstick";
import {
  parseNum,
  ffParseDateInputStart,
  ffParseDateInputEnd,
  ffResolveItemEventDate,
  getEffectiveInventoryOrderStatus,
  parseSubcategoryDocToTable,
} from "./inventory-helpers.js?v=20260728_inv_mobile_unstick";
import { db } from "/app.js?v=20260610_force_lp_ios";
import {
  getDocs,
  collection,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// ── injected inventory.js internals (set once via initInsightsCompute) ──
let getSalonId;
let getCategoryTree;
let fetchSubcategoryInventoryDoc;
let _ffInvDocInActiveLoc;
let mountOrRefreshMockUi;

export function initInsightsCompute(deps) {
  ({
    getSalonId,
    getCategoryTree,
    fetchSubcategoryInventoryDoc,
    _ffInvDocInActiveLoc,
    mountOrRefreshMockUi,
  } = deps);
}

// ── insights constants ──
const INV_INSIGHTS_REORDER_DAYS = 7;
const INV_INSIGHTS_CRITICAL_DAYS = 7;
const INV_INSIGHTS_LOW_DAYS = 14;
const INV_INSIGHTS_LOW_THRESHOLD = 0.3;
const INV_INSIGHTS_DEAD_STOCK_MIN_CURRENT = 1;
const INV_INSIGHTS_CHART_COLORS = [
  "#7c3aed", // purple
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ec4899", // pink
  "#14b8a6", // teal
  "#ef4444", // red
  "#6366f1", // indigo
  "#84cc16", // lime
  "#64748b", // slate (reserved for "Other")
];

function getInventoryInsightsDateRange() {
  const now = new Date();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  if (invState._invInsightsRange === "all") return { from: null, to: null };
  if (invState._invInsightsRange === "custom") {
    return {
      from: ffParseDateInputStart(invState._invInsightsCustomFrom),
      to: ffParseDateInputEnd(invState._invInsightsCustomTo) || to,
    };
  }
  let days = 30;
  if (invState._invInsightsRange === "60d") days = 60;
  else if (invState._invInsightsRange === "120d") days = 120;
  else if (invState._invInsightsRange === "year") days = 365;
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1), 0, 0, 0, 0);
  return { from, to };
}

function getInventoryInsightsPrevRange() {
  const cur = getInventoryInsightsDateRange();
  if (!cur.from || !cur.to) return { from: null, to: null };
  const durationMs = cur.to.getTime() - cur.from.getTime();
  if (!(durationMs > 0)) return { from: null, to: null };
  const prevTo = new Date(cur.from.getTime() - 1);
  const prevFrom = new Date(cur.from.getTime() - durationMs - 1);
  return { from: prevFrom, to: prevTo };
}

async function refreshInventoryInsightsAsync() {
  if (invState._invMainTab !== "insights") return;
  const seq = ++invState._invInsightsLoadSeq;
  invState._invInsightsLoading = true;
  invState._invInsightsError = null;
  mountOrRefreshMockUi();
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    // Fetch orders (for purchases) and every subcategory doc (for stock health) in parallel.
    const ordersPromise = getDocs(collection(db, `salons/${salonId}/inventoryOrders`));
    const tree = getCategoryTree();
    const subFetches = [];
    for (const c of tree) {
      const subs = Array.isArray(c.subcategories) ? c.subcategories : [];
      for (const s of subs) {
        subFetches.push(
          fetchSubcategoryInventoryDoc(salonId, c.id, s.id)
            .then((data) => ({
              catId: String(c.id),
              catName: c.name != null ? String(c.name) : "",
              subId: String(s.id),
              subName: s.name != null ? String(s.name) : "",
              data,
            }))
            .catch((e) => {
              console.warn("[Inventory] insights sub fetch failed", c.id, s.id, e);
              return null;
            })
        );
      }
    }
    const [ordersSnap, subResults] = await Promise.all([ordersPromise, Promise.all(subFetches)]);
    if (seq !== invState._invInsightsLoadSeq) return;

    const { from, to } = getInventoryInsightsDateRange();
    const prevRange = getInventoryInsightsPrevRange();

    /** @type {Map<string, { name: string, totalQty: number }>} */
    const buckets = new Map();
    /** key = `${catId}:${subId}:${rowId}:${groupId}` → summed purchased qty in range */
    const activityByCell = new Map();
    /** key = categoryName → spend */
    const spendByCategory = new Map();
    const ordersWithActivity = new Set();
    let totalSpend = 0;
    let prevSpend = 0;

    ordersSnap.forEach((d) => {
      const order = { id: d.id, ...d.data() };
      if (!_ffInvDocInActiveLoc(order)) return;
      const items = Array.isArray(order.items) ? order.items : [];
      for (const it of items) {
        if (!it || typeof it !== "object") continue;
        const purchaseQty = it.appliedToInventory === true ? Number(it.qtyBought) : NaN;
        const receiveQty = Number(it.receivedCumulative);
        const purchaseValid = Number.isFinite(purchaseQty) && purchaseQty > 0;
        const receiveValid = Number.isFinite(receiveQty) && receiveQty > 0;
        if (!purchaseValid && !receiveValid) continue;
        const eventDate = ffResolveItemEventDate(it, order);
        // Previous-period tally for MoM comparison
        if (prevRange.from && prevRange.to && eventDate && eventDate >= prevRange.from && eventDate <= prevRange.to) {
          const qtyPrev = Math.max(purchaseValid ? purchaseQty : 0, receiveValid ? receiveQty : 0);
          const pricePrev = Number(it.price);
          if (Number.isFinite(pricePrev) && pricePrev > 0) {
            prevSpend += qtyPrev * pricePrev;
          }
        }
        if (from && eventDate && eventDate < from) continue;
        if (to && eventDate && eventDate > to) continue;
        if (!eventDate && invState._invInsightsRange !== "all") continue;
        const itemName = it.itemName != null ? String(it.itemName).trim() : "";
        if (!itemName) continue;
        const groupName = it.groupName != null ? String(it.groupName).trim() : "";
        const qty = Math.max(purchaseValid ? purchaseQty : 0, receiveValid ? receiveQty : 0);
        // Most Purchased bucket
        const keyName = `${itemName}__${groupName}`;
        const displayName = groupName ? `${itemName} (${groupName})` : itemName;
        const prevB = buckets.get(keyName) || { name: displayName, totalQty: 0 };
        prevB.totalQty += qty;
        buckets.set(keyName, prevB);
        // Activity by cell (for Dead Stock detection)
        const catId = it.categoryId != null ? String(it.categoryId).trim() : "";
        const subId = it.subcategoryId != null ? String(it.subcategoryId).trim() : "";
        const rowId = it.itemId != null && String(it.itemId).includes(":")
          ? String(it.itemId).split(":")[1] || ""
          : "";
        const groupId = it.groupId != null ? String(it.groupId).trim() : "";
        if (catId && subId && rowId && groupId) {
          const cellKey = `${catId}:${subId}:${rowId}:${groupId}`;
          activityByCell.set(cellKey, (activityByCell.get(cellKey) || 0) + qty);
        }
        // Category spend
        const price = Number(it.price);
        if (Number.isFinite(price) && price > 0) {
          const spend = qty * price;
          totalSpend += spend;
          const cn = it.categoryName != null && String(it.categoryName).trim() !== ""
            ? String(it.categoryName).trim()
            : "Uncategorized";
          spendByCategory.set(cn, (spendByCategory.get(cn) || 0) + spend);
        }
        ordersWithActivity.add(order.id);
      }
    });

    const rows = [];
    for (const [key, v] of buckets) {
      if (v.totalQty > 0) rows.push({ key, name: v.name, totalQty: v.totalQty });
    }
    rows.sort((a, b) => b.totalQty - a.totalQty || a.name.localeCompare(b.name));

    const categoryRows = Array.from(spendByCategory.entries())
      .map(([name, spend]) => ({ name, spend }))
      .sort((a, b) => b.spend - a.spend);
    const spendSum = categoryRows.reduce((acc, r) => acc + r.spend, 0) || 0;
    for (const r of categoryRows) {
      r.percent = spendSum > 0 ? Math.round((r.spend / spendSum) * 1000) / 10 : 0;
    }

    /** @type {typeof invState._invInsightsRunningLow} */
    const runningLow = [];
    /** @type {typeof invState._invInsightsDeadStock} */
    const deadStock = [];
    /** @type {typeof invState._invInsightsUsage} */
    const usage = [];
    // Determine the number of days used to compute the daily consumption rate.
    // For "all time", fall back to 90 days so the rate remains meaningful.
    let rateDays = 30;
    if (from && to) {
      const ms = to.getTime() - from.getTime();
      rateDays = Math.max(1, Math.round(ms / 86400000));
    } else {
      rateDays = 90;
    }
    for (const res of subResults) {
      if (!res || !res.data) continue;
      const { groups, rows: subRows } = parseSubcategoryDocToTable(res.data);
      for (const r of subRows) {
        for (const g of groups) {
          const cell = r.byGroup && r.byGroup[g.id];
          if (!cell) continue;
          const stock = typeof cell.stock === "number" ? cell.stock : parseNum(cell.stock);
          const current = typeof cell.current === "number" ? cell.current : parseNum(cell.current);
          const rowName = r.name != null ? String(r.name).trim() : "";
          if (!rowName) continue;
          const groupName = g.label != null ? String(g.label) : "";
          const base = {
            catId: res.catId,
            subId: res.subId,
            rowId: String(r.id),
            groupId: String(g.id),
            itemName: rowName,
            groupName,
            subcategoryName: res.subName,
            categoryName: res.catName,
          };
          if (stock > 0) {
            const pctLeft = current / stock;
            if (pctLeft <= INV_INSIGHTS_LOW_THRESHOLD) {
              runningLow.push({ ...base, stock, current, pctLeft });
            }
          }
          const cellKey = `${res.catId}:${res.subId}:${String(r.id)}:${String(g.id)}`;
          if (
            current >= INV_INSIGHTS_DEAD_STOCK_MIN_CURRENT &&
            !activityByCell.has(cellKey) &&
            invState._invInsightsRange !== "all"
          ) {
            deadStock.push({ ...base, current });
          }
          // Days of Stock Left — compute only when we have any activity or stock target to work from.
          const activityQty = activityByCell.get(cellKey) || 0;
          const dailyRate = activityQty > 0 ? activityQty / rateDays : 0;
          let daysLeft = Infinity;
          if (current <= 0) {
            daysLeft = 0;
          } else if (dailyRate > 0) {
            daysLeft = current / dailyRate;
          }
          const isFinite = Number.isFinite(daysLeft);
          // Only track cells that either have any activity, have a stock target, or are out of stock.
          if (activityQty > 0 || stock > 0 || current <= 0) {
            let level = "ok";
            if (isFinite) {
              if (daysLeft <= INV_INSIGHTS_CRITICAL_DAYS) level = "critical";
              else if (daysLeft <= INV_INSIGHTS_LOW_DAYS) level = "low";
            }
            usage.push({
              ...base,
              stock,
              current,
              dailyRate,
              daysLeft,
              level,
            });
          }
        }
      }
    }
    runningLow.sort((a, b) => a.pctLeft - b.pctLeft || b.stock - a.stock);
    deadStock.sort((a, b) => b.current - a.current || a.itemName.localeCompare(b.itemName));
    usage.sort((a, b) => {
      const ad = Number.isFinite(a.daysLeft) ? a.daysLeft : Number.POSITIVE_INFINITY;
      const bd = Number.isFinite(b.daysLeft) ? b.daysLeft : Number.POSITIVE_INFINITY;
      if (ad !== bd) return ad - bd;
      return b.dailyRate - a.dailyRate || a.itemName.localeCompare(b.itemName);
    });
    // Smart reorder suggestions = items forecast to run out within the reorder window AND have actual demand signal.
    const reorder = usage.filter(
      (u) => u.dailyRate > 0 && Number.isFinite(u.daysLeft) && u.daysLeft <= INV_INSIGHTS_REORDER_DAYS
    );

    // Count "Done" orders separately — only fully received/bought orders count as real purchases.
    let doneOrders = 0;
    ordersSnap.forEach((d) => {
      if (!ordersWithActivity.has(d.id)) return;
      const effStatus = getEffectiveInventoryOrderStatus({ id: d.id, ...d.data() });
      if (effStatus === "done") doneOrders += 1;
    });

    if (seq !== invState._invInsightsLoadSeq) return;
    let spendPctChange = null;
    if (prevSpend > 0) {
      spendPctChange = ((totalSpend - prevSpend) / prevSpend) * 100;
    } else if (totalSpend > 0) {
      spendPctChange = null; // No baseline — can't compare.
    }
    invState._invInsightsRows = rows;
    invState._invInsightsKpis = {
      totalSpend,
      doneOrders,
      totalOrders: ordersWithActivity.size,
      uniqueItems: rows.length,
      prevSpend,
      spendPctChange,
    };
    invState._invInsightsCategorySpend = categoryRows;
    invState._invInsightsRunningLow = runningLow;
    invState._invInsightsDeadStock = deadStock;
    invState._invInsightsUsage = usage;
    invState._invInsightsReorder = reorder;
  } catch (e) {
    console.error("[Inventory] insights load failed", e);
    if (seq !== invState._invInsightsLoadSeq) return;
    invState._invInsightsRows = [];
    invState._invInsightsKpis = { totalSpend: 0, doneOrders: 0, totalOrders: 0, uniqueItems: 0, prevSpend: 0, spendPctChange: null };
    invState._invInsightsCategorySpend = [];
    invState._invInsightsRunningLow = [];
    invState._invInsightsDeadStock = [];
    invState._invInsightsUsage = [];
    invState._invInsightsReorder = [];
    invState._invInsightsError = "Could not load insights data.";
  } finally {
    if (seq === invState._invInsightsLoadSeq) {
      invState._invInsightsLoading = false;
      mountOrRefreshMockUi();
    }
  }
}

export {
  INV_INSIGHTS_REORDER_DAYS,
  INV_INSIGHTS_LOW_DAYS,
  INV_INSIGHTS_LOW_THRESHOLD,
  INV_INSIGHTS_CHART_COLORS,
  refreshInventoryInsightsAsync,
};
