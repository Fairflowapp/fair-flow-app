/**
 * Tickets — Service Catalog V2: render layer (Phase 8b split from tickets-catalog-ui.js).
 *
 * The catalog screen/modal shell + mobile drill-down, open/close, the collapsible
 * categories+services list, the services-screen drag-drop, and the two-pane detail
 * renderer. Verbatim move; behaviour unchanged.
 *
 * Imports the per-service tab renderers from ./tickets-catalog-tabs.js and the
 * menus/DnD/editor entry points from ./tickets-catalog-edit.js (one-way: render
 * depends on tabs+edit, never the reverse — cycles are broken by injecting
 * renderServicesCatalogV2 / renderServicesScreenDetail / _ffIsServicesScreenRoot
 * into those modules from the barrel).
 *
 * showToast + setupTicketsUI are injected via initCatalogRender.
 */
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { ffCanManageServices, resolveServiceDurationMinutes, parseServiceDurationMinutesInput, getSharedServicesForCatalogManager, getLocationServicesForCatalogManager, loadSharedCatalogForManager, loadLocationCatalogForManager, saveSharedService, saveService, loadServices, loadServiceCategories } from "./tickets-catalog-data.js?v=20260818_staff_dur_ui";
import { ffTicketMoney } from "./tickets-helpers.js?v=20260721_ticket_soft_delete";
import { escapeHtml } from "./tickets-list.js?v=20260721_ticket_soft_delete";
import { renderServicesLocationsTabHtml, wireServicesLocationsTab, renderServicesStaffTabHtml, wireServicesStaffTab } from "./tickets-catalog-tabs.js?v=20260818_staff_dur_ui";
import { _ffShowServicesCategoryDetailMenu, _ffShowCategoryMenu, _ffShowServiceMenu, _ffCatalogEditorOpen, _ffCatalogEditorClose, _ffWireCatalogDragDrop, _ffClearDragHover } from "./tickets-catalog-edit.js?v=20260818_staff_dur_ui";

let showToast, setupTicketsUI;
export function initCatalogRender(deps) {
  showToast = deps.showToast;
  setupTicketsUI = deps.setupTicketsUI;
}

// =====================
// UI: Service Catalog Modal
// =====================
// =====================
// Service Catalog V2 — unified collapsible UI (per-location)
// =====================
// One screen. Each category is a header with ▸/▾ toggle; expanding reveals
// its services (name + price) and a "+ Add service" link. A top "+ Add
// Category" button and a small shared "Add/Edit" mini modal do all CRUD.
// Legacy two-tab view + subcategory concept are removed.

/** Which categories are open (in-memory; reset when the modal closes). */
/** True after the first render of the modal in the current opening. Used to
 *  auto-expand the first category so the user sees services immediately. */

function _ffCatalogRenderRoot() {
  return document.getElementById(ticketsState._ffCatalogRenderRootId || 'servicesModal') || document;
}

function _ffCatalogEl(id) {
  const root = _ffCatalogRenderRoot();
  return (root && root.querySelector ? root.querySelector('#' + id) : null) || document.getElementById(id);
}

function _ffEnsureCatalogEditorPortal() {
  const editor = document.getElementById('servicesCatalogEditorModal');
  if (editor && editor.parentElement && editor.parentElement.id === 'servicesModalInner') {
    document.body.appendChild(editor);
  }
}

function _ffIsServicesScreenRoot() {
  return ticketsState._ffCatalogRenderRootId === 'servicesScreen';
}

// ===== Services screen mobile drill-down (list -> service menu -> section) =====
// Mirrors the proven Staff Members modal pattern. On phones (<=640px) the
// two-pane desktop layout is shown one level at a time, driven by classes on
// the #servicesScreen root. No effect on desktop.
function _ffServicesScreenIsMobile() {
  try {
    return !!(window.matchMedia && window.matchMedia('(max-width: 640px)').matches);
  } catch (_) {
    return false;
  }
}

function _ffServicesMobileShowList() {
  const el = document.getElementById('servicesScreen');
  if (!el) return;
  el.classList.remove('ff-services-mobile-detail');
  el.classList.remove('ff-services-mobile-tab');
}

// mode: 'detail' (service selected -> show the Details/Locations/Staff menu)
//       'tab'    (a section was chosen -> show that section's content)
function _ffServicesMobileShowDetail(mode) {
  if (!_ffServicesScreenIsMobile()) return;
  const el = document.getElementById('servicesScreen');
  if (!el) return;
  el.classList.remove('ff-services-mobile-detail');
  el.classList.remove('ff-services-mobile-tab');
  el.classList.add(mode === 'tab' ? 'ff-services-mobile-tab' : 'ff-services-mobile-detail');
  try {
    const content = el.querySelector('.staff-content-area');
    if (content) content.scrollTop = 0;
  } catch (_) {}
}

// Back button: section -> menu, menu -> list. Delegated once.
if (typeof document !== 'undefined' && !document.__ffServicesMobileBackDelegated) {
  document.__ffServicesMobileBackDelegated = true;
  document.addEventListener('click', function (event) {
    const target = event.target && event.target.closest
      ? event.target.closest('#servicesScreen .ff-services-mobile-back')
      : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const el = document.getElementById('servicesScreen');
    if (el && el.classList.contains('ff-services-mobile-tab')) {
      el.classList.remove('ff-services-mobile-tab');
      el.classList.add('ff-services-mobile-detail');
      try {
        const content = el.querySelector('.staff-content-area');
        if (content) content.scrollTop = 0;
      } catch (_) {}
      return;
    }
    _ffServicesMobileShowList();
  }, true);
}

