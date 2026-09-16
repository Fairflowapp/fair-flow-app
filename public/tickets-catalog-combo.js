/**
 * Booking Combo Services — catalog model, validation, and editor helpers.
 *
 * Phase 1: Services model + Services UI only.
 * A Combo is one sellable catalog item with a name and selling price, composed
 * of existing Single Services. Scheduling/checkout expansion is Phase 2.
 *
 * Existing services without serviceType continue to behave as Single.
 */
export const SERVICE_TYPE_SINGLE = "single";
export const SERVICE_TYPE_COMBO = "combo";
export const MIN_COMBO_COMPONENTS = 2;

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function moneyToCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function centsToMoney(cents) {
  if (!Number.isInteger(cents)) return null;
  return cents / 100;
}

export function formatComboMoney(value) {
  const cents = moneyToCents(value);
  if (cents == null) return "$0.00";
  const sign = cents < 0 ? "-" : "";
  return sign + "$" + (Math.abs(cents) / 100).toFixed(2);
}

export function normalizeServiceType(service) {
  const raw = String(asObject(service)?.serviceType || service || "").trim().toLowerCase();
  if (raw === SERVICE_TYPE_COMBO) return SERVICE_TYPE_COMBO;
  return SERVICE_TYPE_SINGLE;
}

export function isComboService(service) {
  return normalizeServiceType(service) === SERVICE_TYPE_COMBO;
}

export function isSingleService(service) {
  return !isComboService(service);
}

export function copyComboCatalogFields(target, source) {
  const row = target && typeof target === "object" ? target : {};
  const type = normalizeServiceType(source);
  row.serviceType = type;
  row.components = type === SERVICE_TYPE_COMBO
    ? normalizeComboComponents(source && source.components)
    : [];
  return row;
}

export function normalizeComboComponents(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list.map(function (item, index) {
    const row = asObject(item) || {};
    const allocated = moneyToCents(row.allocatedPrice);
    return {
      serviceId: String(row.serviceId || "").trim(),
      allocatedPrice: allocated == null ? 0 : centsToMoney(allocated),
      sortOrder: Number.isInteger(Number(row.sortOrder)) ? Number(row.sortOrder) : index
    };
  }).filter(function (row) {
    return !!row.serviceId;
  }).sort(function (a, b) {
    return a.sortOrder - b.sortOrder;
  }).map(function (row, index) {
    return {
      serviceId: row.serviceId,
      allocatedPrice: row.allocatedPrice,
      sortOrder: index
    };
  });
}

export function comboComponentServiceIds(components) {
  return normalizeComboComponents(components).map(function (row) {
    return row.serviceId;
  });
}

function catalogById(catalogServices) {
  const map = Object.create(null);
  (Array.isArray(catalogServices) ? catalogServices : []).forEach(function (service) {
    const id = String(service && service.id || "").trim();
    if (id) map[id] = service;
  });
  return map;
}

