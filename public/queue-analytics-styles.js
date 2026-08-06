/**
 * Queue Analytics — styles.
 *
 * Extracted verbatim from queue-analytics.js (the inline injectStyles CSS).
 * The screen id is passed in by the orchestrator so there is a single source
 * of truth (queue-analytics.js owns SCREEN_ID). No CSS changed in the split.
 */

export function injectStyles(screenId) {
  if (document.getElementById("ffQueueAnalyticsStyles")) return;
  const style = document.createElement("style");
  style.id = "ffQueueAnalyticsStyles";
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
    #${screenId} .qa-wrap {
      max-width: 1280px;
      margin: 0 auto;
      padding: 6px 28px 48px 28px;
      width: 100%;
    }
    #${screenId} .qa-back {
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
    #${screenId} .qa-back:hover { color: #9d68b9; }
    #${screenId} .qa-h1 {
      display: inline-block;
      vertical-align: middle;
      margin: 0 8px 6px 0;
      font-size: 16px;
      font-weight: 700;
      color: #111827;
      letter-spacing: -0.01em;
    }
    #${screenId} .qa-sub {
      display: none;
    }
    #${screenId} .qa-location {
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
    #${screenId} .qa-section-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6b7280;
      margin: 12px 2px 7px 2px;
    }
    #${screenId} .qa-toolbar {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      padding: 11px 14px;
      margin: 6px 0 12px 0;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    #${screenId} .qa-filter-row {
      display: flex;
      align-items: flex-end;
      gap: 10px;
      flex-wrap: wrap;
    }
    #${screenId} .qa-field {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    #${screenId} .qa-field label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
    }
    #${screenId} .qa-field select,
    #${screenId} .qa-field input {
      height: 36px;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      background: #fff;
      color: #111827;
      padding: 0 10px;
      font-size: 13px;
      min-width: 150px;
    }
    #${screenId} .qa-field.is-custom { display: none; }
    #${screenId}.qa-custom-range .qa-field.is-custom { display: flex; }
    #${screenId} .qa-toolbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    #${screenId} .qa-range-label {
      font-size: 12px;
      color: #6b7280;
      margin-right: 4px;
    }
    #${screenId} .qa-action-btn {
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
    #${screenId} .qa-action-btn.secondary {
      background: #f3f4f6;
      color: #374151;
      box-shadow: none;
      border: 1px solid #e5e7eb;
    }
    #${screenId} .qa-empty {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 24px;
      text-align: center;
      color: #6b7280;
      font-size: 14px;
    }
    #${screenId} .qa-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 10px;
    }
    #${screenId} .qa-card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 14px;
      padding: 11px 14px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    #${screenId} .qa-card-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
    }
    #${screenId} .qa-card-value {
      font-size: 24px;
      font-weight: 700;
      color: #111827;
      line-height: 1.1;
    }
    #${screenId} .qa-card-foot {
      font-size: 12px;
      color: #6b7280;
    }
    #${screenId} .qa-panel {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      padding: 18px 20px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    #${screenId} .qa-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    #${screenId} .qa-table th,
    #${screenId} .qa-table td {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid #f3f4f6;
    }
    #${screenId} .qa-table th {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
    }
    #${screenId} .qa-table tr:last-child td { border-bottom: 0; }
    #${screenId} .qa-table td.num,
    #${screenId} .qa-table th.num { text-align: right; font-variant-numeric: tabular-nums; }
    #${screenId} .qa-bar {
      position: relative;
      height: 6px;
      background: #f3f4f6;
      border-radius: 3px;
      overflow: hidden;
      margin-top: 2px;
    }
    #${screenId} .qa-bar > span {
      position: absolute;
      top: 0; bottom: 0; left: 0;
      background: linear-gradient(90deg, #9d68b9, #ff9580);
      border-radius: 3px;
    }
    #${screenId} .qa-hour-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 8px;
      margin-top: 4px;
    }
    #${screenId} .qa-hour-day {
      border: 1px solid #eef0f3;
      border-radius: 12px;
      background: #fff;
      margin-bottom: 10px;
      overflow: hidden;
    }
    #${screenId} .qa-hour-day:last-child { margin-bottom: 0; }
    #${screenId} .qa-hour-day-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      width: 100%;
      padding: 12px 14px;
      border: 0;
      background: #f9fafb;
      font-size: 12px;
      font-weight: 700;
      color: #111827;
      cursor: pointer;
      text-align: left;
    }
    #${screenId} .qa-hour-day-title::-webkit-details-marker { display: none; }
    #${screenId} .qa-hour-day-hours {
      font-weight: 500;
      color: #6b7280;
    }
    #${screenId} .qa-hour-day-body {
      padding: 12px 14px 14px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    #${screenId} .qa-metric-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
      margin-bottom: 8px;
    }
    #${screenId} .qa-day-stats {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    #${screenId} .qa-day-stat {
      border: 1px solid #eef0f3;
      background: #f9fafb;
      border-radius: 999px;
      padding: 7px 10px;
      font-size: 12px;
      color: #374151;
      font-weight: 700;
    }
    #${screenId} .qa-hour-card-title {
      font-size: 13px;
      font-weight: 800;
      color: #111827;
      margin-bottom: 8px;
    }
    #${screenId} .qa-hour-card-row {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      font-size: 12px;
      line-height: 1.6;
      color: #4b5563;
    }
    #${screenId} .qa-hour-card-row strong {
      color: #111827;
      font-variant-numeric: tabular-nums;
    }
    #${screenId} .qa-type-title {
      font-size: 10px;
      font-weight: 800;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 2px;
    }
    #${screenId} .qa-type-row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      color: #4b5563;
      font-size: 11px;
      line-height: 1.4;
    }
    #${screenId} .qa-type-row strong {
      color: #111827;
      font-variant-numeric: tabular-nums;
    }
    #${screenId} .qa-hour-modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 9995;
      background: rgba(17, 24, 39, 0.42);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
    }
    #${screenId} .qa-hour-modal {
      width: min(520px, 100%);
      max-height: min(720px, calc(100vh - 36px));
      overflow: auto;
      background: #fff;
      border-radius: 18px;
      border: 1px solid #e5e7eb;
      box-shadow: 0 24px 70px rgba(15, 23, 42, 0.24);
    }
    #${screenId} .qa-hour-modal-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
      padding: 18px 20px 12px;
      border-bottom: 1px solid #f3f4f6;
    }
    #${screenId} .qa-hour-modal-title {
      margin: 0;
      font-size: 18px;
      font-weight: 800;
      color: #111827;
    }
    #${screenId} .qa-hour-modal-sub {
      margin: 4px 0 0;
      font-size: 12px;
      color: #6b7280;
    }
    #${screenId} .qa-hour-modal-close {
      border: 0;
      background: #f3f4f6;
      color: #374151;
      border-radius: 999px;
      width: 32px;
      height: 32px;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
    }
    #${screenId} .qa-hour-modal-body {
      padding: 16px 20px 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    #${screenId} .qa-hour-modal-summary {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }
    #${screenId} .qa-hour-modal-stat {
      border: 1px solid #eef0f3;
      background: #f9fafb;
      border-radius: 12px;
      padding: 10px 12px;
    }
    #${screenId} .qa-hour-modal-stat span {
      display: block;
      font-size: 10px;
      font-weight: 800;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
    }
    #${screenId} .qa-hour-modal-stat strong {
      font-size: 18px;
      color: #111827;
      font-variant-numeric: tabular-nums;
    }
    #${screenId} .qa-hour-modal-section {
      border: 1px solid #eef0f3;
      border-radius: 14px;
      padding: 12px 14px;
      background: #fff;
    }
    #${screenId} .qa-closed {
      padding: 10px 12px;
      border: 1px dashed #e5e7eb;
      border-radius: 10px;
      background: #f9fafb;
      color: #6b7280;
      font-size: 13px;
    }
    #${screenId} .qa-hour-tile {
      background: #f9fafb;
      border: 1px solid #eef0f3;
      border-radius: 10px;
      padding: 10px 12px;
      appearance: none;
      cursor: pointer;
      text-align: left;
      width: 100%;
    }
    #${screenId} .qa-hour-tile:hover {
      border-color: #d8b6e8;
      box-shadow: 0 2px 8px rgba(157, 104, 185, 0.10);
    }
    #${screenId} .qa-hour-tile:focus-visible {
      outline: 2px solid #9d68b9;
      outline-offset: 2px;
    }
    #${screenId} .qa-hour-tile.is-peak {
      background: linear-gradient(135deg, rgba(157, 104, 185, 0.10), rgba(255, 149, 128, 0.10));
      border-color: #d8b6e8;
    }
    #${screenId} .qa-hour-tile-label {
      font-size: 11px;
      color: #6b7280;
      font-weight: 500;
    }
    #${screenId} .qa-hour-tile-value {
      font-size: 16px;
      font-weight: 700;
      color: #111827;
      margin-top: 2px;
    }
    #${screenId} .qa-insights-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    #${screenId} .qa-insight {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 12px;
      background: #fff7ed;
      border: 1px solid #fed7aa;
      border-radius: 10px;
      color: #9a3412;
      font-size: 13px;
      line-height: 1.4;
    }
    #${screenId} .qa-insight.is-info {
      background: #eff6ff;
      border-color: #bfdbfe;
      color: #1e40af;
    }
    #${screenId} .qa-insight.is-good {
      background: #ecfdf5;
      border-color: #a7f3d0;
      color: #065f46;
    }
    @media (max-width: 900px) {
      #${screenId} .qa-wrap { padding: 16px 14px 32px 14px; }
      #${screenId} .qa-h1,
      #${screenId} .qa-location { margin-left: 0; }
      #${screenId} .qa-toolbar { align-items: stretch; }
      #${screenId} .qa-toolbar-actions { width: 100%; }
      #${screenId} .qa-action-btn { flex: 1; }
      #${screenId} .qa-hour-modal-summary { grid-template-columns: 1fr; }
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
      #${screenId} .qa-wrap {
        padding: 14px 18px calc(160px + env(safe-area-inset-bottom, 0px)) 18px;
        box-sizing: border-box;
      }
      #${screenId} #ffQaInsights {
        margin-bottom: calc(46px + env(safe-area-inset-bottom, 0px));
      }
      #${screenId} .qa-insights-list {
        padding-bottom: 28px;
      }
      #${screenId} .qa-insight:last-child {
        margin-bottom: 16px;
      }
    }
  `;
  document.head.appendChild(style);
}
