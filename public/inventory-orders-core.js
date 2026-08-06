// inventory-orders-core.js
// Orders shared leaf — toast helper used by all Orders sub-topics. No sibling imports.

export function inventoryOrderDraftToast(message, variant) {
  if (typeof window !== "undefined" && window.ffToast && typeof window.ffToast.show === "function") {
    window.ffToast.show(String(message), { variant: variant || "info", durationMs: 3800 });
  }
}
