/**
 * Tickets — Service Catalog V2: mutation UI (Phase 8b split).
 *
 * Context menus + popovers, catalog drag-and-drop reordering, and the shared
 * add/edit mini-modal (editor) with its CRUD entry points. Verbatim move.
 *
 * No import of the render layer — renderServicesCatalogV2 and _ffIsServicesScreenRoot
 * are injected via initCatalogEdit. showToast, ticketConfirm and setupTicketsUI
 * are injected too.
 */
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { ffCanManageServices, normalizeSharedCategoryName, sharedCategoryId, dedupeCatalogCategories, findExistingCatalogCategory, resolveServiceDurationMinutes, getSharedServicesForCatalogManager, getLocationServicesForCatalogManager, loadSharedCatalogForManager, loadServices, loadServiceCategories, saveSharedService, saveSharedServiceCategory, deleteSharedServiceCategory, deleteSharedService, saveSharedServiceOverride, removeSharedServiceOverride, saveService, saveServiceCategory, deleteService, deleteServiceCategory } from "./tickets-catalog-data.js?v=20260916_combo_id";
import { joinServiceDurationMinutes, serviceDurationControlsHtml, showServiceDurationError } from "./tickets-service-duration.js?v=20260824_svc_dur_hm";
import { ffTicketCurSym } from "./tickets-helpers.js?v=20260721_ticket_soft_delete";
import { escapeHtml } from "./tickets-list.js?v=20260721_ticket_soft_delete";
import { catalogRowsForComboUsage, catalogServiceTypeControlsHtml, comboSaveFields, combosUsingService, ensureCatalogEditorComboMounts, isComboService, SERVICE_TYPE_COMBO, wireComboEditor } from "./tickets-catalog-combo.js?v=20260916_combo_id";
import { catalogServiceSavedToast, isCatalogServiceCreateMode } from "./tickets-catalog-toast.js?v=20260915_svc_toast";

let showToast, ticketConfirm, setupTicketsUI, renderServicesCatalogV2, _ffIsServicesScreenRoot;
export function initCatalogEdit(deps) {
  showToast = deps.showToast;
  ticketConfirm = deps.ticketConfirm;
  setupTicketsUI = deps.setupTicketsUI;
  renderServicesCatalogV2 = deps.renderServicesCatalogV2;
  _ffIsServicesScreenRoot = deps._ffIsServicesScreenRoot;
}

async function askCatalogConfirm(message, title) {
  try {
    if (typeof ticketConfirm === 'function') return await ticketConfirm(message, title);
  } catch (_) {}
  try {
    if (typeof window !== 'undefined' && typeof window.ffConfirm === 'function') {
      return await window.ffConfirm(message, title);
    }
  } catch (_) {}
  return window.confirm(message);
}

function isSharedCatalogMode() {
  return ticketsState._ffCatalogModalMode === 'shared';
}

function currentEditorCatalogServices() {
  const data = isSharedCatalogMode()
    ? getSharedServicesForCatalogManager()
    : getLocationServicesForCatalogManager();
  return (data && data.services) || [];
}

function currentEditorCategories() {
  const data = isSharedCatalogMode()
    ? getSharedServicesForCatalogManager()
    : (ticketsState.serviceCategories && ticketsState.serviceCategories.length
      ? { categories: ticketsState.serviceCategories }
      : getLocationServicesForCatalogManager());
  return dedupeCatalogCategories((data && data.categories) || ticketsState.serviceCategories || []);
}

function ensureEditorCreateCategoryBtn(wrap) {
  if (!wrap) return null;
  let btn = document.getElementById('servicesCatalogEditorCreateCategory');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'servicesCatalogEditorCreateCategory';
    btn.type = 'button';
    btn.textContent = '+ Create new category';
    btn.style.cssText = 'margin-top:8px;padding:0;border:none;background:none;color:#7c3aed;font-size:12px;font-weight:700;cursor:pointer;text-align:left;';
    wrap.appendChild(btn);
  }
  return btn;
}

function fillEditorCategorySelect(catSel, selectedIdOrName) {
  if (!catSel) return;
  const categories = currentEditorCategories();
  const selected = findExistingCatalogCategory(selectedIdOrName, categories);
  let html = '<option value="">Select existing category</option>';
  categories.forEach((c) => {
    html += `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`;
  });
  catSel.innerHTML = html;
  if (selected) catSel.value = selected.id;
}

async function createEditorCategory(nameHint) {
  const raw = String(nameHint || '').trim();
  if (!raw) return null;
  const categories = currentEditorCategories();
  const existing = findExistingCatalogCategory(raw, categories);
  if (existing) return existing;
  if (isSharedCatalogMode()) {
    const data = getSharedServicesForCatalogManager();
    const categoryId = await saveSharedServiceCategory({ name: raw, sortOrder: (data.categories || []).length });
    await loadSharedCatalogForManager();
    ticketsState._ffOpenCats.add(categoryId);
    return findExistingCatalogCategory(categoryId, currentEditorCategories())
      || { id: categoryId, name: normalizeSharedCategoryName(raw) };
  }
  await saveServiceCategory({ name: raw, sortOrder: ticketsState.serviceCategories.length });
  await Promise.all([loadServiceCategories(), loadServices()]);
  return findExistingCatalogCategory(raw, currentEditorCategories());
}

function catalogServicesForComboUsage() {
  return catalogRowsForComboUsage([
    ticketsState._rawSharedServices,
    ticketsState._rawServices,
    getSharedServicesForCatalogManager().services,
    getLocationServicesForCatalogManager().services,
    ticketsState.salonServices,
    currentEditorCatalogServices()
  ]);
}

function selectedEditorCategory(catSel) {
  return findExistingCatalogCategory(catSel && catSel.value || '', currentEditorCategories());
}

function requireEditorCategory(catSel) {
  const selected = selectedEditorCategory(catSel);
  if (selected) return selected;
  if (catSel) {
    try {
      const prev = catSel.style.borderColor;
      catSel.style.borderColor = '#ef4444';
      catSel.focus();
      setTimeout(() => { catSel.style.borderColor = prev || '#e5e7eb'; }, 1400);
    } catch (_) {}
  }
  showToast('Select an existing category.', 'error');
  return null;
}

