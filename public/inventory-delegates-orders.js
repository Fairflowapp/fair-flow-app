// inventory-delegates-orders.js
// Orders tab + Order Detail click/keydown/focusout delegates extracted verbatim from
// ensureInventoryScreenDelegates in inventory.js (Phase 13).

import { invState } from "./inventory-state.js?v=20260627_inventory_split";
import { removeApprovedContributionForCell, bindInventoryOrderCellLongPressOnce } from "./inventory-table.js?v=20260702_inventory_orders_detail_split";
import {
  bindOrderDetailRowLongPressOnce,
  toggleShoppingRowQty,
  duplicateInventoryOrderDraft,
  deleteInventoryOrderDraftConfirmed,
  markInventoryOrderOrderedConfirmed,
  renameInventoryOrderConfirmed,
  isInvOrderDetailCommitBusy,
  triggerOrderDetailPrint,
  triggerOrderDetailExportCsv,
  confirmInventoryOrderPurchase,
  confirmInventoryOrderReceived,
  commitOrderLineInventoryPrice,
  deleteInventoryOrderReceipt,
  inventoryOrderDraftToast,
} from "./inventory-orders.js?v=20260702_inventory_orders_detail_split";

let mountOrRefreshMockUi;

export function initInventoryDelegatesOrders(deps) {
  ({ mountOrRefreshMockUi } = deps);
}

export function bindInventoryDelegatesOrdersOnce(root) {
  bindOrderDetailRowLongPressOnce(root);
  bindInventoryOrderCellLongPressOnce(root);
  /** Order Details: one reliable path for checkbox taps (iOS often fails on invisible native input). */
  root.addEventListener(
    "click",
    (ev) => {
      const t = ev.target;
      if (!(t instanceof Node)) return;
      const label = typeof t.closest === "function" ? t.closest(".ff-inv2-od-shopping-check-label") : null;
      if (!label || !root.contains(label)) return;
      const cb = label.querySelector("input[data-inv-shopping-check]");
      if (!(cb instanceof HTMLInputElement) || cb.disabled) return;
      ev.preventDefault();
      ev.stopPropagation();
      const oid = cb.getAttribute("data-order-id");
      const idxStr = cb.getAttribute("data-line-idx");
      if (oid != null && idxStr != null) {
        toggleShoppingRowQty(oid, Number(idxStr));
      }
    },
    true
  );
}

export function bindInventoryOrdersDelegateOrderRowKeydown(root) {
  root.addEventListener("keydown", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const row = t.closest("[data-inv-order-row]");
    if (!row || !root.contains(row)) return;
    if (t.closest("[data-inv-orders-actions]") || t.closest("[data-inv-orders-menu-trigger]")) return;
    if (ev.key !== "Enter" && ev.key !== " ") return;
    ev.preventDefault();
    const oid = row.getAttribute("data-inv-order-id");
    if (oid) {
      if (invState._invOrdersDetailOrderId != null && invState._invOrdersDetailOrderId !== oid) {
        invState._invOrderDetailFilter = "all";
      }
      invState._invOrdersDetailOrderId = oid;
      mountOrRefreshMockUi();
    }
  });
}

/** @returns {boolean} */
export function handleInventoryOrdersDelegateFocusout(ev, root, t) {
    if (t.hasAttribute("data-inv-order-line-inv-price") && root.contains(t)) {
      const oid = t.getAttribute("data-order-id");
      const idxStr = t.getAttribute("data-line-idx");
      if (oid != null && idxStr != null) {
        void commitOrderLineInventoryPrice(oid, Number(idxStr), t.value);
      }
      return true;
    }
  return false;
}

/** @returns {boolean} */
export function handleInventoryOrdersDelegateKeydown(ev) {
  if (
    ev.key === "Enter" &&
    ev.target instanceof HTMLInputElement &&
    ev.target.hasAttribute("data-inv-orders-rename-input") &&
    invState._invOrdersRenameModal &&
    !invState._invOrdersRenameModal.busy
  ) {
    ev.preventDefault();
    void renameInventoryOrderConfirmed(invState._invOrdersRenameModal.orderId, ev.target.value);
    return true;
  }
  return false;
}