async function openServicesModal(opts = {}) {
  const modal = document.getElementById('servicesModal');
  if (!modal) return;
  _ffEnsureCatalogEditorPortal();
  ticketsState._ffCatalogRenderRootId = 'servicesModal';
  ticketsState._ffCatalogModalMode = opts && opts.mode === 'shared' ? 'shared' : 'location';
  ticketsState._ffOpenCats.clear();
  ticketsState._ffCatalogRenderedOnce = false;
  if (ticketsState._ffCatalogModalMode === 'shared') {
    await loadSharedCatalogForManager();
  } else {
    await loadLocationCatalogForManager();
  }
  renderServicesCatalogV2();
  modal.style.display = 'flex';
}

function closeServicesModal() {
  const modal = document.getElementById('servicesModal');
  if (modal) modal.style.display = 'none';
  _ffCatalogEditorClose();
}

/** Render the unified catalog. Keeps currently-open categories open. */
function renderServicesCatalogV2() {
  const list = _ffCatalogEl('servicesCatalogV2List');
  if (!list) return;
  const sourceBadge = _ffCatalogEl('servicesCatalogSourceBadge');
  const sourceHelp = _ffCatalogEl('servicesCatalogSourceHelp');
  const addSharedBtn = _ffCatalogEl('servicesCatalogAddSharedBtn');
  const addCategoryBtn = _ffCatalogEl('servicesCatalogAddCategoryBtn');
  const isSharedCatalog = ticketsState._ffCatalogModalMode === 'shared';
  const catalogData = isSharedCatalog
    ? getSharedServicesForCatalogManager()
    : getLocationServicesForCatalogManager();
  const catalogServices = catalogData.services || [];
  const catalogCategories = catalogData.categories || [];

  if (sourceBadge) {
    sourceBadge.textContent = isSharedCatalog ? 'Service Catalog' : 'Location Service Catalog';
    sourceBadge.style.background = isSharedCatalog ? '#ede9fe' : '#eef2ff';
    sourceBadge.style.color = isSharedCatalog ? '#5b21b6' : '#3730a3';
  }
  if (sourceHelp) {
    sourceHelp.textContent = isSharedCatalog
      ? 'Services can be managed with availability and pricing by location.'
      : 'Categories and services are saved for the active location only.';
  }
  const canManageServices = ffCanManageServices();
  if (addSharedBtn) {
    addSharedBtn.style.display = 'none';
    addSharedBtn.textContent = '+ Add Service';
  }
  if (addCategoryBtn) {
    addCategoryBtn.style.display = canManageServices ? 'inline-block' : 'none';
    addCategoryBtn.textContent = '+ Add Category';
  }

  if (!ticketsState._ffCatalogRenderedOnce && ticketsState._ffOpenCats.size === 0 && catalogCategories.length > 0) {
    if (_ffIsServicesScreenRoot()) {
      catalogCategories.forEach((cat) => ticketsState._ffOpenCats.add(cat.id));
    } else {
      ticketsState._ffOpenCats.add(catalogCategories[0].id);
    }
  }
  ticketsState._ffCatalogRenderedOnce = true;

  // Group services under each category. Services with no categoryId (or a
  // category id that no longer exists) land in a virtual "Other" bucket,
  // shown only when it actually has services.
  const grouped = new Map();
  catalogCategories.forEach((c) => grouped.set(c.id, { id: c.id, name: c.name, services: [], isSharedCategory: !!c.isSharedCategory }));
  const orphans = [];
  catalogServices.forEach((s) => {
    const bucket = s.categoryId && grouped.has(s.categoryId) ? grouped.get(s.categoryId) : null;
    if (bucket) bucket.services.push(s);
    else orphans.push(s);
  });
  if (orphans.length) grouped.set('__other__', { id: '__other__', name: 'Other', services: orphans });

  if (_ffIsServicesScreenRoot()) {
    renderServicesScreenCatalogList(list, grouped, isSharedCatalog);
    renderServicesScreenDetail(catalogServices, catalogCategories);
    return;
  }

  if (grouped.size === 0) {
    const emptyTitle = 'No categories yet';
    const emptyBody = isSharedCatalog
      ? 'Start by adding a category, then add services under it.'
      : 'Start by adding a category (e.g. <em>Manicure</em>, <em>Pedicure</em>, <em>Massage</em>), then add services under it with their prices.';
    list.innerHTML = `
      <div style="padding:36px 20px;color:#6b7280;text-align:center;font-size:14px;line-height:1.5;">
        <div style="font-size:15px;color:#111;font-weight:600;margin-bottom:6px;">${emptyTitle}</div>
        <div>${emptyBody}</div>
      </div>`;
    return;
  }

  const dotsSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="#9ca3af" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

  let html = '';
  for (const cat of grouped.values()) {
    const isOpen = ticketsState._ffOpenCats.has(cat.id);
    const arrow = isOpen ? '▾' : '▸';
    const count = cat.services.length;
    const isOther = cat.id === '__other__';
    html += `<div class="ffcat-row" data-cat-id="${escapeHtml(cat.id)}" style="margin-bottom:6px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;background:#fff;">`;
    // The HEADER itself is draggable for categories (so services inside
    // don't accidentally pick up the category drag). Services have their
    // own draggable row below.
    const canEditCategory = !isOther;
    const canDragCategory = canEditCategory && !isSharedCatalog;
    const headDraggable = canDragCategory ? `draggable="true" data-drag-kind="category" data-cat-id="${escapeHtml(cat.id)}"` : '';
    html += `<div class="ffcat-head" ${headDraggable} role="button" tabindex="0" title="${canDragCategory ? 'Drag to reorder' : ''}" style="display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:${canDragCategory ? 'grab' : 'pointer'};background:#f9fafb;user-select:none;">`;
    html += `<span class="ffcat-arrow" style="font-size:12px;color:#6b7280;width:10px;display:inline-block;">${arrow}</span>`;
    html += `<span style="font-weight:600;color:#111;font-size:13px;flex:1;line-height:1.25;">${escapeHtml(cat.name)}</span>`;
    html += `<span style="color:#9ca3af;font-size:11px;">${count}</span>`;
    if (canEditCategory) {
      html += `<button type="button" class="ffcat-menu-btn" data-cat-id="${escapeHtml(cat.id)}" title="Category actions" style="border:none;background:none;padding:2px 4px;cursor:pointer;line-height:0;border-radius:4px;">${dotsSvg}</button>`;
    }
    html += `</div>`;
    html += `<div class="ffcat-body" style="display:${isOpen ? 'block' : 'none'};padding:2px 6px 6px;">`;
    if (cat.services.length === 0) {
      html += `<div style="padding:6px 10px;color:#9ca3af;font-size:12px;">No services yet.</div>`;
    } else {
      cat.services.forEach((s) => {
        // Services that landed in the virtual "Other" bucket have no real
        // parent category — drag them only to re-home into a real one.
        const canDragService = !isSharedCatalog;
        const serviceDragAttrs = canDragService ? `draggable="true" data-drag-kind="service"` : '';
        const serviceOpacity = s.active === false ? 'opacity:0.62;' : '';
        const priceBadge = isSharedCatalog && s.hasOverride
          ? `<span style="padding:2px 6px;border-radius:999px;background:#dbeafe;color:#1d4ed8;font-size:10px;font-weight:700;white-space:nowrap;">Override: ${ffTicketMoney(s.overridePrice || 0)}</span>`
          : (isSharedCatalog ? `<span style="padding:2px 6px;border-radius:999px;background:#f3f4f6;color:#4b5563;font-size:10px;font-weight:700;white-space:nowrap;">Default</span>` : '');
        const inactiveBadge = isSharedCatalog && s.active === false
          ? `<span style="padding:2px 6px;border-radius:999px;background:#fee2e2;color:#b91c1c;font-size:10px;font-weight:700;white-space:nowrap;">Inactive</span>`
          : '';
        html += `<div class="ffsvc-row" ${serviceDragAttrs} data-svc-id="${escapeHtml(s.id)}" data-cat-id="${escapeHtml(cat.id)}" title="${canDragService ? 'Drag to reorder / move' : ''}" style="display:flex;align-items:center;gap:8px;padding:5px 10px 5px 18px;border-bottom:1px solid #f3f4f6;cursor:${canDragService ? 'grab' : 'default'};${serviceOpacity}">`;
        html += `<span style="font-weight:500;color:#111;font-size:12px;flex:1;line-height:1.25;">${escapeHtml(s.name)}</span>`;
        html += priceBadge;
        html += inactiveBadge;
        html += `<span style="color:#374151;font-size:12px;font-variant-numeric:tabular-nums;">${ffTicketMoney(s.defaultPrice || 0)}</span>`;
        html += `<button type="button" class="ffsvc-menu-btn" data-svc-id="${escapeHtml(s.id)}" title="Service actions" style="border:none;background:none;padding:2px 4px;cursor:pointer;line-height:0;border-radius:4px;">${dotsSvg}</button>`;
        html += `</div>`;
      });
    }
    if (!isOther) {
      const addMode = isSharedCatalog ? 'shared' : 'location';
      const addLabel = isSharedCatalog ? '+ Add Service' : '+ Add service';
      html += `<div style="padding:4px 6px;"><button type="button" class="ffcat-addsvc-btn" data-cat-id="${escapeHtml(cat.id)}" data-add-mode="${addMode}" style="background:none;border:none;color:#7c3aed;font-weight:600;font-size:12px;padding:4px 6px;cursor:pointer;text-align:left;">${addLabel}</button></div>`;
    }
    html += `</div></div>`;
  }
  list.innerHTML = html;
  if (!ffCanManageServices()) {
    list.querySelectorAll('.ffcat-addsvc-btn, .ffcat-menu-btn, .ffsvc-menu-btn').forEach((el) => { el.style.display = 'none'; });
    list.querySelectorAll('[data-drag-kind], .ff-services-drag-handle, .ff-catalog-drag-handle').forEach((el) => { el.style.display = 'none'; el.removeAttribute('draggable'); });
  }
  _ffWireCatalogDragDrop(list);

  // Wire: expand/collapse on header click (but not when clicking the menu).
  list.querySelectorAll('.ffcat-head').forEach((head) => {
    head.addEventListener('click', (e) => {
      if (e.target.closest('.ffcat-menu-btn')) return;
      const row = head.closest('.ffcat-row');
      const catId = row?.getAttribute('data-cat-id');
      if (!catId) return;
      if (ticketsState._ffOpenCats.has(catId)) ticketsState._ffOpenCats.delete(catId); else ticketsState._ffOpenCats.add(catId);
      renderServicesCatalogV2();
    });
  });
  // Wire: category action menu
  list.querySelectorAll('.ffcat-menu-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const catId = btn.getAttribute('data-cat-id');
      _ffShowCategoryMenu(btn, catId);
    });
  });
  // Wire: add service inside a category
  list.querySelectorAll('.ffcat-addsvc-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const catId = btn.getAttribute('data-cat-id');
      ticketsState._ffOpenCats.add(catId);
      if (btn.getAttribute('data-add-mode') === 'shared') {
        const cat = getSharedServicesForCatalogManager().categories.find((c) => c.id === catId);
        _ffCatalogEditorOpen({ mode: 'shared-service-add', categoryName: cat?.name || '' });
      } else {
        _ffCatalogEditorOpen({ mode: 'service-add', categoryId: catId });
      }
    });
  });
  // Wire: service action menu
  list.querySelectorAll('.ffsvc-menu-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const svcId = btn.getAttribute('data-svc-id');
      _ffShowServiceMenu(btn, svcId);
    });
  });
}

