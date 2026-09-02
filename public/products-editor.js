// products-editor.js
// Products — editor modal, confirm dialog, per-tab form wiring, and Firestore
// CRUD for categories/subcategories/products. Extracted verbatim from
// products.js. renderProducts is injected via initProductsEditor() (wired in
// the products.js barrel) to keep the static import graph acyclic.

import {
  collection,
  doc,
  setDoc,
  addDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import {
  escapeHtml,
  moneyValue,
  formatMoney,
  ffStaffProductsGetOverrideForStaffMember,
  ffStaffProductsDefaultsForStaffMember,
} from "./products-helpers.js?v=20260902_prod_cats";
import { pstate } from "./products-state.js?v=20260902_prod_cats";
import {
  getSalonId,
  ffCanManageProducts,
  ffProductsManageError,
  ffProductsActiveLocId,
  findCategory,
  getCategorySubcategories,
  genSubId,
  loadProductsCatalog,
  saveProductLocationOverride,
  saveProductStaffOverride,
  saveProductInventory,
  ffStaffProductsLoadForStaffMember,
  ffStaffProductsSaveOverrideForStaffMember,
} from "./products-data.js?v=20260902_prod_cats";
import {
  ffWireProductToggles,
  subcategoryOptionsHtml,
} from "./products-ui.js?v=20260902_prod_cats";

// ── injected via initProductsEditor() (wired in the products.js barrel) ──
let renderProducts;

export function initProductsEditor(deps) {
  ({ renderProducts } = deps);
}

function removeProductsEditorModal() {
  const modal = document.getElementById("productsEditorModal");
  if (modal) modal.remove();
}

// Styled in-app confirmation dialog (matches the Products editor modal look).
// Resolves true when confirmed, false when cancelled/dismissed.
function showProductsConfirm({ title, message, confirmLabel = "Confirm", danger = false } = {}) {
  return new Promise((resolve) => {
    const screen = document.getElementById("productsScreen");
    document.getElementById("productsConfirmModal")?.remove();
    if (!screen) {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      modal.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === "Escape") finish(false);
      else if (e.key === "Enter") finish(true);
    };
    const accent = danger ? "#dc2626" : "#7c3aed";
    const accentBorder = danger ? "#dc2626" : "#7c3aed";
    const modal = document.createElement("div");
    modal.id = "productsConfirmModal";
    modal.style.cssText = "position:absolute;inset:0;background:rgba(17,24,39,.32);z-index:7;display:flex;align-items:flex-start;justify-content:center;padding-top:96px;";
    modal.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="${escapeHtml(title || "Confirm")}" style="width:min(420px,calc(100vw - 32px));background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:0 18px 48px rgba(15,23,42,.22);overflow:hidden;">
        <div style="padding:18px 18px 6px;">
          <div style="font-size:15px;font-weight:800;color:#111827;">${escapeHtml(title || "Are you sure?")}</div>
          ${message ? `<p style="margin:8px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">${escapeHtml(message)}</p>` : ""}
        </div>
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:16px 18px 18px;">
          <button type="button" data-products-confirm-cancel style="padding:8px 16px;border:1px solid #e5e7eb;background:#fff;color:#374151;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">Cancel</button>
          <button type="button" data-products-confirm-ok style="padding:8px 16px;border:1px solid ${accentBorder};background:${accent};color:#fff;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    modal.addEventListener("click", (event) => {
      if (event.target === modal) finish(false);
    });
    modal.querySelector("[data-products-confirm-cancel]")?.addEventListener("click", () => finish(false));
    modal.querySelector("[data-products-confirm-ok]")?.addEventListener("click", () => finish(true));
    document.addEventListener("keydown", onKey);
    screen.appendChild(modal);
    setTimeout(() => modal.querySelector("[data-products-confirm-ok]")?.focus(), 0);
  });
}

function closeProductsEditor() {
  pstate.editorState = null;
  removeProductsEditorModal();
}

