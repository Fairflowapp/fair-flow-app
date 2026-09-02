// inventory-insights.js
// Inventory > Insights barrel. The Insights code was split by sub-topic into:
//   inventory-insights-scans.js    (background scans: usage suggestions, reorder-point alerts)
//   inventory-insights-compute.js  (constants, date ranges, data load + compute)
//   inventory-insights-ui.js       (donut SVG, currency format, tab HTML render)
// This barrel re-exports the full original public surface so external importers
// (inventory.js, inventory-nav.js, delegates, table modules) are unchanged.

import { initInsightsScans } from "./inventory-insights-scans.js?v=20260902_prod_cats";
import { initInsightsCompute } from "./inventory-insights-compute.js?v=20260902_inv_iso";

export * from "./inventory-insights-scans.js?v=20260902_prod_cats";
export * from "./inventory-insights-compute.js?v=20260902_inv_iso";
export * from "./inventory-insights-ui.js?v=20260902_inv_iso";

/** Wire the orchestrator spine (from inventory.js) into both stateful sub-modules. */
export function initInventoryInsights(deps) {
  initInsightsScans(deps);
  initInsightsCompute(deps);
}
