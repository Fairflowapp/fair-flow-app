/**
 * Tickets Analytics — styles.
 *
 * Extracted verbatim from tickets-analytics.js (the inline injectStyles CSS).
 * The screen id and style-tag id are passed in by the orchestrator so there is
 * a single source of truth. No CSS changed in the split.
 */

export function injectStyles(screenId, styleId) {
  if (document.getElementById(styleId)) return;
  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
    #${screenId} {
      display: none;
      position: fixed;
      top: var(--header-h, 60px);
      left: 0; right: 0; bottom: 0;
      background: #f5f6fa;
      z-index: 9850;
      flex-direction: column;
      overflow: auto;
      pointer-events: auto;
    }
    #${screenId} .ta-wrap {
      max-width: 1280px;
      margin: 0 auto;
      padding: 6px 28px 48px;
      width: 100%;
    }
    #${screenId} .ta-back {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: none;
      border: 0;
      color: #6b7280;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      padding: 4px 0;
      margin: 0 12px 6px 0;
    }
    #${screenId} .ta-back:hover { color: #9d68b9; }
    #${screenId} .ta-h1 {
      display: inline-block;
      vertical-align: middle;
      margin: 0 8px 6px 0;
      font-size: 16px;
      font-weight: 800;
      color: #111827;
      letter-spacing: -0.01em;
    }
    #${screenId} .ta-sub {
      display: none;
    }
    #${screenId} .ta-location {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      vertical-align: middle;
      margin: 0 0 6px 0;
      padding: 5px 8px;
      border-radius: 999px;
      background: #fff;
      border: 1px solid #e5e7eb;
      color: #6b7280;
      font-size: 10px;
      font-weight: 600;
    }
    #${screenId} .ta-section-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6b7280;
      margin: 12px 2px 7px;
    }
    #${screenId} .ta-toolbar {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      padding: 11px 14px;
      margin: 6px 0 12px;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    #${screenId} .ta-filter-row {
      display: flex;
      align-items: flex-end;
      gap: 10px;
      flex-wrap: wrap;
    }
    #${screenId} .ta-field {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    #${screenId} .ta-field label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
    }
    #${screenId} .ta-field select,
    #${screenId} .ta-field input {
      height: 36px;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      background: #fff;
      color: #111827;
      padding: 0 10px;
      font-size: 13px;
      min-width: 150px;
    }
    #${screenId} .ta-field.is-custom { display: none; }
    #${screenId}.ta-custom-range .ta-field.is-custom { display: flex; }
    #${screenId} .ta-toolbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    #${screenId} .ta-range-label {
      font-size: 12px;
      color: #6b7280;
      margin-right: 4px;
    }
    #${screenId} .ta-action-btn {
      height: 36px;
      border: 0;
      border-radius: 999px;
      padding: 0 14px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      background: linear-gradient(135deg, #9d68b9, #ff9580);
      color: #fff;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.10);
    }
    #${screenId} .ta-action-btn.secondary {
      background: #f3f4f6;
      color: #374151;
      box-shadow: none;
      border: 1px solid #e5e7eb;
    }
    #${screenId} .ta-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 10px;
    }
    #${screenId} .ta-card,
    #${screenId} .ta-panel {
      background: #fff;
      border: 1px solid #e5e7eb;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    #${screenId} .ta-card {
      border-radius: 14px;
      padding: 11px 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    #${screenId} .ta-card-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
    }
    #${screenId} .ta-card-value {
      font-size: 21px;
      font-weight: 800;
      color: #111827;
      line-height: 1.1;
    }
    #${screenId} .ta-card-foot {
      font-size: 11px;
      color: #6b7280;
    }
    #${screenId} .ta-panel {
      border-radius: 16px;
      padding: 18px 20px;
    }
    #${screenId} .ta-empty {
      border: 1px dashed #d1d5db;
      background: #fff;
      border-radius: 14px;
      padding: 24px;
      color: #6b7280;
      font-size: 14px;
      text-align: center;
    }
    #${screenId} .ta-table-wrap { overflow-x: auto; }
    #${screenId} .ta-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    #${screenId} .ta-table th,
    #${screenId} .ta-table td {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid #f3f4f6;
      white-space: nowrap;
    }
    #${screenId} .ta-table th {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
    }
    #${screenId} .ta-table tr:last-child td { border-bottom: 0; }
    #${screenId} .ta-table .num { text-align: right; font-variant-numeric: tabular-nums; }
    #${screenId} .ta-day {
      border: 1px solid #eef0f3;
      border-radius: 12px;
      background: #fff;
      margin-bottom: 10px;
      overflow: hidden;
    }
    #${screenId} .ta-day:last-child { margin-bottom: 0; }
    #${screenId} .ta-day-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 14px;
      background: #f9fafb;
      color: #111827;
      cursor: pointer;
      font-size: 12px;
      font-weight: 800;
    }
    #${screenId} .ta-day-title::-webkit-details-marker { display: none; }
    #${screenId} .ta-day-meta {
      color: #6b7280;
      font-weight: 600;
    }
    #${screenId} .ta-day-body {
      padding: 12px 14px 14px;
    }
    #${screenId} .ta-hour-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 8px;
    }
    #${screenId} .ta-hour-card {
      background: #f9fafb;
      border: 1px solid #eef0f3;
      border-radius: 10px;
      padding: 10px 12px;
    }
    #${screenId} .ta-hour-card.is-peak {
      background: linear-gradient(135deg, rgba(157, 104, 185, 0.10), rgba(255, 149, 128, 0.10));
      border-color: #d8b6e8;
    }
    #${screenId} .ta-hour-title {
      font-size: 13px;
      font-weight: 800;
      color: #111827;
      margin-bottom: 8px;
    }
    #${screenId} .ta-hour-row {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      font-size: 12px;
      line-height: 1.6;
      color: #4b5563;
    }
    #${screenId} .ta-hour-row strong {
      color: #111827;
      font-variant-numeric: tabular-nums;
    }
    #${screenId} .ta-closed {
      padding: 10px 12px;
      border: 1px dashed #e5e7eb;
      border-radius: 10px;
      background: #f9fafb;
      color: #6b7280;
      font-size: 13px;
    }
    #${screenId} .ta-insights {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    #${screenId} .ta-insight {
      padding: 10px 12px;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 10px;
      color: #1e40af;
      font-size: 13px;
      line-height: 1.4;
    }
    @media (max-width: 900px) {
      #${screenId} .ta-wrap { padding: 16px 14px 32px; }
      #${screenId} .ta-h1,
      #${screenId} .ta-location { margin-left: 0; }
      #${screenId} .ta-toolbar { align-items: stretch; }
      #${screenId} .ta-toolbar-actions { width: 100%; }
      #${screenId} .ta-action-btn { flex: 1; }
      #${screenId} .ta-card-value { font-size: 19px; }
    }
    @media (max-width: 640px) {
      /* Match the global mobile header behavior used by every other module:
         respect the device safe-area-inset-top (iOS status bar) and use the
         same z-index as the rest of the app so the purple top bar sits below
         the time/battery row, not on top of it. */
      body.ff-dashboard-analytics-open .header {
        position: fixed !important;
        top: constant(safe-area-inset-top) !important;
        top: env(safe-area-inset-top, 0px) !important;
        left: 0 !important;
        right: 0 !important;
        z-index: 100450 !important;
      }
      #${screenId} {
        top: var(--header-h, 60px) !important;
        bottom: calc(70px + env(safe-area-inset-bottom, 0px)) !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        -webkit-overflow-scrolling: touch;
      }
      #${screenId} .ta-wrap {
        padding: 14px 18px calc(170px + env(safe-area-inset-bottom, 0px)) 18px;
        box-sizing: border-box;
      }
      #${screenId} #ffTaInsights {
        margin-bottom: calc(52px + env(safe-area-inset-bottom, 0px));
      }
      #${screenId} .ta-insights {
        padding-bottom: 32px;
      }
      #${screenId} .ta-insight:last-child {
        margin-bottom: 18px;
      }
    }
  `;
  document.head.appendChild(style);
}
