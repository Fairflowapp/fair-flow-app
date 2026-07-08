/**
 * Tickets Picker / Setup Module
 * Extracted verbatim from tickets.js (Phase 9c).
 * Ticket service-search (UI filter over the loaded catalog) + main setupTicketsUI,
 * new-ticket button visibility, and the background-subscription bootstrap.
 *
 * tickets.js-resident helpers are injected via initTicketsPicker to avoid cycles.
 */

import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { ffTicketMoney } from "./tickets-helpers.js?v=20260630_tickets_helpers_split";
import { _ticketsCurrentStaffRow, updateTicketsTabsVisibility } from "./tickets-permissions.js?v=20260630_tickets_permissions_split";
import { escapeHtml } from "./tickets-list.js?v=20260630_tickets_list_split";
import { subscribeTickets } from "./tickets-crud.js?v=20260708_ticket_void";
import { addProductToTicket } from "./tickets-modal.js?v=20260708_ticket_void";
import { canStaffSendNewTicket } from "./tickets-catalog-ui.js?v=20260630_tickets_catalog_ui_split3";
import { subscribeProductsCatalog } from "./tickets-catalog-data.js?v=20260704_tickets_catalog_data_unsplit";

let doServiceSelect, getActiveTicketsSalonId, getProductsGroupedByCategory, getServicesGroupedByCategory, getTicketPriceForProductAndActiveLocation, isTicketPickerServiceAvailableForActiveLocation;

export function initTicketsPicker(deps) {
  doServiceSelect = deps.doServiceSelect;
  getActiveTicketsSalonId = deps.getActiveTicketsSalonId;
  getProductsGroupedByCategory = deps.getProductsGroupedByCategory;
  getServicesGroupedByCategory = deps.getServicesGroupedByCategory;
  getTicketPriceForProductAndActiveLocation = deps.getTicketPriceForProductAndActiveLocation;
  isTicketPickerServiceAvailableForActiveLocation = deps.isTicketPickerServiceAvailableForActiveLocation;
}

// =====================
// Ticket service search (UI-only filter over the already-loaded catalog)
// =====================
// Filters the SAME salonServices / serviceCategories arrays the picker renders
// from — no separate list, no duplication. Selecting a result goes through the
// exact same doServiceSelect(svc) path as the normal category list, so pricing,
// location overrides, taxes, fees and supply deductions are untouched.

function ffTicketServiceSearchClear() {
  const input = document.getElementById('ticketServiceSearchInput');
  if (input) input.value = '';
  ffRenderTicketServiceSearch();
}

function ffTicketServiceSearchSetVisible(show) {
  const wrap = document.getElementById('ticketServiceSearchWrap');
  if (wrap) wrap.style.display = show ? 'block' : 'none';
}

