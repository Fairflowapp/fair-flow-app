/**
 * Products — pure stateless helpers.
 *
 * Self-contained utilities for the Products catalog screen: HTML escaping,
 * money coercion/formatting, and pure derivations from a product/staff object
 * (location + staff overrides, default commission, inventory map). No module
 * state, no DOM, no Firestore, no window. Extracted verbatim from products.js.
 */

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[ch]));
}

export function moneyValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function formatMoney(value) {
  const n = moneyValue(value);
  if (typeof window.ffFormatCurrency === "function") {
    return window.ffFormatCurrency(n, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  return "$" + n.toFixed(2);
}

// ===== Locations tab =====
export function getProductLocationOverrides(product) {
  return product && product.locationOverrides && typeof product.locationOverrides === "object"
    ? product.locationOverrides
    : {};
}

// ===== Staff tab =====
export function getProductStaffOverrides(product) {
  return product && product.staffOverrides && typeof product.staffOverrides === "object"
    ? product.staffOverrides
    : {};
}

export function getStaffProductId(staff) {
  return String(staff?.id || staff?.staffId || staff?.uid || staff?.firebaseUid || "").trim();
}

export function getStaffProductName(staff) {
  return String(staff?.name || staff?.displayName || staff?.fullName || staff?.email || "Staff").trim();
}

// Default product commission inherits from the staff member's Earnings Rules
// (Staff Member -> Earnings Rules -> Product Commission). Supports both the
// new { type, value } shape and the legacy { basicPercent } shape.
export function getStaffDefaultProductCommission(staff) {
  const rules = staff && staff.earningsRules && typeof staff.earningsRules === "object" ? staff.earningsRules : {};
  const pc = rules.productCommission && typeof rules.productCommission === "object" ? rules.productCommission : {};
  if (pc.enabled !== true) return null;
  const type = pc.type === "fixed" ? "fixed" : "percentage";
  const raw = Number(pc.value != null ? pc.value : pc.basicPercent);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return { type, value: raw };
}

export function formatProductCommissionDefault(def) {
  if (!def || !Number.isFinite(Number(def.value))) return "Default";
  const v = Number(def.value);
  return def.type === "fixed" ? `Default ${formatMoney(v)}` : `Default ${v}%`;
}

export function ffStaffProductsGetOverrideForStaffMember(product, staffId) {
  const overrides = getProductStaffOverrides(product);
  return overrides && overrides[staffId] && typeof overrides[staffId] === "object"
    ? overrides[staffId]
    : {};
}

export function ffStaffProductsDefaultsForStaffMember(staff, product) {
  return {
    price: Number(product?.retailPrice) || 0,
    commission: getStaffDefaultProductCommission(staff),
  };
}

// ===== Inventory tab (save/load only — no automatic reordering or stock math) =====
export function getProductInventory(product) {
  return product && product.inventory && typeof product.inventory === "object" ? product.inventory : {};
}
