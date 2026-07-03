// inventory-insights.js
// Inventory > Insights sub-app: analytics tab (date range, data load + compute,
// rendering) plus the two background scans that emit reorder/suggestion alerts.
// Extracted verbatim from inventory.js. State is read/written via the shared
// invState object. Five inventory.js internals are injected (initInventoryInsights)
// to avoid a circular import with the orchestrator.

import { invState } from "./inventory-state.js?v=20260627_inventory_split";
import {
  escapeHtml,
  parseNum,
  ffParseDateInputStart,
  ffParseDateInputEnd,
  ffResolveItemEventDate,
  formatOrderDisplay,
  getEffectiveInventoryOrderStatus,
  getProductStockForInventoryRow,
  getProductTargetStockForInventoryRow,
  parseSubcategoryDocToTable,
} from "./inventory-helpers.js?v=20260627_inventory_split";
import { db } from "/app.js?v=20260610_force_lp_ios";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// ── injected inventory.js internals (set once via initInventoryInsights) ──
// Kept as module-level bindings so the moved function bodies stay byte-identical.
let getSalonId;
let getCategoryTree;
let fetchSubcategoryInventoryDoc;
let _ffInvDocInActiveLoc;
let mountOrRefreshMockUi;

export function initInventoryInsights(deps) {
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

async function scanInventorySuggestionsOnce() {
  if (invState._invSuggestionsScannedThisSession) return;
  invState._invSuggestionsScannedThisSession = true;
  try {
    const salonId = await getSalonId();
    if (!salonId) return;
    const user = auth.currentUser;
    if (!user) return;

    // Read the current user profile to satisfy inboxItems create rules.
    let userData = {};
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) userData = snap.data() || {};
    } catch (e) {
      console.warn("[Inventory] suggestion scan: user doc read failed", e);
      return;
    }
    const role = userData.role != null ? String(userData.role) : "";
    const roleLower = role.toLowerCase();
    // Only managers/admins/owners create system alerts — technicians would hit permission checks.
    if (!["manager", "admin", "owner"].includes(roleLower)) return;

    const uid = user.uid;
    const staffId = userData.staffId != null ? String(userData.staffId) : "";
    const displayName = userData.displayName || userData.name || "System";

    // Load existing inventory_suggestion items — dedup against ALL statuses.
    // Rationale: if a suggestion was already acted on (archived after Add to Order) or dismissed,
    // don't create a duplicate. The scanner re-enables re-alerts only after the user-facing doc
    // is fully removed (e.g. via archive-tab delete).
    const existingKeys = new Set();
    try {
      const existingSnap = await getDocs(
        query(
          collection(db, `salons/${salonId}/inboxItems`),
          where("type", "==", "inventory_suggestion")
        )
      );
      existingSnap.forEach((d) => {
        const data = d.data() || {};
        const nested = (data.data && typeof data.data === "object") ? data.data : {};
        const rowId = nested.rowId != null ? String(nested.rowId) : "";
        const groupId = nested.groupId != null ? String(nested.groupId) : "";
        if (rowId && groupId) existingKeys.add(`${rowId}:${groupId}`);
      });
    } catch (e) {
      console.warn("[Inventory] suggestion scan: existing alerts query failed", e);
      return;
    }

    // Fetch categories + subcategories in parallel. Scope to the active
    // location so suggestions are generated per-branch only.
    const catSnap = await getDocs(collection(db, `salons/${salonId}/inventoryCategories`));
    const cats = catSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter(_ffInvDocInActiveLoc);
    const perCatPromises = cats.map((c) =>
      getDocs(collection(db, `salons/${salonId}/inventoryCategories/${c.id}/inventorySubcategories`))
        .then((s) => ({
          cat: c,
          subs: s.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter(_ffInvDocInActiveLoc),
        }))
        .catch((e) => {
          console.warn("[Inventory] suggestion scan: sub load failed", c.id, e);
          return { cat: c, subs: [] };
        })
    );
    // Fetch orders in parallel (all orders — we filter dates/locations client-side).
    const ordersPromise = getDocs(collection(db, `salons/${salonId}/inventoryOrders`)).catch((e) => {
      console.warn("[Inventory] suggestion scan: orders load failed", e);
      return null;
    });
    const [perCat, ordersSnap] = await Promise.all([Promise.all(perCatPromises), ordersPromise]);
    if (!ordersSnap) return;

    // Build per-cell usage in the last ≤60 days.
    const now = Date.now();
    const cutoff = now - 60 * 86400000;
    /** @type {Map<string, { total: number, oldestMs: number }>} */
    const cellUsage = new Map();
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
        if (!eventDate) continue;
        const ms = eventDate.getTime();
        if (!(ms >= cutoff)) continue;
        const rowId = it.itemId && String(it.itemId).includes(":")
          ? String(it.itemId).split(":")[1] || ""
          : "";
        const groupId = it.groupId != null ? String(it.groupId).trim() : "";
        if (!rowId || !groupId) continue;
        const key = `${rowId}:${groupId}`;
        const qty = Math.max(purchaseValid ? purchaseQty : 0, receiveValid ? receiveQty : 0);
        const prev = cellUsage.get(key) || { total: 0, oldestMs: now };
        prev.total += qty;
        if (ms < prev.oldestMs) prev.oldestMs = ms;
        cellUsage.set(key, prev);
      }
    });

    let createdCount = 0;
    for (const { cat, subs } of perCat) {
      for (const sub of subs) {
        let groups;
        let rows;
        try {
          const parsed = parseSubcategoryDocToTable(sub);
          groups = parsed.groups;
          rows = parsed.rows;
        } catch (e) {
          console.warn("[Inventory] suggestion scan: parse sub failed", sub.id, e);
          continue;
        }
        for (const r of rows) {
          for (const g of groups) {
            const cell = r.byGroup && r.byGroup[g.id];
            if (!cell) continue;
            const current = typeof cell.current === "number" ? cell.current : parseNum(cell.current);
            if (!Number.isFinite(current) || current < 0) continue;
            const key = `${String(r.id)}:${String(g.id)}`;
            if (existingKeys.has(key)) continue;
            const usage = cellUsage.get(key);
            if (!usage || !(usage.total > 0)) continue;
            const daysWithData = Math.max(1, Math.ceil((now - usage.oldestMs) / 86400000));
            const lookbackDays = Math.min(60, daysWithData);
            const dailyUsage = usage.total / lookbackDays;
            if (!(dailyUsage > 0)) continue;
            const daysLeft = current > 0 ? current / dailyUsage : 0;
            if (!(daysLeft < 3)) continue;
            const suggestedQty = Math.max(1, Math.ceil(dailyUsage * 7));
            const itemName = r.name != null ? String(r.name).trim() : "";
            const groupName = g.label != null ? String(g.label) : "";
            // Stamp the suggestion with the active branch so it only
            // surfaces in the Inbox of the location where the scan ran.
            // Falls back to null for single-location salons (Inbox filter
            // treats null as "no filter" in that case).
            let suggestionLocationId = null;
            try {
              if (typeof window !== "undefined" && typeof window.ffGetActiveLocationId === "function") {
                const v = window.ffGetActiveLocationId();
                if (typeof v === "string" && v.trim()) suggestionLocationId = v.trim();
              }
              if (!suggestionLocationId && typeof window !== "undefined"
                  && typeof window.__ff_active_location_id === "string"
                  && window.__ff_active_location_id.trim()) {
                suggestionLocationId = window.__ff_active_location_id.trim();
              }
            } catch (_) {}
            const payload = {
              tenantId: salonId,
              locationId: suggestionLocationId,
              type: "inventory_suggestion",
              status: "open",
              priority: "high",
              assignedTo: null,
              sentToStaffIds: [],
              sentToNames: [],
              managerNotes: null,
              responseNote: null,
              decidedBy: null,
              decidedAt: null,
              needsInfoQuestion: null,
              staffReply: null,
              visibility: "managers_only",
              unreadForManagers: true,
              createdByUid: uid,
              createdByStaffId: staffId,
              createdByName: displayName,
              createdByRole: role,
              forUid: uid,
              forStaffId: staffId,
              forStaffName: displayName,
              createdAt: serverTimestamp(),
              lastActivityAt: serverTimestamp(),
              updatedAt: null,
              data: {
                itemName,
                groupName,
                categoryId: String(cat.id),
                categoryName: cat.name != null ? String(cat.name) : "",
                subcategoryId: String(sub.id),
                subcategoryName: sub.name != null ? String(sub.name) : "",
                rowId: String(r.id),
                groupId: String(g.id),
                current: Math.round(current * 100) / 100,
                dailyUsage: Math.round(dailyUsage * 100) / 100,
                daysLeft: Math.round(daysLeft * 10) / 10,
                suggestedQty,
                lookbackDays,
                totalUsed: usage.total,
              },
            };
            try {
              await addDoc(collection(db, `salons/${salonId}/inboxItems`), payload);
              existingKeys.add(key);
              createdCount += 1;
            } catch (e) {
              console.warn("[Inventory] suggestion scan: create failed", { cat: cat.id, sub: sub.id, row: r.id, group: g.id }, e);
            }
          }
        }
      }
    }
    if (createdCount > 0) {
      console.log(`[Inventory] Smart Suggestion scan — created ${createdCount} alert(s)`);
    } else {
      console.log("[Inventory] Smart Suggestion scan — no new alerts");
    }
  } catch (e) {
    console.warn("[Inventory] suggestion scan failed", e);
  }
}

