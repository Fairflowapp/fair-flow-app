// inventory-nav.js
// Navigation entry point and lifecycle listeners (currency/location changes).
// Extracted verbatim from inventory.js (Phase 15).

import { invState } from "./inventory-state.js?v=20260627_inventory_split";
import { mountOrRefreshMockUi } from "./inventory-shell.js?v=20260701_inventory_shell_split";
import { loadInventoryCategoriesFromFirestore } from "./inventory-catalog.js?v=20260627_inventory_catalog";
import { loadInventoryTableForSub } from "./inventory-table.js?v=20260702_inventory_orders_detail_split";
import {
  loadInventoryOrdersList,
  loadInventoryOrderDraft,
} from "./inventory-orders.js?v=20260702_inventory_orders_detail_split";
import {
  refreshInventoryInsightsAsync,
  scanInventorySuggestionsOnce,
  scanProductReorderAlertsOnce,
} from "./inventory-insights.js?v=20260627_inventory_insights";

/**
 * External hook: force-reload a subcategory's inventory data so live changes (e.g. approved supply
 * requests contributing to Order) appear without a manual page refresh. Safe to call with any
 * (catId, subId); no-op if that sub isn't currently selected.
 */
function ffInventoryReloadSub(catId, subId) {
  const cat = String(catId ?? "").trim();
  const sub = String(subId ?? "").trim();
  if (!cat || !sub) return;
  const key = `${cat}:${sub}`;
  if (invState._invTableLoadedForSubId === key) {
    // If this sub is currently loaded, refetch from Firestore and rerender.
    const seq = ++invState._invTableLoadSeq;
    invState._invTableLoading = true;
    mountOrRefreshMockUi();
    void loadInventoryTableForSub(cat, sub, seq, key);
    return;
  }
  // Otherwise invalidate cache so next navigation refetches.
  if (!invState._invTableLoading) invState._invTableLoadedForSubId = null;
}
if (typeof window !== "undefined") {
  window.ffInventoryReloadSub = ffInventoryReloadSub;
  // Re-render the Inventory screen when the salon currency changes so price cells + Insights reflect it.
  window.addEventListener("ff-currency-changed", () => {
    try {
      const root = document.getElementById("inventoryScreen");
      if (root) mountOrRefreshMockUi();
    } catch (_) {
      /* ignore */
    }
  });
  // Re-load the entire inventory module when the active branch changes.
  // Each location owns its own categories/subcategories/orders/drafts, so we
  // wipe the in-memory caches and re-fetch from Firestore against the new
  // `locationId` filter. The listener is lightweight — it only does real work
  // when the Inventory screen is currently mounted.
  const _ffInvHandleLocationChanged = () => {
    try {
      invState._categoryTree = [];
      invState._persistedCategoryTree = [];
      invState._invOrdersList = [];
      invState._invOrdersLoadError = null;
      invState._invOrderDraftLoaded = false;
      invState._invActiveDraftId = null;
      invState._invOrderBuilderManualLines = [];
      invState._invOrderBuilderCustomSubIds = new Set();
      invState._invOrderBuilderAutoQtyOverrides = {};
      invState._invOrderSaveNameDraft = "";
      invState._invOrderDraftLastSavedAt = 0;
      invState._invOrderDraftSaveStatus = "idle";
      invState._invOrderDraftResumeToastShown = false;
      invState._invSuggestionsScannedThisSession = false;
      invState._invReorderScannedThisSession = false;
      invState._invObPickPanelOpen = false;
      invState._invTableLoadedForSubId = null;
      invState._selectedSubcategoryId = null;
      // Always re-load categories from Firestore with the new location filter,
      // even if the Inventory screen is not the active view right now. Skipping
      // the load when `isMounted` was false created a race where the tree
      // stayed empty after a location switch and Manage Categories showed
      // "No categories yet" even though the sidebar had stale HTML.
      invState._invCategoriesLoading = true;
      mountOrRefreshMockUi();
      loadInventoryCategoriesFromFirestore()
        .catch((e) => {
          console.warn("[Inventory] category reload on location change failed", e);
          invState._invCatLoadError = (e && e.message) || "Failed to load categories";
        })
        .finally(() => {
          invState._invCategoriesLoading = false;
          mountOrRefreshMockUi();
          if (invState._invMainTab === "orders") {
            void loadInventoryOrdersList({ silent: true });
          } else if (invState._invMainTab === "orderBuilder") {
            void loadInventoryOrderDraft(true);
          } else if (invState._invMainTab === "insights") {
            void refreshInventoryInsightsAsync();
          }
          void scanInventorySuggestionsOnce();
          void scanProductReorderAlertsOnce();
        });
    } catch (e) {
      console.warn("[Inventory] location change handler failed", e);
    }
  };
  document.addEventListener("ff-active-location-changed", _ffInvHandleLocationChanged);
  window.addEventListener("ff-active-location-changed", _ffInvHandleLocationChanged);
}