function editorServiceType(existing) {
  return isComboService(existing) ? SERVICE_TYPE_COMBO : 'single';
}

function syncCatalogEditorTypeUi(type) {
  const wrapDuration = document.getElementById('servicesCatalogEditorDurationWrap');
  const comboWrap = document.getElementById('servicesCatalogEditorComboWrap');
  const nameInp = document.getElementById('servicesCatalogEditorName');
  const priceInp = document.getElementById('servicesCatalogEditorPrice');
  const card = document.querySelector('#servicesCatalogEditorModal > div');
  const isCombo = type === SERVICE_TYPE_COMBO;
  if (wrapDuration) wrapDuration.style.display = isCombo ? 'none' : 'block';
  if (comboWrap) comboWrap.style.display = isCombo ? 'block' : 'none';
  if (card) card.style.maxWidth = isCombo ? '560px' : '420px';
  if (nameInp) {
    nameInp.placeholder = isCombo
      ? 'Combo name (e.g. Manicure + Pedicure Combo)'
      : 'Service name (e.g. Gel Full Set)';
  }
  if (priceInp) {
    priceInp.placeholder = isCombo
      ? `Combo selling price (${ffTicketCurSym()})`
      : `Default price (${ffTicketCurSym()})`;
  }
}

async function deleteSharedCategoryWithServices(cat, catId) {
  const catalogData = getSharedServicesForCatalogManager();
  const lines = (catalogData.services || []).filter((s) => String(s.categoryId) === String(catId));
  const label = cat && cat.name ? cat.name : 'this category';
  const ok = await askCatalogConfirm(
    lines.length
      ? `Delete "${label}" and its ${lines.length} service${lines.length === 1 ? '' : 's'}?`
      : `Delete "${label}"?`,
    'Delete category'
  );
  if (!ok) return;
  try {
    for (const line of lines) {
      await deleteSharedService(line.id);
    }
    const docId = String((cat && (cat.docId || cat.id)) || catId || '').trim();
    if (docId) await deleteSharedServiceCategory(docId);
    if (catId && String(catId) !== docId) await deleteSharedServiceCategory(catId);
    await loadSharedCatalogForManager();
    ticketsState._ffSelectedCategoryId = null;
    ticketsState._ffSelectedServiceId = null;
    ticketsState._ffOpenCats.delete(catId);
    renderServicesCatalogV2();
    try { setupTicketsUI(); } catch (_) {}
    showToast('Category deleted', 'success');
  } catch (e) {
    showToast(e?.message || 'This category could not be deleted.', 'error');
  }
}

async function deleteCatalogService(svcId) {
  const id = String(svcId || '').trim();
  if (!id) {
    showToast('This service could not be found.', 'error');
    return;
  }
  const catalog = catalogServicesForComboUsage();
  const usedBy = combosUsingService(id, catalog);
  if (usedBy.length) {
    const names = usedBy.slice(0, 3).map((s) => s.name || 'Combo').join(', ');
    showToast(`This service is used in ${usedBy.length === 1 ? 'a Combo' : 'Combos'} (${names}). Remove it from Combo components first.`, 'error');
    return;
  }
  const ok = await askCatalogConfirm('Are you sure you want to delete this service?', 'Delete service');
  if (!ok) return;
  try {
    const sharedRow = getSharedServicesForCatalogManager().services.find((s) => String(s.id) === id);
    const useShared = isSharedCatalogMode() || !!(sharedRow && sharedRow.isSharedService);
    if (useShared) {
      await deleteSharedService(id);
      await loadSharedCatalogForManager();
    } else {
      await deleteService(id);
      await loadServices();
    }
    if (String(ticketsState._ffSelectedServiceId || '') === id) ticketsState._ffSelectedServiceId = null;
    renderServicesCatalogV2();
    try { setupTicketsUI(); } catch (_) {}
    showToast('Service deleted', 'success');
  } catch (e) {
    showToast(e?.message || 'This service could not be deleted.', 'error');
  }
}

function _ffShowServicesCategoryDetailMenu(anchorBtn, catId) {
  _ffCloseAllPopovers();
  const isSharedCatalog = isSharedCatalogMode();
  const catalogData = isSharedCatalog ? getSharedServicesForCatalogManager() : getLocationServicesForCatalogManager();
  const cat = catalogData.categories.find((c) => String(c.id) === String(catId));
  if (!cat) {
    showToast('This category could not be found.', 'error');
    return;
  }
  const pop = _ffBuildPopover(anchorBtn, [
    { label: 'Rename category', onClick: () => _ffCatalogEditorOpen({ mode: isSharedCatalog ? 'shared-category-edit' : 'category-edit', categoryId: catId }) },
    { label: 'Delete Category', danger: true, onClick: async () => {
      if (isSharedCatalog) {
        await deleteSharedCategoryWithServices(cat, catId);
        return;
      }
      const ok = await askCatalogConfirm(`Delete "${cat.name}"? Services inside must be moved first.`, 'Delete category');
      if (!ok) return;
      try {
        await deleteServiceCategory(catId);
        await Promise.all([loadServiceCategories(), loadServices()]);
        ticketsState._ffSelectedCategoryId = null;
        ticketsState._ffOpenCats.delete(catId);
        renderServicesCatalogV2();
        showToast('Category deleted', 'success');
      } catch (e) {
        showToast(e?.message || 'Failed', 'error');
      }
    }},
  ]);
  document.body.appendChild(pop);
}

