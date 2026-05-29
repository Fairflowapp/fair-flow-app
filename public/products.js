import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260510_firestore_lp";

let productCategories = [];
let products = [];
let selectedCategoryId = null;
let selectedProductId = null;
let activeTab = "details";
let editorState = null;
let productsCatalogError = "";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[ch]));
}

function getSalonId() {
  return window.currentSalonId || window.currentUserProfile?.salonId || null;
}

function categoryName(categoryId) {
  const match = productCategories.find((cat) => String(cat.id) === String(categoryId));
  return match?.name || "Uncategorized";
}

function moneyValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(value) {
  const n = moneyValue(value);
  if (typeof window.ffFormatCurrency === "function") {
    return window.ffFormatCurrency(n, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  return "$" + n.toFixed(2);
}

async function loadProductsCatalog() {
  const salonId = getSalonId();
  if (!salonId) return;
  try {
    const [catSnap, productSnap] = await Promise.all([
      getDocs(collection(db, `salons/${salonId}/productCategories`)),
      getDocs(collection(db, `salons/${salonId}/products`)),
    ]);
    productCategories = catSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
    products = productSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
    productsCatalogError = "";
    if (editorState && editorState.mode === "product" && !productCategories.length) {
      editorState = null;
    }
  } catch (error) {
    console.warn("[Products] Unable to load catalog", error);
    productCategories = [];
    products = [];
    productsCatalogError = "Products catalog is not available right now.";
  }
}

function groupedProducts() {
  const groups = productCategories.map((cat) => ({
    category: cat,
    products: products.filter((product) => String(product.categoryId || "") === String(cat.id)),
  }));
  const uncategorized = products.filter((product) => !product.categoryId || !productCategories.some((cat) => String(cat.id) === String(product.categoryId)));
  if (uncategorized.length) {
    groups.push({ category: { id: "__uncategorized__", name: "Uncategorized" }, products: uncategorized });
  }
  return groups;
}

function renderProductsSidebar() {
  const list = document.getElementById("productsCatalogList");
  if (!list) return;
  const groups = groupedProducts();
  if (productsCatalogError) {
    list.innerHTML = `<div style="padding:12px 20px;font-size:12px;color:#b45309;line-height:1.45;">${escapeHtml(productsCatalogError)}</div>`;
    return;
  }
  if (!groups.length) {
    list.innerHTML = '<div style="padding:12px 20px;font-size:12px;color:#9ca3af;line-height:1.45;">No products yet. Add a category to get started.</div>';
    return;
  }
  list.innerHTML = groups.map(({ category, products: items }) => {
    const catSelected = String(selectedCategoryId || "") === String(category.id);
    const productRows = items.length
      ? items.map((product) => {
          const selected = String(selectedProductId || "") === String(product.id);
          return `
            <button type="button" data-product-id="${escapeHtml(product.id)}" style="width:100%;display:flex;align-items:center;gap:8px;text-align:left;border:0;background:${selected ? "#ede9fe" : "transparent"};color:${selected ? "#5b21b6" : "#374151"};padding:7px 20px 7px 34px;cursor:pointer;font-size:12px;font-weight:${selected ? "700" : "500"};">
              <span style="width:6px;height:6px;border-radius:999px;background:${product.active === false ? "#d1d5db" : "#7c3aed"};flex:0 0 auto;"></span>
              <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(product.name || "Untitled Product")}</span>
            </button>
          `;
        }).join("")
      : '<div style="padding:6px 20px 8px 34px;font-size:11px;color:#9ca3af;">No products</div>';
    const addProductRow = category.id !== "__uncategorized__"
      ? `
        <button type="button" data-add-product-category-id="${escapeHtml(category.id)}" style="width:100%;display:flex;align-items:center;gap:6px;text-align:left;border:0;background:transparent;color:#7c3aed;padding:7px 20px 9px 34px;cursor:pointer;font-size:11px;font-weight:800;">
          <span style="font-size:13px;line-height:1;">+</span>
          <span>Add Product</span>
        </button>
      `
      : "";
    return `
      <div>
        <button type="button" data-product-category-id="${escapeHtml(category.id)}" style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;border:0;background:${catSelected ? "#f5f3ff" : "transparent"};padding:9px 20px;cursor:pointer;text-align:left;">
          <span style="font-size:12px;font-weight:800;color:#111827;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(category.name || "Category")}</span>
          <span style="font-size:11px;color:#9ca3af;">${items.length}</span>
        </button>
        ${productRows}
        ${addProductRow}
      </div>
    `;
  }).join("");
  list.querySelectorAll("[data-product-category-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeProductsEditor();
      selectedCategoryId = btn.getAttribute("data-product-category-id");
      selectedProductId = null;
      activeTab = "details";
      renderProducts();
    });
  });
  list.querySelectorAll("[data-product-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeProductsEditor();
      selectedProductId = btn.getAttribute("data-product-id");
      selectedCategoryId = null;
      activeTab = "details";
      renderProducts();
    });
  });
  list.querySelectorAll("[data-add-product-category-id]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      ffProductsAddProduct(btn.getAttribute("data-add-product-category-id"));
    });
  });
}

