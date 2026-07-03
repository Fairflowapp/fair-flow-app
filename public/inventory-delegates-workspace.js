// inventory-delegates-workspace.js
// Workspace delegates: table/edit, order builder, drafts picker, nav tabs, and shared
// listeners (contextmenu, mousedown, focusout, keydown). Extracted verbatim from
// ensureInventoryScreenDelegates in inventory.js (Phase 14).

import { invState } from "./inventory-state.js?v=20260627_inventory_split";
import { parseNum, invCellKey } from "./inventory-helpers.js?v=20260627_inventory_split";
import { ffCanManageInventory } from "./inventory-spine.js?v=20260701_inventory_spine_split";
import {
  handleInventoryCatalogDelegateClick,
  handleInventoryCatalogDelegateKeydownActivate,
  handleInventoryCatalogDelegateKeydownEscape,
} from "./inventory-delegates-catalog.js?v=20260702_inventory_catalog_split";
import {
  handleInventoryOrdersDelegateClick,
  handleInventoryOrdersDelegateFocusout,
  handleInventoryOrdersDelegateKeydown,
  handleInventoryOrdersDelegateKeydownEscape,
} from "./inventory-delegates-orders.js?v=20260702_inventory_catalog_split";
import {
  bindInvColumnResizeOnce,
  bindInvRowDnDOnce,
  handleInventoryInput,
  findInvEditInput,
  getInvCellKeyFromEl,
  duplicateInventoryRow,
  deleteInventoryRow,
  addInventoryRow,
  addInventoryGroup,
  removeInventoryGroup,
  importSharedItemsIntoCurrentInventorySub,
  invMobileAnyOptionalColumnHidden,
  resetInvMobileOptionalColumns,
  ensureInvMobileColHeaderBindOnce,
} from "./inventory-table.js?v=20260702_inventory_catalog_split";
import {
  handleOrderBuilderSourceChange,
  commitInventoryOrderBuilderAddItem,
  saveInventoryOrderDraft,
  createNewInventoryOrderDraft,
  scheduleInventoryOrderDraftSave,
  openInventoryDraftsPicker,
  closeInventoryDraftsPicker,
  switchActiveInventoryDraft,
  deleteInventoryDraftFromPicker,
  loadLinkPickerItemsForSub,
  loadInventoryOrderDraft,
  loadInventoryOrdersList,
  refreshOrderBuilderPreviewAsync,
} from "./inventory-orders.js?v=20260702_inventory_catalog_split";
import { refreshInventoryInsightsAsync } from "./inventory-insights.js?v=20260702_inventory_catalog_split";

let mountOrRefreshMockUi;

export function initInventoryDelegatesWorkspace(deps) {
  ({ mountOrRefreshMockUi } = deps);
}