/** Small popover menu for a category row. */
function _ffShowCategoryMenu(anchorBtn, catId) {
  _ffCloseAllPopovers();
  if (!ffCanManageServices()) return;
  const isSharedCatalog = isSharedCatalogMode();
  const catalogData = isSharedCatalog ? getSharedServicesForCatalogManager() : getLocationServicesForCatalogManager();
  const cat = catalogData.categories.find((c) => String(c.id) === String(catId));
  if (!cat) {
    showToast('This category could not be found.', 'error');
    return;
  }
  if (isSharedCatalog) {
    const pop = _ffBuildPopover(anchorBtn, [
      { label: 'Rename category', onClick: () => _ffCatalogEditorOpen({ mode: 'shared-category-edit', categoryId: catId }) },
      { label: 'Delete category', danger: true, onClick: async () => {
        await deleteSharedCategoryWithServices(cat, catId);
      }},
    ]);
    document.body.appendChild(pop);
    return;
  }
  const pop = _ffBuildPopover(anchorBtn, [
    { label: 'Rename category', onClick: () => _ffCatalogEditorOpen({ mode: 'category-edit', categoryId: catId }) },
    { label: 'Delete category', danger: true, onClick: async () => {
      const ok = await askCatalogConfirm(`Delete "${cat.name}"? Services inside must be moved first.`, 'Delete category');
      if (!ok) return;
      try {
        await deleteServiceCategory(catId);
        await Promise.all([loadServiceCategories(), loadServices()]);
        ticketsState._ffOpenCats.delete(catId);
        renderServicesCatalogV2();
        try { setupTicketsUI(); } catch (_) {}
        showToast('Category deleted', 'success');
  } catch (e) { showToast(e?.message || 'Failed', 'error'); }
    }},
  ]);
  document.body.appendChild(pop);
}

/** Small popover menu for a service row. */
function _ffShowServiceMenu(anchorBtn, svcId) {
  _ffCloseAllPopovers();
  if (!ffCanManageServices()) return;
  const isSharedCatalog = isSharedCatalogMode();
  const svc = isSharedCatalog
    ? getSharedServicesForCatalogManager().services.find((s) => String(s.id) === String(svcId))
    : (ticketsState.salonServices.find((s) => String(s.id) === String(svcId))
      || getSharedServicesForCatalogManager().services.find((s) => String(s.id) === String(svcId)));
  if (!svc) {
    showToast('This service could not be found.', 'error');
    return;
  }
  const items = [
    { label: 'Edit service', onClick: () => {
      if (_ffIsServicesScreenRoot()) {
        ticketsState._ffSelectedServiceId = svcId;
        ticketsState._ffSelectedCategoryId = null;
        ticketsState._ffServicesInlineEditServiceId = svcId;
        renderServicesCatalogV2();
      } else {
        _ffCatalogEditorOpen({ mode: isSharedCatalog ? 'shared-service-edit' : 'service-edit', serviceId: svcId });
      }
    } },
  ];
  if (isSharedCatalog) {
    items.push({ label: 'Delete service', danger: true, onClick: async () => {
      await deleteCatalogService(svcId);
    }});
    const pop = _ffBuildPopover(anchorBtn, items);
    document.body.appendChild(pop);
    return;
  }
  // Offer a "Move to…" shortcut for keyboards / touch devices where HTML5
  // drag-and-drop isn't available. Only appears when there's somewhere
  // meaningful to move to (another real category).
  const otherCats = ticketsState.serviceCategories.filter((c) => c.id !== svc.categoryId);
  if (otherCats.length > 0) {
    items.push({ label: 'Move to category…', onClick: () => _ffShowMoveServicePicker(anchorBtn, svcId) });
  }
  items.push({ label: 'Delete service', danger: true, onClick: async () => {
    await deleteCatalogService(svcId);
  }});
  const pop = _ffBuildPopover(anchorBtn, items);
  document.body.appendChild(pop);
}

/** Secondary popover: list of categories to move the service into. */
function _ffShowMoveServicePicker(anchorBtn, svcId) {
  _ffCloseAllPopovers();
  const svc = ticketsState.salonServices.find((s) => s.id === svcId);
  if (!svc) return;
  const items = ticketsState.serviceCategories
    .filter((c) => c.id !== svc.categoryId)
    .map((c) => ({
      label: c.name,
      onClick: async () => {
        try {
          await _ffMoveServiceToCategoryEnd(svcId, c.id);
          showToast(`Moved to "${c.name}"`, 'success');
        } catch (e) { showToast(e?.message || 'Failed', 'error'); }
      },
    }));
  if (items.length === 0) return;
  const pop = _ffBuildPopover(anchorBtn, items);
  document.body.appendChild(pop);
}

function _ffCloseAllPopovers() {
  document.querySelectorAll('.ffcat-popover').forEach((el) => el.remove());
}

/** Creates a small floating popover anchored near `anchorBtn`. */
function _ffBuildPopover(anchorBtn, items) {
  const pop = document.createElement('div');
  pop.className = 'ffcat-popover';
  const rect = anchorBtn.getBoundingClientRect();
  pop.style.cssText = `position:fixed;top:${rect.bottom + 4}px;left:${Math.max(8, rect.right - 160)}px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,0.12);padding:4px;min-width:160px;z-index:2147483500;`;
  items.forEach(({ label, danger, onClick }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = `display:block;width:100%;text-align:left;padding:8px 12px;border:none;background:none;cursor:pointer;font-size:13px;color:${danger ? '#ef4444' : '#111'};border-radius:6px;`;
    b.addEventListener('mouseenter', () => { b.style.background = danger ? '#fef2f2' : '#f3f4f6'; });
    b.addEventListener('mouseleave', () => { b.style.background = 'none'; });
    b.addEventListener('click', () => { _ffCloseAllPopovers(); onClick?.(); });
    pop.appendChild(b);
  });
  // Auto-close on outside click (pop may be removed earlier — ignore stale listeners so nested menus work)
  setTimeout(() => {
    const off = (e) => {
      if (!pop.isConnected) {
        document.removeEventListener('mousedown', off, true);
        return;
      }
      if (!pop.contains(e.target)) {
        _ffCloseAllPopovers();
        document.removeEventListener('mousedown', off, true);
      }
    };
    document.addEventListener('mousedown', off, true);
  }, 0);
  return pop;
}