function renderProductsEditor() {
  removeProductsEditorModal();
  if (!pstate.editorState) return;
  const screen = document.getElementById("productsScreen");
  if (!screen) return;
  const isProduct = pstate.editorState.mode === "product";
  const isSubcategory = pstate.editorState.mode === "subcategory";
  const category = pstate.productCategories.find((cat) => String(cat.id) === String(pstate.editorState.categoryId || ""));
  const editorSubtitle = isProduct
    ? `Create a product${category ? ` under ${category.name || "Category"}` : ""}.`
    : isSubcategory
      ? `Add a subcategory${category ? ` under ${category.name || "Category"}` : ""}.`
      : "Create a product category.";
  const editorTitle = isProduct ? "Add Product" : isSubcategory ? "Add Subcategory" : "Add Category";
  const nameLabel = isProduct ? "Product Name" : isSubcategory ? "Subcategory Name" : "Category Name";
  const categoryOptions = pstate.productCategories.map((cat) => (
    `<option value="${escapeHtml(cat.id)}" ${String(cat.id) === String(pstate.editorState.categoryId || "") ? "selected" : ""}>${escapeHtml(cat.name || "")}</option>`
  )).join("");
  const subcategoryOptions = subcategoryOptionsHtml(pstate.editorState.categoryId, pstate.editorState.subcategoryId);
  const modal = document.createElement("div");
  modal.id = "productsEditorModal";
  modal.style.cssText = "position:absolute;inset:0;background:rgba(17,24,39,.24);z-index:5;display:flex;align-items:flex-start;justify-content:center;padding-top:76px;";
  modal.innerHTML = `
    <div role="dialog" aria-modal="true" aria-label="${editorTitle}" style="width:min(520px,calc(100vw - 32px));background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:0 18px 48px rgba(15,23,42,.22);overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid #f3f4f6;">
        <div>
          <div style="font-size:15px;font-weight:800;color:#111827;">${editorTitle}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">${escapeHtml(editorSubtitle)}</div>
        </div>
        <button type="button" data-products-editor-close style="border:0;background:transparent;color:#6b7280;font-size:22px;line-height:1;cursor:pointer;">x</button>
      </div>
      <form id="productsEditorForm" style="padding:16px;display:flex;flex-direction:column;gap:12px;">
        <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">${nameLabel}
          <input name="name" autofocus style="padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;">
        </label>
        ${isProduct ? `
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Category
            <select name="categoryId" data-products-editor-category style="padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;background:#fff;">${categoryOptions}</select>
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Subcategory
            <select name="subcategoryId" data-products-editor-subcategory style="padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;background:#fff;">${subcategoryOptions}</select>
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Brand
            <input name="brand" style="padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;">
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Vendor / Supplier
            <input name="vendor" placeholder="e.g. OPI, SalonCentric, Amazon" style="padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;">
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Retail Price
            <input name="retailPrice" type="number" min="0" step="0.01" value="0" style="padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;">
          </label>
        ` : ""}
        <div id="productsEditorError" style="display:none;padding:9px 10px;border-radius:8px;background:#fef2f2;color:#b91c1c;font-size:12px;line-height:1.4;"></div>
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:4px;">
          <button type="button" data-products-editor-close style="padding:7px 14px;border:1px solid #e5e7eb;background:#fff;color:#374151;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">Cancel</button>
          <button type="submit" style="padding:7px 14px;border:1px solid #7c3aed;background:#7c3aed;color:#fff;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">Create</button>
        </div>
      </form>
    </div>
  `;
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeProductsEditor();
  });
  modal.querySelectorAll("[data-products-editor-close]").forEach((btn) => {
    btn.addEventListener("click", closeProductsEditor);
  });
  const editorCatSelect = modal.querySelector("[data-products-editor-category]");
  const editorSubSelect = modal.querySelector("[data-products-editor-subcategory]");
  if (editorCatSelect && editorSubSelect) {
    editorCatSelect.addEventListener("change", () => {
      editorSubSelect.innerHTML = subcategoryOptionsHtml(editorCatSelect.value, "");
    });
  }
  modal.querySelector("#productsEditorForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") || "").trim();
    if (!name) return;
    try {
      if (isProduct) {
        await createProduct({
          name,
          categoryId: String(data.get("categoryId") || "").trim() || null,
          subcategoryId: String(data.get("subcategoryId") || "").trim() || null,
          brand: String(data.get("brand") || "").trim(),
          vendor: String(data.get("vendor") || "").trim(),
          retailPrice: Number(data.get("retailPrice")),
        });
      } else if (isSubcategory) {
        await createSubcategory(pstate.editorState.categoryId, name);
      } else {
        await createCategory(name);
      }
      closeProductsEditor();
    } catch (error) {
      console.warn("[Products] Unable to create catalog item", error);
      const target = document.getElementById("productsEditorError");
      if (target) {
        const msg = String((error && error.message) || "");
        target.textContent = /choose a location/i.test(msg)
          ? "Choose a location to add products."
          : /permission/i.test(msg)
            ? "You do not have permission to save products."
            : (msg || "Unable to save this product setup right now.");
        target.style.display = "block";
      }
    }
  });
  screen.appendChild(modal);
  setTimeout(() => modal.querySelector("input[name='name']")?.focus(), 0);
}

