// inventory-catalog.js
// Inventory > Catalog sub-app: category/subcategory tree (Firestore load/persist,
// shared-account catalog), the Manage Categories modal + drag/drop draft, and the
// sidebar rendering. Extracted verbatim from inventory.js. State is shared via
// invState. Nine inventory.js internals are injected (initInventoryCatalog) to
// avoid a circular import with the orchestrator.

import { invState } from "./inventory-state.js?v=20260627_inventory_split";
import {
  escapeHtml,
  newRowId,
  cloneCategoryTree,
  getProductCatSubsList,
  buildProductsInventorySubsForCat,
  productsInventorySubId,
  renderInlineNewSub,
  INV_PRODUCTS_GENERAL_SUB,
  SHARED_INV_DEFAULT_GROUP_ID,
} from "./inventory-helpers.js?v=20260627_inventory_split";
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

// ── injected inventory.js internals (set once via initInventoryCatalog) ──
let getSalonId;
let mountOrRefreshMockUi;
let _ffInvActiveLocId;
let _ffInvDocInActiveLoc;
let ffCanManageInventory;
let findSubMeta;
let prepareInventoryTableStateForMount;
let sharedInvItemsRef;
let inventoryOrderDraftToast;

export function initInventoryCatalog(deps) {
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

function reorderCatInDraft(dragCatId, targetCatId, placeBefore) {
  const tree = getManageCategoryTree();
  const fi = tree.findIndex((c) => c.id === dragCatId);
  const ti = tree.findIndex((c) => c.id === targetCatId);
  if (fi < 0 || ti < 0 || dragCatId === targetCatId) return;
  const [item] = tree.splice(fi, 1);
  let insertIdx = ti;
  if (fi < ti) insertIdx--;
  if (!placeBefore) insertIdx++;
  tree.splice(insertIdx, 0, item);
}

function moveSubInDraft(dragCatId, dragSubId, targetCatId, targetSubId, placeBefore) {
  if (dragSubId === targetSubId && dragCatId === targetCatId) return;
  const tree = getManageCategoryTree();
  const sourceCat = tree.find((c) => c.id === dragCatId);
  if (!sourceCat) return;
  const fi = sourceCat.subcategories.findIndex((s) => s.id === dragSubId);
  if (fi < 0) return;
  const targetCat = tree.find((c) => c.id === targetCatId);
  if (!targetCat) return;

  const [item] = sourceCat.subcategories.splice(fi, 1);

  if (targetSubId == null) {
    targetCat.subcategories.push(item);
    return;
  }

  let ti = targetCat.subcategories.findIndex((s) => s.id === targetSubId);
  if (ti < 0) {
    targetCat.subcategories.push(item);
    return;
  }
  if (dragCatId === targetCatId && fi < ti) ti--;
  const insertIdx = placeBefore ? ti : ti + 1;
  targetCat.subcategories.splice(insertIdx, 0, item);
}

function bindCatManageDnDOnce(root) {
  if (root.dataset.ffCatManageDnd === "1") return;
  root.dataset.ffCatManageDnd = "1";
  let overEl = null;
  let overBlockEl = null;

  function clearOver() {
    if (overEl && overEl.isConnected) overEl.classList.remove("ff-inv2-cat-dnd-over");
    if (overBlockEl && overBlockEl.isConnected) overBlockEl.classList.remove("ff-inv2-cat-dnd-over-block");
    overEl = null;
    overBlockEl = null;
  }

  root.addEventListener("dragstart", (ev) => {
    const h = ev.target && ev.target.closest && ev.target.closest("[data-cat-dnd]");
    if (!h || !root.contains(h)) return;
    const kind = h.getAttribute("data-cat-dnd");
    const catId = h.getAttribute("data-cat-id");
    if (!catId) return;
    if (kind === "cat") {
      invState._catDndPayload = { kind: "cat", catId };
      try {
        ev.dataTransfer.setData("text/plain", `cat:${catId}`);
        ev.dataTransfer.effectAllowed = "move";
      } catch (e) {}
      const block = h.closest("[data-cat-manage-block]");
      if (block) block.classList.add("ff-inv2-cat-dnd-dragging");
    } else if (kind === "sub") {
      const subId = h.getAttribute("data-sub-id");
      if (!subId) return;
      invState._catDndPayload = { kind: "sub", catId, subId };
      try {
        ev.dataTransfer.setData("text/plain", `sub:${catId}:${subId}`);
        ev.dataTransfer.effectAllowed = "move";
      } catch (e) {}
      const row = h.closest("[data-cat-manage-sub]");
      if (row) row.classList.add("ff-inv2-cat-dnd-dragging");
    }
  });

  root.addEventListener("dragend", () => {
    invState._catDndPayload = null;
    clearOver();
    root.querySelectorAll(".ff-inv2-cat-dnd-dragging").forEach((el) => el.classList.remove("ff-inv2-cat-dnd-dragging"));
  });

  root.addEventListener("dragover", (ev) => {
    if (!invState._manageCategoriesOpen || !invState._catDndPayload) return;
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const pay = invState._catDndPayload;
    if (pay.kind === "cat") {
      const block = t.closest("[data-cat-manage-block]");
      if (!block || !root.contains(block)) return;
      ev.preventDefault();
      try {
        ev.dataTransfer.dropEffect = "move";
      } catch (e) {}
      if (block !== overEl) {
        clearOver();
        overEl = block;
        overEl.classList.add("ff-inv2-cat-dnd-over");
      }
      return;
    }
    if (pay.kind === "sub") {
      const block = t.closest("[data-cat-manage-block]");
      if (!block || !root.contains(block)) return;
      ev.preventDefault();
      try {
        ev.dataTransfer.dropEffect = "move";
      } catch (e) {}
      const subEl = t.closest("[data-cat-manage-sub]");
      const nextSub = subEl && root.contains(subEl) ? subEl : null;
      if (block !== overBlockEl || nextSub !== overEl) {
        clearOver();
        overBlockEl = block;
        overBlockEl.classList.add("ff-inv2-cat-dnd-over-block");
        if (nextSub) {
          overEl = nextSub;
          overEl.classList.add("ff-inv2-cat-dnd-over");
        }
      }
    }
  });

  root.addEventListener("drop", (ev) => {
    if (!invState._manageCategoriesOpen || !invState._catDndPayload) return;
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const pay = invState._catDndPayload;
    clearOver();
    ev.preventDefault();
    if (pay.kind === "cat") {
      const block = t.closest("[data-cat-manage-block]");
      if (!block || !root.contains(block)) return;
      const targetCatId = block.getAttribute("data-cat-id");
      if (!targetCatId || targetCatId === pay.catId) return;
      const rect = block.getBoundingClientRect();
      const placeBefore = ev.clientY < rect.top + rect.height / 2;
      reorderCatInDraft(pay.catId, targetCatId, placeBefore);
      mountOrRefreshMockUi();
      return;
    }
    if (pay.kind === "sub") {
      const block = t.closest("[data-cat-manage-block]");
      if (!block || !root.contains(block)) return;
      const targetCatId = block.getAttribute("data-cat-id");
      if (!targetCatId) return;

      const subEl = t.closest("[data-cat-manage-sub]");
      if (subEl && root.contains(subEl)) {
        const catId = subEl.getAttribute("data-cat-id");
        const targetSubId = subEl.getAttribute("data-sub-id");
        if (!catId || !targetSubId) return;
        if (targetSubId === pay.subId && catId === pay.catId) return;
        const rect = subEl.getBoundingClientRect();
        const placeBefore = ev.clientY < rect.top + rect.height / 2;
        moveSubInDraft(pay.catId, pay.subId, catId, targetSubId, placeBefore);
        mountOrRefreshMockUi();
        return;
      }

      const rows = block.querySelectorAll("[data-cat-manage-sub]");
      if (rows.length === 0) {
        moveSubInDraft(pay.catId, pay.subId, targetCatId, null, false);
        mountOrRefreshMockUi();
        return;
      }
      const firstTop = rows[0].getBoundingClientRect().top;
      if (ev.clientY < firstTop) {
        moveSubInDraft(pay.catId, pay.subId, targetCatId, rows[0].getAttribute("data-sub-id"), true);
        mountOrRefreshMockUi();
        return;
      }
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const r = row.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        if (ev.clientY < mid) {
          moveSubInDraft(pay.catId, pay.subId, targetCatId, row.getAttribute("data-sub-id"), true);
          mountOrRefreshMockUi();
          return;
        }
      }
      moveSubInDraft(pay.catId, pay.subId, targetCatId, null, false);
      mountOrRefreshMockUi();
    }
  });
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

function renderSidebarHtml() {
  if (invState._invCategoriesLoading) {
    return `<p class="ff-inv2-aside-loading">Loading categories…</p>`;
  }
  if (invState._invCatLoadError) {
    return `<p class="ff-inv2-aside-error">${escapeHtml(invState._invCatLoadError)}</p>`;
  }
  function renderCatBlock(cat) {
    const open = invState._expandedCategoryIds.has(cat.id);
    const subs = cat.subcategories
      .map((sub) => {
        const active = sub.id === invState._selectedSubcategoryId;
        return `<div class="ff-inv2-sub${active ? " is-active" : ""}" data-sub-id="${escapeHtml(sub.id)}" role="button" tabindex="0">${escapeHtml(sub.name)}</div>`;
      })
      .join("");
    const productBadge = cat.isProductCategory
      ? `<span class="ff-inv2-cat-product-badge" style="font-size:10px;color:#7c3aed;margin-left:4px;">Products</span>`
      : "";
    return `
<div class="ff-inv2-cat${open ? " is-open" : ""}" data-cat-id="${escapeHtml(cat.id)}">
  <div class="ff-inv2-cat-row" data-cat-toggle="${escapeHtml(cat.id)}">
    <span class="ff-inv2-chevron" aria-hidden="true">&#8250;</span>
    <span>${escapeHtml(cat.name)}${productBadge}</span>
  </div>
  <div class="ff-inv2-sub-list" style="display:${open ? "block" : "none"}">${subs}</div>
</div>`;
  }
  const tree = getCategoryTree();
  const productCats = tree.filter((c) => c.isProductCategory);
  const legacyCats = tree.filter((c) => !c.isProductCategory);
  const labelCss = "font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.04em;padding:0 10px 6px;margin:0;";
  const labelCssTop = "font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.04em;padding:10px 10px 6px;margin:0;";
  let html = "";
  if (legacyCats.length) {
    html += `<p class="ff-inv2-aside-section-label" style="${labelCss}">Inventory lists</p>`;
    html += legacyCats.map(renderCatBlock).join("");
  }
  if (productCats.length) {
    html += `<p class="ff-inv2-aside-section-label" style="${legacyCats.length ? labelCssTop : labelCss}">From Products</p>`;
    html += productCats.map(renderCatBlock).join("");
  }
  return html || `<p class="ff-inv2-aside-empty" style="padding:10px;font-size:12px;color:#9ca3af;">No categories yet. Add products or use + Add for inventory lists.</p>`;
}

function renderCategoryRowMenu(catId, subId) {
  const isSub = subId != null && subId !== "";
  const key = isSub ? `sub:${catId}:${subId}` : `cat:${catId}`;
  const open = invState._catMenuKey === key;
  const trig = isSub
    ? `data-cat-menu-trigger="sub" data-cat-id="${escapeHtml(catId)}" data-sub-id="${escapeHtml(subId)}"`
    : `data-cat-menu-trigger="cat" data-cat-id="${escapeHtml(catId)}"`;
  const ren = isSub
    ? `data-cat-menu-rename="sub" data-cat-id="${escapeHtml(catId)}" data-sub-id="${escapeHtml(subId)}"`
    : `data-cat-menu-rename="cat" data-cat-id="${escapeHtml(catId)}"`;
  const del = isSub
    ? `data-cat-menu-delete="sub" data-cat-id="${escapeHtml(catId)}" data-sub-id="${escapeHtml(subId)}"`
    : `data-cat-menu-delete="cat" data-cat-id="${escapeHtml(catId)}"`;
  const trigger = isSub
    ? `<span role="button" tabindex="0" draggable="false" class="ff-inv2-cat-menu-trigger ff-inv2-cat-menu-trigger--sub" aria-label="More actions" aria-expanded="${open ? "true" : "false"}" ${trig}>⋯</span>`
    : `<button type="button" draggable="false" class="ff-inv2-cat-menu-trigger" aria-label="More actions" aria-expanded="${open ? "true" : "false"}" ${trig}>⋯</button>`;
  return `<div class="ff-inv2-cat-menu-wrap">
  ${trigger}
  <div class="ff-inv2-cat-menu-dropdown" style="display:${open ? "block" : "none"}" role="menu">
    <button type="button" draggable="false" class="ff-inv2-cat-menu-item" role="menuitem" ${ren}>Rename</button>
    <button type="button" draggable="false" class="ff-inv2-cat-menu-item ff-inv2-cat-menu-item-danger" role="menuitem" ${del}>Delete</button>
  </div>
</div>`;
}

function renderManageSubRow(cat, sub) {
  const key = `${cat.id}:${sub.id}`;
  const subRenaming = invState._renameSubKey === key;
  const openRenameSub = `data-cat-id="${escapeHtml(cat.id)}" data-sub-id="${escapeHtml(sub.id)}"`;
  const dragAttr = subRenaming ? `draggable="false"` : `draggable="true"`;
  return `<div class="ff-inv2-cat-manage-sub" ${dragAttr} data-cat-dnd="sub" data-cat-manage-sub="1" data-cat-id="${escapeHtml(cat.id)}" data-sub-id="${escapeHtml(sub.id)}">
  <div class="ff-inv2-cat-manage-sub-row">
    <div class="ff-inv2-cat-manage-sub-name">
      ${
        subRenaming
          ? `<input type="text" draggable="false" class="ff-inv2-cat-manage-input" data-cat-rename-input="sub" ${openRenameSub} value="${escapeHtml(sub.name)}" />`
          : `<span>${escapeHtml(sub.name)}</span>`
      }
    </div>
    <div class="ff-inv2-cat-manage-actions">
      ${
        subRenaming
          ? `<button type="button" draggable="false" class="ff-inv2-cat-manage-mini" data-cat-rename-save="sub" ${openRenameSub}>Save</button><button type="button" draggable="false" class="ff-inv2-cat-manage-mini" data-cat-rename-cancel="sub">Cancel</button>`
          : renderCategoryRowMenu(cat.id, sub.id)
      }
    </div>
  </div>
</div>`;
}

function renderManageCategoryBlock(cat) {
  const catId = cat.id;
  const renameCat = invState._renameCatId === catId;
  const showSubInput = invState._inlineNewSubCatId === catId;
  const subsHtml = cat.subcategories.map((s) => renderManageSubRow(cat, s)).join("");
  return `<div class="ff-inv2-cat-manage-block" data-cat-manage-block="1" data-cat-id="${escapeHtml(catId)}">
  <div class="ff-inv2-cat-manage-cat-row">
    <div class="ff-inv2-cat-manage-cat-name">
      ${
        renameCat
          ? `<input type="text" draggable="false" class="ff-inv2-cat-manage-input" data-cat-rename-input="cat" data-cat-id="${escapeHtml(catId)}" value="${escapeHtml(cat.name)}" />`
          : `<div class="ff-inv2-cat-manage-cat-drag" draggable="true" data-cat-dnd="cat" data-cat-id="${escapeHtml(catId)}" title="Drag to reorder category"><span class="ff-inv2-cat-manage-cat-text">${escapeHtml(cat.name)}</span></div>`
      }
    </div>
    <div class="ff-inv2-cat-manage-actions">
      ${
        renameCat
          ? `<button type="button" draggable="false" class="ff-inv2-cat-manage-mini" data-cat-rename-save="cat" data-cat-id="${escapeHtml(catId)}">Save</button><button type="button" draggable="false" class="ff-inv2-cat-manage-mini" data-cat-rename-cancel="cat">Cancel</button>`
          : `${renderCategoryRowMenu(catId, null)}<button type="button" draggable="false" class="ff-inv2-cat-manage-mini" data-cat-add-sub-open="${escapeHtml(catId)}">+ Add Subcategory</button>`
      }
    </div>
  </div>
  <div class="ff-inv2-cat-manage-subs">${subsHtml}${showSubInput ? renderInlineNewSub(catId) : ""}</div>
</div>`;
}

function renderManageCategoriesFooter() {
  const inlineNewCat = invState._inlineNewCat
    ? `<div class="ff-inv2-cat-manage-inline ff-inv2-cat-manage-inline-newcat">
    <input type="text" class="ff-inv2-cat-manage-input" placeholder="Category name" data-cat-new-cat-input="1" />
    <button type="button" class="ff-inv2-cat-manage-mini" data-cat-new-cat-commit="1">Add</button>
    <button type="button" class="ff-inv2-cat-manage-mini" data-cat-new-cat-cancel="1">Cancel</button>
  </div>`
    : "";
  const saveBusy = invState._catSaveBusy ? " disabled" : "";
  const saveLabel = invState._catSaveBusy ? "Saving…" : "Save";
  return `<div class="ff-inv2-cat-manage-footer">
  ${inlineNewCat}
  <button type="button" class="ff-inv2-cat-manage-save" data-cat-manage-save="1"${saveBusy}>${saveLabel}</button>
</div>`;
}

function renderManageCategoriesModal() {
  if (!invState._manageCategoriesOpen) return "";
  ensureCatManageDraft();
  const tree = invState._catManageDraftTree || getLegacyCategoryTreeForManage();
  const blocks = tree.map((c) => renderManageCategoryBlock(c)).join("");
  return `<div class="ff-inv2-modal-backdrop ff-inv2-cat-manage-backdrop" id="ff-inv2-cat-manage-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv2-cat-manage-title">
  <div class="ff-inv2-modal-card ff-inv2-cat-manage-card">
    <div class="ff-inv2-cat-manage-head">
      <div class="ff-inv2-cat-manage-head-main">
        <div class="ff-inv2-cat-manage-title-row">
          <h2 id="ff-inv2-cat-manage-title" class="ff-inv2-cat-manage-h2">Manage Categories</h2>
          <button type="button" class="ff-inv2-cat-manage-add-head" data-cat-inline-newcat="1">+ Add Category</button>
        </div>
      </div>
      <button type="button" class="ff-inv2-cat-manage-close" data-cat-manage-close="1" aria-label="Close">×</button>
    </div>
    <p class="ff-inv2-cat-manage-subtitle">Save to sync categories and subcategories to the cloud for this salon.</p>
    <div class="ff-inv2-cat-manage-body">${blocks || `<p class="ff-inv2-cat-manage-empty">No categories yet. Use + Add Category above.</p>`}</div>
    ${renderManageCategoriesFooter()}
  </div>
</div>`;
}

function renderCategoryDeleteConfirmModal() {
  if (!invState._catDeleteModal) return "";
  const d = invState._catDeleteModal;
  const extra =
    d.kind === "cat"
      ? `<p class="ff-inv2-modal-hint ff-inv2-cat-delete-extra">This will also remove all subcategories inside it.</p>`
      : "";
  return `<div class="ff-inv2-modal-backdrop" id="ff-inv2-cat-delete-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv2-cat-delete-title">
  <div class="ff-inv2-modal-card ff-inv2-cat-delete-modal-card">
    <h3 id="ff-inv2-cat-delete-title" class="ff-inv2-modal-title">Delete ${escapeHtml(d.name)}?</h3>
    <p class="ff-inv2-modal-hint">This will permanently remove this item and all related data. This action cannot be undone.</p>
    ${extra}
    <div class="ff-inv2-modal-actions">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-cat-delete-modal-cancel="1">Cancel</button>
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-danger" data-cat-delete-modal-commit="1">Delete</button>
    </div>
  </div>
</div>`;
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
  bindCatManageDnDOnce,
  resetCatModalTransientState,
  ensureValidSubcategorySelection,
  renderSidebarHtml,
  renderManageCategoriesModal,
  renderCategoryDeleteConfirmModal,
};
