// inventory-shell.js
// Inventory screen shell: main tabs/panels HTML, style injection, full layout mount,
// and read-only UI affordances. Extracted verbatim from inventory.js (Phase 11).
// Cross-module render/helpers are injected via initInventoryShell() from the orchestrator.

import { invState } from "./inventory-state.js?v=20260902_inv_iso";
import { escapeHtml } from "./inventory-helpers.js?v=20260902_inv_iso";
import { INVENTORY_STYLES } from "./inventory-styles.js?v=20260902_inv_iso";
import {
  STYLE_ID,
  ffCanManageInventory,
  _ffInvActiveLocId,
  _ffInvUserHasMultipleLocations,
} from "./inventory-spine.js?v=20260902_inv_iso";

// ── injected by initInventoryShell() (orchestrator spine + sub-app render fns) ──
let ensureInventoryScreenDelegates;
let prepareInventoryTableStateForMount;
let ensureGroupCellsForRows;
let prepareOrderBuilderPreviewForMount;
let getSelectedSubMeta;
let getCategoryTree;
let resetCatModalTransientState;
let renderSidebarHtml;
let renderOrderListSectionHtml;
let renderOrdersTabHtml;
let renderInventoryInsightsTabHtml;
let renderInventoryTableCardHtml;
let renderRemoveGroupModal;
let renderManageCategoriesModal;
let renderCategoryDeleteConfirmModal;
let renderDeleteRowModal;
let renderInvRowMenu;
let renderInventoryOrderDetailModal;
let renderOrderDetailLineViewModal;
let renderReceiptInfoModal;
let renderInventoryOrdersMenu;
let renderInventoryOrdersDeleteModal;
let renderInventoryOrdersMarkOrderedModal;
let renderInventoryOrdersRenameModal;
let renderInventoryOrderBuilderAddItemModal;
let renderInventoryOrderCellBreakdownModal;
let renderInventoryDraftsPickerModal;
let ensureShoppingDraft;
let ensureInventoryOrderReceiptsSubscription;
let ensureInvMobileColHeaderBindOnce;
let applyInvMobileColumnClasses;
let scheduleSyncInvColWidthsAfterLayout;
let syncOrderBuilderCategoryCheckboxIndeterminate;
let clearInventoryTableSaveTimer;
let flushInventoryTableToFirestore;

export function initInventoryShell(deps) {
  ({
    ensureInventoryScreenDelegates,
    prepareInventoryTableStateForMount,
    ensureGroupCellsForRows,
    prepareOrderBuilderPreviewForMount,
    getSelectedSubMeta,
    getCategoryTree,
    resetCatModalTransientState,
    renderSidebarHtml,
    renderOrderListSectionHtml,
    renderOrdersTabHtml,
    renderInventoryInsightsTabHtml,
    renderInventoryTableCardHtml,
    renderRemoveGroupModal,
    renderManageCategoriesModal,
    renderCategoryDeleteConfirmModal,
    renderDeleteRowModal,
    renderInvRowMenu,
    renderInventoryOrderDetailModal,
    renderOrderDetailLineViewModal,
    renderReceiptInfoModal,
    renderInventoryOrdersMenu,
    renderInventoryOrdersDeleteModal,
    renderInventoryOrdersMarkOrderedModal,
    renderInventoryOrdersRenameModal,
    renderInventoryOrderBuilderAddItemModal,
    renderInventoryOrderCellBreakdownModal,
    renderInventoryDraftsPickerModal,
    ensureShoppingDraft,
    ensureInventoryOrderReceiptsSubscription,
    ensureInvMobileColHeaderBindOnce,
    applyInvMobileColumnClasses,
    scheduleSyncInvColWidthsAfterLayout,
    syncOrderBuilderCategoryCheckboxIndeterminate,
    clearInventoryTableSaveTimer,
    flushInventoryTableToFirestore,
  } = deps);
}

function renderInvMainTabsHtml() {
  let tabs = [
    { id: "inventory", label: "Inventory" },
    { id: "orderBuilder", label: "Create Order" },
    { id: "orders", label: "Orders" },
    { id: "insights", label: "Insights" },
  ];
  // View-only users only get the read-only Inventory tab. Create Order, Orders
  // and Insights are management surfaces and stay hidden for them.
  if (!ffCanManageInventory()) {
    tabs = tabs.filter((x) => x.id === "inventory");
  }
  return `<div class="ff-inv2-main-tabs" role="tablist" aria-label="Inventory workspace">
${tabs
  .map((x) => {
    const active = invState._invMainTab === x.id;
    return `    <button type="button" role="tab" class="ff-inv2-main-tab${active ? " ff-inv2-main-tab--active" : ""}" aria-selected="${active ? "true" : "false"}" data-inv-main-tab="${escapeHtml(x.id)}">${escapeHtml(x.label)}</button>`;
  })
  .join("\n")}
  </div>`;
}

