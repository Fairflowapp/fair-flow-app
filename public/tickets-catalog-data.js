/**
 * tickets-catalog-data.js
 * Service catalog data entry — re-exports shared + local modules from the split.
 */
import "./tickets-catalog-data-shared.js?v=20260704_tickets_catalog_data_split";
import "./tickets-catalog-data-local.js?v=20260704_tickets_catalog_data_split";

export { initTicketsCatalogData } from "./tickets-catalog-data-local.js?v=20260704_tickets_catalog_data_split";
export {
  ffCanViewServices,
  ffCanManageServices,
  getTicketsAccountId,
  normalizeSharedCategoryName,
  sharedCategoryId,
  serviceCatalogStableKey,
  serviceCategoryDisplayId,
  sharedServiceCatalogDocRef,
  sharedServiceCatalogItemsRef,
  sharedServiceCategoriesDocRef,
  sharedServiceCategoryItemsRef,
  ensureSharedServiceCatalogDoc,
  ensureSharedServiceCategoriesDoc,
  loadSharedServiceOverrides,
  applySharedServiceCatalog,
  getSharedServicesForCatalogManager,
  getLocationServicesForCatalogManager,
  loadSharedCatalogForManager,
  saveSharedService,
  saveSharedServiceCategory,
  deleteSharedServiceCategory,
  deleteSharedService,
  saveSharedServiceOverride,
  removeSharedServiceOverride,
  loadSharedServiceLocationOverridesForService,
  saveSharedServiceLocationOverride,
  tryLoadSharedServiceCatalog,
  _ffServiceMatchesActiveLocation,
} from "./tickets-catalog-data-shared.js?v=20260704_tickets_catalog_data_split";
export {
  loadLocationCatalogForManager,
  seedSharedServiceCatalogFromLocationCatalogIfEmpty,
  _ffWipeLegacyCatalogOnce,
  _applyCatalogFilter,
  _onCatalogSnapshot,
  subscribeServiceCatalog,
  subscribeProductsCatalog,
  loadServices,
  saveService,
  deleteService,
  loadServiceCategories,
  saveServiceCategory,
  deleteServiceCategory,
} from "./tickets-catalog-data-local.js?v=20260704_tickets_catalog_data_split";
