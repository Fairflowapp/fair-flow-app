import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import {
  escapeHtml,
  moneyValue,
  formatMoney,
  getProductLocationOverrides,
  getProductStaffOverrides,
  getStaffProductId,
  getStaffProductName,
  getStaffDefaultProductCommission,
  formatProductCommissionDefault,
  ffStaffProductsGetOverrideForStaffMember,
  ffStaffProductsDefaultsForStaffMember,
  getProductInventory,
} from "./products-helpers.js?v=20260626_products_split";
import { pstate } from "./products-state.js?v=20260626_products_split";
import {
  getSalonId,
  ffCanManageProducts,
  ffProductsManageError,
  ffProductsActiveLocId,
  findCategory,
  getCategorySubcategories,
  genSubId,
  loadProductsCatalog,
  reorderProductWithinCategory,
  saveProductLocationOverride,
  saveProductStaffOverride,
  saveProductInventory,
  ffStaffProductsLoadForStaffMember,
  ffStaffProductsSaveOverrideForStaffMember,
} from "./products-data.js?v=20260626_products_split";
import {
  categoryName,
  ffWireProductToggles,
  subcategoryOptionsHtml,
  groupedProductsNested,
  renderProductSidebarRow,
  renderTabButton,
  renderProductDetails,
  renderNewProductForm,
  renderCategoryDetails,
  renderProductLocationsTab,
  renderProductStaffTab,
  renderProductInventoryTab,
} from "./products-ui.js?v=20260626_products_split";

// ===== Products screen mobile drill-down (list -> product menu -> section) =====
// Mirrors the Services screen pattern. On phones (<=640px) the two-pane desktop
// layout is shown one level at a time via classes on the #productsScreen root.
// No effect on desktop.
function _ffProductsScreenIsMobile() {
  try {
    return !!(window.matchMedia && window.matchMedia("(max-width: 640px)").matches);
  } catch (_) {
    return false;
  }
}

function _ffProductsMobileShowList() {
  const el = document.getElementById("productsScreen");
  if (!el) return;
  el.classList.remove("ff-products-mobile-detail");
  el.classList.remove("ff-products-mobile-tab");
}

// mode: 'detail' (item selected -> show the tab menu)
//       'tab'    (a section was chosen -> show that section's content)
function _ffProductsMobileShowDetail(mode) {
  if (!_ffProductsScreenIsMobile()) return;
  const el = document.getElementById("productsScreen");
  if (!el) return;
  el.classList.remove("ff-products-mobile-detail");
  el.classList.remove("ff-products-mobile-tab");
  el.classList.add(mode === "tab" ? "ff-products-mobile-tab" : "ff-products-mobile-detail");
  try {
    const content = el.querySelector(".staff-content-area");
    if (content) content.scrollTop = 0;
  } catch (_) {}
}

if (typeof document !== "undefined" && !document.__ffProductsMobileBackDelegated) {
  document.__ffProductsMobileBackDelegated = true;
  document.addEventListener("click", (event) => {
    const target = event.target && event.target.closest
      ? event.target.closest("#productsScreen .ff-products-mobile-back")
      : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const el = document.getElementById("productsScreen");
    if (el && el.classList.contains("ff-products-mobile-tab")) {
      el.classList.remove("ff-products-mobile-tab");
      el.classList.add("ff-products-mobile-detail");
      try {
        const content = el.querySelector(".staff-content-area");
        if (content) content.scrollTop = 0;
      } catch (_) {}
      return;
    }
    _ffProductsMobileShowList();
  }, true);
}

// Permission gates for the Products catalog. Default to allow when the helper
// isn't available yet so the owner is never hard-blocked.
function ffCanViewProducts() {
  try {
    if (typeof window.ffCurrentUserHasProductsViewPermission === "function") {
      return window.ffCurrentUserHasProductsViewPermission();
    }
  } catch (e) {}
  return true;
}

