// products-data.js
// Firestore data layer + shared primitives for the Products catalog screen.
// Extracted verbatim from products.js (step 3 of the gradual split). One-way
// dependency: products.js -> products-data.js -> { products-state.js, products-helpers.js }.

import {
  collection,
  doc,
  getDocs,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { pstate } from "./products-state.js?v=20260626_products_split";

export function getSalonId() {
  return window.currentSalonId || window.currentUserProfile?.salonId || null;
}

export function ffCanManageProducts() {
  try {
    if (typeof window.ffCurrentUserHasProductsManagePermission === "function") {
      return window.ffCurrentUserHasProductsManagePermission();
    }
  } catch (e) {}
  return true;
}

export function ffProductsManageError() {
  return new Error("You do not have permission to manage products.");
}

// The currently active branch/location id (shared with the Inventory app).
export function ffProductsActiveLocId() {
  try {
    if (typeof window !== "undefined" && typeof window.ffGetActiveLocationId === "function") {
      const v = window.ffGetActiveLocationId();
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    if (typeof window !== "undefined"
        && typeof window.__ff_active_location_id === "string"
        && window.__ff_active_location_id.trim()) {
      return window.__ff_active_location_id.trim();
    }
  } catch (_) {}
  return null;
}

export function findCategory(catId) {
  return pstate.productCategories.find((c) => String(c.id) === String(catId)) || null;
}

export function getCategorySubcategories(cat) {
  const arr = cat && Array.isArray(cat.subcategories) ? cat.subcategories : [];
  return arr.slice().sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
}

export function genSubId() {
  return `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function loadProductsCatalog() {
  const salonId = getSalonId();
  if (!salonId) return;
  try {
    const [catSnap, productSnap] = await Promise.all([
      getDocs(collection(db, `salons/${salonId}/productCategories`)),
      getDocs(collection(db, `salons/${salonId}/products`)),
    ]);
    pstate.productCategories = catSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
    pstate.products = productSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
    pstate.productsCatalogError = "";
    if (pstate.editorState && pstate.editorState.mode === "product" && !pstate.productCategories.length) {
      pstate.editorState = null;
    }
  } catch (error) {
    console.warn("[Products] Unable to load catalog", error);
    pstate.productCategories = [];
    pstate.products = [];
    pstate.productsCatalogError = "Products catalog is not available right now.";
  }
}

export async function reorderProductWithinCategory(srcId, targetProductId, categoryId, placeAfter, subId) {
  const salonId = getSalonId();
  if (!salonId) return;
  const catKey = String(categoryId || "");
  const subKey = String(subId || "");
  const src = pstate.products.find((p) => String(p.id) === String(srcId));
  if (!src) return;
  const cat = findCategory(catKey);
  const validSubIds = cat ? new Set(getCategorySubcategories(cat).map((s) => String(s.id))) : new Set();
  const productSubKey = (p) => {
    const sid = String(p.subcategoryId || "");
    return sid && validSubIds.has(sid) ? sid : "";
  };
  const inSameGroup = (p) => {
    const pc = String(p.categoryId || "");
    const catMatch =
      catKey === "__uncategorized__"
        ? !p.categoryId || !pstate.productCategories.some((c) => String(c.id) === pc)
        : pc === catKey;
    return catMatch && productSubKey(p) === subKey;
  };
  const siblings = pstate.products
    .filter((p) => inSameGroup(p) && String(p.id) !== String(srcId))
    .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
  const targetIdx = siblings.findIndex((p) => String(p.id) === String(targetProductId));
  if (targetIdx < 0) return;
  siblings.splice(targetIdx + (placeAfter ? 1 : 0), 0, src);
  await Promise.all(siblings.map((p, idx) => updateDoc(doc(db, `salons/${salonId}/products`, p.id), {
    sortOrder: idx,
    updatedAt: serverTimestamp(),
  })));
}

export async function saveProductLocationOverride(productId, locationId, override) {
  if (!ffCanManageProducts()) throw ffProductsManageError();
  const salonId = getSalonId();
  if (!salonId || !locationId) throw new Error("No salon/location");
  await updateDoc(doc(db, `salons/${salonId}/products`, productId), {
    [`locationOverrides.${locationId}`]: override,
    updatedAt: serverTimestamp(),
  });
  const prod = pstate.products.find((p) => String(p.id) === String(productId));
  if (prod) {
    prod.locationOverrides = prod.locationOverrides && typeof prod.locationOverrides === "object" ? prod.locationOverrides : {};
    prod.locationOverrides[locationId] = override;
  }
}

export async function saveProductStaffOverride(productId, staffId, override) {
  if (!ffCanManageProducts()) throw ffProductsManageError();
  const salonId = getSalonId();
  if (!salonId || !staffId) throw new Error("No salon/staff");
  await updateDoc(doc(db, `salons/${salonId}/products`, productId), {
    [`staffOverrides.${staffId}`]: override,
    updatedAt: serverTimestamp(),
  });
  const prod = pstate.products.find((p) => String(p.id) === String(productId));
  if (prod) {
    prod.staffOverrides = prod.staffOverrides && typeof prod.staffOverrides === "object" ? prod.staffOverrides : {};
    prod.staffOverrides[staffId] = override;
  }
}

export async function saveProductInventory(productId, inventory) {
  if (!ffCanManageProducts()) throw ffProductsManageError();
  const salonId = getSalonId();
  if (!salonId) throw new Error("No salon");
  const prod = pstate.products.find((p) => String(p.id) === String(productId));
  const loc = ffProductsActiveLocId();
  if (loc) {
    // Per-branch: write to the active location override so the Inventory app and
    // the reorder-point scan (which both prefer locationOverrides[activeLoc]) stay
    // in sync with what's edited here.
    const updates = {
      [`locationOverrides.${loc}.stock`]: inventory.stock,
      [`locationOverrides.${loc}.targetStock`]: inventory.targetStock,
      [`locationOverrides.${loc}.reorderPoint`]: inventory.reorderPoint,
      [`locationOverrides.${loc}.vendor`]: inventory.vendor,
      updatedAt: serverTimestamp(),
    };
    await updateDoc(doc(db, `salons/${salonId}/products`, productId), updates);
    if (prod) {
      prod.locationOverrides = prod.locationOverrides && typeof prod.locationOverrides === "object" ? prod.locationOverrides : {};
      prod.locationOverrides[loc] = {
        ...(prod.locationOverrides[loc] || {}),
        stock: inventory.stock,
        targetStock: inventory.targetStock,
        reorderPoint: inventory.reorderPoint,
        vendor: inventory.vendor,
      };
    }
    return;
  }
  await updateDoc(doc(db, `salons/${salonId}/products`, productId), {
    inventory,
    updatedAt: serverTimestamp(),
  });
  if (prod) prod.inventory = inventory;
}

export async function ffStaffProductsLoadForStaffMember() {
  await loadProductsCatalog();
  return {
    products: pstate.products.slice(),
    categories: pstate.productCategories.slice(),
  };
}

export async function ffStaffProductsSaveOverrideForStaffMember(productId, staffId, override) {
  await loadProductsCatalog();
  const product = pstate.products.find((p) => String(p.id) === String(productId));
  if (!product) throw new Error("Product not found");
  await saveProductStaffOverride(productId, staffId, override || {});
  return product;
}
