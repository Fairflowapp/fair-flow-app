// inventory-orders-list.js
// Orders sub-app — list. Extracted verbatim from inventory-orders.js.
// Shared state in inventory-state.js; orchestrator/back-edge deps injected via initOrdersList().

import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import {
  doc,
  getDocs,
  collection,
  updateDoc,
  addDoc,
  serverTimestamp,
  query,
  orderBy,
  where,
  deleteDoc,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { invState } from "./inventory-state.js?v=20260627_inventory_split";
import {
  escapeHtml,
  orderHasAppliedInventoryImpact,
  formatInventoryOrderSourceLabel,
  getInventoryOrderDisplayName,
  formatInventoryOrderCreatedAt,
  formatInventoryOrderStatusDisplay,
  getInventoryOrderStatusKey,
  getOrderSearchHaystack,
  clonePlainForFirestoreOrderPayload,
} from "./inventory-helpers.js?v=20260627_inventory_split";
import { inventoryOrderDraftToast } from "./inventory-orders-core.js?v=20260627_inventory_orders_split";

// ── injected by initOrdersList() (orchestrator spine + builder back-edges) ──
let getSalonId, mountOrRefreshMockUi, _ffInvActiveLocId, _ffInvDocInActiveLoc, isInvMobileNarrow, renderOrderBuilderSourceHtml;
export function initOrdersList(deps) {
  ({ getSalonId, mountOrRefreshMockUi, _ffInvActiveLocId, _ffInvDocInActiveLoc, isInvMobileNarrow, renderOrderBuilderSourceHtml } = deps);
}


export function renderOrderListSectionHtml() {
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

export function orderMatchesInventoryStatusFilter(o) {
  if (invState._invOrdersStatusFilter === "all") return true;
  return getInventoryOrderStatusKey(o) === invState._invOrdersStatusFilter;
}

export function orderMatchesInventorySearchQuery(o) {
  const q = invState._invOrdersSearchQuery.trim().toLowerCase();
  if (!q) return true;
  return getOrderSearchHaystack(o).includes(q);
}

/**
 * @param {{ silent?: boolean } | undefined} opts
 * If silent, skip full-screen loading state (e.g. after duplicate/delete).
 */
export async function loadInventoryOrdersList(opts) {
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

export async function duplicateInventoryOrderDraft(orderId) {
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

export async function deleteInventoryOrderDraftConfirmed(orderId) {
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

export async function markInventoryOrderOrderedConfirmed(orderId) {
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

export function renderOrdersTabHtml() {
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

export function renderInventoryOrdersMenu() {
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

export function renderInventoryOrdersRenameModal() {
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

export async function renameInventoryOrderConfirmed(orderId, rawName) {
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

export function renderInventoryOrdersDeleteModal() {
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

export function renderInventoryOrdersMarkOrderedModal() {
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