export function listEligibleComboComponentServices(catalogServices, comboId, selectedIds) {
  const selfId = String(comboId || "").trim();
  const taken = new Set((selectedIds || []).map(function (id) { return String(id || "").trim(); }).filter(Boolean));
  return (Array.isArray(catalogServices) ? catalogServices : []).filter(function (service) {
    const id = String(service && service.id || "").trim();
    if (!id || id === selfId) return false;
    if (!String(service && service.name || "").trim()) return false;
    if (!isSingleService(service)) return false;
    if (taken.has(id)) return false;
    return true;
  }).slice().sort(function (a, b) {
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

export function combosUsingService(serviceId, catalogServices) {
  const id = String(serviceId || "").trim();
  if (!id) return [];
  return (Array.isArray(catalogServices) ? catalogServices : []).filter(function (service) {
    if (!isComboService(service)) return false;
    return comboComponentServiceIds(service.components).indexOf(id) !== -1;
  });
}

export function comboDurationMinutes(components, catalogServices) {
  const byId = catalogById(catalogServices);
  let total = 0;
  normalizeComboComponents(components).forEach(function (row) {
    const service = byId[row.serviceId];
    const raw = service && (
      service.durationMinutes ?? service.duration ?? service.defaultDuration ?? service.minutes
    );
    const n = Number(raw);
    total += Number.isFinite(n) && n >= 1 ? n : 30;
  });
  return total;
}

export function allocatedPricesReconcile(components, comboPrice) {
  const comboCents = moneyToCents(comboPrice);
  if (comboCents == null || comboCents < 0) return false;
  const allocatedCents = normalizeComboComponents(components).reduce(function (sum, row) {
    const cents = moneyToCents(row.allocatedPrice);
    return cents == null ? sum : sum + cents;
  }, 0);
  return allocatedCents === comboCents;
}

export function validateComboService(input) {
  const comboId = String(input && input.id || "").trim();
  const comboPrice = input && input.defaultPrice;
  const components = normalizeComboComponents(input && input.components);
  const catalog = Array.isArray(input && input.catalogServices) ? input.catalogServices : [];
  const byId = catalogById(catalog);

  if (components.length < MIN_COMBO_COMPONENTS) {
    return {
      ok: false,
      code: "MIN_COMPONENTS",
      error: "A Combo must include at least 2 existing Single Services."
    };
  }

  const seen = new Set();
  for (let i = 0; i < components.length; i += 1) {
    const row = components[i];
    if (!row.serviceId) {
      return { ok: false, code: "MISSING_SERVICE", error: "Each Combo component must reference an existing service." };
    }
    if (comboId && row.serviceId === comboId) {
      return { ok: false, code: "SELF_REFERENCE", error: "A Combo cannot include itself as a component." };
    }
    if (seen.has(row.serviceId)) {
      return { ok: false, code: "DUPLICATE_COMPONENT", error: "A Combo cannot include the same service more than once." };
    }
    seen.add(row.serviceId);
    const referenced = byId[row.serviceId];
    if (!referenced) {
      return { ok: false, code: "MISSING_SERVICE", error: "Combo components must be existing Single Services." };
    }
    if (isComboService(referenced)) {
      return { ok: false, code: "NESTED_COMBO", error: "A Combo can contain Single Services only." };
    }
    const allocatedCents = moneyToCents(row.allocatedPrice);
    if (allocatedCents == null || allocatedCents < 0) {
      return { ok: false, code: "INVALID_ALLOCATED_PRICE", error: "Each component needs a valid allocated price." };
    }
  }

  const comboCents = moneyToCents(comboPrice);
  if (comboCents == null || comboCents < 0) {
    return { ok: false, code: "INVALID_COMBO_PRICE", error: "Combo selling price must be a valid amount." };
  }
  if (!allocatedPricesReconcile(components, comboPrice)) {
    return {
      ok: false,
      code: "PRICE_MISMATCH",
      error: "Allocated component prices must add up to the Combo selling price."
    };
  }

  return { ok: true, code: "OK", components: components };
}

export function comboSaveFields(input) {
  const type = normalizeServiceType({ serviceType: input && input.serviceType });
  if (type !== SERVICE_TYPE_COMBO) {
    return { ok: true, serviceType: SERVICE_TYPE_SINGLE, components: [] };
  }
  const validation = validateComboService(input);
  if (!validation.ok) return validation;
  return {
    ok: true,
    serviceType: SERVICE_TYPE_COMBO,
    components: validation.components,
    durationMinutes: comboDurationMinutes(validation.components, input && input.catalogServices)
  };
}

/**
 * Merge-safe payload helper. Reorder/rename callers that omit serviceType and
 * components leave existing combo fields untouched.
 */
export function applyComboFieldsToServicePayload(payload, service, isCreate) {
  const src = service && typeof service === "object" ? service : {};
  const hasType = Object.prototype.hasOwnProperty.call(src, "serviceType");
  const hasComponents = Object.prototype.hasOwnProperty.call(src, "components");
  if (!hasType && !hasComponents) {
    return { written: false, clearComponents: false };
  }
  const type = normalizeServiceType(hasType ? src : { serviceType: SERVICE_TYPE_COMBO });
  payload.serviceType = type;
  if (type === SERVICE_TYPE_COMBO) {
    payload.components = normalizeComboComponents(src.components);
    return { written: true, clearComponents: false, serviceType: type };
  }
  return {
    written: true,
    clearComponents: !isCreate,
    serviceType: SERVICE_TYPE_SINGLE
  };
}

export function catalogServiceTypeControlsHtml(serviceType, ids) {
  const type = normalizeServiceType({ serviceType: serviceType });
  const group = (ids && ids.groupName) || "ffCatalogServiceType";
  const singleId = (ids && ids.singleId) || "ffCatalogServiceTypeSingle";
  const comboId = (ids && ids.comboId) || "ffCatalogServiceTypeCombo";
  const wrapStyle = (ids && ids.compact)
    ? "display:grid;grid-template-columns:160px 1fr;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid #f3f4f6;"
    : "display:flex;flex-direction:column;gap:8px;";
  const labelStyle = (ids && ids.compact)
    ? "font-size:12px;color:#6b7280;"
    : "font-size:12px;font-weight:700;color:#374151;";
  return (
    '<div class="ff-catalog-service-type" style="' + wrapStyle + '">' +
      '<span style="' + labelStyle + '">Service Type</span>' +
      '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#111827;cursor:pointer;">' +
          '<input type="radio" name="' + escapeHtml(group) + '" id="' + escapeHtml(singleId) + '" value="single"' + (type === SERVICE_TYPE_SINGLE ? " checked" : "") + ' style="accent-color:#7c3aed;">' +
          "<span>Single</span>" +
        "</label>" +
        '<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#111827;cursor:pointer;">' +
          '<input type="radio" name="' + escapeHtml(group) + '" id="' + escapeHtml(comboId) + '" value="combo"' + (type === SERVICE_TYPE_COMBO ? " checked" : "") + ' style="accent-color:#7c3aed;">' +
          "<span>Combo</span>" +
        "</label>" +
      "</div>" +
    "</div>"
  );
}

function durationLabel(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n < 1) return "30 min";
  if (n % 60 === 0) return (n / 60) + (n === 60 ? " hr" : " hr");
  if (n > 60) {
    const hours = Math.floor(n / 60);
    const mins = n % 60;
    return hours + " hr " + mins + " min";
  }
  return n + " min";
}

function componentLookupName(service, fallbackId) {
  if (service && String(service.name || "").trim()) return String(service.name).trim();
  return fallbackId ? "Missing service" : "Select a service";
}

export function comboReconcileStatus(components, comboPrice) {
  const comboCents = moneyToCents(comboPrice);
  const allocatedCents = normalizeComboComponents(components).reduce(function (sum, row) {
    const cents = moneyToCents(row.allocatedPrice);
    return cents == null ? sum : sum + cents;
  }, 0);
  const safeCombo = comboCents == null || comboCents < 0 ? 0 : comboCents;
  const diff = allocatedCents - safeCombo;
  return {
    allocatedCents: allocatedCents,
    comboCents: safeCombo,
    remainingCents: -diff,
    ok: comboCents != null && comboCents >= 0 && allocatedCents === comboCents,
    label: "Allocated " + formatComboMoney(centsToMoney(allocatedCents)) +
      " of " + formatComboMoney(centsToMoney(safeCombo)) +
      (diff === 0 ? "" : (diff > 0
        ? " — " + formatComboMoney(centsToMoney(diff)) + " over"
        : " — " + formatComboMoney(centsToMoney(-diff)) + " remaining"))
  };
}

export function comboComponentsSectionHtml(state) {
  const compact = !!(state && state.compact);
  const components = normalizeComboComponents(state && state.components);
  const catalog = Array.isArray(state && state.catalogServices) ? state.catalogServices : [];
  const byId = catalogById(catalog);
  const comboPrice = state && state.comboPrice;
  const comboId = state && state.comboId;
  const status = comboReconcileStatus(components, comboPrice);
  const eligible = listEligibleComboComponentServices(catalog, comboId, comboComponentServiceIds(components));
  const addDisabled = eligible.length === 0;
  const wrapPad = compact ? "padding:10px 0 4px;" : "padding:10px 12px;border:1px solid #e9d5ff;border-radius:10px;background:#faf5ff;";
  let rows = "";
  if (!components.length) {
    rows = '<div style="font-size:12px;color:#6b7280;padding:8px 0;">Add at least 2 existing Single Services.</div>';
  } else {
    components.forEach(function (row, index) {
      const service = byId[row.serviceId];
      const minutes = comboDurationMinutes([row], catalog);
      rows += '<div class="ff-combo-component-row" data-service-id="' + escapeHtml(row.serviceId) + '" style="display:grid;grid-template-columns:' + (compact ? "1fr 88px 110px auto" : "1fr 80px 110px auto") + ';gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid #f3e8ff;">' +
        '<div style="min-width:0;">' +
          '<div style="font-size:13px;font-weight:650;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(componentLookupName(service, row.serviceId)) + "</div>" +
          (service ? "" : '<div style="font-size:11px;color:#b91c1c;">This service is missing from the catalog.</div>') +
        "</div>" +
        '<div style="font-size:12px;color:#4b5563;white-space:nowrap;">' + escapeHtml(durationLabel(minutes)) + "</div>" +
        '<label style="display:flex;flex-direction:column;gap:3px;font-size:11px;font-weight:600;color:#6b7280;">' +
          '<span>Allocated price</span>' +
          '<input class="ff-combo-allocated" type="number" min="0" step="0.01" value="' + escapeHtml(Number(row.allocatedPrice).toFixed(2)) + '" style="width:100%;padding:6px 8px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;box-sizing:border-box;">' +
        "</label>" +
        '<div style="display:flex;align-items:center;gap:4px;">' +
          '<button type="button" class="ff-combo-move-up" data-index="' + index + '" title="Move up" style="width:28px;height:28px;border:1px solid #e5e7eb;background:#fff;border-radius:8px;cursor:pointer;color:#374151;"' + (index === 0 ? " disabled" : "") + ">↑</button>" +
          '<button type="button" class="ff-combo-move-down" data-index="' + index + '" title="Move down" style="width:28px;height:28px;border:1px solid #e5e7eb;background:#fff;border-radius:8px;cursor:pointer;color:#374151;"' + (index === components.length - 1 ? " disabled" : "") + ">↓</button>" +
          '<button type="button" class="ff-combo-remove" data-index="' + index + '" title="Remove" style="width:28px;height:28px;border:1px solid #fecaca;background:#fff;border-radius:8px;cursor:pointer;color:#b91c1c;">×</button>' +
        "</div>" +
      "</div>";
    });
  }
  const options = eligible.map(function (service) {
    return '<option value="' + escapeHtml(service.id) + '">' + escapeHtml(service.name) + "</option>";
  }).join("");
  return (
    '<div class="ff-combo-components-section" style="' + wrapPad + '">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">' +
        '<div style="font-size:13px;font-weight:800;color:#5b21b6;">Combo Components</div>' +
        '<span class="ff-combo-reconcile" style="font-size:11px;font-weight:700;color:' + (status.ok ? "#047857" : "#b45309") + ';">' + escapeHtml(status.label) + "</span>" +
      "</div>" +
      '<div class="ff-combo-component-rows">' + rows + "</div>" +
      '<div style="display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap;">' +
        '<select class="ff-combo-add-select" style="flex:1;min-width:160px;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;background:#fff;color:#111827;"' + (addDisabled ? " disabled" : "") + ">" +
          '<option value="">' + (addDisabled ? "No more Single Services available" : "Add existing Single Service") + "</option>" +
          options +
        "</select>" +
        '<button type="button" class="ff-combo-add-btn" style="padding:7px 12px;background:#fff;color:#7c3aed;border:1px solid #e9d5ff;border-radius:999px;cursor:pointer;font-size:12px;font-weight:700;"' + (addDisabled ? " disabled" : "") + ">Add</button>" +
      "</div>" +
    "</div>"
  );
}

export function comboDetailsViewHtml(service, catalogServices, formatMoney) {
  if (!isComboService(service)) return "";
  const money = typeof formatMoney === "function" ? formatMoney : formatComboMoney;
  const catalog = Array.isArray(catalogServices) ? catalogServices : [];
  const byId = catalogById(catalog);
  const components = normalizeComboComponents(service && service.components);
  const rows = components.map(function (row) {
    const referenced = byId[row.serviceId];
    return '<div style="display:grid;grid-template-columns:1fr 88px 110px;gap:8px;padding:6px 0;border-bottom:1px solid #f3f4f6;">' +
      '<div style="font-size:13px;color:#111827;font-weight:600;">' + escapeHtml(componentLookupName(referenced, row.serviceId)) + "</div>" +
      '<div style="font-size:12px;color:#4b5563;">' + escapeHtml(durationLabel(comboDurationMinutes([row], catalog))) + "</div>" +
      '<div style="font-size:13px;color:#111827;font-weight:600;">' + escapeHtml(money(row.allocatedPrice)) + "</div>" +
    "</div>";
  }).join("");
  return (
    '<div style="display:grid;grid-template-columns:160px 1fr;gap:12px;padding:8px 0;border-bottom:1px solid #f3f4f6;">' +
      '<div style="font-size:12px;color:#6b7280;">Components</div>' +
      '<div>' + (rows || '<div style="font-size:12px;color:#6b7280;">No components saved.</div>') + "</div>" +
    "</div>"
  );
}

export function comboBadgeHtml() {
  return '<span class="ff-combo-badge" style="padding:2px 6px;border-radius:999px;background:#ede9fe;color:#5b21b6;font-size:10px;font-weight:700;white-space:nowrap;">Combo</span>';
}

function remainingAllocatedPrice(components, comboPrice) {
  const status = comboReconcileStatus(components, comboPrice);
  const remaining = centsToMoney(status.remainingCents);
  return remaining > 0 ? remaining : 0;
}

export function readComboEditorState(root) {
  if (!root) return { serviceType: SERVICE_TYPE_SINGLE, components: [] };
  const comboRadio = root.querySelector('input[type="radio"][value="combo"]');
  const type = comboRadio && comboRadio.checked ? SERVICE_TYPE_COMBO : SERVICE_TYPE_SINGLE;
  const components = [];
  root.querySelectorAll(".ff-combo-component-row").forEach(function (row, index) {
    const allocatedInp = row.querySelector(".ff-combo-allocated");
    components.push({
      serviceId: String(row.getAttribute("data-service-id") || "").trim(),
      allocatedPrice: Number(allocatedInp && allocatedInp.value),
      sortOrder: index
    });
  });
  return { serviceType: type, components: normalizeComboComponents(components) };
}

export function renderComboEditor(root, state) {
  if (!root) return;
  const next = {
    compact: !!(state && state.compact),
    comboId: state && state.comboId,
    comboPrice: state && state.comboPrice,
    catalogServices: state && state.catalogServices,
    components: state && state.components
  };
  root.innerHTML = comboComponentsSectionHtml(next);
}

export function wireComboEditor(root, options) {
  const opts = options || {};
  const getPrice = typeof opts.getComboPrice === "function" ? opts.getComboPrice : function () { return 0; };
  const catalogServices = function () {
    return typeof opts.getCatalogServices === "function" ? opts.getCatalogServices() : (opts.catalogServices || []);
  };
  const comboId = opts.comboId;
  const compact = !!opts.compact;
  let components = normalizeComboComponents(opts.components);

  function currentState() {
    return {
      compact: compact,
      comboId: comboId,
      comboPrice: getPrice(),
      catalogServices: catalogServices(),
      components: components
    };
  }

  function refresh() {
    renderComboEditor(root, currentState());
    bind();
    if (typeof opts.onChange === "function") opts.onChange(components.slice());
  }

  function bind() {
    const addBtn = root.querySelector(".ff-combo-add-btn");
    const addSel = root.querySelector(".ff-combo-add-select");
    if (addBtn) {
      addBtn.addEventListener("click", function () {
        const serviceId = String(addSel && addSel.value || "").trim();
        if (!serviceId) return;
        components = normalizeComboComponents(components.concat([{
          serviceId: serviceId,
          allocatedPrice: remainingAllocatedPrice(components, getPrice()),
          sortOrder: components.length
        }]));
        refresh();
      });
    }
    root.querySelectorAll(".ff-combo-remove").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const idx = Number(btn.getAttribute("data-index"));
        components = components.filter(function (_row, index) { return index !== idx; });
        refresh();
      });
    });
    root.querySelectorAll(".ff-combo-move-up").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const idx = Number(btn.getAttribute("data-index"));
        if (!idx) return;
        const next = components.slice();
        const tmp = next[idx - 1];
        next[idx - 1] = next[idx];
        next[idx] = tmp;
        components = normalizeComboComponents(next);
        refresh();
      });
    });
    root.querySelectorAll(".ff-combo-move-down").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const idx = Number(btn.getAttribute("data-index"));
        if (idx < 0 || idx >= components.length - 1) return;
        const next = components.slice();
        const tmp = next[idx + 1];
        next[idx + 1] = next[idx];
        next[idx] = tmp;
        components = normalizeComboComponents(next);
        refresh();
      });
    });
    root.querySelectorAll(".ff-combo-allocated").forEach(function (inp, index) {
      inp.addEventListener("input", function () {
        if (!components[index]) return;
        components[index] = {
          serviceId: components[index].serviceId,
          allocatedPrice: Number(inp.value),
          sortOrder: index
        };
        const status = comboReconcileStatus(components, getPrice());
        const label = root.querySelector(".ff-combo-reconcile");
        if (label) {
          label.textContent = status.label;
          label.style.color = status.ok ? "#047857" : "#b45309";
        }
      });
    });
  }

  refresh();
  return {
    getComponents: function () { return normalizeComboComponents(components); },
    setComponents: function (next) {
      components = normalizeComboComponents(next);
      refresh();
    },
    refresh: refresh
  };
}

