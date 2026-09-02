/**
 * Tickets — Service Catalog V2: per-service detail tabs (Phase 8b split).
 *
 * The Locations tab (per-location price overrides) and the Staff-services tab
 * (eligibility + per-staff commission / supply-deduction overrides). Verbatim move.
 *
 * No import of the render layer — renderServicesCatalogV2 and
 * renderServicesScreenDetail are injected via initCatalogTabs to keep the module
 * graph acyclic. showToast, setupTicketsUI, getServiceStaffOverrides and
 * controlledStaffCanProvideService are injected too.
 */
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { getSharedServicesForCatalogManager, getLocationServicesForCatalogManager, getTicketsAccountId, loadServices, loadSharedServiceLocationOverridesForService, saveSharedServiceLocationOverride, sharedServiceCatalogItemsRef, _applyCatalogFilter, resolveServiceDurationMinutes, parseStaffDurationOverrideInput, splitServiceDurationParts, formatServiceDurationLabel, parseStaffDurationOverrideFromParts } from "./tickets-catalog-data.js?v=20260902_prod_cats";
import { ffTicketMoney } from "./tickets-helpers.js?v=20260721_ticket_soft_delete";
import { escapeHtml } from "./tickets-list.js?v=20260721_ticket_soft_delete";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { serverTimestamp, doc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

let showToast, setupTicketsUI, getServiceStaffOverrides, controlledStaffCanProvideService, renderServicesCatalogV2, renderServicesScreenDetail;
export function initCatalogTabs(deps) {
  showToast = deps.showToast;
  setupTicketsUI = deps.setupTicketsUI;
  getServiceStaffOverrides = deps.getServiceStaffOverrides;
  controlledStaffCanProvideService = deps.controlledStaffCanProvideService;
  renderServicesCatalogV2 = deps.renderServicesCatalogV2;
  renderServicesScreenDetail = deps.renderServicesScreenDetail;
}

function renderServicesLocationsTabHtml(service) {
  const locations = (typeof window !== 'undefined' && typeof window.ffGetActiveLocations === 'function')
    ? (window.ffGetActiveLocations() || [])
    : [];
  if (!service || !service.id) return '';
  if (ticketsState._ffCatalogModalMode !== 'shared' && !service.isSharedService) {
    return `
      <div style="padding:14px;background:#fff;border:1px solid var(--border);border-radius:12px;">
        <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:6px;">Locations</div>
        <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">This service is still using the older location catalog. Open Services after the catalog migration completes to manage locations here.</p>
      </div>
    `;
  }
  if (!Array.isArray(locations) || locations.length === 0) {
    return `
      <div style="padding:14px;background:#fff;border:1px solid var(--border);border-radius:12px;">
        <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:6px;">Locations</div>
        <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">No active locations found.</p>
      </div>
    `;
  }
  if (!ticketsState._ffServicesLocationOverridesByService[service.id] && !ticketsState._ffServicesLocationOverridesLoading[service.id]) {
    ticketsState._ffServicesLocationOverridesLoading[service.id] = true;
    loadSharedServiceLocationOverridesForService(service.id)
      .catch((e) => console.warn('[Services] failed loading location overrides', e))
      .finally(() => {
        ticketsState._ffServicesLocationOverridesLoading[service.id] = false;
        if (ticketsState._ffSelectedServiceId === service.id && ticketsState._ffServicesDetailTab === 'locations') renderServicesCatalogV2();
      });
  }
  const overrides = ticketsState._ffServicesLocationOverridesByService[service.id] || {};
  const basePrice = Number(service.sharedDefaultPrice ?? service.defaultPrice) || 0;
  const loading = ticketsState._ffServicesLocationOverridesLoading[service.id] === true;
  const cards = locations.map((loc) => {
    const override = overrides[loc.id] || {};
    const enabled = override.enabled !== false;
    const hasPriceOverride = Number.isFinite(Number(override.price));
    const shownPrice = hasPriceOverride ? Number(override.price) : basePrice;
    return `
      <div class="ff-services-location-card" data-location-id="${escapeHtml(loc.id)}" style="padding:10px 12px;background:#fff;border:1px solid var(--border);border-radius:12px;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px;">
          <div>
            <div style="font-size:13px;font-weight:700;color:#111827;line-height:1.25;">${escapeHtml(loc.name || loc.label || 'Location')}</div>
            <div style="margin-top:2px;font-size:11px;color:#6b7280;">${enabled ? 'Available at this location' : 'Not available at this location'}</div>
          </div>
          <label class="staff-permission-toggle" style="flex:0 0 auto;">
            <input type="checkbox" class="ff-services-location-enabled" ${enabled ? 'checked' : ''}>
            <span class="staff-permission-toggle-slider"></span>
          </label>
        </div>
        <div style="display:grid;grid-template-columns:100px minmax(110px,170px) auto;gap:8px;align-items:center;">
          <div style="font-size:12px;color:#6b7280;">Price</div>
          <input type="number" min="0" step="0.01" class="ff-services-location-price" value="${escapeHtml(String(shownPrice))}" style="width:100%;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;box-sizing:border-box;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <button type="button" class="ff-services-location-save" style="padding:7px 12px;background:#7c3aed;color:#fff;border:1px solid #7c3aed;border-radius:999px;cursor:pointer;font-size:12px;font-weight:700;">Save</button>
            ${hasPriceOverride ? `<button type="button" class="ff-services-location-reset" style="padding:7px 12px;background:#fff;color:#6b7280;border:1px solid #e5e7eb;border-radius:999px;cursor:pointer;font-size:12px;font-weight:700;">Reset to default</button>` : ''}
            <span style="font-size:11px;color:${hasPriceOverride ? '#7c3aed' : '#9ca3af'};">${hasPriceOverride ? 'Override' : `Default ${ffTicketMoney(basePrice)}`}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
  return `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <div style="padding:12px;background:#fff;border:1px solid var(--border);border-radius:12px;">
        <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:3px;">Locations</div>
        <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.4;">Manage availability and location-specific pricing for this service.</p>
        ${loading ? '<div style="margin-top:8px;font-size:12px;color:#9ca3af;">Loading location overrides...</div>' : ''}
      </div>
      ${cards}
    </div>
  `;
}

function wireServicesLocationsTab(root, service) {
  if (!root || !service || !service.id) return;
  const basePrice = Number(service.sharedDefaultPrice ?? service.defaultPrice) || 0;
  root.querySelectorAll('.ff-services-location-card').forEach((card) => {
    const locationId = card.getAttribute('data-location-id');
    const enabledInput = card.querySelector('.ff-services-location-enabled');
    const priceInput = card.querySelector('.ff-services-location-price');
    const saveBtn = card.querySelector('.ff-services-location-save');
    const resetBtn = card.querySelector('.ff-services-location-reset');
    const saveLocation = async (priceMode) => {
      if (!locationId) return;
      const enabled = enabledInput ? enabledInput.checked : true;
      const rawPrice = parseFloat(priceInput?.value);
      const patch = { enabled };
      if (priceMode === 'reset') {
        patch.price = null;
        if (priceInput) priceInput.value = String(basePrice);
      } else if (Number.isFinite(rawPrice) && rawPrice !== basePrice) {
        patch.price = rawPrice;
      } else {
        patch.price = null;
      }
      if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '0.7'; }
      try {
        await saveSharedServiceLocationOverride(service.id, locationId, patch);
        const catalogData = ticketsState._ffCatalogModalMode === 'shared'
          ? getSharedServicesForCatalogManager()
          : getLocationServicesForCatalogManager();
        renderServicesScreenDetail(catalogData.services || [], catalogData.categories || []);
        if (typeof setupTicketsUI === 'function') setupTicketsUI();
        showToast(priceMode === 'reset' ? 'Price reset to default' : 'Location updated', 'success');
      } catch (e) {
        showToast(e?.message || 'Failed', 'error');
      } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.style.opacity = '1'; }
      }
    };
    if (enabledInput) {
      enabledInput.addEventListener('change', () => { saveLocation('save'); });
    }
    if (saveBtn) {
      saveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        saveLocation('save');
      });
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        saveLocation('reset');
      });
    }
  });
}

function ffServiceStaffPermissionTrue(value) {
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'yes' || value === 'on';
}

function isServiceProviderStaffForServices(staff, service) {
  if (!staff || typeof staff !== 'object' || staff.isArchived === true || staff.archived === true) return false;
  if (service && !controlledStaffCanProvideService(staff, service)) return false;
  const role = String(staff.role || staff.type || '').toLowerCase().trim();
  const permissions = staff.permissions && typeof staff.permissions === 'object' ? staff.permissions : {};
  const hasTicketsPermission =
    ffServiceStaffPermissionTrue(permissions.tickets_view) ||
    ffServiceStaffPermissionTrue(permissions.tickets_use) ||
    ffServiceStaffPermissionTrue(permissions.tickets_create);
  const hasProviderRole = [
    'technician',
    'tech',
    'service_provider',
    'service provider',
    'provider',
    'staff'
  ].indexOf(role) !== -1;
  const hasProviderTypes = Array.isArray(staff.technicianTypes) && staff.technicianTypes.length > 0;
  return hasProviderRole || hasProviderTypes || hasTicketsPermission;
}

function canStaffSendNewTicket(staff) {
  if (!staff || typeof staff !== 'object' || staff.isArchived === true || staff.archived === true) return false;
  const permissions = staff.permissions && typeof staff.permissions === 'object' ? staff.permissions : {};
  // The "Can send new ticket" toggle is authoritative in BOTH directions once an
  // owner has set it explicitly: ON always shows the + New button, OFF always
  // hides it (even for service providers). This matches what owners expect when
  // they flip the switch on a staff member.
  if (Object.prototype.hasOwnProperty.call(permissions, 'tickets_create')) {
    return ffServiceStaffPermissionTrue(permissions.tickets_create);
  }
  // Legacy staff whose toggle was never set: service providers keep the button
  // by role / provider types so existing technicians are unaffected.
  const role = String(staff.role || staff.type || '').toLowerCase().trim();
  if (['owner', 'admin', 'manager', 'front_desk', 'front desk', 'assistant_manager'].includes(role)) return false;
  const hasProviderRole = [
    'technician',
    'tech',
    'service_provider',
    'service provider',
    'provider',
    'staff'
  ].indexOf(role) !== -1;
  const hasProviderTypes = Array.isArray(staff.technicianTypes) && staff.technicianTypes.length > 0;
  return hasProviderRole || hasProviderTypes;
}

function getServicesEligibleStaffRows(service) {
  try {
    const store = typeof window !== 'undefined' && typeof window.ffGetStaffStore === 'function'
      ? window.ffGetStaffStore()
      : null;
    const staff = Array.isArray(store?.staff) ? store.staff : [];
    return staff
      .filter((row) => isServiceProviderStaffForServices(row, service))
      .sort((a, b) => String(a.name || a.displayName || '').localeCompare(String(b.name || b.displayName || '')));
  } catch (_) {
    return [];
  }
}

function getServiceStaffId(staff) {
  return String(staff?.id || staff?.staffId || staff?.uid || staff?.firebaseUid || '').trim();
}

function getServiceStaffName(staff) {
  return String(staff?.name || staff?.displayName || staff?.fullName || staff?.email || 'Staff').trim();
}

function getStaffDefaultServiceCommission(staff, staffId) {
  try {
    if (typeof window !== 'undefined' && typeof window.ffGetStaffServiceCommissionPct === 'function') {
      const pct = Number(window.ffGetStaffServiceCommissionPct(staffId));
      if (Number.isFinite(pct) && pct > 0) return { type: 'percentage', value: pct };
    }
  } catch (_) {}
  const rules = staff && staff.earningsRules && typeof staff.earningsRules === 'object' ? staff.earningsRules : {};
  const serviceCommission = rules.serviceCommission && typeof rules.serviceCommission === 'object' ? rules.serviceCommission : {};
  const pct = Number(serviceCommission.basicPercent);
  if (serviceCommission.enabled === true && Number.isFinite(pct) && pct > 0) {
    return { type: 'percentage', value: pct };
  }
  return null;
}

function formatServiceStaffDefaultCommission(defaultCommission) {
  if (!defaultCommission || !Number.isFinite(Number(defaultCommission.value))) return 'Default';
  const value = Number(defaultCommission.value);
  return defaultCommission.type === 'fixed'
    ? `Default ${ffTicketMoney(value)}`
    : `Default ${value}%`;
}

function getStaffDefaultSupplyDeduction(staff) {
  const rules = staff && staff.earningsRules && typeof staff.earningsRules === 'object' ? staff.earningsRules : {};
  const serviceCommission = rules.serviceCommission && typeof rules.serviceCommission === 'object' ? rules.serviceCommission : {};
  const supply = serviceCommission.supplyDeduction && typeof serviceCommission.supplyDeduction === 'object'
    ? serviceCommission.supplyDeduction
    : {};
  const value = Number(supply.value);
  if (supply.enabled === true && Number.isFinite(value) && value > 0) {
    return {
      type: supply.type === 'percentage' ? 'percentage' : 'fixed',
      value
    };
  }
  return null;
}

function formatServiceStaffSupplyDeductionLabel(deduction) {
  if (!deduction || !Number.isFinite(Number(deduction.value))) return 'Default OFF';
  const value = Number(deduction.value);
  return deduction.type === 'percentage' ? `Default ${value}%` : `Default ${ffTicketMoney(value)}`;
}

function renderServicesStaffTabHtml(service) {
  const staffRows = getServicesEligibleStaffRows(service);
  if (!service || !service.id) return '';
  if (!staffRows.length) {
    return `
      <div style="padding:14px;background:#fff;border:1px solid var(--border);border-radius:12px;">
        <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:6px;">Staff</div>
        <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">No eligible service providers found.</p>
      </div>
    `;
  }
  const overrides = getServiceStaffOverrides(service);
  const basePrice = Number(service.sharedDefaultPrice ?? service.defaultPrice) || 0;
  const serviceDefaultDuration = resolveServiceDurationMinutes(service);
  const cards = staffRows.map((staff) => {
    const staffId = getServiceStaffId(staff);
    if (!staffId) return '';
    const override = overrides[staffId] && typeof overrides[staffId] === 'object' ? overrides[staffId] : {};
    const enabled = override.enabled !== false;
    const price = Number.isFinite(Number(override.price)) ? Number(override.price) : basePrice;
    const storedDuration = Number(override.durationMinutes);
    const hasDurationOverride = Number.isInteger(storedDuration) && storedDuration >= 1 && storedDuration <= 1440
      && storedDuration !== serviceDefaultDuration;
    const durationParts = hasDurationOverride ? splitServiceDurationParts(storedDuration) : { hours: '', minutes: '' };
    const commission = override.commission && typeof override.commission === 'object' ? override.commission : {};
    const defaultCommission = getStaffDefaultServiceCommission(staff, staffId);
    const hasCommissionOverride = Number.isFinite(Number(commission.value));
    const commissionType = hasCommissionOverride
      ? (commission.type === 'fixed' ? 'fixed' : 'percentage')
      : (defaultCommission?.type === 'fixed' ? 'fixed' : 'percentage');
    const commissionValue = hasCommissionOverride ? String(Number(commission.value)) : '';
    const commissionDefaultLabel = formatServiceStaffDefaultCommission(defaultCommission);
    const defaultSupplyDeduction = getStaffDefaultSupplyDeduction(staff);
    const supplyDeduction = override.supplyDeduction && typeof override.supplyDeduction === 'object' ? override.supplyDeduction : {};
    const hasSupplyDeductionOverride = Object.prototype.hasOwnProperty.call(override, 'supplyDeduction');
    const hasSupplyDeductionValueOverride = supplyDeduction.enabled === true && Number.isFinite(Number(supplyDeduction.value));
    const effectiveSupplyDeduction = hasSupplyDeductionOverride
      ? (hasSupplyDeductionValueOverride ? supplyDeduction : null)
      : defaultSupplyDeduction;
    const supplyDeductionEnabled = !!effectiveSupplyDeduction;
    const supplyDeductionType = effectiveSupplyDeduction?.type === 'percentage' ? 'percentage' : 'fixed';
    const supplyDeductionValue = hasSupplyDeductionValueOverride ? String(Number(supplyDeduction.value)) : '';
    const supplyDeductionDefaultLabel = formatServiceStaffSupplyDeductionLabel(defaultSupplyDeduction);
    const supplyDeductionStatusLabel = hasSupplyDeductionOverride
      ? (hasSupplyDeductionValueOverride ? 'Override' : 'Override OFF')
      : supplyDeductionDefaultLabel;
    return `
      <div class="ff-services-staff-card" data-staff-id="${escapeHtml(staffId)}" style="padding:10px 12px;background:#fff;border:1px solid var(--border);border-radius:12px;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px;">
          <div>
            <div style="font-size:13px;font-weight:700;color:#111827;line-height:1.25;">${escapeHtml(getServiceStaffName(staff))}</div>
            <div style="margin-top:2px;font-size:11px;color:#6b7280;">${enabled ? 'Available for this service' : 'Not available for this service'}</div>
          </div>
          <label class="staff-permission-toggle" style="flex:0 0 auto;">
            <input type="checkbox" class="ff-services-staff-enabled" ${enabled ? 'checked' : ''}>
            <span class="staff-permission-toggle-slider"></span>
          </label>
        </div>
        <div style="display:grid;grid-template-columns:100px minmax(110px,170px) auto;gap:8px;align-items:center;margin-bottom:8px;">
          <div style="font-size:12px;color:#6b7280;">Price</div>
          <input type="number" min="0" step="0.01" class="ff-services-staff-price" value="${escapeHtml(String(price))}" style="width:100%;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;box-sizing:border-box;">
          <span style="font-size:11px;color:#9ca3af;">Default ${ffTicketMoney(basePrice)}</span>
        </div>
        <div style="display:grid;grid-template-columns:100px minmax(160px,220px) auto;gap:8px;align-items:end;margin-bottom:8px;">
          <div style="font-size:12px;color:#6b7280;padding-bottom:8px;">Duration</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <label style="display:flex;flex-direction:column;gap:3px;font-size:10px;font-weight:700;color:#6b7280;">
              Hours
              <input type="number" min="0" max="24" step="1" inputmode="numeric" class="ff-services-staff-duration-hours" value="${escapeHtml(String(durationParts.hours))}" placeholder="0" style="width:100%;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;box-sizing:border-box;">
            </label>
            <label style="display:flex;flex-direction:column;gap:3px;font-size:10px;font-weight:700;color:#6b7280;">
              Minutes
              <input type="number" min="0" max="59" step="1" inputmode="numeric" class="ff-services-staff-duration-minutes" value="${escapeHtml(String(durationParts.minutes))}" placeholder="0" style="width:100%;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;box-sizing:border-box;">
            </label>
          </div>
          <span style="font-size:11px;color:${hasDurationOverride ? '#7c3aed' : '#9ca3af'};padding-bottom:8px;">${hasDurationOverride ? 'Override' : `Default ${formatServiceDurationLabel(serviceDefaultDuration)}`}</span>
        </div>
        <div style="margin-bottom:8px;padding:8px 0;border-top:1px solid #f3f4f6;border-bottom:1px solid #f3f4f6;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;">
            <div>
              <div style="font-size:12px;font-weight:700;color:#374151;">Supply Deduction</div>
              <div style="font-size:11px;color:#9ca3af;margin-top:2px;">Deduct supplies before commission. No payroll calculation is applied yet.</div>
            </div>
            <label class="staff-permission-toggle" style="flex:0 0 auto;">
              <input type="checkbox" class="ff-services-staff-supply-enabled" ${supplyDeductionEnabled ? 'checked' : ''}>
              <span class="staff-permission-toggle-slider"></span>
            </label>
          </div>
          <div class="ff-services-staff-supply-fields" style="display:${supplyDeductionEnabled ? 'grid' : 'none'};grid-template-columns:100px minmax(110px,170px) minmax(110px,170px) auto;gap:8px;align-items:center;">
            <div style="font-size:12px;color:#6b7280;">Deduction</div>
            <select class="ff-services-staff-supply-type" style="width:100%;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;background:#fff;box-sizing:border-box;">
              <option value="fixed" ${supplyDeductionType === 'fixed' ? 'selected' : ''}>Fixed Amount ($)</option>
              <option value="percentage" ${supplyDeductionType === 'percentage' ? 'selected' : ''}>Percentage (%)</option>
            </select>
            <input type="number" min="0" step="0.01" class="ff-services-staff-supply-value" value="${escapeHtml(supplyDeductionValue)}" placeholder="${hasSupplyDeductionValueOverride ? '' : escapeHtml(supplyDeductionDefaultLabel)}" style="width:100%;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;box-sizing:border-box;">
            <span style="font-size:11px;color:${hasSupplyDeductionOverride ? '#7c3aed' : '#9ca3af'};">${escapeHtml(supplyDeductionStatusLabel)}</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:100px minmax(110px,170px) minmax(70px,100px) auto;gap:8px;align-items:center;">
          <div style="font-size:12px;color:#6b7280;">Commission</div>
          <input type="number" min="0" step="0.01" class="ff-services-staff-commission-value" value="${escapeHtml(commissionValue)}" placeholder="${escapeHtml(commissionDefaultLabel)}" style="width:100%;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;box-sizing:border-box;">
          <select class="ff-services-staff-commission-type" style="width:100%;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;background:#fff;box-sizing:border-box;">
            <option value="percentage" ${commissionType === 'percentage' ? 'selected' : ''}>%</option>
            <option value="fixed" ${commissionType === 'fixed' ? 'selected' : ''}>$</option>
          </select>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <button type="button" class="ff-services-staff-save" style="width:auto;min-width:0;justify-self:start;padding:5px 10px;background:#7c3aed;color:#fff;border:1px solid #7c3aed;border-radius:999px;cursor:pointer;font-size:11px;font-weight:700;line-height:1.2;">Save</button>
            <span style="font-size:11px;color:${hasCommissionOverride ? '#7c3aed' : '#9ca3af'};">${hasCommissionOverride ? 'Override' : escapeHtml(commissionDefaultLabel)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
  return `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <div style="padding:12px;background:#fff;border:1px solid var(--border);border-radius:12px;">
        <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:3px;">Staff</div>
        <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.4;">Manage staff availability, staff-specific price, duration, and commission for this service.</p>
      </div>
      ${cards}
    </div>
  `;
}

async function saveServiceStaffOverride(service, staffId, patch) {
  if (!service || !service.id || !staffId) throw new Error('Missing service or staff');
  const current = getServiceStaffOverrides(service);
  const existing = current[staffId] && typeof current[staffId] === 'object' ? current[staffId] : {};
  const next = { ...existing, ...(patch || {}) };
  const basePrice = Number(service.sharedDefaultPrice ?? service.defaultPrice) || 0;
  const serviceDefaultDuration = resolveServiceDurationMinutes(service);
  if (next.enabled === true) delete next.enabled;
  if (next.price == null || next.price === '' || Number(next.price) === basePrice) delete next.price;
  if (
    next.durationMinutes == null ||
    next.durationMinutes === '' ||
    !Number.isInteger(Number(next.durationMinutes)) ||
    Number(next.durationMinutes) < 1 ||
    Number(next.durationMinutes) > 1440 ||
    Number(next.durationMinutes) === serviceDefaultDuration
  ) {
    delete next.durationMinutes;
  } else {
    next.durationMinutes = Number(next.durationMinutes);
  }
  if (!next.commission || !Number.isFinite(Number(next.commission.value))) delete next.commission;
  if (
    !next.supplyDeduction ||
    (next.supplyDeduction.enabled !== true && next.supplyDeduction.enabled !== false)
  ) {
    delete next.supplyDeduction;
  } else if (next.supplyDeduction.enabled === false) {
    next.supplyDeduction = { enabled: false };
  } else if (!Number.isFinite(Number(next.supplyDeduction.value))) {
    delete next.supplyDeduction;
  } else {
    next.supplyDeduction = {
      enabled: true,
      type: next.supplyDeduction.type === 'percentage' ? 'percentage' : 'fixed',
      value: Number(next.supplyDeduction.value)
    };
  }
  const nextOverrides = { ...current };
  if (Object.keys(next).length) nextOverrides[staffId] = next;
  else delete nextOverrides[staffId];

  // IMPORTANT: updateDoc (not setDoc+merge). "Enabled" is represented by the
  // ABSENCE of `enabled:false` in the per-staff map, and setDoc with
  // { merge:true } merges nested maps recursively — it never deletes the stale
  // `enabled:false` key on the server. Result: disabling stuck, re-enabling
  // silently didn't persist (toggle reverted on reload, and the staff member's
  // ticket picker stayed empty). updateDoc REPLACES the whole staffOverrides
  // field with exactly what we computed.
  if (service.isSharedService || ticketsState._ffCatalogModalMode === 'shared') {
    const accountId = getTicketsAccountId();
    if (!accountId) throw new Error('No account');
    await updateDoc(doc(sharedServiceCatalogItemsRef(accountId), service.id), {
      staffOverrides: nextOverrides,
      updatedAt: serverTimestamp()
    });
    const raw = ticketsState._rawSharedServices.find((s) => String(s.id) === String(service.id));
    if (raw) raw.staffOverrides = nextOverrides;
  } else {
    if (!ticketsState.currentUserProfile?.salonId) throw new Error('No salon');
    await updateDoc(doc(db, `salons/${ticketsState.currentUserProfile.salonId}/services`, service.id), {
      staffOverrides: nextOverrides,
      updatedAt: serverTimestamp()
    });
    const raw = ticketsState._rawServices.find((s) => String(s.id) === String(service.id));
    if (raw) raw.staffOverrides = nextOverrides;
  }
  service.staffOverrides = nextOverrides;
  const live = ticketsState.salonServices.find((s) => String(s.id) === String(service.id));
  if (live) live.staffOverrides = nextOverrides;
}

async function ffStaffServicesLoadForStaffMember() {
  await loadServices();
  _applyCatalogFilter();
  return {
    services: ticketsState.salonServices.slice(),
    categories: ticketsState.serviceCategories.slice()
  };
}

async function ffStaffServicesSaveOverrideForStaffMember(serviceId, staffId, patch) {
  await loadServices();
  const service = ticketsState.salonServices.find((s) => String(s.id) === String(serviceId));
  if (!service) throw new Error('Service not found');
  await saveServiceStaffOverride(service, staffId, patch);
  return service;
}

function ffStaffServicesGetOverrideForStaffMember(service, staffId) {
  const overrides = getServiceStaffOverrides(service);
  return overrides && overrides[staffId] && typeof overrides[staffId] === 'object'
    ? overrides[staffId]
    : {};
}

function ffStaffServicesDefaultsForStaffMember(staff, service) {
  return {
    price: Number(service?.sharedDefaultPrice ?? service?.defaultPrice) || 0,
    durationMinutes: resolveServiceDurationMinutes(service),
    commission: getStaffDefaultServiceCommission(staff, getServiceStaffId(staff)),
    supplyDeduction: getStaffDefaultSupplyDeduction(staff)
  };
}

if (typeof window !== 'undefined') {
  window.ffStaffServicesLoadForStaffMember = ffStaffServicesLoadForStaffMember;
  window.ffStaffServicesSaveOverrideForStaffMember = ffStaffServicesSaveOverrideForStaffMember;
  window.ffStaffServicesGetOverrideForStaffMember = ffStaffServicesGetOverrideForStaffMember;
  window.ffStaffServicesDefaultsForStaffMember = ffStaffServicesDefaultsForStaffMember;
  window.ffResolveServiceDurationMinutes = resolveServiceDurationMinutes;
  window.ffParseStaffDurationOverrideInput = parseStaffDurationOverrideInput;
  window.ffSplitServiceDurationParts = splitServiceDurationParts;
  window.ffFormatServiceDurationLabel = formatServiceDurationLabel;
  window.ffParseStaffDurationOverrideFromParts = parseStaffDurationOverrideFromParts;
  window.ffStaffServicesMoney = ffTicketMoney;
  window.ffStaffServicesEscapeHtml = escapeHtml;
}

function wireServicesStaffTab(root, service) {
  if (!root || !service || !service.id) return;
  const basePrice = Number(service.sharedDefaultPrice ?? service.defaultPrice) || 0;
  root.querySelectorAll('.ff-services-staff-card').forEach((card) => {
    const staffId = card.getAttribute('data-staff-id');
    const enabledInput = card.querySelector('.ff-services-staff-enabled');
    const priceInput = card.querySelector('.ff-services-staff-price');
    const durationHoursInput = card.querySelector('.ff-services-staff-duration-hours');
    const durationMinutesInput = card.querySelector('.ff-services-staff-duration-minutes');
    const commissionValueInput = card.querySelector('.ff-services-staff-commission-value');
    const commissionTypeInput = card.querySelector('.ff-services-staff-commission-type');
    const supplyEnabledInput = card.querySelector('.ff-services-staff-supply-enabled');
    const supplyFields = card.querySelector('.ff-services-staff-supply-fields');
    const supplyTypeInput = card.querySelector('.ff-services-staff-supply-type');
    const supplyValueInput = card.querySelector('.ff-services-staff-supply-value');
    const saveBtn = card.querySelector('.ff-services-staff-save');
    const staff = getServicesEligibleStaffRows(service).find((row) => getServiceStaffId(row) === staffId);
    const defaultCommission = getStaffDefaultServiceCommission(staff, staffId);
    const defaultSupplyDeduction = getStaffDefaultSupplyDeduction(staff);
    const saveStaff = async () => {
      if (!staffId) return;
      const enabled = enabledInput ? enabledInput.checked : true;
      const rawPrice = parseFloat(priceInput?.value);
      const parsedDuration = parseStaffDurationOverrideFromParts(durationHoursInput?.value, durationMinutesInput?.value);
      if (!parsedDuration.ok) {
        [durationHoursInput, durationMinutesInput].forEach((el) => {
          if (!el) return;
          const prev = el.style.borderColor;
          el.style.borderColor = '#ef4444';
          setTimeout(() => { el.style.borderColor = prev || '#e5e7eb'; }, 1400);
        });
        if (durationHoursInput) durationHoursInput.focus();
        showToast('Duration must be hours and minutes (1 minute to 24 hours), or empty for the service default.', 'error');
        return;
      }
      const commissionValue = parseFloat(commissionValueInput?.value);
      const supplyEnabled = supplyEnabledInput ? supplyEnabledInput.checked : false;
      const supplyValue = parseFloat(supplyValueInput?.value);
      const patch = {
        enabled,
        price: Number.isFinite(rawPrice) ? rawPrice : basePrice,
        durationMinutes: parsedDuration.value
      };
      if (Number.isFinite(commissionValue)) {
        const commissionType = commissionTypeInput?.value === 'fixed' ? 'fixed' : 'percentage';
        patch.commission = {
          type: commissionType,
          value: commissionValue
        };
        if (
          defaultCommission &&
          defaultCommission.type === commissionType &&
          Number(defaultCommission.value) === commissionValue
        ) {
          patch.commission = null;
        }
      } else {
        patch.commission = null;
      }
      if (supplyEnabled && Number.isFinite(supplyValue)) {
        const supplyType = supplyTypeInput?.value === 'percentage' ? 'percentage' : 'fixed';
        patch.supplyDeduction = {
          enabled: true,
          type: supplyType,
          value: supplyValue
        };
        if (
          defaultSupplyDeduction &&
          defaultSupplyDeduction.type === supplyType &&
          Number(defaultSupplyDeduction.value) === supplyValue
        ) {
          patch.supplyDeduction = null;
        }
      } else {
        patch.supplyDeduction = defaultSupplyDeduction ? { enabled: false } : null;
      }
      if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '0.7'; }
      try {
        await saveServiceStaffOverride(service, staffId, patch);
        const catalogData = ticketsState._ffCatalogModalMode === 'shared'
          ? getSharedServicesForCatalogManager()
          : getLocationServicesForCatalogManager();
        renderServicesScreenDetail(catalogData.services || [], catalogData.categories || []);
        if (typeof setupTicketsUI === 'function') setupTicketsUI();
        showToast('Staff settings updated', 'success');
      } catch (e) {
        showToast(e?.message || 'Failed', 'error');
      } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.style.opacity = '1'; }
      }
    };
    if (supplyEnabledInput) {
      supplyEnabledInput.addEventListener('change', () => {
        if (supplyFields) supplyFields.style.display = supplyEnabledInput.checked ? 'grid' : 'none';
      });
    }
    if (supplyTypeInput && supplyValueInput) {
      supplyTypeInput.addEventListener('change', () => {
        supplyValueInput.placeholder = supplyTypeInput.value === 'percentage' ? '15' : '30';
      });
    }
    if (enabledInput) enabledInput.addEventListener('change', saveStaff);
    if (saveBtn) {
      saveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        saveStaff();
      });
    }
  });
}


export {
  renderServicesLocationsTabHtml,
  wireServicesLocationsTab,
  ffServiceStaffPermissionTrue,
  isServiceProviderStaffForServices,
  canStaffSendNewTicket,
  getServicesEligibleStaffRows,
  getServiceStaffId,
  getServiceStaffName,
  getStaffDefaultServiceCommission,
  formatServiceStaffDefaultCommission,
  getStaffDefaultSupplyDeduction,
  formatServiceStaffSupplyDeductionLabel,
  renderServicesStaffTabHtml,
  saveServiceStaffOverride,
  ffStaffServicesLoadForStaffMember,
  ffStaffServicesSaveOverrideForStaffMember,
  ffStaffServicesGetOverrideForStaffMember,
  ffStaffServicesDefaultsForStaffMember,
  wireServicesStaffTab,
};