async function scanProductReorderAlertsOnce(force) {
  if (!force && invState._invReorderScannedThisSession) return;
  invState._invReorderScannedThisSession = true;
  try {
    const salonId = await getSalonId();
    if (!salonId) return;
    const user = auth.currentUser;
    if (!user) return;

    let userData = {};
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) userData = snap.data() || {};
    } catch (e) {
      console.warn("[Inventory] reorder scan: user doc read failed", e);
      return;
    }
    const role = userData.role != null ? String(userData.role) : "";
    if (!["manager", "admin", "owner"].includes(role.toLowerCase())) return;

    const uid = user.uid;
    const staffId = userData.staffId != null ? String(userData.staffId) : "";
    const displayName = userData.displayName || userData.name || "System";

    // Active location — alerts surface per-branch only.
    let activeLoc = null;
    try {
      if (typeof window !== "undefined" && typeof window.ffGetActiveLocationId === "function") {
        const v = window.ffGetActiveLocationId();
        if (typeof v === "string" && v.trim()) activeLoc = v.trim();
      }
      if (!activeLoc && typeof window !== "undefined"
          && typeof window.__ff_active_location_id === "string"
          && window.__ff_active_location_id.trim()) {
        activeLoc = window.__ff_active_location_id.trim();
      }
    } catch (_) {}

    // Dedup against existing reorder-point alerts (any status) by product id.
    const existingKeys = new Set();
    try {
      const existingSnap = await getDocs(
        query(
          collection(db, `salons/${salonId}/inboxItems`),
          where("type", "==", "inventory_suggestion")
        )
      );
      existingSnap.forEach((d) => {
        const data = d.data() || {};
        const nested = (data.data && typeof data.data === "object") ? data.data : {};
        if (nested.kind !== "reorder_point") return;
        const rowId = nested.rowId != null ? String(nested.rowId) : "";
        if (rowId) existingKeys.add(rowId);
      });
    } catch (e) {
      console.warn("[Inventory] reorder scan: existing alerts query failed", e);
      return;
    }

    const [catSnap, prodSnap] = await Promise.all([
      getDocs(collection(db, `salons/${salonId}/productCategories`)),
      getDocs(collection(db, `salons/${salonId}/products`)),
    ]);

    // Category/subcategory name lookup for nicer alert text.
    const catMap = new Map();
    catSnap.forEach((d) => {
      const c = { id: d.id, ...d.data() };
      const subs = Array.isArray(c.subcategories) ? c.subcategories : [];
      const subMap = new Map();
      subs.forEach((s) => { if (s && s.id != null) subMap.set(String(s.id), s.name || ""); });
      catMap.set(String(d.id), { name: c.name || "", subs: subMap });
    });

    let createdCount = 0;
    for (const d of prodSnap.docs) {
      const product = { id: d.id, ...d.data() };
      const productId = String(product.id);
      if (existingKeys.has(productId)) continue;

      const inv = product.inventory && typeof product.inventory === "object" ? product.inventory : {};
      const locO = activeLoc && product.locationOverrides && product.locationOverrides[activeLoc]
        ? product.locationOverrides[activeLoc]
        : null;

      let reorderPoint = NaN;
      if (locO && Number.isFinite(Number(locO.reorderPoint))) reorderPoint = Number(locO.reorderPoint);
      else if (Number.isFinite(Number(inv.reorderPoint))) reorderPoint = Number(inv.reorderPoint);
      if (!Number.isFinite(reorderPoint) || reorderPoint <= 0) continue;

      const current = getProductStockForInventoryRow(product, activeLoc);
      if (!Number.isFinite(current)) continue;
      if (!(current <= reorderPoint)) continue;

      const target = getProductTargetStockForInventoryRow(product, activeLoc);
      let suggestedQty = Number.isFinite(target) && target > current ? target - current : reorderPoint;
      suggestedQty = Math.max(1, Math.ceil(suggestedQty));

      const catInfo = catMap.get(String(product.categoryId || "")) || { name: "", subs: new Map() };
      const subName = product.subcategoryId != null
        ? (catInfo.subs.get(String(product.subcategoryId)) || "")
        : "";

      const payload = {
        tenantId: salonId,
        locationId: activeLoc,
        type: "inventory_suggestion",
        status: "open",
        priority: "high",
        assignedTo: null,
        sentToStaffIds: [],
        sentToNames: [],
        managerNotes: null,
        responseNote: null,
        decidedBy: null,
        decidedAt: null,
        needsInfoQuestion: null,
        staffReply: null,
        visibility: "managers_only",
        unreadForManagers: true,
        createdByUid: uid,
        createdByStaffId: staffId,
        createdByName: displayName,
        createdByRole: role,
        forUid: uid,
        forStaffId: staffId,
        forStaffName: displayName,
        createdAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
        updatedAt: null,
        data: {
          kind: "reorder_point",
          itemName: String(product.name || "").trim(),
          groupName: "",
          categoryId: String(product.categoryId || ""),
          categoryName: catInfo.name || "",
          subcategoryId: product.subcategoryId != null ? String(product.subcategoryId) : "",
          subcategoryName: subName,
          rowId: productId,
          groupId: "default",
          current: Math.round(current * 100) / 100,
          reorderPoint: Math.round(reorderPoint * 100) / 100,
          suggestedQty,
        },
      };
      try {
        await addDoc(collection(db, `salons/${salonId}/inboxItems`), payload);
        existingKeys.add(productId);
        createdCount += 1;
      } catch (e) {
        console.warn("[Inventory] reorder scan: create failed", productId, e);
      }
    }
    if (createdCount > 0) {
      console.log(`[Inventory] Reorder-point scan — created ${createdCount} alert(s)`);
    } else {
      console.log("[Inventory] Reorder-point scan — no new alerts");
    }
  } catch (e) {
    console.warn("[Inventory] reorder scan failed", e);
  }
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

