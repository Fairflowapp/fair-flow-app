// inventory-orders-receipts.js
// Orders sub-app — receipts. Extracted verbatim from inventory-orders.js.
// Shared state in inventory-state.js; orchestrator/back-edge deps injected via initOrdersReceipts().

import { db, auth, storage } from "/app.js?v=20260610_force_lp_ios";
import {
  doc,
  collection,
  setDoc,
  serverTimestamp,
  query,
  orderBy,
  deleteDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { invState } from "./inventory-state.js?v=20260627_inventory_split";
import {
  escapeHtml,
  formatInventoryOrderCreatedAt,
  sanitizeReceiptStorageFileName,
  getReceiptFileTypeEmoji,
} from "./inventory-helpers.js?v=20260627_inventory_split";
import { inventoryOrderDraftToast } from "./inventory-orders-core.js?v=20260702_inventory_insights_split";
import { isInvOrderDetailCommitBusy } from "./inventory-orders-detail.js?v=20260702_inventory_insights_split";

// ── injected by initOrdersReceipts() (orchestrator spine + builder back-edges) ──
let getSalonId, mountOrRefreshMockUi;
export function initOrdersReceipts(deps) {
  ({ getSalonId, mountOrRefreshMockUi } = deps);
}


export function teardownInventoryOrderReceiptsListener() {
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

export function getActiveReceiptSubscriptionOrderId() {
  return invState._invOrdersDetailOrderId;
}

export function ensureInventoryOrderReceiptsSubscription() {
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

export function getReceiptUploadFieldsForOrder(orderId) {
  const e = invState._invOrderReceiptUploadFieldsByOrderId[orderId];
  if (!e) return { note: "", supplierName: "", amount: "" };
  return {
    note: String(e.note ?? "").trim(),
    supplierName: String(e.supplierName ?? "").trim(),
    amount: String(e.amount ?? "").trim(),
  };
}

export function getOrderReceiptUploadOptions(root, orderId) {
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

export async function handleInventoryOrderReceiptFileSelected(root, orderId, file) {
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
export function buildReceiptsListBlockHtml() {
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

export async function deleteInventoryOrderReceipt(orderId, receiptId) {
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

export function renderReceiptInfoModal() {
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