function removeProductsEditorModal() {
  const modal = document.getElementById("productsEditorModal");
  if (modal) modal.remove();
}

function closeProductsEditor() {
  editorState = null;
  removeProductsEditorModal();
}

function renderProductsEditor() {
  removeProductsEditorModal();
  if (!editorState) return;
  const screen = document.getElementById("productsScreen");
  if (!screen) return;
  const isProduct = editorState.mode === "product";
  const category = productCategories.find((cat) => String(cat.id) === String(editorState.categoryId || ""));
  const editorSubtitle = isProduct
    ? `Create a product${category ? ` under ${category.name || "Category"}` : ""}.`
    : "Create a product category.";
  const categoryOptions = productCategories.map((cat) => (
    `<option value="${escapeHtml(cat.id)}" ${String(cat.id) === String(editorState.categoryId || "") ? "selected" : ""}>${escapeHtml(cat.name || "")}</option>`
  )).join("");
  const modal = document.createElement("div");
  modal.id = "productsEditorModal";
  modal.style.cssText = "position:absolute;inset:0;background:rgba(17,24,39,.24);z-index:5;display:flex;align-items:flex-start;justify-content:center;padding-top:76px;";
  modal.innerHTML = `
    <div role="dialog" aria-modal="true" aria-label="${isProduct ? "Add Product" : "Add Category"}" style="width:min(520px,calc(100vw - 32px));background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:0 18px 48px rgba(15,23,42,.22);overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid #f3f4f6;">
        <div>
          <div style="font-size:15px;font-weight:800;color:#111827;">${isProduct ? "Add Product" : "Add Category"}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">${escapeHtml(editorSubtitle)}</div>
        </div>
        <button type="button" data-products-editor-close style="border:0;background:transparent;color:#6b7280;font-size:22px;line-height:1;cursor:pointer;">x</button>
      </div>
      <form id="productsEditorForm" style="padding:16px;display:flex;flex-direction:column;gap:12px;">
        <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">${isProduct ? "Product Name" : "Category Name"}
          <input name="name" autofocus style="padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#111827;">
        </label>
        ${isProduct ? `
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Category
            <select name="categoryId" style="padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#111827;background:#fff;">${categoryOptions}</select>
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Brand
            <input name="brand" style="padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#111827;">
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Retail Price
            <input name="retailPrice" type="number" min="0" step="0.01" value="0" style="padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#111827;">
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
          brand: String(data.get("brand") || "").trim(),
          retailPrice: Number(data.get("retailPrice")),
        });
      } else {
        await createCategory(name);
      }
      closeProductsEditor();
    } catch (error) {
      console.warn("[Products] Unable to create catalog item", error);
      const target = document.getElementById("productsEditorError");
      if (target) {
        target.textContent = "Unable to save this product setup right now.";
        target.style.display = "block";
      }
    }
  });
  screen.appendChild(modal);
  setTimeout(() => modal.querySelector("input[name='name']")?.focus(), 0);
}

function renderTabButton(tab, label) {
  const active = activeTab === tab;
  return `<button type="button" data-products-tab="${tab}" class="staff-nav-item ${active ? "is-active" : ""}" style="width:100%;padding:8px 10px;min-height:36px;border:none;border-radius:6px;font-size:12px;cursor:pointer;text-align:left;background:${active ? "#ede9fe" : "transparent"};color:${active ? "#5b21b6" : "#374151"};font-weight:${active ? "700" : "500"};">${label}</button>`;
}

function renderPlaceholder(title, text) {
  return `
    <div style="padding:16px;background:#fff;border:1px solid var(--border);border-radius:12px;">
      <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:6px;">${escapeHtml(title)}</div>
      <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">${escapeHtml(text)}</p>
    </div>
  `;
}

