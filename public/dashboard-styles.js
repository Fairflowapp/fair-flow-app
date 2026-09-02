/**
 * Dashboard — style injection.
 *
 * Exports injectStyles(screenId, styleId): builds the single <style> block for
 * the Dashboard screen, scoped to the caller-provided screenId. Pure DOM/CSS,
 * no data or logic. Extracted verbatim from dashboard.js (SCREEN_ID and the
 * hardcoded style id parameterized).
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
    #${screenId} .dash-wrap {
      max-width: 1280px;
      margin: 0 auto;
      padding: 2px 28px 48px 28px;
      width: 100%;
    }
    #${screenId} .dash-h1 {
      display: inline-block;
      vertical-align: middle;
      margin: 0 8px 6px 0;
      font-size: 16px;
      font-weight: 700;
      color: #111827;
      letter-spacing: -0.01em;
    }
    #${screenId} .dash-sub {
      display: none;
    }
    #${screenId} .dash-need-location {
      margin: 16px;
      color: #6b7280;
      font-size: 14px;
    }
    #${screenId} .dash-location {
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
    #${screenId} .dash-head-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 2px;
    }
    #${screenId} .dash-title-group {
      min-width: 0;
    }
    #${screenId} .dash-range-controls {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      flex-wrap: nowrap;
      margin-left: auto;
      margin-top: 6px;
    }
    #${screenId} .dash-range-label {
      font-size: 11px;
      font-weight: 700;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      white-space: nowrap;
    }
    #${screenId} .dash-range-select,
    #${screenId} .dash-range-date {
      height: 32px;
      border: 1px solid #e5e7eb;
      border-radius: 999px;
      background: #fff;
      color: #374151;
      font-size: 12px;
      font-weight: 600;
      padding: 0 10px;
      outline: none;
    }
    #${screenId} .dash-range-date {
      border-radius: 10px;
      width: 132px;
    }
    #${screenId} .dash-range-custom {
      display: none;
      align-items: center;
      gap: 6px;
    }
    #${screenId} .dash-section-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6b7280;
      margin: 12px 2px 7px 2px;
    }
    #${screenId} .dash-kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
    }
    #${screenId} .dash-kpi {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 14px;
      padding: 11px 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    #${screenId} .dash-kpi-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
    }
    #${screenId} .dash-kpi-value {
      font-size: 26px;
      font-weight: 700;
      color: #111827;
      line-height: 1.1;
    }
    #${screenId} .dash-kpi-foot {
      font-size: 12px;
      color: #6b7280;
    }
    #${screenId} .dash-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }
    #${screenId} .dash-card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 9px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    #${screenId} .dash-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    #${screenId} .dash-card-title {
      font-size: 15px;
      font-weight: 700;
      color: #111827;
      margin: 0;
    }
    #${screenId} .dash-card-icon {
      width: 32px; height: 32px;
      border-radius: 10px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, rgba(157, 104, 185, 0.12), rgba(255, 149, 128, 0.12));
      color: #9d68b9;
    }
    #${screenId} .dash-card-icon svg {
      width: 16px; height: 16px;
    }
    #${screenId} .dash-stats {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }
    #${screenId} .dash-stat {
      background: #f9fafb;
      border: 1px solid #eef0f3;
      border-radius: 10px;
      padding: 10px 12px;
    }
    #${screenId} .dash-stat-label {
      font-size: 11px;
      color: #6b7280;
      font-weight: 500;
    }
    #${screenId} .dash-stat-value {
      font-size: 18px;
      font-weight: 700;
      color: #111827;
      margin-top: 2px;
    }
    #${screenId} .dash-meta {
      font-size: 12px;
      color: #6b7280;
      line-height: 1.5;
    }
    #${screenId} .dash-meta b {
      color: #374151;
      font-weight: 600;
    }
    #${screenId} .dash-link {
      align-self: flex-start;
      background: none;
      border: 0;
      color: #9d68b9;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      padding: 4px 0;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    #${screenId} .dash-link:hover {
      text-decoration: underline;
    }
    #${screenId} .dash-insights-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    #${screenId} .dash-insight {
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
    #${screenId} .dash-insight.is-info {
      background: #eff6ff;
      border-color: #bfdbfe;
      color: #1e40af;
    }
    #${screenId} .dash-insight.is-good {
      background: #ecfdf5;
      border-color: #a7f3d0;
      color: #065f46;
    }
    #${screenId} .dash-insight-ico {
      flex-shrink: 0;
      font-size: 14px;
      line-height: 1.4;
    }

    @media (max-width: 900px) {
      #${screenId} .dash-wrap { padding: 16px 14px 32px 14px; }
      #${screenId} .dash-h1,
      #${screenId} .dash-location { margin-left: 0; }
      #${screenId} .dash-range-controls { justify-content: flex-start; width: 100%; }
      #${screenId} .dash-grid { grid-template-columns: 1fr; }
      #${screenId} .dash-stats { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 640px) {
      /* Match the global mobile header behavior used by every other module:
         the purple top bar must respect the device safe-area-inset-top (iOS
         status bar) and use the same z-index as the rest of the app so it
         sits below the time/battery row, not over it. */
      body.ff-dashboard-open .header {
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
        z-index: 9850;
      }
      #${screenId} .dash-wrap {
        padding: 14px 18px calc(118px + env(safe-area-inset-bottom, 0px)) 18px;
        box-sizing: border-box;
      }
      #${screenId} .dash-head-row {
        gap: 8px;
        margin-bottom: 6px;
      }
      #${screenId} .dash-range-controls {
        align-items: stretch;
        gap: 8px;
      }
      #${screenId} .dash-range-label {
        width: 100%;
      }
      #${screenId} .dash-range-select {
        width: 100%;
        min-height: 38px;
        border-radius: 12px;
      }
      #${screenId} .dash-range-custom {
        width: 100%;
        flex-wrap: wrap;
      }
      #${screenId} .dash-range-date {
        flex: 1 1 135px;
        min-width: 0;
      }
      #${screenId} .dash-kpis {
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      #${screenId} .dash-kpi {
        padding: 10px 11px;
        border-radius: 13px;
      }
      #${screenId} .dash-kpi-value {
        font-size: 22px;
      }
      #${screenId} .dash-card {
        padding: 13px 14px;
        border-radius: 15px;
      }
      #${screenId} .dash-insight {
        padding: 12px 12px;
        font-size: 13px;
        line-height: 1.45;
      }
    }
  `;
  document.head.appendChild(style);
}
