// inventory-orders-builder.js
// Orders sub-app — builder. Extracted verbatim from inventory-orders.js.
// Shared state in inventory-state.js; orchestrator/back-edge deps injected via initOrdersBuilder().

import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import {
  doc,
  getDoc,
  collection,
  addDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { invState } from "./inventory-state.js?v=20260627_inventory_split";
import {
  escapeHtml,
  parseNum,
  parseSubcategoryDocToTable,
  buildOrderLinesFromGroupsRows,
  sortOrderBuilderLines,
  seedOrderBuilderSelectionIfEmpty,
  sanitizeManualItemForDraft,
} from "./inventory-helpers.js?v=20260627_inventory_split";
import { getCategoryTree } from "./inventory-catalog.js?v=20260702_inventory_catalog_split";
import { inventoryOrderDraftToast } from "./inventory-orders-core.js?v=20260702_inventory_catalog_split";
import { toggleShoppingRowQty } from "./inventory-orders-detail.js?v=20260702_inventory_catalog_split";
import { loadInventoryOrderDraft, scheduleInventoryOrderDraftSave } from "./inventory-orders-drafts.js?v=20260702_inventory_catalog_split";
import { handleInventoryOrderReceiptFileSelected } from "./inventory-orders-receipts.js?v=20260702_inventory_catalog_split";

// ── injected by initOrdersBuilder() (orchestrator spine + builder back-edges) ──
let getSalonId, mountOrRefreshMockUi, getSelectedSubMeta, fetchSubcategoryInventoryDoc, findCategoryAndSubForSubId, goToInventory;
export function initOrdersBuilder(deps) {
  ({ getSalonId, mountOrRefreshMockUi, getSelectedSubMeta, fetchSubcategoryInventoryDoc, findCategoryAndSubForSubId, goToInventory } = deps);
}


/** Apply persisted user edits to auto-generated preview line quantities. */
export function applyAutoQtyOverridesToLines(lines) {
  if (!Array.isArray(lines)) return lines;
  const ov = invState._invOrderBuilderAutoQtyOverrides;
  if (!ov || typeof ov !== "object") return lines;
  for (const line of lines) {
    if (!line || line.itemId == null) continue;
    const key = String(line.itemId);
    if (Object.prototype.hasOwnProperty.call(ov, key)) {
      const n = Number(ov[key]);
      if (Number.isFinite(n) && n >= 0) line.orderQty = n;
    }
  }
  return lines;
}

/** Drop override keys that no longer match any preview line (after category changes / refresh). */
export function pruneAutoQtyOverridesToExistingLines(lines) {
  if (!Array.isArray(lines) || !invState._invOrderBuilderAutoQtyOverrides) return;
  const ids = new Set(
    lines.map((l) => (l && l.itemId != null ? String(l.itemId) : "")).filter(Boolean)
  );
  for (const k of Object.keys(invState._invOrderBuilderAutoQtyOverrides)) {
    if (!ids.has(k)) delete invState._invOrderBuilderAutoQtyOverrides[k];
  }
}

export async function buildOrderPreviewLinesForSubIds(salonId, catId, subList, categoryName) {
  const subs = Array.isArray(subList) ? subList : [];
  const catNm = categoryName != null ? String(categoryName) : null;
  const tasks = subs.map(async (sub) => {
    const data = await fetchSubcategoryInventoryDoc(salonId, catId, sub.id);
    if (!data) return [];
    const { groups, rows } = parseSubcategoryDocToTable(data);
    return buildOrderLinesFromGroupsRows(groups, rows, sub.id, sub.name, catId, catNm);
  });
  const chunks = await Promise.all(tasks);
  return chunks.flat();
}

export async function buildOrderPreviewLinesForCustomSubIds(salonId, subIds) {
  const ids = Array.isArray(subIds) ? subIds : [];
  const tasks = ids.map(async (sid) => {
    const m = findCategoryAndSubForSubId(sid);
    if (!m) return [];
    const data = await fetchSubcategoryInventoryDoc(salonId, m.category.id, sid);
    if (!data) return [];
    const { groups, rows } = parseSubcategoryDocToTable(data);
    return buildOrderLinesFromGroupsRows(
      groups,
      rows,
      m.sub.id,
      m.sub.name,
      m.category.id,
      m.category.name != null ? String(m.category.name) : null
    );
  });
  const chunks = await Promise.all(tasks);
  return chunks.flat();
}

export function syncOrderBuilderPreviewFromCurrentSub() {
  const meta = getSelectedSubMeta();
  if (!meta || !invState._groups || !invState._rows) {
    invState._invOrderBuilderPreviewLines = [];
    pruneAutoQtyOverridesToExistingLines([]);
    invState._invOrderBuilderPreviewLoading = false;
    return;
  }
  const built = buildOrderLinesFromGroupsRows(
    invState._groups,
    invState._rows,
    meta.sub.id,
    meta.sub.name,
    meta.category.id,
    meta.category.name != null ? String(meta.category.name) : null
  );
  sortOrderBuilderLines(built);
  invState._invOrderBuilderPreviewLines = applyAutoQtyOverridesToLines(built);
  pruneAutoQtyOverridesToExistingLines(invState._invOrderBuilderPreviewLines);
  invState._invOrderBuilderPreviewLoading = false;
}

/** Make sure any category that contains a checked subcategory stays expanded so the selection is visible. */
export function expandOrderBuilderCatsForCurrentSelection() {
  if (invState._invOrderBuilderCustomSubIds.size === 0) return;
  for (const c of getCategoryTree()) {
    const subs = c.subcategories || [];
    if (subs.some((s) => invState._invOrderBuilderCustomSubIds.has(s.id))) {
      invState._invOrderBuilderExpandedCatIds.add(c.id);
    }
  }
}

export function prepareOrderBuilderPreviewForMount() {
  if (invState._invMainTab !== "orderBuilder") return;
}

export async function refreshOrderBuilderPreviewAsync() {
  if (invState._invMainTab !== "orderBuilder") return;
  seedOrderBuilderSelectionIfEmpty();
  const seq = ++invState._invOrderBuilderPreviewSeq;
  invState._invOrderBuilderPreviewLoading = true;
  mountOrRefreshMockUi();
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    const ids = Array.from(invState._invOrderBuilderCustomSubIds);
    let lines = [];
    if (ids.length > 0) {
      lines = await buildOrderPreviewLinesForCustomSubIds(salonId, ids);
    }
    sortOrderBuilderLines(lines);
    if (seq !== invState._invOrderBuilderPreviewSeq) return;
    const merged = applyAutoQtyOverridesToLines(lines);
    invState._invOrderBuilderPreviewLines = merged;
    pruneAutoQtyOverridesToExistingLines(merged);
  } catch (e) {
    console.error("[Inventory] order builder preview failed", e);
    if (seq !== invState._invOrderBuilderPreviewSeq) return;
    invState._invOrderBuilderPreviewLines = [];
    pruneAutoQtyOverridesToExistingLines([]);
    inventoryOrderDraftToast("Could not load inventory for this selection.", "error");
  } finally {
    if (seq === invState._invOrderBuilderPreviewSeq) {
      invState._invOrderBuilderPreviewLoading = false;
      mountOrRefreshMockUi();
    }
  }
}