function renderProductDetails(product) {
  const categoryOptions = [
    '<option value="">Uncategorized</option>',
    ...productCategories.map((cat) => `<option value="${escapeHtml(cat.id)}" ${String(product.categoryId || "") === String(cat.id) ? "selected" : ""}>${escapeHtml(cat.name || "")}</option>`),
  ].join("");
  return `
    <form id="productsDetailsForm" style="padding:16px;background:#fff;border:1px solid var(--border);border-radius:12px;display:flex;flex-direction:column;gap:12px;max-width:680px;">
      <div style="font-size:14px;font-weight:700;color:#111827;">Details</div>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Product Name
        <input name="name" value="${escapeHtml(product.name || "")}" style="padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#111827;">
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Category
        <select name="categoryId" style="padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#111827;background:#fff;">${categoryOptions}</select>
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Brand
        <input name="brand" value="${escapeHtml(product.brand || "")}" style="padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#111827;">
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Retail Price
        <input name="retailPrice" type="number" min="0" step="0.01" value="${escapeHtml(String(product.retailPrice ?? ""))}" style="padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#111827;">
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Cost Price
        <input name="costPrice" type="number" min="0" step="0.01" value="${escapeHtml(String(product.costPrice ?? ""))}" style="padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#111827;">
      </label>
      <label style="display:flex;align-items:center;gap:10px;font-size:12px;font-weight:700;color:#374151;">
        <input name="taxable" type="checkbox" ${product.taxable === true ? "checked" : ""} style="accent-color:#7c3aed;">
        Charge tax
      </label>
      <label style="display:flex;align-items:center;gap:10px;font-size:12px;font-weight:700;color:#374151;">
        <input name="active" type="checkbox" ${product.active === false ? "" : "checked"} style="accent-color:#7c3aed;">
        Active
      </label>
      <div style="display:flex;gap:8px;align-items:center;">
        <button type="submit" style="padding:7px 14px;border:1px solid #7c3aed;background:#7c3aed;color:#fff;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">Save</button>
        <span id="productsDetailsSaved" style="font-size:12px;color:#10b981;opacity:0;transition:opacity .18s;">Saved</span>
      </div>
    </form>
  `;
}

function renderNewProductForm(categoryId) {
  const categoryOptions = [
    '<option value="">Uncategorized</option>',
    ...productCategories.map((cat) => `<option value="${escapeHtml(cat.id)}" ${String(categoryId || "") === String(cat.id) ? "selected" : ""}>${escapeHtml(cat.name || "")}</option>`),
  ].join("");
  return `
    <form id="productsNewProductForm" style="padding:16px;background:#fff;border:1px solid var(--border);border-radius:12px;display:flex;flex-direction:column;gap:12px;max-width:680px;">
      <div>
        <div style="font-size:14px;font-weight:800;color:#111827;">New Product</div>
        <p style="margin:4px 0 0;color:#6b7280;font-size:12px;line-height:1.45;">Create the product details here. Inventory, tickets, and commission are not connected yet.</p>
      </div>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Product Name
        <input name="name" autofocus style="padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#111827;">
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Category
        <select name="categoryId" style="padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#111827;background:#fff;">${categoryOptions}</select>
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Brand
        <input name="brand" style="padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#111827;">
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Retail Price
        <input name="retailPrice" type="number" min="0" step="0.01" value="0" style="padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#111827;">
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Cost Price
        <input name="costPrice" type="number" min="0" step="0.01" value="0" style="padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#111827;">
      </label>
      <label style="display:flex;align-items:center;gap:10px;font-size:12px;font-weight:700;color:#374151;">
        <input name="taxable" type="checkbox" style="accent-color:#7c3aed;">
        Charge tax
      </label>
      <label style="display:flex;align-items:center;gap:10px;font-size:12px;font-weight:700;color:#374151;">
        <input name="active" type="checkbox" checked style="accent-color:#7c3aed;">
        Active
      </label>
      <div id="productsNewProductError" style="display:none;padding:9px 10px;border-radius:8px;background:#fef2f2;color:#b91c1c;font-size:12px;line-height:1.4;"></div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button type="submit" style="padding:7px 14px;border:1px solid #7c3aed;background:#7c3aed;color:#fff;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">Create Product</button>
        <button type="button" data-products-new-cancel style="padding:7px 14px;border:1px solid #e5e7eb;background:#fff;color:#374151;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">Cancel</button>
      </div>
    </form>
  `;
}

