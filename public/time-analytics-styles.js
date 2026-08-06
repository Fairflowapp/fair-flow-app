/**
 * Time Analytics — styles.
 *
 * Extracted verbatim from time-analytics.js (the inline injectStyles CSS).
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
      max-width: 1180px;
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
    #${screenId} .ta-toolbar {
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
    #${screenId} .ta-section-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6b7280;
      margin: 12px 2px 7px;
    }
    #${screenId} .ta-grid {
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
    #${screenId} .ta-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
    }
    #${screenId} .ta-value {
      font-size: 22px;
      font-weight: 800;
      color: #111827;
      line-height: 1.1;
    }
    #${screenId} .ta-foot {
      font-size: 11px;
      color: #6b7280;
    }
    #${screenId} .ta-panel {
      border-radius: 16px;
      padding: 18px 20px;
    }
    #${screenId} .ta-compare-row {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    #${screenId} .ta-deviation-title {
      margin: 18px 0 10px;
      font-size: 12px;
      font-weight: 800;
      color: #111827;
    }
    #${screenId} .ta-deviation-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    #${screenId} .ta-deviation {
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 12px 14px;
      background: #fafafa;
    }
    #${screenId} .ta-deviation-head {
      font-size: 13px;
      font-weight: 800;
      color: #111827;
      margin-bottom: 6px;
    }
    #${screenId} .ta-deviation-line {
      font-size: 12px;
      color: #4b5563;
      line-height: 1.45;
    }
    #${screenId} .ta-deviation-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    #${screenId} .ta-deviation-tag {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 4px 8px;
      background: #fff7ed;
      border: 1px solid #fed7aa;
      color: #9a3412;
      font-size: 11px;
      font-weight: 700;
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
    #${screenId} .ta-insights {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    #${screenId} .ta-insight {
      padding: 10px 12px;
      border-radius: 10px;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      color: #1e40af;
      font-size: 13px;
      line-height: 1.4;
    }
    #${screenId} .ta-insight.warn {
      background: #fff7ed;
      border-color: #fed7aa;
      color: #9a3412;
    }
    #${screenId} .ta-insight.good {
      background: #ecfdf5;
      border-color: #a7f3d0;
      color: #065f46;
    }
    @media (max-width: 800px) {
      #${screenId} .ta-wrap { padding: 16px 14px 32px; }
      #${screenId} .ta-h1,
      #${screenId} .ta-location { margin-left: 0; }
      #${screenId} .ta-toolbar { align-items: stretch; }
      #${screenId} .ta-toolbar-actions { width: 100%; }
      #${screenId} .ta-action-btn { flex: 1; }
      #${screenId} .ta-compare-row { grid-template-columns: 1fr; }
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
      #${screenId} #ffTimeAnalyticsInsights {
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