export function renderOrderBuilderCustomTreeHtml() {
  const tree = getCategoryTree();
  if (!tree.length) {
    return `<p class="ff-inv2-ob-tree-empty">No categories yet.</p>`;
  }
  const parts = [];
  for (const c of tree) {
    const subs = c.subcategories || [];
    const isOpen = invState._invOrderBuilderExpandedCatIds.has(c.id);
    const someChecked = subs.length > 0 && subs.some((s) => invState._invOrderBuilderCustomSubIds.has(s.id));
    const allChecked = subs.length > 0 && subs.every((s) => invState._invOrderBuilderCustomSubIds.has(s.id));
    const subsHtml = subs.length
      ? subs
          .map((s) => {
            const checked = invState._invOrderBuilderCustomSubIds.has(s.id);
            return `<label class="ff-inv2-ob-sub-label">
  <input type="checkbox" data-inv-ob-sub="${escapeHtml(c.id)}:${escapeHtml(s.id)}"${checked ? " checked" : ""} />
  <span>${escapeHtml(s.name)}</span>
</label>`;
          })
          .join("")
      : `<span class="ff-inv2-ob-tree-empty">No subcategories</span>`;
    const countLabel = subs.length
      ? someChecked
        ? `${subs.filter((s) => invState._invOrderBuilderCustomSubIds.has(s.id)).length}/${subs.length}`
        : `${subs.length}`
      : "0";
    parts.push(`<div class="ff-inv2-ob-cat-block${isOpen ? " ff-inv2-ob-cat-block--open" : ""}" data-inv-ob-cat-block="${escapeHtml(c.id)}">
  <div class="ff-inv2-ob-cat-row">
    <button type="button" class="ff-inv2-ob-cat-toggle" data-inv-ob-cat-toggle="${escapeHtml(c.id)}" aria-expanded="${isOpen ? "true" : "false"}" aria-label="${isOpen ? "Collapse" : "Expand"} ${escapeHtml(c.name)}">
      <span class="ff-inv2-ob-cat-chev" aria-hidden="true">${isOpen ? "▾" : "▸"}</span>
    </button>
    <label class="ff-inv2-ob-cat-label">
      <input type="checkbox" data-inv-ob-cat="${escapeHtml(c.id)}"${allChecked ? " checked" : ""} />
      <span class="ff-inv2-ob-cat-name">${escapeHtml(c.name)}</span>
    </label>
    <span class="ff-inv2-ob-cat-count" aria-hidden="true">${escapeHtml(countLabel)}</span>
  </div>
  ${isOpen ? `<div class="ff-inv2-ob-subs">${subsHtml}</div>` : ""}
</div>`);
  }
  return `<div class="ff-inv2-ob-tree" role="group" aria-label="Subcategories">${parts.join("")}</div>`;
}