function renderCategoryDetails(category) {
  return `
    <form id="productsCategoryForm" style="padding:16px;background:#fff;border:1px solid var(--border);border-radius:12px;display:flex;flex-direction:column;gap:12px;max-width:680px;">
      <div style="font-size:14px;font-weight:700;color:#111827;">Category Details</div>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Category Name
        <input name="name" value="${escapeHtml(category.name || "")}" style="padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#111827;">
      </label>
      <div style="display:flex;gap:8px;align-items:center;">
        <button type="submit" style="padding:7px 14px;border:1px solid #7c3aed;background:#7c3aed;color:#fff;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">Save</button>
        <span id="productsCategorySaved" style="font-size:12px;color:#10b981;opacity:0;transition:opacity .18s;">Saved</span>
      </div>
    </form>
  `;
}

// ===== Locations tab =====
function getProductLocationOverrides(product) {
  return product && product.locationOverrides && typeof product.locationOverrides === "object"
    ? product.locationOverrides
    : {};
}

function renderProductLocationsTab(product) {
  const locations = (typeof window !== "undefined" && typeof window.ffGetActiveLocations === "function")
    ? (window.ffGetActiveLocations() || [])
    : [];
  if (!locations.length) {
    return renderPlaceholder("Locations", "No active locations yet. Add locations in your salon setup to manage product availability and pricing per location.");
  }
  const overrides = getProductLocationOverrides(product);
  const basePrice = moneyValue(product.retailPrice);
  const cards = locations.map((loc) => {
    const override = overrides[loc.id] || {};
    const enabled = override.enabled !== false;
    const hasPriceOverride = Number.isFinite(Number(override.price));
    const shownPrice = hasPriceOverride ? Number(override.price) : basePrice;
    const stock = Number.isFinite(Number(override.stock)) ? Number(override.stock) : "";
    return `
      <div class="ff-products-location-card" data-location-id="${escapeHtml(loc.id)}" style="border:1px solid var(--border);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:12px;background:#fff;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <div style="font-size:14px;font-weight:700;color:#111827;">${escapeHtml(loc.name || loc.label || "Location")}</div>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:#374151;">
            <input type="checkbox" class="ff-products-location-enabled" ${enabled ? "checked" : ""} style="accent-color:#7c3aed;">
            Available
          </label>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <label style="flex:1;min-width:140px;display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Retail Price${hasPriceOverride ? " (Override)" : ` (Default ${escapeHtml(formatMoney(basePrice))})`}
            <input type="number" min="0" step="0.01" class="ff-products-location-price" value="${escapeHtml(String(shownPrice))}" style="padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#111827;">
          </label>
          <label style="flex:1;min-width:120px;display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Current Stock
            <input type="number" min="0" step="1" class="ff-products-location-stock" value="${escapeHtml(String(stock))}" style="padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#111827;">
          </label>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button type="button" class="ff-products-location-save" style="padding:7px 14px;border:1px solid #7c3aed;background:#7c3aed;color:#fff;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">Save</button>
          ${hasPriceOverride ? '<button type="button" class="ff-products-location-reset" style="padding:7px 14px;border:1px solid #e5e7eb;background:#fff;color:#374151;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">Reset price to default</button>' : ""}
          <span class="ff-products-location-saved" style="font-size:12px;color:#10b981;opacity:0;transition:opacity .18s;">Saved</span>
        </div>
      </div>
    `;
  }).join("");
  return `
    <div style="display:flex;flex-direction:column;gap:12px;max-width:680px;">
      <div>
        <div style="font-size:14px;font-weight:800;color:#111827;">Locations</div>
        <p style="margin:4px 0 0;color:#6b7280;font-size:12px;line-height:1.45;">Default price comes from Details. Set a per-location override when it differs.</p>
      </div>
      ${cards}
    </div>
  `;
}