function renderServicesScreenCatalogList(list, grouped, isSharedCatalog) {
  if (!grouped || grouped.size === 0) {
    list.innerHTML = '<div style="padding:0 20px 20px;color:#6b7280;font-size:12px;line-height:1.5;">No categories yet. Use + Add Category above.</div>';
    return;
  }

  let html = '';
  for (const cat of grouped.values()) {
    const isOther = cat.id === '__other__';
    const canEditCategory = !isOther;
    const isOpen = ticketsState._ffOpenCats.has(cat.id);
    const arrow = isOpen ? '▾' : '▸';
    const isCategorySelected = String(cat.id) === String(ticketsState._ffSelectedCategoryId || '');
    html += `<div class="staff-sidebar-section" style="padding:0 16px 12px 16px;border-top:1px solid var(--border);padding-top:12px;">`;
    html += `<div style="display:flex;align-items:center;gap:6px;margin:0 0 6px 0;">`;
    html += `<button type="button" class="ff-services-cat-toggle" data-cat-id="${escapeHtml(cat.id)}" aria-expanded="${isOpen ? 'true' : 'false'}" style="border:none;background:none;color:#6b7280;cursor:pointer;font-size:14px;line-height:1;padding:2px;width:16px;flex-shrink:0;">${arrow}</button>`;
    html += `<button type="button" class="ff-services-category-title${isCategorySelected ? ' is-selected' : ''}" data-cat-id="${escapeHtml(cat.id)}" ${canEditCategory ? '' : 'disabled'} style="margin:0;font-size:11px;font-weight:500;color:#6b7280;text-transform:none;letter-spacing:0;flex:1;text-align:left;border:none;background:${isCategorySelected ? '#ede9fe' : 'transparent'};border-radius:6px;padding:4px 6px;cursor:${canEditCategory ? 'pointer' : 'default'};">${escapeHtml(cat.name)}</button>`;
    html += `</div>`;
    html += `<div class="ff-services-cat-services" data-cat-id="${escapeHtml(cat.id)}" style="display:${isOpen ? 'flex' : 'none'};flex-direction:column;gap:4px;">`;
    if (cat.services.length === 0) {
      html += `<div style="padding:6px 8px;color:#9ca3af;font-size:12px;">No services yet.</div>`;
    } else {
      cat.services.forEach((s) => {
        const isSelected = String(s.id) === String(ticketsState._ffSelectedServiceId || '');
        const serviceOpacity = s.active === false ? 'opacity:0.62;' : '';
        html += `<div class="staff-sidebar-item ff-services-sidebar-service${isSelected ? ' is-selected' : ''}" data-svc-id="${escapeHtml(s.id)}" data-cat-id="${escapeHtml(cat.id)}" style="width:100%;display:flex;align-items:center;gap:6px;padding:8px 8px;border:none;border-radius:6px;background:${isSelected ? '#ede9fe' : 'transparent'};cursor:pointer;text-align:left;${serviceOpacity}">`;
        html += `<span class="ff-services-drag-handle" draggable="true" data-drag-kind="service" data-svc-id="${escapeHtml(s.id)}" data-cat-id="${escapeHtml(cat.id)}" title="Drag to reorder" style="color:#9ca3af;font-size:12px;line-height:1;cursor:grab;user-select:none;flex-shrink:0;">⋮⋮</span>`;
        html += `<span style="font-size:12px;color:#111827;line-height:1.25;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(s.name || '')}</span>`;
        html += `</div>`;
      });
    }
    if (!isOther) {
      const addMode = isSharedCatalog ? 'shared' : 'location';
      const addLabel = '+ Add Service';
      html += `<button type="button" class="ffcat-addsvc-btn" data-cat-id="${escapeHtml(cat.id)}" data-add-mode="${addMode}" style="width:100%;background:none;border:none;color:#7c3aed;font-weight:600;font-size:12px;padding:6px 8px;cursor:pointer;text-align:left;border-radius:6px;">${addLabel}</button>`;
    }
    html += `</div></div>`;
  }

  list.innerHTML = html;
  if (!ffCanManageServices()) {
    list.querySelectorAll('.ffcat-addsvc-btn, .ffcat-menu-btn, .ffsvc-menu-btn').forEach((el) => { el.style.display = 'none'; });
    list.querySelectorAll('[data-drag-kind], .ff-services-drag-handle, .ff-catalog-drag-handle').forEach((el) => { el.style.display = 'none'; el.removeAttribute('draggable'); });
  }

  list.querySelectorAll('.ff-services-cat-toggle').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const catId = btn.getAttribute('data-cat-id');
      if (!catId) return;
      if (ticketsState._ffOpenCats.has(catId)) ticketsState._ffOpenCats.delete(catId); else ticketsState._ffOpenCats.add(catId);
      renderServicesCatalogV2();
    });
  });
  list.querySelectorAll('.ff-services-category-title').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const catId = btn.getAttribute('data-cat-id');
      if (!catId) return;
      ticketsState._ffSelectedCategoryId = catId;
      ticketsState._ffSelectedServiceId = null;
      ticketsState._ffServicesInlineEditServiceId = null;
      renderServicesCatalogV2();
      // Mobile: open the category detail full-screen.
      _ffServicesMobileShowDetail('detail');
    });
  });
  list.querySelectorAll('.ffcat-addsvc-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const catId = btn.getAttribute('data-cat-id');
      ticketsState._ffOpenCats.add(catId);
      if (btn.getAttribute('data-add-mode') === 'shared') {
        const cat = getSharedServicesForCatalogManager().categories.find((c) => c.id === catId);
        _ffCatalogEditorOpen({ mode: 'shared-service-add', categoryName: cat?.name || '' });
      } else {
        _ffCatalogEditorOpen({ mode: 'service-add', categoryId: catId });
      }
    });
  });
  list.querySelectorAll('.ff-services-sidebar-service').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.ffsvc-menu-btn')) return;
      ticketsState._ffSelectedServiceId = btn.getAttribute('data-svc-id');
      ticketsState._ffSelectedCategoryId = null;
      if (String(ticketsState._ffServicesInlineEditServiceId || '') !== String(ticketsState._ffSelectedServiceId || '')) {
        ticketsState._ffServicesInlineEditServiceId = null;
      }
      renderServicesCatalogV2();
      // Mobile: open the service menu (Details/Locations/Staff) full-screen.
      _ffServicesMobileShowDetail('detail');
    });
  });
  _ffWireServicesScreenDragDrop(list);
}