// ---------- Drag-and-drop reordering ----------
// Categories are reordered by dragging their header onto another header.
// Services are reordered within a category by dragging one row onto another,
// or moved across categories by dropping on another category's services or
// directly on a category header (which appends the service to the end of
// that category). Firestore writes update `sortOrder` for every sibling
// affected; the onSnapshot subscription re-renders the UI.

/** @type {{kind:'category'|'service', catId:string|null, svcId:string|null}|null} */

function _ffClearDragHover() {
  if (ticketsState._ffDragHoverEl) {
    ticketsState._ffDragHoverEl.style.boxShadow = '';
    ticketsState._ffDragHoverEl.style.background = ticketsState._ffDragHoverEl._ffPrevBg || '';
    ticketsState._ffDragHoverEl._ffPrevBg = undefined;
    delete ticketsState._ffDragHoverEl.dataset.dropPosition;
    ticketsState._ffDragHoverEl = null;
  }
}

function catalogRowsForDrag() {
  return isSharedCatalogMode()
    ? getSharedServicesForCatalogManager()
    : getLocationServicesForCatalogManager();
}

async function refreshCatalogAfterReorder() {
  if (isSharedCatalogMode()) {
    await loadSharedCatalogForManager();
  } else {
    await Promise.all([loadServices(), loadServiceCategories()]);
  }
  if (typeof renderServicesCatalogV2 === 'function') renderServicesCatalogV2();
}

function _ffWireCatalogDragDrop(listEl) {
  // The list is re-rendered on every snapshot, so wire once per render by
  // attaching to the fresh listEl. No need for idempotence.
  listEl.addEventListener('dragstart', (e) => {
    const row = e.target.closest('[data-drag-kind]');
    if (!row) return;
    ticketsState._ffDragSrc = {
      kind: row.getAttribute('data-drag-kind'),
      catId: row.getAttribute('data-cat-id') || null,
      svcId: row.getAttribute('data-svc-id') || null,
    };
    try {
      e.dataTransfer.effectAllowed = 'move';
      // Firefox needs data set for dragstart to actually begin.
      e.dataTransfer.setData('text/plain', ticketsState._ffDragSrc.svcId || ticketsState._ffDragSrc.catId || '');
    } catch (_) {}
    row.style.opacity = '0.4';
  });

  listEl.addEventListener('dragend', (e) => {
    const row = e.target.closest('[data-drag-kind]');
    if (row) row.style.opacity = '';
    _ffClearDragHover();
    ticketsState._ffDragSrc = null;
  });

  listEl.addEventListener('dragover', (e) => {
    if (!ticketsState._ffDragSrc) return;
    let hl = null;
    if (ticketsState._ffDragSrc.kind === 'category') {
      const targetHead = e.target.closest('.ffcat-head[data-drag-kind="category"]');
      if (targetHead && targetHead.getAttribute('data-cat-id') !== ticketsState._ffDragSrc.catId) {
        hl = targetHead;
      }
    } else if (ticketsState._ffDragSrc.kind === 'service') {
      const targetSvc = e.target.closest('.ffsvc-row');
      const targetHead = e.target.closest('.ffcat-head[data-drag-kind="category"]');
      if (targetSvc && targetSvc.getAttribute('data-svc-id') !== ticketsState._ffDragSrc.svcId) {
        hl = targetSvc;
      } else if (targetHead) {
        hl = targetHead;
      }
    }
    if (hl) {
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
      if (hl !== ticketsState._ffDragHoverEl) {
        _ffClearDragHover();
        ticketsState._ffDragHoverEl = hl;
        if (hl.classList.contains('ffcat-head')) {
          hl._ffPrevBg = hl.style.background;
          hl.style.background = '#ede9fe';
        } else {
          // inset box-shadow avoids the layout jitter a real border would cause.
          hl.style.boxShadow = 'inset 0 2px 0 0 #7c3aed';
        }
      }
    } else if (ticketsState._ffDragHoverEl) {
      _ffClearDragHover();
    }
  });

  listEl.addEventListener('drop', async (e) => {
    if (!ticketsState._ffDragSrc) return;
    e.preventDefault();
    const src = ticketsState._ffDragSrc;
    _ffClearDragHover();
    ticketsState._ffDragSrc = null;
    try {
      if (src.kind === 'category') {
        const targetHead = e.target.closest('.ffcat-head[data-drag-kind="category"]');
        const dstId = targetHead?.getAttribute('data-cat-id');
        if (dstId && dstId !== src.catId) {
          await _ffReorderCategoriesBefore(src.catId, dstId);
        }
      } else if (src.kind === 'service') {
        const targetSvc = e.target.closest('.ffsvc-row');
        const targetHead = e.target.closest('.ffcat-head[data-drag-kind="category"]');
        if (targetSvc && targetSvc.getAttribute('data-svc-id') !== src.svcId) {
          const beforeSvcId = targetSvc.getAttribute('data-svc-id');
          const targetCatId = targetSvc.getAttribute('data-cat-id');
          await _ffReorderServiceBefore(src.svcId, beforeSvcId, targetCatId);
        } else if (targetHead) {
          const targetCatId = targetHead.getAttribute('data-cat-id');
          await _ffMoveServiceToCategoryEnd(src.svcId, targetCatId);
        }
      }
    } catch (err) {
      console.error('[Tickets] Reorder failed', err);
      showToast(err?.message || 'Reorder failed', 'error');
    }
  });
}

/** Move `srcId` so it lands immediately before `beforeId` in the category
 *  order, then persist a fresh sortOrder (0,1,2,…) to every category. */
