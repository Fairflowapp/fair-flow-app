// inventory-state.js
// Shared mutable state for the Inventory mini-app (Catalog / Table / Orders / Insights).
// Extracted verbatim from inventory.js module-level `let` declarations (initial values unchanged).
// Single shared object because the core (_groups/_rows/category tree/_selectedSubcategoryId/
// _invMainTab) is referenced across all sub-apps and cannot be cleanly partitioned.
// Access pattern mirrors products' `pstate`: invState._x.

export const invState = {
  // ───────────────────────── global / shared spine ─────────────────────────
  /** Main workspace tab inside Inventory screen: inventory / orders / insights. */
  _invMainTab: "inventory",
  /** Table groups for the selected subcategory (`label` in UI maps to `name` in Firestore). */
  _groups: null,
  /** Table rows for the selected subcategory. */
  _rows: null,
  /** @type {string | null} Selected subcategory id. */
  _selectedSubcategoryId: null,
  /** @type {Set<string>} Expanded category ids in the sidebar. */
  _expandedCategoryIds: new Set(),
  /** Categories tree from Firestore (sidebar + modal draft base). */
  _categoryTree: [],
  /** Last tree successfully loaded or saved (for Firestore diff on Save). */
  _persistedCategoryTree: [],
  /** True when the screen is reading account-level shared inventory catalog. */
  _invUsingSharedCatalog: false,
  _invCategoriesLoading: false,
  _invCatLoadError: null,
  /** Products mirrored in Inventory (from salons/.../products). */
  _invProductsList: [],
  /** catId -> [{ id, name }] of valid product subcategories. */
  _invProductCatSubs: new Map(),
  /** Firestore table sync for `salons/.../inventorySubcategories/{subId}`. */
  _invTableLoading: false,
  /** `${categoryId}:${subId}` when _groups/_rows match that sub; null if none loaded. */
  _invTableLoadedForSubId: null,
  _invTableLoadSeq: 0,

  // ───────────────────────────── catalog ───────────────────────────────────
  _catSaveBusy: false,
  /** Deep clone of category tree while Manage Categories modal is open. */
  _catManageDraftTree: null,
  /** @type {{ kind: 'cat' | 'sub', catId: string, subId?: string } | null} */
  _catDndPayload: null,
  _manageCategoriesOpen: false,
  _renameCatId: null,
  /** `${catId}:${subId}` when renaming a subcategory */
  _renameSubKey: null,
  /** Open ⋯ menu: `cat:${id}` or `sub:${catId}:${subId}` */
  _catMenuKey: null,
  /** Delete confirm modal: { kind, catId, subId?, name } */
  _catDeleteModal: null,
  _inlineNewCat: false,
  _inlineNewSubCatId: null,
  /** When set, that group id shows remove confirmation (not one-click delete). */
  _groupRemoveConfirmId: null,
  /** Second step: centered modal before actual delete (local only). */
  _groupRemoveModalGroupId: null,
  /** Mobile: full categories panel open (false = compact strip after picking a subcategory). */
  _invMobileCatsPanelOpen: true,

  // ────────────────────────────── table ────────────────────────────────────
  /** When set, one table cell is in edit mode: `${inv}:${rowId}` or `${inv}:${rowId}:${groupId}` */
  _editCellKey: null,
  /** Local UI-only column widths (px). */
  _invColWidths: null,
  /** Narrow screens only: hide optional columns to free horizontal space. */
  _invMobileColHide: {
    dnd: false,
    num: false,
    code: false,
    supplier: false,
    url: false,
    nameExpanded: false,
  },
  /** @type {ReturnType<typeof setTimeout> | null} */
  _invNameHeaderTapTimer: null,
  /** Row context menu (right-click or ⋯): local UI only */
  _invRowMenu: null,
  /** Delete row confirmation modal */
  _invRowDeleteModalRowId: null,
  _invTableSaveTimer: null,
  /** Row drag-reorder: row id being dragged (HTML5 DnD). */
  _invRowDndDragId: null,
  /** @type {ReturnType<typeof setTimeout> | null} One-step undo timer for row/group delete. */
  _invUndoTimer: null,
  /** Undo payload for the last row/group delete. */
  _invUndoPayload: null,
  /** Saving draft inventory order to Firestore (UI feedback only). */
  _invSaveOrderDraftBusy: false,
  _invMobColLastTouch: { t: 0, key: "", x: 0, y: 0 },

  // ──────────────────────── orders: list / detail ──────────────────────────
  /** Create Order: category checkbox panel — hidden until +START NEW ORDER LIST. */
  _invObPickPanelOpen: false,
  /** Saved inventory orders list (Orders tab). */
  _invOrdersList: [],
  _invOrdersLoading: false,
  /** @type {string | null} */
  _invOrdersLoadError: null,
  /** @type {string | null} */
  _invOrdersDetailOrderId: null,
  /** Open ⋯ menu for an order row: { orderId, left, top } */
  _invOrdersMenu: null,
  /** @type {string | null} */
  _invOrdersDeleteConfirmOrderId: null,
  /** @type {string | null} */
  _invOrdersMarkOrderedConfirmOrderId: null,
  /** @type {{ orderId: string, draftName: string, busy: boolean } | null} */
  _invOrdersRenameModal: null,
  /** @type {"all" | "open" | "in_progress" | "done"} */
  _invOrdersStatusFilter: "all",
  _invOrdersSearchQuery: "",
  /** @type {Record<string, { checked: boolean[], qty: string[] }>} */
  _invDetailReceiveDraft: {},
  /** @type {Record<string, { checked: boolean[], qtyBought: string[] }>} */
  _invOrderShoppingDraft: {},
  _invOrderReceiveBusy: false,
  /** Order Details: Confirm Purchase (draft shopping → inventory) in flight. */
  _invOrderPurchaseBusy: false,
  /** In flight: order detail line → inventory unit price update. */
  _invOrderInvPriceBusy: false,
  /** @type {"all" | "open" | "received"} */
  _invOrderDetailFilter: "all",
  /** Order Builder: name for next Save as Order (local only until saved). */
  _invOrderSaveNameDraft: "",
  /** Order Details: read-only line detail modal (index into order.items). */
  _invOrderDetailLineViewIdx: null,
  /** @type {{ rowId: string, groupId: string, busy: boolean } | null} Order cell breakdown modal. */
  _invOrderCellBreakdownModal: null,

  // ─────────────────────────── orders: receipts ────────────────────────────
  /** Order detail: receipts subcollection live listener */
  _invOrderReceiptsUnsub: null,
  /** @type {string | null} */
  _invOrderReceiptsBoundOrderId: null,
  _invOrderReceiptsList: [],
  _invOrderReceiptsLoading: false,
  _invOrderReceiptUploadBusy: false,
  /** @type {Record<string, { note: string, supplierName: string, amount: string }>} */
  _invOrderReceiptUploadFieldsByOrderId: {},
  /** @type {string | null} */
  _invReceiptInfoModalOrderId: null,

  // ─────────────────────────── orders: builder ─────────────────────────────
  /** @deprecated kept only to avoid breakage in older cached references; always "custom" now. */
  _invOrderBuilderSourceMode: "custom",
  /** @type {Set<string>} Order Builder tree: which category blocks are expanded. */
  _invOrderBuilderExpandedCatIds: new Set(),
  /** @type {Set<string>} */
  _invOrderBuilderCustomSubIds: new Set(),
  /** @type {Array<Record<string, unknown>>} */
  _invOrderBuilderPreviewLines: [],
  _invOrderBuilderPreviewLoading: false,
  _invOrderBuilderPreviewSeq: 0,
  /** @type {Array<Record<string, unknown>>} Locally-added manual items. */
  _invOrderBuilderManualLines: [],
  /** @type {Record<string, number>} User overrides for auto-fill line quantities. */
  _invOrderBuilderAutoQtyOverrides: {},
  /** Order Builder: Add Item modal state. */
  _invOrderBuilderAddModal: null,

  // ─────────────────────────── orders: drafts ──────────────────────────────
  /** @type {string | null} Doc id of the currently-active Create Order draft. */
  _invActiveDraftId: null,
  _invOrderDraftLoaded: false,
  _invOrderDraftLoading: false,
  /** Debounce timer for persisting draft changes. */
  _invOrderDraftSaveTimer: null,
  /** In-flight guard (for Save as Order to flush before create). */
  _invOrderDraftSaveInFlight: false,
  /** @type {"idle" | "saving" | "saved"} */
  _invOrderDraftSaveStatus: "idle",
  /** When the last successful draft save happened (ms). */
  _invOrderDraftLastSavedAt: 0,
  /** One-shot "Resumed unfinished draft" toast. */
  _invOrderDraftResumeToastShown: false,
  /** Drafts picker modal state. */
  _invDraftsPicker: { open: false, loading: false, error: null, drafts: [] },

  // ───────────────────────────── insights ──────────────────────────────────
  /** @type {"30d" | "60d" | "120d" | "year" | "all" | "custom"} */
  _invInsightsRange: "30d",
  /** @type {"overview" | "purchases" | "forecast" | "health"} */
  _invInsightsSubTab: "overview",
  _invInsightsCustomFrom: "",
  _invInsightsCustomTo: "",
  _invInsightsLoading: false,
  /** @type {Array<{ key: string, name: string, totalQty: number }>} */
  _invInsightsRows: [],
  _invInsightsLoadSeq: 0,
  _invInsightsError: null,
  /** KPI summary for the selected range. */
  _invInsightsKpis: { totalSpend: 0, doneOrders: 0, totalOrders: 0, uniqueItems: 0, prevSpend: 0, spendPctChange: null },
  /** Per-cell usage + days-left forecast, sorted ascending by daysLeft. */
  _invInsightsUsage: [],
  /** Smart reorder suggestions — subset of usage with daysLeft ≤ threshold. */
  _invInsightsReorder: [],
  /** Spend grouped by categoryName for the selected range. */
  _invInsightsCategorySpend: [],
  /** Running-low cells: current ≤ threshold × stock (requires stock > 0). */
  _invInsightsRunningLow: [],
  /** Dead stock cells: current > 0 but no purchase activity in range. */
  _invInsightsDeadStock: [],

  // ─────────────────────────── scan-once flags ─────────────────────────────
  /** One-shot guard so the suggestion scan runs only once per app session. */
  _invSuggestionsScannedThisSession: false,
  /** One-shot guard so the product reorder-point scan runs only once per session. */
  _invReorderScannedThisSession: false,
};