export function ensureCatalogEditorComboMounts(modal) {
  if (!modal) return null;
  let typeWrap = document.getElementById("servicesCatalogEditorTypeWrap");
  let comboWrap = document.getElementById("servicesCatalogEditorComboWrap");
  const nameInp = document.getElementById("servicesCatalogEditorName");
  const durationWrap = document.getElementById("servicesCatalogEditorDurationWrap");
  const parent = nameInp && nameInp.parentElement;
  if (!parent) return { typeWrap: typeWrap, comboWrap: comboWrap };
  if (!typeWrap) {
    typeWrap = document.createElement("div");
    typeWrap.id = "servicesCatalogEditorTypeWrap";
    typeWrap.style.display = "none";
    parent.insertBefore(typeWrap, nameInp.nextSibling);
  }
  if (!comboWrap) {
    comboWrap = document.createElement("div");
    comboWrap.id = "servicesCatalogEditorComboWrap";
    comboWrap.style.display = "none";
    if (durationWrap && durationWrap.parentElement === parent) {
      parent.insertBefore(comboWrap, durationWrap.nextSibling);
    } else {
      parent.appendChild(comboWrap);
    }
  }
  return { typeWrap: typeWrap, comboWrap: comboWrap };
}

if (typeof window !== "undefined") {
  window.ffCatalogCombo = {
    SERVICE_TYPE_SINGLE,
    SERVICE_TYPE_COMBO,
    MIN_COMBO_COMPONENTS,
    moneyToCents,
    centsToMoney,
    formatComboMoney,
    normalizeServiceType,
    isComboService,
    isSingleService,
    copyComboCatalogFields,
    normalizeComboComponents,
    comboComponentServiceIds,
    listEligibleComboComponentServices,
    combosUsingService,
    comboDurationMinutes,
    allocatedPricesReconcile,
    validateComboService,
    comboSaveFields,
    applyComboFieldsToServicePayload,
    catalogServiceTypeControlsHtml,
    comboComponentsSectionHtml,
    comboDetailsViewHtml,
    comboBadgeHtml,
    comboReconcileStatus,
    readComboEditorState,
    renderComboEditor,
    wireComboEditor
  };
}
