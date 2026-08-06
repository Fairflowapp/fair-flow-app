// inventory-orders-detail-commit.js
// Orders detail — Firestore commits & local drafts. Extracted verbatim from inventory-orders-detail.js.
// Shared state in inventory-state.js; orchestrator/back-edge deps injected via initOrdersDetailCommit().

import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  runTransaction,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { invState } from "./inventory-state.js?v=20260728_inv_mobile_unstick";
import {
  normalizeRowFromFirestore,
  serializeInventoryRowForFirestore,
  parseNum,
  parseRowIdFromInventoryItemId,
  getItemOrderQty,
  getItemReceivedCumulative,
  computeReceiveStatusFromItems,
  isItemPurchaseAppliedToInventory,
  formatOrderDisplay,
} from "./inventory-helpers.js?v=20260728_inv_mobile_unstick";
import { inventoryOrderDraftToast } from "./inventory-orders-core.js?v=20260728_inv_mobile_unstick";
import { loadInventoryOrdersList } from "./inventory-orders-list.js?v=20260728_inv_mobile_unstick";

// ── injected by initOrdersDetailCommit() (orchestrator spine + back-edges) ──
let getSalonId, mountOrRefreshMockUi, getSelectedSubMeta, loadInventoryTableForSub, findCategoryAndSubForSubId;
export function initOrdersDetailCommit(deps) {
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