function renderInvMainTabPanelsHtml() {
  if (invState._invMainTab === "orderBuilder") {
    return `<div class="ff-inv2-main-tab-body ff-inv2-main-tab-body--order">
      <div class="ff-inv2-order-builder-wrap">${renderOrderListSectionHtml()}</div>
    </div>`;
  }
  if (invState._invMainTab === "orders") {
    return `<div class="ff-inv2-main-tab-body ff-inv2-main-tab-body--orders">${renderOrdersTabHtml()}</div>`;
  }
  if (invState._invMainTab === "insights") {
    return `<div class="ff-inv2-main-tab-body ff-inv2-main-tab-body--insights">${renderInventoryInsightsTabHtml()}</div>`;
  }
  return `<div class="ff-inv2-main-tab-body ff-inv2-main-tab-body--inventory">${renderInventoryTableCardHtml()}</div>`;
}

function injectMockStylesOnce() {
  if (document.getElementById(STYLE_ID)) return;
  document.querySelectorAll('style[id^="ff-inv2-mock-styles-v"]').forEach((s) => s.remove());
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = INVENTORY_STYLES;
  document.head.appendChild(el);
}

function mountOrRefreshMockUi() {
  const root = document.getElementById("inventoryScreen");
  if (!root) return;

  prepareInventoryTableStateForMount();
  ensureGroupCellsForRows();
  prepareOrderBuilderPreviewForMount();
  if (invState._groupRemoveModalGroupId && invState._groups && !invState._groups.some((g) => g.id === invState._groupRemoveModalGroupId)) {
    invState._groupRemoveModalGroupId = null;
  }
  if (invState._invRowMenu && invState._rows && !invState._rows.some((r) => r.id === invState._invRowMenu.rowId)) invState._invRowMenu = null;
  if (invState._invRowDeleteModalRowId && invState._rows && !invState._rows.some((r) => r.id === invState._invRowDeleteModalRowId)) invState._invRowDeleteModalRowId = null;
  if (invState._invOrdersMenu && !invState._invOrdersList.some((o) => o.id === invState._invOrdersMenu.orderId)) invState._invOrdersMenu = null;
  if (
    invState._invOrdersDeleteConfirmOrderId &&
    !invState._invOrdersList.some((o) => o.id === invState._invOrdersDeleteConfirmOrderId)
  ) {
    invState._invOrdersDeleteConfirmOrderId = null;
  }
  if (
    invState._invOrdersMarkOrderedConfirmOrderId &&
    !invState._invOrdersList.some((o) => o.id === invState._invOrdersMarkOrderedConfirmOrderId)
  ) {
    invState._invOrdersMarkOrderedConfirmOrderId = null;
  }
  if (
    invState._invOrdersRenameModal &&
    !invState._invOrdersList.some((o) => o.id === invState._invOrdersRenameModal.orderId)
  ) {
    invState._invOrdersRenameModal = null;
  }
  if (invState._invOrderDetailLineViewIdx != null && invState._invOrdersDetailOrderId) {
    const ord = invState._invOrdersList.find((x) => x.id === invState._invOrdersDetailOrderId);
    const nItems = ord && Array.isArray(ord.items) ? ord.items.length : 0;
    if (!ord || invState._invOrderDetailLineViewIdx < 0 || invState._invOrderDetailLineViewIdx >= nItems) {
      invState._invOrderDetailLineViewIdx = null;
    }
  }
  if (invState._invOrderCellBreakdownModal) {
    const row = Array.isArray(invState._rows) ? invState._rows.find((r) => r.id === invState._invOrderCellBreakdownModal.rowId) : null;
    const group = Array.isArray(invState._groups) ? invState._groups.find((g) => g.id === invState._invOrderCellBreakdownModal.groupId) : null;
    if (!row || !group) invState._invOrderCellBreakdownModal = null;
  }
  injectMockStylesOnce();
  root.classList.add("ff-inv2-screen");

  // View-only users can never land on a management tab (Create Order / Orders /
  // Insights); snap them back to the read-only Inventory tab.
  if (!ffCanManageInventory() && invState._invMainTab !== "inventory") {
    invState._invMainTab = "inventory";
    invState._invOrdersDetailOrderId = null;
  }

  const meta = getSelectedSubMeta();
  const crumb =
    invState._invMainTab === "orders"
      ? `<span class="ff-inv2-crumb"><strong>Orders</strong></span>`
      : meta
        ? `<span class="ff-inv2-crumb"><strong>${escapeHtml(meta.category.name)}</strong> · ${escapeHtml(meta.sub.name)}</span>`
        : `<span class="ff-inv2-crumb">Select a subcategory</span>`;
  const invStripLabel = meta
    ? `${meta.category.name} · ${meta.sub.name}`
    : "Select a subcategory";
  const hideCategoryAside = invState._invMainTab === "orders";
  let invMobileCollapsed = false;
  if (!hideCategoryAside) {
    try {
      invMobileCollapsed =
        typeof matchMedia !== "undefined" &&
        matchMedia("(max-width: 767.98px)").matches &&
        !invState._invMobileCatsPanelOpen &&
        !!invState._selectedSubcategoryId;
    } catch (_) {}
  }

  let layoutMobileCreateOrder = "";
  try {
    if (
      typeof matchMedia !== "undefined" &&
      matchMedia("(max-width: 767.98px)").matches &&
      invState._invMainTab === "orderBuilder"
    ) {
      layoutMobileCreateOrder = " ff-inv2-layout--mobile-create-order";
    }
  } catch (_) {}
  const layoutNoCats = hideCategoryAside ? " ff-inv2-layout--no-category-aside" : "";

  if (invState._invOrdersDetailOrderId) {
    ensureShoppingDraft(invState._invOrdersDetailOrderId);
  }
  if (
    invState._invReceiptInfoModalOrderId &&
    (!invState._invOrdersList.some((x) => x.id === invState._invReceiptInfoModalOrderId) ||
      invState._invReceiptInfoModalOrderId !== invState._invOrdersDetailOrderId ||
      !invState._invOrdersDetailOrderId)
  ) {
    invState._invReceiptInfoModalOrderId = null;
  }

  ensureInventoryOrderReceiptsSubscription();

  // Inline diagnostic banner removed — multi-branch isolation is confirmed
  // working end-to-end. Set `localStorage.setItem('ff_inv_debug', 'true')` in
  // the console to re-enable the banner for future debugging.
  let _ffInvDebugBanner = "";
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem("ff_inv_debug") === "true") {
      const activeLoc = _ffInvActiveLocId();
      const hasMulti = _ffInvUserHasMultipleLocations();
      _ffInvDebugBanner = `<div style="padding:6px 10px;margin:6px 8px 0;border-radius:6px;font:11px/1.3 system-ui;background:${activeLoc ? "#f1f5f9" : "#fef3c7"};color:#475569;">
         <strong>Branch:</strong> <code>${escapeHtml(activeLoc || "(NONE — filter is bypassed)")}</code>
         · <span>${getCategoryTree().length} cat(s)</span>
         · <span>multi=${hasMulti ? "yes" : "no"}</span>
       </div>`;
    }
  } catch (_) {}

  root.innerHTML = `
<div class="ff-inv2-layout${invMobileCollapsed ? " ff-inv2-layout--mobile-cats-collapsed" : ""}${layoutMobileCreateOrder}${layoutNoCats}">
  ${
    hideCategoryAside
      ? ""
      : `<aside class="ff-inv2-aside" aria-label="Categories">
    <button type="button" class="ff-inv2-mobile-cat-strip" data-inv-mobile-cat-strip="1" aria-expanded="${invMobileCollapsed ? "false" : "true"}" aria-controls="ff-inv2-aside-panel">
      <span class="ff-inv2-mobile-cat-strip-text">${escapeHtml(invStripLabel)}</span>
      <span class="ff-inv2-mobile-cat-strip-chev" aria-hidden="true">▾</span>
    </button>
    <div class="ff-inv2-aside-panel" id="ff-inv2-aside-panel">
    <div class="ff-inv2-aside-head ff-inv2-aside-head-row">
      <span class="ff-inv2-aside-head-left">
        <button type="button" class="ff-inv2-mobile-aside-collapse" data-inv-mobile-aside-collapse="1" aria-label="Collapse category list">▲</button>
        <span>Categories</span>
      </span>
      <span class="ff-inv2-aside-head-actions" style="display:inline-flex;gap:6px;align-items:center;">
        <button type="button" class="ff-inv2-aside-add" data-inv-import-shared-catalog="1">Import Shared</button>
        <button type="button" class="ff-inv2-aside-add" data-cat-manage-open="1">+ Add</button>
      </span>
    </div>
    ${_ffInvDebugBanner}
    <div class="ff-inv2-aside-body" id="ff-inv2-aside-body">${renderSidebarHtml()}</div>
    </div>
  </aside>`
  }
  <main class="ff-inv2-main" id="ff-inv2-main">
    <div class="ff-inv2-main-head">${crumb}</div>
    ${renderInvMainTabsHtml()}
    ${renderInvMainTabPanelsHtml()}
  </main>
</div>
${renderRemoveGroupModal()}
${renderManageCategoriesModal()}
${renderCategoryDeleteConfirmModal()}
${renderDeleteRowModal()}
${renderInvRowMenu()}
${renderInventoryOrderDetailModal()}
${renderOrderDetailLineViewModal()}
${renderReceiptInfoModal()}
${renderInventoryOrdersMenu()}
${renderInventoryOrdersDeleteModal()}
${renderInventoryOrdersMarkOrderedModal()}
${renderInventoryOrdersRenameModal()}
${renderInventoryOrderBuilderAddItemModal()}
${renderInventoryOrderCellBreakdownModal()}
${renderInventoryDraftsPickerModal()}`;

  ensureInventoryScreenDelegates(root);
  ensureInvMobileColHeaderBindOnce();
  applyInvMobileColumnClasses();
  scheduleSyncInvColWidthsAfterLayout();
  syncOrderBuilderCategoryCheckboxIndeterminate(root);
  _ffApplyInventoryReadonlyState(root);

  const asideBody = root.querySelector("#ff-inv2-aside-body");
  if (asideBody) {
    asideBody.querySelectorAll("[data-cat-toggle]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = el.getAttribute("data-cat-toggle");
        if (!id) return;
        if (invState._expandedCategoryIds.has(id)) invState._expandedCategoryIds.delete(id);
        else invState._expandedCategoryIds.add(id);
        mountOrRefreshMockUi();
      });
    });

    asideBody.querySelectorAll(".ff-inv2-sub[data-sub-id]").forEach((el) => {
    const go = async () => {
      const id = el.getAttribute("data-sub-id");
      if (!id) return;
      clearInventoryTableSaveTimer();
      try {
        // Never let a hung write block the category switch: on mobile a dead
        // connection (app resumed from background) makes this await hang
        // forever, which made taps on other subcategories do nothing. The SDK
        // keeps the write queued, so proceeding after a short grace is safe.
        await Promise.race([
          flushInventoryTableToFirestore(),
          new Promise((resolve) => setTimeout(resolve, 2500)),
        ]);
      } catch (e) {
        console.error("[Inventory] table flush before sub change", e);
      }
      invState._editCellKey = null;
      invState._invRowMenu = null;
      invState._invRowDeleteModalRowId = null;
      invState._manageCategoriesOpen = false;
      invState._catManageDraftTree = null;
      resetCatModalTransientState();
      invState._groupRemoveConfirmId = null;
      invState._groupRemoveModalGroupId = null;
      invState._selectedSubcategoryId = id;
      invState._invMainTab = "inventory";
      invState._invOrdersDetailOrderId = null;
      invState._invReceiptInfoModalOrderId = null;
      invState._invOrderDetailLineViewIdx = null;
      invState._invOrdersMenu = null;
      invState._invOrdersDeleteConfirmOrderId = null;
      invState._invOrdersMarkOrderedConfirmOrderId = null;
      invState._invOrdersRenameModal = null;
      invState._invOrderCellBreakdownModal = null;
      try {
        if (typeof matchMedia !== "undefined" && matchMedia("(max-width: 767.98px)").matches) {
          invState._invMobileCatsPanelOpen = false;
        }
      } catch (_) {}
      mountOrRefreshMockUi();
    };
    el.addEventListener("click", go);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    });
  });
  }
}

