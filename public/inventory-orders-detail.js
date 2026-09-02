// inventory-orders-detail.js
// Orders sub-app — detail barrel. The detail code was split by sub-topic into:
//   inventory-orders-detail-commit.js  (Firestore commits: receive/purchase/price, local drafts)
//   inventory-orders-detail-ui.js      (modal render, export/print, row interactions)
// This barrel re-exports the full original public surface so external importers
// (inventory-orders.js, inventory-orders-receipts.js, inventory-orders-builder.js) are unchanged.

import { initOrdersDetailCommit } from "./inventory-orders-detail-commit.js?v=20260902_inv_iso";
import { initOrdersDetailUi } from "./inventory-orders-detail-ui.js?v=20260902_inv_iso";

export * from "./inventory-orders-detail-commit.js?v=20260902_inv_iso";
export * from "./inventory-orders-detail-ui.js?v=20260902_inv_iso";

/** Wire the orchestrator spine (from inventory-orders.js) into both detail sub-modules. */
export function initOrdersDetail(deps) {
  initOrdersDetailCommit(deps);
  initOrdersDetailUi(deps);
}
