// products-screen.js
// Products screen — mobile drill-down, sidebar render + drag/drop, detail
// render, and screen navigation. Extracted verbatim from products.js.
// Editor/CRUD functions live in products-editor.js (static import here;
// the editor gets renderProducts injected via the products.js barrel).

import {
  escapeHtml,
  formatMoney,
} from "./products-helpers.js?v=20260902_prod_cats";
import { pstate } from "./products-state.js?v=20260902_prod_cats";
import {
  ffCanManageProducts,
  loadProductsCatalog,
  reorderProductWithinCategory,
} from "./products-data.js?v=20260902_prod_cats";
import {
  categoryName,
  groupedProductsNested,
  renderProductSidebarRow,
  renderTabButton,
  renderProductDetails,
  renderNewProductForm,
  renderCategoryDetails,
  renderProductLocationsTab,
  renderProductStaffTab,
  renderProductInventoryTab,
} from "./products-ui.js?v=20260902_prod_cats";
import {
  closeProductsEditor,
  renderProductsEditor,
  ffProductsAddCategory,
  ffProductsAddProduct,
  ffProductsAddSubcategory,
  wireCategoryForm,
  wireProductForm,
  wireNewProductForm,
  wireProductLocationsTab,
  wireProductStaffTab,
  wireProductInventoryTab,
} from "./products-editor.js?v=20260902_prod_cats";

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

if (typeof document !== "undefined" && !window.__ffProductsLocationListenerBound) {
  window.__ffProductsLocationListenerBound = true;
  const reloadProductsForLocation = async () => {
    try { closeProductsEditor(); } catch (_) {}
    pstate.products = [];
    pstate.productCategories = [];
    pstate.selectedProductId = null;
    pstate.selectedCategoryId = null;
    pstate.editorState = null;
    pstate.productsSidebarRenderedOnce = false;
    pstate.openProductCats.clear();
    const list = document.getElementById("productsCatalogList");
    if (list) list.innerHTML = "";
    const screen = document.getElementById("productsScreen");
    if (!screen || screen.style.display === "none") return;
    await loadProductsCatalog();
    pstate.selectedProductId = pstate.products[0]?.id || null;
    pstate.selectedCategoryId = pstate.selectedProductId ? null : (pstate.productCategories[0]?.id || null);
    renderProducts();
  };
  document.addEventListener("ff-active-location-changed", () => {
    reloadProductsForLocation().catch((err) => console.warn("[Products] location reload failed", err));
  });
  document.addEventListener("ff-product-share-changed", () => {
    reloadProductsForLocation().catch((err) => console.warn("[Products] share reload failed", err));
  });
}

export { renderProducts };