async function _ffReorderCategoriesBefore(srcId, beforeId, placeAfter) {
  if (!srcId || srcId === '__other__' || !beforeId || beforeId === '__other__' || String(srcId) === String(beforeId)) return;
  const shared = isSharedCatalogMode();
  const arr = (catalogRowsForDrag().categories || [])
    .filter((c) => c && c.id && c.id !== '__other__')
    .slice()
    .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
  const srcIdx = arr.findIndex((c) => String(c.id) === String(srcId));
  if (srcIdx < 0) return;
  const [moved] = arr.splice(srcIdx, 1);
  let dstIdx = arr.findIndex((c) => String(c.id) === String(beforeId));
  if (dstIdx < 0) dstIdx = arr.length;
  else if (placeAfter) dstIdx += 1;
  arr.splice(dstIdx, 0, moved);
  if (shared) {
    await Promise.all(arr.map((c, idx) => saveSharedServiceCategory({
      id: c.docId || c.id,
      name: c.name,
      sortOrder: idx
    })));
  } else {
    await Promise.all(arr.map((c, idx) => saveServiceCategory({ id: c.id, name: c.name, sortOrder: idx })));
  }
  await refreshCatalogAfterReorder();
}

/** Service reorder: insert `srcId` before `beforeSvcId` inside `targetCatId`
 *  (same or different category from source). Rewrites sortOrder for every
 *  service in the target bucket. If `targetCatId` is the virtual "Other"
 *  bucket, bail out — it isn't a real category. */
async function _ffReorderServiceBefore(srcId, beforeSvcId, targetCatId, placeAfter) {
  if (!targetCatId || targetCatId === '__other__') return;
  const shared = isSharedCatalogMode();
  const data = catalogRowsForDrag();
  const src = (data.services || []).find((s) => String(s.id) === String(srcId));
  if (!src) return;
  const destCat = (data.categories || []).find((c) => String(c.id) === String(targetCatId));
  if (!destCat) return;
  const siblings = (data.services || [])
    .filter((s) => String(s.categoryId) === String(targetCatId) && String(s.id) !== String(srcId))
    .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
  let beforeIdx = siblings.findIndex((s) => String(s.id) === String(beforeSvcId));
  if (beforeIdx < 0) beforeIdx = siblings.length;
  else if (placeAfter) beforeIdx += 1;
  siblings.splice(beforeIdx, 0, src);
  if (shared) {
    await Promise.all(siblings.map((s, idx) => saveSharedService({
      id: s.id,
      name: s.name,
      category: destCat.name,
      defaultPrice: s.sharedDefaultPrice ?? s.defaultPrice ?? 0,
      sortOrder: idx,
      active: s.active !== false
    })));
  } else {
    await Promise.all(siblings.map((s, idx) => saveService({
      id: s.id,
      name: s.name,
      categoryId: targetCatId,
      defaultPrice: s.defaultPrice || 0,
      sortOrder: idx,
    })));
  }
  ticketsState._ffOpenCats.add(targetCatId);
  await refreshCatalogAfterReorder();
}

/** Drop on a category header = move the service to the END of that category. */
async function _ffMoveServiceToCategoryEnd(srcId, targetCatId) {
  if (!targetCatId || targetCatId === '__other__') return;
  const shared = isSharedCatalogMode();
  const data = catalogRowsForDrag();
  const src = (data.services || []).find((s) => String(s.id) === String(srcId));
  if (!src) return;
  if (String(src.categoryId) === String(targetCatId)) return;
  const destCat = (data.categories || []).find((c) => String(c.id) === String(targetCatId));
  if (!destCat) return;
  const siblings = (data.services || [])
    .filter((s) => String(s.categoryId) === String(targetCatId))
    .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
  const lastOrder = siblings.length > 0 ? (siblings[siblings.length - 1].sortOrder ?? siblings.length - 1) : -1;
  if (shared) {
    await saveSharedService({
      id: src.id,
      name: src.name,
      category: destCat.name,
      defaultPrice: src.sharedDefaultPrice ?? src.defaultPrice ?? 0,
      sortOrder: lastOrder + 1,
      active: src.active !== false
    });
  } else {
    await saveService({
      id: src.id,
      name: src.name,
      categoryId: targetCatId,
      defaultPrice: src.defaultPrice || 0,
      sortOrder: lastOrder + 1,
    });
  }
  ticketsState._ffOpenCats.add(targetCatId);
  await refreshCatalogAfterReorder();
}

// ---------- Shared mini editor modal (Add/Edit category or service) ----------

