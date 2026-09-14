/**
 * Client Retention report. Cohort return after completed visits.
 * Not repeat-in-period, rebooking, or lifetime value.
 */
(function () {
  var HOST_ID = "ffRptMain";
  var REPORT_ID = "client-retention";
  var filters = {
    locationIds: null,
    date: "last_90",
    customFrom: "",
    customTo: ""
  };
  var result = null;
  var status = "idle";
  var errorText = "";
  var openMenu = "";
  var loadGen = 0;

  function dates() { return window.ffBookingReportsCompute || null; }
  function math() { return window.ffBookingReportsClientRetentionCompute || null; }
  function repo() { return window.ffBookingAppointments || null; }
  function time() { return window.ffBookingTime || null; }
  function rangeApi() {
    return window.ffBookingReportsAppointmentRange || window.ffBookingReportsSalesRange || null;
  }
  function apptRange() { return window.ffBookingReportsAppointmentRange || null; }
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
    var api = math();
    var today = todayKey();
    if (api && typeof api.datePresets === "function" && today) return api.datePresets(today);
    return [{ value: "last_90", label: "Last 90 days" }];
  }

  function dateLabel() {
    var opts = dateOptions();
    var hit = opts.find(function (row) { return row.value === filters.date; });
    return (hit && hit.label) || "Cohort period";
  }

  function currentRange() {
    var api = math();
    var today = todayKey();
    return api && typeof api.rangeForPreset === "function"
      ? api.rangeForPreset(filters.date, today, filters.customFrom, filters.customTo)
      : { fromKey: today, toKey: today };
  }

  function periodText() {
    var api = dates();
    var range = currentRange();
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

  function locationName(id) {
    var hit = locations().find(function (row) { return row.id === id; });
    return (hit && hit.name) || id || "Location";
  }

  function asOfByLocation(ids, now) {
    var tm = time();
    var out = {};
    (ids || []).forEach(function (id) {
      if (tm && typeof tm.zonedDateKey === "function") out[id] = tm.zonedDateKey(now, id);
    });
    return out;
  }

  function rateText(rate) {
    if (rate == null || !Number.isFinite(Number(rate))) return "—";
    return (Math.round(Number(rate) * 10) / 10) + "%";
  }

  function daysText(value) {
    if (value == null || !Number.isFinite(Number(value))) return "—";
    return String(value);
  }

  function locPopHtml() {
    var ids = selectedLocationIds();
    var rows = locations().map(function (row) {
      var on = ids.indexOf(row.id) !== -1;
      return (
        '<label class="ff-rpt-check" data-ff-retain-loc="' + escapeHtml(row.id) + '">' +
          '<input type="checkbox"' + (on ? " checked" : "") + ">" +
          "<span>" + escapeHtml(row.name) + "</span>" +
        "</label>"
      );
    }).join("");
    var allOn = ids.length && ids.length === allLocationIds().length;
    return (
      '<div class="ff-rpt-pop' + (openMenu === "loc" ? " is-open" : "") + '" data-ff-retain-pop="loc">' +
        (rows || '<p class="ff-rpt-empty">No locations.</p>') +
        '<div class="ff-rpt-pop-foot">' +
          '<button type="button" data-ff-retain-loc-all="' + (allOn ? "0" : "1") + '">' +
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
        '<button type="button" class="ff-rpt-date-opt' + (on ? " is-on" : "") + '" data-ff-retain-date="' +
          escapeHtml(row.value) + '">' + escapeHtml(row.label) + "</button>"
      );
    }).join("");
    var custom = filters.date === "custom"
      ? '<div class="ff-rpt-custom">' +
          '<label>From <input type="date" data-ff-retain-custom="from" value="' + escapeHtml(filters.customFrom) + '"></label>' +
          '<label>To <input type="date" data-ff-retain-custom="to" value="' + escapeHtml(filters.customTo) + '"></label>' +
        "</div>"
      : "";
    return (
      '<div class="ff-rpt-pop ff-rpt-pop-date' + (openMenu === "date" ? " is-open" : "") + '" data-ff-retain-pop="date">' +
        opts + custom +
      "</div>"
    );
  }

  function filtersHtml() {
    return (
      '<div class="ff-rpt-filters" data-ff-retain-filters>' +
        '<div class="ff-rpt-dd' + (openMenu === "loc" ? " is-open" : "") + '">' +
          '<button type="button" class="ff-rpt-dd-btn" data-ff-retain-menu="loc">' +
            escapeHtml(locationLabel()) +
          "</button>" +
          locPopHtml() +
        "</div>" +
        '<div class="ff-rpt-dd' + (openMenu === "date" ? " is-open" : "") + '">' +
          '<button type="button" class="ff-rpt-dd-btn" data-ff-retain-menu="date">' +
            escapeHtml(dateLabel()) +
          "</button>" +
          datePopHtml() +
        "</div>" +
        '<button type="button" class="ff-rpt-generate" data-ff-retain-generate' +
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

  function windowNote(row) {
    if (!row || !row.eligible) {
      return (row && row.open ? (row.open + " still in observation window") : "No closed observation window");
    }
    return row.returned + " of " + row.eligible + " eligible clients" +
      (row.open ? " · " + row.open + " still in observation window" : "");
  }

  function table(cols, rows) {
    if (!(rows || []).length) return "";
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
    var windows = (summary && summary.windows) || [];
    var retain = math();
    var view = retain && typeof retain.ownerView === "function" ? retain.ownerView(summary) : { message: "" };
    var w30 = totals.windows && totals.windows[30];
    var w60 = totals.windows && totals.windows[60];
    var w90 = totals.windows && totals.windows[90];
    var w180 = totals.windows && totals.windows[180];
    var insights = ((summary && summary.insights) || []).map(function (line) {
      return "<li>" + escapeHtml(line) + "</li>";
    }).join("");
    var windowCols = [
      { label: "Window", value: function (row) { return row.days + " days"; } },
      { label: "Retention", value: function (row) { return rateText(row.rate); } },
      { label: "Returned / eligible", value: function (row) { return row.eligible ? (row.returned + " / " + row.eligible) : "—"; } },
      { label: "Still open", value: function (row) { return String(row.open || 0); } }
    ];
    var locCols = [
      { label: "Location", value: function (row) { return locationName(row.locationId); } },
      { label: "Cohort clients", value: function (row) { return String(row.cohortClients); } },
      { label: "30-day", value: function (row) { return rateText(row.windows[30] && row.windows[30].rate); } },
      { label: "60-day", value: function (row) { return rateText(row.windows[60] && row.windows[60].rate); } },
      { label: "90-day", value: function (row) { return rateText(row.windows[90] && row.windows[90].rate); } },
      { label: "180-day", value: function (row) { return rateText(row.windows[180] && row.windows[180].rate); } }
    ];
    var monthCols = [
      { label: "Cohort month", value: function (row) { return row.label; } },
      { label: "Cohort clients", value: function (row) { return String(row.cohortClients); } },
      { label: "30-day", value: function (row) { return rateText(row.windows[30] && row.windows[30].rate); } },
      { label: "60-day", value: function (row) { return rateText(row.windows[60] && row.windows[60].rate); } },
      { label: "90-day", value: function (row) { return rateText(row.windows[90] && row.windows[90].rate); } },
      { label: "180-day", value: function (row) { return rateText(row.windows[180] && row.windows[180].rate); } }
    ];
    var unidentified = totals.unidentifiedVisits
      ? '<p class="ff-rpt-fine">' + escapeHtml(String(totals.unidentifiedVisits)) +
        " completed visits were excluded because they had no client id.</p>"
      : "";
    return (
      '<div class="ff-rpt-intel">' +
        '<div class="ff-rpt-intel-head">' +
          "<h1>Client Retention</h1>" +
          "<p>Of clients with a checked-out visit in this cohort period, how many returned on a later day within 30, 60, 90, or 180 days.</p>" +
        "</div>" +
        '<div class="ff-rpt-meta">' +
          "<p><strong>Location(s):</strong> " + escapeHtml(locationHeader()) + "</p>" +
          "<p><strong>Cohort period:</strong> " + escapeHtml(periodText()) + "</p>" +
          '<p class="ff-rpt-fine">A qualifying visit is a completed (checked-out) appointment. Booked, cancelled, and no-show appointments are not visits. ' +
            escapeHtml((retain && retain.MATURITY_NOTE) || view.message || "") + "</p>" +
        "</div>" +
        (view.kind === "empty" ? '<p class="ff-rpt-fine">' + escapeHtml(view.message) + "</p>" : "") +
        unidentified +
        '<div class="ff-rpt-kpis ff-rpt-kpis-4">' +
          kpi("Cohort clients", String(totals.cohortClients || 0)) +
          kpi("30-day retention", rateText(w30 && w30.rate), windowNote(w30)) +
          kpi("60-day retention", rateText(w60 && w60.rate), windowNote(w60)) +
          kpi("90-day retention", rateText(w90 && w90.rate), windowNote(w90)) +
          kpi("180-day retention", rateText(w180 && w180.rate), windowNote(w180)) +
          kpi("Days to first return", daysText(totals.medianDaysToFirstReturn), totals.returnedClients ? "Median · " + totals.returnedClients + " returned" : "No returns yet") +
        "</div>" +
        (insights
          ? '<section class="ff-rpt-panel ff-rpt-insights"><h2>Period notes</h2><ul>' + insights + "</ul></section>"
          : "") +
        '<section class="ff-rpt-panel">' +
          "<h2>Retention windows</h2>" +
          '<div class="ff-rpt-bars">' +
            windows.map(function (row) {
              var width = row.rate == null ? 0 : Math.max(0, Math.min(100, Number(row.rate)));
              return (
                '<div class="ff-rpt-bar-row">' +
                  '<span class="ff-rpt-bar-label">' + escapeHtml(row.days + " days") + "</span>" +
                  '<span class="ff-rpt-bar-track"><span class="ff-rpt-bar-fill" style="width:' + width + '%"></span></span>' +
                  '<span class="ff-rpt-bar-value">' + escapeHtml(rateText(row.rate)) + "</span>" +
                "</div>"
              );
            }).join("") +
          "</div>" +
          table(windowCols, windows) +
        "</section>" +
        ((summary.locations || []).length > 1
          ? '<section class="ff-rpt-panel"><h2>By cohort location</h2>' +
            table(locCols, summary.locations) +
            '<p class="ff-rpt-fine">Grouped by the location of the first completed visit. A later completed visit at another selected location still counts as a return.</p></section>'
          : "") +
        ((summary.months || []).length
          ? '<section class="ff-rpt-panel"><h2>By cohort month</h2>' +
            table(monthCols, summary.months) +
            '<p class="ff-rpt-fine">Rates still use only clients whose observation window has elapsed.</p></section>'
          : "") +
      "</div>"
    );
  }

  function resultHtml() {
    if (status === "idle") return '<p class="ff-rpt-empty">Choose locations and a cohort period, then Generate.</p>';
    if (status === "loading") return '<p class="ff-rpt-empty">Reading completed visits…</p>';
    if (status === "incomplete") {
      return '<p class="ff-rpt-warn">' + escapeHtml(errorText || (math() && math().INCOMPLETE_MESSAGE) ||
        "Appointment data for this range is incomplete. Narrow the cohort range and try again.") + "</p>";
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
    var retain = math();
    var ids = selectedLocationIds();
    var range = currentRange();
    var rangeHelp = apptRange();
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
    var now = new Date();
    var asOfMap = asOfByLocation(ids, now);
    var fetchTo = retain && typeof retain.lookForwardToKey === "function"
      ? retain.lookForwardToKey(range.toKey, { asOfByLocation: asOfMap, now: now, todayKey: todayKey() }, ids)
      : range.toKey;
    var fetched = null;
    try {
      if (!rangeHelp || typeof rangeHelp.fetchForReport !== "function") {
        throw new Error("Appointment range lookup is not available.");
      }
      fetched = await rangeHelp.fetchForReport(repo(), {
        locationIds: ids,
        fromKey: range.fromKey,
        toKey: fetchTo
      });
    } catch (err) {
      finish(requestId, "error", (rangeHelp && typeof rangeHelp.userSafeError === "function")
        ? rangeHelp.userSafeError(err && err.message)
        : "This report could not load.", null);
      return;
    }
    var fetchView = rangeHelp && typeof rangeHelp.viewState === "function"
      ? rangeHelp.viewState(fetched)
      : { kind: "error", message: "This report could not load.", appointments: [] };
    if (fetchView.kind === "error") {
      finish(requestId, "error", fetchView.message || "This report could not load.", null);
      return;
    }
    if (fetchView.kind === "incomplete") {
      finish(requestId, "incomplete", fetchView.message ||
        "Appointment data for this range is incomplete. Narrow the cohort range and try again.", null);
      return;
    }
    var summary = retain && typeof retain.summarizeRetention === "function"
      ? retain.summarizeRetention(fetchView.appointments || [], {
        fromKey: range.fromKey,
        toKey: range.toKey,
        locationIds: ids,
        now: now,
        asOfByLocation: asOfMap,
        todayKey: todayKey()
      })
      : { totals: { cohortClients: 0, windows: {} }, windows: [], insights: [] };
    finish(requestId, "ready", "", summary);
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
    var locRow = t.closest("[data-ff-retain-loc]");
    if (locRow) {
      ev.preventDefault();
      ev.stopPropagation();
      toggleLocation(locRow.getAttribute("data-ff-retain-loc"));
      openMenu = "loc";
      paint();
      return;
    }
    var menu = t.closest("[data-ff-retain-menu]");
    if (menu) {
      ev.preventDefault();
      var next = menu.getAttribute("data-ff-retain-menu");
      openMenu = openMenu === next ? "" : next;
      paint();
      return;
    }
    var allBtn = t.closest("[data-ff-retain-loc-all]");
    if (allBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      setLocationIds(allBtn.getAttribute("data-ff-retain-loc-all") === "1" ? allLocationIds() : []);
      openMenu = "loc";
      paint();
      return;
    }
    var dateOpt = t.closest("[data-ff-retain-date]");
    if (dateOpt) {
      ev.preventDefault();
      ev.stopPropagation();
      filters.date = dateOpt.getAttribute("data-ff-retain-date") || "last_90";
      openMenu = filters.date === "custom" ? "date" : "";
      paint();
      return;
    }
    var go = t.closest("[data-ff-retain-generate]");
    if (go) {
      ev.preventDefault();
      generate();
      return;
    }
    if (t.closest("[data-ff-retain-pop]")) {
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
    var custom = t.getAttribute && t.getAttribute("data-ff-retain-custom");
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
    if (!host.getAttribute("data-ff-rpt-retain-bound")) {
      host.setAttribute("data-ff-rpt-retain-bound", "1");
      host.addEventListener("click", onHostClick);
      host.addEventListener("change", onHostChange);
    }
  }

  window.ffBookingReportsClientRetention = {
    paint: paint
  };
})();