function renderInsightsDonutSvg(rows, totalSpend) {
  const sum = rows.reduce((acc, r) => acc + (Number(r.spend) || 0), 0);
  if (!(sum > 0) || !rows.length) return "";
  const cx = 70;
  const cy = 70;
  const rOuter = 60;
  const rInner = 40;
  // Single-slice edge case: draw two half-arc slices so SVG renders correctly.
  if (rows.length === 1) {
    const color = INV_INSIGHTS_CHART_COLORS[0];
    const ring = `<circle cx="${cx}" cy="${cy}" r="${(rOuter + rInner) / 2}" fill="none" stroke="${color}" stroke-width="${rOuter - rInner}" />`;
    const totalText = formatInsightsCurrency(totalSpend);
    return `<svg class="ff-inv2-insights-donut-svg" viewBox="0 0 140 140" width="140" height="140" role="img" aria-label="Spend by category donut chart">
  ${ring}
  <text class="ff-inv2-insights-donut-total" x="${cx}" y="${cy - 4}" text-anchor="middle">${escapeHtml(totalText)}</text>
  <text class="ff-inv2-insights-donut-sub" x="${cx}" y="${cy + 12}" text-anchor="middle">Total spend</text>
</svg>`;
  }
  let angle = -Math.PI / 2; // Start at top.
  const slices = rows
    .map((r, i) => {
      const frac = (Number(r.spend) || 0) / sum;
      if (!(frac > 0)) return "";
      const start = angle;
      const end = angle + frac * 2 * Math.PI;
      angle = end;
      const largeArc = end - start > Math.PI ? 1 : 0;
      const x1o = cx + rOuter * Math.cos(start);
      const y1o = cy + rOuter * Math.sin(start);
      const x2o = cx + rOuter * Math.cos(end);
      const y2o = cy + rOuter * Math.sin(end);
      const x1i = cx + rInner * Math.cos(end);
      const y1i = cy + rInner * Math.sin(end);
      const x2i = cx + rInner * Math.cos(start);
      const y2i = cy + rInner * Math.sin(start);
      const d = [
        `M ${x1o.toFixed(2)} ${y1o.toFixed(2)}`,
        `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2o.toFixed(2)} ${y2o.toFixed(2)}`,
        `L ${x1i.toFixed(2)} ${y1i.toFixed(2)}`,
        `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x2i.toFixed(2)} ${y2i.toFixed(2)}`,
        "Z",
      ].join(" ");
      const color = INV_INSIGHTS_CHART_COLORS[i % INV_INSIGHTS_CHART_COLORS.length];
      const title = `${r.name}: ${formatInsightsCurrency(r.spend)} (${r.percent}%)`;
      return `<path d="${d}" fill="${color}" stroke="#fff" stroke-width="1.5"><title>${escapeHtml(title)}</title></path>`;
    })
    .join("");
  const totalText = formatInsightsCurrency(totalSpend);
  return `<svg class="ff-inv2-insights-donut-svg" viewBox="0 0 140 140" width="140" height="140" role="img" aria-label="Spend by category donut chart">
  ${slices}
  <text class="ff-inv2-insights-donut-total" x="${cx}" y="${cy - 4}" text-anchor="middle">${escapeHtml(totalText)}</text>
  <text class="ff-inv2-insights-donut-sub" x="${cx}" y="${cy + 12}" text-anchor="middle">Total spend</text>
</svg>`;
}