export function renderOrderBuilderSourceHtml() {
  seedOrderBuilderSelectionIfEmpty();
  expandOrderBuilderCatsForCurrentSelection();
  if (!invState._invObPickPanelOpen) {
    return "";
  }
  const doneBtn = `<button type="button" class="ff-inv2-ob-mobile-done" data-inv-ob-mobile-collapse-source="1" aria-label="Done choosing categories">Done</button>`;
  return `<div class="ff-inv2-ob-source" id="ff-inv2-ob-source">
  <div class="ff-inv2-ob-source-top">
    <div class="ff-inv2-ob-source-copy">
  <p class="ff-inv2-ob-source-title">Create Order</p>
  <p class="ff-inv2-ob-source-hint">Pick categories or subcategories to include, then review below.</p>
    </div>
    ${doneBtn}
  </div>
  <div class="ff-inv2-ob-custom">${renderOrderBuilderCustomTreeHtml()}</div>
</div>`;
}

export function syncOrderBuilderCategoryCheckboxIndeterminate(root) {
  root.querySelectorAll("[data-inv-ob-cat-block]").forEach((block) => {
    const catId = block.getAttribute("data-inv-ob-cat-block");
    if (!catId) return;
    const cat = getCategoryTree().find((c) => c.id === catId);
    if (!cat) return;
    const subs = cat.subcategories || [];
    const inp = block.querySelector("input[data-inv-ob-cat]");
    if (!(inp instanceof HTMLInputElement)) return;
    const checkedCount = subs.filter((s) => invState._invOrderBuilderCustomSubIds.has(s.id)).length;
    if (checkedCount === 0) {
      inp.checked = false;
      inp.indeterminate = false;
    } else if (subs.length && checkedCount === subs.length) {
      inp.checked = true;
      inp.indeterminate = false;
    } else {
      inp.checked = false;
      inp.indeterminate = true;
    }
  });
}