function _ffWireServicesScreenDragDrop(listEl) {
  listEl.addEventListener('dragstart', (e) => {
    const handle = e.target.closest('.ff-services-drag-handle[data-drag-kind="service"]');
    if (!handle) return;
    const row = handle.closest('.ff-services-sidebar-service');
    ticketsState._ffDragSrc = {
      kind: 'service',
      catId: handle.getAttribute('data-cat-id') || null,
      svcId: handle.getAttribute('data-svc-id') || null,
    };
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', ticketsState._ffDragSrc.svcId || '');
    } catch (_) {}
    if (row) row.style.opacity = '0.4';
  });

  listEl.addEventListener('dragend', (e) => {
    const row = e.target.closest('.ff-services-sidebar-service');
    if (row) row.style.opacity = '';
    _ffClearDragHover();
    ticketsState._ffDragSrc = null;
  });

  listEl.addEventListener('dragover', (e) => {
    if (!ticketsState._ffDragSrc || ticketsState._ffDragSrc.kind !== 'service') return;
    const targetSvc = e.target.closest('.ff-services-sidebar-service');
    if (
      !targetSvc ||
      targetSvc.getAttribute('data-svc-id') === ticketsState._ffDragSrc.svcId ||
      targetSvc.getAttribute('data-cat-id') !== ticketsState._ffDragSrc.catId
    ) {
      if (ticketsState._ffDragHoverEl) _ffClearDragHover();
      return;
    }
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
    if (targetSvc !== ticketsState._ffDragHoverEl) {
      _ffClearDragHover();
      ticketsState._ffDragHoverEl = targetSvc;
    }
    const rect = targetSvc.getBoundingClientRect();
    const placeAfter = e.clientY > rect.top + rect.height / 2;
    targetSvc.dataset.dropPosition = placeAfter ? 'after' : 'before';
    targetSvc.style.boxShadow = placeAfter
      ? 'inset 0 -2px 0 0 #7c3aed'
      : 'inset 0 2px 0 0 #7c3aed';
  });

  listEl.addEventListener('drop', async (e) => {
    if (!ticketsState._ffDragSrc || ticketsState._ffDragSrc.kind !== 'service') return;
    const targetSvc = e.target.closest('.ff-services-sidebar-service');
    const src = ticketsState._ffDragSrc;
    _ffClearDragHover();
    ticketsState._ffDragSrc = null;
    if (
      !targetSvc ||
      targetSvc.getAttribute('data-svc-id') === src.svcId ||
      targetSvc.getAttribute('data-cat-id') !== src.catId
    ) {
      return;
    }
    e.preventDefault();
    try {
      await _ffReorderServiceWithinCategory(
        src.svcId,
        targetSvc.getAttribute('data-svc-id'),
        src.catId,
        targetSvc.dataset.dropPosition === 'after'
      );
      await loadServices();
      renderServicesCatalogV2();
    } catch (err) {
      console.error('[Services] Reorder failed', err);
      showToast(err?.message || 'Reorder failed', 'error');
    }
  });
}

