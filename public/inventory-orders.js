/**
 * Inventory — Orders sub-app barrel.
 *
 * The Orders code was split by sub-topic into:
 *   inventory-orders-core.js      (shared toast leaf)
 *   inventory-orders-list.js      (orders list, filters, list menus, main tab)
 *   inventory-orders-detail.js    (order detail modal, receive/purchase, export)
 *   inventory-orders-builder.js   (order builder, link picker, add-item)
 *   inventory-orders-drafts.js    (draft save/load/picker/switch)
 *   inventory-orders-receipts.js  (realtime receipts: upload/list/delete)
 *
 * Static import graph among them is acyclic; the two back-edges
 * (builder -> drafts/list) are injected here via initInventoryOrders().
 * This barrel re-exports the full original public surface so external
 * importers (inventory.js, inventory-table.js) are unchanged.
 */
import {
  initOrdersList,
} from "./inventory-orders-list.js?v=20260728_inv_mobile_unstick";
import {
  initOrdersDetail,
} from "./inventory-orders-detail.js?v=20260728_inv_mobile_unstick";
import {
  initOrdersReceipts,
} from "./inventory-orders-receipts.js?v=20260728_inv_mobile_unstick";
import {
  initOrdersBuilder,
  refreshOrderBuilderPreviewAsync,
  renderOrderBuilderSourceHtml,
} from "./inventory-orders-builder.js?v=20260728_inv_mobile_unstick";
import {
  initOrdersDrafts,
} from "./inventory-orders-drafts.js?v=20260728_inv_mobile_unstick";

// Re-export the full Orders public surface (verbatim names) from the sub-modules.
export * from "./inventory-orders-core.js?v=20260728_inv_mobile_unstick";
export * from "./inventory-orders-list.js?v=20260728_inv_mobile_unstick";
export * from "./inventory-orders-detail.js?v=20260728_inv_mobile_unstick";
export * from "./inventory-orders-builder.js?v=20260728_inv_mobile_unstick";
export * from "./inventory-orders-drafts.js?v=20260728_inv_mobile_unstick";
export * from "./inventory-orders-receipts.js?v=20260728_inv_mobile_unstick";

/**
 * Wire the orchestrator spine (from inventory.js) into each Orders sub-module,
 * and inject the two builder back-edges to keep the static graph acyclic:
 *   refreshOrderBuilderPreviewAsync  -> drafts
 *   renderOrderBuilderSourceHtml     -> list
 */
export function initInventoryOrders(deps) {
  const {
    getSalonId,
    mountOrRefreshMockUi,
    _ffInvActiveLocId,
    _ffInvDocInActiveLoc,
    getSelectedSubMeta,
    isInvMobileNarrow,
    loadInventoryTableForSub,
    fetchSubcategoryInventoryDoc,
    findCategoryAndSubForSubId,
  } = deps;

  initOrdersList({
    getSalonId,
    mountOrRefreshMockUi,
    _ffInvActiveLocId,
    _ffInvDocInActiveLoc,
    isInvMobileNarrow,
    renderOrderBuilderSourceHtml,
  });
  initOrdersDetail({
    getSalonId,
    mountOrRefreshMockUi,
    getSelectedSubMeta,
    loadInventoryTableForSub,
    findCategoryAndSubForSubId,
  });
  initOrdersReceipts({
    getSalonId,
    mountOrRefreshMockUi,
  });
  initOrdersDrafts({
    getSalonId,
    mountOrRefreshMockUi,
    _ffInvActiveLocId,
    _ffInvDocInActiveLoc,
    findCategoryAndSubForSubId,
    refreshOrderBuilderPreviewAsync,
  });
  initOrdersBuilder({
    getSalonId,
    mountOrRefreshMockUi,
    getSelectedSubMeta,
    fetchSubcategoryInventoryDoc,
    findCategoryAndSubForSubId,
    goToInventory: deps.goToInventory,
  });
}
