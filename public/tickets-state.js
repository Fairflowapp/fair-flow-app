/**
 * Tickets — centralized module state (Phase 0 extraction).
 *
 * Holds every mutable module-level variable that previously lived at the top of
 * tickets.js. All reads/writes go through `ticketsState.X` so the (soon to be
 * split) tickets-* sub-modules can share one source of truth without circular
 * imports. Immutable page-size constants are exported separately as named consts.
 *
 * NOTE: This module only declares state — no behavior. resetTicketsRuntimeCache()
 * and the rest of the logic stay in tickets.js (now reading ticketsState.X).
 */

export const ticketsState = {
  // --- User profile ---
  currentUserProfile: null,

  // --- Service catalog (location-filtered view) ---
  salonServices: [],
  serviceCategories: [],

  // --- Retail products (salon-wide, per-location + per-staff overrides) ---
  salonProducts: [],
  productCategories: [],
  _productsUnsub: null,
  _productCatsUnsub: null,
  _productsSubSalonId: null,

  // --- Tickets list + pagination ---
  currentTickets: [],
  _ticketsFirstPageTickets: [],
  _ticketsExtraTickets: [],
  _ticketsNextPageCursor: null,
  _ticketsHasMoreOlder: false,
  _ticketsLoadingMore: false,
  ticketsUnsubscribe: null,
  _ticketsDataReady: false, // cache flag — skip Firestore re-fetch on repeat visits
  currentTicketsTab: 'ready',
  // Ticket IDs opened this session (so badge count drops immediately).
  _ticketsOpenedThisSession: new Set(),
  // After subscribeTickets, hide list until first Firestore snapshot.
  _ticketsListSnapshotReady: false,

  // --- Editing / picker ---
  editingTicketId: null,
  // When true, the ticket picker shows the FULL catalog (manager/front-desk edit).
  _ticketPickerShowAllCatalog: false,
  // When set, opening this ticket must not show Ticket Details — we just closed it.
  _justClosedTicketId: null,

  // --- Member avatars (ticket list) ---
  _ticketsMembersAvatarCache: null,
  _ticketsMembersAvatarByName: null,

  // --- Raw catalog (shared + location + overrides) ---
  _ffCatalogLegacyWiped: false,
  _rawServices: [],
  _rawCategories: [],
  _rawSharedServices: [],
  _rawSharedCategories: [],
  _rawServiceOverrides: {},
  _catalogSource: 'unknown', // 'shared' | 'location' | 'unknown'
  _ffCatalogModalMode: 'location', // 'location' | 'shared'
  _servicesUnsub: null,
  _serviceCatsUnsub: null,
  _catalogSubSalonId: null,

  // --- Front desk / summary / date filters ---
  _frontDeskCache: null,
  _ticketsSummaryFetchSeq: 0,
  _ticketsDateFiltersWired: false,

  // --- Bulk selection (Closed / Archived tabs) ---
  ticketsSelectionMode: false,
  ticketsSelectionTab: null, // tab selection started on ('closed' | 'archived')
  ticketsSelected: new Set(),
  ticketsClosedShownIds: [],

  // --- Catalog Modal V2 UI ---
  _ffOpenCats: new Set(),
  _ffCatalogRenderedOnce: false,
  _ffCatalogRenderRootId: 'servicesModal',
  _ffSelectedServiceId: null,
  _ffSelectedCategoryId: null,
  _ffServicesInlineEditServiceId: null,
  _ffServicesDetailTab: 'details',
  _ffServicesLocationOverridesByService: {},
  _ffServicesLocationOverridesLoading: {},
  _ffServicesSharedBackfillChecked: false,
  _ffDragSrc: null,
  _ffDragHoverEl: null,
};

/** Real-time first page (newest). Older pages appended via Load more. */
export const TICKETS_PAGE_SIZE = 200;
/** Page size for Summary: paginated fetch of CLOSED tickets. */
export const _ticketSummaryPageSize = 500;