/** Shape: { mode: 'category-add'|'category-edit'|'service-add'|'service-edit', categoryId?, serviceId? } */
function _ffCatalogEditorOpen(opts) {
  const mod = document.getElementById('servicesCatalogEditorModal');
  if (!mod) return;
  const title = document.getElementById('servicesCatalogEditorTitle');
  const wrapCat = document.getElementById('servicesCatalogEditorCatWrap');
  const wrapPrice = document.getElementById('servicesCatalogEditorPriceWrap');
  const wrapDuration = document.getElementById('servicesCatalogEditorDurationWrap');
  const nameInp = document.getElementById('servicesCatalogEditorName');
  const catSel = document.getElementById('servicesCatalogEditorCategory');
  const catTextInp = document.getElementById('servicesCatalogEditorCategoryText');
  const priceInp = document.getElementById('servicesCatalogEditorPrice');
  const activeWrap = document.getElementById('servicesCatalogEditorActiveWrap');
  const activeInp = document.getElementById('servicesCatalogEditorActive');
  const overrideWrap = document.getElementById('servicesCatalogOverrideWrap');
  const overrideDefault = document.getElementById('servicesCatalogOverrideDefault');
  const overrideCustom = document.getElementById('servicesCatalogOverrideCustom');
  const overridePriceInp = document.getElementById('servicesCatalogOverridePrice');
  const saveBtn = document.getElementById('servicesCatalogEditorSave');
  if (!title || !nameInp || !saveBtn) return;

  // Reset visibility + fields
  wrapCat.style.display = 'none';
  wrapPrice.style.display = 'none';
  if (wrapDuration) wrapDuration.style.display = 'none';
  nameInp.value = '';
  nameInp.placeholder = '';
  priceInp.value = '';
  if (wrapDuration) wrapDuration.innerHTML = '';
  catSel.innerHTML = '';
  if (catSel) catSel.style.display = 'block';
  if (catTextInp) { catTextInp.style.display = 'none'; catTextInp.value = ''; }
  const existingCreateCat = document.getElementById('servicesCatalogEditorCreateCategory');
  if (existingCreateCat) existingCreateCat.style.display = 'none';
  if (activeWrap) activeWrap.style.display = 'none';
  if (activeInp) activeInp.checked = true;
  if (overrideWrap) overrideWrap.style.display = 'none';
  if (overrideDefault) overrideDefault.checked = true;
  if (overrideCustom) overrideCustom.checked = false;
  if (overridePriceInp) { overridePriceInp.style.display = 'none'; overridePriceInp.value = ''; }
  saveBtn.disabled = false;
  saveBtn.style.opacity = '1';
  const ctx = { ...opts };
  const mounts = ensureCatalogEditorComboMounts(mod);
  if (mounts && mounts.typeWrap) {
    mounts.typeWrap.style.display = 'none';
    mounts.typeWrap.innerHTML = '';
  }
  if (mounts && mounts.comboWrap) {
    mounts.comboWrap.style.display = 'none';
    mounts.comboWrap.innerHTML = '';
  }
  ctx.comboEditor = null;
  const editorCard = mod.querySelector(':scope > div');
  if (editorCard) editorCard.style.maxWidth = '420px';

  if (opts.mode === 'category-add' || opts.mode === 'shared-category-add') {
    title.textContent = 'New category';
    nameInp.placeholder = 'Category name (e.g. Manicure)';
  } else if (opts.mode === 'category-edit' || opts.mode === 'shared-category-edit') {
    const c = opts.mode === 'shared-category-edit'
      ? getSharedServicesForCatalogManager().categories.find((x) => x.id === opts.categoryId)
      : ticketsState.serviceCategories.find((x) => x.id === opts.categoryId);
    if (!c) return;
    title.textContent = 'Rename category';
    nameInp.placeholder = 'Category name';
    nameInp.value = c.name || '';
    ctx.existing = c;
  } else if (opts.mode === 'service-add' || opts.mode === 'service-edit' || opts.mode === 'shared-service-add' || opts.mode === 'shared-service-edit') {
    const isSharedServiceMode = opts.mode === 'shared-service-add' || opts.mode === 'shared-service-edit';
    title.textContent = opts.mode === 'service-add' || opts.mode === 'shared-service-add' ? 'New service' : 'Edit service';
    nameInp.placeholder = 'Service name (e.g. Gel Full Set)';
    wrapCat.style.display = 'block';
    wrapPrice.style.display = 'block';
    if (wrapDuration) wrapDuration.style.display = 'block';
    priceInp.placeholder = isSharedServiceMode ? `Default price (${ffTicketCurSym()})` : `Default price (${ffTicketCurSym()})`;
    if (wrapDuration) {
      wrapDuration.innerHTML = serviceDurationControlsHtml(30, {
        hoursId: 'servicesCatalogEditorDurationHours',
        minutesId: 'servicesCatalogEditorDurationMinutes',
        errorId: 'servicesCatalogEditorDurationError'
      });
    }
    if (catSel) catSel.style.display = 'block';
    if (catTextInp) { catTextInp.style.display = 'none'; catTextInp.value = ''; }
    fillEditorCategorySelect(catSel, opts.categoryId || opts.categoryName || '');
    const createCatBtn = ensureEditorCreateCategoryBtn(wrapCat);
    if (createCatBtn) {
      createCatBtn.style.display = 'block';
      createCatBtn.onclick = async (e) => {
        e.preventDefault();
        const entered = window.prompt('New category name', '');
        if (entered == null) return;
        const name = String(entered || '').trim();
        if (!name) return;
        try {
          const before = findExistingCatalogCategory(name, currentEditorCategories());
          const created = await createEditorCategory(name);
          if (!created) {
            showToast('Enter a category name.', 'error');
            return;
          }
          fillEditorCategorySelect(catSel, created.id || created.name);
          showToast(before ? 'Category selected' : 'Category added', 'success');
        } catch (err) {
          showToast(err?.message || 'This category could not be created.', 'error');
        }
      };
    }
    if (isSharedServiceMode) {
      if (activeWrap) activeWrap.style.display = 'flex';
      if (overrideWrap && opts.mode === 'shared-service-edit') overrideWrap.style.display = 'block';
      const syncOverrideInput = () => {
        if (!overridePriceInp) return;
        overridePriceInp.style.display = overrideCustom?.checked ? 'block' : 'none';
      };
      if (overrideDefault) overrideDefault.onchange = syncOverrideInput;
      if (overrideCustom) overrideCustom.onchange = syncOverrideInput;
    }
    if (opts.mode === 'service-edit' || opts.mode === 'shared-service-edit') {
      const s = currentEditorCatalogServices().find((x) => String(x.id) === String(opts.serviceId))
        || (isSharedServiceMode
          ? getSharedServicesForCatalogManager().services.find((x) => x.id === opts.serviceId)
          : ticketsState.salonServices.find((x) => x.id === opts.serviceId));
      if (!s) return;
      if (isSharedServiceMode) console.log('[SharedServicesUI] editing shared service', { serviceId: s.id });
      nameInp.value = s.name || '';
      priceInp.value = isSharedServiceMode
        ? (s.sharedDefaultPrice != null ? String(s.sharedDefaultPrice) : '')
        : (s.defaultPrice != null ? String(s.defaultPrice) : '');
      if (wrapDuration) {
        wrapDuration.innerHTML = serviceDurationControlsHtml(resolveServiceDurationMinutes(s), {
          hoursId: 'servicesCatalogEditorDurationHours',
          minutesId: 'servicesCatalogEditorDurationMinutes',
          errorId: 'servicesCatalogEditorDurationError'
        });
      }
      if (isSharedServiceMode) {
        fillEditorCategorySelect(catSel, s.categoryId || s.category || '');
        if (activeInp) activeInp.checked = s.active !== false;
        if (s.hasOverride) {
          if (overrideCustom) overrideCustom.checked = true;
          if (overrideDefault) overrideDefault.checked = false;
          if (overridePriceInp) {
            overridePriceInp.value = String(s.overridePrice ?? '');
            overridePriceInp.style.display = 'block';
          }
        }
      } else {
        fillEditorCategorySelect(catSel, s.categoryId || s.category || s.sourceCategoryId || '');
      }
      ctx.existing = s;
    } else if (!isSharedServiceMode) {
      if (opts.categoryId && ticketsState.serviceCategories.some((c) => c.id === opts.categoryId)) {
        catSel.value = opts.categoryId;
      }
    }
    const existing = ctx.existing || null;
    const initialType = editorServiceType(existing);
    if (mounts && mounts.typeWrap) {
      mounts.typeWrap.style.display = 'block';
      mounts.typeWrap.innerHTML = catalogServiceTypeControlsHtml(initialType, {
        groupName: 'servicesCatalogEditorServiceType',
        singleId: 'servicesCatalogEditorTypeSingle',
        comboId: 'servicesCatalogEditorTypeCombo'
      });
    }
    if (mounts && mounts.comboWrap) {
      ctx.comboEditor = wireComboEditor(mounts.comboWrap, {
        compact: false,
        comboId: existing && existing.id,
        components: existing && existing.components,
        getComboPrice: () => parseFloat(priceInp?.value) || 0,
        getCatalogServices: currentEditorCatalogServices
      });
      if (priceInp) {
        priceInp.oninput = () => {
          if (ctx.comboEditor && typeof ctx.comboEditor.refresh === 'function') ctx.comboEditor.refresh();
        };
      }
    }
    const typeInputs = mounts && mounts.typeWrap
      ? mounts.typeWrap.querySelectorAll('input[name="servicesCatalogEditorServiceType"]')
      : [];
    typeInputs.forEach((inp) => {
      inp.addEventListener('change', () => {
        syncCatalogEditorTypeUi(inp.value);
        if (ctx.comboEditor && typeof ctx.comboEditor.refresh === 'function') ctx.comboEditor.refresh();
      });
    });
    syncCatalogEditorTypeUi(initialType);
  }

  saveBtn.onclick = () => _ffCatalogEditorSubmit(ctx);
  nameInp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); _ffCatalogEditorSubmit(ctx); } };
  mod.style.display = 'flex';
  setTimeout(() => { try { nameInp.focus(); nameInp.select(); } catch (_) {} }, 50);
}