/** @returns {boolean} */
export function handleInventoryOrdersDelegateKeydownEscape(ev) {
  if (invState._invOrderDetailLineViewIdx != null) {
    ev.preventDefault();
    invState._invOrderDetailLineViewIdx = null;
    mountOrRefreshMockUi();
    return true;
  }
  if (invState._invOrdersRenameModal && !invState._invOrdersRenameModal.busy) {
    ev.preventDefault();
    invState._invOrdersRenameModal = null;
    mountOrRefreshMockUi();
    return true;
  }
  if (invState._invOrderCellBreakdownModal && !invState._invOrderCellBreakdownModal.busy) {
    ev.preventDefault();
    invState._invOrderCellBreakdownModal = null;
    mountOrRefreshMockUi();
    return true;
  }
  if (invState._invReceiptInfoModalOrderId) {
    ev.preventDefault();
    invState._invReceiptInfoModalOrderId = null;
    mountOrRefreshMockUi();
    return true;
  }
  if (invState._invOrdersDetailOrderId) {
    ev.preventDefault();
    if (isInvOrderDetailCommitBusy()) return true;
    invState._invOrderDetailLineViewIdx = null;
    invState._invOrdersDetailOrderId = null;
    mountOrRefreshMockUi();
    return true;
  }
  return false;
}

