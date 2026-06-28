// inventory-styles-orders.js
// Part of inventory-styles.js, split 4 ways by theme (cascade-preserving,
// contiguous slice — byte-identical to the original). Order-detail tools/filters / receive+receipt modals / order list / drafts / order builder.
// Concatenated in order by inventory-styles.js barrel.

export const INVENTORY_STYLES_ORDERS = `#inventoryScreen .ff-inv2-od-tools-row {
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
`;