/** @returns {boolean} */
function handleInventoryWorkspaceDelegateClickNav(ev, root, t) {
    // View-only access: block every add/edit/remove interaction. Navigation,
    // tab switching, and order viewing remain available.
    if (!ffCanManageInventory()) {
      if (
        t.closest("[data-inv-cell]") ||
        t.closest("[data-inv-url-edit]") ||
        t.closest("[data-inv-row-menu-trigger]") ||
        t.closest("[data-inv-row-action]") ||
        t.closest("[data-inv-row-dnd]") ||
        t.closest("[data-inv-row-delete-commit]") ||
        t.closest("#ff-inv2-add-row") ||
        t.closest("#ff-inv2-add-group") ||
        t.closest("#ff-inv2-add-from-shared") ||
        t.closest("[data-inv-import-shared-catalog]") ||
        t.closest("[data-cat-manage-open]")
      ) {
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof window !== "undefined" && typeof window.showToast === "function") {
          window.showToast("You have view-only access to Inventory.", "info");
        }
        return true;
      }
    }

    const mobileCatStrip = t.closest("[data-inv-mobile-cat-strip]");
    if (mobileCatStrip && root.contains(mobileCatStrip)) {
      ev.preventDefault();
      invState._invMobileCatsPanelOpen = true;
      mountOrRefreshMockUi();
      return true;
    }
    const mobileAsideCollapse = t.closest("[data-inv-mobile-aside-collapse]");
    if (mobileAsideCollapse && root.contains(mobileAsideCollapse)) {
      ev.preventDefault();
      invState._invMobileCatsPanelOpen = false;
      mountOrRefreshMockUi();
      return true;
    }

    const invMainTabBtn = t.closest("[data-inv-main-tab]");
    if (invMainTabBtn && root.contains(invMainTabBtn)) {
      ev.preventDefault();
      const tab = invMainTabBtn.getAttribute("data-inv-main-tab");
      if (tab === "inventory" || tab === "orderBuilder" || tab === "orders" || tab === "insights") {
        if (invState._invMainTab !== tab) {
          if (tab === "orderBuilder") {
            invState._invObPickPanelOpen = false;
          }
          invState._invMainTab = tab;
          if (tab !== "orders") {
            invState._invOrdersDetailOrderId = null;
            invState._invReceiptInfoModalOrderId = null;
            invState._invOrderDetailLineViewIdx = null;
            invState._invOrdersMenu = null;
            invState._invOrdersDeleteConfirmOrderId = null;
            invState._invOrdersMarkOrderedConfirmOrderId = null;
            invState._invOrdersRenameModal = null;
          }
          if (tab === "orderBuilder") {
            invState._invOrderBuilderPreviewLoading = true;
          }
          mountOrRefreshMockUi();
          if (tab === "orderBuilder") {
            void loadInventoryOrderDraft();
            void refreshOrderBuilderPreviewAsync();
          }
          if (tab === "orders") {
            void loadInventoryOrdersList();
          }
          if (tab === "insights") {
            void refreshInventoryInsightsAsync();
          }
        }
      }
      return true;
    }

    const insightsSubTabBtn = t.closest("[data-inv-insights-subtab]");
    if (insightsSubTabBtn && root.contains(insightsSubTabBtn)) {
      ev.preventDefault();
      const sub = insightsSubTabBtn.getAttribute("data-inv-insights-subtab");
      const allowedSub = ["overview", "purchases", "forecast", "health"];
      if (sub && allowedSub.includes(sub) && invState._invInsightsSubTab !== sub) {
        invState._invInsightsSubTab = sub;
        mountOrRefreshMockUi();
      }
      return true;
    }
  return false;
}

