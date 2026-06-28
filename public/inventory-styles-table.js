// inventory-styles-table.js
// Part of inventory-styles.js, split 4 ways by theme (cascade-preserving,
// contiguous slice — byte-identical to the original). Table grid / group headers / cells / breakdown / shared modals / cat-menu / mobile media-queries.
// Concatenated in order by inventory-styles.js barrel.

export const INVENTORY_STYLES_TABLE = `#inventoryScreen .ff-inv2-table {
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