function _ffCatalogEditorClose() {
  const mod = document.getElementById('servicesCatalogEditorModal');
  if (mod) mod.style.display = 'none';
}

async function _ffCatalogEditorSubmit(ctx) {
  const nameInp = document.getElementById('servicesCatalogEditorName');
  const catSel = document.getElementById('servicesCatalogEditorCategory');
  const catTextInp = document.getElementById('servicesCatalogEditorCategoryText');
  const priceInp = document.getElementById('servicesCatalogEditorPrice');
  const durationHours = document.getElementById('servicesCatalogEditorDurationHours');
  const durationMinutesInput = document.getElementById('servicesCatalogEditorDurationMinutes');
  const durationError = document.getElementById('servicesCatalogEditorDurationError');
  const activeInp = document.getElementById('servicesCatalogEditorActive');
  const overrideCustom = document.getElementById('servicesCatalogOverrideCustom');
  const overridePriceInp = document.getElementById('servicesCatalogOverridePrice');
  const saveBtn = document.getElementById('servicesCatalogEditorSave');
  const name = String(nameInp?.value || '').trim();
  const flashErr = (el) => {
    try {
      const prev = el.style.borderColor;
      el.style.borderColor = '#ef4444';
      el.focus();
      setTimeout(() => { el.style.borderColor = prev || '#e5e7eb'; }, 1400);
    } catch (_) {}
  };
  if (!name) { flashErr(nameInp); return; }
  const isServiceMode = ctx.mode === 'service-add' || ctx.mode === 'service-edit'
    || ctx.mode === 'shared-service-add' || ctx.mode === 'shared-service-edit';
  const comboTypeInp = document.querySelector('#servicesCatalogEditorTypeWrap input[name="servicesCatalogEditorServiceType"]:checked');
  const serviceType = isServiceMode ? (comboTypeInp?.value === SERVICE_TYPE_COMBO ? SERVICE_TYPE_COMBO : 'single') : null;
  const comboComponents = (serviceType === SERVICE_TYPE_COMBO && ctx.comboEditor && typeof ctx.comboEditor.getComponents === 'function')
    ? ctx.comboEditor.getComponents()
    : [];
  const comboPrice = parseFloat(priceInp?.value) || 0;
  let durationMinutes = null;
  let comboFields = { ok: true, serviceType: 'single', components: [] };
  if (isServiceMode && serviceType === SERVICE_TYPE_COMBO) {
    comboFields = comboSaveFields({
      id: ctx.existing && ctx.existing.id,
      serviceType: SERVICE_TYPE_COMBO,
      defaultPrice: comboPrice,
      components: comboComponents,
      catalogServices: currentEditorCatalogServices()
    });
    if (!comboFields.ok) {
      showToast(comboFields.error, 'error');
      return;
    }
    durationMinutes = comboFields.durationMinutes;
    const convertingUsedSingle = ctx.existing && !isComboService(ctx.existing);
    if (convertingUsedSingle) {
      const usedBy = combosUsingService(ctx.existing.id, catalogServicesForComboUsage());
      if (usedBy.length) {
        showToast('This service is used as a Combo component, so it must stay a Single Service.', 'error');
        return;
      }
    }
  } else if (isServiceMode) {
    durationMinutes = joinServiceDurationMinutes(durationHours?.value, durationMinutesInput?.value);
    if (durationMinutes == null) {
      showServiceDurationError(durationError, durationHours, durationMinutesInput);
      return;
    }
  }

  if (isServiceMode && !requireEditorCategory(catSel)) return;

  if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '0.6'; }
  let serviceSaveToast = null;
  try {
    if (ctx.mode === 'category-add') {
      await saveServiceCategory({ name, sortOrder: ticketsState.serviceCategories.length });
      await Promise.all([loadServiceCategories(), loadServices()]);
      showToast('Category added', 'success');
    } else if (ctx.mode === 'category-edit') {
      const c = ctx.existing;
      await saveServiceCategory({ id: c.id, name, sortOrder: c.sortOrder });
      await Promise.all([loadServiceCategories(), loadServices()]);
      showToast('Updated', 'success');
    } else if (ctx.mode === 'shared-category-add') {
      const data = getSharedServicesForCatalogManager();
      const categoryId = await saveSharedServiceCategory({ name, sortOrder: data.categories.length });
      await loadSharedCatalogForManager();
      ticketsState._ffOpenCats.add(categoryId);
      showToast('Category added', 'success');
    } else if (ctx.mode === 'shared-category-edit') {
      const c = ctx.existing;
      const oldName = normalizeSharedCategoryName(c.name);
      const newName = normalizeSharedCategoryName(name);
      await saveSharedServiceCategory({ id: c.docId || c.id, name: newName, sortOrder: c.sortOrder });
      if (oldName !== newName) {
        const affected = ticketsState._rawSharedServices.filter((s) => normalizeSharedCategoryName(s.category) === oldName);
        await Promise.all(affected.map((s) => saveSharedService({
          id: s.id,
          name: s.name,
          category: newName,
          defaultPrice: s.defaultPrice,
          active: s.active !== false,
          sortOrder: s.sortOrder
        })));
      }
      await loadSharedCatalogForManager();
      ticketsState._ffOpenCats.add(sharedCategoryId(newName));
      showToast('Category updated', 'success');
    } else if (ctx.mode === 'service-add') {
      const selectedCategory = requireEditorCategory(catSel);
      if (!selectedCategory) return;
      const categoryId = selectedCategory.sourceCategoryId || selectedCategory.id;
      const defaultPrice = parseFloat(priceInp?.value) || 0;
      await saveService({
        name,
        categoryId,
        defaultPrice,
        durationMinutes,
        serviceType: comboFields.serviceType,
        components: comboFields.components
      });
      await Promise.all([loadServiceCategories(), loadServices()]);
      if (categoryId) ticketsState._ffOpenCats.add(categoryId);
      serviceSaveToast = catalogServiceSavedToast(ctx.mode);
    } else if (ctx.mode === 'service-edit') {
      const s = ctx.existing;
      const selectedCategory = requireEditorCategory(catSel);
      if (!selectedCategory) return;
      const categoryId = selectedCategory.sourceCategoryId || selectedCategory.id;
      const defaultPrice = parseFloat(priceInp?.value) || 0;
      await saveService({
        id: s.id,
        name,
        categoryId,
        defaultPrice,
        sortOrder: s.sortOrder,
        durationMinutes,
        serviceType: comboFields.serviceType,
        components: comboFields.components
      });
      await Promise.all([loadServiceCategories(), loadServices()]);
      if (categoryId) ticketsState._ffOpenCats.add(categoryId);
      serviceSaveToast = catalogServiceSavedToast(ctx.mode);
    } else if (ctx.mode === 'shared-service-add' || ctx.mode === 'shared-service-edit') {
      const s = ctx.existing || {};
      const selectedCategory = requireEditorCategory(catSel);
      if (!selectedCategory) return;
      const category = normalizeSharedCategoryName(selectedCategory.name);
      const defaultPrice = parseFloat(priceInp?.value) || 0;
      const overridePrice = parseFloat(overridePriceInp?.value);
      if (ctx.mode === 'shared-service-edit' && overrideCustom?.checked && !Number.isFinite(overridePrice)) {
        flashErr(overridePriceInp);
        return;
      }
      const serviceId = await saveSharedService({
        id: s.id,
        name,
        category,
        defaultPrice,
        active: activeInp ? activeInp.checked : true,
        sortOrder: s.sortOrder,
        durationMinutes,
        serviceType: comboFields.serviceType,
        components: comboFields.components
      });
      if (ctx.mode === 'shared-service-edit') {
        if (overrideCustom?.checked) {
          await saveSharedServiceOverride(serviceId, overridePrice);
        } else {
          await removeSharedServiceOverride(serviceId);
        }
      }
      await loadSharedCatalogForManager();
      ticketsState._ffOpenCats.add(sharedCategoryId(category));
      serviceSaveToast = catalogServiceSavedToast(ctx.mode);
    }
    _ffCatalogEditorClose();
    if (isCatalogServiceCreateMode(ctx.mode)) ticketsState._ffServicesInlineEditServiceId = null;
    renderServicesCatalogV2();
    setupTicketsUI();
    if (serviceSaveToast) showToast(serviceSaveToast, 'success');
  } catch (e) {
    showToast(e?.message || 'Failed', 'error');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.style.opacity = '1'; }
  }
}