function wireProductLocationsTab(root, product) {
  const basePrice = moneyValue(product.retailPrice);
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

async function saveProductLocationOverride(productId, locationId, override) {
  const salonId = getSalonId();
  if (!salonId || !locationId) throw new Error("No salon/location");
  await updateDoc(doc(db, `salons/${salonId}/products`, productId), {
    [`locationOverrides.${locationId}`]: override,
    updatedAt: serverTimestamp(),
  });
  const prod = products.find((p) => String(p.id) === String(productId));
  if (prod) {
    prod.locationOverrides = prod.locationOverrides && typeof prod.locationOverrides === "object" ? prod.locationOverrides : {};
    prod.locationOverrides[locationId] = override;
  }
}

// ===== Staff tab =====
function getProductStaffOverrides(product) {
  return product && product.staffOverrides && typeof product.staffOverrides === "object"
    ? product.staffOverrides
    : {};
}

function getStaffProductId(staff) {
  return String(staff?.id || staff?.staffId || staff?.uid || staff?.firebaseUid || "").trim();
}

function getStaffProductName(staff) {
  return String(staff?.name || staff?.displayName || staff?.fullName || staff?.email || "Staff").trim();
}

function getProductStaffRows() {
  try {
    const store = (typeof window !== "undefined" && typeof window.ffGetStaffStore === "function")
      ? window.ffGetStaffStore()
      : null;
    const staff = Array.isArray(store?.staff) ? store.staff : [];
    return staff
      .filter((row) => row && row.archived !== true && row.status !== "archived")
      .sort((a, b) => getStaffProductName(a).localeCompare(getStaffProductName(b)));
  } catch (_) {
    return [];
  }
}

// Default product commission inherits from the staff member's Earnings Rules.
// Note: productCommission is not in Earnings Rules yet; reads it if/when present.
function getStaffDefaultProductCommission(staff) {
  const rules = staff && staff.earningsRules && typeof staff.earningsRules === "object" ? staff.earningsRules : {};
  const pc = rules.productCommission && typeof rules.productCommission === "object" ? rules.productCommission : {};
  const pct = Number(pc.basicPercent);
  if (pc.enabled === true && Number.isFinite(pct) && pct > 0) {
    return { type: "percentage", value: pct };
  }
  return null;
}

function formatProductCommissionDefault(def) {
  if (!def || !Number.isFinite(Number(def.value))) return "Default";
  const v = Number(def.value);
  return def.type === "fixed" ? `Default ${formatMoney(v)}` : `Default ${v}%`;
}

function renderProductStaffTab(product) {
  const staffRows = getProductStaffRows();
  if (!staffRows.length) {
    return renderPlaceholder("Staff", "No staff members found yet.");
  }
  const overrides = getProductStaffOverrides(product);
  const cards = staffRows.map((staff) => {
    const staffId = getStaffProductId(staff);
    if (!staffId) return "";
    const override = overrides[staffId] || {};
    const enabled = override.enabled !== false;
    const commission = override.commission && typeof override.commission === "object" ? override.commission : {};
    const def = getStaffDefaultProductCommission(staff);
    const hasOverride = Number.isFinite(Number(commission.value));
    const cType = hasOverride ? (commission.type === "fixed" ? "fixed" : "percentage") : (def?.type === "fixed" ? "fixed" : "percentage");
    const cValue = hasOverride ? String(Number(commission.value)) : "";
    const defLabel = formatProductCommissionDefault(def);
    return `
      <div class="ff-products-staff-card" data-staff-id="${escapeHtml(staffId)}" style="border:1px solid var(--border);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;background:#fff;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <div style="font-size:14px;font-weight:700;color:#111827;">${escapeHtml(getStaffProductName(staff))}</div>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:#374151;">
            <input type="checkbox" class="ff-products-staff-enabled" ${enabled ? "checked" : ""} style="accent-color:#7c3aed;">
            Available
          </label>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Product Commission
            <input type="number" min="0" step="0.01" class="ff-products-staff-commission-value" placeholder="${escapeHtml(defLabel)}" value="${escapeHtml(cValue)}" style="width:120px;padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#111827;">
          </label>
          <select class="ff-products-staff-commission-type" style="padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#111827;background:#fff;">
            <option value="percentage" ${cType === "percentage" ? "selected" : ""}>%</option>
            <option value="fixed" ${cType === "fixed" ? "selected" : ""}>$</option>
          </select>
          <button type="button" class="ff-products-staff-save" style="padding:7px 14px;border:1px solid #7c3aed;background:#7c3aed;color:#fff;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">Save</button>
          <span class="ff-products-staff-saved" style="font-size:12px;color:#10b981;opacity:0;transition:opacity .18s;">Saved</span>
        </div>
        <div style="font-size:11px;color:#9ca3af;">Inherits ${escapeHtml(defLabel)} from the staff member's Earnings Rules unless an override is set here.</div>
      </div>
    `;
  }).join("");
  return `
    <div style="display:flex;flex-direction:column;gap:12px;max-width:680px;">
      <div>
        <div style="font-size:14px;font-weight:800;color:#111827;">Staff</div>
        <p style="margin:4px 0 0;color:#6b7280;font-size:12px;line-height:1.45;">Product commission inherits from each staff member's Earnings Rules. Enter a value to override for this product.</p>
      </div>
      ${cards}
    </div>
  `;
}

function wireProductStaffTab(root, product) {
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

async function saveProductStaffOverride(productId, staffId, override) {
  const salonId = getSalonId();
  if (!salonId || !staffId) throw new Error("No salon/staff");
  await updateDoc(doc(db, `salons/${salonId}/products`, productId), {
    [`staffOverrides.${staffId}`]: override,
    updatedAt: serverTimestamp(),
  });
  const prod = products.find((p) => String(p.id) === String(productId));
  if (prod) {
    prod.staffOverrides = prod.staffOverrides && typeof prod.staffOverrides === "object" ? prod.staffOverrides : {};
    prod.staffOverrides[staffId] = override;
  }
}

// ===== Inventory tab (save/load only — no automatic reordering or stock math) =====
function getProductInventory(product) {
  return product && product.inventory && typeof product.inventory === "object" ? product.inventory : {};
}

function renderProductInventoryTab(product) {
  const inv = getProductInventory(product);
  const stockNum = Number.isFinite(Number(inv.stock)) ? Number(inv.stock) : 0;
  const stock = Number.isFinite(Number(inv.stock)) ? Number(inv.stock) : "";
  const reorderPoint = Number.isFinite(Number(inv.reorderPoint)) ? Number(inv.reorderPoint) : "";
  const costPrice = moneyValue(product.costPrice);
  const inventoryValue = stockNum * costPrice;
  return `
    <form id="productsInventoryForm" style="padding:16px;background:#fff;border:1px solid var(--border);border-radius:12px;display:flex;flex-direction:column;gap:12px;max-width:680px;">
      <div>
        <div style="font-size:14px;font-weight:800;color:#111827;">Inventory</div>
        <p style="margin:4px 0 0;color:#6b7280;font-size:12px;line-height:1.45;">Saved for reference only. No automatic reordering or stock calculations yet.</p>
      </div>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Current Stock
        <input name="stock" type="number" min="0" step="1" value="${escapeHtml(String(stock))}" style="padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#111827;">
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Reorder Point
        <input name="reorderPoint" type="number" min="0" step="1" value="${escapeHtml(String(reorderPoint))}" style="padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#111827;">
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Vendor
        <input name="vendor" value="${escapeHtml(inv.vendor || "")}" style="padding:9px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#111827;">
      </label>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <div style="flex:1;min-width:140px;display:flex;flex-direction:column;gap:6px;">
          <span style="font-size:12px;font-weight:700;color:#374151;">Cost Price</span>
          <div style="padding:9px 10px;border:1px solid #f3f4f6;border-radius:8px;font-size:13px;color:#6b7280;background:#f9fafb;">${escapeHtml(formatMoney(costPrice))}</div>
          <span style="font-size:11px;color:#9ca3af;">From Details. Edit it there.</span>
        </div>
        <div style="flex:1;min-width:140px;display:flex;flex-direction:column;gap:6px;">
          <span style="font-size:12px;font-weight:700;color:#374151;">Inventory Value</span>
          <div id="productsInventoryValue" style="padding:9px 10px;border:1px solid #f3f4f6;border-radius:8px;font-size:13px;color:#111827;background:#f9fafb;font-weight:700;">${escapeHtml(formatMoney(inventoryValue))}</div>
          <span style="font-size:11px;color:#9ca3af;">Current Stock × Cost Price</span>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button type="submit" style="padding:7px 14px;border:1px solid #7c3aed;background:#7c3aed;color:#fff;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">Save</button>
        <span id="productsInventorySaved" style="font-size:12px;color:#10b981;opacity:0;transition:opacity .18s;">Saved</span>
      </div>
    </form>
  `;
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
    const reorderPoint = Number(data.get("reorderPoint"));
    const inventory = {
      stock: Number.isFinite(stock) && stock >= 0 ? stock : 0,
      reorderPoint: Number.isFinite(reorderPoint) && reorderPoint >= 0 ? reorderPoint : 0,
      vendor: String(data.get("vendor") || "").trim(),
    };
    try {
      await saveProductInventory(product.id, inventory);
      const saved = document.getElementById("productsInventorySaved");
      if (saved) { saved.style.opacity = "1"; setTimeout(() => { saved.style.opacity = "0"; }, 1200); }
    } catch (error) {
      console.warn("[Products] Unable to save inventory", error);
    }
  });
}

