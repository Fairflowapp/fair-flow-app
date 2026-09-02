// products-ui.js
// Pure presentational layer for the Products catalog screen: HTML builders and
// view helpers extracted verbatim from products.js (step 4 of the gradual split).
// One-way dependency: products.js -> products-ui.js -> { products-data.js,
// products-helpers.js, products-state.js }. No commands, no render orchestrators,
// no event-wiring that mutates Firestore live here.

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
  getProductInventory,
} from "./products-helpers.js?v=20260902_prod_cats";
import { pstate } from "./products-state.js?v=20260902_prod_cats";
import {
  findCategory,
  getCategorySubcategories,
  ffProductsActiveLocId,
} from "./products-data.js?v=20260902_prod_cats";

export function categoryName(categoryId) {
  const match = pstate.productCategories.find((cat) => String(cat.id) === String(categoryId));
  return match?.name || "Uncategorized";
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
export function ffWireProductToggles(scope) {
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

export function subcategoryOptionsHtml(catId, selectedSubId) {
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

// Nested grouping: each category → ordered subcategory groups (+ a trailing
// "General" group for products without a subcategory). Plus an Uncategorized
// catch-all for products whose category was deleted.
export function groupedProductsNested() {
  const known = new Set(pstate.productCategories.map((c) => String(c.id)));
  const groups = pstate.productCategories.map((cat) => {
    const catId = String(cat.id);
    const catProducts = pstate.products.filter((p) => String(p.categoryId || "") === catId);
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
  const uncategorized = pstate.products.filter((p) => !p.categoryId || !known.has(String(p.categoryId)));
  if (uncategorized.length) {
    groups.push({
      category: { id: "__uncategorized__", name: "Uncategorized" },
      subgroups: [{ sub: null, products: uncategorized }],
      hasRealSubs: false,
    });
  }
  return groups;
}

export function renderProductSidebarRow(product, catId, subId) {
  const selected = String(pstate.selectedProductId || "") === String(product.id);
  const productOpacity = product.active === false ? "opacity:0.62;" : "";
  return `
    <div class="staff-sidebar-item ff-products-sidebar-product${selected ? " is-selected" : ""}" data-product-id="${escapeHtml(product.id)}" data-cat-id="${escapeHtml(catId)}" data-sub-id="${escapeHtml(subId || "")}" style="width:100%;display:flex;align-items:center;gap:6px;padding:8px 8px;border:none;border-radius:6px;background:${selected ? "#ede9fe" : "transparent"};cursor:pointer;text-align:left;${productOpacity}">
      <span class="ff-products-drag-handle" draggable="true" data-product-id="${escapeHtml(product.id)}" data-cat-id="${escapeHtml(catId)}" data-sub-id="${escapeHtml(subId || "")}" title="Drag to reorder" style="color:#9ca3af;font-size:12px;line-height:1;cursor:grab;user-select:none;flex-shrink:0;">\u22EE\u22EE</span>
      <span style="font-size:12px;color:#111827;line-height:1.25;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(product.name || "Untitled Product")}</span>
    </div>`;
}

export function renderTabButton(tab, label) {
  const active = pstate.activeTab === tab;
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

export function renderProductDetails(product) {
  const categoryOptions = [
    '<option value="">Uncategorized</option>',
    ...pstate.productCategories.map((cat) => `<option value="${escapeHtml(cat.id)}" ${String(product.categoryId || "") === String(cat.id) ? "selected" : ""}>${escapeHtml(cat.name || "")}</option>`),
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

export function renderNewProductForm(categoryId, subcategoryId) {
  const categoryOptions = [
    '<option value="">Uncategorized</option>',
    ...pstate.productCategories.map((cat) => `<option value="${escapeHtml(cat.id)}" ${String(categoryId || "") === String(cat.id) ? "selected" : ""}>${escapeHtml(cat.name || "")}</option>`),
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

export function renderCategoryDetails(category) {
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

export function renderProductLocationsTab(product) {
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

export function renderProductStaffTab(product) {
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

export function renderProductInventoryTab(product) {
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
