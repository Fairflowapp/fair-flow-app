/**
 * Sales Comparison report. Closed checkout sales vs the previous
 * equal-length civil date range.
 */
(function () {
  var HOST_ID = "ffRptMain";
  var REPORT_ID = "sales-comparison";
  var filters = {
    locationIds: null,
    date: "today",
    customFrom: "",
    customTo: ""
  };
  var result = null;
  var status = "idle";
  var errorText = "";
  var openMenu = "";
  var loadGen = 0;

  function compute() { return window.ffBookingReportsCompute || null; }
  function compareApi() { return window.ffBookingReportsSalesCompareCompute || null; }
  function repo() { return window.ffBookingSales || null; }
  function model() { return window.ffBookingSalesModel || null; }
  function time() { return window.ffBookingTime || null; }
  function rangeApi() { return window.ffBookingReportsSalesRange || null; }
  function nav() { return window.ffBookingReportsNav || null; }

  function isActive() {
    var api = nav();
    return !!(api && typeof api.getSelectedId === "function" && api.getSelectedId() === REPORT_ID);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function todayKey() {
    var tm = time();
    return tm && typeof tm.todayDateKey === "function" ? tm.todayDateKey() : "";
  }

  function locations() {
    var list = [];
    try {
      if (typeof window.ffGetLocations === "function") list = window.ffGetLocations() || [];
    } catch (_) {}
    if (!list.length && Array.isArray(window.__ff_locations)) list = window.__ff_locations;
    return (list || []).map(function (row) {
      var id = String(row && (row.id || row.locationId) || "").trim();
      var name = String(row && (row.name || row.locationName) || id).trim();
      return { id: id, name: name || id };
    }).filter(function (row) { return row.id; });
  }

  function allLocationIds() {
    return locations().map(function (row) { return row.id; });
  }

  function selectedLocationIds() {
    if (!Array.isArray(filters.locationIds)) return allLocationIds();
    return filters.locationIds.slice();
  }

  function locationLabel() {
    var all = locations();
    var ids = selectedLocationIds();
    if (!ids.length) return "Choose location";
    var names = all.filter(function (row) { return ids.indexOf(row.id) !== -1; })
      .map(function (row) { return row.name; });
    if (!names.length) return "Choose location";
    if (ids.length === all.length && all.length > 2) return "All locations";
    if (names.length === 2) return names[0] + " and " + names[1];
    if (names.length === 1) return names[0];
    if (ids.length === all.length) return names.join(" and ");
    return names.join(", ");
  }

  function dateOptions() {
    var api = compute();
    var today = todayKey();
    if (api && typeof api.datePresets === "function" && today) return api.datePresets(today);
    return [{ value: "today", label: "Today" }];
  }

  function dateLabel() {
    var opts = dateOptions();
    var hit = opts.find(function (row) { return row.value === filters.date; });
    return (hit && hit.label) || "Date";
  }

  function money(value) {
    if (model() && typeof model().money === "function") return model().money(value);
    var n = Number(value);
    if (!Number.isFinite(n)) n = 0;
    return "$" + n.toFixed(2);
  }

  function periodLabel(fromKey, toKey) {
    var api = compute();
    return api && typeof api.periodLabel === "function"
      ? api.periodLabel(fromKey, toKey)
      : ((fromKey || "") + (toKey && toKey !== fromKey ? " - " + toKey : ""));
  }

  function currentRange() {
    var api = compute();
    var today = todayKey();
    return api && typeof api.rangeForPreset === "function"
      ? api.rangeForPreset(filters.date, today, filters.customFrom, filters.customTo)
      : { fromKey: today, toKey: today };
  }

  function locationHeader() {
    var ids = selectedLocationIds();
    var names = locations().filter(function (row) { return ids.indexOf(row.id) !== -1; })
      .map(function (row) { return row.name; });
    return names.join(", ") || "—";
  }

  function locPopHtml() {
    var ids = selectedLocationIds();
    var rows = locations().map(function (row) {
      var on = ids.indexOf(row.id) !== -1;
      return (
        '<label class="ff-rpt-check" data-ff-cmp-loc="' + escapeHtml(row.id) + '">' +
          '<input type="checkbox"' + (on ? " checked" : "") + ">" +
          "<span>" + escapeHtml(row.name) + "</span>" +
        "</label>"
      );
    }).join("");
    var allOn = ids.length && ids.length === allLocationIds().length;
    return (
      '<div class="ff-rpt-pop' + (openMenu === "loc" ? " is-open" : "") + '" data-ff-cmp-pop="loc">' +
        (rows || '<p class="ff-rpt-empty">No locations.</p>') +
        '<div class="ff-rpt-pop-foot">' +
          '<button type="button" data-ff-cmp-loc-all="' + (allOn ? "0" : "1") + '">' +
            (allOn ? "Unselect all" : "Select all") +
          "</button>" +
        "</div>" +
      "</div>"
    );
  }

  function datePopHtml() {
    var opts = dateOptions().map(function (row) {
      var on = row.value === filters.date;
      return (
        '<button type="button" class="ff-rpt-date-opt' + (on ? " is-on" : "") + '" data-ff-cmp-date="' +
          escapeHtml(row.value) + '">' + escapeHtml(row.label) + "</button>"
      );
    }).join("");
    var custom = filters.date === "custom"
      ? '<div class="ff-rpt-custom">' +
          '<label>From <input type="date" data-ff-cmp-custom="from" value="' + escapeHtml(filters.customFrom) + '"></label>' +
          '<label>To <input type="date" data-ff-cmp-custom="to" value="' + escapeHtml(filters.customTo) + '"></label>' +
        "</div>"
      : "";
    return (
      '<div class="ff-rpt-pop ff-rpt-pop-date' + (openMenu === "date" ? " is-open" : "") + '" data-ff-cmp-pop="date">' +
        opts + custom +
      "</div>"
    );
  }

  function filtersHtml() {
    return (
      '<div class="ff-rpt-filters">' +
        '<div class="ff-rpt-dd' + (openMenu === "loc" ? " is-open" : "") + '">' +
          '<button type="button" class="ff-rpt-dd-btn" data-ff-cmp-menu="loc">' +
            escapeHtml(locationLabel()) +
          "</button>" +
          locPopHtml() +
        "</div>" +
        '<div class="ff-rpt-dd' + (openMenu === "date" ? " is-open" : "") + '">' +
          '<button type="button" class="ff-rpt-dd-btn" data-ff-cmp-menu="date">' +
            escapeHtml(dateLabel()) +
          "</button>" +
          datePopHtml() +
        "</div>" +
        '<button type="button" class="ff-rpt-generate" data-ff-cmp-generate' +
          (status === "loading" ? " disabled" : "") + ">" +
          (status === "loading" ? "Generating…" : "Generate") +
        "</button>" +
      "</div>"
    );
  }

  function changeClass(row) {
    var change = Number(row && row.change) || 0;
    if (change > 0) return "ff-rpt-cmp-up";
    if (change < 0) return "ff-rpt-cmp-down";
    return "ff-rpt-cmp-flat";
  }

  function signedMoney(value) {
    var n = Number(value) || 0;
    if (n > 0) return "+" + money(n);
    return money(n);
  }

  function signedCount(value) {
    var n = Number(value) || 0;
    if (n > 0) return "+" + String(n);
    return String(n);
  }

  function percentText(row) {
    if (!row) return "—";
    if (row.percentKind === "new") return "New";
    if (row.percentKind === "unavailable") return "—";
    if (row.percent == null || !Number.isFinite(Number(row.percent))) return "—";
    var n = Number(row.percent);
    return (n > 0 ? "+" : "") + String(n) + "%";
  }

  function kpi(label, value, note, extraClass) {
    return (
      '<div class="ff-rpt-kpi">' +
        '<p class="ff-rpt-kpi-value' + (extraClass ? " " + extraClass : "") + '">' + escapeHtml(value) + "</p>" +
        '<p class="ff-rpt-kpi-label">' + escapeHtml(label) + "</p>" +
        (note ? '<p class="ff-rpt-kpi-note">' + escapeHtml(note) + "</p>" : "") +
      "</div>"
    );
  }

  function metricRows() {
    return [
      { key: "grossTotal", label: "Gross checkout sales", money: true },
      { key: "adjustedTotal", label: "Adjusted sales", money: true },
      { key: "tickets", label: "Closed tickets", money: false },
      { key: "averageTicket", label: "Average closed ticket", money: true },
      { key: "tip", label: "Tips", money: true }
    ];
  }

  function reportHtml(summary) {
    if (!summary || !summary.metrics) {
      return '<p class="ff-rpt-empty">No closed sales in either period.</p>';
    }
    var currentLabel = periodLabel(summary.currentRange.fromKey, summary.currentRange.toKey);
    var previousLabel = periodLabel(summary.previousRange.fromKey, summary.previousRange.toKey);
    var metrics = summary.metrics;
    var rows = metricRows().map(function (col) {
      var row = metrics[col.key];
      var cur = col.money ? money(row.current) : String(row.current);
      var prev = col.money ? money(row.previous) : String(row.previous);
      var change = col.money ? signedMoney(row.change) : signedCount(row.change);
      return (
        "<tr>" +
          "<td>" + escapeHtml(col.label) + "</td>" +
          "<td>" + escapeHtml(cur) + "</td>" +
          "<td>" + escapeHtml(prev) + "</td>" +
          '<td class="' + changeClass(row) + '">' + escapeHtml(change) + "</td>" +
          '<td class="' + changeClass(row) + '">' + escapeHtml(percentText(row)) + "</td>" +
        "</tr>"
      );
    }).join("");
    var gross = metrics.grossTotal;
    var empty = !metrics.tickets.current && !metrics.tickets.previous
      ? '<p class="ff-rpt-empty">No closed sales in either period.</p>'
      : "";
    return (
      '<div class="ff-rpt-intel">' +
        '<div class="ff-rpt-intel-head">' +
          "<h1>Sales Comparison</h1>" +
          "<p>Closed checkout sales compared with the immediately preceding period of the same number of days.</p>" +
        "</div>" +
        '<div class="ff-rpt-meta">' +
          "<p><strong>Location(s):</strong> " + escapeHtml(locationHeader()) + "</p>" +
          "<p><strong>Current period:</strong> " + escapeHtml(currentLabel) + "</p>" +
          "<p><strong>Previous period:</strong> " + escapeHtml(previousLabel) + "</p>" +
          '<p class="ff-rpt-fine">Gross checkout sales include item amounts, fees, tax, and tip. Adjusted sales subtract ticket-level refunds. This is not booked appointment value.</p>' +
        "</div>" +
        '<div class="ff-rpt-kpis ff-rpt-kpis-4">' +
          kpi("Gross checkout sales", money(gross.current), percentText(gross) + " vs previous", changeClass(gross)) +
          kpi("Adjusted sales", money(metrics.adjustedTotal.current), percentText(metrics.adjustedTotal) + " vs previous", changeClass(metrics.adjustedTotal)) +
          kpi("Closed tickets", String(metrics.tickets.current), percentText(metrics.tickets) + " vs previous", changeClass(metrics.tickets)) +
          kpi("Average closed ticket", money(metrics.averageTicket.current), percentText(metrics.averageTicket) + " vs previous", changeClass(metrics.averageTicket)) +
          kpi("Tips", money(metrics.tip.current), percentText(metrics.tip) + " vs previous", changeClass(metrics.tip)) +
        "</div>" +
        empty +
        '<section class="ff-rpt-panel">' +
          "<h2>Current vs previous</h2>" +
          '<div class="ff-rpt-table-wrap">' +
            '<table class="ff-rpt-table ff-rpt-table-summary">' +
              "<thead><tr>" +
                "<th>Metric</th><th>Current</th><th>Previous</th><th>Change</th><th>%</th>" +
              "</tr></thead>" +
              "<tbody>" + rows + "</tbody>" +
            "</table>" +
          "</div>" +
        "</section>" +
      "</div>"
    );
  }

  function resultHtml() {
    if (status === "idle") return '<p class="ff-rpt-empty">Choose locations and a date, then Generate.</p>';
    if (status === "loading") return '<p class="ff-rpt-empty">Loading sales…</p>';
    if (status === "incomplete") {
      return '<p class="ff-rpt-warn">' + escapeHtml(errorText || (compareApi() && compareApi().INCOMPLETE_MESSAGE) ||
        "Sales data for this range is incomplete. Narrow the date range and try again.") + "</p>";
    }
    if (status === "error" || errorText) {
      return '<p class="ff-rpt-empty">' + escapeHtml(errorText || "This report could not load.") + "</p>";
    }
    return reportHtml(result);
  }

  function html() {
    return filtersHtml() + '<div class="ff-rpt-result" aria-live="polite">' + resultHtml() + "</div>";
  }

  function canStore(requestId) {
    var api = rangeApi();
    if (api && typeof api.shouldStoreReportResult === "function") {
      return api.shouldStoreReportResult(requestId, loadGen);
    }
    return requestId === loadGen;
  }

  function canPaint(requestId) {
    var api = rangeApi();
    if (api && typeof api.shouldPaintReportResult === "function") {
      return api.shouldPaintReportResult(requestId, loadGen, isActive());
    }
    return requestId === loadGen && isActive();
  }

  function finish(requestId, nextStatus, nextError, nextResult) {
    if (!canStore(requestId)) return;
    status = nextStatus;
    errorText = nextError || "";
    result = nextResult || null;
    if (canPaint(requestId)) paint();
  }

  async function generate() {
    var math = compute();
    var cmp = compareApi();
    var ids = selectedLocationIds();
    var range = currentRange();
    var prev = cmp && typeof cmp.previousRange === "function"
      ? cmp.previousRange(range.fromKey, range.toKey)
      : { fromKey: "", toKey: "" };
    var rangeHelp = rangeApi();
    var requestId = (loadGen += 1);
    openMenu = "";
    status = "loading";
    errorText = "";
    result = null;
    if (canPaint(requestId)) paint();
    if (!ids.length) {
      finish(requestId, "error", "Choose a location.", null);
      return;
    }
    if (filters.date === "custom" && !(range.fromKey && range.toKey)) {
      finish(requestId, "error", "Choose a start and end date.", null);
      return;
    }
    if (!prev.fromKey || !prev.toKey) {
      finish(requestId, "error", "Choose a start and end date.", null);
      return;
    }
    var currentFetched = null;
    var previousFetched = null;
    try {
      if (!rangeHelp || typeof rangeHelp.fetchForReport !== "function") {
        throw new Error("Sales range lookup is not available.");
      }
      var pair = await Promise.all([
        rangeHelp.fetchForReport(repo(), {
          locationIds: ids,
          fromKey: range.fromKey,
          toKey: range.toKey
        }),
        rangeHelp.fetchForReport(repo(), {
          locationIds: ids,
          fromKey: prev.fromKey,
          toKey: prev.toKey
        })
      ]);
      currentFetched = pair[0];
      previousFetched = pair[1];
    } catch (err) {
      finish(requestId, "error", (rangeHelp && typeof rangeHelp.userSafeError === "function")
        ? rangeHelp.userSafeError(err && err.message)
        : "This report could not load.", null);
      return;
    }
    var currentView = rangeHelp && typeof rangeHelp.viewState === "function"
      ? rangeHelp.viewState(currentFetched)
      : { kind: "error", message: "This report could not load.", sales: [] };
    var previousView = rangeHelp && typeof rangeHelp.viewState === "function"
      ? rangeHelp.viewState(previousFetched)
      : { kind: "error", message: "This report could not load.", sales: [] };
    var comparison = null;
    if ((currentView.kind === "ok" || currentView.kind === "empty") &&
        (previousView.kind === "ok" || previousView.kind === "empty")) {
      comparison = cmp && typeof cmp.comparePeriods === "function"
        ? cmp.comparePeriods(currentView.sales, previousView.sales, {
          fromKey: range.fromKey,
          toKey: range.toKey,
          locationIds: ids
        })
        : null;
    }
    var view = cmp && typeof cmp.ownerView === "function"
      ? cmp.ownerView(currentView, previousView, comparison)
      : { kind: "error", message: "This report could not load.", summary: null };
    if (view.kind === "error") {
      finish(requestId, "error", view.message || "This report could not load.", null);
      return;
    }
    if (view.kind === "incomplete") {
      finish(requestId, "incomplete", view.message ||
        "Sales data for this range is incomplete. Narrow the date range and try again.", null);
      return;
    }
    finish(requestId, "ready", "", view.summary || comparison);
  }

  function setLocationIds(ids) {
    filters.locationIds = ids.slice();
  }

  function toggleLocation(id) {
    var loc = String(id || "").trim();
    if (!loc) return;
    var ids = selectedLocationIds();
    var i = ids.indexOf(loc);
    if (i === -1) ids.push(loc);
    else ids.splice(i, 1);
    setLocationIds(ids);
  }

  function onHostClick(ev) {
    if (!isActive()) return;
    var t = ev.target;
    if (!t || typeof t.closest !== "function") return;
    var locRow = t.closest("[data-ff-cmp-loc]");
    if (locRow) {
      ev.preventDefault();
      ev.stopPropagation();
      toggleLocation(locRow.getAttribute("data-ff-cmp-loc"));
      openMenu = "loc";
      paint();
      return;
    }
    var menu = t.closest("[data-ff-cmp-menu]");
    if (menu) {
      ev.preventDefault();
      var next = menu.getAttribute("data-ff-cmp-menu");
      openMenu = openMenu === next ? "" : next;
      paint();
      return;
    }
    var allBtn = t.closest("[data-ff-cmp-loc-all]");
    if (allBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      setLocationIds(allBtn.getAttribute("data-ff-cmp-loc-all") === "1" ? allLocationIds() : []);
      openMenu = "loc";
      paint();
      return;
    }
    var dateOpt = t.closest("[data-ff-cmp-date]");
    if (dateOpt) {
      ev.preventDefault();
      ev.stopPropagation();
      filters.date = dateOpt.getAttribute("data-ff-cmp-date") || "today";
      openMenu = filters.date === "custom" ? "date" : "";
      paint();
      return;
    }
    var go = t.closest("[data-ff-cmp-generate]");
    if (go) {
      ev.preventDefault();
      generate();
      return;
    }
    if (t.closest("[data-ff-cmp-pop]")) {
      ev.stopPropagation();
      return;
    }
    if (openMenu) {
      openMenu = "";
      paint();
    }
  }

  function onHostChange(ev) {
    if (!isActive()) return;
    var t = ev.target;
    if (!t) return;
    var custom = t.getAttribute && t.getAttribute("data-ff-cmp-custom");
    if (custom === "from") filters.customFrom = t.value || "";
    if (custom === "to") filters.customTo = t.value || "";
  }

  function paint() {
    if (!isActive()) return;
    var host = document.getElementById(HOST_ID);
    if (!host) return;
    if (!Array.isArray(filters.locationIds)) {
      var all = allLocationIds();
      if (all.length) filters.locationIds = all;
    }
    host.innerHTML = html();
    if (!host.getAttribute("data-ff-cmp-bound")) {
      host.setAttribute("data-ff-cmp-bound", "1");
      host.addEventListener("click", onHostClick);
      host.addEventListener("change", onHostChange);
    }
  }

  window.ffBookingReportsSalesCompare = {
    paint: paint
  };
})();