/** Entry from header "+ Add Category" button. */
function addServiceCategoryV2() {
  if (!ffCanManageServices()) { if (typeof showToast === 'function') showToast('You do not have permission to manage services.', 'error'); return; }
  _ffCatalogEditorOpen({ mode: ticketsState._ffCatalogModalMode === 'shared' ? 'shared-category-add' : 'category-add' });
}

/** Entry from header "+ Add Service" button. */
function addSharedServiceV2() {
  if (!ffCanManageServices()) { if (typeof showToast === 'function') showToast('You do not have permission to manage services.', 'error'); return; }
  _ffCatalogEditorOpen({ mode: 'shared-service-add' });
}

export {
  _ffShowServicesCategoryDetailMenu,
  _ffShowCategoryMenu,
  _ffShowServiceMenu,
  _ffShowMoveServicePicker,
  _ffCloseAllPopovers,
  _ffBuildPopover,
  _ffClearDragHover,
  _ffWireCatalogDragDrop,
  _ffReorderCategoriesBefore,
  _ffReorderServiceBefore,
  _ffMoveServiceToCategoryEnd,
  _ffCatalogEditorOpen,
  _ffCatalogEditorClose,
  _ffCatalogEditorSubmit,
  addServiceCategoryV2,
  addSharedServiceV2,
  deleteCatalogService,
  deleteSharedCategoryWithServices,
};