async function saveProductInventory(productId, inventory) {
  const salonId = getSalonId();
  if (!salonId) throw new Error("No salon");
  await updateDoc(doc(db, `salons/${salonId}/products`, productId), {
    inventory,
    updatedAt: serverTimestamp(),
  });
  const prod = products.find((p) => String(p.id) === String(productId));
  if (prod) prod.inventory = inventory;
}

// TODO (future): Performance tab — Units Sold, Revenue, Product Commission Paid,
// Current Stock, Last Sold. Not implemented yet; requires Tickets/Payroll wiring.

function renderProductsDetail() {
  const placeholder = document.getElementById("productsDetailPlaceholder");
  const container = document.getElementById("productsDetailContainer");
  const header = document.getElementById("productsDetailHeader");
  const nav = document.getElementById("productsDetailNav");
  const content = document.getElementById("productsDetailTabContent");
  if (!placeholder || !container || !header || !nav || !content) return;
  const product = products.find((item) => String(item.id) === String(selectedProductId || ""));
  const category = productCategories.find((cat) => String(cat.id) === String(selectedCategoryId || ""));
  const creatingProduct = editorState && editorState.mode === "product";
  const creatingCategory = editorState && editorState.mode === "category";
  if (creatingProduct) {
    placeholder.style.display = "none";
    container.style.display = "block";
    const draftCategory = productCategories.find((cat) => String(cat.id) === String(editorState.categoryId || ""));
    header.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:8px 0 4px;">
        <div>
          <h2 style="margin:0 0 4px;font-size:22px;line-height:1.2;color:#111827;">New Product</h2>
          <div style="font-size:13px;color:#6b7280;">${escapeHtml(draftCategory ? `Under ${draftCategory.name || "Category"}` : "Product setup")}</div>
        </div>
      </div>
    `;
    nav.innerHTML = renderTabButton("details", "Details");
    content.innerHTML = renderNewProductForm(editorState.categoryId);
    wireNewProductForm();
    setTimeout(() => content.querySelector("input[name='name']")?.focus(), 0);
    return;
  }
  if (creatingCategory) {
    // Category creation still uses the compact dialog-style editor for now.
    renderProductsEditor();
  }
  if (!product && !category) {
    placeholder.style.display = "flex";
    container.style.display = "none";
    return;
  }
  placeholder.style.display = "none";
  container.style.display = "block";
  const title = product ? (product.name || "Untitled Product") : (category.name || "Category");
  const subtitle = product
    ? `${categoryName(product.categoryId)}${product.brand ? " · " + product.brand : ""} · ${formatMoney(product.retailPrice)}`
    : "Product category";
  header.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:8px 0 4px;">
      <div>
        <h2 style="margin:0 0 4px;font-size:22px;line-height:1.2;color:#111827;">${escapeHtml(title)}</h2>
        <div style="font-size:13px;color:#6b7280;">${escapeHtml(subtitle)}</div>
      </div>
      ${product ? `<span style="padding:4px 9px;border-radius:999px;background:${product.active === false ? "#f3f4f6" : "#ecfdf5"};color:${product.active === false ? "#6b7280" : "#047857"};font-size:11px;font-weight:800;">${product.active === false ? "Inactive" : "Active"}</span>` : ""}
    </div>
  `;
  nav.innerHTML = product
    ? [
        renderTabButton("details", "Details"),
        renderTabButton("locations", "Locations"),
        renderTabButton("staff", "Staff"),
        renderTabButton("inventory", "Inventory"),
      ].join("")
    : renderTabButton("details", "Details");
  nav.querySelectorAll("[data-products-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.getAttribute("data-products-tab") || "details";
      renderProductsDetail();
    });
  });
  if (category && !product) {
    content.innerHTML = renderCategoryDetails(category);
    wireCategoryForm(category);
    return;
  }
  if (activeTab === "locations") {
    content.innerHTML = renderProductLocationsTab(product);
    wireProductLocationsTab(content, product);
  } else if (activeTab === "staff") {
    content.innerHTML = renderProductStaffTab(product);
    wireProductStaffTab(content, product);
  } else if (activeTab === "inventory") {
    content.innerHTML = renderProductInventoryTab(product);
    wireProductInventoryTab(content, product);
  } else {
    content.innerHTML = renderProductDetails(product);
    wireProductForm(product);
  }
}

function renderProducts() {
  renderProductsSidebar();
  renderProductsDetail();
}

async function saveCategory(categoryId, patch) {
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
  const salonId = getSalonId();
  if (!salonId) throw new Error("No salon selected");
  const ref = await addDoc(collection(db, `salons/${salonId}/productCategories`), {
    name: String(name || "").trim(),
    sortOrder: productCategories.length,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  selectedCategoryId = ref.id;
  selectedProductId = null;
  activeTab = "details";
  editorState = null;
  await loadProductsCatalog();
  renderProducts();
}

async function createProduct(payload) {
  const salonId = getSalonId();
  if (!salonId) throw new Error("No salon selected");
  const retailPrice = Number(payload?.retailPrice);
  const costPrice = Number(payload?.costPrice);
  const ref = await addDoc(collection(db, `salons/${salonId}/products`), {
    name: String(payload?.name || "").trim() || "Untitled Product",
    categoryId: String(payload?.categoryId || "").trim() || null,
    brand: String(payload?.brand || "").trim(),
    retailPrice: Number.isFinite(retailPrice) && retailPrice >= 0 ? retailPrice : 0,
    costPrice: Number.isFinite(costPrice) && costPrice >= 0 ? costPrice : 0,
    taxable: payload?.taxable === true,
    active: payload?.active !== false,
    sortOrder: products.length,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  selectedProductId = ref.id;
  selectedCategoryId = null;
  activeTab = "details";
  editorState = null;
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
    brand: String(data.get("brand") || "").trim(),
    retailPrice: Number.isFinite(retailPrice) && retailPrice >= 0 ? retailPrice : 0,
    costPrice: Number.isFinite(costPrice) && costPrice >= 0 ? costPrice : 0,
    taxable: data.get("taxable") === "on",
    active: data.get("active") === "on",
  };
}

function wireCategoryForm(category) {
  const form = document.getElementById("productsCategoryForm");
  if (!form) return;
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

function wireProductForm(product) {
  const form = document.getElementById("productsDetailsForm");
  if (!form) return;
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
  form.querySelector("[data-products-new-cancel]")?.addEventListener("click", () => {
    const categoryId = editorState?.categoryId || null;
    closeProductsEditor();
    selectedCategoryId = productCategories.some((cat) => String(cat.id) === String(categoryId || ""))
      ? categoryId
      : (productCategories[0]?.id || null);
    selectedProductId = null;
    activeTab = "details";
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
        target.textContent = "Unable to save this product setup right now.";
        target.style.display = "block";
      }
    }
  });
}

export function ffProductsAddCategory() {
  editorState = { mode: "category" };
  renderProductsEditor();
}

export function ffProductsAddProduct(categoryId) {
  editorState = {
    mode: "product",
    categoryId: categoryId && categoryId !== "__uncategorized__" ? categoryId : (productCategories[0]?.id || null),
  };
  selectedCategoryId = null;
  selectedProductId = null;
  activeTab = "details";
  renderProducts();
}

function hideOtherScreens() {
  closeProductsEditor();
  [
    "owner-view",
    "tasksScreen",
    "inboxScreen",
    "chatScreen",
    "mediaScreen",
    "ticketsScreen",
    "servicesScreen",
    "trainingScreen",
    "scheduleScreen",
    "timeClockScreen",
    "inventoryScreen",
    "userProfileScreen",
    "myProfileScreen",
    "manageQueueScreen",
    "historyScreen",
    "dashboardScreen",
    "queueAnalyticsScreen",
    "ticketsAnalyticsScreen",
    "timeAnalyticsScreen",
    "tasksAnalyticsScreen",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = "none";
      el.style.pointerEvents = "none";
    }
  });
}

export function ffCloseProductsScreen() {
  closeProductsEditor();
  const screen = document.getElementById("productsScreen");
  if (screen) {
    screen.style.display = "none";
    screen.style.pointerEvents = "none";
  }
  const main = document.getElementById("main-app-content");
  if (main) {
    main.style.display = "block";
    main.style.pointerEvents = "auto";
  }
}

export async function goToProducts() {
  const screen = document.getElementById("productsScreen");
  if (!screen) return;
  hideOtherScreens();
  document.querySelectorAll(".btn-pill").forEach((btn) => btn.classList.remove("active"));
  const main = document.getElementById("main-app-content");
  if (main) {
    main.style.display = "block";
    main.style.pointerEvents = "auto";
  }
  screen.style.display = "block";
  screen.style.pointerEvents = "auto";
  await loadProductsCatalog();
  if (!selectedProductId && !selectedCategoryId) {
    selectedProductId = products[0]?.id || null;
    selectedCategoryId = selectedProductId ? null : (productCategories[0]?.id || null);
  }
  renderProducts();
}

window.goToProducts = goToProducts;
window.ffCloseProductsScreen = ffCloseProductsScreen;
window.ffProductsAddCategory = ffProductsAddCategory;
window.ffProductsAddProduct = ffProductsAddProduct;