function hideFullscreenPeersForInventory() {
  const ids = [
    "tasksScreen",
    "inboxScreen",
    "chatScreen",
    "mediaScreen",
    "ticketsScreen",
    "servicesScreen",
    "productsScreen",
    "trainingScreen",
    "scheduleScreen",
    "timeClockScreen",
    "pointsAppScreen",
    "userProfileScreen",
    "myProfileScreen",
    "manageQueueScreen",
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  const ownerView = document.getElementById("owner-view");
  const joinBar = document.getElementById("joinBar");
  const wrap = document.querySelector(".wrap");
  const queueControls = document.getElementById("queueControls");
  if (ownerView) ownerView.style.display = "none";
  if (joinBar) joinBar.style.display = "none";
  if (wrap) wrap.style.display = "none";
  if (queueControls) queueControls.style.display = "none";
}

export async function goToInventory() {
  if (typeof window.ffCloseGlobalBlockingOverlays === "function") {
    try {
      window.ffCloseGlobalBlockingOverlays();
    } catch (e) {}
  }
  if (typeof window.closeStaffMembersModal === "function") {
    window.closeStaffMembersModal();
  }

  hideFullscreenPeersForInventory();

  const screen = document.getElementById("inventoryScreen");
  if (!screen) return;

  // Invalidate active-draft cache so the next Create Order entry reads fresh from Firestore.
  invState._invOrderDraftLoaded = false;

  invState._invCategoriesLoading = true;
  mountOrRefreshMockUi();

  screen.style.display = "flex";
  screen.style.flexDirection = "column";
  // Other screens (e.g. Products) set pointer-events:none on inventoryScreen
  // when they hide peers; restore it so the inventory UI stays clickable.
  screen.style.pointerEvents = "auto";

  document.querySelectorAll(".btn-pill").forEach((b) => b.classList.remove("active"));
  const invBtn = document.getElementById("inventoryNavBtn");
  if (invBtn) invBtn.classList.add("active");

  // Smart Inventory Suggestions — run once per session, fire-and-forget.
  // Silently creates Inbox alerts for items forecast to run out within 3 days.
  void scanInventorySuggestionsOnce();
  // Product reorder-point alerts — once per session, fire-and-forget.
  void scanProductReorderAlertsOnce();

  void (async () => {
    try {
      await loadInventoryCategoriesFromFirestore();
    } catch (e) {
      console.error("[Inventory] category load failed", e);
      invState._invCatLoadError = (e && e.message) || "Failed to load categories";
      invState._categoryTree = [];
      invState._persistedCategoryTree = [];
    } finally {
      invState._invCategoriesLoading = false;
      // Drop the cached table so it rebuilds from freshly-loaded data. This is
      // essential for product-backed subcategories: stock edited in the
      // Products app must be re-read here instead of showing stale rows.
      // Also clear the in-flight load flag (and bump the load sequence) so the
      // post-load mount can start a clean reload instead of being blocked by a
      // stale load that ran before the catalog refresh.
      invState._invTableLoadedForSubId = null;
      invState._invTableLoading = false;
      invState._invTableLoadSeq++;
      mountOrRefreshMockUi();
    }

    // If the user lands directly on the Create Order tab, load its draft after first paint.
    if (invState._invMainTab === "orderBuilder") {
      void loadInventoryOrderDraft();
    }
  })();

  try {
    const bd = document.getElementById("appsOverlayBackdrop");
    const pn = document.getElementById("appsPanel");
    if (bd) bd.style.display = "none";
    if (pn) pn.style.display = "none";
  } catch (e) {}

  if (typeof window.ffUpdateMainNavTabVisibility === "function") {
    try {
      window.ffUpdateMainNavTabVisibility();
    } catch (e) {}
  }
  if (typeof window.ffApplyQueueViewGate === "function") {
    try {
      window.ffApplyQueueViewGate();
    } catch (e) {}
  }
}

if (typeof window !== "undefined") {
window.goToInventory = goToInventory;
}
