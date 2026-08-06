// inventory-styles.js
// Static CSS for the Inventory screen, extracted verbatim from inventory.js
// (step 1 of the gradual split). Pure string — no logic, no interpolation.
// Injected once by injectMockStylesOnce() in inventory.js.

export const INVENTORY_STYLES = `
#inventoryScreen.ff-inv2-screen {
  font-family: 'Avenir Next', 'Open Sans', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: #0f172a;
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
}
#inventoryScreen .ff-inv2-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
#inventoryScreen .ff-inv2-layout--no-category-aside .ff-inv2-main {
  flex: 1;
  min-width: 0;
}
#inventoryScreen .ff-inv2-od-inv-price-row {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  gap: 4px 6px;
  margin-top: 3px;
  padding-top: 3px;
  border-top: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-od-inv-price-label {
  font-size: 9px;
  font-weight: 600;
  color: #64748b;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-od-inv-price-input {
  width: 3.75rem;
  max-width: 26vw;
  padding: 2px 5px;
  font-size: 11px;
  line-height: 1.2;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-od-inv-price-input:focus {
  outline: 2px solid #c4b5fd;
  outline-offset: 0;
  border-color: #a78bfa;
}
#inventoryScreen .ff-inv2-od-inv-price-hint {
  font-size: 8px;
  font-weight: 600;
  color: #94a3b8;
  flex-shrink: 0;
  width: auto;
  margin: 0;
  line-height: 1.1;
}
#inventoryScreen .ff-inv2-aside {
  width: 280px;
  min-width: 280px;
  max-width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #e2e8f0;
  background: #fff;
  box-shadow: 2px 0 12px rgba(15, 23, 42, 0.04);
}
#inventoryScreen .ff-inv2-mobile-cat-strip {
  display: none;
}
#inventoryScreen .ff-inv2-aside-panel {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
#inventoryScreen .ff-inv2-mobile-aside-collapse {
  display: none;
}
#inventoryScreen .ff-inv2-aside-head-left {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
#inventoryScreen .ff-inv2-aside-head {
  padding: 18px 16px 12px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #64748b;
  border-bottom: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-aside-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px 16px;
}
#inventoryScreen .ff-inv2-aside-loading,
#inventoryScreen .ff-inv2-aside-error {
  margin: 12px 8px;
  font-size: 13px;
  line-height: 1.4;
  color: #64748b;
}
#inventoryScreen .ff-inv2-aside-error {
  color: #b45309;
}
#inventoryScreen .ff-inv2-cat-manage-save:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}
#inventoryScreen .ff-inv2-table-loading-row td {
  padding: 20px 16px;
  text-align: center;
  color: #64748b;
  font-size: 13px;
}
#inventoryScreen .ff-inv2-cat {
  margin-top: 4px;
}
#inventoryScreen .ff-inv2-cat-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 8px;
  border-radius: 8px;
  cursor: pointer;
  user-select: none;
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
}
#inventoryScreen .ff-inv2-cat-row:hover {
  background: #f8fafc;
}
#inventoryScreen .ff-inv2-chevron {
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  transition: transform 0.18s ease;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-cat.is-open .ff-inv2-chevron {
  transform: rotate(90deg);
}
#inventoryScreen .ff-inv2-sub-list {
  padding: 2px 0 6px 8px;
}
#inventoryScreen .ff-inv2-sub {
  padding: 7px 10px 7px 22px;
  margin: 2px 0;
  border-radius: 8px;
  font-size: 13px;
  color: #475569;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: background 0.15s ease, border-color 0.15s ease;
}
#inventoryScreen .ff-inv2-sub:hover {
  background: #f8fafc;
}
#inventoryScreen .ff-inv2-sub.is-active {
  background: #f5f3ff;
  color: #5b21b6;
  font-weight: 600;
  border-left-color: #7c3aed;
}
#inventoryScreen .ff-inv2-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 20px 24px 24px;
  gap: 12px;
  overflow: hidden;
}
#inventoryScreen .ff-inv2-main-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-main-tabs {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 12px;
  flex-shrink: 0;
  border-bottom: 1px solid #e5e7eb;
  background: transparent;
  padding: 2px 0 0;
  margin: 0 0 8px;
}
#inventoryScreen .ff-inv2-main-tab {
  padding: 8px 14px;
  margin: 0 0 -1px;
  border: none;
  border-bottom: 2px solid transparent;
  background: none;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  box-shadow: none;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 0;
  transition: color 0.15s ease, border-color 0.15s ease;
}
#inventoryScreen .ff-inv2-main-tab:hover {
  color: #5b21b6;
  background: transparent;
}
#inventoryScreen .ff-inv2-main-tab--active {
  color: #7c3aed;
  border-bottom-color: #7c3aed;
  font-weight: 500;
  z-index: 1;
  background: transparent;
  box-shadow: none;
}
#inventoryScreen .ff-inv2-main-tab:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: -2px;
}
#inventoryScreen .ff-inv2-main-tab-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
#inventoryScreen .ff-inv2-order-builder-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
#inventoryScreen .ff-inv2-order-builder-wrap .ff-inv2-order-list-card {
  flex: 1;
  min-height: 0;
  max-height: none;
}
#inventoryScreen .ff-inv2-orders-placeholder-card {
  flex: 1;
  min-height: 120px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 8px;
  padding: 28px 24px;
  border-radius: 12px;
  border: 1px dashed #c4b5fd;
  background: linear-gradient(180deg, #faf5ff 0%, #fff 100%);
}
#inventoryScreen .ff-inv2-orders-placeholder-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #5b21b6;
}
#inventoryScreen .ff-inv2-orders-placeholder-hint {
  margin: 0;
  font-size: 14px;
  color: #64748b;
  line-height: 1.45;
  max-width: 420px;
}
#inventoryScreen .ff-inv2-main-tab-body--orders {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
#inventoryScreen .ff-inv2-orders-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  overflow: hidden;
}
#inventoryScreen .ff-inv2-orders-head {
  padding: 14px 18px;
  border-bottom: 1px solid #f1f5f9;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-orders-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-orders-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 10px 14px;
  margin: 0 0 10px;
  padding: 0 18px;
  box-sizing: border-box;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-orders-search-wrap {
  position: relative;
  flex: 1 1 200px;
  min-width: 160px;
  max-width: 360px;
}
#inventoryScreen .ff-inv2-orders-search-input {
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 6px 10px;
  font-size: 13px;
  line-height: 1.35;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-orders-search-wrap--has-clear .ff-inv2-orders-search-input {
  padding-right: 30px;
}
#inventoryScreen .ff-inv2-orders-search-input::placeholder {
  color: #94a3b8;
}
#inventoryScreen .ff-inv2-orders-search-input:focus {
  outline: 2px solid #c4b5fd;
  outline-offset: 1px;
  border-color: #a78bfa;
}
#inventoryScreen .ff-inv2-orders-search-clear {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 26px;
  height: 26px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
#inventoryScreen .ff-inv2-orders-search-clear:hover {
  background: #f1f5f9;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-orders-status-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-orders-loading,
#inventoryScreen .ff-inv2-orders-error,
#inventoryScreen .ff-inv2-orders-empty,
#inventoryScreen .ff-inv2-orders-filter-empty {
  margin: 0;
  padding: 20px 18px;
  font-size: 14px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-orders-error {
  color: #b45309;
}
#inventoryScreen .ff-inv2-orders-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}
#inventoryScreen .ff-inv2-orders-table {
  width: 100%;
  min-width: 640px;
  border-collapse: collapse;
  font-size: 13px;
}
#inventoryScreen .ff-inv2-orders-td--name {
  font-weight: 600;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-orders-td--src {
  font-size: 12px;
  max-width: 200px;
}
#inventoryScreen .ff-inv2-orders-th {
  position: sticky;
  top: 0;
  z-index: 1;
  text-align: left;
  padding: 10px 14px;
  font-weight: 600;
  color: #475569;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-orders-th--num {
  text-align: right;
}
#inventoryScreen .ff-inv2-orders-td {
  padding: 10px 14px;
  border-bottom: 1px solid #f1f5f9;
  color: #0f172a;
  vertical-align: top;
}
#inventoryScreen .ff-inv2-orders-td--muted {
  color: #64748b;
  font-size: 12px;
}
#inventoryScreen .ff-inv2-orders-td--num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
#inventoryScreen .ff-inv2-orders-tr {
  cursor: pointer;
  transition: background 0.12s ease;
}
#inventoryScreen .ff-inv2-orders-tr:hover td {
  background: #fafafa;
}
#inventoryScreen .ff-inv2-orders-tr:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: -2px;
}
#inventoryScreen .ff-inv2-orders-th--narrow {
  width: 44px;
  padding-left: 8px;
  padding-right: 8px;
}
#inventoryScreen .ff-inv2-orders-td--actions {
  text-align: right;
  vertical-align: middle;
  padding: 6px 10px;
}
#inventoryScreen .ff-inv2-orders-kebab {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #64748b;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}
#inventoryScreen .ff-inv2-orders-kebab:hover {
  background: #f8fafc;
  border-color: #c4b5fd;
  color: #5b21b6;
}
#inventoryScreen .ff-inv2-order-detail-card {
  max-width: min(960px, 96vw);
  width: 100%;
  max-height: min(92vh, 920px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
#inventoryScreen .ff-inv2-order-detail-hero {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px 12px;
  margin: 0 0 4px;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-order-detail-hero-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  min-width: 0;
}
#inventoryScreen .ff-inv2-order-detail-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.2;
}
#inventoryScreen .ff-inv2-order-detail-status-pill {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  background: #f1f5f9;
  color: #475569;
  text-transform: lowercase;
}
#inventoryScreen .ff-inv2-order-detail-extras {
  margin: 0 0 10px;
  font-size: 12px;
  color: #64748b;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-order-detail-extras--minimal {
  margin: 0 0 4px;
  font-size: 10px;
}
#inventoryScreen .ff-inv2-order-detail-extras--minimal .ff-inv2-order-detail-extras-summary {
  font-size: 10px;
  font-weight: 600;
}
#inventoryScreen .ff-inv2-order-detail-extras--minimal .ff-inv2-order-detail-extras-body {
  margin-top: 4px;
  padding-top: 4px;
}
#inventoryScreen .ff-inv2-order-detail-receive-hint--compact {
  margin: 4px 0 0;
  font-size: 10px;
  line-height: 1.35;
  color: #64748b;
}
#inventoryScreen .ff-inv2-order-detail-extras-summary {
  cursor: pointer;
  font-weight: 600;
  color: #64748b;
  list-style: none;
}
#inventoryScreen .ff-inv2-order-detail-extras-summary::-webkit-details-marker {
  display: none;
}
/* Mobile (iOS + Android): hide the "Source & details" summary label only.
   The <details> element itself + its body stay in the DOM so any open/close
   logic and spacing remain intact; we just suppress the visible label. */
@media (max-width: 640px) {
  #inventoryScreen .ff-inv2-order-detail-extras-summary {
    display: none !important;
  }
}
#inventoryScreen .ff-inv2-order-detail-extras-body {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-order-detail-meta--compact {
  font-size: 12px;
  gap: 4px;
}
#inventoryScreen .ff-inv2-order-detail-totals-line {
  margin: 6px 0 0;
  font-size: 11px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-order-detail-totals-line--sub {
  font-size: 10px;
  opacity: 0.95;
}
#inventoryScreen .ff-inv2-order-detail-line-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin: 0 0 4px;
  flex-shrink: 0;
  align-items: center;
}
#inventoryScreen .ff-inv2-order-detail-line-filter--export-only {
  justify-content: flex-end;
}
#inventoryScreen .ff-inv2-od-export-menu {
  margin-left: 2px;
  align-self: center;
}
#inventoryScreen .ff-inv2-od-export-menu.ff-inv2-od-tools-details {
  width: auto;
}
#inventoryScreen .ff-inv2-od-export-menu summary.ff-inv2-od-export-menu-trigger {
  list-style: none;
  cursor: pointer;
  margin: 0;
  padding: 0 2px 0 4px;
  font-size: 12px;
  line-height: 1;
  font-weight: 700;
  color: #5b21b6;
  user-select: none;
  border: none;
  background: transparent;
}
#inventoryScreen .ff-inv2-od-export-menu summary.ff-inv2-od-export-menu-trigger::-webkit-details-marker {
  display: none;
}
#inventoryScreen .ff-inv2-od-export-menu-popup {
  left: 0;
  right: auto;
}
#inventoryScreen .ff-inv2-order-detail-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin: 0 0 6px;
}
#inventoryScreen .ff-inv2-order-detail-list-scroll {
  flex: 1;
  min-height: 140px;
  max-height: min(72vh, 760px);
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  padding-bottom: 10px;
  box-sizing: border-box;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist {
  width: 100%;
  min-width: 0;
  table-layout: fixed;
  color-scheme: light;
}
#inventoryScreen .ff-inv2-order-detail-items.ff-inv2-order-detail-items--checklist {
  min-width: 0;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-th,
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-td {
  padding: 1px 2px;
  font-size: 10px;
  line-height: 1.1;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-td {
  min-width: 0;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-th {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #64748b;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-th--item {
  text-transform: none;
  letter-spacing: 0.01em;
  font-size: 10px;
  font-weight: 700;
  color: #475569;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-th--letter {
  text-transform: none;
  letter-spacing: 0.02em;
  font-size: 11px;
  font-weight: 800;
  color: #475569;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-th--col-head {
  text-transform: none;
  letter-spacing: 0.03em;
  font-size: 7px;
  font-weight: 700;
  color: #64748b;
  line-height: 1.05;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-th--narrow {
  width: 24px;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-th:nth-child(2) {
  width: 46%;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-th--code,
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-th:nth-child(3) {
  width: 10%;
  text-align: center;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-th:nth-child(4) {
  width: 11%;
  text-align: center;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-th:nth-child(5) {
  width: 11%;
  text-align: center;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-th:nth-child(5),
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-td--qty-bought {
  border-left: 1px solid #e8ecf1;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-item-stack {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-item-name-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-item-name-row .ff-inv2-od-item-name {
  flex: 1 1 auto;
  min-width: 0;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-inv-price-inline {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 1px;
  min-width: 0;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-inv-price-cur {
  flex-shrink: 0;
  font-size: 8px;
  font-weight: 700;
  color: #64748b;
  line-height: 1;
  max-width: 2.1rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-inv-price-input--inline {
  width: 2.35rem;
  max-width: 14vw;
  padding: 0 1px;
  font-size: 9px;
  line-height: 1.15;
  height: 16px;
  border-radius: 4px;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-td--item {
  min-width: 0;
  padding-right: 2px;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-td--code {
  min-width: 0;
  padding-left: 0;
  padding-right: 2px;
  text-align: center;
  vertical-align: middle;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-item-name {
  display: block;
  font-weight: 500;
  font-size: 11px;
  color: #0f172a;
  line-height: 1.15;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-item-group {
  display: block;
  font-size: 9px;
  font-weight: 500;
  color: #94a3b8;
  line-height: 1.15;
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-item-code {
  display: block;
  font-size: 9px;
  font-weight: 500;
  color: #64748b;
  word-break: break-word;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-item-code--empty {
  color: #94a3b8;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-qty-value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-td--qty {
  vertical-align: middle;
  padding-top: 2px;
  padding-right: 2px;
  padding-left: 2px;
  text-align: center;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-qty-need-value {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 18px;
  min-width: 2.5ch;
  font-weight: 600;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: #334155;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-td--qty-bought {
  vertical-align: middle;
  min-width: 0;
  padding-left: 2px;
  padding-right: 2px;
  padding-top: 2px;
  text-align: center;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-td--check {
  vertical-align: middle;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-shopping-check-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  width: 16px;
  height: 16px;
  margin: 0 auto;
  cursor: pointer;
  vertical-align: middle;
  flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist input.ff-inv2-od-shopping-check {
  position: absolute;
  /* iOS Safari often ignores taps on fully transparent controls */
  opacity: 0.02;
  width: 100%;
  height: 100%;
  margin: 0;
  inset: 0;
  cursor: pointer;
  z-index: 2;
  -webkit-appearance: none;
  appearance: none;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-shopping-check-fake {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 14px;
  height: 14px;
  box-sizing: border-box;
  border: 1.5px solid #64748b;
  border-radius: 2px;
  background: #fff;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 800;
  color: #7c3aed;
  line-height: 1;
  z-index: 0;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-shopping-check:checked + .ff-inv2-od-shopping-check-fake::after {
  content: "✓";
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-shopping-check:focus-visible + .ff-inv2-od-shopping-check-fake {
  outline: 2px solid #a78bfa;
  outline-offset: 2px;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-shopping-check:disabled {
  cursor: not-allowed;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-shopping-check:disabled + .ff-inv2-od-shopping-check-fake {
  opacity: 0.5;
  border-color: #cbd5e1;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-qty-bought-input-row {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 18px;
  width: 100%;
  min-width: 0;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-qty-bought {
  width: 100%;
  max-width: 5.5rem;
  min-width: 3rem;
  min-height: 22px;
  margin: 0 auto;
  display: block;
  box-sizing: border-box;
  padding: 2px 4px;
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: center;
  color: #334155;
  border: 1px solid transparent;
  border-radius: 4px;
  background: #f8fafc;
  box-shadow: none;
  -moz-appearance: textfield;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-qty-bought::-webkit-outer-spin-button,
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-qty-bought::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-qty-bought:focus {
  outline: none;
  background: #fff;
  border-color: #c4b5fd;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-qty-bought::placeholder {
  color: #cbd5e1;
  font-weight: 400;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist .ff-inv2-od-qty-bought-wrap {
  display: block;
  min-width: 0;
  width: 100%;
  max-width: 5.5rem;
  margin: 0 auto;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist tbody tr[data-inv-detail-shopping-row] td {
  overflow: visible;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist tbody tr[data-inv-detail-shopping-row] {
  cursor: pointer;
}
#inventoryScreen .ff-inv2-order-detail-items--checklist tbody tr[data-inv-detail-shopping-row]:hover td {
  background: rgba(248, 250, 252, 0.95);
}
#inventoryScreen .ff-inv2-order-detail-items--checklist tbody tr:has(.ff-inv2-od-shopping-check:checked) td {
  background: rgba(243, 232, 255, 0.55);
}
#inventoryScreen .ff-inv2-order-detail-items--checklist tbody tr:has(.ff-inv2-od-shopping-check:checked):hover td {
  background: rgba(237, 233, 254, 0.75);
}
#inventoryScreen .ff-inv2-order-save-name-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin: 0 0 12px;
}
#inventoryScreen .ff-inv2-order-save-name-label {
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
}
#inventoryScreen .ff-inv2-order-save-name-input {
  flex: 1;
  min-width: 160px;
  max-width: 360px;
  padding: 6px 10px;
  font-size: 13px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}
#inventoryScreen .ff-inv2-order-save-name-input:focus {
  outline: 2px solid #c4b5fd;
  outline-offset: 1px;
  border-color: #a78bfa;
}
#inventoryScreen .ff-inv2-order-detail-head-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 14px;
  margin: 0 0 10px;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-order-detail-head-row .ff-inv2-modal-title {
  margin: 0;
}
#inventoryScreen .ff-inv2-order-detail-head-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: flex-start;
  justify-content: flex-end;
}
#inventoryScreen .ff-inv2-od-tools-row {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  width: 100%;
  margin: 0 0 6px;
}
#inventoryScreen .ff-inv2-od-tools-wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  max-width: 170px;
}
#inventoryScreen .ff-inv2-od-tools-hint-top {
  font-size: 9px;
  font-weight: 600;
  color: #94a3b8;
  line-height: 1.2;
  text-align: right;
  width: 100%;
}
#inventoryScreen .ff-inv2-od-tools-hint-bottom {
  font-size: 9px;
  color: #94a3b8;
  line-height: 1.2;
  text-align: right;
  width: 100%;
}
#inventoryScreen .ff-inv2-od-tools-details {
  position: relative;
  width: 100%;
}
#inventoryScreen .ff-inv2-od-tools-details summary.ff-inv2-od-tools-trigger {
  list-style: none;
  cursor: pointer;
  margin: 0;
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  border: 1px solid #ddd6fe;
  background: #faf5ff;
  color: #5b21b6;
  text-align: center;
  user-select: none;
}
#inventoryScreen .ff-inv2-od-tools-details summary.ff-inv2-od-tools-trigger::-webkit-details-marker {
  display: none;
}
#inventoryScreen .ff-inv2-od-tools-details--disabled summary.ff-inv2-od-tools-trigger,
#inventoryScreen .ff-inv2-od-tools-details--disabled summary.ff-inv2-od-export-menu-trigger {
  pointer-events: none;
  opacity: 0.55;
  cursor: not-allowed;
}
#inventoryScreen .ff-inv2-od-tools-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 6;
  min-width: 148px;
  padding: 4px;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
  background: #fff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
#inventoryScreen .ff-inv2-od-tools-menu-item {
  display: block;
  width: 100%;
  margin: 0;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #0f172a;
  cursor: pointer;
  font-family: inherit;
}
#inventoryScreen .ff-inv2-od-tools-menu-item:hover:not(:disabled) {
  background: #f5f3ff;
}
#inventoryScreen .ff-inv2-od-tools-menu-item:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
#inventoryScreen .ff-inv2-od-detail-action {
  margin: 0;
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  border: 1px solid #ddd6fe;
  background: #faf5ff;
  color: #5b21b6;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
}
#inventoryScreen .ff-inv2-od-detail-action:hover:not(:disabled) {
  background: #f3e8ff;
  border-color: #c4b5fd;
}
#inventoryScreen .ff-inv2-od-detail-action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
#inventoryScreen .ff-inv2-order-detail-meta {
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}
#inventoryScreen .ff-inv2-order-detail-meta-row {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 8px;
  align-items: baseline;
}
#inventoryScreen .ff-inv2-order-detail-meta-row dt {
  margin: 0;
  font-weight: 600;
  color: #64748b;
}
#inventoryScreen .ff-inv2-order-detail-meta-row dd {
  margin: 0;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-order-detail-items-scroll {
  flex: 1;
  min-height: 120px;
  overflow: auto;
  margin: 0 -4px 12px;
  padding: 0 4px;
  -webkit-overflow-scrolling: touch;
}
#inventoryScreen .ff-inv2-order-detail-items {
  width: 100%;
  min-width: 1240px;
  border-collapse: collapse;
  font-size: 12px;
  background: #fff;
}
#inventoryScreen .ff-inv2-od-tr--recv-full > td {
  background: rgba(236, 253, 245, 0.55);
}
#inventoryScreen .ff-inv2-od-tr--recv-partial > td {
  background: rgba(250, 245, 255, 0.65);
}
#inventoryScreen .ff-inv2-od-th--status {
  width: 76px;
}
#inventoryScreen .ff-inv2-od-td--status {
  vertical-align: middle;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-od-line-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.2;
  padding: 3px 7px;
  border-radius: 999px;
  border: 1px solid transparent;
}
#inventoryScreen .ff-inv2-od-line-badge--full {
  color: #166534;
  background: rgba(220, 252, 231, 0.95);
  border-color: rgba(34, 197, 94, 0.28);
}
#inventoryScreen .ff-inv2-od-line-badge--partial {
  color: #6b21a8;
  background: rgba(243, 232, 255, 0.95);
  border-color: rgba(167, 139, 250, 0.32);
}
#inventoryScreen .ff-inv2-od-line-badge--open {
  color: #64748b;
  background: rgba(241, 245, 249, 0.92);
  border-color: rgba(148, 163, 184, 0.35);
}
#inventoryScreen .ff-inv2-od-th--narrow {
  width: 36px;
}
#inventoryScreen .ff-inv2-od-th--center {
  text-align: center;
}
#inventoryScreen .ff-inv2-od-td--center {
  text-align: center;
  vertical-align: middle;
}
#inventoryScreen .ff-inv2-od-recv-check {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: #7c3aed;
}
#inventoryScreen .ff-inv2-od-recv-qty {
  width: 72px;
  max-width: 100%;
  box-sizing: border-box;
  padding: 4px 6px;
  font-size: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  text-align: right;
}
#inventoryScreen .ff-inv2-od-recv-qty:focus {
  outline: 2px solid #c4b5fd;
  outline-offset: 1px;
  border-color: #a78bfa;
}
#inventoryScreen .ff-inv2-order-detail-receive-hint {
  margin: 0 0 6px;
  font-size: 11px;
  color: #64748b;
  line-height: 1.35;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-order-detail-view-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0 0 8px;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-order-detail-items--receiving {
  min-width: 420px;
}
#inventoryScreen .ff-inv2-order-detail-items-scroll--receiving {
  max-width: 100%;
}
#inventoryScreen .ff-inv2-order-detail-totals {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0 0 12px;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-od-summary-chip--cost {
  border-color: #ddd6fe;
  background: #faf5ff;
}
#inventoryScreen .ff-inv2-order-detail-receive-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0 0 8px;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-od-summary-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #64748b;
  line-height: 1.2;
}
#inventoryScreen .ff-inv2-od-summary-chip strong {
  font-weight: 700;
  color: #5b21b6;
}
#inventoryScreen .ff-inv2-od-summary-chip--remaining {
  border-color: #ddd6fe;
  background: #faf5ff;
}
#inventoryScreen .ff-inv2-order-detail-lines-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 18px;
  margin: 0 0 8px;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-order-detail-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-order-detail-sort {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-order-detail-filter-label {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  letter-spacing: 0.02em;
  margin-right: 2px;
}
#inventoryScreen .ff-inv2-od-filter-chip {
  margin: 0;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #64748b;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
#inventoryScreen .ff-inv2-od-filter-chip:hover:not(:disabled) {
  background: #faf5ff;
  border-color: #ddd6fe;
  color: #5b21b6;
}
#inventoryScreen .ff-inv2-od-filter-chip:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
#inventoryScreen .ff-inv2-od-filter--active {
  background: #7c3aed;
  border-color: #7c3aed;
  color: #fff;
}
#inventoryScreen .ff-inv2-od-filter--active:hover:not(:disabled) {
  background: #6d28d9;
  border-color: #6d28d9;
  color: #fff;
}
#inventoryScreen .ff-inv2-order-detail-line-filter .ff-inv2-od-filter-chip {
  padding: 2px 8px;
  font-size: 10px;
}
#inventoryScreen .ff-inv2-od-line-view-card {
  max-width: min(400px, 92vw);
}
#inventoryScreen .ff-inv2-od-line-view-dl {
  margin: 0 0 8px;
  font-size: 12px;
}
#inventoryScreen .ff-inv2-od-line-view-row {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  align-items: flex-start;
  padding: 6px 0;
  border-bottom: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-od-line-view-row:last-child {
  border-bottom: none;
}
#inventoryScreen .ff-inv2-od-line-view-row dt {
  font-weight: 600;
  color: #64748b;
  flex-shrink: 0;
  font-size: 11px;
}
#inventoryScreen .ff-inv2-od-line-view-row dd {
  margin: 0;
  text-align: right;
  color: #0f172a;
  word-break: break-word;
  font-size: 12px;
}
#inventoryScreen .ff-inv2-od-th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px 8px;
  text-align: left;
  font-weight: 600;
  color: #475569;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-od-td {
  padding: 8px 8px;
  border-bottom: 1px solid #f1f5f9;
  color: #0f172a;
  vertical-align: top;
}
#inventoryScreen .ff-inv2-od-td--num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
#inventoryScreen .ff-inv2-od-url-wrap {
  max-width: 120px;
}
#inventoryScreen .ff-inv2-od-url {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-order-detail-no-items,
#inventoryScreen .ff-inv2-order-detail-missing {
  margin: 0 0 12px;
  font-size: 13px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-receive-modal-card .ff-inv2-modal-title {
  flex-shrink: 0;
  margin-bottom: 12px;
}
#inventoryScreen .ff-inv2-receive-items-scroll {
  flex: 0 1 auto;
  max-height: min(38vh, 320px);
  min-height: 0;
  overflow: auto;
  margin: 0 0 12px;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
  background: #fff;
  -webkit-overflow-scrolling: touch;
}
#inventoryScreen .ff-inv2-receive-items {
  width: 100%;
  min-width: 480px;
  border-collapse: collapse;
  font-size: 12px;
}
#inventoryScreen .ff-inv2-rcv-th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px 10px;
  text-align: left;
  font-weight: 600;
  color: #475569;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-rcv-th--num {
  text-align: right;
}
#inventoryScreen .ff-inv2-rcv-td {
  padding: 8px 10px;
  border-bottom: 1px solid #f1f5f9;
  color: #0f172a;
  vertical-align: middle;
}
#inventoryScreen .ff-inv2-rcv-td--num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
#inventoryScreen .ff-inv2-rcv-td--input {
  padding: 6px 8px;
}
#inventoryScreen .ff-inv2-rcv-input {
  width: 100%;
  max-width: 100px;
  box-sizing: border-box;
  padding: 5px 8px;
  font-size: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  text-align: right;
}
#inventoryScreen .ff-inv2-rcv-input:focus {
  outline: 2px solid #c4b5fd;
  outline-offset: 1px;
  border-color: #a78bfa;
}
#inventoryScreen .ff-inv2-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
#inventoryScreen .ff-inv2-btn--sm {
  padding: 6px 12px;
  font-size: 11px;
}
#inventoryScreen .ff-inv2-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  pointer-events: none;
}
#inventoryScreen .ff-inv2-order-detail-footer {
  justify-content: flex-start;
  align-items: stretch;
  flex-wrap: nowrap;
  gap: 4px;
  padding: 8px 6px 10px;
  margin-top: auto;
  flex-shrink: 0;
  border-top: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-order-detail-footer-spacer {
  display: none;
}
#inventoryScreen .ff-inv2-order-detail-footer .ff-inv2-modal-btn {
  flex: 1 1 0;
  min-width: 0;
  padding: 7px 5px;
  font-size: 10px;
  line-height: 1.2;
  text-align: center;
  white-space: normal;
  word-break: break-word;
  border-radius: 6px;
}
#inventoryScreen .ff-inv2-order-detail-receipt-btn {
  font-weight: 600;
}
#inventoryScreen .ff-inv2-receipt-info-card {
  max-width: min(440px, 94vw);
  max-height: min(88vh, 720px);
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 8px;
}
#inventoryScreen .ff-inv2-receipt-info-upload-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
}
#inventoryScreen .ff-inv2-receipt-info-section-label {
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
}
#inventoryScreen .ff-inv2-receipt-info-uploaded {
  margin-bottom: 12px;
}
#inventoryScreen .ff-inv2-or-scroll--modal {
  max-height: min(220px, 36vh);
  overflow: auto;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #fff;
}
#inventoryScreen .ff-inv2-receipt-info-footer {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-receipt-info-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 4px;
}
#inventoryScreen .ff-inv2-receipt-info-head .ff-inv2-modal-title {
  margin: 0;
  flex: 1;
  min-width: 0;
}
#inventoryScreen .ff-inv2-receipt-info-hint {
  margin-bottom: 14px;
}
#inventoryScreen .ff-inv2-receipt-info-close {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  margin: -4px -6px 0 0;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #64748b;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
#inventoryScreen .ff-inv2-receipt-info-close:hover {
  background: #f1f5f9;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-receipt-info-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 6px;
}
#inventoryScreen .ff-inv2-receipt-info-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
}
#inventoryScreen .ff-inv2-receipt-info-label {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
#inventoryScreen .ff-inv2-receipt-info-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  font-size: 13px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}
#inventoryScreen .ff-inv2-receipt-info-input:focus {
  outline: 2px solid #c4b5fd;
  outline-offset: 1px;
  border-color: #a78bfa;
}
#inventoryScreen .ff-inv2-or-loading,
#inventoryScreen .ff-inv2-or-empty {
  margin: 0;
  font-size: 12px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-or-scroll {
  max-height: min(200px, 28vh);
  overflow: auto;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #fff;
}
#inventoryScreen .ff-inv2-or-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
#inventoryScreen .ff-inv2-or-th {
  position: sticky;
  top: 0;
  padding: 8px 10px;
  text-align: left;
  font-weight: 600;
  color: #475569;
  background: #f1f5f9;
  border-bottom: 1px solid #e2e8f0;
}
#inventoryScreen .ff-inv2-or-td {
  padding: 8px 10px;
  border-bottom: 1px solid #f1f5f9;
  color: #0f172a;
  vertical-align: top;
  word-break: break-word;
}
#inventoryScreen .ff-inv2-or-td--muted {
  color: #64748b;
  font-size: 11px;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-or-link {
  font-weight: 600;
  color: #5b21b6;
  text-decoration: none;
}
#inventoryScreen .ff-inv2-or-link:hover {
  text-decoration: underline;
}
#inventoryScreen .ff-inv2-or-th--icon {
  width: 32px;
  text-align: center;
  padding-left: 2px;
  padding-right: 2px;
}
#inventoryScreen .ff-inv2-or-td--icon {
  width: 32px;
  text-align: center;
  padding-left: 2px;
  padding-right: 2px;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-or-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  text-decoration: none;
}
#inventoryScreen .ff-inv2-or-icon-btn svg {
  pointer-events: none;
}
#inventoryScreen a.ff-inv2-or-icon-btn {
  color: #5b21b6;
}
#inventoryScreen a.ff-inv2-or-icon-btn:hover {
  background: #faf5ff;
  border-color: #ddd6fe;
}
#inventoryScreen button.ff-inv2-or-delete.ff-inv2-or-icon-btn {
  color: #b91c1c;
}
#inventoryScreen button.ff-inv2-or-delete.ff-inv2-or-icon-btn:hover {
  background: #fef2f2;
  border-color: #fecaca;
}
#inventoryScreen .ff-inv2-or-filetype {
  display: inline-block;
  margin-right: 4px;
  font-size: 14px;
  line-height: 1;
  vertical-align: -1px;
}
#inventoryScreen .ff-inv2-or-filename {
  word-break: break-word;
}
#inventoryScreen .ff-inv2-crumb {
  font-size: 13px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-crumb strong {
  color: #0f172a;
  font-weight: 600;
}
#inventoryScreen .ff-inv2-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid #e2e8f0;
  background: #fafafa;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  color: #5b21b6;
  background: #fff;
  border: 1px solid #ddd6fe;
  border-radius: 8px;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
}
#inventoryScreen .ff-inv2-btn:hover {
  background: #faf5ff;
  border-color: #c4b5fd;
}
#inventoryScreen .ff-inv2-btn--outline {
  background: #fff;
  border-color: #e2e8f0;
  color: #5b21b6;
  box-shadow: none;
}
#inventoryScreen .ff-inv2-btn--outline:hover {
  background: #faf5ff;
  border-color: #c4b5fd;
}
#inventoryScreen .ff-inv2-table-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  overflow: hidden;
}
#inventoryScreen .ff-inv2-table-scroll {
  flex: 1;
  min-height: 0;
  overflow-x: auto;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
#inventoryScreen .ff-inv2-order-list-card {
  flex: 0 1 auto;
  max-height: min(38vh, 300px);
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  overflow: hidden;
}
#inventoryScreen .ff-inv2-order-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #e2e8f0;
  background: #fafafa;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-draft-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: linear-gradient(180deg, #faf5ff 0%, #f5f3ff 100%);
  border-bottom: 1px solid #e9d5ff;
  font-size: 12px;
  color: #5b21b6;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-order-list-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}
/* Always-visible "Draft · Saved" chip next to the Order list title */
#inventoryScreen .ff-inv2-draft-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 10px;
  font-size: 11px;
  font-weight: 600;
  color: #5b21b6;
  background: #ede9fe;
  border: 1px solid #ddd6fe;
  border-radius: 999px;
  line-height: 1.4;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-draft-chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #7c3aed;
  display: inline-block;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-draft-chip-label {
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-size: 10px;
  font-weight: 700;
}
#inventoryScreen .ff-inv2-draft-chip-sep {
  color: #c4b5fd;
  opacity: 0.8;
}
#inventoryScreen .ff-inv2-draft-chip-status {
  color: #6d28d9;
  font-weight: 500;
}
#inventoryScreen .ff-inv2-draft-chip-status[data-state="saving"] {
  color: #9ca3af;
  font-style: italic;
}
#inventoryScreen .ff-inv2-draft-chip-status[data-state="saved"] {
  color: #047857;
}
#inventoryScreen .ff-inv2-draft-chip-status[data-state="saving"]::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  margin-right: 4px;
  animation: ff-inv2-draft-pulse 1s ease-in-out infinite;
}
@keyframes ff-inv2-draft-pulse {
  0%, 100% { opacity: 0.2; }
  50% { opacity: 1; }
}
/* "New order list" next to the Draft chip — starts a fresh draft */
#inventoryScreen .ff-inv2-draft-new-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: #5b21b6;
  background: #fff;
  border: 1px solid #ddd6fe;
  border-radius: 999px;
  cursor: pointer;
  font-family: inherit;
  line-height: 1.25;
  white-space: nowrap;
  transition: background 0.12s ease, border-color 0.12s ease;
}
#inventoryScreen .ff-inv2-draft-new-btn:hover:not(:disabled) {
  background: #f5f3ff;
  border-color: #c4b5fd;
}
#inventoryScreen .ff-inv2-draft-new-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
/* Draft chip becomes a clickable button — same visual, adds caret + hover affordance */
#inventoryScreen .ff-inv2-draft-chip--btn {
  cursor: pointer;
  font-family: inherit;
  user-select: none;
}
#inventoryScreen .ff-inv2-draft-chip--btn:hover {
  background: #ddd6fe;
  border-color: #c4b5fd;
}
#inventoryScreen .ff-inv2-draft-chip-caret {
  margin-left: 2px;
  font-size: 9px;
  opacity: 0.7;
}
/* Drafts picker modal */
#inventoryScreen .ff-inv2-drafts-picker-backdrop {
  z-index: 2147483645;
}
#inventoryScreen .ff-inv2-drafts-picker-card {
  max-width: 520px;
  width: 100%;
}
#inventoryScreen .ff-inv2-drafts-picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
#inventoryScreen .ff-inv2-drafts-picker-close {
  background: none;
  border: none;
  font-size: 22px;
  line-height: 1;
  color: #94a3b8;
  cursor: pointer;
  padding: 0 4px;
}
#inventoryScreen .ff-inv2-drafts-picker-close:hover {
  color: #0f172a;
}
#inventoryScreen .ff-inv2-drafts-picker-list {
  list-style: none;
  margin: 10px 0 16px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 60vh;
  overflow-y: auto;
}
#inventoryScreen .ff-inv2-drafts-picker-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
}
#inventoryScreen .ff-inv2-drafts-picker-row--active {
  border-color: #c4b5fd;
  background: #faf5ff;
}
#inventoryScreen .ff-inv2-drafts-picker-main {
  flex: 1;
  min-width: 0;
}
#inventoryScreen .ff-inv2-drafts-picker-name {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-drafts-picker-meta {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 2px;
}
#inventoryScreen .ff-inv2-drafts-picker-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-drafts-picker-current {
  font-size: 11px;
  font-weight: 700;
  color: #5b21b6;
  background: #ede9fe;
  padding: 3px 10px;
  border-radius: 999px;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
#inventoryScreen .ff-inv2-drafts-picker-switch {
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: #7c3aed;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-family: inherit;
}
#inventoryScreen .ff-inv2-drafts-picker-switch:hover {
  background: #6d28d9;
}
#inventoryScreen .ff-inv2-drafts-picker-delete {
  padding: 4px 8px;
  font-size: 13px;
  color: #94a3b8;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
}
#inventoryScreen .ff-inv2-drafts-picker-delete:hover {
  color: #b91c1c;
  border-color: #fecaca;
  background: #fef2f2;
}
#inventoryScreen .ff-inv2-drafts-picker-empty {
  color: #64748b;
  font-size: 13px;
  text-align: center;
  padding: 24px 0;
  margin: 0;
}
#inventoryScreen .ff-inv2-drafts-picker-actions-row {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
#inventoryScreen .ff-inv2-draft-banner-icon {
  font-size: 14px;
  line-height: 1;
}
#inventoryScreen .ff-inv2-draft-banner-text {
  flex: 1;
  min-width: 0;
}
#inventoryScreen .ff-inv2-draft-banner-text strong {
  color: #6d28d9;
  font-weight: 700;
}
#inventoryScreen .ff-inv2-draft-banner-hint {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #7c3aed;
  background: #ede9fe;
  padding: 2px 8px;
  border-radius: 999px;
  flex-shrink: 0;
}
/* Inline editable qty input for manual Order-list rows — matches the "plain cell" look
 * from the Inventory table. Transparent by default; hover / focus reveal the edit state. */
#inventoryScreen .ff-inv2-order-list-table th.ff-inv2-ol-th--qty,
#inventoryScreen .ff-inv2-order-list-table td.ff-inv2-ol-td--qty {
  width: 80px;
  min-width: 72px;
  max-width: 104px;
  text-align: right;
  vertical-align: middle;
  box-sizing: border-box;
}
#inventoryScreen .ff-inv2-order-list-table td.ff-inv2-ol-td--qty .ff-inv2-ol-qty-input {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  display: block;
}
#inventoryScreen .ff-inv2-ol-qty-input {
  width: 100%;
  max-width: 64px;
  padding: 2px 4px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: #0f172a;
  text-align: right;
  font-family: inherit;
  line-height: 1.3;
  box-sizing: border-box;
  -moz-appearance: textfield;
  cursor: text;
  transition: background 0.12s ease, border-color 0.12s ease;
}
#inventoryScreen .ff-inv2-ol-qty-input::-webkit-outer-spin-button,
#inventoryScreen .ff-inv2-ol-qty-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
#inventoryScreen .ff-inv2-ol-qty-input:hover {
  background: #f8fafc;
  border-color: #e2e8f0;
}
#inventoryScreen .ff-inv2-ol-qty-input:focus {
  outline: none;
  background: #fff;
  border-color: #a78bfa;
  box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.12);
}
#inventoryScreen .ff-inv2-order-list-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-order-list-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
#inventoryScreen .ff-inv2-ol-tr--manual td {
  background: #faf5ff;
}
#inventoryScreen .ff-inv2-ol-manual-tag {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #5b21b6;
  background: #ede9fe;
  border-radius: 999px;
  vertical-align: middle;
}
#inventoryScreen .ff-inv2-ol-manual-remove {
  width: 22px;
  height: 22px;
  padding: 0;
  font-size: 14px;
  line-height: 1;
  color: #94a3b8;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
}
#inventoryScreen .ff-inv2-ol-manual-remove:hover {
  color: #b91c1c;
  background: #fef2f2;
  border-color: #fecaca;
}
#inventoryScreen .ff-inv2-ol-linked-tag {
  display: inline-block;
  font-size: 10px;
  margin-left: 2px;
  vertical-align: middle;
}
#inventoryScreen .ff-inv2-ob-add-card {
  max-width: 420px;
}
#inventoryScreen .ff-inv2-ob-add-hint {
  margin: 0 0 8px;
  font-size: 11px;
  color: #b45309;
  background: #fef3c7;
  padding: 6px 10px;
  border-radius: 6px;
}
#inventoryScreen .ff-inv2-modal-field-optional {
  font-weight: 400;
  font-size: 10px;
  color: #94a3b8;
  text-transform: none;
  letter-spacing: 0;
}
#inventoryScreen .ff-inv2-ob-link-wrap {
  display: block;
}
#inventoryScreen .ff-inv2-ob-link-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0 6px;
}
#inventoryScreen .ff-inv2-ob-link-head-label {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-ob-link-back {
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  color: #5b21b6;
  background: transparent;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
}
#inventoryScreen .ff-inv2-ob-link-back:hover {
  background: #faf5ff;
  border-color: #ddd6fe;
}
#inventoryScreen .ff-inv2-ob-link-option-chev {
  margin-left: auto;
  padding-left: 8px;
  font-size: 14px;
  color: #cbd5e1;
}
#inventoryScreen .ff-inv2-ob-link-option {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
#inventoryScreen .ff-inv2-ob-link-hint {
  margin: 6px 0 0;
  padding: 8px 10px;
  font-size: 11px;
  color: #94a3b8;
  background: #f8fafc;
  border-radius: 6px;
}
#inventoryScreen .ff-inv2-ob-link-list {
  margin-top: 6px;
  max-height: 180px;
  overflow: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}
#inventoryScreen .ff-inv2-ob-link-option {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  border: none;
  background: #fff;
  cursor: pointer;
  border-bottom: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-ob-link-option:last-child {
  border-bottom: none;
}
#inventoryScreen .ff-inv2-ob-link-option:hover {
  background: #faf5ff;
}
#inventoryScreen .ff-inv2-ob-link-option-name {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-ob-link-option-meta {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-ob-link-selected {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: #ede9fe;
  border: 1px solid #c4b5fd;
  border-radius: 8px;
}
#inventoryScreen .ff-inv2-ob-link-selected-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
#inventoryScreen .ff-inv2-ob-link-selected-name {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #5b21b6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-ob-link-selected-sub {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  color: #7c3aed;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-ob-link-clear {
  width: 24px;
  height: 24px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #6d28d9;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}
#inventoryScreen .ff-inv2-ob-link-clear:hover {
  background: #ddd6fe;
}
#inventoryScreen .ff-inv2-order-list-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}
#inventoryScreen .ff-inv2-order-list-table {
  width: 100%;
  min-width: 880px;
  border-collapse: collapse;
  font-size: 12px;
  background: #fff;
}
#inventoryScreen .ff-inv2-order-list-table th.ff-inv2-ol-th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px 10px;
  text-align: left;
  font-weight: 600;
  color: #475569;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-order-list-table td.ff-inv2-ol-td {
  padding: 8px 10px;
  border-bottom: 1px solid #f1f5f9;
  color: #0f172a;
  vertical-align: top;
}
#inventoryScreen .ff-inv2-order-list-table tbody tr:hover td {
  background: #fafafa;
}
#inventoryScreen .ff-inv2-ol-url-wrap {
  max-width: 140px;
}
#inventoryScreen .ff-inv2-ol-url {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-order-list-empty {
  margin: 0;
  padding: 14px 16px;
  font-size: 13px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-order-list-loading {
  margin: 0;
  padding: 20px 16px;
  font-size: 13px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-ob-source {
  padding: 12px 16px;
  border-bottom: 1px solid #e2e8f0;
  background: #fafafa;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-ob-source-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}
#inventoryScreen .ff-inv2-ob-source-copy {
  flex: 1;
  min-width: 0;
}
#inventoryScreen .ff-inv2-ob-source-copy .ff-inv2-ob-source-hint {
  margin: 0;
}
#inventoryScreen .ff-inv2-ob-mobile-done {
  flex-shrink: 0;
  margin: 0;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  color: #5b21b6;
  background: #fff;
  border: 1px solid #ddd6fe;
  border-radius: 8px;
  cursor: pointer;
  font-family: inherit;
}
#inventoryScreen .ff-inv2-ob-mobile-done:hover {
  background: #f5f3ff;
}
#inventoryScreen .ff-inv2-order-list-table-hint {
  margin: 0;
  padding: 8px 12px 4px;
  font-size: 11px;
  color: #64748b;
  text-align: center;
  line-height: 1.35;
}
#inventoryScreen .ff-inv2-ob-add-item-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  flex: 0 0 auto;
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  border-radius: 8px;
}
#inventoryScreen .ff-inv2-main-tab-body--insights {
  padding: 12px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
#inventoryScreen .ff-inv2-insights-wrap {
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-insights-wrap > .ff-inv2-insights-head {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px 16px;
  gap: 8px;
}
#inventoryScreen .ff-inv2-insights-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}
#inventoryScreen .ff-inv2-insights-kpi {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
#inventoryScreen .ff-inv2-insights-kpi-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #64748b;
}
#inventoryScreen .ff-inv2-insights-kpi-value {
  font-size: 22px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
#inventoryScreen .ff-inv2-insights-kpi-sub {
  margin-top: 2px;
  font-size: 11px;
  color: #94a3b8;
}
#inventoryScreen .ff-inv2-insights-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px 16px;
}
#inventoryScreen .ff-inv2-insights-card--warn {
  border-color: #fde68a;
  background: #fffbeb;
}
#inventoryScreen .ff-inv2-insights-card--dead {
  border-color: #e2e8f0;
  background: #f8fafc;
}
#inventoryScreen .ff-inv2-insights-card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
#inventoryScreen .ff-inv2-insights-card-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-insights-card-hint {
  font-size: 11px;
  color: #94a3b8;
}
#inventoryScreen .ff-inv2-insights-spend-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
#inventoryScreen .ff-inv2-insights-spend-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
#inventoryScreen .ff-inv2-insights-spend-name-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 13px;
}
#inventoryScreen .ff-inv2-insights-spend-name {
  flex: 1;
  font-weight: 600;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-insights-spend-amount {
  font-weight: 700;
  color: #5b21b6;
  font-variant-numeric: tabular-nums;
}
#inventoryScreen .ff-inv2-insights-spend-pct {
  font-size: 11px;
  color: #64748b;
  font-variant-numeric: tabular-nums;
  min-width: 40px;
  text-align: right;
}
#inventoryScreen .ff-inv2-insights-spend-bar {
  height: 6px;
  border-radius: 999px;
  background: #f1f5f9;
  overflow: hidden;
}
#inventoryScreen .ff-inv2-insights-spend-bar > span {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #a78bfa 0%, #7c3aed 100%);
  border-radius: 999px;
}
#inventoryScreen .ff-inv2-insights-low-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
#inventoryScreen .ff-inv2-insights-low-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-insights-low-row:last-child {
  border-bottom: none;
}
#inventoryScreen .ff-inv2-insights-low-main {
  flex: 1;
  min-width: 0;
}
#inventoryScreen .ff-inv2-insights-low-name {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-insights-low-path {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 2px;
}
#inventoryScreen .ff-inv2-insights-low-qty {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-variant-numeric: tabular-nums;
}
#inventoryScreen .ff-inv2-insights-low-current {
  font-weight: 700;
  font-size: 14px;
  color: #b45309;
}
#inventoryScreen .ff-inv2-insights-card--dead .ff-inv2-insights-low-current {
  color: #64748b;
}
#inventoryScreen .ff-inv2-insights-low-sep {
  font-size: 11px;
  color: #94a3b8;
}
#inventoryScreen .ff-inv2-insights-low-stock {
  font-size: 13px;
  color: #475569;
}
#inventoryScreen .ff-inv2-insights-low-pct {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 700;
  color: #b45309;
  background: #fef3c7;
  border-radius: 999px;
  padding: 2px 8px;
}
/* Month-over-Month delta pill on Total spend KPI */
#inventoryScreen .ff-inv2-insights-delta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  width: fit-content;
  margin-top: 4px;
}
#inventoryScreen .ff-inv2-insights-delta-arrow {
  font-size: 10px;
  line-height: 1;
}
#inventoryScreen .ff-inv2-insights-delta--up {
  color: #b91c1c;
  background: #fee2e2;
}
#inventoryScreen .ff-inv2-insights-delta--down {
  color: #047857;
  background: #d1fae5;
}
#inventoryScreen .ff-inv2-insights-delta--flat {
  color: #64748b;
  background: #f1f5f9;
}
/* Smart Reorder Suggestions */
#inventoryScreen .ff-inv2-insights-reorder-qty {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  font-variant-numeric: tabular-nums;
}
#inventoryScreen .ff-inv2-insights-reorder-days {
  font-size: 11px;
  font-weight: 700;
  color: #b91c1c;
  background: #fee2e2;
  border-radius: 999px;
  padding: 2px 8px;
}
#inventoryScreen .ff-inv2-insights-reorder-suggest {
  font-size: 11px;
  font-weight: 600;
  color: #0f172a;
  background: #ede9fe;
  border-radius: 999px;
  padding: 2px 8px;
}
/* Days of Stock Left — usage list */
#inventoryScreen .ff-inv2-insights-usage-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
#inventoryScreen .ff-inv2-insights-usage-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-insights-usage-row:last-child {
  border-bottom: none;
}
#inventoryScreen .ff-inv2-insights-usage-main {
  flex: 1;
  min-width: 0;
}
#inventoryScreen .ff-inv2-insights-usage-name {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-insights-usage-path {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 2px;
}
#inventoryScreen .ff-inv2-insights-usage-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  font-variant-numeric: tabular-nums;
}
#inventoryScreen .ff-inv2-insights-usage-current {
  font-size: 11px;
  color: #64748b;
  font-weight: 500;
}
#inventoryScreen .ff-inv2-insights-usage-badge {
  font-size: 11px;
  font-weight: 700;
  border-radius: 999px;
  padding: 2px 10px;
  background: #f1f5f9;
  color: #475569;
  min-width: 44px;
  text-align: center;
}
#inventoryScreen .ff-inv2-insights-usage-badge--critical {
  color: #b91c1c;
  background: #fee2e2;
}
#inventoryScreen .ff-inv2-insights-usage-badge--low {
  color: #b45309;
  background: #fef3c7;
}
#inventoryScreen .ff-inv2-insights-usage-badge--ok {
  color: #047857;
  background: #d1fae5;
}
#inventoryScreen .ff-inv2-insights-usage-more {
  font-size: 11px;
  color: #94a3b8;
  padding-top: 8px;
  text-align: center;
  font-style: italic;
}
/* Donut chart — Spend by Category (Overview) */
#inventoryScreen .ff-inv2-insights-donut-wrap {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}
#inventoryScreen .ff-inv2-insights-donut-chart {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}
#inventoryScreen .ff-inv2-insights-donut-svg {
  display: block;
}
#inventoryScreen .ff-inv2-insights-donut-total {
  font-family: inherit;
  font-size: 15px;
  font-weight: 700;
  fill: #0f172a;
}
#inventoryScreen .ff-inv2-insights-donut-sub {
  font-family: inherit;
  font-size: 9px;
  fill: #94a3b8;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
#inventoryScreen .ff-inv2-insights-donut-legend {
  flex: 1;
  min-width: 220px;
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
#inventoryScreen .ff-inv2-insights-donut-legend-row {
  display: grid;
  grid-template-columns: 12px 1fr auto auto;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #f1f5f9;
  font-size: 12px;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-insights-donut-legend-row:last-child {
  border-bottom: none;
}
#inventoryScreen .ff-inv2-insights-donut-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  display: inline-block;
}
#inventoryScreen .ff-inv2-insights-donut-legend-name {
  font-weight: 600;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
#inventoryScreen .ff-inv2-insights-donut-legend-amount {
  font-variant-numeric: tabular-nums;
  color: #475569;
}
#inventoryScreen .ff-inv2-insights-donut-legend-pct {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: #0f172a;
  font-size: 11px;
  background: #f1f5f9;
  padding: 2px 8px;
  border-radius: 999px;
  min-width: 42px;
  text-align: center;
}
/* Intro banner for sub-tabs (e.g. Forecast explanation) */
#inventoryScreen .ff-inv2-insights-subtab-intro {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  background: linear-gradient(180deg, #faf5ff 0%, #f5f3ff 100%);
  border: 1px solid #e9d5ff;
  border-radius: 10px;
}
#inventoryScreen .ff-inv2-insights-subtab-intro-icon {
  font-size: 18px;
  line-height: 1.2;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-insights-subtab-intro-title {
  font-size: 12px;
  font-weight: 700;
  color: #5b21b6;
  letter-spacing: 0.02em;
}
#inventoryScreen .ff-inv2-insights-subtab-intro-hint {
  font-size: 11px;
  color: #6b21a8;
  margin-top: 2px;
  line-height: 1.4;
}
/* Insights sub-tabs (Overview / Purchases / Forecast / Stock Health) */
#inventoryScreen .ff-inv2-insights-subtabs {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid #e2e8f0;
  margin: 2px 0 4px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
#inventoryScreen .ff-inv2-insights-subtabs::-webkit-scrollbar {
  display: none;
}
#inventoryScreen .ff-inv2-insights-subtab {
  flex: 0 0 auto;
  background: transparent;
  border: none;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 500;
  color: #64748b;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  white-space: nowrap;
  transition: color 120ms ease, border-color 120ms ease;
  font-family: inherit;
}
#inventoryScreen .ff-inv2-insights-subtab:hover {
  color: #0f172a;
}
#inventoryScreen .ff-inv2-insights-subtab--active {
  color: #7c3aed;
  font-weight: 600;
  border-bottom-color: #7c3aed;
}
#inventoryScreen .ff-inv2-insights-subtab:focus-visible {
  outline: 2px solid #c4b5fd;
  outline-offset: 2px;
  border-radius: 4px;
}
#inventoryScreen .ff-inv2-insights-head {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
#inventoryScreen .ff-inv2-insights-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
#inventoryScreen .ff-inv2-insights-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-insights-range-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
}
#inventoryScreen .ff-inv2-insights-range-select {
  padding: 6px 28px 6px 10px;
  font-size: 13px;
  font-weight: 500;
  color: #0f172a;
  background: #fff
    url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%2364748b' d='M5 6 0 0h10z'/%3E%3C/svg%3E")
    no-repeat right 10px center;
  background-size: 9px 5px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
}
#inventoryScreen .ff-inv2-insights-range-select:focus {
  outline: 2px solid #c4b5fd;
  outline-offset: 1px;
  border-color: #a78bfa;
}
#inventoryScreen .ff-inv2-insights-custom {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
#inventoryScreen .ff-inv2-insights-date-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #475569;
}
#inventoryScreen .ff-inv2-insights-date-label input[type="date"] {
  padding: 5px 8px;
  font-size: 13px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  color: #0f172a;
  background: #fff;
}
#inventoryScreen .ff-inv2-insights-empty {
  margin: 0;
  padding: 24px 12px;
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
}
#inventoryScreen .ff-inv2-insights-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
#inventoryScreen .ff-inv2-insights-row {
  display: grid;
  grid-template-columns: 28px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 10px 4px;
  border-bottom: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-insights-row:last-child {
  border-bottom: none;
}
#inventoryScreen .ff-inv2-insights-rank {
  color: #94a3b8;
  font-weight: 600;
  font-size: 12px;
  text-align: right;
}
#inventoryScreen .ff-inv2-insights-name {
  color: #0f172a;
  font-weight: 500;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
}
#inventoryScreen .ff-inv2-insights-qty {
  color: #5b21b6;
  font-weight: 700;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  background: #ede9fe;
  border-radius: 999px;
  padding: 2px 12px;
  min-width: 56px;
  text-align: center;
}
#inventoryScreen .ff-inv2-ob-source-title {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: none;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-ob-source-hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-ob-source-radios {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
#inventoryScreen .ff-inv2-ob-radio {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  color: #0f172a;
  cursor: pointer;
}
#inventoryScreen .ff-inv2-ob-radio input {
  margin-top: 3px;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-ob-muted {
  color: #64748b;
  font-weight: 400;
}
#inventoryScreen .ff-inv2-ob-custom {
  margin-top: 0;
  max-height: min(32vh, 260px);
  overflow: auto;
  padding: 0;
  -webkit-overflow-scrolling: touch;
}
#inventoryScreen .ff-inv2-ob-tree {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
#inventoryScreen .ff-inv2-ob-cat-block {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
}
#inventoryScreen .ff-inv2-ob-cat-block--open {
  border-color: #c4b5fd;
  background: #faf5ff;
}
#inventoryScreen .ff-inv2-ob-cat-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
}
#inventoryScreen .ff-inv2-ob-cat-toggle {
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background 0.12s ease, color 0.12s ease;
}
#inventoryScreen .ff-inv2-ob-cat-toggle:hover {
  background: #ede9fe;
  color: #5b21b6;
}
#inventoryScreen .ff-inv2-ob-cat-chev {
  font-size: 12px;
  line-height: 1;
}
#inventoryScreen .ff-inv2-ob-cat-label {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: 13px;
  color: #1e293b;
  cursor: pointer;
}
#inventoryScreen .ff-inv2-ob-cat-name {
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#inventoryScreen .ff-inv2-ob-cat-count {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: #7c3aed;
  background: #ede9fe;
  border-radius: 999px;
  padding: 2px 8px;
  min-width: 28px;
  text-align: center;
}
#inventoryScreen .ff-inv2-ob-subs {
  margin: 0;
  padding: 4px 12px 8px 36px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid #e9d5ff;
  background: #ffffff;
}
#inventoryScreen .ff-inv2-ob-sub-label {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  color: #475569;
  cursor: pointer;
}
#inventoryScreen .ff-inv2-ob-tree-empty {
  font-size: 12px;
  color: #94a3b8;
}
#inventoryScreen .ff-inv2-table {
  width: max-content;
  min-width: 100%;
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
  background: #fff;
  --inv-sticky-hash-left: 28px;
  --inv-sticky-code-left: 80px;
  --inv-sticky-name-left: 204px;
  --inv-header-row1-height: 40px;
}
#inventoryScreen .ff-inv2-table thead tr:nth-child(1) th.ff-inv2-th-dnd {
  position: sticky;
  left: 0;
  top: 0;
  z-index: 30;
  width: 28px;
  min-width: 28px;
  max-width: 28px;
  padding: 0 !important;
  background: #fff;
  box-shadow: 2px 0 0 0 #e2e8f0;
}
#inventoryScreen .ff-inv2-table thead tr:nth-child(1) th.ff-inv2-th-num {
  position: sticky;
  left: var(--inv-sticky-hash-left);
  top: 0;
  z-index: 30;
  background: #fff;
  box-shadow: 2px 0 0 0 #e2e8f0;
}
#inventoryScreen .ff-inv2-table thead tr:nth-child(1) th.ff-inv2-th-code {
  position: sticky;
  left: var(--inv-sticky-code-left);
  top: 0;
  z-index: 30;
  background: #fff;
  box-shadow: 2px 0 0 0 #e2e8f0;
}
#inventoryScreen .ff-inv2-table thead tr:nth-child(1) th.ff-inv2-th-name {
  position: sticky;
  left: var(--inv-sticky-name-left);
  top: 0;
  z-index: 30;
  background: #fff;
  box-shadow: 2px 0 0 0 #e2e8f0;
}
#inventoryScreen .ff-inv2-td-dnd {
  position: sticky;
  left: 0;
  z-index: 4;
  width: 28px;
  min-width: 28px;
  max-width: 28px;
  padding: 2px 0 !important;
  vertical-align: middle !important;
  text-align: center !important;
  background: #fff;
  box-shadow: 2px 0 0 0 #e2e8f0;
}
#inventoryScreen .ff-inv2-row-dnd-handle {
  display: block;
  width: 22px;
  height: 26px;
  margin: 0 auto;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: grab;
  color: #cbd5e1;
  opacity: 0.85;
  transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
}
#inventoryScreen .ff-inv2-row-dnd-handle::before {
  content: "";
  display: block;
  width: 6px;
  height: 12px;
  margin: 6px auto 0;
  background: linear-gradient(currentColor, currentColor) 0 0/2px 100% no-repeat,
    linear-gradient(currentColor, currentColor) 4px 0/2px 100% no-repeat;
  opacity: 0.9;
}
#inventoryScreen .ff-inv2-row-dnd-handle:hover {
  color: #94a3b8;
  background: rgba(148, 163, 184, 0.1);
}
#inventoryScreen .ff-inv2-row-dnd-handle:active {
  cursor: grabbing;
}
#inventoryScreen .ff-inv2-data-row.ff-inv2-row-dnd-dragging {
  opacity: 0.55;
}
#inventoryScreen .ff-inv2-data-row.ff-inv2-row-dnd-over {
  outline: 1px solid rgba(124, 58, 237, 0.35);
  outline-offset: -1px;
  background: rgba(245, 243, 255, 0.65);
}
#inventoryScreen .ff-inv2-td-no {
  position: sticky;
  left: var(--inv-sticky-hash-left);
  z-index: 3;
  background: #fff;
  box-shadow: 2px 0 0 0 #e2e8f0;
}
#inventoryScreen .ff-inv2-td-code {
  position: sticky;
  left: var(--inv-sticky-code-left);
  z-index: 3;
  background: #fff;
  box-shadow: 2px 0 0 0 #e2e8f0;
}
#inventoryScreen .ff-inv2-td-name {
  position: sticky;
  left: var(--inv-sticky-name-left);
  z-index: 3;
  background: #fff;
  box-shadow: 2px 0 0 0 #e2e8f0;
}
#inventoryScreen .ff-inv2-table .col-resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 6;
  touch-action: none;
}
#inventoryScreen .ff-inv2-th-num,
#inventoryScreen .ff-inv2-td-num {
  width: auto;
  min-width: 0;
  max-width: none;
  padding-left: 4px !important;
  padding-right: 4px !important;
  text-align: center !important;
  vertical-align: middle !important;
}
#inventoryScreen .ff-inv2-td-no-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 0;
  width: 100%;
  min-height: 28px;
}
#inventoryScreen .ff-inv2-td-no .ff-inv2-cell-view,
#inventoryScreen .ff-inv2-td-no .ff-inv2-cell-input--editing {
  text-align: center;
}
#inventoryScreen .ff-inv2-td-no .ff-inv2-cell-view.ff-inv2-no-input {
  flex: 1 1 auto;
  min-width: 2rem;
  min-height: 24px;
  display: block;
  box-sizing: border-box;
  padding: 4px 2px;
  border-radius: 4px;
  cursor: pointer;
  line-height: 1.3;
}
#inventoryScreen .ff-inv2-td-no .ff-inv2-cell-view.ff-inv2-no-input:hover,
#inventoryScreen .ff-inv2-td-no .ff-inv2-cell-view.ff-inv2-no-input:focus-visible {
  background: rgba(124, 58, 237, 0.06);
  outline: none;
}
#inventoryScreen .ff-inv2-td-no .ff-inv2-cell-view.ff-inv2-no-input,
#inventoryScreen .ff-inv2-td-no .ff-inv2-cell-input--editing.ff-inv2-no-input {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
#inventoryScreen .ff-inv2-td-no .ff-inv2-cell-input--editing.ff-inv2-no-input {
  width: 100%;
  min-width: 2rem;
  box-sizing: border-box;
}
#inventoryScreen .ff-inv2-th-num {
  font-size: 10px;
  letter-spacing: 0.02em;
}
#inventoryScreen .ff-inv2-th-code,
#inventoryScreen .ff-inv2-td-code {
  width: auto;
  min-width: 0;
  max-width: none;
  padding-left: 4px !important;
  padding-right: 6px !important;
  vertical-align: middle !important;
}
#inventoryScreen .ff-inv2-th-name,
#inventoryScreen .ff-inv2-td-name {
  width: auto;
  min-width: 0;
  max-width: none;
  padding-left: 6px !important;
  padding-right: 8px !important;
  vertical-align: middle !important;
}
#inventoryScreen .ff-inv2-cell-view.ff-inv2-code-input,
#inventoryScreen .ff-inv2-cell-input--editing.ff-inv2-code-input {
  min-width: 3rem;
}
#inventoryScreen .ff-inv2-cell-view.ff-inv2-name-input,
#inventoryScreen .ff-inv2-cell-input--editing.ff-inv2-name-input {
  min-width: 0;
  width: 100%;
  max-width: 100%;
  display: block;
  font-size: 13px;
}
#inventoryScreen .ff-inv2-td-supplier {
  vertical-align: middle !important;
  padding-left: 6px !important;
  padding-right: 8px !important;
  position: relative;
  z-index: 0;
}
#inventoryScreen .ff-inv2-td-supplier .ff-inv2-cell-view,
#inventoryScreen .ff-inv2-td-supplier .ff-inv2-cell-input--editing {
  position: relative;
  z-index: 1;
}
#inventoryScreen .ff-inv2-td-url {
  vertical-align: middle !important;
  padding-left: 6px !important;
  padding-right: 8px !important;
}
#inventoryScreen .ff-inv2-url-cell {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
#inventoryScreen .ff-inv2-url-link {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #2563eb;
  text-decoration: none;
  font-size: 12px;
}
#inventoryScreen .ff-inv2-url-link:hover {
  text-decoration: underline;
}
#inventoryScreen .ff-inv2-url-empty {
  flex: 1;
  min-width: 0;
  color: #94a3b8;
  font-size: 12px;
}
#inventoryScreen .ff-inv2-url-edit {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.12s ease, color 0.12s ease;
}
#inventoryScreen .ff-inv2-td-url:hover .ff-inv2-url-edit,
#inventoryScreen .ff-inv2-url-edit:focus-visible {
  opacity: 1;
}
#inventoryScreen .ff-inv2-url-edit:hover {
  color: #64748b;
}
#inventoryScreen .ff-inv2-url-edit:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: 1px;
}
#inventoryScreen .ff-inv2-td-url .ff-inv2-cell-input--editing {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}
#inventoryScreen .ff-inv2-table thead tr:nth-child(1) th:nth-last-child(1),
#inventoryScreen .ff-inv2-table thead tr:nth-child(1) th:nth-last-child(2) {
  min-width: 5rem;
}
#inventoryScreen .ff-inv2-table tbody td:nth-last-child(2),
#inventoryScreen .ff-inv2-table tbody td:last-child {
  min-width: 4.5rem;
}
#inventoryScreen .ff-inv2-table thead th {
  position: sticky;
  background: #fff;
  color: #475569;
  font-weight: 600;
  text-align: left;
  padding: 8px 10px 8px 8px;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
  vertical-align: middle;
}
#inventoryScreen .ff-inv2-table thead th.ff-inv2-gh {
  background: linear-gradient(180deg, #faf5ff 0%, #f5f3ff 100%);
}
#inventoryScreen .ff-inv2-table thead tr:nth-child(1) th {
  top: 0;
  z-index: 20;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
#inventoryScreen .ff-inv2-table thead tr:nth-child(2) th {
  top: var(--inv-header-row1-height);
  z-index: 19;
  background: #fff;
}
#inventoryScreen .ff-inv2-gh {
  text-align: center !important;
  background: linear-gradient(180deg, #faf5ff 0%, #f5f3ff 100%);
  color: #6d28d9 !important;
  border-left: 1px solid #ede9fe;
  padding: 4px 6px !important;
  vertical-align: middle !important;
}
#inventoryScreen .ff-inv2-gh-inner {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  width: 100%;
}
#inventoryScreen .ff-inv2-gh-inner .ff-inv2-gh-input {
  flex: 1 1 auto;
  min-width: 0;
}
#inventoryScreen .ff-inv2-gh-remove {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin: 0;
  padding: 0;
  border: 1px solid transparent;
  background: rgba(255,255,255,0.65);
  color: #94a3b8;
  border-radius: 6px;
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
  line-height: 1;
}
#inventoryScreen .ff-inv2-gh-remove:hover {
  background: #fee2e2;
  border-color: #fecaca;
  color: #b91c1c;
}
#inventoryScreen .ff-inv2-gh-remove:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: 1px;
}
#inventoryScreen .ff-inv2-gh--confirming {
  white-space: normal !important;
}
#inventoryScreen .ff-inv2-gh-inner--confirm {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}
#inventoryScreen .ff-inv2-gh-confirm-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: stretch;
}
#inventoryScreen .ff-inv2-gh-warn {
  font-size: 10px;
  font-weight: 500;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 6px;
  padding: 6px 8px;
  line-height: 1.35;
  text-align: left;
}
#inventoryScreen .ff-inv2-gh-confirm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}
#inventoryScreen .ff-inv2-gh-btn {
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
}
#inventoryScreen .ff-inv2-gh-btn-cancel {
  background: #fff;
  border-color: #e2e8f0;
  color: #475569;
}
#inventoryScreen .ff-inv2-gh-btn-cancel:hover {
  background: #f8fafc;
}
#inventoryScreen .ff-inv2-gh-btn-danger {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}
#inventoryScreen .ff-inv2-gh-btn-danger:hover {
  background: #fee2e2;
}
#inventoryScreen .ff-inv2-gh-input {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  margin: 0;
  padding: 6px 8px;
  font: inherit;
  font-weight: 700;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  text-align: center;
  color: #5b21b6;
  background: rgba(255,255,255,0.5);
  border: 1px solid #e9d5ff;
  border-radius: 8px;
}
#inventoryScreen .ff-inv2-gh-input:focus {
  outline: none;
  border-color: #a78bfa;
  background: #fff;
}
#inventoryScreen .ff-inv2-subh {
  text-align: center !important;
  font-size: 10px !important;
  color: #64748b !important;
  background: #fafafa !important;
  font-weight: 600 !important;
}
#inventoryScreen .ff-inv2-table tbody td {
  padding: 8px 10px;
  border-bottom: 1px solid #eef2f7;
  border-right: 1px solid #f1f5f9;
  color: #334155;
  vertical-align: middle;
}
#inventoryScreen .ff-inv2-table tbody td:last-child {
  border-right: none;
}
#inventoryScreen .ff-inv2-table tbody tr:hover td {
  background: rgba(248, 250, 252, 0.85);
}
#inventoryScreen .ff-inv2-row-no-wrap {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
#inventoryScreen .ff-inv2-row-kebab {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #94a3b8;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease, color 0.12s ease, background 0.12s ease;
}
#inventoryScreen .ff-inv2-data-row:hover .ff-inv2-row-kebab,
#inventoryScreen .ff-inv2-row-kebab:focus-visible {
  opacity: 1;
  pointer-events: auto;
}
#inventoryScreen .ff-inv2-row-kebab:hover {
  color: #64748b;
  background: rgba(148, 163, 184, 0.15);
}
#inventoryScreen .ff-inv2-row-kebab:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: 1px;
}
#inventoryScreen .ff-inv2-row-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 48;
  background: transparent;
}
#inventoryScreen .ff-inv2-row-menu {
  position: fixed;
  z-index: 49;
  min-width: 168px;
  padding: 4px 0;
  margin: 0;
  list-style: none;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.06);
}
#inventoryScreen .ff-inv2-row-menu-item {
  display: block;
  width: 100%;
  margin: 0;
  padding: 8px 14px;
  border: none;
  background: transparent;
  text-align: left;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  color: #334155;
  cursor: pointer;
}
#inventoryScreen .ff-inv2-row-menu-item:hover {
  background: #f1f5f9;
}
#inventoryScreen .ff-inv2-row-menu-item--danger {
  color: #b91c1c;
}
#inventoryScreen .ff-inv2-row-menu-item--danger:hover {
  background: #fef2f2;
}
#inventoryScreen .ff-inv2-num { font-variant-numeric: tabular-nums; font-weight: 600; color: #0f172a; }
#inventoryScreen .ff-inv2-td-numcell {
  text-align: right;
  font-variant-numeric: tabular-nums;
  min-width: 4.75rem;
}
#inventoryScreen .ff-inv2-td-price {
  position: relative;
}
#inventoryScreen .ff-inv2-price-symbol {
  position: absolute;
  left: 6px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 11px;
  color: #94a3b8;
  pointer-events: none;
  font-weight: 600;
}
#inventoryScreen .ff-inv2-td-price .ff-inv2-cell-view,
#inventoryScreen .ff-inv2-td-price .ff-inv2-cell-input--editing {
  padding-left: 18px;
}
#inventoryScreen .ff-inv2-td-numcell .ff-inv2-cell-view,
#inventoryScreen .ff-inv2-td-numcell .ff-inv2-cell-input--editing {
  text-align: right;
}
#inventoryScreen .ff-inv2-td-text {
  min-width: 6rem;
}
#inventoryScreen .ff-inv2-cell-view {
  display: block;
  width: 100%;
  min-height: 1.35em;
  margin: 0;
  padding: 4px 2px;
  font: inherit;
  font-size: 12px;
  line-height: 1.4;
  color: #0f172a;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: default;
  box-sizing: border-box;
  transition: background 0.12s ease;
}
#inventoryScreen .ff-inv2-table tbody td:hover .ff-inv2-cell-view {
  background: rgba(124, 58, 237, 0.04);
}
#inventoryScreen .ff-inv2-cell-view:focus {
  outline: none;
}
#inventoryScreen .ff-inv2-cell-view:focus-visible {
  outline: 2px solid rgba(124, 58, 237, 0.35);
  outline-offset: 1px;
}
#inventoryScreen .ff-inv2-cell-input--editing {
  width: 100%;
  max-width: 100%;
  min-width: 3rem;
  box-sizing: border-box;
  margin: 0;
  padding: 5px 8px;
  font: inherit;
  font-size: 12px;
  color: #0f172a;
  background: #fff;
  border: 1px solid #c4b5fd;
  border-radius: 6px;
  box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.12);
}
#inventoryScreen .ff-inv2-cell-input--editing:focus {
  outline: none;
  border-color: #7c3aed;
  box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.18);
}
#inventoryScreen .ff-inv2-cell-input--editing.ff-inv2-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
#inventoryScreen .ff-inv2-order-cell {
  text-align: center;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: #64748b;
  background: transparent;
}
#inventoryScreen .ff-inv2-order-cell--positive {
  color: #5b21b6;
  font-weight: 700;
  background: rgba(124, 58, 237, 0.06);
}
#inventoryScreen .ff-inv2-order-cell--positive .ff-inv2-order-val {
  color: inherit;
}
#inventoryScreen .ff-inv2-order-cell--has-approved {
  color: #0369a1;
  background: rgba(14, 165, 233, 0.12);
  cursor: help;
  position: relative;
}
#inventoryScreen .ff-inv2-order-cell--has-approved .ff-inv2-order-val {
  color: inherit;
}
#inventoryScreen .ff-inv2-order-cell--has-approved::after {
  content: "";
  position: absolute;
  top: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #0ea5e9;
}
#inventoryScreen .ff-inv2-ord-breakdown-dl {
  margin: 0 0 12px;
  font-size: 13px;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 14px;
}
#inventoryScreen .ff-inv2-ord-breakdown-dl dt {
  color: #64748b;
  font-weight: 600;
}
#inventoryScreen .ff-inv2-ord-breakdown-dl dd {
  margin: 0;
  text-align: right;
  color: #0f172a;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
#inventoryScreen .ff-inv2-ord-breakdown-dl dd.ff-inv2-ord-breakdown-total {
  color: #5b21b6;
}
#inventoryScreen .ff-inv2-ord-breakdown-section {
  margin: 0 0 12px;
}
#inventoryScreen .ff-inv2-ord-breakdown-section-title {
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #64748b;
}
#inventoryScreen .ff-inv2-ord-breakdown-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  overflow: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}
#inventoryScreen .ff-inv2-ord-breakdown-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-ord-breakdown-entry:last-child {
  border-bottom: none;
}
#inventoryScreen .ff-inv2-ord-breakdown-entry-main {
  flex: 1;
  min-width: 0;
}
#inventoryScreen .ff-inv2-ord-breakdown-entry-qty {
  font-weight: 700;
  color: #0369a1;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
}
#inventoryScreen .ff-inv2-ord-breakdown-entry-meta {
  margin-top: 2px;
  font-size: 11px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-ord-breakdown-remove {
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #b91c1c;
  cursor: pointer;
  font-size: 14px;
  padding: 0;
}
#inventoryScreen .ff-inv2-ord-breakdown-remove:hover {
  background: #fef2f2;
  border-color: #fecaca;
}
#inventoryScreen .ff-inv2-ord-breakdown-empty {
  margin: 0;
  padding: 10px;
  background: #f8fafc;
  border-radius: 6px;
  font-size: 12px;
  color: #94a3b8;
  text-align: center;
}
#inventoryScreen .ff-inv2-mock-pill {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #7c3aed;
  background: #f3e8ff;
  padding: 3px 8px;
  border-radius: 999px;
  margin-left: 8px;
}
#inventoryScreen .ff-inv2-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483640;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 72px 24px 24px;
  background: rgba(15, 23, 42, 0.35);
  backdrop-filter: blur(2px);
}
#inventoryScreen .ff-inv2-modal-backdrop--nested {
  z-index: 2147483645;
  background: rgba(15, 23, 42, 0.45);
}
#inventoryScreen .ff-inv2-modal-card {
  width: 100%;
  max-width: 360px;
  padding: 20px 22px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #e2e8f0;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.12);
}
#inventoryScreen .ff-inv2-modal-card.ff-inv2-order-detail-card {
  padding: 16px 14px;
}
#inventoryScreen .ff-inv2-modal-title {
  margin: 0 0 8px 0;
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.35;
}
#inventoryScreen .ff-inv2-modal-hint {
  margin: 0 0 18px 0;
  font-size: 12px;
  color: #64748b;
  line-height: 1.45;
}
#inventoryScreen .ff-inv2-modal-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
#inventoryScreen .ff-inv2-modal-actions.ff-inv2-order-detail-footer {
  flex-wrap: nowrap;
  justify-content: flex-start;
  gap: 4px;
}
#inventoryScreen .ff-inv2-modal-field {
  display: block;
  margin: 0 0 16px;
}
#inventoryScreen .ff-inv2-modal-field-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  margin: 0 0 6px;
}
#inventoryScreen .ff-inv2-modal-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  font-size: 13px;
  color: #0f172a;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}
#inventoryScreen .ff-inv2-modal-input:focus {
  outline: 2px solid #c4b5fd;
  outline-offset: 1px;
  border-color: #a78bfa;
}
#inventoryScreen .ff-inv2-modal-btn {
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
}
#inventoryScreen .ff-inv2-modal-btn-cancel {
  background: #fff;
  border-color: #e2e8f0;
  color: #475569;
}
#inventoryScreen .ff-inv2-modal-btn-cancel:hover {
  background: #f8fafc;
}
#inventoryScreen .ff-inv2-modal-btn-danger {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}
#inventoryScreen .ff-inv2-modal-btn-danger:hover {
  background: #fee2e2;
}
#inventoryScreen .ff-inv2-modal-btn-primary {
  background: #7c3aed;
  border-color: #6d28d9;
  color: #fff;
}
#inventoryScreen .ff-inv2-modal-btn-primary:hover {
  background: #6d28d9;
}
#inventoryScreen .ff-inv2-modal-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  pointer-events: none;
}
#inventoryScreen .ff-inv2-aside-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
#inventoryScreen .ff-inv2-aside-add {
  flex-shrink: 0;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 700;
  color: #5b21b6;
  background: #faf5ff;
  border: 1px solid #e9d5ff;
  border-radius: 6px;
  cursor: pointer;
}
#inventoryScreen .ff-inv2-aside-add:hover {
  background: #f3e8ff;
  border-color: #ddd6fe;
}
#inventoryScreen .ff-inv2-cat-manage-backdrop {
  z-index: 450;
}
#inventoryScreen .ff-inv2-cat-manage-card {
  max-width: 440px;
  max-height: min(85vh, 640px);
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}
#inventoryScreen .ff-inv2-cat-manage-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 0;
}
#inventoryScreen .ff-inv2-cat-manage-head-main {
  flex: 1;
  min-width: 0;
}
#inventoryScreen .ff-inv2-cat-manage-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
}
#inventoryScreen .ff-inv2-cat-manage-h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-cat-manage-add-head {
  flex-shrink: 0;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: #7c3aed;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(124, 58, 237, 0.25);
}
#inventoryScreen .ff-inv2-cat-manage-add-head:hover {
  background: #6d28d9;
}
#inventoryScreen .ff-inv2-cat-manage-add-head:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: 2px;
}
#inventoryScreen .ff-inv2-cat-manage-close {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  margin: 0;
  padding: 0;
  border: none;
  background: #f1f5f9;
  color: #64748b;
  border-radius: 8px;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
#inventoryScreen .ff-inv2-cat-manage-close:hover {
  background: #e2e8f0;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-cat-manage-subtitle {
  margin: 6px 20px 12px;
  font-size: 11px;
  color: #94a3b8;
}
#inventoryScreen .ff-inv2-cat-manage-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 20px 12px;
  border-top: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-cat-manage-empty {
  margin: 12px 0;
  font-size: 13px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-cat-manage-block {
  margin-bottom: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-cat-manage-block:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}
#inventoryScreen .ff-inv2-cat-manage-cat-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 8px;
}
#inventoryScreen .ff-inv2-cat-manage-cat-drag {
  flex: 1;
  min-width: 0;
  cursor: grab;
  border-radius: 8px;
  padding: 4px 6px;
  margin: -4px -6px;
  transition: background 0.12s ease, box-shadow 0.12s ease;
}
#inventoryScreen .ff-inv2-cat-manage-cat-drag:hover {
  background: rgba(124, 58, 237, 0.06);
  box-shadow: inset 0 0 0 1px rgba(124, 58, 237, 0.12);
}
#inventoryScreen .ff-inv2-cat-manage-cat-drag:active {
  cursor: grabbing;
}
#inventoryScreen .ff-inv2-cat-manage-block.ff-inv2-cat-dnd-dragging,
#inventoryScreen .ff-inv2-cat-manage-sub.ff-inv2-cat-dnd-dragging {
  opacity: 0.55;
}
#inventoryScreen .ff-inv2-cat-manage-block.ff-inv2-cat-dnd-over {
  outline: 1px solid rgba(124, 58, 237, 0.35);
  outline-offset: 1px;
  border-radius: 10px;
  background: rgba(245, 243, 255, 0.65);
}
#inventoryScreen .ff-inv2-cat-manage-block.ff-inv2-cat-dnd-over-block {
  outline: 1px solid rgba(124, 58, 237, 0.28);
  outline-offset: 2px;
  border-radius: 10px;
  background: rgba(245, 243, 255, 0.45);
  box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.2);
}
#inventoryScreen .ff-inv2-cat-manage-sub.ff-inv2-cat-dnd-over {
  outline: 1px solid rgba(124, 58, 237, 0.4);
  outline-offset: 1px;
  border-radius: 8px;
  background: rgba(245, 243, 255, 0.75);
}
#inventoryScreen .ff-inv2-cat-manage-sub {
  margin: 0;
  border-radius: 8px;
  transition: background 0.12s ease, box-shadow 0.12s ease;
}
#inventoryScreen .ff-inv2-cat-manage-sub:not(.ff-inv2-cat-dnd-dragging):hover {
  background: rgba(124, 58, 237, 0.04);
  box-shadow: inset 0 0 0 1px rgba(124, 58, 237, 0.1);
  cursor: grab;
}
#inventoryScreen .ff-inv2-cat-manage-sub:not(.ff-inv2-cat-dnd-dragging):active {
  cursor: grabbing;
}
#inventoryScreen .ff-inv2-cat-manage-sub .ff-inv2-cat-manage-sub-row {
  flex: 1;
  min-width: 0;
}
#inventoryScreen .ff-inv2-cat-manage-cat-name {
  flex: 1;
  min-width: 0;
}
#inventoryScreen .ff-inv2-cat-manage-cat-text {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}
#inventoryScreen .ff-inv2-cat-manage-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
  align-items: center;
  justify-content: flex-end;
}
#inventoryScreen .ff-inv2-cat-manage-mini {
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #475569;
}
#inventoryScreen .ff-inv2-cat-manage-mini:hover {
  background: #f8fafc;
}
#inventoryScreen .ff-inv2-cat-manage-mini-danger {
  border-color: #fecaca;
  color: #b91c1c;
  background: #fff;
}
#inventoryScreen .ff-inv2-cat-manage-mini-danger:hover {
  background: #fef2f2;
}
#inventoryScreen .ff-inv2-cat-manage-input {
  width: 100%;
  max-width: 220px;
  box-sizing: border-box;
  padding: 6px 10px;
  font-size: 13px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}
#inventoryScreen .ff-inv2-cat-manage-input:focus {
  outline: none;
  border-color: #a78bfa;
  box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.12);
}
#inventoryScreen .ff-inv2-cat-manage-subs {
  margin-top: 10px;
  padding-left: 10px;
  border-left: 2px solid #ede9fe;
  display: flex;
  flex-direction: column;
  gap: 0;
}
#inventoryScreen .ff-inv2-cat-manage-sub + .ff-inv2-cat-manage-inline {
  margin-top: 6px;
}
#inventoryScreen .ff-inv2-cat-manage-sub + .ff-inv2-cat-manage-sub {
  margin-top: 0;
}
#inventoryScreen .ff-inv2-cat-manage-sub-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  margin: 0;
  padding: 1px 4px 1px 8px;
  min-height: unset;
  box-sizing: border-box;
  border-radius: 6px;
  transition: background 0.14s ease;
}
#inventoryScreen .ff-inv2-cat-manage-sub-row:hover {
  background: rgba(124, 58, 237, 0.07);
}
#inventoryScreen .ff-inv2-cat-manage-sub-name {
  font-size: 13px;
  color: #475569;
}
#inventoryScreen .ff-inv2-cat-manage-sub-name span {
  line-height: 1.1;
}
#inventoryScreen .ff-inv2-cat-manage-sub .ff-inv2-cat-manage-actions {
  gap: 2px 4px;
}
#inventoryScreen .ff-inv2-cat-manage-sub-row:hover .ff-inv2-cat-menu-trigger--sub {
  color: #5b21b6;
}
#inventoryScreen .ff-inv2-cat-menu-trigger--sub[aria-expanded="true"] {
  color: #5b21b6;
}
#inventoryScreen .ff-inv2-cat-manage-confirm {
  margin-top: 8px;
  padding: 8px 10px;
  font-size: 11px;
  color: #92400e;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
#inventoryScreen .ff-inv2-cat-manage-inline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
#inventoryScreen .ff-inv2-cat-manage-footer {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  padding: 12px 20px 18px;
  border-top: 1px solid #f1f5f9;
  background: #fafafa;
}
#inventoryScreen .ff-inv2-cat-manage-inline-newcat {
  margin-top: 0;
}
#inventoryScreen .ff-inv2-cat-manage-save {
  width: 100%;
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: #7c3aed;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(124, 58, 237, 0.2);
}
#inventoryScreen .ff-inv2-cat-manage-save:hover {
  background: #6d28d9;
}
#inventoryScreen .ff-inv2-cat-manage-save:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: 2px;
}
#inventoryScreen #ff-inv2-cat-delete-backdrop {
  z-index: 460;
}
#inventoryScreen .ff-inv2-cat-delete-modal-card {
  max-width: 400px;
}
#inventoryScreen .ff-inv2-cat-delete-extra {
  margin-top: 0;
}
#inventoryScreen .ff-inv2-cat-menu-wrap {
  position: relative;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-cat-menu-trigger {
  padding: 0;
  margin: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #94a3b8;
  font-size: 16px;
  line-height: 1;
  letter-spacing: 0.08em;
  cursor: pointer;
}
#inventoryScreen button.ff-inv2-cat-menu-trigger {
  width: 28px;
  height: 28px;
}
#inventoryScreen .ff-inv2-cat-menu-trigger--sub {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  min-width: 1.25em;
  padding: 2px 4px;
  border-radius: 4px;
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0.1em;
  color: #94a3b8;
  background: transparent;
  box-shadow: none;
  outline: none;
  transition: color 0.12s ease;
}
#inventoryScreen .ff-inv2-cat-menu-trigger--sub:focus {
  outline: none;
}
#inventoryScreen .ff-inv2-cat-menu-trigger--sub:focus-visible {
  outline: 2px solid rgba(124, 58, 237, 0.45);
  outline-offset: 1px;
}
#inventoryScreen .ff-inv2-cat-menu-trigger:hover:not(.ff-inv2-cat-menu-trigger--sub) {
  color: #64748b;
  background: transparent;
}
#inventoryScreen .ff-inv2-cat-menu-dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  min-width: 148px;
  padding: 4px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.12);
  z-index: 20;
}
#inventoryScreen .ff-inv2-cat-menu-item {
  display: block;
  width: 100%;
  padding: 8px 12px;
  margin: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  color: #334155;
  cursor: pointer;
}
#inventoryScreen .ff-inv2-cat-menu-item:hover {
  background: #f1f5f9;
}
#inventoryScreen .ff-inv2-cat-menu-item-danger {
  color: #b91c1c;
}
#inventoryScreen .ff-inv2-cat-menu-item-danger:hover {
  background: #fef2f2;
}
#ff-inv-undo-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 999999;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px 12px 20px;
  border-radius: 10px;
  background: #111827;
  color: #f8fafc;
  font-size: 14px;
  font-weight: 600;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.35);
  max-width: min(420px, 92vw);
  line-height: 1.35;
  pointer-events: auto;
}
#ff-inv-undo-toast .ff-inv-undo-toast-msg {
  flex: 1;
  min-width: 0;
}
#ff-inv-undo-toast .ff-inv-undo-toast-btn {
  flex-shrink: 0;
  margin: 0;
  padding: 6px 14px;
  border: none;
  border-radius: 8px;
  background: #e2e8f0;
  color: #0f172a;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
#ff-inv-undo-toast .ff-inv-undo-toast-btn:hover {
  background: #fff;
}
#ff-inv-undo-toast .ff-inv-undo-toast-btn:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: 2px;
}

/* Mobile: fixed 280px aside leaves almost no room for the grid — stack categories on top */
@media (max-width: 767.98px) {
  #inventoryScreen .ff-inv2-mobile-cat-strip {
    display: none;
  }
  #inventoryScreen .ff-inv2-layout--mobile-cats-collapsed {
    grid-template-rows: auto minmax(0, 1fr) !important;
  }
  #inventoryScreen .ff-inv2-layout--mobile-cats-collapsed .ff-inv2-mobile-cat-strip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    margin: 0;
    border: none;
    border-bottom: 1px solid #e2e8f0;
    background: #fff;
    font-size: 13px;
    font-weight: 600;
    color: #1e293b;
    cursor: pointer;
    flex-shrink: 0;
    text-align: left;
    font-family: inherit;
  }
  #inventoryScreen .ff-inv2-layout--mobile-cats-collapsed .ff-inv2-mobile-cat-strip:focus-visible {
    outline: 2px solid #a78bfa;
    outline-offset: -2px;
  }
  #inventoryScreen .ff-inv2-layout--mobile-cats-collapsed .ff-inv2-aside-panel {
    display: none !important;
  }
  #inventoryScreen .ff-inv2-mobile-cat-strip-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  #inventoryScreen .ff-inv2-mobile-cat-strip-chev {
    flex-shrink: 0;
    color: #7c3aed;
    font-size: 12px;
  }
  #inventoryScreen .ff-inv2-mobile-aside-collapse {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    margin: 0 4px 0 0;
    border: 1px solid #e9d5ff;
    border-radius: 8px;
    background: #faf5ff;
    color: #5b21b6;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    flex-shrink: 0;
    font-family: inherit;
  }
  #inventoryScreen .ff-inv2-mobile-aside-collapse:focus-visible {
    outline: 2px solid #a78bfa;
    outline-offset: 2px;
  }

  /* Grid: categories = capped height row; main = all remaining space ( big table scroll area ) */
  #inventoryScreen .ff-inv2-layout {
    display: grid;
    grid-template-columns: 1fr;
    grid-template-rows: minmax(100px, min(30vh, 260px)) minmax(0, 1fr);
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  #inventoryScreen .ff-inv2-aside {
    grid-row: 1;
    width: 100%;
    min-width: 0;
    max-width: none;
    min-height: 0;
    height: 100%;
    max-height: none;
    border-right: none;
    border-bottom: 1px solid #e2e8f0;
    box-shadow: 0 2px 10px rgba(15, 23, 42, 0.06);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  #inventoryScreen .ff-inv2-main {
    grid-row: 2;
    min-height: 0;
    min-width: 0;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding: 10px 10px 12px;
  }
  #inventoryScreen .ff-inv2-aside-head {
    padding: 12px 12px 10px;
    flex-shrink: 0;
  }
  #inventoryScreen .ff-inv2-aside-head-row {
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 8px;
  }
  #inventoryScreen .ff-inv2-aside-head-row > .ff-inv2-aside-head-left {
    flex: 1 1 100%;
    margin-bottom: 2px;
  }
  #inventoryScreen .ff-inv2-aside-head-row > .ff-inv2-aside-head-actions {
    margin-left: auto;
    display: inline-flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: flex-end;
  }
  #inventoryScreen .ff-inv2-aside-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 6px 10px 10px;
  }
  #inventoryScreen .ff-inv2-aside-panel {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  #inventoryScreen .ff-inv2-main-head {
    margin-bottom: 4px;
    flex-shrink: 0;
  }
  #inventoryScreen .ff-inv2-main-tabs {
    gap: 6px;
    margin-bottom: 6px;
    flex-shrink: 0;
  }
  #inventoryScreen .ff-inv2-main-tab {
    padding: 6px 10px;
    font-size: 12px;
  }
  #inventoryScreen .ff-inv2-main-tab-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }
  /* Create Order (mobile): inventory sidebar + crumb hidden; single scroll through picker + order list */
  #inventoryScreen .ff-inv2-layout--mobile-create-order {
    grid-template-rows: minmax(0, 1fr);
  }
  #inventoryScreen .ff-inv2-layout--mobile-create-order .ff-inv2-aside {
    display: none !important;
  }
  #inventoryScreen .ff-inv2-layout--mobile-create-order .ff-inv2-main {
    grid-row: 1;
  }
  #inventoryScreen .ff-inv2-layout--mobile-create-order .ff-inv2-main-head {
    display: none !important;
  }
  #inventoryScreen .ff-inv2-layout--mobile-create-order .ff-inv2-main-tab-body--order {
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    flex: 1 1 auto;
    min-height: 0;
  }
  #inventoryScreen .ff-inv2-layout--mobile-create-order .ff-inv2-order-builder-wrap {
    flex: 0 0 auto;
    min-height: 0;
    max-height: none;
    overflow: visible;
  }
  #inventoryScreen .ff-inv2-layout--mobile-create-order .ff-inv2-order-builder-wrap .ff-inv2-order-list-card {
    flex: 0 0 auto !important;
    min-height: 0 !important;
    max-height: none !important;
    overflow: visible !important;
  }
  #inventoryScreen .ff-inv2-layout--mobile-create-order .ff-inv2-order-list-scroll {
    flex: 0 0 auto !important;
    min-height: auto !important;
    max-height: none !important;
    overflow-x: auto !important;
    overflow-y: visible !important;
    -webkit-overflow-scrolling: touch !important;
    width: 100% !important;
    max-width: 100% !important;
  }
  #inventoryScreen .ff-inv2-order-detail-list-scroll {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  #inventoryScreen .ff-inv2-order-detail-items--checklist {
    min-width: 0;
    width: 100%;
  }
  #inventoryScreen #ff-inv-order-detail-backdrop .ff-inv2-order-detail-list-scroll {
    overflow-x: hidden;
    flex: 1 1 auto;
    min-height: 0;
    max-height: none;
  }
  #inventoryScreen .ff-inv2-layout--mobile-create-order .ff-inv2-ob-custom {
    max-height: none !important;
    overflow: visible !important;
  }
  #inventoryScreen .ff-inv2-layout--no-category-aside {
    grid-template-rows: minmax(0, 1fr);
  }
  #inventoryScreen .ff-inv2-layout--no-category-aside .ff-inv2-main {
    grid-row: 1;
  }
  /* Inventory → Insights (mobile only): hide category column + crumb, compact header, subtabs scroll, clear bottom nav */
  #inventoryScreen .ff-inv2-layout:has(.ff-inv2-main-tab-body--insights) {
    grid-template-rows: minmax(0, 1fr);
  }
  #inventoryScreen .ff-inv2-layout:has(.ff-inv2-main-tab-body--insights) .ff-inv2-aside {
    display: none !important;
  }
  #inventoryScreen .ff-inv2-layout:has(.ff-inv2-main-tab-body--insights) .ff-inv2-main {
    grid-row: 1;
    min-height: 0;
  }
  #inventoryScreen .ff-inv2-layout:has(.ff-inv2-main-tab-body--insights) .ff-inv2-main-head {
    display: none !important;
  }
  /* Inventory → Orders (mobile): hide redundant top "Orders" line — main tab already indicates Orders */
  #inventoryScreen .ff-inv2-layout:has(.ff-inv2-main-tab-body--orders) .ff-inv2-main-head {
    display: none !important;
  }
  #inventoryScreen .ff-inv2-main-tab-body--insights {
    padding: 8px 10px calc(72px + env(safe-area-inset-bottom, 0px));
    gap: 8px;
    overflow-x: hidden;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    min-height: 0;
    flex: 1 1 0%;
    max-height: 100%;
    overscroll-behavior-y: contain;
  }
  #inventoryScreen .ff-inv2-main-tab-body--insights .ff-inv2-insights-wrap {
    gap: 8px;
    min-width: 0;
  }
  #inventoryScreen .ff-inv2-main-tab-body--insights .ff-inv2-insights-wrap > .ff-inv2-insights-head {
    padding: 8px 10px;
    gap: 4px;
  }
  #inventoryScreen .ff-inv2-main-tab-body--insights .ff-inv2-insights-head {
    gap: 4px;
  }
  #inventoryScreen .ff-inv2-main-tab-body--insights .ff-inv2-insights-head-row {
    flex-wrap: nowrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }
  #inventoryScreen .ff-inv2-main-tab-body--insights .ff-inv2-insights-title {
    font-size: 14px;
    line-height: 1.25;
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  #inventoryScreen .ff-inv2-main-tab-body--insights .ff-inv2-insights-range-label {
    flex: 0 0 auto;
    gap: 4px;
    font-size: 11px;
  }
  #inventoryScreen .ff-inv2-main-tab-body--insights .ff-inv2-insights-range-select {
    padding: 4px 22px 4px 8px;
    font-size: 12px;
    max-width: min(150px, 46vw);
  }
  #inventoryScreen .ff-inv2-main-tab-body--insights .ff-inv2-insights-custom {
    gap: 8px;
  }
  #inventoryScreen .ff-inv2-main-tab-body--insights .ff-inv2-insights-subtabs {
    margin: 0 0 4px;
    padding: 0 0 2px;
    gap: 0;
    min-width: 0;
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    overscroll-behavior-x: contain;
    touch-action: pan-x;
  }
  #inventoryScreen .ff-inv2-main-tab-body--insights .ff-inv2-insights-subtab {
    flex: 0 0 auto;
    padding: 8px 10px;
    font-size: 12px;
  }
  #inventoryScreen #ff-inv-order-detail-backdrop.ff-inv2-modal-backdrop {
    align-items: stretch;
    justify-content: stretch;
    padding: 0;
    padding-top: max(10px, env(safe-area-inset-top, 0px));
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  #inventoryScreen #ff-inv-order-detail-backdrop .ff-inv2-order-detail-card {
    max-width: none;
    width: 100%;
    max-height: none;
    height: 100%;
    min-height: 0;
    border-radius: 0;
    border: none;
    box-shadow: none;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  #inventoryScreen #ff-inv-order-detail-backdrop .ff-inv2-order-detail-hero {
    flex-shrink: 0;
  }
  #inventoryScreen #ff-inv-order-detail-backdrop .ff-inv2-order-detail-extras {
    flex-shrink: 0;
  }
  #inventoryScreen #ff-inv-order-detail-backdrop .ff-inv2-order-detail-main {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    margin-bottom: 0;
  }
  /* Order detail: slightly larger export ▾ next to All/Open/Done — easier tap, chips unchanged */
  #inventoryScreen #ff-inv-order-detail-backdrop .ff-inv2-order-detail-line-filter .ff-inv2-od-export-menu summary.ff-inv2-od-export-menu-trigger {
    font-size: 16px;
    padding: 4px 6px;
    min-width: 30px;
    min-height: 30px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  /* Clear fixed bottom nav (~70px + bar padding); #inventoryScreen stacks below .toolbar-nav-main (z-index 100350). */
  #inventoryScreen #ff-inv-order-detail-backdrop .ff-inv2-order-detail-footer {
    padding: 8px 6px calc(78px + env(safe-area-inset-bottom, 0px));
    background: linear-gradient(180deg, rgba(255, 255, 255, 0) 0%, #fff 10px);
    position: relative;
    z-index: 2;
  }
  #inventoryScreen #ff-inv-order-detail-backdrop .ff-inv2-order-detail-footer .ff-inv2-modal-btn {
    padding: 6px 3px;
    font-size: 10px;
    line-height: 1.15;
  }
  /* Receipt Information (nested modal): clear fixed bottom nav — #inventoryScreen below tab bar */
  #inventoryScreen #ff-inv-receipt-info-backdrop.ff-inv2-modal-backdrop {
    padding-bottom: calc(78px + env(safe-area-inset-bottom, 0px));
  }
  #inventoryScreen #ff-inv-receipt-info-backdrop .ff-inv2-receipt-info-card {
    max-height: calc(100vh - 140px - env(safe-area-inset-bottom, 0px));
    max-height: calc(100dvh - 140px - env(safe-area-inset-bottom, 0px));
  }
  #inventoryScreen #ff-inv-receipt-info-backdrop .ff-inv2-receipt-info-footer {
    padding-bottom: 12px;
  }
  #inventoryScreen .ff-inv2-toolbar {
    flex-wrap: nowrap;
    align-items: center;
    gap: 4px;
    padding: 8px 8px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  #inventoryScreen .ff-inv2-toolbar::-webkit-scrollbar {
    height: 0;
  }
  #inventoryScreen .ff-inv2-toolbar .ff-inv2-btn {
    flex: 0 0 auto;
    white-space: nowrap;
    padding: 7px 8px;
    font-size: 11px;
  }
  #inventoryScreen .ff-inv2-toolbar .ff-inv2-btn--toolbar-shared {
    flex: 1 1 0;
    min-width: 0;
    font-size: 10px;
    padding: 7px 6px;
    max-width: 42%;
  }
  #inventoryScreen .ff-inv2-toolbar .ff-inv2-btn--toolbar-cols {
    flex: 0 0 auto;
    font-weight: 600;
    color: #5b21b6;
    background: #f5f3ff;
    border: 1px solid #ddd6fe;
  }
  #inventoryScreen .ff-inv2-btn--toolbar-cols:focus:not(:focus-visible) {
    outline: none;
  }
  #inventoryScreen .ff-inv2-table-card {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  }
  #inventoryScreen .ff-inv2-table-scroll {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    background: #fff;
    overflow-x: auto;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
    scrollbar-width: thin;
  }
  /* At least full card width; wider when many columns (horizontal scroll). */
  #inventoryScreen .ff-inv2-table {
    width: 100% !important;
    min-width: max-content !important;
  }
  #inventoryScreen .ff-inv2-table .col-resize-handle {
    width: 14px;
    right: -3px;
  }
  #inventoryScreen .ff-inv2-td-numcell {
    min-width: 0 !important;
    padding-left: 4px !important;
    padding-right: 4px !important;
  }
  #inventoryScreen .ff-inv2-order-cell {
    min-width: 0 !important;
    padding-left: 4px !important;
    padding-right: 4px !important;
  }
  #inventoryScreen .ff-inv2-table thead .ff-inv2-subh {
    padding-left: 3px !important;
    padding-right: 3px !important;
  }
  #inventoryScreen .ff-inv2-crumb {
    font-size: 13px;
    line-height: 1.35;
  }

  /*
   * Optional columns: use visibility:collapse — not display:none — so column indices stay aligned
   * with <colgroup> (display:none breaks table-layout:fixed and made one numeric col steal width).
   */
  #inventoryScreen.ff-inv-mobile-hide-dnd .ff-inv2-th-dnd,
  #inventoryScreen.ff-inv-mobile-hide-dnd .ff-inv2-td-dnd {
    visibility: collapse !important;
    width: 0 !important;
    min-width: 0 !important;
    padding: 0 !important;
    border: none !important;
  }
  #inventoryScreen.ff-inv-mobile-hide-num .ff-inv2-th-num,
  #inventoryScreen.ff-inv-mobile-hide-num .ff-inv2-td-no {
    visibility: collapse !important;
    width: 0 !important;
    min-width: 0 !important;
    padding: 0 !important;
    border: none !important;
  }
  #inventoryScreen.ff-inv-mobile-hide-code .ff-inv2-th-code,
  #inventoryScreen.ff-inv-mobile-hide-code .ff-inv2-td-code {
    visibility: collapse !important;
    width: 0 !important;
    min-width: 0 !important;
    padding: 0 !important;
    border: none !important;
  }
  #inventoryScreen.ff-inv-mobile-hide-supplier .ff-inv2-th-supplier,
  #inventoryScreen.ff-inv-mobile-hide-supplier .ff-inv2-td-supplier {
    visibility: collapse !important;
    width: 0 !important;
    min-width: 0 !important;
    padding: 0 !important;
    border: none !important;
  }
  #inventoryScreen.ff-inv-mobile-hide-url .ff-inv2-th-url,
  #inventoryScreen.ff-inv-mobile-hide-url .ff-inv2-td-url {
    visibility: collapse !important;
    width: 0 !important;
    min-width: 0 !important;
    padding: 0 !important;
    border: none !important;
  }
  #inventoryScreen.ff-inv-mobile-name-expanded .ff-inv2-td-name .ff-inv2-cell-view,
  #inventoryScreen.ff-inv-mobile-name-expanded .ff-inv2-td-name .ff-inv2-cell-input--editing {
    white-space: normal !important;
    overflow: visible !important;
    text-overflow: unset !important;
    word-break: break-word;
  }
  #inventoryScreen .ff-inv2-draft-new-btn {
    font-size: 10px;
    padding: 5px 8px;
    white-space: normal;
    text-align: center;
    max-width: 9rem;
    line-height: 1.15;
  }
  #inventoryScreen .ff-inv2-order-list-head {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
  #inventoryScreen .ff-inv2-order-list-head-actions {
    width: 100%;
    justify-content: flex-end;
    flex-wrap: nowrap;
    gap: 8px;
  }
  #inventoryScreen .ff-inv2-order-list-head-actions .ff-inv2-btn {
    flex: 0 0 auto;
    white-space: nowrap;
  }
  #inventoryScreen .ff-inv2-ob-add-item-btn {
    padding: 8px 12px;
    font-size: 12px;
  }
  /* Create Order: same checkbox tree as desktop — give it a bit more vertical room on phones */
  #inventoryScreen .ff-inv2-ob-custom {
    max-height: min(42vh, 300px);
  }
}
`;