function _ffApplyInventoryReadonlyState(root) {
  try {
    if (!root) return;
    if (typeof document !== "undefined" && !document.getElementById("ff-inv2-readonly-style")) {
      const st = document.createElement("style");
      st.id = "ff-inv2-readonly-style";
      st.textContent =
        "#inventoryScreen.ff-inv2-readonly #ff-inv2-add-row," +
        "#inventoryScreen.ff-inv2-readonly #ff-inv2-add-group," +
        "#inventoryScreen.ff-inv2-readonly #ff-inv2-add-from-shared," +
        "#inventoryScreen.ff-inv2-readonly [data-inv-import-shared-catalog]," +
        "#inventoryScreen.ff-inv2-readonly [data-cat-manage-open]," +
        "#inventoryScreen.ff-inv2-readonly [data-inv-row-menu-trigger]," +
        "#inventoryScreen.ff-inv2-readonly .ff-inv2-row-kebab," +
        "#inventoryScreen.ff-inv2-readonly [data-inv-row-dnd]," +
        "#inventoryScreen.ff-inv2-readonly .ff-inv2-row-dnd-handle," +
        "#inventoryScreen.ff-inv2-readonly [data-inv-url-edit]{display:none !important;}";
      (document.head || document.documentElement).appendChild(st);
    }
    const canManage = ffCanManageInventory();
    root.classList.toggle("ff-inv2-readonly", !canManage);
    if (!canManage) {
      root.querySelectorAll("input[data-inv], textarea[data-inv]").forEach((el) => {
        try {
          el.readOnly = true;
          el.setAttribute("aria-readonly", "true");
        } catch (_) {}
      });
    }
  } catch (_) {}
}

export { mountOrRefreshMockUi };