function ffRenderTicketServiceSearch() {
  const catalog = document.getElementById('ticketServiceCatalogList');
  const results = document.getElementById('ticketServiceSearchResults');
  if (!catalog || !results) return;

  const input = document.getElementById('ticketServiceSearchInput');
  const query = input ? String(input.value || '').trim() : '';

  // Empty query → restore the normal categories view exactly as-is.
  if (!query) {
    results.style.display = 'none';
    results.innerHTML = '';
    catalog.style.display = '';
    return;
  }

  // Multi-word partial match, case-insensitive, against service name + category
  // name ("gel mani" matches "Gel Manicure").
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const catNameById = new Map(ticketsState.serviceCategories.map((c) => [c.id, c.name]));
  const matches = ticketsState.salonServices
    .filter(isTicketPickerServiceAvailableForActiveLocation)
    .filter((s) => {
      const catLabel = catNameById.get(s.categoryId) || s.category || 'Other';
      const hay = `${String(s.name || '')} ${String(catLabel)}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });

  catalog.style.display = 'none';
  results.style.display = 'block';

  if (!matches.length) {
    results.innerHTML = '<div style="padding:10px 8px;color:#6b7280;font-size:12px;">No services found</div>';
    return;
  }

  results.innerHTML = matches.map((s) => {
    const catLabel = catNameById.get(s.categoryId) || s.category || 'Other';
    return `<button type="button" class="ticket-service-btn" data-id="${s.id}" style="display:block;width:100%;text-align:left;padding:5px 8px;margin-bottom:3px;border:1px solid #e5e7eb;border-radius:4px;background:#fff;cursor:pointer;font-size:12px;transition:background 0.15s;">${escapeHtml(s.name)} <span style="color:#6b7280;font-size:11px;">${ffTicketMoney(s.defaultPrice || 0)}</span><span style="display:block;font-size:10px;color:#9ca3af;">${escapeHtml(catLabel)}</span></button>`;
  }).join('');

  results.querySelectorAll('.ticket-service-btn').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      const svc = ticketsState.salonServices.find((x) => x.id === id);
      doServiceSelect(svc);
    };
  });
}

function ffTicketServiceSearchWire() {
  const input = document.getElementById('ticketServiceSearchInput');
  if (!input || input._ffSearchWired) return;
  input._ffSearchWired = true;
  input.addEventListener('input', ffRenderTicketServiceSearch);
}

function updateNewTicketButtonVisibility() {
  const newTicketBtn = document.getElementById('ticketsNewBtn');
  if (!newTicketBtn) return;
  if (!ticketsState.currentUserProfile) {
    newTicketBtn.style.display = 'none';
    return;
  }
  const staff = _ticketsCurrentStaffRow();
  if (staff) {
    newTicketBtn.style.display = canStaffSendNewTicket(staff) ? 'inline-flex' : 'none';
    return;
  }
  // Fallback only when the salon staff row is not hydrated yet.
  const profileRole = (ticketsState.currentUserProfile?.role || '').toLowerCase();
  newTicketBtn.style.display = ['owner', 'admin', 'manager'].includes(profileRole) ? 'none' : 'inline-flex';
}

function ensureTicketsBackgroundSubscription(attempt = 0) {
  if (!ticketsState.currentUserProfile) return;
  if (getActiveTicketsSalonId()) {
    subscribeTickets();
    return;
  }
  const loadState =
    typeof window.ffStaffPermissionLoadState === 'function' ? window.ffStaffPermissionLoadState() : 'ready';
  if (loadState === 'staff_loading' && attempt < 10) {
    setTimeout(() => ensureTicketsBackgroundSubscription(attempt + 1), 1000);
  }
}

async function setupTicketsUI() {
  const container = document.getElementById('ticketServicePickerContainer');
  if (!container) return;
  try { subscribeProductsCatalog(); } catch (_) {}
  const grouped = getServicesGroupedByCategory();
  const groupedProducts = getProductsGroupedByCategory();
  const hasServices = Object.keys(grouped).length > 0;
  const hasProducts = Object.keys(groupedProducts).length > 0;
  let html = '';
  if (!hasServices && !hasProducts) {
    container.innerHTML = '<div style="padding:10px 8px;color:#6b7280;font-size:12px;">No services or products available for this location.</div>';
    ffTicketServiceSearchSetVisible(false);
    return;
  }
  // Mirror the picker: if a catalog snapshot rebuilds the list while the modal
  // shows a read-only ticket (picker hidden), keep the search hidden too.
  ffTicketServiceSearchSetVisible(container.style.display !== 'none');
  Object.entries(grouped).forEach(([key, data], idx) => {
    const label = escapeHtml(data.label || 'Other');
    html += `<div class="ticket-category-section" data-cat-idx="${idx}" style="border-bottom:1px solid #e5e7eb;">`;
    html += `<div class="ticket-category-header" role="button" tabindex="0" style="display:flex;align-items:center;gap:4px;padding:6px 8px;cursor:pointer;user-select:none;font-size:11px;font-weight:600;color:#374151;background:#f9fafb;"><span class="ticket-cat-arrow" style="font-size:9px;color:#6b7280;">▶</span><span>${label}</span></div>`;
    html += `<div class="ticket-category-body" style="display:none;padding:4px 8px 8px 16px;background:#fff;">`;
    (data.services || []).forEach((s) => {
      html += `<button type="button" class="ticket-service-btn" data-id="${s.id}" style="display:block;width:100%;text-align:left;padding:5px 8px;margin-bottom:3px;border:1px solid #e5e7eb;border-radius:4px;background:#fff;cursor:pointer;font-size:12px;transition:background 0.15s;">${escapeHtml(s.name)} <span style="color:#6b7280;font-size:11px;">${ffTicketMoney(s.defaultPrice || 0)}</span></button>`;
    });
    html += '</div></div>';
  });
  if (hasProducts) {
    html += `<div style="padding:6px 8px;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#9ca3af;background:#f3f4f6;border-bottom:1px solid #e5e7eb;">Products</div>`;
    Object.entries(groupedProducts).forEach(([key, data], idx) => {
      const label = escapeHtml(data.label || 'Other');
      html += `<div class="ticket-category-section" data-prod-cat-idx="${idx}" style="border-bottom:1px solid #e5e7eb;">`;
      html += `<div class="ticket-category-header" role="button" tabindex="0" style="display:flex;align-items:center;gap:4px;padding:6px 8px;cursor:pointer;user-select:none;font-size:11px;font-weight:600;color:#374151;background:#f9fafb;"><span class="ticket-cat-arrow" style="font-size:9px;color:#6b7280;">▶</span><span>${label}</span></div>`;
      html += `<div class="ticket-category-body" style="display:none;padding:4px 8px 8px 16px;background:#fff;">`;
      (data.products || []).forEach((p) => {
        html += `<button type="button" class="ticket-product-btn" data-id="${p.id}" style="display:block;width:100%;text-align:left;padding:5px 8px;margin-bottom:3px;border:1px solid #e5e7eb;border-radius:4px;background:#fff;cursor:pointer;font-size:12px;transition:background 0.15s;">${escapeHtml(p.name)} <span style="color:#6b7280;font-size:11px;">${ffTicketMoney(getTicketPriceForProductAndActiveLocation(p))}</span></button>`;
      });
      html += '</div></div>';
    });
  }
  // Wrap the normal categories view so the search can toggle it without
  // touching its content; results render into a sibling div inside the same
  // scrollable container.
  container.innerHTML = `<div id="ticketServiceCatalogList">${html}</div><div id="ticketServiceSearchResults" style="display:none;padding:4px 8px;background:#fff;"></div>`;
  ffTicketServiceSearchWire();
  ffRenderTicketServiceSearch();
  container.querySelectorAll('.ticket-service-btn').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      const svc = ticketsState.salonServices.find((x) => x.id === id);
      doServiceSelect(svc);
    };
  });
  container.querySelectorAll('.ticket-product-btn').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      const prod = ticketsState.salonProducts.find((x) => x.id === id);
      if (prod) addProductToTicket(prod);
    };
  });
  container.querySelectorAll('.ticket-category-header').forEach((header) => {
    header.onclick = () => {
      const section = header.closest('.ticket-category-section');
      const body = section?.querySelector('.ticket-category-body');
      const arrow = section?.querySelector('.ticket-cat-arrow');
      if (!body || !arrow) return;
      const isOpen = body.style.display === 'block';
      body.style.display = isOpen ? 'none' : 'block';
      arrow.textContent = isOpen ? '▶' : '▼';
    };
  });
  const manageServicesBtn = document.getElementById('ticketsManageServicesBtn');
  if (manageServicesBtn) {
    // Services are now managed from the dedicated Services module (Apps → Services).
    // Hide the legacy gear shortcut on the Tickets screen to avoid two entry points.
    manageServicesBtn.style.display = 'none';
    manageServicesBtn.onclick = null;
  }
  updateTicketsTabsVisibility();
  updateNewTicketButtonVisibility();
}

export {
  ffTicketServiceSearchClear,
  ffTicketServiceSearchSetVisible,
  ffRenderTicketServiceSearch,
  ffTicketServiceSearchWire,
  updateNewTicketButtonVisibility,
  ensureTicketsBackgroundSubscription,
  setupTicketsUI,
};
