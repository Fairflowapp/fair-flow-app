// inventory-catalog-data.js
// Inventory > Catalog — Firestore load/persist/import + category-tree state
// (getters, manage draft, selection). Extracted verbatim from inventory-catalog.js.
// Fix: imports sharedInvSort (was missing since the original catalog extraction,
// causing a swallowed ReferenceError in shared-catalog load/import).

import { invState } from "./inventory-state.js?v=20260728_inv_mobile_unstick";
import {
  newRowId,
  cloneCategoryTree,
  getProductCatSubsList,
  buildProductsInventorySubsForCat,
  productsInventorySubId,
  INV_PRODUCTS_GENERAL_SUB,
  SHARED_INV_DEFAULT_GROUP_ID,
  sharedInvSort,
} from "./inventory-helpers.js?v=20260728_inv_mobile_unstick";
import { db } from "/app.js?v=20260610_force_lp_ios";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  setDoc,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// ── injected inventory.js internals (set once via initCatalogData) ──
let getSalonId;
let mountOrRefreshMockUi;
let _ffInvActiveLocId;
let _ffInvDocInActiveLoc;
let ffCanManageInventory;
let findSubMeta;
let prepareInventoryTableStateForMount;
let sharedInvItemsRef;
let inventoryOrderDraftToast;

export function initCatalogData(deps) {
  ({
    getSalonId,
    mountOrRefreshMockUi,
    _ffInvActiveLocId,
    _ffInvDocInActiveLoc,
    ffCanManageInventory,
    findSubMeta,
    prepareInventoryTableStateForMount,
    sharedInvItemsRef,
    inventoryOrderDraftToast,
  } = deps);
}

function sharedInvCategoriesRef(accountId) {
  return collection(db, `accounts/${accountId}/shared/inventoryCatalog/categories`);
}

function sharedInvSubcategoriesRef(accountId, catId) {
  return collection(db, `accounts/${accountId}/shared/inventoryCatalog/categories/${catId}/subcategories`);
}

async function tryLoadSharedInventoryCategories(accountId) {
  try {
    const catSnap = await getDocs(sharedInvCategoriesRef(accountId));
    const rawCats = catSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => c.active !== false)
      .sort(sharedInvSort);
    if (!rawCats.length) return false;
    const tree = await Promise.all(rawCats.map(async (c) => {
      const subSnap = await getDocs(sharedInvSubcategoriesRef(accountId, c.id));
      const subs = subSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => s.active !== false)
        .sort(sharedInvSort);
      return {
        id: c.id,
        name: c.name,
        subcategories: subs.map((s) => ({ id: s.id, name: s.name })),
      };
    }));
    invState._invUsingSharedCatalog = true;
    invState._categoryTree = tree;
    invState._persistedCategoryTree = cloneCategoryTree(tree);
    invState._expandedCategoryIds = new Set(tree.map((c) => c.id));
    ensureValidSubcategorySelection();
    console.log("[SharedInventory] loaded shared catalog");
    return true;
  } catch (e) {
    console.warn("[SharedInventory] shared catalog unavailable, using location inventory", e?.code, e?.message);
    return false;
  }
}

async function loadLegacyInventoryCategoryTree(salonId) {
  const catSnap = await getDocs(collection(db, `salons/${salonId}/inventoryCategories`));
  const rawCatsAll = catSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const rawCats = rawCatsAll.filter(_ffInvDocInActiveLoc);
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem("ff_inv_debug") === "true") {
      console.log(
        "[Inventory/loc] load categories — active=%o total=%d visible=%d",
        _ffInvActiveLocId() || "(none)",
        rawCatsAll.length,
        rawCats.length,
        rawCatsAll.map((c) => ({ id: c.id, name: c.name, locationId: c.locationId ?? null }))
      );
    }
  } catch (_) {}
  rawCats.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return Promise.all(
    rawCats.map(async (c) => {
      const subCol = collection(db, `salons/${salonId}/inventoryCategories/${c.id}/inventorySubcategories`);
      const subSnap = await getDocs(subCol);
      const subs = subSnap.docs
        .map((d) => {
          const data = d.data();
          return { id: d.id, name: data.name, order: data.order ?? 0, locationId: data.locationId };
        })
        .filter(_ffInvDocInActiveLoc);
      subs.sort((a, b) => a.order - b.order);
      return {
        id: c.id,
        name: c.name,
        subcategories: subs.map(({ id, name }) => ({ id, name })),
      };
    })
  );
}