function renderProductsSidebar() {
  const list = document.getElementById("productsCatalogList");
  if (!list) return;
  const groups = groupedProductsNested();
  if (pstate.productsCatalogError) {
    list.innerHTML = `<div style="padding:12px 20px;font-size:12px;color:#b45309;line-height:1.45;">${escapeHtml(pstate.productsCatalogError)}</div>`;
    return;
  }
  if (!groups.length) {
    list.innerHTML = '<div style="padding:12px 20px;font-size:12px;color:#9ca3af;line-height:1.45;">No products yet. Add a category to get started.</div>';
    return;
  }
  // On first render, expand every category (matches the Services sidebar).
  if (!pstate.productsSidebarRenderedOnce && pstate.openProductCats.size === 0 && groups.length) {
    groups.forEach((g) => pstate.openProductCats.add(String(g.category.id)));
  }
  pstate.productsSidebarRenderedOnce = true;

  list.innerHTML = groups.map(({ category, subgroups, hasRealSubs }) => {
    const catId = String(category.id);
    const catSelected = String(pstate.selectedCategoryId || "") === catId;
    const isOpen = pstate.openProductCats.has(catId);
    const arrow = isOpen ? "\u25BE" : "\u25B8";
    const isUncategorized = catId === "__uncategorized__";

    const subgroupHtml = subgroups.map(({ sub, products: items }) => {
      const subId = sub ? String(sub.id) : "";
      const rows = items.length
        ? items.map((p) => renderProductSidebarRow(p, catId, subId)).join("")
        : '<div style="padding:6px 8px;color:#9ca3af;font-size:12px;">No products yet.</div>';
      const label = sub ? sub.name : (hasRealSubs ? "General" : "");
      const header = label
        ? `<div style="display:flex;align-items:center;gap:6px;padding:4px 0 2px 6px;margin-top:4px;"><span style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.03em;">${escapeHtml(label)}</span></div>`
        : "";
      const addBtn = !isUncategorized
        ? `<button type="button" class="ffcat-addproduct-btn" data-add-product-category-id="${escapeHtml(catId)}" data-add-product-sub-id="${escapeHtml(subId)}" style="width:100%;background:none;border:none;color:#7c3aed;font-weight:600;font-size:12px;padding:6px 8px;cursor:pointer;text-align:left;border-radius:6px;">+ Add Product</button>`
        : "";
      const indent = (sub || hasRealSubs)
        ? "padding-left:10px;border-left:2px solid #f3f4f6;margin-left:4px;"
        : "";
      return `<div style="display:flex;flex-direction:column;gap:4px;${indent}">${header}${rows}${addBtn}</div>`;
    }).join("");

    const addSubBtn = !isUncategorized
      ? `<button type="button" class="ffcat-addsub-btn" data-add-sub-category-id="${escapeHtml(catId)}" style="width:100%;background:none;border:none;color:#7c3aed;font-weight:600;font-size:12px;padding:6px 8px;cursor:pointer;text-align:left;border-radius:6px;border-top:1px dashed #ede9fe;margin-top:4px;">+ Add Subcategory</button>`
      : "";

    return `
      <div class="staff-sidebar-section" style="padding:0 16px 12px 16px;border-top:1px solid var(--border);padding-top:12px;">
        <div style="display:flex;align-items:center;gap:6px;margin:0 0 6px 0;">
          <button type="button" class="ff-products-cat-toggle" data-cat-id="${escapeHtml(catId)}" aria-expanded="${isOpen ? "true" : "false"}" style="border:none;background:none;color:#6b7280;cursor:pointer;font-size:14px;line-height:1;padding:2px;width:16px;flex-shrink:0;">${arrow}</button>
          <button type="button" class="ff-products-category-title${catSelected ? " is-selected" : ""}" data-product-category-id="${escapeHtml(catId)}" ${isUncategorized ? "disabled" : ""} style="margin:0;font-size:11px;font-weight:500;color:#6b7280;text-transform:none;letter-spacing:0;flex:1;text-align:left;border:none;background:${catSelected ? "#ede9fe" : "transparent"};border-radius:6px;padding:4px 6px;cursor:${isUncategorized ? "default" : "pointer"};">${escapeHtml(category.name || "Category")}</button>
        </div>
        <div class="ff-products-cat-services" data-cat-id="${escapeHtml(catId)}" style="display:${isOpen ? "flex" : "none"};flex-direction:column;gap:4px;">
          ${subgroupHtml}
          ${addSubBtn}
        </div>
      </div>
    `;
  }).join("");

  list.querySelectorAll(".ff-products-cat-toggle").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const catId = btn.getAttribute("data-cat-id");
      if (!catId) return;
      if (pstate.openProductCats.has(catId)) pstate.openProductCats.delete(catId); else pstate.openProductCats.add(catId);
      renderProductsSidebar();
    });
  });
  list.querySelectorAll(".ff-products-category-title").forEach((btn) => {
    if (btn.hasAttribute("disabled")) return;
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      closeProductsEditor();
      pstate.selectedCategoryId = btn.getAttribute("data-product-category-id");
      pstate.selectedProductId = null;
      pstate.activeTab = "details";
      renderProducts();
      _ffProductsMobileShowDetail("detail");
    });
  });
  list.querySelectorAll(".ff-products-sidebar-product").forEach((row) => {
    row.addEventListener("click", () => {
      closeProductsEditor();
      pstate.selectedProductId = row.getAttribute("data-product-id");
      pstate.selectedCategoryId = null;
      pstate.activeTab = "details";
      renderProducts();
      _ffProductsMobileShowDetail("detail");
    });
  });
  list.querySelectorAll(".ffcat-addproduct-btn").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const catId = btn.getAttribute("data-add-product-category-id");
      const subId = btn.getAttribute("data-add-product-sub-id") || null;
      if (catId) pstate.openProductCats.add(catId);
      ffProductsAddProduct(catId, subId);
    });
  });
  list.querySelectorAll(".ffcat-addsub-btn").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const catId = btn.getAttribute("data-add-sub-category-id");
      if (catId) {
        pstate.openProductCats.add(catId);
        ffProductsAddSubcategory(catId);
      }
    });
  });
  if (!ffCanManageProducts()) {
    list.querySelectorAll(".ffcat-addproduct-btn, .ffcat-addsub-btn").forEach((el) => { el.style.display = "none"; });
    list.querySelectorAll("[draggable=\"true\"]").forEach((el) => { el.removeAttribute("draggable"); });
  } else {
    wireProductsSidebarDragDrop(list);
  }
}

