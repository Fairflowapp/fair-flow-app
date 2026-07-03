// inventory-delegates-catalog.js
// Catalog / Manage Categories click + keydown delegates extracted verbatim from
// ensureInventoryScreenDelegates in inventory.js (Phase 12).

import { invState } from "./inventory-state.js?v=20260627_inventory_split";
import {
  cloneCategoryTree,
  newCategoryId,
  newSubcategoryId,
} from "./inventory-helpers.js?v=20260627_inventory_split";
import {
  importSharedCatalogIntoCurrentBranch,
  loadInventoryCategoriesFromFirestore,
  persistInventoryCategoryTree,
  getLegacyCategoryTreeForManage,
  getManageCategoryTree,
  ensureCatManageDraft,
  ensureValidSubcategorySelection,
  resetCatModalTransientState,
  bindCatManageDnDOnce,
} from "./inventory-catalog.js?v=20260702_inventory_catalog_split";

let mountOrRefreshMockUi;

export function initInventoryDelegatesCatalog(deps) {
  ({ mountOrRefreshMockUi } = deps);
}

export function bindInventoryDelegatesCatalogOnce(root) {
  bindCatManageDnDOnce(root);
}

/** @returns {boolean} true when the event was handled */
export function handleInventoryCatalogDelegateClick(ev, root, t) {
    if (t.closest("[data-inv-import-shared-catalog]")) {
      ev.preventDefault();
      invState._editCellKey = null;
      void importSharedCatalogIntoCurrentBranch();
      return true;
    }

    if (t.closest("[data-cat-manage-open]")) {
      ev.preventDefault();
      resetCatModalTransientState();
      invState._manageCategoriesOpen = true;
      // Safety net: if the in-memory tree is empty (e.g. because a location
      // switch wiped it before the screen fully remounted), force a fresh
      // Firestore load before building the draft so the modal shows the real
      // categories instead of "No categories yet".
      const treeIsEmpty = !Array.isArray(invState._categoryTree) || invState._categoryTree.length === 0;
      if (treeIsEmpty && !invState._invCategoriesLoading) {
        invState._invCategoriesLoading = true;
        mountOrRefreshMockUi();
        loadInventoryCategoriesFromFirestore()
          .catch((e) => {
            console.warn("[Inventory] Manage Categories open: reload failed", e);
            invState._invCatLoadError = (e && e.message) || "Failed to load categories";
          })
          .finally(() => {
            invState._invCategoriesLoading = false;
            invState._catManageDraftTree = null;
            ensureCatManageDraft();
            mountOrRefreshMockUi();
          });
      } else {
        ensureCatManageDraft();
        mountOrRefreshMockUi();
      }
      return true;
    }
    if (t.closest("[data-cat-manage-close]")) {
      ev.preventDefault();
      invState._manageCategoriesOpen = false;
      invState._catManageDraftTree = null;
      resetCatModalTransientState();
      mountOrRefreshMockUi();
      return true;
    }
    if (t.closest("[data-cat-manage-save]")) {
      ev.preventDefault();
      if (invState._catSaveBusy) return;
      const draft = invState._catManageDraftTree
        ? cloneCategoryTree(invState._catManageDraftTree)
        : cloneCategoryTree(getLegacyCategoryTreeForManage());
      const runSave = async () => {
        invState._catSaveBusy = true;
        mountOrRefreshMockUi();
        try {
          await persistInventoryCategoryTree(draft);
          await loadInventoryCategoriesFromFirestore();
          invState._catManageDraftTree = null;
          invState._manageCategoriesOpen = false;
          resetCatModalTransientState();
          ensureValidSubcategorySelection();
        } catch (e) {
          console.error("[Inventory] save categories failed", e);
          alert("Failed to save categories: " + (e && e.message ? e.message : String(e)));
        } finally {
          invState._catSaveBusy = false;
          mountOrRefreshMockUi();
        }
      };
      void runSave();
      return true;
    }
    if (t.id === "ff-inv2-cat-manage-backdrop") {
      ev.preventDefault();
      invState._manageCategoriesOpen = false;
      invState._catManageDraftTree = null;
      resetCatModalTransientState();
      mountOrRefreshMockUi();
      return true;
    }
    if (t.closest("[data-cat-delete-modal-commit]")) {
      ev.preventDefault();
      if (invState._catDeleteModal) {
        const { kind, catId, subId } = invState._catDeleteModal;
        if (kind === "cat" && catId) {
          const tree = getManageCategoryTree();
          const i = tree.findIndex((c) => c.id === catId);
          if (i !== -1) tree.splice(i, 1);
          invState._expandedCategoryIds.delete(catId);
        } else if (kind === "sub" && catId && subId) {
          const cat = getManageCategoryTree().find((c) => c.id === catId);
          if (cat) cat.subcategories = cat.subcategories.filter((s) => s.id !== subId);
        }
        invState._catDeleteModal = null;
        ensureValidSubcategorySelection();
      }
      mountOrRefreshMockUi();
      return true;
    }
    if (t.closest("[data-cat-delete-modal-cancel]")) {
      ev.preventDefault();
      invState._catDeleteModal = null;
      mountOrRefreshMockUi();
      return true;
    }
    if (t.id === "ff-inv2-cat-delete-backdrop") {
      ev.preventDefault();
      invState._catDeleteModal = null;
      mountOrRefreshMockUi();
      return true;
    }
    const menuTrigger = t.closest("[data-cat-menu-trigger]");
    if (menuTrigger) {
      ev.preventDefault();
      const kind = menuTrigger.getAttribute("data-cat-menu-trigger");
      const catId = menuTrigger.getAttribute("data-cat-id");
      const subId = menuTrigger.getAttribute("data-sub-id");
      const key = kind === "cat" ? `cat:${catId}` : `sub:${catId}:${subId}`;
      invState._catMenuKey = invState._catMenuKey === key ? null : key;
      mountOrRefreshMockUi();
      return true;
    }
    const menuRename = t.closest("[data-cat-menu-rename]");
    if (menuRename) {
      ev.preventDefault();
      const kind = menuRename.getAttribute("data-cat-menu-rename");
      invState._catMenuKey = null;
      if (kind === "cat") {
        const cid = menuRename.getAttribute("data-cat-id");
        invState._renameCatId = cid;
        invState._renameSubKey = null;
      } else {
        const cid = menuRename.getAttribute("data-cat-id");
        const sid = menuRename.getAttribute("data-sub-id");
        invState._renameCatId = null;
        invState._renameSubKey = cid && sid ? `${cid}:${sid}` : null;
      }
      ensureCatManageDraft();
      invState._manageCategoriesOpen = true;
      mountOrRefreshMockUi();
      return true;
    }
    const menuDelete = t.closest("[data-cat-menu-delete]");
    if (menuDelete) {
      ev.preventDefault();
      const kind = menuDelete.getAttribute("data-cat-menu-delete");
      const catId = menuDelete.getAttribute("data-cat-id");
      invState._catMenuKey = null;
      if (kind === "cat") {
        const cat = catId ? getManageCategoryTree().find((c) => c.id === catId) : null;
        if (catId && cat) invState._catDeleteModal = { kind: "cat", catId, name: cat.name };
      } else {
        const sid = menuDelete.getAttribute("data-sub-id");
        const cat = catId ? getManageCategoryTree().find((c) => c.id === catId) : null;
        const sub = cat && sid ? cat.subcategories.find((s) => s.id === sid) : null;
        if (catId && sid && sub) invState._catDeleteModal = { kind: "sub", catId, subId: sid, name: sub.name };
      }
      mountOrRefreshMockUi();
      return true;
    }
    if (t.closest("[data-cat-inline-newcat]")) {
      ev.preventDefault();
      invState._inlineNewCat = true;
      mountOrRefreshMockUi();
      return true;
    }
    if (t.closest("[data-cat-new-cat-cancel]")) {
      ev.preventDefault();
      invState._inlineNewCat = false;
      mountOrRefreshMockUi();
      return true;
    }
    if (t.closest("[data-cat-new-cat-commit]")) {
      ev.preventDefault();
      const inp = root.querySelector("input[data-cat-new-cat-input]");
      const name = (inp && inp.value.trim()) || "New category";
      const ncid = newCategoryId();
      getManageCategoryTree().push({ id: ncid, name, subcategories: [] });
      invState._expandedCategoryIds.add(ncid);
      invState._inlineNewCat = false;
      mountOrRefreshMockUi();
      return true;
    }
    if (t.closest("[data-cat-rename-cancel='cat']") || t.closest("[data-cat-rename-cancel='sub']")) {
      ev.preventDefault();
      invState._renameCatId = null;
      invState._renameSubKey = null;
      mountOrRefreshMockUi();
      return true;
    }
    const saveRenameCat = t.closest("[data-cat-rename-save='cat']");
    if (saveRenameCat) {
      ev.preventDefault();
      const cid = saveRenameCat.getAttribute("data-cat-id");
      const cat = cid ? getManageCategoryTree().find((c) => c.id === cid) : null;
      const inp = cid ? root.querySelector(`input[data-cat-rename-input="cat"][data-cat-id="${cid}"]`) : null;
      if (cat && inp) cat.name = inp.value.trim() || cat.name;
      invState._renameCatId = null;
      mountOrRefreshMockUi();
      return true;
    }
    const saveRenameSub = t.closest("[data-cat-rename-save='sub']");
    if (saveRenameSub) {
      ev.preventDefault();
      const cid = saveRenameSub.getAttribute("data-cat-id");
      const sid = saveRenameSub.getAttribute("data-sub-id");
      const cat = cid ? getManageCategoryTree().find((c) => c.id === cid) : null;
      const inp =
        cid && sid
          ? root.querySelector(`input[data-cat-rename-input="sub"][data-cat-id="${cid}"][data-sub-id="${sid}"]`)
          : null;
      const sub = cat && sid ? cat.subcategories.find((s) => s.id === sid) : null;
      if (sub && inp) sub.name = inp.value.trim() || sub.name;
      invState._renameSubKey = null;
      mountOrRefreshMockUi();
      return true;
    }
    const addSubOpen = t.closest("[data-cat-add-sub-open]");
    if (addSubOpen) {
      ev.preventDefault();
      const cid = addSubOpen.getAttribute("data-cat-add-sub-open");
      invState._inlineNewSubCatId = invState._inlineNewSubCatId === cid ? null : cid;
      mountOrRefreshMockUi();
      return true;
    }
    if (t.closest("[data-cat-new-sub-cancel]")) {
      ev.preventDefault();
      invState._inlineNewSubCatId = null;
      mountOrRefreshMockUi();
      return true;
    }
    if (t.closest("[data-cat-new-sub-commit]")) {
      ev.preventDefault();
      const btn = t.closest("[data-cat-new-sub-commit]");
      const cid = btn && btn.getAttribute("data-cat-new-sub-commit");
      const cat = cid ? getManageCategoryTree().find((c) => c.id === cid) : null;
      const inp = cid ? root.querySelector(`input[data-cat-new-sub-input="${cid}"]`) : null;
      const name = (inp && inp.value.trim()) || "New subcategory";
      if (cat) {
        const ns = { id: newSubcategoryId(), name };
        cat.subcategories.push(ns);
        if (!invState._selectedSubcategoryId) invState._selectedSubcategoryId = ns.id;
      }
      invState._inlineNewSubCatId = null;
      mountOrRefreshMockUi();
      return true;
    }

    if (invState._catMenuKey && !t.closest(".ff-inv2-cat-menu-wrap")) {
      invState._catMenuKey = null;
      mountOrRefreshMockUi();
      return true;
    }
  return false;
}

/** Enter/Space on category menu trigger (inside shared Enter/Space handler). */
export function handleInventoryCatalogDelegateKeydownActivate(ev, t) {
        const trig = t.closest('[data-cat-menu-trigger][role="button"]');
        if (trig) {
          ev.preventDefault();
          trig.click();
          return true;
        }
  return false;
}

/** Escape key: catalog modals/menus (call after ev.key === "Escape" guard). */
export function handleInventoryCatalogDelegateKeydownEscape(ev) {
    if (invState._catDeleteModal) {
      ev.preventDefault();
      invState._catDeleteModal = null;
      mountOrRefreshMockUi();
      return true;
    }
    if (invState._catMenuKey) {
      ev.preventDefault();
      invState._catMenuKey = null;
      mountOrRefreshMockUi();
      return true;
    }
    if (invState._manageCategoriesOpen) {
      ev.preventDefault();
      invState._manageCategoriesOpen = false;
      invState._catManageDraftTree = null;
      resetCatModalTransientState();
      mountOrRefreshMockUi();
      return true;
    }
  return false;
}