function wireProductLocationsTab(root, product) {
  const basePrice = moneyValue(product.retailPrice);
  ffWireProductToggles(root);
  root.querySelectorAll(".ff-products-location-card").forEach((card) => {
    const locationId = card.getAttribute("data-location-id");
    const enabledInput = card.querySelector(".ff-products-location-enabled");
    const priceInput = card.querySelector(".ff-products-location-price");
    const stockInput = card.querySelector(".ff-products-location-stock");
    const saveBtn = card.querySelector(".ff-products-location-save");
    const resetBtn = card.querySelector(".ff-products-location-reset");
    const saved = card.querySelector(".ff-products-location-saved");
    async function persist(resetPrice) {
      const enabled = !!(enabledInput && enabledInput.checked);
      const rawPrice = Number(priceInput ? priceInput.value : NaN);
      const rawStock = Number(stockInput ? stockInput.value : NaN);
      const override = {};
      if (!enabled) override.enabled = false;
      if (!resetPrice && Number.isFinite(rawPrice) && rawPrice !== basePrice) override.price = rawPrice;
      if (Number.isFinite(rawStock) && rawStock >= 0) override.stock = rawStock;
      try {
        await saveProductLocationOverride(product.id, locationId, override);
        if (resetPrice && priceInput) priceInput.value = String(basePrice);
        if (saved) { saved.style.opacity = "1"; setTimeout(() => { saved.style.opacity = "0"; }, 1200); }
      } catch (error) {
        console.warn("[Products] Unable to save location override", error);
      }
    }
    if (saveBtn) saveBtn.addEventListener("click", () => persist(false));
    if (resetBtn) resetBtn.addEventListener("click", () => persist(true));
  });
}

function wireProductStaffTab(root, product) {
  ffWireProductToggles(root);
  root.querySelectorAll(".ff-products-staff-card").forEach((card) => {
    const staffId = card.getAttribute("data-staff-id");
    const enabledInput = card.querySelector(".ff-products-staff-enabled");
    const valueInput = card.querySelector(".ff-products-staff-commission-value");
    const typeInput = card.querySelector(".ff-products-staff-commission-type");
    const saveBtn = card.querySelector(".ff-products-staff-save");
    const saved = card.querySelector(".ff-products-staff-saved");
    if (!saveBtn) return;
    saveBtn.addEventListener("click", async () => {
      const enabled = !!(enabledInput && enabledInput.checked);
      const rawValue = Number(valueInput ? valueInput.value : NaN);
      const override = {};
      if (!enabled) override.enabled = false;
      if (Number.isFinite(rawValue) && rawValue > 0) {
        override.commission = {
          type: typeInput && typeInput.value === "fixed" ? "fixed" : "percentage",
          value: rawValue,
        };
      }
      try {
        await saveProductStaffOverride(product.id, staffId, override);
        if (saved) { saved.style.opacity = "1"; setTimeout(() => { saved.style.opacity = "0"; }, 1200); }
      } catch (error) {
        console.warn("[Products] Unable to save staff override", error);
      }
    });
  });
}

