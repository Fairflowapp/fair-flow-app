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

let productCategories = [];
let products = [];
let selectedCategoryId = null;
let selectedProductId = null;
let activeTab = "details";
let editorState = null;
let productsCatalogError = "";
let openProductCats = new Set();

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
let productsSidebarRenderedOnce = false;
let _ffProdDragSrc = null;
let _ffProdDragHoverEl = null;

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
function ffCanManageProducts() {
  try {
    if (typeof window.ffCurrentUserHasProductsManagePermission === "function") {
      return window.ffCurrentUserHasProductsManagePermission();
    }
  } catch (e) {}
  return true;
}
function ffProductsManageError() {
  return new Error("You do not have permission to manage products.");
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

// Toggle switch markup that reuses the app-wide slider style (the same one the
// Services staff tab uses), so Products and Services look consistent. The
// hidden checkbox keeps the given class so existing wiring can read .checked.
function ffProductToggle(checkboxClass, on) {
  return `
    <label class="ff-products-toggle staff-permission-toggle" style="flex:0 0 auto;" title="${on ? "Available" : "Not available"}">
      <input type="checkbox" class="${escapeHtml(checkboxClass)}" ${on ? "checked" : ""}>
      <span class="staff-permission-toggle-slider"></span>
    </label>
  `;
}

// Gray out a location/staff card when its toggle is OFF (and restore on ON).
// Dims the body + title and disables interaction, but leaves the toggle usable.
function ffApplyProductCardState(card, enabled) {
  if (!card) return;
  const isStaff = card.classList.contains("ff-products-staff-card");
  card.style.background = enabled ? "#fff" : "#f9fafb";
  const body = card.querySelector(".ff-products-card-body");
  if (body) {
    body.style.opacity = enabled ? "1" : "0.45";
    body.style.pointerEvents = enabled ? "auto" : "none";
  }
  const title = card.querySelector(".ff-products-card-title");
  if (title) {
    if (isStaff) {
      title.style.opacity = enabled ? "1" : "0.55";
      const nameEl = title.querySelector("div");
      if (nameEl) nameEl.style.color = enabled ? "#111827" : "#9ca3af";
    } else {
      title.style.color = enabled ? "#111827" : "#9ca3af";
    }
  }
}

// The slider visual is handled by CSS (.staff-permission-toggle). Here we only
// gray out the surrounding card when the toggle is OFF.
function ffWireProductToggles(scope) {
  (scope || document).querySelectorAll(".ff-products-toggle").forEach((label) => {
    if (label.__ffToggleWired) return;
    label.__ffToggleWired = true;
    const cb = label.querySelector('input[type="checkbox"]');
    if (!cb) return;
    const card = label.closest(".ff-products-location-card, .ff-products-staff-card");
    cb.addEventListener("change", () => {
      label.title = cb.checked ? "Available" : "Not available";
      ffApplyProductCardState(card, cb.checked);
    });
  });
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

function findCategory(catId) {
  return productCategories.find((c) => String(c.id) === String(catId)) || null;
}

function getCategorySubcategories(cat) {
  const arr = cat && Array.isArray(cat.subcategories) ? cat.subcategories : [];
  return arr.slice().sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
}

function subcategoryOptionsHtml(catId, selectedSubId) {
  const cat = findCategory(catId);
  const subs = cat ? getCategorySubcategories(cat) : [];
  const opts = [`<option value="" ${!selectedSubId ? "selected" : ""}>General (no subcategory)</option>`];
  for (const s of subs) {
    opts.push(
      `<option value="${escapeHtml(s.id)}" ${String(selectedSubId || "") === String(s.id) ? "selected" : ""}>${escapeHtml(s.name || "")}</option>`
    );
  }
  return opts.join("");
}

function genSubId() {
  return `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// Nested grouping: each category → ordered subcategory groups (+ a trailing
// "General" group for products without a subcategory). Plus an Uncategorized
// catch-all for products whose category was deleted.
function groupedProductsNested() {
  const known = new Set(productCategories.map((c) => String(c.id)));
  const groups = productCategories.map((cat) => {
    const catId = String(cat.id);
    const catProducts = products.filter((p) => String(p.categoryId || "") === catId);
    const subs = getCategorySubcategories(cat);
    const subIds = new Set(subs.map((s) => String(s.id)));
    const subgroups = subs.map((s) => ({
      sub: { id: String(s.id), name: s.name || "Subcategory" },
      products: catProducts.filter((p) => String(p.subcategoryId || "") === String(s.id)),
    }));
    const generalProducts = catProducts.filter(
      (p) => !p.subcategoryId || !subIds.has(String(p.subcategoryId))
    );
    if (generalProducts.length || !subs.length) {
      subgroups.push({ sub: null, products: generalProducts });
    }
    return { category: cat, subgroups, hasRealSubs: subs.length > 0 };
  });
  const uncategorized = products.filter((p) => !p.categoryId || !known.has(String(p.categoryId)));
  if (uncategorized.length) {
    groups.push({
      category: { id: "__uncategorized__", name: "Uncategorized" },
      subgroups: [{ sub: null, products: uncategorized }],
      hasRealSubs: false,
    });
  }
  return groups;
}

function renderProductSidebarRow(product, catId, subId) {
  const selected = String(selectedProductId || "") === String(product.id);
  const productOpacity = product.active === false ? "opacity:0.62;" : "";
  return `
    <div class="staff-sidebar-item ff-products-sidebar-product${selected ? " is-selected" : ""}" data-product-id="${escapeHtml(product.id)}" data-cat-id="${escapeHtml(catId)}" data-sub-id="${escapeHtml(subId || "")}" style="width:100%;display:flex;align-items:center;gap:6px;padding:8px 8px;border:none;border-radius:6px;background:${selected ? "#ede9fe" : "transparent"};cursor:pointer;text-align:left;${productOpacity}">
      <span class="ff-products-drag-handle" draggable="true" data-product-id="${escapeHtml(product.id)}" data-cat-id="${escapeHtml(catId)}" data-sub-id="${escapeHtml(subId || "")}" title="Drag to reorder" style="color:#9ca3af;font-size:12px;line-height:1;cursor:grab;user-select:none;flex-shrink:0;">\u22EE\u22EE</span>
      <span style="font-size:12px;color:#111827;line-height:1.25;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(product.name || "Untitled Product")}</span>
    </div>`;
}

function renderProductsSidebar() {
  const list = document.getElementById("productsCatalogList");
  if (!list) return;
  const groups = groupedProductsNested();
  if (productsCatalogError) {
    list.innerHTML = `<div style="padding:12px 20px;font-size:12px;color:#b45309;line-height:1.45;">${escapeHtml(productsCatalogError)}</div>`;
    return;
  }
  if (!groups.length) {
    list.innerHTML = '<div style="padding:12px 20px;font-size:12px;color:#9ca3af;line-height:1.45;">No products yet. Add a category to get started.</div>';
    return;
  }
  // On first render, expand every category (matches the Services sidebar).
  if (!productsSidebarRenderedOnce && openProductCats.size === 0 && groups.length) {
    groups.forEach((g) => openProductCats.add(String(g.category.id)));
  }
  productsSidebarRenderedOnce = true;

  list.innerHTML = groups.map(({ category, subgroups, hasRealSubs }) => {
    const catId = String(category.id);
    const catSelected = String(selectedCategoryId || "") === catId;
    const isOpen = openProductCats.has(catId);
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
      if (openProductCats.has(catId)) openProductCats.delete(catId); else openProductCats.add(catId);
      renderProductsSidebar();
    });
  });
  list.querySelectorAll(".ff-products-category-title").forEach((btn) => {
    if (btn.hasAttribute("disabled")) return;
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      closeProductsEditor();
      selectedCategoryId = btn.getAttribute("data-product-category-id");
      selectedProductId = null;
      activeTab = "details";
      renderProducts();
      _ffProductsMobileShowDetail("detail");
    });
  });
  list.querySelectorAll(".ff-products-sidebar-product").forEach((row) => {
    row.addEventListener("click", () => {
      closeProductsEditor();
      selectedProductId = row.getAttribute("data-product-id");
      selectedCategoryId = null;
      activeTab = "details";
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
      if (catId) openProductCats.add(catId);
      ffProductsAddProduct(catId, subId);
    });
  });
  list.querySelectorAll(".ffcat-addsub-btn").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const catId = btn.getAttribute("data-add-sub-category-id");
      if (catId) {
        openProductCats.add(catId);
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
  if (_ffProdDragHoverEl) {
    _ffProdDragHoverEl.style.boxShadow = "";
    _ffProdDragHoverEl = null;
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
    _ffProdDragSrc = {
      catId: handle.getAttribute("data-cat-id") || null,
      subId: handle.getAttribute("data-sub-id") || "",
      productId: handle.getAttribute("data-product-id") || null,
    };
    try {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", _ffProdDragSrc.productId || "");
    } catch (_) {}
    if (row) row.style.opacity = "0.4";
  });

  listEl.addEventListener("dragend", (e) => {
    const row = e.target.closest(".ff-products-sidebar-product");
    if (row) row.style.opacity = "";
    _ffProdClearDragHover();
    _ffProdDragSrc = null;
  });

  listEl.addEventListener("dragover", (e) => {
    if (!_ffProdDragSrc) return;
    const targetRow = e.target.closest(".ff-products-sidebar-product");
    if (
      !targetRow ||
      targetRow.getAttribute("data-product-id") === _ffProdDragSrc.productId ||
      targetRow.getAttribute("data-cat-id") !== _ffProdDragSrc.catId ||
      (targetRow.getAttribute("data-sub-id") || "") !== _ffProdDragSrc.subId
    ) {
      if (_ffProdDragHoverEl) _ffProdClearDragHover();
      return;
    }
    e.preventDefault();
    try { e.dataTransfer.dropEffect = "move"; } catch (_) {}
    if (targetRow !== _ffProdDragHoverEl) {
      _ffProdClearDragHover();
      _ffProdDragHoverEl = targetRow;
    }
    const rect = targetRow.getBoundingClientRect();
    const placeAfter = e.clientY > rect.top + rect.height / 2;
    targetRow.dataset.dropPosition = placeAfter ? "after" : "before";
    targetRow.style.boxShadow = placeAfter
      ? "inset 0 -2px 0 0 #7c3aed"
      : "inset 0 2px 0 0 #7c3aed";
  });

  listEl.addEventListener("drop", async (e) => {
    if (!_ffProdDragSrc) return;
    const targetRow = e.target.closest(".ff-products-sidebar-product");
    const src = _ffProdDragSrc;
    _ffProdClearDragHover();
    _ffProdDragSrc = null;
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

async function reorderProductWithinCategory(srcId, targetProductId, categoryId, placeAfter, subId) {
  const salonId = getSalonId();
  if (!salonId) return;
  const catKey = String(categoryId || "");
  const subKey = String(subId || "");
  const src = products.find((p) => String(p.id) === String(srcId));
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
        ? !p.categoryId || !productCategories.some((c) => String(c.id) === pc)
        : pc === catKey;
    return catMatch && productSubKey(p) === subKey;
  };
  const siblings = products
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
  editorState = null;
  removeProductsEditorModal();
}

function renderProductsEditor() {
  removeProductsEditorModal();
  if (!editorState) return;
  const screen = document.getElementById("productsScreen");
  if (!screen) return;
  const isProduct = editorState.mode === "product";
  const isSubcategory = editorState.mode === "subcategory";
  const category = productCategories.find((cat) => String(cat.id) === String(editorState.categoryId || ""));
  const editorSubtitle = isProduct
    ? `Create a product${category ? ` under ${category.name || "Category"}` : ""}.`
    : isSubcategory
      ? `Add a subcategory${category ? ` under ${category.name || "Category"}` : ""}.`
      : "Create a product category.";
  const editorTitle = isProduct ? "Add Product" : isSubcategory ? "Add Subcategory" : "Add Category";
  const nameLabel = isProduct ? "Product Name" : isSubcategory ? "Subcategory Name" : "Category Name";
  const categoryOptions = productCategories.map((cat) => (
    `<option value="${escapeHtml(cat.id)}" ${String(cat.id) === String(editorState.categoryId || "") ? "selected" : ""}>${escapeHtml(cat.name || "")}</option>`
  )).join("");
  const subcategoryOptions = subcategoryOptionsHtml(editorState.categoryId, editorState.subcategoryId);
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
        await createSubcategory(editorState.categoryId, name);
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
  const field = "padding:6px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;";
  const labelCss = "display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:700;color:#374151;";
  return `
    <form id="productsDetailsForm" style="padding:12px 14px;background:#fff;border:1px solid var(--border);border-radius:12px;max-width:680px;">
      <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:10px;">Details</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:9px 10px;">
        <label style="${labelCss}grid-column:1/-1;">Product Name
          <input name="name" value="${escapeHtml(product.name || "")}" style="${field}">
        </label>
        <label style="${labelCss}">Category
          <select name="categoryId" data-products-detail-category style="${field}background:#fff;">${categoryOptions}</select>
        </label>
        <label style="${labelCss}">Subcategory
          <select name="subcategoryId" data-products-detail-subcategory style="${field}background:#fff;">${subcategoryOptionsHtml(product.categoryId, product.subcategoryId)}</select>
        </label>
        <label style="${labelCss}">Brand
          <input name="brand" value="${escapeHtml(product.brand || "")}" style="${field}">
        </label>
        <label style="${labelCss}">Vendor / Supplier
          <input name="vendor" value="${escapeHtml(product.vendor || "")}" placeholder="e.g. OPI, SalonCentric, Amazon" style="${field}">
        </label>
        <label style="${labelCss}">Retail Price
          <input name="retailPrice" type="number" min="0" step="0.01" value="${escapeHtml(String(product.retailPrice ?? ""))}" style="${field}">
        </label>
        <label style="${labelCss}">Cost Price
          <input name="costPrice" type="number" min="0" step="0.01" value="${escapeHtml(String(product.costPrice ?? ""))}" style="${field}">
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:#374151;">
          <input name="taxable" type="checkbox" ${product.taxable === true ? "checked" : ""} style="accent-color:#7c3aed;">
          Charge tax
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:#374151;">
          <input name="active" type="checkbox" ${product.active === false ? "" : "checked"} style="accent-color:#7c3aed;">
          Active
        </label>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:12px;">
        <button type="submit" style="padding:7px 14px;border:1px solid #7c3aed;background:#7c3aed;color:#fff;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">Save</button>
        <span id="productsDetailsSaved" style="font-size:12px;color:#10b981;opacity:0;transition:opacity .18s;">Saved</span>
        <button type="button" data-products-delete style="margin-left:auto;padding:7px 14px;border:1px solid #fecaca;background:#fff;color:#dc2626;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">Delete product</button>
      </div>
    </form>
  `;
}

function renderNewProductForm(categoryId, subcategoryId) {
  const categoryOptions = [
    '<option value="">Uncategorized</option>',
    ...productCategories.map((cat) => `<option value="${escapeHtml(cat.id)}" ${String(categoryId || "") === String(cat.id) ? "selected" : ""}>${escapeHtml(cat.name || "")}</option>`),
  ].join("");
  return `
    <form id="productsNewProductForm" style="padding:14px;background:#fff;border:1px solid var(--border);border-radius:12px;display:flex;flex-direction:column;gap:10px;max-width:680px;">
      <div>
        <div style="font-size:14px;font-weight:800;color:#111827;">New Product</div>
        <p style="margin:4px 0 0;color:#6b7280;font-size:12px;line-height:1.45;">Create the product details here. Inventory, tickets, and commission are not connected yet.</p>
      </div>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Product Name
        <input name="name" autofocus style="padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;">
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Category
        <select name="categoryId" data-products-detail-category style="padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;background:#fff;">${categoryOptions}</select>
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Subcategory
        <select name="subcategoryId" data-products-detail-subcategory style="padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;background:#fff;">${subcategoryOptionsHtml(categoryId, subcategoryId)}</select>
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
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Cost Price
        <input name="costPrice" type="number" min="0" step="0.01" value="0" style="padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;">
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
    <form id="productsCategoryForm" style="padding:14px;background:#fff;border:1px solid var(--border);border-radius:12px;display:flex;flex-direction:column;gap:10px;max-width:680px;">
      <div style="font-size:14px;font-weight:700;color:#111827;">Category Details</div>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Category Name
        <input name="name" value="${escapeHtml(category.name || "")}" style="padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;">
      </label>
      <div style="display:flex;gap:8px;align-items:center;">
        <button type="submit" style="padding:7px 14px;border:1px solid #7c3aed;background:#7c3aed;color:#fff;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">Save</button>
        <span id="productsCategorySaved" style="font-size:12px;color:#10b981;opacity:0;transition:opacity .18s;">Saved</span>
        <button type="button" data-products-delete-category style="margin-left:auto;padding:7px 14px;border:1px solid #fecaca;background:#fff;color:#dc2626;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">Delete category</button>
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
      <div class="ff-products-location-card" data-location-id="${escapeHtml(loc.id)}" style="border:1px solid var(--border);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;background:${enabled ? "#fff" : "#f9fafb"};transition:background .18s ease;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <div class="ff-products-card-title" style="font-size:13px;font-weight:700;color:${enabled ? "#111827" : "#9ca3af"};transition:color .18s ease;">${escapeHtml(loc.name || loc.label || "Location")}</div>
          ${ffProductToggle("ff-products-location-enabled", enabled)}
        </div>
        <div class="ff-products-card-body" style="display:flex;flex-direction:column;gap:8px;opacity:${enabled ? "1" : "0.45"};pointer-events:${enabled ? "auto" : "none"};transition:opacity .18s ease;">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
            <label style="flex:1;min-width:140px;display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Retail Price${hasPriceOverride ? " (Override)" : ` (Default ${escapeHtml(formatMoney(basePrice))})`}
              <input type="number" min="0" step="0.01" class="ff-products-location-price" value="${escapeHtml(String(shownPrice))}" style="padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;">
            </label>
            <label style="flex:1;min-width:120px;display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Current Stock
              <input type="number" min="0" step="1" class="ff-products-location-stock" value="${escapeHtml(String(stock))}" style="padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;">
            </label>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <button type="button" class="ff-products-location-save" style="padding:7px 14px;border:1px solid #7c3aed;background:#7c3aed;color:#fff;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">Save</button>
            ${hasPriceOverride ? '<button type="button" class="ff-products-location-reset" style="padding:7px 14px;border:1px solid #e5e7eb;background:#fff;color:#374151;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer;">Reset price to default</button>' : ""}
            <span class="ff-products-location-saved" style="font-size:12px;color:#10b981;opacity:0;transition:opacity .18s;">Saved</span>
          </div>
        </div>
      </div>
    `;
  }).join("");
  return `
    <div style="display:flex;flex-direction:column;gap:8px;max-width:680px;">
      <div style="margin-bottom:2px;">
        <div style="font-size:14px;font-weight:800;color:#111827;">Locations</div>
        <p style="margin:3px 0 0;color:#6b7280;font-size:12px;line-height:1.4;">Default price comes from Details. Set a per-location override when it differs.</p>
      </div>
      ${cards}
    </div>
  `;
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

async function saveProductLocationOverride(productId, locationId, override) {
  if (!ffCanManageProducts()) throw ffProductsManageError();
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

// Default product commission inherits from the staff member's Earnings Rules
// (Staff Member -> Earnings Rules -> Product Commission). Supports both the
// new { type, value } shape and the legacy { basicPercent } shape.
function getStaffDefaultProductCommission(staff) {
  const rules = staff && staff.earningsRules && typeof staff.earningsRules === "object" ? staff.earningsRules : {};
  const pc = rules.productCommission && typeof rules.productCommission === "object" ? rules.productCommission : {};
  if (pc.enabled !== true) return null;
  const type = pc.type === "fixed" ? "fixed" : "percentage";
  const raw = Number(pc.value != null ? pc.value : pc.basicPercent);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return { type, value: raw };
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
      <div class="ff-products-staff-card" data-staff-id="${escapeHtml(staffId)}" style="padding:10px 12px;background:${enabled ? "#fff" : "#f9fafb"};border:1px solid var(--border);border-radius:12px;transition:background .18s ease;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px;">
          <div class="ff-products-card-title" style="min-width:0;${enabled ? "" : "opacity:0.55;"}transition:opacity .18s ease;">
            <div style="font-size:13px;font-weight:700;color:${enabled ? "#111827" : "#9ca3af"};line-height:1.25;">${escapeHtml(getStaffProductName(staff))}</div>
            <div style="margin-top:2px;font-size:11px;color:#6b7280;">${enabled ? "Available for this product" : "Not available for this product"}</div>
          </div>
          ${ffProductToggle("ff-products-staff-enabled", enabled)}
        </div>
        <div class="ff-products-card-body" style="display:grid;grid-template-columns:100px minmax(110px,170px) minmax(70px,100px) auto;gap:8px;align-items:center;opacity:${enabled ? "1" : "0.45"};pointer-events:${enabled ? "auto" : "none"};transition:opacity .18s ease;">
          <div style="font-size:12px;color:#6b7280;">Commission</div>
          <input type="number" min="0" step="0.01" class="ff-products-staff-commission-value" placeholder="${escapeHtml(defLabel)}" value="${escapeHtml(cValue)}" style="width:100%;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;box-sizing:border-box;">
          <select class="ff-products-staff-commission-type" style="width:100%;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;background:#fff;box-sizing:border-box;">
            <option value="percentage" ${cType === "percentage" ? "selected" : ""}>%</option>
            <option value="fixed" ${cType === "fixed" ? "selected" : ""}>$</option>
          </select>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <button type="button" class="ff-products-staff-save" style="padding:5px 10px;background:#7c3aed;color:#fff;border:1px solid #7c3aed;border-radius:999px;cursor:pointer;font-size:11px;font-weight:700;line-height:1.2;">Save</button>
            <span class="ff-products-staff-saved" style="font-size:11px;color:#10b981;opacity:0;transition:opacity .18s;">Saved</span>
            <span style="font-size:11px;color:${hasOverride ? "#7c3aed" : "#9ca3af"};">${hasOverride ? "Override" : escapeHtml(defLabel)}</span>
          </div>
        </div>
      </div>
    `;
  }).join("");
  return `
    <div style="display:flex;flex-direction:column;gap:8px;max-width:680px;">
      <div style="margin-bottom:2px;">
        <div style="font-size:14px;font-weight:800;color:#111827;">Staff</div>
        <p style="margin:3px 0 0;color:#6b7280;font-size:12px;line-height:1.4;">Product commission inherits from each staff member's Earnings Rules. Enter a value to override for this product.</p>
      </div>
      ${cards}
    </div>
  `;
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

async function saveProductStaffOverride(productId, staffId, override) {
  if (!ffCanManageProducts()) throw ffProductsManageError();
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

async function ffStaffProductsLoadForStaffMember() {
  await loadProductsCatalog();
  return {
    products: products.slice(),
    categories: productCategories.slice(),
  };
}

async function ffStaffProductsSaveOverrideForStaffMember(productId, staffId, override) {
  await loadProductsCatalog();
  const product = products.find((p) => String(p.id) === String(productId));
  if (!product) throw new Error("Product not found");
  await saveProductStaffOverride(productId, staffId, override || {});
  return product;
}

function ffStaffProductsGetOverrideForStaffMember(product, staffId) {
  const overrides = getProductStaffOverrides(product);
  return overrides && overrides[staffId] && typeof overrides[staffId] === "object"
    ? overrides[staffId]
    : {};
}

function ffStaffProductsDefaultsForStaffMember(staff, product) {
  return {
    price: Number(product?.retailPrice) || 0,
    commission: getStaffDefaultProductCommission(staff),
  };
}

if (typeof window !== "undefined") {
  window.ffStaffProductsLoadForStaffMember = ffStaffProductsLoadForStaffMember;
  window.ffStaffProductsSaveOverrideForStaffMember = ffStaffProductsSaveOverrideForStaffMember;
  window.ffStaffProductsGetOverrideForStaffMember = ffStaffProductsGetOverrideForStaffMember;
  window.ffStaffProductsDefaultsForStaffMember = ffStaffProductsDefaultsForStaffMember;
  window.ffStaffProductsMoney = formatMoney;
  window.ffStaffProductsEscapeHtml = escapeHtml;
}

// ===== Inventory tab (save/load only — no automatic reordering or stock math) =====
function getProductInventory(product) {
  return product && product.inventory && typeof product.inventory === "object" ? product.inventory : {};
}

// The currently active branch/location id (shared with the Inventory app).
function ffProductsActiveLocId() {
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

// Inventory values honoring the active-location override (matches the Inventory
// app + reorder-point scan, which both prefer locationOverrides[activeLoc]).
function getProductInventoryEffective(product) {
  const base = getProductInventory(product);
  const loc = ffProductsActiveLocId();
  const locO = loc && product && product.locationOverrides
      && product.locationOverrides[loc] && typeof product.locationOverrides[loc] === "object"
    ? product.locationOverrides[loc]
    : null;
  const pick = (key) => {
    if (locO && Number.isFinite(Number(locO[key]))) return Number(locO[key]);
    return Number.isFinite(Number(base[key])) ? Number(base[key]) : undefined;
  };
  const vendor = (locO && locO.vendor != null && String(locO.vendor).trim())
    ? locO.vendor
    : (base.vendor || "");
  return { stock: pick("stock"), targetStock: pick("targetStock"), reorderPoint: pick("reorderPoint"), vendor };
}

function renderProductInventoryTab(product) {
  const inv = getProductInventoryEffective(product);
  const stockNum = Number.isFinite(Number(inv.stock)) ? Number(inv.stock) : 0;
  const stock = Number.isFinite(Number(inv.stock)) ? Number(inv.stock) : "";
  const targetStock = Number.isFinite(Number(inv.targetStock)) ? Number(inv.targetStock) : "";
  const reorderPoint = Number.isFinite(Number(inv.reorderPoint)) ? Number(inv.reorderPoint) : "";
  const costPrice = moneyValue(product.costPrice);
  const inventoryValue = stockNum * costPrice;
  return `
    <form id="productsInventoryForm" style="padding:14px;background:#fff;border:1px solid var(--border);border-radius:12px;display:flex;flex-direction:column;gap:10px;max-width:680px;">
      <div>
        <div style="font-size:14px;font-weight:800;color:#111827;">Inventory</div>
        <p style="margin:4px 0 0;color:#6b7280;font-size:12px;line-height:1.45;">Current Stock = how many you have now. Target Stock = how many you want to keep. The Inventory app uses these to calculate what to order.</p>
      </div>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Current Stock
        <input name="stock" type="number" min="0" step="1" value="${escapeHtml(String(stock))}" style="padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;">
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Target Stock
        <input name="targetStock" type="number" min="0" step="1" value="${escapeHtml(String(targetStock))}" placeholder="How many you want in stock" style="padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;">
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Reorder Point
        <input name="reorderPoint" type="number" min="0" step="1" value="${escapeHtml(String(reorderPoint))}" style="padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;">
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#374151;">Vendor
        <input name="vendor" value="${escapeHtml(inv.vendor || "")}" style="padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;">
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

async function saveProductInventory(productId, inventory) {
  if (!ffCanManageProducts()) throw ffProductsManageError();
  const salonId = getSalonId();
  if (!salonId) throw new Error("No salon");
  const prod = products.find((p) => String(p.id) === String(productId));
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
    content.innerHTML = renderNewProductForm(editorState.categoryId, editorState.subcategoryId);
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
      _ffProductsMobileShowDetail("tab");
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
    sortOrder: productCategories.length,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  selectedCategoryId = ref.id;
  selectedProductId = null;
  activeTab = "details";
  editorState = null;
  openProductCats.add(String(ref.id));
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
  openProductCats.add(String(categoryId));
  editorState = null;
  await loadProductsCatalog();
  renderProducts();
}

async function deleteProduct(productId) {
  if (!ffCanManageProducts()) throw ffProductsManageError();
  const salonId = getSalonId();
  if (!salonId) throw new Error("No salon selected");
  await deleteDoc(doc(db, `salons/${salonId}/products`, String(productId)));
  selectedProductId = null;
  selectedCategoryId = null;
  activeTab = "details";
  await loadProductsCatalog();
  renderProducts();
}

async function deleteCategory(categoryId) {
  if (!ffCanManageProducts()) throw ffProductsManageError();
  const salonId = getSalonId();
  if (!salonId) throw new Error("No salon selected");
  await deleteDoc(doc(db, `salons/${salonId}/productCategories`, String(categoryId)));
  openProductCats.delete(String(categoryId));
  selectedCategoryId = null;
  selectedProductId = null;
  activeTab = "details";
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
    sortOrder: products.length,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  selectedProductId = ref.id;
  selectedCategoryId = null;
  activeTab = "details";
  editorState = null;
  openProductCats.add(String(payload?.categoryId || "__uncategorized__"));
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
    const count = products.filter((p) => String(p.categoryId || "") === String(category.id)).length;
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
  if (!ffCanManageProducts()) { if (typeof window.showToast === "function") window.showToast("You do not have permission to manage products.", "error"); return; }
  editorState = { mode: "category" };
  renderProductsEditor();
}

export function ffProductsAddProduct(categoryId, subcategoryId) {
  if (!ffCanManageProducts()) { if (typeof window.showToast === "function") window.showToast("You do not have permission to manage products.", "error"); return; }
  const resolvedCat = categoryId && categoryId !== "__uncategorized__" ? categoryId : (productCategories[0]?.id || null);
  editorState = {
    mode: "product",
    categoryId: resolvedCat,
    subcategoryId: subcategoryId || null,
  };
  selectedCategoryId = null;
  selectedProductId = null;
  activeTab = "details";
  renderProducts();
}

export function ffProductsAddSubcategory(categoryId) {
  if (!ffCanManageProducts()) { if (typeof window.showToast === "function") window.showToast("You do not have permission to manage products.", "error"); return; }
  if (!categoryId || categoryId === "__uncategorized__") return;
  editorState = { mode: "subcategory", categoryId };
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
  if (!selectedProductId && !selectedCategoryId) {
    selectedProductId = products[0]?.id || null;
    selectedCategoryId = selectedProductId ? null : (productCategories[0]?.id || null);
  }
  renderProducts();
  // Mobile: always open at the top level (the products list).
  _ffProductsMobileShowList();
}

window.goToProducts = goToProducts;
window.ffCloseProductsScreen = ffCloseProductsScreen;
window.ffProductsAddCategory = ffProductsAddCategory;
window.ffProductsAddProduct = ffProductsAddProduct;
