/**
 * Sales by Time Period. Closed checkout tickets by salon-local date.
 */
(function () {
  var HOST_ID = "ffRptMain";
  var REPORT_ID = "sales-by-period";
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
  function math() { return window.ffBookingReportsSalesTimeCompute || null; }
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

  function formatDay(dateKey) {
    var api = compute();
    return api && typeof api.shortDate === "function" ? api.shortDate(dateKey) : dateKey;
  }

  function longDay(dateKey) {
    var api = compute();
    return api && typeof api.longDate === "function" ? api.longDate(dateKey) : dateKey;
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
        '<label class="ff-rpt-check" data-ff-time-loc="' + escapeHtml(row.id) + '">' +
          '<input type="checkbox"' + (on ? " checked" : "") + ">" +
          "<span>" + escapeHtml(row.name) + "</span>" +
        "</label>"
      );
    }).join("");
    var allOn = ids.length && ids.length === allLocationIds().length;
    return (
      '<div class="ff-rpt-pop' + (openMenu === "loc" ? " is-open" : "") + '" data-ff-time-pop="loc">' +
        (rows || '<p class="ff-rpt-empty">No locations.</p>') +
        '<div class="ff-rpt-pop-foot">' +
          '<button type="button" data-ff-time-loc-all="' + (allOn ? "0" : "1") + '">' +
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
        '<button type="button" class="ff-rpt-date-opt' + (on ? " is-on" : "") + '" data-ff-time-date="' +
          escapeHtml(row.value) + '">' + escapeHtml(row.label) + "</button>"
      );
    }).join("");
    var custom = filters.date === "custom"
      ? '<div class="ff-rpt-custom">' +
          '<label>From <input type="date" data-ff-time-custom="from" value="' + escapeHtml(filters.customFrom) + '"></label>' +
          '<label>To <input type="date" data-ff-time-custom="to" value="' + escapeHtml(filters.customTo) + '"></label>' +
        "</div>"
      : "";
    return (
      '<div class="ff-rpt-pop ff-rpt-pop-date' + (openMenu === "date" ? " is-open" : "") + '" data-ff-time-pop="date">' +
        opts + custom +
      "</div>"
    );
  }

  function filtersHtml() {
    return (
      '<div class="ff-rpt-filters" data-ff-time-filters>' +
        '<div class="ff-rpt-dd' + (openMenu === "loc" ? " is-open" : "") + '">' +
          '<button type="button" class="ff-rpt-dd-btn" data-ff-time-menu="loc">' +
            escapeHtml(locationLabel()) +
          "</button>" +
          locPopHtml() +
        "</div>" +
        '<div class="ff-rpt-dd' + (openMenu === "date" ? " is-open" : "") + '">' +
          '<button type="button" class="ff-rpt-dd-btn" data-ff-time-menu="date">' +
            escapeHtml(dateLabel()) +
          "</button>" +
          datePopHtml() +
        "</div>" +
        '<button type="button" class="ff-rpt-generate" data-ff-time-generate' +
          (status === "loading" ? " disabled" : "") + ">" +
          (status === "loading" ? "Generating…" : "Generate") +
        "</button>" +
      "</div>"
    );
  }

  function kpi(label, value, note) {
    return (
      '<div class="ff-rpt-kpi">' +
        '<p class="ff-rpt-kpi-value">' + escapeHtml(value) + "</p>" +
        '<p class="ff-rpt-kpi-label">' + escapeHtml(label) + "</p>" +
        (note ? '<p class="ff-rpt-kpi-note">' + escapeHtml(note) + "</p>" : "") +
      "</div>"
    );
  }

  function mixText(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = 0;
    return (Math.round(n * 10) / 10) + "%";
  }

  function table(cols, rows, foot, extraClass) {
    var head = cols.map(function (col) { return "<th>" + escapeHtml(col.label) + "</th>"; }).join("");
    var body = (rows || []).map(function (row) {
      return "<tr>" + cols.map(function (col) {
        return "<td>" + escapeHtml(col.value(row)) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    var footer = "";
    if (foot) {
      footer = "<tfoot><tr>" + cols.map(function (col) {
        return "<th>" + escapeHtml(col.foot ? col.foot(foot) : "") + "</th>";
      }).join("") + "</tr></tfoot>";
    }
    return (
      '<div class="ff-rpt-table-wrap ff-rpt-table-wrap-compact">' +
        '<table class="ff-rpt-table ff-rpt-table-compact ff-rpt-table-time' +
          (extraClass ? " " + extraClass : "") + '">' +
          "<thead><tr>" + head + "</tr></thead>" +
          "<tbody>" + body + "</tbody>" +
          footer +
        "</table>" +
      "</div>"
    );
  }

  function reportHtml(summary) {
    var totals = (summary && summary.totals) || {};
    var highlights = (summary && summary.highlights) || {};
    var svcMath = math();
    var dayCols = [
      { label: "Date", value: function (row) { return formatDay(row.dateKey); }, foot: function () { return "Total"; } },
      { label: "Tickets", value: function (row) { return String(row.tickets); }, foot: function (t) { return String(t.tickets); } },
      { label: "Gross sales", value: function (row) { return money(row.grossSales); }, foot: function (t) { return money(t.grossSales); } },
      { label: "Refunds", value: function (row) { return money(row.refunds); }, foot: function (t) { return money(t.refunds); } },
      { label: "Adjusted sales", value: function (row) { return money(row.adjustedSales); }, foot: function (t) { return money(t.adjustedSales); } },
      { label: "Service sales", value: function (row) { return money(row.serviceSales); }, foot: function (t) { return money(t.serviceSales); } },
      { label: "Tips", value: function (row) { return money(row.tip); }, foot: function (t) { return money(t.tip); } },
      { label: "Average ticket", value: function (row) { return money(row.averageTicket); }, foot: function (t) { return money(t.averageTicket); } }
    ];
    var weekdayCols = [
      { label: "Weekday", value: function (row) { return row.label; } },
      { label: "Dates represented", value: function (row) { return String(row.dateCount); } },
      { label: "Tickets", value: function (row) { return String(row.tickets); } },
      { label: "Gross sales", value: function (row) { return money(row.grossSales); } },
      { label: "Avg sales / date", value: function (row) { return money(row.averagePerDate); } },
      { label: "Avg ticket", value: function (row) { return money(row.averageTicket); } },
      { label: "Sales mix", value: function (row) { return mixText(row.mix); } }
    ];
    var emptyNote = !totals.tickets
      ? '<p class="ff-rpt-fine">' + escapeHtml((svcMath && svcMath.EMPTY_NOTE) || "No closed sales in this period.") + "</p>"
      : "";
    var insights = ((summary && summary.insights) || []).map(function (line) {
      return "<li>" + escapeHtml(line) + "</li>";
    }).join("");
    return (
      '<div class="ff-rpt-intel">' +
        '<div class="ff-rpt-meta">' +
          "<p><strong>Location(s):</strong> " + escapeHtml(locationHeader()) + "</p>" +
          "<p><strong>Period:</strong> " + escapeHtml(periodText()) + "</p>" +
          '<p class="ff-rpt-fine">Closed checkout tickets by sale close date. Booked service value stays in Booking Intelligence.</p>' +
        "</div>" +
        emptyNote +
        '<div class="ff-rpt-kpis ff-rpt-kpis-4">' +
          kpi("Gross checkout sales", money(totals.grossSales)) +
          kpi("Adjusted sales", money(totals.adjustedSales), totals.refunds ? "After ticket-level refunds" : "") +
          kpi("Closed tickets", String(totals.tickets || 0)) +
          kpi("Average closed ticket", money(totals.averageTicket)) +
          kpi("Highest-sales date", highlights.highestSalesDate ? longDay(highlights.highestSalesDate) : "—") +
        "</div>" +
        '<section class="ff-rpt-panel">' +
          "<h2>By day</h2>" +
          table(dayCols, summary.days || [], totals) +
          '<p class="ff-rpt-fine">Dates with no closed tickets stay in the table as $0. Gross checkout sales includes tip when the ticket total includes it.</p>' +
        "</section>" +
        '<section class="ff-rpt-panel">' +
          "<h2>By weekday</h2>" +
          table(weekdayCols, summary.weekdays || [], null, "ff-rpt-table-time-weekday") +
          '<p class="ff-rpt-fine">Average sales per date uses every calendar occurrence of that weekday in the selected range, including $0 dates. Open hours are not inferred.</p>' +
        "</section>" +
        (insights
          ? '<section class="ff-rpt-panel ff-rpt-panel-secondary ff-rpt-insights"><h2>Period notes</h2><ul>' + insights + "</ul></section>"
          : "") +
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
    var dates = compute();
    var period = math();
    var ids = selectedLocationIds();
    var today = todayKey();
    var range = dates && typeof dates.rangeForPreset === "function"
      ? dates.rangeForPreset(filters.date, today, filters.customFrom, filters.customTo)
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
    var fetchView = rangeHelp && typeof rangeHelp.viewState === "function"
      ? rangeHelp.viewState(fetched)
      : { kind: "error", message: "This report could not load.", sales: [] };
    var summary = null;
    if (fetchView.kind === "ok" || fetchView.kind === "empty") {
      summary = period && typeof period.summarizeSalesByPeriod === "function"
        ? period.summarizeSalesByPeriod(fetchView.sales, { fromKey: range.fromKey, toKey: range.toKey, locationIds: ids })
        : { totals: { tickets: 0, grossSales: 0 }, days: [], weekdays: [], insights: [] };
    }
    var view = period && typeof period.ownerView === "function"
      ? period.ownerView(fetchView, summary)
      : (fetchView.kind === "incomplete"
        ? { kind: "incomplete", message: fetchView.message, summary: null }
        : fetchView.kind === "error"
          ? { kind: "error", message: fetchView.message, summary: null }
          : { kind: "ok", summary: summary });
    if (view.kind === "error") {
      finish(requestId, "error", view.message || "This report could not load.", null);
      return;
    }
    if (view.kind === "incomplete") {
      finish(requestId, "incomplete", view.message ||
        "Sales data for this range is incomplete. Narrow the date range and try again.", null);
      return;
    }
    finish(requestId, "ready", "", view.summary || summary);
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
    var locRow = t.closest("[data-ff-time-loc]");
    if (locRow) {
      ev.preventDefault();
      ev.stopPropagation();
      toggleLocation(locRow.getAttribute("data-ff-time-loc"));
      openMenu = "loc";
      paint();
      return;
    }
    var menu = t.closest("[data-ff-time-menu]");
    if (menu) {
      ev.preventDefault();
      var next = menu.getAttribute("data-ff-time-menu");
      openMenu = openMenu === next ? "" : next;
      paint();
      return;
    }
    var allBtn = t.closest("[data-ff-time-loc-all]");
    if (allBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      setLocationIds(allBtn.getAttribute("data-ff-time-loc-all") === "1" ? allLocationIds() : []);
      openMenu = "loc";
      paint();
      return;
    }
    var dateOpt = t.closest("[data-ff-time-date]");
    if (dateOpt) {
      ev.preventDefault();
      ev.stopPropagation();
      filters.date = dateOpt.getAttribute("data-ff-time-date") || "today";
      openMenu = filters.date === "custom" ? "date" : "";
      paint();
      return;
    }
    var go = t.closest("[data-ff-time-generate]");
    if (go) {
      ev.preventDefault();
      generate();
      return;
    }
    if (t.closest("[data-ff-time-pop]")) {
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
    var custom = t.getAttribute && t.getAttribute("data-ff-time-custom");
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
    if (!host.getAttribute("data-ff-rpt-time-bound")) {
      host.setAttribute("data-ff-rpt-time-bound", "1");
      host.addEventListener("click", onHostClick);
      host.addEventListener("change", onHostChange);
    }
  }

  window.ffBookingReportsSalesTime = {
    paint: paint
  };
})();
