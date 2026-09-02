// inventory-insights-scans.js
// Inventory > Insights — the two background scans that emit reorder/suggestion
// alerts into inboxItems. Extracted verbatim from inventory-insights.js.
// Note: `auth` resolves via the window.auth global set by app.js (pre-existing).

import { invState } from "./inventory-state.js?v=20260902_inv_iso";
import {
  parseNum,
  ffResolveItemEventDate,
  getProductStockForInventoryRow,
  getProductTargetStockForInventoryRow,
  parseSubcategoryDocToTable,
} from "./inventory-helpers.js?v=20260902_inv_iso";
import { productDocInActiveLoc } from "./products-location.js?v=20260902_prod_cats";
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

// ── injected inventory.js internals (set once via initInsightsScans) ──
let getSalonId;
let _ffInvDocInActiveLoc;
let _ffInvActiveLocId;
let _ffInvHasActiveLocationForWrite;

export function initInsightsScans(deps) {
  ({ getSalonId, _ffInvDocInActiveLoc, _ffInvActiveLocId, _ffInvHasActiveLocationForWrite } = deps);
}

async function scanInventorySuggestionsOnce() {
  if (invState._invSuggestionsScannedThisSession) return;
  invState._invSuggestionsScannedThisSession = true;
  try {
    const salonId = await getSalonId();
    if (!salonId) return;
    if (typeof _ffInvHasActiveLocationForWrite === "function" && !_ffInvHasActiveLocationForWrite()) return;
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
        if (!_ffInvDocInActiveLoc(data)) return;
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
            const suggestionLocationId = typeof _ffInvActiveLocId === "function" ? (_ffInvActiveLocId() || null) : null;
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
                locationId: suggestionLocationId,
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
    if (typeof _ffInvHasActiveLocationForWrite === "function" && !_ffInvHasActiveLocationForWrite()) return;
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

    const activeLoc = typeof _ffInvActiveLocId === "function" ? (_ffInvActiveLocId() || null) : null;

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
        if (!_ffInvDocInActiveLoc(data)) return;
        const nested = (data.data && typeof data.data === "object") ? data.data : {};
        if (nested.kind !== "reorder_point") return;
        const rowId = nested.rowId != null ? String(nested.rowId) : "";
        if (rowId) existingKeys.add(rowId);
      });
    } catch (e) {
      console.warn("[Inventory] reorder scan: existing alerts query failed", e);
      return;
    }

    if (typeof window.ffLoadProductCatalogShareEnabled === "function") {
      try { await window.ffLoadProductCatalogShareEnabled(); } catch (_) {}
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
      if (!productDocInActiveLoc(product)) continue;
      const productId = String(product.id);
      if (existingKeys.has(productId)) continue;

      const inv = product.inventory && typeof product.inventory === "object" ? product.inventory : {};
      const locO = activeLoc && product.locationOverrides && product.locationOverrides[activeLoc]
        ? product.locationOverrides[activeLoc]
        : null;

      let reorderPoint = NaN;
      if (locO && Number.isFinite(Number(locO.reorderPoint))) reorderPoint = Number(locO.reorderPoint);
      else if (Number.isFinite(Number(inv.reorderPoint)) && (!activeLoc || !_ffInvDocInActiveLoc || _ffInvDocInActiveLoc({ locationId: null }))) {
        reorderPoint = Number(inv.reorderPoint);
      }
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
          locationId: activeLoc,
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

export {
  scanInventorySuggestionsOnce,
  scanProductReorderAlertsOnce,
};
