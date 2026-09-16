/**
 * Services catalog save toasts. Create vs edit only — no persistence.
 */
export function catalogServiceSavedToast(mode) {
  if (mode === "service-add" || mode === "shared-service-add") return "Service added";
  if (mode === "shared-service-edit") return "Service updated";
  return "Updated";
}

export function isCatalogServiceCreateMode(mode) {
  return mode === "service-add" || mode === "shared-service-add";
}

if (typeof window !== "undefined") {
  window.ffCatalogServiceToast = {
    catalogServiceSavedToast,
    isCatalogServiceCreateMode
  };
}
