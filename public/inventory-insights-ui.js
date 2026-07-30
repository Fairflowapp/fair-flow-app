// inventory-insights-ui.js
// Inventory > Insights — rendering only (donut SVG, currency format, full tab
// HTML with sub-tabs). Extracted verbatim from inventory-insights.js.
// Reads computed results from invState._invInsights*; no injected deps.

import { invState } from "./inventory-state.js?v=20260728_inv_mobile_unstick";
import {
  escapeHtml,
  formatOrderDisplay,
} from "./inventory-helpers.js?v=20260728_inv_mobile_unstick";
import {
  INV_INSIGHTS_REORDER_DAYS,
  INV_INSIGHTS_LOW_DAYS,
  INV_INSIGHTS_LOW_THRESHOLD,
  INV_INSIGHTS_CHART_COLORS,
} from "./inventory-insights-compute.js?v=20260728_inv_mobile_unstick";

function renderInsightsDonutSvg(rows, totalSpend) {
  const sum = rows.reduce((acc, r) => acc + (Number(r.spend) || 0), 0);
  if (!(sum > 0) || !rows.length) return "";
  const cx = 70;
  const cy = 70;
  const rOuter = 60;
  const rInner = 40;
  // Single-slice edge case: draw two half-arc slices so SVG renders correctly.
  if (rows.length === 1) {
    const color = INV_INSIGHTS_CHART_COLORS[0];
    const ring = `<circle cx="${cx}" cy="${cy}" r="${(rOuter + rInner) / 2}" fill="none" stroke="${color}" stroke-width="${rOuter - rInner}" />`;
    const totalText = formatInsightsCurrency(totalSpend);
    return `<svg class="ff-inv2-insights-donut-svg" viewBox="0 0 140 140" width="140" height="140" role="img" aria-label="Spend by category donut chart">
  ${ring}
  <text class="ff-inv2-insights-donut-total" x="${cx}" y="${cy - 4}" text-anchor="middle">${escapeHtml(totalText)}</text>
  <text class="ff-inv2-insights-donut-sub" x="${cx}" y="${cy + 12}" text-anchor="middle">Total spend</text>
</svg>`;
  }
  let angle = -Math.PI / 2; // Start at top.
  const slices = rows
    .map((r, i) => {
      const frac = (Number(r.spend) || 0) / sum;
      if (!(frac > 0)) return "";
      const start = angle;
      const end = angle + frac * 2 * Math.PI;
      angle = end;
      const largeArc = end - start > Math.PI ? 1 : 0;
      const x1o = cx + rOuter * Math.cos(start);
      const y1o = cy + rOuter * Math.sin(start);
      const x2o = cx + rOuter * Math.cos(end);
      const y2o = cy + rOuter * Math.sin(end);
      const x1i = cx + rInner * Math.cos(end);
      const y1i = cy + rInner * Math.sin(end);
      const x2i = cx + rInner * Math.cos(start);
      const y2i = cy + rInner * Math.sin(start);
      const d = [
        `M ${x1o.toFixed(2)} ${y1o.toFixed(2)}`,
        `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2o.toFixed(2)} ${y2o.toFixed(2)}`,
        `L ${x1i.toFixed(2)} ${y1i.toFixed(2)}`,
        `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x2i.toFixed(2)} ${y2i.toFixed(2)}`,
        "Z",
      ].join(" ");
      const color = INV_INSIGHTS_CHART_COLORS[i % INV_INSIGHTS_CHART_COLORS.length];
      const title = `${r.name}: ${formatInsightsCurrency(r.spend)} (${r.percent}%)`;
      return `<path d="${d}" fill="${color}" stroke="#fff" stroke-width="1.5"><title>${escapeHtml(title)}</title></path>`;
    })
    .join("");
  const totalText = formatInsightsCurrency(totalSpend);
  return `<svg class="ff-inv2-insights-donut-svg" viewBox="0 0 140 140" width="140" height="140" role="img" aria-label="Spend by category donut chart">
  ${slices}
  <text class="ff-inv2-insights-donut-total" x="${cx}" y="${cy - 4}" text-anchor="middle">${escapeHtml(totalText)}</text>
  <text class="ff-inv2-insights-donut-sub" x="${cx}" y="${cy + 12}" text-anchor="middle">Total spend</text>
</svg>`;
}