/** Async: load items (row × group) for a subcategory for the link picker. */
export async function loadLinkPickerItemsForSub(catId, subId) {
  if (!invState._invOrderBuilderAddModal) return;
  invState._invOrderBuilderAddModal.picker.items = null;
  invState._invOrderBuilderAddModal.picker.loading = true;
  invState._invOrderBuilderAddModal.picker.error = null;
  mountOrRefreshMockUi();
  try {
    const salonId = await getSalonId();
    if (!salonId) throw new Error("No salon");
    const m = findCategoryAndSubForSubId(subId);
    if (!m) throw new Error("Subcategory not found");
    const data = await fetchSubcategoryInventoryDoc(salonId, catId, subId);
    const { groups, rows } = data ? parseSubcategoryDocToTable(data) : { groups: [], rows: [] };
    const items = [];
    for (const row of rows) {
      if (!row || !row.byGroup) continue;
      const name = row.name != null ? String(row.name).trim() : "";
      if (name === "") continue;
      for (const g of groups) {
        items.push({
          id: `${subId}:${row.id}:${g.id}`,
          rowId: String(row.id),
          groupId: String(g.id),
          itemName: name,
          code: row.code != null ? String(row.code) : "",
          groupName: g.label != null ? String(g.label) : "",
          categoryId: String(catId),
          categoryName: m.category.name != null ? String(m.category.name) : "",
          subcategoryId: String(subId),
          subcategoryName: m.sub.name != null ? String(m.sub.name) : "",
        });
      }
    }
    if (!invState._invOrderBuilderAddModal) return;
    invState._invOrderBuilderAddModal.picker.items = items;
    invState._invOrderBuilderAddModal.picker.loading = false;
  } catch (e) {
    console.error("[Inventory] link picker load failed", e);
    if (!invState._invOrderBuilderAddModal) return;
    invState._invOrderBuilderAddModal.picker.items = [];
    invState._invOrderBuilderAddModal.picker.loading = false;
    invState._invOrderBuilderAddModal.picker.error = "Could not load items.";
  }
  mountOrRefreshMockUi();
}

export function renderOrderBuilderLinkPickerHtml(modal) {
  const p = modal.picker;
  const tree = getCategoryTree();

  if (p.step === "category") {
    if (!Array.isArray(tree) || tree.length === 0) {
      return `<p class="ff-inv2-ob-link-hint">No categories yet.</p>`;
    }
    const items = tree
      .map((c) => {
        const subs = Array.isArray(c.subcategories) ? c.subcategories : [];
        return `<button type="button" class="ff-inv2-ob-link-option" data-inv-ob-add-link-step="subcategory" data-cat-id="${escapeHtml(String(c.id))}">
  <span class="ff-inv2-ob-link-option-name">${escapeHtml(c.name != null ? String(c.name) : "")}</span>
  <span class="ff-inv2-ob-link-option-meta">${subs.length} subcategor${subs.length === 1 ? "y" : "ies"}</span>
  <span class="ff-inv2-ob-link-option-chev" aria-hidden="true">›</span>
</button>`;
      })
      .join("");
    return `<div class="ff-inv2-ob-link-head"><span class="ff-inv2-ob-link-head-label">Pick a category</span></div>
<div class="ff-inv2-ob-link-list">${items}</div>`;
  }

  if (p.step === "subcategory") {
    const cat = tree.find((c) => String(c.id) === String(p.catId));
    const subs = cat && Array.isArray(cat.subcategories) ? cat.subcategories : [];
    const items = subs.length
      ? subs
          .map((s) => `<button type="button" class="ff-inv2-ob-link-option" data-inv-ob-add-link-step="items" data-sub-id="${escapeHtml(String(s.id))}">
  <span class="ff-inv2-ob-link-option-name">${escapeHtml(s.name != null ? String(s.name) : "")}</span>
  <span class="ff-inv2-ob-link-option-chev" aria-hidden="true">›</span>
</button>`)
          .join("")
      : `<p class="ff-inv2-ob-link-hint">No subcategories in this category.</p>`;
    return `<div class="ff-inv2-ob-link-head">
  <button type="button" class="ff-inv2-ob-link-back" data-inv-ob-add-link-step="category" aria-label="Back">‹ Back</button>
  <span class="ff-inv2-ob-link-head-label">${escapeHtml(cat && cat.name != null ? String(cat.name) : "")}</span>
</div>
${subs.length ? `<div class="ff-inv2-ob-link-list">${items}</div>` : items}`;
  }

  // items step
  const cat = tree.find((c) => String(c.id) === String(p.catId));
  const sub = cat && Array.isArray(cat.subcategories) ? cat.subcategories.find((s) => String(s.id) === String(p.subId)) : null;
  let body;
  if (p.loading) {
    body = `<p class="ff-inv2-ob-link-hint">Loading items…</p>`;
  } else if (p.error) {
    body = `<p class="ff-inv2-ob-link-hint">${escapeHtml(p.error)}</p>`;
  } else if (!Array.isArray(p.items) || p.items.length === 0) {
    body = `<p class="ff-inv2-ob-link-hint">No items in this subcategory.</p>`;
  } else {
    const rows = p.items
      .map((it) => {
        const codeLabel = it.code ? `${it.code} · ` : "";
        const grp = it.groupName ? ` (${it.groupName})` : "";
        return `<button type="button" class="ff-inv2-ob-link-option" data-inv-ob-add-link-select="${escapeHtml(String(it.id))}">
  <span class="ff-inv2-ob-link-option-name">${escapeHtml(it.itemName)}${escapeHtml(grp)}</span>
  <span class="ff-inv2-ob-link-option-meta">${escapeHtml(codeLabel)}${escapeHtml(it.subcategoryName != null ? String(it.subcategoryName) : "")}</span>
</button>`;
      })
      .join("");
    body = `<div class="ff-inv2-ob-link-list">${rows}</div>`;
  }
  return `<div class="ff-inv2-ob-link-head">
  <button type="button" class="ff-inv2-ob-link-back" data-inv-ob-add-link-step="subcategory" aria-label="Back">‹ Back</button>
  <span class="ff-inv2-ob-link-head-label">${escapeHtml(cat && cat.name != null ? String(cat.name) : "")} · ${escapeHtml(sub && sub.name != null ? String(sub.name) : "")}</span>
</div>
${body}`;
}

