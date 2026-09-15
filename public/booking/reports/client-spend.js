/**
 * Client Spend report. Closed checkout tickets grouped by clientId.
 * In-period spend only. Not lifetime value.
 */
(function () {
  var HOST_ID = "ffRptMain";
  var REPORT_ID = "client-spend";
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
  function math() { return window.ffBookingReportsClientSpendCompute || null; }
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
    if (value == null || !Number.isFinite(Number(value))) return "—";
    if (model() && typeof model().money === "function") return model().money(value);
    var n = Number(value);
    return "$" + n.toFixed(2);
  }

  function formatDay(dateKey) {
    var api = compute();
    return api && typeof api.shortDate === "function" ? api.shortDate(dateKey) : (dateKey || "—");
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
        '<label class="ff-rpt-check" data-ff-spend-loc="' + escapeHtml(row.id) + '">' +
          '<input type="checkbox"' + (on ? " checked" : "") + ">" +
          "<span>" + escapeHtml(row.name) + "</span>" +
        "</label>"
      );
    }).join("");
    var allOn = ids.length && ids.length === allLocationIds().length;
    return (
      '<div class="ff-rpt-pop' + (openMenu === "loc" ? " is-open" : "") + '" data-ff-spend-pop="loc">' +
        (rows || '<p class="ff-rpt-empty">No locations.</p>') +
        '<div class="ff-rpt-pop-foot">' +
          '<button type="button" data-ff-spend-loc-all="' + (allOn ? "0" : "1") + '">' +
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
        '<button type="button" class="ff-rpt-date-opt' + (on ? " is-on" : "") + '" data-ff-spend-date="' +
          escapeHtml(row.value) + '">' + escapeHtml(row.label) + "</button>"
      );
    }).join("");
    var custom = filters.date === "custom"
      ? '<div class="ff-rpt-custom">' +
          '<label>From <input type="date" data-ff-spend-custom="from" value="' + escapeHtml(filters.customFrom) + '"></label>' +
          '<label>To <input type="date" data-ff-spend-custom="to" value="' + escapeHtml(filters.customTo) + '"></label>' +
        "</div>"
      : "";
    return (
      '<div class="ff-rpt-pop ff-rpt-pop-date' + (openMenu === "date" ? " is-open" : "") + '" data-ff-spend-pop="date">' +
        opts + custom +
      "</div>"
    );
  }

  function filtersHtml() {
    return (
      '<div class="ff-rpt-filters" data-ff-spend-filters>' +
        '<div class="ff-rpt-dd' + (openMenu === "loc" ? " is-open" : "") + '">' +
          '<button type="button" class="ff-rpt-dd-btn" data-ff-spend-menu="loc">' +
            escapeHtml(locationLabel()) +
          "</button>" +
          locPopHtml() +
        "</div>" +
        '<div class="ff-rpt-dd' + (openMenu === "date" ? " is-open" : "") + '">' +
          '<button type="button" class="ff-rpt-dd-btn" data-ff-spend-menu="date">' +
            escapeHtml(dateLabel()) +
          "</button>" +
          datePopHtml() +
        "</div>" +
        '<button type="button" class="ff-rpt-generate" data-ff-spend-generate' +
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

  function table(cols, rows) {
    if (!(rows || []).length) return '<p class="ff-rpt-empty">' + escapeHtml((math() && math().EMPTY_NOTE) || "No identified-client closed sales in this period.") + "</p>";
    var head = cols.map(function (col) { return "<th>" + escapeHtml(col.label) + "</th>"; }).join("");
    var body = rows.map(function (row) {
      return "<tr>" + cols.map(function (col) {
        return "<td>" + escapeHtml(col.value(row)) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    return (
      '<div class="ff-rpt-table-wrap ff-rpt-table-wrap-compact">' +
        '<table class="ff-rpt-table ff-rpt-table-compact">' +
          "<thead><tr>" + head + "</tr></thead>" +
          "<tbody>" + body + "</tbody>" +
        "</table>" +
      "</div>"
    );
  }

  function reportHtml(summary) {
    var totals = (summary && summary.totals) || {};
    var clients = (summary && summary.clients) || [];
    var insights = ((summary && summary.insights) || []).map(function (line) {
      return "<li>" + escapeHtml(line) + "</li>";
    }).join("");
    var cols = [
      { label: "Client", value: function (row) { return row.name; } },
      { label: "Total spend", value: function (row) { return money(row.spend); } },
      { label: "Closed checkouts", value: function (row) { return String(row.tickets || 0); } },
      { label: "Average per checkout", value: function (row) { return money(row.averageSpend); } },
      { label: "Last closed checkout", value: function (row) { return formatDay(row.lastClosedDateKey); } }
    ];
    var unidentified = totals.unidentifiedTickets
      ? '<p class="ff-rpt-fine">' + escapeHtml(String(totals.unidentifiedTickets)) +
        " closed tickets (" + money(totals.unidentifiedSales) +
        ") were excluded from the ranking because they had no client id.</p>"
      : "";
    return (
      '<div class="ff-rpt-intel">' +
        '<div class="ff-rpt-intel-head">' +
          "<h1>Client Spend</h1>" +
          "<p>Closed checkout sales grouped by identified client. This is in-period spend, not lifetime value.</p>" +
        "</div>" +
        '<div class="ff-rpt-meta">' +
          "<p><strong>Location(s):</strong> " + escapeHtml(locationHeader()) + "</p>" +
          "<p><strong>Period:</strong> " + escapeHtml(periodText()) + "</p>" +
          '<p class="ff-rpt-fine">Totals use the same closed-checkout math as Sales Summary. Open and void tickets are excluded. Tickets without a client id do not appear in the ranking.</p>' +
        "</div>" +
        unidentified +
        '<div class="ff-rpt-kpis ff-rpt-kpis-4">' +
          kpi("Identified-client sales", money(totals.identifiedSales)) +
          kpi("Identified clients", String(totals.identifiedClients || 0)) +
          kpi("Average spend per client", money(totals.averageSpendPerClient)) +
          kpi("Closed checkouts", String(totals.identifiedTickets || 0), totals.unidentifiedTickets ? (totals.unidentifiedTickets + " unidentified tickets") : "") +
        "</div>" +
        (insights
          ? '<section class="ff-rpt-panel ff-rpt-insights"><h2>Period notes</h2><ul>' + insights + "</ul></section>"
          : "") +
        '<section class="ff-rpt-panel">' +
          "<h2>By client</h2>" +
          table(cols, clients) +
        "</section>" +
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
      return '<p class="ff-rpt-empty">' + escapeHtml(errorText || (math() && math().LOAD_ERROR_MESSAGE) || "This report could not load.") + "</p>";
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
    var spend = math();
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
      summary = spend && typeof spend.summarizeClientSpend === "function"
        ? spend.summarizeClientSpend(fetchView.sales, { fromKey: range.fromKey, toKey: range.toKey, locationIds: ids })
        : { totals: { identifiedClients: 0, identifiedSales: 0 }, clients: [], insights: [] };
    }
    var view = spend && typeof spend.ownerView === "function"
      ? spend.ownerView(fetchView, summary)
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
    var locRow = t.closest("[data-ff-spend-loc]");
    if (locRow) {
      ev.preventDefault();
      ev.stopPropagation();
      toggleLocation(locRow.getAttribute("data-ff-spend-loc"));
      openMenu = "loc";
      paint();
      return;
    }
    var menu = t.closest("[data-ff-spend-menu]");
    if (menu) {
      ev.preventDefault();
      var next = menu.getAttribute("data-ff-spend-menu");
      openMenu = openMenu === next ? "" : next;
      paint();
      return;
    }
    var allBtn = t.closest("[data-ff-spend-loc-all]");
    if (allBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      setLocationIds(allBtn.getAttribute("data-ff-spend-loc-all") === "1" ? allLocationIds() : []);
      openMenu = "loc";
      paint();
      return;
    }
    var dateOpt = t.closest("[data-ff-spend-date]");
    if (dateOpt) {
      ev.preventDefault();
      ev.stopPropagation();
      filters.date = dateOpt.getAttribute("data-ff-spend-date") || "today";
      openMenu = filters.date === "custom" ? "date" : "";
      paint();
      return;
    }
    var go = t.closest("[data-ff-spend-generate]");
    if (go) {
      ev.preventDefault();
      generate();
      return;
    }
    if (t.closest("[data-ff-spend-pop]")) {
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
    var custom = t.getAttribute && t.getAttribute("data-ff-spend-custom");
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
    if (!host.getAttribute("data-ff-rpt-spend-bound")) {
      host.setAttribute("data-ff-rpt-spend-bound", "1");
      host.addEventListener("click", onHostClick);
      host.addEventListener("change", onHostChange);
    }
  }

  window.ffBookingReportsClientSpend = {
    paint: paint
  };
})();
