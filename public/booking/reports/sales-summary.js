/**
 * Sales Summary report. Pick locations and a date range, then Generate.
 */
(function () {
  var HOST_ID = "ffRptMain";
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
  function repo() { return window.ffBookingSales || null; }
  function model() { return window.ffBookingSalesModel || null; }
  function time() { return window.ffBookingTime || null; }
  function rangeApi() { return window.ffBookingReportsSalesRange || null; }
  function nav() { return window.ffBookingReportsNav || null; }

  function isActive() {
    var api = nav();
    return !!(api && typeof api.getSelectedId === "function" && api.getSelectedId() === "sales-summary");
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

  function formatDay(dateKey) {
    var api = compute();
    return api && typeof api.shortDate === "function" ? api.shortDate(dateKey) : dateKey;
  }

  function periodText() {
    var api = compute();
    var today = todayKey();
    var range = api && typeof api.rangeForPreset === "function"
      ? api.rangeForPreset(filters.date, today, filters.customFrom, filters.customTo)
      : { fromKey: today, toKey: today };
    return api && typeof api.periodLabel === "function"
      ? api.periodLabel(range.fromKey, range.toKey)
      : (range.fromKey || "");
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
        '<label class="ff-rpt-check" data-ff-rpt-loc="' + escapeHtml(row.id) + '">' +
          '<input type="checkbox"' + (on ? " checked" : "") + ">" +
          '<span>' + escapeHtml(row.name) + "</span>" +
        "</label>"
      );
    }).join("");
    var allOn = ids.length && ids.length === allLocationIds().length;
    return (
      '<div class="ff-rpt-pop' + (openMenu === "loc" ? " is-open" : "") + '" data-ff-rpt-pop="loc">' +
        (rows || '<p class="ff-rpt-empty">No locations.</p>') +
        '<div class="ff-rpt-pop-foot">' +
          '<button type="button" data-ff-rpt-loc-all="' + (allOn ? "0" : "1") + '">' +
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
        '<button type="button" class="ff-rpt-date-opt' + (on ? " is-on" : "") + '" data-ff-rpt-date="' +
          escapeHtml(row.value) + '">' + escapeHtml(row.label) + "</button>"
      );
    }).join("");
    var custom = filters.date === "custom"
      ? '<div class="ff-rpt-custom">' +
          '<label>From <input type="date" data-ff-rpt-custom="from" value="' + escapeHtml(filters.customFrom) + '"></label>' +
          '<label>To <input type="date" data-ff-rpt-custom="to" value="' + escapeHtml(filters.customTo) + '"></label>' +
        "</div>"
      : "";
    return (
      '<div class="ff-rpt-pop ff-rpt-pop-date' + (openMenu === "date" ? " is-open" : "") + '" data-ff-rpt-pop="date">' +
        opts + custom +
      "</div>"
    );
  }

  function filtersHtml() {
    return (
      '<div class="ff-rpt-filters" data-ff-rpt-summary-filters>' +
        '<div class="ff-rpt-dd' + (openMenu === "loc" ? " is-open" : "") + '">' +
          '<button type="button" class="ff-rpt-dd-btn" data-ff-rpt-menu="loc">' +
            escapeHtml(locationLabel()) +
          "</button>" +
          locPopHtml() +
        "</div>" +
        '<div class="ff-rpt-dd' + (openMenu === "date" ? " is-open" : "") + '">' +
          '<button type="button" class="ff-rpt-dd-btn" data-ff-rpt-menu="date">' +
            escapeHtml(dateLabel()) +
          "</button>" +
          datePopHtml() +
        "</div>" +
        '<button type="button" class="ff-rpt-generate" data-ff-rpt-generate' +
          (status === "loading" ? " disabled" : "") + ">" +
          (status === "loading" ? "Generating…" : "Generate") +
        "</button>" +
      "</div>"
    );
  }

  var MONEY_KEYS = ["serviceSales", "productSales", "subtotal", "customFees", "tax", "tip", "grossTotal", "refunds", "adjustedTotal"];
  var COLS = [
    { key: "date", label: "Date" },
    { key: "sales", label: "# Sales" },
    { key: "services", label: "# Services" },
    { key: "serviceSales", label: "Service Sales" },
    { key: "products", label: "# Products" },
    { key: "productSales", label: "Product Sales" },
    { key: "subtotal", label: "Subtotal" },
    { key: "customFees", label: "Custom Fees" },
    { key: "tax", label: "Taxes" },
    { key: "tip", label: "Tips" },
    { key: "grossTotal", label: "Gross Total" },
    { key: "refunds", label: "Refunds" },
    { key: "adjustedTotal", label: "Adjusted Total" }
  ];

  function cellValue(row, col) {
    if (col.key === "date") return formatDay(row.dateKey);
    var value = row[col.key];
    if (MONEY_KEYS.indexOf(col.key) !== -1) return money(value);
    return String(value == null ? 0 : value);
  }

  function tableHtml(summary) {
    if (!summary || !summary.days || !summary.days.length) {
      return '<p class="ff-rpt-empty">No closed sales in this period.</p>';
    }
    var head = COLS.map(function (col) { return "<th>" + escapeHtml(col.label) + "</th>"; }).join("");
    var rows = summary.days.map(function (row) {
      return "<tr>" + COLS.map(function (col) {
        return "<td>" + escapeHtml(cellValue(row, col)) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    var t = summary.totals || {};
    var foot = COLS.map(function (col) {
      if (col.key === "date") return "<th>Total</th>";
      return "<th>" + escapeHtml(cellValue(t, col)) + "</th>";
    }).join("");
    return (
      '<div class="ff-rpt-meta">' +
        "<p><strong>Location(s):</strong> " + escapeHtml(locationHeader()) + "</p>" +
        "<p><strong>Period:</strong> " + escapeHtml(periodText()) + "</p>" +
      "</div>" +
      '<div class="ff-rpt-table-wrap">' +
        '<table class="ff-rpt-table">' +
          "<thead><tr>" + head + "</tr></thead>" +
          "<tbody>" + rows + "</tbody>" +
          "<tfoot><tr>" + foot + "</tr></tfoot>" +
        "</table>" +
      "</div>"
    );
  }

  function resultHtml() {
    if (status === "idle") return '<p class="ff-rpt-empty">Choose locations and a date, then Generate.</p>';
    if (status === "loading") return '<p class="ff-rpt-empty">Loading sales…</p>';
    if (status === "incomplete") {
      return '<p class="ff-rpt-warn">' + escapeHtml(errorText || (rangeApi() && rangeApi().INCOMPLETE_MESSAGE) ||
        "Sales data for this range is incomplete. Narrow the date range and try again.") + "</p>";
    }
    if (status === "error" || errorText) {
      return '<p class="ff-rpt-empty">' + escapeHtml(errorText) + "</p>";
    }
    return tableHtml(result);
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
    var ids = selectedLocationIds();
    var today = todayKey();
    var range = math && typeof math.rangeForPreset === "function"
      ? math.rangeForPreset(filters.date, today, filters.customFrom, filters.customTo)
      : { fromKey: today, toKey: today };
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
    var fetched = null;
    try {
      if (!rangeHelp || typeof rangeHelp.fetchForReport !== "function") {
        throw new Error("Sales range lookup is not available.");
      }
      fetched = await rangeHelp.fetchForReport(repo(), {
        locationIds: ids,
        fromKey: range.fromKey,
        toKey: range.toKey
      });
    } catch (err) {
      finish(requestId, "error", (rangeHelp && typeof rangeHelp.userSafeError === "function")
        ? rangeHelp.userSafeError(err && err.message)
        : "This report could not load.", null);
      return;
    }
    var view = rangeHelp && typeof rangeHelp.viewState === "function"
      ? rangeHelp.viewState(fetched)
      : { kind: "error", message: "This report could not load.", sales: [] };
    if (view.kind === "error") {
      finish(requestId, "error", view.message, null);
      return;
    }
    if (view.kind === "incomplete") {
      finish(requestId, "incomplete", view.message, null);
      return;
    }
    finish(requestId, "ready", "", math && typeof math.summarize === "function"
      ? math.summarize(view.sales, { fromKey: range.fromKey, toKey: range.toKey, locationIds: ids })
      : { days: [], totals: { sales: 0, services: 0, serviceSales: 0, tip: 0, total: 0 } });
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
    var locRow = t.closest("[data-ff-rpt-loc]");
    if (locRow) {
      ev.preventDefault();
      ev.stopPropagation();
      toggleLocation(locRow.getAttribute("data-ff-rpt-loc"));
      openMenu = "loc";
      paint();
      return;
    }
    var menu = t.closest("[data-ff-rpt-menu]");
    if (menu) {
      ev.preventDefault();
      var next = menu.getAttribute("data-ff-rpt-menu");
      openMenu = openMenu === next ? "" : next;
      paint();
      return;
    }
    var allBtn = t.closest("[data-ff-rpt-loc-all]");
    if (allBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      setLocationIds(allBtn.getAttribute("data-ff-rpt-loc-all") === "1" ? allLocationIds() : []);
      openMenu = "loc";
      paint();
      return;
    }
    var dateOpt = t.closest("[data-ff-rpt-date]");
    if (dateOpt) {
      ev.preventDefault();
      ev.stopPropagation();
      filters.date = dateOpt.getAttribute("data-ff-rpt-date") || "today";
      openMenu = filters.date === "custom" ? "date" : "";
      paint();
      return;
    }
    var go = t.closest("[data-ff-rpt-generate]");
    if (go) {
      ev.preventDefault();
      generate();
      return;
    }
    if (t.closest("[data-ff-rpt-pop]")) {
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
    var custom = t.getAttribute && t.getAttribute("data-ff-rpt-custom");
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
    if (!host.getAttribute("data-ff-rpt-summary-bound")) {
      host.setAttribute("data-ff-rpt-summary-bound", "1");
      host.addEventListener("click", onHostClick);
      host.addEventListener("change", onHostChange);
    }
  }

  window.ffBookingReportsSalesSummary = {
    paint: paint
  };
})();
