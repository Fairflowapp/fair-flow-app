// inventory-styles-insights.js
// Part of inventory-styles.js, split 4 ways by theme (cascade-preserving,
// contiguous slice — byte-identical to the original). Insights / order-builder category tree.
// Concatenated in order by inventory-styles.js barrel.

export const INVENTORY_STYLES_INSIGHTS = `#inventoryScreen .ff-inv2-insights-wrap {
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
`;