function formatInsightsCurrency(n) {
  const v = Number(n);
  const amount = Number.isFinite(v) ? v : 0;
  if (typeof window !== "undefined" && typeof window.ffFormatCurrency === "function") {
    return window.ffFormatCurrency(amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const r = Math.round(amount * 100) / 100;
  try {
    return `$${r.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } catch (e) {
    return `$${r.toFixed(2)}`;
  }
}

function renderInventoryInsightsTabHtml() {
  const ranges = [
    { id: "30d", label: "Last 30 days" },
    { id: "60d", label: "Last 60 days" },
    { id: "120d", label: "Last 120 days" },
    { id: "year", label: "Last year" },
    { id: "all", label: "All time" },
    { id: "custom", label: "Custom range…" },
  ];
  const options = ranges
    .map((r) => {
      const sel = invState._invInsightsRange === r.id ? " selected" : "";
      return `<option value="${r.id}"${sel}>${escapeHtml(r.label)}</option>`;
    })
    .join("");
  const rangeControl = `<label class="ff-inv2-insights-range-label">Range
  <select class="ff-inv2-insights-range-select" data-inv-insights-range-select aria-label="Date range">${options}</select>
</label>`;
  const customRow =
    invState._invInsightsRange === "custom"
      ? `<div class="ff-inv2-insights-custom">
  <label class="ff-inv2-insights-date-label">From <input type="date" data-inv-insights-from value="${escapeHtml(invState._invInsightsCustomFrom)}" /></label>
  <label class="ff-inv2-insights-date-label">To <input type="date" data-inv-insights-to value="${escapeHtml(invState._invInsightsCustomTo)}" /></label>
</div>`
      : "";
  const kpis = invState._invInsightsKpis;
  const inProgress = Math.max(0, (kpis.totalOrders || 0) - (kpis.doneOrders || 0));
  const doneSubtitle = kpis.totalOrders > 0
    ? `${kpis.doneOrders} of ${kpis.totalOrders} · ${inProgress} in progress`
    : "No activity yet";
  // Month-over-Month delta for Total spend.
  let spendDeltaHtml = `<span class="ff-inv2-insights-kpi-sub">Based on items actually bought</span>`;
  const pct = kpis.spendPctChange;
  if (invState._invInsightsRange !== "all" && typeof pct === "number" && Number.isFinite(pct)) {
    const rounded = Math.round(pct * 10) / 10;
    const up = rounded > 0;
    const flat = Math.abs(rounded) < 0.05;
    // For spend, UP is bad (red) and DOWN is good (green). Flat stays neutral.
    const cls = flat ? "ff-inv2-insights-delta--flat" : up ? "ff-inv2-insights-delta--up" : "ff-inv2-insights-delta--down";
    const arrow = flat ? "≈" : up ? "▲" : "▼";
    const label = flat
      ? "No change vs previous period"
      : `${Math.abs(rounded)}% vs previous (${escapeHtml(formatInsightsCurrency(kpis.prevSpend || 0))})`;
    spendDeltaHtml = `<span class="ff-inv2-insights-delta ${cls}"><span class="ff-inv2-insights-delta-arrow">${arrow}</span>${escapeHtml(label)}</span>`;
  } else if (invState._invInsightsRange !== "all" && (kpis.prevSpend || 0) === 0 && (kpis.totalSpend || 0) > 0) {
    spendDeltaHtml = `<span class="ff-inv2-insights-kpi-sub">No prior-period spend</span>`;
  }
  const kpiBlock = `<div class="ff-inv2-insights-kpis">
  <div class="ff-inv2-insights-kpi">
    <span class="ff-inv2-insights-kpi-label">Total spend</span>
    <span class="ff-inv2-insights-kpi-value">${escapeHtml(formatInsightsCurrency(kpis.totalSpend))}</span>
    ${spendDeltaHtml}
  </div>
  <div class="ff-inv2-insights-kpi">
    <span class="ff-inv2-insights-kpi-label">Done orders</span>
    <span class="ff-inv2-insights-kpi-value">${escapeHtml(String(kpis.doneOrders))}</span>
    <span class="ff-inv2-insights-kpi-sub">${escapeHtml(doneSubtitle)}</span>
  </div>
  <div class="ff-inv2-insights-kpi">
    <span class="ff-inv2-insights-kpi-label">Unique items</span>
    <span class="ff-inv2-insights-kpi-value">${escapeHtml(String(kpis.uniqueItems))}</span>
    <span class="ff-inv2-insights-kpi-sub">Distinct SKUs purchased</span>
  </div>
</div>`;

  let mostPurchasedBody;
  if (invState._invInsightsLoading) {
    mostPurchasedBody = `<p class="ff-inv2-insights-empty">Loading…</p>`;
  } else if (invState._invInsightsError) {
    mostPurchasedBody = `<p class="ff-inv2-insights-empty">${escapeHtml(invState._invInsightsError)}</p>`;
  } else if (invState._invInsightsRows.length === 0) {
    mostPurchasedBody = `<p class="ff-inv2-insights-empty">No purchases in this range.</p>`;
  } else {
    mostPurchasedBody = `<ol class="ff-inv2-insights-list">${invState._invInsightsRows
      .map(
        (r, i) => `<li class="ff-inv2-insights-row">
  <span class="ff-inv2-insights-rank">${i + 1}.</span>
  <span class="ff-inv2-insights-name">${escapeHtml(r.name)}</span>
  <span class="ff-inv2-insights-qty">${escapeHtml(formatOrderDisplay(r.totalQty))}</span>
</li>`
      )
      .join("")}</ol>`;
  }

  // Spend by Category
  const categoryRows = invState._invInsightsCategorySpend || [];
  const spendBlock = !invState._invInsightsLoading && categoryRows.length > 0
    ? `<div class="ff-inv2-insights-card">
  <div class="ff-inv2-insights-card-head">
    <h4 class="ff-inv2-insights-card-title">Spend by Category</h4>
  </div>
  <div class="ff-inv2-insights-spend-list">${categoryRows
    .map((r) => `<div class="ff-inv2-insights-spend-row">
  <div class="ff-inv2-insights-spend-name-row">
    <span class="ff-inv2-insights-spend-name">${escapeHtml(r.name)}</span>
    <span class="ff-inv2-insights-spend-amount">${escapeHtml(formatInsightsCurrency(r.spend))}</span>
    <span class="ff-inv2-insights-spend-pct">${escapeHtml(String(r.percent))}%</span>
  </div>
  <div class="ff-inv2-insights-spend-bar" aria-hidden="true"><span style="width:${Math.max(2, r.percent)}%"></span></div>
</div>`)
    .join("")}</div>
</div>`
    : "";

  // Running Low
  const runningLow = invState._invInsightsRunningLow || [];
  const lowList = runningLow.slice(0, 8);
  const lowBlock = !invState._invInsightsLoading && lowList.length > 0
    ? `<div class="ff-inv2-insights-card ff-inv2-insights-card--warn">
  <div class="ff-inv2-insights-card-head">
    <h4 class="ff-inv2-insights-card-title">⚠ Running Low (${runningLow.length})</h4>
    <span class="ff-inv2-insights-card-hint">Below ${Math.round(INV_INSIGHTS_LOW_THRESHOLD * 100)}% of stock target</span>
  </div>
  <ul class="ff-inv2-insights-low-list">${lowList
    .map((e) => {
      const pct = Math.max(0, Math.round(e.pctLeft * 100));
      const name = e.groupName ? `${e.itemName} (${e.groupName})` : e.itemName;
      const path = [e.categoryName, e.subcategoryName].filter(Boolean).join(" › ");
      return `<li class="ff-inv2-insights-low-row">
  <div class="ff-inv2-insights-low-main">
    <div class="ff-inv2-insights-low-name">${escapeHtml(name)}</div>
    <div class="ff-inv2-insights-low-path">${escapeHtml(path)}</div>
  </div>
  <div class="ff-inv2-insights-low-qty">
    <span class="ff-inv2-insights-low-current">${escapeHtml(formatOrderDisplay(e.current))}</span>
    <span class="ff-inv2-insights-low-sep">/</span>
    <span class="ff-inv2-insights-low-stock">${escapeHtml(formatOrderDisplay(e.stock))}</span>
    <span class="ff-inv2-insights-low-pct">${pct}%</span>
  </div>
</li>`;
    })
    .join("")}</ul>
</div>`
    : "";

  // Dead Stock
  const deadStock = invState._invInsightsDeadStock || [];
  const deadList = deadStock.slice(0, 8);
  const rangeLabelForDead = invState._invInsightsRange === "all" ? "" : (
    invState._invInsightsRange === "custom"
      ? "in selected range"
      : invState._invInsightsRange === "year"
        ? "in the past year"
        : `in last ${invState._invInsightsRange.replace("d", " days")}`
  );
  const deadBlock = !invState._invInsightsLoading && deadList.length > 0 && invState._invInsightsRange !== "all"
    ? `<div class="ff-inv2-insights-card ff-inv2-insights-card--dead">
  <div class="ff-inv2-insights-card-head">
    <h4 class="ff-inv2-insights-card-title">Dead Stock (${deadStock.length})</h4>
    <span class="ff-inv2-insights-card-hint">In stock · no activity ${escapeHtml(rangeLabelForDead)}</span>
  </div>
  <ul class="ff-inv2-insights-low-list">${deadList
    .map((e) => {
      const name = e.groupName ? `${e.itemName} (${e.groupName})` : e.itemName;
      const path = [e.categoryName, e.subcategoryName].filter(Boolean).join(" › ");
      return `<li class="ff-inv2-insights-low-row">
  <div class="ff-inv2-insights-low-main">
    <div class="ff-inv2-insights-low-name">${escapeHtml(name)}</div>
    <div class="ff-inv2-insights-low-path">${escapeHtml(path)}</div>
  </div>
  <div class="ff-inv2-insights-low-qty">
    <span class="ff-inv2-insights-low-current">${escapeHtml(formatOrderDisplay(e.current))}</span>
    <span class="ff-inv2-insights-low-sep">in stock</span>
  </div>
</li>`;
    })
    .join("")}</ul>
</div>`
    : "";

  // Smart Reorder Suggestions — forecast-driven, showing items likely to run out soon.
  const reorder = invState._invInsightsReorder || [];
  const reorderList = reorder.slice(0, 10);
  const reorderBlock = !invState._invInsightsLoading && reorderList.length > 0
    ? `<div class="ff-inv2-insights-card ff-inv2-insights-card--warn">
  <div class="ff-inv2-insights-card-head">
    <h4 class="ff-inv2-insights-card-title">⏰ Reorder Suggestions (${reorder.length})</h4>
    <span class="ff-inv2-insights-card-hint">Will run out within ${INV_INSIGHTS_REORDER_DAYS} days at current pace</span>
  </div>
  <ul class="ff-inv2-insights-low-list">${reorderList
    .map((u) => {
      const name = u.groupName ? `${u.itemName} (${u.groupName})` : u.itemName;
      const path = [u.categoryName, u.subcategoryName].filter(Boolean).join(" › ");
      const days = Math.max(0, Math.round(u.daysLeft));
      const target = u.stock > 0 ? u.stock : Math.max(1, Math.round(u.dailyRate * (INV_INSIGHTS_LOW_DAYS * 2)));
      const suggest = Math.max(1, Math.ceil(target - u.current));
      const ratePerWeek = Math.round(u.dailyRate * 7 * 10) / 10;
      const rateLabel = ratePerWeek >= 1 ? `${ratePerWeek}/wk` : `${Math.round(u.dailyRate * 30 * 10) / 10}/mo`;
      return `<li class="ff-inv2-insights-low-row">
  <div class="ff-inv2-insights-low-main">
    <div class="ff-inv2-insights-low-name">${escapeHtml(name)}</div>
    <div class="ff-inv2-insights-low-path">${escapeHtml(path)} · ${escapeHtml(rateLabel)}</div>
  </div>
  <div class="ff-inv2-insights-reorder-qty">
    <span class="ff-inv2-insights-reorder-days">${days}d left</span>
    <span class="ff-inv2-insights-reorder-suggest">Order ${escapeHtml(formatOrderDisplay(suggest))}</span>
  </div>
</li>`;
    })
    .join("")}</ul>
</div>`
    : "";

  // Days of Stock Left — forecast card (usage-driven view only).
  // Only include items with meaningful forecast signal:
  // - dailyRate > 0 (real usage history) → a proper forecast
  // - current > 0 && some signal on stock target → shows how long stock will last
  // Exclude items with current=0 AND no usage — those are "inactive", not a forecast.
  const usage = invState._invInsightsUsage || [];
  const usageList = usage
    .filter((u) => u.dailyRate > 0 || (u.current > 0 && u.stock > 0))
    .slice(0, 12);
  const totalAtRisk = usage.filter((u) => (u.level === "critical" || u.level === "low") && u.dailyRate > 0).length;
  const usageBlock = !invState._invInsightsLoading && usageList.length > 0
    ? `<div class="ff-inv2-insights-card">
  <div class="ff-inv2-insights-card-head">
    <h4 class="ff-inv2-insights-card-title">Days of Stock Left</h4>
    <span class="ff-inv2-insights-card-hint">${totalAtRisk > 0 ? `${totalAtRisk} at risk` : "Based on usage in the selected range"}</span>
  </div>
  <ul class="ff-inv2-insights-usage-list">${usageList
    .map((u) => {
      const name = u.groupName ? `${u.itemName} (${u.groupName})` : u.itemName;
      const path = [u.categoryName, u.subcategoryName].filter(Boolean).join(" › ");
      const hasUsage = u.dailyRate > 0;
      // Only show a numeric days label when we have real usage data.
      // Without usage, the forecast is meaningless — show "—" instead of a fake "0d".
      let daysLabel;
      let levelForBadge = u.level;
      if (hasUsage) {
        daysLabel = Number.isFinite(u.daysLeft) ? `${Math.max(0, Math.round(u.daysLeft))}d` : "∞";
      } else if (u.current <= 0) {
        daysLabel = "Empty";
        levelForBadge = "critical";
      } else {
        daysLabel = "—";
        levelForBadge = "ok";
      }
      const ratePerWeek = Math.round(u.dailyRate * 7 * 10) / 10;
      const rateLabel = hasUsage
        ? (ratePerWeek >= 1 ? `${ratePerWeek}/wk` : `${Math.round(u.dailyRate * 30 * 10) / 10}/mo`)
        : "no recent usage";
      const levelCls = `ff-inv2-insights-usage-badge--${levelForBadge}`;
      return `<li class="ff-inv2-insights-usage-row">
  <div class="ff-inv2-insights-usage-main">
    <div class="ff-inv2-insights-usage-name">${escapeHtml(name)}</div>
    <div class="ff-inv2-insights-usage-path">${escapeHtml(path)} · ${escapeHtml(rateLabel)}</div>
  </div>
  <div class="ff-inv2-insights-usage-meta">
    <span class="ff-inv2-insights-usage-current">${escapeHtml(formatOrderDisplay(u.current))} left</span>
    <span class="ff-inv2-insights-usage-badge ${levelCls}">${escapeHtml(daysLabel)}</span>
  </div>
</li>`;
    })
    .join("")}</ul>
  ${usage.length > usageList.length ? `<div class="ff-inv2-insights-usage-more">+ ${usage.length - usageList.length} more tracked</div>` : ""}
</div>`
    : "";

  // Wrap Most Purchased as a standalone card so we can place it inside a sub-tab.
  const mostPurchasedCard = `<div class="ff-inv2-insights-card">
    <div class="ff-inv2-insights-card-head">
      <h4 class="ff-inv2-insights-card-title">Most Purchased</h4>
    </div>
    <div class="ff-inv2-insights-body">${mostPurchasedBody}</div>
  </div>`;

  // ---- Sub-tabs inside Insights ------------------------------------------
  const subTabs = [
    { id: "overview", label: "Overview" },
    { id: "purchases", label: "Purchases" },
    { id: "forecast", label: "Forecast" },
    { id: "health", label: "Stock Health" },
  ];
  const activeSub = subTabs.some((t) => t.id === invState._invInsightsSubTab) ? invState._invInsightsSubTab : "overview";
  const subTabBar = `<div class="ff-inv2-insights-subtabs" role="tablist" aria-label="Insights sections">${subTabs
    .map((t) => {
      const active = t.id === activeSub ? " ff-inv2-insights-subtab--active" : "";
      return `<button type="button" class="ff-inv2-insights-subtab${active}" role="tab" aria-selected="${t.id === activeSub}" data-inv-insights-subtab="${t.id}">${escapeHtml(t.label)}</button>`;
    })
    .join("")}</div>`;

  const emptyState = (msg) => `<div class="ff-inv2-insights-card"><p class="ff-inv2-insights-empty">${escapeHtml(msg)}</p></div>`;

  // Donut chart (Spend by Category) for Overview.
  const categoryRowsForDonut = invState._invInsightsCategorySpend || [];
  // Collapse categories beyond the palette size into "Other" so the chart stays readable.
  const maxSlices = INV_INSIGHTS_CHART_COLORS.length - 1; // reserve last color for "Other"
  let donutRows = categoryRowsForDonut;
  if (categoryRowsForDonut.length > maxSlices) {
    const top = categoryRowsForDonut.slice(0, maxSlices);
    const rest = categoryRowsForDonut.slice(maxSlices);
    const restSpend = rest.reduce((acc, r) => acc + (r.spend || 0), 0);
    const totalSpendSum = categoryRowsForDonut.reduce((acc, r) => acc + (r.spend || 0), 0) || 0;
    const restPct = totalSpendSum > 0 ? Math.round((restSpend / totalSpendSum) * 1000) / 10 : 0;
    donutRows = [...top, { name: `Other (${rest.length})`, spend: restSpend, percent: restPct }];
  }
  const donutSvg = renderInsightsDonutSvg(donutRows, kpis.totalSpend || 0);
  const donutBlock = donutSvg
    ? `<div class="ff-inv2-insights-card">
  <div class="ff-inv2-insights-card-head">
    <h4 class="ff-inv2-insights-card-title">Spend by Category</h4>
    <span class="ff-inv2-insights-card-hint">${donutRows.length} ${donutRows.length === 1 ? "category" : "categories"}</span>
  </div>
  <div class="ff-inv2-insights-donut-wrap">
    <div class="ff-inv2-insights-donut-chart">${donutSvg}</div>
    <ul class="ff-inv2-insights-donut-legend">${donutRows
      .map((r, i) => {
        const color = INV_INSIGHTS_CHART_COLORS[i % INV_INSIGHTS_CHART_COLORS.length];
        return `<li class="ff-inv2-insights-donut-legend-row">
  <span class="ff-inv2-insights-donut-dot" style="background:${color}" aria-hidden="true"></span>
  <span class="ff-inv2-insights-donut-legend-name">${escapeHtml(r.name)}</span>
  <span class="ff-inv2-insights-donut-legend-amount">${escapeHtml(formatInsightsCurrency(r.spend))}</span>
  <span class="ff-inv2-insights-donut-legend-pct">${escapeHtml(String(r.percent))}%</span>
</li>`;
      })
      .join("")}</ul>
  </div>
</div>`
    : "";

  let subContent = "";
  if (invState._invInsightsLoading) {
    subContent = `<div class="ff-inv2-insights-card"><p class="ff-inv2-insights-empty">Loading…</p></div>`;
  } else if (invState._invInsightsError) {
    subContent = `<div class="ff-inv2-insights-card"><p class="ff-inv2-insights-empty">${escapeHtml(invState._invInsightsError)}</p></div>`;
  } else if (activeSub === "overview") {
    subContent = `${kpiBlock}${donutBlock}`;
  } else if (activeSub === "purchases") {
    const hasMost = (invState._invInsightsRows || []).length > 0;
    const hasSpend = (invState._invInsightsCategorySpend || []).length > 0;
    if (!hasMost && !hasSpend) {
      subContent = emptyState("No purchases in this range yet.");
    } else {
      subContent = `${mostPurchasedCard}${spendBlock}`;
    }
  } else if (activeSub === "forecast") {
    const forecastIntro = `<div class="ff-inv2-insights-subtab-intro">
      <span class="ff-inv2-insights-subtab-intro-icon" aria-hidden="true">🔮</span>
      <div>
        <div class="ff-inv2-insights-subtab-intro-title">Forecast — predicted stock behavior</div>
        <div class="ff-inv2-insights-subtab-intro-hint">Based on your purchase rate in the selected range. Items you haven't bought recently are excluded.</div>
      </div>
    </div>`;
    if (!reorderBlock && !usageBlock) {
      subContent = `${forecastIntro}${emptyState("Not enough purchase history to forecast yet. Buy more items or widen the date range.")}`;
    } else {
      subContent = `${forecastIntro}${reorderBlock}${usageBlock}`;
    }
  } else if (activeSub === "health") {
    if (!lowBlock && !deadBlock) {
      subContent = emptyState("All good — nothing running low or sitting unused.");
    } else {
      subContent = `${lowBlock}${deadBlock}`;
    }
  }

  return `<div class="ff-inv2-insights-wrap">
  <div class="ff-inv2-insights-head">
    <div class="ff-inv2-insights-head-row">
      <h3 class="ff-inv2-insights-title">Inventory Insights</h3>
      ${rangeControl}
    </div>
    ${customRow}
  </div>
  ${subTabBar}
  ${subContent}
</div>`;
}

export {
  renderInventoryInsightsTabHtml,
};