if (typeof window !== "undefined") {
  window.ffStaffProductsLoadForStaffMember = ffStaffProductsLoadForStaffMember;
  window.ffStaffProductsSaveOverrideForStaffMember = ffStaffProductsSaveOverrideForStaffMember;
  window.ffStaffProductsGetOverrideForStaffMember = ffStaffProductsGetOverrideForStaffMember;
  window.ffStaffProductsDefaultsForStaffMember = ffStaffProductsDefaultsForStaffMember;
  window.ffStaffProductsMoney = formatMoney;
  window.ffStaffProductsEscapeHtml = escapeHtml;
}

function wireProductInventoryTab(root, product) {
  const form = (root && root.querySelector("#productsInventoryForm")) || document.getElementById("productsInventoryForm");
  if (!form) return;
  const costPrice = moneyValue(product.costPrice);
  const stockInput = form.querySelector('input[name="stock"]');
  const valueEl = form.querySelector("#productsInventoryValue");
  if (stockInput && valueEl) {
    stockInput.addEventListener("input", () => {
      const s = Number(stockInput.value);
      const v = (Number.isFinite(s) && s >= 0 ? s : 0) * costPrice;
      valueEl.textContent = formatMoney(v);
    });
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const stock = Number(data.get("stock"));
    const targetStock = Number(data.get("targetStock"));
    const reorderPoint = Number(data.get("reorderPoint"));
    const inventory = {
      stock: Number.isFinite(stock) && stock >= 0 ? stock : 0,
      targetStock: Number.isFinite(targetStock) && targetStock >= 0 ? targetStock : 0,
      reorderPoint: Number.isFinite(reorderPoint) && reorderPoint >= 0 ? reorderPoint : 0,
      vendor: String(data.get("vendor") || "").trim(),
    };
    try {
      await saveProductInventory(product.id, inventory);
      const saved = document.getElementById("productsInventorySaved");
      if (saved) { saved.style.opacity = "1"; setTimeout(() => { saved.style.opacity = "0"; }, 1200); }
      // Re-run the reorder-point scan immediately so an Inbox alert is created
      // (or cleared) right after the stock change — full sync with Inventory.
      try {
        if (typeof window !== "undefined" && typeof window.ffScanProductReorderAlerts === "function") {
          window.ffScanProductReorderAlerts(true);
        }
      } catch (_) {}
    } catch (error) {
      console.warn("[Products] Unable to save inventory", error);
    }
  });
}