/** @returns {boolean} */
export function handleInventoryOrdersDelegateClick(ev, root, t) {
    const ordersKebab = t.closest("[data-inv-orders-menu-trigger]");
    if (ordersKebab && root.contains(ordersKebab)) {
      ev.preventDefault();
      ev.stopPropagation();
      const oid = ordersKebab.getAttribute("data-inv-orders-menu-trigger");
      if (oid) {
        const rect = ordersKebab.getBoundingClientRect();
        const menuW = 200;
        const menuH = 152;
        let left = rect.right + 4;
        let top = rect.top;
        left = Math.min(left, window.innerWidth - menuW - 8);
        top = Math.min(top, window.innerHeight - menuH - 8);
        left = Math.max(8, left);
        top = Math.max(8, top);
        invState._invOrdersMenu = { orderId: oid, left, top };
        mountOrRefreshMockUi();
      }
      return true;
    }
    const ordersMenuAction = t.closest("[data-inv-orders-action]");
    if (ordersMenuAction && root.contains(ordersMenuAction)) {
      ev.preventDefault();
      ev.stopPropagation();
      const oid = ordersMenuAction.getAttribute("data-order-id");
      const act = ordersMenuAction.getAttribute("data-inv-orders-action");
      if (!oid || !act) return;
      if (act === "editName") {
        const o = invState._invOrdersList.find((x) => x.id === oid);
        const cur = o && o.orderName != null ? String(o.orderName) : "";
        invState._invOrdersMenu = null;
        invState._invOrdersRenameModal = { orderId: oid, draftName: cur, busy: false };
        mountOrRefreshMockUi();
        const root = document.getElementById("inventoryScreen");
        const inp = root && root.querySelector("[data-inv-orders-rename-input]");
        if (inp instanceof HTMLInputElement) {
          inp.focus();
          inp.select();
        }
        return true;
      }
      if (act === "duplicate") {
        invState._invOrdersMenu = null;
        void duplicateInventoryOrderDraft(oid);
        return true;
      }
      if (act === "delete") {
        invState._invOrdersMenu = null;
        invState._invOrdersDeleteConfirmOrderId = oid;
        mountOrRefreshMockUi();
        return true;
      }
      if (act === "markOrdered") {
        invState._invOrdersMenu = null;
        invState._invOrdersMarkOrderedConfirmOrderId = oid;
        mountOrRefreshMockUi();
        return true;
      }
      return true;
    }
    if (t.closest("[data-inv-orders-menu-dismiss]")) {
      ev.preventDefault();
      invState._invOrdersMenu = null;
      mountOrRefreshMockUi();
      return true;
    }
    const ordersDelCommit = t.closest("[data-inv-orders-delete-commit]");
    if (ordersDelCommit && root.contains(ordersDelCommit)) {
      ev.preventDefault();
      const oid = ordersDelCommit.getAttribute("data-order-id");
      if (oid && invState._invOrdersDeleteConfirmOrderId === oid) {
        void deleteInventoryOrderDraftConfirmed(oid);
      }
      return true;
    }
    if (t.closest("[data-inv-orders-delete-cancel]") || t.id === "ff-inv-orders-delete-backdrop") {
      ev.preventDefault();
      invState._invOrdersDeleteConfirmOrderId = null;
      mountOrRefreshMockUi();
      return true;
    }
    const ordersMarkOrdCommit = t.closest("[data-inv-orders-mark-ordered-commit]");
    if (ordersMarkOrdCommit && root.contains(ordersMarkOrdCommit)) {
      ev.preventDefault();
      const oid = ordersMarkOrdCommit.getAttribute("data-order-id");
      if (oid && invState._invOrdersMarkOrderedConfirmOrderId === oid) {
        void markInventoryOrderOrderedConfirmed(oid);
      }
      return true;
    }
    if (t.closest("[data-inv-orders-mark-ordered-cancel]") || t.id === "ff-inv-orders-mark-ordered-backdrop") {
      ev.preventDefault();
      invState._invOrdersMarkOrderedConfirmOrderId = null;
      mountOrRefreshMockUi();
      return true;
    }

    const ordersRenameSave = t.closest("[data-inv-orders-rename-save]");
    if (ordersRenameSave && root.contains(ordersRenameSave)) {
      ev.preventDefault();
      if (ordersRenameSave instanceof HTMLButtonElement && ordersRenameSave.disabled) return;
      const oid = ordersRenameSave.getAttribute("data-order-id");
      const inp = root.querySelector("[data-inv-orders-rename-input]");
      const val = inp instanceof HTMLInputElement ? inp.value : "";
      if (oid && invState._invOrdersRenameModal && invState._invOrdersRenameModal.orderId === oid) {
        void renameInventoryOrderConfirmed(oid, val);
      }
      return true;
    }
    if (
      t.closest("[data-inv-orders-rename-cancel]") ||
      t.id === "ff-inv-orders-rename-backdrop"
    ) {
      ev.preventDefault();
      if (invState._invOrdersRenameModal && invState._invOrdersRenameModal.busy) return;
      invState._invOrdersRenameModal = null;
      mountOrRefreshMockUi();
      return true;
    }

    const ordBreakdownRemove = t.closest("[data-inv-ord-breakdown-remove]");
    if (ordBreakdownRemove && root.contains(ordBreakdownRemove)) {
      ev.preventDefault();
      if (ordBreakdownRemove instanceof HTMLButtonElement && ordBreakdownRemove.disabled) return;
      if (!invState._invOrderCellBreakdownModal) return;
      const rid = ordBreakdownRemove.getAttribute("data-inv-ord-breakdown-remove");
      if (!rid) return;
      const { rowId, groupId } = invState._invOrderCellBreakdownModal;
      void removeApprovedContributionForCell(rowId, groupId, rid);
      return true;
    }
    if (
      t.closest("[data-inv-ord-breakdown-close]") ||
      t.id === "ff-inv-ord-breakdown-backdrop"
    ) {
      ev.preventDefault();
      if (invState._invOrderCellBreakdownModal && invState._invOrderCellBreakdownModal.busy) return;
      invState._invOrderCellBreakdownModal = null;
      mountOrRefreshMockUi();
      return true;
    }

    const ordersStatusFilterChip = t.closest("[data-inv-orders-status-filter]");
    if (ordersStatusFilterChip && root.contains(ordersStatusFilterChip)) {
      ev.preventDefault();
      const v = ordersStatusFilterChip.getAttribute("data-inv-orders-status-filter");
      if (v === "all" || v === "open" || v === "in_progress" || v === "done") {
        invState._invOrdersStatusFilter = v;
        mountOrRefreshMockUi();
      }
      return true;
    }

    const ordersSearchClear = t.closest("[data-inv-orders-search-clear]");
    if (ordersSearchClear && root.contains(ordersSearchClear)) {
      ev.preventDefault();
      invState._invOrdersSearchQuery = "";
      mountOrRefreshMockUi();
      const inp = root.querySelector("[data-inv-orders-search-input]");
      if (inp instanceof HTMLInputElement) inp.focus();
      return true;
    }

    const odPrintBtn = t.closest("[data-inv-order-detail-print]");
    if (odPrintBtn && root.contains(odPrintBtn)) {
      ev.preventDefault();
      if (isInvOrderDetailCommitBusy()) return;
      const det = odPrintBtn.closest("details");
      if (det) det.open = false;
      triggerOrderDetailPrint();
      return true;
    }
    const odCsvBtn = t.closest("[data-inv-order-detail-export-csv]");
    if (odCsvBtn && root.contains(odCsvBtn)) {
      ev.preventDefault();
      if (isInvOrderDetailCommitBusy()) return;
      const det = odCsvBtn.closest("details");
      if (det) det.open = false;
      triggerOrderDetailExportCsv();
      return true;
    }

    const odPurchaseCommit = t.closest("[data-inv-order-detail-confirm-purchase]");
    if (odPurchaseCommit && root.contains(odPurchaseCommit)) {
      ev.preventDefault();
      if (isInvOrderDetailCommitBusy()) return;
      const oid = odPurchaseCommit.getAttribute("data-order-id");
      if (oid && invState._invOrdersDetailOrderId === oid) {
        void confirmInventoryOrderPurchase(oid);
      }
      return true;
    }

    const odReceiveCommit = t.closest("[data-inv-order-detail-receive-commit]");
    if (odReceiveCommit && root.contains(odReceiveCommit)) {
      ev.preventDefault();
      if (isInvOrderDetailCommitBusy()) return;
      const oid = odReceiveCommit.getAttribute("data-order-id");
      if (oid && invState._invOrdersDetailOrderId === oid) {
        void confirmInventoryOrderReceived(oid);
      }
      return true;
    }

    const detailFilterChip = t.closest("[data-inv-order-detail-filter]");
    if (detailFilterChip && root.contains(detailFilterChip)) {
      ev.preventDefault();
      if (isInvOrderDetailCommitBusy()) return;
      const v = detailFilterChip.getAttribute("data-inv-order-detail-filter");
      if (v === "all" || v === "open" || v === "received") {
        invState._invOrderDetailFilter = v;
        mountOrRefreshMockUi();
      }
      return true;
    }

    const odLineViewClose = t.closest("[data-inv-od-line-view-close]");
    if (odLineViewClose && root.contains(odLineViewClose)) {
      ev.preventDefault();
      invState._invOrderDetailLineViewIdx = null;
      mountOrRefreshMockUi();
      return true;
    }
    if (t.id === "ff-inv-od-line-view-backdrop") {
      ev.preventDefault();
      invState._invOrderDetailLineViewIdx = null;
      mountOrRefreshMockUi();
      return true;
    }

    const shopRow = t.closest("[data-inv-detail-shopping-row]");
    if (shopRow && root.contains(shopRow)) {
      if (t.closest(".ff-inv2-od-shopping-check-label")) return;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "BUTTON" || tag === "A" || tag === "LABEL" || tag === "TEXTAREA" || tag === "SELECT")
        return true;
      ev.preventDefault();
      if (isInvOrderDetailCommitBusy()) return;
      const cb = shopRow.querySelector("input[data-inv-shopping-check]");
      if (cb instanceof HTMLInputElement && !cb.disabled) {
        const oid = cb.getAttribute("data-order-id");
        const idxStr = cb.getAttribute("data-line-idx");
        if (oid != null && idxStr != null) {
          toggleShoppingRowQty(oid, Number(idxStr));
        }
      }
      return true;
    }

    const receiptInfoBackdrop = root.querySelector("#ff-inv-receipt-info-backdrop");
    if (receiptInfoBackdrop) {
      const receiptInfoSave = t.closest("[data-inv-receipt-info-save]");
      if (receiptInfoSave && root.contains(receiptInfoSave)) {
        ev.preventDefault();
        const oid = receiptInfoSave.getAttribute("data-order-id");
        if (!oid || oid !== invState._invReceiptInfoModalOrderId) return;
        const card = receiptInfoBackdrop.querySelector("[data-inv-receipt-info-card]");
        if (!card) return;
        const n = card.querySelector('[data-inv-receipt-info-field="note"]');
        const s = card.querySelector('[data-inv-receipt-info-field="supplierName"]');
        const a = card.querySelector('[data-inv-receipt-info-field="amount"]');
        invState._invOrderReceiptUploadFieldsByOrderId[oid] = {
          note: n instanceof HTMLInputElement ? n.value.trim() : "",
          supplierName: s instanceof HTMLInputElement ? s.value.trim() : "",
          amount: a instanceof HTMLInputElement ? a.value.trim() : "",
        };
        invState._invReceiptInfoModalOrderId = null;
        inventoryOrderDraftToast("Receipt details saved.", "success");
        mountOrRefreshMockUi();
        return true;
      }
      if (
        t.id === "ff-inv-receipt-info-backdrop" ||
        t.closest("[data-inv-receipt-info-cancel]") ||
        t.closest("[data-inv-receipt-info-close]")
      ) {
        ev.preventDefault();
        invState._invReceiptInfoModalOrderId = null;
        mountOrRefreshMockUi();
        return true;
      }
    }

    const receiptInfoOpen = t.closest("[data-inv-order-receipt-info]");
    if (receiptInfoOpen && root.contains(receiptInfoOpen)) {
      ev.preventDefault();
      if (receiptInfoOpen instanceof HTMLButtonElement && receiptInfoOpen.disabled) return;
      const oid = receiptInfoOpen.getAttribute("data-order-id");
      if (oid && invState._invOrdersDetailOrderId === oid) {
        invState._invReceiptInfoModalOrderId = oid;
        mountOrRefreshMockUi();
      }
      return true;
    }

    const receiptOpenBtn = t.closest("[data-inv-order-receipt-open]");
    if (receiptOpenBtn && root.contains(receiptOpenBtn)) {
      ev.preventDefault();
      ev.stopPropagation();
      if (receiptOpenBtn instanceof HTMLButtonElement && receiptOpenBtn.disabled) return;
      const oid = receiptOpenBtn.getAttribute("data-order-id");
      const card = receiptOpenBtn.closest("[data-inv-receipt-info-card]");
      const scope = card || root.querySelector("#ff-inv-receipt-info-backdrop");
      const inp =
        scope && oid
          ? Array.from(scope.querySelectorAll("input[data-inv-order-receipt-file]")).find(
              (el) => el.getAttribute("data-order-id") === oid
            )
          : null;
      if (inp instanceof HTMLInputElement) inp.click();
      return true;
    }

    const receiptDeleteBtn = t.closest("[data-inv-order-receipt-delete]");
    if (receiptDeleteBtn && root.contains(receiptDeleteBtn)) {
      ev.preventDefault();
      ev.stopPropagation();
      const oid = receiptDeleteBtn.getAttribute("data-order-id");
      const rid = receiptDeleteBtn.getAttribute("data-receipt-id");
      if (oid && rid && oid === invState._invReceiptInfoModalOrderId) {
        void deleteInventoryOrderReceipt(oid, rid);
      }
      return true;
    }

    const orderRow = t.closest("[data-inv-order-row]");
    if (orderRow && root.contains(orderRow)) {
      if (t.closest("[data-inv-orders-actions]") || t.closest(".ff-inv2-row-menu")) return;
      ev.preventDefault();
      const oid = orderRow.getAttribute("data-inv-order-id");
      if (oid) {
        if (invState._invOrdersDetailOrderId != null && invState._invOrdersDetailOrderId !== oid) {
          invState._invOrderDetailFilter = "all";
        }
        invState._invOrderDetailLineViewIdx = null;
        invState._invOrdersDetailOrderId = oid;
        mountOrRefreshMockUi();
      }
      return true;
    }
    if (t.closest("[data-inv-order-detail-close]") || t.id === "ff-inv-order-detail-backdrop") {
      ev.preventDefault();
      if (isInvOrderDetailCommitBusy()) return;
      invState._invReceiptInfoModalOrderId = null;
      invState._invOrderDetailLineViewIdx = null;
      invState._invOrdersDetailOrderId = null;
      mountOrRefreshMockUi();
      return true;
    }
  return false;
}