export function renderInventoryOrderBuilderAddItemModal() {
  if (!invState._invOrderBuilderAddModal) return "";
  const m = invState._invOrderBuilderAddModal;
  const nameVal = escapeHtml(m.draftName);
  const qtyVal = escapeHtml(m.draftQty);
  const nameOk = String(m.draftName).trim() !== "";
  const qtyOk = parseNum(m.draftQty) > 0;
  const canAdd = nameOk && qtyOk;
  const hint = !nameOk
    ? "Enter an item name."
    : !qtyOk
      ? "Quantity must be greater than 0."
      : "";

  let linkBlockHtml;
  if (m.linkedItemId && m.linkedItemMeta) {
    const lm = m.linkedItemMeta;
    const labelParts = [lm.itemName];
    if (lm.groupName) labelParts.push(`(${lm.groupName})`);
    const subLabel = lm.subcategoryName ? `${lm.categoryName || ""} · ${lm.subcategoryName}` : "";
    linkBlockHtml = `<div class="ff-inv2-ob-link-selected">
  <div class="ff-inv2-ob-link-selected-text">
    <span class="ff-inv2-ob-link-selected-name">🔗 ${escapeHtml(labelParts.join(" "))}</span>
    ${subLabel ? `<span class="ff-inv2-ob-link-selected-sub">${escapeHtml(subLabel)}</span>` : ""}
  </div>
  <button type="button" class="ff-inv2-ob-link-clear" data-inv-ob-add-link-clear="1" aria-label="Clear link" title="Clear">×</button>
</div>`;
  } else {
    linkBlockHtml = `<div class="ff-inv2-ob-link-wrap">${renderOrderBuilderLinkPickerHtml(m)}</div>`;
  }

  return `<div class="ff-inv2-modal-backdrop" id="ff-inv-ob-add-item-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-inv-ob-add-item-title">
  <div class="ff-inv2-modal-card ff-inv2-ob-add-card">
    <h3 id="ff-inv-ob-add-item-title" class="ff-inv2-modal-title">Add item</h3>
    <label class="ff-inv2-modal-field">
      <span class="ff-inv2-modal-field-label">Item name</span>
      <input type="text" class="ff-inv2-modal-input" data-inv-ob-add-input="name" value="${nameVal}" placeholder="e.g. Hand soap" maxlength="120" autocomplete="off" />
    </label>
    <label class="ff-inv2-modal-field">
      <span class="ff-inv2-modal-field-label">Quantity</span>
      <input type="number" class="ff-inv2-modal-input" data-inv-ob-add-input="qty" value="${qtyVal}" placeholder="0" min="0" step="any" inputmode="decimal" autocomplete="off" />
    </label>
    <div class="ff-inv2-modal-field">
      <span class="ff-inv2-modal-field-label">Link to inventory item <span class="ff-inv2-modal-field-optional">(optional)</span></span>
      ${linkBlockHtml}
    </div>
    ${hint ? `<p class="ff-inv2-ob-add-hint">${escapeHtml(hint)}</p>` : ""}
    <div class="ff-inv2-modal-actions">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-inv-ob-add-cancel="1">Cancel</button>
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-primary" data-inv-ob-add-commit="1"${canAdd ? "" : " disabled"} title="${escapeHtml(hint || "Add item")}">Add</button>
    </div>
  </div>
</div>`;
}