/** @returns {boolean} */
function handleInventoryWorkspaceDelegateClick(ev, root, t) {
    const urlEditBtn = t.closest("[data-inv-url-edit]");
    if (urlEditBtn && root.contains(urlEditBtn)) {
      ev.preventDefault();
      ev.stopPropagation();
      const rid = urlEditBtn.getAttribute("data-row-id");
      if (rid) {
        const key = invCellKey("url", rid);
        if (invState._editCellKey === key) {
          queueMicrotask(() => {
            const inp = findInvEditInput(root, key);
            if (inp instanceof HTMLInputElement) {
              inp.focus();
              inp.select();
            }
          });
          return true;
        }
        invState._editCellKey = key;
        mountOrRefreshMockUi();
        queueMicrotask(() => {
          const inp = findInvEditInput(root, key);
          if (inp instanceof HTMLInputElement) {
            inp.focus();
            inp.select();
          }
        });
      }
      return true;
    }

    const rowMenuKebab = t.closest("[data-inv-row-menu-trigger]");
    if (rowMenuKebab && root.contains(rowMenuKebab)) {
      ev.preventDefault();
      ev.stopPropagation();
      const rid = rowMenuKebab.getAttribute("data-inv-row-menu-trigger");
      if (rid) {
        const rect = rowMenuKebab.getBoundingClientRect();
        const menuW = 180;
        const menuH = 120;
        let left = rect.right + 4;
        let top = rect.top;
        left = Math.min(left, window.innerWidth - menuW - 8);
        top = Math.min(top, window.innerHeight - menuH - 8);
        left = Math.max(8, left);
        top = Math.max(8, top);
        invState._invRowMenu = { rowId: rid, left, top };
        mountOrRefreshMockUi();
      }
      return true;
    }
    const rowMenuAction = t.closest("[data-inv-row-action]");
    if (rowMenuAction && root.contains(rowMenuAction)) {
      ev.preventDefault();
      ev.stopPropagation();
      const rid = rowMenuAction.getAttribute("data-row-id");
      const act = rowMenuAction.getAttribute("data-inv-row-action");
      if (!rid) return;
      if (act === "edit") {
        invState._invRowMenu = null;
        invState._editCellKey = invCellKey("code", rid);
        mountOrRefreshMockUi();
        queueMicrotask(() => {
          const invRoot = document.getElementById("inventoryScreen");
          if (!invRoot) return;
          const inp = findInvEditInput(invRoot, invCellKey("code", rid));
          if (inp instanceof HTMLInputElement) {
            inp.focus();
            inp.select();
          }
        });
        return true;
      }
      if (act === "duplicate") {
        invState._invRowMenu = null;
        duplicateInventoryRow(rid);
        mountOrRefreshMockUi();
        return true;
      }
      if (act === "delete") {
        invState._invRowMenu = null;
        invState._invRowDeleteModalRowId = rid;
        mountOrRefreshMockUi();
        return true;
      }
      return true;
    }
    if (t.closest("[data-inv-row-menu-dismiss]")) {
      ev.preventDefault();
      invState._invRowMenu = null;
      mountOrRefreshMockUi();
      return true;
    }
    const rowDelCommit = t.closest("[data-inv-row-delete-commit]");
    if (rowDelCommit && root.contains(rowDelCommit)) {
      ev.preventDefault();
      const rid = rowDelCommit.getAttribute("data-row-id");
      if (rid && invState._invRowDeleteModalRowId === rid) {
        deleteInventoryRow(rid);
        invState._invRowDeleteModalRowId = null;
        invState._editCellKey = null;
        mountOrRefreshMockUi();
      }
      return true;
    }
    if (t.closest("[data-inv-row-delete-cancel]") || t.id === "ff-inv2-row-delete-modal") {
      ev.preventDefault();
      invState._invRowDeleteModalRowId = null;
      mountOrRefreshMockUi();
      return true;
    }

    const cellView = t.closest("[data-inv-cell]");
    if (cellView && root.contains(cellView)) {
      const key = getInvCellKeyFromEl(cellView);
      if (key && key !== invState._editCellKey) {
        invState._editCellKey = key;
        mountOrRefreshMockUi();
        queueMicrotask(() => {
          const inp = findInvEditInput(root, key);
          if (inp instanceof HTMLInputElement) {
            inp.focus();
            inp.select();
          }
        });
      }
      return true;
    }

    if (handleInventoryCatalogDelegateClick(ev, root, t)) return;

    const start = t.closest("[data-inv-remove-start]");
    if (start) {
      ev.preventDefault();
      const gid = start.getAttribute("data-inv-remove-start");
      if (gid) {
        invState._groupRemoveConfirmId = gid;
        mountOrRefreshMockUi();
      }
      return true;
    }
    if (t.closest("[data-inv-remove-cancel]")) {
      ev.preventDefault();
      invState._groupRemoveConfirmId = null;
      mountOrRefreshMockUi();
      return true;
    }
    const openRmModal = t.closest("[data-inv-remove-modal]");
    if (openRmModal) {
      ev.preventDefault();
      const gid = openRmModal.getAttribute("data-inv-remove-modal");
      if (gid) {
        invState._groupRemoveModalGroupId = gid;
        mountOrRefreshMockUi();
      }
      return true;
    }
    if (t.closest("[data-inv-modal-cancel]")) {
      ev.preventDefault();
      invState._groupRemoveModalGroupId = null;
      mountOrRefreshMockUi();
      return true;
    }
    if (t.id === "ff-inv2-group-remove-modal") {
      ev.preventDefault();
      invState._groupRemoveModalGroupId = null;
      mountOrRefreshMockUi();
      return true;
    }
    const modalCommit = t.closest("[data-inv-modal-commit]");
    if (modalCommit) {
      ev.preventDefault();
      const gid = modalCommit.getAttribute("data-inv-modal-commit");
      if (gid) {
        removeInventoryGroup(gid);
        invState._groupRemoveModalGroupId = null;
        invState._groupRemoveConfirmId = null;
        mountOrRefreshMockUi();
      }
      return true;
    }
    if (t.id === "ff-inv2-save-order-draft") {
      ev.preventDefault();
      void saveInventoryOrderDraft();
      return true;
    }
    const obCatToggle = t.closest("[data-inv-ob-cat-toggle]");
    if (obCatToggle && root.contains(obCatToggle)) {
      ev.preventDefault();
      const cid = obCatToggle.getAttribute("data-inv-ob-cat-toggle");
      if (cid) {
        if (invState._invOrderBuilderExpandedCatIds.has(cid)) invState._invOrderBuilderExpandedCatIds.delete(cid);
        else invState._invOrderBuilderExpandedCatIds.add(cid);
        mountOrRefreshMockUi();
      }
      return true;
    }
    const obAddItemBtn = t.closest("[data-inv-ob-add-item]");
    if (obAddItemBtn && root.contains(obAddItemBtn)) {
      ev.preventDefault();
      if (obAddItemBtn instanceof HTMLButtonElement && obAddItemBtn.disabled) return;
      invState._invOrderBuilderAddModal = {
        draftName: "",
        draftQty: "",
        linkedItemId: null,
        linkedItemMeta: null,
        picker: {
          step: "category",
          catId: null,
          subId: null,
          items: null,
          loading: false,
          error: null,
        },
      };
      mountOrRefreshMockUi();
      const rootEl = document.getElementById("inventoryScreen");
      const inp = rootEl && rootEl.querySelector('[data-inv-ob-add-input="name"]');
      if (inp instanceof HTMLInputElement) {
        inp.focus();
      }
      return true;
    }
    const obAddCommit = t.closest("[data-inv-ob-add-commit]");
    if (obAddCommit && root.contains(obAddCommit)) {
      ev.preventDefault();
      if (obAddCommit instanceof HTMLButtonElement && obAddCommit.disabled) return;
      commitInventoryOrderBuilderAddItem();
      return true;
    }
    if (
      t.closest("[data-inv-ob-add-cancel]") ||
      t.id === "ff-inv-ob-add-item-backdrop"
    ) {
      ev.preventDefault();
      invState._invOrderBuilderAddModal = null;
      mountOrRefreshMockUi();
      return true;
    }
    const obLinkStep = t.closest("[data-inv-ob-add-link-step]");
    if (obLinkStep && root.contains(obLinkStep) && invState._invOrderBuilderAddModal) {
      ev.preventDefault();
      ev.stopPropagation();
      const step = obLinkStep.getAttribute("data-inv-ob-add-link-step");
      if (step === "category") {
        invState._invOrderBuilderAddModal.picker.step = "category";
        invState._invOrderBuilderAddModal.picker.catId = null;
        invState._invOrderBuilderAddModal.picker.subId = null;
        invState._invOrderBuilderAddModal.picker.items = null;
        invState._invOrderBuilderAddModal.picker.loading = false;
        invState._invOrderBuilderAddModal.picker.error = null;
        mountOrRefreshMockUi();
      } else if (step === "subcategory") {
        const catId = obLinkStep.getAttribute("data-cat-id") || invState._invOrderBuilderAddModal.picker.catId;
        invState._invOrderBuilderAddModal.picker.step = "subcategory";
        invState._invOrderBuilderAddModal.picker.catId = catId;
        invState._invOrderBuilderAddModal.picker.subId = null;
        invState._invOrderBuilderAddModal.picker.items = null;
        invState._invOrderBuilderAddModal.picker.loading = false;
        invState._invOrderBuilderAddModal.picker.error = null;
        mountOrRefreshMockUi();
      } else if (step === "items") {
        const subId = obLinkStep.getAttribute("data-sub-id") || invState._invOrderBuilderAddModal.picker.subId;
        const catId = invState._invOrderBuilderAddModal.picker.catId;
        invState._invOrderBuilderAddModal.picker.step = "items";
        invState._invOrderBuilderAddModal.picker.subId = subId;
        mountOrRefreshMockUi();
        if (catId && subId) void loadLinkPickerItemsForSub(catId, subId);
      }
      return true;
    }
    const obLinkSelect = t.closest("[data-inv-ob-add-link-select]");
    if (obLinkSelect && root.contains(obLinkSelect) && invState._invOrderBuilderAddModal) {
      ev.preventDefault();
      ev.stopPropagation();
      const pickId = obLinkSelect.getAttribute("data-inv-ob-add-link-select");
      if (pickId) {
        const pool = Array.isArray(invState._invOrderBuilderAddModal.picker.items)
          ? invState._invOrderBuilderAddModal.picker.items
          : [];
        const picked = pool.find((x) => x.id === pickId);
        if (picked) {
          invState._invOrderBuilderAddModal.linkedItemId = picked.id;
          invState._invOrderBuilderAddModal.linkedItemMeta = picked;
          if (String(invState._invOrderBuilderAddModal.draftName ?? "").trim() === "") {
            invState._invOrderBuilderAddModal.draftName = picked.itemName;
          }
          if (!(parseNum(invState._invOrderBuilderAddModal.draftQty) > 0)) {
            invState._invOrderBuilderAddModal.draftQty = "1";
          }
          mountOrRefreshMockUi();
          const rootEl = document.getElementById("inventoryScreen");
          const qtyInp = rootEl && rootEl.querySelector('[data-inv-ob-add-input="qty"]');
          if (qtyInp instanceof HTMLInputElement) {
            qtyInp.focus();
            qtyInp.select();
          }
        }
      }
      return true;
    }
    if (t.closest("[data-inv-ob-add-link-clear]") && invState._invOrderBuilderAddModal) {
      ev.preventDefault();
      ev.stopPropagation();
      invState._invOrderBuilderAddModal.linkedItemId = null;
      invState._invOrderBuilderAddModal.linkedItemMeta = null;
      if (invState._invOrderBuilderAddModal.picker) {
        invState._invOrderBuilderAddModal.picker.step = "category";
        invState._invOrderBuilderAddModal.picker.catId = null;
        invState._invOrderBuilderAddModal.picker.subId = null;
        invState._invOrderBuilderAddModal.picker.items = null;
        invState._invOrderBuilderAddModal.picker.loading = false;
        invState._invOrderBuilderAddModal.picker.error = null;
      }
      mountOrRefreshMockUi();
      return true;
    }
    const obNewDraft = t.closest("[data-inv-ob-new-draft]");
    if (obNewDraft && root.contains(obNewDraft)) {
      ev.preventDefault();
      void createNewInventoryOrderDraft();
      return true;
    }
    if (t.closest("[data-inv-ob-mobile-collapse-source]") && root.contains(t.closest("[data-inv-ob-mobile-collapse-source]"))) {
      ev.preventDefault();
      invState._invObPickPanelOpen = false;
      mountOrRefreshMockUi();
      try {
        if (typeof requestAnimationFrame !== "undefined") {
          requestAnimationFrame(() => {
            const el = root.querySelector(".ff-inv2-order-list-head");
            if (el && typeof el.scrollIntoView === "function") {
              el.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          });
        }
      } catch (_) {
        /* ignore */
      }
      return true;
    }
    // Drafts picker: open
    const draftsPickerOpenBtn = t.closest("[data-inv-drafts-picker-open]");
    if (draftsPickerOpenBtn && root.contains(draftsPickerOpenBtn)) {
      ev.preventDefault();
      void openInventoryDraftsPicker();
      return true;
    }
    // Drafts picker: close (any close button or backdrop)
    if (t.hasAttribute("data-inv-drafts-picker-close") || t.hasAttribute("data-inv-drafts-picker-close-backdrop")) {
      ev.preventDefault();
      closeInventoryDraftsPicker();
      return true;
    }
    // Drafts picker: switch to another draft
    const draftsPickerSwitch = t.closest("[data-inv-drafts-picker-switch]");
    if (draftsPickerSwitch && root.contains(draftsPickerSwitch)) {
      ev.preventDefault();
      const did = draftsPickerSwitch.getAttribute("data-inv-drafts-picker-switch");
      if (did) void switchActiveInventoryDraft(did);
      return true;
    }
    // Drafts picker: delete a draft
    const draftsPickerDelete = t.closest("[data-inv-drafts-picker-delete]");
    if (draftsPickerDelete && root.contains(draftsPickerDelete)) {
      ev.preventDefault();
      const did = draftsPickerDelete.getAttribute("data-inv-drafts-picker-delete");
      if (did) void deleteInventoryDraftFromPicker(did);
      return true;
    }
    // Drafts picker: "+ New draft" button inside picker
    if (t.hasAttribute("data-inv-drafts-picker-new")) {
      ev.preventDefault();
      closeInventoryDraftsPicker();
      void createNewInventoryOrderDraft();
      return true;
    }
    const obManualRemove = t.closest("[data-inv-ob-manual-remove]");
    if (obManualRemove && root.contains(obManualRemove)) {
      ev.preventDefault();
      const lid = obManualRemove.getAttribute("data-inv-ob-manual-remove");
      if (lid) {
        invState._invOrderBuilderManualLines = invState._invOrderBuilderManualLines.filter((x) => x.id !== lid);
        scheduleInventoryOrderDraftSave();
        mountOrRefreshMockUi();
      }
      return true;
    }
    if (t.id === "ff-inv2-add-row") {
      ev.preventDefault();
      invState._editCellKey = null;
      addInventoryRow();
      mountOrRefreshMockUi();
    } else if (t.id === "ff-inv2-mobile-cols-reset") {
      ev.preventDefault();
      if (t instanceof HTMLElement) t.blur();
      const hadHidden = invMobileAnyOptionalColumnHidden();
      resetInvMobileOptionalColumns();
      if (typeof window !== "undefined" && window.ffToast && typeof window.ffToast.show === "function") {
        window.ffToast.show(hadHidden ? "All optional columns visible again." : "No columns were hidden.", {
          variant: "info",
          durationMs: 3200,
        });
      }
    } else if (t.id === "ff-inv2-add-from-shared") {
      ev.preventDefault();
      invState._editCellKey = null;
      void importSharedItemsIntoCurrentInventorySub();
    } else if (t.id === "ff-inv2-add-group") {
      ev.preventDefault();
      invState._editCellKey = null;
      addInventoryGroup();
      mountOrRefreshMockUi();
    }
  return false;
}
export function bindInventoryDelegatesWorkspaceOnce(root) {
  bindInvColumnResizeOnce();
  bindInvRowDnDOnce(root);
  root.addEventListener("input", handleInventoryInput);
  root.addEventListener("change", handleOrderBuilderSourceChange);
  root.addEventListener("contextmenu", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const tr = t.closest("tbody tr[data-inv-row-id]");
    if (!tr || !root.contains(tr)) return;
    const rowId = tr.getAttribute("data-inv-row-id");
    if (!rowId) return;
    ev.preventDefault();
    const menuW = 180;
    const menuH = 120;
    let left = ev.clientX;
    let top = ev.clientY;
    left = Math.min(left, window.innerWidth - menuW - 8);
    top = Math.min(top, window.innerHeight - menuH - 8);
    left = Math.max(8, left);
    top = Math.max(8, top);
    invState._invRowMenu = { rowId, left, top };
    mountOrRefreshMockUi();
  });
  root.addEventListener("mousedown", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const btn = t.closest("[data-inv-url-edit]");
    if (!btn || !root.contains(btn)) return;
    ev.preventDefault();
  });
  root.addEventListener("focusout", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (handleInventoryOrdersDelegateFocusout(ev, root, t)) return;
    if (t.getAttribute("data-inv") !== "url") return;
    if (!t.classList.contains("ff-inv2-cell-input--editing")) return;
    const key = t.getAttribute("data-edit-key");
    if (!key) return;
    const rel = ev.relatedTarget;
    if (rel instanceof HTMLElement) {
      const pen = rel.closest("[data-inv-url-edit]");
      if (pen && pen.getAttribute("data-row-id") === t.getAttribute("data-row-id")) return;
    }
    setTimeout(() => {
      if (invState._editCellKey !== key) return;
      if (document.activeElement === t) return;
      handleInventoryInput({ target: t });
      invState._editCellKey = null;
      mountOrRefreshMockUi();
    }, 0);
  });
  root.addEventListener("keydown", (ev) => {
    if (handleInventoryOrdersDelegateKeydown(ev)) return;
    if (
      ev.key === "Enter" &&
      ev.target instanceof HTMLInputElement &&
      ev.target.hasAttribute("data-inv-ob-add-input") &&
      invState._invOrderBuilderAddModal
    ) {
      ev.preventDefault();
      commitInventoryOrderBuilderAddItem();
      return;
    }
    if (ev.key === "Enter" && ev.target instanceof HTMLInputElement && ev.target.classList.contains("ff-inv2-cell-input--editing")) {
      ev.preventDefault();
      handleInventoryInput({ target: ev.target });
      invState._editCellKey = null;
      mountOrRefreshMockUi();
      return;
    }
    if (ev.key === "Enter" || ev.key === " ") {
      const t = ev.target;
      if (t instanceof HTMLElement) {
        if (handleInventoryCatalogDelegateKeydownActivate(ev, t)) return;
        if (t.hasAttribute("data-inv-cell")) {
          ev.preventDefault();
          t.click();
          return;
        }
      }
    }
    if (ev.key !== "Escape") return;
    if (handleInventoryCatalogDelegateKeydownEscape(ev)) return;
    if (invState._invRowMenu) {
      ev.preventDefault();
      invState._invRowMenu = null;
      mountOrRefreshMockUi();
      return;
    }
    if (invState._invRowDeleteModalRowId) {
      ev.preventDefault();
      invState._invRowDeleteModalRowId = null;
      mountOrRefreshMockUi();
      return;
    }
    if (invState._editCellKey) {
      ev.preventDefault();
      invState._editCellKey = null;
      mountOrRefreshMockUi();
      return;
    }
    if (handleInventoryOrdersDelegateKeydownEscape(ev)) return;
    if (invState._invOrderBuilderAddModal) {
      ev.preventDefault();
      invState._invOrderBuilderAddModal = null;
      mountOrRefreshMockUi();
      return;
    }
    if (!invState._groupRemoveModalGroupId) return;
    ev.preventDefault();
    invState._groupRemoveModalGroupId = null;
    mountOrRefreshMockUi();
  });
  root.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    if (handleInventoryWorkspaceDelegateClickNav(ev, root, t)) return;
    if (handleInventoryOrdersDelegateClick(ev, root, t)) return;
    if (handleInventoryWorkspaceDelegateClick(ev, root, t)) return;
  });
  ensureInvMobileColHeaderBindOnce();
}