async function _ffReorderServiceWithinCategory(srcId, targetSvcId, categoryId, placeAfter) {
  if (!categoryId || categoryId === '__other__') return;
  const src = ticketsState.salonServices.find(s => s.id === srcId);
  if (!src || src.categoryId !== categoryId) return;
  const siblings = ticketsState.salonServices
    .filter(s => s.categoryId === categoryId && s.id !== srcId)
    .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
  const targetIdx = siblings.findIndex(s => s.id === targetSvcId);
  if (targetIdx < 0) return;
  siblings.splice(targetIdx + (placeAfter ? 1 : 0), 0, src);
  await Promise.all(siblings.map((s, idx) => saveService({
    id: s.id,
    name: s.name,
    categoryId,
    defaultPrice: s.defaultPrice || 0,
    sortOrder: idx,
  })));
}

function renderServicesScreenDetail(catalogServices, catalogCategories) {
  const root = document.getElementById('servicesScreen');
  if (!root) return;
  const placeholder = root.querySelector('#servicesDetailPlaceholder');
  const container = root.querySelector('#servicesDetailContainer');
  const header = root.querySelector('#servicesDetailHeader');
  const nav = root.querySelector('#servicesDetailNav');
  const content = root.querySelector('#servicesDetailTabContent');
  if (!placeholder || !container || !header || !nav || !content) return;

  const services = Array.isArray(catalogServices) ? catalogServices : [];
  const categories = Array.isArray(catalogCategories) ? catalogCategories : [];
  let selectedService = services.find((s) => String(s.id) === String(ticketsState._ffSelectedServiceId || ''));
  if (!selectedService && ticketsState._ffSelectedServiceId) ticketsState._ffSelectedServiceId = null;
  let selectedCategory = categories.find((c) => String(c.id) === String(ticketsState._ffSelectedCategoryId || ''));
  if (!selectedCategory && ticketsState._ffSelectedCategoryId) ticketsState._ffSelectedCategoryId = null;
  if (!selectedService && !selectedCategory) {
    placeholder.style.display = 'flex';
    container.style.display = 'none';
    return;
  }

  placeholder.style.display = 'none';
  container.style.display = 'block';

  if (selectedCategory && !selectedService) {
    const categoryMode = ticketsState._ffCatalogModalMode === 'shared' ? 'shared-category-edit' : 'category-edit';
    nav.innerHTML = `
      <button type="button" class="staff-nav-item is-active" style="width:100%;padding:8px 10px;min-height:36px;border:none;border-radius:6px;font-size:12px;cursor:pointer;text-align:left;">Details</button>
    `;
    header.innerHTML = `
      <div style="padding:8px 0 4px;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;">
        <div style="min-width:0;">
          <div style="font-size:22px;font-weight:800;color:#111827;line-height:1.2;">${escapeHtml(selectedCategory.name || 'Category')}</div>
        </div>
        <button type="button" id="servicesCategoryActionsBtn" title="Category actions" style="width:32px;height:32px;border:1px solid var(--border);background:#fff;border-radius:999px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#6b7280;font-weight:800;line-height:1;flex-shrink:0;">...</button>
      </div>
    `;
    content.innerHTML = `
      <div style="padding:14px;background:#fff;border:1px solid var(--border);border-radius:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;">
          <div style="font-size:14px;font-weight:700;color:#111827;">Details</div>
          <button type="button" id="servicesCategoryEditBtn" style="padding:7px 12px;background:#fff;color:#7c3aed;border:1px solid #e9d5ff;border-radius:999px;cursor:pointer;font-size:12px;font-weight:700;">Edit</button>
        </div>
        <div style="display:flex;flex-direction:column;border-top:1px solid #f3f4f6;">
          <div style="display:grid;grid-template-columns:160px 1fr;gap:12px;padding:8px 0;border-bottom:1px solid #f3f4f6;">
            <div style="font-size:12px;color:#6b7280;">Category name</div>
            <div style="font-size:13px;color:#111827;font-weight:600;">${escapeHtml(selectedCategory.name || '')}</div>
          </div>
        </div>
      </div>
    `;
    const categoryActionsBtn = root.querySelector('#servicesCategoryActionsBtn');
    if (categoryActionsBtn) {
      categoryActionsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        _ffShowServicesCategoryDetailMenu(categoryActionsBtn, String(selectedCategory.id));
      });
    }
    const categoryEditBtn = root.querySelector('#servicesCategoryEditBtn');
    if (categoryEditBtn) {
      categoryEditBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        _ffCatalogEditorOpen({ mode: categoryMode, categoryId: selectedCategory.id });
      });
    }
    return;
  }

  const selected = selectedService;
  const durationMinutes = resolveServiceDurationMinutes(selected);
  const durationText = `${durationMinutes} min`;
  const isInlineEditingService = String(ticketsState._ffServicesInlineEditServiceId || '') === String(selected.id || '');
  const activeServiceTab = ticketsState._ffServicesDetailTab || 'details';
  const basePrice = Number(selected.sharedDefaultPrice ?? selected.defaultPrice) || 0;
  const categoryOptions = categories
    .filter((cat) => cat.id !== '__other__')
    .map((cat) => `<option value="${escapeHtml(cat.name || cat.id)}" ${String(cat.id) === String(selected.categoryId || '') ? 'selected' : ''}>${escapeHtml(cat.name || '')}</option>`)
    .join('');
  nav.innerHTML = `
    <button type="button" class="staff-nav-item${activeServiceTab === 'details' ? ' is-active' : ''}" data-services-tab="details" style="width:100%;padding:8px 10px;min-height:36px;border:none;border-radius:6px;font-size:12px;cursor:pointer;text-align:left;">Details</button>
    <button type="button" class="staff-nav-item${activeServiceTab === 'locations' ? ' is-active' : ''}" data-services-tab="locations" style="width:100%;padding:8px 10px;min-height:36px;border:none;border-radius:6px;font-size:12px;cursor:pointer;text-align:left;">Locations</button>
    <button type="button" class="staff-nav-item${activeServiceTab === 'staff' ? ' is-active' : ''}" data-services-tab="staff" style="width:100%;padding:8px 10px;min-height:36px;border:none;border-radius:6px;font-size:12px;cursor:pointer;text-align:left;">Staff</button>
  `;
  header.innerHTML = `
    <div style="padding:8px 0 4px;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;">
      <div style="min-width:0;">
        <div style="font-size:22px;font-weight:800;color:#111827;line-height:1.2;">${escapeHtml(selected.name || 'Service')}</div>
        <div style="margin-top:6px;font-size:14px;color:#6b7280;font-weight:600;">${ffTicketMoney(basePrice)}</div>
      </div>
      <button type="button" id="servicesDetailActionsBtn" title="Service actions" style="width:32px;height:32px;border:1px solid var(--border);background:#fff;border-radius:999px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#6b7280;font-weight:800;line-height:1;flex-shrink:0;">...</button>
    </div>
  `;
  if (activeServiceTab === 'locations') {
    content.innerHTML = renderServicesLocationsTabHtml(selected);
    wireServicesLocationsTab(root, selected);
  } else if (activeServiceTab === 'staff') {
    content.innerHTML = renderServicesStaffTabHtml(selected);
    wireServicesStaffTab(root, selected);
  } else {
    content.innerHTML = isInlineEditingService ? `
    <div style="padding:14px;background:#fff;border:1px solid var(--border);border-radius:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;">
        <div style="font-size:14px;font-weight:700;color:#111827;">Details</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button type="button" id="servicesInlineEditCancelBtn" style="padding:7px 12px;background:#fff;color:#374151;border:1px solid #e5e7eb;border-radius:999px;cursor:pointer;font-size:12px;font-weight:700;">Cancel</button>
          <button type="button" id="servicesInlineEditSaveBtn" style="padding:7px 12px;background:#7c3aed;color:#fff;border:1px solid #7c3aed;border-radius:999px;cursor:pointer;font-size:12px;font-weight:700;">Save</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;border-top:1px solid #f3f4f6;">
        <label style="display:grid;grid-template-columns:160px 1fr;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid #f3f4f6;">
          <span style="font-size:12px;color:#6b7280;">Service Name</span>
          <input id="servicesInlineEditName" type="text" value="${escapeHtml(selected.name || '')}" style="width:100%;max-width:420px;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;box-sizing:border-box;">
        </label>
        <label style="display:grid;grid-template-columns:160px 1fr;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid #f3f4f6;">
          <span style="font-size:12px;color:#6b7280;">Category</span>
          <select id="servicesInlineEditCategory" style="width:100%;max-width:420px;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;background:#fff;box-sizing:border-box;">
            <option value="">No category</option>
            ${categoryOptions}
          </select>
        </label>
        <label style="display:grid;grid-template-columns:160px 1fr;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid #f3f4f6;">
          <span style="font-size:12px;color:#6b7280;">Price</span>
          <input id="servicesInlineEditPrice" type="number" min="0" step="0.01" value="${escapeHtml(String(basePrice))}" style="width:100%;max-width:180px;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;box-sizing:border-box;">
        </label>
        <label style="display:grid;grid-template-columns:160px 1fr;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid #f3f4f6;">
          <span style="font-size:12px;color:#6b7280;">Duration</span>
          <span style="display:flex;align-items:center;gap:8px;">
            <input id="servicesInlineEditDuration" type="number" min="1" max="1440" step="1" value="${escapeHtml(String(durationMinutes))}" style="width:100%;max-width:180px;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;box-sizing:border-box;">
            <span style="font-size:11px;color:#9ca3af;">min</span>
          </span>
        </label>
        <label style="display:grid;grid-template-columns:160px 1fr;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid #f3f4f6;">
          <span style="font-size:12px;color:#6b7280;">Charge Tax</span>
          <span style="display:flex;align-items:center;gap:8px;">
            <span class="ff-toggle-switch"><input id="servicesInlineEditTaxable" type="checkbox" ${selected.taxable === true ? 'checked' : ''}><span class="ff-toggle-slider"></span></span>
            <span style="font-size:11px;color:#9ca3af;line-height:1.35;">Apply Service Tax to this service (only when Service Tax is enabled in Settings).</span>
          </span>
        </label>
      </div>
    </div>
  ` : `
    <div style="padding:14px;background:#fff;border:1px solid var(--border);border-radius:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;">
        <div style="font-size:14px;font-weight:700;color:#111827;">Details</div>
        <button type="button" id="servicesDetailEditBtn" style="padding:7px 12px;background:#fff;color:#7c3aed;border:1px solid #e9d5ff;border-radius:999px;cursor:pointer;font-size:12px;font-weight:700;">Edit</button>
      </div>
      <div style="display:flex;flex-direction:column;border-top:1px solid #f3f4f6;">
        <div style="display:grid;grid-template-columns:160px 1fr;gap:12px;padding:8px 0;border-bottom:1px solid #f3f4f6;">
          <div style="font-size:12px;color:#6b7280;">Service name</div>
          <div style="font-size:13px;color:#111827;font-weight:600;">${escapeHtml(selected.name || '')}</div>
        </div>
        <div style="display:grid;grid-template-columns:160px 1fr;gap:12px;padding:8px 0;border-bottom:1px solid #f3f4f6;">
          <div style="font-size:12px;color:#6b7280;">Price</div>
          <div style="font-size:13px;color:#111827;font-weight:600;">${ffTicketMoney(basePrice)}</div>
        </div>
        <div style="display:grid;grid-template-columns:160px 1fr;gap:12px;padding:8px 0;border-bottom:1px solid #f3f4f6;">
          <div style="font-size:12px;color:#6b7280;">Duration</div>
          <div style="font-size:13px;color:#111827;font-weight:600;">${escapeHtml(durationText)}</div>
        </div>
        <div style="display:grid;grid-template-columns:160px 1fr;gap:12px;padding:8px 0;border-bottom:1px solid #f3f4f6;">
          <div style="font-size:12px;color:#6b7280;">Charge Tax</div>
          <div style="font-size:13px;color:#111827;font-weight:600;">${selected.taxable === true ? 'On' : 'Off'}</div>
        </div>
      </div>
    </div>
  `;
  }
  root.querySelectorAll('#servicesDetailNav [data-services-tab]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      ticketsState._ffServicesDetailTab = btn.getAttribute('data-services-tab') || 'details';
      ticketsState._ffServicesInlineEditServiceId = null;
      renderServicesCatalogV2();
      // Mobile: drill into the chosen section (Details/Locations/Staff).
      _ffServicesMobileShowDetail('tab');
    });
  });
  const canManageServicesDetail = ffCanManageServices();
  const actionsBtn = root.querySelector('#servicesDetailActionsBtn');
  if (actionsBtn) {
    if (!canManageServicesDetail) {
      actionsBtn.style.display = 'none';
    } else {
      actionsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        _ffShowServiceMenu(actionsBtn, String(selected.id));
      });
    }
  }
  const editBtn = root.querySelector('#servicesDetailEditBtn');
  if (editBtn) {
    if (!canManageServicesDetail) {
      editBtn.style.display = 'none';
    } else {
      editBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        ticketsState._ffServicesInlineEditServiceId = selected.id;
        renderServicesCatalogV2();
      });
    }
  }
  const cancelBtn = root.querySelector('#servicesInlineEditCancelBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      ticketsState._ffServicesInlineEditServiceId = null;
      renderServicesCatalogV2();
    });
  }
  const saveBtn = root.querySelector('#servicesInlineEditSaveBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const nameInput = root.querySelector('#servicesInlineEditName');
      const categoryInput = root.querySelector('#servicesInlineEditCategory');
      const priceInput = root.querySelector('#servicesInlineEditPrice');
      const durationInput = root.querySelector('#servicesInlineEditDuration');
      const name = String(nameInput?.value || '').trim();
      if (!name) {
        if (nameInput) nameInput.focus();
        showToast('Service name is required', 'error');
        return;
      }
      const durationMinutes = parseServiceDurationMinutesInput(durationInput?.value);
      if (durationMinutes == null) {
        if (durationInput) {
          const prev = durationInput.style.borderColor;
          durationInput.style.borderColor = '#ef4444';
          durationInput.focus();
          setTimeout(() => { durationInput.style.borderColor = prev || '#e5e7eb'; }, 1400);
        }
        showToast('Duration must be a whole number of minutes (1–1440).', 'error');
        return;
      }
      const categoryId = categoryInput?.value || null;
      const defaultPrice = parseFloat(priceInput?.value) || 0;
      const taxableInput = root.querySelector('#servicesInlineEditTaxable');
      const taxable = !!(taxableInput && taxableInput.checked);
      saveBtn.disabled = true;
      saveBtn.style.opacity = '0.7';
      try {
        if (selected.isSharedService || ticketsState._ffCatalogModalMode === 'shared') {
          await saveSharedService({
            id: selected.id,
            name,
            category: categoryId || selected.category || '',
            defaultPrice,
            active: selected.active !== false,
          sortOrder: selected.sortOrder,
            taxable,
            durationMinutes,
          });
          await loadSharedCatalogForManager();
        } else {
          await saveService({
            id: selected.id,
            name,
            categoryId,
            defaultPrice,
          sortOrder: Number.isFinite(Number(selected.sortOrder)) ? Number(selected.sortOrder) : 0,
            taxable,
            durationMinutes,
          });
          await Promise.all([loadServiceCategories(), loadServices()]);
        }
        selected.name = name;
        selected.categoryId = categoryId;
        selected.defaultPrice = defaultPrice;
        selected.taxable = taxable;
        selected.durationMinutes = durationMinutes;
        ticketsState._ffServicesInlineEditServiceId = null;
        if (categoryId) ticketsState._ffOpenCats.add(categoryId);
        renderServicesCatalogV2();
        if (typeof setupTicketsUI === 'function') setupTicketsUI();
        showToast('Updated', 'success');
      } catch (err) {
        showToast(err?.message || 'Failed', 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.style.opacity = '1';
      }
    });
  }
}


export {
  _ffCatalogRenderRoot,
  _ffCatalogEl,
  _ffEnsureCatalogEditorPortal,
  _ffIsServicesScreenRoot,
  _ffServicesScreenIsMobile,
  _ffServicesMobileShowList,
  _ffServicesMobileShowDetail,
  openServicesModal,
  closeServicesModal,
  renderServicesCatalogV2,
  renderServicesScreenCatalogList,
  _ffWireServicesScreenDragDrop,
  _ffReorderServiceWithinCategory,
  renderServicesScreenDetail,
};
