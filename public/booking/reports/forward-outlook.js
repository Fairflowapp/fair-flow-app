/**
 * Forward Outlook report. Future booked capacity from now through
 * a selected range. Not a forecast and not collected sales.
 */
(function () {
  var HOST_ID = "ffRptMain";
  var REPORT_ID = "forward-outlook";
  var filters = {
    locationIds: null,
    date: "next_7",
    customFrom: "",
    customTo: ""
  };
  var result = null;
  var status = "idle";
  var errorText = "";
  var openMenu = "";
  var loadGen = 0;

  function dates() { return window.ffBookingReportsCompute || null; }
  function math() { return window.ffBookingReportsForwardOutlookCompute || null; }
  function intel() { return window.ffBookingReportsIntelligenceCompute || null; }
  function repo() { return window.ffBookingAppointments || null; }
  function cal() { return window.ffBookingCalData || null; }
  function time() { return window.ffBookingTime || null; }
  function rangeApi() {
    return window.ffBookingReportsAppointmentRange || window.ffBookingReportsSalesRange || null;
  }
  function apptRange() { return window.ffBookingReportsAppointmentRange || null; }
  function blockRange() { return window.ffBookingReportsTimeBlockRange || null; }
  function blocksRepo() { return window.ffBookingBlocks || null; }
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
    return [{ value: "next_7", label: "Next 7 days" }];
  }

  function dateLabel() {
    var opts = dateOptions();
    var hit = opts.find(function (row) { return row.value === filters.date; });
    return (hit && hit.label) || "Date";
  }

  function currentRange() {
    var api = math();
    var today = todayKey();
    return api && typeof api.rangeForPreset === "function"
      ? api.rangeForPreset(filters.date, today, filters.customFrom, filters.customTo)
      : { fromKey: today, toKey: today };
  }

  function formatDay(dateKey) {
    var api = dates();
    return api && typeof api.shortDate === "function" ? api.shortDate(dateKey) : dateKey;
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

  function nowByLocation(ids, now) {
    var tm = time();
    var out = {};
    (ids || []).forEach(function (id) {
      if (tm && typeof tm.zonedDateKey === "function" && typeof tm.zonedMinutes === "function") {
        out[id] = {
          todayKey: tm.zonedDateKey(now, id),
          nowMinutes: tm.zonedMinutes(now, id)
        };
      }
    });
    return out;
  }

  function hoursText(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = 0;
    return String(Math.round(n * 10) / 10);
  }

  function mixText(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = 0;
    return (Math.round(n * 10) / 10) + "%";
  }

  function moneyText(value) {
    var api = math();
    if (api && typeof api.formatMoney === "function") return api.formatMoney(value);
    var n = Math.round(Number(value) * 100) / 100;
    if (!Number.isFinite(n)) n = 0;
    return "$" + n.toFixed(2);
  }

  function locPopHtml() {
    var ids = selectedLocationIds();
    var rows = locations().map(function (row) {
      var on = ids.indexOf(row.id) !== -1;
      return (
        '<label class="ff-rpt-check" data-ff-outlook-loc="' + escapeHtml(row.id) + '">' +
          '<input type="checkbox"' + (on ? " checked" : "") + ">" +
          "<span>" + escapeHtml(row.name) + "</span>" +
        "</label>"
      );
    }).join("");
    var allOn = ids.length && ids.length === allLocationIds().length;
    return (
      '<div class="ff-rpt-pop' + (openMenu === "loc" ? " is-open" : "") + '" data-ff-outlook-pop="loc">' +
        (rows || '<p class="ff-rpt-empty">No locations.</p>') +
        '<div class="ff-rpt-pop-foot">' +
          '<button type="button" data-ff-outlook-loc-all="' + (allOn ? "0" : "1") + '">' +
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
        '<button type="button" class="ff-rpt-date-opt' + (on ? " is-on" : "") + '" data-ff-outlook-date="' +
          escapeHtml(row.value) + '">' + escapeHtml(row.label) + "</button>"
      );
    }).join("");
    var custom = filters.date === "custom"
      ? '<div class="ff-rpt-custom">' +
          '<label>From <input type="date" data-ff-outlook-custom="from" value="' + escapeHtml(filters.customFrom) + '"></label>' +
          '<label>To <input type="date" data-ff-outlook-custom="to" value="' + escapeHtml(filters.customTo) + '"></label>' +
        "</div>"
      : "";
    return (
      '<div class="ff-rpt-pop ff-rpt-pop-date' + (openMenu === "date" ? " is-open" : "") + '" data-ff-outlook-pop="date">' +
        opts + custom +
      "</div>"
    );
  }

  function filtersHtml() {
    return (
      '<div class="ff-rpt-filters" data-ff-outlook-filters>' +
        '<div class="ff-rpt-dd' + (openMenu === "loc" ? " is-open" : "") + '">' +
          '<button type="button" class="ff-rpt-dd-btn" data-ff-outlook-menu="loc">' +
            escapeHtml(locationLabel()) +
          "</button>" +
          locPopHtml() +
        "</div>" +
        '<div class="ff-rpt-dd' + (openMenu === "date" ? " is-open" : "") + '">' +
          '<button type="button" class="ff-rpt-dd-btn" data-ff-outlook-menu="date">' +
            escapeHtml(dateLabel()) +
          "</button>" +
          datePopHtml() +
        "</div>" +
        '<button type="button" class="ff-rpt-generate" data-ff-outlook-generate' +
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

  function table(cols, rows, extraClass) {
    var head = cols.map(function (col) { return "<th>" + escapeHtml(col.label) + "</th>"; }).join("");
    var body = (rows || []).map(function (row) {
      return "<tr>" + cols.map(function (col) {
        return "<td>" + escapeHtml(col.value(row)) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    if (!body) return '<p class="ff-rpt-fine">No rows in this period.</p>';
    return (
      '<div class="ff-rpt-table-wrap ff-rpt-table-wrap-compact">' +
        '<table class="ff-rpt-table ff-rpt-table-compact' + (extraClass ? " " + extraClass : "") + '">' +
          "<thead><tr>" + head + "</tr></thead>" +
          "<tbody>" + body + "</tbody>" +
        "</table>" +
      "</div>"
    );
  }

  function reportHtml(summary) {
    var totals = (summary && summary.totals) || {};
    var outlook = math();
    var view = outlook && typeof outlook.ownerView === "function" ? outlook.ownerView(summary) : { kind: "ok", message: "" };
    var utilLabel = totals.workingMinutes > 0 ? mixText(totals.utilization || 0) : "—";
    var valueNote = totals.unpricedLineCount
      ? "Known prices on " + (totals.pricingCoverage || 0) + "% of lines. This is not collected sales."
      : "Appointment value currently booked in this future period. This is not collected sales.";
    var emptyNote = view.message
      ? '<p class="ff-rpt-fine">' + escapeHtml(view.message) + "</p>"
      : "";
    var insights = ((summary && summary.insights) || []).map(function (line) {
      return "<li>" + escapeHtml(line) + "</li>";
    }).join("");
    var dayCols = [
      { label: "Date", value: function (row) { return formatDay(row.dateKey); } },
      { label: "Working hrs", value: function (row) { return hoursText(row.hoursWorking); } },
      { label: "Booked ahead", value: function (row) { return hoursText(row.hoursBooked); } },
      { label: "Utilization", value: function (row) { return mixText(row.percent); } },
      { label: "Open hrs", value: function (row) { return hoursText(row.hoursOpen); } },
      { label: "Gap hrs", value: function (row) { return hoursText(row.hoursGap); } },
      { label: "Appointments", value: function (row) { return String(row.appointmentCount || 0); } },
      { label: "Booked value", value: function (row) { return moneyText(row.bookedServiceValue); } }
    ];
    var weekdayCols = [
      { label: "Weekday", value: function (row) { return row.label; } },
      { label: "Working dates", value: function (row) { return String(row.dateCount); } },
      { label: "Working hrs", value: function (row) { return hoursText(row.hoursWorking); } },
      { label: "Booked ahead", value: function (row) { return hoursText(row.hoursBooked); } },
      { label: "Utilization", value: function (row) { return mixText(row.percent); } },
      { label: "Gap hrs", value: function (row) { return hoursText(row.hoursGap); } },
      { label: "Booked value", value: function (row) { return moneyText(row.bookedServiceValue); } }
    ];
    var providerCols = [
      { label: "Provider", value: function (row) { return row.firstName || row.name; } },
      { label: "Working hrs", value: function (row) { return hoursText(row.hoursWorking); } },
      { label: "Booked ahead", value: function (row) { return hoursText(row.hoursBooked); } },
      { label: "Utilization", value: function (row) { return mixText(row.percent); } },
      { label: "Open hrs", value: function (row) { return hoursText(row.hoursOpen); } },
      { label: "Gap hrs", value: function (row) { return hoursText(row.hoursGap); } },
      { label: "Gaps", value: function (row) { return String(row.gapCount || 0); } },
      { label: "Open-edge hrs", value: function (row) { return hoursText(row.hoursOpenEdge); } }
    ];
    var serviceCols = [
      { label: "Service", value: function (row) { return row.name; } },
      { label: "Lines", value: function (row) { return String(row.lineCount); } },
      { label: "Booked hrs", value: function (row) { return hoursText(row.hours); } },
      { label: "Time share", value: function (row) { return mixText(row.timeMix); } },
      { label: "Booked value", value: function (row) { return moneyText(row.bookedServiceValue); } },
      { label: "Value share", value: function (row) { return mixText(row.valueShare); } },
      { label: "Providers", value: function (row) { return String(row.providerCount); } }
    ];
    return (
      '<div class="ff-rpt-intel">' +
        '<div class="ff-rpt-intel-head">' +
          "<h1>Forward Outlook</h1>" +
          "<p>What is already booked ahead, and how much future working time is still open. This is the current future book, not a forecast.</p>" +
        "</div>" +
        '<div class="ff-rpt-meta">' +
          "<p><strong>Location(s):</strong> " + escapeHtml(locationHeader()) + "</p>" +
          "<p><strong>Period:</strong> " + escapeHtml(periodText()) + "</p>" +
          '<p class="ff-rpt-fine">Remaining client-bookable time from now. Time Blocks are removed from future working capacity and are not booked appointment time. Past minutes on the current day are excluded. Booked service value ahead is appointment value, not collected sales.</p>' +
        "</div>" +
        emptyNote +
        '<div class="ff-rpt-kpis ff-rpt-kpis-4">' +
          kpi("Future appointments", String(totals.futureAppointments || 0)) +
          kpi("Future working hours", hoursText(totals.hoursWorking || 0)) +
          kpi("Booked ahead hours", hoursText(totals.hoursBooked || 0)) +
          kpi("Booked-ahead utilization", utilLabel, totals.workingMinutes ? "booked ahead ÷ future bookable working" : "no future working hours") +
          kpi("Open future hours", hoursText(totals.hoursOpen || 0)) +
          kpi("Upcoming gap hours", hoursText(totals.hoursGap || 0)) +
          kpi("Booked service value ahead", totals.bookedServiceValue ? moneyText(totals.bookedServiceValue) : "—", valueNote) +
        "</div>" +
        (insights
          ? '<section class="ff-rpt-panel ff-rpt-insights"><h2>Period notes</h2><ul>' + insights + "</ul></section>"
          : "") +
        '<section class="ff-rpt-panel">' +
          "<h2>Provider outlook</h2>" +
          ((summary.providers || []).length
            ? table(providerCols, summary.providers)
            : '<p class="ff-rpt-fine">No providers with future working time.</p>') +
          '<p class="ff-rpt-fine">Upcoming gaps are unused working time between booked blocks. Leading and trailing open time is not a calendar gap.</p>' +
        "</section>" +
        '<section class="ff-rpt-panel">' +
          "<h2>Future capacity patterns</h2>" +
          "<h3>By date</h3>" +
          table(dayCols, summary.days || []) +
          "<h3>By weekday</h3>" +
          table(weekdayCols, summary.weekdays || []) +
          '<p class="ff-rpt-fine">Weekday utilization is booked ahead minutes divided by working minutes across the represented dates, not an average of daily percents.</p>' +
        "</section>" +
        '<section class="ff-rpt-panel">' +
          "<h2>Service demand ahead</h2>" +
          ((summary.services || []).length
            ? table(serviceCols, summary.services)
            : '<p class="ff-rpt-fine">No future service lines in this period.</p>') +
          '<p class="ff-rpt-fine">Future appointment demand from service lines. This is not Service Sales.</p>' +
        "</section>" +
      "</div>"
    );
  }

  function resultHtml() {
    if (status === "idle") return '<p class="ff-rpt-empty">Choose locations and a future range, then Generate.</p>';
    if (status === "loading") return '<p class="ff-rpt-empty">Reading future appointments and schedules…</p>';
    if (status === "incomplete") {
      return '<p class="ff-rpt-warn">' + escapeHtml(errorText || (apptRange() && apptRange().INCOMPLETE_MESSAGE) ||
        "Appointment data for this range is incomplete. Narrow the date range and try again.") + "</p>";
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

  function loadSchedules(ids, fromKey, toKey) {
    var board = cal();
    var intelMath = intel();
    if (!board || typeof board.loadCalendarEmployees !== "function") {
      return { ok: false, providers: [] };
    }
    var keys = intelMath && typeof intelMath.dateKeysBetween === "function"
      ? intelMath.dateKeysBetween(fromKey, toKey)
      : (math() && typeof math().addDays === "function" ? [fromKey] : [fromKey]);
    var byId = {};
    var calls = 0;
    var fails = 0;
    ids.forEach(function (loc) {
      keys.forEach(function (dateKey) {
        calls += 1;
        var staff = [];
        try {
          staff = board.loadCalendarEmployees(dateKey, loc) || [];
        } catch (_) {
          fails += 1;
          staff = [];
        }
        staff.forEach(function (row) {
          var id = String(row && row.id || "").trim();
          if (!id) return;
          if (!byId[id]) {
            byId[id] = {
              id: id,
              name: String(row.name || row.firstName || id).trim(),
              firstName: String(row.firstName || "").trim(),
              schedule: []
            };
          }
          byId[id].schedule.push({
            dateKey: dateKey,
            locationId: loc,
            windows: (row.working || []).map(function (win) {
              return { startMin: win.startMin, endMin: win.endMin };
            })
          });
        });
      });
    });
    if (calls && fails === calls) return { ok: false, providers: [] };
    return { ok: true, providers: Object.keys(byId).map(function (id) { return byId[id]; }) };
  }

  async function generate() {
    var outlook = math();
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
    var fetched = null;
    var blockFetched = null;
    try {
      if (!rangeHelp || typeof rangeHelp.fetchForReport !== "function") {
        throw new Error("Appointment range lookup is not available.");
      }
      var blockHelp = blockRange();
      if (!blockHelp || typeof blockHelp.fetchForReport !== "function") {
        throw new Error("Time Block lookup is not available.");
      }
      var pair = await Promise.all([
        rangeHelp.fetchForReport(repo(), {
          locationIds: ids,
          fromKey: range.fromKey,
          toKey: range.toKey
        }),
        blockHelp.fetchForReport(blocksRepo(), {
          locationIds: ids,
          fromKey: range.fromKey,
          toKey: range.toKey
        })
      ]);
      fetched = pair[0];
      blockFetched = pair[1];
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
        "Appointment data for this range is incomplete. Narrow the date range and try again.", null);
      return;
    }
    var blockHelp = blockRange();
    var blockView = blockHelp && typeof blockHelp.viewState === "function"
      ? blockHelp.viewState(blockFetched)
      : { kind: "error", message: "Time Blocks for this range could not load.", blocks: [] };
    if (blockView.kind === "error") {
      finish(requestId, "error", blockView.message || "Time Blocks for this range could not load.", null);
      return;
    }
    var schedules = loadSchedules(ids, range.fromKey, range.toKey);
    if (!schedules.ok) {
      finish(requestId, "error", (outlook && outlook.SCHEDULE_ERROR_MESSAGE) ||
        "Provider schedules for this range could not load.", null);
      return;
    }
    var now = new Date();
    var summary = outlook && typeof outlook.buildOutlook === "function"
      ? outlook.buildOutlook({
        appointments: fetchView.appointments || [],
        providers: schedules.providers,
        timeBlocks: blockView.blocks || [],
        fromKey: range.fromKey,
        toKey: range.toKey,
        locationIds: ids,
        todayKey: todayKey(),
        preset: filters.date,
        now: now,
        nowByLocation: nowByLocation(ids, now)
      })
      : { totals: {}, days: [], providers: [], services: [], insights: [] };
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
    var locRow = t.closest("[data-ff-outlook-loc]");
    if (locRow) {
      ev.preventDefault();
      ev.stopPropagation();
      toggleLocation(locRow.getAttribute("data-ff-outlook-loc"));
      openMenu = "loc";
      paint();
      return;
    }
    var menu = t.closest("[data-ff-outlook-menu]");
    if (menu) {
      ev.preventDefault();
      var next = menu.getAttribute("data-ff-outlook-menu");
      openMenu = openMenu === next ? "" : next;
      paint();
      return;
    }
    var allBtn = t.closest("[data-ff-outlook-loc-all]");
    if (allBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      setLocationIds(allBtn.getAttribute("data-ff-outlook-loc-all") === "1" ? allLocationIds() : []);
      openMenu = "loc";
      paint();
      return;
    }
    var dateOpt = t.closest("[data-ff-outlook-date]");
    if (dateOpt) {
      ev.preventDefault();
      ev.stopPropagation();
      filters.date = dateOpt.getAttribute("data-ff-outlook-date") || "next_7";
      openMenu = filters.date === "custom" ? "date" : "";
      paint();
      return;
    }
    var go = t.closest("[data-ff-outlook-generate]");
    if (go) {
      ev.preventDefault();
      generate();
      return;
    }
    if (t.closest("[data-ff-outlook-pop]")) {
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
    var custom = t.getAttribute && t.getAttribute("data-ff-outlook-custom");
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
    if (!host.getAttribute("data-ff-rpt-outlook-bound")) {
      host.setAttribute("data-ff-rpt-outlook-bound", "1");
      host.addEventListener("click", onHostClick);
      host.addEventListener("change", onHostChange);
    }
  }

  window.ffBookingReportsForwardOutlook = {
    paint: paint
  };
})();
