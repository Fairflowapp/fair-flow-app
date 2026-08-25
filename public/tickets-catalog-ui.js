/**
 * Tickets — Service Catalog UI barrel (Phase 8b).
 *
 * tickets-catalog-ui.js was split into three focused modules:
 *   - tickets-catalog-render.js  (screen/modal shell, list + detail render, screen DnD)
 *   - tickets-catalog-tabs.js    (Locations + Staff-services per-service tabs)
 *   - tickets-catalog-edit.js    (context menus, catalog DnD, add/edit editor)
 *
 * This barrel preserves the original public API and the single initTicketsCatalogUI
 * entry point so tickets.js is unchanged. It fans the injected tickets.js helpers
 * out to each sub-module, and injects the render layer's entry points into the
 * tabs/edit modules (breaking the dependency cycle: render -> {tabs, edit}).
 */
import { initCatalogRender, renderServicesCatalogV2, renderServicesScreenDetail, _ffIsServicesScreenRoot } from "./tickets-catalog-render.js?v=20260824_svc_load_fix";
import { initCatalogTabs } from "./tickets-catalog-tabs.js?v=20260824_svc_load_fix";
import { initCatalogEdit } from "./tickets-catalog-edit.js?v=20260824_svc_load_fix";

export function initTicketsCatalogUI(deps) {
  initCatalogRender({
    showToast: deps.showToast,
    setupTicketsUI: deps.setupTicketsUI,
  });
  initCatalogTabs({
    showToast: deps.showToast,
    setupTicketsUI: deps.setupTicketsUI,
    getServiceStaffOverrides: deps.getServiceStaffOverrides,
    controlledStaffCanProvideService: deps.controlledStaffCanProvideService,
    renderServicesCatalogV2,
    renderServicesScreenDetail,
  });
  initCatalogEdit({
    showToast: deps.showToast,
    ticketConfirm: deps.ticketConfirm,
    setupTicketsUI: deps.setupTicketsUI,
    renderServicesCatalogV2,
    _ffIsServicesScreenRoot,
  });
}

export {
  _ffCatalogRenderRoot,
  _ffCatalogEl,
  _ffEnsureCatalogEditorPortal,
  _ffIsServicesScreenRoot,
  _ffServicesScreenIsMobile,
  _ffServicesMobileShowList,
  _ffServicesMobileShowDetail,
  openServicesModal,
  closeServicesModal,
  renderServicesCatalogV2,
  renderServicesScreenCatalogList,
  _ffWireServicesScreenDragDrop,
  _ffReorderServiceWithinCategory,
  renderServicesScreenDetail,
} from "./tickets-catalog-render.js?v=20260818_staff_dur_ui";

export {
  renderServicesLocationsTabHtml,
  wireServicesLocationsTab,
  ffServiceStaffPermissionTrue,
  isServiceProviderStaffForServices,
  canStaffSendNewTicket,
  getServicesEligibleStaffRows,
  getServiceStaffId,
  getServiceStaffName,
  getStaffDefaultServiceCommission,
  formatServiceStaffDefaultCommission,
  getStaffDefaultSupplyDeduction,
  formatServiceStaffSupplyDeductionLabel,
  renderServicesStaffTabHtml,
  saveServiceStaffOverride,
  ffStaffServicesLoadForStaffMember,
  ffStaffServicesSaveOverrideForStaffMember,
  ffStaffServicesGetOverrideForStaffMember,
  ffStaffServicesDefaultsForStaffMember,
  wireServicesStaffTab,
} from "./tickets-catalog-tabs.js?v=20260818_staff_dur_ui";

export {
  _ffShowServicesCategoryDetailMenu,
  _ffShowCategoryMenu,
  _ffShowServiceMenu,
  _ffShowMoveServicePicker,
  _ffCloseAllPopovers,
  _ffBuildPopover,
  _ffClearDragHover,
  _ffWireCatalogDragDrop,
  _ffReorderCategoriesBefore,
  _ffReorderServiceBefore,
  _ffMoveServiceToCategoryEnd,
  _ffCatalogEditorOpen,
  _ffCatalogEditorClose,
  _ffCatalogEditorSubmit,
  addServiceCategoryV2,
  addSharedServiceV2,
} from "./tickets-catalog-edit.js?v=20260818_staff_dur_ui";