export function commitInventoryOrderBuilderAddItem() {
  if (!invState._invOrderBuilderAddModal) return;
  const m = invState._invOrderBuilderAddModal;
  const name = String(m.draftName ?? "").trim();
  const qty = parseNum(m.draftQty);
  if (!name || !(qty > 0)) return;
  const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  /** @type {Record<string, unknown>} */
  const entry = { id, itemName: name, orderQty: qty, isManual: true };
  if (m.linkedItemId && m.linkedItemMeta) {
    const lm = m.linkedItemMeta;
    entry.linkedInventoryItemId = m.linkedItemId;
    if (lm.code) entry.code = lm.code;
    if (lm.groupId) entry.groupId = lm.groupId;
    if (lm.groupName) entry.groupName = lm.groupName;
    if (lm.categoryId) entry.categoryId = lm.categoryId;
    if (lm.categoryName) entry.categoryName = lm.categoryName;
    if (lm.subcategoryId) entry.subcategoryId = lm.subcategoryId;
    if (lm.subcategoryName) entry.subcategoryName = lm.subcategoryName;
  }
  invState._invOrderBuilderManualLines.push(entry);
  invState._invOrderBuilderAddModal = null;
  scheduleInventoryOrderDraftSave();
  mountOrRefreshMockUi();
}

export function handleOrderBuilderSourceChange(ev) {
  const root = document.getElementById("inventoryScreen");
  const t = ev.target;
  if (!(t instanceof HTMLInputElement) || !root || !root.contains(t)) return;
  if (t.hasAttribute("data-inv-shopping-check")) {
    const oid = t.getAttribute("data-order-id");
    const idxStr = t.getAttribute("data-line-idx");
    if (oid != null && idxStr != null) {
      toggleShoppingRowQty(oid, Number(idxStr));
    }
    return;
  }
  if (t.hasAttribute("data-inv-order-receipt-file")) {
    const oid = t.getAttribute("data-order-id");
    const f = t.files && t.files[0];
    t.value = "";
    if (oid && f) {
      void handleInventoryOrderReceiptFileSelected(root, oid, f);
    }
    return;
  }
  if (t.hasAttribute("data-inv-ob-cat")) {
    const catId = t.getAttribute("data-inv-ob-cat");
    if (!catId) return;
    const cat = getCategoryTree().find((c) => c.id === catId);
    if (!cat) return;
    const subs = cat.subcategories || [];
    if (t.checked) {
      for (const s of subs) invState._invOrderBuilderCustomSubIds.add(s.id);
    } else {
      for (const s of subs) invState._invOrderBuilderCustomSubIds.delete(s.id);
    }
    scheduleInventoryOrderDraftSave();
    mountOrRefreshMockUi();
    void refreshOrderBuilderPreviewAsync();
    return;
  }
  if (t.hasAttribute("data-inv-ob-sub")) {
    const val = t.getAttribute("data-inv-ob-sub");
    if (!val) return;
    const colon = val.indexOf(":");
    if (colon < 0) return;
    const subId = val.slice(colon + 1);
    if (t.checked) invState._invOrderBuilderCustomSubIds.add(subId);
    else invState._invOrderBuilderCustomSubIds.delete(subId);
    scheduleInventoryOrderDraftSave();
    mountOrRefreshMockUi();
    void refreshOrderBuilderPreviewAsync();
  }
}

/**
 * Add a Smart Inventory Suggestion (from Inbox) as a manual line in Create Order.
 * - Navigates to Inventory → Create Order tab
 * - Pushes a linked manual line (rowId:groupId) with the suggested quantity
 * - Avoids duplicates: if the same linked item is already in the manual list, just bumps qty.
 * Returns true on success.
 */