function _ffProdClearDragHover() {
  if (pstate._ffProdDragHoverEl) {
    pstate._ffProdDragHoverEl.style.boxShadow = "";
    pstate._ffProdDragHoverEl = null;
  }
}

// Drag-to-reorder products within a single category (mirrors the Services
// sidebar). Only products in the same category group can be reordered.
function wireProductsSidebarDragDrop(listEl) {
  if (!listEl) return;
  listEl.addEventListener("dragstart", (e) => {
    const handle = e.target.closest('.ff-products-drag-handle[draggable="true"]');
    if (!handle) return;
    const row = handle.closest(".ff-products-sidebar-product");
    pstate._ffProdDragSrc = {
      catId: handle.getAttribute("data-cat-id") || null,
      subId: handle.getAttribute("data-sub-id") || "",
      productId: handle.getAttribute("data-product-id") || null,
    };
    try {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", pstate._ffProdDragSrc.productId || "");
    } catch (_) {}
    if (row) row.style.opacity = "0.4";
  });

  listEl.addEventListener("dragend", (e) => {
    const row = e.target.closest(".ff-products-sidebar-product");
    if (row) row.style.opacity = "";
    _ffProdClearDragHover();
    pstate._ffProdDragSrc = null;
  });

  listEl.addEventListener("dragover", (e) => {
    if (!pstate._ffProdDragSrc) return;
    const targetRow = e.target.closest(".ff-products-sidebar-product");
    if (
      !targetRow ||
      targetRow.getAttribute("data-product-id") === pstate._ffProdDragSrc.productId ||
      targetRow.getAttribute("data-cat-id") !== pstate._ffProdDragSrc.catId ||
      (targetRow.getAttribute("data-sub-id") || "") !== pstate._ffProdDragSrc.subId
    ) {
      if (pstate._ffProdDragHoverEl) _ffProdClearDragHover();
      return;
    }
    e.preventDefault();
    try { e.dataTransfer.dropEffect = "move"; } catch (_) {}
    if (targetRow !== pstate._ffProdDragHoverEl) {
      _ffProdClearDragHover();
      pstate._ffProdDragHoverEl = targetRow;
    }
    const rect = targetRow.getBoundingClientRect();
    const placeAfter = e.clientY > rect.top + rect.height / 2;
    targetRow.dataset.dropPosition = placeAfter ? "after" : "before";
    targetRow.style.boxShadow = placeAfter
      ? "inset 0 -2px 0 0 #7c3aed"
      : "inset 0 2px 0 0 #7c3aed";
  });

  listEl.addEventListener("drop", async (e) => {
    if (!pstate._ffProdDragSrc) return;
    const targetRow = e.target.closest(".ff-products-sidebar-product");
    const src = pstate._ffProdDragSrc;
    _ffProdClearDragHover();
    pstate._ffProdDragSrc = null;
    if (
      !targetRow ||
      targetRow.getAttribute("data-product-id") === src.productId ||
      targetRow.getAttribute("data-cat-id") !== src.catId ||
      (targetRow.getAttribute("data-sub-id") || "") !== src.subId
    ) {
      return;
    }
    e.preventDefault();
    try {
      await reorderProductWithinCategory(
        src.productId,
        targetRow.getAttribute("data-product-id"),
        src.catId,
        targetRow.dataset.dropPosition === "after",
        src.subId
      );
      await loadProductsCatalog();
      renderProducts();
    } catch (err) {
      console.error("[Products] Reorder failed", err);
    }
  });
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
        target.textContent = "Unable to save this product setup right now.";
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

// TODO (future): Performance tab — Units Sold, Revenue, Product Commission Paid,
// Current Stock, Last Sold. Not implemented yet; requires Tickets/Payroll wiring.

function renderProductsDetail() {
  const placeholder = document.getElementById("productsDetailPlaceholder");
  const container = document.getElementById("productsDetailContainer");
  const header = document.getElementById("productsDetailHeader");
  const nav = document.getElementById("productsDetailNav");
  const content = document.getElementById("productsDetailTabContent");
  if (!placeholder || !container || !header || !nav || !content) return;
  const product = pstate.products.find((item) => String(item.id) === String(pstate.selectedProductId || ""));
  const category = pstate.productCategories.find((cat) => String(cat.id) === String(pstate.selectedCategoryId || ""));
  const creatingProduct = pstate.editorState && pstate.editorState.mode === "product";
  const creatingCategory = pstate.editorState && pstate.editorState.mode === "category";
  if (creatingProduct) {
    placeholder.style.display = "none";
    container.style.display = "block";
    const draftCategory = pstate.productCategories.find((cat) => String(cat.id) === String(pstate.editorState.categoryId || ""));
    header.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:8px 0 4px;">
        <div>
          <h2 style="margin:0 0 4px;font-size:22px;line-height:1.2;color:#111827;">New Product</h2>
          <div style="font-size:13px;color:#6b7280;">${escapeHtml(draftCategory ? `Under ${draftCategory.name || "Category"}` : "Product setup")}</div>
        </div>
      </div>
    `;
    nav.innerHTML = renderTabButton("details", "Details");
    content.innerHTML = renderNewProductForm(pstate.editorState.categoryId, pstate.editorState.subcategoryId);
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
      pstate.activeTab = btn.getAttribute("data-products-tab") || "details";
      renderProductsDetail();
      _ffProductsMobileShowDetail("tab");
    });
  });
  if (category && !product) {
    content.innerHTML = renderCategoryDetails(category);
    wireCategoryForm(category);
    return;
  }
  if (pstate.activeTab === "locations") {
    content.innerHTML = renderProductLocationsTab(product);
    wireProductLocationsTab(content, product);
  } else if (pstate.activeTab === "staff") {
    content.innerHTML = renderProductStaffTab(product);
    wireProductStaffTab(content, product);
  } else if (pstate.activeTab === "inventory") {
    content.innerHTML = renderProductInventoryTab(product);
    wireProductInventoryTab(content, product);
  } else {
    content.innerHTML = renderProductDetails(product);
    wireProductForm(product);
  }
}

function renderProducts() {
  const addCatBtn = document.getElementById("productsAddCategoryBtn");
  if (addCatBtn) addCatBtn.style.display = ffCanManageProducts() ? "flex" : "none";
  renderProductsSidebar();
  renderProductsDetail();
  _ffApplyProductsReadonlyState();
}

// When the user can view but not manage products, make the detail area
// read-only: disable inputs and hide any save/delete/edit buttons.
function _ffApplyProductsReadonlyState() {
  if (ffCanManageProducts()) return;
  const content = document.getElementById("productsDetailTabContent");
  if (content) {
    content.querySelectorAll("input, select, textarea").forEach((el) => {
      el.disabled = true;
      el.style.cursor = "not-allowed";
    });
    content.querySelectorAll("button").forEach((el) => { el.style.display = "none"; });
  }
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
        target.textContent = "Unable to save this product setup right now.";
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
  if (!ffCanViewProducts()) {
    if (typeof window.showToast === "function") window.showToast("You do not have permission to view Products.", "error");
    return;
  }
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
  if (!pstate.selectedProductId && !pstate.selectedCategoryId) {
    pstate.selectedProductId = pstate.products[0]?.id || null;
    pstate.selectedCategoryId = pstate.selectedProductId ? null : (pstate.productCategories[0]?.id || null);
  }
  renderProducts();
  // Mobile: always open at the top level (the products list).
  _ffProductsMobileShowList();
}

window.goToProducts = goToProducts;
window.ffCloseProductsScreen = ffCloseProductsScreen;
window.ffProductsAddCategory = ffProductsAddCategory;
window.ffProductsAddProduct = ffProductsAddProduct;
