// inventory-styles-shell.js
// Part of inventory-styles.js, split 4 ways by theme (cascade-preserving,
// contiguous slice — byte-identical to the original). Shell / layout / categories-manage / main tabs / orders search / order-detail core.
// Concatenated in order by inventory-styles.js barrel.

export const INVENTORY_STYLES_SHELL = `
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
`;