async function loadInventoryCategoriesFromFirestore() {
  const salonId = await getSalonId();
  if (!salonId) {
    invState._invCatLoadError = "No salon — sign in or select a salon.";
    invState._categoryTree = [];
    invState._persistedCategoryTree = [];
    invState._invProductsList = [];
    return;
  }
  invState._invCatLoadError = null;
  invState._invUsingSharedCatalog = false;
  const [productTree, legacyTree] = await Promise.all([
    loadProductsForInventory(salonId),
    loadLegacyInventoryCategoryTree(salonId),
  ]);
  invState._categoryTree = [...legacyTree, ...productTree];
  invState._persistedCategoryTree = cloneCategoryTree(legacyTree);
  invState._expandedCategoryIds = new Set(invState._categoryTree.map((c) => c.id));
  ensureValidSubcategorySelection();
}

async function persistInventoryCategoryTree(desiredTree) {
  if (!ffCanManageInventory()) return;
  const salonId = await getSalonId();
  if (!salonId) throw new Error("No salon");

  const oldTree = invState._persistedCategoryTree || [];
  const oldCatIds = new Set(oldTree.map((c) => c.id));
  const desiredCatIds = new Set(desiredTree.map((c) => c.id));

  const oldSubById = new Map();
  for (const c of oldTree) {
    for (const s of c.subcategories || []) {
      oldSubById.set(s.id, { catId: c.id, sub: s });
    }
  }

  const newSubById = new Map();
  for (const c of desiredTree) {
    for (const s of c.subcategories || []) {
      newSubById.set(s.id, { catId: c.id, sub: s });
    }
  }

  const movedReads = [];
  for (const [subId, nw] of newSubById) {
    const old = oldSubById.get(subId);
    if (old && old.catId !== nw.catId) {
      const ref = doc(db, `salons/${salonId}/inventoryCategories/${old.catId}/inventorySubcategories/${subId}`);
      movedReads.push(getDoc(ref).then((snap) => ({ subId, snap })));
    }
  }
  const movedSnaps = await Promise.all(movedReads);
  const movedCreatedAt = new Map();
  /** Preserve table fields when moving sub to another category (batch.set replaces the whole doc). */
  const movedTableData = new Map();
  for (const { subId, snap } of movedSnaps) {
    if (snap.exists()) {
      const d = snap.data();
      const ca = d.createdAt;
      if (ca) movedCreatedAt.set(subId, ca);
      movedTableData.set(subId, {
        groups: Array.isArray(d.groups) ? d.groups : [],
        rows: Array.isArray(d.rows) ? d.rows : [],
      });
    }
  }

  let batch = writeBatch(db);
  let n = 0;
  const commits = [];

  function flush() {
    if (n === 0) return;
    commits.push(batch.commit());
    batch = writeBatch(db);
    n = 0;
  }
  function bump() {
    n++;
    if (n >= 450) flush();
  }

  for (const [subId, { catId }] of oldSubById) {
    const nw = newSubById.get(subId);
    if (!nw) {
      batch.delete(doc(db, `salons/${salonId}/inventoryCategories/${catId}/inventorySubcategories/${subId}`));
      bump();
    } else if (nw.catId !== catId) {
      batch.delete(doc(db, `salons/${salonId}/inventoryCategories/${catId}/inventorySubcategories/${subId}`));
      bump();
    }
  }

  for (const c of oldTree) {
    if (!desiredCatIds.has(c.id)) {
      batch.delete(doc(db, `salons/${salonId}/inventoryCategories/${c.id}`));
      bump();
    }
  }

  const activeLocId = _ffInvActiveLocId();
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem("ff_inv_debug") === "true") {
      console.log("[Inventory/loc] save categories — active=%o newCount=%d", activeLocId || "(none)", desiredTree.filter((c) => !oldCatIds.has(c.id)).length);
    }
  } catch (_) {}
  if (!activeLocId) {
    // Loud warning: stamping null here means the new doc will be invisible in
    // any explicitly-named branch. Almost always the wrong thing for a
    // multi-branch salon, but we still write so single-location accounts keep
    // working during onboarding.
    try {
      console.warn("[Inventory/loc] saving categories without an active locationId — new rows will fall back to the 'default' branch bucket.");
    } catch (_) {}
  }

  for (let ci = 0; ci < desiredTree.length; ci++) {
    const c = desiredTree[ci];
    const ref = doc(db, `salons/${salonId}/inventoryCategories/${c.id}`);
    if (!oldCatIds.has(c.id)) {
      batch.set(ref, {
        name: c.name,
        order: ci,
        locationId: activeLocId || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(ref, { name: c.name, order: ci, updatedAt: serverTimestamp() });
    }
    bump();
  }

  for (let ci = 0; ci < desiredTree.length; ci++) {
    const c = desiredTree[ci];
    for (let si = 0; si < c.subcategories.length; si++) {
      const s = c.subcategories[si];
      const order = si;
      const ref = doc(db, `salons/${salonId}/inventoryCategories/${c.id}/inventorySubcategories/${s.id}`);
      const old = oldSubById.get(s.id);
      const isNew = !oldSubById.has(s.id);
      const wasMoved = old && old.catId !== c.id;

      if (isNew) {
        batch.set(ref, {
          name: s.name,
          order,
          locationId: activeLocId || null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (wasMoved) {
        const ca = movedCreatedAt.get(s.id);
        const tbl = movedTableData.get(s.id);
        batch.set(ref, {
          name: s.name,
          order,
          locationId: activeLocId || null,
          createdAt: ca || serverTimestamp(),
          updatedAt: serverTimestamp(),
          groups: tbl ? tbl.groups : [],
          rows: tbl ? tbl.rows : [],
        });
      } else {
        batch.update(ref, { name: s.name, order, updatedAt: serverTimestamp() });
      }
      bump();
    }
  }

  flush();
  await Promise.all(commits);
}

async function importSharedCatalogIntoCurrentBranch() {
  if (!ffCanManageInventory()) return;
  const salonId = await getSalonId();
  if (!salonId) return;
  const activeLocId = _ffInvActiveLocId();
  if (!activeLocId) {
    inventoryOrderDraftToast("Select a location before importing shared inventory.", "error");
    return;
  }
  try {
    const sharedCatSnap = await getDocs(sharedInvCategoriesRef(salonId));
    const sharedCats = sharedCatSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => c.active !== false)
      .sort(sharedInvSort);
    if (!sharedCats.length) {
      inventoryOrderDraftToast("No shared inventory catalog yet.", "info");
      return;
    }

    const localTree = getCategoryTree();
    const localCatByName = new Map(localTree.map((c) => [String(c.name || "").trim().toLowerCase(), c]));
    const localCatCol = collection(db, `salons/${salonId}/inventoryCategories`);
    let addedCats = 0;
    let addedSubs = 0;
    let addedItems = 0;

    for (const sharedCat of sharedCats) {
      const catName = String(sharedCat.name || "").trim();
      if (!catName) continue;
      let localCat = localCatByName.get(catName.toLowerCase());
      let localCatId = localCat?.id || "";
      if (!localCatId) {
        const catRef = doc(localCatCol);
        await setDoc(catRef, {
          name: catName,
          order: localTree.length + addedCats,
          locationId: activeLocId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        localCatId = catRef.id;
        localCat = { id: localCatId, name: catName, subcategories: [] };
        localCatByName.set(catName.toLowerCase(), localCat);
        addedCats++;
      }

      const sharedSubSnap = await getDocs(sharedInvSubcategoriesRef(salonId, sharedCat.id));
      const sharedSubs = sharedSubSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => s.active !== false)
        .sort(sharedInvSort);
      const localSubByName = new Map((localCat.subcategories || []).map((s) => [String(s.name || "").trim().toLowerCase(), s]));

      for (const sharedSub of sharedSubs) {
        const subName = String(sharedSub.name || "").trim();
        if (!subName) continue;
        let localSub = localSubByName.get(subName.toLowerCase());
        let localSubId = localSub?.id || "";
        const localSubColPath = `salons/${salonId}/inventoryCategories/${localCatId}/inventorySubcategories`;
        if (!localSubId) {
          const subRef = doc(collection(db, localSubColPath));
          await setDoc(subRef, {
            name: subName,
            order: (localCat.subcategories || []).length + addedSubs,
            locationId: activeLocId,
            groups: [{ id: SHARED_INV_DEFAULT_GROUP_ID, name: "Inventory", order: 0 }],
            rows: [],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          localSubId = subRef.id;
          localSub = { id: localSubId, name: subName };
          if (!localCat.subcategories) localCat.subcategories = [];
          localCat.subcategories.push(localSub);
          localSubByName.set(subName.toLowerCase(), localSub);
          addedSubs++;
        }

        const subRef = doc(db, `${localSubColPath}/${localSubId}`);
        const localSubSnap = await getDoc(subRef);
        const localData = localSubSnap.exists() ? (localSubSnap.data() || {}) : {};
        const groupsRaw = Array.isArray(localData.groups) && localData.groups.length
          ? localData.groups
          : [{ id: SHARED_INV_DEFAULT_GROUP_ID, name: "Inventory", order: 0 }];
        const rowsRaw = Array.isArray(localData.rows) ? localData.rows : [];
        const existing = new Set(rowsRaw.map((r) => `${String(r.name || "").trim().toLowerCase()}|${String(r.code || "").trim().toLowerCase()}`));

        const sharedItemSnap = await getDocs(sharedInvItemsRef(salonId, sharedCat.id, sharedSub.id));
        const sharedItems = sharedItemSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((it) => it.active !== false)
          .sort(sharedInvSort);
        const newRows = rowsRaw.slice();
        for (const item of sharedItems) {
          const itemName = String(item.name || "").trim();
          if (!itemName) continue;
          const code = String(item.code || "").trim();
          const key = `${itemName.toLowerCase()}|${code.toLowerCase()}`;
          if (existing.has(key)) continue;
          existing.add(key);
          const byGroup = {};
          for (const g of groupsRaw) {
            const gid = String(g.id || SHARED_INV_DEFAULT_GROUP_ID);
            byGroup[gid] = {
              stock: 0,
              current: 0,
              price: item.defaultPrice != null && item.defaultPrice !== "" ? String(item.defaultPrice) : "",
            };
          }
          newRows.push({
            id: newRowId(),
            rowNo: "",
            code,
            name: itemName,
            supplier: "",
            url: "",
            byGroup,
          });
          addedItems++;
        }
        if (newRows.length !== rowsRaw.length || !localSubSnap.exists()) {
          await setDoc(subRef, {
            name: subName,
            locationId: activeLocId,
            groups: groupsRaw,
            rows: newRows,
            updatedAt: serverTimestamp(),
          }, { merge: true });
        }
      }
    }

    invState._invCategoriesLoading = true;
    mountOrRefreshMockUi();
    await loadInventoryCategoriesFromFirestore();
    invState._invCategoriesLoading = false;
    const firstSub = getCategoryTree().flatMap((c) => c.subcategories || [])[0];
    if (!invState._selectedSubcategoryId && firstSub) invState._selectedSubcategoryId = firstSub.id;
    invState._invTableLoadedForSubId = null;
    prepareInventoryTableStateForMount();
    mountOrRefreshMockUi();
    inventoryOrderDraftToast(`Imported shared catalog: ${addedCats} categories, ${addedSubs} subcategories, ${addedItems} items.`, "success");
  } catch (e) {
    invState._invCategoriesLoading = false;
    console.error("[Inventory] import shared catalog failed", e);
    inventoryOrderDraftToast("Could not import shared catalog.", "error");
    mountOrRefreshMockUi();
  }
}

function getCategoryTree() {
  return invState._categoryTree || [];
}

function getLegacyCategoryTreeForManage() {
  return (invState._persistedCategoryTree && invState._persistedCategoryTree.length
    ? invState._persistedCategoryTree
    : getCategoryTree().filter((c) => !c.isProductCategory));
}

function getManageCategoryTree() {
  if (invState._manageCategoriesOpen && invState._catManageDraftTree) return invState._catManageDraftTree;
  return getLegacyCategoryTreeForManage();
}

function ensureCatManageDraft() {
  if (!invState._catManageDraftTree) {
    invState._catManageDraftTree = cloneCategoryTree(getLegacyCategoryTreeForManage());
  }
}

function resetCatModalTransientState() {
  invState._renameCatId = null;
  invState._renameSubKey = null;
  invState._catMenuKey = null;
  invState._catDeleteModal = null;
  invState._inlineNewCat = false;
  invState._inlineNewSubCatId = null;
}

function ensureValidSubcategorySelection() {
  const tree = getCategoryTree();
  if (!tree.length) {
    invState._selectedSubcategoryId = null;
    return;
  }
  if (findSubMeta(invState._selectedSubcategoryId)) return;
  for (const c of tree) {
    if (c.subcategories && c.subcategories.length) {
      invState._selectedSubcategoryId = c.subcategories[0].id;
      return;
    }
  }
  invState._selectedSubcategoryId = null;
}

async function loadProductsForInventory(salonId) {
  invState._invProductsList = [];
  invState._invProductCatSubs = new Map();
  try {
    const [catSnap, prodSnap] = await Promise.all([
      getDocs(collection(db, `salons/${salonId}/productCategories`)),
      getDocs(collection(db, `salons/${salonId}/products`)),
    ]);
    const cats = catSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
    invState._invProductsList = prodSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
    const catIds = new Set(cats.map((c) => c.id));
    const tree = cats.map((c) => {
      const catId = String(c.id);
      const catProducts = invState._invProductsList.filter((p) => String(p.categoryId || "") === catId);
      const { subs, subIds } = buildProductsInventorySubsForCat(c, catProducts);
      invState._invProductCatSubs.set(catId, getProductCatSubsList(c));
      return {
        id: catId,
        name: c.name || "Category",
        isProductCategory: true,
        _validSubIds: subIds,
        subcategories: subs,
      };
    });
    const uncategorized = invState._invProductsList.filter((p) => !p.categoryId || !catIds.has(String(p.categoryId)));
    if (uncategorized.length) {
      tree.push({
        id: "__uncategorized__",
        name: "Uncategorized",
        isProductCategory: true,
        _validSubIds: new Set(),
        subcategories: [
          {
            id: productsInventorySubId("__uncategorized__", INV_PRODUCTS_GENERAL_SUB),
            name: "Products",
            isProductsSub: true,
            productCategoryId: "__uncategorized__",
            productSubcategoryId: INV_PRODUCTS_GENERAL_SUB,
          },
        ],
      });
    }
    return tree;
  } catch (e) {
    console.warn("[Inventory] products catalog load failed", e);
    return [];
  }
}

export {
  sharedInvCategoriesRef,
  sharedInvSubcategoriesRef,
  loadInventoryCategoriesFromFirestore,
  persistInventoryCategoryTree,
  importSharedCatalogIntoCurrentBranch,
  getCategoryTree,
  getLegacyCategoryTreeForManage,
  getManageCategoryTree,
  ensureCatManageDraft,
  resetCatModalTransientState,
  ensureValidSubcategorySelection,
};