async function saveCategory(categoryId, patch) {
  if (!ffCanManageProducts()) throw ffProductsManageError();
  const salonId = getSalonId();
  if (!salonId) throw new Error("No salon selected");
  await setDoc(doc(db, `salons/${salonId}/productCategories`, categoryId), {
    ...(patch || {}),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  await loadProductsCatalog();
  renderProducts();
}

async function saveProduct(productId, patch) {
  if (!ffCanManageProducts()) throw ffProductsManageError();
  const salonId = getSalonId();
  if (!salonId) throw new Error("No salon selected");
  await setDoc(doc(db, `salons/${salonId}/products`, productId), {
    ...(patch || {}),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  await loadProductsCatalog();
  renderProducts();
}

async function createCategory(name) {
  if (!ffCanManageProducts()) throw ffProductsManageError();
  const salonId = getSalonId();
  if (!salonId) throw new Error("No salon selected");
  const ref = await addDoc(collection(db, `salons/${salonId}/productCategories`), {
    name: String(name || "").trim(),
    sortOrder: pstate.productCategories.length,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  pstate.selectedCategoryId = ref.id;
  pstate.selectedProductId = null;
  pstate.activeTab = "details";
  pstate.editorState = null;
  pstate.openProductCats.add(String(ref.id));
  await loadProductsCatalog();
  renderProducts();
}

async function createSubcategory(categoryId, name) {
  if (!ffCanManageProducts()) throw ffProductsManageError();
  const salonId = getSalonId();
  if (!salonId) throw new Error("No salon selected");
  const cat = findCategory(categoryId);
  if (!cat) throw new Error("Category not found");
  const existing = getCategorySubcategories(cat);
  const sub = { id: genSubId(), name: String(name || "").trim() || "Subcategory", sortOrder: existing.length };
  const next = [...existing, sub];
  await setDoc(doc(db, `salons/${salonId}/productCategories`, String(categoryId)), {
    subcategories: next,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  pstate.openProductCats.add(String(categoryId));
  pstate.editorState = null;
  await loadProductsCatalog();
  renderProducts();
}

async function deleteProduct(productId) {
  if (!ffCanManageProducts()) throw ffProductsManageError();
  const salonId = getSalonId();
  if (!salonId) throw new Error("No salon selected");
  await deleteDoc(doc(db, `salons/${salonId}/products`, String(productId)));
  pstate.selectedProductId = null;
  pstate.selectedCategoryId = null;
  pstate.activeTab = "details";
  await loadProductsCatalog();
  renderProducts();
}

async function deleteCategory(categoryId) {
  if (!ffCanManageProducts()) throw ffProductsManageError();
  const salonId = getSalonId();
  if (!salonId) throw new Error("No salon selected");
  await deleteDoc(doc(db, `salons/${salonId}/productCategories`, String(categoryId)));
  pstate.openProductCats.delete(String(categoryId));
  pstate.selectedCategoryId = null;
  pstate.selectedProductId = null;
  pstate.activeTab = "details";
  await loadProductsCatalog();
  renderProducts();
}

async function createProduct(payload) {
  if (!ffCanManageProducts()) throw ffProductsManageError();
  const salonId = getSalonId();
  if (!salonId) throw new Error("No salon selected");
  const loc = ffProductsActiveLocId();
  const retailPrice = Number(payload?.retailPrice);
  const costPrice = Number(payload?.costPrice);
  const ref = await addDoc(collection(db, `salons/${salonId}/products`), {
    name: String(payload?.name || "").trim() || "Untitled Product",
    categoryId: String(payload?.categoryId || "").trim() || null,
    subcategoryId: String(payload?.subcategoryId || "").trim() || null,
    brand: String(payload?.brand || "").trim(),
    vendor: String(payload?.vendor || "").trim(),
    retailPrice: Number.isFinite(retailPrice) && retailPrice >= 0 ? retailPrice : 0,
    costPrice: Number.isFinite(costPrice) && costPrice >= 0 ? costPrice : 0,
    taxable: payload?.taxable === true,
    active: payload?.active !== false,
    sortOrder: pstate.products.length,
    ...(loc ? { locationId: loc } : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  pstate.selectedProductId = ref.id;
  pstate.selectedCategoryId = null;
  pstate.activeTab = "details";
  pstate.editorState = null;
  pstate.openProductCats.add(String(payload?.categoryId || "__uncategorized__"));
  await loadProductsCatalog();
  renderProducts();
}

function productPayloadFromForm(form) {
  const data = new FormData(form);
  const retailPrice = Number(data.get("retailPrice"));
  const costPrice = Number(data.get("costPrice"));
  return {
    name: String(data.get("name") || "").trim() || "Untitled Product",
    categoryId: String(data.get("categoryId") || "").trim() || null,
    subcategoryId: String(data.get("subcategoryId") || "").trim() || null,
    brand: String(data.get("brand") || "").trim(),
    vendor: String(data.get("vendor") || "").trim(),
    retailPrice: Number.isFinite(retailPrice) && retailPrice >= 0 ? retailPrice : 0,
    costPrice: Number.isFinite(costPrice) && costPrice >= 0 ? costPrice : 0,
    taxable: data.get("taxable") === "on",
    active: data.get("active") === "on",
  };
}

function wireCategoryForm(category) {
  const form = document.getElementById("productsCategoryForm");
  if (!form) return;
  form.querySelector("[data-products-delete-category]")?.addEventListener("click", async () => {
    const count = pstate.products.filter((p) => String(p.categoryId || "") === String(category.id)).length;
    const message = count
      ? `${count} product${count === 1 ? "" : "s"} in this category will become Uncategorized. This cannot be undone.`
      : "This cannot be undone.";
    const ok = await showProductsConfirm({
      title: `Delete "${category.name || "this category"}"?`,
      message,
      confirmLabel: "Delete category",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteCategory(category.id);
    } catch (error) {
      console.warn("[Products] Unable to delete category", error);
      await showProductsConfirm({
        title: "Couldn't delete",
        message: "Unable to delete this category right now. Please try again.",
        confirmLabel: "OK",
      });
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = String(new FormData(form).get("name") || "").trim();
    if (!name) return;
    try {
      await saveCategory(category.id, { name });
      const saved = document.getElementById("productsCategorySaved");
      if (saved) saved.style.opacity = "1";
    } catch (error) {
      console.warn("[Products] Unable to save category", error);
    }
  });
}

function wireSubcategoryDependentSelect(form) {
  if (!form) return;
  const catSel = form.querySelector("[data-products-detail-category]");
  const subSel = form.querySelector("[data-products-detail-subcategory]");
  if (catSel && subSel) {
    catSel.addEventListener("change", () => {
      subSel.innerHTML = subcategoryOptionsHtml(catSel.value, "");
    });
  }
}

function wireProductForm(product) {
  const form = document.getElementById("productsDetailsForm");
  if (!form) return;
  wireSubcategoryDependentSelect(form);
  form.querySelector("[data-products-delete]")?.addEventListener("click", async () => {
    const ok = await showProductsConfirm({
      title: `Delete "${product.name || "this product"}"?`,
      message: "This cannot be undone.",
      confirmLabel: "Delete product",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteProduct(product.id);
    } catch (error) {
      console.warn("[Products] Unable to delete product", error);
      await showProductsConfirm({
        title: "Couldn't delete",
        message: "Unable to delete this product right now. Please try again.",
        confirmLabel: "OK",
      });
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveProduct(product.id, productPayloadFromForm(form));
      const saved = document.getElementById("productsDetailsSaved");
      if (saved) saved.style.opacity = "1";
    } catch (error) {
      console.warn("[Products] Unable to save product", error);
    }
  });
}

function wireNewProductForm() {
  const form = document.getElementById("productsNewProductForm");
  if (!form) return;
  wireSubcategoryDependentSelect(form);
  form.querySelector("[data-products-new-cancel]")?.addEventListener("click", () => {
    const categoryId = pstate.editorState?.categoryId || null;
    closeProductsEditor();
    pstate.selectedCategoryId = pstate.productCategories.some((cat) => String(cat.id) === String(categoryId || ""))
      ? categoryId
      : (pstate.productCategories[0]?.id || null);
    pstate.selectedProductId = null;
    pstate.activeTab = "details";
    renderProducts();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await createProduct(productPayloadFromForm(form));
      closeProductsEditor();
    } catch (error) {
      console.warn("[Products] Unable to create product", error);
      const target = document.getElementById("productsNewProductError");
      if (target) {
        const msg = String((error && error.message) || "");
        target.textContent = /choose a location/i.test(msg)
          ? "Choose a location to add products."
          : /permission/i.test(msg)
            ? "You do not have permission to save products."
            : (msg || "Unable to save this product setup right now.");
        target.style.display = "block";
      }
    }
  });
}

export function ffProductsAddCategory() {
  if (!ffCanManageProducts()) { if (typeof window.showToast === "function") window.showToast("You do not have permission to manage products.", "error"); return; }
  pstate.editorState = { mode: "category" };
  renderProductsEditor();
}

export function ffProductsAddProduct(categoryId, subcategoryId) {
  if (!ffCanManageProducts()) { if (typeof window.showToast === "function") window.showToast("You do not have permission to manage products.", "error"); return; }
  const resolvedCat = categoryId && categoryId !== "__uncategorized__" ? categoryId : (pstate.productCategories[0]?.id || null);
  pstate.editorState = {
    mode: "product",
    categoryId: resolvedCat,
    subcategoryId: subcategoryId || null,
  };
  pstate.selectedCategoryId = null;
  pstate.selectedProductId = null;
  pstate.activeTab = "details";
  renderProducts();
}

export function ffProductsAddSubcategory(categoryId) {
  if (!ffCanManageProducts()) { if (typeof window.showToast === "function") window.showToast("You do not have permission to manage products.", "error"); return; }
  if (!categoryId || categoryId === "__uncategorized__") return;
  pstate.editorState = { mode: "subcategory", categoryId };
  renderProductsEditor();
}

export {
  closeProductsEditor,
  renderProductsEditor,
  showProductsConfirm,
  wireCategoryForm,
  wireProductForm,
  wireNewProductForm,
  wireProductLocationsTab,
  wireProductStaffTab,
  wireProductInventoryTab,
};