export async function ffAddInventorySuggestionToOrder(suggestion, opts) {
  if (!suggestion || !suggestion.data) return false;
  const d = suggestion.data;
  const rowId = d.rowId != null ? String(d.rowId) : "";
  const groupId = d.groupId != null ? String(d.groupId) : "";
  const subId = d.subcategoryId != null ? String(d.subcategoryId) : "";
  const catId = d.categoryId != null ? String(d.categoryId) : "";
  // Accept a user-edited qty override from the Inbox modal; fall back to suggestedQty.
  const overrideQtyRaw = opts && opts.qtyOverride;
  const overrideQty = overrideQtyRaw != null
    ? (typeof overrideQtyRaw === "number" ? overrideQtyRaw : Number(overrideQtyRaw))
    : NaN;
  const suggestedQty = typeof d.suggestedQty === "number" ? d.suggestedQty : Number(d.suggestedQty);
  const qty = Number.isFinite(overrideQty) && overrideQty > 0 ? overrideQty : suggestedQty;
  console.log("[Inventory] Add to Order — qty resolution", { overrideQtyRaw, overrideQty, suggestedQty, finalQty: qty });
  if (!rowId || !groupId || !subId || !catId || !(qty > 0)) return false;
  const salonId = await getSalonId();
  if (!salonId) return false;

  // Step 1: ensure the active draft is loaded (so we know its Firestore id).
  // This also picks up any draft created from a previous session.
  await loadInventoryOrderDraft();

  // Step 2: read-modify-write the active draft (or create one if none exists).
  const uid = auth.currentUser && auth.currentUser.uid ? String(auth.currentUser.uid) : null;
  const linkedId = `${subId}:${rowId}:${groupId}`;
  /** @type {Array<Record<string, unknown>>} */
  let existing = [];
  /** @type {import("firebase/firestore").DocumentReference | null} */
  let ref = null;
  if (invState._invActiveDraftId) {
    ref = doc(db, `salons/${salonId}/inventoryDrafts`, invState._invActiveDraftId);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data() || {};
        if (Array.isArray(data.manualItems)) {
          existing = data.manualItems.map(sanitizeManualItemForDraft).filter((x) => x && x.itemName);
        }
      }
    } catch (e) {
      console.warn("[Inventory] draft fetch (add suggestion) failed", e);
    }
  }
  const existingIdx = existing.findIndex((L) => L && L.linkedInventoryItemId === linkedId);
  if (existingIdx >= 0) {
    // User explicitly chose this qty in the modal — respect it, even if it lowers a previous value.
    existing[existingIdx].orderQty = qty;
    if (!existing[existingIdx].fromSuggestionId && suggestion.id) {
      existing[existingIdx].fromSuggestionId = suggestion.id;
    }
  } else {
    /** @type {Record<string, unknown>} */
    const entry = {
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      itemName: d.itemName != null ? String(d.itemName) : "Suggested item",
      orderQty: qty,
      isManual: true,
      linkedInventoryItemId: linkedId,
      groupId,
      groupName: d.groupName != null ? String(d.groupName) : "",
      categoryId: catId,
      categoryName: d.categoryName != null ? String(d.categoryName) : "",
      subcategoryId: subId,
      subcategoryName: d.subcategoryName != null ? String(d.subcategoryName) : "",
      fromSuggestionId: suggestion.id || null,
    };
    existing.push(entry);
  }
  try {
    const payload = {
      status: "draft",
      isActive: true,
      manualItems: existing,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    };
    if (ref) {
      await setDoc(ref, payload, { merge: true });
    } else {
      // No active draft exists — create one now.
      const newRef = await addDoc(collection(db, `salons/${salonId}/inventoryDrafts`), {
        ...payload,
        selectedSubcategoryIds: [],
        orderName: "",
        createdAt: serverTimestamp(),
        createdBy: uid,
      });
      invState._invActiveDraftId = newRef.id;
    }
  } catch (e) {
    console.error("[Inventory] Add to Order — draft save failed:", e && (e.code || e.message) ? (e.code || e.message) : e);
    try {
      if (typeof window !== "undefined" && typeof window.alert === "function") {
        window.alert("Could not save item to Create Order draft:\n" + (e && (e.code || e.message) ? (e.code || e.message) : String(e)));
      }
    } catch (_) {}
    return false;
  }

  // Step 3: navigate to Inventory → Create Order. The tab will reload the draft (now containing the new item).
  invState._invOrderDraftLoaded = false;
  await goToInventory();
  invState._invMainTab = "orderBuilder";
  invState._invObPickPanelOpen = false;
  invState._invOrderBuilderPreviewLoading = true;
  mountOrRefreshMockUi();
  await loadInventoryOrderDraft(true);
  void refreshOrderBuilderPreviewAsync();
  return true;
}
