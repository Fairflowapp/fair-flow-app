// inventory-styles.js
// Barrel for the Inventory screen CSS. The static stylesheet was split 4 ways
// by theme — cascade-preserving, contiguous, byte-identical slices — into the
// files imported below. Re-exported here as a single INVENTORY_STYLES string so
// that inventory.js / injectMockStylesOnce() stay unchanged (same import, same
// concatenated value, identical cascade order).

import { INVENTORY_STYLES_SHELL } from "./inventory-styles-shell.js?v=20260627_inv_css_quad";
import { INVENTORY_STYLES_ORDERS } from "./inventory-styles-orders.js?v=20260627_inv_css_quad";
import { INVENTORY_STYLES_INSIGHTS } from "./inventory-styles-insights.js?v=20260627_inv_css_quad";
import { INVENTORY_STYLES_TABLE } from "./inventory-styles-table.js?v=20260627_inv_css_quad";

export const INVENTORY_STYLES =
  INVENTORY_STYLES_SHELL +
  INVENTORY_STYLES_ORDERS +
  INVENTORY_STYLES_INSIGHTS +
  INVENTORY_STYLES_TABLE;
