// inventory-catalog.js
// Inventory > Catalog barrel. The Catalog code was split by sub-topic into:
//   inventory-catalog-data.js  (Firestore load/persist/import, tree state + getters)
//   inventory-catalog-ui.js    (Manage Categories DnD, sidebar + modal rendering)
// This barrel re-exports the full original public surface so external importers
// (inventory.js, inventory-nav.js, delegates, orders + table modules) are unchanged.

import { initCatalogData } from "./inventory-catalog-data.js?v=20260702_inventory_catalog_split";
import { initCatalogUi } from "./inventory-catalog-ui.js?v=20260702_inventory_catalog_split";

export * from "./inventory-catalog-data.js?v=20260702_inventory_catalog_split";
export * from "./inventory-catalog-ui.js?v=20260702_inventory_catalog_split";

/** Wire the orchestrator spine (from inventory.js) into both catalog sub-modules. */
export function initInventoryCatalog(deps) {
  initCatalogData(deps);
  initCatalogUi(deps);
}