function formatInsightsCurrency(n) {
  const v = Number(n);
  const amount = Number.isFinite(v) ? v : 0;
  if (typeof window !== "undefined" && typeof window.ffFormatCurrency === "function") {
    return window.ffFormatCurrency(amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const r = Math.round(amount * 100) / 100;
  try {
    return `$${r.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } catch (e) {
    return `$${r.toFixed(2)}`;
  }
}

function renderInventoryInsightsTabHtml() {
  const ranges = [
    { id: "30d", label: "Last 30 days" },
    { id: "60d", label: "Last 60 days" },
    { id: "120d", label: "Last 120 days" },
    { id: "year", label: "Last year" },
    { id: "all", label: "All time" },
    { id: "custom", label: "Custom range…" },
  ];
  const options = ranges
    .map((r) => {
      const sel = invState._invInsightsRange === r.id ? " selected" : "";
      return `<option value="${r.id}"${sel}>${escapeHtml(r.label)}</option>`;
    })
    .join("");
  const rangeControl = `<label class="ff-inv2-insights-range-label">Range
  <select class="ff-inv2-insights-range-select" data-inv-insights-range-select aria-label="Date range">${options}</select>
</label>`;
  const customRow =
    invState._invInsightsRange === "custom"
      ? `<div class="ff-inv2-insights-custom">
  <label class="ff-inv2-insights-date-label">From <input type="date" data-inv-insights-from value="${escapeHtml(invState._invInsightsCustomFrom)}" /></label>
  <label class="ff-inv2-insights-date-label">To <input type="date" data-inv-insights-to value="${escapeHtml(invState._invInsightsCustomTo)}" /></label>
</div>`
      : "";
  const kpis = invState._invInsightsKpis;
  const inProgress = Math.max(0, (kpis.totalOrders || 0) - (kpis.doneOrders || 0));
  const doneSubtitle = kpis.totalOrders > 0
    ? `${kpis.doneOrders} of ${kpis.totalOrders} · ${inProgress} in progress`
    : "No activity yet";
  // Month-over-Month delta for Total spend.
  let spendDeltaHtml = `<span class="ff-inv2-insights-kpi-sub">Based on items actually bought</span>`;
  const pct = kpis.spendPctChange;
  if (invState._invInsightsRange !== "all" && typeof pct === "number" && Number.isFinite(pct)) {
    const rounded = Math.round(pct * 10) / 10;
    const up = rounded > 0;
    const flat = Math.abs(rounded) < 0.05;
    // For spend, UP is bad (red) and DOWN is good (green). Flat stays neutral.
    const cls = flat ? "ff-inv2-insights-delta--flat" : up ? "ff-inv2-insights-delta--up" : "ff-inv2-insights-delta--down";
    const arrow = flat ? "≈" : up ? "▲" : "▼";
    const label = flat
      ? "No change vs previous period"
      : `${Math.abs(rounded)}% vs previous (${escapeHtml(formatInsightsCurrency(kpis.prevSpend || 0))})`;
    spendDeltaHtml = `<span class="ff-inv2-insights-delta ${cls}"><span class="ff-inv2-insights-delta-arrow">${arrow}</span>${escapeHtml(label)}</span>`;
  } else if (invState._invInsightsRange !== "all" && (kpis.prevSpend || 0) === 0 && (kpis.totalSpend || 0) > 0) {
    spendDeltaHtml = `<span class="ff-inv2-insights-kpi-sub">No prior-period spend</span>`;
  }
  const kpiBlock = `<div class="ff-inv2-insights-kpis">
  <div class="ff-inv2-insights-kpi">
    <span class="ff-inv2-insights-kpi-label">Total spend</span>
    <span class="ff-inv2-insights-kpi-value">${escapeHtml(formatInsightsCurrency(kpis.totalSpend))}</span>
    ${spendDeltaHtml}
  </div>
  <div class="ff-inv2-insights-kpi">
    <span class="ff-inv2-insights-kpi-label">Done orders</span>
    <span class="ff-inv2-insights-kpi-value">${escapeHtml(String(kpis.doneOrders))}</span>
    <span class="ff-inv2-insights-kpi-sub">${escapeHtml(doneSubtitle)}</span>
  </div>
  <div class="ff-inv2-insights-kpi">
    <span class="ff-inv2-insights-kpi-label">Unique items</span>
    <span class="ff-inv2-insights-kpi-value">${escapeHtml(String(kpis.uniqueItems))}</span>
    <span class="ff-inv2-insights-kpi-sub">Distinct SKUs purchased</span>
  </div>
</div>`;

  let mostPurchasedBody;
  if (invState._invInsightsLoading) {
    mostPurchasedBody = `<p class="ff-inv2-insights-empty">Loading…</p>`;
  } else if (invState._invInsightsError) {
    mostPurchasedBody = `<p class="ff-inv2-insights-empty">${escapeHtml(invState._invInsightsError)}</p>`;
  } else if (invState._invInsightsRows.length === 0) {
    mostPurchasedBody = `<p class="ff-inv2-insights-empty">No purchases in this range.</p>`;
  } else {
    mostPurchasedBody = `<ol class="ff-inv2-insights-list">${invState._invInsightsRows
      .map(
        (r, i) => `<li class="ff-inv2-insights-row">
  <span class="ff-inv2-insights-rank">${i + 1}.</span>
  <span class="ff-inv2-insights-name">${escapeHtml(r.name)}</span>
  <span class="ff-inv2-insights-qty">${escapeHtml(formatOrderDisplay(r.totalQty))}</span>
</li>`
      )
      .join("")}</ol>`;
  }

  // Spend by Category
  const categoryRows = invState._invInsightsCategorySpend || [];
  const spendBlock = !invState._invInsightsLoading && categoryRows.length > 0
    ? `<div class="ff-inv2-insights-card">
  <div class="ff-inv2-insights-card-head">
    <h4 class="ff-inv2-insights-card-title">Spend by Category</h4>
  </div>
  <div class="ff-inv2-insights-spend-list">${categoryRows
    .map((r) => `<div class="ff-inv2-insights-spend-row">
  <div class="ff-inv2-insights-spend-name-row">
    <span class="ff-inv2-insights-spend-name">${escapeHtml(r.name)}</span>
    <span class="ff-inv2-insights-spend-amount">${escapeHtml(formatInsightsCurrency(r.spend))}</span>
    <span class="ff-inv2-insights-spend-pct">${escapeHtml(String(r.percent))}%</span>
  </div>
  <div class="ff-inv2-insights-spend-bar" aria-hidden="true"><span style="width:${Math.max(2, r.percent)}%"></span></div>
</div>`)
    .join("")}</div>
</div>`
    : "";

  // Running Low
  const runningLow = invState._invInsightsRunningLow || [];
  const lowList = runningLow.slice(0, 8);
  const lowBlock = !invState._invInsightsLoading && lowList.length > 0
    ? `<div class="ff-inv2-insights-card ff-inv2-insights-card--warn">
  <div class="ff-inv2-insights-card-head">
    <h4 class="ff-inv2-insights-card-title">⚠ Running Low (${runningLow.length})</h4>
    <span class="ff-inv2-insights-card-hint">Below ${Math.round(INV_INSIGHTS_LOW_THRESHOLD * 100)}% of stock target</span>
  </div>
  <ul class="ff-inv2-insights-low-list">${lowList
    .map((e) => {
      const pct = Math.max(0, Math.round(e.pctLeft * 100));
      const name = e.groupName ? `${e.itemName} (${e.groupName})` : e.itemName;
      const path = [e.categoryName, e.subcategoryName].filter(Boolean).join(" › ");
      return `<li class="ff-inv2-insights-low-row">
  <div class="ff-inv2-insights-low-main">
    <div class="ff-inv2-insights-low-name">${escapeHtml(name)}</div>
    <div class="ff-inv2-insights-low-path">${escapeHtml(path)}</div>
  </div>
  <div class="ff-inv2-insights-low-qty">
    <span class="ff-inv2-insights-low-current">${escapeHtml(formatOrderDisplay(e.current))}</span>
    <span class="ff-inv2-insights-low-sep">/</span>
    <span class="ff-inv2-insights-low-stock">${escapeHtml(formatOrderDisplay(e.stock))}</span>
    <span class="ff-inv2-insights-low-pct">${pct}%</span>
  </div>
</li>`;
    })
    .join("")}</ul>
</div>`
    : "";

  // Dead Stock
  const deadStock = invState._invInsightsDeadStock || [];
  const deadList = deadStock.slice(0, 8);
  const rangeLabelForDead = invState._invInsightsRange === "all" ? "" : (
    invState._invInsightsRange === "custom"
      ? "in selected range"
      : invState._invInsightsRange === "year"
        ? "in the past year"
        : `in last ${invState._invInsightsRange.replace("d", " days")}`
  );
  const deadBlock = !invState._invInsightsLoading && deadList.length > 0 && invState._invInsightsRange !== "all"
    ? `<div class="ff-inv2-insights-card ff-inv2-insights-card--dead">
  <div class="ff-inv2-insights-card-head">
    <h4 class="ff-inv2-insights-card-title">Dead Stock (${deadStock.length})</h4>
    <span class="ff-inv2-insights-card-hint">In stock · no activity ${escapeHtml(rangeLabelForDead)}</span>
  </div>
  <ul class="ff-inv2-insights-low-list">${deadList
    .map((e) => {
      const name = e.groupName ? `${e.itemName} (${e.groupName})` : e.itemName;
      const path = [e.categoryName, e.subcategoryName].filter(Boolean).join(" › ");
      return `<li class="ff-inv2-insights-low-row">
  <div class="ff-inv2-insights-low-main">
    <div class="ff-inv2-insights-low-name">${escapeHtml(name)}</div>
    <div class="ff-inv2-insights-low-path">${escapeHtml(path)}</div>
  </div>
  <div class="ff-inv2-insights-low-qty">
    <span class="ff-inv2-insights-low-current">${escapeHtml(formatOrderDisplay(e.current))}</span>
    <span class="ff-inv2-insights-low-sep">in stock</span>
  </div>
</li>`;
    })
    .join("")}</ul>
</div>`
    : "";

  // Smart Reorder Suggestions — forecast-driven, showing items likely to run out soon.
  const reorder = invState._invInsightsReorder || [];
  const reorderList = reorder.slice(0, 10);
  const reorderBlock = !invState._invInsightsLoading && reorderList.length > 0
    ? `<div class="ff-inv2-insights-card ff-inv2-insights-card--warn">
  <div class="ff-inv2-insights-card-head">
    <h4 class="ff-inv2-insights-card-title">⏰ Reorder Suggestions (${reorder.length})</h4>
    <span class="ff-inv2-insights-card-hint">Will run out within ${INV_INSIGHTS_REORDER_DAYS} days at current pace</span>
  </div>
  <ul class="ff-inv2-insights-low-list">${reorderList
    .map((u) => {
      const name = u.groupName ? `${u.itemName} (${u.groupName})` : u.itemName;
      const path = [u.categoryName, u.subcategoryName].filter(Boolean).join(" › ");
      const days = Math.max(0, Math.round(u.daysLeft));
      const target = u.stock > 0 ? u.stock : Math.max(1, Math.round(u.dailyRate * (INV_INSIGHTS_LOW_DAYS * 2)));
      const suggest = Math.max(1, Math.ceil(target - u.current));
      const ratePerWeek = Math.round(u.dailyRate * 7 * 10) / 10;
      const rateLabel = ratePerWeek >= 1 ? `${ratePerWeek}/wk` : `${Math.round(u.dailyRate * 30 * 10) / 10}/mo`;
      return `<li class="ff-inv2-insights-low-row">
  <div class="ff-inv2-insights-low-main">
    <div class="ff-inv2-insights-low-name">${escapeHtml(name)}</div>
    <div class="ff-inv2-insights-low-path">${escapeHtml(path)} · ${escapeHtml(rateLabel)}</div>
  </div>
  <div class="ff-inv2-insights-reorder-qty">
    <span class="ff-inv2-insights-reorder-days">${days}d left</span>
    <span class="ff-inv2-insights-reorder-suggest">Order ${escapeHtml(formatOrderDisplay(suggest))}</span>
  </div>
</li>`;
    })
    .join("")}</ul>
</div>`
    : "";

  // Days of Stock Left — forecast card (usage-driven view only).
  // Only include items with meaningful forecast signal:
  // - dailyRate > 0 (real usage history) → a proper forecast
  // - current > 0 && some signal on stock target → shows how long stock will last
  // Exclude items with current=0 AND no usage — those are "inactive", not a forecast.
  const usage = invState._invInsightsUsage || [];
  const usageList = usage
    .filter((u) => u.dailyRate > 0 || (u.current > 0 && u.stock > 0))
    .slice(0, 12);
  const totalAtRisk = usage.filter((u) => (u.level === "critical" || u.level === "low") && u.dailyRate > 0).length;
  const usageBlock = !invState._invInsightsLoading && usageList.length > 0
    ? `<div class="ff-inv2-insights-card">
  <div class="ff-inv2-insights-card-head">
    <h4 class="ff-inv2-insights-card-title">Days of Stock Left</h4>
    <span class="ff-inv2-insights-card-hint">${totalAtRisk > 0 ? `${totalAtRisk} at risk` : "Based on usage in the selected range"}</span>
  </div>
  <ul class="ff-inv2-insights-usage-list">${usageList
    .map((u) => {
      const name = u.groupName ? `${u.itemName} (${u.groupName})` : u.itemName;
      const path = [u.categoryName, u.subcategoryName].filter(Boolean).join(" › ");
      const hasUsage = u.dailyRate > 0;
      // Only show a numeric days label when we have real usage data.
      // Without usage, the forecast is meaningless — show "—" instead of a fake "0d".
      let daysLabel;
      let levelForBadge = u.level;
      if (hasUsage) {
        daysLabel = Number.isFinite(u.daysLeft) ? `${Math.max(0, Math.round(u.daysLeft))}d` : "∞";
      } else if (u.current <= 0) {
        daysLabel = "Empty";
        levelForBadge = "critical";
      } else {
        daysLabel = "—";
        levelForBadge = "ok";
      }
      const ratePerWeek = Math.round(u.dailyRate * 7 * 10) / 10;
      const rateLabel = hasUsage
        ? (ratePerWeek >= 1 ? `${ratePerWeek}/wk` : `${Math.round(u.dailyRate * 30 * 10) / 10}/mo`)
        : "no recent usage";
      const levelCls = `ff-inv2-insights-usage-badge--${levelForBadge}`;
      return `<li class="ff-inv2-insights-usage-row">
  <div class="ff-inv2-insights-usage-main">
    <div class="ff-inv2-insights-usage-name">${escapeHtml(name)}</div>
    <div class="ff-inv2-insights-usage-path">${escapeHtml(path)} · ${escapeHtml(rateLabel)}</div>
  </div>
  <div class="ff-inv2-insights-usage-meta">
    <span class="ff-inv2-insights-usage-current">${escapeHtml(formatOrderDisplay(u.current))} left</span>
    <span class="ff-inv2-insights-usage-badge ${levelCls}">${escapeHtml(daysLabel)}</span>
  </div>
</li>`;
    })
    .join("")}</ul>
  ${usage.length > usageList.length ? `<div class="ff-inv2-insights-usage-more">+ ${usage.length - usageList.length} more tracked</div>` : ""}
</div>`
    : "";

  // Wrap Most Purchased as a standalone card so we can place it inside a sub-tab.
  const mostPurchasedCard = `<div class="ff-inv2-insights-card">
    <div class="ff-inv2-insights-card-head">
      <h4 class="ff-inv2-insights-card-title">Most Purchased</h4>
    </div>
    <div class="ff-inv2-insights-body">${mostPurchasedBody}</div>
  </div>`;

  // ---- Sub-tabs inside Insights ------------------------------------------
  const subTabs = [
    { id: "overview", label: "Overview" },
    { id: "purchases", label: "Purchases" },
    { id: "forecast", label: "Forecast" },
    { id: "health", label: "Stock Health" },
  ];
  const activeSub = subTabs.some((t) => t.id === invState._invInsightsSubTab) ? invState._invInsightsSubTab : "overview";
  const subTabBar = `<div class="ff-inv2-insights-subtabs" role="tablist" aria-label="Insights sections">${subTabs
    .map((t) => {
      const active = t.id === activeSub ? " ff-inv2-insights-subtab--active" : "";
      return `<button type="button" class="ff-inv2-insights-subtab${active}" role="tab" aria-selected="${t.id === activeSub}" data-inv-insights-subtab="${t.id}">${escapeHtml(t.label)}</button>`;
    })
    .join("")}</div>`;

  const emptyState = (msg) => `<div class="ff-inv2-insights-card"><p class="ff-inv2-insights-empty">${escapeHtml(msg)}</p></div>`;

  // Donut chart (Spend by Category) for Overview.
  const categoryRowsForDonut = invState._invInsightsCategorySpend || [];
  // Collapse categories beyond the palette size into "Other" so the chart stays readable.
  const maxSlices = INV_INSIGHTS_CHART_COLORS.length - 1; // reserve last color for "Other"
  let donutRows = categoryRowsForDonut;
  if (categoryRowsForDonut.length > maxSlices) {
    const top = categoryRowsForDonut.slice(0, maxSlices);
    const rest = categoryRowsForDonut.slice(maxSlices);
    const restSpend = rest.reduce((acc, r) => acc + (r.spend || 0), 0);
    const totalSpendSum = categoryRowsForDonut.reduce((acc, r) => acc + (r.spend || 0), 0) || 0;
    const restPct = totalSpendSum > 0 ? Math.round((restSpend / totalSpendSum) * 1000) / 10 : 0;
    donutRows = [...top, { name: `Other (${rest.length})`, spend: restSpend, percent: restPct }];
  }
  const donutSvg = renderInsightsDonutSvg(donutRows, kpis.totalSpend || 0);
  const donutBlock = donutSvg
    ? `<div class="ff-inv2-insights-card">
  <div class="ff-inv2-insights-card-head">
    <h4 class="ff-inv2-insights-card-title">Spend by Category</h4>
    <span class="ff-inv2-insights-card-hint">${donutRows.length} ${donutRows.length === 1 ? "category" : "categories"}</span>
  </div>
  <div class="ff-inv2-insights-donut-wrap">
    <div class="ff-inv2-insights-donut-chart">${donutSvg}</div>
    <ul class="ff-inv2-insights-donut-legend">${donutRows
      .map((r, i) => {
        const color = INV_INSIGHTS_CHART_COLORS[i % INV_INSIGHTS_CHART_COLORS.length];
        return `<li class="ff-inv2-insights-donut-legend-row">
  <span class="ff-inv2-insights-donut-dot" style="background:${color}" aria-hidden="true"></span>
  <span class="ff-inv2-insights-donut-legend-name">${escapeHtml(r.name)}</span>
  <span class="ff-inv2-insights-donut-legend-amount">${escapeHtml(formatInsightsCurrency(r.spend))}</span>
  <span class="ff-inv2-insights-donut-legend-pct">${escapeHtml(String(r.percent))}%</span>
</li>`;
      })
      .join("")}</ul>
  </div>
</div>`
    : "";

  let subContent = "";
  if (invState._invInsightsLoading) {
    subContent = `<div class="ff-inv2-insights-card"><p class="ff-inv2-insights-empty">Loading…</p></div>`;
  } else if (invState._invInsightsError) {
    subContent = `<div class="ff-inv2-insights-card"><p class="ff-inv2-insights-empty">${escapeHtml(invState._invInsightsError)}</p></div>`;
  } else if (activeSub === "overview") {
    subContent = `${kpiBlock}${donutBlock}`;
  } else if (activeSub === "purchases") {
    const hasMost = (invState._invInsightsRows || []).length > 0;
    const hasSpend = (invState._invInsightsCategorySpend || []).length > 0;
    if (!hasMost && !hasSpend) {
      subContent = emptyState("No purchases in this range yet.");
    } else {
      subContent = `${mostPurchasedCard}${spendBlock}`;
    }
  } else if (activeSub === "forecast") {
    const forecastIntro = `<div class="ff-inv2-insights-subtab-intro">
      <span class="ff-inv2-insights-subtab-intro-icon" aria-hidden="true">🔮</span>
      <div>
        <div class="ff-inv2-insights-subtab-intro-title">Forecast — predicted stock behavior</div>
        <div class="ff-inv2-insights-subtab-intro-hint">Based on your purchase rate in the selected range. Items you haven't bought recently are excluded.</div>
      </div>
    </div>`;
    if (!reorderBlock && !usageBlock) {
      subContent = `${forecastIntro}${emptyState("Not enough purchase history to forecast yet. Buy more items or widen the date range.")}`;
    } else {
      subContent = `${forecastIntro}${reorderBlock}${usageBlock}`;
    }
  } else if (activeSub === "health") {
    if (!lowBlock && !deadBlock) {
      subContent = emptyState("All good — nothing running low or sitting unused.");
    } else {
      subContent = `${lowBlock}${deadBlock}`;
    }
  }

  return `<div class="ff-inv2-insights-wrap">
  <div class="ff-inv2-insights-head">
    <div class="ff-inv2-insights-head-row">
      <h3 class="ff-inv2-insights-title">Inventory Insights</h3>
      ${rangeControl}
    </div>
    ${customRow}
  </div>
  ${subTabBar}
  ${subContent}
</div>`;
}

export {
  refreshInventoryInsightsAsync,
  renderInventoryInsightsTabHtml,
  scanInventorySuggestionsOnce,
  scanProductReorderAlertsOnce,
};
