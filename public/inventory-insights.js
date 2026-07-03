// inventory-insights.js
// Inventory > Insights barrel. The Insights code was split by sub-topic into:
//   inventory-insights-scans.js    (background scans: usage suggestions, reorder-point alerts)
//   inventory-insights-compute.js  (constants, date ranges, data load + compute)
//   inventory-insights-ui.js       (donut SVG, currency format, tab HTML render)
// This barrel re-exports the full original public surface so external importers
// (inventory.js, inventory-nav.js, delegates, table modules) are unchanged.

import { initInsightsScans } from "./inventory-insights-scans.js?v=20260702_inventory_catalog_split";
import { initInsightsCompute } from "./inventory-insights-compute.js?v=20260702_inventory_catalog_split";

export * from "./inventory-insights-scans.js?v=20260702_inventory_catalog_split";
export * from "./inventory-insights-compute.js?v=20260702_inventory_catalog_split";
export * from "./inventory-insights-ui.js?v=20260702_inventory_catalog_split";

/** Wire the orchestrator spine (from inventory.js) into both stateful sub-modules. */
export function initInventoryInsights(deps) {
  initInsightsScans(deps);
  initInsightsCompute(deps);
}
