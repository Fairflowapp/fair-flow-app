// inventory-catalog-ui.js
// Inventory > Catalog — Manage Categories drag/drop + sidebar and modal
// rendering. Extracted verbatim from inventory-catalog.js. Tree state and
// getters live in inventory-catalog-data.js.

import { invState } from "./inventory-state.js?v=20260902_inv_iso";
import {
  escapeHtml,
  renderInlineNewSub,
} from "./inventory-helpers.js?v=20260902_inv_iso";
import {
  getCategoryTree,
  getLegacyCategoryTreeForManage,
  getManageCategoryTree,
  ensureCatManageDraft,
} from "./inventory-catalog-data.js?v=20260902_prod_cats";

// ── injected inventory.js internals (set once via initCatalogUi) ──
let mountOrRefreshMockUi;

export function initCatalogUi(deps) {
  ({ mountOrRefreshMockUi } = deps);
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

function renderSidebarHtml() {
  if (invState._invCategoriesLoading) {
    return `<p class="ff-inv2-aside-loading">Loading categories…</p>`;
  }
  if (invState._invCatLoadError) {
    return `<p class="ff-inv2-aside-error">${escapeHtml(invState._invCatLoadError)}</p>
      <button type="button" class="ff-inv2-aside-add" style="margin:4px 12px;"
        onclick="window.goToInventory && window.goToInventory()">Retry</button>`;
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
  const sharedOn = !!invState._invUsingSharedCatalog;
  return `<div class="ff-inv2-cat-manage-footer">
  ${sharedOn ? "" : inlineNewCat}
  ${sharedOn ? "" : `<button type="button" class="ff-inv2-cat-manage-save" data-cat-manage-save="1"${saveBusy}>${saveLabel}</button>`}
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
          ${invState._invUsingSharedCatalog ? "" : `<button type="button" class="ff-inv2-cat-manage-add-head" data-cat-inline-newcat="1">+ Add Category</button>`}
        </div>
      </div>
      <button type="button" class="ff-inv2-cat-manage-close" data-cat-manage-close="1" aria-label="Close">×</button>
    </div>
    <p class="ff-inv2-cat-manage-subtitle">${invState._invUsingSharedCatalog ? "Shared catalog is on. Edit categories in Shared Setup — they appear in every location." : "Save to sync categories and subcategories to the cloud for this location."}</p>
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

export {
  bindCatManageDnDOnce,
  renderSidebarHtml,
  renderManageCategoriesModal,
  renderCategoryDeleteConfirmModal,
};
